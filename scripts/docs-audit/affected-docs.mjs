#!/usr/bin/env node
// Map a set of `packages/**` code changes to the hand-written docs that reference
// the affected packages, so a doc-accuracy audit can be scoped to what actually
// changed instead of re-auditing all 128 hand-written docs every time.
//
// Usage:
//   node scripts/docs-audit/affected-docs.mjs [sinceRef]   # docs affected by changes since <sinceRef> (default origin/main)
//   node scripts/docs-audit/affected-docs.mjs --all         # every hand-written doc (full audit)
//   node scripts/docs-audit/affected-docs.mjs --json [...]   # emit JSON {docs, changedPackages, ...} instead of a path list
//   node scripts/docs-audit/affected-docs.mjs --self-test    # check the test-file matcher (no repo state needed)
//
// Scope: hand-written docs only = content/docs/**/*.mdx MINUS content/docs/references/**
// (references are generated from packages/spec and handled by a separate regenerate pass).
//
// Heuristic: a doc is "affected" by a changed package P if the doc text mentions P's
// npm name (`@objectstack/<x>`) or its repo path (`packages/<x>`). Over-inclusion is
// intentionally preferred over misses; the periodic FULL audit is the backstop for
// docs that describe a package without naming it.
//
// One exclusion, though: a change to a TEST file cannot make an implementation-accuracy
// doc stale, because tests do not define behaviour — they observe it. Counting them made
// every tests-only PR light up its packages' whole doc set (three in a row on #4064 /
// #4078 / one before), which is a class of finding that is always false. A reader who
// learns the comment is usually noise stops reading it, and then it fails to do its job
// on the PR where it is right. So test files are dropped before deriving the changed
// package roots; everything else stays deliberately over-inclusive.

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
 * Check the test-file matcher against known-good and known-bad paths, so the
 * exclusion cannot silently widen into dropping real implementation changes — the
 * one way this optimisation could turn into a miss.
 */
function selfTest() {
  const cases = [
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
  let failed = 0;
  for (const [path, want, label] of cases) {
    const got = isTestFile(path);
    if (got !== want) {
      console.error(`  ✗ self-test "${label}": ${path} → expected isTestFile=${want}, got ${got}`);
      failed++;
    }
  }
  if (failed) {
    console.error(`\n✗ affected-docs self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`✓ affected-docs self-test: ${cases.length} cases pass.`);
}


// collect package roots: packages/<x> and packages/plugins/<x>
const pkgRoots = new Set();
const implementationChanges = changedFiles.filter((f) => !isTestFile(f));
for (const f of implementationChanges) {
  let m = f.match(/^(packages\/plugins\/[^/]+)\//) || f.match(/^(packages\/[^/]+)\//);
  if (m) pkgRoots.add(m[1]);
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
const testFilesSkipped = changedFiles.length - implementationChanges.length;
const skipNote = testFilesSkipped > 0
  ? ` (${testFilesSkipped} test file(s) excluded — tests cannot make an implementation doc stale)`
  : '';

emit(
  affected.map((a) => a.doc),
  changedPackages,
  `${affected.length} docs affected by ${changedPackages.length} changed package(s) since ${sinceRef}${skipNote}`,
  affected,
  testFilesSkipped,
);

function emit(docList, changedPackages, summary, detail, testFilesSkipped = 0) {
  if (asJson) {
    process.stdout.write(JSON.stringify({ summary, sinceRef: all ? null : sinceRef, changedPackages, docs: docList, detail: detail || null, testFilesSkipped }, null, 2) + '\n');
  } else {
    process.stderr.write(`# ${summary}\n`);
    process.stdout.write(docList.join('\n') + (docList.length ? '\n' : ''));
  }
}
