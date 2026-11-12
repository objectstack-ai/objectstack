---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

fix(lint)!: an `object-grid` page component's column summary whose function the engine's `aggregate` door refuses over the field's declaration is refused at authoring, under `list-view-summary-field-type-refused` (#32503)

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` and `content/docs/**` teach no column summary on an `object-grid` component (the `summary` examples sit on list-view columns, all accepted pairs); the reasoning ships in the `os explain list-view-summary-field-type-refused` entry, which now names the grid carrier.

<!-- adr-0087: registered object-grid-column-summary-refused -->

**BREAKING** accept-set narrowing (upgrade-guide entry `object-grid-column-summary-refused`) in `os validate` / `os build` / `os lint` and at the runtime save door for a page (`PUT /api/v1/meta/page/NAME`; Studio, REST and MCP authors), at `error`.

- **What is judged.** An `object-grid` component's `properties.columns[i].summary`. The entry is a list view's column (`ObjectGridPropsSchema.columns` reuses `ListViewSchema.shape.columns`), and a paged, ungrouped grid that owns its fetch asks the footer's whole-set aggregate query of it, which the engine's `aggregate` door answers `400 INVALID_FIELD` for a refused pair. It is now judged by the same verdict as a list view's column summary, with the same words and fix line, reported at `pages[i]…properties.columns[j].summary` under `list-view-summary-field-type-refused`.
- **Before.** `{ field: 'title', summary: 'sum' }` on a text column of an `object-grid` passed authoring and the page saved. A paged grid's footer then fell back to the page's figure, and a grid whose rows fit one page summed them in the browser.
- **Now.** The same declaration is refused where the author writes it, as it already was on a list view. **What the author loses** is that page-labelled or one-page browser figure, which depends on the row count, not on the declaration. To keep a footer, aggregate a field of a type the function accepts (`summary: { type, field }` aggregates another field), or use `count` or a filled / empty count, which take any field.
- **Accepted and not judged, as on a list view.** `sum` over number, currency, rating, slider, progress, summary, boolean and toggle; `avg` the same plus percent; `min` / `max` over the numeric types, date, datetime, time, boolean and toggle; `count_unique` over every scalar type; `none`, `count` and the four filled / empty summaries. A field that does not resolve, a dotted path, a field with no declared type, and an object the stack does not define are not judged. The block is bound by its `dataSource.object`, else `properties.objectName`.
