/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `useActionTextLocalizer` (objectui#12757) — every declared `I18nLabel` copy
 * leaves the hook as a string.
 *
 * The spec types `label`, `confirmText`, `successMessage` and `errorMessage`
 * as `I18nLabel`. The hook collapsed `label` and `successMessage` only, and
 * only on a NAMED action, so a nameless inline action (`element:button`'s)
 * and any action's `confirmText` / `errorMessage` map reached the runner, which
 * has no language, as an object.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { useActionTextLocalizer } from '../useActionTextLocalizer';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(I18nProvider, {
    config: { defaultLanguage: 'zh-CN', detectBrowserLanguage: false },
    children,
  });

function setup() {
  const { result } = renderHook(
    () => ({ localize: useActionTextLocalizer(), i18n: useObjectTranslation().i18n }),
    { wrapper },
  );
  return result;
}

const COPY = {
  label: { en: 'Invite member', 'zh-CN': '邀请成员' },
  confirmText: { en: 'Send the invitation?', 'zh-CN': '确认发送邀请吗?' },
  successMessage: { en: 'Invitation sent', 'zh-CN': '邀请已发送' },
  errorMessage: { en: 'Invitation failed', 'zh-CN': '邀请失败' },
};

const ZH = {
  label: '邀请成员',
  confirmText: '确认发送邀请吗?',
  successMessage: '邀请已发送',
  errorMessage: '邀请失败',
};

describe('useActionTextLocalizer collapses every declared I18nLabel copy (objectui#12757)', () => {
  it('a nameless action: all four maps collapse to the active language', () => {
    const result = setup();
    const out = result.current.localize(undefined, { type: 'api', target: '/x', ...COPY });
    expect(out).toEqual({ type: 'api', target: '/x', ...ZH });
  });

  it('a named action with no bundle entry: all four maps collapse to the active language', () => {
    const result = setup();
    const out = result.current.localize(undefined, { name: 'invite_member', type: 'api', ...COPY });
    expect(out).toEqual({ name: 'invite_member', type: 'api', ...ZH });
  });

  it('a bundle entry still outranks the collapsed map', () => {
    const result = setup();
    result.current.i18n.addResourceBundle(
      result.current.i18n.language,
      'translation',
      { cloud: { globalActions: { invite_member: { confirmText: '真的发送吗?' } } } },
      true,
      true,
    );
    const out = result.current.localize(undefined, { name: 'invite_member', type: 'api', ...COPY });
    expect(out.confirmText).toBe('真的发送吗?');
    expect(out.successMessage).toBe('邀请已发送');
  });

  it('CONTROL: a nameless action whose copy is already text comes back as the same object', () => {
    const result = setup();
    const action = { type: 'api', label: 'Invite', confirmText: 'Sure?', successMessage: 'Sent', errorMessage: 'Failed' };
    expect(result.current.localize(undefined, action)).toBe(action);
  });
});
