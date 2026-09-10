#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-tier-file-adoption -- a package that ADOPTS a nightly tier must read
 * the switch, and it must go red on the pull request that adopts it.
 *
 *   node scripts/check-tier-file-adoption.mjs              # the sweep (the gate)
 *   node scripts/check-tier-file-adoption.mjs --self-test  # the rule itself
 *
 * ## The defect this exists for
 *
 * `scripts/nightly-tiers.mjs` is the ONE reader of `OS_TEST_TIERS`, the switch
 * that moves the `e2e` and `live` tiers off the per-pull-request and merge-queue
 * runs onto a nightly on `main`. Its header states what that does NOT buy: a
 * package that adds its first `*.e2e.test.*` or `*.live.test.*` file WITHOUT
 * reading the switch runs that file in the merge queue (nothing excludes it) and
 * its WHOLE suite under the nightly (nothing narrows it). Both are silent.
 *
 * `nightly-tiers.mjs --check` already judges that, correctly and semantically --
 * by asking vitest what it COLLECTS under each setting -- and the nightly
 * workflow refuses to run past a package that fails it. But that is the NIGHTLY.
 * On the pull request that introduces the file, nothing is red: the file runs in
 * the queue (the cost the tier split moved out) until the next nightly notices,
 * and the nightly's refusal then blocks the whole tier run for one package's
 * omission. This gate is the per-pull-request half.
 *
 * ## Why a static walk and not `--check`'s vitest probe
 *
 * `--check` measures the truth: two `vitest list --filesOnly` runs per
 * tier-owning package, under each setting, judged by `judgeCollection`. That is
 * the right instrument for the nightly and the wrong one for every pull request
 * -- it boots vitest, twice per package, to answer a question about adoption.
 * This gate answers the CHEAPER question statically: does the package's vitest
 * configuration reach the switch at all? It spawns nothing, reads a handful of
 * files, and shares `nightly-tiers.mjs`'s own tier-file predicate and package
 * walk (`tierPackages`) so the two can never disagree about WHICH files are
 * tier files or WHICH packages own them.
 *
 * ## ⛔ This is a SPELLING gate -- its blind spot, stated once
 *
 * It asserts that a tier-owning package's vitest configuration ROUTES THROUGH
 * the one reader; it does NOT assert that the routing is correct. A config that
 * imports `readTierMode` and then ignores what it returns satisfies this gate
 * and fails `nightly-tiers.mjs --check`. That division is deliberate and is the
 * `check-comment-mask-adoption` idiom: the BEHAVIOUR is pinned at the module
 * (`nightly-tiers.mjs --self-test`) and measured on the nightly against real
 * collection; what nothing covered is the pull request that adopts a tier and
 * never reaches the module at all. Green here means "the switch is wired in",
 * never "the partition is right".
 *
 * ## Why the detector cannot be a grep for the variable name
 *
 * Measured on this tree at d03c3c96d6, on the ONE package that owns tier files:
 * `packages/cli/vitest.config.ts` names `OS_TEST_TIERS` 5 times and
 * `packages/cli/vitest-tiers.ts` 4 times -- and with comments masked, ZERO
 * times in either. All nine occurrences are prose. The actual read is an import
 * edge: the config imports `./vitest-tiers.js`, which imports `readTierMode`
 * and `selectTierFiles` from `../../scripts/nightly-tiers.mjs`, where the one
 * code-position occurrence of the name lives.
 *
 * So the two obvious detectors are both wrong, in opposite directions, on a
 * population of one:
 *
 *   - grep the config for the name, comments included -> GREEN on prose. It
 *     would pass a package whose config merely MENTIONS the switch in a comment
 *     explaining why it does not read it.
 *   - grep the config for the name with comments masked -> RED on
 *     `packages/cli`, the one package in the tree that does this correctly. A
 *     100% fabrication rate over today's entire population.
 *
 * The detector therefore walks the config's LOCAL import closure and accepts
 * either signal in a code position: a value import of the switch-reading
 * surface from the reader module, or the variable named directly. Both
 * directions are pinned in the self-test.
 *
 * ## Zero tier files is a GREEN, and it PRINTS THE ZERO
 *
 * A gate that reports "clean" by never looking is indistinguishable from one
 * that looked and found nothing -- unless the zero is on the screen. So the
 * tier-file count is printed on every green, and the count of workspace
 * packages walked with it: "clean" is not a sentence this gate can print
 * without a number behind it.
 *
 * This inverts the anti-vacuity rule its sibling `check-registry-log-declared`
 * carries, and the inversion is deliberate rather than an omission. There, a
 * selection of zero means the predicate went blind, because the repo is known
 * to boot engines in at least eight packages. Here, a tier-file population of
 * zero is a legitimate and expected state of the tree -- it is what the tree
 * looked like before `packages/cli` adopted the tier, and what it would look
 * like again if the tier were retired. What this gate refuses to call green is
 * a walk that found NO WORKSPACE PACKAGES: that is the measurement failing, and
 * it exits 2.
 *
 * Exit 0: every tier-owning package reads the switch (or none owns a tier file,
 * with the zero printed). Exit 1: findings, each naming the package AND its
 * tier files. Exit 2: the gate could not measure -- never reported as a pass.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { maskComments } from './js-comment-mask.mjs';
import { workspacePackageDirs } from './workspace-enumerator.mjs';
import { NIGHTLY_TIERS, TIER_ENV, tierPackages } from './nightly-tiers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/* ── The declared path population (#13519 / check-declared-population-live) ───
 * These literals ARE what this gate reads: the workspace file that seeds the
 * walk, the one module that owns the switch, and the package subtrees the walk
 * expands into. The self-test holds each against the tree, so a moved read reds
 * here rather than turning this gate silently unnameable by any dispatch brief.
 * Spelled WITH a separator: a bare single-segment literal builds no hint at all
 * (`hintCovers`). */
export const WORKSPACE_FILE = 'pnpm-workspace.yaml';
export const READER_MODULE = 'scripts/nightly-tiers.mjs';
export const ROOT_DIR_WATCH_HINTS = ['packages/**', 'apps/**', 'examples/**'];

/**
 * The exports of the reader module that TOUCH the switch. Importing one of
 * these is the spelling that says "this config reads `OS_TEST_TIERS`"; importing
 * only `isNightlyTierFile` (a pure filename predicate) is not.
 */
export const READING_EXPORTS = Object.freeze(['readTierMode', 'selectTierFiles', TIER_ENV]);

/** vitest reads exactly these names at a package root. */
const VITEST_CONFIG_NAMES = Object.freeze([
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
]);

/** Extensions the local-closure walk will resolve a relative specifier to. */
const RESOLVE_EXTS = Object.freeze(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx']);

/** How far the closure walk may follow relative imports before it gives up. */
const MAX_CLOSURE_FILES = 200;

// ---------------------------------------------------------------------------
// Reading a source for the two signals
// ---------------------------------------------------------------------------

/**
 * Every `import`/`export ... from '<spec>'`, `import('<spec>')` and
 * `require('<spec>')` specifier in `masked`, as `{ spec, named, typeOnly, wide }`.
 *
 * `named` is the brace list with any inline `type` prefixes stripped and those
 * bindings dropped; `typeOnly` marks `import type ...`; `wide` marks a default
 * or namespace import, whose bindings cannot be read off the statement.
 *
 * Deliberately regex-shaped over COMMENT-MASKED source rather than parsed: the
 * repo bans new raw parser entry points outside `scripts/ts-parse.mjs`
 * (`check:parse-guard`), and the question here -- "does this file name that
 * module" -- is answered by the specifier text.
 */
export function importsOf(masked) {
  const out = [];
  const src = String(masked);

  const fromRe = /\b(import|export)\b([\s\S]{0,400}?)\bfrom\s*(['"])([^'"]+)\3/g;
  for (let m = fromRe.exec(src); m !== null; m = fromRe.exec(src)) {
    const clause = m[2];
    const spec = m[4];
    const typeOnly = /^\s*type\b/.test(clause);
    const brace = /\{([\s\S]*?)\}/.exec(clause);
    let named = [];
    let wide = false;
    if (brace) {
      named = brace[1]
        .split(',')
        .map((piece) => piece.trim())
        .filter(Boolean)
        .filter((piece) => !/^type\b/.test(piece))
        .map((piece) => piece.split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
    } else if (m[1] === 'import' && /\S/.test(clause.replace(/^\s*type\b/, ''))) {
      wide = true;
    }
    out.push({ spec, named, typeOnly, wide });
  }

  const callRe = /\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (let m = callRe.exec(src); m !== null; m = callRe.exec(src)) {
    out.push({ spec: m[2], named: [], typeOnly: false, wide: true });
  }
  return out;
}

/**
 * Why `masked` reads the switch, or `null`. Pure, so every direction is pinned
 * without touching a filesystem.
 *
 * @param masked      comment-masked source text
 * @param readerSpecs the specifiers in this file that resolve to the reader module
 */
export function switchReadReason(masked, readerSpecs) {
  const src = String(masked);
  const reader = new Set(readerSpecs);
  for (const { spec, named, typeOnly, wide } of importsOf(src)) {
    if (!reader.has(spec)) continue;
    if (typeOnly) continue; // a type import reads nothing at runtime
    const hit = named.filter((n) => READING_EXPORTS.includes(n));
    if (hit.length > 0) return `imports ${hit.join(', ')} from ${READER_MODULE}`;
    if (wide && READING_EXPORTS.some((n) => new RegExp(`\\b${n}\\b`).test(src))) {
      return `imports ${READER_MODULE} whole and names ${READING_EXPORTS.filter((n) => new RegExp(`\\b${n}\\b`).test(src)).join(', ')}`;
    }
  }
  if (new RegExp(`\\b${TIER_ENV}\\b`).test(src)) return `names ${TIER_ENV} in a code position`;
  return null;
}

// ---------------------------------------------------------------------------
// The local import closure
// ---------------------------------------------------------------------------

/** Resolve a RELATIVE specifier from `fromFile` to a real file, or `null`. */
function resolveRelative(fromFile, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [];
  const js = /^(.*)\.(c|m)?js$/.exec(base);
  if (js) {
    // TypeScript's NodeNext spelling: `./x.js` on disk is `./x.ts`.
    const stem = js[1];
    const flavour = js[2] ?? '';
    candidates.push(`${stem}.${flavour}ts`, `${stem}.ts`, `${stem}.tsx`);
  }
  candidates.push(base, ...RESOLVE_EXTS.map((e) => `${base}${e}`), ...RESOLVE_EXTS.map((e) => join(base, `index${e}`)));
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
      // unreadable candidate -- keep trying the rest
    }
  }
  return null;
}

/**
 * Walk the local relative-import closure from `entries`, asking each file for a
 * switch read. Returns `{ reason, via, visited }` -- `reason` is `null` when no
 * file in the closure reads the switch.
 */
export function closureReadsSwitch(repoRoot, entries) {
  const readerAbs = resolve(repoRoot, READER_MODULE);
  const visited = new Set();
  const queue = entries.filter((f) => existsSync(f));
  while (queue.length > 0 && visited.size < MAX_CLOSURE_FILES) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    let masked;
    try {
      masked = maskComments(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const specs = importsOf(masked);
    const readerSpecs = specs.map((s) => s.spec).filter((spec) => resolveRelative(file, spec) === readerAbs);
    const reason = switchReadReason(masked, readerSpecs);
    if (reason !== null) return { reason, via: relative(repoRoot, file).split(sep).join('/'), visited };
    for (const { spec } of specs) {
      const next = resolveRelative(file, spec);
      if (next === null || next === readerAbs) continue;
      if (next.includes(`${sep}node_modules${sep}`)) continue;
      if (!visited.has(next)) queue.push(next);
    }
  }
  return { reason: null, via: null, visited };
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

const REMEDY_HEAD =
  `A package that owns a nightly-tier file must read ${TIER_ENV}, or the file runs in the merge `
  + 'queue (nothing excludes it) and the package\'s WHOLE suite runs under the nightly (nothing '
  + 'narrows it) -- both silent.';

function remedyFor(configs) {
  const where = configs.length > 0 ? configs.join(', ') : 'a vitest config at the package root';
  return `${REMEDY_HEAD}\n    Wire the switch in ${where} by routing the file list through the one `
    + `reader, the way packages/cli does:\n`
    + `      import { readTierMode, selectTierFiles } from '<relative path>/${READER_MODULE}';\n`
    + `      const files = selectTierFiles(everyTestFileOnDisk, readTierMode());\n`
    + `    Then confirm the partition with: node ${READER_MODULE} --check`;
}

/**
 * Judge every tier-owning package under `repoRoot`.
 *
 * Returns `{ packagesWalked, owners, tierFileCount, perTier, honouring, findings }`.
 */
export function scan(repoRoot = REPO_ROOT) {
  const packagesWalked = workspacePackageDirs(repoRoot).length;
  const owners = tierPackages(repoRoot);
  const perTier = Object.fromEntries(NIGHTLY_TIERS.map((t) => [t, 0]));
  let tierFileCount = 0;
  for (const owner of owners) {
    tierFileCount += owner.files.length;
    for (const file of owner.files) {
      for (const tier of NIGHTLY_TIERS) {
        if (new RegExp(`\\.${tier}\\.(?:test|spec)\\.`).test(file)) perTier[tier] += 1;
      }
    }
  }

  const findings = [];
  const honouring = [];
  for (const { name, path: dir, files } of owners) {
    const pkgAbs = join(repoRoot, dir);
    const configs = VITEST_CONFIG_NAMES.filter((n) => existsSync(join(pkgAbs, n)));
    const { reason, via } = closureReadsSwitch(repoRoot, configs.map((n) => join(pkgAbs, n)));
    if (reason !== null) {
      honouring.push({ name, dir, files: files.length, via, reason });
      continue;
    }
    const shown = files.slice(0, 10);
    findings.push(
      `${name} (${dir}) owns ${files.length} nightly-tier test file(s) and its vitest configuration `
        + `does not reach ${TIER_ENV}:\n`
        + shown.map((f) => `      ${dir}/${f}`).join('\n')
        + (files.length > shown.length ? `\n      … and ${files.length - shown.length} more` : '')
        + `\n    ${remedyFor(configs)}`,
    );
  }
  return { packagesWalked, owners, tierFileCount, perTier, honouring, findings };
}

function tierCountLine(tierFileCount, perTier) {
  const parts = NIGHTLY_TIERS.map((t) => `${perTier[t]} ${t}`).join(', ');
  return `${tierFileCount} nightly-tier test file(s) on disk (${parts})`;
}

function main() {
  let result;
  try {
    result = scan(REPO_ROOT);
  } catch (error) {
    console.error(`check-tier-file-adoption: MEASUREMENT FAILED — ${error.message}`);
    process.exit(2);
  }
  const { packagesWalked, owners, tierFileCount, perTier, honouring, findings } = result;

  if (packagesWalked === 0) {
    console.error(
      'check-tier-file-adoption: MEASUREMENT FAILED — the workspace walk found ZERO packages, and '
        + 'this repo has dozens. The population went missing, which is not the same fact as "no '
        + 'package owns a tier file".',
    );
    process.exit(2);
  }

  if (findings.length > 0) {
    console.error(
      `check-tier-file-adoption: ${packagesWalked} workspace package(s) walked, `
        + `${tierCountLine(tierFileCount, perTier)}; ${findings.length} owning package(s) do not read `
        + `${TIER_ENV}:\n\n  ${findings.join('\n\n  ')}\n`,
    );
    process.exit(1);
  }

  // The zero is PRINTED — see the header. "Clean" is not a sentence this gate
  // can print without the count behind it.
  console.log(
    `OK: ${packagesWalked} workspace package(s) walked, ${tierCountLine(tierFileCount, perTier)}, `
      + `owned by ${owners.length} package(s); every one reads ${TIER_ENV}.`,
  );
  for (const { name, files, via, reason } of honouring) {
    console.log(`    ${name} — ${files} file(s); ${reason} (via ${via})`);
  }
  if (owners.length === 0) {
    console.log(`    no package owns a nightly-tier file, so there is nothing to adopt the switch.`);
  }
}

// ── self-test ───────────────────────────────────────────────────────────────
//
// Builds a throwaway workspace in $TMPDIR per case, so every direction is pinned
// against a real walk of a real tree rather than against a stubbed one. The
// three legs the landing card names are rows here: a tier file in a package that
// reads the switch (green), one in a package that does not (red, naming the
// package AND the file), and NO tier files at all (green, printing the zero).
//
// The `.live.` rows carry a caveat that belongs in the file and not only in a
// pull request: NO `*.live.test.*` file exists anywhere in this tree, so that
// arm's only corpus is the fixtures below. They exercise the judging path; they
// cannot tell you the arm has ever met a real file.

const SELF_TEST_VERDICT = 'check-tier-file-adoption self-test reached its verdict';

function buildWorkspace(caseDir, packages) {
  mkdirSync(join(caseDir, 'packages'), { recursive: true });
  writeFileSync(join(caseDir, WORKSPACE_FILE), 'packages:\n  - packages/*\n');
  // The reader module the fixture configs import, at the same repo-relative
  // position the real one occupies, so `resolveRelative` answers as it does in
  // the tree.
  mkdirSync(join(caseDir, dirname(READER_MODULE)), { recursive: true });
  writeFileSync(join(caseDir, READER_MODULE), 'export function readTierMode() { return "queue"; }\n'
    + 'export function selectTierFiles(f) { return f; }\n'
    + 'export function isNightlyTierFile() { return false; }\n');
  for (const [name, files] of Object.entries(packages)) {
    const dir = join(caseDir, 'packages', name);
    mkdirSync(dir, { recursive: true });
    if (!('package.json' in files)) {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@fixture/${name}` }));
    }
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), content);
    }
  }
}

const READS_DIRECTLY = `import { readTierMode, selectTierFiles } from '../../${READER_MODULE}';
export default { test: { include: selectTierFiles(['a'], readTierMode()) } };
`;

const READS_VIA_LOCAL = `import { files } from './vitest-tiers.js';
export default { test: { include: files } };
`;

const LOCAL_TIER_MODULE = `import { readTierMode, selectTierFiles } from '../../${READER_MODULE}';
export const files = selectTierFiles(['a'], readTierMode());
`;

const BLIND_CONFIG = `export default { test: { include: ['**/*.test.ts'] } };\n`;

function selfTest() {
  let failures = 0;
  const seen = new Set();
  const root = mkdtempSync(join(tmpdir(), 'tier-adoption-selftest-'));

  const fail = (message) => {
    failures += 1;
    console.error(`  ✗ ${message}`);
  };

  const cases = [
    {
      name: 'LEG 1 — a tier file in a package that READS the switch is green',
      packages: {
        alpha: { 'vitest.config.ts': READS_DIRECTLY, 'src/a.e2e.test.ts': '' },
      },
      expect: (r) => {
        if (r.findings.length !== 0) return `expected no findings, got ${r.findings.length}`;
        if (r.tierFileCount !== 1) return `expected 1 tier file, counted ${r.tierFileCount}`;
        if (r.honouring.length !== 1) return `expected 1 honouring package, got ${r.honouring.length}`;
        return null;
      },
    },
    {
      name: 'LEG 1b — the packages/cli shape: the read is TRANSITIVE, through a local module',
      packages: {
        alpha: {
          'vitest.config.ts': `// this config mentions ${TIER_ENV} only in prose\n${READS_VIA_LOCAL}`,
          'vitest-tiers.ts': LOCAL_TIER_MODULE,
          'src/a.e2e.test.ts': '',
        },
      },
      expect: (r) => (r.findings.length === 0 ? null : `expected green, got: ${r.findings[0]}`),
    },
    {
      name: 'LEG 2 — a tier file in a package that does NOT read the switch is RED, naming both',
      packages: {
        beta: { 'vitest.config.ts': BLIND_CONFIG, 'test/b.e2e.test.ts': '' },
      },
      expect: (r) => {
        if (r.findings.length !== 1) return `expected 1 finding, got ${r.findings.length}`;
        const f = r.findings[0];
        if (!f.includes('@fixture/beta')) return 'the finding does not name the package';
        if (!f.includes('test/b.e2e.test.ts')) return 'the finding does not name the file';
        return null;
      },
    },
    {
      name: 'LEG 2b — a tier file in a package with NO vitest config at all is RED',
      packages: { beta: { 'test/b.e2e.test.ts': '' } },
      expect: (r) => {
        if (r.findings.length !== 1) return `expected 1 finding, got ${r.findings.length}`;
        if (!r.findings[0].includes('test/b.e2e.test.ts')) return 'the finding does not name the file';
        return null;
      },
    },
    {
      name: 'LEG 3 — NO tier files on disk at all is green AND the zero is printed',
      packages: {
        gamma: { 'vitest.config.ts': BLIND_CONFIG, 'src/plain.test.ts': '', 'src/live-mysql.test.ts': '' },
      },
      expect: (r) => {
        if (r.findings.length !== 0) return `expected no findings, got ${r.findings.length}`;
        if (r.tierFileCount !== 0) return `expected 0 tier files, counted ${r.tierFileCount}`;
        if (r.owners.length !== 0) return `expected 0 owning packages, got ${r.owners.length}`;
        if (r.packagesWalked === 0) return 'the walk found no packages — that is exit 2, not a green';
        const line = tierCountLine(r.tierFileCount, r.perTier);
        if (!/\b0\b/.test(line)) return `the printed line carries no zero: ${line}`;
        for (const tier of NIGHTLY_TIERS) {
          if (!line.includes(`0 ${tier}`)) return `the printed line does not report the ${tier} zero: ${line}`;
        }
        return null;
      },
    },
    {
      name: 'REVERSE CONTROL — a substring "live" file is NOT a tier file (leg 3 is not vacuous)',
      packages: {
        gamma: { 'vitest.config.ts': BLIND_CONFIG, 'src/live-dialect-matrix.test.ts': '' },
      },
      expect: (r) => (r.tierFileCount === 0 ? null : `expected 0 tier files, counted ${r.tierFileCount}`),
    },
    {
      name: 'the .live. tier is judged exactly as .e2e. is (FIXTURE-ONLY corpus — see the header)',
      packages: {
        delta: { 'vitest.config.ts': BLIND_CONFIG, 'src/d.live.test.ts': '' },
      },
      expect: (r) => {
        if (r.findings.length !== 1) return `expected 1 finding, got ${r.findings.length}`;
        if (r.perTier.live !== 1) return `expected 1 live tier file, counted ${r.perTier.live}`;
        if (!r.findings[0].includes('src/d.live.test.ts')) return 'the finding does not name the file';
        return null;
      },
    },
    {
      name: 'POSITIVE CONTROL — prose naming the switch does NOT satisfy the check',
      packages: {
        beta: {
          'vitest.config.ts': `// We deliberately do not read ${TIER_ENV} here.\n${BLIND_CONFIG}`,
          'src/b.e2e.test.ts': '',
        },
      },
      expect: (r) => (r.findings.length === 1 ? null : `expected 1 finding, got ${r.findings.length}`),
    },
    {
      name: 'POSITIVE CONTROL — a type-only import of the reader reads nothing at runtime',
      packages: {
        beta: {
          'vitest.config.ts': `import type { readTierMode } from '../../${READER_MODULE}';\n${BLIND_CONFIG}`,
          'src/b.e2e.test.ts': '',
        },
      },
      expect: (r) => (r.findings.length === 1 ? null : `expected 1 finding, got ${r.findings.length}`),
    },
    {
      name: 'POSITIVE CONTROL — importing only the filename predicate is not a switch read',
      packages: {
        beta: {
          'vitest.config.ts': `import { isNightlyTierFile } from '../../${READER_MODULE}';\n`
            + `export default { test: { include: [isNightlyTierFile] } };\n`,
          'src/b.e2e.test.ts': '',
        },
      },
      expect: (r) => (r.findings.length === 1 ? null : `expected 1 finding, got ${r.findings.length}`),
    },
    {
      name: 'a config naming the variable DIRECTLY in a code position is green',
      packages: {
        alpha: {
          'vitest.config.ts': `const mode = process.env.${TIER_ENV} ?? 'queue';\n`
            + `export default { test: { include: mode === 'nightly' ? ['**/*.e2e.test.ts'] : [] } };\n`,
          'src/a.e2e.test.ts': '',
        },
      },
      expect: (r) => (r.findings.length === 0 ? null : `expected green, got: ${r.findings[0]}`),
    },
    {
      name: 'a package that owns NO tier file is never judged, however blind its config',
      packages: {
        alpha: { 'vitest.config.ts': READS_DIRECTLY, 'src/a.e2e.test.ts': '' },
        gamma: { 'vitest.config.ts': BLIND_CONFIG, 'src/plain.test.ts': '' },
      },
      expect: (r) => {
        if (r.findings.length !== 0) return `expected no findings, got ${r.findings.length}`;
        if (r.packagesWalked !== 2) return `expected 2 packages walked, got ${r.packagesWalked}`;
        return null;
      },
    },
  ];

  let index = 0;
  for (const testCase of cases) {
    index += 1;
    seen.add(testCase.name);
    const caseDir = join(root, `case-${index}`);
    mkdirSync(caseDir, { recursive: true });
    buildWorkspace(caseDir, testCase.packages);
    let problem;
    try {
      problem = testCase.expect(scan(caseDir));
    } catch (error) {
      problem = `threw: ${error.message}`;
    }
    if (problem === null || problem === undefined) console.log(`  ✓ ${testCase.name}`);
    else fail(`${testCase.name}: ${problem}`);
  }

  // ── The pure judge, without a filesystem ──────────────────────────────────
  const pure = [
    ['a value import of a reading export', `import { readTierMode } from 'R';`, ['R'], true],
    ['a type-only import', `import type { readTierMode } from 'R';`, ['R'], false],
    ['an inline type specifier', `import { type readTierMode } from 'R';`, ['R'], false],
    ['a renamed value import', `import { readTierMode as m } from 'R';`, ['R'], true],
    ['a namespace import that names a reading export', `import * as t from 'R';\nt.readTierMode();`, ['R'], true],
    ['a namespace import that names nothing', `import * as t from 'R';\nt.isNightlyTierFile();`, ['R'], false],
    ['an import from an unrelated module', `import { readTierMode } from 'OTHER';`, ['R'], false],
    ['the variable in a code position', `const m = process.env.${TIER_ENV};`, [], true],
  ];
  for (const [label, source, readerSpecs, expected] of pure) {
    seen.add(label);
    const got = switchReadReason(source, readerSpecs) !== null;
    if (got === expected) console.log(`  ✓ pure judge: ${label}`);
    else fail(`pure judge: ${label} — expected ${expected}, got ${got}`);
  }

  // ── The declared population must reach the REAL tree ──────────────────────
  //
  // A wrong hint runs perfectly green in production and shows up only as a dev
  // who was never told this gate reads their surface.
  for (const declared of [WORKSPACE_FILE, READER_MODULE]) {
    seen.add(`population: ${declared}`);
    if (existsSync(join(REPO_ROOT, declared))) console.log(`  ✓ population reaches the tree: ${declared}`);
    else fail(`the declared population must reach the tree: ${declared}`);
  }
  for (const hint of ROOT_DIR_WATCH_HINTS) {
    seen.add(`hint: ${hint}`);
    if (!hint.includes('/')) {
      fail(`ROOT_DIR_WATCH_HINTS entry '${hint}' is a bare single-segment literal, which builds no `
        + 'hint at all — spell it with a separator');
      continue;
    }
    const dir = hint.replace(/\/\*+$/, '');
    if (existsSync(join(REPO_ROOT, dir))) console.log(`  ✓ hint reaches the tree: ${hint}`);
    else fail(`ROOT_DIR_WATCH_HINTS declares '${hint}', which reaches nothing in the tree`);
  }
  try {
    const roots = ROOT_DIR_WATCH_HINTS.map((h) => h.replace(/\/\*+$/, ''));
    const uncovered = workspacePackageDirs(REPO_ROOT)
      .filter((d) => !roots.some((r) => d === r || d.startsWith(`${r}/`)));
    seen.add('hints cover the walk');
    if (uncovered.length === 0) console.log('  ✓ ROOT_DIR_WATCH_HINTS covers every workspace package walked');
    else fail(`ROOT_DIR_WATCH_HINTS does not cover ${uncovered.length} workspace package(s) this gate `
      + `reads, e.g. ${uncovered[0]} — the declaration has drifted from the walk`);
  } catch (error) {
    fail(`the workspace walk this gate declares could not be expanded: ${error.message}`);
  }

  // ── The real tree: the walk must find packages, and the census is printed ──
  //
  // Not an anti-vacuity floor on the SELECTION — zero tier files is a legitimate
  // state of this tree and the header says so. What is floored is the WALK.
  try {
    const live = scan(REPO_ROOT);
    seen.add('real-tree walk');
    if (live.packagesWalked > 0) {
      console.log(`  ✓ real tree: ${live.packagesWalked} package(s) walked, `
        + `${tierCountLine(live.tierFileCount, live.perTier)}, ${live.owners.length} owning package(s)`);
    } else {
      fail('the real-tree walk found ZERO workspace packages — the enumeration broke');
    }
    seen.add('real-tree live-tier corpus reading');
    console.log(`  ✓ real tree: the ${TIER_ENV} live-tier corpus is ${live.perTier.live} file(s)`
      + `${live.perTier.live === 0 ? ' — that arm is covered by FIXTURES ONLY' : ''}`);
  } catch (error) {
    fail(`the real-tree scan threw: ${error.message}`);
  }

  rmSync(root, { recursive: true, force: true });

  if (seen.size < cases.length + pure.length) {
    fail(`only ${seen.size} distinct case labels registered for ${cases.length + pure.length} declared `
      + 'rows — a case stopped running, or two rows share a label.');
  }

  if (failures > 0) process.exit(1);
  console.log(`self-test OK: ${cases.length} fixture-workspace cases + ${pure.length} pure-judge cases `
    + '+ population declaration + real-tree walk floor.');
  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-tier-file-adoption self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else main();
}
