#!/usr/bin/env node
// check-i18n-coverage — declared-label translation ratchet for the examples AND
// every package that owns a translation bundle.
//
// #3370 made `os lint` gate the WHOLE declared surface (inline object actions,
// action params / resultDialog, listViews, apps / dashboards / pages), not just
// object and field labels. That surfaced real pre-existing debt: the examples
// declare `i18n.supportedLocales: ['en', 'zh-CN', …]` and then leave a few
// hundred declared strings untranslated.
//
// So `os lint --i18n-strict` — the honest "these locales must be complete"
// gate — reports ~100-450 errors per example today. Turning it on as-is would
// paint CI red on day one and get switched back off, which is how a gate stops
// being a gate. This is the shippable middle: the debt is FROZEN, and the build
// fails the moment it grows.
//
// Mirrors scripts/check-role-word.mjs. Fails when:
//   • an example config is not in the baseline (translate it, or ratchet it in), or
//   • a baselined count INCREASES — a newly untranslated declared string, or
//   • a baselined count DECREASED / the example vanished (improvement!) —
//     run with --update to ratchet down and commit the baseline.
//
//   node scripts/check-i18n-coverage.mjs [--update]
//   node scripts/check-i18n-coverage.mjs --self-test  # prove the classifiers go red
//
// Counts only what `os lint` shows a user: the platform metadata-form baseline
// is folded away (it is owned and translated by platform-objects), so this
// tracks the example's OWN declared surface. Severity is ignored on purpose —
// warning-vs-error moves with --i18n-strict, but the SET of untranslated keys
// does not, and that set is what must not grow.
//
// Requires the workspace build (it runs the built CLI), so it belongs after the
// build step with the other consumer gates. `--self-test` does not: it drives the
// pure classifiers against recorded samples, no build and no CLI.
//
// That requirement is now CHECKED, not merely declared (#5862). It used to be the
// sentence above and nothing else, and in an installed-but-unbuilt worktree the
// gate answered with an uncaught exception plus a node stack:
//
//     Error: os lint produced no output for examples/app-crm/objectstack.config.ts
//         at countI18nIssues (…/check-i18n-coverage.mjs:101:28)
//
// — which names an entirely innocent example config. There is exactly one cause,
// and it is not in that file: this gate runs the BUILT CLI, oclif resolves
// `os lint` from `dist/commands`, and an unbuilt CLI prints nothing at all. The
// first config to be processed simply took the blame for the environment.
//
// CI never sees this (lint.yml's `typecheck` job runs `Build workspace packages`
// well before `pnpm check:i18n-coverage`), which is exactly why it survived: the
// only people who meet it are the ones reproducing a red i18n CI locally, at the
// moment a wrong first diagnosis costs the most. `checkCliBuildPrerequisite()`
// now answers it once, before the per-config loop.
//
// Same shape as the neighbouring `check-i18n-bundles.mjs` step (#5217), sharing
// its two pure classifiers from `scripts/cli-build-prerequisite.mjs` rather than
// copying them. "Prefer failing to falling back" (AGENTS.md, route & surface
// ownership §3): the prerequisite verdict is a HARD failure that states it
// measured nothing — never a skip, and never anything a reader can mistake for
// "no config declares an untranslated label".
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  CLI,
  CLI_BUILD_FIX,
  looksLikeMissingCliCommand,
  oclifCommandFileFor,
  resolveCliCommandFile,
} from './cli-build-prerequisite.mjs';

// NOTE: covers both `examples/*` and every package with an extract config.
const EXAMPLES_DIR = 'examples';
const BASELINE_PATH = 'scripts/i18n-coverage-baseline.json';
/** The one command this gate invokes per config, as oclif topic/command parts. */
const LINT_COMMAND_ID = ['lint'];

const update = process.argv.includes('--update');

/** Every bundled example that has a stack config. */
function discoverExamples() {
  if (!existsSync(EXAMPLES_DIR)) return [];
  return readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(EXAMPLES_DIR, e.name, 'objectstack.config.ts'))
    .filter((p) => existsSync(p))
    .sort();
}

/**
 * Every package that owns a translation bundle, via the same
 * `scripts/i18n-extract.config.ts` its drift gate uses.
 *
 * These matter more than the examples: an example is a demo, but a platform
 * package's untranslated label is what a customer actually reads in Setup /
 * Studio. Covering only `examples/` is how `platform-objects` sat on 77
 * untranslated navigation and widget labels per locale without anything saying so.
 */
function discoverPackages(dir = 'packages', out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) discoverPackages(p, out);
    else if (e.name === 'i18n-extract.config.ts' && p.includes('/scripts/')) out.push(p);
  }
  return out.sort();
}

/**
 * The gate's content classifier: how many of a report's issues are i18n ones.
 * Pure, so `--self-test` can drive it with a recorded report instead of a build.
 *
 * The `i18n/` prefix is the contract with `os lint --json`; everything else in
 * the report belongs to other rules and must not move this number.
 */
function countI18nRuleIssues(report) {
  const issues = report?.issues ?? [];
  if (!Array.isArray(issues)) return 0;
  return issues.filter((i) => typeof i?.rule === 'string' && i.rule.startsWith('i18n/')).length;
}

/**
 * Untranslated declared strings `os lint` would show for one config.
 *
 * Captured to a FILE rather than a pipe. Node writes stdout synchronously to a
 * file and asynchronously to a pipe, so a command that exits right after a
 * large `console.log` can hand a pipe reader a payload cut off at one 64 KiB
 * buffer — which is exactly what `os lint --json` did on `platform-objects`
 * until the `emitJson` fix. A gate must never be able to read a truncated
 * payload and quietly report a smaller number, so it does not use a pipe at all.
 */
function countI18nIssues(configPath) {
  const tmp = join(tmpdir(), `os-lint-${randomUUID()}.json`);
  const fd = openSync(tmp, 'w');
  try {
    let stderr = '';
    try {
      execFileSync(process.execPath, [CLI, 'lint', configPath, '--json'], {
        stdio: ['ignore', fd, 'pipe'],
      });
    } catch (err) {
      // `os lint` exits non-zero whenever the config has errors of any kind;
      // the JSON payload is still what we want. A run that produced no output
      // is a hard failure — never silently a zero.
      //
      // stderr is kept, not discarded: oclif reports an unresolvable command
      // there, and that text is the difference between "this config is broken"
      // and "your workspace is not built". `execFileSync` surfaces it only on
      // the throw path, which is the only path this can arrive on — a command
      // oclif cannot find always exits non-zero (measured: 2).
      stderr = String(err?.stderr ?? '');
    }
    closeSync(fd);
    const raw = readFileSync(tmp, 'utf8');

    // The prerequisite's safety net, checked BEFORE the empty-output failure
    // below — otherwise a missing build reports as "no output for <config>" and
    // sends the reader into a config that is not at fault (#5862). It fires on
    // what the pre-loop probe cannot see: a stale build whose command surface no
    // longer answers to this id, a partial dist that satisfies the file check, or
    // a package.json shape the derivation could not read. Aborting on the FIRST
    // config is the point — every remaining one fails for the same one reason.
    const signature = looksLikeMissingCliCommand(`${raw}\n${stderr}`);
    if (signature) {
      reportPrerequisiteNotMet('the built CLI cannot resolve the command this gate runs', [
        `\`os ${LINT_COMMAND_ID.join(' ')}\` exited with oclif's own "command not found":`,
        ``,
        `  ${signature.length > 160 ? `${signature.slice(0, 160)}…` : signature}`,
        ``,
        `${configPath} is NOT at fault — it is simply the first config this gate`,
        `reached. Every remaining one would fail the same way for the same reason,`,
        `so the loop stopped here rather than blaming an example.`,
      ]);
    }

    if (!raw.trim()) throw new Error(`os lint produced no output for ${configPath}`);
    let report;
    try {
      report = JSON.parse(raw);
    } catch (err) {
      throw new Error(`os lint produced unparseable JSON for ${configPath} (${raw.length} bytes): ${err.message}`);
    }
    if (report.error) throw new Error(`os lint failed for ${configPath}: ${report.error}`);
    return countI18nRuleIssues(report);
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}

// ---------------------------------------------------------------------------
// Self-test — the proof that each classifier can go red. A gate observed only
// green is indistinguishable from a gate that matches nothing (#4690), and the
// prerequisite classifier is the one that can never be observed red in CI: CI
// always builds first, so nothing else would ever exercise it.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const expect = (name, cond, detail) => {
    if (!cond) failures.push(`${name} — ${detail}`);
  };

  // Both recorded VERBATIM from `node packages/cli/bin/run.js lint <config> --json`
  // in an installed-but-unbuilt worktree at f192981fe — the run reproduced in
  // #5862. oclif wraps its one-sentence error at a width that depends on the
  // config path, so the same failure arrives in two shapes: the examples' short
  // paths stay on one line, while the package extract configs `discoverPackages()`
  // feeds this same gate wrap across three. Keep both — a per-line regex passes
  // the first and fails the second, which is the implementation this corpus
  // exists to reject.
  const OCLIF_LINT_UNWRAPPED = ' ›   Error: command lint:examples/app-crm/objectstack.config.ts not found';
  const OCLIF_LINT_WRAPPED_3_LINE =
    ' ›   Error: command \n ›   lint:packages/plugins/plugin-approvals/scripts/i18n-extract.config.ts not \n ›   found';

  expect('#5862 unwrapped form', !!looksLikeMissingCliCommand(OCLIF_LINT_UNWRAPPED), 'the single-line form must match');
  expect('#5862 wrapped 3-line', !!looksLikeMissingCliCommand(OCLIF_LINT_WRAPPED_3_LINE), 'oclif line wrapping must not hide the signature');
  expect(
    '#5862 flattens for the message',
    looksLikeMissingCliCommand(OCLIF_LINT_WRAPPED_3_LINE) ===
      'Error: command lint:packages/plugins/plugin-approvals/scripts/i18n-extract.config.ts not found',
    `the evidence line must come back as one readable sentence; got ${JSON.stringify(looksLikeMissingCliCommand(OCLIF_LINT_WRAPPED_3_LINE))}`,
  );

  // Must not contaminate — or be contaminated by — the content verdict. A real
  // untranslated-label result on a correctly built workspace must never be
  // reported as "your workspace is not built", which would send the reader to run
  // a build that changes nothing and hide the actual coverage regression.
  const REAL_LINT_REPORT = {
    issues: [
      { rule: 'i18n/missing-translation', severity: 'warning', message: "object 'contacts' label is untranslated for zh-CN" },
      { rule: 'i18n/missing-translation', severity: 'warning', message: "field 'contacts.email' label is untranslated for ja-JP" },
      { rule: 'schema/unknown-key', severity: 'error', message: "'foo' is not a declared object key" },
    ],
  };
  expect(
    '#5862 a real report is not a missing build',
    !looksLikeMissingCliCommand(JSON.stringify(REAL_LINT_REPORT)),
    'lint output leaked into the prerequisite verdict',
  );
  expect(
    '#5862 empty output is not a missing build',
    !looksLikeMissingCliCommand(''),
    'no output at all is a different failure and keeps its own message',
  );
  expect(
    '#5862 unrelated failure is not a missing build',
    !looksLikeMissingCliCommand("Error: Cannot find module 'node:fs/promises'\n  at ModuleJob.run"),
    'only oclif command resolution may claim this verdict',
  );

  // The probe derives its path from the CLI's own declaration; pin the derivation
  // against the real oclif block so a moved `target` is caught here rather than by
  // a probe that quietly checks a path nothing writes any more. `lint` is a
  // SINGLE-segment id — the topic-less shape #5217's corpus never exercised.
  const derived = oclifCommandFileFor(
    { oclif: { commands: { strategy: 'pattern', target: './dist/commands', glob: '**/*.js' } } },
    LINT_COMMAND_ID,
  );
  expect('#5862 derives the command file', derived.file === 'packages/cli/dist/commands/lint.js', `got ${JSON.stringify(derived)}`);
  const undeclaredTarget = oclifCommandFileFor({ oclif: {} }, LINT_COMMAND_ID);
  expect(
    '#5862 unreadable shape defers, loudly',
    !!undeclaredTarget.unknown && !undeclaredTarget.file,
    `an unreadable oclif block must yield a reason, not a guessed path; got ${JSON.stringify(undeclaredTarget)}`,
  );

  // The content classifier. Its silent-failure mode is narrower than the
  // prerequisite's — a classifier that stopped matching would drive every count
  // to 0 and the ratchet's DOWN direction fails on that — but the `i18n/` prefix
  // is a contract with `os lint --json`, so pin it rather than infer it.
  expect('#5862 counts i18n rules', countI18nRuleIssues(REAL_LINT_REPORT) === 2, `got ${countI18nRuleIssues(REAL_LINT_REPORT)}`);
  expect(
    '#5862 ignores other rules',
    countI18nRuleIssues({ issues: [{ rule: 'schema/unknown-key' }, { rule: 'i18nx/not-ours' }] }) === 0,
    'only the `i18n/` namespace counts',
  );
  expect('#5862 tolerates an issue-less report', countI18nRuleIssues({}) === 0, 'a clean report is 0, never a crash');

  if (failures.length) {
    console.error(`✗ check:i18n-coverage --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('✓ check:i18n-coverage --self-test — the missing-CLI-build and i18n-rule classifiers both go red, and stay distinct.');
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// The prerequisite: this gate runs the BUILT CLI (#5862).
// ---------------------------------------------------------------------------

/**
 * ONE prerequisite and ONE command to satisfy it — never per config, and never
 * phrased so it can be mistaken for a verdict about a config's translations.
 *
 * Exits 1, the same code the real verdict uses: any wrapper that treats non-zero
 * as failure keeps behaving identically, and inventing a second failure code
 * would be a new contract nobody asked for.
 *
 * The remedy is stated at TWO widths on purpose. `CLI_BUILD_FIX` is the command
 * that clears exactly what was checked, and nothing more — this probe measures the
 * CLI and may not claim anything about the rest of the tree. But unlike the
 * neighbouring bundles gate, this one also lints `examples/*`, whose configs import
 * other workspace packages by name; on a never-built tree, clearing only the CLI
 * just moves the wall (measured: `Cannot find module '…/@objectstack/connector-mcp/
 * dist/index.mjs'` from app-showcase). Naming the fuller command as the fuller
 * remedy costs one line and keeps this message from under-prescribing — which is
 * the same defect, one step later, as the diagnosis it replaces.
 */
function reportPrerequisiteNotMet(headline, detail) {
  console.error(
    `\ncheck-i18n-coverage: PREREQUISITE NOT MET — ${headline}\n\n` +
      detail.map((l) => (l ? `  ${l}` : '')).join('\n') +
      `\n\n  Fix:  ${CLI_BUILD_FIX}\n` +
      `        …and on a tree that has never been built, \`pnpm build\`: this gate also\n` +
      `        lints \`examples/*\`, whose configs import other workspace packages.\n\n` +
      `  Nothing was measured: no config was linted and no count was compared, so this\n` +
      `  result says NOTHING about whether any declared label went untranslated — and\n` +
      `  the baseline was left exactly as committed (\`--update\` included).\n` +
      `  (Exit code 1 — but piping this gate reports the PIPE's status, so\n` +
      `  \`pnpm check:i18n-coverage | tail -4\` reads green either way. Use \`echo "EXIT=$?"\`.)`,
  );
  process.exit(1);
}

/**
 * Answered once, before the per-config loop — so a missing build costs one
 * verdict instead of an exception thrown from inside the first example, and
 * costs zero CLI spawns.
 *
 * Probes the exact command FILE the loop needs, not merely `dist/`: an
 * interrupted or partial build leaves the directory behind, and a `dist/` that
 * exists without `commands/lint.js` reproduces the very stack trace this check
 * exists to prevent.
 *
 * When the CLI's package.json shape moves out from under the derivation, this
 * says so on stderr and defers to the in-loop signature net rather than failing:
 * a probe that cannot read the declaration must not turn a correctly-built
 * workspace red. It stays audible either way — the net is the enforcement, this
 * is only the cheap early answer.
 */
function checkCliBuildPrerequisite() {
  const resolved = resolveCliCommandFile(LINT_COMMAND_ID);
  if (resolved.unknown) {
    console.error(`check-i18n-coverage: ${resolved.unknown} — build prerequisite not pre-checked`);
    return;
  }
  if (existsSync(resolved.file)) return;
  reportPrerequisiteNotMet('the workspace CLI is not built', [
    `This gate counts what \`os lint\` reports, and it runs the BUILT CLI.`,
    `${CLI} is only a source stub that hands off to oclif, which`,
    `resolves \`os ${LINT_COMMAND_ID.join(' ')}\` from the compiled output — and that command`,
    `is not there:`,
    ``,
    `  ${resolved.file}`,
  ]);
}

checkCliBuildPrerequisite();

const current = {};
for (const configPath of [...discoverExamples(), ...discoverPackages()]) {
  current[configPath] = countI18nIssues(configPath);
}

if (update) {
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
  console.log(`i18n coverage baseline updated: ${Object.keys(current).length} config(s).`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};

const errors = [];
for (const [file, count] of Object.entries(current)) {
  const allowed = baseline[file];
  if (allowed === undefined) {
    errors.push(
      `${file}: not baselined (${count} untranslated declared string(s)). ` +
        `Translate them, or run \`node scripts/check-i18n-coverage.mjs --update\` to freeze the debt.`,
    );
  } else if (count > allowed) {
    errors.push(
      `${file}: untranslated declared strings grew ${allowed} → ${count}. ` +
        `Something declared a label without translating it for a locale this example claims to support ` +
        `(see \`i18n.supportedLocales\`). Run \`node scripts/check-i18n-bundles.mjs --write\` to scaffold the new keys, then translate them; \`os lint ${file}\` lists them.`,
    );
  }
}
for (const [file, allowed] of Object.entries(baseline)) {
  const now = current[file];
  if (now === undefined) {
    errors.push(
      `${file}: baselined config is gone (was ${allowed}) — ratchet DOWN: ` +
        `run \`node scripts/check-i18n-coverage.mjs --update\` and commit the baseline.`,
    );
  } else if (now < allowed) {
    errors.push(
      `${file}: untranslated declared strings improved ${allowed} → ${now} — ratchet DOWN: ` +
        `run \`node scripts/check-i18n-coverage.mjs --update\` and commit the baseline.`,
    );
  }
}

if (errors.length) {
  console.error(`check-i18n-coverage: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error('  • ' + e);
  process.exit(1);
}
const total = Object.values(current).reduce((a, b) => a + b, 0);
console.log(
  `check-i18n-coverage: OK (${Object.keys(current).length} config(s), ${total} baselined untranslated string(s), none new).`,
);
