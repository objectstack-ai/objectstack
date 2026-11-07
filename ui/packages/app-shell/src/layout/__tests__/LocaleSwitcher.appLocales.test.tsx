// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * LocaleSwitcher — the menu is the app's locale list, not a constant
 * (objectui#4039, migrated from objectstack#5418).
 *
 * The switcher used to build its items from a module-level `LANGUAGES` array:
 * exactly the ten codes `@object-ui/i18n` ships packs for, never asking the app
 * which locales it actually has. That failed in both directions at once —
 * an app shipping `th` could not offer it from the console at all, and an app
 * shipping only `en`+`zh` still listed all ten, so picking 日本語 handed the
 * user a half-translated UI its author never opted into.
 *
 * The ruling on the card is INTERSECTION: (the app's `/api/v1/i18n/locales`
 * response) ∩ (what this renderer can resolve — built-in packs,
 * `config.resources`, and anything the dynamic loader can fetch). The hardcoded
 * ten survive only as the offline/no-backend fallback.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

// Passthrough dropdown primitives — the open/close choreography is Radix's
// business; what matters here is which items the menu is built from.
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

import { PLATFORM_LOCALES, PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';
import { LocaleSwitcher, localeLabel } from '../LocaleSwitcher';

/**
 * The eight built-in native names an app shipping only `en`+`zh-Hans` must NOT
 * show: every platform locale table language but English and Chinese, named as
 * the menu names them (from the table's own labels).
 */
const PHANTOM_LABELS = PLATFORM_LOCALE_TAGS
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

describe('LocaleSwitcher — menu composed from the app locale list', () => {
  it('offers an app-shipped locale outside the built-in ten, named by Intl.DisplayNames', async () => {
    mountConsole({ locales: async () => ['en', 'zh-Hans', 'th'] });

    // `th` has no built-in pack and no platform locale table row; CLDR names it.
    await waitFor(() => expect(screen.getByText('ไทย')).toBeInTheDocument());
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('简体中文')).toBeInTheDocument();
  });

  it('offers an app-shipped locale supplied through config.resources', async () => {
    mountConsole({
      locales: async () => ['en', 'th'],
      resources: { th: { common: { save: 'บันทึก' } } },
      loader: false,
    });

    await waitFor(() => expect(screen.getByText('ไทย')).toBeInTheDocument());
    expect(screen.getByText('English')).toBeInTheDocument();
  });

  it('names a regional app locale, capitalized like the built-in labels', async () => {
    mountConsole({ locales: async () => ['en', 'pt-BR'] });

    // The exact CLDR string moves with ICU versions; what this pins is that a
    // regional tag gets a real display name (not the bare code) and that it
    // does not arrive lowercase next to `English`.
    await waitFor(() => expect(screen.queryByText('English')).toBeInTheDocument());
    const item = screen.getByText((text) => text.startsWith('Portugu'));
    expect(item.textContent).not.toBe('pt-BR');
  });

  it('shows ONLY what the app ships — the phantom eight are gone', async () => {
    mountConsole({ locales: async () => ['en', 'zh-Hans'] });

    await waitFor(() => expect(screen.getByText('English')).toBeInTheDocument());
    expect(screen.getByText('简体中文')).toBeInTheDocument();
    for (const phantom of PHANTOM_LABELS) {
      expect(screen.queryByText(phantom)).not.toBeInTheDocument();
    }
  });

  it('falls back to the built-in packs when the endpoint fails', async () => {
    mountConsole({ locales: async () => { throw new Error('ECONNREFUSED'); } });

    // No backend is not "this app ships nothing" — the switcher must stay
    // usable, offering everything this renderer can produce on its own.
    await waitFor(() => expect(screen.getByText('English')).toBeInTheDocument());
    for (const label of BUILT_IN_PACK_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('falls back to the built-in packs when the app answers with nothing usable', async () => {
    mountConsole({ locales: async () => [] });

    await waitFor(() => expect(screen.getByText('English')).toBeInTheDocument());
    expect(screen.getByText('日本語')).toBeInTheDocument();
  });

  it('keeps the built-in native names rather than re-deriving them', async () => {
    mountConsole({ locales: async () => ['ja', 'ar', 'ru'] });

    // Control: the labels the console has always shown are unchanged, and are
    // NOT whatever CLDR would produce for these codes.
    await waitFor(() => expect(screen.getByText('日本語')).toBeInTheDocument());
    expect(screen.getByText('العربية')).toBeInTheDocument();
    expect(screen.getByText('Русский')).toBeInTheDocument();
  });

  it('renders nothing until the app has answered — no flash of the fallback ten', async () => {
    let answer: (codes: string[]) => void = () => {};
    const pending = new Promise<string[]>((resolve) => { answer = resolve; });
    const { container } = mountConsole({ locales: () => pending });

    // In flight: not the ten, not two, nothing at all. The sibling menus in
    // this folder (AppSwitcher, WorkspaceSwitcher) do the same with data they
    // do not have yet.
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('English')).not.toBeInTheDocument();

    answer(['en', 'zh-Hans']);

    await waitFor(() => expect(screen.getByText('English')).toBeInTheDocument());
    expect(screen.queryByText('日本語')).not.toBeInTheDocument();
  });

  it('offers the built-in packs when no locale endpoint is wired at all', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <LocaleSwitcher />
      </I18nProvider>,
    );

    // An app that never wires `loadLocales` keeps exactly today's menu, with
    // no blank frame in front of it.
    expect(screen.getByText('English')).toBeInTheDocument();
    for (const label of BUILT_IN_PACK_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
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
