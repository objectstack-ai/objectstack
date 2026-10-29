// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27464 — a navigation rename typed into the Interfaces nav editor
 * but not committed yet (it commits on blur or Enter) is unsaved work: a reload
 * or a tab close asks first, as it does for every other held Studio edit.
 *
 * The canvas reports the pending rename and the pillar folds it into the one
 * held-edit report the surface already reads (`useHeldEditReport`), so the
 * surface's single `beforeunload` guard covers it. Rendered through the REAL
 * `StudioDesignSurface` on the real route shape. A bare `AppNavCanvas` (the
 * `AppPreview` caller passes no report) renames as before.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PKG = 'com.acme.app';
const NAV = [{ id: 'nav_qa', type: 'page', label: 'QA Dash', pageName: 'home' }];
const HOME = { name: 'home', label: 'Home', type: 'app', regions: [{ name: 'main', components: [] }] };

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(),
  getDraft: vi.fn(async () => {
    throw Object.assign(new Error('No pending draft'), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async (type: string, name: string, item: unknown) => ({ type, name, item })),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ loading: false, error: null, entries: [] }) };
});
vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => [{ id: PKG, name: 'Acme', writable: true, namespace: 'acme' }]) };
});
vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { AppNavCanvas } from '../metadata-admin/previews/AppNavCanvas';

window.matchMedia = ((query: string) => ({
  matches: false, media: query, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} };

beforeEach(() => {
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  mockClient.layered.mockImplementation(async (type: string) => {
    const effective = type === 'app' ? { name: 'acme_app', label: 'Acme', navigation: NAV } : type === 'page' ? HOME : null;
    return { code: null, overlay: effective, overlayScope: effective ? 'env' : null, effective, editable: true };
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Whether a reload / tab close would be asked about. */
function reloadAsks(): boolean {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

/** Opens nav editing and starts a rename of "QA Dash"; returns its input. */
async function startRename(): Promise<HTMLInputElement> {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('button', { name: /QA Dash/ }, { timeout: 8000 });
  fireEvent.click(screen.getByTitle(/^Edit navigation/));
  await screen.findByRole('button', { name: /Add nav item/ }, { timeout: 8000 });
  const card = screen.getAllByRole('button').find((b) => b.getAttribute('aria-pressed') !== null && b.textContent?.startsWith('QA Dash'))!;
  fireEvent.doubleClick(card.querySelector('span')!);
  return (await screen.findByDisplayValue('QA Dash')) as HTMLInputElement;
}

describe('an uncommitted nav rename raises the held-edit guard (objectstack#27464)', () => {
  it('typing a rename asks on reload; Escape reverts it and the guard lets go', async () => {
    const input = await startRename();
    expect(reloadAsks()).toBe(false);
    fireEvent.change(input, { target: { value: 'QA Dash Lost' } });
    await waitFor(() => expect(reloadAsks()).toBe(true));
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(reloadAsks()).toBe(false));
    expect(mockClient.save).not.toHaveBeenCalled();
  });

  it('typing the authored label back is no rename, and the guard lets go', async () => {
    const input = await startRename();
    fireEvent.change(input, { target: { value: 'QA Dash Lost' } });
    await waitFor(() => expect(reloadAsks()).toBe(true));
    fireEvent.change(input, { target: { value: 'QA Dash' } });
    await waitFor(() => expect(reloadAsks()).toBe(false));
  });

  it('committing hands the rename to the nav autosave; once it lands nothing is held', async () => {
    const input = await startRename();
    fireEvent.change(input, { target: { value: 'QA Dash Lost' } });
    await waitFor(() => expect(reloadAsks()).toBe(true));
    fireEvent.blur(input);
    await waitFor(() => expect(mockClient.save.mock.calls.some(([type]) => type === 'app')).toBe(true), { timeout: 8000 });
    const sent = mockClient.save.mock.calls.find(([type]) => type === 'app')![2] as { navigation: Array<{ label: unknown }> };
    expect(sent.navigation[0].label).toBe('QA Dash Lost');
    await waitFor(() => expect(reloadAsks()).toBe(false), { timeout: 8000 });
  });
});

describe('a canvas with no report (the AppPreview caller) renames as before', () => {
  it('commits on blur and needs no report', () => {
    const onPatch = vi.fn();
    render(<AppNavCanvas draft={{ navigation: NAV }} rootKey="navigation" onPatch={onPatch} selection={null} />);
    fireEvent.doubleClick(screen.getByText('QA Dash'));
    const input = screen.getByDisplayValue('QA Dash');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.blur(input);
    expect(onPatch).toHaveBeenCalledWith({ navigation: [expect.objectContaining({ label: 'Renamed' })] });
  });
});
