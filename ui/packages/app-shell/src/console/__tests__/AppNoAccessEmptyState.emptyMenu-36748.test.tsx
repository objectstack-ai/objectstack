// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36748 — an app whose menu is empty AS STORED no longer tells the
 * person who can fill it to grant access in Setup. For a caller who can grant
 * access, the no-navigation screen reads the app's stored menu (`/layers`);
 * empty there too, it says the menu is empty and opens the app's package in
 * Studio. A stored menu with entries (filtered away for this caller), a caller
 * who cannot grant, or a failed read keep the access answer.
 *
 * The `t` mock returns each call site's `defaultValue` (the `en` pack value).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
  useObjectLabel: () => ({
    appLabel: (app: { name: string; label?: string }) => app.label ?? app.name,
  }),
}));

import { AppNoAccessEmptyState, storedMenuIsEmpty } from '../AppNoAccessEmptyState';

const PKG = 'com.example.visits';
const APP = { name: 'visits', label: 'Visits', _packageId: PKG };

function stubLayers(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

function renderState(props: Partial<ComponentProps<typeof AppNoAccessEmptyState>> = {}) {
  return render(
    <MemoryRouter>
      <AppNoAccessEmptyState app={APP} setupPath="/setup" {...props} />
    </MemoryRouter>,
  );
}

describe('an empty stored menu is said as such, not as missing access (objectstack#36748)', () => {
  it('a caller who can grant: the stored menu is read; empty ⇒ the empty-menu answer, opening Studio', async () => {
    const fetchMock = stubLayers(200, { effective: { name: 'visits', navigation: [] }, code: null });
    renderState();
    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('data-reason', 'empty-menu');
    expect(status).toHaveTextContent('has nothing in its menu yet');
    expect(status).not.toHaveTextContent(/grant access/i);
    expect(screen.getByTestId('app-empty-menu-open-studio')).toHaveAttribute('href', `/studio/${PKG}/data`);
    expect(screen.queryByTestId('app-no-access-open-setup')).toBeNull();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`/api/v1/meta/app/visits/layers?package=${encodeURIComponent(PKG)}`);
  });

  it('a stored menu with entries this caller is not shown keeps the access answer', async () => {
    stubLayers(200, { effective: { navigation: [{ id: 'n', type: 'object', objectName: 'secret' }] } });
    renderState();
    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('data-reason', 'no-navigation');
    expect(screen.getByTestId('app-no-access-open-setup')).toHaveAttribute('href', '/setup');
  });

  it('a failed read keeps the access answer', async () => {
    stubLayers(403, { success: false });
    renderState();
    expect(await screen.findByRole('status')).toHaveAttribute('data-reason', 'no-navigation');
  });

  it('a caller who cannot grant is never read for: the ask-an-administrator answer', () => {
    const fetchMock = stubLayers(200, { effective: { navigation: [] } });
    renderState({ setupPath: null });
    expect(screen.getByRole('status')).toHaveAttribute('data-reason', 'no-navigation');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('storedMenuIsEmpty reads navigation and every area', () => {
    expect(storedMenuIsEmpty({ effective: { navigation: [] } })).toBe(true);
    expect(storedMenuIsEmpty({ code: { navigation: [], areas: [{ navigation: [] }] } })).toBe(true);
    expect(storedMenuIsEmpty({ effective: { navigation: [], areas: [{ navigation: [{ id: 'x' }] }] } })).toBe(false);
    expect(storedMenuIsEmpty({ effective: { navigation: [{ id: 'x' }] } })).toBe(false);
  });
});
