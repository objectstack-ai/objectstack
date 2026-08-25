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
// There is no `error` handler and no `exit` handler. If the worker dies without
// posting a message -- OOM under memory pressure, a hard `process.exit`, a
// terminated thread -- neither branch ever runs, the promise NEVER SETTLES, the
// event loop drains, and **Node exits 0**. tsup's `Promise.all([dtsTask(),
// mainTasks()])` never resolves either, so nothing prints and nothing throws:
// the JS pass has already written `dist/`, so the run leaves a dist with
// `index.js` / `index.mjs` / maps and ZERO `.d.ts` files, and reports success.
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
      '  `error` and no `exit` handler. A worker that dies (OOM under memory pressure\n' +
      '  is the observed one) posts neither "success" nor "error", so the promise never\n' +
      '  settles, the event loop drains, and node exits 0 with the JS already written.\n' +
      '\n  This guard is what stops that exit 0 from becoming a CACHED artifact: turbo\n' +
      '  caches only successful tasks, and a skip-DTS run already hashes differently,\n' +
      '  so failing here keeps a DTS-less dist from ever being served as a full build.\n' +
      '\n  Re-run the build. If it keeps failing here, build with more headroom:\n' +
      '    NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter <pkg> build\n' +
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
function selfTest() {
  const failures = [];
  const eq = (label, actual, expected) => {
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

  if (failures.length > 0) {
    console.error(`\nx check-dts-emitted self-test: ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  - ${f}\n`);
    return 1;
  }
  console.log('check-dts-emitted self-test: all assertions passed.');
  return 0;
}

// Behind the entrypoint guard: this module exports its two predicates so they
// can be unit-tested and reused, and an unguarded `process.exit` here would end
// any importer mid-import -- with status 0 on the healthy path, so the importer
// would read it as success. That is the same "exit 0 means nothing went wrong"
// failure this guard exists to catch, one level up.
if (isEntrypoint(import.meta.url)) {
  const isSelfTest = process.argv.includes('--self-test');
  process.exit(isSelfTest ? selfTest() : run(process.cwd()));
}
