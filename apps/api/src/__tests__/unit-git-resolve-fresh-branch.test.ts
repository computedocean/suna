/**
 * A branch pushed straight to the upstream, or through another API process,
 * is not in this process's mirror until its next refresh. On dev,
 * `kortix evals run --ref <session branch>` right after `git push` answered
 * 422 "does not resolve to a commit". `resolveCommitSha(…, true)` asks the
 * remote for the ref, so the evals service resolves it before refusing.
 * Real local git repositories, no network.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const { resolveCommitSha } = await import('../projects/git/commits');

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t.t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t.t' },
  });
  return stdout.trim();
}

describe('resolveCommitSha on a branch the mirror has not fetched yet', () => {
  test('the cached read refuses it; a read that asks the remote resolves the branch and its sha', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'mirror-fresh-'));
    const upstream = join(workdir, 'upstream');
    await mkdir(upstream, { recursive: true });
    await git(['init', '-b', 'main'], upstream);
    await writeFile(join(upstream, 'README.md'), '# hi\n');
    await git(['add', '.'], upstream);
    await git(['commit', '-m', 'init'], upstream);

    const project = {
      projectId: 'dddddddd-0000-0000-0000-0000000000f1',
      repoUrl: upstream,
      defaultBranch: 'main',
      manifestPath: '',
      gitAuthToken: 'caller-supplied-token',
    } as never;

    const prevCacheDir = process.env.KORTIX_GIT_CACHE_DIR;
    process.env.KORTIX_GIT_CACHE_DIR = join(workdir, 'cache');
    try {
      await resolveCommitSha(project, 'main');

      // A session pushes its branch; this process is not told.
      await git(['checkout', '-b', 'session-branch'], upstream);
      await writeFile(join(upstream, 'evals.md'), 'refunds\n');
      await git(['add', '.'], upstream);
      await git(['commit', '-m', 'evals'], upstream);
      const pushed = await git(['rev-parse', 'HEAD'], upstream);

      await expect(resolveCommitSha(project, 'session-branch')).rejects.toThrow();
      expect(await resolveCommitSha(project, 'session-branch', true)).toBe(pushed);

      await git(['commit', '--allow-empty', '-m', 'second'], upstream);
      const second = await git(['rev-parse', 'HEAD'], upstream);
      expect(await resolveCommitSha(project, second, true)).toBe(second);
    } finally {
      process.env.KORTIX_GIT_CACHE_DIR = prevCacheDir;
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
