#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-rest-log-spy-declared — a test file that OBSERVES the REST fault log
// must DECLARE the level it observes under, in its own source, at a level loud
// enough for the shim to speak.
//
// ── The defect this keeps closed (#17865, ruling batch #128 item 4) ─────────
//
// `packages/rest`'s harness now runs at `OS_REST_LOG: 'silent'`
// (`packages/rest/vitest.config.ts`). That removes a measured 2,095 indented
// `at ` frame lines — 36.7% of a captured green run, 100% of them arriving
// through `logError` — and it is safe ONLY while the tests that assert about
// the fault log declare their own level. The opt-down and this gate are one
// delivery: 「a pairing gate … a test file that spies on `console.error` / the
// fault logger without declaring `OS_REST_LOG` is a finding by name. It lands
// in the same PR as 1; ⛔ 1 does not merge without 3.」
//
// ⚠️ The half that makes this a gate and not a lint rule is the NEGATIVE
// assertion. Measured on the tree this landed against: 15 test files / 28 test
// cases go RED the moment the suite is silenced — those announce themselves.
// The other direction is silent. Eight files assert that an EXPECTED 4xx logs
// NOTHING (`expect(unhandledLogs()).toHaveLength(0)` and siblings); under a
// silenced shim those stay GREEN while logging every expected 4xx loudly. That
// is a phantom check arrived at by a legitimate-looking config line — the exact
// shape that spent this suite's `[Registry]` control on #15484, and the reason
// option C ("opt down, change nothing else") was measured and refused.
//
// So the rule is not "assert loudly". It is: an observer OWNS its level.
//
// ── What is asserted ────────────────────────────────────────────────────────
//
//   1. The seam is findable, and there is exactly one of it. Delegated to
//      `check-rest-log-declared.mjs`'s own reader rather than re-implemented,
//      so the two gates cannot disagree about which file owns the seam or which
//      levels exist. Zero owners, or more than one, is a MEASUREMENT FAILURE
//      (exit 2) — never a pass.
//   2. An OBSERVER is a test file in the owning package that reads the fault
//      channel: a `vi`/`jest` `spyOn(console, 'error'|'warn')`, a direct
//      `console.error =` / `console.warn =` mock install, or an import of the
//      seam module itself. `logWarn` routes to `console.warn` and the same
//      level gates it, so a warn spy is an observer exactly as an error spy is.
//   3. Every observer declares `OS_REST_LOG` in CODE. A comment naming the key
//      never counts — this file's own header names it a dozen times.
//   4. Every level literal an observer pairs with the key is one the seam
//      recognises. `log.ts` resolves an unrecognised value to the shipped
//      DEFAULT, silently, so `'quiet'` reads as a considered choice and
//      declares nothing. Same failure `check-rest-log-declared` documents for
//      the harness config.
//   5. At least one of those pairings is loud enough that BOTH of the shim's
//      sites still emit — `logWarn`'s threshold, not just `logError`'s. A file
//      whose only declaration is `'silent'` has re-created the vacuum the
//      opt-down would have created for it; a file whose only declaration is
//      `'error'` has done it to `logWarn`. This is a FLOOR, not a value choice:
//      a file may declare quiet levels as well (the ladder cases in
//      `rest-log-declared-level-seam.test.ts` do), it just may not declare ONLY
//      quiet ones. A declaration this gate cannot read as a literal at all —
//      `process.env.OS_REST_LOG = someVariable` — satisfies neither 4 nor 5:
//      the key being mentioned is not the same fact as a level being declared.
//   6. A test file that is NOT an observer is not conscripted into declaring
//      anything — but a declaration it does make is still held to rule 4.
//
// ── Why ZERO OBSERVERS is a failure and not a clean bill ────────────────────
//
// This gate recognises the spellings it knows. If the suite migrates to a
// helper this detector has never seen, the observer count silently becomes 0
// and every file passes — a gate that finds nothing passes everything, which is
// how the `[Registry]` control went to zero and read as "capture failed". So an
// owning package with test files but ZERO observers is a MEASUREMENT FAILURE.
// Extend the detector (and add a self-test case) rather than routing around it.
//
// ⚠️ Known duplication, stated rather than hidden: the workspace walk and the
// test-file predicate below are a third spelling of the one in
// `check-registry-log-declared.mjs` / `check-rest-log-declared.mjs`. What is
// NOT duplicated is the part that matters — seam location and the level
// vocabulary are IMPORTED from the sibling gate, so a level renamed in
// `log.ts` moves both gates at once.
//
// Exit 0: every observer owns its level. Exit 1: findings (each names the file,
// what is wrong, and the line to write). Exit 2: the gate could not measure —
// never reported as a pass.
//
//   node scripts/check-rest-log-spy-declared.mjs
//   node scripts/check-rest-log-spy-declared.mjs --self-test

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { maskComments } from './js-comment-mask.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { workspacePackageDirs } from './check-console-intercept-disarm.mjs';
import { ENV_KEY, findSeamOwners, readSeam } from './check-rest-log-declared.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/* ── The declared path population (#13519 / check-declared-population-live) ───
 * These literals ARE what this gate reads, and they are deliberately as wide as
 * its sibling's: locating the seam means asking EVERY workspace package whether
 * one of its non-test sources reads the environment key, because a SECOND
 * reader appearing anywhere is an exit-2 measurement failure here. Only the
 * second half — the test files examined — is narrow, and its directory is
 * DERIVED from wherever the seam turned out to live, so it cannot be spelled as
 * a literal without re-introducing the hardcoded package path this gate refuses
 * to carry. Spelled WITH a separator: a bare single-segment literal builds no
 * hint at all. The self-test holds these against the walk, so a moved read
 * reddens here rather than turning this gate silently unnameable by any
 * dispatch brief. */
export const WORKSPACE_FILE = 'pnpm-workspace.yaml';
export const ROOT_DIR_WATCH_HINTS = ['packages/**', 'apps/**', 'examples/**'];

const TEST_FILE_RE = /\.(?:test|spec)\.[a-z]+$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', 'build']);

/**
 * Levels at which at least one of the shim's two sites goes silent — the same
 * floor `check-rest-log-declared.mjs` holds the SHIPPED default to, applied
 * here to what a test file declares for itself.
 */
export const QUIET_LEVELS = new Set(['silent', 'error']);

/** A `spyOn(console, 'error'|'warn')` in any of the spellings in use. */
const SPY_RE = /\b(?:vi|jest)\s*\.\s*spyOn\s*\(\s*(?:globalThis\s*\.\s*)?console\s*(?:,\s*|\[\s*)['"`](error|warn)['"`]/;
/** A mock installed by assignment: `console.error = …`, `console['warn'] = …`. */
const ASSIGN_RE = /\bconsole\s*(?:\.\s*(?:error|warn)|\[\s*['"`](?:error|warn)['"`]\s*\])\s*=[^=]/;

/**
 * Every pairing of the key with a string literal, in the three shapes a test
 * file can write: `vi.stubEnv('OS_REST_LOG', 'info')`, `OS_REST_LOG: 'info'`
 * inside an env block, and `process.env.OS_REST_LOG = 'info'`.
 */
const PAIRING_RE = new RegExp(String.raw`${ENV_KEY}['"\`]?\s*(?:,|:|=)\s*['"\`]([^'"\`]*)['"\`]`, 'g');
const KEY_RE = new RegExp(String.raw`\b${ENV_KEY}\b`);

const REMEDY = `    beforeAll(() => { vi.stubEnv('${ENV_KEY}', '<loud level>'); });\n`
  + '    afterAll(() => { vi.unstubAllEnvs(); });';

/** Every test file under `dir`, recursively. */
export function testFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) testFiles(join(dir, e.name), out);
    } else if (TEST_FILE_RE.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

/**
 * The import specifiers by which a file in `fromDir` would name the seam
 * module. Derived from where the seam actually lives, so moving `log.ts`
 * moves this with it.
 * @returns {string[]}
 */
export function seamSpecifiers(fromDir, seamFile) {
  const bare = relative(fromDir, seamFile).replace(/\.[cm]?[jt]sx?$/, '');
  const posix = bare.split(sep).join('/');
  const rooted = posix.startsWith('.') ? posix : `./${posix}`;
  return [rooted, `${rooted}.js`, `${rooted}.ts`, `${rooted}.mjs`];
}

/**
 * Does this file read the fault channel?
 * @returns {{observer: boolean, why: string|null}}
 */
export function observes(code, fromDir, seamFile) {
  if (SPY_RE.test(code)) return { observer: true, why: 'spies on console.error/warn' };
  if (ASSIGN_RE.test(code)) return { observer: true, why: 'installs a console.error/warn mock' };
  for (const spec of seamSpecifiers(fromDir, seamFile)) {
    const re = new RegExp(String.raw`from\s*['"\`]${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
    if (re.test(code)) return { observer: true, why: `imports the fault shim (${spec})` };
  }
  return { observer: false, why: null };
}

/**
 * The levels a file pairs with the key, in source order.
 * @returns {string[]}
 */
export function declaredLevels(code) {
  PAIRING_RE.lastIndex = 0;
  return [...code.matchAll(PAIRING_RE)].map((m) => m[1].toLowerCase());
}

/** @returns {{findings: string[], owner: string, observers: string[], examined: number}} */
export function scan(root) {
  const owners = findSeamOwners(root);
  if (owners.length === 0) {
    throw new Error(
      `no source file reads process.env.${ENV_KEY} anywhere in the workspace. The seam whose `
        + `observers this gate pairs is GONE or was renamed — which is not the same fact as `
        + `"every observer declares it". A gate that finds nothing passes everything.`,
    );
  }
  if (owners.length > 1) {
    throw new Error(
      `${owners.length} source files read process.env.${ENV_KEY} `
        + `(${owners.map((o) => rel(root, o)).join(', ')}). Two readers means two spellings of the `
        + `level, and this gate can no longer say which one a test file is declaring against.`,
    );
  }
  const seamFile = owners[0];
  const { levels } = readSeam(seamFile);
  const ownerDir = packageDirOf(root, seamFile);
  if (!ownerDir) {
    throw new Error(`${rel(root, seamFile)} is not inside any workspace package — cannot scope the scan.`);
  }

  const files = testFiles(ownerDir);
  if (files.length === 0) {
    throw new Error(
      `${rel(root, ownerDir)} owns the ${ENV_KEY} seam and contains NO test files. This gate exists `
        + `to pair observers with declarations; with nothing to examine it can only report a `
        + `vacuous pass.`,
    );
  }

  const findings = [];
  const observers = [];
  for (const file of files) {
    const code = maskComments(readFileSync(file, 'utf8'));
    const where = rel(root, file);
    const verdict = observes(code, dirname(file), seamFile);
    const pairings = declaredLevels(code);
    const unrecognised = pairings.filter((l) => !levels.includes(l));

    if (!verdict.observer) {
      // Rule 6 — not conscripted, but a declaration it makes must be real.
      if (KEY_RE.test(code) && unrecognised.length > 0) {
        findings.push(
          `${where}: declares ${ENV_KEY}: '${unrecognised[0]}', which is NOT one of the levels the `
            + `seam recognises (${levels.join(', ')}). log.ts resolves an unrecognised value to the `
            + `SHIPPED DEFAULT, silently — the declaration reads as a considered choice and `
            + `declares nothing.`,
        );
      }
      continue;
    }
    observers.push(where);

    if (!KEY_RE.test(code)) {
      findings.push(
        `${where}: ${verdict.why} but declares no ${ENV_KEY} (a comment about it does not count). `
          + `The suite this file runs in declares a QUIET level, so what this file observes is not `
          + `what a real caller gets — and an assertion that NOTHING was logged would pass for the `
          + `wrong reason. Declare the level this file asserts against:\n${REMEDY}`,
      );
      continue;
    }
    if (unrecognised.length > 0) {
      findings.push(
        `${where}: ${verdict.why} and pairs ${ENV_KEY} with '${unrecognised[0]}', which is NOT one `
          + `of the levels the seam recognises (${levels.join(', ')}). log.ts resolves an `
          + `unrecognised value to the SHIPPED DEFAULT, silently — the declaration reads as a `
          + `considered choice and declares nothing.`,
      );
      continue;
    }
    if (pairings.length === 0) {
      findings.push(
        `${where}: ${verdict.why} and mentions ${ENV_KEY}, but this gate cannot read a LEVEL out of `
          + `it — the key is paired with something that is not a string literal. The key being `
          + `mentioned is not the same fact as a level being declared. Add a readable one:\n`
          + `${REMEDY}`,
      );
      continue;
    }
    if (pairings.every((l) => QUIET_LEVELS.has(l))) {
      findings.push(
        `${where}: ${verdict.why} and declares only quiet level(s) (${[...new Set(pairings)].join(', ')}), `
          + `at which at least one of the shim's two sites stops emitting. Every assertion this file `
          + `makes about the fault log is then true of a shim that never spoke — including any `
          + `assertion that NOTHING was logged, which is the vacuum this gate exists to refuse. `
          + `Declaring a quiet level as WELL is fine (a level-ladder test needs it); declaring only `
          + `quiet ones is not. Add a loud pairing:\n${REMEDY}`,
      );
    }
  }

  if (observers.length === 0) {
    throw new Error(
      `${rel(root, ownerDir)} has ${files.length} test file(s) and NOT ONE of them reads the fault `
        + `channel by a spelling this gate recognises. That is far more likely to mean the detector `
        + `has gone stale than that the package stopped testing its own fault log. Teach the `
        + `detector the new spelling and add a --self-test case for it; do not leave it reporting a `
        + `pass over a population it can no longer see.`,
    );
  }

  return { findings, owner: rel(root, seamFile), observers, examined: files.length };
}

function packageDirOf(root, file) {
  for (const dir of workspacePackageDirs(root)) {
    if (file.startsWith(dir + sep)) return dir;
  }
  return null;
}

function rel(root, path) {
  return path.startsWith(root + sep) ? path.slice(root.length + 1) : path;
}

function main() {
  let result;
  try {
    result = scan(REPO_ROOT);
  } catch (error) {
    console.error(`check-rest-log-spy-declared: MEASUREMENT FAILED — ${error.message}`);
    process.exit(2);
  }
  if (result.findings.length > 0) {
    console.error(
      `check-rest-log-spy-declared: ${result.findings.length} finding(s):\n\n`
        + `${result.findings.join('\n\n')}\n`,
    );
    process.exit(1);
  }
  console.log(
    `OK: ${result.observers.length} of ${result.examined} test file(s) beside ${result.owner} `
      + `observe the fault log, and every one of them declares its own ${ENV_KEY} level.`,
  );
}

// ── self-test ───────────────────────────────────────────────────────────────
//
// Builds a throwaway workspace in $TMPDIR per case and pins the verdict
// DIRECTION of every rule in BOTH directions: a tree that satisfies the rule
// must pass, and the specific mutation the rule exists to catch must fail. A
// case that can only ever pass is not a case.

const SELF_TEST_VERDICT = 'check-rest-log-spy-declared self-test reached its verdict';

const REGISTRY_SRC = `export const REGISTRY_LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'];\n`;
const SEAM_SRC =
  `export const REST_LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;\n`
  + `export const REST_LOG_DEFAULT_LEVEL: RestLogLevel = 'info';\n`
  + `export function restLogLevel() {\n`
  + `  return String((globalThis as any).process?.env?.OS_REST_LOG ?? '').toLowerCase();\n}\n`;

const DECLARE = (level) => `beforeAll(() => { vi.stubEnv('OS_REST_LOG', '${level}'); });\n`;
const SPY = `const spy = vi.spyOn(console, 'error').mockImplementation(() => {});\n`;
const WARN_SPY = `const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});\n`;
const JEST_SPY = `const spy = jest.spyOn(console, 'error');\n`;
const ASSIGN = `console.error = vi.fn();\n`;
const IMPORTS_SEAM = `import { logError } from './log.js';\n`;
const PLAIN = `it('adds', () => { expect(1 + 1).toBe(2); });\n`;

/** One case's `packages/rest/src` test files, as `{ name: body }`. */
function buildWorkspace(caseDir, tests) {
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");

  mkdirSync(join(caseDir, 'packages/objectql/src'), { recursive: true });
  writeFileSync(join(caseDir, 'packages/objectql/package.json'), JSON.stringify({ name: 'objectql' }));
  writeFileSync(join(caseDir, 'packages/objectql/src/registry.ts'), REGISTRY_SRC);

  mkdirSync(join(caseDir, 'packages/rest/src'), { recursive: true });
  writeFileSync(join(caseDir, 'packages/rest/package.json'), JSON.stringify({ name: 'rest' }));
  writeFileSync(join(caseDir, 'packages/rest/src/log.ts'), SEAM_SRC);
  for (const [name, body] of Object.entries(tests)) {
    writeFileSync(join(caseDir, 'packages/rest/src', name), body);
  }
  return caseDir;
}

/** Every case carries one always-conforming observer so rule "zero observers" never fires by accident. */
const ANCHOR = { 'anchor.test.ts': DECLARE('info') + SPY };

const CASES = [
  ['an observer that declares a loud level passes',
    { 'a.test.ts': DECLARE('info') + SPY }, (r) => r.findings.length === 0],
  ['an observer that declares nothing is a finding',
    { ...ANCHOR, 'a.test.ts': SPY },
    (r) => r.findings.some((f) => f.includes('a.test.ts') && f.includes('declares no OS_REST_LOG'))],
  ['a COMMENT naming the key is not a declaration',
    { ...ANCHOR, 'a.test.ts': `// vi.stubEnv('OS_REST_LOG', 'info') would go here\n` + SPY },
    (r) => r.findings.some((f) => f.includes('a.test.ts') && f.includes('declares no OS_REST_LOG'))],
  ['an unrecognised level is a finding, not a pass',
    { ...ANCHOR, 'a.test.ts': DECLARE('quiet') + SPY },
    (r) => r.findings.some((f) => f.includes("'quiet'") && f.includes('NOT one of the levels'))],
  ['an observer declaring ONLY silent is a finding — the vacuum this gate refuses',
    { ...ANCHOR, 'a.test.ts': DECLARE('silent') + SPY },
    (r) => r.findings.some((f) => f.includes('a.test.ts') && f.includes('only quiet level'))],
  ['an observer declaring ONLY error is a finding — logWarn goes silent',
    { ...ANCHOR, 'a.test.ts': DECLARE('error') + SPY },
    (r) => r.findings.some((f) => f.includes('a.test.ts') && f.includes('only quiet level'))],
  ['a level LADDER — quiet declared as well as loud — passes',
    { 'a.test.ts': DECLARE('info') + DECLARE('silent') + SPY }, (r) => r.findings.length === 0],
  ['the key paired with a VARIABLE is not a declared level',
    { ...ANCHOR, 'a.test.ts': `process.env.OS_REST_LOG = level;\n` + SPY },
    (r) => r.findings.some((f) => f.includes('a.test.ts') && f.includes('cannot read a LEVEL'))],
  ['a console.warn spy is an observer too — logWarn routes there',
    { ...ANCHOR, 'a.test.ts': WARN_SPY },
    (r) => r.findings.some((f) => f.includes('a.test.ts') && f.includes('declares no OS_REST_LOG'))],
  ['a jest.spyOn spelling is an observer too',
    { ...ANCHOR, 'a.test.ts': JEST_SPY },
    (r) => r.findings.some((f) => f.includes('a.test.ts') && f.includes('declares no OS_REST_LOG'))],
  ['a mock installed by ASSIGNMENT is an observer too',
    { ...ANCHOR, 'a.test.ts': ASSIGN },
    (r) => r.findings.some((f) => f.includes('a.test.ts') && f.includes('declares no OS_REST_LOG'))],
  ['importing the seam module makes a file an observer',
    { ...ANCHOR, 'a.test.ts': IMPORTS_SEAM + PLAIN },
    (r) => r.findings.some((f) => f.includes('a.test.ts') && f.includes('imports the fault shim'))],
  ['a NON-observer test file is not conscripted',
    { ...ANCHOR, 'a.test.ts': PLAIN }, (r) => r.findings.length === 0],
  ['a NON-observer that declares a TYPO is still a finding',
    { ...ANCHOR, 'a.test.ts': DECLARE('quiet') + PLAIN },
    (r) => r.findings.some((f) => f.includes('a.test.ts') && f.includes("'quiet'"))],
  ['an env-block declaration inside a test file is readable too',
    { 'a.test.ts': `const env = { OS_REST_LOG: 'info' };\n` + SPY }, (r) => r.findings.length === 0],
];

const THROWING_CASES = [
  ['ZERO observers is a MEASUREMENT FAILURE, not a clean bill',
    { 'a.test.ts': PLAIN }, /NOT ONE of them reads the fault channel/],
  ['a package with NO test files is a MEASUREMENT FAILURE',
    {}, /contains NO test files/],
];

/**
 * Cases taken against the REAL tree rather than a fixture: the declared
 * population has to reach the tree and cover the walk, and the scan has to see
 * a non-empty population in it. A wrong hint runs perfectly green in production
 * and shows up only as a dev who was never told this gate reads their surface.
 */
const LIVE_TREE_CASES = 5;

const SELF_TEST_FLOOR = CASES.length + THROWING_CASES.length + 1 + LIVE_TREE_CASES;

function liveTreeCases(record) {
  record(
    existsSync(join(REPO_ROOT, WORKSPACE_FILE)),
    `the declared population reaches the tree: ${WORKSPACE_FILE}`,
    '',
  );
  record(
    ROOT_DIR_WATCH_HINTS.every((h) => h.includes('/')),
    'every ROOT_DIR_WATCH_HINTS entry is spelled with a separator — a bare segment builds no hint',
    ` — ${JSON.stringify(ROOT_DIR_WATCH_HINTS)}`,
  );
  const roots = ROOT_DIR_WATCH_HINTS.map((h) => h.replace(/\/\*+$/, ''));
  record(
    roots.every((r) => existsSync(join(REPO_ROOT, r))),
    'every declared hint root exists in the tree',
    ` — ${JSON.stringify(roots)}`,
  );
  let uncovered = ['<the workspace walk could not be expanded>'];
  try {
    uncovered = workspacePackageDirs(REPO_ROOT)
      .map((d) => rel(REPO_ROOT, d))
      .filter((r) => !roots.some((root) => r === root || r.startsWith(`${root}/`)));
  } catch { /* reported by the assertion below */ }
  record(
    uncovered.length === 0,
    'the hints COVER the workspace walk this gate performs — a narrower declaration under-names it',
    uncovered.length ? ` — uncovered: ${uncovered.slice(0, 3).join(', ')}` : '',
  );
  // Anti-vacuity over the real tree: a scan that selects nothing is the one
  // failure this gate cannot report as a finding — it would print a perfect
  // green over a detector that matches nothing.
  let live = null;
  let why = '';
  try {
    live = scan(REPO_ROOT);
  } catch (error) {
    why = ` — threw: ${error.message}`;
  }
  record(
    live !== null && live.observers.length > 0 && live.examined > live.observers.length,
    'the real tree yields a NON-EMPTY observer population that is a strict subset of its test files',
    live ? ` — ${live.observers.length} observer(s) of ${live.examined} test file(s)` : why,
  );
}

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'check-rest-log-spy-declared-'));
  let failures = 0;
  let ran = 0;
  const record = (ok, label, detail) => {
    ran += 1;
    if (!ok) { failures += 1; console.error(`  ✗ ${label}${detail}`); }
    else console.log(`  ✓ ${label}`);
  };
  try {
    CASES.forEach(([label, tests, predicate], i) => {
      const dir = buildWorkspace(join(tmp, `case-${i}`), tests);
      let ok = false;
      let detail = '';
      try {
        const result = scan(dir);
        ok = predicate(result);
        if (!ok) detail = ` — findings: ${JSON.stringify(result.findings)}`;
      } catch (error) {
        detail = ` — threw: ${error.message}`;
      }
      record(ok, label, detail);
    });
    THROWING_CASES.forEach(([label, tests, pattern], i) => {
      const dir = buildWorkspace(join(tmp, `throw-${i}`), tests);
      let ok = false;
      let detail = '';
      try {
        const result = scan(dir);
        detail = ` — did NOT throw; findings: ${JSON.stringify(result.findings)}`;
      } catch (error) {
        ok = pattern.test(error.message);
        if (!ok) detail = ` — threw the wrong message: ${error.message}`;
      }
      record(ok, label, detail);
    });

    // A vanished seam is the sibling gate's reader failing, reached through
    // this one — pinned here because this gate DELEGATES that read and a
    // delegation that stopped throwing would be invisible from the sibling.
    {
      const label = 'a vanished seam is a MEASUREMENT FAILURE, reached through the delegated reader';
      const dir = buildWorkspace(join(tmp, 'throw-seam'), ANCHOR);
      writeFileSync(join(dir, 'packages/rest/src/log.ts'), 'export const nothing = 1;\n');
      let ok = false;
      let detail = '';
      try {
        scan(dir);
        detail = ' — did NOT throw';
      } catch (error) {
        ok = /reads process\.env\.OS_REST_LOG anywhere/.test(error.message);
        if (!ok) detail = ` — threw the wrong message: ${error.message}`;
      }
      record(ok, label, detail);
    }

    liveTreeCases(record);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (ran < SELF_TEST_FLOOR) {
    console.error(
      `check-rest-log-spy-declared: self-test ran ${ran} case(s), below its own floor of `
        + `${SELF_TEST_FLOOR}. A shrinking battery is how a gate stops being tested.`,
    );
    process.exit(2);
  }
  console.log(`${SELF_TEST_VERDICT}: ${ran} case(s), ${failures} failure(s).`);
  if (failures > 0) process.exit(1);
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else main();
}
