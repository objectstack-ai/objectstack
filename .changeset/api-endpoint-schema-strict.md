---
"@objectstack/spec": minor
---

<!-- adr-0087: not-required (no-migration-prescription) this change retires NO key. The endpoint vocabulary is byte-identical and only the unknown-key POSTURE moves, from strip to reject. Nothing exists for `objectstack migrate meta` to rewrite, because an undeclared key was never honoured in the first place: it was dropped at parse and so never reached storage, the matcher or the executor. No stored shape carries one, and no authored shape that ever WORKED becomes invalid. There is also no single FROM/TO rule a ledger entry could state, since what is now refused is an open set of author typos rather than a renamed key. The upgrade channel is the schema rejection itself, which is strictly more specific than any ledger line: it names the offending key at the author's own path and carries either the canonical spelling or a wrong-layer pointer at the surface that really owns the key. The one ADR-0087 entry that DOES govern this surface, `declarative-apis-endpoints-live`, is already registered for protocol 17 and is updated by this PR rather than duplicated. Measured blast radius: 0 affected entries across `examples/*` (2 endpoints) and the `cloud` repo (0 endpoints). -->

`ApiEndpointSchema` rejects undeclared keys (#5384), and the author-state type is named on the upgrade path (#5227)

`api` became a registered metadata type at #5312, which made
`packages/spec/src/api/endpoint.zod.ts` an AUTHORING surface — `defineStack({ apis })`,
the Studio metadata-admin form, and `PUT /meta/api/:name`'s 422 — while it was still a
plain open `z.object`. An undeclared key was therefore dropped on every path: a
`cacheTTL` / `objectParam` / `outputMappings` typo parsed green, published green, and the
endpoint then served without the policy or projection its author wrote. That direction is
fail-safe for `authRequired` alone (an unrecognized spelling leaves the default `true`
standing); it was never fail-safe for the mapping, cache and rate-limit blocks.

The shape is now `strictObject`, so an undeclared key is a named rejection carrying the
surface, the offending key and a rename. Two curated wrong-layer prescriptions ship with
it:

- **`namespace`** — ADR-0121 D2 derives the namespace segment of `path` from
  `manifest.namespace`; it has never been per-endpoint, so the rejection points at the
  manifest instead of suggesting a rename.
- **the six stored-envelope bookkeeping keys** (`packageId`, `state`, `version`,
  `published*`) — written onto the stored ROW by `register` / `publishPackage`, never onto
  a declaration.

**The order this landed in is the part worth keeping.** Closing the shape was measured and
REFUSED first: the same schema parsed STORED rows at `buildEndpointIndex` and
`gateApiItemsForPublish`, so a naked `strictObject` failed every row with
`unrecognized_keys: ['packageId', 'state']` — the load-time backstop excluded the endpoint
(404) and the publish gate reported a schema error in place of the ADR-0121 D6 verdict it
exists to give. The debt was real and it was not in this vocabulary, so #5309 (PR #6576)
paid it at the layer that owned it (`peelStoredEnvelope`). `ApiEndpointSchema` never
learned a bookkeeping key.

**Breaking for metadata that was already silently broken.** An `apis:` entry carrying an
undeclared key now fails `objectstack validate`, `objectstack build` and the metadata write
path instead of publishing with the key discarded. Measured before landing: the example
corpus (2 endpoints) and the `cloud` repository (0 endpoints) carry zero undeclared keys,
so nothing in-tree changes verdict.

`api` also leaves the #4001 campaign's `STILL_STRIP` list — closed registered types 24 → 25
of 26, with `view` the only entry left — and the CLI metadata gate's row moves from
`NOT_YET_CLOSED` into `GATED_AT`.

**#5227** — no schema change. `ApiEndpoint` already denotes the AUTHOR state after ADR-0122
phase 2, so omitting `authRequired` compiles; what was missing was anywhere saying so. The
`declarative-apis-endpoints-live` upgrade-guide entry, whose whole safety argument is that
"an omission is SAFE", now carries the type annotation that makes the omission writable:
annotate declarations `ApiEndpoint`, hold parse results as `ApiEndpointParsed`.
