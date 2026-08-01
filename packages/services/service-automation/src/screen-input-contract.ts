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
