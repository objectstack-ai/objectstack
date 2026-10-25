import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * objectui#7048 — every cache save in this repository is bounded and non-fatal,
 * not just `ci.yml`'s `type-check` one.
 *
 * ## Why a second file beside `turbo-cache-save-bound.test.ts`
 *
 * That file is about ONE INCIDENT and one job: the 2026-08-26 merge-group build
 * of #6571, where all 21 real steps of `Type Check` passed and then the
 * runner-generated `Post Turbo Cache` spent 13m09s (789s) in the upload, hit the
 * job's `timeout-minutes: 20`, and turned an all-green pull request into a
 * `cancelled` check the merge queue could not tell from a failure. Its
 * assertions are sized against that job's numbers and it should stay that way.
 *
 * This file is about the POPULATION. When #6577's fix landed, seven more
 * combined `actions/cache@v6` uses across five workflows carried the identical
 * exposure — that was the repository's DEFAULT SPELLING for caching, not an edge
 * case on one job — and nothing in the tree noticed. So the subject here is the
 * rule rather than the site: enumerate every workflow file, and require of every
 * cache save what #6577 proved a cache save must have.
 *
 * ## The ordering, which is the whole point
 *
 * The verdict is recorded by the checking steps; everything after them is
 * bookkeeping, and bookkeeping must never discard an answer the gate already
 * produced. Combined `actions/cache` declares `main: dist/restore/index.js` plus
 * `post: dist/save/index.js`, so its save is a step the RUNNER generates at job
 * end and NO workflow syntax attaches `timeout-minutes` or `continue-on-error`
 * to it. Splitting into `actions/cache/restore` + a trailing
 * `actions/cache/save` is not a style preference — it is the only way those two
 * keys can exist at all, and it is the route `actions/cache`'s own `save-always`
 * deprecation text points at.
 *
 * ## Why it needs a pin: reverting is invisible
 *
 * Fold any split back into one `actions/cache` step and nothing goes red. The
 * cache still works, every run still passes, and the next transient upload stall
 * ejects the next green pull request. Until objectui#7270 three of these jobs
 * declared no `timeout-minutes` at all, so the same stall held a required
 * context open against GitHub's 360-minute default instead; those three now
 * carry ceilings derived from their own run distributions, and the last pins in
 * this file are what keep them. That is this repository's recurring "looks like
 * enforcement, isn't" class (objectui#3009, #3181, #3494).
 *
 * ## The ceilings outgrew the cache (objectui#7956)
 *
 * objectui#7270 bounded the CACHED half of that exposure; objectui#7956 measured
 * the other six jobs, which cache nothing at all, and closed them the same way.
 * So the last three pins in this file are no longer about caching — they are
 * about job ceilings, which is why they live beside the cache rules rather than
 * in a new file: both are "a key whose deletion is invisible in every run", and
 * splitting them would give a future reader two places to look for one rule.
 *
 * Those six divided in two, and BOTH halves are pinned, because both are
 * decisions someone made:
 *
 *   - Four had a distribution to derive from, and carry a ceiling with the
 *     derivation written beside the key.
 *   - Two did not, and carry NO ceiling ON PURPOSE, with the reason written
 *     beside the job. Pinning an ABSENCE reads oddly until you notice the
 *     failure mode it catches: someone tidying up the inconsistency by copying
 *     `20` onto them, which is precisely the inherited number objectui#7048
 *     fences and objectui#7956's triage forbade.
 *
 * ⚠️ That second half is now ONE job, not two. `stale.yml::stale` was the other
 * one, and objectui#8548 deleted the whole workflow under enforce-or-remove:
 * eight months, 236 runs, zero successes, zero consumers. Its entry left the
 * `accepted` table in that same commit, because a pin naming a job that no
 * longer exists fails on the lookup and says nothing about ceilings.
 * ⛔ Do not read the shrink as the rule weakening — `changelog.yml::changelog`
 * still holds it, and the case it catches (copying `20` onto an unmeasured job)
 * is unchanged. ⭐ A job leaving this table by being DELETED and a job leaving
 * it by acquiring a derived ceiling are opposite events; only the second one
 * moves an entry into the `derived` table above.
 *
 * ## Deliberately NOT asserted
 *
 * - That the RESTORE halves are bounded. A restore stall fails BEFORE any
 *   verdict exists — a gate that did not run, which is honest — rather than a
 *   recorded verdict discarded, and bounding it would force a cold check under
 *   the same ceiling.
 * - Any specific bound. Each site's number is derived from that site's own
 *   measured healthy save and written into the workflow comment beside it;
 *   objectui#7048 fences copying one site's number to another. What is asserted
 *   is that a bound EXISTS and that it cannot crowd out the checking steps.
 */

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const WORKFLOW_DIR = path.join(ROOT, '.github/workflows');

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
  steps?: Step[];
}

const workflowFiles = fs
  .readdirSync(WORKFLOW_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .sort();

interface JobEntry {
  file: string;
  jobKey: string;
  job: Job;
  steps: Step[];
}

const allJobs: JobEntry[] = workflowFiles.flatMap((file) => {
  const parsed = parseYaml(fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8')) as {
    jobs?: Record<string, Job>;
  };
  return Object.entries(parsed?.jobs ?? {}).map(([jobKey, job]) => ({
    file,
    jobKey,
    job,
    steps: job.steps ?? [],
  }));
});

const usesPrefix = (step: Step, prefix: string) => (step.uses ?? '').startsWith(prefix);
const where = (e: JobEntry, s: Step) => `${e.file} :: job \`${e.jobKey}\` :: step \`${s.name ?? '(unnamed)'}\``;

describe('every workflow cache save is bounded and non-fatal (objectui#7048)', () => {
  it('reads a plausible population — the scan below is not vacuous', () => {
    // The enumeration is the axis that failed when this card was first filed:
    // the population was inherited from one file's grep instead of derived
    // across the directory, and undercounted by more than 3x. A control that
    // only proves the PROBE works cannot catch that; this one is on the
    // population itself.
    expect(
      workflowFiles.length,
      `implausibly few workflow files found under ${WORKFLOW_DIR} — every assertion below would ` +
        'pass while reading nothing',
    ).toBeGreaterThan(20);
    expect(allJobs.length, 'implausibly few jobs parsed out of those workflow files').toBeGreaterThan(20);
  });

  it('caches through the split form only — never the combined action', () => {
    const offenders = allJobs.flatMap((e) =>
      e.steps.filter((s) => /^actions\/cache@/.test(s.uses ?? '')).map((s) => where(e, s)),
    );

    expect(
      offenders,
      'these steps use the COMBINED `actions/cache` action:\n' +
        offenders.map((o) => `  - ${o}`).join('\n') +
        '\n\nIts save runs as a runner-generated POST step, which cannot carry `timeout-minutes` ' +
        'or `continue-on-error` — so an upload stall runs the job into its ceiling and cancels a ' +
        'gate that had already passed (objectui#6577), or, in a job with no declared ceiling, ' +
        "holds it against GitHub's 360-minute default. Use `actions/cache/restore` plus a bounded, " +
        '`continue-on-error` `actions/cache/save` placed after the last command step.',
    ).toEqual([]);
  });

  it('actually caches something — the rule above is not passing on an empty set', () => {
    // Without this, deleting every cache step in the repository would make the
    // assertion above green. The rule is "saves are bounded", not "there are no
    // saves".
    const saves = allJobs.flatMap((e) => e.steps.filter((s) => usesPrefix(s, 'actions/cache/save@')));
    expect(
      saves.length,
      'no workflow in this repository saves a cache any more. If that is deliberate, this whole ' +
        'file is obsolete and should be deleted with the reason recorded — not left passing on an ' +
        'empty set.',
    ).toBeGreaterThan(5);
  });

  it('bounds every save, and lets none of them speak for the code', () => {
    const unbounded: string[] = [];
    const fatal: string[] = [];

    for (const e of allJobs) {
      for (const s of e.steps.filter((x) => usesPrefix(x, 'actions/cache/save@'))) {
        if (typeof s['timeout-minutes'] !== 'number') unbounded.push(where(e, s));
        if (s['continue-on-error'] !== true) fatal.push(where(e, s));
      }
    }

    expect(
      unbounded,
      'these cache saves declare no `timeout-minutes`:\n' +
        unbounded.map((o) => `  - ${o}`).join('\n') +
        '\n\nThe bound is the only thing standing between a stalled upload and the job ceiling, ' +
        'and the job ceiling reports `cancelled` — a gate that says nothing at all (objectui#6577). ' +
        "Derive the number from that site's own measured healthy save; do not copy another site's.",
    ).toEqual([]);

    expect(
      fatal,
      'these cache saves do not declare `continue-on-error: true`:\n' +
        fatal.map((o) => `  - ${o}`).join('\n') +
        '\n\nWithout it the bound only trades a `cancelled` gate for a red one. A cache that ' +
        'failed to upload costs the next run some time and says nothing whatsoever about the code ' +
        'under test, so it must not be allowed to speak for it.',
    ).toEqual([]);
  });

  it('runs every save AFTER its job’s last command step — bookkeeping follows the verdict', () => {
    const hoisted: string[] = [];

    for (const e of allJobs) {
      const lastCommand = e.steps.map((s) => s.run !== undefined).lastIndexOf(true);
      if (lastCommand === -1) continue; // no commands in this job: nothing to protect
      for (const s of e.steps.filter((x) => usesPrefix(x, 'actions/cache/save@'))) {
        if (e.steps.indexOf(s) < lastCommand) {
          hoisted.push(`${where(e, s)} (runs before \`${e.steps[lastCommand].name ?? '(unnamed)'}\`)`);
        }
      }
    }

    expect(
      hoisted,
      'these cache saves run BEFORE their job’s last command step:\n' +
        hoisted.map((o) => `  - ${o}`).join('\n') +
        '\n\nThe verdict is recorded by the command steps; everything after them is bookkeeping, ' +
        'and that ordering is what makes a save safe to bound and safe to lose. A save hoisted ' +
        'above a checking step is bookkeeping that can still delay, and be blamed for, an answer ' +
        'that has not been produced yet (objectui#6577).',
    ).toEqual([]);
  });

  it('still caches the same thing the combined step did', () => {
    const broken: string[] = [];

    for (const e of allJobs) {
      const restores = e.steps.filter((s) => usesPrefix(s, 'actions/cache/restore@'));
      for (const save of e.steps.filter((s) => usesPrefix(s, 'actions/cache/save@'))) {
        const restore = restores.find((r) => r.with?.path === save.with?.path);
        if (!restore) {
          broken.push(`${where(e, save)}: no \`actions/cache/restore\` in this job reads path \`${save.with?.path}\``);
          continue;
        }
        if (save.with?.key !== restore.with?.key) {
          broken.push(`${where(e, save)}: writes key \`${save.with?.key}\` but the restore asks for \`${restore.with?.key}\` — every run would miss`);
        }
        if (!restore.id) {
          broken.push(`${where(e, restore)}: needs an \`id\` so the save can read its \`cache-hit\` output`);
          continue;
        }
        const guard = `steps.${restore.id}.outputs.cache-hit != 'true'`;
        if (!(save.if ?? '').includes(guard)) {
          broken.push(`${where(e, save)}: must skip on an exact primary-key hit — \`${guard}\`. The combined action did this internally; after the split it is the workflow’s job, and without it every re-run re-uploads a cache that already exists.`);
        }
      }
    }

    expect(broken, 'the split has silently changed what gets cached:\n' + broken.map((o) => `  - ${o}`).join('\n')).toEqual([]);
  });

  it('never lets bookkeeping crowd out the checking steps under a declared ceiling', () => {
    // Generalises the type-check pin's invariant to jobs with more than one
    // cache: it is the SUM of a job's save bounds that competes with its
    // verdict path for the ceiling, not any single bound.
    const crowded: string[] = [];

    for (const e of allJobs) {
      const ceiling = e.job['timeout-minutes'];
      if (typeof ceiling !== 'number') continue;
      const bounds = e.steps
        .filter((s) => usesPrefix(s, 'actions/cache/save@'))
        .map((s) => s['timeout-minutes'] ?? 0);
      if (bounds.length === 0) continue;
      const total = bounds.reduce((a, b) => a + b, 0);
      if (total * 2 > ceiling) {
        crowded.push(
          `${e.file} :: job \`${e.jobKey}\`: cache saves may run for ${total} of the job's ${ceiling} minutes (bounds: ${bounds.join(' + ')})`,
        );
      }
    }

    expect(
      crowded,
      'bookkeeping can starve the verdict path of its ceiling here:\n' +
        crowded.map((o) => `  - ${o}`).join('\n') +
        '\n\nA bound that large can still cancel the job — which is the defect, not the fix.',
    ).toEqual([]);
  });

  it('does not raise the ceilings of the jobs this card bounded — the ruled-out non-fix', () => {
    // Ruled out on objectui#6577 and again on #7048: a larger ceiling buys a
    // longer hang and still ends in `cancelled`, and lifting a gate's ceiling
    // weakens the gate. Raising one for some UNRELATED reason is a decision
    // someone may need to make — make it deliberately, and move this pin in the
    // same commit, rather than discovering later that the fix was undone by it.
    const ceilings: Record<string, number> = {
      'ci.yml::e2e': 30,
      'ci.yml::docs': 15,
      'live-e2e.yml::live-e2e': 40,
    };

    for (const [key, max] of Object.entries(ceilings)) {
      const [file, jobKey] = key.split('::');
      const entry = allJobs.find((e) => e.file === file && e.jobKey === jobKey);
      expect(entry, `${file} must still define a \`${jobKey}:\` job`).toBeDefined();
      expect(
        entry!.job['timeout-minutes'],
        `the \`${jobKey}\` job ceiling in ${file} moved. Raising it does not fix a hung cache save — ` +
          'the hang just runs longer and the gate still reports `cancelled` (objectui#6577).',
      ).toBeLessThanOrEqual(max);
    }
  });

  it('bounds the three jobs objectui#7270 found running under the 360-minute default', () => {
    // Presence and bound in one assertion, because the two ways this can be
    // undone need the same fix site and neither is visible in a run.
    //
    //   - Delete the key and the job silently returns to GitHub's 360-minute
    //     default. Nothing goes red: a healthy job never approaches any
    //     ceiling, so the only symptom is the next transient hang holding a
    //     required context for six hours and then reporting `cancelled` — a
    //     verdict the merge queue cannot tell from `failure` (objectui#5304,
    //     objectui#6577 are the two times this repository has paid it).
    //   - Raise the number and objectui#7048's fence is crossed in the other
    //     direction: a larger ceiling buys a longer hang and still ends in
    //     `cancelled`.
    //
    // Each number is DERIVED FOR ITS OWN JOB from that job's measured run
    // distribution, and the derivation is written beside the key in the
    // workflow — window, sample size, min/median/p95/max, and the rule.
    // objectui#7048 fences copying `ci.yml`'s 10/15/20/30/40, so the three
    // values here are not a shared constant and two of them being equal is a
    // coincidence of the arithmetic. Pinning them means a future change to one
    // has to move the derivation beside it in the same commit.
    const derived: Record<string, number> = {
      'lint.yml::lint': 25,
      'performance-budget.yml::bundle-analysis': 25,
      'changeset-release.yml::release': 40,
    };

    const missing: string[] = [];
    const raised: string[] = [];

    for (const [key, ceiling] of Object.entries(derived)) {
      const [file, jobKey] = key.split('::');
      const entry = allJobs.find((e) => e.file === file && e.jobKey === jobKey);
      expect(entry, `${file} must still define a \`${jobKey}:\` job`).toBeDefined();

      const declared = entry!.job['timeout-minutes'];
      if (typeof declared !== 'number') {
        missing.push(`${file} :: job \`${jobKey}\``);
      } else if (declared > ceiling) {
        raised.push(`${file} :: job \`${jobKey}\` declares ${declared}, derived ${ceiling}`);
      }
    }

    expect(
      missing,
      'these jobs declare no job-level `timeout-minutes`, so their only backstop is GitHub\'s ' +
        '360-minute default again:\n' +
        missing.map((o) => `  - ${o}`).join('\n') +
        '\n\nTwo of them are required contexts and one is the publish lane. Restore the key ' +
        'TOGETHER WITH the derivation comment beside it — a ceiling with no recorded provenance ' +
        'is the next reader\'s excuse to guess at it (objectui#7270).',
    ).toEqual([]);

    expect(
      raised,
      'these job ceilings are above the value derived for them:\n' +
        raised.map((o) => `  - ${o}`).join('\n') +
        '\n\nRaising a ceiling does not fix a hang — it buys a longer one and the gate still ' +
        'reports `cancelled` (objectui#6577, objectui#7048). If a job genuinely got slower, ' +
        're-derive it from a fresh distribution, rewrite the comment beside the key, and move ' +
        'this pin in the same commit.',
    ).toEqual([]);
  });

  it('bounds the four jobs objectui#7956 derived a ceiling for', () => {
    // The uncached half of the same exposure. objectui#7270 scoped itself to
    // jobs that cache; these six cache nothing, so the cache-save hazard above
    // is absent and what they carried was the generic one: GitHub's 360-minute
    // default and a `cancelled` verdict at the end of it.
    //
    // ⚠️ NONE of these four produces a required status check — re-measured on
    // the `main` ruleset (`Lint`, `Type Check`, `Build & E2E`, the four `Test
    // (shard n/4)`, `Build Docs`, `Changeset Declaration`). So objectui#7270's
    // shared-serial-queue stakes do not carry over, and the numbers below are
    // not carried over either.
    //
    // ⚠️ All four are 20 and that is NOT a shared constant, which is the exact
    // thing objectui#7048 fences and objectui#7956's triage forbade in writing.
    // Each was derived from its own sample by objectui#7270's rule — the
    // smallest round number that is both >= 3x that job's max and >= that job's
    // max + 15min — and the additive term dominates for every job whose slowest
    // run is under 7.5 minutes, so the rule lands every sub-minute job on the
    // same rung. Their measured maxima differ (43s, 31s, 13s, 12s); their
    // ceilings coincide. The derivation beside each key is what makes that
    // checkable, and moving any one of these numbers means rewriting the
    // derivation beside it in the same commit.
    const derived: Record<string, number> = {
      'changeset-release.yml::lane': 20,
      'check-links.yml::check-links': 20,
      'cross-repo-issue-closer.yml::close-foreign-issues': 20,
      'labeler.yml::label': 20,
    };

    const missing: string[] = [];
    const raised: string[] = [];

    for (const [key, ceiling] of Object.entries(derived)) {
      const [file, jobKey] = key.split('::');
      const entry = allJobs.find((e) => e.file === file && e.jobKey === jobKey);
      expect(entry, `${file} must still define a \`${jobKey}:\` job`).toBeDefined();

      const declared = entry!.job['timeout-minutes'];
      if (typeof declared !== 'number') {
        missing.push(`${file} :: job \`${jobKey}\``);
      } else if (declared > ceiling) {
        raised.push(`${file} :: job \`${jobKey}\` declares ${declared}, derived ${ceiling}`);
      }
    }

    expect(
      missing,
      'these jobs declare no job-level `timeout-minutes`, so their only backstop is GitHub\'s ' +
        '360-minute default again:\n' +
        missing.map((o) => `  - ${o}`).join('\n') +
        '\n\nNone of them blocks a pull request, so nothing goes red when this key disappears — ' +
        'the only symptom is the next wedged run holding a runner for six hours. Restore the key ' +
        'TOGETHER WITH the derivation comment beside it; a ceiling with no recorded provenance is ' +
        "the next reader's excuse to guess at it (objectui#7270, objectui#7956).",
    ).toEqual([]);

    expect(
      raised,
      'these job ceilings are above the value derived for them:\n' +
        raised.map((o) => `  - ${o}`).join('\n') +
        '\n\nRaising a ceiling does not fix a hang — it buys a longer one and the gate still ' +
        'reports `cancelled` (objectui#6577, objectui#7048). If a job genuinely got slower, ' +
        're-derive it from a fresh distribution, rewrite the comment beside the key, and move ' +
        'this pin in the same commit.',
    ).toEqual([]);
  });

  it('keeps the job objectui#7956 could not measure UNBOUNDED, with its reason recorded', () => {
    // The other half of objectui#7956, and the half that is easy to undo by
    // being helpful. Four of its six jobs got a ceiling; this one did not,
    // because it has no distribution that measures the job doing its work:
    //
    //   - `changelog.yml::changelog` — `total_count: 0` runs, ever. It is
    //     dispatch-only and has never been dispatched. (Control on the same
    //     endpoint: `changeset-release.yml` answers with thousands, so the zero
    //     is a reading and not a broken query.)
    //
    // objectui#7956 left TWO jobs here. The second was `stale.yml::stale` — 234
    // completed runs, 0 successful, over eight months, every sampled one failing
    // in `Set up job` before the marketplace action started, so its 1-4 seconds
    // measured how fast the job failed to begin rather than any work it did.
    // objectui#8548 deleted that workflow outright (enforce-or-remove: zero
    // consumers, zero successes), which is why this table lists one key and not
    // two. ⛔ Re-adding `stale.yml::stale` here does not restore a pin — the
    // lookup below would fail on a workflow that is gone.
    //
    // A number invented for it would look derived and be a guess, and a
    // ceiling under a job's honest slowest run converts a working job into a
    // permanently red one — objectui#7048's fence, and objectstack#16173 is the
    // live counter-example (a distribution mis-estimated by ~2.6x killed a test
    // shard while the rollup read green).
    //
    // So this pin asserts an ABSENCE plus a RECORD, and the record is the point:
    // the failure it catches is a future tidy-up that copies `20` off the four
    // jobs above onto these two. Adding a real ceiling here is welcome — derive
    // it from runs that did the work, write the derivation beside the key, and
    // move the entry up into the `derived` table above in the same commit.
    const accepted = ['changelog.yml::changelog'];

    const bounded: string[] = [];
    const undocumented: string[] = [];

    for (const key of accepted) {
      const [file, jobKey] = key.split('::');
      const entry = allJobs.find((e) => e.file === file && e.jobKey === jobKey);
      expect(entry, `${file} must still define a \`${jobKey}:\` job`).toBeDefined();

      if (typeof entry!.job['timeout-minutes'] === 'number') {
        bounded.push(`${file} :: job \`${jobKey}\` now declares ${entry!.job['timeout-minutes']}`);
      }

      // The decision has to be READABLE at the job, not only in a merged pull
      // request. Two stable tokens rather than a wording: the default being
      // accepted, and the card that accepted it.
      const prose = fs
        .readFileSync(path.join(WORKFLOW_DIR, file), 'utf8')
        .split('\n')
        .filter((line) => /^\s*#/.test(line))
        .join('\n');
      if (!prose.includes('360') || !prose.includes('objectui#7956')) {
        undocumented.push(`${file} (looked for \`360\` and \`objectui#7956\` in its comments)`);
      }
    }

    expect(
      bounded,
      'these jobs were deliberately left at the 360-minute default and now declare a ceiling:\n' +
        bounded.map((o) => `  - ${o}`).join('\n') +
        '\n\nIf that number was DERIVED from runs in which the job actually did its work, this is ' +
        'good news: write the derivation beside the key, move the entry into the `derived` table ' +
        'above, and delete it from here — in this same commit. If it was copied from the four jobs ' +
        'in that table, it is the inherited ceiling objectui#7048 fences: a number that looks ' +
        "derived, sits over a cost nobody has measured, and reds a working job the first time it " +
        'runs long (objectui#7956).',
    ).toEqual([]);

    expect(
      undocumented,
      'these jobs run under the 360-minute default with nothing beside them saying so on purpose:\n' +
        undocumented.map((o) => `  - ${o}`).join('\n') +
        '\n\nAn unbounded job that records WHY is a decision; one that records nothing is an ' +
        'oversight, and the two are indistinguishable to the next reader — which is how ' +
        'objectui#7956 came to be filed in the first place.',
    ).toEqual([]);
  });
});
