// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12045 (B1's page-mount step) — the console's `AppContent` hands the
 * shell's content the console's adapter with an approval request's record
 * reads routed to the approvals routes.
 *
 * Every surface that opens a request takes its `dataSource` from what
 * `DefaultAppContent` reads through `useAdapter()`: its record route, an
 * `ObjectView` drawer or split overlay, and the record views embedded in the
 * object data page and an interface list page. So this file pins the one
 * wiring all of them share: `DefaultAppContent`, rendered by the REAL
 * `AppContent`, reads a routed adapter. `DefaultAppContent` itself is replaced
 * by a probe that records what it reads, and the providers around it that
 * fetch on mount are passed through; what the routed adapter does is pinned in
 * `services/approvalRequestsDataSource.recordReads.test.ts`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AdapterCtx, useAdapter } from '@object-ui/react';

let shellAdapter: unknown = undefined;

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DefaultAppContent: function DefaultAppContentProbe() {
    shellAdapter = useAdapter();
    return null;
  },
}));
vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MePermissionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../LocalizationFetchProvider', () => ({
  LocalizationFetchProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../pages/settings/WorkspaceTimezonePrompt', () => ({
  WorkspaceTimezonePrompt: () => null,
}));

import { AppContent } from '../AppContent';

const REQ = 'req_12045';
let wire: string[] = [];
vi.stubGlobal(
  'fetch',
  vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://test.local');
    wire.push(url.pathname);
    return new Response(JSON.stringify({ id: REQ, status: 'pending', viewer: { can_act: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }),
);

const host = {
  find: vi.fn(async () => ({ data: [], total: 0 })),
  findOne: vi.fn(async (_resource: string, id: string) => ({ id, from: 'host' })),
  create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({})),
};

afterEach(() => {
  cleanup();
  shellAdapter = undefined;
  wire = [];
  host.findOne.mockClear();
});

describe("AppContent hands the shell's content the routed adapter (objectui#12045)", () => {
  it("DefaultAppContent reads the console's adapter with a request's findOne sent to the approvals get", async () => {
    render(
      <AdapterCtx.Provider value={host as never}>
        <AppContent />
      </AdapterCtx.Provider>,
    );
    expect(shellAdapter).toBeTruthy();
    expect(shellAdapter, 'the shell reads the routed adapter, not the bare one').not.toBe(host);
    const adapter = shellAdapter as typeof host;
    await expect(adapter.findOne('sys_approval_request', REQ)).resolves.toMatchObject({ id: REQ, viewer: { can_act: true } });
    expect(wire).toEqual([`/api/v1/approvals/requests/${REQ}`]);
    expect(host.findOne).not.toHaveBeenCalled();
  });

  it("control: another object's record read is still the console adapter's", async () => {
    render(
      <AdapterCtx.Provider value={host as never}>
        <AppContent />
      </AdapterCtx.Provider>,
    );
    const adapter = shellAdapter as typeof host;
    await expect(adapter.findOne('invoice', 'inv_1')).resolves.toEqual({ id: 'inv_1', from: 'host' });
    expect(wire).toEqual([]);
  });
});
