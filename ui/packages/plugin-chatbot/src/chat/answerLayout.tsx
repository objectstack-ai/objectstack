/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Answer layout: where a turn's charts sit among its prose.
 */
import { SchemaRenderer } from '@object-ui/react';
import type { ChatChart } from './types';

/**
 * The conversation store persists tool-call-only assistant turns with an
 * internal placeholder as their text ("(called todo_write, propose_blueprint)"
 * / "(tool call)" / "(no content)"). On re-hydration that placeholder used to
 * render as a normal prose bubble — internal jargon spliced into the thread
 * (#772). Detect it so the renderer can collapse it to a quiet activity note.
 */
export function isToolCallPlaceholder(content: string): boolean {
  return /^\((?:called [^)]*|tool call|no content)\)$/.test(content.trim());
}

/** One run of an assistant answer: a slice of its text, or the charts drawn at one point. */
type AnswerBlock =
  | { kind: 'text'; text: string }
  | { kind: 'charts'; charts: ChatChart[] };

/**
 * objectui#13492 — an assistant answer in the order the stream produced it:
 * the text up to each chart's `textOffset`, the chart, then the text after.
 * The mapper used to flatten every text part into one `content` and every
 * `data-chart` part into one trailing `charts[]` block, so a chart the model
 * drew first still landed below six paragraphs of analysis.
 *
 * A chart without an offset (a host-built message, the legacy string-content
 * shape) or with one past the text's end trails all of it, which is exactly
 * the old layout. Charts at the same offset share one block, and a slice that
 * is only whitespace is dropped rather than painted as an empty answer box.
 */
export function layoutAnswer(content: string, charts: ChatChart[] | undefined): AnswerBlock[] {
  const placed = (charts ?? [])
    .map((chart, order) => ({
      chart,
      order,
      at:
        typeof chart.textOffset === 'number' && Number.isFinite(chart.textOffset)
          ? Math.min(Math.max(chart.textOffset, 0), content.length)
          : content.length,
    }))
    .sort((a, b) => a.at - b.at || a.order - b.order);
  const blocks: AnswerBlock[] = [];
  let cursor = 0;
  for (const { chart, at } of placed) {
    if (at > cursor) {
      const text = content.slice(cursor, at);
      if (text.trim().length > 0) blocks.push({ kind: 'text', text });
      cursor = at;
    }
    const last = blocks[blocks.length - 1];
    if (last?.kind === 'charts') last.charts.push(chart);
    else blocks.push({ kind: 'charts', charts: [chart] });
  }
  const rest = content.slice(cursor);
  if (rest.trim().length > 0) blocks.push({ kind: 'text', text: rest });
  return blocks;
}

/** The charts drawn at one point of an assistant answer, each through the SDUI `<chart>`. */
export function AnswerCharts({ charts }: { charts: ChatChart[] }) {
  return (
    <div className="mt-2 flex flex-col gap-3" data-testid="chat-charts">
      {charts.map((chart, i) => (
        <div
          key={i}
          className="rounded-lg border bg-background p-3"
          // The chat bubble is `w-fit` (shrinks to content) while the
          // SDUI chart's ResponsiveContainer is `width:100%` — a
          // circular dependency. We give the chart a DEFINITE width
          // sized to the viewport (NOT the shrink-to-fit parent, which
          // would re-introduce the cycle) so recharts always measures a
          // stable, non-zero width and renders. Height comes from the
          // ChartContainer itself (h-[350px] / min-h 280).
          style={{ width: 'min(520px, 80vw)' }}
          data-testid="chat-chart"
        >
          {chart.title ? (
            <div className="mb-2 text-sm font-medium text-foreground">
              {chart.title}
            </div>
          ) : null}
          <SchemaRenderer
            schema={{
              type: 'chart',
              chartType: chart.chartType ?? 'bar',
              data: chart.data,
              xAxisKey: chart.xAxisKey,
              series: chart.series,
            } as never}
          />
        </div>
      ))}
    </div>
  );
}
