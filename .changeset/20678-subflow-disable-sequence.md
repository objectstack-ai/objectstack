---
'@objectstack/service-automation': minor
---

fix(service-automation)!: re-enabling a packaged flow is refused while a packaged subflow it calls is disabled, and the refusal names a remedy that subflow's state admits (#20678)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata changes shape and nothing an author wrote is renamed or removed, so `objectstack migrate meta` has nothing to rewrite. What moves is which enable calls the activation switch accepts. -->

**BREAKING**: shipped as `minor` under the launch-window convention. `toggleFlow(name, true)` on the automation service, and so `POST /api/v1/automation/:name/toggle` with `{"enabled": true}`, now refuses an enable it used to accept.

**What changed.** A packaged flow switched off in the activation ledger could be switched back on while a packaged flow it calls (the `flowName` of a `subflow` node, or of a `map` node) was itself disabled. The enable was accepted, and every run of the flow then failed at that node on the child's `FLOW_DISABLED` refusal. That enable is now refused with `RESOURCE_CONFLICT` / `409`, before anything is written: the ledger row still reads off, the trigger stays unbound, and runs are still refused. The message names each disabled subflow and what holds it off, and the remedy follows from that:

- **Switched off in the activation ledger**: enable that subflow first, then this flow.
- **Disabled by its own definition's `status`** (`obsolete` or `invalid`): the activation switch never changes a status, so enabling the subflow through it would change nothing. Publish the subflow with status `active` (for a package that is read-only in this environment, that takes a package version that ships it active), then enable this flow.

**Not refused:**

- Enabling a flow that is already enabled. Nothing is re-armed.
- A flow the customer authored, or a subflow the customer authored.
- A subflow in a cycle of switched-off flows with the flow being enabled, including a flow that calls itself. Each flow in such a cycle would refuse the others, so no order could complete.

Disabling a subflow is unchanged.
