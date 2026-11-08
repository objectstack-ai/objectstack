#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * select-affected-tests -- the test files a pull request or merge-queue run
 * owes, under the two-speed doctrine (objectui#12214, objectstack#22998).
 *
 *   node scripts/select-affected-tests.mjs --base <sha> --out <file>
 *   node scripts/select-affected-tests.mjs --base <sha> --explain
 *
 * The LAST line on stdout is the verdict, one of:
 *
 *   mode=full       run the whole suite (`pnpm test --shard=N/16`)
 *   mode=affected   run the vitest filters written to `--out`, one per line
 *
 * Exit 0 means a verdict was reached -- either one. Any other exit means the
 * question could not be answered, and `ci.yml` treats that as `mode=full`: a
 * selector that cannot tell must RUN, never skip (the fail-open rule
 * `merge-queue-reporting.test.ts` held every in-job gate of that workflow to,
 * until objectstack#26944 retired it).
 *
 * ## The two speeds
 *
 * `push` to `main` and the hourly `schedule` run carry the FULL battery: every
 * test file, sixteen shards, plus the sharded coverage lane. Nothing reads
 * this script there. A `pull_request` or `merge_group` run carries the FAST
 * SET this script selects. Whatever the fast set misses, the full battery on
 * `main` still runs within the hour -- that is the doctrine's trade, stated so
 * nobody reads the fast set as the whole suite.
 *
 * ## What the fast set is
 *
 * The package graph, plus everything the package graph cannot see.
 *
 *  1. AFFECTED PACKAGES. Every workspace package (`pnpm-workspace.yaml`) that a
 *     changed file sits in, plus every package that depends on one of them,
 *     transitively, through `dependencies`, `devDependencies`,
 *     `peerDependencies` or `optionalDependencies`. This is what
 *     `turbo ls --affected` answers; `select-affected-tests.test.ts` holds the
 *     two to the same set. Each affected package contributes its whole
 *     directory as a vitest filter.
 *
 *  2. ALWAYS-ON TEST FILES. A test the package graph cannot place is selected
 *     on every run, whatever changed:
 *       - it lives outside every workspace package and every owner
 *         directory (item 2c): nothing owns it, so no change reaches it;
 *       - it, or a module it reaches through RELATIVE imports, reads the disk
 *         or spawns a process (`fs`, `child_process`, `import.meta.glob`) with
 *         a radius item 2b cannot bound: its input is the tree, and the tree
 *         is not a package;
 *       - it reaches, through relative imports, a file outside every
 *         workspace package (`scripts/`, the tree root): no package change
 *         reaches that file.
 *
 *  2a. ATTRIBUTED TEST FILES. A test whose relative closure reads nothing off
 *     disk and stays inside workspace packages, but reaches past its own
 *     package -- a relative import into another package's directory, or a
 *     workspace package imported by name that its own package does not depend
 *     on (the root vitest alias map resolves every `@object-ui/*` name to
 *     source whether or not the package declares it) -- has edges no
 *     `package.json` states. Its INPUT PACKAGES are its own, every package its
 *     relative closure has a file in, and every workspace package that closure
 *     imports by name. It is selected, file by file, whenever one of them is
 *     affected; an affected package already folds in its dependents, so a
 *     change to a package one of those reads is selected too. Declaring the
 *     edge instead would make the test's whole package a dependent of the
 *     target, and three of those edges on this tree would be cycles
 *     (objectstack#31520).
 *
 *  2b. BOUNDED DISK READERS. A disk-reading module whose every read the
 *     monorepo's path walker resolves to a named file or directory inside a
 *     workspace package (`readRadius`) adds those packages to the test's input
 *     packages, exactly as a relative reach does in 2a. Anything the walker
 *     cannot name -- an unread argument, a spawn, `process.cwd()`, an async or
 *     glob read, a walk from an unnamed root -- keeps the test always-on.
 *
 *  2c. OWNER DIRECTORIES. `scripts/` and `eslint-rules/` own the tests under
 *     them as a package owns its own (`OWNER_DIRS`): a change to a file in one
 *     selects that directory's tests, and a test elsewhere that imports or
 *     reads into one counts the directory among its input packages. An owner
 *     directory declares no dependencies, so every workspace package its tests
 *     import is an input package (item 2a). A change to the path walker
 *     (`PATH_WALKER_FILE`, outside the tree) selects `scripts/`, the directory
 *     of the selector that imports it. Its tests stay always-on exactly where
 *     a package's would: a spawn, a tree walk, a read item 2b cannot bound.
 *     `scripts/invoked-as.mjs`, which nearly every script imports, is the one
 *     module whose disk use is not a test input (`BENIGN_DISK_MODULES`). An
 *     owner directory is never a workspace package: the full-run reach in
 *     item 3 is still computed against the workspace alone.
 *
 *  2d. LIBRARY PROGRAMS. A module that imports a library which reads the disk
 *     on its caller's behalf (`LIBRARY_DISK_READERS`) reads the disk whether or
 *     not it imports `fs`: a TypeScript program follows `tsconfig` and every
 *     import through `ts.sys`. Only the in-memory parts are free
 *     (`libraryReadsDisk`): TypeScript's parser, node tests and enums,
 *     ESLint's `RuleTester` and `Linter`, Tailwind's core `compile`. Any other
 *     runtime use is a disk read with a radius nothing states
 *     (objectstack#31520).
 *
 *  3. FULL RUN instead, when the change reaches something every test runs
 *     through:
 *       - a `package.json`, `vitest.config.*` or `vite.config.*` anywhere --
 *         vitest's own `forceRerunTriggers` default, mirrored so `--changed`
 *         and this script would agree;
 *       - a `tsconfig*.json` anywhere (it steers how every test is transformed);
 *       - a file at the repository root that is not documentation, or anything
 *         under `patches/` (installs, lockfile, toolchain pins);
 *       - a file the root vitest config or one of its setup files reaches
 *         through relative imports (`scripts/vitest-invocation-guard.mjs` is
 *         one);
 *       - an affected package that a BROAD root setup file imports by name:
 *         the light DOM setup installs the i18n catalogues into every `dom`
 *         test, an edge no test file states;
 *       - nested as `ui/` of the objectstack monorepo, a change OUTSIDE the
 *         tree that its tests install or build from: a non-documentation
 *         file at the workspace root, `patches/`, or a monorepo package the
 *         tree depends on (`outsideTreeReasons` says which).
 *
 *  4. THE HEAVY SETUP. The setup of the `dom-heavy` project registers four
 *     packages' components into every test of that project and of each
 *     config that loads the same setup (`apps/console`). When an affected
 *     package is imported by that setup and by no broad one, the selection
 *     adds those projects' test files instead of running everything. Both the
 *     setup file and the `heavyDomTests` list are read out of
 *     `vitest.config.mts`, never copied here; a config this reader cannot
 *     parse is a refusal, and a refusal is a full run.
 *
 * ## Why the package graph and not vitest `--changed`
 *
 * Measured on this tree for objectui#12214, one leaf file changed
 * (`packages/plugin-kanban/src/KanbanColumnSummary.ts`): `vitest list
 * --changed` selected a much smaller set than the package graph, but spent
 * minutes transforming every test file's import graph in every project before
 * running anything, and it is blind to the edges in item 2 and item 3 (a setup
 * file is not in any test file's import graph; neither is a file read off
 * disk). The package graph costs a `git diff` and a walk of `package.json`
 * files. The figures are on objectui#12214's pull request, not here: a number
 * in a comment is derived once and never again (AGENTS.md #9).
 *
 * ## What it does not see -- stated, not hidden
 *
 *  - A non-relative edge to a file outside the tree's packages that is NOT a
 *    workspace package name (a bare-path alias other than the root map's).
 *  - A test whose disk read goes through a workspace package's export rather
 *    than through `fs` in its own relative closure.
 *  - Behaviour that depends on WHEN a test runs relative to another (shared
 *    module state in the `unit` project); the full battery runs them together.
 *
 * Each of these is caught by the full battery on `main`, which is the
 * doctrine's answer to every fast-set miss.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { stripComments } from './js-comment-mask.mjs';
import {
  nestedPrefix,
  parseWorkspaceGlobs,
  workspaceGlobs,
  workspaceManifestPath,
  workspaceRoot,
} from './workspace-root.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The path walker of the monorepo's cross-package gate
 * (`scripts/check-cross-package-test-inputs.mjs`, `scanPathExpressions`), the
 * one reader in either tree that resolves a test's `fs` path arguments to the
 * files they name. Imported, never copied: two walkers would disagree the day
 * one learns a spelling. It exists only nested as `ui/` of objectstack; in a
 * standalone tree, or if the export is missing, this is `null` and every disk
 * reader stays always-on -- the answer before item 2b existed.
 */
export const PATH_WALKER_FILE = 'scripts/check-cross-package-test-inputs.mjs';
async function loadPathWalker() {
  if (!nestedPrefix(REPO_ROOT)) return null;
  const file = path.join(workspaceRoot(REPO_ROOT), PATH_WALKER_FILE);
  if (!fs.existsSync(file)) return null;
  const mod = await import(pathToFileURL(file).href);
  return typeof mod.scanPathExpressions === 'function' ? mod.scanPathExpressions : null;
}
export const PATH_WALKER = await loadPathWalker();

/** The root files every test run is configured by. Their relative closure is a full-run trigger. */
export const ROOT_TEST_CONFIG = Object.freeze(['vitest.config.mts']);

/** Root files whose change is documentation and reaches no test through an import. */
const ROOT_DOC_FILE = /^(?:[^/]+\.mdx?|LICENSE[^/]*|NOTICE[^/]*|CODEOWNERS)$/;

/** `forceRerunTriggers`' vitest default, plus tsconfig files: a change here runs everything. */
const FULL_RUN_BASENAME = /^(?:package\.json|vitest\.config\.[^/]+|vite\.config\.[^/]+|tsconfig[^/]*\.json)$/;

/** A test file, as the root vitest config's projects include them. */
const TEST_FILE = /\.test\.(?:ts|tsx|js|mjs|cjs|mts|jsx)$/;

/** Module specifiers whose import means "this test reads the tree, or runs something that does". */
const DISK_SPECIFIERS = new Set([
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
  'child_process',
  'node:child_process',
  'fs-extra',
  'glob',
  'fast-glob',
  'globby',
  'tinyglobby',
]);

/**
 * The `fs` calls item 2b can bound. The reads are the walker's path-argument
 * reads (`globSync` aside, which is a glob); the rest write or clean up and read
 * nothing back. Any other `fs` member -- an async read, `realpathSync`, a
 * stream -- is a read whose radius the walker never sees.
 */
const BOUNDED_FS_READS = ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync', 'opendirSync'];
/**
 * Libraries that read the disk on their caller's behalf: a TypeScript program
 * follows `tsconfig` and every import through `ts.sys`, a bundler or linter
 * reads its config and inputs. A disk-reading module that imports one has a
 * radius no `fs` argument states. Measured on objectstack#31520: a `types` test
 * building a `ts.createProgram` read the tree's root `tsconfig.json` and
 * `@objectstack/spec` through `typescript`, with no `fs` call naming either.
 */
const LIBRARY_DISK_READERS = new Set(['typescript', 'ts-morph', 'eslint', 'vite', 'esbuild', 'rollup', 'tailwindcss', 'postcss']);
const FS_NON_READS = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'mkdtempSync', 'rmSync', 'rmdirSync', 'unlinkSync'];

/**
 * TypeScript's members that run in memory: the parser, node tests and walks,
 * and the enums a parse is configured with. A capitalised member is a type or
 * an enum and runs nothing. Anything else -- `sys`, `createProgram`,
 * `createCompilerHost`, `readConfigFile`, `resolveModuleName`, a member this
 * list has not met -- is a read of the disk (item 2d).
 */
const TS_IN_MEMORY = /^(?:is[A-Z]\w*|forEachChild|findAncestor|createSourceFile|getModifiers|canHaveModifiers|getLeadingCommentRanges|getTrailingCommentRanges|getJSDocCommentsAndTags|getTextOfJSDocComment|tokenToString|flattenDiagnosticMessageText|parseConfigFileTextToJson|transpileModule|factory|[A-Z]\w*)$/;
/**
 * The in-memory entry points of the other libraries, by library. ESLint's
 * `ESLint` reads config files and globs; its `RuleTester` and `Linter` take
 * the code they lint as a string. Tailwind's core `compile` loads a
 * stylesheet only through the `loadStylesheet` its caller passes, so the read,
 * if any, is the caller's own `fs` call. A library not listed here has no
 * in-memory part.
 */
const LIBRARY_IN_MEMORY = new Map([
  ['eslint', new Set(['RuleTester', 'Linter'])],
  ['tailwindcss', new Set(['compile'])],
]);

/**
 * Directories outside every workspace package that own their own tests, as
 * a package does (item 2c). Each is a dependency-free pseudo-package named
 * `<dir:NAME>`.
 */
export const OWNER_DIRS = Object.freeze(['scripts', 'eslint-rules']);
export const ownerDirName = (dir) => `<dir:${dir}>`;

/**
 * Modules whose disk use is not a test input, with the exact `fs` and
 * `child_process` bindings that use is spelled with. `invoked-as.mjs`
 * realpaths `process.argv[1]` to answer "was I run?", and its own `selfTest`
 * writes, links and spawns files in a temp directory it makes. A module whose
 * disk imports differ from the pinned list by one binding is not exempt: a new
 * read has to be imported, so the exemption cannot widen unseen.
 */
export const BENIGN_DISK_MODULES = Object.freeze({
  'scripts/invoked-as.mjs': Object.freeze({
    'node:child_process': ['spawnSync'],
    'node:fs': ['existsSync', 'mkdirSync', 'mkdtempSync', 'realpathSync', 'rmSync', 'symlinkSync', 'writeFileSync'],
  }),
});

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const RUNTIME_DEPENDENCY_FIELDS = DEPENDENCY_FIELDS.filter((field) => field !== 'devDependencies');

const RESOLVE_EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

const toPosix = (p) => p.split(path.sep).join('/');

/**
 * The `packages:` globs of a `pnpm-workspace.yaml` text: the one parser in
 * `scripts/workspace-root.mjs`, re-exported for this script's callers. Only
 * `dir/*` and a bare `dir` are read, and anything else is a refusal, never a
 * guess (an unread glob would silently drop packages out of the graph).
 */
export { parseWorkspaceGlobs };

/**
 * The named manifests under `globs` (`dir` or `dir/*`, already parsed),
 * relative to `base`.
 *
 * @param {string} base
 * @param {string[]} globs
 * @returns {Array<{ name: string, dir: string, pkg: Record<string, any> }>}
 */
function readManifests(base, globs) {
  const dirs = [];
  for (const glob of globs) {
    if (glob.endsWith('/*')) {
      const parent = glob.slice(0, -2);
      const abs = path.join(base, parent);
      if (!fs.existsSync(abs)) continue;
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(`${parent}/${entry.name}`);
      }
    } else {
      dirs.push(glob);
    }
  }
  const manifests = [];
  for (const dir of dirs.sort()) {
    const file = path.join(base, dir, 'package.json');
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof pkg.name !== 'string') continue;
    manifests.push({ name: pkg.name, dir, pkg });
  }
  return manifests;
}

/**
 * Every workspace package: its name, its repository-relative directory and the
 * workspace packages it names in any dependency field.
 *
 * @param {string} root
 * @returns {Array<{ name: string, dir: string, deps: string[] }>}
 */
export function listWorkspacePackages(root = REPO_ROOT) {
  // Relative to `root` in both layouts: the objectui root's own file, or the
  // monorepo root's `ui/...` globs with the prefix stripped (objectstack#25723).
  const manifests = readManifests(root, workspaceGlobs(root));
  const names = new Set(manifests.map((m) => m.name));
  return manifests.map(({ name, dir, pkg }) => {
    const deps = new Set();
    for (const field of DEPENDENCY_FIELDS) {
      for (const dep of Object.keys(pkg[field] ?? {})) if (names.has(dep) && dep !== name) deps.add(dep);
    }
    return { name, dir, deps: [...deps].sort() };
  });
}

/**
 * @param {Array<{ name: string, deps: string[] }>} packages
 * @returns {{ dependencyClosure: Map<string, Set<string>>, dependentClosure: Map<string, Set<string>> }}
 */
export function packageClosures(packages) {
  const direct = new Map(packages.map((p) => [p.name, p.deps]));
  const reverse = new Map(packages.map((p) => [p.name, []]));
  for (const p of packages) for (const d of p.deps) reverse.get(d)?.push(p.name);
  const walk = (start, edges) => {
    const seen = new Set();
    const stack = [...(edges.get(start) ?? [])];
    while (stack.length) {
      const next = stack.pop();
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(edges.get(next) ?? []));
    }
    return seen;
  };
  return {
    dependencyClosure: new Map(packages.map((p) => [p.name, walk(p.name, direct)])),
    dependentClosure: new Map(packages.map((p) => [p.name, walk(p.name, reverse)])),
  };
}

/** The workspace package a repository-relative path sits in, or null. */
export function owningPackage(rel, packages) {
  let best = null;
  for (const p of packages) {
    if (rel === p.dir || rel.startsWith(`${p.dir}/`)) {
      if (!best || p.dir.length > best.dir.length) best = p;
    }
  }
  return best;
}

/**
 * Every module specifier a source file names: static and dynamic imports,
 * re-exports, `require`, and the `vi.mock` family (a mocked module is an input
 * of the test whether or not the factory imports it). `import.meta.glob` is
 * reported as a disk read. Comments are not stripped: a specifier spelled in a
 * comment can only ADD a test to the selection, never remove one.
 *
 * @param {string} source
 * @returns {{ specifiers: string[], globsTheTree: boolean }}
 */
export function moduleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"\n]+)['"]/g,
    /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /\bvi\.(?:mock|doMock|unmock|importActual|importMock)\(\s*['"]([^'"\n]+)['"]/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) specifiers.add(m[1]);
  return { specifiers: [...specifiers], globsTheTree: /\bimport\.meta\.glob(?:Eager)?\s*\(/.test(source) };
}

/** A relative specifier resolved against the importer, as a repository-relative path, or null. */
export function resolveRelative(root, importerRel, specifier) {
  const base = path.join(root, path.dirname(importerRel), specifier);
  const candidates = [];
  for (const ext of RESOLVE_EXTENSIONS) candidates.push(base + ext);
  // TypeScript's ESM spelling: `./x.js` names `./x.ts`.
  const jsLike = base.match(/^(.*)\.(?:js|jsx|mjs|cjs)$/);
  if (jsLike) for (const ext of ['.ts', '.tsx', '.mts', '.cts']) candidates.push(jsLike[1] + ext);
  for (const ext of RESOLVE_EXTENSIONS.slice(1)) candidates.push(path.join(base, `index${ext}`));
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return toPosix(path.relative(root, c));
    } catch {
      // not this candidate
    }
  }
  return null;
}

/** The workspace package a bare specifier names (`@object-ui/x` or `@object-ui/x/sub`), or null. */
export function workspaceNameOf(specifier, names) {
  if (names.has(specifier)) return specifier;
  const parts = specifier.split('/');
  const head = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return names.has(head) ? head : null;
}

/** The library a bare specifier names, as `LIBRARY_DISK_READERS` lists them. */
const libraryOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

/**
 * Does `source` run a disk-reading library beyond its in-memory parts (item
 * 2d)? A type-only import runs nothing. A dynamic import, a `require`, or a
 * binding used other than as `ts.member` is a read: what it calls is not
 * spelled here.
 *
 * @param {string} rawSource
 */
export function libraryReadsDisk(rawSource) {
  // Comments only add specifiers, so a source naming no library anywhere is
  // answered before it is tokenised. A comment names a library nothing runs:
  // a JSDoc `{import('eslint').Rule}`, a CSS `@import 'tailwindcss'` in prose.
  if (!moduleSpecifiers(rawSource).specifiers.some((sp) => LIBRARY_DISK_READERS.has(libraryOf(sp)))) return false;
  const source = stripComments(rawSource);
  const libs = moduleSpecifiers(source).specifiers.filter((sp) => LIBRARY_DISK_READERS.has(libraryOf(sp)));
  if (libs.length === 0) return false;
  const importRe = /\bimport\s+(type\s+)?([^'";]*?)\s+from\s+['"]([^'"]+)['"]/g;
  const statics = new Set();
  for (const m of source.matchAll(importRe)) {
    const lib = libraryOf(m[3]);
    if (!LIBRARY_DISK_READERS.has(lib)) continue;
    statics.add(m[3]);
    if (m[1]) continue;
    const clause = m[2].trim();
    const named = (clause.match(/\{([^}]*)\}/)?.[1] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part && !part.startsWith('type '));
    const head = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    const binding = head.match(/^(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)$/)?.[1];
    if (head && !binding) return true;
    const inMemory = LIBRARY_IN_MEMORY.get(lib);
    if (inMemory) {
      if (binding || named.some((n) => !inMemory.has(n.split(/\s+as\s+/)[0]))) return true;
      continue;
    }
    if (lib !== 'typescript') return true;
    if (named.some((n) => !TS_IN_MEMORY.test(n.split(/\s+as\s+/)[0]))) return true;
    if (binding) {
      const body = source.replace(importRe, '');
      const uses = body.matchAll(new RegExp(`(?<![\\w$.])${binding.replace(/\$/g, '\\$')}(?![\\w$])(?:\\s*\\.\\s*([\\w$]+))?`, 'g'));
      for (const u of uses) if (!u[1] || !TS_IN_MEMORY.test(u[1])) return true;
    }
  }
  // A library reached without a static import -- `import('vite')`, `require`.
  return libs.some((sp) => !statics.has(sp));
}

/**
 * Is `rel` a `BENIGN_DISK_MODULES` entry whose disk imports are still exactly
 * the pinned ones?
 *
 * @param {string} rel
 * @param {string} source
 */
export function isBenignDiskModule(rel, source) {
  const pinned = BENIGN_DISK_MODULES[rel];
  if (!pinned) return false;
  const seen = {};
  for (const m of source.matchAll(/\bimport\s+([^'";]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    if (!DISK_SPECIFIERS.has(m[2])) continue;
    const braces = m[1].trim().match(/^\{([^}]*)\}$/);
    if (!braces) return false;
    seen[m[2]] = [...(seen[m[2]] ?? []), ...braces[1].split(',').map((x) => x.trim()).filter(Boolean)];
  }
  const { specifiers } = moduleSpecifiers(source);
  if (specifiers.some((sp) => DISK_SPECIFIERS.has(sp) && !(sp in pinned))) return false;
  return Object.entries(pinned).every(([sp, names]) => JSON.stringify([...(seen[sp] ?? [])].sort()) === JSON.stringify([...names].sort()))
    && Object.keys(seen).every((sp) => sp in pinned);
}

/**
 * Item 2b: the package directories a disk-reading module reads, or `null` when
 * any of its reads has a radius this selector cannot bound. Fail-closed: the
 * answer is `null` for a module outside every package, an unloaded walker, a
 * process spawn, an async or glob read, `fs-extra`, a library that reads the
 * disk itself (`LIBRARY_DISK_READERS`), `process.cwd()`, the module resolver, an `fs` import aliased or used other than as `fs.READ(...)`, a
 * directory walk from a root the walker cannot name, and any read whose
 * argument the walker could not read, could not name, or named outside a
 * workspace package of this tree (`node_modules` included).
 *
 * @param {{ rel: string, source: string, packages: Array<{ name: string, dir: string }>, prefix: string, walker: Function | null }} input
 *   `prefix` is the tree's own path under the workspace root (`ui/` nested,
 *   `''` standalone), the coordinate the walker names files in
 * @returns {Set<string> | null}
 */
export function readRadius({ rel, source, packages, prefix, walker }) {
  if (!walker) return null;
  const owner = owningPackage(rel, packages);
  if (!owner) return null;
  const { specifiers, globsTheTree } = moduleSpecifiers(source);
  if (globsTheTree) return null;
  if (specifiers.some((s) => DISK_SPECIFIERS.has(s) && s !== 'fs' && s !== 'node:fs')) return null;
  if (specifiers.some((s) => LIBRARY_DISK_READERS.has(libraryOf(s)))) {
    return null;
  }
  if (/\bprocess\.cwd\s*\(|\bcreateRequire\b|\brequire\.resolve\b|\brequire\(\s*['"](?:node:)?fs['"]/.test(source)) return null;

  // Every `fs` use must be a call the walker reads, or a write.
  const known = new Set([...BOUNDED_FS_READS, ...FS_NON_READS]);
  const importRe = /\bimport\s+([^'";]*?)\s+from\s+['"](?:node:)?fs['"]\s*;?/g;
  const bindings = [];
  const named = [];
  for (const m of source.matchAll(importRe)) {
    const clause = m[1].trim();
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
      for (const part of braces[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        if (/\bas\b/.test(part) || !known.has(part.replace(/^type\s+/, ''))) return null;
        if (!part.startsWith('type ')) named.push(part);
      }
    }
    const head = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    const ns = head.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) bindings.push(ns[1]);
    else if (/^[A-Za-z_$][\w$]*$/.test(head)) bindings.push(head);
    else if (head) return null;
  }
  const body = source.replace(importRe, '');
  for (const b of bindings) {
    const uses = [...body.matchAll(new RegExp(`(?<![\\w$.])${b.replace(/\$/g, '\\$')}(?![\\w$])(\\.([\\w$]+)\\s*\\()?`, 'g'))];
    if (uses.some((u) => !u[2] || !known.has(u[2]))) return null;
  }
  // A named binding passed or re-bound (`[x].map(readFileSync)`,
  // `const r = readFileSync`) reads where no call is spelled, so every use
  // must be a direct call, as the default binding's already must.
  for (const n of named) {
    const uses = [...body.matchAll(new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])(\\s*\\()?`, 'g'))];
    if (uses.some((u) => !u[1])) return null;
  }

  const hereDepth = path.posix.relative(owner.dir, path.posix.dirname(rel)).split('/').filter(Boolean).length;
  const scan = walker(source, hereDepth, `${prefix}${rel}`.split('/'), owner.name);
  if (!Array.isArray(scan?.reads) || scan.walkRoots.size > 0) return null;
  // The walker skips a read whose argument list it cannot balance; a count
  // below the calls spelled here is that, and it costs the attribution.
  const spelled = [...source.matchAll(new RegExp(`\\b(?:${BOUNDED_FS_READS.join('|')}|globSync)\\s*\\(`, 'g'))].length;
  if (scan.reads.length !== spelled) return null;
  const dirs = new Set();
  for (const { fn, info } of scan.reads) {
    if (fn === 'globSync' || !info || info.vendored || !info.segs) return null;
    const name = info.segs.join('/');
    if (!name.startsWith(prefix)) return null;
    const pkg = owningPackage(name.slice(prefix.length), packages);
    if (!pkg) return null;
    dirs.add(pkg.dir);
  }
  return dirs;
}

/**
 * The relative-import graph reachable from `seeds`, and for every node what
 * its WHOLE closure touches: the workspace packages it names, the package
 * directories (or the repository root, as `''`) its files sit in, whether
 * anything in it reads the disk with a radius `radiusOf` cannot bound
 * (`readsDisk`), and the package directories the bounded reads land in
 * (`readDirs`). Bare specifiers are not followed: a workspace
 * package is the package graph's business, and `node_modules` the lockfile's.
 *
 * One pass of Tarjan's strongly-connected components over the graph, then one
 * reverse-topological fold -- import cycles are ordinary here, and a closure
 * walked once per test file was measured in minutes on this tree.
 *
 * @param {string} root
 * @param {string[]} seeds  repository-relative files
 * @param {Set<string>} names  workspace package names
 * @param {(rel: string) => string} dirOf  the package directory a file sits in, or `''`
 * @param {(rel: string, source: string) => Set<string> | null} [radiusOf]  a disk-reading
 *   file's read radius, `null` when unbounded; absent, every disk read is unbounded
 * @returns {Map<string, { packageNames: Set<string>, dirs: Set<string>, readsDisk: boolean, readDirs: Set<string>, files: number }>}
 */
export function closureSummaries(root, seeds, names, dirOf, radiusOf = () => null) {
  /** @type {Map<string, { edges: string[], packageNames: Set<string>, readsDisk: boolean, readDirs: Set<string> }>} */
  const nodes = new Map();
  const resolved = new Map();
  const queue = [...new Set(seeds)];
  while (queue.length) {
    const rel = queue.pop();
    if (nodes.has(rel)) continue;
    let source = '';
    try {
      source = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      source = '';
    }
    const info = /\.(?:[cm]?[jt]sx?)$/.test(rel) ? moduleSpecifiers(source) : { specifiers: [], globsTheTree: false };
    const node = { edges: [], packageNames: new Set(), readsDisk: info.globsTheTree, readDirs: new Set() };
    let touchesDisk = info.globsTheTree;
    for (const spec of info.specifiers) {
      if (DISK_SPECIFIERS.has(spec)) {
        touchesDisk = true;
        continue;
      }
      if (spec.startsWith('.')) {
        const key = `${path.dirname(rel)}\0${spec}`;
        let target = resolved.get(key);
        if (target === undefined) {
          target = resolveRelative(root, rel, spec);
          resolved.set(key, target);
        }
        if (target && !target.split('/').includes('node_modules')) {
          node.edges.push(target);
          if (!nodes.has(target)) queue.push(target);
        }
        continue;
      }
      const name = workspaceNameOf(spec, names);
      if (name) node.packageNames.add(name);
    }
    // Item 2d: a library program reads the disk with or without `fs`.
    if (!touchesDisk && /\.(?:[cm]?[jt]sx?)$/.test(rel) && libraryReadsDisk(source)) touchesDisk = true;
    // Item 2c: a module whose disk use is pinned as no test input.
    if (touchesDisk && !node.readsDisk && isBenignDiskModule(rel, source)) touchesDisk = false;
    if (touchesDisk && !node.readsDisk) {
      const radius = radiusOf(rel, source);
      if (radius === null) node.readsDisk = true;
      else for (const d of radius) node.readDirs.add(d);
    }
    nodes.set(rel, node);
  }

  // Tarjan, iteratively (the graph is deep enough to overflow a recursive walk).
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const sccOf = new Map();
  /** @type {string[][]} */
  const sccs = [];
  for (const start of nodes.keys()) {
    if (idx.has(start)) continue;
    const work = [[start, 0]];
    idx.set(start, index);
    low.set(start, index);
    index++;
    stack.push(start);
    onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1];
      const [v, i] = frame;
      const edges = nodes.get(v).edges;
      if (i < edges.length) {
        frame[1]++;
        const w = edges[i];
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index);
          index++;
          stack.push(w);
          onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v), idx.get(w)));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(v)));
      }
      if (low.get(v) === idx.get(v)) {
        const members = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          sccOf.set(w, sccs.length);
          members.push(w);
        } while (w !== v);
        sccs.push(members);
      }
    }
  }

  // Tarjan emits components in reverse topological order: every component a
  // component points at has already been emitted, so one forward fold is exact.
  const sccSummary = [];
  for (let c = 0; c < sccs.length; c++) {
    const summary = { packageNames: new Set(), dirs: new Set(), readsDisk: false, readDirs: new Set(), files: 0 };
    for (const member of sccs[c]) {
      const node = nodes.get(member);
      summary.files++;
      summary.dirs.add(dirOf(member));
      if (node.readsDisk) summary.readsDisk = true;
      for (const d of node.readDirs) summary.readDirs.add(d);
      for (const n of node.packageNames) summary.packageNames.add(n);
      for (const e of node.edges) {
        const d = sccOf.get(e);
        if (d === c) continue;
        const child = sccSummary[d];
        if (child.readsDisk) summary.readsDisk = true;
        for (const d of child.readDirs) summary.readDirs.add(d);
        for (const n of child.packageNames) summary.packageNames.add(n);
        for (const x of child.dirs) summary.dirs.add(x);
        summary.files += child.files;
      }
    }
    sccSummary.push(summary);
  }
  const out = new Map();
  for (const rel of nodes.keys()) out.set(rel, sccSummary[sccOf.get(rel)]);
  return out;
}

/** Tracked files, repository-relative. */
export function trackedFiles(root = REPO_ROOT) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

/**
 * The files changed between the merge base of `base` and `head`, and `head`,
 * relative to `root` (`--relative`; scripts/workspace-root.mjs, "Paths handed to git").
 */
export function changedFiles(root, base, head = 'HEAD') {
  return execFileSync('git', ['diff', '--name-only', '--relative', '--no-renames', `${base}...${head}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean);
}

/**
 * The changed files OUTSIDE this tree, relative to the workspace root -- the
 * monorepo's own files when the tree is nested (`ui/` of objectstack), and
 * nothing standalone, where the tree is the whole repository. `changedFiles`
 * leaves them out by construction (`--relative`), so this is the second half
 * of the same diff: git runs at the workspace root with `--relative` again,
 * and the tree's own prefix is dropped from what it prints.
 */
export function changedOutsideTree(root, base, head = 'HEAD') {
  const prefix = nestedPrefix(root);
  if (!prefix) return [];
  return changedFiles(workspaceRoot(root), base, head).filter((f) => !f.startsWith(prefix));
}

/**
 * Why a change outside this tree reaches every test in it, one reason per
 * file that does (an empty list means none does). The tree's tests install
 * from the workspace root, so its install and toolchain inputs are this tree's
 * too, and they import the monorepo's own packages the tree depends on from
 * their built output (the CI job builds them first):
 *
 *   - a workspace-root file that is not documentation (the one lockfile, the
 *     workspace file, the root manifest, `turbo.json`, a root `tsconfig`), or
 *     anything under `patches/` -- the rule item 3 states for this tree's own
 *     root, applied to the root it installs from;
 *   - a file in a workspace package outside this tree that a package of this
 *     tree depends on (any dependency field), or that such a package depends
 *     on at run time (`dependencies`, `peerDependencies`,
 *     `optionalDependencies`; an outer package's devDependencies are its own
 *     test tooling, not its built output). On objectstack that is the seven
 *     packages the `ui_consumers` filter of `ci.yml` names. Which of this
 *     tree's tests read the changed export is not something the package graph
 *     can say, so every test runs.
 *
 * Every other path -- another package of the monorepo, its docs, scripts and
 * workflows -- reaches this tree's tests only through the always-on set, as a
 * file outside every package does inside it.
 *
 * @param {{ root?: string, outside: string[] }} input  `outside` relative to the workspace root
 * @returns {string[]}
 */
export function outsideTreeReasons({ root = REPO_ROOT, outside }) {
  if (outside.length === 0) return [];
  const prefix = nestedPrefix(root);
  const wsRoot = workspaceRoot(root);
  const own = new Set(listWorkspacePackages(root).map((p) => p.name));
  const globs = parseWorkspaceGlobs(fs.readFileSync(workspaceManifestPath(root), 'utf8')).filter(
    (g) => !g.startsWith(prefix) && `${g}/` !== prefix,
  );
  const outer = readManifests(wsRoot, globs).filter((m) => !own.has(m.name));
  const outerNames = new Set(outer.map((m) => m.name));
  const depsOf = (pkg, fields = DEPENDENCY_FIELDS) => fields.flatMap((field) => Object.keys(pkg[field] ?? {}));

  // The outer packages this tree reaches, each with the tree package that
  // reaches it first (named in the reason).
  const reachedBy = new Map();
  const queue = [];
  for (const m of readManifests(root, workspaceGlobs(root))) {
    for (const dep of depsOf(m.pkg)) {
      if (outerNames.has(dep) && !reachedBy.has(dep)) {
        reachedBy.set(dep, m.name);
        queue.push(dep);
      }
    }
  }
  const byName = new Map(outer.map((m) => [m.name, m]));
  while (queue.length) {
    const name = queue.shift();
    for (const dep of depsOf(byName.get(name).pkg, RUNTIME_DEPENDENCY_FIELDS)) {
      if (outerNames.has(dep) && !reachedBy.has(dep)) {
        reachedBy.set(dep, reachedBy.get(name));
        queue.push(dep);
      }
    }
  }

  const reasons = [];
  for (const rel of outside) {
    if (!rel.includes('/') && !ROOT_DOC_FILE.test(rel)) {
      reasons.push(`${rel}: a workspace-root file that is not documentation (install, toolchain or config input of this tree)`);
      continue;
    }
    if (rel.startsWith('patches/')) {
      reasons.push(`${rel}: a dependency patch changes what is installed for every test`);
      continue;
    }
    const owner = owningPackage(rel, outer);
    if (owner && reachedBy.has(owner.name)) {
      reasons.push(`${rel}: ${owner.name} changed, and this tree's tests read its built output (through ${reachedBy.get(owner.name)})`);
    }
  }
  return reasons;
}

/** The root vitest config and every `vitest.setup*` file beside it. */
export function rootTestConfigFiles(tracked) {
  return tracked.filter((f) => ROOT_TEST_CONFIG.includes(f) || /^vitest\.setup[^/]*\.[cm]?[jt]sx?$/.test(f)).sort();
}

/**
 * The `dom-heavy` project's setup file and test list, read out of the root
 * config text the way `scripts/unit-registry-collision.mjs` reads `domTsTests`.
 * Throws when the shape is not there: the caller's answer to "cannot read" is a
 * full run.
 *
 * @param {string} configText  `vitest.config.mts`
 * @returns {{ setupFile: string, tests: string[] }}
 */
export function readHeavyProject(configText) {
  const block = configText.match(
    /name: 'dom-heavy',[\s\S]*?setupFiles: \[path\.resolve\(__dirname, '([^']+)'\)\],[\s\S]*?include: \[\.\.\.heavyDomTests\]/,
  );
  if (!block) throw new Error("vitest.config.mts: cannot find the `dom-heavy` project's setupFiles and `include: [...heavyDomTests]`");
  const list = configText.match(/const heavyDomTests = \[([\s\S]*?)\n\];/);
  if (!list) throw new Error('vitest.config.mts: cannot find `const heavyDomTests = [...]`');
  const tests = list[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith("'") || l.startsWith('"'))
    .map((l) => l.replace(/^['"]/, '').replace(/['"],?$/, ''));
  if (tests.length === 0) throw new Error('vitest.config.mts: `heavyDomTests` read as empty -- a broken reader, not an empty project');
  return { setupFile: block[1], tests };
}

/**
 * The verdict for one change.
 *
 * @param {{ root?: string, changed: string[], outside?: string[], tracked?: string[], walker?: Function | null }} input
 *   `changed` relative to `root`; `outside` the changed files outside the tree,
 *   relative to the workspace root (`changedOutsideTree`)
 * @returns {{ mode: 'full', reasons: string[] } | { mode: 'affected', changedPackages: string[], affectedPackages: string[], heavyEdge: string[], alwaysOn: Array<{ file: string, why: string }>, attributed: Array<{ file: string, via: string[] }>, filters: string[], testFileCount: number, selectedTestFileCount: number }}
 */
export function selectAffectedTests({ root = REPO_ROOT, changed, outside = [], tracked = trackedFiles(root), walker = PATH_WALKER }) {
  const workspacePackages = listWorkspacePackages(root);
  // Item 2c: the owner directories join the graph as dependency-free packages.
  const packages = [
    ...workspacePackages,
    ...OWNER_DIRS.filter((d) => !workspacePackages.some((p) => p.dir === d)).map((d) => ({ name: ownerDirName(d), dir: d, deps: [] })),
  ];
  const names = new Set(packages.map((p) => p.name));
  const { dependencyClosure, dependentClosure } = packageClosures(packages);
  const dirOf = (rel) => owningPackage(rel, packages)?.dir ?? '';

  // What the root config and its setup files reach. Walked file by file
  // because the answer needed is the FILES, not a summary.
  const reach = (startFiles) => {
    const files = new Set();
    const pkgs = new Set();
    const queue = [...startFiles];
    while (queue.length) {
      const rel = queue.pop();
      if (files.has(rel)) continue;
      files.add(rel);
      let source = '';
      try {
        source = fs.readFileSync(path.join(root, rel), 'utf8');
      } catch {
        source = '';
      }
      for (const spec of moduleSpecifiers(source).specifiers) {
        if (spec.startsWith('.')) {
          const target = resolveRelative(root, rel, spec);
          if (target && !target.split('/').includes('node_modules')) queue.push(target);
          continue;
        }
        const name = workspaceNameOf(spec, names);
        if (name) pkgs.add(name);
      }
    }
    return { files, pkgs };
  };
  const configFiles = rootTestConfigFiles(tracked);
  const heavy = readHeavyProject(fs.readFileSync(path.join(root, ROOT_TEST_CONFIG[0]), 'utf8'));
  const configReach = new Set();
  const broadSetupPackages = new Set();
  const heavySetupPackages = reach([heavy.setupFile]).pkgs;
  for (const file of configFiles) {
    const r = reach([file]);
    // Against the workspace alone: a file the root config reaches is a
    // full-run trigger whether or not an owner directory holds it.
    for (const f of r.files) if (!owningPackage(f, workspacePackages)) configReach.add(f);
    // A setup file that loads the heavy one is part of the heavy family; the
    // root config names every package the setups do only through them.
    if (file === heavy.setupFile || r.files.has(heavy.setupFile) || ROOT_TEST_CONFIG.includes(file)) continue;
    for (const n of r.pkgs) broadSetupPackages.add(n);
  }
  // Configs other than the root one that load the heavy setup: their whole
  // directory takes the heavy edge (`apps/console`).
  const heavyConfigDirs = tracked
    .filter((f) => /(?:^|\/)vitest\.config\.[^/]+$/.test(f) && f.includes('/') && !ROOT_TEST_CONFIG.includes(f))
    .filter((f) => {
      try {
        return fs.readFileSync(path.join(root, f), 'utf8').includes(path.basename(heavy.setupFile));
      } catch {
        return false;
      }
    })
    .map((f) => `${path.posix.dirname(f)}/`);

  const reasons = outsideTreeReasons({ root, outside });
  const changedPackages = new Set();
  // The selector imports the walker at run time, an edge no test states.
  if (outside.includes(PATH_WALKER_FILE) && names.has(ownerDirName('scripts'))) changedPackages.add(ownerDirName('scripts'));
  for (const rel of changed) {
    const base = rel.split('/').pop() ?? rel;
    if (FULL_RUN_BASENAME.test(base)) {
      reasons.push(`${rel}: a ${base} change is a full-run trigger (vitest's forceRerunTriggers, plus tsconfig)`);
      continue;
    }
    if (configReach.has(rel)) {
      reasons.push(`${rel}: the root vitest config or a setup file imports it, so every test runs through it`);
      continue;
    }
    const owner = owningPackage(rel, packages);
    if (owner) {
      changedPackages.add(owner.name);
      continue;
    }
    if (!rel.includes('/') && !ROOT_DOC_FILE.test(rel)) {
      reasons.push(`${rel}: a repository-root file that is not documentation (install, toolchain or config input)`);
      continue;
    }
    if (rel.startsWith('patches/')) {
      reasons.push(`${rel}: a dependency patch changes what is installed for every test`);
      continue;
    }
    // Anything else outside a package and an owner directory -- docs,
    // workflows, skills -- reaches tests only through the always-on set below.
  }

  const affected = new Set(changedPackages);
  for (const name of changedPackages) for (const d of dependentClosure.get(name) ?? []) affected.add(d);
  for (const name of [...affected].sort()) {
    if (broadSetupPackages.has(name)) {
      reasons.push(`${name} is affected and a broad root vitest setup file imports it, so it reaches every test of that setup's project`);
    }
  }
  if (reasons.length > 0) return { mode: 'full', reasons };
  const heavyEdge = [...affected].filter((n) => heavySetupPackages.has(n)).sort();

  const testFiles = tracked.filter((f) => TEST_FILE.test(f) && !f.split('/').includes('node_modules'));
  const placed = testFiles.filter((f) => {
    const owner = owningPackage(f, packages);
    return owner && !affected.has(owner.name);
  });
  const prefix = nestedPrefix(root);
  const summaries = closureSummaries(root, placed, names, dirOf, (rel, source) =>
    readRadius({ rel, source, packages, prefix, walker }),
  );
  const nameOfDir = new Map(packages.map((p) => [p.dir, p.name]));
  const alwaysOn = [];
  /** @type {Array<{ file: string, via: string[] }>} */
  const attributed = [];
  for (const file of testFiles) {
    const owner = owningPackage(file, packages);
    if (!owner) {
      alwaysOn.push({ file, why: 'outside every workspace package' });
      continue;
    }
    if (affected.has(owner.name)) continue; // its directory is selected whole
    const closure = summaries.get(file);
    if (closure.readsDisk) {
      alwaysOn.push({ file, why: 'reads the disk or spawns a process' });
      continue;
    }
    if (closure.dirs.has('')) {
      alwaysOn.push({ file, why: `reaches the repository root outside ${owner.dir}` });
      continue;
    }
    // Item 2a: every edge past the owner's declared closure is an input
    // package; one of them affected selects the file.
    const allowed = dependencyClosure.get(owner.name) ?? new Set();
    const inputs = new Set([...closure.dirs, ...closure.readDirs].map((d) => nameOfDir.get(d)));
    for (const n of closure.packageNames) if (!allowed.has(n)) inputs.add(n);
    inputs.delete(owner.name);
    const via = [...inputs].filter((n) => affected.has(n)).sort();
    if (via.length > 0) attributed.push({ file, via });
  }

  const dirFilters = packages
    .filter((p) => affected.has(p.name) && testFiles.some((f) => f.startsWith(`${p.dir}/`)))
    .map((p) => `${p.dir}/`);
  const heavyFilters = heavyEdge.length > 0 ? [...heavy.tests.filter((t) => tracked.includes(t)), ...heavyConfigDirs] : [];
  const filters = dedupeFilters([
    ...dirFilters,
    ...heavyFilters,
    ...alwaysOn.map((a) => a.file),
    ...attributed.map((a) => a.file),
  ]);
  const selected = testFiles.filter((f) => filters.some((flt) => f.toLowerCase().includes(flt.toLowerCase())));

  return {
    mode: 'affected',
    changedPackages: [...changedPackages].sort(),
    affectedPackages: [...affected].sort(),
    heavyEdge,
    alwaysOn,
    attributed,
    filters,
    testFileCount: testFiles.length,
    selectedTestFileCount: selected.length,
  };
}

/**
 * Vitest matches each positional filter as a SUBSTRING of the test path and
 * takes the union, and `scripts/vitest-invocation-guard.mjs` refuses an argv in
 * which one filter contains another (objectui#7814) -- `a.test.ts` is inside
 * `a.test.tsx`. Keep the broader filter: it already matches the narrower one's
 * file, so dropping the narrower one selects nothing less.
 *
 * @param {string[]} filters
 */
export function dedupeFilters(filters) {
  const unique = [...new Set(filters)].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const kept = [];
  for (const f of unique) {
    if (!kept.some((k) => f.toLowerCase().includes(k.toLowerCase()))) kept.push(f);
  }
  return kept.sort();
}

function readFlag(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

function main(argv) {
  const base = readFlag(argv, '--base');
  const out = readFlag(argv, '--out');
  const explain = argv.includes('--explain');
  if (!base || (!out && !explain)) {
    console.error('usage: select-affected-tests.mjs --base <sha> (--out <file> | --explain)');
    return 2;
  }
  const changed = changedFiles(REPO_ROOT, base);
  const outside = changedOutsideTree(REPO_ROOT, base);
  console.log(`changed files against the merge base of ${base}: ${changed.length}`);
  if (nestedPrefix(REPO_ROOT)) console.log(`changed files outside ${nestedPrefix(REPO_ROOT)}: ${outside.length}`);
  const verdict = selectAffectedTests({ changed, outside });
  if (verdict.mode === 'full') {
    console.log('FULL RUN — this change reaches something every test runs through:');
    for (const r of verdict.reasons) console.log(`  - ${r}`);
    console.log('mode=full');
    return 0;
  }
  console.log(`changed packages: ${verdict.changedPackages.join(', ') || '(none)'}`);
  console.log(`affected packages (changed + dependents): ${verdict.affectedPackages.join(', ') || '(none)'}`);
  if (verdict.heavyEdge.length > 0) {
    console.log(`the heavy DOM setup imports affected ${verdict.heavyEdge.join(', ')}: its projects' test files are selected`);
  }
  console.log(`always-on test files (the package graph cannot place them): ${verdict.alwaysOn.length}`);
  if (explain) for (const a of verdict.alwaysOn) console.log(`  - ${a.file}: ${a.why}`);
  console.log(`attributed test files (an affected package they reach or import past their own): ${verdict.attributed.length}`);
  if (explain) for (const a of verdict.attributed) console.log(`  - ${a.file}: through ${a.via.join(', ')}`);
  console.log(
    `selected ${verdict.selectedTestFileCount} of ${verdict.testFileCount} tracked test files through ${verdict.filters.length} filter(s)`,
  );
  if (verdict.filters.length === 0) {
    // The always-on set is never empty on this tree; an empty selection is a
    // broken reader, and a broken reader must not turn into a green shard.
    console.error('::error::the affected selection is EMPTY — refusing to report a run that tests nothing');
    return 2;
  }
  if (out) fs.writeFileSync(out, `${verdict.filters.join('\n')}\n`);
  console.log('mode=affected');
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::select-affected-tests could not decide: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
