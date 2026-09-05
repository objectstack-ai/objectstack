#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-sdui-manifest — freshness + integrity gate for the repo-root
 * `sdui.manifest.json` (#12924, ruled 2026-08-29: wire it, 签入 + 新鲜度门禁).
 *
 *   node scripts/check-sdui-manifest.mjs              # gate this tree
 *   node scripts/check-sdui-manifest.mjs --self-test  # verify the checker itself
 *
 * ## What rots here, and which check catches it
 *
 * The artefact is a SYNC of objectui's public-tier registry (generated from the
 * published `@object-ui/*` packages at the version `.objectui-sha` ships — see
 * `scripts/gen-sdui-manifest-node.mjs`). Checked-in syncs rot; the ruling's
 * words for the failure mode are 「同步一次就烂」. Offline, per-PR:
 *
 *   1. ABSENCE / SHAPE — the artefact exists at the repo root, parses, and
 *      carries a non-empty `components` map whose entries agree with their
 *      keys. An absent artefact silently reverts `validateJsxPages` to
 *      parse-only (`resolveSduiManifest()` degrades by design), so absence
 *      here is the loudest failure, never a skip. Same for the record file.
 *   2. TAMPER — sha256(artefact) equals the record. The manifest is
 *      generator-owned; a hand edit is invisible to every consumer (the
 *      resolver JSON.parses whatever is there), so the hash is the only
 *      instrument that notices one.
 *   3. STALENESS — the record's `objectuiSha` equals the live `.objectui-sha`.
 *      A pin bump changes which registry the shipped console runs, so the bump
 *      PR goes red HERE until the manifest is regenerated against the new pin
 *      — the same moment `check-sdui-lockstep` already forces a parser parity
 *      re-verification, and the moment an objectui checkout is guaranteed to
 *      exist (the bump required one).
 *
 * ## What this deliberately does NOT do, and where that risk is held
 *
 * No per-PR regeneration: that would put an npm-registry network dependency
 * inside a required lint job — the exact shape `check-sdui-lockstep`'s header
 * declines, for the same reasons. Under an unchanged pin the published inputs
 * are immutable, so content drift per-PR is not a live axis. The residual
 * axis — this repo's OWN adapter (`manifestFromConfigs`) changing while the
 * pin stands still — is held by `packages/sdui-parser`'s lockstep gate and
 * unit suite, and by regeneration being byte-deterministic (measured: two runs
 * from the same install, identical sha256), so the remedy this gate prints
 * always converges.
 *
 * Absence is loud, everywhere (#13014/#4690): every input is asserted before
 * any verdict; a missing one exits 1 naming which. No `⚠` + exit 0.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The three files `checkTree` opens, repo-relative. */
const READ_PATHS = {
  artefact: 'sdui.manifest.json',
  record: join('scripts', 'sdui-manifest.record.json'),
  pin: '.objectui-sha',
};

/**
 * The population this gate reads, declared for `scripts/pm/dispatch-gates.mjs`.
 *
 * `checkTree` opens exactly three files. None of them was visible to the
 * derivation: it reads SOURCE TEXT, and a literal with no separator is refused
 * by `hintCovers` as too generic (`sdui.manifest.json`), while `.objectui-sha`
 * is not one of the dot-prefixed names the extractor admits and the record path
 * is assembled with `join()`. So both of this gate's CI invocations — the scan
 * and its `--self-test` — were scored `undetermined` for EVERY card, absent from
 * every dispatch brief and every `--commands` harvest, while CI ran them on each
 * pull request. That cost is sharpest here: the cards that implicate this gate
 * are exactly the ones that move the objectui pin or regenerate the manifest.
 *
 * `ROOT_WATCH_HINTS` is the mixed-roots spelling of the idiom, which is what
 * this population is: two repo-ROOT files and one under `scripts/`. The
 * repo-root pair carries the `/**` suffix because a bare single-segment literal
 * is refused; the collapse reduces each one back to the single file it names and
 * to nothing else.
 *
 * ⛔ Not a whole-tree marker, and not `scripts/**`: three files are three files.
 *
 * The self-test derives the coupling from `READ_PATHS` — the same object
 * `checkTree` reads — so a moved or added read reds here rather than leaving the
 * declaration describing the old population.
 */
const ROOT_WATCH_HINTS = [
  'sdui.manifest.json/**',
  'scripts/sdui-manifest.record.json',
  '.objectui-sha/**',
];

/** Gate one tree. Returns a list of problems; empty = green. */
export function checkTree(root) {
  const problems = [];
  const artefactPath = join(root, READ_PATHS.artefact);
  const recordPath = join(root, READ_PATHS.record);
  const pinPath = join(root, READ_PATHS.pin);

  if (!existsSync(artefactPath)) {
    problems.push(
      'sdui.manifest.json is MISSING at the repo root. `resolveSduiManifest()` degrades to parse-only\n' +
        '  silently, so this gate is the thing that notices. Regenerate: node scripts/gen-sdui-manifest-node.mjs',
    );
    return problems; // every later check reads it
  }
  const raw = readFileSync(artefactPath, 'utf8');

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    problems.push(`sdui.manifest.json does not parse as JSON: ${e.message}`);
    return problems;
  }
  const components = manifest?.components;
  if (!components || typeof components !== 'object' || Array.isArray(components)) {
    problems.push('sdui.manifest.json has no `components` object — not a component manifest.');
    return problems;
  }
  const keys = Object.keys(components);
  if (keys.length === 0) problems.push('sdui.manifest.json declares 0 components — an empty whitelist would red every page.');
  for (const k of keys) {
    if (components[k]?.type !== k) {
      problems.push(`components[${JSON.stringify(k)}].type is ${JSON.stringify(components[k]?.type)} — key/type disagree.`);
      break; // one example is enough; this shape is generator-owned
    }
  }

  if (!existsSync(recordPath)) {
    problems.push('scripts/sdui-manifest.record.json is MISSING — provenance unknown. Regenerate to re-record.');
    return problems;
  }
  let record;
  try {
    record = JSON.parse(readFileSync(recordPath, 'utf8'));
  } catch (e) {
    problems.push(`scripts/sdui-manifest.record.json does not parse: ${e.message}`);
    return problems;
  }
  for (const field of ['objectuiSha', 'objectuiPackagesVersion', 'sha256', 'components']) {
    if (record[field] === undefined) problems.push(`record is missing \`${field}\`.`);
  }
  if (problems.length) return problems;

  const sha256 = createHash('sha256').update(raw).digest('hex');
  if (sha256 !== record.sha256) {
    problems.push(
      `sdui.manifest.json sha256 ${sha256.slice(0, 12)}… does not match the record ${String(record.sha256).slice(0, 12)}…\n` +
        '  The artefact is generator-owned — never hand-edit it. Regenerate: node scripts/gen-sdui-manifest-node.mjs',
    );
  }
  if (keys.length !== record.components) {
    problems.push(`artefact has ${keys.length} components, record says ${record.components}.`);
  }

  if (!existsSync(pinPath)) {
    problems.push('.objectui-sha is MISSING — cannot judge freshness.');
    return problems;
  }
  const pin = readFileSync(pinPath, 'utf8').trim();
  if (pin !== record.objectuiSha) {
    problems.push(
      `.objectui-sha has moved to ${pin.slice(0, 12)}… but sdui.manifest.json was generated at ${String(record.objectuiSha).slice(0, 12)}…\n` +
        '  A pin bump changes which registry the shipped console runs; the manifest must follow it (同步一次就烂 is\n' +
        '  the failure mode this gate exists for). Regenerate against the new pin:\n' +
        '    node scripts/gen-sdui-manifest-node.mjs --objectui-version {the @object-ui version the new pin ships}\n' +
        "  (read it from the objectui checkout's packages/core/package.json — the bump already required that checkout).",
    );
  }
  return problems;
}

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-sdui-manifest self-test reached its verdict';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures === 0` used to be this self-test's ONLY success condition, so "every
// case held" and "the cases never ran" printed the same line. Closed the PR
// #13487 way: what is pinned is the registered NAMES, not a number.
//
// This self-test is TABLE-DRIVEN — one literal `cases` table, one loop over it,
// and a sink (`failures++`) that writes only when a case FAILS. Routing THAT
// sink through `registerCase()` would register a case only when it fails: a
// fully green run would register 0 and every battery would read DID NOT RUN, the
// floor inverted rather than installed. So the roster is the table's own rows.
// Each row LABEL is a declared battery, verbatim, with a floor of 1, and
// `registerCase(name)` is the first statement of the driving loop body — so the
// case is attributed to the row actually being run, whatever that row asserts
// afterwards. There is no `battery()` opener: for a table-driven self-test the
// ROW is the battery, so attribution is the loop variable rather than a
// most-recently-opened section.
//
// ⛔ A pinned TOTAL is not the repair, and neither is a roster DERIVED from the
// table: `cases.length` moves with the table, so a deleted row would delete its
// own floor. The roster below is a LITERAL the table is checked against, which
// is what lets a deleted or renamed row name ITSELF in the refusal.
//
// The counts are a FLOOR, not an equality — a row that grows into several
// registrations must not red. 1 is the honest floor for a table row: the loop
// reaches it exactly once per run.
const SELF_TEST_BATTERIES = Object.freeze({
  'green fixture passes': 1,
  'missing artefact is RED': 1,
  'hand-edited artefact (hash mismatch) is RED': 1,
  'moved pin is RED': 1,
  'empty components is RED': 1,
  'missing record is RED': 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. This pin is also half of
// the duplicate-label refusal: two rows sharing a label collapse to ONE key in
// the literal above, so the roster falls below this number; the table
// cross-check in the floor block is the other half, and names WHICH label
// collided.
const SELF_TEST_BATTERY_FLOOR = 6;

function selfTest() {
  const mk = (mutate) => {
    const root = mkdtempSync(join(tmpdir(), 'sdui-manifest-check-'));
    // fixture tree: artefact + record + pin, green by construction
    const manifest = { components: { flex: { type: 'flex', inputs: [] } } };
    const raw = JSON.stringify(manifest, null, 2);
    const scriptsDir = join(root, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(root, '.objectui-sha'), 'a'.repeat(40) + '\n');
    writeFileSync(join(root, 'sdui.manifest.json'), raw);
    writeFileSync(
      join(scriptsDir, 'sdui-manifest.record.json'),
      JSON.stringify(
        {
          objectuiSha: 'a'.repeat(40),
          objectuiPackagesVersion: '0.0.0-selftest',
          sha256: createHash('sha256').update(raw).digest('hex'),
          components: 1,
        },
        null,
        2,
      ),
    );
    mutate?.(root);
    return root;
  };

  const cases = [
    ['green fixture passes', mk(), 0],
    ['missing artefact is RED', mk((r) => rmSync(join(r, 'sdui.manifest.json'))), 1],
    ['hand-edited artefact (hash mismatch) is RED', mk((r) => writeFileSync(join(r, 'sdui.manifest.json'), '{"components":{"flex":{"type":"flex"}}}')), 1],
    ['moved pin is RED', mk((r) => writeFileSync(join(r, '.objectui-sha'), 'b'.repeat(40))), 1],
    ['empty components is RED', mk((r) => {
      const raw = JSON.stringify({ components: {} }, null, 2);
      writeFileSync(join(r, 'sdui.manifest.json'), raw);
      const rec = JSON.parse(readFileSync(join(r, 'scripts', 'sdui-manifest.record.json'), 'utf8'));
      rec.sha256 = createHash('sha256').update(raw).digest('hex');
      rec.components = 0;
      writeFileSync(join(r, 'scripts', 'sdui-manifest.record.json'), JSON.stringify(rec));
    }), 1],
    ['missing record is RED', mk((r) => rmSync(join(r, 'scripts', 'sdui-manifest.record.json'))), 1],
  ];

  // The ledger this self-test's floor is evaluated against (#13489).
  const batterySeen = new Map();
  const registerCase = (name) => {
    batterySeen.set(name, (batterySeen.get(name) ?? 0) + 1);
  };

  let failures = 0;
  for (const [name, root, want] of cases) {
    registerCase(name);
    const problems = checkTree(root);
    const got = problems.length ? 1 : 0;
    if (got !== want) {
      failures++;
      console.error(`✗ self-test: ${name} — expected ${want ? 'RED' : 'GREEN'}, got ${got ? 'RED' : 'GREEN'}`);
      for (const p of problems) console.error(`    ${p}`);
    }
  }
  // ── The dispatch-gates population declaration ──────────────────────────
  // Filed outside the cases table, deliberately: each table ROW is a declared
  // battery here, so an assertion added as a row would owe a roster entry for a
  // case that gates nothing about `checkTree`'s verdicts.
  const declFail = (message) => { console.error(`✗ self-test: ${message}`); failures++; };
  const readPosix = Object.values(READ_PATHS).map((f) => f.split(sep).join('/'));
  const declared = ROOT_WATCH_HINTS.map((h) => h.replace(/\/\*+$/, ''));
  if (!readPosix.every((f) => declared.includes(f))) {
    declFail('a file checkTree reads is not declared for dispatch-gates — an unreadable literal is how '
      + 'this gate came to declare nothing at all, and it scores `undetermined` for every card again.');
  }
  if (!declared.every((h) => readPosix.includes(h))) {
    declFail('ROOT_WATCH_HINTS declares a path this gate does not read — a declaration that has drifted '
      + 'from the reads replaces a silent gate with a lying one.');
  }
  if (!ROOT_WATCH_HINTS.filter((h) => !h.replace(/\/\*+$/, '').includes('/')).every((h) => h.endsWith('/**'))) {
    declFail('a repo-ROOT file is declared without the subtree suffix — a bare single-segment literal is '
      + 'refused by hintCovers as too generic, so it would contribute no hint at all.');
  }

  // ── The floor: every declared row RAN, and ran its case (#13489) ───────
  //
  // Evaluated after every row has had its chance and BEFORE the verdict, so the
  // success line below can only be printed by a run in which the set of rows
  // that registered EQUALS the set declared. A set difference names WHICH row
  // stopped; a count says only that something did.
  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failures++;
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  const rowLabels = cases.map(([name]) => name);
  const duplicated = [...new Set(rowLabels.filter((name, i) => rowLabels.indexOf(name) !== i))];
  if (duplicated.length > 0) {
    floorBreached = true;
    floorFailure(
      `the cases table uses ${duplicated.map((n) => JSON.stringify(n)).join(', ')} as a row label more than once — ` +
        'two rows sharing a label are ONE battery, so the second can stop running while the first keeps the floor met.',
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed that case holds.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (a deleted row, a renamed label, a loop that no longer ' +
        'reaches it) and restore it.',
    );
  }

  if (failures) {
    console.error(`✗ check-sdui-manifest self-test: ${failures} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`✓ check-sdui-manifest self-test: ${cases.length} cases behave (green passes; absence, tamper, moved pin, emptiness are RED).`);

  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
        console.error(
            '\n✗ check-sdui-manifest self-test: selfTest() returned without reaching its verdict,\n'
                + 'so no success line was printed. Exiting 0 here would report a self-test\n'
                + 'that never finished as a self-test that passed.\n',
        );
        process.exit(1);
    }
  } else {
    const problems = checkTree(DEFAULT_ROOT);
    if (problems.length) {
      console.error('✗ check-sdui-manifest:');
      for (const p of problems) console.error(`  ${p}`);
      process.exit(1);
    }
    const record = JSON.parse(readFileSync(join(DEFAULT_ROOT, 'scripts', 'sdui-manifest.record.json'), 'utf8'));
    console.log(
      `✓ check-sdui-manifest: sdui.manifest.json is present, intact (sha256 ${String(record.sha256).slice(0, 12)}…, ` +
        `${record.components} components) and fresh at objectui pin ${String(record.objectuiSha).slice(0, 12)}….`,
    );
  }
}
