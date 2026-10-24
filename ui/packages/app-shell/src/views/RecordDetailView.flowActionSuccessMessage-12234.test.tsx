/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12234 — a RECORD-PAGE flow action that pauses on a screen ends with
 * its own `successMessage`, not the flow-completed sentence.
 *
 * The record page builds its own action runtime (its own flow handler, its own
 * `FlowRunner` mount), so it is pinned separately from the list route
 * (`useConsoleActionRuntime.flowActionSuccessMessage-12234`). It is the host
 * the reported case actions (升级工单 / 关闭工单 / 认领工单) run through: a
 * declared action on the record's object, started through the action door,
 * that pauses for input.
 *
 * Harness, as in `RecordDetailView.refusedLaunch-9973.test.tsx`: the real
 * `RecordDetailView` renders against a stub data source; the `ActionProvider`
 * it mounts is captured on the way through (and still rendered), and its
 * context, toast sink and handler set are wired into a real `ActionRunner`.
 * The flow handler, the launch module and the mounted `FlowRunner` are real,
 * under the real en pack. The network answers by route, so no unrelated fetch
 * from the page's chrome can consume a flow answer.
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
import { I18nProvider, MetadataCtx } from '@object-ui/react';
import { ActionRunner } from '@object-ui/core';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'service_case';
const RECORD_ID = 'case-41';
const FLOW = 'case_escalate';
const ACTION_MESSAGE = 'Case escalated';
/** The declared action, as the object metadata carries it — the control declares no message. */
const DECLARED_WITHOUT_MESSAGE = { name: 'escalate_case', label: 'Escalate case', type: 'flow', target: FLOW };
const DECLARED = { ...DECLARED_WITHOUT_MESSAGE, successMessage: ACTION_MESSAGE };

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const PAUSED = {
  success: true,
  data: {
    success: true,
    status: 'paused',
    runId: 'run-1',
    flowLabel: 'Escalate',
    screen: { nodeId: 'reason', title: 'Escalation reason', fields: [] },
  },
};
const COMPLETED = { success: true, data: { success: true, status: 'completed', flowLabel: 'Escalate' } };

/**
 * The text of every success toast, in order. The runner's sink passes an
 * options bag beside the text and `FlowRunner` passes none, so the text alone
 * is compared — the full list, so a second toast cannot hide.
 */
const successTexts = () => (toast as any).success.mock.calls.map((call: unknown[]) => call[0]);

beforeEach(() => {
  cleanup();
  captured.length = 0;
  authFetchSpy.mockReset();
  authFetchSpy.mockImplementation(async (url: string) => {
    if (String(url).includes(`/api/v1/actions/${OBJECT_NAME}/escalate_case`)) return jsonResponse(PAUSED);
    if (String(url).includes(`/api/v1/automation/${FLOW}/runs/run-1/resume`)) return jsonResponse(COMPLETED);
    return jsonResponse({ data: [] });
  });
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

/** Mount the record page with `declared` on its object, launch it through a real runner, and submit the screen. */
async function launchAndSubmit(declared: Record<string, unknown>) {
  const objects = [
    {
      name: OBJECT_NAME,
      label: 'Case',
      fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
      actions: [declared],
    },
  ];
  const metadata = {
    objects,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as any;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
        <MetadataCtx.Provider value={metadata}>
          <RecordDetailView
            dataSource={{
              find: vi.fn(async () => ({ data: [] })),
              findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'CASE-00041' })),
              create: vi.fn(),
              update: vi.fn(),
              delete: vi.fn(),
            } as any}
            objects={objects}
            onEdit={() => {}}
            objectNameOverride={OBJECT_NAME}
            recordIdOverride={RECORD_ID}
            embedded
          />
        </MetadataCtx.Provider>
      </MemoryRouter>
    </I18nProvider>,
  );
  await waitFor(() => expect(recordPageProps()).toBeTruthy());
  const props = recordPageProps();
  (toast as any).success.mockClear();

  const runner = new ActionRunner(props.context);
  runner.setToastHandler(props.onToast);
  for (const [type, handler] of Object.entries(props.handlers)) runner.registerHandler(type, handler as any);

  let result: any;
  await act(async () => {
    result = await runner.execute({ ...declared } as any);
  });
  const doorCalls = authFetchSpy.mock.calls.filter(([url]) => String(url).includes('/api/v1/actions/'));
  expect(doorCalls.map(([url]) => String(url))).toEqual([`/api/v1/actions/${OBJECT_NAME}/escalate_case`]);

  // The pause: silent, as ruled — no success toast yet.
  expect(result).toEqual({ success: true, silent: true });
  expect((toast as any).success).not.toHaveBeenCalled();

  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: 'Escalation reason' })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('objectui#12234 — a paused record-page action completes with the action message', () => {
  it('toasts the action message once at completion', async () => {
    await launchAndSubmit(DECLARED);

    expect(successTexts()).toEqual([ACTION_MESSAGE]);
    expect((toast as any).error).not.toHaveBeenCalled();
  });

  it('control: an action that declares no successMessage keeps the flow-completed toast', async () => {
    await launchAndSubmit(DECLARED_WITHOUT_MESSAGE);

    expect(successTexts()).toEqual(['Flow "Escalate" completed']);
  });
});
