// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29635 — the two pure halves of the reader's own views: which
 * stored rows are the reader's own views of an object, and the `ListView`
 * body Save as my view stores for the list on screen. Every body is parsed
 * with spec's own closed `ListViewSchema`, the schema the server's save rule
 * judges it with.
 */

import { describe, expect, it } from 'vitest';
import { ListViewSchema } from '@objectstack/spec/ui';
import { buildPersonalViewConfig, personalViewEntry, readPersonalViewRows } from './personalViews';

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'pv_1',
  user_id: 'u1',
  object_name: 'crm_lead',
  label: 'Mine',
  config: { type: 'grid', columns: ['name'] },
  ...extra,
});

describe('readPersonalViewRows', () => {
  it('keeps the reader\'s own rows of this object only, in the order read', () => {
    const rows = [
      row({ id: 'a' }),
      row({ id: 'b', user_id: 'u2' }),
      row({ id: 'c', object_name: 'crm_account' }),
      row({ id: 'd', user_id: { id: 'u1', name: 'Me' } }),
    ];
    expect(readPersonalViewRows(rows, 'crm_lead', 'u1').map((v) => v.id)).toEqual(['a', 'd']);
  });

  it('reads a config stored as JSON text, and drops a row with no readable body', () => {
    const views = readPersonalViewRows(
      [row({ id: 'text', config: '{"type":"kanban","columns":["name"]}' }), row({ id: 'broken', config: '{' })],
      'crm_lead',
      'u1',
    );
    expect(views.map((v) => [v.id, v.config.type])).toEqual([['text', 'kanban']]);
  });

  it('an entry is keyed by the row id and named by the owner\'s name; a body without a type is a grid', () => {
    expect(personalViewEntry({ id: 'pv_1', label: 'Mine', config: { columns: ['name'] } }))
      .toEqual({ columns: ['name'], type: 'grid', id: 'pv_1', label: 'Mine' });
  });
});

describe('buildPersonalViewConfig', () => {
  const VIEW = {
    id: 'crm_lead.open',
    name: 'open',
    label: 'Open leads',
    type: 'grid',
    columns: ['name', 'status', 'city', 'owner'],
    filter: [{ field: 'status', operator: 'equals', value: 'open' }],
    sort: [{ field: 'name', order: 'asc' }],
    hiddenFields: ['owner'],
    // Console decorations that are no list-view body.
    isDefault: true,
    viewKind: 'list',
    object: 'crm_lead',
  };

  it('lays the list on screen over the view, as a ListView bound to the object', () => {
    const built = buildPersonalViewConfig('crm_lead', VIEW, {
      url: {
        filters: { id: 'g', logic: 'and', conditions: [{ id: 'r', field: 'city', operator: 'equals', value: 'Paris' }] } as never,
        sort: [{ field: 'city', order: 'desc' }],
        grouping: { fields: [{ field: 'status', order: 'asc' }] } as never,
      },
      preference: { hiddenFields: ['status'], columnState: { order: ['city', 'name'] }, rowHeight: 'compact' },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const config = built.config;
    expect(ListViewSchema.safeParse(config).success).toBe(true);
    expect(config.data).toEqual({ provider: 'object', object: 'crm_lead' });
    // The view's own condition AND the Filter panel's.
    expect(config.filter).toEqual([
      { field: 'status', operator: 'equals', value: 'open' },
      { field: 'city', operator: 'equals', value: 'Paris' },
    ]);
    expect(config.sort).toEqual([{ field: 'city', order: 'desc' }]);
    expect(config.grouping).toEqual({ fields: [{ field: 'status', order: 'asc' }] });
    // The reader's hidden columns replace the view's, and their order applies.
    expect(config.columns).toEqual(['city', 'name', 'owner']);
    expect(config.hiddenFields).toBeUndefined();
    expect(config.rowHeight).toBe('compact');
    // Identity and console decorations are no part of the body.
    for (const key of ['id', 'name', 'label', 'isDefault', 'viewKind', 'object']) expect(config).not.toHaveProperty(key);
  });

  it('a part the address does not carry is the view\'s own', () => {
    const built = buildPersonalViewConfig('crm_lead', VIEW, { url: {} });
    expect(built.ok && built.config).toMatchObject({
      filter: VIEW.filter,
      sort: VIEW.sort,
      columns: ['name', 'status', 'city'],
    });
  });

  it('refuses a Filter panel group it cannot fold losslessly, instead of storing another record set', () => {
    const nested = { logic: 'and', conditions: [{ logic: 'or', conditions: [{ field: 'city', operator: 'equals', value: 'Paris' }] }] };
    expect(buildPersonalViewConfig('crm_lead', VIEW, { url: { filters: nested as never } })).toEqual({ ok: false, reason: 'nested_group' });
  });
});
