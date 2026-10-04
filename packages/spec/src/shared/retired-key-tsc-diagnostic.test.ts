// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A retired key's `tsc` diagnostic names the retirement.
 *
 * `retiredKey()` makes a removal audible in two channels: the parse (the
 * prescription) and `tsc`. Until this pin the `tsc` channel only said
 * `Type 'string[]' is not assignable to type 'undefined'` — audible, but it
 * named no retirement, and an upgrading author read forty of them as typing
 * bugs. The tombstone's input type now carries a fixed sentence
 * (`RetiredKeySchema` in `retired-key.ts`), and this file measures what `tsc`
 * actually prints for an authored retired key.
 *
 * ## Why the compiler API
 *
 * A `@ts-expect-error` proves only THAT the line fails, never what the
 * diagnostic says — and the text is the whole payload here. So each probe
 * below is compiled with `ts.createProgram` against this package's real
 * source (`@objectstack/spec` is mapped to `src/` through `paths`) and the
 * assertion reads the diagnostic itself. The probes are in-memory overlays;
 * nothing is written to disk.
 *
 * ## What is asserted, and what is not
 *
 * The diagnostic code, the line (the retired key's own), and the two named
 * subjects the sentence exists to deliver: the house `[REMOVED]` marker and the
 * door that prints the per-key prescription, `os validate`. The sentence's
 * remaining wording is deliberately not pinned.
 *
 * The cases span both object modes and both value kinds, because `tsc` words
 * them differently: an array value reads as a missing property (TS2741), a
 * string as a plain non-assignable type (TS2322). `PageSchema` and
 * `FieldSchema` are `strictObject`s; `IndexSchema` is a plain `z.object`.
 *
 * ⚠️ Anti-vacuity: a harness that resolves nothing reports import errors or
 * nothing at all, and both look like "no retirement text". The control probe
 * authors the same stack WITHOUT the retired keys and must compile with ZERO
 * diagnostics, which proves `@objectstack/spec` resolved and `defineStack`
 * type-checks the literal.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE_DIR = resolve(SRC_DIR, 'shared/__retired_key_tsc_probes__');

/** The stack every probe authors; `retired` splices retired keys into it. */
function stackProbe(retired: { page?: string; field?: string; index?: string }): string {
  return [
    "import { defineStack } from '@objectstack/spec';",
    '',
    'export const stack = defineStack({',
    "  manifest: { id: 'com.example.probe', name: 'probe', version: '1.0.0', type: 'app' },",
    '  objects: [',
    '    {',
    "      name: 'deal',",
    "      label: 'Deal',",
    '      fields: {',
    "        amount: { type: 'number', label: 'Amount' },",
    `        stage: { type: 'text', label: 'Stage'${retired.field ?? ''} },`,
    '      },',
    `      indexes: [{ fields: ['amount']${retired.index ?? ''} }],`,
    '    },',
    '  ],',
    `  pages: [{ name: 'home_page', label: 'Home', type: 'home'${retired.page ?? ''} }],`,
    '});',
    '',
  ].join('\n');
}

const PROBES = {
  control: stackProbe({}),
  // HotCRM's measured case: `page.assignedProfiles` (strictObject, array value).
  page: stackProbe({ page: ", assignedProfiles: ['sales_rep']" }),
  // A rename retirement on a strictObject, string value.
  field: stackProbe({ field: ", conditionalRequired: 'amount > 0'" }),
  // A non-strict `z.object` tombstone, string value.
  index: stackProbe({ index: ", type: 'btree'" }),
} as const;

type ProbeName = keyof typeof PROBES;

function compileProbes(): Map<ProbeName, readonly ts.Diagnostic[]> {
  const paths = new Map<string, string>();
  for (const [name, text] of Object.entries(PROBES)) paths.set(resolve(PROBE_DIR, `${name}.ts`), text);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: ['node'],
    paths: {
      '@objectstack/spec': [resolve(SRC_DIR, 'index.ts')],
      '@objectstack/spec/*': [resolve(SRC_DIR, '*/index.ts')],
    },
  };

  const host = ts.createCompilerHost(options, true);
  const realGetSourceFile = host.getSourceFile.bind(host);
  const realFileExists = host.fileExists.bind(host);
  const realReadFile = host.readFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const overlay = paths.get(resolve(fileName));
    return overlay === undefined
      ? realGetSourceFile(fileName, languageVersion, onError, shouldCreate)
      : ts.createSourceFile(fileName, overlay, languageVersion, true);
  };
  host.fileExists = (fileName) => paths.has(resolve(fileName)) || realFileExists(fileName);
  host.readFile = (fileName) => paths.get(resolve(fileName)) ?? realReadFile(fileName);

  const program = ts.createProgram([...paths.keys()], options, host);
  const out = new Map<ProbeName, readonly ts.Diagnostic[]>();
  for (const name of Object.keys(PROBES) as ProbeName[]) {
    const file = program.getSourceFile(resolve(PROBE_DIR, `${name}.ts`));
    if (file === undefined) throw new Error(`probe ${name} did not enter the program`);
    out.set(name, [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]);
  }
  return out;
}

/** `L<line> TS<code>: <message>`, one per diagnostic. */
function render(diagnostics: readonly ts.Diagnostic[]): string[] {
  return diagnostics.map((d) => {
    const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
    return `L${line} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
  });
}

/** The 1-based line of `needle` in a probe's text. */
function lineOf(name: ProbeName, needle: string): number {
  const lines = PROBES[name].split('\n');
  const index = lines.findIndex((l) => l.includes(needle));
  if (index < 0) throw new Error(`${needle} is not in probe ${name}`);
  return index + 1;
}

describe('a retired key names its retirement in the tsc diagnostic', () => {
  const diagnostics = compileProbes();

  it('control: the same stack without retired keys compiles clean (the harness resolves the spec)', () => {
    expect(render(diagnostics.get('control')!)).toEqual([]);
  });

  const cases: ReadonlyArray<[ProbeName, string, number]> = [
    ['page', 'assignedProfiles', 2741],
    ['field', 'conditionalRequired', 2322],
    ['index', "type: 'btree'", 2322],
  ];

  it.each(cases)('%s: writing %s fails with TS%i, and the message says [REMOVED] and names `os validate`', (name, key, code) => {
    const rendered = render(diagnostics.get(name)!);
    expect(rendered, 'exactly one diagnostic: the retired key').toHaveLength(1);
    const [only] = rendered;
    expect(only.startsWith(`L${lineOf(name, key)} TS${code}: `), only).toBe(true);
    expect(only).toContain('[REMOVED]');
    expect(only).toContain('`os validate`');
    // The form this replaced named no retirement at all.
    expect(only).not.toContain("to type 'undefined'");
  });
});
