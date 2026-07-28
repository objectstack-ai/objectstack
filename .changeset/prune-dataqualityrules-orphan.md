---
"@objectstack/spec": minor
---

refactor(spec)!: finish the 2026-06 field prune — drop the orphaned `DataQualityRulesSchema` and its two types (#3726)

**BREAKING** (the `!` marker and this changeset are the breaking-change record;
the train ships as the v17 major — see the `v17-rc-anchor` changeset), though
nothing in-tree or out could have depended on it meaningfully. Removed from the
`@objectstack/spec` public surface:

- `DataQualityRulesSchema` (const)
- `DataQualityRules` (type)
- `DataQualityRulesInput` (type)

and the published `data/DataQualityRules.json` JSON Schema.

**Why.** The `dataQuality` field key was pruned in 2026-06 along with
`encryptionConfig`, `maskingRule`, `auditTrail` and `cached` — "dead in both
layers, aspirational governance with no runtime consumer" (see
`docs/audits/2026-06-dead-surface-disposition-plan.md`, P0/P2 field prune). Four
of the five took their value schemas with them. `dataQuality` did not: the key
vanished from `FieldSchema` while `DataQualityRulesSchema` stayed on the
published API surface and in the generated reference docs.

That middle state is the worst of the three available (key + schema + consumer /
none of them / schema only), and it failed quietly rather than loudly. `FieldSchema`
is **not** `.strict()`, so an author who found `DataQualityRules` in the reference
docs and wrote `dataQuality: { uniqueness: true }` got no error at all — the field
parsed clean and the key was silently stripped, leaving a governance rule that was
declared in source, absent from the contract, and enforced by nothing. That is the
ADR-0104 failure class, the same one the `accept` / `maxSize` declarations were
added to close. The `uniqueness` member was the sharpest edge: described as
"Enforce unique values across all records", it reads exactly like the
platform-wide scope that `unique: 'global'` actually provides (#3696), so it was
the option most likely to be picked by mistake.

**Migration.** There is no runtime behavior to migrate — the schema was never
reachable from `FieldSchema` and had zero consumers in-tree. For per-field
uniqueness use `unique` (`true` = unique within the tenant, `'global'` = unique
platform-wide; see #3696). `completeness` and `accuracy` have no replacement;
they were never implemented.

If data-quality governance is built for real later, re-add the field key and the
schema **together, with a consumer** — the enforce side of enforce-or-remove
(ADR-0049). A tombstone in `field.zod.ts` records this so the schema is not
restored on its own again.
