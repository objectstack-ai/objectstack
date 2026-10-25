/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-grid` — the DECLARED coarse type of `data` must be the one its
 * contract accepts (objectui#5090).
 *
 * ## What was wrong
 *
 * `GRID_QUERY_INPUTS` declared `{ name: 'data', type: 'array', label: 'Static
 * Data', description: 'Inline rows, …' }`, but the contract is
 * `ObjectGridSchema.data?: ViewData` — the spec's discriminated union on
 * `provider`, four strict OBJECT arms (`object` / `api` / `value` / `schema`),
 * none of them an array. The declaration published the shape of `staticData`,
 * the deprecated alias the objectui#4648 carve-out deliberately refuses to
 * publish, under the canonical key's name.
 *
 * Both halves failed quietly, in opposite directions — objectui#4041's shape,
 * one field over:
 *
 *   - an author following the published declaration wrote `data: [ …rows… ]`,
 *     which the renderer honoured at the time (`getDataConfig`'s `Array.isArray`
 *     branch, removed on objectui#8348) but which `tsc` refuses (`TS2322`,
 *     measured) and `ViewDataSchema` refuses;
 *   - the one form that satisfies both — `{ provider: 'value', items: [...] }` —
 *     drew `type-mismatch` from this repo's own save gate, because
 *     `checkType`'s `'array'` arm (`sdui-parser/src/validate.ts`) accepts only
 *     arrays. The platform reported the only legal write as a type error.
 *
 * ## What these tests pin, and why it is DERIVED
 *
 * The subject is the declaration read out of the registry, never a constant
 * restated here — a test spelling `'object'` on both sides would keep passing
 * through exactly the drift it exists to catch. So the expected arms come from
 * `ViewDataSchema`'s own verdicts: one representative value per coarse arm, in
 * the vocabulary `armAccepts` uses, filtered by what the schema accepts. Either
 * side moving turns the comparison red — a spec release that widens `ViewData`
 * to accept an array, or a declaration that grows an arm the contract rejects.
 * That derivation is the discipline `component-input-union-specimens.test.ts`
 * and `text-input-inputs-spec-parity.test.ts` adopted. It used to be the only
 * gate on this fact; objectui#4971 has since added the repo-wide arm direction to
 * `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`.
 *
 * ⛔ CORRECTED on objectui#8348 — this docblock used to say that the parity gate
 * "judges against `ComponentPropsMap['object-grid'].data`, which is `z.array()`
 * and DISAGREES with the `ViewDataSchema` this file measures — two spec
 * authorities, opposite kinds, filed as objectui#6207". MEASURED on the
 * `@objectstack/spec` this repo now resolves (17.4.0), that is no longer true:
 * the two authorities CONVERGED. `ComponentPropsMap['object-grid'].data` is the
 * `ViewData` union, and its own description names the refusal — "Static inline
 * rows live at `{ provider: 'value', items: [...] }`; the bare-array shortcut is
 * refused — see migration `object-grid-data-view-data-converged`". The two gates
 * agree and are still not redundant: this file measures the contract
 * `ObjectGridSchema` resolves to, the parity gate measures the repo-wide arm
 * direction.
 *
 * ⭐ The renderer's array tolerance is GONE as of objectui#8348 (decision batch
 * #83, 2026-09-08, maintainer verbatim 「8348 以协议为准」 — the contract decides).
 * This paragraph used to read "NOT asserted away here… it stays as back-compat
 * and is objectui#5068's family; what this file forbids is ADVERTISING it". The
 * ruling removed the thing being un-advertised: `getDataConfig` no longer lifts
 * a bare array, so the declaration and the read now say the same thing. This
 * file still owns the DECLARATION half; the behaviour half — a bare array draws
 * nothing and the block queries its object instead — is pinned next door in
 * `gridBareArrayDataRefused-8348.test.tsx`.
 *
 * The compile-time half needs this package's `tsconfig.test.json`
 * (objectui#3181) — without it the `@ts-expect-error` below is erased before
 * vitest runs and proves nothing.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { ViewDataSchema } from '@objectstack/spec/ui';
import type { ObjectGridSchema } from '@object-ui/types';
// Registers `object-grid` and its `view:grid` alias.
import '../index';

/** The two tags this one renderer is published under, sharing one input list. */
const GRID_TAGS = [
  { label: 'object-grid', type: 'object-grid', namespace: undefined },
  { label: 'view:grid', type: 'grid', namespace: 'view' },
] as const;

/**
 * One representative value per coarse arm, in the vocabulary `armAccepts` uses
 * (`packages/sdui-parser/src/validate.ts`).
 *
 * The `object` probe is the INLINE ROWS form specifically — the shape the old
 * declaration was reaching for and got wrong — so a spec rename of `items`
 * empties the derived set and reds this file with a message about the probe
 * rather than silently agreeing with a broken declaration.
 */
const COARSE_ARM_PROBES = [
  ['string', 'users'],
  ['number', 42],
  ['boolean', true],
  ['object', { provider: 'value', items: [{ id: 1 }] }],
  ['array', [{ id: 1 }]],
] as const;

/** The coarse arms the CONTRACT accepts, from the schema's own verdicts. */
const contractAcceptedArms = (): string[] =>
  COARSE_ARM_PROBES.filter(([, value]) => ViewDataSchema.safeParse(value).success).map(
    ([arm]) => arm,
  );

/** The `data` input as the registration publishes it. */
function declaredDataInput(type: string, namespace?: string) {
  const inputs = (ComponentRegistry.getConfig(type, namespace) as any)?.inputs ?? [];
  return inputs.find((i: any) => i?.name === 'data');
}

/** Declared arms, normalised across the single-kind and array forms. */
const declaredArms = (type: string, namespace?: string): string[] => {
  const declared = declaredDataInput(type, namespace)?.type;
  return Array.isArray(declared) ? [...declared] : [declared];
};

describe('object-grid `data` — declaration matches the contract (objectui#5090)', () => {
  it.each(GRID_TAGS)('$label registers and declares a `data` input', ({ type, namespace }) => {
    // Reachability before absence: an unregistered or renamed block would
    // satisfy every assertion below by never resolving an input at all.
    expect(ComponentRegistry.getConfig(type, namespace), `${type} is not registered`).toBeDefined();
    expect(declaredDataInput(type, namespace), `${type} declares no \`data\` input`).toBeDefined();
  });

  it('the contract accepts exactly the object arm (the derivation, stated)', () => {
    // Non-vacuity for everything below: if `ViewDataSchema` stopped resolving
    // through `lazySchema`, or the probe went stale, this set would empty out
    // and the comparison would pass on nothing.
    expect(contractAcceptedArms()).toEqual(['object']);
  });

  it('each of the three providers parses, none of them is an array, and `api` is refused', () => {
    // What makes "the object arm" a real union rather than one accidental
    // shape, and the direct measurement of the card's premise. Since
    // @objectstack/spec 18.0.0-next.1 the view-level `api` provider is retired
    // (objectstack#23160; objectui#12325 removed its readers, objectui#12370
    // installs the release): three providers remain.
    const providers = [
      { provider: 'object', object: 'users' },
      { provider: 'value', items: [{ id: 1 }] },
      { provider: 'schema', schemaId: 'report' },
    ];
    for (const value of providers) {
      expect(ViewDataSchema.safeParse(value).success, `${value.provider} provider`).toBe(true);
      expect(Array.isArray(value)).toBe(false);
    }
    expect(ViewDataSchema.safeParse({ provider: 'api', read: { url: 'https://example.test/rows' } }).success).toBe(false);
  });

  it.each(GRID_TAGS)('$label declares the arms the contract accepts', ({ type, namespace }) => {
    expect(declaredArms(type, namespace)).toEqual(contractAcceptedArms());
  });

  it.each(GRID_TAGS)('$label does not declare the array shorthand', ({ type, namespace }) => {
    // The regression named. `data: [ …rows… ]` is refused by `ViewData`, so
    // declaring the arm would publish a shape `tsc` and the spec both reject —
    // the same reason the objectui#4648 carve-out leaves `staticData` undeclared.
    //
    // ⭐ objectui#8348 — this row used to carry "…is honoured by the renderer as
    // back-compat". It no longer is: the read was corrected to the declaration,
    // not the other way round, so declaration and behaviour agree.
    expect(declaredArms(type, namespace)).not.toContain('array');
    expect(ViewDataSchema.safeParse([{ id: 1 }]).success).toBe(false);
  });

  it('declares one shape across both tags, so the alias cannot drift', () => {
    const [a, b] = GRID_TAGS.map(({ type, namespace }) => declaredArms(type, namespace));
    expect(a).toEqual(b);
  });

  it('is pinned at compile time too', () => {
    // The runtime half above reads a declaration; this half reads the contract
    // the declaration is supposed to describe. Erased before vitest runs — its
    // value is that `tsc -p tsconfig.test.json` compiles it.

    // The inline-rows form the description now teaches must type-check.
    const inlineRows: ObjectGridSchema['data'] = { provider: 'value', items: [{ id: 1 }] };
    expect(inlineRows).toBeDefined();

    // …and the array shorthand must NOT. If `ViewData` ever widens to accept an
    // array, this directive stops suppressing anything and `tsc` fails with
    // "Unused '@ts-expect-error' directive" — which is the tripwire firing:
    // re-derive the declared arms above instead of deleting this line.
    // @ts-expect-error `ViewData` has no array arm — objectui#5090.
    const bareArray: ObjectGridSchema['data'] = [{ id: 1 }];
    expect(bareArray).toBeDefined();
  });
});
