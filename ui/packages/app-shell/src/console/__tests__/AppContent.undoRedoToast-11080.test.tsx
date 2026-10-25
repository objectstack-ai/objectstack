// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11080 — the console's global Ctrl+Z / Ctrl+Shift+Z toasts read the
 * session's language.
 *
 * `AppContent` mounts `useGlobalUndo` on every console route. Its `onUndo` /
 * `onRedo` raised `Undo: <description>` / `Redo: <description>` from template
 * strings, so a zh-CN session saw the English prefix. Both now read a pack key
 * beside `actions.undo` (`actions.undoneOperation` / `actions.redoneOperation`)
 * through the translator `AppContent` already holds, with the operation's
 * description interpolated unchanged.
 *
 * Harness: the real `AppContent` (routing reduced to the zero-app empty state,
 * the same reduction as `AppContent.noAppsCta.test.tsx`) under a real
 * `I18nProvider`, with the REAL `useGlobalUndo`. An operation is pushed onto the
 * real `globalUndoManager`, the real keyboard shortcut is pressed on `window`,
 * the hook writes through the adapter, and the toast that follows is asserted.
 * The en run is the control. The last case pins that an authored label, which
 * is what an operation's description is when the action declared one, reaches
 * the toast byte for byte.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: null,
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

// The adapter is the `dataSource` `useGlobalUndo` writes the undo / redo
// through; `update` is the write an `update` operation makes.
const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
  create: vi.fn(async () => ({})),
  update: vi.fn(async () => ({})),
  delete: vi.fn(async () => ({})),
};
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: [],
    objects: [],
    loading: false,
    ensureType: undefined,
    error: null,
    refresh: async () => {},
  }),
}));

// Orthogonal: the signed-in user's language column. Stubbed so nothing but the
// provider's configured language decides which pack renders.
vi.mock('../../hooks/useUserLocale', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSignedInUserLocale: () => {},
}));

// `useGlobalUndo` stays REAL: it owns the keyboard listener and calls the
// handlers under test.
const actionRunnerStub = { registerHandler: vi.fn(), getContext: () => ({}) };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ({ execute: vi.fn(), runner: actionRunnerStub }),
  useMutationInvalidationBridge: () => {},
}));

import { toast } from 'sonner';
import { I18nProvider } from '@object-ui/i18n';
import { globalUndoManager } from '@object-ui/core';
import { AppContent } from '../AppContent';

const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

function renderConsole(config: typeof ZH | typeof EN) {
  return render(
    <I18nProvider config={config} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/setup']}>
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** What an undoable action leaves on the stack: an `update` with its description. */
function pushOperation(description: string) {
  globalUndoManager.push({
    id: 'undo-crm_call-rec-1',
    type: 'update',
    objectName: 'crm_call',
    recordId: 'rec-1',
    timestamp: 0,
    description,
    undoData: { status: 'open' },
    redoData: { status: 'done' },
  });
}

const pressUndo = () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
const pressRedo = () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
const infoMessages = () => vi.mocked(toast.info).mock.calls.map(([message]) => message);

describe('AppContent — the global undo / redo toasts speak the session language (objectui#11080)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalUndoManager.clear();
  });
  afterEach(() => {
    cleanup();
    globalUndoManager.clear();
  });

  it('zh: Ctrl+Z raises the undo toast from the zh pack', async () => {
    renderConsole(ZH);
    await screen.findByTestId('create-first-app-btn');
    pushOperation('Complete');

    pressUndo();

    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.info).mock.calls[0]).toEqual(['撤销：Complete', { duration: 4000 }]);
    // The undo really ran through the adapter before the toast was raised.
    expect(dataSourceStub.update).toHaveBeenCalledWith('crm_call', 'rec-1', { status: 'open' });
    expect(infoMessages().some((m) => String(m).startsWith('Undo:'))).toBe(false);
  });

  it('zh: Ctrl+Shift+Z raises the redo toast from the zh pack', async () => {
    renderConsole(ZH);
    await screen.findByTestId('create-first-app-btn');
    pushOperation('Complete');
    pressUndo();
    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));

    pressRedo();

    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(2));
    expect(vi.mocked(toast.info).mock.calls[1]).toEqual(['重做：Complete', { duration: 3000 }]);
    expect(dataSourceStub.update).toHaveBeenLastCalledWith('crm_call', 'rec-1', { status: 'done' });
    expect(infoMessages().some((m) => String(m).startsWith('Redo:'))).toBe(false);
  });

  it('en control: the same presses read the unchanged English text', async () => {
    renderConsole(EN);
    await screen.findByTestId('create-first-app-btn');
    pushOperation('Complete');

    pressUndo();
    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
    pressRedo();
    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(2));

    expect(infoMessages()).toEqual(['Undo: Complete', 'Redo: Complete']);
  });

  it('an authored label reaches the zh toast byte for byte', async () => {
    // An operation's description is the action's `label` when it declared one;
    // the pack supplies only the words around it, and nothing escapes it.
    const label = '标记为赢单 & notify "owner"';
    renderConsole(ZH);
    await screen.findByTestId('create-first-app-btn');
    pushOperation(label);

    pressUndo();
    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
    pressRedo();
    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(2));

    expect(infoMessages()).toEqual([`撤销：${label}`, `重做：${label}`]);
  });
});
