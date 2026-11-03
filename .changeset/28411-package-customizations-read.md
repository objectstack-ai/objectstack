---
'@objectstack/spec': minor
'@objectstack/runtime': minor
'@objectstack/client': minor
'@objectstack/metadata-protocol': minor
'@objectstack/core': patch
---

feat(runtime): `GET /packages/:id/customizations` answers what this deployment changed on an installed base, in one read

Clause-②: yes (widening)
Metadata-protocol: added

ADR-0146 D8 item 4. For an installed base package (HotCRM), one read answers "what did we change on it": the items its paired `<base>.custom` package overrides, the fields, validation rules and indexes that package adds to the base's objects, and the base's items switched off in this deployment, with each list's length. Upgrade reviews, the Studio landing's "n customized, m switched off" line and Studio's "only customizations" filter read it from the server instead of piecing it together in the browser.

- **`@objectstack/spec`**: `GetPackageCustomizationsRequestSchema` and `GetPackageCustomizationsResponseSchema` (with their types) in `@objectstack/spec/api`. The response is strict at every level; its counts are non-negative integers derived from the lists in the same answer.
- **`@objectstack/runtime`**: the route. Overrides are the pair's active rows that the served-override predicate admits (the one the effective read serves by), so a declaration from any other package and an undeclared pair item are not listed. Extensions are the pair's `extend` contributions to objects the base owns, as declared. Switched-off items are the base's `active: false` activation-ledger rows. The read gate and the 404 wording are `GET /packages/:id`'s; the query set is closed; a `.custom` id is refused `400 VALIDATION_ERROR` naming its base; a base with no pair answers empty lists, and the read never creates the pair. No diff against the base and no `basedOn` verdict: `basedOn` is reported as recorded.
- **`@objectstack/client`**: `client.packages.customizations(id)`.
- **`@objectstack/metadata-protocol`**: `listServedOverrides({ packageId })` on the protocol implementation, and the `ServedOverrideEntry` type.
- **`@objectstack/core`**: `listPackageMetadataActivations(engine, packageId)` reads one package's activation-ledger rows across types through the same read and row parse the per-type store uses; `ObjectStoreMetadataActivationStore.list()` now calls that shared read and answers exactly as before.
