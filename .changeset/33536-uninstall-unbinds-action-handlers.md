---
'@objectstack/cloud-connection': patch
'@objectstack/runtime': patch
'@objectstack/objectql': patch
---

fix(cloud-connection, runtime, objectql): an install-local uninstall withdraws the package's action handlers and body hooks from the running engine, so a call that names no package is served by the remaining holder at once instead of after a restart

Clause-②: yes (widening) — a bare `POST /api/v1/actions/OBJECT/NAME/ID` that answered `409 RESOURCE_CONFLICT` after an install-local uninstall, naming the uninstalled package as one of two owners, now answers what it answers after a restart: the remaining package's result. `@objectstack/runtime` gains the export `unbindAppArtifactHandlers` and the type `AppArtifactHandlerUnbinding`. Both additive.
Metadata-protocol: none

**The defect.** `DELETE /api/v1/marketplace/install-local/:manifestId` withdrew the package from the registry and left every handler its install had bound on the engine under `app:<manifestId>`: script-action handlers, body hooks and bundle functions. With two packages each holding an action of one name on one object, a call that names no package kept being refused as ambiguous until the runtime restarted, and the uninstalled package's body hooks kept firing.

**The fix.**

- `@objectstack/runtime`: `unbindAppArtifactHandlers(ql, appId, { logger, source })` is the inverse of `bindAppArtifactHandlers`. It removes the actions, hooks and functions of the package's owner and of every owner the package's last bind on that engine recorded (a multi-package artifact's bodies), releases those owners' bare-name function claims, and forgets the bind record, so a later install binds as a first bind. Another package's handlers, host code and the environment's authored-action handlers are untouched. Jobs keep leaving through the `runtime.package-jobs` uninstall cleanup.
- `@objectstack/cloud-connection`: the uninstall door calls it right after the registry withdrawal, and not when the registry refuses the withdrawal (the package stays loaded then). A runtime that has no such export is warned with the remedy, as the install door already warns for a runtime with no binder.
- `@objectstack/objectql`: `removeActionsByPackage` hands a key back to the owner that still holds a handler for it. Each owner keeps its handler in its own package slot, but the slot a call that names no package runs held only the last registration. Removing that registration emptied the key, so the bare call answered "not found" where a restart runs the remaining owner's handler. While two or more packages still hold the key, the bare call is refused naming them as before.

**Not changed.** `PATCH /api/v1/packages/:id/disable` leaves a disabled package's handlers in place, and the bare-call rule already counts no disabled package as an owner. `DELETE /api/v1/packages/:id` (the protocol's `deletePackage`) does not call this unbind, so it is unchanged.
