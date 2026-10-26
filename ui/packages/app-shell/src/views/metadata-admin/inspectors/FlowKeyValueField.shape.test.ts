// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { toEntries, rowsToValue, toRows, switchRowMode, type Row } from './FlowKeyValueField';
import { valueEnvelopeRefusal } from './flow-value-envelope';

const row = (key: string, raw: string): Row => ({ id: key, key, raw });

describe('FlowKeyValueField shape handling (#1934 — assignment array form)', () => {
  it('reads the object-map shape into entries', () => {
    expect(toEntries({ a: 1, b: 'x' })).toEqual([
      ['a', 1],
      ['b', 'x'],
    ]);
  });

  it('reads the assignment ARRAY shape ({variable|name|key, value}) into entries', () => {
    expect(toEntries([{ variable: 'lead_score', value: 0 }, { variable: 'qualified', value: false }])).toEqual([
      ['lead_score', 0],
      ['qualified', false],
    ]);
    expect(toEntries([{ name: 'a', value: 1 }, { key: 'b', value: 2 }])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('ignores a non-object / non-array value', () => {
    expect(toEntries('nope')).toEqual([]);
    expect(toEntries(null)).toEqual([]);
  });

  it('writes back the OBJECT shape, smart-parsing + de-duping', () => {
    const out = rowsToValue([row('amount', '30'), row('flag', 'true'), row('', 'skip'), row('amount', 'dupe')], false);
    expect(out).toEqual({ amount: 30, flag: true });
  });

  it('writes back the ARRAY shape, preserving [{variable, value}]', () => {
    const out = rowsToValue([row('lead_score', '0'), row('qualified', 'false'), row('ref', '{record.id}')], true);
    expect(out).toEqual([
      { variable: 'lead_score', value: 0 },
      { variable: 'qualified', value: false },
      { variable: 'ref', value: '{record.id}' },
    ]);
  });

  it('round-trips an array-shape assignment without changing its shape', () => {
    const stored = [{ variable: 'lead_score', value: 0 }, { variable: 'enrichment_data', value: null }];
    const rows = toEntries(stored).map(([k, v]) => row(k, v == null ? '' : String(v)));
    const out = rowsToValue(rows, /* arrayShape */ true);
    expect(Array.isArray(out)).toBe(true);
    expect((out as Array<Record<string, unknown>>).map((e) => e.variable)).toEqual(['lead_score', 'enrichment_data']);
  });
});

/**
 * objectui#7588 — the text / expression choice on a `value`-role slot, pinned
 * through BOTH storage paths `rowsToValue` writes (the legacy array and the
 * canonical map). A stored value that nobody edits must come back unchanged.
 */
describe('FlowKeyValueField value-envelope slot (objectui#7588)', () => {
  const roundTrip = (stored: unknown, arrayShape: boolean) => rowsToValue(toRows(stored, [], true), arrayShape);

  it('round-trips a `{token}` string byte-identically in the MAP and the ARRAY shape', () => {
    const token = '{record.first_name} {record.last_name}';
    const map = roundTrip({ full_name: token, bare: '{amount}' }, false) as Record<string, unknown>;
    expect(map.full_name).toBe(token);
    expect(map.bare).toBe('{amount}');
    const list = roundTrip([{ variable: 'full_name', value: token }], true);
    expect(list).toEqual([{ variable: 'full_name', value: token }]);
    // Never normalized into an envelope: the text form stays a string.
    expect(toRows({ full_name: token }, [], true)[0].mode).toBeUndefined();
  });

  it('round-trips a CEL value envelope in the MAP as the same object, and in the ARRAY as the literal it is', () => {
    const envelope = { dialect: 'cel', source: 'joinNonEmpty(names, ", ")', meta: { rationale: 'digest' } };
    const map = roundTrip({ digest: envelope }, false) as Record<string, unknown>;
    expect(map.digest).toBe(envelope);
    expect(toRows({ digest: envelope }, [], true)[0]).toMatchObject({ mode: 'expression', raw: envelope.source });
    // In the legacy array an envelope-shaped object is a literal, so it is a
    // text row showing its JSON and it comes back deep-equal.
    const listRows = toRows([{ variable: 'digest', value: envelope }], [], true);
    expect(listRows[0].mode).toBeUndefined();
    expect(rowsToValue(listRows, true)).toEqual([{ variable: 'digest', value: envelope }]);
  });

  it('writes an expression row as a `{ dialect, source }` envelope, never as a string', () => {
    const rows: Row[] = [switchRowMode(row('total', 'amount * 2'), 'expression'), row('label', '{name}')];
    expect(rowsToValue(rows, false)).toEqual({ total: { dialect: 'cel', source: 'amount * 2' }, label: '{name}' });
  });

  it('moves a legacy ARRAY to the map once a row is an expression, leaving the other values unchanged', () => {
    const rows = toRows([{ variable: 'label', value: '{name}' }, { variable: 'n', value: 3 }], [], true);
    rows[1] = switchRowMode(rows[1], 'expression');
    expect(rowsToValue(rows, true)).toEqual({ label: '{name}', n: { dialect: 'cel', source: '3' } });
  });

  it('keeps a malformed envelope as the stored object with the spec refusal, not as a silent string', () => {
    const malformed = { dialect: 'cel' };
    const rows = toRows({ bad: malformed }, [], true);
    expect(rows[0].mode).toBeUndefined();
    const out = rowsToValue(rows, false) as Record<string, unknown>;
    expect(out.bad).toEqual(malformed);
    expect(valueEnvelopeRefusal(out.bad)).not.toBeNull();
    // A blank expression is written as an envelope the spec refuses, not as ''.
    const blank = rowsToValue([switchRowMode(row('empty', ''), 'expression')], false) as Record<string, unknown>;
    expect(blank.empty).toEqual({ dialect: 'cel', source: '' });
    expect(valueEnvelopeRefusal(blank.empty)).not.toBeNull();
  });

  it('switches text and expression both ways without losing the typed text', () => {
    const expr = switchRowMode(row('x', 'a + b'), 'expression');
    expect(expr).toMatchObject({ mode: 'expression', raw: 'a + b' });
    expect(switchRowMode(expr, 'text')).toEqual(row('x', 'a + b'));
    // Text that already is an envelope's JSON becomes that envelope.
    const adopted = switchRowMode(row('x', '{"dialect":"cel","source":"a"}'), 'expression');
    expect(adopted).toMatchObject({ mode: 'expression', raw: 'a', envelope: { dialect: 'cel', source: 'a' } });
  });

  it('leaves every map that is NOT a value-envelope slot exactly as before', () => {
    const envelope = { dialect: 'cel', source: 'a' };
    const rows = toRows({ param: envelope }, []);
    expect(rows[0].mode).toBeUndefined();
    expect(rows[0].raw).toBe(JSON.stringify(envelope));
    expect(rowsToValue(rows, false)).toEqual({ param: envelope });
  });
});
