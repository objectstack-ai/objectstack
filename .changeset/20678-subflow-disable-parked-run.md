---
'@objectstack/service-automation': minor
---

fix(service-automation)!: disabling a packaged subflow completes once its packaged callers are switched off and hold no parked run, and the refusal names the parked runs and the cancel door (#20678)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata changes shape and nothing an author wrote is renamed or removed, so `objectstack migrate meta` has nothing to rewrite. What moves is which calls the activation switch accepts, in both directions. -->

**BREAKING**: shipped as `minor` under the launch-window convention. `toggleFlow(name, enabled)` on the automation service, and so `POST /api/v1/automation/:name/toggle`, now accepts some disables it used to refuse (the widening) and refuses one corner of enables it used to accept (the narrowing).

**The disable direction (the widening).** Disabling a packaged flow that a packaged flow calls as a subflow (the `flowName` of a `subflow` or `map` node) was refused while any such caller existed, even one already switched off. So the refusal's own remedy, "disable the calling flow first", could never complete. A caller now guards the disable only while it can still reach the subflow node:

- **An enabled caller** guards, as before. The refusal names it, and the step is to disable it first.
- **A disabled caller** (switched off in the activation ledger, or disabled by its definition's `status`) guards only while it holds a **parked run**: a run paused at a wait, an approval, a screen, or at a `map` node between items. Switching a flow off stops its new runs only, and a parked run still resumes into its subflow node. The refusal names each parked run id and the operator cancel door, `POST /api/v1/automation/:name/runs/:runId/cancel` (ADR-0044). Cancel those runs, or let them finish, and the disable completes.
- **A disabled caller with no parked run** no longer guards, so "disable the caller, then the callee" completes.

Parked runs are read from both the in-process runs and the durable suspended-run store, including runs a previous process parked. If the durable store cannot be listed at that moment, the disable fails with the store's own error and nothing is written; it is never read as "no parked run". The refusal keeps `DELETE_RESTRICTED` / `409` and its `subflowCallers` list, which now names exactly the callers that guard.

**The enable direction (the narrowing).** A subflow in a cycle of ledger-switched-off flows with the flow being enabled was skipped whole, even when its definition's `status` also disabled it. So the enable was accepted onto a subflow that stays disabled, and the publish remedy was never named. Such a subflow is now named, with both reasons and both steps (publish it with status `active`, then enable it). The cycle exemption covers the activation switch only, because no enable order changes a status.
