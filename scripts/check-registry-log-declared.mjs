#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-registry-log-declared — every vitest-running package whose own test
// sources BOOT THE ENGINE must declare a registry log level
// (`env: { OS_REGISTRY_LOG: <level> }`) in its package-root vitest config.
//
// ── The defect this keeps closed (#15425, origin #13517) ────────────────────
//
// `@objectstack/objectql`'s SchemaRegistry logs one `[Registry] Registered
// <kind>: <name>` line per registered item per registry construction, through a
// private `log()` gated by `SchemaRegistryOptions.logLevel` — whose default is
// `'info'` (registry.ts) and whose env seam is `OS_REGISTRY_LOG`
// (registry.ts's `envLevel` read). A suite that boots real app stacks
// constructs that registry once per boot, so the line count is
// items x boots, and it lands on the CI shard log where nobody reads it.
//
// PR #13985 (dogfood) and PR #14016 (objectql, verify, runtime) declared
// `OS_REGISTRY_LOG: 'warn'` in four harnesses and removed ~47,900 console-
// carried lines between them (dogfood -39,764; objectql -4,679; verify -2,323;
// runtime -1,146). ⚠️ Nothing held them there. Deleting the `env` line from any
// of those configs restores five figures of output while every assertion stays
// green, every outcome is unchanged, and the only symptom is a bigger log — the
// exact declared-but-unenforced shape this repo refuses.
//
// ── Why the population is NOT "the four that already declare it" ────────────
//
// The card that dispatched this work stated the population as four app-booting
// suites. That is a property of where #13517's selection stopped, not of the
// tree, and the repo's own audit says so: `docs/audits/
// 2026-09-test-log-volume-census.md` measures all 72 vitest packages and
// records the residual `[Registry]` lines after #13985/#14016 — dogfood 2,
// verify 0, runtime 9, objectql 66, and `packages/rest` **528**. rest is that
// audit's named control (the one suite of its five that nothing touched); it
// constructs bare `SchemaRegistry` instances in six of its own test files
// exactly as objectql does, and it emits eight times declared objectql's
// residue. `packages/client`, `packages/services/service-automation` and
// `examples/app-showcase` construct registries by the same shape.
//
// ⇒ A gate whose roster was those four would be a hand list that knowingly
// excludes a matching package. This one derives its population instead, and the
// four it newly selected adopted the declaration in the PR that added it.
//
// ── The predicate, and why each signal is spelled the way it is ─────────────
//
// A vitest-running package is IN the population when its OWN TEST SOURCES do
// any one of:
//
//   S1  construct a registry — `new SchemaRegistry(` at a code position.
//   S2  boot a stack through `@objectstack/verify`'s harness — a test source
//       IMPORTS `bootStack` from `@objectstack/verify`, or the package itself
//       EXPORTS `function bootStack` (that is `packages/verify`, which owns the
//       harness and boots real stacks to test it).
//   S3  import a real example app — `@objectstack/example-*`.
//
// Test sources are the package's own `*.test.*` / `*.spec.*` files plus every
// file under a `test/`, `tests/` or `__tests__/` directory (harness helpers and
// fixtures boot stacks too — `packages/qa/dogfood/test/shared-showcase.ts` is
// the memoized boot the whole shared-showcase project runs on).
//
// ⭐ COMMENT MASKING IS WHAT MAKES THE PREDICATE HONEST, and it is not a
// precaution: measured on this tree, `packages/cli` names `@objectstack/verify`
// and its `bootStack` in EIGHT places, every one of them a comment or docblock
// (`serve-verify-security-parity.contract.test.ts` compares the two boot paths
// in prose). Unmasked, S2 selects cli — a package that boots no stack in any
// test — and the gate then demands a declaration that would quiet nothing. So
// S1 matches against comment-AND-string-masked source (a bare code-position
// construction; a spelling inside a template literal is prose), and S2/S3 match
// against comment-masked source only, because the import SPECIFIER is itself a
// string literal and blanking it would blind the signal.
//
// ── The census this predicate produces (verify it, do not trust it) ─────────
//
// 72 vitest-running packages walked, 8 selected, zero over- and zero
// under-selection against the population the #15425 ruling set:
//
//   packages/objectql                     S1   packages/rest              S1
//   packages/runtime                      S1   packages/client            S1
//   packages/services/service-automation  S1   examples/app-showcase      S1
//   packages/verify                       S2   packages/qa/dogfood        S2+S3
//
// The green verdict line below re-prints that census on every run, so a
// predicate that silently stops selecting names itself.
//
// ── What is asserted, once a package is selected ───────────────────────────
//
//   1. A package-root vitest config must exist. No config means vitest
//      defaults, and the default declares no env at all.
//   2. Its comment-masked source must carry `OS_REGISTRY_LOG` as a KEY inside
//      an `env: { … }` block. A docblock about the key never satisfies this —
//      load-bearing here more than anywhere, because all four original
//      carriers carry a ~30-line rationale docblock that names the variable
//      repeatedly.
//   3. The declared value must be one of the levels the engine actually
//      recognises. ⚠️ This is not pedantry: `registry.ts` resolves the env var
//      with `REGISTRY_LOG_LEVELS.includes(envLevel) ? envLevel : this._logLevel`
//      — an unrecognised value falls back to the `'info'` DEFAULT, silently. So
//      `OS_REGISTRY_LOG: 'quiet'` reads as a considered choice, changes
//      nothing, and restores every line the declaration was added to remove.
//      The vocabulary is READ from `packages/objectql/src/registry.ts`'s own
//      `REGISTRY_LOG_LEVELS` rather than copied here, so the engine renaming a
//      level cannot leave this gate enforcing a stale list; a source that can no
//      longer be parsed is a MEASUREMENT FAILURE (exit 2), never a pass.
//   4. For a config that defines inline `projects`, the root-level `env` is
//      INERT for project runs — the same measured property
//      `check-console-intercept-disarm` documents for `disableConsoleIntercept`
//      on vitest 4.1.10, and the reason `packages/qa/dogfood/vitest.config.ts`
//      repeats both keys inside each of its two projects with a comment saying
//      so. Every project's own `test` block must carry the declaration.
//
// ⛔ Deliberately NOT asserted: WHICH level a suite picks (any recognised level
// is a declaration; choosing between them is the suite author's call), and
// anything about `packages/objectql`'s shipped `'info'` default — that default
// is what every production reader gets and it stays exactly as it is. This gate
// reads harnesses; it never reads or requires anything of library code, and no
// library code is made aware of a test runner by it.
//
// Exit 0: every selected package declares a recognised level. Exit 1: findings
// (each names the package, what is missing, and the exact line to add). Exit 2:
// the gate could not measure (broken workspace file, empty population, empty
// selection, unreadable level vocabulary) — never reported as a pass.
//
//   node scripts/check-registry-log-declared.mjs
//   node scripts/check-registry-log-declared.mjs --self-test

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { blank, maskComments, scanSource } from './js-comment-mask.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { workspacePackageDirs } from './check-console-intercept-disarm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/* ── The declared path population (#13519 / check-declared-population-live) ───
 * These literals ARE what this gate reads: the workspace file that seeds the
 * walk, the engine source the level vocabulary is read from, and the package
 * subtrees the walk expands into. The self-test holds the hints against the
 * constants below, so a moved read reddens here rather than turning this gate
 * silently unnameable by any dispatch brief. Spelled WITH a separator: a bare
 * single-segment literal builds no hint at all (`hintCovers`). */
export const WORKSPACE_FILE = 'pnpm-workspace.yaml';
export const LEVELS_SOURCE = 'packages/objectql/src/registry.ts';
export const ROOT_DIR_WATCH_HINTS = ['packages/**', 'apps/**', 'examples/**'];

const VITEST_CONFIG_NAMES = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
];

/** A script that runs vitest — `vitest run`, `vitest --coverage`, a bare `vitest`. */
const VITEST_SCRIPT_RE = /(?:^|\s|&&|;)vitest(?:\s|$)/;

const SOURCE_EXT_RE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const TEST_FILE_RE = /\.(?:test|spec)\.[a-z]+$/;
const TEST_DIR_RE = /(?:^|\/)(?:test|tests|__tests__)\//;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', 'build']);

const S1_REGISTRY_RE = /\bnew\s+SchemaRegistry\s*\(/;
const S2_IMPORT_RE = /import[^;]*\bbootStack\b[^;]*from\s*['"]@objectstack\/verify['"]/;
const S2_DEFINE_RE = /export\s+(?:async\s+)?function\s+bootStack\b/;
const S3_EXAMPLE_RE = /from\s*['"]@objectstack\/example-[a-z0-9-]+['"]/;

const ENV_BLOCK_RE = /\benv\s*:\s*\{/g;
const KEY_RE = /\bOS_REGISTRY_LOG\s*:/;
const VALUE_RE = /\bOS_REGISTRY_LOG\s*:\s*(['"])([^'"]*)\1/;
const PROJECTS_RE = /\bprojects\s*:\s*\[/;
const TEST_BLOCK_RE = /\btest\s*:\s*\{/g;

const REMEDY = `    // #13517: quiet the registry's per-item registration chatter — the
    // engine's own \`OS_REGISTRY_LOG\` seam, not a change to its shipped
    // default. Enforced by scripts/check-registry-log-declared.mjs.
    env: { OS_REGISTRY_LOG: 'warn' },`;

/**
 * Comments AND string/template/regex content blanked, offsets kept. Used where
 * the signal is a bare CODE position (`new SchemaRegistry(`, a property key), so
 * a spelling inside prose or a template literal can never satisfy it.
 *
 * It COMPOSES the shared scanner — `scanSource`'s `comment` and `literal` flags
 * OR-ed through `blank` — and carries no scanning logic of its own; it stays
 * local only because `js-comment-mask.mjs` publishes no comments+literals
 * projection yet, and hoisting one waits on a follow-up card.
 *
 * The imported `maskComments` (comments blanked, string/template/regex content
 * INTACT — S2/S3 read import specifiers out of it) and this mask both preserve
 * offsets, so a range brace-matched on the code mask indexes the comment mask
 * identically — which is how the level VALUE (a string, blanked by this mask)
 * is read out of a block located with it.
 */
function maskCode(source) {
  const { comment, literal } = scanSource(source);
  const flags = new Uint8Array(comment.length);
  for (let i = 0; i < flags.length; i++) flags[i] = comment[i] | literal[i];
  return blank(source, flags);
}

/**
 * The level vocabulary, read from the engine's own declaration rather than
 * copied. Throws — a vocabulary this gate cannot read is a measurement it cannot
 * make, and `main()` turns that into exit 2 rather than a silent pass.
 *
 * @returns {string[]} e.g. ['debug','info','warn','error','silent']
 */
export function readRegistryLogLevels(root) {
  const file = join(root, LEVELS_SOURCE);
  if (!existsSync(file)) {
    throw new Error(
      `${LEVELS_SOURCE} is missing — this gate reads REGISTRY_LOG_LEVELS from it rather than `
        + `carrying its own copy. Point LEVELS_SOURCE at the engine's new home.`,
    );
  }
  const masked = maskComments(readFileSync(file, 'utf8'));
  const m = /REGISTRY_LOG_LEVELS[^=]*=\s*\[([^\]]*)\]/.exec(masked);
  if (!m) {
    throw new Error(
      `could not read REGISTRY_LOG_LEVELS out of ${LEVELS_SOURCE} — the declaration moved or `
        + `changed shape. Teach this reader the new one; do NOT hardcode the levels here, or the `
        + `engine renaming a level leaves this gate enforcing a list nobody maintains.`,
    );
  }
  const levels = [...m[1].matchAll(/['"]([a-z]+)['"]/g)].map((x) => x[1]);
  if (levels.length === 0) {
    throw new Error(`REGISTRY_LOG_LEVELS in ${LEVELS_SOURCE} parsed to ZERO levels`);
  }
  return levels;
}

/** Every source file under `dir`, skipping build output and dependencies. */
function sourceFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (SOURCE_EXT_RE.test(entry.name)) out.push(p);
  }
  return out;
}

/**
 * Which of S1/S2/S3 this package's own sources satisfy.
 *
 * @returns {string[]} the reasons, empty when the package is out of population.
 */
export function bootSignals(dir) {
  const files = sourceFiles(dir);
  const reasons = [];
  const isTest = (f) => {
    const rest = f.slice(dir.length).split(sep).join('/');
    return TEST_FILE_RE.test(f) || TEST_DIR_RE.test(rest);
  };
  let s1 = false;
  let s2 = false;
  let s3 = false;
  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const comments = maskComments(raw);
    if (!s2 && S2_DEFINE_RE.test(comments)) s2 = true;
    if (!isTest(file)) continue;
    if (!s1 && S1_REGISTRY_RE.test(maskCode(raw))) s1 = true;
    if (!s2 && S2_IMPORT_RE.test(comments)) s2 = true;
    if (!s3 && S3_EXAMPLE_RE.test(comments)) s3 = true;
  }
  if (s1) reasons.push('S1 constructs a SchemaRegistry in its tests');
  if (s2) reasons.push("S2 boots a stack through @objectstack/verify's bootStack");
  if (s3) reasons.push('S3 imports a real @objectstack/example-* app in its tests');
  return reasons;
}

/**
 * Brace-matched ranges of every `env: { … }` block in `masked`.
 *
 * Brace matching is safe because the source arrives with comments AND string
 * content blanked — no brace inside prose survives to miscount.
 *
 * @returns {Array<[number, number]>} inclusive `[open, close]` index pairs.
 */
function envBlockRanges(masked) {
  const ranges = [];
  ENV_BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = ENV_BLOCK_RE.exec(masked)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < masked.length; i++) {
      if (masked[i] === '{') depth += 1;
      else if (masked[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          ranges.push([open, i]);
          break;
        }
      }
    }
  }
  return ranges;
}

/** Brace-matched ranges of every `test: { … }` block INSIDE the projects array. */
function projectTestBlockRanges(masked) {
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
  const ranges = [];
  TEST_BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = TEST_BLOCK_RE.exec(region)) !== null) {
    const open = openBracket + m.index + m[0].length - 1;
    let d = 0;
    for (let i = open; i <= end; i++) {
      if (masked[i] === '{') d += 1;
      else if (masked[i] === '}') {
        d -= 1;
        if (d === 0) {
          ranges.push([open, i]);
          break;
        }
      }
    }
  }
  return ranges;
}

/**
 * The declaration verdict for one region of a config.
 *
 * @returns {{declared: boolean, level: string|null, unquoted: boolean}}
 */
function declarationIn(code, comments, [from, to], levels) {
  for (const [open, close] of envBlockRanges(code.slice(from, to + 1))) {
    const a = from + open;
    const b = from + close;
    if (!KEY_RE.test(code.slice(a, b + 1))) continue;
    const v = VALUE_RE.exec(comments.slice(a, b + 1));
    if (!v) return { declared: true, level: null, unquoted: true };
    const level = v[2].toLowerCase();
    return { declared: true, level, unquoted: false, recognised: levels.includes(level) };
  }
  return { declared: false, level: null, unquoted: false };
}

function describe(verdict, where, levels) {
  if (!verdict.declared) {
    return `${where} declares no OS_REGISTRY_LOG (a comment about it does not count)`;
  }
  if (verdict.unquoted) {
    return `${where} sets OS_REGISTRY_LOG to something this gate cannot read as a string literal`;
  }
  return (
    `${where} sets OS_REGISTRY_LOG: '${verdict.level}', which is NOT one of the levels the engine `
    + `recognises (${levels.join(', ')}). registry.ts resolves an unrecognised value to its 'info' `
    + `DEFAULT, silently — the declaration reads as a considered choice and quiets nothing`
  );
}

/** @returns {{findings: string[], vitestPackages: number, selected: Array<[string,string[]]>}} */
export function scan(root, levels = readRegistryLogLevels(root)) {
  const findings = [];
  const selected = [];
  let vitestPackages = 0;
  for (const dir of workspacePackageDirs(root)) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch (error) {
      findings.push(`${rel(root, dir)}/package.json: unreadable (${error.message})`);
      continue;
    }
    const scripts = Object.values(manifest.scripts ?? {});
    if (!scripts.some((s) => typeof s === 'string' && VITEST_SCRIPT_RE.test(s))) continue;
    vitestPackages += 1;

    const reasons = bootSignals(dir);
    if (reasons.length === 0) continue;
    const name = rel(root, dir);
    selected.push([name, reasons]);

    const configName = VITEST_CONFIG_NAMES.find((n) => existsSync(join(dir, n)));
    if (!configName) {
      findings.push(
        `${name}: boots the engine in its tests (${reasons.join('; ')}) and runs vitest with NO `
          + `package-root vitest config, so it can declare nothing. Add a vitest.config.ts whose `
          + `test block carries:\n${REMEDY}`,
      );
      continue;
    }
    const raw = readFileSync(join(dir, configName), 'utf8');
    const code = maskCode(raw);
    const comments = maskComments(raw);
    const where = `${name}/${configName}`;

    if (PROJECTS_RE.test(code)) {
      const blocks = projectTestBlockRanges(code);
      if (blocks.length === 0) {
        findings.push(
          `${where}: defines inline projects and no project test block could be read — a ROOT-level `
            + `env is INERT for project runs, so this config cannot be shown to declare anything. Put\n`
            + `${REMEDY}\ninside EVERY project's own test block.`,
        );
        continue;
      }
      const bad = blocks
        .map((r) => declarationIn(code, comments, r, levels))
        .filter((v) => !v.declared || v.unquoted || !v.recognised);
      if (bad.length > 0) {
        findings.push(
          `${where}: defines inline projects, and ${bad.length} of ${blocks.length} project test `
            + `block(s) do not declare a recognised registry log level — first: `
            + `${describe(bad[0], 'that block', levels)}. A ROOT-level env is INERT for project runs `
            + `(the same measured property check-console-intercept-disarm records for `
            + `disableConsoleIntercept on vitest 4.1.10). This suite ${reasons.join('; ')}, so every `
            + `boot it runs re-emits the registry's per-item chatter. Put\n${REMEDY}\ninside EVERY `
            + `project's own test block.`,
        );
      }
      continue;
    }

    const verdict = declarationIn(code, comments, [0, code.length - 1], levels);
    if (!verdict.declared || verdict.unquoted || !verdict.recognised) {
      findings.push(
        `${describe(verdict, where, levels)}. This suite ${reasons.join('; ')}, so every boot it runs `
          + `emits one [Registry] line per registered item at the engine's 'info' default — the `
          + `population PR #13985 and PR #14016 measured at ~47,900 lines across four suites, and the `
          + `one docs/audits/2026-09-test-log-volume-census.md still measures at 528 lines for the `
          + `suite nothing had declared. Add to the test block:\n${REMEDY}`,
      );
    }
  }
  return { findings, vitestPackages, selected };
}

function rel(root, path) {
  return path.startsWith(root) ? path.slice(root.length + 1) : path;
}

function main() {
  let result;
  let levels;
  try {
    levels = readRegistryLogLevels(REPO_ROOT);
    result = scan(REPO_ROOT, levels);
  } catch (error) {
    console.error(`check-registry-log-declared: MEASUREMENT FAILED — ${error.message}`);
    process.exit(2);
  }
  const { findings, vitestPackages, selected } = result;
  if (vitestPackages === 0) {
    console.error(
      'check-registry-log-declared: MEASUREMENT FAILED — the scan found ZERO vitest-running '
        + 'packages, and this repo has dozens. The population went missing, which is not the same '
        + 'fact as "everything declares a level".',
    );
    process.exit(2);
  }
  if (selected.length === 0) {
    console.error(
      'check-registry-log-declared: MEASUREMENT FAILED — the predicate selected ZERO of '
        + `${vitestPackages} vitest-running packages. This repo boots app stacks in at least eight of `
        + 'them, so a zero selection means the signals stopped matching (a moved helper, a renamed '
        + 'import), not that nothing boots. A gate that selects nothing passes everything.',
    );
    process.exit(2);
  }
  if (findings.length > 0) {
    console.error(
      `check-registry-log-declared: ${findings.length} engine-booting suite(s) declare no recognised `
        + `registry log level:\n\n${findings.join('\n\n')}\n`,
    );
    process.exit(1);
  }
  console.log(
    `OK: ${vitestPackages} vitest-running package(s) walked, ${selected.length} selected as `
      + `engine-booting, every one declares a recognised registry log level `
      + `(${levels.join('/')}).`,
  );
  for (const [name, reasons] of selected) console.log(`    ${name} — ${reasons.join('; ')}`);
}

// ── self-test ───────────────────────────────────────────────────────────────
//
// Builds a throwaway workspace in $TMPDIR per case. The cases pin the verdict
// DIRECTION of every rule above in BOTH directions: a selected package missing
// the key REDS, an unselected package without the key is SILENT, and a selected
// package with the key is GREEN. The three silent-in-the-green-direction bugs a
// textual gate like this can grow each have their own row — prose selecting
// (the `packages/cli` shape), prose satisfying, and a level the engine does not
// recognise passing for a declaration.

function buildWorkspace(caseDir, packages) {
  mkdirSync(join(caseDir, 'packages'), { recursive: true });
  writeFileSync(join(caseDir, WORKSPACE_FILE), 'packages:\n  - packages/*\n');
  for (const [name, files] of Object.entries(packages)) {
    const dir = join(caseDir, 'packages', name);
    mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), content);
    }
  }
}

const TEST_MANIFEST = JSON.stringify({ name: 'x', scripts: { test: 'vitest run' } });
const QUIET_MANIFEST = JSON.stringify({ name: 'x', scripts: { build: 'tsup' } });
const BOOTS = `import { SchemaRegistry } from '@objectstack/objectql';
export const r = new SchemaRegistry();
`;
const DECLARED = `export default { test: { env: { OS_REGISTRY_LOG: 'warn' } } };\n`;

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-registry-log-declared self-test reached its verdict';

// ── The self-test's own battery roster and floor (#13489 / #13799 recipe A) ──
//
// `failures === 0` was never this self-test's only success condition, because it
// never gets to be: "every case held" and "the cases never ran" print the same
// line unless the RUN of each case is recorded. This self-test is TABLE-DRIVEN —
// one literal `cases` table, one loop, one sink (`failures += 1`) that writes
// only when a case FAILS — so routing that sink through `registerCase()` would
// register a case only when it failed and invert the floor rather than install
// it. The roster is therefore the table's own rows: each row LABEL is a declared
// battery with a floor of 1, and `registerCase(name)` is the FIRST statement of
// the loop body, above anything the row asserts.
//
// ⛔ A roster DERIVED from the table is not the repair either: `cases.length`
// moves with the table, so a deleted row would delete its own floor. This is a
// LITERAL the table is checked against, which is what lets a deleted or renamed
// row name ITSELF in the refusal.
//
// The counts are a FLOOR, not an equality — a row that grows into several
// registrations must not red. 1 is the honest floor for a table row.
const SELF_TEST_BATTERIES = Object.freeze({
  'selected package that declares the level passes': 1,
  'POSITIVE CONTROL: selected package missing the key is RED': 1,
  'NEGATIVE CONTROL: unselected package without the key is SILENT': 1,
  'a package that never runs vitest is ignored entirely': 1,
  'prose naming the key does not satisfy the check': 1,
  'prose naming bootStack does not SELECT the package (the packages/cli shape)': 1,
  'a level the engine does not recognise is RED': 1,
  'the key outside any env block does not count': 1,
  'S2: importing bootStack from @objectstack/verify selects': 1,
  'S2: exporting function bootStack selects (the harness owner)': 1,
  'S3: importing an @objectstack/example-* app selects': 1,
  'selected package with NO vitest config is RED': 1,
  'projects config with only a ROOT env is RED (root is inert for projects)': 1,
  'projects config declaring in every project passes': 1,
  'a template-literal spelling of the key does not count': 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. This pin is also half of
// the duplicate-label refusal: two rows sharing a label collapse to ONE key in
// the literal above, so the roster falls below this number.
const SELF_TEST_BATTERY_FLOOR = 15;

// The key an assertion is filed under when a row carries no label. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(unlabelled row)';

function selfTest() {
  const LEVELS = ['debug', 'info', 'warn', 'error', 'silent'];
  const cases = [
    {
      name: 'selected package that declares the level passes',
      packages: { a: { 'package.json': TEST_MANIFEST, 'src/x.test.ts': BOOTS, 'vitest.config.ts': DECLARED } },
      expectFindings: 0,
      expectSelected: 1,
    },
    {
      name: 'POSITIVE CONTROL: selected package missing the key is RED',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'src/x.test.ts': BOOTS,
          'vitest.config.ts': `export default { test: { globals: true } };\n`,
        },
      },
      expectFindings: 1,
      expectSelected: 1,
      expectText: 'declares no OS_REGISTRY_LOG',
    },
    {
      name: 'NEGATIVE CONTROL: unselected package without the key is SILENT',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'src/x.test.ts': `import { it } from 'vitest';\nit('adds', () => {});\n`,
          'vitest.config.ts': `export default { test: { globals: true } };\n`,
        },
      },
      expectFindings: 0,
      expectSelected: 0,
    },
    {
      name: 'a package that never runs vitest is ignored entirely',
      packages: { a: { 'package.json': QUIET_MANIFEST, 'src/x.test.ts': BOOTS } },
      expectFindings: 0,
      expectSelected: 0,
      expectVitestPackages: 0,
    },
    {
      name: 'prose naming the key does not satisfy the check',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'src/x.test.ts': BOOTS,
          'vitest.config.ts':
            `// env: { OS_REGISTRY_LOG: 'warn' } — explained here, set nowhere\n`
            + `/* OS_REGISTRY_LOG: 'warn' */\n`
            + `export default { test: { globals: true } };\n`,
        },
      },
      expectFindings: 1,
      expectSelected: 1,
      expectText: 'a comment about it does not count',
    },
    {
      name: 'prose naming bootStack does not SELECT the package (the packages/cli shape)',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'src/x.test.ts':
            `// This file compares the CLI boot path against bootStack from '@objectstack/verify'.\n`
            + `/* import { bootStack } from '@objectstack/verify'; */\n`
            + `import { it } from 'vitest';\nit('adds', () => {});\n`,
          'vitest.config.ts': `export default { test: { globals: true } };\n`,
        },
      },
      expectFindings: 0,
      expectSelected: 0,
    },
    {
      name: 'a level the engine does not recognise is RED',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'src/x.test.ts': BOOTS,
          'vitest.config.ts': `export default { test: { env: { OS_REGISTRY_LOG: 'quiet' } } };\n`,
        },
      },
      expectFindings: 1,
      expectSelected: 1,
      expectText: "NOT one of the levels the engine recognises",
    },
    {
      name: 'the key outside any env block does not count',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'src/x.test.ts': BOOTS,
          'vitest.config.ts': `export default { test: { globals: true }, OS_REGISTRY_LOG: 'warn' };\n`,
        },
      },
      expectFindings: 1,
      expectSelected: 1,
      expectText: 'declares no OS_REGISTRY_LOG',
    },
    {
      name: 'S2: importing bootStack from @objectstack/verify selects',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'test/x.test.ts': `import { bootStack } from '@objectstack/verify';\nexport const s = bootStack;\n`,
          'vitest.config.ts': `export default { test: { globals: true } };\n`,
        },
      },
      expectFindings: 1,
      expectSelected: 1,
      expectText: 'S2 boots a stack',
    },
    {
      name: 'S2: exporting function bootStack selects (the harness owner)',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'src/harness.ts': `export async function bootStack(app: unknown) { return app; }\n`,
          'src/x.test.ts': `import { it } from 'vitest';\nit('adds', () => {});\n`,
          'vitest.config.ts': `export default { test: { globals: true } };\n`,
        },
      },
      expectFindings: 1,
      expectSelected: 1,
      expectText: 'S2 boots a stack',
    },
    {
      name: 'S3: importing an @objectstack/example-* app selects',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'test/x.test.ts': `import stack from '@objectstack/example-showcase';\nexport default stack;\n`,
          'vitest.config.ts': `export default { test: { globals: true } };\n`,
        },
      },
      expectFindings: 1,
      expectSelected: 1,
      expectText: 'S3 imports a real',
    },
    {
      name: 'selected package with NO vitest config is RED',
      packages: { a: { 'package.json': TEST_MANIFEST, 'src/x.test.ts': BOOTS } },
      expectFindings: 1,
      expectSelected: 1,
      expectText: 'NO package-root vitest config',
    },
    {
      name: 'projects config with only a ROOT env is RED (root is inert for projects)',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'src/x.test.ts': BOOTS,
          'vitest.config.ts':
            `export default { test: { env: { OS_REGISTRY_LOG: 'warn' }, projects: [\n`
            + `  { test: { name: 'p1', include: ['x'] } },\n`
            + `  { test: { name: 'p2', env: { OS_REGISTRY_LOG: 'warn' } } },\n`
            + `] } };\n`,
        },
      },
      expectFindings: 1,
      expectSelected: 1,
      expectText: 'INERT for project runs',
    },
    {
      name: 'projects config declaring in every project passes',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'src/x.test.ts': BOOTS,
          'vitest.config.ts':
            `export default { test: { projects: [\n`
            + `  { test: { name: 'p1', env: { OS_REGISTRY_LOG: 'warn' } } },\n`
            + `  { test: { name: 'p2', env: { OS_REGISTRY_LOG: 'silent' } } },\n`
            + `] } };\n`,
        },
      },
      expectFindings: 0,
      expectSelected: 1,
    },
    {
      name: 'a template-literal spelling of the key does not count',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'src/x.test.ts': BOOTS,
          'vitest.config.ts':
            'const doc = `env: { OS_REGISTRY_LOG: \'warn\' }`;\n'
            + `export default { test: { globals: true } };\n`,
        },
      },
      expectFindings: 1,
      expectSelected: 1,
      expectText: 'declares no OS_REGISTRY_LOG',
    },
  ];

  // The ledger this self-test's floor is evaluated against (#13489).
  const batterySeen = new Map();
  const registerCase = (name) => {
    const key = name ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(key, (batterySeen.get(key) ?? 0) + 1);
  };

  let failures = 0;
  for (const testCase of cases) {
    registerCase(testCase.name);
    const caseDir = mkdtempSync(join(tmpdir(), 'ci-reglog-'));
    try {
      buildWorkspace(caseDir, testCase.packages);
      const { findings, vitestPackages, selected } = scan(caseDir, LEVELS);
      const problems = [];
      if (findings.length !== testCase.expectFindings) {
        problems.push(`expected ${testCase.expectFindings} finding(s), got ${findings.length}`);
      }
      if (testCase.expectSelected !== undefined && selected.length !== testCase.expectSelected) {
        problems.push(`expected ${testCase.expectSelected} selected, got ${selected.length}`);
      }
      if (testCase.expectText && !findings.some((f) => f.includes(testCase.expectText))) {
        problems.push(`no finding contains '${testCase.expectText}'`);
      }
      if (
        testCase.expectVitestPackages !== undefined
        && vitestPackages !== testCase.expectVitestPackages
      ) {
        problems.push(`expected ${testCase.expectVitestPackages} vitest package(s), got ${vitestPackages}`);
      }
      if (problems.length > 0) {
        failures += 1;
        console.error(`self-test FAIL: ${testCase.name}\n  ${problems.join('\n  ')}`);
        for (const f of findings) console.error(`  finding: ${f.split('\n')[0]}`);
      }
    } finally {
      rmSync(caseDir, { recursive: true, force: true });
    }
  }

  const fail = (message) => { console.error(`self-test FAIL: ${message}`); failures += 1; };

  // ── The level vocabulary is READ, not copied ──────────────────────────────
  // The cases above run against a hand-supplied `LEVELS`, so nothing in them
  // would notice the reader breaking. This asserts the reader still finds the
  // engine's own declaration, and that the list the cases assume matches it.
  let liveLevels = [];
  try {
    liveLevels = readRegistryLogLevels(REPO_ROOT);
  } catch (error) {
    fail(`readRegistryLogLevels() cannot read ${LEVELS_SOURCE}: ${error.message}`);
  }
  if (liveLevels.length > 0) {
    for (const level of LEVELS) {
      if (!liveLevels.includes(level)) {
        fail(`the self-test assumes level '${level}' but ${LEVELS_SOURCE} no longer declares it `
          + `(reads: ${liveLevels.join(', ')})`);
      }
    }
    if (!liveLevels.includes('warn')) {
      fail(`'warn' — the level every carrier declares — is not in ${LEVELS_SOURCE}'s vocabulary`);
    }
  }

  // ── The dispatch-gates population declaration ─────────────────────────────
  // Filed outside the cases table, deliberately: each table ROW is a declared
  // battery here, so an assertion added as a row would owe a roster entry for a
  // case that gates nothing about `scan`'s verdicts. A wrong hint runs perfectly
  // green in production and shows up only as a dev who was never told this gate
  // reads their surface.
  if (!existsSync(join(REPO_ROOT, WORKSPACE_FILE))) {
    fail(`the declared population must reach the tree: ${WORKSPACE_FILE}`);
  }
  if (!existsSync(join(REPO_ROOT, LEVELS_SOURCE))) {
    fail(`the declared population must reach the tree: ${LEVELS_SOURCE}`);
  }
  for (const hint of ROOT_DIR_WATCH_HINTS) {
    if (!hint.includes('/')) {
      fail(`ROOT_DIR_WATCH_HINTS entry '${hint}' is a bare single-segment literal, which builds no `
        + `hint at all — spell it with a separator`);
    }
    const root = hint.replace(/\/\*+$/, '');
    if (!existsSync(join(REPO_ROOT, root))) {
      fail(`ROOT_DIR_WATCH_HINTS declares '${hint}', which reaches nothing in the tree`);
    }
  }
  // The hints must actually cover the walk: every workspace package this gate
  // reads has to live under a declared root, or the declaration is narrower than
  // the read and the dispatch brief under-names this gate's surface.
  try {
    const roots = ROOT_DIR_WATCH_HINTS.map((h) => h.replace(/\/\*+$/, ''));
    const uncovered = workspacePackageDirs(REPO_ROOT)
      .map((d) => rel(REPO_ROOT, d))
      .filter((r) => !roots.some((root) => r === root || r.startsWith(`${root}/`)));
    if (uncovered.length > 0) {
      fail(`ROOT_DIR_WATCH_HINTS does not cover ${uncovered.length} workspace package(s) this gate `
        + `reads, e.g. ${uncovered[0]} — the declaration has drifted from the walk`);
    }
  } catch (error) {
    fail(`the workspace walk this gate declares could not be expanded: ${error.message}`);
  }

  // ── Anti-vacuity over the REAL tree ───────────────────────────────────────
  // The scan must see the real population AND select from it. A selection that
  // collapses to zero is the one failure this gate cannot report as a finding:
  // it would print a perfect green over a predicate that matches nothing.
  try {
    const real = scan(REPO_ROOT, liveLevels.length > 0 ? liveLevels : LEVELS);
    if (real.vitestPackages < 60) {
      fail(`real-tree scan sees only ${real.vitestPackages} vitest-running package(s); the `
        + `population this gate was written against had 72. The workspace expansion has gone blind.`);
    }
    if (real.selected.length < 8) {
      fail(`real-tree scan selects only ${real.selected.length} engine-booting package(s); the `
        + `census this gate was written against had 8 (objectql, runtime, verify, qa/dogfood, `
        + `client, rest, services/service-automation, examples/app-showcase). A shrinking selection `
        + `is a predicate going blind, not a tree that stopped booting apps.`);
    }
  } catch (error) {
    fail(`the real-tree scan threw: ${error.message}`);
  }

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ─────
  //
  // Evaluated after every row has had its chance and BEFORE the verdict, so the
  // success line below can only be printed by a run in which the set of rows
  // that registered EQUALS the set declared. A set difference names WHICH row
  // stopped; a count says only that something did.
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    fail(`SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
      + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`);
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    fail(`self-test battery "${name}" registered ${count} case(s) but is not declared in `
      + 'SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.');
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    fail(count === 0
      ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} `
        + 'pinned. The verdict below would have claimed that case holds.'
      : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
        + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`);
  }
  if (floorBreached) {
    fail('A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not '
      + 'the number. Find what stopped registering (an early return, a deleted row, a guard that now '
      + 'skips) and restore it.');
  }

  if (failures > 0) process.exit(1);
  console.log(`self-test OK: ${cases.length} cases + level-vocabulary read + population declaration `
    + '+ real-tree selection floor.');

  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-registry-log-declared self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else main();
}
