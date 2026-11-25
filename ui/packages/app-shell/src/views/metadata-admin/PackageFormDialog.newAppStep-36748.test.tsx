// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36748 — `PackageFormDialog` handed a `newApp` step
 * (`newAppStep`, `studio-design/newAppDoor.ts`) ends with an app.
 *
 *  1. (objectstack#37134) The step is offered as 「同时创建应用」 / "Also
 *     create an app", ticked by default, on the create-package dialog's own
 *     face: the app-worded dialog went with the Studio home's 「新建应用」
 *     door (objectstack#36908), and the one create-package dialog now
 *     carries the choice.
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
 * objectstack#37134 — the create-package dialog (`CreatePackageDialog`, the
 * one every create-package door mounts) hands the dialog that step, so its
 * cases below mount the REAL wrapper: ticked creates the package and its app,
 * unticked the package alone, and a taken app name surfaces as above. The
 * last describe pins that every door mounts that wrapper.
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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PackageFormDialog } from './PackageFormDialog';
import { CreatePackageDialog } from './PackagesPage';
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
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
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

describe('PackageFormDialog with a new-app step: offered as 「同时创建应用」, ticked (objectstack#37134)', () => {
  it('the create-package dialog, with 「同时创建应用」 ticked under the name', async () => {
    localeFixture = 'zh-CN';
    renderDoor();
    const dialog = await openNewAppDialog();
    expect(within(dialog).getByRole('heading', { name: '新建软件包' })).toBeInTheDocument();
    const box = within(dialog).getByRole('checkbox', { name: '同时创建应用' });
    expect(box).toHaveAttribute('data-state', 'checked');
    fireEvent.change(nameInput(dialog), { target: { value: 'Visits' } });
    expect(within(dialog).getByTestId('package-form-submit')).toHaveTextContent('创建软件包');
  });

  it('CONTROL: without a step the dialog offers no app', async () => {
    render(<PackageFormDialog mode="create" open onOpenChange={() => {}} />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByTestId('package-form-also-app')).toBeNull();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
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

// ---------------------------------------------------------------------------
// objectstack#37134 — the create-package dialog every door mounts
// (`CreatePackageDialog`) offers 「同时创建应用」, ticked by default.
// ---------------------------------------------------------------------------

/** `CreatePackageDialog` as Setup → Packages mounts it: Studio on the new package after create. */
function CreatePackageHost() {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" data-testid="open-new-app" onClick={() => setOpen(true)}>
        new package
      </button>
      <CreatePackageDialog open={open} onOpenChange={setOpen} onCreated={(id) => navigate(studioHomePath(id))} />
    </>
  );
}

function renderCreatePackage() {
  return render(
    <MemoryRouter initialEntries={['/host']}>
      <Routes>
        <Route path="/host" element={<CreatePackageHost />} />
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        <Route path="/apps/*" element={<RunningApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

const alsoAppBox = (dialog: HTMLElement) =>
  within(dialog).getByRole('checkbox', { name: t('engine.packages.create.alsoApp', localeFixture) });

async function nameAndWait(dialog: HTMLElement, name: string) {
  fireEvent.change(nameInput(dialog), { target: { value: name } });
  await waitFor(() => expect(within(dialog).getByTestId('package-form-submit')).toBeEnabled());
}

describe('CreatePackageDialog: 「同时创建应用」 is offered, ticked by default (objectstack#37134)', () => {
  it.each(['en-US', 'zh-CN'] as const)('%s: the box is there and ticked on every opening', async (locale) => {
    localeFixture = locale;
    renderCreatePackage();
    let dialog = await openNewAppDialog();
    const label = locale === 'zh-CN' ? '同时创建应用' : 'Also create an app';
    expect(within(dialog).getByRole('checkbox', { name: label })).toHaveAttribute('data-state', 'checked');
    // Unticked, closed and opened again: ticked again.
    fireEvent.click(within(dialog).getByRole('checkbox', { name: label }));
    expect(within(dialog).getByRole('checkbox', { name: label })).toHaveAttribute('data-state', 'unchecked');
    fireEvent.click(within(dialog).getByRole('button', { name: t('engine.cancel', locale) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    dialog = await openNewAppDialog();
    expect(within(dialog).getByRole('checkbox', { name: label })).toHaveAttribute('data-state', 'checked');
  });
});

describe('CreatePackageDialog: ticked creates the package and its app; unticked only the package (objectstack#37134)', () => {
  it('ticked: package, app draft, app publish — then the Studio header names the app', async () => {
    renderCreatePackage();
    const dialog = await openNewAppDialog();
    await nameAndWait(dialog, 'Visits');
    fireEvent.click(within(dialog).getByTestId('package-form-submit'));

    await waitFor(() => expect(srv.writes).toHaveLength(3), { timeout: 8000 });
    const manifest = srv.writes[0].body?.manifest as Record<string, unknown>;
    const packageId = String(manifest.id);
    const namespace = String(manifest.namespace);
    expect(srv.writes.map(describeWrite)).toEqual([
      'POST /api/v1/packages',
      `PUT /api/v1/meta/app/${namespace}`,
      `POST /api/v1/meta/app/${namespace}/publish`,
    ]);
    expect(srv.writes[1].search.get('package')).toBe(packageId);
    expect(srv.apps.map((a) => a.name)).toEqual([namespace]);
    expect(toast.success).toHaveBeenCalledWith('Created package “Visits” and its app.');
    expect(toast.error).not.toHaveBeenCalled();

    // Where the wrapper lands does not change (Studio on the new package),
    // and with an app the header names it.
    const header = await screen.findByTestId('studio-shell-header', undefined, { timeout: 8000 });
    await waitFor(
      () => expect(within(header).getByTestId('studio-back-app-name')).toHaveAttribute('data-names', 'app'),
      { timeout: 8000 },
    );
    expect(within(header).getByTestId('studio-back')).toHaveTextContent(/^Back to app·Visits·Studio$/);
  });

  it('unticked: only the package is created, as before', async () => {
    renderCreatePackage();
    const dialog = await openNewAppDialog();
    await nameAndWait(dialog, 'Shared parts');
    fireEvent.click(alsoAppBox(dialog));
    expect(alsoAppBox(dialog)).toHaveAttribute('data-state', 'unchecked');
    fireEvent.click(within(dialog).getByTestId('package-form-submit'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Created package “Shared parts”.'));
    expect(srv.writes.map(describeWrite)).toEqual(['POST /api/v1/packages']);
    expect(srv.apps).toEqual([]);
    expect(srv.appDrafts).toEqual([]);
    // The same landing: Studio on the new package, which has no app to name.
    const header = await screen.findByTestId('studio-shell-header', undefined, { timeout: 8000 });
    const packageId = String((srv.writes[0].body?.manifest as Record<string, unknown>).id);
    expect(await screen.findByTestId('studio-back-app-name', undefined, { timeout: 8000 })).toHaveAttribute(
      'data-names',
      'package',
    );
    expect(header).toBeInTheDocument();
    expect(packageId).toMatch(/shared-parts$/);
  });

  it('ticked, an app name already taken refuses the confirm and writes nothing; unticked, the package goes through', async () => {
    renderCreatePackage();
    const dialog = await openNewAppDialog();
    await nameAndWait(dialog, 'Visits');
    const namespace = (within(dialog).getByTestId('package-form-derived-summary').textContent ?? '').match(
      /will start with (\w+?)_\./,
    )?.[1];
    expect(namespace, 'the derived namespace is read off the dialog').toBeTruthy();
    srv.apps = [
      { name: namespace, label: 'Other visits' },
      { name: `${namespace}_app`, label: 'Other visits app' },
    ];
    fireEvent.click(within(dialog).getByTestId('package-form-submit'));
    expect(await within(dialog).findByTestId('package-form-error')).toHaveTextContent(
      `The app “Other visits” already uses the identifier “${namespace}”.`,
    );
    expect(srv.writes).toEqual([]);
    // The namespace it names sits behind Advanced, which opened.
    expect(within(dialog).getByTestId('package-form-advanced-toggle')).toHaveAttribute('data-state', 'open');

    // The author may keep the package and drop the app instead.
    fireEvent.click(alsoAppBox(dialog));
    expect(within(dialog).queryByTestId('package-form-error')).toBeNull();
    fireEvent.click(within(dialog).getByTestId('package-form-submit'));
    await waitFor(() => expect(srv.writes.map(describeWrite)).toEqual(['POST /api/v1/packages']));
  });
});

// ---------------------------------------------------------------------------
// objectstack#37134 — every create-package door mounts `CreatePackageDialog`,
// so every one of them offers the box. Read off the source: a create-mode
// `PackageFormDialog` mounted anywhere else, or a door that stops mounting
// the wrapper, reds here.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** Every JSX mount of `component` in app-shell's source, as `file: <opening tag>`. */
function mounts(component: string): string[] {
  const tag = new RegExp(`<${component}\\b[^>]*>`, 'g');
  return sourceFiles(SRC).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(tag)].map((m) => `${relative(SRC, file)}: ${m[0].replace(/\s+/g, ' ')}`),
  );
}

describe('every create-package door offers 「同时创建应用」 (objectstack#37134)', () => {
  it('Setup → Packages (its button and the `?new=package` door) and the resource list mount CreatePackageDialog', () => {
    const doors = mounts('CreatePackageDialog').map((m) => m.split(':')[0]);
    expect(doors.sort()).toEqual(['views/metadata-admin/PackagesPage.tsx', 'views/metadata-admin/ResourceListPage.tsx']);
  });

  it('no create-mode PackageFormDialog is mounted outside CreatePackageDialog, and that one passes the step', () => {
    const creates = mounts('PackageFormDialog').filter((m) => !/mode="(edit|view)"/.test(m));
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatch(/^views\/metadata-admin\/PackagesPage\.tsx: <PackageFormDialog mode="create"/);
    const wrapper = readFileSync(join(SRC, 'views/metadata-admin/PackagesPage.tsx'), 'utf8').match(
      /export function CreatePackageDialog\([\s\S]*?\n}\n/,
    )?.[0];
    expect(wrapper, 'CreatePackageDialog is read off PackagesPage.tsx').toBeTruthy();
    expect(wrapper).toMatch(/newApp=\{newApp\}/);
    expect(wrapper).toMatch(/newAppStep\(client, locale\)/);
  });
});
