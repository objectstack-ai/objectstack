---
"@objectstack/runtime": patch
---

The package-publish door's route-level seed apply can consume the platform's own read-back envelope again.

`POST /packages/:id/publish-drafts` reads each just-published `seed` body back through `protocol.getMetaItem` before handing it to the seed loader. That read exits through `decorateMetadataItem`, which stamps `_diagnostics` on every body whose metadata type has a registered schema — `seed` has one — and `SeedSchema` has been closed since protocol 17. So the door refused the document it had just been served: `unrecognized_keys: ["_diagnostics"]`, minted as a 422 and delivered on a **200** as `seedApplied.error`. Zero rows loaded, and the author was told their seed body failed spec validation when nothing about it was wrong.

The read-back is now passed through `stripReadDecorations` at the unwrap — the same helper, for the same reason, that the dataset query, the cold-boot flow bind and `saveMetaItem`'s verbatim persist already call. `METADATA_READ_DECORATIONS` is the declared list of keys the read path derives from a document and attaches to the *response*, so removing them restores the document the author actually wrote.

Nothing is widened to accept them: `SeedLoaderRequestSchema` stays closed, and the publish response keeps its declared shape. The strip is deliberately **not** a blanket `startsWith('_')` sweep — the ADR-0010 protection envelope (`_packageId`, `_provenance`, …) is not a read decoration, and the metadata schemas allowlist it precisely so a served document keeps its provenance when it is parsed again.

Only protocols that do not self-apply seeds inside `publishPackageDrafts` reach this path; the shipping protocol self-applies and was never affected.
