#!/usr/bin/env node
// Map a set of `packages/**` code changes to the hand-written docs that reference
// the affected packages, so a doc-accuracy audit can be scoped to what actually
// changed instead of re-auditing every hand-written doc (178 of them today) each time.
//
// Usage:
//   node scripts/docs-audit/affected-docs.mjs [sinceRef]   # docs affected by changes since <sinceRef> (default origin/main)
//   node scripts/docs-audit/affected-docs.mjs --all         # every hand-written doc (full audit)
//   node scripts/docs-audit/affected-docs.mjs --json [...]   # emit JSON {docs, changedPackages, ...} instead of a path list
//   node scripts/docs-audit/affected-docs.mjs --self-test    # pin the change classifiers + package-root derivation (no repo state needed)
//
// Scope: hand-written docs only = content/docs/**/*.mdx MINUS content/docs/references/**
// (references are generated from packages/spec and handled by a separate regenerate pass).
//
// Heuristic: a doc is "affected" by a changed package P if the doc text mentions P's
// npm name (`@objectstack/<x>`) or its repo path (the package's directory, e.g.
// `packages/services/service-automation`). Over-inclusion is intentionally preferred
// over misses; the periodic FULL audit is the backstop for docs that describe a
// package without naming it.
//
// Two exclusions, though — change classes that cannot make an implementation-accuracy
// doc stale, dropped before the changed package roots are derived (everything else
// stays deliberately over-inclusive):
//   - TEST files: tests do not define behaviour — they observe it. Counting them made
//     every tests-only PR light up its packages' whole doc set (three in a row on
//     #4064 / #4078 / one before), a class of finding that is always false. A reader
//     who learns the comment is usually noise stops reading it, and then it fails to
//     do its job on the PR where it is right.
//   - TOOLING scripts (`<packageRoot>/scripts/**`): build/verification tooling, not
//     the runtime behaviour docs describe (#4183 flagged 106 docs for a diff whose
//     only code change was a new check script). `package.json` itself stays counted —
//     exports/deps changes ARE implementation.

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const all = args.includes('--all');
const sinceRef = args.find((a) => !a.startsWith('--')) || 'origin/main';

// Short-circuit before any git work — the self-test needs no repo state.
if (args.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

function sh(cmd) {
  return execSync(cmd, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}

// --- 1. enumerate hand-written docs ----------------------------------------
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.mdx')) out.push(p);
  }
  return out;
}
const docsRoot = join(repoRoot, 'content/docs');
const refsRoot = join(repoRoot, 'content/docs/references');
const handwritten = walk(docsRoot)
  .filter((p) => !p.startsWith(refsRoot))
  .map((p) => relative(repoRoot, p))
  .sort();

if (all) {
  emit(handwritten, [], 'all hand-written docs');
  process.exit(0);
}

// --- 2. changed package roots since <sinceRef> -----------------------------
let changedFiles = [];
try {
  // three-dot: changes on HEAD since the merge-base with sinceRef
  changedFiles = sh(`git diff --name-only ${sinceRef}...HEAD -- packages/`).split('\n').filter(Boolean);
} catch {
  // fall back to two-dot (e.g. detached/ranges that lack a merge-base)
  changedFiles = sh(`git diff --name-only ${sinceRef} -- packages/`).split('\n').filter(Boolean);
}

/**
 * A test file — it observes behaviour rather than defining it, so changing one cannot
 * make an implementation-accuracy doc stale. Covers the repo's conventions: `*.test.*`
 * / `*.spec.*` at any depth (including `.integration.test.ts` and `.conformance.test.ts`)
 * plus anything under a `__tests__` / `__mocks__` / `__fixtures__` directory.
 *
 * Verify with `--self-test`.
 */
function isTestFile(path) {
  return /(^|\/)__(tests|mocks|fixtures)__\//.test(path)
    || /(^|\/)[^/]+\.(test|spec)\.[^/]+$/.test(path);
}

/**
 * The package root that owns a changed path: the DEEPEST ancestor directory with a
 * package.json. Derived from the filesystem, not from a hand-kept list of container
 * directories — the old regex special-cased `packages/plugins/*` only, so the other
 * six containers (services/, connectors/, apps/, qa/, triggers/, adapters/) collapsed
 * to the container dir, which has no package.json, so `name` stayed null and the
 * npm-name matching arm never fired for those 30 nested packages (#4162 — a doc that
 * says `@objectstack/service-automation` but never the path was a guaranteed miss).
 * A hardcoded list would fail the same way again on container dir number eight
 * (#3786's pattern), so: filesystem.
 *
 * A path with no package.json anywhere up it (a deleted package) falls back to the
 * top-level `packages/<x>` segment: the npm name is unresolvable either way, and the
 * coarse path token still substring-matches every doc that mentions the deleted
 * package's path.
 *
 * `hasPackageJson` is injectable so `--self-test` can pin this with no repo state.
 */
function packageRootOf(file, hasPackageJson = dirHasPackageJson) {
  const segs = file.split('/');
  if (segs[0] !== 'packages' || segs.length < 3) return null; // not a file inside a package
  for (let depth = segs.length - 1; depth >= 2; depth--) {
    const dir = segs.slice(0, depth).join('/');
    if (hasPackageJson(dir)) return dir;
  }
  return segs.slice(0, 2).join('/');
}

function dirHasPackageJson(dir) {
  return existsSync(join(repoRoot, dir, 'package.json'));
}

/**
 * A tooling script — `<packageRoot>/scripts/**` holds build/verification tooling
 * (generators, check scripts, i18n-extract configs), not the runtime behaviour docs
 * describe, so changing one cannot make an implementation-accuracy doc stale. Same
 * reasoning as the test-file exclusion, same measured symptom (#4183: a new check
 * script plus its package.json registration, zero `src/` changes, 106 docs flagged).
 * Deliberately narrow:
 *   - only `scripts/` directly under the package root — `src/scripts/**` is runtime
 *     code and stays counted;
 *   - `package.json` is NOT excluded: exports/main/deps changes are implementation;
 *   - generator output that docs do consume lands in `content/docs/references/**`,
 *     which this tool already scopes out.
 * Publication check (the one way this could hide runtime code): no package's `files`
 * allowlist ships `scripts/`; three plugins ship it only incidentally (no `files`
 * field at all) and it holds a lone `i18n-extract.config.ts` — tooling, not runtime.
 */
function isToolingScript(file, hasPackageJson = dirHasPackageJson) {
  const root = packageRootOf(file, hasPackageJson);
  return root !== null && file.startsWith(`${root}/scripts/`);
}

/**
 * Pin the change classifiers and the package-root derivation against known-good and
 * known-bad paths. The two ways this tool turns into a miss: an exclusion silently
 * widens into dropping real implementation changes, or the root derivation collapses
 * a nested package into its container again (#4162 — the guard's own guard had a
 * hole: the original self-test pinned only `isTestFile`). Needs no repo state: the
 * filesystem lookup is injected as a fake tree.
 */
function selfTest() {
  let failed = 0;
  let total = 0;
  const check = (fn, label, path, want, got) => {
    total++;
    if (got !== want) {
      console.error(`  ✗ self-test "${label}": ${path} → expected ${fn}=${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
      failed++;
    }
  };

  const testFileCases = [
    // [path, isTest, label]
    ['packages/services/service-automation/src/builtin/config-schemas.test.ts', true, 'plain .test.ts'],
    ['packages/rest/src/package-envelope.conformance.test.ts', true, 'compound .conformance.test.ts'],
    ['packages/services/service-automation/src/runas-grant-resolution.integration.test.ts', true, '.integration.test.ts'],
    ['packages/spec/src/data/object.spec.ts', true, '.spec.ts'],
    ['packages/foo/src/__tests__/helper.ts', true, 'helper inside __tests__'],
    ['packages/foo/src/__mocks__/driver.ts', true, '__mocks__'],
    ['packages/foo/src/__fixtures__/stack.json', true, '__fixtures__'],

    ['packages/services/service-automation/src/engine.ts', false, 'implementation'],
    ['packages/spec/src/automation/control-flow.zod.ts', false, 'a zod schema'],
    ['packages/formula/src/validate.ts', false, 'implementation with a test-ish name'],
    ['packages/cli/src/commands/test.ts', false, 'a command NAMED test is not a test file'],
    ['packages/qa/src/testing.ts', false, 'testing.ts is implementation'],
    ['packages/spec/src/latest.ts', false, 'no false positive on a bare name'],
    ['packages/foo/src/tests-helper.ts', false, 'tests-helper is not __tests__'],
  ];
  for (const [path, want, label] of testFileCases) check('isTestFile', label, path, want, isTestFile(path));

  // Package-root derivation, against a fake tree so the self-test stays hermetic.
  // One package.json per shape the repo has: a direct child package plus a nested
  // package per container class. The containers themselves have NO package.json.
  const fakeTree = new Set([
    'packages/spec',
    'packages/services/service-automation',
    'packages/plugins/plugin-audit',
    'packages/connectors/connector-slack',
  ]);
  const inFakeTree = (dir) => fakeTree.has(dir);
  const liveRootCases = [
    // [path, expected package root, label]
    ['packages/spec/src/latest.ts', 'packages/spec', 'direct child package'],
    ['packages/spec/package.json', 'packages/spec', 'the package.json itself'],
    ['packages/services/service-automation/src/engine.ts', 'packages/services/service-automation', 'nested under services/ — NOT the container'],
    ['packages/plugins/plugin-audit/src/index.ts', 'packages/plugins/plugin-audit', 'nested under plugins/ (formerly the only special case)'],
    ['packages/connectors/connector-slack/src/client.ts', 'packages/connectors/connector-slack', 'nested under connectors/'],
  ];
  for (const [path, want, label] of liveRootCases) check('packageRootOf', label, path, want, packageRootOf(path, inFakeTree));

  // The invariant behind the whole fix: a container directory (a parent of nested
  // packages, itself without a package.json) must never come out as a package root
  // for a file that lives inside one of its packages.
  const containers = new Set(
    [...fakeTree].map((d) => d.split('/').slice(0, -1).join('/')).filter((d) => d !== 'packages'),
  );
  for (const [path] of liveRootCases) {
    check('containerIsRoot', 'a container dir is never a live package\'s root', path, false, containers.has(packageRootOf(path, inFakeTree)));
  }

  // Deliberate fallbacks, pinned so they don't silently change: a path whose
  // package.json is gone (deleted package) degrades to the coarse top-level token —
  // over-inclusive substring matching still catches docs naming the deleted path.
  const fallbackRootCases = [
    ['packages/gone/src/x.ts', 'packages/gone', 'deleted top-level package falls back to packages/<x>'],
    ['packages/services/service-gone/src/x.ts', 'packages/services', 'deleted nested package falls back to the coarse container token'],
    ['packages/README.md', null, 'a file directly under packages/ belongs to no package'],
  ];
  for (const [path, want, label] of fallbackRootCases) check('packageRootOf', label, path, want, packageRootOf(path, inFakeTree));

  // Tooling-script exclusion: `<packageRoot>/scripts/**` is build tooling; the
  // package.json next to it and anything under `src/` are implementation.
  const scriptCases = [
    // [path, isToolingScript, label]
    ['packages/spec/scripts/check-generated.ts', true, 'package check script (#4183)'],
    ['packages/plugins/plugin-audit/scripts/i18n-extract.config.ts', true, 'nested package tooling config'],
    ['packages/spec/package.json', false, 'package.json IS implementation (exports/deps)'],
    ['packages/spec/src/scripts/runner.ts', false, 'src/scripts/** is runtime code'],
    ['packages/services/service-automation/src/engine.ts', false, 'implementation'],
  ];
  for (const [path, want, label] of scriptCases) check('isToolingScript', label, path, want, isToolingScript(path, inFakeTree));

  if (failed) {
    console.error(`\n✗ affected-docs self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`✓ affected-docs self-test: ${total} cases pass.`);
}


// collect package roots from the implementation changes
const testFilesSkipped = changedFiles.filter((f) => isTestFile(f)).length;
const scriptFilesSkipped = changedFiles.filter((f) => !isTestFile(f) && isToolingScript(f)).length;
const implementationChanges = changedFiles.filter((f) => !isTestFile(f) && !isToolingScript(f));
const pkgRoots = new Set();
for (const f of implementationChanges) {
  const root = packageRootOf(f);
  if (root) pkgRoots.add(root);
}

// resolve each root to its npm name + keep the path token
const changedPackages = []; // {dir, name}
for (const dir of pkgRoots) {
  let name = null;
  const pj = join(repoRoot, dir, 'package.json');
  if (existsSync(pj)) {
    try { name = JSON.parse(readFileSync(pj, 'utf8')).name || null; } catch { /* ignore */ }
  }
  changedPackages.push({ dir, name });
}

// --- 3. match docs that mention an affected package ------------------------
const affected = [];
for (const doc of handwritten) {
  const text = readFileSync(join(repoRoot, doc), 'utf8');
  const hits = [];
  for (const { dir, name } of changedPackages) {
    if (name && text.includes(name)) hits.push(name);
    else if (text.includes(dir)) hits.push(dir);
  }
  if (hits.length) affected.push({ doc, via: [...new Set(hits)] });
}

// Report what was excluded rather than dropping it silently — a tool that quietly
// narrows its own scope reads as "nothing to see here" when it means "I did not look".
const skipNotes = [];
if (testFilesSkipped > 0) skipNotes.push(`${testFilesSkipped} test file(s) excluded — tests cannot make an implementation doc stale`);
if (scriptFilesSkipped > 0) skipNotes.push(`${scriptFilesSkipped} tooling script(s) excluded — a package's scripts/ dir is build tooling, not documented behaviour`);
const skipNote = skipNotes.length ? ` (${skipNotes.join('; ')})` : '';

emit(
  affected.map((a) => a.doc),
  changedPackages,
  `${affected.length} docs affected by ${changedPackages.length} changed package(s) since ${sinceRef}${skipNote}`,
  affected,
  testFilesSkipped,
  scriptFilesSkipped,
);

function emit(docList, changedPackages, summary, detail, testFilesSkipped = 0, scriptFilesSkipped = 0) {
  if (asJson) {
    process.stdout.write(JSON.stringify({ summary, sinceRef: all ? null : sinceRef, changedPackages, docs: docList, detail: detail || null, testFilesSkipped, scriptFilesSkipped }, null, 2) + '\n');
  } else {
    process.stderr.write(`# ${summary}\n`);
    process.stdout.write(docList.join('\n') + (docList.length ? '\n' : ''));
  }
}
