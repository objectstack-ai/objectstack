#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check:console-injection — re-ask the spec-injection question about a console
 * dist that was RESTORED FROM CACHE rather than built.
 *
 * ## The hole this closes (objectstack#9667)
 *
 * The vendored Console SPA is cached under
 *
 *     ${{ runner.os }}-console-dist-${{ hashFiles('.objectui-sha', 'scripts/build-console.sh') }}
 *
 * spelled identically in ci.yml (twice: restore + save) and release.yml. The key
 * does NOT include packages/spec, so a dist built while spec was at state X is
 * restored and reused after spec moves on — and because
 * scripts/assert-console-spec-injection.mjs runs INSIDE build-console.sh, a
 * cache hit skips the entire build step and therefore skips the assertion too.
 * The injection fixed resolution; the cache could still serve a console whose
 * bundled spec is not the one this build proved.
 *
 * Adding packages/spec to the cache key was considered and REJECTED: it busts
 * the key on every spec change and forces a full cold console rebuild (~20 min,
 * measured) on a repo doing ~18 merges a day. The cache's economics — including
 * ci.yml's deliberate split restore/save, which exists so a failed build never
 * poisons the entry — are kept exactly as they are. Only the silent half is
 * removed: this gate runs on every console-job run, cache hit or miss.
 *
 * ## Why it replays a STAMP instead of re-deriving probes
 *
 * assert-console-spec-injection.mjs derives its two probes from the two specs on
 * disk — this tree's packages/spec, and the published @objectstack/spec that
 * objectui's own lockfile installs. On a cache hit the second one DOES NOT
 * EXIST: no objectui clone, no node_modules, nothing to compare against. So that
 * script cannot simply be re-run here, and a version of it that fetched the
 * published spec would put a network round-trip on every PR.
 *
 * Instead the build stamps the probes it chose into
 * `<dist>/.objectstack-injection.json`, and this gate replays them against the
 * restored bundle. Cost: one node process reading files already on disk.
 *
 * ## The stamped probes are checked for EXPIRY, not trusted forever
 *
 * A frozen probe is exactly the failure objectstack#8134 was filed about: #7804's
 * `describe()` text ended up carried by the published 17.0.0 too, so grepping for
 * it matched before AND after and proved nothing. A stale detector is only
 * evidence while it still tells the two specs apart, so this gate re-checks that
 * the stamped detector is STILL ABSENT from this tree's spec. Once the published
 * spec catches up, the stamp is expired and says so instead of passing.
 *
 * ## Failure response: FAIL, deliberately, rather than rebuild
 *
 * GitHub Actions cache keys are IMMUTABLE. A gate that reacted to a bad restore
 * by rebuilding could not evict the offending entry, so the next run would
 * restore it and rebuild again — a ~20 min rebuild on every run until the pin
 * moves, which is strictly worse than the cost that got the cache-key option
 * rejected. Failing once, with the eviction command spelled out, is the cheaper
 * and more honest response. Every failure below names its remedy.
 *
 * Exit codes:
 *   0  verified; or no dist to verify; or an unstamped dist without --require-stamp
 *   1  the restored dist is not one this repo can vouch for (see the message)
 *   2  cannot run (unreadable assets, malformed stamp)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ProbeError,
  STAMP_BASENAME,
  describeCandidates,
  pickProbe,
  readBundle,
  readSpecBlob,
  readStamp,
} from './console-spec-probes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * How an operator clears a cached dist this gate refused.
 *
 * ⛔ The `gh cache delete` line is MAINTAINER-ONLY — it needs repo write scope,
 * and it deletes an entry shared by ci.yml and release.yml. It is named anyway
 * because ruling out a remedy an operator cannot discover is how a red becomes
 * noise; a contributor who cannot run it should hand this message to a
 * maintainer rather than guess.
 */
function remedy(cacheKey) {
  const key = cacheKey || '${{ runner.os }}-console-dist-${{ hashFiles(\'.objectui-sha\', \'scripts/build-console.sh\') }}';
  return [
    '  How to clear this:',
    '',
    '    • Locally — rebuild the console at the pinned SHA:',
    '',
    '          pnpm objectui:build',
    '',
    '    • In CI — the restored artifact is a CACHE ENTRY, not anything in this PR.',
    "      Nothing in the diff can fix it; the entry has to go. ⛔ MAINTAINER-ONLY:",
    '',
    `          gh cache delete "${key}"`,
    '',
    '      then re-run the Console Pin Gate job. The next run misses, rebuilds,',
    '      and re-stamps.',
  ];
}

/**
 * The one evaluation path. `main()` and `--self-test` both go through here, so
 * the self-test exercises the real logic rather than a parallel imitation.
 *
 * Returns `{ code, out, err }` instead of printing, so the self-test can assert
 * on verdicts without capturing stdout.
 */
export function evaluate({ distDir, specDir, requireStamp = false, cacheKey = '' }) {
  const out = [];
  const err = [];
  const rel = (p) => path.relative(ROOT, p) || p;

  const index = path.join(distDir, 'index.html');
  if (!fs.existsSync(index)) {
    // Published installs and package-only CI legitimately have no dist. Same
    // policy as check:console-sha — but --require-stamp callers have already
    // asserted a dist is present and a missing one means the restore broke.
    if (requireStamp) {
      err.push(`✗ No console dist at ${rel(distDir)} — nothing to verify, but a dist was required.`);
      return { code: 1, out, err };
    }
    out.push(`ℹ No console dist at ${rel(distDir)} — skipping injection check. Build it with: pnpm objectui:build`);
    return { code: 0, out, err };
  }

  let stamp;
  let bundle;
  try {
    stamp = readStamp(distDir);
    bundle = readBundle(path.join(distDir, 'assets'));
  } catch (error) {
    if (!(error instanceof ProbeError)) throw error;
    err.push(`✗ check:console-injection cannot run: ${error.message}`);
    return { code: 2, out, err };
  }

  if (!stamp) {
    // A dist built by a build-console.sh that predates the stamp, assembled by
    // hand, or — the case that matters — written by a run that never reached the
    // assertion. Unprovable either way.
    const lines = [
      `⚠ Console dist at ${rel(distDir)} carries no ${STAMP_BASENAME} stamp,`,
      '  so whether it bundles THIS tree\'s @objectstack/spec cannot be verified.',
    ];
    if (!requireStamp) {
      lines.push('  Rebuild once to enable the guard:  pnpm objectui:build');
      out.push(...lines);
      return { code: 0, out, err };
    }
    err.push(
      `✗ Console dist at ${rel(distDir)} carries no ${STAMP_BASENAME} stamp.`,
      '  This job consumes a dist that may have been RESTORED FROM CACHE, and an',
      '  unstamped dist is one no build ever proved the spec injection for —',
      '  including a dist saved by a run that failed before the assertion.',
      '',
      ...remedy(cacheKey),
    );
    return { code: 1, out, err };
  }

  // The tree's own spec, for the expiry re-check. Absent when spec is not built
  // — a real state for a bare checkout, and not a reason to fail: the bundle
  // assertions below stand on their own.
  let treeBlob = null;
  let treeBlobNote = '';
  try {
    treeBlob = readSpecBlob(specDir, 'this tree\'s');
  } catch (error) {
    if (!(error instanceof ProbeError)) throw error;
    treeBlobNote = error.message;
  }

  let asserted = 0;
  for (const entry of stamp.packages) {
    const name = entry?.name || '<unnamed>';

    if (!entry?.skew) {
      out.push(`ℹ ${name}: the build recorded no observable skew between the injected and`);
      out.push('  published spec, so there is no probe that could tell them apart.');
      continue;
    }

    const { freshWitness, staleDetector } = entry;

    if (staleDetector && bundle.includes(staleDetector)) {
      err.push(
        `✗ The console dist carries the PUBLISHED ${name}, not this tree's.`,
        '',
        '  This dist was RESTORED FROM CACHE or built without the injection. Any',
        '  authorable key the framework declared after the last spec publish is',
        '  unreachable in the Studio designer — the defect objectstack#8134 exists',
        '  to end, reaching main one layer out through the cache.',
        '',
        '  Text in the bundle that only the PUBLISHED spec has:',
        `    "${staleDetector}"`,
        '',
        ...remedy(cacheKey),
      );
      return { code: 1, out, err };
    }

    if (freshWitness && !bundle.includes(freshWitness)) {
      err.push(
        `✗ The console dist does not carry the ${name} content its own stamp records.`,
        '',
        '  The stamp was written beside this dist by the build that produced it, so',
        '  the witness below MUST be in these assets. It is not — the artifact and',
        '  its stamp disagree, which means a partial cache restore or a dist that',
        '  was modified after it was proved.',
        '',
        '  Expected in the bundle (from the stamp):',
        `    "${freshWitness}"`,
        '',
        ...remedy(cacheKey),
      );
      return { code: 1, out, err };
    }

    // Expiry. A stale detector is evidence only while it still separates the two
    // specs; once this tree's spec also contains it, a bundle that "passes" is
    // proving nothing at all.
    if (staleDetector && treeBlob && treeBlob.includes(staleDetector)) {
      err.push(
        `✗ The stamped staleness probe for ${name} has EXPIRED.`,
        '',
        '  The probe is text that used to exist ONLY in the published spec. This',
        "  tree's spec now contains it too, so a bundle carrying it is no longer",
        '  distinguishable from one carrying the injected spec. The check would',
        '  pass from here on while proving nothing — the silent pass this gate',
        '  exists to prevent, so it reports the expiry instead.',
        '',
        '  Expired probe:',
        `    "${staleDetector}"`,
        '',
        '  The dist itself is not known to be bad. It is UNVERIFIABLE, and a fresh',
        '  build re-derives a probe that discriminates again.',
        '',
        ...remedy(cacheKey),
      );
      return { code: 1, out, err };
    }

    asserted += 1;
    out.push(`✓ ${name}: the dist carries this tree's copy, and not the published one.`);
    if (freshWitness) out.push(`    present (injected only): "${freshWitness}"`);
    if (staleDetector) out.push(`    absent  (published only): "${staleDetector}"`);
  }

  if (treeBlobNote && asserted > 0) {
    out.push(`ℹ Probe expiry not re-checked: ${treeBlobNote}`);
    out.push('  (build the spec — `pnpm --filter @objectstack/spec build` — to enable it)');
  }

  if (asserted === 0) {
    out.push('ℹ Nothing assertable in this stamp; the dist was not contradicted.');
  }

  return { code: 0, out, err };
}

// ── self-test ────────────────────────────────────────────────────────────────

function tmpdir(name) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.RUNNER_TEMP || '/tmp'), `${name}-`));
  return dir;
}

/** A minimal package whose exports map resolves to one built ESM file. */
function makeSpecPkg(dir, descriptions) {
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: '@objectstack/spec',
      exports: { '.': { import: { types: './dist/index.d.mts', default: './dist/index.mjs' } } },
    }),
  );
  const body = descriptions.map((d) => `z.string().describe(${JSON.stringify(d)})`).join(';\n');
  fs.writeFileSync(path.join(dir, 'dist', 'index.mjs'), `${body}\n`);
  return dir;
}

/** A minimal console dist: index.html, one JS asset, optionally a stamp. */
function makeDist(dir, assetText, stamp) {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), assetText);
  if (stamp !== undefined) {
    fs.writeFileSync(path.join(dir, STAMP_BASENAME), typeof stamp === 'string' ? stamp : JSON.stringify(stamp));
  }
  return dir;
}

const FRESH = 'Authorable key this tree declares and the registry reads';
const STALE = 'Published description that only the vendored spec carries';

function stampFor({ skew = true, freshWitness = FRESH, staleDetector = STALE } = {}) {
  return {
    stampVersion: 1,
    generatedBy: 'scripts/assert-console-spec-injection.mjs',
    packages: [{ name: '@objectstack/spec', injectedFrom: '/x/packages/spec', skew, freshWitness, staleDetector }],
  };
}

function selfTest() {
  const failures = [];
  let checked = 0;
  const root = tmpdir('check-console-injection');

  const expect = (label, actual, wanted) => {
    checked += 1;
    if (actual !== wanted) failures.push(`${label}: expected ${wanted}, got ${actual}`);
  };

  const specDir = makeSpecPkg(path.join(root, 'spec-ahead'), [FRESH, 'A shared description both specs carry always']);

  // 1. Clean pass: fresh witness in the bundle, stale detector nowhere.
  {
    const dist = makeDist(path.join(root, 'ok'), `console(${JSON.stringify(FRESH)})`, stampFor());
    expect('clean pass', evaluate({ distDir: dist, specDir }).code, 0);
  }

  // 2. THE DEFECT: the restored bundle carries the published spec.
  //
  // The fixture carries BOTH probes on purpose. A bundle holding only the
  // published text also trips the missing-fresh-witness branch below, so a
  // fixture like that proves nothing about THIS branch — asserting the exit code
  // alone passed with the stale-detector check deleted, which is how this case
  // was found to be vacuous. Both strings present is also the real shape: the
  // console bundle holds a second, transitive copy of this tree's spec via the
  // injected client, which is exactly why the check is two-sided.
  {
    const dist = makeDist(
      path.join(root, 'stale'),
      `console(${JSON.stringify(FRESH)});console(${JSON.stringify(STALE)})`,
      stampFor(),
    );
    const r = evaluate({ distDir: dist, specDir, cacheKey: 'Linux-console-dist-deadbeef' });
    expect('published spec in bundle fails', r.code, 1);
    const text = r.err.join('\n');
    checked += 1;
    // Branch-unique wording, not the shared remedy block: every failure path
    // prints remedy(), so keying on it cannot tell the branches apart.
    if (!text.includes('carries the PUBLISHED')) {
      failures.push('published-spec failure must say the dist carries the published spec');
    }
    checked += 1;
    if (!text.includes('gh cache delete "Linux-console-dist-deadbeef"')) {
      failures.push('published-spec failure must name the exact cache key to delete');
    }
  }

  // 3. Partial restore: the stamp's own witness is missing from the assets.
  {
    const dist = makeDist(path.join(root, 'partial'), 'console("unrelated bundle text")', stampFor());
    const r = evaluate({ distDir: dist, specDir });
    expect('missing fresh witness fails', r.code, 1);
    checked += 1;
    if (!r.err.join('\n').includes('does not carry the @objectstack/spec content its own stamp records')) {
      failures.push('missing-witness failure must name the stamp/artifact disagreement');
    }
  }

  // 4. Probe expiry: this tree's spec now carries the stale detector too.
  {
    const caught = makeSpecPkg(path.join(root, 'spec-caught-up'), [FRESH, STALE]);
    const dist = makeDist(path.join(root, 'expired'), `console(${JSON.stringify(FRESH)})`, stampFor());
    const r = evaluate({ distDir: dist, specDir: caught });
    expect('expired probe fails', r.code, 1);
    checked += 1;
    if (!r.err.join('\n').includes('EXPIRED')) failures.push('expiry failure must say the probe expired');
  }

  // 5/6. Unstamped dist: advisory by default, fatal under --require-stamp.
  {
    const dist = makeDist(path.join(root, 'unstamped'), `console(${JSON.stringify(FRESH)})`, undefined);
    expect('unstamped is advisory', evaluate({ distDir: dist, specDir }).code, 0);
    expect('unstamped is fatal when required', evaluate({ distDir: dist, specDir, requireStamp: true }).code, 1);
  }

  // 7. No dist at all: nothing to verify, unless one was required.
  {
    const dist = path.join(root, 'absent');
    expect('no dist passes', evaluate({ distDir: dist, specDir }).code, 0);
    expect('no dist fails when required', evaluate({ distDir: dist, specDir, requireStamp: true }).code, 1);
  }

  // 8. A build that found no skew records it, and this gate says so honestly.
  {
    const dist = makeDist(
      path.join(root, 'noskew'),
      'console("anything")',
      stampFor({ skew: false, freshWitness: null, staleDetector: null }),
    );
    const r = evaluate({ distDir: dist, specDir });
    expect('no-skew stamp passes', r.code, 0);
    checked += 1;
    if (!r.out.join('\n').includes('no observable skew')) failures.push('no-skew stamp must say so');
  }

  // 9/10. A stamp that cannot be trusted is inconclusive, never a quiet pass.
  {
    const bad = makeDist(path.join(root, 'malformed'), 'console("x")', '{not json');
    expect('malformed stamp is inconclusive', evaluate({ distDir: bad, specDir }).code, 2);
    const old = makeDist(path.join(root, 'oldversion'), 'console("x")', { stampVersion: 0, packages: [] });
    expect('wrong stampVersion is inconclusive', evaluate({ distDir: old, specDir }).code, 2);
  }

  // 11. Substring safety, the property the whole probe scheme rests on: a
  //     reworded description makes the OLD text a PREFIX of the new one, and a
  //     set-difference check would call it unique. pickProbe must not.
  {
    checked += 1;
    const oldText = 'The label shown above the field in forms';
    const newText = `${oldText} and in the record detail header`;
    const reworded = pickProbe(describeCandidates(`x.describe(${JSON.stringify(oldText)})`), `y.describe(${JSON.stringify(newText)})`);
    if (reworded !== null) {
      failures.push(`pickProbe returned a prefix of a reworded string as unique: ${JSON.stringify(reworded)}`);
    }
    checked += 1;
    const genuine = pickProbe(describeCandidates(`x.describe(${JSON.stringify(FRESH)})`), `y.describe(${JSON.stringify(newText)})`);
    if (genuine !== FRESH) failures.push('pickProbe failed to find a genuinely unique candidate');
  }

  // 12. ROUND TRIP against the real assert script: whatever it stamps, this gate
  //     must accept. This is the drift the shared module exists to prevent, and
  //     the only assertion here that proves the two halves still agree.
  {
    const injected = makeSpecPkg(path.join(root, 'rt-injected'), [FRESH, 'Shared text in both specs for the round trip']);
    const vendored = makeSpecPkg(path.join(root, 'rt-vendored'), [STALE, 'Shared text in both specs for the round trip']);
    const dist = makeDist(path.join(root, 'rt-dist'), `console(${JSON.stringify(FRESH)})`, undefined);
    const assert = path.join(ROOT, 'scripts', 'assert-console-spec-injection.mjs');
    const run = spawnSync(
      process.execPath,
      [assert, '--injected', injected, '--vendored', vendored, '--assets', path.join(dist, 'assets')],
      { encoding: 'utf8' },
    );
    expect('assert script passes on a good fixture', run.status, 0);
    checked += 1;
    if (!fs.existsSync(path.join(dist, STAMP_BASENAME))) {
      failures.push('assert script did not write the injection stamp');
    } else {
      expect('round trip: this gate accepts the stamp the assert script wrote', evaluate({ distDir: dist, specDir: injected }).code, 0);
    }
  }

  fs.rmSync(root, { recursive: true, force: true });

  if (failures.length > 0) {
    console.error(`✗ check-console-injection --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`    ${f}`);
    process.exit(1);
  }
  console.log(`✓ check-console-injection --self-test: ${checked} assertions over real fixture trees (real evaluate() path)`);
}

// ── entry point ──────────────────────────────────────────────────────────────

// Guarded so `evaluate` is genuinely importable. Without this, `import`ing this
// module RUNS the CLI — it would evaluate the default dist path and call
// process.exit() before the importer's first line, which is what the assert
// script's top-level-argv shape does and the reason probe derivation was moved
// into a side-effect-free module. Measured here: the first attempt to drive
// evaluate() from a script exited 0 with "no console dist" and never reached the
// caller's code.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose evaluate() and do nothing else
} else if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const argOf = (flag, fallback) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const result = evaluate({
    distDir: path.resolve(argOf('--dist', path.join(ROOT, 'packages', 'console', 'dist'))),
    specDir: path.resolve(argOf('--spec', path.join(ROOT, 'packages', 'spec'))),
    requireStamp: process.argv.includes('--require-stamp'),
    cacheKey: process.env.CONSOLE_DIST_CACHE_KEY || '',
  });
  for (const line of result.out) console.log(line);
  if (result.err.length > 0) console.error(`\n${result.err.join('\n')}\n`);
  process.exit(result.code);
}
