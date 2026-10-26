/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12274 — a RECORD-PAGE flow action whose run goes straight through
 * (no screen) closes with the same copy a paused run closes with: the
 * action's own `successMessage`, then the flow's own `successMessage`, then
 * the default.
 *
 * Beside objectui#12234's paused-path pin for this host
 * (`RecordDetailView.flowActionSuccessMessage-12234`). The record page builds
 * its own action runtime (its own flow handler), so it is pinned separately
 * from the list route (`useConsoleActionRuntime.flowDoneSuccessMessage-12274`).
 *
 * Harness, as there: the real `RecordDetailView` renders against a stub data
 * source; the `ActionProvider` it mounts is captured on the way through (and
 * still rendered), and its context, toast sink and handler set are wired into
 * a real `ActionRunner`. The flow handler and the launch module are real,
 * under the real en pack. The network answers by route, so no unrelated fetch
 * from the page's chrome can consume a flow answer. Every case asserts the
 * FULL `toast.success` call list.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
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
const FLOW_MESSAGE = 'Escalation recorded';
/** The runner's own default text, in the en pack. */
const RUNNER_DEFAULT = 'Action completed successfully';
/** The declared action, as the object metadata carries it. */
const DECLARED_WITHOUT_MESSAGE = { name: 'escalate_case', label: 'Escalate case', type: 'flow', target: FLOW };
const DECLARED = { ...DECLARED_WITHOUT_MESSAGE, successMessage: ACTION_MESSAGE };

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const COMPLETED_WITH_FLOW_MESSAGE = { success: true, status: 'completed', flowLabel: 'Escalate', successMessage: FLOW_MESSAGE };
const COMPLETED_PLAIN = { success: true, status: 'completed', flowLabel: 'Escalate' };

/** What the action door answers in the current case. */
let doorAnswer: Record<string, unknown> = COMPLETED_PLAIN;

/**
 * The text of every success toast, in order. The runner's sink passes an
 * options bag beside the text and the launch passes none, so the text alone is
 * compared — the full list, so a second toast cannot hide.
 */
const successTexts = () => (toast as any).success.mock.calls.map((call: unknown[]) => call[0]);

beforeEach(() => {
  cleanup();
  captured.length = 0;
  authFetchSpy.mockReset();
  authFetchSpy.mockImplementation(async (url: string) => {
    if (String(url).includes(`/api/v1/actions/${OBJECT_NAME}/escalate_case`)) {
      return jsonResponse({ success: true, data: doorAnswer });
    }
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

/** Mount the record page with `declared` on its object, launch it once through a real runner, and return the result. */
async function launch(declared: Record<string, unknown>, answer: Record<string, unknown>) {
  doorAnswer = answer;
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
  return result;
}

describe('objectui#12274 — a straight-through record-page launch closes by the one precedence', () => {
  it("(i) the action's message, over the flow's", async () => {
    const result = await launch(DECLARED, COMPLETED_WITH_FLOW_MESSAGE);

    expect(result).toEqual({ success: true, data: COMPLETED_WITH_FLOW_MESSAGE, reload: true });
    expect(successTexts()).toEqual([ACTION_MESSAGE]);
  });

  it("(ii) the flow's own successMessage when the action declares none — once, with no runner default beside it", async () => {
    const result = await launch(DECLARED_WITHOUT_MESSAGE, COMPLETED_WITH_FLOW_MESSAGE);

    // The toast first: it is what the user reads, so a red run names the sentence.
    expect(successTexts()).toEqual([FLOW_MESSAGE]);
    expect(result).toEqual({ success: true, data: COMPLETED_WITH_FLOW_MESSAGE, reload: true, silent: true });
    expect((toast as any).error).not.toHaveBeenCalled();
  });

  it("(iii) neither declares copy: the runner's default text", async () => {
    const result = await launch(DECLARED_WITHOUT_MESSAGE, COMPLETED_PLAIN);

    expect(result).toEqual({ success: true, data: COMPLETED_PLAIN, reload: true });
    expect(successTexts()).toEqual([RUNNER_DEFAULT]);
  });

  it('(iv) a run that ends refused shows its notice and no success toast', async () => {
    const result = await launch(DECLARED_WITHOUT_MESSAGE, {
      success: true, status: 'refused', refusalMessage: 'Refused: already escalated', successMessage: FLOW_MESSAGE,
    });

    expect(result).toEqual({ success: true, silent: true });
    expect(await screen.findByText('Refused: already escalated')).toBeTruthy();
    expect((toast as any).success).not.toHaveBeenCalled();
  });

  it('(iv) a run that fails shows the failure and no success toast', async () => {
    const result = await launch(DECLARED_WITHOUT_MESSAGE, {
      success: false, error: "Node 'escalate' failed", successMessage: FLOW_MESSAGE,
    });

    expect(result).toMatchObject({ success: false });
    expect((toast as any).success).not.toHaveBeenCalled();
    expect((toast as any).error).toHaveBeenCalledTimes(1);
  });
});
