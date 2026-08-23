---
"@objectstack/spec": minor
---

**`MetadataProtocol` declares the optional `publishMetaItem` member, and `PublishMetaItemRequest` joins the spec** (#11006, maintainer ruling 2026-08-22, option B).

`POST /api/v1/meta/:type/:name/publish` — the promotion half of Studio's designer save-then-publish loop — was a half-declared door: #7294 declared the response (`PublishMetaItemResponseSchema`) while the request shape and the interface member stayed undeclared, so the one HTTP call site reached the verb through a cast and its request literal was checked by nothing (measured: deleting the cast answers `TS2339` — the cast carried member-existence weight, not request-shape weight).

Additive, not breaking:

- `PublishMetaItemRequestSchema` / `PublishMetaItemRequest` — `{ type, name, organizationId?, actor?, message?, packageId? }`, mirroring the implementation's parameter type in `@objectstack/metadata-protocol` member for member. `packageId` is `string | null` with the absent-vs-`null` distinction documented (absent = match any package; `null` = pin to the package-unbound row). `environmentId` stays out by the #9741 ruling (transport-level routing key; `packages/rest`'s `TransportScopedMetaRequest` layers it on), and the internal `_skipSeedApply` batch-coordination key is deliberately not part of the wire contract.
- `MetadataProtocol.publishMetaItem?(request: PublishMetaItemRequest): Promise<PublishMetaItemResponse>` — optional like its `deleteMetaItem` / `getMetaItemLayered` siblings: additive to a shipped contract, implementation predating declaration. An undeclared key in a request literal at the member's call shape is now a compile error.

The follow-up that removes the `(p as any)` cast at the REST call site rides the engine lane; this change only declares the contract.
