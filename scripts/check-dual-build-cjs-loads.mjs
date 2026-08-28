#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-dual-build-cjs-loads -- every published `require` entry point must
 * actually load.
 *
 *   node scripts/check-dual-build-cjs-loads.mjs              # the gate
 *   node scripts/check-dual-build-cjs-loads.mjs --list       # every entry it found
 *   node scripts/check-dual-build-cjs-loads.mjs --self-test  # verify the checker
 *
 * ## The bug it exists to prevent (#12971)
 *
 * `@objectstack/metadata-core` declares `"type": "module"` with a dual
 * `exports` map, so `require('@objectstack/metadata-core')` is a published,
 * supported entry point. #12843 added `createRequire(import.meta.url)` to one
 * source file -- correct for the ESM output, and written with a `try`/`catch`
 * around it and a comment reasoning that the CJS build would see `undefined`
 * there. tsup does not rewrite the identifier: at this build `target` esbuild
 * emits `import.meta` VERBATIM into `dist/index.cjs`, and outside an ES module
 * that is a PARSE-time error. The module therefore never begins executing --
 * so neither the `typeof require === 'function'` fast path above it nor the
 * `catch` around it ever runs, and the package's WHOLE `require` condition is
 * unloadable, for every consumer and every code path:
 *
 *   $ node -e "require('./dist/index.cjs')"
 *   SyntaxError: Cannot use 'import.meta' outside a module
 *
 * Downstream (measured in `objectstack-ai/cloud`): `@objectstack/organizations`
 * resolves through that condition, fails to load, and the ADR-0093 D5
 * fail-closed tenancy wall then correctly refuses to boot the walled EE
 * runtime -- reddening cloud's only required check. One line in one source
 * file, one release away from every CJS consumer of the package.
 *
 * Two properties make this class invisible without a gate, and they are why
 * this is a gate rather than a fixed line:
 *
 *   1. **The repo's own tests never see it.** vitest resolves workspace
 *      packages through the `import` condition (and often through source
 *      aliases), so every suite stays green while the `require` half is
 *      rubble. `pnpm build` is green too -- the bytes emit fine, they just
 *      cannot be parsed by the runtime they are declared for.
 *   2. **The author cannot see it either.** The two sibling packages that hit
 *      this before (`packages/runtime` #10993, `packages/metadata-protocol`
 *      #11235) each carry a long `shims: true` comment in their tsup config
 *      warning the next author -- and the next author was in a THIRD package
 *      that had no such comment, because there is nothing to read a comment
 *      in a file you never open.
 *
 * ## What it checks, per published `require` entry point
 *
 *   PARSES   every CommonJS file the package emits (`dist/**\/*.cjs`, plus
 *            `*.js` when the manifest is not `"type": "module"`) parses as
 *            CommonJS. This is the #12971 class, and it is checked over the
 *            whole emitted set rather than the entry alone because code
 *            splitting puts the offending line in a shared chunk as easily as
 *            in `index.cjs`.
 *   LOADS    `require(<entry>)` in a fresh child process completes.
 *   AGREES   for the entries a probe is declared on
 *            (`DUAL_FORMAT_BEHAVIOUR_PROBES` below), the same exported call
 *            answers the same value through the `require` and the `import`
 *            condition, and that value is the declared one. Loading is not
 *            agreement, and the #12971 repair works by making the CJS output
 *            resolve the SAME anchor -- so agreement is the property a
 *            regression would actually break, quietly.
 *
 * ## Why BOTH, when either alone would have caught #12971
 *
 * They fail differently and neither subsumes the other. A parse check is total
 * -- it reads every emitted byte, including chunks no entry happens to pull in
 * on the day it runs -- but it says nothing about a module that parses and
 * then throws at load. A `require()` smoke is the real question a consumer
 * asks, but it only ever reaches the graph the entry actually imports. Running
 * both costs one extra spawn per file and removes the "gate was green, package
 * still broken" answer from both directions.
 *
 * ## The ledger, and the one thing it may never silence
 *
 * `scripts/dual-build-cjs-loads.baseline.json` is a shrink-only, hand-edited
 * list of entries that legitimately cannot be `require()`d, each with a
 * reason. It exists because a `require` condition can be unloadable for a
 * cause that is not ours at all: `@objectstack/metadata-core`'s `./testing`
 * subpath and `@objectstack/service-cluster`'s re-export vitest, and vitest
 * REFUSES to be required from CommonJS by design ("Vitest cannot be imported
 * in a CommonJS module using require()"). That is a real declared-but-unusable
 * entry point -- a separate defect from this one, filed rather than fixed here
 * -- and pretending the gate is green over it would be the lie this file
 * exists to stop.
 *
 * ⛔ **A SyntaxError is never ledgerable.** The ledger accepts a load-time
 * failure only; an entry whose emitted bytes do not PARSE is refused with a
 * pointer back to the shim, whatever the ledger says. That asymmetry is the
 * whole gate: a runtime load failure is a fact about a dependency, a parse
 * failure is always a fact about what WE emitted. Pinned in `--self-test`.
 *
 * The ledger reconciles in both directions -- an entry that now loads must be
 * deleted in the same PR that fixes it, so a stale exemption is an error
 * rather than dead text.
 *
 * ## Where it runs, and why not in the lint job
 *
 * It needs a real `dist/`, so it is a step in **Build Core** (ci.yml), beside
 * "Verify capability packages ship a runtime entry" and "No compiled test
 * files in any dist" -- the same genre, the same phase, and a required
 * context. With no `dist/` it exits 3 (`PREREQUISITE NOT MET`) naming
 * `pnpm build`; ⛔ it never degrades to a silent green (Route & surface
 * ownership §3: a verifier that quietly skips is worse than none).
 *
 * It is the DYNAMIC half of a pair. `scripts/check-published-files.mjs` owns
 * the static half -- that the manifest's declared paths are whitelisted for
 * npm -- and cannot know whether the bytes at those paths load. Same split as
 * `check-override-consistency.mjs` (static) beside `publish-smoke.sh`
 * (dynamic); the publish smoke does not cover this because the project it
 * scaffolds is ESM and never calls `require()`.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SCAN_ROOT = 'packages';
const BASELINE_PATH = 'scripts/dual-build-cjs-loads.baseline.json';

/**
 * ## The dispatch-gates declaration -- the `ROOT_DIR_WATCH_HINTS` idiom
 *
 * `scripts/pm/dispatch-gates.mjs` derives WHICH gates a card owes by matching
 * path literals in a gate's source against the card's changed files. `SCAN_ROOT`
 * above is a bare single-segment word, which `hintCovers` refuses as too
 * generic, and the population sentence lives in prose the hint extractor masks
 * by design -- so without this declaration the gate would be invisible to the
 * derivation for every card in the tree, including the one shape it exists to
 * catch.
 *
 * Three literals, because three different edits move this gate's verdict and
 * no narrower set is complete:
 *
 *   `packages/**\/package.json`    declares the `require` condition -- adding
 *                                  one puts a new entry into the population.
 *   `packages/**\/tsup.config.ts`  decides the emitted bytes; DROPPING
 *                                  `shims: true` is how a fixed package
 *                                  regresses, and it is a one-line edit that
 *                                  touches no source file at all.
 *   `packages/**\/src/**`          #12843 arrived here and nowhere else: one
 *                                  source line, no manifest change, no config
 *                                  change. A declaration that omitted this
 *                                  would be precise and USELESS -- silent for
 *                                  exactly the change kind that motivated it.
 *
 * ⛔ Spelled as LITERALS, never built from `SCAN_ROOT` -- the extractor reads
 * source text, so a computed template would produce no hint and leave the gate
 * as invisible as no declaration at all. Pinned in `--self-test`.
 */
const ROOT_DIR_WATCH_HINTS = ['packages/**/package.json', 'packages/**/tsup.config.ts', 'packages/**/src/**'];

/**
 * ## AGREES -- the third invariant, and the one loading alone cannot give you
 *
 * A dual build has two outputs of one source, and "both load" is a weaker
 * claim than "both behave the same". #12971's fix works by making the CJS
 * output derive a REAL module URL rather than carrying `import.meta` verbatim,
 * so the thing actually at risk on a regression is not loadability but
 * AGREEMENT: a shim that resolved to the wrong anchor would load fine and
 * quietly answer `null` where the ESM build answers a version — and `null` is
 * a legal value here (`resolveInstalledSpecVersion()` returning it closes the
 * ADR-0087 forward-conversion window), so the whole degradation is silent.
 *
 * Each probe names one export, an argument-free call, and the expected value,
 * evaluated in BOTH conditions of the same package and required to match each
 * other AND the expectation. Node evaluates the two in separate child
 * processes, so neither can borrow the other's module graph.
 *
 * ⛔ This lives here rather than in the package's vitest suite because it can
 * only be asked of BUILT output, and `Test Core` has none: turbo's `test` task
 * declares `dependsOn: ["^build"]` (dependencies only, never the package's own
 * dist) and explicitly excludes `dist/**` from its inputs, so a suite reading
 * its own `dist/` would be unbuilt in CI and un-invalidated by a rebuild —
 * the `check:cross-package-test-inputs` failure shape, one package over. The
 * package's own unit suite still covers the FUNCTION; what needs built bytes
 * is the cross-FORMAT claim, and this is where built bytes exist.
 *
 * @type {{pkg: string, subpath: string, export: string, expect: string, why: string}[]}
 */
const DUAL_FORMAT_BEHAVIOUR_PROBES = [
  {
    pkg: '@objectstack/metadata-core',
    subpath: '.',
    export: 'resolveInstalledSpecVersion',
    // The installed @objectstack/spec version, read from the workspace rather
    // than hard-coded, so the probe survives every release.
    expect: 'spec-version',
    why: "#12843's intent: the ADR-0087 forward-conversion window opens only on positive version evidence, and #12971 was a broken attempt to obtain that evidence from the CJS build. Both formats must answer the installed spec version, not `null`.",
  },
];

const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_PREREQ = 3;

const PARSE_CONCURRENCY = 8;

// ---------------------------------------------------------------------------
// Population
// ---------------------------------------------------------------------------

/** Every `package.json` under `<root>/packages`, node_modules and dist pruned. */
export function manifestPaths(root) {
  const out = [];
  const start = join(root, SCAN_ROOT);
  if (!existsSync(start)) return out;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.turbo') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'package.json') out.push(p);
    }
  };
  walk(start);
  return out.sort();
}

/**
 * Resolve one `exports` value the way node resolves it under the `require`
 * condition: descend condition objects taking `require` / `node` / `default`,
 * never `import`, `browser` or `module`.
 *
 * The nesting matters and is easy to get wrong: `@objectstack/spec` spells its
 * entry `{"require": {"types": "...", "default": "./dist/index.js"}}`, so the
 * string lives one level BELOW the `require` key. A resolver that only accepts
 * a string directly under `require` silently drops every package spelled that
 * way -- measured while writing this gate: 19 of the 105 entries. Pinned in
 * `--self-test`.
 *
 * @param {unknown} node an `exports` subtree
 * @param {boolean} inRequire are we already inside a `require` condition?
 * @returns {string | null}
 */
export function resolveRequireTarget(node, inRequire = false) {
  if (typeof node === 'string') return inRequire ? node : null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = resolveRequireTarget(n, inRequire);
      if (r) return r;
    }
    return null;
  }
  if (node === null || typeof node !== 'object') return null;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'types' || k === 'import' || k === 'browser' || k === 'module' || k.startsWith('.')) continue;
    if (k === 'require') {
      const r = resolveRequireTarget(v, true);
      if (r) return r;
      continue;
    }
    if (k === 'node' || k === 'default') {
      const r = resolveRequireTarget(v, inRequire);
      if (r) return r;
    }
  }
  return null;
}

/**
 * The published `require` entry points of one manifest.
 *
 * @param {any} pkg parsed package.json
 * @returns {{subpath: string, target: string}[]}
 */
export function requireEntries(pkg) {
  const out = [];
  const ex = pkg?.exports;
  if (ex && typeof ex === 'object' && !Array.isArray(ex)) {
    const keys = Object.keys(ex);
    if (keys.some((k) => k.startsWith('.'))) {
      for (const [sub, v] of Object.entries(ex)) {
        if (!sub.startsWith('.') || sub.includes('*')) continue;
        const t = resolveRequireTarget(v);
        if (t) out.push({ subpath: sub, target: t });
      }
    } else {
      const t = resolveRequireTarget(ex);
      if (t) out.push({ subpath: '.', target: t });
    }
  } else if (!ex && typeof pkg?.main === 'string') {
    // No `exports` map: `main` IS the require entry point.
    out.push({ subpath: '(main)', target: pkg.main });
  }
  return out;
}

/**
 * The `import`-condition twin of one subpath, for the AGREES probe. Mirror of
 * `resolveRequireTarget` with the two condition names swapped.
 *
 * @returns {string | null}
 */
export function importTargetFor(pkg, subpath) {
  const pick = (node, inImport = false) => {
    if (typeof node === 'string') return inImport ? node : null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const r = pick(n, inImport);
        if (r) return r;
      }
      return null;
    }
    if (node === null || typeof node !== 'object') return null;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'types' || k === 'require' || k === 'browser' || k.startsWith('.')) continue;
      if (k === 'import' || k === 'module') {
        const r = pick(v, true);
        if (r) return r;
        continue;
      }
      if (k === 'node' || k === 'default') {
        const r = pick(v, inImport);
        if (r) return r;
      }
    }
    return null;
  };
  const ex = pkg?.exports;
  if (ex && typeof ex === 'object' && !Array.isArray(ex)) {
    const keys = Object.keys(ex);
    if (keys.some((k) => k.startsWith('.'))) return subpath in ex ? pick(ex[subpath]) : null;
    if (subpath === '.') return pick(ex);
  }
  return null;
}

/** Collect the whole population: one row per published `require` entry point. */
export function collectEntries(root) {
  const rows = [];
  for (const mp of manifestPaths(root)) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(mp, 'utf8'));
    } catch {
      continue;
    }
    if (!pkg?.name || pkg.private === true) continue;
    const dir = dirname(mp);
    for (const { subpath, target } of requireEntries(pkg)) {
      const importTarget = importTargetFor(pkg, subpath);
      rows.push({
        id: `${pkg.name}#${subpath}`,
        pkg: pkg.name,
        subpath,
        target,
        dir,
        relDir: relative(root, dir),
        abs: resolve(dir, target),
        importAbs: importTarget ? resolve(dir, importTarget) : null,
        isModuleType: pkg.type === 'module',
      });
    }
  }
  return rows;
}

/**
 * Every emitted file in `dir`'s tree that node parses as CommonJS: `.cjs`
 * always, `.js` only when the package is not `"type": "module"`.
 */
function commonJsFilesUnder(dir, isModuleType) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.cjs') || (e.name.endsWith('.js') && !isModuleType)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// Probes -- both run in child processes, so a hard crash is a finding, not a
// dead gate.
// ---------------------------------------------------------------------------

function run(args) {
  return new Promise((res) => {
    const c = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    let out = '';
    c.stderr.on('data', (d) => {
      err += d;
    });
    c.stdout.on('data', (d) => {
      out += d;
    });
    c.on('close', (code) => res({ code, err, out: out.trim() }));
    c.on('error', (e) => res({ code: 1, err: String(e), out: '' }));
  });
}

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const k = i++;
      if (k >= items.length) return;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** First `…Error: …` line of a node diagnostic, trimmed for a one-line report. */
export function firstErrorLine(stderr) {
  const line = String(stderr)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^[A-Za-z]*Error(:| )/.test(l));
  return (line || String(stderr).split('\n').find(Boolean) || 'unknown failure').slice(0, 200);
}

/** Does this diagnostic say the bytes failed to PARSE? Never ledgerable. */
export function isParseFailure(stderr) {
  return /\bSyntaxError\b/.test(String(stderr));
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{rows: any[], findings: string[], prereq: string[], ledgerHits: string[], staleLedger: string[], cjsFileCount: number, probesRun: number}>}
 */
export async function scan(root, ledger, probes = DUAL_FORMAT_BEHAVIOUR_PROBES) {
  const rows = collectEntries(root);
  const findings = [];
  const prereq = [];
  const ledgerHits = [];
  const staleLedger = [];
  let cjsFileCount = 0;

  for (const r of rows) {
    r.distDir = join(r.dir, 'dist');
    r.exists = existsSync(r.abs) && statSync(r.abs).isFile();
    if (!r.exists) {
      if (!existsSync(r.distDir)) prereq.push(`${r.id} -> ${r.target} (no ${relative(root, r.distDir)})`);
      else findings.push(`${r.id}: declared require target ${r.target} is NOT emitted, though ${relative(root, r.distDir)} exists — the manifest advertises an entry point npm would ship and node cannot resolve.`);
      continue;
    }
    r.cjsFiles = commonJsFilesUnder(r.distDir, r.isModuleType);
    cjsFileCount += r.cjsFiles.length;
  }
  if (prereq.length) return { rows, findings, prereq, ledgerHits, staleLedger, cjsFileCount, probesRun: 0 };

  // PARSES — over the union of emitted CommonJS files, deduped across the
  // several entries a package may declare.
  const parseTargets = [...new Set(rows.flatMap((r) => r.cjsFiles ?? []))].sort();
  const parseResults = await mapLimited(parseTargets, PARSE_CONCURRENCY, async (f) => ({ f, ...(await run(['--check', f])) }));
  const parseBad = new Map();
  for (const { f, code, err } of parseResults) if (code !== 0) parseBad.set(f, firstErrorLine(err));

  // LOADS — one fresh child per entry.
  const live = rows.filter((r) => r.exists);
  const loadResults = await mapLimited(live, PARSE_CONCURRENCY, async (r) => ({ r, ...(await run(['-e', `require(${JSON.stringify(r.abs)})`])) }));

  for (const { r, code, err } of loadResults) {
    const ownParseBad = (r.cjsFiles ?? []).filter((f) => parseBad.has(f));
    const ledgered = ledger[r.id];
    if (ownParseBad.length) {
      // ⛔ Never ledgerable — see the header. A parse failure is always about
      // bytes we emitted.
      for (const f of ownParseBad) {
        const hint = /import\.meta/.test(readFileSync(f, 'utf8'))
          ? " The output carries `import.meta`, which is a PARSE-time error outside an ES module — add `shims: true` to this package's tsup.config.ts (see packages/metadata-core, packages/runtime, packages/metadata-protocol)."
          : '';
        findings.push(`${r.id}: emitted CommonJS does NOT parse — ${relative(root, f)}: ${parseBad.get(f)}.${hint}${ledgered ? ` ⛔ ${BASELINE_PATH} carries an entry for this id; a parse failure is never ledgerable, so it is ignored here.` : ''}`);
      }
      continue;
    }
    if (code === 0) {
      if (ledgered) staleLedger.push(`${r.id} — ${BASELINE_PATH} says it cannot be required, but it loads. Delete the entry (the ledger is shrink-only).`);
      continue;
    }
    const line = firstErrorLine(err);
    if (ledgered) ledgerHits.push(`${r.id} — ${ledgered.reason}`);
    else findings.push(`${r.id}: require(${r.target}) FAILED — ${line}`);
  }

  // AGREES — the declared cross-format behaviour probes.
  const probeResults = await runBehaviourProbes(root, rows, probes);
  findings.push(...probeResults.findings);

  return { rows, findings, prereq, ledgerHits, staleLedger, cjsFileCount, probesRun: probeResults.ran };
}

/** Read the expectation a probe declares. Only `spec-version` exists today. */
function expectedValueFor(root, probe) {
  if (probe.expect === 'spec-version') {
    const p = join(root, SCAN_ROOT, 'spec', 'package.json');
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')).version ?? null;
  }
  return probe.expect;
}

/**
 * Evaluate each declared probe's export in BOTH conditions, in two separate
 * child processes, and require the two answers to match each other and the
 * expectation.
 */
export async function runBehaviourProbes(root, rows, probes = DUAL_FORMAT_BEHAVIOUR_PROBES) {
  const findings = [];
  let ran = 0;
  for (const probe of probes) {
    const row = rows.find((r) => r.pkg === probe.pkg && r.subpath === probe.subpath);
    if (!row) {
      findings.push(`behaviour probe ${probe.pkg}#${probe.subpath} names an entry point that no longer exists — delete or repoint the probe (it is asserting nothing).`);
      continue;
    }
    if (!row.importAbs || !existsSync(row.importAbs)) {
      findings.push(`behaviour probe ${probe.pkg}#${probe.subpath}: no resolvable \`import\` condition to compare against — a cross-format claim needs both formats.`);
      continue;
    }
    const expected = expectedValueFor(root, probe);
    if (expected === null || expected === undefined) {
      findings.push(`behaviour probe ${probe.pkg}#${probe.subpath}: could not read the expectation '${probe.expect}' — ⛔ NOT a pass, nothing was compared.`);
      continue;
    }
    const call = `String(m[${JSON.stringify(probe.export)}]())`;
    const cjs = await run(['-e', `const m = require(${JSON.stringify(row.abs)}); process.stdout.write(${call});`]);
    const esm = await run(['--input-type=module', '-e', `const m = await import(${JSON.stringify(row.importAbs)}); process.stdout.write(${call});`]);
    ran += 1;
    const label = `behaviour probe ${probe.pkg}#${probe.subpath} → ${probe.export}()`;
    if (cjs.code !== 0) findings.push(`${label}: the require condition threw — ${firstErrorLine(cjs.err)}. ${probe.why}`);
    else if (esm.code !== 0) findings.push(`${label}: the import condition threw — ${firstErrorLine(esm.err)}. ${probe.why}`);
    else if (cjs.out !== esm.out) findings.push(`${label}: the two formats DISAGREE — require said '${cjs.out}', import said '${esm.out}'. ${probe.why}`);
    else if (cjs.out !== String(expected)) findings.push(`${label}: both formats agree on '${cjs.out}', but the declared expectation is '${expected}'. ${probe.why}`);
  }
  return { findings, ran };
}

function readLedger(root) {
  const p = join(root, BASELINE_PATH);
  if (!existsSync(p)) return {};
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  return raw.entries ?? {};
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(argv) {
  const root = REPO_ROOT;
  const ledger = readLedger(root);
  const { rows, findings, prereq, ledgerHits, staleLedger, cjsFileCount, probesRun } = await scan(root, ledger);

  if (argv.includes('--list')) {
    for (const r of rows) console.log(`${r.id.padEnd(48)} ${r.target}`);
    console.log(`\n${rows.length} require entry point(s) across ${new Set(rows.map((r) => r.pkg)).size} publishable package(s).`);
    return EXIT_OK;
  }

  if (prereq.length) {
    console.error('PREREQUISITE NOT MET — this gate reads built output, and some package has no dist/.');
    for (const p of prereq.slice(0, 8)) console.error(`  · ${p}`);
    if (prereq.length > 8) console.error(`  · … ${prereq.length - 8} more`);
    console.error('Run `pnpm build` first. ⛔ This is NOT a pass: nothing was measured.');
    return EXIT_PREREQ;
  }

  const problems = [...findings, ...staleLedger];
  if (problems.length) {
    console.error(`✗ check:dual-build-cjs-loads — ${problems.length} finding(s) across ${rows.length} published require entry point(s):`);
    for (const f of problems) console.error(`  ✗ ${f}`);
    console.error('');
    console.error('A `require` condition in an exports map is a published promise. A consumer that');
    console.error('resolves through it gets a load failure, not a degraded feature — and the repo\'s');
    console.error('own suites cannot see it, because vitest resolves workspace packages through the');
    console.error('`import` condition.');
    return EXIT_FINDINGS;
  }

  console.log(
    `✓ check:dual-build-cjs-loads — ${rows.length} published require entry point(s) across ` +
      `${new Set(rows.map((r) => r.pkg)).size} package(s) load; ${cjsFileCount} emitted CommonJS file(s) parse; ` +
      `${probesRun} cross-format behaviour probe(s) agree` +
      (ledgerHits.length ? `; ${ledgerHits.length} declared non-loadable entr(ies) still justified.` : '.'),
  );
  for (const h of ledgerHits) console.log(`  · declared: ${h}`);
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Self-test -- a REAL fixture tree with REAL emitted bytes, spawned for real.
// A model of a CJS parse failure would pass against a gate that never spawns.
// ---------------------------------------------------------------------------

function writePkg(root, name, manifest, files) {
  const dir = join(root, SCAN_ROOT, name);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), body);
  }
  return dir;
}

export async function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });

  // ── the declaration itself ────────────────────────────────────────────────
  const selfSrc = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  t('the watch hints are spelled as literals the extractor can read', ROOT_DIR_WATCH_HINTS.every((h) => selfSrc.includes(`'${h}'`)));
  t('the watch hints cover the manifest, the tsup config AND the sources', ROOT_DIR_WATCH_HINTS.length === 3 && ROOT_DIR_WATCH_HINTS.every((h) => h.startsWith(`${SCAN_ROOT}/`)));
  t('no hint collapses to the bare scan root', !ROOT_DIR_WATCH_HINTS.some((h) => h.replace(/\/\*+$/, '') === SCAN_ROOT));

  // ── the exports resolver ──────────────────────────────────────────────────
  t('a plain string under `require` resolves', resolveRequireTarget({ types: './x.d.ts', import: './x.js', require: './x.cjs' }) === './x.cjs');
  t('a NESTED {types, default} under `require` resolves (the @objectstack/spec spelling)', resolveRequireTarget({ import: { types: './a.d.mts', default: './a.mjs' }, require: { types: './a.d.ts', default: './a.js' } }) === './a.js');
  t('an `import`-only entry contributes nothing', resolveRequireTarget({ types: './x.d.ts', import: './x.js' }) === null);
  t('a bare `default` string outside any `require` is not a require target', resolveRequireTarget({ default: './x.js' }) === null);
  t('`browser` is never taken', resolveRequireTarget({ browser: { require: './b.js' }, require: './n.cjs' }) === './n.cjs');
  t('a subpath map yields one row per subpath', requireEntries({ exports: { '.': { require: './i.cjs' }, './t': { require: './t.cjs' }, './e': { import: './e.js' } } }).length === 2);
  t('a manifest with no exports falls back to `main`', requireEntries({ main: 'dist/index.js' })[0]?.target === 'dist/index.js');
  t('a wildcard subpath is skipped (no single file to probe)', requireEntries({ exports: { './x/*': { require: './x/*.cjs' } } }).length === 0);

  // ── diagnostics classification ────────────────────────────────────────────
  t('a SyntaxError diagnostic is a parse failure', isParseFailure("foo.cjs:1\nSyntaxError: Cannot use 'import.meta' outside a module"));
  t('a plain Error diagnostic is NOT a parse failure', !isParseFailure('Error: Vitest cannot be imported in a CommonJS module using require().'));
  t('firstErrorLine picks the error, not the source echo', firstErrorLine("dist/index.cjs:810\n  const x = import.meta.url\nSyntaxError: Cannot use 'import.meta' outside a module") === "SyntaxError: Cannot use 'import.meta' outside a module");

  // ── the fixture tree ──────────────────────────────────────────────────────
  const root = mkdtempSync(join(tmpdir(), 'dual-cjs-'));
  try {
    const dual = { type: 'module', exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js', require: './dist/index.cjs' } } };

    writePkg(root, 'good', { name: '@t/good', version: '0.0.0', ...dual }, {
      'dist/index.js': 'export const ok = 1;\n',
      'dist/index.cjs': 'exports.ok = 1;\n',
    });
    // THE case: `import.meta` verbatim in a CJS output — #12971 exactly.
    writePkg(root, 'importmeta', { name: '@t/importmeta', version: '0.0.0', ...dual }, {
      'dist/index.js': 'export const u = import.meta.url;\n',
      'dist/index.cjs': 'exports.u = import.meta.url;\n',
    });
    // …and in a shared CHUNK the entry does not even reference, which a
    // require-only smoke would miss.
    writePkg(root, 'chunk', { name: '@t/chunk', version: '0.0.0', ...dual }, {
      'dist/index.js': 'export const ok = 1;\n',
      'dist/index.cjs': 'exports.ok = 1;\n',
      'dist/chunk-AAA.cjs': 'exports.u = import.meta.url;\n',
    });
    // Parses, then throws at load — the half a parse check cannot see.
    writePkg(root, 'throws', { name: '@t/throws', version: '0.0.0', ...dual }, {
      'dist/index.js': 'export const ok = 1;\n',
      'dist/index.cjs': "throw new Error('nope at load');\n",
    });
    writePkg(root, 'esmonly', { name: '@t/esmonly', version: '0.0.0', type: 'module', exports: { '.': { import: './dist/index.js' } } }, {
      'dist/index.js': 'export const ok = 1;\n',
    });

    const empty = {};
    const r1 = await scan(root, empty, []);
    t('a clean dual package is silent', !r1.findings.some((f) => f.includes('@t/good')), r1.findings.join(' | '));
    t('an ESM-only package is not in the population at all', !r1.rows.some((x) => x.pkg === '@t/esmonly'));
    t('THE case: `import.meta` in the CJS output is a finding', r1.findings.some((f) => f.startsWith('@t/importmeta#.') && /does NOT parse/.test(f)), r1.findings.join(' | '));
    t('…and the finding names the shim as the remedy', r1.findings.some((f) => f.includes('@t/importmeta') && f.includes('shims: true')));
    t('a poisoned CHUNK the entry never imports is still a finding', r1.findings.some((f) => f.startsWith('@t/chunk#.') && f.includes('chunk-AAA.cjs')), r1.findings.join(' | '));
    t('a module that parses and throws at load is a finding', r1.findings.some((f) => f.startsWith('@t/throws#.') && /require\(.*\) FAILED/.test(f)), r1.findings.join(' | '));
    t('the load finding carries the real message', r1.findings.some((f) => f.includes('nope at load')));

    // ── the ledger, both directions ───────────────────────────────────────────
    const withLedger = { '@t/throws#.': { reason: 'declared for the self-test' } };
    const r2 = await scan(root, withLedger, []);
    t('a ledgered load failure is declared, not a finding', !r2.findings.some((f) => f.startsWith('@t/throws#.')) && r2.ledgerHits.some((h) => h.startsWith('@t/throws#.')), JSON.stringify(r2.ledgerHits));
    const rNoHelp = await scan(root, { '@t/importmeta#.': { reason: 'should not help' } }, []);
    t('⛔ a ledger entry can NEVER silence a parse failure', rNoHelp.findings.some((f) => f.startsWith('@t/importmeta#.') && /does NOT parse/.test(f)));
    t('…and the gate SAYS the ledger was ignored', rNoHelp.findings.some((f) => f.includes('never ledgerable')));
    const r3 = await scan(root, { '@t/good#.': { reason: 'stale' } }, []);
    t('a ledger entry that now loads is a finding (shrink-only)', r3.staleLedger.some((s) => s.startsWith('@t/good#.')), JSON.stringify(r3.staleLedger));

    // ── AGREES: the cross-format behaviour probe, both directions ────────────
    writePkg(root, 'agree', { name: '@t/agree', version: '0.0.0', ...dual }, {
      'dist/index.js': "export const v = () => 'same';\n",
      'dist/index.cjs': "exports.v = () => 'same';\n",
    });
    // Loads in both formats, parses in both, and still disagrees — the silent
    // degradation a load smoke alone cannot see.
    writePkg(root, 'disagree', { name: '@t/disagree', version: '0.0.0', ...dual }, {
      'dist/index.js': "export const v = () => 'from-esm';\n",
      'dist/index.cjs': "exports.v = () => null;\n",
    });
    const agreeProbe = [{ pkg: '@t/agree', subpath: '.', export: 'v', expect: 'same', why: 'self-test' }];
    const disagreeProbe = [{ pkg: '@t/disagree', subpath: '.', export: 'v', expect: 'from-esm', why: 'self-test' }];
    const pOk = await scan(root, empty, agreeProbe);
    t('two agreeing formats pass the behaviour probe', !pOk.findings.some((f) => f.includes('@t/agree')) && pOk.probesRun === 1, pOk.findings.join(' | '));
    const pBad = await scan(root, empty, disagreeProbe);
    t('THE silent case: both formats load, both parse, and they DISAGREE → finding', pBad.findings.some((f) => f.includes('@t/disagree') && f.includes('DISAGREE')), pBad.findings.join(' | '));
    t('…and the finding quotes both answers', pBad.findings.some((f) => f.includes("'from-esm'") && f.includes("'null'")));
    const pWrong = await scan(root, empty, [{ pkg: '@t/agree', subpath: '.', export: 'v', expect: 'something-else', why: 'self-test' }]);
    t('agreement on the WRONG value is still a finding', pWrong.findings.some((f) => f.includes('@t/agree') && f.includes('declared expectation')), pWrong.findings.join(' | '));
    const pGone = await scan(root, empty, [{ pkg: '@t/no-such-package', subpath: '.', export: 'v', expect: 'x', why: 'self-test' }]);
    t('a probe naming a vanished entry point is a finding, not a silent skip', pGone.findings.some((f) => f.includes('no longer exists')), pGone.findings.join(' | '));

    // The shipped probe table must name entry points that really exist here.
    const realRows = collectEntries(REPO_ROOT);
    t('every shipped behaviour probe names a live require entry point', DUAL_FORMAT_BEHAVIOUR_PROBES.every((p) => realRows.some((r) => r.pkg === p.pkg && r.subpath === p.subpath)), JSON.stringify(DUAL_FORMAT_BEHAVIOUR_PROBES.map((p) => `${p.pkg}#${p.subpath}`)));
    t('every shipped behaviour probe states why it exists', DUAL_FORMAT_BEHAVIOUR_PROBES.every((p) => typeof p.why === 'string' && p.why.length > 20));

    // ── prerequisite, never a silent green ───────────────────────────────────
    const bare = mkdtempSync(join(tmpdir(), 'dual-cjs-bare-'));
    try {
      writePkg(bare, 'unbuilt', { name: '@t/unbuilt', version: '0.0.0', ...dual }, {});
      rmSync(join(bare, SCAN_ROOT, 'unbuilt', 'dist'), { recursive: true, force: true });
      const r4 = await scan(bare, empty, []);
      t('an unbuilt package is PREREQUISITE NOT MET, not a pass and not a finding', r4.prereq.length === 1 && r4.findings.length === 0, JSON.stringify(r4.prereq));
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }

    // ── a built tree missing one declared target IS a finding ────────────────
    const half = mkdtempSync(join(tmpdir(), 'dual-cjs-half-'));
    try {
      writePkg(half, 'half', { name: '@t/half', version: '0.0.0', ...dual }, { 'dist/index.js': 'export const ok = 1;\n' });
      const r5 = await scan(half, empty, []);
      t('a dist that exists but omits the declared require target is a finding', r5.prereq.length === 0 && r5.findings.some((f) => f.includes('NOT emitted')), JSON.stringify(r5));
    } finally {
      rmSync(half, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // ── the real ledger is well-formed and shrink-only in shape ───────────────
  const realLedger = readLedger(REPO_ROOT);
  t('every real ledger entry carries a reason', Object.values(realLedger).every((v) => typeof v?.reason === 'string' && v.reason.length > 20));
  t('every real ledger key is `<package>#<subpath>`', Object.keys(realLedger).every((k) => /^[^#]+#(\.|\.\/.+|\(main\))$/.test(k)));

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-dual-build-cjs-loads self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(`✓ check-dual-build-cjs-loads self-test: ${cases.length} cases pass (real emitted bytes, real spawns; both ledger directions, and the parse failure the ledger may never silence).`);
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const code = argv.includes('--self-test') ? await selfTest() : await main(argv);
  process.exit(code);
}
