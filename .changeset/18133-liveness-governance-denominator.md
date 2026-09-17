---
'@objectstack/spec': patch
---

The liveness ledger's published README no longer claims the metadata-type registry is "exactly the set of authorable metadata types" — the governance denominator is now that set, and every run prints it

`check-liveness.mts` built its coverage denominator from
`listMetadataTypeSchemaTypes()` under a comment stating that function returns
"exactly the set of *authorable* metadata types", and the ledger README carried
the same sentence. It is false in a specific, load-bearing way: that function
deliberately does not enumerate `UNREGISTERED_KIND_SCHEMAS` — enrolling those
entries there "would claim a status this change is careful not to grant" — while
the kinds bound in that map are authored on every boot through their stack
collections (`connectors:`, `sharingRules:`, `analyticsCubes:`, `webhooks:`) and
on every write through `PUT /api/v1/meta/:type/:name`, whose `resolveOverlaySchema`
resolves them through `getMetadataTypeSchema()`.

So `connector`, `sharing_rule` and `analytics_cube` sat in **neither** `GOVERNED`
**nor** `PENDING_GOVERNANCE`, and a type in no bucket produces no row in any of
this gate's lists. The blindness was therefore invisible in the gate's own
output: `ungoverned: []` read exactly the same whether the gate had looked and
found nothing or had never looked at all.

The denominator is now `authorableTypes()` — the registered kinds UNION
`listUnregisteredKindSchemaTypes()`, the enumeration helper that exists so a check
can read that map and which grants nothing by listing a name. The registry itself
is untouched: no kind is registered, no enum grows, no create seed is demanded and
no accept set moves, and the same split already landed one gate over as
`reachabilityRootTypes()` in `build-schemas.ts`. The three newly visible types are
recorded as declared debts with a reason and an issue number apiece, which is what
the ratchet asks for and what the README now says; the direction of travel is out
of that map and into `GOVERNED`.

Every run also prints the denominator and its composition unconditionally. That
line used to appear only when `PENDING_GOVERNANCE` was non-empty, so the one state
worth reporting — "N authorable types looked at, none unaccounted for" — rendered
as nothing at all, which is the same silence an unseen type produces.
