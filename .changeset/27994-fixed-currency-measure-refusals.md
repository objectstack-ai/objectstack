---
'@objectstack/skills': patch
---

docs(skills): a dataset measure's `currency` no longer "always wins" over a `fixed` field; the skills teach the two `fixed` refusals

Clause-②: no
Metadata-protocol: none

- `objectstack-data` `rules/field-types.md` (Currency resolution) and `objectstack-ui` `rules/dashboards.md` (the dataset currency comment) taught that a measure's own `currency` wins under `fixed`. Dataset compile now refuses, with `DATASET_INVALID` / 400, a measure `currency` that differs from its field's `fixed` code (delete it; restating the code is accepted) and a derived measure whose monetary operands resolve to two different `fixed` codes (derive from measures in one currency, or drop the operand in the other). Both files now say so, and keep the not-judged cases explicit: a `fixed` code against the tenant currency, and a measure `currency` over a `dynamic` field.
- Paid for inside each file by deleting a restating code comment; the remainder raises the two token-ratchet rows on the standing path.
- No schema, key or behaviour changes.
