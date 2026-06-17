# @objectstack/plugin-trigger-record-change

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
