/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36955 — every result type the full search page can emit has a
 * group heading (`search.type<Type>s`) and a badge (`search.badge<Type>`) in
 * every shipped locale pack.
 *
 * The page derives both keys from the nav item's `type` at render time, so a
 * type the packs do not name prints its raw key. Component and doc items did
 * exactly that (`search.typeComponents`, `search.badgeDoc`, …) while objects,
 * dashboards, pages and reports were translated.
 *
 * ⭐ Neither the type list nor the key list is written down here. The types come
 * from the spec's nav-item discriminator (`NavigationItemTypeSchema`, read off
 * `@objectstack/spec`); the page is rendered with one item of EVERY type, each
 * carrying every target field, and the page itself decides which survive (its
 * `resolveHref` drops the ones that link nowhere). The keys are the ones the
 * page then asks `t` for. A new nav type that the page lists, or a new key
 * derivation, is measured without an edit to this file.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { NavigationItemTypeSchema } from '@object-ui/types/zod';
import { builtInLocales } from '@object-ui/i18n/locales';

/** Every key the component asked `t` for during the render. */
const asked = vi.hoisted(() => ({ keys: [] as string[] }));
const app = vi.hoisted(() => ({ navigation: [] as unknown[] }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ appName: 'crm' }),
  useSearchParams: () => [new URLSearchParams(''), vi.fn()],
  Link: ({ to, children, ...rest }: any) => (
    <a href={typeof to === 'string' ? to : ''} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useObjectTranslation: () => ({
      t: (key: string) => {
        asked.keys.push(key);
        return key;
      },
      language: 'en',
    }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordSearch: () => ({ results: [], isSearching: false, error: undefined }),
}));

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

const SPEC_NAV_TYPES = NavigationItemTypeSchema.options as readonly string[];

/**
 * One item per spec nav type, each carrying every target field any type reads,
 * so whether it is listed is the page's own decision, not this fixture's.
 */
const everyTypeNavigation = () =>
  SPEC_NAV_TYPES.map((type) => ({
    id: `nav_${type}`,
    type,
    label: `Item ${type}`,
    objectName: 'crm_account',
    dashboardName: 'crm_overview',
    pageName: 'crm_home',
    reportName: 'crm_pipeline',
    url: 'https://example.com/help',
    componentRef: 'approvals:inbox',
    book: 'service_manual',
    doc: 'getting_started',
    actionDef: { actionName: 'crm_refresh' },
    children: [],
  }));

const lookup = (pack: unknown, dotted: string): unknown =>
  dotted.split('.').reduce<any>((node, part) => node?.[part], pack);

/** The packs that carry the page's `search` block — every shipped one today. */
const searchPacks = Object.entries(builtInLocales).filter(
  ([, pack]) => typeof lookup(pack, 'search') === 'object',
);

describe('SearchResultsPage result-type keys exist in every locale pack (objectstack#36955)', () => {
  asked.keys = [];
  app.navigation = everyTypeNavigation();
  render(<SearchResultsPage />);
  const headingKeys = [...new Set(asked.keys.filter((k) => /^search\.type\p{Lu}/u.test(k)))];
  const badgeKeys = [...new Set(asked.keys.filter((k) => /^search\.badge\p{Lu}/u.test(k)))];

  it('measures something: the page lists component and doc items among its groups', () => {
    // Non-vacuity: the render really produced groups, including the two types
    // whose keys were missing.
    expect(searchPacks.length).toBe(Object.keys(builtInLocales).length);
    expect(headingKeys).toEqual(expect.arrayContaining(['search.typeComponents', 'search.typeDocs']));
    expect(badgeKeys).toEqual(expect.arrayContaining(['search.badgeComponent', 'search.badgeDoc']));
    expect(headingKeys.length).toBe(badgeKeys.length);
  });

  it.each(searchPacks.map(([tag]) => tag))('%s names every heading and badge the page asks for', (tag) => {
    const pack = builtInLocales[tag as keyof typeof builtInLocales];
    const missing = [...headingKeys, ...badgeKeys].filter((key) => {
      const value = lookup(pack, key);
      return typeof value !== 'string' || value.trim() === '';
    });
    expect(missing).toEqual([]);
  });
});
