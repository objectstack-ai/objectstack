/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RecordContextValue.dataSource` holds a DataSource ADAPTER, and the compiler
 * knows it (objectui#9197).
 *
 * ## What went wrong, and why only the compiler can see it
 *
 * The member was declared `dataSource?: string` — "an optional datasource id;
 * mirrors the page-level datasource override" — while the one production host
 * that writes it (`app-shell/views/RecordDetailView`) forwards an adapter
 * OBJECT, and every reader calls adapter methods on it. Zero producers ever
 * assigned an id string. So the declaration was not a contract anyone kept: it
 * was a statement the code contradicted at every site, and each reader paid for
 * it with an `as any` at the point of use.
 *
 * The cost is exactly what a cast costs: it deletes the compiler's answer to
 * "does this adapter have the method I am about to call". objectui#8883's
 * reference rail is the worked instance — it reaches for
 * `dataSource.getObjectSchema` through a cast, so nothing checks that the
 * member is guaranteed to exist. `getObjectSchema` is a REQUIRED member of
 * `DataSource`; the honest type was imported by these packages all along.
 *
 * A runtime test cannot observe any of this. Which assignments the compiler
 * refuses is erased before an assertion could run, and `as any` makes every
 * wrong call succeed at runtime anyway. So the gauge has to be `tsc`, driven
 * here — the same harness as
 * `packages/app-shell/src/__tests__/consoleActionDispatch.pin.test.ts`, for the
 * same reason.
 *
 * ## Pinned in BOTH directions
 *
 * - The adapter direction (`ACCEPTED`): a producer may hand over a `DataSource`
 *   and a reader may reach `getObjectSchema` off it with no cast. These rows
 *   are the acceptance of objectui#9197; they are REFUSED by the old `string`
 *   declaration, so reverting it turns them red.
 * - The id-string direction (`REFUSED`): writing a bare id string into the
 *   member is now a type error. That is the BREAKING half of this change and
 *   the reason it ships with a FROM/TO changeset — it is pinned so nobody
 *   quietly restores the `string` alternative as a union member "to be kind"
 *   to an out-of-repo caller. Re-widening it to `string | DataSource` would
 *   also re-break the acceptance rows, because a union member without
 *   `getObjectSchema` cannot be read without narrowing.
 *
 * ## Resolution guard (why these controls exist)
 *
 * The harness resolves `@object-ui/react` and `@object-ui/types` through the
 * repo's SOURCE `paths`, not `dist`. With default resolution an unbuilt `dist`
 * degrades both types to `any`, every REFUSED row flips to accepted, and the
 * pin inverts for a reason that has nothing to do with this card. The CONTROL
 * rows are what make that visible: they are refusals that have nothing to do
 * with `dataSource` (a misspelled key, a missing required member), so if the
 * program ever stops resolving the real types they flip — a control that can
 * fire. Any diagnostic landing in the virtual module's IMPORT HEADER throws
 * loudly instead of being read as a verdict.
 *
 * Cost note (AGENTS.md 测试纪律): the program is built at MODULE SCOPE, so the
 * compiler work lands in the import phase, which no test or hook timeout
 * bounds. A `beforeAll` would put it under the narrower 10s `hookTimeout`.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// __tests__ → context → src → react → packages → repo root
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..', '..');
/** The context under test, by SOURCE path — no `dist`, no barrel. */
const CONTEXT_IMPORT = join(HERE, '..', 'RecordContext').replace(/\\/g, '/');

/**
 * One assignment or read, and whether `tsc` must refuse it.
 * `code` emits EXACTLY one line — the line index is how a diagnostic is
 * attributed back to a case.
 */
interface Case {
  readonly what: string;
  readonly code: string;
  readonly refused: boolean;
}

const CTX = `(undefined as unknown as RecordContextValue)`;

const CASES: readonly Case[] = [
  // ── The acceptance of objectui#9197. These rows ARE the card. ─────────────
  {
    what: 'a producer may hand the member a DataSource adapter with no cast',
    code: `const c: RecordContextValue = { objectName: 'account', recordId: 'r1', dataSource: (undefined as unknown as DataSource) };`,
    refused: false,
  },
  {
    what: "objectui#8883's rail reaches `getObjectSchema` with no cast",
    code: `const c: (o: string) => Promise<any> = ${CTX}.dataSource!.getObjectSchema;`,
    refused: false,
  },
  {
    what: 'the member is assignable to `DataSource` once narrowed',
    code: `const c: DataSource | undefined = ${CTX}.dataSource;`,
    refused: false,
  },
  {
    what: 'the member stays OPTIONAL — a host with no adapter still builds a value',
    code: `const c: RecordContextValue = { objectName: 'account', recordId: 'r1' };`,
    refused: false,
  },

  // ── The breaking half, pinned so it cannot be quietly re-widened. ─────────
  {
    what: 'BREAKING a datasource id string is no longer assignable to the member',
    code: `const c: RecordContextValue = { objectName: 'account', recordId: 'r1', dataSource: 'ds_primary' };`,
    refused: true,
  },
  {
    what: 'BREAKING the member no longer reads as a string',
    code: `const c: string | undefined = ${CTX}.dataSource;`,
    refused: true,
  },

  // ── Controls. Nothing to do with `dataSource`; they prove the program is
  //    resolving the real types rather than degrading everything to `any`. ──
  {
    what: 'CONTROL a misspelled context key is refused',
    code: `const c: RecordContextValue = { objectName: 'account', recordId: 'r1', dataSorce: 'x' };`,
    refused: true,
  },
  {
    what: 'CONTROL a value missing the required `objectName` is refused',
    code: `const c: RecordContextValue = { recordId: 'r1' };`,
    refused: true,
  },
  {
    what: 'CONTROL `DataSource` really declares `getObjectSchema` as REQUIRED',
    code: `const c: DataSource = { find: (undefined as any), findOne: (undefined as any), create: (undefined as any), update: (undefined as any), delete: (undefined as any) };`,
    refused: true,
  },
];

const IMPORTS = [
  `import type { DataSource } from '@object-ui/types';`,
  `import type { RecordContextValue } from '${CONTEXT_IMPORT}';`,
  // Keeps both imports "used", so a reader of the virtual file can see why
  // they are here even when a case stops mentioning one of them.
  `type _Used = [DataSource, RecordContextValue];`,
].join('\n');

/**
 * Compile every case and return the set of case indices that produced a
 * diagnostic.
 *
 * `paths` mirrors the repo root `tsconfig.json`, so the workspace specifiers
 * resolve to source exactly as the workspace itself resolves them. See the file
 * header for why default (`dist`-backed) resolution is not acceptable here.
 */
function erroringCases(): Set<number> {
  const header = `${IMPORTS}\n`;
  // Each case is wrapped in its own BLOCK so the `const c` declarations do not
  // collide — a duplicate-identifier diagnostic would land on every line and
  // read as "the compiler refuses everything", which is the one wrong answer
  // this file must never produce. Still exactly one line per case.
  const body = CASES.map((c) => `{ ${c.code} }`).join('\n');
  const source = `${header}${body}\n`;
  const headerLines = header.split('\n').length - 1;

  const VIRTUAL = join(HERE, '__recordContextDataSourcePins.virtual.ts').replace(/\\/g, '/');
  const options: ts.CompilerOptions = {
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    jsx: ts.JsxEmit.ReactJSX,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
    baseUrl: REPO_ROOT,
    paths: {
      '@object-ui/types': ['packages/types/src'],
      '@object-ui/types/*': ['packages/types/src/*'],
      '@object-ui/core': ['packages/core/src'],
      '@object-ui/core/*': ['packages/core/src/*'],
    },
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === VIRTUAL
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : getSourceFile(fileName, languageVersion, ...rest);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => (fileName === VIRTUAL ? true : fileExists(fileName));
  const readFile = host.readFile.bind(host);
  host.readFile = (fileName) => (fileName === VIRTUAL ? source : readFile(fileName));

  const program = ts.createProgram([VIRTUAL], options, host);
  const sf = program.getSourceFile(VIRTUAL);
  if (!sf) throw new Error('virtual source file was not added to the program');

  const cases = new Set<number>();
  for (const d of [...program.getSemanticDiagnostics(sf), ...program.getSyntacticDiagnostics(sf)]) {
    if (d.start == null) continue;
    const index = sf.getLineAndCharacterOfPosition(d.start).line - headerLines;
    // A diagnostic ABOVE the first case line is a broken import, not a verdict.
    // Fail loudly rather than let it read as "the compiler accepted everything".
    if (index < 0) {
      throw new Error(
        'the pin harness failed to resolve its own imports — this is a setup failure, not a ' +
          `verdict about \`dataSource\`: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
      );
    }
    cases.add(index);
  }
  return cases;
}

// Module scope on purpose — see the file header.
const refusedByCompiler = erroringCases();

describe('`RecordContextValue.dataSource` is a DataSource adapter (objectui#9197)', () => {
  for (const [i, c] of CASES.entries()) {
    it(c.what, () => {
      expect({ case: c.what, refused: refusedByCompiler.has(i) })
        .toEqual({ case: c.what, refused: c.refused });
    });
  }
});
