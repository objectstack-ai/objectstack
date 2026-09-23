#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-expected-skips — the enqueue bar's SKIP half, made legible: given a PR
 * head, every `skipped` check-run is either an EXPECTED skip (a name the roster
 * below declares, with the mechanism that makes the skip normal) or it is
 * reported, classified as far as the API lets a reader tell (#18308).
 *
 *   node scripts/pm/check-expected-skips.mjs --pr 18315            # resolve the head, judge it
 *   node scripts/pm/check-expected-skips.mjs --head <sha>          # judge one commit's check-runs
 *   node scripts/pm/check-expected-skips.mjs --pr 18315 --json     # the same verdict, for round reports
 *   node scripts/pm/check-expected-skips.mjs --check-runs-json f   # judge a pre-fetched payload; no network
 *   node scripts/pm/check-expected-skips.mjs --roster              # print the roster; no network
 *   node scripts/pm/check-expected-skips.mjs --self-test           # offline, no network at all
 *
 * ## Why
 *
 * The enqueue bar in `.claude/skills/pm-dispatch/SKILL.md` reads every check as
 * `success` or an expected skip, and names this file as the roster. `skipped`
 * is the ORDINARY conclusion of a path-filtered job on this repository —
 * measured over ten landed heads (PRs #18298 · #18307 · #18311 · #18315 ·
 * #18316 · #18322 · #18326 · #18327 · #18328 · #18332, read as full
 * `GET /commits/{head}/check-runs` enumerations on 2026-09-16), every one
 * carried between 8 and 19 skipped check-runs beside its successes — and until
 * this file nothing in the charter said which skips were normal. Each seat
 * re-derived the answer per landing from memory of what usually skips, and a
 * seat holding 「每一个 check 全绿」 beside "a `conclusion` other than
 * `success` is not a pass" had no spelling for the one distinction that
 * matters: a filter that did not match (expected) against a job that should
 * have run and did not (a filter miss).
 *
 * ## What the roster answers, and what it deliberately does not
 *
 * The roster answers the NAME question: is this a check that legitimately
 * skips on this repository, and by what mechanism? A skipped name outside it is
 * the sentinel this check exists for — `Lint & Repo Gates`, `TypeScript Type
 * Check`, the two ci.yml aggregates (`Test Core`, `Dogfood Regression Gate`),
 * `Governed Surface Queue Guard` and the claim guards carry no `if:` and never
 * skip; the day one of them reads `skipped` is a filter someone added, a
 * rename, or a dependency that failed, and exit 4 names it.
 *
 * It does NOT answer the DIFF question — "should this ROSTERED job have run on
 * THIS diff?" — and the boundary is deliberate. For ci.yml's `filter`-gated
 * family the merge-queue build answers it: on `merge_group` every filter output
 * widens to `'true'` and the family runs on the merged tree before anything
 * reaches `main` (the `|| 'true'` half of ci.yml's filter contract, pinned by
 * `--self-test`). For the event- and label-conditional advisory jobs the reason
 * column names the condition a reader checks by hand. Deriving expectedness
 * live from the workflows' `paths` filters would answer the diff question, at
 * the cost of a SECOND evaluator of the platform's own semantics — the
 * dorny/paths-filter glob dialect, GitHub's expression language, matrix name
 * templates, the triggering event of each run — parity liabilities whose
 * failure shape is a confident, wrong "expected", which is the false green this
 * tree refuses everywhere else. The roster is instead TIED to the workflows
 * mechanically: `--self-test` parses each entry's workflow with the same `yaml`
 * package the docs build resolves and asserts the named job exists, carries the
 * roster's name, carries an `if:`, and that the `if:` spells the gate the entry
 * declares — so a renamed, deleted or re-gated job reddens the roster instead
 * of letting it rot into memory. A NEW gated job is caught from the other
 * side: its first skip is a name outside the roster, exit 4, until someone
 * declares it with its mechanism.
 *
 * ## What the API says about a skip, and what it does not
 *
 * A path-filtered job reports `conclusion: skipped`; so does a job that never
 * started because a `needs` dependency failed. Neither the check-runs listing
 * nor the Actions jobs endpoint carries a reason field — measured on a skipped
 * `Packed-tarball smoke (opt-in)`: `output.title` and `output.summary` are
 * null, `steps` is `[]`. Two tells survive and are read here:
 *
 *   - a name still holding the raw `${{ matrix.* }}` template was skipped
 *     BEFORE matrix expansion, i.e. by a job-level `if:` or `needs` gate — a
 *     workflow-level `paths:` filter creates no check-run at all, so a skipped
 *     check-run is never that;
 *   - a skipped run whose CHECK SUITE also holds a `failure` / `cancelled` /
 *     `timed_out` / `action_required` run is a dependency-skip suspect, and the
 *     failed run is named beside it.
 *
 * Everything else reads as a filter miss. This repo's ci.yml spells every gate
 * as `!cancelled() && needs.filter.outputs.X != 'false'`, so a dead `filter`
 * job RUNS the family rather than skipping it — dependency skips are designed
 * out here, and the classification exists for the generic shape.
 *
 * ## Duplicate names are the normal shape, not a defect
 *
 * One head carries one check-run per JOB per RUN, and `pull_request` fires a
 * run per event: a head that was opened, then labelled `skip-changeset`, then
 * had its body edited carries three `PR Automation` runs — `Auto Label` and
 * `Check PR Size` succeed on the first and skip on the other two (their `if:`
 * excludes `labeled` / `unlabeled` / `edited`), `Check Changeset` succeeds
 * before the label and skips after it. The roster judges NAMES, so all of
 * those read as expected; the report prints the multiplicity.
 *
 * ## Exit register
 *
 *   0  every skipped check-run on the head is in the roster
 *   4  at least one skipped check-run is outside it — each named and classified
 *   3  NOT MEASURED: the head could not be read (a sha the API cannot resolve,
 *      404, network, refused credential), carries no check-runs at all, or has
 *      a check-run that has not completed (the skip set is not final). ⛔ Never
 *      0 — "could not read" must never be legible as "every skip is expected".
 *   1  --self-test failed              2  usage error / an unclassified failure
 *
 * Report-only: this file never writes to GitHub (pinned structurally in the
 * self-test). Other conclusions on the head (`failure`, `cancelled`, …) are
 * printed loudly beside the verdict and are NOT this check's verdict — the
 * bar's SUCCESS half is read from the same listing by the seat.
 *
 * ## Reading the board
 *
 * The board is `PM_SWEEP_REPO`, else `GITHUB_REPOSITORY`, else the default,
 * resolved by the resolver imported from `check-half-states.mjs` (never
 * restated). The roster, however, is THIS repository's workflows — a sibling
 * repo needs its own roster, and pointing this file at another board judges
 * that board's skips against objectstack's roster; the provenance line says
 * which board was read so the mismatch is visible. Reads go down the same
 * ladder `check-clause2-carriers.mjs` reports: the exported token first, and
 * the header-less public read when the token is refused. In a proxied agent
 * container node's `fetch` bypasses `HTTPS_PROXY`, so a live run re-execs
 * itself once with `--use-env-proxy` (the plan is imported, the guard variable
 * is this file's own).
 */

// The structural self-test case below reads the enqueue bar and asserts it still
// names this file, so a change to that bar is a change this gate judges — and
// `dispatch-gates.mjs` masks self-test bodies before it scans for a population,
// which dropped the claim with the fixtures. This declaration is what puts it
// back; the derivation grades it against the read this file really performs, so
// it cannot be satisfied by deleting either half.
// dispatch-gates: self-test-reads .claude/skills/pm-dispatch/SKILL.md -- the structural case asserts the SKILL.md enqueue bar still names this file, so a change to that bar is judged here

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import { isEntrypoint } from '../invoked-as.mjs';
import { maskComments, maskCommentsAndLiterals } from '../js-comment-mask.mjs';
// ⛔ Not copied. The board resolver and the proxy-rearm plan are ONE source in
// `check-half-states.mjs` — the import every sibling reader takes — so this
// reader and the patrol cannot disagree about which board is being read or
// whether this container's fetch reaches it. EXIT_PREREQUISITE_NOT_MET is the
// repo-wide NOT-MEASURED code and is re-exported rather than redeclared.
import {
  DEFAULT_SWEEP_REPO,
  EXIT_PREREQUISITE_NOT_MET,
  PROXY_FLAG,
  PROXY_REARM_GUARD,
  proxyRearmPlan,
  resolveSweepRepo,
} from './check-half-states.mjs';

export const EXIT_OK = 0;
export const EXIT_SELF_TEST_FAILED = 1;
export const EXIT_UNCLASSIFIED = 2;
export { EXIT_PREREQUISITE_NOT_MET };
/** A skipped check-run outside the roster: a filter miss or a dependency skip, named. */
export const EXIT_UNEXPECTED_SKIP = 4;

/** This file, resolved for the proxy re-exec and for the self-test's CLI spawns. */
const SELF_PATH = fileURLToPath(import.meta.url);
const ROOT = join(SELF_PATH, '..', '..', '..');
export const WORKFLOW_DIR = '.github/workflows';
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

/**
 * This file's OWN re-exec guard — deliberately not the patrol's: sharing one
 * variable would let a re-exec of that script suppress the re-exec of this one.
 */
export const OWN_PROXY_REARM_GUARD = 'OS_EXPECTED_SKIPS_PROXY_REARMED';

/**
 * The gate KINDS a roster entry may declare, and the fragment of the job's
 * `if:` each one must spell. The self-test reads the live workflow and asserts
 * the fragment is there, which is what ties a roster row to the tree.
 *
 *   filter-output  ci.yml's `filter` job said `false` for every named output —
 *                  the job's `if:` spells `needs.filter.outputs.<o> != 'false'`
 *                  and the filter widens each output with `|| 'true'` off PRs.
 *   event          the job's `if:` excludes `github.event.action` values, so a
 *                  `labeled` / `unlabeled` / `edited` run of the same head skips.
 *   label          the job's `if:` reads a label literal — an opt-out (skip when
 *                  present) or an opt-in (skip when absent).
 */
export const GATE_KINDS = Object.freeze(['filter-output', 'event', 'label']);

/** The `if:` fragments a gate declaration commits its job to carrying. */
export function gateSpellings(gate) {
  switch (gate?.kind) {
    case 'filter-output':
      return (gate.outputs ?? []).map((o) => `needs.filter.outputs.${o} != 'false'`);
    case 'event':
      return ["github.event.action != 'labeled'"];
    case 'label':
      return [`'${gate.label}'`];
    default:
      return [];
  }
}

const CORE_GATE = Object.freeze({ kind: 'filter-output', outputs: ['core'] });
const EVENT_GATE = Object.freeze({ kind: 'event' });
const EVENT_REASON =
  "job-level `if:` excludes the `labeled` / `unlabeled` / `edited` pull_request events; each such event is its own run on the same head, beside the `opened` / `synchronize` run that concluded";
const CORE_REASON =
  "gated on ci.yml's `filter` job `core` output; a diff outside the core path set skips it on the PR head, and the merge-queue build widens every output to 'true' and runs it on the merged tree";

/**
 * THE ROSTER — declared once, here, as data. One row per check-run NAME that
 * skips by design on this repository, with the workflow job that produces it,
 * the gate kind (pinned against the live `if:` by `--self-test`) and a one-line
 * reason a seat can read at enqueue time.
 *
 * Measured, not remembered: the roster was eleven names, the union of every
 * `skipped` name over the ten landed heads the header lists — ten below since
 * `Console Pin Gate` left it (see the end of this block). Five of them
 * (`Build Core`, `Temporal Conformance`, both matrix templates, `Dogfood Verify
 * CLI`) skipped on ALL ten; `Build Docs` and `Console Pin Gate` on all ten;
 * `Check Changeset` on all ten (every one carried `skip-changeset`);
 * `Packed-tarball smoke (opt-in)` on all ten; `Auto Label` and `Check PR Size`
 * on nine (the tenth head saw no `labeled` / `edited` event after its last
 * push); `Test Core (…/6)` on the three heads whose diff was outside both the
 * `core` and the `crosspkg` sets. Zero heads carried any other skipped name.
 *
 * ⛔ Adding a row is a declaration that the skip is BY DESIGN, and the row must
 * name the mechanism — a row added to silence an exit 4 without one is the
 * finding written somewhere quieter.
 *
 * `Console Pin Gate` LEFT the roster (#17673, ruling #18900 ⑤): its job now
 * concludes on every run — its own `if:` is `!cancelled()` alone and the
 * `console` filter term sits on each step — so an unaffected PR reads
 * `success` with a NOT BUILT notice, and a skipped `Console Pin Gate` is no
 * longer by design. It is exit 4, like any other name outside the roster.
 */
export const EXPECTED_SKIPS = Object.freeze([
  {
    name: 'Check PR Size',
    workflow: 'pr-automation.yml',
    job: 'pr-size',
    gate: EVENT_GATE,
    reason: EVENT_REASON,
  },
  {
    name: 'Auto Label',
    workflow: 'pr-automation.yml',
    job: 'auto-label',
    gate: EVENT_GATE,
    reason: EVENT_REASON,
  },
  {
    name: 'Check Changeset',
    workflow: 'pr-automation.yml',
    job: 'changeset-check',
    gate: { kind: 'label', label: 'skip-changeset' },
    reason:
      'job-level `if:` skips a PR carrying `skip-changeset` (the declared changeset opt-out) and the changeset-release PR; every run after the label lands reads skipped, the run before it concluded',
  },
  {
    name: 'Packed-tarball smoke (opt-in)',
    workflow: 'pack-smoke-optin.yml',
    job: 'pack-smoke',
    gate: { kind: 'label', label: 'needs:pack-smoke' },
    reason: 'opt-in by the `needs:pack-smoke` label; skipped on every PR that does not carry it, once per pull_request event',
  },
  {
    name: 'Build Core',
    workflow: 'ci.yml',
    job: 'build-core',
    gate: CORE_GATE,
    reason: `${CORE_REASON} (a REQUIRED context: the queue build is where its verdict is taken)`,
  },
  {
    name: 'Temporal Conformance (live PG + MySQL)',
    workflow: 'ci.yml',
    job: 'temporal-conformance',
    gate: CORE_GATE,
    reason: `${CORE_REASON} (a REQUIRED context: the queue build is where its verdict is taken)`,
  },
  {
    name: 'Dogfood Regression Gate (${{ matrix.shard }}/3)',
    workflow: 'ci.yml',
    job: 'dogfood',
    gate: CORE_GATE,
    reason: `${CORE_REASON}; the raw matrix template IS the name a job skipped before matrix expansion reports (the aggregate \`Dogfood Regression Gate\` runs \`if: always()\` and never skips)`,
  },
  {
    name: 'Dogfood Verify CLI',
    workflow: 'ci.yml',
    job: 'dogfood-verify',
    gate: CORE_GATE,
    reason: CORE_REASON,
  },
  {
    name: 'Test Core (${{ matrix.shard }}/6)',
    workflow: 'ci.yml',
    job: 'test',
    gate: { kind: 'filter-output', outputs: ['core', 'crosspkg'] },
    reason:
      "gated on ci.yml's `filter` outputs `core` OR `crosspkg`; skips only when both said false (a diff outside packages/** AND outside the cross-package test-input roots such as scripts/**), the merge-queue build widens both to 'true'; the raw matrix template is the pre-expansion name (the aggregate `Test Core` runs `if: always()` and never skips)",
  },
  {
    name: 'Build Docs',
    workflow: 'ci.yml',
    job: 'build-docs',
    gate: { kind: 'filter-output', outputs: ['docs'] },
    reason: "gated on ci.yml's `filter` job `docs` output (apps/docs, content, the lockfile, ci.yml itself); a diff outside it skips the docs build on the PR head",
  },
]);

/** Conclusions that make a same-suite skip a dependency-skip suspect. */
export const FAILED_CONCLUSIONS = Object.freeze(['failure', 'cancelled', 'timed_out', 'action_required', 'stale']);

// ---------------------------------------------------------------------------
// The roster's own hygiene — pure over a workflow reader so the self-test can
// drive it against the live tree AND against synthetic drift.
// ---------------------------------------------------------------------------

/**
 * Every row must be well-formed, unique by name, and TRUE of the tree: its job
 * exists in its workflow, carries the row's name, carries an `if:`, and that
 * `if:` spells the gate the row declares. For `filter-output` rows the
 * `filter` job's output must carry the `|| 'true'` widening, because the
 * reason column promises the queue build runs the job — a promise that is only
 * true while that half of the filter contract stands.
 *
 * @param {readonly object[]} roster
 * @param {(file: string) => object|null} readWorkflow  parsed YAML, or null when unreadable
 * @returns {string[]} findings; empty means the roster is true of the tree
 */
export function auditRoster(roster, readWorkflow) {
  const findings = [];
  const seen = new Set();
  for (const row of roster) {
    const label = typeof row?.name === 'string' && row.name ? row.name : '(unnamed row)';
    for (const key of ['name', 'workflow', 'job', 'reason']) {
      if (typeof row?.[key] !== 'string' || !row[key].trim()) findings.push(`${label}: missing \`${key}\``);
    }
    if (seen.has(row?.name)) findings.push(`${label}: duplicate name`);
    seen.add(row?.name);
    if (!GATE_KINDS.includes(row?.gate?.kind)) {
      findings.push(`${label}: gate kind ${JSON.stringify(row?.gate?.kind)} is not one of ${GATE_KINDS.join(' | ')}`);
      continue;
    }
    if (row.gate.kind === 'filter-output' && !(Array.isArray(row.gate.outputs) && row.gate.outputs.length > 0)) {
      findings.push(`${label}: a filter-output gate names no outputs`);
      continue;
    }
    if (row.gate.kind === 'label' && !(typeof row.gate.label === 'string' && row.gate.label)) {
      findings.push(`${label}: a label gate names no label`);
      continue;
    }
    if (typeof row.workflow !== 'string' || typeof row.job !== 'string') continue;
    const wf = readWorkflow(row.workflow);
    if (!wf || typeof wf !== 'object') {
      findings.push(`${label}: workflow ${row.workflow} could not be read — a row this audit cannot verify is a refusal, not a pass`);
      continue;
    }
    const job = wf.jobs?.[row.job];
    if (!job || typeof job !== 'object') {
      findings.push(`${label}: ${row.workflow} has no job \`${row.job}\` — deleted or renamed; correct or delete the row`);
      continue;
    }
    const jobName = typeof job.name === 'string' ? job.name : row.job;
    if (jobName !== row.name) {
      findings.push(`${label}: ${row.workflow} job \`${row.job}\` is named ${JSON.stringify(jobName)} — the check-run name moved; correct the row`);
    }
    const cond = typeof job.if === 'string' ? job.if : job.if === undefined ? '' : String(job.if);
    if (!cond.trim()) {
      findings.push(`${label}: ${row.workflow} job \`${row.job}\` carries no \`if:\` — it cannot skip by design, so it does not belong in the roster`);
      continue;
    }
    for (const fragment of gateSpellings(row.gate)) {
      if (!cond.includes(fragment)) findings.push(`${label}: the job's \`if:\` does not spell ${fragment} — the declared gate is not the gate the job carries`);
    }
    if (row.gate.kind === 'filter-output') {
      for (const output of row.gate.outputs) {
        const expr = String(wf.jobs?.filter?.outputs?.[output] ?? '');
        if (!expr.includes("|| 'true'")) {
          findings.push(`${label}: ${row.workflow} filter output \`${output}\` lacks the \`|| 'true'\` widening the reason column relies on (${expr || 'absent'})`);
        }
      }
    }
  }
  return findings;
}

/** Read one workflow file from a root, parsed; null when absent or unparsable. */
export function workflowReader(root = ROOT) {
  return (file) => {
    const path = join(root, WORKFLOW_DIR, file);
    if (!existsSync(path)) return null;
    try {
      return YAML.parse(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  };
}

// ---------------------------------------------------------------------------
// The judge — pure over the REST check-runs shape.
// ---------------------------------------------------------------------------

/** How a skipped run outside the roster reads, from what the listing carries. */
export function classifySkip(run, failedBySuite) {
  const suite = run?.check_suite?.id ?? null;
  const failed = (suite !== null && failedBySuite.get(suite)) || [];
  if (failed.length > 0) {
    return {
      kind: 'dependency-skip',
      detail: `its check suite also holds ${failed.map((f) => `\`${f.name}\`=${f.conclusion}`).join(', ')} — a dependent of a job that did not succeed never starts and reads skipped; the named failure is the finding`,
    };
  }
  if (/\$\{\{/.test(String(run?.name ?? ''))) {
    return {
      kind: 'filter-miss',
      detail:
        'skipped before matrix expansion (the name is the raw template): a job-level `if:` or `needs` gate did not select this head — never a workflow-level `paths:` filter, which creates no check-run at all',
    };
  }
  return {
    kind: 'filter-miss',
    detail:
      'a job-level condition did not select this head, on a name the roster does not expect to skip — a filter miss, a new gate, or a rename; add a roster row naming its mechanism only if the skip is by design',
  };
}

/**
 * Judge one head's check-runs payload against the roster.
 *
 * @param {object} payload   the REST `check-runs` listing ({ total_count, check_runs })
 * @param {readonly object[]} [roster]
 * @returns {object} a judgement; `kind` is `judged`, `pending`, `empty` or `unreadable`
 */
export function judgeCheckRuns(payload, roster = EXPECTED_SKIPS) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.check_runs)) {
    return { kind: 'unreadable', reason: 'not a check-runs payload — no `check_runs` array' };
  }
  const runs = payload.check_runs;
  if (runs.length === 0) {
    return { kind: 'empty', reason: 'the head carries no check-runs at all — nothing ran, so nothing was judged' };
  }
  const byName = new Map(roster.map((row) => [row.name, row]));
  const failedBySuite = new Map();
  for (const run of runs) {
    if (run?.status === 'completed' && FAILED_CONCLUSIONS.includes(run.conclusion)) {
      const suite = run.check_suite?.id ?? null;
      if (suite === null) continue;
      if (!failedBySuite.has(suite)) failedBySuite.set(suite, []);
      failedBySuite.get(suite).push({ name: String(run.name), conclusion: run.conclusion });
    }
  }
  const expected = new Map();
  const unexpected = [];
  const other = [];
  const pending = [];
  let success = 0;
  for (const run of runs) {
    const name = String(run?.name ?? '');
    if (run?.status !== 'completed') {
      pending.push({ name, status: String(run?.status ?? 'unknown') });
      continue;
    }
    if (run.conclusion === 'success') {
      success += 1;
      continue;
    }
    if (run.conclusion === 'skipped') {
      const row = byName.get(name);
      if (row) {
        if (!expected.has(name)) expected.set(name, { name, count: 0, reason: row.reason, workflow: row.workflow, job: row.job });
        expected.get(name).count += 1;
      } else {
        unexpected.push({
          name,
          suite: run.check_suite?.id ?? null,
          id: run.id ?? null,
          url: run.html_url ?? null,
          classification: classifySkip(run, failedBySuite),
        });
      }
      continue;
    }
    other.push({ name, conclusion: String(run.conclusion), suite: run.check_suite?.id ?? null });
  }
  return {
    kind: pending.length > 0 ? 'pending' : 'judged',
    reason: pending.length > 0 ? `${pending.length} check-run(s) have not completed — the skip set is not final` : null,
    total: runs.length,
    success,
    expected: [...expected.values()],
    unexpected,
    other,
    pending,
  };
}

/** The exit code a judgement earns. */
export function verdictExit(judgement) {
  if (judgement.kind !== 'judged') return EXIT_PREREQUISITE_NOT_MET;
  return judgement.unexpected.length > 0 ? EXIT_UNEXPECTED_SKIP : EXIT_OK;
}

// ---------------------------------------------------------------------------
// Reading the board.
// ---------------------------------------------------------------------------

/**
 * Classify one read's outcome. Pure, so every refusal branch is offline-testable.
 * A refused credential is NOT a classified refusal here: `rest` below falls back
 * to the header-less public read first, and only a refusal on BOTH paths lands.
 */
export function classifyRead({ status = null, networkError = null } = {}) {
  if (networkError) return { kind: 'unreachable', headline: `api.github.com could not be reached (${networkError})` };
  if (status === 401 || status === 403) return { kind: 'refused', headline: `the read was refused on every path (HTTP ${status})` };
  if (status === 404) return { kind: 'not-found', headline: 'HTTP 404 — no such PR or commit on this board' };
  if (status === 422) return { kind: 'no-such-commit', headline: 'HTTP 422 — the API cannot resolve that sha (a garbage or never-pushed commit)' };
  if (typeof status === 'number' && status >= 400) return { kind: `http-${status}`, headline: `HTTP ${status}` };
  return { kind: 'ok', headline: 'read' };
}

const readState = { tokenRetired: null, served: { token: 0, public: 0 }, rate: null };

function noteRateLimit(res) {
  const remaining = res.headers.get('x-ratelimit-remaining');
  const limit = res.headers.get('x-ratelimit-limit');
  if (remaining === null && limit === null) return;
  readState.rate = { remaining, limit, resource: res.headers.get('x-ratelimit-resource') };
}

/** One request on ONE path. `token` empty means: send no `authorization`. */
async function restOnce(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'objectstack-check-expected-skips',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  noteRateLimit(res);
  if (!res.ok) {
    const err = new Error(`GET ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * One read, down the ladder: the token first, then the same request with no
 * `authorization` header. The fallback is reached on 401/403 ONLY; every other
 * status is a fact about the resource and is raised unchanged.
 */
async function rest(path) {
  if (TOKEN && !readState.tokenRetired) {
    try {
      const json = await restOnce(path, TOKEN);
      readState.served.token += 1;
      return json;
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) throw err;
      readState.tokenRetired = { status: err.status };
      console.error(`ℹ️  the token in GITHUB_TOKEN/GH_TOKEN was refused (HTTP ${err.status}); falling back to the token-less public read.`);
    }
  }
  const json = await restOnce(path, '');
  readState.served.public += 1;
  return json;
}

/** Run one read and fold its failure into a classified verdict. */
async function guarded(fn) {
  try {
    return { verdict: classifyRead(), value: await fn() };
  } catch (err) {
    if (typeof err?.status === 'number') return { verdict: classifyRead({ status: err.status }) };
    return { verdict: classifyRead({ networkError: err?.message ?? 'unknown' }) };
  }
}

/** The PR's current head sha, plus the state a report wants beside it. */
async function resolvePrHead(number, repo) {
  const read = await guarded(() => rest(`/repos/${repo}/pulls/${number}`));
  if (read.verdict.kind !== 'ok') return read;
  const pr = read.value;
  if (typeof pr?.head?.sha !== 'string') return { verdict: { kind: 'not-a-pull', headline: `/pulls/${number} answered without a head sha` } };
  return { verdict: read.verdict, value: { sha: pr.head.sha, state: pr.state, draft: pr.draft === true, merged: pr.merged_at ?? null } };
}

/** The full check-runs listing for one sha, paginated until `total_count` is met. */
async function readCheckRuns(sha, repo) {
  const runs = [];
  let total = null;
  for (let page = 1; page <= 10; page += 1) {
    const read = await guarded(() => rest(`/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`));
    if (read.verdict.kind !== 'ok') return read;
    const body = read.value;
    if (!body || !Array.isArray(body.check_runs)) return { verdict: { kind: 'not-a-listing', headline: 'the check-runs endpoint answered without a `check_runs` array' } };
    total = typeof body.total_count === 'number' ? body.total_count : total;
    runs.push(...body.check_runs);
    if (body.check_runs.length === 0 || total === null || runs.length >= total) break;
  }
  return { verdict: classifyRead(), value: { total_count: total ?? runs.length, check_runs: runs } };
}

function readPathLine() {
  const token = !TOKEN
    ? 'absent (GITHUB_TOKEN / GH_TOKEN)'
    : readState.tokenRetired
      ? `present but refused (HTTP ${readState.tokenRetired.status})`
      : `present, served ${readState.served.token} read(s)`;
  const rate = readState.rate
    ? `rate limit seen (${readState.rate.resource ?? 'core'}): ${readState.rate.remaining ?? '?'} of ${readState.rate.limit ?? '?'} remaining`
    : 'rate limit: no `x-ratelimit-*` header seen — remaining budget UNKNOWN';
  return `read paths — token: ${token}; header-less public read: served ${readState.served.public} read(s). ${rate}.`;
}

/**
 * Route this process's `fetch` through `HTTPS_PROXY` before asking it anything
 * (the plan is imported; only the guard variable is this file's).
 */
function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({
    env: { ...process.env, [PROXY_REARM_GUARD]: process.env[OWN_PROXY_REARM_GUARD] },
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
  });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
  console.error(`ℹ️  re-exec with ${plan.flag}: ${plan.reason}.`);
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], {
    stdio: 'inherit',
    env: { ...process.env, [OWN_PROXY_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return child.status;
  console.error(`⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — every request will bypass the proxy.`);
  return null;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** The refusal printer: "could not read" must never be legible as "all expected". */
function reportNotMeasured(headline, detail = []) {
  console.error(
    `\ncheck-expected-skips: NOT MEASURED — ${headline}\n` +
      detail.map((l) => `  ${l}\n`).join('') +
      `\n  Nothing was judged: no skipped check-run was compared against the roster, so this result\n` +
      `  says NOTHING about whether the head's skips are expected. It is not a clean head and it is\n` +
      `  not a dirty one — it is no reading at all.\n` +
      `  (Exit code ${EXIT_PREREQUISITE_NOT_MET}; capture it BEFORE any pipe:\n` +
      `   \`node scripts/pm/check-expected-skips.mjs --pr N > /tmp/skips.log 2>&1; echo "EXIT=$?"\`.)\n`,
  );
  return EXIT_PREREQUISITE_NOT_MET;
}

/** The plain-text report. Pure over the judgement so the self-test can read it. */
export function renderReport(judgement, meta = {}) {
  const L = [];
  const where = meta.head ? `head ${meta.head}` : 'a pre-fetched payload';
  const pr = meta.pr ? ` (PR #${meta.pr.number}: ${meta.pr.state}${meta.pr.draft ? ', draft' : ''}${meta.pr.merged ? `, merged ${meta.pr.merged}` : ''})` : '';
  L.push(`check-expected-skips: ${where} on ${meta.repo ?? 'this board'}${pr}`);
  if (judgement.kind !== 'judged') {
    L.push(`  ${judgement.reason}`);
    for (const p of judgement.pending ?? []) L.push(`    ${p.name} — ${p.status}`);
    return L;
  }
  const skipped = judgement.expected.reduce((n, e) => n + e.count, 0) + judgement.unexpected.length;
  L.push(`  ${judgement.total} check-run(s): ${judgement.success} success · ${skipped} skipped · ${judgement.other.length} other conclusion(s)`);
  if (judgement.expected.length > 0) {
    L.push(`  expected skips (${judgement.expected.length} name(s), ${judgement.expected.reduce((n, e) => n + e.count, 0)} run(s)):`);
    for (const e of [...judgement.expected].sort((a, b) => a.name.localeCompare(b.name))) {
      L.push(`    ×${e.count} ${e.name}  [${e.workflow} › ${e.job}]`);
      L.push(`       ${e.reason}`);
    }
  } else {
    L.push('  expected skips: none — no rostered name skipped on this head');
  }
  if (judgement.unexpected.length > 0) {
    L.push(`  ⛔ unexpected skips (${judgement.unexpected.length}) — outside the roster:`);
    for (const u of judgement.unexpected) {
      L.push(`    ${u.name}${u.suite !== null ? `  (check suite ${u.suite})` : ''}${u.url ? `  ${u.url}` : ''}`);
      L.push(`       ${u.classification.kind}: ${u.classification.detail}`);
    }
  }
  if (judgement.other.length > 0) {
    L.push(`  ⚠️  other conclusions (${judgement.other.length}) — NOT this check's verdict; the bar's success half reads these:`);
    for (const o of judgement.other) L.push(`    ${o.name} = ${o.conclusion}${o.suite !== null ? `  (check suite ${o.suite})` : ''}`);
  }
  const exit = verdictExit(judgement);
  L.push(
    exit === EXIT_OK
      ? `VERDICT check-expected-skips: OK — ${skipped} skipped check-run(s), every one in the roster (exit ${EXIT_OK})`
      : `VERDICT check-expected-skips: ⛔ ${judgement.unexpected.length} skipped check-run(s) outside the roster (exit ${EXIT_UNEXPECTED_SKIP})`,
  );
  return L;
}

/** The roster, rendered for a seat that wants to read it without a network. */
export function renderRoster(roster = EXPECTED_SKIPS) {
  const L = [`check-expected-skips: ${roster.length} expected-skip name(s), declared in scripts/pm/check-expected-skips.mjs`];
  for (const row of roster) {
    L.push(`  ${row.name}  [${row.workflow} › ${row.job}; gate: ${row.gate.kind}${row.gate.outputs ? ` ${row.gate.outputs.join('|')}` : row.gate.label ? ` ${row.gate.label}` : ''}]`);
    L.push(`     ${row.reason}`);
  }
  return L;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const USAGE = [
  'usage: node scripts/pm/check-expected-skips.mjs (--pr N | --head SHA | --check-runs-json FILE|-) [--json]',
  '       node scripts/pm/check-expected-skips.mjs --roster | --self-test | --help',
  '',
  '  exit 0  every skipped check-run on the head is in the roster',
  '  exit 4  a skipped check-run is outside it (named and classified)',
  '  exit 3  NOT MEASURED — unreadable head, no check-runs, or a check-run still running',
];

export function parseArgs(argv) {
  const opts = { pr: null, head: null, checkRunsJson: null, json: false, roster: false, selfTest: false, help: false, errors: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      return argv[i];
    };
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--roster') opts.roster = true;
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '--pr') opts.pr = next();
    else if (a.startsWith('--pr=')) opts.pr = a.slice('--pr='.length);
    else if (a === '--head') opts.head = next();
    else if (a.startsWith('--head=')) opts.head = a.slice('--head='.length);
    else if (a === '--check-runs-json') opts.checkRunsJson = next();
    else if (a.startsWith('--check-runs-json=')) opts.checkRunsJson = a.slice('--check-runs-json='.length);
    else opts.errors.push(`unknown argument: ${a}`);
  }
  if (opts.pr !== null && !/^[1-9][0-9]*$/.test(String(opts.pr ?? ''))) opts.errors.push('--pr needs a positive integer');
  if (opts.head !== null && !/^[0-9a-f]{7,40}$/i.test(String(opts.head ?? ''))) opts.errors.push('--head needs a hex sha (7–40 characters)');
  if (opts.checkRunsJson !== null && !String(opts.checkRunsJson ?? '')) opts.errors.push('--check-runs-json needs a file path, or - for stdin');
  const modes = [opts.pr !== null, opts.head !== null, opts.checkRunsJson !== null].filter(Boolean).length;
  if (!opts.help && !opts.roster && !opts.selfTest && modes !== 1) opts.errors.push('name exactly one of --pr, --head, --check-runs-json');
  return opts;
}

async function run(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE.join('\n'));
    return EXIT_OK;
  }
  if (opts.roster) {
    console.log(renderRoster().join('\n'));
    return EXIT_OK;
  }
  if (opts.errors.length > 0) {
    console.error(`check-expected-skips: ${opts.errors.join('; ')}\n\n${USAGE.join('\n')}`);
    return EXIT_UNCLASSIFIED;
  }
  const sweep = resolveSweepRepo(process.env);
  if (!sweep.valid) {
    return reportNotMeasured(`${sweep.source} is not an owner/name repository spelling: ${JSON.stringify(sweep.repo)}`);
  }
  const meta = { repo: sweep.repo, head: null, pr: null };
  let payload;
  if (opts.checkRunsJson !== null) {
    let text;
    try {
      text = opts.checkRunsJson === '-' ? readFileSync(0, 'utf8') : readFileSync(opts.checkRunsJson, 'utf8');
    } catch (err) {
      return reportNotMeasured(`--check-runs-json ${opts.checkRunsJson} could not be read (${err?.message ?? 'unknown'})`);
    }
    try {
      payload = JSON.parse(text);
    } catch (err) {
      return reportNotMeasured(`--check-runs-json ${opts.checkRunsJson} is not JSON (${err?.message ?? 'unknown'})`);
    }
    meta.head = typeof payload?.head_sha === 'string' ? payload.head_sha : null;
  } else {
    // Transport before questions about it: a read taken on the bypassed route
    // answers about the wrong route. Re-exec first, then ask.
    const rearmed = rearmThroughProxy(argv);
    if (rearmed !== null) return rearmed;
    console.error(`board: ${sweep.repo} (${sweep.source}${sweep.source === 'default' ? `, ${DEFAULT_SWEEP_REPO}` : ''}); roster: this checkout's workflows.`);
    let sha = opts.head;
    if (opts.pr !== null) {
      const resolved = await resolvePrHead(opts.pr, sweep.repo);
      if (resolved.verdict.kind !== 'ok') return reportNotMeasured(`PR #${opts.pr}: ${resolved.verdict.headline}`, [readPathLine()]);
      sha = resolved.value.sha;
      meta.pr = { number: Number(opts.pr), state: resolved.value.state, draft: resolved.value.draft, merged: resolved.value.merged };
    }
    const listing = await readCheckRuns(sha, sweep.repo);
    if (listing.verdict.kind !== 'ok') return reportNotMeasured(`check-runs of ${sha}: ${listing.verdict.headline}`, [readPathLine()]);
    payload = listing.value;
    meta.head = sha;
    console.error(readPathLine());
  }
  const judgement = judgeCheckRuns(payload);
  const exit = verdictExit(judgement);
  if (opts.json) {
    console.log(JSON.stringify({ ...meta, exit, judgement }, null, 2));
  } else {
    console.log(renderReport(judgement, meta).join('\n'));
  }
  if (judgement.kind !== 'judged') return reportNotMeasured(judgement.reason);
  return exit;
}

// ---------------------------------------------------------------------------
// Self-test — offline, no network at all.
// ---------------------------------------------------------------------------

const SELF_TEST_VERDICT = 'check-expected-skips-self-test-reached-its-verdict';

/** A fixture check-run in the REST shape the judge reads. */
function fixtureRun(name, conclusion, suite = 1, extra = {}) {
  return { id: Math.floor(Math.random() * 1e9), name, status: 'completed', conclusion, check_suite: { id: suite }, html_url: null, ...extra };
}

/**
 * Measured 2026-09-16 on PR #18315's head `b671f83b` (the AGENTS.md-only
 * landing): 39 check-runs, 20 success / 19 skipped, four `PR Automation` runs
 * on one head. Names, conclusions and check-suite ids VERBATIM from the
 * listing. This is the real shape the roster must accept, kept here so the
 * measured family and the declared family cannot drift apart unnoticed.
 *
 * ⚠️ It predates #17673, so ONE of its 19 skips — `Console Pin Gate` — is a
 * finding under today's roster, and the cases below say so rather than edit
 * a measurement. What the same head reads NOW is `CONCLUDING_18315`: that one
 * row as the job concludes on an unaffected run since #17673 (`success`, with
 * a NOT BUILT notice), every other row untouched — DERIVED, not measured.
 */
const MEASURED_18315 = [
  ['Auto Label', 'skipped', 94769348293],
  ['Auto Label', 'success', 94769267825],
  ['Auto Label', 'skipped', 94771343927],
  ['Auto Label', 'skipped', 94906910103],
  ['Build Core', 'skipped', 94769267631],
  ['Build Docs', 'skipped', 94769267631],
  ['Check Changeset', 'success', 94769267825],
  ['Check Changeset', 'skipped', 94769348293],
  ['Check Changeset', 'skipped', 94771343927],
  ['Check Changeset', 'skipped', 94906910103],
  ['Check Documentation Links', 'success', 94769267713],
  ['Check PR Size', 'skipped', 94769348293],
  ['Check PR Size', 'success', 94769267825],
  ['Check PR Size', 'skipped', 94771343927],
  ['Check PR Size', 'skipped', 94906910103],
  ['Close issues referenced in other repositories', 'success', 94909498693],
  ['Console Pin Gate', 'skipped', 94769267631],
  ['Dogfood Regression Gate', 'success', 94769267631],
  ['Dogfood Regression Gate (${{ matrix.shard }}/3)', 'skipped', 94769267631],
  ['Dogfood Verify CLI', 'skipped', 94769267631],
  ['filter', 'success', 94769267631],
  ['Governed Surface Queue Guard', 'success', 94769267876],
  ['Governed Surface Queue Guard', 'success', 94906696172],
  ['Lint & Repo Gates', 'success', 94769267736],
  ['No other open PR may claim the same issue', 'success', 94769267871],
  ['No other open PR may claim the same single-writer path', 'success', 94769267668],
  ['Packed-tarball smoke (opt-in)', 'skipped', 94769267813],
  ['Packed-tarball smoke (opt-in)', 'skipped', 94769348316],
  ['Packed-tarball smoke (opt-in)', 'skipped', 94771343988],
  ['Part-of PR must not also close its card', 'success', 94769267707],
  ['Temporal Conformance (live PG + MySQL)', 'skipped', 94769267631],
  ['Test Core', 'success', 94769267631],
  ['Test Core (${{ matrix.shard }}/6)', 'skipped', 94769267631],
  ['The card this PR closes must claim this branch', 'success', 94769267827],
  ['Type Check · consumer gates', 'success', 94769267736],
  ['Type Check · debt ledger', 'success', 94769267736],
  ['Type Check · source gates', 'success', 94769267736],
  ['Type Check · workspace', 'success', 94769267736],
  ['TypeScript Type Check', 'success', 94769267736],
];

const CONCLUDING_18315 = MEASURED_18315.map(([name, conclusion, suite]) =>
  name === 'Console Pin Gate' ? [name, 'success', suite] : [name, conclusion, suite],
);

function measuredPayload(rows = MEASURED_18315) {
  return { total_count: rows.length, check_runs: rows.map(([name, conclusion, suite]) => fixtureRun(name, conclusion, suite)) };
}

/** Spawn this file's CLI on a payload file, offline; returns { status, stdout, stderr }. */
function spawnSelf(args) {
  const child = spawnSync(process.execPath, [SELF_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PM_SWEEP_REPO: 'objectstack-ai/objectstack', HTTPS_PROXY: '', https_proxy: '' },
  });
  return { status: child.status, stdout: child.stdout ?? '', stderr: child.stderr ?? '' };
}

export function selfTest() {
  const cases = [];
  const t = (name, actual, expected) => cases.push({ name, actual, expected, ok: Object.is(actual, expected) });
  const readLive = workflowReader(ROOT);

  // ---- exit register -------------------------------------------------------
  t('exit register: OK is 0', EXIT_OK, 0);
  t('exit register: an unexpected skip is 4, distinct from NOT MEASURED', EXIT_UNEXPECTED_SKIP === 4 && EXIT_UNEXPECTED_SKIP !== EXIT_PREREQUISITE_NOT_MET, true);
  t('exit register: NOT MEASURED is the repo-wide 3, imported not redeclared', EXIT_PREREQUISITE_NOT_MET, 3);
  t('exit register: the five codes are distinct', new Set([EXIT_OK, EXIT_SELF_TEST_FAILED, EXIT_UNCLASSIFIED, EXIT_PREREQUISITE_NOT_MET, EXIT_UNEXPECTED_SKIP]).size, 5);

  // ---- the roster's own shape, and its truth on the live tree --------------
  const liveFindings = auditRoster(EXPECTED_SKIPS, readLive);
  t(`roster: true of this checkout's workflows (${liveFindings.length === 0 ? 'no finding' : liveFindings.join(' | ')})`, liveFindings.length, 0);
  t('roster: every row carries a reason', EXPECTED_SKIPS.every((r) => typeof r.reason === 'string' && r.reason.length > 20), true);
  t('roster: no duplicate names', new Set(EXPECTED_SKIPS.map((r) => r.name)).size, EXPECTED_SKIPS.length);
  t('roster: every gate kind is declared', EXPECTED_SKIPS.every((r) => GATE_KINDS.includes(r.gate.kind)), true);
  t('roster: the two matrix templates are spelled raw, as the API reports them', EXPECTED_SKIPS.filter((r) => r.name.includes('${{ matrix.shard }}')).length, 2);
  t('roster: the roster is frozen data', Object.isFrozen(EXPECTED_SKIPS), true);
  t('roster: a never-skipping required context is NOT in it (Lint & Repo Gates)', EXPECTED_SKIPS.some((r) => r.name === 'Lint & Repo Gates'), false);
  t('roster: …nor the ci.yml aggregates, which run if: always()', EXPECTED_SKIPS.some((r) => r.name === 'Test Core' || r.name === 'Dogfood Regression Gate'), false);
  t('roster: …nor the queue guard', EXPECTED_SKIPS.some((r) => r.name === 'Governed Surface Queue Guard'), false);
  // #17673: the console gate concludes on every run, so its skip is no longer
  // by design. Tied to the tree, not just to the array: the live job's own
  // `if:` must carry no filter term — a job that could skip by design again
  // belongs back in the roster, and this case reds first.
  t('roster: …nor Console Pin Gate, which concludes on every run since #17673', EXPECTED_SKIPS.some((r) => r.name === 'Console Pin Gate'), false);
  t(
    "roster: …and the live console-pin job's own if: reads no filter output, so it cannot skip by design",
    (() => {
      const job = readLive('ci.yml')?.jobs?.['console-pin'];
      return Boolean(job) && job.name === 'Console Pin Gate' && typeof job.if === 'string' && !job.if.includes('needs.filter.outputs');
    })(),
    true,
  );

  // The audit must go RED on synthetic drift, in every direction it claims to see.
  const liveCi = readLive('ci.yml');
  const withJob = (mutate) => {
    const doc = JSON.parse(JSON.stringify(liveCi));
    mutate(doc);
    return (file) => (file === 'ci.yml' ? doc : readLive(file));
  };
  const coreRow = EXPECTED_SKIPS.find((r) => r.name === 'Build Core');
  t('audit: a deleted job reds the row', auditRoster([coreRow], withJob((d) => delete d.jobs['build-core'])).some((f) => f.includes('has no job')), true);
  t('audit: a renamed job reds the row', auditRoster([coreRow], withJob((d) => (d.jobs['build-core'].name = 'Build Kernel'))).some((f) => f.includes('is named')), true);
  t('audit: a job that lost its if: reds the row (it cannot skip by design)', auditRoster([coreRow], withJob((d) => delete d.jobs['build-core'].if)).some((f) => f.includes('carries no `if:`')), true);
  t('audit: a re-gated job reds the row', auditRoster([coreRow], withJob((d) => (d.jobs['build-core'].if = "${{ needs.filter.outputs.docs != 'false' }}"))).some((f) => f.includes('does not spell')), true);
  t("audit: a filter output that lost its || 'true' widening reds the row", auditRoster([coreRow], withJob((d) => (d.jobs.filter.outputs.core = '${{ steps.changes.outputs.core }}'))).some((f) => f.includes("|| 'true'")), true);
  t('audit: an unreadable workflow is a refusal, not a pass', auditRoster([coreRow], () => null).some((f) => f.includes('could not be read')), true);
  t('audit: a row with no reason is a finding', auditRoster([{ ...coreRow, reason: '' }], readLive).some((f) => f.includes('missing `reason`')), true);
  t('audit: a duplicate name is a finding', auditRoster([coreRow, coreRow], readLive).some((f) => f.includes('duplicate name')), true);
  t('audit: an unknown gate kind is a finding', auditRoster([{ ...coreRow, gate: { kind: 'vibes' } }], readLive).some((f) => f.includes('is not one of')), true);
  t('audit: a label row whose literal is not in the if: reds', auditRoster([{ ...EXPECTED_SKIPS.find((r) => r.name === 'Check Changeset'), gate: { kind: 'label', label: 'skip-tests' } }], readLive).some((f) => f.includes('does not spell')), true);
  t('audit: a clean roster over the live tree yields zero findings for the label rows too', auditRoster(EXPECTED_SKIPS.filter((r) => r.gate.kind === 'label'), readLive).length, 0);

  // ---- the judge -------------------------------------------------------------
  // The measured head, VERBATIM: every one of its 19 skips was expected when it
  // was read, and one of them is a finding now (#17673).
  const measured = judgeCheckRuns(measuredPayload());
  t('measured head: judged (no pending run)', measured.kind, 'judged');
  t('measured head: 20 success', measured.success, 20);
  t('measured head: 19 skipped, 18 of them expected', measured.expected.reduce((n, e) => n + e.count, 0), 18);
  t('measured head: its skipped Console Pin Gate is now the one UNEXPECTED skip (#17673)', measured.unexpected.map((u) => u.name).join('|'), 'Console Pin Gate');
  t('measured head: …classified as a filter miss (no failure in its suite)', measured.unexpected[0]?.classification.kind, 'filter-miss');
  t('measured head: ten of ten rostered names appear', measured.expected.length, 10);
  t('measured head: exit 4', verdictExit(measured), 4);
  t('measured head: the multiplicity is reported (Auto Label ×3)', measured.expected.find((e) => e.name === 'Auto Label')?.count, 3);
  t('measured head: the report ends on the exit-4 verdict line', renderReport(measured, { head: 'b671f83b', repo: 'objectstack-ai/objectstack' }).at(-1).includes('(exit 4)'), true);

  // The same head as it reads since #17673 — `Console Pin Gate` concluding
  // `success` on an unaffected run, every other row verbatim.
  const concluding = judgeCheckRuns(measuredPayload(CONCLUDING_18315));
  t('concluding head: 21 success', concluding.success, 21);
  t('concluding head: 18 skipped, every one expected', concluding.expected.reduce((n, e) => n + e.count, 0), 18);
  t('concluding head: zero unexpected skips', concluding.unexpected.length, 0);
  t('concluding head: exit 0', verdictExit(concluding), 0);
  t('concluding head: the report ends on the OK verdict line', renderReport(concluding, { head: 'b671f83b', repo: 'objectstack-ai/objectstack' }).at(-1).startsWith('VERDICT check-expected-skips: OK'), true);

  const oneExpected = judgeCheckRuns({ total_count: 2, check_runs: [fixtureRun('Lint & Repo Gates', 'success'), fixtureRun('Build Core', 'skipped')] });
  t('fixture: one expected skip → exit 0', verdictExit(oneExpected), 0);
  t('fixture: …and the reason travels with it', oneExpected.expected[0].reason.includes('merge-queue build'), true);

  const oneUnexpected = judgeCheckRuns({ total_count: 2, check_runs: [fixtureRun('Build Core', 'skipped'), fixtureRun('Lint & Repo Gates', 'skipped')] });
  t('fixture: a skip outside the roster → exit 4', verdictExit(oneUnexpected), 4);
  t('fixture: …naming it', oneUnexpected.unexpected[0]?.name, 'Lint & Repo Gates');
  t('fixture: …classified as a filter miss when its suite holds no failure', oneUnexpected.unexpected[0]?.classification.kind, 'filter-miss');
  t('fixture: …and the report names it under the ⛔ heading', renderReport(oneUnexpected).some((l) => l.includes('unexpected skips (1)')), true);
  t('fixture: …ending on the exit-4 verdict line', renderReport(oneUnexpected).at(-1).includes('(exit 4)'), true);
  t('fixture: the expected skip beside it is still counted', oneUnexpected.expected.length, 1);

  const depSkip = judgeCheckRuns({
    total_count: 3,
    check_runs: [fixtureRun('filter', 'failure', 7), fixtureRun('Some New Lane', 'skipped', 7), fixtureRun('Lint & Repo Gates', 'success', 8)],
  });
  t('fixture: a skip beside a same-suite failure → exit 4 (the failure is the finding)', verdictExit(depSkip), 4);
  t('fixture: …classified as a dependency skip', depSkip.unexpected[0]?.classification.kind, 'dependency-skip');
  t('fixture: …naming the failed run', depSkip.unexpected[0]?.classification.detail.includes('`filter`=failure'), true);
  t('fixture: …and the failure itself is listed under other conclusions', depSkip.other[0]?.conclusion, 'failure');
  t('fixture: a failure in ANOTHER suite does not make the skip a dependency skip', judgeCheckRuns({ total_count: 2, check_runs: [fixtureRun('filter', 'failure', 1), fixtureRun('Some New Lane', 'skipped', 2)] }).unexpected[0]?.classification.kind, 'filter-miss');

  const matrixMiss = judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('Nightly tiers (${{ matrix.shard }}/2)', 'skipped')] });
  t('fixture: a raw matrix template outside the roster → exit 4', verdictExit(matrixMiss), 4);
  t('fixture: …read as skipped before matrix expansion', matrixMiss.unexpected[0]?.classification.detail.includes('before matrix expansion'), true);

  t('fixture: a rostered name that SUCCEEDED is not a skip', judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('Build Core', 'success')] }).expected.length, 0);
  t('fixture: other conclusions do not move the skip verdict (failure beside all-expected skips → 0)', verdictExit(judgeCheckRuns({ total_count: 2, check_runs: [fixtureRun('Build Core', 'skipped', 1), fixtureRun('Lint & Repo Gates', 'failure', 2)] })), 0);
  t('fixture: …but they are printed loudly', renderReport(judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('Lint & Repo Gates', 'failure')] })).some((l) => l.includes('other conclusions (1)')), true);
  t('fixture: neutral is an "other" conclusion, never a skip', judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('X', 'neutral')] }).other[0]?.conclusion, 'neutral');

  const pending = judgeCheckRuns({ total_count: 2, check_runs: [fixtureRun('Build Core', 'skipped'), { id: 1, name: 'Lint & Repo Gates', status: 'in_progress', conclusion: null, check_suite: { id: 1 } }] });
  t('fixture: a check-run still running → NOT MEASURED (the skip set is not final)', verdictExit(pending), 3);
  t('fixture: …with the pending run named', pending.pending[0]?.name, 'Lint & Repo Gates');
  t('fixture: zero check-runs → NOT MEASURED, never 0', verdictExit(judgeCheckRuns({ total_count: 0, check_runs: [] })), 3);
  t('fixture: a payload without check_runs → NOT MEASURED', verdictExit(judgeCheckRuns({ hello: 'world' })), 3);
  t('fixture: a null payload → NOT MEASURED', verdictExit(judgeCheckRuns(null)), 3);
  t('fixture: a roster override is honoured (the judge is pure over its roster)', verdictExit(judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('Build Core', 'skipped')] }, [])), 4);

  // ---- read classification ---------------------------------------------------
  t('read: a network throw is unreachable', classifyRead({ networkError: 'ECONNREFUSED' }).kind, 'unreachable');
  t('read: 422 is the garbage-sha answer', classifyRead({ status: 422 }).kind, 'no-such-commit');
  t('read: 404 is not-found', classifyRead({ status: 404 }).kind, 'not-found');
  t('read: 401 after the ladder is refused', classifyRead({ status: 401 }).kind, 'refused');
  t('read: 403 after the ladder is refused', classifyRead({ status: 403 }).kind, 'refused');
  t('read: 500 is named by status', classifyRead({ status: 500 }).kind, 'http-500');
  t('read: 200 is ok', classifyRead({ status: 200 }).kind, 'ok');
  t('read: no observation is ok (the success path)', classifyRead().kind, 'ok');

  // ---- argv ------------------------------------------------------------------
  t('argv: --pr N parses', parseArgs(['--pr', '18315']).pr, '18315');
  t('argv: --pr=N parses', parseArgs(['--pr=18315']).pr, '18315');
  t('argv: --head SHA parses', parseArgs(['--head', 'b671f83b']).head, 'b671f83b');
  t('argv: a non-hex head is refused', parseArgs(['--head', 'not-a-sha']).errors.length > 0, true);
  t('argv: a non-integer PR is refused', parseArgs(['--pr', 'abc']).errors.length > 0, true);
  t('argv: two modes at once are refused', parseArgs(['--pr', '1', '--head', 'abcdef0']).errors.length > 0, true);
  t('argv: no mode at all is refused', parseArgs([]).errors.length > 0, true);
  t('argv: --roster needs no mode', parseArgs(['--roster']).errors.length, 0);
  t('argv: --self-test needs no mode', parseArgs(['--self-test']).errors.length, 0);
  t('argv: --check-runs-json - is stdin', parseArgs(['--check-runs-json', '-']).checkRunsJson, '-');
  t('argv: --json is a flag', parseArgs(['--pr', '1', '--json']).json, true);
  t('argv: an unknown flag is an error', parseArgs(['--pr', '1', '--bogus']).errors[0], 'unknown argument: --bogus');

  // ---- the real CLI, offline, on payload files ---------------------------------
  const dir = mkdtempSync(join(tmpdir(), 'check-expected-skips-'));
  try {
    const okFile = join(dir, 'ok.json');
    writeFileSync(okFile, JSON.stringify({ head_sha: 'b671f83b', ...measuredPayload(CONCLUDING_18315) }));
    const ok = spawnSelf(['--check-runs-json', okFile]);
    t('cli: the concluding head on disk → exit 0', ok.status, 0);
    t('cli: …with the OK verdict line on stdout', ok.stdout.includes('VERDICT check-expected-skips: OK'), true);
    t('cli: …naming the head it read from the payload', ok.stdout.includes('head b671f83b'), true);

    const badFile = join(dir, 'bad.json');
    writeFileSync(badFile, JSON.stringify({ total_count: 2, check_runs: [fixtureRun('Build Core', 'skipped'), fixtureRun('TypeScript Type Check', 'skipped')] }));
    const bad = spawnSelf(['--check-runs-json', badFile]);
    t('cli: an unexpected skip on disk → exit 4', bad.status, 4);
    t('cli: …naming it on stdout', bad.stdout.includes('TypeScript Type Check'), true);
    t('cli: …under the ⛔ heading', bad.stdout.includes('⛔ unexpected skips (1)'), true);

    const json = spawnSelf(['--check-runs-json', badFile, '--json']);
    t('cli: --json carries the exit and the unexpected list', (() => {
      try {
        const doc = JSON.parse(json.stdout);
        return doc.exit === 4 && doc.judgement.unexpected[0].name === 'TypeScript Type Check';
      } catch {
        return false;
      }
    })(), true);

    const emptyFile = join(dir, 'empty.json');
    writeFileSync(emptyFile, JSON.stringify({ total_count: 0, check_runs: [] }));
    t('cli: zero check-runs on disk → exit 3', spawnSelf(['--check-runs-json', emptyFile]).status, 3);

    const notJson = join(dir, 'not.json');
    writeFileSync(notJson, '{ this is not json');
    const nj = spawnSelf(['--check-runs-json', notJson]);
    t('cli: a non-JSON payload → exit 3', nj.status, 3);
    t('cli: …printing NOT MEASURED on stderr', nj.stderr.includes('NOT MEASURED'), true);

    const missing = spawnSelf(['--check-runs-json', join(dir, 'does-not-exist.json')]);
    t('cli: an unreadable payload file → exit 3 (the unreadable-head leg, offline)', missing.status, 3);
    t('cli: …never 0 and never 4', missing.status !== 0 && missing.status !== 4, true);

    const usage = spawnSelf([]);
    t('cli: no mode → usage on stderr, exit 2', usage.status === 2 && usage.stderr.includes('usage:'), true);
    const roster = spawnSelf(['--roster']);
    t('cli: --roster prints every row without a network', roster.status === 0 && EXPECTED_SKIPS.every((r) => roster.stdout.includes(r.name)), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ---- structural: report-only, single-sourced transport ---------------------
  // Literal-masked for code-position signals (a `method:` key, a function
  // declaration), comment-masked for quoted ones (an import specifier); the
  // needles are BUILT so this block cannot match its own spelling.
  const source = readFileSync(SELF_PATH, 'utf8');
  const positions = maskCommentsAndLiterals(source);
  const quoted = maskComments(source);
  const declared = (name) => new RegExp(`function\\s+${name}\\b`);
  t("structural: no `method:` key anywhere in this file's code — it can only GET", /\bmethod\s*:/.test(positions), false);
  t('structural: no label or comment writer is imported', ['label-write', 'post-stamped'].some((n) => quoted.includes(`${n}.mjs`)), false);
  t('structural: the proxy plan is imported, not restated', /\bproxyRearmPlan\b/.test(positions) && !declared(['proxyRearm', 'Plan'].join('')).test(positions), true);
  t("structural: this file's re-exec guard is not the patrol's", OWN_PROXY_REARM_GUARD === PROXY_REARM_GUARD, false);
  t('structural: a proxied environment plans a re-exec', proxyRearmPlan({ env: { HTTPS_PROXY: 'http://127.0.0.1:1' }, flagSupported: true }).rearm, true);
  t('structural: …and having re-armed once, does not loop', proxyRearmPlan({ env: { HTTPS_PROXY: 'http://127.0.0.1:1', [PROXY_REARM_GUARD]: '1' }, flagSupported: true }).rearm, false);
  t('structural: the board resolver is the shared one (default board pinned)', resolveSweepRepo({}).repo, DEFAULT_SWEEP_REPO);
  t('structural: the SKILL.md enqueue bar names this file', readFileSync(join(ROOT, '.claude/skills/pm-dispatch/SKILL.md'), 'utf8').includes('check-expected-skips.mjs'), true);

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name} (got ${JSON.stringify(c.actual)}, want ${JSON.stringify(c.expected)})`);
  if (failed.length > 0) {
    console.error(`✗ check-expected-skips self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return { code: EXIT_SELF_TEST_FAILED, verdict: SELF_TEST_VERDICT };
  }
  console.log(
    `✓ check-expected-skips self-test: ${cases.length} cases pass (the exit register; the roster's shape — reasons, no duplicates, ` +
      'declared gate kinds — and its truth on this checkout\'s workflows, with the audit driven red on a deleted, renamed, un-gated and ' +
      "re-gated job, a lost || 'true' widening and an unreadable workflow; the judge on the measured 39-run head (its Console Pin Gate " +
      'skip a finding since #17673) and on that head as it concludes today, and on fixtures for an ' +
      'expected skip, an unexpected skip named as a filter miss, a same-suite failure read as a dependency skip, a raw matrix template, ' +
      'other conclusions, a pending run and an empty head; read classification for 422 / 404 / 401 / 403 / 5xx / network; argv; the real ' +
      'CLI on payload files for 0 / 4 / 3 and --json; and the structural no-write-path, single-sourced transport and SKILL.md pointer pins).',
  );
  return { code: EXIT_OK, verdict: SELF_TEST_VERDICT };
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const r = selfTest();
    if (r.verdict !== SELF_TEST_VERDICT) {
      console.error('\n✗ check-expected-skips self-test: selfTest() returned without reaching its verdict, so no success line was printed.\n');
      process.exit(EXIT_SELF_TEST_FAILED);
    }
    process.exit(r.code);
  } else {
    run(process.argv.slice(2))
      .then((code) => process.exit(code))
      .catch((err) => {
        // ⛔ A run that could not complete must never read as "every skip is expected".
        console.error(`check-expected-skips: the run failed for an unclassified reason — ${err?.message ?? err}`);
        process.exit(EXIT_UNCLASSIFIED);
      });
  }
}
