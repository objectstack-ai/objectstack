---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): an install-local uninstall withdraws the package's flows from the automation engine at once, and unbinds their triggers

Clause-②: no
Metadata-protocol: none

`DELETE /api/v1/marketplace/install-local/:manifestId` withdrew the package from the registry and ran its uninstall cleanups, but never told the running kernel. The automation engine withdraws a flow only when it re-syncs on `metadata:reloaded`, so the uninstalled package's flows stayed registered: `GET /api/v1/meta/flow/NAME` answered 404 while `GET /api/v1/automation/NAME` still answered `active`, `POST /api/v1/automation/NAME/trigger` still ran the flow and wrote a run row, and its record and schedule triggers stayed armed. That lasted until some unrelated reload, such as a view publish or another package's install. The door's note said the package was withdrawn from the running kernel.

- **Now.** After the registry withdrawal and the cleanups, the door announces `metadata:reloaded` with `{ changed: ['app/MANIFEST_ID'] }`, the same signal the install door's hot load announces. The engine's re-sync withdraws every flow it had armed that the package no longer provides and unbinds each one's trigger. Right after the `DELETE` returns, `GET /api/v1/automation/NAME` and its trigger door answer 404, and a write to a watched object runs nothing.
- **When the re-sync does not run.** If a subscriber throws, or the kernel context cannot announce, the uninstall still answers 200, and `cleanups` carries one failed outcome named `metadata:reloaded`. The note then says the engine can still hold the package's flows until the next restart. The cause goes to the operator log at `warn`, with the restart as the remedy.
- **Unchanged.** Nothing is announced when the uninstall did not happen (a refused caller, an id this door never installed, a ledger write that failed), or when the registry refused the withdrawal, because the package is still registered.
