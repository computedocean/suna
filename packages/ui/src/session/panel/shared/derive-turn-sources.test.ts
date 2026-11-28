import type { ToolPart } from '../../../internal/session-types';
import { toolCallBlock, type ToolCallBlock } from '@kortix/sdk';
import { describe, expect, it } from 'bun:test';
import { deriveTurnSources } from './derive-panels';

let n = 0;
function call(
  tool: string,
  input: Record<string, unknown>,
  output = '',
  status: 'completed' | 'error' = 'completed',
): ToolCallBlock {
  n += 1;
  return toolCallBlock({
    type: 'tool',
    tool,
    callID: `c-${n}`,
    state: { status, input, output },
  } as unknown as ToolPart);
}

const search = (results: Array<Record<string, unknown>>) =>
  call('web_search', { query: 'edge ai' }, JSON.stringify({ query: 'edge ai', results }));

describe('deriveTurnSources', () => {
  it('lists every search result with its domain, title and excerpt, in order', () => {
    const sources = deriveTurnSources([
      search([
        { title: 'Edge AI survey', url: 'https://www.arxiv.org/abs/1', content: '  A survey\n of   edge AI. ' },
        { title: 'Digital twins', url: 'https://ieeexplore.ieee.org/doc/2' },
      ]),
    ]);
    expect(sources).toEqual([
      { url: 'https://www.arxiv.org/abs/1', title: 'Edge AI survey', domain: 'arxiv.org', snippet: 'A survey of edge AI.' },
      { url: 'https://ieeexplore.ieee.org/doc/2', title: 'Digital twins', domain: 'ieeexplore.ieee.org', snippet: undefined },
    ]);
  });

  it('a page a search found and a fetch opened is one source that keeps the excerpt', () => {
    const sources = deriveTurnSources([
      call('web_fetch', { url: 'http://example.com/post/' }),
      search([{ title: 'The post', url: 'https://example.com/post', content: 'Excerpt.' }]),
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ domain: 'example.com', snippet: 'Excerpt.' });
  });

  it('adds nothing for a failed call, a bare query, a non-web tool or a non-http URL', () => {
    expect(
      deriveTurnSources([
        call('web_fetch', { url: 'https://failed.example' }, 'Error: 403', 'error'),
        call('web_search', { query: 'nothing parsed' }, 'no results'),
        call('bash', { command: 'curl https://example.com' }),
        search([{ title: 'Script', url: 'javascript:alert(1)' }]),
      ]),
    ).toEqual([]);
  });
});
