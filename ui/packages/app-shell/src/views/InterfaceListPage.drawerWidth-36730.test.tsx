/**
 * objectstack#36730 — an interface list page's record drawer takes its width
 * from the page's source view, as the object list's drawer does
 * (objectstack#36149): the view's `navigation.size` bucket, else the `auto`
 * default the `navigation.size` help text states, the side preview's 460 —
 * never the overlay's own 42rem. A dragged width is kept under the preview's
 * shared key unless the view authors a width.
 *
 * Rendered through the real page, `ListView` and `NavigationOverlay`, with the
 * drawer opened by its `?recordId=` address. The record body is a null sink.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import React from 'react';
import { ActionProvider } from '@object-ui/react';

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams('recordId=p1'), vi.fn()],
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return { ...actual, useAuth: () => ({}) };
});

// The record body: not what this file reads.
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

let testDataSource: any;
let testObjects: any[];

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return {
    ...actual,
    useAdapter: () => testDataSource,
    useMetadata: () => ({ objects: testObjects }),
  };
});

import { InterfaceListPage } from './InterfaceListPage';
import { RECORD_PREVIEW_DEFAULT_WIDTH, RECORD_PREVIEW_WIDTH_KEY, recordPaneWidth } from './recordDrawerContext';

const OBJECT_NAME = 'pkg_package';
const VIEW_KEY = 'source';
const ROWS = [{ id: 'p1', name: 'billing-kit', status: 'live' }];

function mountPage(navigation?: Record<string, unknown>) {
  testDataSource = {
    find: vi.fn().mockResolvedValue(ROWS),
    findOne: vi.fn().mockResolvedValue(ROWS[0]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: OBJECT_NAME,
      fields: { name: { type: 'text' }, status: { type: 'text' } },
    }),
  };
  testObjects = [
    {
      name: OBJECT_NAME,
      label: 'Package',
      fields: { name: { type: 'text', label: 'Name' }, status: { type: 'text', label: 'Status' } },
      listViews: {
        [`${OBJECT_NAME}.${VIEW_KEY}`]: {
          name: `${OBJECT_NAME}.${VIEW_KEY}`,
          label: 'Source',
          type: 'grid',
          columns: ['name', 'status'],
          ...(navigation ? { navigation } : {}),
        },
      },
    },
  ];
  const page = {
    name: 'my_packages',
    label: 'My Packages',
    interfaceConfig: { source: OBJECT_NAME, sourceView: VIEW_KEY, recordAction: 'drawer' },
  };
  return render(
    <ActionProvider>
      <InterfaceListPage page={page as any} />
    </ActionProvider>,
  );
}

const drawerWidth = () =>
  (document.querySelector('[data-record-drawer-card]') as HTMLElement | null)?.style.getPropertyValue('--ov-w').trim();

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  // The grid's permission reads go to the network; answer them empty.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('objectstack#36730 — an interface list page\'s drawer takes its width from the source view', () => {
  it('a source view with no size: the drawer opens at 460, not at the overlay\'s own 42rem', async () => {
    mountPage();
    await screen.findByRole('dialog', undefined, { timeout: 5000 });
    expect(drawerWidth()).toBe(RECORD_PREVIEW_DEFAULT_WIDTH);
  });

  it('a source view with no size opens at the width dragged in any side preview (the shared key)', async () => {
    window.localStorage.setItem(`ov:${RECORD_PREVIEW_WIDTH_KEY}`, '640');
    mountPage({ size: 'auto' });
    await screen.findByRole('dialog', undefined, { timeout: 5000 });
    expect(drawerWidth()).toBe('640px');
  });

  it('a source view that authors `size: \'xl\'` opens at that bucket, and the shared width does not replace it', async () => {
    window.localStorage.setItem(`ov:${RECORD_PREVIEW_WIDTH_KEY}`, '640');
    mountPage({ size: 'xl' });
    await screen.findByRole('dialog', undefined, { timeout: 5000 });
    const xl = recordPaneWidth({ size: 'xl' }, testObjects[0]);
    expect(xl).not.toBe(RECORD_PREVIEW_DEFAULT_WIDTH);
    expect(drawerWidth()).toBe(xl);
  });
});
