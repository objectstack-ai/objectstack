/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * resolveHref — nav item → URL mapping, focused on the `type: 'object'`
 * target precedence (recordId → filters → viewName) and the #2251
 * parameterized bare data surface (`/:objectName/data?filter[...]=`).
 */

import { describe, it, expect } from 'vitest';
import type { NavigationItem, NavigationEntryItem } from '@object-ui/types';
import { resolveHref } from '../NavigationRenderer';

const BASE = '/apps/crm';

function objectItem(extra: Partial<NavigationEntryItem> = {}): NavigationItem {
  return { id: 'nav_task', type: 'object', label: 'Tasks', objectName: 'task', ...extra };
}

/** Parse the href's query string back into entries for order-free asserts. */
function queryOf(href: string): URLSearchParams {
  const i = href.indexOf('?');
  return new URLSearchParams(i >= 0 ? href.slice(i + 1) : '');
}

describe('resolveHref — object targets', () => {
  it('bare object item → object route (workspace, default view)', () => {
    const { href, external } = resolveHref(objectItem(), BASE);
    expect(href).toBe(`${BASE}/task`);
    expect(external).toBe(false);
  });

  it('viewName → explicit view route', () => {
    const { href } = resolveHref(objectItem({ viewName: 'task.by_status' }), BASE);
    expect(href).toBe(`${BASE}/task/view/task.by_status`);
  });

  it('filters → /data with filter[<field>]=<value> params', () => {
    const { href, external } = resolveHref(
      objectItem({ filters: { status: 'open', priority: 'high' } }),
      BASE,
    );
    expect(href.startsWith(`${BASE}/task/data?`)).toBe(true);
    expect(external).toBe(false);
    const q = queryOf(href);
    expect(q.get('filter[status]')).toBe('open');
    expect(q.get('filter[priority]')).toBe('high');
  });

  it('empty filters object → bare /data surface with no params', () => {
    const { href } = resolveHref(objectItem({ filters: {} }), BASE);
    expect(href).toBe(`${BASE}/task/data`);
  });

  it('filters win over viewName (precedence: recordId → filters → viewName)', () => {
    const { href } = resolveHref(
      objectItem({ filters: { status: 'open' }, viewName: 'task.by_status' }),
      BASE,
    );
    expect(href.startsWith(`${BASE}/task/data?`)).toBe(true);
  });

  it('recordId wins over filters', () => {
    const { href } = resolveHref(
      objectItem({ recordId: 'rec_1', filters: { status: 'open' } }),
      BASE,
    );
    expect(href).toBe(`${BASE}/task/record/rec_1`);
  });

  it('substitutes template variables in filter values', () => {
    const { href } = resolveHref(
      objectItem({ filters: { owner_id: '{current_user_id}' } }),
      BASE,
      { currentUserId: 'u_42' },
    );
    expect(queryOf(href).get('filter[owner_id]')).toBe('u_42');
  });

  it('drops filter entries whose template cannot be resolved', () => {
    const { href } = resolveHref(
      objectItem({ filters: { owner_id: '{current_user_id}', status: 'open' } }),
      BASE,
      {},
    );
    const q = queryOf(href);
    expect(q.get('filter[owner_id]')).toBeNull();
    expect(q.get('filter[status]')).toBe('open');
    expect(href.startsWith(`${BASE}/task/data?`)).toBe(true);
  });

  it('unresolved recordId falls through to filters, not the list view', () => {
    const { href } = resolveHref(
      objectItem({ recordId: '{current_user_id}', filters: { status: 'open' } }),
      BASE,
      {},
    );
    expect(href.startsWith(`${BASE}/task/data?`)).toBe(true);
  });
});

describe('resolveHref — non-object targets unchanged', () => {
  it('dashboard', () => {
    const item: NavigationItem = { id: 'n1', type: 'dashboard', label: 'KPIs', dashboardName: 'kpis' };
    expect(resolveHref(item, BASE).href).toBe(`${BASE}/dashboard/kpis`);
  });

  it('page', () => {
    const item: NavigationItem = { id: 'n2', type: 'page', label: 'Home', pageName: 'home' };
    expect(resolveHref(item, BASE).href).toBe(`${BASE}/page/home`);
  });

  it('url is external when target=_blank', () => {
    const item: NavigationItem = { id: 'n3', type: 'url', label: 'Docs', url: 'https://example.com', target: '_blank' };
    const { href, external } = resolveHref(item, BASE);
    expect(href).toBe('https://example.com');
    expect(external).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveActiveNavItem — the inverse mapping (#2272)
// ---------------------------------------------------------------------------

import { resolveActiveNavItem } from '../NavigationRenderer';

/** Split an href into the (pathname, search) pair resolveActiveNavItem takes. */
function locOf(href: string): { pathname: string; search: string } {
  const i = href.indexOf('?');
  return i >= 0
    ? { pathname: href.slice(0, i), search: href.slice(i) }
    : { pathname: href, search: '' };
}

describe('resolveActiveNavItem — single winner across the tree', () => {
  const NAV: NavigationItem[] = [
    { id: 'nav_task', type: 'object', label: 'Tasks', objectName: 'task' },
    { id: 'nav_board', type: 'object', label: 'Board', objectName: 'task', viewName: 'by_status' },
    {
      id: 'nav_my_open', type: 'object', label: 'My Open', objectName: 'task',
      filters: { owner_id: '{current_user_id}', status: 'open' },
    },
    { id: 'nav_profile', type: 'object', label: 'Me', objectName: 'sys_user', recordId: '{current_user_id}' },
    {
      id: 'grp', type: 'group', label: 'More',
      children: [
        { id: 'nav_kpis', type: 'dashboard', label: 'KPIs', dashboardName: 'kpis' },
        { id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' },
      ],
    },
  ];
  const CTX = { currentUserId: 'u_42' };

  const activeId = (pathname: string, search = '') =>
    resolveActiveNavItem(NAV, pathname, search, BASE, CTX)?.id ?? null;

  it('bare object route → bare object item', () => {
    expect(activeId(`${BASE}/task`)).toBe('nav_task');
  });

  it('named view route → view item, not the bare sibling', () => {
    expect(activeId(`${BASE}/task/view/by_status`)).toBe('nav_board');
  });

  it('qualified view id in the URL still matches a short viewName', () => {
    expect(activeId(`${BASE}/task/view/task.by_status`)).toBe('nav_board');
  });

  it('/data with matching filters → filters item, not the bare sibling (#2255 bug)', () => {
    expect(activeId(`${BASE}/task/data`, '?filter[owner_id]=u_42&filter[status]=open')).toBe('nav_my_open');
  });

  it('/data with different filters → bare object weak claim', () => {
    expect(activeId(`${BASE}/task/data`, '?filter[status]=closed')).toBe('nav_task');
  });

  it('record route of the deep-link item → record item wins over bare object', () => {
    expect(activeId(`${BASE}/sys_user/record/u_42`)).toBe('nav_profile');
  });

  it('record route of another object → its bare item weak-claims', () => {
    expect(activeId(`${BASE}/task/record/rec_9`)).toBe('nav_task');
  });

  it('unregistered view still keeps orientation on the bare item', () => {
    expect(activeId(`${BASE}/task/view/unknown_view`)).toBe('nav_task');
  });

  it('dashboard / page items match inside groups', () => {
    expect(activeId(`${BASE}/dashboard/kpis`)).toBe('nav_kpis');
    expect(activeId(`${BASE}/page/home`)).toBe('nav_home');
  });

  it('unrelated route → no active item', () => {
    expect(activeId(`${BASE}/search`)).toBeNull();
  });

  it('round-trips resolveHref for every leaf item shape', () => {
    const leaves = [
      NAV[0], NAV[1], NAV[2], NAV[3],
      ...(NAV[4] as any).children,
    ] as NavigationItem[];
    for (const item of leaves) {
      const { href } = resolveHref(item, BASE, CTX);
      const { pathname, search } = locOf(href);
      expect(resolveActiveNavItem(NAV, pathname, search, BASE, CTX)?.id).toBe(item.id);
    }
  });
});

// ============================================================================
// component targets (#2918) — the renderer half predates the vocabulary; these
// items now typecheck as NavigationItem without casts.
// ============================================================================

describe('resolveHref — component targets', () => {
  function componentItem(extra: Partial<NavigationEntryItem> = {}): NavigationItem {
    return { id: 'nav_comp', type: 'component', label: 'Comp', ...extra };
  }

  it('componentRef → /component/<ns>/<name>', () => {
    const { href, external } = resolveHref(
      componentItem({ componentRef: 'setup:permission_matrix' }),
      BASE,
    );
    expect(href).toBe(`${BASE}/component/setup/permission_matrix`);
    expect(external).toBe(false);
  });

  it('params are serialised as querystring (non-strings as JSON)', () => {
    const { href } = resolveHref(
      componentItem({ componentRef: 'foo:bar', params: { mode: 'compact', page: 2 } }),
      BASE,
    );
    expect(href.startsWith(`${BASE}/component/foo/bar?`)).toBe(true);
    const q = queryOf(href);
    expect(q.get('mode')).toBe('compact');
    expect(q.get('page')).toBe('2');
  });

  it('missing componentRef → dead link', () => {
    expect(resolveHref(componentItem(), BASE).href).toBe('#');
  });

  it('metadata:directory → /metadata', () => {
    const { href } = resolveHref(
      componentItem({ componentRef: 'metadata:directory' }),
      BASE,
    );
    expect(href).toBe(`${BASE}/metadata`);
  });

  it('metadata:resource + params.type/name → nested /metadata path', () => {
    expect(
      resolveHref(componentItem({ componentRef: 'metadata:resource', params: { type: 'object' } }), BASE).href,
    ).toBe(`${BASE}/metadata/object`);
    expect(
      resolveHref(
        componentItem({ componentRef: 'metadata:resource', params: { type: 'object', name: 'task' } }),
        BASE,
      ).href,
    ).toBe(`${BASE}/metadata/object/task`);
  });

  it('metadata extra params: templates resolve via context, unresolved are dropped', () => {
    const item = componentItem({
      componentRef: 'metadata:resource',
      params: { type: 'object', package: '{active_package}' },
    });
    const scoped = resolveHref(item, BASE, { contextValues: { active_package: 'crm_core' } });
    expect(scoped.href).toBe(`${BASE}/metadata/object?package=crm_core`);
    const unscoped = resolveHref(item, BASE);
    expect(unscoped.href).toBe(`${BASE}/metadata/object`);
  });
});
