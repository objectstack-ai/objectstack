# ADR-0122: One naming family for schema type aliases — bare name is the author state, `XParsed` is the parsed state

**Status**: Accepted (2026-08-06) — ruled by the maintainer on 2026-08-06 on the #5551 decision brief ("裁 C,分期倾向 C2"). **Phase 1 (additive `XParsed` + backflow gate) implemented in #5551.** Phase 2 (flipping the bare names, and deciding `XInput`'s fate) is deferred to the next `@objectstack/spec` major and is **not** authorized by this record beyond the direction it fixes.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0089](./0089-unify-visibility-predicate-naming.md) (canonical name + alias + lint + phased major — the template this reuses, and the reason the phasing looks familiar), [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (the upgrade contract this change deliberately does *not* need, because phase 1 removes nothing), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (the AI-authoring population whose default keystroke this decision is chosen to make correct)
**Consumers**: `@objectstack/spec` (every `src/**/*.zod.ts`), every package and example app that annotates a value with a spec type, `@objectstack/qa`'s downstream-contract fixtures, and every AI author of `*.object.ts` / `*.view.ts` / connector and flow definitions
**Surfaced by**: #5551, which was filed to move `integration/connector.zod.ts` onto what its author believed was the established house convention — and which measurement disproved. There was no house convention; there were two undocumented dialects, and the one three separate sources called "the house convention" was the 8-file minority.

---

## TL;DR

A Zod schema denotes **two** types, and `packages/spec` has been spelling them two
different ways with nothing written down about which is which:

| | what it is | who holds it |
|:---|:---|:---|
| `z.input<typeof XSchema>` | the **author state** — defaulted keys optional, pre-transform | anyone writing metadata by hand or by LLM |
| `z.infer<typeof XSchema>` | the **parsed state** — defaults applied, transforms run | anyone holding the result of `XSchema.parse(...)` |

**Decision: the bare name `X` denotes the AUTHOR state; `XParsed` denotes the PARSED
state.** The deciding argument is the one keystroke every author writes first —
`const c: Connector = { ... }` — which must be correct by default, everywhere, without
the author knowing which domain they are in.

Flipping 1384 aliases is a major-window change. So this lands in two phases, and
**phase 1 breaks nothing**: it *adds* `XParsed` wherever the parsed state is a
genuinely distinct type, so that every consumer whose meaning phase 2 will change
already has a name to move to. A gate keeps that coverage from decaying in between.

## Context

### There was no house convention — there were two dialects and a misreading

#5551 opened with a table asserting that `shared/retry-policy.zod.ts` "and the great
majority of its siblings" put the author shape on the bare name, making
`integration/connector.zod.ts` a third, deviant spelling. A full census of
`packages/spec/src/**/*.zod.ts` (208 files, 1612 alias declarations) says the opposite:

| bare alias reads | count |
|:---|---:|
| `z.infer` — the parsed state (connector's spelling) | **1384** |
| `z.input` — the author state (retry-policy's spelling) | **86** |

Grouped by which name carries the author state:

| family | shape | files | note |
|:---|:---|---:|:---|
| **A** | bare = `z.input`, parsed = `XParsed` | **8** | `automation/` (7) + `shared/retry-policy.zod.ts` |
| **B** | bare = `z.infer`, author state on `XInput` where it is named at all | **189** | every domain |

Three first-hand sources describe family A as the house convention, and **all three
scope it to `automation/`**: `retry-policy.zod.ts`'s own JSDoc says "the house `X` /
`XParsed` convention used by **the sibling control-flow configs**"; #4963 called `etl`
"the last file **in `automation/`** that had not caught up"; #5507's title is "two more
places **in `automation/`** that have not honoured `X` / `XParsed`". A full sweep of
`docs/adr/` found **no ADR recording either dialect**. So the sentence everyone was
reasoning from — "connector deviates from the house convention" — was describing a
local practice as a global one, and no record existed to correct it.

That is the actual defect this ADR fixes. Not connector: the **absence of a written
decision**, which let a local habit be cited as a global rule and nearly bought a
breaking rename that would have moved one file from the 189-file majority into the
8-file minority, lowering repo-wide consistency at the cost of a public API break.

### Why not simply bless the majority

Family B is the majority, and "the majority wins" is the cheapest migration. It is
also the option that leaves the default keystroke wrong forever.

Under B, `const c: Connector = { ... }` does not compile — `enabled`, `status`,
`connectionTimeoutMs`, all of `syncConfig`'s defaulted keys are required in the parsed
state, and `syncConfig.schedule` demands the `{ dialect, source }` envelope instead of
the cron string an author writes. The author's recourse is to know that this domain
spells the author state `ConnectorInput`. That is a fact about a file, and an LLM
generating metadata has no reliable way to know it — which is exactly how #5515's
fourth diagnostic (a bare cron string that would not compile) was produced, and it was
closed by editing the *example's annotation* rather than the cause.

Family A makes the first keystroke right. Every author, human or model, who writes
`const c: Connector = { ... }` and lists only what they mean is correct, in every
domain, with nothing memorized. That is the ADR-0033 axis, and it decides this.

## Decision

**D1 — The bare alias name denotes the AUTHOR state.** For a schema `XSchema`,
`export type X = z.input<typeof XSchema>`. This is the name documentation, examples,
skills and AI authoring surfaces use for the thing an author writes.

**D2 — `XParsed` denotes the PARSED state.** `export type XParsed = z.infer<typeof
XSchema>` — the shape `XSchema.parse(...)` returns, with defaults applied and
transforms run. `XParsed` is the *only* sanctioned name for it: not `XOutput`, not
`XResolved`, not `XParsedType`.

**D3 — A schema with only one shape gets only the bare name.** When `z.input` and
`z.infer` of a schema are the *same type* (enums, plain unions, objects with no
`.default()` / `.transform()` / `.catch()` / `.pipe()` anywhere in their tree), the
parsed state is not a distinct thing and **must not** be given a second name. A
permanent synonym is a name an author can only pick wrongly, and 721 of them would be
721 coin flips added to the public surface for no gain. This is the startup-focus
principle applied to vocabulary: a name earns its place from a use it actually serves.

**D4 — Phase 1 is additive and ships as a minor.** It declares `XParsed` for every bare
`z.infer` alias covered by D5, changes no existing declaration, removes no export
(including every `XInput`), and alters no schema semantics. Nothing an author or
consumer writes today stops compiling.

**D5 — The phase-1 coverage criterion: an alias is covered iff its schema's two shapes
differ.** Concretely: `export type X = z.infer<typeof XSchema>` receives a sibling
`export type XParsed = z.infer<typeof XSchema>` if and only if
`z.input<typeof XSchema>` is not the same type as `z.infer<typeof XSchema>`.

The criterion follows from what phase 1 is *for*. Phase 2 changes what the bare name
means. It changes it observably **exactly** where the two shapes differ; where they
coincide the flip is a no-op and there is nothing to migrate. So the set that needs a
migration target now is precisely the set whose meaning will move — no smaller (or
phase 2 breaks consumers with nowhere to go), and no larger (or the surface gains
synonyms that violate D3).

Two alternatives were measured and rejected:

- **"Cover the schemas that already declare an `XInput`"** (102 aliases, 52 files) —
  the reading the dispatch inherited from the first measurement summary. It is the
  wrong set: of the 663 aliases whose meaning phase 2 changes, only 91 carry an
  `XInput` today. It would leave **571 at-risk aliases with no migration target**,
  chosen by the historical accident of who once bothered to name an author shape.
- **"Cover every bare `z.infer` alias"** (1384) — uniform and trivially checkable, but
  it mints 717 permanent synonyms in direct violation of D3, and asks every author to
  choose between `SyncStrategy` and `SyncStrategyParsed` at 717 sites where the choice
  is meaningless.

**D6 — The complement is PINNED, not merely documented.** D5's exemption is a claim
about types, and isomorphism rots: add a `.default()` three levels down and an alias
silently joins the covered set with no signal. So every exempt schema carries a
compile-time assertion that `z.input` and `z.infer` really are the same type, in
`packages/spec/src/type-alias-convention.pin.test.ts`. tsc proves the exemption on the
same run that type-checks the package, and the file goes red — naming the alias — the
day one stops being true. An exemption nobody can state falsely is the only kind worth
having; this is the same instinct as `check:durability-log-level`'s empty baseline.

**D7 — The backflow gate.** `pnpm check:spec-parsed-alias`
(`scripts/check-spec-parsed-alias.mjs`, in lint.yml's `lint` job) requires every bare
`z.infer` alias in `packages/spec/src/**/*.zod.ts` to be either paired with its
`XParsed` or pinned under D6, and reports a pin that no alias relies on any more. It
reads the pin file as its registry: **one artifact, two jobs** — the gate gets a
machine-readable exemption list and tsc keeps every entry on it honest.

The gate is **not** in `packages/lint`. That package's contract is an in-memory,
schema-parsed *metadata graph* — its module header states "no I/O, no runtime, no
filesystem" — and a rule about the shape of our own TypeScript source cannot live there
without being the only rule in the package that opens a file. Source-shape guards
belong with the source-shape guards (`check:error-code-casing`, `check:route-envelope`,
`check:engine-double-contract`).

**D8 — Phase 2, deferred to the next major.** Flip the covered bare names to
`z.input`, and decide `XInput`'s fate then — retire it in favour of the bare name, or
keep it one release as a deprecated alias. That decision needs its own record, because
`XInput` is load-bearing in at least one place phase 2 must not break: the
`@objectstack/qa` downstream-contract fixtures import eleven domains' `XInput` by name
and their header says "DO NOT migrate these". Phase 1 deliberately leaves every
`XInput` in place, so those fixtures are untouched by this change.

## Consequences

- `@objectstack/spec` gains **657 exported type aliases**, all type-only: no runtime
  code, no bundle size, no JSON Schema, no authorable surface. The `api-surface` shards
  grow by the corresponding names; `json-schema/` and the `authorable-surface` shards do
  not move, which was verified rather than assumed.
- Consumers holding a parsed value can migrate to `XParsed` **now**, incrementally,
  under a minor — which is the point. A consumer that does nothing is equally fine
  until the major.
- The 718 pinned schemas will occasionally graduate **in both directions**, and both are
  loud. A schema that gains a `.default()` turns its pin red, and the fix is one alias
  plus one deleted pin line. A schema that *loses* its last defaulted key turns the gate
  red instead, and the fix is the mirror image — retire the `XParsed`, add the pin. The
  second direction is not hypothetical: it happened during this change's own final sync,
  when protocol 17 (#5552, ADR-0049) retired `FieldMapping.transform` and the whole
  `FieldMappingTransform` union. `FieldMappingTransform` stopped existing altogether, and
  `FieldMapping` — which had two shapes only because of that key — became isomorphic and
  moved from the covered set to the pinned set. Neither move needed a human to notice it.
- #5507 (two `automation/` files that have not honoured `X` / `XParsed`) is re-scoped
  by this record rather than closed by it: those files are already in family A, so what
  remains there is phase-2 work.
- `packages/spec/docs/SYNC_ARCHITECTURE.md` said connector "has not been moved onto that
  house convention yet". Corrected in this change: there was no house convention to be
  behind, and the target convention is now this ADR.

## Appendix: the measurements

Two independent rounds agree. Round one is the 2026-08-06 03:24Z census recorded on
#5551; round two is this change's re-measurement against `origin/main@739f496`, run
because several `*.zod.ts` files had landed in between (#5976 and others).

### A. Alias census (round two; round one in brackets where it differed)

| | value |
|:---|---:|
| `*.zod.ts` files scanned | 208 |
| type-alias declarations matched | 1612 |
| bare alias = `z.infer` | **1384** [1384] |
| bare alias = `z.input` | **86** [86] |
| pre-existing `XParsed` aliases | 36 |
| pre-existing `XInput` aliases | 106 |
| family A files (declare an `XParsed`) | 8 |
| files with at least one bare `z.infer` alias | 189 |
| bare `z.infer` aliases with an `XInput` partner | 102 [108] |
| files containing such a pair | 52 [55] |

The top-line 1384 / 86 split reproduced exactly. The "B family" figure quoted downstream
as *108 aliases across 55 files* is the `XInput`-partnered subset and has since drifted
to 102 / 52; more importantly, it was never the at-risk set — see C.

### B. Shape-difference probe

Every bare `z.infer` alias was compiled against a type-level identity assertion
(`z.input === z.infer`); a failure means the two shapes genuinely differ. 1383 aliases
were probed through their module; `ServiceObject` was probed separately because
`ObjectSchemaBase` is not exported, and it differs.

| | count |
|:---|---:|
| shape **differs** (covered by D5) | **663** |
| shapes **coincide** (exempt under D3, pinned under D6) | **721** |
| files containing at least one differing alias | 152 |

Per domain, differing aliases: `api` 155, `system` 125, `kernel` 99, `data` 66, `ui` 64,
`cloud` 44, `ai` 24, `studio` 22, `automation` 15, `identity` 15, `shared` 12,
`security` 11, `integration` 10, root 1.

### C. Why the `XInput`-partnered set is the wrong criterion

Of the **663** aliases whose meaning phase 2 changes, only **91** carry an `XInput`
today; **572** have no author-state name at all. Conversely **10** isomorphic aliases
*do* carry an `XInput` that names nothing distinct. Presence of an `XInput` is a fact
about repo history, not about the schema.

### D. `integration/connector.zod.ts`, the file that surfaced this

The probe independently reproduced round one's connector table exactly:

- **shape differs (10)**: `ConnectorFieldMapping`, `DataSyncConfig`, `WebhookConfig`,
  `RetryConfig`, `ErrorMappingConfig`, `HealthCheckConfig`, `CircuitBreakerConfig`,
  `ConnectorHealth`, `Connector`, `DeclarativeConnectorEntry`
- **isomorphic (9)**: `SyncStrategy`, `ConnectorConflictResolution`, `WebhookEvent`,
  `WebhookSignatureAlgorithm`, `ConnectorRetryStrategy`, `ConnectorErrorCategory`,
  `ConnectorType`, `ConnectorStatus`, `ErrorMappingRule`

The twentieth alias, `ConnectorInput`, is already `z.input`. (#5551's body said "20
`z.infer` bare aliases"; it is 19 plus that one.)

### E. Three-repo importer survey (round one, unchanged by this phase)

Recorded for phase 2, which is when it starts to matter. No unexpected live dependency
was found.

- **objectstack** — bare `Connector` appears in two roles: *parse input* (`registerConnector`
  / `registerDegradedConnector`, four connector plugins' registry surface,
  `createXConnector()` literals, `ConnectorMaterialization.def`), which keeps the bare
  name at phase 2; and *parse result* (`RegisteredConnector.def`, showcase's
  `allConnectors`), which moves to `ConnectorParsed`. The other 18 aliases have zero
  type-position importers outside `packages/spec`.
- **objectui** — 0. All nine textual hits are English UI copy (`connector: 'Connector'`).
- **cloud** — 2, both *parse input* role, in `plugins/connector-stripe`.

### F. What phase 1 actually changed

Measured against `main` **as delivered** — that is, after the final sync that absorbed
protocol 17's `FieldMapping.transform` retirement (#5552) and the generated-artifact
sharding (#5837). Where these differ from the sections above, the sections above are the
census that *chose* the criterion and these are what applying it produced.

| | count |
|:---|---:|
| `XParsed` aliases added | **657** |
| `*.zod.ts` files edited | **149** |
| existing declarations modified, renamed or removed | **0** |
| final: bare `z.infer` aliases | **1383** |
| final: paired with an `XParsed` | **665** |
| final: pinned isomorphic | **718** |

665 + 718 = 1383, the whole population, which is the gate's own arithmetic on every run.

The drift from the census (659 aliases / 151 files / 1384 bare / 717 pinned) is entirely
#5552, and it is worth reading because it exercises both of D6's directions at once:

- `FieldMappingTransform` and its schema were **retired outright**, so its bare alias and
  the `FieldMappingTransformParsed` this change had added both cease to exist: 1384 bare
  aliases become 1383, and one covered alias disappears.
- `FieldMapping` had two shapes *only* because of the `transform` key. With the key
  tombstoned, `z.input` and `z.infer` coincide, so under D5 it is no longer covered and
  under D3 it must **not** keep a second name. `FieldMappingParsed` was therefore dropped
  and a pin added: 717 pins become 718, 667 paired become 665.

Neither move was noticed by a human. The gate reported `FieldMapping` as "neither paired
nor pinned" on the merged tree, and the direction was then settled by measurement (a
probe carrying a deliberate control assertion, so a vacuous pass was not mistaken for
isomorphism) rather than by assuming which way the retirement had pushed it.

149 files were edited rather than the 151 of the census: `shared/mapping.zod.ts` no longer
carries a net addition, and `automation/execution.zod.ts`'s differing aliases already had
their `XParsed`.

### G. Two findings the gate produced on its first real run

Worth recording because they are the evidence that the gate is not a tautology over
the same census that generated the change:

1. **`ServiceObject`** (`data/object.zod.ts`) was invisible to the probe — its schema
   `ObjectSchemaBase` is not exported, so no module-level assertion could reach it. The
   gate reported it as neither paired nor pinned; a separate assertion through the
   already-exported `ServiceObjectInput` / `ServiceObject` pair confirmed the two shapes
   differ, and it received `ServiceObjectParsed` like any other covered alias.
2. **Four redundant pins** in `automation/execution.zod.ts`. Those schemas are
   isomorphic *and* already carried an `XParsed`, so the generated pin list proposed an
   exemption nothing relied on. The stale-pin arm caught all four, and they were dropped.

Both are cases where the census and the gate disagreed and the gate was right, which is
the property that makes it worth running.
