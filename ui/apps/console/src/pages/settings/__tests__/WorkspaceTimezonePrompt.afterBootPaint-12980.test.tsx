/**
 * objectui#12980, part 3 — the timezone prompt's settings read waits for the
 * console's first paint (`whenBootPainted`). The prompt mounts beside the
 * routes, under the boot splash, and a dialog has nothing to say before the
 * page it sits over has painted.
 *
 *   (a) an administrator who would be asked, the boot splash up: no
 *       `GET /api/settings`, however long the splash is up;
 *   (b) the splash gone and a frame painted: the read goes out and the prompt
 *       opens, exactly as before.
 *
 * The harness is `WorkspaceTimezonePrompt.test.tsx`'s.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
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
import { __resetBootPainted } from '../../../loadLocales';
import type { Specifier } from '../types';

const BROWSER_ZONE = 'Asia/Kolkata';

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


describe('the settings read waits for the first paint (objectui#12980)', () => {
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

  it('(a) asks nothing while the boot splash is up, (b) reads and opens once it is gone', async () => {
    renderPrompt(ADMIN, 'en');
    await act(() => new Promise<void>((r) => setTimeout(r, 80)));
    expect(settingsCalls('GET', '/api/settings')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => {
      splash?.remove();
      splash = null;
    });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(settingsCalls('GET', '/api/settings')).toHaveLength(1);
  });
});
