---
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

refactor(metadata-protocol): the module preamble of `protocol.ts` moves, verbatim, into 22 themed `protocol-*.ts` modules

Clause-②: no
Metadata-protocol: none

A move with no behaviour change. Every top-level declaration that stood above `ObjectStackProtocolImplementation` in `src/protocol.ts` (183 statements: helpers, error classes, the query-parameter and filter vocabulary, request and event types) now lives in a themed module beside it, byte for byte with its comments. `protocol.ts` re-exports every name it exported, so `@objectstack/metadata-protocol`'s entry is unchanged: the published `index.d.ts` keeps the same declarations in the same order and the same ESM and CJS export list, and differs only in blank lines, the order of names in one `@objectstack/spec/api` import list and the member order of one literal union. Nothing to migrate.

`@objectstack/spec` ships its `liveness/` ledger: two evidence citations in `liveness/query.json` (`QUERY_AST_KEYS`, `WIRE_DOLLAR_ALIASES`) now name `protocol-list-query-params.ts`, the module those lines moved to. No schema, type or export of `@objectstack/spec` changes.
