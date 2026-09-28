---
"@objectstack/service-analytics": patch
---

`AnalyticsService.queryDataset` no longer writes the service-wide cube and dataset registries: each call compiles its dataset into a scope of its own (#20356).

Clause-②: no

- **What changes**: a dataset query — an inline draft or a saved definition passed to `queryDataset` — used to register its compiled cube and compiled dataset under the dataset's name before it ran. From then on the name meant that request's definition for every later reader (`getMeta()` and `GET /api/v1/analytics/meta`, and every query by that name) until restart, whatever the request's own admission answered. The dataset is now compiled for the call only. The queries it runs resolve its name through a request-local lookup that overlays the shared registry read-only: the cube, the object-level admission and read-scope object sets, the join allowlist and the dataset scope all come from the call's own dataset, and a measure the call infers stays with the call.
- **What does not change**: the request is served as before, from its own definition, with the same admission, read scope and refusals. `registerDataset` still compiles and registers into the shared registry — the configuration door behind `AnalyticsServiceConfig.datasets` and embedders — and configured cubes are untouched. No refusal is added for a dataset whose name matches a configured cube.
- **The one observable difference**: a cube that only a `queryDataset` call ever compiled is no longer listed by `getMeta()`, and is no longer queryable by name through `query()` / `POST /api/v1/analytics/query` after that call returns. To make a dataset addressable by name, register it through `registerDataset` or `AnalyticsServiceConfig.datasets`.
