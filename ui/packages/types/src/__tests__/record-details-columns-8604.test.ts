/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8604 — the BODY-WIDE `RecordDetailsComponentProps.columns` is the
 * contract's string enum, and `sections[].columns` one level down is still a
 * number. One word, two types, one level apart.
 *
 * The defect: this package declared the top-level key as `columns?: number`,
 * while `@objectstack/spec` declares it `z.enum(['1','2','3','4'])`. So
 * `{ columns: 2 }` type-checked here and was refused at publish with
 * `invalid_value` — a green local build and a rejection at the only point that
 * matters. Direction is contract-first (Commandment #0.1, and triage's ruling
 * on the card): the code moves to the contract, the contract is not widened.
 *
 * ⚠️ The near-miss this file exists to make un-repeatable: `sections[].columns`
 * is `z.number().int().min(1).max(4)`, so `number` is CORRECT there — verified
 * key-for-key on objectui#8583 / PR #8601. A fix that copied either
 * declaration onto the other would be refused at publish in the opposite
 * direction. Both levels are pinned below, in both directions, so a future
 * "consistency" edit that unifies them turns this file red.
 *
 * Two instruments, deliberately:
 *   - `tsc` sees the `@ts-expect-error` legs and the `Equal` assertions. Those
 *     are the half that reaches a TypeScript author, and they mean nothing
 *     unless `type-check` runs — vitest strips types.
 *   - vitest runs the `safeParse` legs against the INSTALLED published spec
 *     artifact, each with a control that would have fired.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { RecordDetailsProps } from '@objectstack/spec/ui';
import type { RecordDetailsComponentProps } from '../record-components';

/** What an author writes for the spec's `record:details` props bag. */
type SpecProps = z.input<typeof RecordDetailsProps>;

/** One authored `sections[]` entry, on each of the two faces. */
type Section = NonNullable<RecordDetailsComponentProps['sections']>[number];
type SpecSection = NonNullable<SpecProps['sections']>[number];

/** Invariant type equality. `A extends B` is NOT this: `never` and `any` pass that. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/** The only assertion form used here — its constraint is what refuses `false`. */
type Expect<T extends true> = T;

/* ── Direction proofs: a broken instrument makes THIS file red ─────────────── */

// @ts-expect-error objectui#8604 — `Expect` must refuse `false`. Widen its constraint and this directive goes unused (TS2578).
type _ExpectRefusesFalse = Expect<false>;

// @ts-expect-error objectui#8604 — `never` must NOT read as equal to `true`. An `extends`-shaped comparison would let it through.
type _EqualRefusesNever = Expect<Equal<never, true>>;

// @ts-expect-error objectui#8604 — `any` must NOT read as equal to `true`, for the same reason.
type _EqualRefusesAny = Expect<Equal<any, true>>;

/* ── The fix: the top-level key carries the contract's own authoring type ──── */

/** RED before objectui#8604 (`number` vs the string enum), green after. */
type _TopLevelColumns = Expect<
  Equal<RecordDetailsComponentProps['columns'], SpecProps['columns']>
>;

/** The per-section key was already right, and must stay right. */
type _SectionColumns = Expect<Equal<Section['columns'], SpecSection['columns']>>;

/**
 * The near-miss, asserted as a NON-equality: the two `columns` are different
 * types. A future edit that "makes them consistent" — in either direction —
 * turns this line red before it can reach publish.
 */
type _TwoLevelsDisagree = Expect<
  Equal<Equal<RecordDetailsComponentProps['columns'], Section['columns']>, false>
>;

/* ── Literals: what a TypeScript author can and cannot write ───────────────── */

/** The contract's spelling compiles. */
const bodyWidthAccepted: RecordDetailsComponentProps = { columns: '2' };

/**
 * The card's repro. `2` compiled before objectui#8604 and was refused at
 * publish; now `tsc` refuses it here, which is the whole point of the change.
 * Revert the narrowing and this directive goes unused (TS2578).
 */
const bodyWidthNumberRefused: RecordDetailsComponentProps = {
  // @ts-expect-error objectui#8604 — the body-wide `columns` is `'1'|'2'|'3'|'4'`, never the number `2`.
  columns: 2,
};

/** The section key takes the number, and refuses the string — the inverse. */
const sectionWidthAccepted: RecordDetailsComponentProps = {
  sections: [{ fields: ['phone'], columns: 2 }],
};

const sectionWidthStringRefused: RecordDetailsComponentProps = {
  // @ts-expect-error objectui#8604 — `sections[].columns` is `number`; the string spelling belongs to the body-wide key only.
  sections: [{ fields: ['phone'], columns: '2' }],
};

/** A value outside the closed set is refused on both faces. */
const bodyWidthOutOfRange: RecordDetailsComponentProps = {
  // @ts-expect-error objectui#8604 — `'5'` is outside the contract's closed set.
  columns: '5',
};

describe('objectui#8604 — record:details `columns`, both levels, against the installed spec', () => {
  it('the PREMISE: the two levels really are declared with different primitive types', () => {
    // Read off the live schema object rather than transcribed, so a spec that
    // converges the two spellings fails HERE first — before the pins below
    // start asserting a shape the contract no longer has.
    const body = RecordDetailsProps.safeParse({ columns: '3' });
    const section = RecordDetailsProps.safeParse({ sections: [{ fields: ['a'], columns: 3 }] });
    expect(body.success).toBe(true);
    expect(section.success).toBe(true);

    // And each refuses the other's spelling. Without this half, "different
    // types" would be satisfied by a contract that accepted both everywhere.
    expect(RecordDetailsProps.safeParse({ columns: 3 }).success).toBe(false);
    expect(
      RecordDetailsProps.safeParse({ sections: [{ fields: ['a'], columns: '3' }] }).success,
    ).toBe(false);
  });

  it("the body-wide key refuses the NUMBER with `invalid_value` at `columns` — the card's repro", () => {
    const refused = RecordDetailsProps.safeParse({ columns: 2 });
    expect(refused.success).toBe(false);
    const issue = refused.error?.issues.find((i) => i.path.join('.') === 'columns');
    expect(issue).toBeDefined();
    expect(issue?.code).toBe('invalid_value');

    // THE CONTROL, on the same instrument: the string the contract declares
    // parses green and its value survives. A refusal with no control that
    // would have fired is not a measurement — it is also what a schema that
    // refused everything would produce.
    const accepted = RecordDetailsProps.safeParse({ columns: '2' });
    expect(accepted.success).toBe(true);
    expect(accepted.data?.columns).toBe('2');
    expect(typeof accepted.data?.columns).toBe('string');
  });

  it('the body-wide key is a CLOSED set, and omitting it applies the schema default', () => {
    expect(RecordDetailsProps.safeParse({ columns: '5' }).success).toBe(false);
    expect(RecordDetailsProps.safeParse({ columns: '1' }).success).toBe(true);
    expect(RecordDetailsProps.safeParse({ columns: '4' }).success).toBe(true);

    // `.default('2')` — an omitted key is not an absent one downstream, which
    // is why the input face is optional while the output face is not.
    const omitted = RecordDetailsProps.safeParse({});
    expect(omitted.success).toBe(true);
    expect(omitted.data?.columns).toBe('2');
  });

  it('`sections[].columns` takes the NUMBER, refuses the string, and bounds 1-4', () => {
    const accepted = RecordDetailsProps.safeParse({ sections: [{ fields: ['phone'], columns: 2 }] });
    expect(accepted.success).toBe(true);
    expect(accepted.data?.sections?.[0]?.columns).toBe(2);

    const stringRefused = RecordDetailsProps.safeParse({
      sections: [{ fields: ['phone'], columns: '2' }],
    });
    expect(stringRefused.success).toBe(false);
    const issue = stringRefused.error?.issues.find(
      (i) => i.path.join('.') === 'sections.0.columns',
    );
    expect(issue?.code).toBe('invalid_type');

    // The range, so "number" is not mistaken for "any number".
    expect(
      RecordDetailsProps.safeParse({ sections: [{ fields: ['phone'], columns: 5 }] }).success,
    ).toBe(false);
    expect(
      RecordDetailsProps.safeParse({ sections: [{ fields: ['phone'], columns: 0 }] }).success,
    ).toBe(false);
  });

  it('the literals above are real values, not type-only decoration', () => {
    // vitest strips types, so these expectations are NOT the assertion — the
    // annotations are. They exist so the file also fails visibly if the
    // literals are ever silently emptied out.
    expect(bodyWidthAccepted.columns).toBe('2');
    expect(bodyWidthNumberRefused.columns as unknown).toBe(2);
    expect(bodyWidthOutOfRange.columns as unknown).toBe('5');
    expect(sectionWidthAccepted.sections?.[0]?.columns).toBe(2);
    expect(sectionWidthStringRefused.sections?.[0]?.columns as unknown).toBe('2');
  });
});
