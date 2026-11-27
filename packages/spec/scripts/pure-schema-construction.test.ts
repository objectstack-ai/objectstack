// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — spawns the real producer once per single-cause fixture: each build case runs the real tsup build (in-process, with the package's own main options and its esbuild plugin) once over the entry or fixture it pins, and the ./shared case bundles two consumers of that output; slowest CI reading 11.86 s (run 40214410982, refresh PR #25960's window (hourly runs 40200279306 to 40272142430)) x 1.25, rounded up
//
// The `pure-schema-construction` build plugin (`tsup.config.ts`) marks real
// calls only (#20686). Its earlier line-prefix rule also rewrote a marked name
// inside a STRING on a code line, so the published `./migrations` bundle
// carried a PURE marker inside a D3 migration `reason` that its source does not
// — text `os migrate meta` prints to an author.
//
// Both halves run the plugin through a real tsup build, not a copy of it: the
// `./migrations` entry built with the package's own main options, and a fixture
// that quotes every marked name in every place that is not a call.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'tsup';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

import { annotatePureCalls, mainConfig, markPureConstruction, pureSchemaConstruction, wrapModuleScopeInitializers } from '../tsup.config';
import { ALL_CONVERSIONS } from '../src/conversions/registry';
import * as sourceMigrations from '../src/migrations/index';

/** This package's root — every read and write below stays inside it. */
const PKG_DIR = path.resolve(__dirname, '..');
const PURE = '/* @__PURE__ */ ';

// The bundles import `zod` like the published ones do, so they are written
// where this package's own `node_modules` resolves it.
const CACHE_DIR = path.join(PKG_DIR, 'node_modules', '.cache');
mkdirSync(CACHE_DIR, { recursive: true });
const WORK_DIR = mkdtempSync(path.join(CACHE_DIR, 'pure-schema-construction-'));
afterAll(() => rmSync(WORK_DIR, { recursive: true, force: true }));

const DEPENDENCIES = Object.keys(
  (JSON.parse(readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> })
    .dependencies ?? {},
);

/** Build one entry through tsup with the main pass's options; returns the ESM bundle's path and text. */
async function buildEntry(entry: string, outName: string): Promise<{ file: string; text: string }> {
  const outDir = path.join(WORK_DIR, outName);
  await build({
    ...mainConfig,
    config: false,
    entry: { index: entry },
    outDir,
    format: ['esm'],
    clean: false,
    dts: false,
    sourcemap: false,
    silent: true,
    external: DEPENDENCIES,
  });
  const file = path.join(outDir, 'index.mjs');
  return { file, text: readFileSync(file, 'utf8') };
}

describe('the built ./migrations entry equals its source', () => {
  it('MIGRATIONS_BY_MAJOR and the registry tables beside it survive the build unchanged', async () => {
    const { file, text } = await buildEntry(path.join(PKG_DIR, 'src', 'migrations', 'index.ts'), 'migrations');

    // The control: the plugin really ran in this build — otherwise the equality
    // below would hold for a build that marks nothing at all.
    expect(text.split(PURE).length - 1, 'no PURE annotation in the bundle: the plugin did not run').toBeGreaterThan(0);

    const built = (await import(pathToFileURL(file).href)) as typeof sourceMigrations;
    expect(built.MIGRATIONS_BY_MAJOR).toEqual(sourceMigrations.MIGRATIONS_BY_MAJOR);
    expect(built.MIGRATION_MAJORS).toEqual(sourceMigrations.MIGRATION_MAJORS);
    expect(built.MIGRATION_SUPPORT_FLOOR).toBe(sourceMigrations.MIGRATION_SUPPORT_FLOOR);
    expect(built.RETIRED_KEYS_BY_MAJOR).toEqual(sourceMigrations.RETIRED_KEYS_BY_MAJOR);
    expect(built.RETIRED_DEFS_BY_MAJOR).toEqual(sourceMigrations.RETIRED_DEFS_BY_MAJOR);
  });
});

// Every marked name, quoted everywhere a call is NOT: string, template text,
// regex, JSDoc, trailing block and line comments, a declaration. Plus the three
// real call shapes, one of them inside a template substitution.
const FIXTURE = [
  'const lazySchema = <T>(fn: () => T): T => fn();',
  'const strictObject = (shape: object): object => ({ ...shape });',
  'const z = { strictObject };',
  "export const single = 'measured: `z.strictObject(DashboardWidgetSchema.shape)` accepts it';",
  'export const double = "lazySchema(fn) and defineForm(cfg)";',
  'export const template = `a strictObject({}) mention in template text`;',
  'export const substituted = `${lazySchema(() => \'x\')} then lazySchema( in text`;',
  'export const regex = /strictObject(\\w+)/.source;',
  '/** JSDoc naming strictObject(shape) and lazySchema(fn) */',
  'export const trailing = 1; /* strictObject(x) */ // lazySchema(y)',
  'export function defineForm(cfg: object): object { return cfg; }',
  'export const called = strictObject({ a: 1 });',
  'export const member = z.strictObject({ b: 1 });',
  '',
].join('\n');

describe('a fixture quoting every marked name survives the build byte-identical', () => {
  it('keeps strings, template text and regex source as written, and marks the real calls', async () => {
    // `src/` in the path: the plugin's onLoad filter is the build's own.
    const fixture = path.join(WORK_DIR, 'fixture', 'src', 'quoted.ts');
    mkdirSync(path.dirname(fixture), { recursive: true });
    writeFileSync(fixture, FIXTURE);
    const { file, text } = await buildEntry(fixture, 'fixture-out');

    const built = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    expect(built.single).toBe('measured: `z.strictObject(DashboardWidgetSchema.shape)` accepts it');
    expect(built.double).toBe('lazySchema(fn) and defineForm(cfg)');
    expect(built.template).toBe('a strictObject({}) mention in template text');
    expect(built.substituted).toBe('x then lazySchema( in text');
    expect(built.regex).toBe('strictObject(\\w+)');

    // The real calls carry the annotation where esbuild honours it — at the
    // start of the call expression, member calls included.
    expect(text).toContain(`${PURE}strictObject({ a: 1 })`);
    expect(text).toContain(`${PURE}z.strictObject({ b: 1 })`);
    expect(text).toContain(`\${${PURE}lazySchema(`);
  });
});

// `./shared` reaches the conversion table only through `normalizeStackInput`,
// and its two load-time calls are marked pure in the source
// (`src/conversions/registry.ts`, the `CONVERSIONS_BY_MAJOR` docblock), so a
// consumer that keeps no reader of the table keeps no conversion (#22044).
// The consumer below imports what objectui's console imports from `./shared`;
// the second one imports the reader, and is the control that the instrument
// sees the table whenever a bundle keeps it.
describe('a consumer of the built ./shared entry keeps the conversion table only when it reads it', () => {
  it('drops every conversion for the console names, keeps them all for normalizeStackInput', async () => {
    const { file } = await buildEntry(path.join(PKG_DIR, 'src', 'shared', 'index.ts'), 'shared');
    const ids = ALL_CONVERSIONS.map((c) => c.id);
    const kept = async (names: string, outName: string): Promise<string[]> => {
      const consumer = path.join(WORK_DIR, `${outName}.ts`);
      writeFileSync(consumer, `export { ${names} } from ${JSON.stringify(file)};\n`);
      const { text } = await buildEntry(consumer, outName);
      return ids.filter((id) => text.includes(`'${id}'`) || text.includes(`"${id}"`));
    };

    // Anti-vacuity floor, not a count: 100 measured after #25767 retired the
    // ≤16.x kits (the table shrinks by one major's worth each protocol major).
    expect(ids.length).toBeGreaterThan(50);
    expect(await kept('normalizeStackInput', 'shared-reader')).toEqual(ids);
    expect(
      await kept(
        'EVALUATED_EXPRESSION_SOURCE_REQUIRED, EvaluatedExpressionInputSchema, EvaluatedExpressionSchema, ValueDomainSchema, canonicalMetaUrlType',
        'shared-console',
      ),
    ).toEqual([]);
  });
});

describe('annotatePureCalls — where the annotation goes', () => {
  it('hands back a file that names no marked constructor untouched, unparsed', () => {
    expect(annotatePureCalls('export const a = z.object({});\n', 'a.ts')).toBeUndefined();
  });

  it('touches nothing that is not a call', () => {
    const text = [
      "const a = 'strictObject(';",
      'const b = `lazySchema(${x}) defineForm(`;',
      '/** @example lazySchema(() => z.object({})) */',
      '// strictObject(shape)',
      'const c = 1; /* defineForm(cfg) */',
      'const d = /lazySchema(x)/;',
      'export function defineForm(cfg: object) { return cfg; }',
      '',
    ].join('\n');
    expect(annotatePureCalls(text, 'a.ts')).toBe(text);
  });

  it('marks every call at the start of its call expression', () => {
    const text = [
      'const A = lazySchema(() => z.object({}));',
      'const B = strictObject({ a: z.string() });',
      'const C = defineForm({ schemaId: "x" });',
      'const D = z.strictObject({});',
      'const E = `${lazySchema(() => 1)} lazySchema(`;',
      'const F = lazySchema<Shape>(() => shape);',
      '',
    ].join('\n');
    const out = annotatePureCalls(text, 'a.ts');
    expect(out).toBe(
      [
        `const A = ${PURE}lazySchema(() => z.object({}));`,
        `const B = ${PURE}strictObject({ a: z.string() });`,
        `const C = ${PURE}defineForm({ schemaId: "x" });`,
        `const D = ${PURE}z.strictObject({});`,
        `const E = \`\${${PURE}lazySchema(() => 1)} lazySchema(\`;`,
        `const F = ${PURE}lazySchema<Shape>(() => shape);`,
        '',
      ].join('\n'),
    );
    // Insertions only: removing them gives the source back byte-identical.
    expect(out!.split(PURE).join('')).toBe(text);
  });

  it('is the transform the plugin applies', () => {
    expect(pureSchemaConstruction.name).toBe('pure-schema-construction');
    expect(mainConfig.esbuildPlugins).toContain(pureSchemaConstruction);
  });
});

describe('wrapModuleScopeInitializers — which initializers are wrapped', () => {
  const OPEN = `${PURE}(() => (`;
  const CLOSE = '))()';

  it('wraps a derived constant whole, and leaves literals, names and functions alone', () => {
    const text = [
      "const A = 'text';",
      'const B = 42;',
      'const C = OtherSchema;',
      'const D = (x: number) => x + 1;',
      "const E = { kind: 'k', list: ['a', 'b'], nested: { flag: true } } as const;",
      'const F = new Set([...Kind.options, ...Object.keys(PropsMap)]);',
      'export const G = z.string().min(1).describe(`d`);',
      'let H: string[] | undefined;',
      '',
    ].join('\n');
    expect(wrapModuleScopeInitializers(text, 'a.ts')).toBe(
      [
        "const A = 'text';",
        'const B = 42;',
        'const C = OtherSchema;',
        'const D = (x: number) => x + 1;',
        "const E = { kind: 'k', list: ['a', 'b'], nested: { flag: true } } as const;",
        `const F = ${OPEN}new Set([...Kind.options, ...Object.keys(PropsMap)])${CLOSE};`,
        `export const G = ${OPEN}z.string().min(1).describe(\`d\`)${CLOSE};`,
        'let H: string[] | undefined;',
        '',
      ].join('\n'),
    );
  });

  it('does not wrap an initializer that writes to an object it did not create', () => {
    // `Object.assign(TaskSchema, …)` adds `create` to `TaskSchema` itself, which
    // stays reachable by its own name: dropping `Task` would drop the write.
    const text = [
      'export const Task = Object.assign(TaskSchema, { create: (t: unknown) => t });',
      'export const Frozen = Object.freeze(Object.keys(Shape));',
      'export const Merged = Object.assign({}, Defaults, { extra: 1 });',
      "export const Defined = Object.defineProperty(Target, 'x', { value: 1 });",
      '',
    ].join('\n');
    expect(wrapModuleScopeInitializers(text, 'a.ts')).toBe(
      [
        'export const Task = Object.assign(TaskSchema, { create: (t: unknown) => t });',
        `export const Frozen = ${OPEN}Object.freeze(Object.keys(Shape))${CLOSE};`,
        `export const Merged = ${OPEN}Object.assign({}, Defaults, { extra: 1 })${CLOSE};`,
        "export const Defined = Object.defineProperty(Target, 'x', { value: 1 });",
        '',
      ].join('\n'),
    );
  });

  it('touches nothing inside a function body, and hands back a file with nothing to wrap', () => {
    const text = ['export function f() {', '  const local = new Set(Object.keys(Shape));', '  return local;', '}', ''].join('\n');
    expect(wrapModuleScopeInitializers(text, 'a.ts')).toBeUndefined();
  });

  it('leaves a marked constructor of pure arguments to its own mark, and marks calls inside a wrapper', () => {
    const out = markPureConstruction(
      'export const S = lazySchema(() => z.object({}));\nexport const K = Object.keys(S);\nexport const T = strictObject({ a: z.string() });\n',
      'a.ts',
    );
    expect(out).toBe(
      `export const S = ${PURE}lazySchema(() => z.object({}));\n` +
        `export const K = ${OPEN}Object.keys(S)${CLOSE};\n` +
        `export const T = ${OPEN}${PURE}strictObject({ a: z.string() })${CLOSE};\n`,
    );
  });
});

describe('a consumer keeps a module-scope constant only when it reads it', () => {
  it('drops a derived Set and the schemas it names for a consumer of a sibling helper', async () => {
    const fixtureDir = path.join(WORK_DIR, 'derived', 'src');
    mkdirSync(fixtureDir, { recursive: true });
    const fixture = path.join(fixtureDir, 'derived.ts');
    writeFileSync(
      fixture,
      [
        "import { z } from 'zod';",
        "export const WidgetPropsMap = { chart: z.object({ marker_chart_schema: z.string() }), table: z.object({ marker_table_schema: z.number() }) };",
        'export const KNOWN_WIDGET_TYPES = new Set([...Object.keys(WidgetPropsMap)]);',
        "export function helper(label: string): string { return label.trim(); }",
        '',
      ].join('\n'),
    );
    const { file } = await buildEntry(fixture, 'derived-out');
    const consume = async (names: string, outName: string): Promise<string> => {
      const consumer = path.join(WORK_DIR, `${outName}.ts`);
      writeFileSync(consumer, `export { ${names} } from ${JSON.stringify(file)};\n`);
      return (await buildEntry(consumer, outName)).text;
    };
    // The control: the instrument sees the schemas when the consumer reads them.
    expect(await consume('KNOWN_WIDGET_TYPES', 'derived-reader')).toContain('marker_chart_schema');
    const helperOnly = await consume('helper', 'derived-helper');
    expect(helperOnly).toContain('trim()');
    expect(helperOnly).not.toContain('marker_chart_schema');
    expect(helperOnly).not.toContain('marker_table_schema');
  });
});

/**
 * Every module-level binding a source of this package writes from inside a
 * function, with the reason that write cannot be lost when a bundler drops an
 * unused module-scope declaration (`wrapModuleScopeInitializers`). A write that
 * a module-scope initializer performs and some other code later reads — a
 * registration — would be lost; none of these is one. A new entry fails this
 * test until it is read and added here with its reason.
 */
const MODULE_STATE_WRITTEN_IN_FUNCTIONS: Record<string, string> = {
  'ai/dataset-tools.zod.ts cachedDatasetToolJsonSchemas': 'lazy cache, filled on first call',
  'ai/record-context-tools.zod.ts cachedRecordContextToolJsonSchemas': 'lazy cache, filled on first call',
  'automation/approval.zod.ts cachedApprovalNodeConfigJsonSchema': 'lazy cache, filled on first call',
  'automation/flow-bound-variable-name.ts RULE_BY_KEY': 'memo of built rules, read-through',
  'automation/flow-node-config-refusals.ts cachedBuiltinNodeConfigContracts': 'lazy cache, filled on first call',
  'automation/flow-node-config-refusals.ts cachedDeclaredPluginNodeConfigContracts': 'lazy cache, filled on first call',
  'automation/flow.zod.ts cachedFlowNodeSiblingBlockJsonSchemas': 'lazy cache, filled on first call',
  'automation/schemaless-node-config.zod.ts cachedSchemalessNodeConfigJsonSchemas': 'lazy cache, filled on first call',
  'data/datasource.zod.ts parsedEmptyExternal': 'lazy cache, filled on first call',
  'data/field.zod.ts multiDeclarableRemedyTypes': 'lazy cache, filled on first call',
  'data/field.zod.ts multiDeclarableTypes': 'lazy cache, filled on first call',
  'data/object.zod.ts warnedLegacyApiMethods': 'log-once set, written while parsing',
  'data/object.zod.ts warnedPasswordObjects': 'log-once set, written while parsing',
  'integration/connector-credential-redaction.ts declaredAuthKinds': 'lazy cache, filled on first call',
  'integration/connector-credential-redaction.ts declaredEntryKeys': 'lazy cache, filled on first call',
  'integration/connector-credential-redaction.ts declaredNestedKeys': 'lazy cache, filled on first call',
  'kernel/metadata-credential-fields.ts DERIVED': 'WeakMap memo keyed by the schema it derives from',
  'kernel/metadata-type-redaction.ts EXTRA_METADATA_TYPE_REDACTORS': 'runtime registration API, called from a plugin init, never at module scope',
  'kernel/metadata-type-schemas.ts EXTRA_METADATA_TYPE_ACTIONS': 'runtime registration API, called from a plugin init, never at module scope',
  'kernel/metadata-type-schemas.ts EXTRA_METADATA_TYPE_SCHEMAS': 'runtime registration API, called from a plugin init, never at module scope',
  'shared/refinement-projection.ts DECLARED': 'WeakMap keyed by a rule the module-scope caller just built (`declare`): no other code holds the key',
  'stack.zod.ts cachedPackageOwnedKeys': 'lazy cache, filled on first call',
  'stack.zod.ts objectUnmergeableKeysCache': 'lazy cache, filled on first call',
  'stack.zod.ts warnedAddressLiteralNamespaces': 'log-once set, written while composing',
  'stack.zod.ts warnedConversionNotices': 'log-once set, written while composing',
  'stack.zod.ts warnedEmailTemplateFloors': 'log-once set, written while composing',
  'stack.zod.ts warnedMalformedCollectionEntries': 'log-once set, written while composing',
  'stack.zod.ts warnedUncomposedStackKeys': 'log-once set, written while composing',
  'stack.zod.ts warnedUnknownAuthoringKeys': 'log-once set, written while composing',
  'ui/component.zod.ts COMPONENT_SLOT_DECLARATIONS': 'WeakMap keyed by a schema the module-scope caller just built (`componentSlot`): no other code holds the key',
  'ui/component.zod.ts actionGroupMemberOnce': 'lazy cache, filled on first call',
  'ui/component.zod.ts actionMenuMemberOnce': 'lazy cache, filled on first call',
  'ui/component.zod.ts objectFormRuntimeFieldOnce': 'lazy cache, filled on first call',
  'ui/component.zod.ts objectFormSectionFieldEntryOnce': 'lazy cache, filled on first call',
  'ui/component.zod.ts objectFormSectionOnce': 'lazy cache, filled on first call',
  'ui/component.zod.ts objectTimelineItemOnce': 'lazy cache, filled on first call',
  'ui/view.zod.ts viewVocabularyCache': 'lazy cache, filled on first call',
};

/** Array and collection methods that write to their receiver. */
const WRITING_METHODS = new Set(['set', 'add', 'push', 'delete', 'clear', 'splice', 'unshift', 'pop', 'shift', 'sort', 'reverse', 'fill', 'copyWithin']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') out.push(...sourceFiles(full));
    } else if (/\.m?ts$/.test(entry.name) && !/\.(test|spec|bench)\.ts$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** `file binding` for every module-level or imported binding a function in `file` writes to. */
function moduleStateWrittenInFunctions(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const bindings = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) bindings.add(d.name.text);
    } else if (ts.isImportDeclaration(st) && st.importClause && !st.importClause.isTypeOnly) {
      const clause = st.importClause;
      if (clause.name) bindings.add(clause.name.text);
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) bindings.add(named.name.text);
      if (named && ts.isNamedImports(named)) for (const el of named.elements) if (!el.isTypeOnly) bindings.add(el.name.text);
    }
  }
  const root = (e: ts.Expression): ts.Expression => {
    let n = e;
    while (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) || ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n)) n = n.expression;
    return n;
  };
  const written = new Set<string>();
  const visit = (n: ts.Node, inFunction: boolean): void => {
    const inside = inFunction || ts.isFunctionLike(n);
    if (inside) {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && WRITING_METHODS.has(n.expression.name.text)) {
        const r = root(n.expression.expression);
        if (ts.isIdentifier(r) && bindings.has(r.text)) written.add(r.text);
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        const r = root(n.left);
        if (ts.isIdentifier(r) && bindings.has(r.text)) written.add(r.text);
      }
    }
    ts.forEachChild(n, (c) => visit(c, inside));
  };
  visit(sf, false);
  const rel = path.relative(path.join(PKG_DIR, 'src'), file).split(path.sep).join('/');
  return [...written].map((b) => `${rel} ${b}`);
}

describe('no module-scope initializer registers into module state', () => {
  it('every module-level binding a function writes to is a cache, a log-once set or a runtime API, and is listed', () => {
    const found = sourceFiles(path.join(PKG_DIR, 'src')).flatMap(moduleStateWrittenInFunctions).sort();
    // Anti-vacuity floor: the scan reads real files and finds the known caches.
    expect(found.length).toBeGreaterThan(20);
    expect(found).toEqual(Object.keys(MODULE_STATE_WRITTEN_IN_FUNCTIONS).sort());
  });
});
