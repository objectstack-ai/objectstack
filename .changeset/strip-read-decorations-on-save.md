---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): read decorations stop round-tripping into persisted metadata bodies (#4326)

`getMetaItem` / `getMetaItems` decorate every served document with
`_diagnostics` (and `_draft` on preview reads), while the write path persists
the request body **verbatim** by design (ADR-0005 §Validation — `parsed.data`
would strip Studio-only auxiliary fields). Nothing stripped the decorations in
between, so the standard designer round-trip — GET the served document, edit a
field, PUT the whole body back — baked a stale read-time verdict into
`sys_metadata.metadata`, into its checksum, and into every history diff.

It was never user-visible: reads recompute `_diagnostics` and the fresh verdict
shadows the persisted one. What it corrupted was the stored bytes — a
decoration-only re-save moved the content checksum, and history diffs carried
diagnostic noise no author wrote.

`saveMetaItem` now strips `_diagnostics` and `_draft` from the body before the
destructive-change diff, the schema gate, the authoring gate, and persistence
(new `stripReadDecorations`, exported for tests). A **silent** strip, unlike the
neighbouring layered-envelope rejection: those keys are our own decoration
riding on a document that is otherwise exactly what the author edited, so
rejecting the round-trip would be hostile. The ADR-0010 protection envelope
(`_lock`, `_lockReason`, `_provenance`) and `_packageId` are deliberately left
alone — envelope state the write path legitimately carries, not read decoration.

Also documents the #3903 conversion boundary on `SysMetadataRepository.get`:
its body stays verbatim because every caller wants the bytes a hash was
computed over (parent-version lineage, existence probes) or is diffing against
equally-verbatim history rows — conversion belongs one layer up, at the
protocol's serving seams.
