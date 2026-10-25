/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `ObjectDataTableSchema.dataProvider` is an ADR-0049
 * RETIREMENT TOMBSTONE on both faces (objectui#7353, ruling 5809008870).
 *
 * The member was declared as `{ provider: string; object?: string }` and read by
 * nothing: the two dashboard producers copied the widget's provider config onto
 * the node beside `objectName`, and `ObjectDataTable` reads `objectName`. The
 * ruling removed the three writes and the typed declaration, and added no
 * reader. The producer half is pinned in `plugin-dashboard`
 * (`widgetDataProviderRetired-7353.test.tsx`); this file pins the carrier.
 *
 * ## Why a tombstone and not a deletion — the carrier decides
 *
 * `ObjectDataTableSchema` survives the retirement and extends `BaseSchema`:
 * `.passthrough()` on the zod face, and `[key: string]: any` on the TS face
 * until objectui#8347. On such a carrier a DELETED optional member was absorbed
 * silently at any value (the zod face still keeps one) —
 * measured on this branch before the tombstone: an authored `dataProvider`
 * parsed green and was KEPT on the parsed value, and a malformed one that the
 * typed member used to refuse parsed green too. That is the silent no-op the
 * retirement exists to end. The discriminator (objectui#5941, #7526, as
 * amended by objectui#7678) licenses a `?: never` tombstone on a surviving
 * carrier when it steers authors to a named live replacement key — prong 1,
 * here `objectName`. A tombstone refuses; it reads nothing, so the ruling's
 * "no reader is added" holds.
 *
 * The `@ts-expect-error` directives are REAL enforcement: this package
 * type-checks its tests through `tsconfig.test.json`, which its `type-check`
 * script chains. A green vitest run says nothing about them.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import type { ObjectDataTableSchema } from '../objectql';
import { ObjectDataTableSchema as ObjectDataTableZod, safeValidateSchema } from '../zod/index.zod';

/* ── type-level pins: the `tsc` channel ──────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * `?: never` without `exactOptionalPropertyTypes` reads as `undefined`. `Equal`
 * separates that from the `any` a DELETION leaves on this carrier and from the
 * typed shape the member used to carry, so this row reddens on either.
 */
export type assertionDataProviderIsATombstone = Expect<Equal<ObjectDataTableSchema['dataProvider'], undefined>>;
/** Non-vacuity twin: the key the widget reads keeps its real type. */
export type assertionObjectNameStaysLive = Expect<Equal<ObjectDataTableSchema['objectName'], string | undefined>>;

/** Every issue path in the tree, including a Zod 4 union's per-arm `errors`. */
function issuePaths(result: ReturnType<typeof safeValidateSchema>): string[] {
  if (result.success) return [];
  const out: string[] = [];
  const walk = (issues: readonly z.core.$ZodIssue[]) => {
    for (const issue of issues) {
      out.push(issue.path.map(String).join('.'));
      const nested = (issue as { errors?: readonly (readonly z.core.$ZodIssue[])[] }).errors;
      if (nested) for (const arm of nested) walk(arm);
    }
  };
  walk(result.error.issues);
  return out;
}

const WELL_FORMED = { provider: 'object', object: 'contact' };
const MALFORMED = { provider: 42 };

describe('objectui#7353 — the TS face refuses an authored dataProvider', () => {
  it('authoring the key is a compile error, well-formed or not; an undeclared key still compiles', () => {
    const wellFormed: ObjectDataTableSchema = {
      type: 'object-data-table',
      objectName: 'contact',
      // @ts-expect-error `dataProvider` is a retirement tombstone (objectui#7353) — write `objectName`
      dataProvider: WELL_FORMED,
    };
    const malformed: ObjectDataTableSchema = {
      type: 'object-data-table',
      // @ts-expect-error `dataProvider` is a retirement tombstone (objectui#7353) — write `objectName`
      dataProvider: MALFORMED,
    };
    // The contrast, pinned LIVE rather than in prose: an undeclared key carried
    // no directive while `BaseSchema`'s index signature absorbed it — what a
    // deletion would have left `dataProvider` as. objectui#8347 removed the
    // signature, so it is refused too now, but as an undeclared key with no
    // remedy named; the tombstone above is what names `objectName`.
    // @ts-expect-error — `ObjectDataTableSchema` declares no `zzUndeclared7353` (objectui#8347)
    const undeclared: ObjectDataTableSchema = { type: 'object-data-table', zzUndeclared7353: 1 };
    expect([wellFormed.type, malformed.type, undeclared.type]).toEqual([
      'object-data-table',
      'object-data-table',
      'object-data-table',
    ]);
  });
});

describe('objectui#7353 — the zod mirror refuses an authored dataProvider BY NAME', () => {
  it.each([
    ['well-formed', WELL_FORMED],
    ['malformed', MALFORMED],
  ])('a %s dataProvider is refused at the key itself, with guidance naming objectName', (_label, value) => {
    const r = ObjectDataTableZod.safeParse({ type: 'object-data-table', objectName: 'contact', dataProvider: value });
    expect(r.success).toBe(false);
    if (r.success) return;
    const onKey = r.error.issues.filter((i) => i.path.join('.') === 'dataProvider');
    expect(onKey).toHaveLength(1);
    expect(onKey[0].code).toBe('invalid_type');
    // The named subject of the guidance — the key to write instead.
    expect(onKey[0].message).toContain('objectName');
  });

  it('the refusal reaches the author through the published entry point too', () => {
    const r = safeValidateSchema({ type: 'object-data-table', dataProvider: WELL_FORMED });
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain('dataProvider');
  });

  it('control: an undeclared key is still accepted and kept (BaseSchema passthrough is untouched)', () => {
    const r = ObjectDataTableZod.safeParse({ type: 'object-data-table', objectName: 'contact', zzUndeclared7353: { provider: 42 } });
    expect(r.success).toBe(true);
    expect(r.success && (r.data as Record<string, unknown>).zzUndeclared7353).toEqual({ provider: 42 });
  });

  it('control: a node without dataProvider still validates, objectName included', () => {
    const r = safeValidateSchema({ type: 'object-data-table', objectName: 'contact' });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues, null, 2)).toBe(true);
  });
});
