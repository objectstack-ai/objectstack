// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#34391 — the action answer's field formats gain `table`, with the
// field row's `columns`. One row builder serves `resultDialog.fields` and
// `preflight.fields`, so every pin here runs at both surfaces.
//
// Refusals are asserted on the issue envelope (code + path) and on the first
// clause of the message, never the full prose. The CONTROL block holds every
// pre-existing format and row parsing unchanged.

import { describe, it, expect } from 'vitest';
import { ActionSchema } from './action.zod';

const PRE_EXISTING_FORMATS = ['qrcode', 'code-list', 'secret', 'text', 'json'] as const;

const resultDialogAction = (resultDialog: Record<string, unknown>) => ({
  name: 'add_people',
  label: 'Add people',
  type: 'api',
  target: '/api/v1/x/add-people',
  resultDialog,
});

const preflightAction = (fields: unknown[]) => ({
  name: 'import_people',
  label: 'Import people',
  type: 'api',
  target: '/api/v1/x/import',
  params: [{ name: 'file_id', type: 'text', required: true }],
  preflight: { read: { url: '/api/v1/x/import-plan?file=${param.file_id}' }, path: 'data', fields },
});

/** The two surfaces built from the one row, each with the issue-path prefix of its `fields`. */
const SURFACES = [
  ['resultDialog.fields', (fields: unknown[]) => resultDialogAction({ fields })],
  ['preflight.fields', (fields: unknown[]) => preflightAction(fields)],
] as const;

type Issue = { path: PropertyKey[]; code: string; message: string };
const issuesOf = (value: unknown): Issue[] => {
  const r = ActionSchema.safeParse(value);
  return r.success ? [] : (r.error.issues as Issue[]);
};
const issuesAt = (value: unknown, path: string): Issue[] =>
  issuesOf(value).filter((i) => i.path.join('.') === path);

const table = {
  path: 'rows',
  label: 'Result per person',
  format: 'table',
  columns: [
    { path: 'email', label: 'Email' },
    { path: 'outcome', format: 'text' },
    { path: 'refusal.reason', label: { en: 'Reason', 'zh-CN': '原因' } },
  ],
};

describe('CONTROL — every pre-existing format and row parses unchanged', () => {
  describe.each(SURFACES)('%s', (_prefix, build) => {
    it.each(PRE_EXISTING_FORMATS)('`format: %j` on a field parses, the row kept as written', (format) => {
      const row = { path: 'value', label: 'Value', format };
      const r = ActionSchema.safeParse(build([row]));
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    });

    it('a row with only `path` parses', () => {
      expect(issuesOf(build([{ path: 'value' }]))).toEqual([]);
    });

    it('the row still refuses an unknown key, an unknown format, and answers its aliases', () => {
      expect(issuesAt(build([{ key: 'value' }]), `${_prefix}.0`).map((i) => i.code)).toEqual(['unrecognized_keys']);
      expect(issuesAt(build([{ key: 'value' }]), `${_prefix}.0`)[0].message).toContain('path');
      expect(issuesAt(build([{ path: 'v', format: 'chart' }]), `${_prefix}.0.format`).map((i) => i.code))
        .toEqual(['invalid_value']);
    });
  });

  it.each(PRE_EXISTING_FORMATS)('`resultDialog.format: %j` still parses as the dialog-level default', (format) => {
    expect(issuesOf(resultDialogAction({ format, fields: [{ path: 'value' }] }))).toEqual([]);
  });
});

describe('`format: \'table\'` with `columns` — the widening', () => {
  it.each(SURFACES)('parses on %s, and the row is kept as written', (prefix, build) => {
    const r = ActionSchema.safeParse(build([table]));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    const parsed = r.success ? r.data : undefined;
    const rows = prefix.startsWith('resultDialog') ? parsed?.resultDialog?.fields : parsed?.preflight?.fields;
    expect(rows).toEqual([table]);
  });

  it.each(PRE_EXISTING_FORMATS)('a cell takes `format: %j` (the field set minus `table`)', (format) => {
    const row = { ...table, columns: [{ path: 'email', format }] };
    for (const [, build] of SURFACES) expect(issuesOf(build([row]))).toEqual([]);
  });

  it('a column answers the row\'s aliases where they apply (`key`/`field`/`name` → path, `title` → label, `display`/`render` → format)', () => {
    for (const [prefix, build] of SURFACES) {
      for (const [alias, canonical] of [
        ['key', 'path'], ['field', 'path'], ['name', 'path'], ['title', 'label'], ['display', 'format'], ['render', 'format'],
      ] as const) {
        const column = { path: 'email', [alias]: alias === 'display' || alias === 'render' ? 'text' : 'x' };
        const issues = issuesAt(build([{ ...table, columns: [column] }]), `${prefix}.0.columns.0`);
        expect(issues.map((i) => i.code), `${prefix} ${alias}`).toEqual(['unrecognized_keys']);
        expect(issues[0].message, `${prefix} ${alias}`).toContain(`\`${canonical}\``);
      }
    }
  });
});

describe('refusal 1 — `columns` beside a format other than `table`', () => {
  describe.each(SURFACES)('%s', (prefix, build) => {
    it.each(PRE_EXISTING_FORMATS)('refuses `columns` beside `format: %j`', (format) => {
      const issues = issuesAt(build([{ path: 'rows', format, columns: table.columns }]), `${prefix}.0.columns`);
      expect(issues.map((i) => i.code)).toEqual(['custom']);
      expect(issues[0].message).toMatch(/^`columns` lists the cells of a `format: 'table'` field/);
      expect(issues[0].message).toContain(`\`${format}\``);
    });

    it('refuses `columns` on a field with no `format` (the dialog-level default is never `table`)', () => {
      const issues = issuesAt(build([{ path: 'rows', columns: table.columns }]), `${prefix}.0.columns`);
      expect(issues.map((i) => i.code)).toEqual(['custom']);
      expect(issues[0].message).toContain('the dialog-level default is never `table`');
    });
  });
});

describe('refusal 2 — `format: \'table\'` without `columns` (refused, never defaulted to the element\'s keys)', () => {
  describe.each(SURFACES)('%s', (prefix, build) => {
    it.each([
      ['omitted', undefined],
      ['empty', []],
    ])('refuses `columns` %s', (_label, columns) => {
      const row = columns === undefined ? { path: 'rows', format: 'table' } : { path: 'rows', format: 'table', columns };
      const issues = issuesAt(build([row]), `${prefix}.0.columns`);
      expect(issues.map((i) => i.code)).toEqual(['custom']);
      expect(issues[0].message).toMatch(/^`format: 'table'` draws each element of the array at `path` as one row/);
    });
  });
});

describe('refusal 3 — a nested `table` in a column', () => {
  it.each(SURFACES)('refuses a cell `format: \'table\'` on %s, by name', (prefix, build) => {
    const row = { ...table, columns: [{ path: 'children', format: 'table' }] };
    const issues = issuesAt(build([row]), `${prefix}.0.columns.0.format`);
    expect(issues.map((i) => i.code)).toEqual(['invalid_value']);
    expect(issues[0].message).toMatch(/^`table` is a field format, not a cell format/);
  });
});

describe('R3 — the dialog-level `format` takes every field format but `table`', () => {
  it('refuses `resultDialog.format: \'table\'` by name', () => {
    const issues = issuesAt(resultDialogAction({ format: 'table', fields: [{ path: 'value' }] }), 'resultDialog.format');
    expect(issues.map((i) => i.code)).toEqual(['invalid_value']);
    expect(issues[0].message).toMatch(/^`table` is a per-field format only/);
  });

  it('an unknown dialog-level format keeps the generic enum refusal', () => {
    const issues = issuesAt(resultDialogAction({ format: 'chart' }), 'resultDialog.format');
    expect(issues.map((i) => i.code)).toEqual(['invalid_value']);
    expect(issues[0].message).not.toContain('per-field format only');
  });
});
