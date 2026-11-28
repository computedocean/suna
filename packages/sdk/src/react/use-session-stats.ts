'use client';

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { loadSessionExportMessages } from '../browser/session-sync/session-sync-registry';
import { getSessionStats, sumSessionStats, type SessionStats } from '../core/turns/session-stats';

/** One session's statistics: its transcript from the runtime only (a failed read throws), cached per runtime id. */
export function sessionStatsQueryOptions(runtimeId: string | null, sessionId: string, enabled: boolean) {
  return {
    queryKey: ['kortix-session-stats', runtimeId, sessionId],
    queryFn: async () => getSessionStats(await loadSessionExportMessages(sessionId)),
    enabled: enabled && !!runtimeId && !!sessionId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  };
}

/** The totals of the sessions read so far, and whether any of them still loads. */
export function sessionStatsTotals(queries: ReadonlyArray<{ data: SessionStats | undefined; isLoading: boolean }>) {
  const items: SessionStats[] = [];
  for (const q of queries) if (q.data) items.push(q.data);
  return { totals: sumSessionStats(items), loading: queries.some((q) => q.isLoading) };
}

/** Token and cost totals of many sessions on one runtime; without a `runtimeId` nothing is read. */
export function useSessionStatsTotals(runtimeId: string | null, sessionIds: string[], enabled: boolean = true) {
  const queries = useQueries({ queries: sessionIds.map((id) => sessionStatsQueryOptions(runtimeId, id, enabled)) });
  return useMemo(() => sessionStatsTotals(queries), [queries]);
}
