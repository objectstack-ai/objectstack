---
'@objectstack/rest': patch
---

`GET /api/v1/meta/:type/:name` answers `404 RESOURCE_NOT_FOUND` for a name with nothing behind it, instead of `200` carrying the declared envelope minus its `item` member (#18066).

Measured on a real server (`examples/app-showcase`, API 17.4.0, four absent names, all identical):

```
GET /api/v1/meta/app/no_such_app_xyz
200 {"type":"app","name":"no_such_app_xyz","lock":"none","editable":true,"deletable":true,"resettable":false}
```

Two declarations in this repository already said otherwise, and this restores what they declare rather than deciding anything new. `GetMetaItemResponseSchema` — the route's own `responseSchema` — makes `item` a required member; parsing the body above against it fails `invalid_type` / `expected: 'nonoptional'` at `item`. And the **cached** arm of this same route has always answered this condition with `404 RESOURCE_NOT_FOUND`, because `getMetaItemCached` throws on a falsy `item`. Which arm a request took was deciding whether absence was an error at all — `app`, `dashboard`, `doc`, `book`, `?state=draft`, `?preview=draft`, `?package=` and every `enableCache: false` deployment are diverted around the cache.

- **Every type is affected, not only `app`.** The fall-through sat in the shared tail of the uncached arm, below the per-type gates. The report measured `app` because that type bypasses the cache structurally; a `?state=draft` or `?package=` read of any type reached the same 200.
- ⚠️ **The break was at `JSON.stringify`, not in the producer.** `metadata-protocol`'s `getMetaItem` returns `{ type, name, item: undefined, lock, … }` for a miss — `item` is *present* holding `undefined`, which `z.unknown()` admits — so the returned object conforms and only the serialized body does not. A conformance probe written against the object rather than the wire bytes reports agreement.
- **The permission denial is unchanged.** `403 PERMISSION_DENIED` for an app that exists and whose `requiredPermissions` the session lacks answers exactly as before: the new check is ordered ahead of every gate, and those gates are reachable only by a document that exists, so an absent name can never be converted into a denial. Enumerating app names through the 403 stays impossible.
- **It also closes an enumeration hole in the other direction.** ADR-0045 §3 makes an unpublished app *externally unobservable*, and an unpublished app answered this 404 while a nonexistent name answered the 200 — so the pair of responses reported which app names exist-but-are-unpublished. Both absence answers now come from one emitter and are byte-identical.
- **An unreadable metadata store is still `503`, never this 404.** That distinction is a producer-side throw and never reaches the new check.

⚠️ **For callers**: a probe that read "the call did not throw" as "this name resolves" now sees the 404 it should always have seen. A caller that read the item-less 200 as a create-vs-edit signal must read the status instead. The console side was already corrected independently (objectui#9262 reads both dialects as absence), so no first-party consumer depends on the old shape.
