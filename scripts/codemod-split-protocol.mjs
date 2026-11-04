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
 * One rule of the pilot is not carried: a non-private method whose return type
 * is inferred moves. The hand series already moved `getMetaItems`,
 * `validateData` and `createData` that way under the same declaration bar, so
 * it is this file's cut pattern; the bar on the built `.d.ts` judges it.
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
import { parseSourceFile } from './ts-parse.mjs';

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
  'no-yield': 'its stub would be no shorter than its body (moving it would grow protocol.ts)',
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
  parseSourceFile(fileName, text);
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
  const prog = ts.createProgram([fileName], { noLib: true, noResolve: true, target: ts.ScriptTarget.ES2022, strict: true }, host);
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
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
  const sf = ts.createSourceFile('x.ts', prefix + movedBodyText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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

/** The body text of the one exported function in `fnText` (what `planMove` writes). */
function functionBodyOf(ts, fnText) {
  const sf = ts.createSourceFile('x.ts', fnText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
    const stubLines = stubBody(name, section.module, m).split('\n').length;
    record.stubLines = stubLines;
    if (stubLines >= bodyLines) add('no-yield');
  }

  // Two moved bodies that need different entries for one member (a field one
  // reads and one writes) make every body that needs the writable one stay
  // only when protocol-host.ts already carries the readonly one — handled per
  // record above; between movers, the writable entry is the one written.
  for (let changed = true; changed;) {
    changed = false;
    const byModule = groupMovers(records);
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
  note('./protocol-host.js', 'ProtocolHost', { form: 'named', imported: 'ProtocolHost', value: false });
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

/** The E1 stub body, carrying this script's marker; `closeIndent` is the method's own indent. */
function stubBody(name, moduleFile, m) {
  const args = m.parameters.map((p) => (p.dotDotDotToken ? '...' : '') + p.name.getText());
  return '{\n'
    + `        // ${MARK} The body moved to \`${moduleFile}\`; it reaches this class through \`${HOST_MODULE_BASENAME}\`.\n`
    + `        return ${name}(${['protocolHost(this)', ...args].join(', ')});\n`
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
      edits.push({ start: r.stub.start, end: r.stub.end, text: stubBody(r.name, moduleFile, r.node) });
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
  const sf = ts.createSourceFile(HOST_PATH, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
function verify(T, baseText, headText, baseHostText, headHostText, moduleTexts) {
  const { ts, hs } = T;
  const failures = [];
  const moved = [];
  const checks = [];
  const baseSf = ts.createSourceFile(HOST_PATH, baseText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const headSf = ts.createSourceFile(HOST_PATH, headText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const baseCls = hs.classOf(baseSf, CLASS_NAME);
  const headCls = hs.classOf(headSf, CLASS_NAME);
  if (!baseCls || !headCls) return { failures: [`no class ${CLASS_NAME} at base or head`], moved, checks, linesBefore: 0, linesAfter: 0 };
  const table = hs.memberTable(headCls);
  const privateStatics = new Set([...table.statics].filter(([, s]) => s.private).map(([n]) => n));

  const modules = new Map();
  for (const [file, text] of moduleTexts) {
    if (!text.includes(MARK)) continue;
    const sf = ts.createSourceFile(join(SRC_DIR, file), text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
    const base = hs.methodOf(baseCls, name);
    if (!base) { failures.push(`${name}: no method of that name with a body at base`); continue; }
    const movedBody = mod.text.slice(fn.body.getStart(mod.sf), fn.body.getEnd());
    const restored = undoBody(ts, movedBody, privateStatics);
    const baseBody = baseText.slice(base.body.getStart(baseSf), base.body.getEnd());
    const identical = restored === baseBody;
    if (!identical) failures.push(`${name}: its moved body, rewrites and re-indentation undone, is not the base body`);
    moved.push({ name, module: hit[1], bodySha: sha256(restored), baseBodySha: sha256(baseBody), lines: baseBody.split('\n').length, identical, restored });
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
  const prune = pruneImports(ts, baseText, usedImportNames(ts, headText));
  const restoredBodies = moved.map((r) => r.restored).join('\n');
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

// ── Entry ────────────────────────────────────────────────────────────────────

const USAGE = [
  'usage: node scripts/codemod-split-protocol.mjs [--write]   plan (or apply) the split of an UNSPLIT protocol.ts',
  '       node scripts/codemod-split-protocol.mjs --verify --base REF   re-prove a split on disk against protocol.ts at REF',
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
  const known = new Set(['--write', '--verify', '--base']);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') { i += 1; continue; }
    if (!known.has(argv[i])) refuse(`unknown argument ${JSON.stringify(argv[i])}\n${USAGE}`);
  }
  const T = await loadTools();
  if (argv.includes('--verify')) {
    const i = argv.indexOf('--base');
    const ref = i >= 0 ? argv[i + 1] : null;
    if (!ref) refuse('--verify needs --base <ref>');
    const v = verify(T, gitShow(ref, `${SRC_REL}/${HOST_BASENAME}`), readFileSync(HOST_PATH, 'utf8'),
      gitShow(ref, `${SRC_REL}/${HOST_MODULE_BASENAME}`), readFileSync(HOST_MODULE_PATH, 'utf8'), generatedModulesOnDisk());
    printVerify(v);
    return v.failures.length === 0 ? 0 : 1;
  }
  const input = readFileSync(HOST_PATH, 'utf8');
  const hostInput = readFileSync(HOST_MODULE_PATH, 'utf8');
  if (input.includes(MARK)) refuse(`${HOST_BASENAME} already carries ${MARK} stubs: run the script on an unsplit file (re-run on the latest main, never on its own output)`);
  const planned = plan(T, input, hostInput);
  console.log(planReport(planned));
  const out = generate(T, input, hostInput, planned);
  const files = new Map([[HOST_BASENAME, out.host], [HOST_MODULE_BASENAME, out.hostModule], ...out.modules]);
  console.log(`output tree sha256: ${treeHash(files)} (input sha256 ${sha256(input)} + ${HOST_MODULE_BASENAME} ${sha256(hostInput)})`);
  const v = verify(T, input, out.host, hostInput, out.hostModule, out.modules);
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
  'stay rules': 15,
  'host entries': 4,
  'byte-identity proof': 9,
  'determinism': 2,
  'refusals': 6,
  'import prune': 4,
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
    stays('tiny', 'no-yield');
    stays('bareThis', 'closed-set');
    stays('viaConstructor', 'constructor-rewrite');
    moves('inferred', 'an inferred return type moves, as the hand series moved getMetaItems and validateData');
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
    check('the generated split proves against its base', v.failures.length === 0 && v.moved.length === 3 && v.checks.every((c) => c.ok),
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
