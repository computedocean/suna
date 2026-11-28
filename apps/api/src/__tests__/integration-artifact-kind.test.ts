/**
 * Integration test (real local DB, real routes, fake storage): the artifact
 * `kind` the gallery tabs read. A row with no stored kind (every row from
 * before the column) shows a derived one; a publish stores the kind it names;
 * a kind that does not go with the type answers 400.
 *
 * Storage is faked at the volumes module; routes, grants and the DB are real.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { accountMembers, accounts, artifacts, projectMembers, projects } from '@kortix/db';
import { eq, sql } from 'drizzle-orm';
import * as realVolumes from '../drives/volumes';
import { config } from '../config';
import { db } from '../shared/db';
import { insertIntoView } from './helpers/compat-views';

/** The paths the fake storage holds. */
const stored = new Set<string>();

mock.module('../drives/volumes', () => ({
  ...realVolumes,
  driveStorageAvailable: () => true,
  openDriveVolume: async (name: string) => ({ name, id: 'vol', head_commit_id: null }),
  getDriveVolume: async (name: string) => ({ name, id: 'vol', head_commit_id: 'c0' }),
  writeVolumeFile: async (_v: string, path: string, body: Uint8Array) => {
    stored.add(path);
    return { path, size: body.byteLength };
  },
  writeVolumeFiles: async (_v: string, files: Array<{ path: string }>) => {
    for (const f of files) stored.add(f.path);
    return { commit_id: 'c1' };
  },
  listVolumeFiles: async () => [],
  statVolumeFile: async (_v: string, path: string) => {
    if (stored.has(path)) return { path, type: 'file', size: 1, mtime: 0, version: 'v1' };
    throw new realVolumes.DriveStorageError(404, 'not found');
  },
  readVolumeFile: async () => new Response('<title>Page</title>'),
  listVolumeCommits: async () => [],
}));
(config as { PLATINUM_API_KEY?: string }).PLATINUM_API_KEY ||= 'test-key';

const { app } = await import('../index');
const { createAccountToken } = await import('../repositories/account-tokens');
const { ensureProjectDrive } = await import('../drives/service');

const ACCOUNT = crypto.randomUUID();
const PROJECT = crypto.randomUUID();
const ALICE = crypto.randomUUID();
const metadata = { experimental: { drives: true, artifacts: true } };
const minted: string[] = [];
let key = '';
const legacy: Record<'doc' | 'page' | 'pdf', string> = { doc: crypto.randomUUID(), page: crypto.randomUUID(), pdf: crypto.randomUUID() };

async function req(method: string, path: string, body?: unknown) {
  const res = await app.request(`/v1/workspaces/${PROJECT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { status: res.status, body: parsed };
}

beforeAll(async () => {
  await db.insert(accounts).values({ accountId: ACCOUNT, name: 'artifact-kind' });
  await db.insert(projects).values({ projectId: PROJECT, accountId: ACCOUNT, name: 'Kind test', repoUrl: 'https://example.test/k.git', metadata });
  await db.execute(sql`
    insert into auth.users (id, email, instance_id, aud, role, raw_user_meta_data)
    values (${ALICE}::uuid, ${`${ALICE.slice(0, 8)}@example.test`}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}'::jsonb)`);
  await insertIntoView(db, accountMembers, [{ userId: ALICE, accountId: ACCOUNT, accountRole: 'member' as const, isSuperAdmin: false }]);
  await insertIntoView(db, projectMembers, [{ accountId: ACCOUNT, projectId: PROJECT, userId: ALICE, projectRole: 'member' as const }]);
  const token = await createAccountToken({ accountId: ACCOUNT, userId: ALICE, projectId: PROJECT, name: 'artifact-kind', agentGrant: null as any });
  minted.push(token.tokenId);
  key = token.secretKey;
  const { driveId } = await ensureProjectDrive(ACCOUNT, PROJECT);
  // Rows as every artifact from before the column: kind null.
  const base = { projectId: PROJECT, accountId: ACCOUNT, driveId, folder: true, createdByUserId: ALICE, visibility: 'project' };
  await db.insert(artifacts).values([
    { ...base, artifactId: legacy.doc, root: '/Users/a/Artifacts/memo', entry: 'index.md', title: 'Memo', type: 'doc' },
    { ...base, artifactId: legacy.page, root: '/Users/a/Artifacts/board', entry: 'index.html', title: 'Board', type: 'html' },
    { ...base, artifactId: legacy.pdf, root: '/Users/a/Artifacts/scan', entry: 'Scan.PDF', title: 'Scan', type: 'html' },
  ]);
});

afterAll(async () => {
  for (const tokenId of minted) await db.execute(sql`delete from kortix.account_tokens where token_id = ${tokenId}`);
  await db.execute(sql`delete from kortix.role_assignments where account_id = ${ACCOUNT}::uuid`);
  await db.delete(projects).where(eq(projects.accountId, ACCOUNT));
  await db.delete(accounts).where(eq(accounts.accountId, ACCOUNT));
  await db.execute(sql`delete from auth.users where id = ${ALICE}::uuid`);
});

describe('artifact kind', () => {
  test('a row with no stored kind shows the derived one: doc, pdf for a .pdf entry, else page', async () => {
    const res = await req('GET', '/artifacts');
    expect(res.status).toBe(200);
    const kinds = Object.fromEntries(res.body.artifacts.map((a: { artifact_id: string; kind: string }) => [a.artifact_id, a.kind]));
    expect(kinds[legacy.doc]).toBe('doc');
    expect(kinds[legacy.page]).toBe('page');
    expect(kinds[legacy.pdf]).toBe('pdf');
    const [row] = await db.select({ kind: artifacts.kind }).from(artifacts).where(eq(artifacts.artifactId, legacy.page));
    expect(row!.kind).toBeNull();
  });

  test('a publish with kind slides stores it and every read returns it', async () => {
    const res = await req('POST', '/artifacts', { kind: 'slides', files: { 'index.html': { content: '<title>Q3 deck</title>' } } });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('html');
    expect(res.body.kind).toBe('slides');
    const [row] = await db.select({ kind: artifacts.kind }).from(artifacts).where(eq(artifacts.artifactId, res.body.artifact_id));
    expect(row!.kind).toBe('slides');
    const again = await req('GET', `/artifacts/${res.body.artifact_id}`);
    expect(again.status).toBe(200);
    expect(again.body.kind).toBe('slides');
  });

  test('a publish without kind shows page; PATCH kind sheet marks it a sheet', async () => {
    const res = await req('POST', '/artifacts', { files: { 'index.html': { content: '<title>Pipeline</title>' } } });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('page');
    const patched = await req('PATCH', `/artifacts/${res.body.artifact_id}`, { kind: 'sheet' });
    expect(patched.status).toBe(200);
    expect(patched.body.kind).toBe('sheet');
  });

  test('a kind that does not go with the type → 400 kind_mismatch; an unknown kind → 400; nothing is written', async () => {
    const before = stored.size;
    const docAsSlides = await req('POST', '/artifacts', { kind: 'slides', files: { 'index.md': { content: '# Notes' } } });
    expect(docAsSlides.status).toBe(400);
    expect(docAsSlides.body.code).toBe('kind_mismatch');
    const pageAsDoc = await req('POST', '/artifacts', { kind: 'doc', files: { 'index.html': { content: '<title>X</title>' } } });
    expect(pageAsDoc.status).toBe(400);
    expect(pageAsDoc.body.code).toBe('kind_mismatch');
    expect(stored.size).toBe(before);
    const patchDoc = await req('PATCH', `/artifacts/${legacy.doc}`, { kind: 'sheet' });
    expect(patchDoc.status).toBe(400);
    expect(patchDoc.body.code).toBe('kind_mismatch');
    const unknown = await req('POST', '/artifacts', { kind: 'deck', files: { 'index.html': { content: '<title>X</title>' } } });
    expect(unknown.status).toBe(400);
  });
});
