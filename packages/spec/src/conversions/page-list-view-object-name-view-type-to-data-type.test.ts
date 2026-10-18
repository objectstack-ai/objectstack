// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { ComponentPropsMap } from '../ui/component.zod.js';
import { applyConversions, collectConversionNotices } from './apply.js';
import { ALL_CONVERSIONS } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionNotice, ConversionTodoNotice } from './types.js';

/**
 * `page-list-view-object-name-view-type-to-data-type` — the data-at-rest half
 * of ruling C on #22444: a stored page `list-view` node in the page carrier's
 * old spelling loads in the list view's own spelling.
 *
 * The fixture pair in `conversions.test.ts` proves before → after over the
 * whole table. What this file pins on top:
 *
 *   - a stored node in the old spelling converts to the spelling its props row
 *     (`ComponentPropsMap['list-view']`) accepts, where the stored node is
 *     refused there by name;
 *   - a conflict between an alias and the spec spelling beside it is left as
 *     stored and reported as a TODO, never resolved by the walker;
 *   - the authoring funnel never replays it (retired from the load path);
 *   - IDEMPOTENCE, and the copy-on-write control.
 */
describe('page-list-view-object-name-view-type-to-data-type (ADR-0087 D2)', () => {
  const ID = 'page-list-view-object-name-view-type-to-data-type';
  const row = ComponentPropsMap['list-view'];
  const page = (properties: Record<string, unknown>, node: Record<string, unknown> = {}) => ({
    name: 'sales_home',
    label: 'Sales Home',
    regions: [{ name: 'main', components: [{ type: 'list-view', ...node, properties }] }],
  });
  const propsOf = (stack: unknown) =>
    (stack as { pages: { regions: { components: { properties: Record<string, unknown> }[] }[] }[] })
      .pages[0]!.regions[0]!.components[0]!.properties;

  it('is registered for protocol 18 and retired from the authoring load path', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID);
    expect(entry, 'the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
    expect(entry!.retiredAfter).toBe('17.7.0');
  });

  it('a stored node in the old spelling loads in the spelling its props row accepts', () => {
    const stored = {
      objectName: 'crm_lead',
      viewType: 'kanban',
      columns: ['full_name', 'status'],
      kanban: { groupByField: 'status', columns: ['full_name'] },
    };
    // Before: the row refuses both aliases by name.
    const before = row.safeParse(stored);
    expect(before.success).toBe(false);
    expect(before.success ? [] : before.error.issues.flatMap((i) => ('keys' in i ? i.keys : []))).toEqual([
      'objectName',
      'viewType',
    ]);

    const converted = applyConversionsToStoredItem('page', page(stored));
    const props = (converted as ReturnType<typeof page>).regions[0]!.components[0]!.properties;
    expect(props).toEqual({
      columns: ['full_name', 'status'],
      kanban: { groupByField: 'status', columns: ['full_name'] },
      data: { provider: 'object', object: 'crm_lead' },
      type: 'kanban',
    });
    expect(row.safeParse(props).success).toBe(true);
  });

  it('one notice per converted alias, each naming the spec key it now sits at', () => {
    const { notices } = collectConversionNotices(
      { pages: [page({ objectName: 'deal', viewType: 'grid' })] },
      { includeRetired: true },
    );
    const mine = notices.filter((n) => n.conversionId === ID);
    expect(mine.map((n) => [n.path, n.from, n.to])).toEqual([
      ['pages[0].regions[0].components[0].properties.data', '"deal"', '{"provider":"object","object":"deal"}'],
      ['pages[0].regions[0].components[0].properties.type', '"grid"', '"grid"'],
    ]);
  });

  it('a conflict is left as stored and reported as a TODO, naming the key', () => {
    const conflicts = [
      // A `data` source naming another object.
      page({ objectName: 'deal', data: { provider: 'object', object: 'account' } }),
      // A node binding naming another object.
      page({ objectName: 'deal' }, { dataSource: { object: 'account' } }),
      // A different kind beside the alias.
      page({ viewType: 'kanban', type: 'gallery' }),
      // Not a name at all.
      page({ objectName: '' }),
    ];
    const todos: ConversionTodoNotice[] = [];
    const notices: ConversionNotice[] = [];
    const out = applyConversions(
      { pages: conflicts },
      { includeRetired: true, onNotice: (n) => notices.push(n), onTodo: (t) => todos.push(t) },
    );
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
    const mine = todos.filter((t) => t.conversionId === ID);
    expect(mine.map((t) => t.path)).toEqual([
      'pages[0].regions[0].components[0].properties.objectName',
      'pages[1].regions[0].components[0].properties.objectName',
      'pages[2].regions[0].components[0].properties.viewType',
      'pages[3].regions[0].components[0].properties.objectName',
    ]);
    // Byte-identical: every conflicting page is the same reference.
    const outPages = (out as { pages: unknown[] }).pages;
    conflicts.forEach((p, i) => expect(outPages[i]).toBe(p));
  });

  it('another component\'s `objectName` is not this entry\'s surface', () => {
    const grid = { type: 'object-grid', properties: { objectName: 'deal' } };
    const stack = { pages: [{ name: 'p', label: 'P', regions: [{ name: 'main', components: [grid] }] }] };
    const out = applyConversions(stack, { includeRetired: true });
    expect((out as typeof stack).pages[0]!.regions[0]!.components[0]).toBe(grid);
  });

  it('control: a node already in the spec spelling is returned as the same reference, with no notice', () => {
    const clean = { pages: [page({ data: { provider: 'object', object: 'deal' }, type: 'kanban' })] };
    const notices: ConversionNotice[] = [];
    const out = applyConversions(clean, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(out).toBe(clean);
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
  });

  it('⛔ never replays on the authoring funnel — an author meets the row\'s refusal instead', () => {
    const { stack, notices } = collectConversionNotices({ pages: [page({ objectName: 'deal', viewType: 'grid' })] });
    expect(propsOf(stack)).toEqual({ objectName: 'deal', viewType: 'grid' });
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
  });

  it('is idempotent — the converted result replays to itself with no second notice', () => {
    const once = applyConversions({ pages: [page({ objectName: 'deal', viewType: 'grid' })] }, { includeRetired: true });
    const notices: ConversionNotice[] = [];
    const twice = applyConversions(once, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(twice).toBe(once);
    expect(notices).toEqual([]);
  });
});
