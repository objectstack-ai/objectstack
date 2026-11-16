---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: the dataset query door refuses measures and dimensions the dataset does not declare, as `query_dataset` does

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — `skills/**` teach dataset selections only by the dataset's own names (objectstack-ui: a report selects `rows` and `values` "from that dataset"), which is what the door now enforces; `content/docs/data-modeling/analytics.mdx` states the rule in this change.

<!-- adr-0087: not-required (no-migration-prescription) a runtime request refusal: no metadata key, value or stored row changes shape, so `os migrate meta` has nothing to rewrite; authored and save-gated dashboards, reports and charts already bind only declared members (`widget-measure-unknown`, `chart-measure-unknown` and their dimension twins refuse anything else at build and at save), and a caller picks a declared member instead -->

**BREAKING** for a caller of `POST /api/v1/analytics/dataset/query` (and each query of `/analytics/dataset/query/batch`), or of `AnalyticsService.queryDataset` in process, that names a measure or dimension the dataset does not declare. Such a selection used to be answered: the analytics service minted an aggregate for an undeclared measure (`count` counted rows, a raw field such as `amount` was summed, `amount_sum` likewise, a `<dataset>.revenue` spelling was resolved) and grouped by a raw field named as a dimension or a time dimension, so a dashboard tile could show a number labelled as a dataset metric that the dataset never defines. ADR-0021 makes the dataset a declarative, closed surface, and the AI tool `query_dataset` already refused these members; every face of a dataset query now reads the dataset the same way.

- A name in `selection.measures`, `selection.dimensions` or a `selection.timeDimensions` entry's `dimension` that is not one of the dataset's own `measures[].name` / `dimensions[].name`, spelled exactly so, is refused `400 INVALID_FIELD` before anything is read; the REST body is `{ code, message }`, and in process the thrown error also carries `member`, `param` and `cube` (the dataset's name). This applies to a saved `datasetName` and to an inline `dataset`, which is judged against its own `measures` and `dimensions`.
- The refusal names every undeclared member, the measures and dimensions THIS caller may use (never a withheld member or one over an `internal` field), and the fix: use one of those, or declare the member on the dataset and query it by that name.
- Unchanged: a missing dataset is still `404 NOT_FOUND` first; a caller who may not read the dataset's object still gets the read refusal (`403`), never a member list; a declared member over a field the caller may not read is still `403 PERMISSION_DENIED`; `runtimeFilter` keys are fields, not members, and are judged as before. The cube query (`POST /api/v1/analytics/query`) is not a dataset and keeps its ad-hoc members.
