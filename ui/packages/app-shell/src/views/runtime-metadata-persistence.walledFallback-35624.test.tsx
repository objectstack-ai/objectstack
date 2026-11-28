// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35624, design step 3 — when the app's customization package
 * could not be had, the create still saved naming no package, and the author
 * was told where the view went.
 *
 * objectstack#38149 (decisions Q-b of topic objectstack#37424, answered C)
 * supersedes that fallback: a console create never names no package.
 *
 *  - Under a wall, `POST /packages/:base/ensure-customization` answers a
 *    tenant administrator `403` (`refuseWalledCatalogPackageWrite`), in the
 *    router's error envelope: the create is refused with the door's reason,
 *    and nothing is written.
 *  - An app whose package the server does not list: the person is asked, and
 *    a cancelled ask writes nothing.
 *  - `useRuntimeCreateApp` hands the routed app's package (by the draft
 *    preview bar's rule) and the ask; it toasts nothing itself.
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
import { createRuntimeMetadata, isRuntimeCreateNotSaved, viewEnvelope } from './runtime-metadata-persistence';
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

describe('a create the app cannot take is refused or asks, and never saves naming no package (objectstack#38149)', () => {
  it('the ensure door refused 403: refused with the door\'s reason, nothing written, nothing asked', async () => {
    stubPageFetch(true);
    const askPackage = vi.fn(async () => 'app.chosen');

    const err = await createRuntimeMetadata('view', env.name, env, {
      metadataClient: realClient(),
      app: { packageId: 'com.example.crm', askPackage },
    }).catch((e: unknown) => e);

    expect(isRuntimeCreateNotSaved(err) && err.reason).toBe('caller-refused');
    expect((err as Error).message).toContain(WALLED.error.message);
    expect(askPackage).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('an app package the server does not list: the person is asked, and a cancel writes nothing', async () => {
    stubPageFetch(false);
    const askPackage = vi.fn(async () => null);

    const err = await createRuntimeMetadata('view', env.name, env, {
      metadataClient: realClient(),
      app: { packageId: 'com.example.crm', askPackage },
    }).catch((e: unknown) => e);

    expect(askPackage).toHaveBeenCalledTimes(1);
    expect(isRuntimeCreateNotSaved(err) && err.reason).toBe('cancelled');
    expect(writes).toEqual([]);
  });

  it('useRuntimeCreateApp: the routed app and the ask, and no toast of its own', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={['/apps/com.example.crm/crm_account']}>
        <Routes>
          <Route path="/apps/:appName/:objectName" element={<>{children}</>} />
        </Routes>
      </MemoryRouter>
    );
    const { result } = renderHook(() => useRuntimeCreateApp(), { wrapper });

    expect(result.current.packageId).toBe('com.example.crm');
    expect(typeof result.current.askPackage).toBe('function');
    expect(toast.info).not.toHaveBeenCalled();
  });
});
