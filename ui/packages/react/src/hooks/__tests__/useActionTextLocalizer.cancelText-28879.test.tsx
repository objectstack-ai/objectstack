/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28879 — the dismiss label of an action's confirm dialog,
 * `cancelText`, resolves like the action's other copy on the confirm path: the
 * bundle's label at `_actions.<name>.cancelText` (or
 * `globalActions.<name>.cancelText` for an object-less action), else the
 * authored `I18nLabel` collapsed to the active language. Like `confirmText`,
 * it is resolved only when the action DECLARES one, so a bundle cannot relabel
 * the dismiss button of an action whose author wrote none (that dialog keeps
 * its default "Cancel").
 *
 * Measured under a real `I18nProvider`, reading what the localizer returns.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { useActionTextLocalizer } from '../useActionTextLocalizer';

afterEach(() => cleanup());

const CANCEL_INVITATION = {
  name: 'cancel_invitation',
  type: 'api',
  label: 'Cancel Invitation',
  confirmText: 'Cancel this invitation?',
  cancelText: 'Keep invitation',
};

function harness(language: string, bundle?: Record<string, unknown>) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      {children}
    </I18nProvider>
  );
  const { result } = renderHook(
    () => ({ localize: useActionTextLocalizer(), translation: useObjectTranslation() }),
    { wrapper },
  );
  if (bundle) result.current.translation.i18n.addResourceBundle(language, 'translation', bundle, true, true);
  return result;
}

const zhBundle = {
  sys: {
    objects: {
      sys_invitation: { _actions: { cancel_invitation: { cancelText: '保留邀请' } } },
    },
    globalActions: { close_period: { cancelText: '保持打开' } },
  },
};

describe('useActionTextLocalizer — cancelText (objectstack#28879)', () => {
  it('no bundle entry: the authored string is the answer', () => {
    const result = harness('en');
    expect(result.current.localize('sys_invitation', CANCEL_INVITATION).cancelText).toBe('Keep invitation');
  });

  it("the bundle's label outranks the authored text, read off the action's own object", () => {
    const result = harness('zh', zhBundle);
    expect(result.current.localize('sys_invitation', CANCEL_INVITATION).cancelText).toBe('保留邀请');
  });

  it('an inline locale map collapses to the active language before the bundle is asked', () => {
    const result = harness('zh');
    const localized = result.current.localize('sys_invitation', {
      ...CANCEL_INVITATION,
      cancelText: { en: 'Keep it', 'zh-CN': '先留着' },
    });
    expect(localized.cancelText).toBe('先留着');
  });

  it('an object-less action reads `globalActions.<name>.cancelText`', () => {
    const result = harness('zh', zhBundle);
    const localized = result.current.localize(undefined, {
      name: 'close_period', type: 'script', label: 'Close Period', confirmText: 'Close it?', cancelText: 'Keep open',
    });
    expect(localized.cancelText).toBe('保持打开');
  });

  it('an action that declares no cancelText gets none, even when the bundle holds one', () => {
    const result = harness('zh', zhBundle);
    const { cancelText: _omit, ...undeclared } = CANCEL_INVITATION;
    const localized = result.current.localize('sys_invitation', undeclared);
    expect('cancelText' in localized).toBe(false);
  });

  it('a nameless action has no bundle key: its map still collapses to one string', () => {
    const result = harness('zh');
    const localized = result.current.localize('sys_invitation', {
      type: 'script', label: 'Inline', confirmText: 'Sure?',
      cancelText: { en: 'Not now', 'zh-CN': '暂不' },
    });
    expect(localized.cancelText).toBe('暂不');
  });
});
