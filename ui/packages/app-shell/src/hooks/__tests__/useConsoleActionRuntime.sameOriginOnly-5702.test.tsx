/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #5702 regression pin — the console action runtime builds its authenticated
 * fetch with `sameOriginOnly: true` (the #2725 mitigation, ruled onto this
 * lane: a metadata `type: 'api'` action's `target` is author-supplied and may
 * name an off-origin host that must never see the platform bearer or the
 * tenant header).
 *
 * The pin is deliberately a PAIR, exercised through `apiHandler` with the
 * REAL `createAuthenticatedFetch` (not the whole-module auth mock the sibling
 * test file uses — that mock never sees the option, so it cannot pin this):
 *
 *   1. a same-origin action target still carries Authorization AND
 *      X-Tenant-ID — the ruled change must leave same-origin actions
 *      untouched;
 *   2. an absolute off-origin target carries NEITHER — and the request still
 *      goes out (pass-through to the bare fetch, not a refusal).
 *
 * Either half alone proves nothing: the off-origin half is green on a wrapper
 * that attaches no headers at all, and the same-origin half is green on the
 * bare wrapper this call site built before #5702.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

// PARTIAL auth mock: `useAuth` is stubbed (renderHook mounts no AuthProvider),
// but `createAuthenticatedFetch`, `TokenStorage` and `ActiveOrganizationStorage`
// stay real — the point of this file is to observe which headers the wrapper
// the hook builds actually attaches.
vi.mock('@object-ui/auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('@object-ui/auth')>();
  return {
    ...real,
    useAuth: () => ({
      user: { id: 'u1', name: 'User', image: null },
      activeOrganization: null,
    }),
  };
});

// Partial as well — the light-dom import graph reaches other @object-ui/i18n
// exports (e.g. `createSafeTranslation` via @object-ui/components); only the
// two hooks the runtime reads are stubbed.
vi.mock('@object-ui/i18n', async (importOriginal) => {
  const real = await importOriginal<typeof import('@object-ui/i18n')>();
  return {
    ...real,
    useObjectLabel: () => ({
      fieldLabel: (_o: any, _n: any, l: any) => l,
      fieldOptionLabel: (_o: any, _f: any, _v: any, l: any) => l,
      actionParamText: (_o: any, _a: any, _p: any, _attr: any, fallback: any) => fallback,
      actionParamOptionLabel: (_o: any, _a: any, _p: any, _v: any, fallback: any) => fallback,
      actionDescription: (_o: any, _a: any, fallback: any) => fallback,
    }),
    useObjectTranslation: () => ({
      t: (key: string, options?: any) => String(options?.defaultValue ?? key),
    }),
  };
});

vi.mock('../useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(async () => ({ success: true })),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));

vi.mock('../../views/ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('../../views/ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('../../views/ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('../../views/FlowRunner', () => ({ FlowRunner: () => null }));

vi.mock('sonner', () => {
  const fn: any = vi.fn();
  fn.error = vi.fn();
  fn.success = vi.fn();
  return { toast: fn };
});

import { TokenStorage, ActiveOrganizationStorage } from '@object-ui/auth';
import { useConsoleActionRuntime } from '../useConsoleActionRuntime';

/** Stub the global fetch and capture each call's URL + resolved Headers. */
function stubFetch() {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    calls.push({ url, headers: new Headers(init?.headers) });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', mock);
  return calls;
}

describe('useConsoleActionRuntime — sameOriginOnly on the action lane (#5702)', () => {
  beforeEach(() => {
    ActiveOrganizationStorage.clear();
    ActiveOrganizationStorage.set('org-5702');
    vi.spyOn(TokenStorage, 'get').mockReturnValue('tok-5702');
  });

  afterEach(() => {
    ActiveOrganizationStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('same-origin action target still carries Authorization and X-Tenant-ID', async () => {
    const calls = stubFetch();
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [] }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.apiHandler({
        type: 'api',
        name: 'sameOriginAction',
        target: '/api/v1/env-5702',
        params: { name: 'x' },
      } as any);
    });

    expect(res).toMatchObject({ success: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/v1/env-5702');
    expect(calls[0].headers.get('Authorization')).toBe('Bearer tok-5702');
    expect(calls[0].headers.get('X-Tenant-ID')).toBe('org-5702');
  });

  it('absolute off-origin target carries neither header — and the request still goes out', async () => {
    const calls = stubFetch();
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [] }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.apiHandler({
        type: 'api',
        name: 'offOriginAction',
        target: 'https://third-party.example.com/api/hook',
        params: { name: 'x' },
      } as any);
    });

    // Pass-through, not a refusal: the request executes against the bare fetch.
    expect(res).toMatchObject({ success: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://third-party.example.com/api/hook');
    expect(calls[0].headers.get('Authorization')).toBeNull();
    expect(calls[0].headers.get('X-Tenant-ID')).toBeNull();
    expect(calls[0].headers.get('Accept-Language')).toBeNull();
  });
});
