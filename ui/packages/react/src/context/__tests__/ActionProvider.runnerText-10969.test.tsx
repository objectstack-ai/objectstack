/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10969 — the runner's other own text reaches a host's toast in the
 * session's language through `<ActionProvider>`.
 *
 * objectui#10900 made `<ActionProvider>` and `useActionRunner` install the
 * session's `t` on the runner they build, and the runner asked it for one
 * string: the default success toast. Three more of the runner's own strings
 * now go through that translator: the error toast when the error carries no
 * readable message, a parallel chain's error when no failed action reported
 * one, and the Undo label the runner hands the toast handler for an undoable
 * success toast — the label both console toast handlers render
 * (`useConsoleActionRuntime` and `RecordDetailView`, each `options.undo.label`
 * before its own English fallback). Measured by running a real action through
 * a real provider under a real `I18nProvider`, and reading what the host's
 * `onToast` receives. The en runs are the controls.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider } from '@object-ui/i18n';
import { globalUndoManager, type ActionResult, type ToastHandler } from '@object-ui/core';
import { ActionProvider, useAction } from '../ActionContext';

afterEach(() => {
  cleanup();
  globalUndoManager.clear();
});

const ZH_CONFIG = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;
const EN_CONFIG = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

/** A handler bug leaking a non-string error with no `message`. */
const LEAKS_AN_OBJECT = async (): Promise<ActionResult> =>
  ({ success: false, error: { code: 'E_UNKNOWN' } as unknown as string });
const FAILS_SILENTLY = async (): Promise<ActionResult> => ({ success: false });
const UNDOABLE = async (): Promise<ActionResult> => ({
  success: true,
  undo: {
    id: 'undo-task-1',
    type: 'update',
    objectName: 'task',
    recordId: '1',
    timestamp: 0,
    description: 'Close',
    undoData: { status: 'open' },
    redoData: { status: 'closed' },
  },
});

/** One `script` dispatch; the action's name picks what it answers. */
const BY_NAME: Record<string, () => Promise<ActionResult>> = {
  sync: LEAKS_AN_OBJECT,
  a: FAILS_SILENTLY,
  b: FAILS_SILENTLY,
  close_task: UNDOABLE,
};
const SCRIPT = async (action: { name?: string }): Promise<ActionResult> => BY_NAME[action.name ?? '']();

function providerHarness(config: typeof ZH_CONFIG | typeof EN_CONFIG, onToast: ToastHandler) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={config} persistLanguage={false}>
      <ActionProvider onToast={onToast} handlers={{ script: SCRIPT }}>
        {children}
      </ActionProvider>
    </I18nProvider>
  );
  return renderHook(() => useAction(), { wrapper });
}

describe('<ActionProvider> — the runner text beside the success toast (objectui#10969)', () => {
  it('zh: the error toast for an error with no readable message is Chinese', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = providerHarness(ZH_CONFIG, onToast);
    await act(async () => {
      await result.current.execute({ type: 'script', name: 'sync' });
    });
    expect(onToast).toHaveBeenCalledWith('操作失败', expect.objectContaining({ type: 'error' }));
    expect(onToast).not.toHaveBeenCalledWith('Action failed', expect.anything());
  });

  it('en: the same toast is unchanged English', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = providerHarness(EN_CONFIG, onToast);
    await act(async () => {
      await result.current.execute({ type: 'script', name: 'sync' });
    });
    expect(onToast).toHaveBeenCalledWith('Action failed', expect.objectContaining({ type: 'error' }));
  });

  it('zh: the Undo label handed to the toast handler is Chinese', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = providerHarness(ZH_CONFIG, onToast);
    await act(async () => {
      await result.current.execute({ type: 'script', name: 'close_task', successMessage: 'Closed' });
    });
    expect(onToast).toHaveBeenCalledWith('Closed', expect.objectContaining({ undo: { label: '撤销' } }));
  });

  it('en: the Undo label is unchanged English', async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = providerHarness(EN_CONFIG, onToast);
    await act(async () => {
      await result.current.execute({ type: 'script', name: 'close_task', successMessage: 'Closed' });
    });
    expect(onToast).toHaveBeenCalledWith('Closed', expect.objectContaining({ undo: { label: 'Undo' } }));
  });

  it("zh: a parallel chain's error when no failed action reported one is Chinese", async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = providerHarness(ZH_CONFIG, onToast);
    let chain: ActionResult | undefined;
    await act(async () => {
      chain = await result.current.executeChain(
        [{ type: 'script', name: 'a' }, { type: 'script', name: 'b' }],
        'parallel',
      );
    });
    expect(chain).toEqual({ success: false, error: '一个或多个并行操作失败' });
  });

  it("en: the parallel chain's error is unchanged English", async () => {
    const onToast = vi.fn<ToastHandler>();
    const { result } = providerHarness(EN_CONFIG, onToast);
    let chain: ActionResult | undefined;
    await act(async () => {
      chain = await result.current.executeChain(
        [{ type: 'script', name: 'a' }, { type: 'script', name: 'b' }],
        'parallel',
      );
    });
    expect(chain).toEqual({ success: false, error: 'One or more parallel actions failed' });
  });
});
