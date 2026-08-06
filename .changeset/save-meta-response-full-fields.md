---
"@objectstack/spec": minor
---

feat(spec): `SaveMetaItemResponseSchema` declares the whole save response — `version` / `seq` / `state` / `projectionApplied` (#5745)

`PUT /api/v1/meta/:type/:name` has always answered with more than the schema
admitted. The declaration stopped at `{ success, message? }` while the route
returns `{ success, version, seq, state, message }` — plus `projectionApplied`
when a projector is registered — so the contract described a proper subset of
the real body.

Because these are plain `z.object` schemas, the gap failed in the quietest way
available: `safeParse` stayed **green** and the undeclared keys were silently
**stripped**. Measured on `origin/main` before the change:

```
raw keys      : ["success","version","seq","state","message"]
after parse   : ["success","message"]
STRIPPED      : ["version","seq","state"]
safeParse ok  : true
```

`version` is the field this matters most for: it is the token the ADR-0008
optimistic-concurrency chain already runs on — echo it back as `If-Match` on
the next write and a concurrent edit returns 409 `metadata_conflict` instead of
silently overwriting. It was being carried on the wire with no contract behind
it, so a consumer that parsed the response lost exactly the value the OCC
handshake needs.

**Consumer-visible change.** Before, a `SaveMetaItemResponseSchema.parse()`
dropped the four fields and `SaveMetaItemResponse` could not name them at the
type level. Now they survive the parse and are typed:

- `version: string` — required. Opaque content hash; the ADR-0008 `If-Match`
  token. Echo it verbatim, never parse it.
- `seq: number` (integer) — required. Metadata-event sequence number; orders
  writes, but is not an OCC token.
- `state: 'draft' | 'active'` — required. The lifecycle the body landed in.
- `projectionApplied?: { success: boolean; error?: string }` — optional. The
  ADR-0094 mutation-projector outcome, present only when a projector is
  registered for that metadata type. Its absence means "no projector ran",
  never "the projection failed"; a caller that needs the derived read model to
  be live must check `projectionApplied.success` rather than trust the 200.

The three required fields are required because measurement says the producer
always emits them, not by assumption: `saveMetaItem` has a single success
return — the repository write path — and the REST route hands that object to
`res.json()` verbatim. A second, receipt-less legacy return would have forced
all three to be optional; it was proved unreachable and deleted in #5264 /
PR #5782, which is what makes `required` safe to state here.

No runtime behaviour changes: the route already returned these fields, and
nothing parsed the response through this schema. `client.meta.saveItem`'s
return-type annotation is deliberately left for the cli lane (#5545) so it is
written against the landed contract rather than ahead of it.
