/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11056 — the console action runtime's undo confirmation toast reads
 * the session's language.
 *
 * objectui#10969 made the Undo button on an undoable success toast read
 * `actions.undo`. Pressing that button runs this runtime's `useGlobalUndo`
 * `onUndo`, which raised a hard-coded English "Change undone" toast — so a
 * zh-CN session saw a Chinese button followed by an English confirmation. The
 * confirmation now reads `actions.undone` through the translator this runtime
 * already holds.
 *
 * Driven end to end: the real `ConsoleActionRuntimeProvider` (so the real
 * `<ActionProvider>`, `ActionRunner` and this runtime's `api` handler) runs an
 * `undoable` action under a real `I18nProvider`. The runner hands the toast
 * handler its Undo label; the toast's Undo button is then pressed, the real
 * `useGlobalUndo` writes the prior value back, and the toast that follows is
 * what is asserted. The en run is the control.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

// Imported for real these drag in the modal/form graph; nothing here renders them.
vi.mock('../useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));
vi.mock('../../views/ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('../../views/ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('../../views/ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('../../views/FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

import { toast } from 'sonner';
import { I18nProvider } from '@object-ui/i18n';
import { globalUndoManager } from '@object-ui/core';
import { useAction } from '@object-ui/react';
import { ConsoleActionRuntimeProvider } from '../useConsoleActionRuntime';

const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

/** An undoable single-record update, run through the runtime's generic `api` branch. */
const CLOSE_TASK = {
  type: 'api',
  name: 'close_task',
  label: 'Close',
  target: 'close_task',
  objectName: 'task',
  undoable: true,
  successMessage: 'Closed',
  bodyExtra: { status: 'closed' },
  params: { _rowRecord: { id: 't_1', status: 'open' } },
};

function Probe() {
  const { execute } = useAction();
  return <button onClick={() => { void execute({ ...CLOSE_TASK } as never); }}>run</button>;
}

const successToasts = () => vi.mocked(toast.success).mock.calls;

/** Run the action, press the success toast's Undo button, return the dataSource. */
async function runThenUndo(config: typeof ZH | typeof EN) {
  const dataSource = {
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
  render(
    <I18nProvider config={config} persistLanguage={false}>
      <ConsoleActionRuntimeProvider dataSource={dataSource} objects={[]} objectName="task">
        <Probe />
      </ConsoleActionRuntimeProvider>
    </I18nProvider>,
  );
  fireEvent.click(await screen.findByText('run'));

  await waitFor(() => expect(successToasts().some(([message]) => message === 'Closed')).toBe(true));
  const [, options] = successToasts().find(([message]) => message === 'Closed')!;
  const undoButton = (options as { action: { label: string; onClick: () => void } }).action;

  await act(async () => { undoButton.onClick(); });
  // The Undo wrote the captured prior value back — the toast below follows it.
  await waitFor(() => expect(dataSource.update).toHaveBeenCalledWith('task', 't_1', { status: 'open' }));
  return { undoLabel: undoButton.label };
}

afterEach(() => {
  cleanup();
  vi.mocked(toast.success).mockClear();
  globalUndoManager.clear();
});

describe('useConsoleActionRuntime — the undo confirmation toast (objectui#11056)', () => {
  it('zh: pressing the Chinese Undo button raises a Chinese confirmation', async () => {
    const { undoLabel } = await runThenUndo(ZH);

    expect(undoLabel).toBe('撤销');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('已撤销更改'));
    expect(toast.success).not.toHaveBeenCalledWith('Change undone');
  });

  it('en: the confirmation is unchanged English', async () => {
    const { undoLabel } = await runThenUndo(EN);

    expect(undoLabel).toBe('Undo');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Change undone'));
  });
});
