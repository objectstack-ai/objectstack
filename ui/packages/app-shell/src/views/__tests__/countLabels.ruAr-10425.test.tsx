/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10425 — seven more values behind the `count === 1` two-key switch of
 * objectui#10024 and objectui#10242. Six surfaces pick their `…One` key at
 * exactly one and the plain key at every other count:
 *
 * - the list view's record-count bar (`list.recordCount`, `ListView`);
 * - the record picker's count (`lookup.recordCount`, `RecordPickerDialog`);
 * - the activity-feed reaction chip (`detail.reactionCount`, `ReactionPicker`);
 * - the presence stack's accessible name and its overflow badge's tooltip
 *   (`collaboration.presentUserCount` / `moreUserCount`, `PresenceAvatars`);
 * - the full-page search count while browsing (`search.itemsAvailable`,
 *   `SearchResultsPage`).
 *
 * Two slots fit `en`. They do not fit `ru` (one: 1, 21, 31…; few: 2-4…;
 * many: 0, 5-20…) or `ar` (zero, one, two, few 3-10, many 11-99, other 100+).
 *
 * What shipped before this card: the count-not-one half held one noun form. In
 * `ru` `list.recordCount` that was the `many` form, so the bar read
 * `2 записей` at two and `21 записей` at twenty-one. In `ar` it was the 3-10
 * plural (or, on `lookup.recordCount`, the singular), wrong at 2 and from 11 up.
 *
 * ## The repair: the objectui#10024 device, key by key
 *
 * The count-not-one half becomes a count label — a label, a colon, then the
 * number — so no noun has to agree with the number. The `ru` value is the one
 * `ru` `lookup.recordCount` already reads (`Записей: {{count}}`). The `ar`
 * values use the `عدد …: {{count}}` shape of objectui#10242. The singular
 * halves, the key set and the call sites were unchanged then.
 *
 * ## objectui#11445 — the repair this file pins now
 *
 * objectui#11432 let a pack hold every CLDR slot its language selects, so
 * objectui#11445 made each of these keys an i18next count family: the six
 * surfaces pass `count` and i18next picks the slot, so `ru` reads «2 записи» /
 * «21 запись» and `ar` the dual at 2, the plural at 3-10 and the accusative
 * singular at 11-99, rather than a count label. The `…One` siblings left all
 * ten packs. The strings below are those, read from a real render.
 *
 * ## Why this file sits beside the objectui#10242 pin
 *
 * Same defect, same shape (`countLabels.ruAr-10242.test.tsx`), and
 * `@object-ui/app-shell` is the one package that depends on every consumer
 * here, so one file renders each of them for real.
 *
 * ## What this file measures
 *
 * The strings a user reads, from a real render inside a real i18next instance
 * booted in the session's language. `t` is not mocked. `en` and the `ru` values
 * this card does not change are the controls.
 */

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '@object-ui/plugin-list';
import { RecordPickerDialog } from '@object-ui/fields';
import { ReactionPicker } from '@object-ui/plugin-detail';
import { PresenceAvatars, type PresenceUser } from '@object-ui/collaboration';

/** Mutable across cases: the app's nav items, which browse mode counts. */
const app = vi.hoisted(() => ({ navigation: [] as unknown[] }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ appName: 'crm' }),
  // No `?q=`: the page is in its BROWSE branch, the one `itemsAvailable` serves.
  useSearchParams: () => [new URLSearchParams(''), vi.fn()],
  Link: ({
    to,
    children,
    ...rest
  }: { to: unknown; children?: React.ReactNode } & Record<string, unknown>) => (
    <a href={typeof to === 'string' ? to : ''} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // Browse mode queries nothing, so the count on screen is the nav count.
    useRecordSearch: () => ({ results: [], isSearching: false, error: undefined }),
  };
});

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [{ name: 'crm', label: 'CRM', navigation: app.navigation }],
    objects: [],
  }),
}));

vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ find: vi.fn(), searchAll: vi.fn() }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

import { SearchResultsPage } from '../SearchResultsPage';

type Lang = 'en' | 'ru' | 'ar';

afterEach(() => cleanup());

// ListView draws its rows through `object-grid`, which lives in a package this
// file does not load. A stub keeps the grid out of the measurement: only the
// record-count bar below it is read.
let prevObjectGrid: unknown;
beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid as never);
  else ComponentRegistry.unregister('object-grid');
});

function boot(lang: Lang) {
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  // The instance really booted in the language under test; otherwise every
  // string below would be `en` read through `fallbackLng`.
  expect(i18n.language).toBe(lang);
  return i18n;
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));

/** The list view's record-count bar at `count` fetched records. */
async function listBar(lang: Lang, count: number): Promise<string> {
  const dataSource = {
    find: vi.fn(async () => rows(count)),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as never;
  const { findByTestId } = render(
    <I18nProvider instance={boot(lang)}>
      <SchemaRendererProvider dataSource={dataSource}>
        <ListView
          schema={{ type: 'list-view', objectName: 'contacts', viewType: 'grid', fields: ['name'] } as never}
          dataSource={dataSource}
        />
      </SchemaRendererProvider>
    </I18nProvider>,
  );
  const bar = await findByTestId('record-count-bar');
  // The count is the bar's first span; the data-limit warning, when present,
  // is a second one.
  const text = bar.querySelector('span')?.textContent ?? '';
  cleanup();
  return text;
}

/** The record picker's count line at `count` matching records. */
async function pickerCount(lang: Lang, count: number): Promise<string> {
  const dataSource = { find: vi.fn(async () => ({ data: rows(count), total: count })) } as never;
  render(
    <I18nProvider instance={boot(lang)}>
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={dataSource}
        objectName="contacts"
        columns={[{ field: 'name', label: 'Name', type: 'text' }]}
        // One page holds every count below, so no `pageOf` suffix joins the line.
        pageSize={50}
        onSelect={() => {}}
      />
    </I18nProvider>,
  );
  // The dialog renders into a portal on `document.body`.
  const line = await waitFor(() => {
    const span = document.querySelector('[data-testid="record-picker-pagination"] > span');
    expect(span, `${lang} at ${count}: picker count line not found`).not.toBeNull();
    return span as Element;
  });
  const text = line.textContent ?? '';
  cleanup();
  return text;
}

/** The activity-feed reaction chip's accessible name at `count`. */
function reactionChip(lang: Lang, count: number): string {
  const { container } = render(
    <I18nProvider instance={boot(lang)}>
      <ReactionPicker reactions={[{ emoji: '👍', count, reacted: false }]} />
    </I18nProvider>,
  );
  // No `onToggleReaction`, so no add-reaction button: the chip is the only one.
  const chips = container.querySelectorAll('button[aria-label]');
  expect(chips, `${lang} at ${count}: reaction chip not found exactly once`).toHaveLength(1);
  const name = chips[0].getAttribute('aria-label') ?? '';
  cleanup();
  return name;
}

const presentUsers = (n: number): PresenceUser[] =>
  Array.from({ length: n }, (_, i) => ({
    userId: `u${i}`,
    userName: `User ${i}`,
    color: '#888888',
    status: 'active',
    lastActivity: new Date().toISOString(),
  }));

/** The presence stack's accessible name with `count` users present. */
function presenceName(lang: Lang, count: number): string {
  const { container } = render(
    <I18nProvider instance={boot(lang)}>
      <PresenceAvatars users={presentUsers(count)} maxVisible={100} />
    </I18nProvider>,
  );
  const groups = container.querySelectorAll('[role="group"][aria-label]');
  expect(groups, `${lang} at ${count}: presence group not found exactly once`).toHaveLength(1);
  const name = groups[0].getAttribute('aria-label') ?? '';
  cleanup();
  return name;
}

/** The overflow badge's tooltip with `count` users past the visible one. */
function overflowTitle(lang: Lang, count: number): string {
  const { container } = render(
    <I18nProvider instance={boot(lang)}>
      <PresenceAvatars users={presentUsers(count + 1)} maxVisible={1} />
    </I18nProvider>,
  );
  const badges = Array.from(container.querySelectorAll('[title]')).filter(
    (node) => node.textContent === `+${count}`,
  );
  expect(badges, `${lang} at ${count}: overflow badge not found exactly once`).toHaveLength(1);
  const title = badges[0].getAttribute('title') ?? '';
  cleanup();
  return title;
}

const navItems = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    type: 'object',
    objectName: `crm_object_${i}`,
    label: `Object ${i}`,
  }));

/** The full-page search count while browsing `count` searchable nav items. */
function browseCount(lang: Lang, count: number): string {
  app.navigation = navItems(count);
  const { container } = render(
    <I18nProvider instance={boot(lang)}>
      <SearchResultsPage />
    </I18nProvider>,
  );
  // The count line is the one leaf span that carries the number inside words:
  // nav hits read `Object N`, and a group badge holds the bare number.
  const lines = Array.from(container.querySelectorAll('span')).filter((span) => {
    const text = span.textContent ?? '';
    return (
      span.children.length === 0 &&
      text.includes(String(count)) &&
      text !== String(count) &&
      !text.includes('Object')
    );
  });
  expect(lines, `${lang} at ${count}: count line not found exactly once`).toHaveLength(1);
  const text = lines[0].textContent ?? '';
  cleanup();
  return text;
}

type Rows = Partial<Record<Lang, Array<[number, string]>>>;

/**
 * Every string this file expects, at the representative numbers of
 * objectui#10242: `ru` 2 (few), 5 (many) and 21 (one); `ar` 2 (two), 3 (few)
 * and 11 (many). Each is the family slot i18next selects (objectui#11445).
 */
const LIST_BAR: Rows = {
  en: [
    [1, '1 record'],
    [2, '2 records'],
  ],
  ru: [
    [1, '1 запись'],
    [2, '2 записи'],
    [5, '5 записей'],
    [21, '21 запись'],
  ],
  ar: [
    [1, '1 سجل'],
    [2, 'سجلان (2)'],
    [3, '3 سجلات'],
    [11, '11 سجلًا'],
  ],
};

const PICKER: Rows = {
  en: [
    [1, '1 record'],
    [2, '2 records'],
  ],
  ru: [
    [1, '1 запись'],
    [2, '2 записи'],
    [21, '21 запись'],
  ],
  ar: [
    [1, '1 سجل'],
    [2, 'سجلان (2)'],
    [3, '3 سجلات'],
    [11, '11 سجلًا'],
  ],
};

const CHIP: Rows = {
  en: [
    [1, '👍 1 reaction'],
    [2, '👍 2 reactions'],
  ],
  ar: [
    [1, '👍 1 تفاعل'],
    [2, '👍 تفاعلان (2)'],
    [3, '👍 3 تفاعلات'],
    [11, '👍 11 تفاعلًا'],
  ],
};

const PRESENCE: Rows = {
  en: [
    [1, '1 user present'],
    [2, '2 users present'],
  ],
  ru: [
    [1, 'Присутствует 1 пользователь'],
    [2, 'Присутствуют 2 пользователя'],
    [21, 'Присутствует 21 пользователь'],
  ],
  ar: [
    [1, '1 مستخدم متواجد'],
    [2, 'مستخدمان متواجدان (2)'],
    [3, '3 مستخدمين متواجدين'],
    [11, '11 مستخدمًا متواجدًا'],
  ],
};

const OVERFLOW: Rows = {
  en: [
    [1, '1 more user'],
    [2, '2 more users'],
  ],
  ru: [
    [1, 'Ещё 1 пользователь'],
    [2, 'Ещё 2 пользователя'],
    [21, 'Ещё 21 пользователь'],
  ],
  ar: [
    [1, '1 مستخدم آخر'],
    [2, 'مستخدمان آخران (2)'],
    [3, '3 مستخدمين آخرين'],
    [11, '11 مستخدمًا آخر'],
  ],
};

const BROWSE: Rows = {
  en: [
    [1, '1 item available'],
    [2, '2 items available'],
  ],
  ar: [
    [1, '1 عنصر متاح'],
    [2, 'عنصران متاحان (2)'],
    [3, '3 عناصر متاحة'],
    [11, '11 عنصرًا متاحًا'],
  ],
};

const langs = (table: Rows) => Object.keys(table) as Lang[];

describe('count labels read correctly at every CLDR category in ru and ar (objectui#10425)', () => {
  it('the representative counts reach the categories the count-not-one half serves', () => {
    const ru = new Intl.PluralRules('ru');
    const ar = new Intl.PluralRules('ar');
    expect([2, 5, 21].map((n) => ru.select(n))).toEqual(['few', 'many', 'one']);
    expect([2, 3, 11].map((n) => ar.select(n))).toEqual(['two', 'few', 'many']);
  });

  describe.each(langs(LIST_BAR))('list view record-count bar, %s', (lang) => {
    it.each(LIST_BAR[lang]!)('at %i', async (count, line) => {
      expect(await listBar(lang, count)).toBe(line);
    });
  });

  describe.each(langs(PICKER))('record picker count, %s', (lang) => {
    it.each(PICKER[lang]!)('at %i', async (count, line) => {
      expect(await pickerCount(lang, count)).toBe(line);
    });
  });

  describe.each(langs(CHIP))('reaction chip, %s', (lang) => {
    it.each(CHIP[lang]!)('at %i', (count, chip) => {
      expect(reactionChip(lang, count)).toBe(chip);
    });
  });

  describe.each(langs(PRESENCE))('presence stack name, %s', (lang) => {
    it.each(PRESENCE[lang]!)('at %i', (count, name) => {
      expect(presenceName(lang, count)).toBe(name);
    });
  });

  describe.each(langs(OVERFLOW))('presence overflow tooltip, %s', (lang) => {
    it.each(OVERFLOW[lang]!)('at %i', (count, title) => {
      expect(overflowTitle(lang, count)).toBe(title);
    });
  });

  describe.each(langs(BROWSE))('search browse count, %s', (lang) => {
    it.each(BROWSE[lang]!)('at %i', (count, line) => {
      expect(browseCount(lang, count)).toBe(line);
    });
  });

  it('ru no longer binds the many-form noun to a few or one count', async () => {
    // The shipped defect, named as the strings a Russian user read.
    expect(await listBar('ru', 2)).not.toBe('2 записей');
    expect(await listBar('ru', 21)).not.toBe('21 записей');
  });

  it('ar no longer binds one noun form to a dual or an 11+ count', async () => {
    // The shipped defect, named as the strings an Arabic user read.
    expect(await listBar('ar', 2)).not.toBe('2 سجلات');
    expect(await listBar('ar', 11)).not.toBe('11 سجلات');
    expect(await pickerCount('ar', 2)).not.toBe('2 سجل');
    expect(reactionChip('ar', 2)).not.toBe('👍 2 تفاعلات');
    expect(reactionChip('ar', 11)).not.toBe('👍 11 تفاعلات');
    expect(presenceName('ar', 2)).not.toBe('2 مستخدمين متواجدين');
    expect(overflowTitle('ar', 11)).not.toBe('11 مستخدمين آخرين');
    expect(browseCount('ar', 2)).not.toBe('2 عناصر متاحة');
  });

  it('each label is an i18next count family in ru and ar, and its `…One` sibling is gone', () => {
    // The mechanism of the objectui#11445 repair, stated on the pack values: every
    // CLDR slot the language selects is spelled, so i18next — not a `=== 1` key
    // switch in the component — chooses the form.
    const at = (lang: 'ru' | 'ar', dotted: string) =>
      dotted
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], builtInLocales[lang]);
    const KEYS = [
      'list.recordCount',
      'lookup.recordCount',
      'detail.reactionCount',
      'collaboration.presentUserCount',
      'collaboration.moreUserCount',
      'search.itemsAvailable',
    ];
    for (const lang of ['ru', 'ar'] as const) {
      for (const key of KEYS) {
        for (const category of new Intl.PluralRules(lang).resolvedOptions().pluralCategories) {
          expect(at(lang, `${key}_${category}`), `${lang} ${key}_${category}`).toEqual(expect.any(String));
        }
        expect(at(lang, `${key}One`), `${lang} ${key}One`).toBeUndefined();
      }
    }
  });
});
