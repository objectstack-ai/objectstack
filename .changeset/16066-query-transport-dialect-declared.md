---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": patch
---

The query TRANSPORT dialect is declared — keys AND values — and the `findData` fold now derives from that one declaration.

`FindDataRequestSchema.query` declared `QuerySchema` — the canonical QueryAST — while the shipped `findData` door also accepted a second spelling of the same query through the same slot: `$filter` / `$top` / `$skip` / `$orderby` / `$select` / `$expand` and the plural `filters`. `@objectstack/metadata-protocol` folded them from a module-private table whose own comment called them "the wire-only spellings no schema declares". Two dialects, one slot, one of them declared — so every caller speaking the second was unverifiable at build time and unrejected at runtime.

**New in `@objectstack/spec/data`** (9 exports, 0 removed):

- `QueryTransportParamsSchema` / `QueryTransportParams` / `QueryTransportParamsParsed` — the transport parameters, each carrying the value of the canonical slot it folds onto.
- `QUERY_TRANSPORT_ALIAS_SLOTS` — `RPC_QUERY_ALIAS_SLOTS` extended with the transport-only spellings (`filters` / `$filter` onto `where`, `$expand` onto `expand`).
- `QUERY_TRANSPORT_DOLLAR_ALIASES` — the `$`-to-bare pairs that fold in two hops (`$top` onto `top` onto `limit`).
- `QUERY_TRANSPORT_DOLLAR_PARAMS` — the `$` spellings a boundary quotes when it refuses an undeclared one.
- `QueryWithTransportSchema` / `QueryWithTransport` / `QueryWithTransportParsed` — the query slot whose declared input is the AST or its transport spelling and whose parsed output is the AST plus the `count` flag.

**`FindDataRequestSchema.query` is that slot now.** Its `z.input` admits the canonical AST, the transport spelling, or a bag carrying both. Its `z.output` is `QueryAST & { count?: boolean }` — the canonical AST, plus the response total-count flag, which rides inside this slot on the wire and is read off it by `findData` rather than passed to the engine. The output is CONSTRUCTED: the fold's result is parsed by the AST schema and that parse's result is what leaves the transform, so a transport key or a non-AST value cannot reach a consumer. The transport form is the FLATTENED SPELLING of the canonical AST with a 1:1 alias table — never a second semantics — so `QuerySchema` itself is untouched and still drops a `$` key as unknown.

**One semantics means one set of VALUES, not only one set of keys, and that is what this declaration now enforces.** Every spelling of a slot accepts the same value shapes; each is lowered to the canonical member's declared shape, or refused. What lowers: a stringly-typed `$top` / `$skip` (`'50'` becomes `50`), a comma list on `$select` / `$searchFields` / `$expand`, a `{field: direction}` sort record, a relation-name list on `populate`, `'true'` / `'false'` on `$count`, and the input-only `FilterArray` sugar (`['status', '=', 'open']`) on every spelling of the filter slot — `where` included — lowered through `parseFilterAST`, the one declared sink (#5158 ruling C; `QuerySchema.where` still refuses the array).

**What is REFUSED at the parse**, because lowering it would mean parsing the spec must not do, and because emitting it would put a value under the AST type that the AST does not declare:

- a non-numeric `$top` / `$skip` (`$top: 'abc'`, `$top: ''`) — `400` instead of an engine call with `limit: null`, i.e. an UNBOUNDED read under a `200`, or `limit: 0`;
- a JSON-encoded `$filter` string (`'{"status":"open"}'`);
- an OData sort EXPRESSION on `$orderby` / `sort` (`'name desc'`, `'-created_at'`, `['name']`) — the record and `SortNode[]` forms are unaffected;
- a filter array no lowering can express, such as the INFIX join `[condA, 'and', condB]` — the prefix form `['and', condA, condB]` is the one the platform reads, and the engine already answered `400` for the infix one;
- a `$count` that is neither the boolean nor `'true'` / `'false'`;
- two spellings of one slot carrying different values — reported at the canonical path, quoting the spelling the caller actually wrote (`$orderby`, not `orderBy`).

These refusals narrow no DECLARED surface: none of these value shapes was ever declared, and each one the door could serve is still served. They narrow how far an unservable body travels before it is refused — from the engine, or from a wrong answer under a `200`, to the ingress that can name the parameter to fix. The GET querystring path is unchanged: it does not parse through this schema.

**`@objectstack/metadata-protocol` folds by the spec export** instead of its own table, and both resolved tables — plus the `$`-parameter list its `UNSUPPORTED_QUERY_PARAM` refusal quotes — are pinned byte-equal to their pre-change values. An undeclared `$` spelling is still refused loudly with the same `400 UNSUPPORTED_QUERY_PARAM`; the sentence now quotes `QUERY_TRANSPORT_DOLLAR_PARAMS` rather than a hand-copied list, so a spelling added to the table cannot leave the refusal naming a set the door no longer has.

Measured and unchanged: `getData` takes `select` / `expand` directly and carries no `query` slot, and `updateManyData` / `deleteManyData` take `records[]` / `ids[]` — none of the three has a transport-dialect split to declare.

Clause-②: yes (widening)
