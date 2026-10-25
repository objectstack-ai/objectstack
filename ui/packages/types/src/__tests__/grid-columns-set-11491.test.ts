/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `grid.columns` is closed to the counts the `grid` renderer maps, 1 to 12, on
 * both faces, as the bare number and at every breakpoint, and the refusal names
 * the set (objectui#11491, the numeric-layout family's close-out after
 * objectui#11424's `container.padding` and objectui#11474's `gap` keys).
 *
 * ## The defect
 *
 * The member was `number | Partial<Record<BreakpointName, number>>` on the
 * declaration and `z.number()` in both arms of the mirror. `grid.tsx` spells
 * `grid-cols-1` to `grid-cols-12` once per breakpoint and nothing else, so a
 * count outside that set parsed green on the tolerant face
 * (`safeValidateSchema`) and on the strict authoring face, which
 * `objectui validate` runs, and drew no column class where it was authored: a bare `13`
 * drew `grid-cols-1 sm:grid-cols-2` and lost its `md` count, `{ md: 13 }` drew
 * nothing at `md`, and `{ xs: 13 }`, `0` and `-1` drew `grid-cols-2` through a
 * fallback the renderer no longer has.
 *
 * ## The pins
 *
 * An unmapped count is refused at `columns` on both doors, bare and at each
 * breakpoint. `columns` is a union (a count, or the breakpoint object), so the
 * refusal is one `invalid_union` whose message names the set; the arm the
 * value was meant for carries the set structurally, as an `invalid_value`
 * whose `values` are the counts (at the breakpoint's own path, for the object).
 * Each mapped count parses, bare and at each breakpoint; an absent key parses;
 * an out-of-vocabulary breakpoint is still `unrecognized_keys`
 * (objectui#8516). The set here is the declared one; that it IS the renderer's
 * set is re-derived by rendering in
 * `components/src/__tests__/layout-spacing-sets-11474.test.tsx`.
 *
 * `BaseSchema` is `.passthrough()`, so the refusal gets a lit control: an
 * undeclared key beside a mapped count stays green on the node, which shows the
 * refusal is the declared key's own verdict.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { GridSchema } from '../zod/layout.zod.js';
import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';
import type { GridSchema as GridSchemaType } from '../layout.js';

interface Issue {
  code: string;
  path: PropertyKey[];
  message: string;
  values?: unknown[];
  keys?: string[];
  errors?: Issue[][];
}

const issuesOf = (r: { success: boolean; error?: { issues: unknown[] } }): Issue[] =>
  r.success ? [] : (r.error!.issues as Issue[]);

const UNKNOWN_KEY = 'zzzNotAKeyAnySurfaceDeclares11491';

const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const SET = COUNTS.join(', ');
const BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const;
const UNMAPPED = [0, 13, 16, -1, 2.5];

/** The doors an authored document passes through. */
const FACES = {
  tolerant: (doc: unknown) => safeValidateSchema(doc),
  strict: (doc: unknown) => StrictAnyComponentSchema.safeParse(doc),
} as const;

const columns = GridSchema.shape.columns.unwrap();
const [countArm, objectArm] = columns.options;

describe('`grid.columns` is closed to the renderer\'s counts (objectui#11491)', () => {
  it('the mirror declares exactly the set, in both arms', () => {
    expect([...countArm.values].sort((a, b) => a - b)).toEqual(COUNTS);
    // The object's values are the same closed literal, not a second spelling of it.
    expect(objectArm.valueType).toBe(countArm);
    expect(objectArm.keyType.options).toEqual([...BREAKPOINTS]);
  });

  it('the describe states the set, not "Number of columns"', () => {
    const description = GridSchema.shape.columns.description ?? '';
    expect(description).toContain(SET);
    expect(description).toContain('default 2');
  });

  for (const [face, parse] of Object.entries(FACES)) {
    describe(`${face} face`, () => {
      for (const value of UNMAPPED) {
        it(`refuses the bare count ${value} at \`columns\`, naming the set`, () => {
          const issues = issuesOf(parse({ type: 'grid', columns: value }));
          expect(issues).toHaveLength(1);
          const [issue] = issues;
          expect(issue.code).toBe('invalid_union');
          expect(issue.path).toEqual(['columns']);
          expect(issue.message).toContain(SET);
          // The count arm carries the set itself.
          const countIssue = issue.errors!.flat().find((i) => i.code === 'invalid_value');
          expect(countIssue?.path).toEqual([]);
          expect(countIssue?.values).toEqual(COUNTS);
        });
      }

      for (const bp of BREAKPOINTS) {
        it(`refuses an unmapped count at \`${bp}\`, naming the set and the breakpoint`, () => {
          const value = UNMAPPED[BREAKPOINTS.indexOf(bp) % UNMAPPED.length];
          const issues = issuesOf(parse({ type: 'grid', columns: { [bp]: value } }));
          expect(issues).toHaveLength(1);
          const [issue] = issues;
          expect(issue.code).toBe('invalid_union');
          expect(issue.path).toEqual(['columns']);
          expect(issue.message).toContain(SET);
          // The object arm names the breakpoint and carries the set.
          const memberIssue = issue.errors!.flat().find((i) => i.path.length === 1);
          expect(memberIssue).toMatchObject({ code: 'invalid_value', path: [bp], values: COUNTS });
        });
      }

      it('accepts each mapped count, bare and at every breakpoint', () => {
        for (const value of COUNTS) {
          expect(parse({ type: 'grid', columns: value }).success, `columns ${value} refused`).toBe(true);
          for (const bp of BREAKPOINTS) {
            expect(parse({ type: 'grid', columns: { [bp]: value } }).success, `columns.${bp} ${value} refused`).toBe(true);
          }
        }
        const full = Object.fromEntries(BREAKPOINTS.map((bp, i) => [bp, COUNTS[i * 2]]));
        expect(parse({ type: 'grid', columns: full }).success).toBe(true);
      });

      it('control: the node without columns, and with an empty object, still parses', () => {
        expect(parse({ type: 'grid' }).success).toBe(true);
        expect(parse({ type: 'grid', columns: {} }).success).toBe(true);
      });

      it('control: a breakpoint outside the vocabulary is still reported by key (objectui#8516)', () => {
        const issues = issuesOf(parse({ type: 'grid', columns: { xxl: 3 } }));
        expect(issues).toEqual([expect.objectContaining({ code: 'unrecognized_keys', path: ['columns'], keys: ['xxl'] })]);
      });
    });
  }

  it('lit control: an undeclared key beside a mapped count stays green on the mirror', () => {
    expect(GridSchema.safeParse({ type: 'grid', columns: 12, [UNKNOWN_KEY]: true }).success).toBe(true);
  });

  it('the declaration takes the same set (compile-time: refused by `tsc` when it does not)', () => {
    // @ts-expect-error — `grid` maps no 13th column.
    const thirteen: GridSchemaType = { type: 'grid', columns: 13 };
    // @ts-expect-error — nor a zero-column grid.
    const zero: GridSchemaType = { type: 'grid', columns: 0 };
    // @ts-expect-error — the breakpoint object takes the same counts.
    const mdThirteen: GridSchemaType = { type: 'grid', columns: { md: 13 } };
    const twelve: GridSchemaType = { type: 'grid', columns: 12 };
    const ramp: GridSchemaType = { type: 'grid', columns: { xs: 1, md: 6, '2xl': 12 } };
    expect([thirteen, zero, mdThirteen, twelve, ramp]).toHaveLength(5);
  });

  it('the two faces state one set (compile-time)', () => {
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const same: Same<NonNullable<z.infer<typeof GridSchema>['columns']>, NonNullable<GridSchemaType['columns']>> = true;
    expect(same).toBe(true);
  });
});
