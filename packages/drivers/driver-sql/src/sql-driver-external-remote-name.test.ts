// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Federation read-path tests (ADR-0015 addendum).
 *
 * Before this fix the query path resolved an external object to a table named
 * after the OBJECT, ignoring `external.remoteName` — so `find('ext_customer')`
 * threw `no such table: ext_customer` even though the object bound to a real
 * remote table `remote_customers`. ADR-0015's own canonical example
 * (`wh_order` → `mart.fact_orders`) was therefore broken.
 *
 * These tests stand up one sqlite file as the "remote" database (populated with
 * a managed driver), then open a second `schemaMode: 'external'` driver over the
 * same file and assert that an object whose name differs from the remote table
 * is fully queryable — with read coercion (boolean/json/date) working even
 * though no DDL ran for the external object.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '../src/index.js';
import { ExternalSchemaModeViolationError } from '@objectstack/spec/shared';

const FIELDS = {
  name: { type: 'text' },
  flag: { type: 'boolean' },
  meta: { type: 'json' },
  when: { type: 'date' },
  amount: { type: 'number' },
  seen_at: { type: 'datetime' },
} as const;

let file: string;

afterAll(() => {
  if (file) {
    try { rmSync(file, { force: true }); } catch { /* ignore */ }
  }
});

async function seedRemote(path: string) {
  const fixture = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: path },
    useNullAsDefault: true,
  });
  (fixture as any).name = 'fixture';
  await fixture.connect?.();
  // Physical table name deliberately differs from the object name used later.
  await (fixture).initObjects([{ name: 'remote_customers', fields: FIELDS }]);
  await (fixture).create('remote_customers', {
    id: 'c1', name: 'Acme', flag: true, meta: { tier: 'gold' },
    when: '2026-01-01', amount: 100, seen_at: new Date('2026-01-02T10:00:00.000Z'),
  });
  await (fixture).create('remote_customers', {
    id: 'c2', name: 'Globex', flag: false, meta: { tier: 'silver' },
    when: '2026-02-15', amount: 250, seen_at: new Date('2026-02-16T08:00:00.000Z'),
  });
  await fixture.disconnect?.();
}

function externalDriver(path: string): SqlDriver {
  const ext = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: path },
    useNullAsDefault: true,
    schemaMode: 'external',
  } as any);
  (ext as any).name = 'extds';
  return ext;
}

describe('SqlDriver external read path — remoteName resolution (ADR-0015)', () => {
  it('queries a remote table whose name differs from the object name, with coercion', async () => {
    file = join(tmpdir(), `os-ext-read-${process.pid}-${Date.now()}.db`);
    await seedRemote(file);

    const ext = externalDriver(file);
    await ext.connect?.();
    try {
      // DDL-free registration — must NOT throw (unlike initObjects/syncSchema).
      expect(() =>
        ext.registerExternalObject!({ name: 'ext_customer', external: { remoteName: 'remote_customers' }, fields: FIELDS as any }),
      ).not.toThrow();

      // The bug: this used to throw `no such table: ext_customer`.
      const rows = await ext.find('ext_customer', {});
      expect(rows).toHaveLength(2);

      const acme = rows.find((r: any) => r.name === 'Acme');
      expect(acme).toBeTruthy();
      // Coercion populated despite no DDL having run for the external object:
      expect(acme.flag).toBe(true);                    // boolean (stored 1/0)
      expect(acme.meta).toEqual({ tier: 'gold' });     // json (stored as text)
      expect(acme.when).toBe('2026-01-01');            // date → YYYY-MM-DD
      expect(typeof acme.amount).toBe('number');       // numeric scalar

      // count + findOne route to the remote table too.
      expect(await ext.count('ext_customer', {})).toBe(2);
      const one = await ext.findOne('ext_customer', { where: { name: 'Globex' } });
      expect(one?.name).toBe('Globex');

      // Filtered reads hit the remote table.
      const filtered = await ext.find('ext_customer', { where: { name: 'Acme' } });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Acme');

      // Date filter — guards the coercion re-keying (§3): coercion maps are keyed
      // by the OBJECT name even though the builder now targets the remote table.
      const byDate = await ext.find('ext_customer', { where: { when: '2026-02-15' } });
      expect(byDate).toHaveLength(1);
      expect(byDate[0].name).toBe('Globex');

      // Datetime filter — the SQLite epoch-affinity case the §3 trap would break
      // if coercion were keyed by the physical (remote) name instead of object.
      const byDatetime = await ext.find('ext_customer', { where: { seen_at: '2026-01-02T10:00:00.000Z' } });
      expect(byDatetime.map((r: any) => r.name)).toContain('Acme');

      // No object-named table was ever created in the remote db (no DDL leaked).
      const k = (ext as any).knex;
      expect(await k.schema.hasTable('ext_customer')).toBe(false);
      expect(await k.schema.hasTable('remote_customers')).toBe(true);
    } finally {
      await ext.disconnect?.();
    }
  });

  it('still throws on initObjects/syncSchema (DDL) for external objects', async () => {
    const ext = externalDriver(file);
    await ext.connect?.();
    try {
      await expect(
        ext.initObjects([{ name: 'ext_customer', fields: FIELDS }]),
      ).rejects.toBeInstanceOf(ExternalSchemaModeViolationError);
    } finally {
      await ext.disconnect?.();
    }
  });

  it('an object whose name equals the remote table also works (no remap)', async () => {
    const ext = externalDriver(file);
    await ext.connect?.();
    try {
      ext.registerExternalObject!({ name: 'remote_customers', external: {}, fields: FIELDS as any });
      const rows = await ext.find('remote_customers', {});
      expect(rows.length).toBe(2);
    } finally {
      await ext.disconnect?.();
    }
  });

  it('treats remoteSchema as a no-op on sqlite (bare table)', async () => {
    const ext = externalDriver(file);
    await ext.connect?.();
    try {
      ext.registerExternalObject!({ name: 'ext_cust2', external: { remoteName: 'remote_customers', remoteSchema: 'mart' }, fields: FIELDS as any });
      const rows = await ext.find('ext_cust2', {});
      expect(rows.length).toBe(2);
    } finally {
      await ext.disconnect?.();
    }
  });
});
