/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27948 (ruling A, step 2) — an `outcomeMessages` entry becomes a
 * `template` slot like `successMessage`, so a parsed action can carry
 * `{ dialect: 'template', source }` where it carried a string.
 *
 * Read as an `I18nLabel` map, `pickLocalized` collapsed that envelope to its
 * first string value — the word `template` — and the toast said "template".
 * The localizer now keeps the envelope (a bundle entry replaces its `source`),
 * and the runner fills its `{{ }}` holes. Measured through the real path: a
 * real `I18nProvider`, a real `<ActionProvider>`, the text the host's
 * `onToast` receives.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import type { ActionDef, ActionResult, ToastHandler } from '@object-ui/core';
import { ActionProvider, useAction } from '../../context/ActionContext';
import { useActionTextLocalizer } from '../useActionTextLocalizer';

afterEach(() => cleanup());

const ANSWER: ActionResult = { success: true, data: { outcome: 'archived', name: 'prod' } };
const ENVELOPE = { dialect: 'template', source: 'Environment {{ result.name }} archived' };

const ACTION = {
  name: 'delete_environment',
  type: 'script',
  label: 'Delete environment',
  outcomeMessages: { archived: ENVELOPE },
};

function harness(language: 'en' | 'zh-CN', onToast: ToastHandler) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <ActionProvider onToast={onToast} handlers={{ script: async () => ANSWER }}>
        {children}
      </ActionProvider>
    </I18nProvider>
  );
  return renderHook(
    () => ({ action: useAction(), localize: useActionTextLocalizer(), translation: useObjectTranslation() }),
    { wrapper },
  );
}

function successToast(onToast: ReturnType<typeof vi.fn<ToastHandler>>): string {
  const calls = onToast.mock.calls.filter(([, options]) => options?.type === 'success');
  expect(calls).toHaveLength(1);
  return calls[0][0];
}

describe('an outcomeMessages entry written as the template envelope (objectstack#27948)', () => {
  it('no bundle entry — the envelope comes back as written and the toast fills its hole, never "template"', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = harness('en', onToast);
    const localized = result.current.localize('environment', ACTION);
    expect(localized.outcomeMessages).toEqual({ archived: ENVELOPE });

    await act(async () => {
      await result.current.action.execute(localized as ActionDef);
    });
    expect(successToast(onToast)).toBe('Environment prod archived');
  });

  it('a bundle entry replaces the source and keeps the envelope; the toast reads the translation', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = harness('zh-CN', onToast);
    result.current.translation.i18n.addResourceBundle(
      'zh-CN',
      'translation',
      {
        cloud: {
          objects: {
            environment: {
              _actions: { delete_environment: { outcomeMessages: { archived: '环境 {{ result.name }} 已归档' } } },
            },
          },
        },
      },
      true,
      true,
    );
    const localized = result.current.localize('environment', ACTION);
    expect(localized.outcomeMessages).toEqual({ archived: { dialect: 'template', source: '环境 {{ result.name }} 已归档' } });

    await act(async () => {
      await result.current.action.execute(localized as ActionDef);
    });
    expect(successToast(onToast)).toBe('环境 prod 已归档');
  });

  it('CONTROL: a string entry and an I18nLabel map entry read as before', () => {
    const { result } = harness('zh-CN', vi.fn<ToastHandler>());
    const localized = result.current.localize('environment', {
      ...ACTION,
      outcomeMessages: { archived: 'Archived {{ result.name }}', destroyed: { en: 'Destroyed', 'zh-CN': '已删除' } },
    });
    expect(localized.outcomeMessages).toEqual({ archived: 'Archived {{ result.name }}', destroyed: '已删除' });
  });
});
