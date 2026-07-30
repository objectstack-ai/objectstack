---
"@objectstack/runtime": patch
---

fix(runtime)!: the /share-links dispatcher domain stops emitting a duplicate `link`/`links` beside `data` (#4038)

The producer-side other half of #3983. That PR moved the sharing plugin's routes
onto the declared envelope; this removes the compatibility shim the dispatcher
twin had been carrying *because* that surface answered bare.

Create and list answered with the payload under **two** keys:

```ts
{ success: true, data: link,  link  }   // POST /share-links
{ success: true, data: links, links }   // GET  /share-links
```

The duplicate existed so readers predating the envelope kept working — which is
why objectui's `ShareDialog` reads `body.links ?? body.data`. Once #3983 made both
surfaces answer `data`, that first branch had no producer left, and the duplicate
had no reader in **any** repo:

- **framework** — no consumer of these routes at all
- **objectui** — `ShareDialog` already falls through to `body.data`
- **cloud** — swept: it only *registers* `SharingServicePlugin` into per-environment
  kernels with `registerShareLinkRoutes: false` so this dispatcher serves the paths.
  It never calls them and never reads a body. That sweep is what #4038 was waiting
  on, and it came back clean.

## Shape

| route | was | now |
|---|---|---|
| `POST /share-links` | `{ success, data: link, link }` | `{ success, data: link }` |
| `GET /share-links` | `{ success, data: links, links }` | `{ success, data: links }` |

`data` is unchanged in both — only the duplicate key is gone. Anything reading
`body.data`, or going through `ObjectStackClient.unwrapResponse`, sees no
difference. A raw reader of the top-level `body.link` / `body.links` must move to
`body.data`.

The list route now routes through `deps.success(...)` like the domain's other
three. Create stays hand-built, because `deps.success` hardcodes status 200 and
this route is a **201** — the same reason `/keys` hand-builds its own 201, and the
same shape it uses.

## Guard

`scripts/check-route-envelope.mjs` does not and cannot cover this file: it scans
route modules that write via `res.json(...)`, while dispatcher domains return
`{ status, body }` for a central sender. So the drift was invisible to it by
construction. Three tests in `domain-handler-registry.test.ts` cover it instead —
two per-route, plus a general one asserting no success body carries a top-level
key outside `success` / `data` / `meta`. Restoring the duplicates fails all three.
