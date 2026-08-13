---
"@objectstack/cloud-connection": patch
---

fix(cloud-connection): `features.installLocal` is derived from what is mounted; the constructor option becomes a ceiling (#8388)

`GET /api/v1/runtime/config` reported `installLocal` straight from the
constructor option, next to a `marketplace` key that #8356 had just made an
observation. Two flags in one object, answered by different rules — and the
declared one is the key #8343 actually measured wrong on a real self-hosted
deployment:

```json
{"features":{"installLocal":true,"marketplace":true, …}}
```

```
GET  /api/v1/marketplace/install-local -> 404 {"error":"Not found"}
POST /api/v1/marketplace/install-local -> 404 {"error":"Not found"}
```

Nothing checked that `MarketplaceInstallLocalPlugin` was mounted on the kernel
serving the response, so `new RuntimeConfigPlugin({ installLocal: true })` on a
runtime that never mounted it announced a capability whose route 404s, and the
Console rendered an install affordance that could not work.

The flag is now **observed** per request, off the route table of the app serving
the response — the same seam #8356 built, read by a sibling predicate rather than
a shared one, because the browse predicate subtracts exactly the paths this one
requires. The two share the prefix constant, so "what counts as install-local"
has one definition and the flags cannot both claim, or both disown, the same
route.

**The `installLocal` constructor option is kept, as a ceiling.** Hosts pass it
today, so it is not removed:

- omitted or `true` — report what is actually mounted (what every host passing
  `installLocal: true` already meant);
- `false` — report `false` even where the plugin is mounted, for an operator who
  wants the affordance hidden.

It deliberately cannot raise the answer. A plain override would have left the
measured defect standing: the CLI's own frozen `RUNTIME_CONFIG_OPTIONS` passes
`installLocal: true` unconditionally, so honouring `true` upward would keep
"declared `true`, route 404s" reachable on exactly the product path #8343
reported, leaving the derivation inert where it is most needed.

**What changes for hosts.** A runtime that mounts an install-local surface
reports exactly what it did before. A runtime that mounts none now reports
`installLocal: false` instead of whatever it declared — the correction. An
omitted option no longer means `false`: it defers to the observation, so a host
that mounts the plugin and forgot the flag now gets the truthful `true` it should
always have had.

**Escape hatch, unchanged.** The derivation is the base value, not a veto: the
open-core `resolveFeatures` seam still merges over it (and over the ceiling), so a
host on an adapter whose raw app exposes no route ledger — where both derived
flags conservatively report `false`, with a warning logged once at mount time —
can still declare the capability it knows it serves.
