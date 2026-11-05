#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * codemod-split-engine — move whole sections of `ObjectQL`'s method bodies out
 * of `packages/objectql/src/engine.ts` into section modules, move the
 * top-level declarations ahead of the class into one leaf module,
 * deterministically, and prove the move.
 *
 *   node scripts/codemod-split-engine.mjs                 # plan: print the section table, write nothing
 *   node scripts/codemod-split-engine.mjs --write         # apply the split, then verify it
 *   node scripts/codemod-split-engine.mjs --verify --base <ref>
 *                                                         # re-prove a split on disk against engine.ts at <ref>
 *   node scripts/codemod-split-engine.mjs --scoped [--write]
 *                                                         # the second pass (#30052): plan (or apply) ObjectRepository and ScopedContext
 *   node scripts/codemod-split-engine.mjs --scoped --verify --base <ref>
 *                                                         # re-prove the second pass on disk against engine.ts at <ref>
 *   node scripts/codemod-split-engine.mjs --self-test
 *   node scripts/codemod-split-engine.mjs --help          # this usage, on any tree (split or not)
 *
 * ## Why a script, and what it repeats
 *
 * The large-file programme's ruling A (`6583399215`) splits each file by a
 * deterministic codemod that applies the file's existing cut pattern to whole
 * sections, regenerated on the latest `main` at landing instead of rebased.
 * `scripts/codemod-split-sql-driver.mjs` is the pilot; this is the same
 * programme for `engine.ts`, and it applies the cut pattern THIS file's hand
 * series (21 cuts, 25 `engine-*.ts` modules) already uses, which is the
 * pilot's pattern too:
 *
 *  - The method stays on the class with its docblock, modifiers and signature
 *    byte-for-byte, so the published `.d.ts` keeps its names and positions and
 *    an instance spy or a subclass override is still the one callers reach.
 *    Only `async` is dropped from a stub, as every async stub of the series did.
 *  - The body moves, unedited, into an exported function of the same name in
 *    `engine-<section>.ts`, whose `this` is one named host: the `ObjectQL`
 *    members the body reads, typed AS the class members (`ObjectQL['x']`).
 *    A private member is reached the same way as a public one: the indexed
 *    access type names it, and the stub, inside the class, reads it.
 *  - The stub hands the body that host: a method as a closure that calls it on
 *    the engine at call time, a field or accessor as a GETTER that reads it
 *    when the body reads it. Since #30051 the host is ONE object per facet and
 *    engine (`HOSTS_MODULE`, built on first use by a factory the class's static
 *    block installs), so a stub is one line, `Facet.x.call(xHost.of(this), …)`,
 *    instead of a host literal built on every call.
 *
 * Ruling `6591753301` (option A) widened the pattern two ways, and this script
 * applies both, as the pilot does:
 *
 *  - (a) A section module may import VALUES from `engine.ts`. A staying
 *    top-level name a moved body reads is exported for it by one generated
 *    `export { … }` list (the declaration's own text is not touched), and
 *    `index.ts` re-exports by name, so none reaches the package. Every such
 *    use is inside a function body, so the cycle is never read at evaluation.
 *  - (b) The top-level declarations ahead of the class (`const` / `function` /
 *    `interface` / `type`) move WHOLE, with the comments above them, into one
 *    leaf module, `LEAF_MODULE`, in base order. The leaf never imports
 *    `engine.ts` or an `engine-*` module: a declaration that names the class,
 *    an `engine-*` import or a declaration that stays, stays itself. `engine.ts`
 *    imports back what it still reads and re-exports, by name, every moved
 *    declaration it exported, so every importer of `./engine.js` (`index.ts`,
 *    the hand-series modules, the tests) reads what it read.
 *
 * Two things this file needs that the pilot's did not:
 *
 *  - SECTIONS BY ANCHOR. `engine.ts` has five banners in a 17,000-line class,
 *    so a section is named by its FIRST member, in `SECTION_ANCHORS` (the
 *    `protocol.ts` codemod's form): a member belongs to the last anchor at or
 *    above it. An anchor the class does not declare, or anchors out of class
 *    order, stop the script (exit 2): a new section is a decision someone
 *    writes here, never a name the script makes up.
 *  - AN IMPORT PRUNE. The package compiles with `noUnusedLocals`, so an import
 *    binding only moved text read is dropped from `engine.ts`
 *    (`pruneImports`). It is the one edit the undo cannot read back from the
 *    head; the proof recomputes it from the head and requires every pruned
 *    name to occur in a moved body or a moved declaration.
 *
 * ⛔ The moved text is not re-indented and not formatted: the body is the
 * method's `{ … }` exactly as it stood, so byte-identity is equality of text,
 * not equality after a transform.
 *
 * ## What stays, and why (each reason is mechanical)
 *
 * A method stays whole on the class when moving it would change what it does,
 * what the published `.d.ts` says, or what a gate or test that reads
 * `engine.ts` BY PATH sees. `STAY_REASONS` lists every reason for a method and
 * `TOP_STAY_REASONS` every reason for a top-level declaration; the plan prints
 * every one that stayed and why. The reasons that are tables rather than rules
 * are `PATH_READER_PINS` (a name whose text a reader extracts from `engine.ts`
 * by path), `PATH_READER_NEEDLES` (literal text a reader requires to find
 * there) and `CLASS_PATH_READER_NEEDLES` (the same, for a reader that also
 * reads the leaf, so only a method carrying it stays). Ruling `6597555122`
 * item 3: a reader that can read the new modules gains them in its reading
 * list in the same PR instead, and needs no row here.
 *
 * ## The proof (`--write` runs it on its own output; `--verify` re-runs it)
 *
 *  1. Byte-identity: every generated function's body, parameters and return
 *     type are the base method's text, exactly; every leaf declaration is its
 *     base statement's text with the comments above it, exactly; and putting
 *     every body back (and `async` back on its stub), taking the generated
 *     imports and exports out, and splicing the leaf back between the
 *     statements that stayed rebuilds the base `engine.ts` byte-for-byte once
 *     the base's import bindings the head no longer reads are pruned from it
 *     (the prune above), so nothing else in it moved. The leaf's relative
 *     VALUE imports are followed on disk: none may reach `engine.ts` or an
 *     `engine-*` module.
 *  2. The declaration-file bar of ruling `6348891160`, judged by ruling
 *     `6441032442` B's second normalisation (ruling `6597555122` item 2), is a
 *     report reading on two built dists, never a `scripts/` file (that
 *     ruling's item 3); the PR reports it. The pilot's `--dts` reads only
 *     `index.d.ts`, which here re-exports a hashed shared chunk
 *     (`util-<hash>.d.ts`) that holds the declarations, so this script does
 *     not carry it.
 *
 * ## Determinism
 *
 * The input is the text of `engine.ts`. It is parsed in an in-memory project
 * (no `node_modules`, no build output, no clock), every collection is emitted
 * in source order or sorted, and the output is a pure function of the input:
 * two runs on one input write byte-identical trees (the plan prints the output
 * tree's sha256). Only the proof's leaf-reach walk reads sibling files.
 *
 * ## The second pass: `ObjectRepository` and `ScopedContext` (#30052)
 *
 * `engine.ts` declares two more classes after `ObjectQL`, the repository a
 * hook reaches as `ctx.api.object(name)` and the context it reaches as
 * `ctx.api`. `--scoped` facades them with this pass's cut pattern, stay rules
 * and byte-identity proof, one facet module per class (`SCOPED_CLASSES`) and
 * one host per INSTANCE (`SCOPED_HOSTS_MODULE`, #30051's shape keyed by the
 * instance), and it touches no other byte: its input is the `engine.ts` the
 * first pass left, and it is proved against that file, so it is re-run on the
 * latest `main` at landing like the first. Its marker is `SCOPED_MARK`, so the
 * two passes' stubs and files are told apart. Two stay reasons are its own:
 * a body that reads a private member off another instance (`foreign-private`:
 * the class body may, a module function may not) and one that reads a
 * non-public static (`private-static`: the statics route is `ObjectQL`'s).
 *
 * ts-morph is a root devDependency, resolved from the root manifest, as the
 * pilot takes it.
 *
 * Exit codes: 0 done · 1 a proof failed (stop: the generated split is never
 * hand-edited to pass) · 2 the script could not run (unknown anchor, missing
 * prerequisite, bad arguments) · 3 an input does not parse (`ts-parse.mjs`'s
 * refusal, which names the parse errors).
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { parseSourceFile } from './ts-parse.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC_REL = 'packages/objectql/src';
const SRC_DIR = join(ROOT, SRC_REL);
const HOST_BASENAME = 'engine.ts';
const HOST_PATH = join(SRC_DIR, HOST_BASENAME);
const CLASS_NAME = 'ObjectQL';
const CARD = '#29986';
const SCRIPT = 'scripts/codemod-split-engine.mjs';

/** The marker every generated file and stub carries; `--verify` keys on it. */
const MARK = `[${CARD} codemod]`;

/** A generated or hand-series section module of `engine.ts`, by its import specifier. */
const SEAM_SPECIFIER = /^\.\/engine-[a-z0-9-]+\.js$/;

/**
 * The sections of `ObjectQL`, top to bottom, each named by its first member
 * (a field or a method), mapped to the module its movable bodies go to.
 * `null` keeps the section on the class. No module shares a file with a
 * hand-written one: the script refuses to write over a file it did not
 * generate, and the hand series' 25 module names are not reused.
 */
const SECTION_ANCHORS = Object.freeze([
  ['txStore', 'Class head: units, hooks, functions, body runners, hook dispatch', 'engine-hooks-and-functions.ts'],
  ['registerAction', 'Action system and packaged-action activation', 'engine-actions.ts'],
  ['_heldFileResolver', 'Registration seams, readable-ids security, formula and default permissions', 'engine-security-resolvers.ts'],
  ['writeEpoch', 'Authz invalidation, middleware, session, driver options, posture, organization probe', 'engine-middleware-and-context.ts'],
  ['resolveNowDefault', 'Field defaults and autonumbers', 'engine-defaults-and-autonumbers.ts'],
  ['registrationConversionWarned', 'Package, app, plugin, driver and datasource registration', 'engine-registration.ts'],
  ['setRealtimeService', 'Realtime, i18n, home amounts, validation messages, references, master-detail', 'engine-references-and-master-detail.ts'],
  ['setCryptoProvider', 'Crypto, secrets, internal fields, schema and datasource routing, init', 'engine-secrets-and-routing.ts'],
  ['objectHasMediaField', 'Migration flags, value-shape deviations, creation attestations, destroy', 'engine-migration-state.ts'],
  ['MAX_EXPAND_DEPTH', 'Summary indexes, related-record expansion, file and reference hydration', 'engine-summaries-and-expansion.ts'],
  ['resolveWhereTokens', 'Query lowering, search, find and findOne', 'engine-find.ts'],
  ['staticReadonlyCreateStrip', 'Write preparation and insert', 'engine-insert.ts'],
  ['update', 'Update', 'engine-update.ts'],
  ['planCascadeAtomicity', 'Cascade and referential delete planning', 'engine-cascade-planning.ts'],
  ['delete', 'Delete, count, aggregate and execute', 'engine-delete-and-aggregate.ts'],
  ['transaction', 'Transactions', 'engine-transactions-section.ts'],
  ['registerObject', 'Compatibility / convenience API', 'engine-compatibility-section.ts'],
]);

/**
 * The leaf the top-level declarations ahead of the class move to, whole
 * (lever (b) of ruling `6591753301`). A leaf: it never imports `engine.ts` or
 * any `engine-*` module, so it is evaluated before the class and forms no
 * cycle with it.
 */
const LEAF_MODULE = 'engine-top-level.ts';

/**
 * The module that holds each facet's host, one per engine (#30051): a
 * `FacetHost` per facet module, built on first use by the factory the class's
 * static block installs and kept for the engine's life. It imports types only,
 * so it is evaluated before the class whichever module is loaded first, and
 * the class's static block can install into it.
 */
const HOSTS_MODULE = 'engine-facet-hosts.ts';
const HOSTS_CLASS = 'FacetHost';

/**
 * Names whose text a reader takes out of `engine.ts` BY PATH. Moving it would
 * leave that reader reading a stub, or nothing. A class method or a top-level
 * declaration of the name stays. Each row names the reader. A row naming
 * nothing the file declares stops the script (exit 2), so the table cannot rot
 * into names nobody reads.
 */
const QUERY_OPTIONS_GUARD = 'eslint query-options/no-any-erasure grandfathering and scripts/check-query-options-erasure-ratchet.mjs (baseline keyed by path, never grows)';
const PATH_READER_PINS = Object.freeze({
  // The #4918 query-options erasure guard grandfathers its pre-existing sites
  // BY FILE: an `ignores` entry in eslint.config.mjs (QUERY_OPTIONS_UNSWEPT)
  // plus a per-file count in scripts/query-options-erasure-baseline.json, a list
  // that may only shrink. A moved body takes its `opts as any` site to a file
  // the list does not name, so `pnpm lint` and `check:query-options-erasure`
  // red (measured: the six methods below, one site each; the last four once
  // ruling 6624345766 dropped the no-yield rule and let them move).
  seedAutonumber: QUERY_OPTIONS_GUARD,
  inspectDanglingReferences: QUERY_OPTIONS_GUARD,
  probeReferencingRows: QUERY_OPTIONS_GUARD,
  referenceExists: QUERY_OPTIONS_GUARD,
  resolveMasterDetailParent: QUERY_OPTIONS_GUARD,
  resolveMasterDetailParents: QUERY_OPTIONS_GUARD,
});

/**
 * Literal text a reader requires to find in `engine.ts` BY PATH. A class
 * method or a top-level declaration whose text carries one stays, so the
 * reader still finds it where it looks. Each row names the reader. A needle
 * the file no longer carries stops the script (exit 2).
 */
const PATH_READER_NEEDLES = Object.freeze({
});

/**
 * Literal text a reader requires to find in `engine.ts` OR the leaf, but reads
 * in no section module. A method whose text carries one stays on the class; a
 * top-level declaration carrying one moves as any other, because the reader
 * reads the leaf it moves to. The same stale-needle refusal applies.
 */
const CLASS_PATH_READER_NEEDLES = Object.freeze({
});

/**
 * The `ObjectQL` methods a host hands its body as a BOUND reference
 * (`this.m.bind(this)`) rather than as a closure that calls it. The pilot
 * needed one for a gate that refuses an unbound builder call; no gate reads
 * `engine.ts` that way, so the set is empty and every method goes as a
 * closure.
 */
const BOUND_HOST_METHODS = new Set();

/** Every reason a method stays, with the one-line why the plan prints. */
const STAY_REASONS = Object.freeze({
  'no-section': 'declared above the first section anchor',
  'section-kept': 'its section maps to no module',
  'static-this': 'a static method whose body reads `this` (the class; a facet static has its own)',
  'static-name-shared': 'a static method whose name an instance member also takes (one facet cannot hold both)',
  'no-body': 'an overload signature or abstract member',
  'generator': 'a generator',
  'overloaded': 'an overloaded method',
  'decorated': 'a decorated method',
  'not-identifier-name': 'a computed, string or #private name',
  'inferred-return-type': 'a non-private method whose return type is inferred (the .d.ts would infer it through the module)',
  'parameter-shape': 'a destructured or `this` parameter (the stub cannot forward it unchanged)',
  'comment-in-parameters': 'a comment inside its parameter list (one-line parameters would drop it)',
  'path-reader': 'a reader takes its text out of engine.ts by path (PATH_READER_PINS / PATH_READER_NEEDLES / CLASS_PATH_READER_NEEDLES)',
  'arguments': 'its body reads `arguments`',
  'super': 'its body reads `super`',
  'new-target': 'its body reads `new.target`',
  'this-type': 'it names the polymorphic `this` type',
  'bare-this': 'it uses `this` other than as `this.member`',
  'unknown-member': 'it reads a `this.member` the class does not declare',
  'this-write': 'it assigns a `this.member` that is not a field, or deletes one (the host carries a setter for a field only)',
  'method-as-value': 'it reads a method as a value instead of calling it',
  'field-call': 'it calls a field or accessor as a function (the host would change its receiver)',
  'overloaded-host-method': 'it calls an overloaded method (the host closure cannot be typed)',
  'static-write': 'its static reads go through ObjectQLStatics and it assigns a static (the forwarder is read-only)',
  'static-as-value': 'its static reads go through ObjectQLStatics and it reads a static method as a value (a forwarder is another function)',
  'static-field-call': 'its static reads go through ObjectQLStatics and it calls a static field or accessor (the receiver would change)',
  'overloaded-static': 'its static reads go through ObjectQLStatics and it calls an overloaded static (one forwarder cannot carry the overloads)',
  'static-route-conflict': 'its facet module reads the statics through ObjectQLStatics, imported AS `ObjectQL`, and it names `ObjectQL` other than as `ObjectQL.<static>`',
  'module-write': 'it assigns a module-scope binding of engine.ts (an import is read-only)',
  'already-moved': 'its body is already a hand-series seam stub',
  'parameter-shadows': 'a parameter shadows a stub local (`host`, `readX`, `writeX`)',
  'foreign-private': 'it reads a private or protected instance member off a receiver other than `this` (a module function cannot)',
  'private-static': 'it reads a non-public static of its class (the statics route is `ObjectQL`\'s alone; the scoped classes declare none)',
});

/** Every reason a top-level declaration ahead of the class stays in engine.ts. */
const TOP_STAY_REASONS = Object.freeze({
  'top-kind': 'not a const / function / interface / type declaration of plain names',
  'merged-declaration': 'its name is declared by more than one statement (an overload set or a merged declaration)',
  'path-reader': 'a reader takes its text out of engine.ts by path (PATH_READER_PINS / PATH_READER_NEEDLES)',
  'class-reference': 'it names a class engine.ts declares (the leaf would import engine.ts back)',
  'seam-import': 'it uses an import from an engine-* module (the leaf would reach engine.ts back through it)',
  'needs-stayer': 'it names a declaration that stays (the leaf would import engine.ts back)',
});

// ── Loading ts-morph ─────────────────────────────────────────────────────────

let tsMorph = null;

/** ts-morph from the root manifest's devDependencies; a missing install is exit 2, never a stack trace. */
async function loadTsMorph() {
  if (tsMorph) return tsMorph;
  const manifest = join(ROOT, 'package.json');
  try {
    const resolved = createRequire(manifest).resolve('ts-morph');
    const mod = await import(pathToFileURL(resolved).href);
    tsMorph = mod.default ?? mod;
    return tsMorph;
  } catch (error) {
    console.error(
      `✗ codemod-split-engine: PREREQUISITE NOT MET — ts-morph does not resolve from ${manifest} ` +
        `(${error && error.code ? error.code : 'error'}). Run \`pnpm install\` in this worktree.`,
    );
    process.exit(2);
  }
}

/**
 * One in-memory project per parse: no file system, no lib, no build output.
 * The text goes through `ts-parse.mjs`'s checked parse first, which refuses a
 * source with parse errors (its exit 3) instead of handing back a recovered
 * partial tree; ts-morph then reads the same text, already vouched for.
 */
function parse(tm, fileName, text) {
  parseSourceFile(fileName, text);
  const project = new tm.Project({
    useInMemoryFileSystem: true,
    compilerOptions: { target: tm.ts.ScriptTarget.ES2020, strict: true, noLib: true, allowJs: false },
  });
  project.getFileSystem().writeFileSync(fileName, text);
  return project.addSourceFileAtPath(fileName);
}

/** A reason the script cannot run at all (exit 2) — never a verdict on the split. */
class CodemodRefusal extends Error {}

function refuse(message) {
  throw new CodemodRefusal(message);
}

// ── Reading the sections ─────────────────────────────────────────────────────

/**
 * Each member's section: the last anchor at or above it. Refuses an anchor the
 * class does not declare, a duplicate anchor, or anchors out of class order.
 * Returns a function from a member node to its `[anchor, title, module]` row,
 * or null above the first anchor.
 */
function readSections(cls, anchors) {
  const firstStart = new Map();
  for (const m of cls.getMembers()) {
    const name = typeof m.getName === 'function' ? m.getName() : null;
    if (name && !firstStart.has(name)) firstStart.set(name, m.getStart());
  }
  const rows = [];
  const seen = new Set();
  for (const row of anchors) {
    const [anchor] = row;
    if (seen.has(anchor)) refuse(`SECTION_ANCHORS names ${anchor} twice`);
    seen.add(anchor);
    if (!firstStart.has(anchor)) refuse(`SECTION_ANCHORS names ${anchor}, which ${CLASS_NAME} does not declare`);
    rows.push({ row, at: firstStart.get(anchor) });
  }
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].at <= rows[i - 1].at) refuse(`SECTION_ANCHORS out of class order: ${rows[i].row[0]} is declared above ${rows[i - 1].row[0]}`);
  }
  return (member) => {
    let hit = null;
    for (const r of rows) if (r.at <= member.getStart()) hit = r.row;
    return hit;
  };
}
// ── Analysis ─────────────────────────────────────────────────────────────────

/** The names engine.ts binds at module scope, and which of them it exports. */
function moduleScope(tm, sf) {
  const { Node } = tm;
  const bindings = new Map(); // name -> { kind: 'import' | 'local', specifier?, form?, imported?, typeOnly? }
  const exported = new Set();
  const importOrder = new Map(); // specifier -> first position among the import declarations
  for (const st of sf.getStatements()) {
    if (Node.isImportDeclaration(st)) {
      const specifier = st.getModuleSpecifierValue();
      const order = importOrder.has(specifier) ? importOrder.get(specifier) : importOrder.size;
      importOrder.set(specifier, order);
      const declTypeOnly = st.isTypeOnly();
      const def = st.getDefaultImport();
      if (def) bindings.set(def.getText(), { kind: 'import', specifier, form: 'default', typeOnly: declTypeOnly });
      const ns = st.getNamespaceImport();
      if (ns) bindings.set(ns.getText(), { kind: 'import', specifier, form: 'namespace', typeOnly: declTypeOnly });
      for (const spec of st.getNamedImports()) {
        bindings.set((spec.getAliasNode() ?? spec.getNameNode()).getText(), {
          kind: 'import', specifier, form: 'named', imported: spec.getNameNode().getText(),
          typeOnly: declTypeOnly || spec.isTypeOnly(),
        });
      }
      continue;
    }
    if (Node.isExportDeclaration(st)) {
      if (!st.getModuleSpecifier()) for (const spec of st.getNamedExports()) exported.add(spec.getNameNode().getText());
      continue;
    }
    const isExported = Node.isExportable(st) && st.isExported();
    const names = [];
    if (Node.isVariableStatement(st)) {
      for (const decl of st.getDeclarations()) {
        for (const id of [decl.getNameNode(), ...decl.getNameNode().getDescendantsOfKind(tm.SyntaxKind.Identifier)]) {
          if (Node.isIdentifier(id)) names.push(id.getText());
        }
      }
    } else if (typeof st.getName === 'function' && st.getName()) {
      names.push(st.getName());
    }
    for (const name of names) {
      bindings.set(name, { kind: 'local' });
      if (isExported) exported.add(name);
    }
  }
  return { bindings, exported, importOrder };
}

/** Is `node` inside a type node, below `stop`? */
function inTypePosition(tm, node, stop) {
  for (let n = node.getParent(); n && n !== stop; n = n.getParent()) {
    if (tm.ts.isTypeNode(n.compilerNode)) return true;
  }
  return false;
}

/** The node that binds the `this` a `this` keyword at `node` reads. */
function thisContainer(tm, node) {
  const { Node } = tm;
  for (let n = node.getParent(); n; n = n.getParent()) {
    if (
      Node.isFunctionDeclaration(n) || Node.isFunctionExpression(n) || Node.isMethodDeclaration(n) ||
      Node.isConstructorDeclaration(n) || Node.isGetAccessorDeclaration(n) || Node.isSetAccessorDeclaration(n) ||
      Node.isClassDeclaration(n) || Node.isClassExpression(n) || Node.isClassStaticBlockDeclaration(n)
    ) return n;
  }
  return null;
}

/** Is the property access `pa` written (assigned, updated, deleted, destructured into)? */
function isWritten(tm, pa) {
  const { Node, SyntaxKind } = tm;
  let target = pa;
  for (let p = target.getParent(); p; target = p, p = p.getParent()) {
    if (
      Node.isParenthesizedExpression(p) || Node.isArrayLiteralExpression(p) || Node.isObjectLiteralExpression(p) ||
      Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p) || Node.isSpreadElement(p) ||
      Node.isSpreadAssignment(p)
    ) continue;
    break;
  }
  const parent = target.getParent();
  if (!parent) return false;
  if (Node.isBinaryExpression(parent) && parent.getLeft() === target) {
    const op = parent.getOperatorToken().getKind();
    return op >= SyntaxKind.FirstAssignment && op <= SyntaxKind.LastAssignment;
  }
  if (target === pa && (Node.isPrefixUnaryExpression(parent) || Node.isPostfixUnaryExpression(parent))) {
    const op = parent.getOperatorToken();
    return op === SyntaxKind.PlusPlusToken || op === SyntaxKind.MinusMinusToken;
  }
  if (target === pa && Node.isDeleteExpression(parent)) return true;
  if ((Node.isForOfStatement(parent) || Node.isForInStatement(parent)) && parent.getInitializer() === target) return true;
  return false;
}

/** The class's instance members by name: `{ kind: 'method' | 'field' | 'getter' | 'setter', overloaded }`. */
function instanceMembers(tm, cls) {
  const { Node } = tm;
  const members = new Map();
  const note = (name, kind, extra = {}) => {
    const prev = members.get(name);
    if (prev && prev.kind === 'setter' && kind === 'getter') { members.set(name, { kind: 'getter', ...extra }); return; }
    if (prev && prev.kind === 'getter' && kind === 'setter') return;
    members.set(name, { kind, ...extra });
  };
  for (const m of cls.getMembers()) {
    if (Node.isConstructorDeclaration(m)) {
      for (const p of m.getParameters()) if (p.isParameterProperty()) note(p.getName(), 'field');
      continue;
    }
    if (typeof m.isStatic === 'function' && m.isStatic()) continue;
    const nameNode = typeof m.getNameNode === 'function' ? m.getNameNode() : null;
    if (!nameNode || !Node.isIdentifier(nameNode)) continue;
    const name = nameNode.getText();
    if (Node.isMethodDeclaration(m)) note(name, 'method', { overloaded: m.getOverloads().length > 0 });
    else if (Node.isPropertyDeclaration(m)) note(name, 'field');
    else if (Node.isGetAccessorDeclaration(m)) note(name, 'getter');
    else if (Node.isSetAccessorDeclaration(m)) note(name, 'setter');
  }
  return members;
}

/**
 * Read one method: why it must stay (empty = it moves), what its body reads
 * through the host, and which imports its module needs.
 */
function readMethod(tm, ctx, m) {
  const { Node, SyntaxKind } = tm;
  const reasons = [];
  const add = (code, detail) => {
    const tag = detail ? `${code}: ${detail}` : code;
    if (!reasons.includes(tag)) reasons.push(tag);
  };
  const host = new Map(); // member -> 'method' | 'getter'
  const writes = new Set(); // fields the body assigns: the host carries a setter for each
  const imports = new Map(); // local -> { value }
  const moduleRefs = new Map(); // engine.ts top-level name -> { value }
  // The private-static-through-host rule: the statics the body reads as
  // `ObjectQL.x`, whether one is non-public (that takes the route), what the
  // route cannot carry, and whether the body names `ObjectQL` any other way.
  const classStatics = new Map(); // static -> 'method' | 'getter'
  const routeBlockers = [];
  let readsNonPublicStatic = false;
  let classOther = false;
  const result = () => ({ reasons, host, writes, imports, moduleRefs, classStatics, routeBlockers, readsNonPublicStatic, classOther });

  if (m.isStatic() && ctx.members.has(m.getName())) add('static-name-shared');
  if (!m.getBody()) add('no-body');
  if (m.isAbstract && m.isAbstract()) add('no-body');
  if (m.isGenerator()) add('generator');
  if (m.getOverloads().length > 0) add('overloaded');
  if (m.getDecorators().length > 0) add('decorated');
  const nameNode = m.getNameNode();
  if (!Node.isIdentifier(nameNode)) { add('not-identifier-name'); return result(); }
  const name = nameNode.getText();
  if (!m.getReturnTypeNode() && m.getScope() !== 'private') add('inferred-return-type');
  for (const p of m.getParameters()) {
    // A defaulted identifier forwards as it is: the stub keeps the default and
    // hands the body the value it produced.
    if (!Node.isIdentifier(p.getNameNode()) || p.getName() === 'this') add('parameter-shape', p.getName());
  }
  const body = m.getBody();
  if (!body) return result();

  // A comment between the parentheses that no parameter's own text carries.
  const params = m.getParameters();
  const open = m.getFirstChildByKindOrThrow(SyntaxKind.OpenParenToken);
  const close = m.getFirstChildByKindOrThrow(SyntaxKind.CloseParenToken);
  let between = ctx.text.slice(open.getEnd(), close.getStart());
  for (const p of [...params].reverse()) {
    between = between.slice(0, p.getStart() - open.getEnd()) + between.slice(p.getEnd() - open.getEnd());
  }
  if (/\/\/|\/\*/.test(between)) add('comment-in-parameters');

  const methodText = m.getText();
  for (const needle of Object.keys(ctx.needles)) if (methodText.includes(needle)) add('path-reader', JSON.stringify(needle));
  for (const needle of Object.keys(ctx.classNeedles)) if (methodText.includes(needle)) add('path-reader', JSON.stringify(needle));
  if (Object.prototype.hasOwnProperty.call(ctx.pins, name)) add('path-reader', name);

  const regions = [...m.getTypeParameters(), ...params, m.getReturnTypeNode(), body].filter(Boolean);
  const checker = ctx.sf.getProject().getTypeChecker().compilerObject;
  for (const region of regions) {
    const nodes = [region, ...region.getDescendants()];
    for (const node of nodes) {
      const kind = node.getKind();
      if (kind === SyntaxKind.SuperKeyword) add('super');
      if (kind === SyntaxKind.ThisType) add('this-type');
      if (Node.isMetaProperty(node) && node.getKeywordToken() === SyntaxKind.NewKeyword) add('new-target');
      if (Node.isPropertyAccessExpression(node) && node.getExpression().getKind() !== SyntaxKind.ThisKeyword) {
        // `other.x` where `x` is a private or protected INSTANCE member of the
        // class: legal in the class body, refused in a module function. (A
        // static is the statics route's question, not this one.)
        const foreign = foreignNonPublicMember(tm, ctx, checker, node);
        if (foreign) add('foreign-private', foreign);
      }
      if (kind === SyntaxKind.ThisKeyword) {
        if (thisContainer(tm, node) !== m) continue;
        if (m.isStatic()) { add('static-this'); continue; }
        const parent = node.getParent();
        if (!Node.isPropertyAccessExpression(parent) || parent.getExpression() !== node) { add('bare-this'); continue; }
        const memberNameNode = parent.getNameNode();
        if (!Node.isIdentifier(memberNameNode)) { add('bare-this'); continue; }
        const member = memberNameNode.getText();
        const info = ctx.members.get(member);
        if (!info) { add('unknown-member', member); continue; }
        if (isWritten(tm, parent)) {
          // A field is written through a host setter; a method, an accessor or
          // a `delete` cannot be.
          if (info.kind === 'field' && !Node.isDeleteExpression(parent.getParent())) writes.add(member);
          else add('this-write', member);
        }
        const outer = parent.getParent();
        const called = Node.isCallExpression(outer) && outer.getExpression() === parent;
        if (info.kind === 'method') {
          if (!called) add('method-as-value', member);
          if (info.overloaded) add('overloaded-host-method', member);
          host.set(member, 'method');
        } else if (info.kind === 'setter') {
          add('this-write', member);
        } else {
          if (called) add('field-call', member);
          host.set(member, 'getter');
        }
        continue;
      }
      if (kind !== SyntaxKind.Identifier) continue;
      if (node.getText() === 'arguments') {
        const parent = node.getParent();
        const isName = Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node;
        if (!isName) add('arguments');
      }
      const parent = node.getParent();
      let symbol;
      if (Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === node) {
        symbol = checker.getShorthandAssignmentValueSymbol(parent.compilerNode);
      } else {
        symbol = checker.getSymbolAtLocation(node.compilerNode);
      }
      if (!symbol || !symbol.declarations) continue;
      for (const decl of symbol.declarations) {
        if (decl.getSourceFile() !== ctx.sf.compilerNode) continue;
        const ts = tm.ts;
        const typePos = inTypePosition(tm, node, m);
        if (ts.isImportSpecifier(decl) || ts.isImportClause(decl) || ts.isNamespaceImport(decl)) {
          const local = node.getText();
          const prev = imports.get(local);
          imports.set(local, { value: Boolean(prev && prev.value) || !typePos });
          continue;
        }
        if (!isModuleScopeDecl(ts, decl)) continue;
        // Lever (a) of ruling 6591753301: a module-scope name is imported —
        // from the leaf when it moved there, from `engine.ts` (exported
        // for it) when it stayed. Two things a module function cannot do:
        // reach a non-public static of the class, and assign an import.
        const declName = decl.name && ts.isIdentifier(decl.name) ? decl.name.text : node.getText();
        if (ts.isClassDeclaration(decl) && declName === (ctx.className ?? CLASS_NAME)) {
          const access = node.getParent();
          const info = !typePos && Node.isPropertyAccessExpression(access) && access.getExpression() === node
            ? ctx.statics.get(access.getName()) : null;
          if (info) {
            const member = access.getName();
            if (info.scope !== 'public') readsNonPublicStatic = true;
            const outer = access.getParent();
            const called = Node.isCallExpression(outer) && outer.getExpression() === access;
            const block = (tag) => { if (!routeBlockers.includes(tag)) routeBlockers.push(tag); };
            if (isWritten(tm, access) || info.kind === 'setter') block(`static-write: ${member}`);
            if (info.kind === 'method' && !called) block(`static-as-value: ${member}`);
            if (info.kind === 'method' && info.overloaded) block(`overloaded-static: ${member}`);
            if (info.kind !== 'method' && called) block(`static-field-call: ${member}`);
            classStatics.set(member, info.kind === 'method' ? 'method' : 'getter');
          } else {
            classOther = true;
          }
        }
        if (!typePos && isWritten(tm, node)) add('module-write', declName);
        const prev = moduleRefs.get(declName);
        moduleRefs.set(declName, { value: Boolean(prev && prev.value) || !typePos });
      }
    }
  }

  const binding = ctx.scope.bindings.get(name);
  // A hand-series seam stub calls the `engine-*` import of its own name; a
  // method that only shares the name (`ObjectRepository#count` beside the
  // hand-series `count`) and never reads that import is not one.
  if (binding && binding.kind === 'import' && SEAM_SPECIFIER.test(binding.specifier) && imports.has(name)) add('already-moved', binding.specifier);
  for (const p of params) {
    const pn = p.getName();
    if (pn === 'host' || /^(read|write)[A-Z]/.test(pn)) add('parameter-shadows', pn);
  }
  // A body that reads a non-public static takes the route; what the route
  // cannot carry keeps it on the class. (A module another mover routes
  // applies the same to every mover in it: `plan`.)
  if (readsNonPublicStatic) {
    for (const tag of routeBlockers) add(tag);
    if (classOther) add('static-route-conflict');
  }
  return result();
}

/** The name of the class's non-public instance member `pa` reads, or null. */
function foreignNonPublicMember(tm, ctx, checker, pa) {
  const ts = tm.ts;
  const nameNode = pa.getNameNode();
  if (!tm.Node.isIdentifier(nameNode)) return null;
  const symbol = checker.getSymbolAtLocation(nameNode.compilerNode);
  for (const decl of symbol?.declarations ?? []) {
    const owner = ts.isParameter(decl) && decl.parent && ts.isConstructorDeclaration(decl.parent) ? decl.parent.parent : decl.parent;
    if (owner !== ctx.cls.compilerNode) continue;
    const flags = ts.getCombinedModifierFlags(decl);
    if (flags & ts.ModifierFlags.Static) continue;
    if (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return nameNode.getText();
  }
  return null;
}

function isModuleScopeDecl(ts, decl) {
  if (ts.isVariableDeclaration(decl)) {
    const statement = decl.parent && decl.parent.parent;
    return Boolean(statement && ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent));
  }
  if (ts.isBindingElement(decl)) {
    let n = decl;
    while (n && !ts.isVariableDeclaration(n)) n = n.parent;
    return Boolean(n && isModuleScopeDecl(ts, n));
  }
  return Boolean(decl.parent && ts.isSourceFile(decl.parent)) &&
    (ts.isFunctionDeclaration(decl) || ts.isClassDeclaration(decl) || ts.isInterfaceDeclaration(decl) ||
      ts.isTypeAliasDeclaration(decl) || ts.isEnumDeclaration(decl) || ts.isModuleDeclaration(decl));
}

// ── The plan ─────────────────────────────────────────────────────────────────

/** `engine-transactions-section.ts` -> `TransactionsSectionHost`. */
function hostNameOf(moduleFile) {
  const slug = moduleFile.replace(/^engine-/, '').replace(/\.ts$/, '');
  return `${slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('')}Host`;
}

/** `engine-transactions-section.ts` -> `TransactionsSectionFacet`: the stateless class the bodies move into. */
function facetNameOf(moduleFile) {
  return hostNameOf(moduleFile).replace(/Host$/, 'Facet');
}

/** `engine-transactions-section.ts` -> `transactionsSectionHost`: the module's `FacetHost` in `HOSTS_MODULE`. */
function hostVarOf(moduleFile) {
  const name = hostNameOf(moduleFile);
  return `${name[0].toLowerCase()}${name.slice(1)}`;
}

/** The object the class fills with forwarders to the statics the facets read, and its type. */
const STATICS_NAME = `${CLASS_NAME}Statics`;
const STATICS_HOST_NAME = `${CLASS_NAME}StaticsHost`;
/** How a routed facet module names the class as a type: `ObjectQL` there is `ObjectQLStatics`. */
const CLASS_TYPE_ALIAS = `${CLASS_NAME}Class`;

/** The placeholder above a moved public or protected body: its docblock stays on the class. */
const placeholderDoc = (name, className = CLASS_NAME) => `/** The body of \`${className}#${name}\`; the method's docblock there is its contract. */`;

/**
 * The statics block `engine.ts` carries for the routed facets: the type and
 * the object ahead of the class, and the static block at the end of the class
 * that fills the object. `kinds` maps each routed static to `method` (a
 * forwarder that calls it on the class) or `getter` (read when read). Pure:
 * `verify` rebuilds both texts from the base class and compares them.
 */
function staticsTexts(kinds) {
  const members = [...kinds.keys()].sort();
  const ahead = [
    `// ${MARK} The statics of \`${CLASS_NAME}\` its facet modules read, private ones included, as`,
    `// the class declares them (an indexed access on the class). The static block at the end of`,
    `// the class fills \`${STATICS_NAME}\` with forwarders: a method is called on the class at`,
    '// call time, a field or accessor is read when the body reads it. A facet module imports',
    `// \`${STATICS_NAME}\` AS \`${CLASS_NAME}\`, so each moved body reads \`${CLASS_NAME}.x\` unedited;`,
    '// `index.ts` re-exports neither, so neither reaches the package.',
    `export interface ${STATICS_HOST_NAME} {`,
    ...members.map((n) => `  readonly ${n}: (typeof ${CLASS_NAME})['${n}'];`),
    '}',
    `export const ${STATICS_NAME} = {} as ${STATICS_HOST_NAME};`,
  ].join('\n');
  const block = [
    `  // ${MARK} Fills \`${STATICS_NAME}\` (declared above the class) for the facet modules.`,
    '  static {',
    `    Object.defineProperties(${STATICS_NAME}, {`,
    ...members.map((n) => (kinds.get(n) === 'method'
      ? `      ${n}: { value: (...args: Parameters<typeof ${CLASS_NAME}.${n}>) => ${CLASS_NAME}.${n}(...args) },`
      : `      ${n}: { get: () => ${CLASS_NAME}.${n} },`)),
    '    });',
    '  }',
  ].join('\n');
  return { ahead, block };
}

/**
 * The facet hosts (#30051): `HOSTS_MODULE`'s text, and the static block at the
 * end of the class that installs one host factory per facet into it. `facets`
 * lists each facet module whose bodies read the class, with `members` (member
 * -> `method` | `getter`, the union over its bodies) and `written` (the fields
 * a body assigns). The host is the module's whole `<Section>Host`, so every
 * stub of the facet hands its body the same object, which carries every
 * member any body of the facet reads (a `Pick` of it is what each body's
 * `this` names). Each member forwards as the per-call literal did: a method
 * as a closure that calls it on the engine at call time, a field or accessor
 * as a getter read when the body reads it, a written field with a setter that
 * assigns it on the engine. So a spy or subclass override installed after the
 * host was built is still the one reached, and the only thing a body can tell
 * apart is that two calls see the same host object, which no moved body can
 * observe: a body that reads `this` bare stays on the class (`bare-this`).
 * Pure: `verify` rebuilds both texts from the head's host interfaces and the
 * base class, and compares them.
 */
function hostsTexts(facets) {
  const sorted = [...facets].sort((a, b) => (a.moduleFile < b.moduleFile ? -1 : a.moduleFile > b.moduleFile ? 1 : 0));
  const module = [
    '// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.',
    '',
    '/**',
    ` * ${MARK} The host of each facet of \`${CLASS_NAME}\`, built ONCE per engine (#30051):`,
    ` * what every stub of a facet hands that facet's bodies as \`this\`, in place of`,
    ' * a host literal built on every call. Each `FacetHost` below is filled by the',
    ` * factory \`${CLASS_NAME}\`'s static block installs, the one place that can read`,
    ' * the class\'s private members; the host is built on the first call that needs',
    ' * it and kept for the engine\'s life. A method goes as a closure that calls it',
    ' * on the engine at call time, a field or accessor as a getter (and a setter',
    ' * when a body assigns it), so a body reads and writes the engine exactly as',
    ' * the per-call literal let it.',
    ' *',
    ` * Written by \`${SCRIPT}\`; it imports types only, so it forms no`,
    ' * evaluation cycle and is evaluated before the class whichever module loads',
    ' * first. `index.ts` re-exports nothing from this module.',
    ' */',
    '',
    `import type { ${CLASS_NAME} } from './engine.js';`,
    ...sorted.map((f) => `import type { ${hostNameOf(f.moduleFile)} } from './${f.moduleFile.replace(/\.ts$/, '.js')}';`),
    '',
    `/** One facet's host for each engine: built on first use, kept for the engine's life. */`,
    `export class ${HOSTS_CLASS}<H> {`,
    `  private readonly hosts = new WeakMap<${CLASS_NAME}, H>();`,
    `  private build: ((engine: ${CLASS_NAME}) => H) | undefined;`,
    '',
    '  constructor(private readonly facet: string) {}',
    '',
    `  /** Called once, from \`${CLASS_NAME}\`'s static block. */`,
    `  install(build: (engine: ${CLASS_NAME}) => H): void {`,
    '    this.build = build;',
    '  }',
    '',
    '  /** The host of `engine`, built on first use. */',
    `  of(engine: ${CLASS_NAME}): H {`,
    '    let host = this.hosts.get(engine);',
    '    if (host === undefined) {',
    '      if (this.build === undefined) {',
    `        throw new Error(\`\${this.facet}: ${CLASS_NAME} has not installed its host factory\`);`,
    '      }',
    '      host = this.build(engine);',
    '      this.hosts.set(engine, host);',
    '    }',
    '    return host;',
    '  }',
    '}',
    '',
    ...sorted.map((f) => `export const ${hostVarOf(f.moduleFile)} = new ${HOSTS_CLASS}<${hostNameOf(f.moduleFile)}>('${facetNameOf(f.moduleFile)}');`),
    '',
  ].join('\n');
  const block = [
    `  // ${MARK} Installs each facet's host factory (\`${HOSTS_MODULE}\`): a static block adds`,
    '  // no member to the class, so the published `.d.ts` does not move.',
    '  static {',
    ...sorted.flatMap((f) => [
      `    ${hostVarOf(f.moduleFile)}.install((engine) => ({`,
      ...[...f.members.keys()].sort().flatMap((member) => {
        if (f.members.get(member) === 'getter') {
          return [`      get ${member}() { return engine.${member}; },`,
            ...(f.written.has(member) ? [`      set ${member}(v) { engine.${member} = v; },`] : [])];
        }
        if (BOUND_HOST_METHODS.has(member)) return [`      get ${member}() { return engine.${member}.bind(engine); },`];
        return [`      ${member}: (...a) => engine.${member}(...a),`];
      }),
      '    }));',
    ]),
    '  }',
  ].join('\n');
  return { module, block };
}

/** Is `node` inside a JSDoc comment? A `{@link X}` there is prose, not a use. */
function inJsDoc(tm, node) {
  for (let n = node.compilerNode; n; n = n.parent) {
    if (n.kind >= tm.SyntaxKind.FirstJSDocNode && n.kind <= tm.SyntaxKind.LastJSDocNode) return true;
  }
  return false;
}

/** The statement of `sf` (a direct child of the source file) a declaration belongs to. */
function topStatementOf(ts, decl) {
  let n = decl;
  while (n.parent && !ts.isSourceFile(n.parent)) n = n.parent;
  return n.parent ? n : null;
}

/** The names a top-level statement declares, or null when one is not a plain identifier. */
function declaredNames(tm, st) {
  const { Node } = tm;
  if (Node.isVariableStatement(st)) {
    const names = [];
    for (const d of st.getDeclarations()) {
      if (!Node.isIdentifier(d.getNameNode())) return null;
      names.push(d.getName());
    }
    return names;
  }
  if (Node.isFunctionDeclaration(st) || Node.isInterfaceDeclaration(st) || Node.isTypeAliasDeclaration(st)) {
    return st.getName() ? [st.getName()] : null;
  }
  return null;
}

/**
 * Lever (b): read every top-level statement between the last import and the
 * class, and decide which move whole into the leaf. A mover never names the
 * class, an `engine-*` module's import, or a statement that stays — so the
 * leaf it lands in never imports `engine.ts` back. Pure.
 */
function planTopLevel(tm, ctx) {
  const { Node, SyntaxKind } = tm;
  const ts = tm.ts;
  const stmts = ctx.sf.getStatements();
  const clsIndex = stmts.indexOf(ctx.cls);
  let lastImport = -1;
  stmts.forEach((st, i) => { if (Node.isImportDeclaration(st)) lastImport = i; });
  const checker = ctx.sf.getProject().getTypeChecker().compilerObject;
  const nameCount = new Map();
  for (const st of stmts) {
    for (const n of declaredNames(tm, st) ?? []) nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
  }
  const records = [];
  const byStatement = new Map();
  for (let i = lastImport + 1; i < clsIndex; i += 1) {
    const st = stmts[i];
    const names = declaredNames(tm, st);
    const record = {
      node: st, names: names ?? [], label: names ? names.join(', ') : `(${st.getKindName()})`,
      exported: Node.isExportable(st) && st.isExported(), reasons: [],
      deps: new Set(), imports: new Map(),
      startLine: st.getStartLineNumber(true), lines: st.getEndLineNumber() - st.getStartLineNumber(true) + 1,
      typeOnly: Node.isInterfaceDeclaration(st) || Node.isTypeAliasDeclaration(st),
    };
    const add = (code, detail) => {
      const tag = detail ? `${code}: ${detail}` : code;
      if (!record.reasons.includes(tag)) record.reasons.push(tag);
    };
    if (!names || (Node.isVariableStatement(st) && st.hasDeclareKeyword()) ||
      (Node.isFunctionDeclaration(st) && (!st.getBody() || st.hasDeclareKeyword()))) add('top-kind');
    for (const n of record.names) if ((nameCount.get(n) ?? 0) > 1) add('merged-declaration', n);
    for (const n of record.names) if (Object.prototype.hasOwnProperty.call(ctx.pins, n)) add('path-reader', n);
    const fullText = st.getFullText();
    for (const needle of Object.keys(ctx.needles)) if (fullText.includes(needle)) add('path-reader', JSON.stringify(needle));
    for (const node of st.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (inJsDoc(tm, node)) continue;
      const parent = node.getParent();
      const symbol = Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === node
        ? checker.getShorthandAssignmentValueSymbol(parent.compilerNode)
        : checker.getSymbolAtLocation(node.compilerNode);
      if (!symbol || !symbol.declarations) continue;
      for (const decl of symbol.declarations) {
        if (decl.getSourceFile() !== ctx.sf.compilerNode) continue;
        const typePos = inTypePosition(tm, node, st);
        if (ts.isImportSpecifier(decl) || ts.isImportClause(decl) || ts.isNamespaceImport(decl)) {
          const local = node.getText();
          const binding = ctx.scope.bindings.get(local);
          if (binding && (SEAM_SPECIFIER.test(binding.specifier) || binding.specifier === './engine.js')) add('seam-import', local);
          const prev = record.imports.get(local);
          record.imports.set(local, { value: Boolean(prev && prev.value) || !typePos });
          continue;
        }
        if (!isModuleScopeDecl(ts, decl)) continue;
        const owner = topStatementOf(ts, decl);
        if (!owner || owner === st.compilerNode) continue;
        if (owner === ctx.cls.compilerNode) { add('class-reference'); continue; }
        record.deps.add(owner);
      }
    }
    records.push(record);
    byStatement.set(st.compilerNode, record);
  }
  // A mover may not name a statement that stays: close over the stayers until stable.
  for (let changed = true; changed;) {
    changed = false;
    for (const r of records) {
      if (r.reasons.length > 0) continue;
      for (const owner of r.deps) {
        const dep = byStatement.get(owner);
        if (!dep || dep.reasons.length > 0) {
          const depName = dep ? dep.label : (declaredNames(tm, ctx.sf.getStatements().find((s) => s.compilerNode === owner)) ?? ['?']).join(', ');
          r.reasons.push(`needs-stayer: ${depName}`);
          changed = true;
          break;
        }
      }
    }
  }
  const movers = records.filter((r) => r.reasons.length === 0);
  const moverNames = new Map();
  for (const r of movers) for (const n of r.names) moverNames.set(n, r);
  return { records, movers, moverNames };
}

/**
 * Which moved top-level names the text that STAYS in `engine.ts` still
 * reads, value or type: everything outside the moved statements and the moved
 * method bodies, JSDoc excepted. Those are what `engine.ts` imports back
 * from the leaf.
 */
function hostUsesOfMovers(tm, ctx, top, methodRecords) {
  const { SyntaxKind } = tm;
  const ts = tm.ts;
  const checker = ctx.sf.getProject().getTypeChecker().compilerObject;
  const skip = [];
  for (const r of top.movers) skip.push([r.node.getFullStart(), r.node.getEnd()]);
  for (const r of methodRecords) if (r.reasons.length === 0) skip.push([r.node.getBody().getStart(), r.node.getBody().getEnd()]);
  const uses = new Map();
  for (const node of ctx.sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const at = node.getStart();
    if (skip.some(([a, b]) => at >= a && at < b)) continue;
    if (inJsDoc(tm, node)) continue;
    const name = node.getText();
    if (!top.moverNames.has(name)) continue;
    const symbol = checker.getSymbolAtLocation(node.compilerNode);
    if (!symbol || !symbol.declarations) continue;
    const mover = top.moverNames.get(name);
    if (!symbol.declarations.some((d) => topStatementOf(ts, d) === mover.node.compilerNode)) continue;
    const typePos = inTypePosition(tm, node, ctx.sf);
    const prev = uses.get(name);
    uses.set(name, { value: Boolean(prev && prev.value) || !typePos });
  }
  return uses;
}

/**
 * Read `text` (an `engine.ts`) and decide, per method, where its body goes,
 * and per top-level declaration ahead of the class, whether it moves to the
 * leaf. Pure: the same text gives the same plan.
 */
function plan(tm, text, {
  anchors = SECTION_ANCHORS, pins = PATH_READER_PINS, needles = PATH_READER_NEEDLES, classNeedles = CLASS_PATH_READER_NEEDLES,
} = {}) {
  const sf = parse(tm, HOST_PATH, text);
  const cls = sf.getClass(CLASS_NAME);
  if (!cls) refuse(`no class ${CLASS_NAME} in ${HOST_BASENAME}`);
  const sectionOf = readSections(cls, anchors);
  // The class's statics: scope, and what a forwarder in `ObjectQLStatics`
  // would be (a method forwards as a function; a field or accessor as a getter).
  const statics = new Map();
  for (const m of cls.getMembers()) {
    if (typeof m.isStatic === 'function' && m.isStatic() && typeof m.getName === 'function') {
      const { Node } = tm;
      const prev = statics.get(m.getName());
      const kind = Node.isMethodDeclaration(m) ? 'method' : Node.isSetAccessorDeclaration(m) ? (prev ? prev.kind : 'setter')
        : Node.isGetAccessorDeclaration(m) ? 'getter' : 'field';
      statics.set(m.getName(), {
        scope: typeof m.getScope === 'function' ? m.getScope() : 'public', kind,
        overloaded: Node.isMethodDeclaration(m) && m.getOverloads().length > 0,
      });
    }
  }
  const ctx = { text, sf, cls, members: instanceMembers(tm, cls), scope: moduleScope(tm, sf), statics, pins, needles, classNeedles };
  for (const n of [STATICS_NAME, STATICS_HOST_NAME, ...SECTION_ANCHORS.filter((row) => row[2]).map((row) => facetNameOf(row[2]))]) {
    if (ctx.scope.bindings.has(n)) refuse(`${HOST_BASENAME} already binds ${n}, a name this script generates`);
  }
  const methodNames = new Set(cls.getMethods().map((m) => m.getName()));
  const stalePins = Object.keys(pins).filter((n) => !methodNames.has(n) && !ctx.scope.bindings.has(n));
  if (stalePins.length > 0) refuse(`PATH_READER_PINS names what ${HOST_BASENAME} no longer declares: ${stalePins.join(', ')}`);
  const staleNeedles = Object.keys(needles).filter((n) => !text.includes(n));
  if (staleNeedles.length > 0) refuse(`PATH_READER_NEEDLES names text ${HOST_BASENAME} no longer carries: ${staleNeedles.map((n) => JSON.stringify(n)).join(', ')}`);
  const staleClassNeedles = Object.keys(classNeedles).filter((n) => !text.includes(n));
  if (staleClassNeedles.length > 0) refuse(`CLASS_PATH_READER_NEEDLES names text ${HOST_BASENAME} no longer carries: ${staleClassNeedles.map((n) => JSON.stringify(n)).join(', ')}`);

  const top = planTopLevel(tm, ctx);

  const records = [];
  for (const m of cls.getMethods()) {
    const startLine = m.getStartLineNumber(true);
    const section = sectionOf(m);
    const read = readMethod(tm, ctx, m);
    const name = m.getName();
    if (!section) read.reasons.unshift('no-section');
    else if (section[2] === null) read.reasons.unshift('section-kept');
    const lineCount = m.getEndLineNumber() - startLine + 1;
    const body = m.getBody();
    const bodyLines = body ? body.getEndLineNumber() - body.getStartLineNumber() + 1 : 0;
    // Docblock ownership (ruling 6624345766 item 1): a PRIVATE method's
    // docblock moves with its body; a public or protected one stays on the
    // facade, where the published surface prints it.
    const docStart = m.getStart(true);
    const doc = m.getScope() === 'private' && docStart < m.getStart() ? text.slice(docStart, m.getStart()) : null;
    const record = {
      name, node: m, section: section ? section[1] : null, module: section ? section[2] : null,
      startLine, lineCount, bodyLines, doc, docLines: doc ? doc.split('\n').length - 1 : 0, ...read,
    };
    if (section && section[2]) {
      for (const p of m.getParameters()) if (p.getName() === facetNameOf(section[2])) read.reasons.push(`parameter-shadows: ${p.getName()}`);
    }
    if (record.reasons.length === 0) record.stubLines = stubBody(record, record.module, '  ').split('\n').length;
    records.push(record);
  }

  // The private-static-through-host rule, per facet module: once one mover
  // reads the statics through `ObjectQLStatics` (imported AS `ObjectQL`),
  // every mover in that module does, so what the route cannot carry keeps a
  // mover on the class. A router itself never carries a blocker (readMethod
  // already kept it), so the set of routed modules is stable.
  for (let changed = true; changed;) {
    changed = false;
    for (const movers of groupMovers(records).values()) {
      if (!movers.some((r) => r.readsNonPublicStatic)) continue;
      for (const r of movers) {
        const extra = [...r.routeBlockers, ...(r.classOther ? ['static-route-conflict'] : [])].filter((t) => !r.reasons.includes(t));
        if (extra.length > 0) { r.reasons.push(...extra); changed = true; }
      }
    }
  }
  const modules = groupMovers(records);
  const routedModules = new Set();
  const routedStatics = new Map();
  for (const [moduleFile, movers] of modules) {
    if (!movers.some((r) => r.readsNonPublicStatic)) continue;
    routedModules.add(moduleFile);
    for (const r of movers) for (const [member, kind] of r.classStatics) routedStatics.set(member, kind);
  }
  for (const [moduleFile, movers] of modules) {
    const facet = facetNameOf(moduleFile);
    for (const r of movers) {
      for (const local of [...r.imports.keys(), ...r.moduleRefs.keys()]) {
        if (local === facet || local === hostNameOf(moduleFile) || local === CLASS_TYPE_ALIAS) {
          refuse(`${moduleFile}: ${r.name} reads ${local}, a name this script generates in that module`);
        }
      }
    }
  }
  const hostUses = hostUsesOfMovers(tm, ctx, top, records);

  // What each side imports across the cut: the section modules read moved
  // names from the leaf and staying names from engine.ts (lever (a));
  // engine.ts reads moved names from the leaf.
  const sectionLeafNames = new Set();
  const hostExportsForSections = new Map(); // staying name -> { value }
  for (const movers of modules.values()) {
    for (const r of movers) {
      for (const [n, use] of r.moduleRefs) {
        if (top.moverNames.has(n)) { sectionLeafNames.add(n); continue; }
        if (n === CLASS_NAME || ctx.scope.exported.has(n)) continue;
        const prev = hostExportsForSections.get(n);
        hostExportsForSections.set(n, { value: Boolean(prev && prev.value) || use.value });
      }
    }
  }
  const leafExports = [];
  for (const r of top.movers) {
    if (r.exported) continue;
    for (const n of r.names) if (hostUses.has(n) || sectionLeafNames.has(n)) leafExports.push(n);
  }
  return { sf, cls, ctx, records, modules, top, hostUses, leafExports, hostExportsForSections, routedModules, routedStatics };
}

/** Movers grouped by module, modules in the order their first member appears. */
function groupMovers(records) {
  const byModule = new Map();
  for (const r of records) {
    if (r.reasons.length > 0 || !r.module) continue;
    if (!byModule.has(r.module)) byModule.set(r.module, []);
    byModule.get(r.module).push(r);
  }
  return byModule;
}

// ── Generation ───────────────────────────────────────────────────────────────


const byName = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
const leafSpecifier = () => `./${LEAF_MODULE.replace(/\.ts$/, '.js')}`;

/**
 * One `import` / `export` statement over `names`: on one line when it fits in
 * 120 columns, else one name per wrapped run, two-space indented.
 */
function namedStatement(head, names, tail) {
  const one = `${head} { ${names.join(', ')} }${tail}`;
  if (one.length <= 120) return one;
  const out = [`${head} {`];
  let line = ' ';
  for (const n of names) {
    if (line.length + n.length + 2 > 118 && line !== ' ') { out.push(line); line = ' '; }
    line += ` ${n},`;
  }
  out.push(line);
  out.push(`}${tail}`);
  return out.join('\n');
}

/** `import { … }` and `import type { … }` from one specifier, values first. */
function importPair(specifier, uses) {
  const out = [];
  const entries = [...uses.entries()].sort(byName);
  const values = entries.filter(([, u]) => u.value).map(([n]) => n);
  const types = entries.filter(([, u]) => !u.value).map(([n]) => n);
  if (values.length > 0) out.push(namedStatement('import', values, ` from '${specifier}';`));
  if (types.length > 0) out.push(namedStatement('import type', types, ` from '${specifier}';`));
  return out;
}

/**
 * The import lines a module needs: engine.ts's own imports it uses, in
 * engine.ts's import order; then the moved top-level names, from the leaf;
 * then what stayed in engine.ts (lever (a)), including the class.
 */
function importLines(scope, users, { needsHost = false, moduleRefs = new Map(), leafNames = new Map(), routed = false, className = CLASS_NAME } = {}) {
  const bySpecifier = new Map();
  for (const r of users) {
    for (const [local, use] of r.imports) {
      const b = scope.bindings.get(local);
      if (!b || b.kind !== 'import') refuse(`import binding ${local} not found`);
      if (!bySpecifier.has(b.specifier)) bySpecifier.set(b.specifier, new Map());
      const slot = bySpecifier.get(b.specifier);
      const prev = slot.get(local);
      slot.set(local, { ...b, value: Boolean(prev && prev.value) || (use.value && !b.typeOnly) });
    }
  }
  const out = [];
  const specifiers = [...bySpecifier.keys()].sort((a, b) => scope.importOrder.get(a) - scope.importOrder.get(b));
  for (const specifier of specifiers) {
    const entries = [...bySpecifier.get(specifier).entries()].sort(byName);
    const named = (value) => entries
      .filter(([, e]) => e.form === 'named' && e.value === value)
      .map(([local, e]) => (e.imported === local ? local : `${e.imported} as ${local}`));
    const def = entries.find(([, e]) => e.form === 'default');
    const ns = entries.find(([, e]) => e.form === 'namespace');
    const valueNamed = named(true);
    const defValue = def && def[1].value ? def[0] : null;
    if (defValue || valueNamed.length > 0) {
      const parts = [defValue, valueNamed.length > 0 ? `{ ${valueNamed.join(', ')} }` : null].filter(Boolean);
      out.push(`import ${parts.join(', ')} from '${specifier}';`);
    }
    if (def && !def[1].value) out.push(`import type ${def[0]} from '${specifier}';`);
    if (ns) out.push(`import ${ns[1].value ? '' : 'type '}* as ${ns[0]} from '${specifier}';`);
    const typeNamed = named(false);
    if (typeNamed.length > 0) out.push(`import type { ${typeNamed.join(', ')} } from '${specifier}';`);
  }
  const fromLeaf = new Map();
  const fromHost = new Map();
  for (const [n, use] of moduleRefs) (leafNames.has(n) ? fromLeaf : fromHost).set(n, use);
  if (routed) {
    // The private-static-through-host rule: `ObjectQL.x` in a moved body reads
    // the forwarder object; the host interface names the class by an alias.
    fromHost.delete(CLASS_NAME);
    fromHost.set(`${STATICS_NAME} as ${CLASS_NAME}`, { value: true });
    if (needsHost) fromHost.set(`${CLASS_NAME} as ${CLASS_TYPE_ALIAS}`, { value: false });
  } else if (needsHost && !fromHost.has(className)) fromHost.set(className, { value: false });
  out.push(...importPair(leafSpecifier(), fromLeaf));
  out.push(...importPair('./engine.js', fromHost));
  return out;
}

/** `text` wrapped into ` * ` comment lines no wider than `width`. */
function wrapComment(words, width = 80) {
  const lines = [];
  let line = ' *';
  for (const w of words) {
    if (line.length + 1 + w.length > width && line !== ' *') { lines.push(line); line = ' *'; }
    line += ` ${w}`;
  }
  if (line !== ' *') lines.push(line);
  return lines;
}

function paramsText(m) {
  return m.getParameters().map((p) => p.getText());
}

function forwardList(m) {
  return m.getParameters().map((p) => (p.isRestParameter() ? `...${p.getName()}` : p.getName()));
}

function moduleText(moduleFile, title, movers, scope, leafNames, routed = false) {
  const hostName = hostNameOf(moduleFile);
  const facet = facetNameOf(moduleFile);
  const classType = routed ? CLASS_TYPE_ALIAS : CLASS_NAME;
  const hostMembers = new Map();
  const written = new Set();
  for (const r of movers) for (const [member, kind] of r.host) hostMembers.set(member, kind);
  for (const r of movers) for (const member of r.writes) written.add(member);
  const needsHost = hostMembers.size > 0;
  const moduleRefs = new Map();
  for (const r of movers) {
    for (const [n, use] of r.moduleRefs) {
      const prev = moduleRefs.get(n);
      moduleRefs.set(n, { value: Boolean(prev && prev.value) || use.value });
    }
  }
  const readsHostValues = [...moduleRefs].some(([n, use]) => use.value && !leafNames.has(n));
  const names = movers.map((r) => `\`${r.name}\`${r === movers[movers.length - 1] ? '' : ','}`);
  const out = [];
  out.push('// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.');
  out.push('');
  out.push('/**');
  out.push(...wrapComment([MARK, 'The', `"${title}"`, 'section', 'of', '`ObjectQL`:', 'the', 'bodies', 'of',
    ...names, 'moved', 'out', 'of', '`engine.ts`', 'whole', 'by', `\`${SCRIPT}\`.`]));
  out.push(' *');
  out.push(` * A MOVE, not a redesign. {@link ${facet}} is a stateless facet of \`ObjectQL\``);
  out.push(' * (ruling 6624345766): each static method of it is the body of the `ObjectQL`');
  out.push(' * method of the same name exactly as it stood: not re-indented, not');
  out.push(' * formatted, not edited. The method stays on the class as a one-call stub with');
  out.push(' * its signature, so the published surface, an instance spy and a subclass');
  out.push(' * override are what they were. A public or protected method keeps its');
  out.push(' * docblock on the class, the contract; a private method\'s docblock moved here');
  out.push(' * with its body. The state stays on `ObjectQL`.');
  out.push(' *');
  if (needsHost) {
    out.push(...wrapComment((`The bodies reach the class through {@link ${hostName}}: exactly the \`ObjectQL\` ` +
      'members they read, private ones included. Every stub hands its body, by a `.call`, the same host: ' +
      `\`${hostVarOf(moduleFile)}\` in \`${HOSTS_MODULE}\`, built once per engine by the class's static block. ` +
      'Methods go as closures that call them on the engine at call time, so a subclass override or an ' +
      'instance spy is still the one reached; fields and accessors go as GETTERS, read when the body reads ' +
      'them, as they were on the class, and a field a body assigns goes with a SETTER that assigns it on ' +
      'the engine.').split(' ')));
  } else {
    out.push(' * No body reads an `ObjectQL` member, so each stub calls its body directly.');
  }
  if (routed) {
    out.push(' *');
    out.push(` * \`ObjectQL\` here is \`${STATICS_NAME}\` (imported AS \`ObjectQL\`): forwarders to the`);
    out.push(' * statics the bodies read, private ones included, which the class fills in a');
    out.push(` * static block; the class as a type is \`${CLASS_TYPE_ALIAS}\`.`);
  }
  out.push(' *');
  if (readsHostValues) {
    out.push(' * Values that stayed in `engine.ts` are imported from it (lever (a) of');
    out.push(' * ruling 6591753301); every use is inside a function body, so the import');
    out.push(' * cycle is never read at evaluation time. `index.ts` re-exports nothing from');
    out.push(' * this module.');
  } else {
    out.push(' * The module imports `engine.ts` for types only, so the two modules form no');
    out.push(' * evaluation cycle. `index.ts` re-exports nothing from this module.');
  }
  out.push(' */');
  out.push('');
  out.push(...importLines(scope, movers, { needsHost, moduleRefs, leafNames, routed }));
  if (needsHost) {
    out.push('');
    out.push('/**');
    out.push(` * The \`ObjectQL\` members the bodies of {@link ${facet}} read — every one of`);
    out.push(' * them, and no other. Each is typed AS the class member (an indexed access on');
    out.push(' * the class), so a change to a member\'s signature on the class is a change');
    out.push(' * here too. `readonly` members are the getters; the others are fields a body');
    out.push(' * assigns.');
    out.push(' */');
    out.push(`export interface ${hostName} {`);
    for (const member of [...hostMembers.keys()].sort()) {
      const ro = hostMembers.get(member) === 'getter' && !written.has(member);
      out.push(`  ${ro ? 'readonly ' : ''}${member}: ${classType}['${member}'];`);
    }
    out.push('}');
  }
  out.push('');
  out.push(`/** The bodies of the "${title}" section of \`ObjectQL\`: a stateless facet, called by the class's stubs. */`);
  out.push(`export class ${facet} {`);
  movers.forEach((r, i) => {
    const m = r.node;
    const picks = [...r.host.keys()].sort().map((k) => `'${k}'`).join(' | ');
    const params = [...(r.host.size > 0 ? [`this: Pick<${hostName}, ${picks}>`] : []), ...paramsText(m)];
    const ret = m.getReturnTypeNode() ? `: ${m.getReturnTypeNode().getText()}` : '';
    if (i > 0) out.push('');
    const typeParams = m.getTypeParameters().length > 0 ? `<${m.getTypeParameters().map((t) => t.getText()).join(', ')}>` : '';
    out.push(`  ${r.doc ?? `${placeholderDoc(r.name)}\n  `}static ${m.isAsync() ? 'async ' : ''}${r.name}${typeParams}(${params.join(', ')})${ret} ${m.getBody().getText()}`);
  });
  out.push('}');
  out.push('');
  return out.join('\n');
}

/**
 * The leaf: the moved top-level statements, each its base text exactly (its
 * leading comments and blank lines included), in base order, after the
 * imports they use; then one `export { … }` of the moved names base did not
 * export and something outside the leaf now imports.
 */
function leafText(scope, top, leafExports) {
  // The header is `//` lines, not a `/** */` docblock: the bundled `.d.ts`
  // keeps a JSDoc block that leads a module's first statement, and a leaf
  // bundled first would publish text the base did not carry (the pilot's
  // measurement: 14 added lines in dist/index.d.ts).
  const out = [];
  out.push('// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.');
  out.push('');
  out.push(...wrapComment([MARK, 'The', 'top-level', 'declarations', 'ahead', 'of', '`ObjectQL`', 'in', '`engine.ts`',
    'that', 'moved', 'out', 'whole', 'by', `\`${SCRIPT}\``, '(lever', '(b)', 'of', 'ruling',
    '6591753301).']).map((l) => l.replace(/^ \*/, '//')));
  out.push('//');
  out.push('// A MOVE, not a redesign: each declaration below is its `engine.ts` text');
  out.push('// exactly, with the comments above it, in the order it stood there. A LEAF:');
  out.push('// it imports neither `engine.ts` nor any `engine-*` module, so it is');
  out.push('// evaluated before the class and forms no cycle with it. `engine.ts`');
  out.push('// re-exports, by name, every declaration here it exported before, so every');
  out.push('// importer of `./engine.js` reads what it read.');
  out.push('');
  out.push(...importLines(scope, top.movers));
  let text = out.join('\n');
  for (const r of top.movers) text += r.node.getFullText();
  if (leafExports.length > 0) {
    text += `\n\n// ${MARK} Declared above without \`export\`, and read by \`engine.ts\` or a section module.\n`;
    text += `${namedStatement('export', [...leafExports].sort(), ';')}`;
  }
  return `${text}\n`;
}

const DOC_MOVED = 'its docblock with it';

/**
 * A stub's body: the marker line, then ONE call of the facet member of the
 * same name. A body that reads the class is called with its facet's host, the
 * one object per engine `HOSTS_MODULE` keeps (#30051), not a literal built per
 * call. `node` is the method (base or head: the stub keeps its signature).
 * Pure: `verify` rebuilds every stub with it and compares.
 */
function stubBody({ node, name, usesHost, docMoved }, moduleFile, closeIndent, mark = MARK) {
  const ind = `${closeIndent}  `;
  const hostName = hostNameOf(moduleFile);
  // A generic method calls its body INSTANTIATED with its own type
  // parameters (`Function#call` alone would erase them).
  const typeArgs = node.getTypeParameters().map((t) => t.getName());
  const fn = typeArgs.length > 0 ? `(${facetNameOf(moduleFile)}.${name}<${typeArgs.join(', ')}>)` : `${facetNameOf(moduleFile)}.${name}`;
  const out = ['{'];
  const args = forwardList(node).join(', ');
  const doc = docMoved ? `, ${DOC_MOVED}` : '';
  if (!usesHost) {
    out.push(`${ind}// ${mark} The body moved to \`${moduleFile}\`${doc}.`);
    out.push(`${ind}return ${fn}(${args});`);
  } else {
    out.push(`${ind}// ${mark} The body moved to \`${moduleFile}\`${doc} (see \`${hostName}\`).`);
    out.push(`${ind}return ${fn}.call(${hostVarOf(moduleFile)}.of(this)${args ? `, ${args}` : ''});`);
  }
  out.push(`${closeIndent}}`);
  return out.join('\n');
}

/** The facets whose bodies read the class, as `hostsTexts` takes them, from the movers of each module. */
function facetsOf(modules) {
  const facets = [];
  for (const [moduleFile, movers] of modules) {
    const members = new Map();
    const written = new Set();
    for (const r of movers) for (const [member, kind] of r.host) members.set(member, kind);
    for (const r of movers) for (const member of r.writes) written.add(member);
    if (members.size > 0) facets.push({ moduleFile, members, written });
  }
  return facets;
}

/**
 * Apply a plan to `text`. Returns `{ host, modules, pruned }`: the new
 * `engine.ts`, a Map of module basename -> text (the leaf among them), and the
 * import bindings the prune dropped. Pure.
 */
function generate(tm, text, planned) {
  const { sf, ctx, modules, top, hostUses, leafExports, hostExportsForSections, routedModules, routedStatics } = planned;
  const edits = [];
  const importBlock = [];
  if (top.movers.length > 0) {
    const leafUses = new Map([...hostUses].filter(([n]) => top.moverNames.has(n)));
    const lines = importPair(leafSpecifier(), leafUses);
    if (lines.length > 0) {
      importBlock.push(`\n// ${MARK} The top-level declarations that moved whole to \`${LEAF_MODULE}\`, as this file still reads them.`);
      for (const l of lines) importBlock.push(`\n${l}`);
    }
    const reexports = top.movers.filter((r) => r.exported)
      .flatMap((r) => r.names.map((n) => [n, r.typeOnly ? `type ${n}` : n]))
      .sort(byName).map(([, spelled]) => spelled);
    if (reexports.length > 0) {
      importBlock.push(`\n// ${MARK} Re-exported by name, so every importer of \`./engine.js\` reads what it read.`);
      importBlock.push(`\n${namedStatement('export', reexports, ` from '${leafSpecifier()}';`)}`);
    }
    for (const r of top.movers) edits.push({ start: r.node.getFullStart(), end: r.node.getEnd(), text: '' });
  }
  for (const [moduleFile, movers] of modules) {
    const title = movers[0].section;
    const hostName = hostNameOf(moduleFile);
    const anyHost = movers.some((r) => r.host.size > 0);
    importBlock.push(`\n// ${MARK} ${title}: the methods of the same names below hand the bodies` +
      `${anyHost ? ` what they read (\`${hostName}\`)` : ' their arguments'}.`);
    importBlock.push(`\nimport { ${facetNameOf(moduleFile)} } from './${moduleFile.replace(/\.ts$/, '.js')}';`);
    for (const r of movers) {
      const body = r.node.getBody();
      const lineStart = text.lastIndexOf('\n', body.getEnd() - 1) + 1;
      const closeIndent = text.slice(lineStart, body.getEnd() - 1);
      if (!/^ *$/.test(closeIndent)) refuse(`${r.name}: the body's closing brace does not open its own line`);
      if (r.host.size > 0 && r.node.getParameters().some((p) => p.getName() === hostVarOf(moduleFile))) {
        refuse(`${r.name}: a parameter is named ${hostVarOf(moduleFile)}, which its stub reads as the facet's host`);
      }
      const stub = stubBody({ node: r.node, name: r.name, usesHost: r.host.size > 0, docMoved: Boolean(r.doc) }, moduleFile, closeIndent);
      edits.push({ start: body.getStart(), end: body.getEnd(), text: stub });
      const asyncKw = r.node.getModifiers().find((x) => x.getKind() === tm.SyntaxKind.AsyncKeyword);
      if (asyncKw) edits.push({ start: asyncKw.getStart(), end: r.node.getNameNode().getStart(), text: '' });
      if (r.doc) edits.push({ start: r.node.getStart(true), end: r.node.getStart(), text: '' });
    }
  }
  // After the class's last member: the static block that fills the statics
  // forwarders, then the one that installs the facet hosts (one edit, so the
  // two keep this order).
  const tail = [];
  if (routedStatics.size > 0) {
    // The private-static-through-host rule: the forwarder object ahead of the
    // class (ahead of its leading comments), the static block that fills it
    // after the class's last member.
    const { ahead, block } = staticsTexts(routedStatics);
    edits.push({ start: ctx.cls.getFullStart(), end: ctx.cls.getFullStart(), text: `\n\n${ahead}` });
    tail.push(`\n\n${block}`);
  }
  const facets = facetsOf(modules);
  const hosts = facets.length > 0 ? hostsTexts(facets) : null;
  if (hosts) {
    for (const f of facets) {
      if (ctx.scope.bindings.has(hostVarOf(f.moduleFile))) refuse(`engine.ts already binds ${hostVarOf(f.moduleFile)}, the name of ${f.moduleFile}'s host`);
    }
    tail.push(`\n\n${hosts.block}`);
    importBlock.push(`\n// ${MARK} The facets' hosts, one per engine, which the static block at the end of the class builds.`);
    importBlock.push(`\n${namedStatement('import', facets.map((f) => hostVarOf(f.moduleFile)).sort(), ` from './${HOSTS_MODULE.replace(/\.ts$/, '.js')}';`)}`);
  }
  if (tail.length > 0) {
    const last = ctx.cls.getMembers().at(-1);
    edits.push({ start: last.getEnd(), end: last.getEnd(), text: tail.join('') });
  }
  if (hostExportsForSections.size > 0) {
    const spelled = [...hostExportsForSections.keys()].sort().map((n) => {
      const st = ctx.sf.getStatements().find((s) => (declaredNames(tm, s) ?? []).includes(n));
      return st && (tm.Node.isInterfaceDeclaration(st) || tm.Node.isTypeAliasDeclaration(st)) ? `type ${n}` : n;
    });
    importBlock.push(`\n// ${MARK} Exported for the section modules above, which import them (lever (a)); \`index.ts\` re-exports by name, so none reaches the package.`);
    importBlock.push(`\n${namedStatement('export', spelled, ';')}`);
  }
  const lastImport = sf.getImportDeclarations().at(-1);
  if (!lastImport) refuse('engine.ts has no import declaration to place the generated imports after');
  if (importBlock.length > 0) edits.push({ start: lastImport.getEnd(), end: lastImport.getEnd(), text: importBlock.join('') });
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Infinity;
  for (const e of edits) {
    if (e.end > floor) refuse('overlapping edits');
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    floor = e.start;
  }
  // The imports only moved text read are dropped (the package compiles with
  // `noUnusedLocals`); `verify` recomputes the same prune from the head.
  const pruned = pruneImports(tm, out, usedImportNames(tm, out));
  const moduleTexts = new Map();
  const leafNames = top.moverNames;
  if (top.movers.length > 0) moduleTexts.set(LEAF_MODULE, leafText(ctx.scope, top, leafExports));
  for (const [moduleFile, movers] of modules) {
    moduleTexts.set(moduleFile, moduleText(moduleFile, movers[0].section, movers, ctx.scope, leafNames, routedModules.has(moduleFile)));
  }
  if (hosts) moduleTexts.set(HOSTS_MODULE, hosts.module);
  return { host: pruned.text, modules: moduleTexts, pruned: pruned.removed };
}

// ── The import prune ─────────────────────────────────────────────────────────

/** Is `node` (a compiler node) inside a JSDoc comment? */
function inJsDocNode(ts, node) {
  for (let n = node; n; n = n.parent) {
    if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return true;
  }
  return false;
}

/** Is the identifier a property NAME (`a.NAME`, `{ NAME: … }`, a member name), not a reference? */
function isPropertyNameIdentifier(ts, node) {
  const p = node.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === node) return true;
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) ||
    ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isGetAccessorDeclaration(p) ||
    ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p)) && p.name === node) return true;
  if (ts.isQualifiedName(p) && p.right === node) return true;
  return false;
}

/**
 * The import bindings of an `engine.ts` that something outside its import
 * declarations reads: a reference in code or a type, a local `export { … }`,
 * or a JSDoc `{@link X}` / `@see X` name. Those JSDoc names count because the
 * compiler's `noUnusedLocals` counts them; other JSDoc text and `//` comments
 * do not.
 */
function usedImportNames(tm, text) {
  const ts = tm.ts;
  const sfm = parse(tm, HOST_PATH, text);
  const sf = sfm.compilerNode;
  const checker = sfm.getProject().getTypeChecker().compilerObject;
  const used = new Set();
  const isImportDecl = (d) => d.getSourceFile() === sf && (ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d));
  const leftmost = (name) => {
    let n = name;
    while (n && (ts.isQualifiedName(n) || ts.isPropertyAccessExpression(n) || n.kind === ts.SyntaxKind.JSDocMemberName)) {
      n = ts.isQualifiedName(n) || n.kind === ts.SyntaxKind.JSDocMemberName ? n.left : n.expression;
    }
    return n && ts.isIdentifier(n) ? n : undefined;
  };
  const visitDoc = (node) => {
    const linkish = node.kind === ts.SyntaxKind.JSDocLink || node.kind === ts.SyntaxKind.JSDocLinkCode ||
      node.kind === ts.SyntaxKind.JSDocLinkPlain || node.kind === ts.SyntaxKind.JSDocNameReference;
    if (linkish && node.name) {
      const id = leftmost(node.name);
      const symbol = id && checker.getSymbolAtLocation(id);
      if (id && (symbol?.declarations ?? []).some(isImportDecl)) used.add(id.text);
    }
    if (Array.isArray(node.comment)) node.comment.forEach(visitDoc);
    ts.forEachChild(node, visitDoc);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) return;
    for (const doc of node.jsDoc ?? []) visitDoc(doc);
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) return;
    if (ts.isIdentifier(node) && !inJsDocNode(ts, node)) {
      const parent = node.parent;
      let symbol;
      if (ts.isExportSpecifier(parent)) symbol = checker.getExportSpecifierLocalTargetSymbol(parent);
      else if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) symbol = checker.getShorthandAssignmentValueSymbol(parent);
      else if (!isPropertyNameIdentifier(ts, node)) symbol = checker.getSymbolAtLocation(node);
      if ((symbol?.declarations ?? []).some(isImportDecl)) used.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return used;
}

/**
 * Drop every import binding `used` lacks. A declaration left with no binding
 * goes whole (its own text and the line break after it; the comments above it
 * stay); one left with some keeps them, a one-line `{ … }` on one line, a
 * multi-line one as one binding per line. Pure. Returns `{ text, removed }`.
 */
function pruneImports(tm, text, used) {
  const ts = tm.ts;
  const sf = parseSourceFile(HOST_PATH, text);
  const edits = [];
  const removed = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    const clause = st.importClause;
    const nb = clause.namedBindings;
    const named = nb && ts.isNamedImports(nb) ? [...nb.elements] : [];
    const dropDefault = Boolean(clause.name && !used.has(clause.name.text));
    const dropNs = Boolean(nb && ts.isNamespaceImport(nb) && !used.has(nb.name.text));
    const dropNamed = named.filter((e) => !used.has(e.name.text));
    if (!dropDefault && !dropNs && dropNamed.length === 0) continue;
    if (dropDefault) removed.push(clause.name.text);
    if (dropNs) removed.push(nb.name.text);
    for (const e of dropNamed) removed.push(e.name.text);
    const keepDefault = Boolean(clause.name && !dropDefault);
    const keepNs = Boolean(nb && ts.isNamespaceImport(nb) && !dropNs);
    const keepNamed = named.filter((e) => used.has(e.name.text));
    if (!keepDefault && !keepNs && keepNamed.length === 0) {
      const end = text[st.getEnd()] === '\n' ? st.getEnd() + 1 : st.getEnd();
      edits.push({ start: st.getStart(sf), end, text: '' });
      continue;
    }
    if (nb && ts.isNamedImports(nb) && dropNamed.length > 0) {
      if (keepNamed.length === 0) {
        edits.push({ start: clause.name.getEnd(), end: nb.getEnd(), text: '' });
      } else {
        const one = !nb.getText(sf).includes('\n');
        const parts = keepNamed.map((e) => e.getText(sf));
        edits.push({ start: nb.getStart(sf), end: nb.getEnd(), text: one ? `{ ${parts.join(', ')} }` : `{\n${parts.map((x) => `  ${x},`).join('\n')}\n}` });
      }
    }
    if (dropNs) edits.push({ start: clause.name.getEnd(), end: nb.getEnd(), text: '' });
    if (dropDefault) edits.push({ start: clause.name.getStart(sf), end: nb.getStart(sf), text: '' });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { text: out, removed: removed.sort() };
}

// ── Proof 1: byte-identity ───────────────────────────────────────────────────

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Prove a split against its base, from the texts alone (it shares no state with
 * `generate`): every generated function is its base method's text, every leaf
 * declaration is its base statement's text, and undoing the split rebuilds the
 * base `engine.ts` byte-for-byte, once the base's import bindings the head no
 * longer reads are pruned from it.
 *
 * Undoing is: put each body back on its stub (and `async` back), drop the
 * generated import / export statements, then splice the leaf's statements back
 * between the statements that stayed — the interleaving read off the base by
 * NAME only, so every byte of the result comes from the head or the leaf.
 *
 * The one edit the undo does not reverse by reading the head is the import
 * prune: it is recomputed from the head (which import bindings does the head
 * still read?) and applied to the base, and every binding it drops must occur
 * in a moved body or a moved declaration, so a binding the head lost for any
 * other reason fails.
 *
 * Returns `{ failures, moved, movedTop, pruned, linesBefore, linesAfter }`; no failure = proved.
 */
function verify(tm, baseText, headText, moduleTexts, { readSibling = null } = {}) {
  const { Node } = tm;
  const failures = [];
  const moved = [];
  const movedTop = [];
  const baseSf = parse(tm, HOST_PATH, baseText);
  const baseCls = baseSf.getClass(CLASS_NAME);
  const headSf = parse(tm, HOST_PATH, headText);
  const headCls = headSf.getClass(CLASS_NAME);
  const none = { failures: [`no class ${CLASS_NAME} at base or head`], moved, movedTop, pruned: [], linesBefore: 0, linesAfter: 0 };
  if (!baseCls || !headCls) return none;
  const prune = pruneImports(tm, baseText, usedImportNames(tm, headText));
  const target = prune.text;

  const modules = new Map();
  let leaf = null;
  let hostsOnDisk = null;
  for (const [file, text] of moduleTexts) {
    if (!text.includes(MARK)) continue;
    if (file === HOSTS_MODULE) { hostsOnDisk = text; continue; }
    const sf = parse(tm, join(SRC_DIR, file), text);
    if (file === LEAF_MODULE) {
      const statements = [];
      const stmts = sf.getStatements();
      // The generated header is leading trivia of the first statement when no
      // import precedes it; a moved statement's text starts after it.
      const headerEnd = text.indexOf('\n\n', text.indexOf(MARK)) + 1;
      stmts.forEach((st, i) => {
        if (Node.isImportDeclaration(st)) {
          if (st.getModuleSpecifierValue() === './engine.js' || SEAM_SPECIFIER.test(st.getModuleSpecifierValue())) {
            failures.push(`${file}: imports ${st.getModuleSpecifierValue()} — a leaf never imports engine.ts or an engine-* module`);
          }
          return;
        }
        if (i === stmts.length - 1 && Node.isExportDeclaration(st) && !st.getModuleSpecifier() && st.getFullText().includes(MARK)) return;
        const names = declaredNames(tm, st);
        if (!names) { failures.push(`${file}: a statement that is not a moved declaration: ${st.getText().slice(0, 60)}`); return; }
        statements.push({ names, text: text.slice(Math.max(st.getFullStart(), headerEnd), st.getEnd()), node: st });
      });
      leaf = { file, sf, statements };
      if (readSibling) {
        // The leaf's relative VALUE imports, followed on disk: none may reach
        // engine.ts or an engine-* module. A type-only import is erased, so it
        // forms no evaluation cycle and is not followed.
        const seen = new Set();
        const queue = valueSpecifiers(text).map((spec) => [file, spec]);
        while (queue.length > 0) {
          const [from, spec] = queue.shift();
          let rel = relative(SRC_DIR, resolve(dirname(join(SRC_DIR, from)), spec.replace(/\.js$/, '.ts')));
          if (seen.has(rel)) continue;
          seen.add(rel);
          if (rel === HOST_BASENAME || /^engine-[a-z0-9-]+\.ts$/.test(rel)) {
            failures.push(`${file}: reaches ${rel} through its value imports (from ${from}) — not a leaf`);
            continue;
          }
          let sibling = readSibling(rel);
          if (sibling === null) {
            const index = rel.replace(/\.ts$/, '/index.ts');
            sibling = readSibling(index);
            if (sibling !== null) rel = index;
          }
          if (sibling === null) continue;
          for (const next of valueSpecifiers(sibling)) queue.push([rel, next]);
        }
      }
      continue;
    }
    // A facet module: imports, the host interface, and ONE class, the facet,
    // whose every member is a static method that is a moved body.
    const fns = new Map();
    const facet = facetNameOf(file);
    for (const st of sf.getStatements()) {
      if (Node.isImportDeclaration(st)) continue;
      if (Node.isInterfaceDeclaration(st) && st.getName() === hostNameOf(file)) continue;
      if (Node.isClassDeclaration(st) && st.getName() === facet && !fns.size) {
        for (const member of st.getMembers()) {
          if (Node.isMethodDeclaration(member) && member.isStatic() && member.getBody() && !fns.has(member.getName())) fns.set(member.getName(), member);
          else failures.push(`${file}: ${facet} has a member that is not a moved body: ${member.getText().slice(0, 60)}`);
        }
        continue;
      }
      failures.push(`${file}: a top-level statement that is neither an import, the host interface nor the facet class ${facet}: ${st.getText().slice(0, 60)}`);
    }
    modules.set(file, { sf, text, fns, claimed: new Set() });
  }

  const marker = new RegExp(`^\\{\\s*// ${MARK.replace(/[[\]]/g, '\\$&')} The body moved to \`(engine-[a-z0-9-]+\\.ts)\`(, ${DOC_MOVED})?`);
  const movedDocs = [];
  const edits = [];
  for (const m of headCls.getMethods()) {
    const body = m.getBody();
    if (!body) continue;
    const hit = marker.exec(body.getText());
    if (!hit) continue;
    const name = m.getName();
    const mod = modules.get(hit[1]);
    const fn = mod && mod.fns.get(name);
    if (!fn) { failures.push(`${name}: its stub names ${hit[1]}, which has no function ${name}`); continue; }
    mod.claimed.add(name);
    // The stub itself is exactly what `stubBody` writes for this method: one
    // call of the facet member of the same name, with the facet's own host
    // when the body reads the class (#30051).
    {
      const lineStart = headText.lastIndexOf('\n', body.getEnd() - 1) + 1;
      const closeIndent = headText.slice(lineStart, body.getEnd() - 1);
      const usesHost = fn.getParameters().some((p) => p.getName() === 'this');
      const want = stubBody({ node: m, name, usesHost, docMoved: Boolean(hit[2]) }, hit[1], closeIndent);
      if (body.getText() !== want) failures.push(`${name}: its stub is not the generated one-call stub (want ${JSON.stringify(want.split('\n').at(-2).trim())})`);
    }
    const base = baseCls.getMethods().find((x) => x.getName() === name && x.isStatic() === m.isStatic());
    if (!base || !base.getBody()) { failures.push(`${name}: no method of that name with a body at base`); continue; }
    const fnParams = fn.getParameters().filter((p) => p.getName() !== 'this').map((p) => p.getText());
    const baseParams = base.getParameters().map((p) => p.getText());
    const same = {
      body: fn.getBody().getText() === base.getBody().getText(),
      params: JSON.stringify(fnParams) === JSON.stringify(baseParams),
      returnType: (fn.getReturnTypeNode()?.getText() ?? null) === (base.getReturnTypeNode()?.getText() ?? null),
      async: fn.isAsync() === base.isAsync(),
      typeParameters: JSON.stringify(fn.getTypeParameters().map((t) => t.getText())) === JSON.stringify(base.getTypeParameters().map((t) => t.getText())),
      static: m.isStatic() === base.isStatic(),
    };
    // Docblock ownership: the facet member's leading text is the base
    // method's docblock (the stub says so, and only a private method's), else
    // exactly the placeholder; the undo puts a moved docblock back.
    const lead = mod.text.slice(fn.getStart(true), fn.getStart());
    const docMoved = Boolean(hit[2]);
    if (docMoved) {
      if (m.getStart(true) !== m.getStart()) failures.push(`${name}: its stub says the docblock moved, but the class still carries one`);
      if (m.getScope() !== 'private') failures.push(`${name}: a ${m.getScope()} method's docblock moved off the class (only a private one may)`);
      edits.push({ start: m.getStart(), end: m.getStart(), text: lead });
      movedDocs.push(lead);
    } else if (lead !== `${placeholderDoc(name)}\n  `) {
      failures.push(`${name}: the facet member's leading text is neither its moved docblock nor the placeholder`);
    }
    for (const [what, ok] of Object.entries(same)) if (!ok) failures.push(`${name}: the generated function's ${what} is not the base method's`);
    moved.push({
      name, module: hit[1], bodySha: sha256(fn.getBody().getText()), baseBodySha: sha256(base.getBody().getText()),
      lines: base.getBody().getEndLineNumber() - base.getBody().getStartLineNumber() + 1, text: fn.getText(), docMoved, ...same,
    });
    edits.push({ start: body.getStart(), end: body.getEnd(), text: fn.getBody().getText() });
    if (fn.isAsync()) edits.push({ start: m.getNameNode().getStart(), end: m.getNameNode().getStart(), text: 'async ' });
  }

  // The statics route: the forwarder type and object ahead of the class and
  // the static block that fills them must be exactly what `staticsTexts`
  // writes for the statics the type names, each forwarded as the BASE class
  // declares it (a method called, anything else read). Then the undo drops
  // them.
  const staticsHost = headSf.getInterface(STATICS_HOST_NAME);
  const staticsVar = headSf.getVariableStatement(STATICS_NAME);
  const markedBlocks = headCls.getMembers().filter((x) => Node.isClassStaticBlockDeclaration(x) && x.getFullText().includes(MARK));
  const hostsBlocks = markedBlocks.filter((x) => x.getFullText().includes(`// ${MARK} Installs`));
  const staticBlocks = markedBlocks.filter((x) => !hostsBlocks.includes(x));
  if (staticsHost || staticsVar || staticBlocks.length > 0) {
    const kinds = new Map();
    for (const member of staticsHost ? staticsHost.getProperties() : []) {
      const n = member.getName();
      const declared = baseCls.getMembers().filter((x) => typeof x.isStatic === 'function' && x.isStatic() && typeof x.getName === 'function' && x.getName() === n);
      if (declared.length === 0) failures.push(`${STATICS_HOST_NAME}.${n}: the base class declares no static of that name`);
      kinds.set(n, declared.some((x) => Node.isMethodDeclaration(x)) ? 'method' : 'getter');
    }
    const { ahead, block } = staticsTexts(kinds);
    const aheadAt = staticsHost ? headText.lastIndexOf(`// ${MARK} The statics of`, staticsHost.getStart()) : -1;
    const aheadEnd = staticsVar ? staticsVar.getEnd() : -1;
    if (!staticsHost || !staticsVar || aheadAt < 0 || headText.slice(aheadAt, aheadEnd) !== ahead) {
      failures.push(`${STATICS_HOST_NAME} / ${STATICS_NAME} are not the generated forwarder declarations for the statics they name`);
    } else {
      edits.push({ start: headText.lastIndexOf('\n\n', aheadAt), end: aheadEnd, text: '' });
    }
    const blockAt = staticBlocks.length === 1 ? headText.lastIndexOf(`  // ${MARK} Fills`, staticBlocks[0].getStart()) : -1;
    if (staticBlocks.length !== 1 || blockAt < 0 || headText.slice(blockAt, staticBlocks[0].getEnd()) !== block) {
      failures.push(`the class's static block is not the generated filler of ${STATICS_NAME} for the statics it names`);
    } else {
      edits.push({ start: headText.lastIndexOf('\n\n', blockAt), end: staticBlocks[0].getEnd(), text: '' });
    }
  }
  for (const [file, mod] of modules) {
    for (const name of mod.fns.keys()) if (!mod.claimed.has(name)) failures.push(`${file}: function ${name} has no stub on the class`);
  }

  // The facet hosts (#30051): `HOSTS_MODULE` and the static block that
  // installs the factories must be exactly what `hostsTexts` writes for the
  // facets on disk, each member forwarded as the BASE class declares it (a
  // method as a closure, anything else as a getter, a member the interface
  // does not mark `readonly` with a setter too). Then the undo drops both.
  const baseMembers = instanceMembers(tm, baseCls);
  const facets = [];
  for (const [file, mod] of modules) {
    const iface = mod.sf.getInterface(hostNameOf(file));
    if (!iface) continue;
    const members = new Map();
    const written = new Set();
    for (const p of iface.getProperties()) {
      const n = p.getName();
      const info = baseMembers.get(n);
      if (!info) { failures.push(`${file}: ${hostNameOf(file)}.${n} names no instance member of the base class`); continue; }
      members.set(n, info.kind === 'method' ? 'method' : 'getter');
      if (info.kind !== 'method' && !p.isReadonly()) written.add(n);
    }
    facets.push({ moduleFile: file, members, written });
  }
  if (facets.length > 0 || hostsOnDisk !== null || hostsBlocks.length > 0) {
    const want = hostsTexts(facets);
    if (hostsOnDisk !== want.module) failures.push(`${HOSTS_MODULE} is not the generated host module for the facets on disk`);
    const blockAt = hostsBlocks.length === 1 ? headText.lastIndexOf(`  // ${MARK} Installs`, hostsBlocks[0].getStart()) : -1;
    if (hostsBlocks.length !== 1 || blockAt < 0 || headText.slice(blockAt, hostsBlocks[0].getEnd()) !== want.block) {
      failures.push('the class\'s host static block is not the generated installer of the facet hosts');
    } else {
      edits.push({ start: headText.lastIndexOf('\n\n', blockAt), end: hostsBlocks[0].getEnd(), text: '' });
    }
  }
  const generatedSpecifier = (spec) => {
    const hit = /^\.\/(engine-[a-z0-9-]+)\.js$/.exec(spec ?? '');
    return Boolean(hit && (modules.has(`${hit[1]}.ts`) || `${hit[1]}.ts` === HOSTS_MODULE || (leaf && `${hit[1]}.ts` === leaf.file)));
  };
  for (const st of headSf.getStatements()) {
    const drop = (Node.isImportDeclaration(st) && generatedSpecifier(st.getModuleSpecifierValue())) ||
      (Node.isExportDeclaration(st) && (st.getModuleSpecifier()
        ? generatedSpecifier(st.getModuleSpecifierValue())
        : st.getFullText().includes(MARK)));
    if (drop) edits.push({ start: st.getFullStart(), end: st.getEnd(), text: '' });
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let rebuilt = headText;
  for (const e of edits) rebuilt = rebuilt.slice(0, e.start) + e.text + rebuilt.slice(e.end);

  if (leaf) {
    // Splice the leaf back, in the order the base interleaves it by NAME.
    const restSf = parse(tm, HOST_PATH, rebuilt);
    const rest = restSf.getStatements();
    const queue = [...leaf.statements];
    const baseStmts = parse(tm, HOST_PATH, target).getStatements();
    let j = 0;
    let assembled = rest.length > 0 ? rebuilt.slice(0, rest[0].getFullStart()) : '';
    for (const b of baseStmts) {
      const names = declaredNames(tm, b);
      const key = names ? names.join(',') : null;
      if (queue.length > 0 && key !== null && queue[0].names.join(',') === key) {
        const l = queue.shift();
        assembled += l.text;
        const same = l.text === b.getFullText();
        if (!same) failures.push(`${leaf.file}: ${key} is not its base text (leading comments included)`);
        movedTop.push({
          name: key, lines: b.getEndLineNumber() - b.getStartLineNumber(true) + 1,
          sha: sha256(l.text), baseSha: sha256(b.getFullText()), same, exported: Node.isExportable(b) && b.isExported(),
        });
        continue;
      }
      if (j >= rest.length) { failures.push(`undoing the split runs out of head statements at base ${key ?? b.getKindName()}`); break; }
      assembled += rest[j].getFullText();
      j += 1;
    }
    if (queue.length > 0) failures.push(`${leaf.file}: ${queue.map((q) => q.names.join(',')).join('; ')} not placed — out of base order or not in the base`);
    if (rest.length > 0) assembled += rebuilt.slice(rest[rest.length - 1].getEnd());
    rebuilt = assembled;
  }

  const movedText = [...moved.map((m) => m.text), ...movedDocs, ...(leaf ? leaf.statements.map((s) => s.text) : [])].join('\n');
  for (const n of prune.removed) {
    if (!new RegExp(`(^|[^\\w$])${n.replace(/\$/g, '\\$')}($|[^\\w$])`).test(movedText)) {
      failures.push(`the head dropped the import \`${n}\`, which no moved body or declaration reads`);
    }
  }
  if (rebuilt !== target) {
    const a = rebuilt.split('\n');
    const b = target.split('\n');
    let i = 0;
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i += 1;
    failures.push(`undoing the split does not rebuild the base engine.ts (its unread imports pruned): first difference at line ${i + 1}` +
      `\n    rebuilt: ${JSON.stringify(a[i] ?? '<end>')}\n    base:    ${JSON.stringify(b[i] ?? '<end>')}`);
  }
  if (moved.length === 0 && movedTop.length === 0) failures.push('no moved method or declaration found: a proof over nothing is not a proof');
  return { failures, moved, movedTop, pruned: prune.removed, linesBefore: lineCount(baseText), linesAfter: lineCount(headText),
    routedStatics: staticsHost ? staticsHost.getProperties().length : 0 };
}

/** Lines as `wc -l` counts them: newline characters. */
function lineCount(text) {
  return text.split('\n').length - 1;
}

// ── Reports ──────────────────────────────────────────────────────────────────

function planReport(planned) {
  const out = [];
  const bySection = new Map();
  for (const r of planned.records) {
    const key = r.section ?? '(above the first anchor)';
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(r);
  }
  let movedMethods = 0;
  let movedLines = 0;
  let movedSaved = 0;
  const reasonCounts = new Map();
  for (const [section, rs] of bySection) {
    const movers = rs.filter((r) => r.reasons.length === 0);
    const lines = movers.reduce((n, r) => n + r.bodyLines, 0);
    const saved = movers.reduce((n, r) => n + r.bodyLines - r.stubLines, 0);
    movedMethods += movers.length;
    movedLines += lines;
    movedSaved += saved;
    out.push(`§ ${section} -> ${rs[0].module ?? '(stays)'}: ${movers.length}/${rs.length} methods move ` +
      `(${lines} body lines out, ${lines - saved} stub lines in)`);
    for (const r of rs) {
      if (r.reasons.length === 0) out.push(`    move  ${r.name} (body ${r.bodyLines} -> stub ${r.stubLines})`);
      else out.push(`    stay  ${r.name} (${r.lineCount}) — ${r.reasons.join('; ')}`);
      for (const reason of r.reasons) {
        const code = reason.split(':')[0];
        reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);
      }
    }
  }
  out.push('');
  out.push(`total: ${movedMethods}/${planned.records.length} methods move into ${planned.modules.size} module(s): ` +
    `${movedLines} body lines out, ${movedLines - movedSaved} stub lines in, plus ${2 * planned.modules.size} import lines`);
  out.push(`stay reasons (a method may carry several): ${[...reasonCounts].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ')}`);
  const top = planned.top;
  out.push('');
  out.push(`§ top-level declarations ahead of the class -> ${LEAF_MODULE}: ${top.movers.length}/${top.records.length} move`);
  const topReasons = new Map();
  for (const r of top.records) {
    if (r.reasons.length === 0) out.push(`    move  ${r.label} (${r.lines})${r.exported ? ' [exported, re-exported]' : ''}`);
    else out.push(`    stay  ${r.label} (${r.lines}) — ${r.reasons.join('; ')}`);
    for (const reason of r.reasons) {
      const code = reason.split(':')[0];
      topReasons.set(code, (topReasons.get(code) ?? 0) + 1);
    }
  }
  const topLines = top.movers.reduce((n, r) => n + r.lines, 0);
  out.push(`top-level total: ${top.movers.length}/${top.records.length} declarations move (${topLines} lines with their docblocks); ` +
    `stay reasons: ${[...topReasons].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ') || 'none'}`);
  out.push(`lever (a): ${planned.hostExportsForSections.size} staying name(s) exported for the section modules` +
    `${planned.hostExportsForSections.size ? ` (${[...planned.hostExportsForSections.keys()].sort().join(', ')})` : ''}; ` +
    `${planned.leafExports.length} leaf name(s) exported beside the base exports`);
  return out.join('\n');
}

function treeHash(files) {
  const h = createHash('sha256');
  for (const [name, text] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) h.update(`${name}\0${sha256(text)}\n`);
  return h.digest('hex');
}

function printVerify(v) {
  for (const f of v.failures) console.error(`  ✗ ${f}`);
  const identical = v.moved.filter((m) => m.body && m.params && m.returnType && m.async).length;
  const identicalTop = v.movedTop.filter((m) => m.same).length;
  console.log(`byte-identity: ${identical}/${v.moved.length} moved bodies identical to base (body, parameters, return type, async); ` +
    `${identicalTop}/${v.movedTop.length} moved top-level declarations identical to base (leading comments included); ` +
    `engine.ts ${v.linesBefore} -> ${v.linesAfter} lines; undoing the split ${v.failures.some((f) => f.startsWith('undoing')) ? 'does NOT' : 'does'} rebuild the base byte-for-byte ` +
    `once the ${v.pruned.length} import binding(s) only moved text reads are pruned from the base (${v.pruned.join(', ') || 'none'})`);
}

function gitShow(ref, path) {
  return execFileSync('git', ['show', `${ref}:${path}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** A file under `engine.ts`'s directory by its relative path, or null when there is none. */
function readSibling(rel) {
  const p = join(SRC_DIR, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function generatedModulesOnDisk() {
  const out = new Map();
  for (const file of [LEAF_MODULE, HOSTS_MODULE, ...SECTION_ANCHORS.map((row) => row[2])]) {
    if (!file) continue;
    const p = join(SRC_DIR, file);
    if (existsSync(p)) out.set(file, readFileSync(p, 'utf8'));
  }
  return out;
}

// ── The scoped classes (#30052) ──────────────────────────────────────────────
//
// The second pass. `engine.ts` declares two more classes after `ObjectQL`:
// `ObjectRepository` (what `ctx.api.object(name)` returns) and `ScopedContext`
// (what a hook reaches as `ctx.api`). This pass facades them with the same cut
// pattern, the same stay rules and the same byte-identity proof as the first,
// and touches nothing else: its input is the `engine.ts` the first pass left
// (any `main` after #29986), it is proved against that file, and so it is
// re-run on the latest `main` at landing, never rebased.
//
//  - ONE section per class, so one facet module per class (`SCOPED_CLASSES`).
//    Each `engine-<class>.ts` holds one stateless facet class whose static
//    methods are the moved bodies, unedited, with `this` typed as a `Pick` of
//    the class's host interface, the members typed AS the class members.
//  - One host per INSTANCE (`SCOPED_HOSTS_MODULE`), built on the first call that
//    needs it by the factory the class's own static block installs, and kept
//    for the instance's life: `#30051`'s shape, keyed by the instance instead
//    of the engine. The module imports types only, for the same reason the
//    first pass's host module does.
//  - Neither class declares a static or a top-level declaration ahead of it,
//    so no statics route and no leaf: a body that reads a non-public static
//    stays (`private-static`). A body that reads a private member off another
//    instance stays too (`foreign-private`): the class body may, a module
//    function may not.

const SCOPED_CARD = '#30052';

/** The marker every file and stub the second pass writes carries; its proof keys on it. */
const SCOPED_MARK = `[${SCOPED_CARD} codemod]`;

/** The scoped classes, in file order: the class, its facet module, its section title. */
const SCOPED_CLASSES = Object.freeze([
  ['ObjectRepository', 'engine-object-repository.ts', 'Repository bound to one object and one execution context'],
  ['ScopedContext', 'engine-scoped-context.ts', 'Scoped execution context: repositories, elevation, transactions'],
]);

/** The module that holds each scoped facet's per-instance host. Types-only imports, like `HOSTS_MODULE`. */
const SCOPED_HOSTS_MODULE = 'engine-scoped-hosts.ts';
const SCOPED_HOSTS_CLASS = 'InstanceHost';

/** The marker line of a scoped stub: the module it names, and whether the docblock moved. */
const scopedStubMarker = () => new RegExp(
  `^\\{\\s*// ${SCOPED_MARK.replace(/[[\]]/g, '\\$&')} The body moved to \`(engine-[a-z0-9-]+\\.ts)\`(, ${DOC_MOVED})?`);

/**
 * Read `text` (an `engine.ts` whose scoped classes are not split yet) and
 * decide, per method of each scoped class, whether its body moves. Pure.
 */
function planScoped(tm, text, { classes = SCOPED_CLASSES } = {}) {
  const { Node } = tm;
  const sf = parse(tm, HOST_PATH, text);
  const scope = moduleScope(tm, sf);
  const targets = [];
  for (const [className, moduleFile, title] of classes) {
    const cls = sf.getClass(className);
    if (!cls) refuse(`no class ${className} in ${HOST_BASENAME}`);
    for (const n of [facetNameOf(moduleFile), hostNameOf(moduleFile), hostVarOf(moduleFile), SCOPED_HOSTS_CLASS]) {
      if (scope.bindings.has(n)) refuse(`${HOST_BASENAME} already binds ${n}, a name this script generates`);
    }
    const statics = new Map();
    for (const m of cls.getMembers()) {
      if (typeof m.isStatic === 'function' && m.isStatic() && typeof m.getName === 'function') {
        statics.set(m.getName(), { scope: typeof m.getScope === 'function' ? m.getScope() : 'public',
          kind: Node.isMethodDeclaration(m) ? 'method' : 'field', overloaded: false });
      }
    }
    const ctx = { text, sf, cls, className, members: instanceMembers(tm, cls), scope, statics, pins: {}, needles: {}, classNeedles: {} };
    const records = [];
    for (const m of cls.getMethods()) {
      const read = readMethod(tm, ctx, m);
      if (read.readsNonPublicStatic) read.reasons.push('private-static');
      const name = m.getName();
      for (const p of m.getParameters()) {
        if (p.getName() === facetNameOf(moduleFile) || p.getName() === hostVarOf(moduleFile)) read.reasons.push(`parameter-shadows: ${p.getName()}`);
      }
      const startLine = m.getStartLineNumber(true);
      const body = m.getBody();
      const docStart = m.getStart(true);
      const doc = m.getScope() === 'private' && docStart < m.getStart() ? text.slice(docStart, m.getStart()) : null;
      const record = {
        name, node: m, className, section: title, module: moduleFile, startLine,
        lineCount: m.getEndLineNumber() - startLine + 1,
        bodyLines: body ? body.getEndLineNumber() - body.getStartLineNumber() + 1 : 0,
        doc, docLines: doc ? doc.split('\n').length - 1 : 0, ...read,
      };
      if (record.reasons.length === 0) {
        record.stubLines = stubBody({ node: m, name, usesHost: read.host.size > 0, docMoved: Boolean(doc) }, moduleFile, '  ', SCOPED_MARK).split('\n').length;
      }
      records.push(record);
    }
    const movers = records.filter((r) => r.reasons.length === 0);
    for (const r of movers) {
      for (const local of [...r.imports.keys(), ...r.moduleRefs.keys()]) {
        if (local === facetNameOf(moduleFile) || local === hostNameOf(moduleFile)) {
          refuse(`${moduleFile}: ${r.name} reads ${local}, a name this script generates in that module`);
        }
      }
    }
    targets.push({ className, moduleFile, title, cls, records, movers });
  }
  // Lever (a): a staying top-level name of engine.ts a moved body reads, which
  // engine.ts does not export yet, is exported for the facet modules.
  const hostExports = new Map();
  for (const t of targets) {
    for (const r of t.movers) {
      for (const [n, use] of r.moduleRefs) {
        if (scope.exported.has(n)) continue;
        const prev = hostExports.get(n);
        hostExports.set(n, { value: Boolean(prev && prev.value) || use.value });
      }
    }
  }
  return { sf, scope, targets, hostExports };
}

/** A scoped facet's host members (member -> `method` | `getter`) and the fields its bodies assign. */
function scopedFacetOf(t) {
  const members = new Map();
  const written = new Set();
  for (const r of t.movers) for (const [member, kind] of r.host) members.set(member, kind);
  for (const r of t.movers) for (const member of r.writes) written.add(member);
  return { className: t.className, moduleFile: t.moduleFile, members, written };
}

/**
 * The per-instance hosts: `SCOPED_HOSTS_MODULE`'s text, and, per class, the
 * static block at the end of the class that installs its facet's factory.
 * Each member forwards as the first pass's hosts do: a method as a closure
 * called on the instance at call time, a field or accessor as a getter, and a
 * field a body assigns with a setter too. Pure: the proof rebuilds both from
 * the head's host interfaces and the base classes, and compares.
 */
function scopedHostsTexts(facets) {
  const sorted = [...facets].sort((a, b) => (a.moduleFile < b.moduleFile ? -1 : a.moduleFile > b.moduleFile ? 1 : 0));
  const classNames = [...new Set(sorted.map((f) => f.className))].sort();
  const module = [
    '// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.',
    '',
    '/**',
    ` * ${SCOPED_MARK} The host of each facet of ${classNames.map((c) => `\`${c}\``).join(' and ')},`,
    ' * built ONCE per instance: what every stub of a facet hands that facet\'s',
    ' * bodies as `this`. Each host below is filled by the factory its class\'s',
    ' * static block installs, the one place that can read the class\'s private',
    ' * members; the host is built on the first call that needs it and kept for',
    ' * the instance\'s life. A method goes as a closure that calls it on the',
    ' * instance at call time, a field or accessor as a getter (and a setter when',
    ' * a body assigns it), so a body reads and writes the instance exactly as',
    ' * the method did.',
    ' *',
    ` * Written by \`${SCRIPT}\` (its second pass). It imports`,
    ' * types only, so it forms no evaluation cycle and is evaluated before the',
    ' * classes whichever module loads first. `index.ts` re-exports nothing from',
    ' * this module.',
    ' */',
    '',
    `import type { ${classNames.join(', ')} } from './engine.js';`,
    ...sorted.map((f) => `import type { ${hostNameOf(f.moduleFile)} } from './${f.moduleFile.replace(/\.ts$/, '.js')}';`),
    '',
    '/** One facet\'s host for each instance of its class: built on first use, kept for the instance\'s life. */',
    `export class ${SCOPED_HOSTS_CLASS}<E extends object, H> {`,
    '  private readonly hosts = new WeakMap<E, H>();',
    '  private build: ((instance: E) => H) | undefined;',
    '',
    '  constructor(private readonly facet: string, private readonly owner: string) {}',
    '',
    '  /** Called once, from the owning class\'s static block. */',
    '  install(build: (instance: E) => H): void {',
    '    this.build = build;',
    '  }',
    '',
    '  /** The host of `instance`, built on first use. */',
    '  of(instance: E): H {',
    '    let host = this.hosts.get(instance);',
    '    if (host === undefined) {',
    '      if (this.build === undefined) {',
    '        throw new Error(`${this.facet}: ${this.owner} has not installed its host factory`);',
    '      }',
    '      host = this.build(instance);',
    '      this.hosts.set(instance, host);',
    '    }',
    '    return host;',
    '  }',
    '}',
    '',
    ...sorted.map((f) => `export const ${hostVarOf(f.moduleFile)} = new ${SCOPED_HOSTS_CLASS}<${f.className}, ${hostNameOf(f.moduleFile)}>` +
      `('${facetNameOf(f.moduleFile)}', '${f.className}');`),
    '',
  ].join('\n');
  const blocks = new Map();
  for (const f of sorted) {
    blocks.set(f.className, [
      `  // ${SCOPED_MARK} Installs the host of \`${facetNameOf(f.moduleFile)}\` (\`${SCOPED_HOSTS_MODULE}\`): a static`,
      '  // block adds no member to the class, so the published `.d.ts` does not move.',
      '  static {',
      `    ${hostVarOf(f.moduleFile)}.install((instance) => ({`,
      ...[...f.members.keys()].sort().flatMap((member) => {
        if (f.members.get(member) === 'getter') {
          return [`      get ${member}() { return instance.${member}; },`,
            ...(f.written.has(member) ? [`      set ${member}(v) { instance.${member} = v; },`] : [])];
        }
        return [`      ${member}: (...a) => instance.${member}(...a),`];
      }),
      '    }));',
      '  }',
    ].join('\n'));
  }
  return { module, blocks };
}

/** A scoped facet module: the header, the imports, the host interface, the facet class. Pure. */
function scopedModuleText(t, scope) {
  const { className, moduleFile, title, movers } = t;
  const hostName = hostNameOf(moduleFile);
  const facet = facetNameOf(moduleFile);
  const { members: hostMembers, written } = scopedFacetOf(t);
  const needsHost = hostMembers.size > 0;
  const moduleRefs = new Map();
  for (const r of movers) {
    for (const [n, use] of r.moduleRefs) {
      const prev = moduleRefs.get(n);
      moduleRefs.set(n, { value: Boolean(prev && prev.value) || use.value });
    }
  }
  const readsHostValues = [...moduleRefs.values()].some((use) => use.value);
  const names = movers.map((r) => `\`${r.name}\`${r === movers[movers.length - 1] ? '' : ','}`);
  const out = [];
  out.push('// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.');
  out.push('');
  out.push('/**');
  out.push(...wrapComment([SCOPED_MARK, 'The', ...`"${title}"`.split(' '), 'section:', 'the', 'bodies', 'of', `\`${className}\`'s`, 'methods',
    ...names, 'moved', 'out', 'of', '`engine.ts`', 'whole', 'by', `\`${SCRIPT}\``, '(its', 'second', 'pass).']));
  out.push(' *');
  out.push(...wrapComment((`A MOVE, not a redesign. {@link ${facet}} is a stateless facet of \`${className}\`: each static ` +
    `method of it is the body of the \`${className}\` method of the same name exactly as it stood: not re-indented, not ` +
    'formatted, not edited. The method stays on the class as a one-call stub with its signature, so the published ' +
    'surface, an instance spy and a subclass override are what they were. A public method keeps its docblock on the ' +
    `class, the contract; a private method's docblock moved here with its body. The state stays on \`${className}\`.`).split(' ')));
  out.push(' *');
  if (needsHost) {
    out.push(...wrapComment((`The bodies reach the instance through {@link ${hostName}}: exactly the \`${className}\` ` +
      'members they read, private ones included. Every stub hands its body, by a `.call`, the same host: ' +
      `\`${hostVarOf(moduleFile)}\` in \`${SCOPED_HOSTS_MODULE}\`, built once per instance by the class's static block. ` +
      'Methods go as closures that call them on the instance at call time; fields and accessors go as GETTERS, read when ' +
      'the body reads them, and a field a body assigns goes with a SETTER that assigns it on the instance.').split(' ')));
  } else {
    out.push(` * No body reads a \`${className}\` member, so each stub calls its body directly.`);
  }
  out.push(' *');
  if (readsHostValues) {
    out.push(' * Values declared in `engine.ts` are imported from it (lever (a) of');
    out.push(' * ruling 6591753301); every use is inside a function body, so the import');
    out.push(' * cycle is never read at evaluation time. `index.ts` re-exports nothing from');
    out.push(' * this module.');
  } else {
    out.push(' * The module imports `engine.ts` for types only, so the two modules form no');
    out.push(' * evaluation cycle. `index.ts` re-exports nothing from this module.');
  }
  out.push(' */');
  out.push('');
  out.push(...importLines(scope, movers, { needsHost, moduleRefs, leafNames: new Map(), className }));
  if (needsHost) {
    out.push('');
    out.push('/**');
    out.push(...wrapComment((`The \`${className}\` members the bodies of {@link ${facet}} read — every one of them, and ` +
      'no other. Each is typed AS the class member (an indexed access on the class), so a change to a member\'s ' +
      'signature on the class is a change here too. `readonly` members are the getters; the others are fields a body ' +
      'assigns.').split(' ')));
    out.push(' */');
    out.push(`export interface ${hostName} {`);
    for (const member of [...hostMembers.keys()].sort()) {
      const ro = hostMembers.get(member) === 'getter' && !written.has(member);
      out.push(`  ${ro ? 'readonly ' : ''}${member}: ${className}['${member}'];`);
    }
    out.push('}');
  }
  out.push('');
  out.push(`/** The bodies of \`${className}\`'s methods: a stateless facet, called by the class's stubs. */`);
  out.push(`export class ${facet} {`);
  movers.forEach((r, i) => {
    const m = r.node;
    const picks = [...r.host.keys()].sort().map((k) => `'${k}'`).join(' | ');
    const params = [...(r.host.size > 0 ? [`this: Pick<${hostName}, ${picks}>`] : []), ...paramsText(m)];
    const ret = m.getReturnTypeNode() ? `: ${m.getReturnTypeNode().getText()}` : '';
    if (i > 0) out.push('');
    const typeParams = m.getTypeParameters().length > 0 ? `<${m.getTypeParameters().map((tp) => tp.getText()).join(', ')}>` : '';
    out.push(`  ${r.doc ?? `${placeholderDoc(r.name, className)}\n  `}static ${m.isAsync() ? 'async ' : ''}${r.name}${typeParams}(${params.join(', ')})${ret} ${m.getBody().getText()}`);
  });
  out.push('}');
  out.push('');
  return out.join('\n');
}

/**
 * Apply a scoped plan to `text`. Returns `{ host, modules, pruned }` as
 * `generate` does. Pure.
 */
function generateScoped(tm, text, planned) {
  const { sf, scope, targets, hostExports } = planned;
  const edits = [];
  const importBlock = [];
  const facets = [];
  for (const t of targets) {
    if (t.movers.length === 0) continue;
    const hostName = hostNameOf(t.moduleFile);
    const anyHost = t.movers.some((r) => r.host.size > 0);
    importBlock.push(`\n// ${SCOPED_MARK} ${t.title}: the methods of the same names on \`${t.className}\` hand the bodies` +
      `${anyHost ? ` what they read (\`${hostName}\`)` : ' their arguments'}.`);
    importBlock.push(`\nimport { ${facetNameOf(t.moduleFile)} } from './${t.moduleFile.replace(/\.ts$/, '.js')}';`);
    for (const r of t.movers) {
      const body = r.node.getBody();
      const lineStart = text.lastIndexOf('\n', body.getEnd() - 1) + 1;
      const closeIndent = text.slice(lineStart, body.getEnd() - 1);
      if (!/^ *$/.test(closeIndent)) refuse(`${t.className}#${r.name}: the body's closing brace does not open its own line`);
      const stub = stubBody({ node: r.node, name: r.name, usesHost: r.host.size > 0, docMoved: Boolean(r.doc) }, t.moduleFile, closeIndent, SCOPED_MARK);
      edits.push({ start: body.getStart(), end: body.getEnd(), text: stub });
      const asyncKw = r.node.getModifiers().find((x) => x.getKind() === tm.SyntaxKind.AsyncKeyword);
      if (asyncKw) edits.push({ start: asyncKw.getStart(), end: r.node.getNameNode().getStart(), text: '' });
      if (r.doc) edits.push({ start: r.node.getStart(true), end: r.node.getStart(), text: '' });
    }
    const facet = scopedFacetOf(t);
    if (facet.members.size > 0) facets.push(facet);
  }
  const hosts = facets.length > 0 ? scopedHostsTexts(facets) : null;
  if (hosts) {
    for (const f of facets) {
      const t = targets.find((x) => x.className === f.className);
      const last = t.cls.getMembers().at(-1);
      edits.push({ start: last.getEnd(), end: last.getEnd(), text: `\n\n${hosts.blocks.get(f.className)}` });
    }
    importBlock.push(`\n// ${SCOPED_MARK} The scoped facets' hosts, one per instance, which each class's static block builds.`);
    importBlock.push(`\n${namedStatement('import', facets.map((f) => hostVarOf(f.moduleFile)).sort(), ` from './${SCOPED_HOSTS_MODULE.replace(/\.ts$/, '.js')}';`)}`);
  }
  if (hostExports.size > 0) {
    const spelled = [...hostExports.keys()].sort().map((n) => {
      const st = sf.getStatements().find((s) => (declaredNames(tm, s) ?? []).includes(n));
      return st && (tm.Node.isInterfaceDeclaration(st) || tm.Node.isTypeAliasDeclaration(st)) ? `type ${n}` : n;
    });
    importBlock.push(`\n// ${SCOPED_MARK} Exported for the scoped facet modules above (lever (a)); \`index.ts\` re-exports by name, so none reaches the package.`);
    importBlock.push(`\n${namedStatement('export', spelled, ';')}`);
  }
  const lastImport = sf.getImportDeclarations().at(-1);
  if (!lastImport) refuse('engine.ts has no import declaration to place the generated imports after');
  if (importBlock.length > 0) edits.push({ start: lastImport.getEnd(), end: lastImport.getEnd(), text: importBlock.join('') });
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Infinity;
  for (const e of edits) {
    if (e.end > floor) refuse('overlapping edits');
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    floor = e.start;
  }
  const pruned = pruneImports(tm, out, usedImportNames(tm, out));
  const moduleTexts = new Map();
  for (const t of targets) if (t.movers.length > 0) moduleTexts.set(t.moduleFile, scopedModuleText(t, scope));
  if (hosts) moduleTexts.set(SCOPED_HOSTS_MODULE, hosts.module);
  return { host: pruned.text, modules: moduleTexts, pruned: pruned.removed };
}

/**
 * Prove a scoped split against its base, from the texts alone, as `verify`
 * proves the first pass: every generated function is its base method's text,
 * every stub is the generated one-call stub, the host module and each install
 * block are the generated ones, and undoing the split rebuilds the base
 * `engine.ts` byte-for-byte once the base's import bindings the head no longer
 * reads are pruned from it (each pruned binding must occur in moved text).
 * The first pass's text, `ObjectQL` among it, is compared like every other
 * byte: it must not move.
 */
function verifyScoped(tm, baseText, headText, moduleTexts, { classes = SCOPED_CLASSES } = {}) {
  const { Node } = tm;
  const failures = [];
  const moved = [];
  const baseSf = parse(tm, HOST_PATH, baseText);
  const headSf = parse(tm, HOST_PATH, headText);
  const prune = pruneImports(tm, baseText, usedImportNames(tm, headText));
  const target = prune.text;
  const ownModule = new Map(classes.map(([className, moduleFile]) => [moduleFile, className]));

  const modules = new Map();
  let hostsOnDisk = null;
  for (const [file, text] of moduleTexts) {
    if (!text.includes(SCOPED_MARK)) continue;
    if (file === SCOPED_HOSTS_MODULE) { hostsOnDisk = text; continue; }
    if (!ownModule.has(file)) { failures.push(`${file}: carries ${SCOPED_MARK} but is the module of no scoped class`); continue; }
    const sf = parse(tm, join(SRC_DIR, file), text);
    const fns = new Map();
    const facet = facetNameOf(file);
    for (const st of sf.getStatements()) {
      if (Node.isImportDeclaration(st)) continue;
      if (Node.isInterfaceDeclaration(st) && st.getName() === hostNameOf(file)) continue;
      if (Node.isClassDeclaration(st) && st.getName() === facet && !fns.size) {
        for (const member of st.getMembers()) {
          if (Node.isMethodDeclaration(member) && member.isStatic() && member.getBody() && !fns.has(member.getName())) fns.set(member.getName(), member);
          else failures.push(`${file}: ${facet} has a member that is not a moved body: ${member.getText().slice(0, 60)}`);
        }
        continue;
      }
      failures.push(`${file}: a top-level statement that is neither an import, the host interface nor the facet class ${facet}: ${st.getText().slice(0, 60)}`);
    }
    modules.set(file, { sf, text, fns, claimed: new Set() });
  }

  const marker = scopedStubMarker();
  const movedDocs = [];
  const edits = [];
  const facets = [];
  for (const [className, moduleFile] of classes) {
    const headCls = headSf.getClass(className);
    const baseCls = baseSf.getClass(className);
    if (!headCls || !baseCls) { failures.push(`no class ${className} at base or head`); continue; }
    const mod = modules.get(moduleFile);
    for (const m of headCls.getMethods()) {
      const body = m.getBody();
      if (!body) continue;
      const hit = marker.exec(body.getText());
      if (!hit) continue;
      const name = m.getName();
      if (hit[1] !== moduleFile) { failures.push(`${className}#${name}: its stub names ${hit[1]}, not its class's module ${moduleFile}`); continue; }
      const fn = mod && mod.fns.get(name);
      if (!fn) { failures.push(`${className}#${name}: its stub names ${moduleFile}, which has no function ${name}`); continue; }
      mod.claimed.add(name);
      const lineStart = headText.lastIndexOf('\n', body.getEnd() - 1) + 1;
      const closeIndent = headText.slice(lineStart, body.getEnd() - 1);
      const usesHost = fn.getParameters().some((p) => p.getName() === 'this');
      const want = stubBody({ node: m, name, usesHost, docMoved: Boolean(hit[2]) }, moduleFile, closeIndent, SCOPED_MARK);
      if (body.getText() !== want) failures.push(`${className}#${name}: its stub is not the generated one-call stub (want ${JSON.stringify(want.split('\n').at(-2).trim())})`);
      const base = baseCls.getMethods().find((x) => x.getName() === name && x.isStatic() === m.isStatic());
      if (!base || !base.getBody()) { failures.push(`${className}#${name}: no method of that name with a body at base`); continue; }
      const same = {
        body: fn.getBody().getText() === base.getBody().getText(),
        params: JSON.stringify(fn.getParameters().filter((p) => p.getName() !== 'this').map((p) => p.getText())) ===
          JSON.stringify(base.getParameters().map((p) => p.getText())),
        returnType: (fn.getReturnTypeNode()?.getText() ?? null) === (base.getReturnTypeNode()?.getText() ?? null),
        async: fn.isAsync() === base.isAsync(),
        typeParameters: JSON.stringify(fn.getTypeParameters().map((x) => x.getText())) === JSON.stringify(base.getTypeParameters().map((x) => x.getText())),
        static: m.isStatic() === base.isStatic(),
      };
      const lead = mod.text.slice(fn.getStart(true), fn.getStart());
      const docMoved = Boolean(hit[2]);
      if (docMoved) {
        if (m.getStart(true) !== m.getStart()) failures.push(`${className}#${name}: its stub says the docblock moved, but the class still carries one`);
        if (m.getScope() !== 'private') failures.push(`${className}#${name}: a ${m.getScope()} method's docblock moved off the class (only a private one may)`);
        edits.push({ start: m.getStart(), end: m.getStart(), text: lead });
        movedDocs.push(lead);
      } else if (lead !== `${placeholderDoc(name, className)}\n  `) {
        failures.push(`${className}#${name}: the facet member's leading text is neither its moved docblock nor the placeholder`);
      }
      for (const [what, ok] of Object.entries(same)) if (!ok) failures.push(`${className}#${name}: the generated function's ${what} is not the base method's`);
      moved.push({
        name: `${className}#${name}`, module: moduleFile, lines: base.getBody().getEndLineNumber() - base.getBody().getStartLineNumber() + 1,
        text: fn.getText(), docMoved, ...same,
      });
      edits.push({ start: body.getStart(), end: body.getEnd(), text: fn.getBody().getText() });
      if (fn.isAsync()) edits.push({ start: m.getNameNode().getStart(), end: m.getNameNode().getStart(), text: 'async ' });
    }
    // The class's install block: exactly what `scopedHostsTexts` writes for
    // the host interface on disk, each member forwarded as the BASE class
    // declares it. Then the undo drops it.
    const blocks = headCls.getMembers().filter((x) => Node.isClassStaticBlockDeclaration(x) && x.getFullText().includes(SCOPED_MARK));
    const iface = mod ? mod.sf.getInterface(hostNameOf(moduleFile)) : undefined;
    if (iface || blocks.length > 0) {
      const baseMembers = instanceMembers(tm, baseCls);
      const members = new Map();
      const written = new Set();
      for (const p of iface ? iface.getProperties() : []) {
        const n = p.getName();
        const info = baseMembers.get(n);
        if (!info) { failures.push(`${moduleFile}: ${hostNameOf(moduleFile)}.${n} names no instance member of the base class ${className}`); continue; }
        members.set(n, info.kind === 'method' ? 'method' : 'getter');
        if (info.kind !== 'method' && !p.isReadonly()) written.add(n);
      }
      const facet = { className, moduleFile, members, written };
      if (iface) facets.push(facet);
      const want = scopedHostsTexts([facet]).blocks.get(className);
      const blockAt = blocks.length === 1 ? headText.lastIndexOf(`  // ${SCOPED_MARK} Installs`, blocks[0].getStart()) : -1;
      if (!iface || blocks.length !== 1 || blockAt < 0 || headText.slice(blockAt, blocks[0].getEnd()) !== want) {
        failures.push(`${className}: its host static block is not the generated installer of ${hostNameOf(moduleFile)}`);
      } else {
        edits.push({ start: headText.lastIndexOf('\n\n', blockAt), end: blocks[0].getEnd(), text: '' });
      }
    }
  }
  for (const [file, mod] of modules) {
    for (const name of mod.fns.keys()) if (!mod.claimed.has(name)) failures.push(`${file}: function ${name} has no stub on ${ownModule.get(file)}`);
  }
  if (facets.length > 0 || hostsOnDisk !== null) {
    if (hostsOnDisk !== scopedHostsTexts(facets).module) failures.push(`${SCOPED_HOSTS_MODULE} is not the generated host module for the scoped facets on disk`);
  }
  const generatedSpecifier = (spec) => {
    const hit = /^\.\/(engine-[a-z0-9-]+)\.js$/.exec(spec ?? '');
    return Boolean(hit && (ownModule.has(`${hit[1]}.ts`) || `${hit[1]}.ts` === SCOPED_HOSTS_MODULE));
  };
  for (const st of headSf.getStatements()) {
    const drop = (Node.isImportDeclaration(st) && generatedSpecifier(st.getModuleSpecifierValue())) ||
      (Node.isExportDeclaration(st) && !st.getModuleSpecifier() && st.getFullText().includes(SCOPED_MARK));
    if (drop) edits.push({ start: st.getFullStart(), end: st.getEnd(), text: '' });
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let rebuilt = headText;
  for (const e of edits) rebuilt = rebuilt.slice(0, e.start) + e.text + rebuilt.slice(e.end);

  const movedText = [...moved.map((m) => m.text), ...movedDocs].join('\n');
  for (const n of prune.removed) {
    if (!new RegExp(`(^|[^\\w$])${n.replace(/\$/g, '\\$')}($|[^\\w$])`).test(movedText)) {
      failures.push(`the head dropped the import \`${n}\`, which no moved body reads`);
    }
  }
  if (rebuilt !== target) {
    const a = rebuilt.split('\n');
    const b = target.split('\n');
    let i = 0;
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i += 1;
    failures.push(`undoing the scoped split does not rebuild the base engine.ts (its unread imports pruned): first difference at line ${i + 1}` +
      `\n    rebuilt: ${JSON.stringify(a[i] ?? '<end>')}\n    base:    ${JSON.stringify(b[i] ?? '<end>')}`);
  }
  if (moved.length === 0) failures.push('no moved method found: a proof over nothing is not a proof');
  return { failures, moved, pruned: prune.removed, linesBefore: lineCount(baseText), linesAfter: lineCount(headText) };
}

function planReportScoped(planned) {
  const out = [];
  const reasonCounts = new Map();
  let movedLines = 0;
  let stubLines = 0;
  for (const t of planned.targets) {
    const lines = t.movers.reduce((n, r) => n + r.bodyLines, 0);
    const stubs = t.movers.reduce((n, r) => n + r.stubLines, 0);
    movedLines += lines;
    stubLines += stubs;
    out.push(`§ ${t.className} -> ${t.moduleFile}: ${t.movers.length}/${t.records.length} methods move (${lines} body lines out, ${stubs} stub lines in)`);
    for (const r of t.records) {
      if (r.reasons.length === 0) out.push(`    move  ${r.name} (body ${r.bodyLines} -> stub ${r.stubLines})`);
      else out.push(`    stay  ${r.name} (${r.lineCount}) — ${r.reasons.join('; ')}`);
      for (const reason of r.reasons) {
        const code = reason.split(':')[0];
        reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);
      }
    }
  }
  out.push('');
  out.push(`scoped total: ${planned.targets.reduce((n, t) => n + t.movers.length, 0)}/${planned.targets.reduce((n, t) => n + t.records.length, 0)} ` +
    `methods move: ${movedLines} body lines out, ${stubLines} stub lines in`);
  out.push(`stay reasons (a method may carry several): ${[...reasonCounts].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ') || 'none'}`);
  out.push(`lever (a): ${planned.hostExports.size} engine.ts name(s) exported for the scoped facet modules` +
    `${planned.hostExports.size ? ` (${[...planned.hostExports.keys()].sort().join(', ')})` : ''}`);
  return out.join('\n');
}

function printVerifyScoped(v) {
  for (const f of v.failures) console.error(`  ✗ ${f}`);
  const identical = v.moved.filter((m) => m.body && m.params && m.returnType && m.async).length;
  console.log(`byte-identity (scoped classes): ${identical}/${v.moved.length} moved bodies identical to base (body, parameters, return type, async); ` +
    `engine.ts ${v.linesBefore} -> ${v.linesAfter} lines; undoing the split ${v.failures.some((f) => f.startsWith('undoing')) ? 'does NOT' : 'does'} rebuild the base byte-for-byte ` +
    `once the ${v.pruned.length} import binding(s) only moved text reads are pruned from the base (${v.pruned.join(', ') || 'none'})`);
}

function scopedModulesOnDisk() {
  const out = new Map();
  for (const file of [SCOPED_HOSTS_MODULE, ...SCOPED_CLASSES.map((row) => row[1])]) {
    const p = join(SRC_DIR, file);
    if (existsSync(p)) out.set(file, readFileSync(p, 'utf8'));
  }
  return out;
}

/** `--scoped`: plan, write or re-prove the second pass. */
async function mainScoped(tm, argv) {
  if (argv.includes('--verify')) {
    const i = argv.indexOf('--base');
    const ref = i >= 0 ? argv[i + 1] : null;
    if (!ref) refuse('--scoped --verify needs --base <ref>');
    const v = verifyScoped(tm, gitShow(ref, `${SRC_REL}/${HOST_BASENAME}`), readFileSync(HOST_PATH, 'utf8'), scopedModulesOnDisk());
    printVerifyScoped(v);
    return v.failures.length === 0 ? 0 : 1;
  }
  const input = readFileSync(HOST_PATH, 'utf8');
  if (input.includes(SCOPED_MARK)) {
    refuse(`${HOST_BASENAME} already carries ${SCOPED_MARK} stubs: run the second pass on a file whose scoped classes are unsplit (re-run on the latest main, never on its own output)`);
  }
  const planned = planScoped(tm, input);
  console.log(planReportScoped(planned));
  const out = generateScoped(tm, input, planned);
  const files = new Map([[HOST_BASENAME, out.host], ...out.modules]);
  console.log(`output tree sha256: ${treeHash(files)} (input sha256 ${sha256(input)})`);
  const v = verifyScoped(tm, input, out.host, out.modules);
  printVerifyScoped(v);
  if (v.failures.length > 0) {
    console.error('✗ the generated scoped split fails byte-identity: nothing written. Report the fork; never hand-edit the split.');
    return 1;
  }
  if (!argv.includes('--write')) {
    console.log('plan only: nothing written (pass --write to apply).');
    return 0;
  }
  for (const [file] of out.modules) {
    const p = join(SRC_DIR, file);
    if (existsSync(p) && !readFileSync(p, 'utf8').includes(SCOPED_MARK)) refuse(`${file} exists and was not written by this script`);
  }
  writeFileSync(HOST_PATH, out.host);
  for (const [file, text] of out.modules) writeFileSync(join(SRC_DIR, file), text);
  console.log(`✓ wrote ${HOST_BASENAME} and ${out.modules.size} module(s) under ${SRC_REL}`);
  return 0;
}

// ── Entry ────────────────────────────────────────────────────────────────────

const USAGE = [
  'usage: node scripts/codemod-split-engine.mjs [--write]   plan (or apply) the split of an UNSPLIT engine.ts',
  '       node scripts/codemod-split-engine.mjs --verify --base REF   re-prove a split on disk against engine.ts at REF',
  '       node scripts/codemod-split-engine.mjs --scoped [--write]   plan (or apply) the second pass: ObjectRepository and ScopedContext',
  '       node scripts/codemod-split-engine.mjs --scoped --verify --base REF   re-prove the second pass on disk against engine.ts at REF',
  '       node scripts/codemod-split-engine.mjs --self-test',
  '       node scripts/codemod-split-engine.mjs --help',
].join('\n');

async function main(argv) {
  // Answered before any guard: `--help` reads no tree, so the "already split"
  // refusal below must never be what a reader asking for usage gets.
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  if (argv.includes('--self-test')) {
    await selfTest();
    if (process.exitCode === 1) return 1;
    if (!selfTestReachedVerdict) {
      console.error('\n✗ codemod-split-engine self-test: selfTest() returned without reaching its verdict,\n' +
        'so no success line was printed. Exiting 0 here would report a self-test that never\n' +
        'finished as a self-test that passed.');
      return 1;
    }
    return 0;
  }
  const tm = await loadTsMorph();
  if (argv.includes('--scoped')) return mainScoped(tm, argv);
  if (argv.includes('--verify')) {
    const i = argv.indexOf('--base');
    const ref = i >= 0 ? argv[i + 1] : null;
    if (!ref) refuse('--verify needs --base <ref>');
    const v = verify(tm, gitShow(ref, `${SRC_REL}/${HOST_BASENAME}`), readFileSync(HOST_PATH, 'utf8'), generatedModulesOnDisk(), { readSibling });
    printVerify(v);
    return v.failures.length === 0 ? 0 : 1;
  }
  const input = readFileSync(HOST_PATH, 'utf8');
  if (input.includes(MARK)) refuse(`${HOST_BASENAME} already carries ${MARK} stubs: run the script on an unsplit file (re-run on the latest main, never on its own output)`);
  const planned = plan(tm, input);
  console.log(planReport(planned));
  const out = generate(tm, input, planned);
  const files = new Map([[HOST_BASENAME, out.host], ...out.modules]);
  console.log(`output tree sha256: ${treeHash(files)} (input sha256 ${sha256(input)})`);
  const v = verify(tm, input, out.host, out.modules, { readSibling });
  printVerify(v);
  if (v.failures.length > 0) {
    console.error('✗ the generated split fails byte-identity: nothing written. Report the fork; never hand-edit the split.');
    return 1;
  }
  if (!argv.includes('--write')) {
    console.log('plan only: nothing written (pass --write to apply).');
    return 0;
  }
  for (const [file] of out.modules) {
    const p = join(SRC_DIR, file);
    if (existsSync(p) && !readFileSync(p, 'utf8').includes(MARK)) refuse(`${file} exists and was not written by this script`);
  }
  writeFileSync(HOST_PATH, out.host);
  for (const [file, text] of out.modules) writeFileSync(join(SRC_DIR, file), text);
  console.log(`✓ wrote ${HOST_BASENAME} and ${out.modules.size} module(s) under ${SRC_REL}`);
  return 0;
}


/**
 * The relative specifiers a module's VALUE imports and re-exports name: an
 * `import type` / `export type` declaration, or a named list whose every
 * member is `type`-marked, is erased by the compiler and is left out.
 */
function valueSpecifiers(src) {
  const out = [];
  for (const m of src.matchAll(/^[ \t]*(?:import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*'(\.{1,2}\/[^']+)'/gm)) {
    if (m[1]) continue;
    const inner = /^\{([^}]*)\}$/.exec(m[2].trim());
    if (inner && inner[1].split(',').map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith('type '))) continue;
    out.push(m[3]);
  }
  for (const m of src.matchAll(/^[ \t]*import\s*'(\.{1,2}\/[^']+)'/gm)) out.push(m[1]);
  return out;
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// The proofs above are this script's whole value, and a proof that cannot fail
// proves nothing, so the self-test feeds each one an input it must REFUSE. The
// roster pins battery NAMES with a floor each, the roster's own size is pinned,
// and the verdict sets a flag the dispatch reads (AGENTS.md, "Writing a
// `--self-test`"), so a battery that stops running, or a `return` above the
// verdict, cannot read as a pass.

let selfTestReachedVerdict = false;

const SELF_TEST_BATTERIES = Object.freeze({
  'stay rules': 20,
  'facets, statics and docblocks': 17,
  'top-level moves': 11,
  'byte-identity proof': 10,
  'import prune': 4,
  'refusals': 6,
  'scoped classes (second pass)': 16,
});
const SELF_TEST_BATTERY_FLOOR = 5;

const FIXTURE_ANCHORS = Object.freeze([
  ['count', 'Lifecycle', 'engine-lifecycle.ts'],
  ['keptSection', 'Kept', null],
]);
const FIXTURE_NEEDLES = Object.freeze({ 'PINNED_TEXT': 'a fixture reader', 'needleInMethod(': 'a fixture reader' });
const FIXTURE_CLASS_NEEDLES = Object.freeze({ 'classReaderText(': 'a fixture reader that also reads the leaf' });
const FIXTURE_PINS = Object.freeze({ pinnedMethod: 'a fixture reader' });
const fixturePlan = (tm, text) => plan(tm, text,
  { anchors: FIXTURE_ANCHORS, pins: FIXTURE_PINS, needles: FIXTURE_NEEDLES, classNeedles: FIXTURE_CLASS_NEEDLES });

function fixtureSource(extraMethods = '') {
  const pad = Array.from({ length: 12 }, (_, i) => `    const p${i} = ${i};`).join('\n');
  return `import type { Knex } from 'knex';
import { helperImported } from './other.js';
import { onlyMovedReads } from './moved-only.js';
import { seamHelper } from './engine-seam.js';

/** A value the leaf takes, read by a moved body. */
const LOCAL_VALUE = 1;
type LocalType = { n: number };
export interface ExportedShape { a: number }

// A reader takes this one out of the file by path.
const PINNED = 'PINNED_TEXT';
function dependsOnPinned(): string {
  return PINNED;
}
function namesClass(d: ObjectQL): ObjectQL {
  return d;
}
const VIA_SEAM = seamHelper();
export const DERIVED = LOCAL_VALUE + 1;
function classReaderText(n: number): number {
  return n;
}

export class ObjectQL {
  private count = 0;
  private knex: any = null;
  protected logger: { warn(m: string): void } = console;
  private readonly fn = (x: string): string => x;
  private static readonly SECRET = 1;
  private static bump = 0;

  /** A private docblock: it moves with the body. */
  private async movable(object: string, trx?: Knex.Transaction): Promise<string> {
${pad}
    const a = helperImported(object) as ExportedShape | string;
    this.logger.warn(String(a) + onlyMovedReads());
    return this.other(String(a)) + String(trx ? this.count : 0);
  }

  /** A protected docblock: it stays on the facade. */
  protected other(x: string): string {
    return x;
  }

  protected writes(): void {
${pad}
    this.count = 1;
  }

  protected asValue(): string[] {
${pad}
    return ['a'].map(this.other);
  }

  protected readsLocal(): number {
${pad}
    return LOCAL_VALUE + dependsOnPinned().length;
  }

  protected namesLocalType(): LocalType | null {
${pad}
    return null;
  }

  public inferred() {
${pad}
    return 1;
  }

  protected scoped(object: string): string {
${pad}
    return this.getBuilder(object);
  }

  protected getBuilder(object: string): string {
    return object;
  }

  protected defaulted(x: string = 'a'): string {
${pad}
    return x;
  }

  protected callsField(): string {
${pad}
    return this.fn('a');
  }

  protected readsStatic(): number {
${pad}
    return ObjectQL.SECRET;
  }

  protected bumpsStatic(): number {
${pad}
    ObjectQL.bump += 1;
    return ObjectQL.SECRET;
  }

  protected namesClassType(): ObjectQL | null {
${pad}
    return null;
  }

  protected delete(): number {
${pad}
    return 4;
  }

  protected deletesField(): void {
${pad}
    delete this.knex;
  }

  protected destructured({ a }: { a: number }): number {
${pad}
    return a;
  }

  protected generic<T extends string>(x: T): T {
${pad}
    return this.other(x) as T;
  }

  static staticHelper(n: number): number {
${pad}
    return n + ObjectQL.SECRET;
  }

  static usesThis(): number {
${pad}
    return this.SECRET;
  }

  protected pinnedMethod(): number {
${pad}
    return 3;
  }

  protected carriesNeedle(): number {
${pad}
    return needleInMethod(1);
  }

  protected carriesClassNeedle(): number {
${pad}
    return classReaderText(1);
  }
${extraMethods}
  protected keptSection(): number {
${pad}
    return 2 + VIA_SEAM + namesClass(this).count;
  }
}

function needleInMethod(n: number): number {
  return n;
}
`;
}

const FIXTURE_SCOPED_CLASSES = Object.freeze([
  ['ObjectRepository', 'engine-object-repository.ts', 'Repository'],
  ['ScopedContext', 'engine-scoped-context.ts', 'Context'],
]);

/** An `engine.ts` whose `ObjectQL` the first pass already split, ahead of two unsplit scoped classes. */
function scopedFixtureSource() {
  return `import { helperImported } from './other.js';
import { onlyScopedReads } from './scoped-only.js';
import { count } from './engine-count-aggregate.js';
import { LifecycleFacet } from './engine-lifecycle.js';

export class ObjectQL {
  run(n: number): number {
    // ${MARK} The body moved to \`engine-lifecycle.ts\`.
    return LifecycleFacet.run(n);
  }
}

export class ObjectRepository {
  constructor(
    private objectName: string,
    private engine: { find(o: string): Promise<any[]>; count(o: string): Promise<number> },
  ) {}

  /** A public docblock: it stays on the class. */
  async find(query: any = {}): Promise<any[]> {
    return this.engine.find(this.objectName + String(query));
  }

  async count(): Promise<number> {
    return this.engine.count(this.objectName);
  }

  inferred() {
    return 1;
  }
}

export class ScopedContext {
  constructor(private ctx: { user?: string }, private engine: any) {}

  private flag = false;

  private derive(ctx: { user?: string }): ScopedContext {
    const child = new ScopedContext(ctx, this.engine);
    child.flag = this.flag;
    return child;
  }

  /** A private docblock: it moves with the body. */
  private readFlag(): boolean {
    return this.flag && Boolean(helperImported());
  }

  object(name: string): ObjectRepository {
    return new ObjectRepository(name, this.engine);
  }

  sudo(): ScopedContext {
    this.flag = this.readFlag() || Boolean(onlyScopedReads());
    return this.derive({ ...this.ctx });
  }

  handsSelf(): ScopedContext {
    void count;
    return this;
  }

  get user() { return this.ctx.user; }
}
`;
}

async function selfTest() {
  const tm = await loadTsMorph();
  const batterySeen = new Map();
  let battery = null;
  let failed = 0;
  let cases = 0;
  const open = (name) => { battery = name; };
  const check = (label, ok, detail = '') => {
    batterySeen.set(battery, (batterySeen.get(battery) ?? 0) + 1);
    cases += 1;
    if (ok) console.log(`  ✓ [${battery}] ${label}`);
    else { failed += 1; console.error(`  ✗ [${battery}] ${label}${detail ? ` — ${detail}` : ''}`); }
  };
  const refused = (fn) => { try { fn(); return false; } catch (e) { return e instanceof CodemodRefusal; } };

  open('stay rules');
  {
    const planned = fixturePlan(tm, fixtureSource());
    const why = (name) => (planned.records.find((r) => r.name === name)?.reasons ?? ['<absent>']).join('; ');
    const stays = (name, code) => check(`${name} stays (${code})`, why(name).split('; ').some((r) => r.startsWith(code)), why(name));
    const moves = (name, because) => check(`${name} moves (${because})`, why(name) === '', why(name));
    moves('movable', 'the canonical body, private members read through the host');
    moves('readsLocal', 'lever (a)/(b): it imports the leaf value and the staying function');
    moves('namesLocalType', 'a non-exported type it names moves to the leaf');
    moves('scoped', 'a method it calls goes as a closure');
    moves('other', 'a body no longer than its stub moves too: the facade gate counts bodies, not lines');
    moves('writes', 'a field it assigns goes through a host setter');
    stays('deletesField', 'this-write');
    moves('delete', 'a reserved word is a valid facet member name');
    stays('asValue', 'method-as-value');
    stays('inferred', 'inferred-return-type');
    moves('defaulted', 'the stub keeps the default and forwards the value');
    stays('destructured', 'parameter-shape');
    moves('generic', 'the stub calls the body instantiated with its type parameters');
    moves('staticHelper', 'a static whose body reads no `this`');
    stays('usesThis', 'static-this');
    moves('readsStatic', 'a private static it reads goes through ObjectQLStatics');
    stays('bumpsStatic', 'static-write');
    stays('namesClassType', 'static-route-conflict');
    check('a pinned method and a method carrying a needle stay (path-reader)',
      why('pinnedMethod').startsWith('path-reader') && why('carriesNeedle').startsWith('path-reader'),
      `${why('pinnedMethod')} | ${why('carriesNeedle')}`);
    check('a method in a section that maps to no module stays (section-kept)', why('keptSection').startsWith('section-kept'), why('keptSection'));
  }

  open('top-level moves');
  {
    const input = fixtureSource();
    const planned = fixturePlan(tm, input);
    const top = (label) => planned.top.records.find((r) => r.label === label);
    const why = (label) => (top(label)?.reasons ?? ['<absent>']).join('; ');
    check('a value, a local type and an exported interface move', ['LOCAL_VALUE', 'LocalType', 'ExportedShape', 'DERIVED']
      .every((n) => why(n) === ''), ['LOCAL_VALUE', 'LocalType', 'ExportedShape', 'DERIVED'].map(why).join(' | '));
    check('a declaration carrying a reader\'s needle stays (path-reader)', why('PINNED').startsWith('path-reader'), why('PINNED'));
    check('a declaration carrying a class-scoped needle moves: its reader reads the leaf', why('classReaderText') === '', why('classReaderText'));
    check('a declaration naming a stayer stays (needs-stayer)', why('dependsOnPinned').startsWith('needs-stayer'), why('dependsOnPinned'));
    check('a declaration naming the class stays (class-reference)', why('namesClass').startsWith('class-reference'), why('namesClass'));
    check('a declaration using an engine-* import stays (seam-import)', why('VIA_SEAM').startsWith('seam-import'), why('VIA_SEAM'));
    check('a declaration after the class is not in the region', !top('needleInMethod'));
    const out = generate(tm, input, planned);
    const leaf = out.modules.get(LEAF_MODULE) ?? '';
    check('the leaf header is line comments, never a docblock the bundled .d.ts would publish',
      leaf.includes(MARK) && !leaf.slice(0, leaf.indexOf('\n\n', leaf.indexOf(MARK))).includes('/*'));
    check('the leaf imports neither engine.ts nor an engine-* module', leaf.length > 0 && !/from '\.\/engine[.-]/.test(leaf), leaf.slice(0, 200));
    check('engine.ts re-exports the exported movers by name, the interface as a type',
      /export \{ DERIVED, type ExportedShape \} from '\.\/engine-top-level\.js';/.test(out.host));
    check('lever (a): the staying function a moved body reads is exported for its module, and the module imports it',
      /export \{ dependsOnPinned \};/.test(out.host) &&
      /import \{ ObjectQLStatics as ObjectQL, dependsOnPinned \} from '\.\/engine\.js';/.test(out.modules.get('engine-lifecycle.ts') ?? ''));
  }

  open('byte-identity proof');
  {
    const input = fixtureSource();
    const planned = fixturePlan(tm, input);
    const out = generate(tm, input, planned);
    const again = generate(tm, input, fixturePlan(tm, input));
    const v = verify(tm, input, out.host, out.modules);
    check('the generated split proves against its base', v.failures.length === 0 && v.moved.length === 12 && v.movedTop.length === 5,
      [...v.failures, `moved: ${v.moved.map((m) => m.name).join()}`, `top: ${v.movedTop.map((m) => m.name).join()}`].join(' | '));
    check('two runs on one input write byte-identical trees',
      treeHash(new Map([['h', out.host], ...out.modules])) === treeHash(new Map([['h', again.host], ...again.modules])));
    const mod = out.modules.get('engine-lifecycle.ts');
    const edited = new Map([...out.modules, ['engine-lifecycle.ts', mod.replace('const p3 = 3;', 'const p3 = 4;')]]);
    check('one edited character in a moved body fails', verify(tm, input, out.host, edited).failures.length > 0);
    check('an edited stub signature fails',
      verify(tm, input, out.host.replace('trx?: Knex.Transaction): Promise<string>', 'trx?: Knex.Transaction): Promise<String>'), out.modules).failures.length > 0);
    check('an extra top-level statement in a module fails',
      verify(tm, input, out.host, new Map([...out.modules, ['engine-lifecycle.ts', `${mod}\nexport const extra = 1;\n`]])).failures.length > 0);
    check('a proof over no moved method fails', verify(tm, input, input, new Map()).failures.length > 0);
    const leaf = out.modules.get(LEAF_MODULE);
    const leafWith = (text) => new Map([...out.modules, [LEAF_MODULE, text]]);
    check('one edited character in a moved declaration fails',
      verify(tm, input, out.host, leafWith(leaf.replace('const LOCAL_VALUE = 1;', 'const LOCAL_VALUE = 2;'))).failures.length > 0);
    check('an edited comment above a moved declaration fails',
      verify(tm, input, out.host, leafWith(leaf.replace('/** A value the leaf takes', '/** A value the leaf holds'))).failures.length > 0);
    check('a leaf that imports engine.ts back fails',
      verify(tm, input, out.host, leafWith(leaf.replace('\nconst LOCAL_VALUE', "\nimport { ObjectQL } from './engine.js';\nconst LOCAL_VALUE"))).failures.length > 0);
    const swapped = leaf.replace('type LocalType = { n: number };\nexport interface ExportedShape { a: number }',
      'export interface ExportedShape { a: number }\ntype LocalType = { n: number };');
    check('two moved declarations out of base order fail', swapped !== leaf && verify(tm, input, out.host, leafWith(swapped)).failures.length > 0);
  }

  open('facets, statics and docblocks');
  {
    const input = fixtureSource();
    const out = generate(tm, input, fixturePlan(tm, input));
    const mod = out.modules.get('engine-lifecycle.ts') ?? '';
    check('the bodies move into one stateless facet class of static methods', /\nexport class LifecycleFacet \{\n/.test(mod) &&
      /\n  static async movable\(this: Pick<LifecycleHost, /.test(mod) && !/\n  (private|constructor)/.test(mod));
    check('a routed module imports ObjectQLStatics AS ObjectQL and names the class type by its alias',
      /import \{ ObjectQLStatics as ObjectQL, dependsOnPinned \} from '\.\/engine\.js';/.test(mod) &&
      /import type \{ ObjectQL as ObjectQLClass \} from '\.\/engine\.js';/.test(mod) && /count: ObjectQLClass\['count'\];/.test(mod));
    check('a private docblock moves with its body; the class keeps none for it',
      mod.includes('  /** A private docblock: it moves with the body. */\n  static async movable(') && !out.host.includes('A private docblock'));
    check('a protected docblock stays on the facade; the facet member carries the placeholder',
      out.host.includes('  /** A protected docblock: it stays on the facade. */\n  protected other(') &&
      mod.includes(`  ${placeholderDoc('other')}\n  static other(`));
    check('engine.ts declares the forwarder type and object for exactly the routed statics, and the static block fills them',
      /export interface ObjectQLStaticsHost \{\n  readonly SECRET: \(typeof ObjectQL\)\['SECRET'\];\n\}/.test(out.host) &&
      out.host.includes(`      SECRET: { get: () => ObjectQL.SECRET },\n    });\n  }\n\n  // ${MARK} Installs`) && !out.host.includes('bump:'));
    check('a written field gets a host setter that assigns it on the engine',
      out.host.includes('      get count() { return engine.count; },\n      set count(v) { engine.count = v; },'));
    check('a generic method calls its body instantiated with its own type parameters',
      out.host.includes('return (LifecycleFacet.generic<T>).call(lifecycleHost.of(this), x);') && mod.includes('  static generic<T extends string>(this: Pick<LifecycleHost, '));
    const hostsMod = out.modules.get(HOSTS_MODULE) ?? '';
    check('every stub hands its body the one host of its facet, never a literal built per call',
      !out.host.includes('const host') && !out.host.includes('ThisParameterType') &&
      (out.host.match(/\.call\(lifecycleHost\.of\(this\)/g) ?? []).length >= 3 &&
      out.host.includes("import { lifecycleHost } from './engine-facet-hosts.js';"));
    check('the host module keeps one FacetHost per facet and imports types only',
      hostsMod.includes("export const lifecycleHost = new FacetHost<LifecycleHost>('LifecycleFacet');") &&
      !/^import (?!type )/m.test(hostsMod) && hostsMod.includes("import type { LifecycleHost } from './engine-lifecycle.js';"));
    check('a method goes into the host as a closure called on the engine at call time',
      /\n      [a-z]\w*: \(\.\.\.a\) => engine\.[a-z]\w*\(\.\.\.a\),\n/.test(out.host), out.host.slice(out.host.indexOf('Installs')));
    check('a stub handing another facet\'s host fails', verify(tm, input,
      out.host.replace('.call(lifecycleHost.of(this), x)', '.call(otherHost.of(this), x)'), out.modules).failures.length > 0);
    check('an edited host module fails', verify(tm, input, out.host,
      new Map([...out.modules, [HOSTS_MODULE, hostsMod.replace('this.hosts.set(engine, host);', '')]])).failures.length > 0);
    check('a written field\'s setter left out of the host fails', verify(tm, input,
      out.host.replace('      set count(v) { engine.count = v; },\n', ''), out.modules).failures.length > 0);
    check('a static method keeps its static stub and calls its facet body directly',
      out.host.includes('  static staticHelper(n: number): number {\n    // [#29986 codemod] The body moved to `engine-lifecycle.ts`.\n    return LifecycleFacet.staticHelper(n);\n  }'));
    const withMod = (text) => new Map([...out.modules, ['engine-lifecycle.ts', text]]);
    check('an edited moved docblock fails', verify(tm, input, out.host,
      withMod(mod.replace('it moves with the body', 'it moved with the body'))).failures.length > 0);
    check('an edited placeholder fails', verify(tm, input, out.host,
      withMod(mod.replace(placeholderDoc('other'), placeholderDoc('other').replace('contract', 'promise')))).failures.length > 0);
    check('a static forwarded as the wrong kind fails', verify(tm, input,
      out.host.replace('SECRET: { get: () => ObjectQL.SECRET },', 'SECRET: { value: ObjectQL.SECRET },'), out.modules).failures.length > 0);
  }

  open('import prune');
  {
    const input = fixtureSource();
    const out = generate(tm, input, fixturePlan(tm, input));
    check('an import only a moved body read is pruned from engine.ts', out.pruned.includes('onlyMovedReads') &&
      !out.host.includes('onlyMovedReads'), out.pruned.join());
    check('an import the staying text still reads is kept', out.host.includes("import { seamHelper } from './engine-seam.js';"));
    const v = verify(tm, input, out.host, out.modules);
    check('the proof recomputes the prune from the head and names it', v.failures.length === 0 && v.pruned.includes('onlyMovedReads'), v.failures.join(' | '));
    const lost = out.host.replace("import { seamHelper } from './engine-seam.js';\n", '');
    check('an import the head lost that no moved text reads fails', verify(tm, input, lost, out.modules).failures.length > 0);
  }

  open('refusals');
  {
    check('an anchor the class does not declare refuses',
      refused(() => plan(tm, fixtureSource(), { anchors: [['gone', 'x', 'engine-x.ts']], pins: {}, needles: {}, classNeedles: {} })));
    check('anchors out of class order refuse',
      refused(() => plan(tm, fixtureSource(), { anchors: [['keptSection', 'x', null], ['count', 'y', 'engine-y.ts']], pins: {}, needles: {}, classNeedles: {} })));
    check('a pin naming what the file lacks refuses', refused(() => plan(tm, fixtureSource(), { anchors: FIXTURE_ANCHORS, pins: { gone: 'x' }, needles: {}, classNeedles: {} })));
    check('a class-scoped needle the file no longer carries refuses',
      refused(() => plan(tm, fixtureSource(), { anchors: FIXTURE_ANCHORS, pins: {}, needles: {}, classNeedles: { 'gone text': 'x' } })));
    check('a needle the file no longer carries refuses', refused(() => plan(tm, fixtureSource(), { anchors: FIXTURE_ANCHORS, pins: {}, needles: { 'gone text': 'x' }, classNeedles: {} })));
    // `--help` reads no tree: it answers before the "already split" guard, so
    // it exits 0 whether engine.ts on disk is split (as on a branch) or not.
    check('--help is answered, never refused, whatever engine.ts holds', (await main(['--help']).catch(() => 2)) === 0);
  }

  open('scoped classes (second pass)');
  {
    const input = scopedFixtureSource();
    const planned = planScoped(tm, input, { classes: FIXTURE_SCOPED_CLASSES });
    const record = (cls, name) => planned.targets.find((t) => t.className === cls)?.records.find((r) => r.name === name);
    const why = (cls, name) => (record(cls, name)?.reasons ?? ['<absent>']).join('; ');
    check('a forwarding method, an assigning one and one constructing a sibling class move',
      ['find', 'count'].every((n) => why('ObjectRepository', n) === '') && ['object', 'sudo', 'readFlag'].every((n) => why('ScopedContext', n) === ''),
      ['find', 'count'].map((n) => why('ObjectRepository', n)).concat(['object', 'sudo', 'readFlag'].map((n) => why('ScopedContext', n))).join(' | '));
    check('a method that only shares a hand-series import\'s name is not a hand-series stub', why('ObjectRepository', 'count') === '', why('ObjectRepository', 'count'));
    check('a body writing a private member of another instance stays (foreign-private)', why('ScopedContext', 'derive').startsWith('foreign-private'), why('ScopedContext', 'derive'));
    check('a body handing the instance on stays (bare-this)', why('ScopedContext', 'handsSelf').startsWith('bare-this'), why('ScopedContext', 'handsSelf'));
    check('a public method with an inferred return type stays (inferred-return-type)', why('ObjectRepository', 'inferred').startsWith('inferred-return-type'), why('ObjectRepository', 'inferred'));
    const out = generateScoped(tm, input, planned);
    const again = generateScoped(tm, input, planScoped(tm, input, { classes: FIXTURE_SCOPED_CLASSES }));
    const v = verifyScoped(tm, input, out.host, out.modules, { classes: FIXTURE_SCOPED_CLASSES });
    check('the generated scoped split proves against its base', v.failures.length === 0 && v.moved.length === 5,
      [...v.failures, `moved: ${v.moved.map((m) => m.name).join()}`].join(' | '));
    check('two runs on one input write byte-identical trees',
      treeHash(new Map([['h', out.host], ...out.modules])) === treeHash(new Map([['h', again.host], ...again.modules])));
    const ctxMod = out.modules.get('engine-scoped-context.ts') ?? '';
    const hostsMod = out.modules.get(SCOPED_HOSTS_MODULE) ?? '';
    check('each stub hands its body the one host of its own instance',
      out.host.includes('return ScopedContextFacet.sudo.call(scopedContextHost.of(this));') &&
      out.host.includes('return ObjectRepositoryFacet.find.call(objectRepositoryHost.of(this), query);'),
      out.host.slice(out.host.indexOf('sudo(')));
    check('the host module keeps one InstanceHost per class and imports types only',
      hostsMod.includes("export const scopedContextHost = new InstanceHost<ScopedContext, ScopedContextHost>('ScopedContextFacet', 'ScopedContext');") &&
      !/^import (?!type )/m.test(hostsMod));
    check('a private docblock moves with its body; a public one stays on the class',
      ctxMod.includes('  /** A private docblock: it moves with the body. */\n  static readFlag(') && !out.host.includes('A private docblock') &&
      out.host.includes('  /** A public docblock: it stays on the class. */\n  find(query: any = {}): Promise<any[]> {'));
    check('a field a body assigns gets a setter in its class\'s install block',
      out.host.includes('      get flag() { return instance.flag; },\n      set flag(v) { instance.flag = v; },'));
    check('the first pass\'s class is not touched', out.host.includes(`  run(n: number): number {\n    // ${MARK} The body moved to \`engine-lifecycle.ts\`.\n    return LifecycleFacet.run(n);\n  }`) &&
      !out.host.slice(out.host.indexOf('export class ObjectQL'), out.host.indexOf('export class ObjectRepository')).includes(SCOPED_MARK));
    const verifyWith = (host, mods) => verifyScoped(tm, input, host, mods, { classes: FIXTURE_SCOPED_CLASSES }).failures.length > 0;
    check('one edited character in a moved body fails', verifyWith(out.host,
      new Map([...out.modules, ['engine-scoped-context.ts', ctxMod.replace('{ ...this.ctx }', '{ ...this.ctx, x: 1 }')]])));
    check('a stub handing the other class\'s host fails', verifyWith(out.host.replace('ScopedContextFacet.sudo.call(scopedContextHost.of(this))', 'ScopedContextFacet.sudo.call(objectRepositoryHost.of(this))'), out.modules));
    check('a written field\'s setter left out of the install block fails', verifyWith(out.host.replace('      set flag(v) { instance.flag = v; },\n', ''), out.modules));
    check('an edited host module fails', verifyWith(out.host, new Map([...out.modules, [SCOPED_HOSTS_MODULE, hostsMod.replace('this.hosts.set(instance, host);', '')]])));
    check('an import only a moved body read is pruned, and the proof names it', out.pruned.includes('onlyScopedReads') && v.pruned.includes('onlyScopedReads'), out.pruned.join());
    check('a scoped class the file does not declare refuses',
      refused(() => planScoped(tm, input, { classes: [['Gone', 'engine-gone.ts', 'Gone']] })));
  }

  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    failed += 1;
    console.error(`✗ self-test floor: ${declared.length} batteries declared, below the pinned ${SELF_TEST_BATTERY_FLOOR}`);
  }
  for (const [name, count] of batterySeen) {
    if (!declared.includes(name)) { failed += 1; console.error(`✗ self-test floor: battery "${name}" ran ${count} case(s) but is not declared`); }
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      failed += 1;
      console.error(`✗ self-test floor: battery "${name}" ran ${count} case(s), below its pinned ${SELF_TEST_BATTERIES[name]}`);
    }
  }
  if (failed > 0) {
    console.error(`\n✗ codemod-split-engine self-test: ${failed} failure(s) (cases and floor).`);
    process.exitCode = 1;
    selfTestReachedVerdict = true;
    return;
  }
  console.log(`\n✓ codemod-split-engine self-test: ${cases} cases in ${declared.length} batteries pass.`);
  selfTestReachedVerdict = true;
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      if (error instanceof CodemodRefusal) {
        console.error(`✗ codemod-split-engine: ${error.message}`);
        process.exit(2);
      }
      console.error(error);
      process.exit(2);
    },
  );
}
