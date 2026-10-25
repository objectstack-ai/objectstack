#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-ui-root-lookups -- a repo-root lookup by MARKER belongs to
 * `scripts/ui-root.mjs` alone.
 *
 *   node scripts/check-ui-root-lookups.mjs             # scan the tree (`pnpm check:ui-root-lookups`)
 *   node scripts/check-ui-root-lookups.mjs --list      # every hit, allowed or not, with its shape
 *   node scripts/check-ui-root-lookups.mjs --json
 *   node scripts/check-ui-root-lookups.mjs --self-test # the detector's own cases, no tree scan
 *
 * Exit: 0 = no lookup outside the helper and the allowlist is live
 *       1 = a lookup outside the helper, or an allowlist entry that matches
 *           nothing any more (stale), or the scan found no files at all
 *
 * ## The class (objectstack ruling D1: objectui becomes `ui/` of the monorepo)
 *
 * Standalone, "the directory that holds `.git`" and "the directory that holds
 * `pnpm-workspace.yaml`" and "`git rev-parse --show-toplevel`" all name the
 * objectui root. Inside the monorepo every one of them names the OBJECTSTACK
 * root, one level up, and the nested `pnpm-workspace.yaml` is gone because a
 * nested workspace root is ignored. A test that joins that answer with
 * `packages/core/...` then reads a path that does not exist. Measured on the
 * merge spike: one such test already failed, and 71 files carried one of the
 * spellings. `scripts/ui-root.mjs` resolves the root from its own location,
 * which is true in both layouts; this gate keeps the marker lookups from
 * growing back once they are migrated.
 *
 * ## What is a LOOKUP, and what is not
 *
 * The gate judges the call target, not the spelling, so the marker's name in a
 * string is not by itself a finding:
 *
 *   - FIRES  an existence probe (`existsSync`, `statSync`, `lstatSync`,
 *            `accessSync`) whose path names `.git` or `pnpm-workspace.yaml`,
 *            directly or through a `const` bound earlier in the file;
 *   - FIRES  a `git rev-parse --show-toplevel` / `--git-common-dir` argument;
 *   - FIRES  an import of `find-up` or a call of `findUp(...)`;
 *   - FIRES  a `readFileSync` (or any probe above) of a marker INSIDE A LOOP
 *            whose body steps a directory upward -- `dir = dirname(dir)`,
 *            `dir = resolve(dir, '..')`: the read is the walk's existence test
 *            with `try/catch` for the probe. This shape escaped the first
 *            migration (objectstack#25685) and found the objectstack root from
 *            five e2e specs on the merged tree (objectstack#25723);
 *   - SILENT a `readFileSync` of `pnpm-workspace.yaml` outside such a loop,
 *            from a root that is NOT the objectui tree (a fixture, a root
 *            handed in): that reads the workspace's package globs as DATA from
 *            a root already known -- `scripts/workspace-root.mjs` is where that
 *            root is decided. Joined to the objectui tree itself it is the
 *            next section's finding;
 *   - SILENT a `.git` entry in a directory skip-list, a fixture that WRITES a
 *            `pnpm-workspace.yaml`, and any mention inside a comment.
 *
 * ## Paths handed to git (objectstack#25728)
 *
 * The same move one level down: git reads some paths against the REPOSITORY
 * root, whatever cwd it runs in, and under the monorepo that root is one level
 * above the objectui tree. `scripts/workspace-root.mjs` ("Paths handed to
 * git") writes down the one idiom -- git's own cwd-relative forms -- and this
 * gate refuses the root-relative spellings it replaced. An argument list is a
 * git argv when it is an array literal whose first element (after `-C <dir>` /
 * `-c <k=v>` pairs) is a git subcommand string, the string arguments of a call
 * whose callee is named `git...`, or a string command that starts `git `:
 *
 *   - FIRES  `git-rev-path`: a `show` / `cat-file` argv, or the call that
 *            spawns one (so a `cat-file --batch` `input:` is in reach), holding
 *            a `<ref>:<path>` string or template whose path part does not start
 *            with `./` -- `${ref}:${file}`, `HEAD:packages/x`. Spell it
 *            `revPath(ref, file)`;
 *   - FIRES  `git-root-listing`: a `diff` / `diff-tree` / `diff-index` /
 *            `log` / `show` / `whatchanged` argv with a path-listing flag
 *            (`--name-only`, `--name-status`, `--numstat`, `--stat`, `--raw`,
 *            `--summary`) and no `--relative`; an `ls-files` / `ls-tree` /
 *            `grep` argv with `--full-name` or `--full-tree`;
 *   - SILENT `revPath(...)`, `<ref>:./<path>`, a `<sha>^{commit}` probe, a
 *            pathspec after `--`, `ls-files` / `ls-tree` / `grep` without
 *            those flags, and a flag string that only starts with `-`.
 *
 * ⚠️ The bound, said per AGENTS.md #9: the detector reads argv it can SEE.
 * An argv assembled across statements from names alone, a `<ref>:<path>`
 * string built outside the spawning call and handed in by name, a `diff` whose
 * PATCH headers (`+++ b/<path>`) are parsed for paths, `status --porcelain`
 * (root-relative by design, and read here only as "is the tree clean"), and
 * git run with a cwd other than the tree (so `./` resolves elsewhere) are out
 * of its reach; the idiom in `scripts/workspace-root.mjs` is the rule, this is
 * its tripwire.
 *
 * ## The workspace's own files, joined to the objectui tree (objectstack#25733)
 *
 * Standalone the objectui tree IS the pnpm workspace root; under the monorepo
 * the workspace root is one level up, and two of its files are only there:
 * `pnpm-workspace.yaml`, and pnpm's virtual store `node_modules/.pnpm` (the
 * tree's own `node_modules` holds only the symlinks of its manifest's
 * dependencies). `scripts/workspace-root.mjs` answers where they are
 * (`workspaceManifestPath()`, `virtualStorePath()`):
 *
 *   - FIRES  `workspace-file-at-ui-root`: a `join` / `resolve` call, or a
 *            template led by a substitution, whose path names
 *            `pnpm-workspace.yaml` or `node_modules/.pnpm` directly below the
 *            OBJECTUI TREE -- a root derived from `uiRoot()`, `UI_ROOT`, or
 *            this file's own location (`import.meta.url`, `__dirname`,
 *            `import.meta.dirname`) stepped back up to the tree with
 *            `dirname` / `..`, through `const` bindings and parameter
 *            defaults (never a `let`, which a walk reassigns). Judged where the path first names the file, so a join
 *            built on that join is not a second finding;
 *   - SILENT the same files under a root the detector cannot derive (a
 *            fixture directory, a parameter with no default, the cwd), under
 *            `workspaceRoot()` / `virtualStorePath()` themselves, a climb that
 *            stops above or below the tree, a module-id STRING that merely
 *            contains `/node_modules/.pnpm/`, and every other `node_modules`
 *            path under the tree: `<tree>/node_modules/<name>` is the tree's
 *            own declared dependency, present in both layouts.
 *
 * ⚠️ The bound, said per AGENTS.md #9: a root this detector cannot derive is
 * out of its reach, and so is the half of the class that is not a path: a
 * test that TREATS the tree as the workspace root (passes it as the cwd of a
 * workspace-root predicate, or reads a sibling directory as the framework's)
 * joins nothing. Those are held by their own fixture-layout tests.
 *
 * ## The allowlist is a ledger, not a bypass
 *
 * Every entry names a file and the reason its probe is not a repo-root lookup
 * (a CLI asking whether the USER's cwd is a workspace; the pin script, which
 * the merge deletes; `scripts/workspace-root.mjs`, whose two probes are
 * anchored on `uiRoot()` and decide the WORKSPACE root once for every reader;
 * the governed-surface guard, whose subject is the repository's own root).
 * An entry whose file no longer carries a hit is STALE and reds the run, so the
 * list can only shrink without being tended.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

import { isEntrypoint } from './invoked-as.mjs';
import { uiRoot } from './ui-root.mjs';

/** The one file that may look the root up -- it does not, but it is where a lookup would belong. */
export const HELPER = 'scripts/ui-root.mjs';
/** This gate names every spelling it hunts, so it is the one other file the scan skips. */
export const SELF = 'scripts/check-ui-root-lookups.mjs';

/** Directories scanned, relative to the objectui root. */
export const SCAN_ROOTS = ['scripts', 'packages', 'apps'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.vite', '.cache']);
const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js']);

/** Markers whose EXISTENCE is what a root walk probes for -- as a whole literal or as a path's last segment. */
export const MARKERS = new Set(['.git', 'pnpm-workspace.yaml']);
const MARKER_SEGMENT = /(^|[\\/])(\.git|pnpm-workspace\.yaml)$/;
const namesMarkerText = (text) => MARKERS.has(text) || MARKER_SEGMENT.test(text);
const PROBES = new Set(['existsSync', 'statSync', 'lstatSync', 'accessSync']);
/** Reads that double as a probe when they sit in an upward walk (`try { readFileSync(marker) } catch { dir = dirname(dir) }`). */
const READS = new Set(['readFileSync', 'readdirSync', 'openSync']);
/** The calls a walk steps a directory upward with. */
const UPWARD_STEPS = new Set(['dirname']);
const PATH_COMBINERS = new Set(['join', 'resolve']);
const GIT_ROOT_FLAGS = new Set(['--show-toplevel', '--git-common-dir']);

/** Every git subcommand this gate reads an argv for; a list whose head is not one of these is not a git argv. */
const GIT_SUBCOMMANDS = new Set(['show', 'cat-file', 'diff', 'diff-tree', 'diff-index', 'log', 'whatchanged', 'ls-files', 'ls-tree', 'grep']);
/** Subcommands whose `<ref>:<path>` argument git resolves from the REPOSITORY root unless the path starts with `./`. */
const REV_PATH_SUBCOMMANDS = new Set(['show', 'cat-file']);
/** Subcommands whose path listings are repository-root-relative unless `--relative`. */
const DIFF_SUBCOMMANDS = new Set(['diff', 'diff-tree', 'diff-index', 'log', 'show', 'whatchanged']);
const PATH_LISTING_FLAG = /^--(?:name-only|name-status|numstat|stat|raw|summary)(?:=|$)/;
/** Subcommands that answer from the cwd unless told to answer from the root. */
const CWD_LISTING_SUBCOMMANDS = new Set(['ls-files', 'ls-tree', 'grep']);
const FULL_PATH_FLAGS = new Set(['--full-name', '--full-tree']);
/** Placeholder for a template substitution when a template is read as a shape. */
const HOLE = '\u0001';
/**
 * `<ref>:<path>` with something before the colon and a path after it that does
 * not start with `./`. A leading `-` is a flag (`--format=%H:%s`); a leading
 * `:` is pathspec magic (`:(glob)x`), not a revision.
 */
const ROOT_REV_PATH = /^[^\s:\-][^\s:]*:(?!\.\/)[^\s]/;

/**
 * The workspace's own files, as path segments below the directory that holds
 * them: they sit at the WORKSPACE root, which under the monorepo is one level
 * above the objectui tree (objectstack#25733). `scripts/workspace-root.mjs`
 * answers where (`workspaceManifestPath()`, `virtualStorePath()`).
 */
const WORKSPACE_ROOT_FILES = [['pnpm-workspace.yaml'], ['node_modules', '.pnpm']];
/** A path segment the detector cannot read statically (a name, a call). */
const DYNAMIC = '\u0002';

/**
 * Files that carry a probe this gate recognises and that is NOT a repo-root
 * lookup. Path → reason. A path listed here that carries no hit is stale.
 */
export const ALLOWLIST = new Map([
  [
    'scripts/workspace-root.mjs',
    "decides the WORKSPACE root for every reader of pnpm-workspace.yaml / pnpm-lock.yaml / the root manifest / the .pnpm store: one probe at `uiRoot()` and one at its parent, anchored on ui-root.mjs -- never a walk, never the cwd (objectstack#25723, objectstack#25733)",
  ],
  [
    'scripts/objectstack-pin.mjs',
    'packs the pin from an objectstack tree and refuses one with no pnpm-workspace.yaml -- a probe of THAT tree, not of this root; the file itself is deleted at cutover',
  ],
  [
    'scripts/check-new-cross-file-line-citations.mjs',
    "the gate's subject is the REPOSITORY AT THE CWD (its self-test drives it against a scratch repository), so `gateRoot()` reads the toplevel and narrows to `uiRoot()` only when the objectui tree lies inside it -- a probe of THAT repository, not a lookup of this root",
  ],
  [
    'scripts/check-governed-queue-guard.mjs',
    "its subject is the REPOSITORY's governed surfaces (`AGENTS.md`, `.github/workflows/**`, ... at the git root), so its `diff-tree --name-only` reads root-relative paths on purpose; under the monorepo the governed register is objectstack's own (objectstack#25712)",
  ],
  ['packages/cli/src/utils/workspace-vite.ts', "asks whether the USER's cwd is a pnpm workspace before reading its globs -- product behaviour, not a repo-root lookup"],
  ['packages/cli/src/__tests__/app-generator.test.ts', 'mirrors the generator\'s own cwd predicate to compute the expected scaffold shape'],
]);

// Cheap pre-filter: a file that spells none of these cannot carry a hit. It is
// a SPEED filter only; every file that mentions one is parsed in full.
const PREFILTER = /\.git['"`]|pnpm-workspace\.yaml|\.pnpm|--show-toplevel|--git-common-dir|find-up|findUp|['"`](?:show|cat-file|diff|diff-tree|diff-index|log|whatchanged|ls-files|ls-tree|grep)['"`]|['"`]git /;

function calleeName(node) {
  const e = node.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

/** Every `const`/`let` initializer in the file, by name (first declaration wins). */
function bindingsOf(src) {
  const binds = new Map();
  const walk = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !binds.has(node.name.text)) {
      binds.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(src, walk);
  return binds;
}

/** Whether `node` (followed one hop through a binding) holds a marker literal. */
function namesMarker(node, binds, depth = 0) {
  if (!node || depth > 4) return false;
  let found = false;
  const walk = (n) => {
    if (found) return;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && namesMarkerText(n.text)) { found = true; return; }
    // A template's literal parts: `${dir}/.git` names the marker in its tail.
    if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      if (namesMarkerText(n.text)) { found = true; return; }
    }
    if (ts.isIdentifier(n) && binds.has(n.text) && n !== node) {
      if (namesMarker(binds.get(n.text), binds, depth + 1)) { found = true; return; }
    }
    ts.forEachChild(n, walk);
  };
  if (ts.isIdentifier(node) && binds.has(node.text)) return namesMarker(binds.get(node.text), binds, depth + 1);
  walk(node);
  return found;
}

/**
 * Whether a call steps a directory upward: `dirname(x)` / `path.dirname(x)`, or
 * `join(x, '..')` / `resolve(x, '..')` with a literal `..` argument.
 */
function stepsUpward(call) {
  const name = calleeName(call);
  if (UPWARD_STEPS.has(name)) return true;
  if (!PATH_COMBINERS.has(name)) return false;
  return call.arguments.some((a) => (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && a.text === '..');
}

/** Whether a loop body reassigns some variable to an upward step: `dir = dirname(dir)`. */
function loopWalksUpward(loop) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isCallExpression(n.right) && stepsUpward(n.right)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(loop.statement);
  return found;
}

/**
 * A string-ish node read as a SHAPE: its text, with every template substitution
 * replaced by one placeholder character. `null` for anything else.
 */
function shapeOf(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => HOLE + s.literal.text).join('');
  return null;
}

/**
 * The git argv in a list of argument SHAPES (strings; `null` for a non-string
 * node): an optional run of `-C <dir>` / `-c <k=v>` pairs, then a subcommand.
 * `leading` non-string nodes may precede it (a wrapper's `root` argument).
 *
 * @param {(string | null)[]} shapes
 * @returns {{ sub: string, rest: (string | null)[] } | null}
 */
function gitArgv(shapes, leading = 0) {
  let i = 0;
  while (i < leading && i < shapes.length && shapes[i] === null) i += 1;
  while (shapes[i] === '-C' || shapes[i] === '-c') i += 2;
  const sub = shapes[i];
  return typeof sub === 'string' && GIT_SUBCOMMANDS.has(sub) ? { sub, rest: shapes.slice(i + 1) } : null;
}

/** Whether an argv lists paths from the REPOSITORY root (see the header's `git-root-listing`). */
function listsFromGitRoot({ sub, rest }) {
  const flags = rest.filter((s) => typeof s === 'string');
  if (DIFF_SUBCOMMANDS.has(sub)) {
    return flags.some((f) => PATH_LISTING_FLAG.test(f)) && !flags.some((f) => f === '--relative' || f.startsWith('--relative='));
  }
  if (CWD_LISTING_SUBCOMMANDS.has(sub)) return flags.some((f) => FULL_PATH_FLAGS.has(f));
  return false;
}

const isRootRevPath = (shape) => typeof shape === 'string' && ROOT_REV_PATH.test(shape);

/** Whether a callee is a git wrapper by name: `git`, `gitQuiet`, `runGit`, `this.git`. */
function isGitCallee(call) {
  const name = calleeName(call);
  return typeof name === 'string' && /git/i.test(name);
}

/** The text a node denotes when it is a string, followed through `const` bindings; `null` otherwise. */
function staticText(node, binds, depth = 0) {
  if (!node || depth > 4) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node) && binds.has(node.text)) return staticText(binds.get(node.text), binds, depth + 1);
  return null;
}

/**
 * What an identifier names where it is USED: the nearest enclosing function's
 * parameter of that name (its default, or `null` when it has none -- a value
 * handed in is not a known root), else the file's first `const`/`let` of it.
 */
function bindingAt(id, binds) {
  for (let n = id.parent; n; n = n.parent) {
    if (!ts.isFunctionLike(n) || !n.parameters) continue;
    for (const param of n.parameters) {
      if (ts.isIdentifier(param.name) && param.name.text === id.text) return param.initializer ?? null;
    }
  }
  return binds.get(id.text) ?? null;
}

const isImportMeta = (node) => ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === 'meta';
const isImportMetaUrl = (node) => ts.isPropertyAccessExpression(node) && isImportMeta(node.expression) && node.name.text === 'url';

/** `segments` with `text`'s path segments appended, `..` stepping back. */
function appendSegments(segments, text) {
  const out = [...segments];
  for (const seg of text.split(/[\\/]+/)) {
    if (!seg || seg === '.') continue;
    if (seg === '..' && out.length && out[out.length - 1] !== '..' && out[out.length - 1] !== DYNAMIC) out.pop();
    else out.push(seg);
  }
  return out;
}

/**
 * The path a node names, as segments below the OBJECTUI ROOT -- `[]` for the
 * root itself -- when it is derived from a place this file knows: `uiRoot()`,
 * `UI_ROOT`, or this file's own location (`import.meta.url`, `__dirname`,
 * `import.meta.dirname`) stepped with `dirname` / `join` / `resolve`. `null`
 * for anything else: a parameter with no default, a fixture directory, the
 * cwd, and `workspaceRoot()` / `virtualStorePath()`, which ARE the answer.
 *
 * @param {ts.Node} node
 * @param {{ binds: Map<string, ts.Node>, filePath: string[] }} ctx `filePath`: this file's segments below the root
 * @returns {string[] | null}
 */
function rootPath(node, ctx, hops = 0) {
  if (!node || hops > 8) return null;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return rootPath(node.expression, ctx, hops + 1);
  if (ts.isIdentifier(node)) {
    const init = bindingAt(node, ctx.binds);
    // A `let` may be reassigned (a walk's cursor), so only a `const` or a
    // parameter default is read as the place it was set to.
    const list = init && ts.isVariableDeclaration(init.parent) ? init.parent.parent : null;
    if (list && ts.isVariableDeclarationList(list) && !(list.flags & ts.NodeFlags.Const)) return null;
    if (init) return rootPath(init, ctx, hops + 1);
    if (ctx.binds.has(node.text)) return null;
    if (node.text === '__dirname') return ctx.filePath.slice(0, -1);
    if (node.text === '__filename') return ctx.filePath;
    if (node.text === 'UI_ROOT') return [];
    return null;
  }
  if (ts.isPropertyAccessExpression(node) && isImportMeta(node.expression)) {
    if (node.name.text === 'dirname') return ctx.filePath.slice(0, -1);
    if (node.name.text === 'filename') return ctx.filePath;
    return null;
  }
  if (!ts.isCallExpression(node)) return null;
  const name = calleeName(node);
  const args = node.arguments;
  if (name === 'uiRoot' && args.length === 0) return [];
  if (name === 'fileURLToPath' && args.length === 1 && isImportMetaUrl(args[0])) return ctx.filePath;
  if (name === 'dirname' && args.length === 1) {
    const inner = rootPath(args[0], ctx, hops + 1);
    return inner ? appendSegments(inner, '..') : null;
  }
  if (PATH_COMBINERS.has(name) && args.length >= 1) {
    let out = rootPath(args[0], ctx, hops + 1);
    if (!out) return null;
    for (const arg of args.slice(1)) {
      const text = staticText(arg, ctx.binds);
      if (text === null) return [...out, DYNAMIC];
      out = appendSegments(out, text);
    }
    return out;
  }
  return null;
}

/** Whether segments below the objectui root name one of the workspace's own files. */
const namesWorkspaceRootFile = (segments) =>
  Array.isArray(segments) && WORKSPACE_ROOT_FILES.some((target) => target.every((seg, i) => segments[i] === seg));

const isLoop = (node) => ts.isForStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node);

/**
 * Every root lookup in one source text.
 *
 * @param {string} file  Path used for reporting and for the script kind.
 * @param {string} text
 * @returns {{ line: number, shape: 'marker-probe' | 'marker-walk' | 'git-toplevel' | 'find-up' | 'git-rev-path' | 'git-root-listing' | 'workspace-file-at-ui-root', text: string }[]}
 */
export function lookupsIn(file, text) {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const binds = bindingsOf(src);
  const pathCtx = { binds, filePath: file.split(/[\\/]/).filter(Boolean) };
  const hits = [];
  const seen = new Set();
  const record = (node, shape) => {
    const key = `${node.getStart(src)}:${shape}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({
      line: src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1,
      shape,
      text: node.getText(src).replace(/\s+/g, ' ').slice(0, 120),
    });
  };
  // The loops enclosing the node being visited, innermost last; a marker read
  // inside one that steps upward is the walk's existence test, not a data read.
  const loops = [];
  const inUpwardWalk = () => loops.some(loopWalksUpward);
  // Every `<ref>:<path>` under `scope` that names its path from the git root.
  const recordRevPaths = (scope) => {
    const visit = (n) => {
      if (isRootRevPath(shapeOf(n))) record(n, 'git-rev-path');
      ts.forEachChild(n, visit);
    };
    visit(scope);
  };
  // One git argv, read from `nodes`; `scope` is what a `<ref>:<path>` may hide in.
  const judgeArgv = (anchor, nodes, scope, leading = 0) => {
    const argv = gitArgv(nodes.map(shapeOf), leading);
    if (!argv) return false;
    if (listsFromGitRoot(argv)) record(anchor, 'git-root-listing');
    if (REV_PATH_SUBCOMMANDS.has(argv.sub)) {
      for (const n of nodes) if (isRootRevPath(shapeOf(n))) record(n, 'git-rev-path');
      if (scope) recordRevPaths(scope);
    }
    return true;
  };
  // A string command (`execSync('git show ...')`), split on whitespace.
  const judgeCommand = (node) => {
    const shape = shapeOf(node);
    if (shape === null || !/^git\s/.test(shape)) return;
    const words = shape.trim().split(/\s+/).slice(1).map((w) => w.replace(/^(['"])(.*)\1$/, '$2'));
    const argv = gitArgv(words);
    if (!argv) return;
    if (listsFromGitRoot(argv)) record(node, 'git-root-listing');
    if (REV_PATH_SUBCOMMANDS.has(argv.sub) && argv.rest.some(isRootRevPath)) record(node, 'git-rev-path');
  };

  const walk = (node) => {
    if (ts.isArrayLiteralExpression(node)) {
      judgeArgv(node, node.elements, null);
    } else if (ts.isCallExpression(node)) {
      // The spawning call: an argv array among its arguments puts the whole
      // call (a `cat-file --batch` `input:` included) in reach of the rev-path rule.
      for (const arg of node.arguments) {
        if (ts.isArrayLiteralExpression(arg)) {
          const argv = gitArgv(arg.elements.map(shapeOf));
          if (argv && REV_PATH_SUBCOMMANDS.has(argv.sub)) recordRevPaths(node);
        }
      }
      // A variadic wrapper: `git(root, 'show', 'HEAD:x')`.
      if (isGitCallee(node)) judgeArgv(node, node.arguments, null, 2);
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) judgeCommand(node);
    // A workspace root file joined to the objectui root (objectstack#25733):
    // judged where the path FIRST names it, so a join built on that join is
    // not a second finding.
    if (ts.isCallExpression(node) && PATH_COMBINERS.has(calleeName(node)) && node.arguments.length > 1) {
      if (namesWorkspaceRootFile(rootPath(node, pathCtx)) && !namesWorkspaceRootFile(rootPath(node.arguments[0], pathCtx))) {
        record(node, 'workspace-file-at-ui-root');
      }
    } else if (ts.isTemplateExpression(node) && node.head.text === '' && node.templateSpans.length > 0) {
      const base = rootPath(node.templateSpans[0].expression, pathCtx);
      if (base && !namesWorkspaceRootFile(base) && namesWorkspaceRootFile(appendSegments(base, node.templateSpans[0].literal.text))) {
        record(node, 'workspace-file-at-ui-root');
      }
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'find-up') {
      record(node, 'find-up');
    } else if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name === 'require' && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'find-up') record(node, 'find-up');
      else if (name === 'findUp' || name === 'findUpSync') record(node, 'find-up');
      else if (PROBES.has(name) && namesMarker(node.arguments[0], binds)) record(node, 'marker-probe');
      else if (READS.has(name) && namesMarker(node.arguments[0], binds) && inUpwardWalk()) record(node, 'marker-walk');
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && GIT_ROOT_FLAGS.has(node.text)) {
      record(node, 'git-toplevel');
    }
    if (isLoop(node)) {
      loops.push(node);
      ts.forEachChild(node, walk);
      loops.pop();
    } else {
      ts.forEachChild(node, walk);
    }
  };
  walk(src);
  return hits;
}

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      yield* walkFiles(join(dir, entry.name));
    } else if (entry.isFile() && EXTENSIONS.has(extname(entry.name))) {
      yield join(dir, entry.name);
    }
  }
}

/**
 * @param {string} root the objectui tree
 * @returns {{ scanned: number, parsed: number, hits: {file: string, line: number, shape: string, text: string, allowed: string | null}[], stale: string[] }}
 */
export function scan(root = uiRoot()) {
  const hits = [];
  let scanned = 0;
  let parsed = 0;
  for (const scanRoot of SCAN_ROOTS) {
    const dir = join(root, scanRoot);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const abs of walkFiles(dir)) {
      const rel = relative(root, abs).split('\\').join('/');
      if (rel === HELPER || rel === SELF) continue;
      scanned += 1;
      const text = readFileSync(abs, 'utf8');
      if (!PREFILTER.test(text)) continue;
      parsed += 1;
      for (const hit of lookupsIn(rel, text)) hits.push({ file: rel, ...hit, allowed: ALLOWLIST.get(rel) ?? null });
    }
  }
  const live = new Set(hits.map((h) => h.file));
  const stale = [...ALLOWLIST.keys()].filter((file) => !live.has(file));
  return { scanned, parsed, hits, stale };
}

export function selfTest() {
  const cases = [];
  const run = (name, source, want, file = 'fixture/x.test.ts') => {
    const hits = lookupsIn(file, source);
    const ok = want === 'fires' ? hits.length > 0 : hits.length === 0;
    cases.push({ name, ok, detail: ok ? '' : `${hits.length} hit(s): ${hits.map((h) => `${h.shape} \`${h.text}\``).join('; ')}` });
  };
  const head = "import { existsSync, readFileSync, writeFileSync } from 'node:fs';\nimport { join, dirname } from 'node:path';\nimport { execFileSync } from 'node:child_process';\n";
  // ── FIRES ────────────────────────────────────────────────────────────────
  run('a walk up to pnpm-workspace.yaml', `${head}let dir = __dirname;\nwhile (!existsSync(join(dir, 'pnpm-workspace.yaml'))) dir = dirname(dir);`, 'fires');
  run('a walk up to .git through a namespace import', `import fs from 'node:fs';\nimport path from 'node:path';\nif (fs.existsSync(path.join(dir, '.git'))) return dir;`, 'fires');
  run('the marker laundered through a const', `${head}const marker = join(dir, '.git');\nif (existsSync(marker)) return dir;`, 'fires');
  run('`git rev-parse --show-toplevel`', `${head}const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();`, 'fires');
  run('`--git-common-dir`', `${head}const common = execFileSync('git', ['rev-parse', '--git-common-dir']);`, 'fires');
  run('an import of find-up', `import { findUp } from 'find-up';\nconst root = await findUp('pnpm-workspace.yaml');`, 'fires');
  run('a statSync probe in a .mjs file', `import { statSync } from 'node:fs';\ntry { statSync(\`\${dir}/.git\`); } catch {}`, 'fires', 'scripts/x.mjs');
  run(
    'a readFileSync of the marker as the existence test of a dirname walk (the e2e IIFE, objectstack#25723)',
    `${head}const REPO_ROOT = (() => {\n  let dir = dirname(__filename);\n  for (let i = 0; i < 10; i++) {\n    try {\n      readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8');\n      return dir;\n    } catch {\n      dir = dirname(dir);\n    }\n  }\n  throw new Error('no root');\n})();`,
    'fires',
    'e2e/x.spec.ts',
  );
  run('a readFileSync of .git in a while loop stepping with resolve(dir, "..")', `import fs from 'node:fs';\nimport path from 'node:path';\nwhile (dir !== '/') { try { fs.readFileSync(path.join(dir, '.git')); break; } catch { dir = path.resolve(dir, '..'); } }`, 'fires');
  // ── SILENT ───────────────────────────────────────────────────────────────
  run('reading the workspace globs as data from a known root', `${head}const yaml = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');`, 'silent');
  run('reading the marker as data inside a loop over KNOWN roots (no upward step)', `${head}for (const root of roots) {\n  const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');\n  globs.push(yaml);\n}`, 'silent');
  run('an upward walk that reads something other than a marker', `${head}let dir = __dirname;\nwhile (dir !== '/') { try { readFileSync(join(dir, 'package.json')); break; } catch { dir = dirname(dir); } }`, 'silent');
  run('a directory skip-list naming .git', `const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo']);`, 'silent');
  run('a fixture that writes a pnpm-workspace.yaml', `${head}writeFileSync(join(dir, 'pnpm-workspace.yaml'), "packages:\\n  - 'packages/*'\\n");`, 'silent');
  run('a comment that mentions every spelling', `// walks up to .git or pnpm-workspace.yaml, like git rev-parse --show-toplevel or find-up\nexport const x = 1;`, 'silent');
  run('the helper itself', `import { uiRoot } from '../../../../scripts/ui-root.mjs';\nconst README = join(uiRoot(), 'packages/core/README.md');\nif (existsSync(README)) {}`, 'silent');
  run('an existsSync of something else', `${head}if (existsSync(join(root, 'packages/types/package.json'))) {}`, 'silent');
  // ── Paths handed to git (objectstack#25728) ──────────────────────────────
  // FIRES
  run('`git show <ref>:<path>` through a wrapper (the check:i18n-drift red)', `${head}const text = gitQuiet(root, ['show', \`\${ref}:\${rel}\`]);`, 'fires', 'scripts/x.mjs');
  run('`git show` of a literal root-relative path', `${head}execFileSync('git', ['show', 'origin/main:packages/i18n/src/locales/en.ts'], { cwd: root });`, 'fires', 'scripts/x.mjs');
  run('a `cat-file --batch` input naming paths from the root', `${head}execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: paths.map((p) => \`\${ref}:\${p}\`).join('\\n') });`, 'fires', 'scripts/x.mjs');
  run('`-C <dir>` before `show`', `${head}spawnSync('git', ['-C', root, 'show', \`\${rev}:\${file}\`]);`, 'fires', 'scripts/x.mjs');
  run('a variadic wrapper `git(root, "show", "HEAD:x")`', `const out = git(repo, 'show', 'HEAD:packages/x/package.json');`, 'fires');
  run('a string command `git show <ref>:<path>`', `${head}execSync(\`git show \${base}:\${file}\`);`, 'fires', 'scripts/x.mjs');
  run('`diff --name-only` without --relative (an argv built then pushed to)', `const args = ['diff', '--name-only', '-z'];\nargs.push(base);`, 'fires', 'scripts/x.mjs');
  run('`diff-tree --name-status` without --relative', `${head}git(root, ['diff-tree', '-r', '--name-status', sha]);`, 'fires', 'scripts/x.mjs');
  run('`log --numstat` without --relative', `${head}git(root, ['log', '--numstat', '--format=%H', range]);`, 'fires', 'scripts/x.mjs');
  run('`ls-tree --full-tree`', `${head}git(root, ['ls-tree', '-r', '--name-only', '--full-tree', ref]);`, 'fires', 'scripts/x.mjs');
  run('`ls-files --full-name`', `${head}execFileSync('git', ['ls-files', '--full-name', '-z'], { cwd: root });`, 'fires', 'scripts/x.mjs');
  // SILENT
  run('`revPath(ref, file)`', `import { revPath } from './workspace-root.mjs';\n${head}gitQuiet(root, ['show', revPath(ref, rel)]);`, 'silent', 'scripts/x.mjs');
  run('`<ref>:./<path>` spelled out', `${head}execFileSync('git', ['show', \`\${rev}:./\${path}\`], { cwd: root });`, 'silent', 'scripts/x.mjs');
  run('a `<sha>^{commit}` probe and a ref range', `${head}git(root, ['cat-file', '-e', \`\${sha}^{commit}\`]);\ngit(root, ['log', '--format=%H:%s', \`\${base}..\${head}\`]);`, 'silent', 'scripts/x.mjs');
  run('`diff --name-only --relative`', `${head}git(root, ['diff', '--name-only', '--relative', base, head]);`, 'silent', 'scripts/x.mjs');
  run('a patch `diff` with a pathspec after `--`', `${head}git(root, ['diff', '-U0', '--no-color', base, '--', file]);`, 'silent', 'scripts/x.mjs');
  run('`ls-files` / `ls-tree` / `grep` answering from the cwd', `${head}git(root, ['ls-files', '-z']);\ngit(root, ['ls-tree', '-r', '--name-only', ref]);\ngit(root, ['grep', '-n', '-e', key, '--', 'packages']);`, 'silent', 'scripts/x.mjs');
  run('pathspec magic, not a revision', `${head}git(root, ['ls-files', '--others', '--', ':(glob).changeset/*.md']);\ngit(root, ['diff', '--relative', '--name-only', base, '--', ':(glob).changeset/*.md']);`, 'silent', 'scripts/x.mjs');
  run('a `<file>:<line>` diagnostic outside any git argv', `const where = \`\${file}:\${line}\`;\nconsole.log(['show', where].join(' '));`, 'silent', 'scripts/x.mjs');
  run('a list that only looks like an argv', `const ROWS = [['status', 'Aggregate closure ceiling'], ['log', 'info', 'warn']];`, 'silent', 'scripts/x.mjs');
  // ── The workspace's own files, joined to the objectui tree (objectstack#25733) ──
  const fileRoot = "import { dirname, join, resolve } from 'node:path';\nimport { fileURLToPath } from 'node:url';\n";
  // FIRES
  run('the store joined to `uiRoot()`', `import { uiRoot } from './ui-root.mjs';\n${fileRoot}const store = join(uiRoot(), 'node_modules', '.pnpm');`, 'fires', 'scripts/x.mjs');
  run(
    'the store under a parameter whose default climbs from this file to the tree (the check-doc-snippet-types probe)',
    `${fileRoot}const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');\nexport function findCopy(root = repoRoot, name = '') {\n  return join(root, 'node_modules', '.pnpm', name);\n}`,
    'fires',
    'scripts/x.mjs',
  );
  run('one literal naming the store under a four-level climb from a package test', `${fileRoot}const REPO_ROOT = resolve(__dirname, '../../../..');\nconst copy = join(REPO_ROOT, 'node_modules/.pnpm/vitest@4.1.10/node_modules/vitest');`, 'fires', 'packages/cli/src/__tests__/x.test.ts');
  run('pnpm-workspace.yaml read as data from the tree', `import { readFileSync } from 'node:fs';\nimport { uiRoot } from './ui-root.mjs';\n${fileRoot}const yaml = readFileSync(join(uiRoot(), 'pnpm-workspace.yaml'), 'utf8');`, 'fires', 'scripts/x.mjs');
  run('a climb and the marker in one call, from `import.meta.dirname`', `${fileRoot}const file = resolve(import.meta.dirname, '../..', 'pnpm-workspace.yaml');`, 'fires', 'apps/console/x.ts');
  run('a template led by the tree', `import { uiRoot } from './ui-root.mjs';\nconst store = \`\${uiRoot()}/node_modules/.pnpm\`;`, 'fires', 'scripts/x.mjs');
  run('the marker through a `const` name', `import { uiRoot } from './ui-root.mjs';\n${fileRoot}const MANIFEST = 'pnpm-workspace.yaml';\nconst file = join(uiRoot(), MANIFEST);`, 'fires', 'scripts/x.mjs');
  // SILENT
  run('the helpers themselves', `import { virtualStorePath, workspaceManifestPath, workspaceRoot } from './workspace-root.mjs';\n${fileRoot}const a = virtualStorePath();\nconst b = join(workspaceRoot(), 'node_modules', '.pnpm');\nconst c = workspaceManifestPath();`, 'silent', 'scripts/x.mjs');
  run('a store laid out in a fixture directory', `import { mkdtempSync } from 'node:fs';\nimport os from 'node:os';\n${fileRoot}const root = mkdtempSync(join(os.tmpdir(), 'fx-'));\nconst store = join(root, 'node_modules/.pnpm/x@1.0.0/node_modules/x');`, 'silent', 'scripts/__tests__/x.test.ts');
  run('a parameter with no default', `${fileRoot}export function storeOf(root) {\n  return join(root, 'node_modules', '.pnpm');\n}`, 'silent', 'scripts/x.mjs');
  run('a climb that stops below the tree', `${fileRoot}const scriptsDir = resolve(__dirname, '..');\nconst store = join(scriptsDir, 'node_modules', '.pnpm');`, 'silent', 'scripts/__tests__/x.test.ts');
  run('the tree\'s own declared dependencies under its node_modules', `import { uiRoot } from './ui-root.mjs';\n${fileRoot}const turbo = join(uiRoot(), 'node_modules/.bin/turbo');\nconst vitest = join(uiRoot(), 'node_modules', 'vitest');`, 'silent', 'scripts/x.mjs');
  run('a module-id string that contains the store', `const STORE_SPEC = '/w/node_modules/.pnpm/@objectstack+spec@18.1.0/node_modules/@objectstack/spec/dist/index.mjs';`, 'silent', 'scripts/__tests__/x.test.ts');
  run('a join built on a join that already named the store is one finding', `import { uiRoot } from './ui-root.mjs';\n${fileRoot}const entry = join(join(uiRoot(), 'node_modules', '.pnpm'), 'x@1.0.0');`, 'fires', 'scripts/x.mjs');
  return cases;
}

function main(argv) {
  if (argv.includes('--self-test')) {
    const cases = selfTest();
    for (const c of cases) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
    const failed = cases.filter((c) => !c.ok);
    console.log(failed.length ? `✗ ${failed.length} of ${cases.length} self-test case(s) failed` : `✓ ${cases.length} self-test case(s) passed`);
    return failed.length ? 1 : 0;
  }
  const result = scan();
  const offending = result.hits.filter((h) => h.allowed === null);
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ...result, offending }, null, 2));
    return offending.length || result.stale.length || result.scanned === 0 ? 1 : 0;
  }
  if (argv.includes('--list')) {
    for (const h of result.hits) console.log(`${h.allowed ? 'allowed ' : 'LOOKUP  '} ${h.file}:${h.line}  ${h.shape}  ${h.text}${h.allowed ? `  -- ${h.allowed}` : ''}`);
  }
  if (result.scanned === 0) {
    console.error(`✗ check-ui-root-lookups: scanned no files under ${SCAN_ROOTS.join(', ')} -- a scan of nothing is not a reading.`);
    return 1;
  }
  for (const h of offending) {
    console.error(`✗ ${h.file}:${h.line}  ${h.shape}  ${h.text}`);
  }
  for (const file of result.stale) console.error(`✗ stale allowlist entry: ${file} carries no lookup any more -- delete its line from ALLOWLIST.`);
  if (offending.length || result.stale.length) {
    console.error(
      `\n✗ check-ui-root-lookups: ${offending.length} repo-root lookup(s) outside ${HELPER}` +
        `${result.stale.length ? ` and ${result.stale.length} stale allowlist entr${result.stale.length === 1 ? 'y' : 'ies'}` : ''}.\n` +
        `  Standalone these find the objectui root; inside the objectstack monorepo (\`ui/\`) they find the OBJECTSTACK root.\n` +
        `  Import { uiRoot } from scripts/ui-root.mjs instead -- it resolves the tree from its own location in both layouts.\n` +
        `  The workspace's own files (pnpm-workspace.yaml, node_modules/.pnpm) come from scripts/workspace-root.mjs.`,
    );
    return 1;
  }
  console.log(
    `✅  check-ui-root-lookups: OK (${result.scanned} file(s) scanned, ${result.parsed} parsed, ` +
      `${result.hits.length} probe(s) all on the allowlist, ${ALLOWLIST.size} allowlist entr${ALLOWLIST.size === 1 ? 'y' : 'ies'} live).`,
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
