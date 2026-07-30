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
