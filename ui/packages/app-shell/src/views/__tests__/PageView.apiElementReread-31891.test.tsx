/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#31891 — a page element bound to an `api` data source reads again
 * after an action on the same page succeeds, and only then.
 *
 * The page holds one element bound to `GET /api/v1/reread-probe/workers` with a
 * row `action:button` inside it that POSTs through the console action runtime's
 * `api` handler (the authenticated fetch, mocked here). The GETs are the
 * element reader's (the global fetch, stubbed here), so the two are counted
 * apart. The page is mounted under the console's `ElementApiOpenScope`, as
 * `ConsoleShell` mounts it, so the kept answer of the open is in play too.
 *
 *  1. a successful click makes exactly one more GET, keeps the rows and the
 *     clicked button on screen while it is in flight, and renders the new answer;
 *  2. a failed click makes no GET;
 *  3. a cancelled confirmation sends nothing and makes no GET;
 *  4. a change declared on the bus outside the page's actions makes no GET;
 *  5. a failed re-read draws the binding's error face, not the rows from before
 *     the write.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const authFetchSpy = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', role: 'user', image: null }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => authFetchSpy,
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (k: string, o?: any) => o?.defaultValue ?? o?.name ?? k, language: 'en' }),
  useObjectLabel: () => ({
    fieldLabel: (_o: any, _n: any, l: any) => l,
    fieldOptionLabel: (_o: any, _f: any, _v: any, l: any) => l,
    actionParamText: (_o: any, _a: any, _p: any, _attr: any, fallback: any) => fallback,
  }),
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  const perms = {
    check: () => ({ allowed: true }),
    checkField: () => true,
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    isLoaded: false,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  };
  return { ...actual, usePermissions: () => perms };
});

/** The stored page document the next mount resolves. */
let storedPage: Record<string, unknown> = {};

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ pages: [storedPage], objects: [], getTypeStatus: () => 'ready' }),
}));

vi.mock('../MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
vi.mock('../RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ComponentRegistry } from '@object-ui/core';
import { AdapterCtx, ElementApiOpenScope, SchemaRenderer, SchemaRendererProvider, notifyDataChanged } from '@object-ui/react';
// Side-effect import: `page` and `action:button`.
import '@object-ui/components';
import { PageView } from '../PageView';

const READ_URL = '/api/v1/reread-probe/workers';
const WRITE_URL = '/api/v1/reread-probe/workers/turn-off';

/**
 * The bound element: draws the selected `state` and its row button (its
 * children, through `SchemaRenderer`), with an instance id a remount resets.
 */
function WorkerRows({ schema }: any) {
  const [instance] = React.useState(() => Math.random().toString(36).slice(2));
  return (
    <div data-testid="worker-rows" data-instance={instance}>
      <span data-testid="worker-state">{String(schema?.properties?.content ?? '')}</span>
      {(schema?.children ?? []).map((child: any, index: number) => (
        <SchemaRenderer key={index} schema={child} />
      ))}
    </div>
  );
}

function rowButton(extra: Record<string, unknown> = {}) {
  return {
    type: 'action:button',
    properties: { name: 'turn_off', label: 'Turn off', actionType: 'api', target: WRITE_URL, method: 'POST', ...extra },
  };
}

function page(extra: Record<string, unknown> = {}) {
  return {
    name: 'workforce',
    label: 'Workforce',
    type: 'app',
    children: [
      {
        type: 'worker-rows',
        id: 'rows',
        dataSource: { provider: 'api', read: { url: READ_URL }, path: 'data' },
        properties: { content: '${data.state}' },
        children: [rowButton(extra)],
      },
    ],
  };
}

/** What each GET of the bound URL answers, in turn; a pending promise holds that answer. */
let readAnswers: Array<Response | Promise<Response>> = [];
let readCount = 0;
const reads = () => readCount;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mount(stored: Record<string, unknown>) {
  storedPage = stored;
  render(
    <AdapterCtx.Provider value={{} as never}>
      <SchemaRendererProvider dataSource={{} as any}>
        <MemoryRouter initialEntries={['/apps/demo/page/workforce']}>
          <ElementApiOpenScope open="visit-1">
            <Routes>
              <Route path="/apps/:app/page/:pageName" element={<PageView />} />
            </Routes>
          </ElementApiOpenScope>
        </MemoryRouter>
      </SchemaRendererProvider>
    </AdapterCtx.Provider>,
  );
}

/** A window long enough for every effect a step schedules to have fired. */
const settle = (ms = 200) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

const state = () => screen.getByTestId('worker-state').textContent;
const turnOff = () => screen.getByRole('button', { name: 'Turn off' });
const loadingPanel = () => document.body.querySelector('[data-testid="worker-rows-resolving-view"]');

async function click(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
}

beforeEach(() => {
  cleanup();
  readAnswers = [json({ data: { state: 'on' } })];
  readCount = 0;
  ComponentRegistry.register('worker-rows', WorkerRows as any);
  authFetchSpy.mockReset();
  authFetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === READ_URL) {
        const answer = readAnswers[Math.min(readCount, readAnswers.length - 1)];
        readCount += 1;
        return answer;
      }
      return json({ data: [] });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('an api-bound page element reads again after the page’s own action (objectstack#31891)', () => {
  it('1. a successful click makes one more GET, keeps the rows and the button while it is in flight, and renders the new answer', async () => {
    const reread = deferred<Response>();
    readAnswers = [json({ data: { state: 'on' } }), reread.promise];
    mount(page());
    await waitFor(() => expect(state()).toBe('on'));
    await settle();
    expect(reads()).toBe(1);
    const rows = screen.getByTestId('worker-rows');
    const button = turnOff();

    await click(button);
    await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(1));
    expect(authFetchSpy.mock.calls[0][0]).toContain(WRITE_URL);
    await waitFor(() =>
      expect(reads(), 'The bound element did not read again after the page action succeeded.').toBe(2),
    );
    expect(loadingPanel(), 'the element fell back to its loading panel during the re-read').toBeNull();
    expect(state(), 'the rows from before must stay on screen until the new answer lands').toBe('on');
    expect(turnOff(), 'the clicked row button was unmounted during the re-read').toBe(button);

    await act(async () => reread.resolve(json({ data: { state: 'off' } })));
    await waitFor(() => expect(state()).toBe('off'));
    expect(screen.getByTestId('worker-rows').dataset.instance, 'the re-read remounted the element').toBe(rows.dataset.instance);
    await settle();
    expect(reads(), 'the element read again more than once').toBe(2);
  });

  it('2. a failed click makes no GET', async () => {
    authFetchSpy.mockResolvedValue({ ok: false, status: 500, json: async () => ({ success: false, error: { message: 'boom' } }) });
    mount(page());
    await waitFor(() => expect(state()).toBe('on'));
    await settle();

    await click(turnOff());
    await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(1));
    await settle();

    expect(reads(), 'a failed action made the element read again').toBe(1);
    expect(state()).toBe('on');
  });

  it('3. a cancelled confirmation sends nothing and makes no GET', async () => {
    mount(page({ confirmText: 'Turn this worker off?' }));
    await waitFor(() => expect(state()).toBe('on'));
    await settle();

    await click(turnOff());
    const cancel = await screen.findByRole('button', { name: /cancel/i });
    await click(cancel);
    await settle();

    expect(authFetchSpy, 'setup: the cancelled action must not have run').not.toHaveBeenCalled();
    expect(reads(), 'a cancelled action made the element read again').toBe(1);
  });

  it('4. a change declared on the bus outside the page’s actions makes no GET', async () => {
    mount(page());
    await waitFor(() => expect(state()).toBe('on'));
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
      notifyDataChanged({ objectName: 'account', recordId: 'a1' });
    });
    await settle();

    expect(reads(), 'a change the page did not make made the element read again').toBe(1);
  });

  it('5. a failed re-read draws the binding’s error face, not the rows from before the write', async () => {
    readAnswers = [json({ data: { state: 'on' } }), json({ error: 'down' }, 503)];
    mount(page());
    await waitFor(() => expect(state()).toBe('on'));
    await settle();

    await click(turnOff());
    await waitFor(() => expect(reads()).toBe(2));
    await waitFor(() => expect(screen.getByTestId('worker-rows-datasource-error')).toBeTruthy());
    expect(screen.queryByTestId('worker-state'), 'the rows from before the write are still drawn').toBeNull();
  });
});
