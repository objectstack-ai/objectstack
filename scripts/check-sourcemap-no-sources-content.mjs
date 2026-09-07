#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-sourcemap-no-sources-content -- run ONCE over the whole built
// workspace, AFTER the closure build: no published `.map` file may carry a
// non-empty `sourcesContent` array.
//
//   node scripts/check-sourcemap-no-sources-content.mjs              # sweep
//   node scripts/check-sourcemap-no-sources-content.mjs --self-test  # prove it can go red
//
// ## Exit codes
//
//   0  every built, non-private package's `.map` files carry no source text.
//   1  a FINDING: at least one map embeds `sourcesContent`. Named, per package,
//      per file.
//   3  PREREQUISITE NOT MET: not one workspace package has a `dist/`, so there
//      was nothing to sweep. NOT a pass and NOT a finding -- same convention as
//      `check-dts-closure.mjs`, `check-dual-build-cjs-loads.mjs`.
//
// ---------------------------------------------------------------------------
// THE DEFECT IT EXISTS TO CLOSE (#16469, the build half of #15905's E3 Q1)
//
// `sourcemap: true` is esbuild shorthand; esbuild's OWN default for the
// `sourcesContent` option is `true`. Nobody in this tree decided to publish
// the complete original source of every package -- comments included -- to
// npm inside `.js.map`, it fell out of a default nobody looked at. Measured on
// `origin/main` before this gate landed: 55 of 57 publishable packages shipped
// `.js.map` with `sourcesContent`, and source maps were roughly half of
// `@objectstack/spec`'s published bytes.
//
// The repair (this PR) sets `sourcesContent: false` at the tsup/esbuild layer
// -- `mappings` (stack-trace positions) survive, source text does not. This
// gate is the PIN: without it, one new `tsup.config.ts` that omits the shared
// `esbuildOptions` hook -- or a tsup upgrade that changes esbuild's default --
// silently re-embeds the same text and nothing says so until someone reads a
// tarball by hand again.
//
// ## Why a closure-wide sweep and not a per-package build-script line
//
// `check-dts-emitted.mjs` is wired into each package's OWN build script
// because it answers a question only that package's own tsup run can answer.
// This gate asks a question about the SHAPE OF THE OUTPUT BYTES, which is the
// same question for every package regardless of which config produced them,
// so one sweep over `dist/**/*.map` after the closure build covers the whole
// fleet without a change to every package's `build` script. It runs from
// `Build Core` in `ci.yml`, alongside `check:dual-build-cjs-loads` and
// `check:dts-closure` -- the same job, for the same reason: it reads a real
// `dist/`, and refuses (exit 3) rather than passing silently when there is
// none.
// ---------------------------------------------------------------------------

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import process from 'node:process';

import { EXIT_FINDINGS, EXIT_PREREQUISITE_NOT_MET } from './import-prerequisite.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { workspacePackages } from './workspace-enumerator.mjs';

const SELF = 'scripts/check-sourcemap-no-sources-content.mjs';

/**
 * `scripts/pm/dispatch-gates.mjs` derives which gates a card owes by matching
 * path literals in a gate's own source against the card's changed files (the
 * `ROOT_DIR_WATCH_HINTS` idiom, see `check-dual-build-cjs-loads.mjs` for the
 * full argument). Reused verbatim: it is the same population this gate's own
 * verdict is a function of — a `tsup.config.ts` that drops the shared
 * `esbuildOptions` hook is exactly how a package regresses.
 */
const ROOT_DIR_WATCH_HINTS = ['packages/**/tsup.config.ts'];

/**
 * The two repo-root files outside `packages/**` that this gate's verdict is
 * also a function of: the shared root config every un-customised package
 * builds through, and the one shared function that decides the setting for
 * every `tsup.config.ts`, this one included. Spelled with a trailing `/**`
 * per the established idiom (`git-merge-regen.mjs`'s `ROOT_FILE_WATCH_HINTS`)
 * so a bare top-level filename is not refused as "too generic".
 */
const ROOT_FILE_WATCH_HINTS = ['tsup.config.ts/**', 'scripts/tsup-drop-sources-content.mjs/**'];

/** A package's `dist/` as this gate decides "was it built in this job". */
export function hasDist(root, dir) {
  const abs = join(root, dir, 'dist');
  try {
    return statSync(abs).isDirectory() && readdirSync(abs).length > 0;
  } catch {
    return false;
  }
}

/** Every `.map` file under `<root>/<dir>/dist`, recursively, repo-relative. */
export function mapFilesUnder(root, dir) {
  const distAbs = join(root, dir, 'dist');
  const out = [];
  const walk = (abs) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childAbs = join(abs, e.name);
      if (e.isDirectory()) {
        walk(childAbs);
      } else if (e.isFile() && e.name.endsWith('.map')) {
        out.push(relative(root, childAbs));
      }
    }
  };
  walk(distAbs);
  return out.sort();
}

/**
 * Whether a parsed source map carries source text this gate refuses.
 * `sourcesContent` absent, `null`, or an empty array is clean -- esbuild with
 * `sourcesContent: false` and tsc without `inlineSources` both omit the key
 * entirely, so "absent" is the expected healthy shape, not a special case.
 */
export function embedsSourceText(map) {
  return Array.isArray(map?.sourcesContent) && map.sourcesContent.length > 0;
}

/**
 * The sweep itself, over an already-enumerated member list.
 *
 * @param {string} root repo (or fixture workspace) root
 * @param {Array<{dir: string, manifest: Record<string, unknown>}>} members
 * @returns {{built: number, files: number, findings: Array<{name: string, dir: string, maps: string[]}>}}
 */
export function sweep(root, members) {
  const findings = [];
  let built = 0;
  let files = 0;

  for (const { dir, manifest } of members) {
    if (manifest?.private === true) continue;
    if (!hasDist(root, dir)) continue;
    built += 1;

    const maps = mapFilesUnder(root, dir);
    const embedded = [];
    for (const rel of maps) {
      files += 1;
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(join(root, rel), 'utf8'));
      } catch {
        // A `.map` file this gate cannot parse is not this gate's finding —
        // some other check owns malformed JSON.
        continue;
      }
      if (embedsSourceText(parsed)) embedded.push(rel);
    }
    if (embedded.length > 0) {
      findings.push({ name: typeof manifest?.name === 'string' ? manifest.name : dir, dir, maps: embedded });
    }
  }

  findings.sort((a, b) => a.dir.localeCompare(b.dir));
  return { built, files, findings };
}

/** The refusal text, same shape as `check-dts-closure.mjs`'s. */
export function prerequisiteNotMetText(message) {
  return (
    `\ncheck-sourcemap-no-sources-content: PREREQUISITE NOT MET\n\n` +
    `${message}\n\n` +
    `  ⛔ This is NOT a pass and NOT a finding: nothing was swept, so this run says\n` +
    `  NOTHING about whether any published map embeds source text.\n` +
    `  (Exit code ${EXIT_PREREQUISITE_NOT_MET}, distinct from a finding's ${EXIT_FINDINGS} — capture it BEFORE any pipe:\n` +
    `  \`node ${SELF} > /tmp/check-sourcemap-no-sources-content.log 2>&1; echo "EXIT=$?"\`.\n` +
    `  Piped, \`$?\` is the LAST command's status, and \`head\`/\`tail\` essentially never fail — that\n` +
    `  is the false green. \`\${PIPESTATUS[0]}\`/\`pipefail\` do recover this gate's own code.)`
  );
}

/** The finding report, as a value for the same reason the refusal is one. */
export function findingsText(result) {
  const lines = [
    `\nx check-sourcemap-no-sources-content: ${result.findings.length} built package(s) publish source`,
    `  maps that embed the ORIGINAL SOURCE TEXT (\`sourcesContent\`), comments included.\n`,
  ];
  for (const f of result.findings) {
    lines.push(`  ${f.name}  (${f.dir})`);
    for (const m of f.maps) lines.push(`      ${m}`);
  }
  lines.push(
    '',
    '  This is the pin for #16469 (build half of #15905 question 1): `sourcesContent` is OFF',
    '  by construction at the shared tsup/esbuild layer, so a map carrying it means either a',
    '  new build config skipped the shared `esbuildOptions` hook, or a toolchain upgrade',
    '  changed esbuild\'s default back to embedding.',
    '',
    '  `mappings` (stack-trace positions) are NOT this gate\'s business and are untouched —',
    '  only the embedded source TEXT is refused.',
    '',
    '  Rebuild the named package(s) after fixing its `tsup.config.ts` (or the tsc project\'s',
    '  `inlineSources`, if it is tsc-built) and re-run this gate:',
    '    pnpm --filter <package> build && node ' + SELF,
    '',
  );
  return lines.join('\n');
}

export function run(root) {
  const members = workspacePackages(root);
  const result = sweep(root, members);

  if (result.built === 0) {
    console.error(
      prerequisiteNotMetText(
        `  Not one of the ${members.length} workspace package(s) under ${relative(process.cwd(), root) || '.'} has a\n` +
          '  `dist/`, so there was nothing to sweep. This gate reads the tree the closure build\n' +
          '  leaves behind; run it AFTER that build.\n\n' +
          '  Run `pnpm build` (or the workflow step that builds the closure) and re-run this gate.',
      ),
    );
    return EXIT_PREREQUISITE_NOT_MET;
  }

  if (result.findings.length > 0) {
    console.error(findingsText(result));
    return EXIT_FINDINGS;
  }

  console.log(
    `check-sourcemap-no-sources-content: ${result.built} built package(s) swept - ${result.files} map(s), ` +
      'none embed source text.',
  );
  return 0;
}

// --- self-test ------------------------------------------------------------
// Driven against REAL fixture workspaces in a temp dir, not against an
// injected filesystem — the positive control the card asks for (a planted
// map that makes the gate go red) is exactly this: a fixture map that
// genuinely embeds `sourcesContent`, read back off real disk.

const SELF_TEST_BATTERIES = Object.freeze({
  'the sweep, over real fixture workspaces': 8,
  'the dispatch-gates watch hints': 3,
});

const SELF_TEST_BATTERY_FLOOR = 1;
const UNATTRIBUTED_BATTERY = '(no battery open)';

let selfTestReachedVerdict = false;

function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  const failures = [];
  const eq = (label, actual, expected) => {
    registerCase();
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
  };
  const ok = (label, condition) => eq(label, condition === true, true);
  /** Run `fn` with this gate's own printing suppressed, and return its value. */
  const quiet = (fn) => {
    const { log, error } = console;
    console.log = () => {};
    console.error = () => {};
    try {
      return fn();
    } finally {
      console.log = log;
      console.error = error;
    }
  };

  const scratch = mkdtempSync(join(tmpdir(), 'sourcemap-no-sources-content-'));

  /**
   * Build a fixture workspace: `{ '<dir>': { manifest, dist: { '<file>': '<contents>' } | null } }`.
   * `dist: null` means the package was never built.
   */
  const fixture = (name, members) => {
    const root = join(scratch, name);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    for (const [dir, spec] of Object.entries(members)) {
      const abs = join(root, dir);
      mkdirSync(abs, { recursive: true });
      writeFileSync(join(abs, 'package.json'), JSON.stringify(spec.manifest, null, 2));
      if (spec.dist) {
        for (const [file, contents] of Object.entries(spec.dist)) {
          const target = join(abs, 'dist', file);
          mkdirSync(join(target, '..'), { recursive: true });
          writeFileSync(target, contents);
        }
      }
    }
    return root;
  };

  const healthyMap = JSON.stringify({
    version: 3,
    sources: ['../src/index.ts'],
    names: [],
    mappings: 'AAAA',
    file: 'index.js',
  });
  const embeddedMap = JSON.stringify({
    version: 3,
    sources: ['../src/index.ts'],
    names: [],
    mappings: 'AAAA',
    file: 'index.js',
    // The positive control: real, planted source text on real disk.
    sourcesContent: ['export const secret = 1; // @internal test-only comment\n'],
  });
  const emptyArrayMap = JSON.stringify({
    version: 3,
    sources: ['../src/index.ts'],
    names: [],
    mappings: 'AAAA',
    file: 'index.js',
    sourcesContent: [],
  });

  try {
    battery('the sweep, over real fixture workspaces');

    // (a) a healthy map with no `sourcesContent` key -> green.
    const greenRoot = fixture('green', {
      'packages/a': {
        manifest: { name: '@fixture/a' },
        dist: { 'index.js': 'export {}\n', 'index.js.map': healthyMap },
      },
    });
    const green = sweep(greenRoot, workspacePackages(greenRoot));
    eq('(a) a map with no `sourcesContent` key is clean', green.findings, []);
    eq('(a) it is still counted as swept', [green.built, green.files], [1, 1]);

    // (b) THE POSITIVE CONTROL — a map that genuinely embeds source text goes red.
    const redRoot = fixture('red', {
      'packages/b': {
        manifest: { name: '@fixture/b' },
        dist: { 'index.js': 'export {}\n', 'index.js.map': embeddedMap },
      },
    });
    const red = sweep(redRoot, workspacePackages(redRoot));
    eq(
      '(b) REJECTS a planted map carrying `sourcesContent`',
      red.findings.map((f) => `${f.name}|${f.maps.join(',')}`),
      ['@fixture/b|packages/b/dist/index.js.map'],
    );
    const redText = findingsText(red);
    ok('(b) the report NAMES the package', redText.includes('@fixture/b'));
    ok('(b) the report NAMES the offending map file', redText.includes('packages/b/dist/index.js.map'));
    eq('(b) run() answers a finding with exit 1', quiet(() => run(redRoot)), EXIT_FINDINGS);

    // (c) an EMPTY `sourcesContent` array is clean — "non-empty" is the bar.
    const emptyRoot = fixture('empty-array', {
      'packages/c': {
        manifest: { name: '@fixture/c' },
        dist: { 'index.js': 'export {}\n', 'index.js.map': emptyArrayMap },
      },
    });
    eq(
      '(c) an empty `sourcesContent` array is not a finding',
      sweep(emptyRoot, workspacePackages(emptyRoot)).findings,
      [],
    );

    // (d) a PRIVATE package is not swept at all — this gate is about what npm
    // ships, and a private workspace member ships nothing.
    const privateRoot = fixture('private', {
      'packages/d': {
        manifest: { name: '@fixture/d', private: true },
        dist: { 'index.js': 'export {}\n', 'index.js.map': embeddedMap },
      },
    });
    const privateResult = sweep(privateRoot, workspacePackages(privateRoot));
    eq('(d) a private package is skipped, embedded map or not', [privateResult.built, privateResult.findings.length], [0, 0]);

    // (e) a nested map (e.g. `dist/browser/index.js.map`) is reached too — the
    // walk is recursive, not `dist/*.map` only.
    const nestedRoot = fixture('nested', {
      'packages/e': {
        manifest: { name: '@fixture/e' },
        dist: { 'browser/index.js': 'export {}\n', 'browser/index.js.map': embeddedMap },
      },
    });
    eq(
      '(e) a map nested under dist/ (not directly in it) is still swept',
      sweep(nestedRoot, workspacePackages(nestedRoot)).findings.map((f) => f.maps),
      [['packages/e/dist/browser/index.js.map']],
    );

    // (f) an UNBUILT package (no `dist/`) is skipped, not a finding.
    const mixedRoot = fixture('mixed', {
      'packages/built': {
        manifest: { name: '@fixture/built' },
        dist: { 'index.js': 'export {}\n', 'index.js.map': healthyMap },
      },
      'packages/unbuilt': { manifest: { name: '@fixture/unbuilt' }, dist: null },
    });
    const mixed = sweep(mixedRoot, workspacePackages(mixedRoot));
    eq('(f) an unbuilt package is skipped, not reported', [mixed.findings.length, mixed.built], [0, 1]);

    // (g) no `dist/` anywhere -> PREREQUISITE NOT MET, never a pass.
    const bareRoot = fixture('bare', {
      'packages/a': { manifest: { name: '@fixture/a' }, dist: null },
    });
    eq('(g) run() answers a closure with no dist/ with exit 3, not 0', quiet(() => run(bareRoot)), EXIT_PREREQUISITE_NOT_MET);
    ok(
      '(g) the refusal disclaims the measurement rather than reading as a pass',
      prerequisiteNotMetText('x').includes('NOT a pass and NOT a finding'),
    );

    // (h) the healthy fixture, end to end through `run()`, exits 0.
    eq('(h) run() answers an all-clean closure with exit 0', quiet(() => run(greenRoot)), 0);

    battery('the dispatch-gates watch hints');
    // Spelled as LITERALS the extractor can read, never built from a variable
    // — see `check-dual-build-cjs-loads.mjs`'s own pin of the same property.
    ok(
      'the package-scoped hint is spelled as a literal this file also contains',
      readFileSync(new URL(import.meta.url), 'utf8').includes("'packages/**/tsup.config.ts'"),
    );
    eq('the two root-file hints', ROOT_FILE_WATCH_HINTS, ['tsup.config.ts/**', 'scripts/tsup-drop-sources-content.mjs/**']);
    ok('neither watch-hint list is empty', ROOT_DIR_WATCH_HINTS.length > 0 && ROOT_FILE_WATCH_HINTS.length > 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    failures.push(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    failures.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    failures.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    failures.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }

  if (failures.length > 0) {
    console.error(`\nx check-sourcemap-no-sources-content self-test: ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  - ${f}\n`);
    return 1;
  }
  console.log('check-sourcemap-no-sources-content self-test: all assertions passed.');
  selfTestReachedVerdict = true;
  return 0;
}

// Behind the entrypoint guard, for the reason the sibling gates state: an
// unguarded `process.exit` here would end any importer mid-import, with status
// 0 on the healthy path.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-sourcemap-no-sources-content self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  }
  process.exit(run(process.cwd()));
}
