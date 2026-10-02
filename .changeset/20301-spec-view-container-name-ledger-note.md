---
"@objectstack/spec": patch
---

Liveness ledger: the view container's body `name` row stays `dead`, and its note now states what the platform actually does with the key

Clause-②: no

- The old note said the body copy was "a copy nobody reads". Measured, the metadata door stamps the save name into every saved view body that has none, containers included (`normalizeViewMetadata` in `@objectstack/metadata-protocol`). Its overlay paths key on that stamped copy: `hydrateOverlayIntoRegistry` registers no body without a `name`, and `mergePackageAwareOverlay` slots an overlay row by it.
- The verdict is unchanged, because the ledger's `live` means that authoring the key changes runtime behaviour. An authored container `name` only restates the key the container already registers under, or contradicts it. `os validate` and `os lint` keep warning `liveness-dead-property` ("drop it").
- The note records why the key is kept rather than tombstoned: the door's own saves stamp it, so a tombstone would refuse the platform's own writes. A maintainer ruling also refused a spec-level forbid of a container's `name`.
- It corrects the old attribution too. Artifact-shipped containers and the metadata-validation sweep author no `name`; what was read as theirs is the door's stamp.
- The ledger README's `view` cell says the same. The `view.list.tabs` row's note now records that the two author-time walks that still read a list view's own `tabs` are deleted.
- A comment in `system/i18n-resolver.ts` that still called the list view's own `tabs` a live carrier now says the key is a tombstone and `UserFiltersSchema.tabs` is the one carrier.
- ⛔ No schema, parse, export, status or accept-set change.
