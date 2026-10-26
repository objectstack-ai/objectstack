/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12464: `@objectstack/spec` 18 retired the page kind `jsx`
 * (objectstack-ai/objectstack#23638), naming `html` as its replacement, so the
 * SDUI page node no longer declares it.
 *
 * The assertions are TYPE-level: they are judged by this package's
 * `type-check` (its `tsc -p tsconfig.test.json` leg), never by vitest, which
 * strips types. A `@ts-expect-error` that stops being needed is TS2578, so the
 * directive below fails in both directions.
 *
 * `Equal` (not `Extends`) on the whole union: re-adding `'jsx'` widens it, and
 * only an exact comparison fails on a widening.
 *
 * The zod face (`zod/layout.zod.ts` `PageNodeSchema`) refuses the same value
 * at `kind`: it picks its enum out of the spec's by reference, so it does not
 * wait for the resolved spec to carry the retirement.
 */
import { describe, expect, it } from 'vitest';
import type { PageNodeSchema } from '../layout';
import { PageNodeSchema as PageNodeZod } from '../zod/layout.zod';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type _KindIsTheSpecVocabulary = Assert<
  Equal<NonNullable<PageNodeSchema['kind']>, 'full' | 'slotted' | 'html' | 'react'>
>;

describe('PageNodeSchema.kind no longer declares the retired page kind jsx (objectui#12464)', () => {
  it('refuses kind jsx and accepts its replacement html', () => {
    const html: PageNodeSchema = { type: 'page', kind: 'html', source: '<Page />' };
    // @ts-expect-error `jsx` was retired from the page kind in @objectstack/spec 18; author `html`
    const jsx: PageNodeSchema = { type: 'page', kind: 'jsx', source: '<Page />' };
    expect([html.kind, jsx.kind]).toEqual(['html', 'jsx']);
  });

  it('the zod face refuses kind jsx at kind and accepts html', () => {
    const jsx = PageNodeZod.safeParse({ type: 'page', kind: 'jsx', source: '<Page />' });
    expect(jsx.success).toBe(false);
    expect(jsx.error?.issues.map((i) => i.path.join('.'))).toEqual(['kind']);
    expect(PageNodeZod.safeParse({ type: 'page', kind: 'html', source: '<Page />' }).success).toBe(true);
  });
});
