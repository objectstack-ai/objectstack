# ADR-0059: Third-party backward compatibility is proven by layered gates, not by in-repo consumers

**Status**: Accepted (2026-06-21)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0054](./0054-runtime-proof-for-authorable-surface.md) (prove-it-runs for the authorable surface), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove)
**Consumers**: `@objectstack/spec` (the public API surface + `api-surface.json` snapshot), `@objectstack/downstream-contract` (the frozen fixture), the TypeScript Type Check + Test Core CI gates, the Release workflow, spec authors, platform contributors, and every third party consuming a published release.
**Amended 2026-08-06 (#5837), paths only — no decision changes**: the breadth snapshot this ADR calls `packages/spec/api-surface.json` is now the directory `packages/spec/api-surface/`, one shard per published entry point (`root.json` for `.`), and the authorable-key ratchet §5 defers to is `packages/spec/authorable-surface/`. `check:api-surface` reads the whole directory as one set, so every gate, verdict and breaking-change rule below is unchanged; only the file layout moved, to stop two PRs colliding in the GitHub merge queue.

**Surfaced by**: [#2035](https://github.com/objectstack-ai/objectstack/issues/2035) — 16 writable domains had no `defineX` factory, so third parties authored them as bare output-type literals; and [#2023](https://github.com/objectstack-ai/objectstack/issues/2023), where a root-import resolved to `any` and silently swallowed ~30 real type errors in the examples.

---

## TL;DR

ObjectStack is a development platform: the `@objectstack/spec` package **is** the
third-party API. A removed, renamed, or narrowed export — or a schema that stops
accepting previously-valid metadata — breaks every consumer pinned to a published
release the moment they upgrade.

Every consumer the framework tested before this ADR (the example apps,
`@objectstack/dogfood`, the Studio/Setup/Account apps) lives **in this monorepo
and co-evolves with the spec in the same commit**: when a spec change would break
them, the same PR just fixes them. So none of them can catch a break for a *real*
third party — e.g. [hotcrm](https://github.com/objectstack-ai/hotcrm) — that is
pinned to a **published** release and authors metadata independently. A breaking
change could be green on every framework gate and still shatter downstream after
publish. Call this gap **invisible backward-compat breakage**.

**Decision.** Backward compatibility for third parties is proven by a layered set
of gates, each with a defined job, none of which co-evolves silently with the
spec:

| Layer | Gate | Proves | Runs |
|------|------|--------|------|
| author-time | `defineX(config)` factories | a definition is valid at the point it is written | consumer's editor / module import |
| author-time | the bare-literal lint guard | the canonical authoring form is used, never a degradable `: Type` literal | every PR (examples + `packages/apps`) |
| load-time | `objectstack validate` | a consumer's *own* metadata parses against the spec, regardless of authoring style | the **third party's** CI (the authoritative self-gate) |
| framework · depth | `@objectstack/downstream-contract` | exercised exports still **accept** real third-party metadata | every PR |
| framework · breadth | `packages/spec/api-surface.json` snapshot | the whole public export set still **exists** (no silent removal/rename) | every PR |
| framework · live | the pre-publish hotcrm smoke | a real, independently-authored consumer still type-checks + validates | the Release workflow, pre-publish |

## Context

A metadata-driven platform makes two promises to third parties: *what you author
the way the templates show works*, and *what worked on version N keeps working on
N+1*. The first is covered by ADR-0049 (enforce-or-remove) and ADR-0054
(prove-it-runs). This ADR covers the second.

The spec's surface is large and almost entirely AI-authored, by design. Two
failure modes recur:

1. **Silent type-surface erosion.** A root-namespace import that resolves to
   `any` (#2023), or a `.default()` added to a schema that flips a `.input` field
   from optional to required, degrades or narrows the surface without anyone
   noticing — the static gates stay green because the in-repo consumers are
   edited in lockstep.
2. **An authoring gap that pushes consumers onto unsafe patterns.** #2035: 16
   domains had no factory, so the only authoring option was a bare
   `: DomainType` output-type literal — no runtime validation, and (via the
   `any` trap) no compile-time validation either. hotcrm did exactly this for
   pages / reports / actions / flows, including `: Action` (the output type),
   while using `defineView()` everywhere a factory existed.

The lesson from both: an in-repo consumer that is fixed in the same PR as the
spec change cannot be the witness for backward compatibility. The witness must be
something the change is **not allowed to edit**.

## Decision

### 1. Every writable domain has a `defineX` factory; bare output-type literals are banned in authoring surfaces

`defineX(config: z.input<typeof XSchema>): X { return XSchema.parse(config); }`
is the single authoring entry for every writable domain ([#2088](https://github.com/objectstack-ai/objectstack/pull/2088)
completed the remaining 16). It is the only form that is simultaneously
input-shape ergonomic, validated at authoring time, and — being a *value* import
— impossible to silently degrade to `any`. A `no-restricted-syntax` lint guard
bans bare `: DomainType` exported-const literals across `examples/**` and
`packages/apps/**` ([#2088](https://github.com/objectstack-ai/objectstack/pull/2088),
[#2097](https://github.com/objectstack-ai/objectstack/pull/2097)).

### 2. `objectstack validate` is the third party's authoritative self-gate

The runtime loader parses every metadata file against the spec schemas
regardless of how it was authored. A third party runs it in their own CI
(hotcrm's `verify = validate && typecheck && build && test`). The factory moves
the same check earlier and into the editor; it does not replace it.

### 3. The framework proves backward compatibility with two frozen in-repo gates + one live pre-publish gate

- **Depth — `@objectstack/downstream-contract`** ([#2089](https://github.com/objectstack-ai/objectstack/pull/2089),
  [#2095](https://github.com/objectstack-ai/objectstack/pull/2095)). A fixture
  authored the way an external consumer does — builder + factories + **bare
  literals** — across all 16 writable domains, typed with the spec's own input
  aliases and run through each schema's `.parse()` plus a `defineStack`
  assembly. Catches a narrowed/removed schema property on any domain.
- **Breadth — the API-surface snapshot** ([#2092](https://github.com/objectstack-ai/objectstack/pull/2092)).
  `packages/spec/api-surface.json` records every exported `name (kind)` of all 16
  public entry points. `check:api-surface` fails on any drift; a removal is
  breaking, an addition still requires regenerating the snapshot, so no change to
  the public surface is silent.
- **Live — the pre-publish hotcrm smoke** ([#2093](https://github.com/objectstack-ai/objectstack/pull/2093)).
  The Release workflow clones `objectstack-ai/hotcrm` at a pinned tag, installs
  it against the **published** packages, overlays the about-to-publish spec, and
  runs hotcrm's own `typecheck` + `validate`. A red blocks the publish.

### 4. The freeze contract

The downstream-contract fixtures and the api-surface snapshot are **frozen**:

> A spec change that requires editing the fixtures, or that removes an entry from
> the snapshot, is **by definition a breaking change** for third parties.

When a gate turns red, the change is a deliberate fork in the road, never a
mechanical "update the test":

- **Removed / renamed / narrowed** → restore it, or bump `@objectstack/spec` to a
  new **major** and document the migration. Only then regenerate the snapshot /
  update the fixture, in the same PR.
- **Added** (safe) → regenerate the snapshot so the addition is acknowledged.

This is what makes the witnesses real: they do not co-evolve silently.

### 5. Boundaries

- The in-repo consumers (examples, `@objectstack/dogfood`, the platform apps)
  keep their existing roles — reference corpus and prove-it-runs (ADR-0054).
  They are **not** backward-compat witnesses, precisely because they are fixed in
  lockstep.
- The snapshot is name+kind, not full signatures: it catches add/remove/rename
  but not every narrowing. Narrowing of *exercised* exports is caught by the
  downstream-contract typecheck. A signature-level snapshot is deferred until a
  narrowing actually slips both (evidence-gated, like ADR-0054's Phase 3).

## Consequences

**Positive.**

- A backward-compat break for a lagging third party is caught at PR time (depth +
  breadth) or pre-publish (live), not after release.
- The public surface of `@objectstack/spec` cannot change silently — every
  add/remove is recorded and reviewed.
- One canonical authoring form, which is also the form the AI corpus teaches.

**Costs / trade-offs.**

- The fixtures and the snapshot must be maintained; the freeze discipline (don't
  edit-to-pass) is a review-culture requirement, not just a CI check.
- The api-surface snapshot is large (~4 000 exports) and regenerates on any
  export change — intentional churn that forces acknowledgement.
- The live hotcrm gate couples the Release workflow to one external repo; it is
  release-only and pinned to a tag (`HOTCRM_REF`) to bound that coupling, and a
  hotcrm-side break can be worked around by re-pinning.
