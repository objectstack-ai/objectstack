---
"@objectstack/formula": minor
---

fix(formula): the CEL pushdown compiler parses through the canonical front end, so `DEFAULT_LIMITS` finally apply to RLS/sharing predicates (#6132)

`cel-to-filter.ts` — the ONE canonical CEL → `FilterCondition` pushdown compiler
(ADR-0058 D1/D2/D6), consumed by the RLS path (`plugin-security`'s
`RLSCompiler`), the sharing seeder (`plugin-sharing`), and the analytics SQL
backend — kept a **private, limitless** parse environment of its own:

```ts
new Environment({ unlistedVariablesAreDyn: true, enableOptionalTypes: true })
```

no `limits`, no stdlib, no `rewriteNullableTernary`. That made the pushdown path
the one place on the platform that answered a *different* question from
`celEngine.compile()` about what parses. Measured: a 300-term addition, a
60-level parenthesis nest and a 200-element list literal all parsed there while
the interpreter refused each one outright (`Exceeded maxAstNodes (256)` /
`maxDepth (32)` / `maxListElements (64)`). Escalated: an 80-term conjunction, a
40-level nest and a 200-element `$in` all reached **real pushdown SQL**,
silently — and `isSupportedRlsExpression`, the ADR-0056 D4 authoring gate, was a
thin wrapper over the same limitless environment, so it was no independent check
either.

It now parses through `parseCelToAstWithReason` — #4812's canonical entry, with
`DEFAULT_LIMITS`, the stdlib and the #3306 null-guard rewrite. "What parses" has
one answer again.

**Within the limits nothing moves, and that is measured, not asserted.** Across
the 710 sources of the pushdown corpus that both front ends accept, the only AST
difference is `rewriteNullableTernary`'s `dyn(…)` wrap on the three null-guard
ternaries — and a ternary faults on its own `?:` node before the lowerer
descends into a branch, so verdict *and* detail come out byte-identical. Pinned
in `cel-to-filter-parse-convergence.test.ts`, which rebuilds the old environment
to compare against.

**Over the limits, behaviour changes — in two dated steps.**

- **Now, during `17.0.0-rc.x` (`rc-grace`):** an over-limit predicate **still
  compiles** — nothing that enforces today stops enforcing on this upgrade — and
  emits one WARN per predicate naming the bound that was exceeded
  (`maxAstNodes` / `maxDepth` / `maxListElements` / …), the platform's value for
  it, and what the predicate itself measures (cel-js's own accounting: the
  smallest bound it parses under), plus what will happen at GA.
- **At v17.0.0 GA (`fail-closed`):** the same predicate is **refused** —
  `{ ok: false, reason: 'parse-error', detail: 'Exceeded maxAstNodes (256)' }` —
  and the RLS path turns that into `RLS_DENY_FILTER`, i.e. zero rows, fail
  closed. A sharing rule with such a condition is not seeded.

**The flip is one line.** `CEL_PUSHDOWN_LIMITS_MODE` in
`packages/formula/src/cel-pushdown-limits.ts` — the single dated switch,
shipping as `'rc-grace'`, to be set to `'fail-closed'` at the v17.0.0 GA release
(i.e. when this package's version leaves `17.0.0-rc.x`). Both positions are
exercised in CI today, in `@objectstack/formula` and in
`@objectstack/plugin-security` (where the `RLS_DENY_FILTER` outcome lives), so
the GA half is proven before it ships rather than after. Two tests are written
to go red on that line so the flip cannot be silent.

**If you author RLS or sharing predicates:** a predicate over any of these
bounds is already refused everywhere else on the platform (`os build`,
`os validate`, the interpreter). Split it, or move the logic into a hook/action
body (`ScriptBody { language: 'js' }`), before upgrading past the rc line. The
WARN names the predicate and its measure so you can find them.

**New public surface**, for consumers that must *report* a refusal rather than
merely react to one:

- `parseCelToAstWithReason(source, opts?)` — the reason-carrying sister entrance
  to `parseCelToAst`. Same front end, same verdict, but it distinguishes
  `'parse'` (not valid CEL) from `'bounds'` (valid CEL, over budget) and names
  the exceeded limit, its platform value, and the source's measure. Graded by
  the same by-class/by-code classifier `celEngine.compile` uses (#6223) — never
  by error prose. `parseCelToAst` is unchanged and still collapses every refusal
  to `null`.
- `CelParseResult`, `CelBoundsOverrun`, `CelLimitKey`, `ParseCelToAstOptions`.
- `CEL_PUSHDOWN_LIMITS_MODE`, `celPushdownLimitsMode()`,
  `setCelPushdownLimitsModeForTests()`, `CelPushdownLimitsMode`.

`@objectstack/lint` needs no change, at either position of the switch. Its two
enforceability gates read `isSupportedRlsExpression` and `compileCelToFilter`,
both downstream of this switch, and both suites pin "the lint verdict IS the
consumer's verdict" in both directions — so authoring-time reporting flips with
the runtime by construction. An over-limit sharing `condition` is in fact
already an authoring **error** today (`expression-invalid`, from the general
expression rule, quoting `Exceeded maxAstNodes (256)`), because that rule has
always gone through the canonical front end.
