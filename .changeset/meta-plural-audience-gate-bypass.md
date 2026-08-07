---
"@objectstack/rest": patch
---

fix(rest): `GET /meta/books/:name` no longer bypasses the ADR-0046 §6.7 audience gate (#6241)

The single-item metadata read has a cached branch and an uncached one, and the
ADR-0046 §6.7 audience gate lives in the uncached one. The comment above the
cached branch's entry condition has always stated why `doc` and `book` must skip
it:

> `doc` and `book` bypass the shared cache: their §6.7 audience gate is
> per-caller, and a shared ETag would leak gated content across viewers.

The condition beneath that sentence compared the **raw** `:type` path segment
against the literals `'doc'` / `'book'`. The route serves both spellings, and
Prime Directive #3 makes the **plural** one canonical — so
`GET /api/v1/meta/books/:name` did not match the exclusion, took the cached
branch, and the audience gate never ran. `enableCache` defaults to `true`, which
made the failing path the default one.

Measured against a real `RestServer` — one book declaring
`audience: { permissionSet: … }`, one signed-in caller holding no permission
set:

```
singular "book"  :: cachedCalls=0 status=[403] PERMISSION_DENIED
plural   "books" :: cachedCalls=1 status=[]    full gated body served
```

Same book, same caller, two spellings of one route. `GET /meta/docs/:name` took
the same path. This was **fail-open**: the wrong outcome is disclosure of gated
documentation, not an availability error.

**The fix is structural, not two corrected literals.** This is #3984 recurring
in the same file eight days later, so the handler now normalizes the type
**once** at the top (`RestServer.metaTypeSingular`) and every gate below reads
that local — a per-type gate added later has no raw param in scope to compare
against by accident. The cache exclusion and the §6.7 gate now read one shared
predicate, so "which types bypass the cache" and "which types are audience
gated" can no longer drift apart. A repository guard
(`pnpm check:meta-type-normalized`, AST-based, zero exemptions) refuses the next
raw comparison in `packages/rest/src`.

**Behaviour change worth knowing:** `GET /meta/docs/:name` and
`GET /meta/books/:name` now take the uncached branch, as their singular
spellings always did, so those two responses no longer carry an `ETag` /
`Cache-Control` validator and a conditional request no longer answers `304`. No
other metadata type is affected. The cost is only the 304's saved bytes —
`getMetaItemCached` delegates to `getMetaItem`, so the server does identical
work either way — and the ETag it gave up was a hash of the **unfiltered**
document, which is the cross-viewer leak the exclusion exists to prevent.
