// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36860 — the cell renderers and the path/default readers behind
 * the served list columns, pinned without the page around them.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';

import { renderListCell, schemaDefaultAt, servedListColumns, valueAtPath, withExtraColumns } from './servedListColumns';

function text(node: React.ReactNode): string {
  const { container } = render(<>{node}</>);
  return container.textContent ?? '';
}

describe('renderListCell', () => {
  it('count counts an array and a keyed record', () => {
    expect(text(renderListCell('count', [1, 2, 3]))).toBe('3');
    expect(text(renderListCell('count', { a: 1, b: 2 }))).toBe('2');
    expect(text(renderListCell('count', []))).toBe('0');
  });

  it('list joins an array and shows a single value as itself', () => {
    expect(text(renderListCell('list', ['a', 'b']))).toBe('a, b');
    expect(text(renderListCell('list', 'account'))).toBe('account');
  });

  it('summary joins the scalar members of an object', () => {
    expect(text(renderListCell('summary', { type: 'cron', expression: '0 0 * * *', timezone: 'UTC' }))).toBe('cron · 0 0 * * * · UTC');
  });

  it('summary reads an expression envelope member as its source — a served cron schedule shows when it runs', () => {
    const served = { type: 'cron', expression: { dialect: 'cron', source: '0 2 * * *' }, timezone: 'UTC' };
    expect(text(renderListCell('summary', served))).toBe('cron · 0 2 * * * · UTC');
    // Control: an object member with no `source` stays out, as before.
    expect(text(renderListCell('summary', { type: 'cron', expression: { dialect: 'cron' }, timezone: 'UTC' }))).toBe('cron · UTC');
  });

  it('boolean marks, badge shows the value, text shows a scalar as written', () => {
    expect(text(renderListCell('boolean', true))).toBe('✓');
    expect(text(renderListCell('boolean', false))).toBe('✗');
    expect(text(renderListCell('badge', 'GET'))).toBe('GET');
    expect(text(renderListCell(undefined, 42))).toBe('42');
  });

  it('an empty value is the empty cell, not a blank and not a zero', () => {
    const empty = text(renderListCell(undefined, undefined));
    expect(text(renderListCell('list', []))).toBe(empty);
    expect(text(renderListCell('badge', ''))).toBe(empty);
    expect(text(renderListCell('count', undefined))).toBe(empty);
  });
});

describe('valueAtPath / schemaDefaultAt', () => {
  it('reads a dotted path and answers undefined past a missing segment', () => {
    expect(valueAtPath({ model: { model: 'gpt-4o' } }, 'model.model')).toBe('gpt-4o');
    expect(valueAtPath({ model: 'x' }, 'model.model')).toBeUndefined();
    expect(valueAtPath({}, 'objectParams.object')).toBeUndefined();
  });

  it('finds a default at a dotted path, through union arms', () => {
    const schema = {
      properties: {
        priority: { type: 'number', default: 100 },
        schedule: { anyOf: [{ properties: { timezone: { default: 'UTC' } } }] },
      },
    };
    expect(schemaDefaultAt(schema, 'priority')).toBe(100);
    expect(schemaDefaultAt(schema, 'schedule.timezone')).toBe('UTC');
    expect(schemaDefaultAt(schema, 'name')).toBeUndefined();
    expect(schemaDefaultAt(undefined, 'priority')).toBeUndefined();
  });
});

describe('servedListColumns / withExtraColumns', () => {
  it('answers undefined for a type that serves no list, so the caller falls back', () => {
    expect(servedListColumns(undefined, undefined)).toBeUndefined();
    expect(servedListColumns({ columns: [] } as never, undefined)).toBeUndefined();
  });

  it('marks every served header as already localized', () => {
    const cols = servedListColumns({ columns: [{ field: 'name', label: '名称' }] }, undefined)!;
    expect(cols).toEqual([expect.objectContaining({ key: 'name', label: '名称', labelLocalized: true })]);
  });

  it('appends only the extra columns the base does not already show', () => {
    const base = [{ key: 'name', label: 'Name' }];
    const merged = withExtraColumns(base, [{ key: 'name', label: 'dup' }, { key: '_packageId', label: 'Package' }]);
    expect(merged.map((c) => c.key)).toEqual(['name', '_packageId']);
    expect(withExtraColumns(base, undefined)).toBe(base);
  });
});
