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
 *   node scripts/codemod-split-engine.mjs --hand-docs [--modules <a.ts,b.ts>] [--write]
 *                                                         # the third pass (#30053): plan (or apply) the hand series' private docblocks
 *   node scripts/codemod-split-engine.mjs --hand-docs --verify --base <ref>
 *                                                         # re-prove the third pass on disk against engine.ts and its hand modules at <ref>
 *   node scripts/codemod-split-engine.mjs --members <a,b> [--write]
 *                                                         # the fourth pass (#30055): plan (or apply) moving the named methods onto the split class
 *   node scripts/codemod-split-engine.mjs --members --verify --base <ref>
 *                                                         # re-prove the fourth pass on disk against engine.ts and its modules at <ref>
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
 * ## The third pass: the hand series' private docblocks (#30053)
 *
 * `--hand-docs` moves a private hand-series stub's docblock into its hand
 * module, onto the function the stub calls, as the first two passes move a
 * private method's docblock with its body; a public or protected one stays on
 * the class. Its section below (`HAND_STUB_MARK`) states the rule, the slices
 * (`--modules`) and the proof, the undo of every move.
 *
 * ## The fourth pass: named methods onto the split class (#30055)
 *
 * The first pass runs on an unsplit file only, so a method a stay rule held
 * when `main` was split (a path pin since retired, a return type since
 * spelled) moves by `--members`: on the split file, as the first pass would
 * have moved it, into the facet module it wrote. Its section below
 * (`MEMBERS_CARD`) states what it grows, what it refuses and the undo proof,
 * and the three rules #30020 added to it for a body that hands the engine on.
 *
 * ## The fifth pass: a hand stub's computing host slot (#30020)
 *
 * `--hand-slots` moves a slot that computes out of a hand-series stub's host
 * literal into the stub's hand module, so the stub is a delegation. Its
 * section below (`HAND_SLOTS_CARD`) states the rule and the undo proof.
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
const PATH_READER_PINS = Object.freeze({
  // Empty since #30055: the six rows the #4918 query-options erasure guard
  // held here (its per-file baseline names `engine.ts`, so a moved `as any`
  // site would have red `pnpm lint`) retired once their sites were typed, and
  // the fourth pass (`--members`) moved the six bodies.
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
  'facade-taken': 'it hands the engine on, and the class declares a member named `facade` (the identity port would shadow it)',
});

/**
 * The fourth pass's identity port (#30020 R1): the host entry a moved body
 * reads the engine itself through, where the method read a bare `this`
 * (`ql: this`, `new ScopedContext(ctx, this)`, `(this as any)._flag`). The
 * host factory hands it as the engine (`facade: engine`), so at each such site
 * the body sees the same object the method saw.
 */
const FACADE_MEMBER = 'facade';
const FACADE_DOC = '  /** The engine itself: a moved body reads `this.facade` where the method read a bare `this` (#30020). */';
const facadeIfaceLine = (classType) => `${FACADE_DOC}\n  readonly ${FACADE_MEMBER}: ${classType};`;
const FACADE_INSTALL_LINE = `      ${FACADE_MEMBER}: engine,`;

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
  const host = new Map(); // member -> 'method' | 'getter' | 'facade'
  const writes = new Set(); // fields the body assigns: the host carries a setter for each
  const imports = new Map(); // local -> { value }
  const moduleRefs = new Map(); // engine.ts top-level name -> { value }
  // The identity port (#30020 R1, the fourth pass only): the start of every
  // bare `this` in the body, each of which the facet member reads as
  // `this.facade`, the host entry that hands the engine itself.
  const identity = [];
  // The private-static-through-host rule: the statics the body reads as
  // `ObjectQL.x`, whether one is non-public (that takes the route), what the
  // route cannot carry, and whether the body names `ObjectQL` any other way.
  const classStatics = new Map(); // static -> 'method' | 'getter'
  const routeBlockers = [];
  let readsNonPublicStatic = false;
  let classOther = false;
  const result = () => ({ reasons, host, writes, imports, moduleRefs, classStatics, routeBlockers, readsNonPublicStatic, classOther, identity });

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
        const inBody = region === body && !inTypePosition(tm, node, m);
        if (ctx.identityPort && inBody && Node.isElementAccessExpression(parent) && parent.getExpression() === node) {
          // R3 (#30020): `this[k]`, `k` typed as string literals each naming a
          // field, reads (and writes) those fields through host getters (and
          // setters); the body's text is unchanged.
          const keys = literalFieldKeys(ctx, checker, parent.getArgumentExpression());
          if (!keys) { add('bare-this'); continue; }
          const outer = parent.getParent();
          if (Node.isCallExpression(outer) && outer.getExpression() === parent) { add('field-call', keys.join('|')); continue; }
          const written = isWritten(tm, parent);
          if (written && Node.isDeleteExpression(outer)) { add('this-write', keys.join('|')); continue; }
          for (const k of keys) {
            host.set(k, 'getter');
            if (written) writes.add(k);
          }
          continue;
        }
        if (!Node.isPropertyAccessExpression(parent) || parent.getExpression() !== node) {
          // R1 (#30020): a `this` that hands the engine on reads the host's
          // `facade`, the engine itself.
          if (ctx.identityPort && inBody && !Node.isElementAccessExpression(parent)) {
            if (ctx.members.has(FACADE_MEMBER)) { add('facade-taken'); continue; }
            identity.push(node.getStart());
            host.set(FACADE_MEMBER, 'facade');
            continue;
          }
          add('bare-this');
          continue;
        }
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
      // `typeof this` (its `this` is an identifier in a type query): with the
      // identity port the value `this` beside it would read `this.facade` and
      // the type would name the host, so the body stays as the polymorphic
      // `this` type does.
      if (ctx.identityPort && node.getText() === 'this' && Node.isTypeQuery(node.getParent())) add('this-type');
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

/**
 * R3 (#30020): the fields a computed key `this[k]` can name, when `k`'s type
 * is a string literal or a union of them and each one names a field of the
 * class; null otherwise, and the body stays.
 */
function literalFieldKeys(ctx, checker, key) {
  if (!key) return null;
  const type = checker.getTypeAtLocation(key.compilerNode);
  const parts = type.isUnion() ? type.types : [type];
  const keys = [];
  for (const t of parts) {
    if (!t.isStringLiteral()) return null;
    const info = ctx.members.get(t.value);
    if (!info || info.kind !== 'field') return null;
    keys.push(t.value);
  }
  return keys.length > 0 ? [...new Set(keys)].sort() : null;
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
      ...hostInstallLines(f.members, f.written),
      '    }));',
    ]),
    '  }',
  ].join('\n');
  return { module, block };
}

/** The member lines of one facet's host factory, in its install call: sorted, a getter's setter after it. */
function hostInstallLines(members, written) {
  return [...members.keys()].sort().flatMap((member) => {
    if (members.get(member) === 'facade') return [FACADE_INSTALL_LINE];
    if (members.get(member) === 'getter') {
      return [`      get ${member}() { return engine.${member}; },`,
        ...(written.has(member) ? [`      set ${member}(v) { engine.${member} = v; },`] : [])];
    }
    if (BOUND_HOST_METHODS.has(member)) return [`      get ${member}() { return engine.${member}.bind(engine); },`];
    return [`      ${member}: (...a) => engine.${member}(...a),`];
  });
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
 * The class's statics: scope, and what a forwarder in `ObjectQLStatics` would
 * be (a method forwards as a function; a field or accessor as a getter).
 */
function classStaticsOf(tm, cls) {
  const { Node } = tm;
  const statics = new Map();
  for (const m of cls.getMembers()) {
    if (typeof m.isStatic === 'function' && m.isStatic() && typeof m.getName === 'function') {
      const prev = statics.get(m.getName());
      const kind = Node.isMethodDeclaration(m) ? 'method' : Node.isSetAccessorDeclaration(m) ? (prev ? prev.kind : 'setter')
        : Node.isGetAccessorDeclaration(m) ? 'getter' : 'field';
      statics.set(m.getName(), {
        scope: typeof m.getScope === 'function' ? m.getScope() : 'public', kind,
        overloaded: Node.isMethodDeclaration(m) && m.getOverloads().length > 0,
      });
    }
  }
  return statics;
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
  const ctx = { text, sf, cls, members: instanceMembers(tm, cls), scope: moduleScope(tm, sf), statics: classStaticsOf(tm, cls), pins, needles, classNeedles };
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

/**
 * `import { … }` and `import type { … }` from one specifier, values first.
 * `styles` keeps a statement a hand edit left on one line (`'line'`) on one
 * line, however long; the first pass's own form (`'wrap'`, the default) is
 * `namedStatement`'s.
 */
function importPair(specifier, uses, styles = {}) {
  const out = [];
  const entries = [...uses.entries()].sort(byName);
  const values = entries.filter(([, u]) => u.value).map(([n]) => n);
  const types = entries.filter(([, u]) => !u.value).map(([n]) => n);
  const stmt = (head, names, style) => (style === 'line'
    ? `${head} { ${names.join(', ')} } from '${specifier}';` : namedStatement(head, names, ` from '${specifier}';`));
  if (values.length > 0) out.push(stmt('import', values, styles.value));
  if (types.length > 0) out.push(stmt('import type', types, styles.type));
  return out;
}

/**
 * The form each statement of a leaf or `./engine.js` import run is in:
 * `'wrap'` when it is `namedStatement`'s, `'line'` when a hand edit grew it on
 * one line past the wrap width (#30227 left one so), each with its names
 * sorted; null when a statement is in neither form. A move renders the run
 * back in the forms it read, and so does the undo, so neither rewraps a line
 * the hand wrote.
 */
function runStyles(text, decls, specifier) {
  const styles = {};
  if (specifier !== leafSpecifier() && specifier !== './engine.js') return styles;
  for (const d of decls) {
    const stmt = text.slice(d.start, d.end);
    const type = stmt.startsWith('import type ');
    const head = type ? 'import type' : 'import';
    const names = [...d.bindings.keys()].sort();
    const tail = ` from '${specifier}';`;
    let style;
    if (stmt === namedStatement(head, names, tail)) style = 'wrap';
    else if (stmt === `${head} { ${names.join(', ')} }${tail}`) style = 'line';
    else return null;
    const key = type ? 'type' : 'value';
    if (styles[key]) return null;
    styles[key] = style;
  }
  return styles;
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
  for (const specifier of specifiers) out.push(...specifierImportLines(specifier, bySpecifier.get(specifier)));
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

/**
 * The import lines of one package specifier in a facet module, from its
 * bindings (local -> { form, imported, value }): the value statement, then a
 * type-only default, a namespace, then the type-only names, each list sorted.
 */
function specifierImportLines(specifier, bindings) {
  const out = [];
  const entries = [...bindings.entries()].sort(byName);
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

/** A facet module header's import paragraph: values imported from `engine.ts` (lever (a)), or types only. */
const VALUES_CYCLE_PARA = [
  ' * Values that stayed in `engine.ts` are imported from it (lever (a) of',
  ' * ruling 6591753301); every use is inside a function body, so the import',
  ' * cycle is never read at evaluation time. `index.ts` re-exports nothing from',
  ' * this module.',
].join('\n');
const TYPES_CYCLE_PARA = [
  ' * The module imports `engine.ts` for types only, so the two modules form no',
  ' * evaluation cycle. `index.ts` re-exports nothing from this module.',
].join('\n');

/** Does a facet module import a VALUE from `./engine.js`? */
const importsEngineValues = (text) => /^import \{[^}]*\} from '\.\/engine\.js';$/m.test(text);

/**
 * A facet module's header paragraph made to say what its `./engine.js` lines
 * import (R4 of #30020: a move that brings the first value import switches
 * it, and the undo switches it back). Refuses a header carrying neither form.
 */
function withCyclePara(text, file) {
  const values = importsEngineValues(text);
  const [from, to] = values ? [TYPES_CYCLE_PARA, VALUES_CYCLE_PARA] : [VALUES_CYCLE_PARA, TYPES_CYCLE_PARA];
  if (text.includes(to)) return text;
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0) refuse(`${file}: its header carries no single import paragraph as the first pass writes one`);
  return text.slice(0, at) + to + text.slice(at + from.length);
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
  const out = [];
  out.push('// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.');
  out.push('');
  out.push('/**');
  out.push(...moduleHeaderLines(title, movers.map((r) => r.name)));
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
  out.push(readsHostValues ? VALUES_CYCLE_PARA : TYPES_CYCLE_PARA);
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
    if (i > 0) out.push('');
    out.push(facetMethodText(r, hostName));
  });
  out.push('}');
  out.push('');
  return out.join('\n');
}

/** The opening lines of a facet module's header docblock: its section's title and the names of its bodies. */
/**
 * A facet module's header sentence, wrapped. `tail` is the words a hand edit
 * wrote after that sentence in the same paragraph (the fourth pass reads them
 * back with `headerNamesOf` and carries them over unedited); the first pass
 * writes none.
 */
function moduleHeaderLines(title, names, tail = []) {
  const listed = names.map((n, i) => `\`${n}\`${i === names.length - 1 ? '' : ','}`);
  return wrapComment([MARK, 'The', `"${title}"`, 'section', 'of', '`ObjectQL`:', 'the', 'bodies', 'of',
    ...listed, ...HEADER_SENTENCE_END.trim().split(' '), ...tail]);
}

/** The words that close a facet module's header sentence, after its list of names. */
const HEADER_SENTENCE_END = ` moved out of \`engine.ts\` whole by \`${SCRIPT}\`.`;

/**
 * One facet member, as its module holds it: the method's docblock (a private
 * one) or the placeholder, `static`, and the method's own parameters, return
 * type and body text, with `this` a `Pick` of the host when the body reads it.
 */
function facetMethodText(r, hostName) {
  const m = r.node;
  const picks = [...r.host.keys()].sort().map((k) => `'${k}'`).join(' | ');
  const params = [...(r.host.size > 0 ? [`this: Pick<${hostName}, ${picks}>`] : []), ...paramsText(m)];
  const ret = m.getReturnTypeNode() ? `: ${m.getReturnTypeNode().getText()}` : '';
  const typeParams = m.getTypeParameters().length > 0 ? `<${m.getTypeParameters().map((t) => t.getText()).join(', ')}>` : '';
  return `  ${r.doc ?? `${placeholderDoc(r.name)}\n  `}static ${m.isAsync() ? 'async ' : ''}${r.name}${typeParams}(${params.join(', ')})${ret} ${identityBodyText(m.getBody(), r.identity)}`;
}

/**
 * A method's body text with R1 applied (#30020): each bare `this` at the
 * starts `identity` lists reads `this.facade`. No other byte changes, so the
 * undo (`identityUndoText`) is the one inverse rewrite.
 */
function identityBodyText(body, identity = []) {
  const start = body.getStart();
  let text = body.getText();
  for (const at of [...identity].sort((a, b) => b - a)) {
    if (text.slice(at - start, at - start + 4) !== 'this') refuse(`identity port: no \`this\` at offset ${at}`);
    text = `${text.slice(0, at - start)}this.${FACADE_MEMBER}${text.slice(at - start + 4)}`;
  }
  return text;
}

/**
 * R1's inverse, read off a facet member at head: its body text with each
 * `this.facade` its own `this` reads back to a bare `this`.
 */
function identityUndoText(tm, fm) {
  const { Node, SyntaxKind } = tm;
  const body = fm.getBody();
  const start = body.getStart();
  let text = body.getText();
  const sites = body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).filter((pa) =>
    pa.getExpression().getKind() === SyntaxKind.ThisKeyword && Node.isIdentifier(pa.getNameNode()) &&
    pa.getName() === FACADE_MEMBER && thisContainer(tm, pa.getExpression()) === fm);
  for (const pa of sites.sort((a, b) => b.getStart() - a.getStart())) {
    text = `${text.slice(0, pa.getStart() - start)}this${text.slice(pa.getEnd() - start)}`;
  }
  return text;
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
 * stay, unless `dropAttachedComments`: then the `//` lines directly above it,
 * with no blank line between, go with it); one left with some keeps them, a
 * one-line `{ … }` on one line, a multi-line one as one binding per line.
 * Pure. Returns `{ text, removed }`.
 */
function pruneImports(tm, text, used, { dropAttachedComments = false } = {}) {
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
      let start = st.getStart(sf);
      if (dropAttachedComments) {
        // Walk up the `//` lines that touch the declaration (no blank line between).
        for (;;) {
          const prevEnd = start - 1;
          if (prevEnd <= 0 || text[prevEnd] !== '\n') break;
          const lineStart = text.lastIndexOf('\n', prevEnd - 1) + 1;
          if (!/^\s*\/\/.*$/.test(text.slice(lineStart, prevEnd))) break;
          start = lineStart;
        }
      }
      edits.push({ start, end, text: '' });
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

// ── The third pass: the hand series' private docblocks (#30053) ──────────────

/**
 * The hand series (#25522, and the two later hand cuts #27495 and #29460)
 * moved its bodies out of `engine.ts` before this codemod existed, and kept
 * EVERY method's docblock on the class: each function in a hand module
 * carries the placeholder `placeholderDoc` writes instead. This codemod's own
 * cut pattern moves a PRIVATE method's docblock with its body (a private
 * member is no part of the published surface, so nothing outside the class
 * reads it there) and keeps a public or protected one on the class, the
 * contract. `--hand-docs` applies that rule to the hand series, and touches
 * nothing else:
 *
 *  - A hand-series stub is a method whose body opens with a hand marker
 *    (`HAND_STUB_MARK`), naming its hand module.
 *  - A private stub's docblock leaves the class and replaces its function's
 *    placeholder, de-indented one level (the hand series re-indented every
 *    body it moved, so the function stands at column 0); the stub's marker
 *    gains `HAND_DOC_MOVED`; the module's header docblock gains
 *    `HAND_DOCS_NOTE`, once, because its header says each docblock stays on
 *    the class.
 *  - A public or protected stub, a private stub with no docblock, and a stub
 *    whose leading text is anything but one docblock stay as they are.
 *  - `--modules a.ts,b.ts` moves only the stubs of the named hand modules, so
 *    the pass can land in slices; a stub already moved is skipped, so a later
 *    slice runs on an earlier one's output.
 *
 * The proof is the undo: putting every moved docblock back on its stub
 * (re-indented), the placeholder back on its function, and taking the marker
 * phrase and the header note out rebuilds the base `engine.ts` and every base
 * hand module byte-for-byte (a base an earlier slice landed in is undone the
 * same way first, so a slice is proved on its own), once the import bindings
 * only a moved docblock's `{@link}` read (`noUnusedLocals` counts a link) are
 * pruned from the base with the `//` lines directly above a declaration that
 * goes whole; every pruned name must be one a moved docblock links. A
 * one-character edit in a moved docblock, a block dropped on either side, a
 * public docblock moved, or any other byte changed in those files fails it.
 * The public `.d.ts` bar is a report reading on two built dists, as for the
 * first two passes.
 */
const HAND_DOCS_CARD = '#30053';

/**
 * The marker a hand-series stub's body opens with: `[#25522 cut N]` or
 * `[#27495]` then "The body moved to", or #29460's untagged "The body lives
 * in". Group 1 is the module, group 2 the phrase once moved.
 */
const HAND_STUB_MARK = /^ *\/\/ (?:\[(?:#25522 cut \d+|#27495)\] )?The body (?:moved to|lives in) `(engine-[a-z0-9-]+\.ts)`(, its docblock with it)?/;

/** The phrase a stub's marker gains after its module's backticked name. */
const HAND_DOC_MOVED = `, ${DOC_MOVED}`;

/** The paragraph a hand module's header docblock gains, above its closing line, when a docblock moves into it. */
const HAND_DOCS_NOTE = [
  ' *',
  ` * [${HAND_DOCS_CARD} codemod] A PRIVATE method's docblock has since moved here,`,
  ' * onto its function (`--hand-docs` of `scripts/codemod-split-engine.mjs`),',
  ' * and the class keeps none for it; a public or protected method\'s docblock',
  ' * stays on the class, the contract, and its function keeps the placeholder.',
].join('\n');

/** One docblock and the indentation before the member, or null: the only leading text that moves. */
function soleDocblock(lead) {
  const m = /^(\/\*\*(?:(?!\*\/)[\s\S])*\*\/)\n( *)$/.exec(lead);
  return m ? { doc: m[1], indent: m[2] } : null;
}

/** The docblock one level out (two spaces), or null when a line is not indented that far. */
function deindentDoc(doc) {
  const lines = doc.split('\n');
  const out = [lines[0]];
  for (const line of lines.slice(1)) {
    if (line === '') out.push(line);
    else if (line.startsWith('  ')) out.push(line.slice(2));
    else return null;
  }
  return out.join('\n');
}

const reindentDoc = (doc) => doc.split('\n').map((line, i) => (i === 0 || line === '' ? line : `  ${line}`)).join('\n');

/** The header docblock's closing line offset in a module, or -1: the first `/**` before any import or export. */
function headerCloseAt(text) {
  const open = text.indexOf('/**');
  const firstStatement = text.search(/^(?:import|export) /m);
  if (open < 0 || (firstStatement >= 0 && open > firstStatement)) return -1;
  const close = text.indexOf('\n */\n', open);
  return close < 0 || (firstStatement >= 0 && close > firstStatement) ? -1 : close;
}

/** Every hand-series stub of the class, in source order, with what moving its docblock needs. */
function handStubs(tm, engineText, className = CLASS_NAME) {
  const sf = parse(tm, HOST_BASENAME, engineText);
  const cls = sf.getClass(className);
  if (!cls) refuse(`${HOST_BASENAME} declares no class ${className}`);
  const stubs = [];
  for (const m of cls.getMethods()) {
    const body = m.getBody();
    if (!body) continue;
    const line1Start = engineText.indexOf('\n', body.getStart()) + 1;
    const line1 = engineText.slice(line1Start, engineText.indexOf('\n', line1Start));
    const hit = HAND_STUB_MARK.exec(line1);
    if (!hit) continue;
    stubs.push({
      node: m, name: m.getName(), scope: m.getScope(), module: hit[1], moved: Boolean(hit[2]),
      lead: engineText.slice(m.getStart(true), m.getStart()), leadStart: m.getStart(true), memberStart: m.getStart(),
      // The offset right after the module's closing backtick, where the phrase goes.
      phraseAt: line1Start + hit.index + hit[0].length - (hit[2] ? hit[2].length : 0),
    });
  }
  return stubs;
}

/** The exported function of that name in a hand module: its leading text and offsets, or null. */
function handFunction(tm, file, text, name) {
  const sf = parse(tm, file, text);
  const fn = sf.getFunction(name);
  if (!fn || !fn.isExported()) return null;
  return { lead: text.slice(fn.getStart(true), fn.getStart()), leadStart: fn.getStart(true), start: fn.getStart() };
}

/** Text edits applied end to start; each is `{ start, end, text }`. */
function applyEdits(text, edits) {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/**
 * The plan: each hand stub's verdict. `modules` is the slice (null: every
 * hand module); `moduleTexts` maps a hand module file to its text.
 */
function planHandDocs(tm, engineText, moduleTexts, { modules = null, className = CLASS_NAME } = {}) {
  const stubs = handStubs(tm, engineText, className);
  const known = new Set(stubs.map((s) => s.module));
  for (const file of modules ?? []) {
    if (!known.has(file)) refuse(`--modules names ${file}, which no hand-series stub of ${className} delegates to (known: ${[...known].sort().join(', ')})`);
  }
  const records = [];
  for (const s of stubs) {
    const why = (() => {
      if (s.moved) return 'already-moved';
      if (s.scope !== 'private') return `${s.scope} (its docblock is the contract and stays on the class)`;
      if (s.lead === '') return 'no-docblock';
      if (modules && !modules.includes(s.module)) return 'not-in-slice';
      const sole = soleDocblock(s.lead);
      if (!sole) return 'leading-text (anything but one docblock stays)';
      if (deindentDoc(sole.doc) === null) return 'indent (a docblock line is not indented one level)';
      return '';
    })();
    let fn = null;
    let reason = why;
    if (why === '') {
      const text = moduleTexts.get(s.module);
      if (text == null) refuse(`${s.module}: the hand module ${s.name} delegates to is not on disk`);
      fn = handFunction(tm, s.module, text, s.name);
      if (!fn) refuse(`${s.module}: exports no function ${s.name}, the body ${className}#${s.name}'s marker names`);
      if (headerCloseAt(text) < 0) refuse(`${s.module}: no header docblock closing in a bare \` */\` line before its first import or export`);
      // A function whose docblock says more than the placeholder keeps it,
      // and the method keeps its own: merging two docblocks is an edit, not a move.
      if (fn.lead !== `${placeholderDoc(s.name, className)}\n`) reason = 'function-docblock (its function carries more than the placeholder)';
    }
    records.push({ ...s, reason, fn });
  }
  return { records, movers: records.filter((r) => r.reason === '') };
}

/** Apply the plan: the new `engine.ts` and every hand module it changed. */
function generateHandDocs(tm, engineText, moduleTexts, planned) {
  const hostEdits = [];
  const perModule = new Map();
  for (const r of planned.movers) {
    hostEdits.push({ start: r.leadStart, end: r.memberStart, text: '' });
    hostEdits.push({ start: r.phraseAt, end: r.phraseAt, text: HAND_DOC_MOVED });
    const edits = perModule.get(r.module) ?? [];
    edits.push({ start: r.fn.leadStart, end: r.fn.start, text: `${deindentDoc(soleDocblock(r.lead).doc)}\n` });
    perModule.set(r.module, edits);
  }
  const modules = new Map();
  for (const [file, edits] of [...perModule].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const text = moduleTexts.get(file);
    if (!text.includes(HAND_DOCS_NOTE)) {
      const at = headerCloseAt(text);
      edits.push({ start: at, end: at, text: `\n${HAND_DOCS_NOTE}` });
    }
    modules.set(file, applyEdits(text, edits));
  }
  const moved = applyEdits(engineText, hostEdits);
  // A JSDoc `{@link X}` is a read `noUnusedLocals` counts, so an import binding
  // only a moved docblock linked is dropped, with the `//` lines that explain it.
  const { text: host, removed: pruned } = pruneImports(tm, moved, usedImportNames(tm, moved), { dropAttachedComments: true });
  return { host, modules, pruned };
}

/** The names a docblock links (`{@link X}`, `{@linkcode X}`, `@see X`; the leftmost name of a dotted one). */
function linkedNames(doc) {
  return new Set([...doc.matchAll(/\{@link(?:code|plain)?\s+([A-Za-z_$][\w$]*)|@see\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1] ?? m[2]));
}

/**
 * Undo every move a tree's markers record: each moved docblock back on its
 * stub (re-indented), the placeholder back on its function, the marker phrase
 * and the header note out. `moduleTexts` maps a hand module file to its text.
 * Returns the undone texts, the moves it undid, and every way the tree breaks
 * the rule (a public docblock moved, a marker over a docblock still on the
 * class, a function with no moved docblock, a header with no note).
 */
function undoHandDocs(tm, engineText, moduleTexts, className = CLASS_NAME) {
  const failures = [];
  const moved = [];
  const hostEdits = [];
  const perModule = new Map();
  for (const s of handStubs(tm, engineText, className)) {
    if (!s.moved) continue;
    if (s.scope !== 'private') failures.push(`${s.name}: a ${s.scope} method's docblock moved off the class (only a private one may)`);
    if (s.lead !== '') failures.push(`${s.name}: its stub says the docblock moved, but the class still carries leading text`);
    const text = moduleTexts.get(s.module);
    const fn = text == null ? null : handFunction(tm, s.module, text, s.name);
    if (!fn) { failures.push(`${s.name}: ${s.module} exports no function of that name`); continue; }
    const sole = soleDocblock(fn.lead);
    if (!sole || sole.indent !== '' || fn.lead === `${placeholderDoc(s.name, className)}\n`) {
      failures.push(`${s.name}: its stub says the docblock moved, but its function in ${s.module} carries no moved docblock`);
      continue;
    }
    const indent = /^ */.exec(engineText.slice(engineText.lastIndexOf('\n', s.memberStart) + 1, s.memberStart))[0];
    hostEdits.push({ start: s.memberStart, end: s.memberStart, text: `${reindentDoc(sole.doc)}\n${indent}` });
    hostEdits.push({ start: s.phraseAt, end: s.phraseAt + HAND_DOC_MOVED.length, text: '' });
    const edits = perModule.get(s.module) ?? [];
    edits.push({ start: fn.leadStart, end: fn.start, text: `${placeholderDoc(s.name, className)}\n` });
    perModule.set(s.module, edits);
    moved.push({ name: s.name, module: s.module, lines: sole.doc.split('\n').length, doc: sole.doc });
  }
  const modules = new Map();
  for (const [file, text] of moduleTexts) {
    const edits = perModule.get(file) ?? [];
    if (edits.length > 0 || text.includes(HAND_DOCS_NOTE)) {
      const at = text.indexOf(`\n${HAND_DOCS_NOTE}\n */\n`);
      if (at < 0) failures.push(`${file}: a docblock moved into it, but its header carries no note saying so above its closing line`);
      else edits.push({ start: at, end: at + HAND_DOCS_NOTE.length + 1, text: '' });
    }
    modules.set(file, applyEdits(text, edits));
  }
  return { host: applyEdits(engineText, hostEdits), modules, moved, failures };
}

/**
 * The proof: undoing every move in the head lands on exactly what undoing
 * every move in the base lands on, `engine.ts` and each hand module byte for
 * byte. A base no slice has touched undoes to itself, so against it this is
 * "the undo rebuilds the base"; against a base an earlier slice landed in, it
 * proves this slice without re-proving that one's text. `baseModules` and
 * `headModules` map a hand module file to its text (a file absent from one
 * side fails).
 */
function verifyHandDocs(tm, baseText, headText, baseModules, headModules, { className = CLASS_NAME } = {}) {
  const head = undoHandDocs(tm, headText, headModules, className);
  const base = undoHandDocs(tm, baseText, baseModules, className);
  const failures = [...head.failures, ...base.failures.map((f) => `base: ${f}`)];
  const firstDiff = (a, b) => {
    const x = a.split('\n'); const y = b.split('\n');
    let i = 0; while (i < Math.max(x.length, y.length) && x[i] === y[i]) i += 1;
    return `line ${i + 1}: undone base ${JSON.stringify(x[i] ?? null)} | undone head ${JSON.stringify(y[i] ?? null)}`;
  };
  // The one edit the undo does not read back from the head is the import
  // prune: recomputed from the head and applied to the base, and every binding
  // it drops must be a name a moved docblock links.
  const { text: prunedBase, removed: pruned } = pruneImports(tm, base.host, usedImportNames(tm, headText), { dropAttachedComments: true });
  const links = new Set(head.moved.flatMap((m) => [...linkedNames(m.doc)]));
  for (const name of pruned) if (!links.has(name)) failures.push(`${name}: the head no longer imports it, and no moved docblock links it`);
  if (head.host !== prunedBase) failures.push(`undoing the moves does NOT rebuild the base ${HOST_BASENAME} (${firstDiff(prunedBase, head.host)})`);
  const files = [...new Set([...baseModules.keys(), ...headModules.keys()])].sort();
  for (const file of files) {
    const b = base.modules.get(file); const h = head.modules.get(file);
    if (b == null || h == null) { failures.push(`${file}: only in the ${b == null ? 'head' : 'base'}`); continue; }
    if (h !== b) failures.push(`undoing the moves does NOT rebuild the base ${file} (${firstDiff(b, h)})`);
  }
  const baseMoved = new Set(base.moved.map((m) => m.name));
  return {
    failures, moved: head.moved.filter((m) => !baseMoved.has(m.name)), baseMoved: base.moved.length, pruned,
    modules: files.length, linesBefore: lineCount(baseText), linesAfter: lineCount(headText),
  };
}

function planReportHandDocs(planned) {
  const out = [`# codemod-split-engine --hand-docs (${HAND_DOCS_CARD}): the hand series' private docblocks`, ''];
  const byModule = new Map();
  for (const r of planned.movers) byModule.set(r.module, [...(byModule.get(r.module) ?? []), r]);
  let total = 0;
  for (const [file, rs] of [...byModule].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const lines = rs.reduce((n, r) => n + soleDocblock(r.lead).doc.split('\n').length, 0);
    total += lines;
    out.push(`- ${file}: ${rs.length} docblock(s), ${lines} line(s): ${rs.map((r) => r.name).join(', ')}`);
  }
  out.push('', `moves: ${planned.movers.length}/${planned.records.length} hand-series stubs, ${total} docblock line(s)`);
  const stays = new Map();
  for (const r of planned.records) if (r.reason) stays.set(r.reason, [...(stays.get(r.reason) ?? []), r.name]);
  for (const [reason, names] of stays) out.push(`stays (${reason}): ${names.length}: ${names.join(', ')}`);
  return out.join('\n');
}

function printVerifyHandDocs(v) {
  for (const f of v.failures) console.error(`  ✗ ${f}`);
  console.log(`hand docblocks: ${v.moved.length} moved (${v.moved.reduce((n, m) => n + m.lines, 0)} lines) across ${new Set(v.moved.map((m) => m.module)).size} module(s), ${v.baseMoved} already moved at base; ` +
    `${HOST_BASENAME} ${v.linesBefore} -> ${v.linesAfter} lines; undoing every move ${v.failures.some((f) => f.startsWith('undoing')) ? 'does NOT rebuild' : 'rebuilds'} the base, ` +
    `undone the same way, for ${HOST_BASENAME} and its ${v.modules} hand module(s) byte-for-byte, once the ${v.pruned.length} import binding(s) ` +
    `only a moved docblock linked are pruned from the base (${v.pruned.join(', ') || 'none'})`);
}

/** The hand modules `engine.ts`'s hand stubs name, read through `read(file)` (null: absent). */
function handModuleTexts(tm, engineText, read) {
  const out = new Map();
  for (const file of [...new Set(handStubs(tm, engineText).map((s) => s.module))].sort()) {
    const text = read(file);
    if (text != null) out.set(file, text);
  }
  return out;
}

/** `--hand-docs`: plan, write or re-prove the third pass. */
async function mainHandDocs(tm, argv) {
  if (argv.includes('--verify')) {
    const i = argv.indexOf('--base');
    const ref = i >= 0 ? argv[i + 1] : null;
    if (!ref) refuse('--hand-docs --verify needs --base <ref>');
    const baseText = gitShow(ref, `${SRC_REL}/${HOST_BASENAME}`);
    const headText = readFileSync(HOST_PATH, 'utf8');
    const baseModules = handModuleTexts(tm, baseText, (f) => { try { return gitShow(ref, `${SRC_REL}/${f}`); } catch { return null; } });
    const headModules = handModuleTexts(tm, baseText, readSibling);
    const v = verifyHandDocs(tm, baseText, headText, baseModules, headModules);
    printVerifyHandDocs(v);
    return v.failures.length === 0 ? 0 : 1;
  }
  const j = argv.indexOf('--modules');
  const modules = j >= 0 ? (argv[j + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (j >= 0 && modules.length === 0) refuse('--modules needs a comma-separated list of hand module files');
  const input = readFileSync(HOST_PATH, 'utf8');
  const moduleTexts = handModuleTexts(tm, input, readSibling);
  const planned = planHandDocs(tm, input, moduleTexts, { modules });
  console.log(planReportHandDocs(planned));
  const out = generateHandDocs(tm, input, moduleTexts, planned);
  const files = new Map([[HOST_BASENAME, out.host], ...moduleTexts, ...out.modules]);
  console.log(`output tree sha256: ${treeHash(files)} (input sha256 ${sha256(input)})`);
  const v = verifyHandDocs(tm, input, out.host, moduleTexts, new Map([...moduleTexts, ...out.modules]));
  printVerifyHandDocs(v);
  if (v.failures.length > 0) {
    console.error('✗ the generated moves fail the undo proof: nothing written. Report the fork; never hand-edit the moves.');
    return 1;
  }
  if (!argv.includes('--write')) {
    console.log('plan only: nothing written (pass --write to apply).');
    return 0;
  }
  writeFileSync(HOST_PATH, out.host);
  for (const [file, text] of out.modules) writeFileSync(join(SRC_DIR, file), text);
  console.log(`✓ wrote ${HOST_BASENAME} and ${out.modules.size} hand module(s) under ${SRC_REL}`);
  return 0;
}

// ── The fourth pass: named methods onto the split class (#30055) ─────────────
//
// The first pass refuses an `engine.ts` that already carries its stubs: it is
// run on an unsplit file, never on its own output, and `main` has been split
// since #29986. A method a stay rule held then (a path pin since retired, a
// return type since spelled) is moved by THIS pass instead, on the split file:
// `--members a,b` names the methods, and each goes exactly as the first pass
// would have taken it. The same stay rules apply, and any reason refuses: the
// pass names what it moves and never decides it. The stub, the facet member and
// the docblock rule are the first pass's, and the member goes into the facet
// module of its section that the first pass wrote, in class order. That
// module's header, host interface and import lines grow by what the moved
// bodies read, and so do the class's statics route and that facet's host
// factory. Nothing else moves, and the pass never starts a facet, reroutes a
// module or widens a generated export list: each refuses (exit 2), and is a
// decision someone writes here.
//
// The proof (`--members --verify --base REF` re-runs it) undoes the moves from
// the head, as the first pass's does: each moved body, docblock and `async`
// goes back onto its stub; each receiving module loses the moved members, the
// host members and import bindings only they read, and its header their names;
// the statics route and the host factory lose what only they read. The result
// must be the base `engine.ts` and modules byte for byte (the base's import
// bindings only moved bodies read pruned from it, as the first pass prunes
// them), every other generated module unchanged, and each moved member its
// base method's text exactly, by a stay-rule reading of the base.
//
// Two shapes a hand edit leaves are read, not refused (#30572). A header the
// hand wrote on after, in its first paragraph, keeps those words after the
// sentence this pass rewrites (`headerNamesOf`), when the two rewrap to the
// header byte for byte. And the one import edit a read of the head cannot tell
// back, a binding a moved body brought that something staying still reads (a
// docblock link the base left unresolved), is inverted from the base's import
// block (`importEditsOf`): the bindings the head added or widened, each one a
// moved member reads, and none the base had dropped or narrowed.
//
// Three closed rules let a body move that reads the engine other than as
// `this.member` (#30020; the state stays on the class, one owner):
//
//  - R1, the identity port. A bare `this` in the body (`ql: this`,
//    `new ScopedContext(ctx, this)`, `(this as any)._flag`) reads
//    `this.facade`, a host entry the factory fills with the engine itself
//    (`facade: engine`), so each such site sees the object the method saw. The
//    undo is the one inverse rewrite, `this.facade` back to `this`, which is
//    unambiguous because a base body that reads `this.facade` refuses
//    (`unknown-member`) and so does a class that declares `facade`. A `this`
//    in a parameter, a type or a `typeof this` still stays.
//  - R3, a computed key. `this[k]`, where `k` is typed as string literals that
//    each name a field, reads (and writes) those fields through host getters
//    (and setters); the body's text is unchanged. Any other key stays.
//  - R4, an exported name. A name `engine.ts` declares and already exports
//    (`ScopedContext`) is imported from `./engine.js` (lever (a) of ruling
//    6591753301), and the header's import paragraph says so; no export list
//    widens, and a routed module refuses.
//
// A statement the hand grew on one line past the wrap width (`runStyles`) is
// kept on one line by the move and by the undo alike.

const MEMBERS_CARD = '#30055';

/** A first-pass stub's marker line: its module, whether its docblock moved, whether it hands a host. */
const STUB_MARK_LINE = new RegExp(
  `^ *// ${MARK.replace(/[[\]]/g, '\\$&')} The body moved to \`(engine-[a-z0-9-]+\\.ts)\`(, ${DOC_MOVED})?( \\(see \`[A-Za-z]+\`\\))?\\.$`, 'm');

const lineStartOf = (text, pos) => text.lastIndexOf('\n', pos - 1) + 1;

/** The 1-based line at which `a` and `b` first differ. */
function firstDiffLine(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return a.slice(0, i).split('\n').length;
}

/** Apply non-overlapping `{ start, end, text }` edits; ties apply in the order given. */
function applyOrderedEdits(text, edits) {
  const sorted = edits.map((e, i) => ({ ...e, i })).sort((a, b) => b.start - a.start || b.end - a.end || b.i - a.i);
  let out = text;
  let floor = Infinity;
  for (const e of sorted) {
    if (e.end > floor) refuse('overlapping edits');
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    floor = e.start;
  }
  return out;
}

/**
 * `pruneImports` for this pass's `engine.ts`, with one difference: the first
 * pass's import of the leaf is a `namedStatement`, so a binding dropped from it
 * leaves it wrapped as `namedStatement` wraps it (`pruneImports` would rewrite
 * a wrapped list one binding per line). Pure. Returns `{ text, removed }`.
 */
function pruneHostImports(tm, text, used) {
  const ts = tm.ts;
  const sf = parseSourceFile(HOST_PATH, text);
  const edits = [];
  const removed = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.moduleSpecifier.text !== leafSpecifier()) continue;
    const clause = st.importClause;
    const nb = clause && clause.namedBindings;
    if (!clause || clause.name || !nb || !ts.isNamedImports(nb) || nb.elements.some((e) => e.propertyName || e.isTypeOnly)) continue;
    const names = nb.elements.map((e) => e.name.text);
    const kept = names.filter((n) => used.has(n));
    if (kept.length === names.length) continue;
    removed.push(...names.filter((n) => !used.has(n)));
    const end = text[st.getEnd()] === '\n' ? st.getEnd() + 1 : st.getEnd();
    edits.push(kept.length === 0
      ? { start: st.getStart(sf), end, text: '' }
      : { start: st.getStart(sf), end: st.getEnd(), text: namedStatement(clause.isTypeOnly ? 'import type' : 'import', kept, ` from '${leafSpecifier()}';`) });
  }
  const rest = pruneImports(tm, applyOrderedEdits(text, edits), used);
  return { text: rest.text, removed: [...removed, ...rest.removed].sort() };
}

/** The analysis context of an `engine.ts` the first pass has split: `plan`'s, without its unsplit-file guards. */
function membersContext(tm, text, { pins = PATH_READER_PINS, needles = PATH_READER_NEEDLES, classNeedles = CLASS_PATH_READER_NEEDLES } = {}) {
  const sf = parse(tm, HOST_PATH, text);
  const cls = sf.getClass(CLASS_NAME);
  if (!cls) refuse(`no class ${CLASS_NAME} in ${HOST_BASENAME}`);
  return { text, sf, cls, members: instanceMembers(tm, cls), scope: moduleScope(tm, sf), statics: classStaticsOf(tm, cls), pins, needles, classNeedles, identityPort: true };
}

const isGeneratedStub = (m) => Boolean(m.getBody() && STUB_MARK_LINE.test(m.getBody().getText()));

/** The header docblock's opening lines of a facet module (`moduleHeaderLines`), as a region. */
function headerRegionOf(text) {
  const open = text.indexOf('\n/**\n');
  const end = text.indexOf('\n *\n * A MOVE, not a redesign.', open);
  return open < 0 || end < 0 ? null : { start: open + 5, end };
}

/**
 * The names a facet module's header lists, read back; null unless the header
 * is `moduleHeaderLines` of them. The list is the header's own, which a hand
 * edit to the module may have left behind its members: this pass adds and
 * removes its names in it and leaves the rest as it stands.
 *
 * A hand edit may also have written on after the header's sentence, in the
 * same paragraph, about a member it wrote into the module (#30572: one the
 * first pass never moved, so the list does not name it). Those words come back
 * as `tail`, and the header is accepted only when `moduleHeaderLines` of the
 * names and that tail rewraps to it byte for byte: what the pass rewrites is
 * then exactly the sentence it owns, with the hand's words after it carried
 * over, and the undo rewraps the same tail.
 */
function headerNamesOf(text, title) {
  const region = headerRegionOf(text);
  if (!region) return null;
  const prose = text.slice(region.start, region.end).split('\n').map((l) => l.replace(/^ \*( |$)/, '')).join(' ');
  const i = prose.indexOf(' the bodies of ');
  const j = i < 0 ? -1 : prose.indexOf(HEADER_SENTENCE_END, i);
  if (j < 0) return null;
  const names = [...prose.slice(i, j).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const rest = prose.slice(j + HEADER_SENTENCE_END.length);
  const tail = rest === '' ? [] : rest.startsWith(' ') ? rest.slice(1).split(' ') : null;
  if (!tail || tail.some((w) => w === '')) return null;
  return moduleHeaderLines(title, names, tail).join('\n') === text.slice(region.start, region.end) ? { region, names, tail } : null;
}

/** A facet module's host interface: its member lines, each `[readonly ]m: Class['m'];`, in order. */
function interfaceRegionOf(text, hostName) {
  const head = `\nexport interface ${hostName} {\n`;
  const i = text.indexOf(head);
  if (i < 0) return null;
  const start = i + head.length;
  const end = text.indexOf('\n}', start);
  const members = new Map();
  let classType = null;
  const lines = text.slice(start, end).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === FACADE_DOC) {
      // The identity port (#30020 R1): its docblock, then `readonly facade: <class>;`.
      const f = new RegExp(`^ {2}readonly ${FACADE_MEMBER}: ([A-Za-z]+);$`).exec(lines[i + 1] ?? '');
      if (!f || (classType && classType !== f[1])) return null;
      classType = f[1];
      members.set(FACADE_MEMBER, { line: `${line}\n${lines[i + 1]}`, readonly: true, facade: true });
      i += 1;
      continue;
    }
    const m = /^ {2}(readonly )?([A-Za-z_$][\w$]*): ([A-Za-z]+)\['([A-Za-z_$][\w$]*)'\];$/.exec(line);
    if (!m || m[2] !== m[4] || (classType && classType !== m[3])) return null;
    classType = m[3];
    members.set(m[2], { line, readonly: Boolean(m[1]) });
  }
  const names = [...members.keys()];
  if (names.join() !== [...names].sort().join()) return null;
  return { start, end, members, classType };
}

/** One facet's host factory in the class's install block (`hostInstallLines`), parsed back; null when it is not that shape. */
function installRegionOf(text, moduleFile) {
  const head = `    ${hostVarOf(moduleFile)}.install((engine) => ({\n`;
  const i = text.indexOf(head);
  if (i < 0 || text.indexOf(head, i + 1) >= 0) return null;
  const start = i + head.length;
  const end = text.indexOf('\n    }));', start);
  if (end < 0) return null;
  const members = new Map();
  const written = new Set();
  for (const line of text.slice(start, end).split('\n')) {
    let m;
    if (line === FACADE_INSTALL_LINE) members.set(FACADE_MEMBER, 'facade');
    else if ((m = /^ {6}get ([\w$]+)\(\) \{ return engine\.\1; \},$/.exec(line))) members.set(m[1], 'getter');
    else if ((m = /^ {6}set ([\w$]+)\(v\) \{ engine\.\1 = v; \},$/.exec(line))) written.add(m[1]);
    else if ((m = /^ {6}get ([\w$]+)\(\) \{ return engine\.\1\.bind\(engine\); \},$/.exec(line))) members.set(m[1], 'method');
    else if ((m = /^ {6}([\w$]+): \(\.\.\.a\) => engine\.\1\(\.\.\.a\),$/.exec(line))) members.set(m[1], 'method');
    else return null;
  }
  if (hostInstallLines(members, written).join('\n') !== text.slice(start, end)) return null;
  return { start, end, members, written };
}

/** The statics route (`staticsTexts`) in `engine.ts`, parsed back: its kinds and both regions; null when absent or not that shape. */
function staticsRegionOf(text) {
  const head = `export interface ${STATICS_HOST_NAME} {\n`;
  const i = text.indexOf(head);
  if (i < 0) return null;
  const end = text.indexOf('\n}', i);
  const kinds = new Map();
  for (const line of text.slice(i + head.length, end).split('\n')) {
    const m = new RegExp(`^ {2}readonly ([\\w$]+): \\(typeof ${CLASS_NAME}\\)\\['([\\w$]+)'\\];$`).exec(line);
    if (!m || m[1] !== m[2]) return null;
    kinds.set(m[1], text.includes(`      ${m[1]}: { value: (...args: Parameters<typeof ${CLASS_NAME}.${m[1]}>)`) ? 'method' : 'getter');
  }
  const t = staticsTexts(kinds);
  const a = text.indexOf(t.ahead);
  const b = text.indexOf(t.block);
  if (a < 0 || b < 0 || text.indexOf(t.ahead, a + 1) >= 0 || text.indexOf(t.block, b + 1) >= 0) return null;
  return { kinds, ahead: { start: a, end: a + t.ahead.length }, block: { start: b, end: b + t.block.length } };
}

/** The facet class of a module and its members' texts, each from its line start; null unless they are joined by one blank line. */
function facetMembersOf(tm, moduleFile, text) {
  const sf = parse(tm, join(SRC_DIR, moduleFile), text);
  const facet = sf.getClass(facetNameOf(moduleFile));
  if (!facet) return null;
  const open = `export class ${facetNameOf(moduleFile)} {\n`;
  const bodyStart = text.indexOf(open);
  if (bodyStart < 0) return null;
  const start = bodyStart + open.length;
  const end = facet.getEnd() - 2;
  const members = facet.getMembers().map((m) => ({ name: m.getName(), node: m, text: text.slice(lineStartOf(text, m.getStart(true)), m.getEnd()) }));
  if (members.length === 0 || members.map((m) => m.text).join('\n\n') !== text.slice(start, end)) return null;
  return { start, end, members };
}

/** The `Pick` keys a facet member's `this` names, or [] when it takes no host. */
function picksOf(member) {
  const p = member.node.getParameters()[0];
  if (!p || p.getName() !== 'this') return [];
  const m = /^this: Pick<[A-Za-z]+, (.+)>$/.exec(p.getText());
  return m ? m[1].split(' | ').map((q) => q.slice(1, -1)) : ['<unparsed Pick>'];
}

/** A module's import declarations, each with its bindings (local -> { form, imported, value }). */
function importDeclsOf(tm, moduleFile, text) {
  const ts = tm.ts;
  const sf = parseSourceFile(join(SRC_DIR, moduleFile), text);
  return sf.statements.filter((st) => ts.isImportDeclaration(st)).map((st) => {
    const clause = st.importClause;
    const declType = Boolean(clause && clause.isTypeOnly);
    const bindings = new Map();
    if (clause && clause.name) bindings.set(clause.name.text, { form: 'default', value: !declType });
    const nb = clause && clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) bindings.set(nb.name.text, { form: 'namespace', value: !declType });
    if (nb && ts.isNamedImports(nb)) {
      for (const e of nb.elements) bindings.set(e.name.text, { form: 'named', imported: (e.propertyName ?? e.name).text, value: !declType && !e.isTypeOnly });
    }
    return { specifier: st.moduleSpecifier.text, start: st.getStart(sf), end: st.getEnd(), bindings };
  });
}

/** The lines one specifier's bindings render to in a facet module: the leaf and `engine.ts` by `importPair`, a package by `specifierImportLines`. */
function specifierLines(specifier, bindings, styles = {}) {
  if (specifier === leafSpecifier() || specifier === './engine.js') {
    if ([...bindings].some(([local, e]) => e.form !== 'named' || e.imported !== local)) return null;
    return importPair(specifier, new Map([...bindings].map(([n, e]) => [n, { value: e.value }])), styles);
  }
  return specifierImportLines(specifier, bindings);
}

/**
 * Drop the import bindings nothing in a facet module reads, re-rendering each
 * specifier's lines as the first pass writes them (`specifierLines`), so a
 * pruned leaf list wraps as `namedStatement` wraps it. `inverse` is the import
 * edits a move made that a read cannot tell back (`importEditsOf`): the
 * bindings it added are dropped though something left still reads them, and
 * the ones it widened from type-only to value are made type-only again.
 */
function pruneModuleImports(tm, moduleFile, text, inverse = { added: new Set(), widened: new Set() }) {
  const used = usedImportNames(tm, text);
  const decls = importDeclsOf(tm, moduleFile, text);
  const edits = [];
  for (const specifier of new Set(decls.map((d) => d.specifier))) {
    const run = decls.filter((d) => d.specifier === specifier);
    const have = new Map();
    for (const d of run) for (const [local, e] of d.bindings) have.set(local, e);
    const key = (local) => importKey(specifier, local);
    const kept = new Map([...have]
      .filter(([local]) => used.has(local) && !inverse.added.has(key(local)))
      .map(([local, e]) => [local, inverse.widened.has(key(local)) ? { ...e, value: false } : e]));
    if (kept.size === have.size && [...kept].every(([local, e]) => e.value === have.get(local).value)) continue;
    const start = run[0].start;
    if (kept.size === 0) {
      const end = text[run.at(-1).end] === '\n' ? run.at(-1).end + 1 : run.at(-1).end;
      edits.push({ start, end, text: '' });
    } else {
      const lines = specifierLines(specifier, kept, runStyles(text, run, specifier) ?? {});
      if (!lines) refuse(`${moduleFile}: ${specifier} is imported in a form this pass does not write`);
      edits.push({ start, end: run.at(-1).end, text: lines.join('\n') });
    }
  }
  return applyOrderedEdits(text, edits);
}

/**
 * Decide the moves `names` asks for on a split `engine.ts`. Refuses (exit 2)
 * on a name the class does not declare as one method, a method already a stub,
 * one any stay rule of the first pass holds, and on any shape this pass does
 * not grow a written module by (see the section above). Pure.
 */
function planMembers(tm, text, moduleTexts, names, { anchors = SECTION_ANCHORS, pins = PATH_READER_PINS, needles = PATH_READER_NEEDLES, classNeedles = CLASS_PATH_READER_NEEDLES } = {}) {
  if (!names || names.length === 0) refuse('--members needs a comma-separated list of ObjectQL method names');
  if (new Set(names).size !== names.length) refuse(`--members names a method twice: ${names.join(', ')}`);
  const ctx = membersContext(tm, text, { pins, needles, classNeedles });
  const methodNames = new Set(ctx.cls.getMethods().map((m) => m.getName()));
  const stalePins = Object.keys(pins).filter((n) => !methodNames.has(n) && !ctx.scope.bindings.has(n));
  if (stalePins.length > 0) refuse(`PATH_READER_PINS names what ${HOST_BASENAME} no longer declares: ${stalePins.join(', ')}`);
  const sectionOf = readSections(ctx.cls, anchors);
  const records = [];
  for (const name of names) {
    const found = ctx.cls.getMethods().filter((m) => m.getName() === name);
    if (found.length !== 1) refuse(`--members names ${name}, which ${CLASS_NAME} declares as ${found.length === 0 ? 'no method' : 'more than one method'}`);
    const m = found[0];
    if (isGeneratedStub(m)) refuse(`${name} is already moved: its body is a ${MARK} stub`);
    const read = readMethod(tm, ctx, m);
    const section = sectionOf(m);
    if (!section) read.reasons.unshift('no-section');
    else if (section[2] === null) read.reasons.unshift('section-kept');
    else for (const p of m.getParameters()) if (p.getName() === facetNameOf(section[2])) read.reasons.push(`parameter-shadows: ${p.getName()}`);
    if (read.reasons.length > 0) {
      refuse(`${name} stays on the class, as the first pass would keep it: ${read.reasons.map((r) => `${r} (${STAY_REASONS[r.split(':')[0]] ?? r})`).join('; ')}`);
    }
    const docStart = m.getStart(true);
    const doc = m.getScope() === 'private' && docStart < m.getStart() ? text.slice(docStart, m.getStart()) : null;
    records.push({ name, node: m, module: section[2], section: section[1], doc, ...read });
  }
  records.sort((a, b) => a.node.getStart() - b.node.getStart());
  const modules = new Map();
  for (const r of records) modules.set(r.module, [...(modules.get(r.module) ?? []), r]);
  for (const [file, movers] of modules) {
    const mod = moduleTexts.get(file);
    if (mod == null || !mod.includes(MARK)) refuse(`${file} is not on disk as the first pass wrote it: this pass adds to a written facet, never starts one`);
    const routed = new RegExp(`^import \\{[^}]*\\b${STATICS_NAME} as ${CLASS_NAME}\\b[^}]*\\} from '\\./engine\\.js';$`, 'm').test(mod);
    const hasHost = interfaceRegionOf(mod, hostNameOf(file)) !== null;
    const typeImportsClass = new RegExp(`^import type \\{[^}]*\\b${CLASS_NAME}\\b[^}]*\\} from '\\./engine\\.js';$`, 'm').test(mod);
    for (const r of movers) {
      if (r.host.size > 0 && !hasHost) refuse(`${r.name} reads the class, and ${file} has no host: this pass does not give a facet one`);
      if (r.host.size > 0 && r.node.getParameters().some((p) => p.getName() === hostVarOf(file))) {
        refuse(`${r.name}: a parameter is named ${hostVarOf(file)}, which its stub reads as the facet's host`);
      }
      if (r.classStatics.size > 0 && !routed) refuse(`${r.name} reads statics of ${CLASS_NAME}, and ${file} does not take the statics route: this pass does not reroute a module`);
      if (routed) {
        const blockers = [...r.routeBlockers, ...(r.classOther ? ['static-route-conflict'] : [])];
        if (blockers.length > 0) refuse(`${r.name} stays on the class, as the first pass would keep it in a routed module: ${blockers.join('; ')}`);
      }
      for (const [n, use] of r.moduleRefs) {
        if (n === CLASS_NAME && (routed || (!use.value && typeImportsClass))) continue;
        // R4 (#30020): a name `engine.ts` already exports is imported from it
        // (lever (a) of ruling 6591753301); no export list widens.
        if (n !== CLASS_NAME && ctx.scope.exported.has(n) && ctx.scope.bindings.get(n)?.kind === 'local') {
          if (routed) refuse(`${r.name} reads ${n}, a name ${HOST_BASENAME} exports, and ${file} takes the statics route: this pass does not import into a routed module's \`./engine.js\` line`);
          continue;
        }
        refuse(`${r.name} reads ${n}, a top-level name of ${HOST_BASENAME}: this pass does not widen the generated export lists`);
      }
      for (const local of r.imports.keys()) {
        const b = ctx.scope.bindings.get(local);
        if (!b || b.kind !== 'import') refuse(`import binding ${local} not found`);
      }
    }
  }
  return { ctx, records, modules };
}

/** Apply a `planMembers` plan. Returns `{ host, modules, pruned }` (`modules`: the receiving modules' new texts). Pure. */
function generateMembers(tm, text, moduleTexts, planned) {
  const { ctx, modules } = planned;
  const edits = [];
  const newStatics = new Map();
  for (const [file, movers] of modules) {
    for (const r of movers) {
      const body = r.node.getBody();
      const lineStart = lineStartOf(text, body.getEnd() - 1);
      const closeIndent = text.slice(lineStart, body.getEnd() - 1);
      if (!/^ *$/.test(closeIndent)) refuse(`${r.name}: the body's closing brace does not open its own line`);
      edits.push({ start: body.getStart(), end: body.getEnd(), text: stubBody({ node: r.node, name: r.name, usesHost: r.host.size > 0, docMoved: Boolean(r.doc) }, file, closeIndent) });
      const asyncKw = r.node.getModifiers().find((x) => x.getKind() === tm.SyntaxKind.AsyncKeyword);
      if (asyncKw) edits.push({ start: asyncKw.getStart(), end: r.node.getNameNode().getStart(), text: '' });
      if (r.doc) edits.push({ start: r.node.getStart(true), end: r.node.getStart(), text: '' });
      for (const [k, kind] of r.classStatics) newStatics.set(k, kind);
    }
    const members = new Map();
    const written = new Set();
    for (const r of movers) for (const [k, kind] of r.host) members.set(k, kind);
    for (const r of movers) for (const k of r.writes) written.add(k);
    if (members.size === 0) continue;
    const inst = installRegionOf(text, file);
    if (!inst) refuse(`${file}: its host factory in ${HOST_BASENAME}'s install block is not as the first pass wrote it`);
    const merged = new Map(inst.members);
    for (const [k, kind] of members) {
      if (merged.has(k) && merged.get(k) !== kind) refuse(`${file}: host member ${k} is a ${merged.get(k)} there and a ${kind} here`);
      merged.set(k, kind);
    }
    const mergedWritten = new Set([...inst.written, ...written]);
    const lines = hostInstallLines(merged, mergedWritten).join('\n');
    if (lines !== text.slice(inst.start, inst.end)) edits.push({ start: inst.start, end: inst.end, text: lines });
  }
  if (newStatics.size > 0) {
    const region = staticsRegionOf(text);
    if (!region) refuse(`${HOST_BASENAME}: its statics route is not as the first pass wrote it`);
    const merged = new Map(region.kinds);
    for (const [k, kind] of newStatics) merged.set(k, kind);
    if (merged.size > region.kinds.size) {
      const t = staticsTexts(merged);
      edits.push({ start: region.ahead.start, end: region.ahead.end, text: t.ahead });
      edits.push({ start: region.block.start, end: region.block.end, text: t.block });
    }
  }
  const out = applyOrderedEdits(text, edits);
  const pruned = pruneHostImports(tm, out, usedImportNames(tm, out));

  const moduleOut = new Map();
  for (const [file, movers] of modules) {
    const mod = moduleTexts.get(file);
    const title = movers[0].section;
    const modEdits = [];
    // The members, in class order among the ones the module holds.
    const facet = facetMembersOf(tm, file, mod);
    if (!facet) refuse(`${file}: its facet class is not as the first pass wrote it`);
    const classPos = (name) => {
      const ms = ctx.cls.getMethods().filter((m) => m.getName() === name);
      if (ms.length !== 1) refuse(`${file}: facet member ${name} has ${ms.length} methods of that name on the class`);
      return ms[0].getStart();
    };
    const held = facet.members.map((m) => ({ ...m, at: classPos(m.name) }));
    const hostName = hostNameOf(file);
    const groups = new Map();
    for (const r of movers) {
      const next = held.find((m) => m.at > r.node.getStart());
      const key = next ? next.name : '';
      groups.set(key, [...(groups.get(key) ?? []), facetMethodText(r, hostName)]);
    }
    for (const [key, texts] of groups) {
      if (key) {
        const at = lineStartOf(mod, held.find((m) => m.name === key).node.getStart(true));
        modEdits.push({ start: at, end: at, text: texts.map((t) => `${t}\n\n`).join('') });
      } else {
        const at = held.at(-1).node.getEnd();
        modEdits.push({ start: at, end: at, text: texts.map((t) => `\n\n${t}`).join('') });
      }
    }
    // The header's list gains the names, each before the first listed name declared below it on the class.
    const header = headerNamesOf(mod, title);
    if (!header) refuse(`${file}: its header is not as the first pass wrote it`);
    const listed = [...header.names];
    for (const r of movers) {
      const k = listed.findIndex((n) => classPos(n) > r.node.getStart());
      listed.splice(k < 0 ? listed.length : k, 0, r.name);
    }
    modEdits.push({ start: header.region.start, end: header.region.end, text: moduleHeaderLines(title, listed, header.tail).join('\n') });
    // The host interface gains what the moved bodies read.
    const reads = new Map();
    const writes = new Set();
    for (const r of movers) for (const [k, kind] of r.host) reads.set(k, kind);
    for (const r of movers) for (const k of r.writes) writes.add(k);
    if (reads.size > 0) {
      const iface = interfaceRegionOf(mod, hostName);
      if (!iface) refuse(`${file}: its host interface is not as the first pass wrote it`);
      const lines = new Map([...iface.members].map(([k, v]) => [k, v.line]));
      for (const [k, kind] of reads) {
        const readonly = kind === 'facade' || (kind === 'getter' && !writes.has(k));
        const prev = iface.members.get(k);
        if (prev && prev.readonly && !readonly) refuse(`${file}: host member ${k} is read-only there, and a moved body ${kind === 'getter' ? 'assigns' : 'calls'} it`);
        if (prev && Boolean(prev.facade) !== (kind === 'facade')) refuse(`${file}: host member ${k} is not the identity port there`);
        if (!prev) lines.set(k, kind === 'facade' ? facadeIfaceLine(iface.classType) : `  ${readonly ? 'readonly ' : ''}${k}: ${iface.classType}['${k}'];`);
      }
      modEdits.push({ start: iface.start, end: iface.end, text: [...lines.keys()].sort().map((k) => lines.get(k)).join('\n') });
    }
    // The import lines gain the bindings the moved bodies read, by specifier.
    const decls = importDeclsOf(tm, file, mod);
    const adds = new Map(); // specifier -> Map(local -> binding)
    for (const r of movers) {
      for (const [local, use] of r.imports) {
        const b = ctx.scope.bindings.get(local);
        const slot = adds.get(b.specifier) ?? new Map();
        const prev = slot.get(local);
        slot.set(local, { form: b.form, imported: b.imported, value: Boolean(prev && prev.value) || (use.value && !b.typeOnly) });
        adds.set(b.specifier, slot);
      }
      // R4: the names `engine.ts` already exports, onto the module's `./engine.js` lines.
      for (const [n, use] of r.moduleRefs) {
        if (n === CLASS_NAME) continue;
        const slot = adds.get('./engine.js') ?? new Map();
        const prev = slot.get(n);
        slot.set(n, { form: 'named', imported: n, value: Boolean(prev && prev.value) || use.value });
        adds.set('./engine.js', slot);
      }
    }
    const tail = decls.findIndex((d) => d.specifier === leafSpecifier() || d.specifier === './engine.js');
    const inserts = new Map(); // offset -> [{ order, text }]
    for (const [specifier, slot] of adds) {
      const run = decls.map((d, i) => ({ d, i })).filter(({ d }) => d.specifier === specifier);
      if (run.length > 0) {
        if (run.at(-1).i - run[0].i !== run.length - 1) refuse(`${file}: the imports of ${specifier} are not one run`);
        const have = new Map();
        for (const { d } of run) for (const [local, e] of d.bindings) have.set(local, e);
        const styles = runStyles(mod, run.map(({ d }) => d), specifier);
        const before = styles && specifierLines(specifier, have, styles);
        const span = mod.slice(run[0].d.start, run.at(-1).d.end);
        if (!before || before.join('\n') !== span) refuse(`${file}: the imports of ${specifier} are not as the first pass wrote them`);
        const merged = new Map(have);
        for (const [local, e] of slot) {
          const prev = merged.get(local);
          if (prev && (prev.form !== e.form || prev.imported !== e.imported)) refuse(`${file}: ${local} is bound differently there`);
          merged.set(local, { ...e, value: Boolean(prev && prev.value) || e.value });
        }
        modEdits.push({ start: run[0].d.start, end: run.at(-1).d.end, text: specifierLines(specifier, merged, styles).join('\n') });
        continue;
      }
      for (const [local] of slot) if (decls.some((d) => d.bindings.has(local))) refuse(`${file}: ${local} is bound there from another specifier`);
      const lines = specifierLines(specifier, slot);
      if (!lines) refuse(`${file}: ${specifier} would be imported in a form this pass does not write`);
      const rank = ctx.scope.importOrder.get(specifier);
      let at;
      let text = `${lines.join('\n')}\n`;
      if (specifier === leafSpecifier()) {
        const engineDecl = decls.find((d) => d.specifier === './engine.js');
        at = engineDecl ? lineStartOf(mod, engineDecl.start) : null;
      } else {
        const next = decls.slice(0, tail < 0 ? decls.length : tail).find((d) => {
          const o = ctx.scope.importOrder.get(d.specifier);
          return o !== undefined && o > rank;
        });
        at = next ? lineStartOf(mod, next.start) : tail >= 0 ? lineStartOf(mod, decls[tail].start) : null;
      }
      if (at === null) { at = decls.at(-1).end; text = `\n${lines.join('\n')}`; }
      inserts.set(at, [...(inserts.get(at) ?? []), { order: specifier === leafSpecifier() ? Infinity : rank, text }]);
    }
    for (const [at, list] of inserts) {
      list.sort((a, b) => a.order - b.order);
      modEdits.push({ start: at, end: at, text: list.map((x) => x.text).join('') });
    }
    moduleOut.set(file, withCyclePara(applyOrderedEdits(mod, modEdits), file));
  }
  return { host: pruned.text, modules: moduleOut, pruned: pruned.removed };
}

/** One import binding's identity in a module: its specifier and its local name. */
const importKey = (specifier, local) => `${specifier}\u0000${local}`;

/**
 * The import edits this pass made to a receiving module, read off its base
 * and head import blocks (#30572): the bindings the head has and the base had
 * not (`added`), and the ones the base bound type-only and the head binds as a
 * value (`widened`). The prune alone cannot undo either when the module's
 * remaining text still reads the name: a docblock link the base carried
 * unresolved resolves once a moved body's import binds it, and a binding a
 * staying member reads as a type reads as one still. So the proof inverts the
 * edits it reads here instead, and each is checked on the way (`fail`): it is
 * one the moved members' own text reads (a moved body, or its docblock), and
 * the head never narrowed or dropped a base binding, which no undo could
 * restore. The comparison stays byte for byte: the edits name bindings only,
 * and the lines they leave are rendered as the first pass writes them.
 */
function importEditsOf(tm, file, baseText, headText, movedText, fail) {
  const bindingsOf = (text) => {
    const out = new Map();
    for (const d of importDeclsOf(tm, file, text)) for (const [local, e] of d.bindings) out.set(importKey(d.specifier, local), { local, ...e });
    return out;
  };
  const base = bindingsOf(baseText);
  const head = bindingsOf(headText);
  const added = new Set();
  const widened = new Set();
  const readByMoved = (local) => new RegExp(`\\b${local.replace(/\$/g, '\\$')}\\b`).test(movedText);
  for (const [k, h] of head) {
    const b = base.get(k);
    if (b && b.value === h.value) continue;
    if (b && b.value && !h.value) { fail(`${file}: binds ${h.local} type-only, where its base bound it as a value`); continue; }
    if (!readByMoved(h.local)) { fail(`${file}: ${b ? 'binds as a value' : 'imports'} ${h.local}, which ${b ? 'its base bound type-only' : 'its base did not'} and no moved member reads`); continue; }
    (b ? widened : added).add(k);
  }
  for (const [k, b] of base) if (!head.has(k)) fail(`${file}: dropped the import binding ${b.local}, which no undo can restore`);
  return { added, widened };
}

/**
 * Undo this pass's moves out of one receiving module, from its head text and
 * its base's import block: drop the named members and their names from the
 * header's list, keep the host members the rest still `Pick`, invert the
 * import edits the moves made (`importEditsOf`) and prune the imports nothing
 * reads. Checks the head on the way (`fail`): the header lists them, the
 * interface is the union of the `Pick`s, and no import binding is unread.
 * Returns the text, or null when the head is not a module this pass can read.
 */
function undoMembersModule(tm, file, text, names, title, fail, baseText) {
  const facet = facetMembersOf(tm, file, text);
  const header = headerNamesOf(text, title);
  if (!facet || !header) { fail(`${file}: not a facet module as the first pass writes one`); return null; }
  for (const n of names) if (!header.names.includes(n)) fail(`${file}: its header does not list ${n}`);
  const union = (ms) => new Set(ms.flatMap((m) => picksOf(m)));
  const iface = interfaceRegionOf(text, hostNameOf(file));
  const headUnion = union(facet.members);
  if ((iface ? [...iface.members.keys()].join() : '') !== [...headUnion].sort().join()) fail(`${file}: its host interface is not exactly the members its bodies' Picks name`);
  const unread = pruneImports(tm, text, usedImportNames(tm, text)).removed;
  if (unread.length > 0) fail(`${file}: imports what nothing in it reads: ${unread.join(', ')}`);
  const keep = facet.members.filter((m) => !names.includes(m.name));
  if (keep.length === 0) { fail(`${file}: every member is one this pass moved (it never starts a facet)`); return null; }
  const movedText = facet.members.filter((m) => names.includes(m.name)).map((m) => m.text).join('\n');
  const inverse = importEditsOf(tm, file, baseText, text, movedText, fail);
  const edits = [
    { start: facet.start, end: facet.end, text: keep.map((m) => m.text).join('\n\n') },
    { start: header.region.start, end: header.region.end, text: moduleHeaderLines(title, header.names.filter((n) => !names.includes(n)), header.tail).join('\n') },
  ];
  if (iface) {
    const kept = union(keep);
    edits.push({ start: iface.start, end: iface.end, text: [...iface.members].filter(([k]) => kept.has(k)).map(([, v]) => v.line).join('\n') });
  }
  if (importsEngineValues(text) !== text.includes(VALUES_CYCLE_PARA)) fail(`${file}: its header's import paragraph does not say what its \`./engine.js\` lines import`);
  return withCyclePara(pruneModuleImports(tm, file, applyOrderedEdits(text, edits), inverse), file);
}

/** The statics `ObjectQL.x` each routed module's text reads. */
function routedStaticReads(texts) {
  const reads = new Set();
  const routedImport = new RegExp(`^import \\{[^}]*\\b${STATICS_NAME} as ${CLASS_NAME}\\b`, 'm');
  for (const t of texts) {
    if (!t || !routedImport.test(t)) continue;
    for (const m of t.matchAll(new RegExp(`\\b${CLASS_NAME}\\.([A-Za-z_$][\\w$]*)`, 'g'))) reads.add(m[1]);
  }
  return reads;
}

/**
 * Prove this pass's moves against their base, from the texts alone (it
 * shares no state with `generateMembers`). `baseModules` / `headModules`: the
 * first pass's generated modules (leaf and hosts module included) at each
 * side, by file. Returns `{ failures, moved, pruned, linesBefore, linesAfter }`.
 */
function verifyMembers(tm, baseText, headText, baseModules, headModules, {
  anchors = SECTION_ANCHORS, pins = PATH_READER_PINS, needles = PATH_READER_NEEDLES, classNeedles = CLASS_PATH_READER_NEEDLES,
} = {}) {
  const failures = [];
  const fail = (msg) => failures.push(msg);
  const moved = [];
  const base = membersContext(tm, baseText, { pins, needles, classNeedles });
  const headCls = parse(tm, HOST_PATH, headText).getClass(CLASS_NAME);
  const done = (pruned = []) => ({ failures, moved: moved.map((mv) => mv.name), pruned, linesBefore: lineCount(baseText), linesAfter: lineCount(headText) });
  if (!headCls) { fail(`no class ${CLASS_NAME} at head`); return done(); }
  const key = (m) => `${m.isStatic() ? 'static ' : ''}${m.getName()}`;
  const baseMethods = new Map(base.cls.getMethods().map((m) => [key(m), m]));
  const headMethods = new Map(headCls.getMethods().map((m) => [key(m), m]));
  if ([...baseMethods.keys()].join() !== [...headMethods.keys()].join()) fail(`${CLASS_NAME} does not declare the same methods in the same order at base and head`);
  for (const [k, hm] of headMethods) {
    const bm = baseMethods.get(k);
    if (!bm) continue;
    if (isGeneratedStub(bm) && !isGeneratedStub(hm)) fail(`${k}: a stub at base is a body at head`);
    if (!isGeneratedStub(hm) || isGeneratedStub(bm)) continue;
    const m = STUB_MARK_LINE.exec(hm.getBody().getText());
    moved.push({ name: hm.getName(), hm, bm, file: m[1], docMoved: Boolean(m[2]), usesHost: Boolean(m[3]) });
  }
  if (moved.length === 0) fail('nothing moved: the head carries no stub its base did not');
  const sectionOf = readSections(base.cls, anchors);
  for (const mv of moved) {
    const { name, hm, bm, file } = mv;
    const section = sectionOf(bm);
    if (!section || section[2] !== file) { fail(`${name}: its stub names ${file}, and its section's module is ${section?.[2] ?? 'none'}`); continue; }
    mv.title = section[1];
    const read = readMethod(tm, base, bm);
    if (read.reasons.length > 0) fail(`${name}: a stay rule holds it at base (${read.reasons.join('; ')})`);
    if ((read.host.size > 0) !== mv.usesHost) fail(`${name}: its stub ${mv.usesHost ? 'hands' : 'hands no'} host, and its base body reads ${read.host.size > 0 ? 'the class' : 'no class member'}`);
    const text = headModules.get(file);
    const facet = text && text.includes(MARK) ? facetMembersOf(tm, file, text) : null;
    const fm = facet?.members.find((m) => m.name === name);
    if (!fm) { fail(`${name}: ${file} at head holds no facet member ${name}`); continue; }
    mv.fm = fm.node;
    mv.moduleText = text;
    const body = hm.getBody();
    const closeIndent = headText.slice(lineStartOf(headText, body.getEnd() - 1), body.getEnd() - 1);
    if (body.getText() !== stubBody({ node: hm, name, usesHost: mv.usesHost, docMoved: mv.docMoved }, file, closeIndent)) fail(`${name}: the stub is not the first pass's stub`);
    if (hm.isAsync()) fail(`${name}: the stub kept \`async\``);
    const baseDoc = bm.getScope() === 'private' && bm.getStart(true) < bm.getStart() ? baseText.slice(bm.getStart(true), bm.getStart()) : null;
    if (mv.docMoved !== (baseDoc !== null)) fail(`${name}: its stub says its docblock ${mv.docMoved ? 'moved' : 'stayed'}, and the base method is ${baseDoc === null ? 'not a private one with a docblock' : 'a private one with a docblock'}`);
    if (fm.text !== facetMethodText({ name, node: bm, host: read.host, doc: baseDoc, identity: read.identity }, hostNameOf(file))) {
      fail(`${name}: the facet member is not its base method's text (docblock, parameters, return type, body)`);
    }
  }

  // The modules: the receiving ones undo to their base; every other one is its base.
  const touched = new Map();
  for (const mv of moved) if (mv.fm) touched.set(mv.file, [...(touched.get(mv.file) ?? []), mv]);
  const undone = new Map();
  for (const file of new Set([...baseModules.keys(), ...headModules.keys()])) {
    const b = baseModules.get(file) ?? null;
    const h = headModules.get(file) ?? null;
    if (!touched.has(file)) {
      if (b !== h) fail(`${file}: changed, and no member this pass moved is in it`);
      continue;
    }
    if (b === null) { fail(`${file}: absent at base (this pass never starts a facet)`); continue; }
    const mvs = touched.get(file);
    const u = undoMembersModule(tm, file, h, mvs.map((mv) => mv.name), mvs[0].title, fail, b);
    if (u === null) continue;
    undone.set(file, u);
    if (u !== b) fail(`undoing the moves out of ${file} does not rebuild its base (first difference at line ${firstDiffLine(u, b)})`);
  }

  // engine.ts: each body, docblock and `async` back; the route and the host factories lose what only moved bodies read.
  const edits = [];
  for (const mv of moved) {
    if (!mv.fm) continue;
    const body = mv.hm.getBody();
    edits.push({ start: body.getStart(), end: body.getEnd(), text: identityUndoText(tm, mv.fm) });
    if (mv.fm.isAsync()) edits.push({ start: mv.hm.getNameNode().getStart(), end: mv.hm.getNameNode().getStart(), text: 'async ' });
    if (mv.docMoved) edits.push({ start: mv.hm.getStart(), end: mv.hm.getStart(), text: mv.moduleText.slice(mv.fm.getStart(true), mv.fm.getStart()) });
  }
  const sections = [...headModules.keys()].filter((f) => f !== LEAF_MODULE && f !== HOSTS_MODULE);
  const statics = staticsRegionOf(headText);
  if (statics) {
    const readAtHead = routedStaticReads(sections.map((f) => headModules.get(f)));
    for (const k of statics.kinds.keys()) if (!readAtHead.has(k)) fail(`${STATICS_NAME} carries ${k}, which no routed facet body reads`);
    const readUndone = routedStaticReads(sections.map((f) => undone.get(f) ?? headModules.get(f)));
    const kept = new Map([...statics.kinds].filter(([k]) => readUndone.has(k)));
    if (kept.size !== statics.kinds.size) {
      const t = staticsTexts(kept);
      edits.push({ start: statics.ahead.start, end: statics.ahead.end, text: t.ahead });
      edits.push({ start: statics.block.start, end: statics.block.end, text: t.block });
    }
  } else if (headText.includes(`export interface ${STATICS_HOST_NAME} {`)) {
    fail(`${HOST_BASENAME}: its statics route is not as the first pass writes it`);
  }
  for (const file of touched.keys()) {
    const head = headModules.get(file);
    const iface = interfaceRegionOf(head, hostNameOf(file));
    if (!iface) continue;
    const inst = installRegionOf(headText, file);
    if (!inst) { fail(`${file}: its host factory in ${HOST_BASENAME} is not as the first pass writes it`); continue; }
    for (const [k, v] of iface.members) {
      const kind = inst.members.get(k);
      const readonly = kind === 'facade' || (kind === 'getter' && !inst.written.has(k));
      if (!kind || v.readonly !== readonly || Boolean(v.facade) !== (kind === 'facade')) fail(`${file}: host member ${k} is not the same member in its interface and its factory`);
    }
    if (inst.members.size !== iface.members.size) fail(`${file}: its host factory forwards members its interface does not declare`);
    const u = undone.get(file);
    const keptIface = u ? interfaceRegionOf(u, hostNameOf(file)) : null;
    if (!keptIface) continue;
    const kept = new Map([...inst.members].filter(([k]) => keptIface.members.has(k)));
    if (kept.size !== inst.members.size) {
      edits.push({ start: inst.start, end: inst.end, text: hostInstallLines(kept, new Set([...inst.written].filter((k) => kept.has(k)))).join('\n') });
    }
  }
  let undoneHost = null;
  try {
    undoneHost = applyOrderedEdits(headText, edits);
  } catch (e) {
    if (!(e instanceof CodemodRefusal)) throw e;
    fail(`${HOST_BASENAME}: the undo's edits overlap`);
  }
  const prune = pruneHostImports(tm, baseText, usedImportNames(tm, headText));
  if (undoneHost !== null && undoneHost !== prune.text) {
    fail(`undoing the moves does not rebuild the base ${HOST_BASENAME} (first difference at line ${firstDiffLine(undoneHost, prune.text)})`);
  }
  const movedText = moved.map((mv) => mv.bm.getText()).join('\n');
  for (const n of prune.removed) {
    if (!new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(movedText)) fail(`${HOST_BASENAME} lost the import binding ${n}, which no moved body reads`);
  }
  return done(prune.removed);
}

function planReportMembers(planned) {
  const out = [`# codemod-split-engine --members (${MEMBERS_CARD}): named methods onto the split class`, ''];
  for (const [file, movers] of planned.modules) {
    out.push(`- ${file}: ${movers.map((r) => `${r.name} (${r.bodyLines ?? r.node.getBody().getEndLineNumber() - r.node.getBody().getStartLineNumber() + 1} body lines${r.doc ? ', its docblock with it' : ''})`).join(', ')}`);
  }
  return out.join('\n');
}

function printVerifyMembers(v) {
  for (const f of v.failures) console.error(`  ✗ ${f}`);
  console.log(`undo proof: ${v.moved.length} moved method(s) (${v.moved.join(', ') || 'none'}); engine.ts ${v.linesBefore} -> ${v.linesAfter} lines; ` +
    `undoing the moves ${v.failures.length > 0 ? 'does NOT' : 'does'} rebuild the base engine.ts and its modules byte-for-byte ` +
    `once the ${v.pruned.length} import binding(s) only moved bodies read are pruned from the base (${v.pruned.join(', ') || 'none'})`);
}

function generatedModulesAt(ref) {
  const out = new Map();
  for (const file of [LEAF_MODULE, HOSTS_MODULE, ...SECTION_ANCHORS.map((row) => row[2])]) {
    if (!file) continue;
    try {
      out.set(file, execFileSync('git', ['show', `${ref}:${SRC_REL}/${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch { /* absent at the ref */ }
  }
  return out;
}

async function mainMembers(tm, argv) {
  if (argv.includes('--verify')) {
    const i = argv.indexOf('--base');
    const ref = i >= 0 ? argv[i + 1] : null;
    if (!ref) refuse('--members --verify needs --base <ref>');
    const v = verifyMembers(tm, gitShow(ref, `${SRC_REL}/${HOST_BASENAME}`), readFileSync(HOST_PATH, 'utf8'), generatedModulesAt(ref), generatedModulesOnDisk());
    printVerifyMembers(v);
    return v.failures.length === 0 ? 0 : 1;
  }
  const j = argv.indexOf('--members');
  const value = argv[j + 1];
  const names = value && !value.startsWith('--') ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const input = readFileSync(HOST_PATH, 'utf8');
  const moduleTexts = generatedModulesOnDisk();
  const planned = planMembers(tm, input, moduleTexts, names);
  console.log(planReportMembers(planned));
  const out = generateMembers(tm, input, moduleTexts, planned);
  const headModules = new Map([...moduleTexts, ...out.modules]);
  console.log(`output tree sha256: ${treeHash(new Map([[HOST_BASENAME, out.host], ...headModules]))} (input sha256 ${sha256(input)})`);
  const v = verifyMembers(tm, input, out.host, moduleTexts, headModules);
  printVerifyMembers(v);
  if (v.failures.length > 0) {
    console.error('✗ the generated moves fail the undo proof: nothing written. Report the fork; never hand-edit the moves.');
    return 1;
  }
  if (!argv.includes('--write')) {
    console.log('plan only: nothing written (pass --write to apply).');
    return 0;
  }
  writeFileSync(HOST_PATH, out.host);
  for (const [file, text] of out.modules) writeFileSync(join(SRC_DIR, file), text);
  console.log(`✓ wrote ${HOST_BASENAME} and ${out.modules.size} module(s) under ${SRC_REL}`);
  return 0;
}

// ── The fifth pass: a hand stub's computing host slot (#30020 H2) ───────────
//
// A hand-series stub (#25467) builds its host as an object literal of
// one-line forwarders and makes one `.call(host, …)`; the facade gate reads
// that as a delegation. A slot that COMPUTES instead (a block-bodied arrow: a
// `try`, a branch) makes the whole stub a body, so the method stays an
// exception row. `--hand-slots <stubs>` moves every such slot of the named
// stubs into the stub's own hand module, the one its marker names: the arrow,
// exactly as it stood, one indentation level out (the slot's own line indent,
// put back by the undo), becomes an exported `const` of the slot's name typed
// AS the host interface's member (`ReferenceNameVisibleHost['x']`), so its
// parameters keep the contextual types the literal gave them; the slot names
// it (`x,`), and `engine.ts` imports it beside the function it already imports
// from that module. What the arrow may read is closed: its own parameters and
// locals, and module-scope names `engine.ts` imports, each imported in the
// hand module from the same specifier by a statement of its own. A `this`, a
// local of the stub, a name `engine.ts` declares, a template or string that
// spans lines, or a line not indented as far as the slot refuses (exit 2).
//
// The proof (`--hand-slots --verify --base REF` re-runs it) undoes every slot
// the head carries moved (a shorthand slot whose hand module exports a const
// of that name under this pass's docblock): the const back into its slot,
// re-indented; its docblock, its import statements and the binding in
// `engine.ts`'s import out. The result must be the base `engine.ts` (the
// base's import bindings only moved slots read pruned from it) and every hand
// module byte for byte.

const HAND_SLOTS_CARD = '#30020';

/** The docblock over a moved slot's const in its hand module. */
const handSlotDoc = (slot, stub, fn) => ['/**', ...wrapComment((
  `[${HAND_SLOTS_CARD} codemod] The \`${slot}\` slot of the host \`${CLASS_NAME}#${stub}\` hands {@link ${fn}}: ` +
  `moved here whole by \`--hand-slots\` of \`${SCRIPT}\`, and the slot names it.`).split(' ')), ' */'].join('\n');

/**
 * A hand stub of `engine.ts`, parsed: its host literal, the function it
 * calls and the module that declares it; null when the method is not a hand
 * stub of that shape (const forwarders, ONE host literal, `return fn.call(host, …)`).
 */
function handSlotStubOf(tm, cls, text, name) {
  const { Node } = tm;
  const found = cls.getMethods().filter((m) => m.getName() === name);
  if (found.length !== 1) return { why: `${CLASS_NAME} declares ${found.length === 0 ? 'no method' : 'more than one method'} ${name}` };
  const m = found[0];
  const body = m.getBody();
  if (!body) return { why: `${name} has no body` };
  const line1Start = text.indexOf('\n', body.getStart()) + 1;
  const hit = HAND_STUB_MARK.exec(text.slice(line1Start, text.indexOf('\n', line1Start)));
  if (!hit) return { why: `${name} is not a hand-series stub (its body does not open with the hand series' marker)` };
  const stmts = body.getStatements();
  const last = stmts.at(-1);
  const call = last && Node.isReturnStatement(last) ? last.getExpression() : null;
  const callee = call && Node.isCallExpression(call) ? call.getExpression() : null;
  if (!callee || !Node.isPropertyAccessExpression(callee) || callee.getName() !== 'call' || !Node.isIdentifier(callee.getExpression())) {
    return { why: `${name}: the stub does not end in \`return fn.call(host, …)\`` };
  }
  const fn = callee.getExpression().getText();
  const hosts = [];
  for (const st of stmts.slice(0, -1)) {
    if (!Node.isVariableStatement(st)) return { why: `${name}: a statement before the call is not a const` };
    for (const d of st.getDeclarations()) if (Node.isObjectLiteralExpression(d.getInitializer())) hosts.push(d.getInitializer());
  }
  if (hosts.length !== 1) return { why: `${name}: the stub builds ${hosts.length} host literals, not one` };
  return { m, module: hit[1], fn, literal: hosts[0] };
}

/** The `this` parameter's type name of an exported function in a hand module, or null. */
function handHostTypeOf(tm, file, text, fn) {
  const f = parse(tm, join(SRC_DIR, file), text).getFunction(fn);
  const p = f && f.isExported() ? f.getParameters()[0] : null;
  const t = p && p.getName() === 'this' ? p.getTypeNode() : null;
  return t && /^[A-Za-z_$][\w$]*$/.test(t.getText()) ? t.getText() : null;
}

/** An arrow's text one indentation level out (`indent`), or null when a later line is not that far in. */
function deindentBy(text, indent) {
  const lines = text.split('\n');
  const out = [lines[0]];
  for (const line of lines.slice(1)) {
    if (line === '') out.push(line);
    else if (line.startsWith(indent) && line.trim() !== '') out.push(line.slice(indent.length));
    else return null;
  }
  return out.join('\n');
}
const reindentBy = (text, indent) => text.split('\n').map((line, i) => (i === 0 || line === '' ? line : `${indent}${line}`)).join('\n');

/** engine.ts's one-line, sorted value import of a hand module, parsed: `{ start, end, names }`, or null. */
function handImportOf(text, file) {
  const specifier = `./${file.replace(/\.ts$/, '.js')}`;
  const re = new RegExp(`^import \\{ ([A-Za-z_$][\\w$]*(?:, [A-Za-z_$][\\w$]*)*) \\} from '${specifier.replace(/[.]/g, '\\.')}';$`, 'gm');
  const hits = [...text.matchAll(re)];
  if (hits.length !== 1) return null;
  const names = hits[0][1].split(', ');
  if (names.join() !== [...names].sort().join()) return null;
  return { start: hits[0].index, end: hits[0].index + hits[0][0].length, names, specifier };
}
const handImportText = (names, specifier) => `import { ${[...names].sort().join(', ')} } from '${specifier}';`;

/**
 * Decide the moves `names` asks for. Refuses (exit 2) on a name that is not a
 * hand stub, a stub with no computing slot, and every shape the section above
 * closes out. Pure.
 */
function planHandSlots(tm, text, moduleTexts, names) {
  const { Node, SyntaxKind } = tm;
  if (!names || names.length === 0) refuse('--hand-slots needs a comma-separated list of hand-series stub names');
  if (new Set(names).size !== names.length) refuse(`--hand-slots names a stub twice: ${names.join(', ')}`);
  const sf = parse(tm, HOST_PATH, text);
  const cls = sf.getClass(CLASS_NAME);
  if (!cls) refuse(`no class ${CLASS_NAME} in ${HOST_BASENAME}`);
  const scope = moduleScope(tm, sf);
  const checker = sf.getProject().getTypeChecker().compilerObject;
  const ts = tm.ts;
  const records = [];
  for (const name of names) {
    const stub = handSlotStubOf(tm, cls, text, name);
    if (stub.why) refuse(stub.why);
    const mod = moduleTexts.get(stub.module);
    if (mod == null) refuse(`${stub.module}: the hand module ${name}'s marker names is not on disk`);
    const hostType = handHostTypeOf(tm, stub.module, mod, stub.fn);
    if (!hostType) refuse(`${stub.module}: exports no function ${stub.fn} whose \`this\` names its host interface`);
    if (!handImportOf(text, stub.module)) refuse(`${HOST_BASENAME}: its import of ${stub.module} is not one sorted line of values`);
    const slots = [];
    for (const p of stub.literal.getProperties()) {
      if (!Node.isPropertyAssignment(p)) continue;
      const init = p.getInitializer();
      if (!Node.isArrowFunction(init) || !Node.isBlock(init.getBody())) continue;
      const slot = p.getName();
      if (!Node.isIdentifier(p.getNameNode())) refuse(`${name}: a computing slot has a computed or quoted name`);
      const why = (msg) => refuse(`${name}: its \`${slot}\` slot ${msg}`);
      const lineStart = lineStartOf(text, p.getStart());
      const indent = text.slice(lineStart, p.getStart());
      if (!/^ +$/.test(indent)) why('does not open its own line');
      if (init.getDescendants().some((n) => (Node.isTemplateExpression(n) || Node.isNoSubstitutionTemplateLiteral(n) || Node.isStringLiteral(n)) &&
        n.getStartLineNumber() !== n.getEndLineNumber())) why('holds a template or string spanning lines, which a re-indent would edit');
      const arrowText = text.slice(init.getStart(), init.getEnd());
      const moved = deindentBy(arrowText, indent);
      if (moved === null) why('has a line not indented as far as the slot, or a blank line holding spaces');
      if (scope.bindings.has(slot)) why(`is named ${slot}, which ${HOST_BASENAME} already binds`);
      if (moduleScope(tm, parse(tm, join(SRC_DIR, stub.module), mod)).bindings.has(slot)) why(`is named ${slot}, which ${stub.module} already binds at module scope`);
      const imports = new Map(); // local -> { specifier, form, imported, value }
      for (const node of init.getDescendants()) {
        if (node.getKind() === SyntaxKind.ThisKeyword) why('reads `this`');
        if (node.getKind() !== SyntaxKind.Identifier || isPropertyNameIdentifier(ts, node.compilerNode)) continue;
        const parent = node.getParent();
        const symbol = Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === node
          ? checker.getShorthandAssignmentValueSymbol(parent.compilerNode) : checker.getSymbolAtLocation(node.compilerNode);
        for (const decl of symbol?.declarations ?? []) {
          if (decl.getSourceFile() !== sf.compilerNode) continue;
          if (decl.pos >= init.compilerNode.pos && decl.end <= init.compilerNode.end) continue;
          if (ts.isImportSpecifier(decl) || ts.isImportClause(decl) || ts.isNamespaceImport(decl)) {
            const b = scope.bindings.get(node.getText());
            const value = !inTypePosition(tm, node, init);
            const prev = imports.get(node.getText());
            imports.set(node.getText(), { specifier: b.specifier, form: b.form, imported: b.imported, value: Boolean(prev && prev.value) || (value && !b.typeOnly) });
            continue;
          }
          why(`reads ${node.getText()}, which ${isModuleScopeDecl(ts, decl) ? `${HOST_BASENAME} declares` : 'the stub declares'}`);
        }
      }
      slots.push({ slot, prop: p, init, indent, moved, imports });
    }
    if (slots.length === 0) refuse(`${name}: its host literal holds no computing slot (a block-bodied arrow)`);
    records.push({ name, ...stub, hostType, slots });
  }
  return { records };
}

/** The import statements a hand module gains for a slot's reads: one per specifier it does not import yet. */
function handSlotImportLines(file, mod, imports, decls) {
  const bySpecifier = new Map();
  for (const [local, b] of imports) {
    const have = decls.find((d) => d.bindings.has(local));
    if (have) {
      const e = have.bindings.get(local);
      if (have.specifier !== b.specifier || e.form !== b.form || e.imported !== b.imported || (b.value && !e.value)) {
        refuse(`${file}: binds ${local} otherwise than ${HOST_BASENAME} does`);
      }
      continue;
    }
    if (decls.some((d) => d.specifier === b.specifier)) refuse(`${file}: already imports from ${b.specifier}, and this pass adds whole statements only`);
    if (!bySpecifier.has(b.specifier)) bySpecifier.set(b.specifier, new Map());
    bySpecifier.get(b.specifier).set(local, b);
  }
  const lines = [];
  for (const [specifier, bindings] of [...bySpecifier].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const out = specifierLines(specifier, bindings);
    if (!out) refuse(`${file}: ${specifier} would be imported in a form this pass does not write`);
    lines.push(...out);
  }
  return lines;
}

/** Apply a `planHandSlots` plan. Returns `{ host, modules, pruned }`. Pure. */
function generateHandSlots(tm, text, moduleTexts, planned) {
  const edits = [];
  const byModule = new Map();
  for (const r of planned.records) byModule.set(r.module, [...(byModule.get(r.module) ?? []), r]);
  const modules = new Map();
  for (const [file, rs] of [...byModule].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const mod = moduleTexts.get(file);
    const decls = importDeclsOf(tm, file, mod);
    if (decls.length === 0) refuse(`${file}: imports nothing, so there is no import block to add to`);
    const imports = new Map();
    for (const r of rs) for (const s of r.slots) for (const [k, v] of s.imports) imports.set(k, v);
    const lines = handSlotImportLines(file, mod, imports, decls);
    const at = decls.at(-1).end;
    let next = mod.slice(0, at) + lines.map((l) => `\n${l}`).join('') + mod.slice(at);
    if (!next.endsWith('\n')) refuse(`${file}: does not end in a line break`);
    for (const r of rs) {
      for (const s of r.slots) {
        next += `\n${handSlotDoc(s.slot, r.name, r.fn)}\nexport const ${s.slot}: ${r.hostType}['${s.slot}'] = ${s.moved};\n`;
      }
    }
    modules.set(file, next);
    const imp = handImportOf(text, file);
    edits.push({ start: imp.start, end: imp.end, text: handImportText([...imp.names, ...rs.flatMap((r) => r.slots.map((s) => s.slot))], imp.specifier) });
  }
  for (const r of planned.records) for (const s of r.slots) edits.push({ start: s.prop.getStart(), end: s.prop.getEnd(), text: s.slot });
  const out = applyOrderedEdits(text, edits);
  const pruned = pruneHostImports(tm, out, usedImportNames(tm, out));
  return { host: pruned.text, modules, pruned: pruned.removed };
}

/**
 * Undo every moved slot a tree carries, from its texts alone. Returns the
 * undone `engine.ts` and hand modules, the slots it undid (with the arrow
 * text, for the prune check), and every way the tree breaks the pass's form.
 */
function undoHandSlots(tm, text, moduleTexts) {
  const { Node } = tm;
  const failures = [];
  const moved = [];
  const sf = parse(tm, HOST_PATH, text);
  const cls = sf.getClass(CLASS_NAME);
  if (!cls) return { host: text, modules: moduleTexts, moved, failures: [`no class ${CLASS_NAME} in ${HOST_BASENAME}`] };
  const hostEdits = [];
  const perModule = new Map(); // file -> { removals: [{start,end}], slots: [] }
  for (const s of handStubs(tm, text)) {
    const stub = handSlotStubOf(tm, cls, text, s.name);
    if (stub.why) continue;
    const mod = moduleTexts.get(stub.module);
    if (mod == null) continue;
    const msf = parse(tm, join(SRC_DIR, stub.module), mod);
    for (const p of stub.literal.getProperties()) {
      if (!Node.isShorthandPropertyAssignment(p)) continue;
      const slot = p.getName();
      const doc = handSlotDoc(slot, s.name, stub.fn);
      const st = msf.getVariableStatement(slot);
      if (!st || !mod.includes(doc)) continue;
      const decl = st.getDeclarations()[0];
      const init = decl?.getInitializer();
      const lead = mod.slice(lineStartOf(mod, st.getStart(true)) - 1, st.getStart());
      if (!st.isExported() || st.getDeclarations().length !== 1 || !init || !Node.isArrowFunction(init) || lead !== `\n${doc}\n` || mod[st.getEnd()] !== '\n') {
        failures.push(`${slot}: ${stub.module} holds it, under this pass's docblock, not as this pass writes it`);
        continue;
      }
      const hostType = handHostTypeOf(tm, stub.module, mod, stub.fn);
      if (st.getText() !== `export const ${slot}: ${hostType}['${slot}'] = ${init.getText()};`) failures.push(`${slot}: its const is not typed as ${hostType ?? 'the host'}'s member`);
      const indent = text.slice(lineStartOf(text, p.getStart()), p.getStart());
      hostEdits.push({ start: p.getStart(), end: p.getEnd(), text: `${slot}: ${reindentBy(init.getText(), indent)}` });
      const entry = perModule.get(stub.module) ?? { removals: [], slots: [] };
      entry.removals.push({ start: lineStartOf(mod, st.getStart(true)) - 1, end: st.getEnd() + 1 });
      entry.slots.push(slot);
      perModule.set(stub.module, entry);
      moved.push({ name: s.name, slot, module: stub.module, text: init.getText() });
    }
  }
  const modules = new Map(moduleTexts);
  for (const [file, entry] of perModule) {
    const mod = moduleTexts.get(file);
    const usedAtHead = usedImportNames(tm, mod);
    const unread = importDeclsOf(tm, file, mod).flatMap((d) => [...d.bindings.keys()]).filter((k) => !usedAtHead.has(k));
    if (unread.length > 0) failures.push(`${file}: imports what nothing in it reads: ${unread.join(', ')}`);
    let undone = applyEdits(mod, entry.removals.map((r) => ({ ...r, text: '' })));
    const used = usedImportNames(tm, undone);
    const drops = [];
    for (const d of importDeclsOf(tm, file, undone)) {
      const unused = [...d.bindings.keys()].filter((k) => !used.has(k));
      if (unused.length === 0) continue;
      if (unused.length !== d.bindings.size) { failures.push(`${file}: an import statement binds names only moved slots read beside names the rest reads`); continue; }
      if (undone[d.start - 1] !== '\n') { failures.push(`${file}: an import only moved slots read does not open its own line`); continue; }
      drops.push({ start: d.start - 1, end: d.end, text: '' });
    }
    undone = applyEdits(undone, drops);
    modules.set(file, undone);
    const imp = handImportOf(text, file);
    if (!imp || entry.slots.some((n) => !imp.names.includes(n))) { failures.push(`${HOST_BASENAME}: does not import every moved slot of ${file} in its one import line of it`); continue; }
    hostEdits.push({ start: imp.start, end: imp.end, text: handImportText(imp.names.filter((n) => !entry.slots.includes(n)), imp.specifier) });
  }
  let host = text;
  try {
    host = applyOrderedEdits(text, hostEdits);
  } catch (e) {
    if (!(e instanceof CodemodRefusal)) throw e;
    failures.push(`${HOST_BASENAME}: the undo's edits overlap`);
  }
  return { host, modules, moved, failures };
}

/**
 * The proof: undoing every moved slot in the head lands on the base,
 * `engine.ts` (its import bindings only moved slots read pruned) and each
 * hand module byte for byte. A base this pass has already run on is undone
 * the same way first, so a later run proves only its own slots.
 */
function verifyHandSlots(tm, baseText, headText, baseModules, headModules) {
  const head = undoHandSlots(tm, headText, headModules);
  const base = undoHandSlots(tm, baseText, baseModules);
  const failures = [...head.failures, ...base.failures.map((f) => `base: ${f}`)];
  const { text: prunedBase, removed: pruned } = pruneHostImports(tm, base.host, usedImportNames(tm, headText));
  const movedText = head.moved.map((m) => m.text).join('\n');
  for (const n of pruned) if (!new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(movedText)) failures.push(`${n}: the head no longer imports it, and no moved slot reads it`);
  if (head.host !== prunedBase) failures.push(`undoing the moves does NOT rebuild the base ${HOST_BASENAME} (first difference at line ${firstDiffLine(head.host, prunedBase)})`);
  for (const file of [...new Set([...baseModules.keys(), ...headModules.keys()])].sort()) {
    const b = base.modules.get(file); const h = head.modules.get(file);
    if (b == null || h == null) { failures.push(`${file}: only in the ${b == null ? 'head' : 'base'}`); continue; }
    if (h !== b) failures.push(`undoing the moves does NOT rebuild the base ${file} (first difference at line ${firstDiffLine(h, b)})`);
  }
  const baseMoved = new Set(base.moved.map((m) => `${m.name}#${m.slot}`));
  const moved = head.moved.filter((m) => !baseMoved.has(`${m.name}#${m.slot}`));
  if (moved.length === 0) failures.push('nothing moved: the head carries no moved slot its base did not');
  return { failures, moved, pruned, linesBefore: lineCount(baseText), linesAfter: lineCount(headText) };
}

function planReportHandSlots(planned) {
  const out = [`# codemod-split-engine --hand-slots (${HAND_SLOTS_CARD}): the hand stubs' computing host slots`, ''];
  for (const r of planned.records) out.push(`- ${r.name} -> ${r.module}: ${r.slots.map((s) => `${s.slot} (${s.moved.split('\n').length} lines)`).join(', ')}`);
  return out.join('\n');
}

function printVerifyHandSlots(v) {
  for (const f of v.failures) console.error(`  ✗ ${f}`);
  console.log(`hand slots: ${v.moved.length} moved (${v.moved.map((m) => `${m.name}#${m.slot}`).join(', ') || 'none'}); ${HOST_BASENAME} ${v.linesBefore} -> ${v.linesAfter} lines; ` +
    `undoing the moves ${v.failures.length > 0 ? 'does NOT' : 'does'} rebuild the base ${HOST_BASENAME} and its hand modules byte-for-byte ` +
    `once the ${v.pruned.length} import binding(s) only moved slots read are pruned from the base (${v.pruned.join(', ') || 'none'})`);
}

/** `--hand-slots`: plan, write or re-prove the fifth pass. */
async function mainHandSlots(tm, argv) {
  if (argv.includes('--verify')) {
    const i = argv.indexOf('--base');
    const ref = i >= 0 ? argv[i + 1] : null;
    if (!ref) refuse('--hand-slots --verify needs --base <ref>');
    const baseText = gitShow(ref, `${SRC_REL}/${HOST_BASENAME}`);
    const baseModules = handModuleTexts(tm, baseText, (f) => { try { return gitShow(ref, `${SRC_REL}/${f}`); } catch { return null; } });
    const headModules = handModuleTexts(tm, baseText, readSibling);
    const v = verifyHandSlots(tm, baseText, readFileSync(HOST_PATH, 'utf8'), baseModules, headModules);
    printVerifyHandSlots(v);
    return v.failures.length === 0 ? 0 : 1;
  }
  const j = argv.indexOf('--hand-slots');
  const value = argv[j + 1];
  const names = value && !value.startsWith('--') ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const input = readFileSync(HOST_PATH, 'utf8');
  const moduleTexts = handModuleTexts(tm, input, readSibling);
  const planned = planHandSlots(tm, input, moduleTexts, names);
  console.log(planReportHandSlots(planned));
  const out = generateHandSlots(tm, input, moduleTexts, planned);
  const headModules = new Map([...moduleTexts, ...out.modules]);
  console.log(`output tree sha256: ${treeHash(new Map([[HOST_BASENAME, out.host], ...headModules]))} (input sha256 ${sha256(input)})`);
  const v = verifyHandSlots(tm, input, out.host, moduleTexts, headModules);
  printVerifyHandSlots(v);
  if (v.failures.length > 0) {
    console.error('✗ the generated moves fail the undo proof: nothing written. Report the fork; never hand-edit the moves.');
    return 1;
  }
  if (!argv.includes('--write')) {
    console.log('plan only: nothing written (pass --write to apply).');
    return 0;
  }
  writeFileSync(HOST_PATH, out.host);
  for (const [file, t] of out.modules) writeFileSync(join(SRC_DIR, file), t);
  console.log(`✓ wrote ${HOST_BASENAME} and ${out.modules.size} hand module(s) under ${SRC_REL}`);
  return 0;
}

// ── Entry ────────────────────────────────────────────────────────────────────

const USAGE = [
  'usage: node scripts/codemod-split-engine.mjs [--write]   plan (or apply) the split of an UNSPLIT engine.ts',
  '       node scripts/codemod-split-engine.mjs --verify --base REF   re-prove a split on disk against engine.ts at REF',
  '       node scripts/codemod-split-engine.mjs --scoped [--write]   plan (or apply) the second pass: ObjectRepository and ScopedContext',
  '       node scripts/codemod-split-engine.mjs --scoped --verify --base REF   re-prove the second pass on disk against engine.ts at REF',
  '       node scripts/codemod-split-engine.mjs --hand-docs [--modules A.ts,B.ts] [--write]   plan (or apply) the third pass: the hand series\' private docblocks',
  '       node scripts/codemod-split-engine.mjs --hand-docs --verify --base REF   re-prove the third pass on disk against engine.ts and its hand modules at REF',
  '       node scripts/codemod-split-engine.mjs --members A,B [--write]   plan (or apply) the fourth pass: move the named ObjectQL methods onto the split class',
  '       node scripts/codemod-split-engine.mjs --members --verify --base REF   re-prove the fourth pass on disk against engine.ts and its modules at REF',
  '       node scripts/codemod-split-engine.mjs --hand-slots A,B [--write]   plan (or apply) the fifth pass: move the named hand stubs\' computing host slots into their hand modules',
  '       node scripts/codemod-split-engine.mjs --hand-slots --verify --base REF   re-prove the fifth pass on disk against engine.ts and its hand modules at REF',
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
  if (argv.includes('--hand-docs')) return mainHandDocs(tm, argv);
  if (argv.includes('--members')) return mainMembers(tm, argv);
  if (argv.includes('--hand-slots')) return mainHandSlots(tm, argv);
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
  'hand-series docblocks (third pass)': 19,
  'named methods onto the split class (fourth pass)': 23,
  'identity port, computed keys and exported names (fourth pass, #30020)': 18,
  'hand-series host slots (fifth pass, #30020)': 17,
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

/**
 * The fourth pass's fixture: the first pass's, with two methods a pin held
 * when it split the file (`FOURTH_FIXTURE_PINS`), one private that reads a
 * new host member, a new private static and an import only it reads, one
 * protected that names a type only it imports.
 */
const FOURTH_FIXTURE_PINS = Object.freeze({ ...FIXTURE_PINS, pinnedHost: 'a fixture reader', pinnedTyped: 'a fixture reader' });
function fourthFixtureSource() {
  const pad = Array.from({ length: 12 }, (_, i) => `    const p${i} = ${i};`).join('\n');
  const extra = `
  /** A pinned private docblock: the fourth pass moves it with the body. */
  private async pinnedHost(object: string): Promise<string> {
${pad}
    return this.other(object) + String(this.count) + String(this.knex) + helperImported(object) + String(ObjectQL.SECRET) + String(ObjectQL.bump) + fourthOnly();
  }

  /** A pinned protected docblock: it stays on the class. */
  protected pinnedTyped(x: FourthShape): number {
${pad}
    return x.n;
  }
`;
  return fixtureSource(extra).replace("import { seamHelper } from './engine-seam.js';\n",
    "import { seamHelper } from './engine-seam.js';\nimport { fourthOnly } from './fourth-only.js';\nimport type { FourthShape } from './fourth-shape.js';\n");
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

function handFixtureEngine() {
  return `import { privateDoc, publicDoc, noDoc, richer } from './engine-alpha.js';
import { betaPrivate } from './engine-beta.js';
// Type-only, for the link on betaPrivate's docblock.
import type { LinkedOnly } from './engine-beta.js';

export class ObjectQL {
  private n = 1;

  /**
   * A private docblock: it moves.
   *
   * Second paragraph.
   */
  private privateDoc(n: number): number {
    // [#25522 cut 1] The body moved to \`engine-alpha.ts\` (see \`AlphaHost\`).
    return privateDoc.call({ n: this.n }, n);
  }

  /** A public docblock: it stays. */
  publicDoc(): number {
    // [#25522 cut 1] The body moved to \`engine-alpha.ts\` (see \`AlphaHost\`). PUBLIC
    return publicDoc.call({ n: this.n });
  }

  private noDoc(): number {
    // [#25522 cut 1] The body moved to \`engine-alpha.ts\`; it reads no member.
    return noDoc();
  }

  /** Its function says more than the placeholder. */
  private richer(): number {
    // [#25522 cut 1] The body moved to \`engine-alpha.ts\`; it reads no member.
    return richer();
  }

  /** A beta docblock, {@link LinkedOnly}. */
  private betaPrivate(): number {
    // The body lives in \`engine-beta.ts\`; it reads no member.
    return betaPrivate();
  }

  /** Not a stub: no hand marker. */
  private notAStub(): number {
    return this.n;
  }
}
`;
}

function handFixtureModules() {
  const head = (what) => `// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 1] ${what}.
 */

import type { ObjectQL } from './engine.js';
`;
  return new Map([
    ['engine-alpha.ts', `${head('The alpha bodies')}
export interface AlphaHost { readonly n: ObjectQL['n'] }

${placeholderDoc('privateDoc')}
export function privateDoc(this: AlphaHost, n: number): number {
  return this.n + n;
}

${placeholderDoc('publicDoc')}
export function publicDoc(this: AlphaHost): number {
  return this.n;
}

${placeholderDoc('noDoc')}
export function noDoc(): number {
  return 0;
}

/**
 * ${placeholderDoc('richer').slice(4, -3)}
 *
 * And a note of its own.
 */
export function richer(): number {
  return 1;
}
`],
    ['engine-beta.ts', `${head('The beta body')}
${placeholderDoc('betaPrivate')}
export function betaPrivate(): number {
  return 2;
}
`],
  ]);
}

/**
 * The identity-port fixture (#30020): the first pass's, with an `Identity`
 * section the first pass writes (`seed` moves) and keeps the rest of on the
 * class (each `bare-this` there), and one exported class after `ObjectQL`.
 */
const IDENTITY_FIXTURE_ANCHORS = Object.freeze([
  ['count', 'Lifecycle', 'engine-lifecycle.ts'],
  ['seed', 'Identity', 'engine-identity.ts'],
  ['keptSection', 'Kept', null],
]);
function identityFixtureSource({ facadeField = false } = {}) {
  const pad = Array.from({ length: 12 }, (_, i) => `    const p${i} = ${i};`).join('\n');
  const extra = `
  protected seed(): number {
${pad}
    return this.count;
  }

  /** Hands the engine on (R1); its object-literal method keeps its own \`this\`. */
  private identity(n: number): Scoped {
${pad}
    const nested = { k: 1, get(): number { return this.k; } };
    const self = (this as any)._flag ? this : null;
    return new Scoped(n + this.count + nested.get(), self ?? this);
  }

  private computed(slot: 'knex' | 'logger'): unknown {
${pad}
    const v = this[slot];
    this[slot] = v as never;
    return v;
  }

  protected keyedString(key: string): unknown {
${pad}
    return this[key];
  }

  protected keyedMethod(slot: 'other'): unknown {
${pad}
    return this[slot];
  }

  protected handsToLocal(): number {
${pad}
    return namesClass(this) === null ? 0 : 1;
  }

  protected typedThis(): number {
${pad}
    const t: typeof this = this;
    return t === null ? 0 : 1;
  }

  protected readsFacade(): unknown {
${pad}
    return this.facade;
  }
`;
  const source = `${fixtureSource(extra)}
export class Scoped {
  constructor(readonly n: number, readonly q: ObjectQL) {}
}
`;
  return facadeField ? source.replace('  private count = 0;\n', '  private count = 0;\n  private facade = 0;\n') : source;
}

/**
 * The fifth pass's fixture (#30020 H2): hand stubs whose host literals hold
 * a computing slot (`gammaServe`), one that reads the stub's own `this` or a
 * local, a slot of forwarders only, and one spanning a template.
 */
function slotFixtureEngine() {
  return `import { gammaLocal, gammaOnly, gammaServe, gammaThis, gammaTpl } from './engine-gamma.js';
import { planOf } from './engine-top-level.js';
import type { Plan } from './plan-types.js';

export class ObjectQL {
  private n = 1;

  private gammaServe(x: string): number {
    // The body lives in \`engine-gamma.ts\` (see \`GammaHost\`).
    const readN = () => this.n;
    const host: ThisParameterType<typeof gammaServe> = {
      get n() { return readN(); },
      judge: (name, plan) => {
        try {
          const p: Plan = planOf(name, plan);
          return p.ok;
        } catch {
          // A plan that does not compile is judged no.
          return false;
        }
      },
      other: (...a) => this.n + a.length,
    };
    return gammaServe.call(host, x);
  }

  private gammaThis(x: string): number {
    // The body lives in \`engine-gamma.ts\` (see \`GammaHost\`).
    const host: ThisParameterType<typeof gammaThis> = {
      judge: (name) => {
        return this.n > name.length;
      },
    };
    return gammaThis.call(host, x);
  }

  private gammaLocal(x: string): number {
    // The body lives in \`engine-gamma.ts\` (see \`GammaHost\`).
    const readN = () => this.n;
    const host: ThisParameterType<typeof gammaLocal> = {
      judge: (name) => {
        return readN() > name.length;
      },
    };
    return gammaLocal.call(host, x);
  }

  private gammaOnly(x: string): number {
    // The body lives in \`engine-gamma.ts\` (see \`GammaHost\`).
    const host: ThisParameterType<typeof gammaOnly> = {
      judge: (...a) => planOf(...a).ok,
    };
    return gammaOnly.call(host, x);
  }

  private gammaTpl(x: string): number {
    // The body lives in \`engine-gamma.ts\` (see \`GammaHost\`).
    const host: ThisParameterType<typeof gammaTpl> = {
      judge: (name) => {
        return \`a
b\` === name;
      },
    };
    return gammaTpl.call(host, x);
  }
}
`;
}

function slotFixtureModules() {
  return new Map([['engine-gamma.ts', `// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The gamma bodies.
 */

import type { ObjectQL } from './engine.js';

export interface GammaHost {
  readonly n: ObjectQL['n'];
  judge: (name: string, plan?: unknown) => boolean;
  other: (...a: unknown[]) => number;
}

export function gammaServe(this: GammaHost, x: string): number {
  return this.judge(x) ? this.n : this.other(x);
}

export function gammaThis(this: GammaHost, x: string): number {
  return this.judge(x) ? 1 : 0;
}

export function gammaLocal(this: GammaHost, x: string): number {
  return this.judge(x) ? 1 : 0;
}

export function gammaOnly(this: GammaHost, x: string): number {
  return this.judge(x) ? 1 : 0;
}

export function gammaTpl(this: GammaHost, x: string): number {
  return this.judge(x) ? 1 : 0;
}
`]]);
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
  const refusalOf = (fn) => { try { fn(); return ''; } catch (e) { if (e instanceof CodemodRefusal) return e.message; throw e; } };

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

  open('hand-series docblocks (third pass)');
  {
    const input = handFixtureEngine();
    const mods = handFixtureModules();
    const planned = planHandDocs(tm, input, mods);
    const why = (name) => planned.records.find((r) => r.name === name)?.reason ?? '<absent>';
    check('a private stub with one docblock moves; public, undocumented and richer-function stubs stay',
      why('privateDoc') === '' && why('betaPrivate') === '' && why('publicDoc').startsWith('public') &&
      why('noDoc') === 'no-docblock' && why('richer').startsWith('function-docblock') && why('notAStub') === '<absent>',
      planned.records.map((r) => `${r.name}=${r.reason}`).join(' | '));
    const out = generateHandDocs(tm, input, mods, planned);
    const again = generateHandDocs(tm, input, mods, planHandDocs(tm, input, mods));
    const alpha = out.modules.get('engine-alpha.ts') ?? '';
    check('the moved docblock replaces the placeholder, one level out, and the class keeps none',
      alpha.includes('/**\n * A private docblock: it moves.\n *\n * Second paragraph.\n */\nexport function privateDoc(') &&
      !out.host.includes('A private docblock') && out.host.includes('  private privateDoc(n: number): number {\n'));
    check('the stub\'s marker gains the phrase after its module',
      out.host.includes(`// [#25522 cut 1] The body moved to \`engine-alpha.ts\`${HAND_DOC_MOVED} (see \`AlphaHost\`).`));
    check('a public docblock stays on the class and its function keeps the placeholder',
      out.host.includes('  /** A public docblock: it stays. */\n  publicDoc(') && alpha.includes(`${placeholderDoc('publicDoc')}\nexport function publicDoc(`));
    check('the module header gains the note once, above its closing line',
      alpha.split(HAND_DOCS_NOTE).length === 2 && alpha.includes(`${HAND_DOCS_NOTE}\n */\n`));
    const v = verifyHandDocs(tm, input, out.host, mods, new Map([...mods, ...out.modules]));
    check('the generated moves prove against their base', v.failures.length === 0 && v.moved.length === 2, v.failures.join(' | '));
    check('two runs on one input write byte-identical trees',
      treeHash(new Map([['h', out.host], ...out.modules])) === treeHash(new Map([['h', again.host], ...again.modules])));
    const slice = generateHandDocs(tm, input, mods, planHandDocs(tm, input, mods, { modules: ['engine-alpha.ts'] }));
    const sliceMods = new Map([...mods, ...slice.modules]);
    const rest = generateHandDocs(tm, slice.host, sliceMods, planHandDocs(tm, slice.host, sliceMods));
    check('a slice moves only its modules, and the next slice on its output lands where one run lands',
      !slice.modules.has('engine-beta.ts') && slice.host.includes('A beta docblock') &&
      rest.host === out.host && (rest.modules.get('engine-beta.ts') ?? '') === out.modules.get('engine-beta.ts') &&
      planHandDocs(tm, slice.host, sliceMods).records.find((r) => r.name === 'privateDoc')?.reason === 'already-moved');
    {
      const restMods = new Map([...sliceMods, ...rest.modules]);
      const onSlice = verifyHandDocs(tm, slice.host, rest.host, sliceMods, restMods);
      const onBase = verifyHandDocs(tm, input, rest.host, mods, restMods);
      check('the next slice proves against the earlier slice\'s output, counting only its own moves, and against the unsliced base',
        onSlice.failures.length === 0 && onSlice.moved.length === 1 && onSlice.baseMoved === 1 && onBase.failures.length === 0 && onBase.moved.length === 2,
        [...onSlice.failures, ...onBase.failures].join(' | '));
    }
    const fails = (host, edited) => verifyHandDocs(tm, input, host, mods, new Map([...mods, ...out.modules, ...edited])).failures.length > 0;
    check('one edited character in a moved docblock fails', fails(out.host, [['engine-alpha.ts', alpha.replace('Second paragraph.', 'Second paragraph!')]]));
    check('one edited character elsewhere in a hand module fails', fails(out.host, [['engine-alpha.ts', alpha.replace('return this.n + n;', 'return this.n - n;')]]));
    check('a moved docblock dropped from its function fails', fails(out.host, [['engine-alpha.ts', alpha.replace(/\/\*\*\n \* A private docblock[\s\S]*?\*\/\n/, '')]]));
    check('a staying docblock dropped from the class fails', fails(out.host.replace('  /** A public docblock: it stays. */\n', ''), []));
    check('a public docblock moved off the class fails', fails(
      out.host.replace('  /** A public docblock: it stays. */\n', '').replace('`engine-alpha.ts` (see `AlphaHost`). PUBLIC', `\`engine-alpha.ts\`${HAND_DOC_MOVED} (see \`AlphaHost\`). PUBLIC`),
      [['engine-alpha.ts', alpha.replace(`${placeholderDoc('publicDoc')}\n`, '/** A public docblock: it stays. */\n')]]));
    check('a marker that says moved over a docblock still on the class fails', fails(
      out.host.replace('`engine-alpha.ts` (see `AlphaHost`). PUBLIC', `\`engine-alpha.ts\`${HAND_DOC_MOVED} (see \`AlphaHost\`). PUBLIC`), []));
    check('a module missing its header note fails', fails(out.host, [['engine-alpha.ts', alpha.replace(`\n${HAND_DOCS_NOTE}`, '')]]));
    check('an import only a moved docblock links is pruned with the // lines above it (not before its docblock moves), and the proof names it',
      out.pruned.join() === 'LinkedOnly' && v.pruned.join() === 'LinkedOnly' && !out.host.includes('LinkedOnly }') &&
      !out.host.includes('for the link on') && slice.host.includes('for the link on'), `${out.pruned} | ${v.pruned}`);
    check('a binding the head dropped that no moved docblock links fails',
      fails(out.host.replace("import { betaPrivate } from './engine-beta.js';\n", ''), []));
    check('--modules naming a module no stub delegates to refuses',
      refused(() => planHandDocs(tm, input, mods, { modules: ['engine-gone.ts'] })));
  }

  open('named methods onto the split class (fourth pass)');
  {
    const opts = { anchors: FIXTURE_ANCHORS, pins: FIXTURE_PINS, needles: FIXTURE_NEEDLES, classNeedles: FIXTURE_CLASS_NEEDLES };
    const source = fourthFixtureSource();
    const split = generate(tm, source, plan(tm, source, { ...opts, pins: FOURTH_FIXTURE_PINS }));
    const input = split.host;
    const mods = split.modules;
    const names = ['pinnedTyped', 'pinnedHost'];
    check('the first pass keeps the pinned methods on the class (path-reader)',
      input.includes('  private async pinnedHost(object: string): Promise<string> {\n    const p0') && input.includes('  protected pinnedTyped(x: FourthShape): number {\n    const p0'));
    const planned = planMembers(tm, input, mods, names, opts);
    check('the plan takes both into their section\'s written module, in class order',
      [...planned.modules.keys()].join() === 'engine-lifecycle.ts' && planned.records.map((r) => r.name).join() === 'pinnedHost,pinnedTyped',
      planned.records.map((r) => `${r.name}->${r.module}`).join());
    const out = generateMembers(tm, input, mods, planned);
    const again = generateMembers(tm, input, mods, planMembers(tm, input, mods, names, opts));
    const head = new Map([...mods, ...out.modules]);
    const v = verifyMembers(tm, input, out.host, mods, head, opts);
    check('the generated moves prove against their base', v.failures.length === 0 && v.moved.length === 2, v.failures.join(' | '));
    check('two runs on one input write byte-identical trees',
      treeHash(new Map([['h', out.host], ...out.modules])) === treeHash(new Map([['h', again.host], ...again.modules])));
    const lifecycle = out.modules.get('engine-lifecycle.ts') ?? '';
    check('each stub is the first pass\'s stub, `async` dropped',
      out.host.includes(`  private pinnedHost(object: string): Promise<string> {\n    // ${MARK} The body moved to \`engine-lifecycle.ts\`, ${DOC_MOVED} (see \`LifecycleHost\`).\n    return LifecycleFacet.pinnedHost.call(lifecycleHost.of(this), object);\n  }`) &&
      out.host.includes(`  protected pinnedTyped(x: FourthShape): number {\n    // ${MARK} The body moved to \`engine-lifecycle.ts\`.\n    return LifecycleFacet.pinnedTyped(x);\n  }`),
      out.host.slice(out.host.indexOf('pinnedHost(') - 80, out.host.indexOf('pinnedHost(') + 300));
    check('a private docblock moves with its body; a protected one stays on the class',
      lifecycle.includes('  /** A pinned private docblock: the fourth pass moves it with the body. */\n  static async pinnedHost(') && !out.host.includes('A pinned private docblock') &&
      out.host.includes('  /** A pinned protected docblock: it stays on the class. */\n  protected pinnedTyped(') && lifecycle.includes(`  ${placeholderDoc('pinnedTyped')}\n  static pinnedTyped(`));
    const listed = headerNamesOf(lifecycle, 'Lifecycle')?.names ?? [];
    check('the header lists both, in class order after the members declared above them',
      listed.indexOf('pinnedHost') > listed.indexOf('generic') && listed.indexOf('pinnedTyped') === listed.indexOf('pinnedHost') + 1, listed.join());
    check('a host member only a moved body reads joins the interface and the factory',
      lifecycle.includes("  readonly knex: ObjectQLClass['knex'];") && out.host.includes('      get knex() { return engine.knex; },') && !input.includes('get knex()'));
    check('a private static only a moved body reads joins the statics route',
      out.host.includes("  readonly bump: (typeof ObjectQL)['bump'];") && out.host.includes('      bump: { get: () => ObjectQL.bump },') && !input.includes("['bump']"));
    check('the module imports what the moved members read, ahead of the leaf; engine.ts drops what only the bodies read and keeps the type a stub still names, and the proof names the drops',
      /import \{ fourthOnly \} from '\.\/fourth-only\.js';\nimport type \{ FourthShape \} from '\.\/fourth-shape\.js';\n(import[^\n]*\n)*import[^\n]*'\.\/engine-top-level\.js'/.test(lifecycle) &&
      out.pruned.join() === 'fourthOnly,helperImported' && v.pruned.join() === 'fourthOnly,helperImported' &&
      out.host.includes("import type { FourthShape } from './fourth-shape.js';"), `${out.pruned} | ${v.pruned}`);
    check('a name the class does not declare refuses', refused(() => planMembers(tm, input, mods, ['gone'], opts)));
    check('a method already moved refuses', refused(() => planMembers(tm, input, mods, ['movable'], opts)));
    check('a method a stay rule holds refuses (inferred-return-type, and a pin that still stands)',
      refused(() => planMembers(tm, input, mods, ['inferred'], opts)) && refused(() => planMembers(tm, input, mods, ['pinnedMethod'], opts)));
    const fails = (host, edited) => verifyMembers(tm, input, host, mods, new Map([...head, ...edited]), opts).failures.length > 0;
    check('one edited character in a moved body fails', fails(out.host, [['engine-lifecycle.ts', lifecycle.replace('return x.n;', 'return x.n + 1;')]]));
    check('a host member no body reads, in the interface and the factory, fails', fails(
      out.host.replace('      get knex() { return engine.knex; },', '      get knex() { return engine.knex; },\n      get zed() { return engine.zed; },'),
      [['engine-lifecycle.ts', lifecycle.replace("  readonly knex: ObjectQLClass['knex'];", "  readonly knex: ObjectQLClass['knex'];\n  readonly zed: ObjectQLClass['zed'];")]]));
    check('an import nothing in the module reads fails', fails(out.host, [['engine-lifecycle.ts', lifecycle.replace("import { fourthOnly } from './fourth-only.js';", "import { fourthOnly, unread } from './fourth-only.js';")]]));
    check('a stub that kept `async` fails', fails(out.host.replace('  private pinnedHost(object: string)', '  private async pinnedHost(object: string)'), []));
    check('an edit elsewhere in engine.ts, or in a module no moved member is in, fails',
      fails(out.host.replace('    return 2 + VIA_SEAM', '    return 3 + VIA_SEAM'), []) &&
      fails(out.host, [[LEAF_MODULE, (mods.get(LEAF_MODULE) ?? '').replace('const LOCAL_VALUE = 1;', 'const LOCAL_VALUE = 2;')]]));
    check('a head that moved nothing fails', verifyMembers(tm, input, input, mods, mods, opts).failures.some((f) => f.startsWith('nothing moved')));

    // #30572's two shapes: a header a hand edit wrote on after, and a docblock link the base left unresolved.
    const baseLife = mods.get('engine-lifecycle.ts') ?? '';
    const baseHeader = headerNamesOf(baseLife, 'Lifecycle');
    const withHeader = (lines) => baseLife.slice(0, baseHeader.region.start) + lines.join('\n') + baseLife.slice(baseHeader.region.end);
    const tail = '`handWritten` was written here, beside the gate whose verdict it answers.'.split(' ');
    const handMods = new Map([...mods, ['engine-lifecycle.ts', withHeader(moduleHeaderLines('Lifecycle', baseHeader.names, tail))]]);
    const hand = generateMembers(tm, input, handMods, planMembers(tm, input, handMods, names, opts));
    const handHead = new Map([...handMods, ...hand.modules]);
    const handLife = hand.modules.get('engine-lifecycle.ts') ?? '';
    const handRead = headerNamesOf(handLife, 'Lifecycle');
    const hv = verifyMembers(tm, input, hand.host, handMods, handHead, opts);
    check('a header a hand edit wrote on after is accepted: the list grows, the hand\'s words follow it unedited, and the moves prove',
      hv.failures.length === 0 && hv.moved.length === 2 && handRead?.tail.join(' ') === tail.join(' ') &&
      handRead.names.join() === (headerNamesOf(lifecycle, 'Lifecycle')?.names ?? []).join(), hv.failures.join(' | '));
    check('a hand tail that does not rewrap as the pass wraps it refuses', refused(() => generateMembers(tm, input,
      new Map([...mods, ['engine-lifecycle.ts', withHeader([...moduleHeaderLines('Lifecycle', baseHeader.names), ' * `handWritten`', ' * was', ' * written', ' * here.'])]]),
      planMembers(tm, input, mods, names, opts))));
    check('one edited character in the hand\'s words at head fails',
      verifyMembers(tm, input, hand.host, handMods, new Map([...handHead, ['engine-lifecycle.ts', handLife.replace('verdict it answers.', 'verdict it answers!')]]), opts).failures.length > 0);
    const linkDoc = (extra) => baseLife.replace(placeholderDoc('writes'), `/** The body of \`ObjectQL#writes\`; see {@link FourthShape}${extra}. */`);
    const linkMods = new Map([...mods, ['engine-lifecycle.ts', linkDoc('')]]);
    const link = generateMembers(tm, input, linkMods, planMembers(tm, input, linkMods, names, opts));
    const linkHead = new Map([...linkMods, ...link.modules]);
    const linkLife = link.modules.get('engine-lifecycle.ts') ?? '';
    const lv = verifyMembers(tm, input, link.host, linkMods, linkHead, opts);
    check('a base docblock link a moved body\'s import comes to resolve: the undo drops the binding the move added, and the moves prove byte for byte',
      linkLife.includes("import type { FourthShape } from './fourth-shape.js';") && !linkDoc('').includes("from './fourth-shape.js'") &&
      lv.failures.length === 0 && lv.moved.length === 2, lv.failures.join(' | '));
    {
      const extraMods = new Map([...mods, ['engine-lifecycle.ts', linkDoc(' and {@link ExtraLinked}')]]);
      const extra = generateMembers(tm, input, extraMods, planMembers(tm, input, extraMods, names, opts));
      const extraLife = (extra.modules.get('engine-lifecycle.ts') ?? '').replace("import type { FourthShape } from './fourth-shape.js';", "import type { ExtraLinked, FourthShape } from './fourth-shape.js';");
      const ev = verifyMembers(tm, input, extra.host, extraMods, new Map([...extraMods, ...extra.modules, ['engine-lifecycle.ts', extraLife]]), opts);
      check('a binding the head added that only a staying docblock links, and no moved member reads, fails',
        extraLife.includes('ExtraLinked, FourthShape') && ev.failures.some((f) => f.includes('ExtraLinked') && f.includes('no moved member reads')), ev.failures.join(' | '));
    }
  }

  open('identity port, computed keys and exported names (fourth pass, #30020)');
  {
    const opts = { anchors: IDENTITY_FIXTURE_ANCHORS, pins: FIXTURE_PINS, needles: FIXTURE_NEEDLES, classNeedles: FIXTURE_CLASS_NEEDLES };
    const source = identityFixtureSource();
    const split = generate(tm, source, plan(tm, source, opts));
    const input = split.host;
    const mods = split.modules;
    const names = ['computed', 'identity'];
    check('the first pass keeps the methods that read `this` bare on the class (bare-this)',
      input.includes('  private identity(n: number): Scoped {\n    const p0') && input.includes("  private computed(slot: 'knex' | 'logger'): unknown {\n    const p0") &&
      (mods.get('engine-identity.ts') ?? '').includes('static seed('));
    const planned = planMembers(tm, input, mods, names, opts);
    check('the plan takes both into their section\'s written module, in class order',
      [...planned.modules.keys()].join() === 'engine-identity.ts' && planned.records.map((r) => r.name).join() === 'identity,computed',
      planned.records.map((r) => `${r.name}->${r.module}`).join());
    const out = generateMembers(tm, input, mods, planned);
    const again = generateMembers(tm, input, mods, planMembers(tm, input, mods, names, opts));
    const head = new Map([...mods, ...out.modules]);
    const v = verifyMembers(tm, input, out.host, mods, head, opts);
    check('the generated moves prove against their base', v.failures.length === 0 && v.moved.length === 2, v.failures.join(' | '));
    check('two runs on one input write byte-identical trees',
      treeHash(new Map([['h', out.host], ...out.modules])) === treeHash(new Map([['h', again.host], ...again.modules])));
    const idm = out.modules.get('engine-identity.ts') ?? '';
    const baseIdm = mods.get('engine-identity.ts') ?? '';
    check('R1: each bare `this` reads `this.facade`, and an object-literal method keeps its own `this`',
      idm.includes('    const self = (this.facade as any)._flag ? this.facade : null;\n    return new Scoped(n + this.count + nested.get(), self ?? this.facade);') &&
      idm.includes('    const nested = { k: 1, get(): number { return this.k; } };'), idm.slice(idm.indexOf('static identity'), idm.indexOf('static identity') + 900));
    check('R1: the body\'s `this` names the identity port beside the members it reads',
      idm.includes("static identity(this: Pick<IdentityHost, 'count' | 'facade'>, n: number): Scoped {"));
    check('R1: the host interface gains the identity port under its docblock, and the factory hands the engine',
      idm.includes(`${FACADE_DOC}\n  readonly facade: ObjectQL;`) && out.host.includes(`\n${FACADE_INSTALL_LINE}\n`) &&
      !baseIdm.includes(FACADE_DOC) && !input.includes(FACADE_INSTALL_LINE));
    check('R3: a computed key over field names reads them through the host, the body\'s text unchanged',
      idm.includes("static computed(this: Pick<IdentityHost, 'knex' | 'logger'>, slot: 'knex' | 'logger'): unknown {\n" +
        `${Array.from({ length: 12 }, (_, i) => `    const p${i} = ${i};`).join('\n')}\n    const v = this[slot];\n    this[slot] = v as never;`));
    check('R3: a key the body assigns through gains a setter, in the interface and the factory',
      idm.includes("  knex: ObjectQL['knex'];") && idm.includes("  logger: ObjectQL['logger'];") &&
      out.host.includes('      get knex() { return engine.knex; },\n      set knex(v) { engine.knex = v; },'));
    check('R4: an exported class engine.ts declares is imported from it as a value, and the header says so',
      idm.includes("import { Scoped } from './engine.js';\nimport type { ObjectQL } from './engine.js';") &&
      idm.includes(VALUES_CYCLE_PARA) && !idm.includes(TYPES_CYCLE_PARA) && baseIdm.includes(TYPES_CYCLE_PARA));
    check('a computed key of any string, or over a method name, stays (bare-this)',
      refused(() => planMembers(tm, input, mods, ['keyedString'], opts)) && refused(() => planMembers(tm, input, mods, ['keyedMethod'], opts)));
    check('a `this` in a type position stays', refused(() => planMembers(tm, input, mods, ['typedThis'], opts)));
    check('R4 imports only what engine.ts exports: a staying name it does not export refuses',
      /widen the generated export lists/.test(refusalOf(() => planMembers(tm, input, mods, ['handsToLocal'], opts))), refusalOf(() => planMembers(tm, input, mods, ['handsToLocal'], opts)));
    check('a body that already reads `this.facade` refuses, so the undo stays the one inverse (unknown-member)',
      /unknown-member: facade/.test(refusalOf(() => planMembers(tm, input, mods, ['readsFacade'], opts))));
    {
      const taken = identityFixtureSource({ facadeField: true });
      const tsplit = generate(tm, taken, plan(tm, taken, opts));
      check('a class that declares `facade` refuses the identity port (facade-taken)',
        /facade-taken/.test(refusalOf(() => planMembers(tm, tsplit.host, tsplit.modules, ['identity'], opts))));
    }
    // A negative control whose edit changed nothing would pass for the wrong reason: it fails the case instead.
    const fails = (host, edited) => !(host === out.host && edited.every(([f, t]) => t === head.get(f))) &&
      verifyMembers(tm, input, host, mods, new Map([...head, ...edited]), opts).failures.length > 0;
    check('a `this.facade` the rewrite did not write fails', fails(out.host, [['engine-identity.ts', idm.replace('n + this.count', 'n + this.facade.count')]]));
    check('a rewritten site put back to a bare `this` fails', fails(out.host, [['engine-identity.ts', idm.replace('self ?? this.facade', 'self ?? this')]]));
    check('a factory that does not hand the engine fails', fails(out.host.replace(`\n${FACADE_INSTALL_LINE}`, ''), []));
    check('an identity port without its docblock fails', fails(out.host, [['engine-identity.ts', idm.replace(`${FACADE_DOC}\n`, '')]]));
    check('a header left saying "types only" beside a value import fails',
      fails(out.host, [['engine-identity.ts', idm.replace(VALUES_CYCLE_PARA, TYPES_CYCLE_PARA)]]));
  }

  open('hand-series host slots (fifth pass, #30020)');
  {
    const input = slotFixtureEngine();
    const mods = slotFixtureModules();
    const planned = planHandSlots(tm, input, mods, ['gammaServe']);
    check('the plan names the one computing slot of the stub',
      planned.records.length === 1 && planned.records[0].slots.map((s) => s.slot).join() === 'judge' && planned.records[0].hostType === 'GammaHost',
      JSON.stringify(planned.records.map((r) => [r.name, r.slots.map((s) => s.slot)])));
    const out = generateHandSlots(tm, input, mods, planned);
    const again = generateHandSlots(tm, input, mods, planHandSlots(tm, input, mods, ['gammaServe']));
    const head = new Map([...mods, ...out.modules]);
    const v = verifyHandSlots(tm, input, out.host, mods, head);
    check('the generated move proves against its base', v.failures.length === 0 && v.moved.length === 1, v.failures.join(' | '));
    check('two runs on one input write byte-identical trees',
      treeHash(new Map([['h', out.host], ...out.modules])) === treeHash(new Map([['h', again.host], ...again.modules])));
    const gamma = out.modules.get('engine-gamma.ts') ?? '';
    check('the slot names its const, and engine.ts imports it beside the function',
      out.host.includes('      judge,\n      other: (...a) => this.n + a.length,') &&
      out.host.includes("import { gammaLocal, gammaOnly, gammaServe, gammaThis, gammaTpl, judge } from './engine-gamma.js';"));
    check('the hand module holds the arrow one level out, typed as the host member, under the docblock',
      gamma.endsWith(`\n${handSlotDoc('judge', 'gammaServe', 'gammaServe')}\nexport const judge: GammaHost['judge'] = (name, plan) => {\n  try {\n    const p: Plan = planOf(name, plan);\n    return p.ok;\n  } catch {\n    // A plan that does not compile is judged no.\n    return false;\n  }\n};\n`), gamma.slice(-500));
    check('the hand module imports what the arrow reads, by statements of its own after its last import',
      gamma.includes("import type { ObjectQL } from './engine.js';\nimport { planOf } from './engine-top-level.js';\nimport type { Plan } from './plan-types.js';\n"));
    check('engine.ts drops the import only the slot read and keeps one another stub still reads, and the proof names the drop',
      out.pruned.join() === 'Plan' && v.pruned.join() === 'Plan' && !out.host.includes("from './plan-types.js'") &&
      out.host.includes("import { planOf } from './engine-top-level.js';"), `${out.pruned} | ${v.pruned}`);
    const fails = (host, edited) => !(host === out.host && edited.every(([f, t]) => t === head.get(f))) &&
      verifyHandSlots(tm, input, host, mods, new Map([...head, ...edited])).failures.length > 0;
    check('one edited character in the moved arrow fails', fails(out.host, [['engine-gamma.ts', gamma.replace('return false;', 'return true;')]]));
    check('a moved const whose docblock was edited fails', fails(out.host, [['engine-gamma.ts', gamma.replace('moved here whole', 'moved here wholly')]]));
    check('an import statement that also binds a name nothing reads fails',
      fails(out.host, [['engine-gamma.ts', gamma.replace("import { planOf } from './engine-top-level.js';", "import { planOf, unread } from './engine-top-level.js';")]]));
    check('an engine.ts that kept an import only the slot read fails', fails(`import { planOf } from './engine-top-level.js';\n${out.host}`, []));
    check('a head that moved nothing fails', verifyHandSlots(tm, input, input, mods, mods).failures.some((f) => f.startsWith('nothing moved')));
    check('a slot that reads the stub\'s `this` refuses', /reads `this`/.test(refusalOf(() => planHandSlots(tm, input, mods, ['gammaThis']))));
    check('a slot that reads a local of the stub refuses', /the stub declares/.test(refusalOf(() => planHandSlots(tm, input, mods, ['gammaLocal']))));
    check('a stub whose slots all forward refuses', /no computing slot/.test(refusalOf(() => planHandSlots(tm, input, mods, ['gammaOnly']))));
    check('a slot holding a template that spans lines refuses', /spanning lines/.test(refusalOf(() => planHandSlots(tm, input, mods, ['gammaTpl']))));
    check('a method that is not a hand stub refuses', refused(() => planHandSlots(tm, `${input.replace('    // The body lives in `engine-gamma.ts` (see `GammaHost`).\n    const readN', '    const readN')}`, mods, ['gammaServe'])));
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
