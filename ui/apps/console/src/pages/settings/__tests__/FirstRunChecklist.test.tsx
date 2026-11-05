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
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import {
  MePermissionsProvider,
  type MePermissionsAuthenticatedResponse,
  type MePermissionsResponse,
} from '@object-ui/permissions';

const { AUTH, toastError, toastSuccess } = vi.hoisted(() => ({
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
// The barrel would transform the whole app shell; the checklist reads two names
// from it, and `i18nSession` (through `loadLocales`) one more.
vi.mock('@object-ui/app-shell', async () => ({
  ...(await vi.importActual<Record<string, unknown>>(
    '../../../../../../packages/app-shell/src/observability/settleSignal',
  )),
  useMetadata: () => ({ apps: [], objects: [], loading: false, error: null, refresh: async () => {} }),
  resolveSetupAppPath: () => '/apps/setup',
}));

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

function ok(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data }) } as unknown as Response;
}

const fetchMock = vi.fn();
function routeFetch() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/settings' && method === 'GET') return ok({ manifests: [LOCALIZATION_MANIFEST, MAIL_MANIFEST] });
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
  AUTH.activeOrganization = { id: 'org_1', name: 'Default Organization' };
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
    expect(screen.getByTestId('first-run-checklist-progress').textContent).toBe('0 of 6 done');
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
    for (const id of ['language_country', 'timezone', 'currency']) expect(row(id).getAttribute('data-done')).toBe('true');
    expect(row('organization_name').getAttribute('data-done')).toBe('false');
    expect(screen.getByTestId('first-run-checklist-progress').textContent).toBe('3 of 6 done');
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
