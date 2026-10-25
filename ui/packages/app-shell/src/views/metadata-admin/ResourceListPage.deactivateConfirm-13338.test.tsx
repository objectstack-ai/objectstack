// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13338 — the Setup catalog's Active switch on the Permission Sets
 * and Positions lists.
 *
 * What is pinned, on both lists:
 *
 *  - switching OFF asks first and sends nothing until the admin confirms; the
 *    confirm names how many users lose the access, counted from the server's
 *    assignment rows when it opens (`sys_user_permission_set` and the holders
 *    of every position that distributes the set; `sys_user_position` for a
 *    position), one person once;
 *  - Cancel leaves the item on and writes nothing;
 *  - switching ON asks nothing and writes at once;
 *  - a toast confirms the change either way;
 *  - a refused count read is said as such, never as "0 users", and the admin
 *    may still go ahead (the confirm informs, it does not gate).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { MemoryRouter } from 'react-router-dom';
// The switch column waits on `audienceAnchorsOf`'s dynamic import of this exact
// specifier; loaded here so its cost lands in the import phase.
import '@objectstack/spec/identity';

const PROJECT_PKG = 'com.example.showcase';

const PERMISSION_SETS: Record<string, unknown>[] = [
  { name: 'sales_rep', label: 'Sales Rep', _packageId: PROJECT_PKG, _provenance: 'package' },
  { name: 'qa_fls_rep', label: 'QA FLS Rep', _packageId: PROJECT_PKG, _provenance: 'package' },
  { name: 'member_default', label: 'Member Default', _packageId: PROJECT_PKG, _provenance: 'package' },
];

/** The registry's position definitions: the binding to a set is part of the definition. */
const POSITIONS: Record<string, unknown>[] = [
  { name: 'everyone', label: 'Everyone', permissionSets: ['member_default'], _packageId: PROJECT_PKG, _provenance: 'package' },
  { name: 'sales_manager', label: 'Sales Manager', permissionSets: ['sales_rep'], _packageId: PROJECT_PKG, _provenance: 'package' },
  { name: 'auditor', label: 'Auditor', permissionSets: [], _packageId: PROJECT_PKG, _provenance: 'package' },
];

/** Stable singleton — the page's load effect keys on the client identity. */
const CLIENT = {
  list: async (type: string) =>
    type === 'package'
      ? [{ manifest: { id: PROJECT_PKG, scope: 'project', name: 'Showcase' } }]
      : type === 'permission'
        ? PERMISSION_SETS
        : type === 'position'
          ? POSITIONS
          : [],
};

const ENTRIES = [
  { type: 'permission', label: 'Permission Set', allowEnvironmentOverlay: false, allowRuntimeCreate: true },
  { type: 'position', label: 'Position', allowEnvironmentOverlay: false, allowRuntimeCreate: true },
];

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: ENTRIES }),
}));

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

vi.mock('../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => true }));
vi.mock('../../hooks/useTenancyPosture', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTenancyPosture: () => 'single',
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

/** The assignment rows the server holds, by object. */
let data: Record<string, Record<string, unknown>[]> = {};
/** When set, every holder read is refused with this sentence. */
let holderRefusal: string | null = null;
const adapter = {
  find: vi.fn(async (object: string, query: { $filter?: Record<string, unknown> } = {}) => {
    if (holderRefusal) throw new Error(holderRefusal);
    const filter = query.$filter ?? {};
    return {
      data: (data[object] ?? []).filter((r) =>
        Object.entries(filter).every(([k, v]) =>
          v && typeof v === 'object' && Array.isArray((v as { $in?: unknown[] }).$in)
            ? (v as { $in: unknown[] }).$in.includes(r[k])
            : r[k] === v,
        ),
      ),
    };
  }),
};
const metadataStore = { ensureType: vi.fn(async (type: string) => (type === 'position' ? POSITIONS : [])) };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
  useMetadata: () => metadataStore,
}));

let ledgerRows: Record<string, unknown>[] = [];
const posts: Array<{ url: string; body?: string }> = [];

// Imported AFTER the mocks so the page picks them up.
import { MetadataResourceListPage } from './ResourceListPage';
import { t, tFormat } from './i18n';

beforeEach(() => {
  holderRefusal = null;
  data = {
    sys_user_permission_set: [
      { id: 'g1', permission_set: 'sales_rep', user_id: 'u1' },
      { id: 'g2', permission_set: 'sales_rep', user_id: 'u2' },
      { id: 'g3', permission_set: 'qa_fls_rep', user_id: 'u9' },
    ],
    sys_user_position: [
      // u2 also holds the set directly: counted once.
      { id: 'p1', position: 'sales_manager', user_id: 'u2' },
      { id: 'p2', position: 'sales_manager', user_id: 'u3' },
      { id: 'p3', position: 'auditor', user_id: 'u7' },
    ],
  };
  ledgerRows = [{ metadata_type: 'position', name: 'auditor', active: false }];
  posts.length = 0;
  adapter.find.mockClear();
  Object.values(toasts).forEach((f) => f.mockClear());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (method === 'GET' && String(url).startsWith('/api/v1/data/sys_metadata_activation')) {
        return json(200, { object: 'sys_metadata_activation', records: ledgerRows, hasMore: false });
      }
      if (method === 'POST' && String(url).startsWith('/api/v1/security/_activation/')) {
        posts.push({ url: String(url), body: init?.body as string | undefined });
        const enabled = JSON.parse(String(init?.body ?? '{}')).enabled;
        return json(200, { success: true, data: { enabled } });
      }
      return json(404, { success: false, error: { message: `unexpected ${method} ${url}` } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(type: 'permission' | 'position') {
  return render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/${type}?scope=environment`]}>
      <MetadataResourceListPage type={type} />
    </MemoryRouter>,
  );
}

/** Click a switch that is on, and wait for the confirm's count to arrive. */
async function askToSwitchOff(name: string) {
  const sw = await screen.findByTestId(`catalog-active-${name}`);
  await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
  fireEvent.click(sw);
  const confirm = await screen.findByTestId('catalog-deactivate-confirm');
  await waitFor(() => expect(confirm).not.toBeDisabled());
  return { sw, confirm };
}

describe.each([
  {
    list: 'Permission Sets',
    type: 'permission' as const,
    name: 'sales_rep',
    label: 'Sales Rep',
    // u1, u2 directly; u2, u3 through sales_manager — three people.
    holders: 3,
  },
  {
    list: 'Positions',
    type: 'position' as const,
    name: 'sales_manager',
    label: 'Sales Manager',
    holders: 2,
  },
])('the $list list: switching off asks first (objectui#13338)', ({ type, name, label, holders }) => {
  it('names how many users lose the access, and writes nothing until confirmed', async () => {
    mount(type);
    await askToSwitchOff(name);
    expect(screen.getByTestId('catalog-deactivate-dialog')).toHaveTextContent(
      tFormat('engine.catalog.deactivate.title', 'en-US', { name: label }),
    );
    expect(screen.getByTestId('catalog-deactivate-impact')).toHaveTextContent(
      tFormat('engine.catalog.deactivate.holders', 'en-US', { count: holders }),
    );
    expect(posts).toEqual([]);

    fireEvent.click(screen.getByTestId('catalog-deactivate-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId(`catalog-active-${name}`)).toHaveAttribute('aria-checked', 'false'),
    );
    expect(posts).toEqual([{ url: `/api/v1/security/_activation/${type}/${name}`, body: '{"enabled":false}' }]);
    expect(toasts.success).toHaveBeenCalledWith(
      tFormat('engine.catalog.active.switchedOff', 'en-US', { name: label }),
    );
  });

  it('Cancel leaves it on and writes nothing', async () => {
    mount(type);
    const { sw } = await askToSwitchOff(name);
    fireEvent.click(screen.getByTestId('catalog-deactivate-cancel'));
    await waitFor(() => expect(screen.queryByTestId('catalog-deactivate-dialog')).toBeNull());
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(posts).toEqual([]);
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('a refused count is said as such, never as "0 users", and the admin may still go ahead', async () => {
    holderRefusal = 'Reading the assignments was refused.';
    mount(type);
    const { confirm } = await askToSwitchOff(name);
    const impact = screen.getByTestId('catalog-deactivate-impact');
    expect(impact).toHaveTextContent(
      tFormat('engine.catalog.deactivate.countFailed', 'en-US', { message: holderRefusal }),
    );
    expect(impact).not.toHaveTextContent(tFormat('engine.catalog.deactivate.holders', 'en-US', { count: 0 }));
    fireEvent.click(confirm);
    await waitFor(() => expect(posts).toHaveLength(1));
  });
});

describe('switching on asks nothing (objectui#13338)', () => {
  it('on the Positions list, writes at once and toasts; CONTROL: no confirm opened and no holder read', async () => {
    mount('position');
    const sw = await screen.findByTestId('catalog-active-auditor');
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    expect(screen.queryByTestId('catalog-deactivate-dialog')).toBeNull();
    expect(posts).toEqual([{ url: '/api/v1/security/_activation/position/auditor', body: '{"enabled":true}' }]);
    expect(adapter.find).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith(
      tFormat('engine.catalog.active.switchedOn', 'en-US', { name: 'Auditor' }),
    );
  });

  it('on the Permission Sets list, writes at once and toasts', async () => {
    ledgerRows = [{ metadata_type: 'permission', name: 'qa_fls_rep', active: false }];
    mount('permission');
    const sw = await screen.findByTestId('catalog-active-qa_fls_rep');
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    expect(screen.queryByTestId('catalog-deactivate-dialog')).toBeNull();
    expect(posts).toEqual([{ url: '/api/v1/security/_activation/permission/qa_fls_rep', body: '{"enabled":true}' }]);
    expect(toasts.success).toHaveBeenCalledWith(
      tFormat('engine.catalog.active.switchedOn', 'en-US', { name: 'QA FLS Rep' }),
    );
  });
});

describe('the count, read the way the holders sections read it (objectui#13338)', () => {
  it('one holder is said in the singular', async () => {
    mount('permission');
    await askToSwitchOff('qa_fls_rep');
    expect(screen.getByTestId('catalog-deactivate-impact')).toHaveTextContent(
      t('engine.catalog.deactivate.holdersOne', 'en-US'),
    );
  });

  it('a set bound to the everyone anchor is said to reach every signed-in member', async () => {
    mount('permission');
    await askToSwitchOff('member_default');
    expect(screen.getByTestId('catalog-deactivate-impact')).toHaveTextContent(
      t('engine.catalog.deactivate.everyone', 'en-US'),
    );
  });

  it('reads the grants by the set name and the position holders by position name', async () => {
    mount('permission');
    await askToSwitchOff('sales_rep');
    expect(adapter.find).toHaveBeenCalledWith('sys_user_permission_set', {
      $filter: { permission_set: 'sales_rep' },
      $top: 1000,
    });
    expect(adapter.find).toHaveBeenCalledWith('sys_user_position', {
      $filter: { position: { $in: ['sales_manager'] } },
      $top: 1000,
    });
  });
});
