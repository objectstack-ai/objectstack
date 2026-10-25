/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8992 — `userActions` refuses an undeclared key BY NAME, and the
 * mirror carries exactly the protocol's key set.
 *
 * Two facts, one file, because they are the two halves of the same repair.
 *
 * 1. ⭐ THE REFUSAL. `objectql.zod.ts`'s `UserActionsSchema` docblock used to
 *    tell its reader that `UserActionsConfigSchema` "is NOT `.strict()`, so ...
 *    an author writing `userActions: { group: false }` had it silently stripped
 *    — valid on parse, no effect at render". Measured against the published
 *    artifacts of 17.0.0, 17.2.0, 17.3.0 and the resolved 17.4.0, every one of
 *    them REFUSES an undeclared key and NAMES it. A comment promising silent
 *    tolerance in front of a loud-rejection runtime is the worst direction for
 *    a comment to be wrong in: an author — human or AI — who trusts it writes a
 *    config that fails the save gate, having been told that outcome is
 *    impossible. Prose cannot hold that fact down; this file does.
 *
 * 2. THE COLLAPSE. The same card removed the local
 *    `.extend({ group, hideFields, rowColor })`, which existed only because the
 *    protocol did not declare those three. It does since 17.3.0
 *    (objectui#5435's ruling, adopted upstream), so what is asserted here is
 *    that the mirror's key set IS the spec's — DERIVED from
 *    `UserActionsConfigSchema` at assert time, never restated. A restated list
 *    would pass for exactly as long as it happened to agree, which is the drift
 *    the collapse exists to prevent.
 *
 * ⚠️ NOT VACUOUS BY CONSTRUCTION. "Refused" is worthless as an assertion unless
 * the harness is shown to also report ACCEPTED, and "the key sets are equal" is
 * worthless unless the comparison is shown to be able to see a difference. Both
 * firing controls are below, and every population is asserted non-empty before
 * it is used.
 *
 * ⚠️ These three keys are VERSION-BORNE since the collapse: `@object-ui/types`
 * declares `@objectstack/spec: ^17.3.0` and that floor is what carries them
 * (17.2.0 declares 8 keys, 17.3.0 declares 11). If this file ever reddens on
 * `THE_THREE`, the reading is that the resolved spec is below the declared
 * floor — ⛔ not that the mirror regressed.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { UserActionsConfigSchema as SpecUserActionsConfigSchema } from '@objectstack/spec/ui';
import { UserActionsSchema, ListViewSchema } from '../zod/objectql.zod.js';

/** The three toggles objectui's legacy `show*` fold emits (objectui#5435). */
const THE_THREE = ['group', 'hideFields', 'rowColor'] as const;

/** A key no version of the protocol has ever declared on this object. */
const NEVER_DECLARED = 'zzNeverDeclaredByAnySpec';

type Parsed = { success: boolean; error?: { issues?: readonly unknown[] } };

/** Unrecognized-key names a zod result refuses, flattened. */
const refusedKeys = (r: Parsed): string[] =>
  ((r.error?.issues ?? []) as { code?: string; keys?: string[] }[])
    .filter((i) => i.code === 'unrecognized_keys')
    .flatMap((i) => i.keys ?? []);

const issueCount = (r: Parsed): number => (r.error?.issues ?? []).length;

const keysOf = (schema: { shape: Record<string, unknown> }): string[] => Object.keys(schema.shape).sort();

describe('objectui#8992 — the mirror carries the protocol key set, by reference', () => {
  it('the key sets are equal — derived from the spec, not restated here', () => {
    const spec = keysOf(SpecUserActionsConfigSchema as unknown as { shape: Record<string, unknown> });
    expect(spec.length, 'a census over an empty key set passes for the wrong reason').toBeGreaterThan(0);
    expect(keysOf(UserActionsSchema as unknown as { shape: Record<string, unknown> })).toEqual(spec);
  });

  it('FIRING CONTROL — the key-set comparison can see a difference', () => {
    const narrowed = UserActionsSchema.omit({ group: true });
    expect(keysOf(narrowed as unknown as { shape: Record<string, unknown> })).not.toEqual(
      keysOf(UserActionsSchema as unknown as { shape: Record<string, unknown> }),
    );
  });

  it('carries the three the fold emits — the whole premise of the collapse', () => {
    const keys = keysOf(UserActionsSchema as unknown as { shape: Record<string, unknown> });
    for (const key of THE_THREE) {
      expect(keys, `${key} is missing — read the resolved @objectstack/spec, not this mirror`).toContain(key);
    }
  });

  it('authors no default — an empty block stays empty (the objectui#8317 boundary)', () => {
    const r = UserActionsSchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({});
  });

  it('accepts each of the three, both polarities', () => {
    for (const key of THE_THREE) {
      for (const value of [true, false]) {
        const r = UserActionsSchema.safeParse({ [key]: value });
        expect(r.success, `${key}: ${value} was refused`).toBe(true);
        expect(r.success && r.data).toEqual({ [key]: value });
      }
    }
  });
});

describe('objectui#8992 — an undeclared key is REFUSED BY NAME, never dropped', () => {
  it('the refusal names the key, and there is exactly one issue', () => {
    const r = UserActionsSchema.safeParse({ [NEVER_DECLARED]: true });
    expect(r.success, 'silently accepted — the corrected docblock is wrong again').toBe(false);
    expect(refusedKeys(r)).toEqual([NEVER_DECLARED]);
    expect(issueCount(r)).toBe(1);
  });

  it('⛔ it is NOT stripped — the refused key never comes back as parsed output', () => {
    const r = UserActionsSchema.safeParse({ group: false, [NEVER_DECLARED]: true });
    expect(r.success).toBe(false);
    expect(refusedKeys(r)).toEqual([NEVER_DECLARED]);
  });

  it("objectui's own legacy toolbar spelling is refused here too — `showGroup` is not `group`", () => {
    const r = UserActionsSchema.safeParse({ showGroup: true });
    expect(r.success).toBe(false);
    expect(refusedKeys(r)).toEqual(['showGroup']);
  });

  it('FIRING CONTROL — the same harness reports ACCEPTED when the key IS declared', () => {
    const widened = UserActionsSchema.extend({ [NEVER_DECLARED]: z.boolean().optional() });
    const r = widened.safeParse({ [NEVER_DECLARED]: true });
    expect(r.success, 'the harness refuses everything — the refusal above proves nothing').toBe(true);
    expect(refusedKeys(r)).toEqual([]);
  });

  it('the refusal survives to the published face — `ListViewSchema.userActions`', () => {
    const good = ListViewSchema.safeParse({
      type: 'list-view',
      objectName: 'accounts',
      userActions: { group: false, hideFields: true, rowColor: true },
    });
    expect(good.success, 'the three are not authorable through the published list view').toBe(true);

    const bad = ListViewSchema.safeParse({
      type: 'list-view',
      objectName: 'accounts',
      userActions: { [NEVER_DECLARED]: true },
    });
    expect(bad.success).toBe(false);
    expect(refusedKeys(bad)).toEqual([NEVER_DECLARED]);
  });
});
