/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `breadcrumb` and `object-tree` are nameable on `@object-ui/types/zod`
 * (objectui#7917).
 *
 * `AnyComponentSchema` declares 107 node component types. 105 of them had a
 * named export on the `./zod` barrel; the arms declaring `type: 'breadcrumb'`
 * (`navigation.zod.ts`) and `type: 'object-tree'` (`objectql.zod.ts`) did not.
 * Both were already `export const` in their own module — what was missing was
 * the barrel's re-export, and `index.zod.ts` is the package's only zod entry
 * point (`base.zod.ts#defineNodeComponentUnion`, `@internal`). So the schemas
 * existed, were maintained, and were applied by the union, while no consumer
 * could name them: declared-and-unreachable.
 *
 * ⭐ The repair was taken only after establishing that nothing marked the two
 * DELIBERATELY internal, against a live control: this directory does record
 * that intent when it holds, in as many words — `base.zod.ts`'s `@internal ...
 * is not re-exported`, and the `Not exported:` docblocks on
 * `complex.zod.ts#ChatbotSharedMirrorShape` and
 * `objectql.zod.ts#GanttConfigExtensionFields`, the last of these in the very
 * file `ObjectTreeSchema` lives in. Neither of these two carried such a note,
 * the barrel's own `README.md` lists `BreadcrumbSchema` under "Available
 * Schemas", and the parity census registers both as first-class mirrors with a
 * TS counterpart rather than exempting them.
 *
 * Three legs, because presence alone proves nothing:
 *
 *  1. the name is on the barrel — the regression the card measured;
 *  2. it is a real declaration: a minimal document is accepted, and a
 *     wrong-typed DECLARED key is refused with the refusal naming THAT key.
 *     `BaseSchema` is `.passthrough()`, so an UNKNOWN key would prove nothing;
 *     both probes below are keys the mirror declares;
 *  3. ⭐ the asymmetry a union cannot supply. ⚠️ Measured, not assumed, and it
 *     is NOT the one the card predicted: since objectui#8498 made
 *     `AnyComponentSchema` a DISCRIMINATED union, it already diagnoses a
 *     wrong-typed key by name, so the card's "an `invalid_union` naming every
 *     arm that did not match" no longer describes `main`. What survives — and
 *     what no union can ever answer — is the QUESTION: `AnyComponentSchema`
 *     answers "is this SOME valid node", so a `button` document passes it. Only
 *     the named schema answers "is this a valid breadcrumb".
 */
import { describe, it, expect } from 'vitest';
import {
  AnyComponentSchema,
  BreadcrumbSchema,
  ObjectTreeSchema,
} from '../zod/index.zod.js';

/** A document of a DIFFERENT declared node type — leg 3's probe for both names. */
const A_BUTTON = { type: 'button', label: 'Save' };

describe('breadcrumb / object-tree are nameable on the zod barrel (objectui#7917)', () => {
  it.each([
    ['BreadcrumbSchema', BreadcrumbSchema],
    ['ObjectTreeSchema', ObjectTreeSchema],
  ])('leg 1 — %s is re-exported by index.zod.ts', (_name, schema) => {
    expect(schema).toBeDefined();
    expect(typeof schema.safeParse).toBe('function');
  });

  describe('leg 2 — BreadcrumbSchema is a real declaration', () => {
    it('accepts a breadcrumb document on its own', () => {
      const result = BreadcrumbSchema.safeParse({
        type: 'breadcrumb',
        items: [{ label: 'Home', href: '/' }, { label: 'Accounts' }],
        separator: '/',
        maxItems: 4,
      });
      expect(result.success).toBe(true);
    });

    it('refuses a wrong-typed declared key BY NAME, not as a union miss', () => {
      const result = BreadcrumbSchema.safeParse({
        type: 'breadcrumb',
        items: [{ label: 'Home' }],
        maxItems: 'five', // declared `z.number().optional()`
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(['maxItems']);
      expect(result.error.issues[0].code).toBe('invalid_type');
    });
  });

  describe('leg 2 — ObjectTreeSchema is a real declaration', () => {
    it('accepts an object-tree document on its own', () => {
      const result = ObjectTreeSchema.safeParse({
        type: 'object-tree',
        objectName: 'accounts',
        parentField: 'parent_id',
        labelField: 'name',
        defaultExpandedDepth: 1,
      });
      expect(result.success).toBe(true);
    });

    it('refuses a wrong-typed declared key BY NAME, not as a union miss', () => {
      const result = ObjectTreeSchema.safeParse({
        type: 'object-tree',
        objectName: 'accounts',
        defaultExpandedDepth: 'two', // declared `z.number().optional()`
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(['defaultExpandedDepth']);
      expect(result.error.issues[0].code).toBe('invalid_type');
    });
  });

  describe('leg 3 — the question only a named arm can be asked', () => {
    it('AnyComponentSchema answers "is this SOME valid node" — a button passes', () => {
      expect(AnyComponentSchema.safeParse(A_BUTTON).success).toBe(true);
    });

    it.each([
      ['BreadcrumbSchema', BreadcrumbSchema],
      ['ObjectTreeSchema', ObjectTreeSchema],
    ])('%s answers "is this a valid X" — the same button is refused', (_name, schema) => {
      expect(schema.safeParse(A_BUTTON).success).toBe(false);
    });
  });
});
