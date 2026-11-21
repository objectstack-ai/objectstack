// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * LocaleSwitcher — one language list on the sign-in page and in the app
 * (objectstack#35425, maintainer ruling option A).
 *
 * The menu used to be (the platform locale table) ∩ (the app's
 * `/api/v1/i18n/locales` answer), per ruling F of objectstack#29349
 * (objectstack#30514). The sign-in page has no session to ask the app with,
 * so it listed the whole table, and a language picked there (German, Korean)
 * was missing from the menu after sign-in. Now both list every table
 * language. The app's own list decides only which rows carry the hint that
 * the app's content shows in the default language. Each entry is a table
 * tag with the table's own label, and a code the table does not name (`th`)
 * is still not offered.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nProvider, LOCALE_STORAGE_KEY } from '@object-ui/i18n';

// Passthrough dropdown primitives — the open/close choreography is Radix's
// business; what matters here is which items the menu is built from.
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Button: (p: any) => <button {...p} />,
  DropdownMenu: (p: any) => <div>{p.children}</div>,
  DropdownMenuTrigger: (p: any) => <div>{p.children}</div>,
  DropdownMenuContent: (p: any) => <div>{p.children}</div>,
  DropdownMenuItem: ({ onClick, children }: any) => <div data-row onClick={onClick}>{children}</div>,
}));
vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Globe: () => <span />,
}));

import { PLATFORM_LOCALES, PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';
import { LocaleSwitcher, localeLabel } from '../LocaleSwitcher';

/**
 * Every platform locale table language but English and Chinese, named as the
 * menu names them (from the table's own labels).
 */
const NOT_EN_OR_ZH_LABELS = PLATFORM_LOCALE_TAGS
  .filter((tag) => tag !== 'en' && !tag.startsWith('zh-'))
  .map(localeLabel);

/** Every built-in pack's menu name: one per platform locale table tag. */
const BUILT_IN_PACK_LABELS = PLATFORM_LOCALE_TAGS.map(localeLabel);

/** The console's real wiring: app packs arrive through the dynamic loader. */
function mountConsole(opts: {
  locales?: () => Promise<string[]>;
  resources?: Record<string, Record<string, unknown>>;
  loader?: boolean;
}) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: 'en', detectBrowserLanguage: false, resources: opts.resources }}
      loadLocales={opts.locales}
      loadLanguage={opts.loader === false ? undefined : async () => ({})}
    >
      <LocaleSwitcher />
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

/** The hint a row carries when the app's content is not translated into it. */
const HINT = 'App content shows in the default language';

/** The menu row (the item) a language label sits in. */
function rowOf(label: string): HTMLElement {
  const item = screen.getByText(label).closest('[data-row]');
  if (!(item instanceof HTMLElement)) throw new Error(`no menu row for ${label}`);
  return item;
}

describe('LocaleSwitcher — every table language, the app list marks the hint', () => {
  it('lists all eleven table languages for an app that ships four', async () => {
    mountConsole({ locales: async () => ['en', 'zh-CN', 'ja-JP', 'es-ES'] });

    // HotCRM's declaration. Before objectstack#35425 the menu stopped at
    // these four; the sign-in page listed eleven.
    await waitFor(() => expect(screen.getAllByText(HINT)).toHaveLength(7));
    for (const label of BUILT_IN_PACK_LABELS) expect(screen.getAllByText(label)).toHaveLength(1);
  });

  it('marks exactly the languages the app ships no translation for', async () => {
    mountConsole({ locales: async () => ['en', 'zh-CN', 'ja-JP', 'es-ES'] });

    await waitFor(() => expect(screen.getAllByText(HINT)).toHaveLength(7));
    for (const shipped of ['English', '简体中文', '日本語', 'Español']) {
      expect(rowOf(shipped).textContent, shipped).not.toContain(HINT);
    }
    for (const label of NOT_EN_OR_ZH_LABELS.filter((l) => !['日本語', 'Español'].includes(l))) {
      expect(rowOf(label).textContent, label).toContain(HINT);
    }
  });

  it('keeps a language picked on the sign-in page selectable and ticked after sign-in', async () => {
    // Picked signed out (no app list), then the signed-in page load asks the
    // app, which does not ship German.
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    mountConsole({ locales: async () => ['en', 'zh-CN'] });

    // The hint reads in the interface language: German here.
    await waitFor(() =>
      expect(rowOf('Deutsch').textContent).toContain('App-Inhalte erscheinen in der Standardsprache'),
    );
    expect(rowOf('Deutsch').textContent).toContain('✓');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('de');
  });

  it('marks nothing while the app list is not known: signed out, in flight, failed or empty', async () => {
    let answer: (codes: string[]) => void = () => {};
    const pending = new Promise<string[]>((resolve) => { answer = resolve; });
    mountConsole({ locales: () => pending });

    // In flight: the whole list at once (nothing to wait for), no hint yet.
    for (const label of BUILT_IN_PACK_LABELS) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();

    // Signed out, the console's loader answers `[]` without a request.
    answer([]);
    await Promise.resolve();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    for (const label of BUILT_IN_PACK_LABELS) expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('marks nothing when the endpoint fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mountConsole({ locales: async () => { throw new Error('ECONNREFUSED'); } });

    await waitFor(() => expect(warn).toHaveBeenCalled());
    for (const label of BUILT_IN_PACK_LABELS) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    warn.mockRestore();
  });

  it('marks nothing for an app answer that names no table language', async () => {
    mountConsole({ locales: async () => ['th'] });

    // "I don't know", as an empty answer: a hint on all eleven would claim
    // the app is translated into none of them.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    expect(screen.queryByText('ไทย')).not.toBeInTheDocument();
  });

  it('does not offer an app locale the platform locale table does not name', async () => {
    mountConsole({ locales: async () => ['en', 'zh-Hans', 'th'] });

    // `th` has no Console pack, no Studio catalogue, no platform bundle and no
    // built-in email: offering it would offer an incomplete language.
    await waitFor(() => expect(screen.getAllByText(HINT)).toHaveLength(9));
    expect(screen.queryByText('ไทย')).not.toBeInTheDocument();
  });

  it('does not offer an out-of-table locale supplied through config.resources either', async () => {
    mountConsole({
      locales: async () => ['en', 'th'],
      resources: { th: { common: { save: 'บันทึก' } } },
      loader: false,
    });

    await waitFor(() => expect(screen.getAllByText(HINT)).toHaveLength(10));
    expect(screen.queryByText('ไทย')).not.toBeInTheDocument();
  });

  it('reads stored spellings as table entries: one row each, table labels, not marked', async () => {
    mountConsole({ locales: async () => ['en', 'zh-CN', 'zh-Hans', 'ja-JP'] });

    await waitFor(() => expect(screen.getAllByText(HINT)).toHaveLength(8));
    for (const label of ['English', '简体中文', '日本語']) {
      expect(screen.getAllByText(label)).toHaveLength(1);
      expect(rowOf(label).textContent, label).not.toContain(HINT);
    }
    expect(screen.queryByText('中文（中国）')).not.toBeInTheDocument();
    expect(screen.queryByText('日本語 (日本)')).not.toBeInTheDocument();
  });

  it('ticks the table entry for a session running in a stored spelling', async () => {
    // A choice stored before the table existed: `zh-CN`, served by `zh-Hans`.
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh-CN');
    mountConsole({ locales: async () => ['en', 'zh-CN'] });

    await waitFor(() => expect(screen.getByText('简体中文')).toBeInTheDocument());
    expect(rowOf('简体中文').textContent).toContain('✓');
    expect(rowOf('English').textContent).not.toContain('✓');
  });

  it('keeps the built-in native names rather than re-deriving them', async () => {
    mountConsole({ locales: async () => ['ja', 'ar', 'ru'] });

    // Control: the labels the console has always shown are unchanged, and are
    // NOT whatever CLDR would produce for these codes.
    await waitFor(() => expect(screen.getByText('日本語')).toBeInTheDocument());
    expect(screen.getByText('العربية')).toBeInTheDocument();
    expect(screen.getByText('Русский')).toBeInTheDocument();
  });

  it('offers the table languages, unmarked, when no locale endpoint is wired at all', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <LocaleSwitcher />
      </I18nProvider>,
    );

    for (const label of BUILT_IN_PACK_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });
});

describe('localeLabel — the built-in packs are named by the platform locale table', () => {
  it('names every table tag with its row label', () => {
    for (const row of PLATFORM_LOCALES) {
      expect(localeLabel(row.tag), row.tag).toBe(row.label);
    }
  });

  it('names every table tag with its row label on a runtime without Intl.DisplayNames', () => {
    // The table label must not be whatever the runtime's CLDR happens to say:
    // with the runtime naming nothing, every row still reads its own label.
    const displayNames = Intl.DisplayNames;
    Object.defineProperty(Intl, 'DisplayNames', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    try {
      for (const row of PLATFORM_LOCALES) {
        expect(localeLabel(row.tag), row.tag).toBe(row.label);
      }
      // An app-shipped code still degrades to the bare code, not a crash.
      expect(localeLabel('th')).toBe('th');
    } finally {
      Object.defineProperty(Intl, 'DisplayNames', {
        configurable: true,
        writable: true,
        value: displayNames,
      });
    }
  });

  it('cannot read a label off Object.prototype', () => {
    expect(localeLabel('constructor')).toBe('constructor');
    expect(localeLabel('__proto__')).toBe('__proto__');
  });
});
