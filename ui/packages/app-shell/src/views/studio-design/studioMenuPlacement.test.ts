// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37200 — Studio's menu placement table agrees with the registry
 * and with the ruled order (ruling on #37192).
 *
 * Two holds:
 *  - against `DEFAULT_METADATA_TYPE_REGISTRY`: every type the directory can
 *    list has exactly one row, and every row names a registered, listable
 *    type — so a newly registered type fails here until it is placed;
 *  - against the ruling: the rows, in order, with their tiers. The expected
 *    values are literals, so a reordered or re-tiered row fails here, not in
 *    the menu.
 *
 * The ADR-0084 pin (the type table's order and tier columns equal this list)
 * follows once the ADR amendment that adds those columns has merged.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { HIDDEN_DIRECTORY_TYPES } from '../metadata-admin/directoryScope.js';
import { STUDIO_MENU_PLACEMENT } from './studioMenuPlacement.js';

/** The types a package's directory can list: every registered type it does not hide. */
const LISTABLE_TYPES = DEFAULT_METADATA_TYPE_REGISTRY.map((entry) => entry.type).filter(
  (type) => !HIDDEN_DIRECTORY_TYPES.has(type),
);

describe('the menu placement table agrees with the registry (objectstack#37200)', () => {
  it('every type the directory can list has exactly one row', () => {
    for (const type of LISTABLE_TYPES) {
      expect(STUDIO_MENU_PLACEMENT.filter((row) => row.type === type).length, type).toBe(1);
    }
  });

  it('every row names a registered type the directory lists', () => {
    const registered = new Set(DEFAULT_METADATA_TYPE_REGISTRY.map((entry) => entry.type));
    for (const row of STUDIO_MENU_PLACEMENT) {
      expect(registered.has(row.type), row.type).toBe(true);
      expect(HIDDEN_DIRECTORY_TYPES.has(row.type), row.type).toBe(false);
    }
  });

  it('the rows and the listable types are the same set', () => {
    expect(STUDIO_MENU_PLACEMENT.map((row) => row.type).sort()).toEqual([...LISTABLE_TYPES].sort());
  });
});

describe('the menu placement table holds the ruled order and tiers (objectstack#37200)', () => {
  it('常用: object · app, page, dashboard, report · flow · permission · agent, tool, skill, in that order', () => {
    expect(STUDIO_MENU_PLACEMENT.filter((row) => row.tier === 'common').map((row) => row.type)).toEqual([
      'object',
      'app', 'page', 'dashboard', 'report',
      'flow',
      'permission',
      'agent', 'tool', 'skill',
    ]);
  });

  it("高级: every other type, in the proposal's order", () => {
    expect(STUDIO_MENU_PLACEMENT.filter((row) => row.tier === 'advanced').map((row) => row.type)).toEqual([
      'picklist', 'hook', 'mapping', 'object_extension', 'seed',
      'view', 'action', 'dataset',
      'job',
      'doc', 'book', 'email_template', 'translation', 'api', 'datasource', 'external_catalog',
      'position', 'assignment_rule', 'sharing_rule', 'queue', 'capability',
      'ai_context',
    ]);
  });

  it('the common rows come first, and every row carries one of the two tiers', () => {
    const tiers = STUDIO_MENU_PLACEMENT.map((row) => row.tier);
    expect(new Set(tiers)).toEqual(new Set(['common', 'advanced']));
    expect(tiers.indexOf('advanced')).toBe(tiers.lastIndexOf('common') + 1);
  });

  it('picklist and email template are advanced, as ruled', () => {
    expect(STUDIO_MENU_PLACEMENT.find((row) => row.type === 'picklist')?.tier).toBe('advanced');
    expect(STUDIO_MENU_PLACEMENT.find((row) => row.type === 'email_template')?.tier).toBe('advanced');
  });

  it('each row holds a type and a tier, and nothing else (the group stays the served domain)', () => {
    for (const row of STUDIO_MENU_PLACEMENT) {
      expect(Object.keys(row).sort(), row.type).toEqual(['tier', 'type']);
    }
  });
});
