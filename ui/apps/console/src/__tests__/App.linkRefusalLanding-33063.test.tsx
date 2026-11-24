// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#33063 — a signed-in person whose link of another sign-in was
 * refused because the emails differ is told so on the page they land on.
 *
 * The callback refuses the link (better-auth `email_does_not_match`) and
 * redirects to the console's error URL, the login page:
 * `/login?error=email_does_not_match`. The person is still signed in, so the
 * login page never draws its form; its post-login step sends them on to the
 * console with a full navigation. The reason has to go with them.
 *
 * ## What is real here
 *
 * Both legs run through `App`'s own route tree: the real `LoginPage` at the
 * error URL, and, at the address it navigated to, the real landing
 * (`ProtectedRoute`, `RootLandingRedirect`) with the real `ConsoleToaster`.
 * The navigation between them is a full page load, so the test takes the URL
 * the login page handed `window.location.assign`, unmounts everything, and
 * opens `App` again at that URL, as the browser would. What survives the load
 * is what the browser keeps for the tab (`sessionStorage`). Auth is a
 * signed-in session in its active organization; the app's own content and
 * Home are stubs.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import '@object-ui/react';
import '@object-ui/app-shell';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };
const USER = { id: 'u1', name: 'Ada', email: 'ada@example.com' };
const APPS = [{ name: 'crm', label: 'CRM', active: true, isDefault: true }];

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return json(body);
    },
  } as unknown as Response;
}

function respond(input: unknown): Promise<Response> {
  const url = String(typeof input === 'object' && input && 'url' in input ? (input as Request).url : input);
  if (url.includes('/api/v1/discovery')) {
    return Promise.resolve(json({
      success: true,
      data: { version: '1.0.0', apiName: 'v1', routes: { data: '/api/v1/data', metadata: '/api/v1/meta' }, services: {} },
    }));
  }
  if (url.includes('/auth/me/permissions')) {
    return Promise.resolve(json({
      authenticated: true, userId: USER.id, tenantId: ORG.id, positions: [], permissionSets: [], objects: {}, fields: {}, hasAnyQueue: false, objectsUsingQueues: [],
    }));
  }
  if (url.includes('/me/apps')) return Promise.resolve(json({ apps: APPS }));
  if (/\/api\/v1\/meta\/app(\?|$)/.test(url)) {
    return Promise.resolve(json({ success: true, data: { type: 'app', items: APPS } }));
  }
  if (url.includes('/api/v1/meta/')) return Promise.resolve(json({ success: true, data: { items: [] } }));
  if (url.includes('/api/v1/data/')) return Promise.resolve(json({ success: true, data: { records: [], total: 0 } }));
  return Promise.resolve(json({ success: true, data: {} }));
}

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AuthProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  AuthGuard: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: USER,
    session: { activeOrganizationId: ORG.id, createdAt: new Date() },
    isAuthenticated: true,
    isLoading: false,
    organizations: [ORG],
    activeOrganization: ORG,
    isOrganizationsLoading: false,
    switchOrganization: () => Promise.resolve(),
    sessionEndedBySignOut: false,
    getAuthConfig: () => Promise.resolve({ features: { multiOrgEnabled: true } }),
  }),
  createAuthenticatedFetch: () => respond,
}));

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DefaultHomeLayout: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DefaultHomePage: () => <div data-testid="home-page" />,
  DefaultAppContent: () => <div data-testid="app-content" />,
}));

vi.mock('../LocalizationFetchProvider', () => ({
  LocalizationFetchProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../pages/settings/FirstRunChecklist', () => ({ FirstRunChecklist: () => null }));
vi.mock('../components/SetupRoute', () => ({ SetupRoute: () => null }));
vi.mock('../components/FormPage', () => ({ FormPage: () => null }));
vi.mock('../components/InternalFormRoute', () => ({ InternalFormRoute: () => null, InAppFormRoute: () => null }));
vi.mock('../components/MetadataHmrReloader', () => ({ MetadataHmrReloader: () => null }));
vi.mock('../components/FaviconSync', () => ({ FaviconSync: () => null }));
vi.mock('../pages/SharedRecordPage', () => ({ default: () => null }));
vi.mock('../dev/DevMasterDetail', () => ({ DevMasterDetail: () => null }));
vi.mock('../dev/DevLists', () => ({ DevLists: () => null }));
vi.mock('../dev/DevModal', () => ({ DevModal: () => null }));
vi.mock('../dev/DevLookup', () => ({ DevLookup: () => null }));
vi.mock('../dev/DevRowActions', () => ({ DevRowActions: () => null }));

import { toast } from 'sonner';
import { App } from '../App';
import { LINK_REFUSAL_STORAGE_KEY } from '../components/LinkRefusalNotice';

const { en, 'zh-Hans': zh } = builtInLocales;
const EN_SENTENCE = en.auth.login.errors.linkEmailMismatch;
const ZH_SENTENCE = zh.auth.login.errors.linkEmailMismatch;

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  assign = vi.fn();
  vi.spyOn(window.location, 'assign').mockImplementation(assign as never);
});
afterEach(async () => {
  // The toaster's store is module-wide: close what a case raised before the next case mounts one.
  await act(async () => {
    toast.dismiss();
    await new Promise((r) => setTimeout(r, 600));
  });
  cleanup();
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
});

/** Let the effects and the answers they await run out (a negative reading needs it). */
async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

function openApp(url: string, language: string) {
  window.history.pushState({}, '', url);
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <App />
    </I18nProvider>,
  );
}

/**
 * Opens the login page at `search`, waits for it to send the signed-in person
 * on, and opens the console again where it sent them: the full page load.
 */
async function arriveSignedIn(search: string, language = 'en'): Promise<string> {
  openApp(`/login${search}`, language);
  await waitFor(() => expect(assign).toHaveBeenCalled(), { timeout: 5000 });
  const landing = new URL(String(assign.mock.calls[0][0]), window.location.href);
  cleanup();
  openApp(`${landing.pathname}${landing.search}`, language);
  await waitFor(() => expect(screen.getByTestId('app-content')).toBeInTheDocument(), { timeout: 5000 });
  return landing.pathname;
}

describe('a signed-in person whose link was refused for an email mismatch is told where they land (objectstack#33063)', () => {
  it('lands on the console as before, and the landing page says why the account was not linked', async () => {
    const landed = await arriveSignedIn('?error=email_does_not_match');
    expect(landed).toBe('/');
    expect(window.location.pathname).toBe('/apps/crm');

    const notice = await screen.findByTestId('link-refusal-notice', undefined, { timeout: 3000 });
    expect(notice.textContent).toBe(EN_SENTENCE);
    // Said once: the slot is empty after it was shown.
    expect(sessionStorage.getItem(LINK_REFUSAL_STORAGE_KEY)).toBeNull();
  });

  it('in the person’s language', async () => {
    expect(ZH_SENTENCE).not.toBe(EN_SENTENCE);
    await arriveSignedIn('?error=email_does_not_match', 'zh-Hans');

    const notice = await screen.findByTestId('link-refusal-notice', undefined, { timeout: 3000 });
    expect(notice.textContent).toBe(ZH_SENTENCE);
  });

  it('CONTROL: with no error, the signed-in person lands as today, with nothing to say', async () => {
    const landed = await arriveSignedIn('');
    expect(landed).toBe('/');
    expect(window.location.pathname).toBe('/apps/crm');
    await settle();
    expect(screen.queryByTestId('link-refusal-notice')).toBeNull();
    expect(sessionStorage.getItem(LINK_REFUSAL_STORAGE_KEY)).toBeNull();
  });

  it('CONTROL: a code with no sentence of its own is not carried, and nothing from the URL is shown', async () => {
    await arriveSignedIn('?error=%3Cimg%20src%3Dx%3E');
    await settle();
    expect(screen.queryByTestId('link-refusal-notice')).toBeNull();
    expect(document.body.innerHTML).not.toContain('<img src="x">');
    expect(sessionStorage.getItem(LINK_REFUSAL_STORAGE_KEY)).toBeNull();
  });
});

/**
 * objectstack#33498 — better-auth's two other refusals of a signed-in link
 * (`linkOAuthAccount`, `oauth2/link-account.mjs`) travel the same way, each
 * with its own sentence: `account_already_linked_to_different_user` (the
 * provider account belongs to another user here) and `unable_to_link_account`
 * (chiefly an untrusted provider that did not assert the email as verified).
 */
describe('the other two link refusals are told where the signed-in person lands (objectstack#33498)', () => {
  const SENTENCES = {
    account_already_linked_to_different_user: {
      en: en.auth.login.errors.linkAlreadyLinkedToOtherUser,
      'zh-Hans': zh.auth.login.errors.linkAlreadyLinkedToOtherUser,
    },
    unable_to_link_account: {
      en: en.auth.login.errors.linkUnableToLink,
      'zh-Hans': zh.auth.login.errors.linkUnableToLink,
    },
    email_does_not_match: { en: EN_SENTENCE, 'zh-Hans': ZH_SENTENCE },
  } as const;

  it('each code has a sentence of its own, in each language', () => {
    for (const language of ['en', 'zh-Hans'] as const) {
      const shown = Object.values(SENTENCES).map((s) => s[language]);
      for (const sentence of shown) expect(typeof sentence).toBe('string');
      expect(new Set(shown).size).toBe(shown.length);
    }
  });

  it.each([
    ['account_already_linked_to_different_user', 'en'],
    ['account_already_linked_to_different_user', 'zh-Hans'],
    ['unable_to_link_account', 'en'],
    ['unable_to_link_account', 'zh-Hans'],
    // CONTROL: the first link refusal keeps its own sentence beside the new ones.
    ['email_does_not_match', 'en'],
    ['email_does_not_match', 'zh-Hans'],
  ] as const)('%s under %s: the landing page shows that code’s sentence, and nothing the URL carried', async (code, language) => {
    const landed = await arriveSignedIn(
      `?error=${code}&error_description=${encodeURIComponent('bob@example.com already owns it')}`,
      language,
    );
    expect(landed).toBe('/');

    const notice = await screen.findByTestId('link-refusal-notice', undefined, { timeout: 3000 });
    expect(notice.textContent).toBe(SENTENCES[code][language]);
    expect(document.body.textContent).not.toContain('bob@example.com');
    expect(sessionStorage.getItem(LINK_REFUSAL_STORAGE_KEY)).toBeNull();
  });

  it('CONTROL: a vendor callback code that is not a link refusal still shows nothing new', async () => {
    const landed = await arriveSignedIn('?error=email_not_found');
    expect(landed).toBe('/');
    await settle();
    expect(screen.queryByTestId('link-refusal-notice')).toBeNull();
    expect(sessionStorage.getItem(LINK_REFUSAL_STORAGE_KEY)).toBeNull();
  });
});
