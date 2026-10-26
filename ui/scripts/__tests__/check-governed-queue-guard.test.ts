import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REQUIRED_CONTEXTS } from '../dependabot-merge-gate.mjs';
import {
  CHECK_CONTEXT_NAME,
  CHECK_WORKFLOW,
  GOVERNED_SURFACES,
  governedPathsIn,
} from '../check-governed-queue-guard.mjs';

import { selfTestCases, stripAnsi } from './helpers/child-verdict';
import { workspaceRoot } from '../workspace-root.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const GATE = 'scripts/check-governed-queue-guard.mjs';
const WORKFLOW = `.github/workflows/${CHECK_WORKFLOW}`;

/**
 * objectui#6596. PR #6183 touched `AGENTS.md`, was correctly parked as a draft,
 * and a GitHub MCP `update_pull_request` call passing only `reviewers` silently
 * set `draft: false`. It entered the merge queue and landed as `5b3290fd5` with
 * no human approval; converting it back to a draft did not dequeue it.
 *
 * The gate itself carries a `--self-test` covering its predicates, and this file
 * does NOT duplicate it — it pins the gate to its WIRING, in the direction that
 * goes wrong quietly. A refusal nothing runs is indistinguishable from a refusal
 * that passes, which is the state the whole governed-surface rule was already in
 * one level up: a rule with no mechanism under it.
 *
 * Deliberately NOT asserted here: whether the context is in the live required
 * set. That is repository settings, which no test here can read and no agent may
 * change. What IS asserted is that this repository has written the answer down
 * where its own tooling reads it, and that every piece of the chain exists.
 *
 * ⚠️ The workflow half of the chain retired with objectstack#25712: `the gate
 * script and its workflow both exist` (its workflow leg), `the job publishes
 * exactly the check name the script declares`, `subscribes BOTH legs`,
 * `re-fires on ready_for_review`, `carries no path filter on either leg`,
 * `checks out full history`, `grants pull-requests: read and no write scope
 * anywhere` and `runs the self-test BEFORE the live judgment`. Each read
 * objectui's `governed-surface-guard.yml`, which runs nowhere under the
 * monorepo: GitHub runs the root `.github/workflows/` alone. The root
 * `governed-surface-guard.yml` covers the queue guard with its own register,
 * which governs `ui/.github/workflows/**` (roster row 11, → sub-issue 4, which
 * decides the rest of the `ui/**` surface). `CHECK_JOB_ID` and
 * `CHECK_WORKFLOW` still name objectui's job; a port brings these pins back
 * against the root workflow that runs this gate, by path.
 */
describe('check-governed-queue-guard is wired, not merely present', () => {
  it('the gate script exists', () => {
    expect(fs.existsSync(path.join(ROOT, GATE))).toBe(true);
  });

  it('package.json aliases it, and the alias points at the script that exists', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const alias of ['check:governed-queue-guard', 'governed']) {
      expect(pkg.scripts[alias], `package.json must alias ${alias}`).toBeTruthy();
      expect(pkg.scripts[alias]).toContain(GATE);
    }
  });

  it('this repository has written the context down as blocking', () => {
    // `REQUIRED_CONTEXTS` is objectui's own answer to "which checks are
    // blocking" (`scripts/dependabot-merge-gate.mjs`), and it is what
    // `merge-queue-reporting.test.ts` derives the merge_group floor from. A
    // guard outside it is a guard that floor cannot see.
    expect(REQUIRED_CONTEXTS).toContain(CHECK_CONTEXT_NAME);
  });

  it('its self-test passes — the half that makes a green run mean something', () => {
    const out = execFileSync('node', [GATE, '--self-test'], { cwd: ROOT, encoding: 'utf8' });
    // objectui#7897 — the COUNT, not the shape. `\d+ cases pass` is satisfied
    // by `0 cases pass`, so the old spelling passed for a self-test whose case
    // table had gone empty: the outcome it exists to refuse. `selfTestCases`
    // also strips ANSI, the second belt for a child that starts colouring —
    // that is the CI-only direction, and no repo gate colours today.
    expect(stripAnsi(out)).toMatch(/check-governed-queue-guard self-test: \d+ cases pass/);
    expect(
      selfTestCases(out, 'check-governed-queue-guard'),
      'a self-test that ran no cases is not a passing self-test',
    ).toBeGreaterThan(0);
  });
});

/**
 * The governed surface itself, asserted from OUTSIDE the gate. The gate's own
 * `--self-test` pins the same set, and that is not a duplicate: this file pins
 * it against the repository's real tree, so a surface that is declared but does
 * not exist on disk fails here — a governed path nobody can edit is a rule about
 * nothing, and the reverse (a surface silently dropped) is the rule quietly
 * shrinking.
 */
describe('the governed surface is the ruled definition, and it is real', () => {
  it('declares exactly the six ruled surfaces', () => {
    // The five of the 2026-08-18 definition, then `.github/workflows/**`, which
    // the maintainer's ruling on objectui#12255 added (「两仓加治理行」).
    expect(GOVERNED_SURFACES.map((s) => s.glob)).toEqual([
      'docs/adr/**',
      '.claude/**',
      'skills/**',
      'AGENTS.md',
      'CLAUDE.md',
      '.github/workflows/**',
    ]);
  });

  /**
   * The one row whose directory left this tree: objectstack#25712 deleted
   * `ui/.github/workflows/`, which GitHub never ran under the monorepo. ⚠️ PENDING
   * the maintainer's call on objectstack#25712, since the row is objectui#12255's
   * ruling: drop it, keep it as below, or retire this register for the root one
   * (sub-issue 4).
   */
  const MOVED = 'workflows';

  it('every declared surface exists in this tree, the moved workflows row aside', () => {
    for (const surface of GOVERNED_SURFACES.filter((s) => s.id !== MOVED)) {
      // `in` rather than `surface.prefix ?? surface.exact`: the register is a
      // union of frozen literals, so exactly one of the two keys exists on each
      // member and neither exists on all of them. `tsconfig.scripts.json` infers
      // these types from the `.mjs` (allowJs, checkJs off), so the optional-chain
      // spelling is a real type error here rather than a stylistic preference.
      const target = 'prefix' in surface ? surface.prefix : surface.exact;
      expect(
        fs.existsSync(path.join(ROOT, target)),
        `GOVERNED_SURFACES declares ${target}, which does not exist. A governed path nobody can ` +
          `edit is a rule about nothing; either the surface moved (update the register) or the ` +
          `entry was speculative (drop it).`,
      ).toBe(true);
    }
  });

  it('the workflows row moved: the root register governs ui/.github/workflows/** at Tier H', () => {
    // Self-retiring: once the directory is back, the case above must read it again.
    expect(
      fs.existsSync(path.join(ROOT, '.github/workflows')),
      'ui/.github/workflows/ exists again: fold the workflows row back into the existence case above',
    ).toBe(false);
    // The guard that runs is the root one, so its own predicate is asked, by path.
    const probe = 'ui/.github/workflows/ci.yml';
    const run = spawnSync('node', ['scripts/pm/check-governed-merges.mjs', '--test', probe, '--json'], {
      cwd: workspaceRoot(),
      encoding: 'utf8',
    });
    expect(run.stdout, run.stderr).toMatch(/^\{/);
    const verdict = JSON.parse(run.stdout) as { governed: boolean; tier: string; matched: Array<{ id: string; files: string[] }> };
    expect(verdict.governed).toBe(true);
    expect(verdict.tier).toBe('H');
    expect(verdict.matched.map((s) => [s.id, s.files])).toEqual([['ui-workflows', [probe]]]);
  });

  it('governs every workflow, its own included, and not the script that workflow runs', () => {
    // This case used to pin the opposite ("does not govern its own workflow, or
    // CI configuration generally") as the widening deliberately NOT taken. The
    // maintainer took it on objectui#12255, so the pin is reversed, not deleted:
    // a later edit that drops the row still has to be a decision.
    const hit = governedPathsIn([WORKFLOW, GATE, '.github/workflows/ci.yml']);
    expect(hit.map((s) => s.id)).toEqual(['workflows']);
    expect(hit[0].files).toEqual([WORKFLOW, '.github/workflows/ci.yml']);
  });

  it('does not govern the rest of .github/ — the ruling named the workflows, not their directory', () => {
    // YAML paths only: a markdown literal here would read, to
    // `markdown-test-inputs.mjs`, as a document this test consumes. The self-test
    // carries the `.github/prompts/**` negative.
    expect(governedPathsIn(['.github/dependabot.yml', '.github/ISSUE_TEMPLATE/config.yml', '.github/labeler.yml'])).toEqual([]);
  });

  it('the two root rows are EXACT — a vendored copy is ordinary source', () => {
    expect(governedPathsIn(['examples/AGENTS.md', 'packages/cli/templates/CLAUDE.md'])).toEqual([]);
    expect(governedPathsIn(['AGENTS.md']).map((s) => s.id)).toEqual(['agents-md']);
  });
});
