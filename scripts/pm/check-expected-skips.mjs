#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-expected-skips — the enqueue bar's SKIP half, made legible: given a PR
 * head, every `skipped` check-run is either an EXPECTED skip (a name the roster
 * derived from the workflows admits, with the gate that makes the skip normal)
 * or it is reported, classified as far as the API lets a reader tell (#18308).
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
 * Check`, the ci.yml aggregates (`Test Core`, `Test UI`, `Dogfood Regression
 * Gate`), `Governed Surface Queue Guard` and the claim guards carry no gate
 * term and never skip; the day one of them reads `skipped` is a filter someone
 * added, a rename, or a dependency that failed, and exit 4 names it.
 *
 * The roster is DERIVED, never listed (#26439): `deriveGatedSkips` reads each
 * job's job-level `if:` and admits the job when one of its top-level `&&`
 * conjuncts is a GATE TERM — a `filter` output (`needs.filter.outputs.<o> !=
 * 'false'`, or a parenthesised `||` of those) whose output carries the
 * `|| 'true'` widening, a per-PR event excluded (`github.event_name !=
 * 'pull_request'` or `'merge_group'`), a pull_request action excluded, or a PR
 * label read — under the name its skipped check-run carries (the raw `name:`,
 * matrix template and all); `deriveNonPrEventSkips` admits one more shape. A
 * gated job added to or renamed in a workflow is in the roster on its first
 * run with no edit here, where a hand roster read it as exit 4 on every PR its
 * gate said no to until someone added a row (#26111 was one such row).
 *
 * It does NOT answer the DIFF question — "should this gated job have run on
 * THIS diff?" — and the boundary is deliberate. For ci.yml's `docs`, `core`
 * and `crosspkg` outputs the merge-queue build answers it (they widen to
 * `'true'` on `merge_group`); the ui outputs read the queue's own diff and the
 * scheduled run widens them; the full-battery jobs are answered by `main`'s
 * push and scheduled runs. Evaluating the `paths` filters or the expression
 * language here would be a SECOND evaluator of the platform's semantics, whose
 * failure shape is a confident, wrong "expected" — the false green this tree
 * refuses everywhere else. So the derivation is a RECOGNISER: it reads a closed
 * set of term spellings and evaluates none; a job whose `if:` reads the filter
 * in any other spelling, or whose filter output lacks the widening, is REFUSED
 * and named (`--roster`; the self-test holds the live refusal list at empty),
 * and a job carrying no gate term is never admitted: whatever made it skip,
 * its skip stays exit 4.
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
 *      404, network, refused credential), carries no check-runs at all, has a
 *      check-run that has not completed (the skip set is not final), or the
 *      roster in hand is not the base branch's (`rosterGap` below). ⛔ Never
 *      0 — "could not read" must never be legible as "every skip is expected",
 *      nor a roster older than the head's workflows as a confident ⛔ or OK.
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
 * restated). The roster is THIS repository's, and a live run judges only with
 * the base branch's own roster in hand (exit 3 otherwise), so another board —
 * whose base carries neither this file nor these workflows — is refused, never
 * judged against objectstack's roster. Reads go down a two-rung ladder: the
 * exported token first, then the header-less public read when it is refused.
 * In a proxied container node's `fetch` bypasses `HTTPS_PROXY`, so a live run
 * re-execs once with `--use-env-proxy` (imported plan, this file's own guard).
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
import { createHash } from 'node:crypto';
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

/** Conclusions that make a same-suite skip a dependency-skip suspect. */
export const FAILED_CONCLUSIONS = Object.freeze(['failure', 'cancelled', 'timed_out', 'action_required', 'stale']);

// ---------------------------------------------------------------------------
// Reading the tree the roster is derived from.
// ---------------------------------------------------------------------------

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

/** A workflow file, by name — one spelling for the local scan and the base's listing. */
const WORKFLOW_FILE = /\.ya?ml$/;

/** Every workflow file under a root, sorted; empty when the directory is absent. */
export function listWorkflowFiles(root = ROOT) {
  const dir = join(root, WORKFLOW_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => WORKFLOW_FILE.test(f))
    .sort();
}

// ---------------------------------------------------------------------------
// The roster's own freshness — is the roster in hand the base branch's?
// ---------------------------------------------------------------------------

/**
 * The roster a live run judges with is a function of exactly these files, as
 * they sit in the checkout the command runs from: THIS file (the derivation's
 * code) and every workflow file (what it derives the roster from). A
 * head's `pull_request` check-runs come from the workflows of the merge they
 * were built on — the head over its base branch's tip at that moment. So a checkout behind
 * the base reads a job rostered on the base since as an unexpected skip (exit
 * 4; measured on PR #24771's head `7a9bc58c6`, judged from `6b222464c`, one
 * merge before the `18.x upgrade harness (opt-in)` job and its row landed),
 * and a row the base has since retired as expected. Neither is a reading, so a
 * live run compares the roster in hand with the base's BEFORE it judges, and
 * answers exit 3 — naming the gap and the re-pin — when they differ.
 *
 * What is compared, and why not something cheaper (each measured 2026-10-20):
 *
 *   - BLOB IDENTITY of the roster's sources, not ancestry. A behind-count fires
 *     on every merge — 792 first-parent commits on main in the 7 days to
 *     `b1676441b`, of which 14 touched `.github/workflows` and 1 this file — so
 *     it would refuse on ~98% of merges, none of which can move the roster; and
 *     `merge-base` / `rev-list` answer green from a shallow clone's truncated
 *     history. Equal sources make an equal roster by construction, and blob ids
 *     need no history at all.
 *   - the base branch's LIVE TIP, read through the contents API — not the local
 *     `origin/<base>`, which is only as fresh as the last fetch (a checkout
 *     behind is exactly one whose fetch may be), and not the PR's `base.sha`,
 *     which does not follow the base: PR #24771 read `580fd4ed3` (04:15Z) after
 *     its head was re-pushed at 08:06Z onto a main already carrying the new
 *     job, so the stale `6b222464c` would have compared as ahead of its base.
 *   - the WORKING TREE's bytes, not HEAD's: the judge evaluates the files on
 *     disk, so a local edit to either half is a roster that is not the base's.
 *
 * Boundary: a head whose last run predates a roster change on its base is
 * judged by the newer roster. An added row costs nothing (that head's runs
 * never carried the new job); a retired row's skip reads exit 4, which is also
 * the news that the head's runs are older than its base. `--head` with no PR
 * compares with the board's default branch. The offline paths
 * (`--check-runs-json`, `--roster`) are unchanged: no network, no comparison —
 * they judge with the roster in hand, exactly as before.
 */

/** This file, repo-relative: the derivation's code, one of the roster's sources. */
export const ROSTER_SELF = 'scripts/pm/check-expected-skips.mjs';

/** At most this many gap paths are printed; the rest are counted. */
const GAP_LINES = 12;

/** git's blob id for a file's bytes — sha1 over `blob <size>`, one zero byte, then the bytes: the `sha` the contents API reports. */
export function gitBlobSha(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  return createHash('sha1').update(`blob ${buf.length}`).update(Buffer.from([0])).update(buf).digest('hex');
}

/**
 * The roster's sources in a checkout's WORKING TREE, as path → blob id: this
 * file and every workflow file the derivation scans. A source that cannot be
 * read is left out, so the gap names it rather than the comparison passing.
 */
export function localRosterSources(root = ROOT) {
  const sources = new Map();
  for (const path of [ROSTER_SELF, ...listWorkflowFiles(root).map((f) => `${WORKFLOW_DIR}/${f}`)]) {
    try {
      sources.set(path, gitBlobSha(readFileSync(join(root, path))));
    } catch {
      // left out on purpose: rosterGap reports it as absent here
    }
  }
  return sources;
}

/**
 * The roster sources that differ between the checkout and the base — pure, so
 * the behind and at-tip cases are fixtures. Empty means the two rosters are the
 * same bytes. Each entry is `differs`, `absent-here` (the base has it, this
 * checkout does not) or `here-only` (the base does not), sorted by path.
 *
 * @param {Map<string, string>} here  path → blob id, this checkout
 * @param {Map<string, string>} base  path → blob id, the base's tip
 */
export function rosterGap(here, base) {
  const gap = [];
  for (const path of [...new Set([...here.keys(), ...base.keys()])].sort()) {
    const mine = here.get(path) ?? null;
    const theirs = base.get(path) ?? null;
    if (mine === theirs) continue;
    gap.push({ path, here: mine, base: theirs, kind: mine === null ? 'absent-here' : theirs === null ? 'here-only' : 'differs' });
  }
  return gap;
}

/** The refusal's detail for a non-empty gap: each path (capped), then the re-pin. */
export function renderRosterGap(gap, { ref, root = ROOT }) {
  const short = (sha) => String(sha).slice(0, 9);
  const L = gap.slice(0, GAP_LINES).map((g) =>
    g.kind === 'absent-here'
      ? `${g.path} — on ${ref} (${short(g.base)}), absent here`
      : g.kind === 'here-only'
        ? `${g.path} — here (${short(g.here)}), absent on ${ref}`
        : `${g.path} — here ${short(g.here)}, on ${ref} ${short(g.base)}`,
  );
  if (gap.length > GAP_LINES) L.push(`…and ${gap.length - GAP_LINES} more`);
  L.push(`re-pin to ${ref}'s tip, then re-run: git -C ${root} fetch origin ${ref} && git -C ${root} checkout --detach origin/${ref}`);
  return L;
}

// ---------------------------------------------------------------------------
// The roster, DERIVED — every job read once, two `if:` shapes recognised.
// ---------------------------------------------------------------------------

/**
 * Every job in the tree, once, with the name its skipped check-run carries, and
 * how many jobs carry each name. Both derivations read this one scan, so a name
 * two jobs share is refused by either, and an unreadable workflow is refused
 * once, by file.
 *
 * @param {readonly string[]} files        workflow file names under `WORKFLOW_DIR`
 * @param {(file: string) => object|null} readWorkflow
 */
export function scanWorkflowJobs(files, readWorkflow) {
  const unreadable = [];
  const jobs = [];
  for (const workflow of files) {
    const wf = readWorkflow(workflow);
    if (!wf || typeof wf !== 'object') {
      unreadable.push({ workflow, job: null, reason: 'the workflow could not be read — none of its jobs is derived' });
      continue;
    }
    const entries = wf.jobs && typeof wf.jobs === 'object' ? Object.entries(wf.jobs) : [];
    for (const [key, job] of entries) {
      if (!job || typeof job !== 'object') continue;
      jobs.push({ workflow, wf, key, job, named: skippedCheckRunName(key, job) });
    }
  }
  const bearers = new Map();
  for (const j of jobs) {
    if (!('name' in j.named)) continue;
    bearers.set(j.named.name, (bearers.get(j.named.name) ?? 0) + 1);
  }
  return { jobs, unreadable, bearers, scanned: files.length };
}

/** The refusal a candidate earns before its gate is read, or null: an untellable or a shared name. */
function nameRefusal({ named }, bearers) {
  if (!('name' in named)) return named.refused;
  const n = bearers.get(named.name);
  return n > 1 ? `${n} jobs in the tree carry the check-run name ${JSON.stringify(named.name)} — a skip of the other would read expected` : null;
}

/**
 * The events a per-PR exclusion term may name. Both fire FOR a pull request —
 * its own runs and its queue build — so a job whose `if:` conjoins
 * `github.event_name != '<e>'` skips on every such run by construction (ci.yml's
 * full-battery jobs; THE TWO SPEEDS). ⛔ Closed on purpose: excluding `push` or
 * `schedule` says nothing about a PR head.
 */
export const PR_EVENTS = Object.freeze(['pull_request', 'merge_group']);

/** The term kinds `gateTerm` recognises, in the order a reason names them. */
export const GATE_TERM_KINDS = Object.freeze(['filter-output', 'pr-event', 'event-action', 'label']);

const FILTER_TERM = /^needs\.filter\.outputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*!=\s*'false'$/;
const PR_EVENT_TERM = /^github\.event_name\s*!=\s*'([a-z_]+)'$/;
const EVENT_ACTION_TERM = /^github\.event\.action\s*!=\s*'([a-z_]+)'$/;
const LABEL_TERM = /^(!?)contains\(\s*github\.event\.pull_request\.labels\.\*\.name\s*,\s*'([^']+)'\s*\)$/;
/** Any read of a `filter` output: a job spelling one that `gateTerm` does not read is refused, never ignored. */
const FILTER_MENTION = /\bneeds\.filter\.outputs\./;

/**
 * Split an expression at its TOP-LEVEL `op` (`&&` or `||`) — outside parentheses
 * and outside `'…'` literals (where `''` is an escaped quote) — trimming each
 * part; null when the parentheses or the quotes do not balance.
 */
export function splitTopLevel(expr, op) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i];
    if (quoted) {
      if (c === "'") {
        if (expr[i + 1] === "'") i += 1;
        else quoted = false;
      }
      continue;
    }
    if (c === "'") quoted = true;
    else if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth < 0) return null;
    } else if (depth === 0 && expr.startsWith(op, i)) {
      parts.push(expr.slice(start, i).trim());
      start = i + op.length;
      i += op.length - 1;
    }
  }
  if (depth !== 0 || quoted) return null;
  parts.push(expr.slice(start).trim());
  return parts;
}

/** The inside of `( … )` when ONE pair wraps the whole term, else null. */
function unwrapParens(term) {
  if (!term.startsWith('(') || !term.endsWith(')')) return null;
  const inner = term.slice(1, -1);
  // `(a) || (b)` also starts and ends with a parenthesis: its inside does not balance.
  return splitTopLevel(inner, '||') === null ? null : inner.trim();
}

/**
 * Read ONE top-level conjunct as a gate term, or answer null.
 *
 * ⛔ A recogniser, never an evaluator: each kind is one exact spelling, and a
 * conjunct that is none of them is not a gate however it reads.
 *
 *   filter-output  `needs.filter.outputs.<o> != 'false'`, or a parenthesised
 *                  `||` whose every term is one — false only when the filter
 *                  said `false` for every output it names
 *   pr-event       `github.event_name != '<e>'`, `<e>` in `PR_EVENTS`
 *   event-action   `github.event.action != '<a>'` — a pull_request event of
 *                  that action is its own run on the same head, and skips
 *   label          `contains(github.event.pull_request.labels.*.name, '<l>')`,
 *                  an opt-in, or its `!` negation, an opt-out
 */
export function gateTerm(conjunct) {
  const term = String(conjunct ?? '').trim();
  let m = FILTER_TERM.exec(term);
  if (m) return { kind: 'filter-output', outputs: [m[1]] };
  const inner = unwrapParens(term);
  if (inner !== null) {
    const alternatives = splitTopLevel(inner, '||') ?? [];
    const outputs = alternatives.map((a) => FILTER_TERM.exec(a)?.[1] ?? null);
    return outputs.length > 0 && outputs.every(Boolean) ? { kind: 'filter-output', outputs: [...new Set(outputs)] } : null;
  }
  m = PR_EVENT_TERM.exec(term);
  if (m) return PR_EVENTS.includes(m[1]) ? { kind: 'pr-event', events: [m[1]] } : null;
  m = EVENT_ACTION_TERM.exec(term);
  if (m) return { kind: 'event-action', actions: [m[1]] };
  m = LABEL_TERM.exec(term);
  if (m) return { kind: 'label', label: m[2], mode: m[1] ? 'opt-out' : 'opt-in' };
  return null;
}

/**
 * Read a job-level `if:` as a GATE, or answer null: its top-level `&&`
 * conjuncts (the whole optionally wrapped in one `${{ … }}`), the ones
 * `gateTerm` recognises, and a count of the rest. A conjunction is false when
 * any one conjunct is, so a single recognised term makes the skip by design;
 * the rest (`!cancelled()`, a plan job's output, …) are counted, never read.
 * `pr-event` and `event-action` terms merge (each one alone skips the job);
 * `filter-output` groups stay apart, since each group is its own reason.
 *
 * @returns {{ terms: object[], other: number }|null}
 */
export function jobGate(cond) {
  if (typeof cond !== 'string') return null;
  let expr = cond.trim();
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(expr);
  if (wrapped) expr = wrapped[1].trim();
  if (!expr || expr.includes('${{') || expr.includes('}}')) return null;
  const conjuncts = splitTopLevel(expr, '&&');
  if (conjuncts === null) return null;
  const terms = [];
  let other = 0;
  for (const c of conjuncts) {
    const t = gateTerm(c);
    if (t === null) {
      other += 1;
      continue;
    }
    const key = t.kind === 'pr-event' ? 'events' : t.kind === 'event-action' ? 'actions' : null;
    const prior = key ? terms.find((p) => p.kind === t.kind) : null;
    if (prior) prior[key] = [...new Set([...prior[key], ...t[key]])];
    else terms.push(t);
  }
  if (terms.length === 0) return null;
  terms.sort((a, b) => GATE_TERM_KINDS.indexOf(a.kind) - GATE_TERM_KINDS.indexOf(b.kind));
  return { terms, other };
}

/** True when the output's expression keeps `docs` / `core` / `crosspkg`'s `merge_group` guard: the queue build runs the job. */
function queueWidened(expr) {
  return /github\.event_name\s*!=\s*'merge_group'\s*&&/.test(expr);
}

/**
 * Why a gate's `filter` terms cannot be trusted, or null. The reason a filter
 * skip is by design is ci.yml's filter contract — the job `needs` the filter,
 * the output exists, and the output widens with `|| 'true'` wherever the paths
 * filter did not answer — so a term that breaks any half is refused, and its
 * job's skip stays exit 4.
 */
function filterTermProblem(wf, job, gate) {
  const outputs = gate.terms.filter((t) => t.kind === 'filter-output').flatMap((t) => t.outputs);
  if (outputs.length === 0) return null;
  const needs = Array.isArray(job.needs) ? job.needs : typeof job.needs === 'string' ? [job.needs] : [];
  if (!needs.includes('filter')) return "its `if:` reads the `filter` job's outputs but the job does not `needs: filter` — the outputs read empty and the gate is not the filter's";
  for (const o of outputs) {
    const expr = wf.jobs?.filter?.outputs?.[o];
    if (typeof expr !== 'string') return `its \`if:\` reads \`needs.filter.outputs.${o}\`, which the workflow's \`filter\` job does not declare`;
    if (!expr.includes("|| 'true'")) return `\`filter\` output \`${o}\` lacks the \`|| 'true'\` widening (${expr}) — where the paths filter does not answer, the job skips instead of running`;
  }
  return null;
}

const tick = (xs) => xs.map((x) => `\`${x}\``).join(' / ');

/** The reason a derived gated row carries, built from the terms the job really spells. */
function gatedReason(workflow, wf, gate, matrix) {
  const parts = gate.terms.map((t) => {
    if (t.kind === 'filter-output') {
      const read = t.outputs.filter((o) => !queueWidened(String(wf.jobs?.filter?.outputs?.[o] ?? '')));
      return (
        `gated on ${workflow}'s \`filter\` output ${tick(t.outputs)}${t.outputs.length > 1 ? ' (it skips only when every one said false)' : ''}: ` +
        'a diff outside those paths skips it on the PR head, ' +
        (read.length === 0
          ? "and the merge-queue build widens it to 'true' and runs it on the merged tree"
          : "the merge-queue build reads the same paths filter against the queue's base, and the scheduled full run widens it to 'true'")
      );
    }
    if (t.kind === 'pr-event') {
      const where = [t.events.includes('pull_request') && 'every PR head', t.events.includes('merge_group') && 'every queue build'].filter(Boolean).join(' and ');
      return `full battery only: its \`if:\` excludes ${tick(t.events)}, so it skips on ${where} and is answered by main's push and scheduled runs`;
    }
    if (t.kind === 'event-action') {
      return `its \`if:\` excludes the ${tick(t.actions)} pull_request event(s); each such event is its own run on the same head, beside the run that concluded`;
    }
    return t.mode === 'opt-out'
      ? `a PR carrying the \`${t.label}\` label skips it (the declared opt-out); every run after the label lands reads skipped`
      : `opt-in by the \`${t.label}\` label; skipped on every PR that does not carry it, once per pull_request event`;
  });
  return (
    `derived from ${workflow}'s job-level \`if:\` — ${parts.join('; ')}` +
    (gate.other > 0 ? ` (plus ${gate.other} further condition(s) the recogniser does not read)` : '') +
    (matrix ? '; skipped before its matrix expands, so the check-run carries the raw `name:` template' : '')
  );
}

/**
 * Derive the expected skips of every GATED job: each job, in every workflow
 * file, whose job-level `if:` `jobGate` reads, under the name
 * `skippedCheckRunName` gives it.
 *
 * A candidate is REFUSED — never admitted — when its name cannot be told, when
 * another job anywhere in the tree carries the same check-run name, when one of
 * its `filter` terms breaks the filter contract (`filterTermProblem`), or when
 * its `if:` reads a `filter` output in a spelling `gateTerm` does not read (a
 * new spelling must be recognised before it is trusted, never skipped past).
 * Refusal is the safe direction: the skip stays exit 4, and the self-test holds
 * the live tree's refusal list at empty, so the job's author hears about it
 * rather than a landing seat.
 *
 * @returns {{ rows: object[], refused: { workflow: string, job: string|null, reason: string }[], scanned: number }}
 */
export function deriveGatedSkips(files, readWorkflow, scan = scanWorkflowJobs(files, readWorkflow)) {
  const refused = [...scan.unreadable];
  const rows = [];
  for (const candidate of scan.jobs) {
    const { workflow, wf, key, job, named } = candidate;
    const gate = jobGate(job.if);
    if (gate === null) {
      if (FILTER_MENTION.test(typeof job.if === 'string' ? job.if : '')) {
        refused.push({ workflow, job: key, reason: "its `if:` reads a `filter` output in a spelling the recogniser does not read — spell it `needs.filter.outputs.<o> != 'false'` (or a parenthesised `||` of those) as a top-level `&&` conjunct, or teach `gateTerm` the new spelling" });
      }
      continue;
    }
    const problem = nameRefusal(candidate, scan.bearers) ?? filterTermProblem(wf, job, gate);
    if (problem) {
      refused.push({ workflow, job: key, reason: problem });
      continue;
    }
    rows.push(
      Object.freeze({
        name: named.name,
        workflow,
        job: key,
        gate: Object.freeze({ kind: 'job-gate', terms: Object.freeze(gate.terms.map((t) => Object.freeze(t))), other: gate.other }),
        derived: true,
        reason: gatedReason(workflow, wf, gate, job.strategy?.matrix !== undefined),
      }),
    );
  }
  return { rows, refused, scanned: scan.scanned };
}

// ---------------------------------------------------------------------------
// The second shape — a job selected ONLY by non-PR events.
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
 * (`success()` and `inputs.dry_run` beside its event terms) — the second is
 * admitted by `jobGate` instead, for its top-level `!= 'pull_request'`.
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
 * gated matrix jobs). Only an expanded job's check-runs carry expanded
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
 * Derive the expected skips of every job SELECTED only by non-PR events: each
 * job, in every workflow file, whose job-level `if:` `nonPrEventGate` admits,
 * under the name `skippedCheckRunName` gives it. The same name refusals as
 * `deriveGatedSkips` apply (an untellable name, or one two jobs carry), off the
 * same scan; a workflow that cannot be read derives nothing.
 *
 * @param {readonly string[]} files        workflow file names under `WORKFLOW_DIR`
 * @param {(file: string) => object|null} readWorkflow
 * @returns {{ rows: object[], refused: { workflow: string, job: string|null, reason: string }[], scanned: number }}
 */
export function deriveNonPrEventSkips(files, readWorkflow, scan = scanWorkflowJobs(files, readWorkflow)) {
  const refused = [...scan.unreadable];
  const rows = [];
  for (const candidate of scan.jobs) {
    const { workflow, key, job, named } = candidate;
    const events = nonPrEventGate(job.if);
    if (events === null) continue;
    const problem = nameRefusal(candidate, scan.bearers);
    if (problem) {
      refused.push({ workflow, job: key, reason: problem });
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
  return { rows, refused, scanned: scan.scanned };
}

/**
 * The roster a tree yields: the gated rows, then the non-PR-event rows, off
 * one scan. The two shapes cannot both admit a job (a non-PR-event `if:` is one
 * disjunction, which `jobGate` never reads as a term), and a name two jobs
 * carry is refused by both, so the joined roster is one row per name. The
 * derivation travels beside it for the report; an unreadable workflow is
 * refused once.
 */
export function rosterFromTree(files, readWorkflow) {
  const scan = scanWorkflowJobs(files, readWorkflow);
  const gated = deriveGatedSkips(files, readWorkflow, scan);
  const nonPr = deriveNonPrEventSkips(files, readWorkflow, scan);
  const derivation = {
    rows: [...gated.rows, ...nonPr.rows],
    refused: [...gated.refused, ...nonPr.refused.filter((r) => r.job !== null)],
    scanned: scan.scanned,
    gated,
    nonPr,
  };
  return { roster: Object.freeze([...derivation.rows]), derivation };
}

/** The roster the live judge reads: the one the workflows under `root` yield. */
export function expectedSkipRoster(root = ROOT) {
  return rosterFromTree(listWorkflowFiles(root), workflowReader(root));
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
      'a job-level condition did not select this head, on a name the roster does not expect to skip — a filter miss, a gate the derivation does not read, or a rename; if the skip is by design, spell its gate as a term the derivation reads (`--roster` names every refusal)',
  };
}

/**
 * Judge one head's check-runs payload against the roster.
 *
 * @param {object} payload   the REST `check-runs` listing ({ total_count, check_runs })
 * @param {readonly object[]} roster  the derived roster (`expectedSkipRoster` / `rosterFromTree`)
 * @returns {object} a judgement; `kind` is `judged`, `pending`, `empty` or `unreadable`
 */
export function judgeCheckRuns(payload, roster) {
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
  return {
    verdict: read.verdict,
    value: { sha: pr.head.sha, base: typeof pr.base?.ref === 'string' ? pr.base.ref : null, state: pr.state, draft: pr.draft === true, merged: pr.merged_at ?? null },
  };
}

/** The board's default branch — the base a bare `--head` is compared with. */
async function resolveDefaultBranch(repo) {
  const read = await guarded(() => rest(`/repos/${repo}`));
  if (read.verdict.kind !== 'ok') return read;
  const ref = read.value?.default_branch;
  if (typeof ref !== 'string' || !ref) return { verdict: { kind: 'not-a-repo', headline: `/repos/${repo} answered without a default branch` } };
  return { verdict: read.verdict, value: ref };
}

/**
 * The base's roster sources at its LIVE tip, as path → blob id — two directory
 * listings through the contents API: no checkout, no history, no fetch.
 */
export async function readBaseRosterSources(repo, ref) {
  const sources = new Map();
  for (const dir of [ROSTER_SELF.slice(0, ROSTER_SELF.lastIndexOf('/')), WORKFLOW_DIR]) {
    const read = await guarded(() => rest(`/repos/${repo}/contents/${dir}?ref=${encodeURIComponent(ref)}`));
    if (read.verdict.kind === 'not-found') return { verdict: { kind: 'not-found', headline: `HTTP 404 on ${dir} at ${ref} — the base carries no such directory, or there is no such ref` } };
    if (read.verdict.kind !== 'ok') return { verdict: { kind: read.verdict.kind, headline: `${dir} at ${ref}: ${read.verdict.headline}` } };
    if (!Array.isArray(read.value)) return { verdict: { kind: 'not-a-listing', headline: `${dir} at ${ref} answered without a directory listing` } };
    for (const entry of read.value) {
      if (entry?.type !== 'file' || typeof entry.path !== 'string' || typeof entry.sha !== 'string') continue;
      if (dir === WORKFLOW_DIR ? WORKFLOW_FILE.test(entry.path) : entry.path === ROSTER_SELF) sources.set(entry.path, entry.sha);
    }
  }
  return { verdict: classifyRead(), value: sources };
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
  // A live verdict names whose roster judged it; the offline line is unchanged.
  const roster = meta.rosterRef ? `${meta.rosterRef}'s roster` : 'the roster';
  L.push(
    exit === EXIT_OK
      ? `VERDICT check-expected-skips: OK — ${skipped} skipped check-run(s), every one in ${roster} (exit ${EXIT_OK})`
      : `VERDICT check-expected-skips: ⛔ ${judgement.unexpected.length} skipped check-run(s) outside ${roster} (exit ${EXIT_UNEXPECTED_SKIP})`,
  );
  return L;
}

/** A gate's terms in one short spelling: `filter core|crosspkg + pr-event pull_request|merge_group`. */
export function gateTermsSpelling(terms) {
  return terms
    .map((t) =>
      t.kind === 'filter-output'
        ? `filter ${t.outputs.join('|')}`
        : t.kind === 'pr-event'
          ? `pr-event ${t.events.join('|')}`
          : t.kind === 'event-action'
            ? `event-action ${t.actions.join('|')}`
            : `label ${t.mode} ${t.label}`,
    )
    .join(' + ');
}

/** The roster, rendered for a seat that wants to read it without a network. */
export function renderRoster(roster, derivation = null) {
  const nonPr = roster.filter((r) => r.gate.kind === 'non-pr-event').length;
  const L = [
    `check-expected-skips: ${roster.length} expected-skip name(s), every one derived from ${derivation ? `${derivation.scanned} workflow file(s)` : 'the workflows'} — ` +
      `${roster.length - nonPr} by a job-level gate term, ${nonPr} by a non-PR-event-only \`if:\`; none listed by hand`,
  ];
  for (const row of roster) {
    const detail = row.gate.terms ? ` ${gateTermsSpelling(row.gate.terms)}` : row.gate.events ? ` ${row.gate.events.join('|')}` : '';
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
  "  exit 3  NOT MEASURED — unreadable head, no check-runs, a check-run still running, or a roster that is not the base branch's",
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
    console.error(`board: ${sweep.repo} (${sweep.source}${sweep.source === 'default' ? `, ${DEFAULT_SWEEP_REPO}` : ''}); roster: this checkout's, compared with the base branch's tip before judging.`);
    let sha = opts.head;
    let base = null;
    if (opts.pr !== null) {
      const resolved = await resolvePrHead(opts.pr, sweep.repo);
      if (resolved.verdict.kind !== 'ok') return reportNotMeasured(`PR #${opts.pr}: ${resolved.verdict.headline}`, [readPathLine()]);
      sha = resolved.value.sha;
      base = resolved.value.base;
      meta.pr = { number: Number(opts.pr), state: resolved.value.state, draft: resolved.value.draft, merged: resolved.value.merged };
      if (!base) return reportNotMeasured(`PR #${opts.pr} answered without a base branch — the roster in hand cannot be compared with one`, [readPathLine()]);
    } else {
      const branch = await resolveDefaultBranch(sweep.repo);
      if (branch.verdict.kind !== 'ok') return reportNotMeasured(`the default branch of ${sweep.repo}: ${branch.verdict.headline}`, [readPathLine()]);
      base = branch.value;
    }
    // The roster in hand must BE the base's before it judges anything (see rosterGap).
    const baseSources = await readBaseRosterSources(sweep.repo, base);
    if (baseSources.verdict.kind !== 'ok') {
      return reportNotMeasured(`the roster in hand cannot be shown to be ${base}'s — ${baseSources.verdict.headline}`, [readPathLine()]);
    }
    const here = localRosterSources(ROOT);
    const gap = rosterGap(here, baseSources.value);
    if (gap.length > 0) {
      return reportNotMeasured(
        `the roster in hand is not ${sweep.repo}@${base}'s: ${gap.length} of its source file(s) differ from that branch's tip. ` +
          "A stale roster turns a newly rostered skip into a false ⛔ and a retired row's skip into a false OK, so it judges this head neither way",
        [...renderRosterGap(gap, { ref: base }), readPathLine()],
      );
    }
    meta.rosterRef = base;
    console.error(`roster: identical to ${sweep.repo}@${base}'s tip — this file and ${here.size - 1} workflow file(s), by blob id (no history read).`);
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
 * The FIXTURE TREE the measured heads below are judged against: the gated jobs
 * those heads were built from, with the `if:` spellings this repository's
 * workflows carry, frozen here so the measured heads judge the DERIVATION and
 * never this checkout's job names — a gated job renamed in a live workflow
 * moves no case in this file. The sentinel jobs (`Lint & Repo Gates`, the
 * aggregates) are in it so that "never admitted" is a claim about real shapes.
 */
const FILTER_WIDENED = (o) => `\${{ github.event_name != 'merge_group' && steps.changes.outputs.${o} || 'true' }}`;
const CORE_IF = "${{ !cancelled() && needs.filter.outputs.core != 'false' }}";
const FULL_BATTERY_IF = "${{ !cancelled() && needs.filter.outputs.core != 'false' && github.event_name != 'pull_request' && github.event_name != 'merge_group' }}";
const EVENT_ACTION_IF = "github.event.action != 'labeled' && github.event.action != 'unlabeled' && github.event.action != 'edited'";
const optInIf = (label) => `contains(github.event.pull_request.labels.*.name, '${label}') && (github.event.action != 'labeled' || github.event.label.name == '${label}')`;
const FIXTURE_TREE = Object.freeze({
  'ci.yml': {
    jobs: {
      filter: {
        outputs: {
          docs: FILTER_WIDENED('docs'),
          core: FILTER_WIDENED('core'),
          crosspkg: FILTER_WIDENED('crosspkg'),
          ui: "${{ steps.changes.outputs.ui || 'true' }}",
          ui_consumers: "${{ steps.changes.outputs.ui_consumers || 'true' }}",
          ui_tree: "${{ steps.ui-tree.outputs.present || 'true' }}",
        },
      },
      test: {
        name: 'Test Core (${{ matrix.shard }}/6)',
        needs: 'filter',
        if: "${{ !cancelled() && (needs.filter.outputs.core != 'false' || needs.filter.outputs.crosspkg != 'false') }}",
        strategy: { matrix: { shard: [1, 2, 3, 4, 5, 6] } },
      },
      'test-gate': { name: 'Test Core', needs: ['test', 'filter'], if: 'always()' },
      'temporal-conformance': { name: 'Temporal Conformance (live PG + MySQL)', needs: 'filter', if: FULL_BATTERY_IF },
      dogfood: { name: 'Dogfood Regression Gate (${{ matrix.shard }}/3)', needs: 'filter', if: FULL_BATTERY_IF, strategy: { matrix: { shard: [1, 2, 3] } } },
      'dogfood-verify': { name: 'Dogfood Verify CLI', needs: 'filter', if: FULL_BATTERY_IF },
      'dogfood-gate': { name: 'Dogfood Regression Gate', needs: ['dogfood', 'dogfood-verify', 'filter'], if: 'always()' },
      'build-core': { name: 'Build Core', needs: 'filter', if: CORE_IF },
      'build-docs': { name: 'Build Docs', needs: 'filter', if: "${{ !cancelled() && needs.filter.outputs.docs != 'false' }}" },
      'ui-deps': {
        name: 'Build UI Deps',
        needs: 'filter',
        if: "${{ !cancelled() && needs.filter.outputs.ui_tree != 'false' && (needs.filter.outputs.ui != 'false' || needs.filter.outputs.ui_consumers != 'false') }}",
      },
    },
  },
  'lint.yml': { jobs: { lint: { name: 'Lint & Repo Gates', if: 'always()' }, typecheck: { name: 'TypeScript Type Check', if: 'always()' } } },
  'governed-surface-guard.yml': { jobs: { 'governed-surface-guard': { name: 'Governed Surface Queue Guard' } } },
  'pr-automation.yml': {
    jobs: {
      'pr-size': { name: 'Check PR Size', if: EVENT_ACTION_IF },
      'auto-label': { name: 'Auto Label', needs: 'pr-size', if: `!cancelled() && ${EVENT_ACTION_IF}` },
      'changeset-check': {
        name: 'Check Changeset',
        if: "!contains(github.event.pull_request.labels.*.name, 'skip-changeset') && !(github.head_ref == 'changeset-release/main' && github.event.pull_request.user.login == 'github-actions[bot]')",
      },
    },
  },
  'pack-smoke-optin.yml': { jobs: { 'pack-smoke': { name: 'Packed-tarball smoke (opt-in)', if: optInIf('needs:pack-smoke') } } },
  'upgrade-harness-optin.yml': { jobs: { 'upgrade-harness': { name: '18.x upgrade harness (opt-in)', if: optInIf('needs:upgrade-harness') } } },
  'scaffold-e2e.yml': {
    jobs: {
      'scaffold-local': { name: 'Scaffold with repo dist', if: "github.event_name != 'schedule'" },
      'registry-canary': {
        name: 'Registry canary: ${{ matrix.template }}',
        if: "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
        strategy: { matrix: { template: ['blank'] } },
      },
    },
  },
});

/** A copy of the fixture tree, mutated: a reader and the file list for `rosterFromTree`. */
function fixtureTree(mutate = () => {}) {
  const doc = JSON.parse(JSON.stringify(FIXTURE_TREE));
  mutate(doc);
  return { files: Object.keys(doc).sort(), read: (f) => doc[f] ?? null };
}

/** The roster a (mutated) fixture tree derives. */
function fixtureRoster(mutate) {
  const tree = fixtureTree(mutate);
  return rosterFromTree(tree.files, tree.read);
}

/** One skipped run of `name` beside a success, judged against a roster: the exit it earns. */
function skipExit(name, roster) {
  return verdictExit(judgeCheckRuns({ total_count: 2, check_runs: [fixtureRun('filter', 'success', 1), fixtureRun(name, 'skipped', 1)] }, roster));
}

/**
 * Measured 2026-09-16 on PR #18315's head `b671f83b` (the AGENTS.md-only
 * landing): 39 check-runs, 20 success / 19 skipped, four `PR Automation` runs
 * on one head. Names, conclusions and check-suite ids VERBATIM from the
 * listing — the `/6` of the Test Core template included, since the fixture
 * tree it is judged against is frozen with it — but for one run left out,
 * `Console Pin Gate` (skipped, suite 94769267631), whose job retired with the
 * objectui pin (#25697), so 18 skipped remain. This is the real shape the
 * derivation must accept.
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
 * conclusions and check-suite ids VERBATIM but for one run left out,
 * `Console Pin Gate` (skipped, suite 99276458806), whose job retired with the
 * objectui pin (#25697), so 7 skipped remain. One of them is
 * `Registry canary: ${{ matrix.template }}` (run 36658032070) — the raw
 * pre-expansion name the non-PR-event shape exists to admit.
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

  // ---- exit register -------------------------------------------------------
  t('exit register: OK is 0', EXIT_OK, 0);
  t('exit register: an unexpected skip is 4, distinct from NOT MEASURED', EXIT_UNEXPECTED_SKIP === 4 && EXIT_UNEXPECTED_SKIP !== EXIT_PREREQUISITE_NOT_MET, true);
  t('exit register: NOT MEASURED is the repo-wide 3, imported not redeclared', EXIT_PREREQUISITE_NOT_MET, 3);
  t('exit register: the five codes are distinct', new Set([EXIT_OK, EXIT_SELF_TEST_FAILED, EXIT_UNCLASSIFIED, EXIT_PREREQUISITE_NOT_MET, EXIT_UNEXPECTED_SKIP]).size, 5);

  // ---- the gate recogniser: closed spellings, read, never evaluated ----------
  const split = (expr, op) => JSON.stringify(splitTopLevel(expr, op));
  t('split: top-level && only, parentheses and literals kept whole', split("a && (b && c) && 'x && y'", '&&'), JSON.stringify(['a', '(b && c)', "'x && y'"]));
  t("split: an escaped '' quote stays inside its literal", split("'it''s && x' && b", '&&'), JSON.stringify(["'it''s && x'", 'b']));
  t('split: unbalanced parentheses answer null', split('(a && b', '&&') === 'null' && split('a) && (b', '&&') === 'null', true);
  t('split: an unclosed literal answers null', split("'a && b", '&&'), 'null');
  const term = (c) => JSON.stringify(gateTerm(c));
  t('term: a filter output', term("needs.filter.outputs.core != 'false'"), JSON.stringify({ kind: 'filter-output', outputs: ['core'] }));
  t('term: a parenthesised || of filter outputs is ONE group', term("(needs.filter.outputs.core != 'false' || needs.filter.outputs.crosspkg != 'false')"), JSON.stringify({ kind: 'filter-output', outputs: ['core', 'crosspkg'] }));
  t('term: NARROWNESS — a group with one non-filter alternative is no gate', term("(needs.filter.outputs.core != 'false' || github.event_name == 'push')"), 'null');
  t("term: …nor another comparison of a filter output (== 'true' reads differently on an empty output)", term("needs.filter.outputs.core == 'true'"), 'null');
  t('term: …nor (a) || (b), whose outer parentheses do not wrap one group', term("(needs.filter.outputs.a != 'false') || (needs.filter.outputs.b != 'false')"), 'null');
  t('term: a per-PR event excluded (pull_request)', term("github.event_name != 'pull_request'"), JSON.stringify({ kind: 'pr-event', events: ['pull_request'] }));
  t('term: …and merge_group', gateTerm("github.event_name != 'merge_group'")?.kind, 'pr-event');
  t('term: NARROWNESS — excluding push or schedule says nothing about a PR head', term("github.event_name != 'push'") === 'null' && term("github.event_name != 'schedule'") === 'null', true);
  t('term: …nor does selecting pull_request', term("github.event_name == 'pull_request'"), 'null');
  t('term: a pull_request action excluded', term("github.event.action != 'labeled'"), JSON.stringify({ kind: 'event-action', actions: ['labeled'] }));
  t('term: a label read is an opt-in', term("contains(github.event.pull_request.labels.*.name, 'needs:pack-smoke')"), JSON.stringify({ kind: 'label', label: 'needs:pack-smoke', mode: 'opt-in' }));
  t('term: …and its negation an opt-out', gateTerm("!contains(github.event.pull_request.labels.*.name, 'skip-changeset')")?.mode, 'opt-out');
  t('term: …but a double-quoted label is not a GitHub string', term('contains(github.event.pull_request.labels.*.name, "x")'), 'null');
  t('term: status functions are never gates', term('!cancelled()') === 'null' && term('always()') === 'null' && term('success()') === 'null', true);
  const jg = (c) => jobGate(c);
  const uiDeps = jg(FIXTURE_TREE['ci.yml'].jobs['ui-deps'].if);
  t('jobGate: the ui-deps shape is two filter groups beside one unread conjunct', JSON.stringify(uiDeps), JSON.stringify({ terms: [{ kind: 'filter-output', outputs: ['ui_tree'] }, { kind: 'filter-output', outputs: ['ui', 'ui_consumers'] }], other: 1 }));
  t('jobGate: the full-battery shape merges its two event exclusions', JSON.stringify(jg(FULL_BATTERY_IF)?.terms.find((x) => x.kind === 'pr-event')?.events), JSON.stringify(['pull_request', 'merge_group']));
  t('jobGate: the pr-automation shape merges three action exclusions into one term', JSON.stringify(jg(EVENT_ACTION_IF)?.terms), JSON.stringify([{ kind: 'event-action', actions: ['labeled', 'unlabeled', 'edited'] }]));
  t('jobGate: a folded, multi-line if: reads the same', jg("!cancelled() &&\n  needs.filter.outputs.core != 'false'\n")?.terms[0]?.kind, 'filter-output');
  t('jobGate: NARROWNESS — a filter term inside a top-level || is no gate', jg("needs.filter.outputs.core != 'false' || github.event_name == 'push'"), null);
  t('jobGate: …nor always(), an absent if:, a non-string, or two ${{ }} blocks', [jg('always()'), jg(undefined), jg(true), jg("${{ needs.filter.outputs.a != 'false' }} && ${{ needs.filter.outputs.b != 'false' }}")].every((x) => x === null), true);
  t('jobGate: …nor an if: whose parentheses do not balance', jg("!cancelled() && (needs.filter.outputs.core != 'false'"), null);
  t('spelling: a gate renders in one short line', gateTermsSpelling(jg(FULL_BATTERY_IF).terms), 'filter core + pr-event pull_request|merge_group');

  // ---- the derivation, on the frozen fixture tree ----------------------------
  const fx = fixtureRoster();
  const fxNames = fx.roster.map((r) => r.name);
  t('fixture tree: nothing refused', JSON.stringify(fx.derivation.refused), '[]');
  t(
    'fixture tree: admits exactly its gated and non-PR-event jobs',
    JSON.stringify([...fxNames].sort()),
    JSON.stringify(
      [
        'Test Core (${{ matrix.shard }}/6)', 'Temporal Conformance (live PG + MySQL)', 'Dogfood Regression Gate (${{ matrix.shard }}/3)', 'Dogfood Verify CLI',
        'Build Core', 'Build Docs', 'Build UI Deps', 'Check PR Size', 'Auto Label', 'Check Changeset', 'Packed-tarball smoke (opt-in)', '18.x upgrade harness (opt-in)', CANARY_RAW_NAME,
      ].sort(),
    ),
  );
  t('fixture tree: a never-skipping required context is NOT admitted (Lint & Repo Gates, TypeScript Type Check)', fxNames.includes('Lint & Repo Gates') || fxNames.includes('TypeScript Type Check'), false);
  t('fixture tree: …nor the aggregates, which run if: always()', fxNames.includes('Test Core') || fxNames.includes('Dogfood Regression Gate'), false);
  t('fixture tree: …nor the queue guard (no if: at all)', fxNames.includes('Governed Surface Queue Guard'), false);
  t("fixture tree: …nor scaffold-local, whose `!= 'schedule'` runs on every PR", fxNames.includes('Scaffold with repo dist'), false);
  t('fixture tree: the raw matrix templates are the names, as the API reports a pre-expansion skip', fxNames.filter((n) => n.includes('${{ matrix.')).length, 3);
  t('fixture tree: every row is derived and frozen, the roster too', fx.roster.every((r) => r.derived === true && Object.isFrozen(r)) && Object.isFrozen(fx.roster), true);
  const fxRow = (name) => fx.roster.find((r) => r.name === name);
  t("reason: a queue-widened output says the merge-queue build runs it", fxRow('Build Core')?.reason.includes("merge-queue build widens it to 'true'"), true);
  t("reason: a ui output says the queue reads its own diff", fxRow('Build UI Deps')?.reason.includes("against the queue's base"), true);
  t('reason: a full-battery job says so', fxRow('Dogfood Verify CLI')?.reason.includes('full battery only'), true);
  t('reason: an opt-out label names its label', fxRow('Check Changeset')?.reason.includes('`skip-changeset` label skips it'), true);
  t('reason: a matrix job names its raw template', fxRow('Test Core (${{ matrix.shard }}/6)')?.reason.includes('raw `name:` template'), true);
  t('reason: unread conjuncts are counted, never hidden', fxRow('Build UI Deps')?.reason.includes('1 further condition(s)'), true);

  // The acceptance, on the fixture tree: a gated job added or renamed needs no
  // edit here, and every way a skip can stop being by design still reds.
  const NEW_GATED = 'Brand New Gated Job';
  const added = fixtureRoster((d) => (d['ci.yml'].jobs['brand-new'] = { name: NEW_GATED, needs: 'filter', if: CORE_IF })).roster;
  t('ADD (the #26111 shape): a new gated job is in the roster on its first skip, nothing listed', skipExit(NEW_GATED, added), EXIT_OK);
  t('ADD: …where the tree without it reads the same skip as ⛔', skipExit(NEW_GATED, fx.roster), EXIT_UNEXPECTED_SKIP);
  const renamed = fixtureRoster((d) => (d['ci.yml'].jobs['build-docs'].name = 'Build Docs Site')).roster;
  t('RENAME: the new name is expected', skipExit('Build Docs Site', renamed), EXIT_OK);
  t('RENAME: …and the old name, skipped, reds (the rename is the news)', skipExit('Build Docs', renamed), EXIT_UNEXPECTED_SKIP);
  t("DELETE: a deleted job's name reds", skipExit('Build Core', fixtureRoster((d) => delete d['ci.yml'].jobs['build-core']).roster), EXIT_UNEXPECTED_SKIP);
  t('UN-GATE: a job that lost its if: reds when it skips (a required job silently not run)', skipExit('Build Core', fixtureRoster((d) => delete d['ci.yml'].jobs['build-core'].if).roster), EXIT_UNEXPECTED_SKIP);
  t('UN-GATE: …as does a job whose if: became always()', skipExit('Build Core', fixtureRoster((d) => (d['ci.yml'].jobs['build-core'].if = 'always()')).roster), EXIT_UNEXPECTED_SKIP);
  t('UN-GATE: …and an ungated job added to ci.yml reds when it skips', skipExit('Brand New Required Job', fixtureRoster((d) => (d['ci.yml'].jobs['brand-new'] = { name: 'Brand New Required Job', needs: 'filter' })).roster), EXIT_UNEXPECTED_SKIP);
  t('RE-GATE: a job re-gated onto another output stays expected, its reason naming the new one', fixtureRoster((d) => (d['ci.yml'].jobs['build-core'].if = "${{ needs.filter.outputs.docs != 'false' }}")).roster.find((r) => r.name === 'Build Core')?.reason.includes('`docs`'), true);
  const unwidened = fixtureRoster((d) => (d['ci.yml'].jobs.filter.outputs.core = '${{ steps.changes.outputs.core }}'));
  t("CONTRACT: an output that lost its || 'true' widening refuses its jobs", unwidened.derivation.refused.filter((r) => r.reason.includes("|| 'true'")).length, 5);
  t('CONTRACT: …and their skips red', skipExit('Build Core', unwidened.roster), EXIT_UNEXPECTED_SKIP);
  const undeclared = fixtureRoster((d) => (d['ci.yml'].jobs['build-core'].if = "${{ needs.filter.outputs.kernel != 'false' }}"));
  t('CONTRACT: an output the filter does not declare is refused', undeclared.derivation.refused.some((r) => r.job === 'build-core' && r.reason.includes('does not declare')) && skipExit('Build Core', undeclared.roster) === EXIT_UNEXPECTED_SKIP, true);
  const noNeeds = fixtureRoster((d) => delete d['ci.yml'].jobs['build-core'].needs);
  t('CONTRACT: a job reading the filter without needs: filter is refused', noNeeds.derivation.refused.some((r) => r.job === 'build-core' && r.reason.includes('needs: filter')) && skipExit('Build Core', noNeeds.roster) === EXIT_UNEXPECTED_SKIP, true);
  const respelled = fixtureRoster((d) => (d['ci.yml'].jobs['build-core'].if = "${{ needs.filter.outputs.core == 'true' }}"));
  t('LOUD: a filter read in a spelling the recogniser does not read is refused and named, never ignored', respelled.derivation.refused.some((r) => r.job === 'build-core' && r.reason.includes('does not read')) && skipExit('Build Core', respelled.roster) === EXIT_UNEXPECTED_SKIP, true);
  const shared = fixtureRoster((d) => (d['lint.yml'].jobs['also-build-core'] = { name: 'Build Core' }));
  t('NAMES: a gated name a second job carries is refused (a skip of the other would read expected)', shared.derivation.refused.some((r) => r.job === 'build-core' && r.reason.includes('2 jobs in the tree carry')) && skipExit('Build Core', shared.roster) === EXIT_UNEXPECTED_SKIP, true);
  const untellable = fixtureRoster((d) => (d['ci.yml'].jobs['build-core'].name = 'Build ${{ inputs.target }}'));
  t('NAMES: a gated job whose name cannot be told is refused', untellable.derivation.refused.some((r) => r.job === 'build-core' && r.reason.includes('inputs.target')), true);
  const tree = fixtureTree();
  const withUnreadable = rosterFromTree([...tree.files, 'broken.yml'], tree.read);
  t('FILES: an unreadable workflow is refused once, by file, and derives nothing', withUnreadable.derivation.refused.filter((r) => r.workflow === 'broken.yml').length === 1 && withUnreadable.derivation.scanned === tree.files.length + 1, true);

  // ---- the judge -------------------------------------------------------------
  const measured = judgeCheckRuns(measuredPayload(), fx.roster);
  t('measured head: judged (no pending run)', measured.kind, 'judged');
  t('measured head: 20 success', measured.success, 20);
  t('measured head: 18 skipped, every one expected', measured.expected.reduce((n, e) => n + e.count, 0), 18);
  t('measured head: zero unexpected skips', measured.unexpected.length, 0);
  t('measured head: ten names appear, every one derived', measured.expected.length === 10 && measured.expected.every((e) => e.derived), true);
  t('measured head: exit 0', verdictExit(measured), 0);
  t('measured head: the multiplicity is reported (Auto Label ×3)', measured.expected.find((e) => e.name === 'Auto Label')?.count, 3);
  t('measured head: the report ends on the OK verdict line', renderReport(measured, { head: 'b671f83b', repo: 'objectstack-ai/objectstack' }).at(-1).startsWith('VERDICT check-expected-skips: OK'), true);

  const oneExpected = judgeCheckRuns({ total_count: 2, check_runs: [fixtureRun('Lint & Repo Gates', 'success'), fixtureRun('Build Core', 'skipped')] }, fx.roster);
  t('fixture: one expected skip → exit 0', verdictExit(oneExpected), 0);
  t('fixture: …and the reason travels with it', oneExpected.expected[0].reason.includes('merge-queue build'), true);

  const oneUnexpected = judgeCheckRuns({ total_count: 2, check_runs: [fixtureRun('Build Core', 'skipped'), fixtureRun('Lint & Repo Gates', 'skipped')] }, fx.roster);
  t('fixture: a skip outside the roster → exit 4', verdictExit(oneUnexpected), 4);
  t('fixture: …naming it', oneUnexpected.unexpected[0]?.name, 'Lint & Repo Gates');
  t('fixture: …classified as a filter miss when its suite holds no failure', oneUnexpected.unexpected[0]?.classification.kind, 'filter-miss');
  t('fixture: …and the report names it under the ⛔ heading', renderReport(oneUnexpected).some((l) => l.includes('unexpected skips (1)')), true);
  t('fixture: …ending on the exit-4 verdict line', renderReport(oneUnexpected).at(-1).includes('(exit 4)'), true);
  t('fixture: the expected skip beside it is still counted', oneUnexpected.expected.length, 1);

  const depSkip = judgeCheckRuns(
    { total_count: 3, check_runs: [fixtureRun('filter', 'failure', 7), fixtureRun('Some New Lane', 'skipped', 7), fixtureRun('Lint & Repo Gates', 'success', 8)] },
    fx.roster,
  );
  t('fixture: a skip beside a same-suite failure → exit 4 (the failure is the finding)', verdictExit(depSkip), 4);
  t('fixture: …classified as a dependency skip', depSkip.unexpected[0]?.classification.kind, 'dependency-skip');
  t('fixture: …naming the failed run', depSkip.unexpected[0]?.classification.detail.includes('`filter`=failure'), true);
  t('fixture: …and the failure itself is listed under other conclusions', depSkip.other[0]?.conclusion, 'failure');
  t('fixture: a failure in ANOTHER suite does not make the skip a dependency skip', judgeCheckRuns({ total_count: 2, check_runs: [fixtureRun('filter', 'failure', 1), fixtureRun('Some New Lane', 'skipped', 2)] }, fx.roster).unexpected[0]?.classification.kind, 'filter-miss');

  const matrixMiss = judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('Nightly tiers (${{ matrix.shard }}/2)', 'skipped')] }, fx.roster);
  t('fixture: a raw matrix template outside the roster → exit 4', verdictExit(matrixMiss), 4);
  t('fixture: …read as skipped before matrix expansion', matrixMiss.unexpected[0]?.classification.detail.includes('before matrix expansion'), true);

  t('fixture: a rostered name that SUCCEEDED is not a skip', judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('Build Core', 'success')] }, fx.roster).expected.length, 0);
  t('fixture: other conclusions do not move the skip verdict (failure beside all-expected skips → 0)', verdictExit(judgeCheckRuns({ total_count: 2, check_runs: [fixtureRun('Build Core', 'skipped', 1), fixtureRun('Lint & Repo Gates', 'failure', 2)] }, fx.roster)), 0);
  t('fixture: …but they are printed loudly', renderReport(judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('Lint & Repo Gates', 'failure')] }, fx.roster)).some((l) => l.includes('other conclusions (1)')), true);
  t('fixture: neutral is an "other" conclusion, never a skip', judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('X', 'neutral')] }, fx.roster).other[0]?.conclusion, 'neutral');

  const pending = judgeCheckRuns({ total_count: 2, check_runs: [fixtureRun('Build Core', 'skipped'), { id: 1, name: 'Lint & Repo Gates', status: 'in_progress', conclusion: null, check_suite: { id: 1 } }] }, fx.roster);
  t('fixture: a check-run still running → NOT MEASURED (the skip set is not final)', verdictExit(pending), 3);
  t('fixture: …with the pending run named', pending.pending[0]?.name, 'Lint & Repo Gates');
  t('fixture: zero check-runs → NOT MEASURED, never 0', verdictExit(judgeCheckRuns({ total_count: 0, check_runs: [] }, fx.roster)), 3);
  t('fixture: a payload without check_runs → NOT MEASURED', verdictExit(judgeCheckRuns({ hello: 'world' }, fx.roster)), 3);
  t('fixture: a null payload → NOT MEASURED', verdictExit(judgeCheckRuns(null, fx.roster)), 3);
  t('fixture: the judge is pure over its roster (an empty one expects nothing)', verdictExit(judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('Build Core', 'skipped')] }, [])), 4);

  // ---- the second shape: selected only by non-PR events ----------------------
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
  t("derive: …nor a negation (scaffold-local's `!= 'schedule'` runs on every PR)", gate("github.event_name != 'schedule'"), 'null');
  t('derive: …nor an inputs conjunct (the release.yml version-pr shape)', gate("github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.refresh_version_pr)"), 'null');
  t(
    'derive: …nor success() and inputs beside event terms (the merged-branch-reaper.yml reap shape)',
    gate("success() && github.event_name != 'pull_request' && (github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.dry_run == false))"),
    'null',
  );
  t(
    "derive: …which jobGate admits instead, for its top-level != 'pull_request'",
    JSON.stringify(jobGate("success() && github.event_name != 'pull_request' && (github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.dry_run == false))")?.terms),
    JSON.stringify([{ kind: 'pr-event', events: ['pull_request'] }]),
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

  // A synthetic tree: every admission and every refusal the shape claims.
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
  t('derive: a name that cannot be told is refused, with the reason', refusedAt('opaque').includes('inputs.target'), true);
  t('derive: an unreadable workflow is refused by file', derivedSyn.refused.some((r) => r.workflow === 'c.yml' && r.job === null), true);
  t('derive: …and the scan counts every file handed to it', derivedSyn.scanned, 3);
  const synRoster = derivedSyn.rows;
  t('derive: the admitted raw-named skip judges exit 0', verdictExit(judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('Nightly: ${{ matrix.os }}', 'skipped')] }, synRoster)), 0);
  t('derive: NARROWNESS — the mixed pull_request + schedule job skipped still judges exit 4', verdictExit(judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('Mixed', 'skipped')] }, synRoster)), 4);
  t('derive: …and so does the refused shared name', verdictExit(judgeCheckRuns({ total_count: 1, check_runs: [fixtureRun('Shared', 'skipped')] }, synRoster)), 4);

  // ---- this checkout's workflows: structural facts, no job name pinned ---------
  // ⛔ No case here names a live gated job: a job added to or renamed in a
  // workflow must move nothing in this file. What the live tree owes is that
  // the derivation READS it — nothing refused, and something admitted where the
  // filter contract lives.
  const liveFiles = listWorkflowFiles(ROOT);
  const live = expectedSkipRoster(ROOT);
  const readLive = workflowReader(ROOT);
  t('live derive: the workflow listing is not vacuous', liveFiles.length > 0 && live.derivation.scanned === liveFiles.length, true);
  t(`live derive: nothing refused on this tree (${live.derivation.refused.map((r) => `${r.workflow} › ${r.job}: ${r.reason}`).join(' | ') || 'none'})`, live.derivation.refused.length, 0);
  t('live derive: ci.yml carries the filter contract and the derivation reads it (at least one filter-gated row)', live.roster.some((r) => r.workflow === 'ci.yml' && r.gate.terms?.some((x) => x.kind === 'filter-output')), true);
  const liveJob = (r) => readLive(r.workflow)?.jobs?.[r.job];
  t('live derive: every admitted row is a real job carrying a string if:', live.roster.every((r) => typeof liveJob(r)?.if === 'string'), true);
  t('live derive: no job whose if: is a bare status function (an aggregate) is admitted', live.roster.some((r) => /^\s*(\$\{\{\s*)?(always|success|failure|cancelled)\(\)\s*(\}\})?\s*$/.test(liveJob(r)?.if ?? '')), false);
  t(
    'live derive: the never-skipping sentinels stay out (Lint & Repo Gates, TypeScript Type Check, Test Core, Test UI, Dogfood Regression Gate, Governed Surface Queue Guard)',
    live.roster.some((r) => ['Lint & Repo Gates', 'TypeScript Type Check', 'Test Core', 'Test UI', 'Dogfood Regression Gate', 'Governed Surface Queue Guard'].includes(r.name)),
    false,
  );
  t(
    'live derive: the non-PR-event shape keeps its measured refusals out (release.yml version-pr, merged-branch-reaper.yml reap, scaffold-e2e.yml scaffold-local)',
    live.derivation.nonPr.rows.some((r) => ['release.yml › version-pr', 'merged-branch-reaper.yml › reap', 'scaffold-e2e.yml › scaffold-local'].includes(`${r.workflow} › ${r.job}`)),
    false,
  );
  t('live derive: the joined roster is frozen and duplicate-free', Object.isFrozen(live.roster) && new Set(live.roster.map((r) => r.name)).size === live.roster.length, true);

  // ---- the roster's freshness: the roster in hand against the base's ----------
  t("freshness: an empty file's blob id is git's", gitBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  t("freshness: …and so is a one-line file's (the id the contents API reports)", gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
  t('freshness: the repo-relative self path resolves to the file running', join(ROOT, ROSTER_SELF), SELF_PATH);
  const hereLive = localRosterSources(ROOT);
  t(
    "freshness: this checkout's sources are this file plus every workflow the derivation scans",
    hereLive.size === liveFiles.length + 1 && hereLive.has(ROSTER_SELF) && liveFiles.every((f) => hereLive.has(`${WORKFLOW_DIR}/${f}`)),
    true,
  );
  t('freshness: AT TIP — a base whose sources equal the checkout leaves no gap', rosterGap(hereLive, new Map(hereLive)).length, 0);
  // The measured shape: a checkout one merge behind a base that added an opt-in
  // job's workflow. Blob ids are fixtures; only equality matters.
  const NEW_JOB = '18.x upgrade harness (opt-in)';
  const NEW_WORKFLOW = `${WORKFLOW_DIR}/upgrade-harness-optin.yml`;
  const staleHere = new Map([[ROSTER_SELF, 'a'.repeat(40)], [`${WORKFLOW_DIR}/ci.yml`, 'c'.repeat(40)]]);
  const tipBase = new Map([[ROSTER_SELF, 'b'.repeat(40)], [`${WORKFLOW_DIR}/ci.yml`, 'c'.repeat(40)], [NEW_WORKFLOW, 'd'.repeat(40)]]);
  const behind = rosterGap(staleHere, tipBase);
  t(
    "freshness: BEHIND — the gap names the base's new workflow and this file's changed code, and nothing unchanged",
    JSON.stringify(behind.map((g) => `${g.kind} ${g.path}`)),
    JSON.stringify([`absent-here ${NEW_WORKFLOW}`, `differs ${ROSTER_SELF}`]),
  );
  t('freshness: …a workflow the base no longer carries reads here-only', rosterGap(tipBase, staleHere).find((g) => g.path === NEW_WORKFLOW)?.kind, 'here-only');
  const gapLines = renderRosterGap(behind, { ref: 'main', root: '/repo' });
  t(
    'freshness: …the refusal names each path and ends on the re-pin recipe',
    gapLines.length === 3 && gapLines[0].startsWith(`${NEW_WORKFLOW} — on main`) &&
      gapLines.at(-1) === "re-pin to main's tip, then re-run: git -C /repo fetch origin main && git -C /repo checkout --detach origin/main",
    true,
  );
  const wideGap = rosterGap(new Map(), new Map(Array.from({ length: 15 }, (_, i) => [`${WORKFLOW_DIR}/w${String(i).padStart(2, '0')}.yml`, 'e'.repeat(40)])));
  t('freshness: …a wide gap is capped and counted, never silently cut', renderRosterGap(wideGap, { ref: 'main' }).some((l) => l === '…and 3 more'), true);
  const newJobHead = { total_count: 2, check_runs: [fixtureRun(NEW_JOB, 'skipped', 1), fixtureRun('Build Core', 'skipped', 2)] };
  const behindRoster = fixtureRoster((d) => delete d['upgrade-harness-optin.yml']).roster;
  t("freshness: WHY — the behind checkout's tree (no workflow for the new job) reads its skip as ⛔", verdictExit(judgeCheckRuns(newJobHead, behindRoster)), EXIT_UNEXPECTED_SKIP);
  t("freshness: …where the base's tree reads it expected", verdictExit(judgeCheckRuns(newJobHead, fx.roster)), EXIT_OK);
  t(
    'freshness: a live verdict names whose roster judged it',
    renderReport(judgeCheckRuns(newJobHead, fx.roster), { rosterRef: 'main' }).at(-1),
    "VERDICT check-expected-skips: OK — 2 skipped check-run(s), every one in main's roster (exit 0)",
  );
  t(
    'freshness: …and the offline verdict line is byte-for-byte the old one',
    renderReport(judgeCheckRuns(newJobHead, fx.roster)).at(-1),
    'VERDICT check-expected-skips: OK — 2 skipped check-run(s), every one in the roster (exit 0)',
  );

  // ---- the measured #20748 head ------------------------------------------------
  const m20748 = judgeCheckRuns(measured20748Payload(), fx.roster);
  t('measured #20748: the raw-named skipped canary judges exit 0', verdictExit(m20748), 0);
  t('measured #20748: 7 skipped, every one expected', m20748.expected.reduce((n, e) => n + e.count, 0) === 7 && m20748.unexpected.length === 0, true);
  t('measured #20748: …the canary read as a derived expected skip', m20748.expected.find((e) => e.name === CANARY_RAW_NAME)?.derived, true);
  t('measured #20748: …and the report tags it derived', renderReport(m20748).some((l) => l.includes(CANARY_RAW_NAME) && l.includes('; derived')), true);
  t('measured #20748: the gated shape alone answers exit 4 on it (the non-PR-event shape is what admits it)', judgeCheckRuns(measured20748Payload(), fx.derivation.gated.rows).unexpected[0]?.name, CANARY_RAW_NAME);
  const m20748Control = judgeCheckRuns(measured20748Payload([fixtureRun('TypeScript Type Check', 'skipped', 99276458889)]), fx.roster);
  t('measured #20748 CONTROL: a genuinely unexpected skip beside the canary still judges exit 4', verdictExit(m20748Control), 4);
  t('measured #20748 CONTROL: …naming only it', JSON.stringify(m20748Control.unexpected.map((u) => u.name)), '["TypeScript Type Check"]');
  t(
    "measured #20748 CONTROL: the canary's PR-running sibling skipped still judges exit 4",
    verdictExit(judgeCheckRuns(measured20748Payload([fixtureRun('Scaffold with repo dist', 'skipped', 99276458880)]), fx.roster)),
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
  // The CLI judges with this checkout's roster, so its payloads are BUILT from
  // that roster — one skip per live row — and name no job themselves.
  const livePayload = (extra = []) => {
    const runs = [fixtureRun('Lint & Repo Gates', 'success', 1), ...live.roster.map((r, i) => fixtureRun(r.name, 'skipped', 10 + i)), ...extra];
    return { total_count: runs.length, check_runs: runs };
  };
  const dir = mkdtempSync(join(tmpdir(), 'check-expected-skips-'));
  try {
    const okFile = join(dir, 'ok.json');
    writeFileSync(okFile, JSON.stringify({ head_sha: 'b671f83b', ...livePayload() }));
    const ok = spawnSelf(['--check-runs-json', okFile]);
    t('cli: a head skipping every live derived name → exit 0', ok.status, 0);
    t('cli: …with the OK verdict line on stdout', ok.stdout.includes(`VERDICT check-expected-skips: OK — ${live.roster.length} skipped check-run(s)`), true);
    t('cli: …naming the head it read from the payload', ok.stdout.includes('head b671f83b'), true);
    t('cli: …every row tagged with its job and derived', live.roster.every((r) => ok.stdout.includes(`${r.name}  [${r.workflow} › ${r.job}; derived]`)), true);
    t('cli: …and the offline path compares no roster (no roster line on stderr)', ok.stderr.includes('roster:'), false);

    const badFile = join(dir, 'bad.json');
    writeFileSync(badFile, JSON.stringify(livePayload([fixtureRun('TypeScript Type Check', 'skipped', 2)])));
    const bad = spawnSelf(['--check-runs-json', badFile]);
    t('cli: a required context skipped beside them → exit 4', bad.status, 4);
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
    t('cli: --roster prints every derived row with its gate, without a network', roster.status === 0 && live.roster.every((r) => roster.stdout.includes(`${r.name}  [${r.workflow} › ${r.job}; gate: ${r.gate.kind}`)), true);
    t('cli: …under a header that says none is listed by hand', roster.stdout.split('\n')[0].includes('none listed by hand'), true);
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
  t("structural: no hand-listed roster survives (no exported roster array literal)", /export\s+const\s+EXPECTED_SKIPS\b/.test(positions), false);
  const liveRun = positions.slice(positions.indexOf('async function run('));
  t(
    'structural: the live path compares the roster with the base before it reads a check-run',
    liveRun.indexOf('rosterGap(') > 0 && liveRun.indexOf('rosterGap(') < liveRun.indexOf('readCheckRuns('),
    true,
  );

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name} (got ${JSON.stringify(c.actual)}, want ${JSON.stringify(c.expected)})`);
  if (failed.length > 0) {
    console.error(`✗ check-expected-skips self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return { code: EXIT_SELF_TEST_FAILED, verdict: SELF_TEST_VERDICT };
  }
  console.log(
    `✓ check-expected-skips self-test: ${cases.length} cases pass (the exit register; the gate recogniser — top-level splitting, each ` +
      'term kind read and every near-miss spelling refused; the derivation on a frozen fixture tree, admitting exactly its gated jobs ' +
      'and none of the sentinels, with reasons built from the terms; a gated job ADDED or RENAMED needing no edit here, and a deleted, ' +
      "un-gated or always() job, an unwidened, undeclared or un-needed filter output, an unread filter spelling, a shared or untellable " +
      'name and an unreadable workflow each keeping its skip at exit 4; the judge on the measured head (38 of its 39 runs) and on fixtures ' +
      'for an expected skip, an unexpected skip named as a filter miss, a same-suite failure read as a dependency skip, a raw matrix ' +
      'template, other conclusions, a pending run and an empty head; the non-PR-event shape and its refusals; this checkout\'s workflows ' +
      'read with nothing refused and no live job name pinned; the roster\'s freshness — git blob ids, this checkout\'s sources, the ' +
      'at-tip and behind cases and the false ⛔ a behind tree gives; the measured #20748 head judged 0 with its raw-named canary and 4 ' +
      'with a genuinely unexpected skip beside it; read classification for 422 / 404 / 401 / 403 / 5xx / network; argv; the real CLI on ' +
      'payload files built from the live roster for 0 / 4 / 3 and --json; and the structural no-write-path, no-hand-list, ' +
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
