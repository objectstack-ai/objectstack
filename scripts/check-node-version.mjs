#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-node-version -- every workflow must run the Node version in .nvmrc,
// and that version must still be supported by Node.
//
// Before #3825 the repo ran two Node versions at once, and nobody had decided
// that: all 12 PR gates were on Node 20 while release.yml, publish-smoke.yml,
// scaffold-e2e.yml and showcase-smoke.yml were on 22. So code was verified on
// one runtime and shipped from another, and the verifying one had been EOL
// since 2026-04-30 -- no security patches on the runtime guarding every merge.
//
// The split was never a policy, it was drift. release.yml carried the receipt
// in a comment: "22 (not 20 like the other workflows)" because a downstream
// clone pinned engines.node >=22 and pnpm aborted on 20. One workflow got
// bumped to clear one error; the other twelve stayed behind. That is how the
// gates-vs-release gap opened, and nothing in CI could see it -- a version pin
// is 18 independent string literals, so drift is invisible until someone greps.
//
// It surfaced only by accident (#3812): a test imported better-sqlite3@13,
// whose engines say >=22. `engines` is a declaration, not enforcement, so it
// loaded on 20 and then killed the vitest worker with a process-level abort --
// no JS error, so the suite reported "22 passed (23)" while 17 cases silently
// never ran. A green check that had stopped running the tests.
//
//   node scripts/check-node-version.mjs
//   node scripts/check-node-version.mjs --self-test   # the rule against fixtures, no tree read
//
// .nvmrc is the single source of truth: it pins contributors' local runtime via
// `nvm use` AND is what this guard holds every workflow to. Bumping Node is
// therefore a one-line edit to .nvmrc plus whatever this guard then reports.
//
// Deliberately NOT checked: `engines.node` in package.json. That is a promise
// to users about what the published packages support, which is independent of
// what CI validates on, and tightening it is a breaking change. See #3825.
//
// ## The population is BOTH `.github/workflows/` and `.github/actions/` (#19229)
//
// A `uses: actions/setup-node@` step decides which Node a job runs on wherever
// it is written, and a composite action is a legal place to write one. Rooting
// the census at `.github/workflows` alone made that a place the pin could drift
// unwatched -- and the drift would have been invisible in exactly this gate's
// own signature, because the OK line reports how many steps it audited and a
// step that moved out of the census simply stops being counted.
//
// The cost was already being paid in the tree rather than merely risked:
// `.github/actions/setup-pnpm/action.yml` carries a comment declaring that it
// deliberately does NOT hold a `setup-node` step, and names THIS gate's
// workflows-only census as the reason. That is a real composition being shaped
// around a gate's blind spot, which is the strongest evidence a population is
// wrong. With both roots read, the constraint is gone: put the step wherever
// the composition wants it.
//
// A missing `.github/actions/` is not an error -- a repo may hold no composite
// action at all -- and both counts are printed separately so the scope line
// says what was read rather than implying it.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isEntrypoint } from './invoked-as.mjs';

const WORKFLOW_DIR = '.github/workflows';
const ACTION_DIR = '.github/actions';
/** The file names GitHub accepts for a local action, in the order it resolves them. */
const ACTION_FILES = ['action.yml', 'action.yaml'];
const PIN_FILE = '.nvmrc';

// --- Lifecycle: the pin must not be a runtime Node has stopped patching. ------
//
// Consistency alone does not make the pin correct. The guard below proves all
// 18 workflows agree; it would have said OK just as cheerfully when all 18
// agreed on Node 20, three months after that line went EOL. That is the exact
// state #3825 found the repo in, so "they match" is only half the invariant --
// the other half is "and the thing they match is still supported".
//
// Dates are from nodejs/Release schedule.json, hardcoded on purpose: a required
// gate must not depend on the network, and these move once a year. An
// unrecognised major is an ERROR rather than a pass, so adopting Node 26 forces
// you to record its dates here instead of silently validating on a runtime this
// guard knows nothing about.
const NODE_LIFECYCLE = {
  18: { maintenance: '2023-10-18', end: '2025-04-30' },
  20: { maintenance: '2024-10-22', end: '2026-04-30' },
  22: { maintenance: '2025-10-21', end: '2027-04-30' },
  24: { maintenance: '2026-10-20', end: '2028-04-30' },
  26: { maintenance: '2027-10-20', end: '2029-04-30' },
};

// Warn this far ahead of EOL. Long enough that the bump is scheduled work
// rather than an emergency, and it stays a warning until the day support
// actually ends -- a hard failure months early would block unrelated PRs.
const WARN_WITHIN_DAYS = 180;
const DAY = 24 * 60 * 60 * 1000;

/**
 * The lifecycle verdict for a pin on a given day. `kind` is what the self-test
 * asserts; `main()` turns it into the same text this gate has always printed.
 */
function lifecycleVerdict(pin, today) {
  if (!pin) return { kind: 'pin-empty' };
  const major = Number.parseInt(String(pin).replace(/^v/, ''), 10);
  const lifecycle = NODE_LIFECYCLE[major];
  if (!Number.isInteger(major) || !lifecycle) return { kind: 'pin-unknown', major };
  const eol = new Date(`${lifecycle.end}T00:00:00Z`);
  const daysLeft = Math.round((eol - today) / DAY);
  const inMaintenance = today >= new Date(`${lifecycle.maintenance}T00:00:00Z`);
  if (daysLeft <= 0) return { kind: 'pin-eol', major, lifecycle, daysLeft, inMaintenance };
  return { kind: daysLeft <= WARN_WITHIN_DAYS ? 'eol-near' : 'supported', major, lifecycle, daysLeft, inMaintenance };
}

// A step ends at the next YAML list item; `with:` keys live between the
// `uses: actions/setup-node` line and that boundary.
const SETUP_NODE = /^\s*(?:-\s+)?uses:\s*actions\/setup-node@/;
const NEXT_ITEM = /^\s*-\s/;
const NODE_VERSION = /^\s*node-version:\s*(.+?)\s*$/;
const NODE_VERSION_FILE = /^\s*node-version-file:\s*(.+?)\s*$/;

const unquote = (v) => v.replace(/^['"]|['"]$/g, '').trim();

/**
 * Every `setup-node` step in `files` ({ rel, text }) held to `pin`. Each
 * offender carries a `kind` beside its text, for the self-test to assert.
 */
function auditSetupNodeSteps(files, pin) {
  const offenders = [];
  let steps = 0;

  for (const { rel: where, text } of files) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!SETUP_NODE.test(lines[i])) continue;
      steps++;

      let found = null;
      for (let j = i + 1; j < lines.length; j++) {
        // Stop at the next step -- but not on the `- uses:` line we started from.
        if (NEXT_ITEM.test(lines[j])) break;
        const v = lines[j].match(NODE_VERSION);
        if (v) {
          found = { line: j + 1, kind: 'node-version', value: unquote(v[1]) };
          break;
        }
        const f = lines[j].match(NODE_VERSION_FILE);
        if (f) {
          found = { line: j + 1, kind: 'node-version-file', value: unquote(f[1]) };
          break;
        }
      }

      if (!found) {
        // No pin at all: the step silently inherits whatever Node the runner
        // image ships, which GitHub bumps without telling us.
        offenders.push({
          kind: 'no-version',
          where: `${where}:${i + 1}`,
          problem: 'declares no Node version -- inherits the runner default',
          fix: `add "node-version: '${pin}'"`,
        });
        continue;
      }

      if (found.kind === 'node-version-file') {
        // Pointing at the pin file is the ideal form; anything else is a second
        // source of truth.
        if (found.value.replace(/^\.\//, '') !== PIN_FILE) {
          offenders.push({
            kind: 'other-version-file',
            where: `${where}:${found.line}`,
            problem: `reads its version from "${found.value}", not ${PIN_FILE}`,
            fix: `use "node-version-file: ${PIN_FILE}"`,
          });
        }
        continue;
      }

      // A `${{ }}` expression (matrix input, env, workflow input) cannot be
      // resolved from the file, so the guard cannot tell 22 from 20 here. Fail
      // closed and say why, rather than either waving it through or reporting the
      // raw expression as if it were a version number. A deliberate multi-version
      // compatibility matrix is a real thing to want -- it just needs deciding
      // out loud, since it is exactly the gates-vs-release split done on purpose.
      if (found.value.includes('${{')) {
        offenders.push({
          kind: 'expression',
          where: `${where}:${found.line}`,
          problem: `resolves its version from an expression (${found.value}) that this guard cannot evaluate`,
          fix: `pin it literally as '${pin}', or extend this guard if a multi-version matrix is intended`,
        });
        continue;
      }

      if (found.value !== pin) {
        offenders.push({
          kind: 'mismatch',
          where: `${where}:${found.line}`,
          problem: `pins Node ${found.value}, but ${PIN_FILE} says ${pin}`,
          fix: `change it to '${pin}', or bump ${PIN_FILE} if the whole repo should move`,
        });
      }
    }
  }
  return { steps, offenders };
}

// ── --self-test ──────────────────────────────────────────────────────────────
//
// Shape copied from `scripts/check-agent-model-declared.mjs` (AGENTS.md,
// "Writing a --self-test"): a literal cases table whose row LABELS are the
// battery roster, each floored at 1 and registered as the first statement of
// the loop body; the roster's own size pinned; and a verdict flag the dispatch
// refuses to run without. Fixtures only: the lifecycle rows pass their own
// `today`, so no row moves with the calendar.

let selfTestReachedVerdict = false;

const SELF_TEST_BATTERIES = Object.freeze({
  'a step pinning the .nvmrc major → GREEN': 1,
  'a step reading node-version-file .nvmrc (with or without ./) → GREEN': 1,
  'a quoted node-version is unquoted before comparing → GREEN': 1,
  'a step pinning another major → RED (mismatch)': 1,
  'a step with no version → RED (inherits the runner default)': 1,
  'a step reading some other version file → RED': 1,
  'a step resolving its version from an expression → RED (fails closed)': 1,
  'the next step\'s version is never credited to a step that declares none → RED': 1,
  'offenders name file and line; every setup-node step is counted': 1,
  'a pin this gate has no dates for → RED (pin-unknown)': 1,
  'an empty pin → RED (pin-empty)': 1,
  'a pin past end-of-life → RED (pin-eol)': 1,
  'a pin inside the warning window → WARN, not RED': 1,
  'a pin far from end-of-life, written v-prefixed → GREEN': 1,
});

const SELF_TEST_BATTERY_FLOOR = 14;

function selfTest() {
  const step = (...withLines) => ['      - uses: actions/setup-node@v4', ...(withLines.length ? ['        with:', ...withLines.map((l) => `          ${l}`)] : [])];
  const workflow = (...stepLines) => ['jobs:', '  build:', '    steps:', '      - uses: actions/checkout@v4', ...stepLines.flat(), '      - run: pnpm test', ''].join('\n');
  const audit = (text) => auditSetupNodeSteps([{ rel: '.github/workflows/demo.yml', text }], '22');
  const kinds = (text) => audit(text).offenders.map((o) => o.kind);
  const on = (iso) => new Date(`${iso}T00:00:00Z`);

  const cases = [
    { label: 'a step pinning the .nvmrc major → GREEN', got: () => kinds(workflow(step("node-version: 22"))), expect: [] },
    {
      label: 'a step reading node-version-file .nvmrc (with or without ./) → GREEN',
      got: () => kinds(workflow(step('node-version-file: .nvmrc'), step("node-version-file: './.nvmrc'"))),
      expect: [],
    },
    { label: 'a quoted node-version is unquoted before comparing → GREEN', got: () => kinds(workflow(step("node-version: '22'"), step('node-version: "22"'))), expect: [] },
    { label: 'a step pinning another major → RED (mismatch)', got: () => kinds(workflow(step("node-version: '20'"))), expect: ['mismatch'] },
    { label: 'a step with no version → RED (inherits the runner default)', got: () => kinds(workflow(step('cache: pnpm'))), expect: ['no-version'] },
    { label: 'a step reading some other version file → RED', got: () => kinds(workflow(step('node-version-file: package.json'))), expect: ['other-version-file'] },
    {
      label: 'a step resolving its version from an expression → RED (fails closed)',
      got: () => kinds(workflow(step('node-version: ${{ matrix.node }}'))),
      expect: ['expression'],
    },
    {
      label: 'the next step\'s version is never credited to a step that declares none → RED',
      got: () => kinds(workflow(step(), step('node-version: 22'))),
      expect: ['no-version'],
    },
    {
      label: 'offenders name file and line; every setup-node step is counted',
      got: () => {
        const { steps, offenders } = audit(workflow(step('node-version: 22'), step('node-version: 20')));
        return [String(steps), ...offenders.map((o) => o.where)];
      },
      expect: ['2', '.github/workflows/demo.yml:10'],
    },
    { label: 'a pin this gate has no dates for → RED (pin-unknown)', got: () => [lifecycleVerdict('19', on('2026-01-01')).kind, lifecycleVerdict('lts/jod', on('2026-01-01')).kind], expect: ['pin-unknown', 'pin-unknown'] },
    { label: 'an empty pin → RED (pin-empty)', got: () => [lifecycleVerdict('', on('2026-01-01')).kind], expect: ['pin-empty'] },
    { label: 'a pin past end-of-life → RED (pin-eol)', got: () => [lifecycleVerdict('20', on('2026-05-01')).kind, lifecycleVerdict('20', on('2026-04-30')).kind], expect: ['pin-eol', 'pin-eol'] },
    { label: 'a pin inside the warning window → WARN, not RED', got: () => [lifecycleVerdict('22', on('2027-01-01')).kind], expect: ['eol-near'] },
    {
      label: 'a pin far from end-of-life, written v-prefixed → GREEN',
      got: () => {
        const v = lifecycleVerdict('v24', on('2026-01-01'));
        return [v.kind, String(v.major), String(v.inMaintenance)];
      },
      expect: ['supported', '24', 'false'],
    },
  ];

  const batterySeen = new Map();
  let failed = 0;
  for (const c of cases) {
    batterySeen.set(c.label, (batterySeen.get(c.label) ?? 0) + 1);
    const got = c.got();
    if (JSON.stringify(got) === JSON.stringify(c.expect)) {
      console.log(`  ✓ ${c.label}`);
    } else {
      console.error(`  ✗ ${c.label}\n      expected ${JSON.stringify(c.expect)}\n      got      ${JSON.stringify(got)}`);
      failed += 1;
    }
  }

  // The floor: every declared row RAN, evaluated before the verdict so the
  // success line can only follow a run whose registered rows equal the roster.
  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failed += 1;
  };
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} -- ` +
        'a battery deleted from the roster takes its own floor with it.',
    );
  }
  const labels = cases.map((c) => c.label);
  const duplicated = [...new Set(labels.filter((label, i) => labels.indexOf(label) !== i))];
  if (duplicated.length > 0) {
    floorFailure(`the cases table uses ${duplicated.map((l) => JSON.stringify(l)).join(', ')} as a row label more than once.`);
  }
  for (const [label, count] of batterySeen) {
    if (!declared.includes(label)) {
      floorFailure(`self-test battery "${label}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
    }
  }
  for (const label of declared) {
    const count = batterySeen.get(label) ?? 0;
    if (count < SELF_TEST_BATTERIES[label]) {
      floorFailure(`self-test battery "${label}" DID NOT RUN -- ${count} case(s) registered, ${SELF_TEST_BATTERIES[label]} pinned.`);
    }
  }

  if (failed > 0) {
    console.error(`\n✗ check-node-version self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`\n✓ check-node-version self-test: ${cases.length} cases pass.`);
  selfTestReachedVerdict = true;
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-node-version self-test: selfTest() returned without reaching its verdict,\n' +
          'so no success line was printed. Exiting 0 here would report a self-test\n' +
          'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    return;
  }

  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();

  // The pin, e.g. "22". Tolerates the "v22" and "lts/jod" forms nvm also accepts,
  // but this repo writes the bare major -- that is what setup-node wants too.
  const pin = readFileSync(join(root, PIN_FILE), 'utf8').trim();
  const today = new Date();
  const verdict = lifecycleVerdict(pin, today);

  if (verdict.kind === 'pin-empty') {
    console.error(`check-node-version: ${PIN_FILE} is empty -- it must pin a Node major, e.g. 22.`);
    process.exit(1);
  }

  if (verdict.kind === 'pin-unknown') {
    console.error(
      `check-node-version: ${PIN_FILE} pins Node "${pin}", which this guard has no support dates for.\n\n` +
        `Add it to NODE_LIFECYCLE in ${'scripts/check-node-version.mjs'} using the dates from\n` +
        `https://github.com/nodejs/Release/blob/main/schedule.json, then re-run.\n` +
        `Known: ${Object.keys(NODE_LIFECYCLE).join(', ')}.`,
    );
    process.exit(1);
  }

  const { major, lifecycle, daysLeft, inMaintenance } = verdict;

  if (verdict.kind === 'pin-eol') {
    console.error(
      `check-node-version: ${PIN_FILE} pins Node ${major}, which reached end-of-life on ${lifecycle.end} ` +
        `(${Math.abs(daysLeft)} days ago).\n\n` +
        `An EOL runtime receives no security patches, and every PR gate in this repo runs on it --\n` +
        `so the runtime guarding each merge is the one nobody is fixing. That is #3825 verbatim.\n\n` +
        `Bump ${PIN_FILE} to a supported major and update the workflows this guard then lists.\n` +
        `Supported today: ${Object.entries(NODE_LIFECYCLE)
          .filter(([, l]) => new Date(`${l.end}T00:00:00Z`) > today)
          .map(([m, l]) => `${m} (until ${l.end})`)
          .join(', ')}.`,
    );
    process.exit(1);
  }

  // GitHub renders ::warning:: in the job summary and on the PR, so this is
  // visible without opening logs -- unlike a plain console.warn.
  if (verdict.kind === 'eol-near') {
    console.log(
      `::warning file=${PIN_FILE}::Node ${major} reaches end-of-life on ${lifecycle.end} ` +
        `(${daysLeft} days). Plan the bump before then -- when it lands, every PR gate will be ` +
        `validating on an unpatched runtime. Bumping is a one-line ${PIN_FILE} edit plus the ` +
        `workflows check-node-version lists.`,
    );
  }

  const workflowFiles = readdirSync(join(root, WORKFLOW_DIR))
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();

  // Every `action.yml` / `action.yaml` under `.github/actions/`, walked rather
  // than read one level deep because a local action may be nested
  // (`uses: ./.github/actions/a/b`). An absent directory answers [].
  function actionFilesUnder(dir, prefix = '') {
    const out = [];
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) out.push(...actionFilesUnder(join(dir, entry.name), `${prefix}${entry.name}/`));
      else if (ACTION_FILES.includes(entry.name)) out.push(`${prefix}${entry.name}`);
    }
    return out;
  }
  const actionFiles = actionFilesUnder(join(root, ACTION_DIR));

  // One list, each entry carrying the path it will be REPORTED under, so an
  // offender names the file a reader can open rather than a name that is only
  // unique inside one of the two roots.
  const files = [
    ...workflowFiles.map((f) => ({ rel: `${WORKFLOW_DIR}/${f}`, abs: join(root, WORKFLOW_DIR, f) })),
    ...actionFiles.map((f) => ({ rel: `${ACTION_DIR}/${f}`, abs: join(root, ACTION_DIR, f) })),
  ];

  const { steps, offenders } = auditSetupNodeSteps(
    files.map(({ rel, abs }) => ({ rel, text: readFileSync(abs, 'utf8') })),
    pin,
  );

  if (offenders.length === 0) {
    const phase = inMaintenance ? 'maintenance' : 'active LTS';
    console.log(
      `check-node-version: OK (${steps} setup-node step(s) across ${workflowFiles.length} workflow(s) ` +
        `and ${actionFiles.length} composite action(s), all on Node ${pin}).\n` +
        `  Node ${major} is in ${phase}; supported until ${lifecycle.end} (${daysLeft} days).`,
    );
    process.exit(0);
  }

  const plural = offenders.length === 1 ? 'step disagrees' : 'steps disagree';
  console.error(`check-node-version: ${offenders.length} setup-node ${plural} with ${PIN_FILE} (Node ${pin})\n`);
  for (const o of offenders) {
    console.error(`  • ${o.where} -- ${o.problem}`);
    console.error(`    ${o.fix}`);
  }
  console.error(`
Every workflow must run the Node version in ${PIN_FILE}, so that what CI
verifies is what release publishes from. When those drift apart, PR gates
validate code on a runtime nothing ships from -- and a dependency that needs the
newer one can abort the test worker mid-run, which vitest reports as a PASSING
suite with silently missing cases (#3812).

To move the whole repo to a new Node version, edit ${PIN_FILE} and then update
every step this guard lists. The census covers ${WORKFLOW_DIR}/ and
${ACTION_DIR}/ alike -- a setup-node step is a Node pin wherever it is written.`);
  process.exit(1);
}

if (isEntrypoint(import.meta.url)) {
  main();
}
