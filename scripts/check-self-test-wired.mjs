#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Self-test wiring gate (#11150).
 *
 *   node scripts/check-self-test-wired.mjs
 *   node scripts/check-self-test-wired.mjs --self-test
 *
 * ## The property this exists for, and why production runs cannot hold it
 *
 * A gate whose defect class is its MATCHING RULE -- "do these two strings
 * correspond?" -- cannot detect its own regression on a clean tree. Green means
 * the finding set is empty; weakening the rule can only SHRINK that set; and
 * the empty set is the fixed point of shrinking. So the production verdict is
 * identical before and after the rule breaks. `--self-test`, which supplies the
 * adversarial input a clean tree by construction does not contain, is the only
 * instrument watching the rule.
 *
 * Measured on `1f6d04703`, one ablation per gate, each mutation confirmed on
 * disk (anchor gone, marker present) before the readings were taken:
 *
 *   check-auth-mount-ledger    exact `METHOD path` -> strict-prefix credit
 *                              production 0 GREEN    --self-test 1 RED
 *   check-error-code-casing    `local-fallback` recognizer -> never matches
 *                              production 0 GREEN    --self-test 1 RED
 *   check-route-envelope       MODULES[file] -> basename fallback
 *                              production 0 GREEN    --self-test 0 GREEN
 *   check-dispatcher-error-vocabulary
 *                              `objlittemplate` recognizer -> never matches
 *                              production 1 RED      --self-test 1 RED
 *
 * The last two are why this gate is not a list of names.
 *
 * `check-route-envelope` is in the family for the rule ablated and has NO
 * instrument for it -- neither run moves. (A second mutation of the same gate,
 * narrowing its discovery convention, reddens the production run, so the
 * double-green above is a property of that rule and not of a broken harness.)
 *
 * `check-dispatcher-error-vocabulary` is OUT of the family for the rule
 * ablated, and the reason is mechanical: its classification ledger fails when a
 * declared row stops being reached -- `[stale-row] ... declares
 * 'APPROVAL_*_FAILED' at packages/rest/src/rest-server.ts (objlittemplate) but
 * the scan no longer finds it` -- which converts "no findings" into "the
 * recorded set is exactly reached". That is an equality, and weakening an
 * equality's measured side breaks it.
 *
 * So membership turns on whether a rule has a MUST-BE-REACHED WITNESS recorded
 * in the tree, and that differs between two rules inside one file. No static
 * classifier decides it, and a family enumerated by guess would wire
 * `--self-test` for the wrong set and then read as complete.
 *
 * ## What this gate enforces instead
 *
 * The mechanically decidable SUPERSET: every script CI runs that ships a
 * `--self-test` must have that self-test run by CI too. Every family member is
 * inside it by construction -- a gate whose only instrument is its self-test
 * necessarily ships one -- and nothing is admitted by judgment.
 *
 * That is direction 1 of #11150: removing a `--self-test` invocation from a
 * workflow stops being an invisible act. This repo has been bitten by the unrun
 * kind twice already (a 61-case self-test no job ran; a 79-case one likewise),
 * and both were found by hand, late.
 *
 * ## Population, and the one thing it deliberately over-selects
 *
 * A script is IN when a workflow names it -- directly, or through a root
 * `package.json` alias a workflow names -- and its code, with comments masked,
 * contains the literal `--self-test`. The mask is load-bearing in both
 * directions: `pnpm check:platform-checklist` appears in `lint.yml` only inside
 * a comment (it is maintainer-run by ruling), and counting that would fabricate
 * a member; a gate's header naming its own flag is likewise prose, not code.
 *
 * No attempt is made to decide whether that literal is a MODE the script
 * dispatches on or argv it hands to a child. That distinction is another
 * matching rule, and this gate refuses to grow one. The over-selection lands in
 * `SELF_TEST_RUN_OTHERWISE`, where a row carries EVIDENCE rather than a
 * sentence: a literal that must still appear in the script's code, plus -- for
 * a wrapper -- the driven tool, which must itself still ship a `--self-test`.
 * A row whose evidence is gone FAILS. A row whose script gets wired FAILS. The
 * list only ever shrinks.
 *
 * ## Refusals, never quiet passes (#4690)
 *
 * An empty population, a missing workflow directory, a `package.json` with no
 * scripts, or a ledger row naming a file that cannot be read are all exit 1
 * naming what could not be read. "Nothing to check" and "the walk found
 * nothing" are the two readings this gate is built to keep apart.
 *
 * ## Right boundary
 *
 * `--self-test` is matched with a right boundary, so `--self-test-extra` is not
 * an invocation of `--self-test`; script paths are compared by EXACT equality,
 * so `scripts/check-foo.mjs` is never credited to `scripts/check-foobar.mjs`.
 * That is the #10534 defect class, and this gate is itself in the family for
 * it -- which is why both directions are pinned in `--self-test` below and not
 * merely implied by the operators.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { maskComments } from './js-comment-mask.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const WORKFLOW_DIR = '.github/workflows';

// The token every gate in this farm writes when it names a path belonging to a
// maintainer rather than to the landing author (#8435). Declared per gate by
// convention, and read out of AUTHOR-FACING strings — a comment mentioning it
// tells an author nothing, so it has to live in the message itself.
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

/** Extensions whose files can be a `scripts/` entry point. */
const SCRIPT_EXT = /\.(mjs|mts|js|sh)$/;

/**
 * A `scripts/...` path, optionally followed by `--self-test`.
 *
 * The trailing `(?![\w-])` is the right boundary: without it `--self-test-extra`
 * reads as an invocation of `--self-test`, which is #10534's defect wearing this
 * gate's hat.
 */
const INVOCATION_RE =
  /(scripts\/[A-Za-z0-9_.\-/]+\.(?:mjs|mts|js|sh))(\s+--self-test(?![\w-]))?/g;

/**
 * ⛔ SHRINK-ONLY. Scripts CI runs whose self-test IS run by CI, but not through
 * the `--self-test` flag. Two measured shapes, both real in this tree:
 *
 *   `drives`  a thin wrapper whose entire body spawns another tool with
 *             `--self-test`, so CI's plain invocation of the wrapper IS that
 *             self-test run, and passing the flag to the wrapper would do
 *             nothing.
 *   `inline`  a gate whose ordinary run executes its own cases first, on every
 *             invocation, deliberately -- a placement chosen so the cases
 *             cannot become unrun.
 *
 * `evidence` is a literal that must still appear in the script's CODE, and for
 * `drives` it is the driven path, which must itself still ship a `--self-test`.
 * A row is deleted when its script stops being run by CI, stops carrying the
 * literal, loses its evidence, or gains a real `--self-test` invocation.
 * Nothing joins this list to silence a finding: a gate that really does ship an
 * unrun self-test gets wired instead.
 */
const SELF_TEST_RUN_OTHERWISE = [
  {
    script: 'scripts/pm/check-dispatch-gates.mjs',
    via: 'drives',
    evidence: 'scripts/pm/dispatch-gates.mjs',
    why: 'its whole body spawns the tool with --self-test; lint.yml runs the wrapper bare',
  },
  {
    script: 'scripts/docs-audit/check-affected-docs.mjs',
    via: 'drives',
    evidence: 'scripts/docs-audit/affected-docs.mjs',
    why: 'its whole body spawns the mapper with --self-test and --bridge-coverage',
  },
  {
    script: 'scripts/check-comment-mask-corpus.mjs',
    via: 'inline',
    evidence: 'runSelfTestCases(parse)',
    why: "main() runs the comparator's 12 cases before the sweep, because a sweep that cannot report means nothing",
  },
  {
    script: 'scripts/check-test-completeness.mjs',
    via: 'inline',
    evidence: 'selfTest({ quiet: true })',
    why: 'its header records the placement as deliberate — cases from which they cannot become unrun',
  },
];

/** Read a file's code with comments masked, so prose never decides anything. */
export function codeOf(relPath, source) {
  if (relPath.endsWith('.sh')) {
    // Shell has no block comments; blank from an unquoted `#` to end of line.
    return source
      .split('\n')
      .map((line) => line.replace(/(^|[\s;])#.*$/, '$1'))
      .join('\n');
  }
  return maskComments(source);
}

/** Does this script's CODE (not its prose) carry the `--self-test` literal? */
export function carriesSelfTest(relPath, source) {
  return codeOf(relPath, source).includes('--self-test');
}

/** Strip whole-line YAML comments so a commented-out step is never an invocation. */
export function uncommentYaml(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/**
 * Expand one root `package.json` script into the `scripts/` files it runs,
 * following `pnpm <alias>` chains. Returns which of them carry `--self-test`.
 */
export function expandAlias(alias, pkgScripts, seen = new Set()) {
  const named = new Set();
  const selfTested = new Set();
  if (seen.has(alias)) return { named, selfTested };
  seen.add(alias);
  const command = pkgScripts[alias];
  if (typeof command !== 'string') return { named, selfTested };
  for (const m of command.matchAll(INVOCATION_RE)) {
    named.add(m[1]);
    if (m[2]) selfTested.add(m[1]);
  }
  for (const m of command.matchAll(/pnpm\s+(?:run\s+)?([a-zA-Z][\w:@./-]*)/g)) {
    const sub = expandAlias(m[1], pkgScripts, seen);
    for (const s of sub.named) named.add(s);
    for (const s of sub.selfTested) selfTested.add(s);
  }
  return { named, selfTested };
}

/**
 * What CI names, and what CI self-tests.
 *
 * @param {{name: string, text: string}[]} workflows
 * @param {Record<string, string>} pkgScripts
 */
export function collectInvocations(workflows, pkgScripts) {
  /** @type {Map<string, Set<string>>} */ const named = new Map();
  /** @type {Map<string, Set<string>>} */ const selfTested = new Map();
  const note = (map, script, where) => {
    if (!map.has(script)) map.set(script, new Set());
    map.get(script).add(where);
  };
  for (const { name, text } of workflows) {
    const code = uncommentYaml(text);
    for (const m of code.matchAll(INVOCATION_RE)) {
      note(named, m[1], name);
      if (m[2]) note(selfTested, m[1], name);
    }
    for (const m of code.matchAll(/pnpm\s+(?:run\s+)?([a-zA-Z][\w:@./-]*)/g)) {
      if (typeof pkgScripts[m[1]] !== 'string') continue;
      const expanded = expandAlias(m[1], pkgScripts);
      for (const s of expanded.named) note(named, s, `${name} (pnpm ${m[1]})`);
      for (const s of expanded.selfTested) note(selfTested, s, `${name} (pnpm ${m[1]})`);
    }
  }
  return { named, selfTested };
}

/**
 * The population verdict: a script CI runs, carrying the literal, whose
 * `--self-test` no workflow executes and no ledger row covers.
 */
export function auditPopulation({ carriers, named, selfTested, ledger }) {
  const ledgered = new Set(ledger.map((row) => row.script));
  const findings = [];
  for (const script of [...carriers].sort()) {
    if (!named.has(script)) continue;
    if (selfTested.has(script)) continue;
    if (ledgered.has(script)) continue;
    findings.push({
      kind: 'self-test-not-run',
      script,
      text:
        `${script}\n` +
        `    CI runs this script (${[...named.get(script)].sort().join(', ')}) and its code carries\n` +
        '    `--self-test`, but no workflow ever executes it with that flag. An unrun\n' +
        '    self-test is a phantom check, and for a gate whose defect class is its\n' +
        '    matching rule it is also the ONLY instrument the rule has (#11150).\n' +
        `    Wire \`node ${script} --self-test\` into the step that runs it. That is the\n` +
        '    whole remedy, and it is the landing author\'s.\n' +
        '    ⛔ Do not add a SELF_TEST_RUN_OTHERWISE row to clear this. That ledger is\n' +
        '    shrink-only; adding an entry is not the fix, it is this finding written down\n' +
        '    somewhere quieter. A row records that a self-test genuinely IS run another\n' +
        '    way — a wrapper drives it, or the ordinary run executes its own cases — and\n' +
        `    judging that evidence is ${RATCHET_AUTHORITY_MARKER}, never a way out of wiring.`,
    });
  }
  return findings;
}

/** The ledger's own hygiene: every row must still be true, and still be needed. */
export function auditLedger({ ledger, carriers, named, selfTested, sourceOf }) {
  const findings = [];
  for (const row of ledger) {
    const where = `SELF_TEST_RUN_OTHERWISE row for ${row.script} (${row.via})`;
    const push = (kind, text) => findings.push({ kind, script: row.script, text: `${where}\n    ${text}` });
    if (!named.has(row.script)) {
      push('stale-ledger-row', 'no workflow runs this script any more. Delete the row.');
      continue;
    }
    if (!carriers.has(row.script)) {
      push('stale-ledger-row', 'its code no longer carries `--self-test`. Delete the row.');
      continue;
    }
    if (selfTested.has(row.script)) {
      push(
        'ledger-row-outlived-its-reason',
        `a workflow now runs it WITH \`--self-test\` (${[...selfTested.get(row.script)].sort().join(', ')}),\n` +
          '    so the exemption is spent. Delete the row — this list only ever shrinks.',
      );
      continue;
    }
    const source = sourceOf(row.script);
    if (source === null) {
      push('unreadable-ledger-row', 'the file could not be read. A row this gate cannot verify is a refusal, not a pass (#4690).');
      continue;
    }
    if (!codeOf(row.script, source).includes(row.evidence)) {
      push(
        'ledger-evidence-gone',
        `the row rests on \`${row.evidence}\` still being in this script's code, and it is not.\n` +
          `    Reason recorded: ${row.why}`,
      );
      continue;
    }
    if (row.via === 'drives') {
      const driven = sourceOf(row.evidence);
      if (driven === null || !carriesSelfTest(row.evidence, driven)) {
        push(
          'ledger-evidence-gone',
          `\`${row.evidence}\` no longer ships a \`--self-test\`, so running this wrapper is\n    no longer a self-test run.`,
        );
      }
    }
  }
  return findings;
}

/** Walk `scripts/` for candidate entry points. */
function walkScripts(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkScripts(full, out);
    else if (SCRIPT_EXT.test(entry)) out.push(relative(ROOT, full).split(sep).join('/'));
  }
  return out;
}

function main() {
  const scriptsDir = join(ROOT, 'scripts');
  const workflowDir = join(ROOT, WORKFLOW_DIR);
  const refuse = (message) => {
    console.error(`\ncheck-self-test-wired: REFUSED — ${message}\n`);
    process.exit(1);
  };
  if (!existsSync(scriptsDir)) refuse('scripts/ does not exist, so nothing was read (#4690).');
  if (!existsSync(workflowDir)) refuse(`${WORKFLOW_DIR} does not exist, so nothing was read (#4690).`);

  const sourceOf = (relPath) => {
    try {
      return readFileSync(join(ROOT, relPath), 'utf8');
    } catch {
      return null;
    }
  };

  const files = walkScripts(scriptsDir);
  if (files.length === 0) refuse('the walk over scripts/ found no files — a broken walk, not a clean tree (#4690).');

  const carriers = new Set();
  for (const relPath of files) {
    const source = sourceOf(relPath);
    if (source === null) refuse(`${relPath} could not be read.`);
    if (carriesSelfTest(relPath, source)) carriers.add(relPath);
  }
  if (carriers.size === 0) {
    refuse('no script under scripts/ carries a `--self-test` — this tree has dozens, so the reader is broken (#4690).');
  }

  const workflowNames = readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f)).sort();
  if (workflowNames.length === 0) refuse(`${WORKFLOW_DIR} holds no workflow files (#4690).`);
  const workflows = workflowNames.map((name) => ({
    name,
    text: readFileSync(join(workflowDir, name), 'utf8'),
  }));

  let pkgScripts = {};
  try {
    pkgScripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {};
  } catch {
    refuse('the root package.json could not be read or parsed.');
  }
  if (Object.keys(pkgScripts).length === 0) refuse('the root package.json declares no scripts (#4690).');

  const { named, selfTested } = collectInvocations(workflows, pkgScripts);
  if (named.size === 0) refuse('no workflow names any scripts/ file — the workflow reader is broken (#4690).');

  const findings = [
    ...auditPopulation({ carriers, named, selfTested, ledger: SELF_TEST_RUN_OTHERWISE }),
    ...auditLedger({ ledger: SELF_TEST_RUN_OTHERWISE, carriers, named, selfTested, sourceOf }),
  ];

  const members = [...carriers].filter((s) => named.has(s));
  const wired = members.filter((s) => selfTested.has(s));
  const scope =
    `  scope: ${files.length} file(s) under scripts/, ${carriers.size} carrying \`--self-test\` in code ` +
    `(comments masked); ${members.length} of those are run by ${workflows.length} workflow(s); ` +
    `${wired.length} have their self-test run through the flag, ${SELF_TEST_RUN_OTHERWISE.length} through a recorded route.`;

  if (findings.length > 0) {
    console.error(`\ncheck-self-test-wired: ${findings.length} finding(s)\n`);
    for (const f of findings) console.error(`  [${f.kind}] ${f.text}\n`);
    console.error(`${scope}\n`);
    process.exit(1);
  }

  console.log(
    `✓ check-self-test-wired: every one of the ${members.length} script(s) CI runs that ship a ` +
      '`--self-test` has that self-test run by CI.',
  );
  console.log(scope);
}

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The self-test's own battery registry, floor and verdict (#13489)
// ---------------------------------------------------------------------------
//
// `failures.length === 0` used to be this self-test's ONLY success condition,
// so "every case held" and "the cases never ran" printed the same line. And
// the dispatch below was `if (--self-test) selfTest()`, which discards the
// call's completion: an early `return` anywhere above the verdict printed
// NOTHING and still exited 0. Measured on 597020aa5 by injecting `return;` as
// the first statement of `selfTest()` -- exit 0, zero bytes of output, in the
// gate whose whole subject is that a shipped self-test actually runs.
//
// Both holes are closed the way PR #13487 validated on check-doc-authoring:
// what is pinned is the registered NAMES, not a number. Every section opens
// with `battery('<name>')`, every `ok()` is attributed to the battery most
// recently opened, and the floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count. A set difference names
// WHICH battery stopped running; a count says only that something did.
//
// ⛔ A merely non-zero count is not the repair, and neither is a pinned TOTAL:
// a battery dropping from 9 cases to 3 keeps a total "right" for the wrong
// reason the moment a sibling grows.
//
// The counts are a FLOOR, not an equality: adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running, and the
// remedy is to find what stopped registering -- never to lower the number.
//
// Measured on 597020aa5 by instrumenting `ok` and printing the per-battery
// tally: 7 / 4 / 4 / 4 / 9 / 15, 43 in total.
//
// Five of the six are pinned at what they measure. `live ledger` is not, and
// deliberately: its case count is `1 + one per SELF_TEST_RUN_OTHERWISE row's
// worth`, and that list is ⛔ SHRINK-ONLY by design -- deleting a row is the
// outcome the list exists to reach. A floor at today's 15 would turn every
// legitimate shrink red and train the next author to edit the floor, which is
// the one habit these floors exist to prevent. So what is pinned there is the
// invariant that does NOT move with the list: the structural case ran AND at
// least one row was actually audited (1 + 3). A loop that stops iterating, or
// a ledger that empties without the structural case noticing, still reds.
const SELF_TEST_BATTERIES = Object.freeze({
  'comment mask': 7,
  'right boundary': 4,
  'alias resolution': 4,
  'population verdict': 4,
  'ledger hygiene': 9,
  'live ledger': 4,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the registry's own size is pinned too. Adding a battery raises
// this number; removing one is the same ⛔ deliberate edit as lowering a count.
const SELF_TEST_BATTERY_FLOOR = 6;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Returned by `selfTest()` only after the floor has been evaluated and the
// verdict printed. The dispatch refuses anything else: a `return` that leaves
// the function early prints nothing and exits 0, which is the same
// nothing-ran-nothing-complained pass one level up.
const SELF_TEST_VERDICT = 'check-self-test-wired self-test reached its verdict';

function selfTest() {
  const failures = [];
  const seen = new Map();
  let openBattery = null;
  // Declare the battery the following assertions belong to. The name must be a
  // key of SELF_TEST_BATTERIES -- an unknown one reds by set difference,
  // naming itself, rather than being counted somewhere it is not floored.
  const battery = (name) => {
    openBattery = name;
  };
  const ok = (cond, label) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
    if (!cond) failures.push(label);
  };
  const wf = (text, name = 'lint.yml') => [{ name, text }];

  // ── Prose never decides anything, in either direction ────────────────────
  battery('comment mask');
  ok(
    !carriesSelfTest('scripts/x.mjs', '// run it with --self-test sometimes\nconst a = 1;\n'),
    'a `--self-test` that exists only in a JS comment was read as an implementation',
  );
  ok(
    carriesSelfTest('scripts/x.mjs', "if (process.argv.includes('--self-test')) run();\n"),
    'control — the same literal in CODE must count, or the case above proves nothing',
  );
  ok(
    !carriesSelfTest('scripts/x.sh', '# usage: x.sh --self-test\necho hi\n'),
    'a `--self-test` in a shell comment was read as an implementation',
  );
  ok(
    carriesSelfTest('scripts/x.sh', 'case "$1" in --self-test) run;; esac\n'),
    'control — the same literal in shell CODE must count',
  );

  {
    const commented = collectInvocations(
      wf('jobs:\n  a:\n    steps:\n      # run: node scripts/g.mjs --self-test\n      - run: echo hi\n'),
      {},
    );
    ok(!commented.named.has('scripts/g.mjs'), 'a workflow COMMENT was read as an invocation');
    const live = collectInvocations(wf('jobs:\n  a:\n    steps:\n      - run: node scripts/g.mjs --self-test\n'), {});
    ok(live.named.has('scripts/g.mjs'), 'control — the same line uncommented must be read as an invocation');
    ok(live.selfTested.has('scripts/g.mjs'), 'control — and as a SELF-TEST invocation');
  }

  // ── Right boundary: the defect class this gate is itself in the family for ─
  battery('right boundary');
  {
    const got = collectInvocations(wf('    - run: node scripts/g.mjs --self-test-extra\n'), {});
    ok(got.named.has('scripts/g.mjs'), 'the script was not seen at all — the boundary case would test nothing');
    ok(
      !got.selfTested.has('scripts/g.mjs'),
      '`--self-test-extra` was credited as an invocation of `--self-test` (no right boundary — the #10534 defect)',
    );
  }
  {
    const got = collectInvocations(wf('    - run: node scripts/check-foobar.mjs --self-test\n'), {});
    ok(
      got.selfTested.has('scripts/check-foobar.mjs'),
      'the longer path was not credited to itself — the sibling case would test nothing',
    );
    ok(
      !got.selfTested.has('scripts/check-foo.mjs'),
      '`scripts/check-foo.mjs` was credited on the strength of its longer sibling (prefix match, not exact equality)',
    );
  }

  // ── Aliases: reached only when a workflow actually names them ────────────
  battery('alias resolution');
  {
    const pkg = {
      'check:thing': 'node scripts/thing.mjs --self-test && node scripts/thing.mjs',
      'check:unused': 'node scripts/unused.mjs --self-test',
      'check:chain': 'pnpm check:thing',
    };
    const got = collectInvocations(wf('    - run: pnpm check:thing\n'), pkg);
    ok(got.selfTested.has('scripts/thing.mjs'), 'an alias a workflow runs did not credit its --self-test');
    ok(
      !got.named.has('scripts/unused.mjs'),
      'control — an alias NO workflow runs must credit nothing (this is why check:platform-checklist stays out)',
    );
    ok(
      collectInvocations(wf('    - run: pnpm check:chain\n'), pkg).selfTested.has('scripts/thing.mjs'),
      'a `pnpm <alias>` chain was not followed',
    );
    ok(
      expandAlias('a', { a: 'pnpm b', b: 'pnpm a && node scripts/c.mjs --self-test' }).selfTested.has('scripts/c.mjs'),
      'a cyclic alias chain did not terminate with the right answer',
    );
  }

  // ── The population verdict, both directions ──────────────────────────────
  battery('population verdict');
  {
    const carriers = new Set(['scripts/g.mjs']);
    const run = (text, ledger = []) => {
      const { named, selfTested } = collectInvocations(wf(text), {});
      return auditPopulation({ carriers, named, selfTested, ledger });
    };
    const missing = run('    - run: node scripts/g.mjs\n');
    ok(missing.length === 1 && missing[0].kind === 'self-test-not-run', 'an unrun self-test on a CI-run gate did not redden');
    ok(
      run('    - run: |\n          node scripts/g.mjs --self-test\n          node scripts/g.mjs\n').length === 0,
      'control — the wired shape must produce no finding',
    );
    ok(run('    - run: echo nothing\n').length === 0, 'a script NO workflow runs is outside the population and must not redden');
    ok(
      run('    - run: node scripts/g.mjs\n', [{ script: 'scripts/g.mjs', via: 'drives', evidence: 'scripts/t.mjs', why: 'x' }]).length === 0,
      'a ledgered script still reddened the population audit',
    );
  }

  // ── Ledger hygiene: every row must still be true, and still be needed ────
  battery('ledger hygiene');
  {
    const carriers = new Set(['scripts/w.mjs', 'scripts/t.mjs']);
    const sources = {
      'scripts/w.mjs': "spawnSync(node, ['scripts/t.mjs', '--self-test']);\n",
      'scripts/t.mjs': "if (process.argv.includes('--self-test')) run();\n",
    };
    const sourceOf = (p) => sources[p] ?? null;
    const row = { script: 'scripts/w.mjs', via: 'drives', evidence: 'scripts/t.mjs', why: 'wrapper' };
    const audit = (text, over = row, reader = sourceOf, held = carriers) => {
      const { named, selfTested } = collectInvocations(wf(text), {});
      return auditLedger({ ledger: [over], carriers: held, named, selfTested, sourceOf: reader });
    };
    ok(audit('    - run: node scripts/w.mjs\n').length === 0, 'control — a row whose evidence holds must produce no finding');
    ok(audit('    - run: echo nothing\n')[0]?.kind === 'stale-ledger-row', 'a row whose script CI no longer runs did not redden');
    ok(
      audit('    - run: node scripts/w.mjs --self-test\n')[0]?.kind === 'ledger-row-outlived-its-reason',
      'a row whose script is now wired did not redden — the list would stop shrinking',
    );
    ok(
      audit('    - run: node scripts/w.mjs\n', row, sourceOf, new Set(['scripts/t.mjs']))[0]?.kind === 'stale-ledger-row',
      'a row whose script no longer carries the literal did not redden',
    );
    ok(
      audit('    - run: node scripts/w.mjs\n', row, (p) => (p === 'scripts/w.mjs' ? 'run();\n' : sources[p] ?? null))[0]?.kind ===
        'ledger-evidence-gone',
      'a row whose wrapper no longer names the tool it claims to drive did not redden',
    );
    ok(
      audit('    - run: node scripts/w.mjs\n', row, (p) => (p === 'scripts/t.mjs' ? 'run();\n' : sources[p] ?? null))[0]?.kind ===
        'ledger-evidence-gone',
      'a row whose driven tool stopped shipping a self-test did not redden',
    );
    ok(audit('    - run: node scripts/w.mjs\n', row, () => null)[0]?.kind === 'unreadable-ledger-row', 'an unreadable row was a quiet pass rather than a refusal (#4690)');

    // `inline` rows check the evidence literal, and must NOT demand that the
    // evidence names a self-testing script — it names a call site.
    const inline = { script: 'scripts/w.mjs', via: 'inline', evidence: 'selfTest({ quiet: true })', why: 'runs its own cases' };
    const inlineSources = { 'scripts/w.mjs': "selfTest({ quiet: true });\nif (argv.includes('--self-test')) selfTest();\n" };
    ok(
      audit('    - run: node scripts/w.mjs\n', inline, (p) => inlineSources[p] ?? null, new Set(['scripts/w.mjs'])).length === 0,
      'control — an inline row whose call site is present must produce no finding',
    );
    ok(
      audit('    - run: node scripts/w.mjs\n', inline, () => "if (argv.includes('--self-test')) selfTest();\n", new Set(['scripts/w.mjs']))[0]?.kind ===
        'ledger-evidence-gone',
      'an inline row whose call site was deleted did not redden — the cases would be unrun again',
    );
  }

  // ── The live ledger, checked against the real tree ───────────────────────
  battery('live ledger');
  {
    const sourceOf = (relPath) => {
      try {
        return readFileSync(join(ROOT, relPath), 'utf8');
      } catch {
        return null;
      }
    };
    ok(SELF_TEST_RUN_OTHERWISE.length > 0, 'the live ledger is empty — these cases would assert nothing');
    for (const row of SELF_TEST_RUN_OTHERWISE) {
      ok(row.via === 'drives' || row.via === 'inline', `live ledger: ${row.script} has an unknown \`via\` (${row.via})`);
      const source = sourceOf(row.script);
      ok(source !== null, `live ledger: ${row.script} is missing`);
      ok(source !== null && codeOf(row.script, source).includes(row.evidence), `live ledger: ${row.script} no longer contains \`${row.evidence}\``);
      if (row.via === 'drives') {
        const driven = sourceOf(row.evidence);
        ok(driven !== null && carriesSelfTest(row.evidence, driven), `live ledger: ${row.evidence} no longer ships a --self-test`);
      }
    }
  }

  // ── The floor: every declared battery RAN, and ran its cases ─────────────
  //
  // Evaluated here, after every battery has had its chance and BEFORE the
  // verdict -- so the line below can only be printed by a run in which the set
  // of batteries that registered assertions equals the set declared.
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  const totalCases = [...seen.values()].reduce((a, b) => a + b, 0);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    failures.push(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the registry takes its own floor with it.`,
    );
  }
  for (const [name, count] of seen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    failures.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = seen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    failures.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed they hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }

  if (failures.length > 0) {
    console.error('check-self-test-wired --self-test FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    if (floorBreached) {
      console.error(
        '\nA battery at or below its floor means cases STOPPED RUNNING — the battery is the bug,\n' +
          'not the number. Find what stopped registering (an early return, a deleted block, a guard\n' +
          'that now skips) and restore it. Raising a floor after ADDING cases is ordinary work;\n' +
          `LOWERING one is ${RATCHET_AUTHORITY_MARKER}, not a co-equal option — "the count\n` +
          'legitimately moved" and "something stopped running" need different edits, and only a\n' +
          'measurement tells them apart.\n',
      );
    }
    process.exit(1);
  }
  console.log(
    `check-self-test-wired --self-test: ${SELF_TEST_RUN_OTHERWISE.length} live ledger row(s) verified, plus the ` +
      'comment mask, the right boundary, alias resolution and both audit directions' +
      ` — ${declaredBatteries.length} declared batteries, ${totalCases} cases registered, every battery at or` +
      ' above its pinned floor.',
  );
  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    // ⛔ Never `selfTest();` bare, and never `return selfTest()`. A `return`
    // anywhere above that verdict prints nothing, evaluates no floor and exits
    // 0 — the same nothing-ran-nothing-complained pass the battery floor
    // refuses, one level up (#13489).
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-self-test-wired self-test: selfTest() returned without reaching its verdict, so no\n' +
          'battery floor was evaluated and no success line was printed. Exiting 0 here would report a\n' +
          'self-test that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else main();
}
