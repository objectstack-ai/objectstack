# @objectstack/objectql

## 17.0.0-rc.1

### Major Changes

- 2d3e255: feat!: ADR-0113 — `required` is a write contract; the column constraint becomes the explicit `storage.notNull`

  `field.required` bound three meanings to one knob (write check, `NOT NULL` DDL,
  drift expectation), so tightening any invariant on a deployed object was a
  destructive migration blocked by the very legacy nulls that motivated it — the
  reason `criteria_json`'s mandatory-in-substance contract lived in three
  imperative guards instead of one declaration.

  Split, with the **non-regression invariant** as the unifying rule — _a write
  may not take a record from compliant to violating; a pre-existing violation
  does not block writes that leave it in place_:

  - `required: true` = the write contract, uniformly on new and deployed objects:
    insert must provide; **an update PATCHing `null` into a required field is now
    rejected** (it silently passed before); omitted fields never block, so legacy
    null rows rest. The column stays nullable.
  - `storage: { notNull: true }` = the explicit physical constraint, owning the
    DDL (`sql-driver` `createColumn`) and the destructive drift ceremony.
    Orthogonal to `required` — all four combinations are legitimate, including
    the engine-populated column (`storage.notNull` without `required`).
  - `requiredWhen` inherits the same invariant: flipping the condition true
    without providing the field is rejected (the write _creates_ the violation);
    a row violating since before the rule tightened no longer locks out
    unrelated edits (#3929's objection, cured). `storage.notNull` ×
    `requiredWhen` rejects at parse (`FieldSchema.superRefine`).
  - **Pre-17 sources keep their exact meaning** via the migration-chain-only
    `field-required-notnull-explicit` conversion: `os migrate meta` stamps
    `storage.notNull` onto every previously-required field — writing down what
    the old text already meant. The loader never infers semantics from the
    physical column.
  - Drift compares nullability against `storage.notNull`; a column stricter than
    its declaration is `needs_confirm` (never auto-applied — dev auto-reconcile
    no longer silently strips a stray `NOT NULL`), and silent when the field is
    write-gated by `required`.

- 55bbefc: fix(objectql)!: retire the dead `ObjectQLEngine.use()` plugin path (#4212 follow-up)

  `ObjectQLEngine.use(manifestPart, runtimePart)` was the engine's own plugin
  loader: register a manifest, then dispatch the runtime part's `onEnable` with
  an `ObjectQLHostContext`. **Nothing calls it** — not the kernel (plugins go
  through `kernel.use()` → `init`/`start`), not the CLI, not a test, not an
  example, repo-wide. Its `onEnable` dispatch is the engine-level twin of the
  #4212 disease: a lifecycle entry point that reads as a contract and never
  runs. The _app-bundle_ `onEnable` module export is a different, real contract
  (dispatched by AppPlugin at boot) and is unchanged.

  Removed:

  - `ObjectQLEngine.use()`.
  - `ObjectQLHostContext` (exported from `@objectstack/objectql` and
    `@objectstack/objectql/core`) — constructed only inside the dead method.
  - The engine's private `hostContext` field — its only read outside the dead
    method was the constructor's `logger` extraction, which stays; the
    constructor signature is unchanged (`new ObjectQL({ logger })` keeps
    working, as does `ObjectQLPlugin`'s `hostContext` option that feeds it).

  FROM → TO:

  - `engine.use(manifest)` → `engine.registerApp(manifest)` (the alive half —
    the manifest service and ObjectQLPlugin already route through it).
  - `engine.use(_, { onEnable })` → a kernel plugin: `kernel.use({ name,
init(ctx) { … } })`; the engine is `ctx.getService('objectql')`, drivers
    register via `engine.registerDriver()`.
  - `ObjectQLHostContext` → no replacement; the type described the context of
    a hook that never fired.

- 77fadbf: fix(metadata-protocol,objectql)!: retire the degraded analytics shim — the `analytics` slot stays empty without service-analytics (#3891, #3878)

  The protocol assembly (`assembleMetadataProtocol`, used by both
  `MetadataProtocolPlugin` and `ObjectQLPlugin`'s built-in mode) used to register
  a lightweight `analytics` fallback so `POST /api/v1/analytics/query` kept
  answering on installs without `@objectstack/service-analytics`. That fallback
  is **removed**, and with it the facade methods that existed only to serve it:
  `ObjectStackProtocolImplementation.analyticsQuery` / `getAnalyticsMeta` (the
  class no longer implements `AnalyticsProtocol`).

  Why removal instead of repair (#3891):

  - **It dropped the caller's ExecutionContext at the door.** The dispatcher
    passes `context.executionContext` (#2852), but the shim's `query` was
    unary — aggregation reached `engine.aggregate` with no context, the security
    middleware's empty-principal branch waved it through, and **no RLS or tenant
    predicate was injected**. An authenticated caller got a 200 with rows RLS
    would hide.
  - **It ignored the contract filter.** `AnalyticsQuery`'s canonical filter field
    is `where`; the shim read only a non-contract `filters` key, so a
    spec-conformant filtered request silently returned a full-table aggregate.
  - **Every security gate had to be built twice** (#3770 on the shim vs
    #3867/#3875 on the real engine) — the "duplicates logic only, harmless"
    assessment in ADR-0076 D10 did not survive contact with reality.

  `getDiscovery()` stops hardcoding analytics as an always-on kernel service —
  the entry is now computed from the service registry like every other optional
  service (`enabled: false, status: 'unavailable'` and **no advertised route**
  when absent), which also removes the pre-#2462 discovery lie the shim was
  originally invented to make true.

  **Migration.** Deployments that relied on the fallback (programmatic
  `createStandaloneStack()` / `createObjectQLKernel()` embeds, hosts whose bundle
  doesn't require `analytics`): install `@objectstack/service-analytics` and
  mount `AnalyticsServicePlugin` — the real, context-aware engine. Without it,
  `/api/v1/analytics/*` now answers **404 ROUTE_NOT_FOUND** (previously: 200 with
  unscoped, unfiltered aggregates) and discovery reports
  `analytics: { enabled: false, status: 'unavailable' }`. Callers of
  `protocol.analyticsQuery(...)` / `protocol.getAnalyticsMeta(...)` must use the
  `analytics` service (`kernel.getService('analytics')`) instead. `os serve`
  default/full presets and managed environments already force the real engine and
  are unaffected.

### Minor Changes

- 48fcf70: **[ADR-0110 D5] The action-governance inventory moves to the engine plugin —
  AppPlugin never ran it on the platform's own dev path.**

  Dogfooding the inventory with a positive control (an injected undeclared
  handler) showed the `kernel:ready` hook it hung on never fired under `os dev`:
  AppPlugin is registered conditionally (`serve.ts` skips it when the host wraps
  itself; the dev fast path loads apps without it), so the checklist that
  justifies D3's no-opt-out refusal was never printed where an upgrade most
  needs it.

  - The addressing vocabulary (`GLOBAL_ACTION_OBJECT_KEY`,
    `actionHandlerObjectKeys`, `isObjectLessActionKey`,
    `resolveActionHandlerKeys`) and the reconciliation move into
    `@objectstack/objectql` — the engine owns the map they describe, and the
    dependency direction (runtime → objectql) permits no other home.
    `@objectstack/runtime` re-exports them unchanged, so dispatch, the MCP
    bridge and existing importers keep reading ONE implementation.
  - `ObjectQLPlugin` now runs the inventory in its existing `kernel:ready`
    handler — after `resyncAuthoredActions`, so the audited registry is final —
    and again on `metadata:reloaded`, fingerprint-suppressed so a reload that
    changed nothing action-related logs nothing. A Studio edit that orphans or
    binds a handler updates the report live; the old boot-only snapshot went
    stale on the first edit.
  - Verified end-to-end with a programmatic kernel: the injected orphan is
    named, a clean registry is silent. The `os dev` / `os serve` consoles still
    swallow ALL plugin boot logs (pre-existing, tracked separately) — on those
    surfaces the inventory becomes visible once that sink is fixed.

- b1863a5: feat(objectql): `engine.isFileReferencesMigrationVerified()` is public — one memoized flag read for both in-process consumers (#3459 PR-5b)

  The memoized per-deployment read of the `adr-0104-file-references` migration
  flag was private to the engine's media value-shape enforcement. The storage
  service's release path now asks the same question — may a released field file
  be tombstoned? — so the method is public and the release hooks reach it as an
  optional duck-typed member (an older engine or a test fake reads as "not
  verified", failing closed). One read, one invalidation
  (`invalidateDataMigrationFlags()`), no way for the two consumers to see
  different answers.

- 270650f: feat(migrate): a datastore created from empty attests its data migrations at creation (#3438, ADR-0104 2026-07-30 addendum)

  Deployment-level migration flags could only be recorded by running
  `os migrate`. That left a hole at the other end of a deployment's life: a
  database created on a version that already ships the migrations started **lax**
  and stayed lax until someone thought to run a command that, for them, converts
  nothing and finds nothing. Every new deployment re-entered the warn regime, so
  the warn regime would never die out — and, since #3459, every new deployment
  also kept every released file forever.

  A store the platform **creates from empty** now records
  `adr-0104-file-references` and `adr-0104-value-shapes` at that moment. Nothing
  to run; enforcement and collection are live from the first boot.

  **This is not version-gating in disguise.** The fact recorded — no legacy value
  is stored here — is _observed_: the store had no history at all. The platform
  attests only what it watched itself create, and the test is deliberately
  strict: every table made by this boot and **none found already present**. One
  pre-existing table anywhere, one datasource that was already there, one driver
  that cannot account for its schema sync — any of those and the deployment
  attests nothing and produces its evidence by scan, exactly as before. "Found
  empty" and "created empty" are not the same claim, and only the second is an
  observation.

  **New surfaces.** `IDataDriver.getSchemaSyncStats?()` (optional, purely
  observational: tables created vs found since connect — implemented by the SQL
  and in-memory drivers), `engine.wasDatastoreCreatedFromEmpty()`,
  `attestFreshDatastore()` in `@objectstack/platform-objects/system`, and
  `VALUE_SHAPES_MIGRATION_ID` / `CREATION_ATTESTED_MIGRATION_IDS` in
  `@objectstack/spec/system`. Attestation never overwrites an existing flag row
  and never throws into a boot: a failure leaves the deployment lax, which a
  migration run can still fix.

  **Upgrading changes nothing for an existing database.** It is non-empty when
  the platform reaches it, so it is never attested — run
  `os migrate files-to-references --apply` as before. Importing legacy values
  into an attested deployment is rejected loudly at the write path;
  `OS_ALLOW_LAX_MEDIA_VALUES=1` re-opens leniency while you diagnose.

- 3aef718: feat(migrate): `os migrate value-shapes` — the per-deployment gate for reference and structured-JSON value shapes (#3438)

  The second of ADR-0104 D1's two evidence gates. Media value shapes already
  enforce once a deployment has verified its file migration (#3681); the
  reference (`lookup` / `master_detail` / `user` / `tree`) and structured-JSON
  (`location` / `address` / `composite` / `repeater` / `record` / `vector`)
  classes now get a gate of their own.

  ```bash
  os migrate value-shapes           # scan: reports, writes nothing
  os migrate value-shapes --apply   # scan + record the deployment flag when clean
  ```

  The run walks every stored value of those classes against
  `valueSchemaFor(field, 'stored')` — the same predicate the write path enforces,
  imported rather than re-derived — and, at zero violations, records
  `sys_migration { id: 'adr-0104-value-shapes', verified_at, blocking: 0 }`.
  Strict enforcement of these classes reads **that row**, never the platform
  version, so upgrading changes nothing until a deployment produces its own
  evidence.

  **There is no backfill, deliberately.** The file migration converts legacy
  values because the platform narrowed that storage form and owes the conversion.
  A malformed `location` is application data whose correct value only its author
  knows, so this run reports and prescribes — naming the object, field, type,
  count, offending record ids and the parse issue — and the operator fixes and
  re-runs. With nothing to convert, `--apply`'s only write is the flag row, which
  keeps the #3617 invariant trivially: a dry run changes nothing, and whether a
  run changed this deployment's posture never depends on what it found.

  **A separate flag from the file migration**, because it attests a separate
  fact. That flag says file values were migrated and their ownership reconciled;
  it says nothing about whether a `lookup` id or a `location` payload is well
  formed. Gating these classes on it would be borrowing evidence for a fact it
  does not cover.

  - New escape hatch **`OS_ALLOW_LAX_VALUE_SHAPES=1`** returns a verified
    deployment to warnings, with the same precedence as its media sibling: the
    opt-out beats `OS_DATA_VALUE_SHAPE_STRICT_ENABLED`, which beats the flag.
    Wrongly staying lenient costs a warning; wrongly enforcing stops a working
    app from writing.
  - `@objectstack/spec/system` exports `VALUE_SHAPES_MIGRATION_ID`.
  - `@objectstack/objectql` exports `scanValueShapes`, `valueShapeScanPassed`
    and `formatValueShapeScanReport`. The scanner is read-only and does **not**
    record the flag: readers of a migration flag use the spec contract, only
    writers depend on `@objectstack/platform-objects`, so the composition lives
    with the CLI command rather than inverting the engine's dependencies.
  - `validateRecord` gains `valueShapeStrict`, the sibling of
    `mediaValueShapeStrict`. Both default to `false`: a caller that cannot say
    stays lenient, so nothing starts rejecting merely because the evidence was
    unavailable.

  **Nothing changes for an existing deployment until it runs the command.** A
  scan that is truncated, or that cannot read an object, fails the gate even with
  zero violations found — "none in the part we read" is not the claim the flag
  makes.

- ffb003c: **ADR-0110 — an action's identity is its `name`, and anything executable over a
  governed surface must have a declaration.**

  `POST /api/v1/actions/:object/:action` resolved the DECLARATION from the URL
  segment as a `name` but dispatched the HANDLER using that same segment as a
  registry key. For a target-bound action (`{ name: 'complete_task', target:
'completeTask' }`) those are different strings, so the two documented callers
  each worked on exactly the half the other broke: the documented curl resolved
  the declaration then 404ed, while the Console's `target`-addressed call
  dispatched fine and resolved no declaration — silently skipping the ADR-0066 D4
  capability gate and the ADR-0104 param contract (#3935).

  - **D1/D2** — identity is always the declarative `name`; the handler key is
    derived from the resolved declaration through a rotation now shared with the
    MCP `run_action` bridge (`resolveActionHandlerKeys`, `executeRegisteredAction`).
    The REST route previously rotated only the object key, never the handler key.
  - **D3 (breaking)** — declaration resolution is a trichotomy. A genuinely
    undeclared handler is **refused (404)** with the `defineAction` to add, rather
    than executed ungated with system privileges; an unreachable metadata plane is
    a **503** rather than a silent ungating (`MetadataManager.loadDiagnosed` tells
    a clean miss from an outage). `OS_ALLOW_UNDECLARED_ACTIONS=1` is the migration
    valve — it warns on every invocation and is removed in 18.
  - **D5** — `reconcileActionRegistrations` plus `ObjectQLEngine.listRegisteredActions`
    power a `kernel:ready` inventory logging every registered-but-undeclared
    handler (refused at dispatch) and every declared script action bound to no
    handler — the ADR-0078 converse, mechanised.
  - **D6** — security-gate strictness is opt-**out** (`OS_ALLOW_*`), never opt-in.

  Apps whose actions are all declared need no changes beyond gaining enforcement
  of the `requiredPermissions` they already declared.

- 7d7521f: feat(spec,rest,objectql)!: a closed field-level error catalog, and Zod stops leaking onto the wire (#3977)

  Settles the vocabulary ADR-0112 D6 deferred, per [ADR-0114](https://github.com/objectstack-ai/objectstack/blob/main/docs/adr/0114-field-level-error-code-catalog.md).

  **`FieldErrorCode` — a closed, lowercase catalog.** 27 members covering what the
  six emitters already emit. `FieldErrorSchema.code` tightens from `z.string()` to
  this enum, so a validation body's per-field codes are validated for the first time.
  `FieldValidationError.code` (objectql) and `FieldCoerceError.code` (rest) stop
  being a hand-listed union and a bare `string` respectively and reference the
  catalog, so the three cannot drift apart.

  Lowercase is deliberate, not an oversight against ADR-0112's SCREAMING_SNAKE: a
  top-level code names the condition the _request_ hit, while a field-level code
  names the _constraint_ the value violated — and constraints are declared in the
  metadata's own snake_case, so `max_length` the code and `max_length: 50` the
  property are the same word on purpose.

  **Zod issue codes no longer reach the wire (wire-visible).** Routes that validate
  with Zod passed its vocabulary straight through, so `fields[]` spoke a different
  language depending on which route served it, and `too_small` was ambiguous between
  a short string, a small number and a short array. `zodIssuesToFields` now maps
  using Zod's `origin`/`format`:

  | Was                                               | Now                                                |
  | :------------------------------------------------ | :------------------------------------------------- |
  | `too_small`                                       | `min_length` / `min_value` / `min_items`           |
  | `too_big`                                         | `max_length` / `max_value` / `max_items`           |
  | `invalid_format`                                  | `invalid_email` / `invalid_url` / `invalid_format` |
  | `invalid_value`                                   | `invalid_option`                                   |
  | `unrecognized_keys`                               | `unknown_field`                                    |
  | `invalid_union`, `invalid_element`, `invalid_key` | `invalid_shape`                                    |

  **A missing required property now reports `required`, not `invalid_type`.** Zod
  spells "absent" as a type mismatch against `undefined`, so passing it through made
  a form mark a _missing_ input as the wrong _type_. The two are indistinguishable on
  the issue alone, so the mapper takes the parsed input as an optional argument and
  walks the issue path; a caller that cannot supply it keeps `invalid_type` rather
  than guessing.

  **`unknown_param` → `unknown_field`.** `ActionParamIssue.code` references the
  catalog instead of its own literal union; the `param` key beside it already says
  what was addressed.

  **Not changed:** `EnhancedApiErrorSchema.fieldErrors` keeps its name even though
  every producer emits `fields`. Retiring an authorable key needs a tombstone plus a
  migration (ADR-0104's contract guard), so it lands on its own — the property now
  carries a banner saying which name the wire uses.

- ab9fb5c: A hook with an empty `object` target is refused instead of silently widened to the wildcard.

  `HookSchema.object` had no emptiness constraint, so `''`, `[]` and `['']` all parsed. The binder's `normalizeObjects` then mapped the first two to `['*']` — the engine's match-everything sentinel — so a hook whose target was left blank registered on **every** object in the tenant, on every event it listed, with no diagnostic anywhere. `['']` failed the other way, registering on an object name nothing matches: a hook that could never fire (ADR-0078). Both shapes are now refused, at parse time and again in the binder (which accepts unparsed input, so the guard has to hold in both places). The error names the two spellings that work and the wildcard the blank silently became. A wildcard hook stays legitimate — it just has to be spelled `'*'`, so it is a choice visible in a diff.

  Also fixes `bindHooksToEngine`'s `strict` option, which is documented as "fail fast on misconfiguration" but never threw: the per-hook `try`/`catch` swallowed the throw its own strict branch raised, recording the failure twice and carrying on. Under `strict` a bind failure is now fatal, as advertised.

- 507b92a: fix(spec,objectql,rest,runtime): field-validation messages answer in the caller's language, named by the field's label (#3957)

  The write path built every built-in validation message by concatenating the **API
  field name** into a **hardcoded English** template. Those strings are what the
  Console toast, the CSV-import row report, the CLI and any custom client display
  verbatim, so a Chinese-locale user importing a bad row read:

  ```
  第 1 行:penalty_amount must be ≥ 0
  ```

  …for a field declared `label: '处罚金额'` with a full `zh-CN` bundle loaded. The
  form layer localized the _same_ constraint correctly (the browser's native
  `min`), so the language flipped depending on which layer caught the value.

  **Three things changed.**

  1. **The message is rendered in the caller's locale** from a built-in catalog
     (`BUILTIN_VALIDATION_MESSAGES`, `@objectstack/spec/system`) shipping `en`,
     `zh-CN`, `ja-JP`, `es-ES` — the same four locales as the platform bundles.
     The locale comes from `ExecutionContext.locale`, whose contract already read
     "Drives message catalogs"; this is the consumer that makes that true. Both
     HTTP entries (REST server, runtime dispatcher) now resolve it from the
     request's `Accept-Language` / `?locale` first, falling back to the workspace
     `localization.locale` — so a rejection message and the field labels around it
     can no longer disagree.

  2. **The field is named by its label, never the API name**: translation bundle
     (`objects.<obj>.fields.<f>.label`) → declared `label` → API name as the last
     resort. `FieldValidationError.field` still carries the API name so a form can
     focus the right input.

  3. **The constraint is exposed as data**, so a client can format its own text
     instead of parsing the sentence:
     `{ field, code, message, label, constraint: { min: 0 } }`. This rides
     ADR-0114's existing `constraint` / `value` positions on `FieldErrorSchema`
     (`constraint` tightens from `unknown` to `Record<string, unknown>`) rather
     than adding a parallel payload — `label` is the only new field. The bag
     carries `min`/`max`/`minLength`/`maxLength`/`actual`/`allowed`/`type`, and the
     message templates interpolate from exactly those keys.

  Covered end-to-end, not only in the validator: single and batch insert,
  single-id and multi-row update, ADR-0113's clear-out rejection, the object-level
  rule evaluator's own built-in messages (`requiredWhen`, per-option gating,
  state-machine fallbacks), and the importer's cell-coercion, required pre-check
  and #3956 bound pre-check messages — all of which land in the same row report.

  **What this changes for consumers.**

  - `code` is unchanged (ADR-0114's `FieldErrorCode`) and remains the thing to
    match on. Message keys are finer-grained than codes — `invalid_datetime`,
    `invalid_option_value`, `required_cleared` are rendering detail and never reach
    the wire — so localization never splits the client-facing vocabulary.
  - `message` **text changes**: it is localized, and it names the field by label
    even in English (`Budget must be ≥ 0`, not `budget must be ≥ 0`). Anything
    asserting on the old English string should match `code` (and now
    `constraint`) instead.
  - An author-written validation-rule `message` is never touched — it is already
    in the language its author chose.
  - A deployment can override any built-in message with a `translation` item
    defining `validation.field.<messageKey>` (e.g.
    `validation.field.min_value: '{{label}}不得小于 {{min}} 元'`).
  - The importer's reference-failure message no longer names the target object's
    API name (`no sys_user matches "…"`): naming internal identifiers is the
    defect being fixed, and the column plus the offending value are what an
    importer can act on.

- b09d8d9: feat(objectql)!: `query.having` is enforced — the engine applies it after aggregation (#4286 step 3, ADR-0049 resolved to enforce)

  `having` had been declared on the request surface since AST v2 and executed by
  nothing. #4286 finding 1 showed the gap was structural: `engine.aggregate()`
  rebuilt the driver AST with exactly `object`/`where`/`groupBy`/`aggregations`,
  so even a driver that _did_ implement HAVING could never have received it, and
  the one wire path (`findData`'s aggregate branch) dropped the clause too. It
  was the strongest enforce candidate of the #4286 set — the clause every
  SQL-literate author (human or model) expects to work next to
  `groupBy`/`aggregations` — and it is now live end to end:

  - **Engine-owned, both paths.** `applyHaving()`
    (`packages/objectql/src/having-filter.ts`) runs AFTER aggregation on the
    native-driver path and the in-memory fallback alike — the same
    correct-first / optimize-later two-tier shape date bucketing uses. Native
    SQL `HAVING` pushdown can come later behind a driver capability flag without
    changing semantics.
  - **Namespace: the aggregated row's own columns** — aggregation aliases
    (`order_count`, `total`) and groupBy projections — with the ordinary
    FilterCondition operators plus `$and`/`$or`/`$not`.
  - **An unknown operator rejects loudly.** Ignoring one (as tolerant matchers
    do) would silently return unfiltered aggregates — the exact ADR-0078
    silently-inert failure enforcement exists to end.
  - **The wire path forwards it.** `findData`'s aggregate branch passes
    `having` through, and `EngineAggregateOptionsSchema` now declares it.
  - The FLS predicate guard already walked `having` references
    (`predicate-guard.ts`), which is what made enforcement safe to turn on.

  No migration needed: queries that carried `having` before were silently
  returning every group; they now filter as written. A caller who depended on
  the clause being _ignored_ (sending `having` and expecting unfiltered
  results) sees the corrected behavior — that is the enforcement, not a
  regression.

- 5c13368: feat(objectql,runtime): the default-runner setters are first-wins, and the private-field probes that used to enforce that are gone (#4251)

  `setDefaultBodyRunner` / `setDefaultActionRunner` now enforce their own
  documented contract — "the runtime layer sets this once per engine" — by
  keeping the first runner and returning `false` for any later call. Public
  accessors `getDefaultBodyRunner()` / `getDefaultActionRunner()` join them, and
  the fields become real `private` members instead of `(this as any)` attachments.

  Before this, the invariant lived in the CALLERS: AppPlugin probed the engine's
  private `_defaultBodyRunner` / `_defaultActionRunner` fields through `any` to
  avoid clobbering another AppPlugin's runner on a shared kernel — an invariant
  owned by every caller and enforced by none, and a private reach that a field
  rename would have broken silently (the guard reads `undefined`, every AppPlugin
  reinstalls). The engine's own `bindHooks` fallback and ObjectQLPlugin's
  authored-action re-sync read the same fields the same way. All three read the
  public accessors now; the only remaining `_default*` mentions in the repo are
  comments and test doubles.

  Caller audit before the semantics change: every setter call site either owns a
  fresh engine (the sandbox and hook-binder tests) or wants exactly
  keep-the-first (AppPlugin) — nobody replaces a runner on a live engine. Return
  type `void` → `boolean` is additive; AppPlugin uses it to keep its "Installed
  default … runner" log truthful (skipped when the engine kept an earlier one).

  Pinned in hook-binder tests: second install refused end-to-end (the first
  runner is the one that executes) and the accessors expose exactly what was
  kept.

### Patch Changes

- 3ec8186: feat(migrate,objectql): the upgrade path names the data migrations that are still open here (#3438, ADR-0104 2026-07-30)

  Both value-shape gates fail toward leniency: a deployment that never runs its
  migration keeps warning instead of rejecting, and keeps every released file
  forever. That default is right — and completely silent, so the gate could sit
  open for the life of a deployment without anyone learning that one command ends
  it. A gate nobody is told about is served by nobody.

  Two announcements, each where an upgrade actually looks:

  - **`os migrate meta --from 16`** now ends by naming the data migrations a
    chain crossing into 17 leaves behind — `files-to-references`, `value-shapes`
    — with what each unlocks, scoped to the field classes the author's own
    metadata declares (an app with no media field is never told about the file
    migration). `--json` carries the same list as `dataMigrations`. The command
    reads no database, so it reports what remains _to do_, never what a given
    deployment has _done_.
  - **The server logs one line per open gate at boot**, naming the command that
    closes it. Only the lax posture announces itself — a verified gate already
    logs that it is enforcing, and an app declaring neither class of field costs
    nothing and says nothing. This is the half that can speak to a deployment's
    actual data, because it is the half with the database.

  Nothing about enforcement changes: same gates, same flags, same fail-toward-
  leniency default. The advisory runs on `kernel:bootstrapped` rather than
  `kernel:ready`, deliberately — the answer depends on the storage service's own
  ready handler, which registers `sys_migration` and may attest a store it just
  created, and racing it would tell a brand-new deployment its gates are open
  moments after they closed.

- 956e7f9: fix(objectql): the boot gate announcement stops firing where it is false, and stops counting fields nothing enforces (#3438)

  The startup line that names an open value-shape gate (#4253) fired on every
  deployment there is, and said something untrue on any deployment that had
  already settled the question with an environment switch. Both are the same
  failure — an advisory that speaks where it does not apply is how readers learn
  to ignore it — and neither is reachable from the suite that shipped with it,
  because `engine.test.ts` mocks the registry away and a mocked registry hands
  the engine exactly the fields the test wrote.

  `objectHasCoveredValueField` — the dormancy short-circuit that is supposed to
  spare an object with no covered field the flag query — tested raw type
  membership, while the real registry INJECTS covered-type fields into every
  object it registers: `organization_id` and `owner_id` (both `system`),
  `created_by` and `updated_by` (both in `SKIP_FIELDS`), four `lookup`s.
  `validateRecord` skips every one of them before it reaches the value-shape
  check, so the short-circuit answered `true` for literally every object, never
  fired, and its WeakMap memoized a constant. Counting is now by the validator's
  own `isScannableValueShapeField`, the predicate the scanner already imports —
  three readings of "a covered field" drifting by one clause is how a gate ends
  up governing fields nothing enforces.

  The announcement also consulted no environment switch, while both postures it
  reports on short-circuit ahead of the deployment flag. Under
  `OS_DATA_VALUE_SHAPE_STRICT_ENABLED` enforcement is already on for both
  classes, so "checked but NOT enforced here" was simply false; under either
  opt-out the operator chose leniency deliberately, so naming a migration that
  cannot change what they get is noise. Each gate now consults its own pair
  (`mediaPostureSetByEnv` / `valueShapePostureSetByEnv`, siblings for the reason
  `mediaStrictEffective` and `valueShapeStrictEffective` are siblings), since the
  opt-outs are per-class while the opt-in opens both. Cheapest test first, so a
  kernel with nothing to say still reaches no flag query.

  Enforcement is unchanged: same gates, same flags, same default. The flag read
  was already memoized per process, so what this corrects is the property
  ADR-0104 states, not a user-visible cost.

- 8d895ff: feat(spec,objectql,rest): publish the audit-provenance and import-coercion vocabularies (#3786, #4173)

  Two more hand-copied lists retired the same way, each replaced by one spec
  export and derivation at every consumer.

  **`AUDIT_PROVENANCE_FIELDS`** (`@objectstack/spec/data`, with the
  `AuditProvenanceField` type) — the four columns `applySystemFields` injects on
  every audit-tracked object: `created_at`, `created_by`, `updated_at`,
  `updated_by`. That four-name list existed in at least four copies across two
  repos: the registry's injection if-chain, the rule-validator's `preserveAudit`
  allowlist ("Kept in sync with the registry's auto-injected audit fields" — by
  nothing), and two objectui render surfaces. Now:

  - the registry's injection is table-driven, keyed by the tuple with a
    `satisfies Record<AuditProvenanceField, …>` clause — a name added to the spec
    without a column definition (or vice versa) is a compile error, the
    `APPROVER_VALUE_BINDINGS` discipline;
  - the rule-validator's `AUDIT_TIMELINE_FIELDS` derives from the same tuple;
  - `FIELD_GROUP_SYSTEM_FIELDS`' audit prefix derives from it too — one
    declaration even inside the file that hosts both;
  - objectui's `AUDIT_FIELD_BY_ROLE` already pins itself by subset assertion and
    can import the tuple directly once this release is published.

  Injection behaviour is byte-identical — a conformance test pins every injected
  column's shape against the pre-refactor definitions.

  **`IMPORT_BOOLEAN_TRUE_TOKENS` / `IMPORT_BOOLEAN_FALSE_TOKENS` /
  `IMPORT_REFERENCE_TYPES`** (`@objectstack/spec/data`) — the `/import` coercion
  vocabulary #4173 asked for. The server's `import-coerce.ts` now derives its
  `BOOL_TRUE` / `BOOL_FALSE` / `REFERENCE_TYPES` from these instead of owning
  them privately, and objectui's Import Wizard preview — which re-checks the same
  contract client-side so a cell is flagged red exactly when the server would
  reject it — can retire its pinned-inventory mirror once this release is
  published (the retirement path is written in that file's own header).
  `IMPORT_REFERENCE_TYPES` ships with the legacy `'reference'` spelling included,
  retiring the `+ 'reference'` literal both ends carried separately. The tables'
  own discipline is tested: sets disjoint, every token pre-normalized
  (lower-case, trimmed), and the Chinese / check-mark spreadsheet-reality tokens
  pinned by name.

  No behaviour change anywhere: every derived value is byte-identical to the
  literal it replaces.

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

- c20b875: **Correct the stale premise left behind by #4012: the degraded-boot stderr copy
  survives the operator's LOG LEVEL, not `os serve`'s boot-quiet window.**

  `emitDegradedBootBanner` writes the `OS_ALLOW_DRIVER_CONNECT_FAILURE` banner to
  stderr in addition to `logger.warn`, and every comment and test name explaining
  why cited the same reason: `os serve` swallowed all of stdout while the kernel
  booted, and `Logger` routes `warn` to stdout. #4012 fixed that — the boot window
  now buffers and replays `warn`-and-above — which retires the _stated_
  justification for a duplicate that is nonetheless still load-bearing:

  `Logger.write()` returns before touching a stream when the record is below
  `config.level`, so at `--log-level error`, `fatal` or `silent` the banner's
  `logger.warn` reaches **no** stream at all. A production host at `error` is
  exactly the deployment this escape hatch exists for, and exactly where a
  logger-only banner would vanish. Removing the stderr copy on the strength of
  #4012 would therefore have been a regression — so this documents the reason that
  is still true, in the places someone would read before deleting it:
  `degraded-boot.ts`, the engine's emit site, and all three parity tests
  (objectql, runtime, service-datasource), which are renamed off "which `os serve`
  boot-quiet cannot swallow" to "which the operator log level cannot filter away".

  The objectql parity test now proves the claim instead of asserting around it: it
  drives a **real** `ObjectLogger` at `level: 'error'` and requires the banner on
  stderr _and_ nothing on stdout. Set the level to `warn` and it fails — so the
  test is pinned to the level filter rather than passing for any reason.

  Also corrected in the same sweep, all comment-only, all previously overstating
  what #4012 had not yet fixed:

  - the automation wiring summary (`format.ts`, `serve.ts`, its test) claimed the
    boot window swallowed the engine's binding warnings. Its real justification is
    stronger and unchanged: a flow that silently fails to arm emits **no** log line
    at any level, so binding state has to be read off the live engine — absence of
    a warning was never evidence of a bound flow.
  - the seed summary (`seed-summary.ts`, `format.ts`, its test) and `AppPlugin`'s
    seed-outcome note attributed the silence to the boot window; the operative
    gate is that `SeedLoader`'s result logs are `info`, under the default `warn`.

  No behavior changes.

- ed77493: fix(objectql,spec): `filter` folds to `where` on EVERY engine method, and `top`/`limit` joins the #3795 slot table (#4346)

  The `filter` → `where` fold that #3795 settled at the protocol layer existed
  at the **engine** layer in exactly one of six methods. `ObjectQL.find()`
  folded it; `findOne`/`count`/`update`/`delete`/`aggregate` passed the option
  bag through with `ast.where === undefined`, which every driver reads as "no
  predicate" — so a caller filtering with `{ filter }` silently matched EVERY
  row:

  | call                                 | before                  | after          |
  | ------------------------------------ | ----------------------- | -------------- |
  | `findOne({filter: {status:'done'}})` | first row of the table  | a matching row |
  | `count({filter})`                    | whole-table count       | matching count |
  | `update(data, {filter, multi:true})` | **every row rewritten** | matching rows  |
  | `delete({filter, multi:true})`       | **table emptied**       | matching rows  |
  | `aggregate({filter, …})`             | aggregated all rows     | matching rows  |

  This was reachable, not theoretical: the deprecated
  `DataEngine{Query,Update,Delete,Count,Aggregate}OptionsSchema` contracts all
  declare `filter`, `ScopedContext`/`ObjectRepository` (the cross-object API
  handed to L2 hook bodies) forwards its argument verbatim, and the spec's own
  hook documentation taught the broken call
  (`users.findOne({ filter: { role: 'admin' } })` — now corrected to `where`).

  Every engine entry point now folds through the spec's own #3795 machinery
  (`RPC_QUERY_ALIAS_SLOTS` + `foldQueryAliasSlots`) instead of `find`'s
  hand-rolled copy, under the #4181 rule: an alias alone folds, redundant
  identical spellings collapse, DIFFERENT values for one slot throw
  ("Send exactly one") instead of silently picking a winner, and an explicit
  `null` alias is a withdrawal.

  **The sixth pair.** `top` → `limit` — the pair the #3795 scope note excluded
  as "the OData layer" — joins `RPC_QUERY_ALIAS_SLOTS`. The protocol normalizer
  folded it BACKWARDS (`options.limit = Number(options.top)` — the alias
  overwrote the canonical key) while `engine.find` folded it canonical-wins, so
  `{top: 1, limit: 3}` answered 1 over HTTP and 3 through a direct engine call.
  All three readers (wire normalizer, RPC schema parse, engine) now resolve the
  pair identically: `top` alone still limits, a conflicting `{top, limit}` is
  refused.

  Behavior change to note: option bags that previously smuggled conflicting
  spellings (`{where: X, filter: Y}`, `{top: 1, limit: 3}`) are now refused
  loudly on every path instead of silently resolving differently per layer.
  Pinned per method, write paths included — a regression here is silent and
  destructive, and the class went unnoticed precisely because `find` was the
  only method anyone thought to check.

- 58a03d2: fix(objectql,spec,metadata-protocol,service-queue): engine option bags are now a closed contract — unknown keys throw instead of silently doing nothing (#4371 option 2)

  The engine declares `Engine*OptionsSchema` but never parses it at runtime, so
  any option key outside the contract — a typo (`orderby`), a retired key
  (`cursor`), a wire-protocol leftover (`object`, `count`), a key that only
  works on other methods (`tenantId` on `count`) — rode along and was silently
  ignored. All six methods now reject non-null unknown keys, naming the legal
  set; retired keys (`cursor`/`distinct`) quote their #4286 tombstone; `null`
  stays a withdrawal.

  Per-method legal keys = the method's schema keys plus the documented extras:
  `searchFields` (now declared on `EngineQueryOptionsSchema` — it was read by
  the engine's `$search` expansion and sent by the protocol layer all along),
  `onFieldsDropped` on `update` (contract-declared write observability), and
  the driver pass-through keys (`transaction`, `tenantId`, `tenantIds`,
  `timezone`, `bypassTenantAudit`, `preserveAudit`) on `find`/`findOne`/
  `update`/`delete` — the methods whose bag actually reaches driver options.
  `count`/`aggregate` never forward their bag, so pass-through keys there are
  rejected rather than accepted-and-ignored. A drift pin holds the sets equal
  to the schemas.

  Also closed in the same sweep:

  - A bag-level `object` key used to OVERRIDE the resolved object on the query
    AST (`{ object, ...query }` spread order), splitting `ast.object` from the
    table actually queried. The AST now keeps the resolved name; a direct call
    passing `object` is rejected, and the protocol layer refuses a POST-body
    `object` that contradicts the route (400 `QUERY_OBJECT_MISMATCH`) instead
    of picking a winner.
  - `findData` no longer leaks protocol-layer vocabulary (`object`, `count`,
    `joins`, `windowFunctions`, `cursor`, `distinct`, non-aggregate `having`)
    onto the engine bag.
  - Nested expand ASTs (`expand: { rel: { sort } }`) reject the four wire-only
    spellings exactly like the top-level bag (#4371 option 1 did the top level).
  - The engine's OData-spelling reads (`$search`/`$searchFields`) are gone —
    the protocol normalizes to the bare keys; a direct call passing them now
    throws instead of half-working on one method.
  - `DbQueueAdapter.purge`/`purgeFailed` passed `{ id }` — a key the engine
    never read, so purge deleted NOTHING (each delete threw into a warn-level
    catch) and purgeFailed always threw. Both now pass `{ where: { id } }`;
    the test fake's `delete` no longer accepts the signature the real engine
    rejects.

  Migration for direct engine callers (wire/HTTP callers are unaffected): pass
  only the keys your method's `Engine*OptionsSchema` declares (plus the extras
  above). Anything else previously did nothing — delete it, or move it to the
  layer that owns it.

- c39d713: fix(objectql): a direct engine call carrying `sort`/`select`/`skip`/`populate` now throws instead of silently dropping the parameter (#4371)

  The engine folds `filter`→`where` and `top`→`limit` itself (#4346); the other
  four pairs in `RPC_QUERY_ALIAS_SLOTS` fold at the RPC/protocol layer only,
  because their value shapes need lowering (`sort`'s `{field: 'asc'}` record
  form, `populate`'s name list) that belongs there. A **direct** `engine.find()`
  / `findOne()` never crosses that layer, so one of those keys used to ride the
  AST verbatim, drivers read only the canonical name, and the request succeeded
  with the parameter discarded — `sort` + `limit` ("the latest N") silently
  returning an arbitrary N. Three shipped instances were fixed in #4370, and a
  fourth sat in the engine's own autonumber seeding (`select` — now `fields`).

  `find`/`findOne` now reject a non-null wire-only spelling with an error naming
  the canonical key and shape, e.g.:

  > `find('task') does not accept 'sort': 'sort' is a wire spelling of
'orderBy', folded by the RPC/protocol layer — a direct engine call bypasses
that fold, so the value would be silently dropped, not applied. Pass
'orderBy' (SortNode[]: [{ field, order: 'asc' | 'desc' }]) instead.`

  Migration for direct engine callers (HTTP/RPC callers are unaffected — the
  wire fold is unchanged): `select: [...]` → `fields: [...]`;
  `sort: {f: 'asc'}` or `sort: [{field, order}]` → `orderBy: [{field, order}]`;
  `skip: n` → `offset: n`; `populate: ['rel']` → `expand: {rel: {object: 'rel'}}`.
  An explicit `null` under a wire spelling remains a withdrawal (ignored), and
  the where-only methods (`update`/`delete`/`count`/`aggregate`) are unchanged —
  their contracts honour no sort/projection/pagination in either spelling
  (unknown-key enforcement there is #4371's follow-up scope).

- 91f4c78: fix(automation,objectql,spec): attribute `runAs:'system'` flow writes to the flow in the audit log (#4366)

  A `runAs:'system'` flow's data writes carried no attribution at all: the run
  context resolved to `{ isSystem: true }` with no `userId` and no service
  principal, so the audit writer recorded `user_id=null, actor=null` and the
  record-history UI rendered every such row as "Unknown user" — business users
  read the flow's own status mirror as data corruption.

  The `svc:*` attribution channel (ADR-0014 D2, `ExecutionContext.actor`) already
  existed for exactly this class of writer; it was simply never wired end-to-end:

  - **service-automation** — `resolveRunContext` now stamps `flowName` alongside
    `runAs`/`flowRunId`, and `resolveRunDataContext` labels a `runAs:'system'`
    run's data context `actor: 'svc:flow:<flowName>'` (fallback
    `svc:flow:automation`). Attribution only — no security middleware keys on it.
  - **objectql** — `buildSession` propagates `ExecutionContext.actor` onto the
    hook session, closing the gap that left the audit writer's
    `userId ?? session.actor` fallback unreachable from the engine path.
  - **spec** — `AutomationContext.flowName` (engine-stamped, provenance) and the
    hook session's optional `actor` field document the contract.

  No behavior change for user-attributed writes: `userId` still wins wherever it
  is present.

- 9881074: fix(batch): the background walks seek instead of counting, so they stop skipping rows (#4363)

  #4363 made a single paged read a partition of its result set. It could not make
  a _walk_ one: seven background scans paged with a growing `offset` while writing
  to the very rows they were reading, and an offset counts into a set those writes
  are changing. Rows slide past the cursor and are never visited.

  That is not a slow page in any of these — it is a wrong answer wearing the shape
  of a clean run:

  - **`rebuildApproverIndex`** built its desired state by walking
    `sys_approval_request WHERE status = 'pending'` with no `orderBy` at all, then
    **deleted** every index row that state did not explain. A skipped request
    meant an approver silently dropped from someone's queue. (The loop beside it
    ordered by `created_at` — not unique, so its pages were never a partition
    either.)
  - **`verifyFileReferences`** decides which files nothing references. A record it
    never visits is reported as an unreferenced file.
  - **`backfillFileReferences`** and the **pinyin companion backfill** rewrite
    each row they read, so their own writes were shifting the set out from under
    the cursor. Records were left unconverted and unsearchable by a run that
    reported success.
  - **`scanValueShapes`** exists to vouch that no stored value is off-shape, and
    it opens a migration gate on that evidence.

  All of them now go through `keysetWalk` (`@objectstack/types`): order by a
  unique key, and seek past the last one instead of counting from the start. A
  row's key does not move when the row is updated, and cannot be shifted when
  another is deleted, so the walk is stable under exactly the mutation these
  functions perform. It is also O(n) rather than O(n²/page) — measured on
  Postgres over 2M rows, deep pages cost ~1.1 s by offset against ~0.09 s by seek.

  One deliberate non-conversion: the REST **export** stream keeps its offset. It
  honors a caller-chosen sort, and a keyset walk would have to re-order the export
  by `id` to seek — changing what the user asked for to fix a cost. Its pages are
  already a partition since #4363; only the depth cost remains.

  `keysetWalk` merges the cursor with `$and` rather than spreading it into the
  caller's filter, so a walk whose own `where` constrains the key column
  (`{ id: { $in: [...] } }`) keeps that constraint instead of having it silently
  overwritten. When a `max` cap is set it reads one row beyond the cap to tell
  "the cap stopped us" from "the source ended exactly there" — without that, a
  walk that read everything still reports `truncated`, and a caller acting on it
  goes looking for rows that were never withheld.

  The storage suites' fake engines now **throw** on an `offset` instead of serving
  one, so the conversion is pinned rather than merely passing.

- 7ce02eb: feat(spec,objectql): `IObjectQLEngine` — the `objectql` slot's contract exists, the class `implements` it, and the seven consumer-local stand-ins are deleted (#4251 B3)

  ObjectQL registers one instance under two names, and the ledger can finally say
  what each name means: `data` stays `IDataEngine` (the data plane), `objectql`
  now resolves to **`IObjectQLEngine`** — the full engine: schema access
  (`getSchema` / `getObject` / `registry`), actions (`registerAction` /
  `removeActionsByPackage` / `executeAction`), the hook/middleware seams
  (`registerHook` / `unregisterHooksByPackage` / `registerFunction` /
  `registerMiddleware` / `bindHooks`), the first-wins default runners and hook
  metrics, boot wiring (`registerDriver` / `setDatasourceMapping` /
  `registerApp`), and the ops probes (`checkDriversHealth` /
  `wasDatastoreCreatedFromEmpty` / `invalidateDataMigrationFlags`). The ledger
  test pins the new relation: `objectql` strictly widens `data`, deliberately no
  longer equal.

  **Why now, and why `implements` is the point.** The honest state for two
  batches was recorded on `DomainHandlerContext.getObjectQL`: ObjectQL is wider
  than `IDataEngine`, the wider part had no contract, and typing it `IDataEngine`
  would be "the more comfortable-looking lie". The interim discipline — each
  consumer declares the narrow slice it uses — produced seven local surfaces
  (`AppEngineSurface`, `EngineRegistrySurface`, `EngineExtensionSurface`,
  `SecurityEngineSurface`, `FreshDatastoreEngine`, the dispatcher's inline
  `checkDriversHealth` slice, the `getObjectQL: any` itself). Each was honest and
  each was an UNCHECKED claim: `getService<Surface>('objectql')` is an assertion,
  so an engine rename would have broken every consumer at runtime with zero
  compile errors. `ObjectQL implements IObjectQLEngine` converts all of them into
  one compiler-verified claim. All seven stand-ins are deleted; consumers import
  the one declaration. `getObjectQL` is typed `Promise<IObjectQLEngine | null>`
  end to end, closing the oldest documented `any` in the dispatcher.

  **Evidence bar unchanged.** Every declared member has a cross-package consumer
  reaching it through the slot; engine members without one (e.g. `triggerHooks`,
  cross-package only in tests) stay off until a caller appears. The registry view
  (`EngineSchemaRegistryView`) declares exactly the eight members consumers use.

  **`_registry` never leaves the engine package now.** plugin-security's
  declared-metadata readers (`readDeclared`, permission-set projection, suggested
  audience bindings) reached ObjectQL's private `_registry` field through `any` —
  the same private reach `/me/apps` had in B2, five more times. All migrated to
  the public `registry` getter the contract declares, test doubles included.

  **`IMetadataService` gains `subscribe?` / `loadMany?`** — implemented by
  `MetadataManager` beside `watch` all along, reached through the slot only via
  `any` by ObjectQLPlugin's metadata bridge (the re-sync keeping runtime-authored
  hooks/actions live). With them declared, the bridge's six `metadata` lookups
  and metadata-protocol's `objectql` lookup carry contract types, and both files
  leave the grandfather list entirely: baseline **167 → 159 sites, 36 → 34
  files**.

- d13004a: feat(core,runtime): plugin ordering is a declared, kernel-enforced contract (ADR-0116, #4131)

  `kernel.use()` registration order was never a contract — the kernel resolves
  init/start order from the plugin dependency graph — but a plugin that needed a
  service at init _when its provider is composed_ while also booting _without_
  the provider had no way to declare that. `AppPlugin` was the standing example:
  it grabs `manifest`/`objectql` synchronously in `init()`, declared nothing
  (a hard dependency would break empty-env / metadata-only / mock-engine
  kernels), and so its correctness rode on which array slot each caller put it
  in. That convention failed the same way twice (`DefaultDatasourcePlugin`'s
  first cut; then #4085, disguised for months as "crashes when the artifact is
  missing").

  The kernel `Plugin` contract gains three additive fields, enforced by both
  `ObjectKernel` and `LiteKernel` through one shared implementation
  (`plugin-order.ts` — the previously duplicated topological sort is unified
  there):

  - **`optionalDependencies: string[]`** — order-if-present: hoisted ahead
    exactly like `dependencies` when composed (real topology edges, including
    cycle detection), silently skipped when absent.
  - **`requiresServices: string[]`** — services resolved synchronously during
    `init()` with no fallback. Validated **before Phase 1**: a required service
    whose only declared provider initializes later fails the boot with an error
    naming both plugins, both slots, and the fix — before any init side
    effects. Re-checked immediately before the plugin's own init, where a still-
    missing service becomes a named composition error exactly where the old
    bare `Service not found` crash fired.
  - **`providesServices: string[]`** — services a plugin's `init()`
    unconditionally registers; powers the validation and the diagnostics.

  Plugins that declare nothing get the diagnosis too: a `getService` miss
  during Phase 1 now appends which plugin was initializing and — when a
  composed plugin declares the service — who provides it and how to declare the
  ordering. The `Service '<name>' not found` prefix and the factory-backed
  `is async - use await` message are unchanged.

  First adopters: `AppPlugin` declares
  `optionalDependencies: ['com.objectstack.engine.objectql']` +
  `requiresServices: ['manifest']` (cleared on the empty-env no-op path), so
  the #4085 composition — AppPlugin registered before the engine — now boots
  correctly in every slot; `ObjectQLPlugin` declares
  `providesServices: ['objectql', 'data', 'manifest', 'lifecycle']` and
  `MetadataPlugin` declares `providesServices: ['metadata']`.

  Everything is additive — plugins that declare nothing keep their exact
  ordering semantics; no existing declaration changes meaning.

- 8675db6: refactor(data)!: a select-list entry is a field name — the nested-select object form is removed (#4196)

  `FieldNode` declared two forms for one entry of `QueryAST['fields']`:

  ```ts
  type FieldNode =
    | string // "name"
    | { field: string; fields?: FieldNode[]; alias?: string }; // nested select
  ```

  The object form was **declared-but-inert**. Nothing produced it, and nothing
  read `.fields` or `.alias` — every consumer on the path treats the list as
  `string[]`: `objectql`'s formula projection and its two known-field filters,
  `driver-sql`'s `select()`, `driver-memory`'s `projectFields`. `driver-mongodb`
  keyed its projection with the entry itself, so an object entry asked for a
  column literally named `"[object Object]"`, and the REST ingress stringified
  each entry before comparing it to the field map, so the same entry came back as
  `400 INVALID_FIELD: Unknown field '[object Object]'` — a rejection naming
  something the caller never wrote. An author who wrote
  `fields: [{ field: 'owner', fields: ['name'] }]` got it accepted by validation
  and then dropped or mangled, depending on the driver (ADR-0078 silently-inert
  declaration; ADR-0049 enforce-or-remove).

  The capability the object form described is already served, by a different key.
  Removing the second spelling rather than lowering it into the first is Prime
  Directive #12: one capability, one contract.

  **FROM → TO**

  | Was                                                               | Now                                                              |
  | :---------------------------------------------------------------- | :--------------------------------------------------------------- |
  | `fields: [{ field: 'owner', fields: ['name'] }]`                  | `expand: { owner: { object: 'user', fields: ['name'] } }`        |
  | `fields: [{ field: 'owner' }]`                                    | `fields: ['owner']`                                              |
  | `fields: [{ field: 'owner', fields: ['name'] }]`, one column only | `fields: ['owner.name']` (dotted path)                           |
  | `fields: [{ field: 'total', alias: 't' }]`                        | `aggregations` / `windowFunctions` — they carry the live `alias` |

  The one-line fix: **a `fields[]` entry is a string.** Move nested selection to
  `expand`, which the engine resolves through batch `$in` queries (default max
  depth 3).

  There is no `os migrate meta` step, and deliberately so: `QueryAST` is a request
  shape, never stored in stack metadata, so the chain has no source to rewrite. It
  is registered as an ADR-0087 D3 **semantic** migration
  (`query-field-node-object-form-retired`) on the protocol-17 step instead — the
  `EnhancedApiError.fieldErrors` / `BatchOptions.validateOnly` precedent. Callers
  move their own select lists, and both channels tell them how:

  - **The parse.** `FieldNodeSchema` narrows to `z.string()` with an error map that
    answers an object entry with the prescription above, not "expected string,
    received object". `z.input` becomes `string`, so `tsc` fails at the authoring
    site first.
  - **The ingress.** `assertProjectionFieldsExist` judges the entry's _shape_
    before consulting the object's field map — it is wrong about the shape, not
    about this object, and a registry-less host would otherwise pass it to a driver
    that cannot read it. The 400 now names the retired form instead of the field
    `"[object Object]"`.

  No runtime behaviour changes for anything that ever worked; the defensive
  unwrapping the drivers had grown against a shape nothing sends goes with it.

- af2a095: fix(data): `searchFields` / `groupBy` / `aggregations` naming a field that does not exist are rejected, not silently degraded (#4254)

  #4226 closed `sort` / `select` / `expand`; with the filter axis (#4134 / #4164 /
  #4181 / #4121) that made four field-naming read axes that either apply or fail.
  The same machine kept leaking on the remaining three, and each failure corrupted
  something the closed axes never touched:

  ```
  search=alpha&searchFields=no_such  -> 200  MORE rows than the narrowing allowed
  groupBy=[no_such]                  -> 200  [{no_such: null, n: <true count>}]  N groups collapsed into 1
  sum(no_such)                       -> 200  0 — indistinguishable from a real zero
  ```

  Each is now refused at the shared normalizer, so `GET /data/:object`,
  `POST /data/:object/query`, the export route and the runtime dispatcher give
  one answer instead of four.

  - **`searchFields` → `400 INVALID_FIELD`.** The `select` failure with the sign
    flipped outward: the engine dropped unknown names and, when that emptied the
    override, fell back to the FULL searchable set — so a parameter that exists
    only to narrow a search widened it, and it changed which ROWS came back, not
    just which columns. Its only in-framework caller is `GET /data/:object/export`
    — the route whose `search` support just shipped so exports would stop
    downloading "the unsearched superset … in a file that looks authoritative";
    a typo'd `searchFields` did exactly that, one parameter over. Three causes,
    three messages, because the fixes differ (the split #4226 drew on expand): a
    name that is no field is a request typo; a REAL field outside the searchable
    set needs the object changed (its message names the declared
    `searchableFields` or the auto-default's type rule, whichever applies); and
    a `searchableFields` entry that names no field is a STALE DECLARATION — a
    bug on the object, called out as such because clients (objectui's list
    search) echo the declaration verbatim. The allowed set is resolved by the
    same `@objectstack/spec/data` function the engine's search expansion
    consumes (`resolveSearchFieldResolution`, moved from objectql), so the gate
    cannot drift from what search actually scans.
  - **`groupBy` → `400 INVALID_FIELD`.** The in-memory aggregation path projects
    an unknown column as `null` for every row, so all rows landed in ONE bucket
    whose count is the true row count — structurally perfect, identical to "this
    column really holds a single value". A chart draws one bar; nothing says the
    grouping never ran. Native SQL aggregation errors on the same input, so which
    backend a deployment sits on decided the answer — the "two routes, opposite
    answers" split, one axis over.
  - **`aggregations` → `400 INVALID_FIELD`.** `sum(<typo>)` folded a column of
    `undefined` to `0` — the exact number an empty quarter produces, in reports
    whose whole job is to be believed (`avg`/`min`/`max` answered `null` the same
    way). `count` with no `field` (or the `'*'` sentinel) is the one legitimate
    field-less form and passes.
  - **Unreadable SHAPES on the aggregation axes → `400 INVALID_QUERY`** — the
    standard-catalog code that had no emitter since it was written, like
    `INVALID_SORT` before #4226. A string `groupBy`, an entry naming no field, a
    function or `dateGranularity` outside the spec enums, a missing `alias`: each
    slipped past the `Array.isArray` routing guard (rows returned UNGROUPED) or
    computed a silent placeholder (`null` results, a column keyed `"undefined"`,
    one bucket per raw value under an unknown granularity).

  Tiering is unchanged from #4226: registry + field map present → authoritative;
  no registry / no field map / legacy array field map → the NAME gates skip (shape
  gates still apply — they need no schema). The engine's own tolerance is
  untouched: internal callers reaching `engine.find()` / `engine.aggregate()`
  directly are unaffected. `@objectstack/rest` also stops logging
  `INVALID_FILTER` / `INVALID_SORT` / `INVALID_QUERY` rejections as
  "[REST] Unhandled error" — they are client mistakes the response already
  explains, as `INVALID_FIELD` always was.

  Requests that name real fields are unaffected.

- bf478e1: fix(data): `sort` / `select` / `expand` naming a field that does not exist are rejected, not silently dropped (#4226)

  The list path has four axes on which a caller names a field. `filter` was
  closed over #4134 / #4164 / #4181 / #4121 — a filter the server cannot apply is
  now a 400, never a 200 over the wrong rows. The other three still leaked, all
  answering `200`:

  ```
  sort=no_such_field   -> 200  CAEBD          byte-identical to "no sort at all"
  select=no_such_field -> 200  <every field>   asked for one column, got all of them
  expand=no_such_rel   -> 200  <no such key>   no relation, no complaint
  ```

  Each is now refused at the shared normalizer, so `GET /data/:object`,
  `GET /data/:object/:id`, `POST /data/:object/query`, the export route and the
  runtime dispatcher give one answer instead of five.

  - **`sort` → `400 INVALID_SORT`.** The row set is unchanged, so this is not
    #4181's "returned everything" — it is worse in one specific way: `sort` +
    `top` is how a caller asks for "the latest N", and a dropped sort makes that
    an arbitrary N that nothing in the response reveals. This is the list half of
    the bug #4181 fixed on the export route's `orderby`. `INVALID_SORT` had sat
    in the standard catalog since it was written with no emitter.
  - **`select` → `400 INVALID_FIELD`.** `engine.find()` drops unknown columns
    (deliberate `SELECT *` tolerance) and then falls back to `*` when that empties
    the projection, and the two compose into `?select=<typo>` asking for ONE
    column and receiving EVERY column — a parameter whose purpose is to return
    less, failing by returning more, against both FLS and data minimisation. The
    partially-unknown case (`?select=title,no_such`) is refused on the same terms:
    half a projection is not the one that was asked for, and the tolerant reading
    would have to explain why `?status=<typo>` is a 400 and `?select=<typo>` is
    not, on one endpoint, about one field map.
  - **`expand` → `400 INVALID_FIELD`.** The lightest of the three — same rows,
    same columns, the relation simply is not there — but the response cannot be
    told apart from "every foreign key is null", and the client renders raw ids
    where names belong. A name that is no field at all and a name that is a field
    holding no reference (`?expand=title`) get different messages, since the fixes
    differ.

  **Sorts that were silently never applied now are.** Two wire spellings reached
  the normalizer and fell through it untouched, and every driver then declined
  them (`SqlDriver` guards its ORDER BY with `Array.isArray(orderBy)`): the
  client SDK's own declared `orderBy: string[]`, and the `{field: direction}` map
  that `GET /data/:object/export`, `GET /data/import/jobs` and objectui's calendar
  all emit. Both are now folded to `SortNode[]` — so the import-job history, which
  has asked for `created_at desc` since it was written and served insertion order,
  sorts. A sort shape that still cannot be read (a number, an entry naming no
  field, a direction that is neither `asc` nor `desc`) is `400 INVALID_SORT`
  rather than a silent no-op.

  **`$expand` of a `tree` field works.** `REFERENCE_VALUE_TYPES` lists `tree`
  among the types whose value "points at another record … the related record
  object in expanded form", and objectui requests it, but
  `engine.expandRelatedRecords` tested membership with a hand-copied `!==` chain
  that omitted it — so a hierarchy field came back as a raw parent id. The loop
  now reads the shared spec set, which is also what the new expand gate validates
  against, so the gate cannot admit a field the engine then skips.

  **What changes for callers:** requests naming a non-existent field in `sort`,
  `select` or `expand` now fail loudly instead of receiving an unsorted, widened
  or unexpanded response. Every axis naming real fields is unaffected. The
  engine's own tolerance is untouched — it guards internal callers (hooks, flows,
  expand sub-reads, registry-less hosts) that never pass through this ingress,
  the same tiering the object-existence and unknown-field gates already use.

- 5d21a48: feat(spec,metadata-protocol,metadata,objectql,service-automation): stored metadata replays the full conversion chain at rehydration (#3903)

  Every mechanism the platform has for evolving the metadata contract — schema
  transforms, the ADR-0087 D2 conversion layer, the D3 migration chain, the
  protocol-17 tombstones — operated on **authored source** only. Metadata **at
  rest** (`sys_metadata` rows written by Studio or the runtime authoring APIs)
  was rehydrated unparsed and unconverted, so the authored and stored contracts
  silently diverged: a pre-17 row carrying `conditionalRequired` or `execute`
  read as whatever each ad-hoc consumer happened to do with it.

  **New spec primitive — `applyConversionsToStoredItem(type, item, options?)`**
  (exported from the package root). Wraps one stored item of a given metadata
  type and replays the **full** conversion chain over it — `retiredFromLoadPath`
  entries included, because retirement is an _authoring-surface_ event: the
  window exists to teach a live author, and a row at rest has no author to
  teach. Idempotent, never throws, never validates.

  Wired at every stored-row rehydration seam:

  - `metadata-protocol`: `loadMetaFromDb`, `getMetaItems` (active + draft
    preview), `getMetaItem` (active + draft), `getMetaItemLayered`, and
    `duplicatePackage` (a copy re-saves through the schema gate, so legacy
    sources now duplicate successfully — and the copy is canonical).
  - `metadata`: the DatabaseLoader's live-row reads (`load` / `loadMany`).
    History reads stay verbatim — history records what was written.
  - `objectql`: the authored-action / authored-hook direct table reads, so
    runtime-authored actions stored with the removed `execute` alias dispatch
    via `target` again.
  - `service-automation`: `AutomationEngine.registerFlow` now passes
    `includeRetired` — stored flows keep canonicalizing after their conversions
    graduate out of the load window. (The generic metadata seams deliberately
    skip `type: 'flow'`: flow conversions carry the open-namespace conflict
    guard, which needs this engine's live executor registry.)

  **Boot hydration diagnoses instead of shrugging.** `loadMetaFromDb` now
  returns `{ loaded, errors, invalid }`: each row is validated against its
  type's spec schema _after_ conversion, and a genuine contract violation is
  counted and warned with a stable `[metadata_spec_invalid]` marker — but still
  registered, deliberately: refusing at boot would unhook live tables and make
  the row unlistable and unfixable in Studio. The write path (`saveMetaItem` → 422) and the read-side `_diagnostics` envelope remain the enforcing gates; the
  `SchemaRegistry.registerItem` validation hook is now documented as exactly
  that diagnostic.

  **Retired accommodation.** With the chain running on every stored read path,
  the rule-validator's `requiredWhen ?? conditionalRequired` fallback — kept in
  #3883 with a retirement promise that had no mechanism — is deleted. If you
  call `evaluateValidationRules` directly with raw legacy field definitions,
  convert them first (`applyConversionsToStoredItem('object', def)`) or author
  `requiredWhen`; the platform's own read paths already hand you canonical
  shapes.

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
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [f4d7f1d]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [0373d52]
- Updated dependencies [4f30943]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [bb192c4]
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
- Updated dependencies [a4a9944]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [45dc446]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [39eb01b]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [cc2de0e]
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
- Updated dependencies [4475c59]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [f5fe061]
- Updated dependencies [6c87cc9]
- Updated dependencies [af2a095]
- Updated dependencies [bf478e1]
- Updated dependencies [dd5daac]
- Updated dependencies [ec796d5]
- Updated dependencies [77fadbf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [8d5bb5a]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [d5749d7]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [a62bd9e]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [3245174]
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
- Updated dependencies [4965bfa]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/metadata-protocol@17.0.0-rc.1
  - @objectstack/metadata-core@17.0.0-rc.1
  - @objectstack/formula@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- 6169615: feat(objectql)!: media value shapes enforce once THIS deployment has verified its file migration (#3438 D1 media half, gated by #3617)

  A `file` / `image` / `avatar` / `video` / `audio` value that does not match the
  stored contract (an opaque `sys_file` id) now **rejects with `invalid_type`**
  instead of warning — but only on a deployment that has run
  `os migrate files-to-references --apply` and passed its self-check.

  **Why this is not a version-wide flip.** The legacy media values this rejects —
  inline `{url, name, …}` blobs, bare URLs — are exactly what that migration
  converts. A deployment that has run it has been _shown_ to hold none; a
  deployment that has not would have every media-field update start failing the
  moment it upgraded. So the enforcement follows the evidence, per deployment,
  rather than the release. Nothing changes for a deployment until it migrates.

  **Upgrading:**

  ```bash
  os migrate files-to-references          # dry run: reports what would convert
  os migrate files-to-references --apply  # convert, verify, record the flag
  ```

  If a write starts failing after you migrate, the value genuinely does not match
  the contract — the error names the field. `OS_ALLOW_LAX_MEDIA_VALUES=1` re-opens
  media leniency while you diagnose.

  **Scope — deliberately only media.** `OS_DATA_VALUE_SHAPE_STRICT_ENABLED` is
  unchanged and still opts every class into strict (and still forces media strict
  on a deployment that has not migrated). Reference types (`lookup`, `user`, …)
  and structured JSON (`location`, `address`, `repeater`, …) stay warn-first: the
  file migration is evidence about file values and says nothing about whether a
  `location` is well formed, so gating them on its flag would be borrowing
  evidence for a fact it does not cover. They flip when something can vouch for
  them — see #3438.

  **Cost.** Dormant unless the written object declares a media field, and the
  flag read is memoized, so this is one query per process for apps that store
  files and zero for those that do not. A running server picks up a
  newly-recorded migration on restart, or via `engine.invalidateDataMigrationFlags()`.

- fa3d0cf: feat(spec): field runtime value-shape contract — ADR-0104 phase 1 (D1)

  `@objectstack/spec/data` now owns the runtime VALUE shape of every field type
  (`field-value.zod.ts`): semantic type classes (`STRING_VALUE_TYPES`,
  `NUMERIC_VALUE_TYPES`, `REFERENCE_VALUE_TYPES`, `FILE_REFERENCE_TYPES`,
  `STRUCTURED_JSON_TYPES`, `MULTI_CAPABLE_TYPES`, …), the shared
  `isMultiValueField`, and `valueSchemaFor(field, 'stored' | 'expanded')`. The
  four consumers that each hand-copied this knowledge (objectql record-validator,
  rest import-coerce, driver-sql column classification, qa conformance) now
  derive from the spec, and the field-zoo round-trip MATRIX is asserted against
  the contract so the two cannot drift.

  **Write-path change (objectql, warn-first):** previously-unvalidated types —
  single `lookup`/`master_detail`/`user`/`tree`, `file`/`image`/`avatar`/
  `video`/`audio`, `location`, `address`, `composite`, `repeater`, `record`,
  `vector` — are now checked against the contract. A violation **logs a warning
  and passes** in this release (legacy rows must not strand their records);
  set `OS_DATA_VALUE_SHAPE_STRICT_ENABLED=1` to enforce as a
  `400 VALIDATION_FAILED`. The flip to strict-by-default rides a later minor
  (ADR-0104 R1/R2).

  **Deprecations (removal rides the next spec major), FROM → TO:**

  - `CurrencyValueSchema` (`{value, currency}`) → none. A `currency` field's
    value is a **bare number** everywhere in the runtime (validator, SQL `float`
    column, import coercion, field-zoo oracle); the currency code lives in field
    config. Use `valueSchemaFor({type: 'currency'})`.
  - `LocationCoordinatesSchema` (`{latitude, longitude}`) → `LocationValueSchema`
    (`{lat, lng}`) — the shape the platform actually stores.
  - `AddressSchema` is **adopted** (unchanged) as the enforced `address` value
    contract via `AddressValueSchema`.

  No stored data changes shape; the contract codifies deployed reality
  ("reality wins", ADR-0104 D1).

- a749273: feat(objectql): resolve file-field id references on read — ADR-0104 D3 wave 2 (PR-2)

  The engine read path now resolves a `file`/`image`/`avatar`/`video`/`audio`
  value stored as an opaque `sys_file` id string into its expanded
  `FileValueSchema` form — `{ id, name, size, mimeType, url }`, with `url` derived
  from the stable `/api/v1/storage/files/:fileId` resolver (never stored). One
  batched `sys_file` `id $in […]` read per query (no N+1), mirroring the
  lookup-`$expand` batch pattern.

  **Dual-mode safe.** An inline-blob value (an object) passes through unchanged,
  and only an **opaque id token** (uuid/nanoid-shaped) is treated as a reference —
  a URL-shaped value (`https://…`, `/api/…`, `data:…`, `blob:…`), which a file
  field legitimately holds in the legacy world, is never looked up. The step
  fires zero reads unless a file field actually holds an id token (the blob/URL
  case is free), and it no-ops entirely when `sys_file` is not registered.

  This makes a stored `fileId` (surfaced by PR-1) actually usable on read, ahead
  of the v17 cutover that narrows the stored form to an id.

- fdb4f50: feat(migrate): `os migrate files-to-references` — a data migration with a self-check, gated per deployment (#3617)

  The ADR-0104 file-as-reference migration ships as a command a deployment runs
  against its own database, and the deployment-level flag it records is what may
  later authorise irreversible behaviour — never the platform version.

  ```bash
  os migrate files-to-references           # dry run: reports, writes nothing
  os migrate files-to-references --apply   # converts, verifies, records the flag
  ```

  The run backfills legacy file-field values (inline metadata blobs, own-resolver
  URLs, `data:` URIs) into owned `sys_file` references, reconciles the ownership
  ledger against what records actually hold, and — only on an `--apply` run whose
  reconciliation reports **zero blocking discrepancies** — records
  `sys_migration { id: 'adr-0104-file-references', verified_at, blocking: 0 }`.

  **Why a flag rather than a release note.** ObjectStack is a development
  platform: third-party deployments upgrade on their own schedule and their data
  is not observable by anyone else, so no release-side soak can vouch for them.
  The evidence has to be produced where the data is. Consequences:

  - Installing a new version never starts deleting bytes. Running the migration
    and passing its self-check is the consent.
  - Not run, or not passed → files are retained forever. Wasted storage, zero
    data loss.
  - A later failing run **clears** `verified_at`: a deployment whose data has
    drifted closes its own gate.
  - A dry run writes nothing at all — not the conversions, and not the flag,
    even when the self-check would pass.
  - External URLs stay advisory. They are not `sys_file`s, so they can never
    enter collection; whether to remodel them as a `url` field is the app
    author's decision (ADR-0104 R7), not a gate.

  Ships alongside:

  - `@objectstack/spec` — `DataMigrationFlagSchema`, `FILE_REFERENCES_MIGRATION_ID`,
    and the single `isDataMigrationFlagVerified` predicate both future consumers
    (collection #3459, strict value-shape #3438) read, so the two gates cannot
    disagree about the same fact.
  - `@objectstack/platform-objects` — the `sys_migration` object plus
    `readDataMigrationFlag` / `isDataMigrationVerified` / `recordDataMigrationRun`.
    Reads fail toward "not verified": a gate that cannot read its evidence stays
    closed.
  - `@objectstack/objectql` — a read may now opt out of file-reference expansion
    via the spec's `RAW_FILE_VALUES_CONTEXT_KEY`, and the storage service's
    bookkeeping/scan reads do. Without it the read resolver rewrites stored ids to
    their expanded form before the reconciliation sees them, which reports held
    references as absent — noisy `stale_owner` findings, and a missed
    `unowned_reference` would have been a false pass of the collection gate.

- 48c110e: feat(datasource): a datasource that is down is visible, and says why when queried (#3827, #3828)

  #3816 made an explicitly-bound datasource that cannot connect refuse the boot. Two
  gaps survived that fix, both in the cases that still boot — a policy denial, an
  `autoConnect` datasource, or any failure the operator waved through with
  `OS_ALLOW_DRIVER_CONNECT_FAILURE`:

  - **It was invisible.** `DatasourceSummary.status` was the literal `'unvalidated'`
    for every row — the contract declared three states and the implementation only
    ever emitted one — so a dead datasource looked exactly like a healthy-untested
    one. `checkDriversHealth()` could not help either: it iterates registered
    drivers, and a datasource that never connected was never registered, so it is
    _absent_ from the probe rather than unhealthy. The only trace was a warning
    that scrolled past at boot, which made the diagnostic procedure "restart the
    server and re-read the logs".
  - **The query-time error said nothing.** `getDriver()` answered four different
    situations with one sentence, `Datasource 'x' is not registered.`: refused by
    policy, failed to connect under the escape hatch, a misspelled name, and
    `active: false`. Only the third is an authoring bug, so the other three sent
    the reader hunting for a typo that does not exist.

  Both come from the same root: `connect()` already produced a `ConnectResult` for
  every attempt and every caller threw it away.

  - **`DatasourceConnectionService` retains the last verdict per datasource**, with a
    coarse `availability` (`available` / `blocked` / `failed` / `unattempted`) beside
    the raw status. New `getConnectionState(name)` / `listConnectionStates()`.
    `disconnect()` drops it, so a removed pool stops explaining itself.
  - **`DatasourceSummary.status` tells the truth**: `ok` | `error` | `blocked` |
    `unvalidated`, with a new operator-facing `statusReason`. `blocked` is new and
    deliberate — a policy denial is a decision, not a fault, and will not clear on
    its own. Reported in **Setup → Datasources**, `GET /api/v1/datasources`, and the
    summary returned from create/update, so a "Save" whose pool failed to open is no
    longer presented as success.
  - **`ERR_DATASOURCE_UNAVAILABLE` (HTTP 503)**: new `DatasourceUnavailableError`
    from `@objectstack/objectql`, thrown by `getDriver()` when the connection layer
    recorded _why_ a declared datasource has no driver. An undeclared name keeps the
    original message — there is genuinely nothing to add. 503 rather than 500/400:
    nothing about the request is wrong, and the state may clear.
  - **A privileged/public split for the reason.** The error **never** carries the
    underlying cause — connect failures routinely contain hosts, ports and DSNs, and
    a policy's `reason` is written for operators. Those stay in the logs and the
    (admin-gated) datasource list. `DatasourceConnectDecision` gains an opt-in
    `publicReason` for hosts that want to tell tenants something specific
    (e.g. `'External datasources require the Scale plan.'`); it is the only string
    that reaches an end user.
  - **Readiness is deliberately not gated on this.** `/ready` still reflects
    registered-driver health only: an optional datasource being down must not pull an
    otherwise-working replica out of the load balancer.

  Also lands a drift guard for **#3826**, and corrects ADR-0062's status while doing
  it. The ADR claimed D1 ("exactly one definition → live driver path") as
  implemented; only the _construction_ half converged. The `default` driver is still
  registered as a `driver.*` kernel service and connected by `ObjectQLEngine.init()`,
  with its own failure verdict, pool teardown, and no connect policy. What blocks the
  merge is an input-shape mismatch, not ordering: `connect()` takes a datasource
  _definition_ and builds the driver, while `default` arrives pre-built, and routing
  it through the service would make `ObjectQLPlugin`'s boot depend on an optional
  higher-layer service. Until that is designed, `degraded-boot-parity.test.ts` pins
  both paths to the same operator-visible contract (fail-fast by default, identical
  `OS_ALLOW_DRIVER_CONNECT_FAILURE` parsing, `DEGRADED BOOT` on stderr) so a change
  to one that forgets the other fails CI — #3741 → #3758 was exactly that miss, and
  it cost three months and a second bug report.

  **Migration.** Additive. `DatasourceSummary.status` gains a `'blocked'` member: a
  consumer exhaustively switching on it needs a case (the admin UI shows it as a
  distinct state). Nothing that was `'ok'` or `'error'` changes meaning; rows that
  were reported `'unvalidated'` now report their real state. Query-time errors for a
  datasource the connection layer recorded change from a generic `Error` to
  `DatasourceUnavailableError` (503 instead of the previous catch-all status);
  matching on the old `is not registered` text still works for the undeclared-name
  case, which is the only one that was ever accurate.

- a227ed7: fix(objectql)!: one key for the empty group bucket — real `null`, on both aggregation paths (#3839)

  A grouped row whose dimension value is empty now carries `null` for that
  dimension no matter which way the aggregate ran. Downstream code can test the
  empty bucket with a plain `value == null` again: charts render their own empty
  label, drill-through on that bucket builds `field = null` and returns the rows
  it should, and a dashboard no longer changes shape when the driver, the
  granularity or the reference timezone changes.

  ### What was wrong

  `engine.aggregate` has two implementations of one feature. It pushes the
  aggregate down as SQL when the driver advertises every requested granularity and
  the reference timezone is UTC; otherwise it fetches rows and buckets them in JS.
  The two disagreed about how to spell "empty":

  ```
  --- same dataset, same query, one row with a NULL value ---
    pushed-down SQL : [{ "key": null,     "type": "null",   "total": 2 }, …]
    in-memory       : [{ "key": "(null)", "type": "string", "total": 2 }, …]
  ```

  The measures were always right — only the key's type and literal differed —
  which is why this went unnoticed for so long: every total reconciled. But the
  engine picks a path per query, so the same data produced a different bucket key
  on SQLite-plus-UTC-plus-`month` than on `week` (which SQLite does not advertise),
  a non-UTC timezone, or `driver-rest` / `driver-memory` / a remote Turso, all of
  which bucket in memory unconditionally.

  It was never date-specific either. A plain `groupBy: ['stage']` over a NULL
  column diverged the same way.

  Consumers are written against `null` — they check `== null` and supply their own
  empty label ('—', '(empty)', a localized "Uncategorized"). The sentinel defeated
  every one of them: it rendered a raw English debug string in the UI, and a drill
  on the empty bucket compiled to `field = '(null)'` and matched nothing.

  The in-memory path's comment justified the string as staying "consistent with
  the client `useReportData` hook". That hook was removed with ADR-0021, and the
  literal never appeared in it.

  ### What changed

  - `applyInMemoryAggregation` and `bucketDateValue` (`@objectstack/objectql`) key
    the empty bucket as `null`. `bucketDateValue` now returns `string | null`. A
    null instant and an unparseable one still share one bucket, because SQL cannot
    tell them apart either (`strftime('%Y-%m', 'not-a-date')` is NULL).
  - The internal composite bucket id is JSON-encoded, so the empty bucket stays
    distinct from a row whose value is the literal string `"null"`.
  - `bucketKeyToCalendarRange` (`@objectstack/core`) accepts `string | null`. The
    empty bucket has no calendar span, so a drill on it opens the unscoped
    superset instead of an invented bound — unchanged behavior, honest signature.
  - The driver output contract in `@objectstack/spec` now states the rule: a row
    with no value keys as `null`, never a sentinel. Propagating NULL through the
    bucket expression is the whole of it; a driver only breaks it by adding a
    `COALESCE`.

  ### Gates

  `checkDateBucketParity` (`@objectstack/verify`) deliberately carried no null
  instant, because the divergence would have failed it for a reason it was not
  about. Its fixture now has one, so the convergence is held in place — including
  for out-of-tree drivers that run the check against themselves.

  Two fixes were needed to make that fixture meaningful:

  - The check folded bucket labels through `String(value)`, which turns SQL NULL
    into `'null'` — a label a TEXT column can genuinely hold. A driver spelling
    "empty" as a string could compare equal to one returning real NULL. The empty
    bucket is now keyed out of band.
  - Label sets were compared with `JSON.stringify`, which is sensitive to key
    insertion order. Row order is not part of this contract and the two paths
    naturally differ (SQL sorts its groups; the in-memory path emits first-seen
    order), so a driver with entirely correct buckets could be reported as
    disagreeing — with an empty diff message, since nothing actually differed.
    The comparison is now order-insensitive.

  A new dogfood check covers the non-date half against real drivers: same dataset,
  plain and date-bucketed `groupBy`, both paths, one key.

- 763931e: feat(filters): evaluate `{filter-token}` placeholders server-side (#3582)

  Filter values travel as JSON, so a time- or user-scoped slice writes a
  placeholder instead of code:

  ```ts
  filter: { close_date: { $gte: '{current_year_start}' }, owner: '{current_user_id}' }
  ```

  The vocabulary has been in `@objectstack/spec` for a while (`date-macros.zod.ts`,
  `context-tokens.zod.ts`) and `objectstack build` rejects tokens outside it
  (#3574). What was missing is the half that _substitutes a value_: **nothing on
  the server ever did**. A placeholder reached the driver as the literal string
  `'{current_year_start}'`, compared as text, and matched nothing.

  That failure is invisible — an empty widget looks exactly like a metric that is
  legitimately zero — so apps worked around it by computing dates at module load,
  which freezes "this year" into the built artifact and quietly goes stale.

  **New: `resolveFilterTokens()` in `@objectstack/core`**, wired into the two
  server-side seams every filter passes through:

  - **ObjectQL read path** — `find` / `findOne` / `count` / `aggregate`, so REST
    queries, related lists, saved-view filters and flow `find_records` all resolve.
    It runs before the middleware chain, so only author-supplied filters are
    inspected; RLS/sharing filters are injected downstream from concrete values.
  - **Analytics dataset executor** — a dataset's intrinsic `filter`, a widget's
    `runtimeFilter`, measure-scoped filters, and time-dimension `dateRange`s.
    This path needs its own call: `NativeSQLStrategy` compiles raw SQL and binds
    comparands directly, so a dashboard widget never passes through `engine.find()`.

  Behavioural notes:

  - Date tokens resolve to ISO strings (`YYYY-MM-DD`, or a full timestamp for
    `{now}` / `{N_hours_ago}` / `{N_minutes_ago}`). Turning that into a column's
    on-disk form stays the driver's job (`SqlDriver.temporalFilterValue`), so
    there is still exactly one source of truth for the storage convention.
  - Calendar boundaries follow `ExecutionContext.timezone`; one instant is pinned
    per filter tree, so a `>= {current_month_start}` / `< {next_month_start}` pair
    can never straddle a boundary.
  - `{current_org_id}` reads `ExecutionContext.tenantId`; `{current_user_id}` reads
    `userId`. A request carrying neither now **throws** instead of resolving to
    `null` — a null comparand degrades to `IS NULL` on most drivers and would hand
    back the rows the filter was written to exclude.
  - An unrecognised placeholder **throws**, carrying the near-miss fix
    (`{current_user}` → `{current_user_id}`, `{this_quarter_start}` →
    `{current_quarter_start}`). This matches what `objectstack build` already
    enforces. Consequence, previously implicit and now load-bearing: a filter value
    that is _entirely_ `{...}` is always read as a placeholder, so a literal value
    of that shape is not expressible — rename the value.

  Also in this change: `notify` no longer sends the six-character string
  `"undefined"` as an audience member. `to: ['{record.owner.manager}']` walks
  `.manager` on a scalar foreign-key id, resolves to nothing, and `String(undefined)`
  turned that into a phantom recipient — the emit "succeeded", addressed nobody,
  and said nothing. Unresolved recipients are now dropped, and a node with no
  recipient left fails naming the offending template and pointing at the start
  node's `config.expand` (#3475), which does hydrate the relation.

- de9af8a: fix(automation,objectql): a filter that loses a condition must not run (#3810)

  Three related holes, all of which end in "the query matched rows the author
  excluded".

  **1. A flow filter could silently widen to match everything.**

  The flow template interpolator expresses "this token did not resolve" as
  `undefined`. In a message that renders as empty text — harmless. In a FILTER it
  removes the condition, and a removed condition matches MORE rows. When it was
  the only condition, `{ owner: '{record.ownr}' }` became `{}`, and `{}` handed to
  `deleteMany` is every row in the table.

  So one mistyped field name in a `delete_record` node silently emptied the
  object. Reproduced with all four causes: a typo (`{record.ownr}`), an input the
  run never received, a lookup hop (`{record.account.name}` — the trigger record
  carries a scalar id), and a filter placeholder.

  `get_record` / `update_record` / `delete_record` now refuse to execute when
  interpolation erased any authored condition, naming the offending template. The
  guard keys on LOSS, not emptiness: an author who deliberately wrote no filter is
  unaffected, and losing one of two conditions still fails, because widening from
  "my open records" to "all open records" is the same class of bug.

  **2. Filter placeholders never reached the engine that resolves them.**

  `config.filter` is where two `{…}` dialects meet — the flow template dialect
  (`{record.owner}`) and the filter placeholder dialect (`{current_year_start}`,
  `{current_user_id}`, resolved by `resolveFilterTokens()`). Evaluation order
  picked the winner by accident: the flow interpolator ran first, found no flow
  variable by that name, and erased it.

  `interpolateFilter()` hands that position back to the dialect that owns it — a
  whole-string token that no flow variable resolves and that IS a recognised
  placeholder passes through verbatim for the engine to expand. Flow variables
  keep precedence, so a template that works today cannot change meaning.

  **3. The engine resolved placeholders on reads but not on writes.**

  `resolveFilterTokens()` reached `find`/`findOne`/`count`/`aggregate` only. So
  the SAME filter selected different rows depending on the verb: `find({ owner:
'{current_user_id}' })` matched the signed-in user's rows, while
  `update`/`delete` compared the literal token text and matched none — a flow that
  previewed with one and acted with the other operated on two different row sets.
  This is the #3106 shape one layer down: the evaluator existed, only some call
  sites reached it.

  `update` and `delete` now resolve too, BEFORE the by-id fast path claims a
  scalar `where.id` (otherwise an unresolved `{current_user_id}` would be bound as
  the primary key itself). Caller options are never mutated.

- 5d4de37: fix(objectql,driver-sql)!: a group key is the column's value, in the shape `find()` presents it (#3849)

  `groupBy: ['qty']` now returns `3`, not `'3'`. `groupBy: ['won']` returns `true` /
  `false`, not `'true'` / `'false'` on one path and `1` / `0` on the other. A bucket
  key is a column value, so there is one right answer for what it looks like —
  whatever that column looks like on a `find()` row — and all three paths that
  produce one now give it.

  ### What was wrong

  Three code paths produce a group key, and no two of them agreed:

  |                           | `qty` (number)   | `won` (boolean)                 |
  | ------------------------- | ---------------- | ------------------------------- |
  | `find()`                  | `3` number       | `true` boolean                  |
  | `aggregate()` pushed down | `3` number       | `0` / `1` **number**            |
  | in-memory fallback        | `'3'` **string** | `'false'` / `'true'` **string** |

  Two independent causes:

  - `applyInMemoryAggregation` ran every key through `String()`. The pushed-down
    path never did.
  - The pushed-down path returns raw builder output. #3797 taught it to present
    temporal columns the way `formatOutput` does on a `find()` row, but not the
    boolean and numeric repairs — so a SQLite boolean, which has no native type and
    is stored as `0`/`1`, surfaced as an integer from `aggregate()` and as a real
    boolean from `find()`.

  `engine.aggregate` chooses between the two aggregate paths per query — by whether
  the driver aggregates natively, whether it advertises the requested granularity,
  and whether the reference timezone is UTC — so the same column changed shape with
  no change to the data or the query.

  ### Why it mattered

  The measures were always right, which is why this went unnoticed. What broke was
  downstream code that probes a raw `Map` keyed by the value's own type. `Map`
  lookup is SameValueZero, so `'1'` never finds `1`:

  - **Select-option labels** (`dimension-labels.ts`) — the label table is keyed by
    the option's own `value`. A numeric option value never matched a stringified
    key, so the chart rendered the raw stored value instead of its label.
  - **Lookup / master-detail labels** — the id → record-name table is built by an
    inner query that always pushes down (raw ids), then probed with the outer
    query's keys, which may be in-memory (stringified). With a numeric primary key
    — routine for external/federated objects — every label missed.
  - **Cross-object rebucketing** (`cross-object-rebucket.ts`) — the FK → attribute
    map is built and probed the same way, and a miss is not a fallback but
    `RESTRICTED_BUCKET`. A numeric FK filed **every row** under `'(restricted)'`:
    one bar, correct grand total, no error.
  - **Drill-through** — the raw dimension value goes into the drill filter
    verbatim, so a boolean dimension drilled from the in-memory path sent
    `{ won: 'true' }` to SQLite, whose INTEGER column cannot equal the text
    `'true'`. Zero rows.

  ### What changed

  - `applyInMemoryAggregation` (`@objectstack/objectql`) emits the value verbatim.
    Its rows come straight from `driver.find()`, so passing the value through is
    what makes the key equal the column's own read shape.
  - The internal composite bucket id is now type-preserving, so `1` and `'1'`,
    `true` and `'true'` stay distinct groups rather than merging on the way in.
    BigInt is encoded explicitly — `JSON.stringify` throws on it, and a value that
    used to bucket under `String()` must not start crashing the aggregate.
  - `SqlDriver.aggregate` / `.distinct` (`@objectstack/driver-sql`) present group
    keys and `min`/`max` results with the same rules `formatOutput` applies on a
    `find()` row, generalizing the #3797 temporal fix to boolean and numeric
    columns. The `protected` helpers behind it are renamed accordingly
    (`temporalFieldKind` → `readPresentationKind`, `presentTemporalValue` →
    `presentReadValue`, `presentTemporalColumns` → `presentReadColumns`) and the
    kind union is exported as `ReadPresentationKind`.

  Date-bucketed `groupBy` items are unaffected: `bucketDateValue` and the dialect
  bucket expressions both produce canonical string labels, and #3839 already pinned
  their empty bucket.

  ### Gate

  `packages/qa/dogfood/test/group-key-read-shape-parity.test.ts` measures both
  aggregate paths against `find()` for a number, boolean and text column, on
  `driver-sql` and `driver-sqlite-wasm`. It asserts the runtime TYPE, not just the
  value — folding both sides through `String()` is the reflex that hid this in the
  first place and would make the check pass against the bug it exists to catch.

  Each half was confirmed to fail the gate on its own: reverting only the
  in-memory change reddens the number and boolean cases, reverting only the driver
  change reddens the boolean cases with `0<number>` against `false<boolean>`.

- 030125b: feat(objectql)!: `init()` refuses to boot when a data driver fails to connect (#3741)

  `ObjectQLEngine.init()` wrapped every driver's `connect()` in a try/catch, logged
  one error line, and carried on. A server whose database was unreachable therefore
  "started successfully" — health endpoints could even stay green — and then failed
  every request with an error that reads nothing like _the database is down_. The
  warning it printed (`Operations may recover via lazy reconnection or fail at query
time`) was half fiction: grep the repo and no reconnection exists in `driver-sql`
  or `driver-mongodb`, so only the "fail at query time" half was ever real. The
  caller made it worse — `ObjectQLPlugin.start()` runs `syncRegisteredSchemas()`
  immediately after `init()`, issuing DDL against a driver that isn't there.

  The structural half of the bug was worse than the operational one: the catch
  removed a driver's ability to **refuse startup at all**. Any fatal startup check —
  licence, server version, incompatible configuration, missing capability, not just
  an unreachable socket — is expressed by throwing from `connect()`, and every one
  of them was silently downgraded to a runtime error. That is why driver-mongodb's
  multi-tenancy guard (#3724 / #3734) had to be hoisted into its constructor.

  - `init()` now **throws** `DriverConnectError` (`code: 'ERR_DRIVER_CONNECT'`)
    when any boot-registered driver's `connect()` rejects, aborting kernel
    bootstrap. It still attempts every driver first, so one failed boot names all
    of them. The message is self-contained — each failed driver and its cause —
    because the CLI prints `error.message` alone; the first cause is also attached
    as `error.cause`. Exported from both `@objectstack/objectql` and
    `@objectstack/objectql/core`.
  - `connect()` is now a supported place for a driver to veto boot. Startup
    validation that needs a live connection (server version, capability probes)
    no longer has to be forced into a constructor.
  - The misleading "lazy reconnection" warning is gone.
  - New escape hatch `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`
    (`resolveAllowDriverConnectFailure()` in `@objectstack/types`) restores the old
    lenient boot, but loudly: a `DEGRADED BOOT` banner names the failed drivers and
    states that they are never retried or reconnected and that every query and
    schema sync routed to them will fail for the process lifetime. The banner goes
    to stderr as well as the logger, because `os serve` swallows all of stdout
    during boot and `Logger` routes `warn` there — logger-only, the one message
    that matters would be invisible in exactly the deployment the flag is for.
    Defaults off.

  **Migration.** No code or config change is needed for a correctly configured
  deployment — a driver that connected before still connects. A deployment that was
  _silently_ booting without its database now fails the boot instead, with the
  driver name and cause in the error; fix the datasource configuration (typically
  `OS_DATABASE_URL`, credentials, or network reachability). To keep booting without
  it — deliberately, and knowing every request that touches it will fail — set
  `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`.

- 8e08bc3: feat(runtime): `/ready` reports 503 when a data driver stops answering (#3756)

  `/health` returned `{status: 'ok'}` unconditionally and `/ready` only checked
  whether the kernel state was `running` — a flag set once when bootstrap finishes
  and never revisited. Neither probe touched the data layer. So a database that
  went away _after_ boot (restart, failover, network policy change, pool exhausted,
  credentials rotated) left both probes green: the load balancer kept routing to a
  replica that failed 100% of its requests, and the orchestrator saw nothing wrong.
  The driver's `checkHealth()` already existed and was cheap (`SELECT 1` /
  `db.command({ping:1})`) but was only consumed by `datasource-admin`'s
  `testConnection` — no probe path called it, and `ObjectQL` exposed no way to ask
  (`drivers` is private with no accessor).

  This is the runtime-side half of #3741, which fixed only the boot-time version
  of the same defect.

  - New `ObjectQL.checkDriversHealth({ timeoutMs })` pings every registered driver
    and returns a `DriverHealth[]` verdict. Each probe is settled independently and
    bounded (default 2s) — `checkHealth()` swallows its own errors, but on a dead
    knex pool it does not return at all, waiting out `acquireConnectionTimeout`
    (60s by default), and a probe that hangs is as useless as one that lies. A
    driver implementing no `checkHealth()` is reported healthy: absence of a probe
    is not evidence of failure.
  - `GET /ready` now returns 503 with the failing driver names when the kernel is
    running but a driver is down, on top of the existing booting/shutting-down
    cases. The result is memoized for ~1s so Kubernetes' few-second polling does
    not become one database round-trip per probe per replica.
  - `GET /health` deliberately still checks nothing, and now says why in the code.
    A failing _liveness_ probe restarts the pod, which cannot fix an unreachable
    database but would put every replica into a restart storm for the length of the
    outage. Readiness — leave the rotation — is the failure mode that helps.

  The readiness check **fails open**: a kernel with no data engine (lite kernels,
  edge, metadata-only hosts), an engine predating `checkDriversHealth`, or a probe
  that itself throws all read as ready, exactly as before. Readiness gates whether
  a replica receives any traffic at all, so an inconclusive answer must not
  black-hole a working deployment. Only a driver that positively reports itself
  unhealthy takes the replica out.

  **Migration.** None. Deployments already wiring `/api/v1/ready` as their
  readiness probe get the stricter check automatically; deployments that pointed a
  _liveness_ probe at `/ready` should move it to `/health`, which is the endpoint
  that never fails on a dependency.

- 20cb232: feat(metadata-protocol,objectql): MetadataProtocolPlugin + `registerProtocol` opt-out — ADR-0076 Step 2 PR-A (#2462)

  `createMetadataProtocolPlugin()` now owns what `ObjectQLPlugin` historically
  assembled inline: the `ObjectStackProtocolImplementation` construction +
  `protocol` registration, the metadata-storage platform objects, and the D12
  `degraded` analytics fallback (pattern: plugin-security — named plugin,
  `dependencies` on the engine, `ctx.getService('objectql')`). `ObjectQLPlugin`
  grows `registerProtocol?: boolean` (default `true`, fully backward
  compatible): pass `false` when mounting the new plugin. Protocol CONSUMERS
  stay on the engine plugin either way — DB hydration and the authored
  hook/action rebind resolve `protocol` lazily (the rebind arms from `start()`
  in delegated mode) and degrade gracefully. Mixing both assemblies fails fast
  with the fix in the message. This is the additive first leg of the
  cross-repo sequence; cloud's 3 boot sites flip in PR-B, the built-in
  assembly + re-exports retire in PR-C.

- e231abb: feat(objectql,metadata-protocol)!: single-source the protocol assembly; drop objectql's protocol re-exports — ADR-0076 Step 2 PR-C (#2462)

  The ONE assembly now lives in `@objectstack/metadata-protocol` as
  `assembleMetadataProtocol()` — `createMetadataProtocolPlugin()` (delegated
  mode, cloud) and `ObjectQLPlugin`'s built-in convenience mode
  (`registerProtocol !== false`, single-kernel/dev boots) both mount the same
  code path (~112 inline lines deleted from the engine plugin). objectql's six
  protocol re-exports (`ObjectStackProtocolImplementation`,
  `SysMetadataRepository`, `SeedLoaderService`, `runBuildProbes` + types) are
  removed — import them from `@objectstack/metadata-protocol` directly
  (breaking, shipped as minor per the launch-window convention; the only known
  importers were five test files, repointed). Scope note vs the original Step-2
  recipe: the objectql→metadata-protocol dependency is deliberately KEPT for
  the convenience mount — `@objectstack/objectql/core` was already
  protocol-free, and forcing 20 framework boot sites to mount two plugins buys
  no runtime win. "Zero protocol dependency" lands as "zero assembly ownership,
  single source".

- b95577a: feat(automation): surface silently-stripped write fields as step warnings (#3407)

  `update_record` used to report an unconditional `success` even when the data
  layer legally stripped the requested write fields — static `readonly` (#2948)
  or a TRUE `readonlyWhen` predicate (#3042). The only trace was a server-side
  logger warn, invisible in the flow run trace: an author saw a clean 3ms
  `success` while the DB truth never changed (how #3356's approval stage
  write-backs failed unnoticed).

  - **spec**: new `DroppedFieldsEventSchema` / `DroppedFieldsEvent`
    (`{ object, fields, reason: 'readonly' | 'readonly_when' }`) in
    `data/data-engine.zod.ts`, and a `WriteObservabilityOptions`
    (`onFieldsDropped` listener) mixin on `IDataEngine.insert/update` option
    params in `contracts/data-engine.ts`. The listener is a TS-contract-level,
    in-process-only channel — deliberately NOT part of the serializable Zod
    options schemas or the RPC boundary.
  - **objectql**: `engine.update()` reports each strip pass's dropped keys +
    reason through `options.onFieldsDropped` (all four strip sites: single-id +
    bulk × readonly + readonlyWhen). A throwing listener never breaks the write.
    System-context writes skip the readonly strip and therefore report nothing,
    as before. `insert()` accepts the option for symmetry but strips nothing
    today (INSERT is readonly-exempt; FLS write denial throws).
  - **service-automation**: `NodeExecutionResult` and `StepLogEntry` gain
    advisory `warnings?: string[]`; `update_record` / `create_record` attach one
    warning per strip event naming the dropped fields, plus a structured
    `droppedFields` output (`{<nodeId>.droppedFields}`) for downstream nodes.
    `success` semantics are unchanged — stripping stays legal, it just is no
    longer silent.

### Patch Changes

- ad4af62: feat: single-source API-method derivation — the server is the only adjudicator (#3391)

  An object's effective API surface is now resolved from **six primitives**
  (`get/list/create/update/delete/bulk`) by ONE derivation table in
  `@objectstack/spec/data` (`resolveEffectiveApiMethods` / `isApiOperationAllowed`
  / `effectiveOperationsArray` / `API_METHOD_DERIVATION`). Every gate consumes it:
  the REST data surface, the runtime HTTP/MCP dispatcher, and the
  `/me/permissions` annotation. The `apiMethods` whitelist is three-state —
  `undefined` = unrestricted, `[]` = deny-all, a subset = the derived closure — and
  the legacy 8 verbs (`upsert/aggregate/history/search/restore/purge/import/
export`) are DERIVED from the primitives, never declared standalone. (This
  release also ships the enum shrink — see the `#3543` changeset: the authored
  enum IS the six primitives, and a stored legacy value is stripped at parse
  with a warning rather than honored.)

  **Derivation:** `import` ⊆ create∨update (writeMode-precise: insert→create,
  update→update, upsert→create∧update); `export` ⊆ list (reserved user-export slot,
  always on this phase); `aggregate`/`search` ⊆ list (search also needs
  `searchable`); `history` ⊆ get ∧ `trackHistory`; `upsert` ⊆ create∧update;
  bulk sub-ops ⊆ bulk ∧ derived(child). `restore`/`purge` do not derive (the
  `enable.trash` flag was retired, #2377).

  **New response-side contract:** `EffectiveObjectPermissionSchema` extends
  `ObjectPermissionSchema` with an optional `apiOperations` array;
  `GetEffectivePermissionsResponse.objects` uses it, and `/me/permissions` now
  hands down the per-object effective operation set. The authoring
  `ObjectPermissionSchema` is deliberately NOT extended — the frontend consumes
  the effective set the server resolves, never the raw whitelist.

  **Behavior changes (tightening — a `declared ≠ enforced` gap closed):**

  1. `apiMethods: []` + `apiEnabled: true` now denies every operation (405),
     matching the documented three-state contract instead of the prior fail-open
     "no restriction". In-repo impact is zero (every `[]` object also sets
     `apiEnabled: false`, so 404 precedes 405).
  2. The runtime dispatcher / MCP whitelist is now live. It previously read the
     flat shape while `getObject()` returns the flags nested under `.enable`, so
     the gate never fired — a silent dead gate now enforced (nested-first,
     flat-compatible).
  3. `import`/`export` reverse-derive: an object with a plain CRUD whitelist (no
     explicit `import`/`export`) now admits import (⊆ create∨update) and export
     (⊆ list). Row-level FLS is shared with list; the export column header is now
     projected to the FLS-readable set so it can never expose a wider column set
     than list (previously a masked column leaked its name as an empty column).
  4. The bulk surfaces (`createMany`/`updateMany`/`deleteMany`, per-object
     `/batch`, cross-object `/batch`) now require the `bulk` primitive AND the
     child write (`bulk ∧ child`). The four in-repo explicit-whitelist objects
     (`sys_user`, `sys_user_preference`, `sys_business_unit`,
     `sys_business_unit_member`) gained `bulk`; a third-party object with an
     explicit write whitelist that omits `bulk` will now 405 on the Many/batch
     routes.
  5. The 405 body's `allowed` array is now the derived EFFECTIVE operation set
     (enum-ordered), not the raw whitelist.

- d44dbfa: feat(spec)!: shrink the `ApiMethod` enum to the six primitives — legacy values are stripped at parse, never honored (#3543, P2 of #3391)

  **BREAKING** (the `!` marker and this changeset are the breaking-change
  record; the train ships as the v17 major — see the `v17-rc-anchor` changeset):
  the authored `enable.apiMethods` enum is now exactly the six
  primitives (`get`, `list`, `create`, `update`, `delete`, `bulk`). The eight
  legacy values (`upsert`, `aggregate`, `history`, `search`, `restore`, `purge`,
  `import`, `export`) are no longer authorable — they are DERIVED effective
  operations, resolved by the server's single derivation table.

  **Migration (FROM → TO).** Replace each legacy value with the primitives it
  derives from, then de-duplicate; if the result names all six primitives, delete
  the `apiMethods` key entirely (equivalent to default-open, and it tracks future
  primitives):

  | FROM (legacy) | TO (primitives)      | why                                            |
  | ------------- | -------------------- | ---------------------------------------------- |
  | `upsert`      | `create`, `update`   | upsert ⊆ create ∧ update                       |
  | `import`      | `create`, `update`   | import ⊆ create ∨ update (writeMode-precise)   |
  | `export`      | `list`               | export ⊆ list                                  |
  | `aggregate`   | `list`               | aggregate ⊆ list                               |
  | `search`      | `list`               | search ⊆ list ∧ `searchable`                   |
  | `history`     | `get`                | history ⊆ get ∧ `trackHistory`                 |
  | `restore`     | _(delete the value)_ | never derives — `enable.trash` retired (#2377) |
  | `purge`       | _(delete the value)_ | never derives — `enable.trash` retired (#2377) |

  Reporter codemod: `node scripts/codemod/apimethods-legacy-to-primitives.mjs`
  (scans, reports the exact replacement per site, and flags whitelists the
  mapping would WIDEN so the edit stays reviewable).

  **Stored metadata keeps parsing — permanent tolerance, narrowing only.** Real
  metadata does not upgrade in lockstep with the spec, so a stored legacy value
  is NOT a parse error: `stripLegacyApiMethods` (new export) strips it with a
  FROM→TO warning (canonicalize-and-warn). Stripping only ever NARROWS exposure —
  the derivation table still grants every legacy verb that derives from the
  primitives you declared. Two cliffs to know:

  1. A whitelist of ONLY legacy values (e.g. `['upsert']`) strips to `[]` =
     **deny-all** — the object's API closes instead of widening. The strip
     warning and the objectql registration diagnostic both call this out.
  2. A legacy value NOT derivable from your declared primitives (e.g.
     `['get', 'export']` — export needs `list`) was honored by the P1
     "explicit wins" path and is now denied. Declare the underlying primitive.

  **Type split — authored vs effective vocabulary.** `ApiMethod` (authored) is
  now six values; the NEW `ApiOperation` type / `ApiOperationSchema` /
  `API_OPERATION_ORDER` (fourteen values, byte-stable pre-shrink wire order)
  carry the EFFECTIVE vocabulary. The wire contract is unchanged: the 405
  `allowed` array and `/me/permissions` `apiOperations` still serialize derived
  verbs (`export`, `search`, …), and `EffectiveObjectPermissionSchema.apiOperations`
  now validates against `ApiOperationSchema`. `EffectiveApiMethods.explicitLegacy`
  is removed (nothing is honored verbatim anymore); `API_METHOD_ORDER` remains as
  a deprecated alias of `API_OPERATION_ORDER`.

  **Fail-closed tightening (#3545):** a PRESENT but non-array `apiMethods` (only
  producible by a raw/out-of-band metadata write) now resolves to `deny-all`
  instead of unrestricted — a policy that exists but cannot be read fails CLOSED.

  **Published JSON Schema diverges deliberately:** `data/ApiMethod.json` is the
  strict six-value enum (a `z.preprocess` is not representable in JSON Schema),
  so external JSON-Schema validators reject legacy values that the zod parse
  would strip-and-warn. Treat the JSON Schema as the authored contract; the zod
  tolerance exists for stored metadata.

  **objectql:** the P1 "explicit wins" transition is reclaimed —
  `warnDeprecatedExplicitApiMethods` is replaced by `warnStrippedLegacyApiMethods`
  (a permanent per-object diagnostic for schemas that reach the registry without
  passing through Zod; the parse-time strip warning carries no object name).

  **platform-objects:** whitelist audit — `sys_business_unit`,
  `sys_business_unit_member` (P1's explicit `import`/`export` reclaimed) and
  `sys_user_preference` dropped their `apiMethods` entirely (each named all six
  primitives = default-open). Read-only and deny-all whitelists are unchanged;
  the seven `[]` declarations are deliberately KEPT as defense-in-depth alongside
  `apiEnabled: false`.

- b949059: fix(approvals): a dead approval run no longer leaves the record RECORD_LOCKED (#3456)

  The record lock is keyed on a **pending** `sys_approval_request`, and it could
  not tell _the run that owns that request_ from _an unrelated user editing the
  record_. So a flow that touched its own target record while its own approval was
  still pending — a manual `resume` with no decision, or a node that writes the
  record between opening the approval and the decision — died on its own
  `RECORD_LOCKED`, and the record stayed locked behind the dead run. Recovery
  existed (#3424 lets an admin `recall`/`reject` to release it) but nothing made it
  self-healing.

  Both halves are now closed.

  **Prevention — the owning run may write its own record.** The automation engine
  stamps `flowRunId` onto the run context at setup, alongside `runAs`, and it
  travels with every data node's ObjectQL context into `ctx.provenance`. The lock
  hook exempts a write whose `flowRunId` matches the pending request's `flow_run_id`.
  It is keyed on run identity rather than elevation on purpose: a `runAs:'user'`
  run stays fully RLS-scoped while it writes. `flowRunId` is pure provenance —
  server-constructed like `isSystem`, never client-supplied, evaluated by no
  security middleware, and the only write it permits is to the one record its own
  run already holds a pending request against.

  **Recovery — a sweep releases records held by runs that died anyway.** A pending
  request whose owning run has reached a terminal state (`completed`, `failed`,
  `cancelled`, `timed_out`) can never be decided, so it is finalised as `recalled`
  — releasing the lock — and audited under the reserved actor `system:dead-run`
  with the run and its status in the comment, so it is never mistaken for a
  submitter's withdrawal. It runs on the existing approvals sweep clock, which also
  covers the case no in-band handler can: a run killed by a process crash.

  The sweep is fail-safe by construction. It acts only on an explicit terminal
  status from a closed set; `paused` (the normal state of a live approval),
  `running`, an unrecognised status, an unknown run, a `getRun` that throws, and a
  deployment with no automation engine are all read as "still alive". The failure
  mode is "a dead run's lock survives until an admin recalls it" — today's
  behaviour — never "a live approval is destroyed".

  Also fixes `AutomationEngine.getRun`, which returned the **first** log entry for
  a run id rather than the latest. A run that pauses and later finishes records two
  entries under one id, so every suspend-then-finish run — every approval, screen
  and wait flow — reported itself as `paused` forever, both on the Runs
  observability surface and to this sweep.

  One shape was left out here and closed separately in #3712: a `runAs:'user'` run
  with no trigger user (a schedule) resolved no ObjectQL context at all, so it
  carried no `flowRunId` and stayed subject to the lock. It now passes a
  provenance-only context — the run id and nothing the security middleware keys on
  — so it is attributable without acquiring a principal, and its documented
  unscoped posture (#1888) is unchanged.

- c5ff96d: fix(approvals): a schedule-triggered run can write its own locked record (#3712)

  #3456 let the run that opened a pending approval write its own target record,
  keyed on `flowRunId`. It worked for every run that resolves an identity and
  missed the one that doesn't: an effective `runAs:'user'` run with **no trigger
  user** — a schedule being the canonical case — passed no ObjectQL context at
  all, so nothing carried the run id and the run still died on its own
  `RECORD_LOCKED`.

  The blocker was never the lock. It was that "no identity" and "no context" were
  the same thing on the wire, so a run could not say _who it was_ without also
  claiming _what it was allowed to do_.

  **A run with no principal now passes provenance alone.**
  `resolveRunDataContext` returns `{ flowRunId }` — no `userId`, no `positions`,
  no `permissions`, not even `isSystem: false`. Every principal gate keys on one
  of those fields (the elevation short-circuit on `isSystem`, the ADR-0103
  engine-owned write guard and the ADR-0090 D12 delegated-admin gate on `userId`,
  the empty-principal fall-open on all three), so this context authorizes
  **identically to no context at all**. The run keeps the documented #1888
  unscoped posture, its loud `[runAs]` warning, and the
  `flow-schedule-runas-unscoped` build-time lint. Nothing about what it may touch
  changed — only that it can now be attributed.

  **Provenance moved out of the hook session, into `ctx.provenance`.** `session`
  answers _who is calling_ and is absent when no identity envelope was supplied —
  a distinction real gates depend on (the attachment access gate skips bare-kernel
  writes on exactly that test). Folding a run id into `session` would have forced
  an identity-less run to present an empty session, silently turning "no caller"
  into "an anonymous caller" and narrowing the #1888 fail-open for attachments
  alone. `HookContext.provenance.flowRunId` says what produced the write; the
  approvals lock reads it there.

  Also relaxes `BaseEngineOptionsSchema.context` to a partial envelope
  (`ExecutionContextInput`). `positions`/`permissions`/`isSystem` carry parse-time
  defaults, which made them _required_ on a caller-supplied option and asserted
  something untrue — that every data-engine context carries a principal. Callers
  have always passed slices (`{ isSystem: true }` for a system read); the type now
  says so.

  Migration: nothing to change unless you read the run id inside a hook. If you
  wrote `ctx.session.flowRunId`, read `ctx.provenance.flowRunId` instead — the
  field never shipped under the old name.

- 87aca93: fix(datasource)!: a declared datasource that objects bind to must connect, or the boot fails (#3758)

  `DatasourceConnectionService.handleFailure()` fail-fasted only for an `external`
  datasource with `validation.onMismatch: 'fail'`. Everything else degraded to one
  `warn` line — including the case the D2 auto-connect gate itself flags as having
  **no fallback path**: a datasource that objects bind to explicitly via
  `object.datasource`. Those objects never fall through to the `default` driver;
  `engine.getDriver` throws `Datasource 'x' is not registered` for them.

  So an app declaring `datasource: 'analytics'` with 20 objects bound to it, booted
  against a wrong `ANALYTICS_URL`, started clean and exited zero — and then failed
  every read and write of those 20 objects with an error that reads nothing like
  _the analytics database is unreachable_. The rest of the app worked, which made it
  **harder** to locate than a total outage: it looks like "some pages are broken",
  not like a misconfigured datasource. This is the same decision #3741/#3751 fixed
  one layer up in `ObjectQLEngine.init()`; the boundary here was still drawn in the
  old place.

  - **Fail-fast is now keyed on "no fallback path", not on `onMismatch` alone.** At
    the `declared-auto` (boot) trigger, a connect failure aborts the boot when the
    datasource is `external` + `onMismatch: 'fail'` **or** when ≥1 object binds to
    it explicitly. `autoConnect: true` with nothing bound stays lenient — that is
    "connect it if you can", and nothing declares a dependency on it. The
    runtime-admin create/update and boot-rehydration triggers are unchanged and
    still always degrade: a UI action must never brick a running server.
  - **Every failure mode counts**, not just an unreachable socket: an unresolvable
    `external.credentialsRef` (D3) and an unsupported `driver` leave the bound
    objects exactly as dead, so they take the same verdict.
  - **The error names the bound objects** (up to 10, then `+N more`) alongside the
    underlying cause, so the message points at the real problem instead of just the
    datasource name. The service already receives the list for post-connect
    `syncObjectSchema`.
  - **`connectDeclared()` attempts every gated datasource before throwing**, and
    aggregates, so one failed boot reports all the misconfigured ones rather than
    one per restart — the same shape as `ObjectQLEngine.init()`'s
    `DriverConnectError`.
  - **The escape hatch is shared with the engine guard**:
    `OS_ALLOW_DRIVER_CONNECT_FAILURE=1` now also covers this path (and covers
    `onMismatch: 'fail'`, which previously had no opt-out). The operator intent is
    identical — "I know the database is unreachable, boot anyway" — and two flags
    would only guarantee one of them gets missed. When set, boot continues and a
    `DEGRADED BOOT` banner goes to stderr as well as the logger, because `os serve`
    swallows stdout during boot. `emitDegradedBootBanner` moved to
    `@objectstack/types` so both call sites share one implementation;
    `@objectstack/objectql` re-exports it unchanged.

  ADR-0062 D5 is amended with the new criterion and the shared flag.

  **Migration.** No change for a correctly configured deployment — a datasource that
  connected before still connects. A deployment that was _silently_ booting with a
  dead, explicitly-bound datasource now fails the boot instead, naming the
  datasource, the cause, and the objects that depend on it; fix the datasource
  configuration. To keep booting without it — deliberately, knowing every request
  touching those objects will fail — set `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`.

- 32d3800: fix(driver-sql): bound a connection attempt at 10s, and correct the "no reconnection" claim (#3769, #3759)

  Two related corrections, both from measuring what #3741/#3751/#3765 had only asserted.

  **The claim was wrong.** #3751 and #3765 shipped several statements that drivers
  never reconnect — "there is no lazy reconnection", "NOT retried and NOT
  reconnected", "stays disconnected for the process lifetime". Measured, both
  drivers recover on their own:

  - driver-mongodb: killing a real `mongod` and restarting it on the same port,
    the _same_ driver instance served the next write successfully (13ms), with no
    reconnect call from us — the official driver's topology monitor handles it.
  - driver-sql: a knex/pg pool is not poisoned by an outage. Its error tracks live
    server state (`ECONNREFUSED` while down → a handshake error once a listener is
    back → `ECONNREFUSED` again), i.e. every acquire opens a fresh connection.
    `storage-driver.ts` also configures `pool.min: 0`, so no stale idle
    connections are held.

  The original reasoning grepped this repo for `reconnect`, found nothing, and
  concluded recovery does not happen — but the recovery lives in the client
  libraries, not in our code. The claims are now corrected in `DriverConnectError`,
  the `DEGRADED BOOT` banner, `resolveAllowDriverConnectFailure`'s docs, and the
  drivers / self-hosting pages.

  **Fail-fast at boot is unchanged and still correct** — the reason is just
  different. It is not that the connection can never return; it is that the _boot
  sequence_ never re-runs. A driver that missed `init()` also missed
  `syncRegisteredSchemas()`, so its tables can simply not exist even after the
  database comes back. The banner now says that.

  **The real defect underneath.** `SqlDriver` passed its config to knex untouched,
  so a database endpoint that accepts TCP but never completes the handshake — an
  overloaded instance, a half-open firewall, a load balancer mid-failover — made
  every query wait out tarn's 30s default, then fail with `Timeout acquiring a
connection. The pool is probably full`, pointing an operator at pool sizing
  instead of the network. With a small `pool.max` a few such queries saturate the
  pool and everything else queues.

  `SqlDriver` now defaults `pool.createTimeoutMillis` to **10s**, matching
  driver-mongodb's existing `connectTimeoutMS ?? 10_000` so both drivers give up on
  an unreachable server at the same point. A host that sets its own
  `createTimeoutMillis` is left alone.

  **Migration.** None for a healthy datasource. A deployment that deliberately
  relies on connection establishment taking longer than 10s (a slow cross-region
  replica) should set `pool.createTimeoutMillis` explicitly on its `SqlDriver`
  config.

  Not fixed here, tracked in #3769: knex still reports the bounded wait as "the
  pool is probably full". An accurate message needs a dialect-specific connect
  timeout (pg's `connectionTimeoutMillis`), which changes the shape of `connection`
  and would regress the startup banner's URL display.

- 0e3a226: fix(authz): widen the driver's native tenant scope to the membership union
  under the `group` posture — ADR-0105 D2 finally reaches the wire (#3623)

  The Layer 0 wall correctly compiled `organization_id IN accessible_org_ids`
  under `group`, but the ObjectQL engine also propagated the active-org
  `tenantId` into `DriverOptions` unconditionally, and the SQL driver's native
  scoping ANDed `organization_id = tenantId` under the union — collapsing every
  group read back to active-org (isolated) reach. Found by the cloud-side
  `ee-group-showcase` dogfood (cloud#880), the first end-to-end boot of `group`
  against a real driver.

  - `DriverOptions.tenantIds` (spec): the union tenant access set. Drivers with
    native scoping widen reads/updates/deletes/aggregates to `IN (...)`,
    keeping the NULL-tenant global-row carve-out; inserts still stamp from
    `tenantId` (the active organization is the write target, D5). Absent or
    empty ⇒ equality fallback — fail toward isolation, never toward exposure.
  - ObjectQL engine threads `ExecutionContext.accessible_org_ids` as
    `tenantIds` when the tenancy posture is `group`, reported by a new
    `setTenancyPostureProvider` seam.
  - SecurityPlugin wires that provider at start — deliberately from the
    enforcement layer, so the driver wall only widens while the Layer 0 union
    wall enforces above it. Embeddings without plugin-security keep active-org
    equality.

- 81ce41a: feat(rest): `treatAsHistorical` import also preserves the original audit timeline (#3493)

  Follow-up to #3479/#3483. `treatAsHistorical` solved the FSM half — mid-lifecycle
  rows are no longer rejected by `initialStates` — but the OTHER half of a historical
  migration, preserving the original timeline, still didn't hold: an imported ticket
  that closed in 2021 stored `updated_at` = the import day (and `updated_by` = the
  importer), and a `writeMode: 'upsert'` refresh silently dropped business `readonly`
  fields (`closed_at`, `resolved_by`). Reports, audit, and "recently modified"
  sorting all came out wrong.

  Three layers were force-overwriting the timeline; all three now respect a single
  new opt-in flag, `ExecutionContext.preserveAudit`, which `treatAsHistorical` sets
  alongside `skipStateMachine`:

  - **spec**: `ExecutionContext.preserveAudit` (server-set only, never client-supplied)
    and `DriverOptions.preserveAudit` (threaded to the driver's update stamp).
  - **objectql** — the built-in audit hook (`plugin.ts`) now treats `updated_at` /
    `updated_by` as CLIENT-PREFERRED (`?? now` / `?? userId`) under `preserveAudit`,
    symmetric with how `created_at` / `created_by` already behave on insert; and the
    static-`readonly` write strip (`stripReadonlyFields`) admits a WHITELIST — the
    audit/timestamp family plus author-declared business `readonly` fields — so an
    upsert refresh no longer drops them.
  - **driver-sql** — the SQL `update` path keeps a supplied `updated_at` instead of
    force-advancing it to `now` when `DriverOptions.preserveAudit` is set (fills-only-
    empty, mirroring the insert stamp).
  - **rest** — the import runner sets `preserveAudit` on the write context iff the
    request opts into `treatAsHistorical`.

  Deliberately a WHITELIST, not the blanket `isSystem` exemption: platform-managed
  `system` columns OUTSIDE the audit family (`organization_id` / tenancy, generated
  columns) STAY stripped, so a historical import reinstates established facts without
  becoming a backdoor to forge tenancy. Permissions / RLS / field-level security are
  unaffected — this changes only which audit/readonly values the runtime overwrites,
  never who may write the record. Fully opt-in: a normal write still auto-stamps
  `updated_at`/`updated_by` and strips `readonly` exactly as before. The objectui
  "Import as historical data" checkbox (objectui#2815) now drives both halves — no new
  UI.

- 85e1e4e: feat(rest): `treatAsHistorical` import option — skip the state machine for historical-data migration (#3479)

  Sibling of #3433 (seed exemption), one entry point over. #3165's `initialStates` enforced
  the FSM entry point on every INSERT, so importing established historical facts —
  a batch of already-`closed` tickets, `closed_won` deals, `completed` projects —
  was rejected row-by-row with `invalid_initial_state`, blocking the core
  data-migration path. Unlike the seed case it was visible (per-row errors), but it
  still functionally blocked a legitimate use.

  - **spec**: `ExecutionContext.skipStateMachine` — a general, server-set flag (the
    seed-specific `seedReplay`'s sibling) that skips the `state_machine` rule for a
    write; `ImportRequestSchema.treatAsHistorical` (default `false`) — the user-facing
    import option.
  - **objectql**: the engine now skips the state machine for `seedReplay` OR
    `skipStateMachine` (one helper), covering both seed replay and historical import.
  - **rest**: the import runner sets `skipStateMachine` on the write context iff the
    request opts into `treatAsHistorical`; default off, so a normal import still walks
    the FSM (the strict behavior is the default). Import **undo** now also carries
    `skipStateMachine`, since restoring a prior snapshot re-writes an earlier state
    that need not be a legal transition from where the row is now.
  - **platform-objects**: `sys_import_job.treat_as_historical` audit column (additive).

  Scope is identical to the seed exemption: ONLY the `state_machine` rule is skipped;
  field shape, `format`, `cross_field`, `script` all still run. The objectui import
  wizard checkbox is a separate follow-up.

- e1fa8d5: fix(objectql): arm the late-manifest metadata bridge on project kernels too

  The per-manifest bridge added for marketplace installs (#3428) armed itself
  inside the same `environmentId === undefined` gate as the one-shot startup
  bridge — but `os dev` boots the kernel project-scoped (environmentId
  'env_local'), which is marketplace install-local's primary home, so the fix
  was inert exactly where it matters. Caught by browser-dogfooding the install
  flow.

  The gate is correct for the one-shot bridge (it copies the entire
  process-wide SchemaRegistry, which would leak sibling-project objects on
  multi-environment servers) but does not apply to the per-manifest bridge: it
  only copies the objects of the one package this kernel just registered.
  Arming now happens unconditionally at the end of `start()`; boot-time
  behavior on every kernel shape is unchanged (the flag still flips only after
  the startup path has run), and the one-shot bridge keeps its gate.

- 402f534: fix(objectql): bridge late-registered manifest objects into the metadata service

  Marketplace-installed template packages register through the `manifest`
  service on `kernel:ready` (install) or later (HTTP install), but the one-shot
  SchemaRegistry→metadata bridge runs once during `ObjectQLPlugin.start()` —
  so their objects only ever reached the ObjectQL registry. Every
  IMetadataService consumer (AI `describe_object`, Studio object lists,
  `metadata.listObjects`) missed them; only the seed loader had grown an
  engine-side fallback (#3422).

  The manifest service's `register` now bridges the manifest's own objects into
  the metadata service after registering them with the engine, resolving the
  service at call time and mirroring the startup bridge's contract:
  `register('object', name, obj, { notify: false })` (#3112), skip entries it
  did not bridge itself, refresh its own copy on same-package re-install (hot
  upgrade). Armed only after `start()` has run the one-shot bridge, and never
  on project kernels — boot-time behavior is unchanged. `register` now returns
  a promise; the marketplace install/rehydrate paths await it so metadata reads
  right after an install are deterministic.

- 0c302a7: Exempt curated seed writes from `state_machine` validation (#3433).

  A seed is a snapshot of established facts — a project already `completed`, an
  opportunity already `closed_won` — not a record walking its lifecycle. But once
  an object declared `state_machine.initialStates` (#3165), the write path enforced
  the FSM entry point on **every** insert, so seed replay silently rejected every
  mid-lifecycle row and cascaded its master-detail children. That is the "installed
  but no data" failure for the showcase board (1 of 5 projects), and it would hit
  every marketplace template (a `closed_won` opportunity, a `closed` case) plus the
  rehydrate-heal and per-org replay paths.

  `SeedLoaderService` now marks its writes with a server-set `ExecutionContext.seedReplay`
  flag; the engine passes `skipStateMachine` to the rule evaluator for those writes,
  which skips the `state_machine` rule on both insert (`initialStates`) and update
  (transitions). The exemption is scoped to `state_machine` only — a seed must still
  satisfy every other validation (`format`, `cross_field`, `script`, `json_schema`,
  `conditional`). Because all seed paths funnel through `SeedLoaderService.SEED_OPTIONS`,
  the fix covers boot inline seed, marketplace install/heal, and per-org replay at once.

  The showcase project seed drops its three-phase FSM-walk workaround (#3415) and
  seeds each project directly at its real status again.

- 5f0852f: fix(driver-sql): bucket a SQLite `Field.datetime` by its stored instant instead of collapsing every row into one `(null)` (#3773)

  On SQLite, any trend chart bucketed by day/week/month/year over a
  `Field.datetime` column put **every record in a single `(null)` bucket** — one
  bar, carrying the whole total. The measure was right; only the bucket key was
  wrong. `Field.date` (ISO TEXT storage) was unaffected, so the same dashboard
  could show one column working and the next one flat.

  better-sqlite3 stores a `Field.datetime` as INTEGER epoch **milliseconds** (knex
  binds a JS `Date` as `.getTime()`), and `buildDateBucketExpr` emitted a flat
  `strftime('%Y-%m', col)`. SQLite reads a bare integer as a **Julian day
  number**; an epoch-ms value is far outside the legal range, so `strftime`
  returned NULL for every row. Nothing downstream noticed: SQLite advertises
  `queryDateGranularity.month`, so `engine.aggregate` pushes the bucketing down,
  and its in-memory fallback only engages for an _unsupported_ granularity or a
  non-UTC timezone.

  The SQLite expression is now storage-aware, sharing one `isEpochStoredDatetime`
  predicate with the filter-comparand coercion added for the same root cause in
  \#2034 — a window and a bucket that disagree about storage is exactly how an
  epoch column ended up correctly filtered and then entirely bucketed as NULL.
  Postgres and MySQL are untouched: `defineColumn` maps `Field.datetime` to a
  native timestamp there, which is also why their comparands are left alone.

  Two details are load-bearing and pinned by tests:

  - The conversion dispatches on each **stored value's** type, not just the
    declared one. A SQLite `Field.datetime` column is genuinely mixed-form —
    `formatInput` passes datetime values through, so a `Date` lands as INTEGER
    while an ISO string (including an unresolved `defaultValue: 'NOW()'`) lands as
    TEXT. Dividing TEXT by 1000 coerces it to its leading year, filing live rows
    under 1970 — worse than the NULL it replaced.
  - Division is `/1000.0`, not `/1000`. Integer division truncates toward zero, so
    a pre-1970 instant (`-1` ms) would surface as 1970-01-01.

  `bucketDateValue` (the in-memory fallback in `@objectstack/objectql`) now reads a
  finite **number** as epoch milliseconds. `new Date(String(1767225600000))` is an
  Invalid Date, so a driver handing back raw storage values bucketed as `'(null)'`
  there while the pushed-down SQL bucketed correctly — fixing only the driver would
  have traded one wrong answer for two different ones, and the two paths have to
  label the same instant identically for a drill-down to survive crossing them.

  `SqliteWasmDriver` inherits `buildDateBucketExpr`, so it carried the bug and gets
  the fix.

- cde1975: fix(dev): eliminate three fixed startup log warnings so official examples boot clean (#3420)

  `os dev` on the stock showcase printed three fixed noise sources on every boot,
  with zero example-side changes — training users to ignore warnings.

  - **spec** — add a field-level `ackPlaintextMasking: true` opt-out for the
    generic `password` author-time warning (ADR-0100). A deliberately-masked
    field (like field-zoo's `f_password`) can now affirm intent instead of
    printing an un-actionable "safe to ignore" on every boot; the warning text
    points authors at the flag.
  - **plugin-auth** — pass better-auth's documented
    `silenceWarnings.oauthAuthServerConfig` to `oauthProvider(...)`. We already
    mount the `/.well-known/oauth-authorization-server` documents ourselves at
    the issuer root, so the plugin's "please ensure it exists" reminder was a
    false positive (printed twice); silencing it removes both.
  - **objectql** — route the Registry's re-register / package-overwrite lines
    (normal rebuild / HMR / seed-replay paths) through a new debug-only
    `SchemaRegistry.debug()` so they stay out of the default `info` boot log. Adds
    a `logLevel` construction option (and matching `OS_REGISTRY_LOG` env var) so
    the debug-gated housekeeping is discoverable for troubleshooting.

- 54f479a: fix(objectql): accept relative and inline URLs on `url` fields

  The record-validator's `url`-type check required an absolute `scheme://` URL,
  so it rejected the **root-relative** value the platform's own storage service
  returns for an uploaded file. The console avatar uploader
  (`createObjectStackUploadAdapter`) PUTs the image to storage and then writes
  `sys_user.image` (a `Field.url`) = `/api/v1/storage/files/<id>`; that failed
  `invalid_url` and — on the better-auth `update-user` path — surfaced as a
  failed profile save (the "上传用户头像报错" avatar-upload bug).

  `URL_RE` now also accepts root-/protocol-relative refs (`/path`, `//host/path`)
  and the `data:` / `blob:` inline forms, in addition to `scheme://…`. A bare
  scheme-less string with no leading `/` (e.g. `"notaurl"`) is still rejected.
  Verified end-to-end in the running Console: avatar upload → display → replace →
  remove all succeed.

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
- Updated dependencies [840ee4b]
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
- Updated dependencies [3949a43]
- Updated dependencies [87aca93]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [32d3800]
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
- Updated dependencies [030125b]
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
- Updated dependencies [db48ad5]
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
- Updated dependencies [4c5a584]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [20cb232]
- Updated dependencies [e231abb]
- Updated dependencies [0bc685a]
- Updated dependencies [c073b8c]
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
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0
  - @objectstack/metadata-protocol@17.0.0-rc.0
  - @objectstack/formula@17.0.0-rc.0
  - @objectstack/metadata-core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/formula@16.1.0
  - @objectstack/metadata-core@16.1.0
  - @objectstack/metadata-protocol@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Major Changes

- 6c270a6: **BREAKING: remove the deprecated `ctx.session.tenantId` / `ctx.user.tenantId` alias from the hook & action authoring surface — converge on `organizationId` (#3290).**

  #3280 made `organizationId` the blessed developer-facing name for the caller's active org across the JS authoring surface and kept `tenantId` as a `@deprecated` alias carrying the identical value. That alias is now **removed** from the hook `ctx.session`, the action-body `ctx.session`, and the action-body `ctx.user`. Read the caller's active org under the single blessed name:

  ```diff
  - const org = ctx.session.tenantId;   // hook or action body
  + const org = ctx.user?.organizationId ?? ctx.session?.organizationId;
  ```

  **FROM → TO migration** (in any `*.hook.ts` / `*.action.ts` body):

  - `ctx.session.tenantId` → `ctx.session.organizationId`
  - `ctx.user.tenantId` (action body) → `ctx.user.organizationId`

  The value is unchanged — `organizationId` is the same active-org id, matching the `organization_id` column and `current_user.organizationId` in RLS/sharing. `ctx.user` is `undefined` for system / unauthenticated writes, so read `ctx.session?.organizationId` when a hook or action must work regardless of a resolved user.

  What changed internally:

  - **`@objectstack/spec`** — `HookContextSchema.session` drops the `tenantId` field (only `organizationId` remains). A stray `tenantId` on a constructed session is now stripped by the schema.
  - **`@objectstack/objectql`** — the engine's `buildSession()` no longer emits `session.tenantId`; the audit-stamp plugin sources the `tenant_id` column from `session.organizationId`.
  - **`@objectstack/runtime`** — `buildActionSession()` and the REST action `ctx.user` no longer emit `tenantId`.
  - **`@objectstack/trigger-record-change`** — reads `session.organizationId` (was `session.tenantId`) when forwarding the writer's org to a `runAs:'user'` flow; behavior is identical.

  **Explicit non-goal (unchanged):** the generic **driver-layer** tenancy abstraction is _not_ touched — `ExecutionContext.tenantId`, `DriverOptions.tenantId`, `SqlDriver.applyTenantScope` / `TenancyConfig.tenantField`, and `ExecutionLog.tenantId`. That isolation column is configurable and legitimately carries an _environment_ id in database-per-tenant kernels; it is a distinct axis from the developer-facing org. The build-time `check:org-identifier` guard now also covers `packages/**` to keep reference bodies off the removed name.

### Minor Changes

- 22013aa: **Split the overloaded `managedBy: 'system'` bucket into engine-owned vs. admin-writable, and enforce engine-owned writes (ADR-0103, #3220).** The `system` bucket conflated two incompatible write policies: rows a platform service owns end to end (never user-written), and platform-defined schema whose rows are legitimately admin/user-writable. It carried the same all-false affordance row as `better-auth`/`append-only` but, unlike `better-auth`, had no engine enforcement — a wildcard admin could raw-write these rows through the generic data API (ADR-0049 gap).

  Rather than add a new `managedBy` enum value (which would fall through to fully-editable `platform` defaults on already-deployed Console clients), the write policy is now the **resolved affordance** (`resolveCrudAffordances` = bucket default + `userActions`), and _engine-owned_ is defined as a `system`/`append-only` object that grants no write:

  - **Writable set declares `userActions`** — the RBAC link tables (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`), `sys_user_preference`, `sys_approval_delegation`, and the messaging config grids (`sys_notification_preference` / `…_subscription` / `…_template`) now declare `userActions: { create, edit, delete: true }`. The affordance is a declaration only — the `DelegatedAdminGate` / RLS / permission sets remain the authz.
  - **Engine-owned objects locked to reads** — `apiMethods: ['get','list']` added where absent (jobs, notifications, approval request/approver/token/action, `sys_record_share`, `sys_automation_run`, mail/settings/secret audit, the messaging delivery pipeline). `sys_secret` is explicitly read-locked (an empty `apiMethods` array fails open).
  - **`sys_import_job`** stays engine-owned: the REST import route now writes its job rows `isSystem`-elevated (attribution preserved via the explicit `created_by` stamp) and the object is locked to `['get','list']`.
  - **New engine write guard** (`assertEngineOwnedWriteAllowed`, plugin-security) fail-closed rejects user-context generic writes to engine-owned `system`/`append-only` objects, keyed off the resolved affordance; `isSystem` and context-less engine/service writes bypass by construction. Wired into the security middleware alongside the other data-layer gates.
  - **`reconcileManagedApiMethods`** (objectql registry) now runs for **every** managed bucket, not just `better-auth`: any advertised write verb an object's resolved affordances forbid is stripped at registration with a warning (the drift backstop, ADR-0049).
  - **`/me/permissions` clamp** (plugin-hono-server) now clamps `system`/`append-only` as well as `better-auth`, so the client hint reflects `permission ∩ guard`.

  **Potentially breaking:** a downstream/third-party `system` object that advertised generic write verbs relying on today's fail-open behaviour will have those verbs stripped (with a warning) and user-context generic writes to it rejected. Declare `userActions` opening the verbs the object legitimately takes from a user context. `better-auth` keeps plugin-auth's identity write guard unchanged; the row-level `managed_by` provenance vocabulary (ADR-0066) is a different axis and is untouched.

- 04ecd4e: feat(validation): `state_machine.initialStates` enforces the FSM entry point on INSERT (#3165)

  A `state_machine` rule's `transitions` only governs UPDATE — on INSERT the rule
  was a no-op, and a `select` field permits ANY declared option as the initial
  value. So a record could be born mid-flow (created already `approved`), skipping
  the whole state machine. This was the gap #3043's mitigation idea assumed didn't
  exist (declared ≠ enforced, ADR-0049).

  `state_machine` rules gain an optional `initialStates: string[]` — the states a
  record may be CREATED in. When set, an insert whose (defaulted) state-field value
  is outside the list is rejected server-side with `code: 'invalid_initial_state'`.
  Omit it to keep the legacy behavior (no initial-state check on insert). A missing
  / empty value is left to required-validation; `transitions` (UPDATE) is
  unaffected. Enforced at the same `evaluateValidationRules(..., 'insert')` seam the
  engine already runs after field defaults.

- 4d5a892: feat(objectql): roll-up `summary` fields can filter which child rows they aggregate (#1868)

  `summaryOperations` gains an optional `filter` — a query `where` FilterCondition
  evaluated against each child row, so a summary aggregates only the matching
  children instead of the whole collection. This is what lets a single child object
  feed several distinct parent totals, which the cross-object rollup templates need:

  ```typescript
  // One `engagement` child → distinct filtered totals.
  total_signups: {
    type: 'summary',
    summaryOperations: { object: 'engagement', field: 'id', function: 'count', filter: { type: 'signup' } },
  }
  // Sum only received receipt lines (3-way match).
  received_amount: {
    type: 'summary',
    summaryOperations: { object: 'procurement_receipt', field: 'amount', function: 'sum', filter: { status: 'received' } },
  }
  ```

  The engine ANDs the predicate with the parent-FK match when it recomputes, and
  because the whole filtered aggregate is re-run on every child write, a child that
  moves in or out of the predicate (e.g. a status change) keeps the parent current
  with no extra wiring. Operator and compound forms work too
  (`filter: { type: { $in: ['signup', 'trial'] }, amount: { $gte: 100 } }`).

  Purely additive: omitting `filter` aggregates every child exactly as before.

### Patch Changes

- a8aa34c: Enforce validation rules, `requiredWhen`, and per-option `visibleWhen` on multi-row updates (#3106). The bulk branch of `engine.update` (`options.multi` → `driver.updateMany`) previously never called `evaluateValidationRules`, so every object-level rule (`script`, `state_machine`, `format`, `cross_field`, `json_schema`, `conditional`), field-level `requiredWhen`, and per-option `visibleWhen` check was a silent no-op there. The engine now reads the row-scoped match set (the same AST the write binds, one query shared with the `readonlyWhen` bulk strip) and evaluates the payload against each matched row's prior state; any error-severity violation rejects the whole batch with `ValidationError` (annotated with the failing record id) before anything is written. Schemas needing no prior state (`format`/`json_schema`-only) are evaluated once against the payload with no fetch, and rule-free schemas are unaffected. Behavior change: bulk writes that previously slipped past declared rules now throw. Doc comments in `rule-validator.ts` and `validation.zod.ts` no longer overstate coverage and name the remaining `events: ['delete']` gap (tracked separately).
- e057f42: fix: harden the bulk-write path — retries, idempotency, contracts, and summary visibility (#3147–#3152)

  Six reliability fixes to the batched seed/import + `engine.insert(array)` path
  introduced by the #2678 bulk-write rework:

  - **#3151** `bulkWrite` validates that `writeBatch` returns one record per input
    row (a short/long/non-array return is degraded per-row, not backfilled as
    phantom success); `engine.insert(array)` likewise rejects a short driver
    `bulkCreate` return instead of padding afterInsert with `undefined`.
  - **#3150** wraps the two remaining un-retried write points (seed
    `writeRecord`/`resolveDeferredUpdates`, import's no-`createManyData`
    fallback) in `withTransientRetry`; `defaultIsTransientError` short-circuits
    definitive logical errors to non-transient.
  - **#3148** import `resolveRef` flushes pending creates on a same-object miss so
    a later row can reference an earlier same-file CREATE, and no longer
    negatively caches a miss.
  - **#3149** threads an `attempt` counter through `bulkWrite`; seed rechecks by
    `externalId` and import by `matchFields` before re-writing, so a
    commit-then-lost-response retry cannot duplicate a batch.
  - **#3147** `recomputeSummaries` retries transient failures and, on exhaustion,
    surfaces `SummaryRecomputeError` (`ERR_SUMMARY_RECOMPUTE`) instead of a
    silent warn; seed/import recover it to a warning without re-writing.
  - **#3152** autonumbers are assigned after validation, so a batch that dies in
    validation consumes no sequence value (no number-range gaps).

- a3823b2: Collapse the hook event taxonomy from 18 declared events to the 8 the engine actually dispatches (#3195). The removed 10 (`beforeFindOne`/`afterFindOne`, `beforeCount`/`afterCount`, `beforeAggregate`/`afterAggregate`, `beforeUpdateMany`/`afterUpdateMany`, `beforeDeleteMany`/`afterDeleteMany`) were declared in `HookEvent` but never fired — the enum mirrored the engine method table instead of domain events, so a hook subscribing to them registered fine and then silently no-op'd.

  - `findOne` now fires the same `beforeFind`/`afterFind` hooks as `find` — the read event attaches to record materialization, not the engine method, so one subscription covers every read shape (no separate `beforeFindOne`/`afterFindOne`).
  - Bulk (`multi: true`) updates/deletes already fire the singular `beforeUpdate`/`beforeDelete`/`afterUpdate`/`afterDelete` events with the row-scoping predicate in `ctx.input.ast`; this is now documented, and there is no `*Many` event.
  - Read authorization / row filtering is the RLS/permission-rule layer's job and field masking is field-level metadata — neither is a hook every author must re-attach.
  - `engine.registerHook` now warns when a hook subscribes to an event the engine never dispatches, so enum-vs-dispatch drift can't recur silently.

  No shipped hook or authored metadata used any of the removed events; authoring one now fails loudly at parse/validate time instead of registering a dead hook. Skills and docs updated to teach the 8 events and the declarative alternatives.

- fdc244e: Dev-loop DX fixes from the 15.1 third-party evaluation (P2 batch):

  - **Hot-added objects are now queryable without a restart.** Adding a `*.object.ts` under `os dev` used to recompile "green" while every query answered `no such table` (or `not registered`) until a manual restart: the artifact reload never notified the ObjectQL registry, tables were only created at boot, and seeds only loaded from the boot-time bundle. The `metadata:reloaded` payload now carries the parsed artifact; ObjectQL ingests the object definitions and re-runs the idempotent schema sync (same `skipSchemaSync` opt-out as boot), and the runtime loads seeds for first-seen objects (dev, single-tenant). `os dev` also prints `✚ new object(s): …` on recompile.
  - **Dev admin credentials stay visible.** The `os dev` startup banner only showed `admin@objectos.ai / admin123` on the boot that actually seeded it; with the persistent default DB every later boot hid it, and the Console login page never knew it existed. The hint now re-arms on every dev boot for as long as the account still verifies against the default password, and `GET /api/v1/auth/config` exposes a dev-gated `devSeedAdmin` field (never present outside `NODE_ENV=development`) so the login page can show it.
  - **`os doctor` reference analysis understands current metadata shapes.** Objects bound through `defineView` containers (`list`/`listViews`/`form`/`formViews` → `data.object`, subform `childObject`, lookup form fields) and app navigation (`objectName`, nested `children`, `areas`) were reported as "defined but not referenced". The collector now walks the canonical shapes (plus flow node `config.object`/`objectName`) and the orphan-view check descends into containers.

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

- d2723e2: **`MetadataManager.register()` / `unregister()` now announce to `subscribe()` watchers.** Both updated the registry, persisted to writable loaders and published to realtime, but never fired the watch callbacks — so `subscribe()` looked like it covered every write while silently missing all of them. Only the `saveMetaItem` path (via the repository watch stream) and the filesystem watcher ever reached a subscriber. Runtime consumers that cache metadata — notably ObjectQL's SchemaRegistry bridge, the component that decides what is queryable — went stale on every other write until the process restarted.

  Announcing is now the **default**, so a new call site is correct without knowing this contract exists. This is a contract fix rather than a bug fix: the one live behavior change is that runtime datasource writes (`datasource-admin`) now reach the HMR SSE stream, which subscribes to every registered type. `unregisterPackage()` / `bulkUnregister()` also announce their deletes now — correct, but latent, since neither has a production caller today.

  Bulk ingest opts out explicitly with the new `MetadataWriteOptions` (`{ notify: false }`) — boot-time filesystem priming, artifact ingest, and ObjectQL's registry bridge, each of which either runs before consumers cache anything or announces the whole batch once (as the artifact reload path does via `metadata:reloaded`). The bridge in particular MUST stay silent: it copies objects out of the SchemaRegistry, and announcing would feed them back through a handler that re-registers under `_packageId ?? 'metadata-service'`, overwriting the true package provenance of every object whose body carries no `_packageId`.

  Additive only — `register(type, name, data)` and `unregister(type, name)` keep working unchanged.

  Fixes #3112.

- 674457a: **Enforce per-option `visibleWhen` on `checkboxes` fields, and match option values by string form (objectui#2729).** Server-side per-option gating already covered `select` / `multiselect` / `radio`, but two holes let gated values through on write:

  - **`checkboxes` was not enforced.** `CHOICE_FIELD_TYPES` omitted `checkboxes`, so a gated `checkboxes` option (whose client widget cascades identically to `multiselect` since objectui#2715) was hidden in the UI but accepted from a crafted write. Added `checkboxes` to the enforced set — its picked values are now re-evaluated against each option's `visibleWhen` (record + `current_user`) on insert/update/bulk-update, element-wise, like `multiselect`.
  - **Numeric option values could slip the gate.** Option matching used strict `===`, but the enum-membership validator compares by `String(...)`. A numeric option value submitted as a string (a normal REST/JSON round-trip) passed the enum check yet missed its `visibleWhen` gate (fail-open). Matching now coerces both sides with `String(...)`, so the two validators agree on which option a written value denotes.

  Behavior for `select` / `multiselect` / `radio` is unchanged. Fail-open on unbound `current_user` / unevaluable predicates is preserved.

- 668dd17: **Breaking (npm type surface): retire the vestigial feed contracts + protocol surface (ADR-0052 §5 follow-up, #1959).**

  The `service-feed` runtime was deleted in #1955; `sys_comment` / `sys_activity`
  are the canonical record-collaboration/timeline backend. This removes the dead
  type surface that still pointed at the deleted runtime — every removed method was
  already unreachable (the feed REST route was never mounted → 404; the protocol
  implementation was never wired with a feed service, so `requireFeedService()`
  could only throw). No behavior changes.

  No authorable metadata key is removed (the `feeds:` object capability flag and
  the `RecordActivity` UI component config are unchanged), so `PROTOCOL_MAJOR`
  stays 15 and this ships as `minor` rather than a protocol major.

  FROM → TO migration for every removed export:

  - `@objectstack/spec/contracts` — `IFeedService`, `CreateFeedItemInput`,
    `UpdateFeedItemInput`, `ListFeedOptions`, `FeedListResult` → **removed, no
    replacement**. Comments/activity are plain records: write `sys_comment` / read
    `sys_activity` via the data engine or the REST data API.
  - `@objectstack/spec/api` — `FeedApiContracts`, `FeedApiErrorCode`,
    `FeedProtocol`, and all feed request/response schemas + types (`GetFeed*`,
    `CreateFeedItem*`, `UpdateFeedItem*`, `DeleteFeedItem*`, `AddReaction*`,
    `RemoveReaction*`, `PinFeedItem*`, `UnpinFeedItem*`, `StarFeedItem*`,
    `UnstarFeedItem*`, `SearchFeed*`, `GetChangelog*`, `ChangelogEntry`,
    `SubscribeRequest/Response`, `FeedUnsubscribeRequest`, `UnsubscribeResponse`,
    `FeedPathParams`, `FeedItemPathParams`, `FeedListFilterType`) → **removed**. Use
    the data API against `sys_comment` / `sys_activity` (`/api/v1/data/sys_comment/…`);
    reactions and threaded replies are fields on `sys_comment`.
  - `@objectstack/spec/data` — `FeedItemSchema`/`FeedItem`, `FeedActorSchema`/`FeedActor`,
    `MentionSchema`/`Mention`, `ReactionSchema`/`Reaction`,
    `FieldChangeEntrySchema`/`FieldChangeEntry`, `FeedVisibility`,
    `RecordSubscriptionSchema`/`RecordSubscription`, `SubscriptionEventType`, and the
    `data`-namespace `NotificationChannel` → **removed**. `FeedItemType` and
    `FeedFilterMode` are **kept** (live UI activity-timeline config). For notification
    channels use `NotificationChannelSchema` from `@objectstack/spec/system`.
  - `@objectstack/client` — `client.feed.*` (`list` / `create` / `update` / `delete` /
    `addReaction` / `removeReaction` / `pin` / `unpin` / `star` / `unstar` / `search` /
    `getChangelog` / `subscribe` / `unsubscribe`) and the re-exported feed response
    types → **removed**. One-line fix: use `client.data.*` on `sys_comment` /
    `sys_activity`, e.g. `client.data.create('sys_comment', { object, record_id, body })`
    and `client.data.find('sys_activity', { filters: [['record_id', '=', id]] })`.
  - `@objectstack/metadata-protocol` — `ObjectStackProtocolImplementation` no longer
    implements the 14 feed methods; its constructor
    `(engine, getServicesRegistry?, getFeedService?, environmentId?)` becomes
    `(engine, getServicesRegistry?, environmentId?)`. One-line fix: delete the third
    argument.

- 86d30af: fix(tenancy): platform-global (`tenancy.enabled:false`) objects are never driver-org-scoped (#3249)

  An org-context read of a platform-global object (e.g. `sys_license`, ADR-0066)
  could return 0 rows for an authenticated caller while an anonymous read saw the
  data: the engine stamped `execCtx.tenantId` into driver options unconditionally,
  and the SQL driver's tenant-field cache could be re-corrupted to
  `organization_id` by a partial re-registration (lifecycle archive `syncSchema`,
  schema-drift re-sync) whose schema omitted the `tenancy` block.

  - New `isTenancyDisabled(schema)` export from `@objectstack/spec/data` — the
    single source of truth for the ADR-0066 platform-global posture, now shared by
    the registry (tenant-column injection), the ObjectQL engine, and the SQL
    driver.
  - `ObjectQL.buildDriverOptions` no longer stamps `tenantId` for objects whose
    registered schema declares `tenancy.enabled: false` (an explicitly-passed
    options `tenantId` still wins — deliberate caller intent).
  - `SqlDriver` (and `SqliteWasmDriver`) now keep a sticky record of an explicit
    `tenancy.enabled:false` declaration: a later registration without a `tenancy`
    block preserves the opt-out instead of re-scoping via the implicit
    `organization_id` heuristic; a registration that carries a `tenancy`
    declaration stays authoritative.

- 2018df9: **Unify the developer-facing org identifier in JS hooks — `organizationId` is now the blessed name; `session.tenantId` becomes a deprecated alias (#3280).** The caller's active organization was surfaced to hook authors as `ctx.session.tenantId`, while everything else on the developer surface — the `organization_id` column, `current_user.organizationId` in RLS/sharing, and seed rows — already said `organization`. A hook author had to internalize the hidden equation `tenantId === organizationId` to move between surfaces. This is additive and non-breaking:

  - **`ctx.session.organizationId`** is added as the blessed name; **`ctx.session.tenantId`** still carries the identical value but is marked `@deprecated` in its TSDoc. Both come from the same resolved `ExecutionContext.tenantId` (which the kernel derives from `session.activeOrganizationId`).
  - **`ctx.user.organizationId`** is added to the ergonomic `user` shortcut, so a hook that needs "the current org to filter by" writes `ctx.user.organizationId` with zero relearning — matching `current_user.organizationId` (RLS) and the `organization_id` column. The engine now populates `ctx.user` (`{ id, email?, organizationId? }`) at every hook event that already carries a `session`; it stays `undefined` for system / unauthenticated writes.

  **No behavior change and no breaking rename.** The generic driver-layer tenancy abstraction (`ExecutionContext.tenantId`, `DriverOptions.tenantId`, `SqlDriver.applyTenantScope`, `TenancyConfig.tenantField`) is deliberately untouched — that layer's isolation column is configurable and legitimately carries an _environment_ id in per-environment (database-per-tenant) kernels. Hook-authoring docs now teach `organizationId` and distinguish the two isolation axes: **org row-scoping** (`organization_id`, shared DB) vs **environment / database-per-tenant** (`service-tenant`, `driver-turso`). Community edition never populates an org, so `organizationId` is `undefined` there.

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [7125007]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [83e8f7d]
- Updated dependencies [0e41302]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [b8a21ad]
- Updated dependencies [beaf2de]
- Updated dependencies [06cb319]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
- Updated dependencies [515f11a]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/metadata-protocol@16.0.0
  - @objectstack/formula@16.0.0
  - @objectstack/metadata-core@16.0.0
  - @objectstack/types@16.0.0

## 16.0.0-rc.1

### Patch Changes

- 674457a: **Enforce per-option `visibleWhen` on `checkboxes` fields, and match option values by string form (objectui#2729).** Server-side per-option gating already covered `select` / `multiselect` / `radio`, but two holes let gated values through on write:

  - **`checkboxes` was not enforced.** `CHOICE_FIELD_TYPES` omitted `checkboxes`, so a gated `checkboxes` option (whose client widget cascades identically to `multiselect` since objectui#2715) was hidden in the UI but accepted from a crafted write. Added `checkboxes` to the enforced set — its picked values are now re-evaluated against each option's `visibleWhen` (record + `current_user`) on insert/update/bulk-update, element-wise, like `multiselect`.
  - **Numeric option values could slip the gate.** Option matching used strict `===`, but the enum-membership validator compares by `String(...)`. A numeric option value submitted as a string (a normal REST/JSON round-trip) passed the enum check yet missed its `visibleWhen` gate (fail-open). Matching now coerces both sides with `String(...)`, so the two validators agree on which option a written value denotes.

  Behavior for `select` / `multiselect` / `radio` is unchanged. Fail-open on unbound `current_user` / unevaluable predicates is preserved.

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [7125007]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/metadata-protocol@16.0.0-rc.1
  - @objectstack/formula@16.0.0-rc.1
  - @objectstack/metadata-core@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Major Changes

- 6c270a6: **BREAKING: remove the deprecated `ctx.session.tenantId` / `ctx.user.tenantId` alias from the hook & action authoring surface — converge on `organizationId` (#3290).**

  #3280 made `organizationId` the blessed developer-facing name for the caller's active org across the JS authoring surface and kept `tenantId` as a `@deprecated` alias carrying the identical value. That alias is now **removed** from the hook `ctx.session`, the action-body `ctx.session`, and the action-body `ctx.user`. Read the caller's active org under the single blessed name:

  ```diff
  - const org = ctx.session.tenantId;   // hook or action body
  + const org = ctx.user?.organizationId ?? ctx.session?.organizationId;
  ```

  **FROM → TO migration** (in any `*.hook.ts` / `*.action.ts` body):

  - `ctx.session.tenantId` → `ctx.session.organizationId`
  - `ctx.user.tenantId` (action body) → `ctx.user.organizationId`

  The value is unchanged — `organizationId` is the same active-org id, matching the `organization_id` column and `current_user.organizationId` in RLS/sharing. `ctx.user` is `undefined` for system / unauthenticated writes, so read `ctx.session?.organizationId` when a hook or action must work regardless of a resolved user.

  What changed internally:

  - **`@objectstack/spec`** — `HookContextSchema.session` drops the `tenantId` field (only `organizationId` remains). A stray `tenantId` on a constructed session is now stripped by the schema.
  - **`@objectstack/objectql`** — the engine's `buildSession()` no longer emits `session.tenantId`; the audit-stamp plugin sources the `tenant_id` column from `session.organizationId`.
  - **`@objectstack/runtime`** — `buildActionSession()` and the REST action `ctx.user` no longer emit `tenantId`.
  - **`@objectstack/trigger-record-change`** — reads `session.organizationId` (was `session.tenantId`) when forwarding the writer's org to a `runAs:'user'` flow; behavior is identical.

  **Explicit non-goal (unchanged):** the generic **driver-layer** tenancy abstraction is _not_ touched — `ExecutionContext.tenantId`, `DriverOptions.tenantId`, `SqlDriver.applyTenantScope` / `TenancyConfig.tenantField`, and `ExecutionLog.tenantId`. That isolation column is configurable and legitimately carries an _environment_ id in database-per-tenant kernels; it is a distinct axis from the developer-facing org. The build-time `check:org-identifier` guard now also covers `packages/**` to keep reference bodies off the removed name.

### Minor Changes

- 22013aa: **Split the overloaded `managedBy: 'system'` bucket into engine-owned vs. admin-writable, and enforce engine-owned writes (ADR-0103, #3220).** The `system` bucket conflated two incompatible write policies: rows a platform service owns end to end (never user-written), and platform-defined schema whose rows are legitimately admin/user-writable. It carried the same all-false affordance row as `better-auth`/`append-only` but, unlike `better-auth`, had no engine enforcement — a wildcard admin could raw-write these rows through the generic data API (ADR-0049 gap).

  Rather than add a new `managedBy` enum value (which would fall through to fully-editable `platform` defaults on already-deployed Console clients), the write policy is now the **resolved affordance** (`resolveCrudAffordances` = bucket default + `userActions`), and _engine-owned_ is defined as a `system`/`append-only` object that grants no write:

  - **Writable set declares `userActions`** — the RBAC link tables (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`), `sys_user_preference`, `sys_approval_delegation`, and the messaging config grids (`sys_notification_preference` / `…_subscription` / `…_template`) now declare `userActions: { create, edit, delete: true }`. The affordance is a declaration only — the `DelegatedAdminGate` / RLS / permission sets remain the authz.
  - **Engine-owned objects locked to reads** — `apiMethods: ['get','list']` added where absent (jobs, notifications, approval request/approver/token/action, `sys_record_share`, `sys_automation_run`, mail/settings/secret audit, the messaging delivery pipeline). `sys_secret` is explicitly read-locked (an empty `apiMethods` array fails open).
  - **`sys_import_job`** stays engine-owned: the REST import route now writes its job rows `isSystem`-elevated (attribution preserved via the explicit `created_by` stamp) and the object is locked to `['get','list']`.
  - **New engine write guard** (`assertEngineOwnedWriteAllowed`, plugin-security) fail-closed rejects user-context generic writes to engine-owned `system`/`append-only` objects, keyed off the resolved affordance; `isSystem` and context-less engine/service writes bypass by construction. Wired into the security middleware alongside the other data-layer gates.
  - **`reconcileManagedApiMethods`** (objectql registry) now runs for **every** managed bucket, not just `better-auth`: any advertised write verb an object's resolved affordances forbid is stripped at registration with a warning (the drift backstop, ADR-0049).
  - **`/me/permissions` clamp** (plugin-hono-server) now clamps `system`/`append-only` as well as `better-auth`, so the client hint reflects `permission ∩ guard`.

  **Potentially breaking:** a downstream/third-party `system` object that advertised generic write verbs relying on today's fail-open behaviour will have those verbs stripped (with a warning) and user-context generic writes to it rejected. Declare `userActions` opening the verbs the object legitimately takes from a user context. `better-auth` keeps plugin-auth's identity write guard unchanged; the row-level `managed_by` provenance vocabulary (ADR-0066) is a different axis and is untouched.

- 04ecd4e: feat(validation): `state_machine.initialStates` enforces the FSM entry point on INSERT (#3165)

  A `state_machine` rule's `transitions` only governs UPDATE — on INSERT the rule
  was a no-op, and a `select` field permits ANY declared option as the initial
  value. So a record could be born mid-flow (created already `approved`), skipping
  the whole state machine. This was the gap #3043's mitigation idea assumed didn't
  exist (declared ≠ enforced, ADR-0049).

  `state_machine` rules gain an optional `initialStates: string[]` — the states a
  record may be CREATED in. When set, an insert whose (defaulted) state-field value
  is outside the list is rejected server-side with `code: 'invalid_initial_state'`.
  Omit it to keep the legacy behavior (no initial-state check on insert). A missing
  / empty value is left to required-validation; `transitions` (UPDATE) is
  unaffected. Enforced at the same `evaluateValidationRules(..., 'insert')` seam the
  engine already runs after field defaults.

- 4d5a892: feat(objectql): roll-up `summary` fields can filter which child rows they aggregate (#1868)

  `summaryOperations` gains an optional `filter` — a query `where` FilterCondition
  evaluated against each child row, so a summary aggregates only the matching
  children instead of the whole collection. This is what lets a single child object
  feed several distinct parent totals, which the cross-object rollup templates need:

  ```typescript
  // One `engagement` child → distinct filtered totals.
  total_signups: {
    type: 'summary',
    summaryOperations: { object: 'engagement', field: 'id', function: 'count', filter: { type: 'signup' } },
  }
  // Sum only received receipt lines (3-way match).
  received_amount: {
    type: 'summary',
    summaryOperations: { object: 'procurement_receipt', field: 'amount', function: 'sum', filter: { status: 'received' } },
  }
  ```

  The engine ANDs the predicate with the parent-FK match when it recomputes, and
  because the whole filtered aggregate is re-run on every child write, a child that
  moves in or out of the predicate (e.g. a status change) keeps the parent current
  with no extra wiring. Operator and compound forms work too
  (`filter: { type: { $in: ['signup', 'trial'] }, amount: { $gte: 100 } }`).

  Purely additive: omitting `filter` aggregates every child exactly as before.

### Patch Changes

- a8aa34c: Enforce validation rules, `requiredWhen`, and per-option `visibleWhen` on multi-row updates (#3106). The bulk branch of `engine.update` (`options.multi` → `driver.updateMany`) previously never called `evaluateValidationRules`, so every object-level rule (`script`, `state_machine`, `format`, `cross_field`, `json_schema`, `conditional`), field-level `requiredWhen`, and per-option `visibleWhen` check was a silent no-op there. The engine now reads the row-scoped match set (the same AST the write binds, one query shared with the `readonlyWhen` bulk strip) and evaluates the payload against each matched row's prior state; any error-severity violation rejects the whole batch with `ValidationError` (annotated with the failing record id) before anything is written. Schemas needing no prior state (`format`/`json_schema`-only) are evaluated once against the payload with no fetch, and rule-free schemas are unaffected. Behavior change: bulk writes that previously slipped past declared rules now throw. Doc comments in `rule-validator.ts` and `validation.zod.ts` no longer overstate coverage and name the remaining `events: ['delete']` gap (tracked separately).
- e057f42: fix: harden the bulk-write path — retries, idempotency, contracts, and summary visibility (#3147–#3152)

  Six reliability fixes to the batched seed/import + `engine.insert(array)` path
  introduced by the #2678 bulk-write rework:

  - **#3151** `bulkWrite` validates that `writeBatch` returns one record per input
    row (a short/long/non-array return is degraded per-row, not backfilled as
    phantom success); `engine.insert(array)` likewise rejects a short driver
    `bulkCreate` return instead of padding afterInsert with `undefined`.
  - **#3150** wraps the two remaining un-retried write points (seed
    `writeRecord`/`resolveDeferredUpdates`, import's no-`createManyData`
    fallback) in `withTransientRetry`; `defaultIsTransientError` short-circuits
    definitive logical errors to non-transient.
  - **#3148** import `resolveRef` flushes pending creates on a same-object miss so
    a later row can reference an earlier same-file CREATE, and no longer
    negatively caches a miss.
  - **#3149** threads an `attempt` counter through `bulkWrite`; seed rechecks by
    `externalId` and import by `matchFields` before re-writing, so a
    commit-then-lost-response retry cannot duplicate a batch.
  - **#3147** `recomputeSummaries` retries transient failures and, on exhaustion,
    surfaces `SummaryRecomputeError` (`ERR_SUMMARY_RECOMPUTE`) instead of a
    silent warn; seed/import recover it to a warning without re-writing.
  - **#3152** autonumbers are assigned after validation, so a batch that dies in
    validation consumes no sequence value (no number-range gaps).

- a3823b2: Collapse the hook event taxonomy from 18 declared events to the 8 the engine actually dispatches (#3195). The removed 10 (`beforeFindOne`/`afterFindOne`, `beforeCount`/`afterCount`, `beforeAggregate`/`afterAggregate`, `beforeUpdateMany`/`afterUpdateMany`, `beforeDeleteMany`/`afterDeleteMany`) were declared in `HookEvent` but never fired — the enum mirrored the engine method table instead of domain events, so a hook subscribing to them registered fine and then silently no-op'd.

  - `findOne` now fires the same `beforeFind`/`afterFind` hooks as `find` — the read event attaches to record materialization, not the engine method, so one subscription covers every read shape (no separate `beforeFindOne`/`afterFindOne`).
  - Bulk (`multi: true`) updates/deletes already fire the singular `beforeUpdate`/`beforeDelete`/`afterUpdate`/`afterDelete` events with the row-scoping predicate in `ctx.input.ast`; this is now documented, and there is no `*Many` event.
  - Read authorization / row filtering is the RLS/permission-rule layer's job and field masking is field-level metadata — neither is a hook every author must re-attach.
  - `engine.registerHook` now warns when a hook subscribes to an event the engine never dispatches, so enum-vs-dispatch drift can't recur silently.

  No shipped hook or authored metadata used any of the removed events; authoring one now fails loudly at parse/validate time instead of registering a dead hook. Skills and docs updated to teach the 8 events and the declarative alternatives.

- fdc244e: Dev-loop DX fixes from the 15.1 third-party evaluation (P2 batch):

  - **Hot-added objects are now queryable without a restart.** Adding a `*.object.ts` under `os dev` used to recompile "green" while every query answered `no such table` (or `not registered`) until a manual restart: the artifact reload never notified the ObjectQL registry, tables were only created at boot, and seeds only loaded from the boot-time bundle. The `metadata:reloaded` payload now carries the parsed artifact; ObjectQL ingests the object definitions and re-runs the idempotent schema sync (same `skipSchemaSync` opt-out as boot), and the runtime loads seeds for first-seen objects (dev, single-tenant). `os dev` also prints `✚ new object(s): …` on recompile.
  - **Dev admin credentials stay visible.** The `os dev` startup banner only showed `admin@objectos.ai / admin123` on the boot that actually seeded it; with the persistent default DB every later boot hid it, and the Console login page never knew it existed. The hint now re-arms on every dev boot for as long as the account still verifies against the default password, and `GET /api/v1/auth/config` exposes a dev-gated `devSeedAdmin` field (never present outside `NODE_ENV=development`) so the login page can show it.
  - **`os doctor` reference analysis understands current metadata shapes.** Objects bound through `defineView` containers (`list`/`listViews`/`form`/`formViews` → `data.object`, subform `childObject`, lookup form fields) and app navigation (`objectName`, nested `children`, `areas`) were reported as "defined but not referenced". The collector now walks the canonical shapes (plus flow node `config.object`/`objectName`) and the orphan-view check descends into containers.

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

- d2723e2: **`MetadataManager.register()` / `unregister()` now announce to `subscribe()` watchers.** Both updated the registry, persisted to writable loaders and published to realtime, but never fired the watch callbacks — so `subscribe()` looked like it covered every write while silently missing all of them. Only the `saveMetaItem` path (via the repository watch stream) and the filesystem watcher ever reached a subscriber. Runtime consumers that cache metadata — notably ObjectQL's SchemaRegistry bridge, the component that decides what is queryable — went stale on every other write until the process restarted.

  Announcing is now the **default**, so a new call site is correct without knowing this contract exists. This is a contract fix rather than a bug fix: the one live behavior change is that runtime datasource writes (`datasource-admin`) now reach the HMR SSE stream, which subscribes to every registered type. `unregisterPackage()` / `bulkUnregister()` also announce their deletes now — correct, but latent, since neither has a production caller today.

  Bulk ingest opts out explicitly with the new `MetadataWriteOptions` (`{ notify: false }`) — boot-time filesystem priming, artifact ingest, and ObjectQL's registry bridge, each of which either runs before consumers cache anything or announces the whole batch once (as the artifact reload path does via `metadata:reloaded`). The bridge in particular MUST stay silent: it copies objects out of the SchemaRegistry, and announcing would feed them back through a handler that re-registers under `_packageId ?? 'metadata-service'`, overwriting the true package provenance of every object whose body carries no `_packageId`.

  Additive only — `register(type, name, data)` and `unregister(type, name)` keep working unchanged.

  Fixes #3112.

- 668dd17: **Breaking (npm type surface): retire the vestigial feed contracts + protocol surface (ADR-0052 §5 follow-up, #1959).**

  The `service-feed` runtime was deleted in #1955; `sys_comment` / `sys_activity`
  are the canonical record-collaboration/timeline backend. This removes the dead
  type surface that still pointed at the deleted runtime — every removed method was
  already unreachable (the feed REST route was never mounted → 404; the protocol
  implementation was never wired with a feed service, so `requireFeedService()`
  could only throw). No behavior changes.

  No authorable metadata key is removed (the `feeds:` object capability flag and
  the `RecordActivity` UI component config are unchanged), so `PROTOCOL_MAJOR`
  stays 15 and this ships as `minor` rather than a protocol major.

  FROM → TO migration for every removed export:

  - `@objectstack/spec/contracts` — `IFeedService`, `CreateFeedItemInput`,
    `UpdateFeedItemInput`, `ListFeedOptions`, `FeedListResult` → **removed, no
    replacement**. Comments/activity are plain records: write `sys_comment` / read
    `sys_activity` via the data engine or the REST data API.
  - `@objectstack/spec/api` — `FeedApiContracts`, `FeedApiErrorCode`,
    `FeedProtocol`, and all feed request/response schemas + types (`GetFeed*`,
    `CreateFeedItem*`, `UpdateFeedItem*`, `DeleteFeedItem*`, `AddReaction*`,
    `RemoveReaction*`, `PinFeedItem*`, `UnpinFeedItem*`, `StarFeedItem*`,
    `UnstarFeedItem*`, `SearchFeed*`, `GetChangelog*`, `ChangelogEntry`,
    `SubscribeRequest/Response`, `FeedUnsubscribeRequest`, `UnsubscribeResponse`,
    `FeedPathParams`, `FeedItemPathParams`, `FeedListFilterType`) → **removed**. Use
    the data API against `sys_comment` / `sys_activity` (`/api/v1/data/sys_comment/…`);
    reactions and threaded replies are fields on `sys_comment`.
  - `@objectstack/spec/data` — `FeedItemSchema`/`FeedItem`, `FeedActorSchema`/`FeedActor`,
    `MentionSchema`/`Mention`, `ReactionSchema`/`Reaction`,
    `FieldChangeEntrySchema`/`FieldChangeEntry`, `FeedVisibility`,
    `RecordSubscriptionSchema`/`RecordSubscription`, `SubscriptionEventType`, and the
    `data`-namespace `NotificationChannel` → **removed**. `FeedItemType` and
    `FeedFilterMode` are **kept** (live UI activity-timeline config). For notification
    channels use `NotificationChannelSchema` from `@objectstack/spec/system`.
  - `@objectstack/client` — `client.feed.*` (`list` / `create` / `update` / `delete` /
    `addReaction` / `removeReaction` / `pin` / `unpin` / `star` / `unstar` / `search` /
    `getChangelog` / `subscribe` / `unsubscribe`) and the re-exported feed response
    types → **removed**. One-line fix: use `client.data.*` on `sys_comment` /
    `sys_activity`, e.g. `client.data.create('sys_comment', { object, record_id, body })`
    and `client.data.find('sys_activity', { filters: [['record_id', '=', id]] })`.
  - `@objectstack/metadata-protocol` — `ObjectStackProtocolImplementation` no longer
    implements the 14 feed methods; its constructor
    `(engine, getServicesRegistry?, getFeedService?, environmentId?)` becomes
    `(engine, getServicesRegistry?, environmentId?)`. One-line fix: delete the third
    argument.

- 86d30af: fix(tenancy): platform-global (`tenancy.enabled:false`) objects are never driver-org-scoped (#3249)

  An org-context read of a platform-global object (e.g. `sys_license`, ADR-0066)
  could return 0 rows for an authenticated caller while an anonymous read saw the
  data: the engine stamped `execCtx.tenantId` into driver options unconditionally,
  and the SQL driver's tenant-field cache could be re-corrupted to
  `organization_id` by a partial re-registration (lifecycle archive `syncSchema`,
  schema-drift re-sync) whose schema omitted the `tenancy` block.

  - New `isTenancyDisabled(schema)` export from `@objectstack/spec/data` — the
    single source of truth for the ADR-0066 platform-global posture, now shared by
    the registry (tenant-column injection), the ObjectQL engine, and the SQL
    driver.
  - `ObjectQL.buildDriverOptions` no longer stamps `tenantId` for objects whose
    registered schema declares `tenancy.enabled: false` (an explicitly-passed
    options `tenantId` still wins — deliberate caller intent).
  - `SqlDriver` (and `SqliteWasmDriver`) now keep a sticky record of an explicit
    `tenancy.enabled:false` declaration: a later registration without a `tenancy`
    block preserves the opt-out instead of re-scoping via the implicit
    `organization_id` heuristic; a registration that carries a `tenancy`
    declaration stays authoritative.

- 2018df9: **Unify the developer-facing org identifier in JS hooks — `organizationId` is now the blessed name; `session.tenantId` becomes a deprecated alias (#3280).** The caller's active organization was surfaced to hook authors as `ctx.session.tenantId`, while everything else on the developer surface — the `organization_id` column, `current_user.organizationId` in RLS/sharing, and seed rows — already said `organization`. A hook author had to internalize the hidden equation `tenantId === organizationId` to move between surfaces. This is additive and non-breaking:

  - **`ctx.session.organizationId`** is added as the blessed name; **`ctx.session.tenantId`** still carries the identical value but is marked `@deprecated` in its TSDoc. Both come from the same resolved `ExecutionContext.tenantId` (which the kernel derives from `session.activeOrganizationId`).
  - **`ctx.user.organizationId`** is added to the ergonomic `user` shortcut, so a hook that needs "the current org to filter by" writes `ctx.user.organizationId` with zero relearning — matching `current_user.organizationId` (RLS) and the `organization_id` column. The engine now populates `ctx.user` (`{ id, email?, organizationId? }`) at every hook event that already carries a `session`; it stays `undefined` for system / unauthenticated writes.

  **No behavior change and no breaking rename.** The generic driver-layer tenancy abstraction (`ExecutionContext.tenantId`, `DriverOptions.tenantId`, `SqlDriver.applyTenantScope`, `TenancyConfig.tenantField`) is deliberately untouched — that layer's isolation column is configurable and legitimately carries an _environment_ id in per-environment (database-per-tenant) kernels. Hook-authoring docs now teach `organizationId` and distinguish the two isolation axes: **org row-scoping** (`organization_id`, shared DB) vs **environment / database-per-tenant** (`service-tenant`, `driver-turso`). Community edition never populates an org, so `organizationId` is `undefined` there.

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [83e8f7d]
- Updated dependencies [0e41302]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [b8a21ad]
- Updated dependencies [beaf2de]
- Updated dependencies [06cb319]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
- Updated dependencies [515f11a]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/metadata-protocol@16.0.0-rc.0
  - @objectstack/formula@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0
  - @objectstack/metadata-core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/types@15.1.1
- @objectstack/metadata-core@15.1.1
- @objectstack/metadata-protocol@15.1.1
- @objectstack/formula@15.1.1

## 15.1.0

### Minor Changes

- f531a26: feat(attachments): sys_file orphan lifecycle + parent-derived attachment access (#2755)

  **Orphan lifecycle (ADR-0057).** Deleting a `sys_attachment` join row used to
  orphan the backing `sys_file` row and its storage bytes forever. `sys_file`
  now declares a lifecycle (`ttl 30d` on a new `deleted_at` tombstone for
  orphans; `retention 7d onlyWhen status=pending` for abandoned uploads), the
  storage plugin's new hooks tombstone a file when its LAST join row is deleted
  (attachments scope only — `Field.file`/`Field.image`/avatar scopes are never
  touched) and un-tombstone on re-attach, and a new LifecycleService **reap
  guard** seam (`registerReapGuard`) re-verifies zero references at sweep time
  and deletes the storage bytes before confirming each row reap. A guarded
  object is never blind-deleted; an erroring guard fails safe (rows retained).

  **Attachment access (ADR-0049, Salesforce parent-derived semantics).**
  `sys_attachment` create now requires caller READ visibility of the parent
  record (403 `ATTACHMENT_PARENT_ACCESS`) and server-stamps `uploaded_by` from
  the session (client value ignored); delete requires uploader-or-parent-editor
  (403 `ATTACHMENT_DELETE_DENIED`). The storage upload routes require an
  authenticated session when an auth service is wired (401 `AUTH_REQUIRED`;
  bare kernels stay open) and stamp `owner_id` on new files.

  **REMOVED — `sys_attachment.share_type` / `sys_attachment.visibility`.**
  Both fields were modeled in v1 with zero runtime consumers (ADR-0049
  parsed-but-unenforced). There is no replacement key: attachment access is
  derived from the parent record by the hooks above. Writers of these fields
  should simply stop sending them (unknown-field validation will reject them);
  existing DB columns are left as unmanaged leftovers, no migration needed.

  `@objectstack/verify` gains `BootOptions.extraPlugins` for booting optional
  service pairs (e.g. storage + audit) in dogfood fixtures.

- f531a26: fix(security): enforce static `readonly` fields on the UPDATE write path (#2948)

  A field's static `readonly: true` was never enforced server-side on update: the
  record validator only _skipped_ read-only columns from validation, and only the
  conditional `readonlyWhen` variant was stripped from the write payload. A
  non-system (user-context) update could therefore overwrite any `readonly`
  column — audit stamps, provenance (`managed_by`), or other system-computed
  values — unless a field-level permission happened to guard it. (The
  cross-tenant `organization_id` face was already closed by #2946; this is the
  broader in-tenant integrity face.)

  `engine.update` now strips **caller-supplied** writes to statically-`readonly`
  fields for non-system contexts, on both the single-id and multi-row paths
  (symmetric with `readonlyWhen` — it strips, does not reject). Two guards keep
  every legitimate write intact:

  - **caller-supplied only** — the strip runs against a snapshot of the keys the
    caller sent _before_ hooks/middleware ran, so server stamps applied by the
    audit hook (`updated_by`/`updated_at`) and write middleware survive; only a
    client that explicitly forged a read-only field has it dropped.
  - **system-context exempt** — `isSystem` writes (import, seed replay, approvals,
    lifecycle hooks) legitimately set read-only columns and skip the strip.

  No change for single-org or any write that does not forge a read-only column.

- f531a26: Generic pinyin search recall (#2486, ADR-0098): a locale-gated
  `OS_SEARCH_PINYIN_ENABLED` switch (auto-on when the stack configures any
  `zh-*` locale) provisions a hidden `__search` companion column for each
  object's display/name field at compile time, the new
  `@objectstack/plugin-pinyin-search` fills it with full pinyin + initials
  ("张伟" → "zhangwei zw") on before-save (plus boot backfill and a
  `rebuildSearchCompanion` reconcile entry), and `$search` ORs the column in at
  query time — so lookup pickers, list quick-search and ⌘K transparently match
  `zhangwei` / `zw` against CJK names. Purely additive: `resolveSearchFields`,
  `searchableFields`, drivers and non-Chinese deployments are untouched; FLS
  restricted / secret / PII fields never feed the companion.
- d75c7ac: Package-draft publishing is now turn-atomic (ADR-0067 Decision-2, #3066). `publishPackageDrafts` runs every draft promotion AND the `sys_metadata_commit` record inside ONE engine transaction — a mid-batch failure rolls back the whole batch (`publishedCount: 0`; the causal item carries its real error, the rest report `batch_aborted`). Side effects (registry refresh, table DDL, seed apply, materializers, ADR-0094 projections, events) run after the metadata commits and are surfaced-not-swallowed on failure. `@objectstack/objectql`'s `engine.transaction()` now JOINS an already-open ambient transaction instead of opening a nested driver transaction (deadlock on single-connection pools; escaped the outer rollback). BREAKING (behavioral): API consumers that relied on partial batch publishes ("2 of 3 landed") now get all-or-nothing; engines without `transaction()` (memory driver, minimal stubs) keep the previous sequential behavior.

### Patch Changes

- f531a26: feat(discovery): honest capabilities — standardized stub/fallback marker + realtime route honesty (ADR-0076 D12/A1.5 framework slice, #2462)

  **Spec** — new service self-description marker for honest discovery
  (ADR-0076 D12): `SERVICE_SELF_INFO_KEY` (`__serviceInfo`),
  `ServiceSelfInfoSchema` / `ServiceSelfInfo`, and `readServiceSelfInfo()`,
  which also normalizes plugin-dev's legacy `_dev: true` flag to
  `{ status: 'stub', handlerReady: false }`. A registered service that is a
  stub / dev fake / degraded fallback self-identifies via this marker; a fully
  real service carries no marker.

  **Runtime + metadata-protocol** — both discovery builders
  (`HttpDispatcher.getDiscoveryInfo` and the protocol shim's `getDiscovery`)
  now honor the marker instead of hardcoding `status: 'available',
handlerReady: true` for every registered service. Dev stubs report `stub`,
  the ObjectQL analytics fallback reports `degraded` (it keeps serving — no
  `/analytics` 404), and consumers can finally trust
  `status === 'available'` / `handlerReady === true`.

  **Realtime honesty fix** — discovery no longer advertises a
  `/realtime` route or `websockets: true`: `service-realtime` is an
  in-process pub/sub bus, no dispatcher branch or plugin mounts any
  `/realtime` HTTP surface, so the advertised route always 404'd. The
  registered service now reports `status: 'degraded', handlerReady: false`
  with no route (clients using the SDK are unaffected — it falls back to the
  conventional path, which behaves exactly as before). Also corrects the
  advertised realtime provider from the nonexistent `plugin-realtime` to
  `service-realtime`.

  **REST (A1.5)** — the REST layer's protocol dependency is narrowed from the
  `ObjectStackProtocol` god-union to the new `RestProtocol =
DataProtocol & MetadataProtocol` slice (exported from
  `@objectstack/rest`), per the ADR-0076 D9 incremental narrowing guidance.
  Type-level only; no runtime change.

- f531a26: fix(security): enforce `readonlyWhen` on the multi-row UPDATE path (#3042)

  Conditional `readonlyWhen` field locks were stripped only on the single-id
  UPDATE path; the bulk `update({ multi: true, where })` path enforced static
  `readonly` (#2948) but never `readonlyWhen`. A programmatic/embedded caller (or
  a plugin) issuing a multi-row update in a user context could therefore write a
  field its own `readonlyWhen` predicate should have locked — the conditional
  lock held for a `PATCH /data/:object/:id` but not for a bulk where-predicate
  update. (The external REST/SDK `updateMany` endpoint was unaffected: it loops
  single-id `engine.update` calls, which already strip `readonlyWhen`.)

  `engine.update` now, on the multi-row path and only when the payload actually
  writes a `readonlyWhen` field, reads the row-scoped match set with the same
  composed AST the write binds (one query) and drops any field whose predicate is
  TRUE for at least one matched row — a single bulk payload cannot keep a field
  for some rows and drop it for others, so a field locked in any target row is
  fail-safe-dropped for the batch (narrow the `where` to reach the rows where it
  is unlocked). A conditional field NO matched row locks is written normally, so a
  legitimate bulk edit is unaffected. Symmetric with the single-id
  `stripReadonlyWhenFields` and with the static-`readonly` bulk strip; INSERT
  stays exempt. No change for any single-id update or any object without
  `readonlyWhen` fields.

- f531a26: fix(security): exempt engine referential FK clears from the owner_id transfer guard (#3023)

  Follow-up to the #3004 ownership-anchor guard. `owner_id` is a lookup to `sys_user`
  with the default `deleteBehavior: 'set_null'`, so deleting a `sys_user` makes
  `cascadeDeleteRelations` null `owner_id` on every dependent row. That cascade write
  re-entered the write middleware under the deleter's context, where the #3004 guard
  read the `owner_id = null` as a user-initiated disown and denied it — aborting the
  cascade mid-way (no transaction, so partial state) for any deleter without the
  transfer grant on the child object (e.g. a member clearing a `public_read_write`
  child that RLS would otherwise have allowed).

  The cascade FK clear is engine-mandated referential integrity consequent to an
  already-authorized parent delete, not a user ownership change. `cascadeDeleteRelations`
  now tags the `set_null` write with a server-derived `__referentialFieldClear` context
  marker (set by the engine, never built from a request — same trust model as
  `__expandRead`), and the ownership-anchor guard skips when that marker is present.
  Ordinary user writes are unaffected; the marker cannot be forged from client input,
  so it can never slip a real ownership transfer past the guard.

- f531a26: fix(security): guard the `owner_id` ownership anchor and scope bulk writes to owner-visible rows (#3004, #2982)

  Two write-path holes on the row-ownership anchor (`owner_id`), the column OWD
  row-level scoping keys off to decide who may update/delete a record.

  - **#3004 — client-writable, unguarded `owner_id`.** The anchor is deliberately
    not `readonly` (ownership is transferable), so the static-readonly strip never
    covered it and FLS doesn't gate it by default. A non-privileged writer could
    therefore `insert` a record under someone else's name (forge) or `update` one
    to a new owner (transfer / disown), evading the owner gate that governs
    update/delete. The security middleware (plugin-security step 3.5) now treats
    `owner_id` as system-managed for non-privileged writers: on insert an empty
    value is auto-stamped to the acting user (batch rows too — previously only the
    single-record path stamped, leaving bulk-inserted rows NULL-owned and
    invisible to their creator), and a supplied foreign owner is denied; on update
    a supplied `owner_id` is a transfer/disown and is denied — the unchanged no-op
    echo of a form save is tolerated via a pre-image compare, and a bulk
    change-set carrying `owner_id` fails closed. A non-scalar `owner_id`
    (array/object) is rejected outright rather than string-coerced, and the
    change-set membership test uses own-property semantics so a polluted
    prototype cannot spoof an ownership write. Both require the transfer grant
    (`allowTransfer`, or `modifyAllRecords` which implies it) to proceed. System
    context (`ctx.isSystem`) stays fully exempt (OAuth provisioning / cron
    snapshots / seed claims / migrations), and under delegation both principals
    must hold the grant (ADR-0090 D10 intersection). Note a REST **import** runs
    under the importer's own context (not `isSystem`), so a non-privileged user
    importing a CSV whose `owner_id` column names other users is correctly denied
    unless they hold the transfer grant — administrators (who carry
    `modifyAllRecords`) are unaffected.

  - **#2982 — bulk writes skipped owner scoping on OWD-`private` objects.** A
    `update({ multi: true })` / bulk delete rebuilt the driver AST from
    `options.where` AFTER the middleware chain, discarding the owner/RLS write
    filter that plugin-sharing (`buildWriteFilter`) and plugin-security compose
    onto `opCtx.ast` — so a member's bulk write hit every matching row, including
    peers'. The engine now seeds `opCtx.ast` from the caller's predicate BEFORE the
    chain (the same seam reads use) and hands the middleware-composed AST to
    `driver.updateMany` / `driver.deleteMany`, so bulk writes are constrained to the
    rows the caller may edit — matching single-id write behavior. `delete` now
    applies the same scalar-`id` guard `update` already had, so an id-list bulk
    delete (`where: { id: { $in: […] } }, multi: true`) is owner-scoped too, and
    both multi branches fail CLOSED (throw) rather than silently rebuilding an
    unscoped predicate if the row-scoping AST is ever absent.

    Consequences of routing bulk writes through the AST: the anti-oracle
    predicate guard now also applies to bulk `update`/`delete` (a bulk write
    filtering on an FLS-unreadable field is rejected, as reads already are), and a
    principal-less (no-`userId`, non-system) bulk write on an owner-scoped object
    now correctly affects zero rows instead of all of them.

  Proven end-to-end on the real showcase app
  (`packages/qa/dogfood/test/owner-anchor-and-bulk-writes.dogfood.test.ts`) and pinned
  in the ADR-0096 authz-conformance ledger (`ownership-anchor-guard`,
  `bulk-write-owner-scoping`).

- f531a26: fix(security): enforce referenced-object RLS/FLS on $expand (#2850)

  `expandRelatedRecords` resolved lookup/master_detail/user references via the
  driver directly, so the referenced object's row- and field-level security never
  ran — any API/session caller who could read a base row could `?expand=` a
  foreign key and receive RLS-hidden rows and FLS-masked fields (tenant isolation
  was the only surviving boundary).

  The expand batch now routes through the engine's own `find`, so the security
  middleware applies the referenced object's RLS + FLS to the `id $in [...]` batch
  (one query per level, no N+1). The sub-read carries a server-set `__expandRead`
  marker: the middleware waives only the object-level CRUD / requiredPermissions
  gate for PUBLIC referenced objects (already broadly readable — avoids
  over-blocking common status/owner lookups), while PRIVATE referenced objects
  keep the full gate. Covers the list and single-record REST/protocol surfaces.

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
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [d75c7ac]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/metadata-protocol@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0
  - @objectstack/formula@15.1.0
  - @objectstack/metadata-core@15.1.0

## 15.0.0

### Patch Changes

- 31d04d4: Fix the data-import automation chain (#2922). Batch `engine.insert` now fires
  `beforeInsert`/`afterInsert` once **per row** with single-record hook contexts,
  so flat-input proxies, declarative hook conditions, audit writers, and
  record-change triggers see real records instead of arrays. A new
  `ExecutionContext.skipAutomations` flag (mirrored into `HookContext.session`)
  lets callers suppress metadata-bound automation hooks and flow dispatch while
  code-registered system hooks (audit, security, sharing) still run — making the
  import wizard's "run automations & triggers" checkbox and import undo actually
  effective. The REST import default flips to running automations unless the
  request explicitly opts out (`runAutomations: false`), matching historical
  behavior.
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/formula@15.0.0
  - @objectstack/metadata-core@15.0.0
  - @objectstack/metadata-protocol@15.0.0
  - @objectstack/types@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [1dede32]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/metadata-protocol@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/formula@14.8.0
  - @objectstack/metadata-core@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/formula@14.7.0
  - @objectstack/metadata-core@14.7.0
  - @objectstack/metadata-protocol@14.7.0

## 14.6.0

### Patch Changes

- 8f4a261: fix(objectql): apply field `defaultValue` when a field is explicitly `null` on insert, not only when omitted (#2706)

  `applyFieldDefaults` previously skipped any field whose value was not
  `undefined`, so a form that serialized an unpicked control as `null` (rather
  than omitting it) fell through and stored `null` — the `current_user` token and
  static defaults never filled in. Both an omitted field and an explicit `null`
  now count as "no value supplied" and receive the default. This runs on the
  insert path only, so a deliberate "set to null" on update is untouched; an
  explicit empty string `''` is still respected as a real value.

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/formula@14.6.0
  - @objectstack/metadata-core@14.6.0
  - @objectstack/metadata-protocol@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Minor Changes

- 33ebd34: ADR-0057 (#2834): `retention.onlyWhen` status predicate — mixed tables can scope the age reap.

  - **spec**: `lifecycle.retention.onlyWhen` — a row filter (per-field equality or `{ $in: [...] }`) the retention window applies to; rows outside it are retained regardless of age. Rejected when combined with rotation `storage` (shard DROPs ignore filters) or `archive` (the Archiver moves rows by age alone).
  - **objectql**: the LifecycleService Reaper merges `onlyWhen` into every retention delete, including tenant-override passes.
  - **service-automation**: the run-history age sweep is now declarative — `sys_automation_run` declares `retention: { maxAge: '30d', onlyWhen: { status: { $in: ['completed', 'failed'] } } }` and the platform Reaper owns it; suspended (`paused`) runs never match. The plugin's own sweep loop is retired: `ObjectStoreSuspendedRunStore.pruneHistory`, the `DEFAULT_RUN_HISTORY_RETENTION_DAYS` export, and the `runHistoryRetentionDays` / `runHistorySweepMs` plugin options are removed (launch-window breaking-as-minor). The write-time per-flow overflow cap (`runHistoryMaxPerFlow`) stays.

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/formula@14.5.0
  - @objectstack/metadata-core@14.5.0
  - @objectstack/metadata-protocol@14.5.0
  - @objectstack/types@14.5.0

## 14.4.0

### Minor Changes

- 7953832: ADR-0057 data lifecycle P1–P4 (#2786): platform-generated data is now bounded by construction.

  - **P1 — contract**: new `lifecycle` object property (`class: record | audit | telemetry | transient | event` + `retention` / `ttl` / `storage(rotation)` / `archive` / `reclaim`), enforced by the platform-owned **LifecycleService** registered by `ObjectQLPlugin` (default-on; disable via `OS_LIFECYCLE_DISABLED=1` or plugin `lifecycle.enabled=false`). The Reaper batch-deletes rows past `retention.maxAge` / `ttl` under a system context and reclaims space (`SqlDriver.reclaimSpace()` → SQLite `PRAGMA incremental_vacuum`). Non-`record` classes must declare a bounding policy (parse-time invariant + spec-liveness gate + dogfood storage-growth gate).
  - **P2 — rotation**: `storage: { strategy: 'rotation', shards, unit }` physically time-shards the table on SQLite — writes land in the current shard, reads go through a UNION-ALL view under the base name, expiry is an O(1) `DROP` of shards past the window. A legacy table is adopted as the first shard on upgrade. Other dialects fall back to an equivalent age-based reap.
  - **P3 — separation + Archiver**: registering a datasource named `telemetry` routes telemetry/event/audit objects to it (opt-in by existence; `transient` deliberately stays on the primary). Audit objects with `archive` declared get retain → archive → delete once the archive datasource exists; without it rows are retained, never dropped unarchived.
  - **P4 — governance**: new `lifecycle` settings namespace — runtime enable switch, per-object retention overrides (tenant-scoped: regulated tenants set years, dev sets days), per-object/per-class row quotas and growth alerts (observe-and-alert only).

  **Behavior change**: 11 platform objects now carry lifecycle declarations and their telemetry is bounded by default — `sys_activity` 14d (rotated), `sys_audit_log` 90d hot → archive (retained forever until an `archive` datasource is registered), `sys_metadata_audit` 365d → archive, `sys_job_run` / `sys_automation_run` / `sys_http_delivery` 30d, notification pipeline (`sys_notification`, delivery, receipt, inbox) 90d, `sys_device_code` expires_at + 1d. Extend windows per environment/tenant via the `lifecycle.retention_overrides` setting.

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/metadata-core@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/formula@14.4.0
  - @objectstack/metadata-protocol@14.4.0
  - @objectstack/types@14.4.0

## 14.3.0

### Minor Changes

- ff648ad: fix(data): resolve field `defaultValue`s BEFORE the `beforeInsert` hook (#2703)

  Declarative field defaults (including the `current_user` token) were resolved
  by `applyFieldDefaults` _after_ the user `beforeInsert` hook ran. A hook that
  DERIVED one field from another therefore read a stale `null` for any field that
  was about to be defaulted — e.g. `sales_person: Field.user({ defaultValue:
'current_user' })` left `sales_person == null` inside the hook, so a derived
  `current_status` computed to `unassigned` unless the client passed the field
  explicitly.

  `applyFieldDefaults` now runs at record-initialization time, before
  `beforeInsert`, matching the industry-standard order of execution (Salesforce
  field defaults / ServiceNow dictionary defaults are populated before before-
  triggers; engine-owned generation — autonumber sequences, encryption, timestamps
  — stays after the hook). The hook still has final say: it runs after and may
  override any defaulted field. Defaults still only fill fields left `undefined`,
  so client-supplied values are untouched, and the caller's input object is no
  longer mutated in place.

  Behavior note: a `beforeInsert` hook can no longer distinguish "client omitted
  field X" from "field X received its default" for fields that declare a
  `defaultValue` — the hook now always sees the resolved default. This matches how
  Salesforce/ServiceNow behave (before logic sees a fully-initialized record) and
  is the intended fix.

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/formula@14.3.0
  - @objectstack/metadata-core@14.3.0
  - @objectstack/metadata-protocol@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/formula@14.2.0
  - @objectstack/metadata-core@14.2.0
  - @objectstack/metadata-protocol@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/formula@14.1.0
  - @objectstack/metadata-core@14.1.0
  - @objectstack/metadata-protocol@14.1.0
  - @objectstack/types@14.1.0

## 14.0.0

### Patch Changes

- afa8115: Three permission-runtime fixes found dogfooding the ADR-0090 showcase zoo:

  **#2734 — driver tenant wall hid every global row.** `applyTenantScope` used
  strict `organization_id = :tenantId` equality, so any caller with an active
  org (every logged-in admin) saw ZERO rows in the org-less platform tables
  (`sys_position`, `sys_permission_set`, `sys_business_unit` — Setup → Access
  Control rendered empty on a fresh deployment) and none of the first-boot
  seeds (stamped before the default org exists). The scope is now
  `(organization_id = :tenantId OR organization_id IS NULL)`: a NULL tenant
  column marks a GLOBAL/platform row that belongs to no other tenant; rows
  stamped with a DIFFERENT org stay invisible exactly as before.

  **#2735 — bulkCreate skipped write-side marshaling.** The batch insert path
  (the common case for seeds/imports since #2678) handed raw object values
  (`location`/`json`/`array` fields) to the SQLite binder — "Wrong API use:
  tried to bind a value of an unknown type" — silently failing whole seed
  batches (showcase accounts/tasks/field-zoo seeded zero rows). `bulkCreate`
  now runs each row through the same `formatInput` + `applyWriteColumnMap` +
  timestamp-stamp sequence as `create()`, and decodes the read-back the same
  way.

  **#2737 — count()/aggregate() ignored injected read filters.** `engine.count`
  and `engine.aggregate` built a LOCAL ast inside the executor, discarding the
  RLS/OWD filters the security and sharing middlewares inject into
  `opCtx.ast.where` — `GET /data/:object` returned scoped `records` with an
  UNSCOPED `total` (a row-count oracle over invisible records, broken
  pagination). Both now carry their ast on the opCtx exactly like `find()`.

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [1056c5f]
  - @objectstack/spec@14.0.0
  - @objectstack/metadata-protocol@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/formula@14.0.0
  - @objectstack/metadata-core@14.0.0
  - @objectstack/types@14.0.0

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

- a1766fe: fix(validation): remove polynomial ReDoS in email validation regexes

  The email validators used `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, whose quantifiers
  around `\.` overlap (the literal dot is also matched by `[^\s@]`) and backtrack
  polynomially on adversarial input. The domain part is rewritten as
  `[^\s@.]+(?:\.[^\s@.]+)+` so labels exclude `.` and matching is linear. Valid
  addresses (including multi-label domains) are unaffected; addresses with an
  empty label such as `a@b..c` are now correctly rejected.

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/formula@13.0.0
  - @objectstack/types@13.0.0
  - @objectstack/metadata-protocol@13.0.0
  - @objectstack/metadata-core@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/metadata-protocol@12.6.0
  - @objectstack/formula@12.6.0
  - @objectstack/metadata-core@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- 8b3d363: Package metadata seed can no longer wedge the platform via record-change automation.

  A seeded record whose lifecycle flow self-triggered (a `record-after-update` flow
  writing back to its own trigger record) looped forever when its boolean re-entry
  guard never tripped — booleans persist as integer `1` on SQLite/libsql and CEL
  `1 != true` is `true`. During first-boot seed (which awaits automation) this hung
  the whole kernel build.

  Three layers:

  - `ExecutionContext.skipTriggers` (set by the seed-loader, threaded onto
    `HookContext.session` via `buildSession`) makes the record-change trigger skip
    flow dispatch for seed/bulk writes — seed data is end-state reference data, not
    user events. Lifecycle hooks still run.
  - `coerceBooleanFields()` converts SQLite 0/1 (and `'0'/'1'/'true'/'false'`) to
    real booleans on the after-hook view of a record (`hookContext.result` /
    `.previous`), so flow conditions see JS booleans. The value returned to the
    caller is unchanged.
  - The automation engine breaks a flow re-entering for the same record while an
    execution is still on the stack (`activeRecordFlows`), a backstop for any
    self-trigger loop.

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/metadata-protocol@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/formula@12.5.0
  - @objectstack/metadata-core@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Minor Changes

- 1dd5dfd: feat(packages): edit a package manifest via `PATCH /packages/:id`

  Adds an editable path for a package's `name` / `description` / `version` after
  creation: `SchemaRegistry.updatePackageManifest` (merges in-memory, preserving
  lifecycle state), `protocol.updatePackage` (re-persists to `sys_packages`), and
  the `PATCH /packages/:id` route in the HTTP dispatcher. `id` / `scope` / `type`
  remain immutable.

### Patch Changes

- Updated dependencies [60dc3ba]
- Updated dependencies [1dd5dfd]
  - @objectstack/spec@12.4.0
  - @objectstack/metadata-core@12.4.0
  - @objectstack/metadata-protocol@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/formula@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Minor Changes

- 5a0da03: Enforce per-option `visibleWhen` server-side (objectui#2284).

  A `select`/`multiselect`/`radio` option may gate itself with a `visibleWhen` CEL
  predicate. Client-side hiding is UX, not a security boundary, so on write the
  engine now re-evaluates the picked value's predicate against the merged record +
  `current_user` and rejects a clean FALSE (`invalid_option`). This enforces both
  role/context gating (`'admin' in current_user.roles`) and cascade integrity
  (`record.country == 'cn'`) that a caller could otherwise bypass by submitting a
  hidden value directly.

  - Only WRITTEN choice fields are checked; an unchanged persisted value is left
    alone. Multi-select values are checked element-wise.
  - A predicate that can't be evaluated (missing referenced field, or an unbound
    `current_user` on a system write) is fail-open — matching every other
    field-level rule — so broken cascade predicates never brick a write.
    Authorization gating relies on the engine binding `current_user`, which it now
    does from the execution context on authenticated insert/update.
  - `needsPriorRecord` accounts for option `visibleWhen` so a cascade predicate can
    read an unchanged sibling from the prior record on update.

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/formula@12.3.0
  - @objectstack/metadata-core@12.3.0
  - @objectstack/metadata-protocol@12.3.0
  - @objectstack/types@12.3.0

## 12.2.0

### Minor Changes

- da807f7: feat(spec)!: retire the placeholder metadata kinds `trigger`, `router`, `function`, `service` (ADR-0088).

  The registry is the contract authors — human and AI — read to learn what can be authored, and these four kinds had no authoring surface, no loader, no schema, and no (or a dead) consumer. `MetadataTypeSchema` + `DEFAULT_METADATA_TYPE_REGISTRY` shrink 30 → 26; `OPS_FILE_SUFFIX_REGEX` drops the four suffixes; the dormant objectql load path that registered QL functions from `type: 'function'` metadata items is removed (`defineStack({ functions })` / plugin `contributes.functions` remain the delivered forms); the metadata-core lockstep enum follows. `external_catalog` stays and is now annotated RUNTIME-CREATED (ADR-0062): its lack of an authoring surface is correct design. The delivered replacements: `hook` / `record_change` flows (trigger), plugin `contributes.routes` + declarative `apis:` (router), `defineStack({ functions })` (function), the plugin/service registry (service). Persisted `sys_metadata` rows are unaffected — no production read path re-parses stored `type` values through the enum.

### Patch Changes

- 4f5b791: Wire three more Studio-authored metadata surfaces at runtime (#2605 — the
  "declared but never wired" family, following the #2596 hooks template).

  **Authored actions now execute (#2605 item 1).** `engine.executeAction`'s map
  was only ever populated from the app bundle at boot, so a published `action`
  row (standalone or embedded in an authored object's `actions[]`) was stored
  and listed but never executable — before OR after a restart. Now:

  - `AppPlugin` installs a QuickJS-sandboxed default action runner at boot
    (`engine.setDefaultActionRunner`), the action-path twin of the #2596 hook
    body runner. Opt out with `OS_DISABLE_AUTHORED_ACTIONS=1`.
  - `ObjectQLPlugin` re-registers runtime-authored actions from their
    `sys_metadata` rows under `packageId: 'metadata-service'` at
    `kernel:ready`, on `metadata:reloaded`, and on `action`/`object` protocol
    mutations — saves, publishes, edits, and deletes take effect live.
    Package-artifact actions are excluded (AppPlugin owns those; re-registering
    would clobber their handlers).

  **Authored translations reach the i18n runtime (#2591).** `translation`
  metadata items (single-locale `AppTranslationBundle` payloads; locale from
  `_meta.locale`, a top-level `locale`, or a BCP-47-shaped item name) now load
  into the i18n service as a separate authored layer that overlays static
  bundles. Both adapters carry the layer — service-i18n's `FileI18nAdapter`
  AND the kernel's in-memory fallback (`createMemoryI18n`), which is what dev
  and standalone stacks actually run. The shared sync
  (`wireAuthoredTranslationSync`, exported from `@objectstack/core`, wired by
  the runtime's AppPlugin and by I18nServicePlugin with single-owner
  semantics) runs at `kernel:ready`, on `metadata:reloaded`, and on
  `translation` protocol mutations, with clear-then-reload semantics so
  deleted items/keys stop resolving instead of lingering in the deep-merged
  map.

  **Sharing rules created at runtime bind without a restart (#2592).**
  `bindRuleHooks` was boot-only, so the first rule authored at runtime for an
  object with no boot-time rule silently never evaluated (rule authoring is a
  data insert — `metadata:reloaded` never fires). The sharing plugin now binds
  afterInsert/afterUpdate/afterDelete triggers on `sys_sharing_rule` that
  unbind + re-bind the rule-hook package from a fresh `listRules()`, serialized
  so overlapping writes can't leave a stale snapshot bound, and fail-safe so a
  rebind failure never fails the rule write.

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [75c310f]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/metadata-protocol@12.2.0
  - @objectstack/metadata-core@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/formula@12.2.0
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/formula@12.1.0
  - @objectstack/metadata-core@12.1.0
  - @objectstack/metadata-protocol@12.1.0
  - @objectstack/types@12.1.0

## 12.0.0

### Patch Changes

- 2d567cb: Runtime-authored (Studio) hooks now execute their `body` (#2588).

  Previously a hook authored at runtime (saved via `protocol.saveMetaItem` /
  `publish-drafts`) loaded into the registry but its L1/L2 `body` never ran — the
  metadata-service bind path passed no `bodyRunner` and the engine's
  `_defaultBodyRunner` fallback was never installed, so the binder silently
  skipped the body. Now:

  - `AppPlugin` installs the QuickJS-sandboxed hook body runner as the engine
    default at boot (`engine.setDefaultBodyRunner`), so bind paths without an
    explicit runner can execute bodies. Opt out with
    `OS_DISABLE_AUTHORED_HOOKS=1` to keep runtime-authored hook bodies inert.
  - `ObjectQLPlugin` re-binds runtime-authored hooks from their `sys_metadata`
    rows at `kernel:ready` (cold boot — env-scoped kernels never surfaced these
    rows before), on `metadata:reloaded`, and on every hook mutation through the
    new `protocol.onMetadataMutation` listener — so saves, publishes, edits, and
    deletes take effect live, without a restart. Package-artifact hooks are
    excluded from this bind path (AppPlugin already binds them with an explicit
    runner) so they no longer risk double execution.
  - `@objectstack/metadata-protocol` gains a server-side
    `onMetadataMutation(listener)` API: `saveMetaItem` / `publishMetaItem` /
    `deleteMetaItem` notify subscribers after persistence succeeds.

- 24b62ee: Enforce array shape for multi-value fields in the write pipeline (#2552). Lone scalars sent at a `multiselect` / `checkboxes` / `tags` field — or at a `select` / `radio` / `lookup` / `user` / `file` / `image` field flagged `multiple: true` — are now normalized into single-element arrays before validation instead of being stored verbatim (which silently corrupted the column shape), un-wrappable shapes are rejected with a new `invalid_type` validation code, and a legal array at a `select`+`multiple` field is no longer mis-rejected as `invalid_option`.
- c2fdbf9: fix(objectql): surface the human validation message in `ValidationError.message`, not a `field (code)` digest

  When an object-level validation rule (ADR-0020 `validations[]`) rejected a
  save, the console toast showed the generic English string
  `Validation failed for 1 field(s): _record (rule_violation)` instead of the
  rule author's own `message` (often localized, e.g. 最小水深不能大于最大水深。).

  The author's message was always transported in `ValidationError.fields[].message`
  through the whole chain (rule-validator → REST envelope `fields[]` → client SDK
  `error.details`), but every generic UI surface displays the top-level
  `Error.message`, which only contained the `field (code)` pairs.

  Fix at the single choke point — the `ValidationError` constructor now builds its
  top-level message from the per-field human messages (joined with `; `), falling
  back to `field (code)` only when a field error has no message. Machine-readable
  `code` and `fields[]` are unchanged, so programmatic consumers and the REST
  envelope shape are unaffected; every client (console toast, CLI, SDK callers)
  now sees the author-written message with no client-side change needed.

- 9860de4: Surface view-key collisions during view container expansion instead of renaming silently.

  `expandViewContainer` keeps its backward-compatible rename behaviour (`<object>.<key>` →
  `<object>.<key>_2` on collision) but now stamps a machine-readable
  `_diagnostics.warnings` entry on the renamed `ExpandedViewItem`, explaining that
  references targeting the requested name (form action targets, navigation `viewName`s)
  will resolve to the _other_ view. Both flattening loaders — the ObjectQL engine and the
  MetadataPlugin — log these warnings at boot so the collision is visible instead of
  manifesting as a form action opening a list view (#2554).

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [9796e7c]
- Updated dependencies [7c09621]
- Updated dependencies [b5be479]
- Updated dependencies [2d567cb]
- Updated dependencies [e3498fb]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [806a40a]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/metadata-protocol@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/formula@12.0.0
  - @objectstack/metadata-core@12.0.0
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/formula@11.10.0
  - @objectstack/metadata-core@11.10.0
  - @objectstack/metadata-protocol@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/formula@11.9.0
  - @objectstack/metadata-core@11.9.0
  - @objectstack/metadata-protocol@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/types@11.8.0
- @objectstack/metadata-core@11.8.0
- @objectstack/metadata-protocol@11.8.0
- @objectstack/formula@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/formula@11.7.0
  - @objectstack/metadata-core@11.7.0
  - @objectstack/metadata-protocol@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0
- @objectstack/metadata-core@11.6.0
- @objectstack/metadata-protocol@11.6.0
- @objectstack/formula@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/formula@11.5.0
  - @objectstack/metadata-core@11.5.0
  - @objectstack/metadata-protocol@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/formula@11.4.0
  - @objectstack/metadata-core@11.4.0
  - @objectstack/metadata-protocol@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/formula@11.3.0
  - @objectstack/metadata-core@11.3.0
  - @objectstack/metadata-protocol@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/formula@11.2.0
  - @objectstack/metadata-core@11.2.0
  - @objectstack/metadata-protocol@11.2.0
  - @objectstack/types@11.2.0

## 11.1.0

### Minor Changes

- 13dbcf2: Extract metadata management into `@objectstack/metadata-protocol` (ADR-0076)

  `protocol.ts` (the `ObjectStackProtocol` implementation — sys_metadata CRUD, draft/publish, locks, package ownership, diagnostics) plus its `sys-metadata-repository`, `metadata-diagnostics`, `seed-loader`, and `build-probes` helpers were metadata-domain code that lived inside `@objectstack/objectql` for historical reasons. They now live in a dedicated **`@objectstack/metadata-protocol`** package.

  The protocol no longer depends on the concrete `ObjectQL` class — it is typed against an injected `MetadataHostEngine` interface (the engine is still injected at runtime). Dependency direction is now one-way (`objectql → metadata-protocol`); there is no cycle.

  **Non-breaking**: `@objectstack/objectql` re-exports every previously public symbol (`ObjectStackProtocolImplementation`, `SysMetadataRepository`, `SysMetadataEngine`, `SeedLoaderService`, `runBuildProbes`, …), so existing imports keep working.

  This is Step 1 of ADR-0076. A later step turns the protocol into a capability plugin so `objectql` itself stops depending on it (making the engine lean by construction).

  Also adds a lean **`@objectstack/objectql/core`** entry — the engine/registry/hooks/validation surface only, with no kernel plugin or metadata protocol — so a thin embedder can import just the engine and never pull `@objectstack/metadata-protocol` into its bundle. A boundary ratchet test guards the entry.

- 3e593a7: Remove the deprecated `DriverInterface` type alias — use `IDataDriver` (11.0).

  `DriverInterface` was a `@deprecated` alias of `IDataDriver` (the authoritative
  driver contract). It is removed from `@objectstack/spec/contracts` and
  `@objectstack/core`; `objectql`'s engine now types drivers as `IDataDriver`
  directly (a type-identical change, since the alias _was_ `IDataDriver`).

  Driver authors: replace `DriverInterface` with `IDataDriver` (same shape).

  Note: this is unrelated to the live `IDataEngine` interface (engine-layer
  contract, not deprecated) and to the separate zod-derived `DriverInterface` /
  `DriverInterfaceSchema` in `@objectstack/spec/data` (the runtime driver schema),
  both of which are unchanged.

- fdb41c0: Remove ObjectStack's own legacy env-var aliases (11.0); ecosystem-standard names stay.

  The framework's renamed env vars no longer accept their old ObjectStack names —
  rename them:

  | removed legacy name                 | use                    |
  | ----------------------------------- | ---------------------- |
  | `OS_MULTI_TENANT`                   | `OS_MULTI_ORG_ENABLED` |
  | `OBJECTSTACK_METADATA_WRITABLE`     | `OS_METADATA_WRITABLE` |
  | `OS_AUTH_BASE_URL`, `AUTH_BASE_URL` | `OS_AUTH_URL`          |

  **Ecosystem-standard names are NOT removed** — they remain accepted (and no longer
  emit a deprecation warning, since they are permanent conventions, not legacy):
  `DATABASE_URL`, `AUTH_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PORT`,
  `CORS_*`, `LOG_LEVEL`, `ROOT_DOMAIN`, `MCP_SERVER_*`. The generic
  `readEnvWithDeprecation` helper is unchanged.

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [13dbcf2]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/metadata-protocol@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0
  - @objectstack/formula@11.1.0
  - @objectstack/metadata-core@11.1.0

## 11.0.0

### Minor Changes

- 4d99a5c: Package-scoped commit history & rollback for AI authoring (ADR-0067)

  Each authoring apply now lands as one revertible **commit** on a package timeline, on top of `sys_metadata_history`:

  - New `sys_metadata_commit` object groups a turn's metadata changes (by `event_seq` range).
  - `publishPackageDrafts` records each publish as one commit (best-effort) with a per-artifact revert plan and an optional `message` / `aiModel`.
  - New protocol methods `listCommits`, `revertCommit`, `rollbackToPackageCommit` (reusing `restoreVersion` + delete; a revert is itself an append-only commit).
  - New REST routes: `GET /packages/:id/commits`, `POST /packages/:id/commits/:commitId/revert`, `POST /packages/:id/rollback`.

- cd51229: Expose authoritative create seeds via /meta/types (spec-derived create-shape contract, Phase 2)

  The minimal valid create seeds added in `@objectstack/spec/kernel` (`getMetadataCreateSeed`) now reach consumers through the real `/meta/types` registry response: each entry carries an optional `createSeed`. The Studio designer / CLI / API clients derive their create defaults from this single source of truth instead of re-inventing them — closing the drift that produced the dashboard-`layout` and action-`body` create→save 422s.

  - `@objectstack/spec`: barrel-export `getMetadataCreateSeed` / `listMetadataCreateSeedTypes` from `/kernel`; add optional `createSeed` to the `GetMetaTypesResponse` entry schema.
  - `@objectstack/objectql`: `getMetaTypes()` attaches each type's seed (registry + runtime entries). Canvas-create types whose shape is built interactively (report) are intentionally absent.

- d980f0d: feat: add a first-class `user` field type (person picker)

  A new `user` field type — the equivalent of Airtable's Collaborator / Notion's
  Person / Salesforce's `Lookup(User)`. Authored as `Field.user({ ... })`; use
  `{ multiple: true }` for collaborators/watchers and `{ defaultValue: 'current_user' }`
  to auto-fill the acting user on create.

  **Why a distinct type rather than telling authors to `Field.lookup('sys_user')`:**
  selecting a person is table-stakes, but the value is in _modelling
  discoverability_ — a "User" entry in the Studio/AI field palette instead of
  requiring authors (and AI) to know to reference the internal `sys_user` system
  object — plus `current_user` defaults and a user-search picker. Storage and
  runtime are unchanged.

  **Deliberately NOT a new storage primitive.** `user` is a _semantic
  specialization of `lookup`_ with the target fixed to `sys_user`: it shares the
  exact lookup code path — same FK string column (`multiple` ⇒ JSON), same
  `$expand` resolution, same indexing — so referential integrity and fresh display
  names come for free, and nothing is re-implemented. An existing
  `Field.lookup('sys_user')` is therefore equivalent at the storage layer (zero
  data migration to adopt `Field.user`).

  Ownership semantics are **unchanged**: the existing `owner_id` convention +
  `plugin-security` auto-stamp/RLS still apply. A declarative `owner` flag is a
  possible future follow-up; intentionally not added here to avoid a second
  field type for what is a system role (rationale: keep the `FieldType` surface
  lean — see related ADR-0059 freeze discipline).

  Changes: `FieldType` gains `'user'` + `Field.user()` builder; the SQL/Mongo
  drivers treat `user` exactly like `lookup`; the engine resolves `$expand` for
  `user` fields and honours a new `defaultValue: 'current_user'` token (resolved
  app-side from the execution context, mirroring the `NOW()` convention); kanban
  group-by and symbolic seed references accept `user`; approvals enrich `user`
  references. The public API surface is unchanged (additive enum member).

### Patch Changes

- 61d441f: feat(objectql): duplicate a writable base — ADR-0070 D4 ("duplicate base")

  `protocol.duplicatePackage` clones every ACTIVE item a base owns into a NEW
  package, **re-namespacing** object names (the blueprint prefixes a base's object
  names with its namespace, e.g. `iojn_repair_ticket`, and `sys_metadata` keys on
  `(type,name,org)` so a same-name copy would collide with the source) and
  **rewriting every intra-package reference** (lookup `reference`, view `object`,
  expressions, …) to the new names via a longest-first, identifier-boundary
  replace. Exposed as `POST /packages/:id/duplicate` (body
  `{ targetPackageId, targetName?, targetNamespace? }`).

  Completes ADR-0070 D4 (package = lifecycle unit): delete-cascade and export
  already shipped; this adds the duplicate gesture.

- c224e18: feat(objectql): adopt orphaned metadata into a base — ADR-0070 D5 migration

  `protocol.reassignOrphanedMetadata` bulk-rebinds every package-less orphan
  (`package_id` null / `""` / the `sys_metadata` sentinel left by the pre-
  package-first stopgaps) onto a target base, leaving already-owned rows
  untouched. Exposed as `POST /packages/:id/adopt-orphans`. This is the migration
  affordance behind retiring the "Local / Custom" scope (D5): once an env has no
  orphans, that scope can be dropped from the selector. Pairs with the kernel's
  `writable_package_required` (D1) so no NEW orphans are created.

- d616e1d: feat(objectql): enforce package-first authoring at the kernel (ADR-0070 D1/D2)

  A runtime-only metadata **create** that targets a read-only code/installed
  package now throws `writable_package_required` (status 422) instead of silently
  coercing `package_id` to `null`. The old coercion (#2252 stopgap) unblocked
  editing but scattered orphans into a package-less bucket with no container to
  delete (#1946); the rejection instead directs the authoring surface (Studio /
  AI) to pick or create a writable base first.

  `isLoadedPackage` is generalized into `isWritablePackage` (D2): a package is
  writable unless it is a booted code package (registered in the engine manifest
  map) or a `system`/`cloud`-scoped installed package. The old "owns ≥1 registered
  object" heuristic is dropped — it was the read-only-after-publish trap (#2252),
  since a writable base accrues registered objects once its drafts publish.

  `null` is still accepted as the legacy org-overlay destination; ADR-0070 D5
  retires it after the orphan migration.

- 359c0aa: fix(objectql,rest): single-item meta reads must revalidate (no `max-age=3600`)

  `GET /api/v1/meta/object/:name` (and the other single-item meta reads served by
  the cached path) sent `Cache-Control: public, max-age, max-age=3600`. Two bugs:

  1. **Stale metadata for up to an hour.** Object metadata is invalidated by
     publish, but a one-hour TTL let browsers (and any CDN/proxy) serve a stale
     schema _without revalidating_ — e.g. the AI-build "New" create form kept
     rendering pre-publish fields until the TTL lapsed. The list endpoint
     `GET /api/v1/meta/object` is uncached, which is why list views updated but
     single-object reads didn't. `getMetaItemCached` now returns
     `directives: ['private', 'no-cache']` with no `maxAge`, so the ETag validator
     (which already changes on publish) gates freshness: a cheap `304` when
     unchanged, fresh fields the instant a publish bumps the ETag. `private` also
     keeps per-tenant metadata out of shared caches.

  2. **Malformed header.** The directives array carried a bare `max-age`
     placeholder _and_ the REST layer appended `max-age=3600` from the `maxAge`
     field, concatenating into `public, max-age, max-age=3600`. The header builder
     now strips the bare `max-age` token before appending the real value, so a
     `maxAge` is emitted once as a well-formed `max-age=N`.

- Updated dependencies [4d99a5c]
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
- Updated dependencies [795b6d1]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/metadata-core@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/formula@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- 211425e: fix(objectql): return the real `total`/`hasMore` from `findData` (#2212)

  `ObjectStackProtocolImplementation.findData` previously returned placeholder
  pagination metadata: `total` was always the **page** length and `hasMore` was
  always `false`. Front-end tables therefore believed every result set was a
  single page and never requested records past the first batch (e.g. row 51+ was
  unreachable).

  For a normal limited query it now runs `engine.count()` over the same `where` to
  get the true match total and derives `hasMore` from `offset + page length < total`.
  `engine.count()` only honors `where`, so `search`/`distinct` queries skip the
  count and fall back to a page-local estimate (a full page implies there may be
  more) instead of reporting a wrong total. Unlimited queries return the full set,
  whose length already is the total. The aggregate/group branch now reports the
  full group count as `total` with `hasMore` reflecting whether the client-side
  slice dropped any groups.

  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0
  - @objectstack/types@10.3.0
  - @objectstack/metadata-core@10.3.0
  - @objectstack/formula@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/formula@10.2.0
  - @objectstack/metadata-core@10.2.0
  - @objectstack/types@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/formula@10.1.0
  - @objectstack/metadata-core@10.1.0
  - @objectstack/types@10.1.0

## 10.0.0

### Minor Changes

- e16f2a8: **BREAKING:** the system object `sys_department` is renamed to `sys_business_unit`
  — object + member table (`sys_department_member` → `sys_business_unit_member`),
  fields, and i18n — with **no compatibility alias**. Any deployment holding
  `sys_department` rows, or metadata that references the object by name (lookups,
  list views, queries, sharing/approval scopes), must migrate to `sys_business_unit`.
  A renamed shipped system object is a breaking change to the platform's public
  data surface, so this lands as a **major**. Verified per ADR-0059's pre-publish
  hotcrm gate: no published downstream consumer references the old name.

  ADR-0057 — ERP authorization core. Adds permission-grant access DEPTH
  (`own`/`own_and_reports`/`unit`/`unit_and_below`/`org`), renames `sys_department`
  → `sys_business_unit` (no aliases — see BREAKING above), introduces the platform-owned
  `sys_user_position` assignment, and seeds stack-declared `roles`/`sharingRules` into
  `sys_position`/`sys_sharing_rule` at boot (closes #2077). Hierarchy-relative scopes are
  delegated to a pluggable `IHierarchyScopeResolver` (open edition fails closed to
  owner-only; `defineStack` errors without `requires: ['hierarchy-security']`). Also
  fixes a latent over-grant where `engine.find({ filter })` was ignored (driver reads
  `where`) — normalized `filter`→`where` in the engine.

### Patch Changes

- 2a1b16b: fix(ADR-0015): honor `external.remoteName` / `external.remoteSchema` on the federation read path.

  The query path previously resolved an external object's physical table from the
  object name, ignoring its `external` binding — so a federated object bound to a
  differently-named remote table failed with `no such table`, and ADR-0015's own
  `wh_order` → `mart.fact_orders` example was unqueryable. The SQL driver now
  resolves the remote table (`remoteName`, plus `remoteSchema` via `.withSchema()`
  on pg/mysql) and registers external objects' read-coercion metadata without DDL
  (`SqlDriver.registerExternalObject`, routed from the engine/plugin schema-sync).
  The managed path is unchanged. See ADR-0015 §18.

- 3efe334: Honor a nested `where` filter inside `expand` on lookup/master_detail expansion.

  The expand post-processor batch-loads related records with an `id $in [...]` query but never merged the nested QueryAST `where`, so a documented `expand: { rel: { where: {...} } }` filter was silently ignored and every related record came back. The nested filter is now AND-merged into the batch query via an explicit `$and` group (`{ $and: [{ id: { $in } }, nestedAST.where] }`) — robust against a nested filter that itself keys `id` or uses a top-level `$or`/`$and`, where a shallow spread would clobber or reorder the constraint.

  `limit`/`offset`/`orderBy` remain intentionally not honored on the expand path: it batch-loads every parent's related records in one `$in` query and re-keys them per parent by foreign key, so a per-parent page size or ordering can't be expressed there. Docs and the schema `describe()` are updated to match, with a guard test asserting `limit`/`offset` are not pushed into the expand query.

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [cfd86ce]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
- Updated dependencies [48a307a]
- Updated dependencies [25fc0e4]
  - @objectstack/spec@10.0.0
  - @objectstack/formula@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/metadata-core@10.0.0
  - @objectstack/types@10.0.0

## 9.11.0

### Minor Changes

- 36138c7: feat(autonumber): date, {field} and per-scope counter reset for autonumber formats

  `autonumberFormat` previously only understood a single `{0000}` sequence slot —
  everything else was a fixed literal prefix on one global counter. Real MES/eHR
  record numbers need three more token classes, so the format is now tokenized by a
  shared pure renderer in `@objectstack/spec` (`parseAutonumberFormat` /
  `renderAutonumber`) that the engine fallback and the SQL driver both call, so they
  emit byte-identical numbers (#1603 parity):

  - **Date tokens** — `{YYYY}` `{YY}` `{MM}` `{DD}` `{YYYYMMDD}` resolve the calendar
    day in the request's **business timezone** (`ExecutionContext.timezone`, ADR-0053;
    UTC fallback), threaded through the new `DriverOptions.timezone`.
  - **`{field}` interpolation** — `{section}{island_zone}{000}` substitutes record
    field values into the prefix.
  - **Per-scope counter reset** — the counter's scope is the rendered prefix _before_
    the sequence slot, so `AD{YYYYMMDD}{0000}` resets daily, `{section}{island_zone}{000}`
    numbers per group, and `{plan_no}{000}` numbers per parent — all from one
    mechanism, no separate reset config.

  Fixed-prefix formats like `CASE-{0000}` render an empty scope and keep their single
  global counter, so existing sequences are unchanged. The persistent
  `_objectstack_sequences` table is keyed by a `key_hash` (SHA-256 of
  `object, tenant_id, field, scope`) — a single 64-char primary key that keys every
  dialect uniformly, stays within MySQL's utf8mb4 index-length limit (four raw
  columns would not), and lets `scope` be a generous non-indexed column. Deployments
  with an older table (3-column, or an interim `scope` column) are migrated in place
  on first use, carrying existing counters to `scope=''`.

  Guardrails:

  - **Empty interpolated field is a hard error, not a silent mis-number.** A
    `{field}` token whose value is missing at create time would render to an empty
    prefix and collapse the record into the wrong counter scope. Both the SQL driver
    and the engine fallback now refuse to generate and throw a clear error naming the
    empty field (shared `missingFieldValues` helper).
  - **Build-time lint (`@objectstack/cli compile`).** `autonumber` formats are
    checked against the object's fields: a `{field}` token naming a non-existent
    field (or the autonumber field itself) **fails the build**; a token naming an
    _optional_ field emits an advisory warning to mark it `required: true`.
  - **Migration fails safe.** If a legacy table cannot be migrated to the `key_hash`
    shape, fixed-prefix sequences keep working via the legacy key and a per-scope
    write raises an actionable error instead of corrupting counters.
  - **Long `{field}` scopes are supported** (e.g. a long `{plan_no}`): the non-indexed
    `scope` column and hashed key remove the old varchar/PK length ceiling.

  Notes on inherent semantics (documented, not bugs):

  - The counter scope IS the rendered prefix. When two records' tokens render to the
    same prefix string (e.g. `{a}{b}` for `('AB','C')` and `('A','BC')`) they also
    render the same visible number, so they share one counter to stay unique — the
    remedy for genuinely-distinct groups is an unambiguous format (a delimiter
    literal between variable tokens).
  - The sequence pad width is a MINIMUM; past it the number grows (`{000}` →
    `1000`), it never wraps — matching mainstream autonumber semantics.

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
  - @objectstack/core@9.11.0
  - @objectstack/formula@9.11.0
  - @objectstack/metadata-core@9.11.0
  - @objectstack/types@9.11.0

## 9.10.0

### Minor Changes

- 1f88fd9: Add a transaction boundary to sandboxed hook/action bodies: `ctx.api.transaction(async () => { … })`. Every `ctx.api` read/write inside the callback runs in one driver transaction — committed when the callback returns, rolled back if it throws (or if the body leaves the transaction open at timeout). Guarded by the new `api.transaction` capability.

  - **spec**: new `api.transaction` capability token on `HookBodyCapability`.
  - **objectql**: `ScopedContext` gains discrete `beginTransaction()` / `commitTransaction(handle)` / `rollbackTransaction(handle)` primitives. The handle is threaded **explicitly** through a child context (`resolveTx` honors it ahead of the ambient `txStore`), because the sandbox drives the body across many host event-loop turns where AsyncLocalStorage context does not survive. Degrades to non-transactional execution when the driver has no transaction support.
  - **runtime**: the QuickJS runner wires `ctx.api.transaction` over three deferred-promise host leaves (begin/commit/rollback), routes in-transaction ops through the tx-scoped context, and rolls back a transaction the body left open before disposing the VM.

- e2b5324: feat(ownership): auto-provision a canonical `owner_id` and hand seeded records to the first admin

  Ownership is now correct-by-default instead of opt-in — closing the gap where
  seeded demo data ended up owned by nobody a human can log in as (so "My" views,
  owner reports and owner notifications were empty out of the box) and where
  author-written objects silently shipped with no working ownership at all.

  - **`applySystemFields` (objectql)** now auto-injects a canonical, reassignable
    `owner_id` lookup (→ `sys_user`) on user-authored business objects, alongside
    the existing tenant/audit fields. Unlike the audit `*_by` lookups it is NOT
    readonly — ownership transfers. Withheld for `managedBy` / `sys_*` tables and
    for objects that opt out via `ownership: 'org' | 'none'` (Dataverse-style). The
    safe default direction: forgetting the opt-out leaves a harmless spare column,
    whereas the old opt-IN model let authors ship objects with broken ownership.
    Once present, the existing machinery engages automatically (insert auto-stamp,
    owner-scoped RLS, owner-keyed views/reports).

  - **`claimSeedOwnership` (plugin-security)**, invoked from `bootstrapPlatformAdmin`
    right after the first human is promoted to platform admin, transfers ownership
    of seeded rows (`owner_id` NULL or `usr_system`) to that admin. The ownership
    twin of org-scoping's `claimOrphanOrgRows`. Idempotent; skips `managedBy` /
    `sys_*`. Authors write plain seed records (no `owner_id`) and the platform —
    not the author — performs the handoff, so there is nothing to remember or
    mistype.

  - **`usr_system` is never minted (runtime + objectql).** The seed loader binds
    `os.user` to a NULL identity, so `cel`os.user.id``resolves to NULL at seed
time (the owning admin does not exist yet) and the row seeds NULL-owned — then
the handoff above fills it. The runtime's`ensureSeedIdentity`(the only code
that inserted a`usr_system`row) is removed.`SystemUserId.SYSTEM`survives
only as a reserved id so legacy DBs' exclusion guards / ownership handoff still
recognize a pre-existing row.`os.org`is unaffected (derived from`organizationId`).

  Also hardens `bootstrapPlatformAdmin` against a latent dts typecheck error
  (defensive read of the untyped `description` on seed permission sets).

### Patch Changes

- fd07027: fix(analytics): make organization timezone actually drive date-dimension bucketing (ADR-0053 Phase 2, #1982)

  Date-bucketed analytics silently ignored the reference timezone end-to-end. Three independent seams were broken:

  - **service-analytics** — `NativeSQLStrategy` (priority 10) won every cube/dataset query on a SQL driver, but it groups by the raw column (no `date_trunc`) and ignores `timezone`, so a date dimension never bucketed (one row per raw timestamp) and a non-UTC zone was dropped. It now declines queries that carry a `timeDimensions[].granularity`, handing them to `ObjectQLStrategy` → `engine.aggregate` (native bucketing when UTC-safe, uniform in-memory bucketing when non-UTC).
  - **objectql** — the in-memory `count` aggregation treated the `*` count-all sentinel (the Cube `count` measure / a fieldless dataset `count`, both compiled to `sql: '*'`) as a column name, counting non-null of a non-existent property → `0` for every bucket. The driver's `COUNT(*)` masked it; the in-memory path (non-UTC date buckets, `driver-rest`/`driver-memory`) returned zeros. `*` is now counted as all rows.
  - **rest** — `resolveExecCtx` never resolved the localization timezone/locale, so `/analytics/dataset/query` always ran with `timezone: 'UTC'`. It now resolves them through the `settings` service (honouring the 4-tier cascade incl. the `OS_LOCALIZATION_TIMEZONE` env override), mirroring the dispatcher path.

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [1f88fd9]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/formula@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/metadata-core@9.10.0
  - @objectstack/types@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/types@9.9.1
- @objectstack/metadata-core@9.9.1
- @objectstack/formula@9.9.1

## 9.9.0

### Minor Changes

- 44c5348: fix: two runtime gaps found by driving the CRM example end-to-end.

  **Delete of a parent with a required-FK child no longer fails with a misleading "<field> is required" error.** `cascadeDeleteRelations` defaulted a `lookup` FK to `set_null`; for a _required_ FK that issued an UPDATE clearing the column, which the child's validator rejected with a `400 "<field> is required"` naming a field that isn't even on the object being deleted (e.g. deleting a `crm_account` with opportunities → `"account is required"`). A required FK can't be nulled, so a _defaulted_ `set_null` now escalates to `restrict`: the delete is refused with a clear `409 DELETE_RESTRICTED` carrying the dependent object + count (`"Cannot delete crm_account (…): 4 dependent crm_opportunity record(s) reference it via account … set deleteBehavior:'cascade'"`). Explicit `cascade`/`restrict` and optional (nullable) lookups are unchanged.

  **Removed the hardcoded `POST /data/lead/:id/convert` endpoint + `convertLead` protocol method.** It hardcoded bare object names (`lead`/`account`/`contact`/`opportunity`) and a fixed Salesforce field mapping into the framework runtime, so it was unreachable by any real (namespaced) app — `/data/crm_lead/:id/convert` 404s, and the literal `lead` object doesn't exist. Lead conversion is an app concern modeled correctly as a flow (the CRM ships a `crm_convert_lead_wizard` screen flow); baking a CRM-specific workflow into the framework was false surface. Untested, undocumented, unused by the example. Removed.

- 601cc11: feat(analytics): timezone-aware date bucketing (ADR-0053 Phase 2)

  Analytics day/week/month/quarter/year buckets now resolve on a **reference timezone's** calendar days, so a row near a tz day-boundary lands in the bucket a user in that zone would expect — identically on SQLite and Postgres.

  Per ADR-0053 decision **D2**, bucketing is done **in-memory, uniformly** for non-UTC zones rather than emitting dialect-specific `date_trunc … AT TIME ZONE` (SQLite has no tz database and MySQL needs tz tables loaded, so splitting by dialect would shift bucket boundaries for the same data). `engine.aggregate({ timezone })` therefore forces the in-memory aggregation path when a non-UTC reference tz is set — the date-range `where` still goes to the driver, so only matching rows are fetched. **UTC / unset keeps the native driver fast path unchanged.**

  - New shared `calendarPartsInTz` / `calendarPartsInTzOrUtc` util in `@objectstack/core` (DST-safe via `Intl.DateTimeFormat`, never hand-rolled offset math; falls back to UTC for an unset/`'UTC'`/invalid zone).
  - `EngineAggregateOptions` and the analytics `executeAggregate` bridge / `ObjectQLStrategy` thread the reference timezone (sourced from the dataset selection / `ExecutionContext`) through to `applyInMemoryAggregation` → `bucketDateValue`, and the draft-preview evaluator's `bucketDate`.
  - `formatDateBucket` (dimension labels) stays UTC-only by design: it re-labels values that were _already_ bucketed upstream, so re-applying a timezone there would shift a correct bucket by a day.

- d99a75a: feat(formula): timezone-aware `today()` / `daysFromNow()` / `daysAgo()` (ADR-0053 Phase 2)

  These are now **calendar-day** functions resolved in a reference timezone, threaded from `ExecutionContext.timezone` (#1978) through `EvalContext.timezone` into the CEL stdlib. Each returns the reference-tz calendar day expressed as a **UTC-midnight `Date`** (ADR-0053 decision D1) — the one representation consistent with how `Field.date` strings hydrate, how the SQL driver normalizes date filters, and how Phase 1 stores dates. So `record.close_date == daysFromNow(30)` now matches in-memory too, not just at the storage boundary. The timezone calculation uses `Intl.DateTimeFormat` (DST-safe; no hand-rolled offset math).

  **⚠️ Behavior change:** `daysFromNow(n)` / `daysAgo(n)` previously kept the wall-clock time of `now` (e.g. `daysFromNow(30)` at `10:00Z` → `…T10:00:00Z`). They now drop the time and return the calendar day at **midnight** (`…T00:00:00Z`) — the ADR-0053 "defect #3" fix. `today()` is unchanged at UTC (it already truncated to start-of-day). For a genuine sub-day offset use the documented escape hatch `now() + duration("Nh")`.

  With no reference timezone configured the zone resolves to `UTC`, so `today()` is byte-for-byte unchanged; only the `daysFromNow`/`daysAgo` midnight-truncation differs from before. `objectql` threads `execCtx.timezone` into read-time formula evaluation (`applyFormulaPlan`) and default-value expressions (`applyFieldDefaults`).

  Part of #1980. (Consuming a non-UTC reference timezone end-to-end also needs the `localization` settings manifest noted in #1978.)

### Patch Changes

- bfa3102: fix: array-valued field types persist, and `Field.time` accepts time-of-day — two field-type runtime gaps found driving the showcase field-zoo (which had no seed data, so neither was ever exercised).

  **Array/object fields broke every write (driver-sql).** `multiselect` / `checkboxes` / `tags` / `repeater` / `vector` were absent from the SQL driver's JSON-field classification, so their array values reached the better-sqlite3 binder un-serialized and threw _"SQLite3 can only bind numbers, strings, bigints, buffers, and null"_ — a 500 on insert/update for common field types (even `task.labels` on a normal object). The DDL column-type switch and `isJsonField` had drifted into two separate lists; they now share one `JSON_COLUMN_TYPES` source that includes the array/object types, so these columns are created as JSON and round-trip as arrays/objects. A `formatInput` safety net additionally serializes any stray array/object value so an unclassified field degrades to a stored string instead of crashing.

  **`Field.time` rejected every valid value (objectql).** The validator reused the date/datetime branch (`Date.parse`), which is `NaN` for any bare time string — so a `time` field could never accept `14:30` or `09:05:30`. `time` now validates a time-of-day (`HH:MM` / `HH:MM:SS`, optional fractional seconds and `Z`/offset) and still accepts a full ISO datetime; `date`/`datetime` are unchanged.

  Verified live on app-showcase: the full field-zoo specimen (all input-able field types) now persists and round-trips. Regression tests added for both.

- 67c29ee: fix(objectql): thread execution context into read-time formula evaluation

  `applyFormulaPlan` — which computes `Field.formula` virtual fields after a `find`/`findOne` — evaluated each expression with only `{ record }`. So a formula using `now()`/`today()` ran against a fresh wall-clock read on every evaluation (no determinism), and a formula referencing the caller (`os.user.id`, `os.org.id`) faulted and fell back to `null` because the user/org were never in scope.

  It now builds the eval context the same way `applyFieldDefaults` already does: a `now` snapshot **pinned once per operation** (every row and every formula field in one read observes the same instant) plus `os.user` / `os.org` resolved from the `ExecutionContext`. Read-time formulas behave consistently with default-value expressions, and computed fields can reference the caller.

  This is independent of timezone; it is the read-path prerequisite for ADR-0053 Phase 2 (#1980 will additionally thread `timezone` here once `ExecutionContext.timezone` exists).

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [d99a75a]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/formula@9.9.0
  - @objectstack/metadata-core@9.9.0
  - @objectstack/types@9.9.0

## 9.8.0

### Minor Changes

- 76ac582: engine: accept execution context via the trailing `options` argument on the read
  methods (`find` / `findOne` / `count` / `aggregate`), aligning them with the
  write methods (`insert` / `update`).

  Previously reads took context only inside the query (`query.context`) while
  writes took it in a trailing `options.context`. The same `{ context }` object was
  therefore correct as the 3rd argument to `insert` but **silently dropped** as the
  3rd argument to `find` — a recurring footgun where an intended `isSystem` bypass
  just vanished (e.g. control-plane reads returning empty once org-scoping hooks
  were added). Now "execution context goes in the trailing `options` argument" is a
  single rule across reads and writes. `query.context` remains fully supported; when
  both are supplied, `options.context` wins.

- 884bf2f: feat: record clone — wire the `object.enable.clone` capability to a real runtime (previously a parsed-but-dead flag).

  - **objectql**: new `protocol.cloneData({ object, id, overrides?, context? })` — reads the source record, drops engine-owned columns (`id` + audit `created_at`/`created_by`/`updated_at`/`updated_by`, plus `system`-flagged, `autonumber`, `formula` and `summary` fields) so the insert path re-derives them, applies caller `overrides` last, and inserts the copy. Shallow by design (duplicates the record's own fields, not its child records). Gated by `schema.enable.clone`: default-on, an explicit `enable.clone === false` throws `403 CLONE_DISABLED`.
  - **rest**: new `POST /api/v1/data/:object/:id/clone` (201 → `{ object, id, sourceId, record }`). Optional body `{ overrides }` (or a bare field map) overrides copied values, e.g. a new `name` or a cleared unique field. Honors the same auth + `enable.apiEnabled`/`apiMethods` gates as the rest of the data surface; `enable.clone === false` → 403.

  Reclassifies `object.enable.clone` `dead → live` in the spec liveness ledger.

### Patch Changes

- Updated dependencies [c17d2c8]
- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/formula@9.8.0
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/metadata-core@9.8.0
  - @objectstack/types@9.8.0

## 9.7.0

### Patch Changes

- Updated dependencies [82c7438]
- Updated dependencies [417b6ac]
- Updated dependencies [ff0a87a]
  - @objectstack/formula@9.7.0
  - @objectstack/spec@9.7.0
  - @objectstack/core@9.7.0
  - @objectstack/types@9.7.0
  - @objectstack/metadata-core@9.7.0

## 9.6.0

### Minor Changes

- 71578f2: feat(book): documentation navigation as a `book` element — spine + derived membership (ADR-0046 §6)

  Adds the `book` metadata element: a navigation **spine** (ordered groups + `audience` + identity) whose membership is **derived** by rule (`include` glob/tag) plus optional per-doc `order`/`group`, never a central array. This keeps AI authoring create-and-forget (no central-array read-modify-write) and runtime overlay merge-safe (RFC 7396 treats arrays atomically).

  - `BookSchema` + `resolveBookTree()` derived-membership resolver + `defineBook()` + additive `doc.order`/`doc.group`.
  - Register `book` as a render-time metadata type (`allowOrgOverride: true`); wire it through the runtime type enumerations (PLURAL_TO_SINGULAR, engine registration, artifact field map, type-schema map).
  - REST `GET /meta/book/:name/tree` resolves the tree; read-layer `audience` gating (`public` ≡ anonymous; `org`/`{profile}` require sign-in).

### Patch Changes

- b04b7e3: fix(objectql): validate a declared required `organization_id`/`tenant_id` instead of silently skipping it by name (#1592)

  `validateRecord` skipped required-checks for any field literally named
  `organization_id` / `tenant_id`. That's correct only for the engine-INJECTED
  tenant column (already marked `system: true`, skipped via provenance). A
  genuinely DECLARED required business field with that name — e.g. `sys_team`'s
  `organization_id` lookup, on a `managedBy: 'better-auth'` table where the column
  is NOT injected — was silently bypassed and reached the driver as NULL (a DB
  constraint error instead of a clean `400 required`). Removed the two names from
  the by-name skip set; injected columns remain skipped via `def.system` /
  `def.readonly`.

- d13df3f: fix(objectql): `record.<field> == null` validation fires on insert when the field is omitted (#1871)

  A `script` / `cross_field` validation predicate like `record.due_date == null`
  did not fire on **insert** when the optional field was omitted entirely from the
  payload — the CEL `record` scope lacked the key, so `record.x == null` saw a
  missing key (not null) and silently couldn't match. It worked on update (the
  prior record supplies the field) and when the field was explicitly `null`.

  Fix: on insert, default declared-but-absent schema fields to `null` in the rule
  evaluation scope, so an omitted optional reads as `null` — matching an explicit
  `null` and the update path.

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [bb00a50]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/formula@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/metadata-core@9.6.0
  - @objectstack/types@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/formula@9.5.1
  - @objectstack/metadata-core@9.5.1
  - @objectstack/types@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/formula@9.5.0
  - @objectstack/metadata-core@9.5.0
  - @objectstack/types@9.5.0

## 9.4.0

### Minor Changes

- 0856476: feat(metadata): package-scoped single-item resolution via `?package=` (ADR-0048)

  A single-item metadata GET (`/meta/:type/:name?package=<id>`) now resolves
  package-scoped (prefer-local): when two installed packages ship an item of the
  same `type`/`name`, the requester's own package wins. Previously only the _list_
  endpoint was package-aware; a single-item fetch was context-free, so a
  cross-package collision always resolved to whichever package registered first.

  The fix threads `packageId` end-to-end:

  - `@objectstack/rest` — the cacheable single-item path called `getMetaItemCached`
    (ETag keyed on type+name only) and dropped `?package=`. A `?package=` read now
    bypasses that cache and takes the disambiguating `getMetaItem(type, name,
packageId)` path, so two same-named items never share one cache entry.
  - `@objectstack/objectql` — `protocol.getMetaItem` forwards `packageId` to the
    overlay query (`sys_metadata.package_id`), `MetadataFacade.get`, and
    `registry.getItem`; `MetadataFacade.get` gained an optional `currentPackageId`.
  - `@objectstack/runtime` — the parallel HTTP dispatcher threads `?package=` too.

  This lets the doc viewer (`/apps/:packageId/docs/:name`) resolve one doc scoped
  to its app, so `doc` names no longer need a namespace prefix for uniqueness (the
  prefix becomes a recommended convention, like `page`/`dashboard`/`report`);
  `doc.zod` doc-comments updated accordingly.

- fef38ec: feat(metadata): package-scoped customization overlays (ADR-0048 #1824)

  A `sys_metadata` customization overlay is now keyed by `(type, name,
organization_id, package_id)`, so two installed packages shipping an item of the
  same `type`/`name` can each carry their **own** overlay. Previously the overlay
  uniqueness key was `(type, name, organization_id)` — physically one row per
  name — so customizing one package's item shadowed both, and a package-scoped
  read fell back to whichever row existed.

  - **Index**: `idx_sys_metadata_overlay_active` / `…_draft` now include
    `package_id`. The runtime migration (`ensureOverlayIndex`) uses
    `COALESCE(package_id, '')` so package-less (global) overlays stay unique among
    themselves (a plain unique index treats NULLs as distinct). DROP-then-CREATE,
    idempotent; existing rows migrate safely (the old key already guaranteed one
    row per `(type, name, org)`).
  - **Write**: `SysMetadataRepository.whereFor`/`put`/`get` scope the upsert to the
    requested package, so a save bound to package B no longer finds and overwrites
    package A's same-name overlay. A package-less save (`packageId` null) targets
    the global row.
  - **Read**: `getMetaItem` / `getMetaItemLayered` overlay lookups already prefer
    the package-scoped row; the fallback now resolves only the **global**
    (`package_id IS NULL`) overlay, never a _different_ package's row. Package-less
    readers are unchanged (match-any, back-compat).

  Verified live against a real collision (two packages each shipping
  `page/showcase_task_workbench`): two overlay rows coexist, and `?package=` single
  reads + the `?layers=true` Studio editor view each return that package's own
  overlay; the unique index migrated in place.

  Known follow-up: the _unscoped list_ (`GET /meta/:type` with no `?package=`)
  still dedupes by bare name, so when two packages both carry an overlay on the
  same name the list collapses them — the per-package single-item and editor paths
  are unaffected. Tracked for the list-dedup-by-name work.

- b678d8c: feat(objectql): ADR-0048 Phase 1+2 — namespace install gate + package-scoped resolution

  Phase 1 — install-time namespace gate. `SchemaRegistry.installPackage` refuses a
  package whose `manifest.namespace` is already owned by a DIFFERENT installed
  package (new `NamespaceConflictError`), making explicit and early the constraint
  the table layer already enforces implicitly. Same-package reinstall and
  shareable platform namespaces (`base`/`system`/`sys`) are exempt;
  `OS_METADATA_COLLISION=warn` downgrades to a warning.

  Phase 2 — prefer-local resolution, pivoted to ADR-0048 option A (package id as
  the routing key). `getItem(type, name, currentPackageId?)` prefers
  `${currentPackageId}:${name}` before any cross-package fallback (ADR-0005 overlay
  precedence and backward compatibility unchanged); `getApp(name,
currentPackageId?)` resolves prefer-local by package id. Because package ids are
  globally unique, package-scoped resolution always disambiguates two distinct
  packages — so the old per-item CROSS-package throw (and the now-dead
  `MetadataCollisionError`, `findOtherPackageOwner`, `SYS_METADATA_OWNER`, …) is
  retired; two different-namespace packages legitimately coexist on the same bare
  name. `collisionPolicy` now governs only the Phase 1 namespace gate.

- b678d8c: feat(objectql): opt-in `sys_metadata` hydration for isolated project kernels

  Boot Phase-2 hydration (`restoreMetadataFromDb` → `loadMetaFromDb`, which
  registers objects WITH their fields into the `SchemaRegistry`) was gated on
  `environmentId === undefined`, assuming every project kernel sources its
  metadata from a remote artifact / control-plane proxy. That is untrue for an
  isolated, proxy-free project kernel that persists its OWN `sys_metadata`
  locally (the cloud single-env tenant runtime): objects created at runtime there
  never re-entered the registry after a restart, so `registry.getObject(name)`
  returned nothing and every registry consumer silently degraded (notably the
  `engine.find` unknown-`$select` guard, which then let an unknown projected
  column zero the result set).

  Adds an explicit `hydrateMetadataFromDb` plugin option (default `false`, so the
  control-plane/proxy path is untouched). When set, hydration runs even with
  `environmentId` defined — safe because each engine now owns its registry
  instance and `loadMetaFromDb` already tolerates a missing table.

### Patch Changes

- c1dfe34: fix(metadata): keep each colliding item's own `_packageId` provenance (ADR-0048)

  When two installed packages ship an item of the same `type`/`name`, the
  single-item and list reads grafted the artifact protection envelope from a
  **first-match** artifact lookup (`lookupArtifactItem(type, name)`), so the
  second package's item inherited the FIRST package's `_packageId`. The frontend
  prefer-local resolution (dashboard/report/page) filters the unscoped list by
  `_packageId`, so this mislabel made it resolve a collision to the wrong package
  (or fail to find the local item entirely).

  - `getMetaItem` now scopes the artifact lookup to `request.packageId`.
  - `getMetaItems` scopes the per-item decorate to the requested package (when the
    whole list is package-scoped) else to each item's own `_packageId`.

  `getItem` ordering is unchanged — a bare-key runtime/DB overlay still takes
  ADR-0005 precedence over the packaged item (clarifying comment added). An
  env-wide (package-less) overlay of a name that collides across packages remains
  inherently ambiguous by schema (`sys_metadata` is unique on `type+name+org`, not
  package); pure-artifact collisions (the marketplace default) now resolve and
  list correctly per package.

- 3e675f6: fix(metadata): package-scope the layered (Studio editor) read via `?package=` (ADR-0048)

  The `?layers=true` single-item read (the Studio metadata editor's 3-state
  code/overlay/effective view) ignored `packageId`, so editing one of two
  same-named items from different packages resolved ambiguously (first match).

  - `protocol.getMetaItemLayered` now threads `packageId` into the code layer
    (`metadataService.get` + `lookupArtifactItem` + `registry.getItem`) and the
    `sys_metadata` overlay query (`package_id` prefer-local).
  - `registry.getArtifactItem(type, name, currentPackageId?)` and
    `lookupArtifactItem` gained the optional package-scope hint.
  - `rest-server` threads `?package=` into the layered branch.

  This completes the per-route package-scoped resolution audit: the runtime
  render surface (dashboard/report/page/doc) was already scoped; this closes the
  Studio editor (`/apps/:appName/metadata/:type/:name`). Frontend counterpart
  sends `?package=` from the metadata list row's owning package.

- b678d8c: fix(objectql): seed reference resolution falls back to matching by `id`

  `SeedLoaderService.resolveFromDatabase` only matched a reference value against
  the target's natural-key field. A seed that wires a lookup to a REAL existing
  record by its internal id — e.g. a people field (approver/applicant → user)
  pointed at the current user — dangled to `null` when that id is not a
  UUID/ObjectId (so the caller's `looksLikeInternalId` guard did not
  short-circuit) and is not the target's natural key.

  Adds an id fallback: when the natural-key lookup finds nothing, try resolving
  the value as the target's `id`. Safe — an id either exists or it doesn't, so
  there is no risk of a false natural-key match, and it is tenant-scoped like the
  primary lookup.

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [fef38ec]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/metadata-core@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/formula@9.4.0
  - @objectstack/types@9.4.0

## 9.3.0

### Minor Changes

- 1ada658: ADR-0046 P1: package documentation as metadata. New `doc` metadata element — flat Markdown files under `src/docs/*.md` compile into `docs: DocSchema[]` on the stack and register like any other metadata.

  - spec: `DocSchema` ({ name, label?, content }) in `system/`, `StackDefinition.docs`, `doc` in `MetadataTypeSchema` + type registry (inert data, runtime-creatable) + canonical schema map, `docs → doc` plural mapping.
  - cli: `os build` collects flat `src/docs/*.md` (frontmatter `title:`/first `#` heading → label) and enforces the ADR lint — flat directory, namespace-prefixed snake_case names, namespace required when docs ship, MDX/image ban, same-package relative-link resolution. Same rules surface in `os lint`.
  - objectql: `docs` joins the generic metadata registration loop (manifest + nested plugins).
  - runtime: docs count as app payload; `GET /metadata/doc` list responses omit `content` by default (`?include=content` opts in) so unbounded manuals stay off hot paths.

- 6259882: ADR-0048: cross-package metadata collision detection. Bare-named generic metadata (`page`, `dashboard`, `flow`, `app`, `action`, `doc`, …) carries no package coordinate in the registry key (`org/type/name`), so two installed packages defining the same `(type, name)` would silently shadow each other at read time (`getItem` returns whichever the registry iterates first). The kernel only prefix-validates object names, leaving these types unguarded.

  `SchemaRegistry.registerItem` now refuses a cross-package base-layer collision — a real `packageId` registering a `(type, name)` already owned by a _different_ real package — with a `MetadataCollisionError` naming both packages and the type/name. `ObjectQL.registerApp` and the nested-plugin loop delegate to it, so manifest and plugin metadata are both covered.

  Legitimate same-key writes are unaffected: same-package reloads, runtime/DB overlays (ADR-0005, bare-key or `sys_metadata`-sentinel rows), object ownership/extension, and nav contributions all pass through. Policy is `error` by default; set `collisionPolicy: 'warn'` (or `OS_METADATA_COLLISION=warn`) to downgrade during a deliberate migration.

- b10aa78: Metadata registered through the metadata-service path now carries package provenance. `loadMetadataFromService` and `MetadataFacade.register` pass each item's own `_packageId` through to `registry.registerItem` so `applyProtection` stamps `_packageId`/`_provenance: 'package'` (never a synthetic id — `isArtifactBacked()` write authorization keys off `_packageId`). New `MetadataPluginOptions.packageId` lets hosts running the filesystem scanner declare the owning package id for scanned source-file metadata, closing the same gap for hand-wired kernels. GET /api/v1/meta/:type consumers (e.g. objectui NavigationSyncEffect) can now distinguish package-shipped items from user-authored rows without name heuristics.

### Patch Changes

- 2796a1f: Fix metadata registry pollution: a packaged artifact's protection envelope (`_lock`/`_packageId`/`_provenance`) survives overlay hydration and reset (ADR-0010 §3.3). GET-list hydration used to register the sys_metadata overlay body under the registry's plain key, shadowing the artifact — a `_lock: full` app read back as unlocked after PUT+GET, and DELETE (reset) left the stale shadow in place until restart. Envelope readers now resolve through the shadow-immune `SchemaRegistry.getArtifactItem()`, hydration grafts the artifact envelope onto the overlay body (overlay content wins, artifact protection wins), and reset heals the registry via `removeRuntimeShadow()` — including self-healing on a no-op DELETE.
- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/formula@9.3.0
  - @objectstack/metadata-core@9.3.0
  - @objectstack/types@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/formula@9.2.0
  - @objectstack/metadata-core@9.2.0
  - @objectstack/types@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/formula@9.1.0
  - @objectstack/metadata-core@9.1.0
  - @objectstack/types@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/formula@9.0.1
  - @objectstack/metadata-core@9.0.1
  - @objectstack/types@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/formula@9.0.0
  - @objectstack/metadata-core@9.0.0
  - @objectstack/types@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/types@8.0.1
- @objectstack/metadata-core@8.0.1
- @objectstack/formula@8.0.1

## 8.0.0

### Minor Changes

- b990b89: fix(autonumber): one owner for autonumber generation — the persistent driver sequence (#1603)

  Autonumber values were generated in TWO places: the SQL driver's persistent,
  atomic `_objectstack_sequences` table AND a non-persistent in-memory counter in
  the ObjectQL engine. Because the engine pre-filled the field BEFORE calling the
  driver, the driver always saw a value already set and skipped — so the
  persistent sequence was effectively dead code, and a multi-instance / post-restart
  deployment could mint duplicate numbers from the in-memory counter.

  This makes generation single-owner:

  - **`@objectstack/spec`** — `DriverCapabilities` gains an optional `autonumber`
    flag: "driver natively generates persistent autonumber/sequence values".

  - **`@objectstack/driver-sql`** — advertises `supports.autonumber = true`.
    `bulkCreate()` now fills autonumber fields too (previously only `create()` /
    `upsert()` did), so bulk inserts also draw from the persistent sequence.
    Field parsing now honors either the spec-canonical `autonumberFormat` key OR
    the `format` shorthand (both appear in metadata).

  - **`@objectstack/objectql`** — when the driver advertises native autonumber
    support, the engine NO LONGER pre-fills (it defers entirely to the persistent
    driver sequence as the single source of truth). For drivers without native
    support (memory, mongodb) the in-memory fallback is unchanged. The fallback
    also now reads either `autonumberFormat` or `format`. Record-validation
    exempts `autonumber` fields from the `required` check — the value is
    runtime-owned and assigned after validation, so a required record number is
    never rejected as "missing".

  No metadata changes required. Existing data is respected: the driver bootstraps
  each sequence from the current max numeric tail on first use.

- 99111ec: Field-level conditional rules (CEL): `visibleWhen` / `readonlyWhen` / `requiredWhen`, enforced server-side.

  Add three CEL-predicate field props (over `record`) evaluated on both sides. **Spec**: `visibleWhen` / `readonlyWhen` / `requiredWhen` (`requiredWhen` canonical; `conditionalRequired` kept as a back-compat alias). **Server (objectql)**: the validator now enforces `requiredWhen`/`conditionalRequired` over the merged record (so the rule can't be bypassed by a direct API write), and the update path ignores writes to a field whose `readonlyWhen` is TRUE (keeps the persisted value). `needsPriorRecord` accounts for conditional fields so the prior record is fetched on update.

- 9e2e229: feat(objectql): compute roll-up `summary` fields server-side

  The `summary` field type was declared in the spec but never computed — its value
  stayed empty. ObjectQL now recomputes roll-up summaries automatically: a parent
  field whose `summaryOperations` aggregates (`count`/`sum`/`min`/`max`/`avg`) a
  field across child records is recalculated whenever a child is inserted,
  updated, or deleted.

  - **`@objectstack/spec`** — `summaryOperations` gains an optional
    `relationshipField` (the child→parent FK). When omitted the engine
    auto-detects it from the child's `lookup`/`master_detail` field whose
    `reference` points back at the parent; set it explicitly only when the child
    has more than one such reference.

  - **`@objectstack/objectql`** — after `afterInsert` / `afterUpdate` /
    `afterDelete` on a child object, the engine finds the affected parent (from
    the child's FK, plus the prior FK on update/delete so a re-parented child
    updates both), re-aggregates the child collection, and writes the result onto
    the parent's summary field. It runs in the caller's execution context, so when
    a transaction is open (e.g. the cross-object `/api/v1/batch`) the rollup
    commits atomically with the child writes. A small index of child→summary
    descriptors is built lazily from the registry and invalidated on package
    registration.

  Empty collections roll up to `0` for `count`/`sum` and `null` for
  `min`/`max`/`avg`. This lets master-detail forms stop computing parent totals on
  the client — the server is now the single source of truth.

- 345e189: Robust multi-write transactions (ADR-0034). `engine.transaction()` now establishes an ambient transaction (AsyncLocalStorage) so every data operation during the callback — including internal reads performed while a write runs — binds to the active transaction's connection instead of asking the pool for another one and deadlocking on SQLite's single-connection pool. Adds a cross-object transactional batch endpoint (`POST /api/v1/data/batch`) with intra-batch `{ $ref: <opIndex> }` parent references, so a parent and its children can be created atomically in one transaction.

### Patch Changes

- e6374b5: fix(objectql): master_detail cascade delete + autonumber generation

  - `delete` now applies referential delete behavior for incoming relations: `master_detail` cascades to children (the parent owns the child lifecycle; only an explicit `restrict` deviates), `lookup` honors its `deleteBehavior` (default `set_null`). Recurses for grandchildren, depth-guarded, single-id deletes. Previously deleting a parent left its children orphaned.
  - `insert` now generates values for empty `autonumber` fields before required-validation (`max+1`, seeded per `object.field`, honors `autonumberFormat`). Previously a required autonumber was rejected as "missing" and autonumber fields were never populated.

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/formula@8.0.0
  - @objectstack/metadata-core@8.0.0
  - @objectstack/types@8.0.0

## 7.9.0

### Minor Changes

- ac1fc4c: feat(metadata): optional storage teardown on delete so "publish to preview" leaves no orphan table

  Object storage was create-only: `publishMetaItem` creates a table (`ensureObjectStorage`) but nothing ever dropped one — `deleteMetaItem` only tombstones the metadata row, leaving the physical table behind. That made the pragmatic "publish an object just to preview it with real data, then discard if wrong" loop leave residue.

  Adds the inverse path, opt-in and guarded:

  - `engine.dropObjectSchema(name)` — inverse of `syncObjectSchema`; resolves the table name + driver and calls the driver's existing `dropTable` (DROP TABLE IF EXISTS / drop collection).
  - `deleteMetaItem({ …, dropStorage })` — when `true`, drops the object's physical table after the metadata is removed. **DESTRUCTIVE**, so it is gated: `object` type only (others have no table), `active` state only (drafts were never materialised), and never a `sys_`-prefixed platform table. Default `false` keeps delete non-destructive to data. Best-effort: a drop failure is logged, not thrown.
  - REST: `DELETE /meta/:type/:name?dropStorage=true` threads the flag.

  This makes "publish to preview → discard" cleanly reversible. Combined with the draft-overlay read mode, it backs the team's chosen approach: lean on publish (into a dev sandbox) for data-level confirmation rather than building a full draft-data preview, and make that publish safely undoable.

- ac1fc4c: feat(metadata): draft-overlay reads so an admin can render the console off pending drafts before publish

  ADR-0033's loop is `build (draft) → review → publish`, but "review" was only a JSON diff — the one thing that actually confirms an AI/hand-authored change (the rendered object page / kanban / form / nav) only existed _after_ publish. That forces publishing unreviewed metadata just to look at it, defeating the draft gate.

  This adds a request-scoped **draft-overlay read mode** to the metadata resolution layer:

  - `getMetaItems({ …, previewDrafts })` — after the active overlay, overlays `state='draft'` rows on top (draft WINS on name collision; draft-only items surface too). Drafts are never hydrated into the process-wide SchemaRegistry.
  - `getMetaItem({ …, previewDrafts })` — non-strict: prefers a draft row if one exists, else falls back to the active value (unlike the strict `state:'draft'` mode, which 404s `no_draft`).
  - Every overlaid item is tagged `_draft: true` so the UI can badge it and show a "preview" banner.
  - The runtime HTTP dispatcher threads `?preview=draft` on `GET /metadata/:type` and `GET /metadata/:type/:name` into these reads.

  The same overlay also unblocks the AI authoring agent referencing its own just-drafted objects (a follow-up will point `list_metadata` at it). Admin gating of the `?preview=draft` flag is a deliberate follow-up step.

  Note: a brand-new draft object has no physical table until publish, so preview renders its _shape_ (form/view/kanban/nav) but shows no data; field-additions to existing objects preview fully.

- ac1fc4c: feat(packages): one-click discard-drafts and full delete for a package

  Two distinct package-level lifecycle operations, both built on the per-item delete primitive:

  - **`discardPackageDrafts(packageId)`** — drop every pending DRAFT bound to the package, reverting it to its last published baseline. NON-destructive: active/published metadata and physical tables are untouched. Use case: "I edited this app for a while and it turned out worse than before — abandon all my changes." Routes through the sys_metadata path (no metadata-service dependency, unlike the existing `POST /packages/:id/revert`, which 503s without a metadata service). REST: `POST /packages/:id/discard-drafts`.

  - **`deletePackage(packageId)`** — remove the ENTIRE package: every `sys_metadata` row (active + draft) and, by default, the physical table of each object it defined (DESTRUCTIVE). `keepData: true` removes metadata but preserves tables; the `sys_`-table guard still applies. Use case: "I don't want this package anymore." `DELETE /packages/:id` now performs this persisted removal in addition to the in-memory registry unregister it already did (previously it left AI/runtime packages' rows and tables behind); `?keepData=true` opts out of teardown.

  Drafts are deleted before active rows so each object's table is torn down exactly once. Per-item failures are collected without aborting the rest.

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/types@7.9.0
- @objectstack/metadata-core@7.9.0
- @objectstack/formula@7.9.0

## 7.8.0

### Minor Changes

- a75823a: feat(metadata): expose pending DRAFT metadata (ADR-0033 draft discoverability)

  AI-authored metadata lands as drafts (`sys_metadata` rows with `state='draft'`, bound to an app package), but the only list path — `getMetaItems` — reads the active registry, so drafts were invisible: a just-built app package looked empty and there was no "pending changes" surface.

  - `SysMetadataRepository.listDrafts({type?, packageId?})` lists draft rows (mirrors `list()` but scoped to `state='draft'`, optionally narrowed by package), returning a light header projection (no body) with `packageId`.
  - `protocol.listDrafts({packageId?, type?, organizationId?})` exposes it over the overlay repo.
  - `GET /api/v1/meta/_drafts?packageId=&type=` surfaces it to the console. Registered in the REST server before the greedy `/meta/:type` route (and mirrored in the dispatcher) so `_drafts` is never captured as a metadata type name.

  Read-only; no behavior change to existing list/publish paths. Powers the upcoming Studio "drafts/pending changes" view and draft-aware package contents.

- 4fbb86a: feat(packages): consolidate the package subsystem so AI-built app packages surface in Studio

  The package subsystem was split across two stores that never met: the in-memory
  `SchemaRegistry` (what the dispatcher's `/api/v1/packages` list/detail and
  `getMetaItems({type:'package'})` read — i.e. Studio's package selector) and the durable
  `sys_packages` table (where the AI's auto app package, and any `package`-service publish,
  were written). Nothing reconciled the two, so an AI-created `app.<name>` package never
  appeared in Studio.

  This unifies them around one write primitive and one read source:

  - **`protocol.installPackage`** is now implemented (it was declared-but-missing). It is the
    single canonical write path: it registers the package in the in-memory registry **and**
    best-effort persists it to `sys_packages` via the `package` service. Non-fatal when no
    `package` service is wired (registry write still succeeds).
  - **Dispatcher `POST /api/v1/packages`** routes through `protocol.installPackage` (falling
    back to the bare registry write when the protocol is unavailable), so HTTP installs are
    durable too.
  - **`@objectstack/service-package`** reconciles `sys_packages` back into the registry on
    boot, without clobbering filesystem-registered packages — so persisted packages survive a
    restart and stay visible in the registry-backed read paths.
  - **`@objectstack/service-ai`** `apply_blueprint` now homes an app via
    `protocol.installPackage` (falling back to the legacy `package`-service publish), so the
    app package lands where Studio reads it.

  Still the _legacy_ `package_id` plane — sealed `sys_package_version` versioning and
  cross-environment promotion remain ADR-0027 follow-ups.

- e631f1e: feat(metadata): publish a whole app's drafts in one shot (ADR-0033)

  After an AI builds an app, its metadata is drafted (bound to an app package) and
  had to be published one item at a time. The package-level `POST /packages/:id/publish`
  needs the `metadata` service (503 when absent, e.g. the showcase) and reads the
  in-memory registry, not the drafts.

  - `protocol.publishPackageDrafts({ packageId })` promotes every `sys_metadata`
    draft row bound to the package to active by reusing the per-item
    `publishMetaItem` primitive (overridable/lock guards + runtime registry
    refresh). Per-item failures are collected, not fatal. No `metadata`-service
    dependency.
  - `POST /api/v1/packages/:id/publish-drafts` exposes it (distinct from the
    registry-based `/publish`), returning `{ success, publishedCount, failedCount, published, failed }`.

  Verified live: an AI-built `app.asset_management` (4 drafts) published in one call —
  all 4 promoted to active, drafts cleared, draft objects became queryable.

- 36719db: fix: AI-built apps are usable immediately — sync new object tables on publish + emit valid kanban config

  Two gaps found by end-to-end testing of an AI-built app:

  1. **A freshly-published object couldn't accept records until a server restart.** Publishing a drafted object registered it in the in-memory registry but never created its physical table (table sync only ran at boot), so inserts failed with `object_not_found` ("no such table"). Added `ObjectQL.syncObjectSchema(name)` (a targeted, idempotent single-object schema sync) and call it from the publish paths (`protocol.publishMetaItem` and `saveMetaItem` mode:'publish', via `ensureObjectStorage`). Best-effort + non-fatal. New objects are now CRUD-able the moment they're published.

  2. **AI-generated kanban views rendered as plain lists** (and sometimes failed validation). The blueprint `viewBody` emitted `list.type:'kanban'` with no `kanban` config; `KanbanConfigSchema` requires `groupByField` **and** `columns`. Added an optional `groupBy` to the blueprint view schema (lenient + strict) and have `apply_blueprint` set `list.kanban = { groupByField, columns }` — using the view's explicit `groupBy` when given, else inferring the object's first `select` field. AI-built kanban views now validate, publish, and carry a real group-by field.

### Patch Changes

- 6fc2678: fix(metadata): stamp a top-level `name` on `view` bodies at the write path so AI/hand-authored views surface

  `getMetaItems` only overlays a `sys_metadata` row when its parsed body has a top-level `name`. Some view producers — notably loose `{ list: <ListView> }` / `{ form: … }` fragments that AI tools and hand-authoring emit — pass schema validation but carry no top-level `name`, so the view was silently dropped from the object's view list and never appeared as a tab ("validates ≠ surfaces").

  `saveMetaItem` now guarantees a top-level `name` on every view body at the single write chokepoint, BEFORE validation + persistence, so a nameless view is auto-corrected regardless of which authoring path produced it. It deliberately does NOT reshape the document: both the `defineView` container form (`{ list, listViews, … }`, expanded by the loader) and the `{ name, object, viewKind, config }` record form are valid and the console consumes both — reshaping a container into a record risks producing an invalid record (e.g. a non-`<object>.<key>` name) and drops Studio-only fields (`isPinned`, `sortOrder`, …). Exported as `normalizeViewMetadata` and unit-tested.

  (Note for follow-up: the `view` metadata schema is itself a permissive union — it accepts an unknown `viewKind`, a kanban config missing `groupByField`, even `{}`. Tightening it correctly requires first consolidating the four legitimate view shapes — record / container / flat list / flat form — and is a separate spec change.)

- Updated dependencies [06f2bbb]
- Updated dependencies [f01f9fa]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/formula@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/metadata-core@7.8.0
  - @objectstack/types@7.8.0

## 7.7.0

### Patch Changes

- 764c747: fix(metadata): home the metadata-storage objects in metadata-core and register them from ObjectQL

  Standalone "host config" apps boot without `@objectstack/metadata`'s MetadataPlugin, so nobody registered the metadata-storage objects (`sys_metadata`, `_history`, `_audit`, `sys_view_definition`) into ObjectQL — their tables were never schema-synced and ObjectQL's own protocol (`loadMetaFromDb` / `getMetaItems`) failed with `no such table: sys_metadata` on every read.

  - Move the four storage-object definitions from `@objectstack/platform-objects/metadata` to `@objectstack/metadata-core` (the lowest package shared by their real consumers); `platform-objects/metadata` now re-exports them for back-compat.
  - `ObjectQLPlugin` registers these objects itself (gated on `environmentId === undefined`, mirroring `restoreMetadataFromDb`) so their tables always sync on platform/standalone kernels.
  - Gate the SQL driver's tenant-audit warning on actual multi-tenant mode — `organization_id` now exists on every table, so column presence alone no longer implies "tenant-scoped"; single-tenant boots no longer spam the warning for system writes.

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [825ab06]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/formula@7.7.0
  - @objectstack/metadata-core@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/types@7.7.0

## 7.6.0

### Minor Changes

- 7648242: Enforce every declared validation-rule type on the write path; trim the three that can't be (#1475).

  The `validations` union advertised nine rule types but only three (`state_machine`,
  `cross_field`, `script`) ran on insert/update — the other six were accepted by the
  schema yet silently did nothing. This closes that gap on both sides: implement the
  synchronous types, and trim the ones that don't belong in a write-path rule.

  **`@objectstack/objectql` (additive):** the rule evaluator now enforces three more
  types, all deterministic, synchronous, side-effect-free predicates over one record:

  - `format` — a field value against a `regex` and/or a named format
    (`email` / `url` / `phone` / `json`). Runs only when the write touches the field
    and the value is non-empty; a malformed regex fails open.
  - `json_schema` — a JSON field validated against a JSON Schema via `ajv` (compiled
    result memoised per schema). Accepts a parsed object or a JSON string; an
    unparseable string is itself a violation; an uncompilable schema fails open.
  - `conditional` — evaluates `when`, then recurses into `then` / `otherwise`. The
    nested rule supplies the message; the outer conditional's `severity` decides
    blocking. `needsPriorRecord` now recurses into conditional branches.

  Adds `ajv` as a dependency and three error codes (`invalid_format`, `invalid_json`,
  `json_schema_violation`).

  **`@objectstack/spec` (breaking for unused declarations):** removes the
  `unique`, `async`, and `custom` validation-rule variants (and the
  `UniquenessValidationSchema` / `AsyncValidationSchema` / `CustomValidatorSchema`
  exports). They were never enforced and each needs I/O or a handler model a
  write-path rule must not carry. Use the layer that already does each correctly:
  uniqueness → a unique index (`ObjectSchema.indexes`, `partial` for scope) or
  field-level `unique: true`; async/remote → the client form layer; custom code →
  a `beforeInsert` / `beforeUpdate` lifecycle hook. Field-level `unique: true` is
  unaffected.

  `examples/app-showcase` demonstrates and verifies each newly-enforced type. See the
  ADR-0020 addendum for the rationale.

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
  - @objectstack/formula@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/types@7.6.0
  - @objectstack/metadata-core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/types@7.5.0
- @objectstack/metadata-core@7.5.0
- @objectstack/formula@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/types@7.4.1
- @objectstack/metadata-core@7.4.1
- @objectstack/formula@7.4.1

## 7.4.0

### Minor Changes

- 23c7107: ADR-0020 — converge the three "state machine" declaration shapes to one
  **enforced** `state_machine` validation rule.

  Before this change a record state machine could be declared three ways (a
  `workflow` metadata type, an `object.stateMachines` map, or a `state_machine`
  validation rule) and **none of them were enforced at runtime** — a declarative
  guardrail that was pure decoration, and a hallucination trap for AI authors.

  **Enforcement (`@objectstack/objectql`)**

  - New `validation/rule-validator.ts` evaluates the object's `validations` union
    on the write path: `evaluateValidationRules`, `needsPriorRecord`, and the
    `legalNextStates` introspection helper (all exported from the package root).
  - `state_machine` rules reject illegal `field` transitions on update (with the
    rule's `message`); `script` / `cross_field` predicate rules now also fire
    (they were silently broken on PATCH updates because only the patch, not the
    prior record, was available). The engine plumbs the prior record into
    rule evaluation on single-row update; multi-row (`updateMany`) updates log a
    warning and skip rule evaluation rather than enforce on incomplete data.

  **Convergence / retirement (`@objectstack/spec`) — breaking**

  - Retires the `workflow` metadata type (removed from the metadata-type enum,
    the registry, the schema map, the `workflows` collection key, and the
    plural→singular mapping).
  - Removes the `object.stateMachines` map and the `stack.workflows` array. The
    `state_machine` validation rule is the single canonical home.
  - The XState-style `StateMachineSchema` file is **kept** (still used by the
    agent conversation lifecycle and the discovery protocol); only its role as
    the `workflow` metadata-type backing schema was removed. The optional
    `workflow` **RPC service** surface (`CoreServiceName.workflow`,
    `/api/v1/workflow`, `IWorkflowService`) is kept as a documented follow-up.

  **Introspection (`@objectstack/runtime`)**

  - Adds `GET /metadata/objects/:name/state/:field?from=:state`, returning the
    legal next states for a field (`next: null` when no FSM governs the field,
    `[]` for a declared dead-end) so UIs/agents read the transition table instead
    of re-deriving it.

  **Surfaces (`@objectstack/platform-objects`, `@objectstack/cli`)**

  - Studio drops the standalone "Workflow Rules" nav (state machines are edited
    alongside the object's other validation rules).
  - `explain` no longer lists `workflow` as a related metadata type.

  Migration: replace a `workflow` / `StateMachineConfig` declaration with a
  `state_machine` validation rule on the object (`field` + `{ from: [allowedTo] }`
  transition table), and move any side-effecting actions (emails, task creation)
  into a record-triggered or scheduled Flow (ADR-0019). See the migrated
  `examples/app-crm` flows for the pattern.

- c72daad: ADR-0029 D7 — Setup app navigation contributions.

  Adds the UI-layer analog of object `own`/`extend`: a package can contribute
  navigation items into an app it does not own, so a shared admin app can be a
  thin shell while each capability plugin ships the menu for the objects it owns.

  - **`@objectstack/spec`** — new `NavigationContributionSchema` (`{ app, group?,
priority, items }`) and an optional `navigationContributions` field on the
    manifest.
  - **`@objectstack/objectql`** — `SchemaRegistry.registerAppNavContribution()`
    plus lazy merge in `getApp` / `getAllApps` (by target group id + priority,
    cloning so the stored app is never mutated); the engine wires
    `manifest.navigationContributions` during app registration.
  - **`@objectstack/platform-objects`** — the Setup app becomes a **shell** of
    empty group anchors; its entries for platform-objects-owned objects move to
    `SETUP_NAV_CONTRIBUTIONS`.
  - **`@objectstack/plugin-auth`** — registers `SETUP_NAV_CONTRIBUTIONS` alongside
    the Setup app it already registers.
  - **`@objectstack/plugin-webhooks`** — contributes its `Webhooks` /
    `Webhook Deliveries` entries into the Setup `group_integrations` slot (it owns
    `sys_webhook` / `sys_webhook_delivery` per K2.a), demonstrating end-to-end
    cross-plugin contribution.

  The rendered Setup nav is identical to the former static artifact — just
  assembled from its owners. A disabled/absent capability contributes nothing and
  its slot stays empty (in addition to the existing `requiresObject` gating).
  This unblocks moving each remaining K2 domain's menu out of the monolith with
  its objects.

- eea3f1b: ADR-0029 K0 + K2.a — single-owner invariant and webhooks ownership pilot.

  **K0 (`@objectstack/objectql`)** — add `SchemaRegistry.assertSingleOwnerPerObject()`,
  the install-time backstop for the kernel-decomposition invariant: every
  registered object must resolve to exactly one `own` contributor. A second
  cross-package owner is already rejected at registration time; this additionally
  catches "extend with no owner" (which would otherwise resolve to nothing). Call
  after kernel bootstrap completes.

  **K2.a (`@objectstack/plugin-webhooks` ← `@objectstack/platform-objects`)** — move
  the `sys_webhook` object definition out of the `platform-objects` monolith into
  `@objectstack/plugin-webhooks`, where it joins its sibling `sys_webhook_delivery`
  so the plugin owns both its data model and behavior as one unit. `sys_webhook` is
  no longer exported from `@objectstack/platform-objects` (or its `/integration`
  subpath, now an empty barrel); import it from `@objectstack/plugin-webhooks/schema`
  instead. Runtime behavior is unchanged — the webhook plugin already registered
  `sys_webhook` at runtime; only the definition's home moved. Setup-app navigation
  (which references `sys_webhook` by name) and existing i18n bundles (object-name
  keyed) continue to work. Per ADR-0029 D8, migrating the object's i18n extraction
  into the plugin is a tracked follow-up before the next translation regeneration.

- 2faf9f2: External Datasource Federation (ADR-0015) — write gate (Gate 3) + introspection plumbing.

  - Write gate: ObjectQL `insert`/`update`/`delete` now block writes to a
    federated datasource (`schemaMode !== 'managed'`) unless BOTH
    `datasource.external.allowWrites` and `object.external.writable` are true,
    throwing `ExternalWriteForbiddenError` (code `EXTERNAL_WRITE_FORBIDDEN`).
    Managed datasources (and objects without a datasource definition) are
    unaffected. New `registerDatasourceDef()` records declarative datasource
    ownership; manifests carrying `datasources` are indexed during `registerApp`.
  - `engine.introspectDatasource(name)` delegates to the named driver's
    `introspectSchema()`, wiring the external-datasource service end-to-end.

### Patch Changes

- a6d4cbb: Fix conditional & record-change flows silently skipping.

  Two bugs together caused every flow with a start-node / edge **condition** to
  silently skip (record-change triggers fired but the flow body never ran;
  audit-style `previous.*` gates and `budget > 100000`-style gates all evaluated
  to false):

  - **service-automation — CEL engine unreachable in ESM.** The condition
    evaluator loaded the formula engine via a CommonJS `require('@objectstack/formula')`.
    In the package's ESM build (`"type": "module"`) that resolves to tsup's
    throwing `__require` stub, so **every** CEL evaluation threw and the
    swallowing `catch` returned `false`. Replaced with a static top-level import,
    which binds correctly in both the ESM and CJS builds.

  - **objectql — prior record not exposed to update hooks.** `HookContext`
    documents a `previous` snapshot for update/delete, but `engine.update` never
    populated it (the row it fetched for validation was a local var). Record-change
    conditions like `status == "done" && previous.status != "done"` therefore had
    no `previous` to read. The engine now attaches the pre-update record to
    `hookContext.previous` for single-id updates whenever a validation rule needs
    it or an `afterUpdate` hook is registered.

  Both paths are covered by new unit tests.

- 58b450b: Make metadata labels follow the active UI language without a page refresh (#1319).

  The client now carries the active locale on every request (`Accept-Language`,
  `setLocale`/`getLocale`), the protocol ETag is locale-aware so cached metadata
  no longer collides across languages, and the `client-react` metadata hooks
  refetch when the locale changes. The `apps/account` console wires its router
  locale through so a language switch relabels server-resolved object/field/view
  labels in place instead of leaving the UI half-translated until reload.

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
  - @objectstack/core@7.4.0
  - @objectstack/formula@7.4.0
  - @objectstack/types@7.4.0
  - @objectstack/metadata-core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/formula@7.3.0
  - @objectstack/types@7.3.0
  - @objectstack/metadata-core@7.3.0

## 7.2.1

### Patch Changes

- 9096dfe: **`OS_` env-var prefix migration** (issue #1382).

  All ObjectStack-owned environment variables now use the `OS_` prefix. Legacy
  names still work for one release and emit a one-shot deprecation warning via
  the new `readEnvWithDeprecation()` helper in `@objectstack/types`.

  **Renamed (with legacy fallback):**

  | New                       | Legacy (deprecated)                                    |
  | :------------------------ | :----------------------------------------------------- |
  | `OS_AUTH_SECRET`          | `AUTH_SECRET`, `BETTER_AUTH_SECRET`                    |
  | `OS_AUTH_URL`             | `AUTH_BASE_URL`, `BETTER_AUTH_URL`, `OS_AUTH_BASE_URL` |
  | `OS_PORT`                 | `PORT`                                                 |
  | `OS_DATABASE_URL`         | `DATABASE_URL`                                         |
  | `OS_ROOT_DOMAIN`          | `ROOT_DOMAIN`                                          |
  | `OS_MULTI_ORG_ENABLED`    | `OS_MULTI_TENANT`                                      |
  | `OS_CORS_ENABLED`         | `CORS_ENABLED`                                         |
  | `OS_CORS_ORIGIN`          | `CORS_ORIGIN`                                          |
  | `OS_CORS_CREDENTIALS`     | `CORS_CREDENTIALS`                                     |
  | `OS_CORS_MAX_AGE`         | `CORS_MAX_AGE`                                         |
  | `OS_AI_MODEL`             | `AI_MODEL`                                             |
  | `OS_MCP_SERVER_ENABLED`   | `MCP_SERVER_ENABLED`                                   |
  | `OS_MCP_SERVER_NAME`      | `MCP_SERVER_NAME`                                      |
  | `OS_MCP_SERVER_TRANSPORT` | `MCP_SERVER_TRANSPORT`                                 |
  | `OS_NODE_ID`              | `OBJECTSTACK_NODE_ID`                                  |
  | `OS_METADATA_WRITABLE`    | `OBJECTSTACK_METADATA_WRITABLE`                        |
  | `OS_DEV_CRYPTO_KEY`       | `OBJECTSTACK_DEV_CRYPTO_KEY`                           |
  | `OS_HOME`                 | `OBJECTSTACK_HOME`                                     |

  **Migration:** rename in your `.env`. Legacy names continue to work this
  release and will be removed in a future major. Industry-standard names
  (`NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth
  `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`,
  `AI_GATEWAY_*`, `SMTP_*`) are NOT renamed.

- Updated dependencies [9096dfe]
  - @objectstack/types@7.2.1
  - @objectstack/spec@7.2.1
  - @objectstack/core@7.2.1
  - @objectstack/metadata-core@7.2.1
  - @objectstack/formula@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/types@7.2.0
- @objectstack/metadata-core@7.2.0
- @objectstack/formula@7.2.0

## 7.1.0

### Patch Changes

- 47a92f4: Promote `email_template` to a first-class metadata type using the canonical
  `EmailTemplateDefinitionSchema`.

  Previously `email_template` had two competing Zod schemas (Prime Directive
  #8 violation): the legacy `EmailTemplateSchema` (a sub-shape of
  `Notification`) and the richer `EmailTemplateDefinitionSchema`. The runtime
  metadata protocol (`packages/objectql/src/protocol.ts`) and Studio's
  property panel registered the legacy one, which is why all the new fields
  (`name`, `label`, `category`, `locale`, `bodyHtml`, `bodyText`, …) were
  reported as “declared in form layout but missing from schema”.

  This change:

  - Repoints the `email_template` entry in `TYPE_TO_SCHEMA`
    (`packages/objectql/src/protocol.ts`) and in
    `BUILTIN_METADATA_TYPE_SCHEMAS`
    (`packages/spec/src/kernel/metadata-type-schemas.ts`) to
    `EmailTemplateDefinitionSchema`. The legacy `EmailTemplateSchema` is
    kept only as an inline sub-shape inside `Notification`.
  - Adds an `emailTemplates` collection to `defineStack()` input
    (`packages/spec/src/stack.zod.ts`), registers it in
    `MAP_SUPPORTED_FIELDS`/`PLURAL_TO_SINGULAR`
    (`packages/spec/src/shared/metadata-collection.zod.ts`), wires it into
    `ARTIFACT_FIELD_TO_TYPE` (`packages/metadata/src/plugin.ts`) and
    `APP_CATEGORY_KEYS` (`packages/runtime/src/app-plugin.ts`).
  - Rewrites `packages/spec/src/system/email-template.form.ts` for the new
    schema with sections for Identity, Subject, HTML body, Plain-text body,
    Variables, Delivery overrides, Status.
  - Ships three reference templates in `examples/app-crm/src/emails/`:
    `crm.deal_won` (rewritten to canonical shape), `crm.welcome` (new),
    `crm.lead_followup` (new), and wires them into the CRM stack via
    `emailTemplates: Object.values(emails)`.

  End-to-end verified in Studio: list view at
  `/_console/apps/studio/metadata/email_template` shows all three entries;
  the detail view renders the EmailTemplatePreview iframe and the property
  panel cleanly renders every canonical field (no missing-schema warnings).
  `GET /api/v1/meta` now returns the new `properties` set
  (`name, label, category, locale, subject, bodyHtml, bodyText, variables,
fromOverride, replyTo, active, isSystem, description`).

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/formula@7.1.0
  - @objectstack/types@7.1.0
  - @objectstack/metadata-core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/formula@7.0.0
  - @objectstack/types@7.0.0
  - @objectstack/metadata-core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/types@6.9.0
- @objectstack/metadata-core@6.9.0
- @objectstack/formula@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/types@6.8.1
- @objectstack/metadata-core@6.8.1
- @objectstack/formula@6.8.1

## 6.8.0

### Minor Changes

- c8b9f57: Metadata Admin engine — protocol foundations.

  This is the backend half of the unified Metadata Admin shipped in the Setup
  app. The framework now exposes everything the engine needs to render a
  directory tile, schema-driven form, layered diff, references graph, and
  destructive-change confirmation for every registered metadata type.

  - **`GET /api/v1/meta/types`** is now type-rich. Each entry includes
    `{ icon, domain, schema (JSONSchema), allowOrgOverride, allowRuntimeCreate, supportsOverlay, ui? }`
    so the client can render without a second round-trip per type.
  - **`GET /api/v1/meta/:type/:name/references`** scans every registered
    metadata type for pointers to the given item (object fields, view sources,
    flow targets, permission objects, …) and returns the inbound edges so the
    UI can warn before deletes.
  - **`GET /api/v1/meta/:type/:name?layers=code,overlay,effective`** returns
    each layer separately rather than the merged effective document, powering
    the 3-state diff editor (code source / overlay / effective).
  - **Destructive-change detection** on `PUT /api/v1/meta/object/:name` and
    `PUT /api/v1/meta/field/:name`: rejects field type narrowing, required
    toggled on without a default, removed enum values, etc., unless the
    client opts in with `force=true`.
  - **Env-var registry patch:** `OBJECTSTACK_METADATA_WRITABLE=object,field,permission,view,…`
    flips `allowOrgOverride` on for the listed types at boot, enabling
    runtime overlays for production without re-deploying spec.
  - New guide: **[Adding a Metadata Type](../content/docs/guides/adding-a-metadata-type.mdx)**
    walks through registry entry + Zod schema + optional custom editor.

  Setup app navigation now uses the new component-route variant
  (`{ type: 'component', componentRef: 'metadata:directory' }`) — the temporary
  `/dev/meta` route is removed.

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/formula@6.8.0
  - @objectstack/types@6.8.0
  - @objectstack/metadata-core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/types@6.7.1
- @objectstack/metadata-core@6.7.1
- @objectstack/formula@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/formula@6.7.0
  - @objectstack/types@6.7.0
  - @objectstack/metadata-core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/formula@6.6.0
  - @objectstack/types@6.6.0
  - @objectstack/metadata-core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/types@6.5.1
- @objectstack/metadata-core@6.5.1
- @objectstack/formula@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/types@6.5.0
- @objectstack/metadata-core@6.5.0
- @objectstack/formula@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/formula@6.4.0
  - @objectstack/types@6.4.0
  - @objectstack/metadata-core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/types@6.3.0
- @objectstack/metadata-core@6.3.0
- @objectstack/formula@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/formula@6.2.0
  - @objectstack/types@6.2.0
  - @objectstack/metadata-core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/types@6.1.1
- @objectstack/metadata-core@6.1.1
- @objectstack/formula@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/formula@6.1.0
  - @objectstack/types@6.1.0
  - @objectstack/metadata-core@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/formula@6.0.0
  - @objectstack/types@6.0.0
  - @objectstack/metadata-core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/metadata-core@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/formula@5.2.0
  - @objectstack/types@5.2.0

## 5.1.0

### Patch Changes

- 75f4ee6: feat(metadata): introduce `executionPinned` capability for runtime version pinning (ADR-0009)

  Adds a new capability flag on the metadata type registry so that types whose runtime
  transaction rows reference a specific historical version (flow, workflow, approval)
  get unified pinning behavior — instead of every business table re-implementing its
  own snapshot column.

  - `MetadataTypeRegistryEntrySchema` gains `executionPinned: boolean`, enforced
    invariant `executionPinned ⇒ supportsVersioning`.
  - `flow`, `workflow`, `approval` flipped to `executionPinned: true`. `approval`
    also corrected to `supportsVersioning: true` (it was wrongly `false`).
  - `MetadataRepository.getByHash(ref, hash)` added to the interface. Production
    implementation in `SysMetadataRepository` resolves historical bodies through
    `sys_metadata_history` keyed by `(organization_id, type, name, checksum)`.
    In-memory and FS repositories serve HEAD-only matches.
  - `sys_metadata_history` gains an index on `(organization_id, type, name, checksum)`
    to keep hash lookups O(log n).
  - `HistoryCleanupManager` skips pinned types entirely (both age-based and
    count-based retention) — pinned-type history must never be GC'd.

  See `docs/adr/0009-execution-pinned-metadata.md` for full rationale and the
  list of rejected alternatives (no shared snapshot table, no inlined snapshot column).

- 823d559: Remove `sys_metadata_history.metadata_id` column.

  The column was originally a `Field.lookup` FK into `sys_metadata.id`,
  then downgraded to plain `text` during the M1 history-writes work so
  that DELETE tombstones could keep an orphaned ref. After M1 we
  concluded the column carries no business value:

  - Audit-time joins use `(organization_id, type, name, version)`,
    which is already a UNIQUE composite key.
  - The physical row id is a database-internal detail with no logical
    identity — it cannot follow an item through delete + recreate.
  - No code reader was ever added.

  This release removes the column outright:

  - Dropped `metadata_id` from `SysMetadataHistoryObject`
    (`@objectstack/platform-objects`).
  - Dropped `metadataId` from `MetadataHistoryRecordSchema`
    (`@objectstack/spec`).
  - `SysMetadataRepository.put`/`delete` no longer write the column.
  - Legacy `DatabaseLoader.createHistoryRecord` no longer writes it;
    `getHistoryRecord`/`queryHistory` filter by `(type, name)` directly
    (no parent-row lookup needed).
  - `MetadataHistoryCleanup` `maxVersions` policy groups by
    `(type, name)` instead of `metadata_id`.

  **Migration**: Drop the column from existing `sys_metadata_history`
  tables in a follow-up SQL migration. Existing history rows remain
  queryable since `(organization_id, type, name, version)` is already
  the canonical lookup key. No consumer code should be reading
  `metadata_id` — if you are, switch to `(organization_id, type, name,
version)`.

  See ADR-0008 §14 for the full rationale.

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/metadata-core@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/formula@5.1.0
  - @objectstack/types@5.1.0

## 5.0.0

### Minor Changes

- 5e9dcb4: **BREAKING — metadata: remove `project` and `branch` from `MetaRef`**

  The metadata layer no longer models project or branch. Customisation is now
  scoped purely to **organisation**. Project remains exclusively as an artifact
  packaging concept (the `objectstack.json` bundle envelope); branching is left
  to Git.

  What changed:

  - `MetaRef` is now `{ org, type, name, version? }` (was
    `{ org, project, branch, type, name, version? }`). `refKey()` is the two
    segment string `${org}/${type}/${name}` (was five segments).
  - `MetadataItem.seq` is monotonic **per org** (was per branch).
  - `BranchRef`, `MergeStrategy`, `MergeResult` types and the optional
    `fork`/`merge` methods on `MetadataRepository` are removed.
  - `ListFilter` / `WatchFilter` / `HistoryOptions` no longer accept `project`
    or `branch`.
  - `FileSystemRepository` disk layout simplified to
    `<root>/<type>/<name>.json` (was `<root>/<project>/<branch>/<type>/<name>.json`);
    change-log path is now `.objectstack/.log/main.jsonl` regardless of any
    branch concept. Constructor no longer accepts `project` / `branch`.
  - `SysMetadataRepository`: removed `projectLabel` / `branchLabel` options;
    the `sys_metadata` schema's `project_id` / `branch` columns (if present)
    are ignored. A future major release will `DROP` them.
  - `MetadataManager.setRepository(repo, opts)` no longer takes an opts object
    with `branch`.

  Migration:

  ```diff
  -const ref = { org: 'acme', project: 'crm', branch: 'main', type: 'view', name: 'home' };
  +const ref = { org: 'acme', type: 'view', name: 'home' };

  -new FileSystemRepository({ root, org: 'acme', project: 'crm', branch: 'main' });
  +new FileSystemRepository({ root, org: 'acme' });
  ```

  Existing `sys_metadata` rows continue to load; the deprecated columns are
  ignored at read time.

- f139a24: Subscribe `ObjectQLPlugin` to `metadata.subscribe('object', …)` so the
  `SchemaRegistry` merge cache is invalidated and the affected object
  re-registered on every object metadata change (ADR-0008 M0 PR-7).

  Combined with the PR-6 metadata ↔ repository bridge, this closes the
  Studio HMR loop end-to-end: editing an object definition (file, REST
  write, or Studio inline edit) emits a `MetadataEvent`, which flows
  through `MetadataManager.subscribe('object', …)` into ObjectQL, which
  drops the cached merged definition and re-fetches the canonical body
  from the metadata service. Subsequent reads see the new schema with
  no server restart.

  Additions:

  - `SchemaRegistry.invalidate(fqnOrName)` and `invalidateAll()` —
    public hooks for event-driven cache eviction; contributors are
    preserved so `resolveObject` recomputes against the next call.
  - `ObjectQLPlugin.start()` wires the subscription when the metadata
    service exposes `subscribe()`. The handler invalidates, re-fetches
    via `metadata.get('object', name)`, and re-registers with the
    original `packageId` / `namespace`. Deletes only invalidate.
  - `ObjectQLPlugin.stop()` drains the subscription handles so test
    reloads don't leak watchers.

- 2f7e42a: ADR-0008 M0 PR-10b: introduce `SysMetadataRepository` — a
  `MetadataRepository` wrapper over the existing `sys_metadata` table.
  M0 keeps single-row update semantics (append-only event log is M1
  work). Whitelist enforcement, optimistic locking via content hash,
  and in-process watch fan-out are all live. Not yet wired into any
  production write path — PR-10c will compose it under a
  LayeredRepository.
- 888a5c1: PR-10d.3 — feature flag for `SysMetadataRepository.put` write path in `saveMetaItem`.

  - `ObjectStackProtocolImplementation` now accepts an `options.useRepositoryWritePath` flag
    (also honored via `OBJECTSTACK_USE_REPOSITORY_WRITE_PATH=1`) that routes overlay writes
    through `SysMetadataRepository.put`, appending to the change-log and emitting HMR `seq`.
  - `saveMetaItem` request grew optional `parentVersion` (If-Match) and `actor` fields.
    `ConflictError` is mapped to a 409 `metadata_conflict` API error.
  - Plural metadata type aliases (`views`, `dashboards`, ...) are normalized to singular
    before the repo's overlay-allowlist gate.
  - `SysMetadataRepository.put`/`delete` now update/delete by row `id` (the engine's
    strict `.update` semantics require an id or `multi:true`).
  - `sys_metadata.checksum` column widened from 64 → 71 chars to hold the `"sha256:"`
    prefix produced by `hashSpec()`.
  - Default behaviour unchanged: legacy raw-engine path remains until PR-10d.4 flips the
    flag and removes it.

- 09f005a: PR-10d.5 — Flip default of `useRepositoryWritePath` to `true`.

  `saveMetaItem` now routes overlay-allowed metadata types (view, dashboard,
  report, email_template) through `SysMetadataRepository.put` by default —
  every write appends to the change log and emits a watch event with a
  monotonic `seq` for HMR / replay.

  Non-overlay-allowed types (`object`, `flow`, `agent`, ...) still take the
  legacy raw-engine path. This preserves control-plane bootstrap behaviour
  (which writes `object`/`flow` definitions via `saveMetaItem` and is
  permitted by the outer protocol gate to write any type when `projectId`
  is undefined).

  Opt-out remains available during the deprecation window:

  - Constructor: `new ObjectStackProtocolImplementation(engine, …, { useRepositoryWritePath: false })`
  - Env var: `OBJECTSTACK_USE_REPOSITORY_WRITE_PATH=0`

  The legacy raw-engine branch for overlay-allowed types is scheduled for
  removal in PR-10d.6 once this default has soaked for one release.

### Patch Changes

- 4eb9f8c: ADR-0008 M0 PR-10a: pin overlay-whitelist + canonical-hash invariants
  before re-expressing the overlay path as a LayeredRepository. No
  runtime change — adds 28 regression tests that fail loud if a future
  PR weakens the shared-DB tenancy contract or breaks hash stability.
- 602cce7: test(objectql): integration coverage for `LayeredRepository` composed of
  `SysMetadataRepository` (top, writable overlay) over `InMemoryRepository`
  (bottom, artifact baseline). Verifies read fallthrough, overlay-wins
  precedence, write routing, delete behavior, event source tagging across
  layers, and merged-list semantics. Part of ADR-0008 PR-10c.
- 1e625b8: feat(objectql): hash-compat dry-run probe for the legacy → repository
  write-path migration (ADR-0008 PR-10d.1). Pure-function `runDryRun()` plus
  a CLI (`scripts/dry-run-hash-compat.ts`) that audits a snapshot of
  `sys_metadata` for invalid JSON, non-object bodies, unstable hashes across
  canonical round-trip, and duplicate overlay keys. Exits non-zero when
  incompatibilities are found. 14 unit tests covering happy paths, error
  classifications (`invalid_json`, `non_object_body`, `unstable_hash`,
  `missing_metadata`, `duplicate_overlay_key`), and boundary conditions
  (empty snapshot, deep nesting, unicode).
- 6ee42b8: fix(objectql): SysMetadataRepository reuses the existing `checksum` column
  instead of writing a non-existent `_hash` column (ADR-0008 PR-10d.2). The
  production `sys_metadata` schema (`packages/platform-objects`) already
  ships with `checksum: text(64)` — perfect for sha256 hex — and `version:
number` for the monotonic counter. No DDL migration is required for
  PR-10d.3 cutover; legacy rows with NULL checksum will be lazily
  backfilled on first put().

  Also extends the PR-10d.1 dry-run probe with two new checks
  (`checksum_missing` warning, `checksum_drift` error) and three additional
  tests, taking objectql to 325/325 green.

- 5cfdc85: PR-10d.4 — REST plumbing for the metadata repository write path.

  - `PUT /api/v1/meta/:type/:name` (and the compound `:type/:section/:name` variant)
    now forwards the `If-Match` header to `saveMetaItem` as `parentVersion`, and
    `X-Actor` (or `req.user.id`) as `actor`. ETag-style quotes are stripped.
  - A failed optimistic-lock check surfaces as HTTP 409 with body
    `{ "error": "...", "code": "metadata_conflict" }` (no protocol changes —
    `sendError` already honoured `error.status` + `error.code`).
  - Added a real-engine integration test for the repository write path
    (`protocol-save-meta-repo-path-real-engine.test.ts`) — addresses the
    PR-10d.3 rubber-duck stub-drift concern by exercising
    `ObjectStackProtocolImplementation.saveMetaItem` through `new ObjectQL()`
    with an inline in-memory driver. Covers insert→update version bump,
    parentVersion conflict, checksum length, and plural→singular normalization.

  Default behaviour unchanged: the repository write path remains opt-in via
  `options.useRepositoryWritePath` / `OBJECTSTACK_USE_REPOSITORY_WRITE_PATH=1`.
  Flag flip and legacy path removal will follow in a separate post-soak PR.

- 7825394: PR-10d.6 — remove `useRepositoryWritePath` feature flag.

  Overlay-allowed metadata types (`view`, `dashboard`, `report`,
  `email_template`) now unconditionally route through
  `SysMetadataRepository.put` (change-log + HMR `seq`). The legacy
  raw-engine branch is retained for non-overlay types (`object`, `flow`,
  `agent`, etc.) used during control-plane bootstrap, since the repository
  `assertAllowed()` whitelist would reject them.

  Removed:

  - `ObjectStackProtocolImplementation` constructor option
    `{ useRepositoryWritePath: boolean }`.
  - `OBJECTSTACK_USE_REPOSITORY_WRITE_PATH` environment variable.

  There is no opt-out: behavior is now equivalent to the PR-10d.5 default.

- 96ad4df: Fix dev-mode HMR data-reload for `*.view.ts` / `*.flow.ts` source-file edits.

  Three coordinated fixes close the long-standing gap where editing a
  declarative-metadata source file in dev (e.g. `case.view.ts`) would
  recompile `dist/objectstack.json` but the running server kept serving
  the stale boot-time value:

  1. **`@objectstack/objectql`** — `ObjectStackProtocolImplementation.getMetaItem`
     now consults `MetadataService` (HMR-aware) **before** the in-memory
     `SchemaRegistry` (boot-time cache). Previously the registry shadowed
     freshly-registered values: `manager.register('view','case',newDef)`
     updated MetadataManager but `getMetaItem` returned the stale registry
     copy because step 2 (registry) ran before step 3 (service). Reordered
     to "1. sys_metadata overlay → 2. MetadataService → 3. SchemaRegistry".

  2. **`@objectstack/runtime`** — `createStandaloneStack` now enables the
     `MetadataPlugin` artifact-file watcher in non-production environments
     (`NODE_ENV !== 'production'`). Previously hard-coded to `watch: false`,
     leaving nothing watching `dist/objectstack.json` when the CLI dev mode
     recompiled it.

  3. **`@objectstack/metadata`** & **`@objectstack/metadata-fs`** — Both
     chokidar watchers now use `usePolling: true` to avoid `fs.watch`
     EMFILE on macOS / busy dev hosts where the native file-descriptor
     pool can be exhausted by other long-running node processes.

  With these three changes:

  - CLI edits source → recompile artifact (~400ms)
  - Server's polling chokidar detects artifact change → `_loadFromLocalFile`
  - `_loadFromLocalFile` calls `manager.register(type, name, item)`
  - MetadataService now has the fresh value
  - Read path returns the fresh value via the new step-2 lookup
  - Studio SSE listeners re-render

- Updated dependencies [5e9dcb4]
- Updated dependencies [4150fe4]
- Updated dependencies [8337cdb]
- Updated dependencies [58835a6]
- Updated dependencies [8cc30b4]
- Updated dependencies [32ce912]
- Updated dependencies [2f9073a]
  - @objectstack/metadata-core@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/formula@5.0.0
  - @objectstack/types@5.0.0

## 4.2.0

### Minor Changes

- 2869891: feat: Optimistic Concurrency Control (OCC) via `If-Match`

  Update and Delete requests now accept an optional version token. When supplied,
  the protocol compares it against the record's current `updated_at` (or `version`
  column when available) and rejects with `409 CONCURRENT_UPDATE` on mismatch,
  preventing silent overwrites when two clients edit the same record.

  **Wire formats** (opt-in, all server- and client-backward-compatible):

  - `PATCH /data/{object}/{id}` — supports `If-Match: "<token>"` header
    _or_ `expectedVersion: "<token>"` body field (body wins when both present).
  - `DELETE /data/{object}/{id}` — supports `If-Match` header _or_
    `?expectedVersion=...` query param.
  - Conflict response: `409 { error, code: 'CONCURRENT_UPDATE', currentVersion,
currentRecord }` so the client can offer Reload / Overwrite / Cancel UX.

  **Behaviour**

  - Missing/empty version → no check (legacy callers unaffected).
  - Record not found during the version probe → no check; the downstream write
    produces a normal `404`.
  - Object has no `updated_at` column → no check (explicit opt-out for objects
    without timestamps).
  - Quoted RFC-7232 tokens (`"…"`) are accepted and unquoted before comparison.

  **Client**

  `client.data.update(resource, id, data, { ifMatch })` and
  `client.data.delete(resource, id, { ifMatch })` now forward the token as an
  `If-Match` header.

  Application-level CAS (findOne + compare in protocol.ts) is used in this slice
  to avoid touching every storage driver. A small TOCTOU window remains; for the
  B2B record-editing latencies this protects against, it is more than sufficient.
  Drivers may later be upgraded to atomic `WHERE id=? AND updated_at=?` writes
  for true CAS without changing the public API.

  Tests: 7 new cases in `protocol-data.test.ts` cover opt-in, match, mismatch,
  quote-stripping, no-timestamps, empty-token, and the delete path.

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/formula@4.2.0
  - @objectstack/types@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/types@4.1.1
- @objectstack/formula@4.1.1

## 4.1.0

### Minor Changes

- f0b3972: **Driver-level tenant isolation for objects with `organization_id`.**

  `SqlDriver` now auto-applies a `WHERE organization_id = :tenantId` predicate on every read/update/delete and auto-injects the column on insert when the caller passes `options.tenantId` and the object schema declares an `organization_id` field. `bulkCreate`, `bulkDelete`, `updateMany`, `deleteMany`, `count` and `aggregate` are all scoped.

  ObjectQL's engine now threads `ExecutionContext.tenantId` into the driver options for every CRUD entry point (including `expandRelatedRecords`), so a tenant-scoped session can no longer cross tenants — even through lookup expansion or count fallbacks.

  Backward compatible: callers that omit `tenantId` (system tasks, seed scripts) keep getting unscoped behaviour. Explicit `organization_id` on an insert row always wins over the contextual `tenantId` so admin tooling can still target a specific tenant.

  13 new tests in `sql-driver-tenant-scope.test.ts` verify cross-tenant find/findOne/update/delete/count/bulkCreate/updateMany/deleteMany isolation, the unscoped admin path, and that global objects (no `organization_id`) are not scoped.

### Patch Changes

- 5683206: Document the tenant-isolation bypass on raw `execute()` (both `SqlDriver.execute()` and `engine.execute()`). The behaviour is unchanged — `execute()` has always passed commands through verbatim — but the JSDoc now spells out the security contract so callers know they must inline `WHERE organization_id = ?` themselves or restrict raw execution to genuinely global statements (migrations, control-plane tables).
- 0e63f2f: **Declarative tenant scoping + audit warn for missing tenantId.**

  `SqlDriver` now reads `obj.tenancy.tenantField` first when picking the tenant column for an object, falling back to the implicit `organization_id` detection so legacy objects keep working without a spec migration. Set `tenancy: { enabled: true, strategy: 'shared', tenantField: 'workspace_id' }` on any object to use a custom column.

  Writes (`create`, `update`, `delete`, `bulkCreate`, `bulkDelete`, `updateMany`, `deleteMany`, `upsert`) that target a tenant-scoped object **without** `options.tenantId` now emit one `[tenant-audit]` warning per `{object}:{op}` so missing-context bugs surface in CI/logs instead of silently writing globally. The engine auto-silences when `ExecutionContext.isSystem === true` (boot-time seeds, kernel mirrors). Callers can opt out per-call with `options.bypassTenantAudit = true` or globally with `OS_TENANT_AUDIT=0`.

  Driver README now documents the full scope/bypass matrix and the audit warning.

  Three new tests cover the declared-tenant-field path, the audit throttle, and the bypass flag.

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/formula@4.1.0
  - @objectstack/types@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/types@4.0.5
  - @objectstack/formula@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4
  - @objectstack/types@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3
- @objectstack/types@4.0.3

## 4.0.3

### Patch Changes

- fix: ObjectQL.init() now tracks and warns about failed driver connections instead of silently swallowing errors, improving debuggability for cold-start and serverless issues.

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2
  - @objectstack/types@4.0.2

## 4.0.0

### Minor Changes

- e0b0a78: Deprecate DataEngineQueryOptions in favor of QueryAST-aligned EngineQueryOptions.

  Engine, Protocol, and Client now use standard QueryAST parameter names:

  - `filter` → `where`
  - `select` → `fields`
  - `sort` → `orderBy`
  - `skip` → `offset`
  - `populate` → `expand`
  - `top` → `limit`

  The old DataEngine\* schemas and types are preserved with `@deprecated` markers for backward compatibility.

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0
  - @objectstack/types@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1
- @objectstack/types@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0
- @objectstack/types@3.3.0

## 3.2.9

### Patch Changes

- c3065dd: fix turso 2
  - @objectstack/spec@3.2.9
  - @objectstack/core@3.2.9
  - @objectstack/types@3.2.9

## 3.2.8

### Patch Changes

- Auto-sync all registered object schemas to database on startup: `ObjectQLPlugin.start()` now iterates every object in `SchemaRegistry` and calls `driver.syncSchema()` after driver connections are established. This ensures tables for plugin-registered objects (e.g. `sys_user` from plugin-auth) are created or updated automatically.
- Added `getDriverForObject(objectName)` public method to `ObjectQL` engine for resolving the responsible driver for a given object.
- Added optional `syncSchema` method to `DriverInterface` contract, aligning it with the full `IDataDriver` protocol.
- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8
- @objectstack/types@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7
- @objectstack/types@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6
- @objectstack/types@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5
- @objectstack/types@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4
- @objectstack/types@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3
- @objectstack/types@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2
  - @objectstack/types@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1
  - @objectstack/types@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0
  - @objectstack/types@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1
  - @objectstack/types@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0
  - @objectstack/types@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11
  - @objectstack/types@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10
  - @objectstack/types@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9
  - @objectstack/types@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8
  - @objectstack/types@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7
  - @objectstack/types@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6
  - @objectstack/types@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5
  - @objectstack/types@3.0.5

## 3.0.4

### Patch Changes

- 437b0b8: feat(objectql): add utility functions, introspection types, and kernel factory

  Upstream key functionality from downstream `@objectql/core` to enable its future deprecation:

  - **Introspection types**: `IntrospectedSchema`, `IntrospectedTable`, `IntrospectedColumn`, `IntrospectedForeignKey`
  - **Utility functions**: `toTitleCase()`, `convertIntrospectedSchemaToObjects()`
  - **Kernel factory**: `createObjectQLKernel()` with `ObjectQLKernelOptions`

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4
  - @objectstack/core@3.0.4
  - @objectstack/types@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3
  - @objectstack/types@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2
  - @objectstack/types@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1
  - @objectstack/types@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0
  - @objectstack/types@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7
  - @objectstack/types@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6
  - @objectstack/types@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5
  - @objectstack/types@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4
  - @objectstack/types@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/core@2.0.3
  - @objectstack/types@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/core@2.0.2
  - @objectstack/types@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/core@2.0.1
  - @objectstack/types@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0
  - @objectstack/types@2.0.0

## 1.0.12

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.12
  - @objectstack/core@1.0.12
  - @objectstack/types@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/spec@1.0.11
- @objectstack/core@1.0.11
- @objectstack/types@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [10f52e1]
  - @objectstack/core@1.0.10
  - @objectstack/spec@1.0.10
  - @objectstack/types@1.0.10

## 1.0.9

### Patch Changes

- b9f8c68: fix: handle async metadata service detection safely to prevent startup crash
  - @objectstack/spec@1.0.9
  - @objectstack/core@1.0.9
  - @objectstack/types@1.0.9

## 1.0.8

### Patch Changes

- @objectstack/spec@1.0.8
- @objectstack/core@1.0.8
- @objectstack/types@1.0.8

## 1.0.7

### Patch Changes

- @objectstack/spec@1.0.7
- @objectstack/core@1.0.7
- @objectstack/types@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6
  - @objectstack/core@1.0.6
  - @objectstack/types@1.0.6

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance
- Updated dependencies [b1d24bd]
  - @objectstack/core@1.0.5
  - @objectstack/types@1.0.5
  - @objectstack/spec@1.0.5

## 1.0.4

### Patch Changes

- 5d13533: refactor: fix service registration compatibility and improve logging
  - plugin-hono-server: register 'http.server' service alias to match core requirements
  - plugin-hono-server: fix console log to show the actual bound port instead of configured port
  - plugin-hono-server: reduce log verbosity (moved non-essential logs to debug level)
  - objectql: automatically register 'metadata', 'data', 'and 'auth' services during initialization to satisfy kernel contracts
  - cli: fix race condition in `serve` command by awaiting plugin registration calls (`kernel.use`)
  - @objectstack/spec@1.0.4
  - @objectstack/core@1.0.4
  - @objectstack/types@1.0.4

## 1.0.3

### Patch Changes

- 22a48f0: refactor: fix service registration compatibility and improve logging
  - plugin-hono-server: register 'http.server' service alias to match core requirements
  - plugin-hono-server: fix console log to show the actual bound port instead of configured port
  - plugin-hono-server: reduce log verbosity (moved non-essential logs to debug level)
  - objectql: automatically register 'metadata', 'data', 'and 'auth' services during initialization to satisfy kernel contracts
- Updated dependencies [fb2eabd]
  - @objectstack/core@1.0.3
  - @objectstack/spec@1.0.3
  - @objectstack/types@1.0.3

## 1.0.2

### Patch Changes

- a0a6c85: Infrastructure and development tooling improvements

  - Add changeset configuration for automated version management
  - Add comprehensive GitHub Actions workflows (CI, CodeQL, linting, releases)
  - Add development configuration files (.cursorrules, .github/prompts)
  - Add documentation files (ARCHITECTURE.md, CONTRIBUTING.md, workflows docs)
  - Update test script configuration in package.json
  - Add @objectstack/cli to devDependencies for better development experience

- 109fc5b: Unified patch release to align all package versions.
- Updated dependencies [a0a6c85]
- Updated dependencies [109fc5b]
  - @objectstack/spec@1.0.2
  - @objectstack/core@1.0.2
  - @objectstack/types@1.0.2

## 1.0.1

### Patch Changes

- @objectstack/spec@1.0.1
- @objectstack/core@1.0.1
- @objectstack/types@1.0.1

## 1.0.0

### Major Changes

- Major version release for ObjectStack Protocol v1.0.
  - Stabilized Protocol Definitions
  - Enhanced Runtime Plugin Support
  - Fixed Type Compliance across Monorepo

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0
  - @objectstack/types@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2
  - @objectstack/core@0.9.2
  - @objectstack/types@0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.
- Updated dependencies
  - @objectstack/spec@0.9.1
  - @objectstack/core@0.9.1
  - @objectstack/types@0.9.1

## 0.8.2

### Patch Changes

- 555e6a7: Refactor: Deprecated View Storage protocol in favor of Metadata Views.

  - **BREAKING**: Removed `view-storage.zod.ts` and `ViewStorage` related types from `@objectstack/spec`.
  - **BREAKING**: Removed `createView`, `updateView`, `deleteView`, `listViews` from `ObjectStackProtocol` interface.
  - **BREAKING**: Removed in-memory View Storage implementation from `@objectstack/objectql`.
  - **UPDATE**: `@objectstack/plugin-msw` now dynamically loads `@objectstack/objectql` to avoid hard dependencies.

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2
  - @objectstack/core@0.8.2
  - @objectstack/types@0.8.2

## 0.8.1

### Patch Changes

- @objectstack/spec@0.8.1
- @objectstack/core@0.8.1
- @objectstack/types@0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0
  - @objectstack/types@1.0.0

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas
- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2
  - @objectstack/core@0.7.2
  - @objectstack/types@0.7.2

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.7.1
  - @objectstack/types@0.7.1
  - @objectstack/core@0.7.1

## 0.6.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.6.1
  - @objectstack/types@0.6.1
  - @objectstack/core@0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

### Patch Changes

- Updated dependencies [b2df5f7]
  - @objectstack/spec@0.6.0
  - @objectstack/types@0.6.0
  - @objectstack/core@0.6.0

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2
- Updated dependencies
  - @objectstack/spec@0.4.2

## 0.4.1

### Patch Changes

- Version synchronization and dependency updates

  - Synchronized plugin-msw version to 0.4.1
  - Updated runtime peer dependency versions to ^0.4.1
  - Fixed internal dependency version mismatches

- Updated dependencies
  - @objectstack/spec@0.4.1

## 0.4.0

### Minor Changes

- Release version 0.4.0

## 0.3.3

### Patch Changes

- Workflow and configuration improvements

  - Enhanced GitHub workflows for CI, release, and PR automation
  - Added comprehensive prompt templates for different protocol areas
  - Improved project documentation and automation guides
  - Updated changeset configuration
  - Added cursor rules for better development experience

- Updated dependencies
  - @objectstack/spec@0.3.3

## 0.3.2

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.3.2

## 0.3.1

### Patch Changes

- @objectstack/spec@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 0.2.0

### Minor Changes

- Initial release of ObjectStack Protocol & Specification packages

  This is the first public release of the ObjectStack ecosystem, providing:

  - Core protocol definitions and TypeScript types
  - ObjectQL query language and runtime
  - Memory driver for in-memory data storage
  - Client library for interacting with ObjectStack
  - Hono server plugin for REST API endpoints
  - Complete JSON schema generation for all specifications

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.2.0

## 0.1.1

### Patch Changes

- Remove debug logs from registry and protocol modules
- Updated dependencies
  - @objectstack/spec@0.1.2
