/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10918 regression pin: the record page's OWN action provider
 * supplies the spec-declared `${ctx.org.*}` interpolation scope.
 *
 * `RecordDetailView` mounts its own `<ActionProvider>`, and it shadows the
 * shell-level console runtime for every action on the record surface. Its
 * context carried `record`, `objectName` and `user` and no `org`. So a declared
 * target such as `/apps/cloud_control/sys_organization/record/${ctx.org.id}`
 * navigated with the id blanked out on a record page, even after the shared
 * runtime (`useConsoleActionRuntime`) was taught to supply `org`.
 *
 * Driven through the real view: the provider props `RecordDetailView` builds
 * go to the REAL `ActionProvider` (so the real `ActionRunner` target
 * interpolation). A probe mounted inside that same provider instance
 * dispatches a `type: 'url'` action, and the URL the runner hands to the
 * view's own `onNavigate` is what is asserted. Harness shape follows
 * `RecordDetailView.headerApiInterpolation.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// What `useAuth()` answers; each test sets it before rendering.
let activeOrganization: Record<string, unknown> | null = null;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization }),
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

// Orthogonal chrome: dialogs, flow runner, inspector, modal transport.
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

const RECORD_ID = 'rec-plan-1';

// Every `<ActionProvider>` the view mounts still renders the REAL provider.
// For the record page's own provider (the only one whose context carries this
// page's loaded record), a probe inside that same provider instance publishes
// its `execute`, and the view's `onNavigate` is observed on the way through.
let recordPageExecute: ((action: any) => Promise<any>) | null = null;
const navigated: string[] = [];
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  function ExecuteProbe() {
    const { execute } = actual.useAction();
    React.useEffect(() => {
      recordPageExecute = execute;
    }, [execute]);
    return null;
  }
  return {
    ...actual,
    ActionProvider: (props: any) => {
      const isRecordPage = props.context?.record?.id === RECORD_ID;
      if (!isRecordPage) return React.createElement(actual.ActionProvider as any, props);
      const onNavigate = (url: string, options?: any) => {
        navigated.push(url);
        return props.onNavigate?.(url, options);
      };
      return React.createElement(
        actual.ActionProvider as any,
        { ...props, onNavigate },
        props.children,
        React.createElement(ExecuteProbe),
      );
    },
    SchemaRenderer: () => null,
  };
});

import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'os_production_plan';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Production Plan',
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

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Plan A' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

// The shape cloud's welcome-page "invite members" CTA declares (objectui#10918).
const ORG_RECORD_TARGET = '/apps/cloud_control/sys_organization/record/${ctx.org.id}';

/** Mount the view, then run the action through the record page's own provider. */
async function runOrgTargetOnRecordPage() {
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
  await waitFor(() => expect(recordPageExecute).toBeTruthy());
  let result: any;
  await act(async () => {
    result = await recordPageExecute!({ type: 'url', name: 'open_org', target: ORG_RECORD_TARGET });
  });
  expect(result?.success).toBe(true);
}

beforeEach(() => {
  cleanup();
  activeOrganization = null;
  recordPageExecute = null;
  navigated.length = 0;
  // Unrelated chrome on this view reaches for the platform API; answer it
  // locally so no real socket is opened in jsdom.
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

describe('RecordDetailView — the spec-declared ctx.org scope on the record page provider (objectui#10918)', () => {
  it('interpolates ${ctx.org.id} in an action target to the active organization id', async () => {
    activeOrganization = { id: 'org_acme', slug: 'acme', name: 'Acme Inc.' };

    await runOrgTargetOnRecordPage();

    expect(navigated).toEqual(['/apps/cloud_control/sys_organization/record/org_acme']);
  });

  it('interpolates ${ctx.org.id} to an empty segment, never a literal null, when no organization is active', async () => {
    await runOrgTargetOnRecordPage();

    expect(navigated).toEqual(['/apps/cloud_control/sys_organization/record/']);
  });
});
