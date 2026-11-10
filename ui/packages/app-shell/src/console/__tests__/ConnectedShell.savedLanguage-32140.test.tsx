/**
 * objectstack#32140 — the console's Home renders in the signed-in user's saved
 * language (`sys_user.locale`) on a browser that holds no language entry yet.
 *
 * The one reader that applies the column to the UI language,
 * `useSignedInUserLocale`, is mounted ONCE, in `ConnectedShellInner`. `/home`
 * and `/apps/:appName/*` sit under one pathless layout route in the console,
 * so one `ConnectedShell` instance stays mounted across the hop between them;
 * the routes below reproduce that shape. The reader sits outside the shell's
 * `key={language}` remount, so neither the hop nor a language switch reads the
 * row again.
 *
 * What is real: `ConnectedShell` and everything it mounts, `I18nProvider`, the
 * reader, the globe menu (`LocaleSwitcher`) and the router. The adapter is a
 * fake that serves the `sys_user` row and the shell's metadata reads; the
 * session is mocked as signed in. The probes stand where Home's page and an
 * app's content render and report the language they render in.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdapterCtx } from '@object-ui/react';
import { I18nProvider, LOCALE_STORAGE_KEY, useObjectTranslation } from '@object-ui/i18n';

/** Mutable session the mocked `useAuth` reads at call time. */
const session = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));

/** The `sys_user` row behind the fake adapter, and every read of it. */
const userRow = vi.hoisted(() => ({ locale: null as string | null, reads: 0 }));

const fakeAdapter = vi.hoisted(() => ({
  clearCache: () => {},
  getObjectSchema: async () => null,
  getClient: () => ({
    meta: {
      getItems: (type: string) => Promise.resolve({ type, items: [] }),
      getItem: () => Promise.resolve({ item: null }),
    },
  }),
  findOne: async (object: string, id: string) => {
    if (object !== 'sys_user') return null;
    userRow.reads += 1;
    return { id, locale: userRow.locale };
  },
  update: async (_object: string, id: string, patch: { locale?: string | null }) => {
    userRow.locale = patch.locale ?? null;
    return { id, locale: userRow.locale };
  },
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: session.user,
    session: null,
    isAuthenticated: Boolean(session.user),
    isLoading: false,
    isAuthEnabled: true,
    error: null,
  }),
  createAuthenticatedFetch: () => globalThis.fetch,
}));

// The adapter is not under test: the shell hands the fake to every
// `useAdapter()` reader through the real context.
vi.mock('../../providers/AdapterProvider', async () => {
  const { useAdapter } = await import('@object-ui/react');
  return {
    AdapterProvider: ({ children }: { children: ReactNode }) => (
      <AdapterCtx.Provider value={fakeAdapter as never}>{children}</AdapterCtx.Provider>
    ),
    useAdapter,
  };
});

// Passthrough dropdown primitives, as `userLocale-10059.test.tsx` treats them:
// the menu's open/close choreography is Radix's business.
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Button: (p: any) => <button {...p} />,
  DropdownMenu: (p: any) => <div>{p.children}</div>,
  DropdownMenuTrigger: (p: any) => <div>{p.children}</div>,
  DropdownMenuContent: (p: any) => <div>{p.children}</div>,
  DropdownMenuItem: ({ onClick, children }: any) => <div onClick={onClick}>{children}</div>,
}));

import { ConnectedShell } from '../ConsoleShell';
import { LocaleSwitcher } from '../../layout/LocaleSwitcher';
import { pickRenderableLocale } from '../../hooks/useUserLocale';

function HomeProbe() {
  const { language } = useObjectTranslation();
  return (
    <div>
      <span data-testid="home-language">{language}</span>
      <Link to="/apps/crm">Open CRM</Link>
      <LocaleSwitcher />
    </div>
  );
}

function AppProbe() {
  const { language } = useObjectTranslation();
  return <span data-testid="app-language">{language}</span>;
}

/** One shell over `/home` and `/apps/:appName/*`, as the console's pathless layout route mounts it. */
function renderConsoleAt(path: string) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <ConnectedShell>
          <Routes>
            <Route path="/home" element={<HomeProbe />} />
            <Route path="/apps/:appName/*" element={<AppProbe />} />
          </Routes>
        </ConnectedShell>
      </MemoryRouter>
    </I18nProvider>,
  );
}

const homeLanguage = () => screen.getByTestId('home-language').textContent;
const offered = () => {
  // The language the reader is expected to land on: the offered spelling of
  // `zh-CN`, decided by the same ladder the reader runs.
  const { offerableLanguages } = latestI18n;
  return pickRenderableLocale('zh-CN', offerableLanguages);
};
let latestI18n: { offerableLanguages: readonly string[] | null } = { offerableLanguages: null };
function I18nSpy() {
  latestI18n = useObjectTranslation() as never;
  return null;
}

/** Let the after-first-paint read and any queued switch settle. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });

beforeEach(() => {
  window.localStorage.clear();
  session.user = { id: 'usr_1', email: 'u@example.com' };
  userRow.locale = null;
  userRow.reads = 0;
});

afterEach(() => {
  cleanup();
});

describe('Home renders in the saved language from an empty storage (objectstack#32140)', () => {
  it('a saved zh-CN turns Home Chinese with nothing in localStorage, and caches it on the device', async () => {
    userRow.locale = 'zh-CN';
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();

    render(<I18nProvider><I18nSpy /></I18nProvider>);
    const expected = offered();
    cleanup();
    expect(expected).toMatch(/^zh/);

    renderConsoleAt('/home');

    await waitFor(() => expect(homeLanguage()).toBe(expected));
    // The device slot now caches the column, so the next boot paints Chinese
    // before any read.
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(expected);
    expect(document.documentElement.lang).toBe(expected);
  });

  it('the Home -> app hop and a language switch read the row once in total', async () => {
    userRow.locale = 'zh-CN';
    renderConsoleAt('/home');
    await waitFor(() => expect(homeLanguage()).toMatch(/^zh/));
    await settle();
    expect(userRow.reads).toBe(1);

    // A switch through the globe menu: the shell relabels under
    // `key={language}`, and the reader sits outside that remount.
    fireEvent.click(screen.getByText('Deutsch'));
    await waitFor(() => expect(homeLanguage()).toBe('de'));
    await settle();
    expect(userRow.reads).toBe(1);
    expect(homeLanguage()).toBe('de');

    // The hop: same shell, so the reader stays mounted and asks nothing.
    fireEvent.click(screen.getByRole('link', { name: 'Open CRM' }));
    await waitFor(() => expect(screen.getByTestId('app-language')).toHaveTextContent('de'));
    await settle();
    expect(userRow.reads).toBe(1);
  });

  it('PRESERVED: an explicit device choice stands when the column is unset', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'ja');
    userRow.locale = null;
    renderConsoleAt('/home');

    await waitFor(() => expect(userRow.reads).toBe(1));
    await settle();
    expect(homeLanguage()).toBe('ja');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ja');
  });

  it('PRESERVED: signed out, nothing is read and the device language stands', async () => {
    session.user = null;
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'ja');
    userRow.locale = 'zh-CN';
    renderConsoleAt('/home');

    await waitFor(() => expect(homeLanguage()).toBe('ja'));
    await settle();
    expect(userRow.reads).toBe(0);
    expect(homeLanguage()).toBe('ja');
  });
});
