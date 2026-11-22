---
'@objectstack/rest': patch
---

fix(rest)!: the restriction profile is served on the unscoped route only; its environment-scoped twin is no longer mounted (ADR-0138 D2, as amended)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, no export changes, and no stored row or authored value moves. What moves is one anonymous REST route: under environment scoping the restriction profile is no longer mounted on the scoped base. Nothing in this repository reads that path, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a client that read `GET /api/v1/environments/:environmentId/discovery/restriction-profile` on a server with `api.enableProjectScoping: true`: that path is no longer mounted and answers the host's ordinary `404`. The scoped path was mounted by the same change that introduced the route, so it has only ever been served by builds that include that change. It ships `patch` because it is a non-protocol breaking change: no metadata author writes a route, so `Metadata-protocol` is `none`.

**What was wrong.** `@objectstack/rest` registers its discovery routes once per mounted base, so a server with environment scoping on also served the restriction profile on the scoped base. That handler reads nothing from the host: for any environment id it answered the constant open profile (`allowCode: true`, every flow node type). On a host that enforces a narrower profile, and serves that one through its own route on the unscoped path, the scoped path published, without a credential, a profile the environment does not honour.

**Now.** The route is mounted on the unscoped base only. `GET /api/v1/discovery/restriction-profile` is unchanged: the same body, the same empty query set, still unmounted by `api.enableDiscovery: false`, and a host's own route on that path still wins by mount order. `os validate --target <url>` reads that unscoped route at the URL's origin, so it is unaffected.

A server under `api.projectResolution: 'required'` mounts the scoped base alone, so it now serves no restriction-profile route. Before this change it served the profile only on the scoped path, which `os validate --target` never read.

Fix for a client that read the scoped path: read `GET /api/v1/discovery/restriction-profile`.
