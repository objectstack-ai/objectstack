# @objectstack/service-automation

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
