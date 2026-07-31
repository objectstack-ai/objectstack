---
"@objectstack/objectql": patch
"@objectstack/spec": patch
"@objectstack/metadata-protocol": patch
"@objectstack/service-queue": patch
---

fix(objectql,spec,metadata-protocol,service-queue): engine option bags are now a closed contract — unknown keys throw instead of silently doing nothing (#4371 option 2)

The engine declares `Engine*OptionsSchema` but never parses it at runtime, so
any option key outside the contract — a typo (`orderby`), a retired key
(`cursor`), a wire-protocol leftover (`object`, `count`), a key that only
works on other methods (`tenantId` on `count`) — rode along and was silently
ignored. All six methods now reject non-null unknown keys, naming the legal
set; retired keys (`cursor`/`distinct`) quote their #4286 tombstone; `null`
stays a withdrawal.

Per-method legal keys = the method's schema keys plus the documented extras:
`searchFields` (now declared on `EngineQueryOptionsSchema` — it was read by
the engine's `$search` expansion and sent by the protocol layer all along),
`onFieldsDropped` on `update` (contract-declared write observability), and
the driver pass-through keys (`transaction`, `tenantId`, `tenantIds`,
`timezone`, `bypassTenantAudit`, `preserveAudit`) on `find`/`findOne`/
`update`/`delete` — the methods whose bag actually reaches driver options.
`count`/`aggregate` never forward their bag, so pass-through keys there are
rejected rather than accepted-and-ignored. A drift pin holds the sets equal
to the schemas.

Also closed in the same sweep:

- A bag-level `object` key used to OVERRIDE the resolved object on the query
  AST (`{ object, ...query }` spread order), splitting `ast.object` from the
  table actually queried. The AST now keeps the resolved name; a direct call
  passing `object` is rejected, and the protocol layer refuses a POST-body
  `object` that contradicts the route (400 `QUERY_OBJECT_MISMATCH`) instead
  of picking a winner.
- `findData` no longer leaks protocol-layer vocabulary (`object`, `count`,
  `joins`, `windowFunctions`, `cursor`, `distinct`, non-aggregate `having`)
  onto the engine bag.
- Nested expand ASTs (`expand: { rel: { sort } }`) reject the four wire-only
  spellings exactly like the top-level bag (#4371 option 1 did the top level).
- The engine's OData-spelling reads (`$search`/`$searchFields`) are gone —
  the protocol normalizes to the bare keys; a direct call passing them now
  throws instead of half-working on one method.
- `DbQueueAdapter.purge`/`purgeFailed` passed `{ id }` — a key the engine
  never read, so purge deleted NOTHING (each delete threw into a warn-level
  catch) and purgeFailed always threw. Both now pass `{ where: { id } }`;
  the test fake's `delete` no longer accepts the signature the real engine
  rejects.

Migration for direct engine callers (wire/HTTP callers are unaffected): pass
only the keys your method's `Engine*OptionsSchema` declares (plus the extras
above). Anything else previously did nothing — delete it, or move it to the
layer that owns it.
