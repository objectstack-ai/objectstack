// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27464 — a navigation rename typed into the Interfaces nav editor
 * but not committed yet (it commits on blur or Enter) is unsaved work: a reload
 * or a tab close asks first, as it does for every other held Studio edit.
 *
 * The canvas reports the pending rename and the pillar folds it into the one
 * held-edit report the surface already reads, so its one `beforeunload` guard
 * covers it. A bare `AppNavCanvas` (the `AppPreview` caller) renames as before.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

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
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { AppNavCanvas } from '../metadata-admin/previews/AppNavCanvas';

const noop = () => {};
window.matchMedia = ((media: string) => ({ matches: false, media, addEventListener: noop, removeEventListener: noop })) as unknown as typeof window.matchMedia;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} };

beforeEach(() => {
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  mockClient.layered.mockImplementation(async (type: string) => {
    const effective = type === 'app' ? { name: 'acme_app', label: 'Acme', navigation: NAV } : type === 'page' ? HOME : null;
    return { code: null, overlay: null, overlayScope: null, effective, editable: true };
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch);
});
afterEach(() => (cleanup(), vi.unstubAllGlobals()));

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
