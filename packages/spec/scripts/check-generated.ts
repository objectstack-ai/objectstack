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
 * proved stale, and says so.
 *
 * Usage:
 *   pnpm --filter @objectstack/spec check:generated          # report every stale artifact
 *   pnpm --filter @objectstack/spec check:generated --fix    # + regenerate exactly those
 *   pnpm --filter @objectstack/spec check:generated --reconcile-only   # ledger audit only, no gates (CI)
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
 */
const GATED: ReadonlyArray<{ check: string; gen: string; artifact: string; readsDist?: true }> = [
  { check: 'check:spec-changes', gen: 'gen:spec-changes', artifact: 'spec-changes.json' },
  { check: 'check:upgrade-guide', gen: 'gen:upgrade-guide', artifact: 'docs/protocol-upgrade-guide.md' },
  { check: 'check:skill-docs', gen: 'gen:skill-docs', artifact: 'skill docs (from SKILL.md frontmatter)' },
  { check: 'check:skill-refs', gen: 'gen:skill-refs', artifact: 'skill references' },
  { check: 'check:react-blocks', gen: 'gen:react-blocks', artifact: 'react-blocks contract' },
  { check: 'check:authorable-surface', gen: 'gen:schema', artifact: 'authorable-surface.json + JSON schemas' },
  // Reads the BUILT `dist/*.d.ts`, not the source. On a stale dist it reports
  // every export added since the last build as a "breaking removal" — a phantom
  // that has cost real triage time (AGENTS.md records the trap). Flagged so the
  // failure explains itself instead of sending the next reader after a ghost.
  { check: 'check:api-surface', gen: 'gen:api-surface', artifact: 'api-surface.json', readsDist: true },
  { check: 'check:docs', gen: 'gen:docs', artifact: 'content/docs/references/**' },
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
  {
    check: 'check:react-declaration-parity',
    why: 'compares the spec schema props against the registry-declared inputs — two declarations, no artifact (and no renderer: #4472)',
  },
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
];

/**
 * Generators whose output NOTHING verifies. Recorded rather than ignored: each
 * one is an artifact that can silently drift from its source, which is the class
 * every gate above exists to prevent. Adding a gate for either is a real
 * follow-up, not a formality.
 */
const UNGATED_GENERATORS: ReadonlyArray<{ gen: string; why: string }> = [
  { gen: 'gen:openapi', why: 'the OpenAPI document is generated but no check gate compares it to the routes' },
  { gen: 'gen:sbom', why: 'the SBOM is a release artifact, regenerated at publish time rather than checked in' },
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
  const declaredChecks = new Set([...GATED.map((g) => g.check), ...NO_GENERATOR.map((n) => n.check)]);
  const declaredGens = new Set([...GATED.map((g) => g.gen), ...UNGATED_GENERATORS.map((u) => u.gen)]);

  for (const name of Object.keys(scripts)) {
    if (name === SELF) continue;
    if (name.startsWith('check:') && !declaredChecks.has(name)) {
      problems.push(`  \`${name}\` exists in package.json but is in neither GATED nor NO_GENERATOR.\n` +
        `    Classify it: does it compare a checked-in artifact against a generator, or audit source?`);
    }
    if (name.startsWith('gen:') && !declaredGens.has(name)) {
      problems.push(`  \`${name}\` exists in package.json but no GATED entry names it and it is not in UNGATED_GENERATORS.\n` +
        `    Either wire its gate in, or record why its output is unverified.`);
    }
  }
  for (const { check } of GATED) if (!scripts[check]) problems.push(`  GATED names \`${check}\`, which package.json no longer has.`);
  for (const { gen } of GATED) if (!scripts[gen]) problems.push(`  GATED names \`${gen}\`, which package.json no longer has.`);
  for (const { check } of NO_GENERATOR) if (!scripts[check]) problems.push(`  NO_GENERATOR names \`${check}\`, which package.json no longer has.`);
  for (const { gen } of UNGATED_GENERATORS) if (!scripts[gen]) problems.push(`  UNGATED_GENERATORS names \`${gen}\`, which package.json no longer has.`);

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
      `${UNGATED_GENERATORS.length} ungated generators, 1 aggregate).\n` +
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
  }
}

// Narrowing is never silent: say what was deliberately not run.
console.log(`\nNot run here (${NO_GENERATOR.length} source audits with no artifact to regenerate): ` +
  NO_GENERATOR.map((n) => n.check).join(', '));
if (UNGATED_GENERATORS.length) {
  console.log(`Generated but ungated (${UNGATED_GENERATORS.length}): ` +
    UNGATED_GENERATORS.map((u) => u.gen).join(', ') + ' — nothing verifies these are current.');
}

if (!stale.length) {
  console.log(`\n✓ All ${GATED.length} generated artifacts are up to date.`);
  process.exit(0);
}

console.log(`\n✗ ${stale.length} of ${GATED.length} artifact(s) stale:\n`);
for (const s of stale) console.log(`  ${s.artifact}\n    pnpm --filter @objectstack/spec ${s.gen}`);

if (!fix) {
  console.log(`\nRegenerate exactly these:\n  ` +
    stale.map((s) => `pnpm --filter @objectstack/spec ${s.gen}`).join(' && ') +
    `\n\nOr re-run with --fix to do it now (only the ${stale.length} proved stale — never the whole set).`);
  process.exit(1);
}

console.log(`\n--fix: regenerating the ${stale.length} stale artifact(s). Review the diff before committing.\n`);
let failed = 0;
for (const s of stale) {
  // The `readsDist` warning above is advice a reader can ignore; here it must
  // become a refusal. `gen:api-surface` on a stale dist does not fail — it
  // writes a plausible surface with every export added since the last build
  // missing, and `gen:docs` then ratchets a baseline exemption in to cover the
  // hole. That landed unnoticed on #4687 and was caught only by diffing the
  // generated files against `main`. --fix is the one path that WRITES, so it is
  // the one place the trap is unsurvivable: a visible conflict is recoverable,
  // a confidently wrong artifact is not (#4675).
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
