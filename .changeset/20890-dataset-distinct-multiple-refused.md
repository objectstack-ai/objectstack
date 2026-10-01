---
"@objectstack/lint": minor
---

fix(lint)!: a dataset `count_distinct` measure over a field declared `multiple: true` is refused by `measure-aggregate-field-type-refused`, as the compile leg and the engine already refuse it

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (already-registered dataset-measure-aggregate-field-type-refused) the registered entry carries this family's hand-migration, an aggregate the field accepts with count as the one that stays for a JSON-stored field, and the count_distinct narrowing over the JSON-stored types already rides it. A select, radio, lookup, user, file or image field declared multiple: true is the one JSON-stored shape the per-type table cannot see; the dataset compile leg and the engine's count_distinct door refuse it beside the table's row, and this is the authoring leg of that same pair, so it adds no surface of its own. -->

**BREAKING**: metadata that passed `os validate`, `os build` and `os lint` can now fail, and so can a runtime dataset save, which runs the same rule. `measure-aggregate-field-type-refused` reads the field's declaration, not its type alone: `count_distinct` over a `select`, `radio`, `lookup`, `user`, `file` or `image` field declared `multiple: true` is refused, because that field is a list stored as JSON and no two backends compare such values for equality alike. The dataset compile leg already answers the pair `400 DATASET_INVALID`, and the engine's `count_distinct` door answers it `400 INVALID_FIELD`. It ships as `minor` under the launch-window convention for accept-set narrowings.

**What an author sees now.** The finding names the measure, the field, the object and the declaration with its flag (`select` with `multiple: true`), and says the aggregate accepts its row's types, none of them with `multiple: true`. The hint names the aggregates the declaration does accept, read from the same predicate: `count`.

**What to write instead.** `count` over the field, or `count_distinct` over a field that stores one scalar value. To count the records holding one member, filter by it with `$contains` in a record query.

**Unchanged.** `count_distinct` over the same types without the flag; `count` over any field; every other aggregate, whose rows accept no multi-capable type and whose verdicts therefore do not move; and the skips the rule already had.
