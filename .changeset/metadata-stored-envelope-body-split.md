---
"@objectstack/metadata": patch
---

refactor(metadata): peel the stored envelope before an `api` row is parsed as an endpoint (#5309)

Internal refactor — no authored format changes, no observable acceptance change
for the shapes the platform stores today.

A metadata *type name* is worn by two different documents: the **authored
declaration** (exactly its spec vocabulary) and the **stored row** (that
declaration plus the metadata layer's own bookkeeping — `packageId`, `state`,
`version`, `publishedDefinition`, `publishedAt`, `publishedBy`, written by
`MetadataManager.register` / `publishPackage` and read back by `publishPackage`'s
package filter). Both `ApiEndpointSchema` parse sites — `buildEndpointIndex` (the
load-time backstop) and `gateApiItemsForPublish` (the publish gate) — used to hand
the whole stored row to the schema, and only its unknown-key *stripping* kept the
bookkeeping from being judged as endpoint vocabulary.

`peelStoredEnvelope` (`packages/metadata/src/stored-envelope.ts`) now takes the
envelope off first, so the schema sees the authored body and nothing else:

- a row carrying a `metadata` value IS an envelope around it — the body is that
  value, everything beside it is bookkeeping. This is the `data.metadata ?? data`
  rule the publish gate, `publishedDefinition` and `getPublished` already shared;
- otherwise the body is the row minus the declared bookkeeping keys.

The peel returns views and never mutates the row, so every existing envelope
reader (`publishPackage`'s `packageId` filter, `query`'s `state` / `packageId`
filters, `revertPackage`) is untouched, and `publishedDefinition` still snapshots
`data.metadata ?? data` verbatim.

One consequence worth naming: `buildEndpointIndex` was the last reader that did
NOT follow the layer's body-selection rule, so a publish envelope
(`{ name, packageId, state, metadata: {…} }`) used to pass the publish gate and
then be excluded from the endpoint index — its route answered 404. The two doors
now read the same document.

This is the prerequisite for tightening `ApiEndpointSchema` (#5384): with the
schema flipped to `strictObject` locally, `packages/metadata` went from 11 failing
tests to 1, and the one left is an authored non-vocabulary key being refused by
name — which is what that tightening is for.
