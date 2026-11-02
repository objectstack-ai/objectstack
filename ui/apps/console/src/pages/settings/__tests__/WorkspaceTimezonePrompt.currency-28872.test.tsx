/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The workspace prompt's currency arm (objectstack#28872): while
 * `localization.currency` has no value on any rung, an administrator is asked
 * once, offered the currency of the browser's region, and when the timezone
 * is still the default too it is ONE prompt with both fields.
 *
 * The same harness as `WorkspaceTimezonePrompt.test.tsx`: the REAL settings
 * client (`api.ts`) against a stubbed `fetch`, so a write is counted as
 * `PUT /api/settings/localization` requests on the wire, and the capability
 * answer comes from the real `MePermissionsProvider`. The browser's region is
 * stubbed at its one reader, `navigator.languages` / `navigator.language`, to
 * `zh-CN`, whose currency (CNY) is no curated option's first entry, so an
 * offer read from anything else would show.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsResponse, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

const { AUTH, toastError, toastSuccess } = vi.hoisted(() => ({
  AUTH: { user: { id: 'u_admin' }, activeOrganization: { id: 'org_1' } },
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => AUTH,
}));
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));

import { WorkspaceTimezonePrompt } from '../WorkspaceTimezonePrompt';
import { browserCurrency, browserLanguage, isAdmissibleValue, promptRecordKey } from '../workspaceTimezonePromptLogic';
import type { ResolvedSettingValue, Specifier } from '../types';

const BROWSER_ZONE = 'Asia/Kolkata';
const RECORD_KEY = promptRecordKey('org_1', 'u_admin');

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

/** The manifest's `currency` row as the server declares it: no default (abridged options). */
const CURRENCY_SPEC: Specifier = {
  type: 'select',
  key: 'currency',
  label: 'Default currency',
  valueDomain: 'iso_4217_currency',
  options: [
    { value: 'USD', label: 'USD — US Dollar' },
    { value: 'EUR', label: 'EUR — Euro' },
    { value: 'CNY', label: 'CNY — Chinese Yuan' },
  ],
};

type Source = 'env' | 'global' | 'tenant' | 'user' | 'default';

function resolvedValue(source: Source, value: unknown, defaultValue: unknown): ResolvedSettingValue {
  const locked = source === 'env';
  return {
    value,
    source,
    locked,
    cascadeChain:
      source === 'default'
        ? [{ scope: 'default', value: defaultValue, effective: true }]
        : [
            { scope: source, value, locked, effective: true },
            { scope: 'default', value: defaultValue },
          ],
  };
}

interface Served {
  timezone?: [Source, string];
  currency?: [Source, string | null];
  currencySpec?: Specifier;
}

/** `GET /api/settings/localization`. Unset currency = `source: 'default'`, `value: null`, as the service answers it. */
function namespacePayload({ timezone = ['default', 'UTC'], currency = ['default', null], currencySpec = CURRENCY_SPEC }: Served = {}) {
  return {
    manifest: {
      namespace: 'localization',
      version: 2,
      label: 'Localization',
      scope: 'tenant',
      readPermission: 'setup.access',
      writePermission: 'setup.write',
      specifiers: [
        { type: 'group', id: 'region', label: 'Region' },
        TIMEZONE_SPEC,
        { type: 'group', id: 'finance', label: 'Finance' },
        currencySpec,
      ],
    },
    values: {
      timezone: resolvedValue(timezone[0], timezone[1], 'UTC'),
      currency: resolvedValue(currency[0], currency[1], currencySpec.default ?? null),
    },
  };
}

function ok(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ success: true, data }),
  } as unknown as Response;
}

const fetchMock = vi.fn();
let served = namespacePayload();

function routeFetch() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/settings' && method === 'GET') {
      return ok({ manifests: [served.manifest] });
    }
    if (url === '/api/settings/localization' && method === 'GET') return ok(served);
    if (url === '/api/settings/localization' && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const values = Object.fromEntries(
        Object.entries(body).map(([key, value]) => [key, { value, source: 'tenant', locked: false }]),
      );
      return ok({ values });
    }
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) } as unknown as Response;
  });
}

const settingsCalls = (method: string, url = '/api/settings/localization') =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method);

const putBodies = () => settingsCalls('PUT').map(([, init]) => JSON.parse(String((init as RequestInit).body)));

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

const ADMIN = ['manage_org_users', 'setup.access', 'setup.write'];

function renderPrompt(systemPermissions: string[] | undefined, language = 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <MePermissionsProvider initialPermissions={permissionsPayload(systemPermissions)}>
        <WorkspaceTimezonePrompt />
      </MePermissionsProvider>
    </I18nProvider>,
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

let browserZone: string | undefined = BROWSER_ZONE;
const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

function stubBrowserLanguage(tags: readonly string[]) {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(tags as string[]);
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(tags[0] ?? '');
}

beforeEach(() => {
  fetchMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  localStorage.clear();
  served = namespacePayload({ timezone: ['tenant', 'Asia/Shanghai'] });
  browserZone = BROWSER_ZONE;
  vi.stubGlobal('fetch', fetchMock);
  routeFetch();
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...realResolvedOptions.call(this), timeZone: browserZone as string };
  });
  stubBrowserLanguage(['zh-CN', 'en-US']);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the currency arm alone: the timezone is chosen, the currency is unset (objectstack#28872)', () => {
  it('en: asks once, offering the browser region\'s currency by name and code', async () => {
    renderPrompt(ADMIN, 'en');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Set the default currency')).toBeTruthy();
    expect(within(dialog).getByText(/no default currency yet/)).toBeTruthy();
    expect(within(dialog).getByText(/Chinese Yuan \(CNY\)/)).toBeTruthy();
    // The combobox shows the curated option's label for the pre-filled code.
    const field = within(dialog).getByLabelText('Default currency') as HTMLInputElement;
    expect(field.value).toBe('CNY — Chinese Yuan');
    // No timezone field: that key is chosen.
    expect(within(dialog).queryByLabelText('Default timezone')).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(localStorage.getItem(RECORD_KEY)).not.toBeNull();
    expect(settingsCalls('PUT')).toHaveLength(0);
  });

  it('zh: the copy reads in the pack, naming the offer as 人民币（CNY）', async () => {
    renderPrompt(ADMIN, 'zh');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('设置默认货币')).toBeTruthy();
    expect(within(dialog).getByText(/本组织尚未设置默认货币，金额暂不显示币种/)).toBeTruthy();
    expect(within(dialog).getByText(/人民币（CNY）/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '暂不设置' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '设置货币' })).toBeTruthy();
  });

  it('confirm → exactly one PUT carrying the currency alone', async () => {
    renderPrompt(ADMIN);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set currency' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(putBodies()).toEqual([{ currency: 'CNY' }]);
    expect(toastSuccess).toHaveBeenCalledWith('Default currency set to CNY');
  });

  it('an edited currency is the one written', async () => {
    renderPrompt(ADMIN);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Default currency'), { target: { value: 'EUR' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set currency' }));
    await waitFor(() => expect(settingsCalls('PUT')).toHaveLength(1));
    expect(putBodies()).toEqual([{ currency: 'EUR' }]);
  });

  it('decline → no write, and no second prompt when the shell mounts again', async () => {
    const first = renderPrompt(ADMIN);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(settingsCalls('PUT')).toHaveLength(0);
    first.unmount();

    const readsBefore = fetchMock.mock.calls.length;
    renderPrompt(ADMIN);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(readsBefore);
  });

  it('a refused currency lands in its field\'s error slot and the prompt stays open', async () => {
    renderPrompt(ADMIN);
    const dialog = await screen.findByRole('dialog');
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({
        success: false,
        error: {
          code: 'SETTINGS_VALIDATION',
          message: "Settings for 'localization' are invalid: currency",
          details: { fields: [{ field: 'currency', code: 'value_domain', message: 'Not an ISO 4217 code' }] },
        },
      }),
    }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set currency' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByText('Not an ISO 4217 code')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('no browser zone at all: the currency is still asked about', async () => {
    browserZone = undefined;
    served = namespacePayload();
    renderPrompt(ADMIN);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Set the default currency')).toBeTruthy();
    expect(within(dialog).queryByLabelText('Default timezone')).toBeNull();
  });
});

describe('both unset: ONE prompt, one write (objectstack#28872)', () => {
  beforeEach(() => {
    served = namespacePayload();
  });

  it('one dialog carries both fields, each pre-filled from the browser', async () => {
    renderPrompt(ADMIN);
    const dialog = await screen.findByRole('dialog');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog).getByText('Set the system timezone and default currency')).toBeTruthy();
    expect((within(dialog).getByLabelText('Default timezone') as HTMLInputElement).value).toBe(BROWSER_ZONE);
    expect((within(dialog).getByLabelText('Default currency') as HTMLInputElement).value).toBe('CNY — Chinese Yuan');
    expect(within(dialog).getByText(/platform default timezone, UTC\./)).toBeTruthy();
    expect(within(dialog).getByText(/Chinese Yuan \(CNY\)/)).toBeTruthy();
    // Settings read once for both arms.
    expect(settingsCalls('GET')).toHaveLength(1);
  });

  it('confirm → exactly one PUT carrying both keys', async () => {
    renderPrompt(ADMIN);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(putBodies()).toEqual([{ timezone: BROWSER_ZONE, currency: 'CNY' }]);
    expect(toastSuccess).toHaveBeenCalledWith(
      `System timezone set to ${BROWSER_ZONE} and default currency set to CNY`,
    );
  });

  it('a cleared currency field is left unset: the PUT carries the timezone alone', async () => {
    renderPrompt(ADMIN);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Default currency'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(settingsCalls('PUT')).toHaveLength(1));
    expect(putBodies()).toEqual([{ timezone: BROWSER_ZONE }]);
    expect(toastSuccess).toHaveBeenCalledWith(`System timezone set to ${BROWSER_ZONE}`);
  });

  it('decline → no write for either key', async () => {
    renderPrompt(ADMIN);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(settingsCalls('PUT')).toHaveLength(0);
  });
});

describe('a currency with a value, or one this session may not write, is never asked about (objectstack#28872)', () => {
  it.each([
    ['tenant', 'EUR'],
    ['global', 'USD'],
    ['env', 'JPY'],
  ] as const)('%s-sourced currency → no prompt, no write, no record', async (source, value) => {
    served = namespacePayload({ timezone: ['tenant', 'Asia/Shanghai'], currency: [source, value] });
    renderPrompt(ADMIN);
    await waitFor(() => expect(settingsCalls('GET')).toHaveLength(1));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(settingsCalls('PUT')).toHaveLength(0);
    expect(localStorage.getItem(RECORD_KEY)).toBeNull();
  });

  it('a manifest that declares a default currency has one → no prompt', async () => {
    served = namespacePayload({
      timezone: ['tenant', 'Asia/Shanghai'],
      currency: ['default', 'USD'],
      currencySpec: { ...CURRENCY_SPEC, default: 'USD' },
    });
    renderPrompt(ADMIN);
    await waitFor(() => expect(settingsCalls('GET')).toHaveLength(1));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a non-admin (reads settings, lacks the write permission) → no prompt, no namespace read', async () => {
    served = namespacePayload();
    renderPrompt(['setup.access']);
    await waitFor(() => expect(settingsCalls('GET', '/api/settings')).toHaveLength(1));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(settingsCalls('GET')).toHaveLength(0);
    expect(settingsCalls('PUT')).toHaveLength(0);
  });

  it('a browser language with no country region (es-419) offers no currency → no prompt', async () => {
    stubBrowserLanguage(['es-419', 'es']);
    renderPrompt(ADMIN);
    await waitFor(() => expect(settingsCalls('GET')).toHaveLength(1));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no browser zone and no browser currency → no request at all', async () => {
    browserZone = undefined;
    stubBrowserLanguage(['es-419']);
    served = namespacePayload();
    renderPrompt(ADMIN);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the browser reader and the door predicate (objectstack#28872)', () => {
  it('browserLanguage reads the FIRST preference only; browserCurrency maps it through the spec table', () => {
    expect(browserLanguage()).toBe('zh-CN');
    expect(browserCurrency()).toBe('CNY');
    stubBrowserLanguage(['es-419', 'es']);
    expect(browserLanguage()).toBe('es-419');
    expect(browserCurrency()).toBeUndefined();
    stubBrowserLanguage(['ja']);
    expect(browserCurrency()).toBe('JPY');
  });

  it('isAdmissibleValue: the iso_4217_currency domain decides, not the curated options', () => {
    expect(isAdmissibleValue(CURRENCY_SPEC, 'JPY')).toBe(true);
    expect(isAdmissibleValue(CURRENCY_SPEC, 'XXX')).toBe(false);
    const closed: Specifier = { ...CURRENCY_SPEC, valueDomain: undefined };
    expect(isAdmissibleValue(closed, 'CNY')).toBe(true);
    expect(isAdmissibleValue(closed, 'JPY')).toBe(false);
  });
});
