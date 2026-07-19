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
 * | `cel`   | `@objectstack/formula` (cel-js + ObjectStack stdlib) | formulas, predicates, seed dynamic values |
 * | `js`    | sandboxed L2 hook bodies (`isolated-vm` / `quickjs`) | mapping, hook bodies |
 * | `cron`  | `cron-parser` | job schedules |
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
export type ExpressionDialect = z.infer<typeof ExpressionDialect>;

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
export type ExpressionMeta = z.infer<typeof ExpressionMetaSchema>;

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
export type Expression = z.infer<typeof ExpressionSchema>;

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
 * Cron-typed input shape: a bare string is shorthand for `{ dialect: 'cron',
 * source }` (not `cel`). Use this for `schedule` / `cronExpression` fields so
 * authors can write `'0 9 * * 1-5'` without manually wrapping.
 */
export const CronExpressionInputSchema = z.union([
  z.string().min(1).transform((source): Expression => ({ dialect: 'cron', source })),
  ExpressionSchema,
]);
export type CronExpressionInput = z.input<typeof CronExpressionInputSchema>;

/**
 * Template-typed input shape: a bare string is shorthand for
 * `{ dialect: 'template', source }`. Use this for notification subjects/bodies,
 * titleFormat, prompt templates — anything with `{{var}}` interpolation.
 */
export const TemplateExpressionInputSchema = z.union([
  z.string().min(1).transform((source): Expression => ({ dialect: 'template', source })),
  ExpressionSchema,
]);
export type TemplateExpressionInput = z.input<typeof TemplateExpressionInputSchema>;

/**
 * Predicate — an Expression whose evaluation is expected to be boolean.
 * Spec layer cannot enforce return type at parse time; this alias exists for
 * intent documentation and future runtime type-check wiring.
 */
export const PredicateSchema = ExpressionSchema;
export type Predicate = z.infer<typeof PredicateSchema>;

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
