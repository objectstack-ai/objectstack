// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27745 — the Studio flow over an OData datasource's entity sets:
 * the tables tab lists them, "Import selected" imports several at once with
 * lookup targets saved first, and an imported object stays read-only unless
 * the author opts in (offered only when the datasource allows writes).
 *
 * The REST client is the REAL module (`./api`); `fetch` is answered here by a
 * mocked federation service that behaves as the server does on the points the
 * flow depends on: a draft names a navigation whose target is not imported as
 * a review entry with `remoteType` `navigation → <entity set>`, and the same
 * draft taken after the target's save carries the lookup instead.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaBrowser } from './SchemaBrowser';
import { importRemoteTables } from './api';

const ENTITY_SETS = [
  { name: 'Categories', columnCount: 4 },
  { name: 'Products', columnCount: 6 },
  { name: 'Order_Details', columnCount: 5 },
];

/** Which entity set references which, as the Northwind `$metadata` declares it. */
const NAVIGATIONS: Record<string, Array<{ nav: string; target: string; column: string }>> = {
  Products: [{ nav: 'Category', target: 'Categories', column: 'category_id' }],
  Order_Details: [{ nav: 'Product', target: 'Products', column: 'product_id' }],
  Categories: [],
};

const objectName = (entitySet: string) => entitySet.toLowerCase();

/** The object definition a PUT /meta/object/:name carried. */
interface SavedBody {
  fields: Record<string, unknown>;
  external: { remoteName?: string; writable?: boolean };
}

interface Service {
  saved: Array<{ name: string; body: SavedBody }>;
  drafts: string[];
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: 'STATUS',
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

function mockService(opts: { refuse?: string } = {}): Service {
  const service: Service = { saved: [], drafts: [] };
  const imported = () => new Set(service.saved.map((s) => s.name));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/api/v1/datasources/erp/external/tables')) {
        return jsonResponse({ success: true, data: { tables: ENTITY_SETS } });
      }
      const draft = /\/api\/v1\/datasources\/erp\/external\/tables\/([^/]+)\/draft$/.exec(url);
      if (method === 'POST' && draft) {
        const set = decodeURIComponent(draft[1]!);
        service.drafts.push(set);
        const fields: Record<string, unknown> = { id: { type: 'number' } };
        const review: Array<{ column: string; remoteType: string; note: string }> = [];
        for (const n of NAVIGATIONS[set] ?? []) {
          if (imported().has(objectName(n.target))) {
            fields[n.column] = { type: 'lookup', reference: objectName(n.target) };
          } else {
            fields[n.column] = { type: 'number' };
            review.push({ column: n.nav, remoteType: `navigation → ${n.target}`, note: 'navigation left out of the draft' });
          }
        }
        return jsonResponse({
          success: true,
          data: {
            draft: {
              name: objectName(set),
              datasource: 'erp',
              definition: { name: objectName(set), datasource: 'erp', external: { remoteName: set }, fields },
              source: '',
              review,
            },
          },
        });
      }
      const put = /\/api\/v1\/meta\/object\/([^/]+)$/.exec(url);
      if (method === 'PUT' && put) {
        const name = decodeURIComponent(put[1]!);
        if (name === opts.refuse) {
          return jsonResponse({ success: false, error: { code: 'FORBIDDEN', message: 'manage_metadata is required' } }, 403);
        }
        service.saved.push({ name, body: JSON.parse(String(init?.body)) });
        return jsonResponse({ success: true });
      }
      throw new Error(`mock federation service: no route for ${method} ${url}`);
    }),
  );
  return service;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

function mount(allowWrites?: boolean) {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <SchemaBrowser datasource="erp" allowWrites={allowWrites} />
    </I18nProvider>,
  );
}

const checkbox = (label: string) => screen.getByRole('checkbox', { name: label });

describe('importRemoteTables — targets are saved before the tables that reference them', () => {
  it('saves Categories, then Products, then Order_Details, whatever order they were picked in', async () => {
    const service = mockService();
    const results = await importRemoteTables('erp', [ENTITY_SETS[2]!, ENTITY_SETS[1]!, ENTITY_SETS[0]!]);

    expect(service.saved.map((s) => s.name)).toEqual(['categories', 'products', 'order_details']);
    expect(service.saved[1]!.body.fields.category_id).toEqual({ type: 'lookup', reference: 'categories' });
    expect(service.saved[2]!.body.fields.product_id).toEqual({ type: 'lookup', reference: 'products' });
    expect(results.map((r) => [r.table.name, r.name, r.error])).toEqual([
      ['Categories', 'categories', undefined],
      ['Products', 'products', undefined],
      ['Order_Details', 'order_details', undefined],
    ]);
  });

  it('does not wait on a target outside the selection: the navigation stays left out and named', async () => {
    const service = mockService();
    const [result] = await importRemoteTables('erp', [ENTITY_SETS[1]!]);
    expect(service.saved.map((s) => s.name)).toEqual(['products']);
    expect(result!.review).toEqual([
      { column: 'Category', remoteType: 'navigation → Categories', note: 'navigation left out of the draft' },
    ]);
  });

  it('reports a refused save by its own words and goes on with the rest', async () => {
    const service = mockService({ refuse: 'categories' });
    const results = await importRemoteTables('erp', [ENTITY_SETS[0]!, ENTITY_SETS[1]!]);
    expect(results.find((r) => r.table.name === 'Categories')?.error).toBe('manage_metadata is required (FORBIDDEN)');
    // The target never landed, so its referrer is saved without the lookup.
    expect(service.saved.map((s) => s.name)).toEqual(['products']);
    expect(service.saved[0]!.body.fields.category_id).toEqual({ type: 'number' });
  });

  it('saves objects read-only unless writes are opted into', async () => {
    const service = mockService();
    await importRemoteTables('erp', [ENTITY_SETS[0]!]);
    await importRemoteTables('erp', [ENTITY_SETS[1]!], { writable: true });
    expect(service.saved[0]!.body.external).toEqual({ remoteName: 'Categories' });
    expect(service.saved[1]!.body.external).toEqual({ remoteName: 'Products', writable: true });
  });
});

describe('SchemaBrowser — the datasource page lists the entity sets and imports the selected ones', () => {
  it('lists every entity set with a checkbox and imports the picked ones in dependency order', async () => {
    const service = mockService();
    mount(false);
    await flush();

    for (const set of ENTITY_SETS) expect(screen.getByText(set.name)).toBeTruthy();
    // No write opt-in on a datasource that does not allow writes.
    expect(screen.queryByText('Allow writes to this object (read-only otherwise)')).toBeNull();

    fireEvent.click(checkbox('Select Products'));
    fireEvent.click(checkbox('Select Categories'));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected (2)' }));
    await flush();

    expect(service.saved.map((s) => s.name)).toEqual(['categories', 'products']);
    expect(service.saved.every((s) => s.body.external.writable === undefined)).toBe(true);
    const summary = screen.getByTestId('schema-browser-batch-results');
    expect(summary.textContent).toContain('Imported 2 of 2 tables as objects.');
    expect(summary.textContent).toContain('Products→products');
  });

  it('select-all picks every listed entity set', async () => {
    const service = mockService();
    mount(false);
    await flush();
    fireEvent.click(checkbox('Select all tables'));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected (3)' }));
    await flush();
    expect(service.saved.map((s) => s.name)).toEqual(['categories', 'products', 'order_details']);
  });

  it('offers the write opt-in when the datasource allows writes, off until ticked', async () => {
    const service = mockService();
    mount(true);
    await flush();

    fireEvent.click(checkbox('Select Categories'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow writes to this object (read-only otherwise)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected (1)' }));
    await flush();
    expect(service.saved[0]!.body.external).toEqual({ remoteName: 'Categories', writable: true });

    fireEvent.click(checkbox('Select Products'));
    // The opt-in stays as the author left it; untick it for a read-only import.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow writes to this object (read-only otherwise)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected (1)' }));
    await flush();
    expect(service.saved[1]!.body.external).toEqual({ remoteName: 'Products' });
  });
});
