/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `resolveInlineAriaProps` — the spec's nested `aria` bag to DOM attributes
 * (objectui#11051).
 *
 * `toStrictEqual`, not `toEqual`, throughout: `toEqual` treats a key whose
 * value is `undefined` as absent, and a spread of `{ 'aria-label': undefined }`
 * would still overwrite an attribute set before it. So the result must not
 * contain a key it has no value for.
 *
 * The render half, through `SchemaRenderer` on the four `element:*` renderers
 * that call this, is `@object-ui/components`'
 * `renderers/basic/__tests__/elements.inlineAria-11051.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { resolveInlineAriaProps } from './inlineAria';
import { resolveKeyedI18nLabel } from './i18n';

const LOCALE_MAP = { en: 'Order total', 'zh-CN': '订单合计' };

describe('resolveInlineAriaProps (objectui#11051)', () => {
  it('maps a plain-string ariaLabel to aria-label, in every locale', () => {
    for (const locale of ['en', 'zh']) {
      expect(resolveInlineAriaProps({ ariaLabel: 'Plain name' }, locale)).toStrictEqual({
        'aria-label': 'Plain name',
      });
    }
  });

  it('resolves a locale-map ariaLabel against the locale it is given', () => {
    expect(resolveInlineAriaProps({ ariaLabel: LOCALE_MAP }, 'en')).toStrictEqual({ 'aria-label': 'Order total' });
    // `zh` finds the `zh-CN` entry: the spec resolver matches a base tag to a
    // regional one.
    expect(resolveInlineAriaProps({ ariaLabel: LOCALE_MAP }, 'zh')).toStrictEqual({ 'aria-label': '订单合计' });
    expect(resolveInlineAriaProps({ ariaLabel: LOCALE_MAP }, 'zh-CN')).toStrictEqual({ 'aria-label': '订单合计' });
  });

  it('an undefined locale resolves as en, the spec resolver’s default', () => {
    expect(resolveInlineAriaProps({ ariaLabel: LOCALE_MAP }, undefined)).toStrictEqual({ 'aria-label': 'Order total' });
  });

  it('maps ariaDescribedBy to aria-describedby and role to role', () => {
    expect(resolveInlineAriaProps({ ariaDescribedBy: 'hint-1' }, 'en')).toStrictEqual({ 'aria-describedby': 'hint-1' });
    expect(resolveInlineAriaProps({ role: 'status' }, 'en')).toStrictEqual({ role: 'status' });
    expect(
      resolveInlineAriaProps({ ariaLabel: LOCALE_MAP, ariaDescribedBy: 'hint-1', role: 'status' }, 'zh'),
    ).toStrictEqual({ 'aria-label': '订单合计', 'aria-describedby': 'hint-1', role: 'status' });
  });

  it('gives no attributes for a missing bag, or a value that is not an object', () => {
    expect(resolveInlineAriaProps(undefined, 'en')).toStrictEqual({});
    expect(resolveInlineAriaProps(null, 'en')).toStrictEqual({});
    expect(resolveInlineAriaProps('Plain name' as never, 'en')).toStrictEqual({});
    expect(resolveInlineAriaProps({}, 'en')).toStrictEqual({});
  });

  it('leaves out an empty name, description or role instead of writing an empty attribute', () => {
    expect(resolveInlineAriaProps({ ariaLabel: '', ariaDescribedBy: '', role: '' }, 'en')).toStrictEqual({});
    // A map with no usable entry resolves to nothing.
    expect(resolveInlineAriaProps({ ariaLabel: {} }, 'en')).toStrictEqual({});
  });

  it('does not read a key the bag does not declare', () => {
    // The helper this replaced put `aria-` in front of every key, so `label`
    // became `aria-label` and a raw `aria-label` passed through. The spec
    // refuses both keys when a document is parsed, so neither is read here.
    expect(resolveInlineAriaProps({ label: 'Legacy' } as never, 'en')).toStrictEqual({});
    expect(resolveInlineAriaProps({ 'aria-label': 'Raw' } as never, 'en')).toStrictEqual({});
    expect(resolveInlineAriaProps({ ariaLabel: 'Name', live: 'polite' } as never, 'en')).toStrictEqual({
      'aria-label': 'Name',
    });
  });

  it('is not the keyed reader: the flat channel’s resolver gives nothing for the same locale map', () => {
    // Why the two readers stay separate (objectui#4580 Q2-B): the keyed
    // resolver `SchemaRenderer` uses for the FLAT `ariaLabel` returns
    // `undefined` for an inline locale map.
    expect(resolveKeyedI18nLabel(LOCALE_MAP as never)).toBeUndefined();
    expect(resolveInlineAriaProps({ ariaLabel: LOCALE_MAP }, 'en')['aria-label']).toBe('Order total');
  });
});
