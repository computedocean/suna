import { afterEach, expect, mock, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TreeJobs } from '../config-releases/tree-jobs';

mock.module('../lib/logger', () => ({ logger: { info() {}, warn() {} } }));
mock.module('../projects/git/mirror', () => ({
  reapGitCacheOverBudget: async () => ({ totalBytes: 0, deleted: 0, freedBytes: 0 }),
}));
const { runTmpReaperSweep } = await import('./tmp-reaper');

const originalTmpdir = process.env.TMPDIR;
let root: string | undefined;
let jobs: TreeJobs | undefined;
afterEach(async () => {
  await jobs?.close();
  if (originalTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpdir;
  if (root) await rm(root, { recursive: true, force: true });
});

test('an idle tree thread can archive after temp reaping, while stale build contexts are reclaimed', async () => {
  root = await mkdtemp(join(tmpdir(), 'tmp-reaper-test-'));
  process.env.TMPDIR = root;
  const repo = join(root, 'repo');
  await mkdir(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  await writeFile(join(repo, 'agent.md'), 'synthetic agent\n');
  git('add', '.');
  const treeId = git('write-tree');
  jobs = new TreeJobs({
    threads: 1,
    env: { PATH: process.env.PATH },
    objects: { ensureObjects: async () => 0, ensureCommitTrees: async () => undefined, faultIn: async () => false },
  });
  const before = await jobs.run('synthetic-project', 'archive', { mirror: repo, treeId });
  const scratchName = (await readdir(root)).find((name) => name.startsWith('kortix-tree-thread-'));
  if (!scratchName) throw new Error('tree thread did not create its scratch directory');
  const scratch = join(root, scratchName);
  const staleBuild = join(root, 'kortix-build-stale');
  const freshBuild = join(root, 'kortix-build-fresh');
  const unrelated = join(root, 'other-stale');
  for (const path of [staleBuild, freshBuild, unrelated]) await mkdir(path);
  const old = new Date(Date.now() - 31 * 60 * 1000);
  for (const path of [scratch, staleBuild, unrelated]) await utimes(path, old, old);

  await runTmpReaperSweep();

  // Exercise the same real worker slot again: before the fix this throws ENOENT mkdtemp.
  expect(await jobs.run('synthetic-project', 'archive', { mirror: repo, treeId })).toEqual(before);
  expect((await stat(scratch)).isDirectory()).toBe(true);
  expect(await stat(staleBuild).catch(() => null)).toBeNull();
  expect((await stat(freshBuild)).isDirectory()).toBe(true);
  expect((await stat(unrelated)).isDirectory()).toBe(true);
  await jobs.close();
  expect(await stat(scratch).catch(() => null)).toBeNull();
});
