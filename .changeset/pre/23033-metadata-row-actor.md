---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a metadata row records who created it and who last changed it

Clause-②: no

- **What was wrong.** A metadata write that named its author stored no author on the `sys_metadata` row. `created_by` and `updated_by` read null on every row, though the repository's own schema mapping declared `actor → updated_by` and its read side reads that column. Only the history row's `recorded_by` named the writer, so "who changed this object?" could be answered from history alone.
- **What it does now.** Every metadata write stamps the row from the write's actor: `created_by` when the row is first written, and `updated_by` on every write. Studio saves, `PUT /api/v1/meta/:type/:name`, publishing a draft, restoring a version and an in-process `saveMetaItem({ actor })` all write through this one path. A write with no actor (a boot sync, a migration with no user, an unauthenticated internal call) stores null in both columns, never a placeholder user. A save that changes nothing writes nothing, so it leaves both columns as they were.
- **What an operator or a consumer sees.** A row written from now on names its creator and its last writer, so a consumer (such as cloud's AI build agent, whose staged drafts name their author) can read the author from the row itself. The pending-changes list (`listDrafts`' `updatedBy`) names the draft's last writer. Rows written before this release keep their null columns until their next write. History's `recorded_by` is unchanged.
