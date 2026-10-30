// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D4 — on a read-only package's open flow the Automations pillar
 * offers the activation-ledger switch ("off for this deployment", bound to
 * `GET /automation/_status` + `POST /automation/<name>/toggle`) and Clone
 * (`POST /automation/<name>/clone`, with the server's notice and the "switch
 * the original off" offer, objectui#13270). Both are pre-judged from the two
 * served posture facts (`features.tenancyPosture`, `user.isPlatformAdmin`),
 * and every server refusal is shown as sent.
 *
 * The pins, each against a control that discriminates it:
 *  - the switch reads the LEDGER row, not the definition: the flow's draft is
 *    `obsolete` (definition off) while `_status` reports it enabled, and the
 *    switch reads on; a flip posts the toggle and saves no draft;
 *  - under a wall a non-operator gets a disabled switch and a disabled Clone,
 *    each with the console's sentence, and nothing is sent; `single` and the
 *    operator under the same wall (CONTROLS) get live controls;
 *  - a refusal is the server's sentence, verbatim;
 *  - the clone sends exactly the two keys, keeps the notice verbatim, and its
 *    switch-off offer sends the same toggle, then reads the source as off;
 *  - a writable package's flow (CONTROL) keeps its definition switch and its
 *    Delete, with no ledger switch and no Clone.
 *
 * The harness is `AutomationsPillar.deleteFlow-27356`'s: the metadata server
 * doubled at the client, the `/automation` doors doubled at `fetch`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.crm';

// The definition says OFF; the ledger (below) says ON. A switch bound to the
// definition would read off.
const FLOW = {
  name: 'approval',
  label: 'Approval',
  type: 'autolaunched',
  status: 'obsolete',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

// ── The published posture facts ───────────────────────────────────────────

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

// ── The metadata server, doubled at the client ─────────────────────────────

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => [{ name: 'approval', label: 'Approval' }]),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({ code: null, overlay: null, effective: { ...FLOW }, lock: 'none' })),
  getDraft: vi.fn(async (type: string, name: string) => {
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async (type: string, name: string, item: unknown) => ({ type, name, item })),
  reset: vi.fn(async () => ({})),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';

const dataSource = createEmptyDataSource();

// ── The `/automation` doors, doubled at fetch ──────────────────────────────

const doors = {
  enabled: true,
  toggle: null as null | { status: number; body: unknown },
  clone: null as null | { status: number; body: unknown },
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith('/automation/_status')) {
    return json(200, { success: true, data: { flows: [{ name: 'approval', enabled: doors.enabled, bound: true }] } });
  }
  if (url.endsWith('/automation/approval/toggle')) {
    if (doors.toggle) return json(doors.toggle.status, doors.toggle.body);
    doors.enabled = (JSON.parse(String(init?.body)) as { enabled: boolean }).enabled;
    return json(200, { success: true, data: { name: 'approval', enabled: doors.enabled } });
  }
  if (url.endsWith('/automation/approval/clone')) {
    if (doors.clone) return json(doors.clone.status, doors.clone.body);
    const sent = JSON.parse(String(init?.body)) as { name: string };
    return json(201, {
      success: true,
      data: { flow: { name: sent.name }, notice: 'The copy is a draft and runs beside the flow it was copied from.' },
    });
  }
  return json(404, null);
});
vi.stubGlobal('fetch', fetchMock);

const calls = (suffix: string) => fetchMock.mock.calls.filter(([u]) => String(u).endsWith(suffix));

beforeEach(() => {
  posture = 'single';
  operator = false;
  doors.enabled = true;
  doors.toggle = null;
  doors.clone = null;
  fetchMock.mockClear();
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  vi.mocked(toast.success).mockClear();
});

afterEach(cleanup);

function mount(readOnly = true) {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} readOnly={readOnly} />
    </MemoryRouter>,
  );
}

const ledgerSwitch = () => screen.findByTestId('auto-ledger-switch', undefined, { timeout: 8000 });

async function openMenu(): Promise<void> {
  fireEvent.pointerDown(await screen.findByTestId('auto-item-more', undefined, { timeout: 8000 }), { button: 0, ctrlKey: false });
}

describe('Automations — the ledger switch and Clone on a read-only package (ADR-0146 D4)', () => {
  it('binds the switch to the ledger, not the definition, and a flip posts the toggle and saves no draft', async () => {
    mount();
    const sw = await ledgerSwitch();
    // The definition reads `obsolete`; the ledger reads enabled.
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).toHaveTextContent('On for this deployment');
    expect(sw).toBeEnabled();
    const statusReads = calls('/automation/_status').length;

    fireEvent.click(sw);
    await waitFor(() => expect(calls('/automation/approval/toggle')).toHaveLength(1));
    const [, init] = calls('/automation/approval/toggle')[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ enabled: false });
    await waitFor(() => expect(screen.getByTestId('auto-ledger-switch')).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByTestId('auto-ledger-switch')).toHaveTextContent('Off for this deployment');
    // The runtime is read again: the answer carries the flag alone.
    await waitFor(() => expect(calls('/automation/_status').length).toBeGreaterThan(statusReads));
    expect(mockClient.save).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('"Approval" is switched off for this deployment.');
  });

  it('under a wall a tenant administrator gets a disabled switch and Clone with the console\'s sentence, and nothing is sent', async () => {
    posture = 'group';
    operator = false;
    mount();
    const sw = await ledgerSwitch();
    expect(sw).toBeDisabled();
    const reason = 'On this deployment, only the platform operator can switch or clone a packaged flow.';
    expect(screen.getByTestId('auto-ledger-walled-reason')).toHaveTextContent(reason);
    fireEvent.click(sw);
    await openMenu();
    const clone = await screen.findByTestId('auto-item-clone');
    expect(clone).toHaveAttribute('data-disabled');
    expect(screen.getByTestId('auto-item-clone-reason')).toHaveTextContent(reason);
    fireEvent.click(clone);
    expect(screen.queryByTestId('auto-clone-dialog')).toBeNull();
    expect(calls('/toggle')).toHaveLength(0);
    expect(calls('/clone')).toHaveLength(0);
  });

  it.each([
    ['single', false],
    ['isolated', true],
  ])('under %s (operator: %s) the switch and Clone are live', async (p, op) => {
    posture = p;
    operator = op;
    mount();
    expect(await ledgerSwitch()).toBeEnabled();
    expect(screen.queryByTestId('auto-ledger-walled-reason')).toBeNull();
    await openMenu();
    expect(await screen.findByTestId('auto-item-clone')).not.toHaveAttribute('data-disabled');
    expect(screen.queryByTestId('auto-item-clone-reason')).toBeNull();
  });

  it('shows the toggle\'s refusal verbatim and keeps the switch as the ledger reads it', async () => {
    const sentence =
      'Enabling or disabling a packaged flow writes the installation-wide activation row. To switch or customize this flow for the installation, ask your platform operator.';
    doors.toggle = { status: 403, body: { success: false, error: { code: 'PERMISSION_DENIED', message: sentence } } };
    mount();
    fireEvent.click(await ledgerSwitch());
    expect(await screen.findByTestId('studio-refusal-message')).toHaveTextContent(sentence);
    expect(screen.getByTestId('auto-ledger-switch')).toHaveAttribute('aria-checked', 'true');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('clones with the two keys, keeps the notice verbatim, and offers to switch the original off through the same toggle', async () => {
    mount();
    await ledgerSwitch();
    await openMenu();
    fireEvent.click(await screen.findByTestId('auto-item-clone'));
    const dialog = await screen.findByTestId('auto-clone-dialog');
    expect(within(dialog).getByTestId('auto-clone-name')).toHaveValue('approval_copy');
    expect(within(dialog).getByTestId('auto-clone-label')).toHaveValue('Approval (copy)');
    fireEvent.change(within(dialog).getByTestId('auto-clone-name'), { target: { value: 'approval_mine' } });
    fireEvent.click(within(dialog).getByTestId('auto-clone-confirm'));

    await waitFor(() => expect(calls('/automation/approval/clone')).toHaveLength(1));
    const [, init] = calls('/automation/approval/clone')[0];
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'approval_mine', label: 'Approval (copy)' });
    const result = await screen.findByTestId('auto-clone-result');
    expect(screen.queryByTestId('auto-clone-dialog')).toBeNull();
    expect(result).toHaveTextContent('Created flow "approval_mine".');
    expect(screen.getByTestId('auto-clone-notice')).toHaveTextContent(
      'The copy is a draft and runs beside the flow it was copied from.',
    );
    expect(screen.getByTestId('auto-clone-open')).toHaveAttribute(
      'href',
      expect.stringContaining(encodeURIComponent('flow:approval_mine')),
    );
    // Nothing was switched by the clone itself.
    expect(calls('/toggle')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('auto-clone-switch-source-off'));
    await waitFor(() => expect(calls('/automation/approval/toggle')).toHaveLength(1));
    expect(JSON.parse(String(calls('/automation/approval/toggle')[0][1]?.body))).toEqual({ enabled: false });
    expect(await screen.findByTestId('auto-clone-source-off')).toHaveTextContent(
      'The packaged flow "Approval" is switched off for this deployment.',
    );
    expect(screen.getByTestId('auto-ledger-switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('a refused clone keeps the dialog open with the server\'s sentence', async () => {
    const sentence = 'A flow named "approval_copy" already exists. Flows are keyed by bare name; try "approval_copy_2".';
    doors.clone = { status: 409, body: { success: false, error: { code: 'RESOURCE_CONFLICT', message: sentence } } };
    mount();
    await ledgerSwitch();
    await openMenu();
    fireEvent.click(await screen.findByTestId('auto-item-clone'));
    fireEvent.click(within(await screen.findByTestId('auto-clone-dialog')).getByTestId('auto-clone-confirm'));
    expect(await screen.findByTestId('auto-clone-refusal')).toHaveTextContent(sentence);
    expect(screen.getByTestId('auto-clone-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('auto-clone-result')).toBeNull();
  });

  it('a writable package\'s flow keeps its definition switch and Delete, with no ledger switch and no Clone', async () => {
    mount(false);
    expect(await screen.findByTestId('auto-canvas-caption', undefined, { timeout: 8000 })).toHaveTextContent('Approval');
    const sw = await screen.findByRole('switch');
    expect(sw).toHaveTextContent('Disabled');
    expect(screen.queryByTestId('auto-ledger-switch')).toBeNull();
    // The definition switch never reaches the ledger door.
    fireEvent.click(sw);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls('/toggle')).toHaveLength(0);
    await openMenu();
    expect(await screen.findByTestId('auto-item-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('auto-item-clone')).toBeNull();
  });
});
