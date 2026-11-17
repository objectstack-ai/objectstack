---
'@objectstack/service-automation': patch
'@objectstack/runtime': patch
---

fix(automation)!: switching on a packaged flow that its own status disarms is refused, and the toggle door answers the engine's state

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — skills/objectstack-automation/SKILL.md teaches the toggle only as the off switch for an installed package's flow; nothing it says changes

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value, metadata type or stored row shape is added, removed, renamed or rewritten: what moves is the answer of one REST door (POST /automation/:name/toggle, and the IAutomationService.toggleFlow it calls) to one request, switching on a packaged flow whose own status already keeps it off. A flow definition that was valid stays valid and is armed exactly as before; nothing exists for objectstack migrate meta to rewrite. The one-line fix for a caller is in the body: publish the flow with status active, then switch it on. -->

**BREAKING** for a caller that switches on a packaged flow whose definition's `status` is `obsolete` or `invalid`. The switch moves only the activation-ledger bit, and a status is the author's, so that request never made the flow run. It now says so instead of reporting success.

**What changes.**

- `POST /api/v1/automation/:name/toggle` with `{ enabled: true }` (and `IAutomationService.toggleFlow(name, true)` on the engine's service) on such a flow used to answer `200 { name, enabled: true }`. It wrote `active: true` to `sys_metadata_activation`, replacing any `active: false` row an administrator had left there, while `GET /automation/_status` read `enabled: false`. It now answers `409 RESOURCE_CONFLICT`, names the status, and writes nothing.
  - An `active: false` row already standing for the flow stays as it is.
  - The refusal names the step that arms the flow: publish it with status `active`, or for a read-only package, install a package version that ships it active.
- A second case changes. An administrator switches such a flow on while it is still `obsolete`, and the flow is later published or shipped `active`. If the ledger held an `active: false` row for it, the flow used to run as soon as it arrived `active`, because the earlier switch-on had replaced that row. Now the row is still there, so the flow stays off after it arrives `active` until it is switched on again.
- The door's `200` answer reads `enabled` back from `getFlowRuntimeStates`, the same reading `GET /automation/_status` serves, and no longer echoes the request. A service that does not implement `getFlowRuntimeStates` keeps the old answer, the request echoed. So does a flow name two packages hold, switched at one package's address (`/automation/:ns/:name/toggle`) or at the bare name while only one holder's package is enabled: that reading has one row per holder under the same name, so it cannot tell which row was switched, and the engine's echo is true because it refuses the one switch-on that would leave the flow off.

**Who moves, in one line.** Publish the flow with status `active` first, then switch it on. A flow already published `active` that still reads `enabled: false` needs one more switch-on.

**Unchanged.** Switching such a flow off is still accepted: it writes `active: false`, which keeps the flow off after a later definition ships it active. Every flow whose status is `active` or `draft` switches on and off as before. A customer-authored flow is still refused by the earlier provenance check.
