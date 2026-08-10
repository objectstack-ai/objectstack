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

import {
  DEFAULT_VALUE_TOKEN_CURRENT_USER,
  DEFAULT_VALUE_TOKEN_NOW,
  type DefaultValueToken,
  isNowDefaultToken,
  isRuntimeDefaultToken,
} from './default-value-tokens';
import { isMultiValueField, valueSchemaFor, type ValueShapeFieldDef } from './field-value.zod';
import { SystemObjectName } from '../system/constants/system-names';

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

/* ────────────────────────────────────────────────────────────────────────────
 * Per-token × per-type gating (#7127 — the FieldSchema consumer's table)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Field types `'NOW()'` may legally default.
 *
 * Exactly the three types BOTH resolvers already branch on: the engine's
 * `resolveNowDefault` produces the per-type stored form for `date` / `time` /
 * instant, and the SQL driver's `nowColumnDefault` emits a dialect-correct
 * physical DEFAULT for the same three. The docs promise the same set
 * (`content/docs/protocol/objectql/types.mdx`: "for `date`, `datetime`, and
 * `time` alike"). This codifies what the platform DOES — not narrowed to what
 * happens to be authored today (the shipped census is 131 × `datetime`, 0 ×
 * `date`/`time`; an artifact of authorship, not of support).
 */
export const NOW_DEFAULT_LEGAL_TYPES: ReadonlySet<string> = new Set(['datetime', 'date', 'time']);

/**
 * The refusal for a runtime-token default on a field it cannot legally
 * default, or `null` when the token is legal there. Returns message TEXT so
 * the consuming schema owns issue assembly; the text follows the
 * self-prescribing house style — it names the field, its type, the offending
 * token verbatim, why it cannot hold, and the legal alternatives.
 *
 * The table (#7127, decided on the issue):
 *
 * | token | legal on | why |
 * |---|---|---|
 * | `NOW()` | `datetime`, `date`, `time` | {@link NOW_DEFAULT_LEGAL_TYPES} |
 * | `current_user` | `user`; `lookup` with `reference: 'sys_user'` | the engine writes `String(execCtx.userId)` — a `sys_user.id`; #4560 records that id landing anywhere else |
 *
 * Both tokens resolve to a single SCALAR (`applyFieldDefaults` assigns one
 * string; a physical column DEFAULT is one value), so a multi-value field —
 * an inherently-multi type, or a multi-capable type flagged `multiple: true`
 * — refuses EVERY token before the per-token rules are consulted.
 */
export function defaultValueTokenIssue(
  def: ValueShapeFieldDef & { name?: string; reference?: string },
  dv: unknown,
): string | null {
  if (!isRuntimeDefaultToken(dv)) return null;
  const token: DefaultValueToken = isNowDefaultToken(dv)
    ? DEFAULT_VALUE_TOKEN_NOW
    : DEFAULT_VALUE_TOKEN_CURRENT_USER;
  const name = def.name ?? '<unnamed>';

  if (isMultiValueField(def)) {
    return (
      `Field "${name}" (${def.type}, multi-value): the default ${JSON.stringify(dv)} is the runtime token `
      + `\`${token}\`, which resolves to a single scalar — the engine's insert-time resolution assigns one `
      + 'value (applyFieldDefaults) and a physical column DEFAULT is one value; neither produces the array a '
      + 'multi-value field stores. Make the field single-valued, or write a literal array default.'
    );
  }

  if (token === DEFAULT_VALUE_TOKEN_NOW) {
    if (NOW_DEFAULT_LEGAL_TYPES.has(def.type)) return null;
    return (
      `Field "${name}" (${def.type}): the default ${JSON.stringify(dv)} is the runtime token \`NOW()\` — `
      + 'the insert-time clock, resolved by the engine and by the SQL column DEFAULT into a temporal stored '
      + `form — and a \`${def.type}\` field has no such form. It is legal only on \`datetime\`, \`date\`, or `
      + '`time`. Use one of those temporal types, or write a literal value this field can store. (Before this '
      + 'gate the engine silently intercepted the token even here and stored an ISO instant — an interception '
      + 'nobody chose; it is refused instead.)'
    );
  }

  // current_user — legal on `user`, and on a `lookup` targeting the user table.
  if (def.type === 'user') return null;
  if (def.type === 'lookup' && def.reference === SystemObjectName.USER) return null;
  const lookupAside = def.type === 'lookup'
    ? ` (this lookup targets ${def.reference ? `\`${def.reference}\`` : 'no declared object'}, not \`sys_user\`)`
    : '';
  return (
    `Field "${name}" (${def.type}): the default ${JSON.stringify(dv)} is the runtime token \`current_user\` — `
    + `resolved by the engine to the acting user's \`sys_user.id\` at insert time — and a \`${def.type}\` field `
    + `cannot hold one${lookupAside}. It is legal only on a \`user\` field or a \`lookup\` with `
    + "`reference: 'sys_user'` (#4560 records what happens when that id lands anywhere else). Use one of "
    + 'those, or write a literal record id.'
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Near-miss token spellings (#7127 Q5) — suggested, never accepted
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Predictable near-miss spellings of the runtime tokens, mapped to the token
 * the author probably meant — the `CONTEXT_TOKEN_SUGGESTIONS` pattern
 * (`./context-tokens.zod.ts`) applied to this vocabulary. Keyed on the
 * trimmed, lowercased spelling. The braced forms are the documented overlap
 * with the FILTER placeholder vocabulary (`{current_user_id}`), which does
 * not resolve in a `defaultValue`.
 *
 * Suggestions surface ONLY inside a refusal already happening on the literal
 * branch. They are deliberately never accepted as tokens, and a near-miss
 * that is a VALID literal for its field stays accepted in silence: widening
 * the token match would make a genuinely-intended literal unstorable
 * (`./default-value-tokens.ts` records that refusal; lint owns the catch).
 */
export const DEFAULT_VALUE_TOKEN_SUGGESTIONS: Readonly<Record<string, DefaultValueToken>> = {
  currentuser: DEFAULT_VALUE_TOKEN_CURRENT_USER,
  'current-user': DEFAULT_VALUE_TOKEN_CURRENT_USER,
  'current user': DEFAULT_VALUE_TOKEN_CURRENT_USER,
  '{current_user}': DEFAULT_VALUE_TOKEN_CURRENT_USER,
  current_user_id: DEFAULT_VALUE_TOKEN_CURRENT_USER,
  '{current_user_id}': DEFAULT_VALUE_TOKEN_CURRENT_USER,
  now: DEFAULT_VALUE_TOKEN_NOW,
  '{now}': DEFAULT_VALUE_TOKEN_NOW,
  current_datetime: DEFAULT_VALUE_TOKEN_NOW,
  current_time: DEFAULT_VALUE_TOKEN_NOW,
} as const;

/**
 * The runtime token a refused literal was probably reaching for, or
 * `undefined` when it resembles none. Exact token spellings never land here:
 * discrimination sends them down the token branch first, and this function
 * additionally refuses to answer for them so a direct caller cannot turn a
 * token into a "suggestion" of itself.
 */
export function suggestDefaultValueToken(dv: unknown): DefaultValueToken | undefined {
  if (typeof dv !== 'string') return undefined;
  // Key first: `isRuntimeDefaultToken` is a `v is string` guard, so its
  // negation narrows a `string` operand to `never` — dereferencing after the
  // guard is a type error, not just awkward.
  const key = dv.trim().toLowerCase();
  if (isRuntimeDefaultToken(dv)) return undefined;
  return DEFAULT_VALUE_TOKEN_SUGGESTIONS[key];
}
