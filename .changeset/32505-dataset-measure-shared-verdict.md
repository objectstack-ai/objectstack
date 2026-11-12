---
'@objectstack/lint': patch
---

refactor(lint): `measure-aggregate-field-type-refused` reads the shared aggregate-pair verdict and keeps no private copy

Clause-②: no
Metadata-protocol: none

The rule that refuses a dataset measure (and an `analyticsCubes` measure) whose aggregate the field's declaration cannot carry now asks the same aggregate × field verdict the list-view summary and `object-grid` aggregation rules ask (`aggregate-pair-verdict.ts`), instead of a copy of it of its own. The rule's own copy is deleted: the pair check, the accepted-aggregates list and the words for a declaration.

Nothing an author sees changes. Before the copy was deleted it was compared with the shared verdict on every aggregate the table lists, every declared field type, and `multiple: true` / `false`, and they agreed on every pair. Every finding, message and hint stays the same. What changes is upkeep: when the aggregate × field-type table changes, the dataset, cube, list-view and grid rules now move together.
