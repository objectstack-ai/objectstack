#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check:pm-label-desc-cap — every label description in the pm vocabulary
 * script stays within GitHub's 100-character cap.
 *
 *   node scripts/pm/check-label-desc-cap.mjs               # the gate
 *   node scripts/pm/check-label-desc-cap.mjs --self-test   # verify the checker
 *
 * ## Why the gate exists
 *
 * GitHub hard-caps label descriptions at 100 characters: `gh label create` and
 * `gh label edit` return HTTP 422 above that. The vocabulary script needs
 * `|| true` on every creation to stay rerunnable, and that swallows the 422 —
 * so an over-long description means the label is NEVER created on a repo where
 * it does not exist yet, silently, and a rerun can never repair it. The script
 * header states all of this and nothing enforced it: the only thing between an
 * over-cap description and a label missing from a repo was the author counting
 * characters by hand. That has already been paid once by hand, in a PR that
 * trimmed the descriptions which had drifted over.
 *
 * Live headroom is thin, which is why this is not theoretical: measured on the
 * tree this gate landed on, one description sat at exactly 100 characters and
 * five more between 96 and 98. Any editorial touch-up to those lines lands over
 * the cap, 422s, and is swallowed.
 *
 * ## CHARACTERS, not bytes — the measure is the whole point
 *
 * The cap is on characters, and the descriptions in this file are not ASCII:
 * they carry em dashes, circled digits and CJK. The live specimen is
 * `needs:contract-review`, whose description is 97 characters and 101 BYTES —
 * accepted by GitHub, and red under a naive byte-length guard. A byte guard
 * would therefore fail a label that works, and the fix a reader would reach for
 * (rewriting a correct description to please the gate) is worse than no gate.
 *
 * Length is counted in Unicode CODE POINTS (`[...s].length`), not UTF-16 code
 * units (`s.length`): the two agree for everything in the file today, all of it
 * BMP, and disagree for astral characters (an emoji counts 2 as UTF-16 units).
 * Code points are the measure that keeps agreeing with GitHub if someone puts
 * an emoji in a description.
 *
 * ## Shell expansion is part of the measurement
 *
 * A description may interpolate a shell variable — `"Release blocker for $V …"`
 * is written once and expanded per iteration of `for V in v17`. What GitHub
 * receives is the EXPANDED string, so measuring the source literal undercounts
 * (`$V` is 2 characters, `v17` is 3). This checker reads the `for` loops out of
 * the same file, substitutes each variable's LONGEST value, and measures that.
 * A variable it cannot resolve is RED, not skipped: an unmeasurable description
 * is exactly the case the gate exists for.
 *
 * ## Why the parse is cross-checked against a real run
 *
 * A static parse of a shell script can silently drift from what the script
 * actually does — and a parser that matches nothing reads exactly like a green
 * gate. Two defences: a floor on the number of descriptions found (a LOWER
 * bound, deliberately below the current count — this is not a ratchet, it is a
 * "the parser still finds the file's contents" assertion), and a self-test that
 * puts a fake `gh` on PATH, runs the real script, and compares the descriptions
 * it was actually invoked with against the ones parsed here. The script has no
 * dry-run mode of its own, which is the other half of why nothing measured this
 * before.
 *
 * ## Both ways a description reaches GitHub
 *
 * The vocabulary script has two modes: create-if-missing (default) and
 * `--reconcile`, which additionally sends colour and description to
 * `gh label edit`. `gh label edit` 422s over the cap exactly as `gh label create`
 * does, so the gate's charter — no description this script sends can 422 —
 * spans both. The self-test drives the script in BOTH modes and asserts that
 * every edit carries the same string as its create, which is what keeps the
 * single measured `-d` literal per label sufficient. Without those cases the
 * gate would still pass while covering only half of what the script sends.
 *
 * Missing file or empty read is RED, never a pass — a gate that cannot find its
 * input must fail, not skip.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');

/** The single file this gate reads — also its watch hint for dispatch-gates.mjs. */
export const TARGET = 'scripts/pm/ensure-pm-labels.sh';

/** GitHub's hard cap, in characters. A description of exactly 100 is legal. */
export const MAX_DESCRIPTION_CHARS = 100;

/**
 * Lower bound on the number of `-d` descriptions the parse must find. NOT a
 * ratchet and NOT the current count — the current count moves whenever a label
 * is added or retired, and pinning it would turn every vocabulary edit into a
 * two-file change. It exists so a parser that has stopped matching cannot pass
 * as "no violations found". Raise it only if the file's floor genuinely rises.
 */
export const MIN_DESCRIPTIONS = 12;

/** Unicode code points, not UTF-16 code units and not bytes. See the header. */
export function charLength(s) {
  return [...s].length;
}

/**
 * `for V in a b c;` / `for R in x y; do` → Map(V → [a, b, c]).
 *
 * Only literal words are collected. A value that is itself an expansion or a
 * glob is dropped here and surfaces later as an unresolvable variable, which is
 * red — the honest outcome for a description this checker cannot measure.
 */
export function loopValues(source) {
  const out = new Map();
  for (const m of source.matchAll(/^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\n]+)/gm)) {
    const name = m[1];
    const values = m[2]
      .trim()
      .split(/\s+/)
      .filter((w) => w !== 'do' && /^[\w.@/-]+$/.test(w));
    if (!values.length) continue;
    const prev = out.get(name) ?? [];
    out.set(name, [...prev, ...values]);
  }
  return out;
}

/**
 * Substitute `$VAR` / `${VAR}` with the LONGEST value the loops give it —
 * worst case is the one the cap has to hold for. Returns the expanded string,
 * or the names it could not resolve.
 */
export function expand(description, values) {
  const unresolved = new Set();
  const expanded = description.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, braced, bare) => {
    const name = braced ?? bare;
    const candidates = values.get(name);
    if (!candidates?.length) {
      unresolved.add(name);
      return `$${name}`;
    }
    return candidates.reduce((a, b) => (charLength(b) > charLength(a) ? b : a));
  });
  return { expanded, unresolved: [...unresolved] };
}

/**
 * Every `-d "…"` on a `gh label create` line, with its label name, line number
 * and expanded text. Whole-line comments are stripped first: the header and the
 * per-label comment blocks quote these very strings, and a quoted example in
 * prose is not an invocation.
 */
export function parseDescriptions(source) {
  const values = loopValues(source);
  const out = [];
  const lines = source.split('\n');
  for (const [i, line] of lines.entries()) {
    if (/^\s*#/.test(line)) continue;
    if (!/gh\s+label\s+create/.test(line)) continue;
    const label = line.match(/gh\s+label\s+create\s+"?([^\s"]+)"?/)?.[1] ?? '(unnamed)';
    for (const m of line.matchAll(/-d\s+"((?:[^"\\]|\\.)*)"/g)) {
      const { expanded, unresolved } = expand(m[1], values);
      out.push({ label, line: i + 1, raw: m[1], expanded, unresolved });
    }
  }
  return out;
}

/** The verdicts, given a parse. Pure, so the self-test can drive it. */
export function violations(descriptions) {
  const out = [];
  for (const d of descriptions) {
    if (d.unresolved.length) {
      out.push(
        `${TARGET}:${d.line}: ${d.label} — description interpolates ${d.unresolved
          .map((n) => `$${n}`)
          .join(', ')}, which this checker cannot resolve to a value, so its expanded length is ` +
          'unmeasurable. Give the variable a literal `for` loop in this file, or inline the value.',
      );
      continue;
    }
    const n = charLength(d.expanded);
    if (n > MAX_DESCRIPTION_CHARS) {
      out.push(
        `${TARGET}:${d.line}: ${d.label} — description is ${n} characters, over GitHub's ` +
          `${MAX_DESCRIPTION_CHARS}-character cap. \`gh label create\` 422s above the cap and the ` +
          '`|| true` swallows it, so the label is never created on a repo that lacks it and a ' +
          `rerun cannot repair that. Trim to ${MAX_DESCRIPTION_CHARS} characters: ${d.expanded}`,
      );
    }
  }
  return out;
}

/**
 * Does a source `-d` literal, read as a template, produce this actual string?
 * Each `$VAR` / `${VAR}` becomes a wildcard and everything else must match
 * literally — the correspondence the dry-run cross-check asserts.
 */
export function templateMatches(raw, actual) {
  const pattern = raw
    .split(/\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^\\s]*');
  return new RegExp(`^${pattern}$`).test(actual);
}

function readTarget() {
  const abs = join(REPO_ROOT, TARGET);
  let source;
  try {
    source = readFileSync(abs, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${TARGET} (${err.message}) — a gate that cannot read its input fails`);
  }
  if (!source.trim()) throw new Error(`${TARGET} read empty — a gate that cannot read its input fails`);
  return source;
}

/**
 * Run the real script with a fake `gh` on PATH and return every label call it
 * actually made, plus the script's exit status. The fake records one argument
 * per line and closes each invocation with a sentinel line; no argument in this
 * file contains a newline, and no control bytes are written.
 *
 * `args` are passed through to the script — which is how the `--reconcile` mode
 * is measured. `failEdit` makes the fake `gh` reject `label edit`, so the
 * self-test can assert that a failed reconciliation is LOUD: unlike creation,
 * whose `|| true` is mandatory for rerunnability, a swallowed edit failure would
 * report success while leaving the drift live.
 *
 * The script is run via `spawnSync`, not `execFileSync`, because two of the
 * behaviours under test are non-zero exits (an unknown flag, a failed edit) and
 * a throwing runner cannot observe an exit status it converts into an exception.
 */
export function dryRunCalls(scriptPath, args = [], { failEdit = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-label-cap-'));
  try {
    const log = join(dir, 'calls.log');
    const fake = join(dir, 'gh');
    writeFileSync(
      fake,
      [
        '#!/usr/bin/env bash',
        'for a in "$@"; do printf "%s\\n" "$a" >> "$FAKE_GH_LOG"; done',
        'printf "<<<END>>>\\n" >> "$FAKE_GH_LOG"',
        'if [ -n "${FAKE_GH_FAIL_EDIT:-}" ] && [ "${2:-}" = "edit" ]; then echo "fake gh: refusing" >&2; exit 1; fi',
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(fake, 0o755);
    writeFileSync(log, '');
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`, FAKE_GH_LOG: log };
    if (failEdit) env.FAKE_GH_FAIL_EDIT = '1';
    const proc = spawnSync('bash', [scriptPath, ...args], { env, stdio: 'ignore' });
    const calls = [];
    for (const call of readFileSync(log, 'utf8').split('<<<END>>>\n')) {
      const argv = call.split('\n').filter((a) => a !== '');
      if (argv[0] !== 'label') continue;
      const flag = (...names) => {
        const i = argv.findIndex((a) => names.includes(a));
        return i === -1 ? null : argv[i + 1];
      };
      calls.push({
        verb: argv[1],
        name: argv[2],
        repo: flag('-R', '--repo'),
        color: flag('-c', '--color'),
        description: flag('-d', '--description'),
        argv,
      });
    }
    return { calls, status: proc.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every description the script passes to `gh label create`. See dryRunCalls. */
export function dryRunDescriptions(scriptPath) {
  return dryRunCalls(scriptPath)
    .calls.filter((c) => c.verb === 'create' && c.description !== null)
    .map((c) => c.description);
}

function run() {
  const source = readTarget();
  const descriptions = parseDescriptions(source);
  if (descriptions.length < MIN_DESCRIPTIONS) {
    console.error(
      `❌ check:pm-label-desc-cap: parsed only ${descriptions.length} label description(s) from ` +
        `${TARGET}, below the floor of ${MIN_DESCRIPTIONS}. The parse has drifted from the file — ` +
        'a checker that matches nothing reads exactly like a clean run.',
    );
    process.exit(1);
  }
  const bad = violations(descriptions);
  if (bad.length) {
    console.error(`❌ check:pm-label-desc-cap: ${bad.length} label description(s) over the cap\n`);
    for (const b of bad) console.error(`  ${b}`);
    process.exit(1);
  }
  const longest = descriptions.reduce((a, b) => (charLength(b.expanded) > charLength(a.expanded) ? b : a));
  console.log(
    `✓ check:pm-label-desc-cap: ${descriptions.length} label descriptions in ${TARGET}, all ` +
      `≤${MAX_DESCRIPTION_CHARS} characters (longest: ${charLength(longest.expanded)}, ${longest.label}).`,
  );
}

function selfTest() {
  let failed = 0;
  const t = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
      failed++;
      console.error(`  ✗ ${name}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
    } else {
      console.log(`  ✓ ${name}`);
    }
  };

  // The measure: characters, not bytes, not UTF-16 units.
  const live = 'Clause-② enqueue gate: dispatched below contract-review tier — blocked until the review clears it';
  t('the live 97-char/101-byte description measures 97', charLength(live), 97);
  t('…and is over the cap only if you measure BYTES', Buffer.byteLength(live, 'utf8') > MAX_DESCRIPTION_CHARS, true);
  t('…so it passes this gate', violations([{ label: 'x', line: 1, expanded: live, unresolved: [] }]).length, 0);
  t('an astral character counts once, not twice', charLength('🚀'), 1);

  // The cap boundary.
  const at = 'a'.repeat(100);
  const over = 'a'.repeat(101);
  t('exactly 100 characters passes', violations([{ label: 'x', line: 1, expanded: at, unresolved: [] }]).length, 0);
  t('101 characters fails', violations([{ label: 'x', line: 1, expanded: over, unresolved: [] }]).length, 1);
  t('…and the message names the count', violations([{ label: 'x', line: 1, expanded: over, unresolved: [] }])[0].includes('101 characters'), true);

  // Loop-value extraction and worst-case expansion.
  const loops = loopValues('for V in v17 v18;\n  for R in one two-longer;\n    do\n');
  t('loop values are collected', loops.get('V'), ['v17', 'v18']);
  t('a second loop is collected too', loops.get('R'), ['one', 'two-longer']);
  t('expansion takes the LONGEST value', expand('x $R y', loops).expanded, 'x two-longer y');
  t('braced form expands as well', expand('x ${R} y', loops).expanded, 'x two-longer y');
  t('equal-length values tie-break to the first, which is still worst case', expand('x $V y', loops).expanded, 'x v17 y');
  t('an unknown variable is reported, not silently dropped', expand('x $NOPE y', loops).unresolved, ['NOPE']);
  t(
    '…and an unresolvable variable is RED',
    violations([{ label: 'x', line: 1, expanded: 'short', unresolved: ['NOPE'] }]).length,
    1,
  );
  t(
    'expansion can push a legal literal over the cap',
    violations(
      parseDescriptions(`for V in v17-long-suffix;\n  gh label create t:$V -R r -d "${'a'.repeat(88)} $V" || true\n`),
    ).length,
    1,
  );

  // Parsing.
  const sample = [
    '# gh label create commented -d "' + 'a'.repeat(120) + '"',
    'gh label create pm:queue -R "$R" -c 0e8a16 -d "Ready for the PM dispatch loop" 2>/dev/null || true',
    'echo "-d not a label line"',
  ].join('\n');
  const parsed = parseDescriptions(sample);
  t('a commented-out invocation is not parsed', parsed.length, 1);
  t('the label name is captured', parsed[0].label, 'pm:queue');
  t('the description text is captured', parsed[0].expanded, 'Ready for the PM dispatch loop');
  t('the line number is captured', parsed[0].line, 2);
  t('a non-label line carrying -d is ignored', parseDescriptions('echo -d "x"').length, 0);

  // The real file, and the parse cross-checked against a real run of it.
  const source = readTarget();
  const real = parseDescriptions(source);
  t('the real file parses above the floor', real.length >= MIN_DESCRIPTIONS, true);
  t('the real file is clean', violations(real), []);
  t('every real description resolves its variables', real.every((d) => d.unresolved.length === 0), true);

  const invoked = dryRunDescriptions(join(REPO_ROOT, TARGET));
  const distinct = [...new Set(invoked)];
  t('the run invokes at least one description per parsed line', distinct.length >= real.length, true);
  t(
    'every description the script actually passes is covered by a parsed line',
    distinct.filter((d) => !real.some((r) => templateMatches(r.raw, d))),
    [],
  );
  t(
    'every parsed line without a variable is really invoked',
    real.filter((r) => !r.raw.includes('$') && !invoked.includes(r.raw)).map((r) => r.label),
    [],
  );
  t(
    'no description GitHub would 422 reaches the fake gh',
    invoked.filter((d) => charLength(d) > MAX_DESCRIPTION_CHARS),
    [],
  );
  t('a parsed line is NOT matched by an unrelated invocation', templateMatches('Ready for the PM dispatch loop', 'something else'), false);
  t('a template matches its expansion', templateMatches('Release blocker for $V — x', 'Release blocker for v17 — x'), true);

  // The floor: a parser that matches nothing must not read as clean.
  t('an empty parse is below the floor', parseDescriptions('echo hi').length < MIN_DESCRIPTIONS, true);

  // ── The --reconcile mode ──────────────────────────────────────────────────
  //
  // This gate's charter is "no description the script sends to GitHub can 422".
  // Reconcile adds a SECOND way to send one (`gh label edit`), so without the
  // cases below the gate's coverage would silently shrink to the create path
  // while still reading as a full pass — the parser-matches-nothing failure in
  // a new place. The cases assert the two properties that keep the cap honest:
  // every edit carries the same string as its create, and nothing else is sent.
  const script = join(REPO_ROOT, TARGET);
  // The verb is deliberately NOT part of the signature: these cases compare a
  // create against its edit, and equality is the whole assertion.
  const sig = (c) => JSON.stringify([c.name, c.repo, c.color, c.description]);
  const verbs = (calls, v) => calls.filter((c) => c.verb === v);

  const plain = dryRunCalls(script);
  const reconciled = dryRunCalls(script, ['--reconcile']);

  t('the default run issues no label edit at all', verbs(plain.calls, 'edit').length, 0);
  t('…and exits 0', plain.status, 0);
  t('reconcile exits 0 when every edit succeeds', reconciled.status, 0);
  t(
    'reconcile creates exactly what the default run creates',
    verbs(reconciled.calls, 'create').map(sig),
    verbs(plain.calls, 'create').map(sig),
  );
  t(
    'reconcile edits exactly the labels it creates — same name, repo, colour and description',
    verbs(reconciled.calls, 'edit').map(sig),
    verbs(reconciled.calls, 'create').map(sig),
  );
  t(
    'so every description reconcile SENDS is one this gate already measured',
    verbs(reconciled.calls, 'edit').filter((c) => !real.some((r) => templateMatches(r.raw, c.description))),
    [],
  );
  t(
    '…and none of them would 422',
    verbs(reconciled.calls, 'edit').filter((c) => charLength(c.description) > MAX_DESCRIPTION_CHARS),
    [],
  );
  t(
    'reconcile issues no verb other than create and edit — it never deletes',
    [...new Set(reconciled.calls.map((c) => c.verb))].filter((v) => v !== 'create' && v !== 'edit'),
    [],
  );
  t(
    'reconcile never renames: no --name/-n reaches gh',
    reconciled.calls.filter((c) => c.argv.includes('--name') || c.argv.includes('-n')).map((c) => c.name),
    [],
  );
  t(
    'reconcile is idempotent — a second run issues the identical call sequence',
    dryRunCalls(script, ['--reconcile']).calls.map(sig),
    reconciled.calls.map(sig),
  );

  // A mistyped flag must not fall through to a create-only run that prints the
  // ordinary success line — the operator would read a reconciliation that never
  // happened as done.
  const mistyped = dryRunCalls(script, ['--reconsile']);
  t('an unknown flag exits non-zero', mistyped.status, 2);
  t('…and issues no gh calls at all', mistyped.calls.length, 0);

  // The asymmetry with creation: a failed edit means the drift is still live.
  const brokenEdit = dryRunCalls(script, ['--reconcile'], { failEdit: true });
  t('a failing gh label edit makes the script exit non-zero', brokenEdit.status !== 0, true);
  t('…while the same failure in the default mode cannot arise (no edits)', verbs(dryRunCalls(script, [], { failEdit: true }).calls, 'edit').length, 0);

  if (failed) {
    console.error(`\n❌ check-label-desc-cap --self-test: ${failed} case(s) failed`);
    process.exit(1);
  }
  console.log('\n✓ check-label-desc-cap --self-test: all cases passed');
}

if (process.argv.includes('--self-test')) selfTest();
else run();
