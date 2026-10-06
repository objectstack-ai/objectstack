#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * check-publish-lane-refs — every publish-capable workflow is reachable from
 * `main` alone, so a push to the 17.x maintenance branch (`release/17.x`)
 * starts no version PR and no publish.
 *
 *   node scripts/check-publish-lane-refs.mjs              # the gate
 *   node scripts/check-publish-lane-refs.mjs --self-test  # prove every rule can go red
 *
 * ## Why this file exists
 *
 * The v18 branch model is A (ruled 2026-10-06, 「同意分支模型」): v18 develops on
 * `main`, and 17.x continues ONLY as a `release/17.x` branch that cloud pins by
 * commit, for security fixes and release blockers. The same day the maintainer
 * ruled that no second npm lane is built for it (「不建议再建立一套 npm 发布流程，
 * 我运维太麻烦」). So the property the maintenance line rests on is a NEGATIVE
 * one — nothing publishes from it — and a negative property is exactly what a
 * clean tree cannot demonstrate: `release.yml` today never sees the branch, and
 * the PR that adds `release/**` to its `branches:` would look like one more
 * trigger edit. This gate turns the property into a reading.
 *
 * ## What it pins, per workflow in PUBLISH_LANES
 *
 *   R1  the trigger KEY SET equals the declared one — no `pull_request`, no
 *       `merge_group`, no second `push`-like event arrives unannounced;
 *   R2  where `push` is declared, `on.push.branches` is EXACTLY the declared
 *       list (`main`), with no `branches-ignore`, `tags` or `tags-ignore` beside
 *       it. A bare `push:` runs on every branch; a `tags:` entry fires on a tag
 *       pushed from any branch; both are refs this lane must not answer. The list
 *       is pinned as a list, not evaluated as a glob, so `release/**` and
 *       `release/17.x` red the same way — there is nothing to get subtly right;
 *   R4  a job whose `if:` decides what a PUSH may start keeps its predicate
 *       byte-for-byte (whitespace folded): `version-pr` runs on `schedule` or on
 *       a `refresh_version_pr` dispatch and never on `push`, so no event a push
 *       can raise regenerates a version PR on ANY branch;
 *   R5  the job that publishes carries the ref refusal
 *       `[ "${GITHUB_REF}" != "refs/heads/main" ]` followed by `exit 1` in one
 *       of its steps — the layer that holds even against a `workflow_dispatch`
 *       pointed at the maintenance branch by hand.
 *
 * Plus the SWEEP, in both directions: every workflow whose parsed `run:` /
 * `uses:` carries a publish-capable command (PUBLISH_CAPABLE) must be a roster
 * row, and every roster row must still carry one — a row for a workflow that
 * stopped publishing is dead config, and dead config is how a roster rots into
 * one that pins nothing. Comment lines inside `run:` blocks are dropped before
 * matching, so prose about publishing never enrols a workflow.
 *
 * And the FLOOR: a missing `.github/workflows`, an empty one, a roster file
 * that is absent, or a file the YAML parser refuses is RED — never a pass over
 * nothing (the repo-wide "not measured is not clean" rule).
 *
 * ## Two mechanism notes a reader will otherwise re-derive
 *
 *   - `yaml` parses with the 1.2 core schema, so `on` is the string key `on`
 *     (under 1.1 it would be the boolean `true`, and `doc.on` undefined).
 *   - GitHub runs `schedule` on the default branch only. That is the platform's
 *     rule and is not pinned here; what IS pinned is that no job a push can
 *     start reaches a publish step, which does not depend on it.
 *
 * ## What it deliberately does not do
 *
 * It evaluates no `if:` expression and simulates no event. The pins are
 * textual and exact because the thing being protected is a configuration that
 * changes a few times a year, and an exact pin names the line that moved. A
 * legitimate change to a pinned predicate or trigger edits the roster in the
 * same PR — which is the point: that edit is a release-lane decision and this
 * file is where it is made visible.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import YAML from 'yaml';
import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const WORKFLOW_DIR = '.github/workflows';

/** The shell line a publishing job must carry (R5), verbatim as the workflows spell it. */
export const REF_REFUSAL = '[ "${GITHUB_REF}" != "refs/heads/main" ]';

/**
 * A step `run:` or `uses:` (or a job-level `uses:`) carrying one of these is a
 * publish-capable lane. Comment lines are stripped from `run:` first.
 */
export const PUBLISH_CAPABLE = Object.freeze([
  Object.freeze({ re: /\bchangeset publish\b/, what: 'changeset publish' }),
  Object.freeze({ re: /\bnpm publish\b/, what: 'npm publish' }),
  Object.freeze({ re: /\bpnpm publish\b/, what: 'pnpm publish' }),
  Object.freeze({ re: /release-publish\.sh/, what: 'scripts/release-publish.sh' }),
  Object.freeze({ re: /docker\/build-push-action/, what: 'docker/build-push-action' }),
  Object.freeze({ re: /\bpush (?:origin )?--tags\b/, what: 'git push --tags' }),
  Object.freeze({ re: /\bgh release create\b/, what: 'gh release create' }),
  Object.freeze({ re: /docker-publish\.yml/, what: 'a call into docker-publish.yml' }),
]);

/**
 * THE ROSTER — every publish-capable workflow and what each one pins. Adding a
 * row is a declaration that the workflow may publish; the sweep refuses one
 * that publishes without a row and one that has a row without publishing.
 */
export const PUBLISH_LANES = Object.freeze({
  '.github/workflows/release.yml': Object.freeze({
    triggers: Object.freeze(['push', 'schedule', 'workflow_dispatch']),
    pushBranches: Object.freeze(['main']),
    jobPredicates: Object.freeze({
      'version-pr': "github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.refresh_version_pr)",
    }),
    refusalJobs: Object.freeze(['publish']),
  }),
  '.github/workflows/cut-rc.yml': Object.freeze({
    triggers: Object.freeze(['workflow_dispatch']),
    pushBranches: null,
    jobPredicates: Object.freeze({}),
    refusalJobs: Object.freeze(['cut']),
  }),
  '.github/workflows/docker-publish.yml': Object.freeze({
    triggers: Object.freeze(['workflow_call', 'workflow_dispatch']),
    pushBranches: null,
    jobPredicates: Object.freeze({}),
    refusalJobs: Object.freeze([]),
  }),
});

export function normalisePredicate(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function stripShellComments(run) {
  return String(run).split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
}

function triggerKeys(on) {
  if (on == null) return [];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (typeof on === 'object') return Object.keys(on);
  return [];
}

function sameSet(a, b) {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Every publish-capable command a parsed workflow carries, with where it sits. */
export function publishCapableHits(doc) {
  const hits = [];
  const jobs = doc && typeof doc === 'object' && doc.jobs && typeof doc.jobs === 'object' ? doc.jobs : {};
  for (const [jobId, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object') continue;
    if (typeof job.uses === 'string') {
      for (const p of PUBLISH_CAPABLE) if (p.re.test(job.uses)) hits.push({ job: jobId, step: null, what: p.what });
    }
    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;
      const label = step.name ?? step.id ?? '(unnamed step)';
      if (typeof step.run === 'string') {
        const text = stripShellComments(step.run);
        for (const p of PUBLISH_CAPABLE) if (p.re.test(text)) hits.push({ job: jobId, step: label, what: p.what });
      }
      if (typeof step.uses === 'string') {
        for (const p of PUBLISH_CAPABLE) if (p.re.test(step.uses)) hits.push({ job: jobId, step: label, what: p.what });
      }
    }
  }
  return hits;
}

/**
 * Judge the workflows under `root` against `roster`. Pure: reads files, writes
 * nothing, returns findings plus the scan's population so a caller can see an
 * empty scan for what it is.
 */
export function judge(root = REPO_ROOT, roster = PUBLISH_LANES) {
  const findings = [];
  const add = (workflow, rule, message) => findings.push({ workflow, rule, message });
  const dir = join(root, WORKFLOW_DIR);
  const result = { findings, scanned: 0, parsed: 0, capable: [], roster: Object.keys(roster) };

  if (!existsSync(dir)) {
    add(WORKFLOW_DIR, 'floor', `${WORKFLOW_DIR} is missing — nothing was scanned, and an empty scan is red, never a pass`);
    return result;
  }
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
  result.scanned = files.length;
  if (files.length === 0) {
    add(WORKFLOW_DIR, 'floor', `${WORKFLOW_DIR} holds no workflow — nothing was scanned, and an empty scan is red, never a pass`);
    return result;
  }

  const docs = new Map();
  for (const f of files) {
    const rel = `${WORKFLOW_DIR}/${f}`;
    try {
      docs.set(f, YAML.parse(readFileSync(join(dir, f), 'utf8')));
    } catch (err) {
      add(rel, 'parse', `cannot be parsed as YAML (${err?.message ?? err}) — an unreadable workflow is not a silent one`);
    }
  }
  result.parsed = docs.size;

  // ── the sweep, direction 1: a publisher outside the roster ───────────────
  for (const [f, doc] of docs) {
    const hits = publishCapableHits(doc);
    if (hits.length === 0) continue;
    const rel = `${WORKFLOW_DIR}/${f}`;
    result.capable.push({ workflow: rel, hits });
    if (rel in roster) continue;
    const where = hits.map((h) => `${h.job}${h.step ? `/${h.step}` : ''}: ${h.what}`).join('; ');
    add(
      rel,
      'sweep',
      `carries a publish-capable command (${where}) but is not a PUBLISH_LANES row — a publisher outside the roster is one this gate does not hold to \`main\`. Add the row with its ref refusal, or remove the command.`,
    );
  }

  // ── the roster rows ──────────────────────────────────────────────────────
  for (const [rel, row] of Object.entries(roster)) {
    const f = basename(rel);
    if (!docs.has(f)) {
      add(rel, 'floor', 'is a PUBLISH_LANES row but was not parsed — a roster row for a missing workflow is dead config; delete the row or restore the file');
      continue;
    }
    const doc = docs.get(f) ?? {};
    if (!result.capable.some((c) => c.workflow === rel)) {
      add(rel, 'sweep', 'is a PUBLISH_LANES row but no step of it runs a publish-capable command — a dead roster row holds nothing; delete it or restore what it pinned');
    }

    const on = doc.on;
    const keys = triggerKeys(on);
    if (!sameSet(keys, row.triggers)) {
      const extra = keys.filter((k) => !row.triggers.includes(k));
      const missing = row.triggers.filter((k) => !keys.includes(k));
      add(
        rel,
        'R1',
        `trigger set is [${keys.join(', ')}], pinned [${row.triggers.join(', ')}]` +
          `${extra.length ? ` — unpinned trigger(s): ${extra.join(', ')}` : ''}` +
          `${missing.length ? ` — missing pinned trigger(s): ${missing.join(', ')}` : ''}` +
          '. A publish lane answers only the events its row declares; change the row in the same PR if this is deliberate.',
      );
    }

    if (row.pushBranches) {
      const push = on && typeof on === 'object' && !Array.isArray(on) ? on.push : undefined;
      if (!push || typeof push !== 'object' || Array.isArray(push)) {
        add(rel, 'R2', 'the `push:` trigger carries no `branches:` filter — a bare `push:` runs on every branch, the maintenance line included');
      } else {
        const branches = Array.isArray(push.branches) ? push.branches.map(String) : push.branches == null ? [] : [String(push.branches)];
        if (!sameSet(branches, row.pushBranches)) {
          add(
            rel,
            'R2',
            `push.branches is [${branches.join(', ')}], pinned [${row.pushBranches.join(', ')}] — a push to any branch named here starts this lane; the maintenance line publishes nothing by ruling, so the list is \`main\` alone`,
          );
        }
        for (const key of ['branches-ignore', 'tags', 'tags-ignore']) {
          if (key in push) add(rel, 'R2', `push.${key} is set — \`${key}\` widens which refs start this lane beyond the pinned \`branches:\` list`);
        }
      }
    }

    const jobs = doc.jobs && typeof doc.jobs === 'object' ? doc.jobs : {};
    for (const [jobId, predicate] of Object.entries(row.jobPredicates)) {
      const job = jobs[jobId];
      if (!job || typeof job !== 'object') {
        add(rel, 'R4', `job \`${jobId}\` is pinned but absent — the predicate that keeps a push from starting a version PR has nothing to hold`);
        continue;
      }
      const got = normalisePredicate(job.if);
      const want = normalisePredicate(predicate);
      if (got !== want) {
        add(rel, 'R4', `job \`${jobId}\` has if: "${got}", pinned "${want}" — this predicate decides which events may start the job; a change to it is a release-lane decision and edits the row in the same PR`);
      }
    }

    for (const jobId of row.refusalJobs) {
      const job = jobs[jobId];
      const steps = job && typeof job === 'object' && Array.isArray(job.steps) ? job.steps : [];
      const held = steps.some((s) => s && typeof s.run === 'string' && s.run.includes(REF_REFUSAL) && /\bexit 1\b/.test(s.run));
      if (!held) {
        add(rel, 'R5', `job \`${jobId}\` carries no step with ${REF_REFUSAL} followed by \`exit 1\` — the refusal that holds even against a dispatch pointed at another branch is gone`);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed. The exit code stays load-bearing, so the handshake is a flag.
let selfTestReachedVerdict = false;

// The self-test's own battery roster and floor. What is pinned is the
// registered NAMES, each with a minimum case count, never one total: a battery
// falling from 5 cases to 1 keeps a total "right" the moment a sibling grows.
// Every `check()` is attributed to the battery most recently opened.
const SELF_TEST_BATTERIES = Object.freeze({
  'the live tree — green, and the scan is not empty': 3,
  'R1 trigger set — a trigger added to a publish lane reds': 3,
  'R2 push branches — another ref reaching the publish lane reds': 5,
  'R4 the version-PR predicate — admitting push, or losing the job, reds': 2,
  'R5 the ref refusal — deleted from the publish job or from cut-rc reds': 2,
  'the sweep — an unlisted publisher, an unlisted caller of the image workflow, a dead roster row': 3,
  'floors — a missing directory, an empty directory, a missing roster file, unparsable YAML red': 4,
});
// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 7;

function mutate(text, from, to, where) {
  if (!text.includes(from)) throw new Error(`self-test anchor not found in ${where}: ${JSON.stringify(from)}`);
  const out = text.replace(from, to);
  if (out === text) throw new Error(`self-test mutation changed nothing in ${where}: ${JSON.stringify(from)}`);
  return out;
}

/**
 * A throwaway `.github/workflows` holding copies of the live roster files,
 * each optionally mutated (anchor must be found, text must change), plus any
 * extra synthetic workflows.
 */
function fixture(root, mutations = {}, extras = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'publish-lane-refs-'));
  mkdirSync(join(dir, WORKFLOW_DIR), { recursive: true });
  for (const rel of Object.keys(PUBLISH_LANES)) {
    let text = readFileSync(join(root, rel), 'utf8');
    for (const m of mutations[rel] ?? []) text = mutate(text, m.from, m.to, rel);
    writeFileSync(join(dir, rel), text);
  }
  for (const [name, text] of Object.entries(extras)) writeFileSync(join(dir, WORKFLOW_DIR, name), text);
  return dir;
}

function selfTest() {
  const batterySeen = new Map();
  let open = null;
  let failed = 0;
  const battery = (name) => {
    open = name;
    console.log(`\n${name}`);
  };
  const check = (label, ok, detail = '') => {
    batterySeen.set(open, (batterySeen.get(open) ?? 0) + 1);
    if (ok) {
      console.log(`  ok   ${label}`);
    } else {
      failed += 1;
      console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    }
  };
  const rules = (r) => r.findings.map((f) => `${f.workflow}[${f.rule}]`).join(', ') || '(none)';
  const has = (r, workflow, rule) => r.findings.some((f) => f.workflow === workflow && f.rule === rule);
  const only = (r, workflow, rule) => r.findings.length > 0 && r.findings.every((f) => f.workflow === workflow && f.rule === rule);
  const RELEASE = '.github/workflows/release.yml';
  const CUT = '.github/workflows/cut-rc.yml';
  const DOCKER = '.github/workflows/docker-publish.yml';
  const dirs = [];
  const fx = (mutations, extras) => {
    const d = fixture(REPO_ROOT, mutations, extras);
    dirs.push(d);
    return d;
  };

  try {
    battery('the live tree — green, and the scan is not empty');
    const live = judge(REPO_ROOT);
    check('the checked-in workflows hold every rule', live.findings.length === 0, rules(live));
    check('the scan read more than the roster', live.scanned > live.roster.length, `scanned ${live.scanned}, roster ${live.roster.length}`);
    check(
      'the sweep finds exactly the roster, no more and no fewer',
      sameSet(live.capable.map((c) => c.workflow), live.roster),
      `capable: ${live.capable.map((c) => c.workflow).join(', ')}`,
    );

    battery('R1 trigger set — a trigger added to a publish lane reds');
    const r1a = judge(fx({ [RELEASE]: [{ from: 'on:\n  push:\n', to: 'on:\n  pull_request:\n  push:\n' }] }));
    check('release.yml gaining `pull_request:` reds R1 and nothing else', only(r1a, RELEASE, 'R1'), rules(r1a));
    const r1b = judge(fx({ [CUT]: [{ from: 'on:\n', to: 'on:\n  push:\n    branches:\n      - main\n' }] }));
    check('cut-rc.yml gaining `push:` reds R1 (a human-only lane answering a push)', only(r1b, CUT, 'R1'), rules(r1b));
    const r1c = judge(fx({ [DOCKER]: [{ from: 'on:\n', to: 'on:\n  push:\n    tags:\n      - "v*"\n' }] }));
    check('docker-publish.yml gaining `push: tags:` reds R1', only(r1c, DOCKER, 'R1'), rules(r1c));

    battery('R2 push branches — another ref reaching the publish lane reds');
    const r2a = judge(fx({ [RELEASE]: [{ from: '      - main\n', to: '      - main\n      - release/**\n' }] }));
    check('`release/**` appended to release.yml push.branches reds R2 and nothing else', only(r2a, RELEASE, 'R2'), rules(r2a));
    const r2b = judge(fx({ [RELEASE]: [{ from: '      - main\n', to: '      - main\n      - release/17.x\n' }] }));
    check('`release/17.x` appended reds R2 — the literal branch, not only the glob', only(r2b, RELEASE, 'R2'), rules(r2b));
    const r2c = judge(fx({ [RELEASE]: [{ from: '      - main\n', to: "      - '**'\n" }] }));
    check('`main` replaced by `**` reds R2', only(r2c, RELEASE, 'R2'), rules(r2c));
    const r2d = judge(fx({ [RELEASE]: [{ from: '    branches:\n      - main\n', to: '    branches-ignore:\n      - gh-pages\n' }] }));
    check('`branches:` rewritten as `branches-ignore:` reds R2 (every other branch now starts the lane)', has(r2d, RELEASE, 'R2') && r2d.findings.every((f) => f.workflow === RELEASE), rules(r2d));
    const r2e = judge(fx({ [RELEASE]: [{ from: '    branches:\n      - main\n', to: "    branches:\n      - main\n    tags:\n      - 'v*'\n" }] }));
    check('a `tags:` filter beside `branches: [main]` reds R2 (a tag pushed from any branch)', only(r2e, RELEASE, 'R2'), rules(r2e));

    battery('R4 the version-PR predicate — admitting push, or losing the job, reds');
    const r4a = judge(fx({ [RELEASE]: [{ from: "github.event_name == 'schedule' ||", to: "github.event_name == 'schedule' || github.event_name == 'push' ||" }] }));
    check('`version-pr` admitting `push` reds R4 and nothing else', only(r4a, RELEASE, 'R4'), rules(r4a));
    const r4b = judge(fx({ [RELEASE]: [{ from: '\n  version-pr:\n', to: '\n  version-pr-renamed:\n' }] }));
    check('the `version-pr` job renamed away reds R4 (nothing left to hold)', only(r4b, RELEASE, 'R4'), rules(r4b));

    battery('R5 the ref refusal — deleted from the publish job or from cut-rc reds');
    const r5a = judge(fx({ [RELEASE]: [{ from: REF_REFUSAL, to: '[ -z "${GITHUB_REF}" ]' }] }));
    check('the publish job losing its refs/heads/main refusal reds R5 and nothing else', only(r5a, RELEASE, 'R5'), rules(r5a));
    const r5b = judge(fx({ [CUT]: [{ from: REF_REFUSAL, to: '[ -z "${GITHUB_REF}" ]' }] }));
    check('cut-rc.yml losing its refusal reds R5', only(r5b, CUT, 'R5'), rules(r5b));

    battery('the sweep — an unlisted publisher, an unlisted caller of the image workflow, a dead roster row');
    const swA = judge(fx({}, { 'extra.yml': 'name: Extra\non:\n  push:\n    branches:\n      - "**"\njobs:\n  ship:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          # prose: npm publish is mentioned here and must not enrol anything\n          pnpm changeset publish\n' }));
    check('an unlisted workflow running `changeset publish` reds sweep, naming it', only(swA, `${WORKFLOW_DIR}/extra.yml`, 'sweep'), rules(swA));
    const swB = judge(fx({}, { 'caller.yml': 'name: Caller\non:\n  push:\njobs:\n  image:\n    uses: ./.github/workflows/docker-publish.yml\n    with:\n      version: 1.0.0\n' }));
    check('an unlisted workflow calling docker-publish.yml reds sweep', only(swB, `${WORKFLOW_DIR}/caller.yml`, 'sweep'), rules(swB));
    const quietRoster = { ...PUBLISH_LANES, [`${WORKFLOW_DIR}/quiet.yml`]: { triggers: ['workflow_dispatch'], pushBranches: null, jobPredicates: {}, refusalJobs: [] } };
    const swC = judge(fx({}, { 'quiet.yml': 'name: Quiet\non:\n  workflow_dispatch:\njobs:\n  noop:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo nothing\n' }), quietRoster);
    check('a roster row for a workflow that publishes nothing reds sweep (dead config)', only(swC, `${WORKFLOW_DIR}/quiet.yml`, 'sweep'), rules(swC));

    battery('floors — a missing directory, an empty directory, a missing roster file, unparsable YAML red');
    const noDir = mkdtempSync(join(tmpdir(), 'publish-lane-refs-nodir-'));
    dirs.push(noDir);
    const flA = judge(noDir);
    check('no .github/workflows at all reds floor', only(flA, WORKFLOW_DIR, 'floor') && flA.scanned === 0, rules(flA));
    const emptyDir = mkdtempSync(join(tmpdir(), 'publish-lane-refs-empty-'));
    dirs.push(emptyDir);
    mkdirSync(join(emptyDir, WORKFLOW_DIR), { recursive: true });
    const flB = judge(emptyDir);
    check('an empty .github/workflows reds floor', only(flB, WORKFLOW_DIR, 'floor') && flB.scanned === 0, rules(flB));
    const missing = fx({});
    rmSync(join(missing, CUT));
    const flC = judge(missing);
    check('a roster file absent from the tree reds floor, naming it', has(flC, CUT, 'floor'), rules(flC));
    const flD = judge(fx({ [DOCKER]: [{ from: 'on:\n', to: 'on: [\n' }] }));
    check('a roster file the parser refuses reds parse and its row reds floor', has(flD, DOCKER, 'parse') && has(flD, DOCKER, 'floor'), rules(flD));
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }

  // ── The floor: every declared battery RAN, at or above its pinned count ──
  const floorFailure = (message) => {
    console.error(`FAIL self-test floor: ${message}`);
    failed += 1;
  };
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`);
  }
  for (const [name, count] of batterySeen) {
    if (declared.includes(name)) continue;
    floorFailure(`battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorFailure(
      count === 0
        ? `battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned.`
        : `battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }

  if (failed > 0) {
    console.error(`\ncheck-publish-lane-refs self-test: ${failed} failure(s) (cases and floor).`);
    return 1;
  }
  const total = [...batterySeen.values()].reduce((a, b) => a + b, 0);
  console.log(`\ncheck-publish-lane-refs self-test: ${total} cases across ${batterySeen.size} batteries pass.`);
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------

function main() {
  if (process.argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict && code === 0) {
      console.error('\ncheck-publish-lane-refs self-test: selfTest() returned without reaching its verdict, so no success line was printed. Exiting 0 here would report a self-test that never finished as one that passed.');
      return 1;
    }
    return code;
  }

  const r = judge(REPO_ROOT);
  const capable = r.capable.map((c) => c.workflow).join(', ');
  console.log(`publish-lane refs: ${r.scanned} workflow(s) scanned, ${r.parsed} parsed, ${r.capable.length} publish-capable (${capable || 'none'}), ${r.roster.length} roster row(s).`);
  if (r.findings.length === 0) {
    console.log('ok   every publish-capable workflow answers to `main` alone: a push to any other branch — the 17.x maintenance line included — starts no version PR and no publish.');
    return 0;
  }
  for (const f of r.findings) console.error(`FAIL ${f.workflow} [${f.rule}] ${f.message}`);
  console.error(`\ncheck-publish-lane-refs: ${r.findings.length} finding(s). The maintenance line publishes nothing by ruling; a publish lane reachable from another ref, or a publisher outside PUBLISH_LANES, is a release-lane decision that edits the roster in the same PR — scripts/check-publish-lane-refs.mjs header.`);
  return 1;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main());
}
