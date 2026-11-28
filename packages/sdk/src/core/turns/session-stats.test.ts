import { describe, expect, test } from 'bun:test';
import type { Message, Part } from '../runtime/runtime-types';
import { getSessionCost, getSessionStats, sumSessionStats, sumSessionTokens, type SessionStats } from './index';

const user = (id: string, created: number): Message => ({
  id,
  sessionID: 'ses_1',
  role: 'user',
  time: { created },
  agent: 'build',
  model: { providerID: 'anthropic', modelID: 'claude' },
});

const assistant = (id: string, time: { created: number; completed?: number }): Message => ({
  id,
  sessionID: 'ses_1',
  role: 'assistant',
  time,
  modelID: 'claude',
  providerID: 'anthropic',
  mode: 'build',
  agent: 'build',
  path: { cwd: '/workspace', root: '/workspace' },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
});

const stepFinish = (id: string, cost: number, tokens: { input: number; output: number; reasoning: number; read: number; write: number }): Part => ({
  id,
  sessionID: 'ses_1',
  messageID: 'm',
  type: 'step-finish',
  reason: 'stop',
  cost,
  tokens: { input: tokens.input, output: tokens.output, reasoning: tokens.reasoning, cache: { read: tokens.read, write: tokens.write } },
});

const text = (id: string): Part => ({ id, sessionID: 'ses_1', messageID: 'm', type: 'text', text: 'hello' });

const stats = (overrides: Partial<SessionStats>): SessionStats => ({
  messageCount: 0,
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  lastUpdated: null,
  ...overrides,
});

describe('getSessionStats', () => {
  test('an empty transcript is all zeros and no timestamp', () => {
    expect(getSessionStats([])).toEqual(stats({}));
  });

  test('sums all five token fields of every step-finish part, across roles, and ignores other parts', () => {
    const messages = [
      { info: user('u1', 10), parts: [text('t1')] },
      {
        info: assistant('a1', { created: 20, completed: 30 }),
        parts: [text('t2'), stepFinish('s1', 0.25, { input: 1, output: 2, reasoning: 3, read: 4, write: 5 }), stepFinish('s2', 0.5, { input: 10, output: 20, reasoning: 30, read: 40, write: 50 })],
      },
      { info: user('u2', 40), parts: [stepFinish('s3', 0, { input: 100, output: 0, reasoning: 0, read: 0, write: 0 })] },
    ];
    const result = getSessionStats(messages);
    expect(result.messageCount).toBe(3);
    expect(result.tokens).toEqual({ input: 111, output: 22, reasoning: 33, cacheRead: 44, cacheWrite: 55 });
    expect(result.lastUpdated).toBe(40);
    // The cost is the SDK's own session cost of the same transcript, unchanged.
    expect(result.cost).toBe(getSessionCost(messages));
    expect(result.cost).toBeGreaterThan(0);
  });

  test('a completed time wins over created, and the latest message time is kept', () => {
    expect(getSessionStats([{ info: assistant('a1', { created: 50, completed: 90 }), parts: [] }, { info: user('u1', 70), parts: [] }]).lastUpdated).toBe(90);
    expect(getSessionStats([{ info: assistant('a1', { created: 50 }), parts: [] }]).lastUpdated).toBe(50);
  });
});

describe('sumSessionStats', () => {
  test('no sessions is all zeros and no timestamp', () => {
    expect(sumSessionStats([])).toEqual(stats({}));
  });

  test('adds every count and keeps the latest timestamp', () => {
    const a = stats({ messageCount: 2, cost: 0.5, tokens: { input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 }, lastUpdated: 100 });
    const b = stats({ messageCount: 3, cost: 0.25, tokens: { input: 10, output: 20, reasoning: 30, cacheRead: 40, cacheWrite: 50 }, lastUpdated: 50 });
    const c = stats({ messageCount: 1 });
    expect(sumSessionStats([a, b, c])).toEqual(
      stats({ messageCount: 6, cost: 0.75, tokens: { input: 11, output: 22, reasoning: 33, cacheRead: 44, cacheWrite: 55 }, lastUpdated: 100 }),
    );
  });

  test('never mutates its inputs', () => {
    const a = stats({ messageCount: 1, tokens: { input: 1, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 } });
    sumSessionStats([a, a]);
    expect(a).toEqual(stats({ messageCount: 1, tokens: { input: 1, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 } }));
    expect(sumSessionStats([])).toEqual(stats({}));
  });
});

test('sumSessionTokens adds the five token fields', () => {
  expect(sumSessionTokens({ input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 })).toBe(15);
});
