#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// scheduled-full-run -- the three halves of the full battery's contract that
// nothing else can hold (#16467, #22998).
//
//   node scripts/ci/scheduled-full-run.mjs --check-concurrency
//   node scripts/ci/scheduled-full-run.mjs --release-gate --release-commit <sha>
//   node scripts/ci/scheduled-full-run.mjs --self-test
//
// Half 3 (#22998) is the READER the full battery gained when PR and queue runs
// became the fast set: release.yml's `full-battery` job runs `--release-gate`
// before the `release` environment approval, and the publish lane refuses
// unless the newest full-battery runs of `CI`, `Lint & Type Check` and
// `Spec Shape Gate` at or before the version commit concluded `success`. See
// HALF 3 below.
//
// ## Why one file holds the first two halves
//
// `push` on `main` now tests the AFFECTED set. The thing that keeps "main is
// green" a statement about the whole workspace is the hourly `schedule` run of
// ci.yml and lint.yml. Two properties have to hold for that to be true, and
// neither is visible in the run that would be wrong:
//
//   1. THE RUN HAS TO SURVIVE. On a `schedule` event `github.event.pull_
//      request.number` is empty and `github.ref` is `refs/heads/main` -- byte-
//      identical to a push to `main`. Under the old two-segment concurrency key
//      the hourly run and the next merge shared one group with
//      `cancel-in-progress: true`, so the next merge killed the hourly run.
//      That is measured, not feared: 36 of the last 60 push runs on `main` were
//      already cancelled that way.
//
//   2. A RED ONE HAS TO BE SEEN. A scheduled run is on no PR, blocks nothing
//      and appears on no check list. `merge-queue-triage.yml` listens to
//      `workflows: [CI]` on `merge_group` only, so before this card a red
//      `Lint & Type Check` on `main` had no reader at all.
//
// Half 1 is `--check-concurrency`, a gate over the two workflow files. Half 2
// is the card the filer workflow opens, whose IDENTITY, DE-DUP and BODY are
// exported from here so they can be driven offline -- a de-dup rule that is
// only ever exercised by the live workflow is a de-dup rule that gets its first
// test the night it files its second duplicate.
//
// ⛔ Both halves fail CLOSED. The expression evaluator below throws on any
// token it does not understand rather than guessing a value, because a guess
// makes two groups compare equal or unequal for a reason nobody wrote down.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// The release gate's run listing reads GitHub through the ONE retry policy the
// citation gate measured and pins (#23361; see `readRuns` below). Imported,
// never copied.
// ⛔ This import puts `check-issue-citations.mjs` and its own imports in THIS
// file's load closure, and release.yml's `full-battery` job runs this file off
// a bare checkout with no install step (so does scheduled-full-run-card.yml's
// `import()`). Measured when it was added: every module in that closure
// imports only `node:*` builtins and runs nothing at load. A dependency
// added anywhere in it breaks the publish lane at load time.
import { BOARD_READ_RETRY, boardReadBudget, readBoard, readFailure } from '../check-issue-citations.mjs';
import { EXIT_FINDINGS, EXIT_PREREQUISITE_NOT_MET } from '../import-prerequisite.mjs';
import { isEntrypoint } from '../invoked-as.mjs';
// The `Blocked-by:` reader the half-state patrol's H19 discovers targets with.
// IMPORTED, never restated: the refresh and the patrol must never disagree
// about what a marker is (see "A STALE `pm:blocked`" below).
// `directiveValues` is the same file's shared line reader, used here for the
// `Unlock-action:` key exactly as the patrol reads it.
import { blockerTargetsFor, directiveValues, h19BlockOutlivedBlocker, labelNames } from '../pm/check-half-states.mjs';

// The workflows that carry the hourly full run. Spelled as quoted repo-relative
// literals: the dispatch derivation reads a gate's path literals as the
// population it watches, so a card touching either file schedules this family.
export const WATCHED_WORKFLOWS = Object.freeze([
  '.github/workflows/ci.yml',
  '.github/workflows/lint.yml',
]);

// ---------------------------------------------------------------------------
// HALF 1 -- the concurrency key
// ---------------------------------------------------------------------------

// The top-level `concurrency.group:` line, read as TEXT rather than through a
// YAML parser on purpose: this gate has to run with no dependency beyond node,
// and the shape it reads is one scalar at a known indentation. Anchored to
// column 0 for `concurrency:` so a job-level `concurrency:` block (indented)
// cannot be mistaken for the workflow-level one.
export function readConcurrencyGroup(yamlText) {
  const lines = String(yamlText).split('\n');
  const start = lines.findIndex((line) => line === 'concurrency:');
  if (start === -1) throw new Error('no top-level `concurrency:` block');
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // the block ended
    const m = /^\s+group:\s*(.+?)\s*$/.exec(line);
    if (m) return m[1];
  }
  throw new Error('the top-level `concurrency:` block declares no `group:`');
}

// Resolve a dotted context path. A property that is absent is the EMPTY STRING,
// which is what the runner substitutes and what makes `||` fall through.
function readPath(context, path) {
  let node = context;
  for (const segment of path.split('.')) {
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, segment)) return '';
    node = node[segment];
  }
  return node ?? '';
}

// Evaluate one `${{ ... }}` expression. Deliberately tiny, and deliberately
// LOUD about anything outside its grammar: context paths, single-quoted
// literals, and `||` between them. GitHub's `||` yields the first truthy
// operand and otherwise the last, and the empty string is falsy.
export function evaluateExpression(expression, context) {
  const operands = String(expression).split('||').map((s) => s.trim());
  let last = '';
  for (const operand of operands) {
    if (operand === '') throw new Error(`empty operand in expression '${expression}'`);
    let value;
    if (/^'[^']*'$/.test(operand)) value = operand.slice(1, -1);
    else if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(operand)) {
      value = readPath(context, operand);
    } else {
      throw new Error(
        `scheduled-full-run cannot evaluate the operand '${operand}' in '${expression}'. ` +
          'This evaluator refuses rather than guesses: a guessed value decides whether two ' +
          'concurrency groups compare equal, which is the whole verdict. Extend the grammar ' +
          'and add a self-test case for it.'
      );
    }
    last = value;
    if (value !== '' && value !== null && value !== undefined && value !== false) return String(value);
  }
  return String(last);
}

// A `concurrency.group` value with its `${{ }}` holes filled in.
export function evaluateGroup(groupExpression, context) {
  return String(groupExpression).replace(/\$\{\{([^}]*)\}\}/g, (_all, inner) =>
    evaluateExpression(inner, context)
  );
}

// The event shapes the verdict below compares. Each is what the runner really
// hands a workflow for that event on THIS repo: `schedule` and
// `workflow_dispatch` on `main` carry no pull request and `refs/heads/main`,
// which is precisely why they used to collide with `push`.
//
// The RUN-VARYING fields are filled in too, from `sha` and `runId`, because the
// verdict below asks which runs of one event SHARE a group, and a context with
// no commit in it would answer that for a key that names a commit by accident
// (#25373). Payload keys are the ones each event really carries: only `push`
// (and a `pull_request` synchronize) has `event.after`; `schedule`,
// `workflow_dispatch` and `merge_group` have none, so a key that falls through
// `github.event.after` reaches `github.ref` on those, exactly as on the runner.
export function eventContext(
  eventName,
  { workflow = 'W', prNumber = null, ref = null, sha = 'a'.repeat(40), runId = 1 } = {}
) {
  const pr = prNumber ?? 1;
  const refs = {
    push: 'refs/heads/main',
    schedule: 'refs/heads/main',
    workflow_dispatch: 'refs/heads/main',
    pull_request: `refs/pull/${pr}/merge`,
    merge_group: `refs/heads/gh-readonly-queue/main/pr-${pr}-${sha}`,
  };
  const events = {
    push: { ref: 'refs/heads/main', before: 'f'.repeat(40), after: sha },
    schedule: { schedule: '0 * * * *' },
    workflow_dispatch: { ref: 'refs/heads/main', inputs: {} },
    pull_request: { action: 'synchronize', number: pr, after: sha, pull_request: { number: pr } },
    merge_group: { action: 'checks_requested', merge_group: { head_sha: sha } },
  };
  return {
    github: {
      workflow,
      event_name: eventName,
      ref: ref ?? refs[eventName] ?? `refs/heads/${eventName}`,
      sha,
      run_id: String(runId),
      event: events[eventName] ?? {},
    },
  };
}

// The verdict. Findings are returned rather than thrown so the CLI can name all
// of them at once.
export function concurrencyVerdict(groupExpression, { workflow = 'W' } = {}) {
  const findings = [];
  // Two runs of each event, on two different commits with two different run
  // ids: the first and the second merge, the hour-N and hour-N+1 run.
  const FIRST = { sha: '1'.repeat(40), runId: 101 };
  const SECOND = { sha: '2'.repeat(40), runId: 102 };
  const group = (eventName, options = {}) =>
    evaluateGroup(groupExpression, eventContext(eventName, { workflow, ...FIRST, ...options }));

  const push = group('push');
  const schedule = group('schedule');
  const dispatch = group('workflow_dispatch');

  // THE assertion this gate exists for.
  if (schedule === push) {
    findings.push(
      `a \`schedule\` run and a \`push\` run share the concurrency group '${schedule}', so the next ` +
        'merge to main cancels the hourly full run. Put `github.event_name` in the key.'
    );
  }
  if (dispatch === push) {
    findings.push(
      `a \`workflow_dispatch\` run and a \`push\` run share the concurrency group '${dispatch}', so a ` +
        'merge cancels the on-demand full run.'
    );
  }
  if (dispatch === schedule) {
    findings.push(
      `a \`workflow_dispatch\` run and a \`schedule\` run share the concurrency group '${dispatch}', so ` +
        'an on-demand full run cancels the hourly one it was meant to pre-empt.'
    );
  }

  // EVERY PUSH RUN FINISHES (#25373). A push run is the only run that tests
  // its own merge's `--affected` set; a cancelled one leaves that merge with
  // no verdict on main until the next hourly run. Sharing a group between two
  // merges lets the second cancel the first -- and `cancel-in-progress: false`
  // does not save it, because GitHub keeps ONE pending run per group and
  // cancels that one when a third arrives. So two pushes of two different
  // commits must land in two different groups.
  const nextPush = group('push', SECOND);
  if (nextPush === push) {
    findings.push(
      `two pushes to main share the concurrency group '${push}', so the next merge cancels the ` +
        "previous merge's run before its own tests finish. Put `github.event.after` in the " +
        'key, after the PR number.'
    );
  }

  // POSITIVE CONTROL, and it is not decoration. The cheap way to satisfy every
  // inequality above is to put something run-unique in the key --
  // `github.run_id`, `github.sha` -- which also switches `cancel-in-progress`
  // off for every OTHER event in the file. So everything that is not a push
  // must still collapse two runs onto one group: two hourly runs at two `main`
  // heads, two on-demand runs, and two heads of the SAME pull request.
  if (group('schedule', SECOND) !== schedule) {
    findings.push('two `schedule` runs on two `main` heads do not share a group (the key is run-unique off push)');
  }
  if (group('workflow_dispatch', SECOND) !== dispatch) {
    findings.push('two `workflow_dispatch` runs do not share a group (the key is run-unique off push)');
  }
  if (group('pull_request', { prNumber: 7 }) !== group('pull_request', { prNumber: 7, ...SECOND })) {
    findings.push('two heads of one pull request do not share a group (a new push no longer cancels the stale run)');
  }
  // ...and it must still separate two different pull requests.
  if (group('pull_request', { prNumber: 7 }) === group('pull_request', { prNumber: 8 })) {
    findings.push('two different pull requests share one concurrency group (the key ignores the PR number)');
  }
  // ...and a queue build must not be cancelled by a push to main.
  if (group('merge_group') === push || group('merge_group') === nextPush) {
    findings.push('a `merge_group` build and a `push` run share one group');
  }

  return { ok: findings.length === 0, findings, groups: { push, nextPush, schedule, dispatch } };
}

// ---------------------------------------------------------------------------
// HALF 2 -- the card a red scheduled run files
// ---------------------------------------------------------------------------

// ⛔ The marker is PLAIN TEXT, never an HTML comment. This platform's body
// sanitizer is measured to eat short angle-bracket fragments, and a de-dup key
// that can be swallowed files a duplicate an hour.
//
// Both prefixes carry the watched workflow's CADENCE (#23880): the card for a
// nightly workflow must not call itself hourly. For an hourly workflow they
// spell exactly what they always did -- `hourly full run: red on main` and
// `os-hourly-full-run` -- so an open card filed before the cadence existed is
// still found by its title and by its marker, and refreshed, never duplicated.
const markerPrefix = (cadence) => `os-${cadence}-full-run`;
const titlePrefix = (cadence) => `${cadence} full run: red on main`;

// THE CADENCE OF EACH WATCHED WORKFLOW, by its byte-exact `name:` -- the same
// spelling `scheduled-full-run-card.yml` lists in `workflow_run.workflows`.
// CLOSED on purpose: a workflow missing here is REFUSED by `cardIdentity`,
// never defaulted, because a defaulted cadence prints the wrong one on the card
// and the card is the only reader of that run. Adding a workflow to the card's
// watched list therefore means adding its cadence here in the same change.
export const CARD_CADENCES = Object.freeze({
  CI: 'hourly',
  'Lint & Type Check': 'hourly',
});

// The words each cadence puts in the body. The `hourly` entry is the text the
// body has always carried, byte for byte.
const CADENCE_WORDS = Object.freeze({
  hourly: Object.freeze({
    every: 'every hour',
    previous: 'an hour ago',
    about: (name) => [
      `\`${name}\` runs the FULL battery on \`main\` every hour (#16467). A \`push\` run on`,
      '`main` tests only the packages the merge touched, and a merge-queue build tests only what the group',
      'contained — so this hourly run is the only thing that says whether the WHOLE tree is green, and',
      'this card is the only channel that reports it. Nothing is blocked by it.',
    ],
  }),
  nightly: Object.freeze({
    every: 'every night',
    previous: 'the night before',
    about: (name) => [
      `\`${name}\` runs on \`main\` once a night, and no pull request, merge-queue build or other`,
      'scheduled run takes its measurement -- so this nightly run is the only thing that reports it, and',
      'this card is the only channel that carries it. Nothing is blocked by it.',
    ],
  }),
});

// ONE CARD PER WORKFLOW, not one card for both, and that is a decision rather
// than an oversight. `CI` and `Lint & Type Check` are two different batteries
// that go red for unrelated reasons; a single identity would make whichever
// filer ran second overwrite the other's diagnosis with its own, and the body
// is REWRITTEN on a refresh (a comment per run is the thing this shape avoids).
// The card's identity is therefore the workflow's name, and "one red scheduled
// run files exactly one card" holds per run, which is the unit that is red.
export function cardIdentity(workflowName) {
  const name = String(workflowName ?? '').trim();
  if (name === '') throw new Error('cardIdentity: the workflow name is required -- it IS the identity');
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug === '') throw new Error(`cardIdentity: '${name}' slugs to nothing, so it cannot be an identity`);
  if (!Object.hasOwn(CARD_CADENCES, name)) {
    throw new Error(
      `cardIdentity: '${name}' has no cadence in CARD_CADENCES (${Object.keys(CARD_CADENCES).join(', ')}). ` +
        'Add it there in the same change that makes scheduled-full-run-card.yml watch it -- a defaulted ' +
        'cadence would print the wrong one on the only card that reports this run.'
    );
  }
  const cadence = CARD_CADENCES[name];
  return {
    workflowName: name,
    cadence,
    title: `${titlePrefix(cadence)} (${name})`,
    marker: `${markerPrefix(cadence)}-${slug}`,
    labels: ['bug', 'domain:devx', 'priority:p1'],
  };
}

// Is this issue THIS card? Two ways in, because either can be edited away: the
// title prefix, and the body marker. A PULL REQUEST is never this card --
// `listForRepo` returns PRs too, and a PR titled after this card would
// otherwise swallow the file and the real red would never be reported.
export function matchesCard(issue, identity) {
  if (!issue || issue.pull_request) return false;
  const title = String(issue.title ?? '');
  const body = String(issue.body ?? '');
  return title.startsWith(identity.title) || body.includes(identity.marker);
}

// The de-dup decision, over a PAGED listing of OPEN issues.
//
// `listPage(n)` returns that page's issues; a page shorter than `perPage` ends
// the listing. A listing that hits `maxPages` without ending has NOT
// established absence, and filing on an unestablished absence is exactly how a
// filer mints a duplicate every hour -- so it throws rather than creating.
export async function findExistingCard({ identity, listPage, perPage = 100, maxPages = 10 }) {
  const found = [];
  let complete = false;
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = (await listPage(page)) ?? [];
    for (const issue of batch) if (matchesCard(issue, identity)) found.push(issue);
    if (batch.length < perPage) {
      complete = true;
      break;
    }
  }
  if (!complete) {
    throw new Error(
      `the open-issue scan hit its ${maxPages}-page bound without completing -- absence is NOT ` +
        'established, so nothing was filed. The verdict is in this run summary.'
    );
  }
  // The OLDEST open card wins: that is the one any duplicates were closed
  // against, and the one whose grading the devx seat already did.
  return found.sort((a, b) => a.number - b.number)[0] ?? null;
}

// The callbacks `fileOrRefreshCard` is wired with. Checked on EVERY call, both
// paths: a workflow that drops one fails on its next red, whichever path that
// red takes, instead of only on the rare refresh of a `pm:blocked` card.
const CARD_CALLBACKS = Object.freeze([
  'listPage',
  'createIssue',
  'updateIssue',
  'listComments',
  'getIssue',
  'addLabels',
  'removeLabel',
]);

// The whole decision, so that "one red run files one card, the next refreshes
// it" is a property something can DRIVE rather than a sentence in a workflow
// comment. The caller supplies thin callbacks over the API and nothing else;
// every branch of the judgement is here.
//
// ⛔ `create` is reached ONLY through `findExistingCard`, which throws on a
// scan it could not complete. An exception here therefore files nothing, which
// is the correct direction: a missed refresh costs one stale body, and a
// spurious create costs a duplicate card every hour until somebody notices.
export async function fileOrRefreshCard({
  identity,
  body,
  listPage,
  createIssue,
  updateIssue,
  listComments,
  getIssue,
  addLabels,
  removeLabel,
  ownerRepo,
  perPage,
  maxPages,
}) {
  const wired = { listPage, createIssue, updateIssue, listComments, getIssue, addLabels, removeLabel };
  const missing = CARD_CALLBACKS.filter((name) => typeof wired[name] !== 'function');
  if (missing.length > 0) {
    throw new Error(`fileOrRefreshCard: not wired with ${missing.join(', ')} -- nothing was read or written`);
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(String(ownerRepo ?? ''))) {
    throw new Error(
      `fileOrRefreshCard: ownerRepo '${ownerRepo}' is not owner/name -- a bare \`#N\` blocker is resolved against it`
    );
  }
  const existing = await findExistingCard({ identity, listPage, perPage, maxPages });
  if (existing) {
    // Rewritten in place, never a comment per run. ⛔ No GRADE is ever written
    // here (priority, lane, type): grading is the devx seat's and a refresh
    // must not undo it. The one label a refresh may move is a STATE, and only
    // the stale-block swap below moves it.
    const block = await judgeCardBlock({ issue: existing, ownerRepo, listComments, getIssue });
    if (block.verdict === 'expired') {
      // Labels FIRST, the body after, so the body never says "moved" about a
      // move that did not happen. Additive POST, then ONE remove by name --
      // ⛔ never a whole-set write (`check:whole-set-label-write`). The add
      // goes first, as `scripts/pm/label-write.mjs` orders it: a remove that
      // then fails leaves two state labels (the patrol's ONE-OF rows name
      // that), never a card with none. A failed write THROWS before the body
      // is touched -- the card stays exactly as the previous run left it and
      // the run summary reports it NOT WRITTEN, the same posture as a scan
      // that could not complete.
      await addLabels({ number: existing.number, labels: [QUEUE_LABEL] });
      try {
        await removeLabel({ number: existing.number, name: BLOCKED_LABEL });
      } catch (error) {
        // Already gone (a seat moved it between the listing and this write):
        // the state this write wanted is the state the card is in.
        if (error?.status !== 404) throw error;
      }
    }
    const note = renderBlockNote(block);
    await updateIssue({ number: existing.number, body: note ? withBlockNote(body, note) : body });
    return { action: 'refreshed', number: existing.number, block: block.verdict, blockSummary: summariseBlock(block) };
  }
  const created = await createIssue({ title: identity.title, body, labels: identity.labels });
  return { action: 'filed', number: created.number };
}

// ---------------------------------------------------------------------------
// A STALE `pm:blocked` on the card a refresh rewrites
// ---------------------------------------------------------------------------
//
// THE DEFECT, measured on #23885 (2026-10-16 .. 10-18). The triage seat graded
// the CI card `pm:blocked` on #23908 and parked the `Blocked-by:` line in a
// COMMENT, because this filer rewrites the body. #23908 closed the same day.
// Two days later the hourly run went red on a NEW failure; the refresh rewrote
// the body and, labels being create-only, left `pm:blocked` -- the label that
// tells every seat "not yours". The red sat in nobody's queue until the next
// triage round re-queued it by hand.
//
// THE RULE. On a refresh of a card carrying `pm:blocked`, every `Blocked-by:`
// target the card names -- body AND comments, line-initial, read by the
// patrol's own reader -- is resolved. When EVERY one is a LOCAL card that has
// closed, no `Unlock-action:` line names another unlock, and the card has no
// assignee, the refresh swaps `pm:blocked` for `pm:queue` and says so in the
// refreshed body. Anything else changes no label:
//
//   not pm:blocked        nothing read at all
//   no target named       H4's row (a block with no line), not this refresh's
//   any target OPEN       the block still holds: the hourly reds are expected
//   any target UNREAD     unread is not closed (#4690) -- never released on it
//   a CROSS-REPO target   closed upstream means merged THERE, not consumable
//     that is CLOSED      HERE: 「跨仓解锁判据是消费方可安装,⛔ 不是上游已合并」
//                         (pm-dispatch SKILL.md, the state model), and a fix
//                         not yet installable goes to `pm:on-hold` with a
//                         consumer-side `Restart-when:`, 「⛔ 不回 `pm:queue`」.
//                         objectstack consumes objectui through the
//                         `.objectui-sha` pin, so the next hourly red is the
//                         SAME failure until the pin moves -- never released
//   an `Unlock-action:`   the card names an unlock other than closure
//     line (any channel)  (`references/state-machine.md`, `pm:blocked`), so
//                         closure is not its exit -- never released. Any value
//                         withholds, a spelling the patrol does not recognise
//                         included: stricter than the patrol's silent fallback,
//                         in the one direction that cannot release a card
//   comments unread       an OPEN blocker could be in them -- never released
//   assigned              the move to `pm:queue` is the holder's release act
//                         (clear the assignee + `Release:` line, one write);
//                         `pm:queue` with an assignee is the patrol's H24
//
// WHY THIS IS NOT A REFLEXIVE RELEASE. The state model forbids releasing a
// block just because its upstream closed (「上游已关 ⇒ 先重新推导是否有新阻塞并
// 改写该行,⛔ 不反射式放行」). The trigger here is not the upstream closing --
// that happened, here, two days earlier and moved nothing. It is a NEW red,
// which is the re-derivation: an undiagnosed failure that arrived after every
// named blocker closed is new work, and it can have no recorded blocker yet
// (a seat that knew one would have named it, and an OPEN target holds the
// card). That is the condition the triage seat itself wrote on #23885 when it
// parked the card: "If the next hourly run names a second failing job, that
// job is new work, and this label comes off." It holds only for a LOCAL
// target, whose closure means its fix landed on this `main`; a closed
// cross-repo target says nothing about this tree, which is why it holds the
// card (the table above).
//
// WHY THE UNION OF BOTH CHANNELS. The patrol's H19 FOUNDS an expiry on the
// body's set whenever the body states one, because a body is the canonical
// home. This card's body is generated, so for it the comment thread is the
// only place a line survives; and requiring EVERY target in EITHER channel to
// be closed is strictly the more withholding rule: whenever this swaps, H19
// reads the same card as a full discharge (the self-test pins that).
//
// ⛔ Never a grade (priority, lane, type) and never any other label. ⛔ Never
// the assignee. ⛔ No comment: the record is the refreshed body, the label
// events on the timeline, and this run's log.

export const BLOCKED_LABEL = 'pm:blocked';
export const QUEUE_LABEL = 'pm:queue';

// The pure verdict over resolved targets. `resolutions` are
// `blockerTargetsFor`'s targets, each carrying `local` and `state`
// ('open' | 'closed' | 'unresolved') -- the shape H19 judges.
// `unlockActions` are the card's `Unlock-action:` values, both channels.
export function staleBlockVerdict({ issue, resolutions, unlockActions = [] }) {
  if (!labelNames(issue ?? {}).includes(BLOCKED_LABEL)) return { verdict: 'not-blocked' };
  const rows = resolutions ?? [];
  if (rows.length === 0) return { verdict: 'no-target' };
  const open = rows.filter((r) => r.state === 'open');
  const unread = rows.filter((r) => r.state !== 'open' && r.state !== 'closed');
  // Closed THERE is not consumable HERE: a closed cross-repo target withholds.
  const upstream = rows.filter((r) => r.state === 'closed' && r.local !== true);
  const declared = [...(unlockActions ?? [])];
  if (open.length > 0 || unread.length > 0 || upstream.length > 0 || declared.length > 0) {
    return { verdict: 'held', open, unread, upstream, unlockActions: declared };
  }
  const assignees = (issue?.assignees ?? []).map((a) => String(a?.login ?? a));
  if (assignees.length > 0) return { verdict: 'assigned', assignees };
  return { verdict: 'expired' };
}

// Every comment on the card, bounded like the open-issue scan and for the same
// reason: a read that stops at its bound has not established that no OPEN
// `Blocked-by:` line sits on a page it never read, so it THROWS rather than
// hand a partial thread to a judgement that could release on it.
async function readCardComments({ number, listComments, perPage, maxPages }) {
  const bodies = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = (await listComments({ number, page, perPage })) ?? [];
    for (const comment of batch) bodies.push(typeof comment === 'string' ? comment : String(comment?.body ?? ''));
    if (batch.length < perPage) return bodies;
  }
  throw new Error(`the comment read hit its ${maxPages}-page bound without completing`);
}

// Read what the verdict needs -- nothing at all for a card that is not
// `pm:blocked` -- and judge it. A read that fails is a verdict (`unjudged`, or
// an `unresolved` target), never an exception: the body refresh is this
// filer's product and a label it cannot judge must not cost it.
export async function judgeCardBlock({ issue, ownerRepo, listComments, getIssue, perPage = 100, maxPages = 10 }) {
  if (!labelNames(issue ?? {}).includes(BLOCKED_LABEL)) return { verdict: 'not-blocked', resolutions: [] };
  let comments;
  try {
    comments = await readCardComments({ number: issue.number, listComments, perPage, maxPages });
  } catch (error) {
    return { verdict: 'unjudged', detail: `the card's comments could not be read (${error.message})`, resolutions: [] };
  }
  const resolutions = [];
  for (const target of blockerTargetsFor(issue, comments, ownerRepo)) {
    try {
      const got = await getIssue({ repo: target.repo, number: target.number });
      const state = got?.state === 'closed' || got?.state === 'open' ? got.state : 'unresolved';
      resolutions.push({
        ...target,
        state,
        closedAt: got?.closed_at ?? null,
        detail: state === 'unresolved' ? `answered state '${got?.state}'` : null,
      });
    } catch (error) {
      resolutions.push({ ...target, state: 'unresolved', closedAt: null, detail: String(error?.message ?? error) });
    }
  }
  const unlockActions = [issue?.body, ...comments].flatMap((text) => directiveValues(text, 'Unlock-action'));
  return { ...staleBlockVerdict({ issue, resolutions, unlockActions }), resolutions };
}

const targetName = (r) => (r.local ? `#${r.number}` : r.key);

// What each target reads as on the summary row. A closed cross-repo target is
// NAMED as the reason it holds, never shown as a bare `closed`.
const targetReading = (r) =>
  r.state === 'closed' && r.local !== true
    ? `${targetName(r)} closed upstream (not an unlock criterion for this consumer)`
    : `${targetName(r)} ${r.state}`;

// One line for the run log: the verdict and what it was read from.
function summariseBlock(block) {
  const rows = (block.resolutions ?? []).map(targetReading);
  const unlocks = (block.unlockActions ?? []).map((v) => `Unlock-action: ${v} (its unlock is not closure)`);
  return [block.verdict, block.detail, rows.length > 0 ? rows.join(', ') : null, ...unlocks]
    .filter(Boolean)
    .join(' -- ');
}

// What the refreshed body says about the block, or null when it says nothing.
// ⛔ No line here may START with a directive key: the note would then be read
// as a body-borne `Blocked-by:` line by the very reader it reports on (the
// self-test runs the reader over every note).
export function renderBlockNote(block) {
  const closed = (block.resolutions ?? [])
    .map((r) => `${targetName(r)}${r.closedAt ? ` (closed ${r.closedAt})` : ' (closed)'}`)
    .join(', ');
  if (block.verdict === 'expired') {
    return [
      `## State: \`${BLOCKED_LABEL}\` → \`${QUEUE_LABEL}\`, moved by this refresh`,
      `This card carried \`${BLOCKED_LABEL}\`, and every \`Blocked-by:\` target it names is closed: ${closed}.`,
      'A red run that arrives after the last named blocker closed is new work, so this refresh moved the card',
      `back to \`${QUEUE_LABEL}\` (one additive label write, one remove by name). Priority, lane and every other`,
      "label are untouched: grading stays the seat's. If this red is still the failure the block was about,",
      're-block the card with a line-initial `Blocked-by:` in a COMMENT -- this body is rewritten on every red.',
    ];
  }
  if (block.verdict === 'assigned') {
    return [
      `## State: \`${BLOCKED_LABEL}\`, and every blocker it names is closed`,
      `Every \`Blocked-by:\` target this card names is closed (${closed}), so this red is new work -- but the`,
      `card is assigned (${block.assignees.map((a) => `\`${a}\``).join(', ')}), and moving it to \`${QUEUE_LABEL}\` is`,
      "the holder's release act (clear the assignee and post the `Release:` line, in one write), never this",
      "refresh's. No label was changed.",
    ];
  }
  return null;
}

// The last line `renderBody` writes. The block note goes directly above it.
export const CARD_FOOTER =
  '_Filed by `.github/workflows/scheduled-full-run-card.yml`. Generated by [Claude Code](https://claude.ai/code)_';

export function withBlockNote(body, noteLines) {
  const lines = String(body).split('\n');
  const at = lines.lastIndexOf(CARD_FOOTER);
  if (at === -1) return [...lines, ...noteLines].join('\n');
  return [...lines.slice(0, at), ...noteLines, ...lines.slice(at)].join('\n');
}

// The card body. The run link and the commit range are the whole product: a red
// scheduled run says "main broke somewhere since the last green one" -- the last
// hour for an hourly workflow, the last night for a nightly one -- and the
// commits between the previous GREEN scheduled run and this one are that span.
export function renderBody({
  identity,
  runUrl,
  headSha,
  conclusion,
  sweptAt,
  previousGreen = null,
  commits = [],
  compareUrl = null,
  commitsTruncated = false,
  // Why no range could be named, in the caller's words. The two reasons -- no
  // previous green scheduled run in the API window, and a compare call that
  // failed -- read identically in the body without it, and they point in
  // opposite directions.
  rangeNote = null,
}) {
  // The cadence's words. `cardIdentity` refuses a workflow with no cadence; an
  // identity built by hand without one is refused here for the same reason.
  const words = CADENCE_WORDS[identity?.cadence];
  if (!words) {
    throw new Error(`renderBody: the identity carries no known cadence ('${identity?.cadence}') -- build it with cardIdentity`);
  }
  const heading = `## What landed since the last green ${identity.cadence} run`;
  const range = previousGreen
    ? `\`${String(previousGreen.head_sha).slice(0, 10)}\` (run ${previousGreen.run_id}, the last green ` +
      `\`${identity.workflowName}\` schedule run) .. \`${String(headSha).slice(0, 10)}\``
    : null;

  const suspects = previousGreen
    ? commits.length > 0
      ? [
          heading,
          '',
          `Range: ${range}${compareUrl ? ` — [compare](${compareUrl})` : ''}`,
          commitsTruncated
            ? '\n_Truncated by the compare API; open the compare link for the full list._'
            : '',
          '',
          ...commits.map((c) => `- \`${String(c.sha).slice(0, 10)}\` ${String(c.title).split('\n')[0]}`),
          '',
        ]
      : [
          heading,
          '',
          `Range: ${range}`,
          '',
          `⚠️ Nothing landed in that range. The same tree was green ${words.previous} and is red now, so`,
          'this is a FLAKE, an infrastructure fault, or a suite that depends on wall-clock time or on',
          'something outside the repository. ⛔ Do not go looking for the commit that broke it.',
          '',
        ]
    : [
        heading,
        '',
        '⚠️ No commit range could be named for this red run.',
        rangeNote ?? '',
        'Read the run log directly. ⛔ Do not take the absence of a range as "nothing changed": it is the',
        'absence of a READING, which is a different fact and points at this filer rather than at `main`.',
        '',
      ];

  return [
    `${identity.marker} — machine-findable marker for this generated card. ⛔ Do not delete this line: ` +
      `it is how the ${identity.cadence} full run finds this card instead of filing a new one ${words.every}.`,
    '',
    `# ${identity.title}`,
    '',
    `_Swept ${sweptAt} · [run log](${runUrl}) · commit \`${headSha}\` · conclusion \`${conclusion}\`._`,
    '',
    ...words.about(identity.workflowName),
    '',
    `⛔ The remedy is never to narrow, skip or delete the failing check to make the ${identity.cadence} run green.`,
    `Fix what it names and let the next ${identity.cadence} run refresh this card; a card nobody reopens is closed by`,
    'the next green run being uneventful, not by editing this one.',
    '',
    ...suspects,
    CARD_FOOTER,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

// ---------------------------------------------------------------------------
// HALF 3 -- the release reads the full battery (#22998)
// ---------------------------------------------------------------------------
//
// A PR or queue build carries the FAST SET since #22998 (ci.yml's THE TWO
// SPEEDS); the dogfood, temporal and console-pin legs run only on `main`'s
// push, hourly schedule and dispatch runs. "Tested before a release" is
// therefore a statement about those runs, and this half makes it a gate:
// release.yml's `full-battery` job, which `publish` needs, so a refusal here
// means no deployment is queued at the `release` environment at all.
//
// THE SELECTION RULE, per workflow (`CI`, `Lint & Type Check`, `Spec Shape
// Gate`), pinned below:
//
//   1. candidates are runs whose event is `schedule` or `push`, on `main`,
//      `completed`, whose head is the release commit or one of its first-parent
//      ancestors in the window read from git;
//   2. a `cancelled` run carries no verdict and is passed over -- push runs on
//      `main` cancel each other (62 of 100 `CI` push runs and 81 of 100
//      `Lint & Type Check` push runs in the 2026-10-12 recording), so counting
//      them would refuse nearly every release for a reason that says nothing
//      about the tree;
//   3. the NEAREST commit with a candidate decides, and on that commit the
//      newest run (`run_started_at`, which a re-run moves) -- so an older
//      green never outvotes a newer red, and a re-run that went green after a
//      flake does count;
//   4. the release passes only when EVERY workflow's chosen run concluded
//      `success`; every other conclusion, and no candidate at all, refuses.
//
// ⛔ It never waits and never reads a run AFTER the release commit: a run on a
// later `main` head tested a different tree. ⚠️ A `push` run's Test Core is
// affected-only (#16467), so a push run is a narrower verdict than an hourly
// one; the ruled rule reads both events, and that narrowing is recorded on
// #22998 rather than decided here.

// The workflows whose full-battery runs the release reads, by file (the API's
// stable key) and by the name a reader sees.
export const RELEASE_GATE_WORKFLOWS = Object.freeze([
  Object.freeze({ file: 'ci.yml', name: 'CI' }),
  Object.freeze({ file: 'lint.yml', name: 'Lint & Type Check' }),
  // The spec shape gate (ruling B, comment 6145029395 on #23238): objectui
  // `main` compiled against the spec built from the commit, hourly on `main`.
  // It has no `push` trigger, so only its `schedule` runs qualify here; a run
  // whose every diagnostic is a registered retirement concluded `success` and
  // counts as green, an unregistered break concluded `failure` and refuses.
  Object.freeze({ file: 'spec-shape-gate.yml', name: 'Spec Shape Gate' }),
]);

// The events that carry the full battery on `main`, and the one conclusion that
// carries no verdict. Both closed on purpose: widening either is a decision
// about what "tested" means, never a spelling fix.
export const FULL_BATTERY_EVENTS = Object.freeze(['schedule', 'push']);
export const NO_VERDICT_CONCLUSIONS = Object.freeze(['cancelled']);

// The workflow file that wires this half, as a quoted repo-relative literal so
// the dispatch derivation schedules this family for a card touching it.
export const RELEASE_WORKFLOW = '.github/workflows/release.yml';
// The job id in it that runs `--release-gate`, and the job that must need it.
export const RELEASE_GATE_JOB = 'full-battery';
export const RELEASE_PUBLISH_JOB = 'publish';

// How many first-parent commits the window spans, and how many pages of 100
// completed runs per event per workflow are read. Generous against an hourly
// cadence: the nearest verdict is normally a handful of commits back.
export const RELEASE_GATE_WINDOW = 400;
export const RELEASE_GATE_PAGES = 3;

const startedAt = (run) => String(run?.run_started_at ?? run?.created_at ?? '');

// Rule 1-3: the run that decides for one workflow, or null when none qualifies.
export function selectFullBatteryRun({ history, runs, workflowFile }) {
  const position = new Map((history ?? []).map((sha, index) => [sha, index]));
  const candidates = (runs ?? []).filter(
    (run) =>
      FULL_BATTERY_EVENTS.includes(run?.event) &&
      run?.head_branch === 'main' &&
      run?.status === 'completed' &&
      !NO_VERDICT_CONCLUSIONS.includes(run?.conclusion) &&
      position.has(run?.head_sha) &&
      (run?.path === undefined || String(run.path).endsWith(`/${workflowFile}`))
  );
  candidates.sort(
    (a, b) =>
      position.get(a.head_sha) - position.get(b.head_sha) ||
      startedAt(b).localeCompare(startedAt(a)) ||
      Number(b.id) - Number(a.id)
  );
  const run = candidates[0];
  return run ? { run, distance: position.get(run.head_sha) } : null;
}

// Rule 4, over both workflows. `history[0]` is the release commit.
export function releaseGateVerdict({ history, runsByWorkflow, workflows = RELEASE_GATE_WORKFLOWS }) {
  const releaseCommit = history?.[0] ?? '';
  if (!releaseCommit) {
    return { ok: false, lines: [], refusals: ['no first-parent history was read, so no run can be placed at or before the release commit'] };
  }
  const lines = [];
  const refusals = [];
  for (const { file, name } of workflows) {
    const chosen = selectFullBatteryRun({ history, runs: runsByWorkflow?.[file], workflowFile: file });
    if (!chosen) {
      refusals.push(
        `${name}: no completed ${FULL_BATTERY_EVENTS.join(' or ')} run on main at or before ${releaseCommit.slice(0, 10)} ` +
          `in the ${history.length}-commit window (a cancelled run carries no verdict)`
      );
      continue;
    }
    const { run, distance } = chosen;
    const where = `run ${run.id} (${run.event}, attempt ${run.run_attempt ?? 1}) on ${String(run.head_sha).slice(0, 10)}, ${distance} first-parent commit(s) before the release commit`;
    lines.push(`${name}: ${run.conclusion} -- ${where}`);
    if (run.conclusion !== 'success') {
      refusals.push(`${name}: the newest full-battery run at or before the release commit concluded ${run.conclusion} -- ${where}`);
    }
  }
  return { ok: refusals.length === 0, lines, refusals };
}

// The exit a verdict maps to: 0 pass, EXIT_FINDINGS refuse.
export function releaseGateExit(verdict) {
  return verdict?.ok === true ? 0 : EXIT_FINDINGS;
}

// The wiring the verdict depends on, read from release.yml as TEXT (this file
// takes no dependency beyond node): the gate job runs `--release-gate`, the
// publish job needs it, and publish's `if:` opens with `success()` -- under
// `!cancelled()` a failed gate would no longer stop the publish.
function jobBlocks(yamlText) {
  const lines = String(yamlText).split('\n');
  const start = lines.findIndex((line) => line === 'jobs:');
  const blocks = new Map();
  if (start === -1) return blocks;
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      current = m[1];
      blocks.set(current, []);
      continue;
    }
    if (current) blocks.get(current).push(line);
  }
  return blocks;
}

export function releaseGateWiring(yamlText) {
  const findings = [];
  const blocks = jobBlocks(yamlText);
  if (blocks.size === 0) return [`${RELEASE_WORKFLOW} has no \`jobs:\` block this reader can see`];
  const gate = blocks.get(RELEASE_GATE_JOB);
  const code = (block) => block.filter((line) => !/^\s*#/.test(line));
  if (!gate) {
    findings.push(`${RELEASE_WORKFLOW} has no \`${RELEASE_GATE_JOB}\` job`);
  } else {
    if (!code(gate).some((line) => /node scripts\/ci\/scheduled-full-run\.mjs --release-gate\b/.test(line))) {
      findings.push(`${RELEASE_WORKFLOW} job \`${RELEASE_GATE_JOB}\` never runs \`scripts/ci/scheduled-full-run.mjs --release-gate\``);
    }
    if (code(gate).some((line) => /^\s*continue-on-error:\s*true\b/.test(line))) {
      findings.push(`${RELEASE_WORKFLOW} job \`${RELEASE_GATE_JOB}\` sets continue-on-error, so its refusal cannot conclude failure`);
    }
  }
  const publish = blocks.get(RELEASE_PUBLISH_JOB);
  if (!publish) {
    findings.push(`${RELEASE_WORKFLOW} has no \`${RELEASE_PUBLISH_JOB}\` job`);
    return findings;
  }
  const needsLine = code(publish).find((line) => /^ {4}needs:/.test(line)) ?? '';
  const needs = needsLine.replace(/^ {4}needs:\s*/, '').replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!needs.includes(RELEASE_GATE_JOB)) {
    findings.push(`${RELEASE_WORKFLOW} job \`${RELEASE_PUBLISH_JOB}\` does not need \`${RELEASE_GATE_JOB}\` (needs: ${needs.join(', ') || 'none'})`);
  }
  const ifAt = code(publish).findIndex((line) => /^ {4}if:/.test(line));
  const ifText = ifAt === -1 ? '' : code(publish).slice(ifAt).join('\n');
  const firstTerm = ifText.replace(/^ {4}if:\s*(>-|\|)?\s*/, '').trim();
  if (!firstTerm.startsWith('success() &&')) {
    findings.push(`${RELEASE_WORKFLOW} job \`${RELEASE_PUBLISH_JOB}\`'s \`if:\` does not open with \`success() &&\`, so a refused \`${RELEASE_GATE_JOB}\` would not stop it`);
  }
  return findings;
}

// -- The live half: git for the window, the Actions API for the runs. --------

function git(args) {
  const res = spawnSync('git', args, { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(res.stderr || res.error || '').trim()}`);
  return res.stdout.trim();
}

export function readFirstParentHistory(releaseCommit, window = RELEASE_GATE_WINDOW) {
  if (!/^[0-9a-f]{40}$/.test(String(releaseCommit))) {
    throw new Error(`the release commit '${releaseCommit}' is not a 40-hex sha`);
  }
  if (git(['rev-parse', '--is-shallow-repository']) !== 'false') {
    throw new Error('shallow clone: a first-parent window read here would stop at the graft, so the checkout must keep fetch-depth: 0');
  }
  return git(['rev-list', '--first-parent', `--max-count=${window}`, releaseCommit]).split('\n').filter(Boolean);
}

// ONE READ OF THE LISTING, RETRIED ONLY WHEN THE FAILURE IS TRANSIENT (#24741).
// One HTTP 502 on `lint.yml`'s `schedule` listing used to refuse a publish as
// NOT MEASURED with no second attempt: release run 39230668843, whose every
// full-battery verdict was green, shipped only after a manual re-run and a
// second `release` approval. Each page is now read through the citation gate's
// policy (`BOARD_READ_RETRY` in `../check-issue-citations.mjs`, whose docblock
// is the measurement):
//
//   retried      an HTTP 5xx, or a named connection failure (ECONNRESET,
//                UND_ERR_SOCKET) -- 3 attempts per read, 500 / 1000 ms apart;
//   final        any 4xx, an OK body with no `workflow_runs` array, and every
//                other error, on the first attempt.
//
// `budget` is the RUN's: `readFullBattery` creates one and hands it to every
// workflow x event x page it reads, so a flapping API costs one release gate
// at most `BOARD_READ_RETRY.retriesPerRun` retries, never that many per read.
// The default here exists for a caller that reads one listing on its own.
//
// ⛔ Not a weaker gate. A read whose ladder or budget is spent is thrown as the
// failure it is, its text naming the last answer and the attempts made, and the
// release gate turns that into the same NOT MEASURED refusal and exit as before.
export async function readRuns({ repo, token, file, event, pages = RELEASE_GATE_PAGES, fetchImpl = fetch, budget = boardReadBudget() }) {
  const runs = [];
  for (let page = 1; page <= pages; page += 1) {
    const url =
      `https://api.github.com/repos/${repo}/actions/workflows/${file}/runs` +
      `?branch=main&event=${event}&status=completed&per_page=100&page=${page}`;
    const read = await readBoard(
      fetchImpl,
      url,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } },
      budget
    );
    if (!read.ok) throw readFailure(`GET ${url}`, read, budget.policy);
    // An OK answer without the array is an answer about the endpoint, not a
    // blip: final, and never retried.
    const batch = Array.isArray(read.body?.workflow_runs) ? read.body.workflow_runs : null;
    if (!batch) throw new Error(`GET ${url} answered no workflow_runs array`);
    runs.push(...batch);
    if (batch.length < 100) break;
  }
  return runs;
}

// Every listing one release gate reads, under ONE retry budget for the run.
export async function readFullBattery({ repo, token, workflows = RELEASE_GATE_WORKFLOWS, fetchImpl = fetch, budget = boardReadBudget() }) {
  const runsByWorkflow = {};
  for (const { file } of workflows) {
    runsByWorkflow[file] = [];
    for (const event of FULL_BATTERY_EVENTS) runsByWorkflow[file].push(...(await readRuns({ repo, token, file, event, fetchImpl, budget })));
  }
  return runsByWorkflow;
}

// The gate, as lines to print and an exit code. Both reads are injectable --
// `readHistory` (git) and `fetchImpl` / `sleep` (the Actions API) -- so the
// self-test drives the whole read path offline, refusal text included.
export async function runReleaseGate({ releaseCommit, repo, token, readHistory = readFirstParentHistory, fetchImpl = fetch, sleep } = {}) {
  const budget = boardReadBudget({ sleep });
  let history;
  let runsByWorkflow;
  try {
    if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are both required');
    history = readHistory(releaseCommit);
    runsByWorkflow = await readFullBattery({ repo, token, fetchImpl, budget });
  } catch (error) {
    return {
      exit: EXIT_PREREQUISITE_NOT_MET,
      lines: [`::error::release gate NOT MEASURED -- ${error.message}. Refusing: an unread full battery is not a green one.`],
      verdict: null,
    };
  }
  const verdict = releaseGateVerdict({ history, runsByWorkflow });
  const lines = verdict.lines.map((line) => `scheduled-full-run --release-gate: ${line}`);
  if (verdict.ok) {
    lines.push(`scheduled-full-run --release-gate: PASS -- the full battery at or before ${String(releaseCommit).slice(0, 10)} is green in every workflow (${RELEASE_GATE_WORKFLOWS.map((w) => w.name).join(', ')}).`);
  } else {
    for (const refusal of verdict.refusals) lines.push(`::error::release refused -- ${refusal}`);
  }
  return { exit: releaseGateExit(verdict), lines, verdict };
}

async function releaseGate(argv) {
  const at = argv.indexOf('--release-commit');
  const releaseCommit = at === -1 ? '' : String(argv[at + 1] ?? '');
  const { exit, lines } = await runReleaseGate({
    releaseCommit,
    repo: process.env.GITHUB_REPOSITORY ?? '',
    token: process.env.GITHUB_TOKEN ?? '',
  });
  for (const line of lines) console.log(line);
  process.exit(exit);
}

// ---------------------------------------------------------------------------
// -- The self-test's own battery roster and floor ---------------------------
//
// Same shape as its siblings: what is pinned is the registered NAMES, and each
// count is a FLOOR -- a battery below it means cases stopped running, and the
// remedy is to find what stopped registering, never to lower the number.
const SELF_TEST_BATTERIES = Object.freeze({
  'scheduled-full-run concurrency isolation': 32,
  'scheduled-full-run card identity and de-dup': 34,
  'card refresh: a stale pm:blocked (the measured #23885 sequence)': 22,
  'release gate: the selection rule on the recorded 2026-10-12 listing': 8,
  'release gate: the selection rule on synthetic runs': 17,
  'release gate: the read path retries a transient answer, inside one budget per run': 16,
  'release gate: release.yml wiring': 6,
});
const SELF_TEST_BATTERY_FLOOR = 7;
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Returned by `selfTest()` only after its verdict is printed, so a `return`
// that leaves the function early cannot report as a pass.
const SELF_TEST_VERDICT = 'scheduled-full-run self-test reached its verdict';

async function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  // AWAITS its case. Half the cases below drive `findExistingCard`, which is
  // async because the live caller pages the API; a `check` that only CALLED an
  // async case would register it, return, and let its rejection surface as an
  // unhandled promise -- a self-test that reports a pass while a case failed.
  const check = async (fn) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
    await fn();
  };
  const threw = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  const threwAsync = async (fn) => {
    try {
      await fn();
      return false;
    } catch {
      return true;
    }
  };

  battery('scheduled-full-run concurrency isolation');

  // -- The reader. It must find the WORKFLOW-level group and refuse a file that
  //    has none, because "no group" would otherwise evaluate to two equal
  //    empty strings and read as a collision that is not there.
  const SAMPLE = [
    'name: X',
    'on:',
    '  push:',
    'concurrency:',
    "  group: g-${{ github.event_name }}-${{ github.ref }}",
    '  cancel-in-progress: true',
    'jobs:',
    '  a:',
    '    concurrency:',
    '      group: job-level-must-not-be-read',
  ].join('\n');
  await check(() => {
    if (readConcurrencyGroup(SAMPLE) !== 'g-${{ github.event_name }}-${{ github.ref }}') {
      throw new Error(`reader: got '${readConcurrencyGroup(SAMPLE)}'`);
    }
  });
  await check(() => {
    if (!threw(() => readConcurrencyGroup('name: X\njobs:\n  a:\n    concurrency:\n      group: g\n'))) {
      throw new Error('reader: a job-level group was read as the workflow-level one');
    }
  });
  await check(() => {
    if (!threw(() => readConcurrencyGroup('concurrency:\n  cancel-in-progress: true\n'))) {
      throw new Error('reader: a `concurrency:` block with no `group:` was accepted');
    }
  });

  // -- The evaluator, including the falls-through and the refusal.
  await check(() => {
    const ctx = eventContext('pull_request', { workflow: 'CI', prNumber: 12 });
    const got = evaluateExpression('github.event.pull_request.number || github.ref', ctx);
    if (got !== '12') throw new Error(`evaluator: expected '12', got '${got}'`);
  });
  await check(() => {
    const ctx = eventContext('push', { workflow: 'CI' });
    const got = evaluateExpression('github.event.pull_request.number || github.ref', ctx);
    if (got !== 'refs/heads/main') throw new Error(`evaluator: '||' did not fall through, got '${got}'`);
  });
  // The context carries each event's REAL payload keys (#25373): `after` on a
  // push, none on schedule/dispatch/queue, and the PR number before it on a PR.
  const KEY = 'github.event.pull_request.number || github.event.after || github.ref';
  await check(() => {
    const got = evaluateExpression(KEY, eventContext('push', { sha: '3'.repeat(40) }));
    if (got !== '3'.repeat(40)) throw new Error(`context: a push did not resolve to its commit, got '${got}'`);
  });
  await check(() => {
    for (const eventName of ['schedule', 'workflow_dispatch']) {
      const got = evaluateExpression(KEY, eventContext(eventName, { sha: '3'.repeat(40) }));
      if (got !== 'refs/heads/main') throw new Error(`context: ${eventName} grew an \`after\`, got '${got}'`);
    }
  });
  await check(() => {
    const got = evaluateExpression(KEY, eventContext('merge_group', { sha: '3'.repeat(40) }));
    if (!got.startsWith('refs/heads/gh-readonly-queue/')) throw new Error(`context: merge_group resolved to '${got}'`);
  });
  await check(() => {
    const got = evaluateExpression(KEY, eventContext('pull_request', { prNumber: 12, sha: '3'.repeat(40) }));
    if (got !== '12') throw new Error(`context: a PR synchronize did not resolve to its number, got '${got}'`);
  });
  await check(() => {
    if (evaluateExpression("'literal'", eventContext('push')) !== 'literal') {
      throw new Error('evaluator: a quoted literal did not evaluate');
    }
  });
  await check(() => {
    if (!threw(() => evaluateExpression('github.event_name == 42', eventContext('push')))) {
      throw new Error('evaluator: an operand outside the grammar was guessed instead of refused');
    }
  });
  await check(() => {
    const got = evaluateGroup('ci-${{ github.workflow }}-${{ github.event_name }}', eventContext('schedule', { workflow: 'CI' }));
    if (got !== 'ci-CI-schedule') throw new Error(`evaluator: interpolation produced '${got}'`);
  });

  // -- The verdict. FIRING CONTROL first: the shape this gate exists to
  //    refuse -- today's key with `github.event_name` taken back out -- must
  //    be judged BAD, and it must be judged bad for the schedule/push pair by
  //    name. A gate that only ever reads the good shape is a gate that has
  //    never been shown to fail.
  const BAD = 'ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}';
  // The #16467 key: event-separated, but every push to main in ONE group, so
  // the next merge cancels the previous one before its tests finish (#25373).
  const SHARED_PUSH =
    'ci-${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}';
  const GOOD =
    'ci-${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.event.after || github.ref }}';
  await check(() => {
    const v = concurrencyVerdict(BAD, { workflow: 'CI' });
    if (v.ok) throw new Error('firing control: the pre-#16467 key was accepted');
  });
  await check(() => {
    const v = concurrencyVerdict(BAD, { workflow: 'CI' });
    if (!v.findings.some((f) => f.includes('`schedule`') && f.includes('`push`'))) {
      throw new Error(`firing control: the schedule/push collision was not named (${v.findings.join(' | ')})`);
    }
  });
  await check(() => {
    const v = concurrencyVerdict(BAD, { workflow: 'CI' });
    if (v.groups.schedule !== v.groups.push) throw new Error('firing control: the two groups were not actually equal');
  });
  await check(() => {
    const v = concurrencyVerdict(SHARED_PUSH, { workflow: 'CI' });
    if (v.ok) throw new Error('firing control: the shared push key (one group for every merge) was accepted');
  });
  await check(() => {
    const v = concurrencyVerdict(SHARED_PUSH, { workflow: 'CI' });
    if (!v.findings.some((f) => f.includes('two pushes to main share'))) {
      throw new Error(`firing control: the push/push collision was not named (${v.findings.join(' | ')})`);
    }
  });
  await check(() => {
    const v = concurrencyVerdict(SHARED_PUSH, { workflow: 'CI' });
    if (v.findings.length !== 1) {
      throw new Error(`firing control: expected ONLY the push/push finding (${v.findings.join(' | ')})`);
    }
  });
  await check(() => {
    const v = concurrencyVerdict(GOOD, { workflow: 'CI' });
    if (!v.ok) throw new Error(`the fixed key was rejected: ${v.findings.join(' | ')}`);
  });
  await check(() => {
    const v = concurrencyVerdict(GOOD, { workflow: 'CI' });
    if (v.groups.push === v.groups.nextPush) throw new Error('the fixed key still puts two merges in one group');
  });
  await check(() => {
    const v = concurrencyVerdict(GOOD, { workflow: 'CI' });
    if (v.groups.schedule === v.groups.push) throw new Error('the fixed key still collapses schedule onto push');
  });

  // -- NONSENSE CONTROL. A key that separates every event by making every RUN
  //    unique passes the inequalities above and silently disables
  //    `cancel-in-progress` for every event, not only push. It must be refused,
  //    and so must the subtler `github.sha` spelling, which is run-unique on
  //    `schedule` too (each hour's `main` head) although it looks per-commit.
  for (const runUnique of ['ci-${{ github.run_id }}', 'ci-${{ github.event_name }}-${{ github.sha }}']) {
    await check(() => {
      const v = concurrencyVerdict(runUnique, { workflow: 'CI' });
      if (v.ok) throw new Error(`nonsense control: the run-unique key '${runUnique}' was accepted`);
    });
    await check(() => {
      const v = concurrencyVerdict(runUnique, { workflow: 'CI' });
      if (!v.findings.some((f) => f.includes('two `schedule` runs'))) {
        throw new Error(`nonsense control: expected the schedule-stability finding (${v.findings.join(' | ')})`);
      }
    });
  }
  await check(() => {
    // ...and a constant key, the other degenerate direction: every event in one
    // group, which is the collision this gate is about at maximum strength.
    const v = concurrencyVerdict('ci-fixed', { workflow: 'CI' });
    if (v.ok) throw new Error('nonsense control: a constant key was accepted');
  });

  // -- THE REAL FILES. The two workflows are read from disk and judged, so the
  //    gate's production verdict is exercised by its own self-test too.
  for (const file of WATCHED_WORKFLOWS) {
    await check(() => {
      const group = readConcurrencyGroup(readFileSync(file, 'utf8'));
      const v = concurrencyVerdict(group, { workflow: file });
      if (!v.ok) throw new Error(`${file}: ${v.findings.join(' | ')}`);
    });
    await check(() => {
      const group = readConcurrencyGroup(readFileSync(file, 'utf8'));
      const v = concurrencyVerdict(group, { workflow: file });
      if (v.groups.schedule === v.groups.push) {
        throw new Error(`${file}: schedule and push still evaluate to '${v.groups.push}'`);
      }
    });
    await check(() => {
      const group = readConcurrencyGroup(readFileSync(file, 'utf8'));
      const v = concurrencyVerdict(group, { workflow: file });
      if (v.groups.push === v.groups.nextPush) {
        throw new Error(`${file}: two merges to main still share the group '${v.groups.push}'`);
      }
    });
  }

  battery('scheduled-full-run card identity and de-dup');

  const ci = cardIdentity('CI');
  const lint = cardIdentity('Lint & Type Check');

  await check(() => {
    if (ci.title !== 'hourly full run: red on main (CI)') throw new Error(`identity: CI title is '${ci.title}'`);
  });
  await check(() => {
    if (lint.marker !== 'os-hourly-full-run-lint-type-check') throw new Error(`identity: lint marker is '${lint.marker}'`);
  });
  await check(() => {
    if (ci.marker === lint.marker || ci.title === lint.title) {
      throw new Error('identity: the two workflows share an identity, so one card would overwrite the other');
    }
  });
  await check(() => {
    if (/[<>]/.test(ci.marker) || /[<>]/.test(lint.marker)) {
      throw new Error('identity: the marker carries an angle bracket, which the body sanitizer eats');
    }
  });
  await check(() => {
    if (!threw(() => cardIdentity(''))) throw new Error('identity: an empty workflow name was accepted');
  });
  await check(() => {
    if (!threw(() => cardIdentity('!!!'))) throw new Error('identity: a name that slugs to nothing was accepted');
  });

  // -- Matching. Both ways in, and the three things that are NOT this card.
  const issue = (n, extra = {}) => ({ number: n, title: 'unrelated', body: '', ...extra });
  await check(() => {
    if (!matchesCard(issue(1, { title: ci.title }), ci)) throw new Error('match: the exact title did not match');
  });
  await check(() => {
    if (!matchesCard(issue(1, { title: `${ci.title} — since 09:00Z` }), ci)) {
      throw new Error('match: a title with a suffix did not match its prefix');
    }
  });
  await check(() => {
    if (!matchesCard(issue(1, { title: 'renamed by a human', body: `x\n${ci.marker}\ny` }), ci)) {
      throw new Error('match: the body marker did not match after a rename');
    }
  });
  await check(() => {
    if (matchesCard(issue(1, { title: ci.title, pull_request: { url: 'u' } }), ci)) {
      throw new Error('match: a PULL REQUEST with the card title matched');
    }
  });
  await check(() => {
    if (matchesCard(issue(1, { title: lint.title, body: lint.marker }), ci)) {
      throw new Error("match: the Lint card matched CI's identity");
    }
  });
  await check(() => {
    if (matchesCard(issue(1), ci)) throw new Error('match: an unrelated issue matched');
  });

  // -- The de-dup decision. The firing control is the pair that matters:
  //    ONE red run with no existing card creates, and the SECOND finds it.
  const page = (items) => async (n) => (n === 1 ? items : []);
  await check(async () => {
    if ((await findExistingCard({ identity: ci, listPage: page([]) })) !== null) {
      throw new Error('de-dup: an empty board reported an existing card');
    }
  });
  const firstCard = { number: 42, title: ci.title, body: ci.marker };
  await check(async () => {
    const found = await findExistingCard({ identity: ci, listPage: page([issue(7), firstCard]) });
    if (found?.number !== 42) throw new Error(`de-dup: the existing card was not found (${found?.number})`);
  });
  await check(async () => {
    const found = await findExistingCard({
      identity: ci,
      listPage: page([{ number: 99, title: ci.title }, firstCard]),
    });
    if (found?.number !== 42) throw new Error(`de-dup: the OLDEST duplicate did not win (${found?.number})`);
  });
  await check(async () => {
    const found = await findExistingCard({ identity: ci, listPage: page([{ number: 42, title: lint.title, body: lint.marker }]) });
    if (found !== null) throw new Error("de-dup: the Lint card was taken for CI's, so one would overwrite the other");
  });
  await check(async () => {
    // A truncated scan cannot establish absence, so it must refuse rather than
    // file. Full pages forever is what that looks like.
    const full = async () => Array.from({ length: 100 }, (_, i) => issue(i + 1));
    if (!(await threwAsync(() => findExistingCard({ identity: ci, listPage: full, maxPages: 3 })))) {
      throw new Error('de-dup: a truncated scan was treated as established absence');
    }
  });
  await check(async () => {
    // ...and a listing that ends exactly on a full page is COMPLETE.
    const pages = [Array.from({ length: 100 }, (_, i) => issue(i + 1)), [firstCard]];
    const found = await findExistingCard({ identity: ci, listPage: async (n) => pages[n - 1] ?? [], maxPages: 3 });
    if (found?.number !== 42) throw new Error('de-dup: a multi-page scan lost the card');
  });

  // -- The cadence (#23880): each cadence, the back-compat pins for the card
  //    already open under the hourly identity, and the refusal of a workflow
  //    the closed map does not name.
  const OPEN_CI_TITLE = 'hourly full run: red on main (CI)';
  const OPEN_CI_MARKER = 'os-hourly-full-run-ci';
  const OPEN_CI_MARKER_LINE =
    'os-hourly-full-run-ci — machine-findable marker for this generated card. ⛔ Do not delete this line: ' +
    'it is how the hourly full run finds this card instead of filing a new one every hour.';
  const bodiesOf = (identityUnderTest) => [
    renderBody({ identity: identityUnderTest, runUrl: 'u', headSha: 'a', conclusion: 'failure', sweptAt: 't',
      previousGreen: { run_id: 4, head_sha: 'b' }, commits: [{ sha: 'c', title: 'x' }] }),
    renderBody({ identity: identityUnderTest, runUrl: 'u', headSha: 'a', conclusion: 'failure', sweptAt: 't',
      previousGreen: { run_id: 4, head_sha: 'b' }, commits: [] }),
    renderBody({ identity: identityUnderTest, runUrl: 'u', headSha: 'a', conclusion: 'failure', sweptAt: 't', rangeNote: 'n' }),
  ];
  await check(() => {
    if (ci.cadence !== 'hourly' || ci.title !== OPEN_CI_TITLE || ci.marker !== OPEN_CI_MARKER) {
      throw new Error(`cadence: the CI identity moved (${ci.cadence}, '${ci.title}', '${ci.marker}') -- the open card would be duplicated`);
    }
  });
  await check(() => {
    for (const b of bodiesOf(ci)) {
      if (b.split('\n')[0] !== OPEN_CI_MARKER_LINE) throw new Error(`cadence: the CI marker line moved: '${b.split('\n')[0]}'`);
    }
  });
  await check(async () => {
    // The open CI card exactly as it was filed before the cadence existed.
    const open = { number: 23885, title: OPEN_CI_TITLE, body: `${OPEN_CI_MARKER_LINE}\n# ${OPEN_CI_TITLE}` };
    const found = await findExistingCard({ identity: cardIdentity('CI'), listPage: page([issue(7), open]) });
    if (found?.number !== 23885) throw new Error(`cadence: the open CI card was not found by its title (${found?.number})`);
  });
  await check(async () => {
    const renamed = { number: 23885, title: 'renamed by a human', body: `${OPEN_CI_MARKER_LINE}\n` };
    const found = await findExistingCard({ identity: cardIdentity('CI'), listPage: page([renamed]) });
    if (found?.number !== 23885) throw new Error('cadence: the open CI card was not found by its marker alone');
  });
  await check(() => {
    if (lint.cadence !== 'hourly' || lint.title !== 'hourly full run: red on main (Lint & Type Check)') {
      throw new Error(`cadence: Lint & Type Check is not hourly ('${lint.title}')`);
    }
  });
  await check(() => {
    for (const b of bodiesOf(ci)) {
      if (/nightly|every night|the night before/.test(b)) throw new Error(`cadence: an hourly card body says nightly:\n${b}`);
    }
  });
  await check(() => {
    let message = '';
    try {
      cardIdentity('Spec Coverage');
    } catch (error) {
      message = error.message;
    }
    if (!message.includes('CARD_CADENCES')) {
      throw new Error(`cadence: a workflow outside the map was not refused by name (${message || 'accepted'})`);
    }
  });
  await check(() => {
    const { cadence: _dropped, ...handBuilt } = ci;
    if (!threw(() => renderBody({ identity: handBuilt, runUrl: 'u', headSha: 'a', conclusion: 'failure', sweptAt: 't' }))) {
      throw new Error('cadence: renderBody defaulted the cadence of an identity that carries none');
    }
  });

  // -- THE ACCEPTANCE SHAPE, driven end to end against a mutable board: one red
  //    run files exactly one card, and the NEXT red run refreshes that card and
  //    files no second one. This is the property the filer exists for, and a
  //    de-dup rule that is only ever exercised live gets its first test on the
  //    night it files its duplicate.
  const board = [];
  let nextNumber = 500;
  // None of these cards carries `pm:blocked`, so a refresh must read and
  // write nothing beyond the body: the four block callbacks THROW if reached.
  const unreachable = (name) => async () => {
    throw new Error(`sequence: a refresh of a card that is not pm:blocked called ${name}`);
  };
  const drive = async (identityUnderTest, bodyText) =>
    fileOrRefreshCard({
      identity: identityUnderTest,
      body: bodyText,
      ownerRepo: 'objectstack-ai/objectstack',
      listPage: async (n) => (n === 1 ? board.slice() : []),
      createIssue: async ({ title, body: b, labels }) => {
        const made = { number: (nextNumber += 1), title, body: b, labels };
        board.push(made);
        return made;
      },
      updateIssue: async ({ number, body: b }) => {
        const hit = board.find((i) => i.number === number);
        hit.body = b;
      },
      listComments: unreachable('listComments'),
      getIssue: unreachable('getIssue'),
      addLabels: unreachable('addLabels'),
      removeLabel: unreachable('removeLabel'),
    });

  const firstRun = await drive(ci, 'first body');
  await check(() => {
    if (firstRun.action !== 'filed') throw new Error(`sequence: the first red run did not file (${firstRun.action})`);
    if (board.length !== 1) throw new Error(`sequence: the first red run left ${board.length} card(s)`);
  });
  const secondRun = await drive(ci, 'second body');
  await check(() => {
    if (secondRun.action !== 'refreshed') throw new Error(`sequence: the second red run did not refresh (${secondRun.action})`);
    if (secondRun.number !== firstRun.number) throw new Error('sequence: the refresh went to a different card');
    if (board.length !== 1) throw new Error(`sequence: a second card was filed (board holds ${board.length})`);
    if (board[0].body !== 'second body') throw new Error('sequence: the refresh did not rewrite the body');
  });
  await check(() => {
    if (!board[0].labels?.includes('domain:devx')) throw new Error('sequence: the create did not apply the labels');
  });
  // The OTHER workflow going red in the same hour files its OWN card, and does
  // not overwrite the first. This is the one-card-per-workflow decision, driven.
  const lintRun = await drive(lint, 'lint body');
  await check(() => {
    if (lintRun.action !== 'filed') throw new Error(`sequence: the second workflow refreshed CI's card (${lintRun.action})`);
    if (board.length !== 2) throw new Error(`sequence: expected two cards, board holds ${board.length}`);
    if (board[0].body !== 'second body') throw new Error("sequence: the Lint filer overwrote CI's body");
  });
  await check(() => {
    // ...and a third CI red still refreshes CI's card, with the Lint card now
    // on the board -- the case a title-prefix rule gets wrong if it is loose.
    return drive(ci, 'third body').then((r) => {
      if (r.action !== 'refreshed' || r.number !== firstRun.number || board.length !== 2) {
        throw new Error(`sequence: with both cards open, CI's third red did not refresh its own (${r.action}, ${r.number}, ${board.length})`);
      }
    });
  });

  // -- The body. What is pinned is that the parts a reader needs survive.
  const body = renderBody({
    identity: ci,
    runUrl: 'https://example.invalid/run/5',
    headSha: 'abcdef1234567890',
    conclusion: 'failure',
    sweptAt: '2026-09-08T04:00:00.000Z',
    previousGreen: { run_id: 4, head_sha: '1111111111222222' },
    commits: [{ sha: '9999999999000000', title: 'feat: a thing\n\nbody' }],
    compareUrl: 'https://example.invalid/compare',
  });
  await check(() => {
    if (!body.startsWith(ci.marker)) throw new Error('body: the marker is not the first thing in it');
  });
  await check(() => {
    for (const fragment of ['https://example.invalid/run/5', '9999999999', 'feat: a thing', '1111111111']) {
      if (!body.includes(fragment)) throw new Error(`body: '${fragment}' is missing`);
    }
  });
  await check(() => {
    if (body.includes('\n\nbody')) throw new Error('body: a commit message body leaked past its first line');
  });
  await check(() => {
    const empty = renderBody({
      identity: ci,
      runUrl: 'u',
      headSha: 'a',
      conclusion: 'failure',
      sweptAt: 't',
      previousGreen: { run_id: 4, head_sha: 'b' },
      commits: [],
    });
    if (!empty.includes('FLAKE')) throw new Error('body: an empty commit range did not name the flake reading');
  });
  await check(() => {
    const none = renderBody({
      identity: ci,
      runUrl: 'u',
      headSha: 'a',
      conclusion: 'failure',
      sweptAt: 't',
      rangeNote: 'the compare call failed with HTTP 422',
    });
    if (!none.includes('No commit range could be named') || !none.includes('HTTP 422')) {
      throw new Error("body: a missing range, or the caller's reason for it, was not reported");
    }
  });

  // ── A STALE `pm:blocked` on the card a refresh rewrites ─────────────────
  battery('card refresh: a stale pm:blocked (the measured #23885 sequence)');
  const OWNER_REPO = 'objectstack-ai/objectstack';
  const CARD_LABELS = ['bug', 'priority:p1', 'domain:devx'];
  // The triage seat's parking comment on #23885 (6215815177), VERBATIM: the
  // line is DECORATED (a bullet and bold), and the comment also names #23908,
  // #23784, #6015 and objectstack-ai/objectui#12666 mid-sentence -- prose,
  // none of them a target.
  const TRIAGE_PARK = [
    '## Triage: `pm:blocked` on #23908 · triage seat · `session_01AavokzJ5DndAwitDXvKy4U` · 2026-10-16T12:46Z',
    '',
    'Triage seat (objectstack-wide, seat post #6015). ⛔ Not a claim, ⛔ not a dispatch.',
    '',
    "- `domain:devx` seat 2's diagnosis `6214926932` reads this red as the Console Pin Gate failing on " +
      '`checkPageComponentViewData`, which #23784 deleted while objectui still imports it. The fix card is ' +
      '#23908 (`domain:spec`, p1), and its objectui half is objectstack-ai/objectui#12666.',
    "- **Blocked-by: #23908.** This line is in a comment because the hourly run rewrites this card's body. " +
      'The card keeps its p1 and `domain:devx`, and closes on the next green hourly run, as its body says.',
    '- If the next hourly run names a second failing job, that job is new work, and this label comes off.',
    '',
  ].join('\n');
  const DIAGNOSIS = '## Diagnosis: the Console Pin Gate is red because #23784 deleted an export objectui still imports';
  const redBody = (sweptAt, headSha) =>
    renderBody({ identity: ci, runUrl: 'https://example.invalid/run/39102557508', headSha, conclusion: 'failure',
      sweptAt, previousGreen: { run_id: 39098000000, head_sha: '8eccf519de' + '0'.repeat(30) },
      commits: [{ sha: headSha, title: 'feat(spec)!: a retirement that edits a cli test' }] });
  const OLD_BODY = redBody('2026-10-16T11:27:26.000Z', 'a35f7a6764' + '0'.repeat(30));
  const NEW_BODY = redBody('2026-10-18T06:30:24.000Z', '14a8bd2693' + '0'.repeat(30));
  const notFound = (message) => Object.assign(new Error(message), { status: 404 });
  // ONE card on the board, its thread, the state of every other issue, and a
  // log of every call the refresh makes, in order.
  const blockBoard = ({
    labels = [...CARD_LABELS, BLOCKED_LABEL], assignees = [], comments = [], states = {}, cardBody = OLD_BODY,
    commentPages = null, failComments = null, failAdd = null, failRemove = null,
  } = {}) => {
    const card = { number: 23885, title: OPEN_CI_TITLE, body: cardBody,
      labels: labels.map((name) => ({ name })), assignees: assignees.map((login) => ({ login })) };
    const calls = [];
    const callbacks = {
      ownerRepo: OWNER_REPO,
      listPage: async (n) => (n === 1 ? [card] : []),
      createIssue: async () => {
        throw new Error('a refresh case filed a card');
      },
      updateIssue: async ({ number, body: b }) => {
        calls.push(`updateIssue #${number}`);
        card.body = b;
      },
      listComments: async ({ number, page }) => {
        calls.push(`listComments #${number} p${page}`);
        if (failComments) throw failComments;
        if (commentPages) return commentPages(page);
        return page === 1 ? comments.map((c) => ({ body: c })) : [];
      },
      getIssue: async ({ repo, number }) => {
        calls.push(`getIssue ${repo}#${number}`);
        const state = states[`${repo}#${number}`];
        if (!state) throw notFound('Not Found');
        return { state, closed_at: state === 'closed' ? '2026-10-16T13:20:00Z' : null };
      },
      addLabels: async ({ number, labels: add }) => {
        calls.push(`addLabels #${number} ${add.join(',')}`);
        if (failAdd) throw failAdd;
        for (const name of add) if (!card.labels.some((l) => l.name === name)) card.labels.push({ name });
      },
      removeLabel: async ({ number, name }) => {
        calls.push(`removeLabel #${number} ${name}`);
        if (failRemove) throw failRemove;
        const at = card.labels.findIndex((l) => l.name === name);
        if (at === -1) throw notFound('Label does not exist');
        card.labels.splice(at, 1);
      },
    };
    return {
      card,
      calls,
      callbacks,
      names: () => card.labels.map((l) => l.name).sort().join(','),
      refresh: (bodyText = NEW_BODY) => fileOrRefreshCard({ identity: ci, body: bodyText, ...callbacks }),
    };
  };
  const sorted = (list) => [...list].sort().join(',');
  const labelCalls = (calls) => calls.filter((c) => c.startsWith('addLabels') || c.startsWith('removeLabel'));
  const untouched = (b, outcome, verdict) => {
    if (outcome.action !== 'refreshed' || outcome.block !== verdict) {
      throw new Error(`expected a refresh judged '${verdict}', got ${outcome.action} '${outcome.block}' (${outcome.blockSummary})`);
    }
    if (labelCalls(b.calls).length > 0) throw new Error(`'${verdict}' wrote labels: ${labelCalls(b.calls).join(' | ')}`);
    if (b.names() !== sorted([...CARD_LABELS, BLOCKED_LABEL]) && verdict !== 'not-blocked') {
      throw new Error(`'${verdict}' changed the label set to ${b.names()}`);
    }
  };

  // THE MEASURED SEQUENCE: blocked on #23908 by a comment, #23908 closed, a
  // NEW red, then the refresh.
  const measured = blockBoard({ comments: [DIAGNOSIS, TRIAGE_PARK],
    states: { 'objectstack-ai/objectstack#23908': 'closed' } });
  const measuredOutcome = await measured.refresh();
  await check(() => {
    if (measuredOutcome.action !== 'refreshed' || measuredOutcome.block !== 'expired') {
      throw new Error(`measured: expected a refresh judged 'expired', got ${measuredOutcome.action} '${measuredOutcome.block}' (${measuredOutcome.blockSummary})`);
    }
    if (measured.names() !== sorted([...CARD_LABELS, QUEUE_LABEL])) {
      throw new Error(`measured: the card should hold its three grade labels and ${QUEUE_LABEL}, holds ${measured.names()}`);
    }
  });
  await check(() => {
    // The two write verbs and nothing else, in this order, and BEFORE the body.
    const writes = measured.calls.filter((c) => !c.startsWith('listComments') && !c.startsWith('getIssue'));
    const want = [`addLabels #23885 ${QUEUE_LABEL}`, `removeLabel #23885 ${BLOCKED_LABEL}`, 'updateIssue #23885'];
    if (writes.join(' | ') !== want.join(' | ')) throw new Error(`measured: the writes were ${writes.join(' | ')}`);
  });
  await check(() => {
    // The decorated line is read; the four mid-sentence refs are not.
    const reads = measured.calls.filter((c) => c.startsWith('getIssue'));
    if (reads.join(' | ') !== 'getIssue objectstack-ai/objectstack#23908') {
      throw new Error(`measured: expected exactly the #23908 read, got ${reads.join(' | ') || 'none'}`);
    }
  });
  await check(() => {
    const lines = measured.card.body.split('\n');
    if (lines[0] !== OPEN_CI_MARKER_LINE) throw new Error('measured: the refreshed body lost its marker line');
    if (lines.at(-1) !== CARD_FOOTER) throw new Error('measured: the note was not placed above the footer');
    for (const line of NEW_BODY.split('\n')) {
      if (!lines.includes(line)) throw new Error(`measured: the refreshed body dropped '${line}'`);
    }
    const note = lines.find((l) => l.startsWith('## State:')) ?? '';
    if (!note.includes(`\`${BLOCKED_LABEL}\` → \`${QUEUE_LABEL}\``) || !measured.card.body.includes('#23908 (closed')) {
      throw new Error(`measured: the body does not say the card moved, and why:\n${measured.card.body}`);
    }
  });
  await check(() => {
    // The note never becomes a marker for the reader it reports on.
    const read = blockerTargetsFor({ number: 23885, body: measured.card.body }, [], OWNER_REPO);
    if (read.length > 0) throw new Error(`measured: the refreshed body reads as a Blocked-by line (${read.map((r) => r.key).join(', ')})`);
  });
  await check(async () => {
    // The patrol agrees: on the same card H19 reports the block as outlived.
    // The refresh never releases a card the patrol would not call expired.
    const before = blockBoard({ comments: [DIAGNOSIS, TRIAGE_PARK], states: { 'objectstack-ai/objectstack#23908': 'closed' } });
    const judged = await judgeCardBlock({ issue: before.card, ownerRepo: OWNER_REPO, ...before.callbacks });
    if (judged.verdict !== 'expired') throw new Error(`patrol: the judgement alone said '${judged.verdict}'`);
    if (h19BlockOutlivedBlocker(before.card, judged.resolutions, OWNER_REPO) === null) {
      throw new Error('patrol: H19 does not call this block outlived, so the refresh released a card the patrol would hold');
    }
  });
  await check(async () => {
    // The NEXT red finds a `pm:queue` card: nothing read, no label, no note.
    const at = measured.calls.length;
    const next = await measured.refresh(NEW_BODY.replace('06:30:24', '07:30:00'));
    const after = measured.calls.slice(at);
    if (next.block !== 'not-blocked' || after.join(' | ') !== 'updateIssue #23885') {
      throw new Error(`measured: the next refresh did more than rewrite the body (${next.block}: ${after.join(' | ')})`);
    }
    if (measured.card.body.includes('## State:')) throw new Error('measured: the next refresh repeated the note');
  });

  // THE CONTROL: the same card, the blocker still OPEN -- the hourly reds are
  // the blocked failure itself, and the card stays `pm:blocked`.
  await check(async () => {
    const b = blockBoard({ comments: [DIAGNOSIS, TRIAGE_PARK], states: { 'objectstack-ai/objectstack#23908': 'open' } });
    untouched(b, await b.refresh(), 'held');
    if (b.card.body !== NEW_BODY) throw new Error('control: a held block wrote a note into the body');
  });
  // A mid-sentence mention is prose, never a marker.
  await check(async () => {
    const b = blockBoard({
      comments: [DIAGNOSIS, 'Seats park the `Blocked-by: #23908` line in comments, and the fix card is #23908.'],
      states: { 'objectstack-ai/objectstack#23908': 'closed' },
    });
    untouched(b, await b.refresh(), 'no-target');
    if (b.calls.some((c) => c.startsWith('getIssue'))) throw new Error('mid-sentence: a prose ref was resolved');
  });
  // Two targets, one still open: held, and BOTH were read.
  await check(async () => {
    const b = blockBoard({
      comments: [TRIAGE_PARK, 'Blocked-by: #24295'],
      states: { 'objectstack-ai/objectstack#23908': 'closed', 'objectstack-ai/objectstack#24295': 'open' },
    });
    untouched(b, await b.refresh(), 'held');
    if (b.calls.filter((c) => c.startsWith('getIssue')).length !== 2) throw new Error('two targets: not both were read');
  });
  // A card that is not `pm:blocked`: zero reads, zero label writes.
  await check(async () => {
    const b = blockBoard({ labels: [...CARD_LABELS, QUEUE_LABEL], comments: [TRIAGE_PARK],
      states: { 'objectstack-ai/objectstack#23908': 'closed' } });
    untouched(b, await b.refresh(), 'not-blocked');
    if (b.calls.join(' | ') !== 'updateIssue #23885') throw new Error(`not blocked: the refresh made ${b.calls.join(' | ')}`);
    if (b.names() !== sorted([...CARD_LABELS, QUEUE_LABEL])) throw new Error(`not blocked: labels became ${b.names()}`);
  });
  // An UNREAD target (cross-repo, 404 to this token) is never read as closed.
  await check(async () => {
    const b = blockBoard({ comments: ['Blocked-by: objectstack-ai/objectui#12666'] });
    untouched(b, await b.refresh(), 'held');
    if (!b.calls.includes('getIssue objectstack-ai/objectui#12666')) throw new Error('unread: the cross-repo target was not asked of its own repo');
  });
  // CONTROL: a cross-repo target read CLOSED holds the card too. Closed THERE
  // is merged upstream, not consumable HERE through the `.objectui-sha` pin, so
  // the next hourly red is the same failure -- alone, or beside a closed LOCAL
  // target, and named on the summary row as the reason.
  await check(async () => {
    const b = blockBoard({ comments: ['Blocked-by: objectstack-ai/objectui#12666'],
      states: { 'objectstack-ai/objectui#12666': 'closed' } });
    const outcome = await b.refresh();
    untouched(b, outcome, 'held');
    if (!outcome.blockSummary.includes('objectstack-ai/objectui#12666 closed upstream (not an unlock criterion for this consumer)')) {
      throw new Error(`cross-repo: the summary does not name the upstream closure as the reason (${outcome.blockSummary})`);
    }
    if (b.card.body !== NEW_BODY) throw new Error('cross-repo: a held block wrote a note into the body');
    const mixed = blockBoard({ comments: [TRIAGE_PARK, 'Blocked-by: objectstack-ai/objectui#12666'],
      states: { 'objectstack-ai/objectstack#23908': 'closed', 'objectstack-ai/objectui#12666': 'closed' } });
    untouched(mixed, await mixed.refresh(), 'held');
  });
  // An `Unlock-action:` line names an unlock other than closure: held, even
  // with every target closed and local.
  await check(async () => {
    const b = blockBoard({ comments: [TRIAGE_PARK, '- `Unlock-action: re-check #23908 when label pm:queue present`'],
      states: { 'objectstack-ai/objectstack#23908': 'closed' } });
    const outcome = await b.refresh();
    untouched(b, outcome, 'held');
    if (!outcome.blockSummary.includes('Unlock-action: re-check #23908 when label pm:queue present')) {
      throw new Error(`unlock-action: the summary does not name the line it held on (${outcome.blockSummary})`);
    }
    const inBody = blockBoard({ cardBody: `${OLD_BODY}\nUnlock-action: re-check PR #24305`, comments: [TRIAGE_PARK],
      states: { 'objectstack-ai/objectstack#23908': 'closed' } });
    untouched(inBody, await inBody.refresh(), 'held');
  });
  // A thread that cannot be read could hide an OPEN blocker: unjudged.
  await check(async () => {
    const b = blockBoard({ failComments: new Error('HTTP 502'), states: { 'objectstack-ai/objectstack#23908': 'closed' } });
    untouched(b, await b.refresh(), 'unjudged');
    if (b.card.body !== NEW_BODY) throw new Error('unreadable thread: the body was not refreshed as usual');
  });
  // ...and so could a thread longer than the read's bound.
  await check(async () => {
    const b = blockBoard({ commentPages: () => Array.from({ length: 100 }, () => ({ body: 'Blocked-by: #23908' })),
      states: { 'objectstack-ai/objectstack#23908': 'closed' } });
    untouched(b, await b.refresh(), 'unjudged');
  });
  // Assigned: the release is the holder's act. No label; the body says why.
  await check(async () => {
    const b = blockBoard({ assignees: ['sunhaolin'], comments: [TRIAGE_PARK],
      states: { 'objectstack-ai/objectstack#23908': 'closed' } });
    untouched(b, await b.refresh(), 'assigned');
    if (!b.card.body.includes('`sunhaolin`') || b.card.body.includes('moved by this refresh')) {
      throw new Error(`assigned: the body does not name the holder, or claims a move:\n${b.card.body}`);
    }
  });
  // A line a seat wrote into the OLD body is read too (both channels).
  await check(async () => {
    const b = blockBoard({ cardBody: `${OLD_BODY}\nBlocked-by: #23908`,
      states: { 'objectstack-ai/objectstack#23908': 'closed' } });
    if ((await b.refresh()).block !== 'expired') throw new Error('body channel: a body-borne line was not read');
  });
  // A card naming only itself names no blocker.
  await check(async () => {
    const b = blockBoard({ comments: ['Blocked-by: #23885'], states: { 'objectstack-ai/objectstack#23885': 'open' } });
    untouched(b, await b.refresh(), 'no-target');
  });
  // `pm:blocked` already gone when the remove lands: the wanted state, no throw.
  await check(async () => {
    const b = blockBoard({ comments: [TRIAGE_PARK], states: { 'objectstack-ai/objectstack#23908': 'closed' },
      failRemove: notFound('Label does not exist') });
    if ((await b.refresh()).block !== 'expired' || !b.card.body.includes('moved by this refresh')) {
      throw new Error('remove 404: a label already removed by a seat failed the refresh');
    }
  });
  // A label write that FAILS throws before the body is touched.
  await check(async () => {
    const b = blockBoard({ comments: [TRIAGE_PARK], states: { 'objectstack-ai/objectstack#23908': 'closed' },
      failAdd: Object.assign(new Error('Resource not accessible by integration'), { status: 403 }) });
    if (!(await threwAsync(() => b.refresh()))) throw new Error('add failure: a failed label write did not throw');
    if (b.calls.includes('updateIssue #23885') || b.card.body !== OLD_BODY) {
      throw new Error('add failure: the body said the card moved, after a label write that failed');
    }
  });
  // Wiring: a missing callback or repo refuses before anything is read.
  await check(async () => {
    const b = blockBoard();
    const { listComments: _dropped, ...partial } = b.callbacks;
    let message = '';
    try {
      await fileOrRefreshCard({ identity: ci, body: NEW_BODY, ...partial });
    } catch (error) {
      message = error.message;
    }
    if (!message.includes('listComments') || b.calls.length > 0) {
      throw new Error(`wiring: a missing listComments was not refused by name before any call (${message || 'accepted'})`);
    }
    if (!(await threwAsync(() => fileOrRefreshCard({ identity: ci, body: NEW_BODY, ...b.callbacks, ownerRepo: undefined })))) {
      throw new Error('wiring: a missing ownerRepo was accepted');
    }
  });

  // ── HALF 3: the release gate ────────────────────────────────────────────
  battery('release gate: the selection rule on the recorded 2026-10-12 listing');
  // Read through the module's own location, never the cwd: the fixture is
  // evidence recorded from the Actions API, and its provenance line says how.
  const recorded = JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/release-full-battery/runs-2026-10-12.json', import.meta.url)), 'utf8')
  );
  // The recording predates the Spec Shape Gate and holds runs of exactly the
  // two workflows it names. The cases below judge those two, EXPLICITLY -- the
  // roster, not the fixture, decides what a release reads -- and the two cases
  // after them pin that the default roster now reads the third.
  const recordedWorkflows = RELEASE_GATE_WORKFLOWS.filter(({ file }) => Object.hasOwn(recorded.runs, file));
  const recordedVerdict = (fromIndex) =>
    releaseGateVerdict({ history: recorded.firstParent.slice(fromIndex), runsByWorkflow: recorded.runs, workflows: recordedWorkflows });
  await check(() => {
    if (recordedWorkflows.map((w) => w.file).join(',') !== 'ci.yml,lint.yml') {
      throw new Error(`recorded: the fixture names ${Object.keys(recorded.runs).join(', ')}; the recorded cases below judge ci.yml and lint.yml`);
    }
  });
  await check(() => {
    // FIRING CONTROL for the registration: over the SAME recording, the full
    // roster refuses release commit 0524c1619b naming Spec Shape Gate alone --
    // the third workflow is read, and a workflow with no run is a refusal.
    const v = releaseGateVerdict({ history: recorded.firstParent, runsByWorkflow: recorded.runs });
    if (v.ok || v.refusals.length !== 1 || !v.refusals[0].startsWith('Spec Shape Gate: no completed')) {
      throw new Error(`recorded: the default roster must refuse for Spec Shape Gate alone, got ${v.refusals.join(' | ')}`);
    }
  });
  await check(() => {
    // Release commit 0524c1619b: both workflows' nearest verdict is green.
    const v = recordedVerdict(0);
    if (!v.ok) throw new Error(`recorded: 0524c1619b should pass, refused: ${v.refusals.join(' | ')}`);
  });
  await check(() => {
    // ...and on 712361b7a8 CI carries a push success (07:57) AND a schedule
    // success (08:15): the NEWER of the two is named.
    const chosen = selectFullBatteryRun({ history: recorded.firstParent, runs: recorded.runs['ci.yml'], workflowFile: 'ci.yml' });
    if (chosen?.run.id !== 38222448090 || chosen.distance !== 3) {
      throw new Error(`recorded: expected CI run 38222448090 at distance 3, got ${chosen?.run.id} at ${chosen?.distance}`);
    }
  });
  await check(() => {
    // The commit 2 back (eede467f3d) carries only a CANCELLED push run in both
    // workflows: it is passed over, never read as a refusal.
    const chosen = selectFullBatteryRun({ history: recorded.firstParent, runs: recorded.runs['lint.yml'], workflowFile: 'lint.yml' });
    if (chosen?.run.id !== 38223935346) throw new Error(`recorded: expected Lint run 38223935346, got ${chosen?.run.id}`);
  });
  await check(() => {
    // FIRING CONTROL on real data. Release commit 19805d8956 (index 5): its own
    // push run was cancelled, its hourly CI run concluded failure -> refused,
    // naming CI and that run; Lint's nearest verdict (1f312fdfa6, 6 back) is
    // green, so Lint is NOT named.
    const v = recordedVerdict(5);
    if (v.ok) throw new Error('recorded: 19805d8956 should be refused (the 07:25 hourly CI run failed)');
    if (v.refusals.length !== 1 || !v.refusals[0].startsWith('CI:') || !v.refusals[0].includes('38217670691')) {
      throw new Error(`recorded: the refusal must name CI and run 38217670691 alone, got ${v.refusals.join(' | ')}`);
    }
  });
  await check(() => {
    // Runs on commits that landed AFTER the release commit (48cca4ae00 and
    // 6a40a09ed9 in the recording) tested another tree.
    const onLater = recorded.runs['ci.yml'].filter((r) => !recorded.firstParent.includes(r.head_sha));
    if (onLater.length === 0) throw new Error('recorded: the fixture lost its runs on later commits, so this case tests nothing');
    for (let i = 0; i < 10; i += 1) {
      const chosen = selectFullBatteryRun({ history: recorded.firstParent.slice(i), runs: recorded.runs['ci.yml'], workflowFile: 'ci.yml' });
      if (chosen && onLater.includes(chosen.run)) throw new Error(`recorded: a run after the release commit was chosen (${chosen.run.id})`);
    }
  });
  await check(() => {
    // A release commit outside the recorded window: nothing to place, refused.
    const v = releaseGateVerdict({ history: ['f'.repeat(40)], runsByWorkflow: recorded.runs, workflows: recordedWorkflows });
    if (v.ok || v.refusals.length !== 2) throw new Error(`recorded: an unplaced commit should refuse for both recorded workflows, got ${JSON.stringify(v)}`);
  });

  battery('release gate: the selection rule on synthetic runs');
  const sha = (n) => String(n).repeat(40).slice(0, 40);
  const H = [sha(1), sha(2), sha(3), sha(4)];
  const run = (id, headIndex, conclusion, extra = {}) => ({
    id,
    path: '.github/workflows/ci.yml',
    event: 'schedule',
    status: 'completed',
    conclusion,
    head_sha: H[headIndex],
    head_branch: 'main',
    run_started_at: `2026-10-12T0${id % 10}:00:00Z`,
    run_attempt: 1,
    ...extra,
  });
  const pick = (runs) => selectFullBatteryRun({ history: H, runs, workflowFile: 'ci.yml' })?.run.id ?? null;
  const shapeGreen = [run(8, 0, 'success')];
  const both = (ciRuns, lintRuns, shapeRuns = shapeGreen) =>
    releaseGateVerdict({
      history: H,
      runsByWorkflow: {
        'ci.yml': ciRuns,
        'lint.yml': lintRuns.map((r) => ({ ...r, path: '.github/workflows/lint.yml' })),
        'spec-shape-gate.yml': shapeRuns.map((r) => ({ ...r, path: '.github/workflows/spec-shape-gate.yml' })),
      },
    });
  await check(() => {
    if (pick([run(1, 0, 'cancelled'), run(2, 1, 'cancelled')]) !== null) throw new Error('synthetic: cancelled-only was given a verdict');
  });
  await check(() => {
    if (!both([run(1, 0, 'cancelled')], [run(2, 0, 'success')]).refusals.some((r) => r.startsWith('CI: no completed'))) {
      throw new Error('synthetic: no verdict-bearing CI run must refuse, naming CI');
    }
  });
  await check(() => {
    // A nearer red beats an older green, whatever the clock says.
    if (pick([run(9, 2, 'success'), run(1, 1, 'failure')]) !== 1) throw new Error('synthetic: an older green outvoted a nearer red');
  });
  await check(() => {
    // On one commit, the newer run decides: a re-run that went green counts...
    if (pick([run(1, 1, 'failure'), run(2, 1, 'success')]) !== 2) throw new Error('synthetic: a newer green re-run on the same commit was ignored');
  });
  await check(() => {
    // ...and so does a newer red after an older green.
    if (pick([run(1, 1, 'success'), run(2, 1, 'failure')]) !== 2) throw new Error('synthetic: an older green outvoted a newer red on one commit');
  });
  await check(() => {
    // Equal start times fall back to the higher run id, never to input order.
    const a = run(3, 1, 'failure', { run_started_at: 'T' });
    const b = run(4, 1, 'success', { run_started_at: 'T' });
    if (pick([b, a]) !== 4 || pick([a, b]) !== 4) throw new Error('synthetic: the tie-break depends on input order');
  });
  for (const event of ['pull_request', 'merge_group', 'workflow_dispatch']) {
    await check(() => {
      if (pick([run(1, 0, 'failure', { event }), run(2, 2, 'success')]) !== 2) throw new Error(`synthetic: a ${event} run was read as full battery`);
    });
  }
  await check(() => {
    if (pick([run(1, 0, 'failure', { head_branch: 'feature' }), run(2, 2, 'success')]) !== 2) throw new Error('synthetic: a non-main run was read');
  });
  await check(() => {
    if (pick([run(1, 0, 'failure', { status: 'in_progress', conclusion: null }), run(2, 2, 'success')]) !== 2) {
      throw new Error('synthetic: an unfinished run was read');
    }
  });
  await check(() => {
    // Not `cancelled`, not `success`: a verdict, and a refusing one.
    if (both([run(1, 0, 'startup_failure')], [run(2, 0, 'success')]).ok) throw new Error('synthetic: startup_failure passed');
  });
  await check(() => {
    if (pick([run(1, 0, 'failure', { path: '.github/workflows/lint.yml' }), run(2, 2, 'success')]) !== 2) {
      throw new Error("synthetic: another workflow's run was read as this one's");
    }
  });
  await check(() => {
    // Both must be green: either one red refuses, and only the red one is named.
    const v = both([run(1, 0, 'success')], [run(2, 0, 'failure')]);
    if (v.ok || v.refusals.length !== 1 || !v.refusals[0].startsWith('Lint & Type Check:')) {
      throw new Error(`synthetic: a red Lint run did not refuse alone (${v.refusals.join(' | ')})`);
    }
    if (releaseGateExit(v) !== EXIT_FINDINGS || releaseGateExit(both([run(1, 0, 'success')], [run(2, 0, 'success')])) !== 0) {
      throw new Error('synthetic: the verdict did not map to exit 1 / exit 0');
    }
  });
  await check(() => {
    if (releaseGateVerdict({ history: [], runsByWorkflow: {} }).ok) throw new Error('synthetic: an empty history passed');
  });
  await check(() => {
    // The third workflow: a red Spec Shape Gate refuses alone, with CI and Lint green.
    const v = both([run(1, 0, 'success')], [run(2, 0, 'success')], [run(3, 0, 'failure')]);
    if (v.ok || v.refusals.length !== 1 || !v.refusals[0].startsWith('Spec Shape Gate:') || !v.refusals[0].includes('failure')) {
      throw new Error(`synthetic: a red Spec Shape Gate did not refuse alone (${v.refusals.join(' | ')})`);
    }
  });
  await check(() => {
    // ...and no Spec Shape Gate run at all refuses too: an unread gate is not a green one.
    const v = both([run(1, 0, 'success')], [run(2, 0, 'success')], []);
    if (v.ok || v.refusals.length !== 1 || !v.refusals[0].startsWith('Spec Shape Gate: no completed')) {
      throw new Error(`synthetic: a missing Spec Shape Gate run did not refuse naming it (${v.refusals.join(' | ')})`);
    }
  });
  await check(() => {
    // ...while a `workflow_dispatch` run of it is not a full-battery run (same rule as the other two).
    const v = both([run(1, 0, 'success')], [run(2, 0, 'success')], [run(3, 0, 'failure', { event: 'workflow_dispatch' }), run(4, 1, 'success')]);
    if (!v.ok) throw new Error(`synthetic: a dispatch run of Spec Shape Gate was read as full battery (${v.refusals.join(' | ')})`);
  });

  battery('release gate: the read path retries a transient answer, inside one budget per run');
  // The four pins the card names, driven through `runReleaseGate` -- the
  // refusal text and the exit included -- with no network and no wall-clock
  // backoff: `fetchImpl` is a stub over the six listings (three workflows x two
  // events) and `sleep` records the backoff it was asked for.
  const RETRY = BOARD_READ_RETRY;
  const listingUrl = (file, event, page = 1) =>
    `https://api.github.com/repos/o/r/actions/workflows/${file}/runs?branch=main&event=${event}&status=completed&per_page=100&page=${page}`;
  // The shape node 22's fetch throws a connection failure in: a TypeError whose
  // cause carries the code.
  const connectionFailure = (code) => new TypeError('fetch failed', { cause: Object.assign(new Error(`read ${code}`), { code }) });
  // One full-battery run per workflow on the release commit, in its `schedule`
  // listing; every `push` listing is empty.
  const greenListing = (file, event, conclusion = 'success') =>
    event !== 'schedule'
      ? []
      : [{
          id: 4100 + RELEASE_GATE_WORKFLOWS.findIndex((w) => w.file === file),
          path: `.github/workflows/${file}`,
          event,
          status: 'completed',
          conclusion,
          head_sha: H[0],
          head_branch: 'main',
          run_started_at: '2026-10-19T08:00:00Z',
          run_attempt: 1,
        }];
  // `reply({ file, event, page, n })` answers the n-th request (1-based) for
  // one listing page; returning null answers the default listing.
  const readPathGate = async (reply = () => null, { conclusion = 'success' } = {}) => {
    const calls = [];
    const slept = [];
    const perUrl = new Map();
    const fetchImpl = async (url) => {
      const m = /\/actions\/workflows\/([^/]+)\/runs\?branch=main&event=([a-z_]+)&status=completed&per_page=100&page=(\d+)$/.exec(url);
      if (!m) throw new Error(`stub transport: unexpected URL ${url}`);
      const n = (perUrl.get(url) ?? 0) + 1;
      perUrl.set(url, n);
      calls.push(url);
      const [, file, event, page] = m;
      const r = reply({ file, event, page: Number(page), n }) ?? { body: { workflow_runs: greenListing(file, event, conclusion) } };
      if (r.throws) throw r.throws;
      const status = r.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: async () => {
          if (r.bodyThrows) throw r.bodyThrows;
          return r.body;
        },
      };
    };
    const result = await runReleaseGate({
      releaseCommit: H[0],
      repo: 'o/r',
      token: 't',
      readHistory: () => H,
      fetchImpl,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    return { ...result, calls, slept, said: result.lines.join(' | ') };
  };
  const onLint = ({ file, event }) => file === 'lint.yml' && event === 'schedule';
  const NOT_MEASURED = '::error::release gate NOT MEASURED -- ';
  const REFUSING = '. Refusing: an unread full battery is not a green one.';

  // PIN 1 -- a 502 then a 200 is MEASURED, and the verdict is computed.
  await check(async () => {
    // ⭐ The measured case (release run 39230668843): one 502 on lint.yml's
    // `schedule` listing, then a 200.
    const g = await readPathGate((at) => (onLint(at) && at.n === 1 ? { status: 502 } : null));
    if (g.exit !== 0 || !g.lines.at(-1)?.startsWith('scheduled-full-run --release-gate: PASS') || g.verdict?.lines.length !== RELEASE_GATE_WORKFLOWS.length) {
      throw new Error(`read path: a 502 then a 200 must be measured and pass, got exit ${g.exit}: ${g.said}`);
    }
    if (g.calls.length !== 7 || g.calls.filter((u) => u === listingUrl('lint.yml', 'schedule')).length !== 2 || g.slept.join() !== '500') {
      throw new Error(`read path: expected one retry after one 500 ms backoff, got ${g.calls.length} requests, slept ${g.slept.join(',') || 'never'}`);
    }
  });
  await check(async () => {
    // ...and the verdict is COMPUTED, not assumed: behind the same blip a red
    // battery refuses as a verdict (exit 1), never as NOT MEASURED.
    const g = await readPathGate((at) => (onLint(at) && at.n === 1 ? { status: 502 } : null), { conclusion: 'failure' });
    if (g.exit !== EXIT_FINDINGS || g.verdict?.refusals.length !== RELEASE_GATE_WORKFLOWS.length || g.said.includes('NOT MEASURED')) {
      throw new Error(`read path: a red battery behind a blip must refuse as a verdict, got exit ${g.exit}: ${g.said}`);
    }
  });
  await check(async () => {
    // A connection reset is the same blip, and so is a socket the peer closes
    // while the BODY streams: the unit retried is the request and its body.
    const reset = await readPathGate((at) => (at.file === 'ci.yml' && at.event === 'push' && at.n === 1 ? { throws: connectionFailure('ECONNRESET') } : null));
    const cut = await readPathGate((at) =>
      onLint(at) && at.n === 1 ? { body: { workflow_runs: [] }, bodyThrows: connectionFailure('UND_ERR_SOCKET') } : null
    );
    for (const [label, g] of [['a connection reset', reset], ['a socket closed mid-body', cut]]) {
      if (g.exit !== 0 || g.calls.length !== 7 || g.slept.join() !== '500') {
        throw new Error(`read path: ${label}, then a 200, must be measured and pass, got exit ${g.exit} after ${g.calls.length} requests: ${g.said}`);
      }
    }
  });
  await check(async () => {
    // Every PAGE goes through the same read: a full first page of 100, then a
    // 503 on page 2, then the page that carries the verdict.
    const filler = Array.from({ length: 100 }, (_, i) => ({ ...greenListing('ci.yml', 'schedule')[0], id: 5000 + i, conclusion: 'cancelled' }));
    const g = await readPathGate((at) => {
      if (at.file !== 'ci.yml' || at.event !== 'schedule') return null;
      if (at.page === 1) return { body: { workflow_runs: filler } };
      return at.n === 1 ? { status: 503 } : null;
    });
    if (g.exit !== 0 || g.calls.filter((u) => u === listingUrl('ci.yml', 'schedule', 2)).length !== 2 || g.calls.length !== 8) {
      throw new Error(`read path: a transient 503 on page 2 must be retried and measured, got exit ${g.exit} after ${g.calls.length} requests: ${g.said}`);
    }
  });

  // PIN 2 -- three 5xx answers refuse NOT MEASURED, naming the attempts.
  await check(async () => {
    const g = await readPathGate((at) => (onLint(at) ? { status: 503 } : null));
    const want = `${NOT_MEASURED}GET ${listingUrl('lint.yml', 'schedule')} -> HTTP 503 after ${RETRY.attemptsPerRead} attempts (`;
    if (g.exit !== EXIT_PREREQUISITE_NOT_MET || g.verdict !== null || g.lines.length !== 1 || !g.lines[0].startsWith(want) || !g.lines[0].endsWith(REFUSING)) {
      throw new Error(`read path: three 503s must refuse NOT MEASURED naming ${RETRY.attemptsPerRead} attempts, got exit ${g.exit}: ${g.said}`);
    }
    if (g.calls.filter((u) => u === listingUrl('lint.yml', 'schedule')).length !== RETRY.attemptsPerRead || g.slept.join() !== RETRY.backoffMs.join()) {
      throw new Error(`read path: the ladder is ${RETRY.attemptsPerRead} attempts and ${RETRY.backoffMs.join(' + ')} ms, got slept ${g.slept.join(',') || 'never'}`);
    }
    if (/#\d/.test(g.lines[0])) throw new Error('read path: the refusal is runtime prose and carries no tracker number');
  });
  await check(async () => {
    // Persistent resets: the same ladder, and the refusal names the code.
    const g = await readPathGate((at) => (onLint(at) ? { throws: connectionFailure('ECONNRESET') } : null));
    if (g.exit !== EXIT_PREREQUISITE_NOT_MET || !g.lines[0]?.startsWith(`${NOT_MEASURED}GET ${listingUrl('lint.yml', 'schedule')} -> ECONNRESET after 3 attempts`)) {
      throw new Error(`read path: persistent resets must refuse NOT MEASURED naming the code and the attempts, got exit ${g.exit}: ${g.said}`);
    }
  });
  await check(async () => {
    // ⛔ An unread battery is never a green one: a persistent transient answer
    // on ANY of the six listings refuses NOT MEASURED, exit 3.
    const persistent = [
      ['HTTP 500', { status: 500 }],
      ['HTTP 502', { status: 502 }],
      ['HTTP 503', { status: 503 }],
      ['HTTP 504', { status: 504 }],
      ['ECONNRESET', { throws: connectionFailure('ECONNRESET') }],
      ['UND_ERR_SOCKET', { throws: connectionFailure('UND_ERR_SOCKET') }],
    ];
    const passed = [];
    for (const [label, reply] of persistent) {
      for (const { file } of RELEASE_GATE_WORKFLOWS) {
        for (const event of FULL_BATTERY_EVENTS) {
          const g = await readPathGate((at) => (at.file === file && at.event === event ? reply : null));
          if (g.exit !== EXIT_PREREQUISITE_NOT_MET || !g.lines[0]?.startsWith(NOT_MEASURED)) passed.push(`${label} on ${file}/${event} (exit ${g.exit})`);
        }
      }
    }
    if (passed.length > 0) throw new Error(`read path: an unread listing was not refused NOT MEASURED: ${passed.join(', ')}`);
  });

  // PIN 3 -- a 404 refuses at once: one fetch, no sleep. So does every other
  // answer that is not transient.
  await check(async () => {
    const g = await readPathGate((at) => (at.file === 'ci.yml' && at.event === 'schedule' ? { status: 404, body: { message: 'Not Found' } } : null));
    if (g.exit !== EXIT_PREREQUISITE_NOT_MET || g.calls.length !== 1 || g.slept.length !== 0 || !g.lines[0]?.includes(' -> HTTP 404 after 1 attempt (not retried')) {
      throw new Error(`read path: a 404 must refuse at once, with one request and no backoff, got exit ${g.exit} after ${g.calls.length} request(s), slept ${g.slept.join(',') || 'never'}: ${g.said}`);
    }
  });
  for (const status of [401, 403, 422, 429]) {
    await check(async () => {
      const g = await readPathGate((at) => (onLint(at) ? { status } : null));
      if (g.exit !== EXIT_PREREQUISITE_NOT_MET || g.calls.length !== 3 || g.slept.length !== 0 || !g.lines[0]?.includes(`-> HTTP ${status} after 1 attempt (not retried`)) {
        throw new Error(`read path: a ${status} is an answer, not a blip, got exit ${g.exit} after ${g.calls.length} request(s), slept ${g.slept.join(',') || 'never'}: ${g.said}`);
      }
    });
  }
  await check(async () => {
    // An OK body with no `workflow_runs` array is an answer about the
    // endpoint: final at once, never retried.
    const g = await readPathGate((at) => (onLint(at) ? { body: { message: 'moved' } } : null));
    if (g.exit !== EXIT_PREREQUISITE_NOT_MET || g.calls.length !== 3 || g.slept.length !== 0 || !g.lines[0]?.includes('answered no workflow_runs array')) {
      throw new Error(`read path: an OK body without workflow_runs must refuse at once, got exit ${g.exit} after ${g.calls.length} request(s): ${g.said}`);
    }
  });
  await check(async () => {
    // Every other error is final at once too: a refused connection, a failed
    // lookup, and a body that is not JSON.
    const finals = [
      ['ECONNREFUSED', { throws: connectionFailure('ECONNREFUSED') }],
      ['ENOTFOUND', { throws: connectionFailure('ENOTFOUND') }],
      ['a body that is not JSON', { body: null, bodyThrows: new SyntaxError('Unexpected token < in JSON') }],
    ];
    for (const [label, reply] of finals) {
      const g = await readPathGate((at) => (onLint(at) ? reply : null));
      if (g.exit !== EXIT_PREREQUISITE_NOT_MET || g.calls.length !== 3 || g.slept.length !== 0) {
        throw new Error(`read path: ${label} must refuse at once, got exit ${g.exit} after ${g.calls.length} request(s), slept ${g.slept.join(',') || 'never'}`);
      }
    }
  });

  // PIN 4 -- ONE budget per gate run, shared across every workflow x event x
  // page it reads; never one per `readRuns` call.
  await check(async () => {
    // ⭐ Every listing answers 502 once, then 200. Six reads want six retries;
    // the run allows four, so the FIFTH listing's first 502 is final.
    const g = await readPathGate((at) => (at.n === 1 ? { status: 502 } : null));
    const want = `-> HTTP 502 after 1 attempt (this run's budget of ${RETRY.retriesPerRun} retries is spent)`;
    if (g.exit !== EXIT_PREREQUISITE_NOT_MET || g.slept.length !== RETRY.retriesPerRun || g.calls.length !== 2 * RETRY.retriesPerRun + 1) {
      throw new Error(`read path: a flapping API must spend the run's ${RETRY.retriesPerRun} retries and then refuse, got exit ${g.exit} after ${g.calls.length} requests and ${g.slept.length} backoff(s): ${g.said}`);
    }
    if (!g.lines[0]?.startsWith(`${NOT_MEASURED}GET ${listingUrl('spec-shape-gate.yml', 'schedule')} ${want}`)) {
      throw new Error(`read path: the refusal must name the listing whose 502 met a spent budget, got ${g.said}`);
    }
  });
  await check(async () => {
    // ...and the budget is exactly that, not tighter: four listings that blip
    // once each are still measured.
    const g = await readPathGate((at) => (at.n === 1 && at.file !== 'spec-shape-gate.yml' ? { status: 502 } : null));
    if (g.exit !== 0 || g.slept.length !== RETRY.retriesPerRun || g.calls.length !== 6 + RETRY.retriesPerRun) {
      throw new Error(`read path: ${RETRY.retriesPerRun} blips in one run must all be retried and measured, got exit ${g.exit} after ${g.calls.length} requests: ${g.said}`);
    }
  });

  battery('release gate: release.yml wiring');
  const releaseYml = readFileSync(fileURLToPath(new URL('../../.github/workflows/release.yml', import.meta.url)), 'utf8');
  await check(() => {
    // Every workflow the release reads exists as a file, so a rename or a
    // deletion cannot leave the gate reading a workflow that no longer runs.
    const missing = RELEASE_GATE_WORKFLOWS.filter(({ file }) => !existsSync(fileURLToPath(new URL(`../../.github/workflows/${file}`, import.meta.url))));
    if (missing.length > 0) throw new Error(`wiring: RELEASE_GATE_WORKFLOWS names ${missing.map((w) => w.file).join(', ')}, which do not exist under .github/workflows/`);
  });
  await check(() => {
    const findings = releaseGateWiring(releaseYml);
    if (findings.length > 0) throw new Error(`wiring: the checked-in release.yml: ${findings.join(' | ')}`);
  });
  await check(() => {
    const cut = releaseYml.replace(/(\n {4}needs: \[release-integrity), full-battery\]/, '$1]');
    if (cut === releaseYml) throw new Error('wiring: the needs: anchor did not match, so this case tests nothing');
    if (!releaseGateWiring(cut).some((f) => f.includes('does not need'))) throw new Error('wiring: publish without the gate in needs: passed');
  });
  await check(() => {
    const cut = releaseYml.replace('node scripts/ci/scheduled-full-run.mjs --release-gate', 'node scripts/ci/scheduled-full-run.mjs --self-test');
    if (cut === releaseYml) throw new Error('wiring: the run anchor did not match, so this case tests nothing');
    if (!releaseGateWiring(cut).some((f) => f.includes('never runs'))) throw new Error('wiring: a gate job that never runs --release-gate passed');
  });
  await check(() => {
    const cut = releaseYml.replace(/(\n {2}publish:[\s\S]*?\n {4}if: >-\n\s*)success\(\) &&/, '$1!cancelled() &&');
    if (cut === releaseYml) throw new Error("wiring: publish's if: anchor did not match, so this case tests nothing");
    if (!releaseGateWiring(cut).some((f) => f.includes('success() &&'))) throw new Error("wiring: publish's if: under !cancelled() passed");
  });
  await check(() => {
    const cut = releaseYml.replace(/(\n {2}full-battery:\n)/, '$1    continue-on-error: true\n');
    if (cut === releaseYml) throw new Error('wiring: the gate job anchor did not match, so this case tests nothing');
    if (!releaseGateWiring(cut).some((f) => f.includes('continue-on-error'))) throw new Error('wiring: a continue-on-error gate passed');
  });

  // -- The floor. Evaluated before the verdict, so the success line can only be
  //    printed by a run in which the set of batteries that registered EQUALS
  //    the set declared.
  const floorFailures = [];
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailures.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`
    );
  }
  for (const [name, count] of batterySeen) {
    if (declared.includes(name)) continue;
    floorFailures.push(`battery "${name}" registered ${count} case(s) but is not declared.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorFailures.push(
      count === 0
        ? `battery "${name}" DID NOT RUN -- 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned.`
        : `battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]}.`
    );
  }
  if (floorFailures.length > 0) {
    throw new Error(
      `scheduled-full-run self-test floor (${floorFailures.length} breach(es)):\n` +
        floorFailures.map((f) => `  - ${f}`).join('\n') +
        '\n  A battery at or below its floor means cases STOPPED RUNNING -- the battery is the bug, ' +
        'not the number.'
    );
  }

  console.log('scheduled-full-run: self-test OK');
  return SELF_TEST_VERDICT;
}

function checkConcurrency() {
  let bad = 0;
  for (const file of WATCHED_WORKFLOWS) {
    const group = readConcurrencyGroup(readFileSync(file, 'utf8'));
    const verdict = concurrencyVerdict(group, { workflow: file });
    if (verdict.ok) {
      console.log(
        `scheduled-full-run: ${file} OK -- push '${verdict.groups.push}' and schedule ` +
          `'${verdict.groups.schedule}' are different concurrency groups.`
      );
      continue;
    }
    bad += 1;
    for (const finding of verdict.findings) console.error(`scheduled-full-run: ${file}: ${finding}`);
  }
  if (bad > 0) {
    console.error(
      `scheduled-full-run: ${bad} workflow file(s) carry a concurrency key that lets one main run cancel ` +
        'another: the hourly full run is the only thing testing the whole workspace on main since push ' +
        "went affected-only, and a push run is the only test of its own merge's affected set, so this is a " +
        'coverage refusal, not a style one.'
    );
    process.exit(1);
  }
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--self-test')) {
    if ((await selfTest()) !== SELF_TEST_VERDICT) {
      console.error(
        '\nx scheduled-full-run self-test: selfTest() returned without reaching its verdict,\n' +
          'so no success line was printed. Exiting 0 here would report a self-test that never\n' +
          'finished as a self-test that passed.\n'
      );
      process.exit(1);
    }
    return;
  }

  if (argv.includes('--check-concurrency')) {
    checkConcurrency();
    return;
  }

  if (argv.includes('--release-gate')) {
    await releaseGate(argv);
    return;
  }

  console.error(
    'usage: scheduled-full-run.mjs --check-concurrency\n' +
      '       scheduled-full-run.mjs --release-gate --release-commit <sha>\n' +
      '       scheduled-full-run.mjs --self-test'
  );
  process.exit(1);
}

// Exports bindings, so an import for those exports alone must run nothing.
if (isEntrypoint(import.meta.url)) {
  await main();
}
