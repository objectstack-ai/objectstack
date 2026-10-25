/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9868 — a navigation entry with NO `label` shows its target's CURRENT
 * label, resolved at render time (`@objectstack/spec` 17.5.0; the cloud#2021
 * letter-A ruling).
 *
 * The ladder is the spec's own sentence, walked in its order: the view's label
 * when the entry names a labelled view, else the object's / dashboard's label,
 * else the target's machine name. This layer holds no metadata — the host
 * answers each rung through `resolveTargetLabel` — so these pins drive the
 * resolver directly and assert what the renderer does with each answer.
 *
 * The controls are the point as much as the subject:
 *  - an AUTHORED label is never swapped for the target's label — including one
 *    spelled exactly like the machine name (the refused "sentinel" route B),
 *    and the target resolver is not even consulted for it;
 *  - "rename" is a new resolver answer on the SAME nav tree, with nothing
 *    written anywhere, and the new text shows.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import { AppSchemaRenderer } from '../AppSchemaRenderer';
import {
  NavigationRenderer,
  resolveNavItemLabel,
  filterNavigationItems,
  type NavLabelTarget,
  type NavTargetLabelResolver,
} from '../NavigationRenderer';

/** A metadata world: target labels by kind, as a host's cache would answer them. */
function world(labels: {
  views?: Record<string, string>;
  objects?: Record<string, string>;
  dashboards?: Record<string, string>;
}): NavTargetLabelResolver {
  return (target: NavLabelTarget) => {
    switch (target.kind) {
      case 'view':
        return labels.views?.[`${target.objectName}.${target.viewName}`];
      case 'object':
        return labels.objects?.[target.objectName];
      case 'dashboard':
        return labels.dashboards?.[target.dashboardName];
    }
  };
}

const VIEW_ENTRY: NavigationItem = { id: 'nav_board', type: 'object', objectName: 'customer', viewName: 'board' };
const LABELLED = world({
  views: { 'customer.board': '客户管理仪表盘' },
  objects: { customer: 'Customers', account: 'Accounts' },
  dashboards: { sales_overview: 'Sales Overview' },
});

const label = (item: NavigationItem, target?: NavTargetLabelResolver) =>
  resolveNavItemLabel(item, undefined, target);

describe('objectui#9868 — resolveNavItemLabel: an absent label inherits its target', () => {
  it('a view entry shows the VIEW’s label, and after a rename the new one — same nav tree, nothing stored', () => {
    expect(label(VIEW_ENTRY, LABELLED)).toBe('客户管理仪表盘');

    // Rename = a new answer from the host's metadata; the nav entry is the
    // very same object and carries no label before or after.
    const renamed = world({ views: { 'customer.board': 'Customer Board' }, objects: { customer: 'Customers' } });
    expect(label(VIEW_ENTRY, renamed)).toBe('Customer Board');
    expect(VIEW_ENTRY).not.toHaveProperty('label');
  });

  it('walks the spec’s ladder: unlabelled view → the object’s label → the viewName', () => {
    expect(label(VIEW_ENTRY, world({ objects: { customer: 'Customers' } }))).toBe('Customers');
    expect(label(VIEW_ENTRY, world({}))).toBe('board');
  });

  it('an object entry shows the object’s label, else its objectName', () => {
    const entry: NavigationItem = { id: 'nav_acc', type: 'object', objectName: 'account' };
    expect(label(entry, LABELLED)).toBe('Accounts');
    expect(label(entry, world({}))).toBe('account');
  });

  it('a dashboard entry shows the dashboard’s label, else its dashboardName', () => {
    const entry: NavigationItem = { id: 'nav_dash', type: 'dashboard', dashboardName: 'sales_overview' };
    expect(label(entry, LABELLED)).toBe('Sales Overview');
    expect(label(entry, world({}))).toBe('sales_overview');
  });

  it('a blank answer is no label: the ladder moves on rather than showing empty text', () => {
    const blank: NavTargetLabelResolver = (t) => (t.kind === 'view' ? '  ' : t.kind === 'object' ? '' : undefined);
    expect(label(VIEW_ENTRY, blank)).toBe('board');
  });

  it('with NO resolver at all (a host without metadata) the machine name renders', () => {
    expect(label(VIEW_ENTRY)).toBe('board');
    expect(label({ id: 'nav_acc', type: 'object', objectName: 'account' })).toBe('account');
  });

  it.each<[string, NavigationItem, string]>([
    ['page', { id: 'nav_page', type: 'page', pageName: 'home' }, 'home'],
    ['report', { id: 'nav_rep', type: 'report', reportName: 'win_rate' }, 'win_rate'],
    ['url', { id: 'nav_url', type: 'url', url: 'https://example.com/handbook' }, 'https://example.com/handbook'],
    ['component', { id: 'nav_cmp', type: 'component', componentRef: 'metadata:directory' }, 'metadata:directory'],
    ['action', { id: 'nav_act', type: 'action', actionDef: { actionName: 'sync_now' } }, 'sync_now'],
    ['group', { id: 'grp_sales', type: 'group', children: [] }, 'grp_sales'],
    ['object with no objectName', { id: 'nav_broken', type: 'object' }, 'nav_broken'],
  ])('%s: not an inheriting target — shows its machine name / id, and the resolver is never asked', (_n, item, want) => {
    const spy = vi.fn(LABELLED);
    expect(label(item, spy)).toBe(want);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('objectui#9868 — the controls: a PRESENT label is never replaced by the target’s', () => {
  it('an explicit label renders verbatim although the target’s label differs, and the resolver is not asked', () => {
    const spy = vi.fn(LABELLED);
    expect(label({ ...VIEW_ENTRY, label: 'Board' }, spy)).toBe('Board');
    expect(spy).not.toHaveBeenCalled();
  });

  it('an explicit label EQUAL to the machine name stays verbatim — the sentinel route (B) was refused', () => {
    const spy = vi.fn(LABELLED);
    // The only thing that could change this text is the target resolver (the
    // i18n convention resolvers this row also used to pass retired in
    // objectui#11299), and a viewer's locale does not reach a plain string.
    const item: NavigationItem = { id: 'nav_acc', type: 'object', objectName: 'account', label: 'account' };
    expect(resolveNavItemLabel(item, undefined, spy, 'zh-CN')).toBe('account');
    expect(resolveNavItemLabel({ ...VIEW_ENTRY, label: 'board' }, undefined, spy, 'zh-CN')).toBe('board');
    expect(spy).not.toHaveBeenCalled();
  });
});

function renderNav(items: NavigationItem[], props: Record<string, unknown> = {}) {
  const tree = (p: Record<string, unknown>) => (
    <MemoryRouter initialEntries={['/apps/crm']}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer items={items} basePath="/apps/crm" {...p} />
      </SidebarProvider>
    </MemoryRouter>
  );
  const utils = render(tree(props));
  return { ...utils, rerenderWith: (p: Record<string, unknown>) => utils.rerender(tree(p)) };
}

describe('objectui#9868 — NavigationRenderer renders the inherited label', () => {
  const items: NavigationItem[] = [
    VIEW_ENTRY,
    { id: 'nav_acc', type: 'object', objectName: 'account', label: 'account' },
    {
      id: 'grp_reports',
      type: 'group',
      children: [{ id: 'nav_dash', type: 'dashboard', dashboardName: 'sales_overview' }],
    },
  ];

  it('shows the target’s label, follows a rename on re-render, and keeps the authored one verbatim', () => {
    const { rerenderWith } = renderNav(items, { resolveTargetLabel: LABELLED });

    const board = screen.getByRole('link', { name: '客户管理仪表盘' });
    expect(board.getAttribute('href')).toBe('/apps/crm/customer/view/board');
    expect(screen.getByRole('link', { name: 'Sales Overview' })).toBeTruthy();
    // Control: the authored machine-name label is NOT replaced by 'Accounts'.
    expect(screen.getByRole('link', { name: 'account' })).toBeTruthy();
    expect(screen.queryByText('Accounts')).toBeNull();
    // A label-less group shows its id — the one backstop a group has.
    expect(screen.getByText('grp_reports')).toBeTruthy();

    rerenderWith({
      resolveTargetLabel: world({
        views: { 'customer.board': 'Customer Board' },
        objects: { account: 'Accounts' },
        dashboards: { sales_overview: 'Revenue' },
      }),
    });
    expect(screen.getByRole('link', { name: 'Customer Board' }).getAttribute('href')).toBe('/apps/crm/customer/view/board');
    expect(screen.queryByText('客户管理仪表盘')).toBeNull();
    expect(screen.getByRole('link', { name: 'Revenue' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'account' })).toBeTruthy();
  });

  it('renders the machine name when no host metadata is wired', () => {
    renderNav(items);
    expect(screen.getByRole('link', { name: 'board' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'sales_overview' })).toBeTruthy();
  });

  it('an unlabelled ACTION entry renders (it used to read `label.key` off undefined) with its action name', () => {
    const onAction = vi.fn();
    renderNav([{ id: 'nav_act', type: 'action', actionDef: { actionName: 'sync_now' } }], { onAction });
    expect(screen.getByRole('button', { name: 'sync_now' })).toBeTruthy();
  });

  it('search finds an unlabelled entry by the label it SHOWS', () => {
    renderNav(items, { resolveTargetLabel: LABELLED, searchQuery: '仪表盘' });
    const found = screen.getByRole('link', { name: '客户管理仪表盘' });
    expect(within(found).getByText('客户管理仪表盘')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'account' })).toBeNull();
  });

  it('filterNavigationItems without resolvers matches the machine-name backstop, and never throws on an absent label', () => {
    expect(filterNavigationItems(items, 'board').map((i) => i.id)).toEqual(['nav_board']);
  });
});

describe('objectui#9868 — AppSchemaRenderer’s mobile tab bar names an unlabelled entry', () => {
  it('shows the machine-name backstop (it used to read `label.defaultValue` off undefined); control: an authored label', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/apps/crm']}>
        <AppSchemaRenderer
          schema={{
            type: 'app',
            name: 'crm',
            title: 'CRM',
            navigation: [
              { id: 'nav_page', type: 'page', pageName: 'my_page' },
              { id: 'nav_acc', type: 'object', objectName: 'account', label: 'Accounts' },
            ],
          }}
          basePath="/apps/crm"
          mobileNavMode="bottom_nav"
        >
          <div />
        </AppSchemaRenderer>
      </MemoryRouter>,
    );
    const bar = container.querySelector('[role="navigation"][aria-label="Mobile navigation"]');
    expect(bar).not.toBeNull();
    const texts = Array.from(bar!.querySelectorAll('a span.truncate')).map((span) => span.textContent);
    expect(texts).toEqual(['my_page', 'Accounts']);
  });
});
