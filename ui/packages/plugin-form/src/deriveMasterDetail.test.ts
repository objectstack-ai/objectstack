import { describe, it, expect } from 'vitest';
import { normalizeSchemaReferenceKeys } from '@object-ui/core';
import { findRelationshipField, deriveColumns, deriveDetail, deriveFormFields, resolveInlineMode, fieldTypeToColumnType, hydrateColumns } from './deriveMasterDetail';
import { en } from '@object-ui/i18n';

/** The `en` session's word for a boolean value: what `useBooleanValueLabel`
 *  (`@object-ui/fields`) draws under `en`. The derive functions require one
 *  (objectui#12924). */
const booleanLabel = (value: boolean) => (value ? en.common.yes : en.common.no);

const taskSchema = {
  name: 'showcase_task',
  fields: {
    id: { type: 'text', system: true },
    title: { type: 'text', label: 'Title', required: true },
    status: { type: 'select', label: 'Status', options: [{ label: 'To Do', value: 'todo' }, { label: 'Done', value: 'done' }] },
    estimate_hours: { type: 'number', label: 'Estimate (h)' },
    budget: { type: 'currency', label: 'Budget' },
    due_date: { type: 'date', label: 'Due Date' },
    assignee: { type: 'lookup', label: 'Assignee', reference: 'user', displayField: 'name' },
    project: { type: 'master_detail', label: 'Project', reference: 'showcase_project', required: true },
    health: { type: 'formula', label: 'Health', expression: 'x' },
    created_at: { type: 'datetime' },
  },
};

describe('fieldTypeToColumnType', () => {
  it('maps object field types to grid column types', () => {
    expect(fieldTypeToColumnType('number')).toBe('number');
    expect(fieldTypeToColumnType('currency')).toBe('currency');
    expect(fieldTypeToColumnType('select')).toBe('select');
    expect(fieldTypeToColumnType('master_detail')).toBe('lookup');
    expect(fieldTypeToColumnType('email')).toBe('text');
  });

  /**
   * objectui#3569 — `date` / `datetime` / `time` used to collapse onto the ONE
   * `date` column type, which put a datetime into an `<input type="date">`.
   * That control emits a bare `YYYY-MM-DD`, so a user who merely re-picked the
   * day wrote the record's time component out of existence. The grid cannot
   * choose the right control (or the right read-only formatting) unless the
   * distinction survives this mapping, so it is asserted here, at the producer.
   */
  it('keeps date / datetime / time as three distinct column types (#3569)', () => {
    expect(fieldTypeToColumnType('date')).toBe('date');
    expect(fieldTypeToColumnType('datetime')).toBe('datetime');
    expect(fieldTypeToColumnType('time')).toBe('time');
  });

  it('maps the spec file-family media types to a file column', () => {
    expect(fieldTypeToColumnType('file')).toBe('file');
    expect(fieldTypeToColumnType('image')).toBe('file');
    expect(fieldTypeToColumnType('avatar')).toBe('file');
  });

  // #2655: `attachment` is not a `@objectstack/spec` field type (media types are
  // file/image/avatar/video/audio), so the renderer does not model it — it falls
  // through to the plain-text default rather than being special-cased to file.
  it('does not special-case the non-spec `attachment` type', () => {
    expect(fieldTypeToColumnType('attachment')).toBe('text');
  });
});

describe('findRelationshipField', () => {
  it('finds the master_detail field pointing at the parent', () => {
    expect(findRelationshipField(taskSchema, 'showcase_project')).toBe('project');
  });
  it('prefers master_detail over lookup', () => {
    const s = { fields: { a: { type: 'lookup', reference: 'p' }, b: { type: 'master_detail', reference: 'p' } } };
    expect(findRelationshipField(s, 'p')).toBe('b');
  });
  it('returns undefined when no field references the parent', () => {
    expect(findRelationshipField(taskSchema, 'nope')).toBeUndefined();
  });
});

describe('deriveColumns', () => {
  it('derives editable columns, skipping system/audit/FK/non-editable fields', () => {
    const cols = deriveColumns(taskSchema, { booleanLabel, relationshipField: 'project' });
    const names = cols.map((c) => c.name);
    expect(names).toEqual(['title', 'status', 'estimate_hours', 'budget', 'due_date', 'assignee']);
    // id (system), created_at (audit), project (FK), health (formula) excluded
    expect(names).not.toContain('id');
    expect(names).not.toContain('project');
    expect(names).not.toContain('health');
    expect(names).not.toContain('created_at');
  });

  it('carries type, options, required and lookup reference through', () => {
    const cols = deriveColumns(taskSchema, { booleanLabel, relationshipField: 'project' });
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    expect(byName.title).toMatchObject({ type: 'text', label: 'Title', required: true });
    expect(byName.status).toMatchObject({ type: 'select', options: [{ label: 'To Do', value: 'todo' }, { label: 'Done', value: 'done' }] });
    expect(byName.estimate_hours.type).toBe('number');
    expect(byName.budget.type).toBe('currency');
    expect(byName.assignee).toMatchObject({ type: 'lookup', reference: 'user', displayField: 'name' });
  });

  /**
   * objectui#11070 round 6: the display pointer is read in the spec's spelling
   * alone. The retired `display_field` sets nothing on a def handed straight
   * in, and the same def after the ingestion fold (objectui#7650 ruling A,
   * which `ObjectStackAdapter.getObjectSchema` runs) carries it as
   * `displayField`. The snake spelling is the INPUT of both cases.
   */
  it('reads `displayField` alone: a `display_field` def sets nothing raw, and keeps its value once folded', () => {
    const snakeSchema = () => ({
      name: 'line',
      fields: { assignee: { type: 'lookup', label: 'Assignee', reference: 'user', display_field: 'full_name' } },
    });
    const raw = deriveColumns(snakeSchema(), { booleanLabel }).find((c) => c.name === 'assignee');
    expect(raw).toMatchObject({ type: 'lookup', reference: 'user' });
    expect(raw?.displayField).toBeUndefined();
    expect(hydrateColumns([{ name: 'assignee' }], snakeSchema(), { booleanLabel })[0].displayField).toBeUndefined();

    const folded = normalizeSchemaReferenceKeys(snakeSchema());
    expect(deriveColumns(folded, { booleanLabel }).find((c) => c.name === 'assignee')?.displayField).toBe('full_name');
    expect(hydrateColumns([{ name: 'assignee' }], folded, { booleanLabel })[0].displayField).toBe('full_name');
  });

  it('carries field-level CEL conditional rules (readonlyWhen / requiredWhen) onto columns', () => {
    const schema = {
      name: 'line',
      fields: {
        parent: { type: 'master_detail', reference: 'order' },
        qty: { type: 'number', label: 'Qty', readonlyWhen: "parent.status == 'paid'" },
        note: { type: 'text', label: 'Note', requiredWhen: 'record.qty >= 100' },
        // `conditionalRequired` was retired in @objectstack/spec 17 (#3855) and
        // is no longer read as a `requiredWhen` alias — it is now a hard parse
        // rejection upstream, so it must not silently gate a column here.
        memo: { type: 'text', label: 'Memo', conditionalRequired: 'record.qty >= 1' },
      },
    };
    const byName = Object.fromEntries(deriveColumns(schema, { booleanLabel, relationshipField: 'parent' }).map((c) => [c.name, c]));
    expect(byName.qty.readonlyWhen).toBe("parent.status == 'paid'");
    expect(byName.note.requiredWhen).toBe('record.qty >= 100');
    expect(byName.memo.requiredWhen).toBeUndefined();
  });

  it('keeps file/image fields as upload columns instead of dropping them (#2360)', () => {
    const schema = {
      name: 'expense_line',
      fields: {
        expense: { type: 'master_detail', reference: 'expense' },
        description: { type: 'text', label: 'Description' },
        receipt: { type: 'file', label: 'Receipt', multiple: true, accept: ['image/*', '.pdf'] },
        photo: { type: 'image', label: 'Photo' },
      },
    };
    const byName = Object.fromEntries(deriveColumns(schema, { booleanLabel, relationshipField: 'expense' }).map((c) => [c.name, c]));
    expect(byName.receipt).toMatchObject({ type: 'file', multiple: true, accept: ['image/*', '.pdf'] });
    // Image fields restrict the picker to images when no accept list is declared.
    expect(byName.photo).toMatchObject({ type: 'file', accept: ['image/*'] });
  });
});

describe('deriveColumns curation (column budget)', () => {
  const wideSchema = {
    name: 'wide',
    fields: {
      title: { type: 'text', label: 'Title', required: true },
      assignee: { type: 'text', label: 'Assignee' },
      status: { type: 'select', label: 'Status', required: true, options: [{ label: 'A', value: 'a' }] },
      priority: { type: 'select', label: 'Priority', options: [{ label: 'Hi', value: 'hi' }] },
      estimate_hours: { type: 'number', label: 'Estimate' },
      progress: { type: 'text', label: 'Progress' },
      done: { type: 'boolean', label: 'Done' },
      due_date: { type: 'date', label: 'Due' },
      start_date: { type: 'date', label: 'Start' },
      end_date: { type: 'date', label: 'End' },
      labels: { type: 'text', label: 'Labels' },
      notes: { type: 'text', label: 'Notes' },
      parent: { type: 'master_detail', label: 'Parent', reference: 'p', required: true },
    },
  };

  const visible = (cols: any[]) => cols.filter((c) => !c.defaultHidden).map((c) => c.name);

  it('returns ALL columns — none dropped — and defaults a focused 6 visible', () => {
    const cols = deriveColumns(wideSchema, { booleanLabel, relationshipField: 'parent' });
    expect(cols.length).toBe(12);              // every editable column kept (parent FK excluded)
    expect(visible(cols).length).toBe(6);      // default-visible budget
    expect(cols.some((c) => c.defaultHidden)).toBe(true); // the rest collapsed, not gone
  });

  it('always keeps required columns visible (never default-hidden)', () => {
    const cols = deriveColumns(wideSchema, { booleanLabel, relationshipField: 'parent' });
    expect(visible(cols)).toContain('title');  // name-like + required
    expect(visible(cols)).toContain('status'); // required
  });

  it('collapses low-signal text columns into the chooser (hidden, not dropped)', () => {
    const cols = deriveColumns(wideSchema, { booleanLabel, relationshipField: 'parent' });
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    expect(byName.notes).toBeDefined();
    expect(byName.notes.defaultHidden).toBe(true);
    expect(byName.labels.defaultHidden).toBe(true);
  });

  it('preserves schema order (including hidden columns)', () => {
    const names = deriveColumns(wideSchema, { booleanLabel, relationshipField: 'parent' }).map((c) => c.name);
    const sorted = [...names].sort(
      (a, b) => Object.keys(wideSchema.fields).indexOf(a) - Object.keys(wideSchema.fields).indexOf(b),
    );
    expect(names).toEqual(sorted);
  });

  it('maxColumns: 0 marks no column hidden (all visible)', () => {
    const cols = deriveColumns(wideSchema, { booleanLabel, relationshipField: 'parent', maxColumns: 0 });
    expect(cols.length).toBe(12);
    expect(cols.every((c) => !c.defaultHidden)).toBe(true);
  });

  it('keeps all required columns visible even if more than the budget', () => {
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
    const cols = deriveColumns(reqHeavy, { booleanLabel, relationshipField: 'parent' });
    expect(visible(cols)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']); // 7 required visible
    expect(cols.find((c) => c.name === 'h')?.defaultHidden).toBe(true); // non-required collapsed
    expect(cols.length).toBe(8); // nothing dropped
  });
});

describe('deriveFormFields (per-row expand form)', () => {
  it('returns business fields, excluding system/audit/FK/computed', () => {
    const fields = deriveFormFields(taskSchema, { relationshipField: 'project' });
    expect(fields).toContain('title');
    expect(fields).toContain('status');
    expect(fields).toContain('assignee');
    expect(fields).not.toContain('id');         // system
    expect(fields).not.toContain('created_at'); // audit
    expect(fields).not.toContain('project');    // back-reference FK
    expect(fields).not.toContain('health');     // formula (computed)
  });

  it('keeps rich input types the grid omits (textarea/file/etc.)', () => {
    const rich = {
      fields: {
        title: { type: 'text', required: true },
        parent: { type: 'master_detail', reference: 'p', required: true },
        notes: { type: 'textarea' },
        cover: { type: 'image' },
        attachment: { type: 'file' },
        total: { type: 'summary' }, // computed → excluded
      },
    };
    const fields = deriveFormFields(rich, { relationshipField: 'parent' });
    expect(fields).toEqual(expect.arrayContaining(['title', 'notes', 'cover', 'attachment']));
    expect(fields).not.toContain('total');
    expect(fields).not.toContain('parent');
  });

  it('is surfaced on deriveDetail output', () => {
    const d = deriveDetail('showcase_task', taskSchema, 'showcase_project', { booleanLabel });
    expect(Array.isArray(d.formFields)).toBe(true);
    expect(d.formFields).toContain('title');
    expect(d.formFields).not.toContain('project');
  });
});

describe('hydrateColumns (fill types on bare author columns)', () => {
  it('infers each bare {name,label} column\'s widget type from the child schema', () => {
    const cols = hydrateColumns(
      [
        { name: 'title', label: 'Title' },
        { name: 'status', label: 'Status' },
        { name: 'estimate_hours', label: 'Est' },
        { name: 'budget', label: 'Budget' },
        { name: 'due_date', label: 'Due' },
        { name: 'assignee', label: 'Owner' },
      ] as any,
      taskSchema,
      { booleanLabel },
    );
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    expect(byName.title.type).toBe('text');
    expect(byName.status).toMatchObject({ type: 'select', options: [{ label: 'To Do', value: 'todo' }, { label: 'Done', value: 'done' }] });
    expect(byName.estimate_hours.type).toBe('number');
    expect(byName.budget.type).toBe('currency');
    expect(byName.due_date.type).toBe('date');
    expect(byName.assignee).toMatchObject({ type: 'lookup', reference: 'user', displayField: 'name' });
  });

  it('preserves the author\'s column set, order and labels', () => {
    const cols = hydrateColumns(
      [{ name: 'due_date', label: '合同时间' }, { name: 'status', label: 'Status' }] as any,
      taskSchema,
      { booleanLabel },
    );
    expect(cols.map((c) => c.name)).toEqual(['due_date', 'status']); // order kept, no extra columns
    expect(cols[0].label).toBe('合同时间'); // author label kept, not schema's "Due Date"
  });

  it('hydrates a bare file-field column into an upload column with its constraints (#2360)', () => {
    const schema = {
      fields: {
        expense: { type: 'master_detail', reference: 'expense' },
        receipt: { type: 'file', label: 'Receipt', multiple: true, accept: ['.pdf'] },
        photo: { type: 'image', label: 'Photo' },
      },
    };
    const cols = hydrateColumns([{ name: 'receipt' }, { name: 'photo' }] as any, schema, { booleanLabel });
    expect(cols[0]).toMatchObject({ type: 'file', multiple: true, accept: ['.pdf'] });
    expect(cols[1]).toMatchObject({ type: 'file', accept: ['image/*'] });
  });

  it('never overrides an explicit type the author already set', () => {
    const cols = hydrateColumns(
      [{ name: 'status', label: 'Status', type: 'text' }] as any,
      taskSchema,
      { booleanLabel },
    );
    expect(cols[0].type).toBe('text'); // author wins — not upgraded to select
    expect(cols[0].options).toBeUndefined();
  });

  it('leaves a column untouched when its field is absent from the schema', () => {
    const cols = hydrateColumns([{ name: 'ghost', label: 'Ghost' }] as any, taskSchema, { booleanLabel });
    expect(cols[0].type).toBeUndefined(); // unknown field → grid falls back to text
  });

  it('is a no-op without a schema or columns', () => {
    expect(hydrateColumns([{ name: 'x' }] as any, undefined, { booleanLabel })).toEqual([{ name: 'x' }]);
    expect(hydrateColumns(undefined, taskSchema, { booleanLabel })).toEqual([]);
  });
});

describe('deriveDetail hydrates explicit-but-untyped override columns', () => {
  it('fills widget types on bare author columns instead of passing them through raw', () => {
    const d = deriveDetail('showcase_task', taskSchema, 'showcase_project', {
      booleanLabel,
      relationshipField: 'project',
      columns: [{ name: 'status', label: 'Status' }, { name: 'due_date', label: 'Due' }] as any,
    });
    const byName = Object.fromEntries(d.columns.map((c) => [c.name, c]));
    expect(byName.status.type).toBe('select');
    expect(byName.due_date.type).toBe('date');
    expect(d.columns.map((c) => c.name)).toEqual(['status', 'due_date']); // author set kept
  });
});

describe('resolveInlineMode (grid vs form)', () => {
  const thin = { fields: { name: { type: 'text' }, amount: { type: 'currency' }, parent: { type: 'master_detail', reference: 'p' } } };
  const rich = { fields: { name: { type: 'text' }, notes: { type: 'textarea' }, parent: { type: 'master_detail', reference: 'p' } } };
  // The entry type is written out because the nine plain fields and the tenth
  // relation field do NOT have the same shape — only the relation carries
  // `reference`. Left to inference the `.map()` produces `{ type: string }`
  // entries and `.concat()` then rejects the relation for the extra key, which
  // reads as "the fixture is wrong" when the fixture is exactly right.
  type FieldEntry = [string, Record<string, string>];
  const wide = {
    fields: Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
        .map((n): FieldEntry => [n, { type: 'text' }])
        .concat([['parent', { type: 'master_detail', reference: 'p' }]]),
    ),
  };

  it('honors explicit grid/form', () => {
    expect(resolveInlineMode(thin, 'grid', { relationshipField: 'parent' })).toBe('grid');
    expect(resolveInlineMode(rich, 'grid', { relationshipField: 'parent' })).toBe('grid'); // explicit wins over heuristic
    expect(resolveInlineMode(thin, 'form', { relationshipField: 'parent' })).toBe('form');
  });

  it('smart default: thin child → grid', () => {
    expect(resolveInlineMode(thin, true, { relationshipField: 'parent' })).toBe('grid');
    expect(resolveInlineMode(thin, undefined, { relationshipField: 'parent' })).toBe('grid');
  });

  it('smart default: child with a rich/form-only type → form', () => {
    expect(resolveInlineMode(rich, true, { relationshipField: 'parent' })).toBe('form');
  });

  it('smart default: many business fields → form', () => {
    expect(resolveInlineMode(wide, true, { relationshipField: 'parent' })).toBe('form'); // 9 fields > 8
  });

  // #2654: file-family fields render a compact upload cell in the grid now, so a
  // LONE one no longer forces the per-row form ("attach a receipt per line").
  it('smart default: a single file/image field stays a grid', () => {
    const oneFile = { fields: { name: { type: 'text' }, receipt: { type: 'file' }, parent: { type: 'master_detail', reference: 'p' } } };
    const oneImage = { fields: { name: { type: 'text' }, photo: { type: 'image' }, parent: { type: 'master_detail', reference: 'p' } } };
    expect(resolveInlineMode(oneFile, true, { relationshipField: 'parent' })).toBe('grid');
    expect(resolveInlineMode(oneImage, true, { relationshipField: 'parent' })).toBe('grid');
  });

  it('smart default: several rich file fields (≥2) tip to form', () => {
    const twoFiles = { fields: { receipt: { type: 'file' }, photo: { type: 'image' }, parent: { type: 'master_detail', reference: 'p' } } };
    expect(resolveInlineMode(twoFiles, true, { relationshipField: 'parent' })).toBe('form');
  });

  it('smart default: a file field alongside a truly form-only field → form', () => {
    const mixed = { fields: { receipt: { type: 'file' }, notes: { type: 'textarea' }, parent: { type: 'master_detail', reference: 'p' } } };
    expect(resolveInlineMode(mixed, true, { relationshipField: 'parent' })).toBe('form');
  });
});

describe('deriveDetail', () => {
  it('resolves relationshipField + columns + amountField from the child schema', () => {
    const d = deriveDetail('showcase_task', taskSchema, 'showcase_project', { booleanLabel });
    expect(d.relationshipField).toBe('project');
    expect(d.columns.map((c) => c.name)).toContain('estimate_hours');
    // The running total prefers the (last) currency column over a raw number
    // like hours — a line-grid footer is almost always a money total.
    expect(d.amountField).toBe('budget');
  });

  it('maps a field expression to a read-only computed column and totals it', () => {
    const lineSchema = {
      fields: {
        invoice: { type: 'master_detail', reference: 'inv' },
        product: { type: 'text', label: 'Product', required: true },
        quantity: { type: 'number', label: 'Qty', required: true },
        unit_price: { type: 'currency', label: 'Unit Price' },
        // Normalized CEL envelope, as the server serves it.
        amount: { type: 'currency', label: 'Amount', scale: 2, expression: { dialect: 'cel', source: 'record.quantity * record.unit_price' } },
      },
    };
    const d = deriveDetail('inv_line', lineSchema, 'inv', { booleanLabel });
    const amountCol = d.columns.find((c) => c.name === 'amount')!;
    expect(amountCol.computed).toBe(true);
    expect(amountCol.expr).toBe('record.quantity * record.unit_price');
    expect(amountCol.required).toBe(false); // computed → never user-required
    expect(d.amountField).toBe('amount'); // running total prefers the computed line total
  });

  it('detects a sort/position field, excludes it from columns, and reports it as sortField', () => {
    const lineSchema = {
      fields: {
        invoice: { type: 'master_detail', reference: 'inv' },
        position: { type: 'number', label: 'Position' },
        product: { type: 'text', label: 'Product', required: true },
        quantity: { type: 'number', label: 'Qty', required: true },
      },
    };
    const d = deriveDetail('inv_line', lineSchema, 'inv', { booleanLabel });
    expect(d.sortField).toBe('position');
    expect(d.columns.map((c) => c.name)).not.toContain('position'); // not user-edited
    expect(d.formFields).not.toContain('position');
    expect(d.columns.map((c) => c.name)).toEqual(['product', 'quantity']);
  });

  it('honors explicit overrides over derived values', () => {
    const d = deriveDetail('showcase_task', taskSchema, 'showcase_project', {
      booleanLabel,
      relationshipField: 'project',
      columns: [{ name: 'title', type: 'text' }],
      amountField: 'budget',
    });
    expect(d.columns).toHaveLength(1);
    expect(d.amountField).toBe('budget');
  });

  it('throws a helpful error when no relationship can be resolved', () => {
    expect(() => deriveDetail('showcase_task', { fields: { title: { type: 'text' } } }, 'showcase_project', { booleanLabel }))
      .toThrow(/could not find a lookup\/master_detail field/i);
  });
});
