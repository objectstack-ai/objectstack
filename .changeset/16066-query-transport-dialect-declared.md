---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": patch
---

The query TRANSPORT dialect is declared, and the `findData` fold now derives from that one declaration.

`FindDataRequestSchema.query` declared `QuerySchema` — the canonical QueryAST — while the shipped `findData` door also accepted a second spelling of the same query through the same slot: `$filter` / `$top` / `$skip` / `$orderby` / `$select` / `$expand` and the plural `filters`. `@objectstack/metadata-protocol` folded them from a module-private table whose own comment called them "the wire-only spellings no schema declares". Two dialects, one slot, one of them declared — so every caller speaking the second was unverifiable at build time and unrejected at runtime.

**New in `@objectstack/spec/data`** (8 exports, 0 removed):

- `QueryTransportParamsSchema` / `QueryTransportParams` / `QueryTransportParamsParsed` — the transport parameters, each carrying the value of the canonical slot it folds onto.
- `QUERY_TRANSPORT_ALIAS_SLOTS` — `RPC_QUERY_ALIAS_SLOTS` extended with the transport-only spellings (`filters` / `$filter` onto `where`, `$expand` onto `expand`).
- `QUERY_TRANSPORT_DOLLAR_ALIASES` — the `$`-to-bare pairs that fold in two hops (`$top` onto `top` onto `limit`).
- `QUERY_TRANSPORT_DOLLAR_PARAMS` — the `$` spellings a boundary quotes when it refuses an undeclared one.
- `QueryWithTransportSchema` / `QueryWithTransport` / `QueryWithTransportParsed` — the query slot whose declared input is the AST or its transport spelling and whose declared output is the AST.

**`FindDataRequestSchema.query` is that slot now.** Its `z.input` admits the canonical AST, the transport spelling, or a bag carrying both; its `z.output` is still the AST, reached by a transform driven by the two tables. The transport form is declared as the FLATTENED SPELLING of the canonical AST with a 1:1 alias table — never as a second semantics — so `QuerySchema` itself is untouched and still drops a `$` key as unknown.

**Nothing is narrowed, and nothing about the served behaviour changed.** The canonical arm of the union is `QuerySchema` unchanged, so every body that parsed before still parses, by the same schema, with the same issues. `@objectstack/metadata-protocol` folds by the spec export instead of its own table, and both resolved tables — plus the `$`-parameter list its `UNSUPPORTED_QUERY_PARAM` refusal quotes — are pinned byte-equal to their pre-change values.

**An undeclared `$` spelling is still refused loudly**, with the same `400 UNSUPPORTED_QUERY_PARAM`; the sentence now quotes `QUERY_TRANSPORT_DOLLAR_PARAMS` rather than a hand-copied list, so a spelling added to the table cannot leave the refusal naming a set the door no longer has.

Measured and unchanged: `getData` takes `select` / `expand` directly and carries no `query` slot, and `updateManyData` / `deleteManyData` take `records[]` / `ids[]` — none of the three has a transport-dialect split to declare.

Clause-②: yes (widening)
