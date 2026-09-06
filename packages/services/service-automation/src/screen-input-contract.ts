// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Screen-input VALUE contract (#4477).
 *
 * A `screen` node's `config.fields` is a complete input contract — the author
 * declares the keys, their `required`-ness, and (via `visibleWhen`) when a
 * field is even asked for. Before this module the contract informed the CLIENT
 * dialog only: `POST …/runs/:runId/resume` folded whatever bag it was handed
 * straight into the flow variables, so a caller that skipped the dialog and
 * posted to `resume` directly bypassed every `required` the flow author wrote.
 * Missing required fields and undeclared keys alike completed the run.
 *
 * Screen flows are the one place where the declared field contract is the ONLY
 * contract — there is no object schema behind a screen node to catch a bad bag
 * downstream. The platform enforces the analogous contract everywhere else this
 * seam appears: action params (`validateActionParams`, ADR-0104 D2), record
 * writes (ADR-0113), approval `decisionOutputs` (#3447). This is that rule for
 * screen resume, deliberately built in the same shape — a PURE check returning
 * issues, with the disposition (reject with a 400-worthy refusal) owned by the
 * caller.
 */

import { isDeepStrictEqual } from 'node:util';

import type { ScreenFieldSpec, ScreenSpec } from '@objectstack/spec/contracts';
import type { FieldErrorCode } from '@objectstack/spec/api';

/** One violation of a screen's declared field contract. */
export interface ScreenInputIssue {
  /** The offending key — a declared field name, or the undeclared key sent. */
  field: string;
  /**
   * Which constraint the bag violated, from the field-level catalog
   * (ADR-0114 D2) — `required` and `unknown_field`. Typed as `FieldErrorCode`
   * rather than a local literal union for the reason `ActionParamIssue` gives:
   * a screen field, an action param and a record column must not drift into
   * three vocabularies for the same two conditions.
   *
   * NOT an `error.code` (ADR-0112 D1). These are FIELD-ADDRESSED validator
   * codes that ride inside the refusal's message; the refusal's own machine
   * code is the SCREAMING `INVALID_SCREEN_INPUT` the engine returns.
   */
  code: FieldErrorCode;
  message: string;
}

/**
 * Visibility verdict for one conditional field. `true`/`false` are answers;
 * `undefined` means the predicate could not be evaluated at all.
 */
export type ScreenFieldVisibility = boolean | undefined;

function isPresent(v: unknown): boolean {
  return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
}

/**
 * Whether a screen surfaces a field contract worth enforcing.
 *
 * Two screens deliberately declare NOTHING and so keep the historical
 * pass-through, mirroring `enforceActionParams`' "an action with no `params`
 * is untouched":
 *
 *  - an **object-form** screen (`kind: 'object-form'`) — its `fields` is empty
 *    by construction because the CLIENT renders the object's own form, persists
 *    the record through the normal write path (which enforces the object's
 *    `required` fields itself, ADR-0113) and resumes with only the saved id
 *    bound to `idVariable`. There is no flat field list to validate against,
 *    and validating the bag against `[]` would reject that id as undeclared.
 *  - a **message-only** screen (`waitForInput: true`, no fields) — a
 *    confirmation step. It declares no keys, so it constrains none.
 */
export function screenDeclaresInputContract(screen: ScreenSpec | undefined): boolean {
  if (!screen) return false;
  if (screen.kind === 'object-form') return false;
  return Array.isArray(screen.fields) && screen.fields.length > 0;
}

/**
 * Validate a submitted screen bag against the suspended node's declared fields.
 * Returns the list of issues (empty ⇒ conformant). Does NOT throw.
 *
 * Enforced, and nothing beyond it:
 *  - `required` presence for every field the caller was actually asked for;
 *  - undeclared keys.
 *
 * `visibleWhen` is resolved FIRST, by the caller-supplied {@link visibility}
 * probe, because a hidden field's `required` must not fire: the client never
 * showed it, so demanding it would dead-end the run at Submit — the exact
 * failure #3528 filed. A field whose predicate cannot be evaluated is treated
 * as hidden (its `required` is not enforced) rather than visible: the client is
 * the authority on what the user was shown, and an unevaluable predicate is not
 * evidence the field was on screen. It is reported to the caller so the
 * degradation is loud rather than silent. Its KEY stays accepted either way —
 * the author declared it, so it is never "undeclared".
 *
 * Value SHAPE (`type`) is out of scope here: a screen field's `type` is a
 * widget hint with no closed vocabulary, unlike an action param's field type.
 */
export function validateScreenInputs(
  fields: readonly ScreenFieldSpec[],
  bag: Record<string, unknown>,
  visibility: (field: ScreenFieldSpec) => ScreenFieldVisibility,
): ScreenInputIssue[] {
  const issues: ScreenInputIssue[] = [];
  const declared = new Map<string, ScreenFieldSpec>();
  for (const f of fields) if (f?.name) declared.set(f.name, f);

  for (const field of declared.values()) {
    if (field.required !== true) continue;
    if (isPresent(bag[field.name])) continue;
    // Conditional field: only a predicate that evaluates TRUE makes `required`
    // fire. `false` (hidden — not asked for) and `undefined` (unevaluable) both
    // leave it alone.
    if (field.visibleWhen != null && String(field.visibleWhen).trim() !== '') {
      if (visibility(field) !== true) continue;
    }
    issues.push({
      field: field.name,
      code: 'required',
      message: `Screen field "${field.name}" is required`,
    });
  }

  for (const key of Object.keys(bag)) {
    if (declared.has(key)) continue;
    issues.push({
      field: key,
      code: 'unknown_field',
      message: `Unknown screen field "${key}" — not declared on this screen`,
    });
  }

  return issues;
}

/**
 * The declared field names, for an error that tells a caller what it MAY send —
 * the same courtesy `decisionOutputs` already extends (#3447), and the
 * difference between a rejection an agent can self-correct from and one it
 * can only guess at.
 */
export function declaredScreenFieldNames(fields: readonly ScreenFieldSpec[]): string[] {
  return fields.map((f) => f?.name).filter((n): n is string => typeof n === 'string' && n.length > 0);
}

/**
 * A screen field, reduced to the three keys a satisfaction verdict turns on.
 * Structurally a {@link ScreenFieldSpec} subset, so the node executor can hand
 * its parsed `config.fields` straight in.
 */
export interface ScreenFieldContract {
  name: string;
  required?: boolean;
  visibleWhen?: string;
}

/** Why a screen was (or was not) satisfied without showing it — see {@link judgeHeadlessScreen}. */
export interface HeadlessScreenVerdict {
  /** `true` ⇒ the run may continue past this screen without suspending. */
  satisfied: boolean;
  /** Declared field names whose value this run's CALLER supplied (provenance-checked). */
  supplied: string[];
  /** Required fields with no usable bound value — the reason a candidate was refused. */
  missing: string[];
}

const NOTHING_SUPPLIED: HeadlessScreenVerdict = { satisfied: false, supplied: [], missing: [] };

/**
 * Whether a screen field's value in `context.params` came from the run's
 * CALLER rather than from the subject record the dispatcher seeded.
 *
 * This distinction is the whole safety story of {@link judgeHeadlessScreen},
 * because the params bag a flow action reaches the engine with is NOT the
 * caller's bag: `seedFlowActionParams` (`@objectstack/runtime`) returns
 * `{ ...record, recordId, <objectName>Id, ...params }`, so every column of the
 * subject row is in there whether the caller named it or not. Reading "the key
 * is in `params`" as "the caller supplied it" would let an INTERACTIVE console
 * run — which supplies nothing — skip a screen whose field happens to share a
 * name with a column of the record it was launched from.
 *
 * The record is one seed. **The row ID is the other**, and it is the one a
 * record leg alone cannot see: both doors put the launched row's id into
 * `params` under names that are NOT columns — `recordId` and the camelCase
 * `<object>Id` alias on the trigger door (`buildAutomationContext`, which sets
 * NO `context.record` at all), plus the action's declared `recordIdParam` on
 * the actions door (`seedFlowActionParams`). A screen field named like any of
 * them would otherwise read as caller-supplied on a run that supplied nothing,
 * and an interactive console launch would skip the screen. So those are
 * refused up front, by NAME for the two the executor can derive and by VALUE
 * (identical to the row id) for the third, whose name is action-level metadata
 * this executor cannot see.
 *
 * What remains proves caller provenance:
 *
 *  - the record has no such key at all ⇒ the record leg cannot be the source;
 *  - the record HAS the key but `params` holds a different value ⇒ the
 *    caller's bag overwrote it. The record spread copies the record's own
 *    value, so a run that supplied nothing carries the row's value here.
 *    Equality is therefore "indistinguishable", not "caller-set".
 *
 * The ambiguous case (same key, same value) resolves to NOT caller-supplied,
 * which costs a headless run a pause it might have been allowed to skip and
 * costs an interactive run nothing. That asymmetry is deliberate: every
 * uncertainty in this module must land on today's behaviour.
 *
 * **The record leg compares by VALUE, and had to (#15812).** Written as
 * `Object.is` it asked about reference identity, which is real in memory — the
 * record spread copies by reference — and is destroyed by persistence. A
 * suspended run persists its `context` as JSON (`suspended-run-store.ts`:
 * `JSON.stringify` on save, `parseJson` on load) and `resumeInternal` continues
 * the run with the parsed value; `loadSuspendedRunStrict` prefers the store
 * over the hot cache whenever one is wired, so this needs no process restart.
 * After that round trip a NON-primitive column value (an array, an object) is
 * equal but no longer identical, the record leg could not disprove it, and a
 * later all-optional screen was SKIPPED on a run that had supplied nothing —
 * measured end to end through a wired store, which is the failure #15705 exists
 * to prevent. Primitive columns were never affected (`Object.is('x','x')` is
 * true across a round trip), which is exactly why the hole was invisible to
 * every in-memory unit test.
 *
 * `isDeepStrictEqual` compares primitives with `Object.is` itself, so this is a
 * strict WIDENING of the old predicate: every pair the identity check called
 * equal it still calls equal, plus the structurally-identical non-primitives.
 * The widened set is "not caller-supplied", i.e. more pauses, so the change can
 * only move runs toward this module's standing direction. The price is that a
 * caller who genuinely re-sends a value identical to the row's is no longer
 * distinguishable from the seed and gets the screen rendered — a lost skip, not
 * a lost run, and the same trade every other leg here already makes.
 *
 * ⛔ The row-id leg above deliberately keeps `Object.is`: a row id is a scalar
 * by construction (`params.recordId` is seeded as one, `record.id` is one), so
 * serialisation cannot defeat it and there is nothing there to widen.
 */
function callerSupplied(
  name: string,
  context: { params?: Record<string, unknown>; record?: Record<string, unknown>; object?: string } | undefined,
): boolean {
  const params = context?.params;
  if (!params || params[name] === undefined) return false;
  // Row-id seeds first: neither leg below can disprove them, because the
  // trigger door sets no record and none of these names is a column.
  const objectName = typeof context?.object === 'string' ? context.object.trim() : '';
  // The camelCase alias both doors seed, derived the same way they derive it.
  const aliasKey = objectName
    ? `${objectName.replace(/_([a-z])/g, (_m: string, c: string) => c.toUpperCase())}Id`
    : undefined;
  if (name === 'recordId' || (aliasKey !== undefined && name === aliasKey)) return false;

  const record = context?.record;
  const value = params[name];
  // The action's declared `recordIdParam` seeds a THIRD name this executor
  // cannot know — action-level metadata is not on the context — so its VALUE
  // is what refuses it. The dispatcher seeds the SAME row id under every id
  // key it knows, which makes the id recoverable from the bag itself:
  //
  //  - `params.recordId`, always seeded, and the only candidate that survives
  //    a NON-DEFAULT `recordIdField`. That case is why this leg exists: with
  //    `recordIdField: 'token'` the row id is `record.token`, so comparing
  //    against `record.id` alone missed it and the screen was SKIPPED, not
  //    paused — measured, then pinned.
  //  - the camelCase alias's value, seeded the same way, as a second reading
  //    of the same id for the case where a record column shadows `recordId`;
  //  - `record.id`, which covers the record-bearing doors directly.
  //
  // A caller who genuinely sends the row id as a screen value only loses the
  // skip, which is this module's standing failure direction.
  const seededRowIds: unknown[] = [params.recordId, record?.id];
  if (aliasKey !== undefined) seededRowIds.push(params[aliasKey]);
  if (seededRowIds.some((id) => id !== undefined && Object.is(value, id))) return false;

  if (!record || !Object.prototype.hasOwnProperty.call(record, name)) return true;
  // BY VALUE, not by identity (#15812) — see the note above. `Object.is` here
  // read as "the caller overwrote the column" for any non-primitive value that
  // had been through the durable store's JSON round trip.
  return !isDeepStrictEqual(value, record[name]);
}

/**
 * Can this screen be treated as already answered, and the run continued,
 * without suspending to show it? (#15705)
 *
 * The defect this answers: an `ai.exposed` action whose target is a screen
 * flow could be STARTED over MCP and never finished. `run_action` seeds the
 * flow's `isInput` variables from the caller's `params` — correctly — and the
 * screen node then suspended anyway, because the only inputs to that decision
 * were "does the node declare fields" and the author's `waitForInput` flag.
 * The MCP tool set has no resume verb, so the run parked forever.
 *
 * ⛔ NOT a general "skip screens" switch. Three conditions must ALL hold, and
 * the verdict is `false` the moment any of them is unproven:
 *
 *  1. **The caller supplied at least one of THIS screen's declared fields**
 *     ({@link callerSupplied}) — which refuses the row-id keys both dispatch
 *     doors seed, so a launch that carried only a `recordId` has supplied
 *     nothing. Without this leg a screen whose fields are all
 *     optional would be vacuously "satisfied" and would stop rendering for
 *     everyone — the loudest way to break the interactive path. A run that
 *     named none of this screen's fields is not driving it, so it pauses.
 *  2. **Every `required` field has a usable value bound** in the live flow
 *     variables — judged by {@link validateScreenInputs}, the same function
 *     the resume door enforces the same contract with, so "present" cannot
 *     drift into two meanings (an empty string is absent on both).
 *  3. Only caller-supplied names enter the bag, so a required field bound
 *     from the record, from a prior node or from a declared `defaultValue`
 *     does NOT count as answered. Optional fields are free to come from
 *     anywhere — they constrain nothing.
 *
 * **`visibleWhen` is enforced here, the OPPOSITE of the resume door**, and the
 * asymmetry is the point rather than an oversight. On resume, an unevaluable
 * predicate must not fire `required`: the client is the authority on what the
 * user was shown, and demanding a hidden field dead-ends a run at Submit
 * (#3528). Here the server has no client and no collected values, so it cannot
 * evaluate the predicate either — but refusing costs nothing except a pause,
 * which is exactly what this screen does today. So a conditional required field
 * the caller did not name keeps the screen interactive.
 */
export function judgeHeadlessScreen(
  fields: readonly ScreenFieldContract[],
  variables: ReadonlyMap<string, unknown>,
  context: { params?: Record<string, unknown>; record?: Record<string, unknown>; object?: string } | undefined,
): HeadlessScreenVerdict {
  const declared = fields.filter((f) => typeof f?.name === 'string' && f.name.length > 0);
  if (declared.length === 0) return NOTHING_SUPPLIED;

  const supplied: string[] = [];
  const bag: Record<string, unknown> = {};
  for (const field of declared) {
    if (!callerSupplied(field.name, context)) continue;
    supplied.push(field.name);
    bag[field.name] = variables.get(field.name);
  }
  // Condition 1 — nobody drove this screen, so it stays interactive.
  if (supplied.length === 0) return NOTHING_SUPPLIED;

  // Condition 2/3 — `unknown_field` cannot fire: every bag key is a declared
  // field by construction, so every issue returned here is a missing `required`.
  const issues = validateScreenInputs(declared, bag, () => true);
  return { satisfied: issues.length === 0, supplied, missing: issues.map((i) => i.field) };
}
