#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * fleet-write/execute — the relay's executor: the writes a validated payload
 * asked for, in order, as the fleet App, on a GitHub Actions runner.
 *
 *   FLEET_WRITE_PAYLOAD='…' FLEET_WRITE_SENDER=login GITHUB_TOKEN=… node scripts/pm/fleet-write/execute.mjs
 *   node scripts/pm/fleet-write/execute.mjs --payload-file payload.json      # the same, payload from disk
 *   node scripts/pm/fleet-write/execute.mjs --self-test                      # offline: a fake platform, no network
 *
 * ## Where this runs, and what it holds
 *
 * `.github/workflows/fleet-write.yml` runs this as its last step, after the
 * validator refused nothing and `actions/create-github-app-token` minted an
 * installation token narrowed to `payload.repo` — plus, for a `transfer`
 * stroke alone, the transfer's one target (`tokenRepositoriesOf` in
 * `validate.mjs`) — and to `PERMISSIONS` (`ops.mjs`). That token arrives in `GITHUB_TOKEN`, from the environment
 * only: it is never printed, never written to a file, never placed in an
 * argument; every string this file emits is scrubbed of it, and the runner's
 * own secret masking is the second net, not the first. The App's private key
 * never reaches this process at all — the mint is the action's.
 *
 * ## The sender gate — authorization comes from the TARGET repo
 *
 * `github.event.sender.login` is the login GitHub resolved from the token that
 * sent the dispatch. Before the first write this file asks the target repo
 * what that login may do there — `GET /repos/{repo}/collaborators/{login}/permission`
 * — and refuses unless the answer is `write`, `maintain` or `admin`
 * (GitHub folds `maintain` into `permission: write`; `role_name` carries the
 * exact role, and both are read). A refusal is a run failure with zero writes.
 * There is no sender allowlist: GitHub's write permission on the target IS
 * the authorization, so a seat that can push to a repo can write to it as the
 * fleet, and one that cannot, cannot — whichever repo the dispatch landed on.
 * The gate runs on EVERY repository the token reaches: a transfer stroke is
 * refused unless the sender holds write on the source AND the target, the
 * same pair GitHub itself requires of a person who transfers a card.
 *
 * ## The run
 *
 * Every action is validated AGAIN here (defence in depth: the executor trusts
 * the validator's rule, not the step that ran it), then its requests are
 * issued in order with the App token: REST calls straight from the op table;
 * the pull-request GraphQL ops resolve the pull's node id with one GET first,
 * and land only when the answer's `pullRequest` SHOWS the state the op table
 * declares for them (`PR_LANDED_STATE` in `ops.mjs`) — a 200 with `data` and
 * no `errors` whose pull is not in that state is a FAILED action naming what
 * the answer showed, exactly as a REST 4xx is; a `transfer` reads the issue (refusing a pull request, or a card that no
 * longer answers from the source — already moved) and the target repository,
 * then sends `transferIssue` with both node ids and accepts only an answer
 * that places the card on the target. A transfer that fails prints the
 * installation remedy `transferRemedy` spells, in the log and the summary.
 * A `workflow_dispatch` is one POST the platform answers 204 to with no body,
 * carrying the inputs the op table closes for that file and nothing else
 * (`WORKFLOW_DISPATCH_INPUTS`: none for the shard-timings refresh,
 * `refresh_version_pr: "true"` alone for `release.yml`, its bookkeeping lane)
 * — its row reads `accepted`; the run it started is read back by the SEAT
 * (`dispatch.mjs`), never here, because the answer carries no run id, and the
 * token that request spends `actions: write` on reaches that path and the
 * failed-jobs re-run below, and no other (`ops.mjs`, `REFUSED_PATH_FAMILIES`).
 * A `run_rerun_failed` is fenced on the run and read back HERE (the section
 * of that name below).
 * The FIRST failure stops the run — later actions are NOT attempted, and the
 * summary says which — because a seat that dispatched five related writes
 * must be able to read exactly where the board was left. A 404 on a directed
 * label DELETE is the label already being gone: idempotent success, the same
 * reading `label-write.mjs` takes.
 *
 * Every write goes through `write-pace.mjs` like every other fleet write: the
 * gap between two writes and the back-off marker a platform refusal writes
 * apply on the runner too (the runner's own home holds the log; nothing is
 * shared with a seat container, and the twenty-action cap bounds the run).
 *
 * ## Rule ⑤ on the runner — the executor announces the batch
 *
 * That log is fresh on every run and nothing reaches it from the seat, so a
 * seat's `--announce-batch` never applies here: left to rule ① alone, a stroke
 * of fifteen `issue_create` actions landed fifteen cards 3 s apart — 42 s from
 * one identity, the burst rule ⑤ exists to prevent. This file holds the whole
 * stroke, so it announces the batch itself: after the sender gate and before
 * the first write, a stroke carrying `DEFAULT_BATCH_THRESHOLD` or more
 * content-creating actions (`CONTENT_CREATING_OPS`, read off the op table in
 * `dispatch.mjs`) gets ONE `announceBatch` (kind `BATCH_KIND`) for its writes
 * from the first through the last content-creating one (`strokePacing`), so
 * each of those leaves `DEFAULT_BATCH_GAP_MS` after the one before; below the
 * threshold rule ①'s gap is unchanged. The transcript and the summary say so
 * in one line (`batchAnnouncedText`). Two refusals guard it, both before the
 * first write:
 *
 *   - a stroke whose pacing the relay job cannot hold — its `timeout-minutes`
 *     less the allowance an ordinary stroke has — is REFUSED with zero writes
 *     (exit 2, `strokeBudgetRefusal`), exactly as the packer refuses it at the
 *     seat (`dispatch.mjs`, its batch-gap section): run anyway, it could
 *     outlive the job, which the platform cancels mid-stroke with no summary.
 *     ⛔ Never a shorter gap instead;
 *   - an announcement the pace log cannot record is REFUSED (exit 10), the way
 *     `paceWrite` refuses an unrecordable write: unpaced is the state the
 *     throttle exists to prevent.
 *
 * ## The base sync — `pr_update_branch`, confirmed by MEASURE
 *
 * `PUT /repos/{repo}/pulls/{n}/update-branch` answers 202 "Updating pull
 * request branch." and merges asynchronously, so the answer is an acceptance,
 * not a landing. `confirmUpdateBranch` therefore polls `GET /pulls/{n}` every
 * `UPDATE_BRANCH_POLL_MS` for up to `UPDATE_BRANCH_WINDOW_MS` until the head
 * is no longer `expected_head_sha`, then reads `GET /repos/{repo}/commits/{sha}`
 * and prints old → new head with the merge commit's author as the platform
 * names it — the fleet-identity reading this op exists for, in the row and the
 * summary, so every real sync measures it. A window that expires is a FAILED
 * action whose sentence says UNCONFIRMED (the merge may still land; read the
 * pull, ⛔ never re-send), and the stroke stops there: a `pr_ready` queued
 * behind the sync never runs on an unconfirmed head.
 *
 * A 422 is two different things, and its sentence is never the judge — the
 * executor MEASURES: it re-reads the pull (a head that is no longer the
 * expected sha is a FAILED action naming both — the platform's "expected head
 * sha didn't match"), then `GET /repos/{repo}/compare/{base}...{head}`:
 * `behind_by` 0 means there was nothing to merge and the action LANDED as a
 * no-op, the row saying so and quoting the platform; anything else — a head
 * still behind its base, so the platform refused (an enqueued pull's "cannot
 * update" answer is read here, as a FAILED row), or a measure that could not
 * be read — is FAILED with the platform's sentence, never a no-op by default.
 * Any other status is FAILED as every REST 4xx is. The PUT is paced like
 * every other write verb.
 *
 * ## The failed-jobs re-run — `run_rerun_failed`, fenced on the RUN and read back
 *
 * The five fences on the run and its pull (`RERUN_FAILED_FENCES` in
 * `ops.mjs`: the workflow, the event, once, failed, the head) are facts about
 * the run, so this file is where they are AUTHORITATIVE
 * (`rerunFailedPreflight`). It first reads the job list of the run's attempt
 * 1, which is the read-back's baseline: the names of the jobs that concluded
 * `failure`. It then reads `GET /repos/{repo}/actions/runs/{run_id}` and, for
 * the pull the run names (`pull_requests[0].number`), that pull's own
 * `GET /repos/{repo}/pulls/{n}` — the last two requests before the POST — and
 * judges the five fences on those answers. The head fence compares the run's
 * `head_sha` with the pull's CURRENT head from that GET, never with the copy
 * the run embeds, and a run naming no pull is refused by name without a pull
 * read. A run or pull that could not be read, a fence that fails (every
 * failing one named, with what was read), a baseline that could not be read
 * whole, or a baseline with no failed job stops the action with the POST NOT
 * SENT: its row says `not sent`, zero writes, exit 5. A run re-run, or a pull
 * pushed to, by anyone between the seat's request and these reads is refused
 * here. ⛔ The seat wrapper's earlier check is advisory and is never trusted
 * in place of this one.
 *
 * The POST answers 201 with an empty body, which is an acceptance, not a
 * landing. `confirmRerunFailed` re-reads the run every `RERUN_FAILED_POLL_MS`
 * for up to `RERUN_FAILED_WINDOW_MS` until it shows `run_attempt` 2, then
 * reads attempt 2's job list and lands only on `rerunFailedReadBack`
 * (`ops.mjs`): every baseline job listed there is `queued` or
 * `in_progress`, at least one is, and the row names the new attempt and
 * those job ids. A baseline job not listed yet is named on the row, because
 * a job is listed when its needs finish. A failed job listed `completed` in
 * attempt 2 is a FAILED action. A window that never shows attempt 2, or that
 * never settles, is a FAILED action whose sentence says UNCONFIRMED: the
 * re-run may still start, so read the run and ⛔ never re-send. A re-send
 * would meet attempt 2 at the `once` fence anyway, and be refused there with
 * zero writes. Every read is an unpaced GET, and the one write is paced like
 * every write verb.
 *
 * ## The hierarchy link — `sub_issue_add` / `sub_issue_remove`, fenced on the CARDS and read back
 *
 * The fences on the two cards (`SUB_ISSUE_FENCES` in `ops.mjs`: parent,
 * child, and free for an add or listed for a remove) are facts about the
 * board, so this file is where they are AUTHORITATIVE (`subIssuePreflight`):
 * it reads the parent's and the child's own `GET /repos/{repo}/issues/{n}`,
 * then — only when both pass — the child's `GET …/issues/{child}/parent` for
 * an add, or the parent's sub-issue list (`readSubIssues`: every page at the
 * endpoint's maximum, to a cap; a walk past the cap is a truncated SUBSET and
 * never read as absent) for a remove, and judges every fence on those
 * answers. A fence that fails — every failing one named, with what was read —
 * stops the action with the write NOT SENT: its row says `not sent`, zero
 * writes, exit 5. The body the write carries is `{ sub_issue_id }`, the id
 * the CHILD's own answer gave, ⛔ never a number and never `replace_parent`.
 *
 * An add whose child already answers to THIS parent sends nothing: it is a
 * measured no-op, landed only when the parent's list reads the child back
 * (row status `not sent`, its result saying `no-op`). Every other write's
 * answer — 201 for the add, 200 for the remove — is an acceptance, not a
 * landing: `confirmSubIssue` re-reads the parent's list every
 * `SUB_ISSUE_POLL_MS` for up to `SUB_ISSUE_WINDOW_MS` and lands the action
 * only on `subIssueReadBack` (`ops.mjs`): the list lists the child's id
 * (add) or no longer does (remove). A non-2xx answer is a FAILED action with
 * the platform's sentence and nothing read back; a list that never settles,
 * or never reads whole, is a FAILED action whose sentence says UNCONFIRMED:
 * read the parent and ⛔ never re-send. Every read is an unpaced GET, and the
 * one write is paced like every write verb.
 *
 * ## The assignees and labels legs — `pr_create` with `assignees` / `labels`, the requests that read an earlier answer
 *
 * The op table spells each leg's path with a placeholder and `fromAnswer:
 * 'number'` (`ops.mjs`, its header). Within one action the requests run in
 * order and the FIRST answer — the create's — is kept; a descriptor carrying
 * `fromAnswer` is filled from that answer, ⛔ never from a later leg's
 * (the assignee POST answers the issue object, which happens to carry a
 * number, and the label POST answers an array, which carries none; neither
 * is the create) — `fillFromAnswer`: the field must be a positive integer,
 * and the path is the placeholder replaced by it, so the pull the assignee
 * or label lands on is the one the platform answered, ⛔ never one the
 * request named. An answer without it is a FAILED action with the leg NOT
 * SENT — its row says so, status `not sent` — and the stroke stops there as
 * on any failure. Each leg's landing is judged by its answer against what
 * was sent (`requestLanded`): the assignee leg's `assignees` against
 * `assigned` — GitHub documents a login the caller cannot apply as "silently
 * ignored", the 201 still answered; the label leg's answer, the pull's whole
 * label set, against `labelled` — a name sent and not listed did not land.
 * An answer listing fewer than sent is a FAILED action naming the missing
 * login or name, never a quiet partial; MORE than sent is not judged (the
 * Auto Label workflow writes `documentation` and `size/*` on open, additively,
 * so both sets land). The row prints the assignees, or the labels, as the
 * platform lists them (`resultOf`). Both legs are paced like every other
 * write verb.
 *
 * ## The governed-review follow-up — after `pr_ready`, ⛔ never after `pr_create`
 *
 * Once a `governedReview` row's own requests have landed (`GOVERNED_REVIEW_OPS`
 * in `ops.mjs`, its header section of this name: `pr_ready` alone, at the pull
 * the action names — the draft open summons nobody, because a human is asked
 * only at the seat's hand-off, `pr_request_reviewers` after its `## 席位核对`
 * ACCEPT and a same-head `## Contract review` PASS, so a `pr_create` is the
 * create plus the legs the caller spelled and nothing reads the pull's files
 * there), `requestGovernedReview` reads the pull's file list in
 * full (`readPullFiles`: every page, a cap that reds as a truncated subset) and
 * hands the paths to `governedReviewPlan`, a pure function over the register:
 * `governedPathsIn` scoped to `payload.repo` through `repoIdForSlug`, then
 * `landingTierOf` over the matched slice — a Tier H hit is the only answer that
 * sends anything; a Tier S or ungoverned diff, or a target outside
 * `GOVERNED_REPOS`, is ONE row saying so and zero writes. On a Tier H hit it
 * reads the pull (its author, pending `requested_reviewers`, `assignees`) and
 * its submitted reviews, and the plan is the `GOVERNED_APPROVERS` accounts
 * NOT in that union — requested, assigned or reviewed, the coverage the H43
 * patrol reads — so a re-run, a `pr_ready` after the seat's hand-off, or the
 * platform's own CODEOWNERS request landing first costs no write. The pull's
 * own author is never requested (GitHub answers 422) — a missing approver
 * who IS the author is ASSIGNED instead, the documented fallback. The writes
 * are what `governedReviewRequests` spells, judged by `requestLanded` as the
 * legs above are (`requested` against the pull's pending requests, `assigned`
 * against its assignees), one row each, paced like every write verb. An
 * unreadable file list, pull or review list, a truncated walk, or a refused
 * write is a FAILED action — the pull is open or ready, the row says what was
 * not sent, and the stroke stops there as on any failure: silence here is the
 * defect this follow-up exists to close, so it is never a quiet skip.
 *
 * ## The step summary — what a person reads back
 *
 * `$GITHUB_STEP_SUMMARY` gets one table per run: request id · sender and its
 * role · session · target, then one row per request — op, endpoint, HTTP
 * status, and the resulting id / url — and a last line saying how many landed
 * or where it stopped. Text is passed through unchanged: attribution stays
 * the session id inside the text, per protocol.
 *
 * ## The annotations — the numbers a seat CAN read
 *
 * A seat container reads neither this job's log (the endpoint answers 302 to
 * blob storage its egress proxy refuses) nor its step summary (the check
 * run's `output.summary` is null), but it does read the check run's
 * annotations. So for every action whose op creates or moves a card
 * (`ANNOTATED_OPS` in `dispatch.mjs`) and whose request LANDED, this file
 * prints ONE workflow command to stdout — a `notice` titled
 * `fleet-write <op>` whose message `relayAnnotationMessage` spells as
 * `fleet-write action=<i> op=<op> number=<n> url=<url>` — and the runner turns
 * it into an annotation. The number and url are read from the platform's
 * ANSWER to that request (`ANNOTATION_ANSWERS`: the created issue's
 * `number` / `html_url`, the `transferIssue` answer's `issue.number` /
 * `issue.url`), ⛔ never from the request; an answer that carries neither, or
 * a message `parseRelayAnnotation` would not read back as exactly this
 * number, url and landing repository, emits nothing and says so — the
 * reader's fallback then finds the card. No other op emits one. The
 * platform keeps 10 notice annotations per step and 50 per job and drops the
 * rest without a word (actions/toolkit `docs/problem-matchers.md`), so a
 * stroke past ten such ops names only its first ten; `dispatch.mjs`'s header
 * section of the same name is the reader's half. The message is escaped the
 * way actions/toolkit `command.ts` escapes a command's data and properties.
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0   every action landed.
 *   2   the payload was refused (the reasons are printed and summarised) — or the
 *       stroke's rule ⑤ pacing is over the relay job's budget; zero writes.
 *   3   PREREQUISITE NOT MET — no token, no sender, the permission read did
 *       not answer, or the platform was unreachable; zero writes.
 *   4   the sender is not authorized on the target repo; zero writes.
 *   5   an action FAILED; the summary names it and which earlier ones landed —
 *       a `run_rerun_failed` refused at a fence among them, its POST not sent.
 *  10   the write throttle refused (its prescription was printed), or a stroke's
 *       rule ⑤ batch could not be recorded; zero writes in that second case.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../../invoked-as.mjs';
// The register and the approver list, READ — never restated here (the ops.mjs header, "The governed-review follow-up").
import { GOVERNED_TIER_H, GOVERNED_TIER_S, governedPathsIn, landingTierOf, pullPathsFrom, repoIdForSlug } from '../check-governed-merges.mjs';
import { GOVERNED_APPROVERS } from '../check-governed-queue-guard.mjs';
import { scrub } from '../fleet-token.mjs';
import { classifyHttp } from '../label-write.mjs';
import { announceBatch, EXIT_WRITE_PACE_REFUSED, fmtDuration, isWriteMethod, noteResponse, paceFilePath, paceWrite, releaseWriteLease, unrecordableText } from '../write-pace.mjs';
import { ANNOTATED_OPS, parseRelayAnnotation, RELAY_ANNOTATION_PREFIX, relayAnnotationMessage, strokeBudgetRefusal, strokePacing } from './dispatch.mjs';
import {
  GOVERNED_REVIEW_FILES_PAGE_CAP,
  GOVERNED_REVIEW_FILES_PAGE_SIZE,
  GOVERNED_REVIEW_OPS,
  OPS,
  PERMISSIONS,
  PR_LANDED_STATE,
  RERUN_FAILED_ATTEMPT,
  answerPlaceholder,
  failedJobNames,
  governedReviewRequests,
  rerunFailedFenceFailures,
  rerunFailedFenceText,
  rerunFailedLandedText,
  rerunFailedPullNumber,
  rerunFailedReadBack,
  subIssueAlreadyHere,
  subIssueCardFailure,
  subIssueFenceFailures,
  subIssueFenceText,
  subIssueLandedText,
  subIssueReadBack,
  transferRemedy,
} from './ops.mjs';
import { PAYLOAD_ENV, refusalText, tokenRepositoriesOf, validatePayload } from './validate.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const DEFAULT_API = 'https://api.github.com';

export const EXIT_OK = 0;
export const EXIT_REFUSED = 2;
export const EXIT_PREREQUISITE = 3;
export const EXIT_SENDER_REFUSED = 4;
export const EXIT_ACTION_FAILED = 5;

/** The environment variable the workflow hands `github.event.sender.login` through. */
export const SENDER_ENV = 'FLEET_WRITE_SENDER';

/** The `kind` a stroke's rule ⑤ announcement is recorded under in the runner's pace log (header). */
export const BATCH_KIND = 'fleet-write stroke';

/** The roles that carry write permission on the target — GitHub's legacy base roles plus the exact role names. */
export const ALLOWED_PERMISSIONS = Object.freeze(['admin', 'write']);
export const ALLOWED_ROLE_NAMES = Object.freeze(['admin', 'maintain', 'write']);

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

/**
 * What the permission read means. `verdict` is one of:
 *   `allowed`       — write, maintain or admin; `role` names it;
 *   `refused`       — a lesser role, or not a collaborator at all (404);
 *   `prerequisite`  — the read did not answer (route, credential, 5xx).
 */
export function senderVerdict({ status, json } = {}) {
  if (status === 200 && json && typeof json === 'object') {
    const permission = typeof json.permission === 'string' ? json.permission : '';
    const roleName = typeof json.role_name === 'string' ? json.role_name : '';
    const allowed = ALLOWED_PERMISSIONS.includes(permission) || ALLOWED_ROLE_NAMES.includes(roleName);
    return { verdict: allowed ? 'allowed' : 'refused', role: roleName || permission || 'none', permission, roleName };
  }
  if (status === 404) return { verdict: 'refused', role: 'not a collaborator', permission: '', roleName: '' };
  return { verdict: 'prerequisite', role: '', permission: '', roleName: '' };
}

/** `owner/name` from an issue's `repository_url`, or null — where the card answers from NOW. */
export function repoOfIssue(json) {
  const m = /\/repos\/([^/]+\/[^/]+)$/.exec(String(json?.repository_url ?? ''));
  return m ? m[1] : null;
}

/**
 * Did this answer land the request? A 404 on a directed label DELETE is the label already being gone.
 * A pull-request mutation lands only when its answer SHOWS the state the op table declares for it
 * (`PR_LANDED_STATE`, carried on the descriptor as `landed`) — a 200 with `data` and no `errors` is
 * the platform accepting the request, not the pull being in that state.
 */
export function requestLanded(req, { status, json } = {}) {
  if (req.graphql) {
    if (status !== 200 || !json || typeof json !== 'object') return { ok: false, why: `HTTP ${status}` };
    if (Array.isArray(json.errors) && json.errors.length) return { ok: false, why: `GraphQL: ${json.errors.map((e) => e?.message ?? 'error').join('; ')}` };
    if (!json.data) return { ok: false, why: 'GraphQL: no data' };
    if (req.graphql.target_repo !== undefined) {
      // A transfer lands only when the answer places the card on the target.
      const moved = json.data[req.graphql.mutation]?.issue;
      const where = moved?.repository?.nameWithOwner;
      if (!moved || !Number.isInteger(moved.number)) return { ok: false, why: 'GraphQL: the answer carries no transferred issue' };
      if (String(where ?? '').toLowerCase() !== req.graphql.target_repo.toLowerCase()) return { ok: false, why: `GraphQL: the answer places the issue on ${where ?? 'no repository'}, not ${req.graphql.target_repo}` };
    }
    if (req.graphql.pull !== undefined) {
      const landed = req.graphql.landed;
      if (!landed || typeof landed.holds !== 'function') return { ok: false, why: `the op table declares no landed state for ${req.graphql.mutation}, so its answer cannot be judged — a 200 alone is not a landing` };
      const pr = json.data[req.graphql.mutation]?.pullRequest;
      if (!pr || typeof pr !== 'object') return { ok: false, why: 'GraphQL: the answer carries no pullRequest' };
      if (!landed.holds(pr)) return { ok: false, why: `GraphQL: HTTP 200 with no errors, but the answer shows ${pullStateText(pr)} — the op asked for ${landed.wants}` };
    }
    return { ok: true, why: '' };
  }
  if (status >= 200 && status < 300) {
    // The assignees leg (header): a 2xx whose answer lists fewer logins than sent is a FAILED action, never a quiet partial.
    if (Array.isArray(req.assigned)) {
      const listed = assigneeLogins(json);
      const missing = req.assigned.filter((login) => !listed.some((l) => l.toLowerCase() === login.toLowerCase()));
      if (missing.length) {
        return { ok: false, why: `HTTP ${status}, but the answer lists ${listed.length ? listed.join(', ') : 'no assignees'} — ${missing.join(', ')} not assigned (GitHub ignores a login the repository cannot assign without a word: it must be a collaborator the repository can assign)` };
      }
    }
    // The governed-review request (header): the answer is the pull with its PENDING requests; a login sent and not listed did not land.
    if (Array.isArray(req.requested)) {
      const listed = reviewerLogins(json);
      const missing = req.requested.filter((login) => !listed.some((l) => l.toLowerCase() === login.toLowerCase()));
      if (missing.length) {
        return { ok: false, why: `HTTP ${status}, but the answer lists ${listed.length ? listed.join(', ') : 'no requested reviewers'} — ${missing.join(', ')} not requested (the endpoint answers the pull with its pending review requests, so a login it lacks was not written; read the pull on the board before anything else)` };
      }
    }
    // The labels leg (header): the answer is the pull's whole label set; a name sent and not listed did not land.
    if (Array.isArray(req.labelled)) {
      const listed = labelNames(json);
      const missing = req.labelled.filter((name) => !listed.some((l) => l.toLowerCase() === name.toLowerCase()));
      if (missing.length) {
        return { ok: false, why: `HTTP ${status}, but the answer lists ${listed.length ? listed.join(', ') : 'no labels'} — ${missing.join(', ')} not applied (the labels endpoint answers the pull's whole label set, so a name it lacks was not written; read the pull on the board before anything else)` };
      }
    }
    return { ok: true, why: '' };
  }
  if (status === 404 && req.idempotent404) return { ok: true, why: 'already absent', idempotent: true };
  return { ok: false, why: `HTTP ${status}${typeof json?.message === 'string' ? ` — ${json.message}` : ''}` };
}

/** The logins an issue or pull answer lists as assigned, in the platform's order; `[]` when it lists none. Pure. */
export function assigneeLogins(json) {
  return Array.isArray(json?.assignees) ? json.assignees.map((u) => (typeof u?.login === 'string' ? u.login : null)).filter(Boolean) : [];
}

/** The names a labels answer (an array of label objects) lists, in the platform's order; `[]` when it lists none. Pure. */
export function labelNames(json) {
  return Array.isArray(json) ? json.map((l) => (typeof l?.name === 'string' ? l.name : null)).filter(Boolean) : [];
}

/** The logins a pull answer lists as PENDING review requests (`requested_reviewers`), in the platform's order; `[]` when none. Pure. */
export function reviewerLogins(json) {
  return Array.isArray(json?.requested_reviewers) ? json.requested_reviewers.map((u) => (typeof u?.login === 'string' ? u.login : null)).filter(Boolean) : [];
}

/** The logins that have SUBMITTED a review in a reviews answer — any state but `PENDING` (unsubmitted); `[]` when none. Pure. */
export function reviewedLogins(json) {
  return Array.isArray(json) ? json.filter((r) => r?.state !== 'PENDING').map((r) => (typeof r?.user?.login === 'string' ? r.user.login : null)).filter(Boolean) : [];
}

/**
 * The governed-review plan for ONE pull (header: "The governed-review follow-up"). Pure — the executor reads
 * the file list, the pull and its reviews, hands them in, and sends exactly what comes back:
 *
 *   repoId     the register id of `repo`, or null for a target outside `GOVERNED_REPOS` (no row governs it);
 *   matched    the governed slice of `paths` (`governedPathsIn`), for the row's wording;
 *   tier       `H` when the slice lands on an authorized approval, `S` when every hit is Tier S, null when no
 *              governed row is hit — read through `landingTierOf` over the MATCHED slice, never over nothing
 *              (an empty slice answers H there, fail-closed, which is the wrong answer for "send a request");
 *   covered    the approvers already requested, assigned or holding a submitted review — the H43 union;
 *   toRequest  on a Tier H hit, the approvers not covered and not the pull's author;
 *   toAssign   on a Tier H hit, the author when it is an uncovered approver (a request naming it is a 422).
 *
 * Logins are matched as GitHub matches them, case-insensitively; the answer keeps `approvers`' own spelling and order.
 */
export function governedReviewPlan({ paths, repo, author = null, requested = [], assigned = [], reviewed = [], approvers = GOVERNED_APPROVERS } = {}) {
  const repoId = repoIdForSlug(repo);
  const matched = repoId ? governedPathsIn(Array.isArray(paths) ? paths : [], repoId) : [];
  const tier = matched.length === 0 ? null : landingTierOf(matched);
  const lower = (list) => (Array.isArray(list) ? list : []).map((l) => String(l).toLowerCase());
  const have = new Set([...lower(requested), ...lower(assigned), ...lower(reviewed)]);
  const list = Array.isArray(approvers) ? approvers : [];
  const covered = list.filter((a) => have.has(a.toLowerCase()));
  const missing = tier === GOVERNED_TIER_H ? list.filter((a) => !have.has(a.toLowerCase())) : [];
  const isAuthor = (a) => typeof author === 'string' && a.toLowerCase() === author.toLowerCase();
  return { repoId, matched, tier, covered, toRequest: missing.filter((a) => !isAuthor(a)), toAssign: missing.filter(isAuthor) };
}

/** The words the follow-up's verdict row prints for a plan — what was hit, who is covered, what will be sent. Pure. */
export function governedReviewText(plan, { repo, files, approvers = GOVERNED_APPROVERS } = {}) {
  const hits = plan.matched.map((s) => `\`${s.glob}\`×${s.files.length}`).join(', ');
  if (plan.repoId === null) return `governed review: ${repo} is outside GOVERNED_REPOS, so no register row governs it — ${files} file(s), no review requested`;
  if (plan.tier === null) return `governed review: no governed row hit across ${files} file(s) — no review requested`;
  if (plan.tier === GOVERNED_TIER_S) return `governed review: Tier S (${hits}) lands on a seat's review of record — no review requested`;
  const named = (logins) => logins.map((l) => `\`${l}\``).join(', ');
  const sending = [plan.toRequest.length ? `requesting ${named(plan.toRequest)}` : '', plan.toAssign.length ? `assigning the author ${named(plan.toAssign)} (a request naming the author is a 422)` : ''].filter(Boolean).join(' and ');
  if (!sending) return `governed review: Tier H (${hits}) — ${named(approvers)} already requested, assigned or reviewed; nothing to send`;
  return `governed review: Tier H (${hits}) — ${plan.covered.length ? `${named(plan.covered)} already covered; ` : ''}${sending}`;
}

/**
 * A descriptor carrying `fromAnswer` filled from its action's FIRST request's
 * answer — the create's (header): `{ req }` with the placeholder replaced by
 * the positive integer that answer carries at the field, or `{ fail }` — the
 * sentence the row prints — when no answer carries it. Pure; never throws.
 */
export function fillFromAnswer(req, prev) {
  const field = req.fromAnswer;
  const placeholder = answerPlaceholder(field);
  if (typeof req.path !== 'string' || !req.path.includes(placeholder)) return { fail: `the op table spells a fromAnswer leg whose path ${req.path} carries no ${placeholder} placeholder — a bug in ops.mjs, not in the payload` };
  if (!prev) return { fail: `the op table spells a fromAnswer leg as the FIRST request of its action, so no answer carries ${field} yet — a bug in ops.mjs, not in the payload` };
  const value = prev.json?.[field];
  if (!Number.isInteger(value) || value < 1) return { fail: `${prev.call} answered HTTP ${prev.status} without a positive integer ${field} (got ${JSON.stringify(value ?? null)}), so the leg ${req.verb} ${req.path} was NOT SENT — read the pull on the board before anything else` };
  return { req: { ...req, path: req.path.replaceAll(placeholder, String(value)) } };
}

/**
 * A pull request's state as a mutation answered it — every field the row selected, so a failure names
 * what came back and a landing names how (armed, or already in the merge queue).
 */
export function pullStateText(pr) {
  const bits = [`#${pr.number}`];
  if (typeof pr.isDraft === 'boolean') bits.push(pr.isDraft ? 'draft' : 'ready');
  if ('autoMergeRequest' in pr) bits.push(pr.autoMergeRequest ? `auto-merge ${pr.autoMergeRequest.mergeMethod ?? ''}`.trim() : 'auto-merge off');
  if (typeof pr.isInMergeQueue === 'boolean') bits.push(pr.isInMergeQueue ? 'in the merge queue' : 'not in the merge queue');
  if (typeof pr.isMergeQueueEnabled === 'boolean') bits.push(pr.isMergeQueueEnabled ? 'its base has a merge queue' : 'its base has no merge queue');
  return bits.join(' · ');
}

/** The base sync's answer of acceptance, its confirmation window and its poll interval (header). */
export const UPDATE_BRANCH_ACCEPTED = 202;
export const UPDATE_BRANCH_WINDOW_MS = 60_000;
export const UPDATE_BRANCH_POLL_MS = 3_000;

const shortSha = (sha) => String(sha ?? '').slice(0, 7);
/** A compare ref (`owner:branch`) as a path segment — the branch's own slashes stay slashes. */
const refSegment = (label) => encodeURIComponent(label).replace(/%2F/g, '/');

/**
 * Did the base sync LAND? Judged by measure, never by the answer's sentence
 * (header): a 202 is confirmed by polling the pull's head off the expected sha
 * inside the window, then reading the merge commit's author; a 422 is a no-op
 * only when the head is still the expected sha AND the compare measures it not
 * behind its base. Returns `{ ok, why, result }` — `result` the row's text on
 * a landing. Never throws on a status.
 */
export async function confirmUpdateBranch(req, answer, payload, api, t, { sleep, now, windowMs = UPDATE_BRANCH_WINDOW_MS, pollMs = UPDATE_BRANCH_POLL_MS } = {}) {
  const { pull, expectedHeadSha } = req.updateBranch;
  const pullPath = `/repos/${payload.repo}/pulls/${pull}`;
  const said = (r) => `${r.call} -> HTTP ${r.status}${r.detail ? ` (${r.detail})` : ''}`;
  const platform = `HTTP ${answer.status}${answer.detail ? ` — ${answer.detail}` : ''}`;
  if (answer.status === 422) {
    const pr = await rest(api, pullPath, {}, t);
    if (pr.status !== 200 || typeof pr.json?.head?.sha !== 'string') return { ok: false, why: `${platform}; the pull could not be re-read to tell a no-op from a refusal (${said(pr)})` };
    if (pr.json.head.sha !== expectedHeadSha) return { ok: false, why: `${platform}; the head is ${shortSha(pr.json.head.sha)}, not the expected ${shortSha(expectedHeadSha)} — re-read the pull and send its current head` };
    const baseLabel = pr.json.base?.label;
    const headLabel = pr.json.head?.label;
    if (typeof baseLabel !== 'string' || typeof headLabel !== 'string') return { ok: false, why: `${platform}; the pull's base and head labels could not be read, so the compare that tells a no-op from a refusal was not taken` };
    const baseRef = typeof pr.json.base?.ref === 'string' ? pr.json.base.ref : baseLabel;
    const cmp = await rest(api, `/repos/${payload.repo}/compare/${refSegment(baseLabel)}...${refSegment(headLabel)}`, {}, t);
    if (cmp.status !== 200 || !Number.isInteger(cmp.json?.behind_by)) return { ok: false, why: `${platform}; the compare could not be read to tell a no-op from a refusal (${said(cmp)})` };
    if (cmp.json.behind_by === 0) return { ok: true, why: '', result: `no-op: head ${shortSha(expectedHeadSha)} is not behind ${baseRef} (behind_by 0), nothing to merge; the platform said "${answer.detail}"` };
    return { ok: false, why: `${platform}; the head is behind ${baseRef} by ${cmp.json.behind_by} commit(s), so the platform refused the sync — not a no-op` };
  }
  if (answer.status !== UPDATE_BRANCH_ACCEPTED) return { ok: false, why: platform };
  const started = now();
  let head = null;
  for (;;) {
    const pr = await rest(api, pullPath, {}, t);
    if (pr.status === 200 && typeof pr.json?.head?.sha === 'string') {
      head = pr.json.head.sha;
      if (head !== expectedHeadSha) {
        const commit = await rest(api, `/repos/${payload.repo}/commits/${head}`, {}, t);
        const author = commit.status === 200 && commit.json ? `${commit.json.author?.login ?? 'no login'} (${commit.json.commit?.author?.name ?? '?'})` : `unread (${said(commit)})`;
        return { ok: true, why: '', result: `head ${shortSha(expectedHeadSha)} → ${shortSha(head)} · merge commit author ${author}` };
      }
    }
    if (now() - started >= windowMs) break;
    await sleep(pollMs);
  }
  return { ok: false, why: `HTTP ${UPDATE_BRANCH_ACCEPTED} accepted, but the head ${head === null ? 'could not be read' : `is still ${shortSha(head)}`} ${windowMs} ms later — UNCONFIRMED: the merge may still land; read the pull before anything else, ⛔ do not re-send` };
}

/** The failed-jobs re-run's read-back window and poll interval (header): the run is re-read until it shows the new attempt. */
export const RERUN_FAILED_WINDOW_MS = 60_000;
export const RERUN_FAILED_POLL_MS = 3_000;
/** An attempt's job list is walked at the endpoint's page maximum, to a cap — a walk past it is a truncated SUBSET. */
export const RERUN_FAILED_JOBS_PAGE_SIZE = 100;
export const RERUN_FAILED_JOBS_PAGE_CAP = 10;

/**
 * One attempt's job list, every page: `{ jobs }`, or `{ fail: { call, status, why } }` for a page that did not
 * answer 200 with a `jobs` array, or a walk past `RERUN_FAILED_JOBS_PAGE_CAP` pages. Never throws.
 */
async function readAttemptJobs(repo, runId, attempt, api, t) {
  const jobs = [];
  const call = `GET /repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs`;
  for (let page = 1; page <= RERUN_FAILED_JOBS_PAGE_CAP; page++) {
    const r = await rest(api, `/repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=${RERUN_FAILED_JOBS_PAGE_SIZE}&page=${page}`, {}, t);
    if (r.status !== 200 || !Array.isArray(r.json?.jobs)) return { fail: { call, status: r.status, why: `${call} -> HTTP ${r.status}${r.detail ? ` (${r.detail})` : ''}: attempt ${attempt}'s job list could not be read` } };
    jobs.push(...r.json.jobs);
    const total = Number.isInteger(r.json.total_count) ? r.json.total_count : null;
    if (r.json.jobs.length < RERUN_FAILED_JOBS_PAGE_SIZE || (total !== null && jobs.length >= total)) return { jobs };
  }
  return { fail: { call, status: 200, why: `attempt ${attempt}'s job list hit its ${RERUN_FAILED_JOBS_PAGE_CAP}-page cap with ${jobs.length} job(s) collected and more pending — a truncated list is a SUBSET` } };
}

/**
 * The fences, AUTHORITATIVE (header: "The failed-jobs re-run"): attempt 1's job list (the read-back's baseline),
 * then the run, then the pull it names — the last two reads before the POST — judged against
 * `RERUN_FAILED_FENCES`. The pull's head is the pull's OWN answer, never the run's embedded copy. Returns
 * `{ run, pull, failed }` to send, or `{ fail: why }` — the sentence the row prints, the POST NOT SENT. Never throws
 * on a status.
 */
export async function rerunFailedPreflight(req, payload, api, t) {
  const { runId } = req.rerunFailed;
  const baseline = await readAttemptJobs(payload.repo, runId, RERUN_FAILED_ATTEMPT, api, t);
  const run = await rest(api, `/repos/${payload.repo}/actions/runs/${runId}`, {}, t);
  if (run.status !== 200 || !run.json || typeof run.json !== 'object') {
    return { fail: `${run.call} -> HTTP ${run.status}${run.detail ? ` (${run.detail})` : ''}: the run could not be read, so its fences were not judged — nothing sent` };
  }
  // The head fence's read: the pull the run names, by its own GET. A run naming none is judged without it and refused by name.
  const number = rerunFailedPullNumber(run.json);
  let pull = null;
  if (number !== null) {
    const p = await rest(api, `/repos/${payload.repo}/pulls/${number}`, {}, t);
    if (p.status !== 200 || !p.json || typeof p.json !== 'object') {
      return { fail: `${p.call} -> HTTP ${p.status}${p.detail ? ` (${p.detail})` : ''}: pull #${number}, the run's pull request, could not be read, so the head fence was not judged — nothing sent` };
    }
    pull = p.json;
  }
  const failures = rerunFailedFenceFailures(run.json, pull);
  if (failures.length) return { fail: `REFUSED at the relay's fence on run ${runId}, nothing sent — ${rerunFailedFenceText(failures)}` };
  if (baseline.fail) return { fail: `${baseline.fail.why}, so the read-back has no baseline — nothing sent` };
  const failed = failedJobNames(baseline.jobs);
  if (!failed.length) return { fail: `attempt ${RERUN_FAILED_ATTEMPT} of run ${runId} lists ${baseline.jobs.length} job(s) and none concluded failure, so a re-run's read-back would have nothing to confirm — nothing sent` };
  return { run: run.json, pull, failed };
}

/**
 * Did the re-run LAND? Judged by reading the run back, never by the 201 (header): the run re-read until it shows
 * the new attempt, then that attempt's job list judged by `rerunFailedReadBack`. Returns `{ ok, why, result }` —
 * `result` the row's text on a landing, naming the new attempt's job ids. Never throws on a status.
 */
export async function confirmRerunFailed(req, answer, pre, payload, api, t, { sleep, now, windowMs = RERUN_FAILED_WINDOW_MS, pollMs = RERUN_FAILED_POLL_MS } = {}) {
  const platform = `HTTP ${answer.status}${answer.detail ? ` — ${answer.detail}` : ''}`;
  if (!(answer.status >= 200 && answer.status < 300)) return { ok: false, why: platform };
  const { runId } = req.rerunFailed;
  const want = RERUN_FAILED_ATTEMPT + 1;
  const started = now();
  let last = 'nothing was read back';
  for (;;) {
    const run = await rest(api, `/repos/${payload.repo}/actions/runs/${runId}`, {}, t);
    if (run.status !== 200 || !run.json || typeof run.json !== 'object') last = `${run.call} -> HTTP ${run.status}${run.detail ? ` (${run.detail})` : ''}: the run could not be re-read`;
    else if (run.json.run_attempt !== want) last = rerunFailedReadBack({ failed: pre.failed, run: run.json }).why;
    else {
      const listed = await readAttemptJobs(payload.repo, runId, want, api, t);
      if (listed.fail) last = listed.fail.why;
      else {
        const v = rerunFailedReadBack({ failed: pre.failed, run: run.json, jobs: listed.jobs });
        if (v.ok) return { ok: true, why: '', result: rerunFailedLandedText(v) };
        if (!v.pending) return { ok: false, why: `${platform} accepted, but ${v.why} — read the run before anything else, ⛔ do not re-send` };
        last = v.why;
      }
    }
    if (now() - started >= windowMs) break;
    await sleep(pollMs);
  }
  return { ok: false, why: `${platform} accepted, but ${last} ${windowMs} ms later — UNCONFIRMED: the re-run may still start; read the run before anything else, ⛔ do not re-send (a second send meets attempt ${want} at the once fence and is refused)` };
}

/** The hierarchy link's read-back window and poll interval (header): the parent's list is re-read until it settles. */
export const SUB_ISSUE_WINDOW_MS = 30_000;
export const SUB_ISSUE_POLL_MS = 3_000;
/** A parent's sub-issue list is walked at the endpoint's page maximum, to a cap — a walk past it is a truncated SUBSET. */
export const SUB_ISSUE_LIST_PAGE_SIZE = 100;
export const SUB_ISSUE_LIST_PAGE_CAP = 10;

/**
 * A parent's sub-issue list, every page: `{ items }`, or `{ fail }` — the sentence — for a page that did not answer
 * 200 with an array, or a walk past `SUB_ISSUE_LIST_PAGE_CAP` pages. Never throws.
 */
async function readSubIssues(repo, parent, api, t) {
  const items = [];
  const call = `GET /repos/${repo}/issues/${parent}/sub_issues`;
  for (let page = 1; page <= SUB_ISSUE_LIST_PAGE_CAP; page++) {
    const r = await rest(api, `/repos/${repo}/issues/${parent}/sub_issues?per_page=${SUB_ISSUE_LIST_PAGE_SIZE}&page=${page}`, {}, t);
    if (r.status !== 200 || !Array.isArray(r.json)) return { fail: `${call} -> HTTP ${r.status}${r.detail ? ` (${r.detail})` : ''}: #${parent}'s sub-issue list could not be read` };
    items.push(...r.json);
    if (r.json.length < SUB_ISSUE_LIST_PAGE_SIZE) return { items };
  }
  return { fail: `#${parent}'s sub-issue list hit its ${SUB_ISSUE_LIST_PAGE_CAP}-page cap with ${items.length} entries collected and more pending — a truncated list is a SUBSET, never read as absent` };
}

/**
 * The fences, AUTHORITATIVE (header: "The hierarchy link"): the parent's and the child's own answers, then — only
 * when both pass — the child's parent read (add) or the parent's whole list (remove), judged against
 * `SUB_ISSUE_FENCES`. Returns `{ childId, already }` to proceed — `already` an add whose child answers to THIS
 * parent, the no-op — or `{ fail: why }`, the sentence the row prints, the write NOT SENT. Never throws on a status.
 */
export async function subIssuePreflight(req, payload, api, t) {
  const { mode, parent, child } = req.subIssue;
  const repo = payload.repo;
  const ctx = { mode, repo, parentNumber: parent, childNumber: child };
  ctx.parent = await rest(api, `/repos/${repo}/issues/${parent}`, {}, t);
  ctx.child = await rest(api, `/repos/${repo}/issues/${child}`, {}, t);
  if (subIssueCardFailure(ctx.parent, repo, parent) === null && subIssueCardFailure(ctx.child, repo, child) === null) {
    if (mode === 'add') ctx.childParent = await rest(api, `/repos/${repo}/issues/${child}/parent`, {}, t);
    else ctx.list = await readSubIssues(repo, parent, api, t);
  }
  const failures = subIssueFenceFailures(ctx);
  if (failures.length) return { fail: `REFUSED at the relay's fence on #${parent} ← #${child}, nothing sent — ${subIssueFenceText(failures)}` };
  return { childId: ctx.child.json.id, already: mode === 'add' && subIssueAlreadyHere(ctx) };
}

/**
 * Did the hierarchy link LAND? Judged by reading the parent's list back, never by the answer (header). `answer`
 * is the write's, or null for the no-op, which sent nothing. Returns `{ ok, why, result }`. Never throws on a status.
 */
export async function confirmSubIssue(req, answer, pre, payload, api, t, { sleep, now, windowMs = SUB_ISSUE_WINDOW_MS, pollMs = SUB_ISSUE_POLL_MS } = {}) {
  const { mode, parent, child } = req.subIssue;
  const platform = answer ? `HTTP ${answer.status}${answer.detail ? ` — ${answer.detail}` : ''}` : null;
  if (answer && !(answer.status >= 200 && answer.status < 300)) return { ok: false, why: platform };
  const started = now();
  let last = 'nothing was read back';
  for (;;) {
    const list = await readSubIssues(payload.repo, parent, api, t);
    if (list.fail) last = list.fail;
    else {
      const v = subIssueReadBack({ mode, childId: pre.childId, items: list.items });
      if (v.ok) return { ok: true, why: '', result: subIssueLandedText({ mode, parentNumber: parent, childNumber: child, childId: pre.childId, count: v.count, noop: !answer }) };
      last = v.why;
    }
    if (now() - started >= windowMs) break;
    await sleep(pollMs);
  }
  if (!answer) return { ok: false, why: `nothing sent — #${child}'s parent read named #${parent}, but ${last} ${windowMs} ms later: the two reads disagree; read #${parent}'s sub-issues before anything else` };
  return { ok: false, why: `${platform} accepted, but ${last} ${windowMs} ms later — UNCONFIRMED: read #${parent}'s sub-issues before anything else, ⛔ do not re-send` };
}

/** The one thing a seat needs from an answer: the id / number / url of what was written — or that a bodiless 204 accepted it. */
export function resultOf(req, json, status = null) {
  if (status === 204 && (json === null || json === undefined)) return 'accepted (HTTP 204, no body)';
  if (req.graphql) {
    const moved = json?.data?.[req.graphql.mutation]?.issue;
    if (moved) return [`#${moved.number}`, moved.url, moved.repository?.nameWithOwner ? `(now on ${moved.repository.nameWithOwner})` : ''].filter(Boolean).join(' ');
    const pr = json?.data?.[req.graphql.mutation]?.pullRequest;
    if (!pr) return 'ok';
    return pullStateText(pr);
  }
  // The labels leg's row prints the labels as the platform lists them (header); a plain labels_add is counted.
  if (Array.isArray(json)) return Array.isArray(req.labelled) ? `${json.length} label(s) now on the pull · labels ${labelNames(json).join(', ') || 'none'}` : `${json.length} label(s) now on the issue`;
  if (!json || typeof json !== 'object') return 'ok';
  const bits = [];
  if (Number.isInteger(json.number)) bits.push(`#${json.number}`);
  else if (Number.isInteger(json.id)) bits.push(`id ${json.id}`);
  if (typeof json.html_url === 'string') bits.push(json.html_url);
  // The assignees leg's row prints the assignees as the platform lists them (header).
  if (Array.isArray(req.assigned)) bits.push(`· assignees ${assigneeLogins(json).join(', ') || 'none'}`);
  // The governed-review request's row prints the pull's pending requests as the platform lists them (header).
  if (Array.isArray(req.requested)) bits.push(`· review requested from ${reviewerLogins(json).join(', ') || 'none'}`);
  return bits.join(' ') || 'ok';
}

/**
 * Where each annotated op's ANSWER carries the number and url of the card it
 * created or moved — keyed exactly as `ANNOTATED_OPS` (the self-test pins it).
 * ⛔ Never the request: an annotation reports what the platform answered.
 */
export const ANNOTATION_ANSWERS = Object.freeze({
  issue_create: (req, json) => ({ number: json?.number, url: json?.html_url }),
  transfer: (req, json) => {
    const moved = json?.data?.[req?.graphql?.mutation]?.issue;
    return { number: moved?.number, url: moved?.url };
  },
});

/** A workflow command's data, escaped as actions/toolkit `command.ts` `escapeData` does. */
export function escapeCommandData(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** A workflow command's property value, escaped as actions/toolkit `command.ts` `escapeProperty` does. */
export function escapeCommandProperty(s) {
  return escapeCommandData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/**
 * The annotation one landed request earns: `{ note }` — `{ action, op,
 * number, url, repo }`, exactly what `parseRelayAnnotation` reads back from
 * its message — or `{ note: null, why }`: `why` is empty for an op that is not
 * annotated, and names the reason for one whose answer cannot be reported
 * (no number and url, a url the reader would not parse as this number, or one
 * naming another repository than the op lands the card on). Pure.
 */
export function annotationFor({ action, op, req, json, payload }) {
  if (!Object.hasOwn(ANNOTATION_ANSWERS, op) || !Object.hasOwn(ANNOTATED_OPS, op)) return { note: null, why: '' };
  const { number, url } = ANNOTATION_ANSWERS[op](req, json);
  if (!Number.isInteger(number) || number < 1 || typeof url !== 'string' || url === '') return { note: null, why: 'the answer carries no number and url' };
  const back = parseRelayAnnotation(relayAnnotationMessage({ action, op, number, url }));
  if (!back || back.action !== action || back.op !== op || back.number !== number || back.url !== url) return { note: null, why: `the answer's url ${url} is not one the reader parses as #${number}` };
  const lands = String(ANNOTATED_OPS[op].lands(payload?.actions?.[action - 1], payload?.repo) ?? '');
  if (back.repo.toLowerCase() !== lands.toLowerCase()) return { note: null, why: `the answer's url names ${back.repo}, not ${lands || 'the repository the op lands on'}` };
  return { note: back, why: '' };
}

/** The workflow command that turns a note into a `notice` annotation on this job's check run. Pure. */
export function annotationCommand(note) {
  return `::notice title=${escapeCommandProperty(`${RELAY_ANNOTATION_PREFIX} ${note.op}`)}::${escapeCommandData(relayAnnotationMessage(note))}`;
}

/** The line a batched stroke's transcript and summary carry: rule ⑤ on the runner, said out loud. Pure. */
export function batchAnnouncedText(p) {
  return (
    `rule ⑤ — ${p.creating} content-creating action(s), at or above the batch threshold of ${p.threshold}: a batch of ${p.batchWrites} ` +
    `write(s) announced on the runner, each ${fmtDuration(p.gapMs)} after the one before (${fmtDuration(p.pacingMs)} of pacing) — the pauses are the contract, not a hang`
  );
}

/** The summary table, as markdown lines. */
export function summaryText({ payload, sender, role, rows, stoppedAt = null, notAttempted = 0, refusal = null, remedy = null, reaches = null, pacing = null }) {
  const lines = [`### fleet-write \`${payload?.request_id ?? '?'}\``, ''];
  const also = Array.isArray(reaches) && reaches.length > 1 ? ` · the token also reaches ${reaches.slice(1).map((r) => `\`${r}\``).join(', ')}` : '';
  lines.push(`- sender: \`${sender ?? '?'}\`${role ? ` (${role})` : ''} · session: \`${payload?.session ?? '?'}\` · target: \`${payload?.repo ?? '?'}\`${also} · ${payload?.actions?.length ?? 0} action(s)`);
  if (pacing?.batched) lines.push(`- pacing: ${batchAnnouncedText(pacing)}`);
  if (refusal) {
    lines.push('', `⛔ ${refusal} — zero writes.`);
    return `${lines.join('\n')}\n`;
  }
  lines.push('', '| # | op | request | HTTP | result |', '|---|---|---|---|---|');
  for (const r of rows) lines.push(`| ${r.action} | \`${r.op}\` | \`${r.call}\` | ${r.status} | ${r.result} |`);
  lines.push('');
  if (stoppedAt === null) lines.push(`✓ ${rows.length} request(s) landed, every action done.`);
  else lines.push(`✗ stopped at action ${stoppedAt.action} (\`${stoppedAt.op}\`): ${stoppedAt.why}. ${notAttempted} later action(s) NOT attempted.`);
  if (remedy) lines.push('', `Remedy: ${remedy}`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Transport — one shape, both halves of the throttle around every write verb.
// ⛔ Nothing here throws on an HTTP status; a refusal is an observation.
// ---------------------------------------------------------------------------

async function rest(api, path, { method = 'GET', body = null } = {}, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const token = deps.token ?? '';
  const paceDeps = deps.pace ?? {};
  const paced = isWriteMethod(method);
  if (paced) await paceWrite({ token, kind: `fleet-write ${method}` }, paceDeps);
  let res;
  try {
    res = await fetchImpl(`${api}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    if (paced) releaseWriteLease(paceDeps.file);
    return { status: 0, json: null, detail: scrub(e?.message ?? 'fetch threw', [token]), call: `${method} ${path}` };
  }
  const rateRemaining = res.headers.get('x-ratelimit-remaining');
  let json = null;
  if (res.status !== 204) {
    try {
      json = await res.json();
    } catch {
      json = null;
    }
  }
  if (paced) {
    noteResponse(
      { token, status: res.status, headers: res.headers, body: json, verdict: classifyHttp({ status: res.status, rateRemaining: rateRemaining === null ? null : Number(rateRemaining) }) },
      paceDeps,
    );
  }
  return { status: res.status, json, detail: scrub(typeof json?.message === 'string' ? json.message : '', [token]), call: `${method} ${path}` };
}

/**
 * The node ids a GraphQL request needs, read before the mutation. Returns
 * `{ variables }`, or `{ fail: { call, status, result, why } }`; never throws.
 */
async function graphqlVariables(req, payload, api, t) {
  const g = req.graphql;
  const unread = (r, what) => ({ fail: { call: r.call, status: r.status, result: 'no node id', why: `${r.call} -> HTTP ${r.status}${r.detail ? ` (${r.detail})` : ''}: ${what} could not be read` } });
  if (g.pull !== undefined) {
    const pr = await rest(api, `/repos/${payload.repo}/pulls/${g.pull}`, {}, t);
    if (pr.status !== 200 || typeof pr.json?.node_id !== 'string') return unread(pr, "the pull's node id");
    return { variables: { id: pr.json.node_id } };
  }
  // transferIssue: the card on THIS repository — never a pull request, never one already moved — then the target.
  const issue = await rest(api, `/repos/${payload.repo}/issues/${g.issue}`, {}, t);
  if (issue.status !== 200 || typeof issue.json?.node_id !== 'string') return unread(issue, "the issue's node id");
  if (issue.json.pull_request) return { fail: { call: issue.call, status: issue.status, result: 'a pull request', why: `#${g.issue} on ${payload.repo} is a pull request — only an issue transfers` } };
  const at = repoOfIssue(issue.json);
  if (!at || at.toLowerCase() !== payload.repo.toLowerCase()) {
    const there = at ? `it answers from ${at}${Number.isInteger(issue.json.number) ? ` as #${issue.json.number}` : ''} — already transferred` : 'its repository could not be read';
    return { fail: { call: issue.call, status: issue.status, result: 'not on the source', why: `#${g.issue} no longer answers from ${payload.repo}: ${there}` } };
  }
  const target = await rest(api, `/repos/${g.target_repo}`, {}, t);
  if (target.status !== 200 || typeof target.json?.node_id !== 'string') return unread(target, `the target repository ${g.target_repo}'s node id`);
  return { variables: { issueId: issue.json.node_id, repositoryId: target.json.node_id } };
}

/**
 * A pull's file list, every page (header: "The governed-review follow-up"). Returns `{ files, pages }`, or
 * `{ fail: { status, why } }` for a page that did not answer 200 with an array, or a walk that would need
 * more than `GOVERNED_REVIEW_FILES_PAGE_CAP` pages — a truncated list is a SUBSET and can hide a governed hit,
 * so it is never read as "nothing governed". Never throws.
 */
async function readPullFiles(repo, pull, api, t) {
  const files = [];
  for (let page = 1; page <= GOVERNED_REVIEW_FILES_PAGE_CAP; page++) {
    const r = await rest(api, `/repos/${repo}/pulls/${pull}/files?per_page=${GOVERNED_REVIEW_FILES_PAGE_SIZE}&page=${page}`, {}, t);
    if (r.status !== 200 || !Array.isArray(r.json)) {
      return { fail: { status: r.status, why: `${r.call} -> HTTP ${r.status}${r.detail ? ` (${r.detail})` : ''}: the pull's file list could not be read, so its governed tier is unknown and no review was requested — read the pull on the board and request by hand if its diff touches a Tier H surface` } };
    }
    files.push(...r.json);
    if (r.json.length < GOVERNED_REVIEW_FILES_PAGE_SIZE) return { files, pages: page };
  }
  return { fail: { status: 200, why: `the file-list walk hit its ${GOVERNED_REVIEW_FILES_PAGE_CAP}-page cap with ${files.length} file(s) collected and more pending — a truncated list is a SUBSET that can hide a governed hit, so no review was requested; read the pull on the board and request by hand` } };
}

/**
 * The governed-review follow-up for ONE landed `governedReview` action (header): the reads, the plan, the writes
 * — one row per verdict and per write pushed onto `rows`. Returns `{ ok: true }` or `{ fail: why }`, the sentence
 * the caller records as the action's failure. Never throws on a status.
 */
async function requestGovernedReview({ index, op, pull, payload, api, t, log, rows }) {
  const repo = payload.repo;
  const token = t.token ?? '';
  const FILES = `GET /repos/${repo}/pulls/${pull}/files`;
  const failed = (call, status, why) => {
    const clean = scrub(why, [token]);
    rows.push({ action: index, op, call, status, result: `FAILED: ${clean}` });
    return { fail: clean };
  };
  const read = await readPullFiles(repo, pull, api, t);
  if (read.fail) return failed(FILES, read.fail.status, read.fail.why);
  const { paths, renames } = pullPathsFrom(read.files);
  let plan = governedReviewPlan({ paths, repo });
  const renamed = renames.length ? ` (${renames.length} rename(s): the old path counts too)` : '';
  if (plan.tier !== GOVERNED_TIER_H) {
    const text = governedReviewText(plan, { repo, files: read.files.length });
    rows.push({ action: index, op, call: FILES, status: 200, result: text });
    log(`  · action ${index} ${op}: ${text}${renamed}`);
    return { ok: true };
  }
  const pr = await rest(api, `/repos/${repo}/pulls/${pull}`, {}, t);
  if (pr.status !== 200 || !pr.json || typeof pr.json !== 'object') {
    return failed(pr.call, pr.status, `${pr.call} -> HTTP ${pr.status}${pr.detail ? ` (${pr.detail})` : ''}: the pull could not be re-read, so who is already requested, assigned or its author is unknown and no review was requested — its diff hits a Tier H surface; read it on the board and request by hand`);
  }
  const reviews = await rest(api, `/repos/${repo}/pulls/${pull}/reviews?per_page=100`, {}, t);
  if (reviews.status !== 200 || !Array.isArray(reviews.json)) {
    return failed(`GET /repos/${repo}/pulls/${pull}/reviews`, reviews.status, `${reviews.call} -> HTTP ${reviews.status}${reviews.detail ? ` (${reviews.detail})` : ''}: the pull's reviews could not be read, so who has already reviewed is unknown and no review was requested — its diff hits a Tier H surface; read it on the board and request by hand`);
  }
  plan = governedReviewPlan({ paths, repo, author: pr.json.user?.login ?? null, requested: reviewerLogins(pr.json), assigned: assigneeLogins(pr.json), reviewed: reviewedLogins(reviews.json) });
  const verdict = governedReviewText(plan, { repo, files: read.files.length });
  rows.push({ action: index, op, call: FILES, status: 200, result: verdict });
  log(`  · action ${index} ${op}: ${verdict}${renamed}`);
  for (const req of governedReviewRequests(repo, pull, { reviewers: plan.toRequest, assignees: plan.toAssign })) {
    const r = await rest(api, req.path, { method: req.verb, body: req.body }, t);
    const landed = requestLanded(req, r);
    if (!landed.ok) return failed(r.call, r.status, landed.why);
    const result = scrub(resultOf(req, r.json, r.status), [token]);
    rows.push({ action: index, op, call: r.call, status: r.status, result });
    log(`  ✓ action ${index} ${op}: ${r.call} -> HTTP ${r.status} · ${result}`);
  }
  return { ok: true };
}

/**
 * The run. Returns `{ exit, rows, summary, lines, annotations }` — `annotations`
 * the notes this run emitted, in order; never throws on a status.
 *
 * @param {{ payload: unknown, sender: string, token: string, api?: string }} input
 * @param {{ fetch?: Function, pace?: object, log?: Function }} [deps]
 */
export async function executeFleetWrite({ payload: raw, sender, token, api = DEFAULT_API } = {}, deps = {}) {
  const lines = [];
  const log = (line) => {
    lines.push(line);
    (deps.log ?? ((l) => console.log(l)))(line);
  };
  const t = { fetch: deps.fetch, token, pace: deps.pace };
  const ub = { sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))), now: deps.now ?? (() => Date.now()), ...(deps.updateBranch ?? {}) };
  const rr = { sleep: ub.sleep, now: ub.now, ...(deps.rerunFailed ?? {}) };
  const si = { sleep: ub.sleep, now: ub.now, ...(deps.subIssue ?? {}) };

  const judged = validatePayload(raw);
  if (!judged.ok) {
    log(refusalText(judged.errors));
    return { exit: EXIT_REFUSED, rows: [], summary: summaryText({ payload: raw && typeof raw === 'object' ? raw : null, sender, rows: [], refusal: `payload refused (${judged.errors.length} problem(s))` }), lines };
  }
  const payload = judged.payload;
  // Rule ⑤ on the runner (header): a stroke whose batch pacing the job cannot hold is refused before any request.
  const pacing = strokePacing(payload);
  if (!pacing.fits) {
    log(refusalText([strokeBudgetRefusal(pacing)]));
    return { exit: EXIT_REFUSED, rows: [], summary: summaryText({ payload, sender, rows: [], refusal: `the stroke's rule ⑤ pacing (${fmtDuration(pacing.pacingMs)}) is over the relay job's budget (${fmtDuration(pacing.budgetMs)})` }), lines, pacing };
  }
  if (!token) {
    log('fleet-write/execute: PREREQUISITE NOT MET — no GITHUB_TOKEN in the environment (the workflow passes the minted App token through it). ⛔ zero writes.');
    return { exit: EXIT_PREREQUISITE, rows: [], summary: summaryText({ payload, sender, rows: [], refusal: 'no token' }), lines };
  }
  if (typeof sender !== 'string' || !sender.trim()) {
    log(`fleet-write/execute: PREREQUISITE NOT MET — no ${SENDER_ENV} (the workflow passes github.event.sender.login through it). ⛔ zero writes.`);
    return { exit: EXIT_PREREQUISITE, rows: [], summary: summaryText({ payload, sender, rows: [], refusal: 'no sender' }), lines };
  }

  // ── the sender gate — on EVERY repository the token reaches ───────────────
  const reaches = tokenRepositoriesOf(payload);
  const roles = [];
  for (const repo of reaches) {
    const permPath = `/repos/${repo}/collaborators/${encodeURIComponent(sender)}/permission`;
    const perm = await rest(api, permPath, {}, t);
    const gate = senderVerdict(perm);
    if (gate.verdict === 'prerequisite') {
      log(`fleet-write/execute: PREREQUISITE NOT MET — ${perm.call} -> HTTP ${perm.status}${perm.detail ? ` (${perm.detail})` : ''}; the sender's permission on ${repo} could not be read. ⛔ zero writes.`);
      return { exit: EXIT_PREREQUISITE, rows: [], summary: summaryText({ payload, sender, rows: [], reaches, refusal: `the permission read on ${repo} answered HTTP ${perm.status}` }), lines };
    }
    if (gate.verdict === 'refused') {
      log(`fleet-write/execute: SENDER REFUSED — \`${sender}\` is ${gate.role} on ${repo}; the relay writes only for a sender with write, maintain or admin on every repository the stroke reaches. ⛔ zero writes.`);
      return { exit: EXIT_SENDER_REFUSED, rows: [], summary: summaryText({ payload, sender, role: gate.role, rows: [], reaches, refusal: `sender \`${sender}\` is ${gate.role} on ${repo === payload.repo ? 'the target' : repo}` }), lines };
    }
    roles.push({ repo, role: gate.role });
  }
  const role = roles.length === 1 ? roles[0].role : roles.map((r) => `${r.role} on ${r.repo}`).join(', ');
  log(`fleet-write/execute: request ${payload.request_id} · sender ${sender} (${role}) · session ${payload.session} · target ${payload.repo}${reaches.length > 1 ? ` · the token also reaches ${reaches.slice(1).join(', ')}` : ''} · ${payload.actions.length} action(s)`);

  // ── rule ⑤ on the runner — announced before the first write (header) ──────
  if (pacing.batched) {
    const pace = t.pace ?? {};
    try {
      announceBatch({ token, count: pacing.batchWrites, kind: BATCH_KIND }, pace);
    } catch (e) {
      // Unpaced is the state the throttle exists to prevent: refused before the first write, as `paceWrite` refuses an unrecordable one.
      log(scrub(unrecordableText(pace.file ?? paceFilePath(pace.env ?? process.env, pace.home), e), [token]));
      return { exit: EXIT_WRITE_PACE_REFUSED, rows: [], summary: summaryText({ payload, sender, role, rows: [], reaches, refusal: 'the rule ⑤ batch could not be recorded in the pace log' }), lines, role, pacing };
    }
    log(`fleet-write/execute: ${batchAnnouncedText(pacing)}.`);
  }

  // ── the actions, in order ─────────────────────────────────────────────────
  const rows = [];
  const annotations = [];
  let stoppedAt = null;
  for (let i = 0; i < payload.actions.length && stoppedAt === null; i++) {
    const action = payload.actions[i];
    const requests = OPS[action.op].requests(action, payload.repo);
    let opener = null;
    for (const spelled of requests) {
      // A leg that reads an earlier answer (header) is filled from the action's FIRST answer — the create's — or NOT SENT.
      const filled = spelled.fromAnswer === undefined ? { req: spelled } : fillFromAnswer(spelled, opener);
      if (filled.fail) {
        const why = scrub(filled.fail, [token]);
        rows.push({ action: i + 1, op: action.op, call: `${spelled.verb} ${spelled.path}`, status: 'not sent', result: `FAILED: ${why}` });
        stoppedAt = { action: i + 1, op: action.op, why };
        log(`  ✗ action ${i + 1} ${action.op}: ${why}`);
        break;
      }
      const req = filled.req;
      // The failed-jobs re-run (header): its fences on the run and its pull, judged HERE on the reads before the POST — refused, NOT SENT.
      const pre = req.rerunFailed ? await rerunFailedPreflight(req, payload, api, t) : null;
      if (pre?.fail) {
        const why = scrub(pre.fail, [token]);
        rows.push({ action: i + 1, op: action.op, call: `${req.verb} ${req.path}`, status: 'not sent', result: `FAILED: ${why}` });
        stoppedAt = { action: i + 1, op: action.op, why };
        log(`  ✗ action ${i + 1} ${action.op}: ${why}`);
        break;
      }
      // The hierarchy link (header): its fences on the two cards, judged HERE on the reads before the write — refused, NOT SENT.
      const sub = req.subIssue ? await subIssuePreflight(req, payload, api, t) : null;
      if (sub?.fail) {
        const why = scrub(sub.fail, [token]);
        rows.push({ action: i + 1, op: action.op, call: `${req.verb} ${req.path}`, status: 'not sent', result: `FAILED: ${why}` });
        stoppedAt = { action: i + 1, op: action.op, why };
        log(`  ✗ action ${i + 1} ${action.op}: ${why}`);
        break;
      }
      if (sub?.already) {
        // The measured no-op: the child already answers to this parent, so nothing is sent — landed only on the list's read-back.
        const noop = await confirmSubIssue(req, null, sub, payload, api, t, si);
        const call = `${req.verb} ${req.path}`;
        rows.push({ action: i + 1, op: action.op, call, status: 'not sent', result: noop.ok ? scrub(noop.result, [token]) : `FAILED: ${scrub(noop.why, [token])}` });
        if (!noop.ok) {
          stoppedAt = { action: i + 1, op: action.op, why: scrub(noop.why, [token]) };
          log(`  ✗ action ${i + 1} ${action.op}: ${call} -> ${stoppedAt.why}`);
          break;
        }
        log(`  ✓ action ${i + 1} ${action.op}: ${call} -> not sent · ${rows[rows.length - 1].result}`);
        continue;
      }
      // The body is the child's id from its own answer — the op table spells none for this row.
      let body = sub ? { sub_issue_id: sub.childId } : (req.body ?? null);
      if (req.graphql) {
        const resolved = await graphqlVariables(req, payload, api, t);
        if (resolved.fail) {
          const why = scrub(resolved.fail.why, [token]);
          rows.push({ action: i + 1, op: action.op, call: resolved.fail.call, status: resolved.fail.status, result: resolved.fail.result });
          stoppedAt = { action: i + 1, op: action.op, why };
          log(`  ✗ action ${i + 1} ${action.op}: ${why}`);
          break;
        }
        body = { query: req.graphql.query, variables: resolved.variables };
      }
      // The GraphQL leg is spelled with its literal verb: every mutation is a POST to one path.
      const r = req.graphql ? await rest(api, '/graphql', { method: 'POST', body }, t) : await rest(api, req.path, { method: req.verb, body }, t);
      if (opener === null) opener = r;
      // The base sync is confirmed by MEASURE (header): the head polled off the expected sha, or a 422 judged by the compare.
      // The failed-jobs re-run is confirmed by reading the run back (header): attempt 2, its failed jobs queued or in progress.
      // The hierarchy link is confirmed by reading the parent's list back (header): the child's id listed, or no longer.
      const landed = req.updateBranch
        ? await confirmUpdateBranch(req, r, payload, api, t, ub)
        : req.rerunFailed
          ? await confirmRerunFailed(req, r, pre, payload, api, t, rr)
          : sub
            ? await confirmSubIssue(req, r, sub, payload, api, t, si)
            : requestLanded(req, r);
      const call = req.graphql ? `POST /graphql ${req.graphql.mutation}` : r.call;
      rows.push({ action: i + 1, op: action.op, call, status: r.status, result: landed.ok ? (landed.idempotent ? 'already absent (idempotent)' : scrub(landed.result ?? resultOf(req, r.json, r.status), [token])) : `FAILED: ${scrub(landed.why, [token])}` });
      if (!landed.ok) {
        stoppedAt = { action: i + 1, op: action.op, why: scrub(landed.why, [token]) };
        log(`  ✗ action ${i + 1} ${action.op}: ${call} -> ${stoppedAt.why}`);
        break;
      }
      log(`  ✓ action ${i + 1} ${action.op}: ${call} -> HTTP ${r.status} · ${rows[rows.length - 1].result}`);
      // A landed op that creates or moves a card reports its number where a seat CAN read it (header).
      const { note, why } = annotationFor({ action: i + 1, op: action.op, req, json: r.json, payload });
      if (note) {
        annotations.push(note);
        log(annotationCommand(note));
      } else if (why) {
        log(`  ⚠ action ${i + 1} ${action.op}: no annotation — ${scrub(why, [token])}; a seat reading this run finds the card on the board instead.`);
      }
    }
    // The governed-review follow-up (header): after the row's own requests landed, at the pull the action names
    // (`pr_ready`); a row without `pull` would fall back to the opener's ANSWERED number — never one the request
    // named — and no such row carries `governedReview` today: the draft open summons nobody.
    if (stoppedAt === null && GOVERNED_REVIEW_OPS.includes(action.op)) {
      const pull = Number.isInteger(action.pull) ? action.pull : opener?.json?.number;
      let followed;
      if (!Number.isInteger(pull) || pull < 1) {
        const why = `${opener?.call ?? 'the create'} answered HTTP ${opener?.status ?? '?'} without a positive integer number, so the governed-review follow-up could not run — read the pull on the board and request by hand if its diff touches a Tier H surface`;
        rows.push({ action: i + 1, op: action.op, call: 'GET …/pulls/{number}/files', status: 'not sent', result: `FAILED: ${scrub(why, [token])}` });
        followed = { fail: why };
      } else {
        followed = await requestGovernedReview({ index: i + 1, op: action.op, pull, payload, api, t, log, rows });
      }
      if (followed.fail) {
        stoppedAt = { action: i + 1, op: action.op, why: scrub(followed.fail, [token]) };
        log(`  ✗ action ${i + 1} ${action.op}: ${stoppedAt.why}`);
      }
    }
  }
  const notAttempted = stoppedAt ? payload.actions.length - stoppedAt.action : 0;
  const failedAction = stoppedAt ? payload.actions[stoppedAt.action - 1] : null;
  const remedy = failedAction && OPS[failedAction.op].secondRepo ? transferRemedy(payload.repo, failedAction[OPS[failedAction.op].secondRepo]) : null;
  const summary = summaryText({ payload, sender, role, rows, stoppedAt, notAttempted, remedy, reaches, pacing });
  if (stoppedAt) log(`fleet-write/execute: ✗ stopped at action ${stoppedAt.action} (${stoppedAt.op}); ${notAttempted} later action(s) NOT attempted. The board holds what the rows above say landed.`);
  else log(`fleet-write/execute: ✓ ${rows.length} request(s) landed, every action done.`);
  if (remedy) log(`fleet-write/execute: remedy — ${remedy}`);
  return { exit: stoppedAt ? EXIT_ACTION_FAILED : EXIT_OK, rows, summary, lines, role, annotations, pacing };
}

// ---------------------------------------------------------------------------
// Self-test — offline: a fake platform, an injected throttle, no network.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the sender gate: write, maintain and admin pass; read, triage, none and a stranger are refused with zero writes': 9,
  'the requests: every op becomes the endpoint, verb and body the table declares, with the App token': 7,
  'the run: actions in order, stop at the first failure, later actions never attempted': 6,
  'the idempotent removal: a 404 on a directed label DELETE is success': 2,
  'the GraphQL ops: the node id first, then the mutation; an errors array is a failure': 5,
  'the PR-state landing: a 200 lands only when the answer SHOWS the state the op asked for — armed or queued for auto-merge, off for its disable, ready and draft for the flips': 12,
  "the base sync: the PUT carries the expected head; a 202 is confirmed by polling the head off that sha inside the window and reading the merge commit's author; a 422 is a no-op only when the compare measures the head not behind its base; a moved head, a head still behind, an unreadable measure or an expired window is FAILED with nothing after it attempted": 10,
  "the assignees and labels legs: pr_create with assignees is the create, then ONE POST to the created pull's issue-assignees endpoint at the number the create ANSWERED — never the request; the answer must list every login sent; no assignees, no second request; an answer without a number stops the stroke with the leg not sent; with labels, ONE POST to the issue-labels endpoint at that same number — the create's, never the assignee answer's — whose answer must list every name sent": 19,
  'the summary: request, sender and role, session, target, one row per request': 5,
  'redaction: the token reaches no summary line, log line or error': 3,
  'the wiring: both halves around every write verb, on the roster': 4,
  'the CLI: environment inputs, the payload refusal, the exit ladder': 7,
  "the annotations: ONE notice per landed op that creates or moves a card — op, number and url read from the platform's answer, never the request; none for any other op, a failed request or an answer that cannot be reported; the reader's own parser reads back exactly what was emitted": 12,
  'the transfer: the sender gated on BOTH repositories, both node ids first, a pull or a moved card refused before the mutation, landing only on the target, the remedy on failure': 11,
  'the workflow_dispatch: ONE POST to the dispatch endpoint of the allowlisted file with { ref: main } under the App token, a bodiless 204 lands as accepted, a 422 or 403 is a failed action, no other actions/* request leaves, no annotation': 7,
  'the release.yml refresh: ONE POST to its dispatch endpoint carrying { ref: main, inputs: { refresh_version_pr: "true" } } under the App token, landing as accepted; force, false, absent, a string or any other input refused with ZERO requests, exit 2': 9,
  "the batch gap on the runner: a stroke carrying DEFAULT_BATCH_THRESHOLD or more content-creating actions is announced as ONE rule ⑤ batch before its first write — on an injected clock every write through the last content-creating one leaves a full DEFAULT_BATCH_GAP_MS after the one before, and the pacing is exactly what the seat budgets; below the threshold, after the batch and on a landing stroke rule ①'s gap; a stroke the job cannot hold refused with ZERO requests; an announcement the log cannot record refused before the first write": 10,
  // 29 → 30 as the follow-up left the draft open: three pr_create NEGATIVE pins (no read, no request, no assignee) replace the create-side runs.
  "the governed-review follow-up: after pr_ready alone — a pr_create summons NOBODY and never reads the pull's files, because a human is asked only at the seat's hand-off (pr_request_reviewers after ACCEPT + a same-head PASS); after pr_ready the pull's file list is read in full, a Tier H hit requests review from every GOVERNED_APPROVERS account not already requested, assigned or reviewed — the pull's own author assigned instead, never requested; a Tier S or ungoverned diff sends nothing and says so; an unreadable or truncated list, an unreadable pull or review list, or a refused write is a FAILED action": 30,
  // 17 → 21 with the head fence: a stale head, the embedded copy never trusted, a run naming no pull, a pull unread.
  "the run_rerun_failed: the five fences judged HERE on the run and its pull, read immediately before ONE bodiless POST — the pull's current head by its own GET, never the run's embedded copy, and a run naming no pull refused by name; each refused with the POST not sent and accepted on the measured run; a run, pull, baseline or fence that fails is zero writes; the 201 confirmed only by reading attempt 2 back with its failed jobs queued or in progress, naming their job ids; attempt 2 never seen, a failed job completed, or a job list unread is FAILED; no annotation": 21,
  "the hierarchy link: sub_issue_add and sub_issue_remove read the parent's and the child's own answers, then the child's parent (add) or the parent's whole list (remove), immediately before ONE write whose body is the child's REST id from its own answer — never its number, never replace_parent; a pull, a transferred or unread card, a child under another parent, one the parent does not list, or a read that is neither answer is zero writes; a child already under this parent is a no-op landed on the list; the answer confirmed only when the parent's list reads the child back (or no longer does) inside the window; a refused write, a list that never settles or never reads whole is FAILED; no annotation, and the rows ride a stroke beside other ops": 20,
});
// Raised 17 → 18 with the governed-review follow-up battery, 18 → 19 with the run_rerun_failed battery, 19 → 20 with the
// hierarchy link battery: one battery, one row.
const SELF_TEST_BATTERY_FLOOR = 20;
const UNATTRIBUTED_BATTERY = '(unattributed)';

const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};
let selfTestReachedVerdict = false;

export async function selfTest() {
  const cases = [];
  const t = (name, actual, expected = true, detail) => {
    const bucket = openBattery ?? UNATTRIBUTED_BATTERY;
    batteryCases.set(bucket, (batteryCases.get(bucket) ?? 0) + 1);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, detail: ok ? '' : `${detail ? `${detail} — ` : ''}got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
  };
  const { mkdtempSync, rmSync, existsSync, readFileSync: readReal, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');

  const TOKEN = 'ghs_FixtureTokenNotRealAtAll0000000000000';
  const REPO = 'objectstack-ai/objectstack';
  const base = (actions) => ({ request_id: 'fw-test-1', repo: REPO, session: 'session_01ABCDEFGHJKMNPQRSTVWXYZ', actions });
  const PERM = `GET /repos/${REPO}/collaborators/os-support-ai/permission`;
  const allowed = { [PERM]: { status: 200, json: { permission: 'write', role_name: 'write', user: { login: 'os-support-ai' } } } };

  const dir = mkdtempSync(join(tmpdir(), 'fleet-write-execute-'));
  try {
    let paceCase = 0;
    const paceFor = (file) => ({
      file,
      env: { OS_PM_WRITE_MIN_GAP_MS: '0' },
      log: () => {},
      exit: (code) => {
        throw Object.assign(new Error(`throttle refused with exit ${code}`), { throttleExit: code });
      },
    });
    // An answer may be a LIST, served in order with the last entry repeating, so a poll can watch the platform change between reads.
    const platform = (answers, seen) => {
      const served = new Map();
      return async (url, init) => {
        const u = new URL(url);
        const call = `${init?.method ?? 'GET'} ${u.pathname}`;
        seen.push({ call, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.authorization ?? '' });
        const declared = answers[call];
        const nth = served.get(call) ?? 0;
        served.set(call, nth + 1);
        const a = (Array.isArray(declared) ? declared[Math.min(nth, declared.length - 1)] : declared) ?? { status: 404, json: { message: 'Not Found' } };
        if (a.throws) throw new Error(a.throws);
        return { status: a.status, headers: new Headers({ 'x-ratelimit-remaining': '4999', ...(a.headers ?? {}) }), json: async () => a.json };
      };
    };
    const paceFile = join(dir, 'pace-shared.jsonl');
    const run = async (payload, answers, { sender = 'os-support-ai', token = TOKEN, file, ...extra } = {}) => {
      const seen = [];
      const logs = [];
      const pace = paceFor(file ?? join(dir, `pace-${paceCase++}.jsonl`));
      try {
        const r = await executeFleetWrite({ payload, sender, token }, { fetch: platform(answers, seen), pace, log: (l) => logs.push(l), ...extra });
        return { ...r, seen, logs, pace };
      } catch (e) {
        if (e?.throttleExit === undefined) throw e;
        return { exit: e.throttleExit, rows: [], summary: '', lines: [], seen, logs, pace, throttled: true };
      }
    };
    const writes = (seen) => seen.filter((s) => !s.call.startsWith('GET '));

    // ── the sender gate ─────────────────────────────────────────────────────
    battery('the sender gate: write, maintain and admin pass; read, triage, none and a stranger are refused with zero writes');
    {
      t('permission write is allowed', senderVerdict({ status: 200, json: { permission: 'write', role_name: 'write' } }).verdict, 'allowed');
      t('maintain (folded into permission write) is allowed, and the exact role is read', senderVerdict({ status: 200, json: { permission: 'write', role_name: 'maintain' } }), { verdict: 'allowed', role: 'maintain', permission: 'write', roleName: 'maintain' });
      t('admin is allowed', senderVerdict({ status: 200, json: { permission: 'admin', role_name: 'admin' } }).verdict, 'allowed');
      t('read is refused', senderVerdict({ status: 200, json: { permission: 'read', role_name: 'read' } }).verdict, 'refused');
      t('triage (folded into read) is refused', senderVerdict({ status: 200, json: { permission: 'read', role_name: 'triage' } }).verdict, 'refused');
      t('none is refused', senderVerdict({ status: 200, json: { permission: 'none', role_name: 'none' } }).verdict, 'refused');
      t('a 404 — not a collaborator — is refused', senderVerdict({ status: 404, json: { message: 'Not Found' } }).verdict, 'refused');
      const refused = await run(base([{ op: 'comment', issue: 1, body: 'x' }]), { [PERM]: { status: 200, json: { permission: 'read', role_name: 'triage' } }, [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 5 } } });
      t('a refused sender is exit 4 with ZERO writes and the role named', [refused.exit, writes(refused.seen).length, refused.logs.some((l) => l.includes('triage'))], [EXIT_SENDER_REFUSED, 0, true]);
      const unreadable = await run(base([{ op: 'comment', issue: 1, body: 'x' }]), { [PERM]: { status: 503, json: { message: 'down' } } });
      t('a permission read that does not answer is exit 3, zero writes — never a pass', [unreadable.exit, writes(unreadable.seen).length], [EXIT_PREREQUISITE, 0]);
    }

    // ── the requests ────────────────────────────────────────────────────────
    battery('the requests: every op becomes the endpoint, verb and body the table declares, with the App token');
    {
      const comment = await run(base([{ op: 'comment', issue: 19701, body: 'Hello' }]), { ...allowed, [`POST /repos/${REPO}/issues/19701/comments`]: { status: 201, json: { id: 77, html_url: 'https://github.test/c/77' } } }, { file: paceFile });
      t('comment: POST …/issues/{n}/comments with the body, exit 0', [comment.exit, comment.seen[1].call, comment.seen[1].body], [EXIT_OK, `POST /repos/${REPO}/issues/19701/comments`, { body: 'Hello' }]);
      t('…with the App token as the bearer, on the permission read and the write alike', comment.seen.map((s) => s.auth), [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
      t('…and the row carries the id and url', comment.rows[0].result, 'id 77 https://github.test/c/77');
      const labels = await run(base([{ op: 'labels_add', issue: 2, labels: ['a', 'b'] }, { op: 'assign', issue: 2, assignees: ['u'] }, { op: 'issue_patch', issue: 2, state: 'closed', state_reason: 'not_planned' }]), {
        ...allowed,
        [`POST /repos/${REPO}/issues/2/labels`]: { status: 200, json: [{ name: 'a' }, { name: 'b' }] },
        [`POST /repos/${REPO}/issues/2/assignees`]: { status: 201, json: { number: 2 } },
        [`PATCH /repos/${REPO}/issues/2`]: { status: 200, json: { number: 2, html_url: 'https://github.test/i/2' } },
      }, { file: paceFile });
      t('labels_add, assign and issue_patch become their verbs and bodies, in order', writes(labels.seen).map((s) => [s.call, s.body]), [
        [`POST /repos/${REPO}/issues/2/labels`, { labels: ['a', 'b'] }],
        [`POST /repos/${REPO}/issues/2/assignees`, { assignees: ['u'] }],
        [`PATCH /repos/${REPO}/issues/2`, { state: 'closed', state_reason: 'not_planned' }],
      ]);
      const pr = await run(base([{ op: 'pr_create', title: 'T', head: 'h', base: 'main' }, { op: 'issue_create', title: 'I', body: 'B', labels: ['l'] }]), {
        ...allowed,
        [`POST /repos/${REPO}/pulls`]: { status: 201, json: { number: 9, html_url: 'https://github.test/p/9' } },
        // ⛔ No governed-review follow-up after a create (its own battery below): the pull's files are never read here.
        [`POST /repos/${REPO}/issues`]: { status: 201, json: { number: 10, html_url: 'https://github.test/i/10' } },
      }, { file: paceFile });
      t('pr_create sends draft: true whatever was asked', writes(pr.seen)[0].body, { title: 'T', head: 'h', base: 'main', draft: true });
      t('issue_create sends title, body and the optional lists it was given', writes(pr.seen)[1].body, { title: 'I', body: 'B', labels: ['l'] });
      t('…and the rows carry the numbers — and nothing between them: a create owes no governed-review row', pr.rows.map((r) => r.result), ['#9 https://github.test/p/9', '#10 https://github.test/i/10']);
    }

    // ── the run ─────────────────────────────────────────────────────────────
    battery('the run: actions in order, stop at the first failure, later actions never attempted');
    {
      const three = base([{ op: 'comment', issue: 1, body: 'a' }, { op: 'labels_add', issue: 1, labels: ['x'] }, { op: 'comment', issue: 1, body: 'c' }]);
      const stopped = await run(three, { ...allowed, [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1 } }, [`POST /repos/${REPO}/issues/1/labels`]: { status: 403, json: { message: 'Resource not accessible by integration' } } });
      t('the first failure is exit 5', stopped.exit, EXIT_ACTION_FAILED);
      t('…the actions before it landed, the failing one is recorded with the platform\'s sentence', stopped.rows.map((r) => [r.action, r.status]), [[1, 201], [2, 403]]);
      t('…and the action after it was NEVER attempted', writes(stopped.seen).length, 2);
      t('…which the summary says in numbers', stopped.summary.includes('stopped at action 2 (`labels_add`)') && stopped.summary.includes('1 later action(s) NOT attempted'));
      const down = await run(three, { ...allowed, [`POST /repos/${REPO}/issues/1/comments`]: { throws: 'ECONNRESET' } });
      t('an unreachable platform on a write is a failed action (status 0), and the lease was released', [down.exit, down.rows[0].status, existsSync(`${down.pace.file}.lease`)], [EXIT_ACTION_FAILED, 0, false]);
      const marker = await run(three, { ...allowed, [`POST /repos/${REPO}/issues/1/comments`]: { status: 403, headers: { 'x-ratelimit-remaining': '0' }, json: { message: 'API rate limit exceeded' } } });
      const after = await run(three, { ...allowed, [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1 } } }, { file: marker.pace.file });
      t('a rate-limit refusal writes the stop marker, and the NEXT write on that log is refused before it leaves (exit 10)', [marker.exit, after.exit, after.throttled, writes(after.seen).length], [EXIT_ACTION_FAILED, EXIT_WRITE_PACE_REFUSED, true, 0]);
    }

    // ── the idempotent removal ──────────────────────────────────────────────
    battery('the idempotent removal: a 404 on a directed label DELETE is success');
    {
      const gone = await run(base([{ op: 'labels_remove', issue: 4, labels: ['gone', 'there'] }, { op: 'comment', issue: 4, body: 'after' }]), {
        ...allowed,
        [`DELETE /repos/${REPO}/issues/4/labels/gone`]: { status: 404, json: { message: 'Label does not exist' } },
        [`DELETE /repos/${REPO}/issues/4/labels/there`]: { status: 200, json: [] },
        [`POST /repos/${REPO}/issues/4/comments`]: { status: 201, json: { id: 3 } },
      }, { file: paceFile });
      t('a 404 on a directed DELETE is idempotent success and the run continues', [gone.exit, gone.rows.map((r) => r.result)], [EXIT_OK, ['already absent (idempotent)', '0 label(s) now on the issue', 'id 3']]);
      t('…but a 404 anywhere else is a failure', requestLanded({ verb: 'POST', path: '/x' }, { status: 404, json: { message: 'Not Found' } }).ok, false);
    }

    // ── the GraphQL ops ─────────────────────────────────────────────────────
    battery('the GraphQL ops: the node id first, then the mutation; an errors array is a failure');
    {
      const ready = await run(base([{ op: 'pr_ready', pull: 12 }]), {
        ...allowed,
        [`GET /repos/${REPO}/pulls/12`]: { status: 200, json: { number: 12, node_id: 'PR_kwDO' } },
        'POST /graphql': { status: 200, json: { data: { markPullRequestReadyForReview: { pullRequest: { number: 12, isDraft: false } } } } },
        // The governed-review follow-up reads the readied pull's files (its own battery below); an empty list is an ungoverned diff.
        [`GET /repos/${REPO}/pulls/12/files`]: { status: 200, json: [] },
      }, { file: paceFile });
      t('pr_ready reads the node id, then POSTs the mutation with it — then the governed-review follow-up reads the files', [ready.exit, ready.seen.map((s) => s.call), ready.seen[2].body.variables], [EXIT_OK, [PERM, `GET /repos/${REPO}/pulls/12`, 'POST /graphql', `GET /repos/${REPO}/pulls/12/files`], { id: 'PR_kwDO' }]);
      t('…the query names the mutation and the row reads the answer', [ready.seen[2].body.query.includes('markPullRequestReadyForReview'), ready.rows[0].result], [true, '#12 · ready']);
      const merge = await run(base([{ op: 'automerge_enable', pull: 12 }]), {
        ...allowed,
        [`GET /repos/${REPO}/pulls/12`]: { status: 200, json: { number: 12, node_id: 'PR_kwDO' } },
        'POST /graphql': { status: 200, json: { data: { enablePullRequestAutoMerge: { pullRequest: { number: 12, autoMergeRequest: { enabledAt: 'now', mergeMethod: 'SQUASH' } } } } } },
      }, { file: paceFile });
      t('automerge_enable arms SQUASH and the row says so', [merge.exit, merge.seen[2].body.query.includes('mergeMethod: SQUASH'), merge.rows[0].result], [EXIT_OK, true, '#12 · auto-merge SQUASH']);
      const errored = await run(base([{ op: 'pr_draft', pull: 12 }]), {
        ...allowed,
        [`GET /repos/${REPO}/pulls/12`]: { status: 200, json: { number: 12, node_id: 'PR_kwDO' } },
        'POST /graphql': { status: 200, json: { data: null, errors: [{ message: 'Pull request is already a draft' }] } },
      });
      t('a 200 carrying an errors array is a FAILED action naming the message', [errored.exit, errored.rows[0].result.includes('already a draft')], [EXIT_ACTION_FAILED, true]);
      const noNode = await run(base([{ op: 'pr_ready', pull: 13 }]), { ...allowed, [`GET /repos/${REPO}/pulls/13`]: { status: 404, json: { message: 'Not Found' } } });
      t('a pull whose node id cannot be read is a failed action with no mutation sent', [noNode.exit, noNode.seen.some((s) => s.call === 'POST /graphql')], [EXIT_ACTION_FAILED, false]);
    }

    // ── the PR-state landing ────────────────────────────────────────────────
    battery('the PR-state landing: a 200 lands only when the answer SHOWS the state the op asked for — armed or queued for auto-merge, off for its disable, ready and draft for the flips');
    {
      const pull = { [`GET /repos/${REPO}/pulls/21`]: { status: 200, json: { number: 21, node_id: 'PR_kwDO21' } } };
      const answer = (mutation, pr) => ({ ...allowed, ...pull, 'POST /graphql': { status: 200, json: { data: { [mutation]: { pullRequest: { number: 21, ...pr } } } } } });
      const enable = (pr, actions = [{ op: 'automerge_enable', pull: 21 }]) => run(base(actions), answer('enablePullRequestAutoMerge', pr), { file: paceFile });

      // The shape the card measured: 200, no errors, nothing armed, nothing queued — and a later action behind it.
      const unarmed = await run(base([{ op: 'automerge_enable', pull: 21 }, { op: 'comment', issue: 21, body: 'after' }]), {
        ...answer('enablePullRequestAutoMerge', { autoMergeRequest: null, isInMergeQueue: false, isMergeQueueEnabled: false }),
        [`POST /repos/${REPO}/issues/21/comments`]: { status: 201, json: { id: 9 } },
      });
      t('⛔ automerge_enable answered 200 with no errors, no autoMergeRequest and the pull not queued is a FAILED action (exit 5)', [unarmed.exit, unarmed.rows[0]?.status], [EXIT_ACTION_FAILED, 200]);
      t('…whose row names what the answer showed and what was asked for', [unarmed.rows[0]?.result.startsWith('FAILED'), ['auto-merge off', 'not in the merge queue', 'its base has no merge queue', 'auto-merge armed'].every((s) => unarmed.rows[0]?.result.includes(s))], [true, true], unarmed.rows[0]?.result);
      t('…and the stroke stops there: the later action is never attempted, and the summary says so', [writes(unarmed.seen).map((s) => s.call), unarmed.summary.includes('stopped at action 1 (`automerge_enable`)')], [['POST /graphql'], true]);

      const armed = await enable({ autoMergeRequest: { enabledAt: 'now', mergeMethod: 'SQUASH' }, isInMergeQueue: false, isMergeQueueEnabled: false });
      t('the happy path still lands: armed on a base with no merge queue', [armed.exit, armed.rows[0]?.result], [EXIT_OK, '#21 · auto-merge SQUASH · not in the merge queue · its base has no merge queue']);
      // Measured on this repository's queue: a pull whose checks are green is enqueued at once and the answer carries no autoMergeRequest.
      const queued = await enable({ autoMergeRequest: null, isInMergeQueue: true, isMergeQueueEnabled: true });
      t('a green pull enqueued at once on a merge-queue base lands, though the answer carries no autoMergeRequest', [queued.exit, queued.rows[0]?.result], [EXIT_OK, '#21 · auto-merge off · in the merge queue · its base has a merge queue']);
      const queueArmed = await enable({ autoMergeRequest: { enabledAt: 'now', mergeMethod: 'MERGE' }, isInMergeQueue: false, isMergeQueueEnabled: true });
      t('⛔ the merge method is never judged: a merge-queue base answers MERGE for a SQUASH request, and that arm lands', [queueArmed.exit, queueArmed.rows[0]?.result], [EXIT_OK, '#21 · auto-merge MERGE · not in the merge queue · its base has a merge queue']);

      const stillArmed = await run(base([{ op: 'automerge_disable', pull: 21 }]), answer('disablePullRequestAutoMerge', { autoMergeRequest: { enabledAt: 'then' }, isInMergeQueue: false, isMergeQueueEnabled: true }));
      t('automerge_disable whose answer still carries an autoMergeRequest is a FAILED action', [stillArmed.exit, stillArmed.rows[0]?.result.includes('auto-merge off (autoMergeRequest null)')], [EXIT_ACTION_FAILED, true], stillArmed.rows[0]?.result);
      const disarmedQueued = await run(base([{ op: 'automerge_disable', pull: 21 }]), answer('disablePullRequestAutoMerge', { autoMergeRequest: null, isInMergeQueue: true, isMergeQueueEnabled: true }), { file: paceFile });
      t('automerge_disable lands on auto-merge off even for a queued pull — the row says it is still in the merge queue', [disarmedQueued.exit, disarmedQueued.rows[0]?.result], [EXIT_OK, '#21 · auto-merge off · in the merge queue · its base has a merge queue']);

      const stillDraft = await run(base([{ op: 'pr_ready', pull: 21 }]), answer('markPullRequestReadyForReview', { isDraft: true }));
      const stillReady = await run(base([{ op: 'pr_draft', pull: 21 }]), answer('convertPullRequestToDraft', { isDraft: false }));
      t('pr_ready answered isDraft true, and pr_draft answered isDraft false, are FAILED actions naming the state', [stillDraft.exit, stillDraft.rows[0]?.result.includes('#21 · draft'), stillReady.exit, stillReady.rows[0]?.result.includes('#21 · ready')], [EXIT_ACTION_FAILED, true, EXIT_ACTION_FAILED, true]);
      const noPull = await run(base([{ op: 'automerge_enable', pull: 21 }]), { ...allowed, ...pull, 'POST /graphql': { status: 200, json: { data: { enablePullRequestAutoMerge: null } } } });
      t('an answer that carries no pullRequest is a FAILED action, never a landing', [noPull.exit, noPull.rows[0]?.result.includes('carries no pullRequest')], [EXIT_ACTION_FAILED, true]);

      const bare = { verb: 'POST', path: '/graphql', graphql: { mutation: 'enablePullRequestAutoMerge', query: 'q', pull: 21 } };
      t('⛔ a pull mutation whose descriptor declares no landed state is never judged landed', requestLanded(bare, { status: 200, json: { data: { enablePullRequestAutoMerge: { pullRequest: { number: 21, autoMergeRequest: { mergeMethod: 'SQUASH' } } } } } }).ok, false);
      // The table half: every pull mutation the op table can issue carries its entry, and selects every field that entry reads.
      const pullRows = Object.keys(OPS).flatMap((op) => OPS[op].requests({ op, pull: 21, issue: 21, comment_id: 1, target_repo: 'x', title: 't', body: 'b', head: 'h', base: 'main', labels: ['l'], assignees: ['u'], reviewers: ['r'], workflow: 'shard-timings-refresh.yml', ref: 'main' }, REPO).filter((r) => r.graphql?.pull !== undefined).map((r) => [op, r.graphql]));
      const selects = (query, field) => new RegExp(`\\b${field}\\b`).test(query.slice(query.indexOf('pullRequest {')));
      t('every pull mutation in the op table carries its PR_LANDED_STATE entry, and its query selects every field that entry reads', [pullRows.map(([op]) => op).sort(), pullRows.every(([op, g]) => g.landed === PR_LANDED_STATE[op] && g.landed.fields.every((f) => selects(g.query, f)))], [Object.keys(PR_LANDED_STATE).sort(), true]);
    }

    // ── the base sync ───────────────────────────────────────────────────────
    battery("the base sync: the PUT carries the expected head; a 202 is confirmed by polling the head off that sha inside the window and reading the merge commit's author; a 422 is a no-op only when the compare measures the head not behind its base; a moved head, a head still behind, an unreadable measure or an expired window is FAILED with nothing after it attempted");
    {
      const OLD = '1111111111111111111111111111111111111111';
      const NEW = '2222222222222222222222222222222222222222';
      const UB = `PUT /repos/${REPO}/pulls/22002/update-branch`;
      const PULL = `GET /repos/${REPO}/pulls/22002`;
      const COMMIT = `GET /repos/${REPO}/commits/${NEW}`;
      const CMP = `GET /repos/${REPO}/compare/objectstack-ai%3Amain...objectstack-ai%3Aclaude/issue-1-x`;
      const pullAt = (sha) => ({ status: 200, json: { number: 22002, head: { sha, label: 'objectstack-ai:claude/issue-1-x' }, base: { ref: 'main', label: 'objectstack-ai:main' } } });
      const accepted = { status: 202, json: { message: 'Updating pull request branch.' } };
      const noNew = { status: 422, json: { message: 'There are no new commits on the base branch.' } };
      let clock = 0;
      const timing = { sleep: async (ms) => { clock += ms; }, now: () => clock };
      const sync = base([{ op: 'pr_update_branch', pull: 22002, expected_head_sha: OLD }]);
      const polls = (r) => r.seen.filter((s) => s.call === PULL).length;

      const req = OPS.pr_update_branch.requests({ op: 'pr_update_branch', pull: 22002, expected_head_sha: OLD }, REPO)[0];
      t('the table half: pr_update_branch spends pull-requests, requires pull and expected_head_sha, and its one request is the PUT carrying the sha with an updateBranch descriptor', [OPS.pr_update_branch.permission, OPS.pr_update_branch.required, req.verb, req.path, req.body, req.updateBranch], ['pull-requests', ['pull', 'expected_head_sha'], 'PUT', `/repos/${REPO}/pulls/22002/update-branch`, { expected_head_sha: OLD }, { pull: 22002, expectedHeadSha: OLD }]);
      t('the window and the interval: about a minute, polled every few seconds, behind a 202', [UPDATE_BRANCH_WINDOW_MS, UPDATE_BRANCH_POLL_MS, UPDATE_BRANCH_ACCEPTED], [60_000, 3_000, 202]);

      clock = 0;
      const moved = await run(sync, { ...allowed, [UB]: accepted, [PULL]: [pullAt(OLD), pullAt(OLD), pullAt(NEW)], [COMMIT]: { status: 200, json: { sha: NEW, author: { login: 'objectstack-fleet[bot]' }, commit: { author: { name: 'objectstack-fleet[bot]' } } } } }, { file: paceFile, ...timing });
      t("202: the pull is polled until its head leaves the expected sha — exit 0, the row prints old → new head and the merge commit's author as the platform names it", [moved.exit, moved.rows[0]?.status, moved.rows[0]?.result, polls(moved)], [EXIT_OK, 202, 'head 1111111 → 2222222 · merge commit author objectstack-fleet[bot] (objectstack-fleet[bot])', 3], moved.logs.join(' | '));
      t("…the polls were spaced by the interval, the author read from the platform's commit, and the PUT carrying the expected sha is the ONE write", [clock, moved.seen.some((s) => s.call === COMMIT), writes(moved.seen).map((s) => [s.call, s.body])], [6_000, true, [[UB, { expected_head_sha: OLD }]]]);

      const noop = await run(sync, { ...allowed, [UB]: noNew, [PULL]: pullAt(OLD), [CMP]: { status: 200, json: { behind_by: 0, ahead_by: 3 } } }, { file: paceFile, ...timing });
      t('422 with the head still the expected sha and the compare measuring behind_by 0 is a NO-OP landing: exit 0, the row says nothing to merge and quotes the platform', [noop.exit, noop.rows[0]?.status, noop.rows[0]?.result], [EXIT_OK, 422, 'no-op: head 1111111 is not behind main (behind_by 0), nothing to merge; the platform said "There are no new commits on the base branch."'], noop.logs.join(' | '));
      const queued = await run(sync, { ...allowed, [UB]: { status: 422, json: { message: 'Pull request is in the merge queue and cannot be updated' } }, [PULL]: pullAt(OLD), [CMP]: { status: 200, json: { behind_by: 2 } } }, timing);
      t("⛔ measured, never spelled: a 422 whose head IS behind its base is a FAILED action naming the count and the platform's sentence — an enqueued pull's \"cannot update\" is read here, through the row", [queued.exit, queued.rows[0]?.result.includes('behind main by 2 commit(s)'), queued.rows[0]?.result.includes('cannot be updated')], [EXIT_ACTION_FAILED, true, true], queued.rows[0]?.result);
      const stale = await run(sync, { ...allowed, [UB]: { status: 422, json: { message: 'expected head sha didn’t match current head ref.' } }, [PULL]: pullAt(NEW) }, timing);
      t('422 with the head no longer the expected sha is FAILED naming both shas, and the compare is never taken', [stale.exit, stale.rows[0]?.result.includes('the head is 2222222, not the expected 1111111'), stale.seen.some((s) => s.call === CMP)], [EXIT_ACTION_FAILED, true, false], stale.rows[0]?.result);
      const unread = await run(sync, { ...allowed, [UB]: noNew, [PULL]: { status: 503, json: { message: 'down' } } }, timing);
      const noCmp = await run(sync, { ...allowed, [UB]: noNew, [PULL]: pullAt(OLD), [CMP]: { status: 404, json: { message: 'Not Found' } } }, timing);
      t('a 422 whose measure cannot be read — the pull or the compare — is FAILED naming the read, never a no-op by default', [unread.exit, unread.rows[0]?.result.includes('could not be re-read'), noCmp.exit, noCmp.rows[0]?.result.includes('the compare could not be read')], [EXIT_ACTION_FAILED, true, EXIT_ACTION_FAILED, true]);

      clock = 0;
      const stuck = await run(base([{ op: 'pr_update_branch', pull: 22002, expected_head_sha: OLD }, { op: 'pr_ready', pull: 22002 }]), { ...allowed, [UB]: accepted, [PULL]: pullAt(OLD) }, timing);
      t('202 whose head never leaves the expected sha inside the window is FAILED, UNCONFIRMED in its sentence, after the whole window — and the pr_ready behind it is never attempted', [stuck.exit, stuck.rows[0]?.result.includes('UNCONFIRMED') && stuck.rows[0]?.result.includes('do not re-send'), clock, writes(stuck.seen).length, stuck.summary.includes('1 later action(s) NOT attempted')], [EXIT_ACTION_FAILED, true, 60_000, 1, true], stuck.rows[0]?.result);
      const denied = await run(sync, { ...allowed, [UB]: { status: 403, json: { message: 'Resource not accessible by integration' } } }, timing);
      t("any other answer is FAILED with the platform's sentence, nothing polled", [denied.exit, denied.rows[0]?.result.includes('Resource not accessible by integration'), polls(denied)], [EXIT_ACTION_FAILED, true, 0]);
    }

    // ── the assignees leg ───────────────────────────────────────────────────
    battery("the assignees and labels legs: pr_create with assignees is the create, then ONE POST to the created pull's issue-assignees endpoint at the number the create ANSWERED — never the request; the answer must list every login sent; no assignees, no second request; an answer without a number stops the stroke with the leg not sent; with labels, ONE POST to the issue-labels endpoint at that same number — the create's, never the assignee answer's — whose answer must list every name sent");
    {
      const PULLS = `POST /repos/${REPO}/pulls`;
      const ASSIGN = (n) => `POST /repos/${REPO}/issues/${n}/assignees`;
      const create = (assignees, extra = []) => base([{ op: 'pr_create', title: 'T', head: 'claude/issue-1-x', base: 'main', body: 'B', ...(assignees ? { assignees } : {}) }, ...extra]);
      const opened = { status: 201, json: { number: 22700, html_url: `https://github.test/${REPO}/pull/22700` } };
      // ⛔ No governed-review follow-up runs after a create (its own battery below): the pull's files are never read here.
      const FILES22700 = `GET /repos/${REPO}/pulls/22700/files`;
      const assignedTo = (logins, n = 22700) => ({ status: 201, json: { number: n, html_url: `https://github.test/${REPO}/pull/${n}`, assignees: logins.map((login) => ({ login })) } });

      const legs = OPS.pr_create.requests({ op: 'pr_create', title: 'T', head: 'h', base: 'main', assignees: ['marchtian'] }, REPO);
      t('the table half: with assignees the row is two requests — the draft create, then a POST to the issue-assignees path at the placeholder, carrying fromAnswer number and the logins as assigned', legs.map((r) => [r.verb, r.path, r.body, r.fromAnswer ?? null, r.assigned ?? null]), [['POST', `/repos/${REPO}/pulls`, { title: 'T', head: 'h', base: 'main', draft: true }, null, null], ['POST', `/repos/${REPO}/issues/${answerPlaceholder('number')}/assignees`, { assignees: ['marchtian'] }, 'number', ['marchtian']]]);
      t('the fill: the placeholder becomes the positive integer the previous answer carries at that field, and nothing else about the leg changes', fillFromAnswer(legs[1], { call: 'POST /x', status: 201, json: { number: 22700 } }).req, { ...legs[1], path: `/repos/${REPO}/issues/22700/assignees` });
      t('…a previous answer without it — absent, a numeric string, zero, a float — or no previous answer at all, is a refusal to send that names the field', [{ json: {} }, { json: { number: '22700' } }, { json: { number: 0 } }, { json: { number: 1.5 } }, null].map((prev) => { const f = fillFromAnswer(legs[1], prev ? { call: 'POST /x', status: 201, ...prev } : null).fail; return typeof f === 'string' && f.includes('number'); }), [true, true, true, true, true]);

      const ok = await run(create(['marchtian']), { ...allowed, [PULLS]: opened, [ASSIGN(22700)]: assignedTo(['marchtian']) }, { file: paceFile });
      t('the run: the create, then the assignee POST at the number the create ANSWERED, both under the App token — exit 0', [ok.exit, writes(ok.seen).map((s) => [s.call, s.body, s.auth === `Bearer ${TOKEN}`])], [EXIT_OK, [[PULLS, { title: 'T', head: 'claude/issue-1-x', base: 'main', body: 'B', draft: true }, true], [ASSIGN(22700), { assignees: ['marchtian'] }, true]]]);
      t("…and the leg's row prints the pull and the assignees as the platform lists them, with NO governed-review row behind it and the pull's files never read", [ok.rows.map((r) => [r.action, r.op, r.call, r.status, r.result]), ok.seen.some((s) => s.call === FILES22700)], [[[1, 'pr_create', PULLS, 201, `#22700 https://github.test/${REPO}/pull/22700`], [1, 'pr_create', ASSIGN(22700), 201, `#22700 https://github.test/${REPO}/pull/22700 · assignees marchtian`]], false]);
      const plain = await run(create(null), { ...allowed, [PULLS]: opened }, { file: paceFile });
      t('no assignees, no second request: the create alone, as before', [plain.exit, writes(plain.seen).map((s) => s.call)], [EXIT_OK, [PULLS]]);
      const dropped = await run(create(['marchtian', 'nobody-here'], [{ op: 'comment', issue: 1, body: 'after' }]), { ...allowed, [PULLS]: opened, [ASSIGN(22700)]: assignedTo(['marchtian']), [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1 } } });
      t('⛔ a 201 whose answer lists fewer logins than sent is a FAILED action naming the one not assigned — never a quiet partial — and the stroke stops there', [dropped.exit, dropped.rows[1]?.result.includes('nobody-here not assigned'), dropped.rows[1]?.result.includes('lists marchtian'), writes(dropped.seen).length, dropped.summary.includes('1 later action(s) NOT attempted')], [EXIT_ACTION_FAILED, true, true, 2, true], dropped.rows[1]?.result);
      t('…a login is matched as GitHub matches one, case-insensitively', requestLanded({ verb: 'POST', path: '/x', assigned: ['MarchTian'] }, { status: 201, json: { assignees: [{ login: 'marchtian' }] } }).ok, true);
      const blank = await run(create(['marchtian'], [{ op: 'comment', issue: 1, body: 'after' }]), { ...allowed, [PULLS]: { status: 201, json: { html_url: 'https://github.test/x' } }, [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1 } } });
      t('a create whose answer carries no number: the create landed, the leg was NOT SENT (its row says so, no assignee POST left), exit 5, the later action never attempted', [blank.exit, blank.rows.map((r) => [r.status, r.result.startsWith('FAILED') ? r.result.includes('NOT SENT') : r.result]), writes(blank.seen).map((s) => s.call)], [EXIT_ACTION_FAILED, [[201, 'https://github.test/x'], ['not sent', true]], [PULLS]]);
      const refused = await run(create(['marchtian']), { ...allowed, [PULLS]: opened, [ASSIGN(22700)]: { status: 403, json: { message: 'Resource not accessible by integration' } } });
      t("a refused assignee POST is a FAILED action with the platform's sentence, the pull already open", [refused.exit, refused.rows.map((r) => r.status), refused.rows[1]?.result.includes('Resource not accessible by integration')], [EXIT_ACTION_FAILED, [201, 403], true]);
      t('no annotation is emitted for it — pr_create is not an annotated op, assignees or not', [ok.annotations, ok.logs.some((l) => l.startsWith('::notice'))], [[], false]);

      // The labels leg — the same shape, a dev's `skip-changeset` riding the create.
      const LABEL = (n) => `POST /repos/${REPO}/issues/${n}/labels`;
      const createWith = (fields, extra = []) => base([{ op: 'pr_create', title: 'T', head: 'claude/issue-1-x', base: 'main', body: 'B', ...fields }, ...extra]);
      const labelsOn = (names) => ({ status: 200, json: names.map((name) => ({ name })) });
      const both = OPS.pr_create.requests({ op: 'pr_create', title: 'T', head: 'h', base: 'main', assignees: ['marchtian'], labels: ['skip-changeset'] }, REPO);
      t('the table half: with labels the row carries a POST to the issue-labels path at the placeholder, fromAnswer number, the names as labelled — after the assignees leg when both are sent', both.map((r) => [r.verb, r.path, r.fromAnswer ?? null, r.assigned ?? null, r.labelled ?? null]), [['POST', `/repos/${REPO}/pulls`, null, null, null], ['POST', `/repos/${REPO}/issues/${answerPlaceholder('number')}/assignees`, 'number', ['marchtian'], null], ['POST', `/repos/${REPO}/issues/${answerPlaceholder('number')}/labels`, 'number', null, ['skip-changeset']]]);
      // The assignee answer here carries a DIFFERENT number: the label leg must still land on the pull the CREATE answered.
      const labelled = await run(createWith({ assignees: ['marchtian'], labels: ['skip-changeset'] }), { ...allowed, [PULLS]: opened, [ASSIGN(22700)]: assignedTo(['marchtian'], 99999), [LABEL(22700)]: labelsOn(['skip-changeset', 'documentation']) }, { file: paceFile });
      t("the run: the create, the assignee POST, then the label POST — at the number the CREATE answered, not the assignee answer's — exit 0", [labelled.exit, writes(labelled.seen).map((s) => [s.call, s.body])], [EXIT_OK, [[PULLS, { title: 'T', head: 'claude/issue-1-x', base: 'main', body: 'B', draft: true }], [ASSIGN(22700), { assignees: ['marchtian'] }], [LABEL(22700), { labels: ['skip-changeset'] }]]]);
      t("…and the leg's row prints the labels as the platform lists them — more than sent (the Auto Label workflow's additive writes) is a landing, never a failure", labelled.rows[2], { action: 1, op: 'pr_create', call: LABEL(22700), status: 200, result: '2 label(s) now on the pull · labels skip-changeset, documentation' });
      const labelsOnly = await run(createWith({ labels: ['skip-changeset'] }), { ...allowed, [PULLS]: opened, [LABEL(22700)]: labelsOn(['skip-changeset']) }, { file: paceFile });
      t('labels without assignees: the create, then the label POST alone', [labelsOnly.exit, writes(labelsOnly.seen).map((s) => s.call)], [EXIT_OK, [PULLS, LABEL(22700)]]);
      const unlabelled = await run(createWith({ labels: ['skip-changeset', 'no-such-label'] }, [{ op: 'comment', issue: 1, body: 'after' }]), { ...allowed, [PULLS]: opened, [LABEL(22700)]: labelsOn(['skip-changeset']), [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1 } } });
      t('⛔ a 200 whose answer lacks a name sent is a FAILED action naming it — never a quiet partial — and the stroke stops there', [unlabelled.exit, unlabelled.rows[1]?.result.includes('no-such-label not applied'), unlabelled.rows[1]?.result.includes('lists skip-changeset'), writes(unlabelled.seen).length, unlabelled.summary.includes('1 later action(s) NOT attempted')], [EXIT_ACTION_FAILED, true, true, 2, true], unlabelled.rows[1]?.result);
      t('…a name is matched as GitHub matches one, case-insensitively', requestLanded({ verb: 'POST', path: '/x', labelled: ['Skip-Changeset'] }, { status: 200, json: [{ name: 'skip-changeset' }] }).ok, true);
      t("…and a plain labels_add answer is counted, not judged — labelled is the leg's alone", [requestLanded({ verb: 'POST', path: '/x' }, { status: 200, json: [] }).ok, resultOf({ verb: 'POST', path: '/x' }, [{ name: 'a' }], 200)], [true, '1 label(s) now on the issue']);
      const blankLabel = await run(createWith({ labels: ['skip-changeset'] }, [{ op: 'comment', issue: 1, body: 'after' }]), { ...allowed, [PULLS]: { status: 201, json: { html_url: 'https://github.test/x' } }, [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1 } } });
      t('a create whose answer carries no number: the label leg is NOT SENT, exit 5, the later action never attempted', [blankLabel.exit, blankLabel.rows.map((r) => r.status), writes(blankLabel.seen).map((s) => s.call)], [EXIT_ACTION_FAILED, [201, 'not sent'], [PULLS]]);
    }

    // ── the governed-review follow-up ───────────────────────────────────────
    battery("the governed-review follow-up: after pr_ready alone — a pr_create summons NOBODY and never reads the pull's files, because a human is asked only at the seat's hand-off (pr_request_reviewers after ACCEPT + a same-head PASS); after pr_ready the pull's file list is read in full, a Tier H hit requests review from every GOVERNED_APPROVERS account not already requested, assigned or reviewed — the pull's own author assigned instead, never requested; a Tier S or ungoverned diff sends nothing and says so; an unreadable or truncated list, an unreadable pull or review list, or a refused write is a FAILED action");
    {
      const PULLS = `POST /repos/${REPO}/pulls`;
      const N = 25050;
      const FILES = `GET /repos/${REPO}/pulls/${N}/files`;
      const PULL = `GET /repos/${REPO}/pulls/${N}`;
      const REVIEWS = `GET /repos/${REPO}/pulls/${N}/reviews`;
      const REQUEST = `POST /repos/${REPO}/pulls/${N}/requested_reviewers`;
      const ASSIGN = `POST /repos/${REPO}/issues/${N}/assignees`;
      const GRAPHQL = 'POST /graphql';
      // The approvers are READ from the constant, never restated: a change there moves every expectation here with it.
      const [A1, A2] = GOVERNED_APPROVERS;
      const URL = `https://github.test/${REPO}/pull/${N}`;
      const opened = { status: 201, json: { number: N, html_url: URL } };
      const files = (...names) => ({ status: 200, json: names.map((f) => (typeof f === 'string' ? { filename: f } : f)) });
      const pullOf = ({ author = 'objectstack-fleet[bot]', requested = [], assignees = [] } = {}) => ({ status: 200, json: { number: N, node_id: 'PR_kwDO25050', user: { login: author }, requested_reviewers: requested.map((login) => ({ login })), assignees: assignees.map((login) => ({ login })) } });
      const reviewsBy = (...logins) => ({ status: 200, json: logins.map((login) => ({ state: 'APPROVED', user: { login } })) });
      const requestedAnswer = (logins) => ({ status: 201, json: { number: N, html_url: URL, requested_reviewers: logins.map((login) => ({ login })) } });
      const assignedAnswer = (logins) => ({ status: 201, json: { number: N, html_url: URL, assignees: logins.map((login) => ({ login })) } });
      const create = (extra = []) => base([{ op: 'pr_create', title: 'T', head: 'claude/issue-1-x', base: 'main', body: 'B' }, ...extra]);
      const ready = (extra = []) => base([{ op: 'pr_ready', pull: N }, ...extra]);
      const readied = { [GRAPHQL]: { status: 200, json: { data: { markPullRequestReadyForReview: { pullRequest: { number: N, isDraft: false } } } } } };
      const tierHFiles = files('docs/adr/0140-x.md', 'packages/core/src/a.ts');
      const tierH = { [PULL]: pullOf(), ...readied, [FILES]: tierHFiles, [REVIEWS]: reviewsBy() };
      const pick = (plan) => [plan.tier, plan.toRequest, plan.toAssign, plan.covered];

      // The table half.
      t("⭐ the table half: GOVERNED_REVIEW_OPS is exactly pr_ready — derived from the rows, never listed — pr_create is OFF it (the draft open summons nobody; the hand-off is the seat's pr_request_reviewers), and the row spends issues (the assignee fallback) as alsoSpends", [GOVERNED_REVIEW_OPS, OPS.pr_create.governedReview ?? null, GOVERNED_REVIEW_OPS.every((op) => (OPS[op].alsoSpends ?? []).includes('issues'))], [['pr_ready'], null, true]);
      t('…governedReviewRequests spells ONE requested_reviewers POST carrying the logins as requested and ONE issue-assignees POST carrying them as assigned; an empty list spells nothing', [governedReviewRequests(REPO, N, { reviewers: [A1, A2], assignees: [A2] }).map((r) => [r.verb, r.path, r.body, r.requested ?? null, r.assigned ?? null]), governedReviewRequests(REPO, N), governedReviewRequests(REPO, N, { reviewers: [], assignees: [] })], [[['POST', `/repos/${REPO}/pulls/${N}/requested_reviewers`, { reviewers: [A1, A2] }, [A1, A2], null], ['POST', `/repos/${REPO}/issues/${N}/assignees`, { assignees: [A2] }, null, [A2]]], [], []]);
      // The plan — pure, over the real register.
      t('the plan: a Tier H path with nobody covered requests every GOVERNED_APPROVERS account, in its order, and assigns nobody', pick(governedReviewPlan({ paths: ['docs/adr/0140-x.md', 'README.md'], repo: REPO })), [GOVERNED_TIER_H, [A1, A2], [], []]);
      t("…the pull's own author, when it is an uncovered approver, is ASSIGNED and never requested — the other approver is requested as before", pick(governedReviewPlan({ paths: ['AGENTS.md'], repo: REPO, author: A2 })), [GOVERNED_TIER_H, [A1], [A2], []]);
      t('…an approver already requested, assigned or holding a submitted review is covered — the H43 union — and matched case-insensitively', pick(governedReviewPlan({ paths: ['skills/x/SKILL.md'], repo: REPO, author: A2, requested: [A1.toUpperCase()], assigned: [A2] })), [GOVERNED_TIER_H, [], [], [A1, A2]]);
      t("…a submitted review covers its author's slot; a pending (unsubmitted) one does not", [reviewedLogins([{ state: 'COMMENTED', user: { login: 'x' } }, { state: 'PENDING', user: { login: 'y' } }]), governedReviewPlan({ paths: ['CLAUDE.md'], repo: REPO, reviewed: [A1] }).toRequest], [['x'], [A2]]);
      t('…a Tier S diff (the .claude/** row alone) is tier S and sends nothing; an ungoverned diff is tier null; a mixed S+H diff is H', [governedReviewPlan({ paths: ['.claude/skills/pm-dispatch/SKILL.md'], repo: REPO }), governedReviewPlan({ paths: ['packages/core/src/a.ts'], repo: REPO }), governedReviewPlan({ paths: ['.claude/agents/os-dev.md', 'docs/NORTH-STAR.md'], repo: REPO })].map((p) => [p.tier, p.toRequest.length + p.toAssign.length]), [[GOVERNED_TIER_S, 0], [null, 0], [GOVERNED_TIER_H, 2]]);
      t('…a target outside GOVERNED_REPOS has no governing row: repoId null, tier null, nothing to send', (({ repoId, tier, toRequest }) => [repoId, tier, toRequest])(governedReviewPlan({ paths: ['docs/adr/0001-x.md'], repo: 'objectstack-ai/elsewhere' })), [null, null, []]);
      t('…the register is scoped per repository: a workflow path is Tier H on objectui and ungoverned on objectos', [governedReviewPlan({ paths: ['.github/workflows/ci.yml'], repo: 'objectstack-ai/objectui' }).tier, governedReviewPlan({ paths: ['.github/workflows/ci.yml'], repo: 'objectstack-ai/objectos' }).tier], [GOVERNED_TIER_H, null]);
      t('…a rename OUT of a governed path counts by its old name (pullPathsFrom reads previous_filename)', governedReviewPlan({ paths: pullPathsFrom([{ filename: 'docs/agents.md', previous_filename: 'AGENTS.md' }]).paths, repo: REPO }).tier, GOVERNED_TIER_H);
      t('…the approver list is INJECTED from GOVERNED_APPROVERS, never baked in: another list is requested in its place', governedReviewPlan({ paths: ['AGENTS.md'], repo: REPO, approvers: ['someone-else'] }).toRequest, ['someone-else']);
      t('…the verdict words name the tier, the rows hit, who is covered and what is sent', [governedReviewText(governedReviewPlan({ paths: ['docs/adr/0140-x.md'], repo: REPO, requested: [A1] }), { repo: REPO, files: 1 }), governedReviewText(governedReviewPlan({ paths: ['x.ts'], repo: REPO }), { repo: REPO, files: 1 })], [`governed review: Tier H (\`docs/adr/**\`×1) — \`${A1}\` already covered; requesting \`${A2}\``, 'governed review: no governed row hit across 1 file(s) — no review requested']);

      // The run — pr_create: NOTHING. The draft open summons nobody; the fake platform is primed with every answer the old follow-up would have asked for, and none is asked.
      const draft = await run(create([{ op: 'comment', issue: 1, body: 'after' }]), { ...allowed, [PULLS]: opened, [FILES]: tierHFiles, [PULL]: pullOf(), [REVIEWS]: reviewsBy(), [REQUEST]: requestedAnswer([A1, A2]), [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1 } } });
      t('⭐ pr_create on a Tier H diff: the create and NOTHING else — no file list, pull or review read, no request, no assignee — and the later action runs, exit 0', [draft.exit, draft.seen.map((s) => s.call), writes(draft.seen).map((s) => s.call), draft.rows.length, draft.rows[0]], [EXIT_OK, [PERM, PULLS, `POST /repos/${REPO}/issues/1/comments`], [PULLS, `POST /repos/${REPO}/issues/1/comments`], 2, { action: 1, op: 'pr_create', call: PULLS, status: 201, result: `#${N} ${URL}` }], draft.logs.join(' | '));
      const draftAuthored = await run(create(), { ...allowed, [PULLS]: opened, [FILES]: tierHFiles, [PULL]: pullOf({ author: A2 }), [REVIEWS]: reviewsBy(), [ASSIGN]: assignedAnswer([A2]) });
      t("…an approver-authored pull is not assigned at the open either: the author-is-approver fallback is the seat's hand-off stroke (`assign`), never the create's", [draftAuthored.exit, writes(draftAuthored.seen).map((s) => s.call), draftAuthored.seen.some((s) => [ASSIGN, REQUEST, FILES, REVIEWS].includes(s.call))], [EXIT_OK, [PULLS], false]);
      const numberless = await run(create([{ op: 'comment', issue: 1, body: 'after' }]), { ...allowed, [PULLS]: { status: 201, json: { html_url: 'https://github.test/x' } }, [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1 } } });
      t('a create whose answer carries no number owes no follow-up, so nothing fails on its account: the create row stands, no file list is read, the later action runs', [numberless.exit, numberless.rows.length, numberless.seen.some((s) => s.call.includes('/files'))], [EXIT_OK, 2, false], numberless.logs.join(' | '));

      // The run — pr_ready, the one follow-up left.
      const both = await run(ready(), { ...allowed, ...tierH, [REQUEST]: requestedAnswer([A1, A2]) });
      t('⭐ pr_ready on a Tier H pull: the node id, the mutation, then ONE requested_reviewers POST naming BOTH approvers at the pull the action names, under the App token — exit 0', [both.exit, writes(both.seen).map((s) => [s.call, s.auth === `Bearer ${TOKEN}`]), writes(both.seen)[1]?.body], [EXIT_OK, [[GRAPHQL, true], [REQUEST, true]], { reviewers: [A1, A2] }], both.logs.join(' | '));
      t('…the file list, the pull and its reviews were read first, in that order, and the rows say the verdict and the landing', [both.seen.map((s) => s.call), both.rows.slice(1).map((r) => [r.action, r.op, r.call, r.status, r.result])], [[PERM, PULL, GRAPHQL, FILES, PULL, REVIEWS, REQUEST], [[1, 'pr_ready', FILES, 200, `governed review: Tier H (\`docs/adr/**\`×1) — requesting \`${A1}\`, \`${A2}\``], [1, 'pr_ready', REQUEST, 201, `#${N} ${URL} · review requested from ${A1}, ${A2}`]]]);
      const none = await run(ready([{ op: 'comment', issue: 1, body: 'after' }]), { ...allowed, [PULL]: pullOf(), ...readied, [FILES]: files('packages/core/src/a.ts', 'README.md'), [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1 } } });
      t('a non-governed diff: the file list is read, NOTHING is requested, the row says so, and the later action runs', [none.exit, writes(none.seen).map((s) => s.call), none.rows[1]?.result, none.seen.filter((s) => s.call === PULL).length], [EXIT_OK, [GRAPHQL, `POST /repos/${REPO}/issues/1/comments`], 'governed review: no governed row hit across 2 file(s) — no review requested', 1]);
      const tierS = await run(ready(), { ...allowed, [PULL]: pullOf(), ...readied, [FILES]: files('.claude/skills/pm-dispatch/SKILL.md') });
      t("a Tier S diff (.claude/** alone) requests nobody — it lands on a seat's review of record", [tierS.exit, writes(tierS.seen).map((s) => s.call), tierS.rows[1]?.result], [EXIT_OK, [GRAPHQL], "governed review: Tier S (`.claude/**`×1) lands on a seat's review of record — no review requested"]);
      const authored = await run(ready(), { ...allowed, ...tierH, [PULL]: pullOf({ author: A2 }), [REQUEST]: requestedAnswer([A1]), [ASSIGN]: assignedAnswer([A2]) });
      t('⭐ the author-identity branch: a pull authored by an approver requests the OTHER approver and ASSIGNS the author — never a request naming the author', [authored.exit, writes(authored.seen).slice(1).map((s) => [s.call, s.body]), authored.rows.map((r) => r.result).slice(1)], [EXIT_OK, [[REQUEST, { reviewers: [A1] }], [ASSIGN, { assignees: [A2] }]], [`governed review: Tier H (\`docs/adr/**\`×1) — requesting \`${A1}\` and assigning the author \`${A2}\` (a request naming the author is a 422)`, `#${N} ${URL} · review requested from ${A1}`, `#${N} ${URL} · assignees ${A2}`]]);
      const covered = await run(ready(), { ...allowed, ...tierH, [PULL]: pullOf({ requested: [A1] }), [REVIEWS]: reviewsBy(A2) });
      t("⭐ idempotent — the seat's hand-off already made: one approver requested and the other already reviewed — ZERO writes beyond the mutation, the row says nothing to send, exit 0", [covered.exit, writes(covered.seen).map((s) => s.call), covered.rows[1]?.result], [EXIT_OK, [GRAPHQL], `governed review: Tier H (\`docs/adr/**\`×1) — \`${A1}\`, \`${A2}\` already requested, assigned or reviewed; nothing to send`]);
      const partial = await run(ready(), { ...allowed, ...tierH, [PULL]: pullOf({ assignees: [A2] }), [REQUEST]: requestedAnswer([A1]) });
      t('…an assigned approver counts as covered, and only the missing one is requested', [partial.exit, writes(partial.seen).map((s) => [s.call, s.body]).slice(1)], [EXIT_OK, [[REQUEST, { reviewers: [A1] }]]]);
      const readyFailed = await run(ready(), { ...allowed, [PULL]: pullOf(), [GRAPHQL]: { status: 200, json: { data: { markPullRequestReadyForReview: { pullRequest: { number: N, isDraft: true } } } } }, [FILES]: files('docs/adr/0140-x.md') });
      t('a pr_ready that did not land runs no follow-up: no file list read, no request', [readyFailed.exit, readyFailed.seen.some((s) => s.call === FILES)], [EXIT_ACTION_FAILED, false]);
      // The refusals.
      const unread = await run(ready([{ op: 'comment', issue: 1, body: 'after' }]), { ...allowed, [PULL]: pullOf(), ...readied, [FILES]: { status: 503, json: { message: 'down' } }, [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1 } } });
      t('⛔ an unreadable file list is a FAILED action — the pull is ready (its row landed), the follow-up row names the read, exit 5, the later action never attempted — never a quiet "not governed"', [unread.exit, unread.rows.map((r) => [r.status, r.result.startsWith('FAILED') ? r.result.includes('file list could not be read') : 'landed']), writes(unread.seen).map((s) => s.call), unread.summary.includes('1 later action(s) NOT attempted')], [EXIT_ACTION_FAILED, [[200, 'landed'], [503, true]], [GRAPHQL], true], unread.rows[1]?.result);
      const page = (n) => files(...Array.from({ length: n }, (_, i) => `packages/core/src/f${i}.ts`));
      const twoPages = await run(ready(), { ...allowed, [PULL]: pullOf(), ...readied, [FILES]: [page(100), files('docs/adr/0140-x.md')], [REVIEWS]: reviewsBy(), [REQUEST]: requestedAnswer([A1, A2]) });
      t('the walk reads EVERY page: a governed path on the second page is found, and the pages were asked in order', [twoPages.exit, twoPages.seen.filter((s) => s.call === FILES).length, writes(twoPages.seen).map((s) => s.call)], [EXIT_OK, 2, [GRAPHQL, REQUEST]]);
      const truncated = await run(ready(), { ...allowed, [PULL]: pullOf(), ...readied, [FILES]: Array.from({ length: GOVERNED_REVIEW_FILES_PAGE_CAP }, () => page(100)) });
      t('⛔ a walk that would need more than the page cap is a FAILED action naming the cap — a truncated list is a subset, never "nothing governed"', [truncated.exit, truncated.seen.filter((s) => s.call === FILES).length, truncated.rows[1]?.result.includes(`${GOVERNED_REVIEW_FILES_PAGE_CAP}-page cap`)], [EXIT_ACTION_FAILED, GOVERNED_REVIEW_FILES_PAGE_CAP, true], truncated.rows[1]?.result);
      const short = await run(ready(), { ...allowed, ...tierH, [REQUEST]: requestedAnswer([A1]) });
      t('⛔ a 201 whose answer lists fewer reviewers than sent is a FAILED action naming the one not requested — never a quiet partial', [short.exit, short.rows[2]?.result.includes(`${A2} not requested`), short.rows[2]?.result.includes(`lists ${A1}`)], [EXIT_ACTION_FAILED, true, true], short.rows[2]?.result);
      const refused = await run(ready(), { ...allowed, ...tierH, [REQUEST]: { status: 422, json: { message: 'Reviews may only be requested from collaborators.' } } });
      t("a refused request is a FAILED action with the platform's sentence, the pull already ready", [refused.exit, refused.rows.map((r) => r.status), refused.rows[2]?.result.includes('Reviews may only be requested from collaborators')], [EXIT_ACTION_FAILED, [200, 200, 422], true]);
      const noPull = await run(ready(), { ...allowed, ...tierH, [PULL]: [pullOf(), { status: 503, json: { message: 'down' } }] });
      const noReviews = await run(ready(), { ...allowed, ...tierH, [REVIEWS]: { status: 503, json: { message: 'down' } } });
      t('an unreadable pull or review list on a Tier H hit is FAILED naming the read — never a request sent blind, never a quiet skip', [noPull.exit, noPull.rows[1]?.result.includes('could not be re-read'), noReviews.exit, noReviews.rows[1]?.result.includes('reviews could not be read'), [...noPull.seen, ...noReviews.seen].some((s) => s.call === REQUEST)], [EXIT_ACTION_FAILED, true, EXIT_ACTION_FAILED, true, false]);
      t('no annotation is emitted for the follow-up — pr_ready is not an annotated op', [both.annotations, authored.logs.some((l) => l.startsWith('::notice'))], [[], false]);
    }

    // ── the transfer ────────────────────────────────────────────────────────
    battery('the transfer: the sender gated on BOTH repositories, both node ids first, a pull or a moved card refused before the mutation, landing only on the target, the remedy on failure');
    {
      const UI = 'objectstack-ai/objectui';
      const PERM_UI = `GET /repos/${UI}/collaborators/os-support-ai/permission`;
      const issueAt = (repo, extra = {}) => ({ status: 200, json: { number: 7, node_id: 'I_kwDO7', repository_url: `https://api.github.test/repos/${repo}`, ...extra } });
      const landedOn = (where) => ({ data: { transferIssue: { issue: { number: 31, url: `https://github.test/${where}/issues/31`, repository: { nameWithOwner: where } } } } });
      const happyT = {
        ...allowed,
        [PERM_UI]: { status: 200, json: { permission: 'write', role_name: 'maintain' } },
        [`GET /repos/${REPO}/issues/7`]: issueAt(REPO),
        [`GET /repos/${UI}`]: { status: 200, json: { node_id: 'R_kgDOui', full_name: UI } },
        'POST /graphql': { status: 200, json: landedOn(UI) },
      };
      const move = base([{ op: 'transfer', issue: 7, target_repo: UI }]);
      const ok = await run(move, happyT, { file: paceFile });
      t('a transfer gates the sender on the source AND the target, reads the issue and the target, then sends ONE mutation', [ok.exit, ok.seen.map((s) => s.call)], [EXIT_OK, [PERM, PERM_UI, `GET /repos/${REPO}/issues/7`, `GET /repos/${UI}`, 'POST /graphql']], ok.logs.join(' | '));
      t('…with both node ids as its variables, under the transferIssue query', [ok.seen[4]?.body?.variables, ok.seen[4]?.body?.query.includes('transferIssue(')], [{ issueId: 'I_kwDO7', repositoryId: 'R_kgDOui' }, true]);
      t('…and the row reads the new number, url and repository; the summary names both repositories and both roles', [ok.rows[0]?.result, ok.summary.includes(`the token also reaches \`${UI}\``), ok.summary.includes(`write on ${REPO}, maintain on ${UI}`)], [`#31 https://github.test/${UI}/issues/31 (now on ${UI})`, true, true]);
      const noTarget = await run(move, { ...happyT, [PERM_UI]: { status: 200, json: { permission: 'read', role_name: 'read' } } });
      t('⛔ a sender with write on the source but not on the target is refused: exit 4, zero writes, the target named', [noTarget.exit, writes(noTarget.seen).length, noTarget.logs.some((l) => l.includes(`is read on ${UI}`))], [EXIT_SENDER_REFUSED, 0, true]);
      const pullT = await run(move, { ...happyT, [`GET /repos/${REPO}/issues/7`]: issueAt(REPO, { pull_request: { url: 'https://api.github.test/pulls/7' } }) });
      t('a number that is a pull request is refused before the mutation', [pullT.exit, pullT.seen.some((s) => s.call === 'POST /graphql'), pullT.rows[0]?.result], [EXIT_ACTION_FAILED, false, 'a pull request']);
      const already = await run(move, { ...happyT, [`GET /repos/${REPO}/issues/7`]: issueAt(UI, { number: 31 }) });
      t('a card that already answers from another repository (the platform followed its redirect) is refused before the mutation', [already.exit, already.seen.some((s) => s.call === 'POST /graphql'), already.logs.some((l) => l.includes(`it answers from ${UI} as #31 — already transferred`))], [EXIT_ACTION_FAILED, false, true]);
      const uncovered = await run(move, { ...happyT, [`GET /repos/${UI}`]: { status: 404, json: { message: 'Not Found' } } });
      t('a target whose node id cannot be read stops before the mutation, and the summary names the installation remedy', [uncovered.exit, uncovered.seen.some((s) => s.call === 'POST /graphql'), uncovered.summary.includes('Remedy:') && uncovered.summary.includes("objectstack-fleet App's repository access")], [EXIT_ACTION_FAILED, false, true]);
      const denied = await run(move, { ...happyT, 'POST /graphql': { status: 200, json: { data: { transferIssue: null }, errors: [{ message: 'Resource not accessible by integration' }] } } });
      t('a mutation the platform refuses is exit 5 with its sentence, and the remedy in the log and the summary', [denied.exit, denied.rows[0]?.result.includes('Resource not accessible by integration'), denied.logs.some((l) => l.includes('remedy —')), denied.summary.includes('Remedy:')], [EXIT_ACTION_FAILED, true, true, true]);
      const req = OPS.transfer.requests({ op: 'transfer', issue: 7, target_repo: UI })[0];
      t('⛔ an answer that places the card anywhere but the target is not a landing', requestLanded(req, { status: 200, json: landedOn('objectstack-ai/cloud') }).ok, false);
      t('…nor is one that carries no issue', requestLanded(req, { status: 200, json: { data: { transferIssue: { issue: null } } } }).ok, false);
      const plain = await run(base([{ op: 'comment', issue: 1, body: 'x' }]), { ...allowed, [`POST /repos/${REPO}/issues/1/comments`]: { status: 403, json: { message: 'Resource not accessible by integration' } } });
      t('a failure that is not a transfer carries no transfer remedy, and its token reached one repository only', [plain.exit, plain.summary.includes('Remedy:'), plain.summary.includes('the token also reaches')], [EXIT_ACTION_FAILED, false, false]);
    }

    // ── the workflow_dispatch ───────────────────────────────────────────────
    battery('the workflow_dispatch: ONE POST to the dispatch endpoint of the allowlisted file with { ref: main } under the App token, a bodiless 204 lands as accepted, a 422 or 403 is a failed action, no other actions/* request leaves, no annotation');
    {
      const FILE = 'shard-timings-refresh.yml';
      const DISPATCHES = `POST /repos/${REPO}/actions/workflows/${FILE}/dispatches`;
      const start = base([{ op: 'workflow_dispatch', workflow: FILE, ref: 'main' }]);
      const ok = await run(start, { ...allowed, [DISPATCHES]: { status: 204, json: null } }, { file: paceFile });
      t('the one write is POST …/actions/workflows/{file}/dispatches with { ref: main } and nothing else in the body, exit 0', [ok.exit, writes(ok.seen).map((s) => [s.call, s.body])], [EXIT_OK, [[DISPATCHES, { ref: 'main' }]]]);
      t('…under the App token, after the sender gate on the ONE repository the stroke names', [ok.seen.map((s) => s.call), ok.seen.every((s) => s.auth === `Bearer ${TOKEN}`)], [[PERM, DISPATCHES], true]);
      t('a bodiless 204 lands: the row says accepted, the summary row carries 204, and the log counts one request landed', [ok.rows[0]?.status, ok.rows[0]?.result, ok.summary.includes(`| 1 | \`workflow_dispatch\` | \`${DISPATCHES}\` | 204 | accepted (HTTP 204, no body) |`), ok.logs.some((l) => l.includes('1 request(s) landed'))], [204, 'accepted (HTTP 204, no body)', true, true], ok.summary);
      t('⛔ no other actions/* request leaves — no cancel, re-run, delete, cache or artifact call — and no annotation is emitted (the answer carries no run)', [ok.seen.filter((s) => s.call.includes('/actions/') && s.call !== DISPATCHES), ok.annotations, ok.logs.filter((l) => l.startsWith('::'))], [[], [], []]);
      const noTrigger = await run(start, { ...allowed, [DISPATCHES]: { status: 422, json: { message: 'Workflow does not have \'workflow_dispatch\' trigger' } } });
      t('a 422 (the workflow declares no workflow_dispatch trigger, or refuses the ref) is a FAILED action, exit 5, with the platform\'s sentence', [noTrigger.exit, noTrigger.rows[0]?.status, noTrigger.rows[0]?.result.includes('workflow_dispatch\' trigger')], [EXIT_ACTION_FAILED, 422, true]);
      const noGrant = await run(start, { ...allowed, [DISPATCHES]: { status: 403, json: { message: 'Resource not accessible by integration' } } });
      t('a 403 (the token was minted without actions write) is a FAILED action, exit 5, naming the platform\'s sentence', [noGrant.exit, noGrant.rows[0]?.result.includes('Resource not accessible by integration')], [EXIT_ACTION_FAILED, true]);
      const offList = await run(base([{ op: 'workflow_dispatch', workflow: 'release.yml', ref: 'main' }]), allowed);
      t('the validator is the executor\'s gate too: an off-list workflow is refused here with ZERO writes, exit 2', [offList.exit, writes(offList.seen).length], [EXIT_REFUSED, 0]);
    }

    // ── the release.yml refresh ─────────────────────────────────────────────
    battery('the release.yml refresh: ONE POST to its dispatch endpoint carrying { ref: main, inputs: { refresh_version_pr: "true" } } under the App token, landing as accepted; force, false, absent, a string or any other input refused with ZERO requests, exit 2');
    {
      const FILE = 'release.yml';
      const DISPATCHES = `POST /repos/${REPO}/actions/workflows/${FILE}/dispatches`;
      const refresh = (inputs) => base([{ op: 'workflow_dispatch', workflow: FILE, ref: 'main', ...(inputs === undefined ? {} : { inputs }) }]);
      const ok = await run(refresh({ refresh_version_pr: true }), { ...allowed, [DISPATCHES]: { status: 204, json: null } }, { file: paceFile });
      t('the one write is the dispatch call on release.yml with { ref: main, inputs: { refresh_version_pr: "true" } } — the string the platform was measured to take — exit 0', [ok.exit, writes(ok.seen).map((s) => [s.call, s.body])], [EXIT_OK, [[DISPATCHES, { ref: 'main', inputs: { refresh_version_pr: 'true' } }]]]);
      t('…under the App token, after the sender gate on the ONE repository the stroke names', [ok.seen.map((s) => s.call), ok.seen.every((s) => s.auth === `Bearer ${TOKEN}`)], [[PERM, DISPATCHES], true]);
      t('…a bodiless 204 lands as accepted, its summary row naming release.yml\'s dispatch endpoint', [ok.rows[0]?.status, ok.rows[0]?.result, ok.summary.includes(`| 1 | \`workflow_dispatch\` | \`${DISPATCHES}\` | 204 | accepted (HTTP 204, no body) |`)], [204, 'accepted (HTTP 204, no body)', true], ok.summary);
      t('⛔ no other actions/* request leaves and no annotation is emitted', [ok.seen.filter((s) => s.call.includes('/actions/') && s.call !== DISPATCHES), ok.annotations], [[], []]);
      // Every refusal: exit 2 before the sender gate, so ZERO requests of any kind — and the log names the input.
      const refused = async (inputs, needle) => {
        const r = await run(refresh(inputs), { ...allowed, [DISPATCHES]: { status: 204, json: null } });
        return [r.exit, r.seen.length, r.logs.some((l) => l.includes('REFUSED') && l.includes(needle))];
      };
      t('⛔ absent inputs — the publish-repair lane — are refused with zero requests, exit 2, the log naming the one object the relay sends', await refused(undefined, 'actions[0].inputs is required when workflow is "release.yml"'), [EXIT_REFUSED, 0, true]);
      t('⛔ refresh_version_pr false is refused with zero requests, exit 2', await refused({ refresh_version_pr: false }, 'actions[0].inputs.refresh_version_pr must be true'), [EXIT_REFUSED, 0, true]);
      t('⛔ force beside the refresh — true or false — is refused with zero requests, exit 2', [await refused({ refresh_version_pr: true, force: true }, 'actions[0].inputs.force is not an input'), await refused({ refresh_version_pr: true, force: false }, 'actions[0].inputs.force is not an input')], [[EXIT_REFUSED, 0, true], [EXIT_REFUSED, 0, true]]);
      t('⛔ force alone, any other input, and the string "true" are each refused with zero requests, exit 2', [await refused({ force: true }, 'actions[0].inputs.force is not an input'), await refused({ refresh_version_pr: true, dry_run: true }, 'actions[0].inputs.dry_run is not an input'), await refused({ refresh_version_pr: 'true' }, 'must be a JSON boolean')], [[EXIT_REFUSED, 0, true], [EXIT_REFUSED, 0, true], [EXIT_REFUSED, 0, true]]);
      const shard = await run(base([{ op: 'workflow_dispatch', workflow: 'shard-timings-refresh.yml', ref: 'main', inputs: { refresh_version_pr: true } }]), allowed);
      t('⛔ the release entry\'s inputs on the shard-timings refresh — a file whose entry is null — are refused with zero requests, exit 2', [shard.exit, shard.seen.length], [EXIT_REFUSED, 0]);
    }

    // ── the failed-jobs re-run ──────────────────────────────────────────────
    battery("the run_rerun_failed: the five fences judged HERE on the run and its pull, read immediately before ONE bodiless POST — the pull's current head by its own GET, never the run's embedded copy, and a run naming no pull refused by name; each refused with the POST not sent and accepted on the measured run; a run, pull, baseline or fence that fails is zero writes; the 201 confirmed only by reading attempt 2 back with its failed jobs queued or in progress, naming their job ids; attempt 2 never seen, a failed job completed, or a job list unread is FAILED; no annotation");
    {
      const RUN = 39713789453;
      const PULL = 25155;
      const HEAD = '25b3a6c4bff905d462d4ff44030e5465c342254a';
      const MOVED = '9f0e1d2c3b4a59687766554433221100ffeeddcc';
      const RUN_GET = `GET /repos/${REPO}/actions/runs/${RUN}`;
      const PULL_GET = `GET /repos/${REPO}/pulls/${PULL}`;
      const A1 = `GET /repos/${REPO}/actions/runs/${RUN}/attempts/1/jobs`;
      const A2 = `GET /repos/${REPO}/actions/runs/${RUN}/attempts/2/jobs`;
      const RERUN = `POST /repos/${REPO}/actions/runs/${RUN}/rerun-failed-jobs`;
      // The measured run (39713789453): attempt 1 failed in one shard and the aggregate that needs it; attempt 2 listed the
      // shard queued at once, the passed shards completed (carried over), and the aggregate only when its need finished.
      // It ran on pull #25155's head, and the run EMBEDS a copy of that pull — which the head fence never reads.
      const runAt = (patch = {}) => ({ status: 200, json: { id: RUN, name: 'CI', path: '.github/workflows/ci.yml', event: 'pull_request', run_attempt: 1, status: 'completed', conclusion: 'failure', head_sha: HEAD, pull_requests: [{ number: PULL, head: { sha: HEAD } }], ...patch } });
      const pullAt = (sha = HEAD) => ({ status: 200, json: { number: PULL, state: 'open', head: { sha } } });
      const attempt2Run = runAt({ run_attempt: 2, status: 'queued', conclusion: null });
      const attempt1 = { status: 200, json: { total_count: 3, jobs: [
        { id: 119611140808, name: 'Test Core (3/6)', run_attempt: 1, status: 'completed', conclusion: 'failure' },
        { id: 119611140839, name: 'Test Core (1/6)', run_attempt: 1, status: 'completed', conclusion: 'success' },
        { id: 119617410962, name: 'Test Core', run_attempt: 1, status: 'completed', conclusion: 'failure' },
      ] } };
      const attempt2 = (status = 'queued') => ({ status: 200, json: { total_count: 2, jobs: [
        { id: 119642047246, name: 'Test Core (3/6)', run_attempt: 2, status, conclusion: status === 'completed' ? 'failure' : null },
        { id: 119642048282, name: 'Test Core (1/6)', run_attempt: 2, status: 'completed', conclusion: 'success' },
      ] } });
      let clock = 0;
      const timing = { sleep: async (ms) => { clock += ms; }, now: () => clock };
      const stroke = base([{ op: 'run_rerun_failed', run_id: RUN }]);
      const happy = { ...allowed, [A1]: attempt1, [RUN_GET]: [runAt(), attempt2Run], [PULL_GET]: pullAt(), [RERUN]: { status: 201, json: {} }, [A2]: attempt2() };
      const LANDED = 'attempt 2 · re-run: `Test Core (3/6)` job 119642047246 queued · not listed yet: `Test Core` (a job is listed when its needs finish)';

      clock = 0;
      // Its own pace log, never the shared one: the shared log's later cases spend write-pace's hourly budget for the
      // fixture token exactly (measured: one more write there refuses the annotations battery's third write, exit 10).
      const ok = await run(stroke, happy, timing);
      t('⭐ the measured run passes every fence: the sender gate, attempt 1\'s jobs (the baseline), the run and then its pull — by the pull\'s own GET, the two reads immediately before the POST — then ONE POST, then the run and attempt 2\'s jobs read back; exit 0', [ok.exit, ok.seen.map((s) => s.call)], [EXIT_OK, [PERM, A1, RUN_GET, PULL_GET, RERUN, RUN_GET, A2]], ok.logs.join(' | '));
      t('…the one write is that POST with NO body, under the App token like every request', [writes(ok.seen).map((s) => [s.call, s.body]), ok.seen.every((s) => s.auth === `Bearer ${TOKEN}`)], [[[RERUN, null]], true]);
      t('…the 201 is confirmed by the read-back: the row names attempt 2, the failed shard\'s new job id queued, and the aggregate not listed yet', [ok.rows[0]?.status, ok.rows[0]?.result, ok.summary.includes(`| 1 | \`run_rerun_failed\` | \`${RERUN}\` | 201 | ${LANDED} |`)], [201, LANDED, true], ok.summary);
      t('…no other actions/* write leaves, and no annotation is emitted', [ok.seen.filter((s) => s.call.includes('/actions/') && !s.call.startsWith('GET ') && s.call !== RERUN), ok.annotations, ok.logs.filter((l) => l.startsWith('::'))], [[], [], []]);
      // Each fence, refused at execute time: the run (or its pull) changed between the seat's request and this run — the POST is NOT SENT.
      const fenced = async (patch, answers = {}) => {
        const r = await run(stroke, { ...happy, [RUN_GET]: runAt(patch), ...answers });
        return [r.exit, writes(r.seen).length, r.seen.at(-1)?.call, r.rows[0]?.call, r.rows[0]?.status, /REFUSED at the relay's fence/.test(r.rows[0]?.result ?? '')];
      };
      const refusedRow = [EXIT_ACTION_FAILED, 0, PULL_GET, RERUN, 'not sent', true];
      t('⛔ fence workflow, refused HERE: a run of another workflow — zero writes, the POST row not sent, the pull read the last request', [await fenced({ path: '.github/workflows/lint.yml' }), (await run(stroke, { ...happy, [RUN_GET]: runAt({ path: '.github/workflows/lint.yml' }) })).rows[0]?.result.includes('fence `workflow`: the run reads ".github/workflows/lint.yml"')], [refusedRow, true]);
      t('⛔ fence event, refused HERE: a push run — zero writes, the POST not sent, the event fence named', [await fenced({ event: 'push' }), (await run(stroke, { ...happy, [RUN_GET]: runAt({ event: 'push' }) })).rows[0]?.result.includes('fence `event`: the run reads "push"')], [refusedRow, true]);
      t('⛔ fence once, refused HERE: a run a person re-ran meanwhile (attempt 2) — zero writes, the POST not sent, the once fence named', [await fenced({ run_attempt: 2 }), (await run(stroke, { ...happy, [RUN_GET]: runAt({ run_attempt: 2 }) })).rows[0]?.result.includes('fence `once`: the run reads 2')], [refusedRow, true]);
      t('⛔ fence failed, refused HERE: a run that concluded success, and one still in progress — zero writes, the POST not sent, the failed fence named', [await fenced({ conclusion: 'success' }), await fenced({ status: 'in_progress', conclusion: null })], [refusedRow, refusedRow]);
      // The head fence: the pull's CURRENT head, by the pull's own GET — accepted on the happy path above (head_sha equal to it).
      const stale = await run(stroke, { ...happy, [PULL_GET]: pullAt(MOVED) });
      t('⛔ fence head, refused HERE: the pull was pushed to since the run (a stale head) — zero writes, the POST not sent, the pull read the last request, the head fence naming both heads', [await fenced({}, { [PULL_GET]: pullAt(MOVED) }), stale.rows[0]?.result.includes('fence `head`: the run reads "head_sha 25b3a6c4bf, and pull #25155\'s own GET answers #25155 at head 9f0e1d2c3b"')], [refusedRow, true], stale.rows[0]?.result);
      t("⛔ …the run's embedded copy of the pull is never trusted: it agrees with the run's head_sha, and the pull's own answer still refuses", [stale.seen.filter((s) => s.call === PULL_GET).length, runAt().json.pull_requests[0].head.sha === HEAD, writes(stale.seen).length], [1, true, 0]);
      const fork = [];
      for (const r of [runAt({ pull_requests: [] }), runAt({ pull_requests: undefined })]) fork.push(await run(stroke, { ...happy, [RUN_GET]: r }));
      t("⛔ fence head, refused HERE: a run naming no pull request — pull_requests empty (a fork pull request's run) or absent — zero writes, NO pull read, the POST not sent, the head fence named", fork.map((r) => [r.exit, writes(r.seen).length, r.seen.some((s) => s.call.startsWith(`GET /repos/${REPO}/pulls/`)), r.rows[0]?.status, r.rows[0]?.result.includes('fence `head`: the run reads "no pull_requests entry')]), [[EXIT_ACTION_FAILED, 0, false, 'not sent', true], [EXIT_ACTION_FAILED, 0, false, 'not sent', true]]);
      const pullUnread = await run(stroke, { ...happy, [PULL_GET]: { status: 404, json: { message: 'Not Found' } } });
      t('⛔ a pull that cannot be read leaves the head fence unjudged: zero writes, the POST not sent, the read named', [pullUnread.exit, writes(pullUnread.seen).length, pullUnread.rows[0]?.status, pullUnread.rows[0]?.result.includes('pull #25155, the run\'s pull request, could not be read, so the head fence was not judged')], [EXIT_ACTION_FAILED, 0, 'not sent', true], pullUnread.rows[0]?.result);
      const unread = await run(stroke, { ...happy, [RUN_GET]: { status: 404, json: { message: 'Not Found' } } });
      t('⛔ a run that cannot be read is never judged: zero writes, the POST not sent, the read named', [unread.exit, writes(unread.seen).length, unread.rows[0]?.status, unread.rows[0]?.result.includes('the run could not be read')], [EXIT_ACTION_FAILED, 0, 'not sent', true]);
      const noBase = await run(stroke, { ...happy, [A1]: { status: 403, json: { message: 'Resource not accessible by integration' } } });
      t('⛔ a baseline that cannot be read: zero writes — a POST whose read-back has nothing to confirm is never sent', [noBase.exit, writes(noBase.seen).length, noBase.rows[0]?.result.includes("attempt 1's job list could not be read")], [EXIT_ACTION_FAILED, 0, true]);
      const allPassed = await run(stroke, { ...happy, [A1]: { status: 200, json: { total_count: 1, jobs: [{ id: 1, name: 'Test Core (1/6)', run_attempt: 1, status: 'completed', conclusion: 'success' }] } } });
      t('⛔ a baseline with no failed job: zero writes, the row saying the read-back would have nothing to confirm', [allPassed.exit, writes(allPassed.seen).length, allPassed.rows[0]?.result.includes('none concluded failure')], [EXIT_ACTION_FAILED, 0, true]);
      const denied = await run(stroke, { ...happy, [RERUN]: { status: 403, json: { message: 'Resource not accessible by integration' } } });
      t('a 403 on the POST (the token minted without actions write) is a FAILED action with the platform\'s sentence, and nothing is read back after it', [denied.exit, denied.rows[0]?.status, denied.rows[0]?.result.includes('Resource not accessible by integration'), denied.seen.some((s) => s.call === A2)], [EXIT_ACTION_FAILED, 403, true, false]);
      clock = 0;
      const never = await run(stroke, { ...happy, [RUN_GET]: [runAt(), runAt()] }, timing);
      t('⛔ a read-back that never sees attempt 2 is a FAILED action — UNCONFIRMED, naming the attempt it read and never to re-send — after the window, polled at the interval', [never.exit, never.rows[0]?.status, ['UNCONFIRMED', 'run_attempt 1, not 2', 'do not re-send', 'once fence'].every((s) => never.rows[0]?.result.includes(s)), clock, never.seen.filter((s) => s.call === RUN_GET).length], [EXIT_ACTION_FAILED, 201, true, RERUN_FAILED_WINDOW_MS, 1 + RERUN_FAILED_WINDOW_MS / RERUN_FAILED_POLL_MS + 1], never.rows[0]?.result);
      clock = 0;
      const late = await run(stroke, { ...happy, [RUN_GET]: [runAt(), runAt(), runAt(), attempt2Run] }, timing);
      t('a new attempt the platform shows on a later read lands, read again at the interval until it does', [late.exit, late.rows[0]?.result, clock], [EXIT_OK, LANDED, 2 * RERUN_FAILED_POLL_MS]);
      const completed = await run(stroke, { ...happy, [A2]: attempt2('completed') }, timing);
      t('⛔ a failed job listed completed in attempt 2 was not re-run as asked: a FAILED action at once, naming the job', [completed.exit, completed.rows[0]?.result.includes('`Test Core (3/6)` (job 119642047246) completed failure'), completed.seen.filter((s) => s.call === A2).length], [EXIT_ACTION_FAILED, true, 1]);
      clock = 0;
      const blind = await run(stroke, { ...happy, [A2]: { status: 502, json: { message: 'Bad Gateway' } } }, timing);
      t('⛔ an attempt-2 job list that never answers is a FAILED action, UNCONFIRMED, naming the read', [blind.exit, blind.rows[0]?.result.includes("attempt 2's job list could not be read"), blind.rows[0]?.result.includes('UNCONFIRMED')], [EXIT_ACTION_FAILED, true, true]);
      const beside = await run(base([{ op: 'run_rerun_failed', run_id: RUN }, { op: 'comment', issue: 1, body: 'x' }]), happy);
      const stringId = await run(base([{ op: 'run_rerun_failed', run_id: String(RUN) }]), happy);
      t('⛔ the validator is the executor\'s gate too: beside another action, or with run_id a string, refused with ZERO requests, exit 2', [[beside.exit, beside.seen.length], [stringId.exit, stringId.seen.length]], [[EXIT_REFUSED, 0], [EXIT_REFUSED, 0]]);
    }

    // ── the hierarchy link ──────────────────────────────────────────────────
    battery("the hierarchy link: sub_issue_add and sub_issue_remove read the parent's and the child's own answers, then the child's parent (add) or the parent's whole list (remove), immediately before ONE write whose body is the child's REST id from its own answer — never its number, never replace_parent; a pull, a transferred or unread card, a child under another parent, one the parent does not list, or a read that is neither answer is zero writes; a child already under this parent is a no-op landed on the list; the answer confirmed only when the parent's list reads the child back (or no longer does) inside the window; a refused write, a list that never settles or never reads whole is FAILED; no annotation, and the rows ride a stroke beside other ops");
    {
      // The measured shapes (2026-10-29, read-only): #26709 answered to #27293 by REST id 6060227467; #26702 is a sibling.
      const PARENT = 27293;
      const CHILD = 26709;
      const CHILD_ID = 6060227467;
      const SIBLING_ID = 6060051871;
      const at = (repo = REPO) => `https://api.github.com/repos/${repo}`;
      const cardOf = (number, id, extra = {}) => ({ status: 200, json: { id, number, repository_url: at(), ...extra } });
      const P_GET = `GET /repos/${REPO}/issues/${PARENT}`;
      const C_GET = `GET /repos/${REPO}/issues/${CHILD}`;
      const C_PARENT = `GET /repos/${REPO}/issues/${CHILD}/parent`;
      const LIST = `GET /repos/${REPO}/issues/${PARENT}/sub_issues`;
      const ADD = `POST /repos/${REPO}/issues/${PARENT}/sub_issues`;
      const REMOVE = `DELETE /repos/${REPO}/issues/${PARENT}/sub_issue`;
      const NO_PARENT = { status: 404, json: { message: 'No parent issue found' } };
      const listOf = (...ids) => ({ status: 200, json: ids.map((id) => ({ id, number: id === CHILD_ID ? CHILD : 1 })) });
      const parentAnswer = { status: 201, json: { id: 6081407279, number: PARENT, html_url: `https://github.test/${REPO}/issues/${PARENT}` } };
      const cards = { ...allowed, [P_GET]: cardOf(PARENT, 6081407279), [C_GET]: cardOf(CHILD, CHILD_ID) };
      const addHappy = { ...cards, [C_PARENT]: NO_PARENT, [ADD]: parentAnswer, [LIST]: listOf(SIBLING_ID, CHILD_ID) };
      const removeHappy = { ...cards, [LIST]: [listOf(SIBLING_ID, CHILD_ID), listOf(SIBLING_ID)], [REMOVE]: { status: 200, json: { id: 6081407279, number: PARENT } } };
      const addStroke = base([{ op: 'sub_issue_add', issue: PARENT, sub_issue: CHILD }]);
      const removeStroke = base([{ op: 'sub_issue_remove', issue: PARENT, sub_issue: CHILD }]);
      let clock = 0;
      const timing = { sleep: async (ms) => { clock += ms; }, now: () => clock };
      const notSent = (r) => [r.exit, writes(r.seen).length, r.rows[0]?.call, r.rows[0]?.status, /REFUSED at the relay's fence/.test(r.rows[0]?.result ?? '')];
      const refusedRow = (write) => [EXIT_ACTION_FAILED, 0, write, 'not sent', true];

      const added = await run(addStroke, addHappy, timing);
      t("⭐ add: the sender gate, the parent's and the child's own answers, the child's parent read, then ONE POST, then the parent's list read back — exit 0", [added.exit, added.seen.map((s) => s.call)], [EXIT_OK, [PERM, P_GET, C_GET, C_PARENT, ADD, LIST]], added.logs.join(' | '));
      t("…the one write's body is exactly { sub_issue_id } — the child's REST id from its own answer, never its number, never replace_parent — under the App token like every request", [writes(added.seen).map((s) => [s.call, s.body]), added.seen.every((s) => s.auth === `Bearer ${TOKEN}`)], [[[ADD, { sub_issue_id: CHILD_ID }]], true]);
      const ADDED = `#${CHILD} (id ${CHILD_ID}) is a sub-issue of #${PARENT} · its list reads 2 sub-issue(s)`;
      t('…the 201 is confirmed by the read-back: the row names the link as the list reads it, the summary row carries it, and no annotation is emitted', [added.rows[0]?.status, added.rows[0]?.result, added.summary.includes(`| 1 | \`sub_issue_add\` | \`${ADD}\` | 201 | ${ADDED} |`), added.annotations, added.logs.filter((l) => l.startsWith('::'))], [201, ADDED, true, [], []], added.summary);
      const removed = await run(removeStroke, removeHappy, timing);
      t("⭐ remove: the two answers, the parent's whole list (the fence), ONE DELETE carrying { sub_issue_id }, then the list read back without the child — exit 0", [removed.exit, removed.seen.map((s) => s.call), writes(removed.seen).map((s) => s.body), removed.rows[0]?.result], [EXIT_OK, [PERM, P_GET, C_GET, LIST, REMOVE, LIST], [{ sub_issue_id: CHILD_ID }], `#${CHILD} (id ${CHILD_ID}) is no longer a sub-issue of #${PARENT} · its list reads 1 sub-issue(s)`], removed.logs.join(' | '));
      // The fences, refused at execute time: the board changed between the seat's request and this run — the write is NOT SENT.
      const ELSEWHERE = { status: 200, json: { id: 1, number: 27000, repository_url: at() } };
      const other = await run(addStroke, { ...addHappy, [C_PARENT]: ELSEWHERE });
      t('⛔ fence free, refused HERE: a child already under ANOTHER parent — zero writes, the POST row not sent, the other parent named and the move refused', [notSent(other), other.rows[0]?.result.includes(`#${CHILD} is already a sub-issue of ${REPO}#27000`) && other.rows[0]?.result.includes('never moves it')], [refusedRow(ADD), true], other.rows[0]?.result);
      const unlisted = await run(removeStroke, { ...removeHappy, [LIST]: listOf(SIBLING_ID) });
      t('⛔ fence listed, refused HERE: a remove of a child the parent does not list — zero writes, the DELETE row not sent, never a blind DELETE', [notSent(unlisted), unlisted.rows[0]?.result.includes(`does not list #${CHILD} (id ${CHILD_ID})`)], [refusedRow(REMOVE), true], unlisted.rows[0]?.result);
      const pullParent = await run(addStroke, { ...addHappy, [P_GET]: cardOf(PARENT, 6081407279, { pull_request: { url: 'x' } }) });
      const movedChild = await run(addStroke, { ...addHappy, [C_GET]: cardOf(CHILD, CHILD_ID, { repository_url: at('objectstack-ai/cloud') }) });
      t("⛔ fence parent and child, refused HERE: a parent that is a pull request, a child transferred away — zero writes, and the link's own read (the child's parent) never taken", [notSent(pullParent), notSent(movedChild), [...pullParent.seen, ...movedChild.seen].some((s) => s.call === C_PARENT), pullParent.rows[0]?.result.includes('is a pull request'), movedChild.rows[0]?.result.includes('— transferred')], [refusedRow(ADD), refusedRow(ADD), false, true, true]);
      const unreadChild = await run(removeStroke, { ...removeHappy, [C_GET]: { status: 404, json: { message: 'Not Found' } } });
      t("⛔ an unread child is never judged: zero writes, the parent's list never read, both the child and the unjudged listing named", [notSent(unreadChild), unreadChild.seen.some((s) => s.call === LIST), ['fence `child`', 'fence `listed`'].every((n) => unreadChild.rows[0]?.result.includes(n))], [refusedRow(REMOVE), false, true], unreadChild.rows[0]?.result);
      const blindParent = await run(addStroke, { ...addHappy, [C_PARENT]: { status: 503, json: { message: 'down' } } });
      t("⛔ a child's parent read that answers neither a parent nor 404 is never read as free: zero writes, the status named", [notSent(blindParent), blindParent.rows[0]?.result.includes('answered HTTP 503 (down), neither a parent nor 404')], [refusedRow(ADD), true]);
      const truncated = await run(removeStroke, { ...removeHappy, [LIST]: { status: 200, json: Array.from({ length: SUB_ISSUE_LIST_PAGE_SIZE }, (_, k) => ({ id: CHILD_ID + 1 + k })) } });
      t("⛔ a parent's list past its page cap is a SUBSET, never read as listed or absent: the remove is refused, zero writes, every page walked", [notSent(truncated), truncated.rows[0]?.result.includes('a truncated list is a SUBSET'), truncated.seen.filter((s) => s.call === LIST).length], [refusedRow(REMOVE), true, SUB_ISSUE_LIST_PAGE_CAP]);
      // The no-op: the child already answers to THIS parent.
      const HERE = { status: 200, json: { id: 6081407279, number: PARENT, repository_url: at() } };
      const noop = await run(addStroke, { ...addHappy, [C_PARENT]: HERE }, timing);
      t('an add whose child already answers to THIS parent sends NOTHING: zero writes, exit 0, the row not sent and saying no-op — landed only because the list read it back', [noop.exit, writes(noop.seen).length, noop.seen.at(-1)?.call, noop.rows[0]?.status, noop.rows[0]?.result.startsWith('no-op, nothing sent: ')], [EXIT_OK, 0, LIST, 'not sent', true], noop.rows[0]?.result);
      clock = 0;
      const split = await run(addStroke, { ...addHappy, [C_PARENT]: HERE, [LIST]: listOf(SIBLING_ID) }, timing);
      t("⛔ …but a no-op the list does not read back is FAILED after the window — the two reads disagree — still with zero writes", [split.exit, writes(split.seen).length, split.rows[0]?.result.includes('the two reads disagree'), clock], [EXIT_ACTION_FAILED, 0, true, SUB_ISSUE_WINDOW_MS]);
      // The write's answer, and the read-back that confirms it.
      const refused = await run(addStroke, { ...addHappy, [ADD]: { status: 422, json: { message: 'Validation Failed' } } });
      t("a 422 on the POST is a FAILED action with the platform's sentence, and nothing is read back after it", [refused.exit, refused.rows[0]?.status, refused.rows[0]?.result.includes('Validation Failed'), refused.seen.some((s) => s.call === LIST)], [EXIT_ACTION_FAILED, 422, true, false]);
      clock = 0;
      const never = await run(addStroke, { ...addHappy, [LIST]: listOf(SIBLING_ID) }, timing);
      t("⛔ a read-back that never lists the child is a FAILED action — UNCONFIRMED, naming the id and never to re-send — after the window, polled at the interval", [never.exit, never.rows[0]?.status, ['UNCONFIRMED', `does not list the child's id ${CHILD_ID}`, 'do not re-send'].every((s) => never.rows[0]?.result.includes(s)), clock, never.seen.filter((s) => s.call === LIST).length], [EXIT_ACTION_FAILED, 201, true, SUB_ISSUE_WINDOW_MS, SUB_ISSUE_WINDOW_MS / SUB_ISSUE_POLL_MS + 1], never.rows[0]?.result);
      clock = 0;
      const late = await run(addStroke, { ...addHappy, [LIST]: [listOf(SIBLING_ID), listOf(SIBLING_ID), listOf(SIBLING_ID, CHILD_ID)] }, timing);
      t('a link the list shows on a later read lands, read again at the interval until it does', [late.exit, late.rows[0]?.result, clock], [EXIT_OK, ADDED, 2 * SUB_ISSUE_POLL_MS]);
      clock = 0;
      const stuck = await run(removeStroke, { ...removeHappy, [LIST]: listOf(SIBLING_ID, CHILD_ID) }, timing);
      t('⛔ a remove whose list still lists the child after the window is FAILED, UNCONFIRMED, naming the id', [stuck.exit, stuck.rows[0]?.result.includes(`still lists the child's id ${CHILD_ID}`), stuck.rows[0]?.result.includes('UNCONFIRMED')], [EXIT_ACTION_FAILED, true, true]);
      clock = 0;
      const blind = await run(addStroke, { ...addHappy, [LIST]: [listOf(SIBLING_ID), { status: 502, json: { message: 'Bad Gateway' } }] }, timing);
      t("⛔ a read-back list that stops answering is FAILED, UNCONFIRMED, naming the read", [blind.exit, blind.rows[0]?.result.includes("sub-issue list could not be read"), blind.rows[0]?.result.includes('UNCONFIRMED')], [EXIT_ACTION_FAILED, true, true]);
      const paged = await run(addStroke, { ...addHappy, [LIST]: [{ status: 200, json: Array.from({ length: SUB_ISSUE_LIST_PAGE_SIZE }, (_, k) => ({ id: k + 1 })) }, listOf(CHILD_ID)] }, timing);
      t("the list is walked page by page: a child on page 2 of a full page 1 is read back, the row counting every entry", [paged.exit, paged.seen.filter((s) => s.call === LIST).length, paged.rows[0]?.result], [EXIT_OK, 2, `#${CHILD} (id ${CHILD_ID}) is a sub-issue of #${PARENT} · its list reads ${SUB_ISSUE_LIST_PAGE_SIZE + 1} sub-issue(s)`]);
      // The stroke: the rows ride beside other issue ops — no alone — and the validator is the executor's gate too.
      const mixed = await run(base([{ op: 'comment', issue: PARENT, body: 'x' }, { op: 'sub_issue_add', issue: PARENT, sub_issue: CHILD }]), { ...addHappy, [`POST /repos/${REPO}/issues/${PARENT}/comments`]: { status: 201, json: { id: 9 } } }, timing);
      t('beside a comment in one stroke both land, in order — the rows spend the literal issues grant and travel with the other issue ops', [mixed.exit, writes(mixed.seen).map((s) => s.call)], [EXIT_OK, [`POST /repos/${REPO}/issues/${PARENT}/comments`, ADD]]);
      const self = await run(base([{ op: 'sub_issue_add', issue: PARENT, sub_issue: PARENT }]), addHappy);
      const widened = await run(base([{ op: 'sub_issue_add', issue: PARENT, sub_issue: CHILD, replace_parent: true }]), addHappy);
      const byId = await run(base([{ op: 'sub_issue_remove', issue: PARENT, sub_issue: String(CHILD) }]), removeHappy);
      t("⛔ the validator is the executor's gate too: an issue as its own sub-issue, a replace_parent flag, or the child as a string — refused with ZERO requests, exit 2", [[self.exit, self.seen.length], [widened.exit, widened.seen.length], [byId.exit, byId.seen.length]], [[EXIT_REFUSED, 0], [EXIT_REFUSED, 0], [EXIT_REFUSED, 0]]);
    }

    // ── the summary ─────────────────────────────────────────────────────────
    battery('the summary: request, sender and role, session, target, one row per request');
    {
      const ok = await run(base([{ op: 'comment', issue: 1, body: 'a' }, { op: 'labels_remove', issue: 1, labels: ['x', 'y'] }]), {
        ...allowed,
        [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1, html_url: 'https://github.test/c/1' } },
        [`DELETE /repos/${REPO}/issues/1/labels/x`]: { status: 200, json: [] },
        [`DELETE /repos/${REPO}/issues/1/labels/y`]: { status: 200, json: [] },
      }, { file: paceFile });
      t('the header names the request id, sender with role, session and target', ok.summary.includes('fleet-write `fw-test-1`') && ok.summary.includes('`os-support-ai` (write)') && ok.summary.includes('session_01ABCDEFGHJKMNPQRSTVWXYZ') && ok.summary.includes(`\`${REPO}\``));
      t('one row per REQUEST — two labels are two rows under one action', ok.summary.split('\n').filter((l) => l.startsWith('| 2 |')).length, 2);
      t('each row carries op, endpoint, status and result', ok.summary.includes(`| 1 | \`comment\` | \`POST /repos/${REPO}/issues/1/comments\` | 201 | id 1 https://github.test/c/1 |`));
      t('the last line counts what landed', ok.summary.trim().endsWith('✓ 3 request(s) landed, every action done.'));
      t('a refusal summary says zero writes', summaryText({ payload: base([]), sender: 's', rows: [], refusal: 'x' }).includes('zero writes'));
    }

    // ── redaction ───────────────────────────────────────────────────────────
    battery('redaction: the token reaches no summary line, log line or error');
    {
      const echo = await run(base([{ op: 'comment', issue: 1, body: 'a' }]), {
        ...allowed,
        [`POST /repos/${REPO}/issues/1/comments`]: { status: 401, json: { message: `Bad credentials for ${TOKEN}` } },
      });
      const everything = [echo.summary, ...echo.logs, ...echo.rows.map((r) => r.result)].join('\n');
      t('⛔ a platform sentence that echoed the token is scrubbed everywhere it lands', everything.includes(TOKEN), false, everything.slice(0, 300));
      t('…and the scrubbed spelling is what appears instead', everything.includes('<redacted>'));
      const thrown = await run(base([{ op: 'comment', issue: 1, body: 'a' }]), { ...allowed, [`POST /repos/${REPO}/issues/1/comments`]: { throws: `socket hung up sending ${TOKEN}` } });
      t('a transport error that echoed the token is scrubbed too', [thrown.summary, ...thrown.logs].join('\n').includes(TOKEN), false);
    }

    // ── the batch gap on the runner ─────────────────────────────────────────
    battery("the batch gap on the runner: a stroke carrying DEFAULT_BATCH_THRESHOLD or more content-creating actions is announced as ONE rule ⑤ batch before its first write — on an injected clock every write through the last content-creating one leaves a full DEFAULT_BATCH_GAP_MS after the one before, and the pacing is exactly what the seat budgets; below the threshold, after the batch and on a landing stroke rule ①'s gap; a stroke the job cannot hold refused with ZERO requests; an announcement the log cannot record refused before the first write");
    {
      const { DEFAULT_BATCH_GAP_MS, DEFAULT_BATCH_THRESHOLD, DEFAULT_MIN_GAP_MS } = await import('../write-pace.mjs');
      const UI = 'objectstack-ai/objectui';
      const PERM_UI = `GET /repos/${UI}/collaborators/os-support-ai/permission`;
      const created = { [PERM_UI]: allowed[PERM], [`POST /repos/${UI}/issues`]: { status: 201, json: { number: 13122, html_url: `https://github.test/${UI}/issues/13122` } }, [`POST /repos/${UI}/issues/13122/labels`]: { status: 200, json: [{ name: 'x' }] } };
      const cards = (n) => Array.from({ length: n }, (_, i) => ({ op: 'issue_create', title: `Card ${i + 1}`, body: 'B' }));
      // The runner's throttle at its DEFAULTS, on a clock that moves only when the throttle sleeps — every request is stamped with it.
      const clocked = async (actions, { file = join(dir, `batch-${paceCase++}.jsonl`), repo = UI, answers = created } = {}) => {
        let nowMs = Date.UTC(2026, 9, 20, 4, 27, 43);
        const paceLines = [];
        const stamps = [];
        const inner = platform(answers, []);
        const logs = [];
        const pace = {
          file,
          env: {},
          now: () => nowMs,
          sleep: async (ms) => {
            nowMs += ms;
          },
          sleepSync: (ms) => {
            nowMs += ms;
          },
          log: (l) => paceLines.push(l),
          exit: (code) => {
            throw Object.assign(new Error(`throttle refused with exit ${code}`), { throttleExit: code });
          },
        };
        const fetchImpl = async (url, init) => {
          stamps.push({ call: `${init?.method ?? 'GET'} ${new URL(url).pathname}`, at: nowMs });
          return inner(url, init);
        };
        let r;
        try {
          r = await executeFleetWrite({ payload: { ...base(actions), repo }, sender: 'os-support-ai', token: TOKEN }, { fetch: fetchImpl, pace, log: (l) => logs.push(l) });
        } catch (e) {
          if (e?.throttleExit === undefined) throw e;
          r = { exit: e.throttleExit, rows: [], summary: '', lines: [], throttled: true };
        }
        const w = stamps.filter((s) => !s.call.startsWith('GET '));
        return { ...r, stamps, writes: w, gaps: w.slice(1).map((s, i) => s.at - w[i].at), logs, paceLines, file };
      };

      const five = await clocked(cards(DEFAULT_BATCH_THRESHOLD));
      t(
        `⛔ THE PIN: ${DEFAULT_BATCH_THRESHOLD} issue_create actions in one stroke — every write leaves at least ${DEFAULT_BATCH_GAP_MS} ms after the one before (injected clock)`,
        [five.exit, five.writes.length, five.gaps.length, five.gaps.every((g) => g >= DEFAULT_BATCH_GAP_MS)],
        [EXIT_OK, DEFAULT_BATCH_THRESHOLD, DEFAULT_BATCH_THRESHOLD - 1, true],
        `gaps ${JSON.stringify(five.gaps)}`,
      );
      t("…and the pacing the runner pays is exactly the pacing the seat budgets for (strokePacing — the packer's refusal and the run-poller's wait)", five.gaps.reduce((a, b) => a + b, 0), strokePacing(base(cards(DEFAULT_BATCH_THRESHOLD))).pacingMs);
      const announced = five.paceLines.findIndex((l) => l.includes(`batch of ${DEFAULT_BATCH_THRESHOLD} ${BATCH_KIND} item(s) announced`));
      const firstLanded = five.logs.findIndex((l) => l.startsWith('  ✓ action 1 '));
      const said = five.logs.findIndex((l) => l.includes('rule ⑤ —'));
      t('ONE announcement, recorded by write-pace itself under this kind, before the first write — and the transcript says it before the first landing', [five.paceLines.filter((l) => l.includes('announced for token key')).length, announced >= 0, said >= 0 && said < firstLanded, firstLanded > 0], [1, true, true, true]);
      t('…the summary names the pacing in one line, and the token reached neither the summary nor the pace log', [five.summary.includes(`- pacing: rule ⑤ — ${DEFAULT_BATCH_THRESHOLD} content-creating action(s)`), five.summary.includes(TOKEN), readReal(five.file, 'utf8').includes(TOKEN)], [true, false, false]);

      const four = await clocked(cards(DEFAULT_BATCH_THRESHOLD - 1));
      t(`one below the threshold: no announcement, rule ①'s ${DEFAULT_MIN_GAP_MS} ms gap — unchanged`, [four.exit, four.paceLines.some((l) => l.includes('announced')), four.gaps.every((g) => g === DEFAULT_MIN_GAP_MS), four.summary.includes('- pacing:')], [EXIT_OK, false, true, false], `gaps ${JSON.stringify(four.gaps)}`);

      const trailing = await clocked([...cards(DEFAULT_BATCH_THRESHOLD), { op: 'labels_add', issue: 13122, labels: ['x'] }, { op: 'labels_add', issue: 13122, labels: ['x'] }]);
      t(
        'the batch covers the writes THROUGH the last content-creating one; the writes after it keep rule ①\'s gap',
        [trailing.exit, trailing.gaps.slice(0, DEFAULT_BATCH_THRESHOLD - 1).every((g) => g >= DEFAULT_BATCH_GAP_MS), trailing.gaps.slice(DEFAULT_BATCH_THRESHOLD - 1)],
        [EXIT_OK, true, [DEFAULT_MIN_GAP_MS, DEFAULT_MIN_GAP_MS]],
        `gaps ${JSON.stringify(trailing.gaps)}`,
      );

      const landing = await clocked([{ op: 'pr_ready', pull: 12 }, { op: 'automerge_enable', pull: 12 }], {
        repo: REPO,
        answers: {
          ...allowed,
          [`GET /repos/${REPO}/pulls/12`]: { status: 200, json: { number: 12, node_id: 'PR_kwDO' } },
          // The governed-review follow-up after pr_ready reads the pull's files (its own battery); an ungoverned diff adds no write, so the gap reading is unchanged.
          [`GET /repos/${REPO}/pulls/12/files`]: { status: 200, json: [] },
          'POST /graphql': [
            { status: 200, json: { data: { markPullRequestReadyForReview: { pullRequest: { number: 12, isDraft: false } } } } },
            { status: 200, json: { data: { enablePullRequestAutoMerge: { pullRequest: { number: 12, autoMergeRequest: { enabledAt: 'now', mergeMethod: 'SQUASH' } } } } } },
          ],
        },
      });
      t('a landing stroke (pr_ready + automerge_enable) carries no content-creating action — no announcement, rule ①\'s gap', [landing.exit, landing.paceLines.some((l) => l.includes('announced')), landing.gaps], [EXIT_OK, false, [DEFAULT_MIN_GAP_MS]]);

      const over = strokePacing(base(cards(1))).maxBatchWrites + 1;
      const refused = await clocked(cards(over));
      t(
        `a stroke of ${over} content-creating actions — one batched write past what the job can hold — is exit 2 with ZERO requests, not even the permission read`,
        [refused.exit, refused.stamps.length, refused.summary.includes("over the relay job's budget") && refused.summary.includes('zero writes')],
        [EXIT_REFUSED, 0, true],
      );
      t('…and the refusal names the per-op doors and the announcement, never a shorter gap', refused.logs.some((l) => l.includes('REFUSED') && l.includes('scripts/pm/issue-create.mjs') && l.includes('--announce-batch N') && l.includes('Never a shorter gap')));

      writeFileSync(join(dir, 'not-a-directory'), 'x', 'utf8');
      const unrecordable = await clocked(cards(DEFAULT_BATCH_THRESHOLD), { file: join(dir, 'not-a-directory', 'pace.jsonl') });
      t('an announcement the pace log cannot record is exit 10 before the first write — the sender gate read, ZERO writes, the throttle\'s own refusal printed', [unrecordable.exit, unrecordable.stamps.map((s) => s.call), unrecordable.logs.some((l) => l.includes('REFUSED — the throttle cannot write its log'))], [EXIT_WRITE_PACE_REFUSED, [PERM_UI], true]);
    }

    // ── the wiring ──────────────────────────────────────────────────────────
    battery('the wiring: both halves around every write verb, on the roster');
    {
      const { WIRED_WRITE_TOOLS } = await import('../write-pace.mjs');
      const own = readReal(SELF_PATH, 'utf8');
      t('write-pace lists this file among the wired write tools', WIRED_WRITE_TOOLS.includes('scripts/pm/fleet-write/execute.mjs'));
      t('this file calls both halves, guarded by the write-verb predicate', own.includes('paceWrite(') && own.includes('noteResponse(') && own.includes('isWriteMethod('));
      const records = readReal(paceFile, 'utf8');
      t("the writes above were paced under their verbs — the base sync's PUT among them; the reads were not", [records.includes('fleet-write POST'), records.includes('fleet-write DELETE'), records.includes('fleet-write PATCH'), records.includes('fleet-write PUT'), records.includes('fleet-write GET')], [true, true, true, true, false]);
      t('⛔ and the token never reached the throttle\'s log', records.includes(TOKEN), false);
    }

    // ── the annotations ─────────────────────────────────────────────────────
    battery("the annotations: ONE notice per landed op that creates or moves a card — op, number and url read from the platform's answer, never the request; none for any other op, a failed request or an answer that cannot be reported; the reader's own parser reads back exactly what was emitted");
    {
      const UI = 'objectstack-ai/objectui';
      const notices = (r) => r.logs.filter((l) => l.startsWith('::'));
      /** The data half of a workflow command, unescaped the way the runner stores it as the annotation's message. */
      const messageOf = (line) => line.slice(line.indexOf('::', 2) + 2).replace(/%0A/g, '\n').replace(/%0D/g, '\r').replace(/%25/g, '%');
      const issueUrl = (repo, n) => `https://github.test/${repo}/issues/${n}`;
      t('the two tables name exactly the ops that create or move a card: issue_create and transfer', [Object.keys(ANNOTATION_ANSWERS).sort(), Object.keys(ANNOTATED_OPS).sort()], [['issue_create', 'transfer'], ['issue_create', 'transfer']]);

      const created = await run(base([{ op: 'issue_create', title: 'I', body: 'B' }]), { ...allowed, [`POST /repos/${REPO}/issues`]: { status: 201, json: { number: 10, html_url: issueUrl(REPO, 10) } } }, { file: paceFile });
      t(
        'a landed issue_create prints exactly ONE workflow command: a notice titled `fleet-write issue_create` whose message names the action, op, number and url',
        [created.exit, notices(created)],
        [EXIT_OK, [`::notice title=fleet-write issue_create::fleet-write action=1 op=issue_create number=10 url=${issueUrl(REPO, 10)}`]],
        created.logs.join(' | '),
      );
      const back = parseRelayAnnotation(messageOf(notices(created)[0] ?? ''));
      t("…which the reader's own parser reads back as exactly what the run returns as emitted", [back, created.annotations], [{ action: 1, op: 'issue_create', number: 10, url: issueUrl(REPO, 10), repo: REPO }, [{ action: 1, op: 'issue_create', number: 10, url: issueUrl(REPO, 10), repo: REPO }]]);

      const moved = await run(base([{ op: 'transfer', issue: 7, target_repo: UI }]), {
        ...allowed,
        [`GET /repos/${UI}/collaborators/os-support-ai/permission`]: { status: 200, json: { permission: 'write', role_name: 'write' } },
        [`GET /repos/${REPO}/issues/7`]: { status: 200, json: { number: 7, node_id: 'I_7', repository_url: `https://api.github.test/repos/${REPO}` } },
        [`GET /repos/${UI}`]: { status: 200, json: { node_id: 'R_ui' } },
        'POST /graphql': { status: 200, json: { data: { transferIssue: { issue: { number: 31, url: issueUrl(UI, 31), repository: { nameWithOwner: UI } } } } } },
      }, { file: paceFile });
      t("⛔ a transfer's notice carries the number and url the transferIssue ANSWER placed on the target — #31 on the target, never the request's #7", [moved.exit, moved.annotations, notices(moved).length], [EXIT_OK, [{ action: 1, op: 'transfer', number: 31, url: issueUrl(UI, 31), repo: UI }], 1], moved.logs.join(' | '));

      const quiet = await run(base([
        { op: 'comment', issue: 1, body: 'a' },
        { op: 'labels_add', issue: 1, labels: ['x'] },
        { op: 'issue_patch', issue: 1, state: 'closed' },
        { op: 'pr_create', title: 'T', head: 'h', base: 'main' },
      ]), {
        ...allowed,
        [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 1, html_url: issueUrl(REPO, 1) } },
        [`POST /repos/${REPO}/issues/1/labels`]: { status: 200, json: [{ name: 'x' }] },
        [`PATCH /repos/${REPO}/issues/1`]: { status: 200, json: { number: 1, html_url: issueUrl(REPO, 1) } },
        [`POST /repos/${REPO}/pulls`]: { status: 201, json: { number: 9, html_url: `https://github.test/${REPO}/pull/9` } },
        // ⛔ No governed-review follow-up after a create (its own battery): the pull's files are never read, and no note is emitted.
      }, { file: paceFile });
      t('no other op emits one — a comment, labels, a patch and a NEW PULL REQUEST all landed, zero workflow commands, zero notes', [quiet.exit, notices(quiet), quiet.annotations], [EXIT_OK, [], []]);

      const mixed = await run(base([{ op: 'issue_create', title: 'A', body: 'a' }, { op: 'comment', issue: 1, body: 'c' }, { op: 'issue_create', title: 'B', body: 'b' }]), {
        ...allowed,
        [`POST /repos/${REPO}/issues`]: { status: 201, json: { number: 11, html_url: issueUrl(REPO, 11) } },
        [`POST /repos/${REPO}/issues/1/comments`]: { status: 201, json: { id: 2 } },
      }, { file: paceFile });
      t('one per annotated action, in order, each naming its OWN action index — 1 and 3 around the comment', mixed.annotations.map((a) => [a.action, a.op]), [[1, 'issue_create'], [3, 'issue_create']]);

      const refused = await run(base([{ op: 'issue_create', title: 'I', body: 'B' }]), { ...allowed, [`POST /repos/${REPO}/issues`]: { status: 403, json: { message: 'Resource not accessible by integration' } } });
      t('a create the platform refused emits nothing', [refused.exit, notices(refused), refused.annotations], [EXIT_ACTION_FAILED, [], []]);
      const blank = await run(base([{ op: 'issue_create', title: 'I', body: 'B' }]), { ...allowed, [`POST /repos/${REPO}/issues`]: { status: 201, json: {} } });
      t('an answer that carries no number and url emits nothing, says so, and the action still landed', [blank.exit, notices(blank), blank.logs.some((l) => l.includes('no annotation — the answer carries no number and url'))], [EXIT_OK, [], true]);
      const elsewhere = await run(base([{ op: 'issue_create', title: 'I', body: 'B' }]), { ...allowed, [`POST /repos/${REPO}/issues`]: { status: 201, json: { number: 12, html_url: issueUrl(UI, 12) } } });
      t('⛔ an answer whose url names another repository than the op lands on emits nothing, naming it', [notices(elsewhere), elsewhere.logs.some((l) => l.includes(`names ${UI}, not ${REPO}`))], [[], true]);

      t(
        "the command's escapes are actions/toolkit's: data escapes %, CR and LF; a property also : and ,",
        [escapeCommandData('a%b\r\nc'), escapeCommandProperty('t: a,b%'), annotationCommand({ action: 2, op: 'transfer', number: 5, url: 'https://github.test/o/r/issues/5?x=%41' })],
        ['a%25b%0D%0Ac', 't%3A a%2Cb%25', '::notice title=fleet-write transfer::fleet-write action=2 op=transfer number=5 url=https://github.test/o/r/issues/5?x=%2541'],
      );
      // The other annotations a relay run carries, measured on a live run's check run: the runner's image notice and an action's deprecation warning.
      t(
        "the parser reads ONLY the relay's own message: the runner's notices, a deprecation warning, an op outside the table, or a url that disagrees with its number are null",
        [
          parseRelayAnnotation('"The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026."'),
          parseRelayAnnotation("Input 'app-id' has been deprecated with message: Use 'client-id' instead."),
          parseRelayAnnotation(relayAnnotationMessage({ action: 1, op: 'pr_create', number: 9, url: issueUrl(REPO, 9) })),
          parseRelayAnnotation(relayAnnotationMessage({ action: 1, op: 'issue_create', number: 9, url: issueUrl(REPO, 8) })),
          parseRelayAnnotation(`${relayAnnotationMessage({ action: 1, op: 'issue_create', number: 9, url: issueUrl(REPO, 9) })} trailing`),
          parseRelayAnnotation(null),
        ],
        [null, null, null, null, null, null],
      );
      // The needle is assembled so this line does not match itself: a pattern for the message would spell its number group.
      t('⛔ the parser is the reader\'s, imported — this file spells no pattern for the message of its own', [readReal(SELF_PATH, 'utf8').includes(['number=', '(['].join('')), typeof parseRelayAnnotation], [false, 'function']);
    }

    // ── the CLI ─────────────────────────────────────────────────────────────
    battery('the CLI: environment inputs, the payload refusal, the exit ladder');
    {
      const env = (extra) => ({ ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '', HTTPS_PROXY: '', https_proxy: '', OS_PM_WRITE_PACE_FILE: join(dir, 'cli-pace.jsonl'), GITHUB_STEP_SUMMARY: join(dir, 'summary.md'), ...extra });
      const spawn = (args, extra) => spawnSync(process.execPath, [SELF_PATH, ...args], { encoding: 'utf8', env: env(extra) });
      const good = JSON.stringify(base([{ op: 'comment', issue: 1, body: 'a' }]));
      const noPayload = spawn([], { [PAYLOAD_ENV]: '', [SENDER_ENV]: 'x', GITHUB_TOKEN: TOKEN });
      t('no payload is exit 3 naming the variable', [noPayload.status, noPayload.stderr.includes(PAYLOAD_ENV)], [EXIT_PREREQUISITE, true]);
      const refused = spawn([], { [PAYLOAD_ENV]: JSON.stringify({ request_id: 'x' }), [SENDER_ENV]: 'x', GITHUB_TOKEN: TOKEN });
      t('a refused payload is exit 2, the reasons on stderr, the summary written', [refused.status, refused.stderr.includes('REFUSED'), readReal(join(dir, 'summary.md'), 'utf8').includes('zero writes')], [EXIT_REFUSED, true, true]);
      writeFileSync(join(dir, 'summary.md'), '', 'utf8');
      const noToken = spawn([], { [PAYLOAD_ENV]: good, [SENDER_ENV]: 'x' });
      t('no token is exit 3 before any request', [noToken.status, noToken.stderr.includes('no GITHUB_TOKEN')], [EXIT_PREREQUISITE, true]);
      const noSender = spawn([], { [PAYLOAD_ENV]: good, GITHUB_TOKEN: TOKEN });
      t('no sender is exit 3 before any request', [noSender.status, noSender.stderr.includes(SENDER_ENV)], [EXIT_PREREQUISITE, true]);
      writeFileSync(join(dir, 'p.json'), good, 'utf8');
      const fromFile = spawn(['--payload-file', join(dir, 'p.json')], { GITHUB_TOKEN: TOKEN });
      t('--payload-file reads the payload from disk (and still needs a sender)', [fromFile.status, fromFile.stderr.includes(SENDER_ENV)], [EXIT_PREREQUISITE, true]);
      t('an unknown flag is usage (2)', spawn(['--bogus']).status, EXIT_REFUSED);
      t('⛔ no spawned run printed the token', [noPayload, refused, noToken, noSender, fromFile].some((r) => `${r.stdout}${r.stderr}`.includes(TOKEN)), false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ── the floor, BEFORE the verdict ─────────────────────────────────────────
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floor = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floor.push(`the battery ledger declares ${declared.length} batteries, below its floor of ${SELF_TEST_BATTERY_FLOOR} — a section that stopped being declared is a section nothing floors.`);
  }
  for (const [name, count] of batteryCases) {
    if (name in SELF_TEST_BATTERIES) continue;
    floor.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.`);
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floor.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict below would have claimed those cases hold.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  for (const message of floor) cases.push({ name: message, ok: false, detail: '' });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ fleet-write/execute self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(
    `✓ fleet-write/execute self-test: ${cases.length} cases pass across ${declared.length} batteries — the sender gate from the target repo's answer, ` +
      'every op as the request the table declares, stop at the first failure with later actions untouched, the idempotent label DELETE, the GraphQL ' +
      'ops behind a node-id read, a pull mutation landing only when its answer shows the state it asked for (armed or queued, off, ready, draft), a base sync confirmed by the head leaving its expected sha or measured as a no-op, an assignees leg sent to the number the create answered and landing only when its answer lists every login sent, ' +
      'a governed-review follow-up after pr_ready alone (the draft open summons nobody — a human is asked at the seat\'s hand-off) that reads the pull\'s whole file list and, on a Tier H hit alone, requests every GOVERNED_APPROVERS account not already covered (the author assigned instead), zero writes when covered and a FAILED action when the list cannot be read whole, a transfer gated on both repositories and landing only on its target, ' +
      "a failed-jobs re-run fenced on the run and its pull's own current head, read just before its one POST (zero writes on any fence), and landing only when attempt 2 reads back with its failed jobs queued or in progress, " +
      "an issue-hierarchy link fenced on its two cards, sent as the child's REST id and landing only when the parent's list reads it back, one summary row per request, " +
      "one annotation per created or moved card carrying the number the platform answered, read back by the reader's own parser, a stroke at or " +
      'above the batch threshold announced as ONE rule ⑤ batch and paced at the batch gap (one the job cannot hold refused with zero requests), and a known ' +
      'token that came back out of NO summary, log or error.',
  );
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export const KNOWN_FLAGS = Object.freeze(['--payload-file', '--self-test', '--help', '-h']);

const USAGE = [
  'usage:',
  `  ${PAYLOAD_ENV}='{…}' ${SENDER_ENV}=<login> GITHUB_TOKEN=<App token> node scripts/pm/fleet-write/execute.mjs`,
  '  node scripts/pm/fleet-write/execute.mjs --payload-file <payload.json>     # the same, payload from disk',
  '  node scripts/pm/fleet-write/execute.mjs --self-test',
  `  Exits: ${EXIT_OK} every action landed · ${EXIT_REFUSED} payload refused or usage · ${EXIT_PREREQUISITE} prerequisite not met ·`,
  `         ${EXIT_SENDER_REFUSED} sender not authorized on the target · ${EXIT_ACTION_FAILED} an action failed (later ones not attempted) · ${EXIT_WRITE_PACE_REFUSED} throttle refused`,
].join('\n');

export function parseArgs(argv) {
  const opts = { payloadFile: null, selfTest: false, help: false, errors: [] };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '--payload-file') {
      const v = args.shift();
      if (v === undefined || v.startsWith('--')) opts.errors.push('--payload-file needs a path');
      else opts.payloadFile = v;
    } else if (a.startsWith('--payload-file=')) opts.payloadFile = a.slice('--payload-file='.length);
    else opts.errors.push(`unrecognised argument ${JSON.stringify(a)}`);
  }
  return opts;
}

export async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (opts.selfTest) return selfTest();
  if (opts.errors.length) {
    for (const e of opts.errors) console.error(`fleet-write/execute: ${e}`);
    console.error(USAGE);
    return EXIT_REFUSED;
  }
  let text;
  if (opts.payloadFile !== null) {
    try {
      text = readFileSync(opts.payloadFile, 'utf8');
    } catch (e) {
      console.error(`fleet-write/execute: PREREQUISITE NOT MET — --payload-file ${opts.payloadFile} cannot be read (${e?.message ?? 'unreadable'}). ⛔ zero writes.`);
      return EXIT_PREREQUISITE;
    }
  } else {
    text = process.env[PAYLOAD_ENV];
    if (typeof text !== 'string' || text.trim() === '' || text.trim() === 'null') {
      console.error(`fleet-write/execute: PREREQUISITE NOT MET — ${PAYLOAD_ENV} is absent or empty. ⛔ zero writes.`);
      return EXIT_PREREQUISITE;
    }
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    console.error(`fleet-write/execute: PREREQUISITE NOT MET — the payload is not JSON (${e?.message ?? 'parse failed'}). ⛔ zero writes.`);
    return EXIT_PREREQUISITE;
  }
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
  const sender = process.env[SENDER_ENV] ?? '';
  const api = String(process.env.OS_FLEET_API_URL ?? '').trim().replace(/\/+$/, '') || DEFAULT_API;
  const result = await executeFleetWrite({ payload, sender, token, api }, { log: (l) => (isRefusalLine(l) ? console.error(l) : console.log(l)) });
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    try {
      appendFileSync(summaryFile, result.summary, 'utf8');
    } catch (e) {
      console.error(`fleet-write/execute: could not append the step summary (${scrub(e?.message ?? '', [token])}); the rows above are the record.`);
    }
  }
  return result.exit;
}

/** Refusals and prerequisite lines go to stderr; the per-action transcript to stdout. */
function isRefusalLine(line) {
  return /REFUSED|PREREQUISITE NOT MET/.test(line);
}

if (isEntrypoint(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  if (process.argv.includes('--self-test') && !selfTestReachedVerdict) {
    console.error(
      '\n✗ fleet-write/execute self-test: selfTest() returned without reaching its verdict, so no success line was\n' +
        'printed. Exiting 0 here would report a self-test that never finished as one that passed.\n',
    );
    process.exit(1);
  }
  process.exit(code);
}
