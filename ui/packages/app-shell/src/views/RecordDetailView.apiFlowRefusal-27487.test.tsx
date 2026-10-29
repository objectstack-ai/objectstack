/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27487 — the record page's `type: 'api'` door (the header ⋯
 * menu's "Recalculate Estimate") shows a flow-backed endpoint's inner refusal,
 * not the node chain.
 *
 * Driven through the handler set the view REALLY hands to its ActionProvider,
 * captured the way `RecordDetailView.headerApiInterpolation.test.tsx` does.
 * The endpoint's `400 FLOW_FAILED` carries `error.details.innerRefusal`; the
 * handler used to answer the envelope's `message`.
 *
 * CONTROL: an envelope with no carriers still answers its message.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { builtInLocales } from '@object-ui/i18n/locales';

const authFetchSpy = vi.fn(async () =>
  new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }),
);
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

vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

vi.mock('../hooks/useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(async () => ({ success: true })),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));

vi.mock('../utils/consoleServerAction', () => ({
  createConsoleServerActionHandler: () => vi.fn(async () => ({ success: true })),
}));

const captured: Array<{ handlers: Record<string, (action: any) => Promise<any>>; context: any }> = [];
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: (props: any) => {
      captured.push({ handlers: props.handlers, context: props.context });
      return React.createElement(actual.ActionProvider as any, props);
    },
    SchemaRenderer: () => null,
  };
});

import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'showcase_task';
const RECORD_ID = 'task-1';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Task',
    fields: {
      id: { type: 'text', label: 'Id' },
      title: { type: 'text', label: 'Title' },
    },
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

const REFUSAL = 'You do not have permission to perform this action. Contact your administrator if you need access.';
const NESTED = "Node 'recalc_each' failed: map 'recalc_each': item 0 (subflow 'showcase_recalc_task_estimate') failed: "
  + `Node 'write_estimate' failed: update_record(showcase_task) failed: ${REFUSAL}`;

const RECALC = {
  name: 'showcase_recalc_estimate',
  label: 'Recalculate Estimate',
  type: 'api',
  target: '/api/v1/apps/showcase/recalc',
  recordIdParam: 'recordId',
};

function flowFailed(details: Record<string, unknown>) {
  return { success: false, error: { code: 'FLOW_FAILED', message: NESTED, httpStatus: 400, details } };
}

function recordPageCapture() {
  return [...captured]
    .reverse()
    .find((c) => c.handlers && c.context?.record?.id === RECORD_ID);
}

async function runRecalc(body: unknown) {
  render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={METADATA}>
        <RecordDetailView
          dataSource={{
            find: vi.fn(async () => ({ data: [] })),
            findOne: vi.fn(async () => ({ id: RECORD_ID, title: 'Audit current IA' })),
            create: vi.fn(async () => ({})),
            update: vi.fn(async () => ({})),
            delete: vi.fn(async () => ({})),
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
  await waitFor(() => expect(recordPageCapture()).toBeTruthy());
  const handlers = recordPageCapture()!.handlers;
  authFetchSpy.mockClear();
  authFetchSpy.mockImplementationOnce(async () =>
    new Response(JSON.stringify(body), { status: 400, headers: { 'content-type': 'application/json' } }),
  );
  let out: any;
  await act(async () => {
    out = await handlers.api({ ...RECALC });
  });
  expect(authFetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
  expect(url.endsWith(RECALC.target)).toBe(true);
  expect(JSON.parse(String(init.body))).toMatchObject({ recordId: RECORD_ID });
  return out;
}

beforeEach(() => {
  cleanup();
  captured.length = 0;
  authFetchSpy.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RecordDetailView api handler — a flow-backed endpoint\'s refused run (objectstack#27487)', () => {
  it("a refused nested map → subflow write shows the record form's permission line, not the node chain", async () => {
    const out = await runRecalc(flowFailed({ innerRefusal: { code: 'PERMISSION_DENIED', message: REFUSAL } }));

    expect(out).toEqual({ success: false, error: builtInLocales.en.form.noPermissionToSave });
  });

  it('CONTROL: an envelope with no carriers still answers its message', async () => {
    const out = await runRecalc(flowFailed({}));

    expect(out).toEqual({ success: false, error: NESTED });
  });
});
