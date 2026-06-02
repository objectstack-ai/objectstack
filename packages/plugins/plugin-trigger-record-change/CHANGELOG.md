# @objectstack/plugin-trigger-record-change

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
