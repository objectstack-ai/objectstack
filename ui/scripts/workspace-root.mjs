// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * workspace-root -- the ONE answer to "where are the pnpm workspace's files?"
 *
 *   import { workspaceGlobs, lockfilePath, rootManifest } from '../scripts/workspace-root.mjs';
 *   for (const glob of workspaceGlobs()) ...          // relative to uiRoot(), in both layouts
 *   const lock = readFileSync(lockfilePath(), 'utf8');
 *
 * ## Why a second helper beside `ui-root.mjs`
 *
 * `ui-root.mjs` answers "where is the objectui TREE" from its own location, and
 * that answer is the same standalone and under the objectstack monorepo's `ui/`
 * (objectstack ruling D1). Four files are NOT at that root in both layouts: the
 * import deletes or moves them, because a nested pnpm workspace root is ignored
 * and a nested `turbo.json` must `extends` the root.
 *
 *   - `pnpm-workspace.yaml`  deleted; the parent's declares `ui`, `ui/packages/*`, ...
 *   - `pnpm-lock.yaml`       deleted; one lockfile at the git root
 *   - the root `package.json`'s `pnpm` block (overrides, patchedDependencies)
 *                            moved to the workspace root's manifest and
 *                            workspace file
 *   - `turbo.json`           parked as `turbo.objectui.json`; the parent's
 *                            carries objectui's tasks with their repo-root
 *                            inputs re-rooted to `$TURBO_ROOT$/ui/...`
 *
 * Every reader that joined `uiRoot()` with one of those names was the first red
 * in the merged tree's CI (objectstack#25723). This module is where that join
 * now happens, once, with one rule.
 *
 * ## The rule
 *
 *   (a) `workspaceRoot()` is `uiRoot()` when `<uiRoot>/pnpm-workspace.yaml`
 *       exists; else the PARENT directory when THAT holds one; else it throws.
 *       The objectui root is preferred so a deleted file in the standalone
 *       layout is a loud error, never a silent read of some other workspace.
 *   (b) `workspaceGlobs()` are the `packages:` globs of that file. When the root
 *       is the parent, only the globs under the objectui tree's own directory
 *       name (`ui/` in the monorepo) are returned, with that prefix stripped;
 *       the bare `ui` entry is the objectui root itself and is dropped. So the
 *       globs are relative to `uiRoot()` in both layouts.
 *   (c) `lockfilePath()` and `rootManifestPath()` / `rootManifest()` follow the
 *       same root, and so does `virtualStorePath()`, pnpm's `node_modules/.pnpm`:
 *       under the monorepo `<uiRoot>/node_modules` holds only the symlinks of
 *       the objectui root package's own declared dependencies, and the store
 *       every installed copy lives in is the workspace root's (objectstack#25733).
 *   (d) `turboConfigPath()` is the nearest `turbo.json` upward (what turbo
 *       hashes from); `uiTurboConfigPath()` is objectui's OWN task declaration,
 *       `turbo.json` at `uiRoot()` or the parked `turbo.objectui.json`; and
 *       `uiScopedTurboConfig()` is the nearest config narrowed to the objectui
 *       subset (`$TURBO_ROOT$/ui/x` read as `$TURBO_ROOT$/x`, the rest dropped).
 *
 * Every function takes an optional explicit root for fixtures: a test that
 * writes its own `pnpm-workspace.yaml` into a scratch directory is a workspace
 * root by rule (a).
 *
 * Standalone, every answer here is exactly the path or list the readers
 * computed before: the file is at the objectui root, so rule (a) picks it and
 * rule (b) returns the globs verbatim.
 *
 * ## Paths handed to git: git's own cwd-relative forms (objectstack#25728)
 *
 * The second half of the same class. Standalone, the git repository root IS
 * the objectui tree; under the monorepo it is the OBJECTSTACK root, one level
 * up, and git reads some paths against that root whatever `cwd` the script
 * spawns it with. `git show <ref>:packages/x` then asks for a file that sits
 * at `ui/packages/x`, and `git diff --name-only` answers `ui/packages/x` to a
 * reader that matches `packages/...`. The one idiom, for every script:
 *
 *   - git runs with `cwd` at the tree it judges -- `uiRoot()`, or the
 *     repository under test when a gate is driven against a scratch repo;
 *   - a path INTO a revision is `revPath(ref, path)`, i.e. `<ref>:./<path>`:
 *     git resolves `./` against the cwd, so the same spelling names the same
 *     file in both layouts (and in a scratch repo, where `./` is the root);
 *   - a path listing OUT of `diff` / `diff-tree` / `log` / `show`
 *     (`--name-only`, `--name-status`, `--numstat`, `--stat`, `--raw`) carries
 *     `--relative`, so git prints paths from the cwd and leaves out the
 *     monorepo's own files;
 *   - `ls-files`, `ls-tree`, `grep` and a pathspec after `--` are already
 *     cwd-relative, so they never carry `--full-name` / `--full-tree`.
 *
 * Standalone every one of these is a no-op (the cwd is the repository root),
 * so a reader's answer there is the one it computed before. Calls that hand git
 * no path (`rev-parse`, `merge-base`, `cat-file -e <sha>`) need nothing.
 * `nestedPrefix()` below is the WORKSPACE answer and is not used for git: git
 * already knows where the cwd sits, and a scratch repo has no workspace.
 * `pnpm check:ui-root-lookups` refuses the root-relative spellings so the class
 * does not grow back; its header names the shapes and the bound.
 *
 * ## The one parser
 *
 * Three scripts carried their own `packages:` parser; `parseWorkspaceGlobs` is
 * their union of refusals: no `packages:` key, an entry it cannot read, a glob
 * shape other than `dir` or `dir/*` (so `**`, a mid-path `*`, a negation), and
 * an empty list all THROW. A reader that silently skipped part of the workspace
 * would go on reporting success over a shrinking surface.
 *
 * ⛔ Node builtins only: `check-lockfile-dedupe.mjs` and
 * `check-lockfile-integrity.mjs` import this before `pnpm install`
 * (`scripts/check-pre-install-import-graph.mjs` holds that property).
 *
 * `pnpm check:ui-root-lookups` allowlists this file's `existsSync` of the
 * marker: it is one probe at a KNOWN root and one at its parent, anchored on
 * `ui-root.mjs`, never a walk and never a search from the cwd.
 */

import fs from 'node:fs';
import path from 'node:path';

import { uiRoot } from './ui-root.mjs';

export const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml';
export const LOCKFILE = 'pnpm-lock.yaml';
export const ROOT_MANIFEST = 'package.json';
export const TURBO_CONFIG = 'turbo.json';
/** Where the cutover parks objectui's own `turbo.json` (a nested one must `extends` the root). */
export const PARKED_TURBO_CONFIG = 'turbo.objectui.json';
export const TURBO_ROOT_PREFIX = '$TURBO_ROOT$/';
/** pnpm's virtual store directory, inside the workspace root's `node_modules`. */
export const VIRTUAL_STORE = '.pnpm';

/**
 * The directory whose `pnpm-workspace.yaml` governs the objectui tree: `root`
 * itself when it holds one, else its parent when that does, else a throw.
 *
 * @param {string} [root] the objectui tree (default `uiRoot()`), or a fixture root
 * @returns {string} absolute, no trailing separator
 */
export function workspaceRoot(root = uiRoot()) {
  const own = path.resolve(root);
  if (fs.existsSync(path.join(own, WORKSPACE_MANIFEST))) return own;
  const parent = path.dirname(own);
  if (parent !== own && fs.existsSync(path.join(parent, WORKSPACE_MANIFEST))) return parent;
  throw new Error(
    `no ${WORKSPACE_MANIFEST} at ${own} or at ${parent}: the objectui tree is neither a pnpm workspace root ` +
      'nor nested one level below one (objectstack#25723).',
  );
}

/**
 * Whether the workspace root is the PARENT of the objectui tree -- the merged
 * layout, where the tree is `ui/` of the objectstack monorepo.
 *
 * @param {string} [root]
 * @returns {boolean}
 */
export function isNestedWorkspace(root = uiRoot()) {
  return workspaceRoot(root) !== path.resolve(root);
}

/**
 * The directory-name prefix the parent's globs carry for this tree (`ui/` in
 * the monorepo), or `''` when the tree is its own workspace root.
 *
 * @param {string} [root]
 * @returns {string}
 */
export function nestedPrefix(root = uiRoot()) {
  return isNestedWorkspace(root) ? `${path.basename(path.resolve(root))}/` : '';
}

/**
 * `<ref>:./<path>` -- a file at a revision, named relative to the cwd git runs
 * in rather than to the repository root (see "Paths handed to git" above).
 *
 * @param {string} ref a revision (`HEAD`, a sha, `origin/main`)
 * @param {string} file POSIX path relative to the tree git runs in
 * @returns {string}
 */
export function revPath(ref, file) {
  return `${ref}:./${file.replace(/^(?:\.\/)+/, '')}`;
}

/** @param {string} [root] @returns {string} absolute path of the governing `pnpm-workspace.yaml`. */
export function workspaceManifestPath(root = uiRoot()) {
  return path.join(workspaceRoot(root), WORKSPACE_MANIFEST);
}

/** @param {string} [root] @returns {string} absolute path of the one `pnpm-lock.yaml`. */
export function lockfilePath(root = uiRoot()) {
  return path.join(workspaceRoot(root), LOCKFILE);
}

/**
 * The manifest at the workspace root: standalone the one whose `pnpm` block
 * declares the `@objectstack/*` pin overrides and `patchedDependencies`. ⚠️ In
 * the monorepo pnpm 10 reads `overrides` and `patchedDependencies` from the
 * workspace file's own `overrides:` / `patchedDependencies:` keys, so that
 * manifest's `pnpm` block may hold neither; a reader that needs the resolved
 * overrides reads the file at `workspaceManifestPath()` as well.
 *
 * @param {string} [root]
 * @returns {string}
 */
export function rootManifestPath(root = uiRoot()) {
  return path.join(workspaceRoot(root), ROOT_MANIFEST);
}

/**
 * @param {string} [root]
 * @returns {{ name?: string, pnpm?: { overrides?: Record<string, string>, patchedDependencies?: Record<string, string> } } & Record<string, unknown>}
 */
export function rootManifest(root = uiRoot()) {
  return JSON.parse(fs.readFileSync(rootManifestPath(root), 'utf8'));
}

/**
 * pnpm's virtual store at the workspace root: one directory per installed
 * (package, version, peer-set), named with `/` spelled `+`. A reader asking
 * "is this package installed ANYWHERE in the workspace" looks here; the
 * objectui root's own `node_modules` answers only for what its manifest
 * declares, and in the monorepo it has no `.pnpm` at all.
 *
 * @param {string} [root]
 * @returns {string}
 */
export function virtualStorePath(root = uiRoot()) {
  return path.join(workspaceRoot(root), 'node_modules', VIRTUAL_STORE);
}

/**
 * The `packages:` globs of a `pnpm-workspace.yaml`, read as text (a flat list of
 * scalars under one key; the gates in this repository read their inputs as text
 * by convention). Comments are stripped, quotes are optional, and the block
 * ends at the next column-0 key.
 *
 * Refuses (throws) rather than guesses: a file with no `packages:` key, an entry
 * the item regex cannot read, a glob that is not `dir` or `dir/*` (a nested
 * `a/b/*` is still `dir/*`; `**`, a mid-path `*`, `?`, braces and `!` are not),
 * and a list that came out empty.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseWorkspaceGlobs(text) {
  const globs = [];
  let inPackages = false;
  let sawKey = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    if (/^\S/.test(line)) {
      inPackages = /^packages:\s*$/.test(line);
      if (inPackages) sawKey = true;
      continue;
    }
    if (!inPackages) continue;
    const m = line.match(/^\s*-\s*(?:'([^']*)'|"([^"]*)"|(\S+))\s*$/);
    const glob = m ? (m[1] ?? m[2] ?? m[3]) : null;
    if (!glob) throw new Error(`${WORKSPACE_MANIFEST}: cannot read the packages entry ${JSON.stringify(raw)}`);
    if (!/^[A-Za-z0-9._@-]+(?:\/[A-Za-z0-9._@-]+)*(?:\/\*)?$/.test(glob)) {
      throw new Error(`${WORKSPACE_MANIFEST}: the packages glob ${JSON.stringify(glob)} is a shape this reader does not know`);
    }
    globs.push(glob);
  }
  if (!sawKey) throw new Error(`${WORKSPACE_MANIFEST} declares no packages globs: it has no top-level \`packages:\` key.`);
  if (globs.length === 0) throw new Error(`${WORKSPACE_MANIFEST} declares no packages globs`);
  return globs;
}

/**
 * The workspace globs that describe THIS tree, relative to `root` in both
 * layouts: the file's globs verbatim when `root` is the workspace root; when
 * the parent is, only the globs under this tree's directory name with that
 * prefix stripped (the bare directory entry, the tree itself, is dropped).
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function workspaceGlobs(root = uiRoot()) {
  const globs = parseWorkspaceGlobs(fs.readFileSync(workspaceManifestPath(root), 'utf8'));
  const prefix = nestedPrefix(root);
  if (!prefix) return globs;
  const own = globs.filter((g) => g.startsWith(prefix)).map((g) => g.slice(prefix.length));
  if (own.length === 0) {
    throw new Error(`${workspaceManifestPath(root)} declares no packages glob under ${prefix}, so it does not describe ${path.resolve(root)}`);
  }
  return own;
}

/**
 * The nearest `turbo.json` upward from `root` -- the file turbo itself hashes
 * from: at `root`, else at its parent, else a throw.
 *
 * @param {string} [root]
 * @returns {string}
 */
export function turboConfigPath(root = uiRoot()) {
  const own = path.resolve(root);
  if (fs.existsSync(path.join(own, TURBO_CONFIG))) return path.join(own, TURBO_CONFIG);
  const parent = path.dirname(own);
  if (parent !== own && fs.existsSync(path.join(parent, TURBO_CONFIG))) return path.join(parent, TURBO_CONFIG);
  throw new Error(`no ${TURBO_CONFIG} at ${own} or at ${parent} (objectstack#25723).`);
}

/**
 * objectui's OWN task declaration, for a test that pins objectui's task shapes
 * (`$TURBO_ROOT$` inputs relative to the objectui tree, `//#` root tasks of its
 * own manifest): `turbo.json` at `root`, else the parked `turbo.objectui.json`,
 * else a throw.
 *
 * @param {string} [root]
 * @returns {string}
 */
export function uiTurboConfigPath(root = uiRoot()) {
  const own = path.resolve(root);
  for (const name of [TURBO_CONFIG, PARKED_TURBO_CONFIG]) {
    const file = path.join(own, name);
    if (fs.existsSync(file)) return file;
  }
  throw new Error(`neither ${TURBO_CONFIG} nor ${PARKED_TURBO_CONFIG} at ${own} (objectstack#25723).`);
}

/**
 * A turbo config narrowed to one nested tree: every `$TURBO_ROOT$/<prefix>x`
 * input becomes `$TURBO_ROOT$/x`, every other `$TURBO_ROOT$/...` input (the
 * monorepo's own files) is dropped, and `globalDependencies` are filtered the
 * same way. Package-relative inputs and `dependsOn` are untouched. With an
 * empty prefix the config comes back as it was.
 *
 * @template {{ globalDependencies?: string[], tasks?: Record<string, { inputs?: string[] }> }} T
 * @param {T} config
 * @param {string} prefix `ui/` or `''`
 * @returns {T}
 */
export function narrowTurboConfig(config, prefix) {
  if (!prefix) return config;
  const keep = (entry, anchor) => {
    if (!entry.startsWith(anchor)) return entry;
    const rel = entry.slice(anchor.length);
    return rel.startsWith(prefix) ? `${anchor}${rel.slice(prefix.length)}` : null;
  };
  const narrowed = { ...config };
  if (Array.isArray(config.globalDependencies)) {
    narrowed.globalDependencies = config.globalDependencies.map((g) => keep(g, '')).filter((g) => g !== null);
  }
  if (config.tasks) {
    narrowed.tasks = {};
    for (const [name, def] of Object.entries(config.tasks)) {
      narrowed.tasks[name] = Array.isArray(def?.inputs)
        ? { ...def, inputs: def.inputs.map((i) => keep(i, TURBO_ROOT_PREFIX)).filter((i) => i !== null) }
        : def;
    }
  }
  return narrowed;
}

/**
 * The nearest `turbo.json`, parsed, narrowed to this tree's subset when it is
 * the parent's (see `narrowTurboConfig`). Standalone this is `<root>/turbo.json`
 * verbatim.
 *
 * @param {string} [root]
 * @returns {{ globalDependencies?: string[], tasks: Record<string, { inputs?: string[], dependsOn?: string[], cache?: boolean, env?: string[] }> }}
 */
export function uiScopedTurboConfig(root = uiRoot()) {
  const file = turboConfigPath(root);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const nested = path.dirname(file) !== path.resolve(root);
  return narrowTurboConfig(config, nested ? `${path.basename(path.resolve(root))}/` : '');
}
