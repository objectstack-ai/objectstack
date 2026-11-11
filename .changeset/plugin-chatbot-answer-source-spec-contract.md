---
'@object-ui/plugin-chatbot': patch
---

fix(plugin-chatbot): read the Ask data tools' answer source through the published `ObjectQuerySourceSchema`

Clause-②: no
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata moved: the change is the reader of the AI data tools' result block and the TypeScript shape of the package's `AnswerSource` export, which now aliases the spec's existing `ObjectQuerySource`; no spec schema, stored row or authorable key changed, so there is nothing for `objectstack migrate meta` to rewrite, and the compiler reaches every TypeScript consumer at its own call site -->

`detectAnswerSource` now lifts a data tool's `source` block with `ObjectQuerySourceSchema.safeParse` from `@objectstack/spec/ai`, the contract the producer serves, instead of its own member-by-member readers. A block the schema refuses (for example an `orderBy[].order` of `'ASC'`, an aggregation function the query dialect does not name, or a block without its `line`) is no block: the answer renders without the "How this was computed" panel, and nothing throws. A key the schema does not declare is stripped, so nothing else of the tool payload reaches the panel.

The lifted copy is now the whole parsed block, the members the panel does not draw (`orderBy`, `limit`, `related`, `latestPer`, `line`) included, so a cached conversation lifts it again on reload.

The parsers the `@object-ui/plugin-chatbot/core` entry re-exports (`detectPendingApproval`, `chartsFromParts`, `chartAnswerParts`) now live in their own module, so the console's first load no longer reaches the chat's message mapper or the schema it parses with. Both entries export the same names as before.

**BREAKING** for TypeScript only: the package still exports the type under the name `AnswerSource`, now an alias of the spec's `ObjectQuerySource`, and its shape follows that contract. `scope` and `line` are required, `groupBy` and `aggregations` are optional, an aggregation's `function` is the query dialect's `AggregationFunction`, and `orderBy`, `limit`, `related` and `latestPer` are declared. Code that reads `groupBy` or `aggregations` as always present, or builds an `AnswerSource` without `scope` and `line`, stops compiling; the published runtime behaviour of every export is unchanged apart from the stricter reader above.
