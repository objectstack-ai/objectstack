// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13333 — a type-level action's `confirmText` is asked in the
 * console's in-app AlertDialog, whose title names the action and the item it
 * runs on, never through the browser's native `confirm()`.
 *
 * What is pinned:
 *  - (a) record header: the title names the action and `recordId`, the body is
 *    the action's `confirmText`; accepting runs the request once.
 *  - (b) CONTROL: Cancel runs nothing.
 *  - (c) list toolbar (no `recordId`): the title names the action alone.
 *  - every case: `window.confirm` is never called.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

const fetchSpy = vi.hoisted(() => vi.fn());

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => fetchSpy,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('../ActionResultDialog', () => ({ ActionResultDialog: () => null }));

import { MetadataTypeActions } from './MetadataTypeActions';

const PURGE = {
  name: 'purge_cache',
  label: 'Purge cache',
  type: 'api' as const,
  target: '/api/v1/datasources/${ctx.recordId}/purge',
  confirmText: 'Every cached row of this datasource is dropped.',
  locations: ['record_header', 'list_toolbar'],
};

const nativeConfirm = vi.fn(() => true);
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ success: true, data: { message: 'done' } }),
  }));
  nativeConfirm.mockClear();
  vi.stubGlobal('confirm', nativeConfirm);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(nativeConfirm).not.toHaveBeenCalled();
});

describe('MetadataTypeActions — confirmText is asked in-app and names the item (objectui#13333)', () => {
  it('(a) record header: the title names the action and the item; accepting runs it once', async () => {
    render(<MetadataTypeActions entry={{ actions: [PURGE] as never }} location="record_header" recordId="warehouse" />);
    fireEvent.click(screen.getByRole('button', { name: 'Purge cache' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('Purge cache on "warehouse"?');
    expect(dialog.textContent).toContain(PURGE.confirmText);
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByTestId('type-action-confirm-action'));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/api/v1/datasources/warehouse/purge');
  });

  it('(b) CONTROL: Cancel runs nothing', async () => {
    render(<MetadataTypeActions entry={{ actions: [PURGE] as never }} location="record_header" recordId="warehouse" />);
    fireEvent.click(screen.getByRole('button', { name: 'Purge cache' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByTestId('type-action-confirm-cancel'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('(c) list toolbar: no item, so the title names the action alone', async () => {
    render(<MetadataTypeActions entry={{ actions: [PURGE] as never }} location="list_toolbar" />);
    fireEvent.click(screen.getByRole('button', { name: 'Purge cache' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('Purge cache?');
  });
});
