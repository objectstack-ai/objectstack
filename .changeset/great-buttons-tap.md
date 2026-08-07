---
"@objectstack/rest": major
"@objectstack/runtime": major
"@objectstack/client-react": major
---

**BREAKING** — `GET /meta/:type/:name` now answers exactly one body shape: the
`GetMetaItemResponseSchema` envelope `{ type, name, item, … }` that
`packages/spec` has always declared for it. On the default configuration this
endpoint used to answer the **bare metadata document** instead (#5563).

### What changed, and why it is breaking

The route had two mutually exclusive branches with different response
structures. The cached branch — reached whenever `metadata.enableCache` is on,
which is the **default** (`enableCache: z.boolean().default(true)`) — served
`getMetaItemCached`'s `result.data`, and that value has the envelope already
stripped. The uncached branch served `getMetaItem`'s envelope. So the one shape
the spec declared was the one a default deployment could not obtain, and the
envelope surfaced only when the cache was off or when the read structurally
bypassed it (`app`, `doc`, `book`, `?state=draft`, `?preview=draft`,
`?package=`). Consumers had no correct static type — they sniffed at runtime or
reached for `as any` (#5545 was blocked on exactly this).

The dispatcher's `/meta` domain had the same split one layer down: the protocol
resolver answered the envelope while the ObjectQL-registry and MetadataService
fallbacks answered bare documents. Both fallbacks now wrap what they found,
taking `type`/`name` from the request.

### Migration

`GET /api/v1/meta/object/customer`, default configuration:

```jsonc
// before — the bare document
{ "name": "customer", "label": "Customer", "fields": { /* … */ } }

// after — the declared envelope; the document is verbatim under `item`
{
  "type": "object",
  "name": "customer",
  "item": { "name": "customer", "label": "Customer", "fields": { /* … */ } }
}
```

- **Reading the body directly** (`fetch`, `client.meta.getItem`,
  `client.meta.getCached().data`): read the document at `.item`. Nothing inside
  it changed. `type` is the canonical singular metadata type name, so
  `/meta/objects/customer` and `/meta/object/customer` answer the same `type`.
- **`useObject` / `useFields` (`@objectstack/client-react`)**: `useObject().data`
  is now the envelope — `data.item.label`, `data.item.fields`, where it used to
  be `data.label` / `data.fields`. `useFields()` is unchanged (it already
  returns the flattened field list) and is the shorter path when fields are all
  you need.
- **`isMetaEnvelope`, exported from `@objectstack/rest`, is REMOVED.** It
  existed only to tell the two shapes apart. There is one shape now, so the
  replacement for `isMetaEnvelope(r) ? r.item : r` is `r.item`.
- **Not converged, deliberately**: `?layers=true` still answers the layered
  diagnostic projection `{ type, name, code, overlay, overlayScope, effective,
  validation }`. Collapsing three layers into one `item` would delete the
  diagnostic. Unaffected unless you pass that flag.
