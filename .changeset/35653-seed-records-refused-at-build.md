---
'@objectstack/cli': minor
'@objectstack/lint': minor
---

feat(cli): `os validate` and `os build` refuse seed records the seed load would drop: one its own validation rule refuses, or a keyed one with a blank key field

Clause-②: no
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row, registry key or authored value changes. What tightens is the authoring verdict: a seed record the seed load already refuses (its own validation rule, or a blank key field) is now refused by os validate and os build first. Nothing is converted and there is no tombstone; the fix is to the record or the rule, below. -->

A seed write is held to the object's own validation rules (every type but `state_machine`), and a record a rule refuses is dropped from the load while the rest land. Until now nothing at authoring time judged a seed record against those rules: `os validate` and `os build` passed, and the first sign was a `[Seeder] … dropped record(s)` line at boot carrying the rule's message, not its name. Both commands now refuse such a config (exit 1), one line per record, naming where the record sits, its index and the refusing rule:

```text
✗ Seed records the seed load refuses (1 record)
  ✗ data[0].records[1]: Seed record #1 of 'xt_payment' is refused by its validation rule 'amount_positive': A payment amount must be positive.
```

The verdict is the write path's own evaluator, run on one rule at a time. A record and rule pair is judged only when the record's own literal values decide it; a pair whose rule reads something the load decides (a reference, a roll-up, formula or autonumber field, a default, a platform-injected column, an expression value, a `beforeInsert` hook's write, or the stored row of an `update` dataset) is counted in one dim line and never refused. Advisory rules (`warning` / `info`) and inactive rules are not judged.

A keyed record (every live mode: `ignore`, `upsert`, `update`) whose literal value for a key field is blank (no value, `null` or `''`) is refused the same way, in the sentence the seed loader refuses it with at load, naming the object, the record index and the field. A key field holding an expression is judged at load only.

`--json` output carries the refusals under `errors` (`os validate`) or `issues` (`os build`), each with `rule` (`seed-row-refused-by-validation-rule` or `seed-record-key-field-blank`), `location`, `object`, `recordIndex`, and `validationRule` or `field`.

To fix a refused config: correct the record so its rule admits it, change the rule, or give the record its key value. `@objectstack/lint` exports the walk as `judgeSeedRowRefusals`, which takes the evaluator as an input.
