---
'@objectstack/spec': minor
---

fix(spec)!: a flow `get_record` node's `limit` is declared a positive integer, so a fraction, `0` or a negative is refused at every door that parses a flow

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (already-registered flow-builtin-node-config-values-refused) registered before this change, amended in this diff: the entry's surface, replacement and reason now name a get_record limit that is not a positive integer, and the stored-row listing reports such a node under that id -->

**BREAKING** (a value the parse accepted is now refused), shipped as `minor` under the 18.x convention for breaking changes, with no retirement stage.

The `get_record` executor reads around the Data API's page-window normalizer: with `limit` above 1 it calls `data.find` with that LIMIT as written, and otherwise it calls `findOne`. The spec declared `limit` as any number, so a flow could declare a window the runtime did not honour as written.

- **FROM:** `GetRecordConfigSchema.limit` was `z.number()`. `limit: 2.5` parsed and reached the driver as `LIMIT 2.5`; `limit: 0`, `limit: -1` and `limit: 0.5` parsed and silently read one record through `findOne`.
- **TO:** `limit` is `z.number().int().positive()`. Every door that parses a flow refuses any other number at `nodes.N.config.limit` with the code `node-config-refused-by-contract`: `FlowSchema.parse`, `defineStack` (`STACK_SCHEMA_INVALID`, 422), `objectstack validate` and `objectstack compile`, the metadata save door, `AutomationEngine.registerFlow`, and an artifact's parse. The generated JSON Schema declares `type: integer` with an exclusive minimum of 0.
- **Fix:** write the count as a whole number of at least 1. `limit: 1` (or no `limit`) reads one record as `record`; a larger whole number reads a `records` list of at most that many.
- **Unchanged:** every positive whole `limit`, and a node with no `limit`. A string `limit` (`'10'`, `'{page.size}'`) was already refused as the wrong type.
- **Not the Data API's page window.** `QueryPageWindowSchema` admits `0`, which asks a list door for the total alone. A `get_record` node always reads at least one row, so its bound is its own.

Data at rest: a flow already stored with such a `limit` is refused whole when it registers. At boot it is skipped with a `warn` naming it and its trigger is not armed, while the flows beside it register. `objectstack migrate meta` reports it under `flow-builtin-node-config-values-refused`. No conversion rewrites it, because only the author knows the count they meant.

No producer writes such a value: every `get_record` `limit` in this repository's examples and tests, and in HotCRM, is a positive whole number.
