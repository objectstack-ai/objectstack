---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': minor
---

fix(metadata-protocol): an object extension reaches the by-name `/meta` read, not just the list (#7556)

**Behaviour change, and it is a payload gaining fields.** `GET /meta/object/:name`
(and `?layers=true`, and the cached/compound spellings that delegate to the same
read) now serve an object's RESOLVED schema — the base layer with its
`objectExtensions` contributors folded on — where they previously served the base
layer alone. Any consumer of that route sees the extension's fields appear.
Deployments with no `objectExtensions` see a byte-identical payload; the fold is
applied only to a name something actually extends.

Levels: `metadata-protocol` is `patch` — it restores the contract the route was
already specified to answer (`GET /meta/object` and the data plane both already
resolved the same way, and the divergence was the defect). `objectql` is `minor`
because it gains one additive public API, `SchemaRegistry.foldObjectExtendersOnto`.

The defect: `GET /meta/object` composes its objects from
`SchemaRegistry.listItems('object')`, whose object branch resolves through
`resolveObject` — a base layer with its `extend` contributors folded on (ADR-0029
D9.2). The by-name read consults the `metadata` SERVICE first, because that copy
is the HMR-fresh one, and served whatever it returned. For every other metadata
type the two agree. For `object` they did not: a deployment booted from a
compiled artifact (`artifactSource` — `objectstack serve`, sealed runtimes, the
cloud) ingests `objects` and `objectExtensions` as SEPARATE collections, so the
service's copy is the owner's declaration with no extender in it. An in-process
dev boot happened to be immune, because ObjectQL's
`bridgeObjectsToMetadataService` seeds that service from `registry.getAllObjects()`
— bodies that are already folded — which is why this survived so long.

Measured on the showcase, whose account extension contributes three fields: they
were served by the list read and persisted through the data API round-trip, and
were absent from the by-name read and from BOTH layers of `?layers=true`. Not
cosmetic — the edit and new forms derive from the by-name response, so three
fields that a client could read and write through the API could never be set in
the UI.

The fix folds the registry's `extend` contributors onto the MetadataService body
at the two places that adopt one: the by-name read and the `code` layer of the
layered view (`effective` is `overlay ?? code`, so an object with no tenant
overlay is corrected on both layers by that single fold). The fold itself is the
registry's own — `foldObjectExtendersOnto` reuses the same private fold
`resolveObject` and `resolveOwnerLayer` apply, rather than growing a second copy
that could drift. The `overlay` layer is deliberately left alone: it reports what
a tenant customised, and a code-declared extension is not that.

Pinned as AGREEMENT rather than presence, in
`packages/rest/src/meta-object-extension-agreement.test.ts`: the by-name read and
the list read are both measured off real handlers over a real protocol over a
real registry, across four hosts that genuinely differ (artifact-ingested,
bridged in-process, no metadata service, and an object nothing extends), plus an
anti-vacuity case pinning that those hosts ARE discriminated. Asserting "the
route returns the extension fields" would pass again the day someone
special-cased that route, which is the same defect one layer over. The
end-to-end proof on a real showcase over real HTTP is
`packages/qa/dogfood/test/showcase-object-extension-meta-read.dogfood.test.ts`,
which boots the artifact path on purpose — the shared in-process harness cannot
see this bug.
