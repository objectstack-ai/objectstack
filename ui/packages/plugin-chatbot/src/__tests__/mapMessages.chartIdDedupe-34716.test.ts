/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34716 — a reloaded answer draws a redrawn chart once.
 *
 * When the model redraws a chart, the live stream replaces the `data-chart`
 * part in place, so the answer shows one chart. After a reload only the
 * `visualize_data` results remain, one per draw; the producer writes a
 * top-level `chartId` beside `chart`, and a redraw repeats the id of the chart
 * it replaces. Within one message, results sharing a `chartId` are one chart:
 * the last descriptor, at the first result's offset. Results without a
 * `chartId` are read exactly as before, and nothing is merged across messages.
 */
import { describe, expect, it } from 'vitest';
import { VISUALIZE_DATA_TOOL, chartsFromParts, uiMessageToChatMessage } from '../mapMessages';

const descriptor = (title: string, amount: number) => ({
  type: 'chart',
  chartType: 'bar',
  title,
  data: [{ stage: 'won', amount }],
  xAxisKey: 'stage',
  series: [{ dataKey: 'amount', label: 'Amount' }],
});

const result = (chart: unknown, chartId?: unknown) =>
  JSON.stringify({ rendered: 'chart', rows: [], chart, ...(chartId === undefined ? {} : { chartId }) });

let call = 0;
const toolPart = (output: string) => ({
  type: `tool-${VISUALIZE_DATA_TOOL}`,
  toolCallId: `call_${++call}`,
  state: 'output-available',
  input: {},
  output: { type: 'text', value: output },
});

/** The chart the mapper draws from one descriptor, without an offset. */
const drawn = (d: ReturnType<typeof descriptor>) => {
  const { textOffset: _placement, ...chart } = uiMessageToChatMessage({
    id: 'ref',
    role: 'assistant',
    parts: [{ type: 'data-chart', id: 'c', data: d }],
  }).charts![0];
  return chart;
};

const FIRST = descriptor('Pipeline by stage', 10);
const REDRAWN = descriptor('Pipeline by stage (won only)', 20);
const OTHER = descriptor('Revenue by month', 30);

const A = 'Here is the pipeline.\n\n';
const B = 'Let me narrow that down.\n\n';
const C = 'Most of it is won.';

describe('results sharing a chartId in one message draw one chart (objectstack#34716)', () => {
  it('the same chartId twice: one chart, the last descriptor, at the first offset', () => {
    const charts = chartsFromParts([
      { type: 'text', text: A },
      toolPart(result(FIRST, 'chart_1')),
      { type: 'text', text: B },
      toolPart(result(REDRAWN, 'chart_1')),
      { type: 'text', text: C },
    ]);
    expect(charts).toEqual([{ ...drawn(REDRAWN), textOffset: A.length }]);
  });

  it('different chartIds: two charts, each at its own offset', () => {
    const charts = chartsFromParts([
      { type: 'text', text: A },
      toolPart(result(FIRST, 'chart_1')),
      { type: 'text', text: B },
      toolPart(result(OTHER, 'chart_2')),
      { type: 'text', text: C },
    ]);
    expect(charts).toEqual([
      { ...drawn(FIRST), textOffset: A.length },
      { ...drawn(OTHER), textOffset: A.length + B.length },
    ]);
  });

  it('a redraw keeps the place of the first chart among other charts', () => {
    const charts = chartsFromParts([
      toolPart(result(FIRST, 'chart_1')),
      { type: 'text', text: A },
      toolPart(result(OTHER, 'chart_2')),
      { type: 'text', text: B },
      toolPart(result(REDRAWN, 'chart_1')),
    ]);
    expect(charts).toEqual([
      { ...drawn(REDRAWN), textOffset: 0 },
      { ...drawn(OTHER), textOffset: A.length },
    ]);
  });

  it('CONTROL: results without a chartId are each drawn, at their own offsets, as before', () => {
    const charts = chartsFromParts([
      { type: 'text', text: A },
      toolPart(result(FIRST)),
      { type: 'text', text: B },
      toolPart(result(FIRST)),
      { type: 'text', text: C },
    ]);
    expect(charts).toEqual([
      { ...drawn(FIRST), textOffset: A.length },
      { ...drawn(FIRST), textOffset: A.length + B.length },
    ]);
  });

  it('the same chartId in two messages gives one chart in each', () => {
    const first = uiMessageToChatMessage({
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: A }, toolPart(result(FIRST, 'chart_1'))],
    });
    const second = uiMessageToChatMessage({
      id: 'a2',
      role: 'assistant',
      parts: [{ type: 'text', text: B }, toolPart(result(REDRAWN, 'chart_1'))],
    });
    expect(first.charts).toEqual([{ ...drawn(FIRST), textOffset: A.length }]);
    expect(second.charts).toEqual([{ ...drawn(REDRAWN), textOffset: B.length }]);
  });

  it('a message with string content collapses the redraw too, with no offset', () => {
    const out = uiMessageToChatMessage({
      id: 'a1',
      role: 'assistant',
      content: `${A}${B}`,
      parts: [toolPart(result(FIRST, 'chart_1')), toolPart(result(REDRAWN, 'chart_1'))],
    });
    expect(out.charts).toEqual([drawn(REDRAWN)]);
  });

  it('the data-chart part path is unchanged: parts win, and every part is kept', () => {
    const out = uiMessageToChatMessage({
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'text', text: A },
        { type: 'data-chart', id: 'chart-0', data: FIRST },
        toolPart(result(FIRST, 'chart_1')),
        { type: 'text', text: B },
        { type: 'data-chart', id: 'chart-1', data: OTHER },
        toolPart(result(REDRAWN, 'chart_1')),
      ],
    });
    expect(out.charts).toEqual([
      { ...drawn(FIRST), textOffset: A.length },
      { ...drawn(OTHER), textOffset: A.length + B.length },
    ]);
  });
});
