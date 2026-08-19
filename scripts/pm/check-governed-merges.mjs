#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-governed-merges — report-only post-merge audit of the governed
 * surfaces (#9495), across the four governed repos (#9619), plus the
 * pre-arm `--test` predicate every seat runs before flipping ready (#9550).
 * Enumerates the PRs that MERGED into `main` since a given date/ref whose diff
 * touched a governed surface, with merge attribution, for the PM round report
 * and the report-only patrol family (the `check-half-states.mjs` precedent: a
 * completed sweep exits 0 whether it found 0 or 40 entries; non-zero exits
 * classify the ENVIRONMENT, not the tree).
 *
 *   node scripts/pm/check-governed-merges.mjs                  # sweep, last 24h, all four repos
 *   node scripts/pm/check-governed-merges.mjs --since 7d       # or 36h, or ISO date
 *   node scripts/pm/check-governed-merges.mjs --since-ref v5.0.0-rc.3
 *   node scripts/pm/check-governed-merges.mjs --repos objectstack,objectui
 *   node scripts/pm/check-governed-merges.mjs --repo-root cloud=/srv/cloud
 *   node scripts/pm/check-governed-merges.mjs --json           # for round reports
 *   node scripts/pm/check-governed-merges.mjs --test AGENTS.md src/x.ts   # pre-arm predicate
 *   node scripts/pm/check-governed-merges.mjs --self-test      # offline, no network
 *
 * ## Exit codes — the refusal to read as clean, in one table
 *
 * Sweep mode (default):
 *   0  swept COMPLETELY — every governed repo audited, every entry attributed.
 *      Zero entries and forty entries both exit 0; the list is the product.
 *   1  could not sweep at all — bad args, unreadable `--since-ref`.
 *   2  swept, but INCOMPLETE — at least one repo unaudited (no checkout, wrong
 *      origin, unreadable `origin/main`) and/or at least one entry's
 *      attribution unresolved on every channel. Incomplete must never read as
 *      clean (#4690): an unaudited repo is not a repo with nothing to report,
 *      and a list whose whole point is "does the maintainer recognise every
 *      entry" is incomplete without the who-merged-it column.
 *
 * `--test` mode is a PREDICATE, so it answers on its own codes and shares only
 * the failure code with the sweep:
 *   0  the given paths are NOT governed — ordinary queue landing applies.
 *   3  the given paths ARE governed — human merge only. Deliberately NOT 1 or
 *      2: a governed verdict must be impossible to confuse with the sweep's
 *      "could not sweep" / "incomplete", so `if cmd; then` and `$?` readings
 *      cannot silently turn a governed answer into an environment complaint.
 *   1  bad args — no paths given. ⛔ Silence never reads as "not governed":
 *      `--test` with an empty path list is a failure, never a green light.
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
 * `create-objectstack` template copy (product content).
 *
 * ## The governed REPOS (maintainer 「同意」 2026-08-18, wired here by #9619)
 *
 * The same day, asked whether the rule reaches the sibling repos — 「任何对
 * agents.md 等文件的修改…包括 objectui cloud仓库」 — the maintainer answered
 * 「同意」. So the surface register above is REPO-AGNOSTIC: the same five
 * globs are governed in `objectstack`, `objectui`, `cloud` and `objectos`,
 * and this sweep covers all four in one invocation regardless of the working
 * directory it is run from.
 *
 * ⚠️ Until #9619 that was not true, and the gap was not theoretical: run from
 * the objectui checkout the sweep still enumerated objectstack PRs, so a
 * governed merge in objectstack showed up and the identical merge in objectui
 * did not. objectui PR #5188 (`AGENTS.md` + `skills/**`) landed on
 * 2026-08-18 and appeared in no audit output at all — a seat happened to
 * catch it reading `git log` by hand.
 *
 * Sibling repos are not always checked out. An absent checkout reports as
 * **UNAUDITED** and exits 2 — never as a clean repo (#4690). "Nothing was
 * found" and "nothing was looked at" are different facts and this sweep is
 * required to keep them apart.
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
 * - 2026-08-18, #9550 — the first datapoint on the bet this regime made, and
 *   it arrived NINETEEN MINUTES in. Measured timeline, one file in the diff
 *   (`AGENTS.md`, PR #9527): 07:32:55Z #9495 lands (86ea8df7d) and the
 *   repo-root instruction files become governed → 07:51:53Z a PM seat flips
 *   the PR `ready_for_review` (+19 min) → 07:52:06Z the same seat enqueues it
 *   (+13 s) → 08:08:35Z `github-merge-queue[bot]` removes it, on a merge
 *   CONFLICT against 86ea8df7d, the very commit that had made the file
 *   governed → 08:52:08Z another seat converts it back to draft. Both the
 *   flip and the enqueue are forbidden on a governed PR. ⭐ The conflict, not
 *   the discipline, is what stopped it: had #9495 touched a different part of
 *   `AGENTS.md`, this would be a governed merge nobody authorised. The seat's
 *   own root cause, verbatim from its own report: at the moment of arming it
 *   reasoned 「`AGENTS.md` is none of those. So arming is fine」 — RECALL of a
 *   register that had changed 19 minutes earlier, not DERIVATION from it, by
 *   the same seat that had written "re-read it rather than recalling it" into
 *   a dispatch prompt hours before. ⇒ That is the whole reason `--test`
 *   exists: derivation is now ONE command, so a seat cannot be wrong about a
 *   list it never re-read. Detection existed; this is the missing prevention
 *   primitive, and it costs one process spawn.
 *
 * ## Attribution readings, measured not assumed
 *
 * ⚠️ Read this before treating a resolved `merged_by` as an answer.
 * `merged_by` names an ACCOUNT, not a PRINCIPAL, and the two do not
 * correspond: the maintainer also operates the seat accounts. Measured
 * 2026-08-18 — objectui PR #5188, a governed-surface merge, read
 * `merged_by: os-steve` (a seat account) and was filed as a possible seat
 * violation; asked directly, the maintainer answered 「5188 是我合并的」. So a
 * token that resolves the column would NOT have answered the question; it
 * would have returned a seat login and left the audit exactly as uncertain,
 * while looking authoritative. The column is a PROMPT for the maintainer's
 * recognition, never a substitute for it — which is why the report prints
 * that caveat on every sweep that resolves anything, and why the fix for the
 * 401 wall (below) is a channel chain, not a claim of authority.
 * This is the same shared-identity trap the claim protocol documents, where
 * the workaround is the session ID inside the claim comment; a merge carries
 * no equivalent discriminator, and inventing one is a maintainer decision
 * this script does not take (#9619 records the three options).
 * On this repo `merged_by` has read as the human account for BOTH merge flows
 * (measured 2026-08-18: a queue-flow landing and a direct merge both read
 * `merged_by: hotlong`). If a future reading shows a bot login, report it
 * verbatim and extend the audit to read the enqueue actor from the issue
 * timeline (`added_to_merge_queue`) — never remap silently. A mainline commit
 * whose subject names NO PR is listed as its own loud entry (a direct push to
 * `main` is more anomalous than any PR merge, not less).
 *
 * ### The attribution channel chain (#9619, measured on the PM container)
 *
 * The PM session container exports no usable `GITHUB_TOKEN`/`GH_TOKEN` —
 * GitHub reaches it through the MCP server, not the raw API — so the old
 * single-channel read answered HTTP 401 for EVERY entry and the sweep's
 * default outcome was "incomplete". An audit that always degrades to
 * incomplete is one a reader learns to skim, which is how a real violation
 * gets waved through. Channels are therefore tried in order and the first
 * success wins:
 *
 *   1. env token — `GITHUB_TOKEN` / `GH_TOKEN`, when one is exported.
 *   2. anonymous REST — no `authorization` header at all. Measured working
 *      2026-08-18 for the public repos (`objectstack`, `objectui` and
 *      `objectos` all answered 200 with `merged_by` populated); `cloud`
 *      answered 403 at the session proxy, which is exactly the case the named
 *      fallback line below is for.
 *
 * ⚠️ NEITHER channel reaches GitHub at all unless node's fetch is pointed at
 * the session proxy, and this is the trap that made the original 401 reading
 * look like a token problem when it was a TRANSPORT problem. Measured
 * 2026-08-18 in the PM container, all four readings on the same URL:
 *
 *   curl (reads HTTPS_PROXY)                        → 200, merged_by present
 *   node fetch, no flag, anonymous                  → 403
 *   node fetch, no flag, with the env token         → 401
 *   node fetch, NODE_OPTIONS=--use-env-proxy        → 200, merged_by present
 *
 * Node's global fetch does NOT read `HTTPS_PROXY` on its own (Node 22), so a
 * curl probe proves nothing about what this script will see — and the env
 * token in an agent container is the literal string `proxy-injected`, a
 * placeholder the PROXY swaps for a real credential. Bypass the proxy and it
 * is a bad token (401); go through the proxy and both channels answer 200.
 * `scripts/check-required-contexts.mjs` hit the identical trap (#9642) and
 * names this file as sharing it. `--use-env-proxy` must be set at process
 * start — assigning `process.env.NODE_USE_ENV_PROXY` from inside the script
 * is too late (measured: still 403) — so sweep mode RE-EXECS itself once with
 * the flag when a proxy is configured and the flag is absent, guarded by
 * `process.allowedNodeEnvironmentFlags` so an older node gets the printed
 * hint instead of a bad-option crash. `--test` and `--self-test` never
 * re-exec: they touch no network.
 *
 * When every channel fails for an entry, the entry still prints (marked
 * UNAVAILABLE, never silently blank) and the reason is stated ONCE per
 * repo+reason group as a NAMED line that says which channels were tried and
 * what each answered — instead of the per-entry error string that used to
 * bury the list it was attached to. The sweep still exits 2.
 *
 * ## Cost discipline
 *
 * Enumeration and diff-path reading are pure LOCAL git over each repo's
 * `origin/main` — zero API calls; the sweep header prints every audited
 * repo's tip and date so a stale local fetch is visible rather than silently
 * under-reporting (run `git fetch origin main` in each first). A repo with no
 * mainline commit in the window prints a note naming its tip date: local git
 * cannot distinguish "quiet repo" from "stale mirror", so the note is
 * informational and does not change the exit code — read the tip date, and
 * fetch if it predates your last one. The GitHub API is consulted only for
 * ATTRIBUTION, one `GET /pulls/{n}` per governed entry — on the ordinary day
 * with no governed merges the sweep costs ZERO lookups. `--test` never
 * touches the network or git at all: it reads the register in this file.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);

/** The exit contract, named so the table above is machine-checkable. */
export const EXIT_SWEPT = 0;
export const EXIT_CANNOT_SWEEP = 1;
export const EXIT_INCOMPLETE = 2;
export const EXIT_TEST_GOVERNED = 3;
export const EXIT_TEST_NOT_GOVERNED = 0;

/**
 * The governed surfaces, in report order — the 2026-08-18 unified definition
 * (see header). `prefix` entries match path prefixes; `exact` entries match
 * one repo-relative path byte-for-byte (the repo-ROOT instruction files, not
 * `examples/AGENTS.md`, not template copies). One path hit governs a whole
 * PR — 「混合 diff 一条命中即整 PR 分叉」; proportion is never a question.
 * The register is repo-agnostic: it applies in all of `GOVERNED_REPOS`.
 */
export const GOVERNED_SURFACES = Object.freeze([
  Object.freeze({ id: 'adr', prefix: 'docs/adr/', glob: 'docs/adr/**', what: 'architecture decision records' }),
  Object.freeze({ id: 'claude-tree', prefix: '.claude/', glob: '.claude/**', what: 'the agent instruction tree (skills, agents, hooks, settings)' }),
  Object.freeze({ id: 'skills-catalog', prefix: 'skills/', glob: 'skills/**', what: 'the published skills catalog' }),
  Object.freeze({ id: 'agents-md', exact: 'AGENTS.md', glob: 'AGENTS.md', what: 'the repo-root agent instruction file' }),
  Object.freeze({ id: 'claude-md', exact: 'CLAUDE.md', glob: 'CLAUDE.md', what: 'the repo-root Claude instruction file' }),
]);

/**
 * The register's repo-ROOT rows, declared for `scripts/pm/dispatch-gates.mjs`
 * (#9979, applying #9964's pattern).
 *
 * That tool derives a card's gate list from the path literals in each gate's
 * own source, and "looks like a path" there means "carries a separator". The
 * three `prefix` rows above have one and reach dispatch-gates already — the
 * `skills/**` row is one of the three specimens that motivated reading a hint
 * AS WRITTEN. The two `exact` rows do not: a repo-root FILE carries no
 * separator, so an `AGENTS.md` or `CLAUDE.md` card derived this gate not at all
 * while the same card is GOVERNED by it (draft-only PR, maintainer merge) —
 * the loudest possible thing to learn late.
 *
 * `<file>/**` is the form that reaches one: the extractor accepts it, and
 * `collapseHint` reduces it back to that single path. `examples/AGENTS.md` and
 * the `create-objectstack` template copy stay out, exactly as the `exact` rows
 * intend.
 *
 * ⚠️ Provenance, NOT a matcher. `governedSlice` compares against `exact`, and
 * `glob` is the spelling the instruction files must carry verbatim
 * (`check-governed-prose.mjs` asserts prose containment against it, and both
 * files spell these two as bare filenames). Rewriting either field into the
 * glob form would silently change what this register GOVERNS and what the
 * prose gate demands; this list is read by neither. The self-test pins both
 * halves.
 */
export const ROOT_FILE_WATCH_HINTS = ['AGENTS.md/**', 'CLAUDE.md/**'];

/**
 * The four repos the 2026-08-18 cross-repo extension governs. `id` doubles as
 * the sibling directory name beside this checkout — the layout every session
 * container uses — and `--repo-root <id>=<path>` overrides it for any other
 * layout. A checkout whose `origin` remote is not `slug` is treated as ABSENT
 * (unaudited), never audited under the wrong name.
 */
export const GOVERNED_REPOS = Object.freeze([
  Object.freeze({ id: 'objectstack', slug: 'objectstack-ai/objectstack', what: 'the framework repo (this script lives here)' }),
  Object.freeze({ id: 'objectui', slug: 'objectstack-ai/objectui', what: 'the UI repo (live skills/** tree)' }),
  Object.freeze({ id: 'cloud', slug: 'objectstack-ai/cloud', what: 'the cloud repo' }),
  Object.freeze({ id: 'objectos', slug: 'objectstack-ai/objectos', what: 'the objectos repo' }),
]);

export const SELF_REPO_ID = 'objectstack';

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

/** `owner/name` out of any git remote spelling, or null. Pure. */
export function slugFromRemote(url) {
  const m = /(?:github\.com[:/])([\w.-]+\/[\w.-]+?)(?:\.git)?\/*\s*$/.exec(String(url ?? ''));
  return m ? m[1] : null;
}

/**
 * Where each governed repo's checkout is, and whether it can be audited at
 * all. Pure: `probe(path)` answers `{ exists, slug }`, so the whole
 * absent/wrong-origin/present fork is offline-testable. An unresolvable repo
 * is `status: 'unaudited'` with a stated reason — the #4690 rule in code:
 * absence must be loud, and must never render as a clean repo.
 */
export function resolveRepoCheckouts({ repos = GOVERNED_REPOS, selfId = SELF_REPO_ID, selfRoot, siblingDir, overrides = {}, probe }) {
  return repos.map((repo) => {
    const candidate = overrides[repo.id] ?? (repo.id === selfId ? selfRoot : join(siblingDir, repo.id));
    const seen = probe(candidate) ?? { exists: false, slug: null };
    if (!seen.exists) {
      return { ...repo, path: candidate, status: 'unaudited', reason: `no git checkout at ${candidate}` };
    }
    if (seen.slug && seen.slug !== repo.slug) {
      return { ...repo, path: candidate, status: 'unaudited', reason: `the checkout at ${candidate} has origin ${seen.slug}, not ${repo.slug}` };
    }
    return { ...repo, path: candidate, status: 'audited', reason: null };
  });
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
 * commit row, its changed paths, and (multi-repo) which repo it came from;
 * attribution is stitched on later.
 */
export function classifyCommit({ sha, date, subject }, changedPaths, repo = null) {
  const surfaces = governedPathsIn(changedPaths);
  if (surfaces.length === 0) return null;
  return {
    repoId: repo?.id ?? null,
    repoSlug: repo?.slug ?? null,
    sha,
    date,
    subject,
    pr: pullNumberFromSubject(subject),
    surfaces,
  };
}

// ── the --test predicate (#9550): "would a PR touching these be governed?" ───

/**
 * The pre-arm answer, as data. Pure and repo-agnostic — the register is the
 * same in all four governed repos, so a seat can run this from anywhere with
 * the file list of any PR in any of them.
 */
export function testVerdict(paths) {
  const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p !== '');
  const matched = governedPathsIn(list);
  const hit = new Set(matched.flatMap((s) => s.files));
  return {
    governed: matched.length > 0,
    checked: list.length,
    surfacesChecked: GOVERNED_SURFACES.length,
    matched,
    hitPaths: [...hit],
    clearPaths: list.filter((p) => !hit.has(p)),
  };
}

/** The words a seat reads before flipping ready. Pure, so --self-test pins them. */
export function renderTestVerdict(verdict) {
  const head = `governed-surface predicate: ${verdict.hitPaths.length} of ${verdict.checked} path(s) hit the register (${verdict.surfacesChecked} surfaces, repo-agnostic).`;
  if (!verdict.governed) {
    return (
      `${head}\n` +
      `  ✅  NOT governed — ordinary queue landing applies to a PR with exactly this file list.\n` +
      `      Derived from GOVERNED_SURFACES, not recalled. Re-run on the FINAL file list: the register\n` +
      `      has grown several times in two days, and a reading taken earlier in the session is recall.`
    );
  }
  const lines = verdict.matched.map((s) => {
    const files = s.files.slice(0, 8).map((f) => `        - ${f}`).join('\n');
    return `      ${s.glob} ×${s.files.length} — ${s.what}\n${files}`;
  });
  const clear = verdict.clearPaths.length > 0 ? `\n  paths not on the register: ${verdict.clearPaths.slice(0, 8).join(', ')}` : '';
  return (
    `${head}\n` +
    `  ⛔  GOVERNED — a human merge is the review record for this PR (#9495 regime).\n` +
    `      No seat flips it ready, enqueues it, or arms auto-merge (AGENTS.md Prime Directive #14).\n` +
    `      One hit governs the whole PR — 「混合 diff 一条命中即整 PR 分叉」; proportion is not a question.\n` +
    `${lines.join('\n')}${clear}`
  );
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

/** Is `path` a git checkout, and of what? The real `probe` for resolveRepoCheckouts. */
function probeCheckout(path) {
  try {
    git(path, ['rev-parse', '--git-dir']);
  } catch {
    return { exists: false, slug: null };
  }
  try {
    return { exists: true, slug: slugFromRemote(git(path, ['remote', 'get-url', 'origin']).trim()) };
  } catch {
    return { exists: true, slug: null };
  }
}

// ── attribution (the only API surface) ──────────────────────────────────────

function apiContext(env) {
  return { apiUrl: (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '') };
}

/**
 * The channel chain, in try order. Anonymous is ALWAYS present and ALWAYS
 * last — it is what makes the PM container (no usable token) resolvable at
 * all for public repos, and it costs nothing when the token works.
 */
export function attributionChannels(env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || null;
  const channels = [];
  if (token) channels.push({ id: 'env-token', name: 'env token (GITHUB_TOKEN/GH_TOKEN)', headers: { authorization: `Bearer ${token}` } });
  channels.push({ id: 'anonymous', name: 'anonymous REST', headers: {} });
  return channels;
}

/** The node flag that points fetch at the session proxy, and the re-exec guard. */
export const PROXY_FLAG = '--use-env-proxy';
export const PROXY_REARM_GUARD = 'OS_GOVERNED_MERGES_PROXY_REARMED';

/**
 * Does this run need to be re-executed with `PROXY_FLAG` before it can reach
 * GitHub at all? Pure, so every branch is offline-testable — and the branches
 * are the whole point: a proxied run without the flag reads 401/403 on every
 * channel and looks exactly like a credential problem (#9642).
 */
export function proxyRearmPlan({ env = {}, execArgv = [], flagSupported = true }) {
  const proxy = env.HTTPS_PROXY || env.https_proxy || null;
  if (!proxy) return { rearm: false, hint: false, reason: 'no HTTPS_PROXY in the environment — fetch reaches GitHub directly' };
  if (execArgv.includes(PROXY_FLAG) || (env.NODE_OPTIONS ?? '').includes(PROXY_FLAG)) {
    return { rearm: false, hint: false, reason: `already running with ${PROXY_FLAG}` };
  }
  if (env[PROXY_REARM_GUARD] === '1') return { rearm: false, hint: false, reason: 'already re-armed once this run' };
  if (!flagSupported) {
    return { rearm: false, hint: true, reason: `this node does not accept ${PROXY_FLAG}; fetch will bypass ${proxy}` };
  }
  return { rearm: true, hint: false, flag: PROXY_FLAG, reason: `HTTPS_PROXY is set (${proxy}) and node's fetch does not read it` };
}

/** One PR read for `merged_by` / `merged_at`, over every channel in turn. */
async function fetchPullAttribution({ apiUrl }, slug, pull, channels) {
  const url = `${apiUrl}/repos/${slug}/pulls/${pull}`;
  const failures = [];
  for (const channel of channels) {
    let res;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...channel.headers },
      });
    } catch (error) {
      failures.push(`${channel.name}: request failed (${error?.message ?? error})`);
      continue;
    }
    if (!res.ok) {
      failures.push(`${channel.name}: HTTP ${res.status}`);
      continue;
    }
    const body = await res.json();
    return {
      attribution: { mergedBy: body?.merged_by?.login ?? null, mergedAt: body?.merged_at ?? null, title: body?.title ?? null },
      channel: channel.id,
    };
  }
  return { attribution: null, channel: null, failure: failures.join('; ') };
}

/**
 * The per-run NAMED fallback lines (#9619): one line per repo+reason group
 * naming which channels were tried and what each answered — replacing the
 * per-entry error string that buried the list. Pure.
 */
export function summariseAttributionFailures(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.attributionError) continue;
    const key = JSON.stringify([entry.repoSlug ?? '(repo)', entry.attributionError]);
    const group = groups.get(key) ?? { slug: entry.repoSlug ?? '(repo)', reason: entry.attributionError, prs: [] };
    group.prs.push(entry.pr);
    groups.set(key, group);
  }
  return [...groups.values()].map(
    (g) =>
      `⚠️  attribution unavailable for ${g.slug} — ${g.prs.length} entr${g.prs.length === 1 ? 'y' : 'ies'} ` +
      `(PR ${g.prs.map((n) => `#${n}`).join(', ')}); channels tried — ${g.reason}.`,
  );
}

// ── rendering ───────────────────────────────────────────────────────────────

/** The whole report as text — pure, so --self-test asserts on the words. */
export function renderReport({ sinceIso, repos, scanned, entries, lookups }) {
  const audited = repos.filter((r) => r.status === 'audited');
  const unaudited = repos.filter((r) => r.status !== 'audited');
  const head =
    `governed-merges sweep: ${entries.length} governed merge(s) since ${sinceIso} ` +
    `across ${audited.length}/${repos.length} governed repo(s)\n` +
    `  scanned ${scanned} mainline commit(s); ${lookups} API lookup(s).`;
  const auditedLines = audited.map(
    (r) => `  ✓ audited  ${r.slug} — tip ${r.tip ? `${r.tip.sha.slice(0, 9)} @ ${r.tip.date}` : '(unknown)'}; ${r.scanned ?? 0} mainline commit(s) in window${r.quiet ? ' — none in window; if that tip predates your last fetch, run `git fetch origin main` there' : ''}`,
  );
  const unauditedLines = unaudited.map((r) => `  ⚠️  UNAUDITED  ${r.slug} — ${r.reason}`);
  const unauditedNote =
    unaudited.length > 0
      ? [
          `  ⛔  ${unaudited.length} governed repo(s) were NOT audited. An unaudited repo is not a clean repo (#4690):`,
          `      nothing was found there because nothing was looked at. Check the repo out (or pass`,
          `      \`--repo-root <id>=<path>\`) and re-run before reading this sweep as clean.`,
        ]
      : [];
  const contract = [
    `  Every entry below should correspond to a merge the maintainer performed or ordered in person.`,
    `  An entry the maintainer does not recognise is the violation signal — file it as an incident (#9495 regime).`,
  ];
  const preamble = [head, ...auditedLines, ...unauditedLines, ...unauditedNote, ...contract].join('\n');

  if (entries.length === 0) {
    return unaudited.length > 0
      ? `${preamble}\n  no governed surface was merged in the audited repo(s) — NOT a clean window; see UNAUDITED above.`
      : `${preamble}\n  ✅  clean window — no governed surface was merged in any governed repo.`;
  }

  const lines = entries.map((e) => {
    const surfaces = e.surfaces.map((s) => `${s.glob} ×${s.files.length}`).join(', ');
    const who = e.attribution
      ? `merged_by ${e.attribution.mergedBy ?? '(none)'} @ ${e.attribution.mergedAt ?? '(unknown)'} (via ${e.attributionChannel ?? 'unknown channel'})`
      : `merged_by UNAVAILABLE — every channel failed; see the attribution note below`;
    const prName = e.pr != null ? `PR #${e.pr}` : '⚠️  NO PR NUMBER IN SUBJECT — direct push to main? investigate';
    const files = e.surfaces.flatMap((s) => s.files.slice(0, 6)).slice(0, 8);
    return `  • ${e.repoSlug ? `${e.repoSlug} ` : ''}${prName} — ${e.subject}\n      commit ${e.sha.slice(0, 9)} @ ${e.date}; ${who}\n      surfaces: ${surfaces}\n${files.map((f) => `        - ${f}`).join('\n')}`;
  });

  const notes = summariseAttributionFailures(entries).map((l) => `  ${l}`);
  const caveat = entries.some((e) => e.attribution)
    ? [
        `  ℹ️  merged_by names an ACCOUNT, not a principal — the maintainer also operates the seat accounts`,
        `      (measured 2026-08-18: objectui PR #5188 read merged_by os-steve; asked directly, the maintainer`,
        `      answered 「5188 是我合并的」). The column PROMPTS recognition; it never settles it.`,
      ]
    : [];
  return [preamble, ...lines, ...notes, ...caveat].join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

function runTestMode(args) {
  const i = args.indexOf('--test');
  const paths = args.slice(i + 1).filter((a) => !a.startsWith('--'));
  if (paths.length === 0) {
    console.error(
      `❌  --test wants the PR's changed paths, and got none. An empty path list is a failure, never\n` +
        `    a "not governed" answer. Derive the list rather than typing it, e.g.\n` +
        `      node scripts/pm/check-governed-merges.mjs --test $(gh pr diff --name-only <pr>)`,
    );
    return EXIT_CANNOT_SWEEP;
  }
  const verdict = testVerdict(paths);
  if (args.includes('--json')) console.log(JSON.stringify(verdict, null, 2));
  else console.log(renderTestVerdict(verdict));
  return verdict.governed ? EXIT_TEST_GOVERNED : EXIT_TEST_NOT_GOVERNED;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--test')) return runTestMode(args);

  const argOf = (name) => {
    const i = args.indexOf(name);
    return i > -1 ? args[i + 1] : null;
  };
  const argsOf = (name) => args.map((a, i) => (a === name ? args[i + 1] : null)).filter((v) => v != null);

  const selfRoot = resolve(argOf('--root') ?? resolve(scriptDir, '..', '..'));
  const ref = 'origin/main';

  const overrides = {};
  for (const pair of argsOf('--repo-root')) {
    const eq = pair.indexOf('=');
    if (eq < 1) {
      console.error(`❌  --repo-root wants <id>=<path>; got '${pair}'.`);
      return EXIT_CANNOT_SWEEP;
    }
    overrides[pair.slice(0, eq)] = resolve(pair.slice(eq + 1));
  }

  const only = (argOf('--repos') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  const known = new Set(GOVERNED_REPOS.map((r) => r.id));
  const unknown = only.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    console.error(`❌  --repos names no governed repo: ${unknown.join(', ')}. Known: ${[...known].join(', ')}.`);
    return EXIT_CANNOT_SWEEP;
  }
  const repoSet = only.length > 0 ? GOVERNED_REPOS.filter((r) => only.includes(r.id)) : GOVERNED_REPOS;

  let sinceIso;
  const sinceRef = argOf('--since-ref');
  if (sinceRef) {
    try {
      sinceIso = git(selfRoot, ['log', '-1', '--format=%cI', `${sinceRef}^{commit}`]).trim();
    } catch {
      console.error(`❌  --since-ref '${sinceRef}' does not resolve to a commit.`);
      return EXIT_CANNOT_SWEEP;
    }
  } else {
    sinceIso = parseSince(argOf('--since') ?? '24h');
    if (!sinceIso) {
      console.error(`❌  --since wants <N>d, <N>h, or an ISO date; got '${argOf('--since')}'.`);
      return EXIT_CANNOT_SWEEP;
    }
  }

  // Transport before credentials, and only once every argument has validated
  // (a bad-arg run must not pay for a child process): a proxied run whose fetch
  // bypasses the proxy answers 401/403 on every channel and reads as a token
  // problem (#9642). The flag has to be set at process start, so re-exec.
  const rearm = proxyRearmPlan({
    env: process.env,
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
  });
  if (rearm.rearm) {
    console.error(`ℹ️  re-exec with ${rearm.flag}: ${rearm.reason}. Attribution would otherwise fail on every channel.`);
    // The proxy agent is experimental and says so once per run; the operator
    // cannot act on that notice, so keep it out of the report where the node
    // in use can silence it by code.
    const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
    const child = spawnSync(process.execPath, [rearm.flag, ...quiet, scriptPath, ...args], {
      stdio: 'inherit',
      env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
    });
    if (typeof child.status === 'number') return child.status;
    console.error(`⚠️  could not re-exec with ${rearm.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — attribution may fail.`);
  }

  const repos = resolveRepoCheckouts({
    repos: repoSet,
    selfRoot,
    siblingDir: dirname(selfRoot),
    overrides,
    probe: probeCheckout,
  });

  const entries = [];
  let scanned = 0;
  for (const repo of repos) {
    if (repo.status !== 'audited') continue;
    let commits;
    try {
      const [sha, date] = git(repo.path, ['log', '-1', '--format=%H%x09%cI', ref]).trim().split('\t');
      repo.tip = { sha, date };
      commits = mainlineCommits(repo.path, ref, sinceIso);
    } catch (error) {
      repo.status = 'unaudited';
      repo.reason = `cannot read ${ref} in ${repo.path}: ${String(error.message ?? error).split('\n')[0]} — run \`git fetch origin main\` there`;
      continue;
    }
    repo.scanned = commits.length;
    repo.quiet = commits.length === 0;
    scanned += commits.length;
    for (const commit of commits) {
      const entry = classifyCommit(commit, commitPaths(repo.path, commit.sha), repo);
      if (entry) entries.push(entry);
    }
  }

  if (repos.every((r) => r.status !== 'audited')) {
    console.error(
      `❌  no governed repo could be audited — not one checkout resolved. This is a failed sweep, not a\n` +
        `    clean window.\n${repos.map((r) => `    • ${r.slug}: ${r.reason}`).join('\n')}`,
    );
    return EXIT_CANNOT_SWEEP;
  }

  // Attribution — the only API surface, and only when there is something to
  // attribute. Failures fall back through the channel chain, then group into
  // named per-run lines; the sweep is classified incomplete either way.
  const ctx = apiContext(process.env);
  const channels = attributionChannels(process.env);
  let lookups = 0;
  let attributionFailed = false;
  for (const entry of entries) {
    if (entry.pr == null) continue; // its own loud entry; nothing to look up
    lookups += 1;
    const got = await fetchPullAttribution(ctx, entry.repoSlug ?? GOVERNED_REPOS[0].slug, entry.pr, channels);
    if (got.attribution) {
      entry.attribution = got.attribution;
      entry.attributionChannel = got.channel;
    } else {
      attributionFailed = true;
      entry.attributionError = got.failure;
    }
  }

  const unaudited = repos.filter((r) => r.status !== 'audited');
  const complete = !attributionFailed && unaudited.length === 0;

  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          since: sinceIso,
          repos: repos.map((r) => ({ id: r.id, slug: r.slug, path: r.path, status: r.status, reason: r.reason, tip: r.tip ?? null, scanned: r.scanned ?? 0 })),
          scanned,
          complete,
          channelsTried: channels.map((c) => c.id),
          entries,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(renderReport({ sinceIso, repos, scanned, entries, lookups }));
  }

  if (!complete) {
    const why = [];
    if (unaudited.length > 0) why.push(`${unaudited.length} governed repo(s) unaudited (${unaudited.map((r) => r.slug).join(', ')})`);
    if (attributionFailed) why.push('at least one entry has no merged_by reading on any channel');
    console.error(
      `\n⚠️  sweep INCOMPLETE — ${why.join('; ')}. The list above is printed, but it must not read as\n` +
        `    clean (#4690): "does the maintainer recognise every entry" cannot be answered over repos that\n` +
        `    were never looked at or entries with no who-merged-it column.` +
        (attributionFailed && rearm.hint
          ? `\n    ⚠️  ${rearm.reason} — node's fetch is bypassing the session proxy, which answers 401/403 here.\n` +
            `        Re-run as NODE_OPTIONS=${PROXY_FLAG} before concluding anything about credentials (#9642).`
          : ''),
    );
    return EXIT_INCOMPLETE;
  }
  return EXIT_SWEPT;
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

  // ── the dispatch-gates declaration (#9979) ───────────────────────────────
  //
  // Enforcement cannot hold any of these: the declaration is read by another
  // tool entirely, so a wrong or missing entry runs perfectly green here and
  // shows up only as a dev dispatched on a root-file card who is not told that
  // the card is GOVERNED.
  const rootExacts = GOVERNED_SURFACES.filter((s) => s.exact).map((s) => s.exact);
  assert('every-exact-root-row-declares-a-watch-hint', rootExacts.every((f) => ROOT_FILE_WATCH_HINTS.includes(`${f}/**`)), JSON.stringify(rootExacts));
  assert('the-declaration-names-no-file-this-register-does-not-govern', ROOT_FILE_WATCH_HINTS.every((h) => rootExacts.includes(h.replace(/\/\*+$/, ''))), JSON.stringify(ROOT_FILE_WATCH_HINTS));
  assert('both-root-instruction-files-are-declared', ROOT_FILE_WATCH_HINTS.join(',') === 'AGENTS.md/**,CLAUDE.md/**', ROOT_FILE_WATCH_HINTS.join(','));
  // Provenance, never a matcher: `governedSlice` compares against `exact` and
  // `check-governed-prose.mjs` demands `glob` verbatim in the instruction
  // files. The glob spelling appearing in either field would change what this
  // register governs, and what that gate requires the prose to say.
  assert('the-declared-form-is-neither-an-exact-nor-a-glob-value', !GOVERNED_SURFACES.some((s) => ROOT_FILE_WATCH_HINTS.includes(s.exact) || ROOT_FILE_WATCH_HINTS.includes(s.glob)));

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
  const uiEntry = classifyCommit({ sha: 'f'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'docs: seat protocol (#5188)' }, ['AGENTS.md', 'skills/x/SKILL.md'], GOVERNED_REPOS[1]);
  assert('an-entry-carries-the-repo-it-came-from', uiEntry.repoSlug === 'objectstack-ai/objectui' && uiEntry.pr === 5188, JSON.stringify(uiEntry));

  // ── the exit contract, as a table (#9550 picked 3 so it cannot be read as
  //    the sweep's failure/incomplete codes) ─────────────────────────────────
  assert('exit-swept-is-0', EXIT_SWEPT === 0);
  assert('exit-cannot-sweep-is-1', EXIT_CANNOT_SWEEP === 1);
  assert('exit-incomplete-is-2', EXIT_INCOMPLETE === 2);
  assert('exit-test-governed-is-3-and-collides-with-no-sweep-code', EXIT_TEST_GOVERNED === 3 && ![EXIT_SWEPT, EXIT_CANNOT_SWEEP, EXIT_INCOMPLETE].includes(EXIT_TEST_GOVERNED));
  assert('exit-test-not-governed-is-0', EXIT_TEST_NOT_GOVERNED === 0);

  // ── multi-repo scope (#9619) ──────────────────────────────────────────────
  assert('four-governed-repos-declared', GOVERNED_REPOS.map((r) => r.id).join(',') === 'objectstack,objectui,cloud,objectos', GOVERNED_REPOS.map((r) => r.id).join(','));
  assert('slug-from-https-remote', slugFromRemote('https://github.com/objectstack-ai/objectui') === 'objectstack-ai/objectui');
  assert('slug-from-ssh-remote-with-suffix', slugFromRemote('git@github.com:objectstack-ai/cloud.git') === 'objectstack-ai/cloud');
  assert('slug-from-nonsense-is-null', slugFromRemote('/some/local/path') === null);

  const layout = {
    '/w/objectstack': { exists: true, slug: 'objectstack-ai/objectstack' },
    '/w/objectui': { exists: true, slug: 'objectstack-ai/objectui' },
    '/w/objectos': { exists: true, slug: 'objectstack-ai/objectos' },
    // /w/cloud deliberately absent — the live case measured on the PM
    // container 2026-08-18 (no checkout, and the API 403s for it too).
  };
  const resolved = resolveRepoCheckouts({ selfRoot: '/w/objectstack', siblingDir: '/w', probe: (p) => layout[p] ?? { exists: false, slug: null } });
  const byId = Object.fromEntries(resolved.map((r) => [r.id, r]));
  assert('all-four-repos-are-resolved-not-just-the-self-repo', resolved.length === 4);
  assert('the-self-repo-is-audited-from-the-scripts-own-root-not-cwd', byId.objectstack.status === 'audited' && byId.objectstack.path === '/w/objectstack');
  assert('a-sibling-checkout-beside-it-is-audited', byId.objectui.status === 'audited' && byId.objectos.status === 'audited');
  assert('an-absent-checkout-is-UNAUDITED-never-clean', byId.cloud.status === 'unaudited' && /no git checkout at \/w\/cloud/.test(byId.cloud.reason), JSON.stringify(byId.cloud));
  const wrongOrigin = resolveRepoCheckouts({
    repos: [GOVERNED_REPOS[1]],
    selfRoot: '/w/objectstack',
    siblingDir: '/w',
    probe: () => ({ exists: true, slug: 'someone-else/objectui' }),
  })[0];
  assert('a-checkout-with-the-wrong-origin-is-UNAUDITED-not-audited-under-the-wrong-name', wrongOrigin.status === 'unaudited' && wrongOrigin.reason.includes('someone-else/objectui'), JSON.stringify(wrongOrigin));
  const overridden = resolveRepoCheckouts({ repos: [GOVERNED_REPOS[2]], selfRoot: '/w/objectstack', siblingDir: '/w', overrides: { cloud: '/srv/cloud' }, probe: (p) => (p === '/srv/cloud' ? { exists: true, slug: 'objectstack-ai/cloud' } : { exists: false, slug: null }) })[0];
  assert('--repo-root-relocates-a-checkout', overridden.status === 'audited' && overridden.path === '/srv/cloud');

  // ── the report words an operator reads ────────────────────────────────────
  const allAudited = resolved.map((r) => ({ ...r, status: 'audited', reason: null, tip: { sha: 'c'.repeat(40), date: '2026-08-18T00:00:00Z' }, scanned: 3 }));
  const clean = renderReport({ sinceIso: '2026-08-17T00:00:00Z', repos: allAudited, scanned: 12, entries: [], lookups: 0 });
  assert('clean-window-says-clean-and-costs-zero-lookups', clean.includes('clean window') && clean.includes('0 API lookup(s)'), clean);
  assert('a-clean-sweep-names-every-repo-it-audited', GOVERNED_REPOS.every((r) => clean.includes(r.slug)), clean);
  const withAbsent = renderReport({ sinceIso: '2026-08-17T00:00:00Z', repos: resolved.map((r) => ({ ...r, tip: r.status === 'audited' ? { sha: 'c'.repeat(40), date: '2026-08-18T00:00:00Z' } : undefined, scanned: 3 })), scanned: 9, entries: [], lookups: 0 });
  // The ✅ marker, not the words: "NOT a clean window" contains "clean window",
  // so a substring test on the phrase alone would pass while the green tick
  // still printed. Assert on the tick and on the refusal sentence together.
  assert('an-unaudited-repo-never-renders-as-a-clean-window', !withAbsent.includes('✅') && withAbsent.includes('UNAUDITED') && withAbsent.includes('NOT a clean window'), withAbsent);
  assert('and-the-clean-case-does-print-the-tick', clean.includes('✅'), clean);
  assert('the-unaudited-line-names-the-repo-and-the-reason', withAbsent.includes('objectstack-ai/cloud') && withAbsent.includes('no git checkout'), withAbsent);
  const noPr = classifyCommit({ sha: 'd'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'chore: direct push' }, ['AGENTS.md'], GOVERNED_REPOS[0]);
  const loud = renderReport({ sinceIso: '2026-08-17T00:00:00Z', repos: allAudited, scanned: 3, entries: [noPr], lookups: 0 });
  assert('a-pr-less-mainline-commit-is-its-own-loud-entry', loud.includes('NO PR NUMBER IN SUBJECT'), loud);
  assert('the-violation-contract-is-stated-on-every-sweep', clean.includes('violation signal') && loud.includes('violation signal'));

  // ── attribution: the channel chain and its named fallback (#9619) ─────────
  const anonOnly = attributionChannels({});
  assert('with-no-token-anonymous-REST-is-still-tried', anonOnly.length === 1 && anonOnly[0].id === 'anonymous', JSON.stringify(anonOnly.map((c) => c.id)));
  const both = attributionChannels({ GITHUB_TOKEN: 'x' });
  assert('with-a-token-the-token-goes-first-and-anonymous-remains-the-fallback', both.map((c) => c.id).join(',') === 'env-token,anonymous', both.map((c) => c.id).join(','));
  assert('GH_TOKEN-is-honoured-too', attributionChannels({ GH_TOKEN: 'x' }).map((c) => c.id).join(',') === 'env-token,anonymous');
  assert('the-token-channel-sends-an-authorization-header-and-anonymous-sends-none', both[0]?.headers?.authorization === 'Bearer x' && Object.keys(both[1]?.headers ?? { unset: 1 }).length === 0, JSON.stringify(both.map((c) => c.id)));

  // The transport branch (#9642's trap, measured again here): every channel
  // reads 401/403 when a proxied run's fetch bypasses the proxy, so the plan
  // is pinned in all five directions — no proxy, flag present in either
  // spelling, guard set, unsupported flag, and the one case that re-execs.
  assert('no-proxy-means-no-rearm', proxyRearmPlan({ env: {} }).rearm === false);
  const proxied = proxyRearmPlan({ env: { HTTPS_PROXY: 'http://127.0.0.1:1' } });
  assert('a-proxied-run-without-the-flag-re-arms', proxied.rearm === true && proxied.flag === PROXY_FLAG, JSON.stringify(proxied));
  assert('the-flag-in-execArgv-stops-the-rearm', proxyRearmPlan({ env: { HTTPS_PROXY: 'http://x' }, execArgv: [PROXY_FLAG] }).rearm === false);
  assert('the-flag-in-NODE_OPTIONS-stops-the-rearm-too', proxyRearmPlan({ env: { HTTPS_PROXY: 'http://x', NODE_OPTIONS: `--enable-source-maps ${PROXY_FLAG}` } }).rearm === false);
  assert('the-guard-env-stops-an-infinite-rearm-loop', proxyRearmPlan({ env: { HTTPS_PROXY: 'http://x', [PROXY_REARM_GUARD]: '1' } }).rearm === false);
  const unsupported = proxyRearmPlan({ env: { https_proxy: 'http://x' }, flagSupported: false });
  assert('an-older-node-gets-the-printed-hint-not-a-bad-option-crash', unsupported.rearm === false && unsupported.hint === true, JSON.stringify(unsupported));
  assert('only-the-unsupported-branch-asks-for-the-hint', proxied.hint === false && proxyRearmPlan({ env: {} }).hint === false);

  const failedEntries = [
    { ...classifyCommit({ sha: 'e'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'docs: a (#101)' }, ['AGENTS.md'], GOVERNED_REPOS[2]), attributionError: 'env token (GITHUB_TOKEN/GH_TOKEN): HTTP 401; anonymous REST: HTTP 403' },
    { ...classifyCommit({ sha: 'e'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'docs: b (#102)' }, ['AGENTS.md'], GOVERNED_REPOS[2]), attributionError: 'env token (GITHUB_TOKEN/GH_TOKEN): HTTP 401; anonymous REST: HTTP 403' },
  ];
  const notes = summariseAttributionFailures(failedEntries);
  assert('two-failures-with-one-cause-collapse-to-ONE-named-line-not-per-entry-spam', notes.length === 1, JSON.stringify(notes));
  assert('the-named-line-names-repo-entries-and-every-channel-tried', notes[0].includes('objectstack-ai/cloud') && notes[0].includes('#101, #102') && notes[0].includes('HTTP 401') && notes[0].includes('anonymous REST'), notes[0]);
  assert('two-different-causes-do-not-collapse', summariseAttributionFailures([failedEntries[0], { ...failedEntries[1], attributionError: 'anonymous REST: request failed (ENOTFOUND)' }]).length === 2);
  const unresolvedReport = renderReport({ sinceIso: '2026-08-17T00:00:00Z', repos: allAudited, scanned: 3, entries: failedEntries, lookups: 2 });
  assert('an-unattributed-entry-is-marked-UNAVAILABLE-never-silently-blank', unresolvedReport.includes('merged_by UNAVAILABLE'), unresolvedReport);
  assert('the-reason-appears-once-below-the-list-not-inside-every-entry', unresolvedReport.split('HTTP 401').length - 1 === 1, unresolvedReport);
  const resolvedReport = renderReport({
    sinceIso: '2026-08-17T00:00:00Z',
    repos: allAudited,
    scanned: 3,
    entries: [{ ...classifyCommit({ sha: 'e'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'docs: a (#5188)' }, ['AGENTS.md'], GOVERNED_REPOS[1]), attribution: { mergedBy: 'os-steve', mergedAt: '2026-08-18T09:00:00Z' }, attributionChannel: 'anonymous' }],
    lookups: 1,
  });
  assert('a-resolved-entry-names-the-channel-it-came-from', resolvedReport.includes('merged_by os-steve') && resolvedReport.includes('(via anonymous)'), resolvedReport);
  assert('a-resolved-column-carries-the-account-is-not-a-principal-caveat', resolvedReport.includes('names an ACCOUNT, not a principal'), resolvedReport);
  assert('the-caveat-is-absent-when-nothing-resolved', !unresolvedReport.includes('names an ACCOUNT, not a principal'));

  // ── the --test pre-arm predicate (#9550) ──────────────────────────────────
  const governedCase = testVerdict(['AGENTS.md']);
  assert('--test-on-the-#9527-file-list-answers-GOVERNED', governedCase.governed === true && governedCase.hitPaths.join() === 'AGENTS.md', JSON.stringify(governedCase));
  assert('--test-governed-renders-the-no-flip-no-enqueue-no-arm-instruction', renderTestVerdict(governedCase).includes('GOVERNED') && renderTestVerdict(governedCase).includes('arms auto-merge'), renderTestVerdict(governedCase));
  const mixedCase = testVerdict(['packages/spec/src/index.ts', '.claude/agents/os-dev.md', 'README.md']);
  assert('--test-on-a-mixed-diff-answers-GOVERNED-on-one-hit', mixedCase.governed === true && mixedCase.hitPaths.join() === '.claude/agents/os-dev.md', JSON.stringify(mixedCase.hitPaths));
  assert('--test-lists-the-paths-that-are-NOT-on-the-register-too', mixedCase.clearPaths.join() === 'packages/spec/src/index.ts,README.md', JSON.stringify(mixedCase.clearPaths));
  const clearCase = testVerdict(['packages/spec/src/index.ts', 'scripts/pm/check-governed-merges.mjs']);
  assert('--test-on-an-ordinary-diff-answers-NOT-governed', clearCase.governed === false && clearCase.hitPaths.length === 0, JSON.stringify(clearCase));
  assert('this-very-file-is-not-itself-a-governed-surface', testVerdict(['scripts/pm/check-governed-merges.mjs']).governed === false);
  assert('--test-not-governed-renders-the-re-run-on-the-final-list-warning', renderTestVerdict(clearCase).includes('NOT governed') && renderTestVerdict(clearCase).includes('recall'), renderTestVerdict(clearCase));
  // Near misses on the predicate, the class the incident turns on: the seat
  // reasoned about a name, not a register.
  const nearMiss = testVerdict(['examples/AGENTS.md', 'docs/adrs/x.md', '.claude-x/y', 'skillsx/a.md', 'apps/CLAUDE.md.bak', 'packages/create-objectstack/src/templates/AGENTS.md']);
  assert('--test-near-misses-answer-NOT-governed', nearMiss.governed === false && nearMiss.clearPaths.length === 6, JSON.stringify(nearMiss.hitPaths));
  assert('--test-with-an-empty-path-list-is-never-a-not-governed-answer', testVerdict([]).checked === 0 && testVerdict([]).governed === false && runTestModeExitFor([]) === EXIT_CANNOT_SWEEP);
  // Every governed surface answers 3 through its own glob — an uninvoked
  // surface is the phantom shape this self-test exists to refuse.
  for (const surface of GOVERNED_SURFACES) {
    const sample = surface.prefix ? `${surface.prefix}sample.md` : surface.exact;
    assert(`--test-answers-governed-for-${surface.id}`, testVerdict([sample]).governed === true, sample);
  }

  if (failures.length > 0) {
    console.error(`✗ check-governed-merges --self-test — ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(`✓ check-governed-merges --self-test: ${checked} assertions (the unified governed predicate + near misses, subject→PR spellings, window parsing, the replay fixtures, the four-repo resolution incl. absent/wrong-origin/relocated checkouts, the attribution channel chain + its proxy-transport re-arm plan and its one named fallback line, the --test pre-arm predicate, the exit table, and the report wording pins).`);
}

/** The exit code `--test` would return for a path list — pinned without spawning. */
function runTestModeExitFor(paths) {
  if (paths.length === 0) return EXIT_CANNOT_SWEEP;
  return testVerdict(paths).governed ? EXIT_TEST_GOVERNED : EXIT_TEST_NOT_GOVERNED;
}

// `invokedDirectly` for the same reason line 810 carries it: this module is
// imported for its exported predicates (`proxyRearmPlan` — see
// scripts/pm/ci-failure.mjs), and an unguarded trigger ran THIS file's 77
// assertions inside the importer's own `--self-test`, printing a second
// summary and putting an unrelated file's failures on the importer's exit
// code. A self-test is a mode of the file that is being RUN, never a side
// effect of importing it.
if (invokedDirectly && process.argv.includes('--self-test')) {
  selfTest();
}
