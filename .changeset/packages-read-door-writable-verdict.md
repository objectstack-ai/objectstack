---
"@objectstack/runtime": patch
"@objectstack/metadata-protocol": patch
---

feat(packages): `GET /packages` and `GET /packages/:id` rows carry the server's own `writable` verdict (#14375)

ADR-0130 Consequences row 6, server half. Every package row served by the two
read doors now carries `writable: boolean`, computed by the SAME predicate the
authoring and lifecycle gates already enforce — `isWritablePackage` (ADR-0070
D2) — so a client no longer has to guess it.

- **Why.** Studio's package switcher derived "writable" client-side from
  `manifest.scope` alone (`scope !== 'project'`). That is not the server's
  rule: `isWritablePackage` reads `engine.manifests` FIRST, so a package booted
  from an artifact through `registerApp` is read-only whatever its scope says —
  and a scope-less `type: module` carried by a multi-package artifact lands
  there too. A scope-less Studio-created database base is writable. The client
  cannot see `engine.manifests`, so it cannot tell those two apart; the server
  can, and now says so (#8146: one answer to "is this package writable?").
- **Where.** The runtime dispatcher door (`handlePackagesRequest`, list and
  detail) decorates its read of the registry records; the metadata protocol's
  `getMetaItems({ type: 'package' })` — the producer the REST `GET /packages`
  door spreads its registry half from — decorates the same records the same
  way. Both are spread COPIES: the registry's own records are never mutated and
  the verdict is never stored.
- **Additive.** No existing key changes; no accept/reject surface moves. A REST
  row that has no registry presence (durable-only) carries no verdict, and the
  REST detail door's database-first row does not either — the registry item is
  the only carrier, by design.
