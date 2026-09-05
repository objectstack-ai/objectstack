#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-dts-closure -- run ONCE over the whole built workspace, AFTER the
// closure build: every declaration file a BUILT package's manifest promises
// must still be on disk when the build step is over.
//
//   node scripts/check-dts-closure.mjs              # sweep the built closure
//   node scripts/check-dts-closure.mjs --self-test  # prove the battery can go red
//
// ## Exit codes
//
//   0  every built package's declared declarations are present. (A built
//      package whose manifest declares none owes none, and is counted as such.)
//   1  a FINDING: a package that HAS a `dist/` is missing a declaration file
//      its own `package.json` points consumers at. Named, per package, per file.
//   3  PREREQUISITE NOT MET: not one workspace package has a `dist/`, so there
//      was nothing to sweep. NOT a pass and NOT a finding -- the sibling
//      convention (`check-published-readme-exports.mjs`,
//      `check-type-check-coverage.mjs`, `check-dual-build-cjs-loads.mjs`), and
//      the numbers come from `import-prerequisite.mjs` rather than being picked
//      again here.
//
// ---------------------------------------------------------------------------
// THE WINDOW IT EXISTS TO NAME (#15042)
//
// `scripts/check-dts-emitted.mjs` -- the per-package guard #12078 wired as the
// LAST step of each package's own build script -- answers one question at one
// instant: did THIS package's `tsup` leave the declarations this package
// promises? On the observation this gate was filed for it answered correctly:
//
//   packages/services/service-cluster build: DTS dist/index.d.ts   35.03 KB
//   packages/services/service-cluster build: check-dts-emitted:
//     @objectstack/service-cluster - 3/3 declared declaration file(s) present.
//
// The closure build exited 0. Later in the SAME tree, with no further build and
// no `rm` run in between, every `.d.ts` / `.d.cts` of that package was gone and
// the `.js` / `.cjs` outputs and their maps had survived; a downstream program
// reaching `packages/runtime/src/runtime.ts` then failed with
// `TS7016: Could not find a declaration file for module '@objectstack/service-cluster'`.
//
// ⛔ WHAT DELETED THEM IS NOT ESTABLISHED, and nothing here claims otherwise.
// This gate does not reproduce that, instrument it, or name a writer. It closes
// a different, mechanical gap that the observation exposed and that holds
// whatever the cause turns out to be:
//
//   the per-package guard is the LAST thing that ever looks. After a package's
//   own `tsup` returns, nothing in this repo re-reads that package's `dist/`
//   for the declarations it promised -- not at the end of the closure build,
//   not before the type verdicts that follow it.
//
// ## Why "a package whose declarations are absent" is worse than a red build
//
// The loud half is TS7016 above, and it is loud only by luck: `noImplicitAny`
// caught a DIRECT import. The quiet half is the one this repo already has scar
// tissue for (#7668, #12078, and the header of `check-test-source-alias.mjs`):
// a package whose declarations are ABSENT makes an importing symbol `any`, and
// a suite that reads that symbol runs GREEN against a type it is no longer
// checking, with nothing in the output saying so. A consumer reaching the same
// package through a re-export would not have reddened at all.
//
// So every type verdict taken in that window is a verdict about a `.d.ts` that
// is not there, and the direction that does not throw is the silent one. This
// gate converts the window into a NAMED failure at the one place a sweep is
// cheap and meaningful: right after the closure build, before the gates that
// read the built surface.
//
// ## Why a sibling script and not a `--sweep` flag on the per-package guard
//
// The derivation is NOT duplicated -- `declaredDeclarationPaths` and
// `missingDeclarations` are IMPORTED from `check-dts-emitted.mjs`, which
// exports them behind its entrypoint guard for exactly this ("so they can be
// unit-tested and reused"). What is separate is the ENTRY POINT, for reasons
// that are properties of the tree rather than taste:
//
//   1. The per-package guard is invoked positionally, with NO argv, by every
//      package build script in the workspace (`... && tsup && node
//      ../../../scripts/check-dts-emitted.mjs`). Teaching that entry point a
//      mode flag makes `process.argv` load-bearing inside ~70 build scripts,
//      where a stray argument would become a silent mode switch on a build.
//      A sibling takes its argv from CI and from a root `package.json` row, and
//      from nowhere else.
//   2. The two gates make claims about different INSTANTS and therefore carry
//      different remedies. The per-package guard's failure text is the #11907
//      tsup-worker diagnosis and is correct there; that text is wrong advice
//      for a package that emitted its declarations and no longer has them.
//   3. Self-test batteries are floored per FILE (#13489). Two contracts sharing
//      one roster lets one contract's cases stand in for the other's at the
//      floor, which is the failure the roster exists to catch.
//   4. `check-self-test-wired` / the `check:*` family convention are per script:
//      one script, one row, one `--self-test` CI runs.
//
// So the per-package contract in `check-dts-emitted.mjs` is untouched by this
// PR, and the ONE derivation of "which declarations does this manifest
// promise?" stays in that file.
//
// ## What is IN the population, and what owes nothing
//
// The population is derived, never listed: every workspace package (via the
// shared `workspace-enumerator.mjs` parse) that HAS a `dist/` directory. Two
// exclusions fall out of the derivation rather than out of a list:
//
//   · a package with no `dist/` was not built in this job and is not swept --
//     an unbuilt package is a fact about the build filter, not a finding;
//   · a built package whose manifest declares no declaration path owes none.
//     `create-objectstack` is the worked example the filing card names: a naive
//     "`index.js` present, `index.d.ts` absent" scan reports it, and it is a
//     FALSE POSITIVE -- its `exports` map declares only `./created-summary`, so
//     `dist/index.d.ts` was never promised to anyone. Asking the manifest, as
//     the shared derivation does, reads it clean without an exception row.
// ---------------------------------------------------------------------------

import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';

import { declaredDeclarationPaths, missingDeclarations } from './check-dts-emitted.mjs';
import { EXIT_FINDINGS, EXIT_PREREQUISITE_NOT_MET } from './import-prerequisite.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import {
  selfTest as workspaceEnumeratorSelfTest,
  workspaceEnumeratorFloorFailures,
  workspacePackages,
} from './workspace-enumerator.mjs';

const SELF = 'scripts/check-dts-closure.mjs';

/** Re-exported so a caller (and the self-test) can pin that ONE derivation is in play. */
export { declaredDeclarationPaths, missingDeclarations };

/** A package's `dist/` as this gate decides "was it built in this job". */
export function hasDist(root, dir) {
  const abs = join(root, dir, 'dist');
  try {
    return statSync(abs).isDirectory() && readdirSync(abs).length > 0;
  } catch {
    return false;
  }
}

/** The root as a reader should see it: repo-relative when that is shorter, absolute otherwise. */
function displayRoot(root) {
  const rel = relative(process.cwd(), root);
  if (rel === '') return '.';
  return rel.startsWith('..') ? root : rel;
}

/** File size resolver rooted at a package directory; `null` for anything not a file. */
export function sizeOnDisk(packageDir) {
  return (rel) => {
    try {
      const s = statSync(resolve(packageDir, rel));
      return s.isFile() ? s.size : null;
    } catch {
      return null;
    }
  };
}

/**
 * The sweep itself, over an already-enumerated member list.
 *
 * Split from `run()` so the self-test drives the real logic against real
 * fixture directories rather than against a re-implementation of it.
 *
 * @param {string} root repo (or fixture workspace) root
 * @param {Array<{dir: string, manifest: Record<string, unknown>}>} members
 * @returns {{built: number, checked: number, owedNone: number, files: number,
 *            findings: Array<{name: string, dir: string, missing: Array<{path: string, why: string}>}>}}
 */
export function sweep(root, members) {
  const findings = [];
  let built = 0;
  let checked = 0;
  let owedNone = 0;
  let files = 0;

  for (const { dir, manifest } of members) {
    if (!hasDist(root, dir)) continue;
    built += 1;
    const declared = declaredDeclarationPaths(manifest);
    if (declared.length === 0) {
      owedNone += 1;
      continue;
    }
    checked += 1;
    files += declared.length;
    const missing = missingDeclarations(declared, sizeOnDisk(join(root, dir)));
    if (missing.length > 0) findings.push({ name: typeof manifest.name === 'string' ? manifest.name : dir, dir, missing });
  }

  findings.sort((a, b) => a.dir.localeCompare(b.dir));
  return { built, checked, owedNone, files, findings };
}

/**
 * The refusal text, in the wording `check-published-readme-exports.mjs` copied
 * from `check-type-check-coverage.mjs` -- adapted only in the gate name, the
 * claim it disclaims and the remedy. A reader who has learned one of these
 * banners has learned all of them, and a second wording of "nothing was
 * measured" is a third thing to learn.
 *
 * Returned as a VALUE so the self-test can assert on it without spawning a
 * process or stubbing `process.exit`.
 */
export function prerequisiteNotMetText(message) {
  return (
    `\ncheck-dts-closure: PREREQUISITE NOT MET\n\n` +
    `${message}\n\n` +
    `  ⛔ This is NOT a pass and NOT a finding: nothing was swept, so this run says\n` +
    `  NOTHING about whether any package's declared declaration files are present.\n` +
    `  In particular it is NOT evidence that a build is healthy.\n` +
    `  (Exit code ${EXIT_PREREQUISITE_NOT_MET}, distinct from a finding's ${EXIT_FINDINGS} — capture it BEFORE any pipe:\n` +
    `  \`node ${SELF} > /tmp/check-dts-closure.log 2>&1; echo "EXIT=$?"\`.\n` +
    `  Piped, \`$?\` is the LAST command's status, and \`head\`/\`tail\` essentially never fail — that\n` +
    `  is the false green. \`\${PIPESTATUS[0]}\`/\`pipefail\` do recover this gate's own code.)`
  );
}

/** The finding report, as a value for the same reason the refusal is one. */
export function findingsText(result) {
  const lines = [
    `\nx check-dts-closure: ${result.findings.length} built package(s) are MISSING declaration files their`,
    `  own package.json promises. The build reported success and these files are not there.\n`,
  ];
  for (const f of result.findings) {
    lines.push(`  ${f.name}  (${f.dir})`);
    for (const m of f.missing) lines.push(`      ${m.why.padEnd(7)} ${join(f.dir, m.path)}`);
  }
  lines.push(
    '',
    '  This gate runs AFTER the closure build, so unlike the per-package guard it is not',
    '  a claim about what `tsup` emitted: each package above passed',
    '  `scripts/check-dts-emitted.mjs` at the end of its own build, or never built at all',
    '  in this job. What it names is the state of the tree the steps AFTER the build read.',
    '',
    '  Why that is worse than a failed build, and why it is reported rather than repaired:',
    '  a package whose declarations are absent makes an importing symbol `any`. A direct',
    '  import reddens with TS7016 under `noImplicitAny`; a consumer reaching it through a',
    '  re-export does not redden at all, and a suite reading that symbol passes against a',
    '  type nothing is checking (#7668, #12078). Every type verdict taken past this point',
    '  in this tree is a verdict about a declaration file that is not present.',
    '',
    '  ⛔ Do not "fix" this by relaxing the package\'s `types`/`exports` entries: those are',
    '  the paths a consumer\'s resolver reads, so removing one moves the breakage to the',
    '  consumer and hides it here.',
    '',
    '  Rebuild the named package(s) and re-run this gate:',
    '    pnpm --filter <package> build && node ' + SELF,
    '',
    '  If a rebuild restores them and a later step in the same tree loses them again, that',
    '  is #15042 reproducing — capture the tree and say so on that card rather than',
    '  editing any `tsup.config.ts` `clean` setting (#13013\'s guard is deliberate).',
    '',
  );
  return lines.join('\n');
}

export function run(root) {
  // `OS_SKIP_DTS` set means the declarations are absent ON PURPOSE, and the
  // per-package guard already stands down for it (that run hashes differently
  // in turbo, so its artifact cannot be served to a run that wants
  // declarations). A sweep that reddened here would red every deliberate
  // skip-DTS closure build.
  if (process.env.OS_SKIP_DTS) {
    console.log('check-dts-closure: OS_SKIP_DTS is set - declarations skipped by request, not swept.');
    return 0;
  }

  const members = workspacePackages(root);
  const result = sweep(root, members);

  if (result.built === 0) {
    console.error(
      prerequisiteNotMetText(
        `  Not one of the ${members.length} workspace package(s) under ${displayRoot(root)} has a\n` +
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
    `check-dts-closure: ${result.built} built package(s) swept - ${result.files}/${result.files} declared ` +
      `declaration file(s) present across ${result.checked} package(s); ${result.owedNone} built package(s) ` +
      'declare no declaration entry point and owe none.',
  );
  return 0;
}

// --- self-test ------------------------------------------------------------
// Driven against REAL fixture workspaces in a temp dir, not against an injected
// filesystem: the two directions this gate can be wrong in are both silent, and
// one of them -- an enumeration that reaches no package -- is invisible to any
// harness that hands it the population.

const SELF_TEST_BATTERIES = Object.freeze({
  'the sweep, over real fixture workspaces': 12,
  'the shared derivation is the per-package guard\'s own': 2,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 2;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 -- a self-test that never finished, reported as one that
// passed (#13798).
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

  const scratch = mkdtempSync(join(tmpdir(), 'dts-closure-'));

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
        mkdirSync(join(abs, 'dist'), { recursive: true });
        for (const [file, contents] of Object.entries(spec.dist)) writeFileSync(join(abs, 'dist', file), contents);
      }
    }
    return root;
  };

  const dualManifest = (pkgName) => ({
    name: pkgName,
    types: 'dist/index.d.ts',
    exports: {
      '.': {
        import: { types: './dist/index.d.ts', default: './dist/index.js' },
        require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
      },
      './testing': { types: './dist/testing.d.ts', import: './dist/testing.js' },
    },
  });

  // The shape the card recorded, both halves: the tree as the build left it,
  // and the tree as it was found later.
  const healthy = {
    'index.js': 'export {}\n',
    'index.cjs': 'module.exports={}\n',
    'testing.js': 'export {}\n',
    'index.d.ts': 'export {}\n',
    'index.d.cts': 'export {}\n',
    'testing.d.ts': 'export {}\n',
  };
  const vanished = { 'index.js': 'export {}\n', 'index.cjs': 'module.exports={}\n', 'testing.js': 'export {}\n' };

  try {
    battery('the sweep, over real fixture workspaces');

    // (a) declarations present -> green.
    const greenRoot = fixture('green', {
      'packages/cluster': { manifest: dualManifest('@fixture/cluster'), dist: healthy },
    });
    const green = sweep(greenRoot, workspacePackages(greenRoot));
    eq('(a) a built package with every declared declaration present yields no findings', green.findings, []);
    eq('(a) it is counted as swept, with its declared files', [green.built, green.checked, green.files, green.owedNone], [1, 1, 3, 0]);

    // (b) `index.js` present, declarations absent -> red, naming package AND file.
    const redRoot = fixture('red', {
      'packages/cluster': { manifest: dualManifest('@fixture/cluster'), dist: vanished },
    });
    const red = sweep(redRoot, workspacePackages(redRoot));
    eq(
      '(b) REJECTS the #15042 artifact: JS present, every declaration gone',
      red.findings.map((f) => `${f.name}|${f.missing.map((m) => `${m.why}:${m.path}`).join(',')}`),
      ['@fixture/cluster|missing:dist/index.d.cts,missing:dist/index.d.ts,missing:dist/testing.d.ts'],
    );
    const redText = findingsText(red);
    ok('(b) the report NAMES the package', redText.includes('@fixture/cluster'));
    ok('(b) the report NAMES each missing file, path-qualified', redText.includes('packages/cluster/dist/index.d.ts'));

    // A single vanished file is the same finding: the sweep is per declared
    // path, not "did any declaration survive".
    const survivors = { ...healthy };
    delete survivors['testing.d.ts'];
    const partialRoot = fixture('partial', {
      'packages/cluster': { manifest: dualManifest('@fixture/cluster'), dist: survivors },
    });
    const partial = sweep(partialRoot, workspacePackages(partialRoot));
    eq(
      '(b) one vanished declaration among survivors is still a finding',
      partial.findings.map((f) => f.missing.map((m) => `${m.why}:${m.path}`)),
      [['missing:dist/testing.d.ts']],
    );

    // A zero-byte declaration is present and useless -- the per-package guard's
    // `empty` verdict reaches the sweep through the shared derivation.
    const emptyRoot = fixture('empty', {
      'packages/cluster': { manifest: dualManifest('@fixture/cluster'), dist: { ...healthy, 'index.d.ts': '' } },
    });
    eq(
      '(b) a zero-byte declaration reds as `empty`, not as present',
      sweep(emptyRoot, workspacePackages(emptyRoot)).findings.map((f) => f.missing.map((m) => `${m.why}:${m.path}`)),
      [['empty:dist/index.d.ts']],
    );

    // (c) a built package whose exports declare NO types owes none -- the
    // `create-objectstack` false positive the filing card names, in both of its
    // spellings: no `types` condition at all, and a `types` condition for a
    // subpath that is not `index`.
    const cleanRoot = fixture('clean', {
      'packages/no-types': {
        manifest: { name: '@fixture/no-types', main: 'dist/index.js', exports: { '.': './dist/index.js' } },
        dist: { 'index.js': 'export {}\n' },
      },
      'packages/subpath-only': {
        manifest: {
          name: 'fixture-create',
          exports: { './created-summary': { types: './dist/created-summary.d.ts', import: './dist/created-summary.js' } },
        },
        dist: { 'index.js': 'export {}\n', 'created-summary.js': 'export {}\n', 'created-summary.d.ts': 'export {}\n' },
      },
    });
    const clean = sweep(cleanRoot, workspacePackages(cleanRoot));
    eq('(c) a built package declaring no declaration path is NOT a finding', clean.findings, []);
    eq('(c) the `index.js` present / `index.d.ts` absent false positive reads clean', [clean.built, clean.checked, clean.owedNone], [2, 1, 1]);

    // An UNBUILT package is not swept and is not a finding: no `dist/` is a
    // fact about the build filter, not about the manifest.
    const mixedRoot = fixture('mixed', {
      'packages/built': { manifest: dualManifest('@fixture/built'), dist: healthy },
      'packages/unbuilt': { manifest: dualManifest('@fixture/unbuilt'), dist: null },
    });
    const mixed = sweep(mixedRoot, workspacePackages(mixedRoot));
    eq('an unbuilt package is skipped, not reported', [mixed.findings.length, mixed.built], [0, 1]);

    // (d) no `dist/` anywhere -> PREREQUISITE NOT MET, never a pass.
    const bareRoot = fixture('bare', {
      'packages/cluster': { manifest: dualManifest('@fixture/cluster'), dist: null },
    });
    const bare = sweep(bareRoot, workspacePackages(bareRoot));
    eq('(d) a closure with no `dist/` at all sweeps nothing', [bare.built, bare.findings.length], [0, 0]);
    // Silenced: `run()` prints the refusal by design, and a green self-test
    // that emits `PREREQUISITE NOT MET` into a CI log reads as a failing gate.
    eq('(d) run() answers that with exit 3, not 0', quiet(() => run(bareRoot)), EXIT_PREREQUISITE_NOT_MET);
    ok(
      '(d) the refusal disclaims the measurement rather than reading as a pass',
      prerequisiteNotMetText('x').includes('NOT a pass and NOT a finding'),
    );

    battery('the shared derivation is the per-package guard\'s own');
    // Not a re-implementation: the sweep's answer for a manifest IS
    // `declaredDeclarationPaths`'s answer, and that function is the per-package
    // guard's export. A second derivation would drift, and the symptom of drift
    // is a green sweep.
    const m = dualManifest('@fixture/cluster');
    eq(
      'the sweep reports exactly the paths the shared derivation names',
      (sweep(redRoot, [{ dir: 'packages/cluster', manifest: m }]).findings[0]?.missing ?? []).map((x) => x.path),
      missingDeclarations(declaredDeclarationPaths(m), () => null).map((x) => x.path),
    );
    eq(
      'the derivation covers `types`, both `exports` type conditions and the subpath',
      declaredDeclarationPaths(m),
      ['dist/index.d.cts', 'dist/index.d.ts', 'dist/testing.d.ts'],
    );

    // The shared enumerator is a plain module with no CI invocation of its own
    // (#11510); every script that consolidated onto it folds in its checks.
    for (const failure of workspaceEnumeratorSelfTest({ root: process.cwd() })) failures.push(failure);
    for (const failure of workspaceEnumeratorFloorFailures()) failures.push(failure);
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
    console.error(`\nx check-dts-closure self-test: ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  - ${f}\n`);
    return 1;
  }
  console.log('check-dts-closure self-test: all assertions passed.');
  selfTestReachedVerdict = true;
  return 0;
}

// Behind the entrypoint guard, for the reason the per-package guard states: an
// unguarded `process.exit` here would end any importer mid-import, with status
// 0 on the healthy path.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-dts-closure self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  }
  process.exit(run(process.cwd()));
}
