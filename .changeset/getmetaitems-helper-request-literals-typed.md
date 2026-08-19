---
"@objectstack/rest": patch
---

refactor(rest): the non-door `getMetaItems` request literals are compiled against the declared contract (#9805)

Nine `getMetaItems` call sites in `packages/rest/src/rest-server.ts` outside the
four meta-read doors still passed their request through `as any` (or through a
`p: any` parameter), so the compiler checked nothing about them. Every member
they thread has been expressible in declared types since #9741 landed
`previewDrafts` on `GetMetaItemsRequest` and the `TransportScopedMetaRequest`
envelope for the transport-level `environmentId` — the casts were pure
blindness, and an un-typed request literal is exactly the class that lets a
future key drift silently.

Each literal is now a named const typed
`TransportScopedMetaRequest<GetMetaItemsRequest>` (or plain
`GetMetaItemsRequest` where the site threads no `environmentId`), the same shape
#9741 gave the doors: the object-metadata read behind the API-exposure gate, the
audience book fetch, the book-tree book and doc listings, the doc corpus behind
the audience resolver, the public-form view lookup, the public-form object
schema, the public-lookup reference resolution, and the dataset listing.

**No behaviour change of any kind, and nothing about the wire moves.** The
outgoing payloads are byte-identical (same keys, same conditional spreads); the
edit hoists each literal into a const and drops a type-level cast. Two spellings
at these sites deliberately SURVIVE, because retiring either would change
behaviour rather than typing, and both are now documented on the envelope alias:

- the optional call (`getMetaItems?.(…)`) and the `typeof … === 'function'`
  guards — `getMetaItems` is a required `MetadataProtocol` member, so these are
  not feature detection in the type sense, but a host may occupy the protocol
  slot with an object that does not implement the whole surface (the reason
  `metaTypeIsLive` documents the same spelling for `getMetaTypes`). Retiring one
  turns a tolerated absence into a `TypeError`;
- the result handling — the verb is declared to return `{ type, items }` while
  these sites also tolerate the bare-array shape older hosts and stubs return,
  so the response stays runtime-shaped on purpose.

Genuinely feature-detected server-only verbs (`getMetaDiagnostics`,
`listDrafts`, `migrateStoredMetadata`, …) are untouched — runtime casts are the
documented convention there, and tightening one would turn optional capability
detection into a hard dependency.
