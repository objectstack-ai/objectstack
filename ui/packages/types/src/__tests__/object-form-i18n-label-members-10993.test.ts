// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10993 — `object-form`'s seven `I18nLabel` members, on BOTH faces of
 * `ObjectFormSchema`.
 *
 * `@objectstack/spec`'s `ComponentPropsMap['object-form']` types `title`,
 * `description`, `submitText`, `cancelText`, `nextText`, `prevText` and
 * `successMessage` as `I18nLabel`: a plain string or an inline per-locale map
 * such as `{ en: 'Save order', 'zh-CN': '保存订单' }`. `ObjectForm` resolves a
 * map against the active UI language (`plugin-form`'s
 * `ObjectForm.i18nLabels.test.tsx` pins the render).
 *
 * ## The zod mirror
 *
 * This card found the mirror declaring five of the seven, as `z.string()`: a map
 * the row and the renderer both accept was refused with `invalid_type` at the
 * member. Each became the spec's `I18nLabelSchema` by reference. The rows below
 * are behavioural: a map and a string parse, and a number is still refused AT
 * THE MEMBER, so the widening is exactly one arm and not an opening. The other
 * two, `nextText` and `prevText`, stayed in this pair's `UnmirroredDeclared`
 * entry (`./zod-mirror-parity.test.ts`) until objectui#6152 round 1 mirrored
 * them by the same reference, so all seven rows now run here; the last row
 * holds the shape to the seven, so the ledger and this file cannot disagree
 * silently.
 *
 * ## The TypeScript face
 *
 * `assertionLabelMembersAreI18nLabel` holds all seven members equal to
 * `I18nLabel | undefined`. It is checked by this package's `tsconfig.test.json`
 * and fails to compile if any member is narrowed back to `string` or widened
 * past `I18nLabel`.
 */

import { describe, it, expect } from 'vitest';
import { ObjectFormSchema as ObjectFormMirror } from '../zod/objectql.zod.js';
import type { ObjectFormSchema } from '../objectql';
import type { I18nLabel } from '../index';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
export type assertionLabelMembersAreI18nLabel = [
  Expect<Equal<ObjectFormSchema['title'], I18nLabel | undefined>>,
  Expect<Equal<ObjectFormSchema['description'], I18nLabel | undefined>>,
  Expect<Equal<ObjectFormSchema['submitText'], I18nLabel | undefined>>,
  Expect<Equal<ObjectFormSchema['cancelText'], I18nLabel | undefined>>,
  Expect<Equal<ObjectFormSchema['nextText'], I18nLabel | undefined>>,
  Expect<Equal<ObjectFormSchema['prevText'], I18nLabel | undefined>>,
  Expect<Equal<ObjectFormSchema['successMessage'], I18nLabel | undefined>>,
];

/**
 * The seven members the mirror declares: five since this card, `nextText` and
 * `prevText` since objectui#6152 round 1.
 */
const MIRRORED = ['title', 'description', 'submitText', 'cancelText', 'successMessage', 'nextText', 'prevText'] as const;

/** A minimal document the mirror accepts. */
const BASE = { type: 'object-form', objectName: 'order', mode: 'create' } as const;

/** `en` first, as in the render pin. */
const MAP = { en: 'Save order', 'zh-CN': '保存订单' };

describe('object-form — the I18nLabel members on the zod mirror (objectui#10993)', () => {
  it('CONTROL: the minimal document parses', () => {
    expect(ObjectFormMirror.safeParse(BASE).success).toBe(true);
  });

  it.each(MIRRORED)('a locale map on `%s` parses', (key) => {
    const parsed = ObjectFormMirror.safeParse({ ...BASE, [key]: MAP });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect((parsed.data as Record<string, unknown>)[key]).toEqual(MAP);
  });

  it.each(MIRRORED)('CONTROL: a plain string on `%s` parses unchanged', (key) => {
    const parsed = ObjectFormMirror.safeParse({ ...BASE, [key]: 'Save order' });
    expect(parsed.success).toBe(true);
    expect((parsed.data as Record<string, unknown>)[key]).toBe('Save order');
  });

  it.each(MIRRORED)('CONTROL: a number on `%s` is still refused at the member', (key) => {
    const parsed = ObjectFormMirror.safeParse({ ...BASE, [key]: 42 });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path.join('.'))).toEqual([key]);
  });

  it.each(MIRRORED)('a map entry that is not a string on `%s` is refused', (key) => {
    // The spec's map is `Record<string, string>`: a nested value is judged, not
    // waved through as "some object".
    const parsed = ObjectFormMirror.safeParse({ ...BASE, [key]: { en: 42 } });
    expect(parsed.success).toBe(false);
  });

  it('all seven `I18nLabel` members are mirrored (objectui#6152 round 1 added `nextText` / `prevText`)', () => {
    // This row stood as "`nextText` and `prevText` are not mirrored" while the
    // pair's `UnmirroredDeclared` entry carried both; objectui#6152 round 1 moved
    // both records together, as the row asked.
    const shape = ObjectFormMirror.shape as Record<string, unknown>;
    for (const key of MIRRORED) expect(key in shape, key).toBe(true);
  });
});
