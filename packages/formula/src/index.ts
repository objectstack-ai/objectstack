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
export { cronEngine } from './cron-engine';
export { templateEngine, TEMPLATE_FORMATTERS, formatValue } from './template-engine';
export { registerStdLib, buildScope } from './stdlib';
export { resolveSeed, resolveSeedRecord } from './seed-eval';
export { normalizeExpression, normalizeExpressionTree } from './normalize';
// ADR-0032 — shared validator + introspection (one validator for build,
// registration, and the agent-callable validate_expression tool).
export { validateExpression, introspectScope, expectedDialect, CEL_STDLIB_FUNCTIONS } from './validate';
export type { FieldRole, ExprSchemaHint, ExprValidationError, ExprValidationResult } from './validate';
export type { SeedValue, SeedPrimitive } from './seed-eval';
export type { DialectEngine, EvalContext, EvalResult, EvalError } from './types';
