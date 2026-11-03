// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29121 — Home's command palette reads no object until it opens.
 *
 * `HomeLayout` mounted the palette closed and handed it `useMetadata().objects`,
 * so every visit to `/home` read the whole object registry (and the view list)
 * for a dialog nobody had opened. Now the palette is mounted from its first
 * open, and handed the host app's object scope over the objects its navigation
 * lists, read without views: what its record search reads.
 *
 * Real subjects: `HomeLayout`, `CommandPaletteProvider`, `MetadataProvider`
 * over a fake adapter that records each read, and a `MemoryRouter`. The bar is
 * a stub with an open button, and the palette a probe that records the objects
 * it was handed (what the palette lists is its own files' pins).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataProvider } from '../../../providers/MetadataProvider';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ language: 'en', t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Dev Admin', email: 'dev.admin@example.com' } }),
}));
vi.mock('../../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../../../providers/AdapterProvider', () => ({ useAdapter: () => undefined }));
vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ setContext: () => {}, currentAppName: undefined, recordTitle: undefined }),
}));
// The bar: one button that opens the palette, as the search field does.
vi.mock('../../../layout/AppHeader', async () => {
  const { useCommandPalette, useCommandPaletteProviderMounted } = await import('../../../context/CommandPaletteProvider');
  return {
    // Drawn once a palette provider is above it (the app list has landed), as
    // the real bar draws its search field.
    AppHeader: () => {
      const { openCommandPalette } = useCommandPalette();
      const mounted = useCommandPaletteProviderMounted();
      return mounted ? <button type="button" data-testid="open-palette" onClick={() => openCommandPalette()} /> : null;
    },
  };
});
// The palette: a probe on the objects it searches.
vi.mock('../../../chrome/CommandPalette', async () => {
  const { useCommandPalette } = await import('../../../context/CommandPaletteProvider');
  return {
    CommandPalette: (props: { objects: Array<{ name?: string }>; activeApp?: { name?: string } }) => {
      const { open } = useCommandPalette();
      return (
        <output
          data-testid="palette-probe"
          data-open={String(open)}
          data-active-app={props.activeApp?.name ?? ''}
          data-objects={props.objects.map((o) => o?.name).sort().join(',')}
        />
      );
    },
  };
});

import { HomeLayout } from '../HomeLayout';

const OBJECTS = [
  { name: 'crm_account', label: 'Account', _packageId: 'app.crm', fields: {} },
  { name: 'crm_contact', label: 'Contact', _packageId: 'app.crm', fields: {} },
  { name: 'sys_user', label: 'User', _packageId: 'plugin.auth', fields: {} },
  { name: 'sys_queue', label: 'Queue', _packageId: 'plugin.setup', fields: {} },
];

const state = vi.hoisted(() => ({ apps: [] as unknown[] }));

function makeAdapter(calls: string[]) {
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const all = type === 'object' ? OBJECTS : type === 'app' ? state.apps : [];
          const items = options?.packageId ? all.filter((o: any) => o._packageId === options.packageId) : all;
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          const item = (type === 'object' ? OBJECTS : []).find((o) => o.name === name) ?? null;
          return Promise.resolve({ item: structuredClone(item) });
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

const metaReads = (calls: string[]) =>
  calls.filter((c) => c === 'object' || c === 'view' || c.startsWith('object?') || c.startsWith('object/'));

function renderHome(url = '/home'): string[] {
  const calls: string[] = [];
  render(
    <MetadataProvider adapter={makeAdapter(calls)}>
      <MemoryRouter initialEntries={[url]}>
        <HomeLayout>
          <div data-testid="home-page" />
        </HomeLayout>
      </MemoryRouter>
    </MetadataProvider>,
  );
  return calls;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  sessionStorage.clear();
  // The host app lists two of its package's objects and one it does not hold.
  state.apps = [
    {
      name: 'crm',
      label: 'CRM',
      _packageId: 'app.crm',
      navigation: [
        { id: 'a', type: 'object', objectName: 'crm_account' },
        { id: 'g', type: 'group', label: 'More', children: [{ id: 'u', type: 'object', objectName: 'sys_user' }] },
      ],
    },
  ];
});
afterEach(() => cleanup());

describe('Home’s command palette reads no object until it opens (objectstack#29121)', () => {
  it('closed, it is not mounted and nothing reads an object', async () => {
    const calls = renderHome();
    // The app list landed: the bar (and its palette trigger) is drawn.
    await waitFor(() => expect(screen.getByTestId('open-palette')).toBeInTheDocument());
    await settle();
    expect(screen.queryByTestId('palette-probe')).toBeNull();
    expect(metaReads(calls)).toEqual([]);
  });

  it('opened, it reads the host app’s scope over its navigation’s objects, without views, never the whole list', async () => {
    const calls = renderHome();
    fireEvent.click(await screen.findByTestId('open-palette'));
    const probe = await screen.findByTestId('palette-probe');
    await waitFor(() => expect(probe).toHaveAttribute('data-objects', 'crm_account,crm_contact,sys_user'));
    expect(probe).toHaveAttribute('data-open', 'true');
    expect(probe).toHaveAttribute('data-active-app', 'crm');
    await settle();
    expect(metaReads(calls)).toEqual(['object?package=app.crm', 'object/sys_user']);
  });

  it('a deep link that opens it (`?palette=1`) reads the same scope', async () => {
    const calls = renderHome('/home?palette=1');
    const probe = await screen.findByTestId('palette-probe');
    await waitFor(() => expect(probe).toHaveAttribute('data-objects', 'crm_account,crm_contact,sys_user'));
    await settle();
    expect(metaReads(calls)).toEqual(['object?package=app.crm', 'object/sys_user']);
  });

  it('an app bound to no package: its navigation’s objects, by name alone', async () => {
    state.apps = [{ name: 'ops', label: 'Ops', navigation: [{ id: 'q', type: 'object', objectName: 'sys_queue' }] }];
    const calls = renderHome('/home?palette=1');
    const probe = await screen.findByTestId('palette-probe');
    await waitFor(() => expect(probe).toHaveAttribute('data-objects', 'sys_queue'));
    await settle();
    expect(metaReads(calls)).toEqual(['object/sys_queue']);
  });
});
