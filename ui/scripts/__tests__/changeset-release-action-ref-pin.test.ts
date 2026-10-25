import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * The pin on `changesets/action`'s ref in
 * `.github/workflows/changeset-release.yml` (objectui#6081).
 *
 * ## Why this file exists at all
 *
 * `.github/workflows/**` is read by nothing else in this repository: not the
 * type checker, not the linters, not a schema. So a deliberate bump of that
 * action lands with no mechanical objection anywhere — and two lanes of that
 * workflow are built on properties asserted against **v1's source**:
 *
 *   (1) THE DISPATCH TABLE. `!hasChangesets && hasPublishScript -> runPublish`
 *       (v1's `src/index.ts`). The "Clear pending changesets for the publish
 *       branch" step exists ONLY because the action picks its branch from
 *       repository state rather than from an input. If a later major takes an
 *       explicit instruction instead, that step is not a workaround to keep —
 *       it is dead weight, and keeping it would be the bug.
 *   (2) `runPublish` NEVER COMMITS AND NEVER PUSHES A BRANCH. Verified in v1's
 *       `src/run.ts`: the only git operation inside `runPublish` is
 *       `git.pushTag()` (lines 124 and 146); `git.prepareBranch()` (line 290)
 *       and `git.pushChanges()` (line 362) occur solely inside `runVersion`.
 *       THIS is what makes the clear step's deletion safe — it cannot leave the
 *       runner. v2 pushes via the GitHub API by default, which would put this
 *       property back in question rather than preserve it.
 *
 * Neither property is checkable from here. What IS checkable is the ref, so a
 * bump fails loudly and prompts someone to re-establish both before shipping.
 *
 * ## Why the assertion lives in its own file
 *
 * It used to be one `it()` inside `changeset-release-lane-mirror.test.ts`,
 * whose subject was the `lane` job's bash mirror of the action's file scan.
 * objectui#6081 deleted that mirror — but the ref pin was never about the
 * mirror. It guards property (1), which the clear step keeps depending on after
 * the mirror is gone. Deleting the mirror's test file wholesale would therefore
 * have removed the only thing in the repository that notices an action bump, in
 * the same commit that closed the hole the bump would widen. Hence a file whose
 * subject is the ref itself, which no future cleanup of something else can take
 * with it by accident.
 *
 * ⛔ If you are deleting this file, you are deleting the only mechanical guard
 * on that ref. Move the assertion somewhere that survives first — do not just
 * drop it.
 *
 * ## The ref is a commit sha, so a retag cannot reach it
 *
 * `changesets/action@v1` names a moving branch whose bundled `@changesets/read`
 * is a minified chunk nothing here installs, so no test can execute it and no
 * lockfile records it — that gap is objectui#6081's subject, and it is the
 * reason the mirror was deleted rather than given a better referent. Both
 * `uses:` lines now name the v1.9.0 commit instead, so a retag of `v1` in place
 * no longer changes what runs; this pin catches the DELIBERATE bump, which is
 * the only moment anyone can act on anyway, and a step that drifts back onto
 * the moving `v1`.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = path.join(repoRoot, '.github/workflows/changeset-release.yml');
const workflowSource = fs.readFileSync(workflowPath, 'utf8');

/**
 * The v1 commit, not the moving `v1` branch: `v1` and the `v1.9.0` tag both
 * resolved to this sha when the pin moved off the branch, and it is the commit
 * the workflow's git-surface reading was taken at. The publish step runs with
 * the npm token, so the ref it executes must not be able to move under it.
 */
const PINNED_SHA = 'a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d';
const PINNED_REF = `changesets/action@${PINNED_SHA}`;
const PINNED_LINE = `        uses: ${PINNED_REF} # v1.9.0`;

interface Step {
  name?: string;
  uses?: string;
}

/**
 * Every `uses:` in the workflow that resolves to the `changesets/action`
 * repository, sub-actions included.
 *
 * Matching on the repository rather than on the exact pinned string is what
 * makes a bump FAIL here instead of vanishing: `changesets/action/publish@v2`
 * is a different action path AND a different major, and a pin that only looked
 * for the literal `changesets/action@v1` would simply stop finding anything and
 * report a healthy green over a workflow that no longer contains it.
 */
function changesetsActionSteps(source: string): Array<{ job: string; step: string; uses: string }> {
  const workflow = parseYaml(source) as { jobs: Record<string, { steps?: Step[] }> };
  const found: Array<{ job: string; step: string; uses: string }> = [];
  for (const [job, definition] of Object.entries(workflow.jobs ?? {})) {
    for (const step of definition.steps ?? []) {
      if (typeof step.uses !== 'string') continue;
      const [actionPath] = step.uses.split('@');
      if (actionPath === 'changesets/action' || actionPath.startsWith('changesets/action/')) {
        found.push({ job, step: step.name ?? '(unnamed)', uses: step.uses });
      }
    }
  }
  return found;
}

describe('changeset-release.yml pins changesets/action to the v1.9.0 commit', () => {
  it('still uses the action at all — the pin is not vacuous', () => {
    // Without this, every assertion below passes over a workflow that dropped
    // the action entirely, which is the one way a "toContain" pin lies.
    const steps = changesetsActionSteps(workflowSource);
    expect(
      steps.length,
      'no step in changeset-release.yml uses changesets/action any more. If that is deliberate, this whole ' +
        'pin is obsolete and should be deleted WITH the reasoning that made it obsolete written down. If it ' +
        'is not deliberate, the release lane just lost its publish step.',
    ).toBeGreaterThan(0);
  });

  it('pins EVERY usage — the publish step and the refresh step alike', () => {
    const steps = changesetsActionSteps(workflowSource);
    const offenders = steps.filter((s) => s.uses !== PINNED_REF);
    expect(
      offenders.map((s) => `${s.job} / ${s.step}: ${s.uses}`),
      `changesets/action must stay at ${PINNED_REF} in every job. Both lanes of this workflow rest on ` +
        `properties asserted against v1's SOURCE — the dispatch table that makes the clear step necessary, ` +
        `and runPublish never committing or pushing a branch, which is what makes that step safe. v2 moves ` +
        `the dispatch into an opt-in select-mode sub-action and pushes via the GitHub API by default, so a ` +
        `bump does not preserve either property; it invalidates both. Re-measure them, update the ⛔ block ` +
        `above the publish step in the workflow, and update this test — in that order.`,
    ).toEqual([]);
  });

  it('names both usages, so a silently DROPPED lane is caught too', () => {
    // A bump is not the only way this workflow loses a property. Deleting the
    // refresh step would fossilise the version PR; deleting the publish step
    // would end releases. Either shows up here as a missing entry.
    const steps = changesetsActionSteps(workflowSource);
    expect(steps.map((s) => `${s.job} / ${s.step}`).sort()).toEqual([
      'release / Publish to npm',
      'release / Refresh the version PR',
    ]);
  });
});

describe('the pin can fail (non-vacuity)', () => {
  // The pin is worth exactly what its red branch is worth, and a pin over a
  // file nothing else validates has no other way to show that it works. Each
  // mutation is asserted to have APPLIED before its result is read — a no-op
  // edit would leave the unmutated source under test and report a green that
  // means nothing.
  function mutate(from: string, to: string): string {
    const mutated = workflowSource.replace(from, to);
    expect(mutated, `mutation did not apply: ${from}`).not.toBe(workflowSource);
    return mutated;
  }

  it('goes red when the publish step is bumped to @v2', () => {
    const bumped = mutate(`${PINNED_LINE}\n        with:\n          publish:`, '        uses: changesets/action@v2\n        with:\n          publish:');
    const offenders = changesetsActionSteps(bumped).filter((s) => s.uses !== PINNED_REF);
    expect(offenders).toEqual([
      { job: 'release', step: 'Publish to npm', uses: 'changesets/action@v2' },
    ]);
  });

  it('goes red when the refresh step is bumped to @v2', () => {
    const bumped = mutate(`${PINNED_LINE}\n        with:\n          version:`, '        uses: changesets/action@v2\n        with:\n          version:');
    const offenders = changesetsActionSteps(bumped).filter((s) => s.uses !== PINNED_REF);
    expect(offenders).toEqual([
      { job: 'release', step: 'Refresh the version PR', uses: 'changesets/action@v2' },
    ]);
  });

  it('goes red when a usage is swapped for a v2 SUB-ACTION', () => {
    // The shape a real v2 migration takes: `changesets/action/publish@v2`. A
    // pin that matched only the exact old string would find nothing here and
    // pass.
    const bumped = mutate(`${PINNED_LINE}\n        with:\n          publish:`, '        uses: changesets/action/publish@v2\n        with:\n          publish:');
    const offenders = changesetsActionSteps(bumped).filter((s) => s.uses !== PINNED_REF);
    expect(offenders).toEqual([
      { job: 'release', step: 'Publish to npm', uses: 'changesets/action/publish@v2' },
    ]);
  });

  it('goes red when the publish step goes back to the moving v1 branch', () => {
    const floating = mutate(`${PINNED_LINE}\n        with:\n          publish:`, '        uses: changesets/action@v1\n        with:\n          publish:');
    const offenders = changesetsActionSteps(floating).filter((s) => s.uses !== PINNED_REF);
    expect(offenders).toEqual([
      { job: 'release', step: 'Publish to npm', uses: 'changesets/action@v1' },
    ]);
  });

  it('goes red when the action is dropped from the workflow entirely', () => {
    const stripped = mutate(PINNED_LINE, '        uses: actions/checkout@v7');
    expect(changesetsActionSteps(stripped).length).toBeLessThan(2);
  });
});
