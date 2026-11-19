---
'@objectstack/mcp': patch
---

feat(mcp): `query_records` and `aggregate_records` answer a `source` block, with a finished `line` in the caller's language

Clause-②: yes
Metadata-protocol: none

A successful `query_records` or `aggregate_records` answer now carries a top-level `source` key on both MCP doors (HTTP and stdio): the block `ObjectQuerySourceSchema` (`@objectstack/spec/ai`) already types, composed from the read the tool ran. It names the object, the caller's `where` exactly as sent (`filter`), the aggregations and group keys, the caller's own `orderBy` with the cut beside it (`limit`), the lookups read through `expand` (`related`), a one-record-per-group reading over one key (`latestPer`), and `records` where the read established it: a page read's counted total, or an uncut aggregate's bare `count` summed over every group, never after a cut. `scope` is `visible_to_you` on every call: these doors ask no row-filter question, and the read runs under the caller's permissions and row-level security.

`source.line` is that source as one sentence of at most 280 characters, in the caller's language (en, zh-Hans, zh-Hant, ja; the shared picker `pickSentenceLocale` over the bridge's `userTextLocales`, the ladder `ifNotRecorded` reads), naming the object and its fields by the labels the caller's served definition shows and by the caller's own names otherwise. The tool descriptions tell the model to quote it as the source of a figure. Before this, an aggregate answer came back as a bare number.

No existing key changes. An error answers no block; `get_record` answers none, since its answer is the record itself. A read the schema cannot state truthfully (one record per group over several keys), or a block the schema refuses, is answered without the block. Each call now reads the caller's served object definition once for the labels; a bridge without `servedObjectDefinitionOf` gets machine names, and one without `userTextLocales` gets English.
