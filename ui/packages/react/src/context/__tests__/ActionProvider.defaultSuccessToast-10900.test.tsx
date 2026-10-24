/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10900 — the generic action success toast speaks the session's
 * language through both React owners of an `ActionRunner`.
 *
 * The 2026-09-28 cloud E2E, browser in zh-CN, read "Action completed
 * successfully" after a welcome CTA. That string is the runner's fallback for
 * an action with no `successMessage` and no server message, and nothing
 * translated it. `<ActionProvider>` and `useActionRunner` now install the
 * session's `t` on the runner they build (`useActionRunnerTranslator`), so every
 * host whose toasts come through either one gets the pack value. Measured by
 * running a real action through a real provider under a real `I18nProvider`,
 * and reading what the host's `onToast` receives.
 *
 * The author's `successMessage` is the control: it is the author's text in the
 * author's language and must reach the toast verbatim under zh.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import type { ActionResult, ToastHandler } from '@object-ui/core';
import { ActionProvider, useAction } from '../ActionContext';
import { useActionRunner } from '../../hooks/useActionRunner';

afterEach(() => cleanup());

const EN = 'Action completed successfully';
/** `actions.completedSuccessfully` in the zh pack. */
const ZH = '操作已成功完成';

const ZH_CONFIG = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;
const EN_CONFIG = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

const SUCCEEDS = async (): Promise<ActionResult> => ({ success: true });

function providerHarness(config: typeof ZH_CONFIG | typeof EN_CONFIG, onToast: ToastHandler) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={config} persistLanguage={false}>
      <ActionProvider onToast={onToast} handlers={{ script: SUCCEEDS }}>
        {children}
      </ActionProvider>
    </I18nProvider>
  );
  return renderHook(() => ({ action: useAction(), i18n: useObjectTranslation() }), { wrapper });
}

describe('<ActionProvider> — the default success toast (objectui#10900)', () => {
  it('reads the zh pack value under a zh session', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = providerHarness(ZH_CONFIG, onToast);

    await act(async () => {
      await result.current.action.execute({ type: 'script', name: 'welcome_cta' });
    });

    expect(onToast).toHaveBeenCalledWith(ZH, expect.objectContaining({ type: 'success' }));
    expect(onToast).not.toHaveBeenCalledWith(EN, expect.anything());
  });

  it('stays English under an en session', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = providerHarness(EN_CONFIG, onToast);

    await act(async () => {
      await result.current.action.execute({ type: 'script', name: 'welcome_cta' });
    });

    expect(onToast).toHaveBeenCalledWith(EN, expect.objectContaining({ type: 'success' }));
  });

  it("the author's successMessage reaches the toast verbatim under zh", async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = providerHarness(ZH_CONFIG, onToast);

    await act(async () => {
      await result.current.action.execute({
        type: 'script',
        name: 'welcome_cta',
        successMessage: 'Welcome aboard',
      });
    });

    expect(onToast).toHaveBeenCalledWith('Welcome aboard', expect.objectContaining({ type: 'success' }));
    expect(onToast).not.toHaveBeenCalledWith(ZH, expect.anything());
  });

  it('follows a language switch without rebuilding the runner', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = providerHarness(EN_CONFIG, onToast);
    const runnerBefore = result.current.action.runner;

    await act(async () => {
      await result.current.i18n.changeLanguage('zh');
    });
    // The runner is keyed on `context` only; the switch must not have replaced
    // it, so what is measured below is the translator reading the latest `t`.
    expect(result.current.action.runner).toBe(runnerBefore);

    await act(async () => {
      await result.current.action.execute({ type: 'script', name: 'welcome_cta' });
    });

    expect(onToast).toHaveBeenLastCalledWith(ZH, expect.objectContaining({ type: 'success' }));
  });
});

describe('useActionRunner — the default success toast (objectui#10900)', () => {
  function hookHarness(config: typeof ZH_CONFIG | typeof EN_CONFIG, onToast: ToastHandler) {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <I18nProvider config={config} persistLanguage={false}>
        {children}
      </I18nProvider>
    );
    return renderHook(() => useActionRunner({ context: {}, onToast }), { wrapper });
  }

  it('reads the zh pack value under a zh session', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = hookHarness(ZH_CONFIG, onToast);
    result.current.runner.registerHandler('script', SUCCEEDS);

    await act(async () => {
      await result.current.execute({ type: 'script', name: 'welcome_cta' });
    });

    expect(onToast).toHaveBeenCalledWith(ZH, expect.objectContaining({ type: 'success' }));
  });

  it('stays English under an en session', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = hookHarness(EN_CONFIG, onToast);
    result.current.runner.registerHandler('script', SUCCEEDS);

    await act(async () => {
      await result.current.execute({ type: 'script', name: 'welcome_cta' });
    });

    expect(onToast).toHaveBeenCalledWith(EN, expect.objectContaining({ type: 'success' }));
  });
});
