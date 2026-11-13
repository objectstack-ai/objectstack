// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32905 — the History item tool reads and restores the versions
 * of the holder its item page names. A by-package name (ADR-0150 D3) is held
 * per package, and the server numbers its versions across every holder: the
 * routed page sends the item page's `?package=` to `history()` and
 * `rollback()`, as the item page's own layered read does. `all` and the empty
 * spelling name no package, as on the server's doors; no `?package=`, no
 * `packageId` (CONTROL — a name one holder holds reads as before).
 *
 * Real: the page, `HistoryPanel` and React Router. Stubbed: the metadata client and types.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const client = {
  history: vi.fn(async () => ({
    events: [{ seq: 1, version: 1, op: 'save', at: '2026-11-13T00:00:00Z', payload: { name: 'shared_flow' } }],
  })),
  rollback: vi.fn(async () => ({ success: true })),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
  useMetadataTypes: () => ({ loading: false, error: null, entries: [{ type: 'flow', label: 'Flow', domain: 'automation' }] }),
}));
vi.mock('../metadata-admin/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

import { MetadataResourceHistoryPage, historyPackageOf } from './ResourceHistoryPage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="metadata/:type/:name/history" element={<MetadataResourceHistoryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('History item tool — the item page\'s `?package=` names the holder (objectstack#32905)', () => {
  it('`?package=` reaches history() and rollback()', async () => {
    renderAt('/metadata/flow/shared_flow/history?package=com.acme.alpha.custom');
    await waitFor(() =>
      expect(client.history).toHaveBeenCalledWith('flow', 'shared_flow', { limit: 100, packageId: 'com.acme.alpha.custom' }),
    );
    const [button] = await screen.findAllByTitle('Rollback to this version');
    fireEvent.click(button!);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByTestId('history-rollback-confirm-action'));
    await waitFor(() =>
      expect(client.rollback).toHaveBeenCalledWith('flow', 'shared_flow', 1, { packageId: 'com.acme.alpha.custom' }),
    );
  });

  it('CONTROL: no `?package=` sends no `packageId` on either door', async () => {
    renderAt('/metadata/flow/solo_flow/history');
    await waitFor(() => expect(client.history).toHaveBeenCalledWith('flow', 'solo_flow', { limit: 100 }));
    const [button] = await screen.findAllByTitle('Rollback to this version');
    fireEvent.click(button!);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByTestId('history-rollback-confirm-action'));
    await waitFor(() => expect(client.rollback).toHaveBeenCalledWith('flow', 'solo_flow', 1));
  });

  it('`all` and the empty spelling name no package, as on the server\'s doors', () => {
    expect(historyPackageOf('?package=all')).toBeUndefined();
    expect(historyPackageOf('?package=')).toBeUndefined();
    expect(historyPackageOf('')).toBeUndefined();
    expect(historyPackageOf('?scope=environment&package=com.acme.beta')).toBe('com.acme.beta');
  });
});
