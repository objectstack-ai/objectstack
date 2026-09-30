---
'@objectstack/service-automation': minor
---

fix(service-automation)!: the toggle door refuses a flow no package ships, naming its status switch (#20726)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata changes shape and nothing an author wrote is renamed or removed, so `objectstack migrate meta` has nothing to rewrite. What moves is which flows the activation switch accepts: a flow without package provenance is refused, and its own `status`, which it always had, is its switch. -->

**BREAKING**: shipped as `minor` under the launch-window convention. `toggleFlow(name, enabled)` on the automation service, and so `POST /api/v1/automation/:name/toggle` and `client.automation.toggle`, now switches packaged flows only: a flow a code package ships.

**What was wrong.** The switch records an installation's choice in the packaged-metadata activation ledger (`sys_metadata_activation`, ADR-0126 §7.2), whose rows name the package that ships the flow. For a flow authored in the deployment it wrote a row anyway:

- A flow with no package id, such as one created through `POST /api/v1/automation` or the clone door, was refused with 400 `VALIDATION_FAILED` "Package is required", naming a field the caller never sent.
- A flow carrying the runtime-row package sentinel or an app package id was accepted, and a ledger row was written for it. That gave it a second off-switch beside its own `status`.
- With no ledger attached, the flip was accepted in process only.

**What changed.** A flow without package provenance is now refused with `RESOURCE_CONFLICT` / `409`, in both directions and with or without a ledger. The refusal comes before anything is written or changed. The message says the switch turns packaged flows on and off. It names the flow's own switch: its definition's `status`, published with the complete definition through `PUT /api/v1/automation/:name`. `obsolete` switches it off and `active` arms it. The switch never rewrites a definition itself. Packaged flows toggle exactly as before.

**Migration.** To switch a customer-authored flow off, stop sending `POST /api/v1/automation/NAME/toggle` with `{"enabled": false}`. Instead, send `PUT /api/v1/automation/NAME` with the flow's complete definition and `status: 'obsolete'`, and `status: 'active'` to arm it again. In the SDK, `client.automation.toggle(name, false)` becomes `client.automation.update(name, { ...definition, status: 'obsolete' })`.

**A customer flow that a ledger row already holds off.** If this switch turned a customer flow off before this release, its ledger row still holds the flow off after the upgrade, and no `status` clears that row. The refusal says so and names the step that completes: clone the flow under a new name through `POST /api/v1/automation/NAME/clone`, which arms the copy, then remove the old one.
