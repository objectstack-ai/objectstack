/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A signed-in user's language has ONE source of truth: `sys_user.locale`
 * (objectui#10059, ruling batch #193 item 5 letter C on objectui#10051).
 *
 * Every assertion here is one of the card's acceptance pins, and each is
 * written against the OBSERVABLE it names rather than against the call that
 * implements it:
 *
 *   - the language the provider is actually in (`useObjectTranslation`'s
 *     `language`, which is what every consumer renders from), and
 *   - what the column holds afterwards, read back off the adapter the profile
 *     page writes through — never `update` having been called, which a writer
 *     that wrote the wrong value would also satisfy.
 *
 * The device slot is asserted where the ruling demotes it: as a CACHE that the
 * column overwrites, never as a second setting.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { I18nProvider, LOCALE_STORAGE_KEY, useObjectTranslation } from '@object-ui/i18n';
import { notifyDataChanged } from '@object-ui/react';
import { toast } from 'sonner';

/** Mutable session/adapter the mocked hooks read at call time. */
const session = vi.hoisted(() => ({
  user: null as { id: string } | null,
  adapter: null as unknown,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: session.user,
    isAuthenticated: Boolean(session.user),
    isLoading: false,
  }),
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => session.adapter,
}));

// Passthrough dropdown primitives — the open/close choreography is Radix's
// business, exactly as `LocaleSwitcher.persistence.test.tsx` treats it.
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Button: (p: any) => <button {...p} />,
  DropdownMenu: (p: any) => <div>{p.children}</div>,
  DropdownMenuTrigger: (p: any) => <div>{p.children}</div>,
  DropdownMenuContent: (p: any) => <div>{p.children}</div>,
  DropdownMenuItem: ({ onClick, children }: any) => <div onClick={onClick}>{children}</div>,
}));
vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Globe: () => <span />,
}));

import { LocaleSwitcher } from '../../layout/LocaleSwitcher';
import { useSignedInUserLocale, pickRenderableLocale } from '../useUserLocale';

/**
 * The `sys_user` row, behind the two adapter methods both writers use. `update`
 * mutates it, so a test can ask what the COLUMN says rather than what the
 * writer was called with.
 */
function fakeUserAdapter(locale: string | null, opts: { failWrites?: boolean } = {}) {
  const row: { id: string; locale: string | null } = { id: 'usr_1', locale };
  return {
    row,
    findOne: vi.fn(async () => ({ ...row })),
    update: vi.fn(async (_object: string, _id: string, patch: { locale?: string | null }) => {
      if (opts.failWrites) throw new Error('403 field is not writable');
      row.locale = patch.locale ?? null;
      return { ...row };
    }),
  };
}

/** The UI's own answer to "what language am I in", plus the shell's reader. */
function Probe() {
  useSignedInUserLocale();
  const { language } = useObjectTranslation();
  return <span data-testid="language">{language}</span>;
}

function mount() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <Probe />
      <LocaleSwitcher />
    </I18nProvider>,
  );
}

const shownLanguage = () => screen.getByTestId('language').textContent;

beforeEach(() => {
  window.localStorage.clear();
  session.user = null;
  session.adapter = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the signed-in user’s language comes from `sys_user.locale`', () => {
  it('seeds the UI from the column, over a device value that says otherwise', async () => {
    // The device remembers `en` from before; the account says `ja`.
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    const adapter = fakeUserAdapter('ja');
    session.user = { id: 'usr_1' };
    session.adapter = adapter;

    mount();

    await waitFor(() => expect(shownLanguage()).toBe('ja'));
    // …and the device slot is now a CACHE of the column, so the next boot
    // paints `ja` without waiting for the row.
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ja');
  });

  it('leaves the device value alone when the column is unset', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh');
    const adapter = fakeUserAdapter(null);
    session.user = { id: 'usr_1' };
    session.adapter = adapter;

    mount();

    await waitFor(() => expect(adapter.findOne).toHaveBeenCalled());
    // An unset column states nothing about this user, so the device choice
    // keeps deciding — and keeps deciding it stays `zh`.
    expect(shownLanguage()).toBe('zh');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh');
  });

  it('follows the column when the profile page writes it, with no reload', async () => {
    const adapter = fakeUserAdapter(null);
    session.user = { id: 'usr_1' };
    session.adapter = adapter;

    mount();
    await waitFor(() => expect(adapter.findOne).toHaveBeenCalled());
    expect(shownLanguage()).toBe('en');

    // What the profile page's language card does: write the column through the
    // adapter. Every adapter write reaches the invalidation bus in the console
    // (`useMutationInvalidationBridge`); here the bus is driven directly so the
    // pin covers this reader, not the bridge.
    adapter.row.locale = 'de';
    act(() => notifyDataChanged({ objectName: 'sys_user', recordId: 'usr_1' }));

    await waitFor(() => expect(shownLanguage()).toBe('de'));
  });
});

describe('the globe writes the column', () => {
  it('stores the switch on the server and shows it', async () => {
    const adapter = fakeUserAdapter(null);
    session.user = { id: 'usr_1' };
    session.adapter = adapter;

    mount();
    await waitFor(() => expect(adapter.findOne).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Deutsch'));

    await waitFor(() => expect(shownLanguage()).toBe('de'));
    // The column — not the call — is the thing the profile page reads back.
    await waitFor(() => expect(adapter.row.locale).toBe('de'));
  });

  it('reports a failed write loudly and leaves the switch standing', async () => {
    const errors = vi.spyOn(toast, 'error').mockImplementation(() => '' as never);
    const adapter = fakeUserAdapter('en', { failWrites: true });
    session.user = { id: 'usr_1' };
    session.adapter = adapter;

    mount();
    await waitFor(() => expect(adapter.findOne).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Deutsch'));

    // Loud: the user is told. ⛔ Never a silent no-op.
    await waitFor(() => expect(errors).toHaveBeenCalled());
    // And the local switch stands — the column is what did not move.
    expect(shownLanguage()).toBe('de');
    expect(adapter.row.locale).toBe('en');

    // "…until the next successful read": the column is still the decider, so
    // the next read of it takes the UI back. The read answers what it answered
    // the first time, which is precisely the case a value-diff would swallow.
    act(() => notifyDataChanged({ objectName: 'sys_user', recordId: 'usr_1' }));
    await waitFor(() => expect(shownLanguage()).toBe('en'));
  });

  it('stays device-only for a visitor with no `sys_user` row', async () => {
    const adapter = fakeUserAdapter(null);
    // Signed out: an adapter exists (the console mounts one before sign-in),
    // there is simply nobody to write for.
    session.user = null;
    session.adapter = adapter;

    mount();

    fireEvent.click(screen.getByText('中文'));

    await waitFor(() => expect(shownLanguage()).toBe('zh'));
    expect(adapter.update).not.toHaveBeenCalled();
    expect(adapter.findOne).not.toHaveBeenCalled();
    // The device slot is this visitor's own setting, exactly as before.
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh');
  });
});

describe('pickRenderableLocale', () => {
  const offerable = ['en', 'zh', 'ja', 'pt-BR'];

  it('takes the exact tag when the deployment offers it', () => {
    expect(pickRenderableLocale('pt-BR', offerable)).toBe('pt-BR');
  });

  it('falls back to the base language for a region tag', () => {
    // The column holds full BCP-47 (`zh-CN`); the packs are keyed by language.
    expect(pickRenderableLocale('zh-CN', offerable)).toBe('zh');
  });

  it('refuses a tag nothing can render, rather than painting the fallback', () => {
    expect(pickRenderableLocale('th', offerable)).toBeNull();
  });

  it('waits while the deployment’s locale list is still in flight', () => {
    expect(pickRenderableLocale('ja', null)).toBeNull();
  });
});
