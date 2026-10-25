/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12037 — which door a RECORD-PAGE flow click starts its flow
 * through, including a related list's row and toolbar actions on a CHILD.
 *
 * Triage ruling B: a click whose object and `name` resolve to a DECLARED
 * `type: 'flow'` action with the same target goes through the action door,
 * `POST /api/v1/actions/:object/:action`; every other flow click stays on the
 * trigger route. A related-list row action addresses the CHILD: `:object` is
 * the child object, `:action` the child action's declared name, `recordId` the
 * child row. A related list's toolbar action has no row, and must not borrow
 * the parent page's id for the child object.
 *
 * Harness (shared with `RecordDetailView.refusedLaunch-9973.test.tsx`): the
 * real `RecordDetailView` renders against a stub data source; the
 * `ActionProvider` it mounts is captured on the way through (and still
 * rendered), and its context, toast sink and handlers are wired into a real
 * `ActionRunner` exactly as `ActionProvider` wires them. The dispatches below
 * are the shapes `RelatedRecordActionsBridge.runRowAction` builds.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const authFetchSpy = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => authFetchSpy,
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

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

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

const captured: any[] = [];
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: (props: any) => {
      captured.push(props);
      return React.createElement(actual.ActionProvider as any, props);
    },
    SchemaRenderer: () => null,
  };
});

import { toast } from 'sonner';
import { MetadataCtx } from '@object-ui/react';
import { ActionRunner } from '@object-ui/core';
import { RecordDetailView } from './RecordDetailView';

const PARENT = 'lead';
const RECORD_ID = 'lead-1';
const CHILD = 'lead_task';
const CHILD_ROW = 'task-9';
/** Declared on the CHILD object, as its related list on this page offers it. */
const CHILD_ACTION = {
  name: 'escalate_task',
  label: 'Escalate',
  type: 'flow',
  target: 'escalate_task_flow',
  locations: ['list_item'],
  requiredPermissions: ['lead_task.escalate'],
};
/** Declared on this page's object, offered in the header. */
const HEADER_ACTION = {
  name: 'qualify_lead',
  label: 'Qualify',
  type: 'flow',
  target: 'qualify_lead_wizard',
  locations: ['record_header'],
};
const OBJECTS = [
  {
    name: PARENT,
    label: 'Lead',
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
    actions: [HEADER_ACTION],
  },
  {
    name: CHILD,
    label: 'Lead Task',
    fields: { id: { type: 'text', label: 'Id' }, lead: { type: 'lookup', reference: PARENT } },
    actions: [CHILD_ACTION],
  },
];
const METADATA = {
  objects: OBJECTS,
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
} as any;
const GATE_MESSAGE =
  "Action 'escalate_task' on 'lead_task' requires capability [lead_task.escalate] — caller is missing [lead_task.escalate]";
const ELEVATED_MESSAGE =
  'This caller may not start this flow. A flow that runs on its own trigger starts there, '
  + "or as a sub-flow from a parent flow's `subflow` node.";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function refusal(status: number, code: string, message: string) {
  return { ok: false, status, json: async () => ({ success: false, error: { code, message, httpStatus: status } }) };
}
function answered(data: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}

beforeEach(() => {
  cleanup();
  captured.length = 0;
  authFetchSpy.mockReset();
  authFetchSpy.mockImplementation(async () => jsonResponse({ data: [] }));
  (toast as any).success.mockClear();
  (toast as any).error.mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function recordPageProps() {
  return [...captured].reverse().find((c) => c.handlers && c.context?.record?.id === RECORD_ID);
}

/** Mount the record page and hand back a real runner wired to its runtime. */
async function mountRunner() {
  render(
    <MemoryRouter initialEntries={[`/app/demo/${PARENT}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={METADATA}>
        <RecordDetailView
          dataSource={{
            find: vi.fn(async () => ({ data: [] })),
            findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Acme Corp' })),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          } as any}
          objects={OBJECTS}
          onEdit={() => {}}
          objectNameOverride={PARENT}
          recordIdOverride={RECORD_ID}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(recordPageProps()).toBeTruthy());
  const props = recordPageProps();
  authFetchSpy.mockReset();
  const runner = new ActionRunner(props.context);
  runner.setToastHandler(props.onToast);
  for (const [type, handler] of Object.entries(props.handlers)) runner.registerHandler(type, handler as any);
  return runner;
}

async function run(runner: ActionRunner, action: Record<string, unknown>) {
  let result: any;
  await act(async () => {
    result = await runner.execute({ ...action } as any);
  });
  const [url, init] = authFetchSpy.mock.calls[0];
  return { result, url: String(url), body: JSON.parse(String(init.body)) };
}

/** `RelatedRecordActionsBridge.runRowAction(CHILD, row, action)`'s dispatch. */
const ROW_DISPATCH = {
  ...CHILD_ACTION,
  objectName: CHILD,
  recordId: CHILD_ROW,
  params: { _rowRecord: { id: CHILD_ROW, lead: RECORD_ID } },
};

describe('objectui#12037 — record-page flow clicks on a declared action use the action door', () => {
  it("a related-list row action on the child is refused by the server with the door's code, and the console shows it", async () => {
    const runner = await mountRunner();
    authFetchSpy.mockResolvedValue(refusal(403, 'PERMISSION_DENIED', GATE_MESSAGE));

    const { result, url, body } = await run(runner, ROW_DISPATCH);

    expect(url).toBe(`/api/v1/actions/${CHILD}/escalate_task`);
    expect(body).toEqual({ recordId: CHILD_ROW, params: {} });
    expect(result).toEqual({ success: false, error: GATE_MESSAGE });
    expect((toast as any).error).toHaveBeenCalledWith(GATE_MESSAGE);
  });

  it("a related list's toolbar action (no row) does not borrow the parent page's id for the child", async () => {
    const runner = await mountRunner();
    authFetchSpy.mockResolvedValue(answered({ success: true, status: 'completed' }));

    const { url, body } = await run(runner, { ...CHILD_ACTION, locations: ['list_toolbar'], objectName: CHILD });

    expect(url).toBe(`/api/v1/actions/${CHILD}/escalate_task`);
    expect(body).toEqual({ params: {} });
  });

  it('control: an allowed header click runs, and its paused screen resumes under the declaration target', async () => {
    const runner = await mountRunner();
    authFetchSpy.mockResolvedValueOnce(answered({
      success: true,
      status: 'paused',
      runId: 'run-1',
      flowLabel: 'Qualify',
      screen: { nodeId: 'confirm', title: 'Confirm', fields: [] },
    }));

    const { result, url, body } = await run(runner, HEADER_ACTION);

    expect(url).toBe(`/api/v1/actions/${PARENT}/qualify_lead`);
    expect(body).toEqual({ recordId: RECORD_ID, params: {} });
    expect(result).toEqual({ success: true, silent: true });
    const dialog = await screen.findByRole('dialog');
    authFetchSpy.mockResolvedValueOnce(answered({ success: true, status: 'completed' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(2));
    expect(String(authFetchSpy.mock.calls[1][0])).toBe('/api/v1/automation/qualify_lead_wizard/runs/run-1/resume');
  });
});

describe('objectui#12037 — a record-page flow start that names no declared action stays on the trigger route', () => {
  it('an undeclared header flow start, and an elevated self-triggered target is still refused there', async () => {
    const runner = await mountRunner();
    authFetchSpy.mockResolvedValue(refusal(403, 'PERMISSION_DENIED', ELEVATED_MESSAGE));

    const { result, url, body } = await run(runner, { type: 'flow', label: 'Sync', target: 'nightly_sync' });

    expect(url).toBe('/api/v1/automation/nightly_sync/trigger');
    expect(body).toEqual({ recordId: RECORD_ID, objectName: PARENT, params: {} });
    expect(result).toEqual({ success: false, error: ELEVATED_MESSAGE });
    expect((toast as any).error).toHaveBeenCalledWith(ELEVATED_MESSAGE);
  });

  it("an undeclared child toolbar flow keeps the trigger route and sends no parent id", async () => {
    const runner = await mountRunner();
    authFetchSpy.mockResolvedValue(answered({ success: true, status: 'completed' }));

    const { url, body } = await run(runner, { type: 'flow', label: 'Bulk', target: 'bulk_tasks', objectName: CHILD });

    expect(url).toBe('/api/v1/automation/bulk_tasks/trigger');
    expect(body).toEqual({ objectName: CHILD, params: {} });
  });
});
