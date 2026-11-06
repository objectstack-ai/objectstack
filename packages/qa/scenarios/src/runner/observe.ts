// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the runner OBSERVED after one card operation, as the
 * `OperationObservation` the write grader takes (`gradeCardOperation`).
 *
 * The grader judges; this module only reports, from three sources the runner
 * reads itself and never from the agent's own account of what it did:
 *
 *   - the agent's tool calls in the turn transcript — which write door it
 *     knocked on, and the door's answer (a coded refusal arrives as the MCP
 *     door's `{ error: { code, status } }` tool output);
 *   - the operation object's rows read through the data API before and after
 *     the turn (as the run's admin) — so "nothing was written" is a count of
 *     rows added, removed or changed, not a claim;
 *   - the audit trail's actor for the touched row, mapped back to a persona.
 *
 * How the answer is decided, in order (the PR body records the reading this
 * was measured against):
 *
 *   1. rows changed, or a write call succeeded         → `applied`
 *   2. a write call answered `ACTION_CONFIRMATION_REQUIRED` → `pending_confirmation`
 *   3. a write call answered a coded refusal          → `refused <that code>`
 *   4. no write call, and the reply asks the person to confirm
 *                                                     → `pending_confirmation`
 *   5. a write call failed with no code               → `refused (tool error without a code)`
 *   6. nothing attempted                              → `refused (no write attempted)`
 *
 * The two labels in 5 and 6 are deliberately not error codes: parenthesized
 * prose, outside the spec's catalogue and outside its spelling, so no card can
 * declare them and nobody can mistake one for a code a door answered. An
 * operation the agent never carried out can never grade as the refusal the
 * card expected.
 */

import type { ScenarioCard, Scalar } from '../schema.js';
import type { ObservedAnswer, OperationObservation } from '../score/index.js';
import { refusalCodeOf, type ParsedTurn, type RunnerToolCall } from './transcript.js';

export type CardOperation = ScenarioCard['run']['operations'][number];
export type Row = Readonly<Record<string, unknown>>;

/** The write tools of the MCP data surface, and the business-action door. */
export const WRITE_TOOLS = ['create_record', 'update_record', 'delete_record', 'run_action'] as const;

export const noWriteAttempted = '(no write attempted)';
export const uncodedToolError = '(tool error without a code)';
export const CONFIRMATION_REQUIRED_CODE = 'ACTION_CONFIRMATION_REQUIRED';

/** A row's fingerprint for the before/after comparison: every column but the clock. */
export function fingerprint(row: Row): string {
  const keys = Object.keys(row).filter((k) => k !== 'updated_at').sort();
  return JSON.stringify(keys.map((k) => [k, row[k]]));
}

/** Rows added, removed or changed between two reads of one object, keyed by `id`. */
export function countWrites(before: readonly Row[], after: readonly Row[]): number {
  const index = (rows: readonly Row[]) => new Map(rows.map((r) => [String(r.id), fingerprint(r)]));
  const b = index(before);
  const a = index(after);
  let n = 0;
  for (const [id, fp] of a) if (b.get(id) !== fp) n++;
  for (const id of b.keys()) if (!a.has(id)) n++;
  return n;
}

/** The turn's calls to a write door aimed at `object` (a `run_action` naming no object counts too). */
export function writeCallsOn(turn: Pick<ParsedTurn, 'toolCalls'>, object: string): RunnerToolCall[] {
  return turn.toolCalls.filter((c) => {
    if (!(WRITE_TOOLS as readonly string[]).includes(c.name)) return false;
    const input = (typeof c.input === 'object' && c.input !== null ? c.input : {}) as Record<string, unknown>;
    const target = input.objectName;
    if (c.name === 'run_action') return target === undefined || target === object;
    return target === object;
  });
}

/** The reply asks the person to confirm before acting. Deterministic: a closed phrase list. */
export function asksToConfirm(replyText: string): boolean {
  return /\b(confirm|are you sure|shall i|should i|do you want me to|would you like me to|proceed\?)\b|确认|确定要|是否要/i.test(replyText);
}

const failed = (c: RunnerToolCall) => c.isError === true || refusalCodeOf(c.output) !== undefined;

/** Decide how the write door answered (the ordered rules in the module header). */
export function observedAnswer(turn: ParsedTurn, object: string, writes: number): ObservedAnswer {
  const calls = writeCallsOn(turn, object);
  if (writes > 0 || calls.some((c) => c.output !== undefined && !failed(c))) return { kind: 'applied' };
  const codes = calls.map((c) => refusalCodeOf(c.output)).filter((c): c is string => c !== undefined);
  if (codes.includes(CONFIRMATION_REQUIRED_CODE)) return { kind: 'pending_confirmation' };
  if (codes.length > 0) return { kind: 'refused', code: codes[codes.length - 1]! };
  if (calls.length === 0 && asksToConfirm(turn.replyText)) return { kind: 'pending_confirmation' };
  if (calls.length > 0) return { kind: 'refused', code: uncodedToolError };
  return { kind: 'refused', code: noWriteAttempted };
}

function matches(row: Row, where: Readonly<Record<string, Scalar>>): boolean {
  return Object.entries(where).every(([k, v]) => (v === null ? row[k] === null || row[k] === undefined : row[k] === v));
}

/** Per declared post-state, the rows the data API returned for its `id` / `where`. */
export function postStateRows(op: CardOperation, rowsByObject: Readonly<Record<string, readonly Row[]>>): Row[][] | undefined {
  if (op.outcome.kind !== 'applied') return undefined;
  return op.outcome.state.map((s) => {
    const rows = rowsByObject[s.object] ?? [];
    return s.id !== undefined ? rows.filter((r) => String(r.id) === s.id) : rows.filter((r) => matches(r, s.where ?? {}));
  });
}

export interface ObserveInput {
  op: CardOperation;
  turn: ParsedTurn;
  /** The operation object's rows before and after the turn. */
  before: readonly Row[];
  after: readonly Row[];
  /** Every object a declared post-state names, read after the turn. */
  rowsByObject: Readonly<Record<string, readonly Row[]>>;
  /** The persona the audit trail named for the touched row; `null` = named none; absent = not read. */
  auditActor?: string | null;
}

/** Assemble the observation the write grader takes. */
export function observeOperation(input: ObserveInput): OperationObservation {
  const writes = countWrites(input.before, input.after);
  const obs: OperationObservation = { answer: observedAnswer(input.turn, input.op.object, writes), writes };
  const state = postStateRows(input.op, input.rowsByObject);
  if (state) obs.state = state;
  if (input.auditActor !== undefined) obs.auditActor = input.auditActor;
  return obs;
}

/** The id of the row an applied operation touched: its target, or the first `where` match. */
export function touchedRowId(op: CardOperation, rowsByObject: Readonly<Record<string, readonly Row[]>>): string | undefined {
  if (op.target !== undefined) return op.target;
  const rows = postStateRows(op, rowsByObject);
  const first = rows?.[0]?.[0];
  return first ? String(first.id) : undefined;
}
