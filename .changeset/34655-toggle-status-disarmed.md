---
'@objectstack/service-automation': patch
'@objectstack/runtime': patch
---

fix(automation): switching on a packaged flow that its own status disarms is refused, and the toggle door answers the engine's state

Clause-②: no
Metadata-protocol: none
Skills-docs: none — skills/objectstack-automation/SKILL.md teaches the toggle only as the off switch for an installed package's flow; nothing it says changes

`POST /automation/:name/toggle` with `{ enabled: true }` on a packaged flow whose definition's `status` is `obsolete` or `invalid` used to write `active: true` to the activation ledger and answer `200 { enabled: true }`. The flow stayed off, because the switch moves only the ledger bit and a status is the author's. `GET /automation/_status` read `enabled: false` for the same flow.

- `toggleFlow` now refuses that request with `RESOURCE_CONFLICT` / 409 before anything is written. The message names the status, and names the step that arms the flow: publish it with status `active`, or for a read-only package, install a package version that ships it active. Switching such a flow off is still accepted. That writes the ledger row, which keeps the flow off after a later version ships it active.
- The door's `200` answer reads `enabled` back from `getFlowRuntimeStates`, the same reading `GET /automation/_status` serves. It no longer echoes the request. A service that does not implement `getFlowRuntimeStates` keeps the old answer, the request echoed.

Upgrading: a caller that switched a status-disarmed packaged flow on and read `200` now reads `409`. Nothing changes for that flow, which never ran before either. To arm it, publish the flow with status `active`.
