#!/usr/bin/env node
// check-i18n-bundles — the `pnpm check:i18n` gate. TWO verdicts, kept distinct:
//
//   1. BUNDLE DRIFT       a package's committed translation bundles no longer
//                         match what its schema would extract. Fixed by
//                         regenerating (`--write`).
//   2. UNDECLARED KEY     a package's `i18n-extract.config.ts` authors a key
//                         `ObjectStackDefinitionSchema` does not declare, so the
//                         parse DROPS it at load. Fixed by deleting the key from
//                         the config (or, if the key is genuinely wanted, by
//                         declaring it in `packages/spec` — deliberately, with an
//                         ADR-worthy reason, never to accommodate a typo).
//
// Verdict 2 was added by #4804 and is the reason this header no longer says
// "drift gate": before it, `check:i18n` judged drift only. If this gate fails on
// you, read which of the two sections below your package landed in — they are
// reported separately and never merged into one verdict.
//
// Why verdict 2 lives HERE and not in `os i18n extract`: the #4167
// unknown-authoring-key lint already SAW every one of these — it printed a
// `console.warn` per offending package on every run — but the CLI still exited 0,
// so the warning appeared inside a fully green `check:i18n` and was read as
// noise. Nine packages then copied the same undeclared `name:` key from the first
// one (#4736, cleaned in #4803) and nothing stopped any of them. A warning that
// nine authors filtered out is not a control. Making the *gate* fail turns
// "already visible" into "already blocked" without touching the public CLI
// exit-code contract (rejected option B) or making
// `ObjectStackDefinitionSchema` strict (rejected option C, which would silence
// the lint itself — see `metadata-authoring-lint.ts`).
//
// Coverage needs no manifest: `findConfigs` walks `packages/`, so a config that
// lands tomorrow is gated tomorrow.
//
// The command each package is checked with is not repeated here: it is parsed
// out of the config file's own docstring, which already documents how to
// regenerate that bundle. Executing exactly the documented command means the
// docs and the gate cannot diverge — the same reason `os lint`'s coverage
// detector was made to share the extractor's walker (#3370).
//
//   node scripts/check-i18n-bundles.mjs             # check all; fail on either verdict
//   node scripts/check-i18n-bundles.mjs --write      # regenerate bundles in place
//   node scripts/check-i18n-bundles.mjs --filter=security
//   node scripts/check-i18n-bundles.mjs --self-test  # prove both classifiers can go red
//
// Requires the workspace build (it runs the built CLI), so it belongs after
// the build step with the other consumer gates. `--self-test` does not: it runs
// the two output classifiers against fixed samples, no build and no CLI. That
// self-test exists because a gate observed only green is indistinguishable from
// a gate that matches nothing (#4690).
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CLI = 'packages/cli/bin/run.js';
const write = process.argv.includes('--write');
const filterArg = process.argv.find((a) => a.startsWith('--filter='));
const filter = filterArg ? filterArg.slice('--filter='.length) : '';

/** Every `scripts/i18n-extract.config.ts` under packages/. */
function findConfigs(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) findConfigs(p, out);
    else if (e.name === 'i18n-extract.config.ts' && p.includes('/scripts/')) out.push(p);
  }
  return out;
}

/**
 * Read the regenerate command the config documents about itself. Every flag the
 * gate passes comes from there, so a package that changes its locales or output
 * directory updates one place and the gate follows.
 */
function flagsFromDocstring(configPath) {
  const src = readFileSync(configPath, 'utf8');
  const head = src.slice(0, src.indexOf('*/') + 2);
  const flags = head.match(/--(?:locales|fill|out)=[^\s\\*]+|--(?:objects-only|no-metadata-forms|no-merge)\b/g) ?? [];
  return [...new Set(flags)];
}

// ---------------------------------------------------------------------------
// Output classifiers. Pure string -> findings, so `--self-test` can drive them
// with recorded CLI output instead of a build.
// ---------------------------------------------------------------------------

/**
 * The signature `formatUnknownAuthoringKey()` (packages/spec) emits, whatever
 * prints it. `defineStack` writes it to **stderr** with a `defineStack: ` prefix;
 * `os compile` writes the same text to stdout behind a `• ` bullet. Both streams
 * are scanned, so the gate does not depend on which seam happens to surface it.
 *
 * The parenthesised path/key groups are what lets the failure name the offending
 * key rather than merely assert one exists.
 */
const UNDECLARED_KEY_LINE =
  /^\s*(?:•\s+)?(?:defineStack:\s*)?(?<path>[^\s:]+):\s*'(?<key>[^']+)' is not a declared (?<surface>\S+) key\b(?<rest>.*)$/;

/** Weaker signature: enough to fail on, not enough to attribute. See below. */
const UNDECLARED_KEY_SIGNATURE = /is not a declared \S+ key/;

/**
 * Every unknown-authoring-key finding in one package's CLI output.
 *
 * Deduped by path, mirroring the lint's own per-process dedupe — but note the
 * dedupe is per *path within one process*, and this gate spawns one process per
 * config, so nine offending packages really do produce nine findings. Presence,
 * not count, is what fails the gate; the count only shapes the message.
 *
 * The `unattributed` bucket is deliberate anti-#4690 insurance: if the message
 * format ever changes so the strict regex stops matching, the weak signature
 * still fails the gate — loudly saying it could not name the key — instead of
 * quietly reporting a clean run.
 */
function collectUndeclaredKeys(text) {
  const findings = [];
  const unattributed = [];
  const seen = new Set();
  for (const line of String(text ?? '').split('\n')) {
    if (!UNDECLARED_KEY_SIGNATURE.test(line)) continue;
    const m = line.match(UNDECLARED_KEY_LINE);
    if (!m) {
      unattributed.push(line.trim());
      continue;
    }
    const { path, key, surface, rest } = m.groups;
    if (seen.has(path)) continue;
    seen.add(path);
    // `rest` still holds the shared ", so its value is dropped at load" clause;
    // the gate states that consequence in its own words, so strip it and keep
    // only the finding-specific tail (`did you mean 'x'?`, or a retirement note).
    const hint = (rest ?? '')
      .replace(/^,\s*so its value is dropped at load/, '')
      .replace(/^\s*[—–-]\s*/, '')
      .replace(/^\s*\.\s*$/, '')
      .trim();
    findings.push({ path, key, surface, hint });
  }
  return { findings, unattributed };
}

/** Bundles the extractor reported as stale. Unchanged since the gate's first version. */
function collectDriftedBundles(text) {
  return [...String(text ?? '').matchAll(/(?:out of date|missing):\s+(\S+)/g)].map((m) => m[1]);
}

/** stderr lines that are neither the lint signature nor blank — pass them through. */
function passthroughStderrLines(text) {
  return String(text ?? '')
    .split('\n')
    .filter((l) => l.trim() && !UNDECLARED_KEY_SIGNATURE.test(l));
}

// ---------------------------------------------------------------------------
// Self-test — the proof that each classifier can go red, and that the two
// verdicts do not contaminate each other.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const expect = (name, cond, detail) => {
    if (!cond) failures.push(`${name} — ${detail}`);
  };

  // Recorded verbatim from `node packages/cli/bin/run.js i18n extract
  // packages/platform-objects/scripts/i18n-extract.config.ts … --check` at
  // ffab8033b^ (the commit before #4803 removed the nine `name:` keys). This is
  // the corpus the gate has to catch; if the CLI's wording moves, this string
  // stops matching and the self-test says so before CI goes quietly green.
  const REAL_STDERR_AT_FFAB8033B_PARENT =
    "defineStack: stack.name: 'name' is not a declared stack key, so its value is dropped at load — did you mean 'pages'?";

  const real = collectUndeclaredKeys(REAL_STDERR_AT_FFAB8033B_PARENT);
  expect('#4804 real-corpus', real.findings.length === 1, `expected 1 finding, got ${real.findings.length}`);
  expect('#4804 real-corpus path', real.findings[0]?.path === 'stack.name', `got ${real.findings[0]?.path}`);
  expect('#4804 real-corpus key', real.findings[0]?.key === 'name', `got ${real.findings[0]?.key}`);
  expect('#4804 real-corpus surface', real.findings[0]?.surface === 'stack', `got ${real.findings[0]?.surface}`);
  expect('#4804 real-corpus unattributed', real.unattributed.length === 0, 'strict regex should have matched');
  expect(
    '#4804 real-corpus hint',
    real.findings[0]?.hint === "did you mean 'pages'?",
    `the shared "dropped at load" clause must not leak into the hint; got ${JSON.stringify(real.findings[0]?.hint)}`,
  );

  // The same finding as `os compile` prints it (stdout, bulleted, no prefix).
  const bulleted = collectUndeclaredKeys("  • objects[0].fields.pii: 'pii' is not a declared field key, so its value is dropped at load.");
  expect('#4804 bulleted form', bulleted.findings.length === 1, `expected 1, got ${bulleted.findings.length}`);
  expect('#4804 bulleted key', bulleted.findings[0]?.key === 'pii', `got ${bulleted.findings[0]?.key}`);
  expect('#4804 bulleted surface', bulleted.findings[0]?.surface === 'field', `got ${bulleted.findings[0]?.surface}`);
  expect('#4804 bulleted hint', bulleted.findings[0]?.hint === '', `a hintless finding must yield '', got ${JSON.stringify(bulleted.findings[0]?.hint)}`);

  // Two distinct paths in one package's output must both survive; a repeat of
  // one path must not double-count.
  const multi = collectUndeclaredKeys(
    [
      "defineStack: stack.name: 'name' is not a declared stack key, so its value is dropped at load.",
      "defineStack: stack.title: 'title' is not a declared stack key, so its value is dropped at load.",
      "defineStack: stack.name: 'name' is not a declared stack key, so its value is dropped at load.",
    ].join('\n'),
  );
  expect('#4804 multi-key', multi.findings.length === 2, `expected 2 distinct paths, got ${multi.findings.length}`);

  // Anti-#4690: a reworded signature must still fail the gate, flagged as
  // unattributable — never silently classified as clean.
  const reworded = collectUndeclaredKeys('warn: the key `name` is not a declared stack key here');
  expect('#4804 reworded still red', reworded.findings.length + reworded.unattributed.length === 1, 'weak signature must still register');
  expect('#4804 reworded unattributed', reworded.unattributed.length === 1, 'should land in the unattributed bucket');

  // A clean run is clean — the gate must not fail on ordinary output.
  const clean = collectUndeclaredKeys('  ✓ 8 bundle(s) are in sync with the schema (487ms)\n  ℹ Config: /x/y.ts');
  expect('#4804 clean run', clean.findings.length === 0 && clean.unattributed.length === 0, 'clean output must produce nothing');

  // The two verdicts must not read each other's output (issue #4804 criterion 3).
  const driftOutput = '  ✗ out of date: zh-CN.ts\n  ✗ missing: ja-JP.ts';
  expect('#4804 drift still detected', collectDriftedBundles(driftOutput).length === 2, 'drift classifier regressed');
  expect('#4804 drift is not an undeclared key', collectUndeclaredKeys(driftOutput).findings.length === 0, 'drift leaked into the key verdict');
  expect(
    '#4804 undeclared key is not drift',
    collectDriftedBundles(REAL_STDERR_AT_FFAB8033B_PARENT).length === 0,
    'the key verdict leaked into drift',
  );

  // Passthrough must not swallow unrelated diagnostics.
  const pass = passthroughStderrLines(`${REAL_STDERR_AT_FFAB8033B_PARENT}\nnode:internal/errors: something else\n`);
  expect('#4804 passthrough keeps other stderr', pass.length === 1 && pass[0].includes('something else'), `got ${JSON.stringify(pass)}`);

  if (failures.length) {
    console.error(`✗ check:i18n --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('✓ check:i18n --self-test — bundle-drift and undeclared-authoring-key classifiers both go red, and stay distinct.');
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const configs = findConfigs('packages').sort().filter((c) => !filter || c.includes(filter));
if (configs.length === 0) {
  console.error(`check-i18n-bundles: no extract configs matched${filter ? ` --filter=${filter}` : ''}`);
  process.exit(1);
}

const drifted = [];
const broken = [];
/** One entry per package that authored a key the schema does not declare. */
const undeclared = [];
for (const config of configs) {
  const pkg = config.replace(/^packages\//, '').replace(/\/scripts\/i18n-extract\.config\.ts$/, '');
  const flags = flagsFromDocstring(config);
  const out = flags.find((f) => f.startsWith('--out='));
  if (!out) {
    broken.push(`${pkg}: its docstring documents no --out=<dir>, so the gate cannot tell where the bundles live`);
    continue;
  }
  const outDir = out.slice('--out='.length);
  if (!existsSync(outDir)) {
    broken.push(`${pkg}: documented --out directory does not exist: ${outDir}`);
    continue;
  }
  const args = [CLI, 'i18n', 'extract', config, ...flags, ...(write ? [] : ['--check'])];
  // `spawnSync`, not `execFileSync`: the unknown-authoring-key lint writes to
  // **stderr**, and execFileSync surfaces stderr only on the throw path — on a
  // zero-exit run it is discarded (previously: inherited straight to the
  // terminal, seen by nobody, judged by nothing). That asymmetry is precisely
  // how nine offending configs sat inside a green run. spawnSync hands back both
  // streams on both paths. Everything on stderr that is not the lint is
  // re-emitted below, so capturing it costs no diagnostics.
  const run = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error) {
    broken.push(`${pkg}: could not run the extractor — ${run.error.message}`);
    console.log(`  ${pkg.padEnd(30)} ERROR`);
    continue;
  }
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  const failed = run.status !== 0;

  const keyScan = collectUndeclaredKeys(`${stdout}\n${stderr}`);
  for (const line of passthroughStderrLines(stderr)) console.error(line);
  const hasUndeclared = keyScan.findings.length > 0 || keyScan.unattributed.length > 0;
  if (hasUndeclared) undeclared.push({ pkg, config, ...keyScan });
  // Marker on the per-package line so the two verdicts are already
  // distinguishable in the scan-line summary, not only in the report below.
  const keyNote = hasUndeclared ? '  ← UNDECLARED KEY' : '';

  if (write) {
    console.log(`  ${pkg.padEnd(30)} regenerated${keyNote}`);
    continue;
  }
  if (failed) {
    const stale = collectDriftedBundles(stdout);
    if (stale.length) {
      drifted.push(`${pkg}: ${stale.length} bundle(s) drifted from the schema`);
      console.log(`  ${pkg.padEnd(30)} DRIFTED (${stale.length})${keyNote}`);
    } else {
      // Not a drift result — the extract itself blew up. Never report that as
      // a pass; a config that cannot load is a broken gate, not a clean one.
      broken.push(`${pkg}: extract failed — ${(stdout.trim().split('\n').pop() || 'no output').trim()}`);
      console.log(`  ${pkg.padEnd(30)} ERROR${keyNote}`);
    }
    continue;
  }
  const n = (stdout.match(/(\d+) bundle\(s\) are in sync/) ?? [, '?'])[1];
  console.log(`  ${pkg.padEnd(30)} in sync (${n} bundle(s))${keyNote}`);
}

/** Render the undeclared-key verdict — its own section, never folded into drift. */
function reportUndeclaredKeys() {
  console.error(
    `\ncheck-i18n-bundles: UNDECLARED AUTHORING KEY in ${undeclared.length} package(s)\n` +
      `These keys are parsed away at load — whatever they were meant to configure is NOT\n` +
      `in effect, and never was. This is a separate verdict from bundle drift below/above;\n` +
      `regenerating bundles will not fix it.\n`,
  );
  for (const u of undeclared) {
    console.error(`  ${u.pkg}  (${u.config})`);
    for (const f of u.findings) {
      console.error(
        `    • '${f.key}' at ${f.path} is not a declared ${f.surface} key — dropped at load` +
          (f.hint ? ` (${f.hint.replace(/\.$/, '')})` : ''),
      );
    }
    for (const line of u.unattributed) {
      console.error(`    • ${line}  [gate could not parse the package/key out of this line — report it]`);
    }
  }
  console.error(
    `\nFix at the producer: delete the key from that config. If the key is genuinely\n` +
      `wanted, declare it in \`packages/spec\` deliberately — do not add a consumer-side\n` +
      `fallback, and do not make the schema strict to silence the lint (see this script's\n` +
      `header, and #4736/#4804 for why this is a hard failure rather than a warning).`,
  );
}

if (write) {
  if (undeclared.length) {
    reportUndeclaredKeys();
    console.error(`\n(--write regenerates bundles only; the keys above still need deleting by hand.)`);
  }
  process.exit(0);
}

if (broken.length || drifted.length || undeclared.length) {
  if (broken.length || drifted.length) {
    console.error(`\ncheck-i18n-bundles: ${broken.length + drifted.length} bundle problem(s)\n`);
    for (const b of broken) console.error('  • ' + b);
    for (const d of drifted) {
      console.error('  • ' + d);
    }
    if (drifted.length) {
      console.error(
        `\nRegenerate and commit: node scripts/check-i18n-bundles.mjs --write\n` +
          `Merge mode is on, so no existing translation is overwritten — new schema keys are\n` +
          `added filled with the source text, and they still need translating.`,
      );
    }
  }
  if (undeclared.length) reportUndeclaredKeys();
  process.exit(1);
}
console.log(
  `\ncheck-i18n-bundles: OK (${configs.length} package(s) — all bundles in sync, no undeclared authoring keys).`,
);
