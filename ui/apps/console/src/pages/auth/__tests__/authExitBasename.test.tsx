/**
 * The console's full-page auth exits land INSIDE the SPA mount (objectui#4181).
 *
 * ## What was broken
 *
 * `SetupPage` finishes the first-run owner bootstrap with a full-page
 * navigation, twice — the already-signed-in bounce and the success path after
 * `signUp()` + the bootstrap-org rename. Both went to a bare `'/'`.
 * `window.location.assign` bypasses React Router's `basename`, so on a console
 * served under an injected `<base href="/_console/">` (the framework CLI injects
 * one for every embedded deployment) a root-relative `'/'` resolves to the
 * ORIGIN root and drops the brand-new owner outside the SPA — on the first
 * screen after creating their account.
 *
 * `LoginPage` already carried the named fix as a module-private helper. This
 * change lifts it to `utils/consoleBase` and points all three auth surfaces at
 * it, so the pins below come in two flavours:
 *
 *   - **SetupPage** — the fix. Red on the pre-fix source.
 *   - **LoginPage / RegisterPage** — the LIFT is behaviour-neutral. These pin
 *     the existing redirects across the same mounts so "pure lift" is a measured
 *     claim rather than an assertion. (`RegisterPage` had its own byte-identical
 *     copy of the helper, so the lift covered three call sites, not the two the
 *     card assumed.)
 *
 * ## How landing is asserted
 *
 * Not by string equality against the assign argument — that would only restate
 * the implementation, and it cannot express the shipped embeddable build, where
 * the correct target is the RELATIVE `'./'` (see `utils/consoleBase.test.ts`).
 * Each assertion resolves the assign target against the document's base URL,
 * which is the resolution `location.assign` itself performs, and asks whether
 * the result is inside the mount.
 *
 * The mount is configured the way a real deployment configures it: an injected
 * `<base href>` plus the `BASE_URL` Vite baked into that build.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

/** Only `useAuth` is replaced — `LoginForm`/`RegisterForm` stay real. */
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
const { LoginPage } = await import('../LoginPage');
const { RegisterPage } = await import('../RegisterPage');

// ---------------------------------------------------------------------------
// Mount harness
// ---------------------------------------------------------------------------

/**
 * The three configurations the console ships in. `baseUrl` is what Vite bakes
 * into `import.meta.env.BASE_URL`; `href` is what the framework CLI injects.
 */
const MOUNTS = {
  /** `os dev` / a bare standalone deployment. The bug is invisible here. */
  standalone: { href: null, baseUrl: '/', basename: '/', prefix: '' },
  /** The shipped embeddable build (`vite.config.ts` `base: './'`). */
  embedded: { href: '/_console/', baseUrl: './', basename: '/_console', prefix: '/_console' },
  /** A demo build pinned with `VITE_BASE_PATH=/_console/`. */
  pinned: { href: '/_console/', baseUrl: '/_console/', basename: '/_console', prefix: '/_console' },
} as const;

type MountName = keyof typeof MOUNTS;

let baseEl: HTMLBaseElement | null = null;
let assign: ReturnType<typeof vi.fn>;

function mountConsole(name: MountName, at = '/'): (typeof MOUNTS)[MountName] {
  const mount = MOUNTS[name];
  baseEl?.remove();
  baseEl = null;
  if (mount.href) {
    baseEl = document.createElement('base');
    baseEl.setAttribute('href', mount.href);
    document.head.appendChild(baseEl);
  }
  vi.stubEnv('BASE_URL', mount.baseUrl);
  window.history.replaceState({}, '', `${mount.prefix}${at}`);
  return mount;
}

/** The single full-page navigation this render performed. */
async function exitTarget(): Promise<string> {
  await waitFor(() => expect(assign).toHaveBeenCalled());
  return assign.mock.calls[0][0] as string;
}

/** Where that navigation actually lands, per the browser's own resolution. */
function lands(target: string): string {
  return new URL(target, document.baseURI).pathname;
}

beforeEach(() => {
  assign = vi.fn();
  vi.spyOn(window.location, 'assign').mockImplementation(assign as never);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  baseEl?.remove();
  baseEl = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function renderAt(basename: string, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <BrowserRouter basename={basename}>{ui}</BrowserRouter>
    </I18nProvider>,
  );
}

// ---------------------------------------------------------------------------
// SetupPage — THE FIX
// ---------------------------------------------------------------------------

/** `hasOwner` decides whether the wizard renders or bounces. */
function stubBootstrapStatus(hasOwner: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ hasOwner }) })),
  );
}

function setupAuth(overrides: Record<string, unknown> = {}) {
  authState = {
    user: null,
    signUp: vi.fn(async () => undefined),
    refreshOrganizations: vi.fn(async () => [{ id: 'org_1' }]),
    updateOrganization: vi.fn(async () => undefined),
    createOrganization: vi.fn(async () => ({ id: 'org_1' })),
    switchOrganization: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('SetupPage — the first-run owner bootstrap exits into the SPA', () => {
  describe('the success path (after signUp + the bootstrap-org rename)', () => {
    async function completeTheWizard(name: MountName) {
      const mount = mountConsole(name, '/setup');
      stubBootstrapStatus(false);
      setupAuth();
      renderAt(mount.basename, <SetupPage />);

      // The wizard only renders once the bootstrap probe answers.
      const nameField = await screen.findByLabelText('Your name');
      await userEvent.type(nameField, 'Ada');
      await userEvent.type(screen.getByLabelText('Organization name'), 'Acme Inc.');
      await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
      await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2');
      await userEvent.click(screen.getByRole('button', { name: 'Create owner account' }));
      return mount;
    }

    it('THE FIX: lands inside the mount on an embedded console', async () => {
      const mount = await completeTheWizard('embedded');
      const target = await exitTarget();

      expect(lands(target)).toBe('/_console/');
      // The pre-fix spelling — a root-relative '/' — could not satisfy this.
      expect(lands(target).startsWith(mount.prefix)).toBe(true);
    });

    it('THE FIX: lands inside the mount on a pinned-base console', async () => {
      await completeTheWizard('pinned');
      expect(lands(await exitTarget())).toBe('/_console/');
    });

    it('is unchanged on the default `/` mount', async () => {
      await completeTheWizard('standalone');
      const target = await exitTarget();
      expect(target).toBe('/');
      expect(lands(target)).toBe('/');
    });

    it('still renames the bootstrap organization before exiting', async () => {
      await completeTheWizard('embedded');
      await exitTarget();
      // The exit is the LAST step — the rename this page exists to perform
      // must not have been skipped by the redirect change.
      expect(authState.updateOrganization).toHaveBeenCalledWith('org_1', {
        name: 'Acme Inc.',
        slug: 'acme-inc',
      });
      expect(authState.switchOrganization).toHaveBeenCalledWith('org_1');
    });
  });

  describe('the already-signed-in bounce', () => {
    async function bounce(name: MountName) {
      const mount = mountConsole(name, '/setup');
      stubBootstrapStatus(true);
      setupAuth({ user: { id: 'u1' } });
      renderAt(mount.basename, <SetupPage />);
      return mount;
    }

    it('THE FIX: lands inside the mount on an embedded console', async () => {
      await bounce('embedded');
      expect(lands(await exitTarget())).toBe('/_console/');
    });

    it('THE FIX: lands inside the mount on a pinned-base console', async () => {
      await bounce('pinned');
      expect(lands(await exitTarget())).toBe('/_console/');
    });

    it('is unchanged on the default `/` mount', async () => {
      await bounce('standalone');
      expect(await exitTarget()).toBe('/');
    });
  });

  it('stays a FULL-PAGE navigation, not a router navigation', async () => {
    // Load-bearing: ConsoleShell mounts MetadataProvider once auth RESOLVES
    // (not once it authenticates) and re-keys it on `language` alone, so the
    // app list read while nobody was signed in would survive a router
    // navigation and land the new owner in an appless console. See the comment
    // on POST_BOOTSTRAP_EXIT in SetupPage.
    const mount = mountConsole('embedded', '/setup');
    stubBootstrapStatus(true);
    setupAuth({ user: { id: 'u1' } });
    renderAt(mount.basename, <SetupPage />);

    await exitTarget();
    expect(assign).toHaveBeenCalledTimes(1);
    // A router navigation would have changed the SPA's location instead.
    expect(window.location.pathname).toBe('/_console/setup');
  });
});

// ---------------------------------------------------------------------------
// LoginPage / RegisterPage — the LIFT is behaviour-neutral
// ---------------------------------------------------------------------------

function postLoginAuth(overrides: Record<string, unknown> = {}) {
  authState = {
    user: { id: 'u1' },
    isLoading: false,
    organizations: [{ id: 'org_1' }],
    isOrganizationsLoading: false,
    activeOrganization: { id: 'org_1' },
    switchOrganization: vi.fn(async () => undefined),
    getAuthConfig: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe('LoginPage — redirect behaviour is unchanged by the lift', () => {
  it('sends a settled session to the console root, inside the mount', async () => {
    const mount = mountConsole('embedded', '/login');
    postLoginAuth();
    renderAt(mount.basename, <LoginPage />);
    expect(lands(await exitTarget())).toBe('/_console/');
  });

  it('honours a safe ?redirect= target, inside the mount', async () => {
    const mount = mountConsole('embedded', '/login?redirect=%2Fsettings');
    postLoginAuth();
    renderAt(mount.basename, <LoginPage />);
    expect(lands(await exitTarget())).toBe('/_console/settings');
  });

  it('surfaces the org picker when several orgs and no active one', async () => {
    const mount = mountConsole('embedded', '/login');
    postLoginAuth({
      activeOrganization: null,
      organizations: [{ id: 'org_1' }, { id: 'org_2' }],
    });
    renderAt(mount.basename, <LoginPage />);
    expect(lands(await exitTarget())).toBe('/_console/organizations');
  });

  it('leaves a target that names its OWN absolute SPA mount untouched', async () => {
    // The `/_` passthrough branch — re-prefixing would produce
    // `/_console/_studio/apps` and 404.
    const mount = mountConsole('embedded', '/login?redirect=%2F_studio%2Fapps');
    postLoginAuth();
    renderAt(mount.basename, <LoginPage />);
    const target = await exitTarget();
    expect(target).toBe('/_studio/apps');
    expect(lands(target)).toBe('/_studio/apps');
  });

  it('is unchanged on the default `/` mount', async () => {
    const mount = mountConsole('standalone', '/login');
    postLoginAuth();
    renderAt(mount.basename, <LoginPage />);
    expect(await exitTarget()).toBe('/');
  });
});

describe('RegisterPage — redirect behaviour is unchanged by the lift', () => {
  it('sends a settled session to the console root, inside the mount', async () => {
    const mount = mountConsole('embedded', '/register');
    postLoginAuth();
    renderAt(mount.basename, <RegisterPage />);
    expect(lands(await exitTarget())).toBe('/_console/');
  });

  it('is unchanged on the default `/` mount', async () => {
    const mount = mountConsole('standalone', '/register');
    postLoginAuth();
    renderAt(mount.basename, <RegisterPage />);
    expect(await exitTarget()).toBe('/');
  });
});
