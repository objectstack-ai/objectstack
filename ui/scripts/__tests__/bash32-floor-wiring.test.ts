import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { selfTestCases, stripAnsi } from './helpers/child-verdict';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const GATE = 'scripts/check-bash32-floor.mjs';

/**
 * objectui#7692: this repository held its own shell to nothing.
 *
 * macOS ships bash 3.2.57 and no bash 4+, CI runs bash 5, and every bash-4-only
 * construct therefore works everywhere CI can see. A `mapfile`, a `declare -A`
 * or an unguarded `$EPOCHSECONDS` in `scripts/setup.sh` — which a contributor
 * runs on their own machine — is green in CI, green locally on Linux, and dies
 * only on the host the floor exists for. The sibling repository has gated every
 * tracked shell file at bash 3.2 for some time; here, four shell files this
 * repository wrote itself (`e2e/live/ci/start-backend.sh`,
 * `e2e/live/ci/stop-backend.sh`, `scripts/ensure-chromium-ready.sh`,
 * `scripts/setup.sh`) were held to nothing at all.
 *
 * The gate itself carries its own battery: `--self-test` drives all 19
 * construct rows against a real instance of each and against the 3.2
 * replacement its own failure text tells you to write, plus the end-to-end
 * discovery path over throwaway git repositories. ⛔ This file deliberately
 * does NOT restate any of that, and does not count cases either — a hand-copied
 * enumeration drifts by construction, which is the lesson `lint-workflow.test.ts`
 * records at length for this same workflow.
 *
 * What this file pins is the WIRING, in the directions that can go wrong
 * quietly, because a gate nobody runs is indistinguishable from a gate that
 * passes:
 *
 *   1. the script exists and `package.json`'s alias points at it;
 *   2. `lint.yml` really runs it, in a step that executes, on pull requests;
 *   3. the workflow spelling and the alias spelling name the SAME script, so
 *      `pnpm check:bash32-floor` and the pre-install `node` invocation cannot
 *      drift into checking different things;
 *   4. it runs BEFORE `pnpm install` — placed after, an install failure takes
 *      the gate with it and the tree goes unjudged with the job red for an
 *      unrelated reason;
 *   5. its `--self-test` is what the workflow runs first, and it passes;
 *   6. ⭐ `e2e/**` is in the declared scan roots, and the `e2e/` shell files are
 *      really in the population it reports. That is the one thing about this
 *      port a reviewer cannot check by reading upstream, and the one thing
 *      whose loss would put the card straight back.
 */
describe('check-bash32-floor is wired, not merely present', () => {
  const workflow = parseYaml(fs.readFileSync(path.join(ROOT, '.github/workflows/lint.yml'), 'utf8'));
  const steps: Array<Record<string, unknown>> = workflow.jobs.lint.steps;
  const gateSteps = steps.filter((s) => typeof s.run === 'string' && (s.run as string).includes(GATE));

  it('the gate script exists', () => {
    expect(fs.existsSync(path.join(ROOT, GATE))).toBe(true);
  });

  it('package.json aliases it, and the alias points at the script that exists', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const alias = pkg.scripts['check:bash32-floor'];
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
    // Same guard the rest of the job uses, rather than a hard-coded string: a
    // step commented out with `if: false` would pass a literal comparison.
    const condition = gateSteps[0].if;
    const others = steps
      .filter((s) => s !== gateSteps[0] && typeof s.uses !== 'undefined')
      .map((s) => s.if);
    expect(others).toContain(condition);
  });

  it('lint.yml still gates pull requests, or the step above is inert', () => {
    // `on` parses as the boolean `true` in YAML 1.1; `yaml` gives back `on`.
    const on = workflow.on ?? workflow[true as unknown as string];
    expect(Object.keys(on)).toContain('pull_request');
  });

  it('it runs BEFORE pnpm install, so an install failure cannot take it with it', () => {
    const gateIndex = steps.indexOf(gateSteps[0]);
    const installIndex = steps.findIndex(
      (s) => typeof s.run === 'string' && (s.run as string).includes('pnpm install'),
    );
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
    expect(stripAnsi(out)).toMatch(/check-bash32-floor self-test: \d+ cases pass/);
    expect(
      selfTestCases(out, 'check-bash32-floor'),
      'a self-test that ran no cases is not a passing self-test',
    ).toBeGreaterThan(0);
  });
});

/**
 * ⭐ The port's one substantive change, pinned where a reviewer can see it.
 *
 * Upstream declares `scripts/**`, `.claude/hooks/**`, `.githooks/**`. This
 * repository has no `.githooks/`, and two of the four shell files it wrote
 * itself live under `e2e/`. A verbatim copy of upstream's roots would walk past
 * half the population objectui#7692 is about — and would still print a
 * confident green line, which is the exact failure the gate exists to refuse.
 *
 * Both directions are asserted, and the second is the load-bearing one: naming
 * the root in the declaration is cheap, and a declaration the walk does not
 * honour is the species this pins against.
 */
describe('the e2e/** scan root — the reason this is a port and not a copy', () => {
  it('declares e2e/** among its scan roots', async () => {
    const { POPULATION_ROOTS } = await import(path.join(ROOT, GATE));
    expect(POPULATION_ROOTS).toContain('e2e/**');
    expect(POPULATION_ROOTS).not.toContain('.githooks/**');
  });

  it('and really scans the e2e/ shell files — the declaration is honoured by the walk', async () => {
    const { scanTree } = await import(path.join(ROOT, GATE));
    const { population } = scanTree(ROOT);
    const scanned: string[] = population.map((p: { rel: string }) => p.rel).sort();

    // The tree's own listing, not a hand-written expectation: a literal list
    // here would go stale the day someone adds a shell file, and the claim is
    // about the walk agreeing with the tree rather than with this file.
    const tracked = spawnSync('git', ['-C', ROOT, 'ls-files', '--', 'e2e'], { encoding: 'utf8' })
      .stdout.split('\n')
      .filter((f) => f.endsWith('.sh'))
      .sort();

    expect(
      tracked.length,
      'no tracked `.sh` file under e2e/ was found at all, so "the walk sees them" is not a ' +
        'reading — this assertion would pass on an empty set. objectui#7692 names two: ' +
        'e2e/live/ci/start-backend.sh and e2e/live/ci/stop-backend.sh.',
    ).toBeGreaterThan(0);

    for (const file of tracked) {
      expect(
        scanned,
        `${file} is tracked shell under e2e/ but check-bash32-floor did not scan it. If the ` +
          '`e2e/**` root was dropped from POPULATION_ROOTS, that is objectui#7692 reopening: ' +
          'the gate goes on printing a green line over a population missing half the shell ' +
          'this repository wrote itself.',
      ).toContain(file);
    }
  });
});
