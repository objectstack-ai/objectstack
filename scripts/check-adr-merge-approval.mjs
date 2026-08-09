#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-adr-merge-approval -- a PR whose diff touches docs/adr/** must not be
// mergeable without an APPROVED review from the maintainer's own account.
//
//   node scripts/check-adr-merge-approval.mjs               # gate mode (CI and local)
//   node scripts/check-adr-merge-approval.mjs --pr 6671     # replay a PR via the live API
//   node scripts/check-adr-merge-approval.mjs --files-json f.json --reviews-json r.json
//   node scripts/check-adr-merge-approval.mjs --self-test   # the checker itself
//
// ## The ruling this enforces (#6741, maintainer, verbatim)
//
// 「adr 只能由维护者自己确认,人工合并,ai 不得擅自合并。」
//
// ADR merges are reserved to the maintainer in person. Drafting and pushing
// ADR PRs stays open to every seat -- this gate reserves the MERGE, nothing
// else, and the maintainer's own approval + merge is the intended
// zero-extra-friction green path.
//
// ## Why a machine gate rather than prose (#6785, measured)
//
// The ruling was filed at 13:52Z on 2026-08-08. Within the following hour, two
// DIFFERENT AI-operated seats merged docs/adr/** PRs anyway: #6671 at 14:23Z
// (`os-zhuang`) and #6732 at 14:38Z (`os-project-manager` -- while the PR was
// in DRAFT state, so parking a PR as draft is not a barrier either). Neither
// merge was the maintainer's; both had ZERO reviews of any kind. A ruling
// written into an issue does not reach sessions that never read that issue.
// This repo's own doctrine -- declared = enforced -- applies to governance
// exactly as it applies to metadata. Both violations are replayed as
// fixtures in `--self-test`, pinned RED forever.
//
// ## The decision rule
//
//   diff does not touch docs/adr/**  -> PASS, with ZERO API lookups
//   diff touches docs/adr/**         -> PASS only if the PR carries an
//                                       APPROVED review from the maintainer's
//                                       own account (bot/agent approvals do
//                                       not count)
//
// ## Why the approver set is a hard-coded constant
//
// `MAINTAINER_APPROVERS` below is deliberately NOT configurable via repo/org
// Actions variables, workflow inputs, or environment: every one of those
// surfaces is writable by the shared AI identities (`os-*`, `claude`,
// `yinlianghui`, ...), and those identities granting themselves approval
// rights is precisely the failure mode this gate exists to close (#6785).
// Matching is by numeric account ID, not login: a login can be released and
// re-registered by someone else; the ID cannot. Changing the accepted set is
// a governance change -- a reviewed PR to this file, which .github/CODEOWNERS
// routes to the maintainer.
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

/**
 * The accounts whose APPROVED review satisfies this gate. See the header for
 * why this is a hard-coded constant and why matching is ID-first.
 *
 * `hotlong` = 50353452 is verified, not assumed: 2,153 commits on `main` are
 * authored as `50353452+hotlong@users.noreply.github.com`, and GitHub's
 * noreply address form is `{id}+{login}@users.noreply.github.com`, which ties
 * the login to the ID in the repo's own history.
 */
export const MAINTAINER_APPROVERS = [{ login: 'hotlong', id: 50353452 }];

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
 * Does this review's author count as the maintainer?
 *
 * ID-first: when the payload carries a numeric id (the real API always does),
 * the id alone decides -- a review from an account merely NAMED like the
 * maintainer, with a different id, does not count. The login fallback exists
 * only for hand-built fixtures that omit ids.
 */
export function isMaintainer(user, approvers = MAINTAINER_APPROVERS) {
  if (!user) return false;
  return approvers.some((a) => (user.id != null ? user.id === a.id : user.login === a.login));
}

/**
 * The maintainer's CURRENT review standing, from the full review list.
 *
 * Reviews are walked in submission order (the API returns them ascending;
 * `submitted_at` is used as the tiebreak-stable sort key when present). Only
 * APPROVED / CHANGES_REQUESTED / DISMISSED change the standing -- a later
 * COMMENTED does not revoke an approval, a later CHANGES_REQUESTED or a
 * dismissal does.
 *
 * @returns {string|null} the latest state-setting state, or null when the
 *   maintainer has never reviewed
 */
export function latestMaintainerReviewState(reviews, approvers = MAINTAINER_APPROVERS) {
  const mine = reviews
    .filter((r) => isMaintainer(r?.user, approvers))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ta = a.r.submitted_at ? Date.parse(a.r.submitted_at) : 0;
      const tb = b.r.submitted_at ? Date.parse(b.r.submitted_at) : 0;
      return ta - tb || a.i - b.i;
    });
  let state = null;
  for (const { r } of mine) {
    const s = String(r.state ?? '').toUpperCase();
    if (STATE_SETTING.has(s)) state = s;
  }
  return state;
}

/** Logins whose APPROVED reviews exist but deliberately do not count. */
export function approvalsFromNonMaintainers(reviews, approvers = MAINTAINER_APPROVERS) {
  return [
    ...new Set(
      reviews
        .filter((r) => String(r?.state ?? '').toUpperCase() === 'APPROVED' && !isMaintainer(r?.user, approvers))
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
 *   state?: string|null, strangerApprovals?: string[]}>}
 */
export async function decide({ changedPaths, getReviews, approvers = MAINTAINER_APPROVERS }) {
  const adrFiles = adrFilesIn(changedPaths);
  const checked = changedPaths.length;
  if (adrFiles.length === 0) return { ok: true, kind: 'no-adr-diff', adrFiles, checked };

  const reviews = await getReviews();
  if (!Array.isArray(reviews)) {
    throw new Error(`the review list is ${typeof reviews}, not an array -- refusing to guess (see header: missing input fails loud)`);
  }
  const state = latestMaintainerReviewState(reviews, approvers);
  if (state === 'APPROVED') return { ok: true, kind: 'maintainer-approved', adrFiles, checked, state };
  return {
    ok: false,
    kind: 'missing-maintainer-approval',
    adrFiles,
    checked,
    state,
    strangerApprovals: approvalsFromNonMaintainers(reviews, approvers),
  };
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

const RULING = '「adr 只能由维护者自己确认,人工合并,ai 不得擅自合并。」 (#6741, maintainer, verbatim)';

function reportVerdict(verdict, { source }) {
  if (verdict.ok && verdict.kind === 'no-adr-diff') {
    console.log(
      `✅  No files under ${ADR_PATH_PREFIX} in this diff (${verdict.checked} changed file(s), ${source}). ` +
        'Reviews were not consulted -- zero API lookups on the clean path.',
    );
    return 0;
  }
  if (verdict.ok) {
    console.log(
      `✅  ${verdict.adrFiles.length} file(s) under ${ADR_PATH_PREFIX} and an APPROVED review from the ` +
        `maintainer's own account is present (${source}).\n` +
        verdict.adrFiles.map((f) => `      • ${f}`).join('\n'),
    );
    return 0;
  }
  const strangers = verdict.strangerApprovals ?? [];
  console.error(
    `\n❌  This change touches ${ADR_PATH_PREFIX} and carries no APPROVED review from the maintainer's own account.\n\n` +
      verdict.adrFiles.map((f) => `      • ${f}`).join('\n') +
      '\n\n    The ruling being enforced: ' +
      RULING +
      '\n    ADR merges are reserved to the maintainer in person. Drafting this PR was fine and stays fine --\n' +
      '    only the MERGE is reserved.\n' +
      (verdict.state
        ? `\n    The maintainer's current review standing on this PR is ${verdict.state}, not APPROVED.\n`
        : '') +
      (strangers.length > 0
        ? `\n    APPROVED review(s) from ${strangers.map((s) => `'${s}'`).join(', ')} exist and deliberately do NOT\n` +
          '    count: shared bot/agent identities merging ADRs is the exact failure this gate was built to stop\n' +
          '    (#6785 -- two AI-seat merges within an hour of the ruling).\n'
        : '') +
      `\n    Green path: the maintainer (${MAINTAINER_APPROVERS.map((a) => '@' + a.login).join(', ')}) reviews and\n` +
      '    approves; the approval re-runs this check via the pull_request_review trigger, and it goes green\n' +
      '    with no further action. See the header of scripts/check-adr-merge-approval.mjs.',
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
// Assertions over the REAL functions (`decide`, `latestMaintainerReviewState`,
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

  // Fixture identities. The maintainer entry mirrors MAINTAINER_APPROVERS; the
  // others are the real shared AI-seat accounts this gate must refuse.
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
      assert('adr-diff-without-reviews-is-red', !v.ok && v.kind === 'missing-maintainer-approval', JSON.stringify(v));
    }

    // ── ADR diff + maintainer APPROVED → GREEN (predicted: GREEN) ────────────
    {
      const v = await decide({
        changedPaths: ['docs/adr/0001-x.md'],
        getReviews: async () => [review(HOTLONG, 'APPROVED', '2026-08-08T15:00:00Z')],
      });
      assert('maintainer-approval-is-green', v.ok && v.kind === 'maintainer-approved', JSON.stringify(v));
    }

    // ── bot/agent approvals must NOT satisfy the gate (predicted: RED) ───────
    {
      const v = await decide({
        changedPaths: ['docs/adr/0001-x.md'],
        getReviews: async () => [
          review(OS_ZHUANG, 'APPROVED', '2026-08-08T15:00:00Z'),
          review(OS_PM, 'APPROVED', '2026-08-08T15:01:00Z'),
          review(YINLIANGHUI, 'APPROVED', '2026-08-08T15:02:00Z'),
          review({ login: 'claude[bot]', id: 242468646 }, 'APPROVED', '2026-08-08T15:03:00Z'),
        ],
      });
      assert('bot-approvals-do-not-count', !v.ok, JSON.stringify(v));
      assert(
        'bot-approvals-are-named-in-the-verdict',
        (v.strangerApprovals ?? []).includes('os-zhuang') && (v.strangerApprovals ?? []).includes('yinlianghui'),
        `the verdict must name the approvals that deliberately do not count, got ${JSON.stringify(v.strangerApprovals)}`,
      );
    }

    // ── an account NAMED like the maintainer with a different id → RED ──────
    // Login-squat protection: the id decides when present (predicted: RED).
    {
      const v = await decide({
        changedPaths: ['docs/adr/0001-x.md'],
        getReviews: async () => [review({ login: 'hotlong', id: 1 }, 'APPROVED', '2026-08-08T15:00:00Z')],
      });
      assert('login-alone-with-wrong-id-does-not-count', !v.ok, JSON.stringify(v));
    }

    // ── review-state sequencing over the maintainer's own reviews ────────────
    {
      const seq = (states) =>
        latestMaintainerReviewState(states.map((s, i) => review(HOTLONG, s, `2026-08-08T15:0${i}:00Z`)));
      // approval then CHANGES_REQUESTED → not approved (predicted: RED path)
      assert('later-changes-requested-revokes', seq(['APPROVED', 'CHANGES_REQUESTED']) === 'CHANGES_REQUESTED', seq(['APPROVED', 'CHANGES_REQUESTED']));
      // CHANGES_REQUESTED then approval → approved (predicted: GREEN path)
      assert('later-approval-supersedes', seq(['CHANGES_REQUESTED', 'APPROVED']) === 'APPROVED', seq(['CHANGES_REQUESTED', 'APPROVED']));
      // approval then DISMISSED → not approved (predicted: RED path)
      assert('dismissal-revokes', seq(['APPROVED', 'DISMISSED']) === 'DISMISSED', seq(['APPROVED', 'DISMISSED']));
      // approval then a mere COMMENTED → still approved (predicted: GREEN path)
      assert('comment-does-not-revoke', seq(['APPROVED', 'COMMENTED']) === 'APPROVED', seq(['APPROVED', 'COMMENTED']));
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
    // The same two, had the maintainer approved → GREEN (predicted: GREEN):
    // pins that the gate's red on the real history is ABOUT the missing
    // approval, not about ADR diffs being unmergeable per se.
    for (const { pr, files } of HISTORICAL_VIOLATIONS) {
      const v = await decide({
        changedPaths: files,
        getReviews: async () => [review(HOTLONG, 'APPROVED', '2026-08-08T15:00:00Z')],
      });
      assert(`historical-pr-${pr}-with-maintainer-approval-is-green`, v.ok, JSON.stringify(v));
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
