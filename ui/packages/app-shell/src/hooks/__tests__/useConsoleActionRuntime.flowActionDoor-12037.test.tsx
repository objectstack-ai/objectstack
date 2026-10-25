/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12037 — which door a LIST / PAGE flow click starts its flow through.
 *
 * Triage ruling B: a click whose object and `name` resolve to a DECLARED
 * `type: 'flow'` action with the same target goes through the action door,
 * `POST /api/v1/actions/:object/:action`, so the server-side gates that action
 * declares (ADR-0066 D4 `requiredPermissions` first) apply to the click. Every
 * other flow click — an inline page button with no or a non-matching `name`, a
 * dashboard header's synthesized `name: actionUrl` — stays on the trigger
 * route, where ruling A's elevated-start refusal holds.
 *
 * Driven end to end through the real runtime: `ConsoleActionRuntimeProvider`
 * (the real `ActionProvider` / `ActionRunner` and its toast sink), the real
 * flow handler and launch module, and the real `FlowRunner`. Only the network
 * (`authFetch`), the router and the toast library are stubbed. Server answers
 * are the envelopes the two doors serve (ADR-0112).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const authFetchSpy = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => authFetchSpy,
}));

vi.mock('sonner', () => {
  const fn: any = vi.fn();
  fn.error = vi.fn();
  fn.success = vi.fn();
  fn.info = vi.fn();
  fn.warning = vi.fn();
  return { toast: fn };
});

import { toast } from 'sonner';
import { ConsoleActionRuntimeProvider } from '../useConsoleActionRuntime';
import { MetadataCtx, useAction } from '@object-ui/react';

const OBJECT = 'showcase_task';
const FLOW = 'showcase_reassign_wizard';
/** The declared action, as the object metadata carries it. */
const DECLARED = {
  name: 'showcase_bulk_reassign',
  label: 'Reassign…',
  type: 'flow',
  target: FLOW,
  locations: ['list_item', 'list_toolbar'],
  requiredPermissions: ['showcase.reassign'],
};
const OBJECTS = [{ name: OBJECT, label: 'Task', fields: {}, actions: [DECLARED] }];
/** The door's own refusal for a caller missing the capability (`actionPermissionError`). */
const GATE_MESSAGE =
  "Action 'showcase_bulk_reassign' on 'showcase_task' requires capability [showcase.reassign] — caller is missing [showcase.reassign]";
/** Ruling A's refusal, as the trigger route serves it (`ELEVATED_START_REFUSAL`). */
const ELEVATED_MESSAGE =
  'This caller may not start this flow. A flow that runs on its own trigger starts there, '
  + "or as a sub-flow from a parent flow's `subflow` node.";

function refusal(status: number, code: string, message: string) {
  return { ok: false, status, json: async () => ({ success: false, error: { code, message, httpStatus: status } }) };
}
function answered(data: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}

beforeEach(() => {
  authFetchSpy.mockReset();
  (toast as any).mockClear();
  (toast as any).error.mockClear();
  (toast as any).success.mockClear();
});

/** Mount the runtime, click once through the real runner, resolve to the handler's result. */
async function click(
  action: Record<string, unknown>,
  opts: { objects?: any[]; objectName?: string; store?: any } = {},
) {
  let result: any;
  function Probe() {
    const { execute } = useAction();
    return (
      <button onClick={() => { void execute({ ...action } as any).then((r) => { result = r; }); }}>
        run-flow
      </button>
    );
  }
  const tree = (
    <ConsoleActionRuntimeProvider dataSource={{}} objects={opts.objects ?? OBJECTS} objectName={opts.objectName ?? OBJECT}>
      <Probe />
    </ConsoleActionRuntimeProvider>
  );
  render(opts.store ? <MetadataCtx.Provider value={opts.store}>{tree}</MetadataCtx.Provider> : tree);
  fireEvent.click(screen.getByText('run-flow'));
  await waitFor(() => expect(result).toBeDefined());
  const [url, init] = authFetchSpy.mock.calls[0];
  return { result, url: String(url), body: JSON.parse(String(init.body)) };
}

const ROW_CLICK = { ...DECLARED, params: { _rowRecord: { id: 'task-7', name: 'Write report' } } };

describe('objectui#12037 — a declared flow action is started through the action door', () => {
  it("is refused by the server on click with the door's code, and the console shows that refusal", async () => {
    authFetchSpy.mockResolvedValue(refusal(403, 'PERMISSION_DENIED', GATE_MESSAGE));

    const { result, url, body } = await click(ROW_CLICK);

    expect(url).toBe(`/api/v1/actions/${OBJECT}/showcase_bulk_reassign`);
    expect(body).toEqual({ recordId: 'task-7', params: {} });
    expect(result).toEqual({ success: false, error: GATE_MESSAGE });
    // The runner's post-execution hook toasts the server's refusal.
    expect((toast as any).error).toHaveBeenCalledWith(GATE_MESSAGE);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('control: an allowed click runs, and its paused screen resumes under the declaration target', async () => {
    authFetchSpy.mockResolvedValueOnce(answered({
      success: true,
      status: 'paused',
      runId: 'run-1',
      flowLabel: 'Reassign',
      screen: { nodeId: 'collect', title: 'New Assignee', fields: [] },
    }));

    const { result, url } = await click(ROW_CLICK);

    expect(url).toBe(`/api/v1/actions/${OBJECT}/showcase_bulk_reassign`);
    expect(result).toEqual({ success: true, silent: true });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'New Assignee' })).toBeTruthy();

    authFetchSpy.mockResolvedValueOnce(answered({ success: true, status: 'completed' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(2));
    expect(String(authFetchSpy.mock.calls[1][0])).toBe(`/api/v1/automation/${FLOW}/runs/run-1/resume`);
  });

  it("reads the console's store when the caller holds no objects, and loads it before deciding", async () => {
    authFetchSpy.mockResolvedValue(refusal(403, 'PERMISSION_DENIED', GATE_MESSAGE));
    const ensureType = vi.fn(async () => OBJECTS);
    const store = {
      objects: OBJECTS, apps: [], dashboards: [], reports: [], pages: [], loading: false, error: null,
      refresh: async () => {}, invalidate: () => {}, ensureType,
      getItem: async () => null, getItemsByType: () => [],
    };

    const { url } = await click(ROW_CLICK, { objects: [], store });

    expect(ensureType).toHaveBeenCalledWith('object');
    expect(url).toBe(`/api/v1/actions/${OBJECT}/showcase_bulk_reassign`);
  });
});

describe('objectui#12037 — a flow start that names no declared action stays on the trigger route', () => {
  it('an inline page button with no name', async () => {
    authFetchSpy.mockResolvedValue(answered({ success: true, status: 'completed' }));

    const { result, url, body } = await click({ type: 'flow', label: 'Run', target: FLOW });

    expect(url).toBe(`/api/v1/automation/${FLOW}/trigger`);
    expect(body).toEqual({ objectName: OBJECT, params: {} });
    expect(result).toMatchObject({ success: true });
  });

  it("a dashboard header action's synthesized `name: actionUrl`", async () => {
    authFetchSpy.mockResolvedValue(answered({ success: true, status: 'completed' }));

    const { url } = await click({ name: 'convert_lead_wizard', type: 'flow', target: 'convert_lead_wizard' });

    expect(url).toBe('/api/v1/automation/convert_lead_wizard/trigger');
  });

  it('a name that matches a declaration of another target, or of another type', async () => {
    authFetchSpy.mockResolvedValue(answered({ success: true, status: 'completed' }));
    const { url: otherTarget } = await click({ ...ROW_CLICK, target: 'some_other_flow' });
    expect(otherTarget).toBe('/api/v1/automation/some_other_flow/trigger');

    authFetchSpy.mockClear();
    cleanup();
    const scriptTyped = [{ ...OBJECTS[0], actions: [{ ...DECLARED, type: 'script' }] }];
    const { url: otherType } = await click({ ...ROW_CLICK }, { objects: scriptTyped });
    expect(otherType).toBe(`/api/v1/automation/${FLOW}/trigger`);
  });

  it('control: an object-less declared action is absent from object metadata, so it keeps the trigger route', async () => {
    // A nav item resolves an object-less action from `action` metadata and
    // dispatches it with no `objectName`, under a runtime bound to no object.
    authFetchSpy.mockResolvedValue(answered({ success: true, status: 'completed' }));

    const { url } = await click({ ...ROW_CLICK }, { objectName: '' });

    expect(url).toBe(`/api/v1/automation/${FLOW}/trigger`);
  });

  it('an elevated self-triggered target is still refused there, and the console shows it', async () => {
    authFetchSpy.mockResolvedValue(refusal(403, 'PERMISSION_DENIED', ELEVATED_MESSAGE));

    const { result, url } = await click({ type: 'flow', label: 'Run', target: 'nightly_sync' });

    expect(url).toBe('/api/v1/automation/nightly_sync/trigger');
    expect(result).toEqual({ success: false, error: ELEVATED_MESSAGE });
    expect((toast as any).error).toHaveBeenCalledWith(ELEVATED_MESSAGE);
  });
});
