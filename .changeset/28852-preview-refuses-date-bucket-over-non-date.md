---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: the draft preview refuses a date bucket over a column that is not a date or datetime, as the published dataset does, instead of serving one null group

Clause-②: no (narrowing) — `queryDataset` with `previewDrafts: true` now refuses `INVALID_FIELD` / 400 at `groupBy.N.dateGranularity` a `timeDimensions` granularity over a field declared neither a date nor a datetime (text, select, number, boolean, …), with the refusal both live faces give the same selection, field for field; it served one `null` group (a `1970` group for a number). Nothing is widened: no export, public member, answer member, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the package root changes: a draft preview that served a group the published dataset refuses is refused with the published refusal, already on the wire. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the draft preview of `queryDataset` (`@objectstack/service-analytics`). The published faces are unchanged.

- **Before.** Measured on real SQLite on `main` `9a9823d9`. The native and ObjectQL faces refused a month bucket over a text, select or boolean column, and a year bucket over a number column, with the engine's `INVALID_FIELD` / 400 at `groupBy.0.dateGranularity`. The draft preview served one `null` group holding the whole total, or one `1970` group for the number.
- **Now.** The preview judges the keys the ObjectQL strategy would hand the engine, with the engine's reading (the field's declared type, classed by the spec's date and datetime sets; no declared type or a `formula` is not judged). It gives the engine's refusal: the same message, `object`, `param`, `path`, `field` and `fields`. It runs after the preview's column-asked-twice refusal, as on the live faces.
- **Unchanged.** A date or datetime bucket is served alike on every face. The live faces and the engine door are untouched.
- **Who sees it.** An author previewing a drafted dataset that buckets a non-date column: the refusal the published dataset gives, instead of a chart it will not serve.

**The remedy.** Group by the column without a granularity, or bucket a date or datetime field.

Also in this change, the `/analytics/sql` dry run reads its time-dimension windows before its column-asked-twice refusal, as `/analytics/query` does. So a selection carrying both an unrecognised `dateRange` and one column asked twice is refused about the `dateRange` (`ANALYTICS_DATE_RANGE_UNRECOGNIZED` / 400) on both. The dry run answered the column refusal.
