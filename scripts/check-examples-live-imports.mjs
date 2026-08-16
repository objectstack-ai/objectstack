#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-examples-live-imports -- the INVENTORY of `packages/**` tests that
// reach into `examples/**` live, and the CI visibility each of those couplings
// actually has.
//
//   node scripts/check-examples-live-imports.mjs             # the gate
//   node scripts/check-examples-live-imports.mjs --list      # the inventory
//   node scripts/check-examples-live-imports.mjs --json      # machine-readable
//   node scripts/check-examples-live-imports.mjs --self-test # the detector's pins
//
// ── The defect this exists to make visible (#8754) ───────────────────────────
//
// `packages/cli/test/i18n-section-coverage.test.ts` dynamically imports
// `examples/app-showcase/src/ui/views/contact.view` and asserts `toEqual` over
// a hardcoded, exhaustive `_sections` key list. An edit inside the showcase app
// that named one legitimately-new form section (#8231's remainder, PR #8742)
// added a seventh key the list did not have, and the assertion went red.
//
// Nothing on the PR side could have said so. CI's `test` job scopes to the
// AFFECTED SUBSET, and affected packages come from the dependency GRAPH:
// `packages/cli` declares no dependency on `@objectstack/example-showcase`
// (the coupling is a test-only RELATIVE import reaching across a workspace
// boundary), so an examples-only diff never reaches cli's tests. The first
// signal was a red `Test Core (3/3)` in the SHARED merge queue -- which stalls
// every lane, not just the one that made the edit (queue build 31825946401).
// It caught #8231's remainder twice in one round, the second time through a
// package nobody had thought to check.
//
// So the gap is not "these tests are written badly". The gap is that NOBODY HAS
// THE LIST -- a dev fixing a lint-prescribed warning in an example app has no
// way, short of a full-repo grep, to know which `packages/**` assertions are
// coupled to that app's current shape.
//
// ── ⛔ What this gate deliberately does NOT do ───────────────────────────────
//
// It grades DISCOVERY -- "here are the coupled files, and here is what CI can
// see of each" -- and asserts NOTHING about how any of them should be written.
// Whether a given coupling should become a synthetic fixture, a frozen snapshot
// (the route #8515 took for part of `packages/lint`), a lint-time guard, or
// should stay exactly as it is, is a SEPARATE call and is not made here. Adding
// a new live coupling is allowed; the only requirement is that it be RECORDED,
// so the next example-app edit can be checked against the list instead of
// against the merge queue.
//
// ── The three visibility tiers (mechanically derived, not judged) ────────────
//
// The couplings are heterogeneous, and flattening them into one list would
// reproduce the very heuristic the card calls unreliable. Each is classified by
// what CI can actually SEE of it:
//
//   `graph-visible`   -- the test imports the example app by its WORKSPACE
//                        PACKAGE NAME (`@objectstack/example-showcase`) and its
//                        package declares that dependency. `turbo ls --affected`
//                        reaches it through the graph like any other edge. Not
//                        a gap; listed because a dev editing the app still
//                        wants to know these tests read it.
//
//   `inputs-declared` -- the coupling escapes by relative path, but the owning
//                        package declares a `$TURBO_ROOT$/examples/...` glob on
//                        its `#test` task in turbo.json that COVERS THIS
//                        COUPLING'S TARGET (the mechanism
//                        `check-cross-package-test-inputs.mjs` maintains, whose
//                        registry drives the affected-subset union too). Both of
//                        CI's scoping layers move with the app. Not a gap.
//
//                        Coverage is judged per target, not per package, and
//                        that distinction is load-bearing rather than pedantic
//                        (#8946). A radius may legitimately name individual app
//                        files instead of the whole app -- `@objectstack/cli`
//                        declares three showcase modules by path. A package-
//                        granular check would then read "cli declares something
//                        under examples/" as "every cli coupling is visible",
//                        so the next live import to a FOURTH app file would be
//                        reported as covered while neither CI layer ran it:
//                        the #8754 blind spot silently reopened inside the
//                        registry built to close it. An uncovered target keeps
//                        the file in `invisible`, where the ratchet demands it
//                        be declared or the radius widened.
//
//   `invisible`       -- escapes by relative path (or by a filesystem read),
//                        with NO declared dependency and NO declared input
//                        glob. Neither CI layer can see it. THIS is #8754's
//                        population, and this is the tier the gate ratchets.
//
// Only `invisible` couplings need a registry entry. That keeps the hand-written
// half proportional to the gap: ~65 `graph-visible` dogfood files enumerate
// themselves and need no maintenance, while the handful CI is blind to must be
// named, each with a note saying WHAT KIND of coupling it is -- because that is
// exactly the signal a flat list destroys.
//
// The gate is checked in BOTH directions, so the inventory cannot rot: a new
// invisible coupling with no entry fails naming itself and what to write, and
// an entry whose coupling is gone (or which has since become visible, e.g. by
// gaining a turbo input glob) fails as STALE and names itself for deletion.
//
// ── Why a source scan, and what it costs ─────────────────────────────────────
//
// Same reasoning as `check-cross-package-test-inputs.mjs`: a detector with no
// dependencies cannot itself fail to resolve in CI. The price is that a scan
// sees only the spellings it knows, so the recognised set is pinned by
// `--self-test` and printed in the failure text. One spelling CANNOT be read
// statically -- a dynamic `import()` whose specifier is computed rather than a
// literal -- so instead of missing it silently, the scan reports any test file
// that has one AND mentions `examples/` in its text, under `unresolved`.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/**
 * Every `packages/**` test coupling to `examples/**` that CI's scoping layers
 * CANNOT see -- the #8754 population.
 *
 * The `note` is the point of this registry. These couplings are heterogeneous
 * by design, and a list that does not say HOW each one is coupled sends the
 * next reader back to the full-repo grep this file exists to replace. Say what
 * the test does with what it imports, and what kind of example-app edit would
 * move it.
 *
 * ⛔ An entry is a RECORD, not a verdict: nothing here says a coupling should
 * be removed, kept, or rewritten.
 *
 * ── Why this is empty, and why that is not dead code ─────────────────────────
 *
 * It is empty because the population is currently empty, not because the
 * registry was abandoned. #8754 opened it holding the four cli/lint i18n tests;
 * #8946 gave `@objectstack/cli` and `@objectstack/lint` the input radius those
 * four reach, so all four moved to `inputs-declared` and the ratchet's stale
 * direction required their entries be deleted. Zero invisible couplings is the
 * goal state of this gate, not the absence of one.
 *
 * The empty object still does work: the undeclared direction of the ratchet
 * measures against it, so the next live coupling CI cannot see fails here
 * naming itself. Note that the `--self-test` case asserting every entry carries
 * a substantive note now passes vacuously -- it re-arms the moment an entry
 * comes back, but until then it proves nothing.
 */
const INVISIBLE_COUPLINGS = {};

/** Recognised coupling spellings. Printed in the failure text and pinned by --self-test. */
const RECOGNISED_SPELLINGS = [
  "import X from '<rel>'            // static, relative -> examples/",
  "export { X } from '<rel>'        // re-export, relative",
  "import '<rel>'                   // bare side-effect import",
  "await import('<rel>')            // dynamic, LITERAL specifier",
  "require('<rel>')                 // cjs",
  "import X from '@objectstack/example-<app>'   // workspace package name",
  "new URL('<rel>', import.meta.url)            // filesystem read reaching examples/",
  "resolve(HERE, '<rel>') / join(HERE, '<rel>') // ditto, via a seeded dir",
];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.git', 'build']);
const TEST_FILE_RE = /\.(test|spec)\.[mc]?[jt]sx?$/;
const TEST_DIR_RE = /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/;

/** Repo-relative, forward-slash form of an absolute path. */
const rel = (abs) => relative(REPO_ROOT, abs).split(sep).join('/');

/**
 * Strip line and block comments while preserving string and template contents.
 *
 * A comment mentioning `examples/app-showcase` is NOT a coupling -- that is the
 * false-positive class a bare grep produces -- but the specifiers we DO want
 * are themselves string literals, so a blunt "drop everything quoted" pass
 * would erase the signal. Hence a real scanner rather than a regex.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every string-literal specifier reachable as a live module reference. */
function moduleSpecifiers(code) {
  const found = [];
  const push = (kind, spec) => found.push({ kind, spec });
  const patterns = [
    // `from '<spec>'` covers `import ... from` and `export ... from`, incl. multiline clauses.
    [/\bfrom\s*(['"])([^'"]+)\1/g, 'static'],
    // bare side-effect import
    [/\bimport\s*(['"])([^'"]+)\1/g, 'static'],
    [/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, 'dynamic'],
    [/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g, 'require'],
  ];
  for (const [re, kind] of patterns) {
    let m;
    while ((m = re.exec(code)) !== null) push(kind, m[2]);
  }
  return found;
}

/** Relative path literals used as filesystem reads (the class an import-only grep misses). */
function readPathLiterals(code) {
  const found = [];
  const patterns = [
    /new\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g,
    /(?:path\.)?(?:resolve|join)\(\s*[A-Za-z_$][\w$]*\s*,\s*(['"])([^'"]+)\1\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code)) !== null) found.push({ kind: 'fs-read', spec: m[2] });
  }
  return found;
}

/** True when a dynamic import's specifier is computed rather than a literal. */
function hasComputedDynamicImport(code) {
  return /\bimport\s*\(\s*(?!['"])[^)\s]/.test(code);
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(abs, out);
    } else if (e.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

/** Test files (and the helpers under a test dir that carry couplings into them). */
function testFiles() {
  const pkgRoot = join(REPO_ROOT, 'packages');
  if (!existsSync(pkgRoot)) return [];
  return walk(pkgRoot).filter((abs) => {
    if (!/\.[mc]?[jt]sx?$/.test(abs)) return false;
    const r = rel(abs);
    return TEST_FILE_RE.test(r) || TEST_DIR_RE.test(r);
  });
}

/** The example apps, by directory and by published package name. */
function exampleApps() {
  const root = join(REPO_ROOT, 'examples');
  const apps = [];
  if (!existsSync(root)) return apps;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const pkgJson = join(root, e.name, 'package.json');
    let name;
    try {
      name = JSON.parse(readFileSync(pkgJson, 'utf8')).name;
    } catch {
      /* an example without a package.json is still a directory couplings can reach */
    }
    apps.push({ dir: `examples/${e.name}`, name });
  }
  return apps;
}

/** The package directory owning a file, plus its manifest. */
function owningPackage(fileAbs) {
  let dir = dirname(fileAbs);
  while (dir.startsWith(REPO_ROOT) && dir !== REPO_ROOT) {
    const pkgJson = join(dir, 'package.json');
    if (existsSync(pkgJson)) {
      try {
        const manifest = JSON.parse(readFileSync(pkgJson, 'utf8'));
        if (manifest.name) return { dir: rel(dir), manifest };
      } catch {
        /* fall through to the parent */
      }
    }
    dir = dirname(dir);
  }
  return null;
}

/**
 * Packages whose `#test` task declares an `examples/...` input glob in
 * turbo.json, mapped to those globs in repo-relative form (the `$TURBO_ROOT$/`
 * prefix stripped) so they can be matched against a coupling target.
 */
function packagesWithExampleInputs() {
  const declared = new Map();
  let turbo;
  try {
    turbo = JSON.parse(readFileSync(join(REPO_ROOT, 'turbo.json'), 'utf8'));
  } catch {
    return declared;
  }
  const tasks = turbo.tasks ?? turbo.pipeline ?? {};
  for (const [taskId, cfg] of Object.entries(tasks)) {
    if (!taskId.endsWith('#test')) continue;
    const globs = (cfg?.inputs ?? [])
      .filter((g) => typeof g === 'string' && g.includes('examples/'))
      .map((g) => g.replace(/^\$TURBO_ROOT\$\//, ''));
    if (globs.length) declared.set(taskId.slice(0, -'#test'.length), globs);
  }
  return declared;
}

/**
 * Turbo input-glob semantics: `**` spans whole segments, `*` stays inside one.
 *
 * Mirrored from `globToRegExp` in `check-cross-package-test-inputs.mjs` rather
 * than imported, because that module runs its gate at load time -- importing it
 * would execute a second gate as a side effect of classifying. The duplication
 * is pinned by `--self-test` on both sides; the two must agree, since this is
 * the check that decides whether a declared radius really covers a coupling.
 */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:[^/]+/)*';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\/'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Does one declared input glob cover this coupling target?
 *
 * A DIRECTORY target is read wholesale -- the dogfood shape chdirs into the app
 * and compiles whatever is there -- so it is covered only by a glob whose
 * subtree contains it, never by one naming a single file inside it. Matching a
 * directory against the glob pattern directly would let `examples/app-*` report
 * a whole app as covered on the strength of its own name.
 */
export function globCoversTarget(glob, target, isDir) {
  if (!isDir && globToRegExp(glob).test(target)) return true;
  if (!glob.endsWith('/**')) return false;
  const prefix = glob.slice(0, -'/**'.length);
  return target === prefix || target.startsWith(`${prefix}/`);
}

/**
 * The declared globs that fail to cover a by-path coupling, as repo-relative
 * target paths. Empty means every path this test reaches really is hashed onto
 * the package's `#test` task and really does pull it into the affected subset.
 */
function uncoveredTargetsOf(byPathCouplings, fileAbs, globs) {
  const uncovered = [];
  for (const c of byPathCouplings) {
    const abs = resolveExampleSource(resolve(dirname(fileAbs), c.spec));
    const target = rel(abs);
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      isDir = false;
    }
    if (!globs.some((g) => globCoversTarget(g, target, isDir))) uncovered.push(target);
  }
  return [...new Set(uncovered)].sort();
}

/** Resolve a specifier to a repo-relative `examples/**` path, or null. */
function couplingTarget(spec, fileAbs, apps) {
  if (spec.startsWith('.')) {
    const abs = resolve(dirname(fileAbs), spec);
    const r = rel(abs);
    return r.startsWith('examples/') ? r : null;
  }
  for (const app of apps) {
    if (app.name && (spec === app.name || spec.startsWith(`${app.name}/`))) return app.dir;
  }
  return null;
}

/** The whole inventory: one entry per coupled test file. */
function collect() {
  const apps = exampleApps();
  const exampleInputs = packagesWithExampleInputs();
  const rows = [];
  const unresolved = [];

  for (const abs of testFiles()) {
    let raw;
    try {
      raw = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!raw.includes('example')) continue;
    const code = stripComments(raw);
    const refs = [...moduleSpecifiers(code), ...readPathLiterals(code)];

    const couplings = [];
    for (const { kind, spec } of refs) {
      const target = couplingTarget(spec, abs, apps);
      if (target) couplings.push({ kind, spec, target });
    }

    const file = rel(abs);
    if (!couplings.length) {
      if (hasComputedDynamicImport(code) && /examples\//.test(raw)) {
        unresolved.push({ file, why: 'computed dynamic import() + a textual examples/ mention' });
      }
      continue;
    }

    const pkg = owningPackage(abs);
    const pkgName = pkg?.manifest?.name ?? '(unknown)';
    const deps = {
      ...(pkg?.manifest?.dependencies ?? {}),
      ...(pkg?.manifest?.devDependencies ?? {}),
      ...(pkg?.manifest?.peerDependencies ?? {}),
    };

    // A coupling is graph-visible only when it travels the declared edge: the
    // specifier IS the package name AND the manifest declares it.
    const byPackageName = couplings.filter((c) => !c.spec.startsWith('.'));
    const byPath = couplings.filter((c) => c.spec.startsWith('.'));
    const declaredEdge = byPackageName.some((c) => {
      const app = apps.find((a) => a.dir === c.target);
      return app?.name && Object.hasOwn(deps, app.name);
    });

    // Only the by-path couplings need an input glob: a by-package-name coupling
    // on a declared edge is already reachable through the dependency graph.
    const declaredGlobs = exampleInputs.get(pkgName) ?? [];
    const uncoveredTargets = uncoveredTargetsOf(byPath, abs, declaredGlobs);

    let visibility;
    if (byPath.length === 0 && declaredEdge) visibility = 'graph-visible';
    else if (declaredGlobs.length > 0 && uncoveredTargets.length === 0) visibility = 'inputs-declared';
    else visibility = 'invisible';

    rows.push({
      file,
      package: pkgName,
      visibility,
      uncoveredTargets,
      targets: [...new Set(couplings.map((c) => c.target))].sort(),
      refs: couplings
        .map((c) => ({ kind: c.kind, spec: c.spec }))
        .sort((a, b) => a.spec.localeCompare(b.spec)),
    });
  }

  rows.sort((a, b) => a.file.localeCompare(b.file));
  unresolved.sort((a, b) => a.file.localeCompare(b.file));
  return { rows, unresolved };
}

/**
 * Map an import specifier onto the example-app SOURCE FILE it really reaches.
 *
 * Under NodeNext one importer spells `contact.view.js` and another spells
 * `contact.view` for the same `contact.view.ts` on disk. Left unnormalised the
 * reverse index splits into two entries and a dev editing that file looks up
 * one spelling and misses the other importer entirely -- which is the exact
 * failure this inventory exists to prevent, reproduced inside the inventory.
 */
function resolveExampleSource(absSpec) {
  const candidates = [];
  const stripped = absSpec.replace(/\.(js|mjs|cjs)$/, '');
  for (const base of stripped === absSpec ? [absSpec] : [stripped, absSpec]) {
    candidates.push(base);
    for (const ext of ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']) {
      candidates.push(`${base}${ext}`);
    }
    for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
      candidates.push(join(base, `index${ext}`));
    }
  }
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* try the next candidate */
    }
  }
  return absSpec;
}

/** Reverse index: which example-app source files are read, and by whom. */
function reverseIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    for (const ref of row.refs) {
      let target;
      if (ref.spec.startsWith('.')) {
        const abs = resolve(join(REPO_ROOT, dirname(row.file)), ref.spec);
        target = rel(resolveExampleSource(abs));
      } else {
        target = row.targets[0];
      }
      if (!index.has(target)) index.set(target, new Set());
      index.get(target).add(row.file);
    }
  }
  return [...index.entries()]
    .map(([target, files]) => ({ target, files: [...files].sort() }))
    .sort((a, b) => a.target.localeCompare(b.target));
}

function list() {
  const { rows, unresolved } = collect();
  const tiers = ['invisible', 'inputs-declared', 'graph-visible'];
  const blurb = {
    invisible:
      'NEITHER CI layer sees these. An examples-only PR does not run them; the merge queue is the first signal.',
    'inputs-declared':
      'Escapes by path, but the package declares an examples/** input glob on its #test task (turbo.json).',
    'graph-visible':
      'Imported by workspace package name, with the dependency declared -- turbo ls --affected reaches these.',
  };

  console.log('packages/** tests coupled to examples/** -- live-import inventory\n');
  for (const tier of tiers) {
    const inTier = rows.filter((r) => r.visibility === tier);
    console.log(`## ${tier}  (${inTier.length} file${inTier.length === 1 ? '' : 's'})`);
    console.log(`   ${blurb[tier]}\n`);
    for (const row of inTier) {
      console.log(`   ${row.file}`);
      if (tier === 'invisible') {
        const entry = INVISIBLE_COUPLINGS[row.file];
        for (const ref of row.refs) console.log(`       ${ref.kind}: ${ref.spec}`);
        console.log(`       note: ${entry ? entry.note : '(UNDECLARED -- run the gate)'}`);
      } else {
        console.log(`       ${row.targets.join(', ')}`);
      }
    }
    console.log('');
  }

  console.log('## by example-app path (what breaks if you edit it)\n');
  for (const { target, files } of reverseIndex(rows.filter((r) => r.visibility === 'invisible'))) {
    console.log(`   ${target}`);
    for (const f of files) console.log(`       ${f}`);
  }
  console.log('');

  if (unresolved.length) {
    console.log('## unresolved (a computed dynamic import() -- cannot be read statically)\n');
    for (const u of unresolved) console.log(`   ${u.file}  -- ${u.why}`);
    console.log('');
  }
}

function verify() {
  const { rows, unresolved } = collect();
  const discovered = rows.filter((r) => r.visibility === 'invisible').map((r) => r.file);
  const declared = Object.keys(INVISIBLE_COUPLINGS);
  const problems = [];

  for (const file of discovered) {
    if (!Object.hasOwn(INVISIBLE_COUPLINGS, file)) {
      const row = rows.find((r) => r.file === file);
      // A package that declares SOME examples glob but not one covering this
      // coupling is the more misleading case of the two, so it gets its own
      // wording: the fix is usually to widen the radius, not to record the file.
      const why = row.uncoveredTargets.length
        ? `package ${row.package} declares examples input globs, but none of them covers:\n` +
          row.uncoveredTargets.map((t) => `      ${t}`).join('\n') +
          `\n    so a diff touching those paths still does not re-run this test. Widen the\n` +
          `    package's globs in scripts/check-cross-package-test-inputs.mjs (and mirror\n` +
          `    them onto its #test task in turbo.json) -- or, if the coupling should stay\n` +
          `    unscoped, record it:`
        : `package ${row.package} reaches ${row.targets.join(', ')} with no declared\n` +
          `    dependency and no examples/** input glob, so neither CI layer runs it on an\n` +
          `    examples-only diff.`;
      problems.push(
        `UNDECLARED coupling: ${file}\n` +
          `    ${why}\n` +
          `    Add an entry to INVISIBLE_COUPLINGS in ${rel(fileURLToPath(import.meta.url))}:\n` +
          `      '${file}': { note: 'what this test does with what it imports, and what kind of\n` +
          `                          example-app edit would move it' },\n` +
          `    This records the coupling. It does NOT ask you to change the test.`,
      );
    }
  }

  for (const file of declared) {
    if (!discovered.includes(file)) {
      const row = rows.find((r) => r.file === file);
      const why = !row
        ? 'no live examples/** coupling is detected there any more (moved, removed, or decoupled)'
        : `it is now '${row.visibility}', which CI can already see`;
      problems.push(
        `STALE entry: ${file}\n` +
          `    ${why}.\n` +
          `    Delete its INVISIBLE_COUPLINGS entry in ${rel(fileURLToPath(import.meta.url))}.`,
      );
    }
  }

  for (const entry of declared) {
    const note = INVISIBLE_COUPLINGS[entry]?.note;
    if (!note || note.trim().length < 40) {
      problems.push(
        `THIN note: ${entry}\n` +
          `    A bare file list is the unreliable heuristic this inventory replaces. Say what the\n` +
          `    test does with what it imports, and what kind of example-app edit would move it.`,
      );
    }
  }

  for (const u of unresolved) {
    problems.push(
      `UNRESOLVED: ${u.file}\n` +
        `    ${u.why}. A computed specifier cannot be read statically, so this scan cannot\n` +
        `    classify it. Give the import a literal specifier, or record the file in\n` +
        `    INVISIBLE_COUPLINGS with a note saying what it reaches.`,
    );
  }

  if (problems.length) {
    console.error('examples/** live-import inventory is out of date.\n');
    for (const p of problems) console.error(`  ${p}\n`);
    console.error('  Recognised coupling spellings:');
    for (const s of RECOGNISED_SPELLINGS) console.error(`    ${s}`);
    console.error(
      `\n  Reaching for a spelling not listed? Extend the detector AND add a --self-test case\n` +
        `  in the same edit -- an unseen coupling is the blind spot this file exists to close.\n` +
        `\n  Inventory: node scripts/check-examples-live-imports.mjs --list`,
    );
    process.exit(1);
  }

  const counts = rows.reduce((acc, r) => ({ ...acc, [r.visibility]: (acc[r.visibility] ?? 0) + 1 }), {});
  console.log(
    `examples/** live-import inventory OK -- ` +
      `${counts.invisible ?? 0} invisible (declared), ` +
      `${counts['inputs-declared'] ?? 0} inputs-declared, ` +
      `${counts['graph-visible'] ?? 0} graph-visible.`,
  );
}

// ── self-test ────────────────────────────────────────────────────────────────
//
// Pins the DETECTOR, which is the half that can silently under-report. Every
// recognised spelling gets a positive case, and every known false-positive
// class (a comment, a string literal that is not a specifier, a relative path
// that stays inside the package) gets a negative one.

function selfTest() {
  const apps = [
    { dir: 'examples/app-showcase', name: '@objectstack/example-showcase' },
    { dir: 'examples/app-crm', name: '@objectstack/example-crm' },
  ];
  // Pretend the scanned file is packages/cli/test/x.test.ts -- three levels up
  // from `packages/cli/test` is the repo root.
  const fakeAbs = join(REPO_ROOT, 'packages/cli/test/x.test.ts');

  const detects = (src) => {
    const code = stripComments(src);
    const refs = [...moduleSpecifiers(code), ...readPathLiterals(code)];
    return refs.some(({ spec }) => couplingTarget(spec, fakeAbs, apps) !== null);
  };

  const cases = [
    ['static relative import', detects("import { C } from '../../../examples/app-showcase/src/x.js';")],
    ['static relative export-from', detects("export { C } from '../../../examples/app-showcase/src/x.js';")],
    ['bare side-effect import', detects("import '../../../examples/app-showcase/src/x.js';")],
    ['multiline import clause', detects("import {\n  A,\n  B,\n} from '../../../examples/app-showcase/src/x.js';")],
    ['dynamic import, literal', detects("const m = await import('../../../examples/app-showcase/src/x');")],
    ['dynamic import inside Promise.all', detects("await Promise.all([\n  import('../../../examples/app-showcase/src/x'),\n]);")],
    ['require()', detects("const m = require('../../../examples/app-crm/src/x.js');")],
    ['workspace package name', detects("import s from '@objectstack/example-showcase';")],
    ['workspace package subpath', detects("import s from '@objectstack/example-crm/dist/x.js';")],
    ['new URL fs read', detects("const D = fileURLToPath(new URL('../../../examples/app-showcase/', import.meta.url));")],
    ['resolve(HERE, rel) fs read', detects("const D = resolve(HERE, '../../../examples/app-showcase/src');")],
    ['join(HERE, rel) fs read', detects("const D = join(HERE, '../../../examples/app-showcase/src');")],

    // ── negatives: the false-positive classes a bare grep produces ──
    ['line comment is not a coupling', !detects("// see ../../../examples/app-showcase/src/x.js for why")],
    ['block comment is not a coupling', !detects("/*\n * ../../../examples/app-showcase/src/x.js\n */")],
    ['jsdoc mention is not a coupling', !detects("/** mirrors examples/app-showcase/src/x.js */")],
    [
      'a non-specifier string literal is not a coupling',
      !detects("const msg = 'declaration: examples/app-showcase/src/x.js';"),
    ],
    ['a relative path staying in-package is not a coupling', !detects("import { C } from './fixtures/x.js';")],
    ['an unrelated package import is not a coupling', !detects("import { z } from 'zod';")],
    ['a sibling package import is not a coupling', !detects("import { C } from '../../lint/src/x.js';")],
    [
      'a URL containing // does not break the comment scanner',
      detects("const u = 'https://example.com';\nimport { C } from '../../../examples/app-showcase/src/x.js';"),
    ],

    // ── the computed-specifier blind spot is REPORTED, not missed ──
    ['computed dynamic import is flagged', hasComputedDynamicImport("const m = await import(specifier);")],
    ['literal dynamic import is not flagged as computed', !hasComputedDynamicImport("await import('../x.js');")],

    // ── registry hygiene ──
    [
      'every declared entry carries a substantive note',
      Object.values(INVISIBLE_COUPLINGS).every((e) => (e.note ?? '').trim().length >= 40),
    ],

    // ── input-glob coverage: the check that lets a radius be NARROW safely ──
    //
    // Pinned because a false positive here is silent and total: a coupling
    // wrongly judged covered leaves `invisible`, so the ratchet stops asking
    // for it and CI never runs it either.
    [
      'an exact-file glob covers that file',
      globCoversTarget(
        'examples/app-showcase/src/ui/views/contact.view.ts',
        'examples/app-showcase/src/ui/views/contact.view.ts',
        false,
      ),
    ],
    [
      'an exact-file glob does NOT cover a sibling file',
      !globCoversTarget(
        'examples/app-showcase/src/ui/views/contact.view.ts',
        'examples/app-showcase/src/ui/pages/task-triage.page.ts',
        false,
      ),
    ],
    [
      'a subtree glob covers a file beneath it',
      globCoversTarget('examples/app-showcase/**', 'examples/app-showcase/src/data/objects/x.object.ts', false),
    ],
    [
      'a subtree glob does NOT cover another app',
      !globCoversTarget('examples/app-showcase/**', 'examples/app-crm/src/x.ts', false),
    ],
    [
      'a subtree glob covers the directory it names (the chdir-and-compile shape)',
      globCoversTarget('examples/app-showcase/**', 'examples/app-showcase', true),
    ],
    [
      'an exact-file glob does NOT cover the directory containing it',
      !globCoversTarget('examples/app-showcase/src/ui/views/contact.view.ts', 'examples/app-showcase', true),
    ],
    [
      'a deeper subtree glob does NOT cover a directory above it',
      !globCoversTarget('examples/app-showcase/src/**', 'examples/app-showcase', true),
    ],
    [
      '* does not span segments',
      !globCoversTarget('examples/app-showcase/src/*.ts', 'examples/app-showcase/src/ui/x.ts', false),
    ],
  ];

  let failed = 0;
  for (const [name, ok] of cases) {
    if (!ok) {
      failed++;
      console.error(`  FAIL  ${name}`);
    } else {
      console.log(`  ok    ${name}`);
    }
  }
  if (failed) {
    console.error(`\n${failed}/${cases.length} self-test case(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} self-test cases passed.`);
}

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) selfTest();
else if (argv.includes('--list')) list();
else if (argv.includes('--json')) {
  const { rows, unresolved } = collect();
  console.log(
    JSON.stringify(
      {
        rows: rows.map((r) => ({ ...r, note: INVISIBLE_COUPLINGS[r.file]?.note })),
        unresolved,
        byExamplePath: reverseIndex(rows.filter((r) => r.visibility === 'invisible')),
      },
      null,
      2,
    ),
  );
} else verify();
