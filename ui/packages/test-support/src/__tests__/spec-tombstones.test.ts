/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * THE TOMBSTONE JUDGE PROVES ITSELF — once, for every gate that imports it
 * (objectui#3809).
 *
 * Two halves, and neither is optional:
 *
 *   - SYNTHETIC fixtures exercise each recognition channel ALONE. The judge
 *     OR-s a structural criterion with a descriptive one precisely so that
 *     breaking one does not go quietly permissive, and a fixture carrying both
 *     (which every real tombstone does) cannot tell whether either still works.
 *     So there is a `never`-typed member with no marker, and a marker-carrying
 *     member that is not `never`, and each must be recognised on its own.
 *   - the REAL `@objectstack/spec` half asks the only question that matters
 *     about the structural criterion: does its verdict equal the CONTRACT'S
 *     behaviour? A tombstone is not "a member that looks odd in the internals",
 *     it is a key the parse rejects BY NAME with the upgrade prescription. So
 *     every key this judge calls a tombstone is fed to `safeParse` and must come
 *     back with an issue AT THAT KEY'S PATH, and a live key must not. That
 *     cross-check is what keeps a Zod-internals rework from silently turning the
 *     probe into a coin flip that every consuming gate then trusts.
 *
 * The real half is deliberately DERIVED, with no key names pinned here. The
 * consuming gates pin their own key sets (`apps/console/src/__tests__/
 * registry-inputs-spec-parity.test.ts`, and until objectui#10859 batch 8
 * retired the alias it judged, `packages/layout/src/__tests__/
 * page-header-authorable-keys.test.tsx`), each against the surface it judges;
 * another copy of those names in this file would only add a place to forget.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ComponentPropsMap, PageComponentType } from '@objectstack/spec/ui';

import {
  RETIRED_DESCRIPTION_PREFIX,
  authorableShapeKeys,
  isShapeKeyTombstoned,
  listedShapeKeys,
  resolvePropsShape,
  shapeMemberTypeName,
  tombstoneEvidence,
  tombstonedShapeKeys,
} from '../spec-tombstones';

/**
 * The shape `retiredKey()` produces, rebuilt here rather than imported.
 *
 * `@objectstack/spec` exports the FACTORY but no predicate, and it does not
 * export the factory from a subpath this repo can reach either — which is the
 * reason this judge exists at all rather than being one upstream call. Rebuilt
 * from the same three calls (`z.never` + `.optional()` + `.describe()` carrying
 * the marker) so the fixture drifts only if upstream changes the construction,
 * which is exactly when a consuming gate wants to hear about it.
 */
const retiredLikeMember = (guidance: string) =>
  z
    .never({ error: () => guidance })
    .optional()
    .describe(`${RETIRED_DESCRIPTION_PREFIX} ${guidance}`);

describe('spec-tombstone judge — synthetic fixtures, one per channel', () => {
  const schema = z.object({
    live: z.string().optional(),
    liveRequired: z.string(),
    // Channel 1 alone: unwrappable to `never`, and NO marker on the description.
    structuralOnly: z.never().optional(),
    // A retirement that never got wrapped in `.optional()`. Not the shape
    // `retiredKey()` builds, but the unwrap step must be a no-op rather than a
    // miss, or a hand-rolled retirement reads as live.
    bareNever: z.never(),
    // Channel 2 alone: a perfectly ordinary string member whose description
    // opens with the marker. Not a real retirement shape — it exists so the
    // descriptive channel is proven to stand without the structural one.
    descriptiveOnly: z.string().optional().describe(`${RETIRED_DESCRIPTION_PREFIX} moved to \`other\`.`),
    // Both channels, as every real tombstone carries them.
    fullyRetired: retiredLikeMember('`fullyRetired` was removed in a later release.'),
  });

  it('recognises a tombstone from the structural channel alone', () => {
    expect(shapeMemberTypeName(schema, 'structuralOnly')).toBe('never');
    expect(tombstoneEvidence(schema, 'structuralOnly')).toEqual({
      listed: true,
      typedNever: true,
      describedRemoved: false,
    });
    expect(isShapeKeyTombstoned(schema, 'structuralOnly')).toBe(true);
    expect(isShapeKeyTombstoned(schema, 'bareNever')).toBe(true);
  });

  it('recognises a tombstone from the descriptive channel alone', () => {
    // The structural half says "live" here, so a judge that AND-ed the two
    // would call this key authorable — the quiet-permissive failure the OR
    // exists to prevent.
    expect(shapeMemberTypeName(schema, 'descriptiveOnly')).not.toBe('never');
    expect(tombstoneEvidence(schema, 'descriptiveOnly')).toEqual({
      listed: true,
      typedNever: false,
      describedRemoved: true,
    });
    expect(isShapeKeyTombstoned(schema, 'descriptiveOnly')).toBe(true);
  });

  it('leaves a live key alone, in both channels', () => {
    for (const key of ['live', 'liveRequired']) {
      expect(tombstoneEvidence(schema, key), `${key} reads as retired`).toEqual({
        listed: true,
        typedNever: false,
        describedRemoved: false,
      });
      expect(isShapeKeyTombstoned(schema, key)).toBe(false);
    }
    // …and the type probe reads a REAL type for them, which is the non-vacuity
    // half: a reader returning `undefined` for everything would also "not say
    // never" and would pass the lines above while seeing nothing.
    expect(shapeMemberTypeName(schema, 'live')).toBe('string');
    expect(shapeMemberTypeName(schema, 'liveRequired')).toBe('string');
  });

  it('subtracts exactly the tombstones, and keeps the listed set intact', () => {
    expect(listedShapeKeys(schema).sort()).toEqual([
      'bareNever',
      'descriptiveOnly',
      'fullyRetired',
      'live',
      'liveRequired',
      'structuralOnly',
    ]);
    expect(tombstonedShapeKeys(schema).sort()).toEqual([
      'bareNever',
      'descriptiveOnly',
      'fullyRetired',
      'structuralOnly',
    ]);
    expect(authorableShapeKeys(schema).sort()).toEqual(['live', 'liveRequired']);
  });

  it('reports a key the shape does not list as absent, not as retired', () => {
    // The distinction a pin-difference reader depends on: "this release never
    // heard of the key" is not "this release rejects the key by name".
    expect(tombstoneEvidence(schema, 'neverExisted')).toEqual({
      listed: false,
      typedNever: false,
      describedRemoved: false,
    });
    expect(isShapeKeyTombstoned(schema, 'neverExisted')).toBe(false);
    expect(listedShapeKeys(schema)).not.toContain('neverExisted');
  });

  it('resolves the thunk and internals spellings, and reports failure as null', () => {
    const shape = { live: z.string() };
    // `lazySchema()`-wrapped spec entries hand over `.shape` as a THUNK.
    expect(Object.keys(resolvePropsShape({ shape: () => shape }) ?? {})).toEqual(['live']);
    expect(Object.keys(resolvePropsShape({ _def: { shape } }) ?? {})).toEqual(['live']);
    expect(Object.keys(resolvePropsShape({ def: { shape } }) ?? {})).toEqual(['live']);
    // A schema this reader cannot read is `null` — distinguishable from a real
    // empty shape, which is what stops a broken probe reading as "no keys".
    expect(resolvePropsShape(undefined)).toBeNull();
    expect(resolvePropsShape({ notAShape: 1 })).toBeNull();
    expect(resolvePropsShape(z.string())).toBeNull();
    expect(resolvePropsShape(z.object({}))).toEqual({});
    // …and the key-listing wrapper flattens that to `[]`, which every consumer
    // pairs with its own non-vacuity assertion.
    expect(listedShapeKeys(undefined)).toEqual([]);
  });
});

describe('spec-tombstone judge — against the installed @objectstack/spec', () => {
  /**
   * Every `(type, key)` this judge calls a tombstone across `ComponentPropsMap`.
   *
   * Derived, and the premise assertion below is what keeps it honest: the day
   * upstream retires keys by DELETING them, this list empties and every
   * tombstone filter in the repo starts narrowing nothing. That must fail here
   * — loudly, in the one file whose subject is the judge — rather than pass as
   * dead code in each consuming gate.
   */
  const found = Object.keys(ComponentPropsMap)
    .flatMap((type) =>
      tombstonedShapeKeys(ComponentPropsMap[type as keyof typeof ComponentPropsMap]).map(
        (key) => [type, key] as const,
      ),
    )
    .sort();

  it('finds tombstones at all — the premise every consuming gate stands on', () => {
    expect(Object.keys(ComponentPropsMap).length).toBeGreaterThan(0);
    expect(
      found.length,
      'no ADR-0087 D2 tombstone anywhere in ComponentPropsMap: either the pin predates every ' +
        'retirement, or upstream now DELETES retired keys — in which case every tombstone filter ' +
        'in this repo (see the module docblock) is dead code and must be reviewed, not kept',
    ).toBeGreaterThan(0);
  });

  it('both channels agree on every tombstone the installed spec carries', () => {
    // Recognition is an OR by design, so disagreement does not break a gate —
    // it means one channel moved, and the next change to touch it deserves to
    // know which. Named per key rather than counted, because "seven of eight"
    // is not a fact anyone can act on.
    const disagreements = found
      .map(([type, key]) => [type, key, tombstoneEvidence(ComponentPropsMap[type as keyof typeof ComponentPropsMap], key)] as const)
      .filter(([, , evidence]) => evidence.typedNever !== evidence.describedRemoved)
      .map(([type, key, evidence]) => `${type}.${key} (never=${evidence.typedNever}, marked=${evidence.describedRemoved})`);
    expect(disagreements).toEqual([]);
  });

  it('the contract itself rejects every key this judge calls a tombstone', () => {
    // THE cross-check: the structural criterion is an internals read, and this
    // is the only assertion that ties it to observable behaviour. A tombstone
    // rejects EVERY value, so one sentinel is enough — and the verdict is read
    // per KEY PATH rather than from `success`, because these schemas have
    // required members of their own and a whole-parse failure would prove
    // nothing about the key under test.
    const issuePaths = (type: string, payload: Record<string, unknown>): string[] => {
      const result = ComponentPropsMap[type as keyof typeof ComponentPropsMap].safeParse(payload);
      return result.success ? [] : result.error.issues.map((issue) => String(issue.path[0]));
    };

    for (const [type, key] of found) {
      expect(
        issuePaths(type, { [key]: 'tombstone-probe' }),
        `${type}.${key} reads as a tombstone but the contract raised no issue on it`,
      ).toContain(key);
    }

    // The control, and it is not optional: a probe that reported an issue for
    // EVERY key would satisfy the loop above while proving nothing. An
    // authorable key of the same schema, carrying a value it accepts, must come
    // back clean at its own path.
    //
    // The control type is SEARCHED for rather than taken as `found[0]`: a
    // WHOLLY retired block (see the narrowing test below) has no authorable key
    // to offer, so pinning the control to whichever type sorts first made this
    // assertion depend on alphabetical order. `@objectstack/spec` 17.1.0 made
    // that concrete — `element:filter` retired entirely and sorts first
    // (objectui#5328). Any type carrying both a tombstone and an authorable
    // string key serves the control equally well.
    const control = found
      .map(([type]) => type)
      .map((type) => {
        const schema = ComponentPropsMap[type as keyof typeof ComponentPropsMap];
        return [type, authorableShapeKeys(schema).find((key) => shapeMemberTypeName(schema, key) === 'string')] as const;
      })
      .find(([, key]) => key !== undefined);
    expect(
      control,
      'no tombstoned block has an authorable string key to use as a control — every candidate ' +
        'is wholly retired, so the cross-check below would prove nothing',
    ).toBeTruthy();
    const [controlType, controlKey] = control as readonly [string, string];
    expect(
      issuePaths(controlType, { [controlKey as string]: 'a string' }),
      `${controlType}.${controlKey} is authorable and string-typed, yet the contract rejected it`,
    ).not.toContain(controlKey);
  });

  it('narrows the authorable set on every block that carries a tombstone', () => {
    for (const [type] of found) {
      const schema = ComponentPropsMap[type as keyof typeof ComponentPropsMap];
      expect(
        authorableShapeKeys(schema).length,
        `${type} authorable set did not narrow below its listed set`,
      ).toBeLessThan(listedShapeKeys(schema).length);
      // Not narrowed to nothing — but only for a block the spec still OFFERS.
      // The reasoning was "a block whose every key read as retired would be a
      // broken probe, not a retired block", and `@objectstack/spec` 17.1.0
      // supplied the case that separates the two: `element:filter` left
      // `PageComponentType` altogether while its props schema stayed in
      // `ComponentPropsMap` with every key tombstoned (objectui#5328). That is a
      // retired BLOCK, and reading zero authorable keys off it is the correct
      // answer rather than a broken probe — the tombstones are how a consumer
      // pinned to the old enum still gets told the block is gone.
      //
      // So the floor is asserted where it still discriminates: a type the enum
      // continues to offer must keep at least one authorable key, because THAT
      // is the shape a broken probe would produce.
      const stillOffered = (PageComponentType.options as readonly string[]).includes(type);
      if (stillOffered) {
        expect(
          authorableShapeKeys(schema).length,
          `${type} is still offered by PageComponentType yet has no authorable key left`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
