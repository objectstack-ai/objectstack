/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10199 — the authoring face declares `record:related_list`'s
 * TOP-LEVEL `filter` as the protocol's rule ARRAY, not as `any`.
 *
 * The defect: `RecordRelatedListComponentProps.filter` was `any`, while
 * `@objectstack/spec` declares `RecordRelatedListProps.filter` as
 * `z.array(ViewFilterRuleSchema)`. The face an author (or an AI writing
 * metadata) reads therefore said "anything" for a key the protocol constrains,
 * and a fixture in this package authored an array of `[field, op, value]`
 * tuples against it without any compiler noticing.
 *
 * ## What the ruling moved, and what it deliberately left alone
 *
 * Ruled protocol first on objectui#10199: the AUTHORING face carries the
 * protocol's array. The CONSUMER — `@object-ui/plugin-detail`'s `RelatedList` —
 * keeps its `ViewFilterRule[] | FilterNode` union, because the `FilterNode` half
 * is the value `ElementDataSourceGate` composes at RUNTIME (component AND view
 * AND binding) and writes through its own untyped schema copy. That value is
 * not an authorable shape, so the composed AST is one of the shapes this face
 * must now REFUSE. The runtime hand-off it feeds is not typed through this
 * interface and is not pinned here: that half lives with the consumer, in
 * `RelatedList.listFilter.test.tsx` ("accepts the AST node
 * `ElementDataSourceGate` composes, without converting it twice") and in
 * `RecordRelatedListRenderer.elementDataSource.test.tsx` ("hands the composed
 * view-AND-binding filter to the list"). `FilterNode` lives in
 * `@object-ui/core`, which this zero-dependency package cannot import.
 *
 * ## Why this file drives `tsc` instead of rendering something
 *
 * `any` and `ViewFilterRule[]` are the same zero bytes at runtime, so a
 * behavioural test is green on the defect and on the fix alike. The property
 * under test is what the COMPILER accepts, read two ways:
 *
 *   - the TYPE-LEVEL legs (`Expect`, `@ts-expect-error`) are compiled by
 *     `tsc -p tsconfig.test.json` (this package's `type-check` script) and
 *     erased by vitest;
 *   - the DIAGNOSTIC legs compile authored snippets against the real mirror
 *     SOURCE through the TypeScript API and read the diagnostics back, so the
 *     same property also fails under vitest. Same mechanism as
 *     `related-list-add-picker-filter-mirror-9964.test.ts`, the sibling repair
 *     on this interface.
 *
 * ## The expectation is DERIVED, not written down
 *
 * The mirror is compared with `@objectstack/spec`'s own `RecordRelatedListProps`
 * every run (AGENTS.md #9), and every probe the compiler refuses is also handed
 * to the protocol's own parse: the two faces must agree on each one.
 *
 * ## Discrimination is built in
 *
 * Every diagnostic case is compiled a SECOND time against the PRE-FIX
 * declaration (the same mirror with `filter` put back to `any`, nothing else
 * changed). `EXPECTED_FLIPS` names exactly which cases that reverts.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { z } from 'zod';
import { RecordRelatedListProps } from '@objectstack/spec/ui';
import type { ViewFilterRule } from '@objectstack/spec/ui';
import type { RecordRelatedListComponentProps } from '../record-components';

/* ── Type-level legs (compiled by `tsc -p tsconfig.test.json`, erased by vitest) ── */

/** Invariant type equality. `A extends B` is NOT this: `never` and `any` pass that. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The only assertion form used here; its constraint is what refuses `false`. */
type Expect<T extends true> = T;

/* Direction proofs: a broken instrument makes THIS file red, not green. */

// @ts-expect-error objectui#10199 — `Expect` must refuse `false`. Widen its constraint and this directive goes unused (TS2578).
type _ExpectRefusesFalse = Expect<false>;

// @ts-expect-error objectui#10199 — `any` must NOT read as equal to `true`. The pre-fix declaration was exactly `any`.
type _EqualRefusesAny = Expect<Equal<any, true>>;

/** What the MIRROR declares for the key this card is about. */
type MirrorFilter = RecordRelatedListComponentProps['filter'];

/** What the CONTRACT declares for it, read off the artifact rather than restated. */
type SpecFilter = z.input<typeof RecordRelatedListProps>['filter'];

/** ⭐ The ruling, in type form: the authoring face carries the protocol's declaration. */
export type _MirrorAgreesWithTheContract = Expect<Equal<MirrorFilter, SpecFilter>>;

/**
 * …and that declaration is the rule ARRAY. Stated separately so a spec that
 * loosened its own key could not make the pair agree on nothing.
 */
export type _AndThatShapeIsTheRuleArray = Expect<Equal<MirrorFilter, ViewFilterRule[] | undefined>>;

// @ts-expect-error objectui#10199 — the PRE-FIX declaration, asserted to be WRONG. This directive going unused (TS2578) means the face went back to `any`.
type _AnyIsNotTheContract = Expect<Equal<MirrorFilter, any>>;

/** The canonical authored form compiles; the narrowing is not too narrow. */
export const _authoredRuleArray: RecordRelatedListComponentProps = {
  objectName: 'contact',
  relationshipField: 'account_id',
  filter: [{ field: 'stage', operator: 'equals', value: 'won' }],
};

/** The designer's empty list (read as "unauthored" downstream) compiles too. */
export const _authoredEmptyArray: RecordRelatedListComponentProps = {
  objectName: 'contact',
  relationshipField: 'account_id',
  filter: [],
};

export const _composedNodeRefused: RecordRelatedListComponentProps = {
  objectName: 'contact',
  relationshipField: 'account_id',
  // @ts-expect-error objectui#10199 — the composed AST `ElementDataSourceGate` writes at runtime is NOT authorable. Unused (TS2578) = the face was widened to the consumer's union, or went back to `any`.
  filter: ['and', ['stage', '=', 'won'], ['account_id', '=', 'ACC-1']],
};

export const _tupleArrayRefused: RecordRelatedListComponentProps = {
  objectName: 'contact',
  relationshipField: 'account_id',
  // @ts-expect-error objectui#10199 — an array of `[field, op, value]` tuples, the shape `p1-spec-alignment.test.ts` authored while the key was `any`.
  filter: [['active', '=', true]],
};

/* ── Diagnostic legs: the same property, read under vitest ─────────────────── */

/** Rooted at THIS file, never at `process.cwd()`; the two differ per invocation. */
const HERE = dirname(fileURLToPath(import.meta.url));
const MIRROR_IMPORT = join(HERE, '..', 'record-components').replace(/\\/g, '/');

/**
 * One authored statement and whether `tsc` must reject it. `filter`, when set,
 * is the authored VALUE: the snippet is generated from it, and the same value
 * is handed to the protocol's own parse, so the two faces are compared on
 * identical input rather than on two hand-written copies.
 */
interface Case {
  readonly what: string;
  readonly rejected: boolean;
  readonly filter?: unknown;
  readonly code?: string;
}

const BASE = `objectName: 'contact', relationshipField: 'account_id'`;

const CASES: readonly Case[] = [
  // ── What the face must ACCEPT ─────────────────────────────────────────────
  {
    what: 'the canonical authored rule array type-checks',
    rejected: false,
    filter: [{ field: 'stage', operator: 'equals', value: 'won' }],
  },
  // ── What the narrowed face must REFUSE ────────────────────────────────────
  {
    what: 'the composed AST node `ElementDataSourceGate` writes at runtime is refused',
    rejected: true,
    filter: ['and', ['stage', '=', 'won'], ['account_id', '=', 'ACC-1']],
  },
  {
    what: 'an array of `[field, op, value]` tuples is refused (the fixture this card corrected)',
    rejected: true,
    filter: [['active', '=', true]],
  },
  {
    what: 'a MongoDB-style record is refused',
    rejected: true,
    filter: { status: { $ne: 'archived' } },
  },
  {
    what: 'a filter EXPRESSION string is refused',
    rejected: true,
    filter: 'active = true',
  },
  {
    what: 'a single rule object not wrapped in the array is refused',
    rejected: true,
    filter: { field: 'stage', operator: 'equals', value: 'won' },
  },
  {
    what: 'a rule object missing `field` is refused',
    rejected: true,
    filter: [{ operator: 'equals', value: 'won' }],
  },
  // ── The read direction: the declaration now reaches a reader ──────────────
  {
    what: 'a reader can no longer treat the value as a string',
    rejected: true,
    code: `const s: string | undefined = block.filter; void s;`,
  },
  // ── Controls: identical on BOTH legs, so a harness fault is visible ───────
  {
    what: 'CONTROL — the designer’s empty `filter: []` type-checks on both legs',
    rejected: false,
    filter: [],
  },
  {
    what: 'CONTROL — a non-string `relationshipField` is refused on both legs',
    rejected: true,
    code: `const x: Block = { objectName: 'contact', relationshipField: 42 }; void x;`,
  },
  {
    what: 'CONTROL — a block with no filter type-checks on both legs',
    rejected: false,
    code: `const y: Block = { ${BASE}, columns: ['name'] }; void y;`,
  },
];

/** The one-line statement a case compiles to. */
function snippet(c: Case, i: number): string {
  if (c.code !== undefined) return c.code;
  return `const c${i}: Block = { ${BASE}, filter: ${JSON.stringify(c.filter)} }; void c${i};`;
}

/** Case indices that produced a semantic diagnostic under `preamble`. */
function erroringLines(preamble: string): Set<number> {
  const header = `${preamble}\n`;
  const body = CASES.map(snippet).join('\n');
  const source = `${header}${body}\nexport {};\n`;
  const headerLines = header.split('\n').length - 1;

  const VIRTUAL = join(HERE, '__relatedListFilter10199.virtual.ts').replace(/\\/g, '/');
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

const IMPORT = `import type { RecordRelatedListComponentProps } from '${MIRROR_IMPORT}';\n`;

/** The real mirror, under the name the cases annotate against. */
const REAL_PREAMBLE = IMPORT + `type Block = RecordRelatedListComponentProps;\ndeclare const block: Block;`;

/**
 * The same mirror with ONE member put back the way objectui#10199 found it —
 * `filter` as `any`. Everything else is still the real declaration, so a flip
 * here can only be caused by that member.
 */
const REVERTED_PREAMBLE =
  IMPORT +
  `type Block = Omit<RecordRelatedListComponentProps, 'filter'> & { filter?: any };\n` +
  `declare const block: Block;`;

// Module scope on purpose: the compiler cost lands in the import phase rather
// than under a hook timeout (the repo's flaky-test discipline).
const againstReal = erroringLines(REAL_PREAMBLE);
const againstReverted = erroringLines(REVERTED_PREAMBLE);

/** The protocol's own parser for this key, off the installed artifact. */
const specFilter = RecordRelatedListProps.shape.filter;

describe('objectui#10199 — the authoring face declares the contract’s rule array', () => {
  it('the contract itself declares an optional rule ARRAY here, so the pin has a subject', () => {
    // Read off the artifact in the same run: a moved or loosened key would make
    // every refusal below vacuous.
    expect(specFilter.safeParse(undefined).success).toBe(true);
    expect(specFilter.safeParse([{ field: 'stage', operator: 'equals', value: 'won' }]).success).toBe(true);
    // …and it is not an everything-set, which would make the refusals unfalsifiable.
    expect(specFilter.safeParse({ status: { $ne: 'archived' } }).success).toBe(false);
  });

  for (const [i, c] of CASES.entries()) {
    it(c.what, () => {
      expect({ case: c.what, rejected: againstReal.has(i) }).toEqual({ case: c.what, rejected: c.rejected });
    });
  }

  it('every authored VALUE the compiler judges, the protocol’s parse judges the same way', () => {
    // The two faces of one key, compared on identical input: the compiler's
    // ACTUAL verdict (not the case's expectation) against the protocol's parse.
    // A disagreement here is the defect class this card is about, in either
    // direction.
    const judged = CASES.flatMap((c, i) =>
      c.filter === undefined
        ? []
        : [{ case: c.what, tscRejects: againstReal.has(i), specRefuses: !specFilter.safeParse(c.filter).success }],
    );
    expect(judged.length).toBeGreaterThan(0);
    for (const row of judged) expect(row).toEqual({ ...row, specRefuses: row.tscRejects });
  });
});

/**
 * Indices the PRE-FIX declaration flips. Named explicitly so this file records
 * which assertions actually discriminate; the rest are identical on both legs.
 *
 *   0         — the canonical form: accepted on both legs (the narrowing is not
 *               too narrow, which a rejection-only pin cannot state).
 *   1..6      — the six wrong shapes: `any` accepts every one of them.
 *   7         — the read direction: `any` is assignable to a string.
 *   8, 9, 10  — controls on the empty array and on members this card never touched.
 */
const EXPECTED_FLIPS = [1, 2, 3, 4, 5, 6, 7];

describe('discrimination: the same cases against the pre-fix `any`', () => {
  it('putting `filter` back to `any` is what flips them', () => {
    const flipped = CASES.map((_c, i) => i).filter((i) => againstReverted.has(i) !== againstReal.has(i));
    expect(flipped).toEqual(EXPECTED_FLIPS);
  });

  it('each flipped case reads the way the card describes on each leg', () => {
    for (const i of EXPECTED_FLIPS) {
      expect({ i, now: againstReal.has(i), prefix: againstReverted.has(i) }).toEqual({
        i,
        now: CASES[i].rejected,
        prefix: !CASES[i].rejected,
      });
    }
  });
});
