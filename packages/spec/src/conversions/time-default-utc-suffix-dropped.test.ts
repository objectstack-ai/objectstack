// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { ObjectSchema } from '../data/object.zod.js';
import { ActionSchema } from '../ui/action.zod.js';
import { applyConversions } from './apply.js';
import { ALL_CONVERSIONS } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import { CONVERSION_TODO_CODE, type ConversionNotice, type ConversionTodoNotice } from './types.js';

/**
 * [#20740] `time-default-utc-suffix-dropped` — the ADR-0087 disposition of a
 * stored `time` default with a zone, now that the stored form refuses one.
 *
 * The fixture pair in `conversions.test.ts` proves before → after over the
 * whole table. This file pins it where it matters, on a stored row: a `Z` or a
 * zero offset is dropped and the row then parses; a non-zero offset is left
 * byte-identical, reported as a TODO naming the field, and still refused by the
 * schema at that field.
 */

const ID = 'time-default-utc-suffix-dropped';

function storedObject(defaultValue: unknown, type = 'time') {
  return { name: 'shift', label: 'Shift', fields: { starts_at: { type, label: 'Starts', defaultValue } } };
}

function convertStored(type: string, row: Record<string, unknown>) {
  const notices: ConversionNotice[] = [];
  const todos: ConversionTodoNotice[] = [];
  const item = applyConversionsToStoredItem(type, row, {
    onNotice: (n) => notices.push(n),
    onTodo: (t) => todos.push(t),
  });
  return { item, notices: notices.filter((n) => n.conversionId === ID), todos };
}

function defaultValueIssuePaths(row: unknown): string[] {
  const r = ObjectSchema.safeParse(row);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.')).filter((p) => p.endsWith('defaultValue'));
}

describe('time-default-utc-suffix-dropped (ADR-0087 D2)', () => {
  it('is registered for protocol 18 and retired from the authoring load path', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID);
    expect(entry, 'the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
  });

  it('a stored field default with a `Z` or a zero offset loses the suffix, and the row then parses', () => {
    for (const [stored, wallClock] of [
      ['10:00Z', '10:00'],
      ['10:00:00+00:00', '10:00:00'],
      ['10:00:00.250-0000', '10:00:00.250'],
    ] as const) {
      const row = storedObject(stored);
      expect(defaultValueIssuePaths(row), `${stored} is refused before the replay`).toEqual(['fields.starts_at.defaultValue']);
      const { item, notices, todos } = convertStored('object', row);
      expect((item as typeof row).fields.starts_at.defaultValue).toBe(wallClock);
      expect(notices.map((n) => [n.path, n.from, n.to])).toEqual([
        ['objects[0].fields.starts_at.defaultValue', JSON.stringify(stored), JSON.stringify(wallClock)],
      ]);
      expect(todos).toEqual([]);
      expect(defaultValueIssuePaths(item), `${stored} parses after the replay`).toEqual([]);
    }
  });

  it('a non-zero offset is left as stored, reported as a TODO naming the field, and still refused at that field', () => {
    const row = storedObject('10:00+08:00');
    const { item, notices, todos } = convertStored('object', row);
    expect(item, 'nothing is rewritten').toBe(row);
    expect(notices).toEqual([]);
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({
      code: CONVERSION_TODO_CODE,
      conversionId: ID,
      path: 'objects[0].fields.starts_at.defaultValue',
      from: '"10:00+08:00"',
    });
    expect(todos[0]!.reason).toContain('"starts_at"');
    expect(defaultValueIssuePaths(item)).toEqual(['fields.starts_at.defaultValue']);
  });

  it('a stored action row: a `time` param default loses a `Z`; other params are untouched', () => {
    const row = {
      name: 'clock_in',
      label: 'Clock in',
      type: 'script',
      target: 'clockIn',
      params: [
        { name: 'at', type: 'time', defaultValue: '07:45Z' },
        { name: 'note', type: 'text', defaultValue: '07:45Z' },
        { field: 'starts_at', defaultValue: '07:45Z' },
      ],
    };
    expect(ActionSchema.safeParse(row).success).toBe(false);
    const { item, notices } = convertStored('action', row);
    const params = (item as typeof row).params;
    expect(params[0]!.defaultValue).toBe('07:45');
    expect(params[1]).toBe(row.params[1]);
    expect(params[2]).toBe(row.params[2]);
    expect(notices.map((n) => n.path)).toEqual(['actions[0].params[0].defaultValue']);
    expect(ActionSchema.safeParse(item).success).toBe(true);
  });

  it('control: what the old stored form refused, a zone-less default and a non-`time` field are the same reference', () => {
    for (const row of [
      storedObject('10:00'),
      storedObject('10:00z'),
      storedObject('25:00Z'),
      storedObject('10:00Z', 'text'),
      storedObject({ dialect: 'cel', source: 'now()' }),
    ]) {
      const { item, notices, todos } = convertStored('object', row);
      expect(item).toBe(row);
      expect(notices).toEqual([]);
      expect(todos).toEqual([]);
    }
  });

  it('is idempotent — the converted result replays to itself with no second notice', () => {
    const once = applyConversions({ objects: [storedObject('10:00Z')] }, { includeRetired: true });
    const notices: ConversionNotice[] = [];
    const twice = applyConversions(once, { includeRetired: true, onNotice: (n) => notices.push(n) });
    expect(twice).toBe(once);
    expect(notices).toEqual([]);
  });
});
