# @objectstack/service-automation

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/formula@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/formula@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/formula@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/formula@11.2.0

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
  - @objectstack/formula@11.1.0

## 11.0.0

### Major Changes

- 82ff91c: Remove the deprecated `http_request` / `http_call` / `webhook` flow-node aliases — author `http` (ADR-0018 M3).

  ADR-0018 M3 collapsed the divergent outbound-callout verbs onto the canonical
  `http` node and kept the old names as deprecated aliases for back-compat. This
  removes those aliases (the 11.0 cleanup):

  - `http_request` is dropped from `FlowNodeAction` (and therefore
    `FLOW_BUILTIN_NODE_TYPES`); authoring it now fails fast at parse instead of
    resolving to `http`.
  - `AutomationEngine` no longer registers the `http_request` / `http_call` /
    `webhook` node aliases; only `http` is registered.
  - The flow-builder palette offers `http`.

  **Breaking.** Flows / workflow rules / approval actions that still use the old
  node type must switch to `type: 'http'` (behavior is identical — durable outbox
  when `config.durable`, inline fetch otherwise). The trigger `eventType: 'webhook'`
  and the `webhook` resume event are unaffected — only the HTTP _node_ aliases are
  removed. First-party examples (showcase, app-crm) are migrated.

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

- ad143ce: fix(security): surface the schedule/user-less `runAs:'user'` fail-open (#1888 follow-up)

  With `flow.runAs` now enforced (#1888), a **schedule-triggered** flow with the
  default `runAs:'user'` has no trigger user. `resolveRunDataContext` returns
  `undefined` for that case, so the CRUD nodes pass no ObjectQL `options.context`
  and the security middleware — which _skips_ when there is no identity (it
  delegates auth to the auth layer) — runs the operation **UNSCOPED** (effectively
  elevated). An author who left `runAs` at the `'user'` default expecting a
  restricted run silently gets an unscoped one — a fail-open footgun (ADR-0049: a
  security property must not silently do the opposite of what it implies).

  This is the **product decision** to make that explicit, chosen to keep legitimate
  scheduled CRUD working (denying outright would break it, and silently elevating
  would hide the author's intent). Prevention happens where the platform can tell
  intent apart (author/build time); the runtime stays non-breaking but is no longer
  silent:

  - **Author-time lint** (`@objectstack/cli`, `lintFlowPatterns`): a new advisory
    rule `flow-schedule-runas-unscoped` flags a schedule-triggered flow whose
    effective `runAs` is `user` (explicit or unset) and which performs a data
    operation — pointing the author at `runAs:'system'`. Catches the footgun at
    compile time, before deploy (most flows are AI-authored).
  - **Runtime warning** (`@objectstack/service-automation`): the engine now emits a
    clear one-per-run warning when a user-mode run resolves no trigger identity and
    the flow touches data — the fail-open is _audible_ rather than silent. Behavior
    is otherwise unchanged (the run still executes), so scheduled CRUD that relied
    on this is not broken. New helpers `runIsUnscopedUserMode`, `flowTouchesData`,
    and `DATA_NODE_TYPES` are exported alongside `resolveRunDataContext`.
  - **Spec describe** (`@objectstack/spec`): `FlowSchema.runAs` now states that a
    scheduled run has no user, so under `user` it runs unscoped — declare `system`.

  The first-party example apps that tripped the new lint are fixed to declare
  `runAs:'system'` explicitly (`stale_opportunity_sweep`, the app-todo
  `task_reminder` / `overdue_escalation` sweeps) — they read/write across owners and
  were running unscoped by default.

  Longer term, attributing scheduled runs to a dedicated service principal (so they
  are scopable + audit-attributable rather than unscoped) is the right enforcement;
  tracked as M2 follow-up.

  Proven by a service-automation unit test (the engine warns once for a user-less
  user-mode data run; stays silent for `system`, for an identified user, and for a
  data-less flow), an end-to-end test wiring the **real `ScheduleTrigger` to the
  real engine** (`@objectstack/trigger-schedule`) that fires a job and asserts the
  user-less identity reaches the engine + trips the warning through the actual cron
  path, and a dogfood gate (`flow-runas-schedule.dogfood.test.ts`) that drives
  user-less runs through the real automation + security + data stack: a
  `runAs:'user'` run reads + writes an owner-scoped note a member cannot — audibly —
  while `runAs:'system'` is the explicit, warning-free equivalent.

  Refs #1888, ADR-0049.

### Patch Changes

- 4b5ec6e: fix(automation): re-bind scheduled-flow jobs on `os dev` hot-reload

  Editing a schedule-triggered flow under `objectstack dev` silently kept firing
  the OLD definition until a full server restart. The dev watcher recompiles
  `dist/objectstack.json` and MetadataPlugin reloads it into the MetadataManager
  (so GET /meta reads + UI HMR are fresh), but the AutomationEngine pulls its flow
  definitions and trigger/job bindings ONCE at boot — nothing re-registered them
  on reload. So the scheduled job bound at boot kept running the pre-edit flow
  (old `runAs`, schedule, or logic) on its timer, with no signal that the edit had
  no effect.

  Fix: MetadataPlugin now fires a generic `metadata:reloaded` hook after each
  artifact reload (the HMR POST handler and the server-side artifact-file watcher;
  never on the initial boot load). AutomationServicePlugin subscribes and re-syncs
  the engine from the metadata service — re-registering every current flow
  (idempotent: `registerFlow` re-binds the trigger, and `ScheduleTrigger.start`
  cancels + reschedules the job) and unregistering flows removed from the artifact
  so their jobs stop firing. This covers all auto-triggered flow types
  (schedule / record-change / api), not just scheduled ones, since record-change
  flows were also executing their boot-time definitions after an edit. Production
  deployments are unaffected — nothing reloads the artifact there.

- b6a4972: fix(automation): honor the `assignments` wrapper shape on assignment nodes

  The built-in `assignment` node executor set each TOP-LEVEL `config` key as a flow
  variable. But the surfaces that author these nodes all emit an `assignments`
  wrapper instead:

  - Studio's visual Assignment editor → `config: { assignments: { <var>: <value> } }`
  - bundled example flows (app-crm, showcase) → `config: { assignments: [{ variable, value }] }`

  So a node designed in Studio (or any of the shipped examples) silently set a
  single variable literally named `assignments` to the whole map/array and never
  set the intended variables — it passed build and no-oped at run time, leaving
  every downstream reference unresolved.

  The executor now normalizes all three shapes (`assignments` map, `assignments`
  array of `{ variable | name | key, value }`, and the legacy flat
  `{ <var>: <value> }`) and interpolates `{var}` templates in the values, matching
  the CRUD / screen nodes. Adds `logic-nodes.test.ts` covering each shape as a
  regression guard.

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
  - @objectstack/formula@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/formula@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/formula@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/formula@10.1.0

## 10.0.0

### Patch Changes

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
  - @objectstack/formula@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [1f88fd9]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/formula@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/formula@9.9.1

## 9.9.0

### Minor Changes

- 134043a: feat(automation): declarative screen-flow completion/error messages + action `errorMessage`

  A screen flow can now declare `successMessage` / `errorMessage` (FlowSchema). The
  engine surfaces them on the terminal `AutomationResult` (`successMessage` on
  success, `errorMessage` on failure), so the UI flow-runner shows a meaningful
  toast instead of a generic "Done" / the raw error — no manual "success screen"
  node needed. The CRM convert-lead wizard sets a friendly completion message.

  Also exposes `errorMessage` on the UI Action schema. The runtime (ActionRunner)
  already honoured it; it just wasn't declarable in the spec — closing a
  spec↔runtime gap so authors can set a friendly failure toast.

- 6bec07e: feat(automation): object-form screen-flow steps

  A `screen` node that declares `config.objectName` now renders the named object's
  FULL create/edit form (including inline master-detail child grids) instead of a
  flat field list. The node emits an `object-form` `ScreenSpec`
  (`kind`/`objectName`/`mode`/`recordId`/`defaults`/`idVariable`); the client
  renders the real ObjectForm, persists the record (and its children, atomically),
  and resumes the run with the saved id bound to `idVariable` so a later step can
  reference it — e.g. a lead-conversion wizard: a full Customer step, then a full
  Opportunity-with-line-items step.

  - **spec**: `ScreenSpec` gains `kind`/`objectName`/`mode`/`recordId`/`defaults`/`idVariable`.
  - **service-automation**: the `screen` executor emits object-form specs and now
    interpolates `title`/`description`/field `defaultValue`/object-form `defaults`
    against live flow variables (the engine does not pre-interpolate node config).

### Patch Changes

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

## 9.8.0

### Patch Changes

- Updated dependencies [c17d2c8]
- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/formula@9.8.0
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0

## 9.7.0

### Patch Changes

- Updated dependencies [82c7438]
- Updated dependencies [417b6ac]
- Updated dependencies [ff0a87a]
  - @objectstack/formula@9.7.0
  - @objectstack/spec@9.7.0
  - @objectstack/core@9.7.0

## 9.6.0

### Minor Changes

- 6c82aa0: fix(automation): `create_record` outputVariable exposes the created record so `{var.id}` resolves (#1873)

  A `create_record` node stored only the created record's **id string** in its
  `outputVariable`, so a later node referencing `{var.id}` (or any `{var.<field>}`)
  traversed into a string and resolved to empty — the created record was
  effectively unreferenceable downstream. `get_record` already stores the record
  object (that's why `{rec.field}` works there); `create_record` now matches.

  Behavior change: `outputVariable` holds the created **record** (an object with
  `id` + fields), not the bare id. Reference the id explicitly as `{var.id}`. A
  bare `{var}` that previously yielded the id now yields the record — update such
  references to `{var.id}` (the in-repo `app-todo` create-task flow was updated).
  When the driver returns a bare id, it's wrapped as `{ id }` so `{var.id}` still works.

- dc8b2de: feat(automation): resolve & validate `script`-node callables; first-class function registration (#1870)

  A flow `script` node that pointed at an unregistered callable (or declared no
  `actionType`/`function` at all) built fine and silently did nothing at runtime.
  Two changes close that gap:

  - **Loud runtime resolution.** The built-in `script` executor now resolves its
    target in order — built-in side-effect (`email`/`slack`) → a registered
    function (`config.function`, or a bare `config.actionType` that matches no
    built-in) → otherwise **fail the step loudly**. The old `(no-op handler)`
    success path is gone, so an unwired callable can no longer quietly skip.
  - **First-class registration path.** `AutomationEngine.setFunctionResolver()` /
    `resolveFunction()` bridge flow nodes to the host function registry. The
    automation plugin wires it to ObjectQL's `resolveFunction` (populated from
    `bundle.functions` / `defineStack({ functions })`), so an authored package can
    register a function and call it from a `script` node:
    `{ type: 'script', config: { function: 'my_fn', inputs: { … } } }`.
  - **Build-time structural check.** `objectstack build` now flags a `script` node
    that declares neither `actionType` nor `function` (the `actionType: undefined`
    repro). Function _existence_ is verified at runtime — functions are code, not
    serialized into the artifact.

- 1402be0: feat(automation): script-node `outputVariable` + interpolated inputs — the pure-function pattern (#1870)

  A flow `function` (script node) is a PURE compute step: it receives `ctx.input`
  and RETURNS a value. Two additions make the value usable on the flow graph
  without giving functions raw data access (which would hide I/O from the graph
  and bypass governance):

  - `config.outputVariable` exposes the function's return value as a flow variable,
    so a later declarative node persists it (`update_record fields: { x: '{ai.x}' }`).
  - `config.inputs` are now interpolated against the live flow variables, so a
    function can consume a prior node's output (`inputs: { id: '{record.id}' }`).

  Data writes stay declarative (visible, governed, build-checkable); data-lifecycle
  side effects belong in L2 hooks (which get `ctx.api`), not flow functions.

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

- ab942f2: feat(automation): accept `functionName` alias + `invoke_function` marker on script nodes (#1870 DX)

  AI-authored templates commonly emit `config: { actionType: 'invoke_function', functionName: 'my_fn' }`,
  but the runtime only read `config.function`. Now:

  - `config.functionName` is accepted as an alias for `config.function` (runtime + build).
  - `actionType: 'invoke_function'` is treated as a MARKER ("call the named function") — the
    name comes from `function`/`functionName`, not from actionType itself; it no longer
    tries to resolve a function literally named `invoke_function`.
  - `objectstack build` errors on `actionType: 'invoke_function'` with no `function`/`functionName`
    (it names no callable) instead of letting it fail at runtime.

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [bb00a50]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/formula@9.6.0
  - @objectstack/core@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/formula@9.5.1

## 9.5.0

### Minor Changes

- f19caef: feat(P1-2): messaging retention default-on; automation log cap configurable

  Closes the remaining two P1-2 unbounded-growth items (launch-readiness):

  - **service-messaging** — notification-pipeline retention is now **default-on**.
    `MessagingServicePlugin`'s `retentionDays` defaults to
    `DEFAULT_NOTIFICATION_RETENTION_DAYS` (90) instead of `0`; the
    already-built/tested sweeper now prunes `sys_notification` (+ delivery / inbox /
    receipt) older than 90 days by default. **Behaviour change:** notification
    history auto-prunes at 90d — set `retentionDays: 0` to keep it forever.
  - **service-automation** — the in-memory execution-log ring buffer (already
    bounded; no OOM risk) gets a tunable window via
    `AutomationServicePluginOptions.maxLogSize`, defaulting to
    `DEFAULT_MAX_EXECUTION_LOG_SIZE` (1000, unchanged). Durable
    `sys_automation_run`-style persistence remains a post-GA HA item.

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/formula@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/formula@9.4.0

## 9.3.0

### Minor Changes

- 290f631: ADR-0044 flow-level send-back-for-revision (#1744). The approval node gains a third flow movement beyond approve/reject: `sendBack()` finalizes the pending request as `returned` (new `ApprovalStatus`), resumes the run down its `revise` edge to a wait point where the record lock releases, and the submitter's `resubmit()` re-enters the approval node over a declared back-edge, opening the next round's request (fresh approver slate, re-locked, `round` stamped via the config snapshot). Engine: `FlowEdgeSchema.type` gains `'back'` — cycle validation now requires the graph _minus_ back-edges to be a DAG (unmarked cycles still rejected), node re-entry overwrites outputs/appends steps, a 100-re-entry runaway guard backstops misauthored loops, and `cancelRun(runId, reason)` lands as the first run-cancel primitive (recall crossing a revise window cancels the parked run). `maxRevisions` (default 3) on the approval node config auto-rejects send-backs past the budget. REST: `POST /approvals/requests/:id/revise` and `/resubmit`. Audit kinds `revise`/`resubmit` join `ApprovalActionKind` and the `sys_approval_action` enum.
- ad4e97f: ADR-0041 Tier 1 complete: `@objectstack/trigger-api` — inbound webhook/HTTP flow trigger. The engine now derives an `api` trigger binding for `type: 'api'` flows (activating the long-reserved enum value); the trigger mounts `POST /api/v1/automation/hooks/:flowName/:hookId` with GitHub/Stripe-style HMAC verification (`x-objectstack-signature`, constant-time compare, identical 404s for unknown flows and wrong hookIds) and queue-backed ingestion — the handler enqueues and ACKs 202, a queue consumer executes the flow with the JSON payload as the trigger record (`$record` / `record.*` / bare references), and `x-idempotency-key` passes through to the queue's dedup window. The CLI's serve preset auto-loads the trigger alongside record-change and schedule.

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
  - @objectstack/formula@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/formula@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/formula@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/formula@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/formula@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/formula@8.0.1

## 8.0.0

### Patch Changes

- 3306d2f: feat(automation): surface structured-region body steps in run observability (#1505)

  `loop` / `parallel` / `try_catch` previously ran their body, branch, and handler
  regions against a region-local step log that was **discarded** — run logs
  (`listRuns` / `getRun`) showed the container as a single opaque step, hiding the
  per-iteration / per-branch steps that actually executed.

  `AutomationEngine.runRegion()` now **returns** its body steps, and the container
  node folds them into the parent run log via a new `NodeExecutionResult.childSteps`
  field. Each surfaced step is tagged with its **immediate** container via three new
  optional fields on `ExecutionStepLogSchema` (and the engine's `StepLogEntry`):

  - `parentNodeId` — the enclosing `loop` / `parallel` / `try_catch` node
  - `iteration` — zero-based loop iteration or parallel branch index
  - `regionKind` — `loop-body` | `parallel-branch` | `try` | `catch`

  Tagging fills only fields left undefined, so nested regions keep each step's
  innermost container. A failed try-region attempt's partial steps are still not
  surfaced (preserving `try_catch` retry semantics). Fully additive — existing run
  logs and consumers are unaffected.

- bc44195: chore(automation): retire the `workflow_rule` authoring paradigm (ADR-0018 M5 dropped)

  ADR-0019 already removed the Workflow-Rule → Flow compiler (Workflow Rules were
  removed in #1398 and `workflow` was reclaimed for state machines), but the
  `workflow_rule` paradigm tag survived in `ActionParadigmSchema` and on every
  built-in node descriptor. There is no declarative Workflow-Rule authoring view
  to feed, so the tag is now retired: `ActionParadigmSchema` keeps `['flow',
'approval']`, and the `http` / `notify` / `connector_action` descriptors (plus
  the deprecated-alias fallback) advertise `['flow', 'approval']`. Approval
  execution convergence is delivered by the ADR-0019 approval Flow node, not a
  compiler. ADR-0018's status and migration table are updated to mark M3 shipped,
  M4 framework-complete, and M5 dropped.

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

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/formula@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [f01f9fa]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/formula@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [825ab06]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/formula@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Minor Changes

- 955d4c8: ADR-0018 M3: unified `http` / `notify` executors backed by a generic HTTP outbox.

  Promotes a reliable outbound-HTTP delivery outbox into `service-messaging` (the
  raw-callout counterpart to the notification outbox) and routes the Flow `http`
  node through it — closing the "`http_request` is a bare `fetch()` with no retry"
  gap. The five divergent outbound verbs collapse onto canonical `http` / `notify`.

  **`@objectstack/service-messaging` (additive):**

  - `IHttpOutbox` / `HttpDelivery` generic raw-callout shape
    (`source` / `refId` / `dedupKey` / `label` / `signingSecret`), `SqlHttpOutbox`
    over a new `sys_http_delivery` object, `MemoryHttpOutbox`, `HttpDispatcher`
    (per-partition cluster lock, claim/ack/retry/dead-letter), and a shared
    `sendOnce` + 7-step jittered retry schedule.
  - `MessagingService` gains `setHttpOutbox()` / `isHttpDeliveryReady()` /
    `enqueueHttp()`; the plugin wires the outbox + dispatcher at `kernel:ready`.

  **`@objectstack/service-automation`:**

  - Canonical `http` executor — `durable: true` enqueues onto the messaging HTTP
    outbox (retry/dead-letter); otherwise an inline `fetch()` preserving
    `http_request`'s request/response semantics.
  - `engine.registerNodeAlias()` — registers a delegating executor + a
    `deprecated` / `aliasOf` descriptor. `http_request` / `http_call` / `webhook`
    are now deprecated aliases of `http`; existing flows keep running.
  - `notify` descriptor marked `needsOutbox` (its delivery is outbox-backed).

  **`@objectstack/spec`:** `flow.zod` adds `http` to the builtin node-type seed set.

  `plugin-webhooks` cut-over to the shared outbox is a deliberate follow-up.

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

- cf03ef2: Persist suspended flow runs so a durable pause survives a process restart (#1518).

  `service-automation` kept suspended runs in an in-memory `Map` only, so a flow
  paused at an `approval` / `wait` / `screen` node could never be resumed after the
  process restarted — a hard blocker on hibernating/serverless hosts (e.g. the
  Cloudflare Workers control plane), where the approval record persists but
  `resume(runId)` had nothing to continue.

  The engine now backs that map with a pluggable `SuspendedRunStore` (ADR-0019):

  - **`SuspendedRunStore`** interface + two implementations — `InMemorySuspendedRunStore`
    (the default; JSON round-trips so it faithfully mirrors a DB boundary) and
    `ObjectStoreSuspendedRunStore`, which persists to a new **`sys_automation_run`**
    system object via the ObjectQL engine. `AutomationServicePlugin` registers the
    object and auto-enables the DB-backed store when an ObjectQL engine is present
    (opt out with `suspendedRunStore: 'memory'`).
  - **Durable suspend/resume** — a run is persisted on suspend and deleted on
    terminal completion. `resume(runId)` rehydrates from the store when the run is
    not in memory (cold boot), so a fully restarted kernel can continue from the
    paused node down the correct branch and run the downstream nodes. The resumable
    state (`variables` / `steps` / `context` / `screen`) round-trips through the
    store, including nested objects.
  - **Idempotent resume** — the suspension is consumed before downstream work runs,
    plus an in-process guard rejects a concurrent duplicate `resume`, so a repeated
    resume after a partial restart can't double-run side effects.
  - Run ids are now process-unique (random component) so they don't collide with a
    still-suspended run persisted by a previous process lifetime.

  New exports: `SuspendedRun`, `SuspendedRunStore`, `StepLogEntry`,
  `InMemorySuspendedRunStore`, `ObjectStoreSuspendedRunStore`,
  `SuspendedRunStoreEngine`, `SysAutomationRun`, plus
  `AutomationEngine.setSuspendedRunStore()` and `listSuspendedRunsDurable()`.
  Existing service-automation and plugin-approvals tests pass unchanged.

- 60f9c45: feat(automation): structured control-flow constructs (ADR-0031) — loop container

  Adopt structured control-flow as the native, AI-authored flow model (ADR-0031),
  choosing representation **(B) nested sub-structure**: containers carry their body
  as a self-contained single-entry/single-exit region in `config`.

  - **spec**: new `automation/control-flow.zod.ts` defining the `loop` container
    (`config.body`), `parallel` block (`config.branches[]`, implicit join), and
    `try/catch/retry` (`config.try`/`config.catch`/`config.retry`) configs, plus
    region well-formedness analysis (`analyzeRegion`, `findRegionEntry`) and
    `validateControlFlow` (single-entry/single-exit, acyclic; bounded loop).
  - **engine**: `registerFlow()` now rejects malformed control-flow regions before
    a flow can run; new `AutomationEngine.runRegion()` executes a body region in
    the enclosing variable scope without touching the shared DAG traversal.
  - **loop executor**: replaces the no-op `loop` stub with a real iteration
    container — binds the iterator/index variables and runs the body once per item
    under a hard max-iteration guard. Legacy flat-graph loops (no `config.body`)
    keep working — the construct is additive.

  Parallel-block and try/catch _engine execution_ and BPMN interop mapping remain
  follow-ups (issue #1479, tasks 3–5).

- f06a6a5: feat(automation): structured parallel block (ADR-0031, task 3)

  Implement engine execution for the `parallel` block — a structured construct
  with an **implicit join** (ADR-0031 §Decision 2). The `parallel` node declares N
  branch regions in `config.branches[]`; the executor runs them concurrently in
  the enclosing variable scope (via `AutomationEngine.runRegion`) and continues
  once when all branches complete — no author-visible split/join gateway.

  - New `builtin/parallel-node.ts` executor (registered as a built-in).
  - Branch failure fails the block (surfaced as a node failure → fault edge/error
    handling); durable pause inside a branch is a clear error.
  - Well-formedness (≥2 branches, single-entry/single-exit regions) is already
    enforced at `registerFlow()` by `validateControlFlow` (shipped with the loop
    container).

  Showcase `FanOutNotifyFlow` demonstrates the parallel block. Try/catch execution
  and BPMN interop mapping remain follow-ups (#1479 tasks 4–5).

- 4ee139d: feat(automation): structured try/catch/retry block (ADR-0031, task 4)

  Implement engine execution for the `try_catch` construct — structured error
  handling (ADR-0031 §Decision 3). The node runs a protected `try` region; on
  failure it retries with exponential backoff (`config.retry`), and if it still
  fails the optional `catch` region runs with the caught error bound to
  `config.errorVariable` (default `$error`). Both regions execute in the enclosing
  variable scope via `AutomationEngine.runRegion`.

  - New `builtin/try-catch-node.ts` executor (registered as a built-in).
  - `try` success (incl. a successful retry) → node succeeds; `catch` handling a
    failure → node succeeds; no `catch` / failing `catch` → node fails to the
    flow's fault edge / error handling.
  - Well-formedness (single-entry/single-exit `try`/`catch` regions) is already
    enforced at `registerFlow()` by `validateControlFlow` (shipped with the loop
    container).

  Showcase `ResilientSyncFlow` demonstrates the construct. This completes the
  native control-flow execution trio (loop / parallel / try-catch); BPMN interop
  mapping remains a follow-up (#1479 task 5).

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

## 7.5.0

### Minor Changes

- 1560880: Implement the `subflow` node executor — invoke another flow as a reusable step.

  The designer offered a `subflow` node but the engine had no executor, so a flow
  using it couldn't run. `subflow` now:

  - resolves `config.input` (a `{token}` mapping) against the parent's variables,
  - runs `config.flowName` via `engine.execute(...)`, and
  - writes the child's output back — under `${nodeId}.output`, and under
    `config.outputVariable` as a bare variable when given.

  Scope (v1): **synchronous** subflows that run to completion. If the child
  _suspends_ (a nested `approval` / `screen` / `wait`), the node fails with a
  clear message rather than silently dropping the run — nested durable pause is a
  deliberate follow-up. A depth guard (16) turns an accidental recursive cycle
  into a clean error instead of a stack overflow.

  A bare `AutomationServicePlugin` now ships 14 executors including `subflow`.

  Tests: `subflow-node.test.ts` — invoke + input-mapping + output capture,
  missing `flowName`, child-not-found, child-suspended, recursion guard.
  service-automation **118 passing**. Worked examples added to the showcase: a
  reusable `showcase_notify_owner` subflow (`template: true`) invoked by
  `showcase_task_done_notify_owner`.

- a2263e6: Implement the `wait` node executor — durable timer / signal pause.

  The flow designer offered a `wait` node but the engine had no executor for it, so
  a flow using it couldn't run. `wait` now suspends the run on entry (ADR-0019
  durable pause, the same suspend/resume machinery as `screen` / `approval`) and
  resumes by one of two paths, per `waitEventConfig.eventType`:

  - **timer** — schedules a one-shot job (`IJobService`, `{ type: 'once', at }`)
    that calls `engine.resume(runId)` when the ISO-8601 `timerDuration` elapses.
    With no job service the run still suspends and is resumable via an external
    `resume(runId)` (logged) — never silently no-ops or fails the flow.
  - **signal / webhook / manual / condition** — suspends with the signal name as
    the correlation key; an external producer resumes the run when the event
    arrives.

  Reads its run id from the engine-injected `$runId` variable (same mechanism the
  approval node uses). Adds a `parseIsoDuration` helper (`PT1H`, `P3D`, `PT90M`,
  `P1DT12H`, bare ms). Registered as a built-in node, so a bare
  `AutomationServicePlugin` now ships 13 executors including `wait`.

  Tests: `wait-node.test.ts` — duration parsing, suspend→resume traversal,
  one-shot job scheduling + handler-driven resume, named-signal suspend.
  service-automation **113 passing**. A worked `showcase_task_follow_up` flow
  (wait → notify) demonstrates it end-to-end.

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/formula@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/formula@7.4.1

## 7.4.0

### Minor Changes

- 13632b1: ADR-0030 P0 (framework) — converge notifications onto a single ingress and the
  layered model. Every producer now publishes through
  `NotificationService.emit(EmitInput)`; the in-app inbox is a materialization of
  delivery, not a row producers write.

  **Single ingress (`@objectstack/service-messaging`) — breaking**

  - `MessagingService.emit` takes the new `EmitInput` contract (`topic` /
    `audience` / `payload` / `severity` / `dedupKey` / `source` / `actorId` /
    `organizationId` / `channels`) instead of the flat `Notification` shape. It
    writes the L2 `sys_notification` event (idempotent on `dedupKey`), resolves the
    audience, then fans out; it returns `{ notificationId, deduped, deliveries,
delivered, failed }`.
  - New `sys_notification_receipt` object — the read-state spine
    (`delivered|read|clicked|dismissed`), keyed `(notification_id, user_id,
channel)`. The inbox channel writes a `delivered` receipt on materialization.
  - `sys_inbox_message`: adds `notification_id` / `delivery_id`, **drops `read`**
    (read-state moved to the receipt), adds the user `mine` list view.

  **Event re-model (`@objectstack/platform-objects`) — breaking**

  - `sys_notification` is re-modeled from a per-user inbox into the L2 **event**
    (`topic`, `payload`, `severity`, `dedup_key`, `source_*`, `actor_id`). Removes
    `recipient_id` / `is_read` / `read_at` / `type` / `title` / `body` / `url` /
    `actor_name` and the inbox actions/views. App-nav: the account inbox points at
    `sys_inbox_message`; Setup shows the notification event log.

  **Producers routed through `emit()`**

  - `@objectstack/service-automation`: the `notify` node maps its config to
    `EmitInput`.
  - `@objectstack/plugin-audit`: collaboration `@mention` → `collab.mention` and
    assignment → `collab.assignment` (both with a `dedupKey`); no more direct
    `sys_notification` writes. Collaboration notifications now require
    `MessagingServicePlugin` (they degrade to a warn otherwise).

  **Migration (`@objectstack/metadata`)**

  - Idempotent `migrateSysNotificationToEvent` splits legacy `sys_notification`
    inbox rows into `sys_inbox_message` + receipts and rewrites the event row.

  **Startup (`@objectstack/cli`, `@objectstack/runtime`)**

  - `messaging` is now a foundational capability. On `objectstack serve` it is
    added to `ALWAYS_ON_CAPABILITIES` (every non-`minimal` preset starts it); on
    cloud per-project kernels the capability loader expands `requires` to add
    `messaging` whenever `audit` is present. This keeps collaboration `@mention` /
    assignment notifications (which now flow through the pipeline) working out of
    the box on both paths. `--preset minimal` opts out.

  The Console bell repoint (objectui) and phases P1–P3 are tracked in
  `docs/handoff/adr-0030-notification-convergence.md`.

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

- ff3d006: Screen-flow runtime — interactive `screen` nodes (suspend → render → resume).

  A `screen` node that declares input fields now suspends the run on entry
  (reusing the ADR-0019 durable pause), surfaces a `ScreenSpec` describing the
  form, and resumes with the collected values applied as **bare** flow variables
  so downstream nodes read them via `{var}`. (`waitForInput: false` forces the
  old server pass-through.)

  - **spec**: `AutomationResult.screen?: ScreenSpec`, `ResumeSignal.variables?`
    (bare vars), `IAutomationService.getSuspendedScreen?(runId)`.
  - **service-automation**: the `screen` executor builds the `ScreenSpec` and
    suspends when fields are present; the suspend/resume plumbing threads the
    screen through `FlowSuspendSignal` → `SuspendedRun` → the paused result;
    `resume()` sets `signal.variables` as bare flow variables; `getSuspendedScreen`.
  - **runtime**: `POST /api/v1/automation/:name/runs/:runId/resume` (body
    `{ inputs }`) and `GET …/runs/:runId/screen`, wired through both the
    dispatcher route table and `handleAutomation`.

  Verified end-to-end headlessly: the showcase Reassign Wizard launches → pauses
  at the "New Assignee" screen → resumes with the input → the task is reassigned.
  The objectui `FlowRunner` UI that renders these screens ships separately.

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

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/formula@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/formula@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/formula@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/formula@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/formula@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/formula@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/formula@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/formula@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/formula@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/formula@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/formula@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/formula@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/formula@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/formula@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/formula@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/formula@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/formula@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/formula@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/formula@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/formula@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/formula@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/formula@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/formula@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/formula@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/formula@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/formula@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8
