/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ContainerSchema.padding` is closed to the steps the `container` renderer
 * maps, on both faces, and the refusal names the set (objectui#11424).
 *
 * ## The defect
 *
 * The key was `z.number()` on the mirror and `number` on the declaration. The
 * renderer reads `schema.padding ?? 4` and tests it against one branch per step
 * (0 through 8, 10, 12, 16), so `padding: 9` or `padding: 20` parsed green on
 * the tolerant face (`safeValidateSchema`) and on the strict authoring face,
 * which `objectui validate` runs, and the container rendered with no padding
 * class at all — not the default either, because `??` supplies it only for an
 * absent key.
 *
 * ## The pins (triage `5944196293`)
 *
 * 9 and 20 are refused on both faces with the set named; each mapped value
 * parses; an absent key still parses (the control — the renderer half of it,
 * that the absent key draws the default ladder, is in
 * `components/src/__tests__/layout-spacing-sets-11474.test.tsx`, which also
 * re-derives this set from the rendered branches).
 *
 * `BaseSchema` is `.passthrough()`, so the refusal also gets a lit control: an
 * undeclared key on the same document stays green, which shows the refusal is
 * the declared key's own verdict and not a strict object refusing everything.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { ContainerSchema } from '../zod/layout.zod.js';
import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';
import type { ContainerSchema as ContainerSchemaType } from '../layout.js';

/** The twelve steps the triage direction names — the renderer's branches. */
const MAPPED = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16] as const;

/** Off-set numbers the triage direction pins as refusals. */
const UNMAPPED = [9, 20] as const;

const UNKNOWN_KEY = 'zzzNotAKeyAnySurfaceDeclares11424';

interface Issue {
  code: string;
  path: PropertyKey[];
  message: string;
  values?: unknown[];
}

/** The three doors a `container` document passes through. */
const FACES = {
  node: (doc: unknown) => ContainerSchema.safeParse(doc),
  tolerant: (doc: unknown) => safeValidateSchema(doc),
  strict: (doc: unknown) => StrictAnyComponentSchema.safeParse(doc),
} as const;

const issuesOf = (r: { success: boolean; error?: { issues: unknown[] } }): Issue[] =>
  r.success ? [] : (r.error!.issues as Issue[]);

describe('ContainerSchema.padding is closed to the renderer\'s steps (objectui#11424)', () => {
  for (const [face, parse] of Object.entries(FACES)) {
    describe(`${face} face`, () => {
      for (const value of UNMAPPED) {
        it(`refuses padding ${value} at the key, naming the set`, () => {
          const issues = issuesOf(parse({ type: 'container', padding: value }));
          expect(issues).toHaveLength(1);
          const [issue] = issues;
          expect(issue.code).toBe('invalid_value');
          expect(issue.path).toEqual(['padding']);
          // The set, structurally: the issue carries the accept list itself …
          expect(issue.values).toEqual([...MAPPED]);
          // … and the author-facing text spells that same list out.
          expect(issue.message).toContain(MAPPED.join(', '));
        });
      }

      it('accepts each mapped step', () => {
        for (const value of MAPPED) {
          expect(parse({ type: 'container', padding: value }).success, `padding ${value} refused`).toBe(true);
        }
      });

      it('control: a container without padding still parses', () => {
        expect(parse({ type: 'container', children: [] }).success).toBe(true);
      });
    });
  }

  it('lit control: an undeclared key beside a mapped step stays green on the node', () => {
    expect(ContainerSchema.safeParse({ type: 'container', padding: 4, [UNKNOWN_KEY]: true }).success).toBe(true);
  });

  it('the declaration takes the same set (compile-time: refused by `tsc` when it does not)', () => {
    // @ts-expect-error — 9 is not one of the renderer's steps.
    const nine: ContainerSchemaType = { type: 'container', padding: 9 };
    // @ts-expect-error — nor is 20.
    const twenty: ContainerSchemaType = { type: 'container', padding: 20 };
    const none: ContainerSchemaType = { type: 'container', padding: 0 };
    const widest: ContainerSchemaType = { type: 'container', padding: 16 };
    expect([nine, twenty, none, widest].length).toBe(4);
  });

  it('the two faces state one set (compile-time)', () => {
    type Mirror = NonNullable<z.infer<typeof ContainerSchema>['padding']>;
    type Declared = NonNullable<ContainerSchemaType['padding']>;
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const same: Same<Mirror, Declared> = true;
    expect(same).toBe(true);
  });
});
