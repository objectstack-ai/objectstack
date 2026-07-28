# @objectstack/plugin-trigger-record-change

## 17.0.0-rc.0

### Minor Changes

- 6f55c63: feat(trigger-record-change): `record-after-write` fires one flow on create OR update (#3427)

  A `record_change` flow's `start` node bound to exactly one lifecycle event via
  `triggerType`, so a rule meant to run on both insert and update ("recompute the
  SLA whenever a case is created or its priority changes") forced authors to
  duplicate the whole flow — two near-identical definitions that drift.

  Adds `record-after-write` and `record-before-write` as the **create-OR-update
  union** trigger tokens. One `start` node binds both lifecycle hooks
  (`afterInsert` + `afterUpdate`) under the same flow; exactly one fires per
  mutation (a write is an insert _xor_ an update), so it is not a double run.
  `delete` is deliberately excluded — a write persists field data, a delete
  removes the row. To branch on which event fired inside the flow, test
  `previous` (empty on create, populated on update).

  - `triggerTypeToHookEvents(triggerType)` (new, plural) is the canonical mapper:
    it returns the list of hook events a token binds, expanding `write` to both.
    `triggerTypeToHookEvent` (singular) is kept for back-compat and now returns
    `null` for the multi-event `write` tokens rather than silently dropping a
    binding.
  - The engine already forwards any `record-*` token through to this trigger, so
    no engine, lint, or spec change is needed — the trigger owns the vocabulary.

  Documented under Automation › Flows (Create-or-update flow) and the trigger's
  README.

### Patch Changes

- 9dcc0ae: fix(automation): array-form flow `triggerType` fails loudly instead of silently never firing (#3481)

  An array `triggerType` on a flow start node — the shape an author (or an AI
  authoring pass) naturally reaches for to fire on more than one event, e.g.

  ```ts
  config: { objectName: 'app_task', triggerType: ['record-after-create', 'record-after-delete'] }
  ```

  was accepted everywhere and armed nowhere. Multi-event unions are deliberately
  unsupported (only the single tokens plus the `record-after-write` create-OR-update
  union exist — see #3457), but nothing said so: `defineFlow` passed the array
  (start-node `config` is an open record), the engine's `typeof === 'string'` check
  folded it to no trigger and misclassified the flow as **manual**, so it never
  entered the trigger-binding audit, and the flow-trigger-readiness lint used the
  same `typeof` narrowing and produced no finding. The flow bound to nothing and
  never fired, with zero output at any layer — the same silent-never-fire class as
  #3427 / #3472, and the last authoring shape still slipping past every guard.

  This is a **defensive** fix — arrays remain unsupported; they now fail loudly:

  - **lint** (`validate-flow-trigger-readiness`): an array `triggerType` containing
    any `record-*` element now yields a `flow-trigger-unknown-event` warning at
    `os validate` time, steering to `record-after-write` (for created-or-updated) or
    one flow per event.
  - **engine** (`resolveTriggerBinding`): such an array is routed to the
    `record_change` trigger — exactly as an unmappable single token is — instead of
    being folded to a manual flow, so it reaches the trigger's bind-time rejection.
  - **trigger** (`record-change`): the bind-time rejection detects the array shape
    and emits a targeted warning (naming the flow, pointing at `record-after-write`
    and #3457) rather than the generic unknown-token line.

- 169b58a: fix(#3426): build-time warning for unresolvable flow template paths + guard the formula re-read

  Two follow-ups to #3426 (the formula/lookup `{record.<path>}` template gap that #3445 began closing).

  **Build-time signal (the issue's fallback ask).** `os validate` now flags a
  record-change flow node whose `{record.<path>}` template cannot resolve —
  turning the previous SILENT blank into an advisory warning. Two cases, via the
  new `@objectstack/lint` rule `validateFlowTemplatePaths`:

  - `flow-template-unknown-field` — `{record.<x>}` where `<x>` is neither a
    declared field nor a system column (a typo like `{record.full_naem}`).
  - `flow-template-lookup-traversal` — `{record.<lookup>.<field>}`, a cross-object
    hop the seeded record carries only as a scalar id (still unsupported; tracked
    on #3426).

  Deliberately quiet: formula fields, bare lookup ids, numeric indexes into
  `multiple` lookups (#1872), `json` sub-paths, and system columns are NOT flagged,
  and flows bound to an object this stack does not define are skipped (no schema to
  compare against).

  **Hydration re-read guards.** The `trigger-record-change` computed-field re-read
  (#3445) is now (a) skipped when the object declares no `formula` field — the only
  thing it adds — via the engine's optional `getObjectConfig`, and (b) memoized per
  write on the shared HookContext, so N flows on one written record share ONE
  re-read instead of N. Any uncertainty falls back to the prior unconditional
  re-read (correctness over the optimization).

- 1dc94f0: fix(trigger-record-change): hydrate read-time formula fields onto the seeded flow record (#3426)

  A `formula` field is a read-time virtual — the engine evaluates it post-fetch on
  `find`/`findOne`, never on the write path — so it was absent from the raw
  after-create/after-update row a record-change flow is seeded with. A notify
  node template like `{record.full_name}` (or a start condition on the same field)
  therefore resolved to an empty string, silently emitting notifications such as
  `"New lead to assign: "` with the name missing.

  The record-change trigger now re-reads the just-written record through the data
  engine, so the seeded `record` carries the same computed fields a data-API read
  returns. The fix is at the trigger (the producer of the flow's `record`), so it
  benefits the whole flow — start condition, every node, and notify `title`/`body`
  templates — not just the notify node.

  Deliberately conservative:

  - Runs only for `afterInsert` / `afterUpdate` (the row exists in its post-write
    state); `before*` and `afterDelete` keep the raw hook record untouched.
  - Reads as an elevated system principal, so it can only ADD computed fields,
    never let RLS/FLS on the re-read shrink the snapshot the flow already saw.
  - Raw hook fields win on merge, preserving trigger-time scalar values and the
    #1872 multi-lookup input overlay; the re-read only fills in keys the raw row
    lacks (the formula virtuals).
  - Any failure (no read surface, no id, a throw, an empty read) falls back to the
    raw record — hydration never breaks the flow it feeds.

  Lookup **traversal** (`{record.account.name}`) is intentionally not hydrated: a
  default data-API read does not expand relations either, and expanding would turn
  `record.account` from its scalar FK id into an object, breaking templates and
  conditions that use the bare id (e.g. #1872's `{record.target_channels.0}`).
  That traversal remains tracked on #3426.

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
  - @objectstack/core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- b20201f: fix(service-automation): `runAs:'user'` runs data ops with the triggering user's
  real permission sets + positions, not a bare member fallback (#3356, follow-up to
  #1888)

  Since #1888 the automation engine honours `flow.runAs` (`system` elevates), but
  the `runAs:'user'` credential propagation was hollow. A record-change-triggered
  `runAs:'user'` flow ran its data nodes (`update_record`, …) with a **zero-grant**
  principal — only the `member`/`everyone` baseline — even when the triggering user
  was fully authorized. Two faces by object config: a `private` object 403'd the
  in-flow write (`not permitted for positions [org_member, everyone]` — the user's
  permission sets were invisible); a `public_read_write` object let the write
  through but **silently stripped** readonly/FLS-gated fields. The root cause: the
  ObjectQL record-change hook session carries only a `userId` — never the writer's
  positions/permission sets — and nothing in between resolved them, so the comment
  promising "enforces RLS exactly as the user who made the change" never held.

  The fix resolves the triggering user's **actual** authorization at run setup, from
  the same tables a direct REST request resolves through:

  - **`@objectstack/core`** factors the userId-driven core of `resolveAuthzContext`
    into a new exported `resolveUserAuthzGrants(ql, userId, opts)` — the single place
    that reads `sys_member` / `sys_user_position` / `sys_*_permission_set` and
    derives positions, permission-set names, `platform_admin`, and posture. The
    HTTP resolver now delegates to it (behaviour byte-identical; the full contract
    suite still passes), so a non-HTTP surface that already knows the user id builds
    the SAME envelope instead of re-implementing the reads.
  - **`@objectstack/service-automation`** gains `AutomationEngine.setUserGrantsResolver`,
    wired by the plugin to `resolveUserAuthzGrants` over the objectql/data engine.
    For a `runAs:'user'` run whose trigger left the authz envelope unresolved (no
    `permissions`), the engine now resolves the user's positions + permission sets
    once at run setup and threads them into every data node's ObjectQL context —
    so the run enforces RLS/FLS exactly as that user. Contexts that already carry
    `permissions` are left untouched (a REST trigger, and notably an ADR-0090 agent
    ceiling acting on-behalf-of a user — always non-empty — so a deliberately
    narrowed identity is never re-broadened). `runAs:'system'` is unchanged, and a
    resolver error fails safe (warns, keeps the bare user — never elevates).
  - **`@objectstack/trigger-record-change`** stops forwarding the misleading
    half-populated `positions` (empty in practice, and never `permissions`) from the
    hook session; it forwards `userId` + tenant only and lets the engine resolve the
    full grants authoritatively.

  When no ObjectQL engine is present (bare engine / tests) the resolver is unwired
  and run identity is unchanged from before.

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0

## 16.0.0

### Minor Changes

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

### Patch Changes

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
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
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
- Updated dependencies [290e2f0]
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
  - @objectstack/core@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

### Patch Changes

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

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
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
  - @objectstack/core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1

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
  - @objectstack/core@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/core@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0

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
  - @objectstack/core@14.0.0

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
  - @objectstack/core@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0

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
  - @objectstack/core@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0

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
  - @objectstack/core@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0

## 11.0.0

### Minor Changes

- 6c4fbd9: fix(security): enforce flow `runAs` execution identity (#1888)

  The `service-automation` engine now honors `flow.runAs` instead of ignoring it.
  Previously the CRUD nodes passed **no identity** to ObjectQL, so the security
  middleware was skipped entirely — every flow ran effectively elevated regardless
  of `runAs`. A `runAs:'user'` flow did **not** de-elevate (a privilege-boundary
  surprise), and `runAs:'system'` did not _explicitly_ elevate.

  The engine now establishes the run's data-layer identity at setup and restores
  the caller's context afterward:

  - **`runAs:'system'`** → an elevated, RLS-bypassing system principal
    (`{ isSystem: true }`): the run can read/write records the triggering user
    cannot.
  - **`runAs:'user'`** (default) → the **triggering user's** identity
    (`{ userId, roles, permissions, tenantId }`): CRUD nodes' ObjectQL reads/writes
    respect that user's row-level security, and the run can never exceed the
    triggering user's grants.

  To keep `runAs:'user'` faithful to a direct request by that user, the REST
  trigger route (`@objectstack/runtime`) and the record-change trigger
  (`@objectstack/trigger-record-change`) now forward the caller's resolved
  `roles`/`tenantId` into the `AutomationContext` (new optional fields), not just
  `userId`. The new `resolveRunDataContext` helper is the single place that maps a
  run's effective `runAs` to the ObjectQL context, shared by every data node.

  The `[EXPERIMENTAL — not enforced]` marker is removed from `FlowSchema.runAs`.

  **Behavior change / migration.** Flows that previously relied on the implicit
  elevation (the default `runAs:'user'` ran unscoped) now run as the triggering
  user and are subject to their RLS. **Declare `runAs:'system'` on any flow that
  must read or write beyond the triggering user's access** (e.g. system
  automations, cross-owner roll-ups). Schedule-triggered runs have no trigger user;
  under `user` they stay unscoped (there is no identity to scope to) — declare
  `system` to make elevation explicit.

  Proven both directions by the dogfood regression gate
  (`flow-runas.dogfood.test.ts` — a restricted member triggers system vs user
  flows against an owner-scoped record) and service-automation unit + regression
  tests (`crud-runas.test.ts`).

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
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/core@10.0.0

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
  - @objectstack/core@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1

## 9.9.0

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
  - @objectstack/core@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0

## 9.6.0

### Patch Changes

- b0df09c: fix(automation): record-change flows see multi-lookup fields + support array-index interpolation (#1872)

  A `multiple: true` lookup is an array column the data driver may not echo back
  on create, so it was absent from the after-create record a record-change flow
  saw — `record.target_channels != null` was false and `{rec.target_channels.0}`
  resolved empty. Two fixes:

  - **trigger-record-change**: `buildContext` now reads the lifecycle hook's
    `input.data` (the actual key objectql uses for insert/update; it had been
    reading a non-existent `input.doc`) and overlays the after-row on it, so fields
    the driver didn't return stay visible to the flow's condition + interpolation.
  - **service-automation**: `{var.path.N}` numeric segments now index into arrays,
    so a multi-value lookup can be referenced positionally (`{record.channels.0}`).

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0

## 9.3.0

### Minor Changes

- f15d6f6: ADR-0042 SLA auto-escalation + ADR-0041 mechanical landing. plugin-approvals now owns a jobs-backed escalation scanner (`runEscalations`, interval job `approvals-sla-escalation` + boot catch-up): overdue pending requests escalate **at most once** (the `escalate` audit row is the idempotency marker, written audit-first) executing the node's `escalation.action` — notify / reassign-to-`escalateTo` / auto_approve / auto_reject as the reserved actor `system:sla`. The trigger packages drop their `plugin-` prefix (`@objectstack/trigger-record-change`, `@objectstack/trigger-schedule`) per ADR-0041, and `ActionDescriptor` gains an optional `maturity: 'ga' | 'beta' | 'reserved'` field so designers can grey out contract-ahead-of-runtime surfaces.

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1

## 8.0.0

### Patch Changes

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

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

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
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1

## 7.4.0

### Minor Changes

- 13d8653: Record-change flow trigger — auto-launch flows on data mutations.

  Completes the automation engine's `FlowTrigger` extension point so flows whose
  `start` node declares a record-change trigger (`config: { objectName,
triggerType: 'record-after-update', condition }`) actually fire on the matching
  mutation. Previously the slot was dead — nothing called `trigger.start` — so
  such flows could only run via a manual `engine.execute()`.

  **Engine baseline (`@objectstack/service-automation`)**

  - Redefines `FlowTrigger` around a parsed `FlowTriggerBinding` (flowName,
    object, event, condition, schedule, raw config). The engine parses the start
    node and hands the trigger a normalized binding, keeping trigger plugins
    decoupled from flow-definition internals (mirrors `connector_action` ↔
    `connector-rest`).
  - Ordering-independent, bidirectional wiring: `registerFlow`/`toggleFlow`
    activate bindings; `registerTrigger` retro-binds already-registered flows (a
    trigger plugin wires up on `kernel:ready`, after flows are pulled in);
    `unregisterFlow`/`unregisterTrigger`/disable tear them down.
  - Centralized start-condition gate in `execute()`: the start node's `condition`
    (e.g. `status == 'done' && previous.status != 'done'`) is evaluated once for
    every trigger type and manual runs; false ⇒ `{ skipped: true }`.
  - Seeds `record`, flattened record fields, and `previous` into flow variables.
  - New `getActiveTriggerBindings()` getter + exports `FlowTriggerBinding`.

  **Spec (`@objectstack/spec`)**

  - Adds `previous?` to `AutomationContext` — the pre-update "old" row, so flows
    can gate on transitions.

  **New package (`@objectstack/plugin-trigger-record-change`)**

  - The concrete trigger: subscribes to ObjectQL lifecycle hooks
    (`record-after-update` → `afterUpdate`, etc.), builds an `AutomationContext`
    from the new/old record, and runs the flow. Error-isolated (a flow failure
    never breaks the CRUD write); graceful degrade when the automation service or
    ObjectQL engine is absent (mirrors `plugin-audit`).

  The `schedule` trigger (ticker/cron + `sys_job` lifecycle) is a follow-up.

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
  - @objectstack/core@7.4.0
