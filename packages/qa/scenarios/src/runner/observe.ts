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
 *     door's `{ error: { code, status } }` tool output), or, when it knocked on
 *     none, how the object answered the reads it made first;
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
 *   4. no write call, and the object's last answer to any other call on it
 *      (a read: `query_records`, `get_record`, …) was a coded refusal
 *                                                     → `refused <that code>`
 *   5. no write call, and the reply asks the person to confirm
 *                                                     → `pending_confirmation`
 *   6. a write call failed with no code               → `refused (tool error without a code)`,
 *                                                        noting the door's text and, when the text
 *                                                        is the sandbox's `<kind> '<name>' threw:`
 *                                                        wrapper, that the throw is the build's own
 *                                                        body ({@link uncodedNote})
 *   7. nothing attempted                              → `refused (no write attempted)`
 *
 * A coded answer keeps the envelope's `status` beside its `code`: the grader
 * reads an app-defined validation refusal by both (`refusalMeets`).
 *
 * Rule 4 is the overstep refused before any write: a persona that may not read
 * the object is refused on the read it needs first (the id of the row to
 * change), so a careful agent stops there and never knocks on the write door.
 * That refusal is still the object answering the persona with a code, and it
 * is graded as the operation's refusal. Only the object's LAST answer counts,
 * so a read that failed and was retried with success (a mistyped filter, then
 * the right one) does not stand in for a refusal.
 *
 * The two labels in 6 and 7 are deliberately not error codes: parenthesized
 * prose, outside the spec's catalogue and outside its spelling, so no card can
 * declare them and nobody can mistake one for a code a door answered. An
 * operation the agent never carried out, on an object that never refused it,
 * can never grade as the refusal the card expected.
 *
 * Two more facts serve a probed operation (`isProbedOperation`: the one a
 * card's `write_validation` guardrail names, #30883 item 2, and every other
 * refused create or update, a permission overstep, #31145 item 4), which the
 * grader judges in two halves:
 *
 *   - `withheld`: the agent sent no write on the object, nothing was written,
 *     and its reply declines the write (`declines`, the question grader's
 *     list) or names the value as invalid or asks for a correction
 *     (`asksToCorrect`) — a careful agent that caught the bad value first;
 *   - `probe`: after the turn, the runner sends the operation's declared write
 *     itself ({@link probeCall}), as the same persona through the same MCP
 *     write door, and reads the door's answer by rules 1–3 and 6 above
 *     ({@link observeProbe}) — the app's rule, measured whatever the agent did.
 *
 * And one fact serves every applied operation's dates: the dates the
 * platform's clock read during the turn ({@link clockDates}). The operation
 * prompt tells the agent the card's today (`asOf`); a default or a flow that
 * stamps the platform's own today writes the run date instead, so a declared
 * value equal to `asOf` is matched by either ({@link postStateRows}, and the
 * grader's `asOf`).
 */

import { ErrorCode } from '@objectstack/spec/api';

import type { ScenarioCard, Scalar } from '../schema.js';
import { declines, type ObservedAnswer, type OperationObservation, type ProbeObservation } from '../score/index.js';
import type { ToolAnswer } from './app.js';
import { refusalCodeOf, refusalOf, type ParsedTurn, type RunnerToolCall } from './transcript.js';

export type CardOperation = ScenarioCard['run']['operations'][number];
export type Row = Readonly<Record<string, unknown>>;

/** The write tools of the MCP data surface, and the business-action door. */
export const WRITE_TOOLS = ['create_record', 'update_record', 'delete_record', 'run_action'] as const;

export const noWriteAttempted = '(no write attempted)';
export const uncodedToolError = '(tool error without a code)';
/**
 * The confirmation gate's refusal, as the runner READS it. The runner emits no
 * code, so it holds no copy of one: the value is taken through the spec's
 * catalogue (`ErrorCode`, ADR-0112), which refuses at load if the code is ever
 * retired, instead of a literal that would silently stop matching. The code is
 * produced by the runtime's action door (`@objectstack/runtime`).
 */
export const CONFIRMATION_REQUIRED_CODE: ErrorCode = ErrorCode.parse('ACTION_CONFIRMATION_REQUIRED');

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

/**
 * The object's last coded answer to a call on it that is not a write — a read
 * the persona needed before writing — or `undefined` when its last answer was
 * not a coded refusal (or nothing on the object was called).
 */
export function lastReadRefusal(turn: Pick<ParsedTurn, 'toolCalls'>, object: string): string | undefined {
  return lastReadRefusalOf(turn, object)?.code;
}

function lastReadRefusalOf(turn: Pick<ParsedTurn, 'toolCalls'>, object: string): ReturnType<typeof refusalOf> {
  const reads = turn.toolCalls.filter((c) => {
    if ((WRITE_TOOLS as readonly string[]).includes(c.name) || c.output === undefined) return false;
    const input = (typeof c.input === 'object' && c.input !== null ? c.input : {}) as Record<string, unknown>;
    return input.objectName === object;
  });
  const last = reads[reads.length - 1];
  return last === undefined ? undefined : refusalOf(last.output);
}

/**
 * The sandbox's debug wrapper around a body's throw, `<kind> '<name>' threw:
 * <message>` (`@objectstack/runtime`'s quickjs runner): the throw is the
 * build's own hook or action body, by name.
 */
const BODY_THROW = /^(\w+) '([^']+)' threw: (?:Error: )?([\s\S]*)$/;

/**
 * What an answer with no code said, for the grader's detail (#31145 item 3):
 * whose throw it was when the text names a body of the build's (the MCP data
 * door renders a code-less throw as its bare message), else the door's text.
 */
export function uncodedNote(output: unknown): string {
  const raw = (typeof output === 'string' ? output : JSON.stringify(output ?? '')).trim();
  const clip = (t: string) => JSON.stringify(t.length > 200 ? `${t.slice(0, 200)}…` : t);
  const body = BODY_THROW.exec(raw);
  if (body) return `the build's own ${body[1]} '${body[2]}' threw ${clip(body[3]!.trim())}`;
  return `the door answered ${clip(raw)}`;
}

/** The reply asks the person to confirm before acting. Deterministic: a closed phrase list. */
export function asksToConfirm(replyText: string): boolean {
  return /\b(confirm|are you sure|shall i|should i|do you want me to|would you like me to|proceed\?)\b|确认|确定要|是否要/i.test(replyText);
}

/**
 * The reply names the value it was asked to write as invalid or incomplete, or
 * asks the person to correct or supply it. Deterministic: a closed phrase list.
 */
export function asksToCorrect(replyText: string): boolean {
  return /\b(?:please (?:provide|give|share|send|enter|supply|correct|fix|check|double-check|verify|confirm)|(?:could|can|would) you (?:please )?(?:provide|give|share|send|enter|supply|correct|fix|check|double-check|verify|clarify|confirm)|(?:what|which)(?: is|'s| should be) the (?:correct|right|full|complete|intended|actual|valid)|(?:not|isn't|is not|doesn't look like|does not look like) (?:a )?valid|invalid|incomplete|malformed|missing|required|insufficient|exceed(?:s|ed|ing)?)\b|请(?:提供|补充|更正|修正|确认|核对|检查)|无效|不是有效|不合法|格式不对|格式不正确|不完整|缺少|必填|超过|超出|不足/i.test(
    replyText,
  );
}

/** The agent sent no write on `object`, nothing was written, and the reply declines the write or asks for a correction. */
export function withheldWrite(turn: ParsedTurn, object: string, writes: number): boolean {
  return writeCallsOn(turn, object).length === 0 && writes === 0 && (declines(turn.replyText) || asksToCorrect(turn.replyText));
}

const failed = (c: RunnerToolCall) => c.isError === true || refusalCodeOf(c.output) !== undefined;

const refusedBy = (r: NonNullable<ReturnType<typeof refusalOf>>): ObservedAnswer =>
  r.status !== undefined ? { kind: 'refused', code: r.code, status: r.status } : { kind: 'refused', code: r.code };

/** Decide how the write door answered (the ordered rules in the module header). */
export function observedAnswer(turn: ParsedTurn, object: string, writes: number): ObservedAnswer {
  const calls = writeCallsOn(turn, object);
  if (writes > 0 || calls.some((c) => c.output !== undefined && !failed(c))) return { kind: 'applied' };
  const refusals = calls.map((c) => refusalOf(c.output)).filter((r) => r !== undefined);
  if (refusals.some((r) => r.code === CONFIRMATION_REQUIRED_CODE)) return { kind: 'pending_confirmation' };
  if (refusals.length > 0) return refusedBy(refusals[refusals.length - 1]!);
  const readRefusal = calls.length === 0 ? lastReadRefusalOf(turn, object) : undefined;
  if (readRefusal !== undefined) return refusedBy(readRefusal);
  if (calls.length === 0 && asksToConfirm(turn.replyText)) return { kind: 'pending_confirmation' };
  if (calls.length > 0) {
    const last = calls[calls.length - 1]!;
    return { kind: 'refused', code: uncodedToolError, ...(last.output !== undefined ? { note: uncodedNote(last.output) } : {}) };
  }
  return { kind: 'refused', code: noWriteAttempted };
}

/**
 * The card's today and the dates the platform's clock read during the run: a
 * `where` value declared as the card's today also matches a run date, as the
 * grader reads a declared value (`GradeOperationOptions.asOf`).
 */
export interface DeclaredToday {
  asOf?: string;
  runDates?: readonly string[];
}

function matches(row: Row, where: Readonly<Record<string, Scalar>>, today: DeclaredToday): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (row[k] === v) return true;
    return today.asOf !== undefined && v === today.asOf && typeof row[k] === 'string' && (today.runDates ?? []).includes(row[k] as string);
  });
}

/** Per declared post-state, the rows the data API returned for its `id` / `where`. */
export function postStateRows(op: CardOperation, rowsByObject: Readonly<Record<string, readonly Row[]>>, today: DeclaredToday = {}): Row[][] | undefined {
  if (op.outcome.kind !== 'applied') return undefined;
  return op.outcome.state.map((s) => {
    const rows = rowsByObject[s.object] ?? [];
    return s.id !== undefined ? rows.filter((r) => String(r.id) === s.id) : rows.filter((r) => matches(r, s.where ?? {}, today));
  });
}

/**
 * The dates a platform clock may have read between `instants`: each one's UTC
 * date and the runner's local date (the app runs on the runner's machine),
 * distinct and ascending. The run's dates, as `OperationObservation.runDates`.
 */
export function clockDates(...instants: readonly Date[]): string[] {
  const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return [...new Set(instants.flatMap((d) => [d.toISOString().slice(0, 10), local(d)]))].sort();
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
  /** A probed operation's probe ({@link observeProbe}); absent = not run. */
  probe?: ProbeObservation;
  /** The card's today (`asOf`) and the dates the clock read during the turn ({@link clockDates}). */
  today?: DeclaredToday;
}

/** Assemble the observation the write grader takes. */
export function observeOperation(input: ObserveInput): OperationObservation {
  const writes = countWrites(input.before, input.after);
  const obs: OperationObservation = {
    answer: observedAnswer(input.turn, input.op.object, writes),
    writes,
    withheld: withheldWrite(input.turn, input.op.object, writes),
  };
  const state = postStateRows(input.op, input.rowsByObject, input.today);
  if (state) obs.state = state;
  if (input.today?.runDates !== undefined) obs.runDates = input.today.runDates;
  if (input.auditActor !== undefined) obs.auditActor = input.auditActor;
  if (input.probe !== undefined) obs.probe = input.probe;
  return obs;
}

/** The MCP tool call that makes an operation's declared write. */
export interface ProbeCall {
  tool: 'create_record' | 'update_record';
  args: { objectName: string; recordId?: string; data: Record<string, unknown> };
}

/**
 * A probed operation's declared write (`isProbedOperation`: the validation
 * operation, or a permission overstep) as the MCP tool call that makes it:
 * what the runner sends as the acting persona after the agent's turn. `values`
 * are the operation's declared values as the app holds them (a user handle
 * already replaced by its user's id, as the seed loads it).
 */
export function probeCall(op: CardOperation, values: Readonly<Record<string, unknown>>): ProbeCall {
  if (op.kind === 'create') return { tool: 'create_record', args: { objectName: op.object, data: { ...values } } };
  if (op.kind === 'update' && op.target !== undefined) {
    return { tool: 'update_record', args: { objectName: op.object, recordId: op.target, data: { ...values } } };
  }
  throw new RangeError(`${op.id}: a \`${op.kind}\` is not a write the probe sends`);
}

/**
 * How the write door answered the probe, read by the rules a write call is
 * read by (1–3 and 6 of the header), over the object's rows before and after it.
 */
export function observeProbe(call: ProbeCall, answer: ToolAnswer, before: readonly Row[], after: readonly Row[]): ProbeObservation {
  const writes = countWrites(before, after);
  const turn: ParsedTurn = {
    replyText: '',
    toolCalls: [{ name: call.tool, rawName: call.tool, input: call.args, output: answer.output, ...(answer.isError ? { isError: true } : {}) }],
    meta: {},
  };
  return { answer: observedAnswer(turn, call.args.objectName, writes), writes };
}

/** The id of the row an applied operation touched: its target, or the first `where` match. */
export function touchedRowId(op: CardOperation, rowsByObject: Readonly<Record<string, readonly Row[]>>, today: DeclaredToday = {}): string | undefined {
  if (op.target !== undefined) return op.target;
  const rows = postStateRows(op, rowsByObject, today);
  const first = rows?.[0]?.[0];
  return first ? String(first.id) : undefined;
}
