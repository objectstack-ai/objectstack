import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { REQUIRED_CONTEXTS } from '../dependabot-merge-gate.mjs';
import {
  CHECK_CONTEXT_NAME,
  CHECK_JOB_ID,
  CHECK_WORKFLOW,
  GOVERNED_SURFACES,
  governedPathsIn,
} from '../check-governed-queue-guard.mjs';

import { selfTestCases, stripAnsi } from './helpers/child-verdict';

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
 */
describe('check-governed-queue-guard is wired, not merely present', () => {
  const workflowText = fs.readFileSync(path.join(ROOT, WORKFLOW), 'utf8');
  const workflow = parseYaml(workflowText);
  const job = workflow.jobs[CHECK_JOB_ID];

  it('the gate script and its workflow both exist', () => {
    expect(fs.existsSync(path.join(ROOT, GATE))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, WORKFLOW))).toBe(true);
  });

  it('package.json aliases it, and the alias points at the script that exists', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const alias of ['check:governed-queue-guard', 'governed']) {
      expect(pkg.scripts[alias], `package.json must alias ${alias}`).toBeTruthy();
      expect(pkg.scripts[alias]).toContain(GATE);
    }
  });

  it('the job publishes exactly the check name the script declares', () => {
    // The #6865-shape defect one repo over: renaming a job detaches a required
    // context with nothing to say so. The name lives in two files because a name
    // in one file is a name nothing can pin; this is the assertion that keeps
    // the two equal.
    expect(job.name).toBe(CHECK_CONTEXT_NAME);
  });

  it('this repository has written the context down as blocking', () => {
    // `REQUIRED_CONTEXTS` is objectui's own answer to "which checks are
    // blocking" (`scripts/dependabot-merge-gate.mjs`), and it is what
    // `merge-queue-reporting.test.ts` derives the merge_group floor from. A
    // guard outside it is a guard that floor cannot see.
    expect(REQUIRED_CONTEXTS).toContain(CHECK_CONTEXT_NAME);
  });

  it('subscribes BOTH legs — the queue build refuses, the pull request warns', () => {
    // Both, not either. Without `merge_group` there is no refusal at all;
    // without `pull_request` a seat gets no warning before the queue, which is
    // the moment #6183 could still have been stopped.
    expect(workflow.on).toHaveProperty('merge_group');
    expect(workflow.on).toHaveProperty('pull_request');
  });

  it('re-fires on ready_for_review — the first move of the incident', () => {
    // Naming `types:` REPLACES GitHub's default set rather than extending it,
    // so the three defaults have to be restated alongside the addition. This
    // asserts the addition AND that restating did not drop one.
    expect(workflow.on.pull_request.types).toEqual([
      'opened',
      'synchronize',
      'reopened',
      'ready_for_review',
    ]);
  });

  it('carries no path filter on either leg — a skipped job counts as SUCCESS', () => {
    // The one direction this gate may not be wrong in. A path filter that
    // mis-scopes hands branch protection a green verdict from a job that never
    // ran, on the one check whose entire purpose is to refuse.
    for (const leg of ['pull_request', 'merge_group'] as const) {
      const on = workflow.on[leg] ?? {};
      expect(on).not.toHaveProperty('paths');
      expect(on).not.toHaveProperty('paths-ignore');
    }
  });

  it('checks out full history — a truncated diff answers with silence', () => {
    const checkout = job.steps.find((s: Record<string, string>) => String(s.uses ?? '').startsWith('actions/checkout'));
    expect(checkout, 'the job must check out the repository').toBeDefined();
    expect(checkout.with['fetch-depth']).toBe(0);
  });

  it('grants pull-requests: read and no write scope anywhere', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
  });

  it('runs the self-test BEFORE the live judgment, as its precondition', () => {
    const runs: string[] = job.steps
      .filter((s: Record<string, string>) => typeof s.run === 'string')
      .map((s: Record<string, string>) => s.run);
    const selfTestAt = runs.findIndex((r) => r.includes(`${GATE} --self-test`));
    const liveAt = runs.findIndex((r) => r.includes(GATE) && !r.includes('--self-test'));
    expect(selfTestAt, 'the workflow must run the self-test').toBeGreaterThan(-1);
    expect(liveAt, 'the workflow must run the live judgment').toBeGreaterThan(-1);
    expect(selfTestAt).toBeLessThan(liveAt);
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

  it('every declared surface exists in this tree', () => {
    for (const surface of GOVERNED_SURFACES) {
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
