#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * measure-stall-guard-headroom (#12846) -- re-take the one number the stall
 * guard's budget depends on and that no static gate can read.
 *
 *   node scripts/measure-stall-guard-headroom.mjs --run <id> [--run <id> ...]
 *   node scripts/measure-stall-guard-headroom.mjs --from <jobs.json> [--from ...]
 *   node scripts/measure-stall-guard-headroom.mjs --root <dir>
 *   node scripts/measure-stall-guard-headroom.mjs --self-test
 *
 * ## Why this exists as a TOOL and not as a written-down number
 *
 * `check-stall-guard-budget.mjs` judges `C < T` and `T - C >= W`, all statically
 * readable. The term that actually consumes the budget is `p + s` -- the job's
 * prep plus how far into the guarded step the output froze -- whose ceiling is
 * the HEALTHY RUN LENGTH, and no sweep of the tree can read that. So it has to be
 * re-measured rather than checked, and the two previous attempts to carry it
 * forward were prose -- a table in an issue and a paragraph in a header -- both of
 * which had drifted by the time anyone re-took them. This file is the
 * re-derivation, so the answer can rot LOUDLY instead of silently.
 *
 * The boundary this measures, and what a green from that gate does and does not
 * promise, is stated once in the header of `check-stall-guard-budget.mjs`. It is
 * deliberately not restated here: two copies of that argument would be two things
 * that must agree with nobody holding them to it.
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
 * ## The join key is the triple (file, job, step) -- #13121
 *
 * A guarded SITE is identified by `(file, job id, step name)`, which is what
 * every line this tool prints has always said. The join used to be keyed on the
 * step NAME alone. That is an identifier which is unique only inside one job,
 * used as if it were global -- the same mistake `attachSiblings` in the gate
 * carries a paragraph about, one level up on the job axis (#12959, which keys
 * sibling grouping on `(file, job id)` because this tree really does reuse three
 * job ids across files).
 *
 * Keyed on the name, two guarded steps that happen to share a `name:` merge into
 * ONE bucket and each site is then judged against `obs.reduce(worst)` over the
 * union -- the worst `p + s` of one job attributed to a site in another. The
 * output shape is identical to a correct run, so nothing about it looks wrong.
 * Nor is the error consistently conservative: with asymmetric observation sets
 * -- runs in which only the co-named step actually executed -- the site that
 * never ran at all is printed as MEASURED and COVERED, quoting an observation
 * belonging to a different job, where the honest line is `NOT OBSERVED`.
 *
 * So attribution resolves each observation to exactly one site:
 *
 *   - the observation's own `workflow_name` and job name are matched against the
 *     identity the workflow file declares for each site carrying that step name
 *     (the workflow's `name:`, and the job's `name:` template with every
 *     `${{ ... }}` standing for one expansion -- a matrix leg such as
 *     `Test Core (3/6)`). A component the payload does not carry is UNKNOWN: it
 *     can neither confirm a candidate nor exclude one;
 *   - exactly one survivor is attributed. NONE means the observation belongs to
 *     no guarded site -- it is EXCLUDED and reported, never dropped in silence;
 *     its site reads NOT OBSERVED, the direction that cannot invent headroom;
 *   - MORE than one is a COLLISION, and a collision REFUSES. Picking the worst,
 *     the first or the average is the same defect wearing a verdict: a merged
 *     bucket measures something other than what the row claims. Two sites that
 *     are identical on the triple itself land here too -- no identity separates
 *     them, a fourth component would be needed, and the refusal says so.
 *
 * The narrowing is unconditional and not reserved for co-named steps. "The
 * triple when the name happens to be ambiguous" is not a key: it is the same
 * defect with the collision size fixed at one, reachable with no duplicate
 * `name:` anywhere -- an UNGUARDED step copying a guarded step's name.
 *
 * The identity metadata is read from the same workflow directory the gate swept.
 * That is not a second population -- the sites still come from `scan`, and only
 * `scan`; this reads the `name:` fields those very sites already sit in.
 *
 * The COLLECTION end (`wanted`) stays keyed on the step name deliberately. As a
 * filter the name yields a SUPERSET of the observations any per-site join can
 * use, so it cannot under-collect. What did under-collect was the observation
 * RECORD: it threw away `workflow_name`, leaving the join blind on two of the
 * three axes even when the payload carried them.
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
 *   2  REFUSED -- nothing was measured, or an observation could not be attributed
 *      to exactly one site, so the run says nothing about the tree
 *
 * The 2 is not decoration. "Every step has headroom" is vacuously true of an
 * empty population, so a run that matched no step must not be able to print the
 * same green a real sweep prints. Every refusal names the population it saw.
 *
 * ## Re-taking it
 *
 * Pass `--run` for runs to fetch, or `--from` for saved
 * `GET /actions/runs/{id}/jobs` payloads. Use a `pull_request` or `merge_group`
 * run: a push to `main` has the guarded matrix filtered out, and this tool
 * REFUSES on an empty population rather than printing a green.
 *
 * `--root <dir>` measures a checkout other than the one this file sits in. It is
 * also what makes the collision refusal above demonstrable: the branch cannot be
 * reached from this tree -- all seven guarded steps carry distinct names -- and a
 * refusal nobody can trigger is decoration, not a guarantee.
 *
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireDependency } from './import-prerequisite.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { WORKFLOW_DIR, guardDefaults, scan } from './check-stall-guard-budget.mjs';

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
 * `wanted` is a name-keyed SUPERSET filter and is deliberately not the join key:
 * every observation any per-site join could use has a step name matching some
 * site, so filtering on the name cannot under-collect. Each observation carries
 * the runner's own identity (`workflow`, `job`) alongside the numbers, because
 * that is what `attribute` needs to resolve a co-named collision -- and dropping
 * it, not the filter, is what left the old join blind (#13121).
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
        job: typeof job.name === 'string' ? job.name : null,
        workflow: typeof job.workflow_name === 'string' ? job.workflow_name : null,
        conclusion: step.conclusion ?? job.conclusion ?? null,
        p: (a - jobStart) / 60000,
        s: (b - a) / 60000,
      });
    }
  }
  return { seen, dropped };
}

// -- Identity: which runner job is which site ---------------------------------

/** The triple a guarded site is really identified by. Printed on every line. */
export const siteKey = (site) => JSON.stringify([site.file, site.job, site.step]);

/** Human form of the same triple, for the messages a refusal has to name. */
export const siteLabel = (site) => `${site.file} job \`${site.job}\` step \`${site.step}\``;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How GitHub will have named the runner job for `jobId`, as a predicate.
 *
 * With a `name:` the runner uses it verbatim, with every `${{ ... }}` expanded --
 * unresolvable here, so each one stands for one expansion (`Test Core (3/6)`
 * against `Test Core (${{ matrix.shard }}/6)`). Without a `name:` the runner uses
 * the job id, and a matrix leg appends ` (v1, v2)`.
 *
 * @param {string} jobId
 * @param {unknown} template the job's `name:`, if it declares one
 */
export function jobNameAccepts(jobId, template) {
  if (typeof template !== 'string' || template.length === 0) {
    return (name) => name === jobId || name.startsWith(`${jobId} (`);
  }
  const literal = template.split(/\$\{\{[\s\S]*?\}\}/g).map(escapeRegExp);
  const pattern = new RegExp(`^${literal.join('[\\s\\S]*')}$`);
  return (name) => pattern.test(name);
}

/**
 * The workflow/job `name:` declarations for the same workflow directory the gate
 * swept, keyed by the `file` string `scan` puts on each site.
 *
 * This is identity metadata for an already-enumerated population, NOT a second
 * enumeration: nothing here decides which steps are guarded, and a file that
 * fails to parse simply contributes no identity, which downgrades its sites'
 * legs to UNKNOWN rather than excluding them.
 *
 * @param {string} root
 * @param {(text: string) => unknown} parseYaml
 * @returns {Map<string, { workflow: string|null, jobs: Map<string, unknown> }>}
 */
export function workflowIdentities(root, parseYaml) {
  const identities = new Map();
  const dir = join(root, WORKFLOW_DIR);
  if (!existsSync(dir)) return identities;
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))) {
    let doc;
    try {
      doc = parseYaml(readFileSync(join(dir, name), 'utf8'));
    } catch {
      continue;
    }
    const jobs = new Map();
    const jobMap = doc && typeof doc === 'object' ? doc.jobs : undefined;
    if (jobMap && typeof jobMap === 'object') {
      for (const [jobId, job] of Object.entries(jobMap)) jobs.set(jobId, job?.name);
    }
    identities.set(`${WORKFLOW_DIR}/${name}`, {
      workflow: typeof doc?.name === 'string' ? doc.name : null,
      jobs,
    });
  }
  return identities;
}

/**
 * Whether an observation's runner identity confirms, excludes, or says nothing
 * about a candidate site.
 *
 * Three-valued on purpose. A payload that does not carry `workflow_name` is not
 * evidence that the observation belongs elsewhere -- treating absence as a
 * mismatch would silently drop real observations, and a dropped observation is
 * how a site stops being measured without anyone noticing.
 *
 * @returns {'match'|'mismatch'|'unknown'}
 */
export function identityVerdict(site, o, identities) {
  const declared = identities?.get(site.file);
  const legs = [];

  if (typeof o.workflow !== 'string' || !declared) legs.push('unknown');
  else legs.push(o.workflow === declared.workflow || o.workflow === site.file ? 'match' : 'mismatch');

  if (typeof o.job !== 'string' || !declared || !declared.jobs.has(site.job)) legs.push('unknown');
  else legs.push(jobNameAccepts(site.job, declared.jobs.get(site.job))(o.job) ? 'match' : 'mismatch');

  if (legs.includes('mismatch')) return 'mismatch';
  return legs.includes('match') ? 'match' : 'unknown';
}

/**
 * Attribute every observation to exactly one site, or refuse.
 *
 * The narrowing runs on EVERY observation, not only on a co-named one. "The
 * triple when the name happens to be ambiguous" is not a join key -- it is the
 * old defect with the collision size fixed at one, and it is reachable without
 * any duplicate `name:` at all: an unguarded step somewhere in the tree that
 * copies a guarded step's name produces an observation the name-key happily
 * attributes to a job it never ran in.
 *
 * The three outcomes are deliberately not the same outcome:
 *
 *   1 candidate  -> attributed.
 *   0 candidates -> EXCLUDED and reported. The observation belongs to no guarded
 *                   site; its site simply reads NOT OBSERVED, which is the safe
 *                   direction (an excluded observation cannot manufacture
 *                   headroom) but must never be silent.
 *   >1           -> COLLISION, which REFUSES. Two sites the evidence cannot
 *                   separate -- including two that are identical on the triple
 *                   itself, where no amount of identity would separate them and
 *                   a fourth component would be needed.
 *
 * @param {object[]} sites from the gate's `scan`
 * @param {object[]} seen from `observe`
 * @param {Map<string, object>} [identities] from `workflowIdentities`
 * @returns {{ byKey: Map<string, object[]>, collisions: object[], excluded: object[] }}
 */
export function attribute(sites, seen, identities) {
  const byName = new Map();
  for (const site of sites) {
    const list = byName.get(site.step) ?? [];
    list.push(site);
    byName.set(site.step, list);
  }
  const byKey = new Map();
  const collisions = [];
  const excluded = [];
  for (const o of seen) {
    const candidates = byName.get(o.step) ?? [];
    const resolved = candidates.filter((site) => identityVerdict(site, o, identities) !== 'mismatch');
    if (resolved.length === 0) {
      excluded.push({ observation: o, candidates });
      continue;
    }
    if (resolved.length > 1) {
      collisions.push({ observation: o, candidates: resolved });
      continue;
    }
    const key = siteKey(resolved[0]);
    const list = byKey.get(key) ?? [];
    list.push(o);
    byKey.set(key, list);
  }
  return { byKey, collisions, excluded };
}

// -- The join -----------------------------------------------------------------

/**
 * Join the static census against the observations and judge each path.
 *
 * @param {object[]} sites from the gate's `scan`
 * @param {object[]} seen from `observe`
 * @param {number} margin extra minutes the caller wants on top, NAMED not folded
 * @param {Map<string, object>} [identities] from `workflowIdentities`
 * @returns {{ rows: object[], collisions: object[], excluded: object[] }}
 */
export function judgeHeadroom(sites, seen, margin = 0, identities) {
  const { byKey, collisions, excluded } = attribute(sites, seen, identities);
  const rows = [];
  for (const site of sites) {
    const obs = byKey.get(siteKey(site)) ?? [];
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
  return { rows, collisions, excluded };
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

export function report(judged, meta, io = {}) {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;

  const rows = judged.rows;
  const collisions = judged.collisions ?? [];
  const excluded = judged.excluded ?? [];
  const measured = rows.filter((r) => r.worst);
  const unmeasured = rows.filter((r) => !r.worst);
  const identify = (o) =>
    [
      o.workflow ? `workflow \`${o.workflow}\`` : 'workflow unknown (payload carries no `workflow_name`)',
      o.job ? `job \`${o.job}\`` : 'job unknown (payload does not name the job)',
    ].join(' ');

  /**
   * Loud, never silent, and emitted on BOTH exits. An excluded observation
   * cannot invent headroom -- its site reads NOT OBSERVED -- but a payload that
   * disagrees with the tree about which job a step lives in is itself drift, and
   * the run where EVERY observation is excluded is exactly the run that would
   * otherwise be reported as "the runs contain no guard-wrapped step", which is
   * a different and untrue statement.
   */
  const emitExcluded = (sink) => {
    if (!excluded.length) return;
    sink(`  ${excluded.length} observation(s) EXCLUDED -- the runner identity matches no guard-wrapped site:`);
    for (const c of excluded) {
      const o = c.observation;
      sink(`    - step \`${o.step}\` (${identify(o)}) -- the tree declares that step only in:`);
      for (const site of c.candidates) sink(`        * ${siteLabel(site)}`);
    }
    sink('    Either the run predates a rename, or an unguarded step is copying a guarded step\'s name.');
  };

  // Ambiguity outranks every other verdict: a run holding even one observation
  // that could belong to two sites cannot report on EITHER of them, and the rows
  // it could have judged are not worth the risk of being read as a whole answer.
  if (collisions.length > 0) {
    error(
      `measure-stall-guard-headroom: REFUSING to report a verdict -- ${collisions.length} observation(s) ` +
        'could not be attributed to exactly one guarded step.\n' +
        '  A guarded site is (file, job, step). Two guarded steps sharing a `name:` merge into one bucket, and\n' +
        '  each is then judged against the worst reading of the union -- a measurement of something other than\n' +
        '  what the row claims. Picking the worst, the first or the average would be the same defect wearing a\n' +
        '  verdict, so this refuses instead. Nothing was measured.',
    );
    for (const c of collisions) {
      const o = c.observation;
      error(`  - observation of step \`${o.step}\` (${identify(o)}) matches ${c.candidates.length} site(s):`);
      for (const site of c.candidates) error(`      * ${siteLabel(site)}`);
    }
    error(
      '  Fix it at the source: give the co-named steps distinct `name:` values, or supply payloads that carry\n' +
        '  `workflow_name` and the job names (a fresh `GET /actions/runs/{id}/jobs` does).',
    );
    return EXIT_REFUSED;
  }

  if (measured.length === 0) {
    error(
      'measure-stall-guard-headroom: REFUSING to report a verdict -- the runs supplied yielded no attributable ' +
        `guard-wrapped step (${rows.length} site(s) in the tree, ${meta.jobs} job(s) read from ` +
        `${meta.runs.length} run(s), ${excluded.length} observation(s) excluded on identity).\n` +
        '  "every step has headroom" is vacuously true of an empty population, so this cannot print a green.\n' +
        '  Most likely the runs given did not execute the guarded jobs (on this repo a push to `main` has the\n' +
        '  matrix filtered out -- use a `pull_request` or `merge_group` run), or a step was renamed in the\n' +
        '  workflow without this measurement being re-taken.',
    );
    emitExcluded(error);
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
    const on = r.worst.job ? `worst on \`${r.worst.job}\`` : 'worst on a job the payload did not name';
    log(`      worst observed: p ${fmt(r.worst.p)} + s ${fmt(r.worst.s)} = ${fmt(r.ps)}   (${r.observed} observation(s), ${on})`);
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

  if (excluded.length) {
    emitExcluded(log);
    log('');
  }

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
  let rootOverride = '';
  const runs = [];
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') repo = argv[++i] ?? '';
    else if (argv[i] === '--run') runs.push(argv[++i] ?? '');
    else if (argv[i] === '--from') files.push(argv[++i] ?? '');
    else if (argv[i] === '--root') rootOverride = argv[++i] ?? '';
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
  const root = rootOverride ? resolve(rootOverride) : repoRoot();
  if (rootOverride && !existsSync(root)) {
    error(`measure-stall-guard-headroom: --root ${rootOverride} does not exist. Nothing was measured.`);
    return EXIT_REFUSED;
  }
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

  // Name-keyed COLLECTION (a superset filter), triple-keyed ATTRIBUTION. See the
  // header: the filter never under-collects; the record used to under-carry.
  const wanted = new Set(swept.sites.map((s) => s.step));
  const allJobs = [];
  for (const p of payloads) allJobs.push(...readJobs(p).jobs);
  const { seen } = observe(allJobs, wanted);
  const judged = judgeHeadroom(swept.sites, seen, margin, workflowIdentities(root, parse));
  return report(judged, { runs: labels, jobs: allJobs.length, margin }, io);
}

// -- Self-test ----------------------------------------------------------------

/**
 * Drives the real `main()` over real fixture payloads on disk, in all three
 * directions the exit codes claim: a covered tree, an uncovered one, and a
 * population of zero. The middle case is the one that matters -- a tool that
 * can only print "covered" is indistinguishable from one that never looked.
 *
 * Cases 8-13 own the join (#13121). They need a fixture TREE and not only a
 * fixture payload, because the collision they exercise cannot be reached from
 * this repo -- all seven guarded steps carry distinct names, which case 8 asserts
 * rather than assumes -- and a refusal branch nobody can trigger is decoration.
 */
export async function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (name, ok, detail) => {
    checked += 1;
    if (!ok) failures.push(detail ? `${name} -- ${detail}` : name);
  };
  const dirs = [];

  const { parse } = await requireDependency('yaml', () => import('yaml'), import.meta.url);
  const identities = workflowIdentities(repoRoot(), parse);

  /** The workflow name GitHub reports for a site's file, and the job name it prints. */
  const workflowNameFor = (site) => identities.get(site.file)?.workflow ?? site.file;
  const runnerNameFor = (site) => {
    const template = identities.get(site.file)?.jobs.get(site.job);
    // One matrix leg: `${{ matrix.shard }}` really does arrive expanded.
    return typeof template === 'string' && template ? template.replace(/\$\{\{[\s\S]*?\}\}/g, '1') : site.job;
  };

  /**
   * A saved jobs payload with one guarded step of the given prep/run length,
   * carrying the identity GitHub really puts on a job. Not decoration: the join
   * matches on it, so a fixture that omitted it would exercise only the UNKNOWN
   * leg and every case below would be blind to the matcher.
   */
  const payload = (site, prepSec, runSec, stepName = site.step) => {
    const t0 = Date.parse('2026-08-28T10:00:00Z');
    const iso = (offset) => new Date(t0 + offset * 1000).toISOString();
    return {
      jobs: [
        {
          name: runnerNameFor(site),
          workflow_name: workflowNameFor(site),
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

  /** One runner job carrying one guarded step, with the identity a real payload has. */
  const runnerJob = ({ job, workflow, step, prepSec, runSec }) => {
    const t0 = Date.parse('2026-08-28T10:00:00Z');
    const iso = (offset) => new Date(t0 + offset * 1000).toISOString();
    const j = {
      name: job,
      conclusion: 'success',
      started_at: iso(0),
      completed_at: iso(prepSec + runSec + 10),
      steps: [{ name: step, conclusion: 'success', started_at: iso(prepSec), completed_at: iso(prepSec + runSec) }],
    };
    if (workflow !== undefined) j.workflow_name = workflow;
    return j;
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

  /** A fixture checkout: a guard script the gate can read its defaults from, plus workflows. */
  const fixtureRoot = (workflows) => {
    const root = mkdtempSync(join(tmpdir(), 'stall-headroom-tree-'));
    dirs.push(root);
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(
      join(root, 'scripts/run-with-stall-guard.mjs'),
      'const DEFAULT_CAP_MULTIPLE = 2;\nlet stallMinutes = 10;\n',
    );
    mkdirSync(join(root, WORKFLOW_DIR), { recursive: true });
    for (const [name, text] of Object.entries(workflows)) writeFileSync(join(root, WORKFLOW_DIR, name), text);
    return root;
  };

  /** One workflow file: one job, one guarded step, both named. */
  const oneGuardedJob = ({ workflow, jobId, jobName, step, jobTimeout }) =>
    `name: ${workflow}\non: push\njobs:\n  ${jobId}:\n` +
    (jobName === undefined ? '' : `    name: ${jobName}\n`) +
    `    timeout-minutes: ${jobTimeout}\n    runs-on: ubuntu-latest\n    steps:\n      - name: ${step}\n` +
    '        run: |\n          node scripts/run-with-stall-guard.mjs --log x --stall-minutes 10 -- pnpm test\n';

  try {
    const root = repoRoot();
    const { defaults } = guardDefaults(root);
    const swept = scan(root, defaults, parse);
    assert('the real tree still yields guard-wrapped sites to measure', swept.sites.length > 0, JSON.stringify(swept.problems));
    const site = swept.sites.find((s) => s.step === "Run this shard's tests") ?? swept.sites[0];

    // 1. GREEN: a short healthy run clears both paths.
    const green = await drive(['--from', write(payload(site, 30, 60))]);
    assert('a short healthy run reports covered on both paths', green.code === 0, green.out);
    assert('...and the green is a MEASUREMENT: it names the observation it made', /worst observed: p /.test(green.out), green.out);

    // 2. RED, deferred only: p+s big enough to lose the cap path but not the window path.
    //    With W=10 C=20 T=30 that is any p+s in (10, 20).
    const midSec = Math.round((site.budget - site.cap + (site.budget - site.window)) / 2 * 60);
    const mid = await drive(['--from', write(payload(site, 30, midSec - 30))]);
    assert('a run that only loses the DEFERRED path is reported red', mid.code === 1, mid.out);
    assert('...and names the deferred path specifically', /deferred/.test(mid.out) && /UNCOVERED/.test(mid.out), mid.out);
    assert('...while still reporting the undeferred path as covered', /undeferred.*COVERED/.test(mid.out), mid.out);

    // 3. RED, both paths: a run longer than T - W.
    const both = await drive(['--from', write(payload(site, 30, (site.budget - site.window) * 60))]);
    assert('a run that loses BOTH paths is reported red', both.code === 1, both.out);
    assert('...and says the undeferred path is uncovered too', /undeferred.*UNCOVERED/.test(both.out), both.out);

    // 4. REFUSAL: a payload with no guarded step at all must not read as green.
    const empty = await drive(['--from', write(payload(site, 30, 60, 'Some Unrelated Step'))]);
    assert('a payload with no guarded step REFUSES rather than printing green', empty.code === EXIT_REFUSED, empty.out);
    assert('...and says nothing was measured', /REFUSING/.test(empty.out), empty.out);

    // 5. No input at all is a refusal, not a vacuous pass.
    const none = await drive([]);
    assert('no --run and no --from refuses', none.code === EXIT_REFUSED, none.out);

    // 6. The margin is NAMED, never folded in silently.
    const withMargin = await drive(['--from', write(payload(site, 30, 60)), '--margin-minutes', '5']);
    assert('a supplied margin is disclosed in the output', /margin:\s+\+5m/.test(withMargin.out), withMargin.out);

    // 7. A step whose timestamps are unusable is DROPPED, never counted as zero.
    const broken = payload(site, 30, 60);
    broken.jobs[0].steps[1].completed_at = null;
    const dropped = await drive(['--from', write(broken)]);
    assert('an unparseable step timestamp refuses rather than reading as zero-length', dropped.code === EXIT_REFUSED, dropped.out);

    // -- The join is on (file, job, step) -- #13121 ---------------------------

    // 8. The population claim this whole card rests on, CHECKED not assumed: the
    //    step name resolves a site here only because it is unique across the
    //    sweep. The day that stops being true, this assertion is the alarm.
    const names = swept.sites.map((s) => s.step);
    assert(
      'every guard-wrapped step in this tree carries a distinct name (the name-as-key premise)',
      new Set(names).size === names.length,
      names.filter((n, i) => names.indexOf(n) !== i).join(' | '),
    );
    const keys = swept.sites.map(siteKey);
    assert(
      'and (file, job, step) is unique across the real population -- no fourth component needed',
      new Set(keys).size === keys.length,
      keys.filter((k, i) => keys.indexOf(k) !== i).join(' | '),
    );

    // Two guarded steps sharing a `name:` across two jobs: the shape the tree is
    // one copy-paste away from, and the shape that used to merge silently.
    const SHARED = 'Run the suite';
    const coNamed = fixtureRoot({
      'a.yml': oneGuardedJob({ workflow: 'Tight', jobId: 'tight', jobName: 'Tight Job', step: SHARED, jobTimeout: 30 }),
      'b.yml': oneGuardedJob({ workflow: 'Loose', jobId: 'loose', jobName: 'Loose Job', step: SHARED, jobTimeout: 120 }),
    });

    // 9. ASYMMETRIC OBSERVATIONS -- the sharpest direction, and the one that is
    //    not conservative. Only the LOOSE job ran, and it ran fast. Keyed on the
    //    name, the TIGHT site (T 30m) was handed that 2m reading and printed
    //    `COVERED, 8m00s to spare` while quoting `worst on \`Loose Job\`` -- a
    //    confident green for a step these runs never executed. It must now say
    //    it was not observed, and nothing else.
    const onlyLoose = await drive([
      '--root', coNamed,
      '--from', write({ jobs: [runnerJob({ job: 'Loose Job', workflow: 'Loose', step: SHARED, prepSec: 60, runSec: 60 })] }),
    ]);
    assert('an observation of one co-named step is attributed to that step alone', onlyLoose.code === 0, onlyLoose.out);
    assert(
      '...so exactly ONE site is reported as measured, not both',
      (onlyLoose.out.match(/worst observed: p /g) ?? []).length === 1,
      onlyLoose.out,
    );
    assert(
      '...and the co-named site that never ran reads NOT OBSERVED, not a fabricated COVERED',
      /NOT OBSERVED in these runs: \.github\/workflows\/a\.yml job `tight`/.test(onlyLoose.out),
      onlyLoose.out,
    );

    // 10. Both observed, with wildly different readings. Keyed on the name the
    //     tight site inherited the loose job's 60m and was reported UNCOVERED;
    //     each site must now be judged against its OWN observation.
    const bothSeen = await drive([
      '--root', coNamed,
      '--from', write({
        jobs: [
          runnerJob({ job: 'Tight Job', workflow: 'Tight', step: SHARED, prepSec: 60, runSec: 60 }),
          runnerJob({ job: 'Loose Job', workflow: 'Loose', step: SHARED, prepSec: 1800, runSec: 1800 }),
        ],
      }),
    ]);
    assert('two co-named steps are judged against their own readings, not the union worst', bothSeen.code === 0, bothSeen.out);
    assert(
      '...the tight site keeps its own 2m00s reading',
      /job `tight`[\s\S]*?worst observed: p 1m00s \+ s 1m00s = 2m00s/.test(bothSeen.out),
      bothSeen.out,
    );
    assert(
      '...and the loose site keeps its own 60m00s reading',
      /job `loose`[\s\S]*?worst observed: p 30m00s \+ s 30m00s = 60m00s/.test(bothSeen.out),
      bothSeen.out,
    );

    // 11. REFUSAL: a payload that carries neither `workflow_name` nor a job name
    //     cannot separate the two candidates. Nothing here is resolvable, so
    //     nothing is picked -- not the worst, not the first, not the average.
    const blind = write({
      jobs: [{
        conclusion: 'success',
        started_at: '2026-08-28T10:00:00Z',
        completed_at: '2026-08-28T10:02:10Z',
        steps: [{ name: SHARED, conclusion: 'success', started_at: '2026-08-28T10:01:00Z', completed_at: '2026-08-28T10:02:00Z' }],
      }],
    });
    const unresolvable = await drive(['--root', coNamed, '--from', blind]);
    assert('an unattributable observation REFUSES rather than merging the bucket', unresolvable.code === EXIT_REFUSED, unresolvable.out);
    assert('...and names both candidate sites it could not choose between', /job `tight`[\s\S]*job `loose`/.test(unresolvable.out), unresolvable.out);
    assert('...and says which component the payload was missing', /carries no `workflow_name`/.test(unresolvable.out), unresolvable.out);
    assert('...and prints no headroom verdict at all', !/worst observed: p /.test(unresolvable.out), unresolvable.out);

    // 12. REFUSAL when the TRIPLE ITSELF collides -- two guarded steps sharing a
    //     name inside ONE job. A fully identified payload does not help: the two
    //     sites are indistinguishable on (file, job, step), so a fourth component
    //     would be needed and there is none. The refusal branch has to know that,
    //     which is why this case exists and does not assert a resolution.
    const sameJob = fixtureRoot({
      'c.yml':
        `name: Twin\non: push\njobs:\n  twin:\n    name: Twin Job\n    timeout-minutes: 30\n    runs-on: ubuntu-latest\n    steps:\n` +
        `      - name: ${SHARED}\n        run: |\n          node scripts/run-with-stall-guard.mjs --log x --stall-minutes 10 -- pnpm test\n` +
        `      - name: ${SHARED}\n        run: |\n          node scripts/run-with-stall-guard.mjs --log x --stall-minutes 10 -- pnpm test\n`,
    });
    const twins = await drive([
      '--root', sameJob,
      '--from', write({ jobs: [runnerJob({ job: 'Twin Job', workflow: 'Twin', step: SHARED, prepSec: 60, runSec: 60 })] }),
    ]);
    assert('two sites identical on the triple REFUSE even with a fully identified payload', twins.code === EXIT_REFUSED, twins.out);
    assert('...naming the two indistinguishable sites', (twins.out.match(/job `twin`/g) ?? []).length >= 2, twins.out);

    // 13. The matcher has to accept the shapes THIS tree really produces --
    //     matrix job names expanded from a `${{ ... }}` template under the
    //     workflow's own `name:`. A join that only works on fixtures is not one,
    //     and this sweeps EVERY site rather than a hand-picked easy one.
    const wholeTree = await drive([
      '--from', write({ jobs: swept.sites.map((s) => runnerJob({ job: runnerNameFor(s), workflow: workflowNameFor(s), step: s.step, prepSec: 30, runSec: 60 })) }),
    ]);
    assert('a realistic payload for the real tree resolves every guarded site', wholeTree.code === 0, wholeTree.out);
    assert(
      `...all ${swept.sites.length} of them, none excluded and none merged`,
      (wholeTree.out.match(/worst observed: p /g) ?? []).length === swept.sites.length,
      wholeTree.out,
    );
    assert('...with nothing left unattributable', !/EXCLUDED/.test(wholeTree.out) && !/REFUSING/.test(wholeTree.out), wholeTree.out);

    // 14. The other side of the same matcher: an observation whose runner
    //     identity CONTRADICTS the only site carrying that step name is excluded
    //     and said out loud, and the site reads NOT OBSERVED. That is the safe
    //     direction -- an excluded observation cannot invent headroom -- but the
    //     old join attributed it, which is this defect with the collision size
    //     fixed at one.
    const foreign = await drive([
      '--from', write({ jobs: [runnerJob({ job: 'Some Other Job', workflow: 'Some Other Workflow', step: site.step, prepSec: 30, runSec: 60 })] }),
    ]);
    assert('an observation from a job that is not the guarded one is not attributed to it', foreign.code === EXIT_REFUSED, foreign.out);
    assert('...and the exclusion is reported, not swallowed', /EXCLUDED/.test(foreign.out) || /REFUSING/.test(foreign.out), foreign.out);
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
