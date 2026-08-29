#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-stall-guard-budget (#11916) -- a guard that cannot speak before its own
 * job dies is a silent no-op, and nothing was checking that it can.
 *
 *   node scripts/check-stall-guard-budget.mjs              # the gate
 *   node scripts/check-stall-guard-budget.mjs --list       # the census it judged
 *   node scripts/check-stall-guard-budget.mjs --self-test  # prove it can go red
 *
 * ## The gap
 *
 * `scripts/run-with-stall-guard.mjs` exists so that a stalled job SAYS it
 * stalled instead of sitting `in_progress` until the job timeout. That guarantee
 * holds only while the guard's own kill budget lands before its job's
 * `timeout-minutes`. If the budget ever crosses that line the job timeout wins,
 * the guard never prints a verdict, and the outcome is exactly the state the
 * guard was built to abolish.
 *
 * Nothing checked the relationship. Not `check-agent-test-spelling`, which
 * parses these same command lines for a different property; not
 * `check-ci-filter-parity`, which reads ci.yml for a different one. Measured on
 * `f907fbe9e`: `git grep -l 'timeout-minutes' scripts/` returns exactly ONE
 * file -- `run-with-stall-guard.mjs` itself -- and both of its hits are PROSE in
 * the header, explaining this very relationship. So the relationship was
 * documented at the one place that could not enforce it, and read by no code.
 *
 * ## Why it needs a gate rather than care
 *
 * The regression is INVISIBLE ON GREEN RUNS. The guard is observable only when
 * it fires, so a guard whose budget can no longer fire in time scores
 * identically to one that works -- every run green, on every PR, forever. It is
 * a one-line edit in either direction to get there:
 *
 *   * lower a job's `timeout-minutes` (a plausible "tighten CI" change),
 *   * raise `--stall-minutes`, or pass a `--stall-cap-minutes` above the job budget,
 *   * add a guard-wrapped step to a job that has a short timeout.
 *
 * ## What "the budget" is, exactly
 *
 * The guard's clock is `silentMs = Date.now() - lastOutputAt` and it kills at
 * `--stall-minutes`, unless the source-side liveness probe (#11855) sees the
 * wrapped group still writing, in which case the kill is DEFERRED to
 * `--stall-cap-minutes` under a distinct STALL-CAP verdict. So the LAST moment
 * at which this instrument can still speak is the cap, not the window. The
 * effective cap is what this gate resolves and judges:
 *
 *   explicit `--stall-cap-minutes`            -- when the step passes one
 *   `DEFAULT_CAP_MULTIPLE` x the window       -- when it does not
 *   the guard's own default window            -- when the step passes no window
 *
 * Both defaults are READ OUT OF `run-with-stall-guard.mjs` (with comments
 * masked), never copied here. A second copy of `2` and `10` in this file would
 * be two numbers that must agree with no one holding them to it -- the exact
 * shape this gate exists to close, one level up. Rename either declaration and
 * this gate REFUSES loudly instead of judging against a stale default.
 *
 * ## The criterion, and where its constant comes from
 *
 * Let W = the stall window, C = the effective cap, T = the binding
 * `timeout-minutes` (the step's own when it declares one, else the job's, else
 * GitHub's documented 360-minute default -- 23 of this repo's 51 workflow jobs
 * declare none).
 *
 * Write p for the time the job spends before the guarded step starts
 * (checkout / setup / install / restore), and s for how far into the step the
 * output actually froze. The guard's verdict lands at `p + s + C` in the worst
 * case, so it beats the job timeout exactly when `p + s < T - C`.
 *
 *   TIER 1 -- `C < T`. Necessary, and it needs no constant at all: at C >= T the
 *   guard cannot deliver a verdict in ANY scenario, not even the degenerate
 *   `p = s = 0` one (a step that never emits a first line -- a shape the guard's
 *   own `--self-test` pins). That is a guaranteed silent no-op.
 *
 *   TIER 2 -- `T - C >= W`. `T - C` is the entire room available for `p + s`.
 *   Requiring at least one full stall window of it says: the guard must still be
 *   able to speak for a freeze that happens after the step has run for a window
 *   -- i.e. after the suite did some work. A guard that only covers `s` smaller
 *   than its own silence threshold does not cover the #4250 shape (a MID-suite
 *   freeze) at all.
 *
 * The unit of tier 2 is the step's OWN declared window, not a fraction someone
 * chose. That is deliberate: a taste-picked ratio becomes a constant nobody can
 * explain, and the point of this card is to make the invariant explainable.
 *
 * ### What was measured, including the premise that did NOT survive
 *
 * The card proposing this gate reasoned that the real budget is "timeout-minutes
 * minus checkout/install/build, which is a fair chunk of a 30-minute job". That
 * half is FALSE, measured on GitHub's own runner timestamps for CI run
 * 33135187774 (head `f907fbe9e`, the six `test` shards, `timeout-minutes: 30`) --
 * job start to the start of the guarded step:
 *
 *     shard   prep        guarded step (healthy)
 *     3/6     33s         2s      (turbo cache hit)
 *     1/6     35s         14m35s  <- the slowest healthy run
 *     6/6     38s         6m07s
 *     2/6     56s         4m54s
 *     4/6     44s         2s
 *     5/6     2m03s       2s      (56s of it in Restore Turbo cache)
 *
 * Prep is 33s to 2m03s -- at most 7% of the budget, not "a fair chunk". The term
 * that actually consumes the budget is the HEALTHY RUN: up to 14m35s of the 30.
 * And that is precisely the quantity no static gate can read, so this gate does
 * not pretend to model it and does not encode a number derived from it. What it
 * refuses is the structural class -- a guard that cannot fire in time no matter
 * what the run does.
 *
 * ### The boundary of a green line here (#12846)
 *
 * A green from this gate does NOT mean "every stall is covered". Four things
 * bound it, and none of them is judgeable by any static sweep:
 *
 * 1. WHERE THE VERDICT LANDS. The guard's clock starts at the last output, so
 *    with `p` the job's prep before the guarded step and `s` how far into the
 *    step the output froze, the verdict lands at `p + s + C`. The room available
 *    for `p + s` is therefore `T - C` -- on the ci.yml family, `30 - 20 = 10`
 *    minutes.
 *
 * 2. THE UNDEFERRED PATH IS COVERED. This is the #4250 shape -- the mid-suite
 *    freeze this guard was built for -- and it clears its job timeout today. Do
 *    not read item 3 as "the guard does not cover stalls"; it covers the common
 *    one. But read the margin, not just the verdict: it is now barely over a
 *    minute, and it got there by shrinking roughly a quarter in a matter of days
 *    while nothing in the tree changed and this gate stayed green throughout.
 *    Nothing here can see that number move, which is exactly why item 3 matters.
 *
 * 3. THE DEFERRED PATH IS NOT COVERED, and this gate cannot say so. On the
 *    deferred path the kill waits for `C` rather than `W`, and `p + s + C`
 *    exceeds the ci.yml family's `T`: the job timeout wins and the STALL-CAP
 *    verdict is never printed. The term that consumes the budget is the HEALTHY
 *    RUN LENGTH, and no static scan can read it -- so this is a property of the
 *    checked-in values, not of this gate, and a green line above is silent about
 *    it by construction.
 *
 * 4. TWO WEDGE CLASSES THE GUARD NEVER SEES AT ALL. `p + s + C` describes only
 *    the wedges that go SILENT. The guard fires on silence, so a wedge that
 *    keeps writing -- a retry loop, a poller, a log spin -- never reaches the
 *    cap logic and is bounded only by the job timeout; and a wedge in an
 *    UNGUARDED step is not watched at all, which on the `test` job is 16 of its
 *    17 steps, `Install dependencies` and the cache and artifact steps included.
 *    No value of `T` closes either one. Raising a job timeout buys headroom for
 *    item 3; it does not extend the guard's reach.
 *
 * The affected population is 7 guard-wrapped STEPS across 5 jobs, not 4 jobs:
 * TWO of those jobs carry two guarded steps each on ONE job clock --
 * `temporal-conformance` in ci.yml, and `rerun-safety` in
 * rerun-safety-nightly.yml, whose two sites are consecutive full passes of the
 * suite -- so in each pair the second site's `p` includes the first one's
 * entire runtime.
 *
 * Each site's `slack` is still computed independently, which is correct for the
 * criterion; on its own it also READ as more independent than the clock
 * actually is. So the census now names the sharing where it exists:
 *
 *     ... · slack 10m (1 of 2 guarded steps in this job; they share one timeout clock)
 *
 * A job holding exactly one guarded step gets no such clause -- see
 * `attachSiblings` for how the grouping is derived, and why it is keyed on job
 * membership rather than on the file or on a matching `--stall-minutes`.
 *
 * ### Re-deriving these numbers instead of trusting them
 *
 * No figure from that measurement is repeated here as a constant, deliberately.
 * The one in the card that this section replaces had already drifted about a
 * quarter by the time it was re-taken, in the direction that consumes budget,
 * and a hand-refreshed number is one nobody refreshes. Re-take it with
 *
 *     node scripts/measure-stall-guard-headroom.mjs --run <run id> [--run ...]
 *
 * which enumerates the guarded steps by importing THIS file's own sweep (so a
 * renamed step surfaces loudly instead of silently dropping out), joins them
 * against GitHub's runner timestamps, and prints both paths per site. The
 * readings behind this section came from merge_group runs 33160601033,
 * 33162164422 and 33163163494; the card's original sample was run 33135187774.
 * Use a `pull_request` or `merge_group` run -- a push to `main` has the matrix
 * filtered out, and the tool refuses rather than reporting an empty green.
 *
 * ## Non-vacuity: a sweep that finds nothing satisfies this gate perfectly
 *
 * "Every guard-wrapped step has enough headroom" is TRUE of a tree with no
 * guard-wrapped steps, and it is true of a broken selector that finds none. The
 * success criterion and the total-failure criterion would be word-for-word
 * identical. So `run()` REFUSES -- `EXIT_REFUSED`, never 0 -- when the workflow
 * directory is missing, holds no workflow file, parses to no jobs, yields no
 * guard invocation at all, or when the guard's defaults cannot be read. The
 * verdict line prints the POPULATION (files, jobs, steps, sites) so that a zero
 * which is a measurement reads differently from a zero which is a silence, and
 * `--self-test` drives the REAL sweep over REAL fixture trees on disk.
 *
 * Measured when this landed: 28 workflow files, 51 jobs, 7 guard-wrapped steps,
 * 0 violations -- ci.yml x4 and coverage-nightly x1 at W=10 C=20 T=30 (slack 10,
 * exactly one window), rerun-safety-nightly x2 at W=15 C=30 T=120 (slack 90).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireDependency } from './import-prerequisite.mjs';
import { maskComments } from './js-comment-mask.mjs';
import { commandWords, shellCommands } from './check-shard-attestation.mjs';
import { isEntrypoint } from './invoked-as.mjs';

/** Refusal to measure, kept distinct from a finding (see check-agent-test-spelling). */
export const EXIT_REFUSED = 2;

export const WORKFLOW_DIR = '.github/workflows';
export const GUARD_SCRIPT = 'scripts/run-with-stall-guard.mjs';

/**
 * GitHub's documented default when a job declares no `timeout-minutes`: 360.
 * Judged against, and NAMED in the census, rather than treated as a violation --
 * the invariant genuinely holds against it, and reddening a job for not
 * declaring a timeout would be this gate legislating something else.
 */
export const GITHUB_DEFAULT_TIMEOUT_MINUTES = 360;

const GUARD_BASENAME = 'run-with-stall-guard.mjs';

/** The repository root, from this file's own location. */
function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

// ── The guard's own defaults, read from the guard ───────────────────────────

/**
 * The two numbers this gate must not own: the guard's default stall window and
 * its default cap multiple. Read from `run-with-stall-guard.mjs` with comments
 * masked -- its header quotes both in prose, and a header is not a declaration.
 *
 * @param {string} root repository root (or a fixture root)
 * @returns {{ defaults?: { window: number, capMultiple: number }, problems: string[] }}
 */
export function guardDefaults(root) {
  const file = join(root, GUARD_SCRIPT);
  if (!existsSync(file)) {
    return {
      problems: [
        `${GUARD_SCRIPT} does not exist, so the guard's own defaults cannot be read -- nothing was verified.`,
      ],
    };
  }
  const source = maskComments(readFileSync(file, 'utf8'));
  const capMultiple = source.match(/(?:^|\n)\s*const\s+DEFAULT_CAP_MULTIPLE\s*=\s*(\d+(?:\.\d+)?)\s*;/);
  const window = source.match(/(?:^|\n)\s*let\s+stallMinutes\s*=\s*(\d+(?:\.\d+)?)\s*;/);
  const problems = [];
  if (!capMultiple) {
    problems.push(
      `${GUARD_SCRIPT} no longer declares \`const DEFAULT_CAP_MULTIPLE = <number>;\` -- the derived cap cannot be ` +
        'resolved. Update this gate together with the guard rather than letting it judge against a stale default.',
    );
  }
  if (!window) {
    problems.push(
      `${GUARD_SCRIPT} no longer declares \`let stallMinutes = <number>;\` -- the default stall window cannot be ` +
        'resolved. Update this gate together with the guard rather than letting it judge against a stale default.',
    );
  }
  if (problems.length) return { problems };
  return { defaults: { window: Number(window[1]), capMultiple: Number(capMultiple[1]) }, problems: [] };
}

// ── Reading one guard invocation ────────────────────────────────────────────

/**
 * The guard's own options in one shell command, or `null` when this command does
 * not invoke the guard.
 *
 * Scanning STOPS at the guard's `--` separator: everything after it is the
 * WRAPPED command, which may legitimately carry flags of the same name meant for
 * something else.
 *
 * A `--self-test` invocation returns `null`: it wraps no command, runs in no
 * job's critical path, and has no budget to judge.
 *
 * @param {string} command one command, as produced by `shellCommands`
 * @returns {{ window: string | null, cap: string | null } | null}
 */
export function guardOptions(command) {
  const words = commandWords(command);
  const at = words.findIndex(
    ({ word, quoted }) => !quoted && (word === GUARD_SCRIPT || word.endsWith(`/${GUARD_BASENAME}`) || word === GUARD_BASENAME),
  );
  if (at === -1) return null;

  let window = null;
  let cap = null;
  for (let i = at + 1; i < words.length; i += 1) {
    const { word } = words[i];
    if (word === '--') break;
    if (word === '--self-test') return null;
    if (word === '--stall-minutes') window = words[i + 1]?.word ?? '';
    else if (word === '--stall-cap-minutes') cap = words[i + 1]?.word ?? '';
  }
  return { window, cap };
}

/**
 * The lines of `text` that invoke the guard for real -- neither a YAML comment
 * nor a shell comment, and not the guard's own self-test. Used only to attach a
 * line number to a site, and only when the count agrees with the sweep: a wrong
 * line number is worse than none.
 */
function guardLines(text) {
  const lines = [];
  text.split('\n').forEach((line, index) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#')) return;
    if (!trimmed.includes(GUARD_BASENAME)) return;
    if (trimmed.includes('--self-test')) return;
    lines.push(index + 1);
  });
  return lines;
}

// ── The sweep ───────────────────────────────────────────────────────────────

/**
 * Every guard-wrapped step in the workflow directory, judged.
 *
 * @param {string} root repository root (or a fixture root)
 * @param {{ window: number, capMultiple: number }} defaults the guard's own defaults
 * @param {(text: string) => unknown} parseYaml
 * @returns {{ sites: object[], violations: object[], problems: string[], files: number, jobs: number, steps: number }}
 */
export function scan(root, defaults, parseYaml) {
  const sites = [];
  const violations = [];
  const problems = [];
  let jobs = 0;
  let steps = 0;

  const dir = join(root, WORKFLOW_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    problems.push(`${WORKFLOW_DIR}/ does not exist -- nothing was scanned, so nothing was verified.`);
    return { sites, violations, problems, files: 0, jobs, steps };
  }
  const names = readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
  if (names.length === 0) {
    problems.push(`${WORKFLOW_DIR}/ holds no .yml/.yaml file -- nothing was scanned, so nothing was verified.`);
    return { sites, violations, problems, files: 0, jobs, steps };
  }

  for (const name of names) {
    const rel = `${WORKFLOW_DIR}/${name}`;
    const text = readFileSync(join(dir, name), 'utf8');
    let doc;
    try {
      doc = parseYaml(text);
    } catch (error) {
      problems.push(`${rel} does not parse as YAML: ${error.message}`);
      continue;
    }
    const jobMap = doc && typeof doc === 'object' ? doc.jobs : undefined;
    if (!jobMap || typeof jobMap !== 'object') continue;

    const before = sites.length;
    for (const [jobId, job] of Object.entries(jobMap)) {
      jobs += 1;
      const jobTimeout = job?.['timeout-minutes'];
      const stepList = Array.isArray(job?.steps) ? job.steps : [];
      for (const [index, step] of stepList.entries()) {
        steps += 1;
        const run = typeof step?.run === 'string' ? step.run : '';
        if (!run.includes(GUARD_BASENAME)) continue;
        for (const command of shellCommands(run)) {
          const options = guardOptions(command);
          if (!options) continue;
          sites.push({
            file: rel,
            job: jobId,
            step: step?.name ?? `step #${index + 1}`,
            raw: options,
            jobTimeout,
            stepTimeout: step?.['timeout-minutes'],
          });
        }
      }
    }
    // A line number is attached only when the two counts agree.
    const lines = guardLines(text);
    const found = sites.slice(before);
    if (lines.length === found.length) found.forEach((site, i) => { site.line = lines[i]; });
  }

  attachSiblings(sites);

  for (const site of sites) {
    const judged = judge(site, defaults);
    Object.assign(site, judged);
    if (judged.problem) problems.push(`${where(site)}: ${judged.problem}`);
    else if (!judged.ok) violations.push(site);
  }

  return { sites, violations, problems, files: names.length, jobs, steps };
}

/**
 * Mark, on every site, how many guard-wrapped steps share its job clock and
 * which one of them it is (`siblingCount`, 1-based `siblingIndex`).
 *
 * `timeout-minutes` runs ONE clock for a whole job, so two guarded steps in the
 * same job do not each get the `slack` the census prints beside them: the later
 * one starts with the earlier one's entire runtime already spent. The criterion
 * `T - C >= W` is unaffected and deliberately still models neither the prep
 * before a step nor the step's own runtime -- this is what the census SAYS, not
 * what the gate DECIDES.
 *
 * ## The grouping key is (file, job id), and each half is load-bearing
 *
 * NOT the job id alone. A job id is unique only within its own workflow file,
 * and this tree really does reuse three of them across files (`publish` in
 * docker-publish.yml and release.yml, `patrol` in half-state-patrol.yml and
 * release-coverage-patrol.yml, `registry-canary` in publish-smoke.yml and
 * scaffold-e2e.yml). Keyed on the id alone, two single-guard jobs in different
 * files would be printed as siblings -- inventing a shared clock that does not
 * exist, which is the more dangerous direction to be wrong in.
 *
 * NOT the file either: one workflow file holds many independent job clocks (28
 * files, 51 jobs here). And NOT a matching `--stall-minutes` value: five of the
 * seven sites in this tree are 10m, spread over four different jobs, and a
 * coincidence of budgets is not a shared clock. Those are the two mistakes the
 * self-test pins against, because they are the ones the next reader reaches for.
 *
 * ## Why the ordinal can be trusted
 *
 * A site's position within its job's group is the order `scan` pushed it, which
 * comes from `job.steps` -- an ARRAY. Document order there is guaranteed by
 * construction, not by object-key iteration order, so `2 of 2` really is the
 * second step on the clock and not merely one of two. That is the half a reader
 * needs: a SECOND guarded step is the one whose real headroom is quietly
 * smaller than the number printed next to it.
 *
 * @param {object[]} sites in sweep order; annotated in place
 */
export function attachSiblings(sites) {
  const byJobClock = new Map();
  for (const site of sites) {
    const key = JSON.stringify([site.file, site.job]);
    const group = byJobClock.get(key);
    if (group) group.push(site);
    else byJobClock.set(key, [site]);
  }
  for (const group of byJobClock.values()) {
    group.forEach((site, index) => {
      site.siblingIndex = index + 1;
      site.siblingCount = group.length;
    });
  }
  return sites;
}

/**
 * The clause that stops a census `slack` from reading as an independent
 * per-step budget, or `''` for a job holding exactly one guarded step.
 *
 * It names the CONSEQUENCE and not only the count: `1 of 2` alone leaves a
 * reader knowing there is another guarded step somewhere without knowing that
 * it spends the same clock. The note is unconditional on the budget source
 * because a job's timeout clock is per-job whether it is declared or is
 * GitHub's default; when a tighter STEP-level `timeout-minutes` is what binds,
 * the census already says so in the `budget ...m (step timeout-minutes)` field
 * printed immediately before this clause.
 *
 * @param {object} site a judged site carrying the fields `attachSiblings` set
 */
export function siblingNote(site) {
  if (!(site.siblingCount > 1)) return '';
  return (
    ` (${site.siblingIndex} of ${site.siblingCount} guarded steps in this job; ` +
    'they share one timeout clock)'
  );
}

/** `file:line job/step`, for a message. */
function where(site) {
  const at = site.line ? `${site.file}:${site.line}` : site.file;
  return `${at}  job \`${site.job}\` step \`${site.step}\``;
}

/**
 * One site's verdict.
 *
 * @param {object} site
 * @param {{ window: number, capMultiple: number }} defaults
 */
export function judge(site, defaults) {
  const number = (value, flag) => {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      return { problem: `${flag} is ${JSON.stringify(value)}, which is not a positive number of minutes -- the guard's budget cannot be resolved, so the invariant could not be checked.` };
    }
    return { value: n };
  };

  const w = number(site.raw.window, '--stall-minutes');
  if (w?.problem) return { problem: w.problem };
  const c = number(site.raw.cap, '--stall-cap-minutes');
  if (c?.problem) return { problem: c.problem };

  const window = w ? w.value : defaults.window;
  const windowSource = w ? 'explicit' : 'guard default';
  const cap = c ? c.value : window * defaults.capMultiple;
  const capSource = c ? 'explicit' : `${defaults.capMultiple}x window (DEFAULT_CAP_MULTIPLE)`;

  // The binding budget. A step-level `timeout-minutes` starts its clock at the
  // step, a job-level one at the job -- whichever is smaller kills first, and
  // for the job-level clock the prep time is spent before the step even starts.
  //
  // `typeof === 'number'`, deliberately, NOT `Number(x)`: `Number(null)` is 0 and
  // `Number('')` is 0, so a `timeout-minutes:` written with no value would coerce
  // to a real-looking zero-minute budget and produce a confident verdict about a
  // field nobody filled in. YAML gives a genuine number for the spelling that
  // means one; everything else is unresolved and says so.
  const declared = [];
  for (const [value, source] of [[site.stepTimeout, 'step timeout-minutes'], [site.jobTimeout, 'job timeout-minutes']]) {
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return { problem: `the ${source} is ${JSON.stringify(value)}, which is not a positive number of minutes -- the budget could not be resolved, so the invariant could not be checked.` };
    }
    declared.push({ minutes: value, source });
  }
  const binding = declared.length
    ? declared.reduce((a, b) => (b.minutes < a.minutes ? b : a))
    : { minutes: GITHUB_DEFAULT_TIMEOUT_MINUTES, source: `GitHub default (no timeout-minutes declared)` };

  const slack = binding.minutes - cap;
  const reasons = [];
  if (cap >= binding.minutes) {
    reasons.push(
      `the effective cap (${cap}m) is not below the binding budget (${binding.minutes}m, ${binding.source}). ` +
        'The job timeout wins in every scenario, including a step that never emits a first line, so this guard can ' +
        'never deliver a verdict: it is a silent no-op.',
    );
  } else if (slack < window) {
    reasons.push(
      `only ${slack}m separates the effective cap (${cap}m) from the binding budget (${binding.minutes}m, ` +
        `${binding.source}), which is less than one stall window (${window}m). All of that ${slack}m has to cover ` +
        'the job\'s prep AND however long the suite ran before its output froze, so this guard can only report a ' +
        'stall that begins before the step has run for even one window -- not the mid-run freeze it exists for.',
    );
  }

  return { window, windowSource, cap, capSource, budget: binding.minutes, budgetSource: binding.source, slack, ok: reasons.length === 0, reasons };
}

const PRESCRIPTION = `
⛔ The fix is to adjust a BUDGET, never to remove the guard.

   Two supported remedies, both one line:
     • lower the guard's budget -- a smaller --stall-minutes, or an explicit
       --stall-cap-minutes on the step, or
     • raise the enclosing job's timeout-minutes.

   Deleting \`run-with-stall-guard.mjs\` from the step is NOT a remedy. It does
   not restore the guarantee; it removes the only instrument that can report a
   stall at all, and converts a red gate into precisely the unlabeled
   in_progress-until-the-job-timeout outcome this guard exists to abolish --
   which no green run can distinguish from success.
`;

function summarise(result) {
  return `${result.files} workflow file(s), ${result.jobs} job(s), ${result.steps} step(s), ${result.sites.length} guard-wrapped step(s)`;
}

function census(result) {
  return result.sites.map(
    (site) =>
      `  ${where(site)}\n` +
      `      window ${site.window}m (${site.windowSource}) · cap ${site.cap}m (${site.capSource}) · ` +
      `budget ${site.budget}m (${site.budgetSource}) · slack ${site.slack}m${siblingNote(site)}`,
  );
}

/**
 * The gate. Returns an exit code rather than calling `process.exit`, so the
 * self-test can drive this exact path.
 *
 * @param {string} root
 * @param {(text: string) => unknown} parseYaml
 * @param {{ log?: Function, error?: Function }} [io]
 */
export function run(root, parseYaml, io = {}) {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;

  const { defaults, problems: defaultProblems } = guardDefaults(root);
  if (!defaults) {
    error('check-stall-guard-budget: REFUSING to report a verdict.\n');
    for (const p of defaultProblems) error(`  • ${p}`);
    return EXIT_REFUSED;
  }

  const result = scan(root, defaults, parseYaml);

  if (result.problems.length > 0) {
    error('check-stall-guard-budget: REFUSING to report a verdict.\n');
    for (const p of result.problems) error(`  • ${p}`);
    return EXIT_REFUSED;
  }
  if (result.sites.length === 0) {
    error(
      'check-stall-guard-budget: REFUSING to report a verdict -- the sweep found NO guard-wrapped step ' +
        `(${summarise(result)}).\n` +
        '  "every guard-wrapped step has headroom" is vacuously true of an empty population, so a green here would\n' +
        '  be indistinguishable from a broken selector. If the guard really was removed everywhere, delete this\n' +
        '  gate deliberately; otherwise fix the selector.',
    );
    return EXIT_REFUSED;
  }

  if (result.violations.length === 0) {
    log(`check-stall-guard-budget: OK (${summarise(result)}; every effective cap clears its job budget by at least one stall window).`);
    for (const line of census(result)) log(line);
    return 0;
  }

  error(
    `check-stall-guard-budget: ${result.violations.length} guard-wrapped step(s) cannot deliver a verdict in time ` +
      `(${summarise(result)})\n`,
  );
  for (const site of result.violations) {
    error(`  • ${where(site)}`);
    error(`      window ${site.window}m (${site.windowSource}) · cap ${site.cap}m (${site.capSource}) · budget ${site.budget}m (${site.budgetSource})`);
    for (const reason of site.reasons) error(`      ${reason}`);
  }
  error(PRESCRIPTION);
  return 1;
}

// ---------------------------------------------------------------------------
// Self-test -- the REAL sweep, over REAL trees on disk
// ---------------------------------------------------------------------------

/**
 * Every case below materialises a workflow directory AND a guard script on
 * disk and drives `run()` -- the same function CI calls -- rather than poking a
 * predicate with a string. The rule this gate owns is a matching rule over
 * workflow text, and a clean tree cannot exhibit its own regression: weakening
 * the selector can only shrink the finding set, and the empty set is the fixed
 * point of shrinking. So these fixtures are the only instrument watching it.
 */
export async function selfTest() {
  const { parse } = await requireDependency('yaml', () => import('yaml'), import.meta.url);
  const failures = [];
  let checked = 0;
  const assert = (name, ok, detail) => {
    checked += 1;
    if (!ok) failures.push(detail ? `${name} -- ${detail}` : name);
  };

  const roots = [];
  /** A fixture root: a guard script with the given defaults, plus workflow files. */
  const fixture = (workflows, { window = 10, capMultiple = 2, guard = true } = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'stall-guard-budget-'));
    roots.push(root);
    if (guard) {
      mkdirSync(join(root, 'scripts'), { recursive: true });
      writeFileSync(
        join(root, GUARD_SCRIPT),
        `// a fixture stand-in. The header prose below must NOT be read as a declaration:\n` +
          `//   const DEFAULT_CAP_MULTIPLE = 99;\n` +
          `//   let stallMinutes = 99;\n` +
          `const DEFAULT_CAP_MULTIPLE = ${capMultiple};\n` +
          `let stallMinutes = ${window};\n`,
      );
    }
    mkdirSync(join(root, WORKFLOW_DIR), { recursive: true });
    for (const [name, text] of Object.entries(workflows)) writeFileSync(join(root, WORKFLOW_DIR, name), text);
    return root;
  };

  /** Drive the real gate and capture everything it printed. */
  const drive = (root) => {
    const out = [];
    const code = run(root, parse, { log: (m) => out.push(String(m)), error: (m) => out.push(String(m)) });
    return { code, out: out.join('\n') };
  };

  /** One job wrapping one command, with the given timeouts. */
  const workflow = ({ jobTimeout, stepTimeout, command }) =>
    `name: fixture\non: push\njobs:\n  probe:\n` +
    (jobTimeout === undefined ? '' : `    timeout-minutes: ${jobTimeout}\n`) +
    `    runs-on: ubuntu-latest\n    steps:\n      - name: guarded\n` +
    (stepTimeout === undefined ? '' : `        timeout-minutes: ${stepTimeout}\n`) +
    `        run: |\n          ${command}\n`;

  const GUARDED = 'node scripts/run-with-stall-guard.mjs --log "$RUNNER_TEMP/x.log" --stall-minutes 10 -- pnpm test';

  /** A guard invocation with its own window, so a fixture can vary that alone. */
  const guarded = (window) => `node scripts/run-with-stall-guard.mjs --log x --stall-minutes ${window} -- pnpm test`;

  /**
   * A workflow of several jobs, each with several guarded steps:
   * `{ jobId: { timeout, steps: [[stepName, command], ...] } }`. Needed because
   * `workflow()` above builds exactly one job of exactly one step, and the
   * property under test here is precisely how sites are grouped ACROSS jobs.
   */
  const multi = (jobs) =>
    `name: fixture\non: push\njobs:\n` +
    Object.entries(jobs)
      .map(
        ([jobId, { timeout, steps }]) =>
          `  ${jobId}:\n    timeout-minutes: ${timeout}\n    runs-on: ubuntu-latest\n    steps:\n` +
          steps.map(([name, command]) => `      - name: ${name}\n        run: |\n          ${command}\n`).join(''),
      )
      .join('');

  /** The census lines `--list` and a green `run()` print, one per site. */
  const censusOf = (root) => {
    const { defaults } = guardDefaults(root);
    return census(scan(root, defaults, parse));
  };

  try {
    // ── 1. The shape the repo ships: W=10 C=20 T=30, slack exactly one window ─
    const green = fixture({ 'a.yml': workflow({ jobTimeout: 30, command: GUARDED }) });
    const greenRun = drive(green);
    assert('the ci.yml shape (W=10, C=20, T=30) passes', greenRun.code === 0, greenRun.out);
    assert('...and says so with its population, not a bare OK', /1 guard-wrapped step/.test(greenRun.out), greenRun.out);

    // THE control the ⭐⭐ lesson demands: the green above must be a MEASUREMENT.
    // A selector that matched nothing would produce the same "no violations".
    const greenScan = scan(green, { window: 10, capMultiple: 2 }, parse);
    assert('...and the green is non-vacuous: the sweep really found the site', greenScan.sites.length === 1, JSON.stringify(greenScan.sites));
    assert('...with the cap DERIVED, not read from the command line', greenScan.sites[0].cap === 20 && greenScan.sites[0].capSource.includes('DEFAULT_CAP_MULTIPLE'), JSON.stringify(greenScan.sites[0]));

    // ── 2. TIER 1: a cap at or above the budget is a guaranteed no-op ────────
    const over = fixture({
      'a.yml': workflow({ jobTimeout: 30, command: 'node scripts/run-with-stall-guard.mjs --log x --stall-minutes 10 --stall-cap-minutes 40 -- pnpm test' }),
    });
    const overRun = drive(over);
    assert('a cap ABOVE the job budget is red', overRun.code === 1, overRun.out);
    assert('...named as a silent no-op, not merely "too big"', /silent no-op/.test(overRun.out), overRun.out);

    const equal = fixture({
      'a.yml': workflow({ jobTimeout: 30, command: 'node scripts/run-with-stall-guard.mjs --log x --stall-minutes 10 --stall-cap-minutes 30 -- pnpm test' }),
    });
    assert('a cap EQUAL to the job budget is red (the boundary is not below)', drive(equal).code === 1);

    // ── 3. TIER 2: the two one-line edits the card named ─────────────────────
    const tightened = fixture({ 'a.yml': workflow({ jobTimeout: 25, command: GUARDED }) });
    const tightenedRun = drive(tightened);
    assert('lowering the JOB timeout 30 -> 25 under an unchanged guard is red', tightenedRun.code === 1, tightenedRun.out);
    assert('...on the headroom reason, not the no-op one', /less than one stall window/.test(tightenedRun.out), tightenedRun.out);
    assert('...and tier 1 alone would have missed it (cap 20 IS below 25)', judge({ raw: { window: '10', cap: null }, jobTimeout: 25 }, { window: 10, capMultiple: 2 }).cap === 20);

    const widened = fixture({
      'a.yml': workflow({ jobTimeout: 30, command: 'node scripts/run-with-stall-guard.mjs --log x --stall-minutes 12 -- pnpm test' }),
    });
    assert('raising --stall-minutes 10 -> 12 under an unchanged job timeout is red', drive(widened).code === 1);

    const shortJob = fixture({ 'a.yml': workflow({ jobTimeout: 15, command: GUARDED }) });
    assert('a guard-wrapped step added to a SHORT job is red', drive(shortJob).code === 1);

    // ── 4. An explicit cap is honoured, and it can RESCUE a short job ────────
    const explicit = fixture({
      'a.yml': workflow({ jobTimeout: 25, command: 'node scripts/run-with-stall-guard.mjs --log x --stall-minutes 10 --stall-cap-minutes 12 -- pnpm test' }),
    });
    const explicitRun = drive(explicit);
    assert('an explicit --stall-cap-minutes below the derived one is read and passes', explicitRun.code === 0, explicitRun.out);
    assert('...and is reported as explicit, not derived', /cap 12m \(explicit\)/.test(explicitRun.out), explicitRun.out);

    // ── 5. The defaults are READ from the guard, not hardcoded here ──────────
    //
    // Same workflow as case 1 -- green under the repo's real DEFAULT_CAP_MULTIPLE
    // of 2, red under a guard declaring 3. A gate carrying its own copy of `2`
    // passes both, which is the drift this gate must not commit.
    const otherMultiple = fixture({ 'a.yml': workflow({ jobTimeout: 30, command: GUARDED }) }, { capMultiple: 3 });
    const otherRun = drive(otherMultiple);
    assert('the cap multiple is read from the guard: multiple 3 turns the same workflow red', otherRun.code === 1, otherRun.out);
    assert('...and the header prose declaring 99 is masked, not read', !/99/.test(otherRun.out), otherRun.out);

    // ...and the default WINDOW likewise, for a step that passes none.
    const noWindow = fixture(
      { 'a.yml': workflow({ jobTimeout: 30, command: 'node scripts/run-with-stall-guard.mjs --log x -- pnpm test' }) },
      { window: 8 },
    );
    const noWindowRun = drive(noWindow);
    assert('a step passing no --stall-minutes inherits the guard default window', /window 8m \(guard default\)/.test(noWindowRun.out), noWindowRun.out);
    assert('...and passes on it', noWindowRun.code === 0, noWindowRun.out);

    const renamed = fixture({ 'a.yml': workflow({ jobTimeout: 30, command: GUARDED }) });
    writeFileSync(join(renamed, GUARD_SCRIPT), 'const CAP_MULTIPLE = 2;\nlet stall = 10;\n');
    const renamedRun = drive(renamed);
    assert('renaming the guard\'s declarations REFUSES rather than judging on a stale default', renamedRun.code === EXIT_REFUSED, renamedRun.out);
    assert('...and both missing declarations are named', /DEFAULT_CAP_MULTIPLE/.test(renamedRun.out) && /stallMinutes/.test(renamedRun.out), renamedRun.out);

    // ── 6. Budget resolution: step-level, missing, and unusable ──────────────
    const stepBound = fixture({ 'a.yml': workflow({ jobTimeout: 120, stepTimeout: 25, command: GUARDED }) });
    const stepBoundRun = drive(stepBound);
    assert('a step-level timeout-minutes BINDS when it is tighter than the job\'s', stepBoundRun.code === 1, stepBoundRun.out);
    assert('...and is named as the binding source', /step timeout-minutes/.test(stepBoundRun.out), stepBoundRun.out);

    const noTimeout = fixture({ 'a.yml': workflow({ command: GUARDED }) });
    const noTimeoutRun = drive(noTimeout);
    assert('a job with no timeout-minutes is judged against GitHub\'s 360 default', noTimeoutRun.code === 0, noTimeoutRun.out);
    assert('...and the default is NAMED rather than silently assumed', /GitHub default/.test(noTimeoutRun.out), noTimeoutRun.out);

    const emptyTimeout = fixture({
      'a.yml': `name: fixture\non: push\njobs:\n  probe:\n    timeout-minutes:\n    runs-on: ubuntu-latest\n    steps:\n      - name: guarded\n        run: |\n          ${GUARDED}\n`,
    });
    const emptyTimeoutRun = drive(emptyTimeout);
    assert('a timeout-minutes with no value REFUSES -- it must not coerce to a 0-minute budget', emptyTimeoutRun.code === EXIT_REFUSED, emptyTimeoutRun.out);

    const exprTimeout = fixture({
      'a.yml': `name: fixture\non: push\njobs:\n  probe:\n    timeout-minutes: \${{ fromJSON(needs.x.outputs.t) }}\n    runs-on: ubuntu-latest\n    steps:\n      - name: guarded\n        run: |\n          ${GUARDED}\n`,
    });
    assert('a timeout-minutes that is an expression REFUSES rather than guessing', drive(exprTimeout).code === EXIT_REFUSED);

    const unresolvable = fixture({
      'a.yml': workflow({ jobTimeout: 30, command: 'node scripts/run-with-stall-guard.mjs --log x --stall-minutes "${{ matrix.window }}" -- pnpm test' }),
    });
    const unresolvableRun = drive(unresolvable);
    assert('a window that is not a number REFUSES instead of guessing', unresolvableRun.code === EXIT_REFUSED, unresolvableRun.out);

    // ── 7. The selector: what must NOT count as a site ───────────────────────
    const commented = fixture({
      'a.yml':
        `name: fixture\non: push\njobs:\n  probe:\n    timeout-minutes: 5\n    runs-on: ubuntu-latest\n    steps:\n` +
        `      # node scripts/run-with-stall-guard.mjs --stall-minutes 10 -- pnpm test\n` +
        `      - name: not guarded\n        run: |\n          # node scripts/run-with-stall-guard.mjs --stall-minutes 10 -- pnpm test\n          echo hi\n`,
    });
    const commentedRun = drive(commented);
    assert('a guard invocation that is only a COMMENT is not a site', commentedRun.code === EXIT_REFUSED, commentedRun.out);
    assert('...and the empty population REFUSES rather than passing vacuously', /found NO guard-wrapped step/.test(commentedRun.out), commentedRun.out);

    const selfTestOnly = fixture({
      'a.yml': workflow({ jobTimeout: 5, command: 'node scripts/run-with-stall-guard.mjs --self-test' }),
    });
    assert('the guard\'s own --self-test wraps nothing and is not a site', drive(selfTestOnly).code === EXIT_REFUSED);

    const nested = fixture({
      'a.yml': workflow({ jobTimeout: 30, command: 'node scripts/run-with-stall-guard.mjs --log x --stall-minutes 10 -- node other.mjs --stall-cap-minutes 900' }),
    });
    const nestedRun = drive(nested);
    assert('a flag after the guard\'s -- belongs to the WRAPPED command, not the guard', nestedRun.code === 0, nestedRun.out);
    assert('...so the cap stays the derived 20, not 900', /cap 20m/.test(nestedRun.out), nestedRun.out);

    const missingDir = mkdtempSync(join(tmpdir(), 'stall-guard-budget-'));
    roots.push(missingDir);
    mkdirSync(join(missingDir, 'scripts'), { recursive: true });
    writeFileSync(join(missingDir, GUARD_SCRIPT), 'const DEFAULT_CAP_MULTIPLE = 2;\nlet stallMinutes = 10;\n');
    assert('a missing workflow directory REFUSES', drive(missingDir).code === EXIT_REFUSED);

    const noGuardFile = fixture({ 'a.yml': workflow({ jobTimeout: 30, command: GUARDED }) }, { guard: false });
    assert('a missing guard script REFUSES', drive(noGuardFile).code === EXIT_REFUSED);

    // ── 8. Line numbers: attached when they can be trusted, never guessed ────
    assert('a site carries the line its command sits on', greenScan.sites[0].line === 10, JSON.stringify(greenScan.sites[0]));

    // ── 9. Siblings on one job clock: what the census must and must NOT say ──
    //
    // The census prints one `slack` per SITE, but `timeout-minutes` runs one
    // clock per JOB. These cases pin the note that closes that gap -- and, more
    // importantly, pin the two ways of deriving it that are WRONG. Both wrong
    // ways are green against a single-sibling tree, so only fixtures shaped
    // like the mistake can hold them.

    // The positive case: two guarded steps, one job, one clock.
    const pair = fixture({
      'a.yml': multi({
        conformance: { timeout: 30, steps: [['first', guarded(10)], ['second', guarded(10)]] },
      }),
    });
    const pairCensus = censusOf(pair);
    assert('two guarded steps in one job produce two sites', pairCensus.length === 2, JSON.stringify(pairCensus));
    assert(
      'the FIRST of two guarded steps is named as 1 of 2 sharing one clock',
      /slack 10m \(1 of 2 guarded steps in this job; they share one timeout clock\)/.test(pairCensus[0]),
      pairCensus[0],
    );
    assert(
      '...and the SECOND as 2 of 2 -- the ordinal follows job.steps order, so it is the later step on the clock',
      /slack 10m \(2 of 2 guarded steps in this job; they share one timeout clock\)/.test(pairCensus[1]),
      pairCensus[1],
    );
    assert(
      '...and the note names the CONSEQUENCE, not only the count',
      pairCensus.every((line) => line.includes('they share one timeout clock')),
      JSON.stringify(pairCensus),
    );
    // The verdict must not move: this card changes what the census SAYS only.
    const pairRun = drive(pair);
    assert('...and a sibling pair is still judged on T - C >= W alone, so it stays green', pairRun.code === 0, pairRun.out);

    // THE NEGATIVE CONTROL this card was accepted on: one guarded step, no note.
    const lone = fixture({ 'a.yml': workflow({ jobTimeout: 30, command: GUARDED }) });
    const loneCensus = censusOf(lone);
    assert('a job with a single guarded step gets NO sibling note', !/guarded steps in this job/.test(loneCensus.join('\n')), JSON.stringify(loneCensus));
    assert('...and its slack line is otherwise unchanged', /slack 10m$/.test(loneCensus[0]), loneCensus[0]);

    // WRONG DERIVATION 1: grouping by a matching `--stall-minutes` value. Five
    // of this repo's seven real sites are 10m across four different jobs, so
    // this mistake would report siblings almost everywhere.
    const sameWindowTwoJobs = fixture({
      'a.yml': multi({
        alpha: { timeout: 30, steps: [['only', guarded(10)]] },
        beta: { timeout: 30, steps: [['only', guarded(10)]] },
      }),
    });
    const sameWindowCensus = censusOf(sameWindowTwoJobs);
    assert('two jobs are read as two sites', sameWindowCensus.length === 2, JSON.stringify(sameWindowCensus));
    assert(
      'two SEPARATE jobs that merely share a --stall-minutes value are NOT siblings',
      !/guarded steps in this job/.test(sameWindowCensus.join('\n')),
      JSON.stringify(sameWindowCensus),
    );
    // ...and they are not siblings for merely sharing a FILE, either: the two
    // jobs above live in one workflow file and still get no note.

    // WRONG DERIVATION 2: grouping by job id alone. A job id is unique only
    // within its file, and this tree reuses three ids across files today.
    const sameIdTwoFiles = fixture({
      'a.yml': multi({ publish: { timeout: 30, steps: [['only', guarded(10)]] } }),
      'b.yml': multi({ publish: { timeout: 30, steps: [['only', guarded(10)]] } }),
    });
    const sameIdCensus = censusOf(sameIdTwoFiles);
    assert('the same job id in two files yields two sites', sameIdCensus.length === 2, JSON.stringify(sameIdCensus));
    assert(
      'the same job id in two DIFFERENT files is two clocks, not a sibling pair',
      !/guarded steps in this job/.test(sameIdCensus.join('\n')),
      JSON.stringify(sameIdCensus),
    );

    // A job holding three, to prove the count is the group size and not a
    // hardcoded pair -- the wording has to stay right above N = 2.
    const trio = fixture({
      'a.yml': multi({ probe: { timeout: 30, steps: [['a', guarded(10)], ['b', guarded(10)], ['c', guarded(10)]] } }),
    });
    const trioCensus = censusOf(trio);
    assert('a job holding three guarded steps counts three, not two', /\(3 of 3 guarded steps in this job/.test(trioCensus[2]), JSON.stringify(trioCensus));
    assert('...and the middle one is 2 of 3', /\(2 of 3 guarded steps in this job/.test(trioCensus[1]), trioCensus[1]);

    // ── 10. The real repository -- the direction the fixtures cannot prove ───
    const realDefaults = guardDefaults(repoRoot());
    assert('the real guard still declares both defaults', Boolean(realDefaults.defaults), JSON.stringify(realDefaults.problems));
    if (realDefaults.defaults) {
      const real = scan(repoRoot(), realDefaults.defaults, parse);
      assert('the repo\'s own workflows parse and resolve cleanly', real.problems.length === 0, real.problems[0]);
      assert('the repo scan actually reads workflows', real.files > 0 && real.jobs > 0, `${real.files}/${real.jobs}`);
      assert('the repo has guard-wrapped steps -- at 0 this gate guards nothing', real.sites.length > 0, `${real.sites.length}`);
      assert('the repo is green on the invariant', real.violations.length === 0, JSON.stringify(real.violations.map((v) => where(v))));

      // The sibling annotation, re-derived here independently of the code that
      // wrote it, so agreement is a check rather than a restatement.
      const expected = new Map();
      for (const site of real.sites) {
        const key = `${site.file} ${site.job}`;
        expected.set(key, (expected.get(key) ?? 0) + 1);
      }
      assert(
        'every real site knows its group size, and its ordinal is inside it',
        real.sites.every((s) => s.siblingCount === expected.get(`${s.file} ${s.job}`) && s.siblingIndex >= 1 && s.siblingIndex <= s.siblingCount),
        JSON.stringify(real.sites.map((s) => `${s.file} ${s.job} ${s.siblingIndex}/${s.siblingCount}`)),
      );
      for (const [key, size] of expected) {
        const ordinals = real.sites.filter((s) => `${s.file} ${s.job}` === key).map((s) => s.siblingIndex);
        assert(`the ordinals in \`${key}\` are exactly 1..${size}`, JSON.stringify(ordinals) === JSON.stringify([...Array(size).keys()].map((i) => i + 1)), JSON.stringify(ordinals));
      }

      // Non-vacuity for the note itself. Every assertion above about the ABSENCE
      // of a note would also pass if the note could never be produced, and the
      // fixtures are the only thing proving it can -- on fixture trees. This is
      // the same proof against the population the census actually prints: at
      // least one real job holds more than one guarded step. If that ever stops
      // being true, this reds so the header prose above gets re-measured too,
      // rather than quietly describing a population that no longer exists.
      const realSiblingJobs = [...expected].filter(([, size]) => size > 1);
      assert(
        'at least one REAL job holds more than one guarded step, so the census note is exercised by the live tree',
        realSiblingJobs.length > 0,
        `groups: ${JSON.stringify([...expected])}`,
      );
      const noted = census(real).filter((line) => line.includes('guarded steps in this job'));
      assert(
        '...and the real census prints one note per site in those jobs',
        noted.length === realSiblingJobs.reduce((n, [, size]) => n + size, 0),
        `${noted.length} note(s) for ${JSON.stringify(realSiblingJobs)}`,
      );
    }
  } finally {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`✗ check-stall-guard-budget --self-test -- ${failures.length} of ${checked} assertion(s) failed\n`);
    for (const f of failures) console.error(`  • ${f}`);
    return 1;
  }
  console.log(
    `✓ check-stall-guard-budget --self-test: ${checked} assertions over real fixture trees on disk (real run() path) -- ` +
      'both violation tiers driven red, the guard defaults proven READ rather than copied, the empty population proven to ' +
      'REFUSE, and the sibling note proven to follow JOB membership -- absent for a lone guarded step, and absent for two ' +
      'jobs sharing only a --stall-minutes value or only a job id.',
  );
  return 0;
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    process.exit(await selfTest());
  } else {
    const { parse } = await requireDependency('yaml', () => import('yaml'), import.meta.url);
    if (process.argv.includes('--list')) {
      const { defaults, problems } = guardDefaults(repoRoot());
      if (!defaults) {
        for (const p of problems) console.error(`  • ${p}`);
        process.exit(EXIT_REFUSED);
      }
      const result = scan(repoRoot(), defaults, parse);
      console.log(summarise(result));
      for (const line of census(result)) console.log(line);
      process.exit(result.problems.length ? EXIT_REFUSED : 0);
    }
    process.exit(run(repoRoot(), parse));
  }
}
