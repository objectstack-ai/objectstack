// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#25908 — an assistant answer's chart is still there after a
 * reload, from either place a reload restores a conversation from:
 *
 *  - Server history: rows → `toUIMessages` (merges the `visualize_data` result
 *    onto its call part) → `hydratedMessagesToChatMessages`. The stream's
 *    `data-chart` part was never stored; the result's `chart` key was.
 *  - Cache fallback: the live map → `sanitizeChatMessagesForCache` → JSON →
 *    `hydratedMessagesToChatMessages`.
 *
 * The reference is the chart the live mapper draws from the streamed part, so
 * "restored" means the same title, series labels and every row. The reader and
 * the API-mode round trip are pinned in plugin-chatbot's
 * `mapMessages.persistedChart-25908.test.ts` and
 * `useObjectChat.persistedChart-25908.test.tsx`.
 */
import { describe, expect, it } from 'vitest';
import { uiMessageToChatMessage } from '@object-ui/plugin-chatbot';
import { hydratedMessagesToChatMessages } from '../AiChatPage';
import { sanitizeChatMessagesForCache, toUIMessages } from '../../../hooks/useChatConversation';

const ROWS = Array.from({ length: 30 }, (_, i) => ({ stage: `stage_${i}`, amount: i * 10 }));

const DESCRIPTOR = {
  type: 'chart',
  chartType: 'bar',
  title: 'Pipeline by stage',
  data: ROWS,
  xAxisKey: 'stage',
  series: [{ dataKey: 'amount', label: 'Amount' }],
};

const resultString = (withChart: boolean) =>
  JSON.stringify({
    rendered: 'chart',
    chartType: 'bar',
    object: 'opportunity',
    dimension: 'stage',
    measures: ['amount'],
    categories: 30,
    rows: ROWS.slice(0, 20),
    ...(withChart ? { chart: DESCRIPTOR } : {}),
  });

const INTRO = 'Here is the pipeline.\n\n';
const AFTER = 'Most of it sits in the late stages.';

/** The chart the live stream draws: the reference a restored chart must equal. */
const LIVE_CHART = uiMessageToChatMessage({
  id: 'live',
  role: 'assistant',
  parts: [{ type: 'data-chart', id: 'chart-0', data: DESCRIPTOR }],
}).charts![0];

/** The stored turn, as the server persists it: the call, then its result row. */
function serverHistory(withChart: boolean) {
  return toUIMessages([
    { id: 'u1', role: 'user', content: 'Show me the pipeline' },
    {
      id: 'a1',
      role: 'assistant',
      content: [
        { type: 'text', text: INTRO },
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'visualize_data', input: {} },
        { type: 'text', text: AFTER },
      ],
    },
    {
      id: 't1',
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'visualize_data',
          output: { type: 'text', value: resultString(withChart) },
        },
      ],
    },
  ]);
}

describe('a reloaded answer keeps its chart (objectstack#25908)', () => {
  it('server history: the persisted chart comes back, between the text it sat between', () => {
    const [, answer] = hydratedMessagesToChatMessages(serverHistory(true));
    expect(answer.content).toBe(`${INTRO}${AFTER}`);
    expect(answer.charts).toEqual([{ ...LIVE_CHART, textOffset: INTRO.length }]);
    expect(answer.charts?.[0]?.data).toHaveLength(30);
  });

  it('server history: a result persisted before the chart key gets no chart, and does not throw', () => {
    const [, answer] = hydratedMessagesToChatMessages(serverHistory(false));
    expect(answer.content).toBe(`${INTRO}${AFTER}`);
    expect(answer.charts).toBeUndefined();
    expect(answer.toolInvocations?.map((t) => t.toolName)).toEqual(['visualize_data']);
  });

  it('cache fallback: the live answer is cached and restored with its chart in place', () => {
    const live = uiMessageToChatMessage({
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'text', text: INTRO },
        { type: 'data-chart', id: 'chart-0', data: DESCRIPTOR },
        {
          type: 'tool-visualize_data',
          toolCallId: 'call_1',
          state: 'output-available',
          input: {},
          output: { type: 'text', value: resultString(true) },
        },
        { type: 'text', text: AFTER },
      ],
    });
    const cached = JSON.parse(JSON.stringify(sanitizeChatMessagesForCache([live])));
    const [restored] = hydratedMessagesToChatMessages(cached);
    expect(restored.content).toBe(`${INTRO}${AFTER}`);
    expect(restored.charts).toEqual([{ ...LIVE_CHART, textOffset: INTRO.length }]);
  });

  it('cache fallback: a restored server answer is re-cached without losing the chart', () => {
    const [, answer] = hydratedMessagesToChatMessages(serverHistory(true));
    const cached = JSON.parse(JSON.stringify(sanitizeChatMessagesForCache([answer])));
    const [restored] = hydratedMessagesToChatMessages(cached);
    expect(restored.charts).toEqual(answer.charts);
    expect(restored.content).toBe(answer.content);
  });
});
