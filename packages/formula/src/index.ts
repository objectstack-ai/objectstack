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
// #3447 P2 — root-identifier extraction for closed-root evaluation sites
// (approval `expression` approvers): lint and the runtime pre-check share this
// one helper so what they accept can never drift.
export { collectCelRootIdentifiers } from './cel-engine';
// #6128 — the strict-environment "does this identifier resolve?" oracle, the
// same one `validateExpression` gives its `record`-scoped bare-ref verdict from.
// Published for the same reason as `collectCelRootIdentifiers` above: a lint
// rule whose surface declares a DIFFERENT root set (`@objectstack/lint`'s
// view/page visibility gate binds `current_user` / `page` on top of
// SCOPE_ROOTS) needs this exact answer, and the alternative — rebuilding a
// strict `Environment` in the consumer — is the private-front-end mistake
// #4812 removed from that very package. One oracle, one answer to "what
// resolves", whichever surface is asking.
export { firstUndeclaredReference } from './cel-engine';
// #4812 — the canonical parse-to-AST entry. Any consumer that needs the AST of
// an authored CEL source takes it from here, so "what parses" has exactly ONE
// answer across build, lint and runtime. Building a private `new Environment()`
// instead silently opts out of the platform's rewrite AND its bounds.
export { parseCelToAst } from './cel-engine';
export type { CelAstNode } from './cel-engine';
export { cronEngine } from './cron-engine';
export { templateEngine, TEMPLATE_FORMATTERS, formatValue } from './template-engine';
export { registerStdLib, buildScope } from './stdlib';
export { resolveSeed, resolveSeedRecord } from './seed-eval';
export { normalizeExpression, normalizeExpressionTree } from './normalize';
// ADR-0058 — canonical CEL → FilterCondition pushdown compiler (one AST,
// two backends). Replaces the regex/celToFilter front-ends in plugin-security
// and plugin-sharing; honours ADR-0055 (no subquery / no cross-object traversal).
export { compileCelToFilter, isPushdownableCel, lowerCelAst } from './cel-to-filter';
export type { CelFilterCompileResult, CelFilterCompileOptions, CelFilterFailReason } from './cel-to-filter';
// ADR-0056 D4 / ADR-0058 D1 — the RLS predicate shape gate and its legacy
// SQL→CEL bridge. Hoisted out of plugin-security in #4983 so the runtime that
// enforces the predicate and the authoring gate that rejects it share ONE
// definition: `@objectstack/lint` may depend on this package and never on a
// runtime, so the alternative was forking the bridge, whose `=`/`IN` boundary
// conditions ARE the red/green line.
export { isSupportedRlsExpression, sqlPredicateToCel } from './rls-predicate';
export { matchesFilterCondition } from './matches-filter';
// ADR-0032 — shared validator + introspection (one validator for build,
// registration, and the agent-callable validate_expression tool).
export { validateExpression, introspectScope, expectedDialect, inferExpressionType, nearestName, CEL_STDLIB_FUNCTIONS } from './validate';
export type { FieldRole, ExprInput, ExprSchemaHint, ExprValidationError, ExprValidationResult, InferredValueType } from './validate';
export type { SeedValue, SeedPrimitive } from './seed-eval';
export type { DialectEngine, EvalContext, EvalResult, EvalError } from './types';
