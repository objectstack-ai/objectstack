---
"@objectstack/lint": minor
---

`field-no-consumers` now reads two consumers that name the field nowhere in metadata — a declared field group placing it on the synthesized layout, and the column a seed or import mapping matches on (#17135).

The rule's first run on a real application reported 12 fields, and all 12 were on screen or load-bearing that day. Both misses are now read off the spec rather than off a hand-kept list, the way the rule's other two exemptions already are:

- **The synthesized layout.** `deriveFieldGroupLayout` (ADR-0085 §5) is the one derivation every renderer applies — form, detail, drawer and designer — and it places a field by its `group` membership, not by naming it in a `fields: [...]` array. A field the derivation puts in a **declared** group is therefore drawn, and is credited as a display site. The derivation's trailing untitled bucket is deliberately **not** credited: it collects everything the author did not place, so crediting it would hand the display verdict to every visible field in every app.
- **An upsert identity.** A carrier root holds values that are written and labels that are carried, and the root decided the bucket before anything else could ask. But a seed's `externalId` and an import mapping's `upsertKey` name the column the loader **matches on** — it reads that column on every row to decide insert from update. A seeder-only identity column is consumed by being an identity.

⛔ Nothing exempts `hidden` as a category. A `hidden` field no upsert matches on and nothing reads is still reported, and a `hidden` field in a declared group earns nothing from the layout, because the derivation never draws one.

Measured on `hotcrm@965933b` (the tree the 12 were reported on): **12 findings → 0**, with the synthesized layout accounting for 11 and the upsert identity for 2 (they overlap on one field). Against the same application with six deliberately unconsumed fields injected — ungrouped, undeclared-group, hidden-in-a-group, hidden + readonly, a field on an object declaring no groups, and the matched pair of a seeded identity against an identical declaration nothing matches on — all six are still reported and only the identity goes quiet.
