---
'@objectstack/objectql': patch
'@objectstack/service-analytics': patch
---

feat(units): a raw total over a `record`-mode quantity is refused unless it groups by the quantity's unit field

Clause-②: no
Metadata-protocol: none

ADR-0158 U7 R1, mirroring ADR-0144 D6 and its record-currency doors. A `number` field declaring `unitConfig: { unitMode: 'record', unitField }` holds a bare quantity whose unit is each row's code in `unitField`. Before this change, `sum` over a row of 10 KGM and a row of 10 LBR answered `20`, and a `summary` roll-up over such child rows stored `20`.

- **The engine aggregate** (`@objectstack/objectql`, `ObjectQL.aggregate`): `sum`, `avg`, `min` or `max` over such a quantity is refused `INVALID_FIELD` / 400 before any driver is asked, unless the query's `groupBy` includes the quantity's `unitField`. The message names the quantity, its unit field and the grouping to add.
- **A `summary` roll-up** (`@objectstack/objectql`, object registration): a `summary` that rolls up `sum`, `avg`, `min` or `max` of such a child quantity is refused `INVALID_METADATA` / 422, whichever object registers second. In R1 every such roll-up is refused: a child quantity cannot follow its parent's unit yet. Roll up with `function: 'count'`, or total the quantity with an aggregate grouped by its unit field.
- **Analytics** (`@objectstack/service-analytics`): a dataset or cube measure of type `sum`, `avg`, `min` or `max` over such a quantity is refused `INVALID_FIELD` / 400 unless the query has a dimension over the unit field, on every cube path (declared, inferred, augmented), every `totals` grouping and the draft preview. The host's `sourceFieldMeta` answer gains `unitField`, relayed only under `unitMode: 'record'`.

Not judged: `count` and `count_distinct`, a `fixed`-mode quantity, and a `number` field with no `unitConfig`. No new error code.
