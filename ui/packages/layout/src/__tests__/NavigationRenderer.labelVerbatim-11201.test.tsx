/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11201 (ruling B, stage 2) — a PRESENT navigation label renders as
 * authored, with no exception, and a present inline locale map renders its
 * locale's entry.
 *
 * The spec states one order for a nav entry's text (`BaseNavItemSchema.label`,
 * objectstack#20849): the id-keyed bundle entry (applied upstream, at `/meta`),
 * else the present label — its locale map's value, else its text — else, when
 * the label is absent, the target's current label. Until this card the
 * renderer kept a rule of its own on top: a present plain-string label whose
 * text equalled its target's machine name was looked up through the object /
 * view / dashboard i18n resolvers. Ruling B retired it, so:
 *
 *  1. VERBATIM — a present label equal to its target's machine name renders
 *     that name, under `en` and under `zh-CN`, with the console's target
 *     resolver and locale wired exactly as `UnifiedSidebar` wires them. The
 *     absent-label control in the same tree shows the wiring is live: it
 *     localizes in each locale. (The three convention resolvers this row used
 *     to wire, and assert unasked, retired from the renderer's props in
 *     objectui#11299; `NavigationRenderer.labelLocaleMap-11299.test.tsx` pins
 *     them gone from the public type.)
 *  2. MAP — a present map-valued label renders its locale's entry, through the
 *     spec's own `resolveI18nLabel`. The rows here hand the renderer NO locale
 *     (a host that passes none), so the locale it reads is that resolver's
 *     documented no-locale default, `en`; objectui#11299 threads the viewer's
 *     locale, and `NavigationRenderer.labelLocaleMap-11299.test.tsx` holds
 *     those rows. It never renders empty, and never `[object Object]`.
 *  3. ABSENT — inherits and localizes; `NavigationRenderer.labelInheritsTarget-9868.test.tsx`
 *     holds those pins, and row 1's control repeats the one that matters here.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import {
  NavigationRenderer,
  resolveNavItemLabel,
  type NavLabelTarget,
  type NavTargetLabelResolver,
} from '../NavigationRenderer';

/**
 * Two console locales: the translation bundle (keyed by machine name, the way
 * `useObjectLabel` reads it) and the metadata labels a target resolver reads.
 * Every translation differs from its machine name, so a translated row cannot
 * pass for a verbatim one.
 */
const BUNDLES = {
  en: {
    objects: { account: 'Customer Accounts', contact: 'Contacts' },
    views: { 'account.board': 'Account Board' },
    dashboards: { sales_overview: 'Sales Overview' },
  },
  'zh-CN': {
    objects: { account: '客户', contact: '联系人' },
    views: { 'account.board': '客户看板' },
    dashboards: { sales_overview: '销售概览' },
  },
} as const;

type Locale = keyof typeof BUNDLES;

/**
 * The renderer's label inputs as the console passes them in one locale: the
 * target resolver (`useNavTargetLabel`, which answers the target's localized
 * name) and the viewer's locale (`useObjectTranslation().language`).
 */
function consoleWiring(locale: Locale) {
  const b = BUNDLES[locale];
  const resolveTargetLabel = vi.fn<NavTargetLabelResolver>((target: NavLabelTarget) => {
    switch (target.kind) {
      case 'object':
        return (b.objects as Record<string, string>)[target.objectName];
      case 'view':
        return (b.views as Record<string, string>)[`${target.objectName}.${target.viewName}`];
      case 'dashboard':
        return (b.dashboards as Record<string, string>)[target.dashboardName];
    }
  });
  return { resolveTargetLabel, locale };
}

function renderNav(items: NavigationItem[], props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer items={items} basePath="/apps/crm" {...props} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

/** Each entry's present label IS its target's machine name. */
const MACHINE_NAMED: NavigationItem[] = [
  { id: 'nav_account', type: 'object', objectName: 'account', label: 'account' },
  { id: 'nav_board', type: 'object', objectName: 'account', viewName: 'board', label: 'board' },
  { id: 'nav_sales', type: 'dashboard', dashboardName: 'sales_overview', label: 'sales_overview' },
];

/** The control: no label, so it inherits its target's localized name. */
const UNLABELLED: NavigationItem = { id: 'nav_contact', type: 'object', objectName: 'contact' };

describe('objectui#11201 — a present label equal to its target’s machine name renders verbatim', () => {
  it.each<Locale>(['en', 'zh-CN'])('in the sidebar, under %s, with the console’s target resolver and locale wired', (locale) => {
    const wiring = consoleWiring(locale);
    renderNav([...MACHINE_NAMED, UNLABELLED], wiring);

    expect(screen.getByRole('link', { name: 'account' }).getAttribute('href')).toBe('/apps/crm/account');
    expect(screen.getByRole('link', { name: 'board' }).getAttribute('href')).toBe('/apps/crm/account/view/board');
    expect(screen.getByRole('link', { name: 'sales_overview' })).toBeTruthy();
    const b = BUNDLES[locale];
    expect(screen.queryByText(b.objects.account)).toBeNull();
    expect(screen.queryByText(b.views['account.board'])).toBeNull();
    expect(screen.queryByText(b.dashboards.sales_overview)).toBeNull();
    // The target resolver is asked about the unlabelled entry only.
    expect(wiring.resolveTargetLabel.mock.calls.every(([target]) => target.kind === 'object' && target.objectName === 'contact')).toBe(true);

    // Control: the absent label inherits, in this locale — the wiring is live.
    expect(screen.getByRole('link', { name: b.objects.contact })).toBeTruthy();
  });

  it.each<Locale>(['en', 'zh-CN'])('resolveNavItemLabel answers the authored text under %s, whatever its case or padding', (locale) => {
    const w = consoleWiring(locale);
    const label = (item: NavigationItem) => resolveNavItemLabel(item, undefined, w.resolveTargetLabel, w.locale);

    // The retired rule compared trimmed, lower-cased text; none of these is
    // a match against anything now.
    expect(label({ id: 'nav_a', type: 'object', objectName: 'account', label: 'ACCOUNT' })).toBe('ACCOUNT');
    expect(label({ id: 'nav_b', type: 'object', objectName: 'account', label: ' account ' })).toBe(' account ');
    expect(label({ id: 'nav_c', type: 'object', objectName: 'account', viewName: 'board', label: 'Board' })).toBe('Board');
    expect(label({ id: 'nav_d', type: 'dashboard', dashboardName: 'sales_overview', label: 'SALES_OVERVIEW' })).toBe('SALES_OVERVIEW');
    // A present label never asks the target.
    expect(w.resolveTargetLabel).not.toHaveBeenCalled();
  });
});

/**
 * A map-valued entry label. Until objectui#11299 this was a cast over a
 * declared-type gap (`@object-ui/types` declared a nav entry's `label` as
 * `string`); the type is the spec's `I18nLabel` now, and the helper only keeps
 * the rows below short.
 */
const mapLabelled = (entry: Record<string, unknown>): NavigationItem => entry as unknown as NavigationItem;

const ACCOUNTS_MAP = { en: 'Accounts', 'zh-CN': '客户' };

describe('objectui#11201 — a present map-valued entry label renders the locale’s value', () => {
  it('resolveNavItemLabel reads the map through the spec’s resolver, never inheriting', () => {
    const target = vi.fn<NavTargetLabelResolver>(() => 'Customer Accounts');
    const label = (entry: Record<string, unknown>) =>
      resolveNavItemLabel(mapLabelled(entry), undefined, target);

    // No locale is handed in: the resolver's default, `en`.
    expect(label({ id: 'nav_acc', type: 'object', objectName: 'account', label: ACCOUNTS_MAP })).toBe('Accounts');
    // A map with no `en` entry still shows its text, by the resolver's own
    // fallback order — not empty, and not the target's label.
    expect(label({ id: 'nav_acc', type: 'object', objectName: 'account', label: { 'zh-CN': '客户' } })).toBe('客户');
    expect(label({ id: 'nav_dash', type: 'dashboard', dashboardName: 'sales_overview', label: { en: 'Pipeline' } })).toBe('Pipeline');
    expect(label({ id: 'grp_sales', type: 'group', label: { en: 'Sales', 'zh-CN': '销售' }, children: [] })).toBe('Sales');
    // A present map is not an absent label: the target is never asked.
    expect(target).not.toHaveBeenCalled();
  });

  it('renders a map-valued entry, group and action in the sidebar, and search finds them by that text', () => {
    const onAction = vi.fn();
    const items = [
      mapLabelled({
        id: 'grp_sales',
        type: 'group',
        label: { en: 'Sales', 'zh-CN': '销售' },
        children: [mapLabelled({ id: 'nav_acc', type: 'object', objectName: 'account', label: ACCOUNTS_MAP })],
      }),
      mapLabelled({ id: 'nav_sync', type: 'action', actionDef: { actionName: 'sync_now' }, label: { en: 'Sync now' } }),
    ];
    const { container, unmount } = renderNav(items, { onAction });

    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Accounts' }).getAttribute('href')).toBe('/apps/crm/account');
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy();
    expect(container.innerHTML).not.toContain('[object Object]');
    unmount();

    renderNav(items, { onAction, searchQuery: 'accou' });
    expect(screen.getByRole('link', { name: 'Accounts' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
  });
});
