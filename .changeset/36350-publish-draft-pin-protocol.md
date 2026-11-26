---
'@objectstack/metadata-protocol': patch
---

feat(metadata-protocol): `publishMetaItem` refuses a draft that moved since the caller's `draftVersion`

Clause-②: yes (widening)
Metadata-protocol: added

`publishMetaItem` reads `draftVersion` (`PublishMetaItemRequestSchema.draftVersion`) and judges it against the draft row the promotion reads, before any authoring rule judges that draft: a token that is not that row's, or a pinned draft that is no longer pending, is refused `409 METADATA_CONFLICT` naming the draft's current token as `currentVersion`, with nothing promoted and the optimistic-conflict audit row recorded as for the other publish conflicts. The promotion stays locked to the same row through the write. Absent, any pending draft is promoted, as before; `parentVersion` still pins the active row.
