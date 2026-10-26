/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The DECLARED nav `runAction` slot → URL (objectui#5216).
 *
 * `ObjectNavItemSchema.runAction` (objectstack#7253, merged pre-GA and present
 * in the installed `@objectstack/spec@17.0.0` — see the PR body's Zone 0 probe)
 * declares which action an object nav entry auto-runs on arrival at its list
 * surface. `resolveHref` is the only writer of that intent onto the URL, and
 * {@link NAV_RUN_ACTION_PARAM} is the only spelling of the param name.
 *
 * This replaces a private `?runAction=` string convention: a bare literal
 * hand-written in `CloudOnboardingNext` and matched by another bare literal in
 * `EnvironmentListToolbar`, declared by no schema, listed in no registry, and
 * therefore invisible to `objectui validate` and to the reserved-param
 * collision check. The retirement is pinned in
 * `packages/app-shell/src/__tests__/navRunAction.privateConventionRetired.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { NavigationItem, NavigationEntryItem } from '@object-ui/types';
import { resolveHref, resolveActiveNavItem, NAV_RUN_ACTION_PARAM } from '../NavigationRenderer';

const BASE = '/apps/cloud_control';

function objectItem(extra: Partial<NavigationEntryItem> = {}): NavigationItem {
  return { id: 'nav_env', type: 'object', label: 'Environments', objectName: 'sys_environment', ...extra };
}

/** The declared deep link as it appears on the resolved href, or null. */
function runActionOf(href: string): string | null {
  const i = href.indexOf('?');
  return new URLSearchParams(i >= 0 ? href.slice(i + 1) : '').get(NAV_RUN_ACTION_PARAM);
}

describe('resolveHref — declared `runAction` slot (#5216)', () => {
  it('the param name is the slot name, so producer and consumer cannot drift', () => {
    expect(NAV_RUN_ACTION_PARAM).toBe('runAction');
  });

  // ── The positive case: a declared slot reaches the URL ────────────────────
  it('a bare object item declaring runAction lands on the list carrying the deep link', () => {
    const { href, external } = resolveHref(objectItem({ runAction: 'create_environment' }), BASE);

    expect(href).toBe(`${BASE}/sys_environment?${NAV_RUN_ACTION_PARAM}=create_environment`);
    expect(external).toBe(false);
  });

  it('a named view still lands on that view, carrying the deep link', () => {
    const { href } = resolveHref(
      objectItem({ viewName: 'active', runAction: 'create_environment' }),
      BASE,
    );

    expect(href.split('?')[0]).toBe(`${BASE}/sys_environment/view/active`);
    expect(runActionOf(href)).toBe('create_environment');
  });

  it('a filters slice keeps its filter params AND carries the deep link', () => {
    const { href } = resolveHref(
      objectItem({ filters: { status: 'active' }, runAction: 'create_environment' }),
      BASE,
    );

    expect(href.split('?')[0]).toBe(`${BASE}/sys_environment/data`);
    const q = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    // The `&` join, not a second `?` — the filters branch already opened the
    // query string, so a naive append would produce an unparseable href.
    expect(q.get('filter[status]')).toBe('active');
    expect(q.get(NAV_RUN_ACTION_PARAM)).toBe('create_environment');
  });

  it('an action name needing escaping is encoded, not concatenated raw', () => {
    const { href } = resolveHref(objectItem({ runAction: 'a b&c=d' }), BASE);

    expect(href).toContain(`${NAV_RUN_ACTION_PARAM}=a%20b%26c%3Dd`);
    // Round-trips through a real parser — the point of encoding it.
    expect(runActionOf(href)).toBe('a b&c=d');
  });

  // ── The list-surface boundary ─────────────────────────────────────────────
  it('a recordId entry resolves to the RECORD page and carries no deep link', () => {
    // The spec defines the slot as running on arrival at the object's LIST
    // surface; a record detail page has no list toolbar to answer to it, so
    // encoding it there would put a one-shot intent on a surface that can only
    // spend it for nothing. Load-bearing rather than defensive: the installed
    // 17.0.0 pin still ACCEPTS `runAction` + `recordId` together, so nothing
    // upstream stops this pair from being authored.
    const { href } = resolveHref(
      objectItem({ recordId: 'env_1', runAction: 'create_environment' }),
      BASE,
    );

    expect(href).toBe(`${BASE}/sys_environment/record/env_1`);
    expect(runActionOf(href)).toBeNull();
  });

  it('an UNRESOLVED recordId template falls back to the list — and the deep link comes back with it', () => {
    // The existing fallback: an unresolvable template yields the list view
    // rather than a dead link. That IS the list surface, so the slot applies.
    const { href } = resolveHref(
      objectItem({ recordId: '{current_user_id}', runAction: 'create_environment' }),
      BASE,
      {},
    );

    expect(href.split('?')[0]).toBe(`${BASE}/sys_environment`);
    expect(runActionOf(href)).toBe('create_environment');
  });

  // ── Absence ──────────────────────────────────────────────────────────────
  it('an item declaring no runAction is byte-identical to before', () => {
    expect(resolveHref(objectItem(), BASE).href).toBe(`${BASE}/sys_environment`);
    expect(resolveHref(objectItem({ viewName: 'active' }), BASE).href).toBe(
      `${BASE}/sys_environment/view/active`,
    );
  });

  it('an empty runAction is treated as absent, not encoded as an empty param', () => {
    // `z.string()` accepts `''` (measured against the installed pin), and no
    // action can be named it — an empty param would arm nothing while looking
    // like a deep link.
    expect(resolveHref(objectItem({ runAction: '' }), BASE).href).toBe(`${BASE}/sys_environment`);
  });

  it('non-object nav types never grow the param', () => {
    const dash = resolveHref(
      { id: 'd', type: 'dashboard', label: 'D', dashboardName: 'sales', runAction: 'x' } as NavigationItem,
      BASE,
    );
    expect(dash.href).toBe(`${BASE}/dashboard/sales`);
  });
});

describe('the deep link does not disturb sidebar active-state (#2272 inverse)', () => {
  // `itemMatchScore`'s object branch scores against the PATHNAME and the
  // `filter[...]` params only, so a query param it does not read cannot change
  // the election. Pinned because `resolveHref` and `resolveActiveNavItem` are
  // documented as round-trip inverses — a writer that broke the reader would
  // light up the wrong sidebar row, or none.
  const plain = objectItem({ id: 'nav_plain' });
  const deepLinked = objectItem({ id: 'nav_deep', runAction: 'create_environment' });

  it('a deep-linked item still wins its own list route', () => {
    const active = resolveActiveNavItem([deepLinked], `${BASE}/sys_environment`, '', BASE);
    expect(active?.id).toBe('nav_deep');
  });

  it('and scores identically to the same item without the slot', () => {
    const a = resolveActiveNavItem([plain], `${BASE}/sys_environment`, '', BASE);
    const b = resolveActiveNavItem([deepLinked], `${BASE}/sys_environment`, '', BASE);
    expect(a?.id).toBe('nav_plain');
    expect(b?.id).toBe('nav_deep');
  });
});
