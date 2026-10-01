// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
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

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'tsup';
import { afterAll, describe, expect, it } from 'vitest';

import { annotatePureCalls, mainConfig, pureSchemaConstruction } from '../tsup.config';
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
