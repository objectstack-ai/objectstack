---
"@objectstack/rest": patch
---

refactor(rest): the audit and reset door call sites are compiled against the declared contract (#11678, #11679)

The `GET /meta/:type/:name/audit` and `DELETE /meta/:type/:name` doors in
`packages/rest/src/rest-server.ts` reached their protocol methods through
`(p as any)` — once for each feature-detection guard, once for each call — so
the compiler checked nothing about the request literals they built. The two
casts were load-bearing in opposite ways, both measured: the audit door's on
**member existence** (`auditMetaItem` was undeclared in `packages/spec`
entirely — removing the cast answered `TS2339`), the reset door's on **request
shape** (`deleteMetaItem` was declared, but its request schema carried 2 of the
8 members the door sends — removing the cast answered `TS2353` on six keys).

With `MetadataProtocol.auditMetaItem` declared and
`DeleteMetaItemRequestSchema` caught up (the spec half of this landing), the
guards are now `typeof p.auditMetaItem !== 'function'` / `if (!p.deleteMetaItem)`
and each request is a named const typed against the spec contract — the reset
door through `TransportScopedMetaRequest<DeleteMetaItemRequest>` (it still
spreads the transport-level `environmentId`, which stays layered on by the
#9741 envelope rather than becoming a protocol key), the audit door as a plain
`AuditMetaItemRequest` (it stopped sending `environmentId` when #8747 scoped
the read, so there is no transport member left to layer on).

**No behaviour change of any kind, and nothing about the wire moves.** The
outgoing payloads are byte-identical (same keys, same conditional spreads); the
edits hoist each literal into a const and drop type-level casts. The 501
feature-detection guards survive on purpose: both members are declared
**optional** (a kernel may implement neither door), and each guard is also what
narrows its member to callable at the call site. An undeclared key in either
literal is now a compile error instead of a payload member no contract has ever
seen.
