/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `SchemaRendererProvider`'s `dataSource` prop AND the context type the whole
 * tree reads back are the published `DataSource` contract, and the compiler
 * knows it (objectui#7912).
 *
 * ## What went wrong, and why only the compiler can see it
 *
 * Both members were declared `any`: the provider's own prop, and
 * `SchemaRendererContextType.dataSource`, which `useSchemaContext()` hands to
 * every consumer in the tree. So a bare string passed where the host's adapter
 * belongs raised nothing — and that is not a hypothetical mistake, it is the
 * shape of a config value read from the wrong place, failing at runtime on the
 * first `find()`. The type was never unknown: `@object-ui/types` exports
 * `DataSource`, `useSettledSchema` in this same package already declared its
 * parameter as `DataSource<any> | null | undefined`, and `app-shell`'s README
 * writes `DataSource` against this very seam.
 *
 * A runtime test cannot observe any of this. Which assignments the compiler
 * refuses is erased before an assertion could run, and while the seam was
 * `any` every wrong value succeeded at runtime until the first adapter call.
 * So the gauge has to be `tsc`, driven here — the same harness as
 * `RecordContext.dataSourceType.pin.test.ts` (objectui#9197), for the same
 * reason.
 *
 * ## Pinned in BOTH directions, through the PUBLISHED surface
 *
 * The rows do not name the internal interface. They go through
 * `Parameters<typeof SchemaRendererProvider>[0]` and `ReturnType<typeof
 * useSchemaContext>`, because "no consumer can be told anything about it" is
 * the defect, and those two are what a consumer can reach.
 *
 * - ACCEPTED: a host may hand over an adapter with no cast; a host with nothing
 *   bound may say so (`undefined` / `null` — the Studio preview, a react page
 *   before its AdapterProvider connects, a widget test driving `apiFetch`
 *   alone); a reader may reach `find` off the context after guarding.
 * - REFUSED: the card's own planted probe (`'not-an-adapter'`), the empty
 *   object that used to be passed as a "no adapter" stand-in, a partial adapter
 *   missing a REQUIRED member, and a plain data bag. These rows are the
 *   acceptance of objectui#7912: each one is silently accepted by `any`, so
 *   reverting either declaration turns them green and this file red.
 *
 * ## Resolution guard (why the CONTROL rows exist)
 *
 * The harness resolves the context from its SOURCE path and `@object-ui/types`
 * through the repo's `paths`, not through `dist`. A type-level pin's
 * characteristic failure is the harness degrading everything to `any`: every
 * REFUSED row would flip to accepted while the file still looks perfect. The
 * CONTROL rows are refusals that have nothing to do with `dataSource` — a
 * misspelled prop key, a missing required prop, and `DataSource`'s required
 * members being visible at all — so if resolution ever stops being real, they
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
/** The seam under test, by SOURCE path — no `dist`, no barrel. */
const CONTEXT_IMPORT = join(HERE, '..', 'SchemaRendererContext').replace(/\\/g, '/');

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

/** The context value as a CONSUMER reaches it. */
const CTX = `(undefined as unknown as ReturnType<typeof useSchemaContext>)`;
/** The provider's props as a CONSUMER reaches them. */
const PROPS = `Parameters<typeof SchemaRendererProvider>[0]`;
/** A complete adapter, for rows that are not about completeness. */
const ADAPTER = `(undefined as unknown as DataSource)`;

const CASES: readonly Case[] = [
  // ── The acceptance of objectui#7912. These rows ARE the card. ─────────────
  {
    what: 'a host may hand the provider a DataSource adapter with no cast',
    code: `const c: ${PROPS} = { children: null, dataSource: ${ADAPTER} };`,
    refused: false,
  },
  {
    what: 'a host with no adapter bound may say so with `undefined`',
    code: `const c: ${PROPS} = { children: null, dataSource: undefined };`,
    refused: false,
  },
  {
    what: 'a host with no adapter bound may say so with `null`',
    code: `const c: ${PROPS} = { children: null, dataSource: null };`,
    refused: false,
  },
  {
    what: 'a reader reaches `find` off the context value with no cast, once guarded',
    code: `const c: DataSource['find'] = ${CTX}.dataSource!.find;`,
    refused: false,
  },
  {
    what: 'the context member reads as the adapter contract, absences included',
    code: `const c: DataSource | null | undefined = ${CTX}.dataSource;`,
    refused: false,
  },
  {
    what: 'the seam is one type on both sides — the prop is assignable to the context member',
    code: `const c: ReturnType<typeof useSchemaContext>['dataSource'] = (undefined as unknown as ${PROPS})['dataSource'];`,
    refused: false,
  },

  // ── The breaking half. Each of these is what `any` used to accept. ────────
  {
    what: "BREAKING the card's planted probe — a bare string where the adapter belongs",
    code: `const c: ${PROPS} = { children: null, dataSource: 'not-an-adapter' };`,
    refused: true,
  },
  {
    what: 'BREAKING the context member no longer reads as a string',
    code: `const c: string | null | undefined = ${CTX}.dataSource;`,
    refused: true,
  },
  {
    what: 'BREAKING an empty object is not a "no adapter" stand-in any more',
    code: `const c: ${PROPS} = { children: null, dataSource: {} };`,
    refused: true,
  },
  {
    what: 'BREAKING a partial adapter missing a REQUIRED member is refused',
    code: `const c: ${PROPS} = { children: null, dataSource: { find: (undefined as any), findOne: (undefined as any), create: (undefined as any), update: (undefined as any), delete: (undefined as any) } };`,
    refused: true,
  },
  {
    what: 'BREAKING a plain data bag is refused where the adapter belongs',
    code: `const c: ${PROPS} = { children: null, dataSource: { users: [] } };`,
    refused: true,
  },

  // ── Controls. Nothing to do with `dataSource`; they prove the program is
  //    resolving the real types rather than degrading everything to `any`. ──
  {
    what: 'CONTROL a misspelled provider prop key is refused',
    code: `const c: ${PROPS} = { children: null, dataSource: ${ADAPTER}, dataSorce: ${ADAPTER} };`,
    refused: true,
  },
  {
    what: 'CONTROL a provider value missing the required `children` is refused',
    code: `const c: ${PROPS} = { dataSource: ${ADAPTER} };`,
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
  `import type { SchemaRendererProvider, useSchemaContext } from '${CONTEXT_IMPORT}';`,
  // Keeps the imports "used", so a reader of the virtual file can see why they
  // are here even when a case stops mentioning one of them.
  `type _Used = [DataSource, typeof SchemaRendererProvider, typeof useSchemaContext];`,
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

  const VIRTUAL = join(HERE, '__schemaRendererDataSourcePins.virtual.ts').replace(/\\/g, '/');
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

describe('`SchemaRendererProvider.dataSource` is the published DataSource contract (objectui#7912)', () => {
  for (const [i, c] of CASES.entries()) {
    it(c.what, () => {
      expect({ case: c.what, refused: refusedByCompiler.has(i) })
        .toEqual({ case: c.what, refused: c.refused });
    });
  }
});
