#!/usr/bin/env tsx
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Run **every** generated-artifact gate and report **all** stale artifacts in one
 * pass.
 *
 * CI runs these gates as separate sequential steps, so the first stale artifact
 * masks the rest: you fix it, push, and discover the next one on
 * the following run. That happened twice on #4040 (`check:docs`, then
 * `check:api-surface`) and twice again on #4161 (`check:spec-changes`, then
 * `check:upgrade-guide`) — four pushes spent learning something one local run
 * could have told you.
 *
 * This is deliberately **not** a "regenerate everything" script. Blanket
 * regeneration destroys the signal: it rewrites artifacts whose staleness you
 * never saw, so a real semantic change lands silently inside a mechanical diff.
 * What is worth automating is the *diagnosis* — which artifacts are stale, and
 * the exact command for each. `--fix` then regenerates **only** the ones this run
 * proved stale, and says so — minus the `ratchet` entries, whose gate has already
 * answered a question `--fix` would otherwise have to guess (see GATED below).
 *
 * Usage:
 *   pnpm --filter @objectstack/spec check:generated          # report every stale artifact
 *   pnpm --filter @objectstack/spec check:generated --fix    # + regenerate exactly those
 *   pnpm --filter @objectstack/spec check:generated --reconcile-only   # ledger audit only, no gates (CI)
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// One staleness rule, shared with the merge driver's pre-commit half (#4675) —
// two copies of "is dist older than src" would drift, and the direction they
// drift in is the one that writes a wrong artifact.
import { declarationStamp, distIsStale } from '../../../scripts/check-regen-pending.mjs';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The gates that verify a checked-in artifact against its source, with the
 * generator that rewrites each. Order is the cheapest-first order a human would
 * want the answers in, not CI's.
 *
 * `ratchet` marks the entries whose artifact is a DIRECTIONAL debt ledger rather
 * than a descriptive snapshot of the source. For those, "stale" is ambiguous —
 * see the `--fix` loop, which refuses to guess.
 */
const GATED: ReadonlyArray<{
  check: string;
  gen: string;
  artifact: string;
  readsDist?: true;
  /**
   * This gate renders from `packages/spec/json-schema/`, and the value names the
   * gate in this very list that PRODUCES that tree (#4723).
   *
   * The tree is gitignored, so no checkout carries it — someone has to generate
   * it, and until #4723 that someone was `check:docs` itself: its first step was
   * `gen:schema`, which also repairs the two TRACKED projections whenever they
   * are behind. So running this aggregate on a stale manifest produced a report
   * that was red at `check:authorable-surface` and a working tree that had been
   * quietly fixed by the gate two lines below it — a red verdict over a file
   * already repaired, which is harder to explain than the staleness was.
   *
   * The generation moved to the caller, and the caller here is this list's ORDER.
   * That is a real dependency, so it is declared rather than left to the array
   * literal's shape: `reconcileLedger` fails if the named producer is absent or
   * runs after its consumer. It is not a second `gen:` step — the producer is a
   * `--check` run, which writes the gitignored tree and refuses to touch a
   * tracked file (#4711). Anything that DID regenerate here would repair the
   * projections before `check:authorable-surface` could report them, which is the
   * defect wearing a fix's clothes.
   */
  readsSchemaTree?: string;
  ratchet?: true;
}> = [
  // First, because it is UPSTREAM of the two below and the cheapest thing in the
  // list: it reads a directory and splices text, with no schema build. Both
  // `spec-changes.json` and the upgrade guide are projections of the migration
  // registry (#7297), so a registry left stale after an entry file was added
  // reports as THREE stale artifacts, of which only this one names the cause.
  {
    check: 'check:migration-registry',
    gen: 'gen:migration-registry',
    artifact: 'src/migrations/registry.ts — its generated regions, from src/migrations/entries/',
  },
  { check: 'check:spec-changes', gen: 'gen:spec-changes', artifact: 'spec-changes.json' },
  { check: 'check:upgrade-guide', gen: 'gen:upgrade-guide', artifact: 'docs/protocol-upgrade-guide.md' },
  // [#10096] The schema-free `/meta` URL-spelling data module. Cheap: tsx-loads
  // the two source maps (lazySchema keeps the kernel module light), re-derives
  // the three-limb union, and runs the manifest/derived agreement assertion
  // that used to live at `shared/metadata-url-spelling.ts` module load — this
  // gate is that assertion's build-time enforcement home (ruling 2026-08-20).
  {
    check: 'check:meta-url-spelling',
    gen: 'gen:meta-url-spelling',
    artifact: 'src/meta-spelling/meta-url-data.generated.ts',
  },
  { check: 'check:skill-docs', gen: 'gen:skill-docs', artifact: 'skill docs (from SKILL.md frontmatter)' },
  { check: 'check:skill-refs', gen: 'gen:skill-refs', artifact: 'skill references' },
  { check: 'check:react-blocks', gen: 'gen:react-blocks', artifact: 'react-blocks contract' },
  {
    check: 'check:authorable-surface',
    gen: 'gen:schema',
    artifact: 'authorable-surface/ + authorable-defaults/ (+ its .base.json anchor) + JSON schemas',
  },
  // Reads the BUILT `dist/*.d.ts`, not the source. On a stale dist it reports
  // every export added since the last build as a "breaking removal" — a phantom
  // that has cost real triage time (AGENTS.md records the trap). Flagged so the
  // failure explains itself instead of sending the next reader after a ghost.
  { check: 'check:api-surface', gen: 'gen:api-surface', artifact: 'api-surface/', readsDist: true },
  // The #4796 declaration-origin baseline. Reads `src/`, NOT the dist — so it
  // carries no `readsDist` caveat and needs no build. It sits next to
  // `check:api-surface` because they answer adjacent questions about the same
  // surface: that one records WHICH NAMES each entry point exports, this one
  // records WHICH DECLARATION each of those names resolves to. Seventeen
  // export-surface pin tests read it instead of each building their own
  // `ts.createProgram` inside a vitest case (~55s of compilation per CI lap,
  // and a non-deterministic timeout that ejected unrelated PRs from the merge
  // queue), so its freshness is what those pins mean.
  { check: 'check:export-origins', gen: 'gen:export-origins', artifact: 'export-origins/' },
  // The TS-declaration-name → registry-name map (#13712). Composed from the two
  // artifacts above it in this list — json-schema.manifest/ (via
  // check:authorable-surface) and export-origins/ — plus a syntactic pass over
  // src/ for module-private base declarations (ObjectSchemaBase → data/Object),
  // so it runs AFTER both inputs' own gates and a `--fix` regenerates it after
  // them. Reads src/ and committed artifacts only: no build needed.
  { check: 'check:declaration-map', gen: 'gen:declaration-map', artifact: 'declaration-map/' },
  {
    check: 'check:docs',
    gen: 'gen:docs',
    artifact: 'content/docs/references/**',
    readsSchemaTree: 'check:authorable-surface',
  },
  // Moved out of NO_GENERATOR at #5107: the strictness ledger's numbers became a
  // generated artifact, so this gate now has something to regenerate. It still
  // audits source too (a hand-written row must name a live sited file), which is
  // why the `gen:` fixes only half of what it can report — the other half is a
  // ledger edit, and the failure says which.
  {
    check: 'check:strictness-ledger',
    gen: 'gen:strictness-ledger',
    artifact: 'docs/audits/2026-07-unknown-key-strictness-ledger.counts.md',
  },
  // Moved out of NO_GENERATOR at #7377, by the same precedent as its neighbour
  // above and for the same measured reason: the liveness README's "Current state"
  // table published its counts by hand, 9 of its 30 rows had drifted from the gate
  // before anyone re-ran the documented snippet, and hand-maintained counts merge
  // clean and wrong. The numbers are now an artifact this gate proves fresh; the
  // Notes prose stays hand-written, so — exactly like the strictness ledger —
  // `gen:` repairs only the half of what this reports that is arithmetic. The
  // other half is an unclassified property, a rotted evidence pointer or a row set
  // that no longer matches GOVERNED, and the failure says which.
  //
  // Last among the non-`ratchet` entries on the cheapest-first rule: it eagerly
  // loads every Zod schema and walks all 30 governed types.
  {
    check: 'check:liveness',
    gen: 'gen:liveness-counts',
    artifact: 'liveness/state-counts.md',
  },
  // GATED by the definition above — it compares a checked-in artifact
  // (test-typecheck-debt.json) against what `tsc -p tsconfig.test.json` measures
  // right now, and `gen:test-typecheck-debt` is that artifact's writer. It is NOT
  // a source audit: there is a real file to regenerate, so NO_GENERATOR would be
  // a false classification, and UNGATED_GENERATORS ("nothing verifies this
  // output") would be false in the other direction.
  //
  // What it is, that nothing above it is, is a DIRECTIONAL ratchet — hence
  // `ratchet`. The other artifacts here are pure functions of the source, so
  // regenerating is always the right answer. This one records DEBT, and its four
  // verdicts split two ways: "the debt shrank" and "the file graduated" are
  // re-record, while "the debt grew" and "an unledgered file has errors" are fix
  // the code (#5286). `--fix` regenerates without reading which one it got, so
  // for this entry it refuses instead — the merge that brought three new spec
  // test files into this very branch is the live shape of the risk: had any of
  // them carried errors, a reflexive `--fix` would have ledgered them silently.
  //
  // Cost: this is the only gate here that runs a full tsc program (~30s over
  // src/**/*.test.ts), so it goes last in the cheapest-first order above.
  {
    check: 'check:test-typecheck',
    gen: 'gen:test-typecheck-debt',
    artifact: 'test-typecheck-debt.json',
    ratchet: true,
  },
];

/**
 * Gates this script deliberately does NOT run. They audit the source for a
 * property (liveness, conformance, example validity) rather than compare a
 * checked-in artifact against its generator — there is nothing to regenerate,
 * so a failure is a code change, not a `gen:` command.
 */
const NO_GENERATOR: ReadonlyArray<{ check: string; why: string }> = [
  // `check:liveness` used to sit here — "audits whether declared spec properties
  // have a reader — no artifact". #7377 gave it one (the state table's NUMBERS
  // became an artifact; its Notes prose stayed hand-written), so it moved to GATED
  // above. The audit half is unchanged and is still the bulk of what it reports.
  { check: 'check:empty-state', why: 'audits empty-state coverage — no artifact' },
  { check: 'check:skill-examples', why: 'validates skill examples parse — no artifact' },
  // #13086 — the YAML half of the surface `check:skill-examples` covers for
  // TypeScript: tagged ```yaml blocks in skills/ + content/docs/ are safeParsed
  // against the live spec schemas. Reads src/ through tsx (no dist), writes
  // nothing: a failure is a doc example to fix or a marker to move, never a
  // `gen:` to run.
  { check: 'check:yaml-examples', why: 'validates tagged prose YAML examples against live spec schemas — no artifact' },
  // #7319. Reads `src/` and the shipped template trees and writes nothing: a
  // failure is either a manifest to fix or a schema to fix, never a `gen:` to
  // run. It audits the inverse direction from everything in GATED — those
  // compare an artifact this package GENERATES against its source, this one
  // compares a file another package SHIPS against the schema that claims to
  // describe it. Two drifts had already accumulated in that blind spot (#6861's
  // stripped `namespace`, #7319's required-but-absent `manifestId`).
  {
    check: 'check:template-manifests',
    why: 'parses every shipped objectstack.manifest.json against TemplateManifestSchema — no artifact',
  },
  // Landed in #4177 while this ledger landed in #4183 — neither PR could see the
  // other, so `main` carried an unclassified script and this reconciliation was
  // failing on `main` itself. The doc it checks against is hand-written, so there
  // is no generator to name.
  { check: 'check:variant-docs', why: 'audits that each schema variant appears in its hand-written doc — no artifact' },
  // #13353. A pure source audit over the WHOLE workspace, not this package:
  // every stamp site of a ledger-registered code in `packages/**` non-test
  // source must be listed under the stamping package's own owner key or carry
  // a recorded PROVENANCE_WAIVERS entry (both live in
  // src/api/error-code-ledger.zod.ts). Reads source text through tsx and
  // writes nothing: a failure is a ledger row or waiver to record — a
  // provenance DECISION — never a `gen:` to run, and a generator that wrote
  // rows from the scan would admit an emitter by running a command.
  {
    check: 'check:error-code-provenance',
    why: 'audits that packages stamping ledger-registered codes list them under their own owner key (or carry a recorded waiver) — no artifact',
  },
  // #14478, maintainer ruling 2026-09-02 ("ruled B" — no grandfathered
  // baseline). A pure source audit over `src/**`: a duration-shaped
  // `z.number()` key whose describe names a time unit must carry that unit in
  // its NAME. Reads source text through tsx and writes nothing. There is no
  // ledger, no `--update` and deliberately no `gen:` — the one command a
  // reader would reach for ("record today's offenders as the baseline") is
  // exactly the option the ruling rejected, so a red here is always a rename
  // (with its ADR-0087 conversion) or a describe to fix, never a command.
  {
    check: 'check:duration-unit-keys',
    why: 'audits src/** for a duration-shaped `z.number()` key whose unit lives only in its describe — zero offenders by ruling, no baseline, no artifact',
  },
  // `check:strictness-ledger` used to sit here — "the ledger it audits is a
  // hand-maintained doc, so there is no generator". #5107 gave it one (the ledger's
  // NUMBERS became an artifact; its VERDICTS stayed hand-written), so it moved to
  // GATED above. The story that put it here is still worth keeping: it landed in
  // #4232 while nothing in CI ran this reconciliation, so `main` went red for every
  // local wrapper run — the second time in three days after #4177 — and the fix was
  // wiring `--reconcile-only` into lint.yml's unfiltered job.
  // The odd one out: it audits the source's TYPES, but reads them from the BUILT
  // `dist/*.d.ts` — the surface a consumer's import actually resolves to, which
  // is the only place the defect is visible (#4171). So the `readsDist` caveat
  // above applies to it even though there is nothing to regenerate.
  {
    check: 'check:exported-any',
    why: 'audits the built .d.ts for exported types/schemas that resolve to `any` — no artifact (needs a fresh `pnpm build`)',
  },
  // Reads the built dist like exported-any. Its baseline
  // (dual-source-exports.baseline.json) is a shrink-only ledger edited by hand
  // under review — deliberately NOT a generated artifact, because a `gen:` that
  // rewrites it would admit a new dual-source via "run the fix command" instead
  // of via a maintainer decision (#4446).
  {
    check: 'check:dual-source-exports',
    why: 'audits the built .d.ts for same-name exports resolving to DIFFERENT declarations across entry points — baseline is hand-ratcheted, not generated (needs a fresh `pnpm build`)',
  },
  // #11986, chartered by the 2026-08-25 ruling on #11709. Reads the built dist
  // like the two above, and for the same reason: the defect is only visible in
  // the declarations a CONSUMER resolves to through the `exports` map.
  //
  // NO_GENERATOR, and the classification is the safety property rather than
  // bookkeeping — `check:dual-source-exports`'s reason, one surface over.
  // `entry-nameability.baseline.json` is a hand-ratcheted accommodation ledger,
  // and the `gen:` a reader would reach for — rewrite it from whatever the tree
  // currently leaks — is the one operation it must never offer: it would admit
  // the eighth leak by running a command, which is exactly the per-name
  // whack-a-mole this gate was filed to end. A failure here is a re-export to
  // write (or a ledger row to delete), never a command to run.
  {
    check: 'check:entry-nameability',
    why: "audits the built .d.ts: a type structurally mentioned in the declaration emitted for a consumer that CALLS one of an entry's exported functions must be nameable from that same entry — the ledger is hand-ratcheted and closed to new rows, not generated (needs a fresh `pnpm build`)",
  },
  // #10199, the mechanized form of the 2026-08-20 ruling on #10096. Reads the
  // built dist like the two above, but the BUNDLES rather than the declarations
  // — it walks the module graph a consumer's import actually loads and asserts a
  // declared browser-reachable entry links no zod.
  //
  // NO_GENERATOR and not GATED, for `check:dual-source-exports`'s reason exactly:
  // `browser-reachable-entries.json` is a hand-maintained CONTRACT, not a
  // projection of the source. A `gen:` that rewrote it would grant
  // browser-reachability by running a command — which is the one decision the
  // ruling reserves for a maintainer — and, in the other direction, would
  // "repair" a violation by silently demoting the entry that broke its promise.
  {
    check: 'check:browser-reachable-entries',
    why: 'audits the built .mjs/.js bundles: a declared browser-reachable entry must link no zod in its module graph — the declared list is a hand-written contract, not generated (needs a fresh `pnpm build`)',
  },
  // Deliberately NOT beside `check:test-typecheck` in GATED above, and the
  // difference is the whole design of #5475: that gate compares a checked-in
  // artifact (test-typecheck-debt.json) against a fresh tsc run, so it has a
  // generator and a directional ratchet. This one has NEITHER — `scripts/**`
  // entered its program with zero ledger entries and is meant to stay there, so
  // there is no file to regenerate and no `--fix` that could make it green. A
  // failure here is always a code change.
  {
    check: 'check:scripts-typecheck',
    why: 'type-checks packages/spec/scripts/** (the generators and gate scripts themselves) under tsconfig.scripts.json — no artifact, and no debt ledger by design (#5475)',
  },
  // #10274. Audits this package's own PROSE: a read-point record that says
  // "`.objectui-sha` = `<sha>`" is asserting the pin this repo builds against,
  // and #10137 moved the pin under four such records without anything failing.
  //
  // NO_GENERATOR, and here the classification is the SAFETY PROPERTY rather than
  // a bookkeeping choice. The `gen:` a reader would reach for — rewrite each
  // cited sha to the pin file — is the one operation this gate must never offer:
  // the sha is not the record, the objectui file:line anchors beside it are, and
  // they are only true of the tree they were counted in. Regenerating the sha
  // alone would leave every record CLAIMING the current pin while its anchors
  // still described the old one, i.e. it would convert a loud "unverifiable" into
  // a silent lie. #10274 measured that as real, not theoretical: re-measuring the
  // four records found two anchors that had been wrong since they were written.
  // A failure here is always a re-measurement, never a command.
  {
    check: 'check:objectui-pin-citations',
    why: 'audits spec source prose: a citation in the asserting spelling (`.objectui-sha` = `<sha>`) must equal the root pin file — no artifact, and deliberately no `gen:`, because rewriting the sha without re-measuring the anchors beside it is the failure mode (#10274)',
  },
  // #11344. The nearest sibling to `check:objectui-pin-citations` above, and
  // classified NO_GENERATOR for the same reason rather than for a bookkeeping
  // one. `llms.txt` is hand-kept prose that SHIPS in the tarball (`files`), and
  // the obvious `gen:` — restamp each count, drop each dead symbol — is the one
  // operation that must never be offered: the number is not the claim, the
  // sentence beside it is. Restamping `| integration | 7 | Connector (Database,
  // File Storage, GitHub, MQ, SaaS, Vercel) |` to `1` would leave a freshly
  // dated row listing six connectors that do not exist, converting a loud
  // staleness into a silent lie. A failure here is a re-read of the section.
  {
    check: 'check:llms-txt',
    why: 'audits the shipped llms.txt: every advertised symbol must resolve against api-surface/, every `@objectstack/spec/x` against the manifest `exports`, and every declared count against src/ and the workspace — no artifact, and deliberately no `gen:`, because restamping a count without re-reading the prose beside it is the failure mode (#11344)',
  },
];

/**
 * Source audits THIS AGGREGATE cannot run, because each needs an input handed to
 * it on the command line and this aggregate hands none over. That, and only that,
 * is the claim — ⛔ NOT that the input is unavailable here: for the entry below it
 * is TRACKED in this repo and CI feeds it to the gate on every PR (that entry's
 * `why` carries the reading).
 *
 * A separate bucket from `NO_GENERATOR` because the two say different things to a
 * reader, and #4690 is what conflating them cost. `NO_GENERATOR` means "runnable
 * as it stands, deliberately not run in this aggregate — run it yourself and it
 * will answer". This one means "running it takes an input this aggregate does not
 * pass, so here is that input and who does pass it" — still runnable by hand, and
 * the `why` says with what. Sitting in the first list, `check:react-declaration-parity`
 * read as the former for the entire time it was the latter: it was wired into no
 * workflow, and a manual run without `MANIFEST` printed a `⚠` and exited 0, so no
 * path existed on which the gate could go red. Whoever read "deliberately not run"
 * reasonably assumed someone, somewhere, was running it.
 *
 * Encoding WHY in the ledger follows EXPLICIT_GENERATORS (#5807/#5358): a
 * classification that records only a name is a classification the next reader has
 * to re-derive. `runBy` is what keeps this bucket honest rather than an escape
 * hatch — it names the in-repo entry point that DOES run the gate with its input,
 * and `reconcileLedger` fails if that file has stopped naming the check. "Cannot
 * run here" is a statement about this aggregate; "runs nowhere" would be the defect
 * this category is supposed to make visible, not hide.
 */
const EXTERNAL_INPUT_REQUIRED: ReadonlyArray<{
  check: string;
  input: string;
  runBy: string;
  why: string;
}> = [
  {
    check: 'check:react-declaration-parity',
    input: 'MANIFEST=<sdui.manifest.json> — objectui\'s registry-inputs dump',
    runBy: 'scripts/gen-sdui-manifest.sh',
    why:
      'compares the spec schema props against the registry-declared inputs (two declarations, no renderer: #4472). ' +
      'It reads its manifest from MANIFEST=<path> and THIS AGGREGATE PASSES NONE — that, and only that, is what ' +
      '"cannot run here" means for this entry. The input is NOT unavailable in the repo: since #13446 a dump is ' +
      'TRACKED at the repo root as sdui.manifest.json, and lint.yml runs the gate --strict against it on every PR ' +
      '(MANIFEST="$PWD/sdui.manifest.json"), so the gate is neither unrun nor unrunnable — it is unrun BY THIS ' +
      'AGGREGATE. Nor does producing one require a browser: scripts/gen-sdui-manifest-node.mjs regenerates the ' +
      'tracked artefact under plain Node from the PUBLISHED @object-ui/* packages (the browser-only claim was ' +
      'measured false on 2026-08-29, re-measured 2026-08-30 against published 17.6.0, and reproduced ' +
      'byte-identically in review of #18608), and scripts/check-sdui-manifest.mjs holds artefact, record and pin ' +
      'together. `pnpm sdui:manifest` (runBy) is the other producer, and it does NOT build objectui: it REQUIRES ' +
      'a checkout already vendored at .cache/objectui-<sha> by `pnpm objectui:build`, exits 1 telling you to run ' +
      'that first (gen-sdui-manifest.sh 507-516), then serves that tree with a vite dev server and dumps the ' +
      'registry from a real browser, running this ratchet against THAT. ⚠️ The two producers read two ' +
      'different registries — published packages vs the pinned checkout\'s source — and do not agree today (#17735). ' +
      'Without a MANIFEST the gate exits 1 rather than skipping (#4690)',
  },
];

/**
 * Generators whose output NOTHING verifies. Recorded rather than ignored: each
 * one is an artifact that can silently drift from its source, which is the class
 * every gate above exists to prevent. Adding a gate for either is a real
 * follow-up, not a formality.
 */
const UNGATED_GENERATORS: ReadonlyArray<{ gen: string; why: string }> = [
  // The `why` used to read "no check gate compares it to the routes". Since
  // #5744 that names a reconciliation with no second party: the document
  // carries no route section at all — built-in routes are produced at serve
  // time by the package that mounts them (#5588 ruling C, #5078, ADR-0076), so
  // there is nothing here to compare against a route table. Coherence is
  // covered (the generator self-checks before writing, #5168); currency this
  // aggregate still does not verify. #5757 measured what that omission costs
  // and the answer was nothing — staleness here is unreachable, not merely
  // unpunished — so "add a gate" was ruled not planned. The `why` carries the
  // measurement so the next reader does not re-file it.
  {
    gen: 'gen:openapi',
    why:
      'nothing here compares the document\'s components.schemas against src/api — but per the #5757 ' +
      'measurement a stale artifact is not merely unpunished, it is unreachable on every canonical path. ' +
      'Staleness cannot outlive one build of this package: `json-schema/**` is a turbo build OUTPUT and is ' +
      'gitignored, so it is never a task input; `build` declares no `inputs`, so it hashes every git-tracked ' +
      'file in the package; and everything this generator reads sits in there (the `src/**` closure reached ' +
      'through `src/api`, these scripts, the manifest). That input surface is a SUBSET of the build task\'s, ' +
      'so any edit able to make the artifact stale is exactly the edit that busts the cache — and `build` ' +
      'runs the generator unconditionally (`gen:schema && gen:openapi && tsup`). Deleting the artifact does ' +
      'not even bust the cache: the next build restores it byte-identically (measured, FULL TURBO). What a ' +
      'stale copy could mislead is bounded too — the served document holds 0 $refs into components.schemas, ' +
      'leaving the nine contract schemas an unreferenced island (#6797). It IS self-checked for coherence at ' +
      'write time (#5168), and since #5744 it describes no routes to reconcile. Gating it would also be ' +
      'dormant: CI runs this aggregate only as `--reconcile-only` (lint.yml), and a full run sits after ' +
      '`pnpm build` — green by construction, the #4177/#4232 class.',
  },
  { gen: 'gen:sbom', why: 'the SBOM is a release artifact, regenerated at publish time rather than checked in' },
];

/**
 * Generators that are DELIBERATE, manual-only acts. Their artifact **is** gated —
 * `gatedBy` names the gate — so `UNGATED_GENERATORS` would be a false
 * classification in one direction; but a `GATED` entry would be false in the
 * other, because `--fix` may not run them and "stale" is not a defect for them.
 *
 * The distinction is `authorable-surface.base.json`, and it is the whole of
 * #5358. That file is not a projection of this package's source — it is a
 * snapshot of an UPSTREAM commit, the baseline the #4650 deletion gate compares
 * against precisely because the commit under test cannot rewrite it. Its gate
 * proves it AUTHENTIC (`baseRev` on origin/main, keys matching that commit), never
 * current, so lag is expected and green. While `gen:schema` refreshed it as a side
 * effect, any build of any package with spec in its dependency closure moved the
 * gate's baseline in the developer's worktree, and a `git add -A` carried the move
 * into an unrelated PR — observed three times (#4990, #5155, #5660), once at
 * −110 keys covering a retirement that had just landed.
 */
const EXPLICIT_GENERATORS: ReadonlyArray<{ gen: string; gatedBy: string; why: string }> = [
  {
    gen: 'gen:authorable-surface-base',
    gatedBy: 'check:authorable-surface',
    why: 're-anchors authorable-surface.base.json to the git-resolved baseline — a deliberate act with its own reviewed diff, never a build side effect (#5358)',
  },
];

/** This aggregate itself — a `check:` script that gates nothing of its own. */
const SELF = 'check:generated';

/**
 * Reconcile the ledgers above against `package.json` — in BOTH directions, on
 * every run rather than behind a `--self-test` flag, because the failure this
 * prevents is a gate quietly dropping out of coverage. A gate absent from both
 * lists would simply never run here, and the summary would still say "all
 * artifacts up to date" — the exact shape of lie this script exists to remove.
 *
 * It works: the very first run rejected this script's own `package.json` entry
 * as unclassified, before it had checked a single artifact.
 */
function reconcileLedger(scripts: Record<string, string>): string[] {
  const problems: string[] = [];
  const declaredChecks = new Set([
    ...GATED.map((g) => g.check),
    ...NO_GENERATOR.map((n) => n.check),
    ...EXTERNAL_INPUT_REQUIRED.map((e) => e.check),
  ]);
  const declaredGens = new Set([
    ...GATED.map((g) => g.gen),
    ...UNGATED_GENERATORS.map((u) => u.gen),
    ...EXPLICIT_GENERATORS.map((e) => e.gen),
  ]);

  for (const name of Object.keys(scripts)) {
    if (name === SELF) continue;
    if (name.startsWith('check:') && !declaredChecks.has(name)) {
      problems.push(`  \`${name}\` exists in package.json but is in neither GATED nor NO_GENERATOR (nor EXTERNAL_INPUT_REQUIRED).\n` +
        `    Classify it: does it compare a checked-in artifact against a generator, audit source,\n` +
        `    or audit source against an input THIS AGGREGATE does not pass (name who does pass it)?`);
    }
    if (name.startsWith('gen:') && !declaredGens.has(name)) {
      problems.push(`  \`${name}\` exists in package.json but no GATED entry names it and it is not in UNGATED_GENERATORS.\n` +
        `    Either wire its gate in, record why its output is unverified, or — if it is a\n` +
        `    deliberate manual-only re-anchoring whose artifact another gate already verifies —\n` +
        `    declare it in EXPLICIT_GENERATORS with the gate that covers it.`);
    }
  }
  for (const { check } of GATED) if (!scripts[check]) problems.push(`  GATED names \`${check}\`, which package.json no longer has.`);
  for (const { gen } of GATED) if (!scripts[gen]) problems.push(`  GATED names \`${gen}\`, which package.json no longer has.`);
  for (const { check } of NO_GENERATOR) if (!scripts[check]) problems.push(`  NO_GENERATOR names \`${check}\`, which package.json no longer has.`);
  for (const { check, runBy } of EXTERNAL_INPUT_REQUIRED) {
    if (!scripts[check]) problems.push(`  EXTERNAL_INPUT_REQUIRED names \`${check}\`, which package.json no longer has.`);
    // The claim that makes this category honest rather than an escape hatch: the
    // gate cannot run HERE, but it does run SOMEWHERE, and that somewhere is a file
    // in this repo that still invokes it. A `runBy` that has stopped naming the
    // check is #4690 all over again — a gate classified as "runs elsewhere" while
    // running nowhere.
    const runner = join(pkgRoot, '..', '..', runBy);
    // Named on a line that RUNS it, not merely one that talks about it: these
    // runners are shell scripts whose comments discuss the gate at length, and a
    // surviving comment is exactly the evidence a deleted invocation leaves behind.
    const invokes = existsSync(runner) &&
      readFileSync(runner, 'utf8')
        .split('\n')
        .some((line) => line.includes(check) && !line.trim().startsWith('#'));
    if (!existsSync(runner)) {
      problems.push(`  EXTERNAL_INPUT_REQUIRED says \`${check}\` runs via \`${runBy}\`, which does not exist.`);
    } else if (!invokes) {
      problems.push(
        `  EXTERNAL_INPUT_REQUIRED says \`${check}\` runs via \`${runBy}\`, which no longer invokes it.\n` +
          `    Either restore the call or reclassify: a gate that runs nowhere is the hole this category records (#4690).`,
      );
    }
  }
  for (const { gen } of UNGATED_GENERATORS) if (!scripts[gen]) problems.push(`  UNGATED_GENERATORS names \`${gen}\`, which package.json no longer has.`);
  for (const { gen, gatedBy } of EXPLICIT_GENERATORS) {
    if (!scripts[gen]) problems.push(`  EXPLICIT_GENERATORS names \`${gen}\`, which package.json no longer has.`);
    // The claim that makes this category honest rather than an escape hatch: the
    // artifact IS covered. A `gatedBy` naming a gate this ledger does not run
    // would be a coverage hole wearing a classification's clothes.
    if (!declaredChecks.has(gatedBy)) {
      problems.push(
        `  EXPLICIT_GENERATORS says \`${gen}\` is gated by \`${gatedBy}\`, which this ledger does not declare.\n` +
          `    An explicit generator is only "covered" if some gate here verifies its artifact.`,
      );
    }
  }

  // ── A declared input dependency must actually be satisfiable HERE (#4723) ──
  //
  // `readsSchemaTree` says "this gate renders from packages/spec/json-schema/,
  // which that gate generates". Both halves have to hold, and the second one is
  // an ORDER, which an array literal expresses by accident. Left unchecked, a
  // later reader tidying this list alphabetically would move `check:docs` above
  // its producer and turn it into a gate reporting on the previous run's tree —
  // green or red for reasons unrelated to the commit, with nothing saying so.
  //
  // Cheap to state, so it is stated: the producer must be in this list, and it
  // must run first. (Belt and braces, not belt alone: `build-docs.ts` refuses on a
  // stale tree no matter who invoked it. This is the half that keeps the ORDER
  // honest so the refusal never has to fire.)
  for (const [i, entry] of GATED.entries()) {
    if (!entry.readsSchemaTree) continue;
    const producer = GATED.findIndex((g) => g.check === entry.readsSchemaTree);
    if (producer < 0) {
      problems.push(
        `  GATED says \`${entry.check}\` reads the json-schema/ tree produced by \`${entry.readsSchemaTree}\`,\n` +
          `    which this ledger does not run. Name a gate that IS run here, or the tree is\n` +
          `    whatever the last unrelated command left on disk (#4723).`,
      );
    } else if (producer > i) {
      problems.push(
        `  GATED runs \`${entry.check}\` (position ${i + 1}) BEFORE its declared producer\n` +
          `    \`${entry.readsSchemaTree}\` (position ${producer + 1}). packages/spec/json-schema/ is\n` +
          `    gitignored, so on that order this gate reads whatever tree happened to be on disk.\n` +
          `    Move the producer above it.`,
      );
    }
  }

  return problems;
}
/* ───────────────────────────────────────────────────────────────────────────
 * The effects this aggregate performs, named in one interface.
 *
 * Extracted for one reason: the behaviour ruled on #19086 is an ORDER between
 * effects — build, then measure, then write, then re-measure — and an order is
 * only pinnable if a test can watch the effects happen. Driving the real
 * orchestration against a fixture world is what lets
 * `check-generated-fix-rebuild.pin.test.ts` reproduce the two dist states this
 * command was measured writing from (an entry declaration missing two exports;
 * two of the emitted chunk declarations absent) in milliseconds instead of the
 * ~3 minutes a real `packages/spec` build costs.
 *
 * ⛔ It is not a seam for production behaviour to vary through: `realIO` below
 * is the only implementation this file ever runs with, and the entry point at
 * the bottom is the only place that chooses one.
 */
export interface CheckGeneratedIO {
  /** Run one of this package's own npm scripts, capturing its output. */
  run(script: string): { ok: boolean; output: string };
  /** `distIsStale()` — consulted only as a floor, after the forced build. */
  distIsStale(): boolean;
  /**
   * The provenance clause plus its detail lines: WHICH dist the dist-reading
   * gates were decided against, and whether this invocation built it. The first
   * element is a clause meant to be appended to a sentence; the rest are lines.
   */
  distEvidence(builtByThisRun: boolean, buildMs: number | null): string[];
  log(line: string): void;
  error(line: string): void;
}

/**
 * This package's own `build` script — `gen:schema && gen:openapi && tsup &&
 * <declaration pass> && …`. It never invokes turbo, so there is no cache to
 * hit: running it IS a forced build of this package, which is what the #19086
 * ruling requires of the write path.
 */
const SPEC_BUILD = 'build';

/** Every `.d.ts` under `dir`, with the newest mtime among them. */
function declarationFiles(dir: string, depth = 0): { files: number; newest: number } {
  if (depth > 12 || !existsSync(dir)) return { files: 0, newest: 0 };
  let files = 0;
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const sub = declarationFiles(p, depth + 1);
      files += sub.files;
      newest = Math.max(newest, sub.newest);
    } else if (e.name.endsWith('.d.ts')) {
      files++;
      newest = Math.max(newest, statSync(p).mtimeMs);
    }
  }
  return { files, newest };
}

/**
 * Name the dist this run's verdicts were taken against — the reporting half of
 * the #19086 ruling.
 *
 * The line it feeds used to read 「All N generated artifacts are up to date.」
 * and stop there, while one of those N (`check:api-surface`) had been decided
 * against a built tree whose correspondence to `src/` the run never measured
 * and never mentioned. That is the whole indictment on that card: a green from
 * an instrument that never looked is indistinguishable, downstream, from a
 * green from one that did — and a void reading from this instrument was quoted
 * as evidence in a revert decision before anyone noticed it was void.
 *
 * ⛔ The stamp is reported, never leaned on. `declarationStamp` hashes the
 * build's INPUTS, so it reads `match` over a dist whose own files were
 * truncated, hand-edited or only partly emitted — both reproducers on that card
 * are exactly that state. It is printed here to IDENTIFY the tree, not to
 * vouch for it; what vouches for it is `builtByThisRun`, and nothing else can.
 */
export function distEvidence(specDir: string, builtByThisRun: boolean, buildMs: number | null): string[] {
  const distDir = join(specDir, 'dist');
  const label = specDir === pkgRoot ? 'packages/spec/dist' : distDir;
  const readers = GATED.filter((g) => g.readsDist).map((g) => g.check);
  const readBy = readers.length ? `read by ${readers.length} gate(s) here: ${readers.join(', ')}` : 'no gate here reads it';
  const { files, newest } = declarationFiles(distDir);

  if (!files) {
    return [
      `measured against NO declarations at all — ${label} holds no .d.ts (${readBy})`,
      `    Every dist-reading verdict above is about a tree that is not there.`,
      `    pnpm --filter @objectstack/spec build`,
    ];
  }

  const stamp = declarationStamp(specDir);
  const digest = stamp.recorded ? ` (${stamp.recorded.slice(0, 12)}…)` : '';
  const lines = [
    builtByThisRun
      ? `measured against ${label}, BUILT BY THIS RUN${buildMs === null ? '' : ` in ${(buildMs / 1000).toFixed(0)}s`}`
      : `measured against ${label} AS FOUND ON DISK — this run did not build it`,
    `    ${files} .d.ts, newest ${new Date(newest).toISOString()}; declaration stamp ${stamp.state}${digest}; ${readBy}.`,
  ];
  if (!builtByThisRun) {
    lines.push(
      `    ⚠ that stamp hashes the build's INPUTS, never the emitted files, so it cannot see a dist`,
      `      whose own contents were truncated, hand-edited or only partly emitted — the state both`,
      `      of #19086's reproducers are in. For a verdict taken against a dist this command built,`,
      `      run --fix (it rebuilds first) or \`pnpm --filter @objectstack/spec build\` and re-run.`,
    );
  }
  return lines;
}

function runScript(script: string): { ok: boolean; output: string } {
  const env = { ...process.env };
  // The forced build must EMIT DECLARATIONS. `OS_SKIP_DTS=1` is the documented
  // fast local build and it skips the declaration pass outright, so a build
  // inherited under it would leave precisely the dist this command exists to
  // stop writing from — and would leave it looking freshly built. Stripped for
  // the build alone; every gate keeps the caller's environment.
  if (script === SPEC_BUILD) delete env.OS_SKIP_DTS;
  try {
    const output = execSync(`pnpm -s ${script}`, { cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    return { ok: true, output };
  } catch (err: any) {
    return { ok: false, output: `${err?.stdout?.toString() ?? ''}${err?.stderr?.toString() ?? ''}`.trim() };
  }
}

/** The one implementation this command ever runs with. */
export const realIO: CheckGeneratedIO = {
  run: runScript,
  distIsStale: () => distIsStale(),
  distEvidence: (builtByThisRun, buildMs) => distEvidence(pkgRoot, builtByThisRun, buildMs),
  log: (line) => console.log(line),
  error: (line) => console.error(line),
};

/** @returns the process exit code. */
export function checkGenerated(
  argv: readonly string[],
  scripts: Record<string, string>,
  io: CheckGeneratedIO,
): number {
  const fix = argv.includes('--fix');
  // CI mode (#4203): reconcile and stop — no gates. The reconciliation above only
  // ever ran where this aggregate ran, which was locally: CI runs the gates as
  // individual steps, so an unclassified `check:`/`gen:` script kept every CI gate
  // green while this wrapper exited red on `main` before running a single gate.
  // Twice in three days — #4177 (fixed only by colliding with #4194) and #4232
  // (caught wiring this flag in). It could not go in ci.yml's `check-generated`
  // job: that job was gated on a `generated` paths filter that never watched
  // packages/spec/package.json, the one file every offending PR must touch, so
  // both offenders skipped it entirely. #4291 deleted that job and its filter and
  // moved every gate to lint.yml's unfiltered, required "TypeScript Type Check"
  // job, which runs this mode too. Reads package.json and the arrays above; <1s.
  const reconcileOnly = argv.includes('--reconcile-only');

  const problems = reconcileLedger(scripts);
  if (problems.length) {
    io.error(`✗ check:generated ledger is out of sync with package.json:\n\n${problems.join('\n')}\n`);
    return 1;
  }

  if (reconcileOnly) {
    const checks = Object.keys(scripts).filter((n) => n.startsWith('check:')).length;
    const gens = Object.keys(scripts).filter((n) => n.startsWith('gen:')).length;
    io.log(
      `✓ check:generated ledger reconciles with package.json: ${checks} check: + ${gens} gen: scripts, ` +
        `all classified (${GATED.length} gated, ${NO_GENERATOR.length} source audits, ` +
        `${EXTERNAL_INPUT_REQUIRED.length} needing an external input, ` +
        `${UNGATED_GENERATORS.length} ungated generators, ${EXPLICIT_GENERATORS.length} explicit ` +
        `manual-only generators, 1 aggregate).\n` +
        // Named, not just counted: this bucket's whole reason for existing is that a
        // bare count is what let #4690 read as "someone runs it".
        EXTERNAL_INPUT_REQUIRED.map(
          (e) => `  ⚠ cannot run here: ${e.check} — needs ${e.input}; runs in ${e.runBy}.\n`,
        ).join('') +
        // Named for the same reason as the bucket above: an ordering constraint
        // nobody can see is one a later tidy-up silently breaks (#4723).
        GATED.filter((g) => g.readsSchemaTree)
          .map((g) => `  ↳ ${g.check} renders from json-schema/, generated by ${g.readsSchemaTree} above it.\n`)
          .join('') +
        `  --reconcile-only: no gates were run — this verifies coverage, not artifacts.`,
    );
    return 0;
  }

  // ── #19086: --fix rebuilds what it writes from, before it measures anything ──
  //
  // The write path used to be gated on the ABSENCE OF AN ACCUSATION rather than
  // on positive proof. `distIsStale()` answers `fresh` the moment mtimes say
  // fresh, and any write to a dist file moves that file's mtime FORWARD, so the
  // whole class of damage where a dist stops describing `src` — an interrupted
  // declaration pass, a partly emitted chunk set, a hand-edit, a partial restore
  // — is by construction outside what that predicate can report. Measured twice
  // on this package: an entry declaration missing two names, and two of the 46
  // emitted chunk declarations absent, both reading `distIsStale=false` with the
  // declaration stamp at `match`, from which `--fix` wrote a baseline missing
  // live exports and exited 0.
  //
  // So the guard is no longer a predicate. `--fix` BUILDS the dist it is about
  // to generate from, inside this invocation, and generates from that — positive
  // proof by construction. The cost is one full build per `--fix`, which is the
  // 「Build first」 precondition this command's own documentation already
  // prescribes, made automatic rather than remembered.
  //
  // ⛔ The read-only path deliberately does NOT build: it is run on every CI lap
  // and by every reader who just wants the diagnosis, and a build there is a
  // cost on a path that writes nothing. What the read-only path owes instead is
  // to SAY which dist it looked at — `distEvidence` below.
  let buildMs: number | null = null;
  if (fix) {
    io.log(`--fix rebuilds what it writes from: forcing \`pnpm --filter @objectstack/spec ${SPEC_BUILD}\` first.`);
    io.log(`  One full build per --fix — the documented 「Build first」 precondition, made automatic.`);
    io.log(`  ⚠ that build runs gen:schema, so it also repairs authorable-surface/ and`);
    io.log(`    json-schema.manifest/ if they are behind — exactly as running it by hand would.\n`);
    const started = Date.now();
    const built = io.run(SPEC_BUILD);
    buildMs = Date.now() - started;
    if (!built.ok) {
      io.log(`  ✗ ${SPEC_BUILD} FAILED after ${(buildMs / 1000).toFixed(0)}s`);
      io.error(built.output.split('\n').filter(Boolean).slice(-8).map((l) => `      ${l}`).join('\n'));
      io.error(
        `\n      NOTHING was checked and NOTHING was written. Generating now would write from a\n` +
          `      dist this command could not produce, which is the one thing --fix must never do.\n` +
          `      Fix the build, then re-run.`,
      );
      return 1;
    }
    const [clause, ...detail] = io.distEvidence(true, buildMs);
    io.log(`  ✓ ${SPEC_BUILD} — ${clause}.`);
    for (const line of detail) io.log(line);
    // A floor, not the mechanism: the build exited 0, so the freshness predicate
    // must agree. If it does not, something emitted no declarations and every
    // verdict below would be about a tree nobody produced — refuse rather than
    // write into that.
    if (io.distIsStale()) {
      io.log(`  ✗ ${SPEC_BUILD} exited 0 and the dist still reads as stale`);
      io.error(
        `      The build reported success and packages/spec/dist is still missing or older than\n` +
          `      packages/spec/src. Nothing was written. Re-run the build by hand and read its output.`,
      );
      return 1;
    }
    io.log('');
  }

  io.log(`Checking ${GATED.length} generated artifacts (every gate runs — the first failure does not stop the rest).\n`);

  const stale: typeof GATED[number][] = [];
  for (const entry of GATED) {
    const { ok, output } = io.run(entry.check);
    io.log(`  ${ok ? '✓' : '✗'} ${entry.check.padEnd(26)} ${entry.artifact}`);
    if (!ok) {
      stale.push(entry);
      // The gates print their own prescription; surface it rather than paraphrasing.
      const detail = output.split('\n').filter(Boolean).slice(0, 3).map((l) => `      ${l}`).join('\n');
      if (detail) io.log(detail);
      if (entry.readsDist && !fix) {
        io.log(`      ⚠ this gate reads the BUILT dist, not the source — if you have not run`);
        io.log(`        \`pnpm --filter @objectstack/spec build\` since your last pull, the removals`);
        io.log(`        above are phantoms. Build first, then re-run, before regenerating.`);
      }
      if (entry.readsSchemaTree) {
        io.log(`      ℹ this gate renders from packages/spec/json-schema/, generated by`);
        io.log(`        \`${entry.readsSchemaTree}\` above. It no longer regenerates that tree itself —`);
        io.log(`        the first step that did also repaired two TRACKED projections (#4711, #4723).`);
      }
    }
  }

  // Narrowing is never silent: say what was deliberately not run.
  io.log(`\nNot run here (${NO_GENERATOR.length} source audits with no artifact to regenerate): ` +
    NO_GENERATOR.map((n) => n.check).join(', '));
  // Narrowing is never silent, part three — and this one is a different sentence:
  // "deliberately not run" invites the reader to run it AS IT STANDS, which for
  // these does not work: each needs an input on the command line that this
  // aggregate does not pass. Say what that input is and who does pass it, so the
  // reader can run it by hand — for the entry below the input is tracked here.
  if (EXTERNAL_INPUT_REQUIRED.length) {
    io.log(`Needs an input this aggregate does not pass (${EXTERNAL_INPUT_REQUIRED.length} source audit(s)):`);
    for (const e of EXTERNAL_INPUT_REQUIRED) {
      io.log(`  ${e.check} — needs ${e.input}\n    runs in ${e.runBy}; ${e.why}`);
    }
  }
  if (UNGATED_GENERATORS.length) {
    io.log(`Generated but ungated (${UNGATED_GENERATORS.length}): ` +
      UNGATED_GENERATORS.map((u) => u.gen).join(', ') + ' — nothing verifies these are current.');
  }
  // Narrowing is never silent, part two: --fix will not reach these, by design.
  if (EXPLICIT_GENERATORS.length) {
    io.log(`Explicit, manual-only (${EXPLICIT_GENERATORS.length}): ` +
      EXPLICIT_GENERATORS.map((e) => `${e.gen} (gated by ${e.gatedBy})`).join(', ') +
      ' — never run here or by --fix; their artifact may lag and still be green.');
  }

  if (!stale.length) {
    // #19086: the sentence names the tree it measured against. Unqualified, it
    // vouched for N artifacts of which one had been decided against a dist this
    // run never looked at.
    const [clause, ...detail] = io.distEvidence(fix, buildMs);
    io.log(`\n✓ All ${GATED.length} generated artifacts are up to date — ${clause}.`);
    for (const line of detail) io.log(line);
    return 0;
  }

  io.log(`\n✗ ${stale.length} of ${GATED.length} artifact(s) stale:\n`);
  for (const s of stale) {
    io.log(`  ${s.artifact}\n    pnpm --filter @objectstack/spec ${s.gen}` +
      (s.ratchet ? `   ← only if ${s.check} asked you to RE-RECORD; --fix will not run this one` : ''));
  }
  // The same sentence the pass path owes, owed here too: a red verdict taken
  // against an unmeasured dist is as unreadable as a green one.
  {
    const [clause, ...detail] = io.distEvidence(fix, buildMs);
    io.log(`\nThe verdicts above were ${clause}.`);
    for (const line of detail) io.log(line);
  }

  const autoFixable = stale.filter((s) => !s.ratchet);

  if (!fix) {
    io.log(`\nRegenerate exactly these:\n  ` +
      stale.map((s) => `pnpm --filter @objectstack/spec ${s.gen}`).join(' && '));
    io.log(
      autoFixable.length
        ? `\nOr re-run with --fix to do it now (only the ${autoFixable.length} proved stale — never the whole set` +
            (autoFixable.length < stale.length
              ? `, and never the ${stale.length - autoFixable.length} ratchet(s) above: read their verdict first).`
              : `). It rebuilds packages/spec first, so it writes from a dist it produced.`)
        : `\n--fix will not do this for you: every stale artifact above is a directional ratchet, ` +
            `and its gate already said which direction it moved.`,
    );
    return 1;
  }

  io.log(
    `\n--fix: regenerating ${autoFixable.length} of the ${stale.length} stale artifact(s)` +
      (autoFixable.length < stale.length ? ` — the rest are ratchets, refused below` : '') +
      `, from the dist built above. Review the diff before committing.\n`,
  );
  let failed = 0;
  const written: typeof GATED[number][] = [];
  for (const s of stale) {
    // A ratchet's gate has already answered the question --fix would have to guess:
    // it names, per file, whether the debt grew (fix the code) or shrank (re-record
    // the number). Regenerating on the first reading launders new debt in as a
    // mechanical diff — the same "admit it via the fix command" hazard that keeps
    // dual-source-exports.baseline.json out of GATED entirely (#4446). That ledger
    // can stay hand-edited because it holds a handful of rows; this one holds 79
    // files, so it ships a generator and puts the refusal here instead.
    if (s.ratchet) {
      failed++;
      io.log(`  ✗ ${s.gen} — REFUSED`);
      io.error(
        `      ${s.artifact} is a directional debt ledger, not a snapshot of the source.\n`
          + `      "the debt shrank — re-record it" and "the debt grew — fix the new errors" both\n`
          + `      reach --fix as one stale artifact, and only ${s.check} knows which it was.\n`
          + `      Read its per-file verdict; if re-recording is what it asked for, run:\n`
          + `      pnpm --filter @objectstack/spec ${s.gen}`,
      );
      continue;
    }
    // A FLOOR under the forced build above, no longer the guard (#19086). It was
    // the guard once, and that is exactly what failed: `distIsStale()` acquits on
    // an mtime ordering, so the dist states this command was measured writing
    // wrong artifacts from all passed it. Reaching this line now means the build
    // reported success and the predicate still says stale, which the check after
    // the build has already refused on — kept so a future edit that moves or
    // weakens that check cannot let a stale dist reach a generator unremarked.
    // `readsSchemaTree` gets no refusal of its own here, deliberately. Its
    // generator (`build-docs.ts`) carries the guard itself, so EVERY caller is
    // covered rather than this one — and by the time --fix runs, the producer gate
    // above has already rebuilt the tree from the sources under test, so the guard
    // is a backstop rather than the mechanism (#4723).
    if (s.readsDist && io.distIsStale()) {
      failed++;
      io.log(`  ✗ ${s.gen} — REFUSED`);
      io.error(
        `      packages/spec/dist is missing or older than packages/spec/src, after this run\n`
          + `      already forced a build of it. Regenerating now would write a surface describing\n`
          + `      a build that no longer exists.\n`
          + `      pnpm --filter @objectstack/spec build && pnpm --filter @objectstack/spec ${s.gen}`,
      );
      continue;
    }
    const { ok, output } = io.run(s.gen);
    io.log(`  ${ok ? '✓' : '✗'} ${s.gen}`);
    if (!ok) {
      failed++;
      io.error(output.split('\n').filter(Boolean).slice(0, 5).map((l) => `      ${l}`).join('\n'));
      continue;
    }
    written.push(s);
  }

  // ── #19086: a write is never its own only witness ──
  //
  // Until this ran, --fix exited on generator success and the NEXT `check:generated`
  // compared each artifact against the same dist that produced it — an agreement
  // that holds for any dist whatsoever, including one that describes nothing on
  // disk. So the green that followed a wrong write was structurally incapable of
  // contradicting it. Re-running each gate here does not make the write right; it
  // makes the run say whether the gate it was supposed to satisfy is satisfied.
  if (written.length) {
    io.log(`\n--fix: re-checking the ${written.length} artifact(s) just written — a write is not its own witness.`);
    for (const s of written) {
      const { ok, output } = io.run(s.check);
      io.log(`  ${ok ? '✓' : '✗'} ${s.check.padEnd(26)} ${s.artifact}`);
      if (!ok) {
        failed++;
        io.error(output.split('\n').filter(Boolean).slice(0, 5).map((l) => `      ${l}`).join('\n'));
        io.error(
          `      ${s.gen} ran and ${s.check} still fails. The artifact was written and the gate is\n`
            + `      NOT satisfied — read the verdict above rather than the write. Half of what this\n`
            + `      gate reports (a ledger row, an unclassified property, a rotted pointer) is never\n`
            + `      arithmetic its generator can repair.`,
        );
      }
    }
  }
  return failed ? 1 : 0;
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const scripts = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).scripts ?? {};
  process.exit(checkGenerated(process.argv.slice(2), scripts, realIO));
}
