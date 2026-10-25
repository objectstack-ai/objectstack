/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6576 — `ObjectGalleryProps.schema` is anchored to the exported
 * `ObjectGallerySchema` (`extends BaseSchema`), not a hand-rolled literal.
 *
 * ## Why this pin is compile-time
 *
 * The change is a TYPE declaration; the widget renders identically before and
 * after it, so a rendering test is blind to the whole change. What moves is the
 * ACCEPT SET of a published prop type (`ObjectGalleryProps` is exported from
 * `plugin-list/src/index.tsx`), and `tsconfig.test.json` compiles this file, so
 * each statement below is real enforcement.
 *
 * ## Direction of the move, stated (Clause ②)
 *
 *   - WIDENS: every `BaseSchema` member is now writable. `visibleWhen` — a real
 *     base member — was a compile error on the literal.
 *   - NARROWS: `type` is now required, and pinned to the registry key.
 *   - UNCHANGED then, pinned honestly: an unknown key still compiled, because
 *     `BaseSchema`'s `[key: string]: any` was inherited (objectui#5155). The
 *     ruling accepted that cost; objectui#8347 removed the signature, and the
 *     counter-probe below is flipped: an unknown key is refused now.
 *
 * The schema type's own members and the widget's read census are pinned in
 * `packages/types/src/__tests__/widget-schema-anchors-6576.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { ObjectGalleryProps } from '../ObjectGallery';
import type { BaseSchema, ObjectGallerySchema } from '@object-ui/types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The anchor itself — invariant equality, so a second literal cannot creep back. */
export type assertionSchemaIsAnchored = Expect<Equal<ObjectGalleryProps['schema'], ObjectGallerySchema>>;
export type assertionSchemaExtendsBase = Expect<[ObjectGalleryProps['schema']] extends [BaseSchema] ? true : false>;
/**
 * The pin can fail: the pre-#6576 literal shape is NOT the anchor. (Spelled with
 * `className`, not the literal's `bind` member: `base-bind-declared.test.ts`
 * scans every tracked file for a schema-side `bind` re-declaration, and a
 * synthetic control must not read as one.)
 */
export type assertionAnchorPinCanFail = Expect<Equal<Equal<{ objectName?: string; className?: string }, ObjectGallerySchema>, false>>;

describe('ObjectGalleryProps.schema — anchored to ObjectGallerySchema (objectui#6576)', () => {
  it('WIDENS: accepts a real BaseSchema member the literal refused', () => {
    // RED before this card (TS2353 — `visibleWhen` did not exist on the literal).
    const node: ObjectGalleryProps['schema'] = {
      type: 'object-gallery',
      objectName: 'account',
      visibleWhen: '${data.ready}',
      gallery: { titleField: 'name' },
    };
    expect(node.visibleWhen).toBe('${data.ready}');
  });

  it('NARROWS: `type` is required and is the registry key', () => {
    // @ts-expect-error — `type` is required now; the minimal `{ objectName }` literal no longer compiles.
    const missing: ObjectGalleryProps['schema'] = { objectName: 'account' };
    // @ts-expect-error — the only spelling is the key `ObjectGallery.tsx` registers.
    const wrong: ObjectGalleryProps['schema'] = { type: 'gallery', objectName: 'account' };
    expect([missing.objectName, wrong.objectName]).toEqual(['account', 'account']);
  });

  it('refuses a wrong-typed base member for the DECLARED reason', () => {
    // @ts-expect-error — `visible` is `boolean | string` through BaseSchema.
    const node: ObjectGalleryProps['schema'] = { type: 'object-gallery', visible: 42 };
    expect(node.visible).toBe(42);
  });

  it('keeps the widget-local `data` typed — an interface member overrides, it does not intersect', () => {
    // The prior probe predicted `data` would collapse to `any` under a
    // `BaseSchema & {…}` INTERSECTION. `extends` is not an intersection: the
    // derived member wins, so a non-array is still refused.
    // @ts-expect-error — `data` is `Record<string, unknown>[]`.
    const node: ObjectGalleryProps['schema'] = { type: 'object-gallery', data: 'not-an-array' };
    expect(node.data).toBe('not-an-array');
  });

  it('an UNKNOWN key is refused — the ceiling this row stated is gone (objectui#8347)', () => {
    // The inherited index signature let it compile until objectui#8347 removed it.
    // @ts-expect-error — `visibleWhn` is no member; the key is `visibleWhen`
    const node: ObjectGalleryProps['schema'] = { type: 'object-gallery', visibleWhn: 'typo' };
    expect(node.type).toBe('object-gallery');
  });
});
