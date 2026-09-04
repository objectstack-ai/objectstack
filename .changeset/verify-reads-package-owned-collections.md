---
"@objectstack/verify": patch
---

fix(verify): `os verify` no longer reports a green run over a multi-package app it measured nothing about

Every reader in this package took the artifact's **flattened** top level and
nothing else. A multi-package app whose definitions live under `packages[]` —
the shape ADR-0130 D4's option B emits — therefore reached `deriveCrudCases`
with no objects and no datasources, and reached `rlsProbePermissionSet` and
`declaredPositionNames` with no objects and no positions. Nothing threw. The run
derived zero CRUD round-trip cases, built an empty RLS probe permission set,
minted no persona for any declared position, and printed `✓ verify passed`.

That is the most expensive place in the platform for a false green: `verify`'s
entire job is to be the thing that notices. A missing collection is at least
missing — zero coverage dressed as a passing run is not.

The four reads now resolve through `resolveArtifactPackageOrder`
(`@objectstack/core`, ADR-0130 D4+D5), **flattened top level first**:

- `deriveCrudCases` — the objects it derives cases for, and the datasource-by-
  name map behind ADR-0015's double write gate. Both, because objects alone
  would leave a write-opted-in federated object judged against an empty
  datasource map and reported read-only, i.e. skipped by a verifier that says it
  covered it.
- `declaredPositionNames` — one RLS persona per declared position.
- `rlsProbePermissionSet` — the object grants and the owner-scoped narrowing
  that are what make an RLS run a probe rather than a report about the object
  gate.

The top-level read still answers first and is returned untouched, so an app on
today's additive artifact gets a bit-identical answer, and a stack that declares
an empty collection (`objects: []` is truthy) still gets an empty one. Only a
top level that does not carry the key at all consults `packages[]`. A malformed
`packages` array now surfaces `resolveArtifactPackageOrder`'s ADR-0112 refusal
instead of reading as "this app declares nothing".
