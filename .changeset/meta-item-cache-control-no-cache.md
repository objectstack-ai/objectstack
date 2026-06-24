---
"@objectstack/objectql": patch
"@objectstack/rest": patch
---

fix(objectql,rest): single-item meta reads must revalidate (no `max-age=3600`)

`GET /api/v1/meta/object/:name` (and the other single-item meta reads served by
the cached path) sent `Cache-Control: public, max-age, max-age=3600`. Two bugs:

1. **Stale metadata for up to an hour.** Object metadata is invalidated by
   publish, but a one-hour TTL let browsers (and any CDN/proxy) serve a stale
   schema *without revalidating* — e.g. the AI-build "New" create form kept
   rendering pre-publish fields until the TTL lapsed. The list endpoint
   `GET /api/v1/meta/object` is uncached, which is why list views updated but
   single-object reads didn't. `getMetaItemCached` now returns
   `directives: ['private', 'no-cache']` with no `maxAge`, so the ETag validator
   (which already changes on publish) gates freshness: a cheap `304` when
   unchanged, fresh fields the instant a publish bumps the ETag. `private` also
   keeps per-tenant metadata out of shared caches.

2. **Malformed header.** The directives array carried a bare `max-age`
   placeholder *and* the REST layer appended `max-age=3600` from the `maxAge`
   field, concatenating into `public, max-age, max-age=3600`. The header builder
   now strips the bare `max-age` token before appending the real value, so a
   `maxAge` is emitted once as a well-formed `max-age=N`.
