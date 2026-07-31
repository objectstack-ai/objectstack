---
"@objectstack/runtime": patch
---

fix(runtime): the `callData('query')` ObjectQL fallback serves the caller's query instead of dropping it (#4386)

When the protocol service is unavailable (lean assemblies, MCP multi-env with
a raw driver), the fallback passed only `{ context }` to `ql.find` — the
caller's `where`/`orderBy`/`limit` never left the function, and the ENTIRE
table came back as an ordinary-looking `{ records, total }`. The sibling
`get`/`update`/`delete` fallbacks all built a proper `where`; `query` was the
only verb whose fallback forgot the request.

The fallback now forwards the canonical QueryAST keys both possible
recipients execute (`where`, `fields`, `orderBy`, `limit`, `offset` — engine
option bag and raw-driver QueryAST are aligned by design), drops a
caller-supplied `context` (server-derived only, matching `findData`), and
refuses with 501 anything it cannot reproduce without the protocol layer —
wire spellings needing fold/lowering (`sort`, `select`, `skip`, `populate`)
and capabilities a raw driver would silently drop (`search`, `expand`). The
protocol path is unchanged and keeps accepting wire spellings.
