// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE dated switch for the CEL pushdown path's reaction to a
 * {@link DEFAULT_LIMITS} overrun (#6132).
 *
 * ## Why a switch exists at all
 *
 * Until #6132 `cel-to-filter.ts` parsed through a **private, limitless**
 * `new Environment({ unlistedVariablesAreDyn: true, enableOptionalTypes: true })`
 * of its own, so the RLS / sharing pushdown path answered a different question
 * from every other CEL entry on the platform: a 300-term addition, a 60-level
 * parenthesis nest and a 200-element list all parsed there while
 * `celEngine.compile()` refused each one (`Exceeded maxAstNodes (256)` /
 * `maxDepth (32)` / `maxListElements (64)`). Measured on the escalation: an
 * 80-term conjunction, a 40-level nest and a 200-element `$in` all reached REAL
 * pushdown SQL, silently.
 *
 * Converging the parse (which #6132 does — the pushdown path now goes through
 * {@link parseCelToAstWithReason}, i.e. #4812's canonical front end) therefore
 * changes behaviour on a **security-sensitive** path: an over-limit predicate
 * goes from "compiled and pushed down" to "refused, and the RLS path fails
 * closed to `RLS_DENY_FILTER`". A deployment whose stored policy happens to sit
 * over a bound would go from enforcing-something to denying-everything on the
 * upgrade that shipped the fix.
 *
 * ## The ruling (2026-08-08, maintainer's A′, quoted verbatim on #6132)
 *
 * > **rc grace, GA flip:** during 17.0.0-rc.x an over-limit predicate on the
 * > pushdown path still compiles + emits a WARN naming the exceeded limit; at
 * > v17 GA the runtime flips to fail-closed refusal (the `parse-error` ⇒
 * > `RLS_DENY_FILTER` path). Implement the flip as a single dated switch (a
 * > named const, default = rc-grace) so GA needs a one-line change.
 *
 * ## The flip
 *
 * **Intended flip point: the v17.0.0 GA release** — i.e. when
 * `packages/formula/package.json`'s version leaves `17.0.0-rc.x`. Flipping is
 * exactly one line:
 *
 * ```ts
 * export const CEL_PUSHDOWN_LIMITS_MODE: CelPushdownLimitsMode = 'fail-closed';
 * ```
 *
 * `cel-to-filter-limits.test.ts` is written to go red on that line so the flip
 * cannot be a silent one, and its blast radius is known: flipping the const
 * fails exactly that file's "the shipped default is the rc grace window"
 * assertion and its `switch = rc-grace` block — 10 tests, measured — and
 * nothing else in the repo. The GA expectation they become is already written
 * out and passing in the same file's `switch = fail-closed` block, and on the
 * RLS path in `plugin-security`'s `rls-pushdown-limits.test.ts`. So the flip is:
 * this one const, that one default assertion, and deleting the grace block
 * whose behaviour has ended.
 *
 * Nothing else needs to move at GA. In particular `@objectstack/lint`'s two
 * enforceability gates need no edit: `validateRlsPredicateEnforceability` reads
 * `isSupportedRlsExpression` and `validateSharingRuleEnforceability` reads
 * `compileCelToFilter`, both of which are downstream of this switch, and both
 * lint suites pin "the lint verdict IS the consumer's verdict" in both
 * directions — so authoring-time reporting flips with the runtime, by
 * construction, and cannot drift from it.
 */

/** How the pushdown path answers a source that overruns a `DEFAULT_LIMITS` bound. */
export type CelPushdownLimitsMode =
  /** 17.0.0-rc.x: compile it anyway (unbounded parse) and WARN, naming the limit. */
  | 'rc-grace'
  /** v17 GA: refuse it — `parse-error`, which the RLS path turns into `RLS_DENY_FILTER`. */
  | 'fail-closed';

/**
 * **The one line to flip at v17.0.0 GA.** See this module's docblock for why it
 * exists, what flipping it changes, and which tests go red when it moves.
 */
export const CEL_PUSHDOWN_LIMITS_MODE: CelPushdownLimitsMode = 'rc-grace';

let activeMode: CelPushdownLimitsMode = CEL_PUSHDOWN_LIMITS_MODE;

/**
 * The mode in force for this process. Every read of the switch goes through
 * here so a test can drive BOTH positions of a dated switch in one suite —
 * the alternative is a switch whose other half is only ever proven by reading
 * it, which for a fail-closed security path is not proof.
 */
export function celPushdownLimitsMode(): CelPushdownLimitsMode {
  return activeMode;
}

/**
 * **Test seam. Production code never calls this** — the only callers are the
 * suites that pin both positions of the switch (in `@objectstack/formula` and
 * in `@objectstack/plugin-security`, which owns the `RLS_DENY_FILTER` outcome
 * and therefore has to see a real over-limit predicate reach it).
 *
 * Returns a restore function; call it in `afterEach` so a suite cannot leak its
 * mode into the next file.
 *
 * It is deliberately a runtime seam rather than a module mock because the
 * outcome under test spans package boundaries: `plugin-security` consumes the
 * BUILT `@objectstack/formula`, so mocking a formula-internal module from there
 * is not possible, and mocking `compileCelToFilter` itself would replace the
 * very function whose refusal is the thing being pinned.
 *
 * It is not a security hole worth guarding: it can only be reached by code
 * already executing in-process, and the direction it can move the switch during
 * the grace window (`'rc-grace'`) is the behaviour this release ships anyway.
 */
export function setCelPushdownLimitsModeForTests(mode: CelPushdownLimitsMode): () => void {
  const previous = activeMode;
  activeMode = mode;
  return () => {
    activeMode = previous;
  };
}
