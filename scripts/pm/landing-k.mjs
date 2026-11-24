#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * landing-k — the merge-lag reading a landing seat takes before it arms auto-merge or enqueues a PR.
 *
 *   node scripts/pm/landing-k.mjs --pr 35482
 *   node scripts/pm/landing-k.mjs --pr 35482 --json
 *   node scripts/pm/landing-k.mjs --pr 35482 --fixture k.json      # offline: the fixture answers every read
 *   node scripts/pm/landing-k.mjs --self-test                      # offline, no network at all
 *
 * ## Why this file exists
 *
 * `references/landing-operations.md` (入队与落地, the K block) asks every landing seat, per PR, before arming or
 * enqueueing, for one number and two legs. The reading was five hand steps: find the last green PR run, find its Test
 * Core job, read the job log, copy the diff base, then `git rev-list` and two `git diff --name-only` checks. The rule
 * names its own wrong turn (⛔ not the run's start time), the sign of a reading that has been typed wrong before. This
 * file is the reading. ⛔ It writes nothing; the seat still owns the landing.
 *
 * ## The rule it encodes — rule text on `main`, pinned by the self-test (`RULE_PHRASES`)
 *
 *   1. K = `git rev-list --count --first-parent PRBASE..origin/main`.
 *   2. PRBASE = the `Affected-set diff base` that the LAST GREEN PR run's Test Core printed
 *      (`scripts/ci/select-shard-packages.sh` spells the line; every `Test Core (k/N)` shard and the planner print it),
 *      ⛔ never that run's start time; the diff base is read from the selector step only (`SELECTOR_STEP`). "Green" =
 *      the run's `Test Core` aggregate job concluded `success`; "PR run" = a `pull_request` run of `ci.yml` whose head
 *      is one of this PR's commits (a branch name is reused across PRs, so the branch alone never decides).
 *   3. K ≥ 15 ⇒ merge main first and wait for a green re-run. `behind` alone is not a reason (the K decides).
 *   4. At any K, the locale leg: a label PR, when a new locale pack landed on main after PRBASE. A new locale pack is a
 *      file ADDED under a `translations/` directory in `PRBASE..main` whose locale (the file name up to its first dot)
 *      had no file in that directory at PRBASE. A label PR is read off the PR's file list against the surface the two
 *      translation gates count (`LABEL_SURFACE`) — a hit reads as a label PR, so the leg errs toward merging first.
 *   5. At any K, the shared-budget leg: a PR that touches a closed book's input or ledger, when main's
 *      `git diff --name-only PRBASE..origin/main` touches the same book (`BUDGET_BOOKS`, the two the rule names).
 *
 * ## Fail closed — exit 3 is never read as 0
 *
 * A log that cannot be read (expired, 404, refused), a run list with no green Test Core within the bound, a green run
 * whose Test Core printed no diff base (its shards were skipped), a PRBASE the local clone does not hold as an ancestor
 * of main, a local `origin/main` that is not GitHub's `main`, or a PR file list shorter than the PR's own count: each is
 * exit 3 with the gap named. ⛔ The clean verdict is printed only when every leg answered. A leg that already says
 * "merge main first" decides exit 1 even when another leg is unread; the unread leg is still named.
 *
 * ## What it does NOT read — named in the footer of every run
 *
 * `UNREAD_LEGS`: whether the PR's diff really changes a display label (the surface proxy above stands in for running
 * the two gates), a new locale pack in a `ui/**\/locales/` tree (the rule's label gates read `translations/` bundles),
 * section A's generated-artifact re-measure before arming, and the green re-run after a merge (`pr-state.mjs` reads
 * checks). A seat reads those itself; the output says so every time.
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0  every leg answered and none says merge: arm or enqueue as the rest of the bar allows
 *   1  merge main first (K ≥ 15, the locale leg or the shared-budget leg) — each reason named; also `--self-test` failed
 *   2  usage
 *   3  CAN'T ANSWER — a read did not answer (named); ⛔ never read as 0
 *
 * ## Self-test
 *
 * `--self-test` drives the reads, the legs and the CLI against fixtures, with the floor and the handshake AGENTS.md §
 * "Writing a `--self-test`" requires (copied, never imported), and pins the rule text it replaces.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { findExtractConfigs, isMetadataFormModulePath } from '../i18n-bundle-surface.mjs';
import { DEFAULT_SWEEP_REPO } from './check-half-states.mjs';
import { ghApi } from './gh-pages.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const EXIT_OK = 0;
export const EXIT_MERGE_MAIN_FIRST = 1;
export const EXIT_SELF_TEST_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_CANT_ANSWER = 3;

/** The K hold the rule names. */
export const K_HOLD = 15;
export const CI_WORKFLOW = 'ci.yml';
export const TEST_CORE_GATE = 'Test Core';
export const TEST_CORE_SHARD = /^Test Core \(\d+\/\d+\)$/;
export const TEST_CORE_PLAN = 'Plan Test Core shards';
/** `select-shard-packages.sh` spells it `Affected-set diff base: <sha>  (<why>)`; the log prefixes a timestamp. */
export const DIFF_BASE_LINE = /Affected-set diff base: ([0-9a-f]{40})\s+\(([^)\n]*)\)/;
export const DIFF_BASE_SOURCE = 'scripts/ci/select-shard-packages.sh';
/**
 * The diff base is read from the selector step only: the job-log section that opens with this step header (the first
 * line of the `run:` block of `ci.yml`'s planner and shard steps) and runs to the next step header.
 */
export const SELECTOR_STEP = 'bash scripts/ci/select-shard-packages.sh';
export const STEP_HEADER = /##\[group\]Run (.*)$/;
/** How many run-list pages and runs one reading walks before it says it found no green run. */
export const MAX_RUN_PAGES = 5;
export const MAX_RUNS_INSPECTED = 30;

/** The two closed books the rule names: input → ledger. */
export const BUDGET_BOOKS = Object.freeze([
  Object.freeze({ name: 'skills token ratchet', input: 'skills/**', ledger: 'scripts/check-skills-token-ratchet.mjs', inInput: (p) => p.startsWith('skills/') }),
  Object.freeze({ name: 'ui eager-closure budget', input: 'ui/**/locales/en.ts', ledger: 'ui/scripts/check-eager-closure-budget.mjs', inInput: (p) => /^ui\/(?:.+\/)?locales\/en\.ts$/.test(p) }),
]);

/** A file under a `translations/` directory, its locale being the name up to the first dot. */
export const LOCALE_FILE = /^(.*\/)?translations\/([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\.[^/]+$/;

/** Where the rule lives, and the phrases this file is built from — the self-test pins each one present. */
export const LANDING_PATH = '.claude/skills/pm-dispatch/references/landing-operations.md';
export const RULE_PHRASES = Object.freeze([
  'PRBASE = 末次绿 PR 跑 Test Core 所印 `Affected-set diff base`,⛔ 不取该跑起始时刻。',
  'K ≥ 15 ⇒ 先 merge main 等重跑绿,`behind` 例外;任何 K 同:标签 PR 的 PRBASE 后 main 落新语种包;',
  '`skills/**`:`scripts/check-skills-token-ratchet.mjs`;`ui/**/locales/en.ts`:`ui/scripts/check-eager-closure-budget.mjs`',
  '标签即 `check-generated-translation-bundles`、`check-no-new-untranslated-declared-labels` 所计显示标签。',
  '`landing-k.mjs --pr N`',
]);

/** The legs this file cannot read, printed under every run. */
export const UNREAD_LEGS = Object.freeze([
  "whether this PR's diff really changes a display label — the PR file list is read against the translation gates' surface instead, and a hit counts as a label PR",
  'a new locale pack in a `ui/**/locales/` tree — the locale leg reads `translations/` bundles, the ones the two label gates count',
  "section A's generated-artifact re-measure before arming — `os-regen-merge.sh` owns it",
  'the green re-run after a merge — read the checks with `pr-state.mjs --pr N`',
]);

// ---------------------------------------------------------------------------
// The pure core
// ---------------------------------------------------------------------------

/** The diff base one printed line carries, or null. */
export function parseDiffBase(logText) {
  const m = DIFF_BASE_LINE.exec(String(logText ?? ''));
  return m ? { sha: m[1], why: m[2].trim(), line: m[0] } : null;
}

/**
 * The diff base a Test Core job log printed, read from the selector step only.
 * `{ ok: true, base }` | `{ ok: false, why }` — no selector step, no line in it, or more than one distinct base.
 */
export function readSelectorDiffBase(logText) {
  const lines = String(logText ?? '').split('\n');
  const inStep = [];
  const all = new Set();
  let step = null;
  let sawStep = false;
  for (const l of lines) {
    const h = STEP_HEADER.exec(l);
    if (h) {
      step = h[1].trim();
      if (step === SELECTOR_STEP) sawStep = true;
      continue;
    }
    const b = parseDiffBase(l);
    if (!b) continue;
    all.add(b.sha);
    if (step === SELECTOR_STEP) inStep.push(b);
  }
  if (all.size > 1) return { ok: false, why: `prints ${all.size} distinct \`Affected-set diff base\` values (${[...all].map((x) => x.slice(0, 10)).join(', ')}), so none is read` };
  if (!sawStep) return { ok: false, why: `has no \`Run ${SELECTOR_STEP}\` step` };
  if (!inStep.length) return { ok: false, why: 'carries no `Affected-set diff base` line in its selector step' };
  return { ok: true, base: inStep[0] };
}

/** The surface the two translation gates count, as a predicate over one repo path. */
export function labelSurfaceReader(extractRoots) {
  return (p) => {
    if (p.includes('/translations/') || p.startsWith('translations/')) return 'a translation bundle';
    if (isMetadataFormModulePath(p)) return 'a metadata form module (the metadataForms half)';
    if (p.startsWith('packages/spec/src/')) return 'spec-declared labels';
    if (/^examples\//.test(p)) return 'an example config (check:i18n-coverage)';
    const root = extractRoots.find((r) => p.startsWith(r));
    return root ? `a package that owns an i18n extract config (${root.slice(0, -1)})` : null;
  };
}

/** The package roots that own an `i18n-extract.config.ts`, walked from this checkout (the gate's own walk). */
export function extractConfigRoots(root = REPO_ROOT) {
  const dir = join(root, 'packages');
  if (!existsSync(dir)) return [];
  return findExtractConfigs(dir, 'packages').map((c) => `${c.rel.split('/scripts/')[0]}/`);
}

/** New locale packs among `added` paths: a (dir, locale) pair with no file at PRBASE. `filesAt(dir)` → names | null. */
export function newLocalePacks(added, filesAt) {
  const packs = new Map();
  const unread = [];
  for (const p of added) {
    const m = LOCALE_FILE.exec(p);
    if (!m) continue;
    const dir = `${m[1] ?? ''}translations`;
    const key = `${dir}#${m[2]}`;
    if (packs.has(key)) {
      packs.get(key).files.push(p);
      continue;
    }
    const before = filesAt(dir);
    if (before === null) {
      unread.push(dir);
      continue;
    }
    if (!before.some((name) => name.startsWith(`${m[2]}.`))) packs.set(key, { dir, locale: m[2], files: [p] });
  }
  return { packs: [...packs.values()], unread: [...new Set(unread)] };
}

/** The books a path list touches (input or ledger). */
export function booksTouched(paths) {
  return BUDGET_BOOKS.filter((b) => paths.some((p) => p === b.ledger || b.inInput(p)));
}

// ---------------------------------------------------------------------------
// Reads — `get` answers JSON (`ghApi`), `getText` answers a log, `git` answers the local clone
// ---------------------------------------------------------------------------

/** One `gh api <path>` read returned as text — a job log is not JSON. */
export function ghText(path) {
  const r = spawnSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.error?.message || `gh exited ${r.status}`).trim().split('\n')[0] };
  return { ok: true, value: r.stdout };
}

/** The local clone, through `git -C <root>`. Every answer is null when git did not answer. */
export function localGit(root = REPO_ROOT) {
  const run = (args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return {
    resolve(ref) {
      const r = run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      return r.status === 0 ? r.stdout.trim() : null;
    },
    hasCommit(sha) {
      return run(['cat-file', '-e', `${sha}^{commit}`]).status === 0;
    },
    /** true / false / null — exit 0 self-proves; exit 1 is "not an ancestor"; anything else did not answer. */
    isAncestor(a, b) {
      const r = run(['merge-base', '--is-ancestor', a, b]);
      return r.status === 0 ? true : r.status === 1 ? false : null;
    },
    countFirstParent(a, b) {
      const r = run(['rev-list', '--count', '--first-parent', `${a}..${b}`]);
      return r.status === 0 ? Number(r.stdout.trim()) : null;
    },
    diffNames(a, b, filter = null) {
      const r = run(['diff', '--name-only', ...(filter ? [`--diff-filter=${filter}`] : []), a, b]);
      return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : null;
    },
    filesAt(rev, dir) {
      const r = run(['ls-tree', '--name-only', `${rev}:${dir}`]);
      if (r.status === 0) return r.stdout.split('\n').filter(Boolean);
      // A directory the tree did not hold at that revision is an empty answer, not an unread one.
      return run(['cat-file', '-e', `${rev}^{commit}`]).status === 0 ? [] : null;
    },
  };
}

/** Every row of an object-wrapped list (`{ total_count, <key>: [] }`), paged, with the platform's count checked. */
export function readWrapped(get, path, key, maxPages = MAX_RUN_PAGES) {
  const rows = [];
  let total = null;
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const r = get(`${path}${sep}per_page=100&page=${page}`);
    if (!r.ok) return { ok: false, error: r.error };
    const list = r.value?.[key];
    if (!Array.isArray(list)) return { ok: false, error: `GET ${path} answered no \`${key}\` list` };
    total = r.value.total_count ?? total;
    rows.push(...list);
    if (list.length < 100) return { ok: true, value: rows, total, truncated: false };
  }
  return { ok: true, value: rows, total, truncated: true };
}

/** Every row of a plain list endpoint, paged; a page that is not a list is an error. */
function readList(get, path, maxPages = 30) {
  const rows = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const r = get(`${path}${sep}per_page=100&page=${page}`);
    if (!r.ok) return r;
    if (!Array.isArray(r.value)) return { ok: false, error: `GET ${path} answered no list` };
    rows.push(...r.value);
    if (r.value.length < 100) return { ok: true, value: rows };
  }
  return { ok: false, error: `GET ${path} still returned full pages after ${maxPages}` };
}

/**
 * The last green PR run's diff base. Returns `{ ok, run, job, base }` or `{ ok: false, gap }`.
 * Runs are walked newest first; a run counts only when its head is one of the PR's commits.
 */
export function readPrBase({ repo, pr, commits, get, getText }) {
  const shas = new Set(commits);
  const runs = readWrapped(get, `/repos/${repo}/actions/workflows/${CI_WORKFLOW}/runs?event=pull_request&branch=${encodeURIComponent(pr.head.ref)}`, 'workflow_runs');
  if (!runs.ok) return { ok: false, gap: `the ${CI_WORKFLOW} run list could not be read (${runs.error})` };
  const mine = runs.value.filter((r) => shas.has(r.head_sha)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  let inspected = 0;
  for (const run of mine) {
    if (inspected >= MAX_RUNS_INSPECTED) break;
    if (run.status !== 'completed') continue;
    inspected++;
    const jobs = readWrapped(get, `/repos/${repo}/actions/runs/${run.id}/jobs`, 'jobs');
    if (!jobs.ok) return { ok: false, gap: `run ${run.id}'s jobs could not be read (${jobs.error})` };
    const gate = jobs.value.find((j) => j.name === TEST_CORE_GATE);
    if (!gate || gate.status !== 'completed' || gate.conclusion !== 'success') continue;
    const sources = [...jobs.value.filter((j) => TEST_CORE_SHARD.test(j.name) && j.conclusion === 'success'), ...jobs.value.filter((j) => j.name === TEST_CORE_PLAN && j.conclusion === 'success')];
    if (sources.length === 0) return { ok: false, gap: `run ${run.id} (head ${run.head_sha.slice(0, 10)}) is the last green Test Core, but no Test Core shard or planner ran in it, so no \`Affected-set diff base\` was printed` };
    const job = sources[0];
    const log = getText(`/repos/${repo}/actions/jobs/${job.id}/logs`);
    if (!log.ok) return { ok: false, gap: `the log of \`${job.name}\` (job ${job.id}, run ${run.id}) could not be read — expired or refused (${log.error})` };
    const read = readSelectorDiffBase(log.value);
    if (!read.ok) return { ok: false, gap: `the log of \`${job.name}\` (job ${job.id}, run ${run.id}) ${read.why}` };
    return { ok: true, run, job, base: read.base };
  }
  const why = runs.truncated ? ` (the run list was cut at ${MAX_RUN_PAGES} pages)` : '';
  return { ok: false, gap: `no completed pull_request ${CI_WORKFLOW} run on this PR's commits has a green \`${TEST_CORE_GATE}\` (${mine.length} run(s) on its commits, ${inspected} inspected)${why}` };
}

/**
 * The whole reading. Pure over `get` / `getText` / `git` / `extractRoots`.
 * Returns `{ pr, legs, merge: [reasons], gaps: [gaps], exit }`.
 */
export function landingK({ repo, number, mainRef = 'origin/main', get = ghApi, getText = ghText, git = localGit(), extractRoots = null }) {
  const out = { repo, number, mainRef, pr: null, prbase: null, k: null, mainSha: null, locale: null, budget: null, merge: [], gaps: [], prerequisite: null };
  const prRow = get(`/repos/${repo}/pulls/${number}`);
  if (!prRow.ok) {
    out.prerequisite = `PR #${number} could not be read (${prRow.error})`;
    return finish(out);
  }
  const pr = prRow.value;
  out.pr = { number, state: pr.state, merged_at: pr.merged_at ?? null, draft: Boolean(pr.draft), head: pr.head?.sha ?? null, ref: pr.head?.ref ?? null, base: pr.base?.ref ?? null, changed_files: pr.changed_files ?? null };
  const commits = readList(get, `/repos/${repo}/pulls/${number}/commits`, 3);
  if (!commits.ok) out.gaps.push(`the PR's commit list could not be read (${commits.error})`);

  // Main: the local ref the count runs against must be GitHub's main, or the count understates K.
  const localMain = git.resolve(mainRef);
  const remote = get(`/repos/${repo}/branches/${encodeURIComponent(pr.base?.ref ?? 'main')}`);
  if (!localMain) out.gaps.push(`\`${mainRef}\` does not resolve in this clone`);
  else if (!remote.ok) out.gaps.push(`GitHub's \`${pr.base?.ref ?? 'main'}\` could not be read to check \`${mainRef}\` is current (${remote.error})`);
  else if (remote.value?.commit?.sha !== localMain) out.gaps.push(`\`${mainRef}\` is ${localMain.slice(0, 10)} here but GitHub's \`${pr.base?.ref}\` is ${String(remote.value?.commit?.sha).slice(0, 10)} — \`git fetch origin ${pr.base?.ref}\` and re-run`);
  else out.mainSha = localMain;

  if (commits.ok) {
    const base = readPrBase({ repo, pr, commits: commits.value.map((c) => c.sha), get, getText });
    if (!base.ok) out.gaps.push(base.gap);
    else out.prbase = { sha: base.base.sha, why: base.base.why, run: base.run.id, run_head: base.run.head_sha, at_head: base.run.head_sha === pr.head?.sha, job: base.job.name, job_id: base.job.id };
  }

  const files = readList(get, `/repos/${repo}/pulls/${number}/files`, 30);
  let prFiles = null;
  if (!files.ok) out.gaps.push(`the PR's file list could not be read (${files.error})`);
  else if (pr.changed_files != null && files.value.length < pr.changed_files) out.gaps.push(`the PR's file list returned ${files.value.length} file(s) and the PR counts ${pr.changed_files}`);
  else prFiles = files.value.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean));

  if (out.prbase && out.mainSha) {
    const b = out.prbase.sha;
    if (!git.hasCommit(b)) out.gaps.push(`PRBASE ${b.slice(0, 10)} is not in this clone — \`git fetch origin ${pr.base?.ref}\` (deepen a shallow clone) and re-run`);
    else {
      const anc = git.isAncestor(b, out.mainSha);
      if (anc !== true) out.gaps.push(`PRBASE ${b.slice(0, 10)} ${anc === false ? 'is not an ancestor of' : 'could not be checked against'} ${mainRef} in this clone — a shallow or stale clone cannot count K`);
      else {
        out.k = git.countFirstParent(b, out.mainSha);
        if (out.k === null) out.gaps.push('`git rev-list --count --first-parent` did not answer');
        else if (out.k >= K_HOLD) out.merge.push(`K = ${out.k} ≥ ${K_HOLD}`);
        const added = git.diffNames(b, out.mainSha, 'A');
        const names = git.diffNames(b, out.mainSha);
        if (added === null || names === null) out.gaps.push('`git diff --name-only PRBASE..main` did not answer');
        else {
          const roots = extractRoots ?? extractConfigRoots();
          const locale = newLocalePacks(added, (dir) => git.filesAt(b, dir));
          const isLabel = labelSurfaceReader(roots);
          const labelHits = prFiles ? prFiles.map((p) => ({ p, why: isLabel(p) })).filter((h) => h.why) : null;
          out.locale = { packs: locale.packs, label_hits: labelHits };
          if (locale.unread.length) out.gaps.push(`the tree at PRBASE could not be listed for ${locale.unread.join(', ')}`);
          if (locale.packs.length && labelHits === null) out.gaps.push('a new locale pack landed after PRBASE and the PR file list is unread, so the label leg is unjudged');
          else if (locale.packs.length && labelHits.length) out.merge.push(`a new locale pack landed after PRBASE (${locale.packs.map((x) => `${x.locale} in ${x.dir}`).join(', ')}) under a label PR (${labelHits[0].p}: ${labelHits[0].why}${labelHits.length > 1 ? `, +${labelHits.length - 1} more` : ''})`);
          const mainBooks = booksTouched(names);
          const prBooks = prFiles ? booksTouched(prFiles) : null;
          out.budget = { main: mainBooks.map((x) => x.name), pr: prBooks ? prBooks.map((x) => x.name) : null };
          if (prBooks === null && mainBooks.length) out.gaps.push('main moved a shared-budget book after PRBASE and the PR file list is unread, so the budget leg is unjudged');
          else if (prBooks) for (const book of prBooks.filter((x) => mainBooks.includes(x))) out.merge.push(`shared budget: this PR and main after PRBASE both touch the ${book.name} (${book.input} : ${book.ledger})`);
        }
      }
    }
  }
  return finish(out);
}

function finish(out) {
  out.exit = out.prerequisite ? EXIT_CANT_ANSWER : out.merge.length ? EXIT_MERGE_MAIN_FIRST : out.gaps.length ? EXIT_CANT_ANSWER : EXIT_OK;
  return out;
}

export function verdictLine(r) {
  if (r.prerequisite) return `landing-k CAN'T ANSWER — ${r.prerequisite}. ⛔ Not a 0: nothing was read.`;
  if (r.merge.length) return `landing-k MERGE MAIN FIRST — ${r.merge.join('; ')}.${r.gaps.length ? ` (Also unread: ${r.gaps.join('; ')}.)` : ''}`;
  if (r.gaps.length) return `landing-k CAN'T ANSWER — ${r.gaps.join('; ')}. ⛔ Not a 0: re-run when the reads answer.`;
  return `landing-k OK — K = ${r.k} < ${K_HOLD}, no new locale pack under a label PR, no shared book moved under this PR's.`;
}

export function renderText(r) {
  const L = [`landing-k — ${r.repo} #${r.number}${r.pr ? ` · ${r.pr.merged_at ? `merged ${r.pr.merged_at}` : r.pr.state} · head ${String(r.pr.head).slice(0, 10)} · ${r.pr.ref}` : ''}`];
  if (r.prbase) L.push(`PRBASE ${r.prbase.sha.slice(0, 10)} (${r.prbase.why}) — from \`${r.prbase.job}\` of run ${r.prbase.run}, the last green ${TEST_CORE_GATE} (run head ${r.prbase.run_head.slice(0, 10)}${r.prbase.at_head ? ', the PR head' : ', NOT the PR head'})`);
  else L.push('PRBASE — not read');
  L.push(r.k === null ? 'K — not read' : `K = ${r.k} first-parent commit(s) on ${r.mainRef} (${r.mainSha.slice(0, 10)}) since PRBASE · hold at ${K_HOLD} → ${r.k >= K_HOLD ? 'merge main first' : 'ok'} · \`behind\` alone is no reason`);
  if (r.locale) {
    const packs = r.locale.packs.length ? r.locale.packs.map((x) => `${x.locale} in ${x.dir}`).join(', ') : 'none';
    const label = r.locale.label_hits === null ? 'unread' : r.locale.label_hits.length ? `yes (${r.locale.label_hits.length} file(s) on the label surface, first ${r.locale.label_hits[0].p})` : 'no file on the label surface';
    L.push(`locale leg — new locale pack(s) after PRBASE: ${packs} · label PR: ${label}`);
  } else L.push('locale leg — not read');
  if (r.budget) L.push(`shared-budget leg — main after PRBASE touches: ${r.budget.main.join(', ') || 'no book'} · this PR touches: ${r.budget.pr === null ? 'unread' : r.budget.pr.join(', ') || 'no book'}`);
  else L.push('shared-budget leg — not read');
  L.push('Not read by this reader — the seat reads these itself:');
  for (const leg of UNREAD_LEGS) L.push(`  · ${leg}`);
  L.push(verdictLine(r));
  return L.join('\n');
}

export function renderJson(r) {
  return { repo: r.repo, pr: r.pr, prbase: r.prbase, k: r.k, k_hold: K_HOLD, main_ref: r.mainRef, main_sha: r.mainSha, locale: r.locale, budget: r.budget, merge_reasons: r.merge, unread: r.prerequisite ? [r.prerequisite] : r.gaps, unread_legs: UNREAD_LEGS, exit: r.exit, verdict: verdictLine(r) };
}

// ---------------------------------------------------------------------------
// Fixture — an offline PR the same reads answer
// ---------------------------------------------------------------------------

/**
 * `{ pr, commits, files, runs, jobs: {runId: []}, logs: {jobId: text|null}, branch_sha, git: { refs: {ref: sha},
 * commits: [sha], ancestors: ["a..b"], counts: {"a..b": n}, added: {"a..b": []}, names: {"a..b": []},
 * trees: {"rev:dir": []} }, extract_roots }`. A path the fixture does not hold answers 404; a `null` log answers 410.
 */
export function fixtureReaders(fx, repo) {
  const page = (rows, path) => {
    const q = new URLSearchParams(path.split('?')[1] ?? '');
    const p = Number(q.get('page') ?? 1);
    return rows.slice((p - 1) * 100, p * 100);
  };
  const get = (path) => {
    const bare = path.split('?')[0];
    if (bare === `/repos/${repo}/pulls/${fx.pr?.number}`) return fx.pr ? { ok: true, value: fx.pr } : { ok: false, error: 'HTTP 404' };
    if (bare === `/repos/${repo}/pulls/${fx.pr?.number}/commits`) return fx.commits === null ? { ok: false, error: 'HTTP 502' } : { ok: true, value: page((fx.commits ?? []).map((sha) => ({ sha })), path) };
    if (bare === `/repos/${repo}/pulls/${fx.pr?.number}/files`) return fx.files === null ? { ok: false, error: 'HTTP 502' } : { ok: true, value: page((fx.files ?? []).map((filename) => ({ filename })), path) };
    if (bare.startsWith(`/repos/${repo}/branches/`)) return fx.branch_sha ? { ok: true, value: { commit: { sha: fx.branch_sha } } } : { ok: false, error: 'HTTP 502' };
    if (bare === `/repos/${repo}/actions/workflows/${CI_WORKFLOW}/runs`) return fx.runs === null ? { ok: false, error: 'HTTP 502' } : { ok: true, value: { total_count: (fx.runs ?? []).length, workflow_runs: page(fx.runs ?? [], path) } };
    const m = /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/jobs$/.exec(bare);
    if (m) return fx.jobs?.[m[1]] ? { ok: true, value: { total_count: fx.jobs[m[1]].length, jobs: page(fx.jobs[m[1]], path) } } : { ok: false, error: 'HTTP 404' };
    return { ok: false, error: `HTTP 404 (${bare})` };
  };
  const getText = (path) => {
    const m = /\/actions\/jobs\/(\d+)\/logs$/.exec(path);
    if (!m || !(m[1] in (fx.logs ?? {}))) return { ok: false, error: 'HTTP 404' };
    return fx.logs[m[1]] === null ? { ok: false, error: 'HTTP 410 Gone' } : { ok: true, value: fx.logs[m[1]] };
  };
  const g = fx.git ?? {};
  const git = {
    resolve: (ref) => g.refs?.[ref] ?? null,
    hasCommit: (sha) => (g.commits ?? []).includes(sha),
    isAncestor: (a, b) => ((g.ancestors ?? []).includes(`${a}..${b}`) ? true : g.unanswered ? null : false),
    countFirstParent: (a, b) => g.counts?.[`${a}..${b}`] ?? null,
    diffNames: (a, b, filter) => (filter === 'A' ? g.added : g.names)?.[`${a}..${b}`] ?? null,
    filesAt: (rev, dir) => (g.trees && `${rev}:${dir}` in g.trees ? g.trees[`${rev}:${dir}`] : g.trees_unread ? null : []),
  };
  return { get, getText, git, extractRoots: fx.extract_roots ?? [] };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = [
  'landing-k — the merge-lag reading before arming or enqueueing a PR (read-only).',
  '',
  '  node scripts/pm/landing-k.mjs --pr N [--repo OWNER/NAME] [--main-ref REF] [--json] [--fixture FILE]',
  '  node scripts/pm/landing-k.mjs --self-test',
  '',
  '  Exits: 0 ok · 1 merge main first (each reason named) · 2 usage · 3 CAN\'T ANSWER (a read did not answer; never a 0).',
].join('\n');

export function parseArgs(argv) {
  const opts = { repo: DEFAULT_SWEEP_REPO, pr: null, mainRef: 'origin/main', json: false, fixture: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = /^(--[a-z-]+)=(.*)$/.exec(a);
    const flag = eq ? eq[1] : a;
    const take = () => (eq ? eq[2] : argv[++i]);
    if (flag === '--json' && !eq) opts.json = true;
    else if ((flag === '--help' || flag === '-h') && !eq) opts.help = true;
    else if (flag === '--pr') {
      const v = String(take() ?? '').replace(/^#/, '');
      if (!/^[1-9][0-9]*$/.test(v)) return { error: `--pr must be a PR number, got \`${v}\`` };
      opts.pr = Number(v);
    } else if (flag === '--repo') {
      opts.repo = String(take() ?? '');
      if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) return { error: `--repo must be OWNER/NAME, got \`${opts.repo}\`` };
    } else if (flag === '--main-ref') {
      opts.mainRef = String(take() ?? '');
      if (!opts.mainRef) return { error: '--main-ref needs a ref' };
    } else if (flag === '--fixture') {
      opts.fixture = take();
      if (!opts.fixture) return { error: '--fixture needs a file' };
    } else return { error: `\`${a}\` is not an argument this tool takes` };
  }
  if (!opts.help && opts.pr === null) return { error: '--pr N is required' };
  return { opts };
}

export function main(argv, deps = {}) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`landing-k: ${parsed.error}`);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const o = parsed.opts;
  if (o.help) {
    console.log(USAGE);
    return EXIT_OK;
  }
  let readers = deps.readers ?? null;
  if (o.fixture) {
    let fx;
    try {
      fx = JSON.parse(readFileSync(o.fixture, 'utf8'));
    } catch (e) {
      console.error(`landing-k: --fixture \`${o.fixture}\` could not be read as JSON (${e.message})`);
      return EXIT_USAGE;
    }
    readers = fixtureReaders(fx, o.repo);
  }
  const r = landingK({ repo: o.repo, number: o.pr, mainRef: o.mainRef, ...(readers ?? {}) });
  console.log(o.json ? JSON.stringify(renderJson(r), null, 2) : renderText(r));
  return r.exit;
}

// ---------------------------------------------------------------------------
// Self-test — floor (battery names pinned) + handshake, copied from the landed shape
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the rule text: every phrase this file is built from is in the file that writes it': 5,
  'PRBASE: the last green Test Core run on this PR, its log line, never a branch alone': 10,
  'K: the count, the hold at 15, and a clone that cannot count': 6,
  'the locale leg: a new pack after PRBASE under a label PR, at any K': 6,
  'the shared-budget leg: the same book on both sides, at any K': 5,
  'fail closed: every unread leg is exit 3, never 0': 8,
  'the CLI: usage, exits and the footer': 7,
});
const SELF_TEST_BATTERY_FLOOR = 7;
const UNATTRIBUTED_BATTERY = '(unattributed)';
const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};
let selfTestReachedVerdict = false;

const quiet = (fn) => (...args) => {
  const log = console.log;
  const err = console.error;
  const out = [];
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try {
    return { code: fn(...args), out: out.join('\n') };
  } finally {
    console.log = log;
    console.error = err;
  }
};

export function selfTest() {
  const cases = [];
  const t = (name, actual, expected = true) => {
    const key = openBattery ?? UNATTRIBUTED_BATTERY;
    batteryCases.set(key, (batteryCases.get(key) ?? 0) + 1);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, detail: ok ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
  };
  const REPO = 'objectstack-ai/objectstack';
  const sha = (c) => c.repeat(40);
  const BASE = sha('b');
  const MAIN = sha('a');
  const HEAD = sha('c');
  const OLD = sha('d');
  const stepLine = (cmd) => `2026-11-19T13:07:09.5000000Z ##[group]Run ${cmd}\n`;
  const baseLine = (s = BASE) => `2026-11-19T13:07:09.7414776Z Affected-set diff base: ${s}  (merge-base of origin/main and HEAD)\n`;
  const log = (s = BASE) => `${stepLine(SELECTOR_STEP)}${baseLine(s)}`;
  const job = (id, name, conclusion = 'success') => ({ id, name, status: 'completed', conclusion });
  const greenJobs = [job(11, 'Plan Test Core shards'), job(12, 'Test Core (1/10)'), job(13, TEST_CORE_GATE)];
  const fixture = (over = {}) => {
    const fx = {
      pr: { number: 7, state: 'open', draft: false, head: { sha: HEAD, ref: 'claude/x' }, base: { ref: 'main' }, changed_files: 1 },
      commits: [OLD, HEAD],
      files: ['scripts/pm/x.mjs'],
      branch_sha: MAIN,
      runs: [{ id: 2, head_sha: HEAD, status: 'completed', created_at: '2026-11-19T13:00:00Z' }],
      jobs: { 2: greenJobs },
      logs: { 12: log() },
      git: { refs: { 'origin/main': MAIN }, commits: [BASE], ancestors: [`${BASE}..${MAIN}`], counts: { [`${BASE}..${MAIN}`]: 3 }, added: { [`${BASE}..${MAIN}`]: [] }, names: { [`${BASE}..${MAIN}`]: [] } },
      extract_roots: ['packages/platform-objects/'],
      ...over,
    };
    if (over.git) fx.git = { ...fixture().git, ...over.git };
    return fx;
  };
  const read = (fx) => landingK({ repo: REPO, number: 7, ...fixtureReaders(fx, REPO) });

  battery('the rule text: every phrase this file is built from is in the file that writes it');
  {
    const text = (p) => readFileSync(join(REPO_ROOT, p), 'utf8');
    t('⭐ landing-operations.md still says what this file encodes (a reworded K block reds here)', RULE_PHRASES.filter((p) => !text(LANDING_PATH).includes(p)), []);
    t('⭐ the shard selector still prints the line PRBASE is read from', parseDiffBase(text(DIFF_BASE_SOURCE).split('\n').find((l) => l.includes('echo "Affected-set diff base:')).replace('$SCM_BASE', BASE).replace(/^\s*echo "/, '')) !== null, true);
    t('both closed books still exist where the rule names their ledgers', BUDGET_BOOKS.filter((b) => !existsSync(join(REPO_ROOT, b.ledger))).map((b) => b.ledger), []);
    const runFirstLines = text(`.github/workflows/${CI_WORKFLOW}`).split('\n').filter((l, i, all) => /^\s+run: \|\s*$/.test(all[i - 1] ?? '') && l.trim() === SELECTOR_STEP).length;
    t('⭐ ci.yml\'s planner and shard steps still open their run block with the selector, the step the diff base is read from', runFirstLines >= 2, true);
    t('ci.yml still names the aggregate, the shard and the planner jobs this file reads', [TEST_CORE_GATE, 'Test Core (${{ matrix.shard }}/10)', TEST_CORE_PLAN].filter((n) => !text(`.github/workflows/${CI_WORKFLOW}`).includes(`name: ${n}`)), []);
  }

  battery('PRBASE: the last green Test Core run on this PR, its log line, never a branch alone');
  {
    const ok = read(fixture());
    t('⭐ PRBASE is the diff base the shard log printed, with its reason', [ok.prbase?.sha, ok.prbase?.why, ok.prbase?.job], [BASE, 'merge-base of origin/main and HEAD', 'Test Core (1/10)']);
    t('a log line with a timestamp prefix parses; a line without a sha does not', [parseDiffBase(log()).sha, parseDiffBase('Affected-set diff base: (none)')], [BASE, null]);
    const reused = read(fixture({ runs: [{ id: 9, head_sha: sha('e'), status: 'completed', created_at: '2026-11-19T14:00:00Z' }, { id: 2, head_sha: HEAD, status: 'completed', created_at: '2026-11-19T13:00:00Z' }], jobs: { 9: greenJobs.map((j) => ({ ...j, id: j.id + 80 })), 2: greenJobs }, logs: { 92: log(sha('f')), 12: log() } }));
    t("⭐ a newer green run on the same branch name but another PR's commit is never read", [reused.prbase?.run, reused.prbase?.sha], [2, BASE]);
    const redThenGreen = read(fixture({ runs: [{ id: 3, head_sha: HEAD, status: 'completed', created_at: '2026-11-19T15:00:00Z' }, { id: 2, head_sha: OLD, status: 'completed', created_at: '2026-11-19T13:00:00Z' }], jobs: { 3: greenJobs.map((j) => (j.name === TEST_CORE_GATE ? { ...j, conclusion: 'failure' } : j)), 2: greenJobs } }));
    t('⭐ a red Test Core is skipped: the last GREEN run decides, and the row says it is not at the PR head', [redThenGreen.prbase?.run, redThenGreen.prbase?.at_head], [2, false]);
    const planOnly = read(fixture({ jobs: { 2: [job(11, 'Plan Test Core shards'), job(13, TEST_CORE_GATE)] }, logs: { 11: log() } }));
    t('with no shard log, the planner of the same run is read (it prints the same line)', planOnly.prbase?.job, TEST_CORE_PLAN);
    const running = read(fixture({ runs: [{ id: 4, head_sha: HEAD, status: 'in_progress', created_at: '2026-11-19T16:00:00Z' }, ...fixture().runs] }));
    t('a run still in progress is not the last green run', running.prbase?.run, 2);
    const otherStep = read(fixture({ logs: { 12: `${stepLine('pnpm install --frozen-lockfile')}${baseLine()}${stepLine(SELECTOR_STEP)}no line here\n` } }));
    t('⭐ the diff base is read from the selector step only: a line another step printed is not read, exit 3', [otherStep.exit, otherStep.prbase, otherStep.gaps[0]?.endsWith('carries no `Affected-set diff base` line in its selector step')], [EXIT_CANT_ANSWER, null, true]);
    const twoBases = read(fixture({ logs: { 12: `${stepLine('pnpm install --frozen-lockfile')}${baseLine(sha('e'))}${log()}` } }));
    t('⭐ a log that prints two distinct diff bases is exit 3, neither read', [twoBases.exit, twoBases.prbase, twoBases.gaps[0]?.includes('prints 2 distinct `Affected-set diff base` values')], [EXIT_CANT_ANSWER, null, true]);
    const sameTwice = read(fixture({ logs: { 12: `${stepLine('pnpm install --frozen-lockfile')}${baseLine()}${log()}${stepLine('node scripts/partition-test-shards.mjs')}` } }));
    t('the same base printed again outside the step still reads, from the selector step', [sameTwice.exit, sameTwice.prbase?.sha], [EXIT_OK, BASE]);
    t('the text names the run, the job and the reason', renderText(ok).includes(`PRBASE ${BASE.slice(0, 10)} (merge-base of origin/main and HEAD) — from \`Test Core (1/10)\` of run 2`), true);
  }

  battery('K: the count, the hold at 15, and a clone that cannot count');
  {
    t('⭐ K below the hold with clean legs is OK, exit 0', [read(fixture()).k, read(fixture()).exit], [3, EXIT_OK]);
    const k15 = read(fixture({ git: { counts: { [`${BASE}..${MAIN}`]: 15 } } }));
    t('⭐ K = 15 is merge main first, exit 1, the reason named', [k15.exit, k15.merge[0]], [EXIT_MERGE_MAIN_FIRST, 'K = 15 ≥ 15']);
    t('K = 14 is still ok', read(fixture({ git: { counts: { [`${BASE}..${MAIN}`]: 14 } } })).exit, EXIT_OK);
    const stale = read(fixture({ branch_sha: sha('9') }));
    t('⭐ a local origin/main that is not GitHub\'s main cannot count K: exit 3, the fetch named', [stale.exit, stale.gaps[0].includes('git fetch origin main')], [EXIT_CANT_ANSWER, true]);
    const shallow = read(fixture({ git: { ancestors: [] } }));
    t('⭐ a PRBASE that is not an ancestor of main in this clone is exit 3, never a count', [shallow.exit, shallow.k, shallow.gaps[0].includes('is not an ancestor of')], [EXIT_CANT_ANSWER, null, true]);
    const absent = read(fixture({ git: { commits: [] } }));
    t('a PRBASE missing from the clone is exit 3, the fetch named', [absent.exit, absent.gaps[0].includes('is not in this clone')], [EXIT_CANT_ANSWER, true]);
  }

  battery('the locale leg: a new pack after PRBASE under a label PR, at any K');
  {
    const dir = 'packages/platform-objects/src/apps/translations';
    const added = { [`${BASE}..${MAIN}`]: [`${dir}/pt-BR.ts`, `${dir}/pt-BR.objects.generated.ts`] };
    const trees = { [`${BASE}:${dir}`]: ['en.ts', 'zh-CN.ts', 'zh-CN.objects.generated.ts'] };
    const label = read(fixture({ files: ['packages/platform-objects/src/objects/account.object.ts'], git: { added, trees } }));
    t('⭐ a new locale under a label PR is merge main first at K = 3', [label.exit, label.merge.length, label.merge[0].startsWith('a new locale pack landed after PRBASE (pt-BR in packages/platform-objects/src/apps/translations)')], [EXIT_MERGE_MAIN_FIRST, 1, true]);
    const notLabel = read(fixture({ files: ['scripts/pm/x.mjs'], git: { added, trees } }));
    t('…and the same pack under a PR off the label surface is clear', [notLabel.exit, notLabel.locale.packs.length, notLabel.locale.label_hits], [EXIT_OK, 1, []]);
    const known = read(fixture({ files: ['packages/spec/src/ui/view.zod.ts'], git: { added: { [`${BASE}..${MAIN}`]: [`${dir}/zh-CN.metadata-forms.generated.ts`] }, trees } }));
    t('a file added for a locale the directory already held is no new pack', known.locale.packs, []);
    t('the label surface: a form module, spec, an example, a translation file and an extract-config package hit; a script does not', ['packages/spec/src/ui/x.form.ts', 'packages/spec/src/data/field.zod.ts', 'examples/app-todo/objectstack.config.ts', 'packages/x/translations/en.ts', 'packages/platform-objects/src/a.ts', 'scripts/pm/x.mjs'].map((p) => Boolean(labelSurfaceReader(['packages/platform-objects/'])(p))), [true, true, true, true, true, false]);
    t('the locale is the file name up to its first dot', newLocalePacks(['a/translations/ja-JP.source-hashes.generated.ts', 'a/translations/index.ts', 'a/b.ts'], () => []).packs.map((x) => x.locale), ['ja-JP']);
    const unreadFiles = read(fixture({ files: null, git: { added, trees } }));
    t('⭐ a new pack with an unread PR file list is exit 3, never a clear leg', [unreadFiles.exit, unreadFiles.gaps.some((g) => g.includes('label leg is unjudged'))], [EXIT_CANT_ANSWER, true]);
  }

  battery('the shared-budget leg: the same book on both sides, at any K');
  {
    const both = read(fixture({ files: ['skills/objectstack-data/SKILL.md'], git: { names: { [`${BASE}..${MAIN}`]: ['skills/objectstack-ui/SKILL.md'] } } }));
    t('⭐ a skills PR under a skills change on main is merge main first at K = 3', [both.exit, both.merge[0]], [EXIT_MERGE_MAIN_FIRST, 'shared budget: this PR and main after PRBASE both touch the skills token ratchet (skills/** : scripts/check-skills-token-ratchet.mjs)']);
    const ledger = read(fixture({ files: ['ui/apps/console/src/locales/en.ts'], git: { names: { [`${BASE}..${MAIN}`]: ['ui/scripts/check-eager-closure-budget.mjs'] } } }));
    t('the ledger on one side and the input on the other is the same book', [ledger.exit, ledger.merge[0].includes('ui eager-closure budget')], [EXIT_MERGE_MAIN_FIRST, true]);
    const other = read(fixture({ files: ['skills/objectstack-data/SKILL.md'], git: { names: { [`${BASE}..${MAIN}`]: ['ui/packages/x/src/locales/en.ts'] } } }));
    t('two different books never meet', [other.exit, other.budget], [EXIT_OK, { main: ['ui eager-closure budget'], pr: ['skills token ratchet'] }]);
    t('a locales file that is not en.ts is not the ui book', booksTouched(['ui/apps/console/src/locales/zh-CN.ts']), []);
    const unread = read(fixture({ files: null, git: { names: { [`${BASE}..${MAIN}`]: ['skills/a/SKILL.md'] } } }));
    t('⭐ a book moved on main with an unread PR file list is exit 3', [unread.exit, unread.gaps.some((g) => g.includes('budget leg is unjudged'))], [EXIT_CANT_ANSWER, true]);
  }

  battery('fail closed: every unread leg is exit 3, never 0');
  {
    const expired = read(fixture({ logs: { 12: null } }));
    t('⭐ an expired log is exit 3 with the job named', [expired.exit, expired.gaps[0].includes('could not be read — expired or refused (HTTP 410 Gone)')], [EXIT_CANT_ANSWER, true]);
    const noStep = read(fixture({ logs: { 12: baseLine() } }));
    t('⭐ a log with no selector step is exit 3, its line unread', [noStep.exit, noStep.gaps[0]?.endsWith(`has no \`Run ${SELECTOR_STEP}\` step`)], [EXIT_CANT_ANSWER, true]);
    const noLine = read(fixture({ logs: { 12: `${stepLine(SELECTOR_STEP)}nothing here` } }));
    t('⭐ a log without the line is exit 3', [noLine.exit, noLine.gaps[0].includes('carries no `Affected-set diff base` line')], [EXIT_CANT_ANSWER, true]);
    const noGreen = read(fixture({ jobs: { 2: greenJobs.map((j) => ({ ...j, conclusion: 'failure' })) } }));
    t('no green Test Core on the PR is exit 3', [noGreen.exit, noGreen.gaps[0].startsWith('no completed pull_request ci.yml run')], [EXIT_CANT_ANSWER, true]);
    const skipped = read(fixture({ jobs: { 2: [job(13, TEST_CORE_GATE)] } }));
    t('a green aggregate with no shard and no planner printed no base: exit 3', [skipped.exit, skipped.gaps[0].includes('no Test Core shard or planner ran in it')], [EXIT_CANT_ANSWER, true]);
    const short = read(fixture({ pr: { ...fixture().pr, changed_files: 4 } }));
    t('a PR file list shorter than the PR counts is exit 3', [short.exit, short.gaps[0]], [EXIT_CANT_ANSWER, "the PR's file list returned 1 file(s) and the PR counts 4"]);
    const noPr = read(fixture({ pr: null }));
    t('an unreadable PR is exit 3, nothing read', [noPr.exit, Boolean(noPr.prerequisite)], [EXIT_CANT_ANSWER, true]);
    const both = read(fixture({ logs: { 12: null }, git: { counts: { [`${BASE}..${MAIN}`]: 40 } } }));
    t('⭐ an unread PRBASE never yields a K at all, so no merge verdict either: exit 3', [both.exit, both.k], [EXIT_CANT_ANSWER, null]);
  }

  battery('the CLI: usage, exits and the footer');
  {
    t('--pr is required', Boolean(parseArgs([]).error), true);
    t('a malformed --pr is refused', Boolean(parseArgs(['--pr', 'x']).error), true);
    t('an unknown flag is refused, never ignored', Boolean(parseArgs(['--pr', '7', '--k', '3']).error), true);
    t('both spellings of an option are read, and #N is a PR number', [parseArgs(['--pr=7']).opts.pr, parseArgs(['--pr', '#8']).opts.pr], [7, 8]);
    const ok = quiet(main)(['--pr', '7'], { readers: fixtureReaders(fixture(), REPO) });
    t('⭐ every run names the legs it cannot read, and a clean run says OK, exit 0', [ok.code, UNREAD_LEGS.every((l) => ok.out.includes(l)), ok.out.includes('landing-k OK — K = 3 < 15')], [EXIT_OK, true, true]);
    const bad = quiet(main)(['--pr', '7'], { readers: fixtureReaders(fixture({ logs: { 12: null } }), REPO) });
    t('⭐ an unread run prints CAN\'T ANSWER and exits 3, never the OK line', [bad.code, bad.out.includes("landing-k CAN'T ANSWER"), bad.out.includes('landing-k OK')], [EXIT_CANT_ANSWER, true, false]);
    t('--json carries the exit and the verdict', JSON.parse(quiet(main)(['--pr', '7', '--json'], { readers: fixtureReaders(fixture(), REPO) }).out).exit, EXIT_OK);
  }

  const failed = cases.filter((x) => !x.ok);
  for (const f of failed) console.error(`  ✗ ${f.name} — ${f.detail}`);
  const floor = [];
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) floor.push(`the battery ledger declares ${declared.length} batteries, below its floor of ${SELF_TEST_BATTERY_FLOOR}`);
  for (const [name, count] of batteryCases) if (!(name in SELF_TEST_BATTERIES)) floor.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES`);
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) floor.push(count === 0 ? `self-test battery "${name}" DID NOT RUN` : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]}`);
  }
  for (const f of floor) console.error(`  ✗ ${f}`);
  if (failed.length || floor.length) {
    console.error(`✗ landing-k self-test: ${failed.length} of ${cases.length} case(s) failed${floor.length ? `, ${floor.length} floor breach(es)` : ''}.`);
    selfTestReachedVerdict = true;
    return EXIT_SELF_TEST_FAILED;
  }
  console.log(`✓ landing-k self-test: ${cases.length} cases pass across ${declared.length} batteries — offline, no network.`);
  selfTestReachedVerdict = true;
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error('\n✗ landing-k self-test: selfTest() returned without reaching its verdict, so no success line was\nprinted. Exiting 0 here would report a self-test that never finished as one that passed.\n');
      process.exit(1);
    }
    process.exit(code);
  } else {
    process.exit(main(argv));
  }
}
