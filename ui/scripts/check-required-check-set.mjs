#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-required-check-set -- the merge queue's required-check set is off-repo
 * configuration, and this is the only thing in the tree that looks at it.
 *
 *   node scripts/check-required-check-set.mjs                  # live read
 *   node scripts/check-required-check-set.mjs --json           # the same reading as JSON
 *   node scripts/check-required-check-set.mjs --fixture <path> # read a saved response instead
 *   node scripts/check-required-check-set.mjs --self-test      # offline (pnpm check:required-check-set)
 *
 * Exit: 0 = a reading was taken and every PINNED context is present
 *       2 = the reading COULD NOT BE TAKEN -- never a pass
 *       3 = BREACH: a pinned context, or the rule carrying it, is gone
 *
 * ## The gap (objectui#9422, out of the residual of objectui#3535)
 *
 * `main` sits behind an enforced merge queue whose required set lives in GitHub
 * ruleset 11776024 -- repository SETTINGS (what it holds is this script's
 * reading, not a number written here). Removing a member from it reds no gate, fires no alarm, and leaves
 * no trace in a diff anybody reviews.
 *
 * What that costs is not hypothetical. On 2026-08-07, with the required set
 * effectively empty, three pull requests (#3503, #3510, #3516) merged with
 * `Type Check` at `conclusion=failure` onto a `main` that #3498 had left with a
 * type error; #3505 hot-fixed the result. objectui#3523 installed the set that
 * prevents a recurrence. This file watches that set, so losing it again is
 * something the repository can SAY, rather than something it discovers the next
 * time a type error rides the queue in.
 *
 * ## ⭐ The premise this file is built on, and how to re-take it
 *
 * The repository used to say, in more than one place, that this surface cannot
 * be read from here. Those sentences were TRUE when they were written:
 * objectui#4959 recorded a merge landing while all four `Test (shard N/4)` jobs
 * were `in_progress`, which is possible only if none of them was required. The
 * ruleset was edited afterwards (`updated_at` 2026-08-24) and the prose was
 * not. objectui#9502 repaired the carriers it could reach, in the direction
 * this file makes available -- each one now separates the read half from the
 * write half and POINTS here rather than answering for itself:
 *
 *   content/docs/guide/ci-cd-pipeline.md        "Merge Queue" step 3, and the
 *                                               Dependabot Auto-Merge section
 *   .github/workflows/dependabot-auto-merge.yml the header's "does NOT do" list
 *   scripts/dependabot-merge-gate.mjs           "declared = enforced"
 *
 * ⛔ One carrier was deliberately left standing by objectui#9502, and it was
 * not an oversight:
 *
 *   AGENTS.md                             "从仓内读不到"
 *
 * AGENTS.md is GOVERNED surface -- an agent drafts it, an authorised approver
 * lands it -- so objectui#9502 did not touch it. Its parenthetical also covered
 * who may BYPASS the ruleset, and bypass actors are not carried by
 * `GET /rules/branches/{branch}`, the endpoint this file reads. objectui#9520
 * ruled on it as a governed change of its own and split it along that line:
 * the required-checks half now points at this file, and "从仓内读不到" stays on
 * the bypass-actors half alone, where it was measured true -- the ruleset
 * endpoint answers a seat's token with `current_user_can_bypass` and no
 * `bypass_actors` key. ⛔ That kept half is not a missed repair. Nothing in this
 * tree re-derives it, either.
 *
 * The WRITE half of every one of them is still true and this file does not
 * touch it. ⛔ This script never writes: no enrolment, no removal, no ruleset
 * edit. It issues exactly one GET.
 *
 * The READ half is false for a job that has network, and that is the whole
 * reason this gate is cheap rather than impossible:
 *
 *   GET /repos/objectstack-ai/objectui/rules/branches/main   -> HTTP 200
 *
 * Measured 2026-09-14 on ruleset 11776024, which answered with all five rule
 * types (`deletion`, `merge_queue`, `non_fast_forward`, `pull_request`,
 * `required_status_checks`) and the nine contexts it required that day.
 *
 * ⚠️ The reading above was taken through an agent egress proxy that injects
 * credentials, so it does NOT establish what scope the endpoint needs: the same
 * request made with a deliberately invalid bearer token, and with no
 * `Authorization` header at all, also answered 200 with the identical body, and
 * `/rate_limit` answered 15000/hour unauthenticated. That is a broken
 * instrument for the scope question and it is recorded as one. What IS
 * established is that the endpoint answers the shape this file parses. Whether
 * `secrets.GITHUB_TOKEN` under `permissions: contents: read` suffices is
 * settled by the first live run of `required-check-set-patrol.yml`, and the
 * failure direction is safe: no token, or too little scope, is exit 2 (CANNOT
 * READ), never exit 0.
 *
 * ## Two tiers, because a job rename must not manufacture a red
 *
 * `PINNED_CONTEXTS` is what this gate REFUSES over. `WATCHED_CONTEXTS` is the
 * rest of the live set, reported and never red.
 *
 * The split is objectui#9422's triage ruling, and the measurement behind it is
 * this: pinning a context by NAME makes a legitimate job rename red the gate,
 * and a check that goes red on healthy work is how a repository teaches itself
 * to ignore red (objectui#6596). Renames of these names are rare but NOT
 * hypothetical -- `git log -S` over `.github/workflows/` finds one
 * count-changing commit for each of `Type Check`, `Build & E2E`, `Build Docs`
 * and `Changeset Declaration`, two for `Lint` (`6bdb970a04`, 2026-02-18, moved
 * lint to `workflow_dispatch`), and the test-shard SHAPE has already changed
 * once: `71be244d52` (2026-07-17) introduced the 4-way matrix, and `9f7d786bdc`
 * later split the coverage lane into its own four shards. A pin on
 * `Test (shard 1/4)` is a pin on a matrix width that has moved before.
 *
 * `Type Check` is pinned because it is the leg the recorded incident actually
 * failed on. ⚠️ It is also the leg the merge queue has never been OBSERVED
 * rejecting on -- across the 94 merge-queue rejections measured on this
 * repository the failing job is always a Test shard. objectui#3535's dev
 * refused to infer from configuration that the leg would fire and that refusal
 * stands here: this file does not claim the leg is proven. It cuts one way
 * only, and it is an argument FOR watching: the `Type Check` leg is untested in
 * practice, so its silent removal is the removal least likely to be noticed.
 *
 * ⇒ the failure mode ACCEPTED by this split: a silent removal of any watched
 * context is REPORTED in the run summary and does not fail anything. Every
 * member but the pinned one is made observable, not enforced. Promoting one is
 * a one-line move from `WATCHED_CONTEXTS` to `PINNED_CONTEXTS` and a
 * maintainer's call, not a tidy-up.
 *
 * ## Why the rule types are pinned too, and why that is not a widening
 *
 * `Type Check` being a member of a `required_status_checks` rule means nothing
 * if the `merge_queue` rule is gone -- the contexts would then gate a pull
 * request and nothing would gate the queue, which is a different repository
 * from the one this gate believes it is watching. Both rule TYPES are therefore
 * required to be present. A rule type is not a job name: no rename can move it,
 * so this leg cannot manufacture the red the ruling was protecting against.
 *
 * ## An empty answer is a BREACH, not a clean read
 *
 * `GET /rules/branches/<branch>` answers `200 []` for a branch no ruleset
 * targets -- measured on this repository against `zzz-no-such-branch-9422`. So
 * an empty array is indistinguishable, at this endpoint, from "every rule on
 * `main` was deleted", which is precisely the 2026-08-07 state. It is reported
 * as a breach naming both causes, and never as a pass. The branch is taken from
 * the repository's own default branch by the workflow, so the benign cause is a
 * misconfiguration of the patrol that its first run would show.
 *
 * ## Statelessness is load-bearing for the schedule
 *
 * Every run re-reads the FULL current membership; nothing here consumes a delta
 * or a cursor. A scheduled tick that GitHub drops or delays therefore costs
 * detection latency and never coverage -- the next tick sees the same breach.
 * `.github/workflows/required-check-set-patrol.yml`'s header states what that
 * does and does not buy against the patrol's own liveness.
 */

import fs from 'node:fs';

import { isEntrypoint } from './invoked-as.mjs';

export const EXIT_OK = 0;
export const EXIT_CANNOT_RUN = 2;
export const EXIT_BREACHED = 3;

/**
 * The contexts whose absence FAILS this gate. See the header for why this is
 * one name and not the whole set.
 */
export const PINNED_CONTEXTS = Object.freeze(['Type Check']);

/**
 * The rest of the required set. Absence is reported, never red. Kept as a
 * literal rather than derived: deriving the expectation from the live answer
 * would make the gate agree with whatever it found, which is the vacuous
 * reading this whole card is about.
 *
 * ⚠️ MEASURED 2026-09-14 AS NINE NAMES, AND DELIBERATELY NOT NINE HERE. The
 * four `Test (shard N/4)` members were replaced by one aggregator context,
 * `Test`, under objectui#9499's ruling. That is a THREE-STEP change and only
 * the middle step is a commit: the maintainer removes the four contexts, the
 * workflow pull request merges, the maintainer adds `Test`. The old and new
 * names are never both satisfiable, so no single snapshot of the live endpoint
 * is consistent with the tree during that window.
 *
 * ⇒ this list names the set the ruling installs, and the patrol REPORTS
 * `drifted` — exit 0, printed in the run summary, never red — from the moment
 * this lands until the third step is clicked. That is the two-tier split doing
 * exactly what objectui#9422 built it for: a rename must not manufacture a red.
 * `scripts/__tests__/check-required-check-set.test.ts` holds the dated
 * 2026-09-14 answer as a fixture and asserts that this evaluator reads it as
 * `drifted` naming both halves, so the window is observable rather than
 * assumed. ⛔ Re-take the live reading after the click; do not edit this list
 * to agree with whatever the endpoint says.
 *
 * ⭐ objectui#12240 is the same kind of change, run the other way: its ruling
 * names the set this list and `PINNED_CONTEXTS` now declare, the pull request
 * that writes it here merges, and the maintainer edits the ruleset in the same
 * sitting. Between those two acts the live answer still carries
 * `Spec Main Shape Gate`, and the patrol reports it as required but not
 * declared -- `drifted`, exit 0, never red. The test holds that window too, on
 * a dated reading taken the day the ruling was executed.
 *
 * `Governed Surface Queue Guard` is declared here by objectui#12240, whose
 * ruling names it. The maintainer enrolled it under objectui#6596 and nothing
 * added it to this list, so until this change every reading printed it as
 * required but not declared (measured on the live endpoint 2026-10-12). WATCHED,
 * not pinned, like every name below: promoting one is the maintainer's call
 * this header describes, ⛔ not a tidy-up.
 */
export const WATCHED_CONTEXTS = Object.freeze([
  'Lint',
  'Build & E2E',
  'Test',
  'Build Docs',
  'Changeset Declaration',
  // ⛔ TOMBSTONE -- `Spec Main Shape Gate`, watched here from objectui#9969
  // (ruling A, which enrolled it) to objectui#12240, which removed it: the
  // maintainer's ruling B on objectui#12214's open question 1 (ACCEPT
  // 6123370050) took the context out of the required set. objectui#12352 then
  // deleted the workflow that produced it, executing ruling B on
  // objectstack-ai/objectstack#23238: the spec shape gate runs in objectstack
  // now, and no workflow in this repository reports the context any more.
  // ⛔ Do not re-add it, here or to the ruleset: a required context that
  // nothing reports leaves every merge group pending until the ruleset's
  // timeout, with nothing red to point at (objectui#3523).
  'Governed Surface Queue Guard',
]);

/**
 * Rule types that must be present on the branch. Not job names -- see the
 * header for why pinning these cannot manufacture a rename red.
 */
export const REQUIRED_RULE_TYPES = Object.freeze(['merge_queue', 'required_status_checks']);

/** Verdicts, in the order they are decided. */
export const VERDICTS = Object.freeze(['breached', 'drifted', 'intact']);

/** @param {string} verdict */
export function exitCodeFor(verdict) {
  if (verdict === 'breached') return EXIT_BREACHED;
  if (verdict === 'drifted' || verdict === 'intact') return EXIT_OK;
  throw new Error(`unknown verdict ${JSON.stringify(verdict)}`);
}

/**
 * The contexts a `GET /rules/branches/<branch>` answer declares required.
 *
 * @param {unknown} rules  The parsed response body.
 * @returns {{ ruleTypes: string[], contexts: string[] }}
 */
export function readRules(rules) {
  if (!Array.isArray(rules)) {
    throw new Error(`the rules endpoint answered ${typeof rules}, not an array of rules`);
  }
  const ruleTypes = [];
  const contexts = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue;
    const type = /** @type {{ type?: unknown }} */ (rule).type;
    if (typeof type !== 'string') continue;
    ruleTypes.push(type);
    if (type !== 'required_status_checks') continue;
    const declared = /** @type {any} */ (rule).parameters?.required_status_checks;
    if (!Array.isArray(declared)) continue;
    for (const entry of declared) {
      const context = entry && typeof entry === 'object' ? /** @type {any} */ (entry).context : undefined;
      // ⛔ Never fall back to a neighbouring field. A `required_status_checks`
      // entry whose `context` this cannot read is a name this gate did not see,
      // and counting it as seen is how a membership test goes vacuous.
      if (typeof context === 'string') contexts.push(context);
    }
  }
  return { ruleTypes, contexts };
}

/**
 * Judge one reading. Pure: no clock, no network, no process exit.
 *
 * @param {{ rules: unknown, branch?: string, repository?: string }} input
 */
export function evaluate({ rules, branch = 'main', repository = '' }) {
  // The gate's own liveness. Every assertion below is vacuously satisfiable
  // with an empty pin list, so an edit that empties it must fail here rather
  // than turn this file into a green no-op.
  if (PINNED_CONTEXTS.length === 0) {
    throw new Error('PINNED_CONTEXTS is empty: this gate would pass on any answer at all.');
  }

  const { ruleTypes, contexts } = readRules(rules);
  const live = new Set(contexts);

  const missingRuleTypes = REQUIRED_RULE_TYPES.filter((t) => !ruleTypes.includes(t));
  const missingPinned = PINNED_CONTEXTS.filter((c) => !live.has(c));
  const missingWatched = WATCHED_CONTEXTS.filter((c) => !live.has(c));
  const unexpected = contexts.filter((c) => !PINNED_CONTEXTS.includes(c) && !WATCHED_CONTEXTS.includes(c));

  const emptyAnswer = ruleTypes.length === 0;
  const verdict = emptyAnswer || missingRuleTypes.length > 0 || missingPinned.length > 0
    ? 'breached'
    : missingWatched.length > 0 || unexpected.length > 0
      ? 'drifted'
      : 'intact';

  const reading = {
    verdict,
    branch,
    repository,
    emptyAnswer,
    ruleTypes,
    contexts,
    missingRuleTypes,
    missingPinned,
    missingWatched,
    unexpected,
  };
  assertGrounded(reading);
  return reading;
}

/**
 * Refuse a verdict the reading underneath it does not support. The direction
 * that matters is `intact`: a clean verdict over an answer with no contexts in
 * it is the silent pass this gate exists to make impossible.
 *
 * @param {ReturnType<typeof evaluate>} reading
 */
export function assertGrounded(reading) {
  if (!VERDICTS.includes(reading.verdict)) {
    throw new Error(`ungrounded: unknown verdict ${JSON.stringify(reading.verdict)}`);
  }
  if (reading.verdict !== 'breached') {
    if (reading.contexts.length === 0) {
      throw new Error('ungrounded: a non-breached verdict over zero required contexts');
    }
    if (reading.missingPinned.length > 0 || reading.missingRuleTypes.length > 0) {
      throw new Error('ungrounded: a non-breached verdict with something pinned missing');
    }
  }
  if (reading.verdict === 'intact' && (reading.missingWatched.length > 0 || reading.unexpected.length > 0)) {
    throw new Error('ungrounded: an intact verdict over a set that drifted');
  }
  if (reading.verdict === 'breached' && reading.missingPinned.length === 0 && reading.missingRuleTypes.length === 0 && !reading.emptyAnswer) {
    throw new Error('ungrounded: a breach with nothing missing');
  }
}

/**
 * The markdown body of a reading -- the run summary's whole product.
 *
 * @param {ReturnType<typeof evaluate>} reading
 */
export function renderReading(reading) {
  const where = `\`${reading.repository || '<repository>'}\` branch \`${reading.branch}\``;
  const lines = [];

  if (reading.verdict === 'breached') {
    lines.push(`# ⛔ THE MERGE QUEUE'S REQUIRED-CHECK SET LOST SOMETHING PINNED`, '');
    if (reading.emptyAnswer) {
      lines.push(
        `The rules endpoint answered with **no rules at all** for ${where}. Two causes answer the same way`,
        'and this gate cannot tell them apart from here:',
        '',
        '1. every rule on the branch was deleted — the 2026-08-07 state, in which the queue merges',
        '   whatever it is given because it requires nothing;',
        '2. the patrol asked about a branch no ruleset targets (a misconfigured branch name).',
        '',
        'Both need a human. ⛔ Neither is a pass.',
      );
    }
    if (reading.missingRuleTypes.length > 0) {
      lines.push('', `Rule types missing from the branch: ${reading.missingRuleTypes.map((t) => `\`${t}\``).join(', ')}.`);
      if (reading.missingRuleTypes.includes('merge_queue')) {
        lines.push('⚠️ Without `merge_queue` there is no queue for a required set to gate.');
      }
    }
    if (reading.missingPinned.length > 0) {
      lines.push(
        '',
        `Pinned contexts missing from the required set: ${reading.missingPinned.map((c) => `\`${c}\``).join(', ')}.`,
        '',
        'This is the objectui#3523 shape. A context that is not required does not fail a queue build —',
        'the queue merges without it, and nothing anywhere goes red. Restore it in the repository',
        'ruleset (Settings → Rules), or, if the removal was deliberate, move the name out of',
        '`PINNED_CONTEXTS` in `scripts/check-required-check-set.mjs` in the same change.',
      );
    }
  } else if (reading.verdict === 'drifted') {
    lines.push(`# ⚠️ The required-check set changed — nothing pinned is missing`, '');
    lines.push(`Read on ${where}. Reported, deliberately not failed: these names are watched, not pinned.`);
    if (reading.missingWatched.length > 0) {
      lines.push('', `No longer required: ${reading.missingWatched.map((c) => `\`${c}\``).join(', ')}.`);
    }
    if (reading.unexpected.length > 0) {
      lines.push('', `Required but not declared here: ${reading.unexpected.map((c) => `\`${c}\``).join(', ')}.`);
    }
    lines.push(
      '',
      'If this was a rename or a re-shard, update `WATCHED_CONTEXTS` in',
      '`scripts/check-required-check-set.mjs` so the next run reads clean.',
    );
  } else {
    lines.push(`# ✅ The required-check set is intact`, '');
    lines.push(`Read on ${where}.`);
  }

  lines.push(
    '',
    `**Rule types on the branch (${reading.ruleTypes.length}):** ${reading.ruleTypes.length ? reading.ruleTypes.map((t) => `\`${t}\``).join(', ') : '_none_'}`,
    '',
    `**Required contexts (${reading.contexts.length}):**`,
    '',
  );
  if (reading.contexts.length === 0) {
    lines.push('_none — the set is empty._');
  } else {
    for (const c of reading.contexts) {
      const tier = PINNED_CONTEXTS.includes(c) ? ' ← pinned' : '';
      lines.push(`- \`${c}\`${tier}`);
    }
  }
  return lines.join('\n');
}

/** One line for the log, so a run's verdict is readable without the summary. */
export function renderVerdictLine(reading) {
  const n = reading.contexts.length;
  if (reading.verdict === 'breached') {
    const what = reading.emptyAnswer
      ? 'no rules at all on the branch'
      : [...reading.missingRuleTypes, ...reading.missingPinned].join(', ');
    return `⛔ BREACHED — ${what} (${n} required context(s) read).`;
  }
  if (reading.verdict === 'drifted') {
    return `⚠️ DRIFTED — every pinned context present; ${reading.missingWatched.length} watched missing, ${reading.unexpected.length} undeclared (${n} required context(s) read).`;
  }
  return `✅ INTACT — ${PINNED_CONTEXTS.length} pinned and ${WATCHED_CONTEXTS.length} watched context(s) all present (${n} required context(s) read).`;
}

/**
 * The one network read. Separated so `--fixture` and the tests reach `evaluate`
 * without it.
 *
 * @param {{ repository: string, branch: string, token?: string, fetchImpl?: typeof fetch }} input
 */
export async function fetchRules({ repository, branch, token, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${repository}/rules/branches/${encodeURIComponent(branch)}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'objectui-required-check-set-patrol',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`GET ${url} answered HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function main() {
  const argv = process.argv.slice(2);
  const fixtureAt = argv.indexOf('--fixture');
  const repository = process.env.GITHUB_REPOSITORY || 'objectstack-ai/objectui';
  const branch = process.env.QUEUE_BASE_BRANCH || 'main';

  let rules;
  if (fixtureAt !== -1) {
    const path = argv[fixtureAt + 1];
    if (!path) throw new Error('--fixture needs a path');
    rules = JSON.parse(fs.readFileSync(path, 'utf8'));
  } else {
    rules = await fetchRules({ repository, branch, token: process.env.GITHUB_TOKEN });
  }

  const reading = evaluate({ rules, branch, repository });
  if (argv.includes('--json')) {
    console.log(JSON.stringify(reading, null, 2));
  } else {
    console.log(renderReading(reading));
  }
  console.error(renderVerdictLine(reading));
  return reading;
}

export async function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });

  const ctx = (context) => ({ context, integration_id: 15368 });
  /** The live answer measured 2026-09-14, in the endpoint's own shape. */
  const LIVE = [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    { type: 'merge_queue', parameters: { merge_method: 'SQUASH' } },
    { type: 'pull_request', parameters: {} },
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [...PINNED_CONTEXTS, ...WATCHED_CONTEXTS].map(ctx),
      },
    },
  ];
  const withContexts = (names) =>
    LIVE.map((r) => (r.type === 'required_status_checks' ? { ...r, parameters: { ...r.parameters, required_status_checks: names.map(ctx) } } : r));
  const read = (rules) => evaluate({ rules, branch: 'main', repository: 'objectstack-ai/objectui' });

  // ── the exit contract, so the header's table cannot drift from the code ────
  t('exit-ok-is-0', EXIT_OK === 0);
  t('exit-cannot-run-is-2', EXIT_CANNOT_RUN === 2);
  t('exit-breached-is-3', EXIT_BREACHED === 3);
  t('only-a-breach-is-a-finding', VERDICTS.every((v) => exitCodeFor(v) === (v === 'breached' ? EXIT_BREACHED : EXIT_OK)));

  // ── the live corpus ───────────────────────────────────────────────────────
  const live = read(LIVE);
  t('the-live-set-is-INTACT', live.verdict === 'intact', live.verdict);
  t('an-intact-reading-exits-0', exitCodeFor(live.verdict) === EXIT_OK);
  // ⚠️ NINE until objectui#9499 replaced the four `Test (shard N/4)` members
  // with one aggregator context. The number is asserted from the declaration
  // rather than typed, so it can never be the stale half of this pair; what it
  // still catches is a `LIVE` corpus that stopped covering the declared tiers.
  t(
    'the-live-corpus-covers-exactly-the-declared-tiers',
    live.contexts.length === PINNED_CONTEXTS.length + WATCHED_CONTEXTS.length,
    String(live.contexts.length),
  );
  t('the-live-reading-names-every-context-it-read', PINNED_CONTEXTS.concat(WATCHED_CONTEXTS).every((c) => renderReading(live).includes(`\`${c}\``)));

  // ── ⭐ THE ABLATION: the gate must RED when a pinned member is gone ────────
  // The live set is clean, so the only thing proving this detector can still
  // fail is a corpus one member short of it.
  const withoutTypeCheck = read(withContexts(WATCHED_CONTEXTS.slice()));
  t('the-live-set-MINUS-Type-Check-is-BREACHED', withoutTypeCheck.verdict === 'breached', withoutTypeCheck.verdict);
  t('a-breach-exits-3', exitCodeFor(withoutTypeCheck.verdict) === EXIT_BREACHED);
  t('a-breach-names-the-missing-context', renderReading(withoutTypeCheck).includes('`Type Check`'));
  t('a-breach-never-renders-as-healthy', !/✅/.test(renderReading(withoutTypeCheck)));
  t('a-breach-names-the-incident-shape', renderReading(withoutTypeCheck).includes('#3523'));

  // ── the nonsense control: a context that cannot exist is never a member ───
  const nonsense = read(withContexts(['Type Checq', ...WATCHED_CONTEXTS]));
  t('a-near-miss-spelling-does-NOT-satisfy-the-pin', nonsense.verdict === 'breached', nonsense.verdict);
  t('a-near-miss-spelling-is-reported-as-undeclared', nonsense.unexpected.includes('Type Checq'));

  // ── the tiers really are two tiers ────────────────────────────────────────
  const shardGone = read(withContexts([...PINNED_CONTEXTS, ...WATCHED_CONTEXTS.filter((c) => c !== 'Build Docs')]));
  t('a-WATCHED-context-going-missing-is-DRIFTED-not-breached', shardGone.verdict === 'drifted', shardGone.verdict);
  t('a-drift-exits-0', exitCodeFor(shardGone.verdict) === EXIT_OK);
  t('a-drift-names-what-left', renderReading(shardGone).includes('`Build Docs`'));
  t('a-drift-never-renders-as-intact', !/✅/.test(renderReading(shardGone)));

  // ── the empty answer, measured against `zzz-no-such-branch-9422` ──────────
  const empty = read([]);
  t('an-empty-rules-answer-is-BREACHED-not-intact', empty.verdict === 'breached', empty.verdict);
  t('an-empty-answer-names-both-of-its-causes', /deleted/.test(renderReading(empty)) && /misconfigured branch name/.test(renderReading(empty)));

  // ── the rule types ────────────────────────────────────────────────────────
  const noQueue = read(LIVE.filter((r) => r.type !== 'merge_queue'));
  t('losing-the-merge_queue-rule-is-BREACHED', noQueue.verdict === 'breached', noQueue.verdict);
  t('losing-the-merge_queue-rule-says-why', renderReading(noQueue).includes('no queue for a required set to gate'));
  const noChecks = read(LIVE.filter((r) => r.type !== 'required_status_checks'));
  t('losing-the-required_status_checks-rule-is-BREACHED', noChecks.verdict === 'breached', noChecks.verdict);

  // ── an entry whose context cannot be read is NOT counted as seen ──────────
  const unreadable = read(
    LIVE.map((r) =>
      r.type === 'required_status_checks'
        ? { ...r, parameters: { required_status_checks: [{ integration_id: 15368 }, ...WATCHED_CONTEXTS.map(ctx)] } }
        : r,
    ),
  );
  t('an-entry-with-no-context-field-is-not-a-member', unreadable.verdict === 'breached', unreadable.verdict);

  // ── the grounding refusal itself ──────────────────────────────────────────
  const ungrounded = (reading) => {
    try {
      assertGrounded(reading);
      return false;
    } catch {
      return true;
    }
  };
  const base = { branch: 'main', repository: 'r', emptyAnswer: false, ruleTypes: [...REQUIRED_RULE_TYPES], contexts: [], missingRuleTypes: [], missingPinned: [], missingWatched: [], unexpected: [] };
  t('intact-over-zero-contexts-is-refused', ungrounded({ ...base, verdict: 'intact' }));
  t('intact-with-a-pinned-context-missing-is-refused', ungrounded({ ...base, verdict: 'intact', contexts: ['x'], missingPinned: ['Type Check'] }));
  t('intact-over-a-drifted-set-is-refused', ungrounded({ ...base, verdict: 'intact', contexts: ['x'], missingWatched: ['Lint'] }));
  t('a-breach-with-nothing-missing-is-refused', ungrounded({ ...base, verdict: 'breached', contexts: ['x'] }));
  t('an-unknown-verdict-is-refused', ungrounded({ ...base, verdict: 'fine' }));

  // ── the parser refuses shapes it cannot read, rather than reading them as 0 ─
  const throws = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  t('a-non-array-body-throws-rather-than-reading-as-empty', throws(() => readRules({ message: 'Not Found' })));
  t('a-null-body-throws', throws(() => readRules(null)));

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-required-check-set self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-required-check-set self-test: ${cases.length} cases pass (the declared set, the same corpus one PINNED member short, a near-miss spelling, a watched member leaving, an empty answer, both rule types, and every ungrounded verdict refused).`,
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    process.exitCode = await selfTest();
  } else {
    try {
      const reading = await main();
      process.exitCode = exitCodeFor(reading.verdict);
    } catch (error) {
      console.error(`::error::check-required-check-set could not take a reading: ${error instanceof Error ? error.message : String(error)}`);
      console.error('A reading that could not be taken says NOTHING about the required-check set. This is not an intact set.');
      process.exitCode = EXIT_CANNOT_RUN;
    }
  }
}
