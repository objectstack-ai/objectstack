/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11299 (Q1 A + Q2) — a navigation entry label written as an inline
 * locale map renders the VIEWER's entry, and the three inert resolver props
 * are gone.
 *
 * Under objectui#11201's ruling B ("a present label renders verbatim"),
 * verbatim for a map means the viewer's entry, not the `en` floor for everyone.
 * The host injects the locale (`NavigationRenderer`'s `locale` prop,
 * `resolveNavItemLabel`'s trailing `locale` argument); this layer hands it to
 * the spec's own `resolveI18nLabel`, so the fallback order for a locale the map
 * has no entry for is that resolver's.
 *
 * ⭐ That last clause is pinned as PARITY, not as a restated order: every
 * (map, locale) row below is asked of `resolveNavItemLabel` and of the spec's
 * `resolveI18nLabel`, and the two answers must be identical. A local copy of
 * the fallback order would pass the literal rows and could still drift from
 * the spec; this table cannot.
 *
 * The retirement is pinned at the type level — the test program
 * (`tsconfig.test.json`) compiles this file, so a re-added prop or argument
 * fails `type-check` at the `@ts-expect-error` lines below.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import {
  NavigationRenderer,
  resolveNavItemLabel,
  type NavigationRendererProps,
  type NavTargetLabelResolver,
} from '../NavigationRenderer';

const ACCOUNTS: I18nLabel = { en: 'Accounts', 'zh-CN': '客户' };

const entry = (label: I18nLabel | undefined): NavigationItem => ({
  id: 'nav_accounts',
  type: 'object',
  objectName: 'account',
  ...(label === undefined ? {} : { label }),
});

function renderNav(items: NavigationItem[], props: Partial<NavigationRendererProps> = {}) {
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer items={items} basePath="/apps/crm" {...props} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('objectui#11299 — resolveNavItemLabel reads a map in the viewer’s locale', () => {
  it('the viewer’s entry: zh-CN reads 客户, en reads Accounts', () => {
    expect(resolveNavItemLabel(entry(ACCOUNTS), undefined, undefined, 'zh-CN')).toBe('客户');
    expect(resolveNavItemLabel(entry(ACCOUNTS), undefined, undefined, 'en')).toBe('Accounts');
  });

  it('no locale handed in ⇒ the resolver’s no-locale default (en), as before', () => {
    expect(resolveNavItemLabel(entry(ACCOUNTS))).toBe('Accounts');
  });

  it('a locale the map lacks falls back to `en`, then `default`, by the spec resolver’s order', () => {
    expect(resolveNavItemLabel(entry(ACCOUNTS), undefined, undefined, 'fr')).toBe('Accounts');
    expect(resolveNavItemLabel(entry({ default: 'Accts', 'zh-CN': '客户' }), undefined, undefined, 'fr')).toBe('Accts');
  });

  // [map, locale] — answered by both functions; equality is the assertion.
  const PARITY: Array<[I18nLabel, string | undefined]> = [
    [ACCOUNTS, 'zh-CN'],
    [ACCOUNTS, 'zh'],
    [ACCOUNTS, 'zh-TW'],
    [ACCOUNTS, 'en-GB'],
    [ACCOUNTS, 'fr'],
    [ACCOUNTS, undefined],
    [ACCOUNTS, ''],
    [{ zh: '客户' }, 'zh-CN'],
    [{ 'zh-CN': '客户' }, 'zh'],
    [{ default: 'Accts', en: 'Accounts' }, 'fr'],
    [{ 'ja-JP': '取引先' }, 'fr'],
    [{}, 'zh-CN'],
  ];

  it.each(PARITY)('PARITY %j in %s: the spec resolver’s own answer', (label, locale) => {
    expect(resolveNavItemLabel(entry(label), undefined, undefined, locale)).toBe(resolveI18nLabel(label, locale) ?? '');
  });

  it('a plain-string label and an absent one are unaffected by the locale', () => {
    const target = vi.fn<NavTargetLabelResolver>(() => 'Customer Accounts');
    expect(resolveNavItemLabel(entry('account'), undefined, target, 'zh-CN')).toBe('account');
    expect(target).not.toHaveBeenCalled();
    expect(resolveNavItemLabel(entry(undefined), undefined, target, 'zh-CN')).toBe('Customer Accounts');
    expect(target).toHaveBeenCalledTimes(1);
  });
});

describe('objectui#11299 — NavigationRenderer renders a map label in its `locale` prop', () => {
  const items: NavigationItem[] = [
    {
      id: 'grp_sales',
      type: 'group',
      label: { en: 'Sales', 'zh-CN': '销售' },
      children: [entry(ACCOUNTS), { id: 'nav_leads', type: 'object', objectName: 'lead', label: 'Leads' }],
    },
    { id: 'nav_sync', type: 'action', actionDef: { actionName: 'sync_now' }, label: { en: 'Sync now', 'zh-CN': '立即同步' } },
  ];

  it('under zh-CN the group heading, the entry and the action read their zh-CN entries', () => {
    const { container } = renderNav(items, { locale: 'zh-CN', onAction: vi.fn() });
    expect(screen.getByText('销售')).toBeTruthy();
    expect(screen.getByRole('link', { name: '客户' }).getAttribute('href')).toBe('/apps/crm/account');
    expect(screen.getByRole('button', { name: '立即同步' })).toBeTruthy();
    expect(screen.queryByText('Accounts')).toBeNull();
    // A plain string is verbatim in every locale.
    expect(screen.getByRole('link', { name: 'Leads' })).toBeTruthy();
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('search matches the text the row shows in that locale', () => {
    renderNav(items, { locale: 'zh-CN', onAction: vi.fn(), searchQuery: '客户' });
    expect(screen.getByRole('link', { name: '客户' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Leads' })).toBeNull();
  });

  it('a pinned map entry reads the same locale under Favorites', () => {
    const pinned: NavigationItem[] = [{ id: 'nav_accounts', type: 'object', objectName: 'account', label: ACCOUNTS, pinned: true }];
    renderNav(pinned, { locale: 'zh-CN', enablePinning: true });
    expect(screen.getAllByRole('link', { name: '客户' })).toHaveLength(2);
  });
});

describe('objectui#11299 — the three inert resolver props and arguments are retired', () => {
  it('NavigationRendererProps no longer declares them, and declares `locale`', () => {
    // @ts-expect-error — retired (objectui#11299)
    type A = NavigationRendererProps['resolveObjectLabel'];
    // @ts-expect-error — retired (objectui#11299)
    type B = NavigationRendererProps['resolveDashboardLabel'];
    // @ts-expect-error — retired (objectui#11299)
    type C = NavigationRendererProps['resolveViewLabel'];
    const locale: NavigationRendererProps['locale'] = 'zh-CN';
    expect(locale).toBe('zh-CN');
    expectTypeless<[A, B, C]>();
  });

  it('resolveNavItemLabel takes (item, t, targetLabel, locale) — the old six-argument call does not compile', () => {
    const echo = (_name: string, fallback: string) => fallback;
    // @ts-expect-error — the 2nd/4th/5th convention-resolver arguments retired (objectui#11299)
    resolveNavItemLabel(entry('account'), echo, undefined, echo, echo, undefined);
    expect(resolveNavItemLabel.length).toBe(4);
  });
});

/** Uses the type aliases above so the `@ts-expect-error` lines are not unused-symbol noise. */
function expectTypeless<_T>(): void {}
