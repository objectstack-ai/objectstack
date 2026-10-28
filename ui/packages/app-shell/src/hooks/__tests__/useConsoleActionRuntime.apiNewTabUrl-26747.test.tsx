/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26747 — the shared console action runtime (list pages, the
 * list toolbar, the console root provider) honours `opensInNewTab` +
 * `newTabUrl` on a `type: 'api'` action: the pre-opened tab goes to
 * `newTabUrl` with the selected row's id substituted, and no request is sent.
 *
 * Driven through a real `ActionRunner` carrying the runtime's own context and
 * registered handler set, exactly as `ActionProvider` wires them, and through
 * the `apiHandler` the hook returns (what `ConsoleShell` registers).
 *
 * CONTROL: without `newTabUrl` the api action still sends its request to
 * `target`. The fast path's row-count refusal is the server-action one: two
 * selected rows refuse before any tab opens.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const authFetchSpy = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => authFetchSpy,
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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
}));

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

import { ActionRunner } from '@object-ui/core';
import { useConsoleActionRuntime } from '../useConsoleActionRuntime';

const TARGET = '/api/v1/export/gapdata_item';
const NEW_TAB_ACTION = {
  name: 'export_tab',
  label: 'Export',
  type: 'api',
  target: TARGET,
  opensInNewTab: true,
  newTabUrl: '/export/{recordId}',
  locations: ['list_toolbar'],
};

function stubWindowOpen() {
  const tab = {
    document: { write: vi.fn(), close: vi.fn() },
    location: { href: 'about:blank' },
    close: vi.fn(),
  };
  const open = vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);
  return { tab, open };
}

/** A real runner wired to the runtime the way `ActionProvider` wires it. */
function runnerFor(selectedRecords: Array<Record<string, unknown>>) {
  const { result } = renderHook(() =>
    useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'gapdata_item' }),
  );
  const props = result.current.actionProviderProps;
  const runner = new ActionRunner({ ...props.context, selectedRecords } as any);
  for (const [type, handler] of Object.entries(props.handlers ?? {})) {
    runner.registerHandler(type, handler as any);
  }
  return { runner, runtime: result.current };
}

beforeEach(() => {
  authFetchSpy.mockReset();
  authFetchSpy.mockImplementation(async () =>
    new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('objectstack#26747 — console runtime: an api action with opensInNewTab + newTabUrl opens the tab and sends nothing', () => {
  it('list toolbar, one row selected: the pre-opened tab goes to the interpolated newTabUrl, and no request is sent', async () => {
    const { runner } = runnerFor([{ id: 'row 7' }]);
    const { tab, open } = stubWindowOpen();

    let result: any;
    await act(async () => {
      result = await runner.execute({ ...NEW_TAB_ACTION } as any);
    });

    expect(result.success).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.location.href).toBe(`${window.location.origin}/export/row%207`);
    expect(authFetchSpy).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('the apiHandler the hook returns (what ConsoleShell registers) takes the same path', async () => {
    const { runtime } = runnerFor([]);
    const { tab } = stubWindowOpen();

    await act(async () => {
      await runtime.apiHandler({ ...NEW_TAB_ACTION, params: { recordId: 'rec-1' } } as any);
    });

    expect(tab.location.href).toBe(`${window.location.origin}/export/rec-1`);
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('two rows selected: refused before any tab opens, with nothing sent', async () => {
    const { runner } = runnerFor([{ id: 'a' }, { id: 'b' }]);
    const { open } = stubWindowOpen();

    let result: any;
    await act(async () => {
      result = await runner.execute({ ...NEW_TAB_ACTION } as any);
    });

    expect(result.success).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('CONTROL: without newTabUrl the api action still sends its request to the target', async () => {
    const { newTabUrl: _dropped, ...withoutNewTabUrl } = NEW_TAB_ACTION;
    const { runner } = runnerFor([{ id: 'row 7' }]);
    const { open } = stubWindowOpen();

    await act(async () => {
      await runner.execute({ ...withoutNewTabUrl } as any);
    });

    expect(authFetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith(TARGET)).toBe(true);
    expect(init.method).toBe('POST');
    expect(open).not.toHaveBeenCalledWith('about:blank', '_blank');
  });
});
