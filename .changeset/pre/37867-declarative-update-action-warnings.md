---
'@objectstack/runtime': patch
'@object-ui/core': patch
'@object-ui/app-shell': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

A declarative `operation: 'update'` action now tells the person about the validation warnings its write raised.
A `severity: 'warning'` rule lets the save through and answers `warnings`, and the edit form shows them; the
button that performs the same write answered only its success. The action's answer
(`POST /api/v1/actions/:object/:action`, and MCP `run_action`) now carries the write's `warnings`, in the data
door's own element shape, present only when the write raised one. The console's action runner raises the
success toast on its warning variant with the rule's words under the title, and keeps the Undo button; an action
whose success toast is turned off still shows the warning. `ToastHandler` options gain an optional `description`.
