/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27611 — the record page sends a click on a DECLARED same-origin
 * `type: 'api'` action through the action door, with the subject row's id: a
 * related-list row's own, else this page's record (step 3 of the ruling on
 * objectstack#27506, ADR-0066 D4 as amended).
 *
 * Driven through the handler set the view REALLY hands to its ActionProvider,
 * captured the way `RecordDetailView.apiFlowRefusal-27487.test.tsx` does. The
 * door is the mocked authenticated fetch: the request and the reading of each
 * answer are pinned here, the door's gates and its forward on the server
 * (`packages/runtime/src/domains/api-action-forward.test.ts`).
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { builtInLocales } from '@object-ui/i18n/locales';

const authFetchSpy = vi.fn(async (..._args: unknown[]) =>
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
const DOOR = '/api/v1/actions/';

const RECALC = {
  name: 'showcase_recalc_estimate',
  label: 'Recalculate Estimate',
  type: 'api',
  target: '/api/v1/apps/showcase/recalc',
  recordIdParam: 'recordId',
};
const PING = { name: 'ping_hook', label: 'Ping', type: 'api', target: 'https://hooks.example.test/ping' };
/** A one-shot reveal on a stock better-auth route, which answers bare. */
const ROTATE = {
  name: 'rotate_secret',
  label: 'Rotate Secret',
  type: 'api',
  target: '/api/v1/auth/oauth2/client/rotate-secret',
  resultDialog: { fields: [{ path: 'client_secret', label: 'New Client Secret', format: 'secret' }] },
};
const CLOSE_SUBTASK = {
  name: 'close_subtask',
  label: 'Close',
  type: 'api',
  target: '/api/v1/subtasks/{id}/close',
};

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Task',
    fields: {
      id: { type: 'text', label: 'Id' },
      title: { type: 'text', label: 'Title' },
    },
    actions: [RECALC, PING, ROTATE],
  },
  { name: 'showcase_subtask', label: 'Subtask', fields: { id: { type: 'text', label: 'Id' } }, actions: [CLOSE_SUBTASK] },
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

const DISABLED = "Action 'showcase_recalc_estimate' is disabled — switched off in the packaged-metadata "
  + 'activation ledger (sys_metadata_activation, ADR-0126 §8).';

function recordPageCapture() {
  return [...captured]
    .reverse()
    .find((c) => c.handlers && c.context?.record?.id === RECORD_ID);
}

/** Mount the page, answer the next request with `status` / `body`, click `action`. */
async function clickOnPage(action: any, status: number, body: unknown) {
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
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
  let out: any;
  await act(async () => {
    out = await handlers.api({ ...action });
  });
  expect(authFetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
  return { out, url: String(url), body: init.body === undefined ? undefined : JSON.parse(String(init.body)) };
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

describe('RecordDetailView api handler — a declared same-origin click goes through the action door (objectstack#27611)', () => {
  it('a header click sends this page\'s record id to the door, and hands back the target\'s payload', async () => {
    const { out, url, body } = await clickOnPage(RECALC, 200, { success: true, data: { recalculated: 1 } });

    expect(url.endsWith(`${DOOR}${OBJECT_NAME}/${RECALC.name}`)).toBe(true);
    expect(body).toEqual({ recordId: RECORD_ID, params: {} });
    expect(out).toEqual({ success: true, data: { recalculated: 1 }, reload: false });
  });

  it('a bare target answer comes back at the level the direct fetch handed back, so a resultDialog path still reads', async () => {
    // The door wraps a bare (stock better-auth) body as its `data`.
    const { out, url } = await clickOnPage(ROTATE, 200, { success: true, data: { client_secret: 's3cr3t' } });

    expect(url.endsWith(`${DOOR}${OBJECT_NAME}/${ROTATE.name}`)).toBe(true);
    expect(out).toEqual({ success: true, data: { client_secret: 's3cr3t' }, reload: false });
  });

  it('a target\'s HTTP 200 rejection, relayed in the door\'s data, is a failure', async () => {
    const { out } = await clickOnPage(RECALC, 200, {
      success: true,
      data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'Estimate is locked' } },
    });

    expect(out).toEqual({ success: false, error: 'Estimate is locked' });
  });

  it('a switched-off action answers the door\'s 409 ACTION_DISABLED as its sentence', async () => {
    const { out, url } = await clickOnPage(RECALC, 409, {
      success: false,
      error: { code: 'ACTION_DISABLED', message: DISABLED, httpStatus: 409 },
    });

    expect(url.endsWith(`${DOOR}${OBJECT_NAME}/${RECALC.name}`)).toBe(true);
    expect(out).toEqual({ success: false, error: DISABLED });
  });

  it('a related-list row action on a child object sends the child row\'s id', async () => {
    const { url, body } = await clickOnPage(
      { ...CLOSE_SUBTASK, objectName: 'showcase_subtask', recordId: 'sub-7', params: { _rowRecord: { id: 'sub-7' } } },
      200,
      { success: true, data: {} },
    );

    expect(url.endsWith(`${DOOR}showcase_subtask/close_subtask`)).toBe(true);
    expect(body).toEqual({ recordId: 'sub-7', params: {} });
  });

  it('an off-origin target is called directly', async () => {
    const { url } = await clickOnPage(PING, 200, { ok: true });

    expect(url).toBe(PING.target);
  });

  it('once objectstack#27738 lands, a flow-backed endpoint\'s refused run reads its inner refusal through the door', async () => {
    const refusal = 'You do not have permission to perform this action. Contact your administrator if you need access.';
    const { out, url } = await clickOnPage(RECALC, 400, {
      success: false,
      error: {
        code: 'FLOW_FAILED',
        message: `Node 'write_estimate' failed: update_record(showcase_task) failed: ${refusal}`,
        httpStatus: 400,
        details: { innerRefusal: { code: 'PERMISSION_DENIED', message: refusal } },
      },
    });

    expect(url.endsWith(`${DOOR}${OBJECT_NAME}/${RECALC.name}`)).toBe(true);
    expect(out).toEqual({ success: false, error: builtInLocales.en.form.noPermissionToSave });
  });
});
