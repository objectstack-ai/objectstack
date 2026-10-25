/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The one-time workspace-timezone prompt (objectui#11758) — the gate the
 * objectui#11693 ruling (B2) put on PR #11729.
 *
 * Every pin drives the REAL settings client (`api.ts`) against a stubbed
 * `fetch`, so "exactly one write" counts `PUT /api/settings/localization`
 * requests on the wire rather than calls on a mock, and the capability answer
 * comes from the real `MePermissionsProvider`.
 *
 * The browser's zone is stubbed at its one reader,
 * `Intl.DateTimeFormat.prototype.resolvedOptions`, to a zone that is NOT the
 * default (`Asia/Kolkata` against `UTC`), so a pre-fill that read anything
 * else would show.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

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
import {
  browserTimeZone,
  isAdmissibleZone,
  mayWrite,
  promptRecordKey,
} from '../workspaceTimezonePromptLogic';
import type { Specifier } from '../types';

const BROWSER_ZONE = 'Asia/Kolkata';
const RECORD_KEY = promptRecordKey('org_1', 'u_admin');

/** The manifest's `timezone` row as the server declares it (abridged options). */
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

function localizationManifest(specifiers: Specifier[] = [TIMEZONE_SPEC]) {
  return {
    namespace: 'localization',
    version: 2,
    label: 'Localization',
    scope: 'tenant',
    readPermission: 'setup.access',
    writePermission: 'setup.write',
    specifiers: [{ type: 'group', id: 'region', label: 'Region' }, ...specifiers],
  };
}

type Source = 'env' | 'global' | 'tenant' | 'user' | 'default';

/** `GET /api/settings/localization` with `timezone` resolved from `source`. */
function namespacePayload(source: Source, value = 'UTC', specifiers?: Specifier[]) {
  const locked = source === 'env';
  return {
    manifest: localizationManifest(specifiers),
    values: {
      timezone: {
        value,
        source,
        locked,
        cascadeChain:
          source === 'default'
            ? [{ scope: 'default', value: 'UTC', effective: true }]
            : [
                { scope: source, value, locked, effective: true },
                { scope: 'default', value: 'UTC' },
              ],
      },
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
let served = namespacePayload('default');

function routeFetch() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/settings' && method === 'GET') {
      return ok({ manifests: [served.manifest] });
    }
    if (url === '/api/settings/localization' && method === 'GET') return ok(served);
    if (url === '/api/settings/localization' && method === 'PUT') {
      const body = JSON.parse(String(init?.body));
      return ok({ values: { timezone: { value: body.timezone, source: 'tenant', locked: false } } });
    }
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) } as unknown as Response;
  });
}

const settingsCalls = (method: string, url = '/api/settings/localization') =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method);

function permissionsPayload(systemPermissions: string[] | undefined): MePermissionsResponse {
  const base: MePermissionsResponse = {
    authenticated: true,
    userId: 'u_admin',
    tenantId: 'org_1',
    roles: [],
    permissionSets: [],
    objects: {},
    fields: {},
  };
  return systemPermissions === undefined ? base : { ...base, systemPermissions };
}

const ADMIN = ['manage_org_users', 'setup.access', 'setup.write'];

/**
 * No default for `systemPermissions`: a default parameter would turn the
 * "not reported" case (`undefined`) into the admin set without a word.
 */
function renderPrompt(systemPermissions: string[] | undefined, language = 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <MePermissionsProvider initialPermissions={permissionsPayload(systemPermissions)}>
        <WorkspaceTimezonePrompt />
      </MePermissionsProvider>
    </I18nProvider>,
  );
}

/** Let the decision's request chain settle, then nothing more is pending. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

let browserZone: string | undefined = BROWSER_ZONE;
const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

beforeEach(() => {
  fetchMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  localStorage.clear();
  served = namespacePayload('default');
  browserZone = BROWSER_ZONE;
  vi.stubGlobal('fetch', fetchMock);
  routeFetch();
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...realResolvedOptions.call(this), timeZone: browserZone as string };
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('asks once while the zone is the default and the session may write it (objectui#11758)', () => {
  it('en: renders once, pre-filled with the browser zone, naming the current default', async () => {
    renderPrompt(ADMIN, 'en');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Set the system timezone')).toBeTruthy();
    expect(within(dialog).getByText(/platform default timezone, UTC\./)).toBeTruthy();
    // The Settings page's own field for the key, pre-filled with the browser's zone.
    const field = within(dialog).getByLabelText('Default timezone') as HTMLInputElement;
    expect(field.value).toBe(BROWSER_ZONE);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    // Asked and recorded, nothing written.
    expect(localStorage.getItem(RECORD_KEY)).not.toBeNull();
    expect(settingsCalls('PUT')).toHaveLength(0);
  });

  it('zh-CN: the same prompt reads in the pack, pre-filled the same way', async () => {
    renderPrompt(ADMIN, 'zh');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('设置系统时区')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '保持默认' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '设置时区' })).toBeTruthy();
    expect(screen.queryByText('Set the system timezone')).toBeNull();
    // An input carrying a suggestion `list` is a combobox to assistive tech.
    expect((within(dialog).getByRole('combobox') as HTMLInputElement).value).toBe(BROWSER_ZONE);
  });
});

describe('a chosen zone is never asked about (objectui#11758)', () => {
  it.each([
    ['tenant', 'Europe/Paris'],
    ['global', 'America/New_York'],
    ['env', 'Asia/Tokyo'],
  ] as const)('%s-sourced timezone → no prompt, no write', async (source, value) => {
    served = namespacePayload(source, value);
    renderPrompt(ADMIN);
    await waitFor(() => expect(settingsCalls('GET')).toHaveLength(1));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(settingsCalls('PUT')).toHaveLength(0);
    // Not asked, so nothing recorded: the record means "this admin was asked".
    expect(localStorage.getItem(RECORD_KEY)).toBeNull();
  });
});

describe('a session that may not write settings is never asked (objectui#11758)', () => {
  it('reads settings but lacks the manifest writePermission → no prompt, no write', async () => {
    renderPrompt(['setup.access']);
    await waitFor(() => expect(settingsCalls('GET', '/api/settings')).toHaveLength(1));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(settingsCalls('PUT')).toHaveLength(0);
    // It never read the namespace either: the list already answered "may not write".
    expect(settingsCalls('GET')).toHaveLength(0);
  });

  it.each([
    ['not reported', undefined],
    ['reported empty', [] as string[]],
  ])('capabilities %s → no prompt, no request at all', async (_label, systemPermissions) => {
    renderPrompt(systemPermissions);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('confirm writes once through the Settings write path; decline writes nothing (objectui#11758)', () => {
  it('confirm → exactly one PUT /api/settings/localization carrying the chosen zone', async () => {
    renderPrompt(ADMIN);
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText('Default timezone');
    fireEvent.change(field, { target: { value: 'Europe/Berlin' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set timezone' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const puts = settingsCalls('PUT');
    expect(puts).toHaveLength(1);
    expect(JSON.parse(String((puts[0][1] as RequestInit).body))).toEqual({ timezone: 'Europe/Berlin' });
    expect(toastSuccess).toHaveBeenCalledWith('System timezone set to Europe/Berlin');
  });

  it('confirm without editing writes the pre-filled browser zone', async () => {
    renderPrompt(ADMIN);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set timezone' }));
    await waitFor(() => expect(settingsCalls('PUT')).toHaveLength(1));
    expect(JSON.parse(String((settingsCalls('PUT')[0][1] as RequestInit).body))).toEqual({
      timezone: BROWSER_ZONE,
    });
  });

  it('decline → no write, and no second prompt when the shell mounts again', async () => {
    const first = renderPrompt(ADMIN);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep the default' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(settingsCalls('PUT')).toHaveLength(0);
    first.unmount();

    const readsBefore = fetchMock.mock.calls.length;
    renderPrompt(ADMIN);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Recorded as asked, so the second mount does not even read the settings.
    expect(fetchMock.mock.calls.length).toBe(readsBefore);
    expect(settingsCalls('PUT')).toHaveLength(0);
  });

  it('Escape is a decline too: no write', async () => {
    renderPrompt(ADMIN);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(settingsCalls('PUT')).toHaveLength(0);
  });

  it('a refused zone lands in the field error slot and the prompt stays open', async () => {
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
          message: "Settings for 'localization' are invalid: timezone",
          details: { fields: [{ field: 'timezone', code: 'value_domain', message: 'Not an IANA time zone' }] },
        },
      }),
    }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set timezone' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByText('Not an IANA time zone')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('a browser zone the door would refuse is never offered (objectui#11758)', () => {
  it('ICU "Etc/Unknown" → no prompt', async () => {
    browserZone = 'Etc/Unknown';
    renderPrompt(ADMIN);
    await waitFor(() => expect(settingsCalls('GET')).toHaveLength(1));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no browser zone at all → no prompt and no request', async () => {
    browserZone = undefined;
    renderPrompt(ADMIN);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('isAdmissibleZone: the declared domain decides; without one, the options table does', () => {
    expect(isAdmissibleZone(TIMEZONE_SPEC, 'Asia/Kolkata')).toBe(true);
    expect(isAdmissibleZone(TIMEZONE_SPEC, 'Etc/Unknown')).toBe(false);
    expect(isAdmissibleZone(TIMEZONE_SPEC, 'Mars/Olympus')).toBe(false);
    const closed: Specifier = { ...TIMEZONE_SPEC, valueDomain: undefined };
    expect(isAdmissibleZone(closed, 'Asia/Shanghai')).toBe(true);
    expect(isAdmissibleZone(closed, 'Asia/Kolkata')).toBe(false);
  });

  it('browserTimeZone reads the stubbed reader and refuses an empty answer', () => {
    expect(browserTimeZone()).toBe(BROWSER_ZONE);
    browserZone = '';
    expect(browserTimeZone()).toBeUndefined();
  });

  it('mayWrite fails closed on an unreported answer and on an undeclared write permission', () => {
    expect(mayWrite({ writePermission: 'setup.write' }, ADMIN)).toBe(true);
    expect(mayWrite({ writePermission: 'setup.write' }, ['setup.access'])).toBe(false);
    expect(mayWrite({ writePermission: 'setup.write' }, undefined)).toBe(false);
    expect(mayWrite({ writePermission: undefined }, ADMIN)).toBe(false);
  });
});
