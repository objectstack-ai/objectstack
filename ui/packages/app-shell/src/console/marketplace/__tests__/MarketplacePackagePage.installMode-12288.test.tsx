// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package page offers the install modes the package permits, and reads
 * what the install door answers (objectui#12288, ADR-0131 D6).
 *
 * ## What the page reads, and where
 *
 * A package permits install modes through its manifest's `installModes`
 * (`managed` and/or `unmanaged`; absent means the door's own default). The page
 * reads that key from the manifest install-local itself fetches and judges,
 * `GET /api/v1/marketplace/packages/:id/versions/latest/manifest`, and sends
 * `installMode` on `POST /api/v1/marketplace/install-local` only where the
 * manifest declares the key. The console has no mode rule of its own: what
 * is permitted is the manifest's list, and what happened is the door's answer.
 *
 * ## What the cases pin
 *
 * - A manifest with no `installModes`: no choice, and no `installMode` sent.
 * - More than one distinct mode: the choice is drawn, the install waits for a
 *   pick, and the picked mode is sent — for a flat package body and for a
 *   compiled artifact that nests its manifest under `manifest:`. While it waits,
 *   the disabled Install's reason is reached by Tab and is its accessible
 *   description.
 * - One distinct mode: no choice, and that mode is sent. A package that permits
 *   only `unmanaged` says what its install does before the click.
 * - An `unmanaged` answer: its success sentence names the base, and each
 *   `strippedLocks` entry is listed with the package's reason.
 * - Each install-mode refusal shows the envelope's own message.
 * - A runtime that answers a requested copy without `installMode` installed the
 *   package managed, and the page says so.
 * - No choice where install-local is not the page's install door, and none when
 *   the manifest cannot be read.
 *
 * `marketplaceApi` is NOT mocked: one stubbed `fetch` answers by path, so the
 * request bodies asserted are the ones the page puts on the wire. `t` echoes
 * the KEY and the interpolated name, base and version: the claim under test is
 * WHICH sentence the page picks; a refusal is the server's own text verbatim.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'pkg_crm' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const parts = ['name', 'base', 'version']
        .filter((k) => opts?.[k] !== undefined)
        .map((k) => `${k}=${String(opts?.[k])}`);
      return parts.length > 0 ? `«${key}|${parts.join('|')}»` : `«${key}»`;
    },
    language: 'en',
  }),
}));

// A hosted managed install waits for the environment to serve the app: served at once here.
vi.mock('../waitForServedApp', () => ({ waitForServedApp: async () => ({ served: true, apps: [] }) }));
vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ refresh: async () => {} }) }));
vi.mock('../../../components/SuggestedBindingsPanel', () => ({
  SuggestedBindingsPanel: () => <div data-testid="suggested-bindings" />,
}));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';
import { installPackage } from '../marketplaceApi';

const PKG = 'com.example.crm';
const MANIFEST_PATH = '/api/v1/marketplace/packages/pkg_crm/versions/latest/manifest';
const INSTALL_PATH = '/api/v1/marketplace/install-local';

const CATALOG_PACKAGE = {
  package: {
    id: 'pkg_crm',
    manifest_id: PKG,
    display_name: 'Example CRM',
    latest_version: { id: 'ver_4', version: '4.0.1' },
  },
  versions: [{ id: 'ver_4', version: '4.0.1' }],
};

/** A flat package body, the manifest fields at the top. */
const flatBody = (extra: Record<string, unknown> = {}) => ({
  id: PKG, namespace: 'crm', version: '4.0.1', type: 'app', name: 'CRM', ...extra,
  objects: [{ name: 'crm_lead', label: 'Lead' }],
});

/** A compiled artifact: the manifest NESTED under `manifest:`, the collections beside it. */
const compiledBody = (extra: Record<string, unknown> = {}) => ({
  manifest: { id: PKG, namespace: 'crm', version: '4.0.1', type: 'app', name: 'CRM', ...extra },
  id: PKG,
  version: '4.0.1',
  objects: [{ name: 'crm_lead', label: 'Lead' }],
});

const MANAGED_ANSWER = {
  manifestId: PKG, version: '4.0.1', versionId: 'ver_4', installedAt: '2026-10-13T00:00:00.000Z',
  hotLoaded: true, upgradedFrom: null,
};

const unmanagedAnswer = (strippedLocks: unknown[]) => ({
  manifestId: PKG, version: '4.0.1', versionId: 'ver_4', installMode: 'unmanaged',
  installedAt: '2026-10-13T00:00:00.000Z',
  installedFrom: { packageId: PKG, version: '4.0.1' },
  targetPackageId: `${PKG}-copy`, namespace: 'crm', copiedCount: 3,
  copied: [{ type: 'object', name: 'crm_lead' }, { type: 'view', name: 'crm_lead_open' }, { type: 'app', name: 'crm' }],
  strippedLocks,
  note: 'The package\'s metadata is now this environment\'s own.',
});

interface Wire { manifest: { status: number; body: unknown }; install: { status: number; body: unknown } }
let wire: Wire;
let answered: string[] = [];
let posts: Array<Record<string, unknown>> = [];

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/** A hosted environment's cloud base: the page installs through the same-origin cloud-connection route. */
const HOSTED_CLOUD = 'https://cloud.example.test';
const CLOUD_INSTALL_PATH = '/api/v1/cloud-connection/install';
let cloudPosts: Array<Record<string, unknown>> = [];

async function boot(installLocal = true, cloudUrl = '') {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      const reply = (() => {
        if (path === '/api/v1/runtime/config') {
          return answer(200, {
            cloudUrl,
            singleEnvironment: true,
            ...(cloudUrl ? { defaultEnvironmentId: 'env_1' } : {}),
            features: { installLocal, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
            branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
          });
        }
        if (path === INSTALL_PATH && method === 'GET') return answer(200, { success: true, data: { items: [], total: 0 } });
        if (path === INSTALL_PATH && method === 'POST') {
          posts.push(JSON.parse(init?.body ?? '{}'));
          return answer(wire.install.status, wire.install.body);
        }
        if (path === MANIFEST_PATH && method === 'GET') return answer(wire.manifest.status, wire.manifest.body);
        if (path === CLOUD_INSTALL_PATH && method === 'POST') {
          cloudPosts.push(JSON.parse(init?.body ?? '{}'));
          return answer(wire.install.status, wire.install.body);
        }
        if (path === '/api/v1/cloud-connection/installation' && method === 'GET') {
          return answer(200, { success: true, data: { installed: false } });
        }
        if (path === '/api/v1/marketplace/packages/pkg_crm' && method === 'GET') {
          return answer(200, { success: true, data: CATALOG_PACKAGE });
        }
        return answer(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
      })();
      answered.push(`${method} ${path}`);
      return reply;
    }),
  );
  await initRuntimeConfig();
  answered = [];
}

/** Serve the manifest snapshot the door fetches, in its `{ data: { manifest, version, version_id } }` envelope. */
const serveManifest = (body: unknown) => {
  wire.manifest = { status: 200, body: { success: true, data: { manifest: body, version: '4.0.1', version_id: 'ver_4' } } };
};

/** Render, and settle once the manifest read has been answered — so an absent choice is a reading, not a race. */
async function renderPage() {
  render(<MarketplacePackagePage />);
  await screen.findByRole('button', { name: '«marketplace.action.install»' });
  await waitFor(() => expect(answered).toContain(`GET ${MANIFEST_PATH}`));
  await act(async () => {});
}

const installButton = () => screen.getByRole('button', { name: '«marketplace.action.install»' });
const radio = (mode: 'managed' | 'unmanaged') =>
  screen.getByRole('radio', { name: new RegExp(`«marketplace\\.install\\.mode\\.${mode}»`) });

async function install() {
  fireEvent.click(installButton());
  // objectstack#30325 — Install opens the confirm; its Install installs.
  fireEvent.click(await screen.findByTestId('install-preview-confirm'));
  await waitFor(() => expect(posts).toHaveLength(1));
}

beforeEach(() => {
  wire = {
    manifest: { status: 200, body: { success: true, data: { manifest: flatBody(), version: '4.0.1', version_id: 'ver_4' } } },
    install: { status: 200, body: { success: true, data: MANAGED_ANSWER } },
  };
  answered = [];
  posts = [];
  cloudPosts = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('the choice is the manifest\'s `installModes` (objectui#12288)', () => {
  it('a manifest with no `installModes` draws no choice, and the install sends no `installMode`', async () => {
    serveManifest(flatBody());
    await boot();
    await renderPage();

    expect(screen.queryByTestId('install-mode-choice')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByTestId('install-mode-sole')).not.toBeInTheDocument();
    expect(installButton()).toBeEnabled();
    expect(document.querySelector('[data-disabled-reason]')).toBeNull();

    await install();
    expect(posts[0]).toEqual({ packageId: 'pkg_crm' });
    expect(posts[0]).not.toHaveProperty('installMode');
  });

  it('while the choice is unpicked, the disabled Install carries its reason: reached by Tab, and the button\'s accessible description', async () => {
    serveManifest(flatBody({ installModes: ['managed', 'unmanaged'] }));
    await boot();
    await renderPage();

    const reason = '«marketplace.install.mode.required»';
    expect(installButton()).toBeDisabled();
    expect(installButton()).toHaveAccessibleDescription(reason);

    // A disabled button takes no focus; its wrapper is the Tab stop that carries the reason.
    const user = userEvent.setup();
    let reached: Element | null = null;
    for (let i = 0; i < 12 && !reached; i++) {
      await user.tab();
      if (document.activeElement?.hasAttribute('data-disabled-reason')) reached = document.activeElement;
    }
    expect(reached).not.toBeNull();
    expect(reached).toContainElement(installButton());
    expect(reached).toHaveAccessibleDescription(reason);

    // CONTROL: once a mode is picked, Install is enabled and carries no reason.
    fireEvent.click(radio('managed'));
    await waitFor(() => expect(installButton()).toBeEnabled());
    expect(installButton()).not.toHaveAccessibleDescription();
    expect(document.querySelector('[data-disabled-reason]')).toBeNull();
  });

  it.each([
    ['a flat package body', flatBody({ installModes: ['managed', 'unmanaged'] })],
    ['a compiled artifact (nested `manifest:`)', compiledBody({ installModes: ['unmanaged', 'managed'] })],
  ])('%s permitting both modes draws the choice, and the install waits for a pick', async (_label, body) => {
    serveManifest(body);
    await boot();
    await renderPage();

    expect(screen.getByTestId('install-mode-choice')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    // The spec ranks no permitted mode above another: neither is picked for the operator.
    expect(radio('managed')).not.toBeChecked();
    expect(radio('unmanaged')).not.toBeChecked();
    expect(installButton()).toBeDisabled();
  });

  it.each(['managed', 'unmanaged'] as const)('the picked mode `%s` is the one sent', async (mode) => {
    serveManifest(flatBody({ installModes: ['managed', 'unmanaged'] }));
    wire.install = { status: 200, body: { success: true, data: mode === 'unmanaged' ? unmanagedAnswer([]) : MANAGED_ANSWER } };
    await boot();
    await renderPage();

    fireEvent.click(radio(mode));
    await waitFor(() => expect(radio(mode)).toBeChecked());
    expect(installButton()).toBeEnabled();

    await install();
    expect(posts[0]).toEqual({ packageId: 'pkg_crm', installMode: mode });
  });

  it.each([
    ['managed only', ['managed']],
    ['managed named twice', ['managed', 'managed']],
  ])('a package that permits %s draws no choice', async (_label, modes) => {
    serveManifest(flatBody({ installModes: modes }));
    await boot();
    await renderPage();

    expect(screen.queryByTestId('install-mode-choice')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByTestId('install-mode-sole')).not.toBeInTheDocument();

    await install();
    expect(posts[0]).toEqual({ packageId: 'pkg_crm', installMode: 'managed' });
  });

  it('a package that permits only `unmanaged` draws no choice, says the install is a copy, and sends `unmanaged`', async () => {
    serveManifest(flatBody({ installModes: ['unmanaged'] }));
    wire.install = { status: 200, body: { success: true, data: unmanagedAnswer([]) } };
    await boot();
    await renderPage();

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByTestId('install-mode-sole')).toHaveTextContent('«marketplace.install.mode.unmanagedHint»');

    await install();
    expect(posts[0]).toEqual({ packageId: 'pkg_crm', installMode: 'unmanaged' });
  });

  it('no manifest read and no choice where install-local is not the page\'s install door', async () => {
    serveManifest(flatBody({ installModes: ['managed', 'unmanaged'] }));
    await boot(false);
    render(<MarketplacePackagePage />);
    await screen.findByRole('button', { name: '«marketplace.action.installToCloud»' });
    await act(async () => {});

    expect(answered).toContain('GET /api/v1/marketplace/packages/pkg_crm');
    expect(answered).not.toContain(`GET ${MANIFEST_PATH}`);
    expect(screen.queryByTestId('install-mode-choice')).not.toBeInTheDocument();
  });

  it('a manifest the page cannot read draws no choice, and the install sends no `installMode`', async () => {
    wire.manifest = { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'no manifest' } } };
    await boot();
    await renderPage();

    expect(screen.queryByTestId('install-mode-choice')).not.toBeInTheDocument();
    await install();
    expect(posts[0]).toEqual({ packageId: 'pkg_crm' });
  });
});

describe('the page reads the install door\'s answer (objectui#12288)', () => {
  async function installUnmanaged(strippedLocks: unknown[]) {
    serveManifest(flatBody({ installModes: ['unmanaged'] }));
    wire.install = { status: 200, body: { success: true, data: unmanagedAnswer(strippedLocks) } };
    await boot();
    await renderPage();
    await install();
  }

  it('an unmanaged answer names the base it copied into, and lists each stripped lock with the package\'s reason', async () => {
    await installUnmanaged([
      { type: 'view', name: 'crm_lead_open', lock: 'full', reason: 'Board-pack figures; edit the source package.' },
      { type: 'app', name: 'crm', lock: 'no-delete' },
    ]);

    expect(await screen.findByText(`«marketplace.install.unmanagedSuccess|name=Example CRM|base=${PKG}-copy|version=4.0.1»`)).toBeInTheDocument();
    const locks = screen.getByTestId('unmanaged-stripped-locks');
    const items = locks.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('view.crm_lead_open: full — Board-pack figures; edit the source package.');
    expect(items[1]).toHaveTextContent('app.crm: no-delete');
    expect(items[1].textContent).not.toContain('—');
    // Nothing is registered under the package's id: no install-time suggestions,
    // and none of the managed answer's sentences.
    expect(screen.queryByTestId('suggested-bindings')).not.toBeInTheDocument();
    expect(screen.queryByText(/marketplace\.install\.localLoadsAtRestart/)).not.toBeInTheDocument();
    expect(screen.queryByText(/marketplace\.install\.localSuccess/)).not.toBeInTheDocument();
  });

  it('CONTROL: a copy that dropped no lock lists none', async () => {
    await installUnmanaged([]);

    expect(await screen.findByText(/«marketplace\.install\.unmanagedSuccess\|/)).toBeInTheDocument();
    expect(screen.queryByTestId('unmanaged-stripped-locks')).not.toBeInTheDocument();
  });

  it('CONTROL: a managed answer keeps its own sentence and its install-time suggestions', async () => {
    serveManifest(flatBody({ installModes: ['managed', 'unmanaged'] }));
    await boot();
    await renderPage();
    fireEvent.click(radio('managed'));
    await waitFor(() => expect(installButton()).toBeEnabled());
    await install();

    expect(await screen.findByText('«marketplace.install.localSuccess|name=Example CRM|version=4.0.1»')).toBeInTheDocument();
    expect(screen.getByTestId('suggested-bindings')).toBeInTheDocument();
    expect(screen.queryByTestId('unmanaged-stripped-locks')).not.toBeInTheDocument();
  });

  it.each([
    [422, 'INSTALL_MODE_NOT_PERMITTED', 'MODE-REFUSAL sentinel: this package permits another mode.'],
    [409, 'UNMANAGED_INSTALL_WALLED_POSTURE', 'POSTURE-REFUSAL sentinel: this deployment walls organizations.'],
    [409, 'RESOURCE_CONFLICT', 'CONFLICT-REFUSAL sentinel: an unmanaged copy holds the namespace.'],
  ])('a %i %s refusal shows the envelope\'s own message', async (status, code, message) => {
    serveManifest(flatBody({ installModes: ['managed', 'unmanaged'] }));
    wire.install = { status, body: { success: false, error: { code, message, details: {} } } };
    await boot();
    await renderPage();
    fireEvent.click(radio('unmanaged'));
    await waitFor(() => expect(installButton()).toBeEnabled());
    await install();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText(code)).not.toBeInTheDocument();
  });

  it('a requested copy answered without `installMode` says the runtime installed the package managed', async () => {
    serveManifest(flatBody({ installModes: ['managed', 'unmanaged'] }));
    // A runtime that predates the install mode reads no `installMode` and answers the managed shape.
    wire.install = { status: 200, body: { success: true, data: MANAGED_ANSWER } };
    await boot();
    await renderPage();
    fireEvent.click(radio('unmanaged'));
    await waitFor(() => expect(installButton()).toBeEnabled());
    await install();

    expect(posts[0]).toEqual({ packageId: 'pkg_crm', installMode: 'unmanaged' });
    expect(await screen.findByText('«marketplace.install.unmanagedIgnored|name=Example CRM»')).toBeInTheDocument();
    expect(screen.queryByText(/marketplace\.install\.localSuccess/)).not.toBeInTheDocument();
  });
});

describe('the hosted install path sends the mode the package permits (objectstack#30963)', () => {
  // A hosted environment: a cloud base, no install-local door. The install goes
  // to the same-origin cloud-connection route, which the control plane judges.
  const installToCloud = () => screen.getByRole('button', { name: '«marketplace.action.installToCloud»' });

  async function renderHosted() {
    await boot(false, HOSTED_CLOUD);
    render(<MarketplacePackagePage />);
    await screen.findByRole('button', { name: '«marketplace.action.installToCloud»' });
    await waitFor(() => expect(answered).toContain(`GET ${MANIFEST_PATH}`));
    await act(async () => {});
  }

  /** Open the install dialog from the page and press its Install. */
  async function installHosted() {
    fireEvent.click(installToCloud());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '«marketplace.action.install»' }));
    await waitFor(() => expect(cloudPosts).toHaveLength(1));
    return dialog;
  }

  it('a package that permits both modes draws the choice through the install-local resolver, and the install waits for a pick', async () => {
    serveManifest(compiledBody({ installModes: ['managed', 'unmanaged'] }));
    await renderHosted();

    expect(screen.getByTestId('install-mode-choice')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(radio('managed')).not.toBeChecked();
    expect(radio('unmanaged')).not.toBeChecked();
    expect(installToCloud()).toBeDisabled();
    expect(installToCloud()).toHaveAccessibleDescription('«marketplace.install.mode.required»');
  });

  it.each(['managed', 'unmanaged'] as const)('the picked mode `%s` is sent as `install_mode`', async (mode) => {
    serveManifest(flatBody({ installModes: ['managed', 'unmanaged'] }));
    await renderHosted();

    fireEvent.click(radio(mode));
    await waitFor(() => expect(installToCloud()).toBeEnabled());
    await installHosted();

    expect(cloudPosts[0]).toEqual({ package_id: 'pkg_crm', seed_sample_data: false, install_mode: mode });
  });

  it('a package that permits only `unmanaged` draws no choice, says the install is a copy, and sends `unmanaged`', async () => {
    serveManifest(flatBody({ installModes: ['unmanaged'] }));
    await renderHosted();

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByTestId('install-mode-sole')).toHaveTextContent('«marketplace.install.mode.unmanagedHint»');
    await installHosted();

    expect(cloudPosts[0]).toEqual({ package_id: 'pkg_crm', seed_sample_data: false, install_mode: 'unmanaged' });
  });

  it.each([
    ['declares no `installModes`', { status: 200, body: { success: true, data: { manifest: flatBody(), version: '4.0.1', version_id: 'ver_4' } } }],
    ['permits `managed` only', { status: 200, body: { success: true, data: { manifest: flatBody({ installModes: ['managed'] }), version: '4.0.1', version_id: 'ver_4' } } }],
    ['cannot be read', { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'no manifest' } } }],
  ])('a manifest that %s draws no choice, and the request carries no `install_mode` key', async (_label, manifest) => {
    wire.manifest = manifest;
    await renderHosted();

    expect(screen.queryByTestId('install-mode-choice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('install-mode-sole')).not.toBeInTheDocument();
    expect(installToCloud()).toBeEnabled();
    await installHosted();

    expect(cloudPosts[0]).toEqual({ package_id: 'pkg_crm', seed_sample_data: false });
    expect(cloudPosts[0]).not.toHaveProperty('install_mode');
  });

  it('a requested copy answered without `installMode` says the environment installed the package managed', async () => {
    // Today's environment forwards no mode: the control plane installs managed.
    serveManifest(flatBody({ installModes: ['unmanaged'] }));
    wire.install = { status: 200, body: { success: true, data: { installation: { id: 'inst_1', environment_id: 'env_1', package_id: 'pkg_crm', version: '4.0.1' } } } };
    await renderHosted();
    const dialog = await installHosted();

    expect(await within(dialog).findByText('«marketplace.install.unmanagedIgnored|name=Example CRM»')).toBeInTheDocument();
    expect(within(dialog).queryByText('«marketplace.install.deployed»')).not.toBeInTheDocument();
  });

  it('an `unmanaged` answer names the base it copied into', async () => {
    serveManifest(flatBody({ installModes: ['unmanaged'] }));
    wire.install = { status: 200, body: { success: true, data: unmanagedAnswer([]) } };
    await renderHosted();
    const dialog = await installHosted();

    expect(await within(dialog).findByText(`«marketplace.install.unmanagedSuccess|name=Example CRM|base=${PKG}-copy|version=4.0.1»`)).toBeInTheDocument();
    // The copy is the environment's own base, not a package installation: the CTA does not flip to Installed.
    expect(screen.queryByRole('button', { name: '«marketplace.action.installed»' })).not.toBeInTheDocument();
  });

  it.each([
    [422, 'INSTALL_MODE_NOT_PERMITTED', 'MODE-REFUSAL sentinel: this package permits another mode.'],
    [409, 'UNMANAGED_INSTALL_WALLED_POSTURE', 'POSTURE-REFUSAL sentinel: this deployment walls organizations.'],
  ])('a %i %s refusal shows the envelope\'s own message, as install-local does', async (status, code, message) => {
    serveManifest(flatBody({ installModes: ['managed', 'unmanaged'] }));
    wire.install = { status, body: { success: false, error: { code, message, details: { permitted: ['managed'] } } } };
    await renderHosted();
    fireEvent.click(radio('unmanaged'));
    await waitFor(() => expect(installToCloud()).toBeEnabled());
    const dialog = await installHosted();

    expect(await within(dialog).findByText(message)).toBeInTheDocument();
  });

  it('a `DEPENDENCY_MISSING` refusal is drawn from its facts, through the install-local code-to-text path', async () => {
    serveManifest(flatBody());
    wire.install = {
      status: 422,
      body: {
        success: false,
        error: {
          code: 'DEPENDENCY_MISSING',
          message: 'DEPENDENCY-SENTINEL: the server English sentence',
          details: { compatible: false, issues: [], unmet: [{ packageId: PKG, dependency: 'com.example.base', range: '^6.0.0', found: 'absent' }] },
        },
      },
    };
    await renderHosted();
    const dialog = await installHosted();

    expect(await within(dialog).findByText(/«marketplace\.install\.dependencyMissing\.heading»/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/DEPENDENCY-SENTINEL/)).not.toBeInTheDocument();
  });
});

describe('`installPackage()` sends `install_mode` only when it is set (objectstack#30963)', () => {
  it.each([
    ['the hosted route', HOSTED_CLOUD, CLOUD_INSTALL_PATH],
    ['the control plane\'s own action', '', '/api/v1/actions/sys_package/install_package'],
  ])('%s: absent sends no key; set sends it', async (_label, cloudUrl, path) => {
    await boot(false, cloudUrl);
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { body?: string }) => {
      expect(new URL(String(input), 'http://console.test').pathname).toBe(path);
      bodies.push(JSON.parse(init?.body ?? '{}'));
      return answer(200, { success: true, data: {} });
    }));

    await installPackage({ packageId: 'pkg_crm', environmentId: 'env_1' });
    await installPackage({ packageId: 'pkg_crm', environmentId: 'env_1', installMode: 'unmanaged' });

    const modeOf = (b: Record<string, unknown>) => (cloudUrl ? b : (b.params as Record<string, unknown>));
    expect(modeOf(bodies[0])).not.toHaveProperty('install_mode');
    expect(modeOf(bodies[1]).install_mode).toBe('unmanaged');
  });
});
