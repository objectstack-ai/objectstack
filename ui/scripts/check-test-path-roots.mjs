#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Rejects a test that RESOLVES A PATH BELOW THE PROCESS CWD.
 *
 *   node scripts/check-test-path-roots.mjs             # scan the tree
 *   node scripts/check-test-path-roots.mjs --list       # every filesystem call, with the root it resolved from
 *   node scripts/check-test-path-roots.mjs --blind      # every root this gate could NOT classify
 *   node scripts/check-test-path-roots.mjs --json
 *   node scripts/check-test-path-roots.mjs --self-test  # the detector's own cases
 *
 * Exit: 0 = OK, 1 = an unregistered cwd-rooted read, a stale registry entry, or
 *       a collapsed population.
 *
 * ## The rule, and why a rule was not enough (objectui#8953)
 *
 * Root `AGENTS.md` teaches it:
 *
 *   ⛔ 测试在断言里读文件系统,根定在它自己的文件上,永不定在 `process.cwd()`。
 *
 * and the bullet ends by declaring that nothing enforces it. That is this gate.
 *
 * The mechanism, measured twice. A package's own `test` script is
 * `vitest run --root ../.. packages/PKG/` (objectui#3240), which is what
 * `pnpm --filter PKG test` and `turbo run test` both run. It moves VITEST's
 * root to the repo root and leaves `process.cwd()` in the package directory.
 * So a test that builds a path out of the cwd reads a DIFFERENT TREE depending
 * on which invocation started it, and the same assertion reaches two verdicts:
 *
 *   objectui#7791 (PR #7796)  one file, cwd the only variable:
 *                             repo root `7 passed`, package dir `2 failed / 5 passed`
 *   objectui#7799 (PR #7806)  a census under `packages` of every test mentioning
 *                             `cwd()`, 13 genuinely defective, repaired one at a time
 *
 * ## Why this is not a `process.cwd` grep, and what that costs
 *
 * ⛔ The spelling is not the defect. One of objectui#7799's own 13 was
 * INVISIBLE to the census regex that found the other twelve, because it spelled
 * the read
 *
 *   (globalThis as unknown as { process: { cwd(): string } }).process.cwd()
 *
 * to dodge a browser `process` shim in `packages/components/src/global.d.ts`.
 * A detector a defect can walk around by renaming the call is the failure mode
 * this card was filed under, so the shape here is deliberately not textual:
 *
 *  1. **Sinks, not spellings.** The scan starts at the FILESYSTEM CALL --
 *     `readFileSync`, `existsSync`, `readdirSync`, … (`FS_SINKS`) -- and asks
 *     what its path argument is rooted at. A read that never happens cannot
 *     reach a wrong tree, and a cwd read that feeds no filesystem call is not
 *     this defect.
 *  2. **Roots are RESOLVED, not matched.** `rootOf` walks the path expression
 *     to its leftmost term THROUGH the file's own bindings, so the defect is
 *     caught where it is committed rather than where it is spelled:
 *
 *       const siteDir = path.join(process.cwd(), 'apps/site/app/components');
 *       …
 *       const read = (f) => fs.readFileSync(path.join(siteDir, f), 'utf8');   // ← flagged
 *
 *     The sink line holds no `cwd` at all. Both real instances of that shape in
 *     this tree were found this way and by nothing else.
 *  3. **Any spelling that EVALUATES to the cwd counts.** `rootOf` classifies a
 *     call whose callee is named `cwd` however it was reached -- bare
 *     `process.cwd()`, `globalThis.process.cwd()`, the `as unknown as` cast
 *     above, or an alias bound three hops earlier -- because it reads the AST's
 *     call target, not the source text. `process.env.PWD` and
 *     `process.env.INIT_CWD` are the same root under another name and are
 *     classified with it. So is a BARE RELATIVE STRING handed straight to a
 *     filesystem call: `readFileSync('e2e/live/.auth/state.json')` names no root
 *     at all, which is precisely how it gets the ambient one.
 *
 * ⚠️ What it CANNOT see, named rather than implied -- `--blind` enumerates
 * every one of them in the tree as it stands, and the census line prints the
 * count on every run so that this gate's silence can never read as a clean
 * bill of health for the whole class:
 *
 *   - a root that arrives as a FUNCTION PARAMETER, or from an IMPORT. `rootOf`
 *     resolves bindings within one file and stops at the module edge, so a
 *     helper that resolves a repository path on the test's behalf is invisible
 *     here. That is the largest blind spot and it is structural.
 *   - a root read from any environment variable other than the two named above.
 *   - a filesystem call reached dynamically (`fs[name](p)`), or one made by a
 *     helper module rather than by the test file itself.
 *   - a cwd-rooted path handed to something that is NOT a filesystem call --
 *     a `spawnSync` cwd option, a glob library, `import()`. Deliberate: those
 *     have their own contracts and this gate does not model them.
 *   - test-shaped files that do not match `TEST_FILE`, and any file git does
 *     not track.
 *
 * ## The verdict, stated exactly
 *
 * A violation is **an ambient root with at least one path segment appended to
 * it** -- that is, a test resolving a path BELOW the cwd. Appending is what
 * makes the verdict cwd-dependent; the cwd itself is not:
 *
 *   existsSync(cwd)                                   ← NOT a violation
 *   existsSync(join(cwd, 'pnpm-workspace.yaml'))      ← a violation
 *
 * The first is `packages/components/src/__tests__/browser-process-shim-scope.test.ts`,
 * which exists to compile a `process.cwd()` call and asserts only that the
 * binding names a real absolute directory. PR #7806 rewrote it into exactly
 * that shape, and it needs no entry in any list here: the rule gets it right.
 *
 * ⛔ The appended segments are NOT required to look like a repository path.
 * Requiring `packages/`-or-similar in the suffix would be the grep thinking
 * coming back in through the window -- a path assembled from variables carries
 * no such literal, and anything below a cwd that moves is cwd-dependent whether
 * or not this file recognises its name.
 *
 * ## The fix this gate points at
 *
 * The spelling PR #7796 landed and PR #7806 reused, from BARE `import.meta.url`:
 *
 *   const SELF_DEPTH_BELOW_REPO_ROOT = 5; // packages / pkg / src / __tests__ / this file
 *   const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
 *     .split('/')
 *     .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
 *     .join('/');
 *
 * ⚠️ This gate does NOT flag the two-argument `new URL(rel, import.meta.url)`
 * form, and the reason is a measurement rather than a preference. AGENTS.md
 * warns that Vite rewrites it to an `http://localhost:3000/@fs/…` URL on which
 * `fileURLToPath` throws. Re-measured for objectui#8953 on this tree: 21 live
 * call sites use it and all of them pass, from the repo root AND from a package
 * directory (`packages/app-shell` probed both ways, 21 and 13 tests green). It
 * is self-rooted by construction, so it is not this defect in either case, and
 * a gate that reddened 21 green files over a hazard that did not reproduce
 * would be a false-positive engine. The warning is left where it is; whether it
 * still holds anywhere is a separate question from this one.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { isEntrypoint } from './invoked-as.mjs';

/** Files this gate calls a test. */
export const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mts|mjs|cts|cjs)$/;

/**
 * The filesystem calls whose first argument is a path. Sync, callback and
 * promise spellings together: they differ in how they return, not in how they
 * resolve a relative path.
 */
export const FS_SINKS = Object.freeze([
  'access', 'accessSync',
  'appendFile', 'appendFileSync',
  'copyFile', 'copyFileSync',
  'cp', 'cpSync',
  'createReadStream', 'createWriteStream',
  'exists', 'existsSync',
  'glob', 'globSync',
  'lstat', 'lstatSync',
  'mkdir', 'mkdirSync',
  'open', 'openSync',
  'opendir', 'opendirSync',
  'readFile', 'readFileSync',
  'readdir', 'readdirSync',
  'readlink', 'readlinkSync',
  'realpath', 'realpathSync',
  'rm', 'rmSync',
  'rmdir', 'rmdirSync',
  'stat', 'statSync',
  'unlink', 'unlinkSync',
  'writeFile', 'writeFileSync',
]);
const SINKS = new Set(FS_SINKS);

/** `join`/`resolve`-family calls: the root is their FIRST argument. */
const PATH_COMBINERS = new Set(['join', 'resolve', 'normalize', 'toNamespacedPath']);
/** Calls that pass a path through unchanged, so the root is their first argument. */
const PATH_PASSTHROUGH = new Set(['fileURLToPath', 'decodeURIComponent', 'decodeURI', 'dirname', 'realpathSync', 'realpath', 'pathToFileURL', 'normalize']);
/** Calls that produce an ABSOLUTE path of their own, whatever the cwd is. */
const ABSOLUTE_PRODUCERS = new Set(['tmpdir', 'mkdtempSync', 'mkdtemp', 'homedir', 'resolveSync']);
/** The specifiers whose exports are filesystem calls. */
const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises', 'graceful-fs']);

/**
 * Ambient reads whose SUBJECT is the cwd, registered with the reason. ⛔ Not a
 * debt list -- re-rooting one of these would break the test it belongs to.
 * Every entry is `path:line -- reason`, and a stale entry (the site no longer
 * resolves from the cwd) fails the run, so this list cannot quietly outlive
 * what it excuses.
 */
export const SUBJECT_IS_THE_CWD = Object.freeze([
  'packages/cli/src/__tests__/app-generator.test.ts:1326 -- `contextOfCurrentProcess()` mirrors the ambient cwd on BOTH sides of the assertion deliberately: the writer under test derives its context from `process.cwd()` and the expectation derives it the same way, so the pair is self-consistent under either cwd. Re-rooting one side desyncs the mirror and turns a passing test red. The real cost -- that WHICH generator branch those two cases pin is decided by the launch directory -- is filed as objectui#7807 and is closed in the same file by two further cases that name their branch instead of inheriting it.',
]);

/**
 * Cwd-rooted reads owed a repair. ⛔ SHRINK-ONLY: adding a line here is
 * admitting a new instance of a class that produced 13 defects in one day.
 *
 * EMPTY, and the ratchet in `scripts/__tests__/check-test-path-roots.test.ts`
 * is pinned at zero to hold it there. The last entry was the storage-state
 * read in `e2e/live/inline-edit-polish-2572.spec.ts`, held back because whether
 * `import.meta` survives Playwright's TypeScript transform in this repository
 * was unmeasured. objectui#9188 measured it: a probe spec in `e2e/live/`, run
 * under `playwright.live.config.ts`, read `import.meta.url` back as its own
 * absolute `file:` URL, byte-identical from two different launch directories,
 * while the bare relative path moved between them. So the entry was repaired
 * into the PR #7796 spelling rather than excused.
 */
export const KNOWN_CWD_ROOTED = Object.freeze([]);

/**
 * The population floors. A gate that scans nothing passes, and that is the
 * failure direction this repository has carded more than once -- so a walk that
 * collapses (a broken glob, a `git ls-files` that returns nothing, an AST that
 * stops matching) fails the run instead of reporting clean. Set with room: they
 * catch a collapse, not ordinary movement.
 */
export const FLOORS = Object.freeze({ testFiles: 2000, sinkCalls: 800, selfRooted: 20, filesWithSinks: 100 });

// ---------------------------------------------------------------------------
// The detector
// ---------------------------------------------------------------------------

/**
 * @typedef {{ kind: 'ambient' | 'self' | 'absolute' | 'module' | 'unknown', why: string }} Root
 */

const AMBIENT = (why) => ({ kind: 'ambient', why });
const SELF = (why) => ({ kind: 'self', why });
const ABSOLUTE = (why) => ({ kind: 'absolute', why });
const MODULE = (why) => ({ kind: 'module', why });
const UNKNOWN = (why) => ({ kind: 'unknown', why });

const calleeName = (node) => {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
};

/**
 * Is `node` a module-resolution call -- `require.resolve`, `import.meta.resolve`,
 * or the same through a `createRequire()` binding? Those answer from the module
 * graph and return an absolute path, whatever the cwd is.
 *
 * The `createRequire` owner is resolved THROUGH the file's bindings rather than
 * matched by name: this tree really writes `const require_ = createRequire(…)`,
 * and a name match on `require` misses it.
 */
const isModuleResolve = (node, src, binds) => {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (callee.name.text !== 'resolve') return false;
  const owner = callee.expression;
  const ownerText = owner.getText(src);
  if (ownerText === 'require' || ownerText === 'import.meta') return true;
  if (ts.isCallExpression(owner) && calleeName(owner) === 'createRequire') return true;
  if (binds && ts.isIdentifier(owner)) {
    const bound = binds.get(owner.text);
    if (bound && ts.isCallExpression(bound) && calleeName(bound) === 'createRequire') return true;
  }
  return false;
};

/**
 * The local names that really are filesystem calls in this file, resolved from
 * the IMPORT rather than from the call's spelling.
 *
 * ⭐ This is the other half of "sinks, not spellings", in the opposite
 * direction. `packages/cli/src/__tests__/check-jsonc-parse.test.ts` declares its
 * own `function writeFile(name, body)` that writes into a `mkdtemp` directory;
 * a gate matching the NAME reports twelve violations there and every one of
 * them is wrong. Provenance is what tells node's `writeFile` from the file's.
 *
 * @returns {{ direct: Set<string>, namespaces: Set<string> }}
 *   `direct` -- local names bound to a named fs export; `namespaces` -- local
 *   names bound to the whole module, so `<name>.<sink>` is a sink.
 */
function fsBindingsOf(src) {
  const direct = new Set();
  const namespaces = new Set();
  const note = (specifier, clause) => {
    if (!FS_MODULES.has(specifier)) return;
    if (!clause) return;
    if (ts.isIdentifier(clause)) { namespaces.add(clause.text); return; }          // const fs = require('fs')
    if (ts.isObjectBindingPattern(clause)) {                                        // const { readFileSync } = require('fs')
      for (const el of clause.elements) if (ts.isIdentifier(el.name)) direct.add(el.name.text);
      return;
    }
    if (clause.name) namespaces.add(clause.name.text);                              // import fs from 'fs'
    const named = clause.namedBindings;
    if (!named) return;
    if (ts.isNamespaceImport(named)) namespaces.add(named.name.text);               // import * as fs from 'fs'
    else for (const el of named.elements) direct.add(el.name.text);                 // import { readFileSync } from 'fs'
  };

  const walk = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      note(node.moduleSpecifier.text, node.importClause);
    } else if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = ts.isAwaitExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (ts.isCallExpression(init) && init.arguments.length === 1 && ts.isStringLiteral(init.arguments[0])) {
        const fn = calleeName(init);
        if (fn === 'require' || fn === 'importActual' || init.expression.kind === ts.SyntaxKind.ImportKeyword) {
          note(init.arguments[0].text, node.name);
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(src, walk);
  return { direct, namespaces };
}

/** Is this call node a filesystem call, by provenance rather than by name? */
function fsSinkName(node, src, fsBindings) {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) {
    return SINKS.has(callee.text) && fsBindings.direct.has(callee.text) ? callee.text : null;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    if (!SINKS.has(callee.name.text)) return null;
    // `fs.readFileSync(…)`, and `fs.promises.readFile(…)`.
    let owner = callee.expression;
    while (ts.isPropertyAccessExpression(owner) && (owner.name.text === 'promises' || owner.name.text === 'default')) owner = owner.expression;
    return ts.isIdentifier(owner) && fsBindings.namespaces.has(owner.text) ? callee.name.text : null;
  }
  return null;
}

/**
 * The root a path expression resolves from, and whether anything was appended
 * below it.
 *
 * ⭐ This is the whole detector. It reads the AST's call TARGET rather than the
 * source text, which is why a spelling change cannot walk around it, and it
 * follows the file's own bindings, which is why a root laundered through a
 * `const` three screens up is still found.
 *
 * @param {ts.Node | undefined} node
 * @param {{ src: ts.SourceFile, binds: Map<string, ts.Node>, depth?: number, appended?: boolean }} ctx
 * @returns {Root & { appended: boolean }}
 */
export function rootOf(node, ctx) {
  const { src, binds } = ctx;
  const uiRootNames = ctx.uiRootNames ?? new Set();
  const depth = ctx.depth ?? 0;
  const appended = ctx.appended ?? false;
  const done = (root) => ({ ...root, appended });
  const recur = (n, extra = {}) => rootOf(n, { src, binds, uiRootNames, depth: depth + 1, appended, ...extra });

  if (!node) return done(UNKNOWN('no path argument'));
  // 12 hops is far past anything this tree writes; the bound exists so a
  // cyclic binding cannot hang the scan.
  if (depth > 12) return done(UNKNOWN('resolution depth exceeded'));

  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node)) return recur(node.expression);
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) return recur(node.expression);

  if (ts.isCallExpression(node)) {
    const name = calleeName(node);
    // ⭐ The cwd, however it was reached. `process.cwd()`, `globalThis.process.cwd()`,
    // `(globalThis as unknown as {…}).process.cwd()` and any alias of them are
    // one node shape here, which is the point.
    if (name === 'cwd') return done(AMBIENT(`\`${node.expression.getText(src).replace(/\s+/g, ' ')}()\``));
    // `uiRoot()` from scripts/ui-root.mjs: rooted on that helper's own file.
    if (name !== null && uiRootNames.has(name) && ts.isIdentifier(node.expression)) return done(SELF(`\`${name}()\` (scripts/ui-root.mjs, rooted on its own file)`));
    if (isModuleResolve(node, src, binds)) return done(MODULE(`${node.expression.getText(src)}(…)`));
    if (ABSOLUTE_PRODUCERS.has(name)) return done(ABSOLUTE(`${name}()`));
    if (PATH_COMBINERS.has(name)) {
      // `join(root, 'a', 'b')` appends; `join(root)` does not. `resolve()` with
      // no argument at all IS the cwd.
      if (node.arguments.length === 0) return done(AMBIENT(`\`${name}()\` with no argument is the cwd`));
      return recur(node.arguments[0], { appended: appended || node.arguments.length > 1 });
    }
    if (PATH_PASSTHROUGH.has(name)) return recur(node.arguments[0]);
    return done(UNKNOWN(`return value of \`${(name ?? node.expression.getText(src)).slice(0, 60)}()\``));
  }

  if (ts.isNewExpression(node)) {
    if (node.expression.getText(src) === 'URL') {
      const args = node.arguments ?? [];
      // `new URL(rel, base)` is rooted at `base` with `rel` appended.
      if (args.length >= 2) return rootOf(args[1], { src, binds, uiRootNames, depth: depth + 1, appended: true });
      return recur(args[0]);
    }
    return done(UNKNOWN(`\`new ${node.expression.getText(src).slice(0, 40)}\``));
  }

  if (ts.isPropertyAccessExpression(node)) {
    const text = node.getText(src);
    if (/(^|[^.\w])import\.meta\.url$/.test(text)) return done(SELF('`import.meta.url`'));
    if (text === 'process.env.PWD' || text === 'process.env.INIT_CWD') return done(AMBIENT(`\`${text}\` is the cwd under another name`));
    // `.pathname` / `.href` on a URL keep whatever the URL was rooted at.
    if (node.name.text === 'pathname' || node.name.text === 'href') return recur(node.expression);
    return done(UNKNOWN(`property \`${text.slice(0, 60)}\``));
  }

  if (ts.isIdentifier(node)) {
    if (node.text === '__dirname' || node.text === '__filename') return done(SELF(`\`${node.text}\``));
    if (uiRootNames.has(node.text)) return done(SELF(`\`${node.text}\` (scripts/ui-root.mjs, rooted on its own file)`));
    const bound = binds.get(node.text);
    if (bound) {
      const r = recur(bound);
      return { ...r, why: `\`${node.text}\` → ${r.why}` };
    }
    return done(UNKNOWN(`binding \`${node.text}\` (parameter, import, or assigned elsewhere)`));
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const value = node.text;
    if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return done(ABSOLUTE(`absolute literal \`${value.slice(0, 50)}\``));
    if (value === '' || value === '.') return done(AMBIENT(`\`${JSON.stringify(value)}\` is the cwd`));
    // ⭐ A bare relative string names no root, which is exactly how it gets the
    // ambient one -- and it carries no `cwd` token for any grep to find.
    return { kind: 'ambient', why: `relative literal \`${value.slice(0, 60)}\` resolves against the cwd`, appended: true };
  }

  if (ts.isTemplateExpression(node)) {
    // `` `${ROOT}/rel` `` -- rooted at the first span, with the rest appended.
    if (node.head.text.length > 0) {
      const head = node.head.text;
      if (head.startsWith('/')) return done(ABSOLUTE(`absolute template head \`${head.slice(0, 40)}\``));
      return { kind: 'ambient', why: `relative template head \`${head.slice(0, 40)}\` resolves against the cwd`, appended: true };
    }
    const first = node.templateSpans[0];
    if (!first) return done(UNKNOWN('empty template'));
    return rootOf(first.expression, { src, binds, depth: depth + 1, appended: true });
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return rootOf(node.left, { src, binds, depth: depth + 1, appended: true });
  }

  if (ts.isConditionalExpression(node)) {
    // Two roots. Ambient on either arm is ambient.
    const a = recur(node.whenTrue);
    const b = recur(node.whenFalse);
    if (a.kind === 'ambient') return a;
    if (b.kind === 'ambient') return b;
    return a.kind === b.kind ? a : done(UNKNOWN('conditional with two different roots'));
  }

  return done(UNKNOWN(ts.SyntaxKind[node.kind]));
}

/**
 * The local names a file imports from `scripts/ui-root.mjs` (objectstack
 * ruling D1). `uiRoot()` is resolved from THAT module's own location, so a
 * read rooted on it is self-rooted in the sense this gate means -- anchored on
 * a file, never on the cwd -- and is classified `self` rather than left blind.
 * Matched on the specifier's basename, so the relative prefix a test spells
 * from its own depth does not matter.
 */
export function uiRootBindingsOf(src) {
  const names = new Set();
  for (const statement of src.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!/(^|\/)ui-root(\.mjs|\.d\.mts|\.mts)?$/.test(statement.moduleSpecifier.text)) continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const el of named.elements) names.add(el.name.text);
  }
  return names;
}

/**
 * Every `const`/`let` binding in the file, name → initializer. First
 * declaration wins, and a later assignment to a `let` is deliberately NOT
 * followed: two initializers is two roots, and this gate answers `unknown`
 * rather than guessing which one a sink saw.
 */
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

/**
 * Every filesystem call in one file, with the root its path resolves from.
 *
 * @param {string} file  Repo-relative path, used for reporting only.
 * @param {string} text  The file's source.
 */
export function sitesIn(file, text) {
  const src = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const binds = bindingsOf(src);
  const fsBindings = fsBindingsOf(src);
  const uiRootNames = uiRootBindingsOf(src);
  /** @type {Array<{ file: string, line: number, sink: string, kind: string, appended: boolean, why: string, text: string }>} */
  const sites = [];

  const walk = (node) => {
    if (ts.isCallExpression(node)) {
      const name = fsSinkName(node, src, fsBindings);
      if (name) {
        const arg = node.arguments[0];
        const root = rootOf(arg, { src, binds, uiRootNames });
        sites.push({
          file,
          line: src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1,
          sink: name,
          kind: root.kind,
          appended: root.appended,
          why: root.why,
          text: (arg ? arg.getText(src) : '').replace(/\s+/g, ' ').slice(0, 140),
        });
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(src);
  return sites;
}

const idOf = (site) => `${site.file}:${site.line}`;
const registeredIds = (entries) => new Set(entries.map((e) => e.split(' -- ')[0].trim()));

/**
 * @param {string} root  The repository root.
 * @param {{ files?: string[] | null, floors?: Record<string, number>, subjects?: readonly string[], baseline?: readonly string[] }} [options]
 *   `files` replaces the `git ls-files` walk (fixtures pass their own list);
 *   `floors` replaces `FLOORS` -- pass `{}` to switch the collapse check off
 *   for a fixture tree, which is legitimately far below every repo floor.
 */
export function scan(root, { files = null, floors = FLOORS, subjects = SUBJECT_IS_THE_CWD, baseline = KNOWN_CWD_ROOTED } = {}) {
  const testFiles = (files ?? trackedFiles(root)).filter((f) => TEST_FILE.test(f));
  const sites = [];
  for (const file of testFiles) {
    let text;
    try {
      text = readFileSync(resolve(root, file), 'utf8');
    } catch {
      continue; // a tracked-but-absent path (a stale index) is not this gate's business
    }
    // Cheap pre-filter: a file that imports no filesystem surface has no sink
    // to classify. It is a SPEED filter and nothing else -- every file that
    // mentions any of these is parsed in full.
    if (!/\bfs\b|node:fs|['"]fs['"]|readFileSync|existsSync|readdirSync|statSync|writeFileSync|mkdirSync/.test(text)) continue;
    sites.push(...sitesIn(file, text));
  }

  const subjectIds = registeredIds(subjects);
  const baselineIds = registeredIds(baseline);

  const violations = [];
  const registered = new Set();
  for (const site of sites) {
    if (site.kind !== 'ambient' || !site.appended) continue;
    const id = idOf(site);
    if (subjectIds.has(id) || baselineIds.has(id)) {
      registered.add(id);
      continue;
    }
    violations.push(site);
  }
  const stale = [...subjectIds, ...baselineIds].filter((id) => !registered.has(id));

  const census = {
    testFiles: testFiles.length,
    filesWithSinks: new Set(sites.map((s) => s.file)).size,
    sinkCalls: sites.length,
    selfRooted: sites.filter((s) => s.kind === 'self').length,
    absoluteRooted: sites.filter((s) => s.kind === 'absolute').length,
    moduleRooted: sites.filter((s) => s.kind === 'module').length,
    ambientRooted: sites.filter((s) => s.kind === 'ambient').length,
    ambientNotAppended: sites.filter((s) => s.kind === 'ambient' && !s.appended).length,
    // ⚠️ The gate's own blind spot, counted on every run. See `--blind`.
    unclassifiedRoots: sites.filter((s) => s.kind === 'unknown').length,
  };

  const vacuous = [];
  for (const [counter, floor] of Object.entries(floors)) {
    if ((census[counter] ?? 0) < floor) vacuous.push({ counter, value: census[counter] ?? 0, floor });
  }

  return { sites, violations, stale, census, vacuous };
}

function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * The census line. ⛔ It names the blind spot in the same breath as the clean
 * verdict, on purpose: a gate that prints only what it checked reads as a claim
 * about everything.
 */
export function summarise({ census }) {
  return (
    `${census.sinkCalls} filesystem call(s) in ${census.filesWithSinks} of ${census.testFiles} test file(s); ` +
    `roots: ${census.selfRooted} self, ${census.absoluteRooted} absolute, ${census.moduleRooted} module-resolved, ` +
    `${census.ambientRooted} ambient (${census.ambientNotAppended} of them reading the cwd itself, which is not this defect); ` +
    `⚠️ ${census.unclassifiedRoots} root(s) NOT CLASSIFIED — this gate does not see those (\`--blind\` lists them)`
  );
}

// ---------------------------------------------------------------------------
// Self-test -- the spellings a grep loses, as cases
// ---------------------------------------------------------------------------

/**
 * ⭐ Every FIRES case is a spelling that a `process.cwd` grep either misses
 * outright or cannot connect to the read it poisons; every SILENT case is a
 * shape this tree really writes and must not redden.
 */
export function selfTest() {
  const cases = [];
  const run = (name, source, want) => {
    const sites = sitesIn('fixture/x.test.ts', source);
    const fired = sites.filter((s) => s.kind === 'ambient' && s.appended);
    const ok = want === 'fires' ? fired.length > 0 : fired.length === 0;
    cases.push({ name, ok, detail: ok ? '' : `${sites.length} site(s): ${sites.map((s) => `${s.kind}${s.appended ? '+append' : ''} (${s.why})`).join('; ')}` });
  };
  const head = `import { existsSync, readFileSync, readdirSync } from 'node:fs';\nimport { join, resolve } from 'node:path';\n`;

  // ── FIRES ────────────────────────────────────────────────────────────────
  run('the plain idiom', `${head}readFileSync(join(process.cwd(), 'packages/x/y.ts'), 'utf8');`, 'fires');
  // THE case: objectui#7799's thirteenth defect, invisible to that census's regex.
  run(
    'the `globalThis as unknown as {…}` cast that dodged objectui#7799\'s own regex',
    `${head}readFileSync(join((globalThis as unknown as { process: { cwd(): string } }).process.cwd(), 'scripts/baseline.json'));`,
    'fires',
  );
  run('reached through `globalThis.process`', `${head}readFileSync(join(globalThis.process.cwd(), 'a/b.ts'));`, 'fires');
  run('an alias bound earlier in the file', `${head}const proc = globalThis.process;\nreadFileSync(join(proc.cwd(), 'a/b.ts'));`, 'fires');
  // The laundered root: the sink line has no `cwd` on it at all.
  run(
    'a root laundered through a const, so the sink line holds no `cwd`',
    `${head}const siteDir = join(process.cwd(), 'apps/site');\nconst read = (f: string) => readFileSync(join(siteDir, f), 'utf8');`,
    'fires',
  );
  run('two hops of laundering', `${head}const a = process.cwd();\nconst b = join(a, 'apps');\nreaddirSync(join(b, 'site'));`, 'fires');
  run('a template literal', `${head}const root = process.cwd();\nreadFileSync(\`\${root}/packages/x/y.ts\`);`, 'fires');
  run('string concatenation', `${head}readFileSync(process.cwd() + '/packages/x/y.ts');`, 'fires');
  // No `cwd` token anywhere: the root is ambient because it was never named.
  run('a bare relative literal, which names no root at all', `${head}readFileSync('e2e/live/.auth/state.json', 'utf8');`, 'fires');
  run('`process.env.PWD`, the cwd under another name', `${head}readFileSync(join(process.env.PWD as string, 'packages/x'));`, 'fires');
  run('`resolve()` with a relative first argument', `${head}readFileSync(resolve('packages/x/y.ts'));`, 'fires');
  run('`resolve()` with no argument at all', `${head}readdirSync(join(resolve(), 'packages'));`, 'fires');
  run('a promise-API sink', `${head}import { readFile } from 'node:fs/promises';\nawait readFile(join(process.cwd(), 'a/b.ts'));`, 'fires');

  // ── SILENT ───────────────────────────────────────────────────────────────
  run(
    'a read rooted on `uiRoot()` from scripts/ui-root.mjs (objectstack ruling D1)',
    `${head}import { uiRoot } from '../../../../scripts/ui-root.mjs';\nreadFileSync(join(uiRoot(), 'packages/x/y.ts'), 'utf8');`,
    'silent',
  );
  run(
    'a read rooted on the imported `UI_ROOT` constant',
    `${head}import { UI_ROOT } from '../../scripts/ui-root.mjs';\nconst DOC = join(UI_ROOT, 'content/docs/x.mdx');\nreadFileSync(DOC, 'utf8');`,
    'silent',
  );
  run(
    'the landed repair: bare `import.meta.url` taken apart by hand',
    `${head}const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname).split('/').slice(0, -5).join('/');\nreadFileSync(join(REPO_ROOT, 'packages/x/y.ts'));`,
    'silent',
  );
  run('the two-argument `new URL` form, which is self-rooted', `${head}import { fileURLToPath } from 'node:url';\nreadFileSync(fileURLToPath(new URL('../x.ts', import.meta.url)));`, 'silent');
  run('`__dirname`', `${head}readFileSync(join(__dirname, '../x.ts'));`, 'silent');
  // The shape PR #7806 rewrote `browser-process-shim-scope.test.ts` INTO.
  run('reading the cwd ITSELF, with nothing appended', `${head}const cwd = process.cwd();\nexistsSync(cwd);`, 'silent');
  run('a temp directory', `${head}import { mkdtempSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nconst dir = mkdtempSync(join(tmpdir(), 'x-'));\nreadFileSync(join(dir, 'a.txt'));`, 'silent');
  run('`require.resolve`, which answers from the module graph', `${head}readFileSync(require.resolve('@objectstack/spec/package.json'), 'utf8');`, 'silent');
  run('an absolute literal', `${head}readFileSync('/etc/hostname');`, 'silent');
  run('a root that arrives as a parameter stays UNKNOWN, not a violation', `${head}const read = (root: string) => readFileSync(join(root, 'a.ts'));`, 'silent');

  // ── the floor itself ─────────────────────────────────────────────────────
  const collapsed = scan(repoRoot(), { files: [], floors: FLOORS });
  cases.push({
    name: 'an empty walk FAILS the run rather than reporting clean',
    ok: collapsed.vacuous.length === Object.keys(FLOORS).length && collapsed.violations.length === 0,
    detail: `vacuous=${collapsed.vacuous.length} of ${Object.keys(FLOORS).length}`,
  });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-test-path-roots self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(`✓ check-test-path-roots self-test: ${cases.length} cases pass (13 spellings that must fire, 8 shapes that must not, and the vacuity floor).`);
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const result = scan(repoRoot());
  const { violations, stale, vacuous } = result;

  if (violations.length === 0 && stale.length === 0 && vacuous.length === 0) {
    console.log(`✅  check-test-path-roots: OK (${summarise(result)}).`);
    process.exit(0);
  }

  if (violations.length > 0) {
    console.error(`❌  check-test-path-roots: ${violations.length} test filesystem read(s) resolve a path BELOW THE PROCESS CWD\n`);
    for (const v of violations) {
      console.error(`    - ${v.file}:${v.line}  ${v.sink}(${v.text})`);
      console.error(`      rooted at ${v.why}`);
    }
    console.error(
      '\n  The cwd is `packages/<pkg>/` under that package\'s own `test` script and the repo\n' +
        '  root under the form CI runs, so this assertion reaches two verdicts (objectui#7799).\n' +
        '  Root it at the file instead — the spelling PR #7796 landed and PR #7806 reused:\n\n' +
        '    const SELF_DEPTH_BELOW_REPO_ROOT = 5; // packages / pkg / src / __tests__ / this file\n' +
        '    const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)\n' +
        '      .split(\'/\')\n' +
        '      .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)\n' +
        '      .join(\'/\');\n\n' +
        '  If the cwd really is the SUBJECT of the read, register it in `SUBJECT_IS_THE_CWD`\n' +
        '  with the reason. ⛔ `KNOWN_CWD_ROOTED` is SHRINK-ONLY.',
    );
  }

  if (stale.length > 0) {
    console.error(`\n❌  check-test-path-roots: ${stale.length} registered entry/entries no longer resolve from the cwd — delete them\n`);
    for (const id of stale) console.error(`    - ${id}`);
  }

  if (vacuous.length > 0) {
    console.error('\n❌  check-test-path-roots: the population COLLAPSED — this run measured nothing\n');
    for (const v of vacuous) console.error(`    - ${v.counter}: found ${v.value}, floor is ${v.floor}`);
  }

  console.error(`\nCensus: ${summarise(result)}`);
  process.exit(1);
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    process.exit(selfTest());
  } else if (process.argv.includes('--json')) {
    console.log(JSON.stringify(scan(repoRoot()), null, 2));
  } else if (process.argv.includes('--blind')) {
    const result = scan(repoRoot());
    for (const s of result.sites.filter((x) => x.kind === 'unknown')) {
      console.log(`${s.file}:${s.line}  ${s.sink}(${s.text})  — ${s.why}`);
    }
    console.log(`\n${result.census.unclassifiedRoots} root(s) this gate cannot classify, out of ${result.census.sinkCalls} filesystem call(s).`);
    console.log('⚠️  A clean run says nothing about these. They are the gate\'s stated boundary, not a to-do list.');
  } else if (process.argv.includes('--list')) {
    const result = scan(repoRoot());
    for (const s of result.sites) {
      console.log(`${(s.kind + (s.appended ? '+append' : '')).padEnd(16)}  ${s.file}:${s.line}  ${s.sink}(${s.text})  — ${s.why}`);
    }
    console.log(`\n${summarise(result)}`);
  } else {
    main();
  }
}
