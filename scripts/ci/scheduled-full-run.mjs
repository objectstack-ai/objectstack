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

import { EXIT_FINDINGS, EXIT_PREREQUISITE_NOT_MET } from '../import-prerequisite.mjs';
import { isEntrypoint } from '../invoked-as.mjs';

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
export function eventContext(eventName, { workflow = 'W', prNumber = null, ref = null } = {}) {
  const refs = {
    push: 'refs/heads/main',
    schedule: 'refs/heads/main',
    workflow_dispatch: 'refs/heads/main',
    pull_request: `refs/pull/${prNumber ?? 1}/merge`,
    merge_group: 'refs/heads/gh-readonly-queue/main/pr-1-' + 'a'.repeat(40),
  };
  return {
    github: {
      workflow,
      event_name: eventName,
      ref: ref ?? refs[eventName] ?? `refs/heads/${eventName}`,
      event: prNumber === null ? {} : { pull_request: { number: prNumber } },
    },
  };
}

// The verdict. Findings are returned rather than thrown so the CLI can name all
// of them at once.
export function concurrencyVerdict(groupExpression, { workflow = 'W' } = {}) {
  const findings = [];
  const group = (eventName, options = {}) =>
    evaluateGroup(groupExpression, eventContext(eventName, { workflow, ...options }));

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

  // POSITIVE CONTROL, and it is not decoration. The cheap way to make every
  // comparison above unequal is to put something run-unique in the key --
  // `github.run_id`, `github.sha` -- which also switches `cancel-in-progress`
  // off for every event in the file. So the key must still collapse two runs of
  // the SAME event on the same ref onto one group.
  if (group('schedule') !== group('schedule')) {
    findings.push('two `schedule` runs on the same ref do not share a group (the key is not stable)');
  }
  if (group('push', { ref: 'refs/heads/main' }) !== group('push', { ref: 'refs/heads/main' })) {
    findings.push('two `push` runs on the same ref do not share a group (the key is not stable)');
  }
  // ...and it must still separate two different pull requests.
  if (group('pull_request', { prNumber: 7 }) === group('pull_request', { prNumber: 8 })) {
    findings.push('two different pull requests share one concurrency group (the key ignores the PR number)');
  }
  // ...and a queue build must not be cancelled by a push to main.
  if (group('merge_group') === push) {
    findings.push('a `merge_group` build and a `push` run share one group');
  }

  return { ok: findings.length === 0, findings, groups: { push, schedule, dispatch } };
}

// ---------------------------------------------------------------------------
// HALF 2 -- the card a red scheduled run files
// ---------------------------------------------------------------------------

// ⛔ The marker is PLAIN TEXT, never an HTML comment. This platform's body
// sanitizer is measured to eat short angle-bracket fragments, and a de-dup key
// that can be swallowed files a duplicate an hour.
const MARKER_PREFIX = 'os-hourly-full-run';
const TITLE_PREFIX = 'hourly full run: red on main';

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
  return {
    workflowName: name,
    title: `${TITLE_PREFIX} (${name})`,
    marker: `${MARKER_PREFIX}-${slug}`,
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

// The whole decision, so that "one red run files one card, the next refreshes
// it" is a property something can DRIVE rather than a sentence in a workflow
// comment. The caller supplies three thin callbacks over the API and nothing
// else; every branch of the judgement is here.
//
// ⛔ `create` is reached ONLY through `findExistingCard`, which throws on a
// scan it could not complete. An exception here therefore files nothing, which
// is the correct direction: a missed refresh costs one stale body, and a
// spurious create costs a duplicate card every hour until somebody notices.
export async function fileOrRefreshCard({ identity, body, listPage, createIssue, updateIssue, perPage, maxPages }) {
  const existing = await findExistingCard({ identity, listPage, perPage, maxPages });
  if (existing) {
    // Rewritten in place, never a comment per run. ⛔ Labels are NOT rewritten:
    // grading is the devx seat's and a refresh must not undo it.
    await updateIssue({ number: existing.number, body });
    return { action: 'refreshed', number: existing.number };
  }
  const created = await createIssue({ title: identity.title, body, labels: identity.labels });
  return { action: 'filed', number: created.number };
}

// The card body. The run link and the commit range are the whole product: a red
// hourly run says "main broke somewhere in the last hour", and the commits
// between the previous GREEN scheduled run and this one are that hour.
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
  const range = previousGreen
    ? `\`${String(previousGreen.head_sha).slice(0, 10)}\` (run ${previousGreen.run_id}, the last green ` +
      `\`${identity.workflowName}\` schedule run) .. \`${String(headSha).slice(0, 10)}\``
    : null;

  const suspects = previousGreen
    ? commits.length > 0
      ? [
          `## What landed since the last green hourly run`,
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
          `## What landed since the last green hourly run`,
          '',
          `Range: ${range}`,
          '',
          '⚠️ Nothing landed in that range. The same tree was green an hour ago and is red now, so',
          'this is a FLAKE, an infrastructure fault, or a suite that depends on wall-clock time or on',
          'something outside the repository. ⛔ Do not go looking for the commit that broke it.',
          '',
        ]
    : [
        `## What landed since the last green hourly run`,
        '',
        '⚠️ No commit range could be named for this red run.',
        rangeNote ?? '',
        'Read the run log directly. ⛔ Do not take the absence of a range as "nothing changed": it is the',
        'absence of a READING, which is a different fact and points at this filer rather than at `main`.',
        '',
      ];

  return [
    `${identity.marker} — machine-findable marker for this generated card. ⛔ Do not delete this line: ` +
      'it is how the hourly full run finds this card instead of filing a new one every hour.',
    '',
    `# ${identity.title}`,
    '',
    `_Swept ${sweptAt} · [run log](${runUrl}) · commit \`${headSha}\` · conclusion \`${conclusion}\`._`,
    '',
    `\`${identity.workflowName}\` runs the FULL battery on \`main\` every hour (#16467). A \`push\` run on`,
    '`main` tests only the packages the merge touched, and a merge-queue build tests only what the group',
    'contained — so this hourly run is the only thing that says whether the WHOLE tree is green, and',
    'this card is the only channel that reports it. Nothing is blocked by it.',
    '',
    '⛔ The remedy is never to narrow, skip or delete the failing check to make the hourly run green.',
    'Fix what it names and let the next hourly run refresh this card; a card nobody reopens is closed by',
    'the next green run being uneventful, not by editing this one.',
    '',
    ...suspects,
    '_Filed by `.github/workflows/scheduled-full-run-card.yml`. Generated by [Claude Code](https://claude.ai/code)_',
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

export async function readRuns({ repo, token, file, event, pages = RELEASE_GATE_PAGES }) {
  const runs = [];
  for (let page = 1; page <= pages; page += 1) {
    const url =
      `https://api.github.com/repos/${repo}/actions/workflows/${file}/runs` +
      `?branch=main&event=${event}&status=completed&per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!res.ok) throw new Error(`GET ${url} answered HTTP ${res.status}`);
    const body = await res.json();
    const batch = Array.isArray(body?.workflow_runs) ? body.workflow_runs : null;
    if (!batch) throw new Error(`GET ${url} answered no workflow_runs array`);
    runs.push(...batch);
    if (batch.length < 100) break;
  }
  return runs;
}

async function releaseGate(argv) {
  const at = argv.indexOf('--release-commit');
  const releaseCommit = at === -1 ? '' : String(argv[at + 1] ?? '');
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const token = process.env.GITHUB_TOKEN ?? '';
  let history;
  const runsByWorkflow = {};
  try {
    if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are both required');
    history = readFirstParentHistory(releaseCommit);
    for (const { file } of RELEASE_GATE_WORKFLOWS) {
      runsByWorkflow[file] = [];
      for (const event of FULL_BATTERY_EVENTS) runsByWorkflow[file].push(...(await readRuns({ repo, token, file, event })));
    }
  } catch (error) {
    console.log(`::error::release gate NOT MEASURED -- ${error.message}. Refusing: an unread full battery is not a green one.`);
    process.exit(EXIT_PREREQUISITE_NOT_MET);
  }
  const verdict = releaseGateVerdict({ history, runsByWorkflow });
  for (const line of verdict.lines) console.log(`scheduled-full-run --release-gate: ${line}`);
  if (verdict.ok) {
    console.log(`scheduled-full-run --release-gate: PASS -- the full battery at or before ${releaseCommit.slice(0, 10)} is green in every workflow (${RELEASE_GATE_WORKFLOWS.map((w) => w.name).join(', ')}).`);
  } else {
    for (const refusal of verdict.refusals) console.log(`::error::release refused -- ${refusal}`);
  }
  process.exit(releaseGateExit(verdict));
}

// ---------------------------------------------------------------------------
// -- The self-test's own battery roster and floor ---------------------------
//
// Same shape as its siblings: what is pinned is the registered NAMES, and each
// count is a FLOOR -- a battery below it means cases stopped running, and the
// remedy is to find what stopped registering, never to lower the number.
const SELF_TEST_BATTERIES = Object.freeze({
  'scheduled-full-run concurrency isolation': 20,
  'scheduled-full-run card identity and de-dup': 23,
  'release gate: the selection rule on the recorded 2026-10-12 listing': 8,
  'release gate: the selection rule on synthetic runs': 17,
  'release gate: release.yml wiring': 6,
});
const SELF_TEST_BATTERY_FLOOR = 5;
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
  const GOOD =
    'ci-${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}';
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
    const v = concurrencyVerdict(GOOD, { workflow: 'CI' });
    if (!v.ok) throw new Error(`the fixed key was rejected: ${v.findings.join(' | ')}`);
  });
  await check(() => {
    const v = concurrencyVerdict(GOOD, { workflow: 'CI' });
    if (v.groups.schedule === v.groups.push) throw new Error('the fixed key still collapses schedule onto push');
  });

  // -- NONSENSE CONTROL. A key that separates every event by making every RUN
  //    unique passes the inequality above and silently disables
  //    `cancel-in-progress` everywhere. It must be refused.
  await check(() => {
    const v = concurrencyVerdict('ci-${{ github.run_id }}', { workflow: 'CI' });
    if (v.ok) throw new Error('nonsense control: a run-unique key was accepted');
  });
  await check(() => {
    const v = concurrencyVerdict('ci-${{ github.run_id }}', { workflow: 'CI' });
    if (!v.findings.some((f) => f.includes('two different pull requests'))) {
      throw new Error(`nonsense control: expected the PR-separation finding (${v.findings.join(' | ')})`);
    }
  });
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

  // -- THE ACCEPTANCE SHAPE, driven end to end against a mutable board: one red
  //    run files exactly one card, and the NEXT red run refreshes that card and
  //    files no second one. This is the property the filer exists for, and a
  //    de-dup rule that is only ever exercised live gets its first test on the
  //    night it files its duplicate.
  const board = [];
  let nextNumber = 500;
  const drive = async (identityUnderTest, bodyText) =>
    fileOrRefreshCard({
      identity: identityUnderTest,
      body: bodyText,
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
      `scheduled-full-run: ${bad} workflow file(s) let a push to main cancel the hourly full run. ` +
        'That run is the only thing testing the whole workspace on main since push went affected-only, ' +
        'so this is a coverage refusal, not a style one.'
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
