import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';

import { rootCiPath, UI_JOBS } from './helpers/root-ci';

/**
 * objectui#6577 — cache bookkeeping voided a verdict the gate had already
 * recorded; objectstack#25869 — the root ui jobs that objectui's CI became.
 *
 * On 2026-08-26 the merge-group build of objectui#6571 was ejected from the
 * queue with `CI_FAILURE` while every substantive check passed. All 21 real
 * steps of objectui's `Type Check` job succeeded, and then `Post Turbo Cache`,
 * the save phase of `actions/cache@v6`, spent 13m09s inside the upload and was
 * still there when the job's ceiling fired. The job went `cancelled`, the merge
 * queue cannot tell `cancelled` from `failure`, and a pull request that had
 * passed was dequeued. The same job on the same head thirteen minutes earlier
 * saved its cache in ONE SECOND: a transient, not a property of the workflow.
 *
 * The ordering is the whole point: a job's verdict is recorded by its command
 * steps, and everything after them is bookkeeping, which must be bounded and
 * must not be able to speak for the code. objectui pinned that on its own
 * `type-check` job. The port to the objectstack monorepo's root `ci.yml`
 * (objectstack#25697) carried the jobs over on combined `actions/cache` steps
 * and unbounded saves, and objectstack#25879 retired this file with the nested
 * workflow it read; objectstack#25869 bounded the root jobs' saves and
 * restores it here, by path, over every ui job and `ui-deps`, the job that
 * builds the seven @objectstack packages once per run for the other four.
 *
 * Why this needs a pin at all — the fix is invisible when reverted. Folding a
 * split back into one `actions/cache` step, or dropping either key from a
 * save, restores the defect with nothing going red: the cache still works,
 * every run still passes, and the next transient upload stall cancels the next
 * green check (objectui#3009, #3181, #3494: "looks like enforcement, isn't").
 *
 * Deliberately NOT asserted: that a restore is bounded. A restore stall fails
 * BEFORE any verdict exists — a gate that did not run, which is honest.
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
  name?: string;
  needs?: string | string[];
  if?: string;
  'timeout-minutes'?: number;
  steps: Step[];
}

const workflow = parseYaml(fs.readFileSync(rootCiPath, 'utf8')) as { jobs: Record<string, Job> };

/** The job that builds the seven packages once and hands them to the four. */
const DEPS_JOB = 'ui-deps';
const CACHE_JOBS = [DEPS_JOB, ...Object.values(UI_JOBS)];

/**
 * Each job's ceiling as derived beside it in ci.yml. A pin, not a restatement
 * of a derivation: moving one is a decision that re-derives it there and moves
 * it here in the same commit.
 *   - type-check-ui: the value it was ported with; objectui's own rule here
 *     was "does not rise" (#6577's ruled-out non-fix).
 *   - lint-ui, build-e2e-ui: #25869 row F13, the ceiling comment above lint-ui.
 *   - ui-deps: the derivation on that job.
 */
const CEILINGS: Record<string, number> = {
  [DEPS_JOB]: 25,
  [UI_JOBS.typeCheck]: 40,
  [UI_JOBS.lint]: 30,
  [UI_JOBS.buildE2e]: 25,
};

function job(key: string): Job {
  const found = workflow.jobs[key];
  expect(found, `ci.yml must still define a \`${key}:\` job`).toBeDefined();
  // Non-vacuity: every assertion below scans this step list, so a parse that
  // collapsed it to nothing would make all of them pass while reading nothing.
  expect(found.steps.length, `the \`${key}\` job parsed to implausibly few steps`).toBeGreaterThan(5);
  return found;
}

const isSave = (s: Step) => (s.uses ?? '').startsWith('actions/cache/save@');
const isRestore = (s: Step) => (s.uses ?? '').startsWith('actions/cache/restore@');
const BUILD_STEP = 'Build the @objectstack packages objectui consumes';
const DOWNLOAD_STEP = 'Download the @objectstack packages objectui consumes';

describe('root ci.yml — the ui jobs\' cache saves are bounded and non-fatal (objectui#6577)', () => {
  it('reads the saves it is about', () => {
    // Non-vacuity for the per-save cases below: ui-deps saves the turbo seed
    // and the pnpm store; type-check-ui and lint-ui save their turbo seeds.
    const saves = CACHE_JOBS.flatMap((key) => job(key).steps.filter(isSave));
    expect(saves.length, 'the five ui jobs declare implausibly few cache saves').toBeGreaterThanOrEqual(4);
    expect(
      job(UI_JOBS.typeCheck).steps.filter((s) => isSave(s) && s.with?.path === '.turbo/cache').length,
      'the `type-check-ui` job must save `.turbo/cache` through exactly one `actions/cache/save` step',
    ).toBe(1);
  });

  it.each(CACHE_JOBS)('%s saves through MAIN-phase steps, never the combined action', (key) => {
    // Combined `actions/cache` declares `post: dist/save/index.js`: its save is
    // a step the RUNNER generates at job end, and no workflow syntax attaches
    // `timeout-minutes` or `continue-on-error` to a generated post step.
    // Splitting is the only way the keys below can exist at all.
    const combined = job(key)
      .steps.filter((s) => /^actions\/cache@/.test(s.uses ?? ''))
      .map((s) => s.name ?? '(unnamed)');
    expect(
      combined,
      `the \`${key}\` job is back on the combined \`actions/cache\` action:\n` +
        combined.map((n) => `  - ${n}`).join('\n') +
        '\n\nIts save runs as a runner-generated POST step, which cannot carry `timeout-minutes` or ' +
        '`continue-on-error`, so an upload stall runs the job into its ceiling and cancels a check ' +
        'that had already passed (objectui#6577). Use `actions/cache/restore` plus a bounded ' +
        '`actions/cache/save`.',
    ).toEqual([]);
  });

  it.each(CACHE_JOBS)('%s bounds every save, and no failed save speaks for the code', (key) => {
    for (const save of job(key).steps.filter(isSave)) {
      expect(
        typeof save['timeout-minutes'],
        `\`${key}\` › "${save.name}" must declare \`timeout-minutes\`: it is the only thing between a ` +
          'stalled upload and the job ceiling, and the ceiling reports `cancelled` (objectui#6577).',
      ).toBe('number');
      expect(
        save['continue-on-error'],
        `\`${key}\` › "${save.name}" must declare \`continue-on-error: true\`. Without it the bound only ` +
          'trades a `cancelled` check for a red one, and a cache that failed to upload says nothing ' +
          'about the code under test.',
      ).toBe(true);
    }
  });

  it.each(CACHE_JOBS)('%s leaves the verdict at least as much ceiling as bookkeeping can take', (key) => {
    const j = job(key);
    const ceiling = j['timeout-minutes'];
    expect(typeof ceiling, `the \`${key}\` job must declare \`timeout-minutes\``).toBe('number');
    for (const save of j.steps.filter(isSave)) {
      expect(
        (save['timeout-minutes'] as number) * 2,
        `\`${key}\` › "${save.name}" may run for ${save['timeout-minutes']} of the job's ${ceiling} ` +
          'minutes; a bound that large can still starve the checking steps and cancel the job.',
      ).toBeLessThanOrEqual(ceiling as number);
    }
  });

  it.each(CACHE_JOBS)('%s saves AFTER every command step — bookkeeping follows the verdict', (key) => {
    const steps = job(key).steps;
    // The prune before a seed save is bookkeeping too, and a `run:` step; the
    // verdict is the last command that is neither.
    const lastCommand = steps
      .map((s) => s.run !== undefined && !/prune-turbo-cache\.mjs/.test(s.run))
      .lastIndexOf(true);
    expect(lastCommand, `the \`${key}\` job must still run commands`).toBeGreaterThan(-1);
    for (const save of steps.filter(isSave)) {
      expect(
        steps.indexOf(save),
        `\`${key}\` › "${save.name}" must come after the job's last command step, ` +
          `"${steps[lastCommand].name}": everything after it is bookkeeping, and that ordering is ` +
          'what makes the save safe to bound and safe to lose (objectui#6577).',
      ).toBeGreaterThan(lastCommand);
    }
  });

  it.each(CACHE_JOBS)('%s still caches what the combined step did', (key) => {
    // Same path, same key, and the save skipped on an exact hit of the
    // restore's primary key — which is how the combined action decided.
    const steps = job(key).steps;
    for (const save of steps.filter(isSave)) {
      const restores = steps.filter((s) => isRestore(s) && s.with?.path === save.with?.path);
      expect(restores.length, `\`${key}\` › "${save.name}" saves a path no step restores`).toBe(1);
      const [restore] = restores;
      expect(
        save.with?.key,
        `\`${key}\` › "${save.name}" must write the key "${restore.name}" asks for, or every run misses`,
      ).toBe(restore.with?.key);
      expect(restore.id, `\`${key}\` › "${restore.name}" needs an \`id\` for the save's guard`).toBeTruthy();
      expect(
        save.if ?? '',
        `\`${key}\` › "${save.name}" must skip on an exact hit of the primary key — ` +
          `\`steps.${restore.id}.outputs.cache-hit != 'true'\`; without it every re-run re-uploads a ` +
          'cache that already exists.',
      ).toContain(`steps.${restore.id}.outputs.cache-hit != 'true'`);
    }
  });

  it.each(Object.entries(CEILINGS))('%s keeps its derived ceiling of %i minutes', (key, ceiling) => {
    // Raising a ceiling does not fix a hung save: the hang runs longer and the
    // check still reports `cancelled` (objectui#6577, objectui#7048). Moving
    // one is a deliberate act: re-derive it beside the job, move it here.
    expect(job(key)['timeout-minutes'], `the \`${key}\` job ceiling moved`).toBe(ceiling);
  });
});

describe('root ci.yml — ui-deps builds the seven packages once for the ui jobs (objectstack#25869)', () => {
  const deps = () => job(DEPS_JOB);
  const step = (key: string, name: string) => {
    const found = job(key).steps.filter((s) => s.name === name);
    expect(found.length, `the \`${key}\` job must carry exactly one "${name}" step`).toBe(1);
    return found[0];
  };
  /** The build command with the carrier-only flags taken off. */
  const buildCommand = (run: string) =>
    run
      .replace(/\s*\\?\n?\s*--summarize --log-file=\S+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  const upload = () => {
    const found = deps().steps.filter((s) => (s.uses ?? '').startsWith('actions/upload-artifact@'));
    expect(found.length, '`ui-deps` must upload exactly one artifact').toBe(1);
    return found[0];
  };

  it('runs whenever any ui job runs', () => {
    // The union of the four conditions is Type Check UI's (and Build & E2E
    // UI's): Test UI and Lint UI run on a subset of it.
    expect(deps().if).toBe(job(UI_JOBS.typeCheck).if);
    expect(job(UI_JOBS.buildE2e).if).toBe(job(UI_JOBS.typeCheck).if);
  });

  it('hands over the pruned turbo cache, only when the prune found the build', () => {
    const up = upload();
    expect(up.with?.path?.replace(/\/$/, '')).toBe('.turbo/cache');
    expect(up.if ?? '').toContain("steps.prune-turbo-cache.outputs.save == 'true'");
    const steps = deps().steps;
    expect(steps.indexOf(up), 'the upload must follow the build').toBeGreaterThan(
      steps.indexOf(step(DEPS_JOB, BUILD_STEP)),
    );
  });

  it.each(Object.values(UI_JOBS))('%s waits for ui-deps without letting its result skip the job', (key) => {
    const j = job(key);
    const needs = Array.isArray(j.needs) ? j.needs : [j.needs];
    expect(needs).toContain(DEPS_JOB);
    // A job whose `if:` names no status function is SKIPPED when a job it
    // needs did not succeed. `!cancelled()` is what keeps a red or skipped
    // ui-deps from silently skipping a required ui check.
    expect(j.if ?? '', `the \`${key}\` job's \`if:\` must start with \`!cancelled()\``).toMatch(/^\$\{\{ !cancelled\(\) && /);
  });

  it.each(Object.values(UI_JOBS))('%s downloads the build fail-open, before the step that replays it', (key) => {
    const download = step(key, DOWNLOAD_STEP);
    expect(download.uses ?? '').toMatch(/^actions\/download-artifact@/);
    expect(download.with?.name, 'the download must name the artifact ui-deps uploads').toBe(upload().with?.name);
    expect(download.with?.path).toBe('.turbo/cache');
    expect(
      download['continue-on-error'],
      'no artifact must mean "build cold", never a red or skipped ui check',
    ).toBe(true);
    const steps = job(key).steps;
    expect(steps.indexOf(download)).toBeLessThan(steps.indexOf(step(key, BUILD_STEP)));
  });

  it.each(Object.values(UI_JOBS))('%s builds the closure ui-deps built, so every task replays', (key) => {
    // Filters do not enter a task hash, but a filter one side lacks is a task
    // the other never built: it would build cold in every ui job again.
    expect(buildCommand(step(key, BUILD_STEP).run ?? '')).toBe(buildCommand(step(DEPS_JOB, BUILD_STEP).run ?? ''));
  });
});
