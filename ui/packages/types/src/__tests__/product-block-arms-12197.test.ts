/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The arms of the five product-page blocks (objectui#12197): `hero`, `stat`,
 * `usage-bar`, `checklist` and `tile-grid`, registered by `@object-ui/app-shell`.
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
});
