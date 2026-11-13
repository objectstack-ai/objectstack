/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33009 — the #32666 case on the record page: 「提交审批」 starts a
 * flow whose `update_record` step writes the read-only `status`; the value is
 * dropped and the run succeeds. The person who clicked is warned, with the
 * field named by its label.
 *
 * The record page builds its own action runtime (its own flow handler, its own
 * `FlowRunner` mount), so it is pinned apart from the list route
 * (`useConsoleActionRuntime.flowDroppedFields-33009`). Harness as in
 * `RecordDetailView.flowActionSuccessMessage-12234.test.tsx`: the real
 * `RecordDetailView` against a stub data source whose `getObjectSchema` is the
 * label source; its `ActionProvider` is captured on the way through and wired
 * into a real `ActionRunner`. The flow handler, the launch module, the reader
 * and `writeWarningToast` are real, under the real en pack.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
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
import { I18nProvider, MetadataCtx } from '@object-ui/react';
import { ActionRunner } from '@object-ui/core';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'expense_report';
const RECORD_ID = 'exp-7';
const FLOW = 'expense_submit';
const DECLARED = { name: 'submit_for_approval', label: '提交审批', type: 'flow', target: FLOW };
const FIELDS = {
  name: { type: 'text', label: 'Name' },
  status: { type: 'select', label: 'Approval status', readonly: true },
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const DROPPED = {
  success: true,
  data: {
    success: true,
    status: 'completed',
    flowLabel: 'Submit',
    droppedFields: [{ object: OBJECT_NAME, fields: ['status'], reason: 'readonly' }],
  },
};
const CLEAN = { success: true, data: { success: true, status: 'completed', flowLabel: 'Submit' } };

const warnings = () => (toast as any).warning.mock.calls as unknown[][];

beforeEach(() => {
  cleanup();
  captured.length = 0;
  authFetchSpy.mockReset();
  for (const k of ['success', 'error', 'warning']) (toast as any)[k].mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function recordPageProps() {
  return [...captured].reverse().find((c) => c.handlers && c.context?.record?.id === RECORD_ID);
}

/** Mount the record page, click 「提交审批」 through a real runner, the action door answering `answer`. */
async function clickAnswering(answer: unknown) {
  authFetchSpy.mockImplementation(async (url: string) => {
    if (String(url).includes(`/api/v1/actions/${OBJECT_NAME}/submit_for_approval`)) return jsonResponse(answer);
    return jsonResponse({ data: [] });
  });
  const objects = [{ name: OBJECT_NAME, label: 'Expense report', fields: FIELDS, actions: [DECLARED] }];
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
              findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'EXP-0007', status: 'draft' })),
              getObjectSchema: vi.fn(async () => ({ name: OBJECT_NAME, fields: FIELDS })),
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
  (toast as any).warning.mockClear();

  const runner = new ActionRunner(props.context);
  runner.setToastHandler(props.onToast);
  for (const [type, handler] of Object.entries(props.handlers)) runner.registerHandler(type, handler as any);

  let result: any;
  await act(async () => {
    result = await runner.execute({ ...DECLARED } as any);
  });
  const doorCalls = authFetchSpy.mock.calls.filter(([url]) => String(url).includes('/api/v1/actions/'));
  expect(doorCalls.map(([url]) => String(url))).toEqual([`/api/v1/actions/${OBJECT_NAME}/submit_for_approval`]);
  return result;
}

describe('objectstack#33009 — the record page warns about a flow’s dropped read-only field', () => {
  it('the #32666 shape: 「提交审批」 whose flow dropped readonly `status` warns, naming "Approval status"', async () => {
    const result = await clickAnswering(DROPPED);

    expect(result).toMatchObject({ success: true });
    await waitFor(() => expect(warnings()).toHaveLength(1));
    expect(warnings()[0]).toEqual([
      'Saved — but some fields did not take effect',
      { description: 'Read-only, so it did not take effect: Approval status' },
    ]);
    expect((toast as any).error).not.toHaveBeenCalled();
  });

  it('control: a clean click warns about nothing', async () => {
    const result = await clickAnswering(CLEAN);

    expect(result).toMatchObject({ success: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(warnings()).toEqual([]);
  });
});
