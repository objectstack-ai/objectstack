---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a dataset selection asking one column twice is refused with a repair the selection can make, not the engine's "own 'alias'"

Clause-②: no — the accept set of `queryDataset` is unchanged on every face: each selection served on `main` is served, each refused is refused with status 400. Only the refusal's prescription moves, and the ObjectQL strategy now refuses these keys itself, right before `engine.aggregate`. Nothing is widened: no export, public member, answer member, error code or status is added.
Metadata-protocol: none

A `queryDataset` selection that asks one column for two values under one name (the column raw beside its own bucket, such as `dimensions: ['closed_at']` with `timeDimensions: [{ dimension: 'OBJECT.closed_at', granularity: 'month' }]`, or two buckets of it) is refused `INVALID_QUERY` / 400 on the native strategy, the ObjectQL strategy and the draft preview, with the same `param`, `path`, `object` and `fields` as before. The message used to be the engine's, which tells the caller to "give one of the group entries its own 'alias'"; a dataset selection has no alias. It now names the selection's members over the column and a repair:

- raw beside its bucket: "The selection asks for 'closed_at' both raw and bucketed (`dimensions` 'closed_at'; `timeDimensions` 'OBJECT.closed_at' by month). Drop the raw dimension from `dimensions`, or drop the granularity from the `timeDimensions` entry."
- two buckets: "The selection asks for 'closed_at' at two granularities (`timeDimensions` 'closed_at' by month, 'closed_at' by year). Ask one granularity of it in `timeDimensions`."

The three faces answer one refusal, `dataset-group-column-door.ts` (formerly the draft preview's copy of the engine's): the ObjectQL strategy calls it on the keys it built on its direct and cross-object paths, and the preview on the keys the direct path would build. The engine's own refusal in `@objectstack/objectql` is unchanged, and a direct `engine.aggregate` caller, who can alias, still gets its prescription.

One selection carrying two faults answers the other one now. Example: `dimensions: ['region']` beside `timeDimensions: [{ dimension: 'zone', granularity: 'month' }]`, where `zone` is declared over the text column `region`. The engine judges a bucket over a text column (`INVALID_FIELD`) before a column named twice, and both live faces answered that. They now answer the column refusal, as the draft preview already did. It is still a 400 refusal, and fixing it meets the other one.
