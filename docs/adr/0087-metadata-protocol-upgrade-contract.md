# ADR-0087: Metadata protocol upgrades for AI consumers — conversion over notification, executable migrations, machine-verifiable upgrades

**Status**: Accepted (2026-07-04, #2582) · trued up to as-built 2026-07-15 (see Addendum) · **Amended** (2026-09-30, #20390 ruling A — the artifact-ingestion window decides per entry by each retired conversion's `retiredAfter`; see the amendment note under the 2026-09-13 addendum's window bullet) · **Amended** (2026-10-09, #22449 ruling B′ — the two D4 projections, the per-major section of `spec-changes.json` and the protocol upgrade guide, are generated at publish rather than committed; see the amendment note under D4, which says what is generated where and where each part landed, and the struck clauses in the P2 phase-status bullet) · **Amended** (2026-10-13, #23038 — the artifact-ingestion window's third disjunct, landed as `58f5c90999`: a floor that is the first release of a major replays that major's conversion step, verdict `'converted-major-step'`; see the 2026-10-13 amendment note under the 2026-09-13 addendum's window bullet) · **Amended** (2026-10-27, #26220, the maintainer's decision A: D8's predicate 4 gains an index-signature limb, and D9's predicate 1 maps a `src/index.tsx` source entry; see the 2026-10-27 amendment notes under D8's predicate 4 and under D9's unmappable-entry paragraph) · **Amended** (2026-10-26, #25767 ruling D2 = A — a retirement kit (tombstone, `RETIRED_KEYS`/`RETIRED_DEFS` rows, semantic entry, conversion) lives one protocol major after the one it retired in and is then removed; a removed key is refused as a strict unknown key whose refusal names the protocol upgrade guide, and the chain's support floor rises to match; see the 2026-10-26 addendum, which also amends the "never deleted" / "permanent" / "forever" wording in D2, D3, the consequences and the 2026-07-31, 2026-08-01 and 2026-09-13 addenda)
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

2. **Change information is human-readable only.** `packages/spec/api-surface/`
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
  runtime only ever carries one major of it. — **amended 2026-10-26 (#25767, D2 = A):**
  "never deleted" held for three majors and is withdrawn. The graduated step is
  carried for **one further major** (the kit retired in N is in the tree through
  N+1 and leaves when N+2 is cut); after that the key is refused as a strict unknown
  key, the refusal names the protocol upgrade guide, and the history lives in the
  guide, the CHANGELOG and git — see the 2026-10-26 addendum. The window is deliberately **not** a
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
major (one entry per retirement family, even when a lossless D2 conversion also exists
for it; D2 carries the mechanical data repair only), and **graduated conversions** (D2
entries retired from the load path). Together the steps form a **permanent, ordered
chain** — the database-migration model applied to metadata source files. (**Amended
2026-10-26**, #25767: "permanent" is bounded by the support floor, which now sits one
major below the current one; a step below the floor is deleted, not kept — see the
2026-10-26 addendum.)

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
> was left deliberately unsharded — it is keyed by version, which was never a conflict surface.
> That call was about merging its committed copy, which #22485 deleted (PR #22638): nothing
> merges it any more.

> **Amended 2026-10-09 (#22449, ruling B′) — where the two projections live.** Ruling
> `6078203801` on #22449, letter B′, which the maintainer answered 「同意」 at
> 2026-10-09T09:27Z, on the maintainer's own re-opening of the ruling of 2026-08-10 on
> #6957. Its operative text, verbatim:
>
> > **B′ — the two projections leave git and are generated at publish, under three
> > conditions.** The per-major section of `spec-changes.json` and the protocol upgrade
> > guide are generated from the registries at publish, verified there, and shipped in
> > the package and on the Release by the lane the `release` section already uses; the
> > committed copies and their two `merge=os-regen` routes are deleted;
> > `check:spec-changes` and `check:upgrade-guide` stop comparing a committed copy. The
> > conditions, each part of the ruling: (1) the pull-request stage still generates both
> > in memory, fails loudly when generation fails, and renders the generated diff on the
> > pull request (a check artifact or a comment), so the review value #6957 named is
> > kept; a B without this check is not taken. (2) `docs/protocol-upgrade-guide.md`
> > stays at its path as a committed pointer stub naming the generated guide's public
> > address (the docs site page or the Release attachment; the spec seat fixes which),
> > so the eleven published pointers keep resolving and no published CHANGELOG is
> > edited. (3) cloud's changed-spec-surface guard moves behind the framework install in
> > the same job and reads a projection generated in the checkout; its exit-2 guard
> > stays. One cloud card carries it. ADR-0087 D4 and its P2 true-up are revised to
> > match (Tier H; the maintainer approves that PR). The #6957 ruling's rejection of
> > option B is superseded by this record on the maintainer's own re-opening; its
> > reason, the review diff, survives as condition (1).
>
> **What is generated where, as built** — #22482, landed as `5b12503c31` (PR #22533):
>
> - **At publish.** `scripts/release-spec-changes.sh` generates both projections from
>   the registries into `packages/spec/` right before the tarball is packed, and
>   `packages/spec/package.json` lists both in `files[]`. `--prepare` (release.yml)
>   writes `spec-changes.json` — its per-major records and aggregate, plus the
>   per-release section — and `protocol-upgrade-guide.md`. `--generate` (cut-rc.yml)
>   writes the two registry projections and no per-release section. `--verify` packs
>   the artifact and refuses it when either projection differs from a fresh generation
>   or, after `--prepare`, when the per-release delta disagrees with the two tarballs.
>   `--attach` uploads the same two files to the GitHub Release without regenerating
>   them, so the Release assets and the tarball carry the same bytes.
> - **At pull request.** `check:spec-changes` and `check:upgrade-guide` run the
>   generators' `--check` mode
>   (`packages/spec/scripts/lib/projection-cli.ts#runProjectionCli`): generate in
>   memory, write nothing, read no committed copy, and exit 1 naming the projection
>   when generation fails. `packages/spec/scripts/render-projection-diff.ts` then
>   generates both sides with the same generators' `--out` mode — this checkout's and
>   the base's own — and renders the diff into the `Type Check · source gates` job
>   summary and a notice annotation; the job uploads it as the `spec-projections-diff`
>   artifact when it is non-empty. That step is red only when a side cannot be
>   generated, never because of the size of a diff.
>
> **The ruled end state, landed** (trued up 2026-10-11). Not landed when this note was
> first written; both remaining cards have landed since, each deleting one committed copy
> and its `merge=os-regen` route in `.gitattributes`:
>
> - condition (2) — #22483, landed as `514bf3c101` (PR #22556). The guide's public
>   address is the docs site, one page per protocol major, generated at docs build into
>   the gitignored `content/docs/protocol-upgrade/`. `docs/protocol-upgrade-guide.md`
>   stays at its path as a hand-written pointer stub naming that address; the guide body
>   it used to hold left git with its route;
> - the committed `packages/spec/spec-changes.json` and its route — #22485, landed last
>   as `46064dfa03` (PR #22638).
>
> No committed copy of either projection remains. `packages/spec/spec-changes.json` and
> `packages/spec/protocol-upgrade-guide.md` are gitignored paths the publish lane writes
> for `files[]` to ship, and the generators' no-flag mode writes only untracked output
> (`gen:spec-changes` that `spec-changes.json`, `gen:upgrade-guide` the docs pages), so a
> registry entry's pull request regenerates neither. Condition (3) is cloud's half and
> lives in that repository (objectstack-ai/cloud#2750); this record governs the
> framework half.
>
> **#6957's reason, kept.** The ruling of 2026-08-10 rejected option B — "Option B
> (uncommitted build-time artifacts) is rejected — the review diff of
> `spec-changes.json` / the upgrade guide is worth the laps it costs", verbatim as
> `scripts/adr-anchors.mjs` quotes it — for the sake of the review diff. B′ supersedes
> the rejection and keeps the reason through condition (1): every pull request still
> shows its reviewer what it does to both projections, generated by the same
> generators the publish lane runs, and the registry entries those projections are
> computed from stay committed, reviewable source. What leaves git is the committed
> aggregate and the re-sync laps it cost. The 2026-08-06 note above ("deliberately
> unsharded") is about that committed copy, which #22485 removed.

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
  steps being declarative data + fixtures, not code that rots. — **Amended
  2026-10-26** (#25767): the floor is no longer "revisitable"; it is **set by rule**
  to one major below the current one and rises at every major cut, so the chain
  carries one step and the replay cost is constant rather than linear.
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
  is generated from the registries (~~`gen:spec-changes`, drift-checked in CI~~ —
  **amended 2026-10-09** — at publish, by `scripts/release-spec-changes.sh`, and
  in memory, with its diff rendered, at pull request),
  ships inside the npm artifact together with `api-surface.json`, and is
  attached to each `@objectstack/spec` GitHub Release with the `added[]`/
  `removed[]` arrays filled from the api-surface diff against the previously
  *published* release (`scripts/release-spec-changes.sh`). The upgrade guide is
  now literally a projection: ~~`docs/protocol-upgrade-guide.md` is generated
  from the registries (`gen:upgrade-guide`) and drift-checked in CI.~~ —
  **amended 2026-10-09** — it is generated from the registries at publish, as
  `protocol-upgrade-guide.md` inside the npm artifact and on the GitHub Release,
  and in memory, with its diff rendered, at pull request;
  `docs/protocol-upgrade-guide.md` became a pointer stub naming the guide's
  public address, the docs site's per-major pages (#22483, PR #22556).

  > **Amended (2026-10-09) — the projections are generated at publish, not
  > committed.** Provenance: ruling `6078203801` on #22449 (letter B′; maintainer
  > 「同意」), which supersedes the 2026-08-10 #6957 ruling's rejection of option B
  > and keeps its reason, the review diff, as its condition (1); the generation
  > half landed as `5b12503c31` (PR #22533, card #22482). The struck clauses
  > describe committed copies drift-checked in CI. Those copies are gone — the
  > guide's at #22483 (PR #22556), `spec-changes.json`'s at #22485 (PR #22638) —
  > and `check:spec-changes` / `check:upgrade-guide` generate in memory and
  > compare nothing. The amendment note under D4 is the full record: what is
  > generated where, and where each part landed.
- **P3 — MCP tools + RC discipline (D6): deferred, evidence-gated** (as the ADR
  Boundaries intended): built when external-consumer demand justifies the
  operational surface. Nothing else in this ADR depends on it.

### The load-window's second half is now mechanical

`MetadataConversion.retiredFromLoadPath` implements "retired from the load path
in N+1 — but never deleted": a retired entry is skipped by the loader
(`applyConversions`) and replayed only by the chain (`migrate meta`) and the
fixture CI. Live-window entries (currently the protocol-15 ADR-0089 visibility
aliases) stay load-active until they graduate.

> **Superseded for metadata at rest** (2026-07-31, #3903; 2026-09-13, #12772).
> The paragraph above states the rule for the **authoring** load path and for
> nothing else, and a reader who stops here carries it to seams where it is
> false. Retirement is an authoring-surface event: the loader passes a retired
> entry over so a live author is taught the canonical spelling. Metadata at rest
> has no author to teach, so it replays the full chain, retired entries
> included — `sys_metadata` rows unconditionally (the 2026-07-31 addendum
> below), and a compiled artifact inside the versioned window its own manifest
> opens (the 2026-09-13 addendum below). Kept in place rather than rewritten,
> because a superseded decision is still a record (Prime Directive #13).

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
  conversion when lossless, and one D3 semantic entry per retirement family in
  every case; D2 carries the mechanical data repair only) in the same release.
  After GA the full D2 ladder applies: lossless breaks ship a live conversion
  entry or they do not ship.

  **Amended 2026-09-13 (#18003) — the level half.** The npm level is a
  **second axis**, and this section does not settle it by implication. Every
  "major" above means a *protocol* major — the `PROTOCOL_VERSION` step D2 and
  D3 are built around. The level a changeset declares is the *npm* version of
  the lockstep `fixed` group, and the two move independently. Two director
  rulings ~1.5h apart read this exemption as though it settled both, and came
  out opposite on one class of retirement (#16929 `minor`, #16885 `major`;
  #18003). So the level is stated here rather than inferred:

  - **Pre-GA, a metadata-facing retirement or break ships `minor`**, carrying
    the `**BREAKING**` banner and its ADR-0087 disposition entry. The level is
    *not* the carrier of breaking-ness during the window — the banner and the
    disposition are, and they are mandatory precisely because the level says
    nothing.
  - **An npm `major` is a planned act** — taken when the window closes and the
    queued conversions activate together — ⛔ never a side effect of one
    retirement card, however breaking that card is.
  - **A tombstone names the npm release it ships in, ⛔ never the protocol
    major.** The two numbers differ by construction while the window holds: a
    retirement shipping `minor` lands in `17.x.y`, so prose dating it to
    "`@objectstack/spec` 18" is wrong on the day it is written (#18021).

  ⇒ **This is enforced, and the enforcement pre-dates both rulings.**
  `scripts/check-changeset-no-major.mjs` refuses a PR that introduces a
  `major` changeset (maintainer ruling 2026-09-04, decision batch #35, on
  #15294; the `Check Changeset` step in `.github/workflows/pr-automation.yml`
  carries the level prose an author is shown). That script's header is the
  authority on every detail — the RC exemption, the `allow-major` escape
  hatch, and the GA end condition that retires the guard and returns the group
  to strict semver. ⛔ Do not restate its rules here: what was missing was
  never the rule, only a pointer to it from the section both rulings read.
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
  late", and the read path is its chain. (**Amended 2026-10-26**, #25767: "forever"
  is now one major. A stored row shaped for a major below the floor is no longer
  rewritten at read; it is canonicalized once, with `os migrate meta --stored
  --apply` on a release that still carries the step, before the deployment moves
  past it — the 2026-08-01 finish line is the mechanism, and it is now the
  required one, not an optional one.)
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

> **2026-10-16 note** (#23775, ruling B) — the flow save door draws this line by one predicate: `saveMetaItem` canonicalizes a flow with **no stored row at the save's address** (the row the save overwrites, or for a draft with none yet the active row it overlays) **without** retired entries, so a retired spelling meets the parse refusal (`422 INVALID_METADATA`, located, the text `os validate` prints), while a re-save of a stored row — and the server's own writes of bodies at rest — keep the full chain.

> **2026-10-16 note** (#23903, ruling B′) — a re-save is judged as authored input too when its request fires a retired entry the stored row does not: a retired hit (the entry, the spelling it rewrote, and its site, with a node's `id` standing for its index) that no stored row of the save's baseline carries (for a draft, the active row it overlays as well as its own) sends the whole body through the chain **without** retired entries and so to the same refusal, while a re-save whose retired hits the stored row all carries keeps the full chain.

## Addendum (2026-08-01) — the stored chain gets a finish line (#4327)

The addendum above makes a legacy row read canonical *forever*, which is the
correctness guarantee — and, read literally, also a promise that the chain runs
on that row forever. (**Amended 2026-10-26**, #25767: both "forever"s are now one
major — see the 2026-10-26 addendum.) `os migrate meta --stored`
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

> **2026-10-16 note** (#24001) — the conflict guard this addendum, the 2026-08-01 one and the 2026-07-31 one describe is retired, and with it the conversion-conflict channel: protocol 18 reserved the old callout node types (`FLOW_RESERVED_NODE_TYPES`, #23543 F5-http), so the engine refuses an executor under one, the guard inside `flow-node-http-callout-rename` went, and with no producer left the `reservedNodeTypes` / `onConflict` options, `ConversionConflictNotice` / `ConversionConflictDetail`, the `conflicts` arrays and `409 FLOW_CONVERSION_CONFLICT` left the published surface (D3 entry `conversion-conflict-channel-removed`). No save, duplication, import or stored-pass row refuses a rename any more. Flows still canonicalize at the engine rather than at the generic metadata seams, now because the engine's registration checks judge a plugin node against the live registry.

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
<!-- adr-0087: not-required (type-surface-only <path>#<Symbol>[, ...]) <why> -->
<!-- adr-0087: not-required (type-surface-only <path>#<a>.<b>.<member>[, ...]) <why> -->
<!-- adr-0087: not-required (runtime-export-retired <package>#<Export>[, ...]) <why> -->
<!-- adr-0087: not-required (runtime-export-retired <package>#<Type>.<member>[, ...]) <why> -->
```

**The vocabulary is closed, and every exemption is re-verified on every run** — an
allow-list nobody re-checks is the failure mode this whole mechanism exists to
avoid. `registered` must name ids that resolve *and* are new in the diff;
`unpublished` requires every bumped package to be `private: true`;
`already-registered` requires the named ids to pre-date the merge base;
`no-migration-prescription` is refused by a body that carries a migration
prescription; `runtime-interface-only` is the subject of the rest of this
addendum; `type-surface-only` — the sixth, added 2026-08-30 — is the subject of
the addendum after it; and `runtime-export-retired` — the seventh, added 2026-10-12 —
is the subject of the addendum after that. The checks live in
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

## Addendum (2026-08-30) — the sixth category: a published TYPE-surface narrowing (#13080)

The vocabulary above gained a sixth answer:

```text
<!-- adr-0087: not-required (type-surface-only <path>#<Symbol>[, ...]) <why> -->
<!-- adr-0087: not-required (type-surface-only <path>#<a>.<b>.<member>[, ...]) <why> -->
```

### The dead end it closes

A **published TYPE-surface narrowing** — a published SDK method whose declared
return moves off `any` onto the contract it always answered — declares
`**BREAKING**` truthfully. `any` is assignable to everything and admits every
property read, so a consumer's code really can stop compiling. The gate then asks
for a disposition, and every one of the five is closed to it. Measured on the real
#12104 shape, driven through the shipping gate:

| disposition | outcome |
|---|---|
| `registered` | refused — no id is new in the diff, and writing one would put a prescription in the ledger that `objectstack migrate meta`, `spec-changes.json` and the upgrade guide cannot project. False data in the one ledger this whole mechanism keeps true. |
| `not-required (unpublished)` | refused — `@objectstack/client` publishes to npm. |
| `not-required (already-registered <id>)` | the gate *admits* it, and that is the problem: it verifies the id RESOLVES and PRE-DATES the base, never that the entry COVERS this change. The only thing closing this door is the author's honesty, which is not a mechanism. |
| `not-required (no-migration-prescription)` | refused — the body carries a FROM/TO block. |
| `not-required (runtime-interface-only …)` | refused — it inherits that same refusal. |

So the exit the gate names in its own refusal text — *"use a category that can be
verified (`unpublished`, `already-registered`)"* — is factually false here, and the
only move left is to **drop the `**BREAKING**` token**.

### ⛔ The four changesets that took that move are a COUNTER-EXAMPLE, not a precedent

`#8140`, `#11925`, `#12034` and `#12104` are all `@objectstack/client` return-type
narrowings, all shipped `minor`, all recording the no-entry disposition in prose,
none carrying the token — each one consistent with the one before it. Read
individually every one of those calls was reasonable. Read together they are the
finding: a whole recurring class of genuinely compile-breaking change was nudged
away from this repo's breaking-change marker, purely because the marker routed it
into a ledger it does not belong in. The erosion is invisible — every gate stayed
green throughout.

**With the category in place the prose flips back.** A published TYPE-surface
narrowing resumes honestly carrying `**BREAKING**` and answers the gate with
`type-surface-only`. ⛔ Dropping the token is no longer an available exit, and those
four are cited here so the next author reads them as the shape to stop repeating.

### D8 — the affected party is a TypeScript consumer, and the compiler is the channel

The ADR-0087 ledger serves **metadata upgraders**: `objectstack migrate meta`
rewrites stored metadata, and it has nothing to reach when the only thing that moved
is a type annotation. The affected party here is a **TypeScript consumer** and the
delivery channel is the **compiler at their own call site** — strictly more precise
than a ledger line, and it reaches every affected consumer rather than the subset
who read release notes.

`no-migration-prescription` is not wrong in general — #6048 is exactly the shape it
was built to catch — it simply cannot tell *a prescription for a metadata upgrader*
from *a prescription for a source-code consumer*, and only the first is the ledger's
business.

An author may claim this category when **all four** of these hold, and the gate
checks all four by name (`published`, `no-spec-diff`, `no-metadata-surface-diff`,
`narrowed-from-erased`):

1. **the package really publishes** — the exact inverse of `unpublished`, read from
   the same workspace manifests. A private package's break reaches no consumer, so
   the compiler is not the channel that makes this honest; `unpublished` is.
2. **the diff does not touch `packages/spec/**`** — that package *is* the contract
   between metadata producers and the runtime, and both ADR-0087 registries live
   inside it.
3. **no ADR-0087 shape surface moved in the diff** — no `*.zod.ts`, no
   `packages/spec/src/contracts/**` entry, no object definition. Those are exactly
   what `objectstack migrate meta` reaches; when one of them moved, the ledger *is*
   a channel that can carry the change.
4. **the named symbol was erased at the merge base and is concrete at HEAD** — for
   each `<path>#<Symbol>` the author names, the gate reads its declared type at
   *both* revs and requires `any` / `unknown` / no annotation at base, and a
   concrete type at HEAD.

   ⭐ **The reference is a bare symbol OR a dotted member path.** `<path>#<Symbol>`
   resolves a bare name to the **first same-named definition in the file**, and on a
   real SDK module that is not a symbol identity: `packages/client/src/index.ts`
   declares `get` 14 times and `delete` 10 times, so the members PR #15445 and PR
   #15451 actually narrowed had **no addressable spelling at all** — the category
   was closed to them by the grammar rather than by any judgement about the claim,
   and the gate answered a true sentence about a member the diff never touched
   (#15627). A reference may therefore also be written `<path>#<a>.<b>.<member>`:
   the nesting the member sits in, walked **structurally** from the top of the file
   over a comment- and literal-masked projection, with the member's definition taken
   from inside the resolved body. A leading segment names an **object literal or a
   class** — both are containers a published member actually sits in, and reading
   only the first left a narrowing on a class method in the state #15627 was filed
   about: measured on `packages/objectql/src/engine.ts`, the dotted spelling was
   refused outright while the bare `#delete` answered a true sentence about
   `ObjectQL.delete`, a member the diff never touched (#17279). A **class
   expression** (`const X = class { … }`) is deliberately not walked — that name
   belongs to the binding, not to the class. Bare references keep their exact
   previous meaning. ⛔ A line number is never the disambiguator — this file's line
   numbers were measured to rot within one day. A dotted path that resolves to
   **zero** candidates, or to **more than one**, is reported by name and refused,
   never guessed at: a reference that silently landed on the wrong same-named member
   would be writable but wrong, which is worse than the refusal it replaces.

   > **Amended 2026-10-27 (#26220) — predicate 4 reads an `any` INDEX SIGNATURE.**
   > Provenance: the maintainer's decision A on the combined D8 + D9 question of
   > #26220, recorded on the card as claim amendment `6433464805` (2026-10-27T04:03Z).
   > The class it admits: a published interface whose declared members stay as they
   > were while its index signature moves off `any`. Measured on #26293:
   > `ui/packages/types/src/base.ts#ComponentRendererProps` is
   > `{ schema: TSchema; [key: string]: any; }` at the merge base and
   > `{ schema: TSchema; [key: string]: unknown; }` at HEAD. Every forwarded key was
   > readable as anything and now has to be narrowed first, so a consumer's code can stop
   > compiling, and nothing reaches `objectstack migrate meta`. Read as written above,
   > predicate 4 refuses it twice over: the interface is a named structural declaration,
   > concrete at base by construction, and `unknown` at HEAD counts as erased.
   >
   > For a bare `<path>#<Symbol>` naming an exported `interface`, or an exported `type`
   > alias whose right-hand side is an object type literal, predicate 4 **also** holds
   > when all three of these hold:
   >
   > 1. at the merge base the declared member surface carries at least one index
   >    signature whose value type is `any`;
   > 2. at HEAD at least one of those index signatures carries a value type other than
   >    `any`. Here `unknown` **counts as narrowed**: through an index signature `any`
   >    admits every read and `unknown` admits none, which is exactly the break this
   >    category exists for. The whole-symbol reading above is unchanged, and there
   >    `unknown` stays erased;
   > 3. everything else is identical at both revs: the declaration's heritage (its
   >    `extends` clause, its type parameters) and every member, compared member by
   >    member on the comment-masked, whitespace-normalised surface, with only the value
   >    types of the index signatures set aside. A member added, removed, renamed,
   >    re-typed or made optional fails this limb.
   >
   > **Why this is not a weakening.** The #6048 shape, a concretely typed interface that
   > LOST a member, fails condition 3 and is refused by predicate 4 exactly as before,
   > with the same founding-case refusal. The regression pin below keeps asserting it.
   > The limb admits only a surface whose sole change is that an index signature moved
   > off `any`. That is the same base-side reading predicate 4 always made, applied to the
   > one member that can be erased while the declaration around it is concrete. A dotted
   > member path keeps reading a member's return annotation alone; the limb does not
   > apply to it.

### ⭐ Predicate 4 is what makes this a narrowing rather than a hole

This is the **only** category exempt from the `no-migration-prescription` refusal.
The exemption is necessary — measured on the card, without it the gate still refuses
the exact class the category was created for — and it is also the only place in the
vocabulary where something the prescription detector refuses today becomes
claimable. That is not free, and predicate 4 is what pays for it.

Predicates 1–3 alone were measured against the case this gate was **founded** on and
they do not separate it: on reconstructed diffs the #12104 shipping half and the
**#6048** shape come out identical on all three — published, no `packages/spec`
movement, no metadata surface — so both would be admitted. And the prescription
refusal is the only guard currently holding #6048 out. Exempting a category from it
while checking only 1–3 would hand the founding case a green exit: a measured
regression, not a hypothetical.

Predicate 4 refuses it on a **positive, re-runnable reading** rather than on a
detector miss — the same method D7 used. #6048's symbol
(`packages/runtime/src/security/actor-user.ts#ActorUser`) is a concretely typed
exported interface at the merge base that *lost* a runtime member; the class this
category serves starts from `any` / `unknown` / no annotation at all. The base-side
type is the reading that separates them.

⛔ **Never weaken predicate 4 to make something else pass.** It is not one check of
four; it is the reason the other three are allowed to skip the prescription refusal
at all. A regression pin in the gate's `--self-test` asserts that the #6048 shape is
refused by predicate 4 specifically, so the founding case can never become
claimable.

#### What this does not decide

**Whether the HEAD type is the *right* type.** Whether the bound contract is what
the route actually answers is a question about a producer, settled by driving it —
which is what the changesets in this class do. This category asks only whether the
surface moved *off* an erased type.

**Whether the awaited type resolves to `any` through a chain.** Predicate 4 is a
source-text reading of what the author wrote at two revs, which is what *"was it
narrowed in this diff"* means. Its neighbour `check:exported-any-returns` judges the
complementary question — *does it still resolve to `any`* — against the **built
dist**, precisely because the erasure is invisible in source when a method carries
no annotation. The division is deliberate.

**The completeness of the claim.** Like `registered` and `runtime-interface-only`,
the gate judges the claim that was made, not whether the author named every symbol
their PR touched.

**The dispositions of the four live instances.** Those are backfilled after this
lands, per the ruling, and one of them (`declare-search-clone-response-contracts`)
fails predicates 2 and 3 outright — it bumps `@objectstack/spec` and adds
`packages/spec/src/api/protocol.zod.ts`, so it is not a member of this class.

## Addendum (2026-10-12) — the seventh category: a published runtime EXPORT retirement (#22918)

The vocabulary above gained a seventh answer, with two operand kinds that may be
mixed in one marker:

```text
<!-- adr-0087: not-required (runtime-export-retired <package>#<Export>[, ...]) <why> -->
<!-- adr-0087: not-required (runtime-export-retired <package>#<Type>.<member>[, ...]) <why> -->
```

### The dead end it closes

The worked example is `.changeset/15205-email-templates-resolve-registry.md` (PR
#22875, merged as `7de0265fc7`). It retires nine exports of
`@objectstack/plugin-email` and two members of its exported
`EmailServicePluginOptions`, and gives each retired name the one-line FROM → TO fix a
removal owes, written as six arrowless `- FROM … TO …` list lines. Every disposition
was closed to it on the facts but one:

| disposition | outcome |
|---|---|
| `registered` / `already-registered` | closed on the facts — no ledger id covers these paths and the diff adds none, and `objectstack migrate meta` has nothing to rewrite in host code. |
| `not-required (unpublished)` | refused — every bumped package publishes. |
| `not-required (runtime-interface-only …)` | refused — it reads an exported type declaration at HEAD, and a retired export has none. |
| `not-required (type-surface-only …)` | refused — nothing narrowed off `any`. |
| `not-required (no-migration-prescription)` | admitted — but only because the detector reads an arrow or a framed table, and these lines carry neither. |

So the exemption was held by a detector **miss**, the shape D7 retires, and the
changeset's own marker asked for a ruling. The class recurs with ADR-0131's v18
retirements. Measured on the stock at `018b077fb`: 131 declared-breaking changesets,
83 of them on `no-migration-prescription`; arrowless `FROM … TO` lines naming code
appear in 6 changesets, 4 declared-breaking, and the detector reads none of them —
15205 is the one that holds the catch-all, the other three are `registered`.

### D9 — a retired published runtime export is compiler-carried, and the gate proves the retirement with the compiler

The channel argument is D7's and D8's: the affected party is a TypeScript consumer,
the compiler reports the break at their own import (`TS2305 … has no exported
member`) or at the object literal that still passes a removed option, and the ledger
has no metadata to rewrite.

**Operands.** `<package>#<Export>` names a retired export of the package's published
entry; `<package>#<Type>.<member>` names a retired member of an exported type — the
dotted spelling `type-surface-only` already uses. The **package** is named, never a
file: "reachable from the published entry" is a fact about the package, and a
declaration can move between files without the export moving. ⛔ A member is addressed
by that **canonical spelling only**. The gate parses no constructor argument and no
object literal: a FROM side written `new EmailServicePlugin({ seedTemplates: false })`
names `EmailServicePlugin`, never `EmailServicePluginOptions.seedTemplates`.

An author may claim the category when, for every operand, all three of these hold —
re-verified on every run and checked by name (`retired-from-entry`,
`no-metadata-surface`, `from-operands-named`):

1. **retired-from-entry** — an export is reachable from the package's published entry
   at the merge base and absent at HEAD; for a member, its type is reachable at the
   base, the member is present on it there (`getPropertiesOfType`), and it is absent
   at HEAD while the type is still exported. The reading is the **TypeScript
   compiler's**: a Program over the package's source entry at each rev, and
   `getExportsOfModule` on the entry's symbol, so `export *` resolves. The entry is
   located through the package's `exports` map (read with `resolveTypesEntry`, the
   readme-exports gate's reader, imported rather than re-written) and tsup's
   convention: the declaration entry `dist/index.d.ts` — or the `.d.mts` / `.d.cts`
   twin tsup writes beside it, which is where `@objectstack/spec`'s `import`
   condition lands — is generated from `src/index.ts`. A private package has no
   published entry (`unpublished` is its disposition).
2. **no-metadata-surface** — at the merge base, no operand is declared in a
   `*.zod.ts`, under `packages/spec/src/contracts/` or in an object definition, none
   is a Zod projection, and no metadata surface references it in code: the D7
   primitives, read at the **base** because the operand is gone at HEAD.
3. **from-operands-named** — the FROM → TO block names **exactly** the named
   operands, each spelled as in the marker (`Type.member` for a member): every FROM
   operand is a named one, and every named one has a FROM side.

⛔ **A published package whose entry cannot be mapped is refused, loudly and by name —
never guessed.** Measured at `018b077fb`, 4 of 70 published packages:
`@objectstack/client-react` (no `src/index.ts`), and `@objectstack/console`,
`@objectstack/skills` and `create-objectstack` (no types entry). Absence is proven,
not assumed, the same way: an `export *` the reader cannot follow refuses an absence
claim at HEAD (a name could sit behind it), and so does a type whose member set at
HEAD depends on something the reader cannot resolve. A re-export of another workspace
package's root entry is followed through the same mapping.

> **Amended 2026-10-27 (#26220) — the source entry may be `src/index.tsx`.**
> Provenance: the maintainer's decision A on the combined D8 + D9 question of #26220,
> recorded on the card as claim amendment `6433464805` (2026-10-27T04:03Z). The mapping
> pinned above reads only `src/index.ts`. The `ui/` packages build their declaration
> entry with vite-plugin-dts (`insertTypesEntry`, `include: ['src']`) from
> `src/index.tsx`. Measured at `83e9d718`, 21 of the 38 published `ui/` packages have that
> entry, and all 21 name `./dist/index.d.ts` as their types entry, so a
> `runtime-export-retired` operand on any of them was refused at predicate 1 as
> unmappable. The plugin-ai retirement of #25921 (PR #26365) is the first such case.
> `@objectstack/client-react`, named above as unmappable, is the same shape under tsup
> (`tsup src/index.tsx`).
>
> The mapping is now: the declaration entry the `exports` map names (`dist/index.d.ts`, or
> its `.d.mts` / `.d.cts` twin) is generated from the package's **one** source entry,
> `src/index.ts` **or** `src/index.tsx`. A package carrying both is refused as ambiguous
> (none does at `83e9d718`), and a package carrying neither is refused as unmappable,
> loudly and by name as before. Nothing else about predicate 1 changes. The compiler
> reads the `.tsx` entry and every `.tsx` module behind it with JSX enabled. #26319 made
> the reader resolve `.tsx` modules for predicate 2, and an entry that is itself `.tsx` is
> read the same way. The build tool is never asked: the source file's name is the
> fact the gate reads, and a build that generates `dist/index.d.ts` from some other file
> stays unmappable.

**The deviation accepted with the ruling.** A merge base has no build output (`dist/`
is gitignored), so predicate 1 compiles the **source** entry that generates the
public `.d.ts`, not the `.d.ts` itself. For the question "which names does the
package export" the two agree.

**It inherits the `no-migration-prescription` refusal — more finely, never less.**
Unlike `type-surface-only` it is not exempt. Predicate 3 reads the FROM side of every
rewrite the body writes — a `FROM … TO …` line, an arrow `X → Y` (or `X → delete`),
the FROM column of a `| FROM | TO |` or `| Wrote | Write instead |` table — then sets
exactly those lines aside and runs the same prescription detector over what is left.
Anything it still finds is refused: a rewrite table with no FROM column, a vertical
FROM / TO pair, a FROM → TO label over anything not read. Nothing the detector refuses
today becomes claimable unless every operand it rests on was proven retired by
predicates 1 and 2 — and the arrowless block the detector cannot see is read here
instead of waved through.

### The worked example under this category

Its lines 25–28 name the nine retired exports, and the gate accepts that half under
this marker (the self-test carries their text). Its lines 29–30 write the two retired
options as `new EmailServicePlugin({ … })`, which names the still-exported
`EmailServicePlugin`: under this marker they are refused as out of range. Those two
lines are the reason the member limb exists — without it a mixed retirement keeps
half its claim on a detector miss — and the reason the member is spelled canonically
(`EmailServicePluginOptions.seedTemplates`). The changeset itself is merged and is
**not re-graded**: it stays on `no-migration-prescription`. New retirements use this
category.

### Not taken

- **Exports only** — a mixed retirement would keep its member half on the catch-all,
  held by a detector miss: the shape D7 retires.
- **Members resolved from constructor arguments** (`new X({ option })` read back to
  the options type) — the fragile half, and unneeded once the spelling is canonical.
- **The existing detector alone** — it reads no arrowless line, so the class would be
  admitted by the same miss.
- **A one-hop text reader of the entry that refuses `export *`** — a second export
  resolver beside the compiler, and its blind spot refuses honest claims.
- **Per-package export snapshots** — a new family of generated artifacts with its own
  gate; a new gate defaults to no.

### What this does not decide

**The completeness of the claim.** Like `registered`, `runtime-interface-only` and
`type-surface-only`, the gate judges the operands named, not every export the diff
removed.

**A subpath entry or a static member.** Only the root entry is read, and a member is
read on a class's instance type; anything else is refused rather than assumed.

**The detector.** `no-migration-prescription`'s refusal and the detector's arrow rule
are unchanged; the arrowless line stays outside the detector's reach, stated as such
in the gate's residual-blind-spot paragraph, and is read only by this category.

## Addendum (2026-09-13) — the artifact-ingestion door opens a versioned window (#12772)

The addenda above reach authored source and metadata at rest in `sys_metadata`.
A third seam was reached by neither: a **compiled artifact**
(`objectstack build` → `dist/objectstack.json`) is data at rest *with a version
stamp*, and nothing replayed the chain before its strict parse. Measured on
#12772: an app built by its pinned released 17.1.0 toolchain carried **75**
occurrences of `allowPurge` / `allowRestore` that its own source never wrote —
the released builder injected the then-legal permission bits — and booting that
artifact on a 17.2.0 runtime was refused at the door by the #12497 tombstone.
`os migrate meta` could not help: it targets sources, not built artifacts, so
the only operator remedy found was hand-editing the artifact JSON. The policy
that closed it shipped inside the v17 line; it lived in the issue and in no
addendum here, which is the omission this entry corrects (#17894).

**The ruling** (#12772 triage, comment `5443380108`, 2026-08-27), verbatim:

> So the conversion must be a *versioned forward conversion keyed off the
> artifact's authored `specVersion`*, ⛔ not an unconditional strip — an
> unconditional strip becomes wrong again the moment M2 lands and the keys are
> legal once more.

The M2 half is the load-bearing reason and not a stylistic one: #12497 retired
these keys with the M2 anchor left open (#1883, `pm:on-hold`), so an
unconditional strip would start deleting legal metadata the day the keys return.

- **The window, and what keys it.** The policy is one function —
  `packages/metadata-core/src/artifact-forward-conversion.ts#applyArtifactForwardConversions`
  — and it compares two versions: the **floor** of the range the artifact's
  manifest declares (`engines.protocol`, ADR-0025) and the `@objectstack/spec`
  version the process actually runs. `floor < runtime` replays the FULL chain,
  retired entries included, before the strict parse — the artifact is the
  "consumer arriving late" D3 keeps every conversion forever for (**amended
  2026-10-26**, #25767: for one major, after which the artifact's retired keys meet
  the strict refusal and the guide link, exactly as an authored source does). ~~`floor >=
  runtime` replays nothing: the artifact claims the current or a newer surface,
  and the strict parse, tombstones included, stays the authority.~~ — **amended
  2026-09-30** — `floor >= runtime` replays only the retired entries whose
  `retiredAfter` the floor does not exceed (verdict `'converted-retired-after'`),
  and nothing when no entry is that recent; every other entry meets the strict
  parse, tombstones included, as its authority. That branch is
  what makes the window *versioned rather than a blanket amnesty*, and it is the
  branch the M2 return needs. No declared range replays (an artifact of unknown
  age is old data at rest, and conversions only rewrite shapes they positively
  recognize); an unresolvable runtime version replays nothing, because amnesty
  rests on positive version evidence.

  > **Amended (2026-09-30) — the window decides per entry.** Provenance: the
  > #20390 ruling, comment `5865890672` (director batch #235 item 1, letter A;
  > maintainer 「同意 A」), landed as `e956924e` (PR #20435). Every retired
  > conversion carries a required `retiredAfter`, the last published
  > `@objectstack/spec` whose authoring surface still accepted the old shape,
  > and the door replays an entry E when `floor < runtime` OR
  > `floor <= E.retiredAfter`. Why: `main` refuses keys the next release retires
  > while it still carries the last release's label, so the label-only
  > comparison read an artifact built by that last release as current and
  > refused it outright. The module docblock of
  > `packages/metadata-core/src/artifact-forward-conversion.ts` states the rule
  > and is its authority.

  > **Amended (2026-10-13) — a first-release-of-a-major floor replays that
  > major's step.** Provenance: #23001, landed as `58f5c90999` (PR #23023),
  > recorded here by #23038. The window has a THIRD disjunct: the door replays
  > an entry E when `floor < runtime` OR `floor <= E.retiredAfter` OR
  > (`floor` is `M.0.0` AND `E.toMajor` is M). A floor that is the first
  > release of major M, at or above the runtime label, replays every retired
  > entry of the conversion step into M (`CONVERSIONS_BY_MAJOR[M]`, the step
  > `objectstack migrate meta --from M-1` replays), with the default flips
  > still refused by id first, under the verdict `'converted-major-step'`
  > (`packages/metadata-core/src/artifact-forward-conversion.ts#idsTheFloorPostdates`).
  > Why: `M.0.0` is what a bare `^M` range reads as and the floor every build
  > from M's prerelease declares, while the package label still names the
  > last release of M-1 and every retirement landing in the prerelease is
  > stamped at or below that label; so the per-entry half read a `^18`
  > artifact built before a prerelease retirement as postdating every stamp
  > (`'authored-current'`), and the strict parse refused it. The replay is
  > safe because a conversion rewrites only the shape it positively
  > recognizes: an artifact built after a retirement comes back unchanged,
  > and one built before it boots. ⚠️ The M2 caveat: an entry whose old shape
  > becomes legal again cannot be protected for a bare-major floor by this
  > half, nor by the label half, which strips it for the same artifact one
  > release later; the change that re-legalizes a retired key decides that
  > entry's fate at this door, where the default-flip refusal
  > (`packages/metadata-core/src/artifact-forward-conversion.ts#DEFAULT_FLIPS_NOT_REPLAYED_HERE`)
  > is the existing mechanism. The `retiredAfter` the note above defines is a
  > stable `x.y.z`: under a prerelease label (Changesets pre mode) it is the
  > newest published stable release, never a prerelease tarball (#23042,
  > landed as `719183f50`, PR #23130). The addendum's closing sentence,
  > "within-line retirements (17.1 → 17.2)", still names the case that
  > created the window and is annotated there, not rewritten: the window now
  > also serves a prerelease-major floor. The module docblock remains the
  > rule's authority.
- **⚠️ The shipped key is the DECLARED FLOOR, not the authored version.** The
  ruling says "authored `specVersion`"; what an artifact manifest actually
  carries is a protocol *range*, so the implementation keys off that range's
  floor. The difference is not cosmetic — `^17.0.0` is the range
  `create-objectstack` stamps, so an app authored today lands inside the window.
  Recorded here as the as-built reading, because the next two bullets are its
  consequences.
- **One policy, not per-door copies** (#12772, the card's own shape). Two
  in-tree doors consume that one function: the metadata plugin's artifact
  ingestion (`packages/metadata/src/plugin.ts`) and the runtime app plugin's
  security bundle (`packages/runtime/src/app-plugin.ts`). ⛔ A door that
  re-implements the comparison is the drift this bullet exists to forbid.
- **⛔ The window does NOT admit default flips** (narrowed later, on #16693 and
  #17885). A retirement whose old shape has no live meaning left is safe to
  replay here. A DEFAULT FLIP is not: its old shape still parses, still means
  something on today's authoring surface, and rewriting it is a
  reinterpretation — sound only where "this input predates the flip" is a fact,
  and at this door it is a guess, because the key is a declared floor and not an
  age. The exclusion list is
  `packages/metadata-core/src/artifact-forward-conversion.ts#DEFAULT_FLIPS_NOT_REPLAYED_HERE`;
  an entry on it keeps firing at the stored-row seams and under
  `os migrate meta`, where the old meaning is the only meaning.
- **Where the window starts, relative to the schema.** A retired key carrying
  only its *emitted default* parses as inert residue and is stripped silently at
  the SCHEMA layer (the `acceptRetiredDefaultResidue` stage, ruled on #12845 and
  recorded in this card's review, comments `5448522858` / `5448958115`); the
  door's window is not what rescues that class. What the window admits is the
  class the schema still refuses: a retired key carrying a NON-default value,
  which keeps the #12497 tombstone at the current version and is convertible
  only because the artifact says it was authored before the retirement.
- **The flag's live inventory**, measured for this entry: three
  `includeRetired: true` literals in runtime source — the artifact policy above,
  the automation engine's stored-flow canonicalization seam
  (`packages/services/service-automation/src/engine.ts#canonicalizeStoredFlow`,
  which `registerFlow` calls), and
  `packages/spec/src/conversions/stored.ts#applyConversionsToStoredItem` — and
  **four** runtime callers, because the artifact policy is called by two doors.
  `stored.ts` **pins** the flag rather than offering it
  (`packages/spec/src/conversions/stored.ts#StoredConversionOptions` is an
  `Omit` over `includeRetired`), so no caller can turn the stored-row replay
  off.

**What this does not decide.** The cloud composed-artifact door
(`OS_COMPOSED_ARTIFACT_URL`) is a second door in another repository and was
recorded, not filed, by the #12772 triage: it needs the same treatment and
should CONSUME this policy rather than reimplement it. Nothing here changes the
protocol handshake's jurisdiction either — a cross-major gap refuses at
`checkProtocolCompat` before conversion could matter, and this window is for
within-line retirements (17.1 → 17.2), which are the case that created it.

> **Annotated (2026-10-13).** Since `58f5c90999` the window also serves a
> prerelease-major floor: `^18` on a runtime labelled from 17.7.0 through
> 18.0.0, and from 18.0.1 on the label half replays the whole chain for it
> (the 2026-10-13 amendment note under the window bullet). The handshake
> still answers first: the protocol constant moves to M when M's prerelease
> opens, so a `^M` floor passes it while the package label still names the
> last release of M-1, and only then does the window decide.

## Addendum (2026-10-26) — retirement kits age out after one major (#25767, ruling D2 = A)

**The ruling.** A *retirement kit* — the `retiredKey()` tombstone, its
`RETIRED_KEYS_BY_MAJOR` / `RETIRED_DEFS_BY_MAJOR` rows, its semantic entry and its D2
conversion — lives through the protocol major **after** the one it retired in, and is
removed when the next major is cut. At major 18 that keeps the 17.x and 18.x kits and
removes everything retired at or below 16.x; 19 repeats the move one major on. The
"never deleted", "permanent" and "forever" wording in D2, D3, the consequences and
the 2026-07-31 / 2026-08-01 / 2026-09-13 addenda is amended in place above. No gate
was added: the existing deletion gate's clock was shortened and given a second,
registry-independent source.

**What a removed key meets.** The key leaves the shape entirely, so a `strictObject`
refuses it as an unknown key. The refusal carries one more sentence, after its fix
channels and ahead of its history sentence (`RETIRED_KEY_UPGRADE_GUIDE_SENTENCE`,
`packages/spec/src/shared/protocol-upgrade-guide.ts`, keeping the #5955 order): it
says that keys retired before the previous major are no longer prescribed in the
error and names the protocol upgrade guide
(`https://objectstack.ai/docs/protocol-upgrade`); the guide and the CHANGELOG carry
the prescription from then on. The 17.x kits still carry theirs in the error.

**The support floor rises with it.** `MIGRATION_SUPPORT_FLOOR` is 17: `os migrate meta
--from 16` (and below) answers `MigrationFloorError`, whose message now names the
floor and the guide link; it rewrites nothing. A source authored against protocol 16
reaches 17 on a release that still carries the step — any `@objectstack/cli` up to
18.1 — and then runs the current release. The floor is no longer a per-release
decision: it is `CURRENT_MAJOR − 1`, by this rule, at every major cut.

**What was removed at 18 (this amendment's own diff).**

- 50 D2 conversions with `retiredAfter` at or below 16.x (5 at 15.0.0, 45 at 16.1.0),
  with their fixture pairs and the comments that named them; 12 conversions with
  `toMajor: 17` and `retiredAfter: 17.7.0` stay, registered under major 17 for the
  data-at-rest seams.
- 55 tombstones whose key was already `[RETIRED]` at `@objectstack/spec@17.0.0` and
  whose container is `strictObject` — the ones whose deletion yields a refusal. 58
  tombstones in the same age class sit in containers that **strip** unknown keys
  (`z.object` / `.strip()`): deleting one of those would downgrade a refusal to a
  silent strip, the very defect PD #12 names, so they stay until their container is
  made strict. The four inline-credential refusals (`refusedInlineCredentialKey`)
  are security refusals, not retirements, and are untouched.
- The 159 major-17 entry files (29 retired-key rows, 53 retired-def rows, 77 semantic
  entries) and the chain's step 17.
- 61 `[RETIRED]` lines of the authorable surface.

**The deletion gate (`check:authorable-surface`, proof 1).** `TOMBSTONE_AGE_MAJORS` is
1. A deleted `[RETIRED]` line is dated either by an exact `RETIRED_KEYS_BY_MAJOR` row
(registered at a major ≥ 1 behind the current one) or — new — by the previous major's
release tag: a line already `[RETIRED]` on the authorable surface at
`@objectstack/spec@<CURRENT_MAJOR − 1>.0.0` was retired before that cut, so its kit
has lived its one major. The tag is immutable and lives on origin, so neither a row
a PR writes nor one it deletes moves the clock, and the rows of a removed region
need no backfill to stay datable. Where the tag cannot be read (offline), the gate
falls back to the registry alone and says so — strictly more refusals, never fewer.

**Stored rows.** A `sys_metadata` row still carrying a ≤16.x spelling is no longer
rewritten at read. Canonicalize it once, `os migrate meta --stored --apply` on 18.1 or
earlier, before moving the deployment past it. Two consequences are specific:
`app-hidden-to-unpublished` (ADR-0045 amendment 2026-08-09) is among the removed
conversions, so a pre-split `hidden: true` app row is no longer rewritten to
`_unpublished` by any seam — the artifact door's refusal of it by id is moot and was
removed; and the 12 surviving `toMajor: 17` conversions have no chain step to be
listed under, so `os migrate meta` cannot enumerate them (they still run at the
stored-row and artifact seams).

**Residuals.** The clock reads the release tag, so a repository whose checkout cannot
fetch `refs/tags/@objectstack/spec@<N>.0.0` dates by the registry only; CI's shallow
jobs fetch the one tag, `--depth=1`, exactly as they fetch `origin/main`. The 58 kept
strip-container tombstones are a list in the #25767 report, to be retired container
by container as each is made strict.
