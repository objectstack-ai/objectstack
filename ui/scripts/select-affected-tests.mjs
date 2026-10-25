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
 * `merge-queue-reporting.test.ts` holds every in-job gate of that workflow to).
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
 *       - it lives outside every workspace package (`scripts/**`,
 *         `eslint-rules/**`): no package owns it, so no package change
 *         reaches it;
 *       - it, or a module it reaches through RELATIVE imports, reads the disk
 *         or spawns a process (`fs`, `child_process`, `import.meta.glob`):
 *         its input is the tree, and the tree is not a package;
 *       - it reaches, through relative imports, a file outside its own
 *         package directory: that edge is in no `package.json`;
 *       - it imports a workspace package by name that is not its own and not
 *         in its own package's dependency closure: the root vitest alias map
 *         resolves every `@object-ui/*` name to source whether or not the
 *         package declares it, so the edge is real at test time and absent
 *         from the graph.
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
 *         test, an edge no test file states.
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
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { parseWorkspaceGlobs, workspaceGlobs } from './workspace-root.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
 * Every workspace package: its name, its repository-relative directory and the
 * workspace packages it names in any dependency field.
 *
 * @param {string} root
 * @returns {Array<{ name: string, dir: string, deps: string[] }>}
 */
export function listWorkspacePackages(root = REPO_ROOT) {
  // Relative to `root` in both layouts: the objectui root's own file, or the
  // monorepo root's `ui/...` globs with the prefix stripped (objectstack#25723).
  const globs = workspaceGlobs(root);
  const dirs = [];
  for (const glob of globs) {
    if (glob.endsWith('/*')) {
      const parent = glob.slice(0, -2);
      const abs = path.join(root, parent);
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
    const file = path.join(root, dir, 'package.json');
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof pkg.name !== 'string') continue;
    manifests.push({ name: pkg.name, dir, pkg });
  }
  const names = new Set(manifests.map((m) => m.name));
  return manifests.map(({ name, dir, pkg }) => {
    const deps = new Set();
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
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

/**
 * The relative-import graph reachable from `seeds`, and for every node what
 * its WHOLE closure touches: the workspace packages it names, the package
 * directories (or the repository root, as `''`) its files sit in, and whether
 * anything in it reads the disk. Bare specifiers are not followed: a workspace
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
 * @returns {Map<string, { packageNames: Set<string>, dirs: Set<string>, readsDisk: boolean, files: number }>}
 */
export function closureSummaries(root, seeds, names, dirOf) {
  /** @type {Map<string, { edges: string[], packageNames: Set<string>, readsDisk: boolean }>} */
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
    const node = { edges: [], packageNames: new Set(), readsDisk: info.globsTheTree };
    for (const spec of info.specifiers) {
      if (DISK_SPECIFIERS.has(spec)) {
        node.readsDisk = true;
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
    const summary = { packageNames: new Set(), dirs: new Set(), readsDisk: false, files: 0 };
    for (const member of sccs[c]) {
      const node = nodes.get(member);
      summary.files++;
      summary.dirs.add(dirOf(member));
      if (node.readsDisk) summary.readsDisk = true;
      for (const n of node.packageNames) summary.packageNames.add(n);
      for (const e of node.edges) {
        const d = sccOf.get(e);
        if (d === c) continue;
        const child = sccSummary[d];
        if (child.readsDisk) summary.readsDisk = true;
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

/** The files changed between the merge base of `base` and `head`, and `head`. */
export function changedFiles(root, base, head = 'HEAD') {
  return execFileSync('git', ['diff', '--name-only', '--no-renames', `${base}...${head}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean);
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
 * @param {{ root?: string, changed: string[], tracked?: string[] }} input
 * @returns {{ mode: 'full', reasons: string[] } | { mode: 'affected', changedPackages: string[], affectedPackages: string[], heavyEdge: string[], alwaysOn: Array<{ file: string, why: string }>, filters: string[], testFileCount: number, selectedTestFileCount: number }}
 */
export function selectAffectedTests({ root = REPO_ROOT, changed, tracked = trackedFiles(root) }) {
  const packages = listWorkspacePackages(root);
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
    for (const f of r.files) if (!owningPackage(f, packages)) configReach.add(f);
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

  const reasons = [];
  const changedPackages = new Set();
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
    // Anything else outside a package -- `scripts/`, `eslint-rules/`, docs,
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
  const summaries = closureSummaries(root, placed, names, dirOf);
  const alwaysOn = [];
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
    const outside = [...closure.dirs].find((d) => d !== owner.dir);
    if (outside !== undefined) {
      alwaysOn.push({ file, why: `reaches ${outside === '' ? 'the repository root' : outside} outside ${owner.dir}` });
      continue;
    }
    const allowed = dependencyClosure.get(owner.name) ?? new Set();
    const undeclared = [...closure.packageNames].find((n) => n !== owner.name && !allowed.has(n));
    if (undeclared) {
      alwaysOn.push({ file, why: `imports ${undeclared}, which ${owner.name} does not depend on` });
    }
  }

  const dirFilters = packages
    .filter((p) => affected.has(p.name) && testFiles.some((f) => f.startsWith(`${p.dir}/`)))
    .map((p) => `${p.dir}/`);
  const heavyFilters = heavyEdge.length > 0 ? [...heavy.tests.filter((t) => tracked.includes(t)), ...heavyConfigDirs] : [];
  const filters = dedupeFilters([...dirFilters, ...heavyFilters, ...alwaysOn.map((a) => a.file)]);
  const selected = testFiles.filter((f) => filters.some((flt) => f.toLowerCase().includes(flt.toLowerCase())));

  return {
    mode: 'affected',
    changedPackages: [...changedPackages].sort(),
    affectedPackages: [...affected].sort(),
    heavyEdge,
    alwaysOn,
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
  console.log(`changed files against the merge base of ${base}: ${changed.length}`);
  const verdict = selectAffectedTests({ changed });
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
