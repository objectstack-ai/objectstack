/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11344 — an action's outcome copy reaches the toast in the user's
 * locale, through the real path: `useActionTextLocalizer` resolves it at render
 * (bundle entry, else the authored `I18nLabel` collapsed to the active
 * language), and the provider's runner picks the entry the answer's `outcome`
 * names and fills in its `${result.*}` tokens after the action has run.
 *
 * Measured end to end under a real `I18nProvider` and a real `<ActionProvider>`,
 * reading what the host's `onToast` receives. Two locales, two sources:
 *
 *   - zh-CN, the copy carried INLINE as an `I18nLabel` map on the action;
 *   - ja-JP, the copy carried by the app's translation BUNDLE under
 *     `_actions.<name>.outcomeMessages.<outcome>`, outranking the authored text.
 *
 * In both, the handler's answer also carries an English `message`; a row can
 * only go green when that is not what the user saw.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import type { ActionDef, ActionResult, ToastHandler } from '@object-ui/core';
import { ActionProvider, useAction } from '../../context/ActionContext';
import { useActionTextLocalizer } from '../useActionTextLocalizer';

afterEach(() => cleanup());

/** What cloud's `delete_environment` answers with: facts, plus a legacy English sentence. */
const ANSWER: ActionResult = {
  success: true,
  data: { outcome: 'archived', name: 'prod', message: 'Environment prod archived.' },
};

/** The authored action, as an object's `actions` array declares it. */
const DELETE_ENVIRONMENT = {
  name: 'delete_environment',
  type: 'script',
  label: 'Delete environment',
  locations: ['record_header'],
  outcomeMessages: {
    archived: {
      en: 'Environment ${result.name} archived',
      'zh-CN': '环境 ${result.name} 已归档',
      'ja-JP': '環境 ${result.name} をアーカイブしました (inline)',
    },
    already_archived: 'Environment ${result.name} was already archived',
  },
  successMessage: 'Environment ${result.name} updated',
};

function harness(language: 'zh-CN' | 'ja-JP' | 'en', onToast: ToastHandler) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <ActionProvider onToast={onToast} handlers={{ script: async () => ANSWER }}>
        {children}
      </ActionProvider>
    </I18nProvider>
  );
  return renderHook(
    () => ({
      action: useAction(),
      localize: useActionTextLocalizer(),
      translation: useObjectTranslation(),
    }),
    { wrapper },
  );
}

/**
 * What a host hands the runner: the localizer's output. The localizer is
 * generic over the action's shape (it returns the type it was given), while its
 * work is a RUNTIME change of shape — an `I18nLabel` map in, a string out — so
 * the static type cannot say so. The hosts type the same hop as `any`
 * (`RecordDetailView`'s `(a: any) => localizeActionTexts(…)`); this names it.
 */
const dispatched = (localized: Record<string, unknown>) => localized as ActionDef;

/** The text of the one success toast a run raised. */
function successToast(onToast: ReturnType<typeof vi.fn<ToastHandler>>): string {
  const calls = onToast.mock.calls.filter(([, options]) => options?.type === 'success');
  expect(calls).toHaveLength(1);
  return calls[0][0];
}

describe('outcome copy reaches the toast in the user\'s locale (objectui#11344)', () => {
  it('zh-CN — the inline I18nLabel map resolves to zh-CN, and ${result.*} is filled in after the run', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = harness('zh-CN', onToast);
    expect(result.current.translation.language).toBe('zh-CN');

    const localized = result.current.localize('environment', DELETE_ENVIRONMENT);
    // At render the copy is a TEMPLATE: the action has not run, so the token
    // is still there, and the map is already one string.
    expect(localized.outcomeMessages).toEqual({
      archived: '环境 ${result.name} 已归档',
      already_archived: 'Environment ${result.name} was already archived',
    });

    await act(async () => {
      await result.current.action.execute(dispatched(localized));
    });

    expect(successToast(onToast)).toBe('环境 prod 已归档');
  });

  it('ja-JP — the bundle entry for the outcome outranks the authored text, token intact through i18next', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = harness('ja-JP', onToast);
    expect(result.current.translation.language).toBe('ja-JP');
    result.current.translation.i18n.addResourceBundle(
      'ja-JP',
      'translation',
      {
        cloud: {
          objects: {
            environment: {
              _actions: {
                delete_environment: {
                  outcomeMessages: { archived: '環境 ${result.name} をアーカイブしました' },
                },
              },
            },
          },
        },
      },
      true,
      true,
    );

    const localized = result.current.localize('environment', {
      ...DELETE_ENVIRONMENT,
      outcomeMessages: { archived: 'Environment ${result.name} archived' },
    });
    expect(localized.outcomeMessages).toEqual({ archived: '環境 ${result.name} をアーカイブしました' });

    await act(async () => {
      await result.current.action.execute(dispatched(localized));
    });

    expect(successToast(onToast)).toBe('環境 prod をアーカイブしました');
  });

  it('a bundle cannot add copy for an outcome the action never declared', () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = harness('en', onToast);
    result.current.translation.i18n.addResourceBundle(
      'en',
      'translation',
      {
        cloud: {
          objects: {
            environment: {
              _actions: {
                delete_environment: { outcomeMessages: { purge_deferred: 'Purge deferred' } },
              },
            },
          },
        },
      },
      true,
      true,
    );

    const localized = result.current.localize('environment', DELETE_ENVIRONMENT);
    expect(Object.keys(localized.outcomeMessages)).toEqual(['archived', 'already_archived']);

    const { outcomeMessages: _o, ...undeclared } = DELETE_ENVIRONMENT;
    expect('outcomeMessages' in result.current.localize('environment', undeclared)).toBe(false);
  });

  it('successMessage is collapsed to the active language too, and stays the second rung', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = harness('zh-CN', onToast);

    const localized = result.current.localize('environment', {
      ...DELETE_ENVIRONMENT,
      outcomeMessages: { already_archived: 'Environment ${result.name} was already archived' },
      successMessage: { en: 'Environment ${result.name} updated', 'zh-CN': '环境 ${result.name} 已更新' },
    });
    expect(localized.successMessage).toBe('环境 ${result.name} 已更新');

    await act(async () => {
      await result.current.action.execute(dispatched(localized));
    });

    // `archived` has no entry, so the second rung is shown — in zh-CN, not the
    // answer's English `message`.
    expect(successToast(onToast)).toBe('环境 prod 已更新');
  });
});
