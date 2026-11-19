// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34724 (ADR-0146 D4 as amended 2026-11-17) — a standalone
 * `action` item of a read-only app package carries the activation ledger's
 * switch on its page in Studio's "All metadata" area, the one the object's
 * Actions view draws for an embedded action (`ObjectActionsPanel.ledgerSwitch-34724.test.tsx`
 * pins its readings, gate and refusals; this file pins the item page's mount
 * and the object segment the flip addresses).
 *
 * Stubbed: the metadata client and the network. The page and the switch are real.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
// The page reaches `celAuthoring`'s dynamic `@objectstack/lint` import; its
// first load is paid here, at collection, never inside a case's clock
// (`check:test-source-alias`).
import '@objectstack/lint';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';

let layered: Record<string, unknown> = {};

const client = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => layered),
  saveDraft: vi.fn(async () => ({})),
  save: vi.fn(async () => ({})),
};

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'action', label: 'Action', domain: 'ui', allowEnvironmentOverlay: false, allowRuntimeCreate: true }],
  }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
  useCanReadAuthoringTrail: () => false,
}));
vi.mock('../../hooks/useTenancyPosture', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTenancyPosture: () => 'single',
}));

const packageEntries = vi.hoisted(() => ({
  current: [] as Array<{ id: string; name: string; writable: boolean; namespace: string; kernel?: true }>,
}));
vi.mock('../studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPackages: vi.fn(async () => packageEntries.current),
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const posts: Array<{ url: string; body?: string }> = [];

import { MetadataResourceEditPage } from './ResourceEditPage';
import { fetchPackages } from '../studio-design/packages-io';

const APP = 'com.example.showcase';
const KERNEL = 'com.objectstack.platform-objects';

const hostOf = (packageId: string, readOnly = true): MetadataAreaHost => ({
  packageId,
  readOnly,
  basePath: `/studio/${packageId}/metadata`,
});

beforeEach(() => {
  layered = {
    effective: { name: 'send_reminder', label: 'Send reminder', objectName: 'showcase_task', type: 'script', target: 'send_reminder' },
    code: null,
    overlay: null,
    editable: false,
    deletable: false,
  };
  packageEntries.current = [
    { id: APP, name: 'Showcase', writable: false, namespace: 'showcase' },
    { id: KERNEL, name: 'Platform objects', writable: false, namespace: 'sys', kernel: true },
  ];
  posts.length = 0;
  toasts.success.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (method === 'GET' && String(url).startsWith('/api/v1/data/sys_metadata_activation')) {
        return json(200, { object: 'sys_metadata_activation', records: [], hasMore: false });
      }
      if (method === 'POST' && String(url).startsWith('/api/v1/actions/_activation/')) {
        posts.push({ url: String(url), body: init?.body as string | undefined });
        return json(200, { success: true, data: { enabled: JSON.parse(String(init?.body ?? '{}')).enabled } });
      }
      return json(404, { success: false, error: { message: `unexpected ${method} ${url}` } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(fetchPackages).mockClear();
});

function openItem(host: MetadataAreaHost, name = 'send_reminder') {
  render(
    <MetadataAreaHostContext.Provider value={host}>
      <MemoryRouter initialEntries={[`${host.basePath}/action/${name}`]}>
        <MetadataResourceEditPage type="action" name={name} />
      </MemoryRouter>
    </MetadataAreaHostContext.Provider>,
  );
}

describe("a standalone action's item page carries the ledger switch (objectstack#34724)", () => {
  it('on a read-only app package: the switch, and a flip addressed to the action\'s object', async () => {
    openItem(hostOf(APP));
    const sw = await screen.findByTestId('action-ledger-switch');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    await waitFor(() => expect(screen.getByTestId('action-ledger-switch')).toHaveAttribute('aria-checked', 'false'));
    expect(posts).toEqual([{ url: '/api/v1/actions/_activation/showcase_task/send_reminder', body: '{"enabled":false}' }]);
    expect(toasts.success).toHaveBeenCalledWith('"Send reminder" is switched off for this deployment.');
  });

  it('an object-less action is addressed under `global`, the door\'s own spelling', async () => {
    layered = { ...layered, effective: { name: 'open_help', label: 'Open help', type: 'url', target: 'https://example.com' } };
    openItem(hostOf(APP), 'open_help');
    fireEvent.click(await screen.findByTestId('action-ledger-switch'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe('/api/v1/actions/_activation/global/open_help');
  });

  it('a platform (kernel) package\'s action carries no switch', async () => {
    openItem(hostOf(KERNEL));
    await screen.findByTestId('package-readonly-banner');
    await waitFor(() => expect(vi.mocked(fetchPackages)).toHaveBeenCalled());
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('sys_metadata_activation'))).toHaveLength(0);
    expect(screen.queryByTestId('action-ledger-switch')).toBeNull();
  });

  it('an app area showing an item a kernel package ships judges the item\'s package: no switch', async () => {
    layered = { ...layered, packageId: KERNEL };
    openItem(hostOf(APP));
    await screen.findByTestId('package-readonly-banner');
    await waitFor(() => expect(vi.mocked(fetchPackages)).toHaveBeenCalled());
    // Let the package verdict and any ledger read settle before reading absence.
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const ledgerReads = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('sys_metadata_activation'));
    expect(ledgerReads).toHaveLength(0);
    expect(screen.queryByTestId('action-ledger-switch')).toBeNull();
  });

  it('a writable package\'s action is edited, not switched: no switch', async () => {
    layered = { ...layered, editable: true, deletable: true };
    openItem(hostOf('com.acme.mine', false));
    // Control: the page rendered the item.
    expect(await screen.findAllByText('send_reminder')).not.toHaveLength(0);
    expect(screen.queryByTestId('action-ledger-switch')).toBeNull();
    expect(vi.mocked(fetchPackages)).not.toHaveBeenCalled();
  });
});
