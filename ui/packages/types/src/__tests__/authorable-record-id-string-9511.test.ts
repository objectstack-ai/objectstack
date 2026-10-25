// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9511 — a record id is a `string` WHEREVER METADATA NAMES ONE.
 *
 * ## What this file pins that its sibling cannot
 *
 * `data-source-id-surface-9511.test.ts` pins the `DataSource` doors: those are
 * TypeScript declarations, and a TypeScript declaration does not run. The three
 * keys pinned HERE are AUTHORABLE — an author writes them into JSON — so the
 * face that decides whether a number is accepted is the hand-written zod mirror,
 * and nothing else in this repository can make that decision. ⇒ narrowing the
 * declaration without the mirror would have left `declared !== enforced` on a
 * published surface with every gate green, which is why both faces moved
 * together and why this file exists beside that one.
 *
 * ## The three keys, and why they are three and not two
 *
 * `ObjectFormSchema.recordId` feeds `ObjectForm`; `DetailViewSchema.resourceId`
 * feeds `DetailView`. `DetailSchema.resourceId` reaches the SAME `DetailView`
 * call — not by symbol, but by data flow: `plugin-detail` registers the
 * `'detail'` node type onto `DetailView`, so an authored `{ type: 'detail',
 * resourceId: … }` is validated by `crud.zod.ts` and lands there. A read that
 * follows TypeScript symbols alone concludes there are two keys and is
 * incomplete.
 *
 * ## The refusal carries a prescription, and that is asserted, not assumed
 *
 * The ruling (director batch #195 item 1, letter A) requires the refusal to
 * PRESCRIBE the repair rather than merely reject. Each mirror declares its own
 * `RECORD_ID_IS_A_STRING_GUIDANCE`; the rows below assert every one of the three
 * refusal messages names the quoted form and the card, so the text drifting out
 * of one mirror reddens here instead of going quiet.
 *
 * ## Controls
 *
 * Every absence below is backed by a control ON THE SAME MIRROR AND CORPUS: a
 * lit control (a key that was already string-only refuses a number exactly as
 * before) and a green control (the key absent, and the string spellings, still
 * parse). Without them a refusal proves nothing — a mirror that refused
 * EVERYTHING would pass the subject rows alone.
 */

import { describe, it, expect } from 'vitest';
import { DetailSchema } from '../zod/crud.zod.js';
import { DetailViewSchema } from '../zod/views.zod.js';
import { ObjectFormSchema } from '../zod/objectql.zod.js';
import * as zodBarrel from '../zod/index.zod.js';

/**
 * The three authorable record-id faces, each with:
 *  - a minimal valid base document,
 *  - the record-id key it declares,
 *  - a key on the SAME schema that was ALREADY string-only (the lit control).
 */
const FACES = [
  {
    name: 'DetailSchema (crud.zod.ts) — reaches DetailView through the `detail` registration',
    schema: DetailSchema,
    key: 'resourceId',
    base: { type: 'detail' } as Record<string, unknown>,
    litControlKey: 'title',
  },
  {
    name: 'DetailViewSchema (views.zod.ts)',
    schema: DetailViewSchema,
    key: 'resourceId',
    base: { type: 'detail-view', objectName: 'account' } as Record<string, unknown>,
    litControlKey: 'title',
  },
  {
    name: 'ObjectFormSchema (objectql.zod.ts)',
    schema: ObjectFormSchema,
    key: 'recordId',
    base: { type: 'object-form', objectName: 'account', mode: 'edit' } as Record<string, unknown>,
    litControlKey: 'objectName',
  },
] as const;

describe('an authored record id may not be a number (objectui#9511)', () => {
  for (const { name, schema, key, base } of FACES) {
    // Integer, negative and float are separate rows because a mirror could
    // conceivably refuse one numeric spelling and admit another; asserting only
    // `42` would not see that.
    for (const [label, value] of [
      ['an integer', 42],
      ['a negative integer', -1],
      ['a float', 4.5],
    ] as const) {
      it(`${name}: \`${key}\` refuses ${label}`, () => {
        const r = schema.safeParse({ ...base, [key]: value });
        expect(r.success, `\`${key}: ${String(value)}\` must not parse`).toBe(false);
        if (r.success) return;
        const issue = r.error.issues.find((i) => i.path.join('.') === key);
        expect(issue, `the refusal must be AT \`${key}\`, not somewhere else`).toBeDefined();
        expect(issue?.code).toBe('invalid_type');
      });
    }

    it(`${name}: the refusal PRESCRIBES the repair rather than only rejecting`, () => {
      const r = schema.safeParse({ ...base, [key]: 42 });
      expect(r.success).toBe(false);
      if (r.success) return;
      const message = r.error.issues.find((i) => i.path.join('.') === key)?.message ?? '';
      // Cited by CONTENT, never by line: the quoted form the author must write,
      // and the card that explains why.
      expect(
        message,
        'the author has to be told WHAT to write, not just that they are wrong',
      ).toContain("'42'");
      expect(message).toContain('objectui#9511');
    });
  }
});

describe('the string spellings still parse — the change is one-directional', () => {
  for (const { name, schema, key, base } of FACES) {
    it(`${name}: \`${key}\` accepts the quoted numeric id the refusal prescribes`, () => {
      expect(schema.safeParse({ ...base, [key]: '42' }).success).toBe(true);
    });

    it(`${name}: \`${key}\` accepts an ordinary string id`, () => {
      expect(schema.safeParse({ ...base, [key]: 'rec_1' }).success).toBe(true);
    });

    it(`${name}: \`${key}\` is still OPTIONAL — omitting it is not an error`, () => {
      expect(schema.safeParse({ ...base }).success).toBe(true);
    });
  }
});

describe('controls — the instrument can both accept and refuse (objectui#9511)', () => {
  for (const { name, schema, key, base, litControlKey } of FACES) {
    it(`${name}: [LIT CTRL] \`${litControlKey}\` was string-only before this card and still refuses a number`, () => {
      // If this row ever goes green, the refusals above stop meaning anything:
      // they would be indistinguishable from a mirror that refuses everything,
      // or from one that has stopped reading its own shape.
      const r = schema.safeParse({ ...base, [litControlKey]: 42 });
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.issues.some((i) => i.path.join('.') === litControlKey)).toBe(true);
    });

    it(`${name}: [GREEN CTRL] the base document parses, so a refusal above is about \`${key}\``, () => {
      expect(schema.safeParse({ ...base }).success).toBe(true);
    });

    it(`${name}: [RED CTRL] a non-numeric wrong type at \`${key}\` was refused before and still is`, () => {
      // These were ALREADY red under the old union, so they are the half of the
      // corpus that proves nothing was loosened while the number arm was removed.
      for (const bad of [{ zzq: 1 }, [42], true, null]) {
        expect(
          schema.safeParse({ ...base, [key]: bad }).success,
          `\`${key}\` must keep refusing ${JSON.stringify(bad)}`,
        ).toBe(false);
      }
    });
  }
});

describe('the two DetailView-bearing mirrors agree with each other (objectui#9511)', () => {
  /**
   * `views.zod.ts` and `crud.zod.ts` both declare a `resourceId` that reaches the
   * same renderer. They drifted apart once already (the card's own history records
   * one being read as `DetailViewSchema` when it is `DetailSchema`), so the
   * agreement is pinned rather than trusted.
   */
  it('both refuse a numeric `resourceId` and both accept the quoted form', () => {
    for (const [schema, base] of [
      [DetailSchema, { type: 'detail' }],
      [DetailViewSchema, { type: 'detail-view', objectName: 'account' }],
    ] as const) {
      expect(schema.safeParse({ ...base, resourceId: 42 }).success).toBe(false);
      expect(schema.safeParse({ ...base, resourceId: '42' }).success).toBe(true);
    }
  });

  it('all three mirrors are DISTINCT objects, so this file is not testing one of them three times (control)', () => {
    const three = [DetailSchema, DetailViewSchema, ObjectFormSchema];
    expect(new Set(three).size).toBe(3);
  });

  it('all three are the objects the PUBLISHED barrel exports, not private look-alikes (control)', () => {
    // `@object-ui/types/zod` is the published entry point; a consumer gets these
    // objects and no others. Pinning identity through the barrel is what makes
    // every refusal above a statement about the shipped surface.
    expect(zodBarrel.DetailSchema).toBe(DetailSchema);
    expect(zodBarrel.DetailViewSchema).toBe(DetailViewSchema);
    expect(zodBarrel.ObjectFormSchema).toBe(ObjectFormSchema);
  });
});
