---
'@objectstack/lint': minor
---

fix(lint)!: a report whose `runtimeFilter` names a field its dataset's object lacks is refused at publish (`report-filter-field-unknown`), as the dashboard twin already is (#29900)

Clause-②: yes (narrowing) — the report publish door, `os validate` and `os build` refuse a report `runtimeFilter` key they accepted before; `@objectstack/lint` also exports `validateReportRuntimeFilters`, `REPORT_FILTER_FIELD_UNKNOWN` and the `ReportRuntimeFilterFinding` type.
Metadata-protocol: narrowed
Skills-docs: no move — `skills/**` and `content/docs/**` teach `runtimeFilter` keys that are fields of the dataset's object, which this rule accepts; no page teaches a key the object lacks. The reasoning ships as the `os explain report-filter-field-unknown` entry.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: ReportSchema.runtimeFilter keeps its shape and meaning, and the build and the publish door now give its keys the verdict a dashboard widget filter key already gets. A refused key never served a report (every reader saw Dataset query failed), so there is no rewrite that keeps what the author meant; the author names a real field or dimension, and the refusal says which. -->

**BREAKING** accept-set narrowing at the report publish door (`PUT /api/v1/meta/report/NAME`, `POST /api/v1/meta/report/NAME/publish`, package draft publish; Studio, REST and MCP authors) and in `os validate` / `os build`.

- **Before.** A report with `runtimeFilter: { no_such_field: 'x' }` over a dataset whose object has no `no_such_field` published `200`, and every reader of the report saw a "Dataset query failed: 400 Bad Request — Filter member no_such_field …" panel instead of numbers. The same key on a dashboard widget's `filter` was already refused `422` (`widget-filter-field-unknown`).
- **Now.** It is refused `422 INVALID_METADATA` with `report-filter-field-unknown` at `reports[0].runtimeFilter.no_such_field`, and the verdict names the object and the nearest field ("Did you mean …"). A `joined` report's block filter is judged against the block's dataset, and the report-level `runtimeFilter` (merged into every block's query) against each block's dataset.
- **Accepted, as on a widget.** A field of the dataset's object, a registry-injected system column (`created_at`, `owner_id` where injected), a dotted relationship path, and every `$` operator and combinator. One more key is accepted on a report: a bare key naming a dimension of the bound dataset, which the dataset query binds through that dimension.
- **Not judged.** A `dataset` that resolves to nothing (`chart-dataset-unknown` reports it once), an object the stack (or the publish snapshot) does not carry, an object with no readable field map, and a dotted key whose prefix the dataset's `include` does not declare.
- **`os explain report-filter-field-unknown`** prints the reasoning; `RULE_EXPLANATIONS` gains the entry.

**What an author does.** Nothing for a report whose filter keys name real fields or dimensions. A refused key never served the report (every reader saw the error panel), so there is no rewrite that keeps what the author meant: name a field of the dataset's object, a dimension of the dataset, or a `relationship.field` path whose prefix the dataset's `include` declares. The refusal names the key and the nearest field.
