// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35624, design step 3 — when the app's customization package
 * cannot be had, the create still saves, as before this card (naming no
 * package), and the author is told where the view went.
 *
 * The case the ruling names: under a wall, `POST /packages/:base/ensure-customization`
 * answers a tenant administrator `403` (`refuseWalledCatalogPackageWrite`). The
 * refusal is answered here in the router's error envelope, the shape
 * examples/app-crm served for its `404` (`{ success: false, error: { code,
 * message, httpStatus } }`). An app whose package the server does not list
 * takes the same fallback: there is no package to judge.
 *
 * The notice itself is `useRuntimeCreateApp`'s: the routed app's package by
 * the draft preview bar's rule, and an info toast that says the bar does not
 * count the view and where to publish it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
// The draft preview bar's publish reaches `import('@objectstack/lint')`: paid at
// collection, never inside a clocked case (`pnpm check:test-source-alias`).
import '@objectstack/lint';
import { MetadataClient } from '@object-ui/data-objectstack';
import { createRuntimeMetadata, viewEnvelope } from './runtime-metadata-persistence';
import { useRuntimeCreateApp } from './objectViewViewCrud';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const WALLED = {
  success: false,
  error: {
    code: 'PERMISSION_DENIED',
    message:
      'Ensuring the customization package of "com.example.crm" is refused. Under an isolated deployment only the platform operator writes the package catalog.',
    httpStatus: 403,
  },
};

let writes: URL[] = [];

function stubPageFetch(listed: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/packages') {
        const packages = listed
          ? [{ manifest: { id: 'com.example.crm', name: 'CRM', version: '4.0.0', scope: 'project' }, writable: false }]
          : [];
        return json(200, { success: true, data: { packages, total: packages.length, hasMore: false } });
      }
      if (url.endsWith('/ensure-customization')) return json(403, WALLED);
      return json(404, {});
    }),
  );
}

function realClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL) => {
      writes.push(new URL(String(input)));
      return json(200, { success: true, state: 'draft' });
    }) as unknown as typeof fetch,
  });
}

const env = viewEnvelope('crm_account', { type: 'grid', columns: ['name'] }, { name: 'walled_view', label: 'Walled view' });

beforeEach(() => {
  writes = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('a create the app cannot take still saves, and says where it went (objectstack#35624)', () => {
  it('the ensure door refused 403: saved naming no package, and the notice runs once, after the save', async () => {
    stubPageFetch(true);
    const order: string[] = [];
    const metadataClient = realClient();
    const save = metadataClient.save.bind(metadataClient);
    vi.spyOn(metadataClient, 'save').mockImplementation(async (...args: Parameters<typeof save>) => {
      const answer = await save(...args);
      order.push('saved');
      return answer;
    });
    const onSavedOutsideApp = vi.fn(() => order.push('notice'));

    const created = await createRuntimeMetadata('view', env.name, env, {
      metadataClient,
      app: { packageId: 'com.example.crm', onSavedOutsideApp },
    });

    expect(created).toBe('crm_account.walled_view');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.searchParams.get('mode')).toBe('draft');
    expect(writes[0]!.searchParams.has('package')).toBe(false);
    expect(order).toEqual(['saved', 'notice']);
  });

  it('an app package the server does not list: the same fallback', async () => {
    stubPageFetch(false);
    const onSavedOutsideApp = vi.fn();

    await createRuntimeMetadata('view', env.name, env, {
      metadataClient: realClient(),
      app: { packageId: 'com.example.crm', onSavedOutsideApp },
    });

    expect(writes[0]!.searchParams.has('package')).toBe(false);
    expect(onSavedOutsideApp).toHaveBeenCalledTimes(1);
  });

  it('useRuntimeCreateApp: the routed app, and an info toast naming where to publish', () => {
    const t = ((_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key) as never;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={['/apps/com.example.crm/crm_account']}>
        <Routes>
          <Route path="/apps/:appName/:objectName" element={<>{children}</>} />
        </Routes>
      </MemoryRouter>
    );
    const { result } = renderHook(() => useRuntimeCreateApp(t), { wrapper });

    expect(result.current.packageId).toBe('com.example.crm');
    result.current.onSavedOutsideApp?.();
    expect(toast.info).toHaveBeenCalledTimes(1);
    const [text] = vi.mocked(toast.info).mock.calls[0] as [string];
    expect(text).toMatch(/^This view was saved as a draft outside this app/);
    expect(text).toContain('publish it from Home');
  });
});
