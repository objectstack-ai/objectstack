#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// scheduled-full-run -- the two halves of the hourly full run's contract that
// nothing else can hold (#16467).
//
//   node scripts/ci/scheduled-full-run.mjs --check-concurrency
//   node scripts/ci/scheduled-full-run.mjs --self-test
//
// ## Why one file holds both halves
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

import { readFileSync } from 'node:fs';
import process from 'node:process';

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
// -- The self-test's own battery roster and floor ---------------------------
//
// Same shape as its siblings: what is pinned is the registered NAMES, and each
// count is a FLOOR -- a battery below it means cases stopped running, and the
// remedy is to find what stopped registering, never to lower the number.
const SELF_TEST_BATTERIES = Object.freeze({
  'scheduled-full-run concurrency isolation': 20,
  'scheduled-full-run card identity and de-dup': 23,
});
const SELF_TEST_BATTERY_FLOOR = 2;
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

  console.error(
    'usage: scheduled-full-run.mjs --check-concurrency\n' +
      '       scheduled-full-run.mjs --self-test'
  );
  process.exit(1);
}

// Exports bindings, so an import for those exports alone must run nothing.
if (isEntrypoint(import.meta.url)) {
  await main();
}
