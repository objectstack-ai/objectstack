---
"@objectstack/spec": minor
---

refactor(spec)!: finish the 2026-06 field prune — drop both orphaned value schemas, `DataQualityRulesSchema` and `ComputedFieldCacheSchema` (#3726, #3733)

**BREAKING** (the `!` marker and this changeset are the breaking-change record;
the train ships as the v17 major — see the `v17-rc-anchor` changeset), though
nothing in-tree or out could have depended on either meaningfully. Removed from
the `@objectstack/spec` public surface:

- `DataQualityRulesSchema` (const), `DataQualityRules` (type), `DataQualityRulesInput` (type) — #3726
- `ComputedFieldCacheSchema` (const), `ComputedFieldCache` (type) — #3733

and the published `data/DataQualityRules.json` / `data/ComputedFieldCache.json`
JSON Schemas.

**Why.** Five field keys were pruned in 2026-06 — `encryptionConfig`,
`maskingRule`, `auditTrail`, `cached` and `dataQuality` — as "dead in both
layers, aspirational governance with no runtime consumer" (see
`docs/audits/2026-06-dead-surface-disposition-plan.md`, P0/P2 field prune).
Three of the five took their value schemas with them. Two did not: `dataQuality`
and `cached` each lost their key from `FieldSchema` while
`DataQualityRulesSchema` / `ComputedFieldCacheSchema` stayed on the published API
surface and in the generated reference docs, with zero consumers anywhere in the
tree. The tombstone claimed "dead in both layers"; for these two it was true of
only one.

That middle state is the worst of the three available (key + schema + consumer /
none of them / schema only), and it failed quietly rather than loudly.
`FieldSchema` is **not** `.strict()`, so an author who found either type in the
reference docs and wrote `dataQuality: { uniqueness: true }` or
`cached: { enabled: true, ttl: 3600 }` got no error at all — the field parsed
clean and the key was silently stripped, leaving a rule that was declared in
source, absent from the contract, and enforced by nothing. That is the ADR-0104
failure class, the same one the `accept` / `maxSize` declarations were added to
close.

Each had its own sharp edge. `DataQualityRules.uniqueness`, described as "Enforce
unique values across all records", reads exactly like the platform-wide scope
that `unique: 'global'` actually provides (#3696), making it the option an author
was most likely to reach for by mistake. `ComputedFieldCache` was quieter and
therefore harder to catch: an author writing `ttl: 3600` on a formula field would
believe results were cached for an hour, get no error, and never see a signal
that nothing had happened.

**Migration.** There is no runtime behavior to migrate — neither schema was ever
reachable from `FieldSchema`, and neither had a consumer in-tree. For per-field
uniqueness use `unique` (`true` = unique within the tenant, `'global'` = unique
platform-wide; see #3696). `completeness`, `accuracy`, and computed-field caching
(`enabled` / `ttl` / `invalidateOn`) have no replacement; none was ever
implemented.

If field-level data-quality governance or computed-field caching is built for
real later, re-add the field key and its schema **together, with a consumer** —
the enforce side of enforce-or-remove (ADR-0049). A tombstone in `field.zod.ts`
records this so neither schema is restored on its own again.
