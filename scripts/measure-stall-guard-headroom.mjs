#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * measure-stall-guard-headroom (#12846) -- re-take the one number the stall
 * guard's budget depends on and that no static gate can read.
 *
 *   node scripts/measure-stall-guard-headroom.mjs --run <id> [--run <id> ...]
 *   node scripts/measure-stall-guard-headroom.mjs --from <jobs.json> [--from ...]
 *   node scripts/measure-stall-guard-headroom.mjs --self-test
 *
 * ## Why this exists as a TOOL and not as a written-down number
 *
 * `check-stall-guard-budget.mjs` judges `C < T` and `T - C >= W`. All three are
 * statically readable, so it can judge them on every PR forever. The term that
 * actually consumes the budget is neither of those: it is `p + s` -- the job's
 * prep plus how far into the guarded step the output froze -- and the ceiling on
 * that is the HEALTHY RUN LENGTH, which no sweep of the tree can read. That gate
 * says so in its own header and declines to encode a number derived from it.
 *
 * So the number has to be re-measured, and the previous two attempts to carry it
 * forward were both prose: a table in an issue and a paragraph in a header. Both
 * are already stale (see "What this measured" below). A number that can only be
 * refreshed by hand is a number that silently rots -- the same defect class as a
 * cost note that drifted two orders of magnitude because nobody could re-derive
 * it. This file is the re-derivation, so the answer can rot LOUDLY: re-run it and
 * the arithmetic comes back with today's runs named in the output.
 *
 * ## What it measures
 *
 * For every guard-wrapped step in the tree -- enumerated by importing the gate's
 * OWN sweep, never a second list of step names -- it joins the static budget
 * (`W`, `C`, `T`) against GitHub's runner timestamps for real runs:
 *
 *     p  = job start            -> guarded step start   (checkout/setup/install)
 *     s  = guarded step start   -> guarded step end     (the healthy run itself)
 *
 * and reports, per step and per job family, the worst observed `p + s` and what
 * it implies for each of the guard's two kill paths:
 *
 *     undeferred (kill at the window): verdict lands at p + s + W
 *     deferred   (kill at the cap):    verdict lands at p + s + C
 *
 * A path is COVERED when its verdict lands before `T`. The deferred path is the
 * one that matters most and is checked least: a deferral means a buffering layer
 * is hiding a live suite from the guard, which the guard's own header calls a bug
 * report about the pipeline -- and losing that report to an unlabelled job
 * timeout is the exact state the guard exists to abolish.
 *
 * ## What it does NOT do
 *
 * It does not pick `T`, and it holds no margin of its own. `--margin-minutes`
 * defaults to 0 and, when passed, is printed as a NAMED addend rather than being
 * folded silently into the answer. Choosing the margin -- and deciding whether to
 * spend it at all -- is a fleet-budget decision this tool has no standing to make.
 *
 * It is also NOT a CI gate and is deliberately not wired into any workflow: it
 * needs the network and a token, and a check that cannot run offline has no
 * business in the lint farm. `check-stall-guard-budget.mjs` is the gate; this is
 * the instrument you reach for when that gate's headroom needs re-deriving.
 *
 * ## Reading the exit code
 *
 *   0  measured, and every measured step covers BOTH paths
 *   1  measured, and at least one step cannot deliver a verdict on some path
 *   2  REFUSED -- nothing was measured, so the run says nothing about the tree
 *
 * The 2 is not decoration. "Every step has headroom" is vacuously true of an
 * empty population, so a run that matched no step must not be able to print the
 * same green a real sweep prints. Every refusal names the population it saw.
 *
 * ## What this measured, and the number that had already gone stale
 *
 * Run 33135187774 (head `f907fbe9e`) -- the sample #12846 was filed on -- put the
 * worst `p + s` at 15m10s on `Test Core (1/6)`. Re-taken on three consecutive
 * merge_group runs of 2026-08-28 (33160601033 `8beb3deaf`, 33162164422
 * `b9dd923b9`, 33163163494 `f4e741bd1`):
 *
 *     run          worst p + s   where
 *     33163163494  17m52s        Test Core (1/6)
 *     33162164422  18m38s        Test Core (1/6)
 *     33160601033  18m48s        Test Core (1/6)
 *
 * Worst of the three: 18m48s, i.e. 18.80m against the card's 15.2m -- 3.6 minutes
 * worse, a 24% move in the direction that consumes budget. The card hedged that
 * "the slowest shard moves with the shard partition"; across these three runs it
 * did not move at all -- shard 1/6 was worst in every one, and in the card's
 * sample too. The instability is in the DURATION, not in which shard holds it.
 *
 * On the ci.yml `test` family (W=10, C=20, T=30) that makes both paths worse than
 * the card recorded:
 *
 *     undeferred: 18.80 + 10 = 28.80 < 30  -- still covered, by 1.2m
 *     deferred:   18.80 + 20 = 38.80 > 30  -- uncovered, by 8.8m
 *
 * The undeferred margin is the line worth watching. The card measured it at 4.8m
 * and treated it as comfortable; it is now 1.2m. That is the #4250 shape -- the
 * mid-suite freeze this guard was actually built for -- and on this trend it
 * reaches zero without anything in the tree changing and without any gate going
 * red, because the term that moved is the one no gate can read.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireDependency } from './import-prerequisite.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { guardDefaults, scan } from './check-stall-guard-budget.mjs';

/** Refusal to measure, kept distinct from a finding -- see check-stall-guard-budget. */
export const EXIT_REFUSED = 2;

export const DEFAULT_REPO = 'objectstack-ai/objectstack';

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

// -- Reading one run's jobs ---------------------------------------------------

/**
 * Normalise one `GET /actions/runs/{id}/jobs` payload into the observations this
 * tool works from. Accepts both the bare REST shape (`{jobs: [...]}`) and the
 * MCP wrapper (`{jobs: {jobs: [...]}}`), because the payload people actually have
 * on disk is whichever tool fetched it.
 *
 * A step with a missing or unparseable timestamp is DROPPED and counted, never
 * silently treated as zero: a zero-length guarded step would read as maximal
 * headroom, which is the one direction a measurement error must never fail in.
 *
 * @param {unknown} payload
 * @returns {{ jobs: object[], skipped: number }}
 */
export function readJobs(payload) {
  const raw =
    Array.isArray(payload?.jobs) ? payload.jobs
    : Array.isArray(payload?.jobs?.jobs) ? payload.jobs.jobs
    : Array.isArray(payload) ? payload
    : null;
  if (!raw) return { jobs: [], skipped: 0 };
  return { jobs: raw, skipped: 0 };
}

const ms = (iso) => {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/**
 * Every (guarded step name -> observation) pair a run payload yields.
 *
 * `p` is measured from the JOB's start, not the step's, because that is the
 * clock `timeout-minutes` runs on. For a job carrying two guarded steps the
 * second one's `p` therefore includes the first one's whole runtime -- which is
 * correct and is exactly the compounding a per-step reading would hide.
 *
 * @param {object[]} jobs
 * @param {Set<string>} wanted guarded step names, from the gate's sweep
 */
export function observe(jobs, wanted) {
  const seen = [];
  let dropped = 0;
  for (const job of jobs) {
    if (!Array.isArray(job?.steps)) continue;
    const jobStart = ms(job.started_at);
    if (jobStart === null) continue;
    for (const step of job.steps) {
      if (!wanted.has(step?.name)) continue;
      const a = ms(step.started_at);
      const b = ms(step.completed_at);
      if (a === null || b === null || b < a || a < jobStart) {
        dropped += 1;
        continue;
      }
      seen.push({
        step: step.name,
        job: job.name,
        conclusion: step.conclusion ?? job.conclusion ?? null,
        p: (a - jobStart) / 60000,
        s: (b - a) / 60000,
      });
    }
  }
  return { seen, dropped };
}

// -- The join -----------------------------------------------------------------

/**
 * Join the static census against the observations and judge each path.
 *
 * @param {object[]} sites from the gate's `scan`
 * @param {object[]} seen from `observe`
 * @param {number} margin extra minutes the caller wants on top, NAMED not folded
 */
export function judgeHeadroom(sites, seen, margin = 0) {
  const byStep = new Map();
  for (const o of seen) {
    const list = byStep.get(o.step) ?? [];
    list.push(o);
    byStep.set(o.step, list);
  }
  const rows = [];
  for (const site of sites) {
    const obs = byStep.get(site.step) ?? [];
    if (obs.length === 0) {
      rows.push({ site, observed: 0, worst: null });
      continue;
    }
    const worst = obs.reduce((a, b) => (b.p + b.s > a.p + a.s ? b : a));
    const ps = worst.p + worst.s;
    const undeferred = ps + site.window;
    const deferred = ps + site.cap;
    rows.push({
      site,
      observed: obs.length,
      worst,
      ps,
      undeferred,
      deferred,
      undeferredOk: undeferred < site.budget,
      deferredOk: deferred < site.budget,
      undeferredMargin: site.budget - undeferred,
      deferredMargin: site.budget - deferred,
      // What T would have to be for BOTH paths to clear, at the caller's margin.
      requiredT: ps + site.cap + margin,
    });
  }
  return rows;
}

const fmt = (minutes) => {
  const total = Math.round(minutes * 60);
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  return `${sign}${Math.floor(abs / 60)}m${String(abs % 60).padStart(2, '0')}s`;
};

// -- Fetching -----------------------------------------------------------------

async function fetchRunJobs(repo, runId, token) {
  const url = `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=100&filter=latest`;
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'measure-stall-guard-headroom' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(
      `GET ${url} -> HTTP ${res.status}. ` +
        (res.status === 403 || res.status === 401
          ? 'Set GITHUB_TOKEN (or GH_TOKEN) to a token that can read Actions on this repo, or save the payload ' +
            'and pass it with --from <file.json>.'
          : 'Nothing was measured.'),
    );
  }
  return res.json();
}

// -- The report ---------------------------------------------------------------

export function report(rows, meta, io = {}) {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;

  const measured = rows.filter((r) => r.worst);
  const unmeasured = rows.filter((r) => !r.worst);

  if (measured.length === 0) {
    error(
      'measure-stall-guard-headroom: REFUSING to report a verdict -- the runs supplied contain no ' +
        `guard-wrapped step (${rows.length} site(s) in the tree, ${meta.jobs} job(s) read from ` +
        `${meta.runs.length} run(s)).\n` +
        '  "every step has headroom" is vacuously true of an empty population, so this cannot print a green.\n' +
        '  Most likely the runs given did not execute the guarded jobs (on this repo a push to `main` has the\n' +
        '  matrix filtered out -- use a `pull_request` or `merge_group` run), or a step was renamed in the\n' +
        '  workflow without this measurement being re-taken.',
    );
    for (const r of rows) error(`  - never observed: ${r.site.file} job \`${r.site.job}\` step \`${r.site.step}\``);
    return EXIT_REFUSED;
  }

  log(`measure-stall-guard-headroom: ${measured.length} of ${rows.length} guard-wrapped step(s) observed across ${meta.runs.length} run(s)`);
  log('');
  log(`  runs read: ${meta.runs.join(', ')}`);
  if (meta.margin) log(`  margin:    +${meta.margin}m, supplied by --margin-minutes (this tool holds no margin of its own)`);
  log('');

  for (const r of measured.sort((a, b) => b.ps - a.ps)) {
    const s = r.site;
    log(`  ${s.file}  job \`${s.job}\`  step \`${s.step}\``);
    log(`      W ${s.window}m · C ${s.cap}m · T ${s.budget}m (${s.budgetSource})`);
    log(`      worst observed: p ${fmt(r.worst.p)} + s ${fmt(r.worst.s)} = ${fmt(r.ps)}   (${r.observed} observation(s), worst on \`${r.worst.job}\`)`);
    log(
      `      undeferred  p+s+W = ${fmt(r.undeferred)} vs T ${s.budget}m  ->  ` +
        (r.undeferredOk ? `COVERED, ${fmt(r.undeferredMargin)} to spare` : `UNCOVERED by ${fmt(-r.undeferredMargin)}`),
    );
    log(
      `      deferred    p+s+C = ${fmt(r.deferred)} vs T ${s.budget}m  ->  ` +
        (r.deferredOk ? `COVERED, ${fmt(r.deferredMargin)} to spare` : `UNCOVERED by ${fmt(-r.deferredMargin)}`),
    );
    log(`      T required for both paths = p+s + C${meta.margin ? ' + margin' : ''} = ${r.requiredT.toFixed(2)}m`);
    log('');
  }

  for (const r of unmeasured) {
    log(`  NOT OBSERVED in these runs: ${r.site.file} job \`${r.site.job}\` step \`${r.site.step}\``);
  }
  if (unmeasured.length) log('');

  const bad = measured.filter((r) => !r.undeferredOk || !r.deferredOk);
  if (bad.length === 0) {
    log('Every measured step delivers its verdict before its job timeout on BOTH paths.');
    return 0;
  }
  log(`${bad.length} measured step(s) cannot deliver a verdict on some path:`);
  for (const r of bad) {
    const paths = [!r.undeferredOk && 'undeferred', !r.deferredOk && 'deferred'].filter(Boolean).join(' + ');
    log(`  - ${r.site.job}/${r.site.step}: ${paths} -- needs T >= ${Math.ceil(r.requiredT)}m, has ${r.site.budget}m`);
  }
  return 1;
}

// -- CLI ----------------------------------------------------------------------

export async function main(argv, io = {}) {
  const error = io.error ?? console.error;
  let repo = DEFAULT_REPO;
  let margin = 0;
  const runs = [];
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') repo = argv[++i] ?? '';
    else if (argv[i] === '--run') runs.push(argv[++i] ?? '');
    else if (argv[i] === '--from') files.push(argv[++i] ?? '');
    else if (argv[i] === '--margin-minutes') margin = Number(argv[++i]);
    else {
      error(`measure-stall-guard-headroom: unknown option ${argv[i]}`);
      return EXIT_REFUSED;
    }
  }
  if (!Number.isFinite(margin) || margin < 0) {
    error('measure-stall-guard-headroom: --margin-minutes must be a non-negative number of minutes.');
    return EXIT_REFUSED;
  }
  if (runs.length === 0 && files.length === 0) {
    error(
      'measure-stall-guard-headroom: nothing to measure -- pass --run <id> (fetches from the API) or\n' +
        '  --from <jobs.json> (a saved `GET /actions/runs/{id}/jobs` payload). Nothing was measured.',
    );
    return EXIT_REFUSED;
  }

  const { parse } = await requireDependency('yaml', () => import('yaml'), import.meta.url);
  const root = repoRoot();
  const { defaults, problems } = guardDefaults(root);
  if (!defaults) {
    error('measure-stall-guard-headroom: REFUSING -- the guard\'s own defaults could not be read.');
    for (const p of problems) error(`  - ${p}`);
    return EXIT_REFUSED;
  }
  const swept = scan(root, defaults, parse);
  if (swept.sites.length === 0) {
    error('measure-stall-guard-headroom: REFUSING -- the tree holds no guard-wrapped step, so there is nothing to measure.');
    return EXIT_REFUSED;
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const payloads = [];
  const labels = [];
  for (const file of files) {
    if (!existsSync(file)) {
      error(`measure-stall-guard-headroom: --from ${file} does not exist. Nothing was measured.`);
      return EXIT_REFUSED;
    }
    const text = readFileSync(file, 'utf8');
    const at = text.indexOf('{');
    payloads.push(JSON.parse(at > 0 ? text.slice(at) : text));
    labels.push(file);
  }
  for (const id of runs) {
    payloads.push(await fetchRunJobs(repo, id, token));
    labels.push(String(id));
  }

  const wanted = new Set(swept.sites.map((s) => s.step));
  const allJobs = [];
  for (const p of payloads) allJobs.push(...readJobs(p).jobs);
  const { seen } = observe(allJobs, wanted);
  const rows = judgeHeadroom(swept.sites, seen, margin);
  return report(rows, { runs: labels, jobs: allJobs.length, margin }, io);
}

// -- Self-test ----------------------------------------------------------------

/**
 * Drives the real `main()` over real fixture payloads on disk, in all three
 * directions the exit codes claim: a covered tree, an uncovered one, and a
 * population of zero. The middle case is the one that matters -- a tool that
 * can only print "covered" is indistinguishable from one that never looked.
 */
export async function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (name, ok, detail) => {
    checked += 1;
    if (!ok) failures.push(detail ? `${name} -- ${detail}` : name);
  };
  const dirs = [];

  /** A saved jobs payload with one guarded step of the given prep/run length. */
  const payload = (stepName, prepSec, runSec) => {
    const t0 = Date.parse('2026-08-28T10:00:00Z');
    const iso = (offset) => new Date(t0 + offset * 1000).toISOString();
    return {
      jobs: [
        {
          name: 'Fixture Job (1/6)',
          conclusion: 'success',
          started_at: iso(0),
          completed_at: iso(prepSec + runSec + 10),
          steps: [
            { name: 'Set up job', conclusion: 'success', started_at: iso(0), completed_at: iso(1) },
            { name: stepName, conclusion: 'success', started_at: iso(prepSec), completed_at: iso(prepSec + runSec) },
          ],
        },
      ],
    };
  };
  const write = (obj) => {
    const dir = mkdtempSync(join(tmpdir(), 'stall-headroom-'));
    dirs.push(dir);
    const file = join(dir, 'jobs.json');
    writeFileSync(file, JSON.stringify(obj));
    return file;
  };
  const drive = async (argv) => {
    const out = [];
    const code = await main(argv, { log: (m) => out.push(String(m)), error: (m) => out.push(String(m)) });
    return { code, out: out.join('\n') };
  };

  try {
    const { parse } = await requireDependency('yaml', () => import('yaml'), import.meta.url);
    const root = repoRoot();
    const { defaults } = guardDefaults(root);
    const swept = scan(root, defaults, parse);
    assert('the real tree still yields guard-wrapped sites to measure', swept.sites.length > 0, JSON.stringify(swept.problems));
    const site = swept.sites.find((s) => s.step === "Run this shard's tests") ?? swept.sites[0];

    // 1. GREEN: a short healthy run clears both paths.
    const green = await drive(['--from', write(payload(site.step, 30, 60))]);
    assert('a short healthy run reports covered on both paths', green.code === 0, green.out);
    assert('...and the green is a MEASUREMENT: it names the observation it made', /worst observed: p /.test(green.out), green.out);

    // 2. RED, deferred only: p+s big enough to lose the cap path but not the window path.
    //    With W=10 C=20 T=30 that is any p+s in (10, 20).
    const midSec = Math.round((site.budget - site.cap + (site.budget - site.window)) / 2 * 60);
    const mid = await drive(['--from', write(payload(site.step, 30, midSec - 30))]);
    assert('a run that only loses the DEFERRED path is reported red', mid.code === 1, mid.out);
    assert('...and names the deferred path specifically', /deferred/.test(mid.out) && /UNCOVERED/.test(mid.out), mid.out);
    assert('...while still reporting the undeferred path as covered', /undeferred.*COVERED/.test(mid.out), mid.out);

    // 3. RED, both paths: a run longer than T - W.
    const both = await drive(['--from', write(payload(site.step, 30, (site.budget - site.window) * 60))]);
    assert('a run that loses BOTH paths is reported red', both.code === 1, both.out);
    assert('...and says the undeferred path is uncovered too', /undeferred.*UNCOVERED/.test(both.out), both.out);

    // 4. REFUSAL: a payload with no guarded step at all must not read as green.
    const empty = await drive(['--from', write(payload('Some Unrelated Step', 30, 60))]);
    assert('a payload with no guarded step REFUSES rather than printing green', empty.code === EXIT_REFUSED, empty.out);
    assert('...and says nothing was measured', /REFUSING/.test(empty.out), empty.out);

    // 5. No input at all is a refusal, not a vacuous pass.
    const none = await drive([]);
    assert('no --run and no --from refuses', none.code === EXIT_REFUSED, none.out);

    // 6. The margin is NAMED, never folded in silently.
    const withMargin = await drive(['--from', write(payload(site.step, 30, 60)), '--margin-minutes', '5']);
    assert('a supplied margin is disclosed in the output', /margin:\s+\+5m/.test(withMargin.out), withMargin.out);

    // 7. A step whose timestamps are unusable is DROPPED, never counted as zero.
    const broken = payload(site.step, 30, 60);
    broken.jobs[0].steps[1].completed_at = null;
    const dropped = await drive(['--from', write(broken)]);
    assert('an unparseable step timestamp refuses rather than reading as zero-length', dropped.code === EXIT_REFUSED, dropped.out);
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`measure-stall-guard-headroom --self-test: ${failures.length} of ${checked} assertion(s) FAILED\n`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(`measure-stall-guard-headroom --self-test: ${checked} assertion(s) passed.`);
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const code = argv.includes('--self-test') ? await selfTest() : await main(argv);
  process.exit(code);
}
