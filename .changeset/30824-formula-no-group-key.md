---
'@objectstack/skills': patch
---

docs(skills): the `objectstack-data` field-types formula row says a formula is no dataset or cube dimension (group key) either

Clause-②: no
Metadata-protocol: none

- **Before.** The `formula` row of `skills/objectstack-data/rules/field-types.md` said a formula is virtual and not aggregatable, and that a dataset measure needs a stored field. It said nothing about grouping by one, so an AI author reading the row had nothing telling it not to declare a dataset or `analyticsCubes` dimension over a formula.
- **Now.** The row says a formula is neither aggregatable nor a dataset or cube dimension (group key), and that both need a stored field — what the platform refuses today: the authoring rule `dimension-virtual-field-refused`, the dataset compile's `400 DATASET_INVALID`, and every analytics query grouping by one, `400 INVALID_FIELD`.
- No schema, key or behaviour changes; the skill text only states a refusal that already ships.
