---
"@objectstack/runtime": patch
---

The dispatcher's `/meta` domain answers `GET /meta/:type/:name` for a name with nothing behind it with `404 RESOURCE_NOT_FOUND` on its generic `:type/:name` branch, instead of announcing the miss as a `200` (#18401).

**Clause-②: no** — no schema key moves, no accept set widens or narrows, no export changes, and no error code is minted: the refusal reuses the branch's own existing `deps.error('Not found', 404)`, whose code `standardErrorCodeForHttpStatus` already derives.

`protocol.getMetaItem` answers a miss with the protection envelope wrapped around an absent item — `{ type, name, item: undefined, lock, editable, deletable, resettable }`, because `resolveLockState(undefined, false)` is unconditional — never with `undefined`. The generic branch returned that straight through, and `JSON.stringify` at the transport then dropped the `item` member, so a caller was handed a `200` whose body is the declared `GetMetaItemResponseSchema` envelope **minus its required member**.

- **The branch disagreed with its own sibling.** The `object` branch of the same function already refused that exact shape and answered `404`, so one function answered "does absence mean success?" both ways, decided by which type you asked for. The generic branch now runs the same hit test.
- **A miss still falls through, it is not a hard refusal.** An item-less protocol answer hands the read on to the `MetadataService` resolver exactly as the object branch hands its own on to the ObjectQL registry; only a read that no resolver can satisfy reaches the `404`.
- **No new refusal dialect.** The fall-through ends at the branch's own pre-existing `404`, the ADR-0112 nested `{ success:false, error:{ code, message, httpStatus } }` this file already speaks — so the separate question of how this route spells its refusals is untouched.
- **What a caller observes**: a name with no item behind it. A request that was previously answered `200` with an item-less body is now answered `404`; a request that resolves to a real item is byte-identical to before, protection envelope included.
