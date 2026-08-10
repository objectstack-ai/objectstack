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
// WHAT THIS GATE CANNOT SEE, stated because two other comments once assumed it
// could (#5750). It lints STATIC stack configs, so it measures exactly what a
// config DECLARES. Metadata assembled at RUNTIME is outside it by construction —
// most consequentially the Setup app's navigation, which is a shell of empty
// group anchors filled in by `SETUP_NAV_CONTRIBUTIONS` and by capability
// plugins (ADR-0029 D7). `platform-objects`' extract config and
// `app-nav-translation-parity.test.ts` each excluded those labels and named the
// other side as the owner; the ratchet's 0 for this package was "not looked at
// here", and four Setup nav ids sat untranslated in `zh-CN` under a green run of
// this very script. That half now has its own gate — `pnpm check:app-nav-i18n`
// (`packages/cli/scripts/check-app-nav-i18n.mjs`), which boots the composition
// and judges the merged app. Do not extend this script to cover it: the two ask
// different questions of different inputs, and folding a kernel boot into an
// `os lint` loop would make neither readable.
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
//
// That answered ONE prerequisite. The OTHER one — an example's own workspace
// dependencies unbuilt — kept the original shape until #6033: three bare `throw`s
// inside the per-config measurement, an uncaught exception, and a node stack:
//
//     Error: os lint failed for examples/app-showcase/objectstack.config.ts:
//       Cannot find module '…/@objectstack/connector-mcp/dist/index.mjs'
//         at countI18nIssues (…/check-i18n-coverage.mjs:185:29)
//
// That diagnosis did NOT lie — the missing module is real and actionable, which is
// why #6033 was filed as an observation rather than a defect. What it cost was the
// other eleven configs: the loop died at the second one, so the remaining ten were
// never attempted and their causes — which need not be this one — were never seen.
// #5217's rule is "one cause must not be reported as N results"; this is its
// converse, and one discipline serves both: measure EVERY config, then report every
// DISTINCT cause once, with the configs it covers. A config that cannot be linted is
// now collected (`measureI18nIssues` returns a failure), never thrown.
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

/**
 * The remedy when a config's OWN workspace dependencies were never built (#6033) —
 * distinct from `CLI_BUILD_FIX`, which clears only the CLI. An example config
 * imports workspace packages by name, so a tree with just the CLI built still
 * cannot be linted, and the two remedies must not be confused for each other.
 */
const WORKSPACE_BUILD_FIX = 'pnpm build';
/** …and when the package is not on disk at all, a build alone cannot help. */
const INSTALL_THEN_BUILD_FIX = 'pnpm install && pnpm build';

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

/** The command that reproduces one config's failure by hand, for the reader. */
function rerunFix(configPath) {
  return `node ${CLI} lint ${configPath} --json`;
}

/**
 * One bounded, readable line of evidence. A conclusion needs a reading to stand on,
 * but a reading is not a stack: multi-line output is flattened the way
 * `looksLikeMissingCliCommand` flattens oclif's wrapping, and a long one is cut.
 */
function evidenceLine(text, max = 200) {
  const flat = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * The per-config failure classifier (#6033): WHY one config could not be linted,
 * as a conclusion plus the command that clears it. Pure — string in, verdict out —
 * so `--self-test` drives it with recorded CLI output instead of a build.
 *
 * The one classification worth making is module resolution. On a tree where only
 * the CLI was built, an example whose config imports a workspace package by name
 * fails with node's `Cannot find module`, and the useful thing to say is WHICH
 * package and that the remedy is a build. Everything else keeps the CLI's own
 * words and sends the reader to run the same command by hand: claiming "not built"
 * over a genuinely broken config would be the #5862 defect — a confident diagnosis
 * pointing somewhere innocent — rebuilt one layer down.
 *
 * @param {string} configPath the config being measured, for the rerun command
 * @param {string} text the CLI's own failure text (`report.error`, or a thrown message)
 * @returns {{ reason: string, evidence: string, fix: string }}
 */
function explainConfigFailure(configPath, text) {
  const evidence = evidenceLine(text);
  const missing = String(text ?? '').match(/Cannot find (?:module|package) '([^']+)'/);
  if (missing) {
    const pkg = packageNameFromSpecifier(missing[1]);
    // A specifier that reaches INTO a package's build output is installed but
    // unbuilt; one that names the package alone was never installed at all.
    if (pkg && /(?:^|\/)dist\//.test(missing[1])) {
      return {
        reason: `\`os lint\` could not load the config: \`${pkg}\` is installed but has no build output in this worktree`,
        evidence,
        fix: WORKSPACE_BUILD_FIX,
      };
    }
    return {
      reason: `\`os lint\` could not load the config: ${pkg ? `\`${pkg}\`` : 'a module it imports'} cannot be resolved from this worktree`,
      evidence,
      fix: INSTALL_THEN_BUILD_FIX,
    };
  }
  return {
    reason: '`os lint` failed on this config — the reading below is the CLI\'s own words, not this gate\'s',
    evidence,
    fix: rerunFix(configPath),
  };
}

/**
 * The package a failed specifier belongs to, or '' when it names none. Handles the
 * two shapes node produces: a resolved absolute path (`…/node_modules/@scope/name/
 * dist/index.mjs`) and a bare specifier (`@scope/name/sub`).
 */
function packageNameFromSpecifier(specifier) {
  const marker = 'node_modules/';
  const at = String(specifier ?? '').lastIndexOf(marker);
  const tail = at === -1 ? String(specifier ?? '') : specifier.slice(at + marker.length);
  if (!tail || tail.startsWith('/') || tail.startsWith('.')) return '';
  const parts = tail.split('/');
  const name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return name.endsWith('.mjs') || name.endsWith('.js') || name.endsWith('.ts') ? '' : name;
}

/**
 * Distinct CAUSES, each carrying the configs it explains. Keyed on the CONCLUSION
 * (reason + fix) rather than the raw reading, because one unbuilt package produces
 * a different absolute path per config and those are the same fact told twelve
 * times — exactly the "one cause reported as N results" shape #5217 closed on the
 * neighbouring gate. The first reading is kept as the group's evidence.
 *
 * @param {{configPath: string, reason: string, evidence: string, fix: string}[]} failures
 */
function groupFailuresByCause(failures) {
  const groups = new Map();
  for (const f of failures) {
    const key = JSON.stringify([f.reason, f.fix]);
    const group = groups.get(key) ?? { reason: f.reason, fix: f.fix, evidence: f.evidence, configPaths: [] };
    group.configPaths.push(f.configPath);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Untranslated declared strings `os lint` would show for one config — or WHY that
 * could not be measured.
 *
 * Returns `{ count }` or `{ failure }` and never throws for a per-config problem
 * (#6033), so one unlintable example cannot hide the eleven configs behind it. The
 * one thing that still stops the round from in here is the missing-CLI
 * prerequisite, deliberately: every remaining config would fail for that same
 * single reason (#5862), so continuing would print one environment fact N times.
 *
 * Captured to a FILE rather than a pipe. Node writes stdout synchronously to a
 * file and asynchronously to a pipe, so a command that exits right after a
 * large `console.log` can hand a pipe reader a payload cut off at one 64 KiB
 * buffer — which is exactly what `os lint --json` did on `platform-objects`
 * until the `emitJson` fix. A gate must never be able to read a truncated
 * payload and quietly report a smaller number, so it does not use a pipe at all.
 */
function measureI18nIssues(configPath) {
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

    // The three ways one config can fail to yield a number. Each is that config's
    // OWN cause, so each comes back as a collected failure rather than an
    // exception: the round continues, and the reader gets all of them at once.
    if (!raw.trim()) {
      return {
        failure: {
          reason: '`os lint` produced no output at all — no JSON payload to count',
          // stderr is the only reading there is when stdout was empty. It was
          // already captured for the signature net above; discarding it here would
          // leave the reader a verdict with nothing under it.
          evidence: evidenceLine(stderr),
          fix: rerunFix(configPath),
        },
      };
    }
    let report;
    try {
      report = JSON.parse(raw);
    } catch (err) {
      return {
        failure: {
          reason: `\`os lint\` wrote ${raw.length} byte(s) that are not JSON (${err.message})`,
          evidence: evidenceLine(raw, 160),
          fix: rerunFix(configPath),
        },
      };
    }
    if (report.error) return { failure: explainConfigFailure(configPath, report.error) };
    return { count: countI18nRuleIssues(report) };
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}

/**
 * The round: measure every config, collect the ones that could not be measured,
 * and never let one of them end the round (#6033).
 *
 * `measure` is injected so `--self-test` can prove the collecting behaviour with no
 * CLI and no build — the behaviour CI can never observe, because CI builds the whole
 * workspace before this gate runs and therefore only ever sees the green path.
 *
 * The try/catch is the outer net, not the mechanism: `measureI18nIssues` reports its
 * own failures as values, and anything that still throws (a spawn that fails, an
 * unreadable temp file) is one more config-shaped failure — never a reason for the
 * other eleven to go unmeasured.
 *
 * @param {string[]} configPaths
 * @param {(configPath: string) => {count: number} | {failure: {reason: string, evidence: string, fix: string}}} measure
 */
function measureAllConfigs(configPaths, measure) {
  const current = {};
  const failures = [];
  for (const configPath of configPaths) {
    let result;
    try {
      result = measure(configPath);
    } catch (err) {
      result = { failure: explainConfigFailure(configPath, err?.message ?? String(err)) };
    }
    if (result?.failure) failures.push({ configPath, ...result.failure });
    else current[configPath] = result.count;
  }
  return { current, failures };
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

  // -------------------------------------------------------------------------
  // The per-config failure classifier and the collecting round (#6033). Pinned
  // here or nowhere, for the same reason as the prerequisite above: CI builds the
  // whole workspace before this gate runs, so nothing in CI ever reaches this path.
  // -------------------------------------------------------------------------

  // Recorded VERBATIM from `os lint examples/app-showcase/objectstack.config.ts
  // --json` on a tree where ONLY `@objectstack/cli` had been built (the #6033
  // repro), with the absolute worktree prefix normalised to `/repo`. This exact
  // string is what the CLI puts in `report.error` — i.e. what the gate used to
  // interpolate into a thrown Error and hand to node as a stack.
  const REAL_UNBUILT_DEP_ERROR =
    "Cannot find module '/repo/examples/app-showcase/node_modules/@objectstack/connector-mcp/dist/index.mjs' " +
    "imported from /repo/examples/app-showcase/objectstack.config.bundled_yqbr4ytyonb.mjs";

  const unbuilt = explainConfigFailure('examples/app-showcase/objectstack.config.ts', REAL_UNBUILT_DEP_ERROR);
  expect('#6033 blames the package, not the config', unbuilt.reason.includes('@objectstack/connector-mcp'), `got ${JSON.stringify(unbuilt.reason)}`);
  expect('#6033 concludes "installed but not built"', /has no build output/.test(unbuilt.reason), `got ${JSON.stringify(unbuilt.reason)}`);
  expect('#6033 prescribes the workspace build', unbuilt.fix === WORKSPACE_BUILD_FIX, `got ${JSON.stringify(unbuilt.fix)}`);
  expect('#6033 keeps the CLI reading as evidence', unbuilt.evidence.includes('Cannot find module'), 'a conclusion with no reading under it is not auditable');
  expect('#6033 evidence is one line', !unbuilt.evidence.includes('\n'), 'evidence must be a line, not a stack');

  // A package that is not installed at all cannot be fixed by a build alone.
  const uninstalled = explainConfigFailure('x/y.ts', "Cannot find package '@objectstack/nope' imported from /repo/x/y.ts");
  expect('#6033 uninstalled is not unbuilt', uninstalled.fix === INSTALL_THEN_BUILD_FIX, `got ${JSON.stringify(uninstalled.fix)}`);

  // A genuinely broken config must NOT be told to run a build: sending a reader to
  // a build that changes nothing, over a config that really is at fault, is the
  // #5862 defect (a confident diagnosis pointing somewhere innocent) inverted.
  const brokenConfig = explainConfigFailure('examples/app-crm/objectstack.config.ts', "Duplicate object name 'contacts'");
  expect('#6033 a config error is not a missing build', brokenConfig.fix !== WORKSPACE_BUILD_FIX, `got ${JSON.stringify(brokenConfig.fix)}`);
  expect('#6033 a config error keeps the CLI words', brokenConfig.evidence.includes("Duplicate object name 'contacts'"), `got ${JSON.stringify(brokenConfig.evidence)}`);

  // Anti-#4690 applied to the fallback branch: an unrecognised cause must still
  // yield a COMPLETE verdict. A collected failure with a blank reason or no fix is
  // how this path would go quiet — the report would render an empty bullet and the
  // round would still exit 1 with nothing for the reader to act on.
  for (const [name, sample] of [['unknown wording', 'something nobody has recorded yet'], ['empty', ''], ['absent', undefined]]) {
    const verdict = explainConfigFailure('x/y.ts', sample);
    expect(`#6033 complete verdict (${name})`, !!verdict.reason && !!verdict.fix, `got ${JSON.stringify(verdict)}`);
  }

  // The round itself: one config's failure must not end it. Injected `measure`, so
  // this runs with no CLI and no build. Configs 1 and 3 fail with DIFFERENT causes
  // (one thrown, one returned), 2 and 4 measure.
  const visited = [];
  const round = measureAllConfigs(['a.ts', 'b.ts', 'c.ts', 'd.ts'], (p) => {
    visited.push(p);
    if (p === 'a.ts') throw new Error("Cannot find module '/repo/a/node_modules/@objectstack/spec/dist/index.mjs'");
    if (p === 'c.ts') return { failure: explainConfigFailure(p, "Cannot find module '/repo/c/node_modules/@objectstack/connector-rest/dist/index.mjs'") };
    return { count: 7 };
  });
  expect('#6033 attempts every config', visited.length === 4, `the round stopped after ${visited.length} of 4 config(s)`);
  expect('#6033 collects both failures', round.failures.length === 2, `got ${round.failures.length}`);
  expect('#6033 a thrown failure is collected, not escaped', round.failures.some((f) => f.configPath === 'a.ts'), 'an exception ended the round');
  expect(
    '#6033 keeps the configs that did measure',
    Object.keys(round.current).length === 2 && round.current['b.ts'] === 7 && round.current['d.ts'] === 7,
    `got ${JSON.stringify(round.current)}`,
  );

  // Two different causes stay two; ONE cause shared by several configs is stated
  // once, with the configs it covers — #5217's rule, which the collecting shape
  // must not undo on its way to satisfying #6033.
  expect('#6033 distinct causes stay distinct', groupFailuresByCause(round.failures).length === 2, `got ${groupFailuresByCause(round.failures).length}`);
  const sharedCause = groupFailuresByCause(
    ['a.ts', 'b.ts', 'c.ts'].map((p) => ({
      configPath: p,
      // Same missing package, different absolute path per config — the same fact
      // told three times, which must not become three verdicts.
      ...explainConfigFailure(p, `Cannot find module '/repo/${p}/node_modules/@objectstack/spec/dist/index.mjs'`),
    })),
  );
  expect('#6033 one cause is stated once', sharedCause.length === 1, `got ${sharedCause.length} cause(s) for one missing package`);
  expect('#6033 …carrying every config it covers', sharedCause[0]?.configPaths.length === 3, `got ${JSON.stringify(sharedCause[0]?.configPaths)}`);

  if (failures.length) {
    console.error(`✗ check:i18n-coverage --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('✓ check:i18n-coverage --self-test — the missing-CLI-build, i18n-rule and per-config-failure classifiers all go red, stay distinct, and a failing config does not end the round.');
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
 * The collected verdict for configs that could not be measured (#6033) — one
 * entry per DISTINCT cause, each naming the configs it covers.
 *
 * Reached only after the whole round has been attempted, which is the point: the
 * reader gets every cause at once instead of the first one plus a node stack.
 *
 * It preempts the ratchet comparison, and that is deliberate rather than lazy. A
 * partial round cannot judge this gate's question: an unmeasured config is
 * indistinguishable from a deleted one, so the DOWN direction would tell the reader
 * to `--update` — and `--update` runs before any comparison, so it would freeze the
 * survivors and silently drop the rest, ratcheting real debt out of the baseline.
 * The same invariant `reportPrerequisiteNotMet` states: nothing measured, nothing
 * written.
 *
 * Exits 1, the same code every other verdict here uses.
 */
function reportUnmeasuredConfigs(failures, measuredCount) {
  const groups = groupFailuresByCause(failures);
  const total = failures.length + measuredCount;
  const blocks = groups.map((g, i) =>
    [
      `Cause ${i + 1} of ${groups.length} — ${g.configPaths.length} config(s):`,
      ...g.configPaths.map((p) => `  ${p}`),
      ``,
      `  why:  ${g.reason}`,
      ...(g.evidence ? [`  saw:  ${g.evidence}`] : []),
      `  fix:  ${g.fix}`,
    ]
      .map((l) => (l ? `  ${l}` : ''))
      .join('\n'),
  );
  console.error(
    `\ncheck-i18n-coverage: COULD NOT MEASURE — ${failures.length} of ${total} config(s) failed to lint ` +
      `(${groups.length} distinct cause${groups.length === 1 ? '' : 's'})\n\n` +
      blocks.join('\n\n') +
      `\n\n  Every config was attempted, so the list above is EVERY one that failed — not\n` +
      `  merely the first. One config's failure no longer ends the round (#6033), and a\n` +
      `  cause shared by several configs is stated once, not once per config (#5217).\n\n` +
      `  Nothing was compared: ${measuredCount} config(s) did lint, but a partial round cannot judge\n` +
      `  the ratchet — an unmeasured config is indistinguishable from a deleted one, and\n` +
      `  \`--update\` would freeze the survivors while silently dropping the rest. So this\n` +
      `  result says NOTHING about whether any declared label went untranslated, and the\n` +
      `  baseline was left exactly as committed (\`--update\` included).\n` +
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

const { current, failures: unmeasured } = measureAllConfigs(
  [...discoverExamples(), ...discoverPackages()],
  measureI18nIssues,
);
// Before `--update` writes anything, and before any comparison: a round that could
// not measure every config has no verdict to give and no baseline to rewrite.
if (unmeasured.length) reportUnmeasuredConfigs(unmeasured, Object.keys(current).length);

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
