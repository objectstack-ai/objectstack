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

/** Supported expression dialects. */
export const ExpressionDialect = z.enum(['cel', 'js', 'cron']);
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
