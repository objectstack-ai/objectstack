/**
 * objectstack#33317 — an interface list page whose records open nothing
 * (`recordAction: 'none'`) draws its grid's record-link column as plain text.
 *
 * The page resolves `none` for an authored `recordAction: 'none'` and for a
 * list-only source object, and hands the real `ListView` grid
 * `rowOpensRecord={false}`. Rendered through the real page, `ListView` and
 * `ObjectGrid`; the record-link cell is read off the table. CONTROL: the
 * default `drawer` page keeps the link.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, screen } from '@testing-library/react';
import React from 'react';
import { ActionProvider } from '@object-ui/react';

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return { ...actual, useAuth: () => ({}) };
});

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

const OBJECT_NAME = 'pkg_package';
const VIEW_KEY = 'source';
const ROWS = [{ id: 'p1', name: 'billing-kit', status: 'live' }];

function mountPage(recordAction: 'none' | 'drawer') {
  testDataSource = {
    find: vi.fn().mockResolvedValue(ROWS),
    findOne: vi.fn(),
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
        },
      },
    },
  ];
  const page = {
    name: 'my_packages',
    label: 'My Packages',
    interfaceConfig: { source: OBJECT_NAME, sourceView: VIEW_KEY, recordAction },
  };
  return render(
    <ActionProvider>
      <InterfaceListPage page={page as any} />
    </ActionProvider>,
  );
}

/** Whether the row's record-link cell wears the link face: an anchor, or a `role="link"` span. */
async function nameCellLooksLikeALink(): Promise<boolean> {
  await waitFor(() => expect(screen.getByText('billing-kit')).toBeTruthy(), { timeout: 5000 });
  const cell = screen.getByText('billing-kit').closest('td') as HTMLElement;
  expect(cell).not.toBeNull();
  return cell.querySelector('a[href], [role="link"]') !== null;
}

beforeEach(() => {
  cleanup();
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
});

describe('objectstack#33317 — an interface list page whose records open nothing', () => {
  it('`recordAction: none`: the name cell is plain text', async () => {
    mountPage('none');
    expect(await nameCellLooksLikeALink()).toBe(false);
    expect(screen.queryAllByTestId('primary-field-link')).toHaveLength(0);
  });

  it('CONTROL — the default drawer: the name cell is the record link', async () => {
    mountPage('drawer');
    expect(await nameCellLooksLikeALink()).toBe(true);
  });
});
