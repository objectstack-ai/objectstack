---
'@objectstack/rest': minor
'@objectstack/runtime': minor
'@objectstack/client': minor
---

Retire compound-name metadata addressing (`/meta/:type/:section/:name`)

Stage 3 of the maintainer-ruled retirement of slash-bearing metadata item names.
Stage 1 declared the item-name grammar and refuses every slash-bearing name at
the publish door, so the routes removed here addressed only names that can no
longer be created.

**BREAKING — three public REST routes stop answering:**

| stops answering | use instead |
| :-- | :-- |
| `GET /api/v1/meta/:type/:section/:name` | `GET /api/v1/meta/:type/:name` |
| `PUT /api/v1/meta/:type/:section/:name` | `PUT /api/v1/meta/:type/:name` |
| `GET /api/v1/meta/:type/:section/:name/published` | `GET /api/v1/meta/:type/:name/published` |

Each retired route folded its `:section` and `:name` segments back into one
slash-bearing key (`views/all_leads`) that the protocol layer then treated as a
single opaque string — the section half was never stored, filtered or
enumerated. A request to a retired path now answers `404 ROUTE_NOT_FOUND`.

The `@objectstack/runtime` dispatcher stops folding in the same way: its
`/meta` handler requires exactly two path segments for an item and three for
`…/published`, instead of re-joining every trailing segment. A `/meta` path
that matches no route now answers a located `404 ROUTE_NOT_FOUND` rather than
falling through to the adapter's anonymous 404.

**FROM → TO for callers.** Address every item through the single-segment route
and percent-encode the name:

```
GET /api/v1/meta/lead/views/all_leads     →  GET /api/v1/meta/lead/views%2Fall_leads
```

`@objectstack/client` now calls `encodeURIComponent` on every `/meta` item
address, so SDK callers need no change: the SDK already sends the new spelling.
Encoding is a **no-op** for every name the item-name grammar admits (lowercase
snake_case segments, optionally dot-qualified), so the bytes on the wire are
unchanged for every name that can be written today.

A pre-grammar **residue** row whose stored name contains a slash remains
readable, writable and deletable: `%2F` matches the single-segment pattern and
the parameter is decoded back to the stored spelling before the handler runs.
Nothing that could be stored has become unaddressable.

Two SDK doc comments that promised "compound names pass through unencoded"
(`meta.getPublished`, `meta.publishItem`) are corrected, and the
`SaveMetaItemOptions.mode` carve-out — `{ mode: 'draft' }` was silently ignored
at the compound door and published live — is closed at the source: there is one
door, and it reads every member of the options bag.

<!-- adr-0087: not-required (already-registered metadata-item-name-grammar-enforced) the stage-1 semantic entry already names this exact surface — "the compound `:type/:section/:name` fold" — and carries the re-authoring prescription (dot-qualified, or flattened with an underscore). This stage removes the routes that fold; it adds no new authorable shape and no second migration prescription. -->
