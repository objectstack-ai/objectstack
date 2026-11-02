#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * codemod-split-sql-driver — move whole sections of `SqlDriver`'s method
 * bodies out of `packages/drivers/driver-sql/src/sql-driver.ts` into section
 * modules, deterministically, and prove the move.
 *
 *   node scripts/codemod-split-sql-driver.mjs                 # plan: print the section table, write nothing
 *   node scripts/codemod-split-sql-driver.mjs --write         # apply the split, then verify it
 *   node scripts/codemod-split-sql-driver.mjs --verify --base <ref>
 *                                                             # re-prove a split on disk against sql-driver.ts at <ref>
 *   node scripts/codemod-split-sql-driver.mjs --dts <beforeDist> <afterDist>
 *                                                             # the declaration-file bar on two built dists
 *   node scripts/codemod-split-sql-driver.mjs --self-test
 *
 * ## Why a script, and what it repeats
 *
 * The hand series that split this file cut by cut (21 cuts) settled the cut
 * pattern; this script applies it to whole sections at once, so the split can
 * be regenerated on the latest `main` instead of rebased (ruling A on the
 * codemod card, `6583399215`). The pattern, unchanged:
 *
 *  - The method stays on the class with its docblock, modifiers and signature
 *    byte-for-byte, so the published `.d.ts` keeps its names and positions and
 *    an instance spy or a subclass override is still the one callers reach.
 *    Only `async` is dropped from a stub, as every async stub of the series did.
 *  - The body moves, unedited, into an exported function of the same name in
 *    `sql-driver-<section>.ts`, whose `this` is one named host: the `SqlDriver`
 *    members the body reads, typed AS the class members (`SqlDriver['x']`).
 *  - The stub hands the body that host: a method as a closure that calls it on
 *    the driver at call time, a field or accessor as a GETTER that reads it
 *    when the body reads it.
 *  - The module imports `sql-driver.ts` for types only, so the two form no
 *    evaluation cycle.
 *
 * ⛔ The moved text is not re-indented and not formatted: the body is the
 * method's `{ … }` exactly as it stood, so byte-identity is equality of text,
 * not equality after a transform.
 *
 * ## What stays, and why (each reason is mechanical)
 *
 * A method stays whole on the class when moving it would change what it does,
 * what the published `.d.ts` says, or what a gate or test that reads
 * `sql-driver.ts` BY PATH sees. `STAY_REASONS` lists every reason; the plan
 * prints, per section, every method that stayed and why. The two reasons that
 * are tables rather than rules are `PATH_READER_PINS` (a member whose body a
 * reader extracts from `sql-driver.ts` by path) and the tenant-chokepoint
 * spellings (`check-tenant-chokepoint` scans `sql-driver.ts` alone).
 *
 * ## The proof (`--write` runs it on its own output; `--verify` re-runs it)
 *
 *  1. Byte-identity: every generated function's body, parameters and return
 *     type are the base method's text, exactly; and putting every body back
 *     (and `async` back on its stub, and the generated imports out) rebuilds
 *     the base `sql-driver.ts` byte-for-byte, so nothing else in it moved.
 *  2. The declaration-file bar of ruling `6348891160` item 1, on the built
 *     `dist/index.d.ts` and `dist/index.d.mts` (`--dts`): the same declaration
 *     set; byte-identical after sorting the members of each string-literal
 *     union (the ruling's one normalisation, `normaliseUnionOrder`); the same
 *     export list; and a positive control (one private member made public)
 *     that the normaliser does not hide.
 *
 * ## Determinism
 *
 * The input is the text of `sql-driver.ts`. It is parsed in an in-memory
 * project (no `node_modules`, no build output, no clock), every collection is
 * emitted in source order or sorted, and the output is a pure function of the
 * input: two runs on one input write byte-identical trees.
 *
 * ts-morph is resolved through `@objectstack/cli`'s dependency closure
 * (`packages/cli/package.json` declares `ts-morph`), the way other root
 * scripts resolve a tool through the package that declares it; the root adds
 * no dependency for it.
 *
 * Exit codes: 0 done · 1 a proof failed (stop: the generated split is never
 * hand-edited to pass) · 2 the script could not run (unknown banner, missing
 * prerequisite, bad arguments).
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC_REL = 'packages/drivers/driver-sql/src';
const SRC_DIR = join(ROOT, SRC_REL);
const HOST_BASENAME = 'sql-driver.ts';
const HOST_PATH = join(SRC_DIR, HOST_BASENAME);
const CLASS_NAME = 'SqlDriver';
const CARD = '#29520';

/** The marker every generated file and stub carries; `--verify` keys on it. */
const MARK = `[${CARD} codemod]`;

/**
 * Every banner inside `SqlDriver`, in the file's two spellings
 * (`// ====` / `// Title` / `// ====`, and `// ── Title ───`), mapped to the
 * module its section's bodies move to. A banner the table does not name stops
 * the script (exit 2): a new section is a decision someone writes here, never a
 * name the script makes up. `null` keeps the section's methods on the class.
 *
 * Three titles name a section whose seam module the hand series already wrote
 * (`sql-driver-raw-execution.ts`, `sql-driver-transactions.ts`,
 * `sql-driver-schema-sync.ts`); the generated module never shares a file with a
 * hand-written one, so those three take a `-section` suffix.
 */
const SECTION_MODULES = Object.freeze({
  'Lifecycle': 'sql-driver-lifecycle.ts',
  'CRUD — IDataDriver core': 'sql-driver-crud.ts',
  'The sequence semantics a second face shares, stated once': 'sql-driver-sequence-semantics.ts',
  'Bulk & Batch Operations': 'sql-driver-bulk-operations.ts',
  'Raw Execution': 'sql-driver-raw-execution-section.ts',
  'Transactions': 'sql-driver-transactions-section.ts',
  'Aggregation': 'sql-driver-aggregation.ts',
  'Distinct': 'sql-driver-distinct.ts',
  'Window Functions': 'sql-driver-window-functions.ts',
  'Query Plan Analysis': 'sql-driver-query-plan.ts',
  'Schema Sync (syncSchema / init)': 'sql-driver-schema-sync-section.ts',
  'Data-lifecycle rotation (ADR-0057 P2)': 'sql-driver-rotation.ts',
  'Deferred schema DDL (#3917)': 'sql-driver-deferred-ddl.ts',
  'Managed-schema drift & reconcile (#2186)': 'sql-driver-managed-drift.ts',
  'Schema Introspection': 'sql-driver-schema-introspection.ts',
  'Internal helpers': 'sql-driver-internal-helpers.ts',
  'Filter helpers': 'sql-driver-filter-helpers.ts',
  'Field mapping': 'sql-driver-field-mapping.ts',
  'Window function builder': 'sql-driver-window-function-builder.ts',
  'Column creation helper': 'sql-driver-column-creation.ts',
  'Database helpers': 'sql-driver-database-helpers.ts',
  'SQLite serialisation': 'sql-driver-sqlite-serialisation.ts',
  'Introspection internals': 'sql-driver-introspection-internals.ts',
});

/**
 * Members whose body a reader takes out of `sql-driver.ts` BY PATH — moving the
 * body would leave that reader reading a stub. Each row names the reader. A row
 * naming a method the class no longer has stops the script (exit 2), so the
 * table cannot rot into names nobody reads.
 */
const PATH_READER_PINS = Object.freeze({
});

/**
 * The spellings `scripts/check-tenant-chokepoint.mjs` keys on. It scans
 * `sql-driver.ts` (and the two subclasses) and no seam module, so a body that
 * carries one stays where the gate reads it: its counts (read doors, tenant
 * predicates, D8 arms) must not move.
 */
const CHOKEPOINT_SPELLINGS = Object.freeze([
  'getBuilder',
  'applyTenantScope',
  'resolveTenantField',
  'computeTenantField',
  'computeAndRecordTenantField',
  'tenantField',
  "'organization_id'",
  '"organization_id"',
]);

/** Reserved words a function declaration may not be named. */
const RESERVED = new Set(('break case catch class const continue debugger default delete do else enum export extends ' +
  'false finally for function if import in instanceof new null return super switch this throw true try typeof var ' +
  'void while with implements interface let package private protected public static yield await').split(' '));

/** Every reason a method stays, with the one-line why the plan prints. */
const STAY_REASONS = Object.freeze({
  'no-section': 'declared before the first section banner',
  'section-kept': 'its section maps to no module',
  'static': 'a static member (the host is an instance)',
  'no-body': 'an overload signature or abstract member',
  'generator': 'a generator',
  'overloaded': 'an overloaded method',
  'decorated': 'a decorated method',
  'not-identifier-name': 'a computed, string or #private name',
  'reserved-name': 'its name is reserved for a function declaration',
  'inferred-return-type': 'a non-private method whose return type is inferred (the .d.ts would infer it through the module)',
  'type-parameters': 'a generic method (Function#call does not carry its type parameters)',
  'parameter-shape': 'a destructured, defaulted or `this` parameter (the stub cannot forward it unchanged)',
  'comment-in-parameters': 'a comment inside its parameter list (one-line parameters would drop it)',
  'tenant-chokepoint': 'its body carries a spelling check-tenant-chokepoint reads in sql-driver.ts only',
  'path-reader': 'a reader extracts its body from sql-driver.ts by path (PATH_READER_PINS)',
  'arguments': 'its body reads `arguments`',
  'super': 'its body reads `super`',
  'new-target': 'its body reads `new.target`',
  'this-type': 'it names the polymorphic `this` type',
  'bare-this': 'it uses `this` other than as `this.member`',
  'unknown-member': 'it reads a `this.member` the class does not declare',
  'this-write': 'it assigns a `this.member` (a host getter cannot be written)',
  'method-as-value': 'it reads a method as a value instead of calling it',
  'field-call': 'it calls a field or accessor as a function (the host would change its receiver)',
  'overloaded-host-method': 'it calls an overloaded method (the host closure cannot be typed)',
  'module-value': 'it reads a value declared in sql-driver.ts itself (a value import would make an evaluation cycle)',
  'module-local-type': 'it names a type sql-driver.ts declares without exporting it',
  'already-moved': 'its body is already a hand-series seam stub',
  'name-taken': 'its name is already a module-scope binding in sql-driver.ts',
  'name-collision': 'its name collides with an import its module needs',
  'parameter-shadows': 'a parameter shadows the moved function or a stub local',
  'no-yield': 'its stub would be no shorter than its body (moving it would grow sql-driver.ts)',
});

// ── Loading ts-morph ─────────────────────────────────────────────────────────

let tsMorph = null;

/** ts-morph through `@objectstack/cli`'s closure; a missing install is exit 2, never a stack trace. */
async function loadTsMorph() {
  if (tsMorph) return tsMorph;
  const manifest = join(ROOT, 'packages', 'cli', 'package.json');
  try {
    const resolved = createRequire(manifest).resolve('ts-morph');
    const mod = await import(pathToFileURL(resolved).href);
    tsMorph = mod.default ?? mod;
    return tsMorph;
  } catch (error) {
    console.error(
      `✗ codemod-split-sql-driver: PREREQUISITE NOT MET — ts-morph does not resolve from ${manifest} ` +
        `(${error && error.code ? error.code : 'error'}). Run \`pnpm install\` in this worktree.`,
    );
    process.exit(2);
  }
}

/** One in-memory project per parse: no file system, no lib, no build output. */
function parse(tm, fileName, text) {
  const project = new tm.Project({
    useInMemoryFileSystem: true,
    compilerOptions: { target: tm.ts.ScriptTarget.ES2020, strict: true, noLib: true, allowJs: false },
  });
  return project.createSourceFile(fileName, text, { overwrite: true });
}

/** A reason the script cannot run at all (exit 2) — never a verdict on the split. */
class CodemodRefusal extends Error {}

function refuse(message) {
  throw new CodemodRefusal(message);
}

// ── Reading the sections ─────────────────────────────────────────────────────

/** Banner lines inside the class body: `{ line, title }`, 1-based, in order. */
function readBanners(lines, fromLine, toLine) {
  const banners = [];
  for (let i = fromLine; i < toLine; i += 1) {
    const line = lines[i - 1];
    const rule = /^ {2}\/\/ ={3,}$/;
    if (rule.test(line) && i + 2 <= toLine && rule.test(lines[i + 1])) {
      const m = /^ {2}\/\/ (\S.*)$/.exec(lines[i]);
      if (m) {
        banners.push({ line: i, title: m[1].trim() });
        i += 2;
        continue;
      }
    }
    const dash = /^ {2}\/\/ ── (.+?) ─+$/.exec(line);
    if (dash) banners.push({ line: i, title: dash[1].trim() });
  }
  return banners;
}

// ── Analysis ─────────────────────────────────────────────────────────────────

/** The names sql-driver.ts binds at module scope, and which of them it exports. */
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
  const imports = new Map(); // local -> { specifier, importDecl, value }
  const localTypes = new Set(); // exported sql-driver.ts types it names

  if (m.isStatic()) add('static');
  if (!m.getBody()) add('no-body');
  if (m.isAbstract && m.isAbstract()) add('no-body');
  if (m.isGenerator()) add('generator');
  if (m.getOverloads().length > 0) add('overloaded');
  if (m.getDecorators().length > 0) add('decorated');
  const nameNode = m.getNameNode();
  if (!Node.isIdentifier(nameNode)) { add('not-identifier-name'); return { reasons, host, imports, localTypes }; }
  const name = nameNode.getText();
  if (RESERVED.has(name)) add('reserved-name');
  if (!m.getReturnTypeNode() && m.getScope() !== 'private') add('inferred-return-type');
  if (m.getTypeParameters().length > 0) add('type-parameters');
  for (const p of m.getParameters()) {
    if (!Node.isIdentifier(p.getNameNode()) || p.hasInitializer() || p.getName() === 'this') add('parameter-shape', p.getName());
  }
  const body = m.getBody();
  if (!body) return { reasons, host, imports, localTypes };

  // A comment between the parentheses that no parameter's own text carries.
  const params = m.getParameters();
  const open = m.getFirstChildByKindOrThrow(SyntaxKind.OpenParenToken);
  const close = m.getFirstChildByKindOrThrow(SyntaxKind.CloseParenToken);
  let between = ctx.text.slice(open.getEnd(), close.getStart());
  for (const p of [...params].reverse()) {
    between = between.slice(0, p.getStart() - open.getEnd()) + between.slice(p.getEnd() - open.getEnd());
  }
  if (/\/\/|\/\*/.test(between)) add('comment-in-parameters');

  const bodyText = body.getText();
  for (const spelling of CHOKEPOINT_SPELLINGS) if (bodyText.includes(spelling)) add('tenant-chokepoint', spelling);
  if (Object.prototype.hasOwnProperty.call(ctx.pins, name)) add('path-reader', ctx.pins[name]);

  const regions = [...m.getTypeParameters(), ...params, m.getReturnTypeNode(), body].filter(Boolean);
  const checker = ctx.sf.getProject().getTypeChecker().compilerObject;
  for (const region of regions) {
    const nodes = [region, ...region.getDescendants()];
    for (const node of nodes) {
      const kind = node.getKind();
      if (kind === SyntaxKind.SuperKeyword) add('super');
      if (kind === SyntaxKind.ThisType) add('this-type');
      if (Node.isMetaProperty(node) && node.getKeywordToken() === SyntaxKind.NewKeyword) add('new-target');
      if (kind === SyntaxKind.ThisKeyword) {
        if (thisContainer(tm, node) !== m) continue;
        const parent = node.getParent();
        if (!Node.isPropertyAccessExpression(parent) || parent.getExpression() !== node) { add('bare-this'); continue; }
        const memberNameNode = parent.getNameNode();
        if (!Node.isIdentifier(memberNameNode)) { add('bare-this'); continue; }
        const member = memberNameNode.getText();
        const info = ctx.members.get(member);
        if (!info) { add('unknown-member', member); continue; }
        if (isWritten(tm, parent)) add('this-write', member);
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
        const declName = decl.name && ts.isIdentifier(decl.name) ? decl.name.text : node.getText();
        const isTypeDecl = ts.isInterfaceDeclaration(decl) || ts.isTypeAliasDeclaration(decl);
        if (!typePos || !(isTypeDecl || ts.isClassDeclaration(decl) || ts.isEnumDeclaration(decl))) {
          add('module-value', declName);
        } else if (!ctx.scope.exported.has(declName)) {
          add('module-local-type', declName);
        } else {
          localTypes.add(declName);
        }
      }
    }
  }

  const binding = ctx.scope.bindings.get(name);
  if (binding) {
    if (binding.kind === 'import' && /^\.\/sql-driver-[a-z0-9-]+\.js$/.test(binding.specifier)) add('already-moved', binding.specifier);
    else add('name-taken');
  }
  for (const p of params) {
    const pn = p.getName();
    if (pn === name || pn === 'host' || /^read[A-Z]/.test(pn)) add('parameter-shadows', pn);
  }
  return { reasons, host, imports, localTypes };
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

/** `sql-driver-raw-execution-section.ts` -> `RawExecutionSectionHost`. */
function hostNameOf(moduleFile) {
  const slug = moduleFile.replace(/^sql-driver-/, '').replace(/\.ts$/, '');
  return `${slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('')}Host`;
}

/**
 * Read `text` (a `sql-driver.ts`) and decide, per method, where its body goes.
 * Pure: the same text gives the same plan.
 */
function plan(tm, text, { sections = SECTION_MODULES, pins = PATH_READER_PINS } = {}) {
  const sf = parse(tm, HOST_PATH, text);
  const cls = sf.getClass(CLASS_NAME);
  if (!cls) refuse(`no class ${CLASS_NAME} in ${HOST_BASENAME}`);
  const lines = text.split('\n');
  const banners = readBanners(lines, cls.getStartLineNumber(), cls.getEndLineNumber());
  const unknown = banners.filter((b) => !Object.prototype.hasOwnProperty.call(sections, b.title));
  if (unknown.length > 0) {
    refuse(`banner(s) the section table does not name: ${unknown.map((b) => `"${b.title}" (line ${b.line})`).join(', ')}. ` +
      'Add each to SECTION_MODULES (a module name, or null to keep the section on the class).');
  }
  const ctx = { text, sf, members: instanceMembers(tm, cls), scope: moduleScope(tm, sf) };
  const methodNames = new Set(cls.getMethods().map((m) => m.getName()));
  const stalePins = Object.keys(pins).filter((n) => !methodNames.has(n));
  if (stalePins.length > 0) refuse(`PATH_READER_PINS names method(s) the class no longer has: ${stalePins.join(', ')}`);

  const records = [];
  const seen = new Set();
  for (const m of cls.getMethods()) {
    const startLine = m.getStartLineNumber(true);
    let banner = null;
    for (const b of banners) if (b.line < startLine) banner = b;
    const read = readMethod(tm, { ...ctx, pins }, m);
    const name = m.getName();
    const firstOfName = !seen.has(name);
    seen.add(name);
    if (!banner) read.reasons.unshift('no-section');
    else if (sections[banner.title] === null) read.reasons.unshift('section-kept');
    const lineCount = m.getEndLineNumber() - startLine + 1;
    const body = m.getBody();
    const bodyLines = body ? body.getEndLineNumber() - body.getStartLineNumber() + 1 : 0;
    const record = {
      name, node: m, section: banner ? banner.title : null, module: banner ? sections[banner.title] : null,
      startLine, lineCount, bodyLines, firstOfName, ...read,
    };
    if (record.reasons.length === 0) {
      record.stubLines = stubBody(record, record.module, '  ').split('\n').length;
      if (record.stubLines >= bodyLines) record.reasons.push('no-yield');
    }
    records.push(record);
  }

  // A function name its module's imports already use: drop it, recompute, until stable.
  for (let changed = true; changed;) {
    changed = false;
    const byModule = groupMovers(records);
    for (const [moduleFile, movers] of byModule) {
      const taken = new Set(['SqlDriver', hostNameOf(moduleFile), 'ThisParameterType', 'Pick']);
      for (const r of movers) {
        for (const local of r.imports.keys()) taken.add(local);
        for (const t of r.localTypes) taken.add(t);
      }
      for (const r of movers) {
        if (taken.has(r.name)) { r.reasons.push('name-collision'); changed = true; }
      }
    }
  }
  return { sf, cls, ctx, banners, records, modules: groupMovers(records) };
}

/** Movers grouped by module, modules in the order their first banner appears. */
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

const readerName = (member) => `read${member[0].toUpperCase()}${member.slice(1)}`;

/** The import lines a module needs, in sql-driver.ts's own import order. */
function importLines(scope, movers, needsHost) {
  const bySpecifier = new Map();
  for (const r of movers) {
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
    const entries = [...bySpecifier.get(specifier).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
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
  const localTypes = [...new Set(movers.flatMap((r) => [...r.localTypes]))].sort();
  const fromHost = [...(needsHost ? ['SqlDriver'] : []), ...localTypes.filter((t) => t !== 'SqlDriver')];
  if (fromHost.length > 0) out.push(`import type { ${fromHost.join(', ')} } from './sql-driver.js';`);
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

function moduleText(moduleFile, title, movers, scope) {
  const hostName = hostNameOf(moduleFile);
  const hostMembers = new Map();
  for (const r of movers) for (const [member, kind] of r.host) hostMembers.set(member, kind);
  const needsHost = hostMembers.size > 0;
  const names = movers.map((r) => `\`${r.name}\`${r === movers[movers.length - 1] ? '' : ','}`);
  const out = [];
  out.push('// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.');
  out.push('');
  out.push('/**');
  out.push(...wrapComment([MARK, 'The', `"${title}"`, 'section', 'of', '`SqlDriver`:', 'the', 'bodies', 'of',
    ...names, 'moved', 'out', 'of', '`sql-driver.ts`', 'whole', 'by', '`scripts/codemod-split-sql-driver.mjs`.']));
  out.push(' *');
  out.push(' * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`');
  out.push(' * method of the same name exactly as it stood: not re-indented, not');
  out.push(' * formatted, not edited. The method stays on the class with its docblock and');
  out.push(' * signature, so the published `dist/*.d.ts`, an instance spy and a subclass');
  out.push(' * override are what they were; the docblock there is the contract.');
  out.push(' *');
  if (needsHost) {
    out.push(` * The bodies reach the class through {@link ${hostName}}: exactly the`);
    out.push(' * `SqlDriver` members they read. Each method hands its body one literal of the');
    out.push(' * members that body reads, plus a `.call`: methods go as closures that call');
    out.push(' * them on the driver at call time, so a subclass override or an instance spy');
    out.push(' * is still the one reached; fields and accessors go as GETTERS, read when the');
    out.push(' * body reads them, as they were on the class.');
    out.push(' *');
    out.push(' * The module imports `sql-driver.ts` for types only, so the two modules form');
    out.push(' * no evaluation cycle. `index.ts` re-exports nothing from this module.');
  } else {
    out.push(' * No body reads a `SqlDriver` member, so each method calls its function');
    out.push(' * directly. `index.ts` re-exports nothing from this module.');
  }
  out.push(' */');
  out.push('');
  out.push(...importLines(scope, movers, needsHost));
  if (needsHost) {
    out.push('');
    out.push('/**');
    out.push(' * The `SqlDriver` members the functions below read — every one of them, and');
    out.push(' * no other. Each is typed AS the class member (an indexed access on the');
    out.push(' * class), so a change to a member\'s signature on the class is a change here');
    out.push(' * too. `readonly` members are the getters.');
    out.push(' */');
    out.push(`export interface ${hostName} {`);
    for (const member of [...hostMembers.keys()].sort()) {
      out.push(`  ${hostMembers.get(member) === 'getter' ? 'readonly ' : ''}${member}: SqlDriver['${member}'];`);
    }
    out.push('}');
  }
  for (const r of movers) {
    const m = r.node;
    const picks = [...r.host.keys()].sort().map((k) => `'${k}'`).join(' | ');
    const params = [...(r.host.size > 0 ? [`this: Pick<${hostName}, ${picks}>`] : []), ...paramsText(m)];
    const ret = m.getReturnTypeNode() ? `: ${m.getReturnTypeNode().getText()}` : '';
    out.push('');
    out.push(`/** The body of \`SqlDriver#${r.name}\`; the method's docblock there is its contract. */`);
    out.push(`export ${m.isAsync() ? 'async ' : ''}function ${r.name}(${params.join(', ')})${ret} ${m.getBody().getText()}`);
  }
  out.push('');
  return out.join('\n');
}

function stubBody(r, moduleFile, closeIndent) {
  const ind = `${closeIndent}  `;
  const hostName = hostNameOf(moduleFile);
  const out = ['{'];
  const args = forwardList(r.node).join(', ');
  if (r.host.size === 0) {
    out.push(`${ind}// ${MARK} The body moved to \`${moduleFile}\`.`);
    out.push(`${ind}return ${r.name}(${args});`);
  } else {
    out.push(`${ind}// ${MARK} The body moved to \`${moduleFile}\` (see \`${hostName}\`).`);
    const members = [...r.host.keys()].sort();
    for (const member of members) {
      if (r.host.get(member) === 'getter') out.push(`${ind}const ${readerName(member)} = () => this.${member};`);
    }
    out.push(`${ind}const host: ThisParameterType<typeof ${r.name}> = {`);
    for (const member of members) {
      out.push(r.host.get(member) === 'getter'
        ? `${ind}  get ${member}() { return ${readerName(member)}(); },`
        : `${ind}  ${member}: (...a) => this.${member}(...a),`);
    }
    out.push(`${ind}};`);
    out.push(`${ind}return ${r.name}.call(host${args ? `, ${args}` : ''});`);
  }
  out.push(`${closeIndent}}`);
  return out.join('\n');
}

/**
 * Apply a plan to `text`. Returns `{ host, modules }`: the new `sql-driver.ts`
 * and a Map of module basename -> text. Pure.
 */
function generate(tm, text, planned) {
  const { sf, ctx, modules } = planned;
  const edits = [];
  const importBlock = [];
  for (const [moduleFile, movers] of modules) {
    const title = movers[0].section;
    const hostName = hostNameOf(moduleFile);
    const anyHost = movers.some((r) => r.host.size > 0);
    importBlock.push(`\n// ${MARK} ${title}: the methods of the same names below hand the bodies` +
      `${anyHost ? ` what they read (\`${hostName}\`)` : ' their arguments'}.`);
    importBlock.push(`\nimport { ${movers.map((r) => r.name).sort().join(', ')} } from './${moduleFile.replace(/\.ts$/, '.js')}';`);
    for (const r of movers) {
      const body = r.node.getBody();
      const lineStart = text.lastIndexOf('\n', body.getEnd() - 1) + 1;
      const closeIndent = text.slice(lineStart, body.getEnd() - 1);
      if (!/^ *$/.test(closeIndent)) refuse(`${r.name}: the body's closing brace does not open its own line`);
      edits.push({ start: body.getStart(), end: body.getEnd(), text: stubBody(r, moduleFile, closeIndent) });
      const asyncKw = r.node.getModifiers().find((x) => x.getKind() === tm.SyntaxKind.AsyncKeyword);
      if (asyncKw) edits.push({ start: asyncKw.getStart(), end: r.node.getNameNode().getStart(), text: '' });
    }
  }
  const lastImport = sf.getImportDeclarations().at(-1);
  if (!lastImport) refuse('sql-driver.ts has no import declaration to place the generated imports after');
  if (importBlock.length > 0) edits.push({ start: lastImport.getEnd(), end: lastImport.getEnd(), text: importBlock.join('') });
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Infinity;
  for (const e of edits) {
    if (e.end > floor) refuse('overlapping edits');
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    floor = e.start;
  }
  const moduleTexts = new Map();
  for (const [moduleFile, movers] of modules) {
    moduleTexts.set(moduleFile, moduleText(moduleFile, movers[0].section, movers, ctx.scope));
  }
  return { host: out, modules: moduleTexts };
}

// ── Proof 1: byte-identity ───────────────────────────────────────────────────

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Prove a split against its base, from the texts alone (it shares no state with
 * `generate`): every generated function is its base method's text, and undoing
 * the split rebuilds the base `sql-driver.ts` byte-for-byte.
 *
 * Returns `{ failures, moved, linesBefore, linesAfter }`; no failure = proved.
 */
function verify(tm, baseText, headText, moduleTexts) {
  const { Node, SyntaxKind } = tm;
  const failures = [];
  const moved = [];
  const baseSf = parse(tm, HOST_PATH, baseText);
  const baseCls = baseSf.getClass(CLASS_NAME);
  const headSf = parse(tm, HOST_PATH, headText);
  const headCls = headSf.getClass(CLASS_NAME);
  if (!baseCls || !headCls) return { failures: [`no class ${CLASS_NAME} at base or head`], moved, linesBefore: 0, linesAfter: 0 };

  const modules = new Map();
  for (const [file, text] of moduleTexts) {
    if (!text.includes(MARK)) continue;
    const sf = parse(tm, join(SRC_DIR, file), text);
    const fns = new Map();
    for (const st of sf.getStatements()) {
      if (Node.isFunctionDeclaration(st)) fns.set(st.getName(), st);
      else if (!Node.isImportDeclaration(st) && !Node.isInterfaceDeclaration(st)) {
        failures.push(`${file}: a top-level statement that is neither an import, the host interface nor a moved function: ${st.getText().slice(0, 60)}`);
      }
    }
    modules.set(file, { sf, fns, claimed: new Set() });
  }

  const marker = new RegExp(`^\\{\\s*// ${MARK.replace(/[[\]]/g, '\\$&')} The body moved to \`(sql-driver-[a-z0-9-]+\\.ts)\``);
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
    const base = baseCls.getMethod(name);
    if (!base || !base.getBody()) { failures.push(`${name}: no method of that name with a body at base`); continue; }
    const fnParams = fn.getParameters().filter((p) => p.getName() !== 'this').map((p) => p.getText());
    const baseParams = base.getParameters().map((p) => p.getText());
    const same = {
      body: fn.getBody().getText() === base.getBody().getText(),
      params: JSON.stringify(fnParams) === JSON.stringify(baseParams),
      returnType: (fn.getReturnTypeNode()?.getText() ?? null) === (base.getReturnTypeNode()?.getText() ?? null),
      async: fn.isAsync() === base.isAsync(),
      typeParameters: fn.getTypeParameters().length === 0 && base.getTypeParameters().length === 0,
    };
    for (const [what, ok] of Object.entries(same)) if (!ok) failures.push(`${name}: the generated function's ${what} is not the base method's`);
    moved.push({
      name, module: hit[1], bodySha: sha256(fn.getBody().getText()), baseBodySha: sha256(base.getBody().getText()),
      lines: base.getBody().getEndLineNumber() - base.getBody().getStartLineNumber() + 1, ...same,
    });
    edits.push({ start: body.getStart(), end: body.getEnd(), text: fn.getBody().getText() });
    if (fn.isAsync()) edits.push({ start: m.getNameNode().getStart(), end: m.getNameNode().getStart(), text: 'async ' });
  }
  for (const [file, mod] of modules) {
    for (const name of mod.fns.keys()) if (!mod.claimed.has(name)) failures.push(`${file}: function ${name} has no stub on the class`);
  }
  for (const imp of headSf.getImportDeclarations()) {
    const hit = /^\.\/(sql-driver-[a-z0-9-]+)\.js$/.exec(imp.getModuleSpecifierValue());
    if (hit && modules.has(`${hit[1]}.ts`)) edits.push({ start: imp.getFullStart(), end: imp.getEnd(), text: '' });
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let rebuilt = headText;
  for (const e of edits) rebuilt = rebuilt.slice(0, e.start) + e.text + rebuilt.slice(e.end);
  if (rebuilt !== baseText) {
    const a = rebuilt.split('\n');
    const b = baseText.split('\n');
    let i = 0;
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i += 1;
    failures.push(`undoing the split does not rebuild the base sql-driver.ts: first difference at line ${i + 1}` +
      `\n    rebuilt: ${JSON.stringify(a[i] ?? '<end>')}\n    base:    ${JSON.stringify(b[i] ?? '<end>')}`);
  }
  if (moved.length === 0) failures.push('no moved method found: a proof over nothing is not a proof');
  return { failures, moved, linesBefore: baseText.split('\n').length, linesAfter: headText.split('\n').length };
}

// ── Proof 2: the declaration-file bar (ruling 6348891160 item 1) ─────────────

/**
 * The ruling's one normalisation, verbatim: sort the members of each run of
 * string-literal union members in place. Nothing else is normalised.
 */
const NORMALISER_ONE_LINER =
  'node -e \'const s=require("fs").readFileSync(process.argv[1],"utf8");process.stdout.write(s.replace(/"[^"\\n]*"(?:\\s*\\|\\s*"[^"\\n]*")+/g,r=>r.split(/\\s*\\|\\s*/).sort().join(" | ")))\' FILE | sha256sum';

function normaliseUnionOrder(text) {
  return text.replace(/"[^"\n]*"(?:\s*\|\s*"[^"\n]*")+/g, (r) => r.split(/\s*\|\s*/).sort().join(' | '));
}

/** Export names of a bundled `.d.ts`: every `export { … }` list, plus `export <decl> Name`. */
function dtsExportNames(text) {
  const names = new Set();
  for (const m of text.matchAll(/^export\s*(?:type\s*)?\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const t = part.trim().replace(/^type\s+/, '');
      if (!t) continue;
      const as = /\bas\s+([\w$]+)$/.exec(t);
      names.add(as ? as[1] : t);
    }
  }
  for (const m of text.matchAll(/^export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|function|const|let|var|enum|namespace)\s+([\w$]+)/gm)) names.add(m[1]);
  return [...names].sort();
}

/** One positive control: the first `private` member made public. */
function injectVisibilityChange(text) {
  const at = text.search(/^ {4}private /m);
  return at < 0 ? null : text.slice(0, at) + '    ' + text.slice(at + '    private '.length);
}

/** The bar on one declaration file pair. Returns `{ failures, reading }`. */
function dtsBarFor(file, before, after) {
  const failures = [];
  const nb = normaliseUnionOrder(before);
  const na = normaliseUnionOrder(after);
  const bl = before.split('\n');
  const al = after.split('\n');
  let rawDiffLines = 0;
  if (bl.length !== al.length) {
    failures.push(`${file}: ${bl.length} lines at base, ${al.length} at head — a line added or removed is a declaration change, outside the ruling`);
  } else {
    for (let i = 0; i < bl.length; i += 1) {
      if (bl[i] === al[i]) continue;
      rawDiffLines += 1;
      if (normaliseUnionOrder(bl[i]) !== normaliseUnionOrder(al[i])) {
        failures.push(`${file}:${i + 1} differs other than by union member order:\n    base: ${bl[i].trim()}\n    head: ${al[i].trim()}`);
      }
    }
  }
  if (nb !== na) failures.push(`${file}: normalised base and head differ`);
  const eb = dtsExportNames(before);
  const ea = dtsExportNames(after);
  if (JSON.stringify(eb) !== JSON.stringify(ea)) failures.push(`${file}: the export list differs (${eb.length} at base, ${ea.length} at head)`);
  const control = injectVisibilityChange(after);
  const controlSha = control === null ? null : sha256(normaliseUnionOrder(control));
  if (control === null) failures.push(`${file}: no private member to make public — the positive control could not run (INCONCLUSIVE)`);
  else if (controlSha === sha256(nb)) failures.push(`${file}: the positive control normalises to the base hash — the normaliser hides a visibility change (INCONCLUSIVE)`);
  return {
    failures,
    reading: {
      file,
      rawBase: sha256(before), rawHead: sha256(after), rawDiffLines,
      normalisedBase: sha256(nb), normalisedHead: sha256(na),
      exportsBase: eb.length, exportsHead: ea.length,
      positiveControl: controlSha,
    },
  };
}

function dtsBar(beforeDir, afterDir) {
  const failures = [];
  const readings = [];
  for (const file of ['index.d.ts', 'index.d.mts']) {
    const b = join(beforeDir, file);
    const a = join(afterDir, file);
    if (!existsSync(b) || !existsSync(a)) refuse(`--dts: ${file} missing under ${existsSync(b) ? afterDir : beforeDir}`);
    const r = dtsBarFor(file, readFileSync(b, 'utf8'), readFileSync(a, 'utf8'));
    failures.push(...r.failures);
    readings.push(r.reading);
  }
  return { failures, readings };
}

// ── Reports ──────────────────────────────────────────────────────────────────

function planReport(planned) {
  const out = [];
  const bySection = new Map();
  for (const r of planned.records) {
    const key = r.section ?? '(before the first banner)';
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
  console.log(`byte-identity: ${identical}/${v.moved.length} moved bodies identical to base (body, parameters, return type, async); ` +
    `sql-driver.ts ${v.linesBefore} -> ${v.linesAfter} lines; undoing the split ${v.failures.some((f) => f.startsWith('undoing')) ? 'does NOT' : 'does'} rebuild the base byte-for-byte`);
}

function gitShow(ref, path) {
  return execFileSync('git', ['show', `${ref}:${path}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
}

function generatedModulesOnDisk() {
  const out = new Map();
  for (const file of Object.values(SECTION_MODULES)) {
    if (!file) continue;
    const p = join(SRC_DIR, file);
    if (existsSync(p)) out.set(file, readFileSync(p, 'utf8'));
  }
  return out;
}

// ── Entry ────────────────────────────────────────────────────────────────────

async function main(argv) {
  if (argv.includes('--self-test')) {
    await selfTest();
    if (process.exitCode === 1) return 1;
    if (!selfTestReachedVerdict) {
      console.error('\n✗ codemod-split-sql-driver self-test: selfTest() returned without reaching its verdict,\n' +
        'so no success line was printed. Exiting 0 here would report a self-test that never\n' +
        'finished as a self-test that passed.');
      return 1;
    }
    return 0;
  }
  if (argv.includes('--dts')) {
    const i = argv.indexOf('--dts');
    const [before, after] = [argv[i + 1], argv[i + 2]];
    if (!before || !after) refuse('--dts needs <beforeDist> <afterDist>');
    const { failures, readings } = dtsBar(before, after);
    console.log(`normaliser (ruling 6348891160 item 2, verbatim): ${NORMALISER_ONE_LINER}`);
    for (const r of readings) console.log(JSON.stringify(r));
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.log(failures.length === 0 ? '✓ declaration-file bar: PASS' : `✗ declaration-file bar: FAIL (${failures.length})`);
    return failures.length === 0 ? 0 : 1;
  }
  const tm = await loadTsMorph();
  if (argv.includes('--verify')) {
    const i = argv.indexOf('--base');
    const ref = i >= 0 ? argv[i + 1] : null;
    if (!ref) refuse('--verify needs --base <ref>');
    const v = verify(tm, gitShow(ref, `${SRC_REL}/${HOST_BASENAME}`), readFileSync(HOST_PATH, 'utf8'), generatedModulesOnDisk());
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
  const v = verify(tm, input, out.host, out.modules);
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
  'declaration bar': 6,
  'stay rules': 9,
  'byte-identity proof': 6,
  'refusals': 2,
});
const SELF_TEST_BATTERY_FLOOR = 4;

const FIXTURE_SECTIONS = Object.freeze({ 'Lifecycle': 'sql-driver-lifecycle.ts', 'Kept': null });

function fixtureSource(extraMethods = '') {
  const pad = Array.from({ length: 12 }, (_, i) => `    const p${i} = ${i};`).join('\n');
  return `import type { Knex } from 'knex';
import { helperImported } from './other.js';

const LOCAL_VALUE = 1;
type LocalType = { n: number };
export interface ExportedShape { a: number }

export class SqlDriver {
  private knex: any = null;
  protected logger: { warn(m: string): void } = console;
  private count = 0;
  private readonly fn = (x: string): string => x;

  // ===================================
  // Lifecycle
  // ===================================

  /** Docblock that stays. */
  protected async movable(object: string, trx?: Knex.Transaction): Promise<string> {
${pad}
    const a = helperImported(object) as ExportedShape | string;
    this.logger.warn(String(a));
    return this.other(String(a)) + String(trx ? this.count : 0);
  }

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
    return LOCAL_VALUE;
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
${extraMethods}
  // ===================================
  // Kept
  // ===================================

  protected keptSection(): number {
${pad}
    return 2;
  }
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

  open('declaration bar');
  {
    const base = 'export declare class A {\n    private x;\n    t: "b" | "a";\n}\nexport { A };\n';
    const swapped = base.replace('"b" | "a"', '"a" | "b"');
    check('a union-member swap passes, and is counted as one raw diff line',
      (() => { const r = dtsBarFor('f', base, swapped); return r.failures.length === 0 && r.reading.rawDiffLines === 1; })());
    check('the normaliser sorts union members and nothing else', normaliseUnionOrder('x: "b" | "a"; y: B | A') === 'x: "a" | "b"; y: B | A');
    check('a retyped member fails', dtsBarFor('f', base, base.replace('"b" | "a"', '"b" | "c"')).failures.length > 0);
    check('a private member made public fails (the positive control the bar runs)',
      dtsBarFor('f', base, base.replace('    private x;', '    x;')).failures.length > 0);
    check('an added line fails', dtsBarFor('f', base, base.replace('}\n', '    y: number;\n}\n')).failures.length > 0);
    check('a changed export list fails', dtsBarFor('f', base, base.replace('export { A };', 'export { A as B };')).failures.length > 0);
  }

  open('stay rules');
  {
    const planned = plan(tm, fixtureSource(), { sections: FIXTURE_SECTIONS, pins: {} });
    const why = (name) => (planned.records.find((r) => r.name === name)?.reasons ?? ['<absent>']).join('; ');
    const stays = (name, code) => check(`${name} stays (${code})`, why(name).split('; ').some((r) => r.startsWith(code)), why(name));
    check('movable moves', why('movable') === '', why('movable'));
    stays('other', 'no-yield');
    stays('writes', 'this-write');
    stays('asValue', 'method-as-value');
    stays('readsLocal', 'module-value');
    stays('namesLocalType', 'module-local-type');
    stays('inferred', 'inferred-return-type');
    stays('scoped', 'tenant-chokepoint');
    stays('defaulted', 'parameter-shape');
  }

  open('byte-identity proof');
  {
    const input = fixtureSource();
    const planned = plan(tm, input, { sections: FIXTURE_SECTIONS, pins: {} });
    const out = generate(tm, input, planned);
    const again = generate(tm, input, plan(tm, input, { sections: FIXTURE_SECTIONS, pins: {} }));
    const v = verify(tm, input, out.host, out.modules);
    check('the generated split proves against its base', v.failures.length === 0 && v.moved.map((m) => m.name).join() === 'movable',
      [...v.failures, `moved: ${v.moved.map((m) => m.name).join()}`].join(' | '));
    check('two runs on one input write byte-identical trees',
      treeHash(new Map([['h', out.host], ...out.modules])) === treeHash(new Map([['h', again.host], ...again.modules])));
    const mod = out.modules.get('sql-driver-lifecycle.ts');
    const edited = new Map([['sql-driver-lifecycle.ts', mod.replace('const p3 = 3;', 'const p3 = 4;')]]);
    check('one edited character in a moved body fails', verify(tm, input, out.host, edited).failures.length > 0);
    check('an edited stub signature fails',
      verify(tm, input, out.host.replace('trx?: Knex.Transaction): Promise<string>', 'trx?: Knex.Transaction): Promise<String>'), out.modules).failures.length > 0);
    check('an extra top-level statement in a module fails',
      verify(tm, input, out.host, new Map([['sql-driver-lifecycle.ts', `${mod}\nexport const extra = 1;\n`]])).failures.length > 0);
    check('a proof over no moved method fails', verify(tm, input, input, new Map()).failures.length > 0);
  }

  open('refusals');
  {
    const unknownBanner = fixtureSource('\n  // ── Unnamed section ──────────\n\n  protected z(): number {\n    return 1;\n  }\n');
    check('a banner the section table does not name refuses', refused(() => plan(tm, unknownBanner, { sections: FIXTURE_SECTIONS, pins: {} })));
    check('a pin naming a method the class lacks refuses', refused(() => plan(tm, fixtureSource(), { sections: FIXTURE_SECTIONS, pins: { gone: 'x' } })));
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
    console.error(`\n✗ codemod-split-sql-driver self-test: ${failed} failure(s) (cases and floor).`);
    process.exitCode = 1;
    selfTestReachedVerdict = true;
    return;
  }
  console.log(`\n✓ codemod-split-sql-driver self-test: ${cases} cases in ${declared.length} batteries pass.`);
  selfTestReachedVerdict = true;
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      if (error instanceof CodemodRefusal) {
        console.error(`✗ codemod-split-sql-driver: ${error.message}`);
        process.exit(2);
      }
      console.error(error);
      process.exit(2);
    },
  );
}
