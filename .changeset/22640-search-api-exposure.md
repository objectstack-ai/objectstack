---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: the cross-object search asks the spec's exposure decision for `search` on each object, so an `apiMethods` whitelist that withholds `list` keeps the object out of the sweep (#22640)

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime read door: the search stops serving objects whose existing `enable` declaration already refuses `search` on every other generic exit, and the remedy is the declaration the author already wrote. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The REST data routes, the runtime dispatcher, the MCP data tools and the analytics door judge an object's `enable` block through the spec's one exposure decision (`apiExposureDenialReason` / `canServeApiOperation`). In the derivation table, `search` derives from `list`. The cross-object search (`GET /search`, `searchAll`) spelled its own skip instead, and that skip read only `apiEnabled: false` and `searchable: false`.

**FROM.** The search swept an object whose `apiMethods` whitelist does not grant `list` (for example `['get']`, or the deny-all `[]`), unless the object also declared `searchable: false` or `apiEnabled: false`. It served that object's rows while every data route refused them.

**TO.** Before an object is queried, the search asks `canServeApiOperation(enable, 'search')`, and an object it refuses is skipped. A skipped object is never queried, named or counted. An explicit `objects=` naming it answers like one naming no object at all.

- **Every caller.** The decision takes no user, so administrators and context-less in-process calls skip the same objects.
- **`searchable: false` keeps its own skip.** The decision answers an object with no whitelist without reading that flag.
- **Unchanged.** An object with no whitelist, or with one that grants `list`, is swept exactly as before.

**Measured producers.** Read on `origin/main` `cb3bb933`: every object in this repository whose whitelist withholds `list` also declares `searchable: false` or `apiEnabled: false`, and no example app declares `apiMethods`. So no shipped object's search results change. Deployed and cloud-held object definitions were NOT MEASURED.
