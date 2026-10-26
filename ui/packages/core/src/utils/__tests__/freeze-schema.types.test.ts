/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Type-level pins for objectui#5257 — `cloneAsOverride` returns a type that
 * tells the truth about the value it produces.
 *
 * The defect: `cloneAsOverride<T>(view: T): T` handed the input type straight
 * back, so cloning a `SystemView<S>` returned something still typed
 * deep-readonly while the implementation had always produced a plain mutable
 * object. The documented override flow (`packages/core/README.md`,
 * `draft.columns.push(...)`) therefore did not compile — TS2339, measured by the
 * #5138 snippet gate. The fix returns `DeepMutable<T>`, the inverse of the
 * `DeepReadonly<T>` that `SystemView` is built from.
 *
 * Why this file drives `tsc` itself: the property under test is what the
 * COMPILER accepts. A runtime test cannot observe it — the runtime was never
 * wrong — and `expectTypeOf` is unavailable here (vitest's `typecheck` mode is
 * off in `vitest.config.mts`; enabling it is a shared-config change owned by
 * objectui#3181, not by this card). So the cases are compiled as a virtual
 * module against the real declarations and the diagnostics are read back. Same
 * mechanism as `actions/__tests__/actionKeys.types.test.ts`.
 *
 * NO BUILD ARTIFACT SITS BETWEEN THE EDIT AND THESE ASSERTIONS. The preamble
 * imports `../freeze-schema` by relative path, so the program reads the SOURCE
 * file; every type these cases touch (`DeepReadonly`, `DeepMutable`,
 * `SystemView`, `cloneAsOverride`) is declared in that one file and resolves
 * through no workspace package. That is what makes this suite safe from the
 * staleness `actionKeys.types.test.ts` documents for its `description` pin,
 * where an indexed access into a WORKSPACE package degraded to `any` whenever
 * `dist` was unbuilt and turned a `rejected: true` row green for an unrelated
 * reason. The complementary dist-resolved measurement is the #5138 snippet gate
 * over `packages/core/README.md`, which compiles against the built
 * `dist/*.d.ts`; the two legs are deliberately different resolutions.
 *
 * The discrimination proof is built in rather than promised in prose: every case
 * is compiled a SECOND time with one line changed — `cloneAsOverride` redeclared
 * with its PRE-FIX signature `<T>(view: T) => T`, everything else still the real
 * module. `EXPECTED_FLIPS` names, by index, exactly which cases that reverts.
 * A case outside that set is green on BOTH legs and is stated as such, not
 * quietly counted as evidence.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { defineSystemView, cloneAsOverride, isSystemView, SYSTEM_VIEW_MARKER } from '../freeze-schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_IMPORT = join(HERE, '..', 'freeze-schema').replace(/\\/g, '/');

/** One statement, and whether `tsc` is required to reject it. */
interface Case {
  readonly what: string;
  readonly code: string;
  readonly rejected: boolean;
}

/** The schema every case clones, written once so the cases stay readable. */
const VIEW = `defineSystemView({ type: 'list', data: { object: 'User' }, columns: [{ name: 'email' }] })`;

const CASES: readonly Case[] = [
  // ── The acceptance criterion, in type form ────────────────────────────────
  // This is `packages/core/README.md`'s override flow. It is the whole card.
  {
    what: 'a cloneAsOverride draft accepts .push on a nested array',
    rejected: false,
    code: `cloneAsOverride(${VIEW}).columns.push({ name: 'name' });`,
  },
  {
    what: 'a cloneAsOverride draft accepts assignment to a nested property',
    rejected: false,
    code: `cloneAsOverride(${VIEW}).data.object = 'Account';`,
  },
  {
    what: 'a cloneAsOverride draft accepts assignment to a top-level property',
    rejected: false,
    code: `cloneAsOverride(${VIEW}).type = 'form';`,
  },

  // ── The opposite, which MUST stay rejected ────────────────────────────────
  // `defineSystemView` is the immutability contract; relaxing the clone must
  // not relax the source. Both of these are documented README behaviour.
  {
    what: 'the System View itself still refuses .push on a nested array',
    rejected: true,
    code: `${VIEW}.columns.push({ name: 'name' });`,
  },
  {
    what: 'the System View itself still refuses assignment to a property',
    rejected: true,
    code: `${VIEW}.type = 'form';`,
  },
  {
    what: 'the System View itself still refuses assignment to a NESTED property',
    rejected: true,
    code: `${VIEW}.data.object = 'Account';`,
  },

  // ── The ruling's load-bearing premise: the type RELAXES, so callers keep
  //    compiling. A caller who fed the clone back into a deep-readonly
  //    position compiled before the change and must still compile after it.
  {
    what: 'a draft is still assignable to the deep-readonly SystemView it came from',
    rejected: false,
    code:
      `const back: SystemView<{ type: string; data: { object: string }; columns: { name: string }[] }> = ` +
      `cloneAsOverride(${VIEW}); void back;`,
  },
  {
    what: 'a draft is still assignable to a DeepReadonly of the same shape',
    rejected: false,
    code:
      `const ro: DeepReadonly<{ type: string; data: { object: string }; columns: { name: string }[] }> = ` +
      `cloneAsOverride(${VIEW}); void ro;`,
  },

  // ── DeepMutable's own shape ───────────────────────────────────────────────
  // Optionality must survive. A non-homomorphic mapped type (the shape needed
  // to also strip SYSTEM_VIEW_MARKER) drops the `?` modifier and turns every
  // optional key required — this case is what would catch that regression:
  // the literal omits `b`, which is legal only while `b?` is still optional.
  {
    what: 'DeepMutable preserves optional (?) property modifiers',
    rejected: false,
    code: `const opt: DeepMutable<{ a: number; b?: string }> = { a: 1 }; void opt;`,
  },
  {
    what: 'DeepMutable strips readonly at depth, not just at the top level',
    rejected: false,
    code:
      `const deep: DeepMutable<DeepReadonly<{ a: { b: { c: number[] } } }>> = ` +
      `{ a: { b: { c: [1] } } }; deep.a.b.c.push(2);`,
  },
  {
    what: 'DeepMutable leaves a primitive alone, so the null/primitive passthrough still types',
    rejected: false,
    code: `const prim: number = cloneAsOverride(42); void prim;`,
  },
  {
    what: 'DeepMutable leaves a function alone rather than mapping over its properties',
    rejected: false,
    code: `const fn: DeepMutable<(x: number) => string> = (x) => String(x); void fn;`,
  },
];

/** Line numbers (case indices) that produced a semantic diagnostic. */
function erroringLines(preamble: string): Set<number> {
  const header = `${preamble}\n`;
  const body = CASES.map((c) => c.code).join('\n');
  const source = `${header}${body}\nexport {};\n`;
  const headerLines = header.split('\n').length - 1;

  const VIRTUAL = join(HERE, '__freezeSchemaTypePins.virtual.ts').replace(/\\/g, '/');
  const options: ts.CompilerOptions = {
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
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

  const lines = new Set<number>();
  for (const d of program.getSemanticDiagnostics(sf)) {
    if (d.start == null) continue;
    lines.add(sf.getLineAndCharacterOfPosition(d.start).line - headerLines);
  }
  return lines;
}

const REAL_PREAMBLE =
  `import { defineSystemView, cloneAsOverride } from '${MODULE_IMPORT}';\n` +
  `import type { DeepReadonly, DeepMutable, SystemView } from '${MODULE_IMPORT}';`;

/**
 * The same module with ONE line changed: `cloneAsOverride` redeclared with the
 * signature it carried before this card. Everything else — `DeepMutable`,
 * `DeepReadonly`, `SystemView`, `defineSystemView` — is still the real thing,
 * so a flip here can only be caused by the return type.
 */
const REVERTED_PREAMBLE =
  `import { defineSystemView } from '${MODULE_IMPORT}';\n` +
  `import type { DeepReadonly, DeepMutable, SystemView } from '${MODULE_IMPORT}';\n` +
  `declare const cloneAsOverride: <T>(view: T) => T;`;

// Module scope on purpose (see the header of actionKeys.types.test.ts): the
// compiler cost lands in the import phase rather than under a hook timeout.
const againstReal = erroringLines(REAL_PREAMBLE);
const againstReverted = erroringLines(REVERTED_PREAMBLE);

describe('cloneAsOverride returns a mutable type (objectui#5257)', () => {
  for (const [i, c] of CASES.entries()) {
    it(c.what, () => {
      expect({ case: c.what, rejected: againstReal.has(i) }).toEqual({ case: c.what, rejected: c.rejected });
    });
  }
});

/**
 * Indices that the pre-fix signature turns red. Named explicitly so the file
 * records which assertions actually discriminate — the rest are green on BOTH
 * legs and prove nothing about this change on their own.
 *
 *   0,1,2 — the three mutation cases: the whole defect.
 *   3,4,5 — rejected on both legs (the System View is untouched by the change).
 *   6,7   — clean on both legs: the relaxation is assignable back, which is the
 *           ruling's premise and is exactly what "callers keep compiling" means.
 *   8-11  — DeepMutable's own shape; it does not exist on the pre-fix leg's
 *           `cloneAsOverride`, but the type itself is imported either way, so
 *           these stay clean on both legs by construction.
 */
const EXPECTED_FLIPS = [0, 1, 2];

describe('discrimination: the same cases against the pre-fix signature', () => {
  it('reverting the return type to T is what turns the override flow red', () => {
    const flipped = CASES.map((c, i) => ({ what: c.what, i }))
      .filter(({ i }) => againstReverted.has(i) !== againstReal.has(i))
      .map(({ i }) => i);
    expect(flipped).toEqual(EXPECTED_FLIPS);
  });

  it('every flipped case is one that must COMPILE now and did NOT before', () => {
    for (const i of EXPECTED_FLIPS) {
      expect({ i, now: againstReal.has(i), before: againstReverted.has(i) }).toEqual({
        i,
        now: false,
        before: true,
      });
    }
  });
});

/**
 * The other half of "the type tells the truth about the value": the runtime
 * behaviour the type now describes. These would have passed before the change
 * too — the runtime was never the defect — and they are here so a future edit
 * cannot fix the mismatch by making the RUNTIME readonly instead.
 */
describe('cloneAsOverride runtime behaviour the type now describes', () => {
  it('produces a mutable clone while the source stays frozen', () => {
    const view = defineSystemView({ type: 'list', columns: [{ name: 'email' }] });
    const draft = cloneAsOverride(view);

    draft.columns.push({ name: 'name' });
    expect(draft.columns).toHaveLength(2);
    expect(Object.isFrozen(view)).toBe(true);
    expect(view.columns).toHaveLength(1);
  });

  it('drops the System View marker, so the clone is no longer a System View', () => {
    const view = defineSystemView({ type: 'list', columns: [{ name: 'email' }] });
    const draft = cloneAsOverride(view);

    expect(isSystemView(view)).toBe(true);
    expect(isSystemView(draft)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(draft, SYSTEM_VIEW_MARKER)).toBe(false);
  });
});
