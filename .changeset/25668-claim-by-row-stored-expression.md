---
'@objectstack/plugin-security': patch
'@objectstack/organizations': patch
---

fix(plugin-security,organizations): the seed-ownership claims re-own row by row when a stored expression reads `owner_id`

Clause-②: no
Metadata-protocol: none

- **Before.** Both seed-ownership claims (`claimSeedOwnership` in `@objectstack/plugin-security`, `claimOrgSeedOwnership` in `@objectstack/organizations`) re-owned seeded rows with one `multi: true` predicate update. A stored computed field (a non-formula field with an `expression`) that reads `owner_id`, directly (`record.owner_id`) or one hop through it (`record.owner_id.name`), computes a different value on each row once the owner is set. One predicate update can store only one value, so the engine refused the write, and every seeded row of that object stayed ownerless. The boot logged only `claimSeedOwnership failed for …`, and the next pass sent the same write.
- **Now.** An object whose stored expressions read `owner_id`, directly, one hop through it, or through another stored field that does, is claimed with one write per row. Each write keeps the claim's own terms (`owner_id IS NULL` or the seed identity, and the organization in the multi-tenant claim) plus the row's id, so each row's stored value is computed from that row, and a row someone owned in the meantime is not taken from them. Reads come from the same member reader the engine uses (`analyzeRelationshipTraversals` in `@objectstack/formula`). An expression whose reads cannot be named also takes the row-by-row path.
- **Unchanged.** Every other object keeps the predicate write, and its paging. The engine's refusal of a predicate update that would store different values stays as it is. A row whose own write is refused stays ownerless and is reported with the claim's existing warning, and the object's other rows are still claimed.
- `@objectstack/organizations` now depends on `@objectstack/formula`.

What to do: nothing. For an app whose stored expression reads `owner_id`, such as a title that includes the owner's name, the single-tenant claim hands the seeded rows to the platform admin at the next seed settle (`app:seeded`), on the next boot. The organization claim covers organizations whose owner is bound from this release on. It runs in the call that replays their seed.
