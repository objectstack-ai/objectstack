#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-governed-merges — report-only post-merge audit of the governed
 * surfaces (#9495). Enumerates the PRs that MERGED into `main` since a given
 * date/ref whose diff touched a governed surface, with merge attribution, for
 * the PM round report and the report-only patrol family (the
 * `check-half-states.mjs` precedent: a completed sweep exits 0 whether it
 * found 0 or 40 entries; non-zero exits classify the ENVIRONMENT, not the
 * tree).
 *
 *   node scripts/pm/check-governed-merges.mjs                  # sweep, last 24h
 *   node scripts/pm/check-governed-merges.mjs --since 7d       # or 36h, or ISO date
 *   node scripts/pm/check-governed-merges.mjs --since-ref v5.0.0-rc.3
 *   node scripts/pm/check-governed-merges.mjs --json           # for round reports
 *   node scripts/pm/check-governed-merges.mjs --self-test      # offline, no network
 *
 * ## The regime this audit belongs to (maintainer ruling, 2026-08-18)
 *
 * A human merge IS the review record for a governed PR. The seat put it as
 * (verbatim): 「人工合并即人工审核:governed PR 的审核记录 = 你按下合并/入队那
 * 个动作本身」, with an after-the-fact audit replacing the always-red per-PR
 * check: 「事后审计代替事前门 … 巡检脚本列出「governed 面合并清单」,出现在轮
 * 次报告里。清单上每一条都应该对应你的一次亲手合并;出现任何一条你不认识的 ⇒
 * 席位违规,立案回滚」. The maintainer's reply: 「同意。」
 *
 * So the contract of this list is: EVERY entry should correspond to a merge
 * the maintainer performed or ordered in person. An entry the maintainer does
 * not recognise is the violation signal — a seat merged, enqueued, or armed
 * auto-merge on a governed PR. That is filed as an incident and rolled back;
 * this script only surfaces the list, it judges nothing.
 *
 * The pre-merge line of defense is DISCIPLINE, not machinery: agent seats
 * never flip ready, never enqueue, never arm auto-merge on a governed PR
 * (AGENTS.md Prime Directive #14; pm-dispatch SKILL.md ACCEPT fork). The
 * per-PR check that used to sit beside that discipline — `ADR maintainer
 * approval`, `.github/workflows/adr-merge-approval.yml` +
 * `scripts/check-adr-merge-approval.mjs` — was retired by the same ruling:
 * it was red on every governed PR by design (红灯常态化本身有毒 — a
 * permanently red check trains everyone to ignore red), it sat OUTSIDE the
 * required-context set (attested by the maintainer's own reading of the
 * ruleset, 2026-08-18: exactly six required contexts, this one not among
 * them; confirmed empirically the same day when a PR carrying the check at
 * `conclusion: failure` with zero approving reviews landed through the merge
 * queue), and so it never actually blocked anything.
 *
 * ## The governed surface (unified definition, maintainer 「同意」 2026-08-18)
 *
 * Asked 「任何对 agents.md 等文件的修改是不是也需要人类审核?」 the maintainer
 * approved the seat's unified list, verbatim: 「`docs/adr/**` + `.claude/**`
 * (含 agents/hooks/settings,不只 skills)+ `skills/**` + `AGENTS.md` +
 * `CLAUDE.md`。混合 diff 照现行规则一条命中即整 PR 分叉」. The two file
 * entries are the REPO-ROOT instruction files exactly — not
 * `examples/AGENTS.md` (an example-tree file) and not the
 * `create-objectstack` template copy (product content); widening to those, or
 * to the sibling repos (objectui / cloud carry the same convention in their
 * own AGENTS.md), is a separate decision this script does not take.
 *
 * ## Institutional memory — why governed surfaces are guarded at all
 *
 * This history moved here from the retired gate's header when the gate
 * retired; it is the case law behind the discipline, not dead weight.
 *
 * - 2026-08-08, #6741 (maintainer, verbatim): 「adr 只能由维护者自己确认,
 *   人工合并,ai 不得擅自合并。」 Filed at 13:52Z. Within the following hour
 *   two DIFFERENT AI-operated seats merged docs/adr/** PRs anyway — one at
 *   14:23Z, one at 14:38Z, the second while the PR was in DRAFT state — both
 *   with ZERO reviews of any kind. Measured lessons: a ruling written into an
 *   issue does not reach sessions that never read that issue, and parking a
 *   PR as draft is not a barrier either.
 * - 2026-08-12, #8161: the gate's original identity proxy ("the maintainer's
 *   own account approved") became unsatisfiable — human and agent GitHub
 *   accounts are not stably partitioned (maintainer: 「人工专属账号 和 agent
 *   账户一直在切换,暂时没固定」), cloud sessions began authoring under the
 *   maintainer's own account, and GitHub forbids self-approval — so the gate
 *   was permanently red exactly when the human WAS driving. Ruling, verbatim:
 *   「门禁改成只要求「APPROVED review 存在」」/「不要指定具体的人」. Accepted
 *   cost, stated out loud then and still true: no identity-based signal can
 *   prove a review is human — an AI seat's approval satisfied the reworked
 *   gate too, which is half of why the per-PR gate ultimately retired.
 * - 2026-08-12, #8012: an AI seat ENABLED AUTO-MERGE on a live docs/adr/**
 *   PR at ~11:15Z. Arming is not merging — it is a standing instruction to
 *   merge later, and the next approving review would have merged the PR
 *   unattended with every check green. Hence the discipline names arming
 *   alongside merging and enqueueing, and armed+approved — not
 *   armed+unapproved — is the state in which the unattended merge actually
 *   fires. Disarming alone does not dequeue: converting the PR back to draft
 *   is what removes it from the merge queue.
 * - 2026-08-17, #9319 (from PR #9238): a `.claude/skills/**` PR whose own
 *   body said "draft, awaiting a human merge" was flipped ready and enqueued
 *   by an unidentified seat, and the merge queue landed it with ZERO reviews.
 *   All seats share one GitHub login, so "which seat flipped it" was not
 *   forensically answerable. The skill files are the operating protocol every
 *   LATER dispatch reads, so a bad landing there propagates into work nobody
 *   has started yet — that is why the governed surface covers the agent
 *   instruction tree, and (2026-08-18) the repo-root instruction files too.
 *
 * ## Attribution readings, measured not assumed
 *
 * `merged_by` on this repo attributes to the human account for BOTH merge
 * flows (measured 2026-08-18: a queue-flow landing and a direct merge both
 * read `merged_by: hotlong`). If a future reading ever shows a bot login
 * here, report it verbatim and extend the audit to read the enqueue actor
 * from the issue timeline (`added_to_merge_queue`) — never remap silently.
 * A mainline commit whose subject names NO PR is listed as its own loud
 * entry (a direct push to `main` is more anomalous than any PR merge, not
 * less).
 *
 * ## Cost discipline
 *
 * Enumeration and diff-path reading are pure LOCAL git over `origin/main` —
 * zero API calls; the sweep header prints the `origin/main` tip and its date
 * so a stale local fetch is visible rather than silently under-reporting
 * (run `git fetch origin main` first). The GitHub API is consulted only for
 * ATTRIBUTION, one `GET /pulls/{n}` per governed entry — on the ordinary day
 * with no governed merges the sweep costs ZERO lookups. With entries present
 * but no usable token the sweep still prints the list, marks attribution
 * UNRESOLVED, and exits 2 (environment) — a list whose whole point is "does
 * the maintainer recognise every entry" is incomplete without the
 * who-merged-it column, and incomplete must not read as clean (#4690).
 *
 * Exit codes: 0 = sweep complete (with or without entries); 1 = could not
 * sweep (bad args, git failure); 2 = swept, but attribution could not be
 * resolved for at least one entry (missing token / HTTP failure).
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * The governed surfaces, in report order — the 2026-08-18 unified definition
 * (see header). `prefix` entries match path prefixes; `exact` entries match
 * one repo-relative path byte-for-byte (the repo-ROOT instruction files, not
 * `examples/AGENTS.md`, not template copies). One path hit governs a whole
 * PR — 「混合 diff 一条命中即整 PR 分叉」; proportion is never a question.
 */
export const GOVERNED_SURFACES = Object.freeze([
  Object.freeze({ id: 'adr', prefix: 'docs/adr/', glob: 'docs/adr/**', what: 'architecture decision records' }),
  Object.freeze({ id: 'claude-tree', prefix: '.claude/', glob: '.claude/**', what: 'the agent instruction tree (skills, agents, hooks, settings)' }),
  Object.freeze({ id: 'skills-catalog', prefix: 'skills/', glob: 'skills/**', what: 'the published skills catalog' }),
  Object.freeze({ id: 'agents-md', exact: 'AGENTS.md', glob: 'AGENTS.md', what: 'the repo-root agent instruction file' }),
  Object.freeze({ id: 'claude-md', exact: 'CLAUDE.md', glob: 'CLAUDE.md', what: 'the repo-root Claude instruction file' }),
]);

/**
 * The governed slice of a path list, grouped by surface. Surfaces with no hit
 * are absent — `matched.length === 0` IS the clean path.
 */
export function governedPathsIn(paths) {
  const list = Array.isArray(paths) ? paths : [];
  return GOVERNED_SURFACES.map((surface) => ({
    ...surface,
    files: list.filter((p) =>
      typeof p === 'string' && (surface.prefix ? p.startsWith(surface.prefix) : p === surface.exact),
    ),
  })).filter((surface) => surface.files.length > 0);
}

/**
 * The PR number a mainline commit subject names, in either spelling GitHub
 * writes: a merge commit's `Merge pull request #N from ...` or a squash
 * commit's trailing `(#N)` (a subject citing an issue mid-title keeps only
 * the TRAILING parenthetical — that one is the PR).
 */
export function pullNumberFromSubject(subject) {
  if (typeof subject !== 'string') return null;
  let m = /^Merge pull request #(\d+)\b/.exec(subject);
  if (m) return Number(m[1]);
  m = /\(#(\d+)\)\s*$/.exec(subject.trim());
  if (m) return Number(m[1]);
  return null;
}

/**
 * `--since` in three spellings: `<N>d` / `<N>h` relative to `now`, or an ISO
 * date/datetime taken verbatim. Returns an ISO string, or null on nonsense —
 * a window this sweep cannot parse is a hard failure, never a default.
 */
export function parseSince(arg, now = new Date()) {
  if (typeof arg !== 'string' || arg === '') return null;
  const rel = /^(\d+)([dh])$/.exec(arg);
  if (rel) {
    const ms = Number(rel[1]) * (rel[2] === 'd' ? 86_400_000 : 3_600_000);
    return new Date(now.getTime() - ms).toISOString();
  }
  const t = Date.parse(arg);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * One sweep entry from one mainline commit. Pure: the caller supplies the
 * commit row and its changed paths; attribution is stitched on later.
 */
export function classifyCommit({ sha, date, subject }, changedPaths) {
  const surfaces = governedPathsIn(changedPaths);
  if (surfaces.length === 0) return null;
  return { sha, date, subject, pr: pullNumberFromSubject(subject), surfaces };
}

// ── local git (enumeration + diff paths; zero API) ──────────────────────────

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** First-parent mainline commits of `ref` since `sinceIso`, newest first. */
export function mainlineCommits(root, ref, sinceIso) {
  const out = git(root, ['log', '--first-parent', `--since=${sinceIso}`, '--format=%H%x09%cI%x09%s', ref]);
  return out
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => {
      const [sha, date, ...rest] = l.split('\t');
      return { sha, date, subject: rest.join('\t') };
    });
}

/** The paths a mainline commit changed, against its first parent. */
export function commitPaths(root, sha) {
  const out = git(root, ['diff-tree', '-r', '--no-commit-id', '--no-renames', '--name-only', '-m', '--first-parent', sha]);
  return out.split('\n').filter((p) => p !== '');
}

// ── attribution (the only API surface) ──────────────────────────────────────

function apiContext(env) {
  return {
    apiUrl: (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, ''),
    repo: env.GITHUB_REPOSITORY ?? 'objectstack-ai/objectstack',
    token: env.GITHUB_TOKEN || env.GH_TOKEN || null,
  };
}

/** One PR read, for `merged_by` / `merged_at`. Throws on any failure. */
async function fetchPullAttribution({ apiUrl, repo, token }, pull) {
  const url = `${apiUrl}/repos/${repo}/pulls/${pull}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (error) {
    throw new Error(`GET ${url} failed: ${error?.message ?? error}`);
  }
  if (!res.ok) throw new Error(`GET ${url} answered HTTP ${res.status}`);
  const body = await res.json();
  return { mergedBy: body?.merged_by?.login ?? null, mergedAt: body?.merged_at ?? null, title: body?.title ?? null };
}

// ── rendering ───────────────────────────────────────────────────────────────

/** The whole report as text — pure, so --self-test asserts on the words. */
export function renderReport({ sinceIso, tip, scanned, entries, lookups }) {
  const head =
    `governed-merges sweep: ${entries.length} governed merge(s) since ${sinceIso}\n` +
    `  scanned ${scanned} mainline commit(s) on origin/main (tip ${tip.sha.slice(0, 9)} @ ${tip.date}); ${lookups} API lookup(s).\n` +
    `  Every entry below should correspond to a merge the maintainer performed or ordered in person.\n` +
    `  An entry the maintainer does not recognise is the violation signal — file it as an incident (#9495 regime).`;
  if (entries.length === 0) return `${head}\n  ✅  clean window — no governed surface was merged.`;
  const lines = entries.map((e) => {
    const surfaces = e.surfaces.map((s) => `${s.glob} ×${s.files.length}`).join(', ');
    const who = e.attribution
      ? `merged_by ${e.attribution.mergedBy ?? '(none)'} @ ${e.attribution.mergedAt ?? '(unknown)'}`
      : `merged_by UNRESOLVED${e.attributionError ? ` (${e.attributionError})` : ''}`;
    const prName = e.pr != null ? `PR #${e.pr}` : '⚠️  NO PR NUMBER IN SUBJECT — direct push to main? investigate';
    const files = e.surfaces.flatMap((s) => s.files.slice(0, 6)).slice(0, 8);
    return `  • ${prName} — ${e.subject}\n      commit ${e.sha.slice(0, 9)} @ ${e.date}; ${who}\n      surfaces: ${surfaces}\n${files.map((f) => `        - ${f}`).join('\n')}`;
  });
  return `${head}\n${lines.join('\n')}`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const argOf = (name) => {
    const i = args.indexOf(name);
    return i > -1 ? args[i + 1] : null;
  };
  const root = resolve(argOf('--root') ?? resolve(scriptDir, '..', '..'));
  const ref = 'origin/main';

  let sinceIso;
  const sinceRef = argOf('--since-ref');
  if (sinceRef) {
    try {
      sinceIso = git(root, ['log', '-1', '--format=%cI', `${sinceRef}^{commit}`]).trim();
    } catch {
      console.error(`❌  --since-ref '${sinceRef}' does not resolve to a commit.`);
      return 1;
    }
  } else {
    sinceIso = parseSince(argOf('--since') ?? '24h');
    if (!sinceIso) {
      console.error(`❌  --since wants <N>d, <N>h, or an ISO date; got '${argOf('--since')}'.`);
      return 1;
    }
  }

  let tip;
  let commits;
  try {
    const [sha, date] = git(root, ['log', '-1', '--format=%H%x09%cI', ref]).trim().split('\t');
    tip = { sha, date };
    commits = mainlineCommits(root, ref, sinceIso);
  } catch (error) {
    console.error(`❌  cannot read ${ref}: ${error.message}\n    Run \`git fetch origin main\` and re-run — a sweep over an unreadable ref is a failure, never a clean window.`);
    return 1;
  }

  const entries = [];
  for (const commit of commits) {
    const entry = classifyCommit(commit, commitPaths(root, commit.sha));
    if (entry) entries.push(entry);
  }

  // Attribution — the only API surface, and only when there is something to
  // attribute. Failures are per-entry-loud and classify the sweep incomplete.
  const ctx = apiContext(process.env);
  let lookups = 0;
  let attributionFailed = false;
  for (const entry of entries) {
    if (entry.pr == null) continue; // its own loud entry; nothing to look up
    try {
      lookups += 1;
      entry.attribution = await fetchPullAttribution(ctx, entry.pr);
    } catch (error) {
      attributionFailed = true;
      entry.attributionError = error.message;
    }
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify({ since: sinceIso, tip, scanned: commits.length, complete: !attributionFailed, entries }, null, 2));
  } else {
    console.log(renderReport({ sinceIso, tip, scanned: commits.length, entries, lookups }));
  }
  if (attributionFailed) {
    console.error(
      '\n⚠️  attribution incomplete — at least one entry has no merged_by reading (see above). The list is\n' +
        '    printed, but "does the maintainer recognise every entry" cannot be answered without the who-merged-it\n' +
        '    column, and incomplete must not read as clean (#4690). Provide GITHUB_TOKEN / GH_TOKEN and re-run.',
    );
    return 2;
  }
  return 0;
}

if (invokedDirectly && !process.argv.includes('--self-test')) {
  process.exitCode = await main();
}

// ── self-test (offline: pure functions + replay fixtures) ───────────────────

/**
 * Replay fixtures — the measured violations this audit regime descends from
 * (see the header's institutional-memory section), plus the first two merges
 * of the new regime. Real path lists and subjects, not imitations. Predicted
 * direction: every one of them LISTS — under a post-merge audit the healthy
 * and the violating merge look identical on the list; the maintainer's
 * recognition, not the script, is the judgement.
 */
const REPLAYS = [
  { name: 'the 14:23Z ADR merge of 2026-08-08 (zero reviews)', subject: 'docs(adr): cross-package metadata collision (#6671)', files: ['docs/adr/0048-cross-package-metadata-collision.md'], pr: 6671 },
  { name: 'the 14:38Z draft-state ADR merge of 2026-08-08', subject: 'docs(adr): record display name (#6732)', files: ['docs/adr/0079-record-display-name.md', 'scripts/check-adr-anchors.mjs'], pr: 6732 },
  { name: 'the queue-landed skills PR of 2026-08-17 (zero reviews)', subject: 'docs(pm-skill): seat protocol updates (#9238)', files: ['.claude/skills/pm-dispatch/SKILL.md', '.claude/skills/pm-dispatch/references/platform-readings.md'], pr: 9238 },
  { name: 'the first human merge under the new regime', subject: 'docs(pm-skill): stale-premise check covers ruling-named cards; triage self-exit guard sees in-flight sibling rounds (#9501)', files: ['.claude/skills/pm-dispatch/SKILL.md'], pr: 9501 },
];

function selfTest() {
  let checked = 0;
  const failures = [];
  const assert = (name, cond, detail) => {
    checked++;
    if (!cond) failures.push(`${name}: ${detail ?? ''}`);
  };

  // ── the governed predicate: the 2026-08-18 unified list, exactly ──────────
  const ids = (paths) => governedPathsIn(paths).map((s) => s.id);
  assert('all-five-surfaces-declared-in-order', GOVERNED_SURFACES.map((s) => s.id).join(',') === 'adr,claude-tree,skills-catalog,agents-md,claude-md', GOVERNED_SURFACES.map((s) => s.id).join(','));
  assert('adr-prefix', ids(['docs/adr/0001-x.md']).join() === 'adr');
  assert('whole-claude-tree-not-only-skills', ids(['.claude/hooks/guard-main-checkout.sh', '.claude/agents/os-dev.md', '.claude/settings.json']).join() === 'claude-tree');
  assert('published-skills-catalog-is-governed', ids(['skills/objectstack-ui/SKILL.md']).join() === 'skills-catalog');
  assert('root-agents-md-exact', ids(['AGENTS.md']).join() === 'agents-md');
  assert('root-claude-md-exact', ids(['CLAUDE.md']).join() === 'claude-md');
  // Near misses, each load-bearing: prefixes need their trailing slash; the
  // exact entries are the repo-root files only (see header).
  assert('near-misses-stay-out', ids(['docs/adrs/z.md', '.claude-x/y.md', 'skillsx/a.md', 'examples/AGENTS.md', 'packages/create-objectstack/src/templates/AGENTS.md', 'apps/CLAUDE.md.bak']).length === 0, JSON.stringify(ids(['examples/AGENTS.md'])));
  assert('a-mixed-diff-groups-by-surface', ids(['docs/adr/0001.md', 'AGENTS.md', 'package.json']).join() === 'adr,agents-md');

  // ── subject → PR (both GitHub spellings; the trailing parenthetical wins) ─
  assert('squash-subject', pullNumberFromSubject('fix(api): envelope the error paths (#9456)') === 9456);
  assert('merge-subject', pullNumberFromSubject('Merge pull request #123 from x/y') === 123);
  assert('mid-title-issue-citation-is-not-the-pr', pullNumberFromSubject('docs: checklist names the renamed check run (#9420) (#9490)') === 9490);
  assert('no-pr-in-subject', pullNumberFromSubject('chore: direct push') === null);

  // ── --since parsing ───────────────────────────────────────────────────────
  const now = new Date('2026-08-18T12:00:00Z');
  assert('since-hours', parseSince('24h', now) === '2026-08-17T12:00:00.000Z');
  assert('since-days', parseSince('7d', now) === '2026-08-11T12:00:00.000Z');
  assert('since-iso', parseSince('2026-08-01', now) !== null);
  assert('since-nonsense-is-null-never-a-default', parseSince('yesterday', now) === null);

  // ── classification + replay fixtures ─────────────────────────────────────
  assert('ungoverned-commit-classifies-null', classifyCommit({ sha: 'a'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'fix: x (#1)' }, ['packages/spec/src/index.ts']) === null);
  for (const replay of REPLAYS) {
    const entry = classifyCommit({ sha: 'b'.repeat(40), date: '2026-08-18T00:00:00Z', subject: replay.subject }, replay.files);
    assert(`replay-lists: ${replay.name}`, entry !== null && entry.pr === replay.pr, JSON.stringify(entry));
  }

  // ── the report words an operator reads ────────────────────────────────────
  const tip = { sha: 'c'.repeat(40), date: '2026-08-18T00:00:00Z' };
  const clean = renderReport({ sinceIso: '2026-08-17T00:00:00Z', tip, scanned: 12, entries: [], lookups: 0 });
  assert('clean-window-says-clean-and-costs-zero-lookups', clean.includes('clean window') && clean.includes('0 API lookup(s)'), clean);
  const noPr = classifyCommit({ sha: 'd'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'chore: direct push' }, ['AGENTS.md']);
  const loud = renderReport({ sinceIso: '2026-08-17T00:00:00Z', tip, scanned: 3, entries: [noPr], lookups: 0 });
  assert('a-pr-less-mainline-commit-is-its-own-loud-entry', loud.includes('NO PR NUMBER IN SUBJECT'), loud);
  const unresolved = renderReport({ sinceIso: '2026-08-17T00:00:00Z', tip, scanned: 3, entries: [{ ...classifyCommit({ sha: 'e'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'docs: x (#9501)' }, ['AGENTS.md']), attributionError: 'no token' }], lookups: 0 });
  assert('unresolved-attribution-is-printed-not-hidden', unresolved.includes('UNRESOLVED') && unresolved.includes('no token'), unresolved);
  assert('the-violation-contract-is-stated-on-every-sweep', clean.includes('violation signal') && loud.includes('violation signal'));

  if (failures.length > 0) {
    console.error(`✗ check-governed-merges --self-test — ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(`✓ check-governed-merges --self-test: ${checked} assertions (the unified governed predicate + near misses, subject→PR spellings, window parsing, the replay fixtures, and the report wording pins).`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
}
