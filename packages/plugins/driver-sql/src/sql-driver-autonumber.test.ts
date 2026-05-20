// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

/**
 * Auto-number sequence tests.
 *
 * Verifies that auto_number fields are:
 *   - Generated correctly with prefix + zero padding
 *   - Isolated per tenant (organization_id) when the object has that field
 *   - Bootstrapped from existing data so legacy seeds are respected
 *   - Monotonic and unique across concurrent writers
 *   - Optional — explicit caller-provided values are not overwritten
 */
describe('SqlDriver auto_number sequence', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('generates sequential values per tenant', async () => {
    await driver.initObjects([
      {
        name: 'contract',
        fields: {
          organization_id: { type: 'string' },
          contract_number: { type: 'autonumber', format: 'CTR-{0000}' },
          name: { type: 'string' },
        },
      },
    ]);

    const orgA = 'org_a';
    const orgB = 'org_b';

    const a1 = await driver.create('contract', { organization_id: orgA, name: 'A1' });
    const b1 = await driver.create('contract', { organization_id: orgB, name: 'B1' });
    const a2 = await driver.create('contract', { organization_id: orgA, name: 'A2' });
    const b2 = await driver.create('contract', { organization_id: orgB, name: 'B2' });
    const a3 = await driver.create('contract', { organization_id: orgA, name: 'A3' });

    expect(a1.contract_number).toBe('CTR-0001');
    expect(a2.contract_number).toBe('CTR-0002');
    expect(a3.contract_number).toBe('CTR-0003');
    expect(b1.contract_number).toBe('CTR-0001');
    expect(b2.contract_number).toBe('CTR-0002');
  });

  it('bootstraps the sequence from existing legacy data per tenant', async () => {
    await driver.initObjects([
      {
        name: 'contract',
        fields: {
          organization_id: { type: 'string' },
          contract_number: { type: 'autonumber', format: 'CTR-{0000}' },
          name: { type: 'string' },
        },
      },
    ]);

    // Simulate pre-existing seeded rows in two orgs at different positions.
    const k = (driver as any).knex;
    await k('contract').insert([
      { id: 'l1', organization_id: 'org_legacy_a', contract_number: 'CTR-0001', name: 'legacy A1' },
      { id: 'l2', organization_id: 'org_legacy_a', contract_number: 'CTR-0002', name: 'legacy A2' },
      { id: 'l3', organization_id: 'org_legacy_a', contract_number: 'CTR-0007', name: 'legacy A7' },
      { id: 'l4', organization_id: 'org_legacy_b', contract_number: 'CTR-0001', name: 'legacy B1' },
    ]);

    const a = await driver.create('contract', { organization_id: 'org_legacy_a', name: 'new A' });
    const b = await driver.create('contract', { organization_id: 'org_legacy_b', name: 'new B' });
    const c = await driver.create('contract', { organization_id: 'org_legacy_c', name: 'new C' });

    expect(a.contract_number).toBe('CTR-0008'); // max(7) + 1
    expect(b.contract_number).toBe('CTR-0002'); // max(1) + 1
    expect(c.contract_number).toBe('CTR-0001'); // fresh tenant
  });

  it('respects caller-provided values and never overrides them', async () => {
    await driver.initObjects([
      {
        name: 'contract',
        fields: {
          organization_id: { type: 'string' },
          contract_number: { type: 'autonumber', format: 'CTR-{0000}' },
        },
      },
    ]);

    const r1 = await driver.create('contract', { organization_id: 'org_x', contract_number: 'CTR-9999' });
    const r2 = await driver.create('contract', { organization_id: 'org_x' });

    expect(r1.contract_number).toBe('CTR-9999');
    // Sequence should bootstrap from max(9999) so r2 picks 10000.
    expect(r2.contract_number).toBe('CTR-10000');
  });

  it('uses a global sequence when the object has no tenant field', async () => {
    await driver.initObjects([
      {
        name: 'invoice',
        fields: {
          invoice_number: { type: 'autonumber', format: 'INV-{0000}' },
          amount: { type: 'number' },
        },
      },
    ]);

    const r1 = await driver.create('invoice', { amount: 100 });
    const r2 = await driver.create('invoice', { amount: 200 });
    const r3 = await driver.create('invoice', { amount: 300 });

    expect(r1.invoice_number).toBe('INV-0001');
    expect(r2.invoice_number).toBe('INV-0002');
    expect(r3.invoice_number).toBe('INV-0003');
  });

  it('produces unique values under concurrent inserts in the same tenant', async () => {
    await driver.initObjects([
      {
        name: 'contract',
        fields: {
          organization_id: { type: 'string' },
          contract_number: { type: 'autonumber', format: 'CTR-{0000}' },
          name: { type: 'string' },
        },
      },
    ]);

    const N = 25;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        driver.create('contract', { organization_id: 'org_concurrent', name: `R${i}` }),
      ),
    );
    const numbers = results.map((r: any) => r.contract_number);
    const unique = new Set(numbers);
    expect(unique.size).toBe(N);
    // All should be CTR-NNNN in the 1..N range.
    for (const n of numbers) {
      expect(n).toMatch(/^CTR-\d{4}$/);
      const v = parseInt(n.slice(4), 10);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(N);
    }
  });

  it('accepts both auto_number and autonumber type spellings', async () => {
    await driver.initObjects([
      {
        name: 'case_record',
        fields: {
          organization_id: { type: 'string' },
          case_number: { type: 'auto_number', format: 'CASE-{000}' },
        },
      },
    ]);

    const r = await driver.create('case_record', { organization_id: 'org_x' });
    expect(r.case_number).toBe('CASE-001');
  });

  it('falls back to options.tenantId when the row has no tenant field value', async () => {
    await driver.initObjects([
      {
        name: 'contract',
        fields: {
          organization_id: { type: 'string' },
          contract_number: { type: 'autonumber', format: 'CTR-{0000}' },
        },
      },
    ]);

    // No organization_id on the row, but provided via DriverOptions.
    const r1 = await driver.create('contract', {}, { tenantId: 'org_options' } as any);
    const r2 = await driver.create('contract', {}, { tenantId: 'org_options' } as any);
    const r3 = await driver.create('contract', {}, { tenantId: 'org_other' } as any);

    expect(r1.contract_number).toBe('CTR-0001');
    expect(r2.contract_number).toBe('CTR-0002');
    expect(r3.contract_number).toBe('CTR-0001');
  });
});
