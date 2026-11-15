---
'@objectstack/plugin-audit': patch
'@objectstack/service-storage': patch
'@objectstack/spec': patch
---

refactor(plugin-audit, service-storage): the per-object attachment opt-in (`enable.files`) has one enforcer, the storage service's own gate (#33012)

Clause-②: no
Metadata-protocol: none

The storage service already enforces `enable.files` itself on every `sys_attachment` insert and on every update that re-points an attachment onto another object (`installAttachmentFilesOptInGate`, maintainer ruling on #32754, route A). The audit capability enforced the same declaration a second time on the same writes. That second gate is removed: `installAuditWriters` registers no hook on `sys_attachment` any more.

- An attachment onto an object that does not declare `enable: { files: true }` is refused exactly as before, `403 FILES_DISABLED`, through the data door, the upload-complete attach, the server-side attach verb and a re-point, with or without the audit capability installed. Nothing to change in an app.
- Attachments already stored on an object that never declared the opt-in are untouched: the gate judges new inserts and re-points only.
- The storage service's attachment member grant documents its four gate flags precisely: three are their installation's own answer, and the write-rule flag is a literal `true` where it is reached, in the branch that has just installed the write rule.
- `@objectstack/spec`: the liveness ledger's `enable.files` evidence names the storage service's gate.
