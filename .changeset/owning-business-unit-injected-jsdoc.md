---
"@objectstack/spec": patch
---

Declaration sync for ADR-0117 D1: `owning_business_unit_id` is documented as INJECTED,
while the `business_unit` ownership tier is documented as still unauthorable.

#5677 landed D1's execution surface in `packages/objectql`: `applySystemFields`' owner
decision became an allow-list and the `owning_business_unit_id` column is now injected on
every ownership-eligible object — i.e. under `ownership: 'user'` and when `ownership` is
omitted, withheld under `'org' | 'none'` and on `managedBy` / `sys_*` tables. The spec's
own prose had not followed: `SystemFieldName.OWNING_BUSINESS_UNIT_ID` still read
"**NOT injected by open-core** — nothing provisions this column today", which had become
false on the default tier every ordinary business object uses.

The flip is deliberately PARTIAL, because the condition it was written against was
two-part and only one half landed. The JSDoc gated itself on both (a) the `ownership`
enum gaining a `business_unit` member and (b) the `wantOwner` deny-list becoming an
allow-list. Only (b) shipped. `ObjectSchema`'s `ownership` enum is still
`'user' | 'org' | 'none'`, so `ownership: 'business_unit'` remains deliberately rejected
(the enum member is tracked separately). A flat "INJECTED" would have deleted a true
sentence and implied an authorable tier that does not exist — declaring what the runtime
rejects, which is the dangerous direction of ADR-0049, and the inverse of the benign
runtime-ahead-of-docs gap this closes. Both facts are therefore stated together, in every
place that states either:

- `SystemFieldName.OWNING_BUSINESS_UNIT_ID` — INJECTED, plus an explicit "the column
  being injected does not mean the tier is authorable" paragraph, plus the
  provisioned-but-inert note (the D2/D4 stamping middleware has not landed, so nothing
  writes a value yet).
- `ObjectSchema.systemFields` — the injected-column list gains `owning_business_unit_id`,
  with its governing property, its `organization_id`-shaped column definition, and the
  same tier caveat.
- `resolveInjectedSystemColumns` — its per-tier table already matched D1; it gains one
  note that the `business_unit` row is implemented ahead of the acceptance surface, so
  the row is not misread as a claim that the tier is available.

Documentation only: no schema, no value, and no injected column changes, so no metadata
document changes what it parses to.
