---
'@objectstack/spec': minor
'@objectstack/objectql': minor
---

feat(spec,objectql): `IDataEngine.find`/`findOne` accept the author state — the engine fills `SortNode.order`'s declared default (#6300)

ADR-0122's core argument — "the first key an author writes must default
correctly" — now holds on the engine's primary read entry:

```ts
engine.find('task', { orderBy: [{ field: 'updated_at' }] })   // compiles; sorts asc
engine.find('task', { search: { query: 'renewal' } })          // compiles uncast
```

`find`/`findOne`'s `query` parameter flips from `EngineQueryOptionsParsed`
(`z.infer`) to `EngineQueryOptions` (`z.input`) — the same author-state shape
`count` already took. #6083 had pinned these two methods back to the parsed
state because the engine built its `QueryAST` by bare spread and filled no
default, so `order: undefined` would have reached drivers. The engine now runs
each authored sort node through `SortNodeSchema` (recursively through
`expand`) before the AST is built, so the declared default stays
single-sourced in `packages/spec`.

**Widening, not breaking, for typed callers**: every previously-compiling call
still compiles (`z.infer` values are valid `z.input`), and no query's answer
changes — the measured driver-side status quo was that all drivers already
coalesced a missing `order` to `'asc'`, the schema's declared default. The
three defaulted `search` flags (`fuzzy`/`operator`/`highlight`) are
`[EXPERIMENTAL — not enforced]`, read by no executor, and deleted from the AST
before anything downstream sees it — so `search` is deliberately not parsed,
which also keeps the wire-tolerated comma-string `search.fields` shape
working.

**One behavior change, for type-BYPASSING callers only**: a malformed sort
node smuggled past the type (`as any` / unparsed wire input) — the retired
`direction` spelling, or an unknown key — is now refused with
`SortNodeSchema`'s own prescription instead of being silently
dropped-or-honored per driver (one query, two orders — #4721's defect class;
the wire path's `normalizeSortNodes` already refused it). Write
`{ field, order: 'asc' | 'desc' }`, or omit `order` for the default.
