// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36897 — the list's 「新建」 on a read-only base in Studio's area.
 *
 *  - It is offered: the item is created in the base's paired `.custom`
 *    package (ADR-0146 D3). An object and a flow open the list's own create
 *    dialog (`MetadataListCreateDialog`, whose landing is its own suite);
 *    another type goes to the area's create, which moves to the pair.
 *  - Under the customization wall nothing is offered: the server would
 *    refuse the pair's ensure for this caller.
 *  - Setup (no area) is unchanged — the control: its 「新建」 goes to the
 *    item page's create and opens no dialog.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@objectstack/spec/identity';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';

const BASE = 'hotcrm';

const CLIENT = {
  list: async (type: string) =>
    type === 'package'
      ? [{ manifest: { id: BASE, name: 'HotCRM', scope: 'installed' } }]
      : [{ name: `crm_${type}_one`, label: `One ${type}`, _packageId: BASE }],
};
const entry = (type: string, domain: string) => ({ type, label: type, domain, allowEnvironmentOverlay: false, allowRuntimeCreate: true });
const ENTRIES = [entry('object', 'data'), entry('flow', 'automation'), entry('email_template', 'system')];

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: ENTRIES }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
}));
let walled = false;
vi.mock('../studio-design/StudioCustomizeControls.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCustomizeDoorWalled: () => walled,
}));

import { MetadataResourceListPage } from './ResourceListPage';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { t } from './i18n';

registerDefaultMetadataSchemas();

const fetchMock = vi.fn(async (url: string) => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const u = String(url);
  if (u === '/api/v1/packages') {
    return json(200, { success: true, data: { packages: [{ manifest: { id: BASE, name: 'HotCRM', scope: 'installed' }, writable: false }] } });
  }
  if (u.endsWith('/customizations')) {
    return json(200, {
      success: true,
      data: { packageId: BASE, overrides: [], extensions: [], switchedOff: [], arrangements: [], contributions: [], counts: { overrides: 0, extensions: 0, switchedOff: 0, arrangements: 0, contributions: 0 } },
    });
  }
  if (u.startsWith('/api/v1/data/sys_metadata_activation')) {
    return json(200, { object: 'sys_metadata_activation', records: [], hasMore: false });
  }
  return json(404, { success: false });
});

beforeEach(() => {
  walled = false;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const READ_ONLY_BASE: MetadataAreaHost = { packageId: BASE, readOnly: true, basePath: `/studio/${BASE}/metadata` };

function Location() {
  const l = useLocation();
  return <div data-testid="location">{`${l.pathname}${l.search}`}</div>;
}

function mount(host: MetadataAreaHost | null, type: string) {
  const base = host?.basePath ?? '/apps/setup/metadata';
  const tree = (
    <MemoryRouter initialEntries={[`${base}/${type}${host ? `?package=${host.packageId}` : ''}`]}>
      <Routes>
        <Route path={`${base}/${type}`} element={<MetadataResourceListPage type={type} />} />
        <Route path="*" element={null} />
      </Routes>
      <Location />
    </MemoryRouter>
  );
  return render(host ? <MetadataAreaHostContext.Provider value={host}>{tree}</MetadataAreaHostContext.Provider> : tree);
}

const createButton = () => screen.queryByRole('button', { name: t('engine.list.create', 'en-US') });

describe('the list offers 「新建」 on a read-only base, into its pair (objectstack#36897)', () => {
  it('an object: 新建 is offered and opens the list create dialog', async () => {
    mount(READ_ONLY_BASE, 'object');
    await screen.findByTestId(`metadata-row-crm_object_one`);
    fireEvent.click(createButton()!);
    expect(await screen.findByTestId('create-object-owd')).toBeInTheDocument();
  });

  it('a flow: 新建 opens the starting points', async () => {
    mount(READ_ONLY_BASE, 'flow');
    await screen.findByTestId(`metadata-row-crm_flow_one`);
    fireEvent.click(createButton()!);
    expect(await screen.findByTestId('create-flow-preset-manual')).toBeInTheDocument();
  });

  it("another type goes to the area's create, which moves it to the pair", async () => {
    mount(READ_ONLY_BASE, 'email_template');
    await screen.findByTestId(`metadata-row-crm_email_template_one`);
    fireEvent.click(createButton()!);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/studio/${BASE}/metadata/email_template/new?package=${BASE}`));
  });

  it('under the customization wall nothing is offered', async () => {
    walled = true;
    mount(READ_ONLY_BASE, 'object');
    await screen.findByTestId(`metadata-row-crm_object_one`);
    expect(createButton()).toBeNull();
  });

  it('CONTROL — Setup: 新建 goes to the item create and opens no dialog', async () => {
    mount(null, 'object');
    await screen.findByTestId(`metadata-row-crm_object_one`);
    fireEvent.click(createButton()!);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/^\/apps\/setup\/metadata\/object\/new/));
    expect(screen.queryByTestId('create-object-owd')).toBeNull();
  });
});
