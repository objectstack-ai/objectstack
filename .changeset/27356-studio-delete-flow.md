---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): Delete flow in the Automations pillar's ⋯ menu

Clause-②: no
Metadata-protocol: none

A flow authored in Studio could only be deleted from Setup › Metadata. An open flow of a writable package now has a ⋯ menu in its header with Delete flow. It asks in the console's in-app dialog, naming the flow by its label and `flow/NAME`, then discards the flow's pending draft and deletes the flow through the same `DELETE /meta/flow/:name` door Setup uses, at the package Studio writes the flow's drafts to. The rail is re-read, the pillar returns to its empty state without opening another flow, and a toast names the deleted flow. A refused delete shows the server's sentence and keeps the flow open. A read-only package's flow has no menu. Two keys are added to the studio namespace (en, zh): `engine.studio.auto.deleteFlow` and `engine.studio.auto.flowDeleted`.
