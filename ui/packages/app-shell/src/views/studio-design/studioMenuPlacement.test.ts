// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37200 — Studio's menu placement table agrees with the registry
 * and with the ruled order (ruling on #37192).
 *
 * Three holds:
 *  - against `DEFAULT_METADATA_TYPE_REGISTRY`: every type the directory can
 *    list has exactly one row, and every row names a registered, listable
 *    type — so a newly registered type fails here until it is placed;
 *  - against the ruling: the rows, in order, with their tiers. The expected
 *    values are literals, so a reordered or re-tiered row fails here, not in
 *    the menu;
 *  - against ADR-0084's type-to-group table: its Order and Tier columns
 *    equal this list, group by group, so the record and the code cannot drift
 *    apart; a drift either way names the type.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    const registered = new Set<string>(DEFAULT_METADATA_TYPE_REGISTRY.map((entry) => entry.type));
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
      'ai_context', 'knowledge_source',
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

const HERE = dirname(fileURLToPath(import.meta.url));
const ADR_0084 = resolve(HERE, '../../../../../../docs/adr/0084-application-builder-information-architecture.md');

/** One row of ADR-0084's type-to-group table: `| Group | domain | Order | Registered type | Tier |`. */
interface AdrRow {
  readonly domain: string;
  readonly order: number;
  readonly type: string;
  readonly tier: 'common' | 'advanced';
}

const ADR_ROW = /^\| \*\*[^|]+\*\* \| `([a-z_]+)` \| (\d+) \| `([a-z_]+)`[^|]* \| (常用|高级) \|$/;

function adrRows(): AdrRow[] {
  return readFileSync(ADR_0084, 'utf8')
    .split('\n')
    .map((line) => ADR_ROW.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m): AdrRow => ({ domain: m[1], order: Number(m[2]), type: m[3], tier: m[4] === '常用' ? 'common' : 'advanced' }));
}

/** Each type's served registry `domain`. */
const DOMAIN_OF = new Map<string, string>(DEFAULT_METADATA_TYPE_REGISTRY.map((entry) => [entry.type, entry.domain]));

describe("the menu placement table equals ADR-0084's Order and Tier columns (objectstack#37200)", () => {
  const rows = adrRows();

  it('the ADR table is read: one row per listable type', () => {
    expect(rows.length).toBe(LISTABLE_TYPES.length);
  });

  it('every type has the same tier in the ADR and in the list', () => {
    for (const row of STUDIO_MENU_PLACEMENT) {
      expect(rows.find((r) => r.type === row.type)?.tier, `${row.type}: ADR-0084 row`).toBe(row.tier);
    }
    for (const r of rows) {
      expect(STUDIO_MENU_PLACEMENT.find((row) => row.type === r.type)?.tier, `${r.type}: placement row`).toBe(r.tier);
    }
  });

  it("every ADR row's group is the type's served domain", () => {
    for (const r of rows) expect(DOMAIN_OF.get(r.type), r.type).toBe(r.domain);
  });

  it("inside each group, the list's order is the ADR's Order column", () => {
    for (const domain of new Set(rows.map((r) => r.domain))) {
      const adr = rows.filter((r) => r.domain === domain).sort((a, b) => a.order - b.order).map((r) => r.type);
      const list = STUDIO_MENU_PLACEMENT.filter((row) => DOMAIN_OF.get(row.type) === domain).map((row) => row.type);
      expect(list, `group ${domain}`).toEqual(adr);
    }
  });
});
