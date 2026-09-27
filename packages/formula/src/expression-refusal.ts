// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The closed set of refusal CODES this package's expression producers emit —
 * `validateExpression`'s `errors[]` / `warnings[]` and
 * `collectCelRootIdentifiers`'s failure arm — each with the typed PARAMS its
 * English `message` interpolates.
 *
 * ## Why a code beside the message
 *
 * The `message` is written for self-correction (ADR-0032 §Decision 1d) and it
 * is English: an API caller, the CLI and the `validate_expression` agent tool
 * read it as it is. A localized author surface cannot translate a sentence it
 * does not own, and matching the English with a pattern would bind the consumer
 * to wording this package rewrites whenever a prescription improves. So every
 * refusal also carries a stable `code` and the variable parts as `params`, and
 * a consumer keys its own catalogue row to the code and fills the row from the
 * params. The `message` is unchanged by this: it is the same sentence, byte for
 * byte, that the refusal carried before the code existed.
 *
 * ## The contract
 *
 *  - A code names ONE message template. Two sentences that differ in more than
 *    an optional clause are two codes, so a catalogue row never has to branch
 *    on a param to pick its wording. Optional clauses (a did-you-mean, an
 *    object name) are optional params: present exactly when the English
 *    message carries that clause.
 *  - Codes are kebab-case and never change once published. A new refusal is a
 *    new code; a reworded message keeps its code.
 *  - Params are the interpolated values, not their rendering: a list is an
 *    array (the consumer joins it), a quoted reference is the bare text (the
 *    consumer quotes it), and a phrase chosen from a closed set is a token.
 *  - `detail` is a diagnostic the CEL or template engine wrote — English, and
 *    for CEL with an excerpt of the source. It is passed through as it is;
 *    this package does not own its wording.
 *
 * ⛔ Not an ADR-0112 error code. These are authoring diagnostics delivered as a
 * function's return value, never a failing request's `error.code`, which is
 * why they are kebab-case and not SCREAMING_SNAKE.
 */

import type { CelLimitKey } from './cel-engine';
import type { FieldRole } from './validate';

/** The CEL-dialect field roles — every role but `template`. */
export type CelFieldRole = Exclude<FieldRole, 'template'>;

/**
 * What a non-text envelope `source` was, as a token. The message renders it
 * with its article (`an array`, `a number`).
 */
export type ExpressionSourceKind = 'array' | 'object' | 'number' | 'boolean' | 'bigint' | 'symbol' | 'function';

/** Code → the params its message interpolates. The keys ARE the closed set. */
export interface ExpressionRefusalParams {
  /** An envelope whose `source` is present but is not text. */
  'envelope-source-not-text': { readonly role: FieldRole; readonly found: ExpressionSourceKind };
  /** A `template` slot holding an envelope of another dialect. */
  'template-dialect-mismatch': { readonly dialect: string };
  /** The template engine refused the text; `detail` is its reason. */
  'invalid-template': { readonly detail: string };
  /** A single-brace `{ref}` where a template hole needs `{{ ref }}`. */
  'template-single-brace': { readonly ref: string };
  /** A CEL slot holding an envelope of another dialect. */
  'cel-dialect-mismatch': { readonly dialect: string };
  /** The CEL engine refused the source; the prescription is "write bare CEL". */
  'invalid-cel': { readonly role: CelFieldRole; readonly detail: string };
  /**
   * Valid CEL over one of the platform's parse budgets. `limit` and
   * `limitValue` are present together when the bound is known, and absent
   * together when it is not.
   */
  'cel-too-large': {
    readonly role: CelFieldRole;
    readonly detail: string;
    readonly limit?: CelLimitKey;
    readonly limitValue?: number;
  };
  /**
   * A bare-callable function written as a method (`record.name.upper()`).
   * `receiver` is the plain dotted chain it was called on, when one can be
   * lifted from the source.
   */
  'cel-method-call': {
    readonly role: CelFieldRole;
    readonly detail: string;
    readonly name: string;
    readonly receiver?: string;
  };
  /** A call to a name that is not callable here; `suggestion` is the nearest advertised one. */
  'cel-unknown-function': {
    readonly role: CelFieldRole;
    readonly detail: string;
    readonly name: string;
    readonly suggestion?: string;
  };
  /** The CEL engine refused a source that holds a template brace `{ref}`. */
  'cel-template-brace': { readonly role: CelFieldRole; readonly detail: string; readonly ref: string };
  /** `record.<field>` naming no field of the object. */
  'unknown-field': { readonly field: string; readonly objectName?: string; readonly suggestion?: string };
  /** A role-membership test naming a role outside the catalog; `catalog` is every valid role. */
  'unknown-role': { readonly name: string; readonly suggestion?: string; readonly catalog: readonly string[] };
  /** `name.…` one typo away from a root the surface binds; `roots` are the surface's declared roots. */
  'unbound-root': { readonly name: string; readonly roots: readonly string[]; readonly suggestion: string };
  /** A bare identifier in a `record`-scoped expression. */
  'bare-reference': { readonly name: string };
  /**
   * Arithmetic on a date field against a number. `operands` are the CEL
   * operand types; `reference` is the field as written, when it is known.
   */
  'date-arithmetic': { readonly operands: string; readonly reference?: string };
  /**
   * WARNING, never an error: a text or boolean field used with an arithmetic
   * or ordering `operator` against a number.
   */
  'type-mismatch': {
    readonly operands: string;
    readonly operator: string;
    readonly held: 'text' | 'boolean';
    readonly reference?: string;
  };
  /**
   * WARNING, never an error: a bare identifier in a flattened condition that
   * is one typo away from a field. Absent `objectName` reads "the trigger object".
   */
  'field-near-miss': { readonly name: string; readonly suggestion: string; readonly objectName?: string };
  /** A reference field read both through the relationship and as a plain value. */
  'traversal-bare-and-traversed': { readonly root: string; readonly field: string };
  /** A reference field read through more than one relationship hop. */
  'traversal-multi-hop': { readonly root: string; readonly field: string };
  /** `collectCelRootIdentifiers` was handed no expression. */
  'empty-expression': Readonly<Record<string, never>>;
  /** `collectCelRootIdentifiers` could not parse the source; `detail` is the parser's reason. */
  'cel-parse-failed': { readonly detail: string };
}

/** Every refusal code this package emits. */
export type ExpressionRefusalCode = keyof ExpressionRefusalParams;

/**
 * One refusal's `code` and `params`, correlated: narrowing on `code` narrows
 * `params`. `C` restricts it to the codes one producer emits.
 */
export type ExpressionRefusal<C extends ExpressionRefusalCode = ExpressionRefusalCode> = {
  [K in C]: { readonly code: K; readonly params: ExpressionRefusalParams[K] };
}[C];

/** The codes `collectCelRootIdentifiers` emits. */
export type CelRootsRefusalCode = 'empty-expression' | 'cel-parse-failed';

/** The codes `validateExpression` emits, in `errors[]` and `warnings[]`. */
export type ExprValidationCode = Exclude<ExpressionRefusalCode, CelRootsRefusalCode>;

/**
 * Keyed by code so the compiler holds this list equal to
 * {@link ExpressionRefusalParams}: a code missing here, or one that is not a
 * key there, does not compile.
 */
const CODE_TABLE = {
  'envelope-source-not-text': true,
  'template-dialect-mismatch': true,
  'invalid-template': true,
  'template-single-brace': true,
  'cel-dialect-mismatch': true,
  'invalid-cel': true,
  'cel-too-large': true,
  'cel-method-call': true,
  'cel-unknown-function': true,
  'cel-template-brace': true,
  'unknown-field': true,
  'unknown-role': true,
  'unbound-root': true,
  'bare-reference': true,
  'date-arithmetic': true,
  'type-mismatch': true,
  'field-near-miss': true,
  'traversal-bare-and-traversed': true,
  'traversal-multi-hop': true,
  'empty-expression': true,
  'cel-parse-failed': true,
} as const satisfies Record<ExpressionRefusalCode, true>;

/**
 * The closed set, as a value — for a consumer that must prove it has a
 * catalogue row for every code, and for this package's own exhaustiveness pin.
 */
export const EXPRESSION_REFUSAL_CODES: readonly ExpressionRefusalCode[] = Object.freeze(
  Object.keys(CODE_TABLE) as ExpressionRefusalCode[],
);
