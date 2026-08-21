// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4776 — the vocabulary GATE. The rule next door is a pure decision procedure
// that ships to any caller with source in hand; this file is the one that makes
// it bite in THIS repo, by running it over every `.ts` under `packages/`.
//
// Why the enforcement lives in a test rather than in another `scripts/check-*`:
// the shape it looks for is a lint-layer vocabulary, and `@objectstack/lint` is
// where the vocabulary lives. A rule on the package's public export surface
// reads — to a human and to an AI author alike — as a check the platform
// performs (Prime Directive #10, and the closure `authoring-rule-wiring.test.ts`
// draws around it). This is that check. `pnpm check:startup-registry-verdict`
// enforces the SERVICE-registry half of the same family and is untouched; see
// the rule module for the measured division of labour between the two.
//
// Three false greens this is built to refuse:
//
//  1. **A corpus that was never read.** An unreadable directory would silently
//     shrink the sweep while the file count stayed comfortably non-zero, and the
//     test would report a clean audit over source it never opened — the exact
//     shape the rule itself is about, turned on the rule (#4930). So the root is
//     resolved up front and the walk carries no `catch`.
//  2. **A rule that matches nothing.** A ratchet that has only ever been green
//     cannot be told apart from a dead one (#4690), and this one has been green
//     from its first commit. `the sweep can still fire` therefore pushes a
//     known-bad source through the SAME sweep function the corpus goes through.
//  3. **A shared sweep that never ran.** The corpus read + scan is paid ONCE
//     for the whole file (#10838) instead of once per case, so the two corpus
//     cases now read the same findings. That introduces (1)'s failure shape one
//     level up: a case reading a sweep that did not happen sees zero findings
//     and prints as a clean audit. So the shared value starts `undefined`, not
//     `[]`, and every reader goes through `corpusFindings()`, which throws.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  findStartupRegistryVerdicts,
  type StartupRegistryVerdictFinding,
} from './lint-startup-registry-verdict.js';

const srcDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(srcDir, '..', '..', '..');
const packagesDir = join(repoRoot, 'packages');

/**
 * Reviewed exceptions. **Shrink-only**, hand-edited: an entry must name WHY the
 * site is still here and WHAT closes it. There is deliberately no generator — a
 * `--update` flag lets a new violation be admitted by "just run the update
 * command", which is how a ratchet stops meaning anything.
 *
 * Empty on purpose: the three instances this vocabulary was written from
 * (#4769 / #4771 / #4772) were all fixed before it landed. The non-vacuity proof
 * is the `the sweep can still fire` case below, not the emptiness of this list.
 */
const LEDGER: Readonly<Record<string, string>> = {};

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.turbo', 'coverage', '.cache', '.next']);

/**
 * Every auditable `.ts` under `dir`.
 *
 * No `catch`: an error during the walk means the corpus was only partly read,
 * which must not be reported as a clean audit.
 */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.includes('.test.') &&
      !entry.includes('.spec.') &&
      !entry.includes('.conformance.')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** The sweep, as one function, so the corpus and the non-vacuity case share it. */
function sweep(sources: Array<{ file: string; source: string }>): StartupRegistryVerdictFinding[] {
  return sources.flatMap(({ file, source }) => findStartupRegistryVerdicts(source, { file }));
}

/**
 * The corpus sweep's budget, in milliseconds. Deliberately a HOOK timeout and
 * deliberately loose — both halves are the decision, so both are written down.
 *
 * What it is sized against (#10838). The read + scan used to run TWICE, once
 * inside each corpus case, under vitest's default 5000ms PER-TEST timeout. On a
 * loaded merge-queue shard (that run reported `import 106.30s`) the first case
 * measured 9144ms: the sweep is synchronous, so the timer cannot interrupt it —
 * vitest lets it run to completion and then fails it for overrunning. PR #10733,
 * whose diff never touched `packages/lint`, was ejected from the merge queue for
 * it and passed on requeue; every entry queued behind it rebuilt.
 *
 * Measured on this repo 2026-08-21, corpus 1880 files / 28.15 MB: cold sweep
 * (including the lazy ~9 MB `typescript` load the rule defers until it has
 * source in hand) 986ms; warm sweep 465ms / 440ms. The queue-shard wall-clock
 * above is ~9.2x the local cold number. Note what that says about the fix:
 * sharing removes one WARM sweep (locally, file `tests` total 1441ms -> 816ms),
 * while relocating the budget is what removes the ejection. Projecting the
 * ejecting run onto the new shape, the hook would do what its case 1 did
 * (~9144ms) and clear vitest's default 10000ms hook timeout by 856ms — still a
 * near-threshold budget on a shard whose load is the variable, which is why the
 * number below is stated rather than defaulted.
 *
 * Why 60s and not something snug. This is a LIVENESS backstop — a wedged sweep
 * must not pin a worker forever — and explicitly NOT a performance tripwire. A
 * budget sized close to the observed cost is exactly what ejected an unrelated
 * PR: the work grows with the repo (1872 files when the card was written at
 * 12:23Z, 1880 four hours later) while the wall-clock varies with shard load, so
 * a snug number is guaranteed to red on somebody else's PR eventually. 60s is
 * ~6.5x the worst wall-clock this sweep has ever been observed to take and ~60x
 * the local one. The cost stays visible without a tripwire: it is paid in one
 * hook now, and a hook's time lands in the file's own duration (the `tests`
 * aggregate vitest prints per run), which is where a corpus-cost trend shows up.
 * The per-case numbers, by contrast, now read ~1ms — measured, not assumed: a
 * green run does NOT print hook durations, so do not go looking for one.
 */
const CORPUS_SWEEP_BUDGET_MS = 60_000;

describe('startup open-vocabulary verdicts across packages/ (#4776)', () => {
  const stat = statSync(packagesDir);
  expect(stat.isDirectory(), `${packagesDir} must be a directory — the sweep's verdict is drawn from reading it`).toBe(
    true,
  );
  const files = collectSourceFiles(packagesDir);

  /**
   * The findings, swept once for the whole file.
   *
   * Sharing is sound only because neither reader mutates what the other reads:
   * both derive (`filter`, `map`) and write nothing. A comment cannot hold that
   * open against a later edit, so the array and every finding in it are frozen —
   * a mutating edit throws here (this module is ESM, so strict mode) instead of
   * silently draining the other case of what it was supposed to check.
   *
   * `undefined` rather than `[]` on purpose: see false green 3 in the header.
   */
  let sweepResult: readonly StartupRegistryVerdictFinding[] | undefined;

  beforeAll(() => {
    const findings = sweep(
      files.map((file) => ({ file: relative(repoRoot, file), source: readFileSync(file, 'utf8') })),
    ).map((finding) => Object.freeze(finding));
    sweepResult = Object.freeze(findings);
  }, CORPUS_SWEEP_BUDGET_MS);

  function corpusFindings(): readonly StartupRegistryVerdictFinding[] {
    if (sweepResult === undefined) {
      throw new Error(
        'the corpus sweep did not run — this case would otherwise report a clean audit over a corpus it never swept (#10838)',
      );
    }
    return sweepResult;
  }

  it('reads a non-empty corpus', () => {
    // A zero-file sweep returns zero findings and would otherwise print as a
    // clean audit over nothing at all.
    expect(files.length).toBeGreaterThan(500);
  });

  it('no package records a verdict the boot can still contradict', () => {
    const findings = corpusFindings();
    const unledgered = findings.filter((f) => !(`${f.path}::${f.rule}` in LEDGER));

    expect(
      unledgered.map((f) => `[${f.rule}] ${f.path} — ${f.where}: ${f.message}`),
      `${unledgered.length} startup open-vocabulary verdict(s).\n` +
        `Each one draws a conclusion from a registry a plugin can still fill during this same boot, and ` +
        `records it where nothing retracts it. Fix it (the finding's hint carries the three shapes the ` +
        `#4769/#4771/#4772 fixes took), or add an entry to LEDGER in this file WITH the reason it is ` +
        `still here and what closes it.`,
    ).toEqual([]);
  });

  it('no ledger entry is stale', () => {
    // A ledger that outlives its site is a standing permission nobody reviewed.
    const findings = corpusFindings();
    const live = new Set(findings.map((f) => `${f.path}::${f.rule}`));
    const stale = Object.keys(LEDGER).filter((key) => !live.has(key));
    expect(stale, `stale LEDGER entr(ies) — the site is fixed, delete the line: ${stale.join(', ')}`).toEqual([]);
  });

  it('the sweep can still fire (#4690 — a green ratchet must be told apart from a dead one)', () => {
    // #4771, reconstructed: the flow node-type verdict drawn in start(), 0.8s
    // before the executor that answers it was registered. Pushed through the
    // SAME sweep the corpus goes through, so a change that broke matching would
    // fail here instead of quietly turning the corpus green.
    const reconstructed = `
      export class AutomationServicePlugin {
        name = 'com.objectstack.service-automation';
        async init() {}
        async start(ctx) {
          const known = this.engine.getRegisteredNodeTypes();
          for (const flow of this.flows) {
            if (!known.includes(flow.type)) {
              ctx.logger.warn(\`Flow '\${flow.name}' will fail at execution time.\`);
            }
          }
        }
      }
    `;
    const findings = sweep([{ file: 'packages/services/service-automation/src/plugin.ts', source: reconstructed }]);
    expect(findings.map((f) => f.rule)).toEqual([
      'startup-open-vocabulary-verdict',
      'startup-verdict-assertive-wording',
    ]);
  });
});
