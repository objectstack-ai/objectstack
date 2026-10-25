/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `stack.gap`, `flex.gap` and `grid.gap` are each closed to the steps their
 * renderer maps, on both faces, and the refusal names the set (objectui#11474,
 * the family close-out after objectui#11424's `container.padding`).
 *
 * ## The defect
 *
 * Each key was `z.number()` on the mirror and `number` on the declaration, and
 * the `flex` / `grid` describes advertised "Tailwind scale 0-8". The renderers
 * map closed sets: `stack.tsx` and `flex.tsx` test `schema.gap ?? 2` against
 * one branch per step, so `{ type: 'stack', gap: 7 }` and
 * `{ type: 'flex', properties: { gap: 9 } }` parsed green on the tolerant face
 * (`safeValidateSchema`) and on the strict authoring face, which
 * `objectui validate` runs, and drew no gap class at all. `grid.tsx` builds
 * `gap-[N*0.25rem]` at runtime for a number outside its map, a class no
 * compiled stylesheet defines.
 *
 * ## The pins
 *
 * An unmapped number is refused at the key on every door the node is authored
 * through, with the set in the issue and in the message; each mapped step
 * parses; an absent key still parses. `flex` is authored in its `properties`
 * bag (objectui#11276), so the bag is the door its refusal is pinned at; the
 * flat spelling is refused too, by name, as every flat `flex` prop is. The
 * sets here are the declared ones; that they ARE the renderers' sets is
 * re-derived by rendering in
 * `components/src/__tests__/layout-spacing-sets-11474.test.tsx`.
 *
 * `BaseSchema` is `.passthrough()`, so each refusal gets a lit control: an
 * undeclared key beside a mapped step stays green on the node, which shows the
 * refusal is the declared key's own verdict.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { FlexSchema, GridSchema, StackSchema } from '../zod/layout.zod.js';
import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';
import type {
  FlexLayoutProps,
  FlexSchema as FlexSchemaType,
  GridSchema as GridSchemaType,
  StackSchema as StackSchemaType,
} from '../layout.js';
import type { FlexBlockNode } from '../authoring-nodes.js';

interface Issue {
  code: string;
  path: PropertyKey[];
  message: string;
  values?: unknown[];
}

const issuesOf = (r: { success: boolean; error?: { issues: unknown[] } }): Issue[] =>
  r.success ? [] : (r.error!.issues as Issue[]);

const UNKNOWN_KEY = 'zzzNotAKeyAnySurfaceDeclares11474';

/** The declared sets, the authored spelling of each key, and the off-set numbers pinned as refusals. */
const KEYS = [
  {
    node: 'stack',
    mirror: StackSchema,
    steps: [0, 1, 2, 3, 4, 5, 6, 8, 10],
    unmapped: [7, 9, 11, 2.5, -1],
    authored: (gap: unknown) => ({ type: 'stack', gap }),
    absent: { type: 'stack' },
    path: ['gap'],
  },
  {
    node: 'flex',
    mirror: FlexSchema,
    steps: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    unmapped: [9, 10, 12, 2.5, -1],
    authored: (gap: unknown) => ({ type: 'flex', properties: { gap } }),
    absent: { type: 'flex', properties: {} },
    path: ['properties', 'gap'],
  },
  {
    node: 'grid',
    mirror: GridSchema,
    steps: [0, 1, 2, 3, 4, 5, 6, 8, 10, 12],
    unmapped: [7, 9, 11, 16, 2.5, -1],
    authored: (gap: unknown) => ({ type: 'grid', gap }),
    absent: { type: 'grid' },
    path: ['gap'],
  },
] as const;

/** The doors an authored document passes through. */
const FACES = {
  tolerant: (doc: unknown) => safeValidateSchema(doc),
  strict: (doc: unknown) => StrictAnyComponentSchema.safeParse(doc),
} as const;

describe('layout `gap` keys are closed to their renderers\' steps (objectui#11474)', () => {
  for (const key of KEYS) {
    describe(`${key.node}.gap`, () => {
      it('the mirror declares exactly the set', () => {
        expect([...key.mirror.shape.gap.unwrap().values].sort((a, b) => a - b)).toEqual([...key.steps]);
      });

      it('the describe states the set, not a range', () => {
        const description = key.mirror.shape.gap.description ?? '';
        expect(description).toContain(key.steps.join(', '));
        expect(description).not.toContain('0-8');
      });

      for (const [face, parse] of Object.entries(FACES)) {
        describe(`${face} face`, () => {
          for (const value of key.unmapped) {
            it(`refuses gap ${value} at the key, naming the set`, () => {
              const issues = issuesOf(parse(key.authored(value)));
              expect(issues).toHaveLength(1);
              const [issue] = issues;
              expect(issue.code).toBe('invalid_value');
              expect(issue.path).toEqual([...key.path]);
              // The set, structurally: the issue carries the accept list itself …
              expect(issue.values).toEqual([...key.steps]);
              // … and the author-facing text spells that same list out.
              expect(issue.message).toContain(key.steps.join(', '));
            });
          }

          it('accepts each mapped step', () => {
            for (const value of key.steps) {
              expect(parse(key.authored(value)).success, `${key.node} gap ${value} refused`).toBe(true);
            }
          });

          it('control: the node without gap still parses', () => {
            expect(parse(key.absent).success).toBe(true);
          });
        });
      }

      it('lit control: an undeclared key beside a mapped step stays green on the mirror', () => {
        expect(key.mirror.safeParse({ type: key.node, gap: key.steps[0], [UNKNOWN_KEY]: true }).success).toBe(true);
      });
    });
  }

  it('flex: the flat spelling of an unmapped gap is refused too, by name', () => {
    for (const parse of Object.values(FACES)) {
      const issues = issuesOf(parse({ type: 'flex', gap: 9 }));
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((issue) => issue.path[0] === 'gap')).toBe(true);
      expect(issues.map((issue) => issue.message).join('\n')).toContain('properties.gap');
    }
  });

  it('the declarations take the same sets (compile-time: refused by `tsc` when they do not)', () => {
    // @ts-expect-error — `stack` has no branch for 7.
    const stackSeven: StackSchemaType = { type: 'stack', gap: 7 };
    // @ts-expect-error — `flex` has no branch for 9 …
    const flexNine: FlexLayoutProps = { gap: 9 };
    // @ts-expect-error — … nor for 10, which `stack` maps.
    const flexTen: FlexSchemaType = { type: 'flex', gap: 10 };
    // @ts-expect-error — the authored bag is the same member.
    const bagNine: FlexBlockNode = { type: 'flex', properties: { gap: 9 } };
    // @ts-expect-error — `grid` has no entry for 9.
    const gridNine: GridSchemaType = { type: 'grid', gap: 9 };
    const stackTen: StackSchemaType = { type: 'stack', gap: 10 };
    const flexSeven: FlexBlockNode = { type: 'flex', properties: { gap: 7 } };
    const gridTwelve: GridSchemaType = { type: 'grid', gap: 12 };
    expect([stackSeven, flexNine, flexTen, bagNine, gridNine, stackTen, flexSeven, gridTwelve]).toHaveLength(8);
  });

  it('each pair of faces states one set (compile-time)', () => {
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const stack: Same<NonNullable<z.infer<typeof StackSchema>['gap']>, NonNullable<StackSchemaType['gap']>> = true;
    const flex: Same<NonNullable<z.infer<typeof FlexSchema>['gap']>, NonNullable<FlexLayoutProps['gap']>> = true;
    const grid: Same<NonNullable<z.infer<typeof GridSchema>['gap']>, NonNullable<GridSchemaType['gap']>> = true;
    expect([stack, flex, grid]).toEqual([true, true, true]);
  });
});
