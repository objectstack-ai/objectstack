# ADR-0087: Metadata protocol upgrades for AI consumers — conversion over notification, executable migrations, machine-verifiable upgrades

**Status**: Proposed (2026-07-04)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0059](./0059-third-party-backward-compatibility-gates.md) (layered backward-compat gates — this ADR is its consumer-facing sequel), [ADR-0078](./0078-no-silently-inert-metadata.md) (no declarable-but-unenforced metadata — the un-checked `engines.protocol` is exactly this class), [ADR-0025](./0025-plugin-package-distribution.md) (§3.2 `engines.protocol` / `engines.platform` compatibility ranges, §3.10 #3 protocol-first check order), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (the authoring population this ADR designs for), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove), [ADR-0054](./0054-runtime-proof-for-authorable-surface.md) (prove-it-runs), AGENTS.md Prime Directive #12 (contract-first, no consumer-side dialect fallbacks — §"Why the conversion layer does not violate PD #12" draws the line)
**Consumers**: `@objectstack/spec` (protocol version constant, conversion layer, deprecation/change registries), `@objectstack/cli` (`validate`, `doctor`, `migrate meta`), the runtime metadata loader (handshake + conversion), `@objectstack/mcp` (the AI-native change/migration surface), `@objectstack/create-objectstack`, the Release workflow, and every third-party consumer — whose maintainer is assumed to be an **AI agent**
**Surfaced by**: recurring third-party breakage on protocol upgrades — the [#2035](https://github.com/objectstack-ai/framework/issues/2035) / [#2023](https://github.com/objectstack-ai/framework/issues/2023) class that motivated ADR-0059 — plus two observations: `PluginEnginesSchema.protocol` (`packages/spec/src/kernel/manifest.zod.ts`) is declared, documented, and **checked nowhere**, so a version mismatch surfaces as an arbitrary downstream crash; and the consumer population has shifted — this platform's metadata is AI-authored by design (ADR-0033, ADR-0059 context), so an upgrade paradigm optimized for *human attention* (warnings, changelogs, prose guides) optimizes the wrong scarce resource

---

## TL;DR

ADR-0059 fixed the **producer** side of protocol evolution: a breaking change cannot
leave this repo silently. This ADR fixes the **consumer** side — and it starts from a
deliberate design assumption:

> **The consumer's maintainer is an AI agent.** Human attention is no longer the
> scarce resource; *machine executability and machine verifiability* are.

For a human maintainer the classic paradigm is "notify early, document well" — humans
don't read changelogs, so you route warnings into their CI and hope they act in time.
For an AI maintainer that whole frame is wrong: an agent reads every release artifact
instantly and applies a mechanical rename in seconds. What an agent *cannot* do is act
on information that exists only as prose, recover from an unstructured crash, or prove
an upgrade correct without an executable acceptance test. So the design inverts, into
a preference ladder:

| Rank | Principle | Mechanism |
|---|---|---|
| L0 | **Don't break** | ADR-0059's frozen gates (unchanged) |
| L1 | **Break invisibly** — no consumer action at all | a versioned **conversion layer** in the spec: old shapes accepted and centrally converted at load (D2) |
| L2 | **Break executably** — action is a machine-runnable artifact | a **replayable migration chain** shipped with the spec: per-major declarative steps composed by `objectstack migrate meta --from N` across **any number of majors**; the agent reviews the diff (D3) |
| L3 | **Break loudly and structurally** — refusal is machine-readable | the enforced `engines.protocol` handshake emitting a structured diagnostic, never a crash (D1) |
| — | **Verify autonomously** | the consumer's own `validate && typecheck && test` loop is the acceptance test an agent runs (D5) |

Every release artifact is **machine-readable first** (`spec-changes.json`, the
deprecation registry, MCP tools — D4); prose exists only for the residual "why".
Two governing insights: **the best notification is one that requires no action; the
second best is an executable action; prose is the fallback of last resort** — and
**timeliness is never load-bearing**: a consumer arriving three majors late replays
the preserved transform chain on arrival, so nothing depends on it having been
present, warned, or reading anything while those majors shipped.

## Context

A metadata-driven platform makes two promises to third parties (ADR-0059): *what you
author the way the templates show works*, and *what worked on version N keeps working
on N+1*. ADR-0059's gates guarantee that when the second promise must be broken, the
break is deliberate, carries a major version, and is documented. What they do **not**
provide is any mechanism on the consumer side: today a consumer app built against
protocol 10 loaded by a protocol 12 runtime is not told "incompatible — here is the
migration"; it runs until some schema `.parse()` or renderer contract fails. Four
concrete gaps, then the assumption that reshapes the solution:

1. **The handshake exists on paper only.** `PluginEnginesSchema` gives every package
   manifest an `engines.protocol` range, protocol-first per ADR-0025 §3.10 #3 — and no
   loader, installer, or CLI command reads it. Under ADR-0078, an authorable field the
   runtime ignores is a bug class of its own: enforce it or remove it.

2. **Change information is human-readable only.** `packages/spec/api-surface.json`
   records the full export surface and its diff gates every PR — then the diff is
   thrown away. Releases ship a prose CHANGELOG and (for 11) a hand-written upgrade
   guide. Nothing machine-consumable maps version N → N+1.

3. **Upgrading is entirely manual.** `docs/upgrading-to-11.md` is a good artifact, but
   its purely mechanical entries (the `http_request` → `http` node rename, the
   client-react alias removals) are exactly the transforms a machine applies without
   error — yet they were delivered as prose for a human to re-type.

4. **Removal arrives without a compatibility window.** The 11.0 removals were correct
   per ADR-0059's freeze contract, but on upgrade day both old and new shapes were
   never simultaneously loadable, so a consumer fleet could not upgrade incrementally
   or roll back safely.

**The assumption shift.** The first draft of this ADR answered these gaps with a
human-communication paradigm: deprecation warnings in the consumer's CI, a guaranteed
warning *time* window, prose guides as a release gate. Review surfaced the flaw: this
platform's authoring population is AI agents (ADR-0033; ADR-0059 notes the spec itself
is "almost entirely AI-authored, by design"), and external metadata apps follow the
same trajectory. For an AI consumer:

- **Reading cost ≈ 0.** An agent parses every release artifact; "developers don't read
  changelogs" no longer motivates the design. What matters is that artifacts are
  *structured* — prose is where agents err (misreading intent, hallucinating steps).
- **Mechanical-execution cost ≈ 0.** The agent doesn't need a warning period to *find
  time* for a rename; it needs the rename expressed as data it can apply and check.
- **The bottlenecks are structure and verifiability.** An unstructured crash is the
  worst input an agent can receive; a structured refusal with an error code, the
  version pair, and a migration id is directly actionable. And an applied migration is
  only trustworthy if an executable acceptance test proves it.
- **Consumers arrive whenever.** A real consumer is not marching one major at a time
  in step with releases — it may wake up three majors late (10 → 14). Any design whose
  value depends on the consumer *being present during* a warning window (the classic
  "deprecate in N, warn through N, remove in N+1" paradigm) is worthless to exactly
  the lagging consumer it exists for. **Timeliness must not be load-bearing.** What a
  late arrival needs is not to have been warned — it is a **preserved, composable
  transform history** it can replay on arrival, like a database migration chain: you
  don't need to have watched every schema change land to run `migrate` years later.

So the paradigm is not "communicate changes to consumers in time" but **"make
upgrades machine-executable and machine-verifiable — from any starting version — and
make most of them unnecessary."**

## Decision

### D1 — Enforce the protocol handshake, with machine-readable refusal

- `@objectstack/spec` exports a **`PROTOCOL_VERSION`** constant (SemVer, bumped by the
  same release discipline ADR-0059 defines: majors only via the freeze-contract fork).
- The metadata loader and the package installer **check `engines.protocol`** (falling
  back to `engines.platform`, then the legacy `engine.objectstack`) against the running
  `PROTOCOL_VERSION` **before** loading a package's metadata:
  - in range → load (through the D2 conversion layer where applicable);
  - major-incompatible **and not convertible** → **fail fast** with a **structured
    diagnostic** — a stable error code, the two versions, the blocking surfaces, and
    the exact replay command (`objectstack migrate meta --from <N>`, D3) — as JSON on
    `--json` and via MCP (D4), because the consumer that must act on this refusal is
    an agent, and the quality of its fix is bounded by the structure of the error. The
    diagnostic is equally actionable one major behind or five: it names the chain, not
    a guide the consumer was supposed to have read at the time;
  - range absent → load with a warning (grandfathering); `objectstack lint` flags the
    missing range; `create-objectstack` and the `defineStack` templates stamp
    `engines: { protocol: '^<current major>' }` so the field is populated by default.

This kills the reported symptom — *crash* — even when everything else in this ADR
fails: the floor is a diagnosable, machine-actionable refusal at the boundary
(ADR-0078: the field is now enforced, not inert).

### D2 — The conversion layer: most breaks require zero consumer action

The single highest-leverage decision. For every protocol major N, the spec ships a
**versioned, declarative conversion table** `conversions/N.ts`: for each renamed,
moved, or re-shaped surface, a transform from the N−1 shape to the N shape, applied
**centrally at load time** (the same seam `objectstack validate` uses), emitting a
structured deprecation notice per applied conversion. The Kubernetes storage-version /
conversion model: consumers on the old shape keep loading, the runtime sees only the
new shape, and the *fleet* upgrades incrementally.

- **Scope:** losslessly mappable changes only — renames, alias removals, field moves,
  enum re-spellings. The 11.0 line is the calibration: `http_request` → `http` and the
  client-react alias table were 100% convertible; had D2 existed, protocol 11 would
  have required **no action** from most consumers.
- **Window:** each conversion is applied by the **loader** for **one major** (N
  accepts N−1 shapes at load), then retired from the load path in N+1 — but it is
  **never deleted**: a retired conversion graduates into the D3 migration chain as
  that major's mechanical step, so the transform history is permanent even though the
  runtime only ever carries one major of it. The window is deliberately **not** a
  notification device — a warning window is worthless to a consumer that arrives
  three majors later. It is a **fleet-compatibility window**: the period both shapes
  are loadable, which is what lets a multi-app fleet upgrade incrementally and roll
  back safely. Cross-major consumers are served by the chain (D3), not the window.
- **Semantic changes are excluded.** A change whose old shape has no lossless mapping
  cannot be converted; it goes to D3.

#### Why the conversion layer does not violate Prime Directive #12

PD #12 bans *consumer-side dialect fallbacks* — the scattered
`cfg.filter ?? cfg.filters` pattern where each executor quietly tolerates off-spec
input, fossilizing N de-facto contracts. The conversion layer is the opposite
construction on every axis that rule cares about: it is **one** central table (not N
scattered `??`s), **versioned and declared** in the spec itself (the contract *owns*
its history; a fallback denies history exists), **loud** (every application emits a
deprecation notice naming the conversion and its removal version — never silent
tolerance), **tested** (each entry carries an old-shape → new-shape fixture pair), and
**expiring** (dropped on schedule, where a fallback lives forever). PD #12's target is
unowned dialects; D2 is the owned, explicit version history of a single dialect. The
existing executor fallbacks remain debt to pay down — indeed D2 gives them a
retirement path: promote each into a declared, expiring conversion entry, then delete.

### D3 — A replayable migration chain: any past major → current, one command

The spec ships **declarative migration artifacts per major** — `migrations/N.json`:
per-surface transforms with machine-readable pre/post conditions plus a prose
`rationale` (the one place prose is load-bearing, and it is one field, not a
document). Two sources feed each major's step: **semantic changes** authored for that
major (the residue D2 cannot express losslessly), and **graduated conversions** (D2
entries retired from the load path). Together the steps form a **permanent, ordered
chain** — the database-migration model applied to metadata source files.

- **Cross-major is the designed-for case, not an unsupported edge.**
  `objectstack migrate meta --from 10` composes the steps 10→11→…→current and applies
  them to the consumer's metadata sources in one run. A consumer that slept through
  four majors replays four steps; it never needed to be present, warned, or reading
  anything while those majors shipped. The chain is why timeliness is not load-bearing
  anywhere in this design.
- **The chain is tested as a chain.** Each step keeps its old-shape → new-shape
  fixture pairs, and CI replays the *full* chain from the oldest supported major's
  fixtures to current on every release — a break in composability is a release
  blocker, not a consumer discovery. The support floor (how far back the chain
  reaches) is an explicit, documented release-policy knob, never an accident of
  deletion.
- **Per-hop verifiability.** On request (`--step`), the CLI checkpoints after each
  major so the agent can run its verify loop (D5) per hop and bisect a failure to the
  exact major that caused it — the agent's equivalent of `git bisect` for an upgrade.
- The consumer-side agent's loop is: run the chain → review the diff → run its own
  verify (D5). The agent reviews a *generated, provably schema-valid* diff instead of
  hand-authoring edits from prose — eliminating the transcription-error class
  entirely. A migration that cannot be expressed declaratively gets a structured TODO
  entry (surface, reason, acceptance criteria) rather than silence, so the agent knows
  exactly what judgment is being delegated to it.

### D4 — Machine-readable-first release artifacts, and an MCP surface

- The Release workflow diffs the current `api-surface.json` against the previously
  published one (reusing the ADR-0059 §3 gate artifact instead of discarding it),
  joins the conversion table and migration set, and emits **`spec-changes.json`**:
  `{ from, to, added[], converted[], migrated[], removed[] }`, each entry carrying the
  replacement, the conversion/migration id, and a rationale anchor. Published inside
  `@objectstack/spec` and attached to the GitHub Release. Per-major manifests
  **compose**: the manifests are pure data, so any tool (and the MCP surface below)
  can fold them into a single 10→14 view — cross-major consumers get one aggregate
  answer, not four documents to reconcile.
- **`@objectstack/mcp` exposes the upgrade surface as tools** — the AI-native channel
  this platform already ships (ADR-0025/ADR-0033 direction): `spec_changes(from, to)`
  (any version pair, folded across majors), `spec_deprecations(stackPath)` (which
  conversions *my* metadata currently triggers), `spec_migrate(dryRun)`. A
  consumer-side agent queries "what breaks me between 10 and 14?" and gets data, not
  documentation.
- Prose inverts from primary to derived: the upgrade guide for major N is **generated**
  from `spec-changes.json` rationales, with hand-written narrative only for
  architectural context. The generated guide can never drift from the registry because
  it is a projection of it.

### D5 — The consumer's verify loop is the acceptance test

ADR-0059 §2 already made `objectstack validate` the third party's authoritative
self-gate. For an AI consumer this is promoted from self-check to **the acceptance
test of an autonomous upgrade**: the supported loop is *handshake-check → convert /
migrate → verify (validate && typecheck && test) → commit or roll back*, every step
machine-runnable. Consumer obligations, stated in the public docs as the other half of
the contract (all previously established by ADR-0059): author through `defineX`
factories, pin `^N`, run `objectstack validate` in CI, and **upgrade through the
chain** — `migrate meta --from N` for any N at or above the support floor, however
many majors that spans. The tooling walks the majors internally; what is unsupported
is hand-porting *around* the chain, not arriving late.

### D6 — Rehearsal inverts: consumer agents pull, the framework publishes

Every major is published to the **`next` dist-tag at least one RC cycle** before
`latest`. The first draft proposed a framework-side "community smoke ring" (registered
external repos smoked in our Release workflow — the crater model). With AI-maintained
consumers the topology inverts and improves: a consumer-side agent **subscribes to the
RC**, runs the D5 loop against its own app in a branch, and opens its own migration PR
— its human reviews a verified diff. The framework's obligations shrink to publishing
the RC and the D4 artifacts; it never needs to execute other people's CI. The
pre-publish **hotcrm smoke stays** (release-blocking, unchanged) as the
framework-side floor; a broader blocking ring is dropped as the wrong direction —
scaling framework-side execution when the consumers can execute themselves.

## Boundaries

- **Nothing in ADR-0059 changes.** The freeze contract, the frozen witnesses, SemVer
  discipline, and the hotcrm gate stay exactly as decided; this ADR adds the
  consumer-side machinery on top.
- The conversion layer converts **at load**; it never rewrites the consumer's source
  files silently — source rewriting only happens via D3's explicit `migrate meta`.
- Phases, independently shippable and evidence-gated:
  - **P0 — the handshake (D1).** Smallest change, kills the crash symptom directly,
    pays down a standing ADR-0078 violation.
  - **P1 — the conversion layer (D2)**, seeded with the already-shipped 11.0 renames
    as the first (retroactive) table, plus retiring one existing executor fallback
    through it to prove the PD #12 retirement path.
  - **P2 — change manifest + migrations + generated guide (D3, D4 artifacts).**
  - **P3 — the MCP surface (D4 tools) + RC discipline (D6).** The consumer-side
    autonomous-upgrade agent itself is out of scope here — it belongs to consumers /
    ADR-0033's toolchain; this ADR's job is to make it *possible*.

## Consequences

**Positive.**

- The dominant class of historical breaks (mechanical renames/moves — all of 11.0's
  metadata-facing removals) stops requiring **any** consumer action for one full
  major: the strongest possible form of "timely awareness" is not needing to act.
- When action is required it is a machine-runnable artifact with an executable
  acceptance test, not prose — eliminating transcription errors and making fully
  autonomous consumer upgrades possible.
- **A consumer arriving from any past major has a tested, one-command path to
  current.** Notification timeliness is no longer load-bearing anywhere in the
  design: nothing a consumer needed to see, read, or react to during the majors it
  slept through affects its ability to upgrade correctly on arrival.
- Version mismatch becomes a structured load-time refusal designed to be consumed by
  an agent — the reported failure mode ("upgrades crash metadata apps") is eliminated
  as a symptom even when everything upstream fails.
- One registry feeds the loader, the CLI, the MCP tools, and the generated guide — no
  drift between what the code does and what the docs say (the ADR-0078 discipline
  applied to release communication).
- The framework's operational surface *shrinks* relative to the smoke-ring
  alternative: publish artifacts, let agents pull.

**Costs / trade-offs.**

- The conversion layer is real, permanent machinery: every lossless break now costs a
  conversion entry + fixture pair, and the loader carries a conversion pass.
  Mitigations: scope is strictly lossless mappings; entries expire after one major;
  the 11.0 retroactive table bounds the initial size. This cost is the point — it
  makes the *producer* pay for a break instead of every consumer.
- Declarative migrations (D3) can express less than arbitrary code; the structured-TODO
  escape hatch keeps honesty but delegates judgment back to the consumer agent.
- The chain is a **forever artifact**: every step back to the support floor must stay
  replayable, and full-chain CI replay grows linearly with history. Bounded by the
  explicit support floor (a release-policy decision, revisitable per major) and by
  steps being declarative data + fixtures, not code that rots.
- Machine-first artifacts raise the release-engineering bar: `spec-changes.json`,
  conversion fixtures, and the generated guide are new build products that can
  themselves regress — they get their own CI checks (schema-validated, fixtures
  executed) per ADR-0049's enforce-or-remove.
- Grandfathering packages without `engines.protocol` keeps the handshake soft for one
  transition period; the lint nudge plus scaffold stamping is the ratchet that closes
  it.
- The paradigm bets on consumers being agent-maintained. A purely human-maintained
  consumer still gets strictly more than the pre-ADR world (fail-fast, a generated
  guide, runnable migrations) — the bet has no downside for them, only a smaller
  upside.
