---
'@objectstack/rest': minor
'@objectstack/runtime': minor
---

fix(runtime)!: the runtime dispatcher's read points refuse a repeated single-valued query name as their `RestServer` twins do, instead of reading one value, a joined value or an array

The runtime dispatcher's `/meta`, `/ui`, `/i18n`, `/security`, `/packages` and `/data` read points each read a query name as ONE value. None of them guarded against the name arriving twice, because the only door in front of most of them, the `@objectstack/hono` `createHonoApp` catch-all, has always flattened a repeat to its last value. Handed an array, they answered wrongly: `GET /meta/object/:name/state/:field?from=a&from=b` answered a dead end for the joined state `'a,b'`; `_drafts`, `/ui/view` and the `/data` filter slot passed the array into the protocol call; both `/i18n` query-locale arms threw, which surfaced as a `500`; and the `/meta` list, the book tree, `/security/suggested-bindings` and `/packages` answered an empty or unscoped `200`. Each now refuses the repeat before any protocol or service call.

`@objectstack/rest` publishes the lists and rules both transports read, so the two cannot drift: `META_QUERY_ARITY_DOORS` (the single-valued names of the `/meta` list, book tree, `_drafts` and state machine doors, which `RestServer`'s twins of those doors now read from), the decision `metaQueryArityRefusal(door, query)`, and `assertFilterParamSuppliedOnce`, the `/data` list's filter-slot rule, on the package entry.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed. `@objectstack/rest` gains three exports (`META_QUERY_ARITY_DOORS` and `metaQueryArityRefusal`, new in `meta-item-read-gate.ts`, and `assertFilterParamSuppliedOnce`, already exported from its module and now on the entry). The four lists `RestServer` spelled inline were never exported, and its answers are byte for byte what they were. No stored row or package source changes, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the query accept set of ten runtime dispatcher routes (seventeen names, the `/data` filter slot counted once): a single-valued name supplied more than once now answers a located `400`, and the remedy is in the request a caller sends, never a rewrite of a package source or a stored row. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

What changes for you: a request that repeats one of the names below to the runtime dispatcher is now refused `400` in the dispatcher's own envelope, `{ success: false, error: { code, message } }`, instead of being answered with one value, a joined value or an array. The `code` is `VALIDATION_ERROR` with the sentence `RestServer` answers ("The "NAME" query parameter was supplied N times…"), except on the `/data` filter slot, which answers `INVALID_FILTER` with `RestServer`'s repeated-filter sentence. Send each name once.

- `GET /meta/:type`: `package`, `preview`, `object`, `include`, `id`.
- `GET /meta/book/:name/tree`: `package`.
- `GET /meta/_drafts`: `packageId`, `type`.
- `GET /meta/object/:name/state/:field`: `from`.
- `GET /ui/view/:object`: `type`, when the path names no type.
- `GET /i18n/translations` and `GET /i18n/labels/:object`: `locale`, when the path names no locale.
- `GET /security/suggested-bindings`: `status`, `packageId`. A repeated `status` was already refused `400`, as an unknown status; it now gets the multiplicity sentence.
- `GET /packages`: `status`, `type`, beside `enabled`, which was already refused.
- `GET /data/:object`: every spelling of the filter slot (`filter`, `where` and their aliases, `filters`, `$filter`). Genuinely multi-valued names such as `select` and `expand` are untouched.

A name sent once is answered as before, and one sent once as a one-element array now reads as that one value everywhere. Where a caller meets this today: `GET /packages` through `@objectstack/plugin-hono-server`, whose adapter already keeps repeats as arrays. Every other point is reached on a shipped host only through `createHonoApp`, which still flattens a repeat to its last value, so until that adapter keeps repeats the refusals are visible only to a caller of `HttpDispatcher.dispatch()` that passes an array. The `@objectstack/client` SDK sends each of these names once.
