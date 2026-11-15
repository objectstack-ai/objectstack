---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: `query_dataset` refuses measures and dimensions the dataset does not declare, naming the members the caller may use

Clause-②: no (narrowing) — query_dataset stops accepting measures and dimensions the dataset does not declare; one CONTRACT_REVIEW_TIER review owed before the queue
Metadata-protocol: none
Skills-docs: none — `skills/**` and `content/docs/**` teach no raw field or ad-hoc `count` through `query_dataset`; the MCP-served skill text (`packages/mcp/src/skill-md.ts`) already says `selection` takes members "by the names `list_datasets` gives", which is what is now enforced.

<!-- adr-0087: not-required (no-migration-prescription) a runtime tool input refusal: no metadata key, value or stored row changes, so `os migrate meta` has nothing to rewrite; a caller picks a declared member instead -->

**BREAKING** for an AI or MCP client that sends `query_dataset` (the dataset AI tool, ADR-0149) a measure or dimension the saved dataset does not declare. Such a selection used to be answered: the analytics service minted an aggregate for an undeclared measure (`count` counted rows, a raw field such as `amount` was summed, `amount_sum` likewise) and grouped by a raw field named as a dimension, and the answer's `provenance` then cited that ad-hoc aggregate as a governed metric of the dataset. ADR-0149 makes the dataset the one declared definition, so a member outside it is now refused before anything is read.

- A name in `selection.measures`, `selection.dimensions` or a `selection.timeDimensions` entry's `dimension` that is not one of the dataset's own `measures[].name` / `dimensions[].name` is refused `400 INVALID_FIELD` with `member`, `param` and `cube` (the dataset's name), the envelope the service's member-level refusals already answer. A `<dataset>.`-qualified spelling is not a listed name and is refused the same way; use the bare name `list_datasets` lists.
- The refusal names the measures and dimensions THIS caller may use (what `list_datasets` lists for it), never a withheld member or one over an `internal` field, so the model can pick one, or fall back to the object query tools and say that no governed metric was used (非指标口径, the ADR-0149 D3 fallback).
- Unchanged: a missing or hidden dataset is still `404 NOT_FOUND` first; a declared member the caller may not read is still the service's own `403 PERMISSION_DENIED`; field-level permissions apply as before. The REST door (`POST /analytics/dataset/query`), dashboards and reports do not go through this tool and are not changed.
- `query_dataset`'s tool description now states the rule, so a model reads it before it calls.
