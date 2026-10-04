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
 * declares it — or `deriveNonPrEventSkips` below admits its one exact shape.
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
 * which board was read so the mismatch is visible. Reads go down a two-rung
 * ladder: the exported token first, and the header-less public read when the
 * token is refused. In a proxied agent
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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
 * Measured, not remembered: the eleven names below are the union of every
 * `skipped` name over the ten landed heads the header lists. Five of them
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
 * These are the LISTED rows. The judge reads them beside the DERIVED ones —
 * `deriveNonPrEventSkips` below, one exact `if:` shape read off the tree — and
 * ⛔ a job that shape admits is never listed here: the derivation refuses a
 * name both halves carry.
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
  {
    name: 'Console Pin Gate',
    workflow: 'ci.yml',
    job: 'console-pin',
    gate: { kind: 'filter-output', outputs: ['console'] },
    reason: "gated on ci.yml's `filter` job `console` output (the `.objectui-sha` pin, the console build/probe scripts, and the spec's entry layout: `packages/spec/package.json` and `packages/spec/tsup.config.ts`); a diff that moves none of them skips the pinned-console build",
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

/** Every workflow file under a root, sorted; empty when the directory is absent. */
export function listWorkflowFiles(root = ROOT) {
  const dir = join(root, WORKFLOW_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
}

// ---------------------------------------------------------------------------
// The DERIVED half — one job-level `if:` shape, read off the tree.
// ---------------------------------------------------------------------------

/**
 * The events a job may be gated to for its skip to be by design on every PR
 * head. Neither ever fires FOR a pull request: `schedule` runs on the default
 * branch's tip, and `workflow_dispatch` runs only when someone asks — and a
 * dispatched run SELECTS the job, so it runs rather than skips. ⛔ Closed on
 * purpose: `push` fires on a PR branch in any workflow that listens to it, and
 * `merge_group` is the queue's own verdict — widening this list is a decision
 * about those events, never a spelling fix.
 */
export const NON_PR_EVENTS = Object.freeze(['schedule', 'workflow_dispatch']);

/** The one comparison a term may be: `github.event_name == '<lowercase event>'`. */
const EVENT_NAME_TERM = /^github\.event_name\s*==\s*'([a-z_]+)'$/;
/** One `${{ … }}` expression inside a job `name:` (lazy, so two in a name are two). */
const NAME_EXPRESSION = /\$\{\{([\s\S]*?)\}\}/g;
/** A bare matrix reference — the one expression a pre-expansion skip reports raw. */
const MATRIX_REFERENCE = /^matrix\.[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Read a job-level `if:` as a gate to non-PR events ONLY, or answer null.
 *
 * ⛔ A recogniser, never an evaluator. The header's boundary stands: this file
 * does not evaluate GitHub's expression language, and so it admits exactly one
 * shape — a disjunction whose EVERY term is `github.event_name == '<e>'` with
 * `<e>` in `NON_PR_EVENTS`, optionally wrapped whole in one `${{ … }}`. That
 * shape is false on every `pull_request`, `push` and `merge_group` run by
 * construction, so the job skips on each of them before it starts — and it
 * reads nothing a run could make true: no `needs`, no output, no `inputs`, no
 * `matrix`, no path, no label. Anything else answers null, and null keeps the
 * skip where it was: outside the roster, exit 4. Measured refusals on this
 * tree: `release.yml` › `version-pr` (a `workflow_dispatch` term conjoined with
 * `inputs.refresh_version_pr`) and `merged-branch-reaper.yml` › `reap`
 * (`success()` and `inputs.dry_run` beside its event terms).
 *
 * @param {unknown} cond  the job's `if:` as the YAML parser returned it
 * @returns {string[]|null}  the sorted, de-duplicated events; null when not this shape
 */
export function nonPrEventGate(cond) {
  if (typeof cond !== 'string') return null;
  let expr = cond.trim();
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(expr);
  if (wrapped) expr = wrapped[1].trim();
  if (!expr || expr.includes('${{') || expr.includes('}}')) return null;
  const events = [];
  for (const term of expr.split('||')) {
    const m = EVENT_NAME_TERM.exec(term.trim());
    if (!m || !NON_PR_EVENTS.includes(m[1])) return null;
    if (!events.includes(m[1])) events.push(m[1]);
  }
  return events.length > 0 ? events.sort() : null;
}

/**
 * The name a job's check-run carries when it is skipped by a job-level gate —
 * `name:` VERBATIM, else the job key — or the reason it cannot be told.
 *
 * GitHub evaluates the job-level `if:` BEFORE it expands a matrix, so a gated
 * matrix job's skipped check-run keeps each `${{ matrix.* }}` reference
 * literally (measured on PR #20748's head `a84b73af13`: the skipped check-run
 * of `scaffold-e2e.yml` › `registry-canary` is named
 * `Registry canary: ${{ matrix.template }}`, run 36658032070, as are ci.yml's
 * two listed templates). Only an expanded job's check-runs carry expanded
 * names, and an expanded job RAN, so no expanded name is ever a skip this
 * derivation must admit. Any expression other than a bare matrix reference —
 * `inputs.*`, `needs.*.outputs.*`, `github.*` — has an unmeasured skipped
 * spelling, so it is refused rather than guessed.
 *
 * @returns {{ name: string } | { refused: string }}
 */
export function skippedCheckRunName(key, job) {
  if (job?.name !== undefined && typeof job.name !== 'string') {
    return { refused: `\`name:\` is a ${typeof job.name}, not a string — the check-run name is not derivable` };
  }
  const name = typeof job?.name === 'string' ? job.name : key;
  const expressions = [...name.matchAll(NAME_EXPRESSION)].map((m) => m[1].trim());
  if (expressions.length === 0) return { name };
  const foreign = expressions.filter((e) => !MATRIX_REFERENCE.test(e));
  if (foreign.length > 0) {
    return {
      refused: `\`name:\` holds ${foreign.map((e) => `\`\${{ ${e} }}\``).join(', ')} — only a bare \`\${{ matrix.* }}\` reference is measured to survive a pre-expansion skip raw`,
    };
  }
  if (job?.strategy?.matrix === undefined) {
    return { refused: '`name:` references `matrix.*` but the job declares no `strategy.matrix` — the skipped spelling is unmeasured' };
  }
  return { name };
}

/**
 * Derive the expected skips no one lists: every job, in every workflow file,
 * whose job-level `if:` `nonPrEventGate` admits, under the name
 * `skippedCheckRunName` gives it.
 *
 * The roster judges NAMES, so a derived name must mean ONE job. A candidate is
 * REFUSED — never admitted — when another job anywhere in the tree carries the
 * same check-run name (a skip of that other job would read expected), when the
 * listed roster already carries it (derive, don't list), or when its name
 * cannot be told. A workflow that cannot be read derives nothing and is
 * refused by file. Refusal is the safe direction: the skip stays exit 4. The
 * self-test holds the live tree's refusal list at empty, so the job's author
 * hears about it rather than a landing seat.
 *
 * @param {readonly string[]} files        workflow file names under `WORKFLOW_DIR`
 * @param {(file: string) => object|null} readWorkflow
 * @param {readonly object[]} [listed]     the listed roster the derived rows join
 * @returns {{ rows: object[], refused: { workflow: string, job: string|null, reason: string }[], scanned: number }}
 */
export function deriveNonPrEventSkips(files, readWorkflow, listed = EXPECTED_SKIPS) {
  const refused = [];
  const jobs = [];
  for (const workflow of files) {
    const wf = readWorkflow(workflow);
    if (!wf || typeof wf !== 'object') {
      refused.push({ workflow, job: null, reason: 'the workflow could not be read — none of its jobs is derived' });
      continue;
    }
    const entries = wf.jobs && typeof wf.jobs === 'object' ? Object.entries(wf.jobs) : [];
    for (const [key, job] of entries) {
      if (!job || typeof job !== 'object') continue;
      jobs.push({ workflow, key, job, named: skippedCheckRunName(key, job) });
    }
  }
  const bearers = new Map();
  for (const j of jobs) {
    if (!('name' in j.named)) continue;
    bearers.set(j.named.name, (bearers.get(j.named.name) ?? 0) + 1);
  }
  const listedNames = new Set(listed.map((r) => r.name));
  const rows = [];
  for (const { workflow, key, job, named } of jobs) {
    const events = nonPrEventGate(job.if);
    if (events === null) continue;
    if (!('name' in named)) {
      refused.push({ workflow, job: key, reason: named.refused });
      continue;
    }
    if (bearers.get(named.name) > 1) {
      refused.push({ workflow, job: key, reason: `${bearers.get(named.name)} jobs in the tree carry the check-run name ${JSON.stringify(named.name)} — a skip of the other would read expected` });
      continue;
    }
    if (listedNames.has(named.name)) {
      refused.push({ workflow, job: key, reason: `the listed roster already carries ${JSON.stringify(named.name)} — derive, don't list: delete the listed row` });
      continue;
    }
    const matrix = job.strategy?.matrix !== undefined;
    rows.push(
      Object.freeze({
        name: named.name,
        workflow,
        job: key,
        gate: Object.freeze({ kind: 'non-pr-event', events: Object.freeze(events) }),
        derived: true,
        reason:
          `derived, not listed: the job-level \`if:\` selects only ${events.map((e) => `\`${e}\``).join(' / ')}, so every pull_request, push and merge_group run skips it` +
          (matrix ? ' before its matrix expands, and the skipped check-run carries the raw `name:` template' : ''),
      }),
    );
  }
  return { rows, refused, scanned: files.length };
}

/**
 * The roster the judge reads: the listed rows, then the rows derived from the
 * workflows under `root`. The derivation travels beside it for the report.
 */
export function expectedSkipRoster(root = ROOT) {
  const derivation = deriveNonPrEventSkips(listWorkflowFiles(root), workflowReader(root));
  return { roster: Object.freeze([...EXPECTED_SKIPS, ...derivation.rows]), derivation };
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
        if (!expected.has(name)) {
          expected.set(name, { name, count: 0, reason: row.reason, workflow: row.workflow, job: row.job, derived: row.derived === true });
        }
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
      L.push(`    ×${e.count} ${e.name}  [${e.workflow} › ${e.job}${e.derived ? '; derived' : ''}]`);
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
export function renderRoster(roster = EXPECTED_SKIPS, derivation = null) {
  const derived = roster.filter((r) => r.derived === true).length;
  const L = [
    `check-expected-skips: ${roster.length} expected-skip name(s) — ${roster.length - derived} listed in scripts/pm/check-expected-skips.mjs, ` +
      `${derived} derived from ${derivation ? `${derivation.scanned} workflow file(s)` : 'the workflows'}`,
  ];
  for (const row of roster) {
    const detail = row.gate.outputs ? ` ${row.gate.outputs.join('|')}` : row.gate.label ? ` ${row.gate.label}` : row.gate.events ? ` ${row.gate.events.join('|')}` : '';
    L.push(`  ${row.name}  [${row.workflow} › ${row.job}; gate: ${row.gate.kind}${detail}${row.derived === true ? '; derived' : ''}]`);
    L.push(`     ${row.reason}`);
  }
  for (const r of derivation?.refused ?? []) {
    L.push(`  ⚠️  refused by the derivation — ${r.workflow}${r.job ? ` › ${r.job}` : ''}: ${r.reason}`);
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
    const { roster, derivation } = expectedSkipRoster(ROOT);
    console.log(renderRoster(roster, derivation).join('\n'));
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
  const judgement = judgeCheckRuns(payload, expectedSkipRoster(ROOT).roster);
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

function measuredPayload() {
  return { total_count: MEASURED_18315.length, check_runs: MEASURED_18315.map(([name, conclusion, suite]) => fixtureRun(name, conclusion, suite)) };
}

/**
 * Measured 2026-09-30 on PR #20748's head `a84b73af13` (a `create-objectstack`
 * landing, so `scaffold-e2e.yml` ran on `pull_request`): 42 check-runs, 34
 * success / 8 skipped, full `GET /commits/{head}/check-runs` listing. Names,
 * conclusions and check-suite ids VERBATIM. Its one skip outside the listed
 * roster is `Registry canary: ${{ matrix.template }}` (run 36658032070) —
 * the raw pre-expansion name the derived half exists to admit.
 */
const MEASURED_20748 = [
  ['Auto Label', 'success', 99276458818],
  ['Auto Label', 'skipped', 99276487096],
  ['Build Core', 'success', 99276458806],
  ['Build Docs', 'skipped', 99276458806],
  ['Check Changeset', 'skipped', 99276487096],
  ['Check Changeset', 'success', 99276458818],
  ['Check Documentation Links', 'success', 99276459150],
  ['Check PR Size', 'skipped', 99276487096],
  ['Check PR Size', 'success', 99276458818],
  ['Close issues referenced in other repositories', 'success', 99283715448],
  ['Console Pin Gate', 'skipped', 99276458806],
  ['Dogfood Regression Gate', 'success', 99276458806],
  ['Dogfood Regression Gate (1/3)', 'success', 99276458806],
  ['Dogfood Regression Gate (2/3)', 'success', 99276458806],
  ['Dogfood Regression Gate (3/3)', 'success', 99276458806],
  ['Dogfood Verify CLI', 'success', 99276458806],
  ['filter', 'success', 99276458806],
  ['Flag docs affected by code changes', 'success', 99276458808],
  ['Governed Surface Queue Guard', 'success', 99280116148],
  ['Governed Surface Queue Guard', 'success', 99276459094],
  ['Lint & Repo Gates', 'success', 99276458889],
  ['No other open PR may claim the same issue', 'success', 99276458886],
  ['No other open PR may claim the same single-writer path', 'success', 99276458829],
  ['Packed-tarball smoke (opt-in)', 'skipped', 99276487117],
  ['Packed-tarball smoke (opt-in)', 'skipped', 99276458917],
  ['Part-of PR must not also close its card', 'success', 99276458819],
  ['Registry canary: ${{ matrix.template }}', 'skipped', 99276458880],
  ['Scaffold with repo dist', 'success', 99276458880],
  ['Temporal Conformance (live PG + MySQL)', 'success', 99276458806],
  ['Test Core', 'success', 99276458806],
  ['Test Core (1/6)', 'success', 99276458806],
  ['Test Core (2/6)', 'success', 99276458806],
  ['Test Core (3/6)', 'success', 99276458806],
  ['Test Core (4/6)', 'success', 99276458806],
  ['Test Core (5/6)', 'success', 99276458806],
  ['Test Core (6/6)', 'success', 99276458806],
  ['The card this PR closes must claim this branch', 'success', 99276458997],
  ['Type Check · consumer gates', 'success', 99276458889],
  ['Type Check · debt ledger', 'success', 99276458889],
  ['Type Check · source gates', 'success', 99276458889],
  ['Type Check · workspace', 'success', 99276458889],
  ['TypeScript Type Check', 'success', 99276458889],
];

/** The measured #20748 head, plus any extra runs a control case adds. */
function measured20748Payload(extra = []) {
  const runs = [...MEASURED_20748.map(([name, conclusion, suite]) => fixtureRun(name, conclusion, suite)), ...extra];
  return { total_count: runs.length, check_runs: runs };
}

/** The raw pre-expansion name the measured #20748 head carries, spelled once. */
const CANARY_RAW_NAME = 'Registry canary: ${{ matrix.template }}';

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
  const measured = judgeCheckRuns(measuredPayload());
  t('measured head: judged (no pending run)', measured.kind, 'judged');
  t('measured head: 20 success', measured.success, 20);
  t('measured head: 19 skipped, every one expected', measured.expected.reduce((n, e) => n + e.count, 0), 19);
  t('measured head: zero unexpected skips', measured.unexpected.length, 0);
  t('measured head: eleven of eleven rostered names appear', measured.expected.length, 11);
  t('measured head: exit 0', verdictExit(measured), 0);
  t('measured head: the multiplicity is reported (Auto Label ×3)', measured.expected.find((e) => e.name === 'Auto Label')?.count, 3);
  t('measured head: the report ends on the OK verdict line', renderReport(measured, { head: 'b671f83b', repo: 'objectstack-ai/objectstack' }).at(-1).startsWith('VERDICT check-expected-skips: OK'), true);

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

  // ---- the derived half: the recogniser, one exact shape ---------------------
  const gate = (cond) => JSON.stringify(nonPrEventGate(cond));
  const BOTH = '["schedule","workflow_dispatch"]';
  t("derive: the measured canary if: reads as schedule | workflow_dispatch", gate("github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'"), BOTH);
  t('derive: …the same, wrapped whole in one ${{ }}', gate("${{ github.event_name == 'workflow_dispatch' || github.event_name == 'schedule' }}"), BOTH);
  t('derive: …the same, one term per line (a folded block scalar)', gate("github.event_name == 'schedule'\n  || github.event_name == 'workflow_dispatch'\n"), BOTH);
  t('derive: a single schedule term is admitted', gate("github.event_name == 'schedule'"), '["schedule"]');
  t('derive: a repeated term de-duplicates', gate("github.event_name == 'schedule' || github.event_name == 'schedule'"), '["schedule"]');
  t('derive: NARROWNESS — a pull_request term beside schedule is NOT admitted', gate("github.event_name == 'schedule' || github.event_name == 'pull_request'"), 'null');
  t('derive: …nor a push term (push fires on a PR branch)', gate("github.event_name == 'schedule' || github.event_name == 'push'"), 'null');
  t('derive: …nor merge_group (the queue build is a verdict, not a skip)', gate("github.event_name == 'merge_group'"), 'null');
  t("derive: …nor a negation (scaffold-local's live `!= 'schedule'` runs on every PR)", gate("github.event_name != 'schedule'"), 'null');
  t('derive: …nor an inputs conjunct (release.yml version-pr, live)', gate("github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.refresh_version_pr)"), 'null');
  t(
    'derive: …nor success() and inputs beside event terms (merged-branch-reaper.yml reap, live)',
    gate("success() && github.event_name != 'pull_request' && (github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.dry_run == false))"),
    'null',
  );
  t('derive: …nor a needs output', gate("github.event_name == 'schedule' || needs.filter.outputs.core != 'false'"), 'null');
  t('derive: …nor a matrix value', gate("github.event_name == 'schedule' || matrix.os == 'linux'"), 'null');
  t('derive: …nor a label read', gate("github.event_name == 'schedule' || contains(github.event.pull_request.labels.*.name, 'nightly')"), 'null');
  t('derive: …nor a parenthesised term (the allow-list names one bare comparison)', gate("(github.event_name == 'schedule')"), 'null');
  t("derive: …nor a case-folded event (GitHub's == folds case; the recogniser refuses rather than folds)", gate("github.event_name == 'Schedule'"), 'null');
  t('derive: …nor a double-quoted literal (not a GitHub string)', gate('github.event_name == "schedule"'), 'null');
  t('derive: …nor two ${{ }} blocks joined outside an expression', gate("${{ github.event_name == 'schedule' }} || ${{ github.event_name == 'workflow_dispatch' }}"), 'null');
  t('derive: …nor an empty or absent if:', gate('') === 'null' && gate(undefined) === 'null' && gate(true) === 'null', true);

  t('derive: a matrix name is kept verbatim, raw', skippedCheckRunName('registry-canary', { name: CANARY_RAW_NAME, strategy: { matrix: { template: ['blank'] } } }).name, CANARY_RAW_NAME);
  t('derive: a job with no name: is named by its key', skippedCheckRunName('nightly', { if: "github.event_name == 'schedule'" }).name, 'nightly');
  t('derive: a name holding a non-matrix expression is refused (its skipped spelling is unmeasured)', 'refused' in skippedCheckRunName('x', { name: 'Nightly ${{ inputs.target }}' }), true);
  t('derive: a matrix reference on a job with no strategy.matrix is refused', 'refused' in skippedCheckRunName('x', { name: 'N: ${{ matrix.os }}' }), true);
  t('derive: a non-string name: is refused', 'refused' in skippedCheckRunName('x', { name: 42 }), true);

  // A synthetic tree: every admission and every refusal the derivation claims.
  const synthetic = {
    'a.yml': {
      jobs: {
        canary: { name: 'Nightly: ${{ matrix.os }}', if: "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'", strategy: { matrix: { os: ['linux'] } } },
        mixed: { name: 'Mixed', if: "github.event_name == 'schedule' || github.event_name == 'pull_request'" },
        plain: { name: 'Plain', if: "github.event_name == 'pull_request'" },
      },
    },
    'b.yml': {
      jobs: {
        weekly: { name: 'Shared', if: "github.event_name == 'schedule'" },
        always: { name: 'Shared' },
        listed: { name: 'Build Core', if: "github.event_name == 'schedule'" },
        opaque: { name: 'Nightly ${{ inputs.target }}', if: "github.event_name == 'workflow_dispatch'" },
      },
    },
  };
  const derivedSyn = deriveNonPrEventSkips(['a.yml', 'b.yml', 'c.yml'], (f) => synthetic[f] ?? null);
  const refusedAt = (job) => derivedSyn.refused.find((r) => r.job === job)?.reason ?? '';
  t('derive: the synthetic tree admits exactly the schedule/dispatch-only matrix job', JSON.stringify(derivedSyn.rows.map((r) => `${r.workflow} › ${r.job} › ${r.name}`)), JSON.stringify(['a.yml › canary › Nightly: ${{ matrix.os }}']));
  t('derive: …as a derived row with the non-pr-event gate and its events', derivedSyn.rows[0]?.derived === true && derivedSyn.rows[0]?.gate.kind === 'non-pr-event' && JSON.stringify(derivedSyn.rows[0]?.gate.events) === BOTH, true);
  t('derive: …whose reason names the raw template', derivedSyn.rows[0]?.reason.includes('raw `name:` template'), true);
  t('derive: the mixed pull_request + schedule job is neither admitted nor refused (it is simply not this shape)', derivedSyn.rows.some((r) => r.job === 'mixed') || derivedSyn.refused.some((r) => r.job === 'mixed'), false);
  t('derive: a name two jobs carry is refused (a skip of the other would read expected)', refusedAt('weekly').includes('2 jobs in the tree carry'), true);
  t("derive: a name the listed roster carries is refused (derive, don't list)", refusedAt('listed').includes("derive, don't list"), true);
  t('derive: a name that cannot be told is refused, with the reason', refusedAt('opaque').includes('inputs.target'), true);
  t('derive: an unreadable workflow is refused by file', derivedSyn.refused.some((r) => r.workflow === 'c.yml' && r.job === null), true);
  t('derive: …and the scan counts every file handed to it', derivedSyn.scanned, 3);
  const synRoster = [...EXPECTED_SKIPS, ...derivedSyn.rows];
  t('derive: the admitted raw-named skip judges exit 0', verdictExit(judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('Nightly: ${{ matrix.os }}', 'skipped')] }, synRoster)), 0);
  t('derive: NARROWNESS — the mixed pull_request + schedule job skipped still judges exit 4', verdictExit(judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('Mixed', 'skipped')] }, synRoster)), 4);
  t('derive: …and so does the refused shared name', verdictExit(judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('Shared', 'skipped')] }, synRoster)), 4);

  // ---- the derived half on this checkout's workflows ---------------------------
  const liveFiles = listWorkflowFiles(ROOT);
  const live = expectedSkipRoster(ROOT);
  const liveKeys = live.derivation.rows.map((r) => `${r.workflow} › ${r.job}`);
  t('live derive: the workflow listing is not vacuous', liveFiles.length > 0 && live.derivation.scanned === liveFiles.length, true);
  t(`live derive: nothing refused on this tree (${live.derivation.refused.map((r) => `${r.workflow} › ${r.job}: ${r.reason}`).join(' | ') || 'none'})`, live.derivation.refused.length, 0);
  t('live derive: scaffold-e2e.yml › registry-canary is derived under its raw name', live.derivation.rows.find((r) => r.workflow === 'scaffold-e2e.yml' && r.job === 'registry-canary')?.name, CANARY_RAW_NAME);
  t(
    "live derive: the measured refusals stay out (release.yml version-pr, merged-branch-reaper.yml reap, scaffold-e2e.yml's PR-running scaffold-local)",
    ['release.yml › version-pr', 'merged-branch-reaper.yml › reap', 'scaffold-e2e.yml › scaffold-local'].some((k) => liveKeys.includes(k)),
    false,
  );
  t('live derive: the listed and derived halves share no name', live.derivation.rows.some((r) => EXPECTED_SKIPS.some((l) => l.name === r.name)), false);
  t('live derive: the joined roster is frozen and duplicate-free', Object.isFrozen(live.roster) && new Set(live.roster.map((r) => r.name)).size === live.roster.length, true);

  // ---- the measured #20748 head: the card's pins -------------------------------
  const m20748 = judgeCheckRuns(measured20748Payload(), live.roster);
  t('measured #20748: the raw-named skipped canary judges exit 0 against the joined roster', verdictExit(m20748), 0);
  t('measured #20748: 8 skipped, every one expected', m20748.expected.reduce((n, e) => n + e.count, 0) === 8 && m20748.unexpected.length === 0, true);
  t('measured #20748: …the canary read as a derived expected skip', m20748.expected.find((e) => e.name === CANARY_RAW_NAME)?.derived, true);
  t('measured #20748: …and the report tags it derived', renderReport(m20748).some((l) => l.includes(CANARY_RAW_NAME) && l.includes('; derived')), true);
  t('measured #20748: the LISTED half alone still answers exit 4 on it (the derivation is what moved it)', judgeCheckRuns(measured20748Payload()).unexpected[0]?.name, CANARY_RAW_NAME);
  const m20748Control = judgeCheckRuns(measured20748Payload([fixtureRun('TypeScript Type Check', 'skipped', 99276458889)]), live.roster);
  t('measured #20748 CONTROL: a genuinely unexpected skip beside the canary still judges exit 4', verdictExit(m20748Control), 4);
  t('measured #20748 CONTROL: …naming only it', JSON.stringify(m20748Control.unexpected.map((u) => u.name)), '["TypeScript Type Check"]');
  t(
    "measured #20748 CONTROL: the canary's PR-running sibling skipped still judges exit 4",
    verdictExit(judgeCheckRuns(measured20748Payload([fixtureRun('Scaffold with repo dist', 'skipped', 99276458880)]), live.roster)),
    4,
  );

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
    writeFileSync(okFile, JSON.stringify({ head_sha: 'b671f83b', ...measuredPayload() }));
    const ok = spawnSelf(['--check-runs-json', okFile]);
    t('cli: the measured head on disk → exit 0', ok.status, 0);
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
    t('cli: …the derived rows too, tagged derived', live.derivation.rows.length > 0 && live.derivation.rows.every((r) => roster.stdout.includes(`${r.name}  [${r.workflow} › ${r.job}; gate: non-pr-event`)), true);

    const canaryFile = join(dir, 'canary.json');
    writeFileSync(canaryFile, JSON.stringify({ head_sha: 'a84b73af13', ...measured20748Payload() }));
    const canary = spawnSelf(['--check-runs-json', canaryFile]);
    t('cli: the measured #20748 head on disk (raw-named skipped canary) → exit 0', canary.status, 0);
    t('cli: …with the canary on stdout as a derived expected skip', canary.stdout.includes(`${CANARY_RAW_NAME}  [scaffold-e2e.yml › registry-canary; derived]`), true);
    const canaryControlFile = join(dir, 'canary-control.json');
    writeFileSync(canaryControlFile, JSON.stringify(measured20748Payload([fixtureRun('Lint & Repo Gates', 'skipped', 99276458889)])));
    const canaryControl = spawnSelf(['--check-runs-json', canaryControlFile]);
    t('cli: CONTROL — the same head plus a genuinely unexpected skip → exit 4', canaryControl.status, 4);
    t('cli: …naming it under the ⛔ heading', canaryControl.stdout.includes('⛔ unexpected skips (1)') && canaryControl.stdout.includes('Lint & Repo Gates'), true);
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
      "re-gated job, a lost || 'true' widening and an unreadable workflow; the judge on the measured 39-run head and on fixtures for an " +
      'expected skip, an unexpected skip named as a filter miss, a same-suite failure read as a dependency skip, a raw matrix template, ' +
      'other conclusions, a pending run and an empty head; the derived half — the non-PR-event recogniser admitting only its one shape and ' +
      'refusing a pull_request / push / merge_group term, a negation and every live mixed if:, the raw-name rule, and the derivation ' +
      'refusing a shared, a listed and an untellable name — on a synthetic tree and on this checkout\'s workflows; the measured #20748 ' +
      'head judged 0 with its raw-named canary and 4 with a genuinely unexpected skip beside it; read classification for 422 / 404 / 401 / ' +
      '403 / 5xx / network; argv; the real CLI on payload files for 0 / 4 / 3 and --json; and the structural no-write-path, ' +
      'single-sourced transport and SKILL.md pointer pins).',
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
