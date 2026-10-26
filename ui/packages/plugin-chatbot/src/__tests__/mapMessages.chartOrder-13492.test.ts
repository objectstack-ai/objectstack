/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13492 — the mapper keeps WHERE each `data-chart` part arrived
 * among the text parts.
 *
 * It joins every text part into one `content` and lifts every chart into one
 * `charts[]`, and that flattening is what put a chart the model drew first
 * below all of its analysis. Each chart now carries `textOffset`: the length of
 * the joined text the stream produced before it. The bubble's half is pinned
 * in `ChatbotEnhanced.chartOrder-13492.test.tsx`.
 */
import { describe, expect, it } from 'vitest';
import { uiMessageToChatMessage, uiMessagesToChatMessages } from '../mapMessages';

const chartPart = (id: string, title: string) => ({
  type: 'data-chart',
  id,
  data: {
    type: 'chart',
    chartType: 'bar',
    title,
    xAxisKey: 'segment',
    series: [{ dataKey: 'count' }],
    data: [{ segment: 'healthy', count: 12 }],
  },
});

describe('data-chart parts keep their place among the text parts (objectui#13492)', () => {
  it('a chart drawn before any text sits at offset 0', () => {
    const out = uiMessageToChatMessage({
      id: 'a1',
      role: 'assistant',
      parts: [chartPart('c0', 'Customer health'), { type: 'text', text: 'Most customers are healthy.' }],
    });
    expect(out.content).toBe('Most customers are healthy.');
    expect(out.charts?.map((c) => [c.title, c.textOffset])).toEqual([['Customer health', 0]]);
  });

  it('text, chart, text: the chart sits where the first text part ends', () => {
    const intro = 'Here is the breakdown.\n\n';
    const out = uiMessageToChatMessage({
      id: 'a2',
      role: 'assistant',
      parts: [
        { type: 'text', text: intro },
        chartPart('c0', 'Customer health'),
        { type: 'text', text: 'Three accounts need attention.' },
      ],
    });
    expect(out.content).toBe(`${intro}Three accounts need attention.`);
    expect(out.charts?.[0]?.textOffset).toBe(intro.length);
    expect(out.content.slice(0, out.charts?.[0]?.textOffset)).toBe(intro);
  });

  it('counts only text parts: tool, step and reasoning parts between them add nothing', () => {
    const out = uiMessageToChatMessage({
      id: 'a3',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'text', text: 'Looking at your accounts. ' },
        { type: 'reasoning', text: 'The user wants a segment view.' },
        { type: 'tool-query_records', toolCallId: 't1', state: 'output-available', output: { rows: 40 } },
        { type: 'text', text: 'Charting them now.' },
        { type: 'tool-visualize_data', toolCallId: 't2', state: 'output-available', output: { ok: true } },
        chartPart('c0', 'Customer health'),
        { type: 'step-start' },
        chartPart('c1', 'Revenue by region'),
        { type: 'text', text: ' Two findings stand out.' },
      ],
    });
    const before = 'Looking at your accounts. Charting them now.';
    expect(out.content).toBe(`${before} Two findings stand out.`);
    expect(out.charts?.map((c) => c.textOffset)).toEqual([before.length, before.length]);
  });

  it('a chart that arrives after all the text sits at the end of the content', () => {
    const out = uiMessageToChatMessage({
      id: 'a4',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Here you go:' }, chartPart('c0', 'Customer health')],
    });
    expect(out.charts?.[0]?.textOffset).toBe(out.content.length);
  });

  it('a legacy string `content` is not built from the parts, so its charts carry no offset', () => {
    const out = uiMessageToChatMessage({
      id: 'a5',
      role: 'assistant',
      content: 'Legacy text.',
      parts: [chartPart('c0', 'Customer health'), { type: 'text', text: 'ignored' }],
    });
    expect(out.content).toBe('Legacy text.');
    expect(out.charts).toHaveLength(1);
    expect(out.charts?.[0]).not.toHaveProperty('textOffset');
  });

  it('re-mapping a restored message (same parts) yields the same placement', () => {
    const stored = {
      id: 'a6',
      role: 'assistant' as const,
      parts: [
        chartPart('c0', 'Customer health'),
        { type: 'text', text: 'Most customers are healthy. ' },
        chartPart('c1', 'Revenue by region'),
        { type: 'text', text: 'The east region leads.' },
      ],
    };
    const live = uiMessagesToChatMessages([stored], { isStreaming: true })[0];
    const restored = uiMessagesToChatMessages([JSON.parse(JSON.stringify(stored))])[0];
    const placement = (m: typeof live) => m.charts?.map((c) => [c.title, c.textOffset]);
    expect(placement(live)).toEqual([
      ['Customer health', 0],
      ['Revenue by region', 'Most customers are healthy. '.length],
    ]);
    expect(placement(restored)).toEqual(placement(live));
    expect(restored.content).toBe(live.content);
  });
});
