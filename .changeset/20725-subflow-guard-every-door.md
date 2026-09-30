---
'@objectstack/service-automation': minor
---

fix(service-automation)!: a packaged flow is never armed onto a disabled packaged subflow on any door, removing a packaged subflow its packaged callers can still reach is refused, and the disable refusal reads a caller's parked runs completely (#20725)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata changes shape and nothing an author wrote is renamed or removed, so `objectstack migrate meta` has nothing to rewrite. What moves is which flows the engine arms, which removals it accepts, and which disables it can see a parked run behind. -->

**BREAKING**: shipped as `minor` under the launch-window convention. ADR-0126 §7.3 refuses one state: a packaged flow armed while a packaged flow it calls (the `flowName` of a `subflow` or `map` node) is disabled, so that the caller fails at that node on the child's refusal. The activation switch (`POST /api/v1/automation/:name/toggle`) already refused it in both directions. It now holds on every other door too.

**Arming declines it; registration is never refused.** Creating, republishing, upgrading or hot-reloading a flow, a cold boot, and a trigger registering at `kernel:ready` all arm through one gate. That gate now leaves a packaged flow **unarmed** while a packaged subflow it calls is disabled, by the activation ledger or by its definition's `status` (`obsolete` / `invalid`). The flow still registers, so a boot or an upgrade never fails on an installation's choice:

- `GET /api/v1/automation/_status` reports it `enabled: true, bound: false`, with a `reason` naming each disabled subflow and the step that re-arms it. The `kernel:bootstrapped` binding audit prints the same reason.
- The engine logs one warning naming each subflow and its remedy (enable it, or publish it with status `active`).
- It is armed the moment its subflow is enabled, through the switch or by republishing the subflow `active`. A flow held back by two subflows is armed when both are on.
- An armed caller is unarmed when its subflow is republished `obsolete` or `invalid`, or when the activation ledger read at boot switches that subflow off.
- In a cycle of flows switched off in the activation ledger, enabling the first one is still accepted, but it stays unarmed until the flow it calls is enabled; then both are armed.
- A flow the customer authored, or a subflow the customer authored, is not judged.

**Removing a packaged subflow is refused while a packaged caller can still reach it.** `AutomationEngine.unregisterFlow`, and so `DELETE /api/v1/automation/:name`, now refuses with `DELETE_RESTRICTED` / `409` and `subflowCallers`, the same refusal the switch gives on disable. Nothing is removed. The message names each caller and the steps:

- **An enabled caller** guards: disable it first.
- **A switched-off caller** guards while the subflow itself is still enabled. The removal door cannot read whether that caller still holds a parked run, so it names the switch instead: switch the subflow off (that refusal names each parked run to cancel), then remove it.
- Once the subflow is switched off and every caller is switched off, the removal completes.

A flow an artifact reload no longer ships (a package upgrade or uninstall, a Studio package publish, a dev reload) is removed through the new `AutomationEngine.withdrawFlow`, which does not take this refusal: the package decided the removal, and the next cold boot would not register the flow either.

**The disable refusal reads a caller's parked runs completely.** Disabling a packaged subflow under a switched-off caller that holds a parked run was decided from the durable store's deployment-wide list of paused runs, which reads at most 1000 rows. A caller whose run lay beyond them read as holding none, and the disable was accepted. The refusal now asks the store for the named callers' runs, all of them: `SuspendedRunStore` gains an optional `listByFlow(flowNames)` (complete by contract, or an error), and `ObjectStoreSuspendedRunStore.listByFlow` reads the `(flow_name, status)` index page by page to its end. A store without it is read through `list()`. The deployment-wide listing (`listSuspendedRunsDurable`) is unchanged.
