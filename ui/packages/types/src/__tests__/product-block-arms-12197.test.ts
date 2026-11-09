/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The arms of the product-page blocks: `hero`, `stat`, `usage-bar`,
 * `checklist` and `tile-grid` (objectui#12197), and `row-table` (#31856),
 * registered by `@object-ui/app-shell`.
 *
 * Each arm accepts the node a product page authors — props in `properties`,
 * copy as a string or an inline translation map, the spec's API binding as
 * `dataSource`, and a whole-string `${…}` hole where a value may come from the
 * bound response — and refuses what its renderer would not honour.
 */

import { describe, expect, it } from 'vitest';

import { StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';

const BINDING = { provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'data' };

/** The documents a product's welcome page writes, one per block. */
const FIXTURES = {
  hero: {
    type: 'hero',
    dataSource: BINDING,
    properties: {
      title: { en: 'Your workspace', 'zh-CN': '你的工作区' },
      subtitle: 'Production environment',
      meta: '${data.environments[0].hostname}',
      status: 'Active',
      statusTone: 'success',
      primary: { type: 'element:button', properties: { label: 'Open', variant: 'primary' } },
      secondary: { type: 'element:button', properties: { label: 'Install app', variant: 'secondary' } },
    },
  },
  stat: { type: 'stat', dataSource: BINDING, properties: { label: 'Members', value: '${data.members.count}', hint: 'of 5 seats' } },
  'usage-bar': {
    type: 'usage-bar',
    dataSource: BINDING,
    properties: { label: 'Storage', used: '${data.storage.usedMb}', limit: 1024, unit: 'MB' },
  },
  checklist: {
    type: 'checklist',
    dataSource: BINDING,
    properties: {
      collapsedWhenDone: true,
      items: [
        { label: 'Create an environment', done: '${data.checklist.environment}' },
        { label: 'Invite a teammate', done: false, action: { type: 'element:button', properties: { label: 'Invite' } } },
      ],
    },
  },
  'tile-grid': {
    type: 'tile-grid',
    properties: {
      items: [{ label: 'CRM', href: '/apps/crm', icon: 'briefcase', caption: 'Sales' }],
      addTile: { label: 'Add app', href: '/marketplace' },
    },
  },
  'row-table': {
    type: 'row-table',
    dataSource: BINDING,
    properties: {
      rows: '${data.actors}',
      columns: [
        { path: 'name', label: { en: 'Name', 'zh-CN': '名称' } },
        { path: 'lastRun.at', label: 'Last run', format: 'datetime' },
        { path: 'status', label: 'Status', format: 'enum', enum: { active: 'Active', paused: { en: 'Paused' } } },
      ],
      emptyLabel: { en: 'No agents yet' },
    },
  },
} as const;

describe('product-page block arms (objectui#12197)', () => {
  for (const [type, node] of Object.entries(FIXTURES)) {
    it(`accepts the \`${type}\` node a product page authors, on both faces`, () => {
      const loose = safeValidateSchema(node);
      expect(loose.success, JSON.stringify(loose.success ? null : loose.error.issues)).toBe(true);
      expect(StrictAnyComponentSchema.safeParse(node).success).toBe(true);
    });

    it(`refuses both content channels on \`${type}\``, () => {
      expect(safeValidateSchema({ ...node, children: [{ type: 'text', content: 'x' }] }).success).toBe(false);
      expect(safeValidateSchema({ ...node, body: 'x' }).success).toBe(false);
    });

    it(`refuses an undeclared prop on \`${type}\``, () => {
      expect(safeValidateSchema({ ...node, properties: { ...node.properties, colour: 'red' } }).success).toBe(false);
    });
  }

  it('accepts a bound tile list as one whole hole', () => {
    expect(safeValidateSchema({ type: 'tile-grid', dataSource: BINDING, properties: { items: '${data.apps}' } }).success).toBe(true);
  });

  it('refuses a hole that is not the whole value where the value is typed', () => {
    const node = { type: 'usage-bar', properties: { label: 'Storage', used: 'used: ${data.used}' } };
    const result = safeValidateSchema(node);
    expect(result.success).toBe(false);
  });

  it('refuses a cross-origin API binding at the arm, with the spec\'s own message', () => {
    const node = { ...FIXTURES.stat, dataSource: { provider: 'api', read: { url: 'https://evil.example/x' } } };
    const result = StrictAnyComponentSchema.safeParse(node);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('same-origin');
  });

  it('refuses an object binding on a product block, which reads none', () => {
    expect(safeValidateSchema({ ...FIXTURES.stat, dataSource: { object: 'account' } }).success).toBe(false);
  });

  it('refuses a checklist with no steps', () => {
    expect(safeValidateSchema({ type: 'checklist', properties: { items: [] } }).success).toBe(false);
  });

  describe('row-table (#31856)', () => {
    const column = (extra: Record<string, unknown>) => ({
      type: 'row-table',
      properties: { rows: [{ name: 'a' }], columns: [{ path: 'name', label: 'Name', ...extra }] },
    });

    it('accepts literal rows', () => {
      expect(safeValidateSchema(column({})).success).toBe(true);
    });

    it('refuses a format it does not draw', () => {
      expect(safeValidateSchema(column({ format: 'currency' })).success).toBe(false);
    });

    it('refuses an enum column with no label map, and a label map on a column that is not enum', () => {
      expect(safeValidateSchema(column({ format: 'enum' })).success).toBe(false);
      expect(safeValidateSchema(column({ format: 'text', enum: { a: 'A' } })).success).toBe(false);
    });

    it('refuses a column path that is not a dotted path', () => {
      expect(safeValidateSchema(column({ path: '${data.name}' })).success).toBe(false);
      expect(safeValidateSchema(column({ path: 'owner[0]' })).success).toBe(false);
    });

    it('refuses an undeclared column key, such as the prose word `header`', () => {
      expect(safeValidateSchema(column({ header: 'Name' })).success).toBe(false);
    });

    it('refuses a table with no columns, and rows that are a partial hole', () => {
      expect(safeValidateSchema({ type: 'row-table', properties: { rows: [], columns: [] } }).success).toBe(false);
      const partial = { type: 'row-table', properties: { rows: 'rows: ${data.actors}', columns: [{ path: 'a', label: 'A' }] } };
      expect(safeValidateSchema(partial).success).toBe(false);
    });
  });
});
