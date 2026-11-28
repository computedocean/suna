import type { SessionSyncMessage } from '../session-sync/session-sync-controller';
import { getSessionCost } from './state';

export type SessionStats = {
  messageCount: number;
  cost: number;
  tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number };
  lastUpdated: number | null;
};

const EMPTY_STATS: SessionStats = {
  messageCount: 0,
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  lastUpdated: null,
};

/** The statistics of one session's whole transcript: step-finish tokens, cost and latest message time. */
export function getSessionStats(data: ReadonlyArray<SessionSyncMessage>): SessionStats {
  let input = 0,
    output = 0,
    reasoning = 0,
    cacheRead = 0,
    cacheWrite = 0;
  let lastUpdated: number | null = null;

  for (const item of data) {
    const time = item.info.time as { updated?: number; completed?: number; created?: number } | undefined;
    const ts = time?.updated ?? time?.completed ?? time?.created;
    if (typeof ts === 'number' && (!lastUpdated || ts > lastUpdated)) lastUpdated = ts;
    for (const part of item.parts) {
      if (part.type !== 'step-finish') continue;
      input += part.tokens?.input || 0;
      output += part.tokens?.output || 0;
      reasoning += part.tokens?.reasoning || 0;
      cacheRead += part.tokens?.cache?.read || 0;
      cacheWrite += part.tokens?.cache?.write || 0;
    }
  }

  return {
    messageCount: data.length,
    cost: getSessionCost(data),
    tokens: { input, output, reasoning, cacheRead, cacheWrite },
    lastUpdated,
  };
}

/** The sum of many sessions' statistics; the latest message time of them all. */
export function sumSessionStats(items: SessionStats[]): SessionStats {
  const acc: SessionStats = { ...EMPTY_STATS, tokens: { ...EMPTY_STATS.tokens } };
  for (const s of items) {
    acc.messageCount += s.messageCount;
    acc.cost += s.cost;
    acc.tokens.input += s.tokens.input;
    acc.tokens.output += s.tokens.output;
    acc.tokens.reasoning += s.tokens.reasoning;
    acc.tokens.cacheRead += s.tokens.cacheRead;
    acc.tokens.cacheWrite += s.tokens.cacheWrite;
    if (s.lastUpdated && (!acc.lastUpdated || s.lastUpdated > acc.lastUpdated)) {
      acc.lastUpdated = s.lastUpdated;
    }
  }
  return acc;
}

/** Every token of a statistics total: input, output, reasoning and both cache counters. */
export function sumSessionTokens(t: SessionStats['tokens']): number {
  return t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite;
}
