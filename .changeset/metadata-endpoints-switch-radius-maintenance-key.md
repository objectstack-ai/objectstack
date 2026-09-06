---
"@objectstack/spec": minor
"@objectstack/rest": minor
---

feat(spec): every `metadata.endpoints.*` switch gates exactly the face its name states, and the whole-store operations get their own key `maintenance` (#15542, #15854)

`RestServerConfig.metadata.endpoints` declared three switches, each `describe()` naming
exactly one route, and each gated a different set. The mismatch ran in **both**
directions at once:

- **`items`** — declared "GET /meta/:type - List items of type" — also gated the
  whole-store family: the cross-type spec-validation sweep `GET /meta/diagnostics`, the
  draft list `GET /meta/_drafts`, and the **`POST /meta/_migrate-stored` write door**.
  An operator who switched off a listing read they considered chatty silently unmounted
  a migration door.
- **`item`** — declared "GET /meta/:type/:name - Get specific item" — gated four
  *reads* (`/:type/:name`, `/references`, `/layers`, `/book/:name/tree`) and left the
  per-item **writes** `PUT` and `DELETE /meta/:type/:name` plus the whole history family
  (`/history`, `/audit`, `/diff`, `/published`, `/publish`, `/rollback`) answering to
  `api.enableMetadata` alone. An operator who closed the per-item surface left its
  writes mounted.

Neither is a liveness defect — all three keys were genuinely read — which is why no
ADR-0049 census could ever flag them: what drifted was each key's **radius** against its
own documentation.

**One principle now holds across the block: a switch gates exactly the face its name
states, reads and writes alike.**

| key | mounts it gates (default prefix `/meta`) |
|---|---|
| `types` | `GET /meta`, `GET /meta/types` — one handler, two paths (unchanged) |
| `items` | `GET /meta/:type` — and nothing else |
| `item` | `GET` / `PUT` / `DELETE /meta/:type/:name`, `/references`, `/layers`, `/history`, `/audit`, `/diff`, `/published`, `/publish`, `/rollback`, and `GET /meta/book/:name/tree` |
| `maintenance` | **new** — `GET /meta/diagnostics`, `GET /meta/_drafts`, `POST /meta/_migrate-stored` |

All four `describe()` strings are rewritten to enumerate what they gate, so the
generated reference page is the radius rather than a sample of it.
`api.enableMetadata` remains the master switch above all four, and
`GET /meta/object/:name/state/:field` — the object FSM read, addressed by object name
rather than by `:type/:name` — deliberately stays under that master switch alone.

**BREAKING** — for a programmatic embedder that authors `RestServerConfig.metadata.endpoints`,
the mounted route table moves for two of the four keys, in opposite directions:

- **`items: false` now removes one route instead of four.** An embedder relying on it to
  close `/diagnostics`, `/_drafts` and the `POST /_migrate-stored` door **regains all
  three** unless it also sets `maintenance: false`. That is a write door coming back, so
  it is the half to read twice. One line restores the old table:
  `endpoints: { items: false, maintenance: false }`.
- **`item: false` now removes twelve routes instead of four.** An embedder relying on it
  to close only the per-item *reads* while keeping `PUT`, `DELETE` and the history family
  mounted **loses those eight**. There is no key that restores them — the per-item face is
  one face by this ruling — so an embedder that wants the writes keeps `item` on and
  closes the surface at `api.enableMetadata` or at the object's own `enable.apiMethods`.
- **The exported type `MetadataEndpointsConfigParsed` narrows: `endpoints` gains a
  REQUIRED member `maintenance: boolean`.** `maintenance` is `z.boolean().default(true)`,
  so it is optional on the way *in* and always present on the way *out* — and
  `MetadataEndpointsConfigParsed` is `z.infer<typeof MetadataEndpointsConfigSchema>`, the
  OUTPUT side. Any code that builds one of these objects by hand — a test fixture, a
  helper returning the parsed shape, a `satisfies MetadataEndpointsConfigParsed` literal —
  stops compiling with `TS2741: Property 'maintenance' is missing`. This one IS
  compiler-carried (the ADR-0087 D8 class), which is the good case: the break is loud, it
  lands at build time, and no runtime behaviour depends on the author noticing a
  changelog. Add `maintenance: true` to restore the previous mounts, or `false` to keep
  the whole-store family closed. In-repo consumers of the type: none — the narrowing was
  measured against a probe compiled from the rebuilt declaration, not assumed.

Priced and accepted rather than deferred: `RestServerConfig` is reachable from **no
shipped boot path** today (`os serve` fixes the config and the dev plugin passes none,
#15543), so the measured population of affected authors is **zero** and the blast radius
is programmatic embedders only. That is precisely why this lands now — once a boot path
starts authoring the config, the same change becomes a behaviour change on live
operators.

**ADR-0087 disposition: a D3 semantic migration, no D2 conversion.** No
authored key changes shape or spelling — `items: false` still parses to `items: false`,
`maintenance` is additive with `.default(true)`, and nothing is retired (`endpoints.schema`
stays the #14691 tombstone it already was). There is nothing for the conversion layer to
convert: a `RestServerConfig` is plugin TS configuration, never a stack collection member
and never a `sys_metadata` row (the `RestServerConfig.openApi31` precedent, #4579), so no
rehydration seam sees it. What changes is a mounted route table at construction time.

Nor is the RADIUS change compiler-carried on the AUTHORED side — and that is the half a
D3 is owed for. Every authored key is an optional boolean, so `{ items: false }` still
compiles and still parses and simply mounts a different table: the author is told
nothing. (The parsed-type narrowing in the third BREAKING bullet above *is*
compiler-carried, but it catches only code that hand-builds the OUTPUT type — it cannot
reach the embedder who authored `{ items: false }` and now silently gets three routes
back.) So for the change that actually moves the route table, both channels that would
otherwise reach a consumer are blind, which is precisely the residue D3 exists for — the prescription is registered as
`metadata-endpoints-switch-radius-repartitioned` so `objectstack migrate meta` hands
it to an upgrading embedder instead of leaving it as prose in a changelog.

<!-- adr-0087: registered metadata-endpoints-switch-radius-repartitioned -->

`@objectstack/rest` is versioned alongside rather than as a passive consumer: it is where
the gates live, so the route-table change is observable there and not only in the
declaration.

Every key's radius is pinned route by route, in both directions, in
`packages/rest/src/rest-config-mount-table.pin.test.ts` — the #15544 shape, which asserts
each route is **absent from the mounted table** when its switch is off rather than what
the switch normalizes to. A gate that grows or loses a route reddens there.
