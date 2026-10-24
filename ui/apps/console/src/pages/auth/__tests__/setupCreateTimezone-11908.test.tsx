/**
 * objectui#11908 — when the first-run wizard CREATES the owner's workspace, the
 * create call carries the creator's browser zone.
 *
 * `SetupPage` normally renames the organization the server bootstrapped at
 * sign-up; it creates one only when no bootstrap organization appears after
 * its four `refreshOrganizations()` attempts. That branch is a workspace
 * creation like the console's create dialog, so it sends `timezone` the same
 * way: the browser's zone, read by `browserTimeZone()`, and no key at all when
 * the browser reports none. `@object-ui/auth` puts the value on the create
 * route's query (`createOrganization-timezone-11908.test.ts` pins the wire).
 *
 * The zone is stubbed at its reader,
 * `Intl.DateTimeFormat.prototype.resolvedOptions`. The poll's 500 ms pauses
 * run on fake `setTimeout` from the submit on, so the branch is reached
 * without waiting in real time.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

let authState: Record<string, unknown>;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => authState,
}));

vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

const { SetupPage } = await import('../SetupPage');

const BROWSER_ZONE = 'Asia/Shanghai';
const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
let browserZone: string | undefined = BROWSER_ZONE;
let zoneReader: MockInstance;
let createOrganization: ReturnType<typeof vi.fn>;

beforeEach(() => {
  browserZone = BROWSER_ZONE;
  zoneReader = vi
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...realResolvedOptions.call(this), timeZone: browserZone as string };
    });
  vi.spyOn(window.location, 'assign').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // A fresh deployment: the bootstrap probe reports no owner, so the wizard renders.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ hasOwner: false }) })),
  );
  createOrganization = vi.fn(async () => ({ id: 'org_new' }));
  authState = {
    user: null,
    signUp: vi.fn(async () => undefined),
    // No bootstrap organization ever appears: the wizard takes the create branch.
    refreshOrganizations: vi.fn(async () => []),
    updateOrganization: vi.fn(async () => undefined),
    createOrganization,
    switchOrganization: vi.fn(async () => undefined),
  };
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Fill the wizard, submit, and run the poll's pauses to the create call. */
async function createThroughTheWizard(arrangeZone?: () => void) {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/setup']}>
        <SetupPage />
      </MemoryRouter>
    </I18nProvider>,
  );
  fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Acme Inc.' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
  arrangeZone?.();
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  const submit = screen.getByRole('button', { name: 'Create owner account' });
  fireEvent.submit(submit.closest('form') as HTMLFormElement);
  await vi.advanceTimersByTimeAsync(2000);
}

describe("SetupPage's create branch sends the creator's browser zone (objectui#11908)", () => {
  it('a browser zone → the create call carries it as timezone, beside name and slug only', async () => {
    await createThroughTheWizard();

    expect(createOrganization).toHaveBeenCalledTimes(1);
    expect(createOrganization.mock.calls[0][0]).toStrictEqual({
      name: 'Acme Inc.',
      slug: 'acme-inc',
      timezone: 'Asia/Shanghai',
    });
    expect(authState.updateOrganization).not.toHaveBeenCalled();
  });

  it.each([
    ['reports no zone', () => { browserZone = undefined; }],
    ['reports an empty zone', () => { browserZone = ''; }],
    ['throws on the read', () => {
      zoneReader.mockImplementation(() => {
        throw new RangeError('no time zone data');
      });
    }],
  ] as const)('control: a browser that %s → no timezone key at all', async (_label, arrange) => {
    await createThroughTheWizard(arrange);

    expect(createOrganization).toHaveBeenCalledTimes(1);
    const sent = createOrganization.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['name', 'slug']);
  });
});
