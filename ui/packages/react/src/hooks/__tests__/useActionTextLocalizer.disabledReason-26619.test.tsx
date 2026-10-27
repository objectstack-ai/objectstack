/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26619 — the reason a greyed action gives, `disabledReason`,
 * resolves like the action's other copy: the bundle's sentence at
 * `_actions.<name>.disabledReason` (or `globalActions.<name>.disabledReason`
 * for an object-less action), else the authored `I18nLabel` collapsed to the
 * active language. Like `confirmText`, it is resolved only when the action
 * DECLARES one, so a bundle cannot give a reason to an action whose author
 * wrote none (that action keeps the surface's default reason).
 *
 * Measured under a real `I18nProvider`, reading what the localizer returns.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { useActionTextLocalizer } from '../useActionTextLocalizer';

afterEach(() => cleanup());

const SUBMIT = {
  name: 'submit_for_approval',
  type: 'script',
  label: 'Submit for approval',
  disabled: { dialect: 'cel', source: "record.legal_review_status != 'approved'" },
  disabledReason: 'An approved legal review is required first.',
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
  clm: {
    objects: {
      clm_contract: { _actions: { submit_for_approval: { disabledReason: '需先通过法务审核。' } } },
    },
    globalActions: { open_inbox: { disabledReason: '收件箱暂不可用。' } },
  },
};

describe('useActionTextLocalizer — disabledReason (objectstack#26619)', () => {
  it('no bundle entry: the authored string is the answer', () => {
    const result = harness('en');
    expect(result.current.localize('clm_contract', SUBMIT).disabledReason)
      .toBe('An approved legal review is required first.');
  });

  it("the bundle's sentence outranks the authored text, read off the action's own object", () => {
    const result = harness('zh', zhBundle);
    expect(result.current.localize('clm_contract', SUBMIT).disabledReason).toBe('需先通过法务审核。');
  });

  it('an inline locale map collapses to the active language before the bundle is asked', () => {
    const result = harness('zh');
    const localized = result.current.localize('clm_contract', {
      ...SUBMIT,
      disabledReason: { en: 'Legal review first.', 'zh-CN': '请先完成法务审核。' },
    });
    expect(localized.disabledReason).toBe('请先完成法务审核。');
  });

  it('an object-less action reads `globalActions.<name>.disabledReason`', () => {
    const result = harness('zh', zhBundle);
    const localized = result.current.localize(undefined, {
      name: 'open_inbox', type: 'url', label: 'Inbox', disabled: true, disabledReason: 'The inbox is offline.',
    });
    expect(localized.disabledReason).toBe('收件箱暂不可用。');
  });

  it('an action that declares no reason gets none, even when the bundle holds one', () => {
    const result = harness('zh', zhBundle);
    const { disabledReason: _omit, ...undeclared } = SUBMIT;
    const localized = result.current.localize('clm_contract', undeclared);
    expect('disabledReason' in localized).toBe(false);
  });

  it('a nameless action has no bundle key: its map still collapses to one string', () => {
    const result = harness('zh');
    const localized = result.current.localize('clm_contract', {
      type: 'script', label: 'Inline', disabled: true,
      disabledReason: { en: 'Not yet.', 'zh-CN': '暂不可用。' },
    });
    expect(localized.disabledReason).toBe('暂不可用。');
  });
});
