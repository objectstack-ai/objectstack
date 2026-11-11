/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The tool-result parsers the eager `@object-ui/plugin-chatbot/core` entry
 * shares with the chat's message mapper (`./mapMessages`): the result envelope
 * peel, the pending-approval envelope and the chart readers. Kept apart from
 * `./mapMessages` so the console's first load reaches only these, not the
 * mapper and the schemas it parses with. Side-effect free; its one import back
 * into the chat UI is `import type`, which is erased.
 */
import type { ChatChart } from './ChatbotEnhanced';

export interface AnyPart {
  type?: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  id?: string;
  input?: unknown;
  output?: unknown;
  args?: unknown;
  result?: unknown;
  errorText?: string;
  /**
   * Free-form on purpose. `AnyPart` absorbs whatever a producer hands the
   * mapper, and `state` is NOT one namespace: a tool part carries the
   * tool-invocation lifecycle, while `@ai-sdk/react`'s text and reasoning
   * parts carry `'streaming' | 'done'`. Typing this member against the
   * OUTPUT contract made the deliberately-permissive input interface
   * stricter than the union it exists to absorb, so the SDK's own
   * `UIMessage[]` — the documented input of the exported mappers — was
   * refused outright (objectui#8214). `isToolState` below is what keeps the
   * output checked; this stays open.
   */
  state?: string;
  /**
   * The chat runtime's approval envelope, as it arrives on a tool part.
   *
   * `unknown`, like every other absorbing member here, and deliberately NOT
   * the envelope's declared shape: this interface exists to take whatever a
   * producer hands the mapper, and the one time a member was typed against the
   * OUTPUT contract it made the permissive input interface stricter than the
   * union it absorbs (objectui#8214, the `state` member). `liftApproval` (`./mapMessages`)
   * is what keeps the OUTPUT checked; this stays open.
   */
  approval?: unknown;
  url?: string;
  href?: string;
  title?: string;
  /** Payload of a Vercel custom data part (`data-*`), e.g. build progress. */
  data?: unknown;
}

/**
 * Best-effort detector for the framework's HITL pending envelope. Server-side
 * `action-tools.ts` returns a JSON string of shape
 *   `{ "status": "pending_approval", "pendingActionId": "pa_…", … }`
 * inside the tool's `output.value` when the action is dangerous and approval
 * is enabled. We surface this on the invocation so chat UIs can render an
 * inline approve/reject affordance without round-tripping back to the server.
 */
/**
 * Parse a tool result into the framework's JSON envelope object, if it is one.
 * The Vercel SDK wraps tool outputs as `{ type: 'text', value: string }`, so we
 * peel one layer if present, then fall back to the raw value. Returns the first
 * candidate that parses to a plain object.
 *
 * Exported so `isProposalResult` (ChatbotEnhanced) shares the exact same
 * envelope-peeling logic — otherwise a wrapped `{type:'text', value:'…'}`
 * result slips past its `.status` check and the activity chip mis-reads a
 * still-pending proposal as "Completed" (#787 finding B / #2362).
 */
export function parseResultEnvelope(result: unknown): Record<string, unknown> | undefined {
  const tryParse = (value: unknown): Record<string, unknown> | undefined => {
    if (value && typeof value === 'object') return value as Record<string, unknown>;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  const candidates: unknown[] = [result];
  if (result && typeof result === 'object' && 'value' in (result as Record<string, unknown>)) {
    candidates.push((result as Record<string, unknown>).value);
  }
  // Prefer a candidate that carries the framework's `status` discriminator —
  // this peels the Vercel `{ type:'text', value:'…json…' }` wrapper, whose
  // outer object has no `status`, to the inner envelope that does. The
  // wrapper itself is only ever a LAST-resort fallback: a status-less inner
  // envelope (e.g. a bare `{error: …}` replay dispatch failure, #5695) must
  // still win over the wrapper it rode in on, or the error is invisible to
  // every detector on the rehydration path.
  let fallback: Record<string, unknown> | undefined;
  let wrapperFallback: Record<string, unknown> | undefined;
  for (const candidate of candidates) {
    const obj = tryParse(candidate);
    if (!obj) continue;
    if (typeof obj.status === 'string') return obj;
    const isTextWrapper = obj.type === 'text' && 'value' in obj;
    if (isTextWrapper) wrapperFallback ??= obj;
    else fallback ??= obj;
  }
  return fallback ?? wrapperFallback;
}

/**
 * The ObjectStack HITL envelope a tool result carries when the framework's
 * `action-tools.ts` proposes a destructive action:
 * `{ status: 'pending_approval', pendingActionId: 'pa_…', … }`.
 *
 * Exported (objectui#8442) so the app-shell's HYDRATION mapper derives the id
 * from the same parse the live mapper uses. The id is never persisted as a part
 * key — it exists in rehydrated history only inside this envelope — so a second
 * hand-rolled reader there would be a second dialect of one contract, which is
 * exactly what AGENTS.md Commandment #0.1 refuses.
 */
export function detectPendingApproval(
  result: unknown,
): { pendingActionId: string; raw: Record<string, unknown> } | undefined {
  const obj = parseResultEnvelope(result);
  if (!obj) return undefined;
  const id = obj.pendingActionId;
  if (obj.status === 'pending_approval' && typeof id === 'string' && id.length > 0) {
    return { pendingActionId: id, raw: obj };
  }
  return undefined;
}

/**
 * Lift charts from the stream's `data-chart` parts (emitted by the
 * `visualize_data` tool via `ctx.onProgress`). Unlike `data-build-progress`
 * (one reconciled part), each chart is emitted with its OWN id, so a single
 * answer may carry several — we keep them all, in arrival order. Each part's
 * `data` already matches the SDUI `<chart>` schema; we defensively narrow it
 * so a malformed payload is dropped rather than rendered broken.
 *
 * objectui#13492 — each chart also records where it arrived among the text
 * parts (`textOffset`: the length of the text `extractText` (`./mapMessages`) joined
 * before it), so the bubble can render a chart the model drew first above the
 * analysis it wrote after, instead of below all of it. Only when the content
 * IS that join (`anchored`): a legacy string `content` is not built from the
 * parts, so an offset into it would point nowhere and the charts trail it.
 *
 * objectstack#25908 — a message with no `data-chart` part reads its charts off
 * its `visualize_data` results instead ({@link chartFromToolResult}), each at
 * the offset of its tool part.
 */
export function extractCharts(parts: AnyPart[], opts: { anchored: boolean }): ChatChart[] | undefined {
  const fromParts: ChatChart[] = [];
  const fromResults: ChatChart[] = [];
  let textOffset = 0;
  for (const p of parts) {
    if (p.type === 'text') {
      textOffset += (p.text ?? '').length;
      continue;
    }
    const isPart = p.type === 'data-chart';
    const chart = isPart ? chartFromDescriptor(p.data) : chartFromToolResult(p);
    if (!chart) continue;
    (isPart ? fromParts : fromResults).push(opts.anchored ? { ...chart, textOffset } : chart);
  }
  // objectstack#25908 — a live stream carries BOTH the transient `data-chart`
  // part and the `visualize_data` result that persisted the same chart, so the
  // results are read only for a message with no chart part at all: server
  // history, where the transient part was never stored.
  const charts = fromParts.length > 0 ? fromParts : fromResults;
  return charts.length > 0 ? charts : undefined;
}

/**
 * Narrow one chart descriptor (a `data-chart` part's `data`, or the `chart` a
 * `visualize_data` result persisted, which is the same object) to a
 * {@link ChatChart}. A chart with no series is unrenderable and is dropped.
 */
function chartFromDescriptor(d: unknown): ChatChart | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const c = d as Record<string, unknown>;
  const data = Array.isArray(c.data) ? (c.data as Array<Record<string, unknown>>) : [];
  const series = Array.isArray(c.series)
    ? (c.series as Array<Record<string, unknown>>)
        .filter((s) => s && typeof s.dataKey === 'string')
        .map((s) => ({
          dataKey: s.dataKey as string,
          ...(typeof s.label === 'string' ? { label: s.label } : {}),
        }))
    : [];
  if (series.length === 0) return undefined;
  return {
    ...(typeof c.chartType === 'string' ? { chartType: c.chartType as ChatChart['chartType'] } : {}),
    ...(typeof c.title === 'string' ? { title: c.title } : {}),
    data,
    ...(typeof c.xAxisKey === 'string' ? { xAxisKey: c.xAxisKey } : {}),
    series,
  };
}

/**
 * The tool whose result persists a chart. `@objectstack/spec` declares it only
 * as a member of `PLATFORM_TOOLS_BY_PACKAGE['service-ai']`, with no constant of
 * its own; `mapMessages.persistedChart-25908.test.ts` pins this spelling to
 * that registry.
 */
export const VISUALIZE_DATA_TOOL = 'visualize_data';

/**
 * objectstack#25908 — the ONE reader of the chart a `visualize_data` result
 * persisted. The streamed `data-chart` part is transient, so after a reload the
 * tool result is the only record of the chart: one JSON string whose `chart`
 * key holds the very descriptor the part carried as `data`. Its top-level
 * `rows` are a preview cut for the model's narration and are never drawn, and
 * a result persisted before the producer wrote `chart` gets no chart: nothing
 * is rebuilt from its other keys.
 */
function chartFromToolResult(p: AnyPart): ChatChart | undefined {
  const toolName = p.type === 'dynamic-tool' ? p.toolName : p.type?.replace(/^tool-/, '');
  if (toolName !== VISUALIZE_DATA_TOOL) return undefined;
  return chartFromDescriptor(parseResultEnvelope(p.output ?? p.result)?.chart);
}

/**
 * objectstack#25908 — a stored message's charts, each with the `textOffset` at
 * which it sat among the text parts: its `data-chart` parts or, when it has
 * none, the charts its `visualize_data` results persisted. The offsets index
 * the join of the text parts, which is the `content` app-shell's hydration
 * builds.
 */
export function chartsFromParts(parts: readonly AnyPart[]): ChatChart[] | undefined {
  return extractCharts([...parts], { anchored: true });
}

/** One part {@link chartAnswerParts} writes. */
export type ChartAnswerPart =
  | { type: 'text'; text: string }
  | { type: 'data-chart'; data: Omit<ChatChart, 'textOffset'> };

/**
 * The inverse of {@link chartsFromParts}: the text cut at each chart's
 * `textOffset`, with the chart between the runs as a `data-chart` part, so a
 * message rebuilt from these parts maps back to the same `content` and the
 * same charts at the same offsets. A chart without an offset, or past the end
 * of the text, follows all of it; an empty run is left out.
 */
export function chartAnswerParts(
  content: string,
  charts: readonly ChatChart[] | undefined,
): ChartAnswerPart[] {
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
  const parts: ChartAnswerPart[] = [];
  let cursor = 0;
  for (const { chart, at } of placed) {
    if (at > cursor) parts.push({ type: 'text', text: content.slice(cursor, at) });
    cursor = at;
    const { textOffset: _placement, ...data } = chart;
    parts.push({ type: 'data-chart', data });
  }
  if (cursor < content.length) parts.push({ type: 'text', text: content.slice(cursor) });
  return parts;
}
