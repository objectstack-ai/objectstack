/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11395 — `AppSchemaRenderer`'s mobile tab bar (`mobileNavMode:
 * 'bottom_nav'`) draws its tabs in the sidebar's order, and this file closes the
 * family "the tab bar answers differently from the sidebar".
 *
 * The bar used to flatten the tree in authored position and never read `order`,
 * so two entries written `Zeta` (`order: 2`) then `Ypsilon` (`order: 1`) drew
 * `Ypsilon, Zeta` in the sidebar and `Zeta, Ypsilon` on the bar, and with more
 * than five entries the five-tab cap kept the first five by authored position.
 * The sidebar sorts each level by `order` (the spec: "Sort order within the same
 * level (lower = first)"): the top level and each group's children. The bar now
 * sorts the same levels with the same comparator, `byNavOrder` in the internal
 * `navOrder` module, before it flattens; the guard and the cap run after, so the
 * five tabs are the sidebar's first five drawn entries.
 *
 * ## The enumeration (the family's closure)
 *
 * Every per-entry input the sidebar's render path reads, classified once by
 * reading `NavigationRenderer` and `NavigationItemRenderer` when this card
 * landed. ⚠️ Nothing re-derives this list: a key the sidebar starts reading
 * later is not caught here, so the next card in the family re-reads the render
 * path rather than trusting this header.
 *
 * Shared with the bar (the bar asks the sidebar's own rule):
 *  - `order` — `byNavOrder`, pinned in this file.
 *  - the guard (`visible`, `requiredPermissions`, `requiresObject` /
 *    `requiresService`, a `doc` entry's target, an `action` entry's dispatcher)
 *    — `hasVisibleNavigationItems`, pinned in
 *    `AppSchemaRenderer.mobileTabGuard-11362.test.tsx`.
 *  - `type: 'action'` drawn as a button handing the item to `onAction` — the
 *    same file.
 *  - href, `external` and the lit tab — `resolveHref` and
 *    `resolveActiveNavItem`, pinned in
 *    `AppSchemaRenderer.mobileTabHref-11211.test.tsx`. Neither surface gets a
 *    template context inside `AppSchemaRenderer`.
 *  - label — `resolveNavItemLabel` with the same (absent) `t`, target-label
 *    resolver and locale, pinned in this file.
 *  - icon — `resolveIcon`, pinned in this file.
 *  - `badge` / `badgeVariant` — the bar used to drop them; now drawn with the
 *    same `Badge` and the same variant, pinned in this file.
 *  - drag-reorder — none since objectui#12059: the sidebar's menu reorder is
 *    retired, so the menu, and the bar with it, follows the authored `order`.
 *
 * Deliberately bar-specific, each pinned in this file with its reason:
 *  - `type: 'separator'` — a rule between rows, not a destination: no tab and
 *    no slot.
 *  - `type: 'group'` — a disclosure, not a destination: its label is no tab,
 *    its children are.
 *  - `expanded` / `defaultOpen` — the sidebar's open state for a disclosure
 *    the bar does not have; a collapsed group's children stay reachable in the
 *    sidebar, so they stay on the bar.
 *  - `pinned` with `enablePinning` — the Favorites section is a second path to
 *    entries already in the tree; on the bar it would spend two of five slots
 *    on one destination, so the bar draws each entry once, at its tree place.
 *  - the sidebar's search box (`enableSearch`) — it narrows the sidebar while
 *    the user types in it; the bar has no search box and stays the app's
 *    standing navigation.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { AppSchemaRenderer, type AppSchemaRendererProps } from '../AppSchemaRenderer';

const BASE = '/apps/crm';

const entry = (label: string, order?: number, extra: Partial<NavigationItem> = {}): NavigationItem =>
  ({
    id: `nav_${label.toLowerCase().replace(/\s+/g, '_')}`,
    type: 'object',
    label,
    objectName: label.toLowerCase().replace(/\s+/g, '_'),
    ...(order === undefined ? {} : { order }),
    ...extra,
  }) as NavigationItem;

function renderShell(
  navigation: NavigationItem[],
  props: Partial<Omit<AppSchemaRendererProps, 'schema' | 'children'>> = {},
) {
  const { container } = render(
    <MemoryRouter initialEntries={['/']}>
      <AppSchemaRenderer
        schema={{ type: 'app', name: 'crm', title: 'CRM', navigation }}
        basePath={BASE}
        mobileNavMode="bottom_nav"
        {...props}
      >
        <div />
      </AppSchemaRenderer>
    </MemoryRouter>,
  );
  const bar = () => container.querySelector('[role="navigation"][aria-label="Mobile navigation"]');
  const tabEls = () => {
    const b = bar();
    return b ? Array.from(b.querySelectorAll('a, button')) : [];
  };
  /** Every tab, link or button, in drawn order, by the label it shows. */
  const tabs = () => tabEls().map((el) => el.querySelector('span')?.textContent ?? '');
  const tab = (label: string) => {
    const hit = tabEls().filter((el) => el.querySelector('span')?.textContent === label);
    expect(hit.length).toBeLessThanOrEqual(1);
    return hit[0] ?? null;
  };
  /** The sidebar rows (outside the bar) whose text is one of `labels`, in drawn order. */
  const sidebarOrder = (labels: string[]) =>
    Array.from(container.querySelectorAll('a, button'))
      .filter((el) => !bar()?.contains(el))
      .map((el) => el.querySelector('span')?.textContent ?? el.textContent ?? '')
      .filter((text) => labels.includes(text));
  const sidebarRow = (label: string) => {
    const hit = Array.from(container.querySelectorAll('a, button')).filter(
      (el) => !bar()?.contains(el) && el.querySelector('span')?.textContent === label,
    );
    expect(hit.length).toBeLessThanOrEqual(1);
    return hit[0] ?? null;
  };
  return { container, bar, tabs, tab, sidebarOrder, sidebarRow };
}

describe('objectui#11395 — the tab bar draws its tabs in the sidebar\'s order', () => {
  it('the card\'s table: `Zeta` (`order: 2`) then `Ypsilon` (`order: 1`) draw `Ypsilon, Zeta` on both', () => {
    const { tabs, sidebarOrder } = renderShell([entry('Zeta', 2), entry('Ypsilon', 1)]);
    expect(sidebarOrder(['Zeta', 'Ypsilon'])).toEqual(['Ypsilon', 'Zeta']);
    expect(tabs()).toEqual(['Ypsilon', 'Zeta']);
  });

  it('six entries: `order` decides which five the cap keeps — the sidebar\'s first five', () => {
    const six = [
      entry('Alpha', 6),
      entry('Bravo', 1),
      entry('Charlie', 2),
      entry('Delta', 3),
      entry('Echo', 4),
      entry('Foxtrot', 5),
    ];
    const labels = six.map((e) => e.label as string);
    const { tabs, sidebarOrder } = renderShell(six);
    const drawn = sidebarOrder(labels);
    expect(drawn).toEqual(['Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Alpha']);
    expect(tabs()).toEqual(drawn.slice(0, 5));
  });

  it('control: with no `order` on any entry, both keep authored order and the cap keeps the first five authored', () => {
    const six = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((l) => entry(l));
    const { tabs, sidebarOrder } = renderShell(six);
    expect(sidebarOrder(['One', 'Two', 'Three', 'Four', 'Five', 'Six'])).toEqual([
      'One', 'Two', 'Three', 'Four', 'Five', 'Six',
    ]);
    expect(tabs()).toEqual(['One', 'Two', 'Three', 'Four', 'Five']);
  });

  it('the comparator\'s edges: a missing `order` reads as 0, and a tie keeps authored order, on both', () => {
    const nav = [entry('Xray', 1), entry('Yankee'), entry('Kilo', 1), entry('Zulu', -1)];
    const { tabs, sidebarOrder } = renderShell(nav);
    const drawn = sidebarOrder(['Xray', 'Yankee', 'Kilo', 'Zulu']);
    expect(drawn).toEqual(['Zulu', 'Yankee', 'Xray', 'Kilo']);
    expect(tabs()).toEqual(drawn);
  });

  it('grouped: each level sorts before the bar flattens — groups by their `order`, a group\'s children by theirs', () => {
    const navigation: NavigationItem[] = [
      {
        id: 'grp_service',
        type: 'group',
        label: 'Service',
        order: 2,
        children: [entry('Cases', 2), entry('Calls', 1)],
      },
      {
        id: 'grp_sales',
        type: 'group',
        label: 'Sales',
        order: 1,
        children: [entry('Deals', 3), entry('Leads', 1), entry('Quotes', 2)],
      },
    ];
    const labels = ['Cases', 'Calls', 'Deals', 'Leads', 'Quotes'];
    const { tabs, sidebarOrder } = renderShell(navigation);
    const drawn = sidebarOrder(labels);
    expect(drawn).toEqual(['Leads', 'Quotes', 'Deals', 'Calls', 'Cases']);
    expect(tabs()).toEqual(drawn);
  });
});

/** The `lucide-*` tokens of the first icon in `el`: which glyph it is, not how big. */
const glyph = (el: Element | null) =>
  Array.from(el?.querySelector('svg')?.classList ?? []).filter((c) => c.startsWith('lucide-')).sort().join(' ');

/** The `Badge` inside `el` whose text is `text`, and its variant. */
function badgeIn(el: Element | null, text: string) {
  const hit = el ? Array.from(el.querySelectorAll('div')).filter((d) => d.textContent === text) : [];
  expect(hit.length).toBeLessThanOrEqual(1);
  const b = hit[0];
  if (!b) return null;
  const variant =
    ['primary', 'secondary', 'destructive'].find((v) => b.classList.contains(`bg-${v}`)) ??
    (b.classList.contains('text-foreground') ? 'outline' : 'unknown');
  return { el: b, variant: variant === 'primary' ? 'default' : variant };
}

describe('objectui#11395 — the enumeration: inputs the bar shares with the sidebar', () => {
  it('label: the same `resolveNavItemLabel` answer — an absent label\'s machine name, a keyed label\'s default, a locale map\'s `en`', () => {
    const navigation = [
      { id: 'nav_absent', type: 'object', objectName: 'account' },
      { id: 'nav_keyed', type: 'object', objectName: 'lead', label: { key: 'crm.leads', defaultValue: 'Keyed Leads' } },
      { id: 'nav_map', type: 'object', objectName: 'deal', label: { en: 'Deals', 'zh-CN': '商机' } },
    ] as unknown as NavigationItem[];
    const { tabs, sidebarOrder } = renderShell(navigation);
    const expected = ['account', 'Keyed Leads', 'Deals'];
    expect(sidebarOrder(expected)).toEqual(expected);
    expect(tabs()).toEqual(expected);
  });

  it('icon: the same `resolveIcon` answer — its own default for no icon, the fallback glyph for an unknown name', () => {
    const navigation = [entry('Plain'), entry('Odd', undefined, { icon: 'not-a-lucide-icon-name' })];
    const { tab, sidebarRow } = renderShell(navigation);
    expect(glyph(tab('Plain'))).not.toBe('');
    expect(glyph(tab('Plain'))).toBe(glyph(sidebarRow('Plain')));
    expect(glyph(tab('Odd'))).toBe(glyph(sidebarRow('Odd')));
    // The two inputs give two glyphs, so the equalities above can fail.
    expect(glyph(tab('Plain'))).not.toBe(glyph(tab('Odd')));
  });

  it('`badge` / `badgeVariant`: drawn on the tab when the sidebar row draws them, with the same variant; control: no badge, none drawn', () => {
    const navigation = [
      entry('Reports', undefined, { badge: 'NEW', badgeVariant: 'secondary' }),
      entry('Approvals', undefined, { badge: 3 }),
      entry('Accounts'),
    ];
    const { tab, sidebarRow } = renderShell(navigation);

    const sideNew = badgeIn(sidebarRow('Reports'), 'NEW');
    const tabNew = badgeIn(tab('Reports'), 'NEW');
    expect(sideNew?.variant).toBe('secondary');
    expect(tabNew?.variant).toBe(sideNew?.variant);

    const sideCount = badgeIn(sidebarRow('Approvals'), '3');
    const tabCount = badgeIn(tab('Approvals'), '3');
    expect(sideCount?.variant).toBe('default');
    expect(tabCount?.variant).toBe(sideCount?.variant);

    expect(tab('Accounts')?.querySelectorAll('div')).toHaveLength(0);
    expect(tab('Accounts')?.textContent).toBe('Accounts');
  });
});

describe('objectui#11395 — the enumeration: inputs that are deliberately bar-specific', () => {
  it('`type: \'separator\'`: a rule, not a destination — no tab and no slot under the cap', () => {
    const navigation: NavigationItem[] = [
      entry('One'),
      { id: 'sep_1', type: 'separator' } as NavigationItem,
      entry('Two'),
      entry('Three'),
      entry('Four'),
      entry('Five'),
    ];
    const { tabs, sidebarOrder } = renderShell(navigation);
    const labels = ['One', 'Two', 'Three', 'Four', 'Five'];
    expect(sidebarOrder(labels)).toEqual(labels);
    expect(tabs()).toEqual(labels);
  });

  it('`type: \'group\'`: a disclosure, not a destination — its label is no tab, its children are', () => {
    const navigation: NavigationItem[] = [
      { id: 'grp_sales', type: 'group', label: 'Sales', children: [entry('Deals'), entry('Leads')] },
    ];
    const { tabs, container, bar } = renderShell(navigation);
    const groupTrigger = Array.from(container.querySelectorAll('button')).find(
      (el) => !bar()?.contains(el) && el.textContent === 'Sales',
    );
    expect(groupTrigger).toBeDefined();
    expect(tabs()).toEqual(['Deals', 'Leads']);
  });

  it('`expanded: false`: the sidebar\'s open state, which the bar has no disclosure for — a collapsed group\'s children stay tabs', () => {
    const navigation: NavigationItem[] = [
      { id: 'grp_sales', type: 'group', label: 'Sales', expanded: false, children: [entry('Deals'), entry('Leads')] },
    ];
    const { tabs, sidebarRow, container, bar } = renderShell(navigation);
    // The sidebar holds them behind its closed disclosure, one tap away.
    expect(sidebarRow('Deals')).toBeNull();
    const groupTrigger = Array.from(container.querySelectorAll('button')).find(
      (el) => !bar()?.contains(el) && el.textContent === 'Sales',
    );
    expect(groupTrigger).toBeDefined();
    expect(tabs()).toEqual(['Deals', 'Leads']);
  });

  it('`pinned` with `enablePinning`: the sidebar draws the entry twice (Favorites and the tree), the bar once, at its tree place', () => {
    const navigation = [entry('Accounts'), entry('Deals', undefined, { pinned: true }), entry('Leads')];
    const { tabs, container, bar } = renderShell(navigation, { enablePinning: true, onPinToggle: () => {} });
    const sidebarDeals = Array.from(container.querySelectorAll('a')).filter(
      (el) => !bar()?.contains(el) && el.querySelector('span')?.textContent === 'Deals',
    );
    expect(sidebarDeals).toHaveLength(2);
    expect(tabs()).toEqual(['Accounts', 'Deals', 'Leads']);
  });

  it('the sidebar\'s search box: it narrows the sidebar while the user types; the bar, which has no search box, keeps every tab', () => {
    const navigation = [entry('Accounts'), entry('Deals'), entry('Leads')];
    const { tabs, sidebarOrder, container } = renderShell(navigation, { enableSearch: true });
    const search = container.querySelector('input[aria-label="Search navigation"]');
    expect(search).not.toBeNull();
    fireEvent.change(search!, { target: { value: 'dea' } });
    expect(sidebarOrder(['Accounts', 'Deals', 'Leads'])).toEqual(['Deals']);
    expect(tabs()).toEqual(['Accounts', 'Deals', 'Leads']);
  });
});
