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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// One staleness rule, shared with the merge driver's pre-commit half (#4675) —
// two copies of "is dist older than src" would drift, and the direction they
// drift in is the one that writes a wrong artifact.
import { distIsStale } from '../../../scripts/check-regen-pending.mjs';

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
  { check: 'check:spec-changes', gen: 'gen:spec-changes', artifact: 'spec-changes.json' },
  { check: 'check:upgrade-guide', gen: 'gen:upgrade-guide', artifact: 'docs/protocol-upgrade-guide.md' },
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
  { check: 'check:liveness', why: 'audits whether declared spec properties have a reader — no artifact' },
  { check: 'check:empty-state', why: 'audits empty-state coverage — no artifact' },
  { check: 'check:skill-examples', why: 'validates skill examples parse — no artifact' },
  // Landed in #4177 while this ledger landed in #4183 — neither PR could see the
  // other, so `main` carried an unclassified script and this reconciliation was
  // failing on `main` itself. The doc it checks against is hand-written, so there
  // is no generator to name.
  { check: 'check:variant-docs', why: 'audits that each schema variant appears in its hand-written doc — no artifact' },
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
];

/**
 * Source audits that CANNOT RUN from this repository at all, because the input
 * they compare against does not exist here and cannot be produced here.
 *
 * A separate bucket from `NO_GENERATOR` because the two say different things to a
 * reader, and #4690 is what conflating them cost. `NO_GENERATOR` means "runnable,
 * deliberately not run in this aggregate — run it yourself and it will answer".
 * This one means "you cannot run it here at all, and here is the input it wants
 * and who produces it". Sitting in the first list, `check:react-declaration-parity`
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
      'The registry is a browser app, so its manifest exists only after objectui is built at .objectui-sha and ' +
      'enumerated in a real browser — nothing in this repo (console dist is gitignored, the published console ships ' +
      'no sdui.manifest.json) can hand it one. `pnpm sdui:manifest` produces it and runs the ratchet; without it the ' +
      'gate now exits 1 rather than skipping (#4690)',
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
function reconcileLedger(scripts: Record<string, string>): void {
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
        `    or audit source against an input this repo cannot produce (name where it DOES run)?`);
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

  if (problems.length) {
    console.error(`✗ check:generated ledger is out of sync with package.json:\n\n${problems.join('\n')}\n`);
    process.exit(1);
  }
}

function run(script: string): { ok: boolean; output: string } {
  try {
    const output = execSync(`pnpm -s ${script}`, { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    return { ok: true, output };
  } catch (err: any) {
    return { ok: false, output: `${err?.stdout?.toString() ?? ''}${err?.stderr?.toString() ?? ''}`.trim() };
  }
}

const fix = process.argv.includes('--fix');
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
const reconcileOnly = process.argv.includes('--reconcile-only');
const scripts = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).scripts ?? {};
reconcileLedger(scripts);

if (reconcileOnly) {
  const checks = Object.keys(scripts).filter((n) => n.startsWith('check:')).length;
  const gens = Object.keys(scripts).filter((n) => n.startsWith('gen:')).length;
  console.log(
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
  process.exit(0);
}

console.log(`Checking ${GATED.length} generated artifacts (every gate runs — the first failure does not stop the rest).\n`);

const stale: typeof GATED[number][] = [];
for (const entry of GATED) {
  const { ok, output } = run(entry.check);
  console.log(`  ${ok ? '✓' : '✗'} ${entry.check.padEnd(26)} ${entry.artifact}`);
  if (!ok) {
    stale.push(entry);
    // The gates print their own prescription; surface it rather than paraphrasing.
    const detail = output.split('\n').filter(Boolean).slice(0, 3).map((l) => `      ${l}`).join('\n');
    if (detail) console.log(detail);
    if (entry.readsDist) {
      console.log(`      ⚠ this gate reads the BUILT dist, not the source — if you have not run`);
      console.log(`        \`pnpm --filter @objectstack/spec build\` since your last pull, the removals`);
      console.log(`        above are phantoms. Build first, then re-run, before regenerating.`);
    }
    if (entry.readsSchemaTree) {
      console.log(`      ℹ this gate renders from packages/spec/json-schema/, generated by`);
      console.log(`        \`${entry.readsSchemaTree}\` above. It no longer regenerates that tree itself —`);
      console.log(`        the first step that did also repaired two TRACKED projections (#4711, #4723).`);
    }
  }
}

// Narrowing is never silent: say what was deliberately not run.
console.log(`\nNot run here (${NO_GENERATOR.length} source audits with no artifact to regenerate): ` +
  NO_GENERATOR.map((n) => n.check).join(', '));
// Narrowing is never silent, part three — and this one is a different sentence:
// "deliberately not run" invites the reader to run it, which for these is not an
// option from this repo. Say what the missing input is and who supplies it.
if (EXTERNAL_INPUT_REQUIRED.length) {
  console.log(`Cannot run here (${EXTERNAL_INPUT_REQUIRED.length} source audit(s) whose input this repo cannot produce):`);
  for (const e of EXTERNAL_INPUT_REQUIRED) {
    console.log(`  ${e.check} — needs ${e.input}\n    runs in ${e.runBy}; ${e.why}`);
  }
}
if (UNGATED_GENERATORS.length) {
  console.log(`Generated but ungated (${UNGATED_GENERATORS.length}): ` +
    UNGATED_GENERATORS.map((u) => u.gen).join(', ') + ' — nothing verifies these are current.');
}
// Narrowing is never silent, part two: --fix will not reach these, by design.
if (EXPLICIT_GENERATORS.length) {
  console.log(`Explicit, manual-only (${EXPLICIT_GENERATORS.length}): ` +
    EXPLICIT_GENERATORS.map((e) => `${e.gen} (gated by ${e.gatedBy})`).join(', ') +
    ' — never run here or by --fix; their artifact may lag and still be green.');
}

if (!stale.length) {
  console.log(`\n✓ All ${GATED.length} generated artifacts are up to date.`);
  process.exit(0);
}

console.log(`\n✗ ${stale.length} of ${GATED.length} artifact(s) stale:\n`);
for (const s of stale) {
  console.log(`  ${s.artifact}\n    pnpm --filter @objectstack/spec ${s.gen}` +
    (s.ratchet ? `   ← only if ${s.check} asked you to RE-RECORD; --fix will not run this one` : ''));
}

const autoFixable = stale.filter((s) => !s.ratchet);

if (!fix) {
  console.log(`\nRegenerate exactly these:\n  ` +
    stale.map((s) => `pnpm --filter @objectstack/spec ${s.gen}`).join(' && '));
  console.log(
    autoFixable.length
      ? `\nOr re-run with --fix to do it now (only the ${autoFixable.length} proved stale — never the whole set` +
          (autoFixable.length < stale.length
            ? `, and never the ${stale.length - autoFixable.length} ratchet(s) above: read their verdict first).`
            : `).`)
      : `\n--fix will not do this for you: every stale artifact above is a directional ratchet, ` +
          `and its gate already said which direction it moved.`,
  );
  process.exit(1);
}

console.log(
  `\n--fix: regenerating ${autoFixable.length} of the ${stale.length} stale artifact(s)` +
    (autoFixable.length < stale.length ? ` — the rest are ratchets, refused below` : '') +
    `. Review the diff before committing.\n`,
);
let failed = 0;
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
    console.log(`  ✗ ${s.gen} — REFUSED`);
    console.error(
      `      ${s.artifact} is a directional debt ledger, not a snapshot of the source.\n`
        + `      "the debt shrank — re-record it" and "the debt grew — fix the new errors" both\n`
        + `      reach --fix as one stale artifact, and only ${s.check} knows which it was.\n`
        + `      Read its per-file verdict; if re-recording is what it asked for, run:\n`
        + `      pnpm --filter @objectstack/spec ${s.gen}`,
    );
    continue;
  }
  // The `readsDist` warning above is advice a reader can ignore; here it must
  // become a refusal. `gen:api-surface` on a stale dist does not fail — it
  // writes a plausible surface with every export added since the last build
  // missing, and `gen:docs` then ratchets a baseline exemption in to cover the
  // hole. That landed unnoticed on #4687 and was caught only by diffing the
  // generated files against `main`. --fix is the one path that WRITES, so it is
  // the one place the trap is unsurvivable: a visible conflict is recoverable,
  // a confidently wrong artifact is not (#4675).
  // `readsSchemaTree` gets no refusal of its own here, deliberately. Its
  // generator (`build-docs.ts`) carries the guard itself, so EVERY caller is
  // covered rather than this one — and by the time --fix runs, the producer gate
  // above has already rebuilt the tree from the sources under test, so the guard
  // is a backstop rather than the mechanism (#4723).
  if (s.readsDist && distIsStale()) {
    failed++;
    console.log(`  ✗ ${s.gen} — REFUSED`);
    console.error(
      `      packages/spec/dist is missing or older than packages/spec/src.\n`
        + `      Regenerating now would write a surface describing a build that no longer exists.\n`
        + `      pnpm --filter @objectstack/spec build && pnpm --filter @objectstack/spec ${s.gen}`,
    );
    continue;
  }
  const { ok, output } = run(s.gen);
  console.log(`  ${ok ? '✓' : '✗'} ${s.gen}`);
  if (!ok) {
    failed++;
    console.error(output.split('\n').filter(Boolean).slice(0, 5).map((l) => `      ${l}`).join('\n'));
  }
}
process.exit(failed ? 1 : 0);
