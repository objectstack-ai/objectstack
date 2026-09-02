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
  referenceTargetOf,
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

  it('`referenceTargetOf` reads an author-written target, and the implied one for `user`', () => {
    // The author-chosen half.
    expect(referenceTargetOf({ type: 'lookup', reference: 'accounts' })).toBe('accounts');
    expect(referenceTargetOf({ type: 'master_detail', reference: 'orders' })).toBe('orders');
    expect(referenceTargetOf({ type: 'tree', reference: 'categories' })).toBe('categories');

    // `user`'s target is a CONSTANT OF THE TYPE: `Field.user()` takes no target
    // argument and writes `reference: 'sys_user'` itself, so a field authored
    // without it is fully specified, not under-specified (cloud#983).
    expect(referenceTargetOf({ type: 'user' })).toBe('sys_user');
    expect(referenceTargetOf({ type: 'user', reference: 'sys_user' })).toBe('sys_user');
    // An explicit target still wins — nothing here overrides authored metadata.
    expect(referenceTargetOf({ type: 'user', reference: 'my_people' })).toBe('my_people');

    // Genuinely targetless: the types whose target IS author-chosen, unwritten.
    expect(referenceTargetOf({ type: 'lookup' })).toBeUndefined();
    expect(referenceTargetOf({ type: 'master_detail' })).toBeUndefined();
    expect(referenceTargetOf({ type: 'tree' })).toBeUndefined();
    // Not a reference type at all, and non-field inputs.
    expect(referenceTargetOf({ type: 'text', reference: 'accounts' })).toBeUndefined();
    expect(referenceTargetOf(undefined)).toBeUndefined();
    expect(referenceTargetOf('user')).toBeUndefined();
  });

  it('every reference type either implies a target or admits one — no third state', () => {
    // Guards the set from drifting: adding a reference type without deciding
    // which half it belongs to would leave `referenceTargetOf` silently
    // answering `undefined` for a fully-authored field.
    for (const t of REFERENCE_VALUE_TYPES) {
      const implied = referenceTargetOf({ type: t });
      const authored = referenceTargetOf({ type: t, reference: 'somewhere' });
      expect(authored, `authored target for ${t}`).toBe('somewhere');
      expect(implied === undefined || typeof implied === 'string', `implied target for ${t}`).toBe(true);
    }
    expect([...REFERENCE_VALUE_TYPES].filter((t) => referenceTargetOf({ type: t }) !== undefined))
      .toEqual(['user']);
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

  it('#4455: a SERIALIZED embedded record is not an id, in either form', () => {
    // The shape the ADR-0104 D1 scan's own header names — "a `lookup` holding
    // an expanded record object" — as it actually reaches a SQL deployment: as
    // JSON text in a TEXT column. `z.string().min(1)` accepted it, so the scan
    // reported clean on the one case it exists to find.
    for (const type of ['lookup', 'master_detail', 'user', 'tree']) {
      bad({ type }, '{"id":"acc_1","name":"embedded"}');
      bad({ type }, '  {"id":"acc_1"}'); // padded — same value, still not an id
      bad({ type }, '[{"id":"acc_1"}]'); // the multi-value flavour
      // …and the expanded read form must not launder it either: `$expand`
      // produces an OBJECT, never its serialization.
      bad({ type }, '{"id":"acc_1","name":"embedded"}', 'expanded');
    }
    bad({ type: 'lookup', multiple: true }, ['acc_1', '{"id":"acc_2"}']);

    // Narrow on purpose: the rejection is "this is an embedded record", not an
    // id alphabet. A reference id is whatever the target object's key holds —
    // including an external key an ADR-0015 federated datasource supplies — so
    // every one of these stays valid.
    ok({ type: 'lookup' }, 'acc_synthetic_0001');
    ok({ type: 'lookup' }, '0e2f4c1a-9b7d-4e3f-8a1b-2c3d4e5f6a7b');
    ok({ type: 'lookup' }, 'CB0-2026-0001');
    ok({ type: 'lookup' }, 'SFDC:001xx000003DGb2AAG'); // external key, punctuated
    ok({ type: 'lookup' }, 'ops/eu-west/tenant-7'); // and pathy
    ok({ type: 'user' }, 'usr_system');
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

  it('#13802: location/address values refuse an undeclared key BY NAME — the strip that hid the showcase seed typo', () => {
    // Every member of both shapes is optional, so under zod's default `.strip`
    // a value with a completely wrong key set parsed GREEN and the wrong keys
    // vanished from the parse output — #13388's seed wrote `postal_code`, the
    // platform accepted it, dropped it, and rendered an empty ZIP box, while a
    // stored-value scan over the class could only ever report zero. Assert the
    // ENVELOPE — issue code + the keys it names + the rename it prescribes —
    // never a bare `success === false`, which cannot tell this refusal from
    // the schema refusing the value for an unrelated reason.
    const firstIssue = (def: Parameters<typeof valueSchemaFor>[0], v: unknown) => {
      const r = valueSchemaFor(def, 'stored').safeParse(v);
      if (r.success) throw new Error(`expected REJECTION, got a successful parse of ${JSON.stringify(v)}`);
      return r.error.issues[0] as { code: string; keys?: readonly string[]; message: string };
    };

    // The measured shape (#13388 / #13802's own repro).
    const seed = firstIssue({ type: 'address' }, {
      street: '1 Main St', city: 'Seattle', state: 'WA', postal_code: '98101', country: 'US',
    });
    expect(seed.code).toBe('unrecognized_keys');
    expect(seed.keys).toEqual(['postal_code']);
    expect(seed.message).toContain('this address value');
    expect(seed.message).toContain('Did you mean `postal_code` → `postalCode`?');
    // Customer-facing refusal text carries no internal issue id (check:doc-authoring's rule).
    expect(seed.message).not.toMatch(/#\d+/);

    // The spelling the address widget wrote for a release (objectstack#5143):
    // a different WORD, reachable only through the curated alias.
    expect(firstIssue({ type: 'address' }, { street: '1', zipCode: '98101' }).message)
      .toContain('`zipCode` → `postalCode`');

    // Location: the extras batch D once called legitimate are named, all of them.
    const geo = firstIssue({ type: 'location' }, { lat: 1, lng: 2, heading: 90, speed: 3 });
    expect(geo.code).toBe('unrecognized_keys');
    expect(geo.keys).toEqual(['heading', 'speed']);
    expect(geo.message).toContain('this location value');
    expect(geo.message).not.toMatch(/#\d+/);

    // The retired spec-only spelling carries its rename (an alias — edit
    // distance cannot reach `latitude` → `lat`). It is ALSO a missing-pair
    // rejection; the unrecognized-keys issue is the one that names the fix.
    const retired = valueSchemaFor({ type: 'location' }, 'stored').safeParse({ latitude: 1, longitude: 2 });
    expect(retired.success).toBe(false);
    const unknown = (retired as { error: { issues: Array<{ code: string; message: string }> } }).error.issues
      .find((i) => i.code === 'unrecognized_keys');
    expect(unknown?.message).toContain('`latitude` → `lat`');
    expect(unknown?.message).toContain('`longitude` → `lng`');

    // Declared keys, byte-for-byte, still parse — including the optional ones.
    ok({ type: 'address' }, { street: '1 Main St', city: 'SF', state: 'CA', postalCode: '94105', country: 'USA', countryCode: 'US', formatted: '1 Main St, SF' });
    ok({ type: 'location' }, { lat: 37.77, lng: -122.42, altitude: 10, accuracy: 5 });

    // The ruling's positive control: `FileValueSchema` is the ONE deliberate
    // loose site and is untouched — an extra key still rides through it.
    ok({ type: 'file' }, { url: 'https://cdn/x', extra: 1 }, 'expanded');
  });

  it('json/code and computed types are explicitly open', () => {
    ok({ type: 'json' }, { a: 1, b: [2, 3] });
    ok({ type: 'formula' }, 31.5);
    ok({ type: 'autonumber' }, 'INV-0001');
  });
});
