---
'@objectstack/lint': minor
---

fix(lint)!: a list-view column summary, and an `object-grid` aggregation, whose function the engine's `aggregate` door refuses over the field's declaration is refused at authoring — every row of the aggregate × field-type table (`list-view-summary-field-type-refused`, `grid-aggregation-field-type-refused`) (#32449)

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` and `content/docs/**` teach no refused pair (the one `summary: 'min'` example sits on a date column, which stays accepted); the reasoning ships as the `os explain list-view-summary-field-type-refused` and `os explain grid-aggregation-field-type-refused` entries.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: ListColumnSchema, ColumnSummaryConfigSchema and GridAggregationSchema keep their shapes, and lint now gives a column summary and a grid aggregation the verdict the engine aggregate door already gives the same pair at query time. A refused pair never drew a figure (the grouped header query and the footer whole-set query were answered 400 INVALID_FIELD), and which field or function the author meant is not something a conversion can choose; the refusal names the aggregates the field's declaration accepts. -->

**BREAKING** accept-set narrowing in `os validate` / `os build` / `os lint` and at the runtime save door (`PUT /api/v1/meta/view/NAME`, `PUT /api/v1/meta/object/NAME` for an object's built-in list views, `PUT /api/v1/meta/page/NAME` for a page's grid; Studio, REST and MCP authors), at `error`.

- **List-view column summaries (new rule `list-view-summary-field-type-refused`).** A column's `summary` (`'sum'`, or `{ type, field }`) reaches `engine.aggregate` through the grouped view's header query and the paged grid's whole-set footer query. When the engine's `aggregate` door refuses the pair it answers `400 INVALID_FIELD`. The refused pairs are `sum` / `avg` over a non-numeric field, `min` / `max` over a text, option, reference or JSON-stored field, and `count_unique` over a JSON-stored field or a field declared `multiple: true`. They are now refused at `columns[i].summary`. The aggregated field is `summary.field`, else the column's own `field`.
- **`object-grid` aggregations (`grid-aggregation-field-type-refused`, widened).** The rule judged `sum` / `avg` only. It now judges every function the door judges: `min` / `max` over a string-class or JSON-stored field and `count_distinct` over a JSON-stored or `multiple: true` field are refused too.
- **Accepted, as the door accepts them.** `sum` over number, currency, rating, slider, progress, summary, boolean and toggle; `avg` the same plus percent; `min` / `max` over the numeric types, date, datetime, time, boolean and toggle; `count_distinct` / `count_unique` over every scalar type; `count` and the four filled / empty summaries over any field.
- **Not judged.** A field that does not resolve (its own existence rule), a dotted path, and a field whose declaration carries no type (`id`) or a type outside `FieldType`.

**The remedy.** Aggregate a field of a type the function accepts (`summary: { type, field }` aggregates another field), or pick a function the field accepts. The `fix:` line names them. A `formula` field gets the spec's store-it-as-a-number remedy.
