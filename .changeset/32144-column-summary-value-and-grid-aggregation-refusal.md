---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

fix(spec,lint)!: `deriveColumnSummary` declares the stored value a `min` / `max` column summary answers, and an `object-grid` aggregation that sums or averages a field the aggregate × field-type table refuses is refused at authoring (`grid-aggregation-field-type-refused`) (#32144)

Clause-②: yes (narrowing)
Both halves: item 1 widens a published return type of `deriveColumnSummary`; item 2 narrows what authoring accepts for an `object-grid` aggregation.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` and `content/docs/**` teach no `object-grid` `aggregations` entry and no return type of `deriveColumnSummary`; the reasoning ships as the `os explain grid-aggregation-field-type-refused` entry.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: GridAggregationSchema keeps its shape, and lint now gives an object-grid aggregation the verdict the engine aggregate door already gives the same pair at query time. A refused pair never drew a meaningful number (a grid that owns its fetch had its grouped header query answered 400 INVALID_FIELD, a grid handed its rows drew 0 for a text sum), and which field or function the author meant is not something a conversion can choose; the refusal names the aggregates the field's type accepts. -->

**`deriveColumnSummary` (`@objectstack/spec/ui`).** Its declared return was `number | null | undefined`, but a `min` / `max` column carries the aggregated field's STORED value: ISO text for a `datetime`, `YYYY-MM-DD` for a `date`. The function is now generic over the summary it is given and returns `ColumnSummaryValue<S> | null | undefined`, a new exported type: a `number` for `count`, `count_unique`, `sum`, `avg`, `count_filled`, `count_empty`, `percent_filled` and `percent_empty`, `unknown` for `min` / `max`, and nothing for `none`. Nothing is converted at runtime: a date turned into a number would lose the value a renderer draws.

- **Who notices.** A TypeScript caller that passes a summary typed as the whole `ColumnSummary` union (or `ColumnSummary | ColumnSummaryConfig`) now gets `unknown`, because that summary may be `min` / `max`; a caller that did arithmetic on that result must narrow it first (`typeof value === 'number'`), or pass a literal member. A caller passing a literal counting member (`'sum'`, `{ type: 'percent_empty', … }`) still gets `number | null | undefined`.

**BREAKING** accept-set narrowing in `os validate` / `os build` / `os lint` and at the page publish door (`PUT /api/v1/meta/page/NAME`; Studio, REST and MCP authors): an `object-grid` block whose `properties.aggregations` entry is `sum` or `avg` over a field the aggregate × field-type table (`AGGREGATE_FIELD_TYPE_COMPATIBILITY`) refuses for that function is refused at `error`, rule `grid-aggregation-field-type-refused`.

- **Before.** `{ field: 'created_at', type: 'sum' }` (or `avg` over a text, date, option, reference or `formula` field, or `sum` over a `percent`) passed authoring. A grid that owns its fetch then had its grouped header query refused by the engine's `aggregate` door with `400 INVALID_FIELD`; a grid handed its rows (`data.provider: 'value'`) grouped them in the browser and drew a number the pair cannot mean (`0` for a text sum).
- **Now.** The same pair is refused where the author writes it, at `pages[i]….properties.aggregations[j]`, and the fix line names the aggregates the field's type accepts (a `formula` field gets the spec's store-it-as-a-number remedy).
- **Accepted.** `sum` over number, currency, rating, slider, progress, summary, boolean and toggle; `avg` over the same plus percent; `count` over any field. `count_distinct`, `min` and `max` are not judged by this rule.
- **Not judged.** An object the stack does not define or that declares no field map, a field that does not resolve, a dotted path, a field two packages define at the same priority, and a field whose declaration carries no type (`id`) or a type outside `FieldType`.

**The remedy.** Point `sum` / `avg` at a numeric field, or aggregate the field with one its type accepts (`min` / `max` for a date, a count for text).
