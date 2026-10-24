/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11168 slice 3 — `UIActionSchema.size` is the `action:button` row's
 * own vocabulary, by reference.
 *
 * The type was `'sm' | 'md' | 'lg'` while `@objectstack/spec` 17.5.0's
 * `action:button` row declares `default` / `sm` / `lg` / `icon` / `md`, the
 * registration has published all five since slice 2, and the renderers draw
 * all five — on the leaf and on a group member alike (measured through the real
 * `SchemaRenderer` for this slice). So `size: 'icon'` on a typed action was a
 * TS2322 the platform does not mean. The compile-time rows below are checked by
 * `tsc -p tsconfig.test.json`; the runtime rows read the installed row.
 */
import { describe, it, expect } from 'vitest';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import type { ActionButtonProps } from '@objectstack/spec/ui';
import type { UIActionSchema } from '../ui-action';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The member IS the row's, so a spec release that moves the vocabulary moves this type with it. */
export type _SizeIsTheRowsVocabulary = Expect<Equal<UIActionSchema['size'], ActionButtonProps['size']>>;
/** The two values the old union refused are accepted now. */
const _default: UIActionSchema['size'] = 'default';
const _icon: UIActionSchema['size'] = 'icon';
// @ts-expect-error — CONTROL: a size no layer draws is still refused.
const _bogus: UIActionSchema['size'] = 'xl';

interface Parser {
  safeParse: (value: unknown) => { success: boolean };
}
const actionButtonRow = (ComponentPropsMap as unknown as Record<string, Parser>)['action:button'];

describe('`UIActionSchema.size` takes the `action:button` row\'s vocabulary (objectui#11168)', () => {
  it.each(['default', 'sm', 'md', 'lg', 'icon'])('the installed row accepts `%s`', (size) => {
    expect(actionButtonRow.safeParse({ size }).success).toBe(true);
  });

  it('CONTROL: the row refuses a size outside it', () => {
    expect(actionButtonRow.safeParse({ size: 'xl' }).success).toBe(false);
  });

  it('the compile-time rows are real values', () => {
    expect([_default, _icon, _bogus]).toEqual(['default', 'icon', 'xl']);
  });
});
