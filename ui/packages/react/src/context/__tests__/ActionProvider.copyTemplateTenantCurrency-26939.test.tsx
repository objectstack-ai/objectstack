/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26939 — both React owners of an `ActionRunner` install the
 * tenant default currency on it (`useActionRunnerTenantCurrency`, which reads
 * `useLocalization().currency`), so a copy template's `{{ x | currency }}`
 * hole with no argument formats in it. With none set, the sentence is shown
 * as written: never in USD.
 *
 * Measured by running a real action through a real provider under a real
 * `I18nProvider` and `LocalizationProvider`. Expected strings come from `Intl`
 * itself, so a newer ICU cannot drift them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import type { ActionResult, ToastHandler } from '@object-ui/core';
import { ActionProvider, useAction } from '../ActionContext';
import { useActionRunner } from '../../hooks/useActionRunner';

afterEach(() => cleanup());

const AMOUNT = 1234.5;
const money = (currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(AMOUNT);
const CONFIG = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;
const SUCCEEDS = async (): Promise<ActionResult> => ({ success: true, data: { total: AMOUNT } });
const SUCCESS_COPY = { dialect: 'template' as const, source: 'Total {{ result.total | currency }}' };

function localization(currency: string | undefined) {
  return ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={CONFIG} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en-US', currency }}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

describe('<ActionProvider> — a no-argument currency hole formats in the tenant default', () => {
  function providerHarness(currency: string | undefined, onToast: ToastHandler) {
    const Outer = localization(currency);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Outer>
        <ActionProvider context={{}} onToast={onToast} handlers={{ script: SUCCEEDS }}>
          {children}
        </ActionProvider>
      </Outer>
    );
    return renderHook(() => useAction(), { wrapper });
  }

  it('successMessage formats in the tenant default currency', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = providerHarness('CNY', onToast);
    await act(async () => {
      await result.current.execute({ type: 'script', name: 'reprice', successMessage: SUCCESS_COPY });
    });
    expect(onToast).toHaveBeenCalledWith(`Total ${money('CNY')}`, expect.objectContaining({ type: 'success' }));
  });

  it('with no tenant default the sentence is shown as written', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = providerHarness(undefined, onToast);
    await act(async () => {
      await result.current.execute({ type: 'script', name: 'reprice', successMessage: SUCCESS_COPY });
    });
    expect(onToast).toHaveBeenCalledWith(SUCCESS_COPY.source, expect.objectContaining({ type: 'success' }));
  });
});

describe('useActionRunner — a no-argument currency hole formats in the tenant default', () => {
  it('successMessage formats in the tenant default currency', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = renderHook(() => useActionRunner({ context: {}, onToast }), { wrapper: localization('EUR') });
    result.current.runner.registerHandler('script', SUCCEEDS);
    await act(async () => {
      await result.current.execute({ type: 'script', name: 'reprice', successMessage: SUCCESS_COPY });
    });
    expect(onToast).toHaveBeenCalledWith(`Total ${money('EUR')}`, expect.objectContaining({ type: 'success' }));
  });
});
