---
'@objectstack/metadata-protocol': patch
---

Stop persisting the caller's `_packageId` / `_packageVersion` / `_provenance`, and restate tenant authorship at hydration for every metadata type.

Two seams let a tenant lock themselves out of their own metadata. `saveMetaItem` persisted those three keys verbatim — `metadata-read-decorations.ts` deliberately does not strip `_provenance` from a served document, so the ordinary Studio `GET /meta/app/x` → edit → `PUT /meta/app/x` round trip wrote `_provenance: 'package'` into the tenant's own `sys_metadata` row. For every non-`object` type, boot and read-side hydration then registered that stored body as-is, so `SchemaRegistry.getArtifactItem`'s bare-key fallback accepted the overlay as a code artifact, `isArtifactBacked` turned true, and every later write was refused `NOT_OVERRIDABLE` — permanently, because the next boot re-derived the same verdict from the same row. The refusal said the item is "provided by a code package" when no code package published it at all.

Both halves are closed, because they cover different populations:

- `saveMetaItem` now drops exactly those three keys from the body it persists, so future writes stop poisoning the corpus. The `_lock*` family is deliberately untouched — a lock is author-declarable and dropping one is the fail-open direction.
- `hydrateOverlayIntoRegistry` — the one choke point boot, read-side and write-through hydration already share — now states `_provenance: 'org'` on a copy before merging the artifact envelope, so rows already written become harmless without being rewritten. That also covers the column path: `getMetaItems` re-stamps `_packageId` onto the body from the row's `package_id` column, which the write-door strip cannot reach.

The three keys are read-side derived — `mergeArtifactProtection` recomputes them from the artifact on every read — so nothing an author wrote is lost and no accepted key or value changes. Where a real artifact exists its envelope still wins over both the stored copy and the restatement: ADR-0010 §3.3 precedence is unchanged, and an item genuinely shipped by a code package is still refused `NOT_OVERRIDABLE`.
