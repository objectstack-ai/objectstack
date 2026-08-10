---
"@objectstack/spec": minor
"@objectstack/cli": patch
---

ADR-0117 D1 declaration surface: `ownership` gains its fourth tier, `'business_unit'`.

`ObjectSchema.ownership` now reads `'user' | 'business_unit' | 'org' | 'none'`. The new
tier means *owned by an org unit, not by a person*: it injects
`owning_business_unit_id` and deliberately **no** `owner_id` — D1's table, for objects
that belong to a department rather than to someone (inventory, equipment ledgers,
departmental budgets).

```ts
ObjectSchema.create({
  name: 'inventory_item',
  ownership: 'business_unit',   // owner_id ❌ · owning_business_unit_id ✅
  fields: { sku: { type: 'text' } },
});
```

The per-tier authority is unchanged and unmoved — `resolveInjectedSystemColumns`
(`@objectstack/spec/data`), which `applySystemFields` and author-time lint both consume:

| `ownership` | `owner_id` | `owning_business_unit_id` |
|---|---|---|
| `'user'` / omitted | ✅ | ✅ |
| `'business_unit'` | ❌ | ✅ |
| `'org'` / `'none'` | ❌ | ❌ |

**Why this is a separate release from #5677.** The engine had to honour the tier before
the schema could emit it. Until #5677, owner injection was a DENY-list
(`ownership !== 'org' && ownership !== 'none'`), so a fourth value would have fallen
through and been stamped `owner_id` — the exact inverse of what the tier means. #5677
flipped that to an allow-list; this change is strictly after it, and the pin recording
both directions of that sequence lives in `packages/spec/src/data/object.test.ts`.

**What this does NOT decide.** ADR-0117 is Accepted for D1/D3 only. The stamping policy
(D2), the transfer guard (D4), legal-entity resolution (D5) and the enablement gate (D8)
remain undecided, so `owning_business_unit_id` stays provisioned-but-**inert**: declaring
`ownership: 'business_unit'` gets you the column and the withheld `owner_id`, and nothing
writes a value into it yet.

Co-updated in the same change so the vocabulary does not drift: `os explain object`'s
schema catalog (`@objectstack/cli`, hand-maintained — it does not derive from the enum),
the `SystemFieldName.OWNING_BUSINESS_UNIT_ID` and `systemFields` JSDoc, and the
data-modeling reference table.
