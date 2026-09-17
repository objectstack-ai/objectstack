/**
 * Build-time normalization helpers.
 *
 * The CLI `objectstack compile` step walks the assembled `objectstack.json`
 * artifact and rewrites every Expression so that:
 *
 *  1. String shorthand input is replaced by `{ dialect: 'cel', source }`.
 *  2. The persisted envelope carries an `ast` field produced by the dialect
 *     engine, beside the canonical `source` the engine evaluates. `ast` is an
 *     optional opaque structured value; it never replaces `source`.
 *
 * Spec layer cannot do step 2 because it must remain dependency-free; this
 * package owns the engine import and therefore the AST step.
 */

import {
  ExpressionInputSchema,
  ExpressionSchema,
  type Expression,
  type ExpressionInput,
} from '@objectstack/spec';

import { ExpressionEngine } from './registry';
import type { EvalResult } from './types';

/**
 * Normalize an {@link ExpressionInput} (string shorthand OR full envelope) into
 * a fully-resolved {@link Expression} carrying both `source` and `ast`.
 *
 * Returns an EvalResult so the caller can render a structured compile error
 * pointing at the offending metadata path.
 */
export function normalizeExpression(input: ExpressionInput): EvalResult<Expression> {
  const parsed = ExpressionInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: 'parse', message: parsed.error.message },
    };
  }

  const expr = parsed.data as Expression;

  // Already AST-only — accept as-is.
  if (expr.ast !== undefined && expr.source === undefined) {
    return { ok: true, value: expr };
  }

  // Source-bearing: ask the dialect engine to compile. Failures surface here
  // as part of the build (no silent skip).
  const compiled = ExpressionEngine.compile(expr);
  if (!compiled.ok) {
    return compiled;
  }

  return {
    ok: true,
    value: {
      ...expr,
      ast: compiled.value,
    },
  };
}

/**
 * Walk an arbitrary JSON tree and normalize every embedded Expression in
 * place. Used by the build pipeline to traverse the assembled metadata
 * artifact. Returns the first error encountered (paired with the dotted path
 * for diagnostics) or `null` when fully clean.
 */
export function normalizeExpressionTree(
  root: unknown,
  path: string[] = [],
): { path: string; error: import('./types').EvalError } | null {
  if (root === null || typeof root !== 'object') return null;

  if (looksLikeExpression(root)) {
    const r = normalizeExpression(root as ExpressionInput);
    if (!r.ok) return { path: path.join('.'), error: r.error };
    Object.assign(root as Record<string, unknown>, r.value);
    return null;
  }

  if (Array.isArray(root)) {
    for (let i = 0; i < root.length; i++) {
      const r = normalizeExpressionTree(root[i], [...path, String(i)]);
      if (r) return r;
    }
    return null;
  }

  for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
    const r = normalizeExpressionTree(v, [...path, k]);
    if (r) return r;
  }
  return null;
}

function looksLikeExpression(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.dialect !== 'string') return false;
  return ExpressionSchema.safeParse(v).success;
}
