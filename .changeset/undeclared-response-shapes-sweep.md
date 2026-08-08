---
"@objectstack/spec": minor
"@objectstack/rest": minor
---

fix(spec,rest): three routes stop serving shapes their `responseSchema` never declared (#5882 #5950 #6442)

Sweep #6487. One admission criterion: a route serves a response shape its
declared `responseSchema` does not describe. Three members, one direction each,
stated per member rather than picked for cheapness.

**`GET /meta/:type/:name` — the ADR-0010 protection envelope is now declared
(#5950).** The uncached branch has always sent `lock` plus nine siblings on top
of `{ type, name, item }`, and `GetMetaItemResponseSchema` declared only the
three, so `.parse()` silently stripped every one of them. `lock` is the READ
half of the ADR-0008 optimistic-concurrency chain whose write half `#5745`
already declared — leaving it undeclared meant an SDK caller had to cast to read
it, the consumer-side tolerance Prime Directive #12 rejects. All ten keys are
declared **optional**, measured rather than assumed: the cached branch (the
default, `enableCache: true`) rebuilds the envelope as three keys and resolves
no lock at all, so `optional` here means "this branch did not publish it", never
"unlocked". Zero runtime change. Whether lock presence should depend on a cache
setting at all is the larger question #5950 raises and is deliberately left open.

**`?layers=true` becomes `GET /meta/:type/:name/layers` (#5882).** The flag made
one route answer two unrelated resource representations — the ordinary envelope,
and a three-layer diagnostic projection (`code` / `overlay` / `effective`) that
drives Studio's "code default vs override vs effective" tabs — while the route
declared a single `responseSchema`. Anything generating a client from the route
table wrote a parser that was simply wrong for the flagged call. Per the
maintainer's ruling the projection gets its own path and its own
`GetMetaItemLayeredResponseSchema`: one path, one shape. The alternative —
teaching the route declaration to express "two shapes chosen by a query flag" —
was rejected as a new primitive every future tool would have to understand, and
conditional response selection is exactly where codegen and AI-written clients
go wrong.

The `?layers=` spelling still answers the identical body during a deprecation
window (both entry points run one helper, so the two cannot drift), and now
carries `Deprecation: true` plus a `Link` header naming its successor. No
`Sunset` date: choosing the hard cut-off is a maintainer call.

**`GET /analytics/meta` narrows to what it serves (#6442).**
`AnalyticsMetadataResponseSchema.data` declared `{ cubes: CubeSchema[] }` while
both implementations of `AnalyticsService.getMeta` return a bare `CubeMeta[]`
that the runtime hands to `success()` verbatim. A client written against the
published contract read `data.cubes` and got `undefined`; validating a live
response against the schema failed outright. Per the maintainer's ruling the
declaration narrows to the `CubeMeta[]` projection — zero runtime change — and
the generated `references/api/analytics.mdx`, which was publishing the wrong
shape, corrects itself. If a dashboard ever needs `format` or `description`, the
recorded return path is to add the key to the `CubeMeta` projection (additive);
widening the endpoint back to full cube definitions would push each cube's `sql`
to clients and is not revisited.
