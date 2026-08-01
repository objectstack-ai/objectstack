---
"@objectstack/objectql": patch
"@objectstack/metadata-protocol": patch
---

fix(objectql,metadata-protocol): a tenant-authored overlay must not read back as a code artifact

`saveMetaItem` refuses to write an artifact-backed item of a type that has not
opted into overlay writes (`not_overridable`), and it asks
`registry.getArtifactItem` who is artifact-backed. That answer was "anything
whose `_packageId` is not the literal string `sys_metadata`" — a sentinel that
only holds on the save path. The boot-time rehydration of `sys_metadata`
registers each row under its REAL package id (`app.<slug>`), which every
runtime-authored item has carried since packages became mandatory.

So an app the user had just built through Studio (or the AI build agent) came
back from the next kernel rebuild looking code-shipped, and the following edit
was refused with a 403 — permanently. Live capture: two identical `modify_field`
calls on the same object seconds apart, the first published LIVE and the second
`not_overridable`, because the first one's auto-publish triggered the rebuild in
between (cloud#970).

Provenance is the axis that actually separates the two (ADR-0010 `_provenance`:
`'package'` for loader-introduced items, `'org'` for tenant-authored), so ask it:
the `sys_metadata` hydration now stamps `_provenance: 'org'`, and
`getArtifactItem` no longer treats such an item as an artifact. An item with no
provenance under a real package id is unchanged, so nothing that was protected
becomes writable.
