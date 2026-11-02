// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D4 — on a read-only package's open flow the Automations pillar
 * offers the activation-ledger switch ("off for this deployment", bound to
 * `GET /automation/_status` + `POST /automation/<name>/toggle`), in
 * `activationReading`'s three readings. It is pre-judged from the two served
 * posture facts (`features.tenancyPosture`, `user.isPlatformAdmin`), and a
 * server refusal is shown as sent.
 *
 * The pins, each against a control that discriminates it:
 *  - the switch reads the LEDGER row, not the definition, in both directions:
 *    a definition `obsolete` (off) with the ledger on reads on, and the
 *    measured disagreement, a definition `active` (on) with the ledger off,
 *    reads off, with no "switch to a writable package" hint on it; a flip
 *    posts the toggle and saves no draft;
 *  - an enabled flow the engine did not arm reads "not running here" with the
 *    platform's sentence as sent;
 *  - under a wall a non-operator gets a disabled switch with the console's
 *    sentence, and nothing is sent; `single` and the operator under the same
 *    wall (CONTROLS) get a live switch;
 *  - a refusal is the server's sentence, verbatim, announced as an alert
 *    (objectstack#29139), and announced again when the next flip is refused;
 *  - a writable package's flow (CONTROL) keeps its definition switch and its
 *    Delete, with no ledger switch;
 *  - a keyboard flip keeps focus on the switch while the request is in flight
 *    and after its answer lands, accepted or refused, and a second Space in
 *    flight sends nothing (objectstack#29228).
 *
 * The harness is `AutomationsPillar.deleteFlow-27356`'s: the metadata server
 * doubled at the client, the `/automation` doors doubled at `fetch`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.crm';

// The definition says OFF by default; the ledger (below) says ON. A switch
// bound to the definition would read off. `definition.status` flips it.
const definition = { status: 'obsolete' };
const FLOW = {
  name: 'approval',
  label: 'Approval',
  type: 'autolaunched',
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
  layered: vi.fn(async () => ({ code: null, overlay: null, effective: { ...FLOW, status: definition.status }, lock: 'none' })),
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
  unbound: null as null | { unboundCause: string; reason: string },
  toggle: null as null | { status: number; body: unknown },
  // Held until released: the toggle request is in flight meanwhile.
  toggleGate: null as null | Promise<void>,
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith('/automation/_status')) {
    const row = doors.unbound
      ? { name: 'approval', enabled: doors.enabled, bound: false, triggerType: 'schedule', ...doors.unbound }
      : { name: 'approval', enabled: doors.enabled, bound: true };
    return json(200, { success: true, data: { flows: [row] } });
  }
  if (url.endsWith('/automation/approval/toggle')) {
    if (doors.toggleGate) await doors.toggleGate;
    if (doors.toggle) return json(doors.toggle.status, doors.toggle.body);
    doors.enabled = (JSON.parse(String(init?.body)) as { enabled: boolean }).enabled;
    return json(200, { success: true, data: { name: 'approval', enabled: doors.enabled } });
  }
  return json(404, null);
});
vi.stubGlobal('fetch', fetchMock);

const calls = (suffix: string) => fetchMock.mock.calls.filter(([u]) => String(u).endsWith(suffix));

beforeEach(() => {
  posture = 'single';
  operator = false;
  definition.status = 'obsolete';
  doors.enabled = true;
  doors.unbound = null;
  doors.toggle = null;
  doors.toggleGate = null;
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

describe('Automations — the ledger switch on a read-only package (ADR-0146 D4)', () => {
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

  it('reads the measured disagreement as off: the definition is on, the ledger is off', async () => {
    definition.status = 'active';
    doors.enabled = false;
    mount();
    const sw = await ledgerSwitch();
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveAttribute('data-reading', 'off');
    expect(sw).toHaveTextContent('Off for this deployment');
    // One switch, and not the definition's: no "Enabled" word, no read-only hint.
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    expect(sw).not.toHaveTextContent('Enabled');
    expect(document.body).not.toHaveTextContent('switch to or create a writable package');
  });

  it('reads an enabled flow the engine did not arm as not running here, with the platform\'s sentence as sent', async () => {
    const reason = 'This deployment does not run scheduled work that a package authored.';
    doors.unbound = { unboundCause: 'deployment_policy', reason };
    mount();
    const sw = await ledgerSwitch();
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).toHaveAttribute('data-reading', 'not-running');
    expect(sw).toHaveTextContent('On for this deployment, not running here');
    expect(screen.getByTestId('auto-ledger-not-running-reason')).toHaveTextContent(reason);
    expect(sw.getAttribute('aria-describedby')).toContain(screen.getByTestId('auto-ledger-not-running-reason').id);
  });

  it('under a wall a tenant administrator gets a disabled switch with the console\'s sentence, and nothing is sent', async () => {
    posture = 'group';
    operator = false;
    mount();
    const sw = await ledgerSwitch();
    expect(sw).toBeDisabled();
    expect(screen.getByTestId('auto-ledger-walled-reason')).toHaveTextContent(
      'On this deployment, only the platform operator can switch a packaged flow on or off.',
    );
    fireEvent.click(sw);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls('/toggle')).toHaveLength(0);
  });

  it.each([
    ['single', false],
    ['isolated', true],
  ])('under %s (operator: %s) the switch is live', async (p, op) => {
    posture = p;
    operator = op;
    mount();
    expect(await ledgerSwitch()).toBeEnabled();
    expect(screen.queryByTestId('auto-ledger-walled-reason')).toBeNull();
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

  // objectstack#29139 — the refusal is announced, as Setup › Packaged
  // automation announced it: the sentence is an alert, and nothing is one
  // before a refusal or while the next flip is in flight.
  it('announces the subflow guard\'s 409: one alert, the sentence verbatim, and again on a second refusal', async () => {
    const sentence =
      "Flow 'approval' cannot be disabled while 1 packaged flow still calls it as a subflow: 'notify_owner'. " +
      'Disabling it would break that caller mid-run at its subflow node with a late, inexplicable failure ' +
      "(ADR-0126 §7.3). Switch 'notify_owner' off first — or leave this one armed.";
    doors.toggle = { status: 409, body: { success: false, error: { code: 'DELETE_RESTRICTED', message: sentence } } };
    mount();
    const sw = await ledgerSwitch();
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(sw);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(sentence);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByTestId('studio-refusal')).toContainElement(alert);

    // Flipped again and refused with the same sentence: the strip leaves while
    // the request is in flight, and the alert that comes back is a new element,
    // which is what makes the same sentence announced a second time.
    let release!: () => void;
    doors.toggleGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fireEvent.click(screen.getByTestId('auto-ledger-switch'));
    await waitFor(() => expect(calls('/automation/approval/toggle')).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    release();
    const again = await screen.findByRole('alert');
    expect(again).not.toBe(alert);
    expect(again.textContent).toBe(sentence);
    expect(screen.getByTestId('auto-ledger-switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('a writable package\'s flow keeps its definition switch and Delete, with no ledger switch', async () => {
    mount(false);
    expect(await screen.findByTestId('auto-canvas-caption', undefined, { timeout: 8000 })).toHaveTextContent('Approval');
    const sw = await screen.findByRole('switch');
    expect(sw).toHaveTextContent('Disabled');
    expect(screen.queryByTestId('auto-ledger-switch')).toBeNull();
    // The definition switch never reaches the ledger door.
    fireEvent.click(sw);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls('/toggle')).toHaveLength(0);
    fireEvent.pointerDown(await screen.findByTestId('auto-item-more'), { button: 0, ctrlKey: false });
    expect(await screen.findByTestId('auto-item-delete')).toBeInTheDocument();
  });
});

// objectstack#29228 — a focused control that turns `disabled` drops focus to
// the page, and nothing hands it back. In flight the switch is refused to a
// press but stays focusable, so a keyboard author's focus never leaves it.
// A browser runs the HTML focus fixup: a focused control that turns `disabled`
// drops focus to the body (measured in Chromium 153, and not handed back when
// it is enabled again). happy-dom keeps focus on it, so the test runs the
// fixup on the switch the way the browser does, else the focus pins could not
// fail. (happy-dom's `blur()` does nothing on a disabled control, so focus is
// moved to the body itself.)
function runFocusFixup(el: HTMLElement): () => void {
  const observer = new MutationObserver(() => {
    if (el.hasAttribute('disabled') && document.activeElement === el) document.body.focus();
  });
  observer.observe(el, { attributes: true, attributeFilter: ['disabled'] });
  return () => observer.disconnect();
}

describe('Automations — the ledger switch keeps keyboard focus across a flip (objectstack#29228)', () => {
  const subflowSentence =
    "Flow 'approval' cannot be disabled while 1 packaged flow still calls it as a subflow: 'notify_owner'.";

  it.each([
    ['accepted', null],
    ['refused (409)', { status: 409, body: { success: false, error: { code: 'DELETE_RESTRICTED', message: subflowSentence } } }],
  ])('a keyboard flip that is %s leaves focus on the switch, and a second Space in flight sends nothing', async (_answer, refusal) => {
    doors.toggle = refusal;
    let release!: () => void;
    doors.toggleGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const user = userEvent.setup();
    mount();
    const sw = await ledgerSwitch();
    const stopFixup = runFocusFixup(sw);
    sw.focus();
    expect(document.activeElement).toBe(sw);

    await user.keyboard(' ');
    await waitFor(() => expect(calls('/automation/approval/toggle')).toHaveLength(1));
    await waitFor(() => expect(sw).toHaveAttribute('aria-disabled', 'true'));
    // In flight: still focused, refused to a press, still focusable.
    expect(document.activeElement).toBe(sw);
    expect(sw).toBeEnabled();
    await user.keyboard(' ');
    await new Promise((r) => setTimeout(r, 50));
    expect(calls('/automation/approval/toggle')).toHaveLength(1);

    release();
    await waitFor(() => expect(sw).not.toHaveAttribute('aria-disabled'));
    if (refusal) {
      expect((await screen.findByRole('alert')).textContent).toBe(subflowSentence);
      expect(sw).toHaveAttribute('aria-checked', 'true');
    } else {
      await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
    }
    // The answer landed on the same switch, and focus is still on it.
    expect(screen.getByTestId('auto-ledger-switch')).toBe(sw);
    expect(document.activeElement).toBe(sw);
    stopFixup();
  });

  it('a walled switch stays disabled, out of the tab order, and described by its reason', async () => {
    posture = 'group';
    operator = false;
    mount();
    const sw = await ledgerSwitch();
    expect(sw).toBeDisabled();
    expect(sw).not.toHaveAttribute('aria-disabled');
    expect(sw.getAttribute('aria-describedby')).toContain(screen.getByTestId('auto-ledger-walled-reason').id);
    sw.focus();
    expect(document.activeElement).not.toBe(sw);
  });
});
