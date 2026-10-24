/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11075 — the JSX type surface `generateDts` emits over the REAL
 * public manifest compiles as generated: `tsc --strict`, `skipLibCheck` unset,
 * zero diagnostics.
 *
 * The manifest is the one `dev/manifest-dump.tsx` publishes as
 * `sdui.manifest.json`. That module is RUN here, not mirrored: its registration
 * graph (the console's `src/register-plugins.ts`, `@object-ui/components` and
 * the eager plugin imports) and its `assertFullyLoaded` are the ones this file
 * reads, so a plugin the dump gains or loses moves this pin with it. The
 * `.d.ts` is then generated from that manifest exactly as `buildArtifacts` in
 * `packages/sdui-parser/scripts/gen-manifest.ts` generates
 * `sdui-intrinsics.d.ts`.
 *
 * Before the fix the generated file itself did not compile:
 * `TS2430 Interface 'RecordAlertProps' incorrectly extends interface
 * 'SduiBaseProps'`. `record:alert` declares `visible` with three arms
 * (objectui#9100) and `visible` is an `'every-node'` base prop, which the
 * objectui#11044 `Omit` did not cover. Now every declared base attribute is
 * `Omit`ted, whatever its scope.
 *
 * Three facts:
 *
 *   1. COMPILES — the generated file draws no diagnostic of its own;
 *   2. THE DECLARED TYPE WINS — `<record:alert>` takes `visible` as a boolean,
 *      a bare CEL string and the `{ dialect: 'cel', source }` envelope, and
 *      still refuses a number, while `SduiBaseProps.visible` stays `boolean`;
 *   3. CONTROL — a type that declares no `visible` inherits the base
 *      `boolean`: a string there is refused.
 */

import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { generateDts, type Manifest } from '@object-ui/sdui-parser';

// `manifest-dump.tsx` is the page script of `dev/manifest-dump.html`: it writes
// the manifest (or the generator's error) into `#out` and onto `window`.
document.body.innerHTML = '<pre id="out"></pre>';
await import('../../dev/manifest-dump');
const dumped = window as unknown as { __MANIFEST?: string; __MANIFEST_ERROR?: string };

if (dumped.__MANIFEST_ERROR !== undefined || dumped.__MANIFEST === undefined) {
  throw new Error(`dev/manifest-dump.tsx published no manifest: ${dumped.__MANIFEST_ERROR ?? 'nothing written'}`);
}
const manifest = JSON.parse(dumped.__MANIFEST) as Manifest;
const dts = generateDts(manifest);

/** One statement per line: page diagnostics are mapped back to cases BY LINE. */
const TSX_CASES: ReadonlyArray<{ what: string; code: string; rejected: boolean }> = [
  { what: 'control: the boolean arm', rejected: false, code: `export const c0 = <record:alert visible={true} />;` },
  { what: 'a bare CEL string', rejected: false, code: `export const c1 = <record:alert visible="record.status == 'overdue'" />;` },
  {
    what: 'the `cel` envelope',
    rejected: false,
    code: `export const c2 = <record:alert visible={{ dialect: 'cel', source: "record.status == 'overdue'" }} />;`,
  },
  { what: 'lit control: the declared type still judges the value', rejected: true, code: `export const c3 = <record:alert visible={42} />;` },
  { what: 'control: the base `boolean` where undeclared', rejected: false, code: `export const c4 = <record:details visible={true} />;` },
  { what: 'control: a string where undeclared', rejected: true, code: `export const c5 = <record:details visible="record.open" />;` },
];

/** `tsc` over the generated `.d.ts` plus one page, in memory. `skipLibCheck` is left unset. */
function typeCheck(): { dts: readonly string[]; erroredLines: ReadonlySet<number> } {
  const files: Record<string, string> = {
    '/sdui-probe/sdui-intrinsics.d.ts': dts,
    '/sdui-probe/page.tsx': `${TSX_CASES.map((c) => c.code).join('\n')}\n`,
  };
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName in files
      ? ts.createSourceFile(fileName, files[fileName]!, languageVersion, true)
      : getSourceFile(fileName, languageVersion, ...rest);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => fileName in files || fileExists(fileName);
  const readFile = host.readFile.bind(host);
  host.readFile = (fileName) => files[fileName] ?? readFile(fileName);
  const program = ts.createProgram(Object.keys(files), options, host);
  const all = ts.getPreEmitDiagnostics(program);
  const page = all.filter((d) => d.file?.fileName === '/sdui-probe/page.tsx');
  return {
    dts: all
      .filter((d) => d.file?.fileName !== '/sdui-probe/page.tsx')
      .map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`),
    erroredLines: new Set(page.map((d) => d.file!.getLineAndCharacterOfPosition(d.start ?? 0).line)),
  };
}

describe('the generated JSX types over the real public manifest compile (objectui#11075)', () => {
  const checked = typeCheck();

  it('reads the real manifest — the dump resolved the public tier, `record:alert` with its three `visible` arms', () => {
    // Anti-vacuity: a manifest that shrank to nothing would compile trivially.
    expect(Object.keys(manifest.components).length).toBeGreaterThan(50);
    expect(manifest.components['record:alert']?.inputs.find((i) => i.name === 'visible')?.type).toEqual([
      'boolean',
      'string',
      'object',
    ]);
  });

  it('the generated `.d.ts` draws zero diagnostics under `strict`, with `skipLibCheck` unset', () => {
    expect(checked.dts).toEqual([]);
  });

  it('`RecordAlertProps` omits the base `visible` for its declared one, and `SduiBaseProps.visible` stays `boolean`', () => {
    expect(dts).toContain('export interface RecordAlertProps extends Omit<SduiBaseProps, "visible"> {');
    expect(dts).toContain('  visible?: boolean | string | Record<string, unknown>;');
    const base = dts.match(/export interface SduiBaseProps \{\n([\s\S]*?)\n\}\n/)?.[1].split('\n') ?? [];
    expect(base).toContain('  visible?: boolean;');
    expect(dts).toContain('export interface RecordDetailsProps extends SduiBaseProps {');
  });

  it.each(TSX_CASES.map((c, line) => [c.what, c.rejected, line] as const))('%s — rejected: %s', (_what, rejected, line) => {
    expect(checked.erroredLines.has(line)).toBe(rejected);
  });
});
