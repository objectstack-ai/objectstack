/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `headerColor` has ONE vocabulary across the three ends that declare it
 * (objectui#6594, maintainer ruling A of 2026-08-26 recorded at
 * objectstack#12126).
 *
 * ## The ends, and why a pin rather than a shared constant
 *
 *   1. `@object-ui/plugin-detail`'s `HEADER_COLOR_CLASSES` — the RESOLVER. It
 *      decides which class reaches the DOM (objectui#6178).
 *   2. `@object-ui/types`' `DetailViewSection.headerColor` — the TypeScript
 *      declaration an author writes against.
 *   3. `@object-ui/types/zod`'s `DetailViewSectionSchema.headerColor` — the
 *      published validator that judges authored metadata at parse time.
 *
 * The three cannot share one constant. `@object-ui/types` is the protocol layer
 * and carries no dependency on any renderer (AGENTS.md §3: "Zero deps"), so the
 * arrow can only run plugin-detail -> types, never back; and `../views.ts` is a
 * TYPE-ONLY module, so a tuple lifted into it to feed both halves of the mirror
 * would add a runtime export to the package barrel and a runtime import edge
 * from the zod entry into `views.js`. This file buys the same "cannot drift"
 * property from the direction that is legal: this package already devDepends on
 * `@object-ui/types`, so it can see all three ends at once.
 *
 * ## The oracle is the ruling, not today's tree
 *
 * {@link RULED_VOCABULARY} is the maintainer's six tokens, written out here so
 * that all three ends are compared against a FIXED point rather than against
 * each other. Comparing ends pairwise would go green on a coordinated edit that
 * moved every end off the ruling together; comparing each end to the ruling
 * cannot. That is the opposite of the hand-maintained key list
 * `zod-mirror-parity.test.ts` warns about — a ledger there tracks drift that
 * exists, this is a decision that has been made.
 *
 * ## What is deliberately NOT declared
 *
 * `headerColorClass` also hands a value that is ALREADY a complete `bg-*` class
 * straight through. The ruling rejected declaring that pass-through: it renders
 * only where the host app's Tailwind build happens to emit that class, so a
 * declaration would promise a capability the contract cannot keep. `bg-accent`
 * is therefore pinned below as a value the RESOLVER accepts and both halves of
 * the contract refuse — the asymmetry is the ruling, not an oversight.
 */

import { describe, it, expect } from 'vitest';
import type { DetailViewSection } from '@object-ui/types';
import { DetailViewSectionSchema } from '@object-ui/types/zod';

import { headerColorClass, headerColorVocabulary } from '../headerColor';

/* ── Type-level helpers (the idiom of `zod-mirror-parity.test.ts`) ─────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
export type Expect<T extends true> = T;

/* ── The oracle ───────────────────────────────────────────────────────────── */

/**
 * The ruled vocabulary, verbatim from objectstack#12126 comment 5419726057:
 * `z.enum` over "the six tokens objectui#6294 ships … and the `@object-ui/types`
 * mirror narrows to match."
 */
const RULED_VOCABULARY = [
  'muted',
  'muted/50',
  'accent',
  'primary/10',
  'secondary/10',
  'destructive/10',
] as const;

type RuledToken = (typeof RULED_VOCABULARY)[number];

/* ── The comparator, shown to fail in both directions ─────────────────────── */

/**
 * Reconcile one end's vocabulary against another: what each side has and the
 * other does not.
 *
 * Factored out and driven by synthetic inputs below rather than asserted inline,
 * for the reason `zod-mirror-parity.test.ts` gives for exporting its own
 * reconciler: a run over TODAY's tree can only ever show that today's tree is
 * green, and a comparison that has never been shown to FAIL is indistinguishable
 * from no comparison. The recognition suite pins both directions.
 */
export function reconcileVocabularies(
  actual: readonly string[],
  expected: readonly string[],
): { missing: string[]; extra: string[]; duplicated: string[] } {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    missing: expected.filter((token) => !actualSet.has(token)),
    extra: actual.filter((token) => !expectedSet.has(token)),
    duplicated: actual.filter((token, i) => actual.indexOf(token) !== i),
  };
}

const AGREES = { missing: [], extra: [], duplicated: [] };

describe('headerColor pin — recognition: the comparator fails in both directions', () => {
  it('is silent when the two vocabularies agree', () => {
    expect(reconcileVocabularies(['a', 'b'], ['b', 'a'])).toEqual(AGREES);
  });

  it('names a token the end is MISSING (a token added to the oracle alone)', () => {
    expect(reconcileVocabularies(['a'], ['a', 'b'])).toEqual({
      missing: ['b'],
      extra: [],
      duplicated: [],
    });
  });

  it('names a token the end has EXTRA (a token added to that end alone)', () => {
    expect(reconcileVocabularies(['a', 'b'], ['a'])).toEqual({
      missing: [],
      extra: ['b'],
      duplicated: [],
    });
  });

  it('names a token declared twice, which a set comparison alone would hide', () => {
    expect(reconcileVocabularies(['a', 'a'], ['a'])).toEqual({
      missing: [],
      extra: [],
      duplicated: ['a'],
    });
  });
});

/* ── End 1: the resolver ──────────────────────────────────────────────────── */

describe('headerColor pin — the resolver carries exactly the ruled vocabulary', () => {
  it('matches HEADER_COLOR_CLASSES one-to-one', () => {
    expect(reconcileVocabularies(Object.keys(headerColorVocabulary), RULED_VOCABULARY)).toEqual(
      AGREES,
    );
  });

  it('resolves every ruled token to a class, and only complete literals', () => {
    for (const token of RULED_VOCABULARY) {
      const resolved = headerColorClass(token);
      expect(resolved, `${token} should resolve to a class`).toBeDefined();
      expect(resolved).toBe(`bg-${token}`);
    }
  });
});

/* ── End 2: the published TypeScript declaration ──────────────────────────── */

/**
 * The declaration accepts the ruled vocabulary and NOTHING else.
 *
 * Invariant equality, so this fails in both directions: a seventh token added to
 * `views.ts` alone, or one of the six dropped from it, both stop the two sides
 * being mutually assignable. A widening back to `string` fails here first.
 */
export type assertionDeclarationIsTheRuledVocabulary = Expect<
  Equal<NonNullable<DetailViewSection['headerColor']>, RuledToken>
>;

/** …and the key stays optional, which the equality above deliberately strips. */
export type assertionDeclarationStaysOptional = Expect<
  Equal<DetailViewSection['headerColor'], RuledToken | undefined>
>;

/* ── End 3: the published validator ───────────────────────────────────────── */

/** The mirror's declared options, read from its own shape — never restated. */
function declaredEnumOptions(): string[] {
  const member = DetailViewSectionSchema.shape.headerColor;
  const unwrapped = (member as { unwrap?: () => unknown }).unwrap?.() ?? member;
  const options = (unwrapped as { options?: unknown }).options;
  expect(
    Array.isArray(options),
    'DetailViewSectionSchema.headerColor should be an enum with declared options — a widening back to z.string() lands here',
  ).toBe(true);
  return [...(options as string[])];
}

/** A section that is otherwise valid, so only `headerColor` decides the verdict. */
function sectionWith(headerColor: unknown): Record<string, unknown> {
  return { fields: [{ name: 'amount' }], headerColor };
}

describe('headerColor pin — the validator carries exactly the ruled vocabulary', () => {
  it('declares the six as an enum, one-to-one with the ruling', () => {
    expect(reconcileVocabularies(declaredEnumOptions(), RULED_VOCABULARY)).toEqual(AGREES);
  });

  it('parses every ruled token green', () => {
    for (const token of RULED_VOCABULARY) {
      const result = DetailViewSectionSchema.safeParse(sectionWith(token));
      expect(result.success, `${token} should parse: ${JSON.stringify(result.error?.issues)}`).toBe(
        true,
      );
    }
  });

  it('still accepts a section that omits the key', () => {
    expect(DetailViewSectionSchema.safeParse({ fields: [{ name: 'amount' }] }).success).toBe(true);
  });

  it('refuses a string outside the vocabulary, naming `headerColor` in the path', () => {
    const result = DetailViewSectionSchema.safeParse(sectionWith('blue-100'));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('headerColor');
  });
});

/* ── The undeclared pass-through, pinned as an asymmetry on purpose ───────── */

/**
 * `bg-accent` is the shape of value the resolver hands through verbatim. Both
 * halves of the contract refuse it, and that is the ruling: option B (declaring
 * the pass-through) was rejected as a capability illusion, because whether the
 * class renders depends on the host app's Tailwind build rather than on anything
 * this workspace ships.
 *
 * If someone later declares it, the `@ts-expect-error` below becomes an unused
 * directive and `tsc` fails — so the ruling cannot be reversed silently on the
 * type side either.
 */
const passThroughSection: DetailViewSection = {
  fields: [],
  // @ts-expect-error — deliberately undeclared: the resolver's `bg-*` pass-through
  // is a renderer affordance, not part of the contract (objectstack#12126 ruling A).
  headerColor: 'bg-accent',
};

describe('headerColor pin — the `bg-*` pass-through stays UNDECLARED', () => {
  it('is resolved by the renderer', () => {
    expect(headerColorClass('bg-accent')).toBe('bg-accent');
  });

  it('is refused by the validator', () => {
    const result = DetailViewSectionSchema.safeParse(passThroughSection);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('headerColor');
  });

  it('is absent from the resolver vocabulary, so nothing offers it as a token', () => {
    expect(Object.keys(headerColorVocabulary)).not.toContain('bg-accent');
  });
});
