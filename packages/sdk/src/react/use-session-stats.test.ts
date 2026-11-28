import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureKortix, platformConfig } from '../core/http/config';
import { setCurrentRuntime } from '../core/session/current-runtime';
import { getSessionCost } from '../core/turns';
import { loadSessionExportMessages } from '../browser/session-sync/session-sync-registry';
import { sessionStatsQueryOptions, sessionStatsTotals } from './use-session-stats';

/**
 * The project statistics read each session's whole transcript from the bound runtime and sum
 * it. No React renderer exists in this package, so the query options and the totals of the
 * query results are asserted directly.
 */
const base = 'http://stats.test';
const previousConfig = platformConfig();
const originalFetch = globalThis.fetch;
let runtimeRows: unknown[] = [];
let runtimeStatus = 200;
let calls: string[] = [];

beforeEach(() => {
  runtimeRows = [];
  runtimeStatus = 200;
  calls = [];
  configureKortix({ backendUrl: base, getToken: async () => 'tok' }, { global: true });
  setCurrentRuntime(`${base}/runtime`, 'sbx-1');
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
    calls.push(input instanceof Request ? input.url : String(input));
    return Response.json(runtimeRows, { status: runtimeStatus });
  }, { preconnect: originalFetch.preconnect });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  setCurrentRuntime(null);
  configureKortix(previousConfig, { global: true });
});

describe('sessionStatsQueryOptions', () => {
  test('keys the cache by runtime and session, and keeps the 30 s stale time and 60 s poll', () => {
    const options = sessionStatsQueryOptions('sbx-1', 'ses_a', true);
    expect(options.queryKey).toEqual(['kortix-session-stats', 'sbx-1', 'ses_a']);
    expect(options.staleTime).toBe(30_000);
    expect(options.refetchInterval).toBe(60_000);
    expect(options.enabled).toBe(true);
  });

  test('another runtime is another cache entry', () => {
    expect(sessionStatsQueryOptions('sbx-2', 'ses_a', true).queryKey).not.toEqual(sessionStatsQueryOptions('sbx-1', 'ses_a', true).queryKey);
  });

  test('disabled by the caller, without a runtime or without a session id', () => {
    expect(sessionStatsQueryOptions('sbx-1', 'ses_a', false).enabled).toBe(false);
    expect(sessionStatsQueryOptions(null, 'ses_a', true).enabled).toBe(false);
    expect(sessionStatsQueryOptions('sbx-1', '', true).enabled).toBe(false);
  });

  test('reads the runtime transcript and projects it: absent counters are zero, updated wins over completed and created', async () => {
    runtimeRows = [
      { info: { id: 'u1', sessionID: 'ses_a', role: 'user', time: { created: 10 } }, parts: [{ id: 'p1', type: 'text', text: 'hi' }] },
      {
        info: { id: 'a1', sessionID: 'ses_a', role: 'assistant', modelID: 'claude', providerID: 'anthropic', time: { created: 20, completed: 30, updated: 99 } },
        parts: [
          { id: 'p2', type: 'step-finish', cost: 0.5, tokens: { input: 7, output: 3 } },
          { id: 'p3', type: 'step-finish' },
          { id: 'p4', type: 'step-finish', cost: 0.25, tokens: { input: 1, output: 1, reasoning: 2, cache: { read: 4 } } },
        ],
      },
      { info: { id: 'a2', sessionID: 'ses_a', role: 'assistant', modelID: 'claude', providerID: 'anthropic' }, parts: [] },
    ];
    const stats = await sessionStatsQueryOptions('sbx-1', 'ses_a', true).queryFn();
    expect(stats).toEqual({
      messageCount: 3,
      cost: getSessionCost(await loadSessionExportMessages('ses_a')),
      tokens: { input: 8, output: 4, reasoning: 2, cacheRead: 4, cacheWrite: 0 },
      lastUpdated: 99,
    });
    expect(stats.cost).toBeGreaterThan(0);
    expect(calls.every((url) => url.startsWith(`${base}/runtime/`))).toBe(true);
  });

  test('a failed runtime read throws: no partial totals and no other transcript source', async () => {
    runtimeStatus = 500;
    await expect(sessionStatsQueryOptions('sbx-1', 'ses_a', true).queryFn()).rejects.toThrow();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((url) => url.startsWith(`${base}/runtime/`))).toBe(true);
  });
});

describe('sessionStatsTotals', () => {
  const one = { messageCount: 2, cost: 0.5, tokens: { input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 }, lastUpdated: 100 };
  const two = { messageCount: 1, cost: 0.25, tokens: { input: 10, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, lastUpdated: 200 };

  test('sums the sessions that have data and reports loading while any query loads', () => {
    expect(sessionStatsTotals([{ data: one, isLoading: false }, { data: undefined, isLoading: true }, { data: two, isLoading: false }])).toEqual({
      totals: { messageCount: 3, cost: 0.75, tokens: { input: 11, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 }, lastUpdated: 200 },
      loading: true,
    });
  });

  test('a failed or disabled query adds nothing and does not load', () => {
    expect(sessionStatsTotals([{ data: undefined, isLoading: false }, { data: one, isLoading: false }])).toEqual({ totals: one, loading: false });
  });

  test('no sessions: empty totals, not loading', () => {
    expect(sessionStatsTotals([])).toEqual({
      totals: { messageCount: 0, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, lastUpdated: null },
      loading: false,
    });
  });
});
