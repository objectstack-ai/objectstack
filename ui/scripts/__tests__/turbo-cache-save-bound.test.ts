import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const CI = path.join(ROOT, '.github/workflows/ci.yml');

/**
 * objectui#6577 — cache bookkeeping voided a verdict the gate had already
 * recorded.
 *
 * On 2026-08-26 the merge-group build of #6571 was ejected from the queue with
 * `CI_FAILURE` while every substantive check passed. All 21 real steps of the
 * `Type Check` job succeeded — `Run type-check` reported success at 13:31:31Z —
 * and then `Post Turbo Cache`, the save phase of `actions/cache@v6`, spent
 * 13m09s (789s) inside the upload and was still there when the job's
 * `timeout-minutes: 20` fired at 20m02s. The job went `cancelled`, the merge
 * queue cannot tell `cancelled` from `failure`, and a pull request that had
 * passed was dequeued. It was transient, not structural: the same job on the
 * same PR head thirteen minutes earlier went green in 5m53s with a cache save
 * of ONE SECOND.
 *
 * The ordering is the whole point, and it is what this file exists to keep
 * true: the verdict is recorded by the job's command steps; everything after
 * them is bookkeeping. Bookkeeping must be bounded, and its failure must not
 * be able to speak for the code.
 *
 * Why this needs a pin at all — the fix is invisible when reverted. Folding
 * the split back into one `actions/cache` step, or dropping either key from
 * the save, restores the defect with nothing going red: the cache still works,
 * every run still passes, and the next transient upload stall ejects the next
 * green pull request. That is this repository's recurring "looks like
 * enforcement, isn't" class (objectui#3009, #3181, #3494), and it is why the
 * sibling #5304 apt fix shipped with `ensure-chromium-ready.test.ts` beside it.
 *
 * Deliberately NOT asserted: that the restore half is bounded. A restore stall
 * fails BEFORE any verdict exists — a gate that did not run, which is honest —
 * rather than a recorded verdict discarded, and bounding it would force a cold
 * check under the same job ceiling. That is a different card if it ever fires.
 */

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  id?: string;
  if?: string;
  'timeout-minutes'?: number;
  'continue-on-error'?: boolean;
  with?: Record<string, string>;
}
interface Job {
  'timeout-minutes'?: number;
  steps: Step[];
}

const workflow = parseYaml(fs.readFileSync(CI, 'utf8')) as { jobs: Record<string, Job> };

function typeCheckJob(): Job {
  const job = workflow.jobs['type-check'];
  expect(job, 'ci.yml must still define a `type-check:` job').toBeDefined();
  // Non-vacuity: every assertion below scans this step list, so a parse that
  // collapsed it to nothing would make all of them pass while reading nothing.
  expect(
    job.steps.length,
    'the `type-check` job parsed to implausibly few steps — the scan below would be vacuous',
  ).toBeGreaterThan(10);
  return job;
}

const saveStep = (job: Job): Step => {
  // By PATH: the job also saves the pinned @objectstack build (objectui#12957),
  // a second cache this file is not about.
  const found = job.steps.filter(
    (s) => (s.uses ?? '').startsWith('actions/cache/save@') && s.with?.path === '.turbo/cache',
  );
  expect(
    found.length,
    'the `type-check` job must save `.turbo/cache` through exactly one `actions/cache/save` ' +
      'step. That step is where the bound lives; without it there is nothing to bound.',
  ).toBe(1);
  return found[0];
};

describe('ci.yml — the type-check cache save is bounded and non-fatal (objectui#6577)', () => {
  it('saves through a MAIN-phase step, never the combined action', () => {
    // Combined `actions/cache` declares `main: dist/restore/index.js` and
    // `post: dist/save/index.js`. Its save is therefore a step the RUNNER
    // generates at job end (`Post Turbo Cache`, step #40 in the incident), and
    // no workflow syntax attaches `timeout-minutes` or `continue-on-error` to a
    // generated post step. Splitting is not a style preference — it is the only
    // way the two keys below can exist at all. `actions/cache`'s own
    // `save-always` deprecation text points at this same split.
    const combined = typeCheckJob()
      .steps.filter((s) => /^actions\/cache@/.test(s.uses ?? ''))
      .map((s) => s.name ?? '(unnamed)');

    expect(
      combined,
      'the `type-check` job is back on the combined `actions/cache` action:\n' +
        combined.map((n) => `  - ${n}`).join('\n') +
        '\n\nIts save runs as a runner-generated POST step, which cannot carry ' +
        '`timeout-minutes` or `continue-on-error` — so an upload stall runs the job into its ' +
        'ceiling and cancels a gate that had already passed (objectui#6577). Use ' +
        '`actions/cache/restore` plus a bounded `actions/cache/save`.',
    ).toEqual([]);
  });

  it('bounds the save, and does not let a failed save speak for the code', () => {
    const save = saveStep(typeCheckJob());

    expect(
      typeof save['timeout-minutes'],
      'the cache save step must declare `timeout-minutes`. It is the only thing standing ' +
        'between a stalled upload and the job ceiling, and the job ceiling reports `cancelled` — ' +
        'a gate that says nothing at all (objectui#6577).',
    ).toBe('number');

    expect(
      save['continue-on-error'],
      'the cache save step must declare `continue-on-error: true`. Without it the bound only ' +
        'trades a `cancelled` gate for a red one: a cache that failed to upload costs the next ' +
        'run some time and says nothing about the code under test.',
    ).toBe(true);
  });

  it('leaves the verdict path at least as much ceiling as bookkeeping can consume', () => {
    // Derived rather than hard-coded: whatever the two numbers become, the
    // bookkeeping half must not be able to crowd out the half that produces the
    // answer. At the values this landed with (5 of 20) the save cannot reach
    // the ceiling from any verdict path yet observed — the slowest on record
    // finished 6m53s in.
    const job = typeCheckJob();
    const ceiling = job['timeout-minutes'];
    const bound = saveStep(job)['timeout-minutes'];

    expect(typeof ceiling, 'the `type-check` job must still declare `timeout-minutes`').toBe('number');
    expect(
      (bound as number) * 2,
      `the cache save may run for ${bound} of the job's ${ceiling} minutes. A bound that large ` +
        'can still starve the checking steps of the ceiling and cancel the job — which is the ' +
        'defect, not the fix.',
    ).toBeLessThanOrEqual(ceiling as number);
  });

  it('runs the save AFTER every command step — bookkeeping follows the verdict', () => {
    // The card's central sentence, made mechanical. A save hoisted above a
    // checking step is bookkeeping that can still delay, and be blamed for, an
    // answer that has not been produced yet.
    const job = typeCheckJob();
    const lastCommand = job.steps.map((s) => s.run !== undefined).lastIndexOf(true);
    const saveAt = job.steps.indexOf(saveStep(job));

    expect(lastCommand, 'the `type-check` job must still run commands').toBeGreaterThan(-1);
    expect(
      saveAt,
      "the cache save must come after the job's last command step. The verdict is recorded by " +
        `\`${job.steps[lastCommand].name}\`; everything after it is bookkeeping, and that ordering ` +
        'is what makes the save safe to bound and safe to lose (objectui#6577).',
    ).toBeGreaterThan(lastCommand);
  });

  it('still caches the same thing the combined step did', () => {
    // The split must not quietly stop caching. Same path, same key, and the
    // save guarded on the restore's `cache-hit` — which is how the combined
    // action itself decided to skip a save after an exact primary-key hit.
    const job = typeCheckJob();
    const save = saveStep(job);
    const restores = job.steps.filter(
      (s) => (s.uses ?? '').startsWith('actions/cache/restore@') && s.with?.path === '.turbo/cache',
    );

    expect(restores.length, 'the `type-check` job must restore `.turbo/cache`').toBe(1);
    const restore = restores[0];

    expect(restore.with?.path, 'the restore step must still name `.turbo/cache`').toBe('.turbo/cache');
    expect(
      save.with?.path,
      'the save step must write back the same path the restore step read, or the split has ' +
        'silently stopped caching',
    ).toBe(restore.with?.path);
    expect(
      save.with?.key,
      'the save step must write the same key the restore step asked for, or every run misses',
    ).toBe(restore.with?.key);

    expect(
      restore.id,
      'the restore step needs an `id` so the save step can read its `cache-hit` output',
    ).toBeTruthy();
    expect(
      save.if ?? '',
      `the save step must skip on an exact hit of the primary key — ` +
        `\`steps.${restore.id}.outputs.cache-hit != 'true'\`. The combined action did this ` +
        `internally; after the split it is the workflow's job, and without it every re-run ` +
        `re-uploads a cache that already exists.`,
    ).toContain(`steps.${restore.id}.outputs.cache-hit != 'true'`);
  });

  it('does not raise the job ceiling, which is the ruled-out non-fix', () => {
    // Ruled out on the card itself: a larger ceiling buys a longer hang and
    // still ends in `cancelled`, and lifting a gate's ceiling weakens the gate.
    // Raising this for some UNRELATED reason is a decision someone may well
    // need to make — make it deliberately, and move this pin in the same
    // commit, rather than discovering later that #6577's fix was undone by it.
    expect(
      typeCheckJob()['timeout-minutes'],
      'the `type-check` job ceiling moved. Raising it does not fix a hung cache save — the hang ' +
        'just runs longer and the gate still reports `cancelled` (objectui#6577).',
    ).toBeLessThanOrEqual(20);
  });
});
