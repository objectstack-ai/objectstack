---
'@objectstack/runtime': patch
'@object-ui/core': patch
'@object-ui/app-shell': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

A declarative `operation: 'update'` action now tells the person what its write told a record save: the message a
hook set (`ctx.notice`) and the fields the engine did not store. Before, a field the engine stripped from the
action's `patch` (a `readonly` field, a true `readonlyWhen`) was answered as a plain success, and the hook's message
was lost. The action's answer (`POST /api/v1/actions/:object/:action`, and MCP `run_action`) now carries the write's
`notice` and `droppedFields`, in the data door's own shapes, each present only when the write produced it. The
console's action runner puts the notice under the toast's title (a notice alone keeps the success toast; with the
success toast turned off it is an info toast of its own), and the console raises the record save's own
"Saved — but some fields did not take effect" toast for the stripped fields, with their labels.
