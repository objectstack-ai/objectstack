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
 * So this gate pins five things, and the third is the one worth having:
 *
 *   1. the workflow FILE EXISTS and parses as YAML;
 *   2. it carries `schedule:` (with a real `cron:`) and `workflow_dispatch:`;
 *   3. it carries NO `pull_request:`, NO `pull_request_target:` and NO
 *      `merge_group:` trigger;
 *   4. it invokes the gate's PACKAGE SCRIPT, `pnpm check:platform-checklist`;
 *   5. and it does NOT inline a copy of that alias's command.
 *
 * Clause 3 is why this file exists rather than a comment asking nicely. A pin
 * that asserted only 1, 2, 4 and 5 would be GREEN on a workflow that had been
 * quietly given a `pull_request:` trigger -- i.e. green on the one edit that
 * contradicts the decision the watchdog was built to preserve. A test that
 * cannot fail on the change it exists to catch is the shape this tree keeps
 * paying for, so every clause below, positive and negative, has a `--self-test`
 * fixture that makes it FIRE, next to one that keeps it silent.
 *
 * `pull_request_target:` is refused beside the two the ruling names. It is a
 * per-PR trigger under another name, and a pin that refuses `pull_request:`
 * while accepting its sibling is a pin with a documented hole in it.
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
export const REFUSED_TRIGGERS = Object.freeze(['pull_request', 'pull_request_target', 'merge_group']);

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
        failures.push(`${WORKFLOW_REL} declares a \`${t}:\` trigger. ⛔ \`${PACKAGE_SCRIPT}\` is kept OUT of the per-PR path by a standing maintainer decision; this workflow changes the reporting channel and must never put the gate back on a pull request's critical path.`);
      }
    }
    if (names.includes('schedule') && !hasRealCron(doc)) {
      failures.push(`${WORKFLOW_REL} declares \`schedule:\` but no usable \`cron:\` expression under it, so it would never fire.`);
    }
  }

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
permissions:
  contents: read
  issues: write
jobs:
  watchdog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Run the platform checklist gate
        run: |
          set +e
          pnpm check:platform-checklist > "$RUNNER_TEMP/gate.out" 2>&1
          echo "exit_code=$?" >> "$GITHUB_OUTPUT"
`;

const withTrigger = (name) => GOOD.replace('  workflow_dispatch: {}\n', `  workflow_dispatch: {}\n  ${name}: {}\n`);

export function selfTest(parse) {
  const failures = [];
  let checked = 0;
  const t = (what, ok) => {
    checked += 1;
    if (!ok) failures.push(what);
  };
  const fires = (text, needle) => {
    const { failures: f } = judgeWorkflow(text, parse);
    return f.some((m) => m.includes(needle));
  };

  // The positive control. Every clause must be SILENT on a good workflow --
  // without this, a rule that fires on everything would pass every case below.
  const good = judgeWorkflow(GOOD, parse);
  t('the good fixture must produce zero findings (positive control)', good.failures.length === 0);
  t('the good fixture must report its triggers', Array.isArray(good.triggers) && good.triggers.includes('schedule'));

  // Clause 1 -- absence and unreadability.
  t('a missing workflow ⇒ names the file', fires(null, WORKFLOW_REL));
  t('a missing workflow ⇒ says the gate has no other channel', fires(null, 'is visible to nobody'));
  t('an empty workflow ⇒ fires', fires('', 'is empty'));
  t('unparseable YAML ⇒ fires with the parse error', fires('jobs:\n  a:\n  \tbad: [', 'could not be read as YAML'));
  t('a YAML scalar ⇒ fires', fires('just a string', 'does not parse to a workflow mapping'));

  // Clause 2 -- the positive triggers.
  t('no `on:` block at all ⇒ fires', fires('name: x\njobs: {}\n', 'declares no trigger block'));
  t('no `schedule:` ⇒ fires', fires(GOOD.replace(/  schedule:\n    - cron: '51 2 \* \* \*'\n/, ''), 'declares no `schedule:` trigger'));
  t('no `workflow_dispatch:` ⇒ fires', fires(GOOD.replace('  workflow_dispatch: {}\n', ''), 'declares no `workflow_dispatch:` trigger'));
  t('a `schedule:` with no cron ⇒ fires', fires(GOOD.replace("    - cron: '51 2 * * *'\n", '    - {}\n'), 'no usable `cron:`'));
  t('a `schedule:` with an empty cron ⇒ fires', fires(GOOD.replace("'51 2 * * *'", "''"), 'no usable `cron:`'));

  // Clause 3 -- THE NEGATIVE CLAUSES. Each refused trigger fires on its own,
  // and the good fixture above proves none of them fires without cause.
  for (const trigger of REFUSED_TRIGGERS) {
    t(`a \`${trigger}:\` trigger ⇒ fires`, fires(withTrigger(trigger), `declares a \`${trigger}:\` trigger`));
    t(`a \`${trigger}:\` trigger ⇒ cites the standing decision`, fires(withTrigger(trigger), 'standing maintainer decision'));
  }
  // A paths-filtered `pull_request:` is the shape the three sibling patrols
  // carry, so it is the shape a copy-paste would import. It must fire too.
  t('a paths-filtered `pull_request:` ⇒ fires', fires(
    GOOD.replace('  workflow_dispatch: {}\n', "  workflow_dispatch: {}\n  pull_request:\n    paths:\n      - '.github/workflows/platform-checklist-watchdog.yml'\n"),
    'declares a `pull_request:` trigger',
  ));
  // A trigger named only in a COMMENT is not a trigger. This gate judges the
  // parsed document, so prose about the refusal cannot be read as the refusal
  // being violated -- and this file's own workflow header says `pull_request`
  // out loud several times.
  t('`pull_request` in a comment ⇒ silent', !fires(
    GOOD.replace('on:\n', '# deliberately no pull_request: and no merge_group: trigger\non:\n'),
    'declares a `pull_request:` trigger',
  ));

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

  // The manifest clause.
  t('a manifest without the script ⇒ fires', judgeManifest('{"scripts":{"lint":"eslint ."}}').length === 1);
  t('a manifest with the script ⇒ silent', judgeManifest(`{"scripts":{"${PACKAGE_SCRIPT}":"node x.mjs"}}`).length === 0);
  t('an unparseable manifest ⇒ fires', judgeManifest('{').length === 1);

  return { failures, checked };
}

async function main(argv) {
  const { parse } = await requireDependency('yaml', () => import('yaml'), import.meta.url);

  if (argv.includes('--self-test')) {
    const { failures, checked } = selfTest(parse);
    if (failures.length > 0) {
      console.error(`\nx check-platform-checklist-watchdog self-test: ${failures.length} of ${checked} assertions failed\n`);
      for (const f of failures) console.error(`  - ${f}`);
      console.error('');
      process.exit(1);
    }
    console.log(`OK check-platform-checklist-watchdog self-test: ${checked} assertions, every clause driven by a fixture that makes it fire.`);
    return;
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
  }

  if (failures.length > 0) {
    console.error(`\nx ${WORKFLOW_REL} -- ${failures.length} finding${failures.length === 1 ? '' : 's'}:\n`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error('\nThis workflow is the only reporting channel the platform checklist gate has.\n');
    process.exit(1);
  }

  console.log(`OK ${WORKFLOW_REL}: ${REQUIRED_TRIGGERS.join(' + ')} present, ${REFUSED_TRIGGERS.join(' / ')} absent, invoked through \`pnpm ${PACKAGE_SCRIPT}\`.`);
}

if (isEntrypoint(import.meta.url)) {
  await main(process.argv.slice(2));
}
