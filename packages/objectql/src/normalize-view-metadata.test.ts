// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { normalizeViewMetadata } from '@objectstack/metadata-protocol';

/**
 * The `view` write path guarantees a top-level `name` on every view body so
 * `getMetaItems` surfaces the overlay row (and the object page lists it as a
 * tab). It does NOT reshape the document — container and record forms are both
 * valid. See {@link normalizeViewMetadata}.
 */
describe('normalizeViewMetadata', () => {
  const SAVE = 'task.task_kanban';

  it('stamps the save name on a loose `{ list }` fragment (without reshaping)', () => {
    const body = { list: { type: 'kanban', data: { provider: 'object', object: 'task' }, columns: ['title'] } };
    const out = normalizeViewMetadata('view', body, SAVE) as any;
    expect(out.name).toBe(SAVE);
    expect(out.list).toBe(body.list);   // unchanged
    expect('viewKind' in out).toBe(false);
  });

  it('stamps the save name on a loose `{ form }` fragment', () => {
    const out = normalizeViewMetadata('view', { form: { type: 'simple', data: {}, sections: [] } }, 'lead.edit') as any;
    expect(out.name).toBe('lead.edit');
    expect(out.form).toBeDefined();
  });

  it('preserves an explicit name and ALL other fields verbatim', () => {
    const body = { name: 'x.y', list: { type: 'grid', data: {} }, listViews: { a: {} }, isPinned: true, sortOrder: 3, isDefault: false };
    const out = normalizeViewMetadata('view', body, SAVE) as any;
    expect(out).toBe(body);             // untouched (already has a name)
    expect(out.isPinned).toBe(true);
    expect(out.sortOrder).toBe(3);
    expect(out.listViews).toEqual({ a: {} });
  });

  it('leaves a canonical record alone (already has a name)', () => {
    const rec = { name: 't.kb', object: 'task', viewKind: 'list', config: { type: 'grid' } };
    expect(normalizeViewMetadata('view', rec, SAVE)).toBe(rec);
  });

  it('stamps a name on a canonical record that lacks one', () => {
    const out = normalizeViewMetadata('view', { object: 'task', viewKind: 'list', config: {} }, SAVE) as any;
    expect(out.name).toBe(SAVE);
    expect(out.object).toBe('task');
    expect(out.viewKind).toBe('list');
  });

  it('does not touch non-view types', () => {
    const obj = { fields: { name: { type: 'text' } } };
    expect(normalizeViewMetadata('object', obj, 'account')).toBe(obj);
    expect(normalizeViewMetadata('dashboard', { widgets: [] }, 'd')).toEqual({ widgets: [] });
  });

  it('accepts the plural type alias', () => {
    const out = normalizeViewMetadata('views', { list: { type: 'grid', data: {} } }, SAVE) as any;
    expect(out.name).toBe(SAVE);
    expect(out.list).toBeDefined();
  });
});
