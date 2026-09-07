---
"@objectstack/metadata-protocol": patch
---

`getMetaItemLayered` no longer reports a phantom org-scoped row as a tenant customization.

`getMetaItemLayered` is the three-layer diagnostic behind Studio's "Code default vs Overlay vs Effective" view, and the third `/meta` read verb in the series `getMetaItems` (plural) and `getMetaItem` (singular) were repaired in. Unlike those two it applied no registry read gate of its own: whatever organization a caller passed was spent on whatever type it passed. On a type the registry declares `allowOrgOverride: false` — everything outside the ADR-0005 tier-A five (`view`, `dashboard`, `report`, `translation`, `email_template`) — a deployment with history can hold pre-#6190 phantom org-scoped rows, which boot hydration deliberately walks past. Read back through this verb they surfaced as `overlay` with `overlayScope: 'org'`: an operator was shown a customization that does not exist, in the one surface built to be authoritative about customizations.

It was not only displayed. Two doors return that layer **as the response** when it is non-null — the runtime metadata dispatcher and REST `GET /meta/:type/:name/published` — so on those paths the phantom was served as the item.

The read now resolves its organization through `organizationIdForMetaRead`, the same registry-derived predicate the REST `/meta` doors have applied since #9454 and the twin of the write side's `organizationIdForMetaWrite`. A type with a per-org read channel still resolves the caller's organization and still reports `overlayScope: 'org'`; every other type reads env-wide, which is the partition that actually runs.

**The gate is bound after the canonical type fold, and that ordering is load-bearing.** In the two sibling verbs the binding already sat below `canonicalizeMetaRequestType`, so the fix there was a substitution. Here it sat above it, and dropping the same expression in place would have gated on the raw `/meta/:type` segment: `declaresOrgOverride` tolerates the manifest plurals but not the URL-only spellings (`translations` and `email_templates` have no manifest key), so a raw segment splits one item across two partitions, addressed by spelling. The repair is therefore a reorder, and it is pinned by a test that fails if the binding moves back above the fold.

Callers that name no organization — four of the five `plugin-security` invocations, and every import/analytics/auth reader — are unaffected, and a door that already computed the same predicate receives the scope it did before.
