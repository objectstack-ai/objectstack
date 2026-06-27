---
"@objectstack/spec": minor
---

Remove a first batch of dead (unenforced, unauthored) metadata properties (#2377, ADR-0049).

Verified set 0× / read 0× across framework + objectui + cloud + hotcrm + templates, with no test footprint outside `@objectstack/spec`:

- **field**: `caseSensitive`, `maxRating`
- **object**: `partitioning` (+ `PartitioningConfigSchema`), `defaultDetailForm`

Liveness ledgers (field/object) updated; api-surface regenerated (drops `PartitioningConfig`/`PartitioningConfigSchema` only). Folded into the 11 line (`minor`).

The remaining #2377 candidates are deliberately not in this batch: overloaded names (`tags`/`active`/`versioning`/`dependencies`/`index`/…) need per-occurrence handling, and `softDelete` / `measures.certified` turned out to be set in non-spec test fixtures (analytics, mcp) — both deferred. See the issue for the full split.
