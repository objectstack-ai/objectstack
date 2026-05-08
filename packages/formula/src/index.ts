/**
 * @objectstack/formula
 *
 * Canonical expression engine for ObjectStack. CEL (Common Expression
 * Language) is the default dialect; `js` and `cron` are dispatched to
 * dedicated plugin engines.
 *
 * @see content/docs/concepts/north-star.mdx §8 "No private expression DSL"
 * @see ROADMAP.md M9 "Expression Unification"
 */

export { ExpressionEngine, getEngine, hasDialect, register } from './registry';
export { celEngine, DEFAULT_LIMITS } from './cel-engine';
export { registerStdLib, buildScope } from './stdlib';
export { resolveSeed, resolveSeedRecord } from './seed-eval';
export type { SeedValue, SeedPrimitive } from './seed-eval';
export type { DialectEngine, EvalContext, EvalResult, EvalError } from './types';
