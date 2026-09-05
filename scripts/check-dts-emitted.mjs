#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-dts-emitted -- run as the LAST step of a package's own build: every
// declaration file the package's manifest promises must actually be on disk
// before the build is allowed to report success.
//
//   node ../../../scripts/check-dts-emitted.mjs     # from the package directory
//   node scripts/check-dts-emitted.mjs --self-test
//
// ---------------------------------------------------------------------------
// THE DEFECT IT EXISTS TO CLOSE (#11907)
//
// tsup 8.5.1 runs DTS generation in a `worker_threads.Worker` (dist/rollup.js)
// and settles the build promise ONLY from that worker's `message` events:
//
//     await new Promise((resolve, reject) => {
//       const worker = new Worker(path.join(__dirname, './rollup.js'));
//       worker.postMessage({ ... });
//       worker.on('message', (data) => {
//         if (data === 'error') { terminateWorker(); reject(...); }
//         else if (data === 'success') { terminateWorker(); resolve(); }
//         ...
//       });
//       // <- no worker.on('error'), no worker.on('exit')
//     });
//
// There is no `error` handler and no `exit` handler. What that leaves silent is
// a CLASS, not any one trigger: a worker that ends WITHOUT POSTING A MESSAGE and
// without emitting an `error` event -- a hard `process.exit` inside the worker,
// a terminated thread, any other message-less end -- runs neither branch, so the
// promise NEVER SETTLES, the event loop drains, and **Node exits 0**. tsup's
// `Promise.all([dtsTask(), mainTasks()])` never resolves either, so nothing
// prints and nothing throws: the JS pass has already written `dist/`, so the run
// leaves a dist with `index.js` / `index.mjs` / maps and ZERO `.d.ts` files, and
// reports success.
//
// !! OOM IS THE LOUD SIBLING -- IT IS NOT THIS SHAPE. If you got here after a
// memory-starved build, you are looking at a different failure. Node delivers
// worker heap exhaustion as an `error` event (`ERR_WORKER_OUT_OF_MEMORY`), and
// an `error` event with no listener is rethrown by EventEmitter -- so an OOM'd
// DTS pass exits NON-ZERO and prints a stack. A non-zero build is never cached
// by turbo, which is precisely the property this section used to say OOM lacked.
// Measured on Node v22.22.2 / linux x64, against a harness carrying the promise
// shape above (only `message` registered):
//
//   worker death mode                        event    process outcome
//   ---------------------------------------------------------------------------
//   `process.exit()`, CJS caller             exit     exit 0, ZERO output
//   `process.exit()`, ESM caller (top-level   exit    exit 13 + "unsettled
//     await)                                            top-level await" warning
//   heap OOM, per-worker `resourceLimits`    error    exit 1
//   heap OOM, process-wide max-old-space     error    exit 1
//
// Only the first row is the defect this guard closes. The caller's module system
// is load-bearing: the SAME message-less death exits 13 with a warning under an
// ESM top-level `await` and 0 in silence under CJS. tsup's CLI is CJS, which is
// why the shape that was observed was a silent one.
//
// What actually killed the worker in the original observation is NOT established
// here -- only that it ended without an `error` event, because that run exited 0,
// and therefore that memory pressure is not a demonstrated cause of this shape.
//
// That is a correctness problem for the build CACHE, not just for one build.
// `OS_SKIP_DTS` is declared in turbo.json `globalEnv` and it works: measured on
// this package, `@objectstack/plugin-auth#build` hashes `ce8fa0947ab2f8f8` with
// the variable unset and `a6411042c68db782` with `OS_SKIP_DTS=1`. So a
// deliberate skip-DTS build is already cache-isolated from a normal one. The
// silent worker death is NOT: it happens on a run with `OS_SKIP_DTS` unset,
// which hashes as -- because it *is* -- an ordinary full build. turbo sees exit
// 0 and caches the DTS-less `dist/**` under the ordinary hash. Every later run
// in that worktree replays it, so the AGENTS.md section 9 remedy (`pnpm build`)
// does not clear it: a plain rebuild is a cache HIT that restores the same bad
// artifact. Only `--force` (or deleting the entry) replaces it.
//
// The package's own typecheck is then what reds, on a diff that never touched
// it -- `error TS7016: Could not find a declaration file for module '...'` --
// which reads as "your change broke this package".
//
// So the repair is at the cause: a build that was supposed to emit declarations
// and did not must EXIT NON-ZERO. turbo only caches successful tasks, so a
// failing build never becomes a cache entry, and the fault cannot outlive the
// run that produced it. Nothing here loosens a hash or busts a cache.
// ---------------------------------------------------------------------------

import { readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

import { isEntrypoint } from './invoked-as.mjs';

/**
 * Every declaration path the manifest promises a consumer.
 *
 * Deliberately the DECLARED surface (`types`, `typings`, and `types`
 * conditions inside `exports`), not "whatever tsup might have emitted": these
 * are the paths a consumer's resolver actually reads, so a missing one is
 * exactly the breakage TS7016 reports. Emitting extra declarations that the
 * manifest never names is not this guard's business.
 */
export function declaredDeclarationPaths(manifest) {
  const paths = new Set();
  // Normalise BEFORE the Set: `types` is conventionally written bare
  // (`dist/index.d.ts`) while an `exports` condition must be `./`-relative
  // (`./dist/index.d.ts`). Deduping after the strip reports the same file twice.
  const add = (p) => paths.add(p.replace(/^\.\//, ''));

  for (const key of ['types', 'typings']) {
    if (typeof manifest[key] === 'string') add(manifest[key]);
  }

  // Inside `exports`, a declaration target can appear under a `types`
  // condition at any depth. Match on the extension rather than the key so a
  // nested/array form cannot slip past.
  const collect = (node) => {
    if (typeof node === 'string') {
      // Only `./`-relative targets are paths; a bare specifier is a re-export.
      if (node.startsWith('./') && /\.d\.[cm]?ts$/.test(node)) add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) collect(v);
      return;
    }
    if (node && typeof node === 'object') for (const v of Object.values(node)) collect(v);
  };
  collect(manifest.exports);

  return [...paths].sort();
}

/** Missing or empty declaration files, given a resolver for file size. */
export function missingDeclarations(declared, sizeOf) {
  const missing = [];
  for (const rel of declared) {
    const size = sizeOf(rel);
    if (size === null) missing.push({ path: rel, why: 'missing' });
    else if (size === 0) missing.push({ path: rel, why: 'empty' });
  }
  return missing;
}

function sizeOnDisk(dir) {
  return (rel) => {
    try {
      const s = statSync(resolve(dir, rel));
      return s.isFile() ? s.size : null;
    } catch {
      return null;
    }
  };
}

function run(dir) {
  // `OS_SKIP_DTS` set means the declarations are absent ON PURPOSE. That run
  // hashes differently from a full build (globalEnv, verified above), so its
  // artifact cannot be served to a run that wants declarations -- there is
  // nothing for this guard to protect.
  if (process.env.OS_SKIP_DTS) {
    console.log('check-dts-emitted: OS_SKIP_DTS is set - declarations skipped by request, not checked.');
    return 0;
  }

  let manifest;
  const manifestPath = resolve(dir, 'package.json');
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`\nx check-dts-emitted: cannot read ${manifestPath}: ${err.message}`);
    console.error('  This runs from the package directory, as the last step of that package\'s build.\n');
    return 1;
  }

  const declared = declaredDeclarationPaths(manifest);
  if (declared.length === 0) {
    console.log(`check-dts-emitted: ${manifest.name ?? dir} declares no declaration entry points - nothing to check.`);
    return 0;
  }

  const missing = missingDeclarations(declared, sizeOnDisk(dir));
  if (missing.length === 0) {
    console.log(
      `check-dts-emitted: ${manifest.name ?? dir} - ${declared.length}/${declared.length} declared declaration file(s) present.`,
    );
    return 0;
  }

  const rel = relative(process.cwd(), dir) || '.';
  console.error(`\nx ${manifest.name ?? rel}: the build finished but did NOT emit the declarations this package promises.\n`);
  for (const m of missing) console.error(`    ${m.why.padEnd(7)} ${m.path}`);
  console.error(
    '\n  package.json points consumers at these paths, so without them any dependent\n' +
      "  typecheck fails with TS7016 \"Could not find a declaration file for module\n" +
      `  '${manifest.name ?? ''}'\" - and it reads as though THEIR change broke this package.\n` +
      '\n  Most likely cause (#11907): tsup runs DTS generation in a worker thread and\n' +
      "  settles its promise only on the worker's `message` events - it registers no\n" +
      '  `error` and no `exit` handler. A worker that ends without posting a message\n' +
      '  AND without an `error` event - a hard `process.exit`, a terminated thread -\n' +
      '  settles neither branch, so the promise never settles, the event loop drains,\n' +
      '  and node exits 0 with the JS pass already written.\n' +
      '\n  It is NOT an out-of-memory build, and more heap will not help. Node delivers\n' +
      '  worker heap exhaustion as an `error` event (ERR_WORKER_OUT_OF_MEMORY) which,\n' +
      '  with no listener registered, is rethrown - so an OOM DTS pass exits NON-ZERO\n' +
      '  and prints a stack, the build stops at `tsup`, and this guard never runs.\n' +
      '  Reaching this text is itself evidence the DTS pass exited 0.\n' +
      '\n  This guard is what stops that exit 0 from becoming a CACHED artifact: turbo\n' +
      '  caches only successful tasks, and a skip-DTS run already hashes differently,\n' +
      '  so failing here keeps a DTS-less dist from ever being served as a full build.\n' +
      '\n  WHICH SHAPE ARE YOU IN? Count the declarations actually on disk:\n' +
      '    ls dist/*.d.ts dist/*.d.mts dist/*.d.cts 2>/dev/null | wc -l\n' +
      '\n  0 - the DTS pass produced nothing, so read what it printed:\n' +
      '        pnpm --filter <pkg> build 2>&1 | grep -i dts\n' +
      '    A "DTS Build start" with no success and no error line after it is the\n' +
      '    message-less death above.\n' +
      '\n  1 or more - nothing died. package.json promises a declaration path that this\n' +
      "    package's tsup entries never emit, so every rebuild fails here the same way;\n" +
      '    line the `types` conditions up with the entry points that are really built.\n' +
      '\n  If a poisoned entry was cached before this guard existed, a plain rebuild is a\n' +
      '  cache HIT that restores it - clear it with:\n' +
      '    pnpm exec turbo run build --filter <pkg> --force\n',
  );
  return 1;
}

// --- self-test ------------------------------------------------------------
// The two directions this guard can be wrong in are both silent: over-matching
// makes every build fail, under-matching waves the DTS-less dist through -- the
// exact artifact #11907 recorded. So both get asserted rather than assumed.

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed the
// way PR #13487 validated on check-doc-authoring: what is pinned is the
// registered NAMES, not a number. The floor requires the OPENED set to equal the
// DECLARED set with each battery at or above its own count.
//
// This file declares ONE battery, opened at the top of the self-test body. It
// carries fewer than the two named section banners the sectioning criterion
// needs, and ⛔ a comment is NOT promoted to a section head — that is a
// judgement per comment this transplant does not make. The hoisted single
// battery is the shape PR #14896 and PR #15003 landed for exactly this case.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The count is a FLOOR, not an equality — adding cases is ordinary work and must
// not red. A battery BELOW its floor means cases stopped running; the remedy is
// to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'check-dts-emitted self-test': 8,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 1;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  battery('check-dts-emitted self-test');
  const failures = [];
  const eq = (label, actual, expected) => {
    registerCase();
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
  };

  const authLike = {
    name: '@objectstack/plugin-auth',
    types: 'dist/index.d.ts',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.mjs',
        require: './dist/index.js',
      },
      './rate-limit-storage': {
        types: './dist/rate-limit-storage.d.ts',
        import: './dist/rate-limit-storage.mjs',
        require: './dist/rate-limit-storage.js',
      },
    },
  };
  eq('collects every declared declaration, deduped across `types` and `exports`', declaredDeclarationPaths(authLike), [
    'dist/index.d.ts',
    'dist/rate-limit-storage.d.ts',
  ]);

  eq(
    'ignores JS entry points - only declarations are this guard\'s business',
    declaredDeclarationPaths({ main: 'dist/index.js', module: 'dist/index.mjs', exports: { '.': './dist/index.mjs' } }),
    [],
  );

  eq('ignores bare re-export specifiers', declaredDeclarationPaths({ exports: { '.': 'other-pkg/types' } }), []);

  eq('finds .d.mts and .d.cts', declaredDeclarationPaths({ exports: { '.': { types: './dist/index.d.mts' } } }), [
    'dist/index.d.mts',
  ]);

  eq('handles the array form inside exports', declaredDeclarationPaths({ exports: { '.': [{ types: './dist/a.d.ts' }] } }), [
    'dist/a.d.ts',
  ]);

  // The load-bearing direction: the #11907 artifact must be caught.
  const declared = declaredDeclarationPaths(authLike);
  const dtsLessDist = (rel) => (rel.endsWith('.d.ts') ? null : 100);
  eq(
    'REJECTS the #11907 artifact: JS present, zero declarations',
    missingDeclarations(declared, dtsLessDist).map((m) => `${m.why}:${m.path}`),
    ['missing:dist/index.d.ts', 'missing:dist/rate-limit-storage.d.ts'],
  );

  eq('ACCEPTS a healthy dist', missingDeclarations(declared, () => 100), []);

  eq(
    'rejects a zero-byte declaration - present but useless',
    missingDeclarations(declared, (rel) => (rel === 'dist/index.d.ts' ? 0 : 100)).map((m) => `${m.why}:${m.path}`),
    ['empty:dist/index.d.ts'],
  );

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => { failures.push(message); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }

  if (failures.length > 0) {
    console.error(`\nx check-dts-emitted self-test: ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  - ${f}\n`);
    return 1;
  }
  console.log('check-dts-emitted self-test: all assertions passed.');
  selfTestReachedVerdict = true;
  return 0;
}

// Behind the entrypoint guard: this module exports its two predicates so they
// can be unit-tested and reused, and an unguarded `process.exit` here would end
// any importer mid-import -- with status 0 on the healthy path, so the importer
// would read it as success. That is the same "exit 0 means nothing went wrong"
// failure this guard exists to catch, one level up.
if (isEntrypoint(import.meta.url)) {
  const isSelfTest = process.argv.includes('--self-test');
  if (isSelfTest) {
    const selfTestCode = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-dts-emitted self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(selfTestCode);
  }
  process.exit(run(process.cwd()));
}
