---
"@objectstack/client": patch
---

client SDK: `meta.getItem` / `meta.saveItem` declare their spec response types on both surfaces

`ObjectStackClient.meta` and `ScopedProjectClient.meta` each carried a `getItem`
and a `saveItem` with no return-type annotation, so `unwrapResponse` / `_unwrap`
resolved without a type argument and every caller received `unknown` — while the
`getItems` sitting one line above returned `GetMetaItemsResponse`. Two adjacent
methods on one surface, unequal typing (#5545).

Both now name the type `@objectstack/spec` already declares for their route, and
both types are re-exported from `@objectstack/client` so a caller can name what
it received:

- `getItem` → `Promise< GetMetaItemResponse >` — the `{ type, name, item }`
  envelope. This became the only honest annotation with #5563: before it, the
  route's default (cached) path answered the bare document and the non-cached
  path the envelope, so no single type described both.
- `saveItem` → `Promise< SaveMetaItemResponse >` — including `version`, the
  ADR-0008 optimistic-concurrency token a caller echoes back as `If-Match`.
  Nameable only since #5745 completed that schema; against the older
  `{ success, message }` declaration the annotation would have hidden the OCC
  carrier.

`patch`, not `minor`: this only narrows `unknown` on existing public signatures.
`unknown` admits no property read and no assignment to a typed binding, so every
expression that compiled before still compiles — nothing is removed, and no new
method or option appears.
