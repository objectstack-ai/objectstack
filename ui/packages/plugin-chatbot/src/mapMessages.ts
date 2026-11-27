/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Utilities for mapping Vercel AI SDK v6 `UIMessage` shapes (the `parts`
 * model — `[ { type: 'text' | 'reasoning' | 'tool-*' | 'dynamic-tool' |
 * 'source-url' | … } ]`) into the simpler `ChatMessage` shape consumed by
 * `<ChatbotEnhanced>`.
 *
 * Shared between `useObjectChat` (which composes `useChat` internally) and
 * apps that drive `useChat` themselves (e.g. Studio, which needs a custom
 * `prepareSendMessagesRequest` transport).
 */
import type {
  DatasetProvenance,
  ObjectQuerySource,
  RecordCitationParsed,
} from '@objectstack/spec/ai';
import {
  DatasetProvenanceSchema,
  ObjectQuerySourceSchema,
  RECORD_CITATIONS_PART_TYPE,
  RecordCitationsSchema,
} from '@objectstack/spec/ai';
import type { ChatbotEnhancedMessage as ChatMessage, ChatbotEnhancedToolInvocation as ChatToolInvocation, ChatSource } from './ChatbotEnhanced';
import { chartsFromParts, detectPendingApproval, extractCharts, parseResultEnvelope, type AnyPart } from './toolResultParsers';

// The parsers the eager `/core` entry shares live in `./toolResultParsers`, so
// this module (and the spec schema it parses with) loads only with the chat.
export {
  parseResultEnvelope,
  detectPendingApproval,
  chartsFromParts,
  chartAnswerParts,
  storedAnswerParts,
  STORED_ANSWER_DATA_PARTS,
  VISUALIZE_DATA_TOOL,
} from './toolResultParsers';
export type { ChartAnswerPart, StoredAnswerData, StoredAnswerPart } from './toolResultParsers';


interface AnyUIMessage {
  id?: string;
  role?: 'user' | 'assistant' | 'system';
  parts?: AnyPart[];
  content?: unknown;
  toolInvocations?: ChatToolInvocation[];
  metadata?: unknown;
}

/**
 * The tool-invocation lifecycle states as a runtime value. Declared as a
 * `Record` over the union so the compiler rejects a typo here AND requires a
 * row when `ChatToolInvocation['state']` grows: the table cannot drift from
 * the type it guards.
 */
const TOOL_STATES: Record<NonNullable<ChatToolInvocation['state']>, true> = {
  'input-streaming': true,
  'input-available': true,
  'approval-requested': true,
  'approval-responded': true,
  'output-available': true,
  'output-error': true,
  'output-denied': true,
};

/**
 * Narrows a part's free-form `state` to the tool-invocation lifecycle. Any
 * other spelling (a text/reasoning part's `'streaming' | 'done'`, an AI SDK v4
 * snapshot's `'result'`) is not a tool state and maps to `undefined` — which is
 * the documented "infer from `errorText` / `result`" case in
 * `ChatbotEnhanced.getToolState`, not a loss: an unrecognized string used to
 * pass through verbatim and fall past every branch there, rendering a finished
 * call as "Running" forever.
 */
function isToolState(state: string | undefined): state is NonNullable<ChatToolInvocation['state']> {
  return state !== undefined && state in TOOL_STATES;
}

function extractText(msg: AnyUIMessage, parts: AnyPart[]): string {
  if (typeof msg.content === 'string') return msg.content;
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
}

function extractReasoning(parts: AnyPart[]): string | undefined {
  const joined = parts
    .filter((p) => p.type === 'reasoning' || p.type === 'reasoning-delta')
    .map((p) => p.text ?? '')
    .join('\n')
    .trim();
  return joined.length > 0 ? joined : undefined;
}

/**
 * cloud#1658 — the ask agent's `open_record` structured hand-off: the OTHER
 * ending of a write request. Envelope
 * `{ status:'record_handoff', handoff:'record', objectName, recordId, label?, reason? }`.
 * Lifted so the chat renders an explicit "打开这条记录 →" action landing on the
 * record the agent already resolved — the whole point is that the user never
 * re-finds a record the agent has in hand. Both ids are REQUIRED: a hand-off
 * with either missing is dropped here exactly as the server refuses to emit
 * one, because a card pointing nowhere is worse than the prose it replaces.
 */
export interface RecordHandoff {
  objectName: string;
  recordId: string;
  label?: string;
  reason?: string;
}

export function detectRecordHandoff(result: unknown): RecordHandoff | undefined {
  const obj = parseResultEnvelope(result);
  if (!obj || obj.status !== 'record_handoff') return undefined;
  const str = (v: unknown): string | undefined => {
    const t = typeof v === 'string' ? v.trim() : '';
    return t.length > 0 ? t : undefined;
  };
  const o = obj as { objectName?: unknown; recordId?: unknown; label?: unknown; reason?: unknown };
  const objectName = str(o.objectName);
  const recordId = str(o.recordId);
  if (!objectName || !recordId) return undefined;
  return {
    objectName,
    recordId,
    ...(str(o.label) ? { label: str(o.label) } : {}),
    ...(str(o.reason) ? { reason: str(o.reason) } : {}),
  };
}

/**
 * cloud#3565 — the chat's ONE-record write proposal, which the user confirms
 * on a card before anything is written. `create_record` / `update_record`
 * queue a HITL pending action in the user's name and answer
 * `{ status:'pending_approval', pendingActionId, recordWrite:{…} }`: the
 * approval envelope `detectPendingApproval` already lifts, plus the record the
 * card draws beside its three buttons (确认 / 打开完整表单 / 取消). An update
 * carries each field as stored (`current`) beside the proposed value, so the
 * card reads old → new. `dropped` names what the server refused to propose and
 * why (a field the user may not write, a lookup it could not resolve).
 *
 * The id is what the buttons act on, so an envelope without one is not a card:
 * `useHitlInChat` would have nothing to approve or reject.
 */
export interface RecordWriteField {
  name: string;
  label: string;
  type: string;
  value: unknown;
  /** The stored value an update replaces; absent on a create. */
  current?: unknown;
}

export interface RecordWrite {
  operation: 'create' | 'update';
  objectName: string;
  objectLabel: string;
  recordId?: string;
  label?: string;
  reason?: string;
  fields: RecordWriteField[];
  dropped: Array<{ field: string; reason: string; detail?: string }>;
}

export function detectRecordWrite(result: unknown): RecordWrite | undefined {
  const pending = detectPendingApproval(result);
  if (!pending) return undefined;
  const raw = pending.raw.recordWrite;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown): string | undefined => {
    const t = typeof v === 'string' ? v.trim() : '';
    return t.length > 0 ? t : undefined;
  };
  const operation = o.operation === 'create' || o.operation === 'update' ? o.operation : undefined;
  const objectName = str(o.objectName);
  const recordId = str(o.recordId);
  if (!operation || !objectName || (operation === 'update' && !recordId)) return undefined;
  const fields = (Array.isArray(o.fields) ? o.fields : []).flatMap((f): RecordWriteField[] => {
    const r = (f ?? {}) as Record<string, unknown>;
    const name = str(r.name);
    if (!name) return [];
    return [
      {
        name,
        label: str(r.label) ?? name,
        type: str(r.type) ?? 'text',
        value: r.value,
        ...('current' in r ? { current: r.current } : {}),
      },
    ];
  });
  // A card with nothing to confirm is not a card: the server refuses to queue
  // one, so this only guards a hand-made envelope.
  if (fields.length === 0) return undefined;
  const dropped = (Array.isArray(o.dropped) ? o.dropped : []).flatMap((d) => {
    const r = (d ?? {}) as Record<string, unknown>;
    const field = str(r.field);
    const reason = str(r.reason);
    if (!field || !reason) return [];
    return [{ field, reason, ...(str(r.detail) ? { detail: str(r.detail) } : {}) }];
  });
  return {
    operation,
    objectName,
    objectLabel: str(o.objectLabel) ?? objectName,
    ...(recordId ? { recordId } : {}),
    ...(str(o.label) ? { label: str(o.label) } : {}),
    ...(str(o.reason) ? { reason: str(o.reason) } : {}),
    fields,
    dropped,
  };
}

/**
 * What a turn's "How this was computed" block draws for one tool call: an
 * object query's `source` block (`ObjectQuerySourceSchema`), or the
 * `provenance` block `query_dataset` answers (`DatasetProvenanceSchema`,
 * ADR-0149 D3), told apart by the latter's `kind: 'dataset'`.
 */
export type AnswerSource = ObjectQuerySource | DatasetProvenance;

/**
 * The block a data tool answers beside its result, read through the published
 * contract (`@objectstack/spec/ai`): `query_dataset`'s top-level `provenance`
 * (`DatasetProvenanceSchema`), else the `source` block the object-query tools
 * answer (`OBJECT_QUERY_SOURCE_TOOL_NAMES`, `ObjectQuerySourceSchema`). The
 * chat draws it as the turn's "How this was computed" block.
 *
 * The lift is the schema's parse of the block: a key the schema does not
 * declare is stripped, so nothing else of the tool payload rides along, and a
 * block the schema refuses is no block at all, so a producer that drifts from
 * the contract is seen as a missing block rather than drawn half-right. The
 * whole parsed block is kept, the members the block does not draw included,
 * because the message cache stores this copy and lifts it again on reload.
 */
export function detectAnswerSource(result: unknown): AnswerSource | undefined {
  const envelope = parseResultEnvelope(result);
  if (envelope?.provenance !== undefined) {
    const provenance = DatasetProvenanceSchema.safeParse(envelope.provenance);
    if (provenance.success) return provenance.data;
  }
  const raw = envelope?.source;
  if (raw === undefined) return undefined;
  const parsed = ObjectQuerySourceSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The verified record citations an answer carries (ADR-0160 D9), read off the
 * message's `data-record-citations` part ({@link RECORD_CITATIONS_PART_TYPE})
 * through the published contract (`RecordCitationsSchema`).
 *
 * The list is the one the platform verified when the answer was produced and
 * persisted with the message; the chat draws it as it is and never verifies it
 * again. As with {@link detectAnswerSource}, a part the schema refuses is no
 * list at all, so a producer that drifts from the contract is seen as a turn
 * without citations rather than drawn half-right. With a stable part id the
 * stream keeps one part, so the last one is read. An empty list draws nothing.
 */
export function extractRecordCitations(parts: readonly AnyPart[]): RecordCitationParsed[] | undefined {
  const part = parts.filter((p) => p.type === RECORD_CITATIONS_PART_TYPE).pop();
  if (!part) return undefined;
  const parsed = RecordCitationsSchema.safeParse(part.data);
  return parsed.success && parsed.data.length > 0 ? parsed.data : undefined;
}

/**
 * objectstack#37487 — the reading half of `STORED_ANSWER_DATA_PARTS`: every
 * kept data part of a stored message, read back into the message fields the
 * chat draws. A history or cache rebuild calls this once; a part added to the
 * allow-list is read here, beside its write in `storedAnswerParts`. The citations list is taken
 * as persisted (ruling Q1): parsed through the contract, never verified again.
 */
export function storedAnswerData(parts: readonly AnyPart[]): {
  charts?: ChatMessage['charts'];
  recordCitations?: RecordCitationParsed[];
} {
  const charts = chartsFromParts(parts);
  const recordCitations = extractRecordCitations(parts);
  return { ...(charts ? { charts } : {}), ...(recordCitations ? { recordCitations } : {}) };
}

/**
 * cloud#3565 — 「清理示例数据」: the chat's `remove_sample_data` queues a HITL
 * pending action and answers `{ status:'pending_approval', pendingActionId,
 * sampleDataCleanup:{ tables:[{ objectName, label, count }], total, absent,
 * edited } }` — the tables and counts the card lists before the user confirms.
 * Only the seed ledger's rows are counted; the generic Approve / Deny strip
 * stays the decision. An envelope without the id or without a table is not a
 * card. The removal cannot be undone (no recycle bin until objectstack#3146),
 * so the card says so; `absent` and `edited` are each said when above 0.
 */
export interface SampleDataCleanup {
  tables: Array<{ objectName: string; label: string; count: number }>;
  total: number;
  /** Recorded rows the user cannot see or that are already gone. */
  absent: number;
  /** Recorded rows someone edited since they were seeded: kept, never removed. Absent in an older envelope → 0. */
  edited: number;
}

export function detectSampleDataCleanup(result: unknown): SampleDataCleanup | undefined {
  const pending = detectPendingApproval(result);
  if (!pending) return undefined;
  const raw = pending.raw.sampleDataCleanup;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown): string | undefined => {
    const t = typeof v === 'string' ? v.trim() : '';
    return t.length > 0 ? t : undefined;
  };
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const tables = (Array.isArray(o.tables) ? o.tables : []).flatMap((t) => {
    const r = (t ?? {}) as Record<string, unknown>;
    const objectName = str(r.objectName);
    if (!objectName) return [];
    return [{ objectName, label: str(r.label) ?? objectName, count: num(r.count) }];
  });
  if (tables.length === 0) return undefined;
  return {
    tables,
    total: typeof o.total === 'number' ? num(o.total) : tables.reduce((n, t) => n + t.count, 0),
    absent: num(o.absent),
    edited: num(o.edited),
  };
}

/**
 * objectstack#31025 — 「删除软件包」: cloud's `delete_package` queues a HITL
 * pending action and answers `{ success:true, status:'pending_approval',
 * pendingActionId, packageRemoval:{ packageId, label, objects:[{ name, label,
 * rows?, draft? }], totalRows, uncountedObjects, items, data, recycleBin },
 * message }` (the shape on objectstack#31025, read at cloud `d6288d27`). The
 * card lists what goes before the user confirms; the generic Approve / Deny
 * strip stays the decision and sends nothing but the decision. An envelope
 * without the id or without the plan is not a card, and a refusal
 * (`success:false`) carries neither. `rows` absent means the object has no
 * table (a draft) or could not be counted, so it stays absent, never `0`.
 */
export interface PackageRemovalObject {
  name: string;
  label: string;
  /** Absent: a draft (no table) or a published object whose rows could not be counted. */
  rows?: number;
  draft?: true;
}

export interface PackageRemoval {
  packageId: string;
  label: string;
  objects: PackageRemovalObject[];
  /** The sum of the counted rows. */
  totalRows: number;
  /** Published objects whose rows could not be counted: `totalRows` is short by them. */
  uncountedObjects: number;
  /** Other items that go, by metadata type. */
  items: Record<string, number>;
  /** `dropped`: the tables go with every row and nothing restores them. */
  data: 'dropped' | 'kept';
}

export function detectPackageRemoval(result: unknown): PackageRemoval | undefined {
  const pending = detectPendingApproval(result);
  if (!pending) return undefined;
  const raw = pending.raw.packageRemoval;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown): string | undefined => {
    const t = typeof v === 'string' ? v.trim() : '';
    return t.length > 0 ? t : undefined;
  };
  const count = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
  const packageId = str(o.packageId);
  const data = o.data === 'dropped' || o.data === 'kept' ? o.data : undefined;
  if (!packageId || !data) return undefined;
  const objects = (Array.isArray(o.objects) ? o.objects : []).flatMap((x): PackageRemovalObject[] => {
    const r = (x ?? {}) as Record<string, unknown>;
    const name = str(r.name);
    if (!name) return [];
    const rows = count(r.rows);
    return [
      {
        name,
        label: str(r.label) ?? name,
        ...(rows !== undefined ? { rows } : {}),
        ...(r.draft === true ? { draft: true as const } : {}),
      },
    ];
  });
  const items: Record<string, number> = {};
  if (o.items && typeof o.items === 'object' && !Array.isArray(o.items)) {
    for (const [type, n] of Object.entries(o.items as Record<string, unknown>)) {
      const c = count(n);
      if (str(type) && c) items[type] = c;
    }
  }
  return {
    packageId,
    label: str(o.label) ?? packageId,
    objects,
    totalRows: count(o.totalRows) ?? objects.reduce((n, x) => n + (x.rows ?? 0), 0),
    uncountedObjects: count(o.uncountedObjects) ?? 0,
    items,
    data,
  };
}

/**
 * The outcome an approved `delete_package` answers with
 * (`PackageRemovedResult`: `{ status:'removed'|'partial', packageId, removed,
 * failed:[{ type, name, code? }], data, message }`), so the card can say
 * whether everything went or how many items were left.
 */
export function detectPackageRemovedResult(
  result: unknown,
): { status: 'removed' | 'partial'; failed: number } | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const r = result as Record<string, unknown>;
  if (r.status !== 'removed' && r.status !== 'partial') return undefined;
  return { status: r.status, failed: Array.isArray(r.failed) ? r.failed.length : 0 };
}

/**
 * Lift the chat runtime's approval envelope off a tool part.
 *
 * The envelope is what makes the three approval states ACTIONABLE rather than
 * merely displayable: the runtime's own tool-part union makes it required
 * alongside `approval-requested`, `approval-responded` and `output-denied`, so
 * a producer that rebuilds a part from an invocation without it cannot
 * reconstruct those states at all. This is the live half of objectui#8426 —
 * `hydratedMessagesToChatMessages` already lifts it on the HYDRATED half
 * (objectui#8442), and until this landed the two paths disagreed about the
 * same conversation.
 *
 * ⚠️ NOT a replacement for `pendingActionId`, which rides alongside it: that is
 * the ObjectStack `pending_actions` row the approve/reject endpoints take,
 * while this is the runtime's own request id.
 *
 * A missing or empty `id` means there is no envelope to lift — an envelope
 * whose id cannot be replied on is not one.
 */
function liftApproval(part: AnyPart): ChatToolInvocation['approval'] {
  const { approval } = part;
  if (typeof approval !== 'object' || approval === null) return undefined;
  const envelope = approval as {
    id?: unknown;
    approved?: unknown;
    reason?: unknown;
    isAutomatic?: unknown;
    signature?: unknown;
  };
  const { id } = envelope;
  if (typeof id !== 'string' || id.length === 0) return undefined;
  // Each member is checked on its own: a producer that gets one of them wrong
  // should lose that member, not the whole envelope — the `id` is what makes
  // the approval answerable, and it has already been established.
  return {
    id,
    approved: typeof envelope.approved === 'boolean' ? envelope.approved : undefined,
    reason: typeof envelope.reason === 'string' ? envelope.reason : undefined,
    isAutomatic: typeof envelope.isAutomatic === 'boolean' ? envelope.isAutomatic : undefined,
    signature: typeof envelope.signature === 'string' ? envelope.signature : undefined,
  };
}

function extractToolInvocations(
  parts: AnyPart[],
  opts: { liveTail?: boolean } = {},
): ChatToolInvocation[] {
  return parts
    .filter((p) => {
      if (p.type === 'dynamic-tool') return true;
      return typeof p.type === 'string' && p.type.startsWith('tool-');
    })
    .map((p) => {
      const toolName =
        p.type === 'dynamic-tool'
          ? (p.toolName ?? 'tool')
          : typeof p.type === 'string'
            ? p.type.replace(/^tool-/, '')
            : 'tool';
      const toolCallId =
        p.toolCallId ?? p.id ?? `${p.type ?? 'tool'}-${Math.random().toString(36).slice(2, 8)}`;
      const result = p.output ?? p.result;
      const pending = detectPendingApproval(result);
      const recordHandoff = detectRecordHandoff(result);
      const recordWrite = detectRecordWrite(result);
      const answerSource = detectAnswerSource(result);
      const sampleDataCleanup = detectSampleDataCleanup(result);
      const packageRemoval = detectPackageRemoval(result);
      // Promote a dangling `input-*` state to a terminal one so a reloaded
      // conversation never shows "Running" forever (the server doesn't always
      // snapshot the terminal tool state). Two cases:
      //   1. output present → the call finished → Completed.
      //   2. NOT the live streaming tail → the turn that drove this tool has
      //      ENDED, so it cannot still be running, output-snapshot or not.
      // Only the actively-streaming trailing assistant message (`liveTail`)
      // may legitimately keep a tool spinning; everything else is history.
      const persistedState = isToolState(p.state) ? p.state : undefined;
      const isDanglingInput =
        persistedState === 'input-available' || persistedState === 'input-streaming';
      const baseState: ChatToolInvocation['state'] =
        isDanglingInput && (result !== undefined || !opts.liveTail)
          ? 'output-available'
          : persistedState;
      // Promote pending HITL results to `approval-requested` so the UI
      // unlocks the inline approve/reject buttons. Once the operator
      // decides, `useHitlInChat` flips `state` back via the per-call
      // override map and we render the normal output instead.
      const state: ChatToolInvocation['state'] =
        pending && baseState !== 'output-error' ? 'approval-requested' : baseState;
      return {
        toolCallId,
        toolName,
        args: p.input ?? p.args,
        result,
        errorText: p.errorText,
        state,
        approval: liftApproval(p),
        pendingActionId: pending?.pendingActionId,
        recordHandoff,
        recordWrite,
        answerSource,
        sampleDataCleanup,
        packageRemoval,
      } satisfies ChatToolInvocation;
    });
}

function extractSources(parts: AnyPart[]): ChatSource[] | undefined {
  const sources = parts
    .filter((p) => p.type === 'source-url' || p.type === 'source')
    .map<ChatSource>((p) => ({
      id: p.id,
      title: p.title,
      url: (p.url ?? p.href) as string,
    }))
    .filter((s) => Boolean(s.url));
  return sources.length > 0 ? sources : undefined;
}

/**
 * Map a single Vercel AI SDK v6 `UIMessage` to the `ChatMessage` shape that
 * `<ChatbotEnhanced>` renders.
 *
 * @param msg - AI SDK `UIMessage` (or compatible shape with `parts`).
 * @param opts - Optional flags. `streaming` flags the latest assistant
 *   message during an in-flight stream so the cursor pulse renders.
 */
export function uiMessageToChatMessage(
  msg: AnyUIMessage,
  opts: { streaming?: boolean } = {},
): ChatMessage {
  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  // Only the live streaming tail may keep tools in a "Running" state; for any
  // other (historical) message a dangling tool state is stale by definition.
  const tools = extractToolInvocations(parts, { liveTail: opts.streaming });
  const legacyTools = Array.isArray(msg.toolInvocations) ? msg.toolInvocations : [];
  const resolvedTools = tools.length > 0 ? tools : legacyTools;
  const recordCitations = extractRecordCitations(parts);
  return {
    id: (msg.id ?? `msg-${Math.random().toString(36).slice(2, 8)}`) as string,
    role: (msg.role ?? 'assistant') as ChatMessage['role'],
    content: extractText(msg, parts),
    reasoning: extractReasoning(parts),
    toolInvocations: resolvedTools,
    sources: extractSources(parts),
    charts: extractCharts(parts, { anchored: typeof msg.content !== 'string' }),
    // ADR-0160 D9 — the answer's verified record citations, drawn as chips.
    ...(recordCitations ? { recordCitations } : {}),
    streaming: opts.streaming,
  };
}

/**
 * Map an array of `UIMessage`s. The trailing assistant message gets the
 * `streaming` flag when `isStreaming` is true (mirrors `useObjectChat`).
 */
export function uiMessagesToChatMessages(
  messages: AnyUIMessage[],
  opts: { isStreaming?: boolean } = {},
): ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const lastIdx = messages.length - 1;
  return messages.map((m, idx) =>
    uiMessageToChatMessage(m, {
      streaming:
        Boolean(opts.isStreaming) && idx === lastIdx && m.role === 'assistant',
    }),
  );
}
