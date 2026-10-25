import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { selfTestCases, stripAnsi } from './helpers/child-verdict';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const GATE = 'scripts/check-entry-guard.mjs';

/**
 * objectui#6092: `scripts/invoked-as.mjs` arrived from objectstack (#5984)
 * carrying a header that named `scripts/check-entry-guard.mjs` as the gate
 * enforcing its single-spelling rule. That file did not exist here, nothing in
 * `package.json` or `.github/workflows/` ran such a gate, and the sweep the
 * header described had not happened either — the string `check-entry-guard`
 * appeared in exactly one place in the whole repository, which was that
 * sentence about itself (objectui#6078).
 *
 * The failure that made it expensive was not the missing file. It was that a
 * reader — human or agent — could open `invoked-as.mjs`, read a confident
 * present-tense claim, and conclude the tree was converted and enforced when
 * neither was true. So this file pins the claim to the mechanism, in the one
 * direction that can go wrong quietly: a gate can stop being wired without
 * anything going red, because a gate nobody runs is indistinguishable from a
 * gate that passes.
 *
 * What is asserted, and why each one:
 *
 *   1. the script exists and its `package.json` alias points at it — the alias
 *      is what a developer runs, and an alias naming a moved file fails loudly
 *      only if something runs it;
 *   2. `lint.yml` really runs it, on pull requests, in a step that executes —
 *      the wiring claim itself;
 *   3. the workflow's spelling and the alias's spelling name the SAME script,
 *      so the pre-install `node` invocation and `pnpm check:entry-guard` cannot
 *      drift into checking different things;
 *   4. it runs BEFORE `pnpm install`, which is not decoration: placed after,
 *      an install failure would take the gate with it and the tree would go
 *      unjudged with the job red for an unrelated reason;
 *   5. the gate's own `--self-test` is what the workflow runs first, and it
 *      passes — a scan whose recogniser is broken reports a clean tree.
 *
 * Deliberately NOT asserted: any count of guards, spellings or baseline
 * entries. Those numbers live in the gate's output and its baseline, they move
 * as objectui#6092's second half converts call sites, and a hand-copied
 * enumeration here would drift by construction — the lesson `lint-workflow.test.ts`
 * records at length for this same workflow.
 */
describe('check-entry-guard is wired, not merely present', () => {
  const workflow = parseYaml(fs.readFileSync(path.join(ROOT, '.github/workflows/lint.yml'), 'utf8'));
  const steps: Array<Record<string, unknown>> = workflow.jobs.lint.steps;
  const gateSteps = steps.filter((s) => typeof s.run === 'string' && (s.run as string).includes(GATE));

  it('the gate script exists', () => {
    expect(fs.existsSync(path.join(ROOT, GATE))).toBe(true);
  });

  it('package.json aliases it, and the alias points at the script that exists', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const alias = pkg.scripts['check:entry-guard'];
    expect(alias).toBeTruthy();
    expect(alias).toContain(GATE);
  });

  it('lint.yml runs it — exactly one step, both legs', () => {
    expect(gateSteps).toHaveLength(1);
    const run = gateSteps[0].run as string;
    expect(run).toContain(`node ${GATE} --self-test`);
    expect(run.split('\n').some((l) => l.trim() === `node ${GATE}`)).toBe(true);
  });

  it('that step is not disabled — it runs whenever the job runs its other steps', () => {
    const condition = gateSteps[0].if;
    const others = steps
      .filter((s) => s !== gateSteps[0] && typeof s.uses !== 'undefined')
      .map((s) => s.if);
    // Same guard the rest of the job uses, rather than a hard-coded string:
    // objectui#3523's shape may be renamed, and a test pinning the literal
    // would fail on a rename while a step commented out with `if: false` would
    // not.
    expect(others).toContain(condition);
  });

  it('lint.yml still gates pull requests, or the step above is inert', () => {
    // `on` parses as the boolean `true` in YAML 1.1; `yaml` gives back `on`.
    const on = workflow.on ?? workflow[true as unknown as string];
    expect(Object.keys(on)).toContain('pull_request');
  });

  it('it runs BEFORE pnpm install, so an install failure cannot take it with it', () => {
    const gateIndex = steps.indexOf(gateSteps[0]);
    const installIndex = steps.findIndex((s) => typeof s.run === 'string' && (s.run as string).includes('pnpm install'));
    expect(installIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(installIndex);
  });

  it('its self-test passes — the half that makes a green scan mean something', () => {
    const out = execFileSync('node', [GATE, '--self-test'], { cwd: ROOT, encoding: 'utf8' });
    // objectui#7897 — the COUNT, not the shape. `\d+ cases pass` is satisfied
    // by `0 cases pass`, so the old spelling passed for a self-test whose case
    // table had gone empty: the outcome it exists to refuse. `selfTestCases`
    // also strips ANSI, the second belt for a child that starts colouring —
    // that is the CI-only direction, and no repo gate colours today.
    expect(stripAnsi(out)).toMatch(/check-entry-guard self-test: \d+ cases pass/);
    expect(
      selfTestCases(out, 'check-entry-guard'),
      'a self-test that ran no cases is not a passing self-test',
    ).toBeGreaterThan(0);
  });
});
