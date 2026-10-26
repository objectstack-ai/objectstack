/**
 * objectui#9473 — {@link resolveRecordSourceConfig}'s `data` PARAMETER says what
 * its `dataArm` contract says, and nothing it decides at runtime moved.
 *
 * ## The contradiction
 *
 * The parameter declared a flat `data?: ViewData` — a discriminated union over
 * four strict OBJECT arms, with no array member — while the same function's
 * docblock, its REQUIRED `dataArm` parameter and its rung-1 predicate
 * (`authoredDataIsOnTheDeclaredArm`, which takes `unknown`) all say the honoured
 * shape DIFFERS PER BLOCK, and `object-calendar`'s published row IS the array
 * arm (`ComponentPropsMap['object-calendar'].data` is `z.array(z.unknown())`,
 * objectui#9239 / ruling objectui#8348). So the declaration refused the one
 * caller the arm exists for. It stayed compilable only because
 * `ObjectCalendar.tsx` cast the member — `schema.data as ViewData | undefined`,
 * in a comment that reported the defect rather than claiming it was fine.
 *
 * ## Two directions, and BOTH are pinned here
 *
 * A typing repair is only a measurement if a caller shape changes verdict. Two
 * do, in opposite directions, and each is the other's control:
 *
 *  1. an ARRAY on the `'array'` arm — refused before, admitted now. This is the
 *     calendar's real authored shape.
 *  2. a `ViewData` PROVIDER BLOCK on the `'array'` arm — admitted before,
 *     refused now. That is the shape `object-calendar`'s row refuses by KIND,
 *     which `os validate` and the save gate refuse and which rung 1 has dropped
 *     to `staticData` since objectui#8348. Its `@ts-expect-error` is what keeps
 *     the repair from being a mere widening: a parameter loosened to `any` or to
 *     `ViewData | unknown[]` turns that directive into an "Unused
 *     '@ts-expect-error' directive" error, so this file cannot pass by
 *     accepting everything.
 *
 * ⚠️ Every pin in the first half is ERASED AT RUNTIME. `vitest` proves nothing
 * about it; `packages/core/tsconfig.test.json` — chained from this package's
 * `type-check` script, which CI's `Type Check` job runs — is the only thing that
 * reads it. The `describe` block at the bottom is the other half: the runtime
 * verdicts this card must NOT have moved, asserted through `as any` so they
 * measure the ladder rather than the declaration.
 */
import { describe, it, expect } from 'vitest';
import type { ViewData } from '@object-ui/types';
import {
  resolveRecordSourceConfig,
  type AuthoredRecordSourceData,
  type RecordSourceDataArm,
} from '../record-source.js';

/* ───────────────────────── compile-time pins ───────────────────────── */

type Assert<T extends true> = T;
/** Invariant type equality — `X extends Y` would call `any` equal to everything. */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false;

export type _ViewDataArmIsViewData = Assert<
  Equal<AuthoredRecordSourceData<'view-data'>, ViewData>
>;
export type _ArrayArmIsUnknownArray = Assert<
  Equal<AuthoredRecordSourceData<'array'>, unknown[]>
>;
export type _UndeclaredArmIsUnknown = Assert<
  Equal<AuthoredRecordSourceData<'undeclared'>, unknown>
>;
/**
 * ⭐ DISTRIBUTIVITY, pinned rather than assumed: a caller holding the arm as a
 * `RecordSourceDataArm` VARIABLE rather than a literal collapses to `unknown`
 * instead of matching no signature at all. This is the property a set of
 * literal-armed overloads would NOT have, and the reason the repair is a
 * conditional type.
 */
export type _UndecidedArmIsUnknown = Assert<
  Equal<AuthoredRecordSourceData<RecordSourceDataArm>, unknown>
>;

const ARRAY_ROW: unknown[] = [{ id: 'v1', name: 'Site visit' }];
const PROVIDER_BLOCK: ViewData = { provider: 'object', object: 'visit' };

/**
 * DIRECTION 1 — the shape the old declaration refused. Spelled the way
 * `ObjectCalendar.tsx` spells it: the three members the ladder documents itself
 * as reading, with `data` on the arm this block's published row declares. On
 * `origin/main` before this card the same three lines needed
 * `schema.data as ViewData | undefined` to compile.
 */
export const arrayOnTheArrayArm = resolveRecordSourceConfig(
  { objectName: 'visit', data: ARRAY_ROW, staticData: undefined },
  'array',
);

/** UNMOVED — the three `'view-data'` blocks declare exactly what they did. */
export const providerBlockOnTheViewDataArm = resolveRecordSourceConfig(
  { objectName: 'visit', data: PROVIDER_BLOCK },
  'view-data',
);

/**
 * DIRECTION 2 — the narrowing half, and the control on direction 1. A
 * `'view-data'` site may still not declare a bare array, which the flat
 * declaration also refused; the pin below is the half that is NEW.
 */
export const arrayOnTheViewDataArm = resolveRecordSourceConfig(
  // @ts-expect-error objectui#9473 — a bare array is not on `object-grid` /
  // `object-map` / `object-gantt`'s published `ViewData` row.
  { objectName: 'visit', data: ARRAY_ROW },
  'view-data',
);

export const providerBlockOnTheArrayArm = resolveRecordSourceConfig(
  // @ts-expect-error objectui#9473 — the `{ provider, items }` PROVIDER BLOCK is
  // not on `object-calendar`'s published `z.array(z.unknown())` row, and rung 1
  // has dropped it through to `staticData` since objectui#8348.
  { objectName: 'visit', data: PROVIDER_BLOCK },
  'array',
);

/**
 * `'undeclared'` admits BOTH, on purpose: no published face declares a `data`
 * row for such a block, so rung 1 keeps its pre-8348 verbatim behaviour and
 * honours any truthy value. ⛔ These two are also the control that the
 * directives above are about the ARM and not about the fixtures — the same two
 * values, same call, no error.
 */
export const arrayOnTheUndeclaredArm = resolveRecordSourceConfig(
  { objectName: 'visit', data: ARRAY_ROW },
  'undeclared',
);
export const providerBlockOnTheUndeclaredArm = resolveRecordSourceConfig(
  { objectName: 'visit', data: PROVIDER_BLOCK },
  'undeclared',
);

/* ───────────────────────── runtime: nothing moved ───────────────────────── */

describe('objectui#9473 — the declaration moved, the RUNTIME accept set did not', () => {
  it('rung 1 still returns an array VERBATIM on the `array` arm', () => {
    const schema = { objectName: 'visit', staticData: [9], data: ARRAY_ROW };
    expect(resolveRecordSourceConfig(schema as any, 'array')).toBe(schema.data);
  });

  it('rung 1 still DROPS a provider block on the `array` arm, to `staticData`', () => {
    const schema = { objectName: 'visit', staticData: [9], data: PROVIDER_BLOCK };
    expect(resolveRecordSourceConfig(schema as any, 'array')).toEqual({
      provider: 'value',
      items: [9],
    });
  });

  it('rung 1 still returns a provider block VERBATIM on the `view-data` arm', () => {
    const schema = { objectName: 'visit', staticData: [9], data: PROVIDER_BLOCK };
    expect(resolveRecordSourceConfig(schema as any, 'view-data')).toBe(schema.data);
  });

  it('rung 1 still DROPS an array on the `view-data` arm, to `staticData`', () => {
    const schema = { objectName: 'visit', staticData: [9], data: ARRAY_ROW };
    expect(resolveRecordSourceConfig(schema as any, 'view-data')).toEqual({
      provider: 'value',
      items: [9],
    });
  });

  it('the `undeclared` arm still honours BOTH shapes verbatim', () => {
    const asArray = { objectName: 'visit', staticData: [9], data: ARRAY_ROW };
    const asBlock = { objectName: 'visit', staticData: [9], data: PROVIDER_BLOCK };
    expect(resolveRecordSourceConfig(asArray as any, 'undeclared')).toBe(asArray.data);
    expect(resolveRecordSourceConfig(asBlock as any, 'undeclared')).toBe(asBlock.data);
  });

  it('⛔ CONTROL: the compile-time pins above are ERASED — these are the same calls', () => {
    // Without this leg the file could pass with a resolver that had stopped
    // resolving: every pin above is a type, and types do not run.
    expect(arrayOnTheArrayArm).toBe(ARRAY_ROW);
    expect(providerBlockOnTheViewDataArm).toBe(PROVIDER_BLOCK);
    expect(arrayOnTheUndeclaredArm).toBe(ARRAY_ROW);
    // The two `@ts-expect-error` calls still RUN, and what they resolve is the
    // off-arm verdict — rung 3, since neither carries `staticData`.
    expect(arrayOnTheViewDataArm).toEqual({ provider: 'object', object: 'visit' });
    expect(providerBlockOnTheArrayArm).toEqual({ provider: 'object', object: 'visit' });
  });
});
