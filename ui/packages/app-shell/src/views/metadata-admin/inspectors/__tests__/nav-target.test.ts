// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/** nav-target — pure type/mode resolution behind AppNavInspector (#2245). */

import { describe, it, expect } from 'vitest';
import {
  inferNavItemType,
  deriveObjectTargetMode,
  clearedTargetPatch,
  OBJECT_MODE_FIELDS,
  ensureNavId,
  NAV_TYPE_TARGETS,
  isStaticPageOption,
} from '../nav-target';

describe('inferNavItemType', () => {
  it('spec type wins', () => {
    expect(inferNavItemType({ type: 'dashboard', path: '/x' })).toBe('dashboard');
  });
  it('legacy kind maps (link → url)', () => {
    expect(inferNavItemType({ kind: 'link' })).toBe('url');
    expect(inferNavItemType({ kind: 'object' })).toBe('object');
  });
  it('typed and legacy target fields imply the type', () => {
    expect(inferNavItemType({ objectName: 'task' })).toBe('object');
    expect(inferNavItemType({ page: 'home' })).toBe('page');
    expect(inferNavItemType({ href: 'https://x.dev' })).toBe('url');
    expect(inferNavItemType({ children: [{}] })).toBe('group');
    expect(inferNavItemType({ path: 'https://x.dev' })).toBe('url');
  });
  it('bare placeholder → null', () => {
    expect(inferNavItemType({ label: 'New item', path: '' })).toBeNull();
  });
});

describe('deriveObjectTargetMode — resolveHref precedence', () => {
  it('recordId wins over everything', () => {
    expect(
      deriveObjectTargetMode({ recordId: '{current_user_id}', filters: { a: 'b' }, viewName: 'v' }),
    ).toBe('record');
  });
  it('filters beat viewName', () => {
    expect(deriveObjectTargetMode({ filters: { status: 'open' }, viewName: 'v' })).toBe('filters');
  });
  it('viewName → view; nothing → default', () => {
    expect(deriveObjectTargetMode({ viewName: 'v' })).toBe('view');
    expect(deriveObjectTargetMode({ objectName: 'task' })).toBe('default');
  });
});

describe('clearedTargetPatch — no stale keys survive a switch', () => {
  it('clears every target + legacy key except the kept ones', () => {
    const patch = clearedTargetPatch(OBJECT_MODE_FIELDS.filters);
    expect(patch).not.toHaveProperty('objectName');
    expect(patch).not.toHaveProperty('filters');
    expect(patch).toHaveProperty('viewName', undefined);
    expect(patch).toHaveProperty('recordId', undefined);
    expect(patch).toHaveProperty('path', undefined);
    expect(patch).toHaveProperty('kind', undefined);
  });
  it('a stale recordId cannot hijack a filters item after the switch', () => {
    const node = { recordId: 'r1', viewName: 'v', path: '/x' };
    const next = { ...node, ...clearedTargetPatch(OBJECT_MODE_FIELDS.filters), filters: { a: '1' } };
    expect(deriveObjectTargetMode(next)).toBe('filters');
  });
});

describe('ensureNavId', () => {
  it('keeps an existing id', () => {
    expect(ensureNavId({ id: 'nav_x' }, [])).toBe('nav_x');
  });
  it('derives snake_case from the target and uniquifies against siblings', () => {
    expect(ensureNavId({ objectName: 'Sales Order' }, [])).toBe('nav_sales_order');
    expect(ensureNavId({ label: 'Tasks' }, [{ id: 'nav_tasks' }])).toBe('nav_tasks_2');
  });
});

describe('NAV_TYPE_TARGETS', () => {
  it('maps picker types to their metadata list', () => {
    expect(NAV_TYPE_TARGETS.page).toEqual({ targetKey: 'pageName', metaType: 'page' });
    expect(NAV_TYPE_TARGETS.url).toEqual({ targetKey: 'url' });
    expect(NAV_TYPE_TARGETS.group).toEqual({});
  });
});

describe('isStaticPageOption — page picker excludes record-detail pages (#2333)', () => {
  it('excludes record pages (`type: record`)', () => {
    expect(isStaticPageOption({ type: 'record' })).toBe(false);
  });
  it('keeps static page kinds', () => {
    for (const type of ['list', 'home', 'app', 'utility']) {
      expect(isStaticPageOption({ type })).toBe(true);
    }
  });
  it('reads `type` alone — `pageType` is a key PageSchema refuses (mirrors usePageAssignment, objectui#9674)', () => {
    // A row spelled with the refused alias is not a confirmed record page…
    const aliasOnly: Parameters<typeof isStaticPageOption>[0] & { pageType: string } = { pageType: 'record' };
    expect(isStaticPageOption(aliasOnly)).toBe(true);
    // …and the alias overrides `type` in neither direction.
    const aliasSaysRecord: Parameters<typeof isStaticPageOption>[0] & { pageType: string } = { pageType: 'record', type: 'list' };
    expect(isStaticPageOption(aliasSaysRecord)).toBe(true);
    const aliasSaysList: Parameters<typeof isStaticPageOption>[0] & { pageType: string } = { pageType: 'list', type: 'record' };
    expect(isStaticPageOption(aliasSaysList)).toBe(false);
  });
  it('keeps rows missing both discriminators (only confirmed record pages excluded)', () => {
    expect(isStaticPageOption({})).toBe(true);
    // A real metadata row carries `name` / `label` too. The predicate declares
    // only the two discriminators it reads, so a FRESH literal with `name` trips
    // excess-property checking; deriving the parameter type and intersecting the
    // extra key states the case without casting it away (objectui#4040).
    const namedRow: Parameters<typeof isStaticPageOption>[0] & { name: string } = { name: 'x' };
    expect(isStaticPageOption(namedRow)).toBe(true);
  });
});
