// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { scanValueShapes, valueShapeScanPassed } from './scan-value-shapes.js';
import { validateRecord, ValidationError } from './record-validator.js';

const OBJECTS: Record<string, any> = {
  contact: {
    fields: {
      id: { type: 'text' },
      name: { type: 'text' },
      account: { type: 'lookup', reference: 'account' },
      geo: { type: 'location' },
      addr: { type: 'address' },
      // Engine-owned: never validated on a write, so never scanned either.
      owner_cache: { type: 'lookup', reference: 'sys_user', system: true },
    },
  },
  // No covered field — must not be walked at all.
  note: { fields: { id: { type: 'text' }, body: { type: 'textarea' } } },
};

function makeEngine(rows: Record<string, Array<Record<string, unknown>>>) {
  const reads: string[] = [];
  return {
    reads,
    getObject: (n: string) => OBJECTS[n],
    getConfigs: () => OBJECTS,
    async find(object: string) {
      reads.push(object);
      return rows[object] ?? [];
    },
  };
}

const silent = { info: () => {}, warn: () => {} };

describe('scanValueShapes (ADR-0104 D1 / #3438)', () => {
  it('a clean database passes and only walks objects declaring covered fields', async () => {
    const engine = makeEngine({
      contact: [{ id: 'c1', account: 'acc_1', geo: { lat: 1, lng: 2 } }],
      note: [{ id: 'n1', body: 'hi' }],
    });
    const report = await scanValueShapes(engine, silent);

    expect(report.blocking).toBe(0);
    expect(valueShapeScanPassed(report)).toBe(true);
    expect(report.scannedObjects).toEqual(['contact']);
    expect(engine.reads).not.toContain('note');
  });

  it('counts malformed values per field, with samples and the parse detail', async () => {
    const engine = makeEngine({
      contact: [
        { id: 'c1', geo: { latitude: 1, longitude: 2 } }, // the pre-ADR spec shape
        { id: 'c2', geo: { latitude: 3, longitude: 4 } },
        { id: 'c3', account: { id: 'acc_1', name: 'Acme' } }, // expanded, not an id
        { id: 'c4', account: 'acc_2', geo: { lat: 0, lng: 0 } }, // fine
      ],
    });
    const report = await scanValueShapes(engine, silent);

    expect(report.scannedRecords).toBe(4);
    expect(report.blocking).toBe(3);
    const geo = report.findings.find((f) => f.field === 'geo')!;
    expect(geo.count).toBe(2);
    expect(geo.type).toBe('location');
    expect(geo.sampleRecordIds).toEqual(['c1', 'c2']);
    expect(geo.detail).toBeTruthy();
    expect(report.findings.find((f) => f.field === 'account')!.count).toBe(1);
    expect(valueShapeScanPassed(report)).toBe(false);
  });

  it('never counts a system/readonly field — the write path never validates one', async () => {
    const engine = makeEngine({
      contact: [{ id: 'c1', owner_cache: { id: 'u1', name: 'nope' } }],
    });
    const report = await scanValueShapes(engine, silent);
    expect(report.blocking).toBe(0);
  });

  it('a missing or null value is not a violation — that is `required`\'s business', async () => {
    const engine = makeEngine({
      contact: [{ id: 'c1', account: null, geo: undefined }, { id: 'c2' }],
    });
    const report = await scanValueShapes(engine, silent);
    expect(report.blocking).toBe(0);
  });

  it('an unreadable object closes the gate even with zero violations found', async () => {
    const engine = {
      getObject: (n: string) => OBJECTS[n],
      getConfigs: () => OBJECTS,
      async find(): Promise<Array<Record<string, unknown>>> {
        throw new Error('table missing');
      },
    };
    const report = await scanValueShapes(engine, silent);

    expect(report.blocking).toBe(0);
    expect(report.unreadableObjects).toEqual(['contact']);
    expect(report.truncated).toBe(true);
    // "none in the part we could read" is not the claim the flag makes.
    expect(valueShapeScanPassed(report)).toBe(false);
  });

  it('#4455: a lookup holding a SERIALIZED embedded record is found, and closes the gate', async () => {
    // The exact case the scan's own header names — and the exact way it reaches
    // a SQL deployment: the expanded record object stored as JSON text in a
    // TEXT column. It read as a non-empty string, so `ReferenceIdValueSchema`
    // waved it through, the scan reported "✓ No malformed values found", and
    // `--apply` closed the gate on evidence that was never collected.
    const engine = makeEngine({
      contact: [
        { id: 'c1', account: 'acc_1' }, // a real id — must stay clean
        { id: 'c2', account: '{"id":"acc_1","name":"embedded"}' },
        { id: 'c3', account: '  {"id":"acc_2"}' },
      ],
    });
    const report = await scanValueShapes(engine, silent);

    expect(report.scannedRecords).toBe(3);
    expect(report.blocking).toBe(2);
    const account = report.findings.find((f) => f.field === 'account')!;
    expect(account.count).toBe(2);
    expect(account.sampleRecordIds).toEqual(['c2', 'c3']);
    expect(account.detail).toMatch(/embedded record object/);
    // The verdict the gate reads: this deployment may NOT record the flag.
    expect(valueShapeScanPassed(report)).toBe(false);

    // …and the same value is a write rejection under strict, so the flag would
    // not have been attesting something the validator disagrees with.
    expect(() =>
      validateRecord(
        OBJECTS.contact,
        { account: '{"id":"acc_1","name":"embedded"}' },
        'update',
        { valueShapeStrict: true },
      ),
    ).toThrow(ValidationError);
    expect(() =>
      validateRecord(OBJECTS.contact, { account: 'acc_1' }, 'update', { valueShapeStrict: true }),
    ).not.toThrow();
  });

  it('#13802: an UNDECLARED key on an address/location value is a finding — the class the scan could not measure', async () => {
    // Both value contracts were all-optional `.strip` objects, so a value with
    // a completely wrong key set parsed green: the showcase seed's
    // `postal_code` (#13388) was a violation this scan structurally could not
    // count, and "zero findings" was the only answer the instrument could give.
    // Strict since #13802, the same predicate now counts it — and names the key.
    const engine = makeEngine({
      contact: [
        { id: 'c1', addr: { street: '1 Main St', city: 'Seattle', postal_code: '98101' } }, // the seed's shape
        { id: 'c2', geo: { lat: 37.77, lng: -122.42, heading: 90 } },                   // a device extra
        { id: 'c3', addr: { street: '1 Main St', city: 'Seattle', postalCode: '98101' } }, // declared — clean
      ],
    });
    const report = await scanValueShapes(engine, silent);

    expect(report.scannedRecords).toBe(3);
    expect(report.blocking).toBe(2);
    const addr = report.findings.find((f) => f.field === 'addr')!;
    expect(addr).toMatchObject({ type: 'address', count: 1, sampleRecordIds: ['c1'] });
    expect(addr.detail).toContain('`postal_code`');
    expect(addr.detail).toContain('`postalCode`');
    expect(report.findings.find((f) => f.field === 'geo')!.detail).toContain('`heading`');
    expect(valueShapeScanPassed(report)).toBe(false);

    // One predicate: the flagged values are write rejections under strict, the clean one writes.
    expect(() =>
      validateRecord(OBJECTS.contact, { addr: { street: '1 Main St', postal_code: '98101' } }, 'update', { valueShapeStrict: true }),
    ).toThrow(ValidationError);
    expect(() =>
      validateRecord(OBJECTS.contact, { addr: { street: '1 Main St', postalCode: '98101' } }, 'update', { valueShapeStrict: true }),
    ).not.toThrow();
  });

  it('the scan counts exactly what strict mode rejects — one predicate, not two', async () => {
    // The anti-drift property: every value the scan flags must also be a write
    // rejection under the strict gate, and every value it passes must write.
    const flagged = { geo: { latitude: 1, longitude: 2 } };
    const clean = { geo: { lat: 1, lng: 2 } };

    const engine = makeEngine({ contact: [{ id: 'c1', ...flagged }] });
    const report = await scanValueShapes(engine, silent);
    expect(report.blocking).toBe(1);

    expect(() =>
      validateRecord(OBJECTS.contact, { ...flagged }, 'update', { valueShapeStrict: true }),
    ).toThrow(ValidationError);
    expect(() =>
      validateRecord(OBJECTS.contact, { ...clean }, 'update', { valueShapeStrict: true }),
    ).not.toThrow();
  });
});
