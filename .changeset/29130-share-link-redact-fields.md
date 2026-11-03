---
'@objectstack/plugin-sharing': patch
'@objectstack/objectql': patch
---

fix(plugin-sharing): a share link whose `redactFields` names a field the object does not have is refused at mint, instead of being issued with a redaction that hides nothing

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is a REST request refusal at the share-link mint; no metadata key, spec schema or stored row changes, so there is nothing for objectstack migrate meta to rewrite and the caller is told at the request -->

**BREAKING**: `POST /api/v1/share-links` (and `ShareLinkService.createLink`) now refuses a `redactFields` entry that names no column of the object with `400 VALIDATION_FAILED`, where it used to answer `201` and mint the link. FROM a request carrying a misspelt or unknown name in `redactFields` TO the same request with the name corrected to a real field of the object, or the entry dropped.

The share-link mint (`POST /api/v1/share-links`, `ShareLinkService.createLink`) stored the per-link `redactFields` list as sent. At resolve the list is applied as field names, so an entry that matched no field stripped nothing, while the resolve answer still listed it among the hidden fields and the landing page said it was hidden. A misspelt redaction therefore served the very field it was meant to keep back.

- **The mint now narrows.** Every `redactFields` entry must name a column a read of the object serves: a declared field, or a platform-provisioned column (`id`, `created_at`, `updated_at`). Anything else answers `400 VALIDATION_FAILED` naming each unknown entry, and no link is minted. A `redactFields` that is not an array of strings answers the same. A request accepted on the previous release with a misspelt entry is now refused: correct the name, or drop it.
- **Unchanged.** A valid list is stored and applied exactly as before. An omitted or empty list still means no per-link redaction. A caller with no authority over the record still gets its `403` before any name is judged. An object whose schema exposes no field map is not judged, and the list is kept as sent.
- **Links already minted** keep the list they were stored with; nothing is migrated.

`@objectstack/objectql`: the `./core` entry gains one export, `declaredColumnSet(schema)`, the column set a read serves (the field map plus the platform-provisioned columns). The mint judges `redactFields` against it, so the share-link check and the read and write doors read one list.
