// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Field runtime value-shape contract (ADR-0104 D1).
 *
 * The write-vectors here deliberately mirror the field-zoo round-trip MATRIX
 * (packages/qa/dogfood/test/field-zoo-roundtrip.dogfood.test.ts) — the
 * executable oracle of what the platform actually stores. If a case here and
 * a MATRIX case disagree, the MATRIX (deployed reality) wins.
 */

import { describe, it, expect } from 'vitest';
import { FieldType } from './field.zod';
import {
  STRING_VALUE_TYPES,
  NUMERIC_VALUE_TYPES,
  BOOLEAN_VALUE_TYPES,
  CALENDAR_DATE_TYPES,
  INSTANT_TYPES,
  CLOCK_TIME_TYPES,
  SINGLE_OPTION_TYPES,
  MULTI_OPTION_TYPES,
  REFERENCE_VALUE_TYPES,
  FILE_REFERENCE_TYPES,
  STRUCTURED_JSON_TYPES,
  COMPUTED_VALUE_TYPES,
  MULTI_CAPABLE_TYPES,
  isMultiValueField,
  valueSchemaFor,
} from './field-value.zod';

const ok = (def: Parameters<typeof valueSchemaFor>[0], v: unknown, form?: 'stored' | 'expanded') =>
  expect(valueSchemaFor(def, form).safeParse(v).success).toBe(true);
const bad = (def: Parameters<typeof valueSchemaFor>[0], v: unknown, form?: 'stored' | 'expanded') =>
  expect(valueSchemaFor(def, form).safeParse(v).success).toBe(false);

describe('semantic type classes', () => {
  it('every class member is a declared FieldType', () => {
    const all = new Set<string>(FieldType.options);
    for (const cls of [
      STRING_VALUE_TYPES, NUMERIC_VALUE_TYPES, BOOLEAN_VALUE_TYPES,
      CALENDAR_DATE_TYPES, INSTANT_TYPES, CLOCK_TIME_TYPES,
      SINGLE_OPTION_TYPES, MULTI_OPTION_TYPES, REFERENCE_VALUE_TYPES,
      FILE_REFERENCE_TYPES, STRUCTURED_JSON_TYPES, COMPUTED_VALUE_TYPES,
      MULTI_CAPABLE_TYPES,
    ]) {
      for (const t of cls) expect(all).toContain(t);
    }
  });

  it('every FieldType lands in at least one value class (no unclassified types)', () => {
    const classified = new Set<string>([
      ...STRING_VALUE_TYPES, ...NUMERIC_VALUE_TYPES, ...BOOLEAN_VALUE_TYPES,
      ...CALENDAR_DATE_TYPES, ...INSTANT_TYPES, ...CLOCK_TIME_TYPES,
      ...SINGLE_OPTION_TYPES, ...MULTI_OPTION_TYPES, ...REFERENCE_VALUE_TYPES,
      ...FILE_REFERENCE_TYPES, ...STRUCTURED_JSON_TYPES, ...COMPUTED_VALUE_TYPES,
    ]);
    const unclassified = FieldType.options.filter((t) => !classified.has(t));
    expect(unclassified).toEqual([]);
  });

  it('the shape classes are mutually disjoint (COMPUTED is the orthogonal who-writes axis: `summary` is numeric AND computed)', () => {
    const classes = [
      STRING_VALUE_TYPES, NUMERIC_VALUE_TYPES, BOOLEAN_VALUE_TYPES,
      CALENDAR_DATE_TYPES, INSTANT_TYPES, CLOCK_TIME_TYPES,
      SINGLE_OPTION_TYPES, MULTI_OPTION_TYPES, REFERENCE_VALUE_TYPES,
      FILE_REFERENCE_TYPES, STRUCTURED_JSON_TYPES,
    ];
    const seen = new Map<string, number>();
    classes.forEach((cls, i) => {
      for (const t of cls) {
        expect(seen.has(t), `type "${t}" appears in class #${seen.get(t)} and #${i}`).toBe(false);
        seen.set(t, i);
      }
    });
  });
});

describe('isMultiValueField', () => {
  it('inherently-multi option types are always arrays', () => {
    for (const type of ['multiselect', 'checkboxes', 'tags']) {
      expect(isMultiValueField({ type })).toBe(true);
      expect(isMultiValueField({ type, multiple: false })).toBe(true);
    }
  });
  it('multi-capable types require the multiple flag', () => {
    for (const type of ['select', 'radio', 'lookup', 'user', 'file', 'image']) {
      expect(isMultiValueField({ type })).toBe(false);
      expect(isMultiValueField({ type, multiple: true })).toBe(true);
    }
  });
  it('a stray multiple on a non-multi-capable type is ignored (matches the engine)', () => {
    for (const type of ['master_detail', 'tree', 'text', 'number']) {
      expect(isMultiValueField({ type, multiple: true })).toBe(false);
    }
  });
});

describe('valueSchemaFor — stored form (field-zoo reality)', () => {
  it('strings', () => {
    ok({ type: 'text' }, 'hello');
    ok({ type: 'signature' }, 'data:image/png;base64,AAAA');
    ok({ type: 'color' }, '#FF8800');
    bad({ type: 'text' }, 42);
  });

  it('numerics — currency is a BARE number (the retired CurrencyValueSchema object is rejected)', () => {
    ok({ type: 'currency' }, 1234.56);
    bad({ type: 'currency' }, { value: 1234.56, currency: 'USD' });
    ok({ type: 'progress' }, 60);
    bad({ type: 'number' }, 'NaN-ish');
    bad({ type: 'number' }, Infinity);
  });

  it('booleans are real booleans', () => {
    ok({ type: 'boolean' }, true);
    bad({ type: 'boolean' }, 1);
  });

  it('date is a calendar day, datetime a zoned instant, time a wall clock (#2004 / ADR-0053)', () => {
    ok({ type: 'date' }, '2024-03-15');
    bad({ type: 'date' }, '2024-03-15T14:30:00.000Z');
    ok({ type: 'datetime' }, '2024-03-15T14:30:00.000Z');
    ok({ type: 'datetime' }, '2024-03-15T14:30:00+08:00');
    bad({ type: 'datetime' }, '2024-03-15 14:30:00');
    bad({ type: 'datetime' }, '2024-03-15');
    ok({ type: 'time' }, '14:30:00');
    ok({ type: 'time' }, '14:30');
    bad({ type: 'time' }, '14:60');
    bad({ type: 'time' }, 'not-a-time');
  });

  it('option types enforce declared option codes; free-form without options', () => {
    const options = [{ value: 'high' }, { value: 'low' }];
    ok({ type: 'select', options }, 'high');
    bad({ type: 'select', options }, 'HIGH');
    ok({ type: 'select' }, 'anything');
    ok({ type: 'multiselect', options }, ['high', 'low']);
    bad({ type: 'multiselect', options }, ['high', 'nope']);
    bad({ type: 'multiselect', options }, 'high'); // scalar at a multi field
    ok({ type: 'tags' }, ['alpha', 'beta']);
  });

  it('references store id strings; multiple stores arrays of ids', () => {
    ok({ type: 'lookup' }, 'acc_synthetic_0001');
    bad({ type: 'lookup' }, { id: 'acc_1', name: 'Acme' }); // expanded form ≠ stored form
    bad({ type: 'lookup' }, '');
    ok({ type: 'user', multiple: true }, ['usr_1', 'usr_2']);
    bad({ type: 'user', multiple: true }, 'usr_1');
  });

  it('expanded form admits the in-place $expand record object for references', () => {
    ok({ type: 'lookup' }, { id: 'acc_1', name: 'Acme' }, 'expanded');
    ok({ type: 'lookup' }, 'acc_1', 'expanded'); // unresolvable ids stay ids
  });

  it('D3 wave 2: the STORED media form is an opaque sys_file id', () => {
    ok({ type: 'file' }, 'file_01HXYZ');
    ok({ type: 'file' }, '0e2f4c1a-9b7d-4e3f-8a1b-2c3d4e5f6a7b');
    ok({ type: 'image', multiple: true }, ['file_a', 'file_b']);
    bad({ type: 'file' }, 42);
    bad({ type: 'file' }, {});
    // The inline blob is no longer STORED — it is the expanded read form.
    bad({ type: 'file' }, { url: 'https://cdn/f.pdf', name: 'f.pdf', size: 1024 });
    // An external URL was never a managed file; ADR-0104 R7 retires it toward
    // an explicit `url` field. Both of these reach authors as warn-first
    // value-shape warnings, not hard failures, until strict is opted into.
    bad({ type: 'file' }, 'https://cdn/f.pdf');
    bad({ type: 'image' }, '/api/v1/storage/files/file_a');
    bad({ type: 'image' }, 'data:image/png;base64,aGk=');
  });

  it('D3 wave 2: the EXPANDED media form is the resolved object, or a still-unresolved id', () => {
    ok({ type: 'file' }, { url: 'https://cdn/f.pdf', name: 'f.pdf', size: 1024 }, 'expanded');
    ok({ type: 'image' }, { url: 'https://cdn/i.png', alt: 'i' }, 'expanded');
    ok({ type: 'file' }, { url: 'https://cdn/f.pdf', mimeType: 'application/pdf' }, 'expanded');
    // Expansion may not have happened — storage service absent, file not
    // committed — exactly as an unexpanded lookup id stays valid.
    ok({ type: 'file' }, 'file_01HXYZ', 'expanded');
    bad({ type: 'file' }, 42, 'expanded');
  });

  it('D3 wave 1: the media object form requires a url — a url-less fragment is no longer waved through', () => {
    // The whole FILE_REFERENCE_TYPES class shares the one contract, now carried
    // by the expanded form (wave 2 moved the object out of `stored`).
    for (const type of ['file', 'image', 'avatar', 'video', 'audio']) {
      ok({ type }, { url: 'https://cdn/x' }, 'expanded');
      bad({ type }, { name: 'x' }, 'expanded');   // object without url — the tightening
      bad({ type }, { size: 10 }, 'expanded');    // ditto
    }
    ok({ type: 'video' }, { url: 'https://cdn/v.mp4', duration: 12 }, 'expanded');
  });

  it('structured JSON types', () => {
    ok({ type: 'location' }, { lat: 37.77, lng: -122.42 });
    bad({ type: 'location' }, { latitude: 37.77, longitude: -122.42 }); // the retired spec-only shape
    ok({ type: 'address' }, { street: '1 Main', city: 'SF', country: 'US' });
    ok({ type: 'vector' }, [0.1, 0.2, 0.3]);
    bad({ type: 'vector' }, [0.1, 'x']);
    ok({ type: 'repeater' }, [{ a: 1 }, { a: 2 }]);
    bad({ type: 'repeater' }, { a: 1 });
    ok({ type: 'record' }, { home: '+1', work: '+2' });
    ok({ type: 'composite' }, { label: 'x', n: 1 });
  });

  it('json/code and computed types are explicitly open', () => {
    ok({ type: 'json' }, { a: 1, b: [2, 3] });
    ok({ type: 'formula' }, 31.5);
    ok({ type: 'autonumber' }, 'INV-0001');
  });
});
