/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `AdapterCtx` / `useAdapter` are typed by the protocol-level `DataSource`,
 * and a host widens them only by declaring its adapter on
 * `AdapterContextRegister` (objectstack#25917).
 *
 * ## What this pins, and why only the compiler can see it
 *
 * Both used to be typed by `ObjectStackAdapter`, which made the runtime depend
 * on `@object-ui/data-objectstack`, and gave every reader the ObjectStack-only
 * members (`getClient`, the access probes) whether or not its host installed
 * that adapter. Which reads the compiler refuses is erased before any runtime
 * assertion could run, so the gauge is `tsc`, driven here with the same
 * harness as `SchemaRendererContext.dataSourceType.pin.test.ts`.
 *
 * Two programs over the SAME cases-by-line source shape:
 *
 * - UNDECLARED: no augmentation. A reader reaches `DataSource` members and is
 *   refused the ObjectStack-only ones; a provider may install any
 *   `DataSource`. Reverting the context to `ObjectStackAdapter` turns the
 *   refused `getClient` / `probeAppAccess` rows green and this file red.
 * - DECLARED: the virtual module augments `AdapterContextRegister` with a host
 *   adapter that extends `DataSource`. The reader now reaches that adapter's
 *   extra member, and the provider's value is checked against it — a bare
 *   `DataSource` is refused there.
 *
 * ## Resolution guard
 *
 * The context resolves from its SOURCE path and `@object-ui/types` through
 * `paths`, not `dist`. The CONTROL rows are refusals unrelated to the adapter
 * type (`DataSource` declares `getObjectSchema` as required; a context value
 * cannot be a string), so a harness that degrades to `any` fires them. A
 * diagnostic in the virtual module's import header throws instead of reading
 * as a verdict.
 *
 * Cost note (ui/AGENTS.md 测试纪律): both programs are built at MODULE SCOPE,
 * so the compiler work lands in the import phase, which no test or hook
 * timeout bounds.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// __tests__ → context → src → react → packages → repo root
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..', '..');
/** The seam under test, by SOURCE path — no `dist`, no barrel. */
const CONTEXT_IMPORT = join(HERE, '..', 'AppShellContext').replace(/\\/g, '/');

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

/** The adapter as a READER reaches it. */
const READ = `(undefined as unknown as ReturnType<typeof useAdapter>)!`;
/** The type a PROVIDER's `value` is checked against. */
const PROVIDED = `React.ContextType<typeof AdapterCtx>`;
/** A complete protocol-level adapter. */
const ADAPTER = `(undefined as unknown as DataSource)`;

const UNDECLARED: readonly Case[] = [
  {
    what: 'a reader reaches a DataSource member (`find`) with no cast',
    code: `const c: DataSource['find'] = ${READ}.find;`,
    refused: false,
  },
  {
    what: 'a reader reaches `getObjectSchema`, which DataSource declares',
    code: `const c: DataSource['getObjectSchema'] = ${READ}.getObjectSchema;`,
    refused: false,
  },
  {
    what: 'a provider may install any DataSource, with no cast',
    code: `const c: ${PROVIDED} = ${ADAPTER};`,
    refused: false,
  },
  {
    what: 'a provider with no adapter yet may say so with `null`',
    code: `const c: ${PROVIDED} = null;`,
    refused: false,
  },
  {
    what: 'NARROWED `getClient` is not a DataSource member: refused with no host declaration',
    code: `const c = ${READ}.getClient;`,
    refused: true,
  },
  {
    what: 'NARROWED `probeAppAccess` is not a DataSource member: refused with no host declaration',
    code: `const c = ${READ}.probeAppAccess;`,
    refused: true,
  },
  {
    what: 'CONTROL `DataSource` really declares `getObjectSchema` as REQUIRED',
    code: `const c: DataSource = { find: (undefined as any), findOne: (undefined as any), create: (undefined as any), update: (undefined as any), delete: (undefined as any) };`,
    refused: true,
  },
  {
    what: 'CONTROL a context value cannot be a string',
    code: `const c: ${PROVIDED} = 'not-an-adapter';`,
    refused: true,
  },
];

const DECLARED: readonly Case[] = [
  {
    what: "a reader reaches the declared host adapter's own member",
    code: `const c: () => string = ${READ}.hostOnly;`,
    refused: false,
  },
  {
    what: 'a reader still reaches DataSource members',
    code: `const c: DataSource['find'] = ${READ}.find;`,
    refused: false,
  },
  {
    what: 'a provider may install the declared host adapter',
    code: `const c: ${PROVIDED} = (undefined as unknown as HostAdapter);`,
    refused: false,
  },
  {
    what: 'a provider value is checked against the declared adapter: a bare DataSource is refused',
    code: `const c: ${PROVIDED} = ${ADAPTER};`,
    refused: true,
  },
  {
    what: 'CONTROL a member neither type declares is still refused',
    code: `const c = ${READ}.notAMember;`,
    refused: true,
  },
];

function header(declared: boolean): string {
  return [
    `import type React from 'react';`,
    `import type { DataSource } from '@object-ui/types';`,
    `import type { AdapterCtx, useAdapter } from '${CONTEXT_IMPORT}';`,
    `type _Used = [DataSource, typeof AdapterCtx, typeof useAdapter, React.ReactNode];`,
    `interface HostAdapter extends DataSource { hostOnly(): string }`,
    ...(declared
      ? [`declare module '${CONTEXT_IMPORT}' { interface AdapterContextRegister { adapter: HostAdapter } }`]
      : []),
  ].join('\n');
}

/**
 * Compile one program and return the set of case indices that produced a
 * diagnostic. `paths` mirrors the repo root `tsconfig.json` (see the header).
 */
function erroringCases(cases: readonly Case[], declared: boolean): Set<number> {
  const head = `${header(declared)}\n`;
  // One BLOCK per case so the `const c` declarations do not collide.
  const body = cases.map((c) => `{ ${c.code} }`).join('\n');
  const source = `${head}${body}\n`;
  const headerLines = head.split('\n').length - 1;

  const VIRTUAL = join(HERE, `__adapterCtxPins.${declared ? 'declared' : 'undeclared'}.virtual.ts`).replace(/\\/g, '/');
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

  const hit = new Set<number>();
  for (const d of [...program.getSemanticDiagnostics(sf), ...program.getSyntacticDiagnostics(sf)]) {
    if (d.start == null) continue;
    const index = sf.getLineAndCharacterOfPosition(d.start).line - headerLines;
    if (index < 0) {
      throw new Error(
        'the pin harness failed to resolve its own imports — this is a setup failure, not a ' +
          `verdict about \`AdapterCtx\`: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
      );
    }
    hit.add(index);
  }
  return hit;
}

// Module scope on purpose — see the file header.
const refusedUndeclared = erroringCases(UNDECLARED, false);
const refusedDeclared = erroringCases(DECLARED, true);

describe('`AdapterCtx` is typed by DataSource unless a host declares its adapter (objectstack#25917)', () => {
  describe('no host declaration', () => {
    for (const [i, c] of UNDECLARED.entries()) {
      it(c.what, () => {
        expect({ case: c.what, refused: refusedUndeclared.has(i) })
          .toEqual({ case: c.what, refused: c.refused });
      });
    }
  });
  describe('a host declares its adapter on `AdapterContextRegister`', () => {
    for (const [i, c] of DECLARED.entries()) {
      it(c.what, () => {
        expect({ case: c.what, refused: refusedDeclared.has(i) })
          .toEqual({ case: c.what, refused: c.refused });
      });
    }
  });
});
