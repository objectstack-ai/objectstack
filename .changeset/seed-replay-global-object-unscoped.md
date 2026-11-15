---
'@objectstack/metadata-protocol': patch
---

Clause-②: no
Metadata-protocol: none

A per-organization seed replay no longer throws the driver's `INVALID_FILTER` on a dataset of a global object (one with no organization column and no tenant field, e.g. `tenancy: { enabled: false }`). The replay now matches such an object's existing rows unscoped, the same reading the seed loader's reference probe already uses for a global target, so every organization's replay upserts the one shared row instead of failing to land it.
