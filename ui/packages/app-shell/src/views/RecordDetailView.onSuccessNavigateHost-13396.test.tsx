/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13396 — the record page's own navigator hosts an app-relative path
 * under the record page's app, as the console runtime's does (objectui#13379).
 *
 * `RecordDetailView` mounts its own `ActionProvider`, which shadows the
 * console runtime's for every action on the record page. Its `onNavigate`
 * handed the path to the router unchanged, so an action run from the record
 * page's action bar with `onSuccess: { navigate: '/crm_opportunity/${result.id}' }`
 * matched no route under the `/_console` basename and the user landed on Home.
 *
 * The handler now sorts the path with the same `hostInConsolePath` the console
 * runtime uses, under the `:appName` of the record page's route. Pinned here,
 * on the handler the view really hands its `ActionProvider`:
 *
 *   - app-relative → hosted under the route's app, even when the shell's
 *     published app names another one;
 *   - already `/apps/…` → unchanged;
 *   - external (`https://…`) → a new tab, never the router;
 *   - `mailto:` → never hosted;
 *   - a console route outside an app (`/home`, …) → unchanged;
 *   - mounted outside an app route → the console runtime's answer;
 *   - and, through the page's real runner, an `onSuccess.navigate`.
 *
 * objectui#13433 — `/forms/:name` is the one console route with an in-app
 * twin: a form hop from this page opens at `/apps/<route app>/forms/<name>`,
 * inside the app's shell, and keeps the app-less route when the page is not
 * on an app route. Pinned in the last describe, through the real runner too
 * (the showcase's Log Time, a `type: 'form'` record-header action).
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigateSpy,
}));

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

// The app the shell publishes. On a record page it is normally the route's own
// app; a different value here proves which of the two the handler reads.
let currentAppName: string | undefined;
vi.mock('../context/NavigationContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context/NavigationContext')>();
  return {
    ...actual,
    useNavigationContext: () => ({ ...actual.useNavigationContext(), currentAppName }),
  };
});

// Capture what the record page's own <ActionProvider> receives, keeping the
// real provider, and tap its real runner from inside it.
type Capture = {
  onNavigate: (url: string, options?: { external?: boolean; newTab?: boolean }) => void;
  context: any;
  execute?: (action: any) => Promise<any>;
};
const captured: Capture[] = [];
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  function RunnerTap({ entry }: { entry: Capture }) {
    entry.execute = actual.useAction().execute;
    return null;
  }
  return {
    ...actual,
    ActionProvider: (props: any) => {
      const entry: Capture = { onNavigate: props.onNavigate, context: props.context };
      captured.push(entry);
      return React.createElement(
        actual.ActionProvider as any,
        props,
        props.children,
        React.createElement(RunnerTap, { entry }),
      );
    },
    SchemaRenderer: () => null,
  };
});

import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';
import { CONSOLE_ROOT_SEGMENTS, FORM_ROUTE_SEGMENT } from '../utils/hostInConsolePath';

const OBJECT_NAME = 'crm_account';
const RECORD_ID = 'acc-1';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Account',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
  },
];

// Business apps whose route segment is their package id (ADR-0048). HR is
// active too, so a handler reading the shell's published app would land there.
const CRM_APP = { name: 'crm', _packageId: 'com.acme.crm' };
const HR_APP = { name: 'hr', _packageId: 'com.acme.hr' };

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Acme' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

const METADATA = {
  apps: [CRM_APP, HR_APP],
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

/** The record page, routed as the console routes it — or outside an app. */
function renderDetail({ inApp = true }: { inApp?: boolean } = {}) {
  const entry = inApp
    ? `/apps/com.acme.crm/${OBJECT_NAME}/record/${RECORD_ID}`
    : `/${OBJECT_NAME}/record/${RECORD_ID}`;
  const pattern = inApp ? '/apps/:appName/:objectName/record/:recordId' : '/:objectName/record/:recordId';
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <MetadataCtx.Provider value={METADATA}>
        <Routes>
          <Route
            path={pattern}
            element={<RecordDetailView dataSource={makeDataSource()} objects={OBJECTS} onEdit={() => {}} />}
          />
        </Routes>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

/** The record page's OWN provider capture, built against the LOADED record. */
function recordPageCapture() {
  return [...captured].reverse().find((c) => c.context?.record?.id === RECORD_ID);
}

async function mount(opts?: { inApp?: boolean }) {
  renderDetail(opts);
  await waitFor(() => expect(recordPageCapture()?.execute).toBeTruthy());
  // Anything the mount itself did is not the hop under test.
  navigateSpy.mockReset();
  authFetchSpy.mockClear();
  return recordPageCapture()!;
}

const openSpy = vi.fn();

beforeEach(() => {
  cleanup();
  captured.length = 0;
  navigateSpy.mockReset();
  openSpy.mockReset();
  authFetchSpy.mockClear();
  currentAppName = 'com.acme.crm';
  vi.stubGlobal('open', openSpy);
  // Unrelated chrome on this view reaches for the platform API; answer it locally.
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

describe('record page navigator — an app-relative path is hosted under the page’s app (objectui#13396)', () => {
  it('hosts a record path under the route’s app', async () => {
    const { onNavigate } = await mount();

    onNavigate('/crm_opportunity/record/opp_42', { external: false, newTab: false });

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.crm/crm_opportunity/record/opp_42');
  });

  it('keeps the query string and hash of a hosted `/object/id` shorthand', async () => {
    const { onNavigate } = await mount();

    onNavigate('/crm_opportunity/opp_42?tab=lines#notes', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.crm/crm_opportunity/opp_42?tab=lines#notes');
  });

  it('reads the app off the route, not the shell’s published app', async () => {
    currentAppName = 'com.acme.hr';
    const { onNavigate } = await mount();

    onNavigate('/crm_opportunity/record/opp_42', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.crm/crm_opportunity/record/opp_42');
  });

  it('mounted outside an app route, hosts under the app the console runtime would', async () => {
    currentAppName = undefined;
    const { onNavigate } = await mount({ inApp: false });

    onNavigate('/crm_opportunity/record/opp_42', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.crm/crm_opportunity/record/opp_42');
  });
});

describe('record page navigator — the shapes that already worked stay as they are (objectui#13396)', () => {
  it('passes an app-qualified `/apps/<app>/…` path to the router unchanged', async () => {
    const { onNavigate } = await mount();

    onNavigate('/apps/acme/crm_opportunity/record/opp_42', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/acme/crm_opportunity/record/opp_42');
  });

  it('opens an external URL in a new tab and never hands it to the router', async () => {
    const { onNavigate } = await mount();

    onNavigate('https://status.example.com/incident/7', { external: true, newTab: true });

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith('https://status.example.com/incident/7', '_blank', 'noopener,noreferrer');
  });

  it('never hosts a `mailto:` address', async () => {
    const { onNavigate } = await mount();

    onNavigate('mailto:ops@example.com', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('mailto:ops@example.com');
  });

  // `/forms/…` is left out here: from an app route it opens in the app
  // (objectui#13433, the describe below), and outside one it is unchanged.
  it.each([...CONSOLE_ROOT_SEGMENTS].filter((s) => s !== FORM_ROUTE_SEGMENT))('leaves the console route `/%s/…` exactly as written', async (segment) => {
    const { onNavigate } = await mount();
    const to = segment === '' ? '/' : `/${segment}/probe?x=1`;

    onNavigate(to, { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe(to);
  });
});

describe('through the record page’s real runner (objectui#13396)', () => {
  it('an `onSuccess.navigate` with no app segment opens the created record in the page’s app', async () => {
    const { execute } = await mount();
    authFetchSpy.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ id: 'opp_42' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await act(async () => {
      await execute!({
        type: 'api',
        name: 'create_opportunity',
        target: '/api/v1/crm/opportunities',
        method: 'POST',
        onSuccess: { navigate: '/crm_opportunity/${result.id}', openIn: 'self' },
      });
    });

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.crm/crm_opportunity/opp_42');
  });
});

describe('record page navigator — a form opens inside the page’s app (objectui#13433)', () => {
  it('hosts `/forms/:name` under the route’s app, query string and hash kept', async () => {
    const { onNavigate } = await mount();

    onNavigate('/forms/crm_account.edit?recordId=acc-1&recordObject=crm_account#top', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe(
      '/apps/com.acme.crm/forms/crm_account.edit?recordId=acc-1&recordObject=crm_account#top',
    );
  });

  it('reads the app off the route, not the shell’s published app', async () => {
    currentAppName = 'com.acme.hr';
    const { onNavigate } = await mount();

    onNavigate('/forms/crm_account.edit', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.crm/forms/crm_account.edit');
  });

  it('mounted outside an app route, keeps the app-less `/forms/:name` — no app is guessed', async () => {
    // The shell still publishes an app: the one the console runtime would host
    // an app-relative path under. A form is not hosted under that answer.
    currentAppName = 'com.acme.crm';
    const { onNavigate } = await mount({ inApp: false });

    onNavigate('/forms/crm_account.edit', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/forms/crm_account.edit');
  });

  it('only the `forms` segment itself: `/formsx/…` is an app-relative path like any other', async () => {
    const { onNavigate } = await mount();

    onNavigate('/formsx/acc-1', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.crm/formsx/acc-1');
  });

  it('a `type: \'form\'` action run on the page opens its form in the page’s app', async () => {
    const { execute } = await mount();

    await act(async () => {
      await execute!({ type: 'form', name: 'edit_account', target: 'crm_account.edit' });
    });

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(navigateSpy.mock.calls[0][0]).toBe(
      '/apps/com.acme.crm/forms/crm_account.edit?recordId=acc-1&recordObject=crm_account',
    );
  });
});
