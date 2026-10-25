/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9964 — the authoring mirror declares `record:related_list`
 * `add.picker.filter` as the protocol's rule ARRAY, not as `unknown`.
 *
 * The defect: `RecordRelatedListComponentProps.add.picker.filter` was
 * `unknown`, while the sole consumer — `@object-ui/plugin-detail`'s
 * `RelatedList`, which hands the value to `RecordPickerDialog`'s `baseFilter`
 * verbatim — had typed the same key `ViewFilterRule[]` on purpose since
 * objectui#3831 ("a looser type here is where a wrong shape would hide"). Two
 * declarations of one key, with the looser one on the face an author (or an AI
 * writing metadata) reads; four `(schema as any).add` reads in that package's
 * `record-related-list` renderer kept any compiler from saying so.
 *
 * ## ⚠️ Why this file drives `tsc` instead of rendering something
 *
 * A RUNTIME test cannot see this defect at all. `unknown` and
 * `ViewFilterRule[]` are the same zero bytes at runtime: the picker receives
 * the same value, the same query goes out, and every behavioural assertion is
 * green on the defect and on the fix ALIKE. Such a pin would prove the repair
 * happened while being incapable of failing if it were reverted. So the
 * property under test is what the COMPILER accepts, and the two legs below
 * both read a compiler:
 *
 *   - the TYPE-LEVEL legs are compiled by `tsc -p tsconfig.test.json` (this
 *     package's `type-check` script) and erased by vitest — they say nothing
 *     under `pnpm test`;
 *   - the DIAGNOSTIC legs compile authored snippets against the real mirror
 *     SOURCE through the TypeScript API and read the diagnostics back, so the
 *     same property also fails under vitest. Same mechanism as
 *     `core`'s `freeze-schema.types.test.ts` and
 *     `scripts/__tests__/js-comment-mask-param-types-9324.test.ts`.
 *
 * NO BUILD ARTIFACT SITS BETWEEN THE EDIT AND THE DIAGNOSTIC LEGS: the virtual
 * case module imports `../record-components` by relative path, so the program
 * reads this package's SOURCE. `@objectstack/spec` resolves through the
 * workspace dependency, which is the published artifact both sides mirror.
 *
 * ## The expectation is DERIVED, not written down
 *
 * The array shape is read off `@objectstack/spec`'s own
 * `RecordRelatedListProps` every run (AGENTS.md #9), so a protocol change moves
 * this pin instead of leaving a restated answer behind to rot.
 *
 * ## Discrimination is built in
 *
 * Every diagnostic case is compiled a SECOND time against the PRE-FIX
 * declaration — the same mirror with `picker.filter` put back to `unknown` and
 * nothing else changed. `EXPECTED_FLIPS` names exactly which cases that
 * reverts; a case outside that set is green on both legs and is stated as such
 * rather than quietly counted as evidence.
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

/** The only assertion form used here — its constraint is what refuses `false`. */
type Expect<T extends true> = T;

/* Direction proofs: a broken instrument makes THIS file red, not green. */

// @ts-expect-error objectui#9964 — `Expect` must refuse `false`. Widen its constraint and this directive goes unused (TS2578).
type _ExpectRefusesFalse = Expect<false>;

// @ts-expect-error objectui#9964 — `any` must NOT read as equal to `true`. That is the exact shape a cast produces.
type _EqualRefusesAny = Expect<Equal<any, true>>;

/** What the MIRROR declares for the key this card is about. */
type MirrorPickerFilter = NonNullable<RecordRelatedListComponentProps['add']>['picker']['filter'];

/** What the CONTRACT declares for it — read off the artifact, not restated. */
type SpecPickerFilter = NonNullable<z.input<typeof RecordRelatedListProps>['add']>['picker']['filter'];

/**
 * ⭐ The card, in type form: the two declarations of one key agree, and the
 * expectation comes from the protocol rather than from this file.
 */
export type _MirrorAgreesWithTheContract = Expect<Equal<MirrorPickerFilter, SpecPickerFilter>>;

/**
 * …and the shape they agree on is the rule ARRAY. Stated separately from the
 * derivation above so a spec that loosened its own key could not make the pair
 * agree on nothing — that would satisfy the leg above while putting `unknown`
 * back on the authoring face.
 */
export type _AndThatShapeIsTheRuleArray = Expect<Equal<MirrorPickerFilter, ViewFilterRule[] | undefined>>;

// @ts-expect-error objectui#9964 — the PRE-FIX declaration, asserted to be WRONG: `unknown` must not satisfy this pin. This directive going unused (TS2578) means the mirror went back to `unknown`.
type _UnknownIsNotTheContract = Expect<Equal<MirrorPickerFilter, unknown>>;

/* ── Diagnostic legs: the same property, read under vitest ─────────────────── */

/** Rooted at THIS file, never at `process.cwd()` — the two differ per invocation. */
const HERE = dirname(fileURLToPath(import.meta.url));
const MIRROR_IMPORT = join(HERE, '..', 'record-components').replace(/\\/g, '/');

/** One authored statement, and whether `tsc` is required to reject it. */
interface Case {
  readonly what: string;
  readonly code: string;
  readonly rejected: boolean;
}

const BASE = `objectName: 'sys_user_position', relationshipField: 'position'`;

const CASES: readonly Case[] = [
  // ── The acceptance criterion ──────────────────────────────────────────────
  // The consumer's own prop type, satisfied straight from the authoring face.
  // This is the TS2322 the four `(schema as any).add` casts were hiding.
  {
    what: 'the declared filter is assignable to the consumer’s `ViewFilterRule[]`',
    rejected: false,
    code: `const rules: ViewFilterRule[] | undefined = block.add?.picker.filter; void rules;`,
  },
  // ── What the tightened face must now REFUSE ───────────────────────────────
  {
    what: 'a rule object missing `field` is refused',
    rejected: true,
    code: `const a: Block = { ${BASE}, add: { picker: { object: 'sys_user', filter: [{ nope: 1 }] } } }; void a;`,
  },
  {
    what: 'a filter EXPRESSION string is refused (the array is the one orthography)',
    rejected: true,
    code: `const b: Block = { ${BASE}, add: { picker: { object: 'sys_user', filter: 'active = true' } } }; void b;`,
  },
  {
    what: 'the retired MongoDB-style record form is refused',
    rejected: true,
    code: `const c: Block = { ${BASE}, add: { picker: { object: 'sys_user', filter: { active: true } } } }; void c;`,
  },
  // ── …and what it must still ACCEPT ────────────────────────────────────────
  // Without this half, "the wrong shapes error" is also satisfied by a face so
  // narrow that the real authored form errors too.
  {
    what: 'the canonical authored rule array still type-checks',
    rejected: false,
    code:
      `const d: Block = { ${BASE}, add: { picker: { object: 'sys_user', ` +
      `filter: [{ field: 'active', operator: 'equals', value: true }] }, linkField: 'user' } }; void d;`,
  },
  // ── Controls: green/red on BOTH legs, so a harness fault is visible ───────
  {
    what: 'CONTROL — a non-string `picker.object` is refused on both legs',
    rejected: true,
    code: `const e: Block = { ${BASE}, add: { picker: { object: 42 } } }; void e;`,
  },
  {
    what: 'CONTROL — an ordinary add config with no filter type-checks on both legs',
    rejected: false,
    code: `const f: Block = { ${BASE}, add: { picker: { object: 'sys_user' }, linkField: 'user' } }; void f;`,
  },
];

/** Case indices that produced a semantic diagnostic under `preamble`. */
function erroringLines(preamble: string): Set<number> {
  const header = `${preamble}\n`;
  const body = CASES.map((c) => c.code).join('\n');
  const source = `${header}${body}\nexport {};\n`;
  const headerLines = header.split('\n').length - 1;

  const VIRTUAL = join(HERE, '__relatedListPickerFilter9964.virtual.ts').replace(/\\/g, '/');
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

const IMPORTS =
  `import type { RecordRelatedListComponentProps } from '${MIRROR_IMPORT}';\n` +
  `import type { ViewFilterRule } from '@objectstack/spec/ui';\n`;

/** The real mirror, under the name the cases annotate against. */
const REAL_PREAMBLE =
  IMPORTS + `type Block = RecordRelatedListComponentProps;\ndeclare const block: Block;`;

/**
 * The same mirror with ONE member put back the way objectui#9964 found it —
 * `picker.filter` as `unknown`. Everything else, including `picker.object`, is
 * still the real declaration, so a flip here can only be caused by that member.
 */
const REVERTED_PREAMBLE =
  IMPORTS +
  `type Block = Omit<RecordRelatedListComponentProps, 'add'> & { add?: { picker: { object: string; valueField?: string; labelField?: string; filter?: unknown }; linkField?: string; label?: string } };\n` +
  `declare const block: Block;`;

// Module scope on purpose: the compiler cost lands in the import phase rather
// than under a hook timeout (the repo's flaky-test discipline).
const againstReal = erroringLines(REAL_PREAMBLE);
const againstReverted = erroringLines(REVERTED_PREAMBLE);

describe('objectui#9964 — the mirror declares the contract’s rule array', () => {
  it('the contract itself declares an optional ARRAY here, so the pin has a subject', () => {
    // Read off the artifact in the same run: an empty or moved population would
    // make every assertion below vacuous.
    const picker = RecordRelatedListProps.shape.add.unwrap().shape.picker;
    expect(Object.keys(picker.shape).sort()).toEqual(['filter', 'labelField', 'object', 'valueField']);
    expect(picker.shape.filter.safeParse([{ field: 'active', operator: 'equals', value: true }]).success).toBe(true);
    // …and it is not an everything-set, which would make the refusals unfalsifiable.
    expect(picker.shape.filter.safeParse({ active: true }).success).toBe(false);
    expect(picker.shape.filter.safeParse('active = true').success).toBe(false);
  });

  for (const [i, c] of CASES.entries()) {
    it(c.what, () => {
      expect({ case: c.what, rejected: againstReal.has(i) }).toEqual({ case: c.what, rejected: c.rejected });
    });
  }
});

/**
 * Indices the PRE-FIX declaration flips. Named explicitly so this file records
 * which assertions actually discriminate — the rest are identical on both legs
 * and prove nothing about this change on their own.
 *
 *   0     — the assignability the four `as any` casts were hiding: TS2322 with
 *           `unknown`, clean with the rule array.
 *   1,2,3 — the three wrong shapes: `unknown` accepts all of them.
 *   4     — the canonical form: accepted on both legs (the narrowing is not too
 *           narrow, which is the half a rejection-only pin cannot state).
 *   5,6   — controls on a member this card never touched.
 */
const EXPECTED_FLIPS = [0, 1, 2, 3];

describe('discrimination: the same cases against the pre-fix `unknown`', () => {
  it('putting `picker.filter` back to `unknown` is what flips them', () => {
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
