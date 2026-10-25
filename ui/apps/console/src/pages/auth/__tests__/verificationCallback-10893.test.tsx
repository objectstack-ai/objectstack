/**
 * objectui#10893 — an invitee who registers from an invitation link must be
 * brought back to the invitation by the verification mail.
 *
 * The console kept `?redirect=/accept-invitation/ID` from the login page through
 * `/register` to `/verify-email-prompt`, but the verification mail is built
 * server-side from the sign-up request's `callbackURL`, which nothing sent: the
 * link read `callbackURL=/` and the invitee verified onto the workspace picker.
 *
 * Two console seams feed that value:
 *
 *  - `RegisterPage` → `RegisterForm.verificationCallbackURL` → `signUp`'s 4th
 *    argument (the first mail);
 *  - `VerifyEmailPromptPage` → `sendVerificationEmail`'s 2nd argument (the
 *    "Resend" mail), which forwarded the bare router path and so pointed at the
 *    ORIGIN root, outside the console mount.
 *
 * Both must hand the server a ROOT-relative url inside the mount. The server
 * never sees `<base href>`; better-auth refuses a document-relative `./…` with
 * `403 INVALID_CALLBACK_URL`, failing the whole sign-up. So the embedded mount
 * (whose `withConsoleBase` answer is `./…`) is the case that matters most.
 *
 * Nothing in `@object-ui/auth` is replaced: a real `AuthProvider` over a real
 * `createAuthClient` runs against a stub server, and every assertion reads the
 * REQUEST BODY the server would receive — the value better-auth writes into the
 * mail's link. So the page, the shipped `RegisterForm`, `useAuth`, the provider
 * and the client are all on the path; dropping the value at any hop turns these
 * red.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { AuthProvider, createAuthClient } from '@object-ui/auth';

vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

const { RegisterPage } = await import('../RegisterPage');
const { VerifyEmailPromptPage } = await import('../VerifyEmailPromptPage');

/** The three configurations the console ships in (see authExitBasename.test). */
const MOUNTS = {
  standalone: { href: null, baseUrl: '/', basename: '/', prefix: '' },
  embedded: { href: '/_console/', baseUrl: './', basename: '/_console', prefix: '/_console' },
  pinned: { href: '/_console/', baseUrl: '/_console/', basename: '/_console', prefix: '/_console' },
} as const;
type MountName = keyof typeof MOUNTS;

let baseEl: HTMLBaseElement | null = null;

function mountConsole(name: MountName, at: string) {
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

const AUTH_URL = 'http://localhost/api/v1/auth';
type WireBodies = Record<'signUp' | 'resend', Array<Record<string, unknown>>>;
let wire: WireBodies;

/**
 * A signed-out visitor on a server that gates sign-in on email verification:
 * no session, `/sign-up/email` answers with a null token.
 */
function verificationGatedServer(): typeof fetch {
  wire = { signUp: [], resend: [] };
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/sign-up/email')) {
      wire.signUp.push(JSON.parse(String(init?.body)));
      return json({ user: { id: 'u_new', name: 'Wang Wei', email: 'wangwei@example.com' }, token: null });
    }
    if (url.includes('/send-verification-email')) {
      wire.resend.push(JSON.parse(String(init?.body)));
      return json({ status: true });
    }
    if (url.endsWith('/config')) return json({});
    return json(null);
  }) as typeof fetch;
}

function renderAt(basename: string, ui: React.ReactElement) {
  const client = createAuthClient({ baseURL: AUTH_URL, fetchFn: verificationGatedServer() });
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <AuthProvider authUrl={AUTH_URL} client={client}>
        <BrowserRouter basename={basename}>{ui}</BrowserRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

/** What the server would be asked to redirect to after verification. */
async function signUpCallback(name: MountName, search: string): Promise<unknown> {
  const mount = mountConsole(name, `/register${search}`);
  renderAt(mount.basename, <RegisterPage />);

  await userEvent.type(await screen.findByLabelText('Name'), 'Wang Wei');
  await userEvent.type(screen.getByLabelText('Email'), 'wangwei@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2');
  await userEvent.type(screen.getByLabelText('Confirm Password'), 'hunter2hunter2');
  await userEvent.click(screen.getByRole('button', { name: 'Create Account' }));

  await waitFor(() => expect(wire.signUp).toHaveLength(1));
  expect(wire.signUp[0]).toMatchObject({ name: 'Wang Wei', email: 'wangwei@example.com' });
  return wire.signUp[0].callbackURL;
}

/** A url better-auth accepts as a callbackURL without a trusted-origin list. */
function isRootRelative(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

const INVITE = '?redirect=%2Faccept-invitation%2Finv_1';

beforeEach(() => {
  vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  baseEl?.remove();
  baseEl = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('RegisterPage — the verification mail carries ?redirect= (objectui#10893)', () => {
  it('embedded console: the invitation, root-relative inside the mount', async () => {
    const callback = await signUpCallback('embedded', INVITE);
    expect(callback).toBe('/_console/accept-invitation/inv_1');
    expect(isRootRelative(callback)).toBe(true);
  });

  it('pinned-base console: the invitation, inside the mount', async () => {
    expect(await signUpCallback('pinned', INVITE)).toBe('/_console/accept-invitation/inv_1');
  });

  it('default `/` mount: the invitation route as-is', async () => {
    expect(await signUpCallback('standalone', INVITE)).toBe('/accept-invitation/inv_1');
  });

  it('no ?redirect=: no callbackURL on the wire, so the server default is untouched', async () => {
    expect(await signUpCallback('embedded', '')).toBeUndefined();
    expect(Object.keys(wire.signUp[0])).not.toContain('callbackURL');
  });

  it('an off-site ?redirect= is not forwarded (the server would refuse it and fail sign-up)', async () => {
    expect(await signUpCallback('embedded', '?redirect=%2F%2Fevil.example%2Fx')).toBeUndefined();
  });

  it('still routes to the inbox prompt with the redirect kept', async () => {
    await signUpCallback('embedded', INVITE);
    await waitFor(() => expect(window.location.pathname).toBe('/_console/verify-email-prompt'));
    const sp = new URLSearchParams(window.location.search);
    expect(sp.get('email')).toBe('wangwei@example.com');
    expect(sp.get('redirect')).toBe('/accept-invitation/inv_1');
  });
});

describe('VerifyEmailPromptPage — the resent mail carries ?redirect= too (objectui#10893)', () => {
  async function resendCallback(name: MountName, search: string): Promise<[unknown, unknown]> {
    const mount = mountConsole(name, `/verify-email-prompt${search}`);
    renderAt(mount.basename, <VerifyEmailPromptPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Resend verification email/ }));
    await waitFor(() => expect(wire.resend).toHaveLength(1));
    return [wire.resend[0].email, wire.resend[0].callbackURL];
  }

  it('embedded console: resolves the router path into the mount', async () => {
    const [email, callback] = await resendCallback('embedded', `?email=wangwei%40example.com&${INVITE.slice(1)}`);
    expect(email).toBe('wangwei@example.com');
    // The pre-fix value was the bare router path '/accept-invitation/inv_1',
    // which the server redirected to at the ORIGIN root, outside `/_console`.
    expect(callback).toBe('/_console/accept-invitation/inv_1');
  });

  it('default `/` mount: the invitation route as-is', async () => {
    const [, callback] = await resendCallback('standalone', `?email=wangwei%40example.com&${INVITE.slice(1)}`);
    expect(callback).toBe('/accept-invitation/inv_1');
  });

  it('no ?redirect=: no callbackURL on the wire, so the server default applies', async () => {
    const [, callback] = await resendCallback('embedded', '?email=wangwei%40example.com');
    expect(callback).toBeUndefined();
    expect(Object.keys(wire.resend[0])).not.toContain('callbackURL');
  });
});
