// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { resolveSurfaceDeepLink, parseSurfaceTarget, DESIGNER_SURFACE_NAV_PARAM } from './useSurfaceDeepLink';

/**
 * Pure half of the shared `?surface=` deep-link plumbing — the rail-restore
 * resolution each pillar applies to its loaded list (the hook half is thin
 * URL glue over the same nav-selection parse/format, tested separately).
 */
describe('resolveSurfaceDeepLink', () => {
  const objects = [
    { name: 'showcase_project', label: '项目' },
    { name: 'showcase_task', label: '任务' },
  ];

  it('resolves a matching-type deep-link to its rail item', () => {
    expect(
      resolveSurfaceDeepLink(objects, { type: 'object', name: 'showcase_task' }, 'object'),
    ).toBe(objects[1]);
  });

  it('returns undefined when there is no deep-link (first-item default applies)', () => {
    expect(resolveSurfaceDeepLink(objects, null, 'object')).toBeUndefined();
  });

  it("ignores a deep-link of another pillar's surface type", () => {
    // e.g. `?surface=page:crm_workbench` reaching the Data pillar after a
    // pillar-tab switch must not accidentally match an object named like it.
    expect(
      resolveSurfaceDeepLink(objects, { type: 'page', name: 'showcase_task' }, 'object'),
    ).toBeUndefined();
  });

  it('ignores a deep-link naming an item the rail does not have', () => {
    expect(
      resolveSurfaceDeepLink(objects, { type: 'object', name: 'deleted_object' }, 'object'),
    ).toBeUndefined();
  });

  it('works for the Access pillar shape (name-keyed permission sets)', () => {
    const perms = [{ name: 'member_default' }, { name: 'sales_manager' }];
    expect(
      resolveSurfaceDeepLink(perms, { type: 'permission', name: 'sales_manager' }, 'permission'),
    ).toBe(perms[1]);
  });
});

/**
 * objectui#11774 — the capture half's parse: `?surface=` plus the Interfaces
 * entry id in its own `?nav=` key. A separate key, so every `<type>:<name>`
 * parser of `?surface=` (each pillar's restore, the app→Studio bridge, the
 * copilot's surface context) reads the same value it always read.
 */
describe('parseSurfaceTarget (objectui#11774)', () => {
  it('the entry id travels in a key of its own, `nav`', () => {
    expect(DESIGNER_SURFACE_NAV_PARAM).toBe('nav');
  });

  it('reads the entry id beside the target', () => {
    expect(parseSurfaceTarget('object:showcase_task', 'nav_slice_urgent')).toEqual({
      type: 'object',
      name: 'showcase_task',
      navId: 'nav_slice_urgent',
    });
  });

  it('BACK-COMPAT: a link with no `nav` parses exactly as `?surface=` alone always did', () => {
    expect(parseSurfaceTarget('object:showcase_task', null)).toEqual({ type: 'object', name: 'showcase_task' });
    expect(parseSurfaceTarget('object:showcase_task', '')).toEqual({ type: 'object', name: 'showcase_task' });
  });

  it('`nav` alone names nothing: it only ever qualifies a target', () => {
    expect(parseSurfaceTarget(null, 'nav_slice_urgent')).toBeNull();
    expect(parseSurfaceTarget('object', 'nav_slice_urgent')).toBeNull();
  });

  it("another pillar's restore ignores the id: it matches on its own type and name", () => {
    const objects = [{ name: 'showcase_project' }, { name: 'showcase_task' }];
    expect(
      resolveSurfaceDeepLink(objects, parseSurfaceTarget('object:showcase_task', 'nav_slice_urgent'), 'object'),
    ).toBe(objects[1]);
  });
});
