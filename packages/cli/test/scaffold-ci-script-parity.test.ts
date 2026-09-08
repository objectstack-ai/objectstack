// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — every scaffolder emits a project that can run the on-ramp's CI workflow.
 *
 * ## The defect this exists for (#16350)
 *
 * Two scaffolders write a new project's `package.json`: `npx create-objectstack`
 * copies `packages/create-objectstack/src/templates/blank/`, and `os create` /
 * `os init` render one of the `TEMPLATES` maps in `src/commands/init.ts`. #16330
 * added a `lint` script to the template and a `pnpm lint` step to the workflow it
 * ships — and did not touch `init.ts`, whose THREE script maps each declared
 * `validate` and no `lint`. The two script sets diverged inside a single PR, and
 * the divergence went unnoticed because nothing held them equal.
 *
 * The harm is not hypothetical and not cosmetic. The template's
 * `.github/workflows/ci.yml` is the CI a scaffolded project starts with, and the
 * docs point an `os init` user at it; a project scaffolded through `init.ts` that
 * copies that workflow dies on `Command "lint" not found` on its first push. Nor
 * is `lint` a second spelling of `validate`: both call `runAuthoringRules`, but
 * `checkHookBodyLowering` is imported by `src/commands/lint.ts` and by nothing
 * else (`git grep hook-body-lowering -- packages` returns that one import and the
 * rule's own test), so `hook-body/not-lowerable` is reachable from `pnpm lint`
 * alone.
 *
 * ## What is asserted, and why nothing here is transcribed
 *
 * The required script set is DERIVED from the workflow the on-ramp ships — the
 * `pnpm <script>` steps it runs — not written down here. A test that listed
 * `['validate', 'lint', 'typecheck']` would go green on the tree where the
 * workflow grew a fourth step and only one scaffolder followed, which is the
 * exact state this file exists to catch. For the same reason the expected VALUE
 * of each script is read off the template's own `package.json` rather than
 * spelled out.
 *
 * ## The half this does NOT duplicate
 *
 * The `template-ci-workflow` pin, in the `create-objectstack` package, already
 * holds the workflow against the TEMPLATE's own `package.json`. That pin is
 * package-local by construction — it cannot see `init.ts` — and its failure text
 * says so in words: add the script to the template AND to the other scaffolder,
 * naming this package's `src/commands/init.ts`. This file is the other half of
 * that sentence, and the two together close the loop in both directions.
 *
 * ## Scope — why only the workflow's scripts, and not the whole map
 *
 * The two sides differ elsewhere ON PURPOSE, so whole-map equality is the wrong
 * assertion: `init.ts`'s `app` map spells `start` as `objectstack compile &&
 * objectstack serve` (with the reasoning in a comment beside it) where the
 * template says `objectstack start`, its `build` runs `objectstack compile` where
 * the template names the `objectstack build` alias, and the `plugin` / `empty`
 * templates scaffold a metadata package with no server to run at all. The
 * workflow's step list is the subset on which the two sides make the same promise
 * to the same user, and on that subset there is currently no accepted exception —
 * so this pin carries no exemption ledger, and adding one should be a decision
 * somebody argues for rather than a row somebody appends.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { TEMPLATES } from '../src/commands/init.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

// One `resolve(HERE, ...)` call per line and nothing split across lines:
// `check:cross-package-test-inputs` reconstructs these reads by SOURCE SCAN, and
// a spelling it cannot parse leaves the glob declared and held by nothing. Both
// are declared for `@objectstack/cli` in scripts/cross-package-test-inputs.mjs
// and mirrored into turbo.json.
const ON_RAMP_TEMPLATE_PKG = resolve(HERE, '../../..', 'packages/create-objectstack/src/templates/blank/package.json');
const ON_RAMP_WORKFLOW = resolve(HERE, '../../..', 'packages/create-objectstack/src/templates/blank/.github/workflows/ci.yml');

interface WorkflowStep {
  uses?: string;
  run?: string;
}

/**
 * The project scripts the on-ramp's CI workflow runs, in file order.
 *
 * `pnpm <word>` where `<word>` is not a pnpm builtin is a script run — the same
 * reading the template-side pin takes of the same file, so the two halves cannot
 * disagree about what the workflow asks for.
 */
function workflowScripts(): string[] {
  const workflow = parseYaml(readFileSync(ON_RAMP_WORKFLOW, 'utf8')) as {
    jobs?: Record<string, { steps?: WorkflowStep[] }>;
  };
  const out: string[] = [];
  for (const job of Object.values(workflow.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (!step.run) continue;
      for (const line of step.run.split('\n')) {
        const m = /^\s*pnpm(?:\s+run)?\s+([a-z][a-z0-9:_-]*)/i.exec(line);
        if (!m) continue;
        const word = m[1];
        if (word === 'install' || word === 'exec' || word === 'dlx') continue;
        out.push(word);
      }
    }
  }
  return out;
}

const templateScripts = (
  JSON.parse(readFileSync(ON_RAMP_TEMPLATE_PKG, 'utf8')) as { scripts: Record<string, string> }
).scripts;

const REQUIRED = workflowScripts();

describe('scaffolder script parity — `os init` emits what the on-ramp CI runs (#16350)', () => {
  // The harvest is the whole assertion below, so an empty one would make every
  // `it.each` case vacuously green — a parser or regex that stopped matching
  // would read exactly like parity. Assert the reading fired before using it.
  it('reads at least one project script off the on-ramp workflow', () => {
    expect(
      REQUIRED.length,
      `no \`pnpm <script>\` step found in ${ON_RAMP_WORKFLOW} — the harvest below would be vacuous`,
    ).toBeGreaterThan(0);
  });

  // The template declaring what its own workflow runs is pinned next door, in
  // create-objectstack. Re-stated here only as the precondition for reading the
  // expected VALUES off it: an undeclared script would give `undefined` on both
  // sides, and `undefined === undefined` is a pass.
  it.each(REQUIRED)('the on-ramp template declares `%s`, so a value exists to compare against', (script) => {
    expect(Object.keys(templateScripts)).toContain(script);
  });

  describe.each(Object.keys(TEMPLATES))('os init -t %s', (key) => {
    const scripts = TEMPLATES[key].scripts;

    it.each(REQUIRED)('declares `%s`', (script) => {
      expect(
        Object.keys(scripts),
        `the on-ramp's CI workflow runs \`pnpm ${script}\`, but \`os init -t ${key}\` emits no such ` +
          'script. A project scaffolded this way that adopts that workflow — the documented next ' +
          `step — fails its first push with \`Command "${script}" not found\`. Add it to the map in ` +
          'packages/cli/src/commands/init.ts (or drop the step from the template workflow).',
      ).toContain(script);
    });

    it.each(REQUIRED)('runs the same command as the on-ramp for `%s`', (script) => {
      expect(
        scripts[script],
        `\`${script}\` runs different commands depending on which scaffolder the reader followed`,
      ).toBe(templateScripts[script]);
    });
  });
});
