/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9973 — a flow launched from a RECORD-PAGE action that ends
 * `refused` without ever pausing at a screen.
 *
 * The record page builds its own action runtime (its own flow handler and its
 * own dialogs), so it is pinned separately from the list route. Before the fix
 * it answered a refusal exactly like a completed run: terminal success, the
 * action's `successMessage` toast, a `notifyDataChanged` for the record, and no
 * refusal sentence on screen.
 *
 * Harness: the real `RecordDetailView` renders against a stub data source; the
 * `ActionProvider` it mounts is captured on the way through (and still
 * rendered), and its context, toast sink and handler set are wired into a real
 * `ActionRunner` exactly as `ActionProvider` wires them. The flow handler, the
 * shared `judgeFlowLaunch` and the mounted `FlowRefusalNotice` are all real.
 * The `completed` case is the lit control.
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

// Capture every <ActionProvider>'s props while KEEPING the real provider, so
// the record page's own runtime (the one whose context carries this record)
// can be driven directly.
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
import { MetadataCtx, subscribeDataChanges } from '@object-ui/react';
import { ActionRunner } from '@object-ui/core';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'lead';
const RECORD_ID = 'rec-1';
const SENTENCE = 'Refused: Acme Corp is a confirmed duplicate';
const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Lead',
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
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
const ACTION = {
  type: 'flow',
  name: 'check_dup',
  label: 'Check duplicate',
  target: 'check_dup',
  successMessage: 'Duplicate check passed',
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  cleanup();
  captured.length = 0;
  authFetchSpy.mockReset();
  authFetchSpy.mockImplementation(async () => jsonResponse({ data: [] }));
  (toast as any).success.mockClear();
  (toast as any).error.mockClear();
  // Unrelated chrome on this view reaches for the platform API; answer it
  // locally so the only asynchrony left is the record load.
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function recordPageProps() {
  return [...captured].reverse().find((c) => c.handlers && c.context?.record?.id === RECORD_ID);
}

/** Mount the record page, then launch the flow action through a real runner. */
async function launch(data: Record<string, unknown>) {
  render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
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
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={RECORD_ID}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(recordPageProps()).toBeTruthy());
  const props = recordPageProps();

  authFetchSpy.mockReset();
  authFetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data }) });
  const changes: unknown[] = [];
  const unsubscribe = subscribeDataChanges((change) => { changes.push(change); });

  const runner = new ActionRunner(props.context);
  runner.setToastHandler(props.onToast);
  for (const [type, handler] of Object.entries(props.handlers)) runner.registerHandler(type, handler as any);

  let result: any;
  await act(async () => {
    result = await runner.execute({ ...ACTION } as any);
  });
  unsubscribe();
  expect(String(authFetchSpy.mock.calls[0][0])).toContain('/api/v1/automation/check_dup/trigger');
  return { result, changes };
}

describe('objectui#9973 — record-page flow launch that ends refused', () => {
  it('shows the refusal sentence in a Close-only notice titled with the action', async () => {
    await launch({ success: true, status: 'refused', refusalMessage: SENTENCE });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Check duplicate')).toBeTruthy();
    const alert = within(dialog).getByRole('alert');
    expect(alert.textContent).toContain(SENTENCE);
    expect(alert.className).not.toMatch(/destructive/);
    const names = within(dialog).getAllByRole('button').map((b) => b.textContent?.trim());
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n === 'Close')).toBe(true);

    // Close dismisses it.
    fireEvent.click(within(dialog).getAllByRole('button').find((b) => !b.querySelector('.sr-only'))!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it("does NOT toast the action's successMessage, does not invalidate the record, and returns silent success", async () => {
    const { result, changes } = await launch({ success: true, status: 'refused', refusalMessage: SENTENCE });

    expect(result).toEqual({ success: true, silent: true });
    expect((toast as any).success).not.toHaveBeenCalled();
    expect((toast as any).error).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  it('control: a COMPLETED run still toasts successMessage, invalidates the record, and opens no notice', async () => {
    const { result, changes } = await launch({ success: true, status: 'completed' });

    expect(result).toEqual({ success: true, data: { success: true, status: 'completed' }, reload: true });
    expect((toast as any).success).toHaveBeenCalledTimes(1);
    expect((toast as any).success.mock.calls[0][0]).toBe('Duplicate check passed');
    expect(changes).toEqual([{ objectName: OBJECT_NAME, recordId: RECORD_ID }]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.textContent).not.toContain(SENTENCE);
  });
});

// objectui#11092 — the same harness, on a launch that PAUSES: the record
// page's own flow handler hands the trigger answer's `flowLabel` to the
// `FlowRunner` it mounts, and the runner names the flow by it.
describe('objectui#11092 — a paused record-page launch names the flow by its served label', () => {
  it('opens the runner headed by the served flowLabel', async () => {
    const { result } = await launch({
      success: true,
      status: 'paused',
      runId: 'run-1',
      flowLabel: 'Duplicate Screening',
      screen: { nodeId: 'confirm', title: 'Confirm', fields: [] },
    });

    expect(result).toEqual({ success: true, silent: true });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Confirm' })).toBeTruthy();
    expect(within(dialog).getByText('Duplicate Screening')).toBeTruthy();
    expect(within(dialog).queryByText('check_dup')).toBeNull();
  });
});
