/**
 * Seed-value resolver.
 *
 * `Dataset.records` accepts {@link SeedValue} = primitive | Expression | array
 * | object — install-time resolution walks the tree and replaces any
 * Expression node with its evaluated result. This is what makes
 * `close_date: cel\`now() + duration("P30D")\`` resolve to *the customer's*
 * "today + 30 days" instead of the developer's compile-time clock.
 */

import { ExpressionSchema, type Expression } from '@objectstack/spec';

import type { EvalContext, EvalResult } from './types';
import { ExpressionEngine } from './registry';

export type SeedPrimitive = string | number | boolean | null | Date;
export type SeedValue = SeedPrimitive | Expression | SeedValue[] | { [key: string]: SeedValue };

/** Detect an Expression-shaped object without throwing on unrelated shapes. */
function isExpressionLike(value: unknown): value is Expression {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.dialect !== 'string') return false;
  return ExpressionSchema.safeParse(v).success;
}

/**
 * Recursively resolve a SeedValue. Records that contain Expression leaves are
 * evaluated with `ctx`; other values are passed through unchanged.
 *
 * Returns the first failure encountered. Callers (seed loader) typically
 * abort the whole record on failure rather than silently writing partial data.
 */
export function resolveSeed(
  value: SeedValue,
  ctx: EvalContext,
): EvalResult<unknown> {
  if (value === null || value === undefined) {
    return { ok: true, value };
  }
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return { ok: true, value };
  }
  if (value instanceof Date) {
    return { ok: true, value };
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const r = resolveSeed(item, ctx);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: true, value: out };
  }
  if (isExpressionLike(value)) {
    return ExpressionEngine.evaluate(value, ctx);
  }
  // Plain object — recurse field-by-field.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, SeedValue>)) {
    const r = resolveSeed(v, ctx);
    if (!r.ok) return r;
    out[k] = r.value;
  }
  return { ok: true, value: out };
}

/**
 * Resolve a single record (object of fields), pinning `ctx.now` so all
 * expressions within see one logical clock.
 */
export function resolveSeedRecord(
  record: Record<string, SeedValue>,
  ctx: EvalContext,
): EvalResult<Record<string, unknown>> {
  const pinnedCtx: EvalContext = { ...ctx, now: ctx.now ?? new Date() };
  const result = resolveSeed(record, pinnedCtx) as EvalResult<Record<string, unknown>>;
  return result;
}
