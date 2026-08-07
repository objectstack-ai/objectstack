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
//
// That requirement is now CHECKED, not merely declared (#5217). It used to be a
// sentence in this header, and an unbuilt workspace paid for it twice over:
//
//   - `--check` reported "9 bundle problem(s) … extract failed" — one
//     environment prerequisite rendered as nine CONTENT problems, in the two
//     words ("bundle", "extract") that send the reader to the i18n configs;
//   - `--write` printed "regenerated" nine times and exited **0** — a fully
//     green run that wrote nothing at all.
//
// CI never sees either shape (it builds first — lint.yml's `typecheck` job runs
// `Build workspace packages` well before `pnpm check:i18n`), which is exactly
// why it survived: the only people who meet it are the ones reproducing a red
// i18n CI locally, at the moment a wrong first diagnosis costs the most.
// `checkCliBuildPrerequisite()` now answers it once, before the per-package
// loop, and both shapes above collapse into one prerequisite plus one command.
// "Prefer failing to falling back" (AGENTS.md, route & surface ownership §3):
// the prerequisite verdict is a HARD failure that states it checked nothing —
// never a skip, and never anything a reader can mistake for "bundles are fine".
//
// The two pure functions that answer it moved to `scripts/cli-build-prerequisite.mjs`
// when #5862 found the same missing precondition in `check-i18n-coverage.mjs`, one
// lint.yml step away. They are imported, not copied: see that module's header.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLI,
  CLI_BUILD_FIX,
  looksLikeMissingCliCommand,
  oclifCommandFileFor,
  resolveCliCommandFile,
} from './cli-build-prerequisite.mjs';

/** The one command this gate invokes per package, as oclif topic/command parts. */
const EXTRACT_COMMAND_ID = ['i18n', 'extract'];
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

// `oclifCommandFileFor` and `looksLikeMissingCliCommand` — the two classifiers the
// prerequisite is built from — now live in `./cli-build-prerequisite.mjs`, shared
// with `check-i18n-coverage.mjs` (#5862). The self-test below still drives them
// directly, so this gate's corpus keeps proving them from here.

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

  // -------------------------------------------------------------------------
  // Third classifier (#5217): the build prerequisite. Same anti-#4690 duty as
  // the two above — a prerequisite check observed only green is indistinguishable
  // from one that matches nothing, and this one's whole job is to fire on a
  // machine where the gate cannot run at all.
  // -------------------------------------------------------------------------

  // Both recorded VERBATIM from `node scripts/check-i18n-bundles.mjs` in an
  // installed-but-unbuilt worktree at 72c3c8613 — the run reproduced in #5217.
  // oclif wraps its one-sentence error at a width that depends on the config
  // path, so the same failure arrives in two shapes; the second breaks the path
  // mid-token ("…/i18n" + "-extract.config.ts"). Keep both: a per-line regex
  // passes neither, which is the implementation this corpus exists to reject.
  const OCLIF_WRAPPED_3_LINE =
    ' ›   Error: command \n ›   i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not \n ›   found';
  const OCLIF_WRAPPED_MID_TOKEN =
    ' ›   Error: command i18n:extract:packages/plugins/plugin-approvals/scripts/i18n\n ›   -extract.config.ts not found';

  expect('#5217 wrapped 3-line', !!looksLikeMissingCliCommand(OCLIF_WRAPPED_3_LINE), 'oclif line wrapping must not hide the signature');
  expect('#5217 wrapped mid-token', !!looksLikeMissingCliCommand(OCLIF_WRAPPED_MID_TOKEN), 'a path split mid-token must still match');
  expect(
    '#5217 unwrapped form',
    !!looksLikeMissingCliCommand('Error: command i18n:extract:x/y.ts not found'),
    'the unwrapped single-line form must match too',
  );
  expect(
    '#5217 flattens for the message',
    looksLikeMissingCliCommand(OCLIF_WRAPPED_3_LINE) ===
      'Error: command i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not found',
    `the evidence line must come back as one readable sentence; got ${JSON.stringify(looksLikeMissingCliCommand(OCLIF_WRAPPED_3_LINE))}`,
  );

  // Recorded verbatim from the OTHER real prerequisite scenario: `dist/` and the
  // command file both present but the built command surface unusable (a stale or
  // interrupted build), which the pre-loop probe cannot see and the net catches.
  // oclif prepends a node `Warning:` block there, so this pins that the quoted
  // evidence is the ERROR SENTENCE and not whichever noise came first.
  const OCLIF_STALE_DIST_WITH_WARNING_NOISE =
    '(node:13260) Warning: Error\nmodule: @oclif/core@4.13.2\ntask: findCommand (i18n:extract)\nplugin: @objectstack/cli\nroot: /repo/packages/cli\nmessage: command i18n:extract not found\nSee more details with DEBUG=*\n' +
    ' ›   Error: command \n ›   i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not \n ›   found';
  expect(
    '#5217 stale dist quotes the sentence, not the noise',
    looksLikeMissingCliCommand(OCLIF_STALE_DIST_WITH_WARNING_NOISE) ===
      'Error: command i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not found',
    `evidence must be the error sentence; got ${JSON.stringify(looksLikeMissingCliCommand(OCLIF_STALE_DIST_WITH_WARNING_NOISE))}`,
  );

  // Must not contaminate — or be contaminated by — the two content verdicts.
  // A real bundle problem on a correctly built workspace must never be reported
  // as "your workspace is not built", which would send the reader to run a build
  // that changes nothing and hide a genuine drift behind it.
  expect('#5217 clean run is not a missing build', !looksLikeMissingCliCommand('  ✓ 8 bundle(s) are in sync with the schema (487ms)'), 'clean output must not match');
  expect('#5217 drift is not a missing build', !looksLikeMissingCliCommand(driftOutput), 'drift leaked into the prerequisite verdict');
  expect(
    '#5217 undeclared key is not a missing build',
    !looksLikeMissingCliCommand(REAL_STDERR_AT_FFAB8033B_PARENT),
    'the key verdict leaked into the prerequisite verdict',
  );
  expect(
    '#5217 unrelated failure is not a missing build',
    !looksLikeMissingCliCommand("Error: Cannot find module 'node:fs/promises'\n  at ModuleJob.run"),
    'only oclif command resolution may claim this verdict',
  );

  // The probe derives its path from the CLI's declaration; pin the derivation
  // against the real oclif block so a moved `target` is caught here rather than
  // by a probe that quietly checks a path nothing writes any more.
  const derived = oclifCommandFileFor({ oclif: { commands: { strategy: 'pattern', target: './dist/commands', glob: '**/*.js' } } }, ['i18n', 'extract']);
  expect('#5217 derives the command file', derived.file === 'packages/cli/dist/commands/i18n/extract.js', `got ${JSON.stringify(derived)}`);
  const undeclaredTarget = oclifCommandFileFor({ oclif: {} }, ['i18n', 'extract']);
  expect('#5217 unreadable shape defers, loudly', !!undeclaredTarget.unknown && !undeclaredTarget.file, `an unreadable oclif block must yield a reason, not a guessed path; got ${JSON.stringify(undeclaredTarget)}`);

  if (failures.length) {
    console.error(`✗ check:i18n --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('✓ check:i18n --self-test — bundle-drift, undeclared-authoring-key and missing-CLI-build classifiers all go red, and stay distinct.');
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// The prerequisite: this gate runs the BUILT CLI (#5217).
// ---------------------------------------------------------------------------

/**
 * ONE prerequisite and ONE command to satisfy it — never per package, and never
 * phrased so it can be mistaken for a verdict about the bundles.
 *
 * Exits 1, the same code the two real verdicts use: any wrapper that treats
 * non-zero as failure keeps behaving identically, and inventing a second failure
 * code would be a new contract nobody asked for.
 */
function reportPrerequisiteNotMet(headline, detail) {
  console.error(
    `\ncheck-i18n-bundles: PREREQUISITE NOT MET — ${headline}\n\n` +
      detail.map((l) => (l ? `  ${l}` : '')).join('\n') +
      `\n\n  Fix:  ${CLI_BUILD_FIX}\n\n` +
      `  Nothing was checked: no bundle was compared and no config was parsed, so this\n` +
      `  result says NOTHING about whether the committed translation bundles are in sync.\n` +
      `  (Exit code 1 — but piping this gate reports the PIPE's status, so\n` +
      `  \`pnpm check:i18n | tail -4\` reads green either way. Use \`echo "EXIT=$?"\`.)`,
  );
  process.exit(1);
}

/**
 * Answered once, before the per-package loop — so a missing build costs one
 * verdict instead of one per package, and costs zero CLI spawns.
 *
 * Probes the exact command FILE the loop needs, not merely `dist/`: an
 * interrupted or partial build leaves the directory behind, and a `dist/` that
 * exists without `commands/i18n/extract.js` reproduces the nine-problem report
 * this check exists to prevent.
 *
 * When the CLI's package.json shape moves out from under the derivation, this
 * says so on stderr and defers to the in-loop signature net rather than failing:
 * a probe that cannot read the declaration must not turn a correctly-built
 * workspace red. It stays audible either way — the net is the enforcement, this
 * is only the cheap early answer.
 */
function checkCliBuildPrerequisite() {
  const resolved = resolveCliCommandFile(EXTRACT_COMMAND_ID);
  if (resolved.unknown) {
    console.error(`check-i18n-bundles: ${resolved.unknown} — build prerequisite not pre-checked`);
    return;
  }
  if (existsSync(resolved.file)) return;
  reportPrerequisiteNotMet('the workspace CLI is not built', [
    `This gate runs the BUILT CLI. ${CLI} is only a source stub that hands`,
    `off to oclif, which resolves \`os ${EXTRACT_COMMAND_ID.join(' ')}\` from the compiled`,
    `output — and that command is not there:`,
    ``,
    `  ${resolved.file}`,
  ]);
}

checkCliBuildPrerequisite();

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

  // The prerequisite's safety net, and the reason the probe above is allowed to
  // defer instead of guessing. It fires on the cases the probe cannot see: a
  // stale build whose command surface no longer answers to this id, a partial
  // dist that satisfies the file check, or a package.json shape the derivation
  // could not read. Aborting on the FIRST package is the whole point — the
  // defect being fixed is nine reports of one cause, so the loop must not
  // continue accumulating them.
  if (failed) {
    const signature = looksLikeMissingCliCommand(`${stdout}\n${stderr}`);
    if (signature) {
      reportPrerequisiteNotMet('the built CLI cannot resolve the command this gate runs', [
        `${pkg}'s extract exited ${run.status} with oclif's own "command not found":`,
        ``,
        `  ${signature.length > 160 ? `${signature.slice(0, 160)}…` : signature}`,
        ``,
        `Every remaining package would fail the same way for the same one reason, so the`,
        `loop stopped here rather than reporting it ${configs.length} times as bundle problems.`,
      ]);
    }
  }

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
