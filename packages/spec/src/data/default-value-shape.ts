// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `defaultValue` shape discrimination — the ONE place that tells the three
 * legal shapes of an authored default apart (#7127; maintainer ruling
 * 2026-08-10: one discriminator, two consumers).
 *
 * An authored `defaultValue` is polymorphic by design. Three shapes are legal:
 *
 *   1. a **literal** — stored verbatim (`'open'`, `0`, `false`);
 *   2. a **runtime token** — `./default-value-tokens`' vocabulary (`'NOW()'`,
 *      `'current_user'`): an instruction resolved at insert time, never a
 *      value to store;
 *   3. an **Expression envelope** — `{ dialect: 'cel', source: 'today()' }`
 *      (ROADMAP §M9.9b), evaluated by `ExpressionEngine` at insert time.
 *
 * Any gate that judges a default against its owner's VALUE contract
 * (ADR-0104 D1, `valueSchemaFor`) must subtract shapes 2 and 3 FIRST.
 * Running the value contract over the whole key judges a token's SPELLING as
 * data, which is right only by accident: `'current_user'` passes a `user`
 * field as a would-be record id (nothing recognised it as a token), and
 * `'NOW()'` passes `text` as a plain string while the engine intercepts it
 * before the literal branch and stores an ISO instant instead. The
 * subtraction is therefore structural, runs first, and lives HERE — one
 * module the authoring gates and the engine's resolution order cannot drift
 * away from separately.
 *
 * # Consumers, and what each does with the verdict
 *
 * - **`FieldSchema`** (`./field.zod`, #7127): full discrimination — envelope
 *   accepted structurally, token gated per-token × per-type, literal checked
 *   through {@link checkLiteralDefaultValue}.
 * - **`ActionParamSchema`** (`../ui/action.zod`, #6970): NO discrimination,
 *   by design. An action param's default is a pure LITERAL — objectui's
 *   `ActionParamDialog` seeds dialog state with it verbatim and
 *   `serializeParamValues` resolves nothing — so a token spelling there is
 *   judged as the literal it would be at submit. That consumer calls
 *   {@link checkLiteralDefaultValue} directly and deliberately skips
 *   {@link discriminateDefaultValueShape}.
 *
 * # Presence is the CONSUMER's question — deliberately not answered here
 *
 * The two consumers disagree about absence, and both are right for their
 * surface: the engine treats `defaultValue == null` as absent and `''` as a
 * real default (`ObjectQL.applyFieldDefaults`, insert-only), while an action
 * param treats `''` as absent because the dispatcher's own presence predicate
 * does (`isActionParamValuePresent`). A shared presence rule would be wrong
 * for one of them, so each consumer applies its own BEFORE discriminating.
 */

import { isRuntimeDefaultToken } from './default-value-tokens';
import { valueSchemaFor, type ValueShapeFieldDef } from './field-value.zod';

/** The three legal shapes of a PRESENT `defaultValue`. */
export type DefaultValueShape = 'expression' | 'token' | 'literal';

/**
 * Is `dv` an Expression envelope, structurally? — an object with a truthy
 * `dialect` and a string `source`.
 *
 * This predicate is the ENGINE's, verbatim (`ObjectQL.applyFieldDefaults`):
 * recognition is by SHAPE, not by schema. A well-formed envelope with an
 * unknown dialect is still an envelope (its evaluation failing is an ADR-0032
 * runtime concern, surfaced as a `logger.warn`), and an object missing
 * `source` is NOT one — the engine falls through and stores it verbatim as a
 * literal. Matching the resolver's reachability exactly is the point: what
 * the engine treats as an instruction, an authoring gate must too, or the two
 * answer differently for the same declaration.
 */
export function isExpressionEnvelopeDefault(dv: unknown): boolean {
  return (
    typeof dv === 'object'
    && dv !== null
    && Boolean((dv as { dialect?: unknown }).dialect)
    && typeof (dv as { source?: unknown }).source === 'string'
  );
}

/**
 * Which of the three legal shapes is this (present) default?
 *
 * Discrimination order matches the engine's resolution order: envelope →
 * token → literal. Absence is the caller's question (see the module note);
 * a `null`/`undefined` handed in anyway falls out as `'literal'`.
 */
export function discriminateDefaultValueShape(dv: unknown): DefaultValueShape {
  if (isExpressionEnvelopeDefault(dv)) return 'expression';
  if (isRuntimeDefaultToken(dv)) return 'token';
  return 'literal';
}

/** Verdict of {@link checkLiteralDefaultValue}: `ok`, or the first contract violation. */
export interface LiteralDefaultValueVerdict {
  ok: boolean;
  /** First issue message from the value contract — the "why" a refusal carries verbatim. */
  detail?: string;
}

/**
 * Check a LITERAL default against its owner's own stored-form value contract
 * (`valueSchemaFor(def, 'stored')` — ADR-0104 D1). The shared core of the
 * #6970 action-param gate and the #7127 field gate: one rule set, one form
 * (`'stored'`), so the two authoring surfaces cannot drift into two dialects
 * of "what may this default hold".
 *
 * Callers discriminate (or deliberately decline to — see the module note)
 * BEFORE calling this: a runtime token or an Expression envelope is not a
 * literal and must never reach the value contract.
 */
export function checkLiteralDefaultValue(def: ValueShapeFieldDef, dv: unknown): LiteralDefaultValueVerdict {
  const result = valueSchemaFor(def, 'stored').safeParse(dv);
  if (result.success) return { ok: true };
  return { ok: false, detail: result.error.issues[0]?.message ?? 'invalid value' };
}
