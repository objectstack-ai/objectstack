---
"@objectstack/objectql": patch
---

fix(objectql): `[]` no longer satisfies `required` on a multi-value field — the #9447 ruling's enforcement half (#9476)

<!-- adr-0087: not-required (no-migration-prescription) A write-time validation
tightening on the DATA plane; nothing authorable is renamed, retired or
tombstoned, so there is no conversion to register. The spec doc block already
states the ruled contract (landed with #9447); this aligns the record
validator's enforcement to it. -->

Per the #9447 maintainer ruling (2026-08-18): `required` on a multi-value
field means **non-empty array**. The empty set is representable — it reads
back as `[]`, never `null` — so `required` judges emptiness.

Before this, `validateRecord` judged `required` through `isMissing`, which
knows `undefined` / `null` / blank strings — an explicit `[]` sailed through
on both INSERT and UPDATE while `null` was correctly rejected. Now:

- INSERT: `[]` on a required multi-value field is rejected — 400
  `VALIDATION_FAILED`, field code `required`, the same envelope a missing
  value already got.
- UPDATE: a SUPPLIED `[]` is an explicit clear — rejected with the distinct
  `required_cleared` sentence (wire code `required`), exactly like an
  explicit `null`. An omitted field still never 400s — legacy rows rest.
- Scope is the spec's own multi-value predicate (ADR-0104 D1):
  inherently-multi option types plus multi-capable types flagged
  `multiple: true`. Structured-JSON fields are untouched — `[]` there is a
  document, not an emptied set. Populated arrays and non-required
  multi-value fields are untouched.
