// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The administrator's first-run checklist on Home (objectstack#30206), which
 * replaces the dialog that asked for the workspace timezone and currency.
 *
 * The two rules the dialog's rulings set still hold, and are pinned here on the
 * wire: the browser's answers only PRE-FILL a row, and nothing is written until
 * the row's Confirm (objectui#11693 B2); an unset currency stays on the list
 * until it is set (objectstack#28872).
 *
 * Every pin drives the REAL settings client (`api.ts`) against a stubbed
 * `fetch`, so "exactly one write" counts `PUT /api/settings/localization`
 * requests rather than calls on a mock, and the capability answer comes from
 * the real `MePermissionsProvider`. The browser is stubbed at its readers:
 * `navigator.languages` / `navigator.language` and
 * `Intl.DateTimeFormat.prototype.resolvedOptions`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import {
  MePermissionsProvider,
  type MePermissionsAuthenticatedResponse,
  type MePermissionsResponse,
} from '@object-ui/permissions';

const { AUTH, toastError, toastSuccess, SHELL } = vi.hoisted(() => ({
  // What the Connect an AI Assistant row reads: the served apps (for the page's
  // path) and the adapter (for what this administrator has connected).
  SHELL: { apps: [] as unknown[], adapter: null as unknown },
  AUTH: {
    user: { id: 'u_admin' },
    activeOrganization: { id: 'org_1', name: 'Default Organization' } as { id: string; name: string },
    getMembers: vi.fn(),
    listInvitations: vi.fn(),
  },
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => AUTH,
}));
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));
// The checklist reads the apps (for the Setup app's path) from the metadata
// provider; the real surface is inherited and only that read is stubbed.
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: SHELL.apps, objects: [], loading: false, error: null, refresh: async () => {} }),
  resolveSetupAppPath: () => '/apps/setup',
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => SHELL.adapter,
}));

import { useHomeItemClaimed, type HomeItem } from '@object-ui/app-shell';
import { FirstRunChecklist } from '../FirstRunChecklist';
import { __resetBootPainted } from '../../../loadLocales';
import type { Specifier } from '../types';

const LOCALE_SPEC: Specifier = {
  type: 'select',
  key: 'locale',
  label: 'Default locale',
  default: 'en-US',
  options: [
    { value: 'en-US', label: 'English (US)' },
    { value: 'zh-CN', label: '中文（简体）' },
  ],
};
const COUNTRY_SPEC: Specifier = {
  type: 'select',
  key: 'default_country',
  label: 'Default country',
  default: 'US',
  pattern: '^[A-Za-z]{2}$',
  valueDomain: 'iso_3166_alpha2',
  options: [
    { value: 'US', label: 'United States (US)' },
    { value: 'CN', label: 'China (CN)' },
  ],
};
const TIMEZONE_SPEC: Specifier = {
  type: 'select',
  key: 'timezone',
  label: 'Default timezone',
  default: 'UTC',
  valueDomain: 'iana_time_zone',
  options: [
    { value: 'UTC', label: 'UTC' },
    { value: 'Asia/Shanghai', label: '(UTC+08) Shanghai' },
  ],
};
const CURRENCY_SPEC: Specifier = {
  type: 'select',
  key: 'currency',
  label: 'Default currency',
  valueDomain: 'iso_4217_currency',
  options: [
    { value: 'USD', label: 'USD — US Dollar' },
    { value: 'CNY', label: 'CNY — Chinese Yuan' },
  ],
};

const LOCALIZATION_MANIFEST = {
  namespace: 'localization',
  version: 2,
  label: 'Localization',
  scope: 'tenant',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [{ type: 'group', id: 'region', label: 'Region' }, LOCALE_SPEC, COUNTRY_SPEC, TIMEZONE_SPEC, CURRENCY_SPEC],
};
const MAIL_MANIFEST = {
  namespace: 'mail',
  version: 1,
  label: 'Mail Delivery',
  scope: 'global',
  readPermission: 'manage_platform_settings',
  writePermission: 'manage_platform_settings',
  specifiers: [
    { type: 'select', key: 'provider', label: 'Provider', default: 'smtp', options: [{ value: 'smtp', label: 'SMTP' }, { value: 'log', label: 'Log only' }] },
    { type: 'text', key: 'smtp_host', label: 'SMTP host' },
    { type: 'text', key: 'from_email', label: 'From address' },
  ],
};

type Source = 'env' | 'global' | 'tenant' | 'user' | 'default';
function resolved(value: unknown, source: Source = 'default') {
  return { value, source, locked: source === 'env', cascadeChain: [{ scope: source, value, effective: true }] };
}

function freshLocalization(): Record<string, ReturnType<typeof resolved>> {
  return {
    locale: resolved('en-US'),
    default_country: resolved('US'),
    timezone: resolved('UTC'),
    currency: resolved(null),
  };
}

let localizationValues = freshLocalization();
let mailValues: Record<string, ReturnType<typeof resolved>> = { provider: resolved('smtp') };
let putRefusal: unknown = null;
// Manifests listed beside localization and mail (the `ai` one, for the built-in AI row), and the `ai` page.
let extraManifests: unknown[] = [];
let aiPayload: Record<string, unknown> | null = null;

function ok(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data }) } as unknown as Response;
}

const fetchMock = vi.fn();
function routeFetch() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/settings' && method === 'GET') {
      return ok({ manifests: [LOCALIZATION_MANIFEST, MAIL_MANIFEST, ...extraManifests] });
    }
    if (url === '/api/settings/ai' && method === 'GET' && aiPayload) return ok(aiPayload);
    if (url === '/api/settings/localization' && method === 'GET') {
      return ok({ manifest: LOCALIZATION_MANIFEST, values: localizationValues });
    }
    if (url === '/api/settings/mail' && method === 'GET') return ok({ manifest: MAIL_MANIFEST, values: mailValues });
    if (url === '/api/settings/localization' && method === 'PUT') {
      if (putRefusal) {
        return { ok: false, status: 400, statusText: 'Bad Request', json: async () => putRefusal } as unknown as Response;
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const written = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, resolved(v, 'tenant')]));
      localizationValues = { ...localizationValues, ...written };
      return ok({ values: written });
    }
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) } as unknown as Response;
  });
}

const calls = (method: string, url: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method);
const puts = () => calls('PUT', '/api/settings/localization');

function permissionsPayload(systemPermissions: string[] | undefined): MePermissionsResponse {
  const base: MePermissionsAuthenticatedResponse = {
    authenticated: true,
    userId: 'u_admin',
    tenantId: 'org_1',
    positions: [],
    hasAnyQueue: false,
    permissionSets: [],
    objects: {},
    fields: {},
  };
  return systemPermissions === undefined ? base : { ...base, systemPermissions };
}

const ADMIN = ['setup.access', 'setup.write', 'manage_platform_settings'];
const MEMBER = ['setup.access'];

/** No default for `systemPermissions`: "not reported" must stay apart from the admin set. */
function renderChecklist(systemPermissions: string[] | undefined, language = 'en') {
  return render(
    <MemoryRouter>
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
        <MePermissionsProvider initialPermissions={permissionsPayload(systemPermissions)}>
          <FirstRunChecklist />
        </MePermissionsProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const row = (id: string) => screen.getByTestId(`first-run-checklist-row-${id}`);

/** Unfolds the rows that are done, which the checklist folds away (objectstack#32157). */
async function showDone() {
  fireEvent.click(await screen.findByTestId('first-run-checklist-toggle-done'));
}

let browserZone = 'Asia/Shanghai';
let browserLanguages = ['zh-CN'];
const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

beforeEach(() => {
  fetchMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  localStorage.clear();
  localizationValues = freshLocalization();
  mailValues = { provider: resolved('smtp') };
  putRefusal = null;
  extraManifests = [];
  aiPayload = null;
  AUTH.activeOrganization = { id: 'org_1', name: 'Default Organization' };
  SHELL.apps = [];
  SHELL.adapter = null;
  AUTH.getMembers.mockReset().mockResolvedValue([{ id: 'm_1' }]);
  AUTH.listInvitations.mockReset().mockResolvedValue([]);
  browserZone = 'Asia/Shanghai';
  browserLanguages = ['zh-CN'];
  vi.stubGlobal('fetch', fetchMock);
  routeFetch();
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...realResolvedOptions.call(this), timeZone: browserZone };
  });
  vi.spyOn(window.navigator, 'languages', 'get').mockImplementation(() => browserLanguages);
  vi.spyOn(window.navigator, 'language', 'get').mockImplementation(() => browserLanguages[0] ?? '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('only an administrator sees it', () => {
  it('a member: the manifest list is read, no namespace, and nothing is drawn', async () => {
    renderChecklist(MEMBER);
    await settle();
    expect(calls('GET', '/api/settings')).toHaveLength(1);
    expect(calls('GET', '/api/settings/localization')).toHaveLength(0);
    expect(screen.queryByTestId('first-run-checklist')).toBeNull();
    expect(AUTH.getMembers).not.toHaveBeenCalled();
  });

  it('no capability answer, or one holding nothing: no request at all', async () => {
    renderChecklist(undefined);
    await settle();
    cleanup();
    renderChecklist([]);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('first-run-checklist')).toBeNull();
  });
});

describe('each row is read from the real setting', () => {
  it('a fresh workspace: every row is shown not done, each with its way in', async () => {
    renderChecklist(ADMIN);
    expect(await screen.findByTestId('first-run-checklist')).toBeTruthy();
    expect(await screen.findByTestId('first-run-checklist-row-invite')).toBeTruthy();
    const ids = ['organization_name', 'language_country', 'timezone', 'currency', 'mail', 'invite'];
    for (const id of ids) expect(row(id).getAttribute('data-done')).toBe('false');
    expect(screen.getByTestId('first-run-checklist-progress').textContent).toBe('0 of 5 done');
    expect(screen.getByText('Not set yet, so amounts are shown without a currency symbol.')).toBeTruthy();
    expect(screen.getByTestId('first-run-checklist-link-organization_name').getAttribute('href')).toBe(
      '/apps/setup/sys_organization/record/org_1',
    );
    expect(screen.getByTestId('first-run-checklist-link-mail').getAttribute('href')).toBe('/apps/setup/system/settings/mail');
    expect(screen.getByTestId('first-run-checklist-link-invite').getAttribute('href')).toBe('/apps/setup/sys_user/view/all_users');
    // Reading is all it did.
    expect(puts()).toHaveLength(0);
  });

  it('rows the server reports as set are done, and a fully set workspace draws nothing', async () => {
    localizationValues = {
      locale: resolved('zh-CN', 'tenant'),
      default_country: resolved('CN', 'tenant'),
      timezone: resolved('Asia/Shanghai', 'tenant'),
      currency: resolved('CNY', 'tenant'),
    };
    renderChecklist(ADMIN);
    await screen.findByTestId('first-run-checklist-row-invite');
    await showDone();
    for (const id of ['language_country', 'timezone', 'currency']) expect(row(id).getAttribute('data-done')).toBe('true');
    expect(row('organization_name').getAttribute('data-done')).toBe('false');
    expect(screen.getByTestId('first-run-checklist-progress').textContent).toBe('3 of 5 done');
    cleanup();

    AUTH.activeOrganization = { id: 'org_1', name: 'Acme' };
    AUTH.getMembers.mockResolvedValue([{ id: 'm_1' }, { id: 'm_2' }]);
    mailValues = { provider: resolved('smtp', 'global'), smtp_host: resolved('mx', 'global'), from_email: resolved('a@b.co', 'global') };
    renderChecklist(ADMIN);
    await settle();
    await waitFor(() => expect(AUTH.getMembers).toHaveBeenCalled());
    await settle();
    expect(screen.queryByTestId('first-run-checklist')).toBeNull();
  });
});

describe('the browser pre-fills; only Confirm writes (objectui#11693 B2, objectstack#28872)', () => {
  it('Set opens the editor pre-filled from the browser; Confirm sends exactly one PUT and the row is done', async () => {
    renderChecklist(ADMIN);
    fireEvent.click(await screen.findByTestId('first-run-checklist-set-currency'));
    const editor = screen.getByTestId('first-run-checklist-editor-currency');
    expect((within(editor).getByRole('combobox') as HTMLInputElement).value).toBe('CNY — Chinese Yuan');
    await settle();
    expect(puts()).toHaveLength(0);

    fireEvent.click(screen.getByTestId('first-run-checklist-confirm-currency'));
    await showDone();
    await waitFor(() => expect(row('currency').getAttribute('data-done')).toBe('true'));
    expect(puts()).toHaveLength(1);
    expect(JSON.parse(String((puts()[0][1] as RequestInit).body))).toEqual({ currency: 'CNY' });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it('language and country are one offer from one browser language', async () => {
    renderChecklist(ADMIN);
    fireEvent.click(await screen.findByTestId('first-run-checklist-set-language_country'));
    fireEvent.click(screen.getByTestId('first-run-checklist-confirm-language_country'));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(JSON.parse(String((puts()[0][1] as RequestInit).body))).toEqual({ locale: 'zh-CN', default_country: 'CN' });
  });

  it('Cancel writes nothing; hiding the checklist writes nothing and keeps it hidden on this device', async () => {
    const view = renderChecklist(ADMIN);
    fireEvent.click(await screen.findByTestId('first-run-checklist-set-timezone'));
    fireEvent.click(screen.getByTestId('first-run-checklist-cancel-timezone'));
    expect(screen.queryByTestId('first-run-checklist-editor-timezone')).toBeNull();

    fireEvent.click(screen.getByTestId('first-run-checklist-dismiss'));
    expect(screen.queryByTestId('first-run-checklist')).toBeNull();
    await settle();
    expect(puts()).toHaveLength(0);
    expect(localStorage.getItem('os:first-run-checklist:org_1:u_admin')).not.toBeNull();

    view.unmount();
    fetchMock.mockClear();
    renderChecklist(ADMIN);
    await settle();
    expect(screen.queryByTestId('first-run-checklist')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a refused write marks the field in the console words and leaves the row not done', async () => {
    putRefusal = {
      success: false,
      error: {
        code: 'SETTINGS_VALIDATION',
        message: "Settings for 'localization' are incomplete: default_country — …",
        details: {
          namespace: 'localization',
          fields: [
            {
              field: 'default_country',
              code: 'invalid_format',
              message: 'Default country does not match the expected format.',
              label: 'Default country',
            },
          ],
        },
      },
    };
    renderChecklist(ADMIN);
    fireEvent.click(await screen.findByTestId('first-run-checklist-set-language_country'));
    fireEvent.click(screen.getByTestId('first-run-checklist-confirm-language_country'));
    expect(await screen.findByText('Choose a value for Default country from the list.')).toBeTruthy();
    expect(screen.queryByText(/does not match the expected format/)).toBeNull();
    expect(row('language_country').getAttribute('data-done')).toBe('false');
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('zh: the rows read in the reader language', async () => {
    renderChecklist(ADMIN, 'zh');
    expect(await screen.findByText('完成初始设置')).toBeTruthy();
    expect(await screen.findByText('尚未设置，金额暂不显示币种。')).toBeTruthy();
  });

  it('zh: the current language and country are named in Chinese, not by their English labels (objectstack#32021)', async () => {
    renderChecklist(ADMIN, 'zh');
    const r = await screen.findByTestId('first-run-checklist-row-language_country');
    expect(r.textContent).toContain('美国');
    expect(r.textContent).toContain('英语');
    expect(r.textContent).not.toContain('English');
    expect(r.textContent).not.toContain('United States');
  });

  it('CONTROL en: the same row names them in English', async () => {
    renderChecklist(ADMIN);
    const r = await screen.findByTestId('first-run-checklist-row-language_country');
    expect(r.textContent).toContain('United States');
    expect(r.textContent).toContain('English');
  });
});

describe('the reads wait for the first paint (objectui#12980)', () => {
  let splash: HTMLElement | null = null;

  beforeEach(() => {
    __resetBootPainted();
    splash = document.createElement('div');
    splash.setAttribute('data-boot-splash', '');
    document.body.appendChild(splash);
  });

  afterEach(() => {
    splash?.remove();
    splash = null;
  });

  it('reads nothing while the boot splash is up, and draws once it is gone', async () => {
    renderChecklist(ADMIN);
    await act(() => new Promise<void>((r) => setTimeout(r, 80)));
    expect(calls('GET', '/api/settings')).toHaveLength(0);

    act(() => {
      splash?.remove();
      splash = null;
    });
    expect(await screen.findByTestId('first-run-checklist')).toBeTruthy();
    expect(calls('GET', '/api/settings')).toHaveLength(1);
  });
});

describe('Connect an AI assistant: done from a real record, never from a click', () => {
  const ACCOUNT_APP = {
    name: 'account',
    navigation: [{ type: 'group', id: 'grp', children: [{ type: 'page', id: 'nav_connect_agent', pageName: 'connect_agent' }] }],
  };
  let granted: unknown[];
  let keys: Record<string, unknown>[];
  let list: ReturnType<typeof vi.fn>;
  let find: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    granted = [];
    keys = [];
    list = vi.fn(async () => ({ clients: granted, truncated: false }));
    find = vi.fn(async () => ({ data: keys }));
    SHELL.apps = [ACCOUNT_APP];
    SHELL.adapter = { getClient: () => ({ oauth: { authorizedClients: { list } } }), find };
  });

  it('nothing connected: the row is not done and links to the page', async () => {
    keys = [{ id: 'k_old', name: 'old', revoked: true, expires_at: null }];
    renderChecklist(ADMIN);
    const r = await screen.findByTestId('first-run-checklist-row-connect_assistant');
    expect(r.getAttribute('data-done')).toBe('false');
    // objectstack#32021 item 4 — said as an EXTERNAL assistant over MCP, apart from the built-in AI.
    expect(within(r).getByText('Connect an external AI assistant')).toBeTruthy();
    expect(
      within(r).getByText(
        'Work in this system as yourself from Claude, Doubao and similar assistants, over MCP. The built-in AI is set up separately, in Setup → AI & Embedder.',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('first-run-checklist-link-connect_assistant').getAttribute('href')).toBe(
      '/apps/account/page/connect_agent',
    );
    expect(screen.getByTestId('first-run-checklist-progress').textContent).toBe('0 of 6 done');
    expect(find).toHaveBeenCalledWith('sys_api_key', expect.objectContaining({ $filter: { user_id: 'u_admin' } }));
  });

  it('an authorized assistant makes it done', async () => {
    granted = [{ id: 'c1', clientId: 'cl', name: 'Claude Desktop', scopes: [], organizationId: null, authorizedAt: null, lastUsedAt: null }];
    renderChecklist(ADMIN);
    await showDone();
    const r = await screen.findByTestId('first-run-checklist-row-connect_assistant');
    expect(r.getAttribute('data-done')).toBe('true');
    expect(within(r).getByText('An AI assistant or API key of yours is connected.')).toBeTruthy();
  });

  it('an API key that still works makes it done', async () => {
    keys = [{ id: 'k_live', name: 'doubao key', revoked: false, expires_at: null }];
    renderChecklist(ADMIN);
    await showDone();
    const r = await screen.findByTestId('first-run-checklist-row-connect_assistant');
    expect(r.getAttribute('data-done')).toBe('true');
  });

  it('opening the page through the row writes nothing and leaves it not done', async () => {
    renderChecklist(ADMIN);
    const link = await screen.findByTestId('first-run-checklist-link-connect_assistant');
    fireEvent.click(link);
    await settle();
    expect(row('connect_assistant').getAttribute('data-done')).toBe('false');
    expect(fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') !== 'GET')).toHaveLength(0);
  });

  it('a read that fails leaves the row out rather than not done', async () => {
    list.mockRejectedValue(new Error('down'));
    renderChecklist(ADMIN);
    await screen.findByTestId('first-run-checklist-row-invite');
    await settle();
    expect(screen.queryByTestId('first-run-checklist-row-connect_assistant')).toBeNull();
  });

  it('MCP turned off (no page in the Account app): no row and no read', async () => {
    SHELL.apps = [{ name: 'account', navigation: [] }];
    renderChecklist(ADMIN);
    await screen.findByTestId('first-run-checklist-row-invite');
    await settle();
    expect(screen.queryByTestId('first-run-checklist-row-connect_assistant')).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });

  it('a member reads nothing of it', async () => {
    renderChecklist(MEMBER);
    await settle();
    expect(list).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });
});

/** What Home's other cards read: whether some card draws `item`. */
function Claimed({ item }: { item: HomeItem }) {
  return <span data-testid={`claimed-${item}`}>{String(useHomeItemClaimed(item))}</span>;
}

describe('one Home card per item (objectstack#32021 item 3)', () => {
  describe('the assistant row, while open, is what Home says about connecting one', () => {
    const ACCOUNT_APP = {
      name: 'account',
      navigation: [{ type: 'group', id: 'grp', children: [{ type: 'page', id: 'nav_connect_agent', pageName: 'connect_agent' }] }],
    };
    let granted: unknown[];

    beforeEach(() => {
      granted = [];
      SHELL.apps = [ACCOUNT_APP];
      SHELL.adapter = {
        getClient: () => ({ oauth: { authorizedClients: { list: async () => ({ clients: granted, truncated: false }) } } }),
        find: async () => ({ data: [] }),
      };
    });

    it('not done: the checklist claims it, so Home\'s Connect an AI Assistant card stands aside', async () => {
      render(<Claimed item="connect_assistant" />);
      renderChecklist(ADMIN);
      await screen.findByTestId('first-run-checklist-row-connect_assistant');
      await waitFor(() => expect(screen.getByTestId('claimed-connect_assistant').textContent).toBe('true'));

      // Hiding the checklist releases it.
      cleanup();
      render(<Claimed item="connect_assistant" />);
      expect(screen.getByTestId('claimed-connect_assistant').textContent).toBe('false');
    });

    it('CONTROL: once an assistant is connected the row is done, and the card is not held back', async () => {
      granted = [{ id: 'c1', clientId: 'cl', name: 'Claude Desktop', scopes: [], organizationId: null, authorizedAt: null, lastUsedAt: null }];
      render(<Claimed item="connect_assistant" />);
      renderChecklist(ADMIN);
      await showDone();
      const r = await screen.findByTestId('first-run-checklist-row-connect_assistant');
      expect(r.getAttribute('data-done')).toBe('true');
      await settle();
      expect(screen.getByTestId('claimed-connect_assistant').textContent).toBe('false');
    });

    it('CONTROL: a member draws no checklist and claims nothing', async () => {
      render(<Claimed item="connect_assistant" />);
      renderChecklist(MEMBER);
      await settle();
      expect(screen.getByTestId('claimed-connect_assistant').textContent).toBe('false');
    });
  });
});

describe('the built-in AI: the provider the server runs, from live.provider (objectstack#32021 item 4)', () => {
  const AI_MANIFEST = {
    namespace: 'ai',
    version: 1,
    label: 'AI & Embedder',
    scope: 'global',
    readPermission: 'manage_platform_settings',
    writePermission: 'manage_platform_settings',
    specifiers: [
      {
        type: 'select',
        key: 'provider',
        label: 'Provider',
        options: [
          { value: 'openai', label: 'OpenAI' },
          { value: 'deepseek', label: 'DeepSeek (OpenAI-compatible)' },
        ],
      },
    ],
  };
  type Live = { value: string | null; source: 'settings' | 'environment' | 'none' } | undefined;
  function serveAi(live: Live, stored: unknown = null) {
    extraManifests = [AI_MANIFEST];
    aiPayload = {
      manifest: AI_MANIFEST,
      values: { provider: resolved(stored, stored === null ? 'default' : 'global') },
      ...(live ? { live: { provider: live } } : {}),
    };
  }

  /** The checklist on `/`, beside the AI settings page the row links to. */
  function renderWithSettingsPage(systemPermissions: string[]) {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
          <MePermissionsProvider initialPermissions={permissionsPayload(systemPermissions)}>
            <Routes>
              <Route path="/" element={<FirstRunChecklist />} />
              <Route path="/apps/setup/system/settings/ai" element={<h1>AI settings page</h1>} />
            </Routes>
          </MePermissionsProvider>
        </I18nProvider>
      </MemoryRouter>,
    );
  }

  it('none in use: the row is not done, and its link opens Setup → AI & Embedder', async () => {
    serveAi({ value: null, source: 'none' });
    renderWithSettingsPage(ADMIN);
    const r = await screen.findByTestId('first-run-checklist-row-ai_provider');
    expect(r.getAttribute('data-done')).toBe('false');
    expect(within(r).getByText('Set up the built-in AI')).toBeTruthy();
    expect(within(r).getByText('No AI provider is in use yet. Choose one and add its key.')).toBeTruthy();
    await screen.findByTestId('first-run-checklist-row-invite');
    expect(screen.getByTestId('first-run-checklist-progress').textContent).toBe('0 of 6 done');

    fireEvent.click(within(r).getByRole('link', { name: 'Set up' }));
    expect(await screen.findByRole('heading', { name: 'AI settings page' })).toBeTruthy();
    expect(puts()).toHaveLength(0);
  });

  it('set in Setup: done, naming the provider by its option and saying where it came from', async () => {
    serveAi({ value: 'openai', source: 'settings' }, 'openai');
    renderChecklist(ADMIN);
    await showDone();
    const r = await screen.findByTestId('first-run-checklist-row-ai_provider');
    expect(r.getAttribute('data-done')).toBe('true');
    expect(within(r).getByText('OpenAI, set in Setup.')).toBeTruthy();
    expect(within(r).getByRole('link', { name: 'Change' }).getAttribute('href')).toBe('/apps/setup/system/settings/ai');
  });

  it('detected from the boot environment with nothing saved: done, and says so', async () => {
    serveAi({ value: 'deepseek', source: 'environment' }, null);
    renderChecklist(ADMIN);
    await showDone();
    const r = await screen.findByTestId('first-run-checklist-row-ai_provider');
    expect(r.getAttribute('data-done')).toBe('true');
    expect(within(r).getByText('DeepSeek (OpenAI-compatible), detected from the server environment.')).toBeTruthy();
  });

  it('a saved provider the running system does not use is not done: live decides, not values', async () => {
    serveAi({ value: null, source: 'none' }, 'openai');
    renderChecklist(ADMIN);
    const r = await screen.findByTestId('first-run-checklist-row-ai_provider');
    expect(r.getAttribute('data-done')).toBe('false');
  });

  it('a server that states no provider: no row, rather than "not set"', async () => {
    serveAi(undefined, 'openai');
    renderChecklist(ADMIN);
    await screen.findByTestId('first-run-checklist-row-invite');
    await settle();
    expect(calls('GET', '/api/settings/ai')).toHaveLength(1);
    expect(screen.queryByTestId('first-run-checklist-row-ai_provider')).toBeNull();
    expect(screen.getByTestId('first-run-checklist-progress').textContent).toBe('0 of 5 done');
  });

  it('a session that may not write ai never reads it and draws no row', async () => {
    serveAi({ value: null, source: 'none' });
    renderChecklist(['setup.access', 'setup.write']);
    await screen.findByTestId('first-run-checklist-row-invite');
    await settle();
    expect(calls('GET', '/api/settings/ai')).toHaveLength(0);
    expect(screen.queryByTestId('first-run-checklist-row-ai_provider')).toBeNull();
  });

  it('zh: the row reads in the reader language', async () => {
    serveAi({ value: null, source: 'none' });
    renderChecklist(ADMIN, 'zh');
    const r = await screen.findByTestId('first-run-checklist-row-ai_provider');
    expect(within(r).getByText('设置内置 AI')).toBeTruthy();
  });

  describe('PRESERVATION: the external assistant row keeps its words and stays a different step', () => {
    const ACCOUNT_APP = {
      name: 'account',
      navigation: [{ type: 'group', id: 'grp', children: [{ type: 'page', id: 'nav_connect_agent', pageName: 'connect_agent' }] }],
    };

    beforeEach(() => {
      SHELL.apps = [ACCOUNT_APP];
      SHELL.adapter = {
        getClient: () => ({ oauth: { authorizedClients: { list: async () => ({ clients: [], truncated: false }) } } }),
        find: async () => ({ data: [] }),
      };
    });

    it('both rows are drawn, each with its own title, page and done state', async () => {
      serveAi({ value: 'openai', source: 'settings' }, 'openai');
      render(<Claimed item="connect_assistant" />);
      renderChecklist(ADMIN);
      await showDone();
      const builtIn = await screen.findByTestId('first-run-checklist-row-ai_provider');
      const external = await screen.findByTestId('first-run-checklist-row-connect_assistant');
      expect(builtIn.getAttribute('data-done')).toBe('true');
      expect(external.getAttribute('data-done')).toBe('false');
      expect(within(external).getByText('Connect an external AI assistant')).toBeTruthy();
      expect(within(external).getByRole('link', { name: 'Connect' }).getAttribute('href')).toBe('/apps/account/page/connect_agent');
      expect(within(builtIn).queryByText('Connect an external AI assistant')).toBeNull();
      // The built-in row being done does not release the external row's Home claim.
      await waitFor(() => expect(screen.getByTestId('claimed-connect_assistant').textContent).toBe('true'));
    });
  });
});

describe('rows that are done are folded away, so the card keeps the screen for the work left (objectstack#32157)', () => {
  function setThreeRows() {
    localizationValues = {
      locale: resolved('zh-CN', 'tenant'),
      default_country: resolved('CN', 'tenant'),
      timezone: resolved('Asia/Shanghai', 'tenant'),
      currency: resolved('CNY', 'tenant'),
    };
  }
  const drawnRows = () =>
    within(screen.getByTestId('first-run-checklist'))
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('data-testid')?.replace('first-run-checklist-row-', ''));

  it('done rows are not drawn; one control says how many and unfolds them in their place', async () => {
    setThreeRows();
    renderChecklist(ADMIN);
    await screen.findByTestId('first-run-checklist-row-invite');
    expect(drawnRows()).toEqual(['organization_name', 'mail', 'invite']);
    expect(screen.getByTestId('first-run-checklist-progress').textContent).toBe('3 of 5 done');
    const toggle = screen.getByTestId('first-run-checklist-toggle-done');
    expect(toggle.textContent).toBe('Show completed (3)');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(screen.getByRole('list').id);

    fireEvent.click(toggle);
    expect(drawnRows()).toEqual(['organization_name', 'language_country', 'timezone', 'currency', 'mail', 'invite']);
    expect(toggle.textContent).toBe('Hide completed');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle);
    expect(drawnRows()).toEqual(['organization_name', 'mail', 'invite']);
    expect(puts()).toHaveLength(0);
  });

  it('a row confirmed in place folds away once the server has it, and the count follows', async () => {
    renderChecklist(ADMIN);
    fireEvent.click(await screen.findByTestId('first-run-checklist-set-currency'));
    fireEvent.click(screen.getByTestId('first-run-checklist-confirm-currency'));
    const toggle = await screen.findByTestId('first-run-checklist-toggle-done');
    expect(toggle.textContent).toBe('Show completed (1)');
    expect(screen.queryByTestId('first-run-checklist-row-currency')).toBeNull();
    expect(screen.getByTestId('first-run-checklist-progress').textContent).toBe('1 of 5 done');
  });

  it('CONTROL: with nothing done every row is drawn and there is nothing to unfold', async () => {
    renderChecklist(ADMIN);
    await screen.findByTestId('first-run-checklist-row-invite');
    expect(drawnRows()).toEqual(['organization_name', 'language_country', 'timezone', 'currency', 'mail', 'invite']);
    expect(screen.queryByTestId('first-run-checklist-toggle-done')).toBeNull();
  });

  it('zh: the control reads in the reader language', async () => {
    setThreeRows();
    renderChecklist(ADMIN, 'zh');
    const toggle = await screen.findByTestId('first-run-checklist-toggle-done');
    expect(toggle.textContent).toBe('显示已完成的项（3）');
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe('收起已完成的项');
  });
});

describe('email delivery is optional: shown, marked so, and never what keeps the checklist open (objectstack#32643)', () => {
  // The maintainer's ruling on the card: 「环境的新手清单中要求设置邮箱。我觉得这个不应该是必须的设置」.
  function setRequiredRows() {
    localizationValues = {
      locale: resolved('zh-CN', 'tenant'),
      default_country: resolved('CN', 'tenant'),
      timezone: resolved('Asia/Shanghai', 'tenant'),
      currency: resolved('CNY', 'tenant'),
    };
    AUTH.activeOrganization = { id: 'org_1', name: 'Acme' };
    AUTH.getMembers.mockResolvedValue([{ id: 'm_1' }, { id: 'm_2' }]);
  }
  const DELIVERING = () => ({
    provider: resolved('smtp', 'global'),
    smtp_host: resolved('mx', 'global'),
    from_email: resolved('a@b.co', 'global'),
  });

  it('the mail row says it is optional and is left out of the progress count; no other row is marked', async () => {
    renderChecklist(ADMIN);
    await screen.findByTestId('first-run-checklist-row-invite');
    expect(row('mail').getAttribute('data-optional')).toBe('true');
    expect(within(row('mail')).getByTestId('first-run-checklist-optional-mail').textContent).toBe('Optional');
    for (const id of ['organization_name', 'language_country', 'timezone', 'currency', 'invite']) {
      expect(row(id).getAttribute('data-optional')).toBeNull();
      expect(screen.queryByTestId(`first-run-checklist-optional-${id}`)).toBeNull();
    }
    // Six rows drawn, five required.
    expect(within(screen.getByTestId('first-run-checklist')).getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByTestId('first-run-checklist-progress').textContent).toBe('0 of 5 done');
  });

  it('every required row done and mail never set up: the checklist draws nothing', async () => {
    setRequiredRows();
    renderChecklist(ADMIN);
    await settle();
    await waitFor(() => expect(AUTH.getMembers).toHaveBeenCalled());
    await settle();
    // The mail namespace was read, and still answers "not set up".
    expect(calls('GET', '/api/settings/mail')).toHaveLength(1);
    expect(screen.queryByTestId('first-run-checklist')).toBeNull();
  });

  it('CONTROL: one required row left, the checklist stays and the unset mail row is on it, not done', async () => {
    setRequiredRows();
    AUTH.activeOrganization = { id: 'org_1', name: 'Default Organization' };
    renderChecklist(ADMIN);
    // The invite row is done, so folded: its read is awaited through the count.
    await waitFor(() => expect(screen.getByTestId('first-run-checklist-progress').textContent).toBe('4 of 5 done'));
    expect(drawnRowIds()).toEqual(['organization_name', 'mail']);
    expect(row('mail').getAttribute('data-done')).toBe('false');
  });

  it('a mail setup that delivers still reads done; it folds with the done rows and moves no required count', async () => {
    mailValues = DELIVERING();
    renderChecklist(ADMIN);
    await screen.findByTestId('first-run-checklist-row-invite');
    expect(screen.queryByTestId('first-run-checklist-row-mail')).toBeNull();
    expect(screen.getByTestId('first-run-checklist-progress').textContent).toBe('0 of 5 done');
    await showDone();
    expect(row('mail').getAttribute('data-done')).toBe('true');
    expect(screen.getByTestId('first-run-checklist-link-mail').textContent).toBe('Change');
  });

  it('zh: the optional mark reads in the reader language', async () => {
    renderChecklist(ADMIN, 'zh');
    expect((await screen.findByTestId('first-run-checklist-optional-mail')).textContent).toBe('可选');
  });

  function drawnRowIds() {
    return within(screen.getByTestId('first-run-checklist'))
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('data-testid')?.replace('first-run-checklist-row-', ''));
  }
});
