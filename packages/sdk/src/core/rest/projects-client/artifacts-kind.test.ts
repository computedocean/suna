import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { configureKortix } from '../../http/config';
import { createArtifact, saveArtifact, shareArtifactPath, updateArtifact, type Artifact, type ArtifactKind } from './artifacts';

const originalFetch = globalThis.fetch;
let calls: { url: string; method: string; body: unknown }[] = [];
let reply: unknown = {};

beforeEach(() => {
  calls = [];
  configureKortix({ backendUrl: 'http://test.local', getToken: async () => 'tok' });
  globalThis.fetch = mock(async (url: unknown, opts: { method?: string; body?: string } = {}) => {
    calls.push({ url: String(url), method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const last = () => calls[calls.length - 1]!;
const BASE = 'http://test.local/workspaces/p1/artifacts';

test('publish, share, save and update send the kind the caller names', async () => {
  const kind: ArtifactKind = 'slides';
  await createArtifact('p1', { kind, files: { 'index.html': { content: '<title>Deck</title>' } } });
  expect(last()).toMatchObject({ method: 'POST', url: BASE, body: { kind: 'slides' } });
  await shareArtifactPath('p1', { path: '/Users/a/Artifacts/table', kind: 'sheet' });
  expect(last()).toMatchObject({ method: 'POST', url: `${BASE}/share`, body: { kind: 'sheet' } });
  await saveArtifact('p1', 'a1', { kind: 'page', files: {} });
  expect(last()).toMatchObject({ method: 'PUT', url: `${BASE}/a1`, body: { kind: 'page' } });
  await updateArtifact('p1', 'a1', { kind: 'pdf' });
  expect(last()).toMatchObject({ method: 'PATCH', url: `${BASE}/a1`, body: { kind: 'pdf' } });
});

test('an artifact carries the kind the server resolved; an older server omits it', async () => {
  reply = { artifact_id: 'a1', kind: 'sheet' };
  const updated: Artifact = await updateArtifact('p1', 'a1', {});
  expect(updated.kind).toBe('sheet');
  reply = { artifact_id: 'a1' };
  const older: Artifact = await updateArtifact('p1', 'a1', {});
  expect(older.kind).toBeUndefined();
});
