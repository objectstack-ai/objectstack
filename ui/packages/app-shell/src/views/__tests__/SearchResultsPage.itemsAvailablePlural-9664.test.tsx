/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9664 — the browse branch of the results-count line must read a
 * singular at one searchable item.
 *
 * Before this card the browse branch asked for `search.itemsAvailable` at every
 * count, and `en` has no plural family and had no sibling key, so a viewer with
 * a single searchable nav item read `1 items available` — the shipped default
 * language.
 *
 * objectui#9664 repaired it with a `=== 1` key switch onto a sibling
 * (`search.itemsAvailableOne`). objectui#11445 made both branches i18next count
 * families: the page asks ONE key with `count`, and the `_one` slot is the
 * singular. So the selection measured below is "one key, every count".
 *
 * ⭐ This file measures the SELECTION, through a real render of the page: which
 * key the component asks for, and what the `en` pack then renders. The `t` here
 * resolves against the real `en` catalogue the way i18next does — `key_<category>`
 * for a numeric `count`, then the base key — rather than an inline table, so this
 * cannot go green against a copy of the English that has drifted from the pack.
 * The per-pack values are `searchItemsAvailable-plural-9664.test.ts`'s, in
 * `@object-ui/i18n`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

/** Mutable across cases: the number of searchable nav items the app exposes. */
const app = vi.hoisted(() => ({ navigation: [] as unknown[] }));
/** Every key the component asked `t` for during the last render. */
const asked = vi.hoisted(() => ({ keys: [] as string[] }));
/** The `?q=` the page is mounted with; empty means the BROWSE branch. */
const url = vi.hoisted(() => ({ search: '' }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ appName: 'crm' }),
  useSearchParams: () => [new URLSearchParams(url.search), vi.fn()],
  Link: ({ to, children, ...rest }: any) => (
    <a href={typeof to === 'string' ? to : ''} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const at = (pack: any, dotted: string) =>
    dotted.split('.').reduce((node: any, part: string) => node?.[part], pack);
  return {
    ...actual,
    useObjectTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        asked.keys.push(key);
        // `actual.en` is the shipped catalogue, the same object the app resolves
        // through `fallbackLng`. The lookup is i18next's: a count family's slot
        // for a NUMERIC count first, then the base key. Interpolation is
        // i18next's `{{name}}` spelling.
        const count = options?.count;
        const slot =
          typeof count === 'number' ? at(actual.en, `${key}_${new Intl.PluralRules('en').select(count)}`) : undefined;
        const value = typeof slot === 'string' ? slot : at(actual.en, key);
        if (typeof value !== 'string') return key;
        return value.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) =>
          String(options?.[name] ?? ''),
        );
      },
    }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
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

/** `n` object nav items, which is what the page counts as "searchable". */
const navItems = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    type: 'object',
    objectName: `crm_object_${i}`,
    label: `Object ${i}`,
  }));

describe('SearchResultsPage browse count agrees with its number (objectui#9664)', () => {
  beforeEach(() => {
    asked.keys = [];
    url.search = '';
  });

  it('reads "1 item available" at exactly one searchable item', () => {
    app.navigation = navItems(1);
    render(<SearchResultsPage />);

    expect(screen.getByText('1 item available')).toBeInTheDocument();
    // The defect, named as the string it shipped.
    expect(screen.queryByText('1 items available')).toBeNull();
    // …and the selection that produces it: ONE key with a count, so the
    // singular comes from the family's `_one` slot (objectui#11445), not from a
    // `=== 1` switch onto a sibling.
    expect(asked.keys).toContain('search.itemsAvailable');
    expect(asked.keys).not.toContain('search.itemsAvailableOne');
  });

  it('reads the plural at every other count, zero included', () => {
    app.navigation = navItems(4);
    render(<SearchResultsPage />);

    expect(screen.getByText('4 items available')).toBeInTheDocument();
    expect(asked.keys).toContain('search.itemsAvailable');
    expect(asked.keys).not.toContain('search.itemsAvailableOne');
  });

  it('the query branch is one count family too, and the browse branch stays unevaluated', () => {
    // The adjacent line, converted by objectui#11445 the same way: one key with a
    // count, no `search.resultsCountPlural` sibling.
    app.navigation = navItems(3);
    url.search = 'q=Object 0';
    render(<SearchResultsPage />);

    expect(screen.getByText('1 result for "Object 0"')).toBeInTheDocument();
    expect(asked.keys).toContain('search.resultsCount');
    expect(asked.keys).not.toContain('search.resultsCountPlural');
    // The browse branch is not evaluated at all while a query is present.
    expect(asked.keys).not.toContain('search.itemsAvailable');
    expect(asked.keys).not.toContain('search.itemsAvailableOne');
  });
});
