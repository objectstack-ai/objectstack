---
"@objectstack/spec": patch
---

test(spec,objectql): pin the `IMetadataService` `register` → `get` round-trip across every shipped implementation (#7223)

`register(type, name, data)` and `get(type, name)` are the contract's first two
CRUD members, and until now the round-trip between them was exercised in exactly
ONE place — `contracts/metadata-service.test.ts`, against a `Map`-of-`Map`s
double written inside the test itself. No **shipped** implementation was held to
it. That is the hole #6725 fell through: `MetadataFacade.register('object', …)`
wrote into a map none of its own reads consulted, every read answered
`undefined`, and the full `packages/objectql` suite plus all 64 `lint.yml` gates
stayed green while a shipped, exported implementation of the platform's central
metadata contract could not perform its own most basic round-trip.

**`METADATA_ROUNDTRIP_CASES`** (`@objectstack/spec/contracts`) is the shared
table that closes it — 15 cases covering the plain round-trip on an object-typed
and a non-object-typed write, the miss shape, re-registration, type scoping in
both directions, name case sensitivity, and the `data`-keying and primitive-value
edges. Same shape as `FILTER_LOGIC_CASES`: one table, a thin driver per
implementation. Third-party authors implementing the contract can run it without
depending on ObjectQL.

Two drivers ship with it: the contract's own reference double (in `spec`, which
has no runtime and can see no implementation), and every implementation this repo
ships — `MetadataManager` with and without a writable loader,
`createMemoryMetadata`, and `MetadataFacade` — driven from `packages/objectql`,
the only package that can see all three at once.

No shipped behaviour changes. Where implementations answer a case differently
today, each answer is pinned as measured under a `// DIVERGENCE` marker rather
than reconciled — see the notes in the objectql driver and the card they link.
