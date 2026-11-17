// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34724 (ADR-0146 D4 as amended 2026-11-17) — a read-only app's
 * vendor action carries the activation ledger's switch on the object's Actions
 * view; Setup's Packaged Actions page, which held it, retired.
 *
 * What is pinned, in the order an operator meets it:
 *   1. the switch binds the ledger flag (no row → on; an `active: false` row →
 *      off, and the list row says so);
 *   2. a flip sends exactly `{ enabled }` to
 *      `POST /api/v1/actions/_activation/:object/:action` and the switch takes
 *      the flag the server reports;
 *   3. a refusal is the server's sentence, verbatim, in a `role="alert"`;
 *   4. a caller the door walls off sees the switch disabled with the
 *      console's reason, not a live control that answers 403;
 *   5. a platform (kernel) package's actions get no switch, nor does a
 *      writable package's (whose actions are the draft's), and a failed
 *      ledger read draws no switch but says why.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

let posture: string | undefined;
let operator: boolean | undefined;

vi.mock('../../hooks/useTenancyPosture', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTenancyPosture: () => posture,
}));
vi.mock('@object-ui/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/auth')>();
  return {
    ...mod,
    useAuth: () => ({
      ...mod.useAuth(),
      user: { id: 'u_caller', name: 'Caller', email: 'caller@example.com', isPlatformAdmin: operator },
    }),
  };
});

// The package list as `parsePackages` answers it: the switcher's entries. A
// manifest-scoped kernel package is not among them; a flat-scoped one is,
// flagged `kernel`.
const packageEntries = vi.hoisted(() => ({
  current: [] as Array<{ id: string; name: string; writable: boolean; namespace: string; kernel?: true }>,
}));
vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => packageEntries.current) };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { ObjectActionsPanel } from './ObjectActionsPanel';
import { fetchPackages } from './packages-io';

const APP = 'com.example.showcase';
const FLAT_KERNEL = 'com.objectstack.platform-objects';

const draft = {
  name: 'showcase_task',
  label: 'Task',
  actions: [
    { name: 'clone_task', label: 'Clone task', type: 'script', target: 'clone_task' },
    { name: 'close_task', label: 'Close task', type: 'script', target: 'close_task' },
  ],
};

type Answer = { status: number; body: unknown };
let ledgerAnswer: Answer;
let toggleAnswer: Answer;
let fetchMock: ReturnType<typeof vi.fn>;

const ok = (body: unknown): Answer => ({ status: 200, body });
const ledgerRows = (rows: Array<Record<string, unknown>>) =>
  ok({ success: true, data: { object: 'sys_metadata_activation', records: rows } });

beforeEach(() => {
  posture = 'single';
  operator = false;
  packageEntries.current = [
    { id: APP, name: 'Showcase', writable: false, namespace: 'showcase' },
    { id: FLAT_KERNEL, name: 'Platform objects', writable: false, namespace: 'sys', kernel: true },
  ];
  ledgerAnswer = ledgerRows([]);
  toggleAnswer = ok({ success: true, data: { enabled: false } });
  fetchMock = vi.fn(async (url: string) => {
    const answer = String(url).includes('/actions/_activation/') ? toggleAnswer : ledgerAnswer;
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(toast.success).mockClear();
  vi.mocked(fetchPackages).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPanel({ pkg = APP, readOnly = true }: { pkg?: string; readOnly?: boolean } = {}) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/studio/${pkg}/data`]}>
        <Routes>
          <Route
            path="/studio/:packageId/:tab"
            element={<ObjectActionsPanel draft={draft} onPatch={() => {}} disabled={readOnly} />}
          />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

const ledgerReads = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('sys_metadata_activation'));

describe('a read-only app\'s vendor action carries the ledger switch (objectstack#34724)', () => {
  it('binds the ledger flag: no row reads on', async () => {
    renderPanel();
    const sw = await screen.findByTestId('action-ledger-switch');
    expect(sw).toHaveAttribute('role', 'switch');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).toHaveAttribute('data-reading', 'on');
    expect(sw).toHaveTextContent('Switched on for this deployment');
    expect(screen.queryByTestId('action-ledger-off-mark')).toBeNull();
    expect(String(ledgerReads()[0][0])).toBe('/api/v1/data/sys_metadata_activation?top=1000');
  });

  it('an active:false action row reads off, on the switch and in the list', async () => {
    ledgerAnswer = ledgerRows([
      { metadata_type: 'action', name: 'clone_task', package_id: APP, organization_id: null, active: false },
      // A flow's row of the same name is not the action's.
      { metadata_type: 'flow', name: 'close_task', package_id: APP, organization_id: null, active: false },
    ]);
    renderPanel();
    const sw = await screen.findByTestId('action-ledger-switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveAttribute('data-reading', 'off');
    const marks = screen.getAllByTestId('action-ledger-off-mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].closest('button')).toHaveTextContent('Clone task');
  });

  it('a flip sends exactly { enabled } to the action door and takes the flag the server reports', async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId('action-ledger-switch'));
    await waitFor(() => expect(screen.getByTestId('action-ledger-switch')).toHaveAttribute('aria-checked', 'false'));
    const post = fetchMock.mock.calls.find(([url]) => String(url).includes('/actions/_activation/'));
    expect(post?.[0]).toBe('/api/v1/actions/_activation/showcase_task/clone_task');
    expect(post?.[1]).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ enabled: false });
    expect(toast.success).toHaveBeenCalledWith('"Clone task" is switched off for this deployment.');
    expect(screen.getByTestId('action-ledger-off-mark')).toBeInTheDocument();
  });

  it('a refusal is the server\'s sentence, verbatim, in an alert, and the switch keeps its flag', async () => {
    const sentence =
      "Action 'clone_task' is declared by more than one object (showcase_task, showcase_project); the activation ledger addresses an action by name.";
    toggleAnswer = { status: 409, body: { success: false, error: { code: 'RESOURCE_CONFLICT', message: sentence } } };
    renderPanel();
    fireEvent.click(await screen.findByTestId('action-ledger-switch'));
    const alert = await screen.findByTestId('action-ledger-refusal');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(sentence);
    expect(screen.getByTestId('action-ledger-switch')).toHaveAttribute('aria-checked', 'true');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a caller the walled posture refuses sees it disabled, with the console\'s reason, and sends nothing', async () => {
    posture = 'group';
    operator = false;
    renderPanel();
    const sw = await screen.findByTestId('action-ledger-switch');
    expect(sw).toBeDisabled();
    expect(screen.getByTestId('auto-ledger-walled-reason')).toHaveTextContent(
      'On this deployment, only the platform operator can switch a packaged action on or off.',
    );
    fireEvent.click(sw);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/actions/_activation/'))).toBe(false);
  });

  it('the platform operator under the same posture gets a live switch', async () => {
    posture = 'group';
    operator = true;
    renderPanel();
    expect(await screen.findByTestId('action-ledger-switch')).not.toBeDisabled();
  });
});

describe('no switch where the maintainer ruled none, and none where it means nothing (objectstack#34724)', () => {
  it('a kernel package the switcher flags gets no switch, and its ledger is not read', async () => {
    renderPanel({ pkg: FLAT_KERNEL });
    // The list renders (control), the switch never does.
    expect(await screen.findAllByText('Clone task')).not.toHaveLength(0);
    await waitFor(() => expect(vi.mocked(fetchPackages)).toHaveBeenCalled());
    expect(screen.queryByTestId('action-ledger-switch')).toBeNull();
    expect(ledgerReads()).toHaveLength(0);
  });

  it('a package the switcher does not list (a manifest-scoped kernel package) gets no switch', async () => {
    renderPanel({ pkg: 'com.objectstack.auth' });
    expect(await screen.findAllByText('Clone task')).not.toHaveLength(0);
    await waitFor(() => expect(vi.mocked(fetchPackages)).toHaveBeenCalled());
    expect(screen.queryByTestId('action-ledger-switch')).toBeNull();
    expect(ledgerReads()).toHaveLength(0);
  });

  it('an unreadable package list offers no switch (the platform-safe direction)', async () => {
    vi.mocked(fetchPackages).mockRejectedValueOnce(new Error('HTTP 500'));
    renderPanel();
    expect(await screen.findAllByText('Clone task')).not.toHaveLength(0);
    await waitFor(() => expect(vi.mocked(fetchPackages)).toHaveBeenCalled());
    expect(screen.queryByTestId('action-ledger-switch')).toBeNull();
  });

  it('a writable package\'s actions are the draft\'s: no switch, no ledger read', async () => {
    renderPanel({ readOnly: false });
    expect(await screen.findAllByText('Clone task')).not.toHaveLength(0);
    expect(screen.queryByTestId('action-ledger-switch')).toBeNull();
    expect(ledgerReads()).toHaveLength(0);
  });

  it('a failed ledger read draws no switch and says why', async () => {
    ledgerAnswer = { status: 403, body: { success: false, error: { code: 'PERMISSION_DENIED', message: 'No read on sys_metadata_activation.' } } };
    renderPanel();
    const line = await screen.findByTestId('action-ledger-load-error');
    expect(line).toHaveAttribute('role', 'alert');
    expect(line).toHaveTextContent('No read on sys_metadata_activation.');
    expect(screen.queryByTestId('action-ledger-switch')).toBeNull();
  });
});
