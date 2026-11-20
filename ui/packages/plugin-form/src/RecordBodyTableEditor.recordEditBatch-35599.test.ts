/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record-page save's ONE batch (objectstack#35599): the record's field
 * draft plus every body table's lines, each op traceable to the line that
 * wrote it — and a refused batch placed back on that line.
 */

import { describe, it, expect } from 'vitest';
import { attributeRecordEditRefusal, buildRecordEditBatch } from './RecordBodyTableEditor';

const childSchema = {
  fields: {
    id: { type: 'text' },
    product: { type: 'text' },
    quantity: { type: 'number' },
    order: { type: 'master_detail', reference_to: 'order' },
  },
};

const lines = {
  id: 'order_line.order',
  childObject: 'order_line',
  relationshipField: 'order',
  childSchema,
  original: [
    { id: 'l1', product: 'A', quantity: 1, order: 'o1' },
    { id: 'l2', product: 'B', quantity: 2, order: 'o1' },
  ],
  rows: [
    { id: 'l1', product: 'A', quantity: 5, order: 'o1' }, // edited
    { product: '', quantity: undefined }, // blank ghost line: no op
    { product: 'C', quantity: 3 }, // new
    // l2 removed
  ],
};

const notes = {
  id: 'order_note.order',
  childObject: 'order_note',
  relationshipField: 'order',
  childSchema: { fields: { id: { type: 'text' }, body: { type: 'text' }, order: { type: 'master_detail' } } },
  original: [],
  rows: [{ body: 'hello' }],
};

describe('buildRecordEditBatch — one batch for the record and all its body tables', () => {
  it('op 0 is the record update; each table is diffed into create / update / delete, traced to its line', () => {
    const { ops, owners } = buildRecordEditBatch('order', 'o1', { name: 'Renamed' }, [lines, notes]);
    expect(ops.map((o) => [o.object, o.action, o.id ?? null])).toEqual([
      ['order', 'update', 'o1'],
      ['order_line', 'create', null],
      ['order_line', 'update', 'l1'],
      ['order_line', 'delete', 'l2'],
      ['order_note', 'create', null],
    ]);
    expect(ops[0].data).toEqual({ name: 'Renamed' });
    // The new line carries its FK to the record; the edited line only its dirty field.
    expect(ops[1].data).toMatchObject({ product: 'C', quantity: 3, order: 'o1' });
    expect(ops[2].data).toEqual({ quantity: 5 });
    expect(owners).toEqual([
      { kind: 'parent' },
      { kind: 'row', table: 'order_line.order', row: 2 }, // past the blank line, by position
      { kind: 'row', table: 'order_line.order', row: 0 },
      { kind: 'row', table: 'order_line.order', row: -1 }, // a removed line is no longer drawn
      { kind: 'row', table: 'order_note.order', row: 0 },
    ]);
  });

  it('an untouched table emits no ops', () => {
    const { ops } = buildRecordEditBatch('order', 'o1', {}, [{ ...lines, rows: lines.original }]);
    expect(ops).toHaveLength(1);
  });
});

describe('buildRecordEditBatch — a new line that kept the defaults it started on (objectstack#35816)', () => {
  const tasks = {
    id: 'meeting_task.meeting',
    childObject: 'meeting_task',
    relationshipField: 'meeting',
    childSchema: {
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        status: { type: 'select', defaultValue: 'pending' },
        meeting: { type: 'master_detail' },
      },
    },
    newRowValues: { status: 'pending' },
    original: [],
    rows: [
      { name: null, status: 'pending' }, // added, left as it came: no op
      { name: 'Book the room', status: 'pending' }, // typed a name: created with the default
      { name: null, status: 'done' }, // changed the default: that is input
    ],
  };

  it('is skipped like a blank line; a line with input is created, its default included, traced to its position', () => {
    const { ops, owners } = buildRecordEditBatch('meeting', 'm1', {}, [tasks]);
    expect(ops.map((o) => [o.object, o.action])).toEqual([
      ['meeting', 'update'],
      ['meeting_task', 'create'],
      ['meeting_task', 'create'],
    ]);
    expect(ops[1].data).toMatchObject({ name: 'Book the room', status: 'pending', meeting: 'm1' });
    expect(ops[2].data).toMatchObject({ status: 'done', meeting: 'm1' });
    expect(owners.slice(1)).toEqual([
      { kind: 'row', table: 'meeting_task.meeting', row: 1 },
      { kind: 'row', table: 'meeting_task.meeting', row: 2 },
    ]);
  });

  it('CONTROL: without the start values the same untouched line is input and is created', () => {
    const { ops } = buildRecordEditBatch('meeting', 'm1', {}, [{ ...tasks, newRowValues: undefined }]);
    expect(ops.filter((o) => o.action === 'create')).toHaveLength(3);
  });
});

describe('attributeRecordEditRefusal — a refused batch is placed where it belongs', () => {
  const { ops, owners } = buildRecordEditBatch('order', 'o1', { name: 'Renamed' }, [lines, notes]);
  const refused = (fields: Array<{ field: string; message: string }>) =>
    Object.assign(new Error('Validation failed'), { details: { error: 'Validation failed', fields } });

  it('a field only the record writes goes on the record; a field one line writes goes on that line', () => {
    const r = attributeRecordEditRefusal(
      refused([
        { field: 'name', message: 'Name is too long' },
        { field: 'body', message: 'Body is required' },
      ]),
      ops,
      owners,
    );
    expect(r.fieldErrors).toEqual({ name: 'Name is too long' });
    expect(r.rowErrors).toEqual({ 'order_note.order': [{ row: 0, field: 'body', message: 'Body is required' }] });
    expect(r.tableErrors).toEqual({});
    expect(r.message).toBe('Validation failed');
  });

  it('a field several lines of a table write goes on the table, not on a guessed line', () => {
    // `product` is carried by the new line only — the edited line's update carries only `quantity`.
    const r = attributeRecordEditRefusal(refused([{ field: 'product', message: 'Unknown product' }]), ops, owners);
    expect(r.rowErrors).toEqual({ 'order_line.order': [{ row: 2, field: 'product', message: 'Unknown product' }] });
    const both = attributeRecordEditRefusal(refused([{ field: 'quantity', message: 'Must be positive' }]), ops, owners);
    expect(both.rowErrors).toEqual({});
    expect(both.tableErrors).toEqual({ 'order_line.order': ['Must be positive'] });
  });

  it('a reason that names no field (a lock) stays the summary line', () => {
    const lock = Object.assign(new Error('locked'), {
      details: { error: 'This Order is locked while an approval is in progress' },
    });
    const r = attributeRecordEditRefusal(lock, ops, owners);
    expect(r.fieldErrors).toBeNull();
    expect(r.rowErrors).toEqual({});
    expect(r.message).toBe('This Order is locked while an approval is in progress');
  });
});
