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
 * Two legs, either of which proves caller provenance:
 *
 *  - the record has no such key at all ⇒ the record leg cannot be the source;
 *  - the record HAS the key but `params` holds a different value ⇒ the
 *    caller's bag overwrote it. `{ ...record }` copies the record's own value
 *    by reference/primitive, so a run that supplied nothing is `Object.is`-equal
 *    here, always. Equality is therefore "indistinguishable", not "caller-set".
 *
 * The ambiguous case (same key, same value) resolves to NOT caller-supplied,
 * which costs a headless run a pause it might have been allowed to skip and
 * costs an interactive run nothing. That asymmetry is deliberate: every
 * uncertainty in this module must land on today's behaviour.
 */
function callerSupplied(
  name: string,
  context: { params?: Record<string, unknown>; record?: Record<string, unknown> } | undefined,
): boolean {
  const params = context?.params;
  if (!params || params[name] === undefined) return false;
  const record = context?.record;
  if (!record || !Object.prototype.hasOwnProperty.call(record, name)) return true;
  return !Object.is(params[name], record[name]);
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
 *     ({@link callerSupplied}). Without this leg a screen whose fields are all
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
  context: { params?: Record<string, unknown>; record?: Record<string, unknown> } | undefined,
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
