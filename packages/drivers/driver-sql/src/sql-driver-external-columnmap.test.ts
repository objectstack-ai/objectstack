// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Federation columnMap tests (ADR-0015 §18).
 *
 * An external object can bind to a remote table whose COLUMN names differ from
 * the local field names via `external.columnMap` ({ remoteColumn -> localField }).
 * Reads must come back keyed by local field names (with coercion), and WHERE /
 * ORDER BY must translate local fields to the physical remote columns.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFilterAST } from '@objectstack/spec/data';
import { SqlDriver } from '../src/index.js';

// Remote table with deliberately non-matching column names.
const REMOTE = {
  name: 'legacy_cust',
  fields: {
    cust_id: { type: 'text' },
    full_name: { type: 'text' },
    region_code: { type: 'text' },
    ltv: { type: 'number' },
    signup_dt: { type: 'date' },
  },
};

// Local federated object: clean field names, bound to the remote columns.
const COLUMN_MAP = { full_name: 'name', region_code: 'region', ltv: 'value', signup_dt: 'signed_up', cust_id: 'id' };
const LOCAL_FIELDS = {
  name: { type: 'text' },
  region: { type: 'text' },
  value: { type: 'number' },
  signed_up: { type: 'date' },
};

let file: string;
afterAll(() => { if (file) { try { rmSync(file, { force: true }); } catch { /* ignore */ } } });

async function seedRemote(path: string) {
  const fx = new SqlDriver({ client: 'better-sqlite3', connection: { filename: path }, useNullAsDefault: true }) as any;
  fx.name = 'fx';
  await fx.connect();
  await fx.initObjects([REMOTE]);
  await fx.create('legacy_cust', { cust_id: 'c1', full_name: 'Aurora', region_code: 'NA', ltv: 480, signup_dt: '2026-01-10' });
  await fx.create('legacy_cust', { cust_id: 'c2', full_name: 'Borealis', region_code: 'EU', ltv: 312, signup_dt: '2026-02-15' });
  await fx.create('legacy_cust', { cust_id: 'c3', full_name: 'Cyan', region_code: 'EU', ltv: 95, signup_dt: '2026-03-01' });
  await fx.disconnect();
}

function ext(path: string): any {
  const d = new SqlDriver({ client: 'better-sqlite3', connection: { filename: path }, useNullAsDefault: true, schemaMode: 'external' } as any) as any;
  d.name = 'extds';
  return d;
}

describe('SqlDriver external columnMap (ADR-0015 §18)', () => {
  it('reads come back keyed by local field names from differently-named remote columns', async () => {
    file = join(tmpdir(), `os-cm-${process.pid}-${Date.now()}.db`);
    await seedRemote(file);
    const d = ext(file);
    await d.connect();
    try {
      d.registerExternalObject({ name: 'cm_customer', external: { remoteName: 'legacy_cust', columnMap: COLUMN_MAP }, fields: LOCAL_FIELDS });

      const rows = await d.find('cm_customer', {});
      expect(rows).toHaveLength(3);
      const aurora = rows.find((r: any) => r.name === 'Aurora');
      expect(aurora).toBeTruthy();
      // Local field names present; remote column names absent.
      expect(aurora.id).toBe('c1');
      expect(aurora.region).toBe('NA');
      expect(typeof aurora.value).toBe('number');
      expect(aurora.value).toBe(480);
      expect(aurora.signed_up).toBe('2026-01-10');
      expect(aurora.full_name).toBeUndefined();
      expect(aurora.region_code).toBeUndefined();
      expect(aurora.ltv).toBeUndefined();
    } finally { await d.disconnect(); }
  });

  it('WHERE (object + array form) translates local field -> remote column', async () => {
    const d = ext(file);
    await d.connect();
    try {
      d.registerExternalObject({ name: 'cm_customer', external: { remoteName: 'legacy_cust', columnMap: COLUMN_MAP }, fields: LOCAL_FIELDS });
      // object form: region -> region_code
      const eu = await d.find('cm_customer', { where: { region: 'EU' } });
      expect(eu.map((r: any) => r.name).sort()).toEqual(['Borealis', 'Cyan']);
      // authored array criterion, lowered the declared way (#5158): value -> ltv
      const big = await d.find('cm_customer', { where: parseFilterAST([['value', '>', 200]]) as any });
      expect(big.map((r: any) => r.name).sort()).toEqual(['Aurora', 'Borealis']);
      // mongo operator: value $gte
      const gte = await d.find('cm_customer', { where: { value: { $gte: 312 } } });
      expect(gte.map((r: any) => r.name).sort()).toEqual(['Aurora', 'Borealis']);
    } finally { await d.disconnect(); }
  });

  it('ORDER BY + date coercion work through the columnMap', async () => {
    const d = ext(file);
    await d.connect();
    try {
      d.registerExternalObject({ name: 'cm_customer', external: { remoteName: 'legacy_cust', columnMap: COLUMN_MAP }, fields: LOCAL_FIELDS });
      // orderBy value (-> ltv) desc
      const ordered = await d.find('cm_customer', { orderBy: [{ field: 'value', order: 'desc' }] });
      expect(ordered.map((r: any) => r.value)).toEqual([480, 312, 95]);
      // date filter: signed_up (-> signup_dt) coercion keyed by local field
      const onDate = await d.find('cm_customer', { where: { signed_up: '2026-02-15' } });
      expect(onDate.map((r: any) => r.name)).toEqual(['Borealis']);
    } finally { await d.disconnect(); }
  });

  it('managed objects (no columnMap) are unaffected — own column names', async () => {
    const d = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any;
    d.name = 'default';
    await d.connect();
    try {
      await d.initObjects([{ name: 'plain', fields: { title: { type: 'text' }, qty: { type: 'number' } } }]);
      await d.create('plain', { id: 'p1', title: 'Widget', qty: 5 });
      const rows = await d.find('plain', { where: { title: 'Widget' }, orderBy: [{ field: 'qty', order: 'asc' }] });
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('Widget');
      expect(rows[0].qty).toBe(5);
    } finally { await d.disconnect(); }
  });
});
