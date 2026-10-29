/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25908 — an assistant answer's chart survives a reload.
 *
 * The live stream draws a chart from a transient `data-chart` part that is
 * never stored. What the server stores is the `visualize_data` tool result: one
 * JSON string whose `chart` key is the same descriptor the part carried as
 * `data`, beside a top-level `rows` preview cut to 20 for the model's
 * narration. These pins hold the one reader of that key and the part writer
 * that carries a hydrated chart back to the mapper at its offset. The app-shell
 * half (server history and the message cache) is pinned in
 * `AiChatPage.persistedChart-25908.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import * as specSystem from '@objectstack/spec/system';
import {
  VISUALIZE_DATA_TOOL,
  chartAnswerParts,
  chartsFromParts,
  uiMessageToChatMessage,
} from '../mapMessages';

/** 30 categories: more than the 20-row preview, so a chart drawn from `rows` would show. */
const ROWS = Array.from({ length: 30 }, (_, i) => ({ stage: `stage_${i}`, amount: i * 10 }));

/** The descriptor the producer streams as the part's `data` and persists under `chart`. */
const DESCRIPTOR = {
  type: 'chart',
  chartType: 'bar',
  title: 'Pipeline by stage',
  data: ROWS,
  xAxisKey: 'stage',
  series: [{ dataKey: 'amount', label: 'Amount' }],
};

/** The persisted result string: the narration preview AND the full descriptor. */
const RESULT = JSON.stringify({
  rendered: 'chart',
  chartType: 'bar',
  object: 'opportunity',
  dimension: 'stage',
  measures: ['amount'],
  categories: 30,
  rows: ROWS.slice(0, 20),
  note: 'Showing the first 20 of 30 rows.',
  chart: DESCRIPTOR,
});

/** A result written before the producer persisted `chart`. */
const LEGACY_RESULT = JSON.stringify({
  rendered: 'chart',
  chartType: 'bar',
  object: 'opportunity',
  dimension: 'stage',
  measures: ['amount'],
  categories: 30,
  rows: ROWS.slice(0, 20),
});

const toolPart = (output: unknown, type = `tool-${VISUALIZE_DATA_TOOL}`) => ({
  type,
  toolCallId: 'call_1',
  state: 'output-available',
  input: {},
  output,
});

const INTRO = 'Here is the pipeline.\n\n';
const AFTER = 'Most of it sits in the late stages.';

/** What the live mapper draws from the streamed part: the reference chart. */
const LIVE = uiMessageToChatMessage({
  id: 'live',
  role: 'assistant',
  parts: [{ type: 'data-chart', id: 'chart-0', data: DESCRIPTOR }],
}).charts![0];

describe('the persisted visualize_data chart is read back (objectstack#25908)', () => {
  it('reads the same chart the live stream drew: title, series labels and every row', () => {
    const charts = chartsFromParts([
      { type: 'text', text: INTRO },
      toolPart({ type: 'text', value: RESULT }),
      { type: 'text', text: AFTER },
    ]);
    expect(charts).toEqual([{ ...LIVE, textOffset: INTRO.length }]);
    expect(charts?.[0]?.data).toHaveLength(30);
    expect(charts?.[0]?.series).toEqual([{ dataKey: 'amount', label: 'Amount' }]);
  });

  it('reads a bare result string too, the shape a legacy tool row keeps', () => {
    expect(chartsFromParts([toolPart(RESULT)])?.[0]?.title).toBe('Pipeline by stage');
  });

  it('a result persisted before the chart key gets no chart, and does not throw', () => {
    expect(chartsFromParts([toolPart({ type: 'text', value: LEGACY_RESULT })])).toBeUndefined();
    expect(chartsFromParts([toolPart('not json at all')])).toBeUndefined();
  });

  it('only the visualize_data result is read', () => {
    expect(chartsFromParts([toolPart({ type: 'text', value: RESULT }, 'tool-query_data')])).toBeUndefined();
  });

  it('the tool name is the one the spec registry declares for service-ai', () => {
    const registry = (
      specSystem as { PLATFORM_TOOLS_BY_PACKAGE?: Readonly<Record<string, readonly string[]>> }
    ).PLATFORM_TOOLS_BY_PACKAGE;
    expect(registry?.['service-ai']).toContain(VISUALIZE_DATA_TOOL);
  });

  it('a live message carrying both the part and the result draws the chart once', () => {
    const out = uiMessageToChatMessage({
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'text', text: INTRO },
        { type: 'data-chart', id: 'chart-0', data: DESCRIPTOR },
        toolPart({ type: 'text', value: RESULT }),
        { type: 'text', text: AFTER },
      ],
    });
    expect(out.charts).toEqual([{ ...LIVE, textOffset: INTRO.length }]);
  });
});

describe('a hydrated chart goes back to the mapper at its offset (objectstack#25908)', () => {
  const content = `${INTRO}${AFTER}`;
  const charts = [{ ...LIVE, textOffset: INTRO.length }];

  it('chartAnswerParts cuts the text at the chart and maps back to the same message', () => {
    const parts = chartAnswerParts(content, charts);
    expect(parts.map((p) => p.type)).toEqual(['text', 'data-chart', 'text']);
    const out = uiMessageToChatMessage({ id: 'a1', role: 'assistant', parts });
    expect(out.content).toBe(content);
    expect(out.charts).toEqual(charts);
  });

  it('a chart with no offset follows all of the text, and no empty run is written', () => {
    const { textOffset: _placement, ...unplaced } = charts[0];
    expect(chartAnswerParts(content, [unplaced]).map((p) => p.type)).toEqual(['text', 'data-chart']);
    expect(chartAnswerParts('', undefined)).toEqual([]);
    expect(chartAnswerParts(content, undefined)).toEqual([{ type: 'text', text: content }]);
  });
});
