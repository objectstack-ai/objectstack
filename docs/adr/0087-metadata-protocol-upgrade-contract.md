# ADR-0087: Metadata protocol upgrades for AI consumers — conversion over notification, executable migrations, machine-verifiable upgrades

**Status**: Accepted (2026-07-04, #2582) · trued up to as-built 2026-07-15 (see Addendum)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0059](./0059-third-party-backward-compatibility-gates.md) (layered backward-compat gates — this ADR is its consumer-facing sequel), [ADR-0078](./0078-no-silently-inert-metadata.md) (no declarable-but-unenforced metadata — the un-checked `engines.protocol` is exactly this class), [ADR-0025](./0025-plugin-package-distribution.md) (§3.2 `engines.protocol` / `engines.platform` compatibility ranges, §3.10 #3 protocol-first check order), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (the authoring population this ADR designs for), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove), [ADR-0054](./0054-runtime-proof-for-authorable-surface.md) (prove-it-runs), AGENTS.md Prime Directive #12 (contract-first, no consumer-side dialect fallbacks — §"Why the conversion layer does not violate PD #12" draws the line)
**Consumers**: `@objectstack/spec` (protocol version constant, conversion layer, deprecation/change registries), `@objectstack/cli` (`validate`, `doctor`, `migrate meta`), the runtime metadata loader (handshake + conversion), `@objectstack/mcp` (the AI-native change/migration surface), `@objectstack/create-objectstack`, the Release workflow, and every third-party consumer — whose maintainer is assumed to be an **AI agent**
**Surfaced by**: recurring third-party breakage on protocol upgrades — the [#2035](https://github.com/objectstack-ai/objectstack/issues/2035) / [#2023](https://github.com/objectstack-ai/objectstack/issues/2023) class that motivated ADR-0059 — plus two observations: `PluginEnginesSchema.protocol` (`packages/spec/src/kernel/manifest.zod.ts`) is declared, documented, and **checked nowhere**, so a version mismatch surfaces as an arbitrary downstream crash; and the consumer population has shifted — this platform's metadata is AI-authored by design (ADR-0033, ADR-0059 context), so an upgrade paradigm optimized for *human attention* (warnings, changelogs, prose guides) optimizes the wrong scarce resource

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

> **Amended 2026-08-06 (#5837), paths only.** `api-surface.json` became the directory
> `api-surface/` (one shard per entry point) and ships in the npm artifact as such; the
> release diff reads whichever layout the previously published tarball carried. `spec-changes.json`
> is deliberately unsharded — it is keyed by version, which has never been a conflict surface.

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

---

## Addendum (2026-07-15) — as-built true-up

### Phase status

- **P0 — handshake (D1): shipped.** `PROTOCOL_VERSION` + the pure handshake core
  landed in #2650 (install seam). The **load seams** followed: the boot-time
  durable-package rehydration path (`@objectstack/service-package`) refuses an
  incompatible `sys_packages` row with the structured diagnostic and continues
  booting; `AppPlugin` (code-defined stacks) fails fast before the manifest is
  decomposed. The grandfathering ratchet is closed from both ends:
  `objectstack lint` warns on a manifest with no range
  (`protocol/missing-engines-range`), and the `create-objectstack` template
  stamps `engines: { protocol: '^<major>' }` (re-stamped at version time by
  `scripts/sync-template-versions.mjs`).
- **P1 — conversion layer (D2): shipped** in #2897, seeded with the retroactive
  protocol-11 table; the PD #12 retirement path was proven on the CRUD
  `filters` fallback.
- **P2 — chain + manifest + guide (D3/D4): shipped.** #2897 landed the chain and
  `composeSpecChanges`; this true-up adds the release side: `spec-changes.json`
  is generated from the registries (`gen:spec-changes`, drift-checked in CI),
  ships inside the npm artifact together with `api-surface.json`, and is
  attached to each `@objectstack/spec` GitHub Release with the `added[]`/
  `removed[]` arrays filled from the api-surface diff against the previously
  *published* release (`scripts/release-spec-changes.sh`). The upgrade guide is
  now literally a projection: `docs/protocol-upgrade-guide.md` is generated
  from the registries (`gen:upgrade-guide`) and drift-checked in CI.
- **P3 — MCP tools + RC discipline (D6): deferred, evidence-gated** (as the ADR
  Boundaries intended): built when external-consumer demand justifies the
  operational surface. Nothing else in this ADR depends on it.

### The load-window's second half is now mechanical

`MetadataConversion.retiredFromLoadPath` implements "retired from the load path
in N+1 — but never deleted": a retired entry is skipped by the loader
(`applyConversions`) and replayed only by the chain (`migrate meta`) and the
fixture CI. Live-window entries (currently the protocol-15 ADR-0089 visibility
aliases) stay load-active until they graduate.

### Ratified: the pre-launch launch-window exemption (majors 12–15)

Majors 12–14 shipped breaks as **pre-launch one-step changes with no alias
window** (ADR-0090 D3/D4 explicitly superseded the alias discipline;
`BookAudience` in 14.0.0 states "launch-window discipline"). That was a
deliberate policy while the platform had no external consumers — but it was
never written down, and it left the chain empty above step 11. This true-up
does both halves:

- **The policy, stated:** until GA, a metadata-facing break MAY ship one-step
  without a load window. The exemption covers the *window* only — never the
  *chain*: every such break must land as a chain step (a `retiredFromLoadPath`
  conversion when lossless, a semantic TODO when not) in the same release.
  After GA the full D2 ladder applies: lossless breaks ship a live conversion
  entry or they do not ship.
- **The chain, backfilled:** steps 12–15 now exist. 12: the `api.requireAuth`
  default flip (semantic). 13: the ADR-0090 wave — `roles:`→`positions:`, the
  two unambiguous OWD aliases, and recipient `role`→`position` as retired
  conversions; profiles, hierarchy re-homing, `current_user.roles` CEL
  rewrites, the `'full'` alias, and the sharing-model secure default as
  semantic TODOs. 14: the `BookAudience` rename (retired conversion). 15: the
  ADR-0089 visibility aliases (live conversions) plus the `.strict()` flip
  (semantic). `migrate meta --from 10` therefore reaches protocol 15 with
  every mechanical rewrite applied and every judgment surfaced — the "arrive
  whenever" promise holds across the pre-launch era too.
- **Backfilled history joins the registry, not the loader:** the protocol-11
  `compactLayout`→`highlightFields` rename (retired at authoring in 11.9.1,
  pre-dating this ADR) is also preserved as a retired step-11 conversion.

## Addendum (2026-07-31) — stored metadata replays the chain (#3903)

Everything above serves **authored source**: `normalizeStackInput` converts at
`defineStack`/`validate`/`lint`, tombstones teach the author, `migrate meta`
rewrites files. Metadata **at rest** — `sys_metadata` rows written by Studio or
the runtime authoring APIs — was reached by none of it: rows were rehydrated
unparsed and unconverted, so the authored and stored contracts silently
diverged (#3903). This addendum extends the contract to data at rest:

- **Every stored-row rehydration seam replays the FULL chain, retired entries
  included** — `applyConversionsToStoredItem` in `spec/conversions/stored.ts`
  is the one primitive, called by `loadMetaFromDb`, `getMetaItems` (active and
  draft), `getMetaItem`, `getMetaItemLayered`, `duplicatePackage`, the
  DatabaseLoader's live-row reads, and objectql's authored-action/-hook table
  reads. Rationale: **retirement is an authoring-surface event.** The window
  exists so a live author is taught the canonical spelling; a row at rest has
  no author to teach, and refusing its historical shape would only break data
  that once worked. D3 keeps every conversion forever precisely so any past
  major replays forward — a stored row is the perpetual "consumer arriving
  late", and the read path is its chain.
- **Flows canonicalize at their own seam.** `AutomationEngine.registerFlow`
  (the rehydration seam PD #12 names) now also replays retired entries; the
  generic metadata seams deliberately skip `type: 'flow'` because flow-node
  conversions carry the ADR-0078 open-namespace conflict guard, which needs
  the engine's live executor registry (`reservedNodeTypes`).
- **The version layer stays verbatim.** `sys_metadata_history` reads and
  `SysMetadataRepository` bodies are NOT converted — history is a record of
  what was written, and converting would break the checksum↔body pairing.
  Conversion happens where rows become *served metadata*, not where versions
  are stored.
- **Writes stay gated; reads diagnose, never drop.** `saveMetaItem` keeps
  rejecting off-spec bodies (422, tombstones included) — new rows are always
  canonical, so the stored pass is a strictly shrinking concern. On the read
  side, what still fails the current schema *after* conversion is a genuine
  contract violation: `loadMetaFromDb` counts it (`invalid`), warns with a
  stable `[metadata_spec_invalid]` marker, and registers it anyway — refusal
  at boot would unhook live tables and make the row unfixable in Studio
  (availability over purity for data at rest; the same verdict reaches Studio
  as `_diagnostics` on every read).

## Addendum (2026-08-01) — the stored chain gets a finish line (#4327)

The addendum above makes a legacy row read canonical *forever*, which is the
correctness guarantee — and, read literally, also a promise that the chain runs
on that row forever. `os migrate meta --stored`
(`ObjectStackProtocolImplementation.migrateStoredMetadata`) lets a deployment
end that for itself: it walks `sys_metadata` (active + draft, all orgs), replays
the same `applyConversionsToStoredItem` pass, and re-saves each changed body
through `saveMetaItem` with `source: 'migrate-stored'` — history row, checksum,
mutation projectors and all. Preview is the default; `--apply` is the only
writing mode.

- **Not load-bearing, and no flag.** #3855's conclusion stands: an operator-run
  migration cannot be relied on, so the read path — not this — remains the
  guarantee, and nothing gates on it having run. Deliberately no `sys_migration`
  row either: unlike ADR-0104's two gates, a flag here would advertise
  enforcement that does not exist. The verifiable statement operators wanted is
  the **re-run** — a second pass reporting every row canonical exits 0, so "my
  metadata is on protocol N" is a check rather than a belief.
- **The write path's gate is not bypassed.** A body that still fails the current
  schema after conversion is refused (422) and reported, exactly as the bullet
  above describes for reads: it is a genuine contract violation, and the pass
  has no more standing to persist it than an author does. It keeps reading
  through the chain and stays fixable in Studio.
- **The version layer stays verbatim.** `sys_metadata_history` is appended to,
  never rewritten. Canonicalizing a past version's body would break the
  checksum↔body pairing this contract depends on — the migration is a new
  commit, not a rewrite of history.
- **What the pass does not cover, it names.** Types with no repository write
  path are reported as `skipped` with the reason, never counted as done.

## Addendum (2026-08-01b) — flows reach the finish line too (#4454)

The pass above initially skipped `flow` rows, which was the largest hole in it:
the graduated flow-node conversions are where the most stored dialect lives.
Closing it needed three decisions.

- **One canonicalization policy, two shapes.**
  `AutomationEngine.canonicalizeStoredFlow` is now the single implementation and
  `registerFlow` calls it, so the load seam and the migration cannot disagree
  about what canonical means. It returns `parsed` (for execution — schema
  defaults materialized) and `storable` (for persistence).
- **`storable` excludes schema defaults, and this is load-bearing.** Measured,
  not assumed: driving a pre-17 flow through parse + the region pass *removes*
  nothing (`FlowSchema` is strict since #4001 — an unknown key throws rather
  than being dropped, so the `graftNormalizedOperators` precedent does not
  transfer) and *adds* only defaults: `version`, `runAs`, per-edge `type` /
  `isDefault`. Persisting a default the author never wrote would pin every
  migrated row to today's value while untouched rows follow tomorrow's — two
  populations with different behaviour, which is the drift this pass exists to
  remove. So the write-back is conversions plus the schema's `condition`
  envelopes, and nothing else.
- **The engine is borrowed, not started.** `AutomationServicePlugin` gains
  `armRuntime: false`: built-in nodes installed and `automation:ready` fired
  (the registry must be COMPLETE, or the conflict guard reads a live custom node
  type as unowned and rewrites over it), then a hard stop before anything is
  armed — no flow registered, no trigger or schedule bound, no connector
  materialized, no suspended run resumed. `registerFlow` arms triggers as a side
  effect, so skipping only the boot pull would not have been enough; the
  `kernel:ready` and `metadata:reloaded` re-syncs are skipped for the same
  reason. A migration process must not become a second server.

A refused rename — the guard firing because the old token is a live name owned
by something else — fails that row loudly with the token and its owner. Never a
silent skip, never a clobber; that is the whole reason the guard exists.

## Addendum (2026-08-01c) — "strictly shrinking" was false for flows (#4498)

The bullet above claims new rows are always canonical, *therefore* the stored
pass is a strictly shrinking concern. `duplicatePackage` was a live producer
contradicting it: it canonicalizes each source row before re-saving, but through
`convertStoredItem`, which returns `flow` bodies untouched. `FlowNodeSchema.config`
is an open `z.record`, so a pre-17 body sailed through `saveMetaItem`'s gate and
landed verbatim in a brand-new row. An operator could run the migration, get a
clean report, duplicate a package, and be back to pre-protocol rows — with the
report still saying protocol N until the next run.

- **The capability was already reachable; only the wiring was missing.** The
  protocol is constructed with an accessor for the kernel's service table (the
  same one `analytics` and `package` are read from), and the automation service
  registers under `automation`. `resolveFlowCanonicalizer` reads
  `canonicalizeStoredFlow` off it. So the fix is not new plumbing per call site
  — it is one private resolver that every caller running next to a live engine
  shares.
- **The explicit hook becomes an override, not a requirement.**
  `migrateStoredMetadata`'s `canonicalizeFlow` defaults to the resolver, so the
  CLI stopped passing one (it boots the inert engine into the same kernel, so
  both routes reached the same instance — two routes to one capability is how
  they drift). The parameter stays for callers with no registry and for testing
  the flow branch without an engine.
- **Resolution is lazy, per call.** Plugin init order does not guarantee
  `automation` is in the table when the protocol is assembled — the CLI adds it
  after ObjectQL by design — so caching `undefined` from a too-early read would
  disable flow canonicalization for the life of the process.
- **The failure posture matches #4454's.** A refused rename fails that item into
  `duplicatePackage`'s existing `failed[]` naming the token, rather than copying
  the un-renamed body: producing exactly the row this fix exists to prevent is
  the one outcome worse than failing the copy. A flow that cannot canonicalize
  at all fails the same way. With **no** engine reachable (a control-plane or
  metadata-only host) the source body is copied as-is — no worse than the source
  row already is, and failing an unrelated duplication over it would be its own
  regression.
- **Reads were not changed.** `getMetaItems` / `getMetaItem` /
  `getMetaItemLayered` / `loadMetaFromDb` still skip flows; they are reads,
  covered by `registerFlow` canonicalizing at execution, and are not producing
  bad data. Duplication was the one that *writes*. The resolver is the seam they
  would adopt if that changes.

The premise is restored rather than restated: the stored pass shrinks because
every write path now canonicalizes, not because the sentence says so.

## Addendum (2026-08-02) — the save seam itself (#4542)

"Every write path now canonicalizes" above was still one short. `duplicatePackage`
was the *platform* producer; the ordinary Studio/REST save was a producer by
round-trip: reads serve stored flows verbatim (deliberately — see 2026-07-31),
`FlowNodeSchema.config` is an open `z.record`, so an author served the legacy
dialect who edited a label and saved re-persisted that dialect — and the row
stayed `pending` in the stored report no matter how many times it was edited.
That contradicted the boot warning's own remediation text ("re-save it (Studio
edit → save …) to persist the canonical shape"), which held for every type
except the one it never fires for.

`saveMetaItem` now runs `resolveFlowCanonicalizer` on flow bodies before its
schema gate and persists `storable`, with the same postures as the duplication
seam: a refused rename fails the save loudly (`409 FLOW_CONVERSION_CONFLICT`,
naming the token — the refusal comes from environment state, so it is not a 422
the author can fix by editing the body); a body the stricter canonicalizer
cannot parse (cycles, malformed regions) falls back to the raw save so a
work-in-progress draft stays saveable, in draft and publish mode alike —
`registerFlow` still refuses to arm it; no engine reachable saves as before.
The pass is copy-on-write, so `migrateStoredMetadata` and `duplicatePackage`
re-entering `saveMetaItem` with already-canonical bodies pay nothing.

Reads still skip flows, and now the loop is closed from the other side: a
served legacy body is healed the moment it is saved back.

## Addendum (2026-08-13) — the changeset disposition vocabulary, and its fifth category (#8299)

Everything above is about the ledger itself. This addendum records the **question
asked of every declared-breaking changeset** — *what did you do about the ADR-0087
migration ledger?* — and the closed vocabulary of answers, because until now that
vocabulary lived only in the gate that enforces it, and an author who disagreed with
it had nothing to cite.

The question is answered in the changeset body, in one HTML comment. It is a
comment rather than a visible line because a changeset body is copied verbatim into
`CHANGELOG.md` and shipped to end users; the marker is for this repo's authors and
reviewers, and stays fully visible where they read — the PR diff, `git grep`, the
gate's log and its `--list` output.

```text
<!-- adr-0087: registered <id>[, <id>...] -->
<!-- adr-0087: not-required (unpublished) <why> -->
<!-- adr-0087: not-required (already-registered <id>[, <id>...]) <why> -->
<!-- adr-0087: not-required (no-migration-prescription) <why> -->
<!-- adr-0087: not-required (runtime-interface-only <path>#<Symbol>[, ...]) <why> -->
```

**The vocabulary is closed, and every exemption is re-verified on every run** — an
allow-list nobody re-checks is the failure mode this whole mechanism exists to
avoid. `registered` must name ids that resolve *and* are new in the diff;
`unpublished` requires every bumped package to be `private: true`;
`already-registered` requires the named ids to pre-date the merge base;
`no-migration-prescription` is refused by a body that carries a migration
prescription; and `runtime-interface-only` is the subject of the rest of this
addendum. The checks live in
[`scripts/check-adr-0087-registration.mjs`](../../scripts/check-adr-0087-registration.mjs),
which is also where each one's measured history is written down.

### D7 — a published runtime TS interface with no metadata surface is compiler-carried, and needs no ledger entry

Every other category reasons about **metadata**: a Zod schema, a spec declaration, a
stored row — something `objectstack migrate meta` can reach. A published **runtime
TypeScript interface** with none of those is outside that taxonomy, and it kept
arriving anyway. The worked example is PR #8277, which removed the `error` member of
`PackagePublishResult` in `packages/services/service-package/src/index.ts`. Its
argument, in the changeset's own words: no Zod schema, no `packages/spec`
declaration, no stored representation, so nothing exists for `objectstack migrate
meta` to rewrite — and the channel that actually reaches every affected consumer is
the **compiler** (`error TS2339: Property 'error' does not exist on type
'PackagePublishResult'`), which is strictly more precise than a ledger line.

**That argument is accepted, and it is now a named category.** It was accepted once
before as prose, judged by hand, riding on `no-migration-prescription` — an
exemption whose one mechanical check is that the body carries no prescription.
Measured on #8277's real changeset, the prescription detector returns *nothing*, so
the exemption was held by a detector **miss** rather than by a positive finding.
That is why it was worth naming: the next author either re-derives the paragraph, or
pattern-matches the much looser *"no metadata surface ⇒ no changeset discipline"*,
which is **not** what #8277 argued and is not what this decision ratifies.

An author may claim it when, for each symbol they name, all four hold at HEAD — and
the gate checks all four:

1. **it resolves** — `<path>#<Symbol>` names an exported `interface` / `type` /
   `class` / `enum` that really exists. An unverifiable claim is refused, never
   assumed true.
2. **its declaration site is not a metadata surface** — not a `*.zod.ts`, not a file
   under `packages/spec/src/contracts/`, not an object definition.
3. **its declaration is not a projection of a Zod schema** — `z.input<typeof X>`
   and its family. Under Prime Directive #1 that is the house spelling of *"this
   type IS metadata"*, and it appears in ordinary `.ts` files too.
4. **no metadata surface references it** — steps 2–3 only say where a symbol was
   born; a runtime interface pulled into a schema or an object definition has a
   metadata surface wherever it was declared.

**It also inherits the `no-migration-prescription` refusal.** A body that prescribes
a rewrite cannot claim this category either, so it is a **narrowing** of that
catch-all and never a fifth way around it: nothing refused today becomes claimable
by renaming the category. What the author gains is an exemption that rests on a
positive, re-runnable finding.

#### Why the symbol is path-qualified

The obvious spelling — *"the touched symbol appears in no `*.zod.ts`, no spec
`contracts/**` entry, and no object definition"* — is a bare-name grep, and run
literally it **refuses its own worked example**. `PackagePublishResult` names two
unrelated symbols in this repo: the service interface #8277 changed, and a Zod
projection in `packages/spec/src/system/metadata-persistence.zod.ts` that
`packages/spec/src/contracts/metadata-service.ts` imports. A bare name is not a
symbol identity here, so a claim names `<path>#<Symbol>` — the notation
`packages/spec/export-origins/*.json` already uses — and the reference scan clears a
hit file that either declares the name itself or imports it from somewhere other
than the declaring module. The pair is the gate's own accept/refuse fixture: the
same name under two paths must come out two different ways.

#### What this does not decide

That the author named **every** symbol their PR touched. Like `registered`, the gate
judges the claim that was made, not its completeness — inferring the touched surface
is the cross-package retirement detector the 2026-08-07 ruling deliberately routes
around, and it is no more decidable here. The gain is that the claim is a checkable
sentence a reviewer can re-run, instead of a paragraph they must re-derive.

**The text and the predicate are pinned to each other.** The gate refuses to report
a verdict unless the categories listed above and the categories it accepts are the
same set, checked in both directions. A category added to the gate and described
nowhere is an exemption an author cannot look up; a category described here that the
gate rejects is an exemption nobody can claim. Both are red.
