/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36931 — a per-record bulk `type: 'flow'` action over three
 * records, where the run of two of them pauses at a screen.
 *
 * Before the fix the paused rows counted as succeeded ("Succeeded 3 / 3"),
 * and the console held ONE paused run: each paused record wrote the same
 * slot, so only the last record's screen ever opened and the other record's
 * run waited at a screen nobody could reach.
 *
 * Driven end to end: the real `ObjectGrid` bulk path (selection bar, the bulk
 * dialog, the executor) inside the real `ConsoleActionRuntimeProvider` (the
 * real ActionRunner, the real flow handler, `launchConsoleFlow`, the flow rule
 * and the real `FlowRunner`). Only the network (`authFetch`) and the toast
 * library are stubbed. The shape chosen for "every screen can be reached":
 * the screens open one after another, and closing one shows the next.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const authFetchSpy = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => authFetchSpy,
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({ isLoaded: false, checkField: () => true, getObjectApiOperations: () => undefined, can: () => true }),
  };
});

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { ObjectGrid } from '@object-ui/plugin-grid';
import { registerAllFields } from '@object-ui/fields';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';
import { ConsoleActionRuntimeProvider } from '../useConsoleActionRuntime';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as never;
  }
});

const OBJECT = 'crm_lead';
const FLOW = 'qualify_lead';
const QUALIFY = { name: 'qualify', label: 'Qualify', type: 'flow', target: FLOW };
const LEADS = [
  { id: 'l1', name: 'Ann' },
  { id: 'l2', name: 'Bea' },
  { id: 'l3', name: 'Cy' },
];
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

/** The record a trigger request names, read off the body `launchConsoleFlow` sends. */
function recordOf(init: RequestInit | undefined): string {
  const body = JSON.parse(String(init?.body ?? '{}')) as { recordId?: unknown };
  return String(body.recordId);
}

/**
 * The engine's answer for one record: a paused run for each id in `pausing`,
 * a completed one otherwise. Each paused screen carries `fields` (none by
 * default).
 */
function answerFor(pausing: string[], fields: unknown[] = []) {
  return async (_url: string, init?: RequestInit) => {
    const id = recordOf(init);
    const data = pausing.includes(id)
      ? {
        success: true,
        status: 'paused',
        runId: `run-${id}`,
        flowLabel: 'Qualify lead',
        screen: { nodeId: 'confirm', title: `Confirm ${LEADS.find((l) => l.id === id)?.name}`, fields },
      }
      : { success: true, status: 'completed' };
    return { ok: true, status: 200, json: async () => ({ success: true, data }) };
  };
}

/** The record a screen's `record_link` field leads to (the #36849 path). */
const ACCOUNT_OBJECT = 'crm_account';
const ACCOUNT = { id: 'acc_1', name: 'Acme' };

/**
 * Mount the grid inside the console runtime. `atApp` mounts it on an app
 * route and lets the console route to `crm_account`, so a screen's record
 * link is drawn as a link; otherwise the console holds no object at all.
 */
function renderGridInConsole({ atApp = false }: { atApp?: boolean } = {}) {
  const dataSource = {
    find: vi.fn(async () => ({ data: LEADS.map((r) => ({ ...r })), total: LEADS.length, hasMore: false, pageSize: 50 })),
    findOne: vi.fn(async (object: string, id: string) => (object === ACCOUNT_OBJECT && id === ACCOUNT.id ? ACCOUNT : null)),
    create: vi.fn(),
    update: vi.fn(async () => ({})),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => (name === ACCOUNT_OBJECT
      ? { name, nameField: 'name', fields: { name: { type: 'text', label: 'Name' } } }
      : {
        name,
        fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
        actions: [QUALIFY],
      })),
  };
  const onRefresh = vi.fn();
  const page = (
    /* The console holds no declared action for the grid's object, so each
       record starts the flow on the trigger route: one request per record. */
    <ConsoleActionRuntimeProvider
      dataSource={dataSource}
      objects={atApp ? [{ name: ACCOUNT_OBJECT }] : []}
      objectName={OBJECT}
      onRefresh={onRefresh}
    >
      <SchemaRendererProvider dataSource={dataSource as never}>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: OBJECT,
            columns: [{ field: 'name', label: 'Name' }],
            pagination: { pageSize: 50 },
            bulkActions: ['qualify'],
          } as never}
          dataSource={dataSource as never}
        />
      </SchemaRendererProvider>
    </ConsoleActionRuntimeProvider>
  );
  render(
    <I18nProvider config={EN} persistLanguage={false}>
      {atApp ? (
        <MemoryRouter initialEntries={[`/apps/crm/${OBJECT}`]}>
          <Routes>
            <Route path="/apps/:appName/*" element={page} />
          </Routes>
        </MemoryRouter>
      ) : (
        <MemoryRouter>{page}</MemoryRouter>
      )}
    </I18nProvider>,
  );
  return { onRefresh };
}

/** Select every row, run the bulk action, and wait for all three dispatches. */
async function runBulkOverAll() {
  await waitFor(() => expect(screen.getByText('Ann')).toBeInTheDocument());
  await waitFor(() => expect(document.querySelector('thead [role="checkbox"]')).toBeTruthy());
  fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
  fireEvent.click(await screen.findByTestId('bulk-action-qualify'));
  fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
  await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(LEADS.length));
}

/** The heading of the screen the flow runner shows now, or `null` when none is open. */
function shownScreen(): string | null {
  const heading = screen
    .queryAllByRole('heading', { hidden: true })
    .find((h) => /^Confirm /.test(h.textContent ?? ''));
  return heading?.textContent ?? null;
}

/** The flow runner's dialog that shows the screen headed `title`. */
function screenDialog(title: string): HTMLElement {
  const heading = screen.queryAllByRole('heading', { hidden: true }).find((h) => h.textContent === title);
  return heading?.closest('[role="dialog"]') as HTMLElement;
}

/** Close the screen the flow runner shows with its Cancel button. */
function cancelShownScreen() {
  fireEvent.click(within(screenDialog(shownScreen()!)).getByRole('button', { name: 'Cancel', hidden: true }));
}

beforeEach(() => {
  authFetchSpy.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('a per-record bulk flow that pauses two of three records (objectstack#36931)', () => {
  it('the result names two records as waiting for input, and both screens can be reached, one after another', async () => {
    authFetchSpy.mockImplementation(answerFor(['l1', 'l3']));
    renderGridInConsole();
    await runBulkOverAll();

    for (const call of authFetchSpy.mock.calls) {
      expect(String(call[0])).toContain(`/api/v1/automation/${FLOW}/trigger`);
    }

    // The result: one succeeded, two waiting, and the two named.
    await waitFor(() => expect(screen.getByText(/Succeeded 1 \/ 3/)).toBeInTheDocument());
    expect(screen.getByText(/Waiting for input 2/)).toBeInTheDocument();
    expect(screen.getByTestId('bulk-paused-row-l1')).toHaveTextContent('Ann');
    expect(screen.getByTestId('bulk-paused-row-l3')).toHaveTextContent('Cy');
    expect(screen.queryByTestId('bulk-paused-row-l2')).not.toBeInTheDocument();

    // Every paused record's screen: the first is shown, closing it shows the
    // next, and closing the last leaves none. Before the fix only the last
    // record's screen ever opened.
    const reached: string[] = [];
    await waitFor(() => expect(shownScreen()).not.toBeNull());
    reached.push(shownScreen()!);
    cancelShownScreen();
    await waitFor(() => expect(shownScreen()).not.toBe(reached[0]));
    expect(shownScreen()).not.toBeNull();
    reached.push(shownScreen()!);
    cancelShownScreen();
    await waitFor(() => expect(shownScreen()).toBeNull());

    expect(reached.sort()).toEqual(['Confirm Ann', 'Confirm Cy']);
  });

  it('control: one paused record shows its one screen, and closing it leaves none', async () => {
    authFetchSpy.mockImplementation(answerFor(['l2']));
    renderGridInConsole();
    await runBulkOverAll();

    await waitFor(() => expect(screen.getByText(/Succeeded 2 \/ 3/)).toBeInTheDocument());
    expect(screen.getByText(/Waiting for input 1/)).toBeInTheDocument();
    await waitFor(() => expect(shownScreen()).toBe('Confirm Bea'));
    cancelShownScreen();
    await waitFor(() => expect(shownScreen()).toBeNull());
  });
});

/**
 * The queue settles a run BY ITS KEY, never "the head" (`useScreenFlowQueue`).
 * A result screen's record link closes the dialog first and completes the run
 * after it (objectstack#36849): the close shows the next queued run, and the
 * first run's completion arrives later, from the runner that already went
 * away. Settling the head there would drop the next run, whose screen was
 * just shown, and its record would wait at a screen nobody could reach.
 */
describe('a queued run stays on screen when the run before it completes after its dialog closed (objectstack#36931)', () => {
  const ACCOUNT_LINK = { name: 'account', label: 'Account', type: 'record_link', reference: ACCOUNT_OBJECT, defaultValue: ACCOUNT.id };

  it('following the first result screen\'s record link shows the second screen, and the first run\'s late completion keeps it', async () => {
    // The first resume (the result screen's completion) waits until released.
    let releaseResume: (() => void) | undefined;
    const resumed: string[] = [];
    const trigger = answerFor(['l1', 'l3'], [ACCOUNT_LINK]);
    authFetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!String(url).endsWith('/resume')) return trigger(url, init);
      resumed.push(String(url));
      await new Promise<void>((resolve) => { releaseResume = resolve; });
      return { ok: true, status: 200, json: async () => ({ success: true, data: { success: true, status: 'completed' } }) };
    });
    const { onRefresh } = renderGridInConsole({ atApp: true });
    await runBulkOverAll();

    await waitFor(() => expect(shownScreen()).not.toBeNull());
    const first = shownScreen()!;
    const link = await waitFor(() => within(screenDialog(first)).getByRole('link', { name: 'Acme', hidden: true }));
    fireEvent.click(link);

    // The link closed the first dialog at once, and the next run is shown.
    await waitFor(() => expect(shownScreen()).not.toBeNull());
    await waitFor(() => expect(shownScreen()).not.toBe(first));
    const second = shownScreen()!;
    expect([first, second].sort()).toEqual(['Confirm Ann', 'Confirm Cy']);

    // The first run completes behind it, as Done completes a result screen.
    const firstRun = first === 'Confirm Ann' ? 'run-l1' : 'run-l3';
    await waitFor(() => expect(resumed).toHaveLength(1));
    expect(resumed[0]).toContain(`/runs/${firstRun}/resume`);
    const refreshesBefore = onRefresh.mock.calls.length;
    releaseResume!();
    await waitFor(() => expect(onRefresh.mock.calls.length).toBeGreaterThan(refreshesBefore));

    // Its completion settled its own run only: the second screen is still up.
    await new Promise((r) => setTimeout(r, 50));
    expect(shownScreen()).toBe(second);
  });
});
