// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36748 — `PackageFormDialog` handed a `newApp` step
 * (`newAppStep`, `studio-design/newAppDoor.ts`) ends with an app.
 *
 *  1. The dialog is titled 「新建应用」/"New app" and worded for an app: a
 *     no-code author reads 「应用」, never 「软件包」, on this door (the
 *     maintainer's ruling).
 *  2. One confirm creates the package AND its app: the package `POST`, the
 *     app's draft under the first-write pin, then that one app's publish
 *     (objectstack#36511: a human-created item is live at once). The author
 *     lands in the new package's Studio, whose header names the app, and
 *     「‹ Back to app」 opens it.
 *  3. A taken app name refuses the whole confirm and writes nothing.
 *
 * The door's first host, the Studio home, was removed (objectstack#36908);
 * the dialog's `newApp` branch and `newAppDoor.ts` stay for the one-step
 * 「新建应用」 of the create-package dialog (objectstack#37134). These cases
 * moved off the home onto the dialog itself, mounted as that home mounted it:
 * create mode, `newApp={newAppStep(client, locale)}`, and Studio on the new
 * package after save.
 *
 * The REAL `PackageFormDialog`, `newAppStep`, metadata client and
 * `StudioDesignSurface` over a fetch stub that keeps the server's state:
 * packages, published apps and app drafts.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
// The surface's reach loads `@objectstack/lint` lazily; pay that load during
// collection, not inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
// It also reaches `import('@object-ui/plugin-detail')` (the command palette's lazy
// detail surfaces): paid here, at collection, never inside a test's clock.
import '@object-ui/plugin-detail';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

let localeFixture: 'en-US' | 'zh-CN' = 'en-US';
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => localeFixture,
}));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});
vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('./AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('../studio-design/StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { toast } from 'sonner';
import { PackageFormDialog } from './PackageFormDialog';
import { useMetadataClient } from './useMetadata';
import { t, useMetadataLocale } from './i18n';
import { newAppStep } from '../studio-design/newAppDoor';
import { studioHomePath } from '../studio-design/studioAddress';
import { StudioDesignSurface } from '../studio-design/StudioDesignSurface';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

interface Write {
  method: string;
  path: string;
  search: URLSearchParams;
  body: Record<string, unknown> | null;
}

const srv = {
  packages: [] as Array<Record<string, unknown>>,
  apps: [] as Array<Record<string, unknown>>,
  appDrafts: [] as Array<Record<string, unknown>>,
  writes: [] as Write[],
};

beforeEach(() => {
  localeFixture = 'en-US';
  srv.packages = [];
  srv.apps = [];
  srv.appDrafts = [];
  srv.writes = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
        srv.writes.push({ method, path, search: url.searchParams, body });
        if (method === 'POST' && path === '/api/v1/packages') {
          const manifest = body?.manifest as Record<string, unknown>;
          srv.packages.push({ manifest, writable: true });
          return json({ success: true, data: { manifest } }, 201);
        }
        const draft = path.match(/^\/api\/v1\/meta\/app\/([^/]+)$/);
        if (method === 'PUT' && draft) {
          srv.appDrafts.push({ ...body, name: draft[1], type: 'app' });
          return json({ success: true, version: 'v1' });
        }
        const publish = path.match(/^\/api\/v1\/meta\/app\/([^/]+)\/publish$/);
        if (method === 'POST' && publish) {
          const row = srv.appDrafts.find((d) => d.name === publish[1]);
          srv.appDrafts = srv.appDrafts.filter((d) => d !== row);
          if (row) srv.apps.push(row);
          return json({ success: true, version: 'v2' });
        }
        return json({ success: true });
      }
      if (path === '/api/v1/packages') return json({ success: true, data: srv.packages });
      if (path === '/api/v1/meta/_drafts') {
        return json({ drafts: url.searchParams.get('type') === 'app' ? srv.appDrafts : [] });
      }
      if (path === '/api/v1/meta/app') return json(srv.apps);
      if (path.endsWith('/layers')) return json({ code: null, overlay: null, overlayScope: null, effective: null });
      if (/^\/api\/v1\/meta\/[^/]+\/[^/]+$/.test(path)) return json({}, 404);
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

function RunningApp() {
  const location = useLocation();
  return <p data-testid="running-app">{location.pathname}</p>;
}

/** The dialog as a host mounts the door: create mode, the app step, and Studio on the new package after save. */
function NewAppHost() {
  const navigate = useNavigate();
  const client = useMetadataClient();
  const locale = useMetadataLocale();
  const step = React.useMemo(() => newAppStep(client, locale), [client, locale]);
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" data-testid="open-new-app" onClick={() => setOpen(true)}>
        new app
      </button>
      <PackageFormDialog
        mode="create"
        open={open}
        onOpenChange={setOpen}
        newApp={step}
        onSaved={(r) => navigate(studioHomePath(r.id))}
      />
    </>
  );
}

function renderDoor() {
  return render(
    <MemoryRouter initialEntries={['/host']}>
      <Routes>
        <Route path="/host" element={<NewAppHost />} />
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        <Route path="/apps/*" element={<RunningApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openNewAppDialog(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTestId('open-new-app'));
  return screen.findByRole('dialog');
}

const nameInput = (dialog: HTMLElement) =>
  within(dialog).getByLabelText(t('engine.packages.create.name', localeFixture), { exact: false }) as HTMLInputElement;

const describeWrite = (w: Write) => `${w.method} ${w.path}`;

describe('PackageFormDialog with a new-app step: one dialog worded for an app (objectstack#36748)', () => {
  it('titled 「新建应用」, its submit 「创建应用」, and no 「软件包」 anywhere on its face', async () => {
    localeFixture = 'zh-CN';
    renderDoor();
    const dialog = await openNewAppDialog();
    expect(within(dialog).getByRole('heading', { name: '新建应用' })).toBeInTheDocument();
    fireEvent.change(nameInput(dialog), { target: { value: 'Visits' } });
    expect(within(dialog).getByTestId('package-form-submit')).toHaveTextContent('创建应用');
    // Advanced opened too: its rows say 「应用 ID」.
    fireEvent.click(within(dialog).getByTestId('package-form-advanced-toggle'));
    expect(within(dialog).getByText('应用 ID')).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/软件包/);
  });
});

describe('PackageFormDialog with a new-app step: one confirm creates the package and its app, and the app opens (objectstack#36748)', () => {
  it('package, app draft, app publish — then the header names the app and 「‹ Back to app」 opens it', async () => {
    renderDoor();
    const dialog = await openNewAppDialog();
    fireEvent.change(nameInput(dialog), { target: { value: 'Visits' } });
    await waitFor(() => expect(within(dialog).getByTestId('package-form-submit')).toBeEnabled());
    fireEvent.click(within(dialog).getByTestId('package-form-submit'));

    await waitFor(() => expect(srv.writes).toHaveLength(3), { timeout: 8000 });
    const [pkg, draft, publish] = srv.writes;
    const manifest = pkg.body?.manifest as Record<string, unknown>;
    const packageId = String(manifest.id);
    const namespace = String(manifest.namespace);
    expect(srv.writes.map(describeWrite)).toEqual([
      'POST /api/v1/packages',
      `PUT /api/v1/meta/app/${namespace}`,
      `POST /api/v1/meta/app/${namespace}/publish`,
    ]);
    // The app is the new package's, labelled with its name, written under the
    // first-write pin, and that one item is published at its package.
    expect(draft.search.get('package')).toBe(packageId);
    expect(draft.search.get('mode')).toBe('draft');
    expect(draft.body?.label).toBe('Visits');
    expect(publish.search.get('package')).toBe(packageId);
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Created app “Visits”/));
    expect(toast.error).not.toHaveBeenCalled();

    // The author lands in the new package's Studio; the header names the app.
    const header = await screen.findByTestId('studio-shell-header', undefined, { timeout: 8000 });
    await waitFor(
      () => expect(within(header).getByTestId('studio-back-app-name')).toHaveAttribute('data-names', 'app'),
      { timeout: 8000 },
    );
    expect(within(header).getByTestId('studio-back')).toHaveTextContent(/^Back to app·Visits·Studio$/);
    // The app is live: no Create app is offered, and the back link opens it.
    expect(within(header).queryByRole('button', { name: /Create app/ })).toBeNull();
    fireEvent.click(within(header).getByTestId('studio-back-to-app'));
    expect(await screen.findByTestId('running-app')).toHaveTextContent(`/apps/${packageId}`);
  });

  it('an app name already taken refuses the confirm and writes nothing', async () => {
    renderDoor();
    const dialog = await openNewAppDialog();
    fireEvent.change(nameInput(dialog), { target: { value: 'Visits' } });
    await waitFor(() => expect(within(dialog).getByTestId('package-form-submit')).toBeEnabled());
    const namespace = (within(dialog).getByTestId('package-form-derived-summary').textContent ?? '').match(
      /will start with (\w+?)_\./,
    )?.[1];
    expect(namespace, 'the derived namespace is read off the dialog').toBeTruthy();
    // Both names the door would try are held by another package's apps.
    srv.apps = [
      { name: namespace, label: 'Other visits' },
      { name: `${namespace}_app`, label: 'Other visits app' },
    ];
    fireEvent.click(within(dialog).getByTestId('package-form-submit'));
    expect(await within(dialog).findByText(/already uses the identifier/)).toHaveTextContent('Other visits');
    expect(srv.writes).toEqual([]);
  });
});
