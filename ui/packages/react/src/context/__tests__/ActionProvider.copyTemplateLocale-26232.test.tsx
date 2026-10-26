/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26232 — both React owners of an `ActionRunner` install the
 * viewer's display locale on it (`useActionRunnerDisplayLocale`), so a copy
 * template's formatters render in `useDisplayLocale()` instead of `en-US`.
 *
 * Measured by running a real action through a real provider under a real
 * `I18nProvider` and `LocalizationProvider`, and reading what the host's
 * confirm handler and `onToast` receive. Expected strings come from `Intl`
 * itself, so a newer ICU cannot drift them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, LocalizationProvider, useObjectTranslation } from '@object-ui/i18n';
import type { ActionResult, ToastHandler } from '@object-ui/core';
import { ActionProvider, useAction } from '../ActionContext';
import { useActionRunner } from '../../hooks/useActionRunner';

afterEach(() => cleanup());

const AMOUNT = 1234567.5;
const money = (tag: string) => new Intl.NumberFormat(tag, { style: 'currency', currency: 'EUR' }).format(AMOUNT);
const CONFIG = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;
const SUCCEEDS = async (): Promise<ActionResult> => ({ success: true, data: { total: AMOUNT } });
const SUCCESS_COPY = { dialect: 'template' as const, source: 'Total {{ result.total | currency:EUR }}' };

function providerHarness(locale: string | undefined, onToast: ToastHandler, onConfirm?: (m: string) => Promise<boolean>) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={CONFIG} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>
        <ActionProvider
          context={{ record: { amount: AMOUNT } }}
          onToast={onToast}
          onConfirm={onConfirm}
          handlers={{ script: SUCCEEDS }}
        >
          {children}
        </ActionProvider>
      </LocalizationProvider>
    </I18nProvider>
  );
  return renderHook(() => ({ action: useAction(), i18n: useObjectTranslation() }), { wrapper });
}

describe('<ActionProvider> — copy templates format in the display locale (objectstack#26232)', () => {
  it('successMessage formats in the tenant display locale', async () => {
    expect(money('de-DE')).not.toBe(money('en-US'));
    const onToast = vi.fn<ToastHandler>();
    const { result } = providerHarness('de-DE', onToast);

    await act(async () => {
      await result.current.action.execute({ type: 'script', name: 'reprice', successMessage: SUCCESS_COPY });
    });

    expect(onToast).toHaveBeenCalledWith(`Total ${money('de-DE')}`, expect.objectContaining({ type: 'success' }));
  });

  it('confirmText formats in the display locale; a `locale` param is a value it prints', async () => {
    const onConfirm = vi.fn(async (_message: string) => false);
    const { result } = providerHarness('de-DE', vi.fn<ToastHandler>(), onConfirm);

    await act(async () => {
      await result.current.action.execute({
        type: 'script',
        name: 'reprice',
        confirmText: 'Set {{ record.amount | currency:EUR }} ({{ params.locale }})?',
        params: { locale: 'fr-FR' },
      });
    });

    expect(onConfirm.mock.calls[0][0]).toBe(`Set ${money('de-DE')} (fr-FR)?`);
  });

  it('with no tenant locale, the UI language is the display locale, and a switch reaches the built runner', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = providerHarness(undefined, onToast);
    const runnerBefore = result.current.action.runner;

    await act(async () => {
      await result.current.action.execute({ type: 'script', name: 'reprice', successMessage: SUCCESS_COPY });
    });
    expect(onToast).toHaveBeenLastCalledWith(`Total ${money('en')}`, expect.anything());

    await act(async () => {
      await result.current.i18n.changeLanguage('ja');
    });
    expect(result.current.action.runner).toBe(runnerBefore);

    await act(async () => {
      await result.current.action.execute({ type: 'script', name: 'reprice', successMessage: SUCCESS_COPY });
    });
    expect(onToast).toHaveBeenLastCalledWith(`Total ${money('ja')}`, expect.anything());
  });
});

describe('useActionRunner — copy templates format in the display locale (objectstack#26232)', () => {
  it('successMessage formats in the tenant display locale', async () => {
    const onToast = vi.fn<ToastHandler>();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <I18nProvider config={CONFIG} persistLanguage={false}>
        <LocalizationProvider value={{ locale: 'de-DE' }}>{children}</LocalizationProvider>
      </I18nProvider>
    );
    const { result } = renderHook(() => useActionRunner({ context: {}, onToast }), { wrapper });
    result.current.runner.registerHandler('script', SUCCEEDS);

    await act(async () => {
      await result.current.execute({ type: 'script', name: 'reprice', successMessage: SUCCESS_COPY });
    });

    expect(onToast).toHaveBeenCalledWith(`Total ${money('de-DE')}`, expect.objectContaining({ type: 'success' }));
  });
});
