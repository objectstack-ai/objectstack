#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * codemod-split-protocol — move whole sections of
 * `ObjectStackProtocolImplementation`'s method bodies out of
 * `packages/metadata-protocol/src/protocol.ts` into section modules,
 * deterministically, and prove the move.
 *
 *   node scripts/codemod-split-protocol.mjs                 # plan: print the section table, write nothing
 *   node scripts/codemod-split-protocol.mjs --write         # apply the split, then verify it
 *   node scripts/codemod-split-protocol.mjs --verify --base <ref>
 *                                                           # re-prove a split on disk against protocol.ts at <ref>
 *   node scripts/codemod-split-protocol.mjs --self-test
 *   node scripts/codemod-split-protocol.mjs --help          # this usage, on any tree (split or not)
 *
 * ## Why a script, and what it repeats
 *
 * The large-file programme's ruling A (`6583399215`) splits each file by a
 * deterministic codemod that applies the file's existing cut pattern to whole
 * sections, regenerated on the latest `main` at landing instead of rebased.
 * `scripts/codemod-split-sql-driver.mjs` is the pilot; this is the same
 * programme for `protocol.ts`, and it applies the cut pattern THIS file's hand
 * series already settled: ruling E's host split (`6537939895`, item E1), whose
 * tool is `packages/metadata-protocol/scripts/host-split.mjs`. This script does
 * not re-implement that pattern; it calls the tool, member by member:
 *
 *  - The method stays on the class with its docblock, modifiers and signature
 *    byte-for-byte, so the published `.d.ts` keeps its names and positions.
 *    Its body becomes the E1 stub: one marker comment and
 *    `return <member>(protocolHost(this), <params>);`.
 *  - The body moves, as `host-split.mjs`'s `planMove` writes it, into an
 *    exported function of the same name in a section module: the method's body
 *    with exactly E1's closed rewrite set applied (`this.<member>` →
 *    `host.<member>`; a private static `ObjectStackProtocolImplementation.<fn>(…)`
 *    → `host.<fn>(…)`), re-indented one level, and nothing else changed.
 *  - The host (`protocol-host.ts`) gains one `ProtocolHost` entry per member a
 *    moved body reads, and the class's static block the entry that forwards it,
 *    through `host-split.mjs`'s `insertHostEntries` (sorted by name).
 *
 * What the tool leaves to its caller, this script writes: the section module's
 * imports (each name a body reads, imported from where `protocol.ts` imports
 * it; lever (a) of the pilot ruling `6591753301`: a staying `protocol.ts`
 * top-level name a body reads is exported for it by one generated
 * `export { … }` list, and `index.ts` re-exports by name, so none reaches the
 * package), and `protocol.ts`'s imports of the moved functions.
 *
 * Private statics (private-static-through-host, ruling `6624174693`, kept by
 * `6624345766`): a private static whose body reads nothing of the class (no
 * `this`, `super`, `arguments` or class name) moves to its section's module the
 * same way, with no host parameter. The class keeps the delegation, so a moved
 * instance body still reaches it as `host.<static>`, through the host entry
 * that forwards to the class.
 *
 * ## The facade layer (ruling `6624345766`)
 *
 * The output above is (a)'s module form. The script then lifts it, text for
 * text, into the facade form, and only the facade form is written:
 *
 *  - Each section module's functions become the static methods of ONE
 *    stateless facet class, `<Module>Facet` (`protocol-save.ts` ->
 *    `ProtocolSaveFacet`). A method still takes the host as its first
 *    parameter, so its body is (a)'s body re-indented back to the class's own
 *    depth. A facet holds no state: the fields stay on the class (the facade),
 *    and a body reaches them through the host.
 *  - Each stub on the class calls `<Facet>.<member>(…)`.
 *  - Docblock ownership: a PRIVATE member's docblock moves, verbatim, onto its
 *    facet method, and the class keeps one line that links to it. A public or
 *    protected member's docblock stays on the facade: the published `.d.ts`
 *    prints it, and the ruling keeps consumers' hover docs unchanged.
 *
 * The proof of the layer is its inverse: `--verify` unlifts the head (from the
 * head texts alone) back to (a)'s form, refusing anything the lift would not
 * have written, then proves (a) against the base exactly as below. The plan
 * prints the facade reading: every class member with a body, as a delegation
 * (to a facet, or in one of the hand series' forms) or a named exception with
 * the reason it stayed (the #30019 gate's starting allow-list).
 *
 * Lever (b) of the same ruling (top-level declarations ahead of the class move
 * whole to a leaf) has nothing to move here: ruling E's step E0 already moved
 * the preamble out of `protocol.ts`, and what stands ahead of the class is
 * imports and two re-export statements. The plan prints that reading.
 *
 * ## The sections
 *
 * `protocol.ts` has almost no banners inside the class (five, all inside one
 * section), so a section is named by its FIRST member, in `SECTION_ANCHORS`:
 * the section table of the hand series' card (#25467), read top to bottom. A
 * member belongs to the last anchor at or above it. An anchor the class does
 * not declare, or anchors out of class order, stop the script (exit 2): a new
 * section is a decision someone writes here, never a name the script makes up.
 * `null` keeps the section's methods on the class.
 *
 * ## What stays, and why (each reason is mechanical)
 *
 * A method stays whole on the class when moving it would change what it does,
 * what the published `.d.ts` says, what a gate or test that reads
 * `protocol.ts` BY PATH sees, or when the move could not be undone byte for
 * byte. `STAY_REASONS` lists every reason; the plan prints every method that
 * stayed and why. `PATH_READER_PINS` (a member whose text a reader extracts
 * from `protocol.ts` by path) and `PATH_READER_NEEDLES` (literal text a reader
 * requires to find there) are the tables rather than rules.
 *
 * The pilot's rule that a body no longer than its stub stays is NOT carried:
 * under the facade rule of `6624258595` the class keeps delegations only, so
 * the length of a body is no reason to keep it.
 *
 * The pilot's rule on inferred return types is carried: a non-private method
 * whose return type is inferred stays (`inferred-return-type`). The published
 * `.d.ts` prints that type, and once the body moves the compiler infers it
 * through the moved function instead: measured on this file, `getDiscovery`'s
 * printed type lost the `@deprecated` docblock on one of its keys (the bar
 * on the built `.d.ts` refused the split until the rule was back). A private
 * method's type is not printed (`private name;`), so it moves.
 *
 * ## The proof (`--write` runs it on its own output; `--verify` re-runs it)
 *
 *  1. Byte-identity: undoing the split rebuilds the base `protocol.ts` AND the
 *     base `protocol-host.ts` byte-for-byte. Undoing is, from the head texts
 *     alone: put each moved function's body back on its stub with E1's
 *     rewrites reversed (`host.<member>` → `this.<member>`, `host.<static>` →
 *     `ObjectStackProtocolImplementation.<static>`) and its re-indentation
 *     reversed; drop the generated import and export statements; and drop the
 *     host entries whose names the base host does not carry (the one fact read
 *     off the base: which entry names existed). Every byte of the result comes
 *     from the head. A method moves only when that inverse is exact for its own
 *     body (`indent-irreversible` otherwise), so the proof can pass at all.
 *  2. The hand series' own check, per moved member: `host-split.mjs`'s
 *     `checkMove` (AST identity modulo exactly the closed set, the stub, the
 *     signature, the `Pick`, and the body's text). Two independent proofs of
 *     one move.
 *  3. The declaration-file bar (ruling `6348891160`, judged by ruling
 *     `6441032442` B's second normalisation) is a report reading on two built
 *     dists, never a `scripts/` file (that ruling's item 3); the PR reports it.
 *
 * ## Determinism
 *
 * The input is the text of `protocol.ts` and `protocol-host.ts`. Each is
 * parsed in memory (no file system, no lib, no build output, no clock), every
 * collection is emitted in source order or sorted, and the output is a pure
 * function of the input: two runs on one input write byte-identical trees
 * (the plan prints the output tree's sha256).
 *
 * Exit codes: 0 done · 1 a proof failed (stop: the generated split is never
 * hand-edited to pass) · 2 the script could not run (unknown anchor, missing
 * prerequisite, bad arguments) · 3 an input does not parse (`ts-parse.mjs`'s
 * refusal, which names the parse errors).
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { createProgramChecked, parseSourceFile } from './ts-parse.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PKG_REL = 'packages/metadata-protocol';
const SRC_REL = `${PKG_REL}/src`;
const SRC_DIR = join(ROOT, SRC_REL);
const HOST_BASENAME = 'protocol.ts';
const HOST_PATH = join(SRC_DIR, HOST_BASENAME);
const HOST_MODULE_BASENAME = 'protocol-host.ts';
const HOST_MODULE_PATH = join(SRC_DIR, HOST_MODULE_BASENAME);
const HOST_SPLIT_PATH = join(ROOT, PKG_REL, 'scripts', 'host-split.mjs');
const CLASS_NAME = 'ObjectStackProtocolImplementation';
const CARD = '#29985';

/** The marker every generated file, import and stub carries; `--verify` keys on it. */
const MARK = `[${CARD} codemod]`;

/**
 * The sections of `ObjectStackProtocolImplementation`, top to bottom, each
 * named by its first member (the #25467 section table), mapped to the module
 * its movable bodies go to. `null` keeps the section on the class. No module
 * shares a file with a hand-written one: the script refuses to write over a
 * file it did not generate.
 */
const SECTION_ANCHORS = Object.freeze([
  ['engine', 'Class head: fields, stored-row conversion, resolvers, registration hooks, authoring gates, mutation pub/sub, overlay index', 'protocol-class-head.ts'],
  ['getProjectId', 'Discovery, types, diagnostics, packaged bases, credential carry-forward', 'protocol-discovery-and-bases.ts'],
  ['readItemFromMetadataService', 'Metadata reads', 'protocol-metadata-reads.ts'],
  ['assertObjectRegistered', 'Query validation', 'protocol-query-guards.ts'],
  ['findData', 'Data CRUD', 'protocol-data-crud.ts'],
  ['searchAll', 'Global search and the metadata cache', 'protocol-search-and-cache.ts'],
  ['batchData', 'Batch and *Many data', 'protocol-batch-and-many.ts'],
  ['OVERLAY_ALLOWED_TYPES', 'Write gates: overlay, code-only, organization, sealed and packaged-base refusals, locks, version tokens, conflict audit', 'protocol-write-gates.ts'],
  ['applyObjectRegistryMutation', 'Registry hydration, view expansion, write-through, object storage', 'protocol-registry-hydration.ts'],
  ['refuseUngrammaticalMetaItemName', 'Save refusals, saveMetaItem, saveConflict, migrateStoredMetadata', 'protocol-save.ts'],
  ['historyMetaItem', 'History, publish, drafts, publish backfill', 'protocol-history-and-publish.ts'],
  ['revertStoredPackage', 'Package revert, duplicate, import, orphans, commits, revertCommit, rollback', 'protocol-package-commits.ts'],
  ['diffMetaItem', 'Diff, deleteMetaItem, loadMetaFromDb, load reports, findReferencesToMeta', 'protocol-diff-delete-load.ts'],
  ['installPackage', 'Package install and update', 'protocol-package-install-update.ts'],
]);

/**
 * Members whose text a reader takes out of `protocol.ts` BY PATH. Moving one
 * would leave that reader reading a stub, or nothing. Each row names the
 * reader. A row naming no member of the class stops the script (exit 2), so the
 * table cannot rot into names nobody reads.
 */
const PATH_READER_PINS = Object.freeze({
});

/**
 * Literal text a reader requires to find in `protocol.ts` BY PATH. A method
 * whose text carries one stays, so the reader still finds it where it looks.
 * Each row names the reader. A needle the file no longer carries stops the
 * script (exit 2).
 */
const PATH_READER_NEEDLES = Object.freeze({
});

/** Every reason a method stays, with the one-line why the plan prints. */
const STAY_REASONS = Object.freeze({
  'section-kept': 'its section maps to no module',
  'already-moved': 'its body is already a hand-series stub',
  'overloaded': 'an overloaded method',
  'decorated': 'a decorated method',
  'generator': 'a generator',
  'closed-set': 'its body does something outside E1\'s closed rewrite set (host-split.mjs refuses it)',
  'constructor-rewrite': 'it reads `this.constructor.<static>` (that rewrite and the private-static one both print `host.<static>`, so undoing it would be ambiguous)',
  'parameter-shape': 'a destructured or `this` parameter (the stub forwards parameters by name)',
  'inferred-return-type': 'a non-private method with an inferred return type (the published `.d.ts` prints the type, which the move would re-infer through the moved function)',
  'parameter-shadows': 'a parameter is named `host`, `protocolHost` or the method itself (the stub or the moved function would read it)',
  'path-reader': 'a reader takes its text out of protocol.ts by path (PATH_READER_PINS / PATH_READER_NEEDLES)',
  'non-public-static': 'it reads a protected static of the class through its name (unreachable from a module function)',
  'module-write': 'it assigns a module-scope binding of protocol.ts (an import is read-only)',
  'name-taken': 'its name is already a module-scope binding of protocol.ts, or a free name protocol.ts reads',
  'name-collision': 'its name collides with a name its module imports or reads',
  'host-entry-conflict': 'it needs a host entry that differs from the one protocol-host.ts already carries for that member',
  'host-entry-predicate': 'it reaches a type-predicate method through a host entry not yet written (the forwarding closure would drop the predicate)',
  'indent-irreversible': 'its body\'s re-indentation cannot be undone byte for byte (a whitespace-only or under-indented line)',
  'no-host-read': 'its body reads no member of the class, so the moved function would never read its `host` parameter (`noUnusedParameters`)',
  'static-reads-class': 'a private static whose body reads the class itself (`this`, `super`, `arguments` or the class name), which a module function cannot reach',
  'static-shape': 'a static that is public or protected, overloaded, decorated or a generator (only a private static\'s body moves)',
});

// ── Loading the tools ────────────────────────────────────────────────────────

let tools = null;

/**
 * `host-split.mjs` and the TypeScript instance it uses. A missing install is
 * exit 2 with the remedy, never a stack trace.
 */
async function loadTools() {
  if (tools) return tools;
  try {
    const hs = await import(pathToFileURL(HOST_SPLIT_PATH).href);
    const tsModule = await import(pathToFileURL(join(ROOT, PKG_REL, 'node_modules', 'typescript', 'lib', 'typescript.js')).href);
    tools = { hs, ts: tsModule.default ?? tsModule };
    return tools;
  } catch (error) {
    console.error(
      `✗ codemod-split-protocol: PREREQUISITE NOT MET — ${HOST_SPLIT_PATH} or its \`typescript\` does not load ` +
        `(${error && error.code ? error.code : 'error'}). Run \`pnpm install\` in this worktree.`,
    );
    process.exit(2);
  }
}

/** A reason the script cannot run at all (exit 2) — never a verdict on the split. */
class CodemodRefusal extends Error {}

function refuse(message) {
  throw new CodemodRefusal(message);
}

/**
 * One in-memory program over one file: no lib, no module resolution, no file
 * system. The text goes through `ts-parse.mjs`'s checked parse first, which
 * refuses a source with parse errors (its exit 3). The checker resolves every
 * identifier to its declaration in this file, an import specifier included.
 */
function program(ts, fileName, text) {
  const sf = parseSourceFile(fileName, text);
  const host = {
    getSourceFile: (name) => (name === fileName ? sf : undefined),
    writeFile() {},
    getDefaultLibFileName: () => '/lib.d.ts',
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => '/',
    getNewLine: () => '\n',
    fileExists: (name) => name === fileName,
    readFile: () => undefined,
  };
  const prog = createProgramChecked([fileName], { noLib: true, noResolve: true, target: ts.ScriptTarget.ES2022, strict: true }, host);
  return { sf, checker: prog.getTypeChecker() };
}

// ── Analysis ─────────────────────────────────────────────────────────────────

const hasModifier = (ts, node, kind) => Boolean(node.modifiers?.some((m) => m.kind === kind));

/** The names protocol.ts binds at module scope, which of them it exports, and its import order. */
function moduleScope(ts, sf) {
  const bindings = new Map(); // name -> { kind: 'import' | 'local', specifier?, form?, imported?, typeOnly?, typeDecl? }
  const exported = new Set();
  const importOrder = new Map();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const specifier = st.moduleSpecifier.text;
      if (!importOrder.has(specifier)) importOrder.set(specifier, importOrder.size);
      const clause = st.importClause;
      if (!clause) continue;
      const declTypeOnly = Boolean(clause.isTypeOnly);
      if (clause.name) bindings.set(clause.name.text, { kind: 'import', specifier, form: 'default', typeOnly: declTypeOnly });
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) bindings.set(nb.name.text, { kind: 'import', specifier, form: 'namespace', typeOnly: declTypeOnly });
      if (nb && ts.isNamedImports(nb)) {
        for (const spec of nb.elements) {
          bindings.set(spec.name.text, {
            kind: 'import', specifier, form: 'named', imported: (spec.propertyName ?? spec.name).text,
            typeOnly: declTypeOnly || Boolean(spec.isTypeOnly),
          });
        }
      }
      continue;
    }
    if (ts.isExportDeclaration(st)) {
      if (!st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const spec of st.exportClause.elements) exported.add((spec.propertyName ?? spec.name).text);
      }
      continue;
    }
    const isExported = hasModifier(ts, st, ts.SyntaxKind.ExportKeyword);
    const names = [];
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) collectBindingNames(ts, d.name, names);
    } else if (st.name && ts.isIdentifier(st.name)) {
      names.push(st.name.text);
    }
    const typeDecl = ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st);
    for (const name of names) {
      bindings.set(name, { kind: 'local', typeDecl });
      if (isExported) exported.add(name);
    }
  }
  return { bindings, exported, importOrder };
}

function collectBindingNames(ts, name, out) {
  if (ts.isIdentifier(name)) { out.push(name.text); return; }
  for (const el of name.elements) if (!ts.isOmittedExpression(el)) collectBindingNames(ts, el.name, out);
}

/** Is `node` inside a type node, below `stop`? */
function inTypePosition(ts, node, stop) {
  for (let n = node.parent; n && n !== stop; n = n.parent) if (ts.isTypeNode(n)) return true;
  return false;
}

/** Is `node` inside a JSDoc comment? */
function inJsDoc(ts, node) {
  for (let n = node; n; n = n.parent) if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return true;
  return false;
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

/** Is this identifier a property NAME (`x.name`, `{ name: v }`, a member name), not a reference? */
function isPropertyNameIdentifier(ts, node) {
  const p = node.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === node) return true;
  if (ts.isQualifiedName(p) && p.right === node) return true;
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p)
    || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isMethodSignature(p)
    || ts.isEnumMember(p) || ts.isBindingElement(p)) && p.name === node) return true;
  if (ts.isBindingElement(p) && p.propertyName === node) return true;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return true;
  return false;
}

function isWrittenIdentifier(ts, node) {
  let target = node;
  for (let p = target.parent; p && (ts.isParenthesizedExpression(p) || ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p)
    || ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p)); target = p, p = p.parent);
  const parent = target.parent;
  if (!parent) return false;
  if (ts.isBinaryExpression(parent) && parent.left === target) {
    const op = parent.operatorToken.kind;
    return op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment;
  }
  if (target === node && (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))) {
    return parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken;
  }
  if ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && parent.initializer === target) return true;
  return false;
}

/**
 * Every identifier a method's signature and body read, resolved: the imports
 * of protocol.ts it uses (value or type), the module-scope names of
 * protocol.ts it uses, the free names (no declaration in the file: globals),
 * and the refusals a module function cannot carry.
 */
function readNames(ts, ctx, m, siteStarts = new Set()) {
  const imports = new Map(); // local -> { value }
  const moduleRefs = new Map(); // protocol.ts top-level name -> { value }
  const free = new Set();
  const reasons = [];
  const add = (tag) => { if (!reasons.includes(tag)) reasons.push(tag); };
  const regions = [...(m.typeParameters ?? []), ...m.parameters, m.type, m.body].filter(Boolean);
  const visit = (node, region) => {
    // A rewrite site (a private static's class name) becomes `host` in the
    // module: it reads nothing from protocol.ts there.
    if (ts.isIdentifier(node) && !inJsDoc(ts, node) && !siteStarts.has(node.getStart(ctx.sf))) {
      const parent = node.parent;
      let symbol;
      if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) symbol = ctx.checker.getShorthandAssignmentValueSymbol(parent);
      else if (!isPropertyNameIdentifier(ts, node)) symbol = ctx.checker.getSymbolAtLocation(node);
      const typePos = inTypePosition(ts, node, m);
      if (!isPropertyNameIdentifier(ts, node) && (!symbol || !symbol.declarations || symbol.declarations.length === 0)) {
        if (node.text !== 'undefined' && node.text !== 'arguments') free.add(node.text);
      }
      for (const decl of symbol?.declarations ?? []) {
        if (decl.getSourceFile() !== ctx.sf) continue;
        if (ts.isImportSpecifier(decl) || ts.isImportClause(decl) || ts.isNamespaceImport(decl)) {
          const local = node.text;
          const prev = imports.get(local);
          imports.set(local, { value: Boolean(prev && prev.value) || !typePos });
          continue;
        }
        if (!isModuleScopeDecl(ts, decl)) continue;
        const declName = decl.name && ts.isIdentifier(decl.name) ? decl.name.text : node.text;
        if (ts.isClassDeclaration(decl) && declName === CLASS_NAME && !typePos) {
          const access = node.parent;
          if (ts.isPropertyAccessExpression(access) && access.expression === node) {
            const st = ctx.table.statics.get(access.name.text);
            if (st && !st.private && ctx.staticScope.get(access.name.text) === 'protected') add(`non-public-static: ${access.name.text}`);
          }
        }
        if (!typePos && isWrittenIdentifier(ts, node)) add(`module-write: ${declName}`);
        const prev = moduleRefs.get(declName);
        moduleRefs.set(declName, { value: Boolean(prev && prev.value) || !typePos });
      }
    }
    ts.forEachChild(node, (c) => visit(c, region));
  };
  for (const region of regions) visit(region, region);
  return { imports, moduleRefs, free, reasons };
}

/** `[{ line, title }]`-free section lookup: the section each class member falls in. */
function sectionTable(ts, sf, cls, anchors) {
  const starts = [];
  for (const [anchor, title, module] of anchors) {
    const member = cls.members.find((m) => m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name)) && m.name.text === anchor);
    if (!member) refuse(`SECTION_ANCHORS names \`${anchor}\`, which ${CLASS_NAME} does not declare. Re-read the class and fix the table.`);
    starts.push({ anchor, title, module, pos: member.getFullStart() });
  }
  for (let i = 1; i < starts.length; i += 1) {
    if (starts[i].pos <= starts[i - 1].pos) refuse(`SECTION_ANCHORS is out of class order at \`${starts[i].anchor}\` (it stands above \`${starts[i - 1].anchor}\`)`);
  }
  const first = cls.members[0];
  if (!first || starts[0].pos !== first.getFullStart()) refuse(`SECTION_ANCHORS must start at the class's first member (\`${first?.name?.getText(sf) ?? '?'}\`)`);
  return (member) => {
    let hit = null;
    for (const s of starts) if (s.pos <= member.getFullStart()) hit = s;
    return hit;
  };
}

/** The line indices (0-based) of `bodyText` that start inside a string or template literal. */
function literalLineIndices(ts, bodyText) {
  const prefix = 'function f() ';
  const text = prefix + bodyText;
  const sf = parseSourceFile('x.ts', text);
  const starts = new Set();
  const visit = (node) => {
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isStringLiteral(node)) {
      const start = node.getStart(sf);
      const end = node.getEnd();
      for (let i = text.indexOf('\n', start); i !== -1 && i < end - 1; i = text.indexOf('\n', i + 1)) starts.add(i + 1 - prefix.length);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const indices = new Set();
  let at = 0;
  bodyText.split('\n').forEach((line, i) => {
    if (starts.has(at)) indices.add(i);
    at += line.length + 1;
  });
  return indices;
}

/**
 * The inverse of E1's move for one body: `host.<x>` back to `this.<x>` (or the
 * class name, for a private static), and one level of indentation back on every
 * line but the first, except a line that starts inside a literal and an empty
 * line. `privateStatics` is the set of private static names of the class.
 */
function undoBody(ts, movedBodyText, privateStatics) {
  const prefix = 'function f(host: any) ';
  const sf = parseSourceFile('x.ts', prefix + movedBodyText);
  const sites = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === 'host' && ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) {
      const start = node.getStart(sf) - prefix.length;
      if (start >= 0) sites.push({ start, end: node.getEnd() - prefix.length, text: privateStatics.has(node.parent.name.text) ? CLASS_NAME : 'this' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  let text = movedBodyText;
  for (const s of sites.sort((a, b) => b.start - a.start)) text = text.slice(0, s.start) + s.text + text.slice(s.end);
  const literal = literalLineIndices(ts, text);
  return text.split('\n').map((line, i) => (i === 0 || literal.has(i) || line === '' ? line : `    ${line}`)).join('\n');
}

/**
 * One level of indentation off every line of a static's body but the first,
 * except a line that starts inside a literal and an empty line: the inverse of
 * `undoBody`'s re-indentation (a static's body has no host rewrite to undo).
 */
function dedentBody(ts, bodyText) {
  const literal = literalLineIndices(ts, bodyText);
  return bodyText.split('\n').map((line, i) => (i === 0 || literal.has(i) || !line.startsWith('    ') ? line : line.slice(4))).join('\n');
}

/** The one-line docblock a moved private static's function carries in (a)'s module form. */
const staticOneLiner = (name) => `/** The body of \`${CLASS_NAME}.${name}\` (a private static); the method's docblock there is its contract. */`;

/** The one-line docblock `host-split.mjs`'s `planMove` writes on a moved instance body. */
const instanceOneLiner = (name) => `/** The body of \`${CLASS_NAME}#${name}\`; the method's docblock there is its contract. */`;

/** The body text of the one exported function in `fnText` (what `planMove` writes). */
function functionBodyOf(ts, fnText) {
  const sf = parseSourceFile('x.ts', fnText);
  const fn = sf.statements.find((s) => ts.isFunctionDeclaration(s));
  return fn && fn.body ? fnText.slice(fn.body.getStart(sf), fn.body.getEnd()) : null;
}

/** The keyed groups of a sorted host block (interface or factory), as `insertHostEntries` reads them. */
function hostBlockKeys(text, openMarker, closeMarker, keyOf) {
  const open = text.indexOf(openMarker);
  const close = text.indexOf(closeMarker, open);
  if (open < 0 || close < 0) return null;
  const keys = new Set();
  for (const l of text.slice(open + openMarker.length, close).split('\n')) {
    const k = keyOf(l);
    if (k !== undefined) keys.add(k);
  }
  return { open, close, keys };
}

const IFACE_OPEN = 'export interface ProtocolHost {';
const IFACE_CLOSE = '\n}';
const FACTORY_OPEN = 'installProtocolHost((protocol) => ({';
const FACTORY_CLOSE = '\n        }));';
const ifaceKey = (l) => /^ {4}(?:readonly )?([A-Za-z_$][\w$]*):/.exec(l)?.[1];
const factoryKey = (l) => (/^ {12}set /.test(l) ? undefined : /^ {12}(?:get )?([A-Za-z_$][\w$]*)[:(]/.exec(l)?.[1]);

/** The interface entry lines `protocol-host.ts` carries now, by member name. */
function hostInterfaceEntries(hostText) {
  const block = hostBlockKeys(hostText, IFACE_OPEN, IFACE_CLOSE, ifaceKey);
  if (!block) refuse(`${HOST_MODULE_BASENAME} has no \`${IFACE_OPEN}\` block`);
  const out = new Map();
  for (const l of hostText.slice(block.open + IFACE_OPEN.length, block.close).split('\n')) {
    const k = ifaceKey(l);
    if (k !== undefined) out.set(k, l);
  }
  return out;
}

// ── The plan ─────────────────────────────────────────────────────────────────

/**
 * Read `text` (a `protocol.ts`) and `hostText` (its `protocol-host.ts`), and
 * decide, per instance method, where its body goes. Pure: the same texts give
 * the same plan.
 */
function plan(T, text, hostText, { anchors = SECTION_ANCHORS, pins = PATH_READER_PINS, needles = PATH_READER_NEEDLES } = {}) {
  const { ts, hs } = T;
  const { sf, checker } = program(ts, HOST_PATH, text);
  const cls = hs.classOf(sf, CLASS_NAME);
  if (!cls) refuse(`no class ${CLASS_NAME} in ${HOST_BASENAME}`);
  const table = hs.memberTable(cls);
  const staticScope = new Map();
  for (const m of cls.members) {
    if (!hasModifier(ts, m, ts.SyntaxKind.StaticKeyword) || !m.name || !ts.isIdentifier(m.name)) continue;
    staticScope.set(m.name.text, hasModifier(ts, m, ts.SyntaxKind.PrivateKeyword) ? 'private'
      : hasModifier(ts, m, ts.SyntaxKind.ProtectedKeyword) ? 'protected' : 'public');
  }
  const scope = moduleScope(ts, sf);
  const ctx = { ts, sf, checker, cls, table, staticScope, scope };
  const sectionOf = sectionTable(ts, sf, cls, anchors);
  const memberNames = new Set(cls.members.filter((m) => m.name && ts.isIdentifier(m.name)).map((m) => m.name.text));
  const stalePins = Object.keys(pins).filter((n) => !memberNames.has(n));
  if (stalePins.length > 0) refuse(`PATH_READER_PINS names what ${CLASS_NAME} no longer declares: ${stalePins.join(', ')}`);
  const staleNeedles = Object.keys(needles).filter((n) => !text.includes(n));
  if (staleNeedles.length > 0) refuse(`PATH_READER_NEEDLES names text ${HOST_BASENAME} no longer carries: ${staleNeedles.map((n) => JSON.stringify(n)).join(', ')}`);
  const existingEntries = hostInterfaceEntries(hostText);
  const privateStatics = new Set([...table.statics].filter(([, s]) => s.private).map(([n]) => n));
  // Members whose declared return type is a type predicate (`x is T`, not `asserts`).
  const predicateMembers = new Set();
  for (const m of cls.members) {
    if (ts.isMethodDeclaration(m) && m.name && ts.isIdentifier(m.name) && m.type && ts.isTypePredicateNode(m.type) && !m.type.assertsModifier) {
      predicateMembers.add(m.name.text);
    }
  }

  // Every free name protocol.ts reads anywhere: a moved function imported
  // under one of these names would capture it.
  const freeInHost = new Set();
  const scanFree = (node) => {
    if (ts.isIdentifier(node) && !inJsDoc(ts, node) && !isPropertyNameIdentifier(ts, node)) {
      const s = checker.getSymbolAtLocation(node);
      if (!s || !s.declarations || s.declarations.length === 0) freeInHost.add(node.text);
    }
    ts.forEachChild(node, scanFree);
  };
  scanFree(sf);

  const records = [];
  for (const m of cls.members) {
    if (!ts.isMethodDeclaration(m) || !m.body || hasModifier(ts, m, ts.SyntaxKind.StaticKeyword)) continue;
    if (!m.name || !ts.isIdentifier(m.name)) continue;
    const name = m.name.text;
    const section = sectionOf(m);
    const reasons = [];
    const add = (tag) => { if (!reasons.includes(tag)) reasons.push(tag); };
    const startLine = sf.getLineAndCharacterOfPosition(m.getStart(sf)).line + 1;
    const endLine = sf.getLineAndCharacterOfPosition(m.getEnd()).line + 1;
    const bodyLines = sf.getLineAndCharacterOfPosition(m.body.getEnd()).line - sf.getLineAndCharacterOfPosition(m.body.getStart(sf)).line + 1;
    const record = { name, node: m, section: section.title, module: section.module, startLine, lineCount: endLine - startLine + 1, bodyLines, reasons };
    records.push(record);
    if (!section.module) add('section-kept');
    const stub = hs.stubKindOf(m);
    if (stub) { add(`already-moved: ${stub}`); continue; }
    if (cls.members.some((o) => o !== m && ts.isMethodDeclaration(o) && !o.body && o.name && ts.isIdentifier(o.name) && o.name.text === name)) add('overloaded');
    if (ts.canHaveDecorators?.(m) && ts.getDecorators?.(m)?.length) add('decorated');
    if (m.asteriskToken) add('generator');
    const isPrivate = (m.modifiers ?? []).some((x) => x.kind === ts.SyntaxKind.PrivateKeyword) || ts.isPrivateIdentifier(m.name);
    if (!isPrivate && !m.type) add('inferred-return-type');
    for (const p of m.parameters) {
      if (!ts.isIdentifier(p.name) || p.name.text === 'this') add(`parameter-shape: ${p.name.getText(sf)}`);
      else if (['host', 'protocolHost', name].includes(p.name.text)) add(`parameter-shadows: ${p.name.text}`);
    }
    const methodText = m.getText(sf);
    for (const needle of Object.keys(needles)) if (methodText.includes(needle)) add(`path-reader: ${JSON.stringify(needle)}`);
    if (Object.prototype.hasOwnProperty.call(pins, name)) add(`path-reader: ${name}`);
    const sites = hs.rewriteSites(sf, m, table, CLASS_NAME);
    for (const r of sites.refusals) add(`closed-set: ${r.reason}`);
    if (sites.sites.some((s) => s.kind === 'constructor')) add('constructor-rewrite');
    const names = readNames(ts, ctx, m, new Set(sites.sites.filter((x) => x.kind === 'privateStatic').map((x) => x.start)));
    for (const r of names.reasons) add(r);
    if (scope.bindings.has(name) || freeInHost.has(name)) add('name-taken');
    Object.assign(record, { imports: names.imports, moduleRefs: names.moduleRefs, free: names.free });
    if (reasons.length > 0) continue;

    const moved = hs.planMove(text, name, section.module, CLASS_NAME);
    if (moved.refusals.length > 0) { for (const r of moved.refusals) add(`closed-set: ${r.reason}`); continue; }
    record.fnText = moved.fnText;
    record.stub = moved.stub;
    record.hostEntries = moved.hostEntries;
    record.hostNames = moved.names;
    for (const [member, entry] of moved.hostEntries) {
      const have = existingEntries.get(member);
      if (have !== undefined && have !== entry.iface) add(`host-entry-conflict: ${member}`);
      if (have === undefined && predicateMembers.has(member)) add(`host-entry-predicate: ${member}`);
    }
    if (moved.sites.length === 0) add('no-host-read');
    const movedBody = functionBodyOf(ts, moved.fnText);
    const baseBody = text.slice(m.body.getStart(sf), m.body.getEnd());
    if (movedBody === null || undoBody(ts, movedBody, privateStatics) !== baseBody) add('indent-irreversible');
    record.stubLines = stubBody(name, section.module, m).split('\n').length;
  }

  // Private statics (private-static-through-host, ruling 6624174693, kept by
  // 6624345766): a private static whose body reads nothing of the class moves
  // to its section's module like an instance body, with no host parameter; the
  // class keeps the delegation, so the moved instance bodies keep reaching it
  // through the host entry that forwards to the class.
  for (const m of cls.members) {
    if (!ts.isMethodDeclaration(m) || !m.body || !hasModifier(ts, m, ts.SyntaxKind.StaticKeyword)) continue;
    if (!m.name || !ts.isIdentifier(m.name)) continue;
    const name = m.name.text;
    const section = sectionOf(m);
    const reasons = [];
    const add = (tag) => { if (!reasons.includes(tag)) reasons.push(tag); };
    const startLine = sf.getLineAndCharacterOfPosition(m.getStart(sf)).line + 1;
    const endLine = sf.getLineAndCharacterOfPosition(m.getEnd()).line + 1;
    const bodyLines = sf.getLineAndCharacterOfPosition(m.body.getEnd()).line - sf.getLineAndCharacterOfPosition(m.body.getStart(sf)).line + 1;
    const record = { name, node: m, isStatic: true, section: section.title, module: section.module, startLine, lineCount: endLine - startLine + 1, bodyLines, reasons };
    records.push(record);
    if (!section.module) add('section-kept');
    const isPrivate = hasModifier(ts, m, ts.SyntaxKind.PrivateKeyword);
    const overloaded = cls.members.some((o) => o !== m && ts.isMethodDeclaration(o) && !o.body && o.name && ts.isIdentifier(o.name) && o.name.text === name);
    if (!isPrivate || overloaded || m.asteriskToken || (ts.canHaveDecorators?.(m) && ts.getDecorators?.(m)?.length)) { add('static-shape'); continue; }
    if (hs.stubKindOf(m)) { add('already-moved: static'); continue; }
    for (const p of m.parameters) {
      if (!ts.isIdentifier(p.name) || p.name.text === 'this') add(`parameter-shape: ${p.name.getText(sf)}`);
      else if (['host', 'protocolHost', name].includes(p.name.text)) add(`parameter-shadows: ${p.name.text}`);
    }
    const classReads = new Set();
    const scanClass = (node) => {
      if (node.kind === ts.SyntaxKind.ThisKeyword) classReads.add('this');
      else if (node.kind === ts.SyntaxKind.SuperKeyword) classReads.add('super');
      else if (ts.isIdentifier(node) && !inJsDoc(ts, node) && ['arguments', CLASS_NAME, 'host', 'protocolHost'].includes(node.text)
        && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) classReads.add(node.text);
      ts.forEachChild(node, scanClass);
    };
    for (const p of m.parameters) scanClass(p);
    if (m.type) scanClass(m.type);
    if (m.typeParameters) for (const tp of m.typeParameters) scanClass(tp);
    scanClass(m.body);
    for (const c of [...classReads].sort()) add(`static-reads-class: ${c}`);
    const methodText = m.getText(sf);
    for (const needle of Object.keys(needles)) if (methodText.includes(needle)) add(`path-reader: ${JSON.stringify(needle)}`);
    if (Object.prototype.hasOwnProperty.call(pins, name)) add(`path-reader: ${name}`);
    const names = readNames(ts, ctx, m, new Set());
    for (const r of names.reasons) add(r);
    if (scope.bindings.has(name) || freeInHost.has(name)) add('name-taken');
    Object.assign(record, { imports: names.imports, moduleRefs: names.moduleRefs, free: names.free });
    if (reasons.length > 0) continue;
    const baseBody = text.slice(m.body.getStart(sf), m.body.getEnd());
    const movedBody = dedentBody(ts, baseBody);
    if (undoBody(ts, movedBody, privateStatics) !== baseBody) { add('indent-irreversible'); continue; }
    const paramsText = m.parameters.length ? text.slice(m.parameters[0].getStart(sf), m.parameters.end).trim() : '';
    const typeParams = m.typeParameters ? `<${text.slice(m.typeParameters.pos, m.typeParameters.end).trim()}>` : '';
    const async = hasModifier(ts, m, ts.SyntaxKind.AsyncKeyword);
    record.fnText = `${staticOneLiner(name)}\n`
      + `export ${async ? 'async ' : ''}function ${name}${typeParams}(${paramsText})${m.type ? `: ${m.type.getText(sf)}` : ''} ${movedBody}\n`;
    record.stub = { start: m.body.getStart(sf), end: m.body.getEnd() };
    record.hostEntries = new Map();
    record.hostNames = [];
    record.stubLines = stubBody(name, section.module, m, true).split('\n').length;
  }

  // Two moved bodies that need different entries for one member (a field one
  // reads and one writes) make every body that needs the writable one stay
  // only when protocol-host.ts already carries the readonly one — handled per
  // record above; between movers, the writable entry is the one written.
  for (let changed = true; changed;) {
    changed = false;
    const byModule = groupMovers(records);
    // protocol.ts imports every mover by its name: two movers of one name (an
    // instance method and a static) would import one binding twice.
    const seen = new Set();
    for (const [, movers] of byModule) {
      for (const r of movers) {
        if (seen.has(r.name)) { r.reasons.push('name-collision'); changed = true; }
        seen.add(r.name);
      }
    }
    if (changed) continue;
    for (const [, movers] of byModule) {
      const taken = new Set(['ProtocolHost', 'Pick', 'host', CLASS_NAME]);
      for (const r of movers) {
        for (const local of r.imports.keys()) taken.add(local);
        for (const local of r.moduleRefs.keys()) taken.add(local);
        for (const local of r.free) taken.add(local);
      }
      for (const r of movers) if (taken.has(r.name)) { r.reasons.push('name-collision'); changed = true; }
    }
  }
  const modules = groupMovers(records);

  const hostExportsForSections = new Map();
  for (const movers of modules.values()) {
    for (const r of movers) {
      for (const [n, use] of r.moduleRefs) {
        if (n === CLASS_NAME || scope.exported.has(n)) continue;
        const prev = hostExportsForSections.get(n);
        hostExportsForSections.set(n, { value: Boolean(prev && prev.value) || use.value });
      }
    }
  }
  const before = [];
  for (const st of sf.statements) {
    if (st === cls) break;
    if (!ts.isImportDeclaration(st)) before.push(ts.SyntaxKind[st.kind]);
  }
  return { sf, cls, ctx, records, modules, hostExportsForSections, before, privateStatics };
}

/** Movers grouped by module, modules in section order. */
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

/**
 * One `import` / `export` statement over `names`: on one line when it fits in
 * 120 columns, else one name per line, four-space indented (this package's
 * style).
 */
function namedStatement(head, names, tail) {
  const one = `${head} { ${names.join(', ')} }${tail}`;
  if (one.length <= 120) return one;
  return [`${head} {`, ...names.map((n) => `    ${n},`), `}${tail}`].join('\n');
}

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
 * The import lines a module needs: protocol.ts's own imports its bodies use,
 * in protocol.ts's import order; then `ProtocolHost`; then what stayed in
 * protocol.ts (lever (a)), the class included.
 */
function importLines(scope, movers) {
  const bySpecifier = new Map();
  const note = (specifier, local, entry) => {
    if (!bySpecifier.has(specifier)) bySpecifier.set(specifier, new Map());
    const slot = bySpecifier.get(specifier);
    const prev = slot.get(local);
    slot.set(local, { ...entry, value: Boolean(prev && prev.value) || entry.value });
  };
  for (const r of movers) {
    for (const [local, use] of r.imports) {
      const b = scope.bindings.get(local);
      if (!b || b.kind !== 'import') refuse(`import binding ${local} not found`);
      note(b.specifier, local, { ...b, value: use.value && !b.typeOnly });
    }
  }
  if (movers.some((r) => !r.isStatic)) note('./protocol-host.js', 'ProtocolHost', { form: 'named', imported: 'ProtocolHost', value: false });
  const order = (s) => (scope.importOrder.has(s) ? scope.importOrder.get(s) : Number.MAX_SAFE_INTEGER);
  const out = [];
  const specifiers = [...bySpecifier.keys()].sort((a, b) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0));
  for (const specifier of specifiers) {
    const entries = [...bySpecifier.get(specifier).entries()].sort(byName);
    const named = (value) => entries
      .filter(([, e]) => e.form === 'named' && e.value === value)
      .map(([local, e]) => (e.imported === local ? local : `${e.imported} as ${local}`));
    const def = entries.find(([, e]) => e.form === 'default');
    const ns = entries.find(([, e]) => e.form === 'namespace');
    const valueNamed = named(true);
    const defValue = def && def[1].value ? def[0] : null;
    if (defValue && valueNamed.length > 0) out.push(`import ${defValue}, { ${valueNamed.join(', ')} } from '${specifier}';`);
    else if (defValue) out.push(`import ${defValue} from '${specifier}';`);
    else if (valueNamed.length > 0) out.push(namedStatement('import', valueNamed, ` from '${specifier}';`));
    if (def && !def[1].value) out.push(`import type ${def[0]} from '${specifier}';`);
    if (ns) out.push(`import ${ns[1].value ? '' : 'type '}* as ${ns[0]} from '${specifier}';`);
    const typeNamed = named(false);
    if (typeNamed.length > 0) out.push(namedStatement('import type', typeNamed, ` from '${specifier}';`));
  }
  const fromHost = new Map();
  for (const r of movers) {
    for (const [n, use] of r.moduleRefs) {
      const prev = fromHost.get(n);
      fromHost.set(n, { value: Boolean(prev && prev.value) || use.value });
    }
  }
  out.push(...importPair('./protocol.js', fromHost));
  return out;
}

/** `words` wrapped into ` * ` comment lines no wider than `width`. */
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

function moduleText(moduleFile, title, movers, scope) {
  const names = movers.map((r, i) => `\`${r.name}\`${i === movers.length - 1 ? '' : ','}`);
  const readsHostValues = movers.some((r) => [...r.moduleRefs.values()].some((u) => u.value));
  const out = [];
  out.push('// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.');
  out.push('');
  out.push('/**');
  out.push(...wrapComment([MARK, 'The', ...`"${title}"`.split(' '), 'section', 'of', `\`${CLASS_NAME}\`:`, 'the', 'bodies', 'of',
    ...names, 'moved', 'out', 'of', '`protocol.ts`', 'whole', 'by', '`scripts/codemod-split-protocol.mjs`.']));
  out.push(' *');
  out.push(' * A MOVE, not a redesign. Each function below is the body of the class method');
  out.push(' * of the same name as `packages/metadata-protocol/scripts/host-split.mjs` moves');
  out.push(' * one (ruling E, item E1): re-indented one level, with `this.<member>` read as');
  out.push(' * `host.<member>` and nothing else changed. Each method stays on the class');
  out.push(' * with its docblock and signature, which the published `.d.ts` prints, and');
  out.push(' * hands its body the host (`protocol-host.ts`); the docblock there is the');
  out.push(' * contract.');
  out.push(' *');
  if (readsHostValues) {
    out.push(' * Values that stayed in `protocol.ts` are imported from it (lever (a) of');
    out.push(' * ruling 6591753301); every use is inside a function body, so the import');
    out.push(' * cycle is never read at evaluation time. Nothing re-exports this module,');
    out.push(' * so the published surface does not move.');
  } else {
    out.push(' * What a body reads from elsewhere, it imports from where `protocol.ts`');
    out.push(' * imports it. Nothing re-exports this module, so the published surface does');
    out.push(' * not move.');
  }
  out.push(' */');
  out.push('');
  out.push(...importLines(scope, movers));
  for (const r of movers) {
    out.push('');
    out.push(r.fnText.replace(/\n$/, ''));
  }
  out.push('');
  return out.join('\n');
}

/**
 * The E1 stub body, carrying this script's marker. A private static's stub
 * hands its body no host: the body reads nothing of the class.
 */
function stubBody(name, moduleFile, m, isStatic = false) {
  const args = m.parameters.map((p) => (p.dotDotDotToken ? '...' : '') + p.name.getText());
  return '{\n'
    + (isStatic
      ? `        // ${MARK} The body moved to \`${moduleFile}\`; it reads nothing of this class.\n`
      : `        // ${MARK} The body moved to \`${moduleFile}\`; it reaches this class through \`${HOST_MODULE_BASENAME}\`.\n`)
    + `        return ${name}(${[...(isStatic ? [] : ['protocolHost(this)']), ...args].join(', ')});\n`
    + '    }';
}

/**
 * Apply a plan. Returns `{ host, hostModule, modules }`: the new `protocol.ts`,
 * the new `protocol-host.ts` and a Map of module basename -> text. Pure.
 */
function generate(T, text, hostText, planned) {
  const { hs } = T;
  const { sf, ctx, modules, hostExportsForSections } = planned;
  const { ts } = ctx;
  const edits = [];
  const importBlock = [];
  const entries = new Map();
  for (const [moduleFile, movers] of modules) {
    const title = movers[0].section;
    importBlock.push(`\n// ${MARK} ${title}: the methods of the same names below hand the bodies the host (\`${HOST_MODULE_BASENAME}\`).`);
    importBlock.push(`\n${namedStatement('import', movers.map((r) => r.name).sort(), ` from './${moduleFile.replace(/\.ts$/, '.js')}';`)}`);
    for (const r of movers) {
      edits.push({ start: r.stub.start, end: r.stub.end, text: stubBody(r.name, moduleFile, r.node, r.isStatic === true) });
      for (const [member, entry] of r.hostEntries) {
        const prev = entries.get(member);
        // A writable entry (a getter and a setter) wins over a readonly one.
        if (!prev || (entry.factory.includes('\n') && !prev.factory.includes('\n'))) entries.set(member, entry);
      }
    }
  }
  if (hostExportsForSections.size > 0) {
    const spelled = [...hostExportsForSections.keys()].sort().map((n) => (ctx.scope.bindings.get(n)?.typeDecl ? `type ${n}` : n));
    importBlock.push(`\n// ${MARK} Exported for the section modules above, which import them (lever (a)); \`index.ts\` re-exports by name, so none reaches the package.`);
    importBlock.push(`\n${namedStatement('export', spelled, ';')}`);
  }
  const imports = sf.statements.filter((s) => ts.isImportDeclaration(s));
  const lastImport = imports[imports.length - 1];
  if (!lastImport) refuse('protocol.ts has no import declaration to place the generated imports after');
  if (importBlock.length > 0) edits.push({ start: lastImport.getEnd(), end: lastImport.getEnd(), text: importBlock.join('') });
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Infinity;
  for (const e of edits) {
    if (e.end > floor) refuse('overlapping edits');
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    floor = e.start;
  }
  const sortedEntries = new Map([...entries].sort(byName));
  const inserted = hs.insertHostEntries(hostText, out, sortedEntries);
  // The imports only the moved bodies read are dropped (the package compiles
  // with `noUnusedLocals`); `verify` recomputes the same prune from the head.
  const pruned = pruneImports(ts, inserted.protocol, usedImportNames(ts, inserted.protocol));
  const moduleTexts = new Map();
  for (const [moduleFile, movers] of modules) moduleTexts.set(moduleFile, moduleText(moduleFile, movers[0].section, movers, ctx.scope));
  return { host: pruned.text, hostModule: inserted.host, modules: moduleTexts, pruned: pruned.removed };
}

// ── The facade layer (ruling 6624345766) ────────────────────────────────────
//
// (a)'s module form is lifted, text for text, into the facade form: each
// section module's functions become the static methods of one stateless facet
// class over the host (`export class <Facet>`; a method still takes the host
// as its first parameter, so the body is (a)'s body, re-indented back to the
// class's own depth); each stub on the class calls `<Facet>.<name>(…)`; and a
// PRIVATE member's docblock moves with its body (docblock ownership), the
// class keeping one line that links to it. A public member's docblock stays on
// the facade: consumers read it in the published `.d.ts`. State stays on the
// facade: a facet holds nothing, and reads the class's fields through the host.
//
// `unlift` is the exact inverse, read off the head alone: `verify` unlifts the
// head to (a)'s form, then proves (a) against the base as before, so the
// facade layer adds a proof of its own (the unlift must parse and match) and
// keeps every proof of (a), `host-split.mjs`'s `checkMove` included.

/** The facet class a section module declares, named by its file: `protocol-save.ts` -> `ProtocolSaveFacet`. */
function facetNameOf(moduleFile) {
  return `${moduleFile.replace(/\.ts$/, '').split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('')}Facet`;
}

/** The one line a private member keeps on the class once its docblock moved to its facet. */
const docStubOf = (facet, name, moduleFile) => `/** Docblock and body: {@link ${facet}.${name}} in \`${moduleFile}\` ${MARK}. */`;

/** Is this class member private (a `private` modifier or a `#name`)? */
const isPrivateMember = (ts, m) => hasModifier(ts, m, ts.SyntaxKind.PrivateKeyword) || Boolean(m.name && ts.isPrivateIdentifier(m.name));

/**
 * The docblock span `[start, end)` of a class member that docblock ownership
 * may move verbatim: its JSDoc blocks, contiguous (only whitespace between
 * them), starting at the member's own four-space depth, which is the depth a
 * facet's member has too. `null` when there is none, or it is not that shape.
 */
function movableDocSpan(ts, sf, m) {
  const docs = m.jsDoc ?? [];
  if (docs.length === 0) return null;
  const start = docs[0].getStart(sf);
  const end = docs[docs.length - 1].getEnd();
  const lineStart = sf.text.lastIndexOf('\n', start - 1) + 1;
  if (sf.text.slice(lineStart, start) !== '    ') return null;
  for (let i = 1; i < docs.length; i += 1) {
    if (sf.text.slice(docs[i - 1].getEnd(), docs[i].getStart(sf)).trim() !== '') return null;
  }
  return { start, end, text: sf.text.slice(start, end) };
}

/** The 0-based line indices of `text` (parsed as `prefix + text + suffix`) that start inside a string or template literal. */
function literalLinesOf(ts, text, prefix, suffix) {
  const whole = prefix + text + suffix;
  const sf = parseSourceFile('x.ts', whole);
  const starts = new Set();
  const visit = (node) => {
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isStringLiteral(node)) {
      for (let i = whole.indexOf('\n', node.getStart(sf)); i !== -1 && i < node.getEnd() - 1; i = whole.indexOf('\n', i + 1)) starts.add(i + 1 - prefix.length);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const out = new Set();
  let at = 0;
  text.split('\n').forEach((line, i) => {
    if (starts.has(at)) out.add(i);
    at += line.length + 1;
  });
  return out;
}

/** (a)'s exported function text (`export [async] function …`) as a facet's static method, at the class's depth. */
function liftFunction(ts, fnText) {
  if (!/^export (async )?function /.test(fnText)) refuse(`not a moved function: ${fnText.slice(0, 60)}`);
  const literal = literalLinesOf(ts, fnText, '', '');
  return fnText.split('\n').map((line, i) => {
    if (i === 0) return line.replace(/^export (async )?function /, (_, a) => `    static ${a ?? ''}`);
    return literal.has(i) || line === '' ? line : `    ${line}`;
  }).join('\n');
}

/** The inverse of `liftFunction`: a facet's static method text (from `static`) back to (a)'s function, or `null`. */
function unliftMethod(ts, methodText) {
  if (!/^static (async )?/.test(methodText)) return null;
  const literal = literalLinesOf(ts, methodText, 'class F {\n    ', '\n}');
  const lines = methodText.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === 0) out.push(line.replace(/^static (async )?/, (_, a) => `export ${a ?? ''}function `));
    else if (literal.has(i) || line === '') out.push(line);
    else if (line.startsWith('    ')) out.push(line.slice(4));
    else return null;
  }
  return out.join('\n');
}

/** A facet module's text: the header, (a)'s imports, and one class whose static methods are (a)'s functions. */
function facetModuleText(moduleFile, title, movers, scope, ownedDocs) {
  const facet = facetNameOf(moduleFile);
  const names = movers.map((r, i) => `\`${r.name}\`${i === movers.length - 1 ? '' : ','}`);
  const readsHostValues = movers.some((r) => [...r.moduleRefs.values()].some((u) => u.value));
  const out = [];
  out.push('// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.');
  out.push('');
  out.push('/**');
  out.push(...wrapComment([MARK, 'The', ...`"${title}"`.split(' '), 'facet', 'of', `\`${CLASS_NAME}\`:`, 'the', 'bodies', 'of',
    ...names, 'moved', 'out', 'of', '`protocol.ts`', 'whole', 'by', '`scripts/codemod-split-protocol.mjs`.']));
  out.push(' *');
  out.push(` * A MOVE, not a redesign. \`${facet}\` is a stateless facet over the host`);
  out.push(' * (ruling 6624345766): each static method below is the body of the class');
  out.push(' * member of the same name as `packages/metadata-protocol/scripts/host-split.mjs`');
  out.push(' * moves one (ruling E, item E1), with `this.<member>` read as `host.<member>`');
  out.push(' * and nothing else changed. The facet holds no state: the fields stay on the');
  out.push(' * class, and a body reaches them through the host (`protocol-host.ts`).');
  out.push(' *');
  out.push(' * The class keeps every member as a one-line delegation. A public member');
  out.push(' * keeps its docblock there, which the published `.d.ts` prints; a private');
  out.push(' * member\'s docblock moved here with its body (docblock ownership).');
  out.push(' *');
  if (readsHostValues) {
    out.push(' * Values that stayed in `protocol.ts` are imported from it (lever (a) of');
    out.push(' * ruling 6591753301); every use is inside a method body, so the import');
    out.push(' * cycle is never read at evaluation time. Nothing re-exports this module,');
    out.push(' * so the published surface does not move.');
  } else {
    out.push(' * What a body reads from elsewhere, it imports from where `protocol.ts`');
    out.push(' * imports it. Nothing re-exports this module, so the published surface does');
    out.push(' * not move.');
  }
  out.push(' */');
  out.push('');
  out.push(...importLines(scope, movers));
  out.push('');
  out.push(`export class ${facet} {`);
  movers.forEach((r, i) => {
    if (i > 0) out.push('');
    const nl = r.fnText.indexOf('\n');
    const fn = r.fnText.slice(nl + 1).replace(/\n$/, '');
    const owned = ownedDocs.get(r.name);
    out.push(`    ${owned ?? r.fnText.slice(0, nl)}`);
    out.push(liftFunction(globalTs, fn));
  });
  out.push('}');
  out.push('');
  return out.join('\n');
}

let globalTs = null;

/**
 * Lift (a)'s output (`generate`'s) to the facade form. Pure. Returns the same
 * shape as `generate`, plus `owned` (module -> member -> docblock moved) and the
 * further import bindings the class dropped once docblocks left it.
 */
function lift(T, a, planned) {
  const { ts } = T;
  globalTs = ts;
  const sf = parseSourceFile(HOST_PATH, a.host);
  const cls = T.hs.classOf(sf, CLASS_NAME);
  const marker = new RegExp(`^\\{\\s*// ${MARK.replace(/[[\]]/g, '\\$&')} The body moved to \`(protocol-[a-z0-9-]+\\.ts)\``);
  const edits = [];
  const owned = new Map();
  for (const m of cls.members) {
    if (!ts.isMethodDeclaration(m) || !m.body || !m.name || !ts.isIdentifier(m.name)) continue;
    const hit = marker.exec(m.body.getText(sf));
    if (!hit) continue;
    const file = hit[1];
    const facet = facetNameOf(file);
    const name = m.name.text;
    const ret = m.body.statements[m.body.statements.length - 1];
    if (!ret || !ts.isReturnStatement(ret) || !ret.expression || !ts.isCallExpression(ret.expression) || !ts.isIdentifier(ret.expression.expression) || ret.expression.expression.text !== name) {
      refuse(`${name}: its stub does not end in \`return ${name}(…)\``);
    }
    edits.push({ start: ret.expression.expression.getStart(sf), end: ret.expression.expression.getStart(sf), text: `${facet}.` });
    if (!isPrivateMember(ts, m)) continue;
    const span = movableDocSpan(ts, sf, m);
    if (!span) continue;
    if (!owned.has(file)) owned.set(file, new Map());
    owned.get(file).set(name, span.text);
    edits.push({ start: span.start, end: span.end, text: docStubOf(facet, name, file) });
  }
  // The generated import of each module's functions becomes the import of its facet.
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    const hit = /^\.\/(protocol-[a-z0-9-]+)\.js$/.exec(st.moduleSpecifier.text);
    if (!hit || !a.modules.has(`${hit[1]}.ts`)) continue;
    const file = `${hit[1]}.ts`;
    const lead = sf.text.slice(st.getFullStart(), st.getStart(sf));
    const title = new RegExp(`// ${MARK.replace(/[[\]]/g, '\\$&')} (.*): the methods of the same names below`).exec(lead)?.[1];
    if (!title) refuse(`the generated import of ${file} carries no section comment`);
    edits.push({
      start: st.getFullStart(), end: st.getEnd(),
      text: `\n// ${MARK} ${title}: the members below delegate to its facet, \`${facetNameOf(file)}\`.\nimport { ${facetNameOf(file)} } from './${hit[1]}.js';`,
    });
  }
  edits.sort((x, y) => y.start - x.start || y.end - x.end);
  let host = a.host;
  for (const e of edits) host = host.slice(0, e.start) + e.text + host.slice(e.end);
  const pruned = pruneImports(ts, host, usedImportNames(ts, host));
  const modules = new Map();
  for (const [moduleFile, movers] of planned.modules) {
    modules.set(moduleFile, facetModuleText(moduleFile, movers[0].section, movers, planned.ctx.scope, owned.get(moduleFile) ?? new Map()));
  }
  return { host: pruned.text, hostModule: a.hostModule, modules, owned, prunedByLift: pruned.removed };
}

/**
 * The inverse of `lift`, from the head texts alone: (a)'s `protocol.ts` and
 * modules, the docblocks to put back, and the failures met on the way.
 */
function unlift(T, headText, moduleTexts) {
  const { ts } = T;
  const failures = [];
  const modulesA = new Map();
  const facetDocs = new Map(); // file -> name -> { doc, owned }
  for (const [file, text] of moduleTexts) {
    if (!text.includes(MARK)) continue;
    const sf = parseSourceFile(join(SRC_DIR, file), text);
    const facet = facetNameOf(file);
    const imports = [];
    let cls = null;
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st)) imports.push(text.slice(st.getStart(sf), st.getEnd()));
      else if (ts.isClassDeclaration(st) && st.name?.text === facet && hasModifier(ts, st, ts.SyntaxKind.ExportKeyword) && !cls) cls = st;
      else failures.push(`${file}: a top-level statement that is neither an import nor the facet class ${facet}: ${st.getText(sf).slice(0, 60)}`);
    }
    if (!cls) { failures.push(`${file}: no exported class ${facet}`); continue; }
    if (cls.heritageClauses?.length || cls.typeParameters?.length || (ts.getModifiers(cls) ?? []).length !== 1) failures.push(`${file}: ${facet} is not a plain exported class`);
    const docs = new Map();
    const fns = [];
    for (const m of cls.members) {
      const name = m.name && ts.isIdentifier(m.name) ? m.name.text : '?';
      if (!ts.isMethodDeclaration(m) || !m.body || !hasModifier(ts, m, ts.SyntaxKind.StaticKeyword) || name === '?') {
        failures.push(`${file}: ${facet} has a member that is not a static method with a body (${name})`);
        continue;
      }
      const span = movableDocSpan(ts, sf, m);
      if (!span) { failures.push(`${file}: ${facet}.${name} carries no docblock at the class's depth`); continue; }
      const methodText = text.slice(m.getStart(sf), m.getEnd());
      const fnText = unliftMethod(ts, methodText);
      if (fnText === null) { failures.push(`${file}: ${facet}.${name} does not unlift (its indentation is not the lift's)`); continue; }
      const oneLiner = [instanceOneLiner(name), staticOneLiner(name)].find((l) => l === span.text);
      docs.set(name, { doc: span.text, owned: !oneLiner });
      fns.push({ name, fnText, oneLiner });
    }
    facetDocs.set(file, docs);
    modulesA.set(file, { imports, fns });
  }

  const sf = parseSourceFile(HOST_PATH, headText);
  const cls = T.hs.classOf(sf, CLASS_NAME);
  const edits = [];
  const restoredDocs = [];
  const marker = new RegExp(`^\\{\\s*// ${MARK.replace(/[[\]]/g, '\\$&')} The body moved to \`(protocol-[a-z0-9-]+\\.ts)\``);
  const staticNames = new Set();
  for (const m of cls?.members ?? []) {
    if (!ts.isMethodDeclaration(m) || !m.body || !m.name || !ts.isIdentifier(m.name)) continue;
    const hit = marker.exec(m.body.getText(sf));
    if (!hit) continue;
    const file = hit[1];
    const facet = facetNameOf(file);
    const name = m.name.text;
    if (hasModifier(ts, m, ts.SyntaxKind.StaticKeyword)) staticNames.add(`${file}:${name}`);
    const ret = m.body.statements[m.body.statements.length - 1];
    const callee = ret && ts.isReturnStatement(ret) && ret.expression && ts.isCallExpression(ret.expression) ? ret.expression.expression : null;
    if (!callee || !ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression) || callee.expression.text !== facet || callee.name.text !== name) {
      failures.push(`${name}: its stub does not call \`${facet}.${name}(…)\``);
      continue;
    }
    edits.push({ start: callee.getStart(sf), end: callee.name.getStart(sf), text: '' });
    const fd = facetDocs.get(file)?.get(name);
    const span = movableDocSpan(ts, sf, m);
    const carriesStub = Boolean(span && span.text === docStubOf(facet, name, file));
    if (!fd) continue; // `verify` names the stub whose function is missing
    if (fd.owned && !carriesStub) failures.push(`${name}: ${facet}.${name} carries a docblock, but the class does not keep the one-line link in its place`);
    if (!fd.owned && carriesStub) failures.push(`${name}: the class links to a docblock ${facet}.${name} does not carry`);
    if (fd.owned && !isPrivateMember(ts, m)) failures.push(`${name}: a public member's docblock moved off the class (it must stay on the facade)`);
    if (fd.owned && carriesStub) {
      edits.push({ start: span.start, end: span.end, text: fd.doc });
      restoredDocs.push(fd.doc);
    }
  }
  edits.sort((x, y) => y.start - x.start || y.end - x.end);
  let headA = headText;
  for (const e of edits) headA = headA.slice(0, e.start) + e.text + headA.slice(e.end);

  const out = new Map();
  for (const [file, { imports, fns }] of modulesA) {
    const parts = [`// ${MARK} (unlifted)`, ...imports];
    for (const f of fns) {
      const oneLiner = staticNames.has(`${file}:${f.name}`) ? staticOneLiner(f.name) : instanceOneLiner(f.name);
      if (f.oneLiner && f.oneLiner !== oneLiner) failures.push(`${file}: ${f.name}'s one-line docblock does not match its member's kind`);
      parts.push('', `${oneLiner}\n${f.fnText}`);
    }
    out.set(file, `${parts.join('\n')}\n`);
  }
  return { headA, modulesA: out, restoredDocs, failures };
}

/** The facade proof: unlift the head, then prove (a) against the base as before. */
function verifyFacade(T, baseText, headText, baseHostText, headHostText, moduleTexts) {
  const u = unlift(T, headText, moduleTexts);
  const v = verify(T, baseText, u.headA, baseHostText, headHostText, u.modulesA, { usedFrom: headText, alsoRead: u.restoredDocs.join('\n') });
  return { ...v, failures: [...u.failures, ...v.failures], linesAfter: lineCount(headText), docsMoved: u.restoredDocs.length };
}

/**
 * The import bindings of a `protocol.ts` that something outside its import
 * declarations reads: a reference in code or a type, a local `export { … }`,
 * or a JSDoc `{@link X}` / `@see X` name. Those JSDoc names count because the
 * compiler's `noUnusedLocals` counts them; other JSDoc text and `//` comments
 * do not.
 */
function usedImportNames(ts, text) {
  const { sf, checker } = program(ts, HOST_PATH, text);
  const used = new Set();
  const isImportDecl = (d) => d.getSourceFile() === sf && (ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d));
  const leftmost = (name) => {
    let n = name;
    while (n && (ts.isQualifiedName(n) || ts.isPropertyAccessExpression(n))) n = ts.isQualifiedName(n) ? n.left : n.expression;
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
    if (ts.isIdentifier(node) && !inJsDoc(ts, node)) {
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
function pruneImports(ts, text, used) {
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
        edits.push({ start: nb.getStart(sf), end: nb.getEnd(), text: one ? `{ ${parts.join(', ')} }` : `{\n${parts.map((x) => `    ${x},`).join('\n')}\n}` });
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

// ── The proof ────────────────────────────────────────────────────────────────

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Drop the keyed groups whose key `keep` lacks from a host block; every other byte stays. */
function dropHostGroups(text, openMarker, closeMarker, keyOf, keep, isContinuation) {
  const open = text.indexOf(openMarker);
  const close = text.indexOf(closeMarker, open);
  if (open < 0 || close < 0) return { text, dropped: [], missing: true };
  const block = text.slice(open + openMarker.length, close);
  const lines = block.split('\n');
  const outLines = [];
  const dropped = [];
  let dropping = false;
  for (const l of lines) {
    const k = keyOf(l);
    if (k !== undefined) {
      dropping = !keep.has(k);
      if (dropping) dropped.push(k);
    } else if (!(dropping && isContinuation(l))) {
      dropping = false;
    }
    if (!dropping) outLines.push(l);
  }
  return { text: text.slice(0, open + openMarker.length) + outLines.join('\n') + text.slice(close), dropped, missing: false };
}

/**
 * Prove a split against its base, from the texts alone (it shares no state with
 * `generate`). Returns `{ failures, moved, checks, linesBefore, linesAfter }`;
 * no failure = proved.
 */
function verify(T, baseText, headText, baseHostText, headHostText, moduleTexts, { usedFrom = headText, alsoRead = '' } = {}) {
  const { ts, hs } = T;
  const failures = [];
  const moved = [];
  const checks = [];
  const baseSf = parseSourceFile(HOST_PATH, baseText);
  const headSf = parseSourceFile(HOST_PATH, headText);
  const baseCls = hs.classOf(baseSf, CLASS_NAME);
  const headCls = hs.classOf(headSf, CLASS_NAME);
  if (!baseCls || !headCls) return { failures: [`no class ${CLASS_NAME} at base or head`], moved, checks, linesBefore: 0, linesAfter: 0 };
  const table = hs.memberTable(headCls);
  const privateStatics = new Set([...table.statics].filter(([, s]) => s.private).map(([n]) => n));

  const modules = new Map();
  for (const [file, text] of moduleTexts) {
    if (!text.includes(MARK)) continue;
    const sf = parseSourceFile(join(SRC_DIR, file), text);
    const fns = new Map();
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name && st.body && hasModifier(ts, st, ts.SyntaxKind.ExportKeyword)) fns.set(st.name.text, st);
      else if (!ts.isImportDeclaration(st)) failures.push(`${file}: a top-level statement that is neither an import nor a moved function: ${st.getText(sf).slice(0, 60)}`);
    }
    modules.set(file, { sf, text, fns, claimed: new Set() });
  }

  const marker = new RegExp(`^\\{\\s*// ${MARK.replace(/[[\]]/g, '\\$&')} The body moved to \`(protocol-[a-z0-9-]+\\.ts)\``);
  const edits = [];
  for (const m of headCls.members) {
    if (!ts.isMethodDeclaration(m) || !m.body || !m.name || !ts.isIdentifier(m.name)) continue;
    const hit = marker.exec(m.body.getText(headSf));
    if (!hit) continue;
    const name = m.name.text;
    const mod = modules.get(hit[1]);
    const fn = mod && mod.fns.get(name);
    if (!fn) { failures.push(`${name}: its stub names ${hit[1]}, which has no exported function ${name}`); continue; }
    mod.claimed.add(name);
    const isStatic = hasModifier(ts, m, ts.SyntaxKind.StaticKeyword);
    const base = isStatic
      ? baseCls.members.find((b) => ts.isMethodDeclaration(b) && b.body && hasModifier(ts, b, ts.SyntaxKind.StaticKeyword) && b.name && ts.isIdentifier(b.name) && b.name.text === name)
      : hs.methodOf(baseCls, name);
    if (!base) { failures.push(`${name}: no ${isStatic ? 'static ' : ''}method of that name with a body at base`); continue; }
    if (isStatic) {
      // `host-split.mjs`'s check reads instance methods only; a static's
      // docblock, modifiers, signature and stub are compared here.
      const sig = (sf, x) => sf.text.slice(x.getFullStart(), x.body.getStart(sf));
      if (sig(baseSf, base) !== sig(headSf, m)) failures.push(`${name}: the static's docblock, modifiers or signature changed`);
      if (m.body.getText(headSf) !== stubBody(name, hit[1], base, true)) failures.push(`${name}: the static's body is not its stub`);
      if (fn.parameters.map((p) => p.getText(mod.sf)).join(', ') !== base.parameters.map((p) => p.getText(baseSf)).join(', ')) failures.push(`${name}: the moved static's parameters are not the method's own`);
    }
    const movedBody = mod.text.slice(fn.body.getStart(mod.sf), fn.body.getEnd());
    const restored = undoBody(ts, movedBody, privateStatics);
    const baseBody = baseText.slice(base.body.getStart(baseSf), base.body.getEnd());
    const identical = restored === baseBody;
    if (!identical) failures.push(`${name}: its moved body, rewrites and re-indentation undone, is not the base body`);
    moved.push({ name, module: hit[1], isStatic, bodySha: sha256(restored), baseBodySha: sha256(baseBody), lines: baseBody.split('\n').length, identical, restored });
    edits.push({ start: m.body.getStart(headSf), end: m.body.getEnd(), text: restored });
  }
  for (const [file, mod] of modules) {
    for (const name of mod.fns.keys()) if (!mod.claimed.has(name)) failures.push(`${file}: function ${name} has no stub on the class`);
  }
  const generatedSpecifier = (spec) => {
    const hit = /^\.\/(protocol-[a-z0-9-]+)\.js$/.exec(spec ?? '');
    return Boolean(hit && modules.has(`${hit[1]}.ts`));
  };
  for (const st of headSf.statements) {
    const drop = (ts.isImportDeclaration(st) && generatedSpecifier(st.moduleSpecifier.text))
      || (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.getFullText(headSf).includes(MARK));
    if (drop) edits.push({ start: st.getFullStart(), end: st.getEnd(), text: '' });
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let rebuilt = headText;
  for (const e of edits) rebuilt = rebuilt.slice(0, e.start) + e.text + rebuilt.slice(e.end);

  // The host entries the base did not carry: the one fact read off the base.
  const baseFactory = hostBlockKeys(baseText, FACTORY_OPEN, FACTORY_CLOSE, factoryKey);
  const baseIface = hostBlockKeys(baseHostText, IFACE_OPEN, IFACE_CLOSE, ifaceKey);
  if (!baseFactory || !baseIface) failures.push('the base carries no host factory or no ProtocolHost interface');
  else {
    const factoryContinuation = (l) => /^ {12}set /.test(l);
    const f = dropHostGroups(rebuilt, FACTORY_OPEN, FACTORY_CLOSE, factoryKey, baseFactory.keys, factoryContinuation);
    if (f.missing) failures.push('protocol.ts at head carries no host factory');
    rebuilt = f.text;
    const i = dropHostGroups(headHostText, IFACE_OPEN, IFACE_CLOSE, ifaceKey, baseIface.keys, () => false);
    if (i.missing) failures.push(`${HOST_MODULE_BASENAME} at head carries no ProtocolHost interface`);
    if (i.text !== baseHostText) failures.push(`undoing the split does not rebuild the base ${HOST_MODULE_BASENAME}: first difference at line ${firstDiff(i.text, baseHostText)}`);
    if (JSON.stringify([...f.dropped].sort()) !== JSON.stringify([...i.dropped].sort())) {
      failures.push(`the factory and the interface gained different entries: factory ${f.dropped.length}, interface ${i.dropped.length}`);
    }
  }
  // The one edit the undo does not reverse by reading the head: the imports
  // only the moved bodies read. It is recomputed from the head (what does the
  // head still read?) and applied to the base; the rest must then be equal.
  const prune = pruneImports(ts, baseText, usedImportNames(ts, usedFrom));
  const restoredBodies = `${moved.map((r) => r.restored).join('\n')}\n${alsoRead}`;
  for (const n of prune.removed) {
    if (!new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(restoredBodies)) failures.push(`the head dropped the import \`${n}\`, which no moved body reads`);
  }
  if (rebuilt !== prune.text) {
    const at = firstDiff(rebuilt, prune.text);
    failures.push(`undoing the split does not rebuild the base protocol.ts (its unread imports pruned): first difference at line ${at}` +
      `\n    rebuilt: ${JSON.stringify(rebuilt.split('\n')[at - 1] ?? '<end>')}\n    base:    ${JSON.stringify(prune.text.split('\n')[at - 1] ?? '<end>')}`);
  }

  // The hand series' own check, member by member.
  for (const r of moved) {
    if (r.isStatic) continue;
    const c = hs.checkMove({ baseSource: baseText, headSource: headText, moduleSource: modules.get(r.module).text, moduleFile: r.module, member: r.name, className: CLASS_NAME });
    checks.push({ name: r.name, ok: c.ok, counts: c.counts, textIdentical: c.textIdentical });
    for (const p of c.problems) failures.push(`host-split check ${r.name}: ${p}`);
  }
  if (moved.length === 0) failures.push('no moved method found: a proof over nothing is not a proof');
  return { failures, moved, checks, pruned: prune.removed, linesBefore: lineCount(baseText), linesAfter: lineCount(headText) };
}

function firstDiff(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  let i = 0;
  while (i < Math.max(x.length, y.length) && x[i] === y[i]) i += 1;
  return i + 1;
}

/** Lines as `wc -l` counts them: newline characters. */
function lineCount(text) {
  return text.split('\n').length - 1;
}

// ── Reports ──────────────────────────────────────────────────────────────────

/**
 * The facade reading the #30019 gate starts from: every member of the class
 * with a body, as a delegation (to a facet, or the hand series' own form) or a
 * named exception with the reason it stayed.
 */
function facadeReport(T, out, planned) {
  const { ts, hs } = T;
  const sf = parseSourceFile(HOST_PATH, out.host);
  const cls = hs.classOf(sf, CLASS_NAME);
  const why = new Map(planned.records.map((r) => [`${r.isStatic ? 'static ' : ''}${r.name}`, r.reasons]));
  const counts = { facet: 0, hand: new Map(), exceptions: [] };
  for (const m of cls.members) {
    const isStatic = hasModifier(ts, m, ts.SyntaxKind.StaticKeyword);
    const label = m.name ? `${isStatic ? 'static ' : ''}${m.name.getText(sf)}` : ts.isConstructorDeclaration(m) ? 'constructor' : ts.isClassStaticBlockDeclaration(m) ? 'static block' : ts.SyntaxKind[m.kind];
    const lines = sf.getLineAndCharacterOfPosition(m.getEnd()).line - sf.getLineAndCharacterOfPosition(m.getStart(sf)).line + 1;
    if (ts.isMethodDeclaration(m) && m.body) {
      if (m.body.getText(sf).includes(MARK)) { counts.facet += 1; continue; }
      const kind = hs.stubKindOf(m);
      if (kind) { counts.hand.set(kind, (counts.hand.get(kind) ?? 0) + 1); continue; }
      counts.exceptions.push(`${label} (${lines} lines): ${(why.get(label) ?? ['?']).map((r) => r.split(':')[0]).filter((r, i, a) => a.indexOf(r) === i).join(', ')}`);
    } else if (ts.isConstructorDeclaration(m) || ts.isClassStaticBlockDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
      counts.exceptions.push(`${label} (${lines} lines): ${ts.isClassStaticBlockDeclaration(m) ? 'the host factory (protocol-host.ts reads it)' : 'not a method'}`);
    }
  }
  const facets = [...out.modules.keys()].map((f) => `${facetNameOf(f)} (${f}, ${planned.modules.get(f).length} members, ${[...(out.owned.get(f)?.keys() ?? [])].length} docblocks moved)`);
  return [
    `facade: ${lineCount(out.host)} lines; ${counts.facet} member(s) delegate to ${facets.length} facet(s); ` +
      `${[...counts.hand.values()].reduce((a, b) => a + b, 0)} hand-series delegation(s) (${[...counts.hand].map(([k, n]) => `${k} ${n}`).join(', ')}); ` +
      `${counts.exceptions.length} member(s) with a body stay as named exceptions`,
    ...facets.map((f) => `  facet  ${f}`),
    ...counts.exceptions.map((e) => `  stays  ${e}`),
    `further import binding(s) the class dropped once docblocks left it: ${out.prunedByLift.length} (${out.prunedByLift.join(', ') || 'none'})`,
  ].join('\n');
}

function planReport(planned) {
  const out = [];
  const bySection = new Map();
  for (const r of planned.records) {
    if (!bySection.has(r.section)) bySection.set(r.section, []);
    bySection.get(r.section).push(r);
  }
  let movedMethods = 0;
  let movedLines = 0;
  let stubLinesIn = 0;
  const reasonCounts = new Map();
  for (const [section, rs] of bySection) {
    const movers = rs.filter((r) => r.reasons.length === 0);
    const lines = movers.reduce((n, r) => n + r.bodyLines, 0);
    const stubs = movers.reduce((n, r) => n + r.stubLines, 0);
    movedMethods += movers.length;
    movedLines += lines;
    stubLinesIn += stubs;
    out.push(`§ ${section} -> ${rs[0].module ?? '(stays)'}: ${movers.length}/${rs.length} methods move (${lines} body lines out, ${stubs} stub lines in)`);
    for (const r of rs) {
      if (r.reasons.length === 0) out.push(`    move  ${r.name} (body ${r.bodyLines} -> stub ${r.stubLines})`);
      else if (!r.reasons.every((x) => x.startsWith('already-moved') || x === 'section-kept')) out.push(`    stay  ${r.name} (${r.lineCount}) — ${r.reasons.join('; ')}`);
      for (const reason of r.reasons) {
        const code = reason.split(':')[0];
        reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);
      }
    }
  }
  out.push('');
  out.push(`total: ${movedMethods}/${planned.records.length} instance methods with a body move into ${planned.modules.size} module(s): ` +
    `${movedLines} body lines out, ${stubLinesIn} stub lines in`);
  out.push(`stay reasons (a method may carry several): ${[...reasonCounts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([c, n]) => `${c} ${n}`).join(', ')}`);
  out.push(`lever (a): ${planned.hostExportsForSections.size} staying name(s) exported for the section modules` +
    `${planned.hostExportsForSections.size ? ` (${[...planned.hostExportsForSections.keys()].sort().join(', ')})` : ''}`);
  out.push(`lever (b): the statements ahead of the class, imports aside: ${planned.before.length} (${planned.before.join(', ') || 'none'}); no top-level declaration to move`);
  return out.join('\n');
}

function treeHash(files) {
  const h = createHash('sha256');
  for (const [name, text] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) h.update(`${name}\0${sha256(text)}\n`);
  return h.digest('hex');
}

function printVerify(v) {
  for (const f of v.failures) console.error(`  ✗ ${f}`);
  const identical = v.moved.filter((m) => m.identical).length;
  const checked = v.checks.filter((c) => c.ok).length;
  const rewrites = v.checks.reduce((a, c) => ({
    member: a.member + (c.counts?.member ?? 0), privateStatic: a.privateStatic + (c.counts?.privateStatic ?? 0), constructor: a.constructor + (c.counts?.constructor ?? 0),
  }), { member: 0, privateStatic: 0, constructor: 0 });
  const undone = !v.failures.some((f) => f.startsWith('undoing'));
  console.log(`byte-identity: ${identical}/${v.moved.length} moved bodies restore to the base body exactly; ` +
    `host-split check: ${checked}/${v.checks.length} pass (rewrites: ${rewrites.member} member, ${rewrites.privateStatic} private static, ${rewrites.constructor} constructor); ` +
    `protocol.ts ${v.linesBefore} -> ${v.linesAfter} lines; undoing the split ${undone ? 'does' : 'does NOT'} rebuild the base protocol.ts and ${HOST_MODULE_BASENAME} byte-for-byte, ` +
    `once the ${v.pruned?.length ?? 0} import binding(s) only moved bodies read are pruned from the base (${(v.pruned ?? []).join(', ') || 'none'})`);
}

function gitShow(ref, path) {
  return execFileSync('git', ['show', `${ref}:${path}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
}

function generatedModulesOnDisk() {
  const out = new Map();
  for (const [, , file] of SECTION_ANCHORS) {
    if (!file) continue;
    const p = join(SRC_DIR, file);
    if (existsSync(p)) out.set(file, readFileSync(p, 'utf8'));
  }
  return out;
}

// ── The members pass: one member of the landed facade (#30518) ──────────────
//
// The first pass runs on an unsplit `protocol.ts` only, and `main` has been
// split since #29985 (48914fdc), so it refuses its own output; and since the
// facet modules have been edited by hand after the split, `--verify` against
// the split's base no longer re-proves. A method a stay rule held when `main`
// was split (a return type since spelled, #30054) is moved by THIS pass
// instead, on the split file: `--members a,b` names the methods, and each goes
// exactly as the first pass would have taken it (`plan`'s stay rules, which
// read the split file as they read an unsplit one; any reason refuses, and the
// pass names what it moves, never decides it). The stub, the host entries,
// the facet member and the docblock rule are the first pass's (`planMove`,
// `insertHostEntries`, `liftFunction`, docblock ownership), and the member goes
// into the facet of its section, in class order. Only instance methods move:
// a private static's facet stub is not a hand-series stub `plan` recognises.
//
// What it grows, and the hand edits it accepts (the rule #30572 sets for the
// `engine.ts` pass's `--members`): the receiving module's header gains the
// name in its generated first paragraph, re-wrapped, and every paragraph a
// hand wrote after it is left as it stands; the module's import block gains
// the bindings the moved body reads, each from where `protocol.ts` imports it,
// by element (into a declaration of that specifier and kind, keeping its own
// layout) or as a new declaration, and every import a hand wrote stays where it
// is. Hand-written facet members and top-level declarations stay too. It
// refuses (exit 2) a module whose first paragraph is not the generated one, a
// facet `protocol.ts` does not already import (it never starts a facet), a
// body that reads a top-level name of `protocol.ts` the generated export list
// does not already export (it never widens it), and a binding the module
// already holds under another source or kind.
//
// The proof (`--members --verify --base REF` re-runs it) is the undo against
// the pre-move tree, not the split's base: from the head alone each moved body
// (rewrites and re-indentation undone) and owned docblock goes back onto its
// stub; each receiving module loses the moved members (with the one blank line
// the move wrote), their names in its header, and the import bindings nothing
// in it reads any more, element by element; the factory and the interface lose
// the entries the base host did not carry (the one fact read off the base, as
// the first pass's proof reads it). The result must be the base `protocol.ts`
// (its import bindings only moved bodies read pruned, as the first pass prunes
// them), `protocol-host.ts` and receiving modules byte for byte, every other
// section module unchanged, each facet member its base method's text as the
// first pass would lift it, and `host-split.mjs`'s `checkMove` must pass on the
// unlifted pair: two independent proofs of each move.

const MEMBERS_CARD = '#30518';

const lineStartOf = (text, pos) => text.lastIndexOf('\n', pos - 1) + 1;

/** Apply non-overlapping `{ start, end, text }` edits; insertions at one offset land in the order given. */
function applyEdits(text, edits) {
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

/** The lifted stub: the E1 stub, calling the member's facet. */
const facetStubBody = (name, moduleFile, m) => stubBody(name, moduleFile, m)
  .replace(`        return ${name}(`, `        return ${facetNameOf(moduleFile)}.${name}(`);

/** A facet member's text, from its line start: its docblock (owned, or the one-liner) and the lifted body. */
function facetMemberText(ts, fnText, ownedDoc) {
  const nl = fnText.indexOf('\n');
  return `    ${ownedDoc ?? fnText.slice(0, nl)}\n${liftFunction(ts, fnText.slice(nl + 1).replace(/\n$/, ''))}`;
}

const FILE_LEAD = '// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.\n\n/**\n';

/** The words of a facet module's generated first paragraph (`facetModuleText`). */
const headerWords = (title, names) => [MARK, 'The', ...`"${title}"`.split(' '), 'facet', 'of', `\`${CLASS_NAME}\`:`, 'the', 'bodies', 'of',
  ...names.map((n, i) => `\`${n}\`${i === names.length - 1 ? '' : ','}`), 'moved', 'out', 'of', '`protocol.ts`', 'whole', 'by', '`scripts/codemod-split-protocol.mjs`.'];

/**
 * The names a facet module's generated first paragraph lists, read back, and
 * the paragraph's region; null unless that paragraph is exactly the one the
 * first pass writes for them. The paragraphs after it are not read.
 */
function headerNamesOf(text, title) {
  if (!text.startsWith(FILE_LEAD)) return null;
  const start = FILE_LEAD.length;
  const end = text.indexOf('\n *\n', start);
  if (end < 0) return null;
  const prose = text.slice(start, end).split('\n').map((l) => l.replace(/^ \*( |$)/, '')).join(' ');
  const i = prose.indexOf(' the bodies of ');
  const j = prose.lastIndexOf(' moved out of ');
  if (i < 0 || j < i) return null;
  const names = [...prose.slice(i, j).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  return wrapComment(headerWords(title, names)).join('\n') === text.slice(start, end) ? { start, end, names } : null;
}

/** A facet module's facet class and its members, each `{ name, node, start (its docblock's line start), end, staticMethod }`. */
function facetOf(ts, file, text) {
  const sf = parseSourceFile(join(SRC_DIR, file), text);
  const facet = facetNameOf(file);
  const cls = sf.statements.find((st) => ts.isClassDeclaration(st) && st.name?.text === facet && hasModifier(ts, st, ts.SyntaxKind.ExportKeyword));
  if (!cls) return null;
  const members = cls.members.map((m) => {
    const docs = m.jsDoc ?? [];
    return {
      name: m.name && ts.isIdentifier(m.name) ? m.name.text : null,
      node: m,
      start: lineStartOf(text, docs.length ? docs[0].getStart(sf) : m.getStart(sf)),
      end: m.getEnd(),
      staticMethod: ts.isMethodDeclaration(m) && hasModifier(ts, m, ts.SyntaxKind.StaticKeyword) && Boolean(m.body),
    };
  });
  return { sf, cls, members };
}

/** The keys a facet member's host parameter `Pick`s, or null when it is not `host: Pick<ProtocolHost, …>`. */
function picksOf(text, member) {
  const p = member.node.parameters?.[0];
  if (!p) return null;
  const m = /^host: Pick<ProtocolHost, (.+)>$/s.exec(text.slice(p.getStart(member.node.getSourceFile()), p.getEnd()));
  return m ? m[1].split('|').map((q) => q.trim().slice(1, -1)) : null;
}

/** A module's import declarations, each with its named elements and the names it binds. */
function importDeclsOf(ts, file, text) {
  const sf = parseSourceFile(join(SRC_DIR, file), text);
  const decls = [];
  const locals = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) {
      const names = [];
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) collectBindingNames(ts, d.name, names);
      else if (st.name && ts.isIdentifier(st.name)) names.push(st.name.text);
      for (const n of names) locals.add(n);
      continue;
    }
    const clause = st.importClause;
    const nb = clause?.namedBindings;
    decls.push({
      st, sf,
      specifier: st.moduleSpecifier.text,
      start: st.getStart(sf),
      end: st.getEnd(),
      typeOnly: Boolean(clause?.isTypeOnly),
      defaultName: clause?.name?.text ?? null,
      nsName: nb && ts.isNamespaceImport(nb) ? nb.name.text : null,
      nb: nb && ts.isNamedImports(nb) ? nb : null,
      named: nb && ts.isNamedImports(nb) ? nb.elements.map((e) => ({
        local: e.name.text, imported: (e.propertyName ?? e.name).text, typeOnly: Boolean(e.isTypeOnly), start: e.getStart(sf), end: e.getEnd(), text: e.getText(sf),
      })) : [],
    });
  }
  return { decls, locals };
}

/**
 * Give a facet module the import bindings `wanted` (local -> `{ specifier,
 * form, imported, value }`) it does not hold. A binding it already holds from
 * that specifier, under that name and of a kind that serves the use, is left
 * as it is; any other holder of the name refuses. A named binding goes into
 * the first declaration of its specifier and kind, as one more element in that
 * declaration's own layout (sorted in when its elements are sorted, last
 * otherwise; one line stays one line within 120 columns), else into a new
 * declaration: before `ProtocolHost`'s import, or, for `./protocol.js`, after
 * the last import. New declarations go in `order` (`protocol.ts`'s import
 * order), a specifier's values before its types, as the first pass writes
 * them. Pure.
 */
function addModuleImports(ts, file, text, wanted, order = () => 0) {
  const { decls, locals } = importDeclsOf(ts, file, text);
  const edits = [];
  const fresh = new Map(); // `${specifier}\0${value}` -> [local]
  for (const [local, w] of [...wanted].sort(byName)) {
    const held = decls.flatMap((d) => [
      ...(d.defaultName === local ? [{ form: 'default', imported: 'default', value: !d.typeOnly, d }] : []),
      ...(d.nsName === local ? [{ form: 'namespace', imported: '*', value: !d.typeOnly, d }] : []),
      ...d.named.filter((e) => e.local === local).map((e) => ({ form: 'named', imported: e.imported, value: !d.typeOnly && !e.typeOnly, d })),
    ]);
    if (locals.has(local)) refuse(`${file}: ${local}, which the moved body imports, is declared in the module itself`);
    if (held.length > 1) refuse(`${file}: binds ${local} more than once`);
    if (held.length === 1) {
      const h = held[0];
      if (h.d.specifier !== w.specifier || h.form !== w.form || (w.form === 'named' && h.imported !== w.imported)) {
        refuse(`${file}: binds ${local} from ${h.d.specifier}, and the moved body reads it from ${w.specifier}`);
      }
      if (w.value && !h.value) refuse(`${file}: imports ${local} as a type only, and the moved body reads it as a value`);
      continue;
    }
    if (w.form !== 'named') refuse(`${file}: ${local} would be a ${w.form} import, which this pass does not write`);
    const key = `${w.specifier}\0${w.value}`;
    fresh.set(key, [...(fresh.get(key) ?? []), { local, imported: w.imported }]);
  }
  const host = decls.find((d) => d.specifier === './protocol-host.js');
  const last = decls.at(-1);
  if (!last) refuse(`${file}: has no import declaration`);
  const ranked = [...fresh].map(([key, adds]) => { const [specifier, v] = key.split('\0'); return { specifier, value: v === 'true', adds }; })
    .sort((a, b) => order(a.specifier) - order(b.specifier) || Number(b.value) - Number(a.value) || (a.specifier < b.specifier ? -1 : a.specifier > b.specifier ? 1 : 0));
  for (const { specifier, value, adds } of ranked) {
    const spell = (a) => (a.imported === a.local ? a.local : `${a.imported} as ${a.local}`);
    const d = decls.find((x) => x.specifier === specifier && x.nb && !x.defaultName && x.typeOnly === !value && x.named.every((e) => !e.typeOnly));
    if (d) {
      const els = d.named;
      const sorted = els.map((e) => e.local).join() === els.map((e) => e.local).sort().join();
      const multi = d.nb.getText(d.sf).includes('\n');
      const lineOf = (e) => text.slice(lineStartOf(text, e.start), text.indexOf('\n', e.end));
      const canonicalMulti = multi && els.every((e) => lineOf(e) === `    ${e.text},`);
      const at = (a) => (sorted ? els.findIndex((e) => e.local > a.local) : -1);
      if (multi && canonicalMulti) {
        for (const a of adds) {
          const k = at(a);
          const pos = k < 0 ? text.indexOf('\n', els.at(-1).end) + 1 : lineStartOf(text, els[k].start);
          edits.push({ start: pos, end: pos, text: `    ${spell(a)},\n` });
        }
        continue;
      }
      if (!multi) {
        const grown = d.st.getText(d.sf).length + adds.reduce((n, a) => n + spell(a).length + 2, 0);
        if (grown <= 120) {
          for (const a of adds) {
            const k = at(a);
            if (k < 0) edits.push({ start: els.at(-1).end, end: els.at(-1).end, text: `, ${spell(a)}` });
            else edits.push({ start: els[k].start, end: els[k].start, text: `${spell(a)}, ` });
          }
          continue;
        }
      }
    }
    const statement = namedStatement(value ? 'import' : 'import type', adds.map(spell).sort(), ` from '${specifier}';`);
    if (specifier !== './protocol.js' && host) edits.push({ start: host.start, end: host.start, text: `${statement}\n` });
    else edits.push({ start: last.end, end: last.end, text: `\n${statement}` });
  }
  return applyEdits(text, edits);
}

/**
 * Drop the import bindings nothing in a module reads, each by itself: a
 * declaration left with none goes whole (with its line break), a named
 * element goes with its separator (its own line, in a one-per-line list), and
 * every other byte stays. The inverse of `addModuleImports` on a module whose
 * own imports are all read. Pure.
 */
function pruneModuleImports(ts, file, text) {
  const used = usedImportNames(ts, text);
  const { decls } = importDeclsOf(ts, file, text);
  const edits = [];
  for (const d of decls) {
    const names = [d.defaultName, d.nsName, ...d.named.map((e) => e.local)].filter(Boolean);
    const unread = names.filter((n) => !used.has(n));
    if (unread.length === 0) continue;
    if (unread.length === names.length) {
      edits.push({ start: d.start, end: text[d.end] === '\n' ? d.end + 1 : d.end, text: '' });
      continue;
    }
    if (d.defaultName && unread.includes(d.defaultName)) refuse(`${file}: a default import binding would be pruned alone`);
    const multi = d.nb.getText(d.sf).includes('\n');
    d.named.forEach((e, i) => {
      if (used.has(e.local)) return;
      const ls = lineStartOf(text, e.start);
      const le = text.indexOf('\n', e.end);
      if (multi && text.slice(ls, le) === `    ${e.text},`) edits.push({ start: ls, end: le + 1, text: '' });
      else if (i < d.named.length - 1) edits.push({ start: e.start, end: d.named[i + 1].start, text: '' });
      else edits.push({ start: d.named[i - 1].end, end: e.end, text: '' });
    });
  }
  return applyEdits(text, edits);
}

/** Each named method's class position (instance or static), for ordering facet members and header names. */
function classPositions(ts, cls) {
  const pos = new Map();
  for (const m of cls.members) if (ts.isMethodDeclaration(m) && m.name && ts.isIdentifier(m.name) && !pos.has(m.name.text)) pos.set(m.name.text, m.getStart());
  return pos;
}

/**
 * Plan and apply the moves `names` asks for on a split `protocol.ts`.
 * Returns `{ host, hostModule, modules, records, pruned }` (`modules`: the
 * receiving modules' new texts). Refuses (exit 2) on a name the class does not
 * declare as one instance method with a body, one already moved, one any stay
 * rule holds, and every shape the section above says this pass does not grow.
 * Pure.
 */
function generateMembers(T, text, hostText, moduleTexts, names, { anchors = SECTION_ANCHORS, pins = PATH_READER_PINS, needles = PATH_READER_NEEDLES } = {}) {
  const { ts } = T;
  globalTs = ts;
  if (!names || names.length === 0) refuse(`--members needs a comma-separated list of ${CLASS_NAME} method names`);
  if (new Set(names).size !== names.length) refuse(`--members names a method twice: ${names.join(', ')}`);
  if (!text.includes(MARK)) refuse(`${HOST_BASENAME} carries no ${MARK} stub: run the first pass on an unsplit file`);
  const planned = plan(T, text, hostText, { anchors, pins, needles });
  const { sf, cls, ctx } = planned;
  const records = [];
  for (const name of names) {
    const found = cls.members.filter((m) => ts.isMethodDeclaration(m) && m.body && m.name && ts.isIdentifier(m.name) && m.name.text === name && !hasModifier(ts, m, ts.SyntaxKind.StaticKeyword));
    if (found.length !== 1) refuse(`--members names ${name}, which ${CLASS_NAME} declares as ${found.length === 0 ? 'no instance method with a body' : 'more than one method'}`);
    const r = planned.records.find((x) => x.node === found[0]);
    if (r.reasons.some((x) => x.startsWith('already-moved'))) refuse(`${name} is already moved: its body is a stub`);
    if (r.reasons.length > 0) refuse(`${name} stays on the class, as the first pass would keep it: ${r.reasons.map((x) => `${x} (${STAY_REASONS[x.split(':')[0]] ?? x})`).join('; ')}`);
    records.push(r);
  }
  records.sort((a, b) => a.node.getStart(sf) - b.node.getStart(sf));
  const pos = classPositions(ts, cls);

  // protocol.ts: each body becomes its lifted stub, a private docblock its link.
  const edits = [];
  const entries = new Map();
  const modules = new Map();
  for (const r of records) {
    const facet = facetNameOf(r.module);
    const b = ctx.scope.bindings.get(facet);
    if (!b || b.kind !== 'import' || b.specifier !== `./${r.module.replace(/\.ts$/, '.js')}`) refuse(`${r.module}: ${HOST_BASENAME} does not import its facet ${facet} (this pass never starts a facet)`);
    for (const [n] of r.moduleRefs) {
      if (n !== CLASS_NAME && !ctx.scope.exported.has(n)) refuse(`${r.name} reads ${n}, a top-level name of ${HOST_BASENAME} it does not export: this pass does not widen the generated export list`);
    }
    edits.push({ start: r.stub.start, end: r.stub.end, text: facetStubBody(r.name, r.module, r.node) });
    r.ownedDoc = null;
    if (isPrivateMember(ts, r.node)) {
      const span = movableDocSpan(ts, sf, r.node);
      if (span) { r.ownedDoc = span.text; edits.push({ start: span.start, end: span.end, text: docStubOf(facet, r.name, r.module) }); }
    }
    for (const [member, entry] of r.hostEntries) {
      const prev = entries.get(member);
      if (!prev || (entry.factory.includes('\n') && !prev.factory.includes('\n'))) entries.set(member, entry);
    }
    modules.set(r.module, [...(modules.get(r.module) ?? []), r]);
  }
  const inserted = T.hs.insertHostEntries(hostText, applyEdits(text, edits), new Map([...entries].sort(byName)));
  const pruned = pruneImports(ts, inserted.protocol, usedImportNames(ts, inserted.protocol));

  // The receiving modules: the members in class order, the header's names, the imports.
  const moduleOut = new Map();
  for (const [file, movers] of modules) {
    const mod = moduleTexts.get(file);
    if (mod == null || !mod.includes(MARK)) refuse(`${file} is not on disk as a facet module the first pass wrote: this pass adds to a written facet, never starts one`);
    const facet = facetOf(ts, file, mod);
    if (!facet || facet.members.length === 0) refuse(`${file}: no exported facet class ${facetNameOf(file)} with members`);
    const header = headerNamesOf(mod, movers[0].section);
    if (!header) refuse(`${file}: its header's first paragraph is not the one the first pass writes`);
    const modEdits = [];
    for (const r of movers) {
      const at = r.node.getStart(sf);
      const next = facet.members.find((m) => m.name && pos.has(m.name) && pos.get(m.name) > at);
      const t = facetMemberText(ts, r.fnText, r.ownedDoc);
      if (next) modEdits.push({ start: next.start, end: next.start, text: `${t}\n\n` });
      else modEdits.push({ start: facet.members.at(-1).end, end: facet.members.at(-1).end, text: `\n\n${t}` });
    }
    const listed = [...header.names];
    for (const r of movers) {
      const k = listed.findIndex((n) => (pos.get(n) ?? Infinity) > r.node.getStart(sf));
      listed.splice(k < 0 ? listed.length : k, 0, r.name);
    }
    modEdits.push({ start: header.start, end: header.end, text: wrapComment(headerWords(movers[0].section, listed)).join('\n') });
    const wanted = new Map();
    const want = (local, w) => {
      const prev = wanted.get(local);
      wanted.set(local, { ...w, value: Boolean(prev && prev.value) || w.value });
    };
    for (const r of movers) {
      for (const [local, use] of r.imports) {
        const b = ctx.scope.bindings.get(local);
        if (!b || b.kind !== 'import') refuse(`import binding ${local} not found`);
        want(local, { specifier: b.specifier, form: b.form, imported: b.imported, value: use.value && !b.typeOnly });
      }
      for (const [n, use] of r.moduleRefs) want(n, { specifier: './protocol.js', form: 'named', imported: n, value: use.value });
      want('ProtocolHost', { specifier: './protocol-host.js', form: 'named', imported: 'ProtocolHost', value: false });
    }
    const order = (s) => (ctx.scope.importOrder.has(s) ? ctx.scope.importOrder.get(s) : Number.MAX_SAFE_INTEGER);
    moduleOut.set(file, addModuleImports(ts, file, applyEdits(mod, modEdits), wanted, order));
  }
  return { host: pruned.text, hostModule: inserted.host, modules: moduleOut, records, pruned: pruned.removed };
}

/**
 * Undo the moves out of one receiving module, from its head text alone: drop
 * each moved facet member with the blank line the move wrote, its name from
 * the header's first paragraph, and the import bindings nothing reads any
 * more. Returns the text, or null (after `fail`) when the head is not a module
 * this pass can read.
 */
function undoMembersModule(ts, file, text, names, title, fail) {
  let out = text;
  for (const name of names) {
    const facet = facetOf(ts, file, out);
    const i = facet ? facet.members.findIndex((m) => m.name === name && m.staticMethod) : -1;
    if (i < 0) { fail(`${file}: holds no static facet member ${name}`); return null; }
    const ms = facet.members;
    if (ms.length === 1) { fail(`${file}: ${name} is its only member (this pass never starts a facet)`); return null; }
    if (i < ms.length - 1) {
      if (out.slice(ms[i].end, ms[i + 1].start) !== '\n\n') { fail(`${file}: ${name} is not followed by exactly one blank line`); return null; }
      out = out.slice(0, ms[i].start) + out.slice(ms[i + 1].start);
    } else {
      if (out.slice(ms[i - 1].end, ms[i].start) !== '\n\n') { fail(`${file}: ${name} is not preceded by exactly one blank line`); return null; }
      out = out.slice(0, ms[i - 1].end) + out.slice(ms[i].end);
    }
  }
  const header = headerNamesOf(out, title);
  if (!header) { fail(`${file}: its header's first paragraph is not the one the first pass writes`); return null; }
  for (const n of names) if (!header.names.includes(n)) fail(`${file}: its header does not list ${n}`);
  out = out.slice(0, header.start) + wrapComment(headerWords(title, header.names.filter((n) => !names.includes(n)))).join('\n') + out.slice(header.end);
  return pruneModuleImports(ts, file, out);
}

/**
 * Prove this pass's moves against the pre-move tree, from the texts alone (it
 * shares no state with `generateMembers`). `base` / `head`: `{ text, host,
 * modules }` (`protocol.ts`, `protocol-host.ts`, the section modules by file).
 * Returns `{ failures, moved, checks, pruned, linesBefore, linesAfter }`.
 */
function verifyMembers(T, base, head, { anchors = SECTION_ANCHORS, pins = PATH_READER_PINS, needles = PATH_READER_NEEDLES } = {}) {
  const { ts, hs } = T;
  globalTs = ts;
  const failures = [];
  const fail = (msg) => failures.push(msg);
  const moved = [];
  const checks = [];
  const baseSf = parseSourceFile(HOST_PATH, base.text);
  const headSf = parseSourceFile(HOST_PATH, head.text);
  const baseCls = hs.classOf(baseSf, CLASS_NAME);
  const headCls = hs.classOf(headSf, CLASS_NAME);
  const done = (pruned = []) => ({ failures, moved: moved.map((mv) => mv.name), checks, pruned, linesBefore: lineCount(base.text), linesAfter: lineCount(head.text) });
  if (!baseCls || !headCls) { fail(`no class ${CLASS_NAME} at base or head`); return done(); }
  const marker = new RegExp(`^\\{\\s*// ${MARK.replace(/[[\]]/g, '\\$&')} The body moved to \`(protocol-[a-z0-9-]+\\.ts)\``);
  const key = (m) => `${hasModifier(ts, m, ts.SyntaxKind.StaticKeyword) ? 'static ' : ''}${m.name && ts.isIdentifier(m.name) ? m.name.text : ts.SyntaxKind[m.kind]}`;
  const methodsOf = (cls) => new Map(cls.members.filter((m) => ts.isMethodDeclaration(m) && m.body).map((m) => [key(m), m]));
  const baseMethods = methodsOf(baseCls);
  const headMethods = methodsOf(headCls);
  if ([...baseMethods.keys()].join() !== [...headMethods.keys()].join()) fail(`${CLASS_NAME} does not declare the same methods in the same order at base and head`);
  for (const [k, hm] of headMethods) {
    const bm = baseMethods.get(k);
    if (!bm) continue;
    const hHit = marker.exec(hm.body.getText(headSf));
    const bHit = marker.exec(bm.body.getText(baseSf));
    if (bHit && !hHit) fail(`${k}: a stub at base is a body at head`);
    if (!hHit || bHit) continue;
    if (k.startsWith('static ')) { fail(`${k}: a static's body moved (this pass moves instance methods only)`); continue; }
    moved.push({ name: hm.name.text, hm, bm, file: hHit[1] });
  }
  if (moved.length === 0) fail('nothing moved: the head carries no stub its base did not');

  const basePlan = plan(T, base.text, base.host, { anchors, pins, needles });
  const headPrivateStatics = new Set([...hs.memberTable(headCls).statics].filter(([, s]) => s.private).map(([n]) => n));
  for (const mv of moved) {
    const { name, hm, bm, file } = mv;
    const r = basePlan.records.find((x) => x.node.name?.text === name && !x.isStatic);
    if (!r) { fail(`${name}: no record of it at base`); continue; }
    if (r.reasons.length > 0) fail(`${name}: a stay rule holds it at base (${r.reasons.join('; ')})`);
    if (r.module !== file) { fail(`${name}: its stub names ${file}, and its section's module is ${r.module ?? 'none'}`); continue; }
    mv.title = r.section;
    if (hm.body.getText(headSf) !== facetStubBody(name, file, bm)) fail(`${name}: the stub is not the first pass's lifted stub`);
    const facet = facetNameOf(file);
    const span = isPrivateMember(ts, bm) ? movableDocSpan(ts, baseSf, bm) : null;
    mv.ownedDoc = span ? span.text : null;
    const sig = (sf, m, doc) => {
      const s = sf.text.slice(m.getFullStart(), m.body.getStart(sf));
      return doc ? s.replace(doc, docStubOf(facet, name, file)) : s;
    };
    if (sig(headSf, hm) !== sig(baseSf, bm, mv.ownedDoc)) fail(`${name}: its docblock, modifiers or signature changed (beyond docblock ownership)`);
    const modText = head.modules.get(file);
    const fo = modText && modText.includes(MARK) ? facetOf(ts, file, modText) : null;
    const fm = fo?.members.find((m) => m.name === name && m.staticMethod);
    if (!fm) { fail(`${name}: ${file} at head holds no facet member ${name}`); continue; }
    mv.fm = fm;
    mv.modText = modText;
    if (r.reasons.length === 0 && modText.slice(fm.start, fm.end) !== facetMemberText(ts, r.fnText, mv.ownedDoc)) {
      fail(`${name}: the facet member is not its base method's text as the first pass lifts it (docblock, parameters, return type, body)`);
    }
    const fnText = unliftMethod(ts, modText.slice(fm.node.getStart(fo.sf), fm.end));
    const fnBody = fnText === null ? null : functionBodyOf(ts, fnText);
    if (fnBody === null) { fail(`${name}: ${facet}.${name} does not unlift`); continue; }
    mv.restored = undoBody(ts, fnBody, headPrivateStatics);
    if (mv.restored !== base.text.slice(bm.body.getStart(baseSf), bm.body.getEnd())) fail(`${name}: its moved body, rewrites and re-indentation undone, is not the base body`);
    mv.picks = picksOf(modText, fm) ?? [];
    // `host-split.mjs`'s own check, on the unlifted pair.
    const callee = hm.body.statements.at(-1)?.expression?.expression;
    const headDoc = mv.ownedDoc ? movableDocSpan(ts, headSf, hm) : null;
    const headA = callee && ts.isPropertyAccessExpression(callee)
      ? applyEdits(head.text, [
        { start: callee.getStart(headSf), end: callee.name.getStart(headSf), text: '' },
        ...(headDoc ? [{ start: headDoc.start, end: headDoc.end, text: mv.ownedDoc }] : []),
      ])
      : head.text;
    const c = hs.checkMove({ baseSource: base.text, headSource: headA, moduleSource: `${fnText}\n`, moduleFile: file, member: name, className: CLASS_NAME });
    checks.push({ name, ok: c.ok, counts: c.counts });
    for (const p of c.problems) fail(`host-split check ${name}: ${p}`);
  }

  // The modules: each receiving one undoes to its base; every other is its base.
  const touched = new Map();
  for (const mv of moved) if (mv.fm) touched.set(mv.file, [...(touched.get(mv.file) ?? []), mv]);
  for (const file of new Set([...base.modules.keys(), ...head.modules.keys()])) {
    const b = base.modules.get(file) ?? null;
    const h = head.modules.get(file) ?? null;
    if (!touched.has(file)) {
      if (b !== h) fail(`${file}: changed, and no member this pass moved is in it`);
      continue;
    }
    if (b === null || !b.includes(MARK)) { fail(`${file}: not a facet module at base (this pass never starts a facet)`); continue; }
    const mvs = touched.get(file);
    const u = undoMembersModule(ts, file, h, mvs.map((mv) => mv.name), mvs[0].title, fail);
    if (u !== null && u !== b) fail(`undoing the moves out of ${file} does not rebuild its base (first difference at line ${firstDiff(u, b)})`);
  }

  // protocol.ts: each body and owned docblock back; the factory loses the entries the base did not carry.
  const edits = [];
  for (const mv of moved) {
    if (!mv.fm || mv.restored === undefined) continue;
    edits.push({ start: mv.hm.body.getStart(headSf), end: mv.hm.body.getEnd(), text: mv.restored });
    if (mv.ownedDoc) {
      const span = movableDocSpan(ts, headSf, mv.hm);
      if (span) edits.push({ start: span.start, end: span.end, text: mv.ownedDoc });
    }
  }
  let rebuilt = applyEdits(head.text, edits);
  const baseFactory = hostBlockKeys(base.text, FACTORY_OPEN, FACTORY_CLOSE, factoryKey);
  const baseIface = hostBlockKeys(base.host, IFACE_OPEN, IFACE_CLOSE, ifaceKey);
  if (!baseFactory || !baseIface) fail('the base carries no host factory or no ProtocolHost interface');
  else {
    const f = dropHostGroups(rebuilt, FACTORY_OPEN, FACTORY_CLOSE, factoryKey, baseFactory.keys, (l) => /^ {12}set /.test(l));
    if (f.missing) fail(`${HOST_BASENAME} at head carries no host factory`);
    rebuilt = f.text;
    const i = dropHostGroups(head.host, IFACE_OPEN, IFACE_CLOSE, ifaceKey, baseIface.keys, () => false);
    if (i.missing) fail(`${HOST_MODULE_BASENAME} at head carries no ProtocolHost interface`);
    if (i.text !== base.host) fail(`undoing the moves does not rebuild the base ${HOST_MODULE_BASENAME} (first difference at line ${firstDiff(i.text, base.host)})`);
    if (JSON.stringify([...f.dropped].sort()) !== JSON.stringify([...i.dropped].sort())) fail(`the factory and the interface gained different entries: factory ${f.dropped.join(', ')}; interface ${i.dropped.join(', ')}`);
    const picked = new Set(moved.flatMap((mv) => mv.picks ?? []));
    for (const k of i.dropped) if (!picked.has(k)) fail(`${HOST_MODULE_BASENAME} gained ${k}, which no moved body's host type names`);
  }
  const prune = pruneImports(ts, base.text, usedImportNames(ts, head.text));
  const movedText = `${moved.map((mv) => mv.restored ?? '').join('\n')}\n${moved.map((mv) => mv.ownedDoc ?? '').join('\n')}`;
  for (const n of prune.removed) {
    if (!new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(movedText)) fail(`${HOST_BASENAME} lost the import binding ${n}, which no moved body reads`);
  }
  if (rebuilt !== prune.text) {
    const at = firstDiff(rebuilt, prune.text);
    fail(`undoing the moves does not rebuild the base ${HOST_BASENAME} (its unread imports pruned): first difference at line ${at}` +
      `\n    rebuilt: ${JSON.stringify(rebuilt.split('\n')[at - 1] ?? '<end>')}\n    base:    ${JSON.stringify(prune.text.split('\n')[at - 1] ?? '<end>')}`);
  }
  return done(prune.removed);
}

function printVerifyMembers(v) {
  for (const f of v.failures) console.error(`  ✗ ${f}`);
  console.log(`undo proof (${MEMBERS_CARD}): ${v.moved.length} moved method(s) (${v.moved.join(', ') || 'none'}); ` +
    `host-split check: ${v.checks.filter((c) => c.ok).length}/${v.checks.length} pass; ${HOST_BASENAME} ${v.linesBefore} -> ${v.linesAfter} lines; ` +
    `undoing the moves ${v.failures.length > 0 ? 'does NOT' : 'does'} rebuild the base ${HOST_BASENAME}, ${HOST_MODULE_BASENAME} and section modules byte-for-byte ` +
    `once the ${v.pruned.length} import binding(s) only moved bodies read are pruned from the base (${v.pruned.join(', ') || 'none'})`);
}

function generatedModulesAt(ref) {
  const out = new Map();
  for (const [, , file] of SECTION_ANCHORS) {
    if (!file) continue;
    try {
      out.set(file, execFileSync('git', ['show', `${ref}:${SRC_REL}/${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch { /* absent at the ref */ }
  }
  return out;
}

async function mainMembers(T, argv) {
  if (argv.includes('--verify')) {
    const i = argv.indexOf('--base');
    const ref = i >= 0 ? argv[i + 1] : null;
    if (!ref) refuse('--members --verify needs --base <ref>');
    const v = verifyMembers(T,
      { text: gitShow(ref, `${SRC_REL}/${HOST_BASENAME}`), host: gitShow(ref, `${SRC_REL}/${HOST_MODULE_BASENAME}`), modules: generatedModulesAt(ref) },
      { text: readFileSync(HOST_PATH, 'utf8'), host: readFileSync(HOST_MODULE_PATH, 'utf8'), modules: generatedModulesOnDisk() });
    printVerifyMembers(v);
    return v.failures.length === 0 ? 0 : 1;
  }
  const j = argv.indexOf('--members');
  const value = argv[j + 1];
  const names = value && !value.startsWith('--') ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const base = { text: readFileSync(HOST_PATH, 'utf8'), host: readFileSync(HOST_MODULE_PATH, 'utf8'), modules: generatedModulesOnDisk() };
  const out = generateMembers(T, base.text, base.host, base.modules, names);
  console.log(`# codemod-split-protocol --members (${MEMBERS_CARD}): named methods onto the landed facade`);
  for (const r of out.records) console.log(`- ${r.name} -> ${facetNameOf(r.module)} (${r.module}): ${r.bodyLines} body lines${r.ownedDoc ? ', its docblock with it' : ''}`);
  const head = { text: out.host, host: out.hostModule, modules: new Map([...base.modules, ...out.modules]) };
  console.log(`output tree sha256: ${treeHash(new Map([[HOST_BASENAME, out.host], [HOST_MODULE_BASENAME, out.hostModule], ...out.modules]))}`);
  const v = verifyMembers(T, base, head);
  printVerifyMembers(v);
  if (v.failures.length > 0) {
    console.error('✗ the moves fail their proof: nothing written. Report the fork; never hand-edit the move.');
    return 1;
  }
  if (!argv.includes('--write')) {
    console.log('plan only: nothing written (pass --write to apply).');
    return 0;
  }
  writeFileSync(HOST_PATH, out.host);
  writeFileSync(HOST_MODULE_PATH, out.hostModule);
  for (const [file, text] of out.modules) writeFileSync(join(SRC_DIR, file), text);
  console.log(`✓ wrote ${HOST_BASENAME}, ${HOST_MODULE_BASENAME} and ${out.modules.size} facet module(s) under ${SRC_REL}`);
  return 0;
}

// ── Entry ────────────────────────────────────────────────────────────────────

const USAGE = [
  'usage: node scripts/codemod-split-protocol.mjs [--write]   plan (or apply) the split of an UNSPLIT protocol.ts',
  '       node scripts/codemod-split-protocol.mjs --verify --base REF   re-prove a split on disk against protocol.ts at REF',
  '       node scripts/codemod-split-protocol.mjs --members A,B [--write]   plan (or apply) moving named methods onto the landed facade (#30518)',
  '       node scripts/codemod-split-protocol.mjs --members --verify --base REF   re-prove those moves on disk against the tree at REF',
  '       node scripts/codemod-split-protocol.mjs --self-test',
  '       node scripts/codemod-split-protocol.mjs --help',
].join('\n');

async function main(argv) {
  // Answered before any guard: `--help` reads no tree.
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  if (argv.includes('--self-test')) {
    await selfTest();
    if (process.exitCode === 1) return 1;
    if (!selfTestReachedVerdict) {
      console.error('\n✗ codemod-split-protocol self-test: selfTest() returned without reaching its verdict,\n' +
        'so no success line was printed. Exiting 0 here would report a self-test that never\n' +
        'finished as a self-test that passed.');
      return 1;
    }
    return 0;
  }
  const known = new Set(['--write', '--verify', '--base', '--members']);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') { i += 1; continue; }
    if (argv[i] === '--members' && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) { i += 1; continue; }
    if (!known.has(argv[i])) refuse(`unknown argument ${JSON.stringify(argv[i])}\n${USAGE}`);
  }
  const T = await loadTools();
  if (argv.includes('--members')) return mainMembers(T, argv);
  if (argv.includes('--verify')) {
    const i = argv.indexOf('--base');
    const ref = i >= 0 ? argv[i + 1] : null;
    if (!ref) refuse('--verify needs --base <ref>');
    const v = verifyFacade(T, gitShow(ref, `${SRC_REL}/${HOST_BASENAME}`), readFileSync(HOST_PATH, 'utf8'),
      gitShow(ref, `${SRC_REL}/${HOST_MODULE_BASENAME}`), readFileSync(HOST_MODULE_PATH, 'utf8'), generatedModulesOnDisk());
    printVerify(v);
    return v.failures.length === 0 ? 0 : 1;
  }
  const input = readFileSync(HOST_PATH, 'utf8');
  const hostInput = readFileSync(HOST_MODULE_PATH, 'utf8');
  if (input.includes(MARK)) refuse(`${HOST_BASENAME} already carries ${MARK} stubs: run the script on an unsplit file (re-run on the latest main, never on its own output)`);
  const planned = plan(T, input, hostInput);
  console.log(planReport(planned));
  const out = lift(T, generate(T, input, hostInput, planned), planned);
  console.log(facadeReport(T, out, planned));
  const files = new Map([[HOST_BASENAME, out.host], [HOST_MODULE_BASENAME, out.hostModule], ...out.modules]);
  console.log(`output tree sha256: ${treeHash(files)} (input sha256 ${sha256(input)} + ${HOST_MODULE_BASENAME} ${sha256(hostInput)})`);
  const v = verifyFacade(T, input, out.host, hostInput, out.hostModule, out.modules);
  printVerify(v);
  if (v.failures.length > 0) {
    console.error('✗ the generated split fails its proof: nothing written. Report the fork; never hand-edit the split.');
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
  writeFileSync(HOST_MODULE_PATH, out.hostModule);
  for (const [file, text] of out.modules) writeFileSync(join(SRC_DIR, file), text);
  console.log(`✓ wrote ${HOST_BASENAME}, ${HOST_MODULE_BASENAME} and ${out.modules.size} module(s) under ${SRC_REL}`);
  return 0;
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
  'stay rules': 16,
  'host entries': 4,
  'byte-identity proof': 9,
  'determinism': 2,
  'refusals': 6,
  'import prune': 4,
  'facade layer': 10,
  'members pass': 8,
  'members proof': 12,
  'members refusals': 10,
});
const SELF_TEST_BATTERY_FLOOR = 5;

const FIXTURE_ANCHORS = Object.freeze([
  ['engine', 'First', 'protocol-first.ts'],
  ['keptOne', 'Kept', null],
]);
const FIXTURE_PINS = Object.freeze({ pinnedMethod: 'a fixture reader' });
const FIXTURE_NEEDLES = Object.freeze({ 'NEEDLE_TEXT': 'a fixture reader' });
const fixturePlan = (T, text, hostText = FIXTURE_HOST) => plan(T, text, hostText,
  { anchors: FIXTURE_ANCHORS, pins: FIXTURE_PINS, needles: FIXTURE_NEEDLES });

const FIXTURE_HOST = `// fixture host
import type { ObjectStackProtocolImplementation } from './protocol.js';

export interface ProtocolHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly flag: ObjectStackProtocolImplementation['flag'];
}
`;

function fixtureSource(extraMembers = '') {
  const pad = Array.from({ length: 6 }, (_, i) => `        const p${i} = ${i};`).join('\n');
  return `import { helperImported } from './other.js';
import type { Shape } from './types.js';
import { installProtocolHost, protocolHost } from './protocol-host.js';
import { already } from './protocol-already.js';
import { docLinked, onlyMoved } from './moved-only.js';

const LOCAL = 1;
function localHelper(n: number): number {
    return n + LOCAL;
}

export class ObjectStackProtocolImplementation {
    private engine: any;
    private count = 0;
    private flag = false;
    private static secret(x: number): number { return x; }
    protected static guarded(): number { return 1; }

    static {
        installProtocolHost((protocol) => ({
            get engine() { return protocol.engine; },
            get flag() { return protocol.flag; },
        }));
    }

    /** Docblock that stays. */
    async movable(a: string, b?: number): Promise<string> {
${pad}
        const s = helperImported(onlyMoved(a)) as Shape | string;
        // a comment the move carries
        const t = \`line one
second line at column 0 \${this.count}\`;
        return String(s) + t + this.engine.x + ObjectStackProtocolImplementation.secret(b ?? 0) + localHelper(1);
    }

    private tiny(): number {
        return this.count;
    }

    private bareThis(): unknown {
${pad}
        return this;
    }

    private viaConstructor(): number {
${pad}
        return this.constructor.secret(1);
    }

    public inferred() {
${pad}
        return this.count;
    }

    private inferredPrivate() {
${pad}
        return this.count;
    }

    private readsNoMember(n: number): number {
${pad}
        return n;
    }

    private destructured({ a }: { a: number }): number {
${pad}
        return a;
    }

    private shadows(host: number): number {
${pad}
        return host;
    }

    private alreadyMoved(x: number): number {
        // a hand-series stub
        return already(protocolHost(this), x);
    }

    private localHelper(): number {
${pad}
        return 1;
    }

    private pinnedMethod(): number {
${pad}
        return 3;
    }

    private carriesNeedle(): string {
${pad}
        return 'NEEDLE_TEXT';
    }

    private readsGuarded(): number {
${pad}
        return ObjectStackProtocolImplementation.guarded();
    }

    private whitespaceLine(): number {
${pad}
${'    '}
        return 1;
    }

    private writesCount(): void {
${pad}
        this.count = 2;
    }

    private writesFlag(): void {
${pad}
        this.flag = true;
    }

    private isThing(x: unknown): x is string {
        return typeof x === 'string';
    }

    /**
     * A private member's docblock: it moves with the body.
     */
    private ownedDoc(): number {
${pad}
        return this.count;
    }

    private static readsClass(): number {
${pad}
        return ObjectStackProtocolImplementation.secret(1);
    }

    /** Stays, and its {@link docLinked} keeps that import in protocol.ts. */
    private readsPredicate(x: unknown): boolean {
${pad}
        return this.isThing(x);
    }
${extraMembers}
    private keptOne(): number {
${pad}
        return 2;
    }
}
`;
}

async function selfTest() {
  const T = await loadTools();
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

  const input = fixtureSource();
  const planned = fixturePlan(T, input);
  const out = generate(T, input, FIXTURE_HOST, planned);

  open('stay rules');
  {
    const why = (name) => (planned.records.find((r) => r.name === name)?.reasons ?? ['<absent>']).join('; ');
    const stays = (name, code) => check(`${name} stays (${code})`, why(name).split('; ').some((r) => r.startsWith(code)), why(name));
    const moves = (name, because) => check(`${name} moves (${because})`, why(name) === '', why(name));
    moves('movable', 'the canonical body: a member, a private static, an import, a module-scope helper, a template literal');
    moves('writesCount', 'a field it writes gains a writable host entry');
    moves('tiny', 'a body shorter than its stub: the facade keeps delegations only');
    moves('secret', 'a private static that reads nothing of the class');
    stays('readsClass', 'static-reads-class');
    stays('guarded', 'static-shape');
    stays('bareThis', 'closed-set');
    stays('viaConstructor', 'constructor-rewrite');
    stays('inferred', 'inferred-return-type');
    moves('inferredPrivate', 'a private method\'s inferred return type is not printed in the `.d.ts`');
    stays('readsNoMember', 'no-host-read');
    stays('destructured', 'parameter-shape');
    stays('shadows', 'parameter-shadows');
    stays('alreadyMoved', 'already-moved');
    stays('localHelper', 'name-taken');
    check('a pinned method and a method carrying a needle stay (path-reader)',
      why('pinnedMethod').startsWith('path-reader') && why('carriesNeedle').startsWith('path-reader'),
      `${why('pinnedMethod')} | ${why('carriesNeedle')}`);
    stays('readsGuarded', 'non-public-static');
    stays('whitespaceLine', 'indent-irreversible');
    stays('keptOne', 'section-kept');
  }

  open('host entries');
  {
    const why = (name) => (planned.records.find((r) => r.name === name)?.reasons ?? ['<absent>']).join('; ');
    check('a write to a field the host carries readonly stays (host-entry-conflict)', why('writesFlag').startsWith('host-entry-conflict'), why('writesFlag'));
    check('the interface gains the moved bodies\' members, sorted, the written field writable',
      /\n {4}count: [^\n]*\n {4}readonly engine:[^\n]*\n {4}readonly flag:[^\n]*\n {4}readonly secret:/.test(out.hostModule), out.hostModule);
    check('the factory gains a getter and a setter for the written field and a closure to the private static',
      out.host.includes('            get count() { return protocol.count; },\n            set count(value) { protocol.count = value; },')
      && out.host.includes('            secret: (...a) => ObjectStackProtocolImplementation.secret(...a),'));
    check('a move that reaches a type predicate through a new host entry stays (host-entry-predicate)', why('readsPredicate').startsWith('host-entry-predicate'), why('readsPredicate'));
    check('an entry the host already carries is not written twice', out.hostModule.split('readonly engine:').length === 2 && out.host.split('get engine()').length === 2);
  }

  open('byte-identity proof');
  {
    const v = verify(T, input, out.host, FIXTURE_HOST, out.hostModule, out.modules);
    check('the generated split proves against its base', v.failures.length === 0 && v.moved.length === 6 && v.checks.length === 5 && v.checks.every((c) => c.ok),
      [...v.failures, `moved: ${v.moved.map((m) => m.name).join()}`].join(' | '));
    const mod = out.modules.get('protocol-first.ts');
    const withModule = (text) => new Map([...out.modules, ['protocol-first.ts', text]]);
    check('one edited character in a moved body fails', verify(T, input, out.host, FIXTURE_HOST, out.hostModule, withModule(mod.replace('const p3 = 3;', 'const p3 = 4;'))).failures.length > 0);
    check('a rewrite pointed at another member fails', verify(T, input, out.host, FIXTURE_HOST, out.hostModule, withModule(mod.replace('host.engine.x', 'host.count.x'))).failures.length > 0);
    check('an edited stub signature fails',
      verify(T, input, out.host.replace('b?: number): Promise<string>', 'b?: number): Promise<String>'), FIXTURE_HOST, out.hostModule, out.modules).failures.length > 0);
    check('an extra top-level statement in a module fails', verify(T, input, out.host, FIXTURE_HOST, out.hostModule, withModule(`${mod}\nexport const extra = 1;\n`)).failures.length > 0);
    check('an edited host interface entry fails',
      verify(T, input, out.host, FIXTURE_HOST, out.hostModule.replace("readonly flag: ObjectStackProtocolImplementation['flag']", "flag: ObjectStackProtocolImplementation['flag']"), out.modules).failures.length > 0);
    check('an edited factory entry the base carried fails',
      verify(T, input, out.host.replace('get flag() { return protocol.flag; }', 'get flag() { return !protocol.flag; }'), FIXTURE_HOST, out.hostModule, out.modules).failures.length > 0);
    check('an edit elsewhere in protocol.ts fails', verify(T, input, out.host.replace('const LOCAL = 1;', 'const LOCAL = 2;'), FIXTURE_HOST, out.hostModule, out.modules).failures.length > 0);
    check('a proof over no moved method fails', verify(T, input, input, FIXTURE_HOST, FIXTURE_HOST, new Map()).failures.length > 0);
  }

  open('facade layer');
  {
    const lifted = lift(T, out, planned);
    const facet = lifted.modules.get('protocol-first.ts') ?? '';
    const vf = (host, modules = lifted.modules) => verifyFacade(T, input, host, FIXTURE_HOST, lifted.hostModule, modules);
    const withFacet = (text) => new Map([...lifted.modules, ['protocol-first.ts', text]]);
    const v = vf(lifted.host);
    check('the facade proves against its base through the unlift', v.failures.length === 0 && v.moved.length === 6 && v.docsMoved === 1, [...v.failures, `moved ${v.moved.length} docs ${v.docsMoved}`].join(' | '));
    check('each section module is one stateless facet class of static methods',
      /\nexport class ProtocolFirstFacet \{\n/.test(facet) && !/\nexport (async )?function /.test(facet) && /\n {4}static async movable\(host: /.test(facet), facet.slice(0, 300));
    check('a private member\'s docblock moves; a public member\'s stays on the facade',
      facet.includes('    /**\n     * A private member\'s docblock: it moves with the body.\n     */\n    static ownedDoc(')
      && lifted.host.includes('    /** Docblock and body: {@link ProtocolFirstFacet.ownedDoc} in `protocol-first.ts` [#29985 codemod]. */\n    private ownedDoc(')
      && lifted.host.includes('    /** Docblock that stays. */\n    async movable('));
    check('a stub delegates to its facet', lifted.host.includes('return ProtocolFirstFacet.movable(protocolHost(this), a, b);') && lifted.host.includes('return ProtocolFirstFacet.secret(x);'));
    check('one edited character in a moved docblock fails', vf(lifted.host, withFacet(facet.replace('it moves with the body.', 'it moves with the body!'))).failures.length > 0);
    check('a public docblock moved off the facade fails',
      vf(lifted.host.replace('    /** Docblock that stays. */\n    async movable(', '    /** Docblock and body: {@link ProtocolFirstFacet.movable} in `protocol-first.ts` [#29985 codemod]. */\n    async movable('),
        withFacet(facet.replace(/ {4}\/\*\* The body of `ObjectStackProtocolImplementation#movable`[^\n]*/, '    /** Docblock that stays. */'))).failures.length > 0);
    check('a stub calling another facet fails', vf(lifted.host.replace('return ProtocolFirstFacet.movable(', 'return OtherFacet.movable(')).failures.length > 0);
    check('a member of the facet that is not a static method fails', vf(lifted.host, withFacet(facet.replace('export class ProtocolFirstFacet {\n', 'export class ProtocolFirstFacet {\n    extra = 1;\n'))).failures.length > 0);
    check('a body line the lift did not indent fails', vf(lifted.host, withFacet(facet.replace('        const p3 = 3;', '    const p3 = 3;'))).failures.length > 0);
    const again = lift(T, generate(T, input, FIXTURE_HOST, fixturePlan(T, input)), fixturePlan(T, input));
    check('two lifts of one input write byte-identical trees',
      treeHash(new Map([['h', again.host], ...again.modules])) === treeHash(new Map([['h', lifted.host], ...lifted.modules])));
  }

  // The members pass (#30518): the fixture split by the first pass is the
  // landed facade; three methods the first pass held for an inferred return
  // type get theirs spelled, and its facet module is edited by hand the ways
  // `main`'s were (a header paragraph, an import, a top-level declaration and
  // a facet member nobody moved).
  {
    const pad = Array.from({ length: 6 }, (_, i) => `        const p${i} = ${i};`).join('\n');
    const extra = `
    public laterReader(n: number) {
${pad}
        return laterOnly(n) + docLinked(n) + this.engine.z;
    }

    public readsLocal() {
${pad}
        return LOCAL + this.engine.w;
    }
`;
    const src = fixtureSource(extra)
      .replace("import type { Shape } from './types.js';\n", "import type { Shape } from './types.js';\nimport { laterOnly } from './later.js';\n")
      .replace('    private tiny(): number {', `    public engineReader() {\n${pad}\n        return this.engine.y;\n    }\n\n    private tiny(): number {`);
    const firstPlan = fixturePlan(T, src);
    const landed = lift(T, generate(T, src, FIXTURE_HOST, firstPlan), firstPlan);
    const spelled = landed.host
      .replace('    public engineReader() {', '    public engineReader(): number {')
      .replace('    public laterReader(n: number) {', '    public laterReader(n: number): number {')
      .replace('    public readsLocal() {', '    public readsLocal(): number {');
    const handFacet = (landed.modules.get('protocol-first.ts') ?? '')
      .replace('\n *\n * A MOVE, not a redesign.', '\n *\n * [#1] A paragraph a hand wrote after the split.\n *\n * A MOVE, not a redesign.')
      .replace("import type { ProtocolHost } from './protocol-host.js';\n", "import { handHelper } from './hand.js';\nimport type { ProtocolHost } from './protocol-host.js';\n\nconst HAND_LOCAL = 1;\n")
      .replace(/\n}\n$/, '\n\n    /** A member a hand wrote here. */\n    static handWritten(): number {\n        return handHelper() + HAND_LOCAL;\n    }\n}\n');
    const base = { text: spelled, host: landed.hostModule, modules: new Map([['protocol-first.ts', handFacet]]) };
    const opts = { anchors: FIXTURE_ANCHORS, pins: FIXTURE_PINS, needles: FIXTURE_NEEDLES };
    const gen = (names, b = base) => generateMembers(T, b.text, b.host, b.modules, names, opts);
    const out = gen(['laterReader', 'engineReader']);
    const head = { text: out.host, host: out.hostModule, modules: new Map([...base.modules, ...out.modules]) };
    const facetText = head.modules.get('protocol-first.ts');
    const vm = (h) => verifyMembers(T, base, h, opts);
    const withHead = (patch) => ({ ...head, ...patch });
    const withFacet = (text) => withHead({ modules: new Map([['protocol-first.ts', text]]) });

    open('members pass');
    {
      const v = vm(head);
      check('the moves prove against the landed facade by their undo', v.failures.length === 0 && v.moved.join() === 'engineReader,laterReader' && v.checks.every((c) => c.ok),
        [...v.failures, `moved ${v.moved.join()}`].join(' | '));
      check('each stub delegates to its facet, signature and docblock unchanged',
        out.host.includes('    public engineReader(): number {\n        // [#29985 codemod] The body moved to `protocol-first.ts`; it reaches this class through `protocol-host.ts`.\n        return ProtocolFirstFacet.engineReader(protocolHost(this));\n    }'), out.host);
      check('a member goes in class order among the facet\'s members: before the next one, or last',
        facetText.indexOf('static engineReader(') < facetText.indexOf('static tiny(')
        && facetText.indexOf('static laterReader(') > facetText.indexOf('static handWritten('), facetText);
      check('the header\'s first paragraph lists the names in class order; a hand-written paragraph stays',
        /`engineReader`,\s*(\n \*\s*)?`tiny`/.test(facetText) && facetText.includes(' * [#1] A paragraph a hand wrote after the split.'), facetText.slice(0, 900));
      check('an import binding the body reads joins the declaration of its specifier, in that declaration\'s layout',
        facetText.includes("import { docLinked, onlyMoved } from './moved-only.js';"), facetText.split('\n').filter((l) => l.startsWith('import')).join(' | '));
      check('an import binding of a new specifier is a new declaration ahead of ProtocolHost\'s; a hand-written import stays',
        facetText.includes("import { handHelper } from './hand.js';\nimport { laterOnly } from './later.js';\nimport type { ProtocolHost } from './protocol-host.js';"));
      check('protocol.ts drops the import only the moved body read, keeps one a staying docblock links',
        !/\blaterOnly\b/.test(out.host) && out.host.includes("import { docLinked } from './moved-only.js';") && out.pruned.join() === 'laterOnly', out.pruned.join());
      const again = gen(['engineReader', 'laterReader']);
      check('two runs (names in any order) write byte-identical trees',
        treeHash(new Map([['h', again.host], ['p', again.hostModule], ...again.modules])) === treeHash(new Map([['h', out.host], ['p', out.hostModule], ...out.modules])));
    }

    open('members proof');
    {
      // A mutation that does not land would make its case vacuous: each must change the head.
      const same = (a, b) => a.text === b.text && a.host === b.host && a.modules.size === b.modules.size
        && [...a.modules].every(([f, t]) => b.modules.get(f) === t);
      const fails = (label, h) => {
        const v = vm(h);
        check(label, (h === base || !same(h, head)) && v.failures.length > 0, same(h, head) ? 'the mutation did not land' : 'proved');
      };
      fails('one edited character in a moved body fails', withFacet(facetText.replace('return laterOnly(n) + docLinked(n) + host.engine.z;', 'return laterOnly(n) + docLinked(n) - host.engine.z;')));
      fails('one edited character in a hand-written facet member fails', withFacet(facetText.replace('return handHelper() + HAND_LOCAL;', 'return handHelper() - HAND_LOCAL;')));
      fails('a second blank line after a moved member fails', withFacet(facetText.replace(/(\n {4}\/\*\* The body of `ObjectStackProtocolImplementation#engineReader`)/, '\n$1')));
      fails('a header that does not list a moved name fails', withFacet(facetText.replace('`engineReader`, ', '')));
      fails('a changed module no moved member is in fails', withHead({ modules: new Map([...head.modules, ['protocol-other.ts', '// not at base\n']]) }));
      fails('an edited host interface entry fails', withHead({ host: out.hostModule.replace("readonly flag: ObjectStackProtocolImplementation['flag']", "flag: ObjectStackProtocolImplementation['flag']") }));
      fails('a host entry no moved body\'s Pick names fails', withHead({
        host: out.hostModule.replace("    readonly engine:", "    readonly zzz: ObjectStackProtocolImplementation['zzz'];\n    readonly engine:"),
        text: out.host.replace('            get engine()', '            zzz: (...a) => protocol.zzz(...a),\n            get engine()'),
      }));
      fails('a stub calling another facet fails', withHead({ text: out.host.replace('return ProtocolFirstFacet.engineReader(', 'return OtherFacet.engineReader(') }));
      fails('an edited docblock on a moved public member fails', withHead({ text: out.host.replace('    public engineReader(): number {', '    /** Hand. */\n    public engineReader(): number {') }));
      fails('an edit elsewhere in protocol.ts fails', withHead({ text: out.host.replace('const LOCAL = 1;', 'const LOCAL = 2;') }));
      fails('a head that drops an import no moved body reads fails', withHead({ text: out.host.replace("import { already } from './protocol-already.js';\n", '') }));
      fails('a proof over no moved method fails', base);
    }

    open('members refusals');
    {
      const refuses = (label, fn) => check(label, refused(fn));
      refuses('an empty list refuses', () => gen([]));
      refuses('a name given twice refuses', () => gen(['engineReader', 'engineReader']));
      refuses('a name the class does not declare refuses', () => gen(['nothingLikeThis']));
      refuses('a member already moved refuses', () => gen(['movable']));
      refuses('a member a stay rule holds refuses (closed-set)', () => gen(['bareThis']));
      refuses('a static refuses (only instance methods move)', () => gen(['secret']));
      refuses('an unsplit protocol.ts refuses (that is the first pass\'s)', () => generateMembers(T, src, FIXTURE_HOST, new Map(), ['engineReader'], opts));
      refuses('a body that reads an unexported top-level name refuses (the export list is not widened)', () => gen(['readsLocal']));
      const handHeader = handFacet.replace(' facet of', ' facet, edited by hand, of');
      check('a hand-edited first header paragraph refuses', handHeader !== handFacet
        && refused(() => gen(['engineReader'], { ...base, modules: new Map([['protocol-first.ts', handHeader]]) })));
      refuses('a module that declares a name the body imports refuses',
        () => gen(['laterReader'], { ...base, modules: new Map([['protocol-first.ts', handFacet.replace('const HAND_LOCAL = 1;', 'const HAND_LOCAL = 1;\nconst laterOnly = (n: number): number => n;')]]) }));
    }
  }

  open('determinism');
  {
    const again = generate(T, input, FIXTURE_HOST, fixturePlan(T, input));
    const tree = (o) => treeHash(new Map([['h', o.host], ['p', o.hostModule], ...o.modules]));
    check('two runs on one input write byte-identical trees', tree(out) === tree(again));
    check('the module imports what its bodies read, from where protocol.ts imports it, and nothing else',
      /import \{ helperImported \} from '\.\/other\.js';\nimport type \{ Shape \} from '\.\/types\.js';\nimport type \{ ProtocolHost \} from '\.\/protocol-host\.js';\nimport \{ onlyMoved \} from '\.\/moved-only\.js';\nimport \{ localHelper \} from '\.\/protocol\.js';/.test(out.modules.get('protocol-first.ts') ?? '')
      && /export \{ localHelper \};/.test(out.host), (out.modules.get('protocol-first.ts') ?? '').split('\n').filter((l) => l.startsWith('import')).join(' | '));
  }

  open('import prune');
  {
    check('protocol.ts drops the import only a moved body reads and keeps one a staying docblock links',
      out.host.includes("import { docLinked } from './moved-only.js';\n") && !/\bonlyMoved\b/.test(out.host), out.host.slice(0, 400));
    check('the module carries the import protocol.ts dropped', /import \{ onlyMoved \} from '\.\/moved-only\.js';/.test(out.modules.get('protocol-first.ts') ?? ''));
    check('a head that also drops an import it still links fails',
      verify(T, input, out.host.replace("import { docLinked } from './moved-only.js';\n", ''), FIXTURE_HOST, out.hostModule, out.modules).failures.length > 0);
    check('a head that keeps an import only moved bodies read fails',
      verify(T, input, out.host.replace("import { docLinked } from './moved-only.js';", "import { docLinked, onlyMoved } from './moved-only.js';"), FIXTURE_HOST, out.hostModule, out.modules).failures.length > 0);
  }

  open('refusals');
  {
    check('an anchor the class does not declare refuses', refused(() => plan(T, input, FIXTURE_HOST, { anchors: [['engine', 'a', 'protocol-a.ts'], ['gone', 'b', null]], pins: {}, needles: {} })));
    check('anchors out of class order refuse', refused(() => plan(T, input, FIXTURE_HOST, { anchors: [['engine', 'a', 'protocol-a.ts'], ['keptOne', 'b', null], ['movable', 'c', null]], pins: {}, needles: {} })));
    check('anchors that do not start at the first member refuse', refused(() => plan(T, input, FIXTURE_HOST, { anchors: [['movable', 'a', 'protocol-a.ts']], pins: {}, needles: {} })));
    check('a pin naming what the class lacks refuses', refused(() => plan(T, input, FIXTURE_HOST, { anchors: FIXTURE_ANCHORS, pins: { gone: 'x' }, needles: {} })));
    check('a needle the file no longer carries refuses', refused(() => plan(T, input, FIXTURE_HOST, { anchors: FIXTURE_ANCHORS, pins: {}, needles: { 'gone text': 'x' } })));
    check('--help is answered, never refused, whatever protocol.ts holds', (await main(['--help']).catch(() => 2)) === 0);
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
    console.error(`\n✗ codemod-split-protocol self-test: ${failed} failure(s) (cases and floor).`);
    process.exitCode = 1;
    selfTestReachedVerdict = true;
    return;
  }
  console.log(`\n✓ codemod-split-protocol self-test: ${cases} cases in ${declared.length} batteries pass.`);
  selfTestReachedVerdict = true;
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      if (error instanceof CodemodRefusal) {
        console.error(`✗ codemod-split-protocol: ${error.message}`);
        process.exit(2);
      }
      console.error(error);
      process.exit(2);
    },
  );
}
