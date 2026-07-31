# @objectstack/formula

## 17.0.0-rc.1

### Minor Changes

- 4965bfa: Warn on flow-node `config` keys the node type does not declare (#4045).

  `FlowNodeSchema.config` is `z.record(z.unknown())`, so a misspelled or invented
  config key was accepted in total silence: `visibleIf` instead of `visibleWhen`
  registered cleanly, was never read, and the only symptom was a feature that quietly
  did not happen. That diagnostic vacuum is what made #3528 take three passes and two
  wrong diagnoses to resolve.

  `registerFlow` now compares each node's `config` against its descriptor's
  `configSchema` and warns on anything undeclared, located and with the declared set
  listed:

  ```
  [flow 'lead_conversion'] node 'screen_1' (screen): unknown config key `visibleIf`
    at config.fields[0].visibleIf — It is not declared by this node type's
    configSchema, so nothing reads it. Declared here: name, label, type, required,
    visibleWhen.
  ```

  The walk descends where the schema declares structure and **stops at free-form
  keyValue maps**, whose keys are author data (`filter: { status: 'stale' }`).
  Descending matters: the #3528 typo class lives _inside_ the `screen` field
  repeater, so a top-level-only comparison would miss the exact mistake this exists
  to catch.

  **Warn, never reject.** An undeclared key is an author typo, a key the executor
  genuinely reads that its hand-written `configSchema` never declared (`notify.source`
  was exactly this), or dead config. Only 4 of the 13 schema-carrying builtins have
  been audited for the second population, so hard-failing would gamble on the other
  nine. Tightening to an error is a later, per-key decision once this warning has
  measured the real distribution. Nothing about the published `configSchema` changes,
  so no consumer sees a different shape.

  `@objectstack/formula` now exports `nearestName`, the edit-distance helper already
  used for unknown-field and unknown-role suggestions, so "did you mean?"
  diagnostics share one threshold. It is deliberately a bonus rather than the
  mechanism — `visibleIf` → `visibleWhen` is distance 4 against a threshold of 3, so
  the declared set is always listed instead of only as a fallback.

  Also fixes the first real finding from the new check: `showcase_inquiry_purge`'s
  `get_record` node carried `mode: 'records'`, which no executor reads, with a comment
  crediting it for behaviour that `limit > 1` actually produces.

### Patch Changes

- 2af1988: fix(formula,spec,core): the RLS write-side `check` evaluator honours calendar-day upper bounds (ADR-0053 D-D)

  `@objectstack/formula`'s `matchesFilterCondition` — the evaluator behind RLS
  write-side `check` policies (ADR-0058 D4) — compared a bare `YYYY-MM-DD` `$lte`
  bound literally. On a `datetime` post-image that meant a policy of the shape
  `{ signed_on: { $lte: '{today}' } }` **denied every write made after 00:00**:
  the write-side twin of the read-side data loss #3777 fixed, and the last of the
  platform's filter backends that disagreed about what a bare day means as a
  bound.

  `$lte` and a `$between` max now evaluate half-open against the next calendar
  day, matching the SQL compiler, the memory and mongo drivers, and the analytics
  preview evaluator. Unchanged, per the same semantics table: full-ISO bounds keep
  exact-instant semantics, `$gte`/`$gt`/`$lt` keep their midnight anchoring, and a
  plain `YYYY-MM-DD` value compares identically (string ordering makes the two
  forms equivalent). The evaluator stays fail-closed on a null bound.

  **Where the rule now lives.** `nextUtcCalendarDay` moved from
  `@objectstack/core` to `@objectstack/spec/data` — beside `date-macros.zod.ts`,
  whose vocabulary it interprets. `formula` cannot depend on `core`, and a second
  copy of the rule is exactly the divergence #3777 catalogued; `spec` is the one
  package all six consumers already depend on, so this adds no dependency edge.

  No import changes are required: `@objectstack/core` re-exports the symbol, so
  existing `import { nextUtcCalendarDay } from '@objectstack/core'` keeps working.
  New code should prefer `@objectstack/spec/data`.

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- cc2de0e: chore(packaging): 20 packages stop publishing their sources, tests and build tooling (#4248)

  These 20 packages declared no `files` field, so npm fell back to packing the
  whole package directory. `npm pack --dry-run` on `@objectstack/plugin-webhooks`
  listed **21 files** — 15 under `src/`, three of them unit tests
  (`auto-enqueuer.test.ts`, `bootstrap-declared-webhooks.test.ts`, …), plus the
  build-time `scripts/i18n-extract.config.ts`. `dist/` lands on top of that at
  publish time rather than instead of it, so consumers were installing the
  TypeScript sources and the test suite alongside the artifact they asked for.

  Each now declares `"files": ["dist", "README.md"]`, matching the 29 packages
  that already did. Nothing a consumer imports moves: every `main` / `types` /
  `exports` target in all 20 already resolved inside `dist/`, which the new
  `check:published-files` guard verifies rather than assumes. The visible change
  is a smaller install and a smaller dependency-scanning surface — `npm pack` on
  `@objectstack/plugin-webhooks` now yields 2 files plus `dist/`.

  The other half of the fix is the gate. Half the packages declaring `files` and
  half not was the #3786 shape — a hand-copied convention with nothing enforcing
  it, where whoever forgets the line gets no signal at all. `check:published-files`
  (new, wired into the always-required `lint` job) holds every non-private
  workspace package to four invariants: `files` is **declared**; it is
  **sufficient** (covers every entry point, so tightening a whitelist cannot ship
  a package that fails to resolve); it is **minimal** (admits no test, test-harness
  config or build script); and anything beyond `dist` + `README.md` is
  **registered** with a reason, reconciled in both directions so a stale exemption
  is an error rather than dead text. `@objectstack/spec` is the one package with
  registered extras — its `.zod.ts` sources, JSON Schemas, liveness ledgers and
  `CHANGELOG.md` are product, not build input.

  This also closes an assumption #4206 was resting on. Excluding `<pkg>/scripts/**`
  from the docs-drift implementation test is sound only while no package publishes
  `scripts/` as runtime code; that held, but it held because someone read all three
  offenders by hand. It is now checked on every PR.

- e4c2dc8: Order temporal operands correctly when one side is a JS `Date` on the two
  type-blind filter backends (ADR-0053 D-A3 / #4191).

  `utcInstantMs` joins `nextUtcCalendarDay` in `@objectstack/spec/data`
  (re-exported from `@objectstack/core`): it reads the UTC instant a temporal
  operand denotes, accepting only unambiguous spellings — a `Date`, epoch ms, a
  bare `YYYY-MM-DD`, and an ISO timestamp with or without an explicit zone (a
  zone-naive one being UTC, per D-B2) — and returning `null` for everything
  else, notably a bare wall clock, which denotes no instant.

  Both type-blind evaluators now use it to compare a `Date` against wire text,
  which JS relational operators cannot do: `<` and friends coerce with hint
  `number`, so the `Date` becomes its epoch and the string becomes `NaN`.

  - `formula`'s `matchesFilterCondition` (the RLS write-side `check`) dropped
    every `Date`-valued row in 10 of the 16 shared conformance cases. The
    post-image is the caller's raw write payload, so an SDK write of
    `new Date()` hit this directly, and fail-closed turned it into a **denied
    write**.
  - `service-analytics`' preview evaluator diverged on the same 10 cases in
    BOTH directions, because `String(new Date())` sorts after every `'2026-…'`
    comparand — a drafted chart both lost rows and gained ones, then changed
    its numbers at publish. Rows from a mongo-backed dataset arrive as BSON
    `Date`s, so this was reachable in normal use.

  Comparisons that did not involve a `Date` are unchanged.

- Updated dependencies [6a67d7a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [217e2e6]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [65a3a84]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- 2fa4ca1: Dynamic approver routing for approval nodes (#3447 P2) — three new declarative capabilities:

  **`expression` approvers.** A new approver type whose CEL expression resolves WHO approves at node entry, over exactly three roots: `current.*` (the record's live state), `trigger.*` (the submit-time snapshot) and `vars.*` (flow variables, incl. upstream node outputs). `record` and bare field names are rejected before evaluation — on this platform `record` always means "the record at event time", which is ambiguous at an approval node — with error messages that prescribe the correct spelling. The optional `resolveAs: 'user' | 'department' | 'position' | 'team'` re-expands each resolved id through the same graph lookups the static types use; with `behavior: 'per_group'` each intermediate value (e.g. each returned department) forms its own sign-off group. A missing key fails the node loudly; only a present-but-empty result counts as an empty slate.

  **`onEmptyApprovers` policy.** What an empty resolved slate does, node-level, for all approver types: `admin_rescue` (default — request opens for privileged takeover, the #3424 behaviour), `fail` (node fails), or `auto_approve` (skip the request, continue down the `approve` edge with `output.autoApproved = true`). To support auto-approve, the automation engine now honours `NodeExecutionResult.branchLabel` on the synchronous completion path — the field existed but was only ever consumed via resume signals.

  **Decision outputs.** `decide(..., { outputs })` hands structured data from the approver to the flow: the author declares allowed keys on the node (`decisionOutputs`), approvers fill values only, and accepted outputs resume the run as `<nodeId>.<key>` variables — a later approval node's expression can read `vars.<nodeId>.picked_departments`, closing "the previous approver picks the next step's approvers" without a record-field detour. Undeclared keys reject the decision; `decision`/`requestId` are reserved. Multi-approver tallies now always pin to the open-time approver snapshot (previously unanimous re-resolved at each decision against the payload snapshot).

  Also: `collectCelRootIdentifiers` is exported from `@objectstack/formula` (shared by the new `os lint` rules and the runtime pre-check, so they can never drift), resolution inputs are audited on the request snapshot as `__resolvedFrom`, and three new lint rules gate expressions, empty-slate policies and reserved output keys at author time.

### Patch Changes

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [67452d1]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
  - @objectstack/spec@16.1.0

## 16.0.0

### Minor Changes

- 6b51346: feat(formula): `dateField == today()` now matches — AST temporal-comparison rewrite (#3183)

  **Behavior change (the fix):** a `Field.date` compared with `==`/`!=` against a
  temporal function now matches on the calendar day. Previously it **silently
  returned the wrong answer** — `record.due_date == today()` was always `false`
  (and `!= today()` always `true`) even for a same-day record, because a
  `Field.date` reads back as a `YYYY-MM-DD` **string** (ADR-0053 Phase 1) and
  cel-js's equality (`overloads.js` `isEqual`) treats a string and a timestamp as
  unequal without consulting any overload.

  `celEngine.evaluate` now rewrites the parsed AST: for each `==`/`!=` whose one
  operand is `today()`/`daysFromNow()`/`daysAgo()`/`now()`, the **field operand**
  is wrapped in `date(...)` (the stdlib coercion), then the expression is
  serialized and evaluated. So `record.due_date == today()` runs as
  `date(record.due_date) == today()`.

  - **Per-occurrence**, not per-field: `record.d == "2026-06-20" || record.d == today()`
    keeps the string-literal comparison intact while fixing the temporal one.
  - **Type-blind-safe**: `date()` degrades gracefully — an already-`Date`
    (`Field.datetime`) operand passes through; a non-date string or null →
    `Invalid Date` → the comparison stays `false`, exactly as before. No
    field-type information is needed, and no currently-correct result is worsened.
  - **Cheap**: the rewrite only reserializes when such a comparison is present
    (a plain-`includes` gate skips the rest), and is memoized per source string.

  Applies to every interpreter site — read-time `Field.formula`, default values,
  validation rules, hook conditions, and flow conditions — since all route through
  `celEngine.evaluate`. RLS/sharing conditions are unaffected: they compile via
  `cel-to-filter`, which already rejects function calls as a loud authoring error.

  **Supersedes the #3192 advisory lint.** That build-time warning
  (`checkTemporalDateEquality`) flagged `dateField == today()` as a silent-miss;
  with the runtime fixed it would be a false alarm, so it (and the
  `temporalEqualityFields` helper it used) is removed. Authors can now write the
  natural `record.due_date == today()` directly; the `date(...)` /
  `daysBetween(...) == 0` / range idioms all keep working.

- 80273c8: feat(formula): warn when a `date` field is compared to a temporal function with `==`/`!=` (#3183)

  A `Field.date` deserializes as a `YYYY-MM-DD` **string** (ADR-0053 Phase 1), and
  cel-js's equality hard-codes `string == <timestamp>` to `false` — it returns
  `false` for a string left operand without ever consulting a registered overload,
  and refuses cross-type object equality (`@marcbachmann/cel-js` `overloads.js`
  `isEqual`). So the most natural "is it due today" predicate —

  ```cel
  record.due_date == today()      // silently false, even when due_date IS today
  record.due_date != today()      // silently true for a same-day record
  ```

  — compiles clean, throws nothing, and silently never matches. Same silent-miss
  family as #1928; **timezone-independent** (fails identically at UTC) and
  cross-cutting (formulas, validation, RLS, flow/action/sharing/hook predicates).

  cel-js gives no operator-layer hook to fix the comparison, so this adds a
  **build-time advisory warning** (the established ADR-0032 guardrail strategy)
  rather than a runtime behavior change. `validateExpression` reuses the shared
  `ExprSchemaHint.fieldTypes` (the same per-field type map the #1928 tier-4
  soundness check already threads through `@objectstack/lint`) to flag a `==`/`!=`
  between a `date` field (`record.`/`previous.`/bare) and
  `today()`/`daysFromNow()`/`daysAgo()`/`now()`, with a self-correcting message
  pointing at the working idioms: `date(record.d) == today()`, a range
  (`>= … && <= …`), or `daysBetween(today(), record.d) == 0`.

  Warning severity — never fails the build (the write/validation path may carry a
  real `Date`). Restricted to `type: 'date'` (unambiguously a string); `datetime`
  is excluded to avoid false positives. Ordering operators (`>=`/`<=`/`<`/`>`)
  already work — cel-js _throws_ for them, tripping the engine's existing
  string-hydration retry — so they are not flagged.

  A runtime fix (normalizing the peer of a temporal operand in the data layer)
  remains tracked in #3183; a naive "hydrate date fields to `Date`" version would
  trade this silent-miss for another (breaking `dateField == "2026-06-20"`), so it
  needs its own design.

- 7125007: **Stored `Field.formula` fields that compute dates/durations no longer silently evaluate to `null` (#3306).** Three independent CEL gaps made shipped template formulas (e.g. `hr_employee.tenure_years`, `hr_time_off_request.days`) return `null` with no parse/build/runtime error:

  1. **The null-guard idiom `cond ? <value> : null` now compiles and evaluates.** cel-js's ternary type-unifier rejects a concrete `int`/`double`/`string` branch against `null` — so even `true ? 5 : null` faulted _"Ternary branches must have the same type"_ and the whole formula nulled. A `Field.formula` is inherently nullable and the catalog blesses both ternary and `== null`, so this is the canonical "compute value, else blank" shape. An AST pre-pass (mirroring the #3183 temporal-equality rewrite) wraps the non-null branch in `dyn(...)` — value-preserving, null-branch-only, idempotent — so it type-checks and runs. Applied in `compile()`, `evaluate()`, and the build soundness check alike.

  2. **`floor(x)` / `ceil(x)` are now registered** (parallel to `round`/`abs`) and advertised in the catalog. They round toward −∞ / +∞, so `floor(-1.2) == -2` — NOT interchangeable with integer division's round-toward-zero. Previously `floor(...)` faulted `found no matching overload` and the formula nulled.

  3. **Date arithmetic is now a build-time ERROR instead of a silent runtime `null`.** `record.end_date - record.start_date + 1`, `today() + 30`, `record.date + n` type-check clean (operands are `dyn`) but always fault at runtime and never recover (a date string is not numeric, so hydration can't rescue it). The build soundness check now types `date`/`datetime` fields as `google.protobuf.Timestamp` and flags date/duration **arithmetic against a number** with a corrective message pointing at `daysBetween(a, b)` / `daysFromNow(n)` / `addDays(d, n)` / `addMonths(d, n)`. Sound by construction — ordering (`date < today()`, `date < "2026-01-01"` string-lex), equality (#3183), and string concatenation (`"Due: " + date`) are all runtime-tolerated and never flagged; only arithmetic against a number is. A `!= null` guard on a date field no longer masks the inner fault (`== null` no-op overloads registered in the check-only env).

  > **Heads-up for downstream:** (3) adds a NEW build-time error. A stored formula or predicate doing arithmetic on a `date`/`datetime` field (`end - start + 1`, `today() + 30`) that previously built (and nulled at runtime) will now fail `objectstack build` / `validateStackExpressions` with a message telling you to use `daysBetween` / `daysFromNow` / `addDays`. This only fires for genuinely-broken expressions that already returned `null`.

  Fixes #3306.

- ea32ec7: feat(formula,lint): advisory type-soundness warnings for formula/predicate expressions (#1928 tier 4)

  Closes the last open guardrail from #1928. A `Field.formula` or record-scoped
  predicate that uses a **text or boolean field with an arithmetic (`+ - * / %`)
  or ordering (`< > <= >=`) operator against a number** faults the runtime
  overload and silently evaluates to `null` (e.g. `record.title * 2`,
  `record.is_active + 1`). The build now surfaces this as a **non-blocking
  warning** with the offending field and a corrective message.

  Honours the ADR-0032 design law — the checker only flags what the runtime
  would also fail:

  - Number / currency / percent / date / datetime fields are declared `dyn`, so
    the cases the runtime rescues never warn — `record.amount / 100` (the #1930
    `registerOperator` fix), `record.due == today()` and numeric-string / ISO-date
    values (the string-hydration retry), and numeric-coded `select` option values.
  - Equality (`==` / `!=`) is excluded: a heterogeneous equality is runtime-safe
    (evaluates to `false`), never a fault.

  New `firstTypeMismatch(source, fieldCelTypes, scope)` export in
  `@objectstack/formula` (and an optional `fieldTypes` hint on
  `validateExpression`); `@objectstack/lint`'s `validateStackExpressions` threads
  each object's field types into every checked site:

  - **record-scoped** sites (`record.<field>`) — formula fields, validation rules,
    action / hook / sharing predicates;
  - **flattened** flow / automation conditions (bare `field`) — where flow
    variables stay `dyn` and are never flagged, and equality stays runtime-safe.

  Warnings are advisory in `objectstack build` / `validate` (fatal only under
  `--strict`), matching the tier-3 channel.

### Patch Changes

- e0859b1: fix(formula): retire the `js` expression dialect and fix the `hasDialect` false-positive (#3278)

  The `js` **expression** dialect was declared in `ExpressionDialect` but never
  shipped — it existed only as a registry stub with no engine and no author helper
  (`cel`/`F`/`P` → CEL, `tmpl` → template, `cron` → cron; nothing ever emitted
  `js`). Per ADR-0049 (enforce-or-remove) it is removed from the enum; the set is
  now `{cel, cron, template}`.

  Procedural JavaScript is unaffected: it remains the **L2** authoring surface —
  the sandboxed, capability-gated `ScriptBody { language: 'js' }` in hook/action
  bodies — which is a separate enum (`hook-body.zod.ts`), not an expression
  dialect.

  Also fixes a latent bug in `hasDialect`: it detected stubs via
  `dialect.startsWith('stub:')`, but stubs were registered under their real name,
  so the check was dead code and `hasDialect('js')` returned a false-positive
  `true`. With the stub removed, `hasDialect` reports only registered real
  engines, and the registry test now asserts the negative case (`hasDialect('js')
=== false`) so the gate can actually go red.

  No runtime behavior changes for any valid persisted artifact — no producer ever
  emitted `dialect: 'js'`. See the ADR-0058 addendum.

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0

## 16.0.0-rc.1

### Minor Changes

- 7125007: **Stored `Field.formula` fields that compute dates/durations no longer silently evaluate to `null` (#3306).** Three independent CEL gaps made shipped template formulas (e.g. `hr_employee.tenure_years`, `hr_time_off_request.days`) return `null` with no parse/build/runtime error:

  1. **The null-guard idiom `cond ? <value> : null` now compiles and evaluates.** cel-js's ternary type-unifier rejects a concrete `int`/`double`/`string` branch against `null` — so even `true ? 5 : null` faulted _"Ternary branches must have the same type"_ and the whole formula nulled. A `Field.formula` is inherently nullable and the catalog blesses both ternary and `== null`, so this is the canonical "compute value, else blank" shape. An AST pre-pass (mirroring the #3183 temporal-equality rewrite) wraps the non-null branch in `dyn(...)` — value-preserving, null-branch-only, idempotent — so it type-checks and runs. Applied in `compile()`, `evaluate()`, and the build soundness check alike.

  2. **`floor(x)` / `ceil(x)` are now registered** (parallel to `round`/`abs`) and advertised in the catalog. They round toward −∞ / +∞, so `floor(-1.2) == -2` — NOT interchangeable with integer division's round-toward-zero. Previously `floor(...)` faulted `found no matching overload` and the formula nulled.

  3. **Date arithmetic is now a build-time ERROR instead of a silent runtime `null`.** `record.end_date - record.start_date + 1`, `today() + 30`, `record.date + n` type-check clean (operands are `dyn`) but always fault at runtime and never recover (a date string is not numeric, so hydration can't rescue it). The build soundness check now types `date`/`datetime` fields as `google.protobuf.Timestamp` and flags date/duration **arithmetic against a number** with a corrective message pointing at `daysBetween(a, b)` / `daysFromNow(n)` / `addDays(d, n)` / `addMonths(d, n)`. Sound by construction — ordering (`date < today()`, `date < "2026-01-01"` string-lex), equality (#3183), and string concatenation (`"Due: " + date`) are all runtime-tolerated and never flagged; only arithmetic against a number is. A `!= null` guard on a date field no longer masks the inner fault (`== null` no-op overloads registered in the check-only env).

  > **Heads-up for downstream:** (3) adds a NEW build-time error. A stored formula or predicate doing arithmetic on a `date`/`datetime` field (`end - start + 1`, `today() + 30`) that previously built (and nulled at runtime) will now fail `objectstack build` / `validateStackExpressions` with a message telling you to use `daysBetween` / `daysFromNow` / `addDays`. This only fires for genuinely-broken expressions that already returned `null`.

  Fixes #3306.

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- 6b51346: feat(formula): `dateField == today()` now matches — AST temporal-comparison rewrite (#3183)

  **Behavior change (the fix):** a `Field.date` compared with `==`/`!=` against a
  temporal function now matches on the calendar day. Previously it **silently
  returned the wrong answer** — `record.due_date == today()` was always `false`
  (and `!= today()` always `true`) even for a same-day record, because a
  `Field.date` reads back as a `YYYY-MM-DD` **string** (ADR-0053 Phase 1) and
  cel-js's equality (`overloads.js` `isEqual`) treats a string and a timestamp as
  unequal without consulting any overload.

  `celEngine.evaluate` now rewrites the parsed AST: for each `==`/`!=` whose one
  operand is `today()`/`daysFromNow()`/`daysAgo()`/`now()`, the **field operand**
  is wrapped in `date(...)` (the stdlib coercion), then the expression is
  serialized and evaluated. So `record.due_date == today()` runs as
  `date(record.due_date) == today()`.

  - **Per-occurrence**, not per-field: `record.d == "2026-06-20" || record.d == today()`
    keeps the string-literal comparison intact while fixing the temporal one.
  - **Type-blind-safe**: `date()` degrades gracefully — an already-`Date`
    (`Field.datetime`) operand passes through; a non-date string or null →
    `Invalid Date` → the comparison stays `false`, exactly as before. No
    field-type information is needed, and no currently-correct result is worsened.
  - **Cheap**: the rewrite only reserializes when such a comparison is present
    (a plain-`includes` gate skips the rest), and is memoized per source string.

  Applies to every interpreter site — read-time `Field.formula`, default values,
  validation rules, hook conditions, and flow conditions — since all route through
  `celEngine.evaluate`. RLS/sharing conditions are unaffected: they compile via
  `cel-to-filter`, which already rejects function calls as a loud authoring error.

  **Supersedes the #3192 advisory lint.** That build-time warning
  (`checkTemporalDateEquality`) flagged `dateField == today()` as a silent-miss;
  with the runtime fixed it would be a false alarm, so it (and the
  `temporalEqualityFields` helper it used) is removed. Authors can now write the
  natural `record.due_date == today()` directly; the `date(...)` /
  `daysBetween(...) == 0` / range idioms all keep working.

- 80273c8: feat(formula): warn when a `date` field is compared to a temporal function with `==`/`!=` (#3183)

  A `Field.date` deserializes as a `YYYY-MM-DD` **string** (ADR-0053 Phase 1), and
  cel-js's equality hard-codes `string == <timestamp>` to `false` — it returns
  `false` for a string left operand without ever consulting a registered overload,
  and refuses cross-type object equality (`@marcbachmann/cel-js` `overloads.js`
  `isEqual`). So the most natural "is it due today" predicate —

  ```cel
  record.due_date == today()      // silently false, even when due_date IS today
  record.due_date != today()      // silently true for a same-day record
  ```

  — compiles clean, throws nothing, and silently never matches. Same silent-miss
  family as #1928; **timezone-independent** (fails identically at UTC) and
  cross-cutting (formulas, validation, RLS, flow/action/sharing/hook predicates).

  cel-js gives no operator-layer hook to fix the comparison, so this adds a
  **build-time advisory warning** (the established ADR-0032 guardrail strategy)
  rather than a runtime behavior change. `validateExpression` reuses the shared
  `ExprSchemaHint.fieldTypes` (the same per-field type map the #1928 tier-4
  soundness check already threads through `@objectstack/lint`) to flag a `==`/`!=`
  between a `date` field (`record.`/`previous.`/bare) and
  `today()`/`daysFromNow()`/`daysAgo()`/`now()`, with a self-correcting message
  pointing at the working idioms: `date(record.d) == today()`, a range
  (`>= … && <= …`), or `daysBetween(today(), record.d) == 0`.

  Warning severity — never fails the build (the write/validation path may carry a
  real `Date`). Restricted to `type: 'date'` (unambiguously a string); `datetime`
  is excluded to avoid false positives. Ordering operators (`>=`/`<=`/`<`/`>`)
  already work — cel-js _throws_ for them, tripping the engine's existing
  string-hydration retry — so they are not flagged.

  A runtime fix (normalizing the peer of a temporal operand in the data layer)
  remains tracked in #3183; a naive "hydrate date fields to `Date`" version would
  trade this silent-miss for another (breaking `dateField == "2026-06-20"`), so it
  needs its own design.

- ea32ec7: feat(formula,lint): advisory type-soundness warnings for formula/predicate expressions (#1928 tier 4)

  Closes the last open guardrail from #1928. A `Field.formula` or record-scoped
  predicate that uses a **text or boolean field with an arithmetic (`+ - * / %`)
  or ordering (`< > <= >=`) operator against a number** faults the runtime
  overload and silently evaluates to `null` (e.g. `record.title * 2`,
  `record.is_active + 1`). The build now surfaces this as a **non-blocking
  warning** with the offending field and a corrective message.

  Honours the ADR-0032 design law — the checker only flags what the runtime
  would also fail:

  - Number / currency / percent / date / datetime fields are declared `dyn`, so
    the cases the runtime rescues never warn — `record.amount / 100` (the #1930
    `registerOperator` fix), `record.due == today()` and numeric-string / ISO-date
    values (the string-hydration retry), and numeric-coded `select` option values.
  - Equality (`==` / `!=`) is excluded: a heterogeneous equality is runtime-safe
    (evaluates to `false`), never a fault.

  New `firstTypeMismatch(source, fieldCelTypes, scope)` export in
  `@objectstack/formula` (and an optional `fieldTypes` hint on
  `validateExpression`); `@objectstack/lint`'s `validateStackExpressions` threads
  each object's field types into every checked site:

  - **record-scoped** sites (`record.<field>`) — formula fields, validation rules,
    action / hook / sharing predicates;
  - **flattened** flow / automation conditions (bare `field`) — where flow
    variables stay `dyn` and are never flagged, and equality stays runtime-safe.

  Warnings are advisory in `objectstack build` / `validate` (fatal only under
  `--strict`), matching the tier-3 channel.

### Patch Changes

- e0859b1: fix(formula): retire the `js` expression dialect and fix the `hasDialect` false-positive (#3278)

  The `js` **expression** dialect was declared in `ExpressionDialect` but never
  shipped — it existed only as a registry stub with no engine and no author helper
  (`cel`/`F`/`P` → CEL, `tmpl` → template, `cron` → cron; nothing ever emitted
  `js`). Per ADR-0049 (enforce-or-remove) it is removed from the enum; the set is
  now `{cel, cron, template}`.

  Procedural JavaScript is unaffected: it remains the **L2** authoring surface —
  the sandboxed, capability-gated `ScriptBody { language: 'js' }` in hook/action
  bodies — which is a separate enum (`hook-body.zod.ts`), not an expression
  dialect.

  Also fixes a latent bug in `hasDialect`: it detected stubs via
  `dialect.startsWith('stub:')`, but stubs were registered under their real name,
  so the check was dead code and `hasDialect('js')` returned a false-positive
  `true`. With the stub removed, `hasDialect` reports only registered real
  engines, and the registry test now asserts the negative case (`hasDialect('js')
=== false`) so the gate can actually go red.

  No runtime behavior changes for any valid persisted artifact — no producer ever
  emitted `dialect: 'js'`. See the ADR-0058 addendum.

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1

## 15.1.0

### Patch Changes

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0

## 13.0.0

### Major Changes

- 6d83431: ADR-0090 P1 breaking wave — permission model v2 concept convergence.

  Pre-launch one-step renames and secure defaults (no compatibility aliases, per
  ADR-0090 D3/D4 superseding ADR-0057 D5/D7's alias discipline):

  - `sys_role` → `sys_position`, `sys_user_role` → `sys_user_position` (field
    `role` → `position`), `sys_role_permission_set` → `sys_position_permission_set`
    (field `role_id` → `position_id`); `RoleSchema`/`defineRole` →
    `PositionSchema`/`definePosition` with **no `parent`** (positions are flat;
    hierarchy lives on the business-unit tree).
  - `ExecutionContext.roles[]` → `positions[]`; the EvalUser/CEL contract
    `current_user.roles` → `current_user.positions` (formula validators updated);
    stack property `roles:` → `positions:`; metadata kinds `role`/`profile` →
    `position` (profile kind removed).
  - `isProfile` removed from `PermissionSetSchema` (ADR-0090 D2); `isDefault`
    narrows to an install-time suggestion; `appDefaultProfileName` →
    `appDefaultPermissionSetName` (isDefault-only).
  - OWD enum drops legacy aliases `read`/`read_write`/`full`; new optional
    `externalSharingModel` (external dial, `private` default) lands as P1 spec
    shape (ADR-0090 D11).
  - **Secure default (D1)**: a custom object with an owner field and NO
    `sharingModel` now resolves `private` (was: fully public). System objects
    keep their explicit posture. Unrecognised stored values fail closed.
  - ExecutionContext gains the P1 principal-taxonomy shape (D10):
    `principalKind` / `audience` / `onBehalfOf` (optional, semantics phase in
    later).
  - Sharing recipients: `role` → `position` (expanded via `sys_user_position`
    ∪ the better-auth membership transition source); `role_and_subordinates`
    removed — `unit_and_subordinates` now expands the business-unit subtree
    (finishes ADR-0057 D5's re-homing).

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
  - @objectstack/spec@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
  - @objectstack/spec@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0

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
