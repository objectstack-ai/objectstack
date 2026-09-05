// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Expression Protocol
 *
 * Canonical wire format for all "expression"-shaped metadata across ObjectStack
 * (formula fields, predicates, conditions, criteria, visibility rules, seed
 * dynamic values, …).
 *
 * The persisted form is `{ dialect, source }` (and, after `objectstack
 * compile` normalization, `{ dialect, ast }`). String-only shorthand is
 * accepted at *input* time for developer ergonomics; build emits the canonical
 * envelope.
 *
 * ## Dialects
 *
 * | dialect | engine | use |
 * |:---|:---|:---|
 * | `cel`      | `@objectstack/formula` (cel-js + ObjectStack stdlib) | formulas, predicates, seed dynamic values |
 * | `cron`     | none at parse time — `croner` fires it at schedule time, on the one wired slot | job schedules |
 * | `template` | `{{var}}` interpolation at evaluate time (same variable scope as CEL) | notification subjects/bodies, `titleFormat`, prompt templates |
 *
 * No cron syntax is judged at parse time: `croner` evaluates a cron slot only
 * when `CronSchedule.expression` is scheduled (`toBoundaryJobSchedule` →
 * `CronJobAdapter`, where an invalid pattern is refused); every other
 * cron-typed slot is parsed and reaches no engine, and `@objectstack/formula`'s
 * registered `cron` engine has no caller outside that package.
 *
 * A TYPED slot — one declared with `CronExpressionInputSchema` or
 * `TemplateExpressionInputSchema` — takes a bare, non-blank string (shorthand
 * for its own dialect) or an envelope declaring that one dialect. An envelope
 * naming any other dialect, and a blank string, are refused at the slot with
 * one issue whose message names the dialect and the fix. Only the untyped
 * `ExpressionInputSchema` takes every declared dialect in envelope form.
 *
 * Those three are the whole list — it is exactly the `ExpressionDialect` enum
 * below. Procedural JavaScript is **not** a dialect: it is the L2 authoring
 * surface, the sandboxed, capability-gated `ScriptBody { language: 'js' }` in
 * hook/action bodies. A `js` row stood in this table long after the dialect was
 * retired in #3278 (ADR-0058 addendum); `ExpressionSchema` rejects
 * `dialect: 'js'`.
 *
 * SQL fragments (analytics joins, partial indexes) are intentionally **not**
 * routed through this schema — they stay driver-native because their security
 * posture and portability story differ.
 *
 * @see content/docs/concepts/north-star.mdx §8 "No private expression DSL"
 */

/**
 * Supported expression dialects.
 *
 * `js` was declared here but never shipped as an expression engine — it existed
 * only as a registry stub with no author helper (`cel`/`F`/`P` → CEL, `tmpl` →
 * template, `cron` → cron; nothing ever emitted `js`). Procedural JavaScript is
 * the L2 authoring surface — the sandboxed, capability-gated
 * `ScriptBody { language: 'js' }` in hook/action bodies — not an L1 expression
 * dialect. Retired in #3278; see ADR-0058 addendum.
 */
export const ExpressionDialect = z.enum(['cel', 'cron', 'template']);
export type ExpressionDialect = z.input<typeof ExpressionDialect>;

/**
 * Authorship metadata for an expression. Optional but encouraged for AI-
 * generated artifacts so audit/explanation tooling has something to render.
 */
export const ExpressionMetaSchema = z.object({
  /** Human-readable rationale (often AI-emitted). */
  rationale: z.string().optional(),
  /** Identifier of the agent / tool that produced this expression. */
  generatedBy: z.string().optional(),
});
export type ExpressionMeta = z.input<typeof ExpressionMetaSchema>;

/**
 * Canonical Expression envelope.
 *
 * Phase 1 (M9.1): `source` is the canonical persisted form. `ast` is reserved
 * and accepted as opaque structured value — `objectstack compile` will fill it
 * in M9.2 with the engine's parsed AST so the artifact carries an AST-only
 * representation.
 *
 * Phase 2 (M9.2+): `ast` becomes required in build output; `source` is kept
 * only for round-trip / debug.
 */
export const ExpressionSchema = z.object({
  /** Which engine evaluates `source` / `ast`. */
  dialect: ExpressionDialect,
  /** Surface syntax. Required while `ast` is not yet populated. */
  source: z.string().min(1).optional(),
  /**
   * Engine-native AST. Opaque at the spec layer; each engine validates its own
   * shape. For `dialect: 'cel'` this is the cel-js parsed AST node.
   */
  ast: z.unknown().optional(),
  /** Optional authorship metadata. */
  meta: ExpressionMetaSchema.optional(),
}).refine(e => e.source !== undefined || e.ast !== undefined, {
  message: 'Expression requires at least one of `source` or `ast`',
});
export type Expression = z.input<typeof ExpressionSchema>;

/**
 * The one sentence an EVALUATED slot refuses a non-evaluable envelope with —
 * the same words for both spellings of the seam (an `ast`-only envelope, a
 * `source` that is blank after trimming), so an author learns the rule before
 * the detail. Names what the engine needs and why, so the prescription travels
 * with the refusal.
 */
export const EVALUATED_EXPRESSION_SOURCE_REQUIRED =
  'An expression in an evaluated slot needs a non-blank `source`: the expression engine evaluates `source` '
  + '(the canonical persisted form of phase M9.1) and cannot evaluate `ast` alone, so an envelope carrying only '
  + '`ast`, or a `source` that is blank after trimming, would validate and register and then fault at run time. '
  + 'Write `{ dialect: \'cel\', source: \'…\' }`.';

/**
 * An {@link ExpressionSchema} envelope in an EVALUATED slot — a slot whose
 * value the expression engine runs (a flow `value` slot, a predicate the
 * engine gates on), as opposed to a slot that only PERSISTS the envelope.
 *
 * The rule is "an evaluated slot requires whatever the engine can actually
 * evaluate", and this schema spells out what that is TODAY: the CEL engine
 * evaluates `source` and refuses an envelope without one (`cel-engine.ts`
 * `evaluate`: "AST-only evaluation not yet supported; persist `source`" — its
 * own note revisits AST execution when the spec persistence cuts over). So
 * `source` is required here, and required to be non-blank after trimming —
 * the notion of blank the engine's own helpers apply (`source.trim()`), not a
 * third one. Two spellings of one seam are refused by this ONE rule, with one
 * message at `source`: `{ dialect: 'cel', ast }` (a valid Expression that no
 * engine runs) and `{ dialect: 'cel', source: '   ' }` (passes `min(1)`;
 * reads as "not authored" to `validateExpression`, which trims; the engine
 * parses it untrimmed and faults).
 *
 * `ExpressionSchema` itself is NOT narrowed: it is the persistence contract,
 * and its docblock declares that `ast` becomes required in build output at
 * phase M9.2. When AST-only evaluation lands, this schema is the one place to
 * revisit — relax `source` and require "`source` or `ast`, whichever the
 * engine evaluates" — and every evaluated slot composes it, so that flip is
 * one edit rather than a per-slot unwinding.
 *
 * Spelled as a property override rather than an object-level `.refine`, for a
 * measured reason: Zod runs an object's refinements even after a property has
 * failed (a `.refine` sibling reports `source: ''` twice — `min(1)` and the
 * refinement — and `{ dialect: 'cel' }` twice — the source-or-ast rule and the
 * refinement), while an aborting property issue skips them. This spelling
 * yields exactly one issue, this message, at `source`, for every refused
 * shape, and narrows the TYPE too (`source: string`) — the same move
 * `AssignmentExpressionValueSchema` makes for `dialect`, so an `ast`-only
 * envelope is a compile error before it is a parse error.
 */
export const EvaluatedExpressionSchema = ExpressionSchema.safeExtend({
  /**
   * Surface syntax — required and non-blank in an evaluated slot: it is what
   * the engine evaluates (M9.1), and `ast` alone cannot be run.
   */
  source: z.string({ error: () => EVALUATED_EXPRESSION_SOURCE_REQUIRED })
    .refine((source) => source.trim().length > 0, { message: EVALUATED_EXPRESSION_SOURCE_REQUIRED }),
});
export type EvaluatedExpression = z.input<typeof EvaluatedExpressionSchema>;
export type EvaluatedExpressionParsed = z.infer<typeof EvaluatedExpressionSchema>;

/**
 * Author-time input shape: a bare string is shorthand for `{ dialect: 'cel',
 * source }`. Engines that need other dialects must use the full envelope.
 *
 * Build (`objectstack compile`) normalizes this union to `Expression` so the
 * persisted artifact never contains the bare-string form.
 */
export const ExpressionInputSchema = z.union([
  z.string().min(1).transform((source): Expression => ({ dialect: 'cel', source })),
  ExpressionSchema,
]);
export type ExpressionInput = z.input<typeof ExpressionInputSchema>;

/**
 * The dialects that have a TYPED input schema below. On a typed slot the bare
 * string is shorthand for this dialect, and the envelope arm accepts this
 * dialect only.
 */
export type TypedExpressionDialect = Extract<ExpressionDialect, 'cron' | 'template'>;

/**
 * The one sentence a TYPED slot refuses a blank string with — empty or
 * whitespace-only, the notion of blank `EvaluatedExpressionSchema` applies
 * (`source.trim()`), so the two typed schemas and the evaluated one share one
 * rule. Its own words rather than {@link EVALUATED_EXPRESSION_SOURCE_REQUIRED},
 * because that sentence prescribes `{ dialect: 'cel', source }` — the one
 * envelope a typed slot refuses.
 */
export const TYPED_EXPRESSION_SOURCE_REQUIRED: Readonly<Record<TypedExpressionDialect, string>> = {
  cron:
    'A cron-typed slot needs a non-blank cron expression: a bare string is shorthand for '
    + '`{ dialect: \'cron\', source }`, and a blank one would normalize to an envelope with nothing to schedule. '
    + 'Write `\'0 9 * * 1-5\'` or `{ dialect: \'cron\', source: \'0 9 * * 1-5\' }`; no cron syntax is judged '
    + 'here — `croner` refuses an invalid pattern where a schedule is wired.',
  template:
    'A template-typed slot needs a non-blank template: a bare string is shorthand for '
    + '`{ dialect: \'template\', source }`, and a blank one would normalize to an envelope with nothing to '
    + 'interpolate. Write `\'{{record.name}}\'` or `{ dialect: \'template\', source: \'{{record.name}}\' }`.',
};

/**
 * The one sentence a TYPED slot refuses a foreign-dialect envelope with (and
 * any value that is neither a string nor an envelope). It names the slot's
 * dialect first, then the fix, so the prescription travels with the refusal.
 */
export const TYPED_EXPRESSION_DIALECT_ONLY: Readonly<Record<TypedExpressionDialect, string>> = {
  cron:
    'A cron-typed slot accepts a bare cron string or an envelope declaring `dialect: \'cron\'` only: an '
    + 'envelope naming another dialect would validate and then have nothing to schedule. '
    + 'Write `\'0 9 * * 1-5\'` or `{ dialect: \'cron\', source: \'0 9 * * 1-5\' }`.',
  template:
    'A template-typed slot accepts a bare template string or an envelope declaring `dialect: \'template\'` '
    + 'only: an envelope naming another dialect would validate and then have nothing to interpolate. '
    + 'Write `\'{{record.name}}\'` or `{ dialect: \'template\', source: \'{{record.name}}\' }`.',
};

/**
 * Build a typed input union: a bare, non-blank string (this dialect's
 * shorthand) or an {@link ExpressionSchema} envelope declaring this dialect.
 *
 * The refusal shape is measured, not assumed (zod 4.4): a union reports the
 * one arm that did not abort, else `invalid_union`. Both arms here abort on a
 * foreign value — the string arm is a pipe, whose transform aborts the arm on
 * any issue, and the envelope arm's `z.literal` aborts on a foreign dialect —
 * so every refusal is ONE `invalid_union` at the slot, and the union's own
 * error map is where the message lives: the source-required sentence for a
 * string input, the dialect-only sentence for everything else. A `.refine` on
 * the envelope arm would surface as `custom` at `dialect` instead, but would
 * leave the input TYPE, the JSON Schema and the generated reference page
 * declaring every dialect on a typed slot; the literal keeps all four surfaces
 * saying one thing. The one refusal `ExpressionSchema` carries — neither
 * `source` nor `ast` — still surfaces on its own, with its own message: that
 * arm does not abort on it.
 */
function typedExpressionInput<D extends TypedExpressionDialect>(dialect: D) {
  return z.union([
    z.string()
      .refine((source) => source.trim().length > 0, { message: TYPED_EXPRESSION_SOURCE_REQUIRED[dialect] })
      .transform((source): Expression => ({ dialect, source })),
    ExpressionSchema.safeExtend({ dialect: z.literal(dialect) }),
  ], {
    error: (issue) => (typeof issue.input === 'string'
      ? TYPED_EXPRESSION_SOURCE_REQUIRED[dialect]
      : TYPED_EXPRESSION_DIALECT_ONLY[dialect]),
  });
}

/**
 * Cron-typed input shape: a bare, non-blank string is shorthand for
 * `{ dialect: 'cron', source }`, and an envelope must declare `dialect: 'cron'`
 * — a `cel` or `template` envelope is refused at the slot, naming the fix
 * (`TYPED_EXPRESSION_DIALECT_ONLY.cron`), as is a blank string
 * (`TYPED_EXPRESSION_SOURCE_REQUIRED.cron`). Use this for `schedule` /
 * `cronExpression` fields so authors can write `'0 9 * * 1-5'` without
 * manually wrapping.
 *
 * No cron syntax is judged at parse time — `'not a cron'` normalizes like any
 * other string. `croner` judges the pattern where a schedule is wired
 * (`CronSchedule.expression` → `toBoundaryJobSchedule` → `CronJobAdapter`);
 * every other cron-typed slot reaches no engine, and no grammar is restated
 * here.
 */
export const CronExpressionInputSchema = typedExpressionInput('cron');
export type CronExpressionInput = z.input<typeof CronExpressionInputSchema>;

/**
 * Template-typed input shape: a bare, non-blank string is shorthand for
 * `{ dialect: 'template', source }`, and an envelope must declare
 * `dialect: 'template'` — a `cel` or `cron` envelope is refused at the slot,
 * naming the fix (`TYPED_EXPRESSION_DIALECT_ONLY.template`), as is a blank
 * string (`TYPED_EXPRESSION_SOURCE_REQUIRED.template`). Use this for
 * notification subjects/bodies, titleFormat, prompt templates — anything with
 * `{{var}}` interpolation. No template syntax is judged at parse time.
 */
export const TemplateExpressionInputSchema = typedExpressionInput('template');
export type TemplateExpressionInput = z.input<typeof TemplateExpressionInputSchema>;

/**
 * Predicate — an Expression whose evaluation is expected to be boolean.
 * Spec layer cannot enforce return type at parse time; this alias exists for
 * intent documentation and future runtime type-check wiring.
 */
export const PredicateSchema = ExpressionSchema;
export type Predicate = z.input<typeof PredicateSchema>;

export const PredicateInputSchema = ExpressionInputSchema;
export type PredicateInput = z.input<typeof PredicateInputSchema>;

/**
 * Construct an Expression literal from a CEL source string. Used by DX
 * shorthand (`cel\`...\``) and by codegen tools.
 */
export function expression(source: string, dialect: ExpressionDialect = 'cel', meta?: ExpressionMeta): Expression {
  return { dialect, source, ...(meta ? { meta } : {}) };
}

/**
 * Tagged-template helpers for inline expression authoring.
 *
 * <!-- os:check -->
 * ```ts
 * import { cel, F, P } from '@objectstack/spec';
 *
 * const f = { formula: F`record.amount * 0.1` };
 * const v = { visible: P`record.status == "open"` };
 * const d = { close_date: cel`now() + duration("P30D")` };
 * ```
 *
 * Each helper produces an {@link Expression} envelope with `dialect: 'cel'`
 * and the rendered template string as `source`. The CLI `objectstack compile`
 * step (M9.2) parses these into ASTs at build time so the persisted artifact
 * is dialect-AST only.
 */
function renderTemplate(strings: TemplateStringsArray, values: readonly unknown[]): string {
  if (values.length === 0) return strings[0] ?? '';
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    // Inline literal substitution. Strings get JSON-escaped so `${name}` for
    // `name = 'O\'Brien'` produces a valid CEL string literal. Numbers and
    // booleans render as their toString. Anything exotic should be passed via
    // the variable scope (record/input) rather than interpolated.
    if (typeof v === 'string') out += JSON.stringify(v);
    else if (typeof v === 'number' || typeof v === 'boolean') out += String(v);
    else if (v === null || v === undefined) out += 'null';
    else out += JSON.stringify(v);
    out += strings[i + 1] ?? '';
  }
  return out;
}

/** Tagged template — produces a CEL Expression envelope. */
export function cel(strings: TemplateStringsArray, ...values: unknown[]): Expression {
  return { dialect: 'cel', source: renderTemplate(strings, values) };
}

/** Formula alias of {@link cel} — semantic shorthand for computed-field formulas. */
export const F = cel;

/** Predicate alias of {@link cel} — semantic shorthand for boolean conditions. */
export const P = cel;

/**
 * Tagged template — produces a Mustache-template Expression envelope. Use for
 * notification subjects, prompt bodies, titleFormat strings, etc. Variable
 * scope is the same as CEL (`{{record.x}}`, `{{os.user.id}}`).
 */
export function tmpl(strings: TemplateStringsArray, ...values: unknown[]): Expression {
  // Templates do not get JSON.stringify on substitution — interpolation happens
  // at evaluate time via `{{path}}` markers, so we keep raw substitutions here.
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    out += String(values[i]);
    out += strings[i + 1] ?? '';
  }
  return { dialect: 'template', source: out };
}

/** Tagged template — produces a cron Expression envelope. */
export function cron(strings: TemplateStringsArray, ...values: unknown[]): Expression {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    out += String(values[i]);
    out += strings[i + 1] ?? '';
  }
  return { dialect: 'cron', source: out };
}
