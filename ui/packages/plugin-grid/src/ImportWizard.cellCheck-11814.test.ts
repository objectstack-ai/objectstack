/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * The Import Wizard preview's cell check (objectui#11814).
 *
 * The import button counts the rows the preview and the server's dry run found
 * nothing on, so a cell is refused here only where the server's import refuses
 * it. The server side is the framework's `import-coerce.ts` (`matchOption`,
 * `splitMulti`, `parseNumberCell`) followed by the engine's `validateRecord`;
 * each expectation below states the server verdict it mirrors.
 */
import { describe, it, expect } from 'vitest';
import { __testables } from './ImportWizard';

const { checkImportCell, parseImportNumber, mergeRowFindings, transformedSourceColumns } = __testables;

const PRIORITY = {
  name: 'priority',
  label: 'Priority',
  type: 'select',
  options: [{ label: 'Low', value: 'lo' }, { label: 'High', value: 'high' }],
};
const TAGS = {
  name: 'tags',
  label: 'Tags',
  type: 'multiselect',
  options: [{ label: 'Red', value: 'red' }, { label: 'Blue', value: 'blue' }],
};
const OFF = { keepUnknownOptions: false, requireValues: true };
const KEEP = { keepUnknownOptions: true, requireValues: true };

describe('checkImportCell: select and multiselect cells against the field options', () => {
  it('refuses a value that is neither an option value nor an option label', () => {
    expect(checkImportCell('Bogus', PRIORITY, OFF)).toEqual({ code: 'invalid_option', value: 'Bogus' });
  });

  it('takes an option label in any case, and an option value exactly, after trimming', () => {
    for (const cell of ['High', 'high', 'HIGH', '  High ', 'lo', 'Low', 'LOW']) {
      expect(checkImportCell(cell, PRIORITY, OFF), cell).toBeUndefined();
    }
  });

  it('matches an option value case-sensitively, as the server does', () => {
    // `LO` is not the value `lo`, and not the label `Low`.
    expect(checkImportCell('LO', PRIORITY, OFF)).toEqual({ code: 'invalid_option', value: 'LO' });
  });

  it('compares a numeric option value as text', () => {
    const field = { name: 'n', label: 'N', type: 'radio', options: [{ label: 'One', value: 1 }] };
    expect(checkImportCell('1', field, OFF)).toBeUndefined();
    expect(checkImportCell('2', field, OFF)).toEqual({ code: 'invalid_option', value: '2' });
  });

  it('takes anything in an option field that declares no options', () => {
    expect(checkImportCell('anything', { name: 'l', label: 'L', type: 'tags' }, OFF)).toBeUndefined();
    expect(checkImportCell('anything', { name: 's', label: 'S', type: 'select', options: [] }, OFF)).toBeUndefined();
  });

  it('reads a bare-string option as both value and label', () => {
    const field = { name: 's', label: 'S', type: 'select', options: ['Open', 'Closed'] };
    expect(checkImportCell('open', field, OFF)).toBeUndefined();
    expect(checkImportCell('Pending', field, OFF)).toEqual({ code: 'invalid_option', value: 'Pending' });
  });

  it('splits a multi-option cell on , ; 、 and newlines and names the refused token', () => {
    expect(checkImportCell('red; Blue、x', TAGS, OFF)).toEqual({ code: 'invalid_option', value: 'x' });
    expect(checkImportCell('red,blue', TAGS, OFF)).toBeUndefined();
    expect(checkImportCell('Red\nBLUE', TAGS, OFF)).toBeUndefined();
    expect(checkImportCell(', ;', TAGS, OFF)).toBeUndefined();
  });

  it('refuses a single-option cell only when it fails read whole and read as a list', () => {
    // The wizard's field shape carries no `multiple`, and the server splits a
    // `select` flagged `multiple: true`. A list of valid options is taken.
    expect(checkImportCell('high, lo', PRIORITY, OFF)).toBeUndefined();
    expect(checkImportCell('high, Bogus', PRIORITY, OFF)).toEqual({ code: 'invalid_option', value: 'high, Bogus' });
  });

  it('with Keep unknown option values on, takes an unknown value on a writable field (objectui#11970)', () => {
    // The server's coercion keeps the value, and the engine's option check
    // admits exactly the values that import kept (objectstack#22183).
    expect(checkImportCell('Bogus', PRIORITY, KEEP)).toBeUndefined();
    expect(checkImportCell('high, Bogus', PRIORITY, KEEP)).toBeUndefined();
    expect(checkImportCell('red, x', TAGS, KEEP)).toBeUndefined();
  });

  it('with Keep unknown option values on, takes an unknown value on a match-only field', () => {
    const code = { ...PRIORITY, name: 'code', label: 'Code', matchOnly: true };
    expect(checkImportCell('Zed', code, KEEP)).toBeUndefined();
  });

  it('with Keep unknown option values off, refuses an unknown value on a writable and a match-only field alike', () => {
    const code = { ...PRIORITY, name: 'code', label: 'Code', matchOnly: true };
    expect(checkImportCell('Bogus', PRIORITY, OFF)).toEqual({ code: 'invalid_option', value: 'Bogus' });
    expect(checkImportCell('red, x', TAGS, OFF)).toEqual({ code: 'invalid_option', value: 'x' });
    expect(checkImportCell('Zed', code, OFF)).toEqual({ code: 'invalid_option', value: 'Zed' });
  });

  it('with Keep unknown option values on, still refuses a bad cell of a type that is not an option type', () => {
    // The setting reaches the option check only.
    expect(checkImportCell('abc', { name: 'n', label: 'N', type: 'number' }, KEEP))
      .toEqual({ code: 'invalid_number', value: 'abc' });
  });
});

describe('checkImportCell: blank cells and the other types', () => {
  const title = { name: 'title', label: 'Title', type: 'text', required: true };

  it('refuses a blank required cell only where the write is a create', () => {
    expect(checkImportCell('', title, OFF)).toEqual({ code: 'required' });
    expect(checkImportCell('   ', title, OFF)).toEqual({ code: 'required' });
    expect(checkImportCell('', title, { keepUnknownOptions: false, requireValues: false })).toBeUndefined();
  });

  it('reads a whitespace-only cell as blank, as the server does', () => {
    for (const type of ['number', 'boolean', 'date', 'email', 'select']) {
      expect(checkImportCell('  ', { name: 'f', label: 'F', type, options: PRIORITY.options }, OFF), type).toBeUndefined();
    }
  });

  it('refuses a number only where the server refuses it', () => {
    const amount = { name: 'amount', label: 'Amount', type: 'currency' };
    for (const cell of ['1,234', '$12', '¥5', '25%', '(1,234)', '1e3', '.5', ' 12 ']) {
      expect(checkImportCell(cell, amount, OFF), cell).toBeUndefined();
    }
    for (const cell of ['abc', '0x10', 'Infinity', '12.', '3,14', '1,2,3', '1 234']) {
      expect(checkImportCell(cell, amount, OFF), cell).toEqual({ code: 'invalid_number', value: cell.trim() });
    }
  });

  it('keeps the boolean, date and email checks', () => {
    expect(checkImportCell('是', { name: 'b', label: 'B', type: 'boolean' }, OFF)).toBeUndefined();
    expect(checkImportCell('maybe', { name: 'b', label: 'B', type: 'boolean' }, OFF)).toEqual({ code: 'invalid_boolean', value: 'maybe' });
    expect(checkImportCell('2026-07-15', { name: 'd', label: 'D', type: 'date' }, OFF)).toBeUndefined();
    expect(checkImportCell('abc', { name: 'd', label: 'D', type: 'date' }, OFF)).toEqual({ code: 'invalid_date', value: 'abc' });
    expect(checkImportCell('a@b', { name: 'e', label: 'E', type: 'email' }, OFF)).toEqual({ code: 'invalid_email', value: 'a@b' });
  });
});

describe('parseImportNumber (the server parseNumberCell grammar)', () => {
  it('reads what the server reads', () => {
    expect(parseImportNumber('1,234')).toBe(1234);
    expect(parseImportNumber('12,345.67')).toBe(12345.67);
    expect(parseImportNumber('(1,234)')).toBe(-1234);
    expect(parseImportNumber('€ 7')).toBe(7);
    expect(parseImportNumber('25%')).toBe(25);
    expect(parseImportNumber('-3')).toBe(-3);
    expect(parseImportNumber('+4')).toBe(4);
  });

  it('refuses a decimal comma and any comma that does not group thousands', () => {
    for (const cell of ['3,14', '1,5', '1.000,5', '1234,567', '1,0000', '12,345.6,7']) {
      expect(parseImportNumber(cell), cell).toBeUndefined();
    }
  });
});

describe('mergeRowFindings: one list per row, client and server', () => {
  const client = new Map([
    [1, [{ source: 'client' as const, field: PRIORITY, csvIdx: 1, refusal: { code: 'invalid_option' as const, value: 'Bogus' } }]],
  ]);
  const csvIdxByField = new Map([['priority', 1], ['estimate', 2]]);
  const dryRun = {
    object: 'task', dryRun: true, writeMode: 'insert' as const, total: 3,
    ok: 1, errors: 2, created: 1, updated: 0, skipped: 0,
    results: [
      { row: 1, ok: true, action: 'created' as const },
      { row: 2, ok: false, action: 'failed' as const, field: 'priority', code: 'invalid_option', error: 'x' },
      { row: 2, ok: false, action: 'failed' as const, field: 'owner', code: 'required', error: 'y' },
      { row: 3, ok: false, action: 'failed' as const, field: 'estimate', code: 'invalid_number', error: 'z' },
      { row: 0, ok: false, action: 'failed' as const, error: 'request refused' },
    ],
  };

  it('keeps each row once, the client finding first, the server finding on the same field dropped', () => {
    const { byRow } = mergeRowFindings(client, dryRun, csvIdxByField, 3);
    expect([...byRow.keys()].sort()).toEqual([1, 2]);
    const row2 = byRow.get(1)!;
    expect(row2.map((f) => f.source)).toEqual(['client', 'server']);
    expect(row2[1]).toMatchObject({ source: 'server', result: { field: 'owner' }, csvIdx: undefined });
    expect(byRow.get(2)).toEqual([{ source: 'server', result: dryRun.results[3], csvIdx: 2 }]);
  });

  it('returns a dry-run result with no row of its own apart from the rows', () => {
    expect(mergeRowFindings(client, dryRun, csvIdxByField, 3).request).toEqual([dryRun.results[4]]);
  });

  it('is the client findings alone before any dry run', () => {
    const { byRow, request } = mergeRowFindings(client, null, csvIdxByField, 3);
    expect([...byRow.keys()]).toEqual([1]);
    expect(request).toEqual([]);
  });
});

describe('transformedSourceColumns', () => {
  it('names the source columns a named mapping transforms', () => {
    const m = {
      name: 'm', targetObject: 'task',
      fieldMapping: [
        { source: 'Prio', target: 'priority', transform: 'map' },
        { source: 'Title', target: 'title', transform: 'none' },
        { source: 'Est', target: 'estimate' },
      ],
    };
    expect([...transformedSourceColumns(m, ['Title', 'prio', 'Est'])]).toEqual([1]);
    expect([...transformedSourceColumns(null, ['Title'])]).toEqual([]);
  });
});
