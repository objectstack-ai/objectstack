---
'@objectstack/runtime': patch
---

fix(runtime): disabling or uninstalling a package through the runtime's package routes withdraws its flows at once (#33527)

Clause-②: no
Metadata-protocol: none

`PATCH /packages/:id/disable` and `DELETE /packages/:id` now announce `metadata:reloaded` with `{ changed: ['app/ID'] }` once the registry has taken the package out of service. This is the spelling the install and enable routes and the marketplace install-local uninstall already use. Every subscriber of that event re-reads a registry that no longer serves the package. The automation engine withdraws the package's flows and unbinds their record and schedule triggers, and the authored hooks, actions and translations re-sync.

Before this change, a disabled package's record-triggered flow stayed bound in the automation engine. It kept running on every matching record write until the process restarted, while `GET /meta/flow` no longer listed it. An uninstalled package's flow was withdrawn only by the asynchronous sync of its deleted metadata rows, so a write made right after the `DELETE` answered could still run it.

A disable of a package that is already disabled announces nothing, and neither does an uninstall the running registry did not withdraw. A failed announce never changes either route's answer: it is logged once at `warn`, naming the restart that repairs it.
