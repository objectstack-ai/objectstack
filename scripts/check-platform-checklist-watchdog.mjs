#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-platform-checklist-watchdog (#11730) -- the static pin over
 * `.github/workflows/platform-checklist-watchdog.yml`, the daily caller that
 * gives `check:platform-checklist`'s red a reporting channel.
 *
 *   node scripts/check-platform-checklist-watchdog.mjs              # the gate
 *   node scripts/check-platform-checklist-watchdog.mjs --list       # what it read
 *   node scripts/check-platform-checklist-watchdog.mjs --self-test  # prove it can go red
 *
 * ## What is pinned, and why the NEGATIVE half is the load-bearing half
 *
 * `check:platform-checklist` is NOT wired into per-PR CI, by a standing
 * maintainer decision recorded in the checklist NOTE in
 * `.github/workflows/lint.yml` and in `docs/qa/platform-checklist/README.md`
 * under "Operating cadence": the checklist is a QA ledger, not a code gate, so
 * an unrelated pull request is never blocked by checklist drift. The watchdog
 * changes the REPORTING CHANNEL and nothing else.
 *
 * So this gate pins six things, and the third and fourth are the ones worth
 * having:
 *
 *   1. the workflow FILE EXISTS and parses as YAML;
 *   2. it carries `schedule:` (with a real `cron:`) and `workflow_dispatch:`;
 *   3. it carries NO `merge_group:` and NO `pull_request_target:` trigger;
 *   4. any `pull_request:` trigger it carries is `paths`-filtered to THIS
 *      WORKFLOW FILE AND NOTHING ELSE;
 *   5. it invokes the gate's PACKAGE SCRIPT, `pnpm check:platform-checklist`;
 *   6. and it does NOT inline a copy of that alias's command.
 *
 * Clauses 3 and 4 are why this file exists rather than a comment asking nicely.
 * A pin that asserted only the positive ones would be GREEN on a workflow that
 * had been quietly given an UNFILTERED `pull_request:` trigger -- i.e. green on
 * the one edit that contradicts the decision the watchdog was built to
 * preserve. A test that cannot fail on the change it exists to catch is the
 * shape this tree keeps paying for, so every clause below, positive and
 * negative, has a `--self-test` fixture that makes it FIRE, next to one that
 * keeps it silent.
 *
 * ## Why clause 4 is a FILTER and not a refusal (the 2026-09-06 ruling)
 *
 * The card's first ruling refused `pull_request:` outright. Implementing that
 * literally created this tree's FIRST scheduled-only gate family and reddened
 * `scripts/pm/dispatch-gates.mjs`, which pins tree-wide that every discovered
 * family reaches a PR-time trigger -- because every patrol here carries a
 * paths-filtered `pull_request:`. Put to the maintainer as an A/B/C fork, the
 * answer was A: filter the trigger rather than forbid it.
 *
 * The filter is the whole of what makes that compatible. The decision's own
 * words, in `.github/workflows/lint.yml`: "keeping it out of the per-PR path
 * means an unrelated PR is never blocked by checklist drift." A trigger naming
 * only this workflow fires on no unrelated pull request, so the decision's
 * PURPOSE is untouched; only its letter changed. Widen the filter by one path
 * and that stops being true, which is exactly what clause 4 refuses.
 *
 * `pull_request_target:` stays refused outright beside `merge_group:`. It is a
 * per-PR trigger under another name that no `paths:` filter makes safe here,
 * and a pin refusing one while accepting its sibling is a pin with a documented
 * hole in it.
 *
 * ## Clause 4's other half: a pull request must never write the board
 *
 * A trigger that runs the gate on a pull request is only safe while that run
 * cannot FILE anything. So a step that calls the issues endpoint must carry the
 * `pull_request` guard in its own `if:`; a board write reachable from a pull
 * request run is refused, and the self-test drives both directions.
 *
 * ## Why clause 4 is not cosmetic
 *
 * `check:platform-checklist` is an alias for TWO commands -- a
 * `checklist-select.mjs --self-test` leg and the gate itself -- so an inlined
 * `node scripts/check-platform-checklist.mjs` in the workflow would run the
 * gate while silently dropping the self-test leg the alias runs first, and
 * would drift from the invocation the cadence documentation tells a human to
 * type. Clause 5 is clause 4's other half: asserting the alias is present says
 * nothing about a copy sitting beside it.
 *
 * ## Why the workflow itself cannot hold this
 *
 * The watchdog carries no `pull_request:` trigger, by clause 3, so it never
 * runs on a pull request and cannot judge the pull request that edits it.
 * Worse, a pull request DELETING the workflow would silence any check that
 * lived inside it -- a patrol cannot report its own removal. This gate runs in
 * `lint.yml` on every pull request instead, which is the only place the
 * absence of a file is observable before it merges.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireDependency } from './import-prerequisite.mjs';
import { commandWords, invokes, shellCommands } from './check-shard-attestation.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

export const WORKFLOW_REL = '.github/workflows/platform-checklist-watchdog.yml';
export const PACKAGE_SCRIPT = 'check:platform-checklist';
export const REQUIRED_TRIGGERS = Object.freeze(['schedule', 'workflow_dispatch']);
export const REFUSED_TRIGGERS = Object.freeze(['pull_request_target', 'merge_group']);

/**
 * The only path a `pull_request:` trigger on this workflow may name. One entry,
 * and the gate compares the declared list to it as a SET -- not a prefix, not a
 * subset -- so neither widening it nor swapping it for some other file passes.
 */
export const PR_TRIGGER_ALLOWED_PATHS = Object.freeze([WORKFLOW_REL]);

/** The `if:` condition a board-writing step must carry. */
export const PR_WRITE_GUARD = "github.event_name != 'pull_request'";

/** Calls that write to the board. Matched in a step's `run:` or `with.script`. */
const BOARD_WRITE_CALLS = Object.freeze([
  'issues.create(',
  'issues.update(',
  'issues.createComment(',
  'issues.addLabels(',
]);

// ── The self-test's own battery roster and floor ───────────────────────────
//
// `failures.length === 0` alone cannot tell "every case held" from "the cases
// never ran": both print the same green line, and a printed `checked` count
// that nothing COMPARES is evidence, not proof. So each battery declares a
// FLOOR and the roster is compared as a SET — a set difference names WHICH
// battery stopped, where a count says only that something did.
//
// The counts are a floor, not an equality: adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running, and the
// remedy is to find what stopped registering — ⛔ never to lower the number.
//
// ⛔ A pinned TOTAL is not the repair either: one battery dropping from 12
// cases to 2 keeps a total "right" the moment a sibling grows.
const SELF_TEST_BATTERIES = Object.freeze({
  'the positive control — a compliant workflow yields no finding': 2,
  'clause 1 — the file exists, is non-empty, and parses as a workflow': 5,
  'clause 2 — schedule (with a real cron) and workflow_dispatch': 5,
  'clause 3 — merge_group and pull_request_target refused outright': 6,
  'clause 4 — a pull_request trigger paths-filtered to this file ALONE': 10,
  'clause 4b — no board write reachable from a pull_request run': 6,
  'clauses 5 and 6 — the package script, and no inlined copy of it': 5,
  'the manifest clause — the package script exists to be invoked': 3,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned beside the floors.
const SELF_TEST_BATTERY_FLOOR = 8;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Set by `selfTest()` only after a verdict is printed — EITHER verdict — and
// read at the dispatch: a `return` that leaves the function above those lines
// prints nothing and still exits 0, so a self-test that never finished would
// report as one that passed. The failure path sets it too, so the refusal fires
// only when NEITHER verdict was printed, never on a genuine red.
let selfTestReachedVerdict = false;

/** The tail every trigger refusal carries, so one reason is stated once. */
const DECISION_TAIL = 'A standing maintainer decision keeps `check:platform-checklist` off the per-PR path, in its own words so that "an unrelated PR is never blocked by checklist drift"; this workflow changes the reporting channel and must never undo that.';

/**
 * The basenames whose direct invocation clause 5 refuses. Both halves of the
 * alias, because dropping either one is the drift clause 4 exists to prevent.
 */
const INLINED_GATE_BASENAMES = Object.freeze([
  'check-platform-checklist.mjs',
  'checklist-select.mjs',
]);

/** Every `run:` script in the workflow, flattened across jobs and steps. */
function runBlocks(doc) {
  const jobs = doc?.jobs;
  if (!jobs || typeof jobs !== 'object') return [];
  const out = [];
  for (const job of Object.values(jobs)) {
    const steps = job?.steps;
    if (!Array.isArray(steps)) continue;
    for (const step of steps) {
      if (step && typeof step.run === 'string') out.push(step.run);
    }
  }
  return out;
}

/**
 * The trigger block's key.
 *
 * YAML 1.2's core schema reads `on` as the string it looks like, which is what
 * the `yaml` package gives us. YAML 1.1 read it as the boolean `true`, and a
 * parser that did so would hand us an object with no `on` key at all -- so a
 * rule looking only for `on` would find no triggers, report no refused ones,
 * and pass. Both spellings are accepted so a parser swap cannot turn this gate
 * into one that silently reads nothing.
 */
function triggerNames(doc) {
  const key = Object.prototype.hasOwnProperty.call(doc, 'on') ? 'on'
    : Object.prototype.hasOwnProperty.call(doc, 'true') ? 'true'
      : null;
  if (key === null) return { names: null, reason: 'the workflow declares no trigger block at all (no `on:` key)' };
  const block = doc[key];
  if (Array.isArray(block)) return { names: block.map((n) => String(n)), reason: null };
  if (typeof block === 'string') return { names: [block], reason: null };
  if (block && typeof block === 'object') return { names: Object.keys(block), reason: null };
  return { names: null, reason: 'the `on:` key is present but carries no trigger names' };
}

/** Does the `schedule:` trigger carry at least one real `cron:` expression? */
function hasRealCron(doc) {
  const key = Object.prototype.hasOwnProperty.call(doc, 'on') ? 'on' : 'true';
  const schedule = doc?.[key]?.schedule;
  if (!Array.isArray(schedule)) return false;
  return schedule.some((e) => e && typeof e.cron === 'string' && e.cron.trim() !== '');
}

function invokesInlinedGate(commands) {
  return commands.some((command) => {
    const words = commandWords(command).filter((w) => !w.quoted).map((w) => w.word);
    const at = words.findIndex((w) => w === 'node' || w.endsWith('/node'));
    if (at === -1) return false;
    return words.slice(at + 1).some((w) => INLINED_GATE_BASENAMES
      .some((b) => w === b || w.endsWith(`/${b}`)));
  });
}

/** The trigger block, under either spelling of the `on:` key. */
function triggerBlock(doc) {
  const key = Object.prototype.hasOwnProperty.call(doc, 'on') ? 'on'
    : Object.prototype.hasOwnProperty.call(doc, 'true') ? 'true'
      : null;
  return key === null ? undefined : doc[key];
}

/**
 * Clause 4. A `pull_request:` trigger is PERMITTED here, and only while it is
 * `paths`-filtered to this workflow alone. Every way of not being that -- no
 * configuration at all, a `paths-ignore:` (which is the filter's COMPLEMENT and
 * fires on everything else), an empty list, an extra entry, a different file --
 * is a separate refusal, because the remedy differs and a reader should be told
 * which one they wrote.
 */
export function judgePullRequestTrigger(doc) {
  const block = triggerBlock(doc);
  const pr = block && typeof block === 'object' && !Array.isArray(block) ? block.pull_request : undefined;
  const head = `${WORKFLOW_REL} declares a \`pull_request:\` trigger`;
  const out = [];
  if (!pr || typeof pr !== 'object' || Array.isArray(pr)) {
    out.push(`${head} with no configuration, so it fires on EVERY pull request. ${DECISION_TAIL} Filter it to \`paths: ['${WORKFLOW_REL}']\`.`);
    return out;
  }
  if ('paths-ignore' in pr) {
    out.push(`${head} filtered by \`paths-ignore:\`, which is a filter's COMPLEMENT — it fires on every pull request that does NOT touch the listed paths, i.e. on almost all of them. ${DECISION_TAIL} Use \`paths:\` instead.`);
  }
  const paths = pr.paths;
  if (!Array.isArray(paths) || paths.length === 0) {
    out.push(`${head} with no usable \`paths:\` filter, so it fires on EVERY pull request. ${DECISION_TAIL} Filter it to \`paths: ['${WORKFLOW_REL}']\`.`);
    return out;
  }
  const declared = paths.map((x) => String(x));
  const extra = declared.filter((x) => !PR_TRIGGER_ALLOWED_PATHS.includes(x));
  const missing = PR_TRIGGER_ALLOWED_PATHS.filter((x) => !declared.includes(x));
  if (extra.length > 0) {
    out.push(`${head} whose \`paths:\` filter also names ${extra.map((x) => `\`${x}\``).join(', ')}. ${DECISION_TAIL} Widening this filter by one path puts the checklist gate on the critical path of pull requests that have nothing to do with it — the filter may name this workflow and nothing else.`);
  }
  if (missing.length > 0) {
    out.push(`${head} whose \`paths:\` filter does not name ${missing.map((x) => `\`${x}\``).join(', ')}, so a change to the watchdog itself is never exercised before it merges — which is the only thing this trigger is for.`);
  }
  return out;
}

/**
 * Clause 4's other half. A step that writes to the board must be unreachable
 * from a `pull_request` run. Judged on the step's own `if:`, because that is
 * what Actions evaluates — a comment promising the same thing is not a guard.
 */
export function judgeBoardWrites(doc) {
  const out = [];
  const jobs = doc?.jobs;
  if (!jobs || typeof jobs !== 'object') return out;
  for (const [jobId, job] of Object.entries(jobs)) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    for (const step of steps) {
      const text = [step?.run, step?.with?.script]
        .filter((x) => typeof x === 'string').join('\n');
      const call = BOARD_WRITE_CALLS.find((c) => text.includes(c));
      if (!call) continue;
      const cond = typeof step?.if === 'string' ? step.if : '';
      if (!cond.includes(PR_WRITE_GUARD)) {
        const where = step?.name ? `step "${step.name}"` : `a step of job \`${jobId}\``;
        out.push(`${WORKFLOW_REL}: ${where} calls \`${call}\` but its \`if:\` does not carry \`${PR_WRITE_GUARD}\`, so a pull_request run could write to the board. A pull request proves the sweep on a real runner; ⛔ it must never file or refresh anything.`);
      }
    }
  }
  return out;
}

/**
 * Judge one workflow's TEXT. Pure over its inputs so `--self-test` can drive
 * every clause with a fixture instead of asserting it into the void.
 *
 * @param {string|null} text the workflow source, or null when the file is absent
 * @param {(s: string) => unknown} parse a YAML parser
 * @returns {{ failures: string[], triggers: string[] | null }}
 */
export function judgeWorkflow(text, parse) {
  if (text === null || text === undefined) {
    return { failures: [`${WORKFLOW_REL} does not exist. It is the ONLY reporting channel \`${PACKAGE_SCRIPT}\` has -- the gate is not in per-PR CI by maintainer decision, so without this file a red checklist is visible to nobody.`], triggers: null };
  }
  if (typeof text !== 'string' || text.trim() === '') {
    return { failures: [`${WORKFLOW_REL} is empty.`], triggers: null };
  }

  let doc;
  try {
    doc = parse(text);
  } catch (err) {
    return { failures: [`${WORKFLOW_REL} could not be read as YAML: ${err?.message ?? err}`], triggers: null };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { failures: [`${WORKFLOW_REL} does not parse to a workflow mapping.`], triggers: null };
  }

  const failures = [];
  const { names, reason } = triggerNames(doc);
  if (names === null) {
    failures.push(`${WORKFLOW_REL}: ${reason}.`);
  } else {
    for (const t of REQUIRED_TRIGGERS) {
      if (!names.includes(t)) {
        failures.push(`${WORKFLOW_REL} declares no \`${t}:\` trigger. A watchdog with no schedule reports on a cadence of never, and one with no manual dispatch cannot be smoke-tested.`);
      }
    }
    for (const t of REFUSED_TRIGGERS) {
      if (names.includes(t)) {
        failures.push(`${WORKFLOW_REL} declares a \`${t}:\` trigger. ⛔ Refused outright — no \`paths:\` filter makes it safe here. ${DECISION_TAIL}`);
      }
    }
    if (names.includes('pull_request')) {
      failures.push(...judgePullRequestTrigger(doc));
    }
    if (names.includes('schedule') && !hasRealCron(doc)) {
      failures.push(`${WORKFLOW_REL} declares \`schedule:\` but no usable \`cron:\` expression under it, so it would never fire.`);
    }
  }

  failures.push(...judgeBoardWrites(doc));

  const commands = runBlocks(doc).flatMap((run) => shellCommands(run));
  if (!commands.some((c) => invokes(c, 'pnpm', PACKAGE_SCRIPT))) {
    failures.push(`${WORKFLOW_REL} never invokes \`pnpm ${PACKAGE_SCRIPT}\`. The package script is what the cadence documentation tells a human to run, and it is an alias for two commands -- pinning the alias is what keeps the workflow and the documented invocation from drifting apart.`);
  }
  if (invokesInlinedGate(commands)) {
    failures.push(`${WORKFLOW_REL} invokes the gate's script directly instead of through \`pnpm ${PACKAGE_SCRIPT}\`. An inlined copy silently drops whichever leg of the alias it did not copy.`);
  }

  return { failures, triggers: names };
}

/** The package script clause -- read from the root manifest, not from the workflow. */
export function judgeManifest(manifestText) {
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (err) {
    return [`the root package.json could not be parsed: ${err?.message ?? err}`];
  }
  const scripts = manifest?.scripts;
  if (!scripts || typeof scripts !== 'object' || !(PACKAGE_SCRIPT in scripts)) {
    return [`the root package.json declares no \`${PACKAGE_SCRIPT}\` script, so the invocation ${WORKFLOW_REL} is pinned to would fail on every run.`];
  }
  return [];
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// A minimal workflow that satisfies every clause. Each self-test case mutates
// exactly one thing about it, so a case that fires names one cause.
const GOOD = `name: Platform-Checklist Watchdog
on:
  schedule:
    - cron: '51 2 * * *'
  workflow_dispatch: {}
  pull_request:
    paths:
      - '.github/workflows/platform-checklist-watchdog.yml'
permissions:
  contents: read
  issues: write
jobs:
  watchdog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Run the platform checklist gate
        id: gate
        run: |
          set +e
          pnpm check:platform-checklist > "$RUNNER_TEMP/gate.out" 2>&1
          echo "exit_code=$?" >> "$GITHUB_OUTPUT"
      - name: File or refresh the watchdog issue
        if: steps.gate.outputs.exit_code != '0' && github.event_name != 'pull_request'
        uses: actions/github-script@v9
        with:
          script: |
            await github.rest.issues.create({ owner, repo, title, body });
`;

const withTrigger = (name) => GOOD.replace('  workflow_dispatch: {}\n', `  workflow_dispatch: {}\n  ${name}: {}\n`);

/** Swap the whole `pull_request:` block for another spelling of it. */
const PR_BLOCK = "  pull_request:\n    paths:\n      - '.github/workflows/platform-checklist-watchdog.yml'\n";
const withPullRequest = (block) => GOOD.replace(PR_BLOCK, block);

export function selfTest(parse) {
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const seen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
  };
  const failures = [];
  let checked = 0;
  const t = (what, ok) => {
    registerCase();
    checked += 1;
    if (!ok) failures.push(what);
  };
  const fires = (text, needle) => {
    const { failures: f } = judgeWorkflow(text, parse);
    return f.some((m) => m.includes(needle));
  };

  battery('the positive control — a compliant workflow yields no finding');
  // The positive control. Every clause must be SILENT on a good workflow --
  // without this, a rule that fires on everything would pass every case below.
  const good = judgeWorkflow(GOOD, parse);
  t('the good fixture must produce zero findings (positive control)', good.failures.length === 0);
  t('the good fixture must report its triggers', Array.isArray(good.triggers) && good.triggers.includes('schedule'));

  battery('clause 1 — the file exists, is non-empty, and parses as a workflow');
  // Clause 1 -- absence and unreadability.
  t('a missing workflow ⇒ names the file', fires(null, WORKFLOW_REL));
  t('a missing workflow ⇒ says the gate has no other channel', fires(null, 'is visible to nobody'));
  t('an empty workflow ⇒ fires', fires('', 'is empty'));
  t('unparseable YAML ⇒ fires with the parse error', fires('jobs:\n  a:\n  \tbad: [', 'could not be read as YAML'));
  t('a YAML scalar ⇒ fires', fires('just a string', 'does not parse to a workflow mapping'));

  battery('clause 2 — schedule (with a real cron) and workflow_dispatch');
  // Clause 2 -- the positive triggers.
  t('no `on:` block at all ⇒ fires', fires('name: x\njobs: {}\n', 'declares no trigger block'));
  t('no `schedule:` ⇒ fires', fires(GOOD.replace(/  schedule:\n    - cron: '51 2 \* \* \*'\n/, ''), 'declares no `schedule:` trigger'));
  t('no `workflow_dispatch:` ⇒ fires', fires(GOOD.replace('  workflow_dispatch: {}\n', ''), 'declares no `workflow_dispatch:` trigger'));
  t('a `schedule:` with no cron ⇒ fires', fires(GOOD.replace("    - cron: '51 2 * * *'\n", '    - {}\n'), 'no usable `cron:`'));
  t('a `schedule:` with an empty cron ⇒ fires', fires(GOOD.replace("'51 2 * * *'", "''"), 'no usable `cron:`'));

  battery('clause 3 — merge_group and pull_request_target refused outright');
  // Clause 3 -- REFUSED OUTRIGHT. Each fires on its own, and the good fixture
  // above proves neither fires without cause.
  for (const trigger of REFUSED_TRIGGERS) {
    t(`a \`${trigger}:\` trigger ⇒ fires`, fires(withTrigger(trigger), `declares a \`${trigger}:\` trigger`));
    t(`a \`${trigger}:\` trigger ⇒ says it is refused outright`, fires(withTrigger(trigger), 'Refused outright'));
    t(`a \`${trigger}:\` trigger ⇒ cites the decision it protects`, fires(withTrigger(trigger), 'never blocked by checklist drift'));
  }

  battery('clause 4 — a pull_request trigger paths-filtered to this file ALONE');
  // Clause 4 -- THE NARROWED CLAUSE. `pull_request:` is permitted, and ONLY
  // while its `paths:` filter names this workflow and nothing else. The good
  // fixture carries exactly that and is silent (asserted above), so each case
  // here is a single mutation away from a shape that passes.
  t('an UNFILTERED `pull_request:` ⇒ fires', fires(withPullRequest('  pull_request: {}\n'), 'fires on EVERY pull request'));
  t('an unfiltered `pull_request:` ⇒ names the remedy', fires(withPullRequest('  pull_request: {}\n'), "Filter it to `paths:"));
  t('a `pull_request:` with only `types:` and no paths ⇒ fires', fires(
    withPullRequest('  pull_request:\n    types: [opened, synchronize]\n'), 'no usable `paths:` filter'));
  t('a `pull_request:` with an EMPTY paths list ⇒ fires', fires(
    withPullRequest('  pull_request:\n    paths: []\n'), 'no usable `paths:` filter'));
  t('⭐ a paths filter naming ANOTHER file BESIDE this one ⇒ fires', fires(
    withPullRequest("  pull_request:\n    paths:\n      - '.github/workflows/platform-checklist-watchdog.yml'\n      - 'docs/qa/platform-checklist/**'\n"),
    'also names `docs/qa/platform-checklist/**`'));
  t('…and it says widening is the defect', fires(
    withPullRequest("  pull_request:\n    paths:\n      - '.github/workflows/platform-checklist-watchdog.yml'\n      - 'docs/qa/platform-checklist/**'\n"),
    'may name this workflow and nothing else'));
  t('⭐ a paths filter naming a DIFFERENT file instead ⇒ fires on both halves', (() => {
    const text = withPullRequest("  pull_request:\n    paths:\n      - 'scripts/check-platform-checklist.mjs'\n");
    return fires(text, 'also names `scripts/check-platform-checklist.mjs`')
      && fires(text, 'does not name `.github/workflows/platform-checklist-watchdog.yml`');
  })());
  t('a `paths-ignore:` filter ⇒ fires, and is called the complement', fires(
    withPullRequest("  pull_request:\n    paths-ignore:\n      - 'README.md'\n"), "filter's COMPLEMENT"));
  t('the bare flow-sequence spelling `on: [pull_request]` ⇒ fires', fires(
    'on: [schedule, workflow_dispatch, pull_request]\njobs: {}\n', 'with no configuration'));
  // A trigger named only in a COMMENT is not a trigger. This gate judges the
  // parsed document, so prose about the filter cannot be read as the filter
  // being violated -- and the workflow's own header says `pull_request` out
  // loud several times.
  t('`pull_request` in a comment ⇒ silent', judgeWorkflow(
    GOOD.replace('on:\n', '# the pull_request trigger below is paths-filtered; merge_group is refused\non:\n'), parse,
  ).failures.length === 0);

  battery('clause 4b — no board write reachable from a pull_request run');
  // Clause 4's other half -- a board write reachable from a pull_request run.
  const UNGUARDED = GOOD.replace("        if: steps.gate.outputs.exit_code != '0' && github.event_name != 'pull_request'\n", "        if: steps.gate.outputs.exit_code != '0'\n");
  t('⭐ a board write whose `if:` drops the pull_request guard ⇒ fires', fires(UNGUARDED, 'could write to the board'));
  t('…and it names the call it found', fires(UNGUARDED, 'issues.create('));
  t('a board write with NO `if:` at all ⇒ fires', fires(
    GOOD.replace("        if: steps.gate.outputs.exit_code != '0' && github.event_name != 'pull_request'\n", ''), 'could write to the board'));
  t('a comment promising the guard is not a guard', fires(
    UNGUARDED.replace('          script: |\n', '          # never on a pull_request run\n          script: |\n'), 'could write to the board'));
  t('`issues.update(` is caught as well as `issues.create(`', fires(
    UNGUARDED.replace('issues.create(', 'issues.update('), 'issues.update('));
  t('a step that writes nothing needs no guard (no false positive)', judgeBoardWrites(
    parse('jobs:\n  j:\n    steps:\n      - name: read only\n        run: echo hi\n')).length === 0);

  battery('clauses 5 and 6 — the package script, and no inlined copy of it');
  // Clause 4 / 5 -- the invocation.
  t('no `pnpm check:platform-checklist` ⇒ fires', fires(
    GOOD.replace('pnpm check:platform-checklist', 'pnpm check:something-else'),
    `never invokes \`pnpm ${PACKAGE_SCRIPT}\``,
  ));
  t('an inlined `node scripts/check-platform-checklist.mjs` ⇒ fires', fires(
    GOOD.replace('pnpm check:platform-checklist', 'node scripts/check-platform-checklist.mjs'),
    "invokes the gate's script directly",
  ));
  t('an inlined gate BESIDE the alias still fires', fires(
    GOOD.replace('pnpm check:platform-checklist', 'pnpm check:platform-checklist && node scripts/check-platform-checklist.mjs'),
    "invokes the gate's script directly",
  ));
  t('an inlined `node scripts/checklist-select.mjs` ⇒ fires', fires(
    GOOD.replace('pnpm check:platform-checklist', 'node scripts/checklist-select.mjs --self-test'),
    "invokes the gate's script directly",
  ));
  t('the alias named in an `echo` is not an invocation', fires(
    GOOD.replace('pnpm check:platform-checklist', 'echo "run pnpm check:platform-checklist by hand"'),
    `never invokes \`pnpm ${PACKAGE_SCRIPT}\``,
  ));

  battery('the manifest clause — the package script exists to be invoked');
  // The manifest clause.
  t('a manifest without the script ⇒ fires', judgeManifest('{"scripts":{"lint":"eslint ."}}').length === 1);
  t('a manifest with the script ⇒ silent', judgeManifest(`{"scripts":{"${PACKAGE_SCRIPT}":"node x.mjs"}}`).length === 0);
  t('an unparseable manifest ⇒ fires', judgeManifest('{').length === 1);

  // ── The floor, evaluated BEFORE either verdict is printed ───────────────
  // A set difference over battery NAMES, so a battery that stopped running
  // names itself instead of hiding inside a smaller total.
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    failures.push(`SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`);
  }
  for (const [name, count] of seen) {
    if (declaredBatteries.includes(name)) continue;
    failures.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.`);
  }
  for (const name of declaredBatteries) {
    const count = seen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    failures.push(count === 0
      ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict would otherwise have claimed those cases hold.`
      : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do (⛔ MAINTAINER-ONLY: lowering a floor is not the repair).`);
  }

  if (failures.length > 0) {
    console.error(`\nx check-platform-checklist-watchdog self-test: ${failures.length} of ${checked} assertions failed\n`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error('');
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(`OK check-platform-checklist-watchdog self-test: ${checked} assertions across ${declaredBatteries.length} floored batteries, every clause driven by a fixture that makes it fire.`);
  selfTestReachedVerdict = true;
  return 0;
}

async function main(argv) {
  const { parse } = await requireDependency('yaml', () => import('yaml'), import.meta.url);

  if (argv.includes('--self-test')) {
    const code = selfTest(parse);
    if (!selfTestReachedVerdict) {
      console.error(
        '\nx check-platform-checklist-watchdog self-test: selfTest() returned without reaching its\n'
          + 'verdict, so neither line was printed and its battery floors never ran. Exiting 0 here\n'
          + 'would report a self-test that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  }

  const workflowPath = join(ROOT, WORKFLOW_REL);
  const text = existsSync(workflowPath) ? readFileSync(workflowPath, 'utf8') : null;
  const { failures, triggers } = judgeWorkflow(text, parse);
  failures.push(...judgeManifest(readFileSync(join(ROOT, 'package.json'), 'utf8')));

  if (argv.includes('--list')) {
    console.log(`workflow: ${WORKFLOW_REL}${text === null ? ' (ABSENT)' : ''}`);
    console.log(`triggers: ${triggers === null ? '(none read)' : triggers.join(', ')}`);
    console.log(`required: ${REQUIRED_TRIGGERS.join(', ')}`);
    console.log(`refused:  ${REFUSED_TRIGGERS.join(', ')}`);
    console.log(`pull_request: permitted, and only \`paths\`-filtered to exactly ${PR_TRIGGER_ALLOWED_PATHS.join(', ')}`);
    console.log(`board write:  every step calling the issues endpoint must carry \`${PR_WRITE_GUARD}\` in its own \`if:\``);
  }

  if (failures.length > 0) {
    console.error(`\nx ${WORKFLOW_REL} -- ${failures.length} finding${failures.length === 1 ? '' : 's'}:\n`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error('\nThis workflow is the only reporting channel the platform checklist gate has.\n');
    process.exit(1);
  }

  console.log(`OK ${WORKFLOW_REL}: ${REQUIRED_TRIGGERS.join(' + ')} present, ${REFUSED_TRIGGERS.join(' / ')} absent, any pull_request trigger paths-filtered to this file alone, no board write reachable from a pull_request run, invoked through \`pnpm ${PACKAGE_SCRIPT}\`.`);
}

if (isEntrypoint(import.meta.url)) {
  await main(process.argv.slice(2));
}
