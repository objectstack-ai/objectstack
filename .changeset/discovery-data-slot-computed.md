---
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

Both discovery builders now derive the `data` service entry from the implementation in the slot, closing the hardcoded "kernel-provided" block (#4130).

#4089 computed `metadata`; `data` was the last entry that judged itself, reporting `status: 'available'` and `handlerReady: true` unconditionally. That was true — but by a convention in a different package, not by anything either builder checked: ObjectQL is the slot's only producer, and plugin-dev always loads `ObjectQLPlugin` as a child, so plugin-dev's `data` stub (`find()` returns `[]`, `insert()` mints an id and stores nothing) never reaches the slot. A second producer, or a trimmed dev config, and the hardcode starts lying about the platform's most load-bearing capability.

Both builders now read the registered service's `__serviceInfo`:

- a real engine carries no marker ⇒ `available` + `handlerReady: true`, byte-identical to the hardcode it replaces (verified on a real kernel boot);
- a self-declared stub ⇒ its own `status` and `message`, with `handlerReady: false` (the default for `stub`), so a consumer that gates on `handlerReady` stops treating an empty query engine as a real one.

`handlerReady` is derived here rather than pinned `true` as it is for `metadata`, because the two routes differ: `/meta` answers from the protocol whatever fills the metadata slot, while `/data` needs the `protocol` or an objectql-shaped service and 503s without them — and the only stack where a stub occupies the `data` slot is one where ObjectQL never registered. No routing, gating or dispatch behavior changes: the `data` domain resolves its engine directly and never consulted this slot.
