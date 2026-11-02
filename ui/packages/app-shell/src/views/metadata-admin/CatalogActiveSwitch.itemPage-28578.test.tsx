// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * N-28 (M-1 ruling A, comment 6554738464) — the catalog's Active switch on an
 * item's own page in Studio's "All metadata" area.
 *
 * Setup's catalog list, which carried the switch, retired (objectstack
 * ADR-0146 D1), so the switch moved with the item. `CatalogItemActiveSwitch`
 * is the one switch the area's item pages mount: the position and declared
 * sharing rule pages through `ResourceEditPage`'s area sections, the
 * permission set through its own editor. It is the list's switch, for one
 * item, so the list's contract holds (objectui#13338): off asks first with the
 * holder count, Cancel writes nothing, on writes at once, a toast confirms.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// `audienceAnchorsOf` dynamic-imports this specifier; paid in the import phase.
import '@objectstack/spec/identity';

const POSITIONS: Record<string, unknown>[] = [
  { name: 'sales_manager', label: 'Sales Manager', permissionSets: ['sales_rep'] },
];

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

let canAuthor = true;
vi.mock('../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => canAuthor }));
vi.mock('../../hooks/useTenancyPosture', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTenancyPosture: () => 'single',
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

let data: Record<string, Record<string, unknown>[]> = {};
const adapter = {
  find: vi.fn(async (object: string, query: { $filter?: Record<string, unknown> } = {}) => {
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

import { CatalogItemActiveSwitch } from './CatalogActiveSwitch';
import { t, tFormat } from './i18n';

beforeEach(() => {
  canAuthor = true;
  data = {
    sys_user_permission_set: [
      { id: 'g1', permission_set: 'sales_rep', user_id: 'u1' },
      { id: 'g2', permission_set: 'sales_rep', user_id: 'u2' },
    ],
    sys_user_position: [
      { id: 'p1', position: 'sales_manager', user_id: 'u2' },
      { id: 'p2', position: 'sales_manager', user_id: 'u3' },
    ],
  };
  ledgerRows = [{ metadata_type: 'sharing_rule', name: 'open_accounts', active: false }];
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

async function switchOf(name: string, checked: 'true' | 'false') {
  const sw = await screen.findByTestId(`catalog-active-${name}`);
  await waitFor(() => expect(sw).toHaveAttribute('aria-checked', checked));
  return sw;
}

describe.each([
  { type: 'permission', name: 'sales_rep', label: 'Sales Rep', holders: 3 },
  { type: 'position', name: 'sales_manager', label: 'Sales Manager', holders: 2 },
])('the $type item page: switching off asks first', ({ type, name, label, holders }) => {
  it('names the holders, writes nothing until confirmed, then writes and toasts', async () => {
    render(<CatalogItemActiveSwitch type={type} name={name} label={label} />);
    expect(screen.getByTestId('catalog-item-active')).toHaveTextContent(t('engine.catalog.col.active', 'en-US'));
    fireEvent.click(await switchOf(name, 'true'));

    const confirm = await screen.findByTestId('catalog-deactivate-confirm');
    await waitFor(() => expect(confirm).not.toBeDisabled());
    expect(screen.getByTestId('catalog-deactivate-impact')).toHaveTextContent(
      tFormat('engine.catalog.deactivate.holders', 'en-US', { count: holders }),
    );
    expect(posts).toEqual([]);

    fireEvent.click(confirm);
    await switchOf(name, 'false');
    expect(posts).toEqual([{ url: `/api/v1/security/_activation/${type}/${name}`, body: '{"enabled":false}' }]);
    expect(toasts.success).toHaveBeenCalledWith(tFormat('engine.catalog.active.switchedOff', 'en-US', { name: label }));
  });

  it('Cancel leaves it on and writes nothing', async () => {
    render(<CatalogItemActiveSwitch type={type} name={name} label={label} />);
    const sw = await switchOf(name, 'true');
    fireEvent.click(sw);
    fireEvent.click(await screen.findByTestId('catalog-deactivate-cancel'));
    await waitFor(() => expect(screen.queryByTestId('catalog-deactivate-dialog')).toBeNull());
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(posts).toEqual([]);
  });
});

describe('the declared sharing rule item page', () => {
  it('reads the ledger, and switches on at once with no holder read', async () => {
    render(<CatalogItemActiveSwitch type="sharing_rule" name="open_accounts" />);
    const sw = await switchOf('open_accounts', 'false');
    fireEvent.click(sw);
    await switchOf('open_accounts', 'true');
    expect(screen.queryByTestId('catalog-deactivate-dialog')).toBeNull();
    expect(posts).toEqual([{ url: '/api/v1/security/_activation/sharing_rule/open_accounts', body: '{"enabled":true}' }]);
    expect(adapter.find).not.toHaveBeenCalled();
  });
});

describe('a viewer who cannot author metadata', () => {
  it('sees the state and gets no click', async () => {
    canAuthor = false;
    render(<CatalogItemActiveSwitch type="position" name="sales_manager" />);
    const sw = await switchOf('sales_manager', 'true');
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute('aria-label', t('engine.catalog.status.active', 'en-US'));
  });
});

describe('a refused ledger read', () => {
  it('is said in plain words, never as a switch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false, error: { message: 'no' } }), { status: 403 })),
    );
    render(<CatalogItemActiveSwitch type="position" name="sales_manager" />);
    expect(await screen.findByTestId('catalog-active-unreadable-sales_manager')).toHaveTextContent(
      t('engine.catalog.active.notVisible', 'en-US'),
    );
    expect(screen.queryByTestId('catalog-active-sales_manager')).toBeNull();
  });
});

describe('where the area item pages mount it (source pin)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  it('the position and sharing rule area sections, and the permission set editor', () => {
    const editPage = readFileSync(path.join(here, 'ResourceEditPage.tsx'), 'utf8');
    const areaSections = editPage.slice(editPage.indexOf('const AREA_ENVIRONMENT_SECTIONS'));
    expect(areaSections).toMatch(/position: \[catalogActiveSection\('position'\)/);
    expect(areaSections).toMatch(/sharing_rule: \[catalogActiveSection\('sharing_rule'\)\]/);
    const matrix = readFileSync(path.join(here, 'PermissionMatrixEditor.tsx'), 'utf8');
    expect(matrix).toContain('<CatalogItemActiveSwitch type="permission" name={name} />');
  });
});
