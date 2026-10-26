#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-side-effects-array -- a `sideEffects` ARRAY must name EXACTLY the
 * modules that register something at load time.
 *
 *   node scripts/check-side-effects-array.mjs           # the verdict
 *   node scripts/check-side-effects-array.mjs --list    # the enumeration, per package
 *
 * ## Why this gate exists (objectui#6683)
 *
 * `sideEffects` is a PUBLISHED CONTRACT: every consumer's bundler reads it and
 * takes it at its word. `@object-ui/app-shell` declares it as an ARRAY because
 * the two simpler answers are both wrong for this package, and both wrongnesses
 * were MEASURED rather than argued:
 *
 *   - omitting the field   -> "assume every module does something on import",
 *                             so nothing in the package is shakeable. Measured
 *                             on the objectui#6683 branch: 3,310,672 bytes
 *                             gzipped in the console's eager closure.
 *   - `sideEffects: false` -> the bundler drops every module whose exports go
 *                             unused, including three live SDUI widget
 *                             registrations (`mcp:connect-agent`,
 *                             `cloud:onboarding-next` -- since retired,
 *                             objectui#12954 -- `cloud:ai-model-status`)
 *                             that the barrel pulls in through BARE side-effect
 *                             imports. They fall to 0 chunks. Closed by
 *                             measurement in objectui#6535 / PR #6682.
 *
 * The array is the honest third answer. Its failure mode is the reason this
 * gate is not optional and ships in the SAME change as the array: an array that
 * is INCOMPLETE fails **silently, in someone else's bundle**. No error, no
 * warning, exit 0 -- the bundler believes it is executing a declaration rather
 * than discovering a defect. That is the same failure mode as `false`, only
 * harder to see, and the maintainer ruling of 2026-08-29 refuses a bare array
 * for exactly that reason.
 *
 * ## The rule, stated once
 *
 *     the array names EXACTLY:  entry forms
 *                             + every module in the package's entry graph that
 *                               performs a top-level REGISTRATION,
 *                               in BOTH its source and its published spelling
 *
 * ...where "the entry graph" is the union over EVERY entry point the manifest
 * publishes, de-duplicated into one module set. See "Which entry forms anchor
 * the walk" below: walking only the barrel made the gate blind in exactly its
 * own failure class, since a registrar reachable only from a secondary entry is
 * never proposed as MISSING and, if the array names it anyway, reads as STALE --
 * so the gate would ARGUE for deleting a correct entry (objectui#8850).
 *
 * Both directions are checked, because a `sideEffects` array can be wrong in
 * two ways and only one of them is loud:
 *
 *   - MISSING  -- a registering module the array does not name. A bundler drops
 *     it and the registration is gone from a consumer's app. Silent.
 *   - STALE    -- a name whose module no longer registers anything. It costs
 *     every consumer bytes, and it reads to the next author as "this module
 *     registers something", which is how a REAL entry gets deleted as noise.
 *
 * ## The enumeration is DERIVED, never listed
 *
 * The ruling is explicit that the implementing change re-derives the set
 * mechanically and never reuses a hand-copied list, so there is no list of
 * module paths anywhere in this file or in the array's neighbourhood -- the
 * array in `package.json` is the CLAIM and this file is the DERIVATION, and the
 * gate is the comparison of the two. A hand-copied enumeration would be a
 * second source of truth free to rot exactly as quietly as the array it was
 * meant to protect.
 *
 * ## What counts as a registration, and why an UNKNOWN effect is an ERROR
 *
 * {@link classifyEffect} sorts every top-level side effect a module's body
 * performs into exactly three buckets, and refuses anything it does not
 * recognise:
 *
 *   - `registration` -- a top-level CALL or `new`, written as a STATEMENT or
 *     performed while a top-level binding is INITIALISED (see the next
 *     section). Not "a call whose name looks like `register`": a name test is
 *     an under-reading, and an under-reading here is precisely the silent drop.
 *     `ComponentRegistry.register(...)`, `registerAppComponent(...)` and a
 *     hypothetical `Registry.add(...)` are indistinguishable to a bundler and
 *     are treated alike here.
 *   - `local-binding-write` -- `X.displayName = 'X'` where `X` is declared in
 *     THIS module and the right-hand side calls nothing. It is provably
 *     module-local: a bundler that drops the module drops its target too, so
 *     nothing outside can observe the difference. This is the carve-out that
 *     keeps three pure React components (and, through them, the route views
 *     they anchor) shakeable.
 *   - `side-effect-only-import` -- `import './x.js';`. A PROPAGATION edge, not
 *     an effect of its own. It is handled by {@link checkReachability} below
 *     rather than by making its importer unshakeable.
 *
 * Anything else is `unknown` and fails the gate with exit 2. That asymmetry is
 * the whole design: a new spelling of a load-time effect must make this gate
 * LOUD, never make it quietly decide the module is pure. "I did not recognise
 * that" and "that is not a registration" must not be the same answer.
 *
 * ## A call inside a top-level `const` initializer (objectui#8578)
 *
 * `export const X = f(...)` declares a binding AND runs `f` at load time. To a
 * bundler those are one statement: a module this array does not name is dropped
 * whole, and `f`'s effect leaves with the binding. Reading that shape as
 * "declares a constant, does nothing" was measured wrong on `@object-ui/types`'
 * `AnyComponentSchema = defineNodeComponentUnion(...)`, whose initializer writes
 * the node recursion point's option slot into a DIFFERENT module (`base.zod.ts`).
 *
 * The widening is NOT "any call in an initializer", and that is a measurement
 * rather than a preference: over this workspace that reading takes
 * `@object-ui/app-shell` from 14 registering modules to 122, because
 * `new Set([...])`, `React.createContext(...)`, `new RegExp(...)` and
 * `React.lazy(...)` are calls that produce the binding's VALUE and nothing else.
 * Naming their modules would spend exactly the consumer bytes the array exists
 * to save. So an initializer registers only when all three hold:
 *
 *   1. the call is EVALUATED NOW. The walk stops at every function boundary, so
 *      a closure that is RETURNED is not a load-time effect -- app-shell's
 *      `withSettleSignal` increments a module counter inside the wrapper it
 *      returns, and reading that as load-time is how this widening would score
 *      a pure wrapper as a registrar. A function handed as an ARGUMENT to a call
 *      being made now IS walked, because that call may invoke it now.
 *   2. the callee RESOLVES inside this package, through relative imports and
 *      re-exports only.
 *   3. that callee WRITES to a binding it did not itself declare -- the same
 *      argument `local-binding-write` makes one level out, applied to the
 *      callee's own scope: anything it did not declare outlives the call and is
 *      observable by someone other than the dropped module.
 *
 * What this still does NOT see, stated here rather than left to silence, since
 * a reader who mistakes silence for absence is the failure this gate is about:
 *
 *   - a call into ANOTHER package (`z.discriminatedUnion`, `React.createContext`,
 *     `new Set`) is read as value-producing. That is the boundary
 *     {@link walkEntryGraph} already draws, for the reason it gives: another
 *     package's load-time behaviour is that package's manifest's problem.
 *   - a registration a module performs only when something CALLS it is not a
 *     load-time effect at all, by construction. ⛔ do not read a zero here as
 *     "this package has no load-time effects", only as "none this gate can
 *     derive".
 *
 * ## Which entry forms anchor the walk (objectui#8850)
 *
 * `exports` keys that start with `.` are SUBPATHS -- separate things a consumer
 * can import, so separate graph roots. Everything below a subpath is a
 * CONDITION or a fallback array, and those choose a build FORMAT of the same
 * subpath. {@link classifyEntryForms} sorts every published form on that
 * structure first and -- only where the structure does not decide -- on what is
 * on disk, into `entry-point`, `duplicate-entry`, `alternate-format` and
 * `asset`, and refuses anything that is none of them.
 *
 * The refusal is the load-bearing half, and it is deliberately NOT "fail when a
 * form cannot be mapped back to a source file". Measured over this workspace:
 * the only two packages declaring an array publish, beside their barrel, a
 * STYLESHEET and the `require` half of the SAME entry. Both are unmappable and
 * neither is a defect, so a gate that failed on unmappable would be red on its
 * entire population on day one. What must be loud is a form this gate cannot
 * CLASSIFY -- because a skipped form is a skipped root, and a registrar behind
 * it would never be proposed as MISSING. Silently skipping it would rebuild the
 * gate's own silent-drop failure class one level up.
 *
 * ### ⛔ What this classification GIVES UP, and why (objectui#9124)
 *
 * `alternate-format` is decided from the manifest's structure alone, so a
 * DANGLING form -- one the manifest declares that will never exist on disk --
 * is no longer DISTINGUISHABLE from a legitimate second build format when it
 * sits under a subpath that already has a real module form. This is a declared
 * trade, and stating it precisely matters more than stating it strongly:
 *
 *   - What is given up is DISCRIMINATING POWER, not visibility. A dangling form
 *     is still LISTED in `alternateFormats`; it just no longer stands ALONE
 *     there.
 *   - It was a REPORTED FIELD, never a refusal. `problems` was empty either
 *     way, so nothing that used to fail now passes.
 *   - The discrimination existed only on a BUILT tree, which is the opposite of
 *     what intuition suggests and is why it is written down here. Compare the
 *     two behaviours on one manifest whose `.` publishes an `import` half and a
 *     `require` half: with `dist/` PRESENT, a produced `require` half existed
 *     and classified as an `asset` while a never-produced one classified as
 *     `unmapped`, so `alternateFormats` was EXACTLY the dangling set. With
 *     `dist/` ABSENT, neither exists, both land in `alternateFormats`, and the
 *     field separates nothing at all.
 *
 * ⇒ the trade is: a verdict that depended on whether `dist/` happened to be
 * present is exchanged for the ability to spot a dangling form sitting beside a
 * real one. Worth it because the first is a red a contributor cannot clear --
 * the artefact it turned on is `.gitignore`d, so the input was not in the tree
 * at all -- and the second was never enforced (objectui#6893, objectui#7460,
 * objectui#7671 are the measured instances of that class in this repo's own
 * gates). The pair of cases named `the verdict does not depend on whether the
 * tree is BUILT` in this gate's test file is what re-derives all of this; ⛔ do
 * not trust this paragraph over them.
 *
 * What the trade costs is bounded by the same structure that creates it: such a
 * form adds no graph root either way, because the module form under its subpath
 * IS the root and an alternate format reaches exactly what that root reaches.
 * So a registrar cannot hide behind it -- which is the harm the refusal below
 * exists to prevent, and it is untouched.
 *
 * ⛔ The gap is NOT widened to dangling forms under a subpath with no module
 * form. There, `existsInPackage` still decides, and a form that is neither a
 * module nor a file on disk is still refused loudly -- that is the `./ghost.js`
 * and subpath-`*` shape, and removing the check there was MEASURED to promote
 * such a form to a graph root and crash the walk on ENOENT.
 *
 * The genuine multi-entry population is ZERO today (a stylesheet is not a graph
 * root; a second format of one entry reaches exactly what that entry reaches),
 * so this widening changes no verdict in this workspace right now. It is the
 * next package with a real second entry -- `@object-ui/types`' `./zod`, whose
 * one load-time effect is unreachable from `src/index.ts`, is the measured
 * demonstration, and it is out of this gate's population only because it
 * declares `sideEffects: false` -- that the widening is for.
 *
 * ## Reachability -- naming a module is not enough
 *
 * A module named in the array is retained only when a RETAINED module still
 * imports it. So the array's promise only holds if every registering module is
 * reachable from an entry form through modules that are THEMSELVES covered.
 * A chain `barrel -> pure-helper -> registrar` breaks: the pure helper is
 * shakeable, so when its exports go unused it is dropped and takes the
 * registrar's edge with it -- the registrar is named, retained by nobody, and
 * gone. {@link checkReachability} rejects that shape.
 *
 * ## Scope, and why this is not the same gate as the consistency pin
 *
 * `scripts/__tests__/side-effects-declaration-consistency.test.ts`
 * (objectui#3943) asks whether a declaration AGREES WITH module bodies across
 * the whole workspace, and proves with a real bundler that the field is honoured
 * at all. It is the wider gate and it stays the authority on that question.
 *
 * This file asks the narrower one the ruling names: for an ARRAY, is the array
 * the exact enumeration? The two are deliberately independent -- they derive the
 * population by different routes (that one folds in the workspace ALIAS tables;
 * this one derives the source barrel and the published spelling from the
 * manifest) -- because two guards that share a derivation fail together.
 *
 * Exit codes follow this tree's convention that a broken gauge must be LOUDER
 * than a reading over the line:
 *
 *   0 -- every array agrees with its enumeration
 *   1 -- an array disagrees (missing / stale / unreachable)
 *   2 -- no trustworthy enumeration (unknown effect, unresolved specifier,
 *        no package found, a spelling map that does not round-trip)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { isEntrypoint } from './invoked-as.mjs';
import { workspaceGlobs as readWorkspaceGlobs } from './workspace-root.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Extensions a bundler tries, in Vite's own order. `.tsx` is why this matters. */
const RESOLVE_EXTENSIONS = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx'];

/** Files whose bodies this gate can parse. A `.css` entry form is not one. */
const MODULE_FILE_RE = /\.(ts|tsx|mts|js|jsx|mjs)$/;

export const EXIT_OK = 0;
export const EXIT_DISAGREES = 1;
export const EXIT_NO_MEASUREMENT = 2;

/** `"./dist/index.js"` and `"dist/index.js"` name one file; compare on this. */
export const normalize = (p) => (p.startsWith('./') ? p.slice(2) : p);

/* -------------------------------------------------------------------------- */
/* The workspace.                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The `packages:` globs of the workspace file that governs `root`, relative to
 * `root` -- read rather than hardcoded so a new workspace root is covered the
 * day it is added, and THROWING on a shape the one parser does not know rather
 * than skipping it, because a guard that silently stops looking at part of the
 * workspace goes on reporting success over a shrinking surface. Where that file
 * is (the objectui root, or the monorepo root one level up) is
 * `scripts/workspace-root.mjs`'s question (objectstack#25723).
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function workspaceGlobs(root = REPO_ROOT) {
  return readWorkspaceGlobs(root);
}

/** @param {string} [root] @returns {string[]} absolute package directories. */
export function workspacePackageDirs(root = REPO_ROOT) {
  const dirs = [];
  for (const glob of workspaceGlobs(root)) {
    if (glob.endsWith('/*')) {
      const parent = path.join(root, glob.slice(0, -2));
      if (!fs.existsSync(parent)) continue;
      for (const d of fs.readdirSync(parent)) {
        const full = path.join(parent, d);
        if (fs.statSync(full).isDirectory()) dirs.push(full);
      }
    } else if (!glob.includes('*')) {
      dirs.push(path.join(root, glob));
    } else {
      throw new Error(`Unsupported workspace glob ${JSON.stringify(glob)} — teach this guard how to expand it.`);
    }
  }
  return dirs;
}

/**
 * Every workspace package whose `sideEffects` is an ARRAY.
 *
 * `false`, `true` and an omitted field are all out of scope here by design:
 * this gate is about the content of an array. The `false` direction is the
 * objectui#3943 consistency pin's, and `true`/omitted are the conservative
 * claim, which can never lose a registration.
 *
 * @param {string} [root]
 */
export function readArrayPackages(root = REPO_ROOT) {
  const found = [];
  for (const dir of workspacePackageDirs(root)) {
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (!manifest.name || !Array.isArray(manifest.sideEffects)) continue;
    if (manifest.sideEffects.some((e) => typeof e !== 'string')) {
      throw new Error(`${manifest.name} declares a non-string \`sideEffects\` entry — teach this guard that shape.`);
    }
    found.push({
      name: manifest.name,
      dir: path.relative(root, dir).split(path.sep).join('/'),
      manifest,
      declared: manifest.sideEffects.map(normalize),
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/* -------------------------------------------------------------------------- */
/* The static scan.                                                            */
/* -------------------------------------------------------------------------- */

/** Statement kinds that RUN when the module is evaluated (rather than declaring). */
function isExecutedStatement(stmt) {
  return (
    ts.isIfStatement(stmt) ||
    ts.isForStatement(stmt) ||
    ts.isForOfStatement(stmt) ||
    ts.isForInStatement(stmt) ||
    ts.isWhileStatement(stmt) ||
    ts.isDoStatement(stmt) ||
    // `try { registerLayout(); } catch {}` — objectui#3899's actual shape.
    ts.isTryStatement(stmt) ||
    ts.isSwitchStatement(stmt) ||
    ts.isBlock(stmt) ||
    ts.isLabeledStatement(stmt) ||
    ts.isThrowStatement(stmt)
  );
}

/** Whether `node` contains a call or a construction anywhere inside it. */
function containsCall(node) {
  let hit = false;
  const walk = (n) => {
    if (hit) return;
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) hit = true;
    else ts.forEachChild(n, walk);
  };
  walk(node);
  return hit;
}

/**
 * Every call EVALUATED when `node` is evaluated. The walk stops at every
 * function boundary, because a call written inside a function body runs when
 * that function is CALLED, not when the module is loaded — `withSettleSignal`
 * in `@object-ui/app-shell` is the measured example: it returns a closure that
 * increments a module counter, and reading that write as load-time is how a
 * widening of this gate scores a pure wrapper as a registrar.
 */
function immediateCalls(node) {
  const calls = [];
  const walk = (n) => {
    if (isFunctionLike(n)) return;
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) calls.push(n);
    ts.forEachChild(n, walk);
  };
  walk(node);
  return calls;
}

/** Anything whose body is deferred until it is called. */
function isFunctionLike(n) {
  return (
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isFunctionDeclaration(n) ||
    ts.isClassDeclaration(n) ||
    ts.isClassExpression(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n)
  );
}

/** `a.b.c` / `a[0]` / `(a as T).b` -> `a`. The binding a write or call is rooted at. */
function rootIdentifier(expr) {
  let node = expr;
  while (node) {
    if (ts.isIdentifier(node)) return node.text;
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node)
    ) {
      node = node.expression;
      continue;
    }
    return undefined;
  }
  return undefined;
}

const sourceCache = new Map();

/** Parse-once, by absolute path. This gate is a one-shot process. */
function parseSource(absFile) {
  let source = sourceCache.get(absFile);
  if (!source) {
    if (!fs.existsSync(absFile) || !MODULE_FILE_RE.test(absFile)) return undefined;
    source = ts.createSourceFile(absFile, fs.readFileSync(absFile, 'utf8'), ts.ScriptTarget.Latest, true);
    sourceCache.set(absFile, source);
  }
  return source;
}

/**
 * The function `name` refers to in `file`, followed through this package's own
 * RELATIVE imports and re-exports.
 *
 * Returns `undefined` for everything the walk cannot reach: a bare package
 * specifier (`z.discriminatedUnion`, `React.createContext`, `new Set`), a
 * namespace or default import, a value that is not a function. That is the same
 * boundary {@link walkEntryGraph} already draws and for the same reason —
 * another package's load-time behaviour is that package's manifest's problem.
 */
function resolveLocalFunction(file, name, seen = new Set(), origin) {
  const key = `${file}#${name}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  // `origin` carries the ONE source that may not exist on disk: the module being
  // classified, which a caller may have parsed from a string. Everything the walk
  // reaches from there is a real file.
  const source = origin && origin.file === file ? origin.source : parseSource(file);
  if (!source) return undefined;

  for (const stmt of source.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.name.text === name) return { file, fn: stmt };
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.name.text !== name) continue;
        const init = d.initializer;
        return init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? { file, fn: init } : undefined;
      }
    }
    if (ts.isClassDeclaration(stmt) && stmt.name && stmt.name.text === name) return undefined;
  }

  for (const stmt of source.statements) {
    const specifier = stmt.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;

    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      const bindings = stmt.importClause.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      const element = bindings.elements.find((e) => e.name.text === name);
      if (!element) continue;
      if (!specifier.text.startsWith('.')) return undefined;
      const abs = resolveRelative(file, specifier.text);
      return abs ? resolveLocalFunction(abs, (element.propertyName ?? element.name).text, seen, origin) : undefined;
    }

    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      const element = stmt.exportClause.elements.find((e) => e.name.text === name);
      if (!element) continue;
      if (!specifier.text.startsWith('.')) return undefined;
      const abs = resolveRelative(file, specifier.text);
      return abs ? resolveLocalFunction(abs, (element.propertyName ?? element.name).text, seen, origin) : undefined;
    }

    if (ts.isExportDeclaration(stmt) && !stmt.exportClause && specifier.text.startsWith('.')) {
      const abs = resolveRelative(file, specifier.text);
      const found = abs ? resolveLocalFunction(abs, name, seen, origin) : undefined;
      if (found) return found;
    }
  }
  return undefined;
}

/** Every identifier `fn` declares itself: parameters, locals, nested declarations. */
function functionScopeBindings(fn) {
  const names = new Set();
  const addBinding = (n) => {
    if (!n) return;
    if (ts.isIdentifier(n)) names.add(n.text);
    else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) {
      for (const el of n.elements) if (ts.isBindingElement(el)) addBinding(el.name);
    }
  };
  for (const p of fn.parameters ?? []) addBinding(p.name);
  const walk = (n) => {
    if (ts.isVariableDeclaration(n) || ts.isParameter(n)) addBinding(n.name);
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name) names.add(n.name.text);
    if (ts.isCatchClause(n) && n.variableDeclaration) addBinding(n.variableDeclaration.name);
    ts.forEachChild(n, walk);
  };
  if (fn.body) walk(fn.body);
  return names;
}

/** Assignment operators. `x = v`, `x ||= v`, `x += v` are all writes. */
const ASSIGNMENT_OPERATORS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** How deep the callee walk follows in-package calls before giving up. */
const CALLEE_DEPTH_LIMIT = 6;

/**
 * Whether calling `fn` writes, AS PART OF THE CALL, to a binding `fn` does not
 * itself declare.
 *
 * "Escaping" is judged against the CALLEE's own scope, and that is the same
 * argument the `local-binding-write` carve-out above makes one level out:
 * anything the callee did not declare outlives the call and is observable by
 * someone other than the module being dropped. `nodeUnionOptions[0] = installed`
 * in `@object-ui/types`' `base.zod.ts` is exactly that shape.
 *
 * Deferred writes do not count: the walk stops at function boundaries, so a
 * closure that is RETURNED rather than run is not a load-time effect. A function
 * handed as an ARGUMENT to a call being made now is walked, because that call
 * may invoke it now.
 */
function performsEscapingWrite(fn, file, depth = 0, seen = new Set(), origin) {
  const key = `${file}@${fn.pos}`;
  if (seen.has(key) || depth > CALLEE_DEPTH_LIMIT) return false;
  seen.add(key);

  const local = functionScopeBindings(fn);
  let found = false;

  const walk = (n) => {
    if (found) return;
    if (isFunctionLike(n)) return;

    if (ts.isBinaryExpression(n) && ASSIGNMENT_OPERATORS.has(n.operatorToken.kind)) {
      const root = rootIdentifier(n.left);
      if (root && !local.has(root)) {
        found = true;
        return;
      }
    }
    if (
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      const root = rootIdentifier(n.operand);
      if (root && !local.has(root)) {
        found = true;
        return;
      }
    }
    if (ts.isCallExpression(n)) {
      const root = rootIdentifier(n.expression);
      if (root && !local.has(root)) {
        const callee = resolveLocalFunction(file, root, new Set(), origin);
        if (callee && performsEscapingWrite(callee.fn, callee.file, depth + 1, seen, origin)) {
          found = true;
          return;
        }
      }
      for (const arg of n.arguments) {
        if (!isFunctionLike(arg) || !arg.body) continue;
        for (const p of arg.parameters ?? []) if (ts.isIdentifier(p.name)) local.add(p.name.text);
        ts.forEachChild(arg.body, walk);
        if (found) return;
      }
    }
    ts.forEachChild(n, walk);
  };

  if (fn.body) walk(fn.body);
  return found;
}

/**
 * Whether a top-level `const`/`let`/`var` statement performs a load-time
 * REGISTRATION through one of its initializers.
 *
 * See the header's "a call in a top-level initializer" section: the call must be
 * evaluated now, its callee must resolve inside this package, and that callee
 * must write somewhere it did not declare.
 */
function initializerRegisters(stmt) {
  const source = stmt.getSourceFile();
  if (!source) return false;
  const origin = { file: source.fileName, source };
  for (const declaration of stmt.declarationList.declarations) {
    if (!declaration.initializer) continue;
    for (const call of immediateCalls(declaration.initializer)) {
      const root = rootIdentifier(call.expression);
      if (!root) continue;
      const callee = resolveLocalFunction(origin.file, root, new Set(), origin);
      if (callee && performsEscapingWrite(callee.fn, callee.file, 0, new Set(), origin)) return true;
    }
  }
  return false;
}

/** Every identifier declared at the top level of this source file. */
function moduleScopeBindings(source) {
  const names = new Set();
  for (const stmt of source.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.add(d.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
      stmt.name &&
      ts.isIdentifier(stmt.name)
    ) {
      names.add(stmt.name.text);
    }
  }
  return names;
}

/**
 * The kind of one top-level side effect: `registration`, `local-binding-write`,
 * `side-effect-only-import`, or `unknown`.
 *
 * `unknown` is the load-bearing return. See the header: a spelling this gate
 * does not recognise must be LOUD, not quietly filed as pure.
 *
 * @param {import('typescript').Statement} stmt
 * @param {Set<string>} localBindings identifiers declared at module scope.
 * @returns {'registration' | 'local-binding-write' | 'side-effect-only-import' | 'unknown' | null}
 *          `null` means the statement performs no top-level side effect at all.
 */
export function classifyEffect(stmt, localBindings) {
  if (ts.isImportDeclaration(stmt)) {
    return stmt.importClause ? null : 'side-effect-only-import';
  }
  if (ts.isExportDeclaration(stmt)) return null;

  if (ts.isExpressionStatement(stmt)) {
    // A bare string is a directive prologue (`'use client'`).
    if (ts.isStringLiteral(stmt.expression)) return null;
    if (containsCall(stmt)) return 'registration';

    const expr = stmt.expression;
    if (
      ts.isBinaryExpression(expr) &&
      expr.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(expr.left)
    ) {
      // `X.displayName = 'X'` where `X` is this module's own binding: nothing
      // outside can observe it once the module is dropped, and the right-hand
      // side is already known call-free (`containsCall` above returned false).
      const target = expr.left.expression;
      if (ts.isIdentifier(target) && localBindings.has(target.text)) return 'local-binding-write';
      return 'unknown';
    }
    if (ts.isBinaryExpression(expr) || ts.isElementAccessExpression(expr) || ts.isPropertyAccessExpression(expr)) {
      return 'unknown';
    }
    // Everything left is an expression evaluated for nothing: `1;`, `x;`.
    return null;
  }

  if (isExecutedStatement(stmt)) {
    if (containsCall(stmt)) return 'registration';
    return 'unknown';
  }

  // A declaration that PERFORMS something while being declared. See the header:
  // the binding is not the only thing a bundler drops with this statement.
  if (ts.isVariableStatement(stmt) && initializerRegisters(stmt)) return 'registration';

  return null;
}

/**
 * One module's top-level effects and its relative import edges.
 *
 * @param {string} absFile
 * @param {string} [root]
 */
export function scanModule(absFile, root = REPO_ROOT) {
  const source = ts.createSourceFile(
    absFile,
    fs.readFileSync(absFile, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  const rel = path.relative(root, absFile).split(path.sep).join('/');
  const at = (n) => source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
  const firstLine = (n) => n.getText(source).split('\n')[0].trim().slice(0, 120);
  const localBindings = moduleScopeBindings(source);

  const effects = [];
  const edges = [];

  for (const stmt of source.statements) {
    if (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) {
      const specifier = stmt.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) {
        edges.push({ specifier: specifier.text, bare: ts.isImportDeclaration(stmt) && !stmt.importClause });
      }
    }
    const kind = classifyEffect(stmt, localBindings);
    if (kind !== null) effects.push({ file: rel, line: at(stmt), kind, text: firstLine(stmt) });
  }

  return { effects, edges };
}

/**
 * Resolve a relative specifier the way this repo's TypeScript sources spell
 * them: ESM-style, with a `.js` extension naming the `.ts` file next to it.
 * Getting this wrong does not fail loudly on its own — it silently truncates
 * the reachable set — so the caller REPORTS an unresolved specifier instead of
 * skipping it.
 */
export function resolveRelative(fromFile, specifier) {
  const rewritten = specifier.replace(/\.js$/, '.ts').replace(/\.jsx$/, '.tsx').replace(/\.mjs$/, '.mts');
  for (const candidate of [rewritten, specifier]) {
    const abs = path.resolve(path.dirname(fromFile), candidate);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.(js|jsx|mjs)$/, ''));
  for (const ext of RESOLVE_EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of RESOLVE_EXTENSIONS) {
      const index = path.join(base, `index${ext}`);
      if (fs.existsSync(index)) return index;
    }
  }
  return undefined;
}

/**
 * Every ENTRY POINT plus every module reachable from any of them by relative
 * import: the set a bundler may shake, and therefore the set the declaration is
 * a promise about.
 *
 * The roots are a SET and the walk is one traversal over a shared `seen` set,
 * so N entry points cost the union of their graphs and never N times one of
 * them — a package whose entries mostly overlap walks barely more than its
 * barrel does (objectui#8850, question 2).
 *
 * Bare package specifiers stop the walk — another package's manifest is that
 * package's problem.
 *
 * @param {string | string[]} entryFiles absolute path(s) to the source entry point(s).
 * @param {string} [root]
 */
export function walkEntryGraph(entryFiles, root = REPO_ROOT) {
  const entryList = Array.isArray(entryFiles) ? entryFiles : [entryFiles];
  const seen = new Set();
  /** @type {Map<string, {effects: any[], edges: any[]}>} */
  const scans = new Map();
  /** @type {Map<string, {from: string, bare: boolean}[]>} */
  const importedBy = new Map();
  const unresolved = [];
  const stack = [...entryList];

  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!MODULE_FILE_RE.test(file) || /\.d\.ts$/.test(file)) continue;

    const scan = scanModule(file, root);
    scans.set(file, scan);
    for (const edge of scan.edges) {
      const resolved = resolveRelative(file, edge.specifier);
      if (!resolved) {
        unresolved.push(`${path.relative(root, file)} -> ${edge.specifier}`);
        continue;
      }
      const list = importedBy.get(resolved) ?? [];
      list.push({ from: file, bare: edge.bare });
      importedBy.set(resolved, list);
      stack.push(resolved);
    }
  }

  return { modules: [...seen], scans, importedBy, unresolved, entries: [...new Set(entryList)] };
}

/* -------------------------------------------------------------------------- */
/* Entry forms and the source <-> published spelling map.                      */
/* -------------------------------------------------------------------------- */

/**
 * Every SUBPATH the manifest publishes, with the forms published under it.
 *
 * The grouping is the whole point, and it is Node's own resolution rule rather
 * than a heuristic: a key of the `exports` map that starts with `.` names a
 * SUBPATH — a distinct thing a consumer can import, and therefore a candidate
 * graph root. Everything BELOW a subpath is a CONDITION (`import`, `require`,
 * `browser`, `default`) or a fallback array, and those select a build FORMAT of
 * the same subpath. Two forms under one subpath are one entry point published
 * twice; two subpaths are two entry points. {@link classifyEntryForms} turns
 * that distinction into graph roots, and nothing downstream has to guess it
 * back out of a flat list.
 *
 * `main` and `module` are the pre-`exports` spelling of the root subpath `.`
 * and are folded into it. `types` is skipped: type declarations are erased and
 * are never a bundling surface. A `null` target publishes nothing.
 */
export function manifestEntrySubpaths(manifest) {
  /** @type {Map<string, Set<string>>} */
  const bySubpath = new Map();
  const add = (subpath, form) => {
    const forms = bySubpath.get(subpath) ?? new Set();
    forms.add(normalize(form));
    bySubpath.set(subpath, forms);
  };

  for (const field of [manifest.main, manifest.module]) {
    if (typeof field === 'string') add('.', field);
  }

  /** Everything below a subpath key: conditions and fallback arrays, never a new subpath. */
  const walkTarget = (subpath, node) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (node.startsWith('./')) add(subpath, node);
      return;
    }
    if (Array.isArray(node)) {
      for (const value of node) walkTarget(subpath, value);
      return;
    }
    if (typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'types') continue;
      walkTarget(subpath, value);
    }
  };

  const exportsField = manifest.exports;
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
    walkTarget('.', exportsField);
  } else if (exportsField !== null && typeof exportsField === 'object') {
    const keys = Object.keys(exportsField);
    // Node's rule: a map whose keys ALL start with `.` is a subpath map; any
    // other object is a bare condition set for the root subpath.
    const isSubpathMap = keys.length > 0 && keys.every((k) => k === '.' || k.startsWith('./'));
    if (isSubpathMap) {
      for (const [key, value] of Object.entries(exportsField)) walkTarget(key, value);
    } else {
      walkTarget('.', exportsField);
    }
  }

  return [...bySubpath.entries()]
    .map(([subpath, forms]) => ({ subpath, forms: [...forms].sort() }))
    .filter((entry) => entry.forms.length > 0)
    .sort((a, b) => a.subpath.localeCompare(b.subpath));
}

/**
 * Every module path a bundler can resolve the PACKAGE to, package-relative —
 * the flat view of {@link manifestEntrySubpaths}, derived from it rather than
 * collected a second time so the two can never disagree about what is
 * published.
 */
export function manifestEntryForms(manifest) {
  const found = new Set();
  for (const entry of manifestEntrySubpaths(manifest)) {
    for (const form of entry.forms) found.add(form);
  }
  return [...found].sort();
}

/**
 * The map between a package's SOURCE spelling and its PUBLISHED spelling, and
 * the source barrel both are anchored on. Both directions: {@link
 * classifyEntryForms} needs the inverse to decide which SECONDARY forms are
 * entry points.
 *
 * Derived, not configured: the published barrel comes from the manifest, the
 * source barrel is found on disk beside it, and the transform is whatever turns
 * one into the other (`src/` -> `dist/`, `.ts`/`.tsx` -> `.js`). The derivation
 * is then required to ROUND-TRIP on the barrel itself, which is the anti-vacuity
 * check: a map that cannot reproduce the one pair it was derived from would
 * quietly mis-spell every other module.
 */
export function deriveSpellingMap(pkg, root = REPO_ROOT) {
  const forms = manifestEntryForms(pkg.manifest);
  const publishedBarrel = forms.find((f) => /(^|\/)index\.(js|mjs|cjs)$/.test(f));
  if (!publishedBarrel) {
    return { error: `${pkg.name}: no published barrel (an \`index.js\`-shaped entry) in main/module/exports` };
  }

  const pkgAbs = path.join(root, pkg.dir);
  let sourceBarrel;
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = `src/index${ext}`;
    if (fs.existsSync(path.join(pkgAbs, candidate))) {
      sourceBarrel = candidate;
      break;
    }
  }
  if (!sourceBarrel) {
    return { error: `${pkg.name}: no source barrel at src/index.* — this gate reads module bodies, so it cannot proceed` };
  }

  const srcRoot = sourceBarrel.split('/')[0];
  const distRoot = publishedBarrel.split('/')[0];
  const publishedExt = path.extname(publishedBarrel);

  /** `src/a/b.tsx` -> `dist/a/b.js`, by the transform derived above. */
  const toPublished = (sourceRel) =>
    `${distRoot}/${sourceRel.slice(srcRoot.length + 1).replace(/\.(tsx|ts|mts|jsx|js|mjs)$/, publishedExt)}`;

  /**
   * The INVERSE: `dist/a/b.js` -> the `src/a/b.*` that produces it, or
   * `undefined` when the source tree contains no module that could.
   *
   * It is the inverse of the transform above and not a second guess at one: the
   * published root is swapped back for the source root, the extension is
   * dropped, and the answer must EXIST on disk as a source module. An extension
   * the transform above could never have produced (a `.cjs` beside a `.js`
   * build, a stylesheet) is still tried stem-first, because a second build
   * FORMAT of a real module is still that module — what decides is whether a
   * source module is there, never what the form is spelled.
   */
  const toSource = (publishedRel) => {
    const prefix = `${distRoot}/`;
    if (!publishedRel.startsWith(prefix)) return undefined;
    const rest = publishedRel.slice(prefix.length);
    const stem = rest.endsWith(publishedExt) ? rest.slice(0, -publishedExt.length) : rest.replace(/\.[^./]+$/, '');
    if (stem === '') return undefined;
    for (const ext of RESOLVE_EXTENSIONS) {
      const candidate = `${srcRoot}/${stem}${ext}`;
      if (fs.existsSync(path.join(pkgAbs, candidate))) return candidate;
    }
    return undefined;
  };

  if (toPublished(sourceBarrel) !== publishedBarrel) {
    return {
      error:
        `${pkg.name}: the source/published spelling map does not round-trip on the barrel — ` +
        `${sourceBarrel} maps to ${toPublished(sourceBarrel)} but the manifest publishes ${publishedBarrel}`,
    };
  }

  // There is deliberately no second round-trip assertion for the inverse. It
  // could not FAIL: `sourceBarrel` above is discovered by the same extension
  // order `toSource` searches, so the two agree by construction, and a guard
  // that cannot fire is not protection. The hazard it would have covered — an
  // inverse that stops landing on source modules — is covered by a check that
  // CAN fire: {@link classifyEntryForms} then classifies nothing, and the
  // barrel's own subpath becomes an unclassifiable form and exits 2.

  return { forms, sourceBarrel, publishedBarrel, srcRoot, distRoot, toPublished, toSource };
}

/* -------------------------------------------------------------------------- */
/* Which published forms are ENTRY POINTS (objectui#8850).                     */
/* -------------------------------------------------------------------------- */

/**
 * Sort every published form into the three things a form can be, and refuse
 * anything that is none of them.
 *
 * The walk is the check, so the question this answers is narrow and mechanical:
 * which forms are NEW GRAPH ROOTS? A form that is not a root is not thereby
 * uninteresting — it is one of two shapes that provably add no reachable module
 * to the enumeration, and each has to be recognised POSITIVELY:
 *
 *   - `entry-point`   -- the inverse of the spelling map lands on a source
 *     module that exists. It is a distinct thing a consumer imports, so it is
 *     walked. A subpath whose source module another subpath already claimed is
 *     an ALIAS of that entry: same root, no new modules, recorded as
 *     `duplicate-entry` rather than silently merged.
 *   - `alternate-format` -- the form is not a module, but a form under the SAME
 *     subpath is. Conditions below a subpath choose a build format, not an
 *     entry: the `require` half of an entry whose `import` half is already a
 *     root reaches exactly the modules that root reaches. ⭐ Decided from the
 *     manifest's own structure and NEVER from the filesystem (objectui#9124):
 *     it is a fact about the DECLARATION, so it must read the same on an
 *     unbuilt checkout as on a built one.
 *   - `asset`         -- the form is not a module, no form under its subpath is
 *     either, and it names a file that exists in the package exactly as
 *     published. A stylesheet is a resolution target and is not a graph root:
 *     there is no import to follow out of it. Positive evidence on both halves
 *     — the file is THERE, and no source module produces it — never "the map
 *     returned undefined".
 *
 * Anything else is UNCLASSIFIED and fails the gate loudly, and that is the
 * asymmetry this function exists for. "Could not MAP this form" must not be the
 * error — both forms this workspace publishes beside a barrel today are
 * unmappable and neither is a defect. "Could not CLASSIFY this form" must be,
 * because a form quietly skipped is a graph root quietly missing, and a
 * registrar reachable only from it would never be proposed as MISSING. That is
 * the gate's own silent-drop failure class, one level up.
 *
 * ⛔ Nothing here reads the `sideEffects` array, and nothing here tests a
 * package name or an extension allow-list. The classification is derived from
 * the manifest's own subpath structure and from what is on disk.
 *
 * @typedef {{subpath: string, kind: 'entry-point' | 'duplicate-entry' | 'asset',
 *            sources: string[], forms: string[], alternateFormats: string[]}} EntryFormVerdict
 *
 * @param {{name: string, dir: string, manifest: any}} pkg
 * @param {{toSource: (form: string) => (string | undefined)}} map from {@link deriveSpellingMap}
 * @param {string} [root]
 * @returns {{entries: EntryFormVerdict[], problems: string[], roots: string[]}}
 */
export function classifyEntryForms(pkg, map, root = REPO_ROOT) {
  const pkgAbs = path.join(root, pkg.dir);
  const existsInPackage = (rel) => {
    const abs = path.join(pkgAbs, rel);
    return fs.existsSync(abs) && fs.statSync(abs).isFile();
  };

  /** @type {EntryFormVerdict[]} */
  const entries = [];
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, string>} sourceRel -> the subpath that first claimed it as a root. */
  const claimedBy = new Map();

  for (const { subpath, forms } of manifestEntrySubpaths(pkg.manifest)) {
    // First pass asks ONE question of each form -- is it a module this gate can
    // walk? -- and nothing else. Sorting the rest happens below, per SUBPATH,
    // because what a non-module form IS depends on its siblings (objectui#9124).
    const classified = forms.map((form) => {
      const inverted = map.toSource(form);
      if (inverted) return { form, kind: 'module', sourceRel: inverted };
      // A form published straight out of the source tree is its own source.
      if (existsInPackage(form) && MODULE_FILE_RE.test(form) && !/\.d\.ts$/.test(form)) {
        return { form, kind: 'module', sourceRel: form };
      }
      return { form, kind: 'non-module' };
    });

    const moduleForms = classified.filter((c) => c.kind === 'module');
    const nonModuleForms = classified.filter((c) => c.kind === 'non-module');

    if (moduleForms.length > 0) {
      // ⛔ Deliberately WITHOUT asking the filesystem (objectui#9124). A
      // non-module form under a subpath that already resolves to a module is an
      // `alternate-format` by the manifest's OWN structure -- conditions below a
      // subpath choose a build FORMAT, not an entry -- and that is a fact about
      // the DECLARATION, true of an unbuilt checkout and a built one alike.
      // Deciding it with `fs.existsSync` made the verdict depend on whether
      // `dist/` happened to be present, on an input that is `.gitignore`d and so
      // is not in the tree at all.
      const sources = [...new Set(moduleForms.map((c) => c.sourceRel))].sort();
      const fresh = sources.filter((s) => !claimedBy.has(s));
      for (const s of fresh) claimedBy.set(s, subpath);
      entries.push({
        subpath,
        kind: fresh.length > 0 ? 'entry-point' : 'duplicate-entry',
        sources,
        forms,
        alternateFormats: nonModuleForms.map((c) => c.form),
      });
      continue;
    }

    // No form under this subpath is a module, so nothing here can be a second
    // build format OF anything -- there is no entry for it to be a format of.
    // What is left must earn `asset` on POSITIVE evidence, which is the
    // existence check, unchanged and still the only thing standing between a
    // DANGLING declaration and a silently skipped graph root.
    const dangling = nonModuleForms.filter((c) => !existsInPackage(c.form));
    if (dangling.length === 0) {
      entries.push({ subpath, kind: 'asset', sources: [], forms, alternateFormats: [] });
      continue;
    }

    const unclassified = dangling.map((c) => `"./${c.form}"`);
    problems.push(
      `${pkg.name}: the manifest publishes the subpath "${subpath}", and this gate cannot CLASSIFY ` +
        `${unclassified.join(', ')}. It is not a form the published/source spelling map inverts to a module that ` +
        `exists, it is not a file present in the package exactly as published, and no other form under the same ` +
        `subpath is an entry point it could be a second build format of. Teach this gate what it is — a form ` +
        `skipped here is a graph ROOT skipped, and a registrar reachable only from it would never be proposed as ` +
        `MISSING. That is this gate's own silent drop, one level up.`,
    );
  }

  return { entries, problems, roots: [...claimedBy.keys()].sort() };
}

/* -------------------------------------------------------------------------- */
/* The verdict.                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A registering module is only retained when a RETAINED module still imports
 * it. This walks back from each registrar to an entry point through COVERED
 * modules only, so a `barrel -> pure-helper -> registrar` chain — where the
 * shakeable helper takes the registrar's only edge with it — is a failure and
 * not a green tick.
 *
 * With several entry points a registrar is retained when ANY of them reaches it
 * through covered modules: a consumer importing that entry keeps the chain
 * alive, and it is not this gate's business which entry they picked. So this
 * check WIDENS with the walk rather than staying anchored on the barrel
 * (objectui#8850, question 3).
 *
 * @param {string | string[]} entryFiles absolute path(s) to the source entry point(s).
 */
export function checkReachability(graph, registrars, entryFiles, root = REPO_ROOT) {
  const entryList = Array.isArray(entryFiles) ? entryFiles : [entryFiles];
  const covered = new Set([...entryList, ...registrars]);
  const reachable = new Set(entryList);
  let grew = true;
  while (grew) {
    grew = false;
    for (const file of covered) {
      if (reachable.has(file)) continue;
      const importers = graph.importedBy.get(file) ?? [];
      if (importers.some((i) => reachable.has(i.from))) {
        reachable.add(file);
        grew = true;
      }
    }
  }
  return registrars
    .filter((r) => !reachable.has(r))
    .map((r) => path.relative(root, r).split(path.sep).join('/'));
}

/**
 * The whole verdict for one array-declaring package.
 *
 * @returns {{name: string, ok: boolean, gauge: boolean, expected: string[], declared: string[],
 *            missing: string[], stale: string[], registrars: string[], problems: string[],
 *            modulesWalked: number, entryPoints: string[], entryForms: EntryFormVerdict[]}}
 */
export function evaluatePackage(pkg, root = REPO_ROOT) {
  const problems = [];
  const map = deriveSpellingMap(pkg, root);
  if (map.error) {
    return {
      name: pkg.name, ok: false, gauge: true, expected: [], declared: pkg.declared,
      missing: [], stale: [], registrars: [], problems: [map.error], modulesWalked: 0,
      entryPoints: [], entryForms: [],
    };
  }

  const pkgAbs = path.join(root, pkg.dir);

  // Every ENTRY POINT is a graph root, not just the barrel (objectui#8850). The
  // classification is what decides which published forms those are; a form it
  // cannot classify is reported here rather than skipped, because skipping it
  // would shrink the enumeration in silence.
  const classification = classifyEntryForms(pkg, map, root);
  problems.push(...classification.problems);

  const entryPoints = [...new Set([map.sourceBarrel, ...classification.roots])].sort();
  const entryAbs = entryPoints.map((rel) => path.join(pkgAbs, rel));
  const graph = walkEntryGraph(entryAbs, root);

  for (const u of graph.unresolved) {
    problems.push(
      `${pkg.name}: unresolved relative specifier ${u} — an unwalked edge silently SHRINKS the enumeration, ` +
        `so it is reported rather than skipped`,
    );
  }

  const registrars = [];
  for (const [file, scan] of graph.scans) {
    for (const effect of scan.effects) {
      if (effect.kind === 'unknown') {
        problems.push(
          `${pkg.name}: ${effect.file}:${effect.line} performs a top-level side effect this gate does not ` +
            `recognise (${effect.text}). Teach \`classifyEffect\` what it is — an unrecognised effect must ` +
            `never be read as "not a registration", which is the silent drop this gate exists to prevent.`,
        );
      }
    }
    if (scan.effects.some((e) => e.kind === 'registration')) registrars.push(file);
  }
  registrars.sort();

  // A registering module needs BOTH spellings: consumers resolve the published
  // one, in-repo bundler aliases resolve the source one, and a bundler reads the
  // same manifest for both.
  //
  // Every entry point needs its SOURCE spelling too, for the same reason the
  // barrel does. Its published spelling is already a manifest form by
  // construction — it is where the entry point was derived FROM — so it is
  // taken from `map.forms` rather than re-spelled through `toPublished`, which
  // would invent a `dist/x.js` for an entry the manifest publishes as
  // `dist/x.cjs` and report the invention as MISSING.
  const expected = new Set(map.forms);
  for (const rel of entryPoints) expected.add(rel);
  for (const abs of registrars) {
    const rel = path.relative(pkgAbs, abs).split(path.sep).join('/');
    expected.add(rel);
    expected.add(map.toPublished(rel));
  }

  const declared = new Set(pkg.declared);
  const missing = [...expected].filter((e) => !declared.has(e)).sort();
  const stale = [...declared].filter((d) => !expected.has(d)).sort();

  for (const entry of pkg.declared) {
    if (entry.includes('*')) {
      problems.push(
        `${pkg.name}: "${entry}" is a glob. This gate compares literal paths, so a pattern would make the ` +
          `comparison vacuous on whatever it covers — spell the modules out.`,
      );
    }
  }

  const unreachable = checkReachability(graph, registrars, entryAbs, root);
  const reachabilityProblems = unreachable.map(
    (m) =>
      `${pkg.name}: ${m} registers at load time, but no chain of \`sideEffects\`-covered modules reaches it ` +
      `from the barrel. Naming it is not enough — every module on the path to it is shakeable and will take ` +
      `its only edge with it.`,
  );

  if (graph.modules.length < 2) {
    problems.push(
      `${pkg.name}: the entry graph walked ${graph.modules.length} module(s) from ${entryPoints.join(', ')} — ` +
        `an enumeration over an empty graph agrees with any array at all`,
    );
  }

  return {
    name: pkg.name,
    ok: missing.length === 0 && stale.length === 0 && problems.length === 0 && reachabilityProblems.length === 0,
    gauge: problems.length > 0,
    expected: [...expected].sort(),
    declared: [...declared].sort(),
    missing,
    stale,
    registrars: registrars.map((r) => path.relative(pkgAbs, r).split(path.sep).join('/')),
    problems: [...problems, ...reachabilityProblems],
    modulesWalked: graph.modules.length,
    entryPoints,
    entryForms: classification.entries,
  };
}

/** @param {string} [root] */
export function evaluate(root = REPO_ROOT) {
  const packages = readArrayPackages(root);
  return { packages, results: packages.map((p) => evaluatePackage(p, root)) };
}

/* -------------------------------------------------------------------------- */

export function main(argv = process.argv.slice(2), root = REPO_ROOT) {
  const { packages, results } = evaluate(root);

  // Anti-vacuity, first and loudest. Every assertion below is a set difference,
  // and every set difference passes trivially over nothing.
  if (packages.length === 0) {
    console.error(
      '❌ No workspace package declares `sideEffects` as an array.\n' +
        '   This gate is a set comparison, and a set comparison over an empty population is green for an\n' +
        '   empty reason. Either the field was removed (then this gate has to be retired deliberately, not\n' +
        '   left passing) or the workspace walk has stopped seeing the packages.',
    );
    return EXIT_NO_MEASUREMENT;
  }

  if (argv.includes('--list')) {
    for (const r of results) {
      console.log(
        `\n${r.name} — ${r.registrars.length} module(s) with a top-level registration, ${r.modulesWalked} walked ` +
          `from ${r.entryPoints.length} entry point(s)`,
      );
      for (const e of r.entryForms ?? []) {
        const target = e.sources.length > 0 ? e.sources.join(', ') : e.forms.join(', ');
        const alt = e.alternateFormats.length > 0 ? `  (+ alternate-format ${e.alternateFormats.join(', ')})` : '';
        console.log(`   [${e.kind}] "${e.subpath}" -> ${target}${alt}`);
      }
      for (const m of r.registrars) console.log(`   ${m}`);
    }
    return EXIT_OK;
  }

  let gauge = false;
  let disagrees = false;

  for (const r of results) {
    if (r.problems.length > 0) {
      gauge = true;
      for (const p of r.problems) console.error(`❌ ${p}`);
      continue;
    }
    if (r.missing.length > 0 || r.stale.length > 0) {
      disagrees = true;
      console.error(`❌ ${r.name}: \`sideEffects\` disagrees with the derived enumeration.`);
      for (const m of r.missing) {
        console.error(
          `   MISSING  "./${m}" — this module registers at load time (or is an entry form) and the array does ` +
            `not name it. A bundler will drop it from a consumer's app, silently.`,
        );
      }
      for (const s of r.stale) {
        console.error(
          `   STALE    "./${s}" — the array names it, but nothing in it registers at load time any more. It ` +
            `costs every consumer bytes and it reads to the next author as a live registration.`,
        );
      }
      console.error(
        `   The enumeration is DERIVED here, never listed: fix the array, or fix the module — whichever half\n` +
          `   is currently false. Run \`node scripts/check-side-effects-array.mjs --list\` to see the set.`,
      );
      continue;
    }
    console.log(
      `✅ ${r.name}: \`sideEffects\` names exactly the ${r.registrars.length} module(s) that register at load ` +
        `time, plus its entry forms (${r.declared.length} entries, ${r.modulesWalked} modules walked from ` +
        `${r.entryPoints.length} entry point(s)).`,
    );
  }

  if (gauge) {
    console.error(
      '\nExit 2 — this is a verdict about the GAUGE, not about the array. Nothing above says the declaration\n' +
        'is wrong; it says the enumeration could not be trusted, which must never be reported as a pass.',
    );
    return EXIT_NO_MEASUREMENT;
  }
  return disagrees ? EXIT_DISAGREES : EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main());
}
