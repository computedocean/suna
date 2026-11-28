/**
 * Automatic Space memory: one update reads the new messages of a Space's
 * sessions, asks one model which durable facts belong in the Space memory
 * (`/Spaces/<group_id>/Memory`), writes those pages and moves each read
 * session's sync mark (`./prompt.ts` says what the mark is).
 *
 * Two callers: the leader job (`worker/jobs/space-memory.ts`, sessions idle
 * for 5 min, Spaces with `memory_auto_update` on) and `POST
 * …/session-groups/:id/memory/update` (a person, no idle wait). A session is
 * read only while its owner still sees the Space (`sessionOwnerSeesGroup`):
 * nothing a removed person's session says reaches the Space memory.
 *
 * Cost bounds: one model call per update (a second only after a transient
 * failure), at most `SPACE_MEMORY_MAX_SESSIONS` sessions, 12,000 characters of
 * new text per session and 48,000 per call, 40 pages in the index, 6 pages
 * written. The call runs on a one-call gateway key of the Space's account,
 * deleted after it, so it is billed like a session title.
 */
import { projectSessionGroupMembers, projectSessionGroups, projectSessions } from '@kortix/db';
import { readSessionLogPage } from '../../session-log-read';
import { MEMORY_DIR_NAME } from '../../../drives/folders';
import { findProjectDrive } from '../../../drives/service';
import { projectFeatureFlagEnabled } from '../../../feature-flags/for-project';
import { logger } from '../../../lib/logger';
import { createGatewayKey, deleteGatewayKey, INTERNAL_SPACE_MEMORY_KEY_NAME } from '../../../llm-gateway/gateway-keys';
import { headOf, layerFiles, volumeOps, writeAgentPage } from '../../../memory/files';
import { type Layer, MemoryError } from '../../../memory/layers';
import { db } from '../../../shared/db';
import { errorMessage } from '../../../shared/error-message';
import { qualifiedColumn } from '../../../shared/sql-qualified-column';
import { resolveInternalModel, standaloneGatewayUrl } from '../../session-title-generate';
import { sessionOwnerSeesGroup } from '../session-group-viewer';
import { sessionTitleFromMetadata } from '../session-title-placeholder';
import { sessionGroupDriveFolder } from '@kortix/shared';
import { and, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import {
  marksToAdvance,
  newSessionText,
  pageIndex,
  parseSpaceMemoryReply,
  SPACE_MEMORY_IDLE_MS,
  SPACE_MEMORY_LOOKBACK_MS,
  SPACE_MEMORY_MAX_SESSIONS,
  SPACE_MEMORY_MESSAGES_PER_SESSION,
  SPACE_MEMORY_SYNCED_AT_KEY,
  SPACE_MEMORY_SYNCED_SEQ_KEY,
  spaceMemoryMessages,
  syncMarkOf,
} from './prompt';

/** One model attempt's limit, and the reply's output ceiling. */
const ATTEMPT_TIMEOUT_MS = 40_000;
const MAX_TOKENS = 8_000;
/** The name in a page's `updated_by: <name> (agent)`. */
const AGENT_NAME = 'kortix';

export type SpaceMemoryUpdateOutcome =
  | { ok: true; updatedPages: number; sessions: number; memoryUpdatedAt: Date | null }
  | { ok: false; reason: 'not_found' | 'drive_unavailable' | 'no_model' | 'model_failed' | 'busy' | 'lease_lost' | 'error' };

/** The run's hold on the Space lease: `until` is the token every renewal compares against. */
interface LeaseToken {
  groupId: string;
  until: Date;
}

/** Thrown when the lease was taken by another run: this run stops before its next write. */
class LeaseLost extends Error {}

/** How long one update holds the Space's lease: two 40 s model attempts plus the reads and writes, with margin. */
const LEASE_MS = 5 * 60_000;
/** After a failed automatic update, the job leaves the Space alone this long. */
const RETRY_AFTER_MS = 30 * 60_000;

/** A timestamp as `toISOString()` text (UTC, milliseconds, `Z`): the only shape the server writes a mark in. */
const isoText = (value: SQL) => sql`to_char((${value}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * The stored mark is valid (`syncMarkOf` in SQL), compared as text and never
 * cast: a stored value is only ever compared with `toISOString()` text, whose
 * text order is its time order. Valid: the strict ISO shape, and not after
 * now plus `SPACE_MEMORY_MARK_SKEW_MS`. The pattern bounds each field (month
 * 01-12, day 01-31, …), so month 99, past or future, reads as unset. A day
 * the month lacks (Feb 30) passes here; `syncMarkOf` rejects it in JS, and
 * `advanceMarks` keeps no seq of a mark JS did not read as valid.
 */
const validMark = sql`(coalesce(${projectSessions.metadata}->>${SPACE_MEMORY_SYNCED_AT_KEY} ~ '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d\\.\\d{3}Z$', false)
  AND ${projectSessions.metadata}->>${SPACE_MEMORY_SYNCED_AT_KEY} <= ${isoText(sql`now() + interval '5 minutes'`)})`;

/** The mark condition in SQL: changed after its mark; an unset, malformed or future mark reads as never. */
const changedSinceMark = sql`(NOT ${validMark} OR ${isoText(sql`${projectSessions.updatedAt}`)} > ${projectSessions.metadata}->>${SPACE_MEMORY_SYNCED_AT_KEY})`;

/**
 * Only a session whose content every member of the Space may read: one in no
 * channel or DM, or one in a public channel.
 * A thread of a private channel or a DM is never read, so its content never
 * reaches the Space memory. The outer session id is qualified for the
 * correlated subquery (`qualifiedColumn`).
 */
const readableBySpaceMembers = sql`(${qualifiedColumn(projectSessions.spaceId)} is null or exists (
  select 1 from kortix.project_spaces sp
   where sp.space_id = ${qualifiedColumn(projectSessions.spaceId)}
     and sp.kind = 'channel' and sp.visibility = 'public'))`;

/** The due condition of `sessionDue`, in SQL. */
function dueSessions(now: Date, manual: boolean) {
  return and(
    readableBySpaceMembers,
    sql`${projectSessions.parentSessionId} is null`,
    sql`(${projectSessions.metadata} ? 'deletedAt') is not true`,
    sql`${projectSessions.updatedAt} >= ${new Date(now.getTime() - SPACE_MEMORY_LOOKBACK_MS).toISOString()}::timestamptz`,
    manual ? undefined : sql`${projectSessions.updatedAt} <= ${new Date(now.getTime() - SPACE_MEMORY_IDLE_MS).toISOString()}::timestamptz`,
    changedSinceMark,
  );
}

export interface SpaceMemoryDeps {
  /** One chat completion; `null` content with `transient` when a retry may help. */
  complete?: (model: string, authorization: string, messages: ReturnType<typeof spaceMemoryMessages>['messages']) => Promise<{ content: string | null; transient: boolean }>;
  resolveModel?: typeof resolveInternalModel;
  mintKey?: (accountId: string, projectId: string, userId: string) => Promise<{ secret: string; keyId: string }>;
  revokeKey?: (projectId: string, keyId: string) => Promise<void>;
}

async function completeViaGateway(
  model: string,
  authorization: string,
  messages: ReturnType<typeof spaceMemoryMessages>['messages'],
): Promise<{ content: string | null; transient: boolean }> {
  const url = standaloneGatewayUrl();
  if (!url) return { content: null, transient: false };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: false, max_tokens: MAX_TOKENS, response_format: { type: 'json_object' }, messages }),
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn('[space-memory] gateway returned non-200', { upstream_status: res.status, model });
      return { content: null, transient: res.status === 408 || res.status === 429 || res.status >= 500 };
    }
    const data = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: unknown } }> } | null;
    const content = data?.choices?.[0]?.message?.content;
    return { content: typeof content === 'string' ? content : null, transient: true };
  } catch (error) {
    logger.warn('[space-memory] model attempt failed', { model, error: errorMessage(error) });
    return { content: null, transient: true };
  }
}

/** The Space memory folder as a writable layer (the same shape `resolveLayer` builds for a viewer). */
function spaceLayer(projectId: string, groupId: string, name: string, drive: Layer['drive']): Layer | null {
  const folder = sessionGroupDriveFolder(groupId);
  if (!folder) return null;
  return {
    key: groupId,
    scope: 'channel',
    spaceId: null,
    name,
    projectId,
    drive,
    root: `${folder}/${MEMORY_DIR_NAME}`,
    agentFolder: null,
    skip: [],
    readOnly: false,
    canWrite: true,
    isDefault: false,
  };
}

/** The stored mark seq, as a number (0 when absent or not a number). */
/**
 * The stored seq, only when the stored time is exactly the valid one this run
 * read (`syncMarkOf`, which checks the calendar in JS: Feb 30 and month 99
 * read as unset there). Anything else (an invalid time, a time this run did
 * not read, an unset or empty time: `readAt` null) keeps no stored seq: the
 * whole mark is replaced.
 */
const storedSeq = (readAt: string | null) => readAt === null ? sql`0` : sql`CASE WHEN ${projectSessions.metadata}->>${SPACE_MEMORY_SYNCED_AT_KEY} = ${readAt} AND jsonb_typeof(${projectSessions.metadata}->${SPACE_MEMORY_SYNCED_SEQ_KEY}) = 'number'
  THEN (${projectSessions.metadata}->>${SPACE_MEMORY_SYNCED_SEQ_KEY})::numeric ELSE 0 END`;

/**
 * Move each session's mark: `seq` from what was read, `at` the update's
 * cutoff. Monotonic in the statement: the seq only ever grows and the time
 * only ever moves later (both marks are written as `toISOString()`, so their
 * text order is their time order), so an older run that finishes last never moves a
 * mark back. `updated_at` is not touched.
 */
async function advanceMarks(marks: ReadonlyArray<{ sessionId: string; seq: number; readAt: string | null }>, cutoff: Date): Promise<void> {
  for (const mark of marks) {
    await db
      .update(projectSessions)
      .set({
        metadata: sql`coalesce(${projectSessions.metadata}, '{}'::jsonb) || jsonb_build_object(
          ${SPACE_MEMORY_SYNCED_SEQ_KEY}::text, greatest(${storedSeq(mark.readAt)}, ${mark.seq}::numeric),
          ${SPACE_MEMORY_SYNCED_AT_KEY}::text, greatest(
            ${mark.readAt === null ? sql`''` : sql`coalesce(CASE WHEN ${projectSessions.metadata}->>${SPACE_MEMORY_SYNCED_AT_KEY} = ${mark.readAt} THEN ${projectSessions.metadata}->>${SPACE_MEMORY_SYNCED_AT_KEY} END, '')`},
            ${cutoff.toISOString()}::text))`,
      })
      .where(eq(projectSessions.sessionId, mark.sessionId));
  }
}

/**
 * Take the Space's lease, shared by every API process: one update at a time,
 * held from the first read to the last mark. Null when another update holds it.
 */
async function acquireLease(groupId: string): Promise<Date | null> {
  const until = new Date(Date.now() + LEASE_MS);
  const [row] = await db
    .update(projectSessionGroups)
    .set({ memoryUpdateLeaseUntil: until })
    .where(
      and(
        eq(projectSessionGroups.groupId, groupId),
        sql`(${projectSessionGroups.memoryUpdateLeaseUntil} is null or ${projectSessionGroups.memoryUpdateLeaseUntil} < now())`,
      ),
    )
    .returning({ groupId: projectSessionGroups.groupId });
  return row ? until : null;
}

/**
 * Renew the lease before a write, compare-and-set on the token: the lease is
 * still ours only while it holds the exact value we last set. 0 rows (it
 * expired and another run took it): `LeaseLost`, and this run writes nothing more.
 */
async function renewLease(lease: LeaseToken): Promise<void> {
  const until = new Date(Date.now() + LEASE_MS);
  const [row] = await db
    .update(projectSessionGroups)
    .set({ memoryUpdateLeaseUntil: until })
    .where(and(eq(projectSessionGroups.groupId, lease.groupId), eq(projectSessionGroups.memoryUpdateLeaseUntil, lease.until)))
    .returning({ groupId: projectSessionGroups.groupId });
  if (!row) throw new LeaseLost();
  lease.until = until;
}

/** Give the lease back (only our own: a lease that expired and was taken again stays), and on a failure set the job's back-off. */
async function releaseLease(groupId: string, until: Date, failed: boolean): Promise<void> {
  await db
    .update(projectSessionGroups)
    .set({ memoryUpdateLeaseUntil: null, ...(failed ? { memoryUpdateRetryAt: new Date(Date.now() + RETRY_AFTER_MS) } : {}) })
    .where(and(eq(projectSessionGroups.groupId, groupId), eq(projectSessionGroups.memoryUpdateLeaseUntil, until)));
}

/**
 * Run one update for a Space. `manual` (the route) reads sessions without
 * the idle wait and mints the key for `actorUserId`; the job mints it for
 * the Space's creator. Never throws: a failure is an outcome.
 */
export async function updateSpaceMemory(
  input: { projectId: string; groupId: string; manual: boolean; actorUserId: string | null; now?: Date },
  deps: SpaceMemoryDeps = {},
): Promise<SpaceMemoryUpdateOutcome> {
  let lease: Date | null;
  try {
    lease = await acquireLease(input.groupId);
  } catch (error) {
    logger.warn('[space-memory] lease failed', { group_id: input.groupId, error: errorMessage(error) });
    return { ok: false, reason: 'error' };
  }
  if (!lease) return { ok: false, reason: 'busy' };
  const token: LeaseToken = { groupId: input.groupId, until: lease };
  let outcome: SpaceMemoryUpdateOutcome = { ok: false, reason: 'error' };
  try {
    outcome = await runUpdate(input, deps, token);
    return outcome;
  } catch (error) {
    if (error instanceof LeaseLost) {
      logger.warn('[space-memory] lease_lost', { group_id: input.groupId });
      outcome = { ok: false, reason: 'lease_lost' };
      return outcome;
    }
    logger.warn('[space-memory] update failed', { group_id: input.groupId, error: errorMessage(error) });
    return outcome;
  } finally {
    // With the token check, a lost lease is left to whoever holds it now.
    await releaseLease(input.groupId, token.until, !outcome.ok).catch(() => {});
  }
}

async function runUpdate(
  input: { projectId: string; groupId: string; manual: boolean; actorUserId: string | null; now?: Date },
  deps: SpaceMemoryDeps,
  lease: LeaseToken,
): Promise<SpaceMemoryUpdateOutcome> {
  const cutoff = input.now ?? new Date();
  const [group] = await db
    .select()
    .from(projectSessionGroups)
    .where(and(eq(projectSessionGroups.projectId, input.projectId), eq(projectSessionGroups.groupId, input.groupId)))
    .limit(1);
  if (!group) return { ok: false, reason: 'not_found' };
  const drive = volumeOps().available() ? await findProjectDrive(input.projectId) : null;
  const layer = drive && spaceLayer(input.projectId, group.groupId, group.name, drive);
  if (!layer) return { ok: false, reason: 'drive_unavailable' };

  const candidates = await db
    .select({ sessionId: projectSessions.sessionId, createdBy: projectSessions.createdBy, metadata: projectSessions.metadata })
    .from(projectSessions)
    .where(and(eq(projectSessions.projectId, input.projectId), eq(projectSessions.groupId, group.groupId), dueSessions(cutoff, input.manual)))
    .orderBy(desc(projectSessions.updatedAt))
    .limit(SPACE_MEMORY_MAX_SESSIONS);
  if (candidates.length === 0) {
    // Nothing new to read: the memory is current as of now. The time is what "Updated …" shows.
    await renewLease(lease);
    await db.update(projectSessionGroups).set({ memoryUpdatedAt: cutoff }).where(eq(projectSessionGroups.groupId, group.groupId));
    return { ok: true as const, updatedPages: 0, sessions: 0, memoryUpdatedAt: cutoff };
  }

  const members = (
    await db.select({ userId: projectSessionGroupMembers.userId }).from(projectSessionGroupMembers).where(eq(projectSessionGroupMembers.groupId, group.groupId))
  ).map((row) => row.userId);
  const marks: Array<{ sessionId: string; seq: number; readAt: string | null }> = [];
  const read: Array<{ sessionId: string; title: string | null; text: string }> = [];
  for (const session of candidates) {
    const mark = syncMarkOf(session.metadata, cutoff);
    const owner = session.createdBy;
    if (!(await sessionOwnerSeesGroup(group, owner, !!owner && members.includes(owner), group.accountId))) {
      // Never read: its owner no longer sees the Space. The mark moves so it does not hold a slot every tick.
      marks.push({ sessionId: session.sessionId, seq: mark.seq, readAt: mark.at });
      continue;
    }
    const page = await readSessionLogPage({ sessionId: session.sessionId, threadId: null, beforeSeq: null, limit: SPACE_MEMORY_MESSAGES_PER_SESSION });
    const fresh = page && page !== 'unknown_thread' ? newSessionText(page.messages, mark.seq) : { text: '', maxSeq: mark.seq };
    marks.push({ sessionId: session.sessionId, seq: fresh.maxSeq, readAt: mark.at });
    if (fresh.text) read.push({ sessionId: session.sessionId, title: sessionTitleFromMetadata(session.metadata) || null, text: fresh.text });
  }
  if (read.length === 0) {
    await renewLease(lease);
    await advanceMarks(marks, cutoff);
    await db.update(projectSessionGroups).set({ memoryUpdatedAt: cutoff }).where(eq(projectSessionGroups.groupId, group.groupId));
    return { ok: true as const, updatedPages: 0, sessions: marks.length, memoryUpdatedAt: cutoff };
  }

  const keyUser = input.actorUserId ?? group.createdBy;
  const scope = keyUser ? { userId: keyUser, accountId: group.accountId, projectId: input.projectId } : null;
  const model = scope ? await (deps.resolveModel ?? resolveInternalModel)(scope) : null;
  if (!scope || !model) return { ok: false, reason: 'no_model' };

  const { pages: files } = await layerFiles(layer);
  const heads = await Promise.all(files.slice(0, 40).map(async (file) => ({ file, page: await headOf(layer, file) })));
  // `headOf` reads a file of at most 4 KiB whole: only such a page's body is complete.
  const index = pageIndex(heads.map(({ file, page }) => ({ path: file.rel, title: page.title, body: page.body, complete: file.size <= 4096 })));
  // The page versions the model is shown: a write only replaces the version it saw.
  const snapshot = new Map(heads.map(({ file }) => [file.rel, { mtime: file.mtime }]));
  const { messages, includedSessionIds } = spaceMemoryMessages({ spaceName: group.name, spaceDescription: group.description, pages: index, sessions: read });
  // Only the sessions the prompt holds whole move their mark; one left out by the budget is read next run.
  const left = new Set(read.map((s) => s.sessionId).filter((id) => !includedSessionIds.includes(id)));
  const sentMarks = marks.filter((mark) => !left.has(mark.sessionId));
  const sentRead = read.filter((s) => !left.has(s.sessionId));

  const mint =
    deps.mintKey ??
    (async (accountId: string, projectId: string, userId: string) => {
      const key = await createGatewayKey({ accountId, projectId, name: INTERNAL_SPACE_MEMORY_KEY_NAME, createdBy: userId });
      return { secret: key.secret_key, keyId: key.key_id };
    });
  const revoke = deps.revokeKey ?? ((projectId: string, keyId: string) => deleteGatewayKey(projectId, keyId).then(() => {}));
  const complete = deps.complete ?? completeViaGateway;
  const key = await mint(group.accountId, input.projectId, scope.userId);
  let reply: string | null = null;
  try {
    const first = await complete(model, `Bearer ${key.secret}`, messages);
    reply = first.content;
    if (!reply && first.transient) reply = (await complete(model, `Bearer ${key.secret}`, messages)).content;
  } finally {
    await revoke(input.projectId, key.keyId).catch(() => {});
  }
  // A failed call leaves every mark where it was: the next update reads the same messages.
  if (!reply) return { ok: false, reason: 'model_failed' };

  const parsed = parseSpaceMemoryReply(reply, index, sentRead.map((s) => s.sessionId));
  if (!parsed) {
    // Not the JSON shape: a failure, like a failed call. No mark moves; the next update tries again.
    logger.warn('[space-memory] reply is not the JSON shape', { group_id: group.groupId, model });
    return { ok: false, reason: 'model_failed' };
  }
  if (parsed.rejected.length) logger.info('[space-memory] pages refused', { group_id: group.groupId, rejected: parsed.rejected });
  const titles = new Map(sentRead.map((s) => [s.sessionId, s.title ?? `Session ${s.sessionId.slice(0, 8)}`]));
  let written = 0;
  const skipped: string[][] = [];
  for (const page of parsed.pages) {
    await renewLease(lease);
    try {
      const result = await writeAgentPage(layer, page.path, {
        title: page.title,
        body: page.body,
        agent: AGENT_NAME,
        sessions: page.sessions.map((sessionId) => ({ sessionId, label: titles.get(sessionId) ?? sessionId })),
      }, snapshot.get(page.path) ?? null);
      if (result !== 'conflict') written++;
      else {
        skipped.push(page.sessions);
        logger.info('[space-memory] page changed since it was read; kept as it is', { group_id: group.groupId, path: page.path });
      }
    } catch (error) {
      if (!(error instanceof MemoryError)) throw error;
      logger.info('[space-memory] page refused', { group_id: group.groupId, path: page.path, code: error.code });
    }
  }
  // A page kept for a person's edit: the sessions it came from are read again next run, so their facts still merge.
  const advanced = marksToAdvance(sentMarks, skipped);
  await renewLease(lease);
  await advanceMarks(advanced, cutoff);
  // `memory_updated_at`: when the memory was last brought up to date, whether or not this run wrote a page.
  const memoryUpdatedAt = cutoff;
  await db.update(projectSessionGroups).set({ memoryUpdatedAt }).where(eq(projectSessionGroups.groupId, group.groupId));
  logger.info('[space-memory] updated', { group_id: group.groupId, sessions: advanced.length, read: sentRead.length, left: left.size, held: sentMarks.length - advanced.length, pages: written, manual: input.manual });
  return { ok: true, updatedPages: written, sessions: advanced.length, memoryUpdatedAt };
}

/** Spaces one job tick updates, at most. */
export const SPACE_MEMORY_SPACES_PER_TICK = 5;
/** Candidate Spaces one tick reads, at most: ineligible ones are skipped (and backed off), never retried in a loop. */
export const SPACE_MEMORY_SCAN_PER_TICK = 100;

/**
 * One job tick: the Spaces with `memory_auto_update` on, no update running,
 * no back-off pending and an idle session changed after its mark, the least
 * recently updated first; at most `SPACE_MEMORY_SCAN_PER_TICK` read and
 * `SPACE_MEMORY_SPACES_PER_TICK` updated. A Space whose project has
 * `session_groups` off, and a Space whose update failed (no Drive, no model,
 * a bad reply), is backed off for 30 min, so it cannot hold the window.
 */
export async function runSpaceMemoryTick(now: Date = new Date()): Promise<{ candidates: number; updated: number; pages: number; failed: number }> {
  const groups = await db
    .select({ groupId: projectSessionGroups.groupId, projectId: projectSessionGroups.projectId })
    .from(projectSessionGroups)
    .where(
      and(
        eq(projectSessionGroups.memoryAutoUpdate, true),
        sql`(${projectSessionGroups.memoryUpdateLeaseUntil} is null or ${projectSessionGroups.memoryUpdateLeaseUntil} < now())`,
        sql`(${projectSessionGroups.memoryUpdateRetryAt} is null or ${projectSessionGroups.memoryUpdateRetryAt} < now())`,
        // The outer group id is qualified: unqualified, it would bind to the inner table (`qualifiedColumn`).
        sql`exists (select 1 from ${projectSessions} where ${projectSessions.groupId} = ${qualifiedColumn(projectSessionGroups.groupId)} and ${dueSessions(now, false)})`,
      ),
    )
    .orderBy(sql`${projectSessionGroups.memoryUpdatedAt} asc nulls first`)
    .limit(SPACE_MEMORY_SCAN_PER_TICK);
  const result = { candidates: groups.length, updated: 0, pages: 0, failed: 0 };
  const flags = new Map<string, boolean>();
  const offFlag: string[] = [];
  let done = 0;
  for (const group of groups) {
    if (done >= SPACE_MEMORY_SPACES_PER_TICK) break;
    if (!flags.has(group.projectId)) flags.set(group.projectId, await projectFeatureFlagEnabled(group.projectId, 'session_groups').catch(() => false));
    if (!flags.get(group.projectId)) {
      offFlag.push(group.groupId);
      continue;
    }
    done++;
    // A failed update sets its own back-off when it gives the lease back (`releaseLease`).
    const outcome = await updateSpaceMemory({ projectId: group.projectId, groupId: group.groupId, manual: false, actorUserId: null, now });
    if (outcome.ok) {
      result.updated++;
      result.pages += outcome.updatedPages;
    } else if (outcome.reason !== 'busy') {
      result.failed++;
      logger.info('[space-memory] space not updated', { group_id: group.groupId, reason: outcome.reason });
    }
  }
  if (offFlag.length) {
    await db
      .update(projectSessionGroups)
      .set({ memoryUpdateRetryAt: new Date(Date.now() + RETRY_AFTER_MS) })
      .where(inArray(projectSessionGroups.groupId, offFlag));
  }
  return result;
}
