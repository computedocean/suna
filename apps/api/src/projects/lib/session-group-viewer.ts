/**
 * The services half of Space access (`shared/session-group-access.ts` holds
 * the rules): the `session_groups` flag and account session oversight, which
 * `shared/` cannot read.
 */
import { projectSessions } from '@kortix/db';
import { and, eq, sql } from 'drizzle-orm';
import { projectFeatureFlagEnabled } from '../../feature-flags/for-project';
import { hasAccountSessionOversight } from '../../iam/session-oversight';
import { db } from '../../shared/db';
import { canSeeGroup, ownerSeesGroup, type GroupViewer, sessionSharedThroughGroup, sharedGroupIdsFor } from '../../shared/session-group-access';

export async function groupViewerFor(userId: string, accountId: string): Promise<GroupViewer> {
  return { userId, oversight: await hasAccountSessionOversight(userId, accountId).catch(() => false) };
}

/** `sharedGroupIdsFor` while the project's `session_groups` flag is on; empty while it is off. */
export async function sharedGroupIdsWhileOn(projectId: string, userId: string): Promise<Set<string>> {
  if (!(await projectFeatureFlagEnabled(projectId, 'session_groups'))) return new Set();
  return sharedGroupIdsFor(projectId, userId);
}

/** The session is in a Space this person sees (or is a child of a session in one), with `session_groups` on. */
export async function sessionSharedThroughSpace(projectId: string, userId: string, sessionId: string): Promise<boolean> {
  if (!(await projectFeatureFlagEnabled(projectId, 'session_groups'))) return false;
  const [row] = await db
    .select({ groupId: projectSessions.groupId, parentSessionId: projectSessions.parentSessionId, metadata: projectSessions.metadata })
    .from(projectSessions)
    .where(and(eq(projectSessions.sessionId, sessionId), eq(projectSessions.projectId, projectId)))
    .limit(1);
  return row ? sessionSharedThroughGroup(projectId, userId, row) : false;
}

/**
 * The owner of a session filed in a Space still sees the Space (`ownerSeesGroup`).
 * A session no person started (`ownerId` null: a trigger, a backend caller)
 * has nobody to remove, so it keeps its Space. Account session oversight is
 * read only when membership does not already decide it.
 */
export async function sessionOwnerSeesGroup(
  group: { visibility: string; createdBy: string | null },
  ownerId: string | null,
  ownerIsMember: boolean,
  accountId: string | null,
  oversight: (userId: string, accountId: string) => Promise<boolean> = (userId, account) =>
    hasAccountSessionOversight(userId, account).catch(() => false),
): Promise<boolean> {
  return ownerSeesGroup(group, ownerId, ownerIsMember, async () => !!ownerId && !!accountId && (await oversight(ownerId, accountId)));
}

/**
 * May a turn of a session filed in a Space read the Space (its brief and
 * memory list)? Its owner must still see it (`sessionOwnerSeesGroup`), and so
 * must the person prompting the turn. A turn with no person behind it
 * (`prompterId` null: sandbox-authored, an automation) and the owner's own
 * turn take the owner rule alone.
 */
export async function turnSeesGroup(
  group: { visibility: string; createdBy: string | null },
  who: { ownerId: string | null; ownerIsMember: boolean; prompterId: string | null; prompterIsMember: boolean; accountId: string | null },
  oversight: (userId: string, accountId: string) => Promise<boolean> = (userId, account) =>
    hasAccountSessionOversight(userId, account).catch(() => false),
): Promise<boolean> {
  if (!(await sessionOwnerSeesGroup(group, who.ownerId, who.ownerIsMember, who.accountId, oversight))) return false;
  if (!who.prompterId || who.prompterId === who.ownerId) return true;
  return sessionOwnerSeesGroup(group, who.prompterId, who.prompterIsMember, who.accountId, oversight);
}

/**
 * `space_session_private`. The invariant: a session whose Space is private
 * (its own group, or for a child its parent's) is private to its owner. The
 * Space shares it with the Space's members; sharing it further, or filing an
 * already shared session into a private Space, would hand the Space's folder
 * and memory to people who do not see the Space. A Space that turns private
 * later only narrows: its shared sessions lose the Space mount
 * (`spaceFolderMountable`, enforced after the sharing change).
 */
export const SPACE_SESSION_PRIVATE = {
  error: 'This session is in a private Space. Move it out of the Space, or share the Space with the workspace, to share it.',
  code: 'space_session_private',
} as const;

/**
 * The private Space a session is in (its own group, or for a child its
 * parent's: the coalesce `sessionGroupOf` uses), with `session_groups` on;
 * null for none, a project-visible Space, or the flag off.
 */
export async function privateSpaceOfSession(projectId: string, sessionId: string): Promise<string | null> {
  const rows = (await db.execute(sql`
    SELECT g.group_id
      FROM kortix.project_sessions s
      LEFT JOIN kortix.project_sessions p
        ON p.project_id = s.project_id
       AND p.session_id = coalesce(s.parent_session_id, s.metadata->>'spawned_by_session')
      JOIN kortix.project_session_groups g
        ON g.project_id = s.project_id
       AND g.group_id = coalesce(s.group_id, p.group_id)
     WHERE s.session_id = ${sessionId} AND s.project_id = ${projectId} AND g.visibility = 'private'
     LIMIT 1
  `)) as unknown as Array<{ group_id: string }>;
  if (!rows[0]) return null;
  return (await projectFeatureFlagEnabled(projectId, 'session_groups')) ? rows[0].group_id : null;
}

/**
 * The sharing a new session gets from the private-Space rule
 * (`SPACE_SESSION_PRIVATE`): `inPrivateSpace` when it is filed into a private
 * Space or is a child of a session in one; `asked` is the sharing the caller
 * named or a channel implies (null: none). Refused when something beyond
 * private was asked; made private when nothing was; null: the rule says nothing.
 */
export function privateSpaceCreateSharing(inPrivateSpace: boolean, asked: string | null): 'refuse' | 'private' | null {
  if (!inPrivateSpace) return null;
  return asked !== null && asked !== 'private' ? 'refuse' : 'private';
}
