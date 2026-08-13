#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-adr-merge-approval -- a PR whose diff touches docs/adr/** must not be
// mergeable without an APPROVED review on it. Any account's approval counts.
//
//   node scripts/check-adr-merge-approval.mjs               # gate mode (CI and local)
//   node scripts/check-adr-merge-approval.mjs --pr 6671     # replay a PR via the live API
//   node scripts/check-adr-merge-approval.mjs --files-json f.json --reviews-json r.json
//   node scripts/check-adr-merge-approval.mjs --self-test   # the checker itself
//
// ## The ruling this enforces (maintainer, 2026-08-12, verbatim)
//
// 「门禁改成只要求「APPROVED review 存在」」
// 「不要指定具体的人」
//
// The pass condition is the PRESENCE of an approving review. No account list,
// no identity judgement -- and, per the second sentence, no configurable one
// either: there is no list any more, not a list that moved somewhere else.
//
// ## What this gate does and does not guarantee -- read this before trusting it
//
//   GUARANTEED (machine-enforced here)   | NOT guaranteed (convention only)
//   -------------------------------------+----------------------------------------
//   a docs/adr/** diff cannot reach a    | that the approver is the maintainer.
//   mergeable state with no approving    | Any account with review rights on this
//   review on the PR                     | repo -- INCLUDING an AI seat -- satisfies
//                                        | this gate. That is the accepted cost of
//                                        | the 2026-08-12 ruling, stated out loud.
//   -------------------------------------+----------------------------------------
//   the approval is CURRENT, not         | that a human performed the merge. This
//   historical: a later CHANGES_REQUESTED| gate reads reviews only; it does not
//   or DISMISSED revokes it and the      | look at who merges, and does not block
//   gate goes red again                  | auto-merge being ARMED (#8012)
//
// The 2026-08-12 ruling SUPERSEDES the account-identity proxy this file used
// to implement. That proxy came from #6741 (maintainer, verbatim)
// 「adr 只能由维护者自己确认,人工合并,ai 不得擅自合并。」 and was sound only
// while maintainer-account != author-account. It stopped being sound when
// cloud dev sessions began authoring under the maintainer's own account:
// GitHub forbids self-approval, so the gate became permanently red on exactly
// the PRs the human was driving, while an AI seat holding the same credential
// could still satisfy it (#8161 row 1, #8012 row 2). #6741's two halves are
// not deleted -- they are now CONVENTION, not machine-enforced, and this
// header says so rather than letting the code and the comment drift apart
// again.
//
// ## Why a machine gate rather than prose (#6785, measured)
//
// The #6741 ruling was filed at 13:52Z on 2026-08-08. Within the following
// hour, two DIFFERENT AI-operated seats merged docs/adr/** PRs anyway: #6671
// at 14:23Z (`os-zhuang`) and #6732 at 14:38Z (`os-project-manager` -- while
// the PR was in DRAFT state, so parking a PR as draft is not a barrier
// either). Neither merge was the maintainer's; both had ZERO reviews of any
// kind. A ruling written into an issue does not reach sessions that never read
// that issue. This repo's own doctrine -- declared = enforced -- applies to
// governance exactly as it applies to metadata. Both violations are replayed
// as fixtures in `--self-test`, pinned RED forever: they had no reviews at
// all, so they stay red under the widened rule too.
//
// ## The decision rule
//
//   diff does not touch docs/adr/**  -> PASS, with ZERO API lookups
//   diff touches docs/adr/**         -> PASS only if the PR's latest
//                                       state-setting review is APPROVED
//
// "Latest state-setting" rather than "any APPROVED review has ever existed":
// an unrevokable approval would be a one-way door -- approve once, force-push
// anything. APPROVED / CHANGES_REQUESTED / DISMISSED set the standing;
// COMMENTED and PENDING set nothing. With the account filter gone the fold
// runs over ALL reviewers, which is the strict direction on both edges: a
// CHANGES_REQUESTED from a SECOND reviewer revokes a first reviewer's
// approval (red), and it takes a fresh approval -- from anyone -- to clear it.
//
// ## Never a filtered trigger, never a silent skip
//
// The workflow (`.github/workflows/adr-merge-approval.yml`) subscribes with NO
// path filter: a path-filtered required check never creates a run on
// non-matching PRs, and a required context that never reports hangs the merge
// queue until the ruleset's 60-minute timeout (objectui#3523; restated in
// objectui#3769, the presence-gate pattern this gate follows). The script
// reads the diff and decides. And every missing input -- unresolvable diff
// base, failed `git diff`, unresolvable PR number on a merge_group build,
// unfetchable review list -- fails LOUD (exit 1), never exit 0: a gate that
// cannot see its inputs and passes anyway is the #4690 anti-pattern, restated
// by the objectstack#4928 filter contract. The direction matters: for a filter
// deciding whether to RUN work, "cannot tell" means run; here the work IS the
// decision, so "cannot tell" means fail.
//
// ## merge_group semantics
//
// On a queue build, the PR is resolved from the queue ref
// (`gh-readonly-queue/<base>/pr-<N>-<sha>` embeds the number), falling back to
// the head commit's subject (`Merge pull request #N ...` / `... (#N)`), then to
// the commit's associated PRs via the API. Unresolvable -> RED, never skip.
// The diff is narrowed to this PR's own slice of the group (HEAD^1..HEAD) when
// the head commit provably belongs to the ref-named PR; otherwise the whole
// group diff (merge_group.base_sha..HEAD) is used -- a fail-CLOSED
// over-approximation: an innocent PR queued behind an unapproved ADR PR may go
// red for one build, but the ADR PR itself goes red too, is evicted, and the
// innocent PR rebuilds green. The open direction (skipping) is the one that
// can never be tolerated here.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** The governed surface. A path prefix, matched against repo-relative paths. */
export const ADR_PATH_PREFIX = 'docs/adr/';

/** Review states that SET the reviewer's standing; COMMENTED/PENDING do not. */
const STATE_SETTING = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

// -- pure decision functions --------------------------------------------------
// Pure over their inputs so `--self-test` and the replay modes drive the REAL
// functions with fixtures, not imitations.

/** @param {string[]} paths @returns {string[]} the paths under docs/adr/ */
export function adrFilesIn(paths) {
  return paths.filter((p) => p.startsWith(ADR_PATH_PREFIX));
}

/**
 * The PR's CURRENT review standing, from the full review list -- no account
 * filter, per the 2026-08-12 ruling 「不要指定具体的人」.
 *
 * Reviews are walked in submission order (the API returns them ascending;
 * `submitted_at` is used as the tiebreak-stable sort key when present). Only
 * APPROVED / CHANGES_REQUESTED / DISMISSED change the standing -- a later
 * COMMENTED does not revoke an approval, a later CHANGES_REQUESTED or a
 * dismissal does, whoever submitted it.
 *
 * @returns {string|null} the latest state-setting state, or null when nobody
 *   has submitted a state-setting review
 */
export function latestReviewState(reviews) {
  const ordered = reviews
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ta = a.r?.submitted_at ? Date.parse(a.r.submitted_at) : 0;
      const tb = b.r?.submitted_at ? Date.parse(b.r.submitted_at) : 0;
      return ta - tb || a.i - b.i;
    });
  let state = null;
  for (const { r } of ordered) {
    const s = String(r?.state ?? '').toUpperCase();
    if (STATE_SETTING.has(s)) state = s;
  }
  return state;
}

/**
 * Every login that has submitted an APPROVED review, for the verdict message.
 *
 * Purely diagnostic, and deliberately NOT a judgement: this replaces the old
 * `approvalsFromNonMaintainers`, whose name asserted a maintainer/non-
 * maintainer distinction the gate no longer draws. It earns its place on the
 * RED path, where "someone approved, yet the standing is CHANGES_REQUESTED"
 * is the confusing case a reader needs named.
 */
export function approverLogins(reviews) {
  return [
    ...new Set(
      reviews
        .filter((r) => String(r?.state ?? '').toUpperCase() === 'APPROVED')
        .map((r) => r?.user?.login ?? '(unknown)'),
    ),
  ];
}

/**
 * The whole judgement. `getReviews` is a LAZY async thunk: on a diff that does
 * not touch docs/adr/** it is never invoked, which is how "PASS with zero API
 * lookups" is a structural property rather than a promise -- the self-test
 * passes a thunk that throws, proving the clean path cannot look anything up.
 *
 * @param {object} input
 * @param {string[]} input.changedPaths repo-relative changed paths
 * @param {() => Promise<object[]>} input.getReviews lazy review-list fetch
 * @returns {Promise<{ok: boolean, kind: string, adrFiles: string[], checked: number,
 *   state?: string|null, approvals?: string[]}>}
 */
export async function decide({ changedPaths, getReviews }) {
  const adrFiles = adrFilesIn(changedPaths);
  const checked = changedPaths.length;
  if (adrFiles.length === 0) return { ok: true, kind: 'no-adr-diff', adrFiles, checked };

  const reviews = await getReviews();
  if (!Array.isArray(reviews)) {
    throw new Error(`the review list is ${typeof reviews}, not an array -- refusing to guess (see header: missing input fails loud)`);
  }
  const state = latestReviewState(reviews);
  const approvals = approverLogins(reviews);
  if (state === 'APPROVED') return { ok: true, kind: 'approved', adrFiles, checked, state, approvals };
  return { ok: false, kind: 'missing-approval', adrFiles, checked, state, approvals };
}

/**
 * The pull request this build is about, from event payload and/or ref.
 * Understands `pull_request`/`pull_request_review` payloads, the merge queue's
 * `gh-readonly-queue/<base>/pr-<N>-<sha>` ref spelling, and `refs/pull/N/...`.
 *
 * @returns {{number: number, how: string}|null}
 */
export function resolvePullNumber({ event = null, ref = '' } = {}) {
  const fromEvent = event?.pull_request?.number;
  if (Number.isInteger(fromEvent)) return { number: fromEvent, how: 'event.pull_request.number' };
  for (const candidate of [event?.merge_group?.head_ref ?? '', ref]) {
    if (!candidate) continue;
    let m = /gh-readonly-queue\/.+?\/pr-(\d+)-/.exec(candidate);
    if (m) return { number: Number(m[1]), how: `queue ref ${candidate}` };
    m = /^refs\/pull\/(\d+)\//.exec(candidate);
    if (m) return { number: Number(m[1]), how: `ref ${candidate}` };
  }
  return null;
}

/**
 * The PR number a commit subject names, in either of the two spellings GitHub
 * writes: a merge commit's `Merge pull request #N from ...` or a squash
 * commit's trailing `(#N)`.
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
 * Accepts the three shapes a file list arrives in -- `git diff` path strings,
 * REST `pulls/{n}/files` objects (`{filename}`), or a capture wrapper
 * (`{files: [...]}`), and returns plain path strings. Anything else throws:
 * a file list this gate cannot read is a failure, not an empty diff.
 */
export function normalizeFileList(input) {
  const list = Array.isArray(input) ? input : Array.isArray(input?.files) ? input.files : null;
  if (!list) throw new Error('file list is neither an array nor {files: [...]}');
  return list.map((f) => {
    const path = typeof f === 'string' ? f : f?.filename;
    if (typeof path !== 'string' || path === '') throw new Error(`unreadable file entry: ${JSON.stringify(f)}`);
    return path;
  });
}

/** Same tolerance for review lists: an array, or a `{reviews: [...]}` wrapper. */
export function normalizeReviewList(input) {
  const list = Array.isArray(input) ? input : Array.isArray(input?.reviews) ? input.reviews : null;
  if (!list) throw new Error('review list is neither an array nor {reviews: [...]}');
  return list;
}

// -- git ----------------------------------------------------------------------

/**
 * The separator `git -z` writes between paths, as a CODE POINT rather than a
 * character literal -- a raw NUL in this source would make grep/ripgrep treat
 * the whole file as binary and silently drop it from every future search
 * (#4890; the full argument lives in scripts/check-nul-bytes.mjs).
 */
const NUL = 0x00;

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitQuiet(root, args) {
  try {
    return git(root, args).trim();
  } catch {
    return null;
  }
}

/**
 * Which commit this build is judged against. See the header's merge_group
 * section for the narrowing / over-approximation trade.
 *
 * @returns {{ref: string, how: string}|{fail: true, tried: string[]}}
 */
export function resolveDiffBase(root, env, event) {
  const tried = [];
  if (env.GITHUB_EVENT_NAME === 'merge_group') {
    const refPr = resolvePullNumber({ event, ref: env.GITHUB_REF ?? '' })?.number ?? null;
    const subjectPr = pullNumberFromSubject(gitQuiet(root, ['log', '-1', '--format=%s', 'HEAD']));
    const parent = gitQuiet(root, ['rev-parse', '--verify', 'HEAD^1']);
    if (refPr != null && subjectPr === refPr && parent) {
      return { ref: parent, how: `HEAD^1 (the merge-group commit for PR #${refPr})` };
    }
    tried.push('HEAD^1 narrowing (head commit does not provably belong to the ref-named PR)');
    const groupBase = event?.merge_group?.base_sha ?? null;
    if (groupBase) {
      const verified = gitQuiet(root, ['rev-parse', '--verify', `${groupBase}^{commit}`]);
      tried.push(`merge_group.base_sha ${groupBase}${verified ? '' : ' (unresolved)'}`);
      if (verified) return { ref: verified, how: 'merge_group.base_sha (whole-group diff, fail-closed over-approximation)' };
    }
  }
  const candidates = [];
  if (env.GITHUB_BASE_REF) candidates.push(`origin/${env.GITHUB_BASE_REF}`);
  const eventBase = event?.pull_request?.base?.ref;
  if (eventBase && !candidates.includes(`origin/${eventBase}`)) candidates.push(`origin/${eventBase}`);
  for (const c of ['origin/main', 'main']) if (!candidates.includes(c)) candidates.push(c);
  for (const c of candidates) {
    const mb = gitQuiet(root, ['merge-base', 'HEAD', c]);
    tried.push(`merge-base with ${c}${mb ? '' : ' (unresolved)'}`);
    if (mb) return { ref: mb, how: `merge-base with ${c}` };
  }
  return { fail: true, tried };
}

/**
 * `git diff --name-only` between `base` and HEAD plus the working tree.
 * `--no-renames` on purpose: a rename OUT of docs/adr/ must surface both
 * sides, so moving an ADR away is as gated as editing one. `-z` keeps paths
 * verbatim (no quoting to unescape). Throws with git's own stderr on failure;
 * the caller turns that into exit 1 -- an uncomputable diff is not an empty
 * diff.
 */
export function changedFiles(root, base) {
  const args = ['diff', '--name-only', '--no-renames', '-z', base];
  let out;
  try {
    out = git(root, args);
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(`\`git ${args.join(' ')}\` failed${stderr ? `:\n    ${stderr}` : ''}`);
  }
  return out.split(String.fromCharCode(NUL)).filter((p) => p !== '');
}

// -- GitHub API ---------------------------------------------------------------

/** GETs every page of a list endpoint. Any non-2xx, non-array or network
 *  failure throws -- the caller turns that into exit 1, never a pass. */
async function apiGetAllPages(url, token) {
  const out = [];
  for (let page = 1; ; page++) {
    const pageUrl = `${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`;
    let res;
    try {
      res = await fetch(pageUrl, {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch (error) {
      throw new Error(`GET ${pageUrl} failed: ${error?.message ?? error}`);
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`GET ${pageUrl} answered HTTP ${res.status}${body ? `:\n    ${body}` : ''}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error(`GET ${pageUrl} answered a non-array body`);
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}

function apiContext(env) {
  return {
    apiUrl: (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, ''),
    repo: env.GITHUB_REPOSITORY ?? 'objectstack-ai/objectstack',
    token: env.GITHUB_TOKEN || env.GH_TOKEN || null,
  };
}

const fetchReviews = ({ apiUrl, repo, token }, pull) =>
  apiGetAllPages(`${apiUrl}/repos/${repo}/pulls/${pull}/reviews`, token);
const fetchPrFiles = ({ apiUrl, repo, token }, pull) =>
  apiGetAllPages(`${apiUrl}/repos/${repo}/pulls/${pull}/files`, token);
const fetchAssociatedPrs = ({ apiUrl, repo, token }, sha) =>
  apiGetAllPages(`${apiUrl}/repos/${repo}/commits/${sha}/pulls`, token);

// -- reporting ----------------------------------------------------------------

const RULING = '「门禁改成只要求「APPROVED review 存在」」/「不要指定具体的人」 (maintainer, 2026-08-12, verbatim; #8161)';

function reportVerdict(verdict, { source }) {
  if (verdict.ok && verdict.kind === 'no-adr-diff') {
    console.log(
      `✅  No files under ${ADR_PATH_PREFIX} in this diff (${verdict.checked} changed file(s), ${source}). ` +
        'Reviews were not consulted -- zero API lookups on the clean path.',
    );
    return 0;
  }
  if (verdict.ok) {
    const who = (verdict.approvals ?? []).map((s) => `'${s}'`).join(', ');
    console.log(
      `✅  ${verdict.adrFiles.length} file(s) under ${ADR_PATH_PREFIX} and the PR's current review standing is ` +
        `APPROVED${who ? ` (approved by ${who})` : ''} (${source}).\n` +
        verdict.adrFiles.map((f) => `      • ${f}`).join('\n'),
    );
    return 0;
  }
  const approvals = verdict.approvals ?? [];
  console.error(
    `\n❌  This change touches ${ADR_PATH_PREFIX} and the PR's current review standing is not APPROVED.\n\n` +
      verdict.adrFiles.map((f) => `      • ${f}`).join('\n') +
      '\n\n    The ruling being enforced: ' +
      RULING +
      '\n    Drafting and pushing this PR was fine and stays fine -- only the MERGE is gated.\n' +
      (verdict.state
        ? `\n    The latest state-setting review on this PR is ${verdict.state}, not APPROVED.\n`
        : '\n    No state-setting review (APPROVED / CHANGES_REQUESTED / DISMISSED) has been submitted at all.\n') +
      (approvals.length > 0 && verdict.state !== 'APPROVED'
        ? `\n    APPROVED review(s) from ${approvals.map((s) => `'${s}'`).join(', ')} exist but no longer stand:\n` +
          `    a later ${verdict.state} superseded them. An approval is revocable by design -- see the header.\n`
        : '') +
      '\n    Green path: anyone with review rights on this repo approves the PR; that approval re-runs this\n' +
      '    check via the pull_request_review trigger and it goes green with no further action. This gate does\n' +
      '    NOT check who approved: see the two-clause table in scripts/check-adr-merge-approval.mjs, which\n' +
      "    states what it guarantees and what it leaves to convention (#6741's 「维护者自己确认」/「人工合并」).",
  );
  return 1;
}

// -- CLI ----------------------------------------------------------------------

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const argOf = (name) => {
    const i = args.indexOf(name);
    return i > -1 ? args[i + 1] : null;
  };
  const env = process.env;
  const root = resolve(argOf('--root') ?? resolve(scriptDir, '..'));
  const ctx = apiContext(env);

  // Offline replay: judge captured API payloads (the shape `pulls/{n}/files`
  // and `pulls/{n}/reviews` answer, or the `{files}`/`{reviews}` capture
  // wrappers). This is also how the 2026-08-08 violations are pinned in
  // --self-test.
  const filesJson = argOf('--files-json');
  const reviewsJson = argOf('--reviews-json');
  if (filesJson || reviewsJson) {
    if (!filesJson || !reviewsJson) {
      console.error('❌  --files-json and --reviews-json must be given together.');
      return 1;
    }
    const changedPaths = normalizeFileList(JSON.parse(readFileSync(resolve(filesJson), 'utf8')));
    const reviews = normalizeReviewList(JSON.parse(readFileSync(resolve(reviewsJson), 'utf8')));
    const verdict = await decide({ changedPaths, getReviews: async () => reviews });
    return reportVerdict(verdict, { source: `replayed from ${filesJson} + ${reviewsJson}` });
  }

  // Live replay: judge an arbitrary PR by its API file list + review list.
  const prArg = argOf('--pr');
  if (prArg) {
    const pull = Number(prArg);
    if (!Number.isInteger(pull) || pull <= 0) {
      console.error(`❌  --pr wants a PR number, got '${prArg}'.`);
      return 1;
    }
    const changedPaths = normalizeFileList(await fetchPrFiles(ctx, pull));
    const verdict = await decide({ changedPaths, getReviews: () => fetchReviews(ctx, pull) });
    return reportVerdict(verdict, { source: `PR #${pull} via the API` });
  }

  // Gate mode: the diff decides, and only a gated diff resolves the PR and
  // fetches reviews.
  let event = null;
  if (env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH)) {
    try {
      event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    } catch (error) {
      console.error(`❌  Cannot read the event payload at ${env.GITHUB_EVENT_PATH}: ${error.message}`);
      return 1;
    }
  }

  const base = resolveDiffBase(root, env, event);
  if (base.fail) {
    console.error(
      '❌  Cannot resolve the commit to compare against, so there is nothing to diff.\n' +
        `    tried: ${base.tried.join(', ')}\n` +
        '    In CI, the checkout needs `fetch-depth: 0` (a shallow clone has no merge base); locally,\n' +
        '    `git fetch --no-tags origin main` and re-run. This is a failure, not a skip: a diff gate\n' +
        '    with no diff would report "no ADR files touched" while having looked at nothing (#4928).',
    );
    return 1;
  }

  let changedPaths;
  try {
    changedPaths = changedFiles(root, base.ref);
  } catch (error) {
    console.error(`❌  ${error.message}\n    An uncomputable diff is a failure, never a pass (#4690).`);
    return 1;
  }

  const getReviews = async () => {
    // Reached only when the diff touches docs/adr/**.
    let pr = resolvePullNumber({ event, ref: env.GITHUB_REF ?? '' });
    if (!pr) {
      const subjectPr = pullNumberFromSubject(gitQuiet(root, ['log', '-1', '--format=%s', 'HEAD']));
      if (subjectPr != null) pr = { number: subjectPr, how: 'HEAD commit subject' };
    }
    if (!pr) {
      const sha = gitQuiet(root, ['rev-parse', 'HEAD']);
      const associated = sha ? await fetchAssociatedPrs(ctx, sha) : [];
      const first = associated.find((p) => Number.isInteger(p?.number));
      if (first) pr = { number: first.number, how: `associated PR of commit ${sha.slice(0, 9)}` };
    }
    if (!pr) {
      throw new Error(
        'this diff touches docs/adr/** but the pull request could not be resolved from the event payload,\n' +
          "    the ref, the head commit subject, or the commit's associated PRs. Refusing to skip: an\n" +
          '    unattributable ADR change is exactly what must not merge unreviewed.',
      );
    }
    if (env.GITHUB_ACTIONS === 'true' && !ctx.token) {
      throw new Error(
        'GITHUB_TOKEN is not set, so the review list cannot be fetched. Wire\n' +
          '    `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` into the workflow step env.',
      );
    }
    console.log(`    docs/adr/** touched -- consulting reviews of PR #${pr.number} (resolved via ${pr.how}).`);
    return fetchReviews(ctx, pr.number);
  };

  let verdict;
  try {
    verdict = await decide({ changedPaths, getReviews });
  } catch (error) {
    console.error(`❌  ${error.message}\n\n    Missing input fails loud, never exit 0 (#4690, #4928).`);
    return 1;
  }
  return reportVerdict(verdict, { source: `git diff against ${base.how}` });
}

if (invokedDirectly && !process.argv.includes('--self-test')) {
  process.exitCode = await main();
}

// -- self-test ----------------------------------------------------------------
//
// Assertions over the REAL functions (`decide`, `latestReviewState`,
// `resolvePullNumber`, ...), never imitations. Every red-path fixture's
// expected direction is stated in its comment BEFORE the assertion runs.

/** Historical replay fixtures — the two measured violations (#6785).
 *
 * Captured 2026-08-08 from the live GitHub API (`pulls/{n}/files`,
 * `pulls/{n}/reviews`) for the two docs/adr/** PRs merged by AI-seat
 * identities within an hour of the #6741 ruling. Both review lists really
 * were EMPTY — the PRs were merged with zero reviews of any kind, which is
 * the whole case for this gate. Predicted direction: RED, both, forever.
 */
const HISTORICAL_VIOLATIONS = [
  {
    pr: 6671, // merged 2026-08-08T14:23:32Z by `os-zhuang`
    files: ['docs/adr/0048-cross-package-metadata-collision.md'],
    reviews: [],
  },
  {
    pr: 6732, // merged 2026-08-08T14:38:56Z by `os-project-manager`, in draft state
    files: ['docs/adr/0079-record-display-name.md', 'scripts/check-adr-anchors.mjs'],
    reviews: [],
  },
];

async function selfTest() {
  let checked = 0;
  const failures = [];
  const assert = (name, cond, detail) => {
    checked++;
    if (!cond) failures.push(`${name}: ${detail}`);
  };

  // Fixture identities: the maintainer's real account and the real shared
  // AI-seat accounts. Under the 2026-08-12 ruling the gate draws NO
  // distinction between them -- several assertions below exist precisely to
  // pin that, and they are the ones that inverted when the account filter was
  // removed.
  const HOTLONG = { login: 'hotlong', id: 50353452 };
  const OS_ZHUANG = { login: 'os-zhuang', id: 277994282 };
  const OS_PM = { login: 'os-project-manager', id: 314343378 };
  const YINLIANGHUI = { login: 'yinlianghui', id: 6219465 };
  const review = (user, state, submitted_at) => ({ user, state, submitted_at });

  /** A reviews thunk that must never run — proves the zero-lookup clean path. */
  const forbiddenLookup = async () => {
    throw new Error('getReviews was invoked on a diff that does not touch docs/adr/**');
  };

  try {
    // ── the guarded surface ──────────────────────────────────────────────────
    assert(
      'adr-prefix-matches-only-docs-adr',
      adrFilesIn(['docs/adr/0001-x.md', 'docs/adr/sub/y.md', 'docs/adrs/z.md', 'content/docs/adr.mdx', 'README.md'])
        .length === 2,
      'expected exactly the two docs/adr/ paths to match',
    );

    // ── clean diff → GREEN with zero lookups (predicted: GREEN, thunk unused) ─
    {
      const v = await decide({
        changedPaths: ['.github/workflows/adr-merge-approval.yml', 'scripts/check-adr-merge-approval.mjs', '.github/CODEOWNERS', 'package.json'],
        getReviews: forbiddenLookup,
      });
      assert('non-adr-diff-is-green-without-lookups', v.ok && v.kind === 'no-adr-diff', JSON.stringify(v));
    }

    // ── ADR diff, no reviews at all → RED (predicted: RED) ──────────────────
    {
      const v = await decide({ changedPaths: ['docs/adr/0001-x.md'], getReviews: async () => [] });
      assert('adr-diff-without-reviews-is-red', !v.ok && v.kind === 'missing-approval', JSON.stringify(v));
      assert('no-reviews-leaves-the-standing-null', v.state === null, `expected a null standing, got ${JSON.stringify(v.state)}`);
    }

    // ── ADR diff + maintainer APPROVED → GREEN (predicted: GREEN) ────────────
    {
      const v = await decide({
        changedPaths: ['docs/adr/0001-x.md'],
        getReviews: async () => [review(HOTLONG, 'APPROVED', '2026-08-08T15:00:00Z')],
      });
      assert('maintainer-approval-is-green', v.ok && v.kind === 'approved', JSON.stringify(v));
    }

    // ── THE WIDENED RULE, pinned in the direction that used to be RED ───────
    // Before 2026-08-12 each of these was refused because the approver was not
    // account 50353452. The ruling 「不要指定具体的人」 inverts them:
    // predicted GREEN, one approving account at a time so a single fixture
    // cannot pass on some other account's behalf.
    {
      for (const seat of [OS_ZHUANG, OS_PM, YINLIANGHUI, { login: 'claude[bot]', id: 242468646 }]) {
        const v = await decide({
          changedPaths: ['docs/adr/0001-x.md'],
          getReviews: async () => [review(seat, 'APPROVED', '2026-08-08T15:00:00Z')],
        });
        assert(`approval-from-${seat.login}-is-green`, v.ok && v.kind === 'approved', JSON.stringify(v));
      }
      // An account this repo has never seen, id and login alike: there is no
      // list left to be on, so the id cannot matter (predicted: GREEN).
      const v = await decide({
        changedPaths: ['docs/adr/0001-x.md'],
        getReviews: async () => [review({ login: 'nobody-has-ever-heard-of-this-one', id: 1 }, 'APPROVED', '2026-08-08T15:00:00Z')],
      });
      assert('approval-from-an-unknown-account-is-green', v.ok, JSON.stringify(v));
      assert('the-verdict-names-who-approved', (v.approvals ?? []).includes('nobody-has-ever-heard-of-this-one'), JSON.stringify(v.approvals));
    }

    // ── revocation survives the widening (predicted: RED) ────────────────────
    // The other half of the ruling: the pass condition is the CURRENT
    // standing, not "an APPROVED review has ever existed". An approval
    // followed by a CHANGES_REQUESTED must go back to red, and the verdict
    // must still name the superseded approval so the red is explicable.
    {
      const v = await decide({
        changedPaths: ['docs/adr/0001-x.md'],
        getReviews: async () => [
          review(OS_ZHUANG, 'APPROVED', '2026-08-08T15:00:00Z'),
          review(OS_ZHUANG, 'CHANGES_REQUESTED', '2026-08-08T15:05:00Z'),
        ],
      });
      assert('approval-then-changes-requested-is-red', !v.ok && v.state === 'CHANGES_REQUESTED', JSON.stringify(v));
      assert('a-superseded-approval-is-still-named', (v.approvals ?? []).includes('os-zhuang'), JSON.stringify(v.approvals));
    }

    // ── COMMENTED alone sets no standing (predicted: RED) ────────────────────
    {
      const v = await decide({
        changedPaths: ['docs/adr/0001-x.md'],
        getReviews: async () => [review(HOTLONG, 'COMMENTED', '2026-08-08T15:00:00Z')],
      });
      assert('commented-alone-is-red', !v.ok && v.state === null, JSON.stringify(v));
    }

    // ── review-state sequencing, one reviewer ────────────────────────────────
    {
      const seq = (states) => latestReviewState(states.map((s, i) => review(HOTLONG, s, `2026-08-08T15:0${i}:00Z`)));
      // approval then CHANGES_REQUESTED → not approved (predicted: RED path)
      assert('later-changes-requested-revokes', seq(['APPROVED', 'CHANGES_REQUESTED']) === 'CHANGES_REQUESTED', seq(['APPROVED', 'CHANGES_REQUESTED']));
      // CHANGES_REQUESTED then approval → approved (predicted: GREEN path)
      assert('later-approval-supersedes', seq(['CHANGES_REQUESTED', 'APPROVED']) === 'APPROVED', seq(['CHANGES_REQUESTED', 'APPROVED']));
      // approval then DISMISSED → not approved (predicted: RED path)
      assert('dismissal-revokes', seq(['APPROVED', 'DISMISSED']) === 'DISMISSED', seq(['APPROVED', 'DISMISSED']));
      // approval then a mere COMMENTED → still approved (predicted: GREEN path)
      assert('comment-does-not-revoke', seq(['APPROVED', 'COMMENTED']) === 'APPROVED', seq(['APPROVED', 'COMMENTED']));
    }

    // ── review-state sequencing ACROSS reviewers ─────────────────────────────
    // New surface: with the account filter gone the fold runs over everyone,
    // so these two cases exist for the first time. Directions predicted from
    // the header's "strict on both edges" rule, not from running it.
    {
      const across = (pairs) => latestReviewState(pairs.map(([u, s], i) => review(u, s, `2026-08-08T15:0${i}:00Z`)));
      // one seat approves, a SECOND asks for changes → revoked (predicted: RED)
      assert(
        'a-second-reviewers-changes-request-revokes',
        across([[OS_ZHUANG, 'APPROVED'], [HOTLONG, 'CHANGES_REQUESTED']]) === 'CHANGES_REQUESTED',
        across([[OS_ZHUANG, 'APPROVED'], [HOTLONG, 'CHANGES_REQUESTED']]),
      );
      // changes requested, then a DIFFERENT account approves (predicted: GREEN)
      assert(
        'a-second-reviewers-approval-clears-it',
        across([[HOTLONG, 'CHANGES_REQUESTED'], [OS_PM, 'APPROVED']]) === 'APPROVED',
        across([[HOTLONG, 'CHANGES_REQUESTED'], [OS_PM, 'APPROVED']]),
      );
    }

    // ── PR resolution ────────────────────────────────────────────────────────
    {
      const cases = [
        [{ event: { pull_request: { number: 6785 } } }, 6785, 'event payload'],
        [{ event: { merge_group: { head_ref: 'refs/heads/gh-readonly-queue/main/pr-6732-0f1e2d3c' } } }, 6732, 'merge_group head_ref'],
        [{ ref: 'refs/heads/gh-readonly-queue/main/pr-6671-abc123' }, 6671, 'queue GITHUB_REF'],
        [{ ref: 'refs/pull/123/merge' }, 123, 'pull merge ref'],
      ];
      for (const [input, expected, label] of cases) {
        const got = resolvePullNumber(input);
        assert(`pr-resolves-from-${label.replaceAll(' ', '-')}`, got?.number === expected, `expected ${expected}, got ${JSON.stringify(got)}`);
      }
      assert('unresolvable-pr-is-null-not-guessed', resolvePullNumber({ ref: 'refs/heads/feature-x' }) === null, 'a plain branch ref must not resolve to a PR');
      assert('merge-commit-subject-names-its-pr', pullNumberFromSubject('Merge pull request #6732 from objectstack-ai/x') === 6732, 'merge spelling');
      assert('squash-subject-names-its-pr', pullNumberFromSubject('fix(x): y (#6770)') === 6770, 'squash spelling');
      assert('subject-without-pr-is-null', pullNumberFromSubject('chore: tidy') === null, 'no PR in subject');
    }

    // ── input normalization refuses what it cannot read ──────────────────────
    {
      assert('files-accepts-rest-shape', normalizeFileList([{ filename: 'a.md' }]).join() === 'a.md', 'REST objects');
      assert('files-accepts-strings', normalizeFileList(['a.md']).join() === 'a.md', 'plain strings');
      assert('files-accepts-capture-wrapper', normalizeFileList({ files: ['a.md'] }).join() === 'a.md', 'wrapper');
      let threw = false;
      try {
        normalizeFileList({ nope: true });
      } catch {
        threw = true;
      }
      assert('unreadable-file-list-throws', threw, 'an unreadable file list must fail loud, not read as empty');
    }

    // ── historical replay: the two measured violations (predicted: RED) ─────
    for (const { pr, files, reviews } of HISTORICAL_VIOLATIONS) {
      const v = await decide({ changedPaths: files, getReviews: async () => reviews });
      assert(`historical-pr-${pr}-is-red-under-this-gate`, !v.ok, `PR #${pr} merged with no maintainer approval must replay RED, got ${JSON.stringify(v)}`);
    }
    // The same two, had ANY account approved → GREEN (predicted: GREEN): pins
    // that the gate's red on the real history is ABOUT the missing approval,
    // not about ADR diffs being unmergeable per se. The approver here is the
    // AI seat that merged #6671 — under the pre-2026-08-12 rule this pair was
    // red, and it is the widened rule replayed against real captured payloads.
    for (const { pr, files } of HISTORICAL_VIOLATIONS) {
      const v = await decide({
        changedPaths: files,
        getReviews: async () => [review(OS_ZHUANG, 'APPROVED', '2026-08-08T15:00:00Z')],
      });
      assert(`historical-pr-${pr}-with-any-approval-is-green`, v.ok, JSON.stringify(v));
    }
  } catch (error) {
    failures.push(`unexpected error: ${error?.stack ?? error}`);
  }

  if (failures.length > 0) {
    console.error(`✗ check-adr-merge-approval --self-test: ${failures.length} of ${checked} assertion(s) failed:\n`);
    for (const f of failures) console.error('  • ' + f + '\n');
    process.exit(1);
  }
  console.log(`✓ check-adr-merge-approval --self-test: ${checked} assertions over the real decide() / review-state / PR-resolution paths.`);
}

if (invokedDirectly && process.argv.includes('--self-test')) {
  await selfTest();
}
