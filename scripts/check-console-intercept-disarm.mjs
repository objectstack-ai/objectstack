#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-console-intercept-disarm — every package that runs vitest must disarm
// vitest's console interception (`disableConsoleIntercept: true`) in its
// package-root vitest config.
//
// ── The defect this keeps closed (#10374, fix shape landed in #10293) ───────
//
// vitest 4's worker replaces `console` with one that forwards every write to
// the main thread over RPC, and `sendLog` (in vitest's own
// `dist/chunks/console.*.js`) DISCARDS the promise that forwarding returns.
// Worker teardown then runs `await rpcDone()` — which awaits a SNAPSHOT of the
// pending set — followed by `$rejectPendingCalls(...)`. A console RPC created
// after that snapshot is rejected as an UNHANDLED error, and vitest fails the
// run even though every assertion passed. The recognisable signature:
//
//     Test Files  N passed (N)
//          Tests  X passed (X)
//         Errors  1 error
//     EnvironmentTeardownError: [vitest-worker]: Closing rpc while
//       "onUserConsoleLog" was pending
//
// ⚠️ The file that error names is where the rejection ORIGINATED (the file the
// worker happened to be on), not where the bug is. The window is load-width —
// ~1ms idle, wide enough for any leaked timer or fire-and-forget write on a
// saturated runner — which is why it presents as a merge-queue flake that "no
// one can reproduce". Full mechanism, reproduction and measured costs:
// `examples/app-showcase/vitest.config.ts` (the disarm's docblock) and
// `examples/app-showcase/test/vitest-console-teardown-race.test.ts` (the pin
// that proves the mechanism is still live in the installed vitest, and fails
// if showcase's disarm is removed).
//
// Setting `disableConsoleIntercept: true` removes the MECHANISM rather than
// narrowing the trigger: with no console RPC there is no pending call for
// `$rejectPendingCalls` to reject, so no future late `console.log` in any
// package can redden a green run this way.
//
// ── Why a gate and not a sweep (#10374's measured population) ───────────────
//
// The sweep that accompanied this gate disarmed every suite it could find —
// and the population it found was already stale-prone in both directions:
// 38 vitest configs on 2026-08-21 had become 43 by 2026-08-30 (five new
// configs in nine days, every one of them arriving with the intercept armed),
// and 29 MORE packages ran vitest with no config file at all, invisible to
// any count of `vitest.config.ts`. A sweep's terminal state leaves the next
// package unguarded, and the symptom of the omission is a suite that is green
// for months and then fails a merge-queue run no one can reproduce. The
// invariant has to be asserted mechanically or it is not asserted at all.
//
// ── What this checks ────────────────────────────────────────────────────────
//
// For every workspace package (from `pnpm-workspace.yaml`'s globs) whose
// `scripts` invoke vitest:
//
//   1. A package-root vitest config must exist (`vitest.config.{ts,mts,cts,
//      js,mjs,cjs}`). A package with no config runs vitest's defaults, and
//      the default arms the intercept. One exception, because it is not a
//      waiver: a package with no config whose EVERY vitest script names
//      `--root <dir>` never loads a config of its own — vitest looks for its
//      config from that root (and resolves `--config` against it), so the
//      config found there is the one judged in the package's place, by the
//      rules below (`rootRedirectedConfigs`). The `ui/` packages run that way:
//      `ui/vitest.config.mts` is their one test config, and `ui/AGENTS.md`
//      forbids a per-package one.
//   2. Its comment-masked source must set `disableConsoleIntercept: true` —
//      masked via `scripts/js-comment-mask.mjs`, so a docblock ABOUT the
//      setting (this repo's configs carry long rationale comments) never
//      satisfies the check, and a commented-out setting doesn't either.
//   3. `disableConsoleIntercept: false` at package root is refused loudly —
//      it re-arms the mechanism while reading as a considered choice.
//
// Deliberately OUT of scope: configs below the package root, e.g.
// `examples/app-showcase/test/fixtures/late-console-teardown/
// vitest.unguarded.config.ts` — that fixture sets `false` ON PURPOSE (it is
// the positive control the teardown-race pin measures the defect with), and
// scoping this gate to package-root configs is what lets it exist.
//
// No waiver ledger, deliberately: no suite in the repo today depends on the
// interception (measured: no package-root config sets `onConsoleLog`, and the
// full-population measurement behind #10374 found the intercepted output of
// every suite was being DISCARDED by the non-TTY default reporter's
// `silent: 'passed-only'`). If a real dependency on interception ever
// appears, add a shrink-only ledger here with the package and the reason —
// never widen the scan away from the package.
//
// Exit 0: every vitest-running package is disarmed. Exit 1: findings (each
// names the package, what is missing, and the exact line to add). Exit 2:
// the gate itself could not measure (broken workspace file, empty population)
// — never reported as a pass.
//
//   node scripts/check-console-intercept-disarm.mjs
//   node scripts/check-console-intercept-disarm.mjs --self-test

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { maskComments, maskCommentsAndLiterals } from './js-comment-mask.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { readWorkspaceGlobs } from './workspace-enumerator.mjs';

// Why this gate reads `maskCommentsAndLiterals` — the tree's one
// comments+literals projection, imported rather than re-derived here (#15776).
// This gate looks for a bare code-position `disableConsoleIntercept: true`, so
// unlike the gates whose signal IS a string literal, a quoted spelling here is
// never the real setting — it is prose (an error message, a doc snippet) and
// blanking it keeps prose from satisfying the check. The boundary this accepts:
// a config spelling the KEY as a quoted property
// (`'disableConsoleIntercept': true`) reds the gate even though vitest would
// honour it — the failure is loud, names the file, and the remedy is the
// unquoted spelling every other config uses.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const VITEST_CONFIG_NAMES = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
];

// The population this gate reads, declared for `scripts/pm/dispatch-gates.mjs`
// (the ROOT_DIR_WATCH_HINTS idiom), so a card that edits a package-root
// manifest or vitest config is told about this gate before CI is. `scan()`
// below opens exactly two files per workspace package: its `package.json` and
// its package-root vitest config. Nothing else under a package moves the
// verdict, so a new test file under an existing package derives nothing.
//
// One pair per glob `workspaceGlobs()` reads, in that order. A `<dir>/*` glob
// is spelled `<dir>/*/package.json` and `<dir>/*/vitest.config.*` — the glob in
// a non-final segment makes the derivation judge it as a pattern, one path
// segment per `*`. A literal member `<dir>` would be spelled `<dir>/package.json`
// and `<dir>/vitest.config` (`watchHintsForGlob`): with no glob ahead of it a
// trailing `.*` is collapsed to `<dir>/vitest.config.`, which names nothing,
// while the bare stem reaches every one of VITEST_CONFIG_NAMES through the
// derivation's module-extension equality: `ui` is one. The config a
// `--root`-redirected package is judged by (`ui/vitest.config.mts` for the
// `ui/` packages) is the `ui` member's own, so its pair covers that read too.
//
// ⛔ A literal array, never computed from the globs (`check:watch-hint-literal`):
// the derivation reads source text, so a computed list contributes no hint.
// Hand-kept, and `main()` holds it to the workspace file: a glob in
// `pnpm-workspace.yaml` with no pair here, or a pair here for a glob that file
// no longer lists, is a finding (`watchHintDrift`). Not readable from the
// repo-root files themselves — `pnpm-workspace.yaml` and `vitest.preset.mts`
// carry no separator, so no spelling of them is a hint the derivation admits.
export const ROOT_DIR_WATCH_HINTS = [
  'packages/*/package.json',
  'packages/*/vitest.config.*',
  'packages/apps/*/package.json',
  'packages/apps/*/vitest.config.*',
  'packages/drivers/*/package.json',
  'packages/drivers/*/vitest.config.*',
  'packages/plugins/*/package.json',
  'packages/plugins/*/vitest.config.*',
  'packages/qa/*/package.json',
  'packages/qa/*/vitest.config.*',
  'packages/triggers/*/package.json',
  'packages/triggers/*/vitest.config.*',
  'packages/services/*/package.json',
  'packages/services/*/vitest.config.*',
  'packages/adapters/*/package.json',
  'packages/adapters/*/vitest.config.*',
  'packages/connectors/*/package.json',
  'packages/connectors/*/vitest.config.*',
  'apps/*/package.json',
  'apps/*/vitest.config.*',
  'examples/*/package.json',
  'examples/*/vitest.config.*',
  'ui/package.json',
  'ui/vitest.config',
  'ui/packages/*/package.json',
  'ui/packages/*/vitest.config.*',
  'ui/apps/*/package.json',
  'ui/apps/*/vitest.config.*',
  'ui/examples/*/package.json',
  'ui/examples/*/vitest.config.*',
];

const DISARM_RE = /\bdisableConsoleIntercept\s*:\s*true\b/;
const REARM_RE = /\bdisableConsoleIntercept\s*:\s*false\b/;
const PROJECTS_RE = /\bprojects\s*:\s*\[/;
const TEST_BLOCK_RE = /\btest\s*:\s*\{/g;

/**
 * For a config that defines inline `projects`, the ROOT-level setting is
 * INERT: measured on vitest 4.1.10 (probe fixture: root
 * `disableConsoleIntercept: true` + one inline project + a logging test —
 * the reporter received the console RPC all the same, byte-identical to the
 * armed control). So a projects config must carry the disarm inside EVERY
 * project's own `test` block, and a root-only spelling is precisely the
 * declared-≠-enforced shape this repo refuses. Brace-matching is safe here
 * because the source arrives with comments AND string/template content
 * blanked — no brace inside prose survives to miscount.
 *
 * @returns {string[]} the masked bodies of every `test: {...}` block that
 * sits INSIDE the projects array.
 */
function projectTestBlocks(masked) {
  const start = PROJECTS_RE.exec(masked);
  if (!start) return [];
  const openBracket = masked.indexOf('[', start.index);
  let depth = 0;
  let end = -1;
  for (let i = openBracket; i < masked.length; i++) {
    if (masked[i] === '[') depth += 1;
    else if (masked[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [];
  const region = masked.slice(openBracket, end + 1);
  const blocks = [];
  TEST_BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = TEST_BLOCK_RE.exec(region)) !== null) {
    const open = openBracket + m.index + m[0].length - 1; // the '{'
    let d = 0;
    for (let i = open; i <= end; i++) {
      if (masked[i] === '{') d += 1;
      else if (masked[i] === '}') {
        d -= 1;
        if (d === 0) {
          blocks.push(masked.slice(open, i + 1));
          break;
        }
      }
    }
  }
  return blocks;
}
// The shared preset at the repo root. A package-root config whose ONLY
// statement re-exports it (`export { default } from '<rel>/vitest.preset.mts'`)
// takes its whole effective config from the preset, so the gate judges the
// preset's source in that config's place: one disarm, read once, covering every
// re-exporter, and a preset that loses it reds every one of them by name.
// Deliberately narrow: a config that imports the preset and merges or wraps it
// is NOT recognised (what it exports is no longer the preset's object), so it
// carries the setting itself, as before.
const PRESET_NAME = 'vitest.preset.mts';
const PRESET_REEXPORT_RE = /^\s*export\s*\{\s*default\s*\}\s*from\s*(['"])([^'"]+)\1\s*;?\s*$/;

/**
 * @returns {string | null} the repo-relative preset path when `source` is the
 * bare re-export of THIS workspace's root preset, else null.
 */
function presetReexport(root, dir, source) {
  const m = PRESET_REEXPORT_RE.exec(maskComments(source));
  if (!m) return null;
  return resolve(dir, m[2]) === join(root, PRESET_NAME) ? PRESET_NAME : null;
}

/** A script that runs vitest — `vitest run`, `vitest --coverage`, a bare `vitest`. */
const VITEST_SCRIPT_RE = /(?:^|\s|&&|;)vitest(?:\s|$)/;
const ROOT_FLAG_RE = /\s(?:--root|-r)(?:=|\s+)(\S+)/;
const CONFIG_FLAG_RE = /\s(?:--config|-c)(?:=|\s+)(\S+)/;

/**
 * For a package with NO package-root config: the configs vitest loads when
 * every vitest script names `--root`. vitest (4.1, `createVitest`) resolves
 * `--config` against that root and otherwise looks for `vitest.config.*` from
 * it, never from the package directory. Only the flags of the vitest command
 * itself are read (up to the next `&&`, `||`, `;` or `|`).
 *
 * @returns {string[] | null} absolute config paths, or null when any vitest
 * script runs without `--root` or names a root holding no config — the
 * no-config finding then stands.
 */
function rootRedirectedConfigs(dir, vitestScripts) {
  const configs = new Set();
  for (const script of vitestScripts) {
    const command = script.slice(script.search(VITEST_SCRIPT_RE)).split(/&&|\|\||;|\|/)[0];
    const rootFlag = ROOT_FLAG_RE.exec(command);
    if (!rootFlag) return null;
    const runRoot = resolve(dir, rootFlag[1]);
    const configFlag = CONFIG_FLAG_RE.exec(command);
    const config = configFlag
      ? resolve(runRoot, configFlag[1])
      : VITEST_CONFIG_NAMES.map((name) => join(runRoot, name)).find((path) => existsSync(path));
    if (!config || !existsSync(config)) return null;
    configs.add(config);
  }
  return [...configs];
}

const REMEDY = `    // Late console writes must not redden a green suite (#10374) — see the
    // mechanism docblock in examples/app-showcase/vitest.config.ts. Enforced
    // by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,`;

/**
 * Expand `pnpm-workspace.yaml`'s package globs. Every glob in that file is
 * either a literal directory or a single-level `<dir>/*`; this expander
 * refuses anything wider so a future workspace-file shape FAILS the gate
 * instead of silently emptying its population.
 */
export function workspacePackageDirs(root) {
  const dirs = [];
  for (const glob of workspaceGlobs(root)) {
    if (glob.endsWith('/*')) {
      const base = join(root, glob.slice(0, -2));
      if (!existsSync(base)) continue;
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(base, entry.name);
        if (existsSync(join(dir, 'package.json'))) dirs.push(dir);
      }
    } else if (!glob.includes('*')) {
      const dir = join(root, glob);
      if (existsSync(join(dir, 'package.json'))) dirs.push(dir);
    } else {
      throw new Error(
        `pnpm-workspace.yaml glob '${glob}' is wider than '<dir>/*' — teach ` +
          `workspacePackageDirs() the new shape before trusting this gate again`,
      );
    }
  }
  return dirs;
}

/**
 * `pnpm-workspace.yaml`'s `packages:` globs, in file order — the repo's one
 * parse (`scripts/workspace-enumerator.mjs`), which skips a whole-line comment
 * inside the list instead of ending the list there. Throws when none parse.
 */
export function workspaceGlobs(root) {
  return readWorkspaceGlobs(root);
}

/**
 * The watch-hint pair one workspace glob owes `ROOT_DIR_WATCH_HINTS`, spelled
 * the way that declaration's comment explains. A glob wider than `<dir>/*` owes
 * nothing here: `workspacePackageDirs()` already refuses it, loudly.
 */
export function watchHintsForGlob(glob) {
  if (glob.endsWith('/*')) return [`${glob}/package.json`, `${glob}/vitest.config.*`];
  if (!glob.includes('*')) return [`${glob}/package.json`, `${glob}/vitest.config`];
  return [];
}

/**
 * Where `ROOT_DIR_WATCH_HINTS` and the workspace globs disagree: `missing` are
 * pairs a listed glob owes and the declaration lacks (a package there edits its
 * config and no dispatch derivation names this gate); `stale` are declared
 * hints no listed glob owes (a lead for a population this gate no longer reads).
 */
export function watchHintDrift(globs, hints = ROOT_DIR_WATCH_HINTS) {
  const owed = globs.flatMap(watchHintsForGlob);
  return {
    missing: owed.filter((h) => !hints.includes(h)),
    stale: hints.filter((h) => !owed.includes(h)),
  };
}

function watchHintDriftFindings(root) {
  const { missing, stale } = watchHintDrift(workspaceGlobs(root));
  const findings = [];
  if (missing.length > 0) {
    findings.push(
      `ROOT_DIR_WATCH_HINTS lacks ${missing.join(', ')} — pnpm-workspace.yaml lists the glob, so a ` +
        `card editing a package-root manifest or vitest config there is not told about this gate ` +
        `until CI. Add the pair to the declaration in scripts/check-console-intercept-disarm.mjs.`,
    );
  }
  if (stale.length > 0) {
    findings.push(
      `ROOT_DIR_WATCH_HINTS declares ${stale.join(', ')}, which no pnpm-workspace.yaml glob owes — ` +
        `remove it from the declaration in scripts/check-console-intercept-disarm.mjs.`,
    );
  }
  return findings;
}

/** @returns {{findings: string[], vitestPackages: number}} */
export function scan(root) {
  const findings = [];
  let vitestPackages = 0;
  for (const dir of workspacePackageDirs(root)) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch (error) {
      findings.push(`${rel(root, dir)}/package.json: unreadable (${error.message})`);
      continue;
    }
    const vitestScripts = Object.values(manifest.scripts ?? {}).filter(
      (s) => typeof s === 'string' && VITEST_SCRIPT_RE.test(s),
    );
    if (vitestScripts.length === 0) continue;
    vitestPackages += 1;

    const configName = VITEST_CONFIG_NAMES.find((name) => existsSync(join(dir, name)));
    if (configName) {
      const finding = judgeConfig(root, join(dir, configName), `${rel(root, dir)}/${configName}`);
      if (finding) findings.push(finding);
      continue;
    }
    const redirected = rootRedirectedConfigs(dir, vitestScripts);
    if (!redirected) {
      findings.push(
        `${rel(root, dir)}: runs vitest with NO package-root vitest config — vitest's ` +
          `default ARMS console interception, exposing this suite to the #10374 ` +
          `teardown race. Add a vitest.config.ts whose test block carries:\n${REMEDY}`,
      );
      continue;
    }
    for (const config of redirected) {
      const label =
        `${rel(root, dir)} (its vitest scripts run with --root, so vitest loads ` +
        `${rel(root, config)}, which the gate judges in its place)`;
      const finding = judgeConfig(root, config, label);
      if (finding) findings.push(finding);
    }
  }
  return { findings, vitestPackages };
}

/**
 * The verdict on one vitest config: a finding naming `label`, or null when it
 * disarms. A bare re-export of the root preset is judged as the preset.
 */
function judgeConfig(root, configPath, label) {
  const source = readFileSync(configPath, 'utf8');
  const preset = presetReexport(root, dirname(configPath), source);
  const masked = maskCommentsAndLiterals(preset ? readFileSync(join(root, preset), 'utf8') : source);
  const via = preset ? ` (via its re-export of ${preset}, which the gate judges in its place)` : '';
  if (REARM_RE.test(masked)) {
    return (
      `${label}${via}: sets disableConsoleIntercept: FALSE — this ` +
      `re-arms the #10374 teardown race at the package root. The only sanctioned ` +
      `home for that value is a fixture config BELOW the package root (the ` +
      `teardown-race pin's positive control). Set it to true, or move the config ` +
      `under the fixture directory that needs it.`
    );
  }
  if (!DISARM_RE.test(masked)) {
    return (
      `${label}${via}: does not set disableConsoleIntercept: true ` +
      `(a comment about it does not count) — this suite pays a console RPC per ` +
      `write and any late console.log can fail its fully green run ` +
      `(EnvironmentTeardownError: [vitest-worker]: Closing rpc while ` +
      `"onUserConsoleLog" was pending). Add to the test block:\n${REMEDY}`
    );
  }
  if (PROJECTS_RE.test(masked)) {
    const blocks = projectTestBlocks(masked);
    const undisarmed = blocks.filter((b) => !DISARM_RE.test(b));
    if (blocks.length === 0 || undisarmed.length > 0) {
      return (
        `${label}${via}: defines inline projects, and ` +
        `${blocks.length === 0 ? 'no project test block could be read' : `${undisarmed.length} of ${blocks.length} project test block(s) lack the setting`} ` +
        `— a ROOT-level disableConsoleIntercept is INERT for project runs ` +
        `(measured on vitest 4.1.10: a probe project's console write still ` +
        `arrived over RPC with the root disarm in place). Put\n${REMEDY}\n` +
        `inside EVERY project's own test block.`
      );
    }
  }
  return null;
}

function rel(root, path) {
  return path.startsWith(root) ? path.slice(root.length + 1) : path;
}

function main() {
  let result;
  try {
    result = scan(REPO_ROOT);
    result.driftFindings = watchHintDriftFindings(REPO_ROOT);
  } catch (error) {
    console.error(`check-console-intercept-disarm: MEASUREMENT FAILED — ${error.message}`);
    process.exit(2);
  }
  const { findings, vitestPackages, driftFindings } = result;
  if (vitestPackages === 0) {
    console.error(
      'check-console-intercept-disarm: MEASUREMENT FAILED — the scan found ZERO ' +
        'vitest-running packages, and this repo has dozens. The population went ' +
        'missing, which is not the same fact as "everything is disarmed".',
    );
    process.exit(2);
  }
  if (findings.length > 0) {
    console.error(
      `check-console-intercept-disarm: ${findings.length} package(s) exposed to the ` +
        `vitest late-console teardown race (#10374):\n\n${findings.join('\n\n')}\n`,
    );
  }
  if (driftFindings.length > 0) {
    console.error(
      `check-console-intercept-disarm: the declared watch population has drifted from ` +
        `pnpm-workspace.yaml:\n\n${driftFindings.join('\n\n')}\n`,
    );
  }
  if (findings.length > 0 || driftFindings.length > 0) process.exit(1);
  console.log(
    `OK: ${vitestPackages} vitest-running package(s), every one disarms console ` +
      `interception at the package root.`,
  );
}

// ── self-test ───────────────────────────────────────────────────────────────
//
// Builds a throwaway workspace in $TMPDIR per case. The cases pin the verdict
// DIRECTION of every rule above — most importantly that prose never satisfies
// the check (case 5) and that a fixture config below the package root is
// invisible (case 6): those are the two silent-in-the-green-direction bugs a
// textual gate can grow.

// A package name with a `/` is a repo-relative directory (for a fixture whose
// `workspaceYaml` lists more than `packages/*`); a bare name lives under
// packages/. A `rootFiles` path may name a subdirectory.
function buildWorkspace(caseDir, packages, rootFiles = {}, workspaceYaml = 'packages:\n  - packages/*\n') {
  mkdirSync(join(caseDir, 'packages'), { recursive: true });
  writeFileSync(join(caseDir, 'pnpm-workspace.yaml'), workspaceYaml);
  for (const [file, content] of Object.entries(rootFiles)) {
    mkdirSync(dirname(join(caseDir, file)), { recursive: true });
    writeFileSync(join(caseDir, file), content);
  }
  for (const [name, files] of Object.entries(packages)) {
    const dir = name.includes('/') ? join(caseDir, name) : join(caseDir, 'packages', name);
    mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), content);
    }
  }
}

const TEST_MANIFEST = JSON.stringify({ name: 'x', scripts: { test: 'vitest run' } });
const QUIET_MANIFEST = JSON.stringify({ name: 'x', scripts: { build: 'tsup' } });
const DISARMED = `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { disableConsoleIntercept: true } });
`;
const REEXPORT = `// nothing of its own\nexport { default } from '../../vitest.preset.mts';\n`;
// The `ui/` shape: a nested workspace root whose packages run vitest with
// `--root ../..` and carry no config of their own. Directory names are
// assembled from segments so no fixture string reads as a path literal here.
const NESTED = 'nested';
const NESTED_PKG = [NESTED, 'packages', 'a'].join('/');
const NESTED_YAML = `packages:\n  - packages/*\n  # a comment line between globs\n\n  - ${NESTED}\n  - ${NESTED}/packages/*\n`;
const rootRunManifest = (extra = '') =>
  JSON.stringify({ name: 'n', scripts: { test: `vitest run --root ../.. packages/a/${extra}` } });

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-console-intercept-disarm self-test reached its verdict';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures` used to be this self-test's ONLY success condition, so "every case
// held" and "the cases never ran" printed the same line. Closed the way
// PR #13487 validated on check-doc-authoring: what is pinned is the registered
// NAMES, not a number. The floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count.
//
// This file declares ONE battery, opened at the top of the self-test body. Its
// blocks are headed by unmarked prose comments, so it carries fewer than the two
// named section banners the sectioning criterion needs, and ⛔ a comment is NOT
// promoted to a section head — that is a judgement per comment this transplant
// does not make. The hoisted single battery is the shape PR #14896, PR #15003
// and PR #15217 landed for exactly this case.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The count is a FLOOR, not an equality — adding cases is ordinary work and must
// not red. A battery BELOW its floor means cases stopped running; the remedy is
// to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'check-console-intercept-disarm self-test': 21,
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
  battery('check-console-intercept-disarm self-test');
  // The thunk PR #15198 measured: it registers the case and then runs the
  // existing site VERBATIM, so no assertion condition is inverted or rewritten
  // and the sink keeps its own semantics. Registration happens whether or not
  // the site fires, which is what makes the count a floor on cases RUN rather
  // than a count of failures.
  const check = (fn) => {
    registerCase();
    fn();
  };
  const cases = [
    {
      name: 'disarmed package passes',
      packages: { a: { 'package.json': TEST_MANIFEST, 'vitest.config.ts': DISARMED } },
      expectFindings: 0,
    },
    {
      name: 'config without the setting fails',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'vitest.config.ts': `export default { test: { globals: true } };\n`,
        },
      },
      expectFindings: 1,
      expectText: 'does not set disableConsoleIntercept',
    },
    {
      name: 'vitest script with no config fails',
      packages: { a: { 'package.json': TEST_MANIFEST } },
      expectFindings: 1,
      expectText: 'NO package-root vitest config',
    },
    {
      name: 'explicit false at package root fails',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'vitest.config.ts': `export default { test: { disableConsoleIntercept: false } };\n`,
        },
      },
      expectFindings: 1,
      expectText: 'FALSE',
    },
    {
      name: 'a comment about the setting does not satisfy the check',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'vitest.config.ts':
            `// disableConsoleIntercept: true — explained here, set nowhere\n` +
            `/* disableConsoleIntercept: true */\n` +
            `export default { test: { globals: true } };\n`,
        },
      },
      expectFindings: 1,
      expectText: 'a comment about it does not count',
    },
    {
      name: 'a fixture config below the package root is out of scope',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'vitest.config.ts': DISARMED,
          'test/fixtures/race/vitest.unguarded.config.ts':
            `export default { test: { disableConsoleIntercept: false } };\n`,
        },
      },
      expectFindings: 0,
    },
    {
      name: 'a package that never runs vitest is ignored',
      packages: { a: { 'package.json': QUIET_MANIFEST } },
      expectFindings: 0,
      expectVitestPackages: 0,
    },
    {
      name: 'projects config with only a ROOT disarm fails (root is inert for projects)',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'vitest.config.ts':
            `export default { test: { disableConsoleIntercept: true, projects: [\n` +
            `  { test: { name: 'p1', include: ['x'] } },\n` +
            `  { test: { name: 'p2', disableConsoleIntercept: true } },\n` +
            `] } };\n`,
        },
      },
      expectFindings: 1,
      expectText: 'INERT for project runs',
    },
    {
      name: 'projects config disarmed in every project passes',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'vitest.config.ts':
            `export default { test: { projects: [\n` +
            `  { test: { name: 'p1', disableConsoleIntercept: true } },\n` +
            `  { test: { name: 'p2', disableConsoleIntercept: true } },\n` +
            `] } };\n`,
        },
      },
      expectFindings: 0,
    },
    {
      name: 'string-guarded config: setting inside a template literal does not count',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'vitest.config.ts':
            'const doc = `disableConsoleIntercept: true`;\n' +
            `export default { test: { globals: true } };\n`,
        },
      },
      // String/template content is blanked before matching, so a template
      // literal spelling the setting never satisfies the gate.
      expectFindings: 1,
      expectText: 'does not set disableConsoleIntercept',
    },
    {
      name: 'a bare re-export of a disarmed root preset passes',
      rootFiles: { 'vitest.preset.mts': DISARMED },
      packages: { a: { 'package.json': TEST_MANIFEST, 'vitest.config.ts': REEXPORT } },
      expectFindings: 0,
    },
    {
      name: 'a re-export of a preset that does not disarm fails, naming the preset',
      rootFiles: { 'vitest.preset.mts': `export default { test: { globals: true } };\n` },
      packages: { a: { 'package.json': TEST_MANIFEST, 'vitest.config.ts': REEXPORT } },
      expectFindings: 1,
      expectText: 'via its re-export of vitest.preset.mts',
    },
    {
      name: 'a re-export of a preset that re-arms fails',
      rootFiles: { 'vitest.preset.mts': `export default { test: { disableConsoleIntercept: false } };\n` },
      packages: { a: { 'package.json': TEST_MANIFEST, 'vitest.config.ts': REEXPORT } },
      expectFindings: 1,
      expectText: 'FALSE',
    },
    {
      name: 'a re-export of some OTHER file is judged as the config itself (fails)',
      rootFiles: { 'vitest.preset.mts': DISARMED, 'other.mts': DISARMED },
      packages: {
        a: { 'package.json': TEST_MANIFEST, 'vitest.config.ts': `export { default } from '../../other.mts';\n` },
      },
      expectFindings: 1,
      expectText: 'does not set disableConsoleIntercept',
    },
    {
      name: 'a config that imports the preset and wraps it is not the preset (fails without its own setting)',
      rootFiles: { 'vitest.preset.mts': DISARMED },
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'vitest.config.ts':
            `import preset from '../../vitest.preset.mts';\n` +
            `export { default } from '../../vitest.preset.mts';\n` +
            `export const extra = { test: { globals: true }, preset };\n`,
        },
      },
      expectFindings: 1,
      expectText: 'does not set disableConsoleIntercept',
    },
    {
      name: 'a comment line between workspace globs keeps every glob after it',
      workspaceYaml: NESTED_YAML,
      rootFiles: { [`${NESTED}/package.json`]: TEST_MANIFEST },
      packages: {},
      expectGlobs: ['packages/*', NESTED, `${NESTED}/packages/*`],
      expectFindings: 1,
      expectText: 'NO package-root vitest config',
    },
    {
      name: 'a --root package with no config is judged by the disarmed config at that root',
      workspaceYaml: NESTED_YAML,
      rootFiles: { [`${NESTED}/package.json`]: QUIET_MANIFEST, [`${NESTED}/vitest.config.ts`]: DISARMED },
      packages: { [NESTED_PKG]: { 'package.json': rootRunManifest() } },
      expectFindings: 0,
      expectVitestPackages: 1,
    },
    {
      name: 'a --root package fails when the config at that root does not disarm, naming that config',
      workspaceYaml: NESTED_YAML,
      rootFiles: {
        [`${NESTED}/package.json`]: QUIET_MANIFEST,
        [`${NESTED}/vitest.config.ts`]: `export default { test: { globals: true } };\n`,
      },
      packages: { [NESTED_PKG]: { 'package.json': rootRunManifest() } },
      expectFindings: 1,
      expectText: `vitest loads ${NESTED}/vitest.config.ts`,
    },
    {
      name: 'a --config beside --root is resolved against that root',
      workspaceYaml: NESTED_YAML,
      rootFiles: {
        [`${NESTED}/package.json`]: QUIET_MANIFEST,
        [`${NESTED}/vitest.config.ts`]: DISARMED,
        [`${NESTED}/other.config.mts`]: `export default { test: { globals: true } };\n`,
      },
      packages: { [NESTED_PKG]: { 'package.json': rootRunManifest(' --config other.config.mts') } },
      expectFindings: 1,
      expectText: `vitest loads ${NESTED}/other.config.mts`,
    },
    {
      name: 'one vitest script without --root keeps the no-config finding',
      workspaceYaml: NESTED_YAML,
      rootFiles: { [`${NESTED}/package.json`]: QUIET_MANIFEST, [`${NESTED}/vitest.config.ts`]: DISARMED },
      packages: {
        [NESTED_PKG]: {
          'package.json': JSON.stringify({
            name: 'n',
            scripts: { test: 'vitest run --root ../.. packages/a/', 'test:watch': 'vitest' },
          }),
        },
      },
      expectFindings: 1,
      expectText: 'NO package-root vitest config',
    },
  ];

  let failures = 0;
  for (const testCase of cases) {
    const caseDir = mkdtempSync(join(tmpdir(), 'ci-disarm-'));
    try {
      buildWorkspace(caseDir, testCase.packages, testCase.rootFiles, testCase.workspaceYaml);
      const { findings, vitestPackages } = scan(caseDir);
      const problems = [];
      if (testCase.expectGlobs && workspaceGlobs(caseDir).join('|') !== testCase.expectGlobs.join('|')) {
        problems.push(`expected globs ${testCase.expectGlobs.join(', ')}, parsed ${workspaceGlobs(caseDir).join(', ')}`);
      }
      if (findings.length !== testCase.expectFindings) {
        problems.push(`expected ${testCase.expectFindings} finding(s), got ${findings.length}`);
      }
      if (testCase.expectText && !findings.some((f) => f.includes(testCase.expectText))) {
        problems.push(`no finding contains '${testCase.expectText}'`);
      }
      if (
        testCase.expectVitestPackages !== undefined &&
        vitestPackages !== testCase.expectVitestPackages
      ) {
        problems.push(`expected ${testCase.expectVitestPackages} vitest package(s), got ${vitestPackages}`);
      }
check(() => {
        if (problems.length > 0) {
          failures += 1;
          console.error(`self-test FAIL: ${testCase.name}\n  ${problems.join('\n  ')}`);
          for (const f of findings) console.error(`  finding: ${f.split('\n')[0]}`);
        }
});
    } finally {
      rmSync(caseDir, { recursive: true, force: true });
    }
  }

  // Anti-vacuity over the REAL tree: the scan must see the real population.
  const real = scan(REPO_ROOT);
check(() => {
    if (real.vitestPackages < 60) {
      failures += 1;
      console.error(
        `self-test FAIL: real-tree scan sees only ${real.vitestPackages} vitest-running ` +
          `package(s); the population this gate was written against had 72. The ` +
          `workspace expansion has gone blind, which would pass every future arrival.`,
      );
    }
});

  // The declared watch population (ROOT_DIR_WATCH_HINTS) against the REAL
  // workspace file, and the drift reading in both directions. Fixture globs are
  // assembled from segments so no fixture string reads as a path literal of
  // this gate's own.
  const realDrift = watchHintDrift(workspaceGlobs(REPO_ROOT));
check(() => {
    if (realDrift.missing.length > 0 || realDrift.stale.length > 0) {
      failures += 1;
      console.error(
        `self-test FAIL: ROOT_DIR_WATCH_HINTS has drifted from pnpm-workspace.yaml — ` +
          `missing: ${realDrift.missing.join(', ') || 'none'}; stale: ${realDrift.stale.join(', ') || 'none'}.`,
      );
    }
});
  const extraGlob = ['fixture-root', '*'].join('/');
  const addedGlob = watchHintDrift([...workspaceGlobs(REPO_ROOT), extraGlob]);
check(() => {
    const want = watchHintsForGlob(extraGlob);
    if (want.length !== 2 || addedGlob.missing.join('|') !== want.join('|') || addedGlob.stale.length !== 0) {
      failures += 1;
      console.error(`self-test FAIL: a workspace glob the declaration lacks is not read as missing: ${JSON.stringify(addedGlob)}`);
    }
});
  const droppedGlob = watchHintDrift(workspaceGlobs(REPO_ROOT).filter((g) => g !== workspaceGlobs(REPO_ROOT)[0]));
check(() => {
    const want = watchHintsForGlob(workspaceGlobs(REPO_ROOT)[0]);
    if (droppedGlob.stale.join('|') !== want.join('|') || droppedGlob.missing.length !== 0) {
      failures += 1;
      console.error(`self-test FAIL: a declared pair no workspace glob owes is not read as stale: ${JSON.stringify(droppedGlob)}`);
    }
});
check(() => {
    // A literal member is spelled with the bare config STEM, never a trailing
    // `.*` (which the derivation collapses to a name no file has); a `<dir>/*`
    // member keeps the `.*`, and a wider glob owes nothing.
    const literal = watchHintsForGlob('fixture-root');
    const starred = watchHintsForGlob(extraGlob);
    const wide = watchHintsForGlob(['fixture-root', '**'].join('/'));
    if (
      literal[1] !== ['fixture-root', 'vitest.config'].join('/') ||
      starred[1] !== [extraGlob, 'vitest.config.*'].join('/') ||
      wide.length !== 0
    ) {
      failures += 1;
      console.error(`self-test FAIL: watchHintsForGlob spelling — ${JSON.stringify({ literal, starred, wide })}`);
    }
});

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  // This file's sink is the `failures` counter, so the floor speaks its idiom: a
  // breach prints like any other case failure and reds through the existing
  // verdict below.
  const floorFailure = (message) => { console.error(message); failures += 1; };
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

  if (failures > 0) process.exit(1);
  console.log(`self-test OK: ${cases.length} cases + real-tree population floor + watch-hint declaration.`);

  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
      if (selfTest() !== SELF_TEST_VERDICT) {
          console.error(
              '\n✗ check-console-intercept-disarm self-test: selfTest() returned without reaching its verdict,\n'
                  + 'so no success line was printed. Exiting 0 here would report a self-test\n'
                  + 'that never finished as a self-test that passed.\n',
          );
          process.exit(1);
      }
  }
  else main();
}
