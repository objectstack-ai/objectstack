// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Two DTS passes over one source give the same bytes, whatever order rollup
// loads the modules in (#30061).
//
// This package's DTS pass (`BUILD_DTS=true tsup`, the docblock above
// `mainConfig` in `tsup.config.ts`) runs every entry through ONE ts.Program.
// Its checker creates each type once, on first use, and the declaration
// printer writes union members, and the object members derived from them, in
// type-creation order. tsup's bundled rollup-plugin-dts emitted each file when
// rollup TRANSFORMED it, and rollup transforms in the order its async loads
// finish, which differs between runs. So whichever file came first decided the
// order of every union it shared with a later one. On `main` at 1f13eb31, two
// clean builds of the same tree differed in 18 of 134 declaration files, chunk
// names included, with the same public surface.
//
// `patches/tsup@8.5.1.patch` now emits every source file once, in the
// program's own file order, before rollup is handed any of them. This file
// pins that with the smallest tree that shows the defect: two entries that
// infer the same three string literals in opposite orders. It runs the real
// tsup CLI twice and forces the two runs to load the entries in opposite
// orders, by delaying the read of one entry in each run.
//
// The two controls make the equality mean something:
//  - the fixture really is order-sensitive under this TypeScript: emitting
//    it in the two orders by hand gives two different texts. If a TypeScript
//    release starts sorting union members, this control fails, so the pin
//    cannot go quietly vacuous;
//  - the delay really reached rollup's loader: each run's read log shows the
//    entries loaded in the order this file asked for.
//
// Why a fixture and not two builds of this package: one DTS pass of this
// package takes ~45 s and ~3.5 GB of RSS, and of four unforced builds of
// `main` measured on #30061 three agreed byte for byte. Two full builds would
// double that cost in CI and still pass a regression most of the time. The
// forced order turns the same defect into a failure on every run.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

/** This package's root. Every read and write below stays inside it. */
const PKG_DIR = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(PKG_DIR, 'node_modules', '.cache');
mkdirSync(CACHE_DIR, { recursive: true });
const WORK_DIR = mkdtempSync(path.join(CACHE_DIR, 'dts-emit-order-'));
afterAll(() => rmSync(WORK_DIR, { recursive: true, force: true }));

/** The tsup CLI this package's `build` script runs. */
const TSUP_CLI = path.join(
  path.dirname(createRequire(path.join(PKG_DIR, 'package.json')).resolve('tsup/package.json')),
  'dist',
  'cli-default.js',
);

const ENTRIES = ['a.ts', 'b.ts'] as const;

// Each entry infers the union of the same three literals, written in opposite
// orders. Whichever file the checker reads first creates the three literal
// types, and their creation order is the order both declarations print.
const SOURCES: Record<string, string> = {
  'lib.ts': 'export function oneOf<T extends string>(...values: T[]): T {\n  return values[0];\n}\n',
  'a.ts': "import { oneOf } from './lib';\nexport const a = oneOf('zeta', 'alpha', 'mid');\n",
  'b.ts': "import { oneOf } from './lib';\nexport const b = oneOf('mid', 'alpha', 'zeta');\n",
};

// tsup sets `baseUrl`, which TypeScript 6 reports as deprecated.
const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    strict: true,
    declaration: true,
    skipLibCheck: true,
    ignoreDeprecations: '6.0',
  },
  include: ['src'],
};

// Loaded into tsup's DTS worker through NODE_OPTIONS: delays rollup's read of
// the files named in DTS_ORDER_DELAY, and logs every fixture read in the
// order it finishes.
const DELAY_PRELOAD = `
const fsp = require('node:fs/promises');
const path = require('node:path');
const slow = new Set((process.env.DTS_ORDER_DELAY || '').split(',').filter(Boolean));
const log = process.env.DTS_ORDER_LOG;
const src = process.env.DTS_ORDER_SRC;
const readFile = fsp.readFile;
fsp.readFile = async function (file, ...rest) {
  const name = typeof file === 'string' && path.dirname(file) === src ? path.basename(file) : undefined;
  if (name && slow.has(name)) await new Promise((resolve) => setTimeout(resolve, 400));
  const result = await readFile.call(this, file, ...rest);
  if (name && log) require('node:fs').appendFileSync(log, name + '\\n');
  return result;
};
`;

const FIXTURE_DIR = path.join(WORK_DIR, 'fixture');
const SRC_DIR = path.join(FIXTURE_DIR, 'src');
mkdirSync(SRC_DIR, { recursive: true });
for (const [name, text] of Object.entries(SOURCES)) writeFileSync(path.join(SRC_DIR, name), text);
writeFileSync(path.join(FIXTURE_DIR, 'tsconfig.json'), JSON.stringify(TSCONFIG, null, 2));
writeFileSync(path.join(FIXTURE_DIR, 'package.json'), '{ "name": "dts-emit-order-fixture", "private": true }\n');
const PRELOAD = path.join(WORK_DIR, 'delay-preload.cjs');
writeFileSync(PRELOAD, DELAY_PRELOAD);

/** One DTS-only tsup pass with `delayed` read late; returns the output tree and the read order. */
function dtsPass(label: string, delayed: string): { files: Map<string, string>; readOrder: string[] } {
  const outDir = path.join(WORK_DIR, label);
  const log = path.join(WORK_DIR, `${label}.reads`);
  writeFileSync(log, '');
  execFileSync(
    process.execPath,
    [
      TSUP_CLI,
      ...ENTRIES.map((entry) => `src/${entry}`),
      '--dts-only',
      '--format',
      'esm,cjs',
      '--tsconfig',
      'tsconfig.json',
      '--out-dir',
      outDir,
      '--silent',
    ],
    {
      cwd: FIXTURE_DIR,
      env: {
        ...process.env,
        NODE_OPTIONS: `--require ${PRELOAD}`,
        DTS_ORDER_DELAY: delayed,
        DTS_ORDER_LOG: log,
        DTS_ORDER_SRC: SRC_DIR,
      },
      stdio: 'pipe',
    },
  );
  const files = new Map<string, string>();
  for (const name of readdirSync(outDir).sort()) files.set(name, readFileSync(path.join(outDir, name), 'utf8'));
  const readOrder = readFileSync(log, 'utf8')
    .split('\n')
    .filter((name) => (ENTRIES as readonly string[]).includes(name));
  return { files, readOrder };
}

/** The fixture's declarations, emitted by hand in `order` through one program. */
function emitInOrder(order: readonly string[]): string {
  const options: ts.CompilerOptions = { ...ts.convertCompilerOptionsFromJson(TSCONFIG.compilerOptions, FIXTURE_DIR).options, emitDeclarationOnly: true };
  const roots = ENTRIES.map((entry) => path.join(SRC_DIR, entry));
  const program = ts.createProgram(roots, options);
  let text = '';
  for (const entry of order) {
    program.emit(program.getSourceFile(path.join(SRC_DIR, entry)), (_, out) => {
      text += out;
    }, undefined, true);
  }
  return text.split('\n').filter((line) => line.startsWith('export declare const')).sort().join('\n');
}

describe('the DTS pass emits the same bytes whatever order rollup loads modules in (#30061)', () => {
  it('the fixture is order-sensitive: emitting a then b and b then a gives different declarations', () => {
    const aFirst = emitInOrder(['a.ts', 'b.ts']);
    const bFirst = emitInOrder(['b.ts', 'a.ts']);
    expect(aFirst).toContain('"zeta" | "alpha" | "mid"');
    expect(bFirst).toContain('"mid" | "alpha" | "zeta"');
    expect(aFirst, 'this TypeScript no longer prints unions in creation order, so the pin below proves nothing').not.toBe(bFirst);
  });

  it('two tsup DTS passes that load the entries in opposite orders write the same files, byte for byte', () => {
    const aLate = dtsPass('a-late', 'a.ts');
    const bLate = dtsPass('b-late', 'b.ts');

    // The control: the delay reached rollup's loader, so the two passes really
    // loaded the entries in opposite orders.
    expect(aLate.readOrder, 'the a.ts delay did not reach rollup').toEqual(['b.ts', 'a.ts']);
    expect(bLate.readOrder, 'the b.ts delay did not reach rollup').toEqual(['a.ts', 'b.ts']);

    expect([...aLate.files.keys()]).toEqual(['a.d.mts', 'a.d.ts', 'b.d.mts', 'b.d.ts']);
    expect(aLate.files.get('a.d.ts')).toMatch(/declare const a: "(zeta|mid)" \| "alpha" \| "(mid|zeta)";/);
    expect(Object.fromEntries(bLate.files)).toEqual(Object.fromEntries(aLate.files));
  });
});
