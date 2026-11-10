---
'@object-ui/plugin-chatbot': patch
---

fix(plugin-chatbot): read the Ask data tools' answer source through the published `ObjectQuerySourceSchema`

Clause-②: no
Metadata-protocol: none

`detectAnswerSource` now lifts a data tool's `source` block with `ObjectQuerySourceSchema.safeParse` from `@objectstack/spec/ai`, the contract the producer serves, instead of its own member-by-member readers. A block the schema refuses (for example an `orderBy[].order` of `'ASC'`, an aggregation function the query dialect does not name, or a block without its `line`) is no block: the answer renders without the "How this was computed" panel, and nothing throws. A key the schema does not declare is stripped, so nothing else of the tool payload reaches the panel.

The lifted copy is now the whole parsed block, the members the panel does not draw (`orderBy`, `limit`, `related`, `latestPer`, `line`) included, so a cached conversation lifts it again on reload.

The package still exports the type under the name `AnswerSource`, now an alias of the spec's `ObjectQuerySource`. Its shape follows the contract: `scope` and `line` are required, `groupBy` and `aggregations` are optional, and an aggregation's `function` is the query dialect's `AggregationFunction`. A host that builds an `AnswerSource` by hand writes those members; one that only reads `detectAnswerSource`'s result needs no change.
