---
'@objectstack/spec': minor
---

feat(spec): `GetMetaItemsRequestSchema` declares `names`, the batch by-names read of a `/meta/:type` list

Clause-②: yes (widening)
Metadata-protocol: added

A caller that wants a handful of items of one metadata type used to read the whole type, or read each item by name. The list request now declares an optional `names`, a list of item names:

- **What it answers.** Only the named items of the type, among those the list would answer without it. A name that matches no item is simply absent from the answer; there is no 404.
- **On the wire.** One comma-separated value, `GET /api/v1/meta/:type?names=a,b,c`, the data routes' convention for `fields` and `searchFields`. The request member is the protocol's post-parse shape, a list (`names: ['a', 'b', 'c']`); the REST door splits the value.
- **An empty value is refused.** The schema refuses an empty list (`minItems: 1` in the published JSON Schema), and the door answers an empty `?names=` with 400, rather than reading it as every item. Leave the key out to list every item.

This entry declares the member only. The REST door, the dispatcher and the store read that serve it are a separate change to `@objectstack/rest`, `@objectstack/runtime` and `@objectstack/metadata-protocol`; until a release carries it, a list request carrying `names` is answered as if it were absent.
