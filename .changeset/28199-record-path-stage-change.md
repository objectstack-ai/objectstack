---
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

feat(plugin-detail): `record:path` with `allowStageChange: true` lets the reader press a stage to move the record there

Clause-②: yes
Metadata-protocol: none

`RecordPathProps.allowStageChange` was declared in `@objectstack/spec` but read by nothing: the path stayed a read-only progress rail. The renderer now honours it, and the block's registry `inputs` publish it, so it appears in `sdui.manifest.json` and the component reference.

- **Who can press.** With `allowStageChange: true`, each stage other than the current one is a button, for a reader who may edit `statusField` on this record: the record page's edit session allows editing the record, the field is not read-only or computed, and the caller's field edit grant holds, asked of the stored row. Everyone else, and every path without the key or with `false`, keeps the readout exactly as before. While the record's inline edit holds unsaved changes the path is a readout too.
- **The write.** A press asks for confirmation, then saves `{ statusField: value }` through the same record update the inline-edit save bar uses, with the record's `updated_at` as the `ifMatch` concurrency token, and re-reads the record.
- **Refusals.** The server decides which moves are legal: the object's `state_machine` rule (ADR-0020), required fields and edit rights. A refused move is shown under the path: the server's own sentence for each refused field (a field other than the status field is named by its label), a fixed line for a permission refusal, and on a stale concurrency token a line saying the record changed, after the record is re-read.
- **Copy.** Seven `detail.pathStageChange*` keys, in all ten language packs.
