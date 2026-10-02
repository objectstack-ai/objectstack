// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_INLINE_GRID_COLUMNS,
  deriveInlineGridColumns,
  deriveInlineRowFormFields,
  isInlineRowFormOffered,
} from './inline-grid-columns';
import { InlineGridColumnSchema } from './field.zod';

/**
 * The default columns of an inline master-detail grid with no authored
 * columns. The fixtures are the renderer's own `deriveColumns` cases
 * (objectui `packages/plugin-form/src/deriveMasterDetail.test.ts`), so the two
 * agree on the cases the renderer pins: the same names, the same order, the
 * same overflow collapsed into the column chooser.
 */
describe('deriveInlineGridColumns', () => {
  const taskSchema = {
    name: 'showcase_task',
    fields: {
      id: { type: 'text', system: true },
      title: { type: 'text', label: 'Title', required: true },
      status: { type: 'select', label: 'Status', options: [{ label: 'To Do', value: 'todo' }] },
      estimate_hours: { type: 'number', label: 'Estimate (h)' },
      budget: { type: 'currency', label: 'Budget' },
      due_date: { type: 'date', label: 'Due Date' },
      assignee: { type: 'lookup', label: 'Assignee', reference: 'user' },
      project: { type: 'master_detail', label: 'Project', reference: 'showcase_project', required: true },
      health: { type: 'formula', label: 'Health', expression: 'x' },
      created_at: { type: 'datetime' },
    },
  };

  const names = (cols: { name: string }[]) => cols.map((c) => c.name);
  const visible = (cols: { name: string; defaultHidden?: true }[]) => cols.filter((c) => !c.defaultHidden).map((c) => c.name);

  it('draws every editable child field in field order, skipping system, audit, the relationship and non-editable types', () => {
    expect(deriveInlineGridColumns(taskSchema, { relationshipField: 'project' })).toEqual([
      { name: 'title' },
      { name: 'status' },
      { name: 'estimate_hours' },
      { name: 'budget' },
      { name: 'due_date' },
      { name: 'assignee' },
    ]);
  });

  it('without a relationship field, the relationship is an ordinary lookup column', () => {
    expect(names(deriveInlineGridColumns(taskSchema, { maxColumns: 0 }))).toContain('project');
  });

  it('skips sort-position names, `readonly` / `hidden` fields, and anything in `exclude`', () => {
    const def = {
      fields: {
        line_no: { type: 'number' },
        sort_order: { type: 'number' },
        frozen: { type: 'text', readonly: true },
        secret: { type: 'text', hidden: true },
        owner: { type: 'lookup', reference: 'sys_user' },
        note: { type: 'text' },
        qty: { type: 'number' },
      },
    };
    expect(names(deriveInlineGridColumns(def, { exclude: ['note'] }))).toEqual(['qty']);
  });

  it('keeps file-family fields (an upload cell) and drops rich text, JSON and computed types', () => {
    const def = {
      fields: {
        receipt: { type: 'file' },
        photo: { type: 'image' },
        body: { type: 'richtext' },
        meta: { type: 'json' },
        place: { type: 'location' },
        seq: { type: 'autonumber' },
        total: { type: 'summary' },
        memo: { type: 'textarea' },
      },
    };
    expect(names(deriveInlineGridColumns(def))).toEqual(['receipt', 'photo', 'memo']);
  });

  describe('the column budget collapses, never drops', () => {
    const wideSchema = {
      fields: {
        title: { type: 'text', required: true },
        assignee: { type: 'text' },
        status: { type: 'select', required: true },
        priority: { type: 'select' },
        estimate_hours: { type: 'number' },
        progress: { type: 'text' },
        done: { type: 'boolean' },
        due_date: { type: 'date' },
        start_date: { type: 'date' },
        end_date: { type: 'date' },
        labels: { type: 'text' },
        notes: { type: 'text' },
        parent: { type: 'master_detail', reference: 'p', required: true },
      },
    };

    it(`returns every column, ${DEFAULT_MAX_INLINE_GRID_COLUMNS} of them visible, in field order`, () => {
      const cols = deriveInlineGridColumns(wideSchema, { relationshipField: 'parent' });
      expect(cols).toHaveLength(12);
      expect(names(cols)).toEqual(Object.keys(wideSchema.fields).filter((n) => n !== 'parent'));
      expect(visible(cols)).toEqual(['title', 'status', 'priority', 'estimate_hours', 'done', 'due_date']);
    });

    it('collapses the low-signal text columns into the chooser', () => {
      const byName = Object.fromEntries(deriveInlineGridColumns(wideSchema, { relationshipField: 'parent' }).map((c) => [c.name, c]));
      expect(byName.notes).toEqual({ name: 'notes', defaultHidden: true });
      expect(byName.labels).toEqual({ name: 'labels', defaultHidden: true });
    });

    it('`maxColumns: 0` marks no column hidden', () => {
      const cols = deriveInlineGridColumns(wideSchema, { relationshipField: 'parent', maxColumns: 0 });
      expect(cols).toHaveLength(12);
      expect(cols.every((c) => c.defaultHidden === undefined)).toBe(true);
    });

    it('keeps every required column visible, even past the budget', () => {
      const reqHeavy = {
        fields: {
          a: { type: 'text', required: true },
          b: { type: 'text', required: true },
          c: { type: 'text', required: true },
          d: { type: 'text', required: true },
          e: { type: 'text', required: true },
          f: { type: 'text', required: true },
          g: { type: 'text', required: true },
          h: { type: 'text' },
          parent: { type: 'master_detail', reference: 'p', required: true },
        },
      };
      const cols = deriveInlineGridColumns(reqHeavy, { relationshipField: 'parent' });
      expect(visible(cols)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
      expect(cols.find((c) => c.name === 'h')).toEqual({ name: 'h', defaultHidden: true });
    });

    it('a computed column is never required, so `required` does not keep it visible', () => {
      const def = {
        fields: {
          name: { type: 'text' },
          a: { type: 'select' },
          b: { type: 'select' },
          c: { type: 'select' },
          d: { type: 'select' },
          e: { type: 'select' },
          line_total: { type: 'currency', required: true, expression: { dialect: 'cel', source: 'record.qty * record.price' } },
        },
      };
      const cols = deriveInlineGridColumns(def);
      expect(cols.find((c) => c.name === 'line_total')).toEqual({ name: 'line_total', defaultHidden: true });
      expect(visible(cols)).toEqual(['name', 'a', 'b', 'c', 'd', 'e']);
    });
  });

  it('returns no columns for a definition with no field map', () => {
    expect(deriveInlineGridColumns(undefined)).toEqual([]);
    expect(deriveInlineGridColumns(null)).toEqual([]);
    expect(deriveInlineGridColumns('line')).toEqual([]);
    expect(deriveInlineGridColumns({ name: 'line' })).toEqual([]);
  });

  it('every derived entry is a valid identity-only `inlineColumns` entry', () => {
    const wide = { fields: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}`, { type: 'text' }])) };
    const cols = deriveInlineGridColumns(wide);
    expect(cols.some((c) => c.defaultHidden)).toBe(true);
    for (const col of cols) expect(InlineGridColumnSchema.parse(col)).toEqual(col);
  });
});

/**
 * [#21091] The fields of an inline grid's per-row expand form. The first two
 * fixtures are the renderer's own `deriveFormFields` cases (objectui
 * `packages/plugin-form/src/deriveMasterDetail.test.ts` at the `.objectui-sha`
 * pin `31971ff1e28f`), asserted here as whole lists rather than as the
 * `toContain` probes they are there.
 */
describe('deriveInlineRowFormFields', () => {
  const taskSchema = {
    name: 'showcase_task',
    fields: {
      id: { type: 'text', system: true },
      title: { type: 'text', label: 'Title', required: true },
      status: { type: 'select', label: 'Status', options: [{ label: 'To Do', value: 'todo' }] },
      estimate_hours: { type: 'number', label: 'Estimate (h)' },
      budget: { type: 'currency', label: 'Budget' },
      due_date: { type: 'date', label: 'Due Date' },
      assignee: { type: 'lookup', label: 'Assignee', reference: 'user' },
      project: { type: 'master_detail', label: 'Project', reference: 'showcase_project', required: true },
      health: { type: 'formula', label: 'Health', expression: 'x' },
      created_at: { type: 'datetime' },
    },
  };

  it('returns the business fields in field order, skipping system, audit, the relationship and computed types', () => {
    expect(deriveInlineRowFormFields(taskSchema, { relationshipField: 'project' })).toEqual([
      'title', 'status', 'estimate_hours', 'budget', 'due_date', 'assignee',
    ]);
  });

  it('keeps the rich input types the grid omits, and drops the computed ones', () => {
    const rich = {
      fields: {
        title: { type: 'text', required: true },
        parent: { type: 'master_detail', reference: 'p', required: true },
        notes: { type: 'textarea' },
        cover: { type: 'image' },
        attachment: { type: 'file' },
        total: { type: 'summary' },
      },
    };
    expect(deriveInlineRowFormFields(rich, { relationshipField: 'parent' })).toEqual(['title', 'notes', 'cover', 'attachment']);
  });

  it('keeps `readonly` fields and every type a cell cannot edit; drops `system`, `hidden`, sort positions and `exclude`', () => {
    const def = {
      fields: {
        line_no: { type: 'number' },
        sort_order: { type: 'number' },
        frozen: { type: 'text', readonly: true },
        secret: { type: 'text', hidden: true },
        internal: { type: 'text', system: true },
        owner: { type: 'lookup', reference: 'sys_user' },
        body: { type: 'richtext' },
        meta: { type: 'json' },
        place: { type: 'location' },
        page: { type: 'html' },
        doc: { type: 'markdown' },
        seq: { type: 'autonumber' },
        roll: { type: 'rollup' },
        note: { type: 'text' },
      },
    };
    expect(deriveInlineRowFormFields(def, { exclude: ['note'] })).toEqual(['frozen', 'body', 'meta', 'place', 'page', 'doc']);
  });

  it('without a relationship field, the relationship is an ordinary field', () => {
    expect(deriveInlineRowFormFields(taskSchema)).toContain('project');
  });

  it('returns no fields for a definition with no field map', () => {
    expect(deriveInlineRowFormFields(undefined)).toEqual([]);
    expect(deriveInlineRowFormFields(null)).toEqual([]);
    expect(deriveInlineRowFormFields('line')).toEqual([]);
    expect(deriveInlineRowFormFields({ name: 'line' })).toEqual([]);
  });

  it('the derived grid draws a subset of the derived form: the form has every column, in the same order', () => {
    const wide = {
      fields: {
        ...taskSchema.fields,
        body: { type: 'richtext' },
        frozen: { type: 'number', readonly: true },
        ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}`, { type: 'text' }])),
      },
    };
    const opts = { relationshipField: 'project' };
    const form = deriveInlineRowFormFields(wide, opts);
    const columns = deriveInlineGridColumns(wide, opts).map((c) => c.name);
    expect(columns.length).toBeGreaterThan(0);
    expect(form.filter((name) => columns.includes(name))).toEqual(columns);
    expect(form.filter((name) => !columns.includes(name))).toEqual(['body', 'frozen']);
  });
});

/**
 * [#21091] When an inline grid offers its per-row expand form — the condition
 * objectui's `MasterDetailForm` applies at the `.objectui-sha` pin
 * `31971ff1e28f` before it hands a row an expand control.
 */
describe('isInlineRowFormOffered', () => {
  it('always in the `form` factor: the row form IS the editor', () => {
    expect(isInlineRowFormOffered({ inlineMode: 'form', formFields: ['a'], columns: [{ name: 'a' }, { name: 'b' }] })).toBe(true);
    expect(isInlineRowFormOffered({ inlineMode: 'form' })).toBe(true);
  });

  it('in the `grid` factor, only when the form has more fields than the grid has columns', () => {
    expect(isInlineRowFormOffered({ inlineMode: 'grid', formFields: ['a', 'b', 'c'], columns: [{ name: 'a' }, { name: 'b' }] })).toBe(true);
    expect(isInlineRowFormOffered({ inlineMode: 'grid', formFields: ['a', 'b'], columns: [{ name: 'a' }, { name: 'b' }] })).toBe(false);
    expect(isInlineRowFormOffered({ inlineMode: 'grid', formFields: ['a'], columns: [{ name: 'a' }, { name: 'b' }] })).toBe(false);
  });

  it('with no form factor, the same count decides; an absent list counts as empty', () => {
    expect(isInlineRowFormOffered({ formFields: ['a'], columns: [] })).toBe(true);
    expect(isInlineRowFormOffered({ formFields: ['a'] })).toBe(true);
    expect(isInlineRowFormOffered({ columns: [{ name: 'a' }] })).toBe(false);
    expect(isInlineRowFormOffered({})).toBe(false);
  });
});
