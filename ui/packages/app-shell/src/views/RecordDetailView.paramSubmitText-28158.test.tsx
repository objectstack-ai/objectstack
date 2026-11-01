/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordDetailView's param-collection handler resolves the action's
 * `submitText` — the verb on the param dialog's submit button — exactly as
 * `useConsoleActionRuntime`'s does (objectstack#28158): the bundle's
 * `_actions.ACTION.submitText` (`globalActions.ACTION.submitText` for an
 * object-less action) first, then the authored inline locale map collapsed to
 * the active language, then the authored string.
 *
 * This view builds its own runtime instead of routing through that hook, so
 * the two handlers drift as a pair (objectui#5610) and the hook's pin
 * (`useConsoleActionRuntime.submitText-28158.test.tsx`) cannot see this site.
 * A pin per reader is the only shape that covers both. The harness is the one
 * `RecordDetailView.paramDialogTitle.test.tsx` mounts.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ),
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

/**
 * Capture the state the param dialog is handed — it IS the assertion subject.
 * The sibling dialogs are orthogonal chrome, stubbed like the other
 * RecordDetailView suites do.
 */
let paramDialogState: any = null;
vi.mock('./ActionParamDialog', () => ({
  ActionParamDialog: ({ state }: any) => {
    if (state?.open) paramDialogState = state;
    return null;
  },
}));
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

// Importing the client modal transport for real drags in <ModalForm> and the
// whole plugin-form graph — same posture as the modal-dispatch suite.
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

/**
 * Capture every <ActionProvider>'s props while keeping the real provider. The
 * record page's own provider is the one whose CONTEXT carries this record, so
 * the selector below picks it even if a nested surface mounts one of its own.
 * `useObjectLabel` stays real except `actionSubmitText`, and
 * `useObjectTranslation` stays real except its `language`, so an inline locale
 * map has a non-default language to collapse to.
 */
const captured: Array<{ onParamCollection: any; context: any }> = [];
/** The bundle, keyed `KEY_OBJECT|ACTION` (`global` for no key object). */
let bundle: Record<string, string> = {};
const asked: Array<{ objectName: string | undefined; actionName: string | undefined; fallback: unknown }> = [];
const LANGUAGE = 'zh-CN';
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: (props: any) => {
      captured.push({ onParamCollection: props.onParamCollection, context: props.context });
      return React.createElement(actual.ActionProvider as any, props);
    },
    SchemaRenderer: () => null,
    // The REAL resolvers, with `actionSubmitText` standing in for the bundle
    // so this file pins what the handler asks and passes on; the bundle node
    // lookup is `@object-ui/i18n`'s own pin.
    useObjectLabel: () => ({
      ...actual.useObjectLabel(),
      actionSubmitText: (objectName: string | undefined, actionName: string | undefined, fallback?: string) => {
        asked.push({ objectName, actionName, fallback });
        return bundle[`${objectName ?? 'global'}|${actionName}`] ?? (fallback || undefined);
      },
    }),
    useObjectTranslation: () => ({ ...actual.useObjectTranslation(), language: LANGUAGE }),
  };
});

import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'crm_call';
const RECORD_ID = 'rec-call-1';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Call',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
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

const PARAMS = [{ name: 'subject', label: 'Subject', type: 'text' }] as any[];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Intro call' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/** The record page's OWN `onParamCollection` — the provider given this record. */
function recordPageParamCollection() {
  return [...captured]
    .reverse()
    .find((c) => c.onParamCollection && c.context?.record?.id === RECORD_ID)?.onParamCollection;
}

/**
 * Mount the view, then drive its `onParamCollection` the way `DeclaredActionsBar`
 * does and read back the state the dialog received. The promise stays pending —
 * that is the real shape too: nothing is POSTed until the dialog's own Confirm.
 */
async function collectParams(dispatch: Record<string, unknown>, interpolate?: (text: string) => string) {
  render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={METADATA}>
        <RecordDetailView
          dataSource={makeDataSource()}
          objects={OBJECTS}
          onEdit={() => {}}
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={RECORD_ID}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(recordPageParamCollection()).toBeTruthy());
  const collect = recordPageParamCollection()!;
  paramDialogState = null;
  await act(async () => {
    void collect(PARAMS, dispatch as any, interpolate);
    await Promise.resolve();
  });
}

beforeEach(() => {
  cleanup();
  captured.length = 0;
  paramDialogState = null;
  bundle = {};
  asked.length = 0;
  // Unrelated chrome on this view (approvals, favourites, …) reaches for the
  // platform API; in jsdom that is a real socket. Answer it locally so the only
  // asynchrony left is the record load the capture waits on.
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

describe('RecordDetailView — the param dialog\'s submit verb (objectstack#28158)', () => {
  it('hands the dialog the authored string', async () => {
    await collectParams({ name: 'log_call', label: 'Log Call', objectName: OBJECT_NAME, submitText: 'Log Call' });
    expect(paramDialogState.submitText).toBe('Log Call');
    expect(asked).toEqual([{ objectName: OBJECT_NAME, actionName: 'log_call', fallback: 'Log Call' }]);
  });

  it('prefers the bundle entry over the authored string', async () => {
    bundle[`${OBJECT_NAME}|log_call`] = '记录通话';
    await collectParams({ name: 'log_call', label: 'Log Call', objectName: OBJECT_NAME, submitText: 'Log Call' });
    expect(paramDialogState.submitText).toBe('记录通话');
  });

  it('collapses an inline locale map to the active language BEFORE offering it as the fallback', async () => {
    await collectParams({
      name: 'log_call',
      label: 'Log Call',
      objectName: OBJECT_NAME,
      submitText: { en: 'Log Call', 'zh-CN': '记录' },
    });
    expect(paramDialogState.submitText).toBe('记录');
    expect(asked[0].fallback).toBe('记录');
  });

  it('keys the bundle read on the page object when the action declares none', async () => {
    await collectParams({ name: 'log_call', label: 'Log Call', submitText: 'Log Call' });
    expect(asked[0]).toMatchObject({ objectName: OBJECT_NAME, actionName: 'log_call' });
  });

  it('hands the dialog nothing when the action names no verb and the bundle has none — the dialog says Confirm', async () => {
    await collectParams({ name: 'log_call', label: 'Log Call', objectName: OBJECT_NAME });
    expect(paramDialogState.submitText).toBeUndefined();
    expect(asked[0].fallback).toBeUndefined();
  });
});
