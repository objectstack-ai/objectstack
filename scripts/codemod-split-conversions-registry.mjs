#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * codemod-split-conversions-registry — move every conversion entry of
 * `packages/spec/src/conversions/registry.ts` into a module of its own,
 * deterministically, and prove the move.
 *
 *   node scripts/codemod-split-conversions-registry.mjs              # plan: print the module table, write nothing
 *   node scripts/codemod-split-conversions-registry.mjs --write      # apply the split, then verify it
 *   node scripts/codemod-split-conversions-registry.mjs --verify --base REF
 *                                                                    # re-prove a split on disk against registry.ts at REF
 *   node scripts/codemod-split-conversions-registry.mjs --arrays --base REF
 *                                                                    # load both registries and compare what they export
 *   node scripts/codemod-split-conversions-registry.mjs --dts BEFORE_DIST AFTER_DIST
 *                                                                    # the declaration-file bar on two built dists
 *   node scripts/codemod-split-conversions-registry.mjs --self-test
 *   node scripts/codemod-split-conversions-registry.mjs --help
 *
 * ## Why a script, and what it does
 *
 * Ruling A on the large-file programme (`6583399215`) splits `registry.ts`
 * into per-entry files by a script, so the split is REGENERATED on the latest
 * `main` at landing instead of rebased. The file is a table, not a class: a
 * run of conversion definitions and the helpers they share, then the tables
 * that list them (`MAJOR_18_CONVERSIONS`, `CONVERSIONS_BY_MAJOR`,
 * `ALL_CONVERSIONS`). The shape, mechanically:
 *
 *  - Each conversion (a top-level `const NAME: MetadataConversion = { id, toMajor, … }`)
 *    moves WHOLE, with the comments above it, to `entries/<toMajor>/<id>.ts`,
 *    which ends with one generated `export { NAME };` (the declaration's own
 *    text is not touched).
 *  - A top-level helper every one of whose readers moves moves too (pilot
 *    ruling `6591753301` lever (b): out-of-class top-level helpers move whole
 *    into leaf modules). A helper that only one conversion reaches moves into
 *    that conversion's module; a helper two or more reach moves into one
 *    shared leaf, `entries/shared.ts`. Every module keeps its statements in
 *    base order.
 *  - Everything else stays in `registry.ts`, byte for byte: the module
 *    docblock, `OrderedConversion`, `inApplicationOrder`, and the three tables
 *    with every `@__PURE__` marker. Its import declarations are regenerated:
 *    the base imports it still reads, then one import per conversion, in the
 *    order the definitions stood in the file (so a retirement's import line
 *    lands where its definition used to, and two in flight still spread over
 *    different gaps).
 *  - Leaves: `entries/shared.ts` imports neither `registry.ts` nor a
 *    conversion's module, and a conversion's module imports neither
 *    `registry.ts` nor another conversion's module. Nothing forms a cycle, so
 *    evaluation order is the import order of `registry.ts`, and every table
 *    reads modules already evaluated.
 *  - Nothing a consumer can reach changes: `registry.ts` exports the same two
 *    names (`CONVERSIONS_BY_MAJOR`, `ALL_CONVERSIONS`) at the same import
 *    path, both explicitly typed, and no generated `export` is re-exported by
 *    an entry point.
 *
 * ⛔ The moved text is not re-indented and not formatted: each statement is
 * its base text exactly (`getFullText()`: its leading comments and the blank
 * lines above it included), so byte-identity is equality of text.
 *
 * ## The proof (`--write` runs it on its own output; `--verify` re-runs it)
 *
 *  1. Byte-identity: every statement of every generated module, the
 *     generated imports and the generated `export { … }` aside, is the base
 *     statement of the same name, exactly, in base order; every statement that
 *     stayed is its base text exactly; every base statement is found exactly
 *     once; and putting the moved statements back between the ones that stayed
 *     (base's import declarations in place of the generated ones) rebuilds the
 *     base `registry.ts` byte-for-byte.
 *  2. Bindings: every name a generated import brings in resolves to the file
 *     the base import of that name resolved to, with the same `type`-ness; no
 *     generated import is unused; the leaves import as stated above; each
 *     conversion's module sits at `entries/<toMajor>/<id>.ts` read off its own
 *     literal and exports exactly that conversion; `registry.ts` exports what
 *     base exported.
 *  3. `--arrays`: both registries loaded under `tsx` (base = this tree's
 *     `packages/spec/src` with `conversions/` taken from REF) export the same
 *     `ALL_CONVERSIONS` ids in the same order, the same majors in
 *     `CONVERSIONS_BY_MAJOR` with the same ids in the same order, and each
 *     conversion is the same value (a digest over its JSON with every
 *     function's source text).
 *  4. `--dts`: the declaration-file bar of ruling `6348891160` item 1 on
 *     every `*.d.ts` / `*.d.mts` / `*.d.cts` of two built `dist/` trees: the
 *     same file set; each file byte-identical, or byte-identical after the
 *     ruling's one normalisation (string-literal union member order); the
 *     same export list; and a positive control (one injected change of kind)
 *     the bar must catch. A diff the union normaliser does not close is ruling
 *     `6441032442` B's case: its second normalisation is a report reading kept
 *     out of `scripts/` (item 3 there), so this mode reports the fork.
 *
 * ## Determinism
 *
 * The input is the text of `registry.ts`. It is parsed in an in-memory
 * project (no `node_modules`, no build output, no clock); every collection is
 * emitted in source order or sorted, so two runs on one input write
 * byte-identical trees (`output tree sha256`).
 *
 * ## Regenerating (the landing window)
 *
 * On the latest `main`, from the repository root:
 *
 *   node scripts/codemod-split-conversions-registry.mjs --write
 *
 * On a branch that already carries a split, take `main`'s `registry.ts` first
 * (`git checkout origin/main -- packages/spec/src/conversions/registry.ts`):
 * `--write` deletes the generated modules it does not write again, and refuses
 * a file under `entries/` this script did not write.
 *
 * Exit codes: 0 done · 1 a proof failed (stop: the generated split is never
 * hand-edited to pass) · 2 the script could not run (an unexpected statement
 * shape, a missing prerequisite, bad arguments) · 3 an input does not parse
 * (`ts-parse.mjs`'s refusal).
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { parseSourceFile } from './ts-parse.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SPEC_REL = 'packages/spec';
const CONV_REL = `${SPEC_REL}/src/conversions`;
const CONV_DIR = join(ROOT, CONV_REL);
const HOST_BASENAME = 'registry.ts';
const HOST_PATH = join(CONV_DIR, HOST_BASENAME);
const ENTRIES = 'entries';
const SHARED_MODULE = `${ENTRIES}/shared.ts`;
const CARD = '#29987';

/** The marker every generated file carries; `--verify` and `--write` key on it. */
const MARK = `[${CARD} codemod]`;

/** The type annotation that makes a top-level `const` a conversion entry. */
const ENTRY_TYPE = 'MetadataConversion';

/**
 * An entry id is a file name: letters, digits and hyphens, nothing a path
 * could misread (two ids already carry a camelCase key, `visibleOn`). Two ids
 * equal but for case would share a file on a case-insensitive file system, so
 * `plan` refuses them.
 */
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

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
      `✗ codemod-split-conversions-registry: PREREQUISITE NOT MET — ts-morph does not resolve from ${manifest} ` +
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
 * One in-memory project per parse: no file system, no lib, no build output.
 * The text goes through `ts-parse.mjs`'s checked parse first, which refuses a
 * source with parse errors (its exit 3); ts-morph then reads the same text.
 */
function parse(tm, fileName, text) {
  parseSourceFile(fileName, text);
  const project = new tm.Project({
    useInMemoryFileSystem: true,
    compilerOptions: { target: tm.ts.ScriptTarget.ES2020, strict: true, noLib: true, allowJs: false },
  });
  project.getFileSystem().writeFileSync(fileName, text);
  const sf = project.addSourceFileAtPath(fileName);
  return { sf, checker: project.getTypeChecker().compilerObject };
}

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Lines as `wc -l` counts them: newline characters. */
function lineCount(text) {
  return text.split('\n').length - 1;
}

// ── Reading a file ───────────────────────────────────────────────────────────

/**
 * Every import of a file: `{ node, spec, typeOnly, elements: [{ local, text, typeOnly }] }`.
 * A default or namespace import has no name a moved statement could take one
 * at a time, so it stops the script.
 */
function readImports(tm, sf, fileName) {
  const out = [];
  for (const st of sf.getStatements()) {
    if (!tm.Node.isImportDeclaration(st)) continue;
    if (st.getDefaultImport() || st.getNamespaceImport()) refuse(`${fileName}: \`${st.getText()}\` is a default or namespace import`);
    const elements = st.getNamedImports().map((el) => ({
      local: (el.getAliasNode() ?? el.getNameNode()).getText(),
      text: el.getText(),
      typeOnly: st.isTypeOnly() || el.isTypeOnly(),
    }));
    if (elements.length === 0) refuse(`${fileName}: \`${st.getText()}\` imports for side effects only`);
    out.push({ node: st, spec: st.getModuleSpecifierValue(), typeOnly: st.isTypeOnly(), elements });
  }
  return out;
}

/** The names a top-level statement declares, or null when it declares none (an import, an `export { … }`). */
function declaredNames(tm, st, fileName) {
  const { Node } = tm;
  if (Node.isImportDeclaration(st) || Node.isExportDeclaration(st)) return null;
  if (Node.isVariableStatement(st)) {
    return st.getDeclarations().map((d) => {
      if (!Node.isIdentifier(d.getNameNode())) refuse(`${fileName}: a destructuring declaration (\`${d.getText().slice(0, 60)}\`)`);
      return d.getName();
    });
  }
  if (Node.isFunctionDeclaration(st) || Node.isInterfaceDeclaration(st) || Node.isTypeAliasDeclaration(st)
    || Node.isClassDeclaration(st) || Node.isEnumDeclaration(st)) {
    const name = st.getName();
    if (!name) refuse(`${fileName}: an anonymous declaration`);
    return [name];
  }
  refuse(`${fileName}: a top-level ${st.getKindName()} (\`${st.getText().slice(0, 60)}\`) — only declarations and imports are expected`);
  return null;
}

/**
 * The top-level statement `decl` DECLARES, or null: a function, interface,
 * type alias, class or enum directly in the file, or a variable of a
 * top-level variable statement. A property, parameter or local declared
 * inside some top-level statement is not one (a property access `x.name` can
 * resolve to an object literal's property in another statement).
 */
function topStatementOf(ts, decl) {
  const sk = ts.SyntaxKind;
  if (decl.parent && decl.parent.kind === sk.SourceFile) return decl;
  if (decl.kind === sk.VariableDeclaration && decl.parent?.kind === sk.VariableDeclarationList
    && decl.parent.parent?.kind === sk.VariableStatement && decl.parent.parent.parent?.kind === sk.SourceFile) return decl.parent.parent;
  return null;
}

/**
 * The module-scope names `st` reads: Map name -> 'import' | 'local'. Resolved
 * through the checker, so a local that shadows a module name is not a read of
 * it, and a shorthand `{ name }` is.
 */
function moduleRefs(tm, parsed, st, imports) {
  const ts = tm.ts;
  const { sf, checker } = parsed;
  const sfNode = sf.compilerNode;
  const importLocals = new Set(imports.flatMap((d) => d.elements.map((e) => e.local)));
  const own = new Set(declaredNames(tm, st, sf.getFilePath()) ?? []);
  const refs = new Map();
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.Identifier) {
      const parent = node.parent;
      let sym = parent && parent.kind === ts.SyntaxKind.ShorthandPropertyAssignment && parent.name === node
        ? checker.getShorthandAssignmentValueSymbol(parent)
        : checker.getSymbolAtLocation(node);
      if (sym) {
        for (const decl of sym.declarations ?? []) {
          if (decl.kind === ts.SyntaxKind.ImportSpecifier) {
            const name = decl.name.text;
            if (importLocals.has(name)) refs.set(name, 'import');
            break;
          }
          const top = topStatementOf(ts, decl);
          if (top && top.parent === sfNode && top !== st.compilerNode) {
            const name = node.text;
            if (!own.has(name)) refs.set(name, 'local');
            break;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(st.compilerNode, visit);
  return refs;
}

/** `{ id, toMajor }` read off a conversion literal, or a refusal naming what is missing. */
function entryKey(tm, decl, fileName) {
  const { Node } = tm;
  const init = decl.getInitializer();
  if (!init || !Node.isObjectLiteralExpression(init)) refuse(`${fileName}: ${decl.getName()} is typed ${ENTRY_TYPE} but is not an object literal`);
  const prop = (name) => {
    const p = init.getProperty(name);
    if (!p || !Node.isPropertyAssignment(p)) refuse(`${fileName}: ${decl.getName()} has no \`${name}:\` property`);
    return p.getInitializerOrThrow();
  };
  const id = prop('id');
  const toMajor = prop('toMajor');
  if (!Node.isStringLiteral(id)) refuse(`${fileName}: ${decl.getName()}'s \`id\` is not a string literal`);
  if (!Node.isNumericLiteral(toMajor)) refuse(`${fileName}: ${decl.getName()}'s \`toMajor\` is not a number literal`);
  const key = { id: id.getLiteralValue(), toMajor: toMajor.getLiteralValue() };
  if (!ID_SHAPE.test(key.id)) refuse(`${fileName}: ${decl.getName()}'s id '${key.id}' is not letters, digits and hyphens (it names a file)`);
  if (!Number.isInteger(key.toMajor) || key.toMajor < 1) refuse(`${fileName}: ${decl.getName()}'s toMajor ${key.toMajor} is not a major`);
  return key;
}

/** Is `st` a conversion entry? Returns its `{ name, id, toMajor }` or null. */
function asEntry(tm, st, fileName) {
  if (!tm.Node.isVariableStatement(st)) return null;
  const decls = st.getDeclarations();
  if (decls.length !== 1 || decls[0].getTypeNode()?.getText() !== ENTRY_TYPE) return null;
  return { name: decls[0].getName(), ...entryKey(tm, decls[0], fileName) };
}

/** Does the statement carry its own `export` keyword? (A name listed in an `export { … }` does not count.) */
function isExported(tm, st) {
  return tm.Node.isExportable(st) && st.hasExportKeyword();
}

/**
 * Read a file into `{ parsed, imports, statements }`. Each statement row:
 * `{ node, names, label, fullText, exported, refs, entry }`.
 */
function readFile(tm, fileName, text) {
  const parsed = parse(tm, fileName, text);
  const imports = readImports(tm, parsed.sf, fileName);
  const statements = [];
  for (const st of parsed.sf.getStatements()) {
    const names = declaredNames(tm, st, fileName);
    if (names === null) continue;
    statements.push({
      node: st,
      names,
      label: names.join(', '),
      fullText: st.getFullText(),
      exported: isExported(tm, st),
      refs: moduleRefs(tm, parsed, st, imports),
      entry: asEntry(tm, st, fileName),
    });
  }
  return { parsed, imports, statements, text };
}

// ── The plan ─────────────────────────────────────────────────────────────────

/** `entries/18/some-id.ts` for a conversion. */
const entryModuleOf = (entry) => `${ENTRIES}/${entry.toMajor}/${entry.id}.ts`;
const jsSpecifier = (moduleRel) => moduleRel.replace(/\.ts$/, '.js');

/**
 * What moves where. Returns `{ base, rows, modules, hostRows, sharedRows }`:
 * `modules` is a Map of module path -> rows in base order (the shared leaf
 * among them when anything is shared); every row carries `module` (null for
 * a statement that stays).
 */
function plan(tm, text) {
  const base = readFile(tm, HOST_BASENAME, text);
  const rows = base.statements;
  if (text.includes(MARK)) refuse(`${HOST_BASENAME} already carries ${MARK}: run the script on an unsplit file (re-run on the latest main, never on its own output)`);
  const byNameRow = new Map();
  for (const r of rows) for (const n of r.names) {
    if (byNameRow.has(n)) refuse(`${HOST_BASENAME}: ${n} is declared twice`);
    byNameRow.set(n, r);
  }
  const entries = rows.filter((r) => r.entry);
  if (entries.length === 0) refuse(`${HOST_BASENAME}: no \`const NAME: ${ENTRY_TYPE} = { … }\` entry found`);
  const seenIds = new Map();
  for (const r of entries) {
    if (r.exported) refuse(`${HOST_BASENAME}: the entry ${r.entry.name} is exported; an exported entry is a published name, not a table row`);
    const prev = seenIds.get(r.entry.id.toLowerCase());
    if (prev) refuse(`${HOST_BASENAME}: ${prev} and ${r.entry.name} share the id '${r.entry.id}' (compared without case: it names a file)`);
    seenIds.set(r.entry.id.toLowerCase(), r.entry.name);
  }

  // Readers: who reads each row.
  const readers = new Map(rows.map((r) => [r, new Set()]));
  for (const r of rows) for (const [n, kind] of r.refs) if (kind === 'local') readers.get(byNameRow.get(n)).add(r);

  // A helper moves when it is not exported, something reads it, and every
  // reader moves — to a fixed point.
  const moving = new Set(entries);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) {
      if (moving.has(r) || r.exported) continue;
      const rs = readers.get(r);
      if (rs.size > 0 && [...rs].every((x) => moving.has(x))) { moving.add(r); grew = true; }
    }
  }
  // A conversion reads no other conversion: each module is a leaf of its own.
  for (const r of entries) {
    for (const [n, kind] of r.refs) {
      if (kind === 'local' && byNameRow.get(n).entry) refuse(`${HOST_BASENAME}: the entry ${r.entry.name} reads the entry ${n}`);
    }
  }
  // Which conversions reach each moving helper (its readers, transitively).
  const owners = new Map();
  const ownersOf = (r) => {
    if (r.entry) return new Set([r]);
    if (owners.has(r)) return owners.get(r);
    owners.set(r, new Set());
    const set = new Set();
    for (const x of readers.get(r)) for (const o of ownersOf(x)) set.add(o);
    owners.set(r, set);
    return set;
  };
  for (const r of rows) {
    if (!moving.has(r)) { r.module = null; continue; }
    if (r.entry) { r.module = entryModuleOf(r.entry); continue; }
    const os = ownersOf(r);
    if (os.size === 0) refuse(`${HOST_BASENAME}: ${r.label} moves but no entry reaches it`);
    r.module = os.size === 1 ? entryModuleOf([...os][0].entry) : SHARED_MODULE;
  }
  // A shared helper never reads an entry's own helper (its readers are a
  // superset), so the shared module stays a leaf; check it anyway.
  for (const r of rows) {
    if (r.module !== SHARED_MODULE) continue;
    for (const [n, kind] of r.refs) {
      const dep = kind === 'local' ? byNameRow.get(n) : null;
      if (dep && dep.module !== SHARED_MODULE) refuse(`${HOST_BASENAME}: the shared helper ${r.label} reads ${n}, which is not shared`);
    }
  }
  const modules = new Map();
  for (const r of rows) {
    if (!r.module) continue;
    if (!modules.has(r.module)) modules.set(r.module, []);
    modules.get(r.module).push(r);
  }
  return {
    base, rows, byNameRow, modules,
    hostRows: rows.filter((r) => !r.module),
    sharedRows: modules.get(SHARED_MODULE) ?? [],
    entries,
  };
}

// ── Generating ───────────────────────────────────────────────────────────────

/** A base specifier (relative to `conversions/`) as `moduleRel` must spell it. */
function rebase(spec, moduleRel) {
  if (!spec.startsWith('.')) return spec;
  const target = posix.normalize(spec);
  let rel = posix.relative(posix.dirname(moduleRel), target);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

/** `import { a, type B } from 'x';`, on one line when it fits in 120 characters. */
function importStatement(typeOnly, elementTexts, specifier) {
  const head = typeOnly ? 'import type' : 'import';
  const one = `${head} { ${elementTexts.join(', ')} } from '${specifier}';`;
  if (one.length <= 120) return one;
  return `${head} {\n${elementTexts.map((t) => `  ${t},`).join('\n')}\n} from '${specifier}';`;
}

/** `export { a, type B };` on one line when it fits, else one name a line. */
function exportStatement(elementTexts) {
  const one = `export { ${elementTexts.join(', ')} };`;
  if (one.length <= 120) return one;
  return `export {\n${elementTexts.map((t) => `  ${t},`).join('\n')}\n};`;
}

/** The base imports a set of rows reads, as `moduleRel` spells them, in base order. */
function baseImportLines(base, rowsRead, moduleRel) {
  const used = new Set();
  for (const r of rowsRead) for (const [n, kind] of r.refs) if (kind === 'import') used.add(n);
  const out = [];
  for (const d of base.imports) {
    const els = d.elements.filter((e) => used.has(e.local));
    if (els.length === 0) continue;
    // The statement keeps its own `import type` spelling; an element keeps its own `type`.
    out.push(importStatement(d.typeOnly, els.map((e) => e.text), rebase(d.spec, moduleRel)));
  }
  return out;
}

/** `type X` for a shared interface or type alias, `X` otherwise. */
function sharedSpelling(tm, planned, name) {
  const r = planned.byNameRow.get(name);
  const typeOnly = tm.Node.isInterfaceDeclaration(r.node) || tm.Node.isTypeAliasDeclaration(r.node);
  return typeOnly ? `type ${name}` : name;
}

/** The shared names a set of rows reads. */
function sharedNamesRead(planned, rowsRead) {
  const names = new Set();
  for (const r of rowsRead) {
    for (const [n, kind] of r.refs) {
      if (kind === 'local' && planned.byNameRow.get(n).module === SHARED_MODULE) names.add(n);
    }
  }
  return [...names].sort(byName);
}

/** `text` wrapped into `// ` comment lines no wider than `width`. */
function wrapLineComment(words, width = 80) {
  const out = [];
  let line = '//';
  for (const w of words) {
    if (line.length + 1 + w.length > width && line !== '//') { out.push(line); line = '//'; }
    line += ` ${w}`;
  }
  if (line !== '//') out.push(line);
  return out;
}

const words = (s) => s.split(/\s+/).filter(Boolean);

/**
 * A module's header is `//` lines, not a `/** *\/` docblock: a docblock that
 * leads a module's first statement can be carried into a bundled `.d.ts`,
 * and none of these modules has a published declaration to carry it to.
 */
function moduleHeader(lines) {
  return ['// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.', '', ...lines];
}

function entryModuleText(tm, planned, moduleRel, rows) {
  const entry = rows.find((r) => r.entry).entry;
  const helpers = rows.filter((r) => !r.entry).map((r) => `\`${r.label}\``);
  const out = moduleHeader([
    ...wrapLineComment(words(`${MARK} The \`${entry.id}\` conversion (\`toMajor: ${entry.toMajor}\`), moved out of`
      + ' `conversions/registry.ts` whole by `scripts/codemod-split-conversions-registry.mjs`'
      + ' (ruling 6583399215: per-entry files).')),
    '//',
    ...wrapLineComment(words('A MOVE, not a redesign: each declaration below is its `registry.ts` text exactly, with the'
      + ' comments above it, in the order it stood there'
      + (helpers.length ? ` (${helpers.length === 1 ? 'the helper' : 'the helpers'} ${helpers.join(', ')}`
        + ` ${helpers.length === 1 ? 'is' : 'are'} read by this conversion alone).` : '.')
      + ' A LEAF: it imports neither `registry.ts` nor another conversion\'s module. `registry.ts` imports'
      + ` \`${entry.name}\` and lists it where it stood.`)),
    '',
  ]);
  out.push(...baseImportLines(planned.base, rows, moduleRel));
  const shared = sharedNamesRead(planned, rows);
  if (shared.length > 0) {
    out.push(importStatement(false, shared.map((n) => sharedSpelling(tm, planned, n)), rebase(`./${jsSpecifier(SHARED_MODULE)}`, moduleRel)));
  }
  let text = out.join('\n');
  for (const r of rows) text += r.fullText;
  text += `\n\n${exportStatement([entry.name])}\n`;
  return text;
}

function sharedModuleText(tm, planned) {
  const rows = planned.sharedRows;
  const out = moduleHeader([
    ...wrapLineComment(words(`${MARK} The top-level helpers of \`conversions/registry.ts\` that two or more conversions`
      + ' read, moved out whole by `scripts/codemod-split-conversions-registry.mjs` (lever (b) of ruling 6591753301).')),
    '//',
    ...wrapLineComment(words('A MOVE, not a redesign: each declaration below is its `registry.ts` text exactly, with the'
      + ' comments above it, in the order it stood there. A LEAF: it imports neither `registry.ts` nor any'
      + ' conversion\'s module, so it is evaluated before every conversion that reads it.')),
    '',
  ]);
  out.push(...baseImportLines(planned.base, rows, SHARED_MODULE));
  let text = out.join('\n');
  for (const r of rows) text += r.fullText;
  const readOutside = new Set();
  for (const [moduleRel, mrows] of planned.modules) {
    if (moduleRel === SHARED_MODULE) continue;
    for (const n of sharedNamesRead(planned, mrows)) readOutside.add(n);
  }
  const exported = [...readOutside].sort(byName).map((n) => sharedSpelling(tm, planned, n));
  text += `\n\n// ${MARK} Declared above without \`export\`, and read by the conversions' modules.\n${exportStatement(exported)}\n`;
  return text;
}

/**
 * The new `registry.ts`: base with every moved statement taken out
 * (`getFullStart()` to `getEnd()`, so the statement after it keeps its own
 * leading comments) and the import declarations regenerated.
 */
function hostText(planned) {
  const { base, hostRows, entries } = planned;
  const text = base.text;
  const lines = baseImportLines(base, hostRows, HOST_BASENAME);
  lines.push('');
  lines.push(...wrapLineComment(words(`${MARK} Every conversion below moved to a module of its own under \`./${ENTRIES}/\``
    + ' (`scripts/codemod-split-conversions-registry.mjs`). Imported in the order the definitions stood in this file,'
    + ' and listed in the tables below exactly as before.')));
  for (const r of entries) lines.push(`import { ${r.entry.name} } from './${jsSpecifier(entryModuleOf(r.entry))}';`);
  const first = base.imports[0].node;
  const last = base.imports.at(-1).node;
  const edits = [{ start: first.getStart(), end: last.getEnd(), text: lines.join('\n') }];
  for (const r of planned.rows) if (r.module) edits.push({ start: r.node.getFullStart(), end: r.node.getEnd(), text: '' });
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  let floor = Infinity;
  for (const e of edits) {
    if (e.end > floor) refuse('overlapping edits');
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    floor = e.start;
  }
  return out;
}

/** Apply a plan: `{ host, modules }` — the new `registry.ts` and a Map of module path -> text. Pure. */
function generate(tm, planned) {
  if (planned.base.imports.length === 0) refuse(`${HOST_BASENAME} has no import declaration to regenerate`);
  const modules = new Map();
  for (const [moduleRel, rows] of [...planned.modules].sort(([a], [b]) => byName(a, b))) {
    modules.set(moduleRel, moduleRel === SHARED_MODULE ? sharedModuleText(tm, planned) : entryModuleText(tm, planned, moduleRel, rows));
  }
  return { host: hostText(planned), modules };
}

// ── Proof 1 + 2: byte-identity and bindings ──────────────────────────────────

/** The file a relative specifier of a file at `fromRel` (relative to `conversions/`) names. */
function targetOf(spec, fromRel) {
  if (!spec.startsWith('.')) return spec;
  return posix.normalize(posix.join(posix.dirname(fromRel), spec));
}

/**
 * Prove a split against its base from the texts alone (it shares no state with
 * `plan` / `generate`). Returns `{ failures, readings }`; no failure = proved.
 */
function verify(tm, baseText, headHost, moduleTexts) {
  const failures = [];
  const fail = (m) => failures.push(m);
  const base = readFile(tm, HOST_BASENAME, baseText);
  const head = readFile(tm, HOST_BASENAME, headHost);
  const baseByName = new Map();
  for (const r of base.statements) baseByName.set(r.label, r);
  const baseImportOf = new Map();
  for (const d of base.imports) for (const e of d.elements) baseImportOf.set(e.local, { target: targetOf(d.spec, HOST_BASENAME), typeOnly: e.typeOnly });

  if (!headHost.includes(MARK)) fail(`${HOST_BASENAME} carries no ${MARK}: it is not a generated split`);

  // Every module, read the same way.
  const files = new Map([[HOST_BASENAME, head]]);
  for (const [rel, text] of [...moduleTexts].sort(([a], [b]) => byName(a, b))) {
    if (!rel.startsWith(`${ENTRIES}/`)) fail(`${rel}: a generated module outside ${ENTRIES}/`);
    if (!text.includes(MARK)) fail(`${rel}: carries no ${MARK}`);
    files.set(rel, readFile(tm, rel, text));
  }

  // 1. Each statement is its base text, found exactly once, in base order per file.
  const placed = new Map();
  let bytesCompared = 0;
  for (const [rel, f] of files) {
    let lastIndex = -1;
    for (const r of f.statements) {
      const b = baseByName.get(r.label);
      if (!b) { fail(`${rel}: ${r.label} is not a statement of the base ${HOST_BASENAME}`); continue; }
      if (r.fullText !== b.fullText) fail(`${rel}: ${r.label} differs from its base text (sha256 ${sha256(r.fullText).slice(0, 12)} vs ${sha256(b.fullText).slice(0, 12)})`);
      else bytesCompared += Buffer.byteLength(r.fullText);
      if (placed.has(r.label)) fail(`${r.label} is declared in both ${placed.get(r.label)} and ${rel}`);
      placed.set(r.label, rel);
      const at = base.statements.indexOf(b);
      if (at < lastIndex) fail(`${rel}: ${r.label} is out of base order`);
      lastIndex = at;
    }
  }
  for (const b of base.statements) if (!placed.has(b.label)) fail(`${b.label} (base) is in no file of the split`);

  // 1b. Undo: base's imports in place of the generated ones, every moved statement back between the ones that stayed.
  let rebuilt = null;
  if (head.imports.length > 0 && base.imports.length > 0 && failures.length === 0) {
    const fullTextOf = (label) => {
      const f = files.get(placed.get(label));
      return f.statements.find((r) => r.label === label).fullText;
    };
    const headFirst = head.imports[0].node;
    const lastHeadStmt = head.parsed.sf.getStatements().at(-1);
    rebuilt = headHost.slice(0, headFirst.getStart())
      + baseText.slice(base.imports[0].node.getStart(), base.imports.at(-1).node.getEnd())
      + base.statements.map((b) => fullTextOf(b.label)).join('')
      + headHost.slice(lastHeadStmt.getEnd());
    if (rebuilt !== baseText) {
      let i = 0;
      while (i < rebuilt.length && rebuilt[i] === baseText[i]) i += 1;
      fail(`undoing the split does NOT rebuild the base ${HOST_BASENAME}: first difference at offset ${i}`);
    }
  }

  // 2. Bindings.
  const entryModules = new Map();
  for (const [rel, f] of files) {
    if (rel === HOST_BASENAME) continue;
    const entries = f.statements.filter((r) => r.entry);
    if (rel === SHARED_MODULE) {
      if (entries.length > 0) fail(`${rel}: holds the entry ${entries[0].entry.name}`);
    } else if (entries.length !== 1) {
      fail(`${rel}: holds ${entries.length} entries, not 1`);
    } else {
      const e = entries[0].entry;
      if (rel !== entryModuleOf(e)) fail(`${rel}: holds ${e.name} (id '${e.id}', toMajor ${e.toMajor}), which belongs at ${entryModuleOf(e)}`);
      entryModules.set(rel, e);
    }
    const exportDecls = f.parsed.sf.getStatements().filter((s) => tm.Node.isExportDeclaration(s));
    const last = f.parsed.sf.getStatements().at(-1);
    if (exportDecls.length !== 1 || exportDecls[0] !== last || last.getModuleSpecifier()) {
      fail(`${rel}: does not end with exactly one generated \`export { … }\``);
    } else if (rel !== SHARED_MODULE && entries.length === 1) {
      const names = last.getNamedExports().map((x) => x.getName());
      if (names.join() !== entries[0].entry.name) fail(`${rel}: exports ${names.join(', ')}, not ${entries[0].entry.name}`);
    }
    for (const r of f.statements) if (r.exported) fail(`${rel}: ${r.label} carries its own \`export\` (the generated list exports)`);
  }
  const sharedExports = new Set();
  if (files.has(SHARED_MODULE)) {
    const last = files.get(SHARED_MODULE).parsed.sf.getStatements().at(-1);
    if (tm.Node.isExportDeclaration(last)) for (const x of last.getNamedExports()) sharedExports.add(x.getName());
  }
  const sharedDeclared = new Set((files.get(SHARED_MODULE)?.statements ?? []).flatMap((r) => r.names));
  let importsChecked = 0;
  for (const [rel, f] of files) {
    const usedImports = new Set();
    for (const r of f.statements) for (const [n, kind] of r.refs) if (kind === 'import') usedImports.add(n);
    const hostUsesEntries = new Set();
    if (rel === HOST_BASENAME) for (const r of f.statements) for (const [n] of r.refs) hostUsesEntries.add(n);
    for (const d of f.imports) {
      const target = targetOf(d.spec, rel);
      for (const e of d.elements) {
        importsChecked += 1;
        const fromModule = [...files.keys()].find((k) => k !== HOST_BASENAME && jsSpecifier(k) === target);
        if (fromModule) {
          if (rel !== HOST_BASENAME && fromModule !== SHARED_MODULE) fail(`${rel}: imports ${e.local} from another conversion's module ${fromModule}`);
          if (fromModule === SHARED_MODULE && !sharedExports.has(e.local)) fail(`${rel}: imports ${e.local} from ${SHARED_MODULE}, which does not export it`);
          if (rel === HOST_BASENAME && fromModule === SHARED_MODULE) fail(`${rel}: imports ${e.local} from the shared leaf`);
          if (rel === HOST_BASENAME && entryModules.get(fromModule)?.name !== e.local) fail(`${rel}: imports ${e.local} from ${fromModule}, which holds ${entryModules.get(fromModule)?.name ?? 'no entry'}`);
          if (rel === SHARED_MODULE) fail(`${rel}: the shared leaf imports a generated module (${fromModule})`);
          if (rel !== HOST_BASENAME && !usedImports.has(e.local)) fail(`${rel}: imports ${e.local}, which nothing in it reads`);
          continue;
        }
        if (target === jsSpecifier(HOST_BASENAME)) { fail(`${rel}: imports ${e.local} from ${HOST_BASENAME} (a leaf never imports the host)`); continue; }
        const b = baseImportOf.get(e.local);
        if (!b) { fail(`${rel}: imports ${e.local}, which the base did not import`); continue; }
        if (b.target !== target) fail(`${rel}: imports ${e.local} from ${target}, the base from ${b.target}`);
        if (b.typeOnly !== e.typeOnly) fail(`${rel}: imports ${e.local} ${e.typeOnly ? 'as a type' : 'as a value'}, the base ${b.typeOnly ? 'as a type' : 'as a value'}`);
        if (!usedImports.has(e.local)) fail(`${rel}: imports ${e.local}, which nothing in it reads`);
      }
    }
    // Every module-scope name a statement reads is declared in the file or imported by it.
    const declared = new Set(f.statements.flatMap((r) => r.names));
    const imported = new Set(f.imports.flatMap((d) => d.elements.map((e) => e.local)));
    for (const r of f.statements) {
      for (const n of baseByName.get(r.label)?.refs.keys() ?? []) {
        if (!declared.has(n) && !imported.has(n)) fail(`${rel}: ${r.label} reads ${n}, which the file neither declares nor imports`);
      }
    }
    if (rel === SHARED_MODULE) for (const n of sharedExports) if (!sharedDeclared.has(n)) fail(`${rel}: exports ${n}, which it does not declare`);
  }
  const baseExports = base.statements.filter((r) => r.exported).flatMap((r) => r.names).sort(byName);
  const headExports = head.statements.filter((r) => r.exported).flatMap((r) => r.names).sort(byName);
  if (baseExports.join() !== headExports.join()) fail(`${HOST_BASENAME} exports ${headExports.join(', ')}; the base exported ${baseExports.join(', ')}`);
  const headEntryImports = new Set(head.imports.flatMap((d) => d.elements.map((e) => e.local)).filter((n) => [...entryModules.values()].some((e) => e.name === n)));
  const baseEntries = base.statements.filter((r) => r.entry);
  for (const r of baseEntries) if (!headEntryImports.has(r.entry.name)) fail(`${HOST_BASENAME} does not import the entry ${r.entry.name}`);

  const moved = base.statements.filter((b) => placed.get(b.label) && placed.get(b.label) !== HOST_BASENAME);
  return {
    failures,
    readings: {
      entries: baseEntries.length,
      entriesMoved: moved.filter((b) => b.entry).length,
      helpersMoved: moved.filter((b) => !b.entry).length,
      helpersShared: files.get(SHARED_MODULE)?.statements.length ?? 0,
      stayed: head.statements.length,
      modules: moduleTexts.size,
      statementsCompared: placed.size,
      bytesCompared,
      importsChecked,
      linesBefore: lineCount(baseText),
      linesAfter: lineCount(headHost),
      rebuilt: rebuilt === baseText,
      baseSha256: sha256(baseText),
    },
  };
}

function printVerify(v) {
  for (const f of v.failures) console.error(`  ✗ ${f}`);
  const r = v.readings;
  console.log(`byte-identity: ${r.statementsCompared} statements compared (${r.bytesCompared} bytes), ` +
    `${r.entriesMoved}/${r.entries} entries and ${r.helpersMoved} helpers moved (${r.helpersShared} into ${SHARED_MODULE}), ` +
    `${r.stayed} stayed; ${r.modules} modules; ${r.importsChecked} import bindings checked; ` +
    `${HOST_BASENAME} ${r.linesBefore} -> ${r.linesAfter} lines; undoing the split ${r.rebuilt ? 'does' : 'does NOT'} rebuild the base byte-for-byte`);
}

// ── Proof 3: the exported tables, loaded ─────────────────────────────────────

/**
 * The probe `tsx` runs on a registry: every table it exports, as ids, plus a
 * digest of each conversion's value (its JSON with every function as its
 * source text, so `apply` and any fixture callback are compared too).
 */
const ARRAYS_PROBE = `
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const m = await import(pathToFileURL(process.argv[2]).href);
const digest = (c) => createHash('sha256').update(JSON.stringify(c, (k, v) => (typeof v === 'function' ? 'fn:' + v.toString() : v))).digest('hex');
const byMajor = {};
for (const k of Object.keys(m.CONVERSIONS_BY_MAJOR)) byMajor[k] = m.CONVERSIONS_BY_MAJOR[k].map((c) => c.id);
process.stdout.write(JSON.stringify({
  exports: Object.keys(m).sort(),
  all: m.ALL_CONVERSIONS.map((c) => c.id),
  byMajor,
  digests: Object.fromEntries(m.ALL_CONVERSIONS.map((c) => [c.id, digest(c)])),
}));
`;

function loadTables(registryPath, probePath) {
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsx)) refuse(`--arrays needs tsx at ${tsx} (run pnpm install)`);
  return JSON.parse(execFileSync(tsx, [probePath, registryPath], { cwd: join(ROOT, SPEC_REL), encoding: 'utf8', maxBuffer: 1 << 28 }));
}

function compareTables(before, after) {
  const failures = [];
  if (before.exports.join() !== after.exports.join()) failures.push(`exports differ: ${before.exports.join(', ')} vs ${after.exports.join(', ')}`);
  if (JSON.stringify(before.all) !== JSON.stringify(after.all)) failures.push('ALL_CONVERSIONS ids differ (membership or order)');
  const majors = (t) => Object.keys(t.byMajor).join();
  if (majors(before) !== majors(after)) failures.push(`CONVERSIONS_BY_MAJOR majors differ: ${majors(before)} vs ${majors(after)}`);
  for (const k of Object.keys(before.byMajor)) {
    if (JSON.stringify(before.byMajor[k]) !== JSON.stringify(after.byMajor[k] ?? null)) failures.push(`CONVERSIONS_BY_MAJOR[${k}] differs (membership or order)`);
  }
  for (const [id, d] of Object.entries(before.digests)) if (after.digests[id] !== d) failures.push(`${id}: its value differs`);
  return failures;
}

function arraysProof(ref) {
  const scratch = mkdtempSync(join(ROOT, SPEC_REL, '.codemod-arrays-'));
  try {
    const probe = join(scratch, 'probe.mts');
    writeFileSync(probe, ARRAYS_PROBE);
    // Base: this tree's src, with conversions/ exactly as REF has it.
    const baseSrc = join(scratch, 'base-src');
    cpSync(join(ROOT, SPEC_REL, 'src'), baseSrc, { recursive: true });
    rmSync(join(baseSrc, 'conversions'), { recursive: true, force: true });
    const tar = join(scratch, 'conversions.tar');
    execFileSync('git', ['archive', '--format=tar', '-o', tar, ref, `${CONV_REL}/`], { cwd: ROOT });
    const unpack = join(scratch, 'unpack');
    mkdirSync(unpack);
    execFileSync('tar', ['-xf', tar, '-C', unpack]);
    cpSync(join(unpack, CONV_REL), join(baseSrc, 'conversions'), { recursive: true });
    const before = loadTables(join(baseSrc, 'conversions', HOST_BASENAME), probe);
    const after = loadTables(HOST_PATH, probe);
    const failures = compareTables(before, after);
    return {
      failures,
      readings: {
        exports: after.exports,
        all: after.all.length,
        allSha256: sha256(JSON.stringify(after.all)),
        byMajor: Object.fromEntries(Object.entries(after.byMajor).map(([k, ids]) => [k, ids.length])),
        digestsEqual: Object.keys(before.digests).filter((id) => after.digests[id] === before.digests[id]).length,
      },
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ── Proof 4: the declaration-file bar (ruling 6348891160 item 1) ─────────────

/** The ruling's one normalisation, verbatim: sort the members of each run of string-literal union members in place. */
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

/**
 * One positive control on a declaration file: the first `private` member made
 * public, else the first `readonly` dropped, else the first `: string` made
 * `: number`. Returns null when none of the three occurs.
 */
function injectChange(text) {
  const priv = text.search(/^ {4}private /m);
  if (priv >= 0) return { kind: 'private member made public', text: text.slice(0, priv) + '    ' + text.slice(priv + '    private '.length) };
  const ro = text.search(/\breadonly /);
  if (ro >= 0) return { kind: 'readonly dropped', text: text.slice(0, ro) + text.slice(ro + 'readonly '.length) };
  const str = text.indexOf(': string');
  if (str >= 0) return { kind: 'a string member retyped number', text: `${text.slice(0, str)}: number${text.slice(str + ': string'.length)}` };
  return null;
}

/** The bar on one declaration file pair. Returns `{ failures, reading }`. */
function dtsBarFor(file, before, after) {
  const failures = [];
  const raw = before === after;
  const nb = normaliseUnionOrder(before);
  const na = normaliseUnionOrder(after);
  if (!raw && nb !== na) failures.push(`${file}: differs other than by union member order — ruling 6441032442 B's second normalisation is the report reading for this (a fork to report, never a widened normaliser here)`);
  const eb = dtsExportNames(before);
  const ea = dtsExportNames(after);
  if (JSON.stringify(eb) !== JSON.stringify(ea)) failures.push(`${file}: the export list differs (${eb.length} at base, ${ea.length} at head)`);
  return {
    failures,
    reading: { file, raw: raw ? 'identical' : 'differs', rawSha256: sha256(after).slice(0, 16), normalisedEqual: nb === na, exports: ea.length },
  };
}

function listDts(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(p).isDirectory()) walk(p, r);
      else if (/\.d\.[cm]?ts$/.test(name)) out.push(r);
    }
  };
  walk(dir, '');
  return out;
}

function dtsBar(beforeDir, afterDir) {
  const failures = [];
  const readings = [];
  const fb = listDts(beforeDir);
  const fa = listDts(afterDir);
  if (fb.join('\n') !== fa.join('\n')) {
    const onlyB = fb.filter((f) => !fa.includes(f));
    const onlyA = fa.filter((f) => !fb.includes(f));
    failures.push(`the declaration file sets differ: only at base ${onlyB.length} (${onlyB.slice(0, 5).join(', ')}), only at head ${onlyA.length} (${onlyA.slice(0, 5).join(', ')})`);
  }
  let control = null;
  for (const file of fb.filter((f) => fa.includes(f))) {
    const before = readFileSync(join(beforeDir, file), 'utf8');
    const after = readFileSync(join(afterDir, file), 'utf8');
    const r = dtsBarFor(file, before, after);
    failures.push(...r.failures);
    readings.push(r.reading);
    if (!control) {
      const injected = injectChange(after);
      if (injected) {
        const caught = dtsBarFor(file, before, injected.text).failures.length > 0;
        control = { file, kind: injected.kind, caught };
      }
    }
  }
  if (!control) failures.push('no declaration file admits the positive control (INCONCLUSIVE)');
  else if (!control.caught) failures.push(`the positive control (${control.kind} in ${control.file}) passes the bar — the bar hides a change (INCONCLUSIVE)`);
  return { failures, readings, control, files: fa.length };
}

// ── Disk ─────────────────────────────────────────────────────────────────────

function gitShow(ref, path) {
  return execFileSync('git', ['show', `${ref}:${path}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** Every `.ts` file under `entries/`, as Map rel -> text. */
function generatedModulesOnDisk() {
  const out = new Map();
  const dir = join(CONV_DIR, ENTRIES);
  if (!existsSync(dir)) return out;
  const walk = (d, rel) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const r = `${rel}/${name}`;
      if (statSync(p).isDirectory()) walk(p, r);
      else if (name.endsWith('.ts')) out.set(r, readFileSync(p, 'utf8'));
    }
  };
  walk(dir, ENTRIES);
  return out;
}

function treeHash(files) {
  const h = createHash('sha256');
  for (const [name, text] of [...files].sort(([a], [b]) => byName(a, b))) h.update(`${name}\0${sha256(text)}\n`);
  return h.digest('hex');
}

function planReport(planned) {
  const out = [];
  const majors = new Map();
  for (const r of planned.entries) majors.set(r.entry.toMajor, (majors.get(r.entry.toMajor) ?? 0) + 1);
  out.push(`entries: ${planned.entries.length} conversions -> ${ENTRIES}/<toMajor>/<id>.ts (${[...majors].sort((a, b) => a[0] - b[0]).map(([m, n]) => `${m}: ${n}`).join(', ')})`);
  const privateHelpers = planned.rows.filter((r) => r.module && !r.entry && r.module !== SHARED_MODULE);
  out.push(`helpers read by one conversion (moved into its module): ${privateHelpers.length}`);
  for (const r of privateHelpers) out.push(`    ${r.label} -> ${r.module}`);
  out.push(`helpers read by two or more conversions (moved into ${SHARED_MODULE}): ${planned.sharedRows.length}`);
  out.push(`    ${planned.sharedRows.map((r) => r.label).join(', ')}`);
  out.push(`stay in ${HOST_BASENAME}: ${planned.hostRows.map((r) => r.label).join(', ')}`);
  return out.join('\n');
}

// ── Entry ────────────────────────────────────────────────────────────────────

const USAGE = [
  'usage: node scripts/codemod-split-conversions-registry.mjs [--write]   plan (or apply) the split of an UNSPLIT registry.ts',
  '       node scripts/codemod-split-conversions-registry.mjs --verify --base REF   re-prove a split on disk against registry.ts at REF',
  '       node scripts/codemod-split-conversions-registry.mjs --arrays --base REF   load both registries and compare their tables',
  '       node scripts/codemod-split-conversions-registry.mjs --dts BEFORE_DIST AFTER_DIST   the declaration-file bar on two built dists',
  '       node scripts/codemod-split-conversions-registry.mjs --self-test',
  '       node scripts/codemod-split-conversions-registry.mjs --help',
].join('\n');

function baseRef(argv) {
  const i = argv.indexOf('--base');
  const ref = i >= 0 ? argv[i + 1] : null;
  if (!ref) refuse('--verify and --arrays need --base REF');
  return ref;
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  if (argv.includes('--self-test')) {
    await selfTest();
    if (process.exitCode === 1) return 1;
    if (!selfTestReachedVerdict) {
      console.error('\n✗ codemod-split-conversions-registry self-test: selfTest() returned without reaching its verdict,\n' +
        'so no success line was printed. Exiting 0 here would report a self-test that never\n' +
        'finished as a self-test that passed.');
      return 1;
    }
    return 0;
  }
  if (argv.includes('--dts')) {
    const i = argv.indexOf('--dts');
    const [before, after] = [argv[i + 1], argv[i + 2]];
    if (!before || !after) refuse('--dts needs BEFORE_DIST AFTER_DIST');
    const { failures, readings, control, files } = dtsBar(before, after);
    const differing = readings.filter((r) => r.raw !== 'identical');
    console.log(`declaration files: ${files}; raw-identical ${readings.length - differing.length}; differing ${differing.length}`);
    for (const r of differing) console.log(JSON.stringify(r));
    if (control) console.log(`positive control: ${control.kind} in ${control.file} — ${control.caught ? 'caught' : 'NOT caught'}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.log(failures.length === 0 ? '✓ declaration-file bar: PASS' : `✗ declaration-file bar: FAIL (${failures.length})`);
    return failures.length === 0 ? 0 : 1;
  }
  if (argv.includes('--arrays')) {
    const { failures, readings } = arraysProof(baseRef(argv));
    console.log(`tables: ${JSON.stringify(readings)}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.log(failures.length === 0 ? '✓ tables: base = head' : `✗ tables: ${failures.length} difference(s)`);
    return failures.length === 0 ? 0 : 1;
  }
  const tm = await loadTsMorph();
  if (argv.includes('--verify')) {
    const ref = baseRef(argv);
    const v = verify(tm, gitShow(ref, `${CONV_REL}/${HOST_BASENAME}`), readFileSync(HOST_PATH, 'utf8'), generatedModulesOnDisk());
    printVerify(v);
    return v.failures.length === 0 ? 0 : 1;
  }
  const input = readFileSync(HOST_PATH, 'utf8');
  const planned = plan(tm, input);
  console.log(planReport(planned));
  const out = generate(tm, planned);
  const files = new Map([[HOST_BASENAME, out.host], ...out.modules]);
  console.log(`output tree sha256: ${treeHash(files)} (input sha256 ${sha256(input)})`);
  const v = verify(tm, input, out.host, out.modules);
  printVerify(v);
  if (v.failures.length > 0) {
    console.error('✗ the generated split fails its proof: nothing written. Report the fork; never hand-edit the split.');
    return 1;
  }
  if (!argv.includes('--write')) {
    console.log('plan only: nothing written (pass --write to apply).');
    return 0;
  }
  const onDisk = generatedModulesOnDisk();
  for (const [rel, text] of onDisk) if (!text.includes(MARK)) refuse(`${CONV_REL}/${rel} exists and was not written by this script`);
  for (const [rel] of onDisk) if (!out.modules.has(rel)) unlinkSync(join(CONV_DIR, rel));
  writeFileSync(HOST_PATH, out.host);
  for (const [rel, text] of out.modules) {
    mkdirSync(join(CONV_DIR, posix.dirname(rel)), { recursive: true });
    writeFileSync(join(CONV_DIR, rel), text);
  }
  console.log(`✓ wrote ${HOST_BASENAME} and ${out.modules.size} module(s) under ${CONV_REL}/${ENTRIES}`);
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
  'plan': 9,
  'generation': 6,
  'byte-identity proof': 9,
  'declaration bar': 5,
  'tables': 4,
  'refusals': 7,
});
const SELF_TEST_BATTERY_FLOOR = 6;

/** A registry in the real file's shape: two majors, a private helper, two shared ones, the tables. */
function fixtureRegistry() {
  return `// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A fixture table.
 */

import type { ConversionApplication, MetadataConversion } from './types.js';
import { mapPages, renameKey } from './walk.js';
import { isFilterAST, parseFilterAST } from '../data/filter.zod.js';

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null;
type Emit = (detail: ConversionApplication) => void;

/** Read by one conversion. */
function onlyForA(x: Dict, emit: Emit): Dict {
  return isDict(x) ? renameKey(x, 'a', 'b', 'p', emit) : x;
}

/** The first conversion. */
const convA: MetadataConversion = {
  id: 'conv-a',
  toMajor: 11,
  surface: 's',
  summary: 's',
  apply(stack, emit) {
    return mapPages(stack, (p) => onlyForA(p as Dict, emit));
  },
  fixture: { before: {}, after: {}, expectedNotices: 0 },
};

// A comment between two statements, kept with the one below it.
const convB: MetadataConversion = {
  id: 'conv-b',
  toMajor: 18,
  surface: 's',
  summary: 's',
  apply(stack) {
    const isDict = 1; // a local that shadows the module name is not a read of it
    return isFilterAST(stack) && isDict ? parseFilterAST(stack) as never : stack;
  },
  fixture: { before: {}, after: {}, expectedNotices: 0 },
};

const convC: MetadataConversion = {
  id: 'conv-c',
  toMajor: 18,
  surface: 's',
  summary: 's',
  apply(stack, emit) {
    const e: Emit = emit;
    const bag = { convA: 1 };
    return isDict(stack) ? (e && bag.convA && stack) : stack;
  },
  fixture: { before: {}, after: {}, expectedNotices: 0 },
};

interface OrderedConversion {
  readonly conversion: MetadataConversion;
  readonly order: number;
}

function inApplicationOrder(list: readonly OrderedConversion[]): MetadataConversion[] {
  return [...list].sort((a, b) => a.order - b.order).map((o) => o.conversion);
}

const MAJOR_18_CONVERSIONS: readonly OrderedConversion[] = [
  { conversion: convB, order: 2 },
  { conversion: convC, order: 1 },
];

export const CONVERSIONS_BY_MAJOR: Readonly<Record<number, readonly MetadataConversion[]>> = {
  11: [convA],
  18: /* @__PURE__ */ inApplicationOrder(MAJOR_18_CONVERSIONS),
};

export const ALL_CONVERSIONS: readonly MetadataConversion[] = /* @__PURE__ */ Object.keys(CONVERSIONS_BY_MAJOR)
  .map(Number)
  .flatMap((major) => CONVERSIONS_BY_MAJOR[major]!);
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

  const input = fixtureRegistry();
  const planned = plan(tm, input);
  const moduleOf = (label) => planned.rows.find((r) => r.label === label)?.module;

  open('plan');
  {
    check('each conversion goes to entries/<toMajor>/<id>.ts',
      moduleOf('convA') === 'entries/11/conv-a.ts' && moduleOf('convB') === 'entries/18/conv-b.ts' && moduleOf('convC') === 'entries/18/conv-c.ts');
    check('a helper one conversion reads moves into that conversion\'s module', moduleOf('onlyForA') === 'entries/11/conv-a.ts');
    check('helpers two conversions read move into the shared leaf', ['Dict', 'isDict', 'Emit'].every((n) => moduleOf(n) === SHARED_MODULE),
      ['Dict', 'isDict', 'Emit'].map(moduleOf).join(' | '));
    check('the tables and their helpers stay', ['OrderedConversion', 'inApplicationOrder', 'MAJOR_18_CONVERSIONS', 'CONVERSIONS_BY_MAJOR', 'ALL_CONVERSIONS']
      .every((n) => moduleOf(n) === null));
    const b = planned.rows.find((r) => r.label === 'convB');
    check('a local that shadows a module name is not a read of it', !b.refs.has('isDict'), [...b.refs.keys()].join(', '));
    check('a property named like a module name is not a read of it', !planned.rows.find((r) => r.label === 'convC').refs.has('convA'));
    check('a type-position read is a read', planned.rows.find((r) => r.label === 'convC').refs.get('Emit') === 'local');
    check('an import read is recorded as an import', b.refs.get('isFilterAST') === 'import' && b.refs.get('parseFilterAST') === 'import');
    check('the plan names every statement once', planned.rows.length === 12, String(planned.rows.length));
  }

  open('generation');
  const out = generate(tm, planned);
  {
    const a = out.modules.get('entries/11/conv-a.ts') ?? '';
    const shared = out.modules.get(SHARED_MODULE) ?? '';
    check('an entry module imports its base imports rebased, and the shared leaf',
      a.includes("import type { MetadataConversion } from '../../types.js';")
      && a.includes("import { mapPages, renameKey } from '../../walk.js';")
      && a.includes("import { type Dict, type Emit, isDict } from '../shared.js';"), a.slice(0, 900));
    check('an entry module ends with its one generated export', a.endsWith('\n\nexport { convA };\n'));
    check('the shared leaf exports what the modules read, types spelled as types',
      shared.includes('export { type Dict, type Emit, isDict };') && !/from '\.\.?\/(?:registry|1|11|18)/.test(shared), shared);
    check('the host keeps the imports it still reads and imports each conversion in definition order',
      /import type \{ MetadataConversion \} from '\.\/types\.js';\n\n\/\/ \[#29987 codemod\][^]*?\nimport \{ convA \} from '\.\/entries\/11\/conv-a\.js';\nimport \{ convB \} from '\.\/entries\/18\/conv-b\.js';\nimport \{ convC \} from '\.\/entries\/18\/conv-c\.js';\n/.test(out.host),
      out.host.slice(0, 900));
    check('the host keeps its docblock and its tables byte for byte',
      out.host.startsWith(input.slice(0, input.indexOf('import type'))) && out.host.endsWith(input.slice(input.indexOf('\ninterface OrderedConversion'))));
    const again = generate(tm, plan(tm, input));
    check('two runs write byte-identical trees',
      treeHash(new Map([[HOST_BASENAME, again.host], ...again.modules])) === treeHash(new Map([[HOST_BASENAME, out.host], ...out.modules])));
  }

  open('byte-identity proof');
  {
    const ok = verify(tm, input, out.host, out.modules);
    check('the generated split proves', ok.failures.length === 0 && ok.readings.rebuilt, ok.failures.join(' | '));
    const mutate = (rel, from, to) => new Map([...out.modules].map(([k, t]) => [k, k === rel ? t.replace(from, to) : t]));
    const failsWith = (label, host, modules, needle) => {
      const v = verify(tm, input, host, modules);
      check(label, v.failures.some((f) => f.includes(needle)), v.failures.join(' | ') || 'no failure');
    };
    failsWith('an edited moved statement fails', out.host, mutate('entries/11/conv-a.ts', "summary: 's',", "summary: 't',"), 'differs from its base text');
    failsWith('a re-indented moved statement fails', out.host, mutate('entries/18/conv-c.ts', '  apply(stack, emit) {', '    apply(stack, emit) {'), 'differs from its base text');
    failsWith('a dropped comment above a moved statement fails', out.host, mutate('entries/18/conv-b.ts', '// A comment between two statements, kept with the one below it.\n', ''), 'differs from its base text');
    failsWith('an edited staying table fails', out.host.replace('order: 2', 'order: 3'), out.modules, 'differs from its base text');
    failsWith('a lost conversion module fails', out.host, new Map([...out.modules].filter(([k]) => k !== 'entries/18/conv-b.ts')), 'is in no file of the split');
    failsWith('a conversion filed under the wrong major fails', out.host,
      new Map([...out.modules].map(([k, t]) => [k === 'entries/11/conv-a.ts' ? 'entries/18/conv-a.ts' : k, t])), 'which belongs at entries/11/conv-a.ts');
    failsWith('an import re-pointed at another file fails', out.host, mutate('entries/18/conv-b.ts', "from '../../../data/filter.zod.js'", "from '../../walk.js'"), 'the base from');
    failsWith('a leaf importing the host fails', out.host,
      mutate('entries/18/conv-c.ts', "import type { MetadataConversion } from '../../types.js';", "import type { MetadataConversion } from '../../registry.js';"), 'a leaf never imports the host');
  }

  open('declaration bar');
  {
    const base = 'export declare class A {\n    private x;\n    t: "b" | "a";\n}\nexport { A };\n';
    check('identical files pass', dtsBarFor('f', base, base).failures.length === 0);
    check('a union-member swap passes (the ruling\'s one normalisation)', dtsBarFor('f', base, base.replace('"b" | "a"', '"a" | "b"')).failures.length === 0);
    check('a retyped member fails', dtsBarFor('f', base, base.replace('"b" | "a"', '"b" | "c"')).failures.length > 0);
    const control = injectChange(base);
    check('the positive control makes a private member public, and the bar catches it',
      control?.kind === 'private member made public' && dtsBarFor('f', base, control.text).failures.length > 0);
    check('a changed export list fails', dtsBarFor('f', base, base.replace('export { A };', 'export { A as B };')).failures.length > 0);
  }

  open('tables');
  {
    const t = { exports: ['ALL_CONVERSIONS', 'CONVERSIONS_BY_MAJOR'], all: ['a', 'b', 'c'], byMajor: { 11: ['a'], 18: ['b', 'c'] }, digests: { a: '1', b: '2', c: '3' } };
    const clone = () => JSON.parse(JSON.stringify(t));
    check('equal tables compare equal', compareTables(t, clone()).length === 0);
    const reordered = clone(); reordered.all = ['a', 'c', 'b']; reordered.byMajor[18] = ['c', 'b'];
    check('a reorder is a difference', compareTables(t, reordered).length === 2);
    const changed = clone(); changed.digests.b = '9';
    check('a changed value under the same id is a difference', compareTables(t, changed).some((f) => f.startsWith('b:')));
    const dropped = clone(); delete dropped.byMajor[11];
    check('a dropped major is a difference', compareTables(t, dropped).length > 0);
  }

  open('refusals');
  {
    check('a split file is refused as input', refused(() => plan(tm, out.host)));
    check('an entry without a literal id is refused', refused(() => plan(tm, input.replace("id: 'conv-a',", 'id: String(1),'))));
    check('an id a path could misread is refused', refused(() => plan(tm, input.replace("id: 'conv-a',", "id: 'conv/a',"))));
    check('two entries sharing an id are refused', refused(() => plan(tm, input.replace("id: 'conv-b',", "id: 'conv-a',"))));
    check('two ids equal but for case are refused', refused(() => plan(tm, input.replace("id: 'conv-b',", "id: 'Conv-A',"))));
    check('an entry reading another entry is refused', refused(() => plan(tm, input.replace('const e: Emit = emit;', 'const e: Emit = emit; void convA;'))));
    check('a top-level expression statement is refused', refused(() => plan(tm, input.replace('\ninterface OrderedConversion', '\nconsole.log(1);\ninterface OrderedConversion'))));
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
    console.error(`\n✗ codemod-split-conversions-registry self-test: ${failed} failure(s) (cases and floor).`);
    process.exitCode = 1;
    selfTestReachedVerdict = true;
    return;
  }
  console.log(`\n✓ codemod-split-conversions-registry self-test: ${cases} cases in ${declared.length} batteries pass.`);
  selfTestReachedVerdict = true;
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      if (error instanceof CodemodRefusal) {
        console.error(`✗ codemod-split-conversions-registry: ${error.message}`);
        process.exit(2);
      }
      console.error(error);
      process.exit(2);
    },
  );
}
