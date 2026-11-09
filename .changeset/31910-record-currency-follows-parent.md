---
'@objectstack/spec': minor
---

feat(spec): a `master_detail` child's record-mode amount may follow its parent's currency, and a roll-up through that `master_detail` declares the parent's currency

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up #31957 — skills/objectstack-data/rules/field-types.md

ADR-0144 D2 and D6, as amended (ruling A recorded on the amendment, 「同意」): "`currencyField` may name `<master_detail field>.<parent code field>`, so a child follows its parent's currency by construction", and "A `summary` rolled up through that same master_detail is single-currency by construction, and is admitted in the parent's currency."

- **Now admitted.** A `record`-mode `currencyField` may be the two-segment path `PARENT_FIELD.CODE_FIELD`: a `master_detail` field of the amount's own object, one dot, and the field of the parent object that holds its ISO 4217 code (a `text` field with `valueDomain: 'iso_4217_currency'`). The child stores no code of its own. A `formula` whose `returnType` is `currency` may follow the parent the same way.
- **Still refused, with the prescription.** A path through a `lookup` (the ruling names `master_detail` only), through any other field type or an undeclared one, a path of three or more segments, a malformed segment, a path on a `summary` field, and (in `defineStack`'s cross-reference pass) a second segment the parent does not declare or that holds no ISO 4217 code.
- **The roll-up's currency.** A `summary` that rolls up (`sum`, `min`, `max`, `avg`) such a child amount through the very `master_detail` its path starts with declares `currencyConfig: { currencyMode: 'record', currencyField: CODE_FIELD }`, naming the parent's own code field: the declaration a sibling-code amount already makes, so no key is added. `defineStack` refuses such a roll-up that does not declare it, or names another code field. Every other roll-up keeps D6's first bullet, which the engine enforces at registration.
- **`homeAmount.rateField` sharing.** Two amounts share a rate field only when their `currencyField` spellings are equal: two amounts following the same parent may share; a following amount and one with its own code field may not.
- **Engine.** Resolving the parent's code (the home-amount projection, the code guard, the backfill, the roll-up admission) and locking the parent's code field while a child follows it are `@objectstack/objectql`'s, and drawing the child amount and the roll-up in the parent's currency is the Console's. A release of this schema without that engine half refuses such a child amount at its write and such a roll-up at registration, loudly; it never stores a mixed-currency total.
