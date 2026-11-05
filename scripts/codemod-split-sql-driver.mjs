#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * codemod-split-sql-driver — put `SqlDriver` in
 * `packages/drivers/driver-sql/src/sql-driver.ts` into facade form: move whole
 * sections of its method bodies into stateless facet classes, one per section
 * module, move the top-level declarations ahead of the class into one leaf
 * module, deterministically, and prove the move.
 *
 *   node scripts/codemod-split-sql-driver.mjs                 # plan: print the section table, write nothing
 *   node scripts/codemod-split-sql-driver.mjs --write         # apply the split, then verify it
 *   node scripts/codemod-split-sql-driver.mjs --verify --base <ref>
 *                                                             # re-prove a split on disk against sql-driver.ts at <ref>
 *   node scripts/codemod-split-sql-driver.mjs --self-test
 *   node scripts/codemod-split-sql-driver.mjs --help          # this usage, on any tree (split or not)
 *
 * The input is always an UNSPLIT `sql-driver.ts`: the last one on `main` is
 * the parent of the pilot's landing (`git show 21510bba:<path>`). Copy it over
 * the file, then run `--write`; `--verify --base 21510bba` re-proves the tree.
 * At landing the script runs again on the unsplit text of the latest `main`
 * (ruling A on #29465: regenerate, never rebase); while no commit after the
 * pilot touches `sql-driver.ts` or a module it generated, that text is
 * 21510bba's, which the pilot's `--verify --base 21510bba` on `main` confirms.
 *
 * ## Why a script, and what it repeats
 *
 * The hand series that split this file cut by cut (21 cuts) settled the cut
 * pattern, and the pilot (#29520, ruling A `6583399215`) applied it to whole
 * sections. The facade form (ruling `6624258595` item 1, extended to this file
 * by `6632500982`) is the form `engine.ts` (#29986, #30051) and `protocol.ts`
 * (#29985) took; this script is the pilot with that layer added, the way
 * `scripts/codemod-split-engine.mjs` adds it:
 *
 *  - The method stays on the class with its modifiers and signature
 *    byte-for-byte, so the published surface keeps its names and an instance
 *    spy or a subclass override is still the one callers reach. Only `async`
 *    is dropped from a stub, as every async stub of the series did.
 *  - The body moves, unedited, into a static method of the same name on the
 *    section's facet class (`CrudFacet` in `sql-driver-crud.ts`), at the
 *    class's own indentation, whose `this` is one named host: the `SqlDriver`
 *    members the body reads, typed AS the class members (`SqlDriver['x']`).
 *    A private member is reached the same way as a public one: the indexed
 *    access type names it, and the host factory, inside the class, reads it.
 *  - Docblock ownership (ruling `6624345766` item 1): a PRIVATE method's
 *    docblock moves with its body; a public or protected one stays on the
 *    facade, its contract, and the facet member carries a one-line
 *    placeholder pointing back to it.
 *  - The stub is ONE call, `Facet.x.call(xHost.of(this), …)`: the host is one
 *    object per facet and driver (`HOSTS_MODULE`, built on first use by a
 *    factory the class's static block installs), in which a method goes as a
 *    closure that calls it on the driver at call time (the builder factory as
 *    a bound reference, `BOUND_HOST_METHODS`), a field or accessor as a GETTER
 *    read when the body reads it, and a field a body assigns with a SETTER.
 *  - A static the moved bodies read that is not public goes through the host
 *    module of the class (private-static-through-host, ruling `6624174693`):
 *    `SqlDriverStatics`, declared ahead of the class and filled by a second
 *    static block, which a facet module imports AS `SqlDriver`, so the body
 *    reads `SqlDriver.x` unedited. A static method whose body reads no `this`
 *    moves like an instance one, its stub calling the facet directly.
 *  - The state stays on `SqlDriver`; a body that owns state in a way a host
 *    cannot forward stays on the class, and the facade gate
 *    (`scripts/check-facade-delegation-only.mjs`) names it as an exception.
 *
 * Ruling `6591753301` (option A) widened the pattern two ways, and this script
 * applies both, as the pilot did:
 *
 *  - (a) A section module may import VALUES from `sql-driver.ts`. A staying
 *    top-level name a moved body reads is exported for it by one generated
 *    `export { … }` list (the declaration's own text is not touched), and
 *    `index.ts` re-exports by name, so none reaches the package. Every such
 *    use is inside a function body, so the cycle is never read at evaluation.
 *  - (b) The top-level declarations ahead of the class (`const` / `function` /
 *    `interface` / `type`) move WHOLE, with the comments above them, into one
 *    leaf module, `LEAF_MODULE`, in base order. The leaf never imports
 *    `sql-driver.ts` or a `sql-driver-*` module: a declaration that names the
 *    class, a seam import or a declaration that stays, stays itself.
 *    `sql-driver.ts` imports back what it still reads and re-exports, by name,
 *    every moved declaration it exported, so every importer of
 *    `./sql-driver.js` (`index.ts`, the hand-series seams, the tests) reads
 *    what it read.
 *
 * Sections are read off the class's banners (`SECTION_MODULES`); the members
 * above the first banner are the class head (`CLASS_HEAD_SECTION`). The
 * package compiles without `noUnusedLocals`, so, unlike `engine.ts`, no import
 * is pruned: an import only a moved body reads stays in `sql-driver.ts`, as
 * the pilot left them, and the undo needs no recomputed edit.
 *
 * `check-tenant-chokepoint` reads every `sql-driver-*.ts` module since the
 * pilot's ruling, so a body carrying the builder factory or the tenant scope
 * moves like any other; its readings must be equal before and after.
 *
 * ⛔ The moved text is not re-indented and not formatted: the body is the
 * method's `{ … }` exactly as it stood, so byte-identity is equality of text,
 * not equality after a transform.
 *
 * ## What stays, and why (each reason is mechanical)
 *
 * A method stays whole on the class when moving it would change what it does,
 * what the published surface says, or what a gate or test that reads
 * `sql-driver.ts` BY PATH sees. `STAY_REASONS` lists every reason for a method
 * and `TOP_STAY_REASONS` every reason for a top-level declaration; the plan
 * prints every one that stayed and why. The reasons that are tables rather
 * than rules are `PATH_READER_PINS` (a name whose text a reader extracts from
 * `sql-driver.ts` by path), `PATH_READER_NEEDLES` (literal text a reader
 * requires to find there) and `CLASS_PATH_READER_NEEDLES` (the same, for a
 * reader that also reads the leaf, so only a method carrying it stays). Ruling
 * `6597555122` item 3: a reader that can read the new modules gains them in
 * its reading list in the same PR instead, and needs no row here.
 *
 * ## The proof (`--write` runs it on its own output; `--verify` re-runs it)
 *
 *  1. Byte-identity: every facet member's body, parameters, type parameters
 *     and return type are the base method's text, exactly; a moved docblock is
 *     the base method's docblock, exactly, and only a private method's; every
 *     stub is exactly the one-call stub the generator writes; the host module,
 *     the statics forwarders and both static blocks are exactly what the
 *     generator writes for what they name; every leaf declaration is its base
 *     statement's text with the comments above it, exactly; and undoing all of
 *     it rebuilds the base `sql-driver.ts` byte-for-byte, so nothing else in it
 *     moved. The leaf's relative VALUE imports are followed on disk: none may
 *     reach `sql-driver.ts` or a `sql-driver-*` module.
 *  2. The declaration-file bar for the facade form is ruling `6624345766`'s
 *     PUBLIC SURFACE EQUAL (exported names, public and protected members and
 *     their printed types; private members may change), a report reading on
 *     two built dists, never a `scripts/` file (ruling `6441032442` item 3).
 *     The pilot's `--dts` judged byte-equality after union sorting (ruling
 *     `6348891160`), which a facade cannot meet by construction (the bundled
 *     `.d.ts` prints every private member), so this script no longer carries
 *     it; the PR reports the public-surface reading.
 *
 * ## Determinism
 *
 * The input is the text of `sql-driver.ts`. It is parsed in an in-memory
 * project (no `node_modules`, no build output, no clock), every collection is
 * emitted in source order or sorted, and the output is a pure function of the
 * input: two runs on one input write byte-identical trees (the plan prints the
 * output tree's sha256). Only the proof's leaf-reach walk reads sibling files.
 *
 * ts-morph is a root devDependency (`package.json` declares `ts-morph`
 * `^28.0.0`), the way the other root scripts take `typescript`, `yaml` or
 * `semver`: it is resolved from the root manifest, so a fresh
 * `pnpm install --frozen-lockfile` is all this script needs.
 *
 * Exit codes: 0 done · 1 a proof failed (stop: the generated split is never
 * hand-edited to pass) · 2 the script could not run (unknown banner, missing
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
const SRC_REL = 'packages/drivers/driver-sql/src';
const SRC_DIR = join(ROOT, SRC_REL);
const HOST_BASENAME = 'sql-driver.ts';
const HOST_PATH = join(SRC_DIR, HOST_BASENAME);
const CLASS_NAME = 'SqlDriver';
const CARD = '#29520';
const SCRIPT = 'scripts/codemod-split-sql-driver.mjs';

/** The marker every generated file and stub carries; `--verify` keys on it. */
const MARK = `[${CARD} codemod]`;

/** A generated or hand-series section module of `sql-driver.ts`, by its import specifier. */
const SEAM_SPECIFIER = /^\.\/sql-driver-[a-z0-9-]+\.js$/;

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
 * The members declared above the class's first banner (its fields, the
 * constructor, the dialect probes and the logger plumbing) form one more
 * section, the class head, named here rather than by a banner because the
 * file carries none for it. `null` would keep it on the class.
 */
const CLASS_HEAD_SECTION = Object.freeze(['Class head: dialect probes, logger, configuration', 'sql-driver-class-head.ts']);

/**
 * The leaf the top-level declarations ahead of the class move to, whole
 * (lever (b) of ruling `6591753301`). A leaf: it never imports `sql-driver.ts`
 * or any `sql-driver-*` module, so it is evaluated before the class and forms
 * no cycle with it.
 */
const LEAF_MODULE = 'sql-driver-top-level.ts';

/**
 * The module that holds each facet's host, one per driver (#30105, the
 * facet-host form `engine.ts` took in #30051): a `FacetHost` per facet module,
 * built on first use by the factory the class's static block installs and kept
 * for the driver's life. It imports types only, so it is evaluated before the
 * class whichever module is loaded first, and the class's static block can
 * install into it.
 */
const HOSTS_MODULE = 'sql-driver-facet-hosts.ts';
const HOSTS_CLASS = 'FacetHost';

/**
 * Names whose text a reader takes out of `sql-driver.ts` BY PATH. Moving it
 * would leave that reader reading a stub, or nothing. A class method or a
 * top-level declaration of the name stays. Each row names the reader. A row
 * naming nothing the file declares stops the script (exit 2), so the table
 * cannot rot into names nobody reads.
 */
const PATH_READER_PINS = Object.freeze({
  createColumn: 'packages/cli generate-{field-type-vocabulary,string-family-width,multiple-json-column} pins and '
    + 'scripts/check-keyed-text-bounds.mjs slice `protected createColumn(` to its type switch',
  createAuditTimestampColumn: 'packages/cli generate-builtin-id-column pin reads 600 characters after its signature',
  // The durability catches that stay (the `this.runWideningAlters(` row
  // below) are judged by following `this.logDurabilityFailure(…)` to its
  // body in the same file; a one-call stub there is a call that gate cannot
  // follow, so both catches read "swallowed, no log" (measured, #30105).
  logDurabilityFailure: 'scripts/check-durability-degradation-log-level.mjs follows a catch\'s log helper to its body in the same file',
});

/**
 * Literal text a reader requires to find in `sql-driver.ts` BY PATH. A class
 * method or a top-level declaration whose text carries one stays, so the
 * reader still finds it where it looks. Each row names the reader.
 *
 * A reader that also reads the leaf (`sql-driver-top-level.ts`) has its rows in
 * `CLASS_PATH_READER_NEEDLES` below instead: there a top-level declaration
 * carrying the text may move, and only a method carrying it stays.
 */
const PATH_READER_NEEDLES = Object.freeze({
  "table.string('id').primary();": 'packages/cli generate-builtin-id-column and generate-field-type-vocabulary pins',
  'table.timestamp(name).defaultTo(this.knex.fn.now());': 'packages/cli generate-builtin-id-column pin',
  '...STRUCTURED_JSON_TYPES, ...MULTI_OPTION_TYPES,': 'packages/cli generate-field-type-vocabulary and generate-string-family-width pins',
  'const MEDIA_ID_VARCHAR_CHARS = ': 'packages/cli generate-file-reference-width and generate-field-type-vocabulary pins',
  'table.string(name, MEDIA_ID_VARCHAR_CHARS)': 'packages/cli generate-file-reference-width and generate-field-type-vocabulary pins',
  'this.createColumn(table, name, field, keyedColumns.get(name));': 'packages/cli generate-string-family-width pin',
  'const keyedColumns = indexedKeyColumns({': 'packages/cli generate-string-family-width pin',
  'keyed ? this.keyableTextLength(field) : null': 'scripts/check-keyed-text-bounds.mjs EMITTER_ANCHOR and the generate-string-family-width pin',
  'JSON_COLUMN_TYPES.has(type) ? this.jsonColumn(table, name) : table.string(name)': 'packages/cli generate-field-type-vocabulary and generate-string-family-width pins',
  'if (FILE_REFERENCE_TYPES.has(type)) {': 'packages/cli generate-string-family-width pin',
  // check-durability-degradation-log-level judges the `catch` around a
  // durability call by following SAME-FILE helpers (its `functionBodies` is
  // per source file): `this.logDurabilityFailure(…)` resolves only in
  // sql-driver.ts, so a moved catch reads as "swallowed, no log" (measured:
  // migrateMysqlDatetimeColumns / migrateMysqlTimeColumns red when moved).
  'this.runWideningAlters(': 'scripts/check-durability-degradation-log-level.mjs resolves the catch\'s log helper in the same file',
});

/**
 * Literal text a reader requires to find in `sql-driver.ts` OR the leaf, but
 * reads in no section module. A method whose text carries one stays on the
 * class; a top-level declaration carrying one moves as any other, because the
 * reader reads the leaf it moves to. The same stale-needle refusal applies.
 *
 * All three rows are `sql-driver-compile-refusal-seam.test.ts`'s enumeration:
 * it parses `sql-driver.ts`, the leaf and three named seam modules, and asserts
 * the EXACT set of functions that call `unsupportedFilterError` /
 * `withheldFilterError` or write the `INVALID_FILTER` code, by enclosing name.
 * Its `sources` gained the leaf by ruling 6597555122 (#29520 round 3, the path
 * reader migrated in the same PR as #25521 ask 3 asks), so these rows left
 * `PATH_READER_NEEDLES`. A method still stays: its body would move to a section
 * module the test does not read, and `SqlDriver.resolveWithheldFilterRefusal`,
 * a name the test pins, would drop out of the set.
 */
const CLASS_PATH_READER_NEEDLES = Object.freeze({
  'unsupportedFilterError(': 'sql-driver-compile-refusal-seam.test.ts enumerates its callers (it reads the leaf, no section module)',
  'withheldFilterError(': 'sql-driver-compile-refusal-seam.test.ts enumerates its callers (it reads the leaf, no section module)',
  '.INVALID_FILTER': 'sql-driver-compile-refusal-seam.test.ts enumerates the INVALID_FILTER code writers (it reads the leaf, no section module)',
});

/**
 * The `SqlDriver` methods a host hands its body as a BOUND reference
 * (`driver.m.bind(driver)`, through a getter) rather than as a closure that
 * calls it. Only the builder factory: `check-tenant-chokepoint` refuses a
 * `this.getBuilder(...)` call whose result is never bound to a name, and a
 * forwarding closure is exactly that shape. The bound reference calls the
 * same method on the same driver (a subclass override included); the real
 * call, and the binding the gate counts, stay in the moved body, where the
 * widened gate reads them.
 */
const BOUND_HOST_METHODS = new Set(['getBuilder']);

/**
 * Fields a moved body may CALL (#30147). A body that calls a field reaches it
 * through the host's getter, so the call's receiver becomes the host, not the
 * driver (`field-call`). A field whose value never reads its receiver is
 * called the same either way; each row names why. A row naming no field of
 * the class stops the script (exit 2).
 */
const RECEIVER_FREE_FIELDS = Object.freeze({
  knex: 'a Knex instance is the `function knex(tableName, options)` closure `makeKnex` returns, which reads `knex.context` and never `this`',
});

/**
 * Non-private methods whose return type the base leaves inferred, each with
 * the type the base's declaration output prints for it (`dist/index.d.ts` of
 * `@objectstack/driver-sql` built from the base, copied, never read off the
 * source by hand) (#30147). The stub on the class carries it written out
 * after its parameter list, so the published declaration does not re-infer
 * the type through the facet; the facet member keeps the base text, return
 * type absent. The public-surface `.d.ts` reading of the PR proves each one
 * prints as it did. A row naming no method, or a method the base already
 * annotates, stops the script (exit 2).
 */
const EXPLICIT_RETURN_TYPES = Object.freeze({
  applyFilters: 'void',
  createDatabase: 'Promise<void>',
  ensureDatabaseExists: 'Promise<void>',
  getBuilder: 'knex.Knex.QueryBuilder<any, { _base: any; _hasSelection: false; _keys: never; _aliases: {}; _single: false; _intersectProps: {}; _unionProps: never }[]>',
});

/**
 * Get accessors whose bodies move like methods (#30147): the getter stays on
 * the class with its signature, its body becomes the one-call stub, and the
 * facet member of the same name is the body. Only getters whose bodies the
 * facade gate reads as logic are named; a getter that reads one member or
 * forwards one call is a delegation as it stands. A row naming no get
 * accessor of the class stops the script (exit 2).
 */
const MOVED_ACCESSORS = Object.freeze({
  dateGranularityCapabilities: 'branches on the dialect',
  dialectName: 'branches on the dialect',
  insertReturnsStoredRows: 'an operator over two dialect probes',
  supportsWalJournal: 'a literal answer a subclass overrides',
});

/**
 * Instance fields whose initializer moves (#30147): the field stays on the
 * class with its declared type, and its initializer becomes one call of the
 * facet member of the same name, a function whose body returns the base
 * initializer's text exactly, typed as the field (`SqlDriver['x']`). An
 * instance initializer runs at construction, after every module has been
 * evaluated, so the call never meets a facet in its temporal dead zone; a
 * STATIC initializer runs while the class itself is evaluated, so none is
 * named here. The initializer must read no `this`. A row naming no such field
 * stops the script (exit 2).
 */
const MOVED_FIELD_DEFAULTS = Object.freeze({
  logger: 'the default sink: arrow functions over `console`',
});

/**
 * A parameter default the facade gate reads as data (`'x'`, `-1`, `CONST.X`,
 * `{}`, `[]`, `{ a: 1 }`), the gate's own rule: anything else computes. A
 * stub whose parameter computes its default is written with the parameter
 * optional instead (`nowMs?: number`), and the default stays where the body
 * is, so the value the body sees is the one it saw (#30147).
 */
function isDataDefault(tm, e) {
  const { Node, SyntaxKind } = tm;
  while (Node.isParenthesizedExpression(e) || Node.isAsExpression(e) || Node.isNonNullExpression(e) || Node.isSatisfiesExpression?.(e)) e = e.getExpression();
  const k = e.getKind();
  if ([SyntaxKind.StringLiteral, SyntaxKind.NumericLiteral, SyntaxKind.NoSubstitutionTemplateLiteral, SyntaxKind.TrueKeyword,
    SyntaxKind.FalseKeyword, SyntaxKind.NullKeyword, SyntaxKind.BigIntLiteral].includes(k)) return true;
  if (Node.isPrefixUnaryExpression(e)) return Node.isNumericLiteral(e.getOperand());
  if (Node.isIdentifier(e)) return true;
  if (Node.isPropertyAccessExpression(e)) {
    let x = e;
    while (Node.isPropertyAccessExpression(x)) x = x.getExpression();
    return Node.isIdentifier(x) || x.getKind() === SyntaxKind.ThisKeyword;
  }
  if (Node.isArrayLiteralExpression(e)) return e.getElements().every((x) => isDataDefault(tm, x));
  if (Node.isObjectLiteralExpression(e)) {
    return e.getProperties().every((p) => (Node.isPropertyAssignment(p) && !Node.isComputedPropertyName(p.getNameNode()) && isDataDefault(tm, p.getInitializerOrThrow()))
      || (Node.isShorthandPropertyAssignment(p) && !p.getObjectAssignmentInitializer()));
  }
  return false;
}

/**
 * The parameters of a stub that the stub writes optional (#30147): each
 * parameter whose default computes, carries a type annotation, and is
 * followed only by optional or defaulted parameters. Returns
 * `[{ param, text }]`, `text` being what the stub writes in its place.
 */
function optionalizedParams(tm, m) {
  const params = m.getParameters();
  const out = [];
  params.forEach((p, i) => {
    const init = p.getInitializer();
    if (!init || isDataDefault(tm, init) || !p.getTypeNode() || p.isRestParameter()) return;
    if (!params.slice(i + 1).every((q) => q.hasQuestionToken() || q.getInitializer() || q.isRestParameter())) return;
    out.push({ param: p, text: `${p.getName()}?: ${p.getTypeNode().getText()}` });
  });
  return out;
}

/** Every reason a method stays, with the one-line why the plan prints. */
const STAY_REASONS = Object.freeze({
  'no-section': 'declared above the first section banner, and the class head maps to no module',
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
  'path-reader': 'a reader takes its text out of sql-driver.ts by path (PATH_READER_PINS / PATH_READER_NEEDLES / CLASS_PATH_READER_NEEDLES)',
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
  'static-write': 'its static reads go through SqlDriverStatics and it assigns a static (the forwarder is read-only)',
  'static-as-value': 'its static reads go through SqlDriverStatics and it reads a static method as a value (a forwarder is another function)',
  'static-field-call': 'its static reads go through SqlDriverStatics and it calls a static field or accessor (the receiver would change)',
  'overloaded-static': 'its static reads go through SqlDriverStatics and it calls an overloaded static (one forwarder cannot carry the overloads)',
  'static-route-conflict': 'its facet module reads the statics through SqlDriverStatics, imported AS `SqlDriver`, and it names `SqlDriver` other than as `SqlDriver.<static>`',
  'module-write': 'it assigns a module-scope binding of sql-driver.ts (an import is read-only)',
  'already-moved': 'its body is already a hand-series seam stub',
  'parameter-shadows': 'a parameter shadows a name its one-call stub reads (its facet class or its facet\'s host)',
});

/** Every reason a top-level declaration ahead of the class stays in sql-driver.ts. */
const TOP_STAY_REASONS = Object.freeze({
  'top-kind': 'not a const / function / interface / type declaration of plain names',
  'merged-declaration': 'its name is declared by more than one statement (an overload set or a merged declaration)',
  'path-reader': 'a reader takes its text out of sql-driver.ts by path (PATH_READER_PINS / PATH_READER_NEEDLES)',
  'class-reference': 'it names a class sql-driver.ts declares (the leaf would import sql-driver.ts back)',
  'seam-import': 'it uses an import from a sql-driver-* module (the leaf would reach sql-driver.ts back through it)',
  'needs-stayer': 'it names a declaration that stays (the leaf would import sql-driver.ts back)',
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
      `✗ codemod-split-sql-driver: PREREQUISITE NOT MET — ts-morph does not resolve from ${manifest} ` +
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

/**
 * Each member's section: the last banner above it, or the class head above
 * the first banner. Refuses a banner `sections` does not name. Returns a
 * function from a member node to its `[title, module]` row (the module `null`
 * when the section stays on the class), or null when `head` is null and the
 * member is above the first banner.
 */
function readSections(text, cls, sections, head) {
  const banners = readBanners(text.split('\n'), cls.getStartLineNumber(), cls.getEndLineNumber());
  const unknown = banners.filter((b) => !Object.prototype.hasOwnProperty.call(sections, b.title));
  if (unknown.length > 0) {
    refuse(`banner(s) the section table does not name: ${unknown.map((b) => `"${b.title}" (line ${b.line})`).join(', ')}. ` +
      'Add each to SECTION_MODULES (a module name, or null to keep the section on the class).');
  }
  return (member) => {
    const startLine = member.getStartLineNumber(true);
    let banner = null;
    for (const b of banners) if (b.line < startLine) banner = b;
    if (!banner) return head;
    return [banner.title, sections[banner.title]];
  };
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
  const writes = new Set(); // fields the body assigns: the host carries a setter for each
  const imports = new Map(); // local -> { value }
  const moduleRefs = new Map(); // sql-driver.ts top-level name -> { value }
  // The private-static-through-host rule: the statics the body reads as
  // `SqlDriver.x`, whether one is non-public (that takes the route), what the
  // route cannot carry, and whether the body names `SqlDriver` any other way.
  const classStatics = new Map(); // static -> 'method' | 'getter'
  const routeBlockers = [];
  let readsNonPublicStatic = false;
  let classOther = false;
  let rawParams = null;
  const result = () => ({ reasons, host, writes, imports, moduleRefs, classStatics, routeBlockers, readsNonPublicStatic, classOther, rawParams });

  if (m.isStatic() && ctx.members.has(m.getName())) add('static-name-shared');
  if (!m.getBody()) add('no-body');
  if (m.isAbstract && m.isAbstract()) add('no-body');
  if (typeof m.isGenerator === 'function' && m.isGenerator()) add('generator');
  if (typeof m.getOverloads === 'function' && m.getOverloads().length > 0) add('overloaded');
  if (m.getDecorators().length > 0) add('decorated');
  const nameNode = m.getNameNode();
  if (!Node.isIdentifier(nameNode)) { add('not-identifier-name'); return result(); }
  const name = nameNode.getText();
  if (!m.getReturnTypeNode() && m.getScope() !== 'private' && !Object.hasOwn(ctx.returnTypes, name)) add('inferred-return-type');
  for (const p of m.getParameters()) {
    // A defaulted identifier forwards as it is: the stub keeps the default and
    // hands the body the value it produced.
    if (!Node.isIdentifier(p.getNameNode()) || p.getName() === 'this') add('parameter-shape', p.getName());
  }
  const body = m.getBody();
  if (!body) return result();

  // A comment between the parentheses that no parameter's own text carries:
  // the facet member then takes the base's parameter list verbatim, comments
  // and line breaks included (#30147), instead of one parameter after another.
  const params = m.getParameters();
  rawParams = commentInParameters(tm, m) ? parameterListText(tm, m) : null;

  const methodText = m.getText();
  for (const needle of Object.keys(ctx.needles)) if (methodText.includes(needle)) add('path-reader', JSON.stringify(needle));
  for (const needle of Object.keys(ctx.classNeedles)) if (methodText.includes(needle)) add('path-reader', JSON.stringify(needle));
  if (Object.prototype.hasOwnProperty.call(ctx.pins, name)) add('path-reader', name);

  const regions = [...typeParamsOf(m), ...params, m.getReturnTypeNode(), body].filter(Boolean);
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
          if (called && !Object.hasOwn(ctx.receiverFree, member)) add('field-call', member);
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
        // from the leaf when it moved there, from `sql-driver.ts` (exported
        // for it) when it stayed. Two things a module function cannot do:
        // reach a non-public static of the class, and assign an import.
        const declName = decl.name && ts.isIdentifier(decl.name) ? decl.name.text : node.getText();
        if (ts.isClassDeclaration(decl) && declName === CLASS_NAME) {
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
  if (binding && binding.kind === 'import' && SEAM_SPECIFIER.test(binding.specifier)) add('already-moved', binding.specifier);
  // A body that reads a non-public static takes the route; what the route
  // cannot carry keeps it on the class. (A module another mover routes
  // applies the same to every mover in it: `plan`.)
  if (readsNonPublicStatic) {
    for (const tag of routeBlockers) add(tag);
    if (classOther) add('static-route-conflict');
  }
  return result();
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

/** `sql-driver-transactions-section.ts` -> `TransactionsSectionHost`. */
function hostNameOf(moduleFile) {
  const slug = moduleFile.replace(/^sql-driver-/, '').replace(/\.ts$/, '');
  return `${slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('')}Host`;
}

/** `sql-driver-transactions-section.ts` -> `TransactionsSectionFacet`: the stateless class the bodies move into. */
function facetNameOf(moduleFile) {
  return hostNameOf(moduleFile).replace(/Host$/, 'Facet');
}

/** `sql-driver-transactions-section.ts` -> `transactionsSectionHost`: the module's `FacetHost` in `HOSTS_MODULE`. */
function hostVarOf(moduleFile) {
  const name = hostNameOf(moduleFile);
  return `${name[0].toLowerCase()}${name.slice(1)}`;
}

/** The object the class fills with forwarders to the statics the facets read, and its type. */
const STATICS_NAME = `${CLASS_NAME}Statics`;
const STATICS_HOST_NAME = `${CLASS_NAME}StaticsHost`;
/** How a routed facet module names the class as a type: `SqlDriver` there is `SqlDriverStatics`. */
const CLASS_TYPE_ALIAS = `${CLASS_NAME}Class`;

/** The placeholder above a moved public or protected body: its docblock stays on the class. */
const placeholderDoc = (name) => `/** The body of \`${CLASS_NAME}#${name}\`; the method's docblock there is its contract. */`;
const fieldDefaultDoc = (name) => `/** The initializer of \`${CLASS_NAME}#${name}\`; the field's declaration there is its contract. */`;
/** A member's type parameters; an accessor has none. */
const typeParamsOf = (m) => (typeof m.getTypeParameters === 'function' ? m.getTypeParameters() : []);

/**
 * The statics block `sql-driver.ts` carries for the routed facets: the type and
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
 * The facet hosts (#30105): `HOSTS_MODULE`'s text, and the static block at the
 * end of the class that installs one host factory per facet into it. `facets`
 * lists each facet module whose bodies read the class, with `members` (member
 * -> `method` | `getter`, the union over its bodies) and `written` (the fields
 * a body assigns). The host is the module's whole `<Section>Host`, so every
 * stub of the facet hands its body the same object, which carries every
 * member any body of the facet reads (a `Pick` of it is what each body's
 * `this` names). Each member forwards as the per-call literal did: a method
 * as a closure that calls it on the driver at call time, a field or accessor
 * as a getter read when the body reads it, a written field with a setter that
 * assigns it on the driver. So a spy or subclass override installed after the
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
    ` * ${MARK} The host of each facet of \`${CLASS_NAME}\`, built ONCE per driver (#30105):`,
    ` * what every stub of a facet hands that facet's bodies as \`this\`, in place of`,
    ' * a host literal built on every call. Each `FacetHost` below is filled by the',
    ` * factory \`${CLASS_NAME}\`'s static block installs, the one place that can read`,
    ' * the class\'s private members; the host is built on the first call that needs',
    ' * it and kept for the driver\'s life. A method goes as a closure that calls it',
    ' * on the driver at call time, a field or accessor as a getter (and a setter',
    ' * when a body assigns it), so a body reads and writes the driver exactly as',
    ' * the per-call literal let it.',
    ' *',
    ` * Written by \`${SCRIPT}\`; it imports types only, so it forms no`,
    ' * evaluation cycle and is evaluated before the class whichever module loads',
    ' * first. `index.ts` re-exports nothing from this module.',
    ' */',
    '',
    `import type { ${CLASS_NAME} } from './sql-driver.js';`,
    ...sorted.map((f) => `import type { ${hostNameOf(f.moduleFile)} } from './${f.moduleFile.replace(/\.ts$/, '.js')}';`),
    '',
    `/** One facet's host for each driver: built on first use, kept for the driver's life. */`,
    `export class ${HOSTS_CLASS}<H> {`,
    `  private readonly hosts = new WeakMap<${CLASS_NAME}, H>();`,
    `  private build: ((driver: ${CLASS_NAME}) => H) | undefined;`,
    '',
    '  constructor(private readonly facet: string) {}',
    '',
    `  /** Called once, from \`${CLASS_NAME}\`'s static block. */`,
    `  install(build: (driver: ${CLASS_NAME}) => H): void {`,
    '    this.build = build;',
    '  }',
    '',
    '  /** The host of `driver`, built on first use. */',
    `  of(driver: ${CLASS_NAME}): H {`,
    '    let host = this.hosts.get(driver);',
    '    if (host === undefined) {',
    '      if (this.build === undefined) {',
    `        throw new Error(\`\${this.facet}: ${CLASS_NAME} has not installed its host factory\`);`,
    '      }',
    '      host = this.build(driver);',
    '      this.hosts.set(driver, host);',
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
      `    ${hostVarOf(f.moduleFile)}.install((driver) => ({`,
      ...[...f.members.keys()].sort().flatMap((member) => {
        if (f.members.get(member) === 'getter') {
          return [`      get ${member}() { return driver.${member}; },`,
            ...(f.written.has(member) ? [`      set ${member}(v) { driver.${member} = v; },`] : [])];
        }
        if (BOUND_HOST_METHODS.has(member)) return [`      get ${member}() { return driver.${member}.bind(driver); },`];
        return [`      ${member}: (...a) => driver.${member}(...a),`];
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
 * class, an `sql-driver-*` module's import, or a statement that stays — so the
 * leaf it lands in never imports `sql-driver.ts` back. Pure.
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
          if (binding && (SEAM_SPECIFIER.test(binding.specifier) || binding.specifier === './sql-driver.js')) add('seam-import', local);
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
 * Which moved top-level names the text that STAYS in `sql-driver.ts` still
 * reads, value or type: everything outside the moved statements and the moved
 * method bodies, JSDoc excepted. Those are what `sql-driver.ts` imports back
 * from the leaf.
 */
function hostUsesOfMovers(tm, ctx, top, methodRecords) {
  const { SyntaxKind } = tm;
  const ts = tm.ts;
  const checker = ctx.sf.getProject().getTypeChecker().compilerObject;
  const skip = [];
  for (const r of top.movers) skip.push([r.node.getFullStart(), r.node.getEnd()]);
  for (const r of methodRecords) {
    if (r.reasons.length > 0) continue;
    const moved = r.kind === 'field-default' ? r.node.getInitializer() : r.node.getBody();
    skip.push([moved.getStart(), moved.getEnd()]);
  }
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
 * Read `text` (an `sql-driver.ts`) and decide, per method, where its body goes,
 * and per top-level declaration ahead of the class, whether it moves to the
 * leaf. Pure: the same text gives the same plan.
 */
function plan(tm, text, {
  sections = SECTION_MODULES, head = CLASS_HEAD_SECTION, pins = PATH_READER_PINS, needles = PATH_READER_NEEDLES, classNeedles = CLASS_PATH_READER_NEEDLES,
  receiverFree = RECEIVER_FREE_FIELDS, returnTypes = EXPLICIT_RETURN_TYPES, accessors = MOVED_ACCESSORS, fieldDefaults = MOVED_FIELD_DEFAULTS,
} = {}) {
  const sf = parse(tm, HOST_PATH, text);
  const cls = sf.getClass(CLASS_NAME);
  if (!cls) refuse(`no class ${CLASS_NAME} in ${HOST_BASENAME}`);
  const sectionOf = readSections(text, cls, sections, head);
  // The class's statics: scope, and what a forwarder in `SqlDriverStatics`
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
  const ctx = { text, sf, cls, members: instanceMembers(tm, cls), scope: moduleScope(tm, sf), statics, pins, needles, classNeedles, receiverFree, returnTypes };
  for (const n of [STATICS_NAME, STATICS_HOST_NAME, ...[...Object.values(sections), head && head[1]].filter(Boolean).map((file) => facetNameOf(file))]) {
    if (ctx.scope.bindings.has(n)) refuse(`${HOST_BASENAME} already binds ${n}, a name this script generates`);
  }
  const methodNames = new Set(cls.getMethods().map((m) => m.getName()));
  const stalePins = Object.keys(pins).filter((n) => !methodNames.has(n) && !ctx.scope.bindings.has(n));
  if (stalePins.length > 0) refuse(`PATH_READER_PINS names what ${HOST_BASENAME} no longer declares: ${stalePins.join(', ')}`);
  const staleNeedles = Object.keys(needles).filter((n) => !text.includes(n));
  if (staleNeedles.length > 0) refuse(`PATH_READER_NEEDLES names text ${HOST_BASENAME} no longer carries: ${staleNeedles.map((n) => JSON.stringify(n)).join(', ')}`);
  const staleClassNeedles = Object.keys(classNeedles).filter((n) => !text.includes(n));
  if (staleClassNeedles.length > 0) refuse(`CLASS_PATH_READER_NEEDLES names text ${HOST_BASENAME} no longer carries: ${staleClassNeedles.map((n) => JSON.stringify(n)).join(', ')}`);

  // The #30147 tables: every row names what the class declares, as it says.
  for (const n of Object.keys(receiverFree)) {
    if (ctx.members.get(n)?.kind !== 'field') refuse(`RECEIVER_FREE_FIELDS names ${n}, which is no instance field of ${CLASS_NAME}`);
  }
  for (const n of Object.keys(returnTypes)) {
    const ms = cls.getMethods().filter((m) => m.getName() === n && !m.isStatic());
    if (ms.length !== 1) refuse(`EXPLICIT_RETURN_TYPES names ${n}, which is not one instance method of ${CLASS_NAME}`);
    if (ms[0].getReturnTypeNode()) refuse(`EXPLICIT_RETURN_TYPES names ${n}, whose return type the base already writes`);
  }
  const getters = new Map();
  for (const n of Object.keys(accessors)) {
    const gs = cls.getGetAccessors().filter((g) => g.getName() === n && !g.isStatic());
    if (gs.length !== 1) refuse(`MOVED_ACCESSORS names ${n}, which is not one instance get accessor of ${CLASS_NAME}`);
    getters.set(n, gs[0]);
  }
  const defaultFields = new Map();
  for (const n of Object.keys(fieldDefaults)) {
    const fs = cls.getProperties().filter((f) => f.getName() === n && !f.isStatic());
    if (fs.length !== 1 || !fs[0].getInitializer() || !fs[0].getTypeNode()) {
      refuse(`MOVED_FIELD_DEFAULTS names ${n}, which is not one typed instance field of ${CLASS_NAME} with an initializer`);
    }
    defaultFields.set(n, fs[0]);
  }

  const top = planTopLevel(tm, ctx);

  const records = [];
  for (const m of cls.getMethods()) {
    const startLine = m.getStartLineNumber(true);
    const section = sectionOf(m);
    const read = readMethod(tm, ctx, m);
    const name = m.getName();
    if (!section) read.reasons.unshift('no-section');
    else if (section[1] === null) read.reasons.unshift('section-kept');
    const lineCount = m.getEndLineNumber() - startLine + 1;
    const body = m.getBody();
    const bodyLines = body ? body.getEndLineNumber() - body.getStartLineNumber() + 1 : 0;
    // Docblock ownership (ruling 6624345766 item 1): a PRIVATE method's
    // docblock moves with its body; a public or protected one stays on the
    // facade, where the published surface prints it.
    const docStart = m.getStart(true);
    const doc = m.getScope() === 'private' && docStart < m.getStart() ? text.slice(docStart, m.getStart()) : null;
    const record = {
      name, node: m, section: section ? section[0] : null, module: section ? section[1] : null,
      startLine, lineCount, bodyLines, doc, docLines: doc ? doc.split('\n').length - 1 : 0, ...read,
    };
    if (section && section[1]) {
      for (const p of m.getParameters()) {
        if (p.getName() === facetNameOf(section[1]) || p.getName() === hostVarOf(section[1])) read.reasons.push(`parameter-shadows: ${p.getName()}`);
      }
    }
    if (record.reasons.length === 0) record.stubLines = stubBody(record, record.module, '  ').split('\n').length;
    record.kind = 'method';
    record.optionalized = optionalizedParams(tm, m);
    records.push(record);
  }
  // The get accessors MOVED_ACCESSORS names move as methods do (#30147).
  for (const g of getters.values()) {
    const section = sectionOf(g);
    const read = readMethod(tm, ctx, g);
    if (!section) read.reasons.unshift('no-section');
    else if (section[1] === null) read.reasons.unshift('section-kept');
    if (!g.getReturnTypeNode()) read.reasons.push('inferred-return-type');
    const startLine = g.getStartLineNumber(true);
    const body = g.getBody();
    const record = {
      name: g.getName(), node: g, section: section ? section[0] : null, module: section ? section[1] : null, startLine,
      lineCount: g.getEndLineNumber() - startLine + 1, bodyLines: body.getEndLineNumber() - body.getStartLineNumber() + 1,
      doc: null, docLines: 0, ...read, kind: 'accessor', optionalized: [],
    };
    if (record.reasons.length === 0) record.stubLines = stubBody(record, record.module, '  ').split('\n').length;
    records.push(record);
  }
  // The field initializers MOVED_FIELD_DEFAULTS names (#30147): one that
  // reads `this`, or a name of this file (an import or a top-level binding),
  // is refused, since the facet member would carry it unedited.
  for (const f of defaultFields.values()) {
    const section = sectionOf(f);
    const init = f.getInitializer();
    const checker = sf.getProject().getTypeChecker().compilerObject;
    for (const node of [init, ...init.getDescendants()]) {
      if (node.getKind() === tm.SyntaxKind.ThisKeyword) refuse(`MOVED_FIELD_DEFAULTS: the initializer of ${f.getName()} reads \`this\``);
      if (node.getKind() !== tm.SyntaxKind.Identifier) continue;
      const symbol = checker.getSymbolAtLocation(node.compilerNode);
      for (const decl of symbol?.declarations ?? []) {
        if (decl.getSourceFile() !== sf.compilerNode) continue;
        if (decl.getStart() >= init.getStart() && decl.getEnd() <= init.getEnd()) continue;
        refuse(`MOVED_FIELD_DEFAULTS: the initializer of ${f.getName()} reads ${node.getText()}, a name of ${HOST_BASENAME}`);
      }
    }
    const reasons = !section ? ['no-section'] : section[1] === null ? ['section-kept'] : [];
    const startLine = f.getStartLineNumber(true);
    records.push({
      name: f.getName(), node: f, section: section ? section[0] : null, module: section ? section[1] : null, startLine,
      lineCount: f.getEndLineNumber() - startLine + 1, bodyLines: init.getEndLineNumber() - init.getStartLineNumber() + 1,
      doc: null, docLines: 0, reasons, host: new Map(), writes: new Set(), imports: new Map(), moduleRefs: new Map(),
      classStatics: new Map(), routeBlockers: [], readsNonPublicStatic: false, classOther: false, rawParams: null,
      kind: 'field-default', optionalized: [], stubLines: 1,
    });
  }
  // Facet member order is the class's: methods, accessors and fields by position.
  records.sort((a, b) => a.node.getStart() - b.node.getStart());

  // The private-static-through-host rule, per facet module: once one mover
  // reads the statics through `SqlDriverStatics` (imported AS `SqlDriver`),
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
  // names from the leaf and staying names from sql-driver.ts (lever (a));
  // sql-driver.ts reads moved names from the leaf.
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
 * The import lines a module needs: sql-driver.ts's own imports it uses, in
 * sql-driver.ts's import order; then the moved top-level names, from the leaf;
 * then what stayed in sql-driver.ts (lever (a)), including the class.
 */
function importLines(scope, users, { needsHost = false, moduleRefs = new Map(), leafNames = new Map(), routed = false } = {}) {
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
    // The private-static-through-host rule: `SqlDriver.x` in a moved body reads
    // the forwarder object; the host interface names the class by an alias.
    fromHost.delete(CLASS_NAME);
    fromHost.set(`${STATICS_NAME} as ${CLASS_NAME}`, { value: true });
    if (needsHost) fromHost.set(`${CLASS_NAME} as ${CLASS_TYPE_ALIAS}`, { value: false });
  } else if (needsHost && !fromHost.has(CLASS_NAME)) fromHost.set(CLASS_NAME, { value: false });
  out.push(...importPair(leafSpecifier(), fromLeaf));
  out.push(...importPair('./sql-driver.js', fromHost));
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

/** The text between a member's parentheses, exactly. */
function parameterListText(tm, m) {
  const { SyntaxKind } = tm;
  const open = m.getFirstChildByKindOrThrow(SyntaxKind.OpenParenToken);
  const close = m.getFirstChildByKindOrThrow(SyntaxKind.CloseParenToken);
  return m.getSourceFile().getFullText().slice(open.getEnd(), close.getStart());
}

/** Whether a comment stands between a member's parentheses that no parameter's own text carries. */
function commentInParameters(tm, m) {
  const { SyntaxKind } = tm;
  const open = m.getFirstChildByKindOrThrow(SyntaxKind.OpenParenToken);
  let between = parameterListText(tm, m);
  for (const p of [...m.getParameters()].reverse()) {
    between = between.slice(0, p.getStart() - open.getEnd()) + between.slice(p.getEnd() - open.getEnd());
  }
  return /\/\/|\/\*/.test(between);
}

/**
 * A facet member's parameter list: its host parameter (when it has one),
 * then the base's parameters. One after another, unless a comment stands
 * between the base's parentheses: then the base's list verbatim, so the
 * comment moves with it (#30147).
 */
function facetParamsText(thisParam, m, raw) {
  if (raw === null) return [...(thisParam ? [thisParam] : []), ...paramsText(m)].join(', ');
  if (!thisParam) return raw;
  return `${thisParam},${/^\s/.test(raw) ? '' : ' '}${raw}`;
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
  out.push(...wrapComment([MARK, 'The', `"${title}"`, 'section', 'of', '`SqlDriver`:', 'the', 'bodies', 'of',
    ...names, 'moved', 'out', 'of', '`sql-driver.ts`', 'whole', 'by', `\`${SCRIPT}\`.`]));
  out.push(' *');
  out.push(` * A MOVE, not a redesign. {@link ${facet}} is a stateless facet of \`SqlDriver\``);
  out.push(' * (ruling 6624345766): each static method of it is the body of the `SqlDriver`');
  out.push(' * method of the same name exactly as it stood: not re-indented, not');
  out.push(' * formatted, not edited. The method stays on the class as a one-call stub with');
  out.push(' * its signature, so the published surface, an instance spy and a subclass');
  out.push(' * override are what they were. A public or protected method keeps its');
  out.push(' * docblock on the class, the contract; a private method\'s docblock moved here');
  out.push(' * with its body. The state stays on `SqlDriver`.');
  out.push(' *');
  if (needsHost) {
    out.push(...wrapComment((`The bodies reach the class through {@link ${hostName}}: exactly the \`SqlDriver\` ` +
      'members they read, private ones included. Every stub hands its body, by a `.call`, the same host: ' +
      `\`${hostVarOf(moduleFile)}\` in \`${HOSTS_MODULE}\`, built once per driver by the class's static block. ` +
      'Methods go as closures that call them on the driver at call time, so a subclass override or an ' +
      'instance spy is still the one reached; fields and accessors go as GETTERS, read when the body reads ' +
      'them, as they were on the class, and a field a body assigns goes with a SETTER that assigns it on ' +
      'the driver.').split(' ')));
  } else {
    out.push(' * No body reads an `SqlDriver` member, so each stub calls its body directly.');
  }
  if (routed) {
    out.push(' *');
    out.push(` * \`SqlDriver\` here is \`${STATICS_NAME}\` (imported AS \`SqlDriver\`): forwarders to the`);
    out.push(' * statics the bodies read, private ones included, which the class fills in a');
    out.push(` * static block; the class as a type is \`${CLASS_TYPE_ALIAS}\`.`);
  }
  out.push(' *');
  if (readsHostValues) {
    out.push(' * Values that stayed in `sql-driver.ts` are imported from it (lever (a) of');
    out.push(' * ruling 6591753301); every use is inside a function body, so the import');
    out.push(' * cycle is never read at evaluation time. `index.ts` re-exports nothing from');
    out.push(' * this module.');
  } else {
    out.push(' * The module imports `sql-driver.ts` for types only, so the two modules form no');
    out.push(' * evaluation cycle. `index.ts` re-exports nothing from this module.');
  }
  out.push(' */');
  out.push('');
  out.push(...importLines(scope, movers, { needsHost: needsHost || movers.some((r) => r.kind === 'field-default'), moduleRefs, leafNames, routed }));
  if (needsHost) {
    out.push('');
    out.push('/**');
    out.push(` * The \`SqlDriver\` members the bodies of {@link ${facet}} read — every one of`);
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
  out.push(`/** The bodies of the "${title}" section of \`SqlDriver\`: a stateless facet, called by the class's stubs. */`);
  out.push(`export class ${facet} {`);
  movers.forEach((r, i) => {
    const m = r.node;
    const picks = [...r.host.keys()].sort().map((k) => `'${k}'`).join(' | ');
    if (i > 0) out.push('');
    if (r.kind === 'field-default') {
      // The field's initializer, returned exactly, typed as the field.
      out.push(`  ${fieldDefaultDoc(r.name)}\n  static ${r.name}(): ${classType}['${r.name}'] {\n    return ${m.getInitializer().getText()};\n  }`);
      return;
    }
    const thisParam = r.host.size > 0 ? `this: Pick<${hostName}, ${picks}>` : null;
    const ret = m.getReturnTypeNode() ? `: ${m.getReturnTypeNode().getText()}` : '';
    const typeParams = typeParamsOf(m).length > 0 ? `<${typeParamsOf(m).map((t) => t.getText()).join(', ')}>` : '';
    const isAsync = typeof m.isAsync === 'function' && m.isAsync();
    out.push(`  ${r.doc ?? `${placeholderDoc(r.name)}\n  `}static ${isAsync ? 'async ' : ''}${r.name}${typeParams}(${facetParamsText(thisParam, m, r.rawParams)})${ret} ${m.getBody().getText()}`);
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
  out.push(...wrapComment([MARK, 'The', 'top-level', 'declarations', 'ahead', 'of', '`SqlDriver`', 'in', '`sql-driver.ts`',
    'that', 'moved', 'out', 'whole', 'by', `\`${SCRIPT}\``, '(lever', '(b)', 'of', 'ruling',
    '6591753301).']).map((l) => l.replace(/^ \*/, '//')));
  out.push('//');
  out.push('// A MOVE, not a redesign: each declaration below is its `sql-driver.ts` text');
  out.push('// exactly, with the comments above it, in the order it stood there. A LEAF:');
  out.push('// it imports neither `sql-driver.ts` nor any `sql-driver-*` module, so it is');
  out.push('// evaluated before the class and forms no cycle with it. `sql-driver.ts`');
  out.push('// re-exports, by name, every declaration here it exported before, so every');
  out.push('// importer of `./sql-driver.js` reads what it read.');
  out.push('');
  out.push(...importLines(scope, top.movers));
  let text = out.join('\n');
  for (const r of top.movers) text += r.node.getFullText();
  if (leafExports.length > 0) {
    text += `\n\n// ${MARK} Declared above without \`export\`, and read by \`sql-driver.ts\` or a section module.\n`;
    text += `${namedStatement('export', [...leafExports].sort(), ';')}`;
  }
  return `${text}\n`;
}

const DOC_MOVED = 'its docblock with it';

/** A moved field initializer's replacement: one call of its facet member. */
const fieldDefaultCall = (moduleFile, name) => `${facetNameOf(moduleFile)}.${name}()`;

/**
 * A stub's body: the marker line, then ONE call of the facet member of the
 * same name. A body that reads the class is called with its facet's host, the
 * one object per driver `HOSTS_MODULE` keeps (#30105), not a literal built per
 * call. `node` is the method (base or head: the stub keeps its signature).
 * Pure: `verify` rebuilds every stub with it and compares.
 */
function stubBody({ node, name, usesHost, docMoved }, moduleFile, closeIndent) {
  const ind = `${closeIndent}  `;
  const hostName = hostNameOf(moduleFile);
  // A generic method calls its body INSTANTIATED with its own type
  // parameters (`Function#call` alone would erase them).
  const typeArgs = typeParamsOf(node).map((t) => t.getName());
  const fn = typeArgs.length > 0 ? `(${facetNameOf(moduleFile)}.${name}<${typeArgs.join(', ')}>)` : `${facetNameOf(moduleFile)}.${name}`;
  const out = ['{'];
  const args = forwardList(node).join(', ');
  const doc = docMoved ? `, ${DOC_MOVED}` : '';
  if (!usesHost) {
    out.push(`${ind}// ${MARK} The body moved to \`${moduleFile}\`${doc}.`);
    out.push(`${ind}return ${fn}(${args});`);
  } else {
    out.push(`${ind}// ${MARK} The body moved to \`${moduleFile}\`${doc} (see \`${hostName}\`).`);
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
 * Apply a plan to `text`. Returns `{ host, modules }`: the new
 * `sql-driver.ts` and a Map of module basename -> text (the leaf and the host
 * module among them). Pure.
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
      importBlock.push(`\n// ${MARK} Re-exported by name, so every importer of \`./sql-driver.js\` reads what it read.`);
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
      if (r.kind === 'field-default') {
        // The initializer becomes one call of the facet member that returns it.
        const init = r.node.getInitializer();
        edits.push({ start: init.getStart(), end: init.getEnd(), text: fieldDefaultCall(moduleFile, r.name) });
        continue;
      }
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
      // An inferred return type the base's declaration output prints, written out (#30147).
      if (r.kind === 'method' && !r.node.getReturnTypeNode() && Object.hasOwn(ctx.returnTypes, r.name)) {
        const close = r.node.getFirstChildByKindOrThrow(tm.SyntaxKind.CloseParenToken);
        edits.push({ start: close.getEnd(), end: close.getEnd(), text: `: ${ctx.returnTypes[r.name]}` });
      }
      for (const o of r.optionalized) edits.push({ start: o.param.getStart(), end: o.param.getEnd(), text: o.text });
    }
  }
  // A hand-series stub (its body already a seam call) whose parameter
  // computes its default takes the same optional spelling; the seam function
  // keeps the default (`verify` reads it there) (#30147).
  for (const r of planned.records) {
    if (r.kind !== 'method' || r.reasons.length === 0 || !r.reasons.every((x) => x.startsWith('already-moved'))) continue;
    for (const o of r.optionalized) edits.push({ start: o.param.getStart(), end: o.param.getEnd(), text: o.text });
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
      if (ctx.scope.bindings.has(hostVarOf(f.moduleFile))) refuse(`sql-driver.ts already binds ${hostVarOf(f.moduleFile)}, the name of ${f.moduleFile}'s host`);
    }
    tail.push(`\n\n${hosts.block}`);
    importBlock.push(`\n// ${MARK} The facets' hosts, one per driver, which the static block at the end of the class builds.`);
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
  const leafNames = top.moverNames;
  if (top.movers.length > 0) moduleTexts.set(LEAF_MODULE, leafText(ctx.scope, top, leafExports));
  for (const [moduleFile, movers] of modules) {
    moduleTexts.set(moduleFile, moduleText(moduleFile, movers[0].section, movers, ctx.scope, leafNames, routedModules.has(moduleFile)));
  }
  if (hosts) moduleTexts.set(HOSTS_MODULE, hosts.module);
  return { host: out, modules: moduleTexts };
}

// ── Proof 1: byte-identity ───────────────────────────────────────────────────

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Prove a split against its base, from the texts alone (it shares no state with
 * `generate`): every generated function is its base method's text, every leaf
 * declaration is its base statement's text, and undoing the split rebuilds the
 * base `sql-driver.ts` byte-for-byte.
 *
 * Undoing is: put each body back on its stub (and `async` back, and a moved
 * docblock back above it), drop the generated statics forwarders and the two
 * generated static blocks once each is proved to be exactly what the generator
 * writes for what it names, drop the generated import / export statements,
 * then splice the leaf's statements back between the statements that stayed —
 * the interleaving read off the base by NAME only, so every byte of the result
 * comes from the head, a facet module or the leaf.
 *
 * Returns `{ failures, moved, movedTop, linesBefore, linesAfter, routedStatics }`; no failure = proved.
 */
function verify(tm, baseText, headText, moduleTexts, { readSibling = null, returnTypes = EXPLICIT_RETURN_TYPES } = {}) {
  const { Node } = tm;
  const failures = [];
  const moved = [];
  const movedTop = [];
  const baseSf = parse(tm, HOST_PATH, baseText);
  const baseCls = baseSf.getClass(CLASS_NAME);
  const headSf = parse(tm, HOST_PATH, headText);
  const headCls = headSf.getClass(CLASS_NAME);
  const none = { failures: [`no class ${CLASS_NAME} at base or head`], moved, movedTop, linesBefore: 0, linesAfter: 0 };
  if (!baseCls || !headCls) return none;
  const target = baseText;

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
          if (st.getModuleSpecifierValue() === './sql-driver.js' || SEAM_SPECIFIER.test(st.getModuleSpecifierValue())) {
            failures.push(`${file}: imports ${st.getModuleSpecifierValue()} — a leaf never imports sql-driver.ts or a sql-driver-* module`);
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
        // sql-driver.ts or a sql-driver-* module. A type-only import is erased, so it
        // forms no evaluation cycle and is not followed.
        const seen = new Set();
        const queue = valueSpecifiers(text).map((spec) => [file, spec]);
        while (queue.length > 0) {
          const [from, spec] = queue.shift();
          let rel = relative(SRC_DIR, resolve(dirname(join(SRC_DIR, from)), spec.replace(/\.js$/, '.ts')));
          if (seen.has(rel)) continue;
          seen.add(rel);
          if (rel === HOST_BASENAME || /^sql-driver-[a-z0-9-]+\.ts$/.test(rel)) {
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

  const marker = new RegExp(`^\\{\\s*// ${MARK.replace(/[[\]]/g, '\\$&')} The body moved to \`(sql-driver-[a-z0-9-]+\\.ts)\`(, ${DOC_MOVED})?`);
  const edits = [];
  // A base member of the head member's kind and name: a method, or a get accessor (#30147).
  const baseOf = (m) => (Node.isGetAccessorDeclaration(m) ? baseCls.getGetAccessors() : baseCls.getMethods())
    .find((x) => x.getName() === m.getName() && x.isStatic() === m.isStatic());
  for (const m of [...headCls.getMethods(), ...headCls.getGetAccessors()]) {
    const body = m.getBody();
    if (!body) continue;
    const hit = marker.exec(body.getText());
    if (!hit) {
      // A stub that is not generated (a hand-series one) may still write a
      // parameter optional whose default computes; the seam keeps the default.
      const base = baseOf(m);
      if (base && Node.isMethodDeclaration(m)) undoOptionalized(m, base, null);
      continue;
    }
    const name = m.getName();
    const mod = modules.get(hit[1]);
    const fn = mod && mod.fns.get(name);
    if (!fn) { failures.push(`${name}: its stub names ${hit[1]}, which has no function ${name}`); continue; }
    mod.claimed.add(name);
    // The stub itself is exactly what `stubBody` writes for this method: one
    // call of the facet member of the same name, with the facet's own host
    // when the body reads the class (#30105).
    {
      const lineStart = headText.lastIndexOf('\n', body.getEnd() - 1) + 1;
      const closeIndent = headText.slice(lineStart, body.getEnd() - 1);
      const usesHost = fn.getParameters().some((p) => p.getName() === 'this');
      const want = stubBody({ node: m, name, usesHost, docMoved: Boolean(hit[2]) }, hit[1], closeIndent);
      if (body.getText() !== want) failures.push(`${name}: its stub is not the generated one-call stub (want ${JSON.stringify(want.split('\n').at(-2).trim())})`);
    }
    const base = baseOf(m);
    if (!base || !base.getBody()) { failures.push(`${name}: no method of that name with a body at base`); continue; }
    const fnParams = fn.getParameters().filter((p) => p.getName() !== 'this').map((p) => p.getText());
    const baseParams = base.getParameters().map((p) => p.getText());
    // With a comment between the base's parentheses, the facet member carries
    // the base's list verbatim after its host parameter (#30147).
    const rawSame = !commentInParameters(tm, base) || (() => {
      const thisParam = fn.getParameters().find((p) => p.getName() === 'this');
      return facetParamsText(thisParam ? thisParam.getText() : null, base, parameterListText(tm, base)) === parameterListText(tm, fn);
    })();
    const asyncOf = (x) => typeof x.isAsync === 'function' && x.isAsync();
    const same = {
      body: fn.getBody().getText() === base.getBody().getText(),
      params: JSON.stringify(fnParams) === JSON.stringify(baseParams) && rawSame,
      returnType: (fn.getReturnTypeNode()?.getText() ?? null) === (base.getReturnTypeNode()?.getText() ?? null),
      async: asyncOf(fn) === asyncOf(base),
      typeParameters: JSON.stringify(typeParamsOf(fn).map((t) => t.getText())) === JSON.stringify(typeParamsOf(base).map((t) => t.getText())),
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
    } else if (lead !== `${placeholderDoc(name)}\n  `) {
      failures.push(`${name}: the facet member's leading text is neither its moved docblock nor the placeholder`);
    }
    for (const [what, ok] of Object.entries(same)) if (!ok) failures.push(`${name}: the generated function's ${what} is not the base method's`);
    moved.push({
      name, module: hit[1], bodySha: sha256(fn.getBody().getText()), baseBodySha: sha256(base.getBody().getText()),
      lines: base.getBody().getEndLineNumber() - base.getBody().getStartLineNumber() + 1, text: fn.getText(), docMoved, ...same,
    });
    edits.push({ start: body.getStart(), end: body.getEnd(), text: fn.getBody().getText() });
    if (asyncOf(fn)) edits.push({ start: m.getNameNode().getStart(), end: m.getNameNode().getStart(), text: 'async ' });
    // A return type the stub writes and the base leaves inferred: only the
    // one EXPLICIT_RETURN_TYPES names, undone by deleting it (#30147).
    if (Node.isMethodDeclaration(m) && m.getReturnTypeNode() && !base.getReturnTypeNode()) {
      if (returnTypes[name] !== m.getReturnTypeNode().getText()) failures.push(`${name}: its stub writes a return type the base leaves inferred and EXPLICIT_RETURN_TYPES does not name`);
      const close = m.getFirstChildByKindOrThrow(tm.SyntaxKind.CloseParenToken);
      edits.push({ start: close.getEnd(), end: m.getReturnTypeNode().getEnd(), text: '' });
    }
    if (Node.isMethodDeclaration(m)) undoOptionalized(m, base, fn);
  }

  // A parameter a stub writes optional (`x?: T`) where the base computes its
  // default (`x: T = f()`): exactly that spelling, of a computed default, and
  // the default kept where the body is: in the facet member (`fn`) or, for a
  // hand-series stub, in the seam function its import names. The undo puts the
  // callee's parameter text back (#30147).
  function undoOptionalized(m, base, fn) {
    const hp = m.getParameters();
    const bp = base.getParameters();
    if (hp.length !== bp.length) return;
    let seam;
    hp.forEach((p, i) => {
      const b = bp[i];
      if (p.getText() === b.getText()) return;
      const init = b.getInitializer();
      if (!init || isDataDefault(tm, init) || !b.getTypeNode() || p.getInitializer() || !p.hasQuestionToken()
        || p.getText() !== `${b.getName()}?: ${b.getTypeNode().getText()}`) return;
      let callee = null;
      if (fn) {
        callee = fn.getParameters().filter((x) => x.getName() !== 'this')[i] ?? null;
      } else {
        if (seam === undefined) {
          seam = null;
          const binding = headSf.getImportDeclarations().flatMap((d) => d.getNamedImports().map((s) => [d, s]))
            .find(([, s]) => (s.getAliasNode()?.getText() ?? s.getName()) === m.getName());
          const spec = binding ? binding[0].getModuleSpecifierValue() : null;
          const src = spec && SEAM_SPECIFIER.test(spec) && readSibling ? readSibling(spec.replace(/^\.\//, '').replace(/\.js$/, '.ts')) : null;
          const fnDecl = src ? parse(tm, join(SRC_DIR, spec.replace(/\.js$/, '.ts')), src).getFunction(binding[0].getNamedImports().find((s) => (s.getAliasNode()?.getText() ?? s.getName()) === m.getName()).getName()) : null;
          seam = fnDecl ? fnDecl.getParameters().filter((x) => x.getName() !== 'this') : null;
          if (!seam) failures.push(`${m.getName()}: its stub writes a parameter optional, and the seam function that keeps the default cannot be read`);
        }
        callee = seam ? seam[i] ?? null : null;
      }
      if (!callee) return;
      if (callee.getText() !== b.getText()) { failures.push(`${m.getName()}: parameter ${b.getName()} is optional on the stub, but its callee does not keep the base default`); return; }
      edits.push({ start: p.getStart(), end: p.getEnd(), text: callee.getText() });
    });
  }

  // A field whose initializer moved (#30147): the head initializer is one call
  // of the facet member of the field's name, and that member returns the
  // initializer exactly, typed as the field. The undo puts the text back.
  for (const f of headCls.getProperties()) {
    const init = f.getInitializer();
    const hit = init ? /^([A-Z]\w*Facet)\.(\w+)\(\)$/.exec(init.getText()) : null;
    if (!hit || hit[2] !== f.getName() || f.isStatic()) continue;
    const name = f.getName();
    const entry = [...modules].find(([file]) => facetNameOf(file) === hit[1]);
    const fn = entry && entry[1].fns.get(name);
    if (!fn) { failures.push(`${name}: its initializer calls ${hit[1]}.${name}, which no facet module declares`); continue; }
    const [file, mod] = entry;
    mod.claimed.add(name);
    const lead = mod.text.slice(fn.getStart(true), fn.getStart());
    const bodyText = fn.getBody().getText();
    const want = /^\{\n {4}return ([\s\S]*);\n {2}\}$/.exec(bodyText);
    const retType = fn.getReturnTypeNode()?.getText() ?? null;
    const typeOk = retType === `${CLASS_NAME}['${name}']` || retType === `${CLASS_TYPE_ALIAS}['${name}']`;
    const baseField = baseCls.getProperties().find((x) => x.getName() === name && !x.isStatic());
    const ok = Boolean(want) && typeOk && fn.getParameters().length === 0 && !fn.isAsync() && lead === `${fieldDefaultDoc(name)}\n  `
      && init.getText() === fieldDefaultCall(file, name) && baseField && baseField.getInitializer();
    if (!ok) { failures.push(`${name}: its moved initializer is not the generated one (a returning member typed as the field, called with no arguments)`); continue; }
    const same = want[1] === baseField.getInitializer().getText();
    if (!same) failures.push(`${name}: the facet member does not return the base initializer exactly`);
    moved.push({ name, module: file, bodySha: sha256(want[1]), baseBodySha: sha256(baseField.getInitializer().getText()),
      lines: baseField.getInitializer().getEndLineNumber() - baseField.getInitializer().getStartLineNumber() + 1, text: fn.getText(),
      docMoved: false, body: same, params: true, returnType: true, async: true, typeParameters: true, static: true });
    edits.push({ start: init.getStart(), end: init.getEnd(), text: want[1] });
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

  // The facet hosts (#30105): `HOSTS_MODULE` and the static block that
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
    const hit = /^\.\/(sql-driver-[a-z0-9-]+)\.js$/.exec(spec ?? '');
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

  if (rebuilt !== target) {
    const a = rebuilt.split('\n');
    const b = target.split('\n');
    let i = 0;
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i += 1;
    failures.push(`undoing the split does not rebuild the base sql-driver.ts: first difference at line ${i + 1}` +
      `\n    rebuilt: ${JSON.stringify(a[i] ?? '<end>')}\n    base:    ${JSON.stringify(b[i] ?? '<end>')}`);
  }
  if (moved.length === 0 && movedTop.length === 0) failures.push('no moved method or declaration found: a proof over nothing is not a proof');
  return { failures, moved, movedTop, linesBefore: lineCount(baseText), linesAfter: lineCount(headText),
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
    const key = r.section ?? '(above the first banner)';
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
    `sql-driver.ts ${v.linesBefore} -> ${v.linesAfter} lines; undoing the split ${v.failures.some((f) => f.startsWith('undoing')) ? 'does NOT' : 'does'} rebuild the base byte-for-byte`);
}

function gitShow(ref, path) {
  return execFileSync('git', ['show', `${ref}:${path}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** A file under `sql-driver.ts`'s directory by its relative path, or null when there is none. */
function readSibling(rel) {
  const p = join(SRC_DIR, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function generatedModulesOnDisk() {
  const out = new Map();
  for (const file of [LEAF_MODULE, HOSTS_MODULE, CLASS_HEAD_SECTION[1], ...Object.values(SECTION_MODULES)]) {
    if (!file) continue;
    const p = join(SRC_DIR, file);
    if (existsSync(p)) out.set(file, readFileSync(p, 'utf8'));
  }
  return out;
}

// ── Entry ────────────────────────────────────────────────────────────────────

const USAGE = [
  'usage: node scripts/codemod-split-sql-driver.mjs [--write]   plan (or apply) the split of an UNSPLIT sql-driver.ts',
  '       node scripts/codemod-split-sql-driver.mjs --verify --base REF   re-prove a split on disk against sql-driver.ts at REF',
  '       node scripts/codemod-split-sql-driver.mjs --self-test',
  '       node scripts/codemod-split-sql-driver.mjs --help',
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
      console.error('\n✗ codemod-split-sql-driver self-test: selfTest() returned without reaching its verdict,\n' +
        'so no success line was printed. Exiting 0 here would report a self-test that never\n' +
        'finished as a self-test that passed.');
      return 1;
    }
    return 0;
  }
  const tm = await loadTsMorph();
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
  'stay rules': 22,
  'facets, statics and docblocks': 18,
  'top-level moves': 11,
  'byte-identity proof': 10,
  'refusals': 6,
  'codemod-limit retirements (#30147)': 31,
});
const SELF_TEST_BATTERY_FLOOR = 6;

const FIXTURE_SECTIONS = Object.freeze({ 'Lifecycle': 'sql-driver-lifecycle.ts', 'Kept': null });
const FIXTURE_HEAD = Object.freeze(['Head', 'sql-driver-head.ts']);
const FIXTURE_NEEDLES = Object.freeze({ 'PINNED_TEXT': 'a fixture reader', 'needleInMethod(': 'a fixture reader' });
const FIXTURE_CLASS_NEEDLES = Object.freeze({ 'classReaderText(': 'a fixture reader that also reads the leaf' });
const FIXTURE_PINS = Object.freeze({ pinnedMethod: 'a fixture reader' });
const NO_RETIREMENT_TABLES = Object.freeze({ receiverFree: {}, returnTypes: {}, accessors: {}, fieldDefaults: {} });
const fixturePlan = (tm, text, head = null, tables = NO_RETIREMENT_TABLES) => plan(tm, text,
  { sections: FIXTURE_SECTIONS, head, pins: FIXTURE_PINS, needles: FIXTURE_NEEDLES, classNeedles: FIXTURE_CLASS_NEEDLES, ...tables });

function fixtureSource(extraMethods = '') {
  const pad = Array.from({ length: 12 }, (_, i) => `    const p${i} = ${i};`).join('\n');
  return `import type { Knex } from 'knex';
import { helperImported } from './other.js';
import { seamHelper } from './sql-driver-seam.js';

/** A value the leaf takes, read by a moved body. */
const LOCAL_VALUE = 1;
type LocalType = { n: number };
export interface ExportedShape { a: number }

// A reader takes this one out of the file by path.
const PINNED = 'PINNED_TEXT';
function dependsOnPinned(): string {
  return PINNED;
}
function namesClass(d: SqlDriver): SqlDriver {
  return d;
}
const VIA_SEAM = seamHelper();
export const DERIVED = LOCAL_VALUE + 1;
function classReaderText(n: number): number {
  return n;
}

export class SqlDriver {
  private count = 0;
  private knex: any = null;
  protected logger: { warn(m: string): void } = console;
  private readonly fn = (x: string): string => x;
  private static readonly SECRET = 1;
  private static bump = 0;

  protected headMethod(): number {
${pad}
    return this.count;
  }

  // ===================================
  // Lifecycle
  // ===================================

  /** A private docblock: it moves with the body. */
  private async movable(object: string, trx?: Knex.Transaction): Promise<string> {
${pad}
    const a = helperImported(object) as ExportedShape | string;
    this.logger.warn(String(a));
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
    return SqlDriver.SECRET;
  }

  protected bumpsStatic(): number {
${pad}
    SqlDriver.bump += 1;
    return SqlDriver.SECRET;
  }

  protected namesClassType(): SqlDriver | null {
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
    return n + SqlDriver.SECRET;
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
  // ===================================
  // Kept
  // ===================================

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
    moves('readsStatic', 'a private static it reads goes through SqlDriverStatics');
    stays('bumpsStatic', 'static-write');
    stays('namesClassType', 'static-route-conflict');
    check('a pinned method and a method carrying a needle stay (path-reader)',
      why('pinnedMethod').startsWith('path-reader') && why('carriesNeedle').startsWith('path-reader'),
      `${why('pinnedMethod')} | ${why('carriesNeedle')}`);
    check('a method in a section that maps to no module stays (section-kept)', why('keptSection').startsWith('section-kept'), why('keptSection'));
    stays('headMethod', 'no-section');
    const withHead = fixturePlan(tm, fixtureSource(), FIXTURE_HEAD);
    const headRecord = withHead.records.find((r) => r.name === 'headMethod');
    check('with a class-head section, a method above the first banner moves into its module',
      headRecord && headRecord.reasons.length === 0 && headRecord.module === 'sql-driver-head.ts', headRecord ? headRecord.reasons.join('; ') : '<absent>');
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
    check('a declaration using a sql-driver-* import stays (seam-import)', why('VIA_SEAM').startsWith('seam-import'), why('VIA_SEAM'));
    check('a declaration after the class is not in the region', !top('needleInMethod'));
    const out = generate(tm, input, planned);
    const leaf = out.modules.get(LEAF_MODULE) ?? '';
    check('the leaf header is line comments, never a docblock the bundled .d.ts would publish',
      leaf.includes(MARK) && !leaf.slice(0, leaf.indexOf('\n\n', leaf.indexOf(MARK))).includes('/*'));
    check('the leaf imports neither sql-driver.ts nor a sql-driver-* module', leaf.length > 0 && !/from '\.\/sql-driver[.-]/.test(leaf), leaf.slice(0, 200));
    check('sql-driver.ts re-exports the exported movers by name, the interface as a type',
      /export \{ DERIVED, type ExportedShape \} from '\.\/sql-driver-top-level\.js';/.test(out.host));
    check('lever (a): the staying function a moved body reads is exported for its module, and the module imports it',
      /export \{ dependsOnPinned \};/.test(out.host) &&
      /import \{ SqlDriverStatics as SqlDriver, dependsOnPinned \} from '\.\/sql-driver\.js';/.test(out.modules.get('sql-driver-lifecycle.ts') ?? ''));
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
    const mod = out.modules.get('sql-driver-lifecycle.ts');
    const edited = new Map([...out.modules, ['sql-driver-lifecycle.ts', mod.replace('const p3 = 3;', 'const p3 = 4;')]]);
    check('one edited character in a moved body fails', verify(tm, input, out.host, edited).failures.length > 0);
    check('an edited stub signature fails',
      verify(tm, input, out.host.replace('trx?: Knex.Transaction): Promise<string>', 'trx?: Knex.Transaction): Promise<String>'), out.modules).failures.length > 0);
    check('an extra top-level statement in a module fails',
      verify(tm, input, out.host, new Map([...out.modules, ['sql-driver-lifecycle.ts', `${mod}\nexport const extra = 1;\n`]])).failures.length > 0);
    check('a proof over no moved method fails', verify(tm, input, input, new Map()).failures.length > 0);
    const leaf = out.modules.get(LEAF_MODULE);
    const leafWith = (text) => new Map([...out.modules, [LEAF_MODULE, text]]);
    check('one edited character in a moved declaration fails',
      verify(tm, input, out.host, leafWith(leaf.replace('const LOCAL_VALUE = 1;', 'const LOCAL_VALUE = 2;'))).failures.length > 0);
    check('an edited comment above a moved declaration fails',
      verify(tm, input, out.host, leafWith(leaf.replace('/** A value the leaf takes', '/** A value the leaf holds'))).failures.length > 0);
    check('a leaf that imports sql-driver.ts back fails',
      verify(tm, input, out.host, leafWith(leaf.replace('\nconst LOCAL_VALUE', "\nimport { SqlDriver } from './sql-driver.js';\nconst LOCAL_VALUE"))).failures.length > 0);
    const swapped = leaf.replace('type LocalType = { n: number };\nexport interface ExportedShape { a: number }',
      'export interface ExportedShape { a: number }\ntype LocalType = { n: number };');
    check('two moved declarations out of base order fail', swapped !== leaf && verify(tm, input, out.host, leafWith(swapped)).failures.length > 0);
  }

  open('facets, statics and docblocks');
  {
    const input = fixtureSource();
    const out = generate(tm, input, fixturePlan(tm, input));
    const mod = out.modules.get('sql-driver-lifecycle.ts') ?? '';
    check('the bodies move into one stateless facet class of static methods', /\nexport class LifecycleFacet \{\n/.test(mod) &&
      /\n  static async movable\(this: Pick<LifecycleHost, /.test(mod) && !/\n  (private|constructor)/.test(mod));
    check('a routed module imports SqlDriverStatics AS SqlDriver and names the class type by its alias',
      /import \{ SqlDriverStatics as SqlDriver, dependsOnPinned \} from '\.\/sql-driver\.js';/.test(mod) &&
      /import type \{ SqlDriver as SqlDriverClass \} from '\.\/sql-driver\.js';/.test(mod) && /count: SqlDriverClass\['count'\];/.test(mod));
    check('a private docblock moves with its body; the class keeps none for it',
      mod.includes('  /** A private docblock: it moves with the body. */\n  static async movable(') && !out.host.includes('A private docblock'));
    check('a protected docblock stays on the facade; the facet member carries the placeholder',
      out.host.includes('  /** A protected docblock: it stays on the facade. */\n  protected other(') &&
      mod.includes(`  ${placeholderDoc('other')}\n  static other(`));
    check('sql-driver.ts declares the forwarder type and object for exactly the routed statics, and the static block fills them',
      /export interface SqlDriverStaticsHost \{\n  readonly SECRET: \(typeof SqlDriver\)\['SECRET'\];\n\}/.test(out.host) &&
      out.host.includes(`      SECRET: { get: () => SqlDriver.SECRET },\n    });\n  }\n\n  // ${MARK} Installs`) && !out.host.includes('bump:'));
    check('a written field gets a host setter that assigns it on the driver',
      out.host.includes('      get count() { return driver.count; },\n      set count(v) { driver.count = v; },'));
    check('a generic method calls its body instantiated with its own type parameters',
      out.host.includes('return (LifecycleFacet.generic<T>).call(lifecycleHost.of(this), x);') && mod.includes('  static generic<T extends string>(this: Pick<LifecycleHost, '));
    const hostsMod = out.modules.get(HOSTS_MODULE) ?? '';
    check('every stub hands its body the one host of its facet, never a literal built per call',
      !out.host.includes('const host') && !out.host.includes('ThisParameterType') &&
      (out.host.match(/\.call\(lifecycleHost\.of\(this\)/g) ?? []).length >= 3 &&
      out.host.includes("import { lifecycleHost } from './sql-driver-facet-hosts.js';"));
    check('the host module keeps one FacetHost per facet and imports types only',
      hostsMod.includes("export const lifecycleHost = new FacetHost<LifecycleHost>('LifecycleFacet');") &&
      !/^import (?!type )/m.test(hostsMod) && hostsMod.includes("import type { LifecycleHost } from './sql-driver-lifecycle.js';"));
    check('the builder factory goes into the host as a bound reference, never a forwarding closure',
      out.host.includes('      get getBuilder() { return driver.getBuilder.bind(driver); },') && !out.host.includes('getBuilder: (...a)'));
    check('a method goes into the host as a closure called on the driver at call time',
      /\n      [a-z]\w*: \(\.\.\.a\) => driver\.[a-z]\w*\(\.\.\.a\),\n/.test(out.host), out.host.slice(out.host.indexOf('Installs')));
    check('a stub handing another facet\'s host fails', verify(tm, input,
      out.host.replace('.call(lifecycleHost.of(this), x)', '.call(otherHost.of(this), x)'), out.modules).failures.length > 0);
    check('an edited host module fails', verify(tm, input, out.host,
      new Map([...out.modules, [HOSTS_MODULE, hostsMod.replace('this.hosts.set(driver, host);', '')]])).failures.length > 0);
    check('a written field\'s setter left out of the host fails', verify(tm, input,
      out.host.replace('      set count(v) { driver.count = v; },\n', ''), out.modules).failures.length > 0);
    check('a static method keeps its static stub and calls its facet body directly',
      out.host.includes('  static staticHelper(n: number): number {\n    // [#29520 codemod] The body moved to `sql-driver-lifecycle.ts`.\n    return LifecycleFacet.staticHelper(n);\n  }'));
    const withMod = (text) => new Map([...out.modules, ['sql-driver-lifecycle.ts', text]]);
    check('an edited moved docblock fails', verify(tm, input, out.host,
      withMod(mod.replace('it moves with the body', 'it moved with the body'))).failures.length > 0);
    check('an edited placeholder fails', verify(tm, input, out.host,
      withMod(mod.replace(placeholderDoc('other'), placeholderDoc('other').replace('contract', 'promise')))).failures.length > 0);
    check('a static forwarded as the wrong kind fails', verify(tm, input,
      out.host.replace('SECRET: { get: () => SqlDriver.SECRET },', 'SECRET: { value: SqlDriver.SECRET },'), out.modules).failures.length > 0);
  }

  open('codemod-limit retirements (#30147)');
  {
    const pad = Array.from({ length: 12 }, (_, i) => `    const p${i} = ${i};`).join('\n');
    const extra = `
  protected knexCall(object: string): string {
${pad}
    return this.knex(object);
  }

  public spelled(object: string) {
${pad}
    return this.other(object);
  }

  protected commented(object: string /* the table */, n: number): string {
${pad}
    return object + n;
  }

  public get movedGetter(): string {
${pad}
    return this.count > 0 ? 'a' : 'b';
  }

  protected computedDefault(name: string, nowMs: number = Date.now()): number {
${pad}
    return nowMs + name.length;
  }

  protected seamed(name: string, nowMs: number = Date.now()): number {
    return seamed(name, nowMs);
  }
`;
    const input = fixtureSource(extra).replace("import { seamHelper } from './sql-driver-seam.js';",
      "import { seamHelper, seamed } from './sql-driver-seam.js';");
    const SEAM = 'export function seamed(name: string, nowMs: number = Date.now()): number {\n  return nowMs + name.length;\n}\n';
    const sibling = (text) => (rel) => (rel === 'sql-driver-seam.ts' ? text : null);
    const TABLES = { receiverFree: { knex: 'a fixture closure' }, returnTypes: { spelled: 'string' },
      accessors: { movedGetter: 'a fixture branch' }, fieldDefaults: { logger: 'a fixture sink' } };
    const without = fixturePlan(tm, input, FIXTURE_HEAD);
    const planned = fixturePlan(tm, input, FIXTURE_HEAD, TABLES);
    const rec = (p, name) => p.records.find((r) => r.name === name);
    const why = (p, name) => (rec(p, name)?.reasons ?? ['<absent>']).join('; ');
    check('with no table, the knex call and the inferred return type stay (field-call, inferred-return-type)',
      why(without, 'knexCall').startsWith('field-call') && why(without, 'spelled').startsWith('inferred-return-type') && !rec(without, 'movedGetter'),
      `${why(without, 'knexCall')} | ${why(without, 'spelled')}`);
    check('a call of a receiver-free field moves', why(planned, 'knexCall') === '', why(planned, 'knexCall'));
    check('a method EXPLICIT_RETURN_TYPES names moves', why(planned, 'spelled') === '', why(planned, 'spelled'));
    check('a comment between the parentheses no longer keeps a method on the class', why(planned, 'commented') === '' && why(without, 'commented') === '', why(planned, 'commented'));
    check('a named get accessor moves as an accessor', why(planned, 'movedGetter') === '' && rec(planned, 'movedGetter').kind === 'accessor', why(planned, 'movedGetter'));
    check('a named field default moves into the class-head module', why(planned, 'logger') === '' && rec(planned, 'logger').kind === 'field-default'
      && rec(planned, 'logger').module === 'sql-driver-head.ts', why(planned, 'logger'));
    check('a computed default is written optional on the stub, a data default is not',
      rec(planned, 'computedDefault').optionalized.map((o) => o.text).join() === 'nowMs?: number' && rec(planned, 'defaulted').optionalized.length === 0);
    check('a hand-series stub stays (already-moved) and takes the optional spelling too',
      why(planned, 'seamed').startsWith('already-moved') && rec(planned, 'seamed').optionalized.map((o) => o.text).join() === 'nowMs?: number', why(planned, 'seamed'));

    const out = generate(tm, input, planned);
    const mod = out.modules.get('sql-driver-lifecycle.ts') ?? '';
    const head = out.modules.get('sql-driver-head.ts') ?? '';
    check('the stub writes the named return type; the facet member keeps the base text',
      /\n  public spelled\(object: string\): string \{\n/.test(out.host) && /\n  static spelled\(this: Pick<LifecycleHost, [^>]*>, object: string\) \{\n/.test(mod));
    check('the facet member carries the base parameter list verbatim, comment and all',
      /\n  static commented\(this: Pick<LifecycleHost, [^)]*\), object: string \/\* the table \*\/, n: number\): string \{\n/.test(mod) || /\n  static commented\(object: string \/\* the table \*\/, n: number\): string \{\n/.test(mod),
      (mod.match(/\n  static commented\([^\n]*/) ?? ['<absent>'])[0]);
    check('the getter keeps its signature and its body becomes the one-call stub',
      /\n  public get movedGetter\(\): string \{\n    \/\/ \[#29520 codemod\] The body moved to `sql-driver-lifecycle\.ts`[^\n]*\n    return LifecycleFacet\.movedGetter\.call\(lifecycleHost\.of\(this\)\);\n  \}\n/.test(out.host),
      (out.host.match(/get movedGetter[\s\S]{0,200}/) ?? ['<absent>'])[0]);
    check('the stub writes the computed default optional and the facet member keeps the default',
      /\n  protected computedDefault\(name: string, nowMs\?: number\): number \{\n/.test(out.host) && /\n  static computedDefault\(name: string, nowMs: number = Date\.now\(\)\): number \{\n/.test(mod));
    check('the hand-series stub writes the parameter optional and keeps its seam call',
      out.host.includes('  protected seamed(name: string, nowMs?: number): number {\n    return seamed(name, nowMs);\n  }'));
    check('the field keeps its type and calls the facet member; the member returns the initializer typed as the field',
      out.host.includes("  protected logger: { warn(m: string): void } = HeadFacet.logger();") &&
      head.includes(`  ${fieldDefaultDoc('logger')}\n  static logger(): SqlDriver['logger'] {\n    return console;\n  }`), head.slice(0, 600));
    check('the knex call moves as written, through the host', mod.includes('    return this.knex(object);'));

    const again = generate(tm, input, fixturePlan(tm, input, FIXTURE_HEAD, TABLES));
    check('two runs on one input write byte-identical trees',
      treeHash(new Map([['h', out.host], ...out.modules])) === treeHash(new Map([['h', again.host], ...again.modules])));
    const opts = { readSibling: sibling(SEAM), returnTypes: TABLES.returnTypes };
    const v = verify(tm, input, out.host, out.modules, opts);
    const names = v.moved.map((m) => m.name);
    check('the generated split proves against its base, each retired mechanism among the moved',
      v.failures.length === 0 && ['knexCall', 'spelled', 'commented', 'movedGetter', 'computedDefault', 'logger'].every((n) => names.includes(n)),
      [...v.failures, `moved: ${names.join()}`].join(' | '));
    const failsWith = (host, modules = out.modules, o = opts) => verify(tm, input, host, modules, o).failures.length > 0;
    const withMod = (file, text) => new Map([...out.modules, [file, text]]);
    check('a return type EXPLICIT_RETURN_TYPES does not name fails', failsWith(out.host, out.modules, { ...opts, returnTypes: {} }));
    check('an edited written return type fails', failsWith(out.host.replace('public spelled(object: string): string {', 'public spelled(object: string): String {')));
    check('an edited comment in the moved parameter list fails',
      failsWith(out.host, withMod('sql-driver-lifecycle.ts', mod.replace('/* the table */', '/* a table */'))));
    check('an edited getter body fails', failsWith(out.host, withMod('sql-driver-lifecycle.ts', mod.replace("this.count > 0 ? 'a' : 'b'", "this.count > 1 ? 'a' : 'b'"))));
    check('an optional parameter spelled with another type fails', failsWith(out.host.replace('nowMs?: number): number {\n    // [#29520', 'nowMs?: any): number {\n    // [#29520')));
    check('a facet member that drops the computed default fails',
      failsWith(out.host, withMod('sql-driver-lifecycle.ts', mod.replace('static computedDefault(name: string, nowMs: number = Date.now()): number {', 'static computedDefault(name: string, nowMs: number = 0): number {'))));
    check('a hand-series stub whose seam drops the default fails', failsWith(out.host, out.modules, { ...opts, readSibling: sibling(SEAM.replace(' = Date.now()', '?')) }));
    check('a hand-series optional parameter with no seam to read fails', failsWith(out.host, out.modules, { ...opts, readSibling: null }));
    check('an edited moved initializer fails', failsWith(out.host, withMod('sql-driver-head.ts', head.replace('    return console;', '    return globalThis.console;'))));
    check('a field calling a member of another name fails', failsWith(out.host.replace('= HeadFacet.logger();', '= HeadFacet.other();')));

    const refusedWith = (tables) => refused(() => fixturePlan(tm, input, FIXTURE_HEAD, { ...TABLES, ...tables }));
    check('RECEIVER_FREE_FIELDS naming a method or no member refuses',
      refusedWith({ receiverFree: { other: 'x' } }) && refusedWith({ receiverFree: { gone: 'x' } }));
    check('EXPLICIT_RETURN_TYPES naming an annotated or absent method refuses',
      refusedWith({ returnTypes: { other: 'string' } }) && refusedWith({ returnTypes: { gone: 'string' } }));
    check('MOVED_ACCESSORS naming no get accessor refuses', refusedWith({ accessors: { other: 'x' } }) && refusedWith({ accessors: { gone: 'x' } }));
    check('MOVED_FIELD_DEFAULTS naming an untyped field, an initializer reading `this` or a name of the file refuses',
      refusedWith({ fieldDefaults: { fn: 'x' } }) && refusedWith({ fieldDefaults: { gone: 'x' } }) &&
      refused(() => fixturePlan(tm, input.replace('  private count = 0;', '  private count = 0;\n  private self: number = this.count;'), FIXTURE_HEAD, { ...TABLES, fieldDefaults: { self: 'x' } })) &&
      refused(() => fixturePlan(tm, input.replace('  private count = 0;', '  private count = 0;\n  private local: number = LOCAL_VALUE;'), FIXTURE_HEAD, { ...TABLES, fieldDefaults: { local: 'x' } })));
  }

  open('refusals');
  {
    const unknownBanner = fixtureSource('\n  // ── Unnamed section ──────────\n\n  protected z(): number {\n    return 1;\n  }\n');
    check('a banner the section table does not name refuses', refused(() => fixturePlan(tm, unknownBanner)));
    const named = fixtureSource('\n  // ── Lifecycle ──────────\n\n  protected z(): number {\n    return 1;\n  }\n');
    check('a banner in the dash spelling the table names is read, not refused', !refused(() => fixturePlan(tm, named)));
    check('a pin naming what the file lacks refuses', refused(() => plan(tm, fixtureSource(), { ...NO_RETIREMENT_TABLES, sections: FIXTURE_SECTIONS, head: null, pins: { gone: 'x' }, needles: {}, classNeedles: {} })));
    check('a class-scoped needle the file no longer carries refuses',
      refused(() => plan(tm, fixtureSource(), { ...NO_RETIREMENT_TABLES, sections: FIXTURE_SECTIONS, head: null, pins: {}, needles: {}, classNeedles: { 'gone text': 'x' } })));
    check('a needle the file no longer carries refuses', refused(() => plan(tm, fixtureSource(), { ...NO_RETIREMENT_TABLES, sections: FIXTURE_SECTIONS, head: null, pins: {}, needles: { 'gone text': 'x' }, classNeedles: {} })));
    // `--help` reads no tree: it answers before the "already split" guard, so
    // it exits 0 whether sql-driver.ts on disk is split (as on a branch) or not.
    check('--help is answered, never refused, whatever sql-driver.ts holds', (await main(['--help']).catch(() => 2)) === 0);
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
