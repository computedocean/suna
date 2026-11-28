---
recorded: 2026-11-28T09:55:13Z
incident_date: 2026-11-28
---
# Keep owner-managed thread scratch directories out of age-based temp reaping

**Rule:** Exclude `kortix-tree-thread-*` from the generic age-based temp reaper. `TreeJobs` owns these directories and removes them on thread stop or sweeps them after their process dies. An idle directory's old mtime does not mean its thread is dead.

**Trigger surface:** Adding a long-lived scratch directory under `/tmp/kortix-*`, or changing a temp reaper's prefix and age rules.

**Incident:** 2026-11-28, production API v0.16.6 and v0.16.7. PR #13028 introduced reusable config-release tree threads with a scratch parent created once at initialization. The existing reaper removed that parent after 30 minutes idle. Every later archive on the same slot failed with `ENOENT mkdtemp`; the thread never initialized again.

**Enforcement:** `apps/api/src/snapshots/tmp-reaper.test.ts` ages a real tree worker's scratch parent, runs the real reaper, and archives again through the same worker. It also proves stale build directories are reclaimed and closing the pool removes its protected parent.
