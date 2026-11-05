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
 *  - A LOCATOR param is the one exception to "params are the interpolated
 *    values": a structured reading of the fault `detail` renders, taken off
 *    the engine's error object rather than out of the text. `invalid-cel`'s
 *    `celCode` (what `detail` names in prose) and `pos` (where its `^` points)
 *    are the two (#27904). Like every optional param they are present exactly
 *    when the engine reported them, and never guessed.
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

/**
 * The params every `type-mismatch*` code interpolates: the CEL operand types,
 * the `operator`, what the field holds, and the field as written when known.
 * The codes differ in the outcome their sentence states, never in params.
 */
interface TypeMismatchParams {
  readonly operands: string;
  readonly operator: string;
  readonly held: 'text' | 'boolean';
  readonly reference?: string;
}

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
  /**
   * The CEL engine refused the source; the prescription is "write bare CEL".
   * `celCode` and `pos` are LOCATOR params (see the contract above) — read for
   * an editor that says what is wrong, and where, in its own words.
   */
  'invalid-cel': {
    readonly role: CelFieldRole;
    readonly detail: string;
    /**
     * cel-js's own structured code for the fault, as cel-js spells it: the
     * parser's for a syntax fault (`unexpected_token` — an operand or the
     * expression's end is missing; `expected_token` — a closing `)` / `]` /
     * `}` or `:` is missing; `unexpected_character`; `unterminated_string`;
     * `invalid_number`, …) or the checker's for a type fault
     * (`no_such_overload`, …). An open vocabulary: an editor maps the codes it
     * knows and falls back to `detail` for the rest. Absent when the engine
     * named none.
     */
    readonly celCode?: string;
    /**
     * Where in `source` the fault is: UTF-16 offsets as JavaScript indexes a
     * string, `end` exclusive, so `source.slice(start, end)` is the text the
     * engine points at — empty, with `start === source.length`, for a fault at
     * the end such as a missing `)`. Absent when the engine reported no range,
     * or read a source the platform rewrote before parsing (a range into that
     * text would point at characters the author never wrote).
     */
    readonly pos?: { readonly start: number; readonly end: number };
  };
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
  /**
   * `record.<field>` naming no field of the object — or, for a declared read
   * attachment (`ExprSchemaHint.attachedOnRead`), `record.<block>.<leaf>`
   * naming no leaf of the block: then `field` is the dotted path as written
   * and `suggestion` the nearest declared leaf, also dotted. `block` and
   * `leaves` are present together, exactly when the message carries the clause
   * naming the leaves the block declares.
   */
  'unknown-field': {
    readonly field: string;
    readonly objectName?: string;
    readonly suggestion?: string;
    readonly block?: string;
    readonly leaves?: readonly string[];
  };
  /** A role-membership test naming a role outside the catalog; `catalog` is every valid role. */
  'unknown-role': { readonly name: string; readonly suggestion?: string; readonly catalog: readonly string[] };
  /** `name.…` one typo away from a root the surface binds; `roots` are the surface's declared roots. */
  'unbound-root': { readonly name: string; readonly roots: readonly string[]; readonly suggestion: string };
  /** A bare identifier in a `record`-scoped expression. */
  'bare-reference': { readonly name: string };
  /**
   * Arithmetic on a date field against a number. `operands` are the CEL
   * operand types; `reference` is the field as written, when it is known. A
   * flattened (flow) condition is `date-arithmetic-run-fails` /
   * `date-arithmetic-run-may-fail`; a fail-closed site is
   * `date-arithmetic-fail-closed`, and an advisory rule's is
   * `date-arithmetic-fail-open`.
   */
  'date-arithmetic': { readonly operands: string; readonly reference?: string };
  /**
   * Arithmetic on a date field's runtime TEXT that the evaluator cannot answer
   * (`record.end_date - record.start_date`), judged with the field declared as
   * that text. `operands` are the CEL operand types (the text is `DateText`);
   * `reference` is the field as written, when it is known. A flattened (flow)
   * condition is `date-text-arithmetic-run-fails` / `-run-may-fail`; a
   * fail-closed site is `date-text-arithmetic-fail-closed`, an advisory rule's
   * `date-text-arithmetic-fail-open`.
   */
  'date-text-arithmetic': { readonly operands: string; readonly reference?: string };
  /**
   * [#30016] ERROR: `date-arithmetic` in a flow condition whose run is proven
   * to hold the field there (`faultOutcome: 'run-fails'`) — the condition
   * faults, so the run fails at it. It never reads null.
   */
  'date-arithmetic-run-fails': { readonly operands: string; readonly reference?: string };
  /**
   * [#30016] ERROR: `date-arithmetic` in any other flow condition — it faults,
   * and so fails the run, wherever the name holds the field's date when the
   * condition runs; what the run binds under the name is not proven there.
   */
  'date-arithmetic-run-may-fail': { readonly operands: string; readonly reference?: string };
  /** [#30016] ERROR: `date-text-arithmetic`, at a `date-arithmetic-run-fails` site. */
  'date-text-arithmetic-run-fails': { readonly operands: string; readonly reference?: string };
  /** [#30016] ERROR: `date-text-arithmetic`, at a `date-arithmetic-run-may-fail` site. */
  'date-text-arithmetic-run-may-fail': { readonly operands: string; readonly reference?: string };
  /**
   * [#30250] ERROR: `date-arithmetic` at a site that FAILS CLOSED (an `error`
   * validation rule, a field write rule, an option `visibleWhen`, a hook
   * `condition`) — the fault refuses the write (or aborts the operation a
   * hook guards). It never reads null.
   */
  'date-arithmetic-fail-closed': { readonly operands: string; readonly reference?: string };
  /** [#30250] ERROR: `date-text-arithmetic`, at a `date-arithmetic-fail-closed` site. */
  'date-text-arithmetic-fail-closed': { readonly operands: string; readonly reference?: string };
  /**
   * [#30494] ERROR: `date-arithmetic` in an advisory (`warning` / `info`)
   * validation rule, a site that FAILS OPEN — the fault skips the rule and the
   * write proceeds (the `type-mismatch-fail-open` outcome). It never reads null.
   */
  'date-arithmetic-fail-open': { readonly operands: string; readonly reference?: string };
  /** [#30494] ERROR: `date-text-arithmetic`, at a `date-arithmetic-fail-open` site. */
  'date-text-arithmetic-fail-open': { readonly operands: string; readonly reference?: string };
  /**
   * A formula that computes a `google.protobuf.Duration`
   * (`today() - record.start_date`), which a field reads as `{}`. `reference`
   * is the date field it is computed from, when the expression names one.
   */
  'date-duration-value': { readonly reference?: string };
  /**
   * WARNING, never an error: a text or boolean field used with an arithmetic
   * or ordering `operator` against a number, at a `record`-scoped site where a
   * fault reads null (a formula field) or whose fault outcome the caller did
   * not declare. A flattened (flow) condition is `type-mismatch-run-may-fail`.
   */
  'type-mismatch': TypeMismatchParams;
  /**
   * [#29926] ERROR: the same mismatch at a site that FAILS CLOSED — the
   * expression faulting refuses the write (or aborts the operation a hook
   * guards). Served as `type-mismatch` with `outcome: 'fail-closed'` by #29904
   * until this code gave the sentence its own name.
   */
  'type-mismatch-fail-closed': TypeMismatchParams;
  /**
   * [#29926] ERROR: the same mismatch in a record-triggered flow's start or
   * edge condition — the run fails at the condition, the write that fired it
   * lands.
   */
  'type-mismatch-run-fails': TypeMismatchParams;
  /**
   * [#30250] ERROR: the same mismatch in a condition of a time-relative sweep
   * of the typed object (`ExprSchemaHint.timeRelativeSweep`) — the run for
   * that row fails at the condition; no write fired it, so nothing else
   * happens.
   */
  'type-mismatch-sweep-run-fails': TypeMismatchParams;
  /**
   * [#29926] ERROR: the same mismatch in an advisory (`warning` / `info`)
   * validation rule — the rule is skipped, the write proceeds, and the
   * advisory never fires.
   */
  'type-mismatch-fail-open': TypeMismatchParams;
  /**
   * [#29959] WARNING, never an error: the same mismatch in a flow condition
   * whose caller declared no fault outcome — a flow that is not
   * record-triggered, or a node condition nothing evaluates. A flow condition
   * that faults fails the run (it never reads null), but what the run binds
   * under the name is not proven to be the field's value there.
   */
  'type-mismatch-run-may-fail': TypeMismatchParams;
  /**
   * WARNING, never an error: a bare identifier in a flattened condition that
   * is one typo away from a field. Absent `objectName` reads "the trigger object".
   */
  'field-near-miss': { readonly name: string; readonly suggestion: string; readonly objectName?: string };
  /** A reference field read both through the relationship and as a plain value. */
  'traversal-bare-and-traversed': { readonly root: string; readonly field: string };
  /** A reference field read through more than one relationship hop. */
  'traversal-multi-hop': { readonly root: string; readonly field: string };
  /**
   * `label(record.<field>)` naming a declared field that declares no options
   * (`ExprSchemaHint.optionFields`, #28659). The message is the evaluator's own
   * fault sentence for that call.
   */
  'label-field-no-options': { readonly field: string };
  /** `collectCelRootIdentifiers` was handed no expression. */
  'empty-expression': Readonly<Record<string, never>>;
  /** `collectCelRootIdentifiers` could not parse the source; `detail` is the parser's reason. */
  'cel-parse-failed': { readonly detail: string };
}

/** Every refusal code this package emits. */
export type ExpressionRefusalCode = keyof ExpressionRefusalParams;

/**
 * One refusal's `code` and `params`, correlated: narrowing on `code` narrows
 * `params`. `Codes` restricts it to the codes one producer emits.
 */
export type ExpressionRefusal<Codes extends ExpressionRefusalCode = ExpressionRefusalCode> = {
  [Code in Codes]: { readonly code: Code; readonly params: ExpressionRefusalParams[Code] };
}[Codes];

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
  'date-text-arithmetic': true,
  'date-arithmetic-run-fails': true,
  'date-arithmetic-run-may-fail': true,
  'date-text-arithmetic-run-fails': true,
  'date-text-arithmetic-run-may-fail': true,
  'date-arithmetic-fail-closed': true,
  'date-text-arithmetic-fail-closed': true,
  'date-arithmetic-fail-open': true,
  'date-text-arithmetic-fail-open': true,
  'date-duration-value': true,
  'type-mismatch': true,
  'type-mismatch-fail-closed': true,
  'type-mismatch-run-fails': true,
  'type-mismatch-sweep-run-fails': true,
  'type-mismatch-fail-open': true,
  'type-mismatch-run-may-fail': true,
  'field-near-miss': true,
  'traversal-bare-and-traversed': true,
  'traversal-multi-hop': true,
  'label-field-no-options': true,
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
