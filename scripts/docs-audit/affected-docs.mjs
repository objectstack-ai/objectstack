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
// Three exclusions, though — change classes that cannot make an implementation-accuracy
// doc stale, dropped before the changed package roots are derived (everything else
// stays deliberately over-inclusive):
//   - TEST files: tests do not define behaviour — they observe it. Counting them made
//     every tests-only PR light up its packages' whole doc set (three in a row on
//     #4064 / #4078 / one before), a class of finding that is always false. A reader
//     who learns the comment is usually noise stops reading it, and then it fails to
//     do its job on the PR where it is right.
//   - TOOLING scripts (`<packageRoot>/scripts/**`): build/verification tooling, not
//     the runtime behaviour docs describe (#4183 flagged 106 docs for a diff whose
//     only code change was a new check script).
//   - DEV-ONLY manifest edits (#6893): a `<packageRoot>/package.json` whose changed
//     TOP-LEVEL KEYS are all dev-time (`scripts`, `devDependencies`). The package.json
//     as a whole stays counted — `exports`/`main`/`dependencies` changes ARE
//     implementation — so this is a field-level, not a file-level, exclusion.
//
//     This is the residue of the #4183 fix: that one excluded the check *script* but
//     kept the `package.json` line that registers it, so the same PR still lit up the
//     same doc set through the manifest. Measured over 400 merged commits, FIVE had a
//     package.json as their only `packages/**` implementation change, and all five
//     touched nothing but those two keys — together flagging 152 doc-rows, none of
//     which could be stale:
//       df0605ba5 `scripts`          → 12 docs   (@objectstack/rest turbo wiring)
//       2672f855f `scripts`          → 113 docs  (@objectstack/spec build line; #6893's headline)
//       a64315556 `devDependencies`  → 10 docs   (a test migrated to sqlite)
//       77d9001c7 `devDependencies`  → 13 docs   (a test's engine shape)
//       466bd9285 `devDependencies`  → 4 docs    (test-only, two packages)
//     The last three are test-only commits, i.e. exactly the class the TEST exclusion
//     above exists to kill — leaking through the manifest instead.
//
//     Why this cannot narrow the net: the classifier is per FILE. If a PR also touches
//     that package's `src/**`, those files add the package root on their own, so this
//     branch only ever decides the case where the manifest is the package's ONLY change.
//     Unparseable, added or deleted manifests fall back to "counted".
//
// And one FORK, which is not an exclusion (#6893, following the #4920 ruling):
// `content/docs/releases/**` pages stay in `docs` — they are audited, read-only — but
// are reported separately so a reader is told to file an issue rather than edit them.
// See the RELEASE_OWNED_PREFIX block below.

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const all = args.includes('--all');
const sinceRef = args.find((a) => !a.startsWith('--')) || 'origin/main';

// --- 0. classifier constants -------------------------------------------------
// Declared up here, ahead of the `--self-test` short-circuit below, because `const` is
// not hoisted: the self-test exercises the classifiers that read these, so leaving them
// down beside their functions makes `--self-test` die in the temporal dead zone. The
// functions themselves can stay where they read best — those ARE hoisted.

/**
 * Release-owned pages — AGENTS.md's Documentation Guardrails forbid a code PR from
 * editing anything under this prefix, and `.claude/workflows/docs-accuracy-audit.js`
 * routes the same prefix down a read-only channel (#4920).
 *
 * This is the THIRD literal copy of that path (AGENTS.md's guardrail row, the
 * workflow's own const, and this one). Three copies is deliberate, not sloppiness:
 * the workflow is evaluated in a sandbox VM and cannot import, so a shared module
 * would leave its copy the only unanchored one — the worst of both. Instead
 * `scripts/docs-audit/check-audit-scope.mjs` anchors ALL of them to the guardrail row
 * and goes red the moment one drifts, which is the same discipline #4851 billed us for.
 *
 * NOTE this is a REPORTING fork, never an exclusion. Release pages stay in `docs`, so
 * the audit scoping command still returns them and they keep getting audited. #4920
 * considered excluding them and REJECTED it: the most-read pages in the docs would go
 * permanently unaudited and silently, and a second definition of "docs this tooling
 * covers" would grow next to the generated block. What forks is the DELIVERABLE — the
 * drift comment tells the reader to file an issue instead of editing (#6893: a comment
 * listing `content/docs/releases/v17.mdx` next to editable pages steers a dev who
 * treats the list as a worklist straight into the one edit the repo forbids).
 */
const RELEASE_OWNED_PREFIX = 'content/docs/releases/';
const isReleaseOwned = (doc) => doc.startsWith(RELEASE_OWNED_PREFIX);

/**
 * The `package.json` top-level keys that are DEV-TIME ONLY — a change confined to them
 * cannot alter the runtime behaviour a doc describes, so it cannot make one stale.
 *
 * Deliberately tiny, and deliberately an allowlist rather than a denylist: an unknown
 * or newly-invented key must fall on the "counted" side. `dependencies`,
 * `peerDependencies`, `exports`, `main`, `module`, `types`, `bin`, `files`, `engines`
 * and everything else are all implementation or publication surface and stay counted.
 *
 * Both entries have measured pull (#6893, 400 commits): `scripts` twice,
 * `devDependencies` three times — see the header table.
 */
const DEV_ONLY_PACKAGE_JSON_KEYS = new Set(['scripts', 'devDependencies']);

// Short-circuit before any git or filesystem work — the self-test needs no repo state.
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
let threeDot = true;
try {
  // three-dot: changes on HEAD since the merge-base with sinceRef
  changedFiles = sh(`git diff --name-only ${sinceRef}...HEAD -- packages/`).split('\n').filter(Boolean);
} catch {
  // fall back to two-dot (e.g. detached/ranges that lack a merge-base)
  threeDot = false;
  changedFiles = sh(`git diff --name-only ${sinceRef} -- packages/`).split('\n').filter(Boolean);
}

// The ref the diff is actually measured FROM — needed to read a file's "before" side
// when a change class is decided by content rather than by path (the dev-only manifest
// rule below). Kept in lockstep with the diff above: three-dot measures from the
// merge-base, two-dot from sinceRef itself. A failing merge-base does NOT re-run the
// diff — that would silently change which files are considered.
let baseRef = sinceRef;
if (threeDot) {
  try { baseRef = sh(`git merge-base ${sinceRef} HEAD`).trim() || sinceRef; } catch { /* keep sinceRef */ }
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
 * The top-level keys whose values differ between two package.json texts, or `null` if
 * either side cannot be parsed as a JSON object.
 *
 * `null` (not `[]`) for unparseable input, because the two mean opposite things to the
 * caller: "nothing changed" is safe to exclude, "I could not tell" must be counted.
 */
function changedManifestKeys(beforeText, afterText) {
  let before;
  let after;
  try {
    before = JSON.parse(beforeText);
    after = JSON.parse(afterText);
  } catch {
    return null;
  }
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(before) || !isObj(after)) return null;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
}

/**
 * Is this manifest diff confined to dev-time keys?
 *
 * An EMPTY changed-key set counts as dev-only: the file was touched but nothing
 * semantically changed (reformatting, key reordering), which by definition cannot make
 * a doc stale. An unparseable side is NOT dev-only — see `changedManifestKeys`.
 */
function isDevOnlyManifestDiff(beforeText, afterText) {
  const changed = changedManifestKeys(beforeText, afterText);
  if (changed === null) return false;
  return changed.every((k) => DEV_ONLY_PACKAGE_JSON_KEYS.has(k));
}

/**
 * A dev-only manifest edit: `<packageRoot>/package.json` whose changed top-level keys
 * are all in `DEV_ONLY_PACKAGE_JSON_KEYS` (#6893).
 *
 * Only the package root's OWN manifest qualifies — a `package.json` sitting anywhere
 * else under the package (a fixture, a nested asset) is not the package manifest and
 * stays counted. Added or deleted manifests stay counted too: a package appearing or
 * disappearing is as implementation as a change gets.
 *
 * `io` is injectable so `--self-test` can pin this with no repo state; live, it reads
 * the two sides out of git.
 */
function isDevOnlyManifestChange(file, io = liveManifestIo, hasPackageJson = dirHasPackageJson) {
  const root = packageRootOf(file, hasPackageJson);
  if (root === null || file !== `${root}/package.json`) return false;
  const beforeText = io.base(file);
  const afterText = io.head(file);
  if (beforeText === null || afterText === null) return false;
  return isDevOnlyManifestDiff(beforeText, afterText);
}

const liveManifestIo = {
  base: (file) => {
    try { return sh(`git show ${baseRef}:${file}`); } catch { return null; }
  },
  // HEAD, not the working tree: the diff above is measured against HEAD, so comparing
  // against a dirty worktree could exclude a file on the strength of an edit that is
  // not in the diff at all. Falls back to the worktree only if HEAD has no such path.
  head: (file) => {
    try { return sh(`git show HEAD:${file}`); } catch { /* fall through */ }
    try { return readFileSync(join(repoRoot, file), 'utf8'); } catch { return null; }
  },
};

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

  // Dev-only manifest exclusion (#6893). Field-level, so the cases are (before, after)
  // pairs rather than paths: the whole point is that the same FILE is excluded or
  // counted depending on which top-level keys moved.
  const pkg = (extra) => JSON.stringify({ name: '@objectstack/spec', version: '1.0.0', ...extra });
  const manifestCases = [
    // [beforeText, afterText, isDevOnly, label]
    [pkg({ scripts: { build: 'tsup' } }), pkg({ scripts: { build: 'tsup && node ../../scripts/check-dev-prereqs.mjs --stamp' } }), true, 'scripts only (#6892, the 113-doc specimen)'],
    [pkg({ devDependencies: { vitest: '^1' } }), pkg({ devDependencies: { vitest: '^1', 'better-sqlite3': '^11' } }), true, 'devDependencies only (a64315556)'],
    [pkg({ scripts: { a: '1' }, devDependencies: { x: '1' } }), pkg({ scripts: { a: '2' }, devDependencies: { x: '2' } }), true, 'both dev-time keys at once'],
    [pkg({ scripts: { build: 'tsup' } }), pkg({ scripts: { build: 'tsup' } }), true, 'nothing changed at all (reformat) is not drift'],

    [pkg({ dependencies: { zod: '^3' } }), pkg({ dependencies: { zod: '^4' } }), false, 'dependencies IS implementation'],
    [pkg({ peerDependencies: { react: '^18' } }), pkg({ peerDependencies: { react: '^19' } }), false, 'peerDependencies IS implementation'],
    [pkg({ exports: { '.': './dist/index.js' } }), pkg({ exports: { '.': './dist/index.js', './x': './dist/x.js' } }), false, 'a new export IS implementation'],
    [pkg({ files: ['dist'] }), pkg({ files: ['dist', 'spec-changes.json'] }), false, 'the published file list IS implementation'],
    [pkg({ scripts: { a: '1' }, dependencies: { zod: '^3' } }), pkg({ scripts: { a: '2' }, dependencies: { zod: '^4' } }), false, 'ONE non-dev key among dev ones still counts'],
    [pkg({}), JSON.stringify({ name: '@objectstack/spec', version: '2.0.0' }), false, 'a version bump IS implementation'],
    [pkg({ engines: { node: '>=20' } }), pkg({ engines: { node: '>=22' } }), false, 'engines is documented deployment surface'],
    // The fail-open half: "I could not tell" must never read as "nothing changed".
    ['{ not json', pkg({}), false, 'unparseable BEFORE falls back to counted'],
    [pkg({}), '{ not json', false, 'unparseable AFTER falls back to counted'],
    ['[]', pkg({}), false, 'a non-object manifest falls back to counted'],
  ];
  for (const [before, after, want, label] of manifestCases) {
    check('isDevOnlyManifestDiff', label, label, want, isDevOnlyManifestDiff(before, after));
  }

  // The path gate around it: only a package ROOT's own manifest is eligible, and an
  // added/deleted one is always counted. `io` returns a scripts-only diff for every
  // path, so any `false` here is the path gate talking, not the field comparison.
  const scriptsOnlyIo = {
    base: () => pkg({ scripts: { build: 'tsup' } }),
    head: () => pkg({ scripts: { build: 'rollup' } }),
  };
  const manifestPathCases = [
    // [path, io, isDevOnly, label]
    ['packages/spec/package.json', scriptsOnlyIo, true, 'the package root manifest'],
    ['packages/services/service-automation/package.json', scriptsOnlyIo, true, 'a nested package root manifest'],
    ['packages/spec/src/__fixtures__/app/package.json', scriptsOnlyIo, false, 'a fixture package.json is not the manifest'],
    ['packages/spec/src/index.ts', scriptsOnlyIo, false, 'not a package.json at all'],
    ['packages/spec/package.json', { ...scriptsOnlyIo, base: () => null }, false, 'ADDED manifest (no before) is counted — a new package'],
    ['packages/spec/package.json', { ...scriptsOnlyIo, head: () => null }, false, 'DELETED manifest (no after) is counted — a removed package'],
  ];
  for (const [path, io, want, label] of manifestPathCases) {
    check('isDevOnlyManifestChange', label, path, want, isDevOnlyManifestChange(path, io, inFakeTree));
  }

  // The release-owned FORK (#6893/#4920). This is the one classifier whose `true` must
  // NOT remove the doc from the output — it re-routes the reporting only. Pinning the
  // predicate here keeps the prefix honest; `check-audit-scope.mjs` is what anchors it
  // to AGENTS.md's guardrail row and to the audit workflow's copy.
  const releaseOwnedCases = [
    ['content/docs/releases/v17.mdx', true, 'the specimen row from #6893'],
    ['content/docs/releases/index.mdx', true, 'the releases index'],
    ['content/docs/permissions/authorization.mdx', false, 'an editable hand-written doc'],
    ['content/docs/deployment/releases/v9.mdx', false, 'a page that merely has "releases" deeper in its path'],
  ];
  for (const [doc, want, label] of releaseOwnedCases) check('isReleaseOwned', label, doc, want, isReleaseOwned(doc));

  if (failed) {
    console.error(`\n✗ affected-docs self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`✓ affected-docs self-test: ${total} cases pass.`);
}


// collect package roots from the implementation changes. One pass, because the
// dev-only-manifest arm shells out to git and must not be asked the same question twice.
let testFilesSkipped = 0;
let scriptFilesSkipped = 0;
let devOnlyManifestsSkipped = 0;
const implementationChanges = [];
for (const f of changedFiles) {
  if (isTestFile(f)) { testFilesSkipped++; continue; }
  if (isToolingScript(f)) { scriptFilesSkipped++; continue; }
  if (isDevOnlyManifestChange(f)) { devOnlyManifestsSkipped++; continue; }
  implementationChanges.push(f);
}
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
  if (hits.length) affected.push({ doc, via: [...new Set(hits)], releaseOwned: isReleaseOwned(doc) });
}

// Report what was excluded rather than dropping it silently — a tool that quietly
// narrows its own scope reads as "nothing to see here" when it means "I did not look".
const skipNotes = [];
if (testFilesSkipped > 0) skipNotes.push(`${testFilesSkipped} test file(s) excluded — tests cannot make an implementation doc stale`);
if (scriptFilesSkipped > 0) skipNotes.push(`${scriptFilesSkipped} tooling script(s) excluded — a package's scripts/ dir is build tooling, not documented behaviour`);
if (devOnlyManifestsSkipped > 0) skipNotes.push(`${devOnlyManifestsSkipped} package.json edit(s) excluded — only dev-time keys (${[...DEV_ONLY_PACKAGE_JSON_KEYS].join('/')}) changed`);
const skipNote = skipNotes.length ? ` (${skipNotes.join('; ')})` : '';

emit(
  affected.map((a) => a.doc),
  changedPackages,
  `${affected.length} docs affected by ${changedPackages.length} changed package(s) since ${sinceRef}${skipNote}`,
  affected,
  { testFilesSkipped, scriptFilesSkipped, devOnlyManifestsSkipped },
);

function emit(docList, changedPackages, summary, detail, skipped = {}) {
  const { testFilesSkipped = 0, scriptFilesSkipped = 0, devOnlyManifestsSkipped = 0 } = skipped;
  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          summary,
          sinceRef: all ? null : sinceRef,
          changedPackages,
          // The FULL set, release-owned pages included — this is what feeds the audit
          // workflow's `args.docs`, and #4920 requires those pages to stay audited.
          docs: docList,
          // The reporting fork: the release-owned subset, called out so a consumer can
          // route it (review + file an issue) instead of listing it as editable work.
          // A partition, not a filter — `releaseOwnedDocs ⊆ docs` always.
          releaseOwnedDocs: docList.filter(isReleaseOwned),
          detail: detail || null,
          testFilesSkipped,
          scriptFilesSkipped,
          devOnlyManifestsSkipped,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stderr.write(`# ${summary}\n`);
    process.stdout.write(docList.join('\n') + (docList.length ? '\n' : ''));
  }
}
