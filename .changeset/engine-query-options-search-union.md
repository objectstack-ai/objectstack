---
"@objectstack/spec": minor
"@objectstack/metadata": patch
---

fix(spec): `EngineQueryOptionsSchema.search` accepts the bare query string ADR-0061 D1 calls canonical (#7178)

Two sibling schemas in `packages/spec` described the same key and disagreed.
`BaseQuerySchema.search` (`query.zod.ts`, hence `QueryAST`, hence `DriverQuery`)
has been `z.union([z.string(), FullTextSearchSchema])` since its own drift
repair, with a doc comment saying why: the bare string **is** the canonical
Tier-1 contract (ADR-0061 D1 — "the client sends only the query text; the server
resolves which fields to search from object metadata"), it is what every surface
sends, and it is what the dogfood HTTP proof pins.
`EngineQueryOptionsSchema.search` — the options type of `IDataEngine.find` /
`findOne` — declared the structured `FullTextSearchSchema` **only**.

The runtime never agreed with that narrowing. `expandSearchOnAst`
(`objectql/src/engine.ts`) reads `search` through `normalizeSearch`, whose first
line is `if (typeof raw === 'string') return { query: raw }`, and
`protocol-data.test.ts` asserts the protocol layer hands the engine a bare
string. So the type forbade what the engine serves, and callers paid the
standard price: `as any` on the query argument — which does not suppress
`search` alone, it switches off checking for `where` / `orderBy` / `fields` in
the same literal. Since this schema is not `.strict()`, an unknown key there is
**silently dropped**, so the cast this divergence forced was precisely the cast
`check:query-options-erasure` exists to stop.

This is the same-family drift REPAIR, not a new dialect — the identical fix
`BaseQuerySchema.search` already carries, for the identical reason. On the query
side the divergence surfaced as a validation failure the moment #3899 started
validating request bodies; here it surfaced as a type error, when #6231 retyped
`DatabaseLoader`'s read helpers to `DriverQuery` and the **engine** branch alone
refused to compile (TS2345 — `DriverQuery` not assignable to
`EngineQueryOptionsParsed`, purely because of `search`; nothing else differs).

Consumer census before landing, per the card's own guard: every site that reads
object-form members off an engine-options `search` already narrows with `typeof`
— `engine.ts` (`typeof raw === 'object' ? raw?.fields : undefined`),
`search-filter.ts` `normalizeSearch`, and `metadata-protocol/protocol.ts`'s
`searchFields` ingress gate. No consumer needed a guard added, and none changes
behavior: they were all written for the union already. `count` is untouched —
`EngineCountOptionsSchema` declares no `search` key at all.

With the schemas agreed, the casts the divergence forced are deleted:
`DatabaseLoader`'s three engine-branch `as any` (`_find` / `_findOne` /
`_count`), which restores real `where` / `orderBy` / `fields` checking on the
metadata main read path, and the seven `as any` in
`engine-findone-contract.test.ts` that were passing the canonical spelling.
`scripts/query-options-erasure-baseline.json` is ratcheted down accordingly.
