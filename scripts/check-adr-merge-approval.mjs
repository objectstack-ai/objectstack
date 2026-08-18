#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-adr-merge-approval -- a PR whose diff touches a GOVERNED SURFACE must
// not be mergeable without an APPROVED review on it, and must not be sitting on
// an armed auto-merge. Any account's approval counts; no account's arming does.
//
// Three surfaces are governed, with IDENTICAL pass conditions and DISTINCT
// wording (each red names the rule that governs its own surface):
//
//   docs/adr/**        -- an ADR is the recorded decision (Prime Directive #13),
//                         and landing one is adopting a governance position.
//   .claude/skills/**  -- the lane's own operating protocol: the repo-internal
//                         agent playbooks every later dispatch reads. Added
//                         2026-08-17 by maintainer ruling on #9319 decision 2
//                         (see "The skill surface" below).
//   skills/**          -- the PUBLISHED skill catalog, shipped outward to
//                         customer projects. Added 2026-08-18 by maintainer
//                         ruling on #9404 (see "The published catalog" below).
//
// The script keeps its original file name: the job name it reports under
// ("ADR maintainer approval") is a required status context in the `main`
// ruleset and is registered under that exact spelling in
// scripts/check-required-contexts.mjs, so neither is renamed here. Renaming
// either is a settings action no CI job can perform (#7022).
//
//   node scripts/check-adr-merge-approval.mjs               # gate mode (CI and local)
//   node scripts/check-adr-merge-approval.mjs --pr 6671     # replay a PR via the live API
//   node scripts/check-adr-merge-approval.mjs --files-json f.json --reviews-json r.json
//                                            [--pull-json p.json]  # optional arming input
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
//   a GOVERNED diff (docs/adr/**,        | that the approver is the maintainer.
//   .claude/skills/** or skills/**)      | Any account with review rights on this
//   cannot reach a mergeable state with  | repo -- INCLUDING an AI seat -- satisfies
//   no approving review on the PR        | this gate. That is the accepted cost of
//                                        | the 2026-08-12 ruling, stated out loud.
//   -------------------------------------+----------------------------------------
//   the approval is CURRENT, not         | that the approver is not also the
//   historical: a later CHANGES_REQUESTED| author's own seat, and that the person
//   or DISMISSED revokes it and the      | who merges is the maintainer. This gate
//   gate goes red again                  | reads STATE, never actors.
//   -------------------------------------+----------------------------------------
//   a GOVERNED diff cannot reach a       | that auto-merge cannot be armed inside
//   mergeable state while auto-merge is  | the seconds before this gate re-runs and
//   ARMED on the PR -- armed is RED,     | goes red. See "the window this does NOT
//   approved or not (#8012)              | close" below; it needs the ruleset side.
//   -------------------------------------+----------------------------------------
//   a MIXED diff is judged by ONE path   | that a mixed PR gets split. The gate can
//   hit, never by proportion: one file   | only refuse to let it merge unattended;
//   under a governed prefix governs the  | splitting the governed files into their
//   whole PR (Prime Directive #14's      | own PR remains the author's call.
//   「一条命中就分叉」)                    |
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
// ## The skill surface (.claude/skills/**), added 2026-08-17
//
// Same control, second surface, ruled by the maintainer on #9319 decision 2
// (2026-08-17, 「同意」 batch), verbatim:
//
// 「The `ADR maintainer approval` gate's path predicate extends to
//   `.claude/skills/**`, making Prime Directive #14 enforced rather than
//   declared (the ADR-0049 shape, applied to the lane's own protocol surface).
//   The #8012 armed-auto-merge clause applies to the extended paths
//   identically.」
//
// The measured bypass it answers (#9319, from PR #9238): a `.claude/skills/**`
// PR -- whose own body said 「draft, awaiting a human merge」 -- was flipped
// ready and enqueued by an unidentified seat, and the merge queue landed it on
// `main` as 862eb14 with ZERO GitHub reviews of any kind. Content risk was low
// and the merge was retroactively accepted (#9319 decision 1); the defect is
// the CONTROL. Because all seats share one GitHub login, "which seat flipped
// it" is not forensically answerable -- which is precisely why the ruling
// chose a gate over an investigation: the identical act becomes mechanically
// impossible instead of traceable after the fact. PR #9238's real capture is
// pinned RED in `--self-test` alongside the 2026-08-08 ADR violations.
//
// Why this surface and not "any agent-facing file": the skill files are the
// operating protocol every LATER dispatch reads, so a bad landing there
// propagates into work nobody has started yet. That is the same
// declared-must-be-enforced doctrine (ADR-0049) this repo applies to metadata,
// pointed at the lane's own protocol.
//
// Deliberately NOT widened to the published `skills/` catalog in the same
// stroke: the #9319 ruling names `.claude/skills/**` only, so the catalog's
// merge posture stayed a stated gap rather than a quietly-closed one. That
// separate decision has since been made -- the next section.
//
// ## The published catalog surface (skills/**), added 2026-08-18
//
// Same control, third surface, ruled by the maintainer on #9404 (2026-08-18,
// 「同意」 -- the batch acceptance recorded on the card, adopting the
// recommendation it names: the published `skills/` catalog joins the gate, so
// all three of the pm-dispatch fork's human-merge prefixes (docs/adr/**,
// .claude/skills/**, skills/**) are machine-enforced by this required check).
//
// The rationale on record: this catalog ships OUTWARD. `skills/**` is
// published to customer projects, so a bad landing propagates into codebases
// this repo cannot see -- a worse direction than the repo-internal skills,
// which steer only this repo's own agents. And prose alone was already
// measured not to hold a surface of this kind: PR #9238 landed through the
// merge queue with zero reviews while the pm-dispatch SKILL text named its
// prefix as human-merge-only. The same declared-must-be-enforced doctrine
// (ADR-0049), pointed at the catalog the product ships.
//
// The cost was measured BEFORE the ruling and accepted in it, not discovered
// after: ~148 commits/month land on skills/** (the same order as the
// already-governed docs/adr/** at 165) -- about 5 extra human merges per
// working day. The #8012 armed-auto-merge clause applies to this surface on
// the same terms as the other two, and `--self-test` replays the emptiness
// proof on it.
//
// ## The decision rule
//
//   diff touches no governed prefix  -> PASS, with ZERO API lookups
//   diff touches docs/adr/**,        -> PASS only if BOTH hold:
//   .claude/skills/** and/or            (1) the PR's latest state-setting
//   skills/**                                review is APPROVED, and
//                                        (2) auto-merge is NOT armed on the PR
//
// One path hit is enough. A mixed diff (governed files plus anything else) is
// gate-scoped in full -- proportion is not a question this gate asks, matching
// Prime Directive #14's 「混合 diff 一条命中就分叉,⛔ 不按比例判」.
//
// "Latest state-setting" rather than "any APPROVED review has ever existed":
// an unrevokable approval would be a one-way door -- approve once, force-push
// anything. APPROVED / CHANGES_REQUESTED / DISMISSED set the standing;
// COMMENTED and PENDING set nothing. With the account filter gone the fold
// runs over ALL reviewers, which is the strict direction on both edges: a
// CHANGES_REQUESTED from a SECOND reviewer revokes a first reviewer's
// approval (red), and it takes a fresh approval -- from anyone -- to clear it.
//
// ## Clause (2): armed auto-merge is itself a RED state on a governed diff (#8012)
//
// Measured live on PR #7960 at ~11:15Z on 2026-08-12: an AI seat submitted an
// approving review and then ENABLED AUTO-MERGE on the PR while this gate was
// red. Nothing merged -- a human noticed and disarmed it two minutes later --
// but the state it left behind is the defect. Auto-merge is not a merge; it is
// a STANDING INSTRUCTION TO MERGE LATER, and no gate fires when one is issued.
// The next approving review would have turned this check green and GitHub would
// have merged the PR unattended, with every check reporting success.
//
// So the pass condition gained clause (2), and clause (2) fires WHETHER OR NOT
// the PR is approved. That "whether or not" is the entire mechanism, not a
// flourish of strictness -- the two states are worth spelling out because only
// one of them is the defect:
//
//   armed + NOT approved -> ALREADY red, for the missing approval. A rule that
//     fires only here cannot change any verdict: every input it rejects was
//     rejected already. It is a no-op that reads like a fix, and it leaves the
//     defect untouched, because the defect materialises one event LATER.
//   armed + approved     -> the state the incident was one review away from,
//     and the ONLY state in which the unattended merge actually happens. This
//     is what clause (2) makes red. Under the review-only rule it was green.
//
// `--self-test` pins that distinction directly (`armed-clause-changes-a-verdict-
// that-would-otherwise-be-green`): two runs over IDENTICAL reviews, differing
// only in the arming bit, must land on opposite verdicts. An assertion suite
// for clause (2) that still passes when clause (2) is deleted would be an empty
// instrument, and this family has already paid four times for fixes that only
// looked like fixes.
//
// 「人工合并」 -- the second half of the #6741 ruling, the half an approving
// review was only ever a proxy for -- is now machine-enforced in the only form
// a status check can express it. This gate cannot read who merges: when it
// reports, the merge has not happened. It reads whether a MACHINE HAS ALREADY
// BEEN TOLD TO, and it is green only while the merge still needs a person.
//
// Deliberately NOT a deadlock (#8161's lesson, which cost this same gate a
// week): every red here is cleared by an action any account can take -- disable
// auto-merge -- and disabling it re-runs this gate through the workflow's
// `auto_merge_disabled` trigger, so the check clears itself with no push, no
// re-review and no admin. Contrast #8161, where the sole account that could
// clear the gate was the one GitHub forbade from clearing it.
//
// Clause (2) governs the skill surface on exactly the same terms -- the #9319
// ruling says so in one sentence (「The #8012 armed-auto-merge clause applies to
// the extended paths identically」), and #9238 is the incident that makes it
// concrete: an armed/enqueued skill PR is the state that landed unattended.
//
// Ungoverned PRs are untouched: arming auto-merge is ordinary, useful practice
// here (the release PR runs on it) and the clean path still returns before any
// lookup happens. Only docs/adr/**, .claude/skills/** and skills/** are governed.
//
// ## The window this does NOT close, stated rather than assumed
//
// GitHub offers auto-merge only on a PR that cannot be merged immediately
// ("The option to enable auto-merge is shown only on pull requests that cannot
// be merged immediately", docs, verbatim). Two consequences, both load-bearing:
//
//   - DISARM-THEN-REARM buys nothing. This gate reads the LIVE arming state on
//     every run and keeps no memory between runs, so a rearmed PR is judged
//     armed the next time it runs; there is no earlier green to launder. And
//     while the PR is green here and otherwise mergeable, GitHub itself refuses
//     the rearm. Pinned as `arming-is-read-fresh-so-rearming-is-red-again`.
//   - WHAT REMAINS: a PR that is approved, green HERE, and still waiting on some
//     OTHER required check can be armed in that window. `auto_merge_enabled`
//     re-runs this gate, which then goes red -- but if the other check goes
//     green first, the merge fires before the red lands. The race needs the
//     arming to be the last blocking action, and it is NOT closed here. Closing
//     it belongs to the repository ruleset (#8012's option 2: disallow
//     auto-merge, or constrain the merge actor), which no CI job can perform.
//
// ## Reading the arming state: the LIVE PR object, never the event payload
//
// Read from `GET /repos/{owner}/{repo}/pulls/{n}`: `auto_merge` is null when
// disarmed and an object (`enabled_by`, `merge_method`, ...) when armed. Both
// shapes were measured against this repository on 2026-08-13 -- the armed
// capture in `--self-test` is a real one, not a hand-written imitation -- and
// `pull-requests: read`, which the workflow already grants for the review list,
// covers it. No new permission, no new token scope.
//
// The webhook payload is deliberately NOT trusted for this. GitHub does not
// document `auto_merge` as a member of the `pull_request` object carried by
// `pull_request_review`, and at least one PR projection in use in this
// environment (the `pull_request_read` MCP tool) omits the field entirely. A
// projection that merely LACKS the key would read as "not armed" and turn this
// clause into the phantom check it exists to prevent, so `armingFrom()` refuses
// a payload with no `auto_merge` key instead of defaulting it: absent and null
// are different facts, and only one of them means disarmed (#4690).
//
// Not judged on `merge_group` builds, on purpose. By then the PR has already
// passed this gate at the PR level, which is where auto-merge waits, so a red
// on a queue build adds no safety -- it only evicts. And if GitHub's "merge
// when ready" sets `auto_merge` as part of enqueueing, judging it there would
// make ADR PRs permanently unqueueable: the #8161 deadlock shape, recreated on
// the other side. The verdict RECORDS that the question was not asked
// (`arming.judged === false`, `arming.armed === null`) and the output says so,
// rather than quietly answering it "no".
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

/** The ADR surface. A path prefix, matched against repo-relative paths. */
export const ADR_PATH_PREFIX = 'docs/adr/';

/**
 * The repo-internal agent-skill surface, added by the #9319 decision-2 ruling
 * (2026-08-17).
 *
 * `.claude/skills/` and NOT `skills/`: the published catalog at the repo root
 * is its own governed surface with its own ruling and wording
 * (PUBLISHED_SKILL_PATH_PREFIX below), and the two must not be conflated or a
 * red on one would cite the other's rule. A prefix, like the ADR one, so
 * `.claude/skills-archive/` and `.claude/skillset.md` do NOT match -- the
 * trailing slash is load-bearing and `--self-test` pins both near misses.
 */
export const SKILL_PATH_PREFIX = '.claude/skills/';

/**
 * The PUBLISHED skill catalog, added by the maintainer ruling on #9404
 * (2026-08-18, 「同意」): the repo-root `skills/` directory ships outward to
 * customer projects, so its merge posture is machine-enforced here rather than
 * left to convention (see "The published catalog surface" in the header).
 *
 * Matched with `startsWith` against repo-relative paths, so it is anchored at
 * the repo root: `.claude/skills/**` does NOT double-match (it starts with
 * `.claude/`), and a nested `packages/x/skills/` would not match either. The
 * trailing slash keeps `skillsets/` or a root `skills.md` out -- `--self-test`
 * pins the near misses on both sides.
 */
export const PUBLISHED_SKILL_PATH_PREFIX = 'skills/';

/**
 * Every governed surface, in report order. Identical pass conditions (an
 * APPROVED standing and no armed auto-merge); DISTINCT `rule` text, so a red on
 * a skills PR cites Prime Directive #14's human-merge reservation and a red on
 * an ADR PR cites the ADR approval ruling -- an operator reading the failure is
 * told which rule they are standing on, not a generic "governed path" scold.
 *
 * A table rather than an `if`: adding a third surface is one entry with its own
 * wording, and every renderer, verdict field and self-test walks the table, so
 * no surface can be added with the wording of another (#9319).
 */
export const GOVERNED_SURFACES = Object.freeze([
  Object.freeze({
    id: 'adr',
    prefix: ADR_PATH_PREFIX,
    glob: 'docs/adr/**',
    what: 'an architecture decision record',
    rule:
      'The rule: 「门禁改成只要求「APPROVED review 存在」」/「不要指定具体的人」 (maintainer, 2026-08-12,\n' +
      '    verbatim; #8161), enforcing the 「人工合并」 half of 「adr 只能由维护者自己确认,人工合并,\n' +
      '    ai 不得擅自合并。」 (maintainer, 2026-08-08, verbatim; #6741). An accepted ADR IS the decision\n' +
      '    (Prime Directive #13), so landing one adopts a governance position and "CI is green" carries no\n' +
      '    information about whether it should be adopted.',
  }),
  Object.freeze({
    id: 'skill',
    prefix: SKILL_PATH_PREFIX,
    glob: '.claude/skills/**',
    what: "a repo-internal agent skill -- the lane's own operating protocol",
    rule:
      'The rule: Prime Directive #14 -- a skill-surface PR is merged by a human, by hand. ⛔ Never merge,\n' +
      '    never add to the merge queue, never arm auto-merge on it. Machine-enforced here since the\n' +
      '    2026-08-17 ruling on #9319 decision 2, verbatim: 「The `ADR maintainer approval` gate\'s path\n' +
      "    predicate extends to `.claude/skills/**`, making Prime Directive #14 enforced rather than\n" +
      '    declared」. The measured bypass: PR #9238 was flipped ready and landed by the merge queue with\n' +
      '    ZERO reviews -- these files are what every LATER dispatch reads, so a bad landing here\n' +
      '    propagates into work nobody has started yet.',
  }),
  Object.freeze({
    id: 'published-skill',
    prefix: PUBLISHED_SKILL_PATH_PREFIX,
    glob: 'skills/**',
    what: 'the published skill catalog -- shipped outward to customer projects',
    rule:
      'The rule: a published-catalog PR is merged by a human, by hand -- ⛔ never merge, never add to the\n' +
      '    merge queue, never arm auto-merge on it. Machine-enforced since the 2026-08-18 maintainer ruling\n' +
      '    on #9404 (「同意」, adopting the recorded recommendation): this catalog ships OUTWARD to customer\n' +
      '    projects, so a bad landing propagates into codebases this repo cannot see -- a worse direction\n' +
      '    than the repo-internal skills. The cost was measured before the ruling and accepted in it:\n' +
      '    ~148 commits/month on this surface, about 5 extra human merges per working day.',
  }),
]);

/** Review states that SET the reviewer's standing; COMMENTED/PENDING do not. */
const STATE_SETTING = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

/**
 * The explicit "this build does not judge the arming question" sentinel for
 * `decide()`'s `getArming`. It exists so that NOT ASKING is something a caller
 * has to say out loud: `decide()` throws on a missing `getArming` rather than
 * defaulting it, because a forgotten argument that reads as "auto-merge is off"
 * would silently restore the hole this clause closes (#8012).
 */
export const ARMING_NOT_JUDGED = 'arming-not-judged';

// -- pure decision functions --------------------------------------------------
// Pure over their inputs so `--self-test` and the replay modes drive the REAL
// functions with fixtures, not imitations.

/** @param {string[]} paths @returns {string[]} the paths under docs/adr/ */
export function adrFilesIn(paths) {
  return paths.filter((p) => p.startsWith(ADR_PATH_PREFIX));
}

/** @param {string[]} paths @returns {string[]} the paths under .claude/skills/ */
export function skillFilesIn(paths) {
  return paths.filter((p) => p.startsWith(SKILL_PATH_PREFIX));
}

/** @param {string[]} paths @returns {string[]} the paths under skills/ (the published catalog) */
export function publishedSkillFilesIn(paths) {
  return paths.filter((p) => p.startsWith(PUBLISHED_SKILL_PATH_PREFIX));
}

/**
 * The governed slice of a diff, grouped by surface and carrying each surface's
 * own wording. Surfaces with no hit are absent, so `matched.length === 0` IS
 * the clean path -- there is no "governed but empty" state to mis-handle.
 *
 * @param {string[]} paths repo-relative changed paths
 * @returns {{id: string, prefix: string, glob: string, what: string, rule: string, files: string[]}[]}
 */
export function governedFilesIn(paths) {
  const list = Array.isArray(paths) ? paths : [];
  return GOVERNED_SURFACES.map((surface) => ({
    ...surface,
    files: list.filter((p) => typeof p === 'string' && p.startsWith(surface.prefix)),
  })).filter((surface) => surface.files.length > 0);
}

/** Every governed prefix, as a human-readable list for the verdict lines. */
export function governedGlobs() {
  return GOVERNED_SURFACES.map((s) => s.glob);
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
 * The PR's auto-merge arming, from a REST pull-request object.
 *
 * `auto_merge` is `null` when disarmed and an object when armed -- both
 * measured against this repo's live API, and the armed capture is pinned as a
 * fixture in `--self-test`. A payload with NO `auto_merge` key is REFUSED, not
 * read as disarmed: that shape is a lossy projection (the `pull_request_read`
 * MCP tool is one), and letting a missing key mean "not armed" is exactly how a
 * gate becomes a phantom check (#4690). Absent and null are different facts.
 *
 * @param {object} pull a REST pull-request object
 * @returns {{armed: boolean, by: string|null, method: string|null}}
 */
export function armingFrom(pull) {
  if (pull === null || typeof pull !== 'object' || Array.isArray(pull)) {
    throw new Error(
      `the pull request payload is ${Array.isArray(pull) ? 'an array' : String(pull === null ? 'null' : typeof pull)}, ` +
        'not an object -- refusing to guess whether auto-merge is armed',
    );
  }
  if (!Object.hasOwn(pull, 'auto_merge')) {
    throw new Error(
      'the pull request payload carries no `auto_merge` key, so it is a PROJECTION that dropped the field,\n' +
        '    not a pull request with auto-merge off. Absent and null are different facts and only null means\n' +
        '    disarmed. Read the PR from the REST API (GET /repos/{owner}/{repo}/pulls/{n}), which carries the\n' +
        '    key in both states -- see the header (#8012).',
    );
  }
  const autoMerge = pull.auto_merge;
  if (autoMerge === null) return { armed: false, by: null, method: null };
  if (typeof autoMerge !== 'object' || Array.isArray(autoMerge)) {
    throw new Error(
      `\`auto_merge\` is ${Array.isArray(autoMerge) ? 'an array' : typeof autoMerge}, neither null nor an object -- ` +
        'refusing to guess the arming state from a shape this gate does not recognise',
    );
  }
  return {
    armed: true,
    by: autoMerge.enabled_by?.login ?? '(unknown)',
    method: autoMerge.merge_method ?? '(unknown)',
  };
}

/**
 * The whole judgement. `getReviews` is a LAZY async thunk: on a diff that
 * touches NO governed prefix it is never invoked, which is how "PASS with zero
 * API lookups" is a structural property rather than a promise -- the self-test
 * passes a thunk that throws, proving the clean path cannot look anything up.
 *
 * `getArming` is the same lazy shape for clause (2) and is MANDATORY -- either a
 * thunk resolving to `{armed}` (use `armingFrom()` on a REST PR object), or the
 * `ARMING_NOT_JUDGED` sentinel to state out loud that this build does not ask.
 * Omitting it throws: a caller that forgets must fail here, never coast on a
 * default that reads as "auto-merge is off" (#8012).
 *
 * Both clauses are evaluated, so a red names EVERY reason it is red -- being
 * told to disarm only to discover the approval is also missing is two round
 * trips for one verdict.
 *
 * `surfaces` carries the matched governed surfaces WITH their files and their
 * own rule wording, so every renderer is per-surface by construction; `files`
 * is the flat union for callers that only need "what is gated here".
 *
 * @param {object} input
 * @param {string[]} input.changedPaths repo-relative changed paths
 * @param {() => Promise<object[]>} input.getReviews lazy review-list fetch
 * @param {(() => Promise<{armed: boolean}>)|'arming-not-judged'} input.getArming
 * @returns {Promise<{ok: boolean, kind: string, reasons: string[],
 *   surfaces: {id: string, glob: string, rule: string, files: string[]}[], files: string[],
 *   checked: number, state?: string|null, approvals?: string[],
 *   arming?: {judged: boolean, armed: boolean|null, by: string|null, method: string|null}}>}
 */
export async function decide({ changedPaths, getReviews, getArming }) {
  if (typeof getArming !== 'function' && getArming !== ARMING_NOT_JUDGED) {
    throw new Error(
      'decide() needs an explicit `getArming`: a lazy thunk resolving to {armed: boolean}, or the\n' +
        `    ARMING_NOT_JUDGED sentinel ('${ARMING_NOT_JUDGED}') to declare that this build does not judge the\n` +
        `    arming question. Got ${getArming === undefined ? 'nothing' : JSON.stringify(getArming)}. Refusing to default it:\n` +
        '    a forgotten argument must not silently read as "auto-merge is off" (#8012).',
    );
  }

  // ONE path hit governs the whole PR: `governedFilesIn` groups by surface and
  // drops the surfaces with no hit, so a mixed diff (governed files + anything
  // else) arrives here indistinguishable from a governed-only one. Proportion
  // is never computed, because it is never a question (Prime Directive #14).
  const surfaces = governedFilesIn(changedPaths);
  const files = surfaces.flatMap((s) => s.files);
  const checked = changedPaths.length;
  if (surfaces.length === 0) {
    return { ok: true, kind: 'no-governed-diff', reasons: [], surfaces, files, checked };
  }

  const reviews = await getReviews();
  if (!Array.isArray(reviews)) {
    throw new Error(`the review list is ${typeof reviews}, not an array -- refusing to guess (see header: missing input fails loud)`);
  }
  const state = latestReviewState(reviews);
  const approvals = approverLogins(reviews);

  let arming;
  if (getArming === ARMING_NOT_JUDGED) {
    // `armed: null`, never `false` -- "not asked" must not be readable as "asked
    // and off" by anything downstream, including the report.
    arming = { judged: false, armed: null, by: null, method: null };
  } else {
    const read = await getArming();
    if (read === null || typeof read !== 'object' || typeof read.armed !== 'boolean') {
      throw new Error(
        `the auto-merge read answered ${JSON.stringify(read)}, not {armed: boolean} -- refusing to guess\n` +
          '    (see header: a missing input fails loud, it never passes).',
      );
    }
    arming = { judged: true, armed: read.armed, by: read.by ?? null, method: read.method ?? null };
  }

  // Clause order is the reading order of the red message: the arming is the
  // surprising fact and the actionable one, so it comes first.
  const reasons = [];
  if (arming.armed === true) reasons.push('auto-merge-armed');
  if (state !== 'APPROVED') reasons.push('missing-approval');

  const ok = reasons.length === 0;
  return { ok, kind: ok ? 'approved' : reasons.join('+'), reasons, surfaces, files, checked, state, approvals, arming };
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
 * `--no-renames` on purpose: a rename OUT of a governed prefix must surface
 * both sides, so moving an ADR (or a skill) away is as gated as editing one --
 * with renames collapsed, a `docs/adr/x.md` -> `docs/x.md` move would report
 * only the destination and slip the gate entirely. `-z` keeps paths
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

const apiHeaders = (token) => ({
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

/** One GET, with every failure raised. Shared by the list and single-object
 *  readers so both fail in exactly the same direction: loud. */
async function apiGet(url, token) {
  let res;
  try {
    res = await fetch(url, { headers: apiHeaders(token) });
  } catch (error) {
    throw new Error(`GET ${url} failed: ${error?.message ?? error}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`GET ${url} answered HTTP ${res.status}${body ? `:\n    ${body}` : ''}`);
  }
  return res.json();
}

/** GETs every page of a list endpoint. Any non-2xx, non-array or network
 *  failure throws -- the caller turns that into exit 1, never a pass. */
async function apiGetAllPages(url, token) {
  const out = [];
  for (let page = 1; ; page++) {
    const pageUrl = `${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`;
    const batch = await apiGet(pageUrl, token);
    if (!Array.isArray(batch)) throw new Error(`GET ${pageUrl} answered a non-array body`);
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}

/** GETs a single-object endpoint (the PR itself, for its arming state). */
async function apiGetObject(url, token) {
  const body = await apiGet(url, token);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`GET ${url} answered ${Array.isArray(body) ? 'an array' : String(body === null ? 'null' : typeof body)}, not an object`);
  }
  return body;
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
/** The PR itself -- read for `auto_merge`, which the webhook payload is not
 *  trusted to carry (see the header). Same `pull-requests: read` scope. */
const fetchPull = ({ apiUrl, repo, token }, pull) =>
  apiGetObject(`${apiUrl}/repos/${repo}/pulls/${pull}`, token);

// -- reporting ----------------------------------------------------------------

/** How the verdict describes the arming half, on both the green and red paths. */
function armingSentence(arming, armingNote) {
  if (!arming || arming.judged !== true) {
    return `the auto-merge arming question was NOT judged on this build${armingNote ? ` (${armingNote})` : ''}`;
  }
  return arming.armed ? 'auto-merge is ARMED' : 'auto-merge is OFF';
}

/** `• path` lines for one surface's file list. */
const bullets = (files) => files.map((f) => `      • ${f}`).join('\n');

/**
 * The whole report, as text -- PURE, so `--self-test` asserts on the words an
 * operator actually reads instead of on the verdict object alone.
 *
 * The wording requirement this function exists to hold (#9395, extended by
 * #9404): each governed surface names ITS OWN rule. An internal-skills PR is
 * refused citing Prime Directive #14's human-merge reservation; an ADR PR is
 * refused citing the ADR approval ruling; a published-catalog PR is refused
 * citing the #9404 ruling; a mixed PR gets every touched block, in table
 * order. The shared reason blocks
 * (arming, approval) below deliberately cite NEITHER rule -- the pass condition
 * is identical for every surface, so the shared half must stay surface-neutral
 * or the distinctness is decoration.
 *
 * @returns {{exitCode: number, stream: 'log'|'error', text: string}}
 */
export function renderVerdict(verdict, { source, armingNote = null }) {
  const globs = governedGlobs().join(' / ');
  if (verdict.ok && verdict.kind === 'no-governed-diff') {
    return {
      exitCode: 0,
      stream: 'log',
      text:
        `✅  No files under ${globs} in this diff (${verdict.checked} changed file(s), ${source}). ` +
        'Neither reviews nor auto-merge state were consulted -- zero API lookups on the clean path.',
    };
  }

  const surfaces = verdict.surfaces ?? [];
  const counted = surfaces.map((s) => `${s.files.length} file(s) under ${s.glob}`).join(' + ');

  if (verdict.ok) {
    const who = (verdict.approvals ?? []).map((s) => `'${s}'`).join(', ');
    return {
      exitCode: 0,
      stream: 'log',
      text:
        `✅  ${counted}; the PR's current review standing is ` +
        `APPROVED${who ? ` (approved by ${who})` : ''} and ${armingSentence(verdict.arming, armingNote)} (${source}).\n` +
        surfaces.map((s) => bullets(s.files)).join('\n'),
    };
  }

  const approvals = verdict.approvals ?? [];
  const blocks = [];

  if (verdict.arming?.armed === true) {
    blocks.push(
      `AUTO-MERGE IS ARMED on this pull request (enabled by '${verdict.arming.by ?? '(unknown)'}', ` +
        `method: ${verdict.arming.method ?? '(unknown)'}).\n` +
        '\n    An armed auto-merge turns the next approving review into an UNATTENDED MERGE: the approval\n' +
        '    re-runs this gate, the gate goes green, and GitHub merges with nobody pressing a button. That\n' +
        '    bypasses the human-merge reservation named above while every check reports success. Measured\n' +
        '    twice: live on PR #7960 at 11:15Z on 2026-08-12, disarmed by hand before it fired (#8012), and\n' +
        '    on PR #9238, which was flipped ready and landed by the merge queue with zero reviews (#9319).\n' +
        '\n    This is red WHETHER OR NOT the PR is approved. An approval does not make an armed auto-merge\n' +
        '    acceptable -- it is precisely the trigger the arming is waiting for.\n' +
        '\n    Fix: DISABLE auto-merge on this PR, then merge it in person once it is approved. Disabling it\n' +
        '    re-runs this gate on its own (the `auto_merge_disabled` trigger), so nothing else is needed.\n' +
        '    ⚠️ Already ENQUEUED? Disarming drops the arming but NOT queue membership -- converting the PR\n' +
        '    back to draft is what removes it from the queue. Do both, then confirm from the remote.',
    );
  }

  if (verdict.state !== 'APPROVED') {
    blocks.push(
      "The PR's current review standing is not APPROVED.\n" +
        (verdict.state
          ? `\n    The latest state-setting review on this PR is ${verdict.state}, not APPROVED.\n`
          : '\n    No state-setting review (APPROVED / CHANGES_REQUESTED / DISMISSED) has been submitted at all.\n') +
        (approvals.length > 0
          ? `\n    APPROVED review(s) from ${approvals.map((s) => `'${s}'`).join(', ')} exist but no longer stand:\n` +
            `    a later ${verdict.state} superseded them. An approval is revocable by design -- see the header.\n`
          : '') +
        '\n    Fix: anyone with review rights on this repo approves the PR; that approval re-runs this check\n' +
        '    via the pull_request_review trigger. This gate does NOT check who approved.',
    );
  }

  const numbered = blocks.length > 1;
  const surfaceBlocks = surfaces
    .map((s) => `This PR touches ${s.what} (${s.glob}), ${s.files.length} file(s):\n\n${bullets(s.files)}\n\n    ${s.rule}`)
    .join('\n\n    ');

  return {
    exitCode: 1,
    stream: 'error',
    text:
      `\n❌  This PR touches ${surfaces.length} governed surface(s) (${counted}) and is not in a mergeable ` +
      'state.\n\n    ' +
      surfaceBlocks +
      '\n\n' +
      blocks.map((b, i) => `    ${numbered ? `[${i + 1}] ` : ''}${b}`).join('\n\n') +
      '\n\n    One path hit governs the whole PR -- a mixed diff is never judged by proportion. If the rest\n' +
      '    of this PR needs to land now, split the governed files into their own PR.\n' +
      '    Drafting and pushing this PR was fine and stays fine -- only the MERGE is gated. What this gate\n' +
      '    does and does not guarantee is stated in full in the table at the head of\n' +
      '    scripts/check-adr-merge-approval.mjs.',
  };
}

function reportVerdict(verdict, options) {
  const { exitCode, stream, text } = renderVerdict(verdict, options);
  if (stream === 'error') console.error(text);
  else console.log(text);
  return exitCode;
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
  const pullJson = argOf('--pull-json');
  if (filesJson || reviewsJson) {
    if (!filesJson || !reviewsJson) {
      console.error('❌  --files-json and --reviews-json must be given together.');
      return 1;
    }
    const changedPaths = normalizeFileList(JSON.parse(readFileSync(resolve(filesJson), 'utf8')));
    const reviews = normalizeReviewList(JSON.parse(readFileSync(resolve(reviewsJson), 'utf8')));
    // `--pull-json` is optional, and its ABSENCE is reported rather than
    // silently treated as "auto-merge is off" -- the sentinel says so, and
    // the verdict line repeats it.
    const getArming = pullJson
      ? async () => armingFrom(JSON.parse(readFileSync(resolve(pullJson), 'utf8')))
      : ARMING_NOT_JUDGED;
    const verdict = await decide({ changedPaths, getReviews: async () => reviews, getArming });
    return reportVerdict(verdict, {
      source: `replayed from ${filesJson} + ${reviewsJson}${pullJson ? ` + ${pullJson}` : ''}`,
      armingNote: pullJson ? null : 'no --pull-json was given to this offline replay',
    });
  }

  // Live replay: judge an arbitrary PR by its API file list, review list and
  // arming state.
  const prArg = argOf('--pr');
  if (prArg) {
    const pull = Number(prArg);
    if (!Number.isInteger(pull) || pull <= 0) {
      console.error(`❌  --pr wants a PR number, got '${prArg}'.`);
      return 1;
    }
    const changedPaths = normalizeFileList(await fetchPrFiles(ctx, pull));
    const verdict = await decide({
      changedPaths,
      getReviews: () => fetchReviews(ctx, pull),
      getArming: async () => armingFrom(await fetchPull(ctx, pull)),
    });
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
        '    with no diff would report "no governed files touched" while having looked at nothing (#4928).',
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

  // The governed surfaces this diff hits, named once for the log lines below.
  // `decide()` recomputes it from the same paths -- this is for the operator's
  // narration, never the verdict.
  const touched = governedFilesIn(changedPaths)
    .map((s) => s.glob)
    .join(' + ');

  // Resolved once and shared by both lazy reads below, so a gated build costs
  // one resolution and not one per clause. Reached only when the diff touches a
  // governed prefix -- the clean path returns before either thunk is invoked.
  let resolvedPr = null;
  const resolvePrOnce = async () => {
    if (resolvedPr) return resolvedPr;
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
        `this diff touches ${touched} but the pull request could not be resolved from the event payload,\n` +
          "    the ref, the head commit subject, or the commit's associated PRs. Refusing to skip: an\n" +
          '    unattributable change to a governed surface is exactly what must not merge unreviewed.',
      );
    }
    if (env.GITHUB_ACTIONS === 'true' && !ctx.token) {
      throw new Error(
        'GITHUB_TOKEN is not set, so the review list and auto-merge state cannot be fetched. Wire\n' +
          '    `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` into the workflow step env.',
      );
    }
    resolvedPr = pr;
    return pr;
  };

  const getReviews = async () => {
    const pr = await resolvePrOnce();
    console.log(`    ${touched} touched -- consulting reviews of PR #${pr.number} (resolved via ${pr.how}).`);
    return fetchReviews(ctx, pr.number);
  };

  // Clause (2) is judged on pull-request-shaped builds only. On a merge_group
  // build the PR already passed this gate at the PR level -- where auto-merge
  // waits -- so a red here would add no safety and could deadlock the queue
  // (see the header's merge_group note). Declared with the sentinel so the
  // verdict and the output both say the question was not asked.
  const onMergeGroup = env.GITHUB_EVENT_NAME === 'merge_group';
  const armingNote = onMergeGroup
    ? 'merge_group build -- arming is judged at the pull-request level, see the script header'
    : null;
  const getArming = onMergeGroup
    ? ARMING_NOT_JUDGED
    : async () => {
        const pr = await resolvePrOnce();
        console.log(`    ${touched} touched -- reading the auto-merge state of PR #${pr.number}.`);
        return armingFrom(await fetchPull(ctx, pr.number));
      };

  let verdict;
  try {
    verdict = await decide({ changedPaths, getReviews, getArming });
  } catch (error) {
    console.error(`❌  ${error.message}\n\n    Missing input fails loud, never exit 0 (#4690, #4928).`);
    return 1;
  }
  return reportVerdict(verdict, { source: `git diff against ${base.how}`, armingNote });
}

if (invokedDirectly && !process.argv.includes('--self-test')) {
  process.exitCode = await main();
}

// -- self-test ----------------------------------------------------------------
//
// Assertions over the REAL functions (`decide`, `latestReviewState`,
// `resolvePullNumber`, ...), never imitations. Every red-path fixture's
// expected direction is stated in its comment BEFORE the assertion runs.

/** Historical replay fixtures — the three measured violations (#6785, #9319).
 *
 * Real captures from the live GitHub API (`pulls/{n}/files`,
 * `pulls/{n}/reviews`), not hand-written imitations: the two docs/adr/** PRs
 * merged by AI-seat identities within an hour of the #6741 ruling (captured
 * 2026-08-08), and the .claude/skills/** PR the merge queue landed on
 * 2026-08-17 (captured 2026-08-17, the day of the #9319 ruling). All three
 * review lists really were EMPTY — every one of these merged with zero reviews
 * of any kind, which is the whole case for this gate. Predicted direction: RED,
 * all three, forever.
 *
 * #9238 is the load-bearing one for the widened predicate: under the pre-#9395
 * rule it replayed GREEN (`no-adr-diff`, zero lookups) — it IS the diff that
 * proved prose alone does not hold this surface.
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
  {
    pr: 9238, // landed by the merge queue on 2026-08-17 as 862eb14, zero reviews (#9319)
    files: ['.claude/skills/pm-dispatch/SKILL.md', '.claude/skills/pm-dispatch/references/platform-readings.md'],
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
    throw new Error('getReviews was invoked on a diff that touches no governed prefix');
  };
  /** The same, for clause (2): the clean path must not read arming either. */
  const forbiddenArming = async () => {
    throw new Error('the auto-merge state was read on a diff that touches no governed prefix');
  };

  // Arming postures, spelled at every call site rather than defaulted — the
  // whole point of `getArming` being mandatory is that a fixture cannot forget
  // to say which state it is describing.
  const DISARMED = async () => ({ armed: false, by: null, method: null });
  const ARMED_BY = (by, method = 'merge') => async () => ({ armed: true, by, method });

  /**
   * A REAL capture: `GET /repos/objectstack-ai/objectstack/pulls/6208` on
   * 2026-08-13, an open PR armed by an AI seat. `enabled_by` is trimmed to the
   * two fields anything here reads; every other value is verbatim, including
   * `commit_title: null` and the empty `commit_message`. Kept as a captured
   * payload rather than a hand-written literal so the parser is proven against
   * the shape GitHub actually sends, the same way HISTORICAL_VIOLATIONS pins
   * the review lists.
   */
  const CAPTURED_ARMED_PULL = {
    number: 6208,
    auto_merge: {
      enabled_by: { login: 'os-zhuang', id: 277994282 },
      merge_method: 'merge',
      commit_title: null,
      commit_message: '',
    },
  };
  /** The same endpoint's disarmed shape: the key is present, the value null. */
  const CAPTURED_DISARMED_PULL = { number: 7960, auto_merge: null };

  try {
    // ── the guarded surface ──────────────────────────────────────────────────
    assert(
      'adr-prefix-matches-only-docs-adr',
      adrFilesIn(['docs/adr/0001-x.md', 'docs/adr/sub/y.md', 'docs/adrs/z.md', 'content/docs/adr.mdx', 'README.md'])
        .length === 2,
      'expected exactly the two docs/adr/ paths to match',
    );

    // ── the SKILL surface, added 2026-08-17 (#9319 decision 2) ──────────────
    // The prefix is `.claude/skills/` with the trailing slash load-bearing, and
    // it is NOT the published `skills/` catalog -- since #9404 the catalog is
    // its own surface with its own wording, so a conflation here would refuse
    // a catalog PR in the internal surface's words (and vice versa). The near
    // misses stay pinned: matching too little restores the #9238 hole.
    assert(
      'skill-prefix-matches-only-dot-claude-skills',
      skillFilesIn([
        '.claude/skills/pm-dispatch/SKILL.md',
        '.claude/skills/deep/nested/reference.md',
        '.claude/skills-archive/old.md',
        '.claude/skillset.md',
        '.claude/hooks/guard-shared-stash.sh',
        'skills/objectstack-ui/SKILL.md',
        'docs/adr/0001-x.md',
      ]).length === 2,
      'expected exactly the two .claude/skills/ paths to match',
    );
    // ── the PUBLISHED catalog surface, added 2026-08-18 (#9404) ─────────────
    // INVERTED from `the-published-skills-catalog-is-NOT-governed`, which
    // pinned the pre-#9404 state ("a separate, unmade decision"). The decision
    // is now made -- maintainer, 2026-08-18, 「同意」 on #9404 -- so the SAME
    // fixture must land on the OPPOSITE verdict: governed, by the
    // published-skill surface and ONLY that surface (the internal prefix must
    // not swallow it, or a catalog red would cite the internal rule).
    assert(
      'the-published-skills-catalog-IS-governed',
      publishedSkillFilesIn(['skills/objectstack-ui/SKILL.md']).length === 1 &&
        skillFilesIn(['skills/objectstack-ui/SKILL.md']).length === 0 &&
        governedFilesIn(['skills/objectstack-ui/SKILL.md']).map((s) => s.id).join() === 'published-skill',
      'the 2026-08-18 ruling on #9404 makes skills/** the third governed surface',
    );
    // The new prefix is anchored at the repo root by `startsWith`: near misses
    // on BOTH sides stay out. `.claude/skills/**` must not double-match (that
    // would refuse an internal-skill PR in two wordings at once), and root-level
    // near-spellings and nested `*/skills/` directories must not match at all.
    assert(
      'published-skill-prefix-matches-only-the-root-skills-dir',
      publishedSkillFilesIn([
        'skills/objectstack-ui/SKILL.md',
        'skills/deep/nested/reference.md',
        '.claude/skills/pm-dispatch/SKILL.md',
        'packages/spec/skills/x.md',
        'skillsets/overview.md',
        'skills.md',
        'docs/adr/0001-x.md',
      ]).length === 2,
      'expected exactly the two skills/ paths to match',
    );
    assert(
      'all-three-surfaces-are-declared-in-table-order',
      GOVERNED_SURFACES.map((s) => s.prefix).join(',') === 'docs/adr/,.claude/skills/,skills/',
      JSON.stringify(GOVERNED_SURFACES.map((s) => s.prefix)),
    );
    assert(
      'each-surface-carries-its-own-rule-text',
      new Set(GOVERNED_SURFACES.map((s) => s.rule)).size === GOVERNED_SURFACES.length &&
        GOVERNED_SURFACES.every((s) => typeof s.rule === 'string' && s.rule.length > 0),
      'two surfaces sharing one rule string would make the "distinct wording" requirement decoration',
    );
    // Grouping, not flattening: a mixed governed diff must arrive at the
    // renderers as SEPARATE surfaces, or per-surface wording is unreachable.
    {
      const grouped = governedFilesIn([
        'docs/adr/0001-x.md',
        '.claude/skills/pm-dispatch/SKILL.md',
        'skills/objectstack-ui/SKILL.md',
        'package.json',
      ]);
      assert(
        'a-mixed-governed-diff-groups-by-surface',
        grouped.length === 3 &&
          grouped.map((s) => s.id).join() === 'adr,skill,published-skill' &&
          grouped.every((s) => s.files.length === 1),
        JSON.stringify(grouped.map((s) => [s.id, s.files])),
      );
    }

    // ── clean diff → GREEN with zero lookups (predicted: GREEN, thunk unused) ─
    // The fixture deliberately includes near-neighbours of every governed
    // prefix (`.claude/hooks/`, `docs/adrs/`, `skillsets/`): none of the three
    // surfaces may swallow them. `skills/objectstack-ui/SKILL.md` was a member
    // of this fixture until the 2026-08-18 ruling on #9404 made it governed --
    // the clean path is now proven on the neighbours alone, and it still
    // short-circuits: both thunks throw on invocation, so a green here IS the
    // zero-lookup proof.
    {
      const v = await decide({
        changedPaths: [
          '.github/workflows/adr-merge-approval.yml',
          'scripts/check-adr-merge-approval.mjs',
          '.github/CODEOWNERS',
          'package.json',
          'skillsets/overview.md',
          'docs/adrs/z.md',
          '.claude/hooks/guard-main-checkout.sh',
        ],
        getReviews: forbiddenLookup,
        getArming: forbiddenArming,
      });
      assert('ungoverned-diff-is-green-without-lookups', v.ok && v.kind === 'no-governed-diff', JSON.stringify(v));
      assert('an-ungoverned-verdict-names-no-surface', (v.surfaces ?? []).length === 0 && (v.files ?? []).length === 0, JSON.stringify(v.surfaces));
    }

    // ── ADR diff, no reviews at all → RED (predicted: RED) ──────────────────
    {
      const v = await decide({ changedPaths: ['docs/adr/0001-x.md'], getReviews: async () => [], getArming: DISARMED });
      assert('adr-diff-without-reviews-is-red', !v.ok && v.kind === 'missing-approval', JSON.stringify(v));
      assert('no-reviews-leaves-the-standing-null', v.state === null, `expected a null standing, got ${JSON.stringify(v.state)}`);
    }

    // ── ADR diff + maintainer APPROVED → GREEN (predicted: GREEN) ────────────
    {
      const v = await decide({
        changedPaths: ['docs/adr/0001-x.md'],
        getReviews: async () => [review(HOTLONG, 'APPROVED', '2026-08-08T15:00:00Z')],
        getArming: DISARMED,
      });
      assert('maintainer-approval-is-green', v.ok && v.kind === 'approved', JSON.stringify(v));
    }

    // ── THE WIDENED PATH CLASS: .claude/skills/** (#9395, ruling on #9319) ──
    // Every ADR-surface behaviour, replayed on the skill surface. Directions
    // predicted before running: identical to the ADR surface in every case —
    // the ruling widened the PREDICATE, not the pass condition.
    {
      const skill = ['.claude/skills/pm-dispatch/SKILL.md'];

      // no reviews → RED (predicted: RED). This is #9238's exact state.
      const unreviewed = await decide({ changedPaths: skill, getReviews: async () => [], getArming: DISARMED });
      assert('skills-diff-without-reviews-is-red', !unreviewed.ok && unreviewed.kind === 'missing-approval', JSON.stringify(unreviewed));
      assert(
        'a-skills-verdict-names-the-skill-surface',
        (unreviewed.surfaces ?? []).length === 1 && unreviewed.surfaces[0].id === 'skill' && unreviewed.files.join() === skill.join(),
        JSON.stringify(unreviewed.surfaces),
      );

      // approved + disarmed → GREEN (predicted: GREEN — the legitimate path;
      // the gate must not make skill PRs unlandable, only unlandable-unattended)
      const approvedDisarmed = await decide({
        changedPaths: skill,
        getReviews: async () => [review(HOTLONG, 'APPROVED', '2026-08-17T15:00:00Z')],
        getArming: DISARMED,
      });
      assert('skills-diff-approved-and-disarmed-is-green', approvedDisarmed.ok && approvedDisarmed.kind === 'approved', JSON.stringify(approvedDisarmed));

      // ⚠️ THE EMPTINESS PROOF FOR THE NEW PATH CLASS. Identical reviews and
      // files; only the arming bit differs, and the verdicts must be opposite.
      // Without clause (2) reaching the widened predicate, this pair is green
      // twice — which is exactly the #9238 state (armed/enqueued + accepted).
      const armedApprovedSkill = await decide({
        changedPaths: skill,
        getReviews: async () => [review(HOTLONG, 'APPROVED', '2026-08-17T15:00:00Z')],
        getArming: ARMED_BY('os-zhuang'),
      });
      assert(
        'skills-armed-clause-changes-a-verdict-that-would-otherwise-be-green',
        armedApprovedSkill.ok === false && approvedDisarmed.ok === true,
        `armed=${armedApprovedSkill.ok}, disarmed=${approvedDisarmed.ok} over identical reviews — clause (2) did not reach the skill surface`,
      );
      assert(
        'skills-armed-and-approved-is-red-FOR-THE-ARMING-not-the-approval',
        armedApprovedSkill.reasons.includes('auto-merge-armed') && !armedApprovedSkill.reasons.includes('missing-approval'),
        JSON.stringify(armedApprovedSkill.reasons),
      );

      // The real captured armed payload, end to end on the skill surface
      // (predicted: RED) — the parser and the widened predicate wired together.
      const capturedArmedSkill = await decide({
        changedPaths: skill,
        getReviews: async () => [review(OS_ZHUANG, 'APPROVED', '2026-08-17T15:00:00Z')],
        getArming: async () => armingFrom(CAPTURED_ARMED_PULL),
      });
      assert('a-real-captured-armed-payload-is-red-on-the-skill-surface', !capturedArmedSkill.ok && capturedArmedSkill.arming?.by === 'os-zhuang', JSON.stringify(capturedArmedSkill));

      // MIXED DIFF: skills + ordinary files ⇒ gate-scoped in full (predicted:
      // RED). Proportion is never asked — one path hit governs the PR.
      const mixed = await decide({
        changedPaths: ['package.json', 'packages/spec/src/index.ts', '.claude/skills/pm-dispatch/SKILL.md', 'README.md'],
        getReviews: async () => [],
        getArming: DISARMED,
      });
      assert('a-mixed-skills-diff-is-gate-scoped', !mixed.ok && mixed.kind === 'missing-approval', JSON.stringify(mixed));
      assert(
        'a-mixed-diff-gates-on-the-governed-files-only',
        mixed.files.join() === '.claude/skills/pm-dispatch/SKILL.md' && mixed.checked === 4,
        `expected 1 governed file out of 4 changed, got ${JSON.stringify(mixed.files)} of ${mixed.checked}`,
      );
      // A one-in-many mixed diff must be as red as a governed-only one: pinned
      // by comparing the two verdicts' `ok`, so a future "proportion" rule
      // (say, "governed files must be the majority") fails here.
      assert(
        'proportion-changes-no-verdict',
        mixed.ok === unreviewed.ok,
        `1-of-4 governed gave ok=${mixed.ok} while 1-of-1 gave ok=${unreviewed.ok} — a proportion crept in`,
      );

      // ALL THREE surfaces at once (predicted: RED, three surfaces in table
      // order). Extended from the two-surface case when #9404 added the third.
      const all = await decide({
        changedPaths: ['docs/adr/0001-x.md', '.claude/skills/pm-dispatch/SKILL.md', 'skills/objectstack-ui/SKILL.md'],
        getReviews: async () => [],
        getArming: DISARMED,
      });
      assert(
        'a-diff-touching-all-three-surfaces-names-all-three',
        !all.ok && (all.surfaces ?? []).map((s) => s.id).join() === 'adr,skill,published-skill',
        JSON.stringify((all.surfaces ?? []).map((s) => s.id)),
      );
    }

    // ── THE THIRD PATH CLASS: skills/** (#9404, ruled 2026-08-18) ────────────
    // The published catalog, replayed through the same behaviours as the other
    // two surfaces. Directions predicted before running: identical to them in
    // every case -- the ruling added a PREDICATE row, not a new pass condition.
    {
      const catalog = ['skills/objectstack-ui/SKILL.md'];

      // no reviews → RED (predicted: RED). Before #9404 this exact input was
      // GREEN on the zero-lookup clean path -- the inversion the card names.
      const unreviewed = await decide({ changedPaths: catalog, getReviews: async () => [], getArming: DISARMED });
      assert('published-skills-diff-without-reviews-is-red', !unreviewed.ok && unreviewed.kind === 'missing-approval', JSON.stringify(unreviewed));
      assert(
        'a-published-skills-verdict-names-its-own-surface',
        (unreviewed.surfaces ?? []).length === 1 && unreviewed.surfaces[0].id === 'published-skill' && unreviewed.files.join() === catalog.join(),
        JSON.stringify(unreviewed.surfaces),
      );

      // approved + disarmed → GREEN (predicted: GREEN -- the legitimate path.
      // ~148 commits/month land on this surface; a gate that refused approved
      // PRs would be a five-a-day deadlock, not a control).
      const approvedDisarmed = await decide({
        changedPaths: catalog,
        getReviews: async () => [review(HOTLONG, 'APPROVED', '2026-08-18T15:00:00Z')],
        getArming: DISARMED,
      });
      assert('published-skills-approved-and-disarmed-is-green', approvedDisarmed.ok && approvedDisarmed.kind === 'approved', JSON.stringify(approvedDisarmed));

      // ⚠️ THE EMPTINESS PROOF FOR THE THIRD PATH CLASS: identical reviews,
      // only the arming bit differs, and the verdicts must be opposite --
      // clause (2) must reach this surface too (predicted: RED vs the GREEN
      // above, exactly as pinned for the other two surfaces).
      const armedApproved = await decide({
        changedPaths: catalog,
        getReviews: async () => [review(HOTLONG, 'APPROVED', '2026-08-18T15:00:00Z')],
        getArming: ARMED_BY('os-zhuang'),
      });
      assert(
        'published-skills-armed-clause-changes-a-verdict-that-would-otherwise-be-green',
        armedApproved.ok === false && approvedDisarmed.ok === true,
        `armed=${armedApproved.ok}, disarmed=${approvedDisarmed.ok} over identical reviews — clause (2) did not reach the published catalog`,
      );

      // MIXED: catalog + ordinary files ⇒ gate-scoped in full (predicted: RED,
      // gated on the catalog file only -- proportion is never asked).
      const mixed = await decide({
        changedPaths: ['package.json', 'skills/objectstack-ui/SKILL.md', 'README.md'],
        getReviews: async () => [],
        getArming: DISARMED,
      });
      assert(
        'a-mixed-published-skills-diff-is-gate-scoped',
        !mixed.ok && mixed.files.join() === 'skills/objectstack-ui/SKILL.md' && mixed.checked === 3,
        JSON.stringify(mixed.files),
      );
    }

    // ── the three surfaces fail with DISTINCT wording (#9395, extended #9404) ─
    // Asserted on the rendered TEXT an operator reads, not on the verdict
    // object: "each surface names its own rule" is a claim about words, and a
    // claim about words that is only checked structurally is not checked.
    // Predicted before running: the internal-skills red cites Prime Directive
    // #14 and mentions neither the ADR rule nor #9404; the ADR red cites the
    // 2026-08-12 approval ruling and neither skill rule; the published red
    // cites the #9404 ruling and none of the others; the mixed red carries
    // every rule its diff touches.
    {
      const render = async (changedPaths) =>
        renderVerdict(await decide({ changedPaths, getReviews: async () => [], getArming: DISARMED }), { source: 'self-test' });

      const skillsRed = await render(['.claude/skills/pm-dispatch/SKILL.md']);
      const adrRed = await render(['docs/adr/0001-x.md']);
      const publishedRed = await render(['skills/objectstack-ui/SKILL.md']);
      const mixedRed = await render(['docs/adr/0001-x.md', '.claude/skills/pm-dispatch/SKILL.md', 'skills/objectstack-ui/SKILL.md']);

      assert('a-skills-red-exits-1-on-stderr', skillsRed.exitCode === 1 && skillsRed.stream === 'error', JSON.stringify(skillsRed.exitCode));
      assert('a-skills-red-cites-prime-directive-14', skillsRed.text.includes('Prime Directive #14'), skillsRed.text);
      assert('a-skills-red-names-its-own-glob', skillsRed.text.includes('.claude/skills/**'), skillsRed.text);
      assert('a-skills-red-names-the-9238-bypass', skillsRed.text.includes('#9238'), skillsRed.text);
      assert(
        'a-skills-red-does-NOT-cite-the-other-rules',
        !skillsRed.text.includes('docs/adr/**') && !skillsRed.text.includes('#6741') && !skillsRed.text.includes('#9404'),
        'the internal skill surface must not be refused in another surface\'s words',
      );

      assert('an-adr-red-cites-the-adr-approval-ruling', adrRed.text.includes('#6741') && adrRed.text.includes('docs/adr/**'), adrRed.text);
      assert(
        'an-adr-red-does-NOT-cite-either-skill-rule',
        !adrRed.text.includes('Prime Directive #14') && !adrRed.text.includes('.claude/skills/**') && !adrRed.text.includes('#9404'),
        'the ADR surface must not be refused in a skill surface\'s words',
      );

      assert('a-published-red-exits-1-on-stderr', publishedRed.exitCode === 1 && publishedRed.stream === 'error', JSON.stringify(publishedRed.exitCode));
      assert('a-published-red-cites-the-9404-ruling', publishedRed.text.includes('#9404'), publishedRed.text);
      // `(skills/**)` rather than `skills/**`: the internal surface's glob
      // CONTAINS the published one as a substring, so only the parenthesised
      // spelling the renderer writes is unambiguous evidence here.
      assert('a-published-red-names-its-own-glob', publishedRed.text.includes('(skills/**)'), publishedRed.text);
      assert('a-published-red-names-the-outward-direction', publishedRed.text.includes('customer'), publishedRed.text);
      assert(
        'a-published-red-does-NOT-cite-the-other-rules',
        !publishedRed.text.includes('Prime Directive #14') &&
          !publishedRed.text.includes('#6741') &&
          !publishedRed.text.includes('#9238') &&
          !publishedRed.text.includes('.claude/skills/**') &&
          !publishedRed.text.includes('docs/adr/**'),
        'the published catalog must not be refused in another surface\'s words',
      );

      assert(
        'a-mixed-red-carries-EVERY-rule-text',
        mixedRed.text.includes('Prime Directive #14') && mixedRed.text.includes('#6741') && mixedRed.text.includes('#9404'),
        mixedRed.text,
      );
      assert(
        'a-mixed-red-lists-every-surfaces-files',
        mixedRed.text.includes('docs/adr/0001-x.md') &&
          mixedRed.text.includes('.claude/skills/pm-dispatch/SKILL.md') &&
          mixedRed.text.includes('skills/objectstack-ui/SKILL.md'),
        mixedRed.text,
      );

      // The clean and green paths still render, and the clean one advertises
      // BOTH globs (an operator reading "no files under docs/adr/**" on a repo
      // that also gates skills would be misinformed).
      const clean = renderVerdict(
        await decide({ changedPaths: ['README.md'], getReviews: forbiddenLookup, getArming: forbiddenArming }),
        { source: 'self-test' },
      );
      // ` / skills/**` with the separator: `.claude/skills/**` contains
      // `skills/**` as a substring, so the bare spelling can pass on the wrong
      // glob's strength.
      assert(
        'the-clean-verdict-advertises-every-governed-glob',
        clean.exitCode === 0 &&
          clean.text.includes('docs/adr/**') &&
          clean.text.includes('.claude/skills/**') &&
          clean.text.includes(' / skills/**'),
        clean.text,
      );
      const green = renderVerdict(
        await decide({
          changedPaths: ['.claude/skills/pm-dispatch/SKILL.md'],
          getReviews: async () => [review(HOTLONG, 'APPROVED', '2026-08-17T15:00:00Z')],
          getArming: DISARMED,
        }),
        { source: 'self-test' },
      );
      assert(
        'a-green-skills-verdict-names-the-skill-glob-and-the-approver',
        green.exitCode === 0 && green.text.includes('.claude/skills/**') && green.text.includes('hotlong'),
        green.text,
      );
      const greenPublished = renderVerdict(
        await decide({
          changedPaths: ['skills/objectstack-ui/SKILL.md'],
          getReviews: async () => [review(HOTLONG, 'APPROVED', '2026-08-18T15:00:00Z')],
          getArming: DISARMED,
        }),
        { source: 'self-test' },
      );
      assert(
        'a-green-published-verdict-names-its-glob-and-the-approver',
        greenPublished.exitCode === 0 && greenPublished.text.includes('under skills/**') && greenPublished.text.includes('hotlong'),
        greenPublished.text,
      );
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
          getArming: DISARMED,
        });
        assert(`approval-from-${seat.login}-is-green`, v.ok && v.kind === 'approved', JSON.stringify(v));
      }
      // An account this repo has never seen, id and login alike: there is no
      // list left to be on, so the id cannot matter (predicted: GREEN).
      const v = await decide({
        changedPaths: ['docs/adr/0001-x.md'],
        getReviews: async () => [review({ login: 'nobody-has-ever-heard-of-this-one', id: 1 }, 'APPROVED', '2026-08-08T15:00:00Z')],
        getArming: DISARMED,
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
        getArming: DISARMED,
      });
      assert('approval-then-changes-requested-is-red', !v.ok && v.state === 'CHANGES_REQUESTED', JSON.stringify(v));
      assert('a-superseded-approval-is-still-named', (v.approvals ?? []).includes('os-zhuang'), JSON.stringify(v.approvals));
    }

    // ── COMMENTED alone sets no standing (predicted: RED) ────────────────────
    {
      const v = await decide({
        changedPaths: ['docs/adr/0001-x.md'],
        getReviews: async () => [review(HOTLONG, 'COMMENTED', '2026-08-08T15:00:00Z')],
        getArming: DISARMED,
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

    // ── clause (2): the arming parser ────────────────────────────────────────
    // Directions predicted before running: the two REAL captures must read as
    // armed / disarmed respectively, and every shape the parser cannot read
    // must THROW rather than resolve to "not armed".
    {
      const armed = armingFrom(CAPTURED_ARMED_PULL);
      assert('captured-armed-pull-reads-as-armed', armed.armed === true, JSON.stringify(armed));
      assert('captured-armed-pull-names-who-armed-it', armed.by === 'os-zhuang', JSON.stringify(armed));
      assert('captured-armed-pull-names-the-merge-method', armed.method === 'merge', JSON.stringify(armed));
      assert('captured-disarmed-pull-reads-as-disarmed', armingFrom(CAPTURED_DISARMED_PULL).armed === false, 'auto_merge: null is the disarmed shape');

      const throws = (label, fn, wanted) => {
        let message = null;
        try {
          fn();
        } catch (error) {
          message = String(error?.message ?? error);
        }
        assert(label, message !== null && (!wanted || message.includes(wanted)), message === null ? 'did not throw' : `threw, but without ${JSON.stringify(wanted)}: ${message}`);
      };
      // THE projection trap, and the reason this parser exists at all: a PR
      // payload that simply LACKS `auto_merge` (the `pull_request_read` MCP
      // projection is one) must not read as disarmed. Absent != null.
      //
      // ⚠️ Asserted on the PROJECTION diagnosis specifically, not merely on
      // "it threw mentioning auto_merge". Mutation-tested 2026-08-13: deleting
      // the `Object.hasOwn` guard still throws — `undefined` falls through to
      // the not-an-object branch — so the looser assertion PASSED ON THE
      // MUTANT and pinned nothing. The safety property survives either way;
      // what the guard buys is the operator being told which of the two
      // situations they are in, and that is what must not be deletable.
      throws('a-payload-without-an-auto_merge-key-is-refused-not-read-as-disarmed', () => armingFrom({ number: 1, title: 'x' }), 'auto_merge');
      throws('a-missing-auto_merge-key-is-diagnosed-as-a-projection-not-as-a-bad-value', () => armingFrom({ number: 1, title: 'x' }), 'PROJECTION');
      throws('the-projection-diagnosis-names-the-endpoint-that-carries-the-field', () => armingFrom({ number: 1, title: 'x' }), 'GET /repos/');
      throws('a-non-object-pull-payload-is-refused', () => armingFrom('nope'));
      throws('a-null-pull-payload-is-refused', () => armingFrom(null));
      throws('an-array-pull-payload-is-refused', () => armingFrom([]));
      throws('a-scalar-auto_merge-is-refused', () => armingFrom({ auto_merge: true }));
      throws('an-undefined-auto_merge-value-is-refused', () => armingFrom({ auto_merge: undefined }));
    }

    // ── clause (2): the verdict ──────────────────────────────────────────────
    // The whole point of #8012. Predicted directions stated per assertion; the
    // load-bearing one is `armed-and-approved-is-red`, which was GREEN under
    // the review-only rule and is the exact state PR #7960 was one review away
    // from at 11:15Z on 2026-08-12.
    {
      const approved = [review(HOTLONG, 'APPROVED', '2026-08-08T15:00:00Z')];
      const adr = ['docs/adr/0001-x.md'];

      // armed + APPROVED → RED (predicted: RED; this is the new behaviour)
      const armedApproved = await decide({ changedPaths: adr, getReviews: async () => approved, getArming: ARMED_BY('os-zhuang') });
      assert('armed-and-approved-is-red', !armedApproved.ok, JSON.stringify(armedApproved));
      assert(
        'armed-and-approved-is-red-FOR-THE-ARMING-not-the-approval',
        armedApproved.reasons.includes('auto-merge-armed') && !armedApproved.reasons.includes('missing-approval'),
        JSON.stringify(armedApproved.reasons),
      );
      assert('the-verdict-names-who-armed-it', armedApproved.arming?.by === 'os-zhuang', JSON.stringify(armedApproved.arming));

      // disarmed + APPROVED → GREEN (predicted: GREEN — the legitimate path)
      const disarmedApproved = await decide({ changedPaths: adr, getReviews: async () => approved, getArming: DISARMED });
      assert('disarmed-and-approved-is-green', disarmedApproved.ok, JSON.stringify(disarmedApproved));

      // ⚠️ THE EMPTINESS PROOF. Identical reviews, identical files; the ONLY
      // difference is the arming bit, and the two verdicts must be opposite.
      // Delete clause (2) — or narrow it to the literal "armed AND not
      // approved" wording, which cannot fire on an approved PR — and this
      // assertion fails. It is what makes the rest of this block an
      // instrument rather than decoration.
      assert(
        'armed-clause-changes-a-verdict-that-would-otherwise-be-green',
        armedApproved.ok === false && disarmedApproved.ok === true,
        `armed=${armedApproved.ok}, disarmed=${disarmedApproved.ok} over identical reviews — clause (2) changed nothing`,
      );

      // armed + NOT approved → RED naming BOTH reasons (predicted: RED, 2
      // reasons). One verdict, both fixes, so a reader is not sent round twice.
      const armedUnapproved = await decide({ changedPaths: adr, getReviews: async () => [], getArming: ARMED_BY('os-project-manager') });
      assert(
        'armed-and-unapproved-is-red-for-both-reasons',
        !armedUnapproved.ok && armedUnapproved.reasons.includes('auto-merge-armed') && armedUnapproved.reasons.includes('missing-approval'),
        JSON.stringify(armedUnapproved.reasons),
      );

      // disarmed + NOT approved → RED for the approval only (predicted: RED,
      // 1 reason). Pins that clause (2) does not bleed into the old verdict.
      const disarmedUnapproved = await decide({ changedPaths: adr, getReviews: async () => [], getArming: DISARMED });
      assert(
        'disarmed-and-unapproved-is-red-for-the-approval-only',
        !disarmedUnapproved.ok && disarmedUnapproved.reasons.join() === 'missing-approval',
        JSON.stringify(disarmedUnapproved.reasons),
      );

      // The disarm/re-arm wrinkle the card asked to be measured rather than
      // assumed. `decide()` holds no state between runs, so the sequence
      // green → rearm → red → disarm → green is judged fresh each time: there
      // is no earlier green for a re-arm to inherit (predicted: alternating).
      const rearmed = await decide({ changedPaths: adr, getReviews: async () => approved, getArming: ARMED_BY('os-zhuang') });
      const disarmedAgain = await decide({ changedPaths: adr, getReviews: async () => approved, getArming: DISARMED });
      assert(
        'arming-is-read-fresh-so-rearming-is-red-again',
        disarmedApproved.ok === true && rearmed.ok === false && disarmedAgain.ok === true,
        `green→rearm→disarm gave ${disarmedApproved.ok}, ${rearmed.ok}, ${disarmedAgain.ok}`,
      );

      // The parser and the verdict, wired end to end on the real capture
      // (predicted: RED) — proves clause (2) fires on the shape GitHub sends,
      // not merely on the hand-built {armed:true} the other fixtures use.
      const fromCapture = await decide({
        changedPaths: adr,
        getReviews: async () => approved,
        getArming: async () => armingFrom(CAPTURED_ARMED_PULL),
      });
      assert('a-real-captured-armed-payload-is-red-end-to-end', !fromCapture.ok && fromCapture.arming?.by === 'os-zhuang', JSON.stringify(fromCapture));

      // #8012's incident, replayed: ADR tombstone diff, an AI seat's approval,
      // and that same seat's armed auto-merge — the 11:15Z state on PR #7960.
      // Under the review-only rule this was GREEN and would have merged
      // unattended. Predicted, and pinned: RED (see HISTORICAL_VIOLATIONS for
      // the same idiom applied to the 2026-08-08 merges).
      const incident = await decide({
        changedPaths: ['docs/adr/0001-withdrawn-metadata-service-architecture.md'],
        getReviews: async () => [review(OS_ZHUANG, 'APPROVED', '2026-08-12T11:14:00Z')],
        getArming: async () => armingFrom(CAPTURED_ARMED_PULL),
      });
      assert('the-7960-incident-state-replays-red', !incident.ok && incident.reasons.includes('auto-merge-armed'), JSON.stringify(incident));
    }

    // ── clause (2): not judged is not "judged and off" ───────────────────────
    // merge_group builds pass the sentinel. The verdict must record that the
    // question was NOT ASKED, so nothing downstream can read the green as
    // "arming was checked" (predicted: GREEN on an approved PR, judged=false,
    // armed=null rather than false).
    {
      const v = await decide({
        changedPaths: ['docs/adr/0001-x.md'],
        getReviews: async () => [review(HOTLONG, 'APPROVED', '2026-08-08T15:00:00Z')],
        getArming: ARMING_NOT_JUDGED,
      });
      assert('not-judged-arming-still-decides-on-the-approval', v.ok, JSON.stringify(v));
      assert('not-judged-arming-is-recorded-as-not-judged', v.arming?.judged === false, JSON.stringify(v.arming));
      assert(
        'not-judged-arming-is-null-never-false',
        v.arming?.armed === null,
        `armed must be null when unasked, so it cannot be misread as "checked and off", got ${JSON.stringify(v.arming?.armed)}`,
      );
    }

    // ── clause (2): a caller that forgets `getArming` FAILS ──────────────────
    // The mutation guard for the whole design: were the argument optional, any
    // future call site could silently reintroduce #8012 by omission. Predicted:
    // throws, on the ADR path AND on the clean path (it is a programming
    // error, not an input, so it is caught before the diff is even consulted).
    {
      const rejects = async (label, input, wanted) => {
        let message = null;
        try {
          await decide(input);
        } catch (error) {
          message = String(error?.message ?? error);
        }
        assert(label, message !== null && (!wanted || message.includes(wanted)), message === null ? 'did not throw' : `threw without ${JSON.stringify(wanted)}: ${message}`);
      };
      await rejects('omitting-getArming-throws', { changedPaths: ['docs/adr/0001-x.md'], getReviews: async () => [] }, 'getArming');
      await rejects('omitting-getArming-throws-on-a-clean-diff-too', { changedPaths: ['README.md'], getReviews: forbiddenLookup }, 'getArming');
      await rejects('a-non-thunk-getArming-throws', { changedPaths: ['docs/adr/0001-x.md'], getReviews: async () => [], getArming: true }, 'getArming');
      // A thunk that answers something other than {armed: boolean} is a broken
      // input, and a broken input fails loud rather than reading as disarmed.
      await rejects(
        'an-arming-read-that-answers-the-wrong-shape-throws',
        { changedPaths: ['docs/adr/0001-x.md'], getReviews: async () => [], getArming: async () => ({ enabled: true }) },
        'not {armed: boolean}',
      );
      await rejects(
        'an-arming-read-that-answers-null-throws',
        { changedPaths: ['docs/adr/0001-x.md'], getReviews: async () => [], getArming: async () => null },
        'not {armed: boolean}',
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

    // ── historical replay: the three measured violations (predicted: RED) ───
    for (const { pr, files, reviews } of HISTORICAL_VIOLATIONS) {
      const v = await decide({ changedPaths: files, getReviews: async () => reviews, getArming: DISARMED });
      assert(`historical-pr-${pr}-is-red-under-this-gate`, !v.ok, `PR #${pr} merged with no approving review must replay RED, got ${JSON.stringify(v)}`);
    }
    // ⚠️ #9238 specifically: it is red ONLY because of the widened predicate.
    // Narrow the predicate back to the ADR prefix and this assertion fails
    // while every other historical replay stays green — which is what makes
    // this fixture an instrument for #9395 rather than one more ADR case.
    {
      const skillViolation = HISTORICAL_VIOLATIONS.find((h) => h.pr === 9238);
      assert(
        'historical-pr-9238-is-red-BECAUSE-of-the-widened-predicate',
        adrFilesIn(skillViolation.files).length === 0 && governedFilesIn(skillViolation.files).length === 1,
        `#9238 touches no ADR path; it must be governed by the skill surface alone, got ${JSON.stringify(governedFilesIn(skillViolation.files).map((s) => s.id))}`,
      );
    }
    // The same three, had ANY account approved → GREEN (predicted: GREEN): pins
    // that the gate's red on the real history is ABOUT the missing approval,
    // not about ADR diffs being unmergeable per se. The approver here is the
    // AI seat that merged #6671 — under the pre-2026-08-12 rule this pair was
    // red, and it is the widened rule replayed against real captured payloads.
    for (const { pr, files } of HISTORICAL_VIOLATIONS) {
      const v = await decide({
        changedPaths: files,
        getReviews: async () => [review(OS_ZHUANG, 'APPROVED', '2026-08-08T15:00:00Z')],
        getArming: DISARMED,
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
