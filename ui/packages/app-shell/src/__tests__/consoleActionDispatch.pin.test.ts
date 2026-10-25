/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The dispatch seam's contract, pinned in BOTH directions (objectui#5611).
 *
 * ## What can go wrong here, and why a runtime test cannot see it
 *
 * `overrideNotice` is the safety copy shown once, in front of a privileged
 * admin override that finalises an approval step over approvers who have not
 * acted. Its producer (`views/DeclaredActionsBar`) and its reader
 * (`hooks/useConsoleActionRuntime`) are two files, and until this card the key
 * crossed between them through a `dispatch as ActionDef` cast on one side and
 * `action?: any` on the other — nothing declared it anywhere. Rename it on
 * either side and the notice simply stops appearing: no test goes red, because
 * each side's suite SPELLS THE KEY ITSELF (the producer suite reads
 * `dispatch.overrideNotice` off its own spy; the reader suite hands in a
 * literal), so neither can observe the other drifting.
 *
 * What closes that hole is a single declaration both sides import, which makes
 * a one-sided rename a COMPILE error. So the gauge has to be the compiler, and
 * this file drives `tsc` itself — same harness as
 * `packages/core/src/actions/__tests__/actionKeys.types.test.ts`, for the same
 * reason (the property under test is which assignments the compiler refuses,
 * and that is erased before any assertion could run).
 *
 * ## The second direction, which is a maintainer ruling
 *
 * Maintainer ruling 2026-08-22 (narrow B) — the published `ActionDef` stays
 * CLOSED and `overrideNotice` is carried at the seam instead:
 *
 *   > the 17 undeclared-in-spec keys already on `ActionDef` are author-writable,
 *   > runtime-honoured runner mechanics; `overrideNotice` is the first key that
 *   > is NOT author-supplied at all — declaring it on the authored-metadata
 *   > mirror would let an author (human or AI) legally write a key whose
 *   > enforcement on that path is unmeasured, i.e. a declared-but-unenforced
 *   > surface, which is the platform's red line.
 *
 * So every case below is compiled TWICE — once against `ConsoleActionDispatch`
 * and once against `ActionDef` — and both columns are asserted. The delta
 * between them is required to be exactly `overrideNotice`. That makes the file
 * revert-proof in both directions: drop the key from the envelope and the
 * envelope column flips; declare it on `ActionDef` (the shape that was
 * implemented and rejected) and the `ActionDef` column flips.
 *
 * ## Resolution guard
 *
 * The harness resolves `@object-ui/core` through the repo's SOURCE `paths`, not
 * through `dist`. That is deliberate: with default resolution an unbuilt `dist`
 * makes `ActionDef` degrade to `any`, every "rejected" row turns accepted, and
 * the pin inverts for a reason that has nothing to do with the seam — the
 * failure mode `actionKeys.types.test.ts` documents from measurement. On top of
 * that, any diagnostic landing in the virtual module's IMPORT HEADER throws
 * loudly here, so a resolution failure can never be read as a verdict about
 * `overrideNotice`.
 *
 * Cost note (AGENTS.md 测试纪律): both programs are built at MODULE SCOPE, so
 * the compiler work lands in the import phase, which no test or hook timeout
 * bounds. A `beforeAll` would put it under the narrower 10s `hookTimeout`.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
/** The envelope under test, by source path — no `dist`, no barrel. */
const ENVELOPE_IMPORT = join(HERE, '..', 'consoleActionDispatch').replace(/\\/g, '/');

/**
 * One assignment or read, and whether `tsc` must refuse it against each of the
 * two types. `envelope` is `ConsoleActionDispatch`; `actionDef` is the
 * published authored-metadata mirror.
 */
interface Case {
  readonly what: string;
  /** Emits EXACTLY one line — the line index is how a diagnostic is attributed. */
  readonly code: (T: string) => string;
  readonly envelope: boolean;
  readonly actionDef: boolean;
}

const CASES: readonly Case[] = [
  // ── The delta. These four rows ARE the ruling. ────────────────────────────
  {
    what: 'a host may COMPOSE `overrideNotice` on the dispatch — and only there',
    code: (T) => `const c: ${T} = { name: 'approval_reject', overrideNotice: 'n' };`,
    envelope: false,
    actionDef: true,
  },
  {
    what: 'a reader may READ `overrideNotice` off the dispatch — and only there',
    code: (T) => `const c: string | undefined = (undefined as unknown as ${T}).overrideNotice;`,
    envelope: false,
    actionDef: true,
  },
  // ── The envelope did not re-open the key set it extends ───────────────────
  {
    what: 'a typo in the notice key is refused by the envelope too',
    code: (T) => `const c: ${T} = { name: 'approval_reject', overrideNotcie: 'n' };`,
    envelope: true,
    actionDef: true,
  },
  {
    what: 'a non-string notice is refused — the reader concatenates it verbatim',
    code: (T) => `const c: ${T} = { name: 'approval_reject', overrideNotice: 42 };`,
    envelope: true,
    actionDef: true,
  },
  // ── Controls. Not about `overrideNotice`; they prove the two programs are
  //    really resolving the two real types rather than degrading to `any`. ───
  {
    what: 'CONTROL an ordinary declared action compiles against both',
    code: (T) => `const c: ${T} = { name: 'approval_reject', label: 'Reject' };`,
    envelope: false,
    actionDef: false,
  },
  {
    what: 'CONTROL an unrelated typo stays refused by both (step 3 closed the surface)',
    code: (T) => `const c: ${T} = { targt: '/api/v1/x' };`,
    envelope: true,
    actionDef: true,
  },
  {
    what: 'CONTROL the dispatch IS an ActionDef, so `execute(dispatch)` needs no cast',
    code: (T) => `const c: ConsoleActionDispatch extends ActionDef ? ${T} : never = { name: 'x' };`,
    envelope: false,
    actionDef: false,
  },
];

const IMPORTS = [
  `import type { ActionDef } from '@object-ui/core';`,
  `import type { ConsoleActionDispatch } from '${ENVELOPE_IMPORT}';`,
  // Keeps both imports "used" so `noUnusedLocals` (were it ever on) and the
  // reader of this virtual file both see why they are here.
  `type _Used = [ActionDef, ConsoleActionDispatch];`,
].join('\n');

/**
 * Compile every case as one line against `typeName`, and return the set of case
 * indices that produced a diagnostic.
 *
 * `paths` mirrors the repo root `tsconfig.json`, so `@object-ui/core` resolves
 * to `packages/core/src` exactly as the workspace itself resolves it. See the
 * file header for why default (`dist`-backed) resolution is not acceptable here.
 */
function erroringCases(typeName: string): Set<number> {
  const header = `${IMPORTS}\n`;
  // Each case is wrapped in its own BLOCK so seven `const c` declarations do
  // not collide — a duplicate-identifier diagnostic would land on every line
  // and read as "the compiler refuses everything", which is the one wrong
  // answer this file must never produce. Still exactly one line per case.
  const body = CASES.map((c) => `{ ${c.code(typeName)} }`).join('\n');
  const source = `${header}${body}\n`;
  const headerLines = header.split('\n').length - 1;

  const VIRTUAL = join(HERE, '__consoleActionDispatchPins.virtual.ts').replace(/\\/g, '/');
  const options: ts.CompilerOptions = {
    strict: true,
    skipLibCheck: true,
    noEmit: true,
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
        `[${typeName}] the pin harness failed to resolve its own imports — this is a setup ` +
          `failure, not a verdict about the seam: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
      );
    }
    cases.add(index);
  }
  return cases;
}

// Module scope on purpose — see the file header.
const againstEnvelope = erroringCases('ConsoleActionDispatch');
const againstActionDef = erroringCases('ActionDef');

describe('the dispatch envelope carries `overrideNotice` (objectui#5611)', () => {
  for (const [i, c] of CASES.entries()) {
    it(c.what, () => {
      expect({ case: c.what, refused: againstEnvelope.has(i) })
        .toEqual({ case: c.what, refused: c.envelope });
    });
  }
});

describe('the published `ActionDef` stays closed (maintainer ruling 2026-08-22)', () => {
  for (const [i, c] of CASES.entries()) {
    it(c.what, () => {
      expect({ case: c.what, refused: againstActionDef.has(i) })
        .toEqual({ case: c.what, refused: c.actionDef });
    });
  }
});

describe('discrimination: the delta between the two types is exactly `overrideNotice`', () => {
  it('every case the envelope accepts and ActionDef refuses is an overrideNotice case', () => {
    const delta = CASES
      .map((c, i) => ({ what: c.what, i }))
      .filter(({ i }) => !againstEnvelope.has(i) && againstActionDef.has(i))
      .map(({ what }) => what);
    expect(delta).toEqual([
      'a host may COMPOSE `overrideNotice` on the dispatch — and only there',
      'a reader may READ `overrideNotice` off the dispatch — and only there',
    ]);
  });

  it('the envelope never accepts something ActionDef would accept but should not', () => {
    // The reverse delta must be empty: widening the envelope beyond the one
    // declared extra key would show up here rather than in a prose review.
    const reverse = CASES
      .map((c, i) => ({ what: c.what, i }))
      .filter(({ i }) => againstEnvelope.has(i) && !againstActionDef.has(i))
      .map(({ what }) => what);
    expect(reverse).toEqual([]);
  });
});
