---
"@objectstack/metadata": patch
---

fix(metadata,repo): every enumeration of the stack-collection set is now answerable to `stack.zod.ts`, and the artifact map stops aiming `data:` at the analytics kind (#6242)

`ObjectStackDefinitionSchema` decides which collections a stack may declare — 32
of them today. **Seven** other places re-enumerate that same set by hand (eight
enumerations in all, because ObjectQL declares its list twice), and nothing
compared any of them to the schema or to each other:

| Enumeration | Site |
|---|---|
| `MAP_SUPPORTED_FIELDS` / `PLURAL_TO_SINGULAR` | `packages/spec/src/shared/metadata-collection.zod.ts` |
| `MetadataCategoryEnum` | `packages/spec/src/kernel/package-artifact.zod.ts` |
| `metadataArrayKeys` ×2 | `packages/objectql/src/engine.ts` |
| `ARTIFACT_FIELD_TO_TYPE` | `packages/metadata/src/plugin.ts` |
| `APP_CATEGORY_KEYS` | `packages/runtime/src/app-plugin.ts` |
| `STACK_COLLECTION_COVERAGE` | `examples/app-showcase/src/coverage.ts` |

They had drifted independently: `ragPipelines` mapped in three of them though no
schema declares it; `workflows` / `approvals` / `roles` / `profiles` / `policies`
still iterated by both ObjectQL loops after ADR-0019 / ADR-0020 / ADR-0088 /
ADR-0090 retired them; `triggers` + `workflows` still legal artifact categories;
19 of 32 collections absent from that enum.

Every row looks like a one-line typo in isolation, and each **has** been fixed
one line at a time before — `docs` in `ARTIFACT_FIELD_TO_TYPE`, `roles` →
`positions` in the same map, `capabilities` in `metadataArrayKeys` — each still
carrying its "this key was missing and it silently dropped X" comment. The cause
is structural: `KIND_COVERAGE` is answerable to the metadata-type registry and
fails CI when a kind is added without an entry, and the liveness ledger is
answerable to the same registry. The collection maps were answerable to nothing.

**The gate.** `pnpm check:stack-collection-maps` (root
`scripts/check-stack-collection-maps.mjs`, wired into the lint job) derives the
collection set from `ObjectStackDefinitionSchema` — top-level keys whose value is
`z.array(<X>Schema)`, a mechanical rule rather than a second hand-kept list — and
reconciles all eight enumerations against it in **both** directions. Deriving them
is not possible today (they disagree on purpose as often as by accident: `views`
has no `name`, `data` seeds key by `object`, `translations` is a record), so each
deviation must instead be a waiver row **carrying its reason**, and the list is a
ratchet: a waiver that no longer applies fails, like a stale ledger row. An
enumeration whose symbol cannot be extracted fails too — an empty list would
reconcile against everything.

Writing it immediately found a **seventh** site the hand-audit had missed
(`APP_CATEGORY_KEYS`) and one divergence *between* the two ObjectQL copies that
neither list shows alone: `jobs`, `emailTemplates`, `tools` and `skills` are
registered from a manifest and **not** from a nested plugin, so a package
shipping them from a nested plugin registers nothing and stamps no ADR-0010
provenance. `capabilities` was added to that copy for exactly this reason
(#5870); nobody then asked what else the two lists disagreed about. Recorded as
a waiver with the measurement, not fixed here — closing it changes what a nested
plugin registers at boot.

**The one code change**: `ARTIFACT_FIELD_TO_TYPE` no longer maps `data:` (the
SEED collection) to `'dataset'` (the ADR-0021 analytics kind) — the exact name
collision `metadata-plugin.zod.ts` warns about in prose. The entry was provably
inert (`SeedSchema` declares no `name`, and the ingest loop skips nameless
items), so nothing changes at runtime; what changes is that a dead pointer aimed
at the wrong kind is gone, instead of waiting for either side to move. Not
repointed at `'seed'`: seeds are applied by `SeedLoaderService` off the bundle,
never registered as metadata items, so that would be new behaviour rather than a
corrected name. The absence is now pinned by the gate.

Everything else the gate reports is recorded as a waiver with its reason and left
alone, deliberately — three of the drift rows sit on **acceptance faces**
(`MetadataCategoryEnum` decides what a published artifact may declare) and the
rest are `engine-core` behaviour changes owing their own verification. The value
landing today is that all eight enumerations now have a checked relationship to
the schema rather than an assumed one.
