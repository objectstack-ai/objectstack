// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The RLS predicate shape gate, and the legacy SQL→CEL bridge it stands on.
 *
 * **Hoisted here from `@objectstack/plugin-security` (`src/rls-compiler.ts`) in
 * #4983 — executable code unchanged, address changed.** Both functions were
 * already pure `(string) => …` over `isPushdownableCel`; neither ever read a
 * runtime service, an `ExecutionContext` or a policy record, so nothing about
 * them needed a runtime to live in. What their old address DID do was put the
 * one decision procedure for "will this RLS predicate ever enforce?" behind a
 * package `@objectstack/lint` is forbidden to import ("Depends on
 * @objectstack/spec; never on a runtime"), which left the ADR-0056 D4
 * authoring gate two impossible doors: import a runtime, or fork the bridge.
 * A forked bridge is the worse one — `sqlPredicateToCel`'s `=` / `IN` boundary
 * conditions (quoted literals are never rewritten; CEL input passes through
 * unchanged) ARE the red/green line, so one drifting character makes the linter
 * reject policies the runtime executes correctly. Hoisting keeps ONE definition
 * and lets the gate call the consumer's own verdict (ADR-0058 D1: a single
 * canonical shape gate).
 *
 * `plugin-security` imports both from here; `@objectstack/lint` imports
 * {@link isSupportedRlsExpression} for the authoring gate. The dependency
 * direction is security → formula and lint → formula, never the reverse —
 * pinned by `rls-predicate.test.ts`'s import-graph assertion.
 */

import { isPushdownableCel } from './cel-to-filter';

/**
 * Recognize whether an RLS `using` / `check` expression matches one of the SHAPES
 * the compiler can compile (equality against a `current_user.*` var, equality
 * against a string literal, set-membership against a `current_user.*` array, or
 * the `1 = 1` allow-all). This is SHAPE-only — it does not check whether the
 * referenced context variable is populated at runtime.
 *
 * ADR-0056 D4: exposed so an authoring-time gate (`objectstack compile`) can REJECT
 * a predicate the runtime would silently drop — the class of bug where
 * `owner == current_user.name` (`==`, unsupported) compiled to nothing and left an
 * object unprotected. A `false` here means "this predicate will never enforce".
 *
 * That gate exists as of #4983: `validateRlsPredicateEnforceability` in
 * `@objectstack/lint` calls THIS function on every
 * `permissions[].rowLevelSecurity[].using` / `.check`, so the sentence above is
 * no longer aspirational. Until then the function had no non-test consumer
 * anywhere — a declared-but-never-read helper written to fix
 * declared-but-never-read.
 */
export function isSupportedRlsExpression(expression: string): boolean {
  if (!expression || !expression.trim()) return false;
  // ADR-0058 D1: a single canonical shape gate. We bridge the legacy SQL-ish
  // subset (`=`, `IN`) to canonical CEL, then ask the ONE pushdown compiler
  // whether the shape lowers to a FilterCondition at all. This is broader than
  // the historical 4 forms — comparisons (`amount > 100`) and `==` now ENFORCE
  // (the compiler lowers them), so the gate correctly reports them supported.
  // It is SHAPE-only: whether a referenced `current_user.*` variable is exposed
  // at runtime is a separate availability concern (an unexposed var fails closed
  // at resolution — see RLSCompiler.compileExpression).
  return isPushdownableCel(sqlPredicateToCel(expression)).ok;
}

/**
 * @deprecated Transitional bridge (ADR-0058 D1). Canonical RLS predicates are
 * CEL; this exists ONLY so stored/legacy SQL-ish `using`/`check` keeps compiling
 * until it is migrated. Bridge the legacy SQL subset to canonical CEL so it flows
 * through the ONE compiler: `=` → `==`, `IN` → `in`. Quoted string literals are
 * left untouched. It is IDEMPOTENT on CEL input (a `==`/`in` predicate is
 * unchanged), so authored-CEL seeds pass through as no-ops (no deprecation warn). Only this historically-supported subset is bridged — compound
 * predicates should be authored in canonical CEL (`&&` / `||`); anything outside
 * the subset (subqueries, SQL `AND`/`OR`, `LIKE`) stays unparseable and so fails
 * closed, exactly as before.
 */
export function sqlPredicateToCel(expression: string): string {
  return expression.replace(/'[^']*'|\bIN\b|(?<![<>=!])=(?!=)/gi, (m) => {
    if (m[0] === "'") return m; // quoted literal — never rewrite its contents
    if (m === '=') return '==';
    return 'in'; // IN / in / In → CEL membership operator
  });
}
