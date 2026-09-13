#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-rest-log-declared — the package that owns the REST fault-log level
// seam must DECLARE that level in its own vitest config, the declared value
// must be one the seam actually recognises, and the SHIPPED default must stay
// loud enough to report a fault.
//
// ── The defect this keeps closed (#15484, origin #13517 / #15426) ───────────
//
// `packages/rest/src/log.ts`'s `logError` hands its varargs — an `Error` among
// them — to `console.error`, and Node formats an `Error` argument with its full
// stack and its `[cause]` chain. Measured on one green `packages/rest` run:
// 2,095 indented `at ` frame lines, 36.7% of the captured output, 100% of them
// arriving through that one function (1,197 from `error-response.ts`, 841 from
// `rest-server.ts`, 57 from `cause` chains).
//
// ⚠️ Those frames are NOT dead weight, and that is the whole reason this gate
// reads the way it does. At `logWithheldServerFault` the client is told nothing
// and the log is the operator's only copy of the driver text — which lives on
// `error.cause` and is printed only because an `Error` OBJECT reaches
// `console.error`. Four assertions across `rest-5xx-message-sanitization.test.ts`
// and `rest-expected-error-logging.test.ts` pin that by asserting the IDENTITY
// of the error that arrives (#5437 / #4886 / #5489), one of them carrying an
// explicit do-not-delete warning aimed at exactly this repair.
//
// So the ruled repair (decision batch #49 item 2) was a DECLARATION, not a
// quieter product: an `OS_REST_LOG` level seam in the `OS_REGISTRY_LOG` shape,
// with the shipped default unchanged. Which leaves two ways for it to rot, both
// silent, both restoring or destroying the population with every test green:
//
//   1. The declaration is deleted from the harness, or typo'd to a level the
//      seam does not recognise. `log.ts` resolves an unrecognised value to the
//      DEFAULT, so `OS_REST_LOG: 'quiet'` reads as a considered choice and
//      changes nothing. This is the identical failure `check-registry-log-
//      declared` documents for `OS_REGISTRY_LOG`.
//   2. The shipped DEFAULT is lowered to quieten a log. That is the repair the
//      four pins exist to stop, and it is the one an author reaching for "the
//      tests are too noisy" reaches for first.
//
// ── Why this gate reads library code where its sibling refuses to ───────────
//
// `check-registry-log-declared` states, deliberately, that it asserts nothing
// about `packages/objectql`'s shipped `'info'` default: it reads harnesses. The
// difference here is that on #15484 the shipped default IS the ruled
// deliverable — 「⛔ The shipped default does not move. This card buys a
// declaration, not a quieter product」 — so a gate that read only the harness
// would enforce the half that was never in doubt and leave the half that was.
// Rule 4 below is that ruling, made mechanical. It is a floor, not a value
// choice: WHICH loud level ships stays the author's call.
//
// ── What is asserted ────────────────────────────────────────────────────────
//
//   1. The seam is findable. The owning package is located by scanning source
//      for the `OS_REST_LOG` environment read, never hardcoded, so moving
//      `log.ts` cannot leave this gate guarding an empty spot. Zero owners, or
//      more than one, is a MEASUREMENT FAILURE (exit 2) — never a pass.
//   2. The vocabulary is read from the seam's own `REST_LOG_LEVELS`, not copied
//      here, so renaming a level cannot leave this gate enforcing a stale list.
//      An unparseable declaration is exit 2.
//   3. ONE CONTRACT. `REST_LOG_LEVELS` must equal `@objectstack/objectql`'s
//      `REGISTRY_LOG_LEVELS` as a set — the ruling asked for 「one logging
//      contract, not a second ad-hoc env var」, and two seams that drift apart
//      in vocabulary are two contracts wearing one name.
//   4. The shipped default, read from `REST_LOG_DEFAULT_LEVEL`, must be loud
//      enough that BOTH sites still emit — `logWarn`'s threshold, not just
//      `logError`'s. See the block above.
//   5. The owning package's package-root vitest config must carry `OS_REST_LOG`
//      as a KEY inside an `env: { … }` block, with a value that is a string
//      literal naming a recognised level. A docblock about the key never
//      counts: the config's own rationale comment names the variable a dozen
//      times.
//   6. For a config defining inline `projects`, the root-level `env` is INERT
//      for project runs — the measured vitest 4.1.10 property
//      `check-console-intercept-disarm` and `check-registry-log-declared` both
//      record — so EVERY project's own `test` block must carry it too.
//   7. Any OTHER workspace package that declares `OS_REST_LOG` is held to the
//      same value rules. It is not CONSCRIPTED into declaring one — see the
//      narrowness note — but a declaration it does make must be real.
//
// ── A DECIDED narrowness, stated rather than discovered ─────────────────────
//
// The population is the seam's owner plus whoever opts in. It is deliberately
// NOT "every package whose tests route through this shim": measured at the time
// of writing, 21 workspace packages reference `@objectstack/rest` from their
// own test sources, `packages/spec` among them. Conscripting 21 packages into a
// declaration is a bigger change than the one that was ruled, and it would put
// this gate in the business of quietening suites it has never measured. The
// extension path is rule 7 — opt in by declaring, and the value is checked.
//
// ⚠️ Known duplication, not hidden: the brace-matching and env-block reading
// below are a second spelling of `check-registry-log-declared.mjs`'s. Extracting
// one shared reader is the right follow-up; it is not done here because that
// gate's self-test carries a battery floor this card has no mandate to move.
//
// Exit 0: the seam is declared and the default is loud. Exit 1: findings (each
// names the file, what is wrong, and the line to write). Exit 2: the gate could
// not measure — never reported as a pass.
//
//   node scripts/check-rest-log-declared.mjs
//   node scripts/check-rest-log-declared.mjs --self-test

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { maskComments, maskCommentsAndLiterals } from './js-comment-mask.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { workspacePackageDirs } from './check-console-intercept-disarm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/** The env seam this gate is about. */
export const ENV_KEY = 'OS_REST_LOG';
/** Where the sibling vocabulary lives, for the one-contract check (rule 3). */
export const REGISTRY_LEVELS_SOURCE = 'packages/objectql/src/registry.ts';

const VITEST_CONFIG_NAMES = [
  'vitest.config.ts', 'vitest.config.mts', 'vitest.config.cts',
  'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs',
];

const SOURCE_EXT_RE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const TEST_FILE_RE = /\.(?:test|spec)\.[a-z]+$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', 'build']);

/** The environment READ that marks the file owning the seam. */
const ENV_READ_RE = new RegExp(String.raw`process\s*\)?\s*\??\.\s*env\s*\??\.\s*${ENV_KEY}\b`);

const ENV_BLOCK_RE = /\benv\s*:\s*\{/g;
const KEY_RE = new RegExp(String.raw`\b${ENV_KEY}\s*:`);
const VALUE_RE = new RegExp(String.raw`\b${ENV_KEY}\s*:\s*(['"])([^'"]*)\1`);
const PROJECTS_RE = /\bprojects\s*:\s*\[/;
const TEST_BLOCK_RE = /\btest\s*:\s*\{/g;

const REMEDY = `    env: { ${ENV_KEY}: '<level>' },`;

/**
 * The levels that this seam recognises, read from its own source.
 * @returns {{levels: string[], defaultLevel: string, file: string}}
 */
export function readSeam(file) {
  const masked = maskComments(readFileSync(file, 'utf8'));
  const lv = /REST_LOG_LEVELS[^=]*=\s*\[([^\]]*)\]/.exec(masked);
  if (!lv) {
    throw new Error(
      `could not read REST_LOG_LEVELS out of ${file} — the declaration moved or changed shape. `
        + `Teach this reader the new one; do NOT hardcode the levels here, or renaming a level `
        + `leaves this gate enforcing a list nobody maintains.`,
    );
  }
  const levels = [...lv[1].matchAll(/['"]([a-z]+)['"]/g)].map((x) => x[1]);
  if (levels.length === 0) throw new Error(`REST_LOG_LEVELS in ${file} parsed to ZERO levels`);

  const df = /REST_LOG_DEFAULT_LEVEL[^=]*=\s*['"]([a-z]+)['"]/.exec(masked);
  if (!df) {
    throw new Error(
      `could not read REST_LOG_DEFAULT_LEVEL out of ${file}. The shipped default is the ruled `
        + `deliverable of #15484, so a default this gate cannot read is a measurement failure, `
        + `not a pass.`,
    );
  }
  return { levels, defaultLevel: df[1], file };
}

/** The sibling seam's vocabulary, for rule 3. */
export function readRegistryLevels(root) {
  const file = join(root, REGISTRY_LEVELS_SOURCE);
  if (!existsSync(file)) {
    throw new Error(
      `${REGISTRY_LEVELS_SOURCE} is missing — this gate reads REGISTRY_LOG_LEVELS from it to hold `
        + `the two seams to ONE vocabulary. Point REGISTRY_LEVELS_SOURCE at the engine's new home.`,
    );
  }
  const m = /REGISTRY_LOG_LEVELS[^=]*=\s*\[([^\]]*)\]/.exec(maskComments(readFileSync(file, 'utf8')));
  if (!m) throw new Error(`could not read REGISTRY_LOG_LEVELS out of ${REGISTRY_LEVELS_SOURCE}`);
  const levels = [...m[1].matchAll(/['"]([a-z]+)['"]/g)].map((x) => x[1]);
  if (levels.length === 0) throw new Error(`REGISTRY_LOG_LEVELS parsed to ZERO levels`);
  return levels;
}

/** Every non-test source file under `dir`. */
function sourceFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) sourceFiles(join(dir, e.name), out);
    } else if (SOURCE_EXT_RE.test(e.name) && !TEST_FILE_RE.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

/**
 * Locate the file that OWNS the seam by its environment read.
 * @returns {string[]} absolute paths, one per owner found
 */
export function findSeamOwners(root) {
  const owners = [];
  for (const dir of workspacePackageDirs(root)) {
    for (const file of sourceFiles(dir)) {
      let raw;
      try {
        raw = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (!raw.includes(ENV_KEY)) continue;
      if (ENV_READ_RE.test(maskComments(raw))) owners.push(file);
    }
  }
  return owners;
}

/** Brace-matched ranges of every `env: { … }` block. */
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
        if (depth === 0) { ranges.push([open, i]); break; }
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
      if (depth === 0) { end = i; break; }
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
        if (d === 0) { ranges.push([open, i]); break; }
      }
    }
  }
  return ranges;
}

/** @returns {{declared: boolean, level: string|null, unquoted: boolean, recognised?: boolean}} */
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

function describeVerdict(verdict, where, levels) {
  if (!verdict.declared) {
    return `${where} declares no ${ENV_KEY} (a comment about it does not count)`;
  }
  if (verdict.unquoted) {
    return `${where} sets ${ENV_KEY} to something this gate cannot read as a string literal`;
  }
  return (
    `${where} sets ${ENV_KEY}: '${verdict.level}', which is NOT one of the levels the seam `
    + `recognises (${levels.join(', ')}). log.ts resolves an unrecognised value to the SHIPPED `
    + `DEFAULT, silently — the declaration reads as a considered choice and declares nothing`
  );
}

/** The verdict for one package's vitest config. */
function checkConfig(root, dir, levels, findings, { required }) {
  const name = rel(root, dir);
  const configName = VITEST_CONFIG_NAMES.find((n) => existsSync(join(dir, n)));
  if (!configName) {
    if (required) {
      findings.push(
        `${name}: owns the ${ENV_KEY} seam and runs vitest with NO package-root vitest config, so `
          + `it can declare nothing. Add a vitest.config.ts whose test block carries:\n${REMEDY}`,
      );
    }
    return;
  }
  const raw = readFileSync(join(dir, configName), 'utf8');
  const code = maskCommentsAndLiterals(raw);
  const comments = maskComments(raw);
  const where = `${name}/${configName}`;

  if (!required && !KEY_RE.test(code)) return; // opt-in population: silent unless it opted in

  if (PROJECTS_RE.test(code)) {
    const blocks = projectTestBlockRanges(code);
    if (blocks.length === 0) {
      findings.push(
        `${where}: defines inline projects and no project test block could be read — a ROOT-level `
          + `env is INERT for project runs, so this config cannot be shown to declare anything. `
          + `Put\n${REMEDY}\ninside EVERY project's own test block.`,
      );
      return;
    }
    const bad = blocks
      .map((r) => declarationIn(code, comments, r, levels))
      .filter((v) => !v.declared || v.unquoted || !v.recognised);
    if (bad.length > 0) {
      findings.push(
        `${where}: defines inline projects, and ${bad.length} of ${blocks.length} project test `
          + `block(s) do not declare a recognised ${ENV_KEY} level — first: `
          + `${describeVerdict(bad[0], 'that block', levels)}. A ROOT-level env is INERT for project `
          + `runs (the measured vitest 4.1.10 property check-console-intercept-disarm records). `
          + `Put\n${REMEDY}\ninside EVERY project's own test block.`,
      );
    }
    return;
  }

  const verdict = declarationIn(code, comments, [0, code.length - 1], levels);
  if (!verdict.declared || verdict.unquoted || !verdict.recognised) {
    findings.push(`${describeVerdict(verdict, where, levels)}. Add to the test block:\n${REMEDY}`);
  }
}

/** @returns {{findings: string[], owner: string, levels: string[], defaultLevel: string}} */
export function scan(root) {
  const owners = findSeamOwners(root);
  if (owners.length === 0) {
    throw new Error(
      `no source file reads process.env.${ENV_KEY} anywhere in the workspace. The seam this gate `
        + `guards is GONE or was renamed — which is not the same fact as "everything declares it". `
        + `A gate that finds nothing passes everything.`,
    );
  }
  if (owners.length > 1) {
    throw new Error(
      `${owners.length} source files read process.env.${ENV_KEY} (${owners.map((o) => rel(root, o)).join(', ')}). `
        + `The seam is meant to live in ONE shim; two readers means two spellings of the level and `
        + `this gate can no longer say which one a harness is declaring against.`,
    );
  }
  const seam = readSeam(owners[0]);
  const findings = [];

  // Rule 3 — one contract.
  const registry = readRegistryLevels(root);
  const a = [...seam.levels].sort().join(',');
  const b = [...registry].sort().join(',');
  if (a !== b) {
    findings.push(
      `${rel(root, seam.file)}: REST_LOG_LEVELS (${seam.levels.join(', ')}) has drifted from `
        + `${REGISTRY_LEVELS_SOURCE}'s REGISTRY_LOG_LEVELS (${registry.join(', ')}). The ruling on `
        + `#15484 asked for ONE logging contract with two populations, not a second ad-hoc `
        + `environment variable. Bring the two vocabularies back together, in both sources.`,
    );
  }

  // Rule 4 — the shipped default stays loud.
  if (!seam.levels.includes(seam.defaultLevel)) {
    findings.push(
      `${rel(root, seam.file)}: REST_LOG_DEFAULT_LEVEL is '${seam.defaultLevel}', which is not one `
        + `of REST_LOG_LEVELS (${seam.levels.join(', ')}) — the shipped default resolves to nothing.`,
    );
  } else if (QUIET_DEFAULTS.has(seam.defaultLevel)) {
    findings.push(
      `${rel(root, seam.file)}: REST_LOG_DEFAULT_LEVEL is '${seam.defaultLevel}', which stops at `
        + `least one of this shim's two sites from reporting at all for EVERY real caller. `
        + `⛔ #15484 bought a declaration, not a quieter product: 「the shipped default does not `
        + `move — a reported fault keeps printing the full Error (message, cause chain, frames)」. `
        + `Suppression is only ever what a HARNESS declares. If a suite is too noisy, declare a `
        + `level in that suite's vitest config; do not lower the default.`,
    );
  }

  const ownerDir = packageDirOf(root, seam.file);
  for (const dir of workspacePackageDirs(root)) {
    checkConfig(root, dir, seam.levels, findings, { required: dir === ownerDir });
  }
  return { findings, owner: rel(root, seam.file), levels: seam.levels, defaultLevel: seam.defaultLevel };
}

/** Levels at which at least one of the shim's two sites goes silent. */
const QUIET_DEFAULTS = new Set(['silent', 'error']);

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
    console.error(`check-rest-log-declared: MEASUREMENT FAILED — ${error.message}`);
    process.exit(2);
  }
  if (result.findings.length > 0) {
    console.error(
      `check-rest-log-declared: ${result.findings.length} finding(s):\n\n`
        + `${result.findings.join('\n\n')}\n`,
    );
    process.exit(1);
  }
  console.log(
    `OK: ${result.owner} owns the ${ENV_KEY} seam (${result.levels.join('/')}), its shipped default `
      + `'${result.defaultLevel}' still reports a fault in full, and every declaring harness names a `
      + `recognised level.`,
  );
}

// ── self-test ───────────────────────────────────────────────────────────────
//
// Builds a throwaway workspace in $TMPDIR per case and pins the verdict
// DIRECTION of every rule in BOTH directions: a tree that satisfies the rule
// must pass, and the specific mutation the rule exists to catch must fail. A
// case that can only ever pass is not a case.

const SELF_TEST_VERDICT = 'check-rest-log-declared self-test reached its verdict';

const REGISTRY_SRC = `export const REGISTRY_LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'];\n`;
const SEAM_SRC = (levels, def) =>
  `export const REST_LOG_LEVELS = [${levels.map((l) => `'${l}'`).join(', ')}] as const;\n`
  + `export const REST_LOG_DEFAULT_LEVEL: RestLogLevel = '${def}';\n`
  + `export function restLogLevel() {\n`
  + `  const raw = String((globalThis as any).process?.env?.OS_REST_LOG ?? '').toLowerCase();\n`
  + `  return raw;\n}\n`;
const GOOD_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'];

function buildWorkspace(caseDir, { seamLevels = GOOD_LEVELS, seamDefault = 'info', config, extra = {} } = {}) {
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");

  mkdirSync(join(caseDir, 'packages/objectql/src'), { recursive: true });
  writeFileSync(join(caseDir, 'packages/objectql/package.json'), JSON.stringify({ name: 'objectql' }));
  writeFileSync(join(caseDir, 'packages/objectql/src/registry.ts'), REGISTRY_SRC);

  mkdirSync(join(caseDir, 'packages/rest/src'), { recursive: true });
  writeFileSync(
    join(caseDir, 'packages/rest/package.json'),
    JSON.stringify({ name: 'rest', scripts: { test: 'vitest run' } }),
  );
  writeFileSync(join(caseDir, 'packages/rest/src/log.ts'), SEAM_SRC(seamLevels, seamDefault));
  if (config !== null) {
    writeFileSync(join(caseDir, 'packages/rest/vitest.config.ts'), config ?? DECLARED_CONFIG);
  }
  for (const [p, body] of Object.entries(extra)) {
    mkdirSync(dirname(join(caseDir, p)), { recursive: true });
    writeFileSync(join(caseDir, p), body);
  }
  return caseDir;
}

const DECLARED_CONFIG = `export default { test: { env: { OS_REST_LOG: 'info' } } };\n`;
const UNDECLARED_CONFIG = `export default { test: { globals: true } };\n`;
const COMMENT_ONLY_CONFIG = `// OS_REST_LOG: 'silent' would go here\nexport default { test: { globals: true } };\n`;
const TYPO_CONFIG = `export default { test: { env: { OS_REST_LOG: 'quiet' } } };\n`;
const UNQUOTED_CONFIG = `export default { test: { env: { OS_REST_LOG: LEVEL } } };\n`;
const PROJECTS_BOTH = `export default { test: { projects: [`
  + `{ test: { name: 'a', env: { OS_REST_LOG: 'info' } } },`
  + `{ test: { name: 'b', env: { OS_REST_LOG: 'silent' } } }`
  + `], env: { OS_REST_LOG: 'info' } } };\n`;
const PROJECTS_ONE_MISSING = `export default { test: { projects: [`
  + `{ test: { name: 'a', env: { OS_REST_LOG: 'info' } } },`
  + `{ test: { name: 'b', globals: true } }`
  + `], env: { OS_REST_LOG: 'info' } } };\n`;

const CASES = [
  ['a declared, recognised level passes', {}, (r) => r.findings.length === 0],
  ['no declaration at all is a finding', { config: UNDECLARED_CONFIG },
    (r) => r.findings.some((f) => f.includes('declares no OS_REST_LOG'))],
  ['a COMMENT naming the key is not a declaration', { config: COMMENT_ONLY_CONFIG },
    (r) => r.findings.some((f) => f.includes('declares no OS_REST_LOG'))],
  ['an unrecognised level is a finding, not a pass', { config: TYPO_CONFIG },
    (r) => r.findings.some((f) => f.includes("'quiet'") && f.includes('NOT one of the levels'))],
  ['a value this gate cannot read as a literal is a finding', { config: UNQUOTED_CONFIG },
    (r) => r.findings.some((f) => f.includes('cannot read as a string literal'))],
  ['no vitest config at all is a finding for the owner', { config: null },
    (r) => r.findings.some((f) => f.includes('NO package-root vitest config'))],
  ['every inline project declaring passes', { config: PROJECTS_BOTH }, (r) => r.findings.length === 0],
  ['one inline project missing the declaration is a finding', { config: PROJECTS_ONE_MISSING },
    (r) => r.findings.some((f) => f.includes('project test block(s) do not declare'))],
  ['a SILENT shipped default is a finding', { seamDefault: 'silent' },
    (r) => r.findings.some((f) => f.includes('REST_LOG_DEFAULT_LEVEL') && f.includes('EVERY real caller'))],
  ['an ERROR shipped default is a finding — logWarn goes silent', { seamDefault: 'error' },
    (r) => r.findings.some((f) => f.includes('REST_LOG_DEFAULT_LEVEL') && f.includes('EVERY real caller'))],
  ['a WARN shipped default passes — the floor is a floor, not a value choice', { seamDefault: 'warn' },
    (r) => r.findings.length === 0],
  ['a default outside the vocabulary is a finding', { seamDefault: 'chatty' },
    (r) => r.findings.some((f) => f.includes('resolves to nothing'))],
  ['a drifted vocabulary is a finding', { seamLevels: ['info', 'warn', 'error', 'silent'] },
    (r) => r.findings.some((f) => f.includes('drifted from'))],
  ['another package that declares the key is checked too',
    { extra: {
      'packages/other/package.json': JSON.stringify({ name: 'other', scripts: { test: 'vitest run' } }),
      'packages/other/vitest.config.ts': TYPO_CONFIG,
    } },
    (r) => r.findings.some((f) => f.includes('packages/other') && f.includes("'quiet'"))],
  ['another package that declares NOTHING is not conscripted',
    { extra: {
      'packages/other/package.json': JSON.stringify({ name: 'other', scripts: { test: 'vitest run' } }),
      'packages/other/vitest.config.ts': UNDECLARED_CONFIG,
    } },
    (r) => r.findings.length === 0],
];

const THROWING_CASES = [
  ['a vanished seam is a MEASUREMENT FAILURE, not a pass',
    (dir) => writeFileSync(join(dir, 'packages/rest/src/log.ts'), 'export const nothing = 1;\n'),
    /reads process\.env\.OS_REST_LOG anywhere/],
  ['two seam readers is a MEASUREMENT FAILURE',
    (dir) => {
      mkdirSync(join(dir, 'packages/other/src'), { recursive: true });
      writeFileSync(join(dir, 'packages/other/package.json'), JSON.stringify({ name: 'other' }));
      writeFileSync(join(dir, 'packages/other/src/log2.ts'), SEAM_SRC(GOOD_LEVELS, 'info'));
    },
    /source files read process\.env\.OS_REST_LOG/],
  ['an unreadable vocabulary is a MEASUREMENT FAILURE',
    (dir) => writeFileSync(
      join(dir, 'packages/rest/src/log.ts'),
      'export const REST_LOG_DEFAULT_LEVEL = \'info\';\n'
      + 'export const x = process.env.OS_REST_LOG;\n',
    ),
    /could not read REST_LOG_LEVELS/],
  ['an unreadable default is a MEASUREMENT FAILURE',
    (dir) => writeFileSync(
      join(dir, 'packages/rest/src/log.ts'),
      'export const REST_LOG_LEVELS = [\'debug\', \'info\', \'warn\', \'error\', \'silent\'];\n'
      + 'export const x = process.env.OS_REST_LOG;\n',
    ),
    /could not read REST_LOG_DEFAULT_LEVEL/],
];

const SELF_TEST_FLOOR = CASES.length + THROWING_CASES.length;

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'check-rest-log-declared-'));
  let failures = 0;
  let ran = 0;
  try {
    CASES.forEach(([label, opts, predicate], i) => {
      const dir = buildWorkspace(join(tmp, `case-${i}`), opts);
      let ok = false;
      let detail = '';
      try {
        const result = scan(dir);
        ok = predicate(result);
        if (!ok) detail = ` — findings: ${JSON.stringify(result.findings)}`;
      } catch (error) {
        detail = ` — threw: ${error.message}`;
      }
      ran += 1;
      if (!ok) { failures += 1; console.error(`  ✗ ${label}${detail}`); }
      else console.log(`  ✓ ${label}`);
    });
    THROWING_CASES.forEach(([label, mutate, pattern], i) => {
      const dir = buildWorkspace(join(tmp, `throw-${i}`), {});
      mutate(dir);
      let ok = false;
      let detail = '';
      try {
        const result = scan(dir);
        detail = ` — did NOT throw; findings: ${JSON.stringify(result.findings)}`;
      } catch (error) {
        ok = pattern.test(error.message);
        if (!ok) detail = ` — threw the wrong message: ${error.message}`;
      }
      ran += 1;
      if (!ok) { failures += 1; console.error(`  ✗ ${label}${detail}`); }
      else console.log(`  ✓ ${label}`);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (ran < SELF_TEST_FLOOR) {
    console.error(
      `check-rest-log-declared: self-test ran ${ran} case(s), below its own floor of `
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
