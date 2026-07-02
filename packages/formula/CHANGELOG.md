# @objectstack/formula

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/spec@11.1.0

## 11.0.0

### Minor Changes

- ef3ed67: Formula field typing: `inferExpressionType()` + a declared `returnType`.

  - `@objectstack/formula`: new `inferExpressionType()` (and lower-level `inferCelType()`) surfaces the cel-js type-checker's result for a CEL value/formula expression, mapped to `number | text | boolean | date | unknown`. Conservative — two `dyn` operands stay `unknown`; typed literals/stdlib returns pin a concrete type.
  - `@objectstack/spec`: `FieldSchema` gains an optional `returnType` (`number|text|boolean|date`) so a formula field can carry its declared value type (the way Salesforce/Airtable do), letting consumers (dataset measures, formatting, validation) read a declared type instead of re-parsing the expression.

### Patch Changes

- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0

## 10.0.0

### Minor Changes

- cfd86ce: ADR-0058 — expression & predicate surface unification. Adds the canonical
  CEL→FilterCondition pushdown compiler in `@objectstack/formula`
  (`compileCelToFilter`, `isPushdownableCel`, `lowerCelAst`) plus an in-memory
  `matchesFilterCondition` backend (one AST, three backends). `plugin-security`
  (RLS `using`, via a SQL bridge) and `plugin-sharing` (`celToFilter`) cut over to
  it, retiring the bespoke regex/field-equality front-ends. Compound sharing
  conditions now compile and enforce end-to-end (closes #1887). The RLS `check`
  clause is now enforced on the write post-image (insert/by-id update), fail-closed.
  Non-pushdownable predicates (arithmetic, functions, subqueries, cross-object) are
  an authoring compile error, never silently dropped (ADR-0049/0055).

### Patch Changes

- 48a307a: build: validate UI action `visible` / `disabled` predicates at compile time

  Extends the ADR-0032 build-time expression check to cover action `visible` and
  `disabled` predicates (stack-level and object-attached), evaluated record-scoped
  like validation rules. A record-header / row action's `visible` is evaluated by
  `ActionEngine` against `{ record, recordId, objectName, user, … }` with
  fail-closed semantics, so a **bare** field reference (`!done` instead of
  `!record.done`) throws at runtime and the action is **silently hidden on every
  record** — the trap behind the #2183 "Mark Done never hides" debugging hunt.
  `os build` now reports it as an error with the corrective `record.<field>`
  message instead of letting it ship.

  `@objectstack/formula`: `ctx` and `features` are added to the record-scope
  namespace roots (alongside the existing `user`, `data`, `context`, …) so the
  ambient globals real action predicates use (`record.id == ctx.user.id`,
  `features.multiOrgEnabled`) are not false-positives. Verified against the full
  monorepo build (every example + platform bundle still compiles clean).

- 25fc0e4: build: extend ADR-0032 predicate validation to all flat record-scoped sites

  Builds on the action-predicate guard. `os build` now also validates these
  record-scoped predicates for bare field references (`status` instead of
  `record.status`), which otherwise evaluate to nothing at runtime and silently
  mis-behave:

  - **field conditional rules** — `requiredWhen`, `readonlyWhen`,
    `conditionalRequired`, `visibleWhen` (server-enforced; a broken one is
    fail-open — the required/readonly rule just never fires);
  - **sharing-rule `condition`** (security-critical — decides which rows a
    principal sees);
  - **lifecycle hook `condition`** (skips the handler when false);
  - **nested `when`** on `conditional` validation rules (previously only the
    top-level rule predicate was checked).

  `@objectstack/formula`: adds `parent` to the record-scope namespace roots —
  master-detail inline grids inject the header record as `parent` for a child
  field's `readonlyWhen`/`requiredWhen` (ADR-0036, #1581), so `parent.status` is
  legitimate, not a bare ref. Verified against the full monorepo build (76 tasks
  clean).

  Not yet covered (separate follow-up — needs a recursive view/page tree walker
  and per-node scope classification): deeply-nested UI visibility predicates
  (`view` element/section `visibleOn`/`condition`, `page` component `visibility`),
  object field-group `visibleOn`, and app-nav `visible` (user/feature-scoped, not
  record-scoped).

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0

## 9.10.0

### Minor Changes

- 1f88fd9: Add `addDays(date, n)` and `addMonths(date, n)` to the CEL standard library — shift an arbitrary date by a (possibly negative) number of days or months. Unlike `daysFromNow`, these operate on a _given_ date (the "next service date = last service + cycle" shape). `addMonths` clamps to the target month's last day (`addMonths(date('2026-01-31'), 1)` → Feb 28, never overflowing into March). Both coerce their inputs (Date | ISO string | epoch) and type `n` as `dyn` so a record number field arriving as a `double` doesn't fault `no such overload` (#1928).

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1

## 9.9.0

### Minor Changes

- d99a75a: feat(formula): timezone-aware `today()` / `daysFromNow()` / `daysAgo()` (ADR-0053 Phase 2)

  These are now **calendar-day** functions resolved in a reference timezone, threaded from `ExecutionContext.timezone` (#1978) through `EvalContext.timezone` into the CEL stdlib. Each returns the reference-tz calendar day expressed as a **UTC-midnight `Date`** (ADR-0053 decision D1) — the one representation consistent with how `Field.date` strings hydrate, how the SQL driver normalizes date filters, and how Phase 1 stores dates. So `record.close_date == daysFromNow(30)` now matches in-memory too, not just at the storage boundary. The timezone calculation uses `Intl.DateTimeFormat` (DST-safe; no hand-rolled offset math).

  **⚠️ Behavior change:** `daysFromNow(n)` / `daysAgo(n)` previously kept the wall-clock time of `now` (e.g. `daysFromNow(30)` at `10:00Z` → `…T10:00:00Z`). They now drop the time and return the calendar day at **midnight** (`…T00:00:00Z`) — the ADR-0053 "defect #3" fix. `today()` is unchanged at UTC (it already truncated to start-of-day). For a genuine sub-day offset use the documented escape hatch `now() + duration("Nh")`.

  With no reference timezone configured the zone resolves to `UTC`, so `today()` is byte-for-byte unchanged; only the `daysFromNow`/`daysAgo` midnight-truncation differs from before. `objectql` threads `execCtx.timezone` into read-time formula evaluation (`applyFormulaPlan`) and default-value expressions (`applyFieldDefaults`).

  Part of #1980. (Consuming a non-UTC reference timezone end-to-end also needs the `localization` settings manifest noted in #1978.)

- 575448d: feat(formula,email): render `datetime` in a reference timezone (ADR-0053 Phase 2)

  `datetime` template holes now render in a reference timezone's wall-clock when one is supplied, at the presentation boundary — storage stays UTC.

  - **Formula template engine** — the `datetime` formatter takes the reference timezone from `EvalContext.timezone` (threaded in #1980) and passes it to `Intl.DateTimeFormat`. `{{ ts | datetime }}` renders in that zone; `{{ ts | datetime:iso }}` stays UTC (machine-readable). Calendar-day `date` rendering is intentionally **unchanged** (tz-naive — a `Field.date` has no zone). New exported `formatValue(name, value, arg, { locale, timeZone })` makes the whitelisted formatters reusable outside the full CEL template engine.
  - **Email pipeline** — `plugin-email`'s renderer previously bypassed the formatter pipeline (`String()` only), so a datetime went out as raw ISO. Email holes now accept the shared formula formatters — `{{ order.total | currency }}`, `{{ ts | datetime }}` — reusing `formatValue` (single source of truth), while keeping the engine's HTML-escaping and `{{{ }}}` raw-output semantics. `SendTemplateInput.timezone` (mirroring the existing `locale`) flows into rendering so an email's datetime shows the recipient's wall-clock.

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0

## 9.8.0

### Minor Changes

- c17d2c8: feat(formula): register the CEL functions the authoring catalog advertises (daysBetween, abs, round, min, max, upper, lower, contains, startsWith, endsWith, matches, len, isEmpty, date, datetime)

  `introspectScope` / `CEL_STDLIB_FUNCTIONS` advertised 25 functions to authors
  (incl. AI), but only 8 were registered — 14 faulted at runtime (`daysBetween`,
  `abs`, `round`, `min`, `max`, `upper`, `lower`, `len`, `isEmpty`, `contains`,
  `startsWith`, `endsWith`, `matches`, plus `date`/`datetime`). Authors were told
  to call functions that don't exist (e.g. `daysBetween` for "days remaining").

  Register the genuinely-useful set in `registerStdLib` with dyn-lenient signatures
  (so a `Field.date` arriving as a string still works) and internal coercion, and
  reconcile the catalog so every advertised entry resolves — guarded by a test that
  evaluates every `CEL_STDLIB_FUNCTIONS` entry. Pure additions; no behavior change
  to existing expressions.

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0

## 9.7.0

### Minor Changes

- ff0a87a: feat(validate): flag bare field references in record-scoped CEL sites at build time

  > **Heads-up for downstream:** this adds a NEW build-time error. A `Field.formula`
  > or validation predicate that references a field bare (`amount` instead of
  > `record.amount`) now fails `objectstack compile`. These expressions were already
  > silently broken at runtime (they evaluated to `null` / never fired), so this is a
  > fix that surfaces a latent bug — but a stack carrying one will go from
  > "builds, silently wrong" to "fails the build" on upgrade. The error message
  > states the exact correction (`write record.<field>`).

  A `Field.formula` and an object validation predicate evaluate against the
  `record` namespace only — there is no field flattening — so a bare top-level
  identifier (`amount`, `status`) resolves to nothing and the expression silently
  evaluates to `null` / never fires. This is the silent-at-runtime class behind
  the broken example-crm formulas (#1927) and is exactly what AI authors get wrong.

  `validateExpression` now takes an evaluation `scope` and, for `scope: 'record'`,
  reports a bare reference with the corrective form (`write record.<field>`). The
  check is schema-free and acts only on cel-js's `Unknown variable` fault, so it
  cannot false-positive on arithmetic/comparison/null-guard type overloads. Flow
  and automation conditions keep the default `scope: 'flattened'` — the record's
  fields ARE spread to top-level there (alongside flow variables), so bare refs
  are correct and are NOT flagged. `objectstack compile` wires `record` scope for
  field formulas and validation predicates; flow conditions stay flattened.

### Patch Changes

- 82c7438: fix(formula): register mixed `double <op> int` arithmetic overloads so number-field formulas compute

  cel-js types a record field number as `double` and a bare integer literal as
  `int`, and ships overloads only for matching numeric pairs. So an everyday
  formula like `record.amount / 100` or `record.price * 2` faulted at runtime
  (`no such overload: dyn<double> / int`); the engine caught the fault and the
  formula silently evaluated to `null` — passing build, empty at runtime (#1928).

  The CEL engine now registers the missing `double <op> int` / `int <op> double`
  overloads for `+ - * / %`, computing the result as a `double` (CEL's mixed-numeric
  promotion). Pure `int op int` is untouched, so integer division (`7 / 2 == 3`)
  keeps its semantics — the overloads fire only when the operands are genuinely a
  `double` and an `int`. Authors no longer need the `/ 100.0` float-literal workaround.

- 417b6ac: feat(validate): advisory did-you-mean warnings for likely field typos in flow conditions

  Adds a non-blocking warning channel to build-time expression validation (#1928
  tier 3). Flow / automation conditions flatten the record's fields to top-level,
  so a bare `status` is correct — but a bare NON-field identifier is either a flow
  variable or a typo. When it is a near-miss of a known field (edit distance), the
  build now emits a `did you mean \`status\`?`warning instead of staying silent,
WITHOUT failing the build (a genuine flow variable won't be close to a field
name, so it stays quiet).`ExprValidationResult`gains a`warnings`array and`ExprIssue`a`severity`; `objectstack compile` prints warnings and only fails on
  errors. This closes the silent-skip gap for misspelled trigger-condition fields
  (the #1877 family) without the false-positive risk of a hard gate.

  - @objectstack/spec@9.7.0

## 9.6.0

### Patch Changes

- bb00a50: fix(formula): catch unknown functions in CEL conditions at build (#1877)

  `compile()` discarded cel-js's type-check verdict because `check()` returns a `TypeCheckResult` object (`{ valid, error }`), not an array — so the `Array.isArray(checkErrors)` guard never matched. A condition calling an unknown function (`PRIOR(status)`, a typo'd `isBlnk(...)`) type-checks as `found no matching overload`, but that result never surfaced, so `objectstack compile`, `registerFlow`, and the `validate_expression` tool all accepted the predicate, which then silently no-op'd the flow at runtime. Now reads the documented `{ valid, error }` shape, closing the gap for flow conditions, validation rules, and field formulas at once.

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0

## 7.8.0

### Patch Changes

- f01f9fa: fix(formula): hydrate ISO date/datetime strings on CEL `no such overload` fault (#1530)

  Date-typed formula fields and date predicates always evaluated to `null`:
  `Field.date`/`Field.datetime` serialize to ISO strings, and cel-js compared the
  raw string against the `google.protobuf.Timestamp` from `today()`/`now()`/
  `daysFromNow()`, raising `no such overload` (swallowed to null). The existing
  numeric-string fault-retry (#1534) is now extended to also coerce strict ISO-8601
  date/date-time strings to `Date` before retrying once, fixing every caller
  (formula fields, flow conditions, validation/workflow predicates). Hydration runs
  only after a fault, so clean expressions are never re-interpreted and genuine
  non-temporal strings still fault loudly.

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0

## 7.7.0

### Patch Changes

- 825ab06: fix(formula): hydrate string-serialized numeric fields in CEL comparisons (#1534)

  Numeric fields that serialize as strings — `Field.rating(allowHalf)` → `"5.0"`, `Field.currency(scale)` → `"250000.00"`, `Field.percent` — made comparisons like `record.rating >= 4` fault under strict CEL with `no such overload: dyn >= int`. In flow decision/edge conditions this silently dead-ended the run (no edge matched), and in objectql `applyFormulaPlan` it swallowed to `null`.

  The CEL engine now retries an evaluation **once** with purely-numeric strings hydrated to numbers, but only after a `no such overload` fault — so a comparison that already type-checks is never re-interpreted (a zip like `"02134"` stays a string in `record.zip == "02134"`). Because both the automation condition path (`service-automation` `evaluateCondition`) and the objectql formula path route through `ExpressionEngine.evaluate`, both are fixed consistently. A genuinely non-numeric operand (e.g. `record.rating >= 4` where `rating` is `"high"`) still faults loudly rather than being silently rescued.

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0

## 7.6.0

### Minor Changes

- c4a4cbd: ADR-0032 (phase 1): validate-by-default expression layer — no silent failure.

  Kills the #1491 class where a malformed predicate (e.g. the `{record.x}`
  template-brace-in-CEL mistake) silently evaluated to `false` and made a flow
  "fire" with no effect:

  - **service-automation**: flow `evaluateCondition` no longer swallows CEL
    failures to `false` — it throws an attributed, corrective error; and
    `registerFlow` now parse-validates every predicate (start/decision/edge
    condition) at registration, failing loudly with the offending location +
    source + the fix.
  - **formula**: new shared validator — `validateExpression(role, src, schema?)`,
    `introspectScope`, `CEL_STDLIB_FUNCTIONS` — with schema-aware field-existence
    - did-you-mean. The `{{ }}` template engine gains a formatter whitelist
      (`currency`/`number`/`percent`/`date`/`datetime`/`truncate`/`upper`/`lower`/
      `default`/…) with defined value→string semantics; arbitrary logic in holes is
      rejected. Plain `{{ path }}` stays back-compatible.
  - **cli**: `objectstack compile` validates every flow / validation-rule /
    field-formula predicate against the resolved object schema and fails the
    build with located, corrective messages.
  - **service-ai**: new agent-callable `validate_expression` tool so authoring
    agents self-correct before committing.
  - **spec**: fix the `FlowSchema` JSDoc example that taught the bad
    `condition: "{amount} < 500"` single-brace form.

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1

## 7.4.0

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
