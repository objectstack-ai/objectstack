/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12803 — an authored `FormView.modalSize` reaches the console's
 * create / edit modal.
 *
 * `resolveFormViewLayout` copies the default form view's `modalSize` when it
 * is a value the spec's `FormView.modalSize` enum allows, and
 * `resolveRecordFormModalLayout` states the precedence against the derived
 * flow surface: a derived `'full'` (the phone posture) stays full, otherwise
 * the authored size wins, otherwise no `modalSize` key at all.
 */

import { describe, it, expect } from 'vitest';
import { FormViewSchema } from '@objectstack/spec/ui';
import { resolveFormViewLayout, resolveRecordFormModalLayout } from '../recordFormNavigation';

const SECTIONS = [{ label: 'Details', fields: ['subject'] }];

describe('resolveFormViewLayout carries the authored modalSize (objectui#12803)', () => {
  it.each(['sm', 'default', 'lg', 'xl', 'full'] as const)('copies modalSize %s', (size) => {
    expect(resolveFormViewLayout({ form: { type: 'modal', modalSize: size } })).toStrictEqual({
      modalSize: size,
    });
  });

  it('the cases above are the whole spec enum', () => {
    expect(FormViewSchema.shape.modalSize.unwrap().options).toEqual(['sm', 'default', 'lg', 'xl', 'full']);
  });

  it('copies modalSize beside sections, and from the legacy formViews.default', () => {
    expect(resolveFormViewLayout({ form: { type: 'simple', sections: SECTIONS, modalSize: 'lg' } })).toStrictEqual({
      sections: SECTIONS,
      modalSize: 'lg',
    });
    expect(resolveFormViewLayout({ formViews: { default: { type: 'modal', modalSize: 'xl' } } })).toStrictEqual({
      modalSize: 'xl',
    });
  });

  it('copies no value the spec enum refuses', () => {
    // `md` is a `navigation.size` bucket, not a `FormView.modalSize` one.
    expect(resolveFormViewLayout({ form: { type: 'modal', modalSize: 'md' as any } })).toStrictEqual({});
    expect(resolveFormViewLayout({ form: { type: 'modal', modalSize: 'auto' as any } })).toStrictEqual({});
    expect(resolveFormViewLayout({ form: { type: 'modal', modalSize: 640 as any } })).toStrictEqual({});
  });

  it('CONTROL: no authored modalSize adds no key', () => {
    expect('modalSize' in resolveFormViewLayout({ form: { type: 'simple', sections: SECTIONS } })).toBe(false);
    expect(resolveFormViewLayout({ form: { type: 'modal' } })).toStrictEqual({});
  });
});

describe('resolveRecordFormModalLayout: the create / edit modal size precedence (objectui#12803)', () => {
  it('desktop (derived auto): the authored modalSize wins', () => {
    expect(resolveRecordFormModalLayout({ form: { type: 'modal', modalSize: 'lg' } }, 'auto')).toStrictEqual({
      modalSize: 'lg',
    });
    expect(
      resolveRecordFormModalLayout({ form: { type: 'simple', sections: SECTIONS, modalSize: 'sm' } }, 'auto'),
    ).toStrictEqual({ sections: SECTIONS, modalSize: 'sm' });
  });

  it('mobile (derived full): an authored size does not shrink the full-screen modal', () => {
    expect(resolveRecordFormModalLayout({ form: { type: 'modal', modalSize: 'lg' } }, 'full')).toStrictEqual({
      modalSize: 'full',
    });
    expect(
      resolveRecordFormModalLayout({ form: { type: 'simple', sections: SECTIONS, modalSize: 'sm' } }, 'full'),
    ).toStrictEqual({ sections: SECTIONS, modalSize: 'full' });
  });

  it('CONTROL desktop: nothing authored leaves no modalSize key, as before', () => {
    expect(resolveRecordFormModalLayout(undefined, 'auto')).toStrictEqual({});
    expect(resolveRecordFormModalLayout({ name: 'x' } as any, 'auto')).toStrictEqual({});
    expect(
      resolveRecordFormModalLayout({ form: { type: 'simple', sections: SECTIONS } }, 'auto'),
    ).toStrictEqual({ sections: SECTIONS });
  });

  it('CONTROL mobile: nothing authored still derives the full-screen modal, as before', () => {
    expect(resolveRecordFormModalLayout(undefined, 'full')).toStrictEqual({ modalSize: 'full' });
    expect(
      resolveRecordFormModalLayout({ form: { type: 'simple', sections: SECTIONS } }, 'full'),
    ).toStrictEqual({ sections: SECTIONS, modalSize: 'full' });
  });
});
