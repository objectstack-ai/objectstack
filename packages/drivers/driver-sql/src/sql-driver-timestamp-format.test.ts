// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical audit-timestamp format on SQLite.
 *
 * SQLite has no native timestamp type. The two write paths used to disagree:
 * INSERT fell back to the column default `CURRENT_TIMESTAMP`
 * (`'YYYY-MM-DD HH:MM:SS'`) while UPDATE stamped
 * `toISOString().replace('T',' ').replace('Z','')`
 * (`'YYYY-MM-DD HH:MM:SS.mmm'`). BOTH were timezone-NAIVE: `Date.parse` reads a
 * zone-less, space-separated string as LOCAL time, so a UTC wall-clock value
 * silently shifted by the host offset on a non-UTC runtime — the bug that made
 * the objectos kernel freshness probe never evict (it compared a shifted
 * `updated_at` against an absolute `builtAtMs`).
 *
 * These tests pin the fix: every driver write path stamps a single canonical
 * ISO-8601-with-`Z` instant, INSERT and UPDATE agree on that one format, and
 * legacy/raw zone-naive rows are repaired to the same format on read.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('SqlDriver canonical audit-timestamp format (SQLite)', () => {
  let driver: SqlDriver;
  let raw: any;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    raw = (driver as any).knex;
    await driver.initObjects([
      { name: 'thing', fields: { name: { type: 'string' } } },
    ]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('create() stamps created_at AND updated_at as canonical ISO-8601 Z (raw on disk)', async () => {
    await driver.create('thing', { id: 't1', name: 'A' }, { bypassTenantAudit: true });
    const row = await raw('thing').where('id', 't1').first();
    expect(row.created_at).toMatch(ISO_Z);
    expect(row.updated_at).toMatch(ISO_Z);
    // both stamped from one instant on insert
    expect(row.created_at).toBe(row.updated_at);
  });

  it('update() stamps updated_at canonical, INSERT and UPDATE agree on the format, created_at is preserved', async () => {
    await driver.create('thing', { id: 't2', name: 'A' }, { bypassTenantAudit: true });
    const inserted = await raw('thing').where('id', 't2').first();
    await new Promise((r) => setTimeout(r, 5));
    await driver.update('thing', 't2', { name: 'B' }, { bypassTenantAudit: true });
    const updated = await raw('thing').where('id', 't2').first();

    expect(updated.updated_at).toMatch(ISO_Z);          // same canonical shape as insert
    expect(inserted.updated_at).toMatch(ISO_Z);
    expect(updated.created_at).toBe(inserted.created_at); // created_at immutable
    // Lexicographic == chronological for ISO-8601-Z, so a SQL ORDER BY is correct.
    expect(updated.updated_at >= updated.created_at).toBe(true);
  });

  // ── #3493 — historical import preserves a supplied updated_at on UPDATE ──────

  it('update({ preserveAudit }) KEEPS a caller-supplied updated_at instead of force-stamping now', async () => {
    await driver.create('thing', { id: 'h1', name: 'A' }, { bypassTenantAudit: true });
    const historical = '2021-03-01T09:00:00.000Z';
    await driver.update('thing', 'h1', { name: 'B', updated_at: historical }, { bypassTenantAudit: true, preserveAudit: true });
    const row = await raw('thing').where('id', 'h1').first();
    expect(row.name).toBe('B');
    expect(row.updated_at).toBe(historical); // original timeline preserved, not "now"
  });

  it('update({ preserveAudit }) with NO supplied updated_at still stamps now (fills-only-empty)', async () => {
    await driver.create('thing', { id: 'h2', name: 'A' }, { bypassTenantAudit: true });
    await new Promise((r) => setTimeout(r, 5));
    await driver.update('thing', 'h2', { name: 'B' }, { bypassTenantAudit: true, preserveAudit: true });
    const row = await raw('thing').where('id', 'h2').first();
    expect(row.updated_at).toMatch(ISO_Z);
  });

  it('update() WITHOUT preserveAudit force-advances updated_at even if the caller supplies one (regression)', async () => {
    await driver.create('thing', { id: 'h3', name: 'A' }, { bypassTenantAudit: true });
    const historical = '2021-03-01T09:00:00.000Z';
    await driver.update('thing', 'h3', { name: 'B', updated_at: historical }, { bypassTenantAudit: true });
    const row = await raw('thing').where('id', 'h3').first();
    expect(row.updated_at).toMatch(ISO_Z);
    expect(row.updated_at).not.toBe(historical); // normal update overwrites with now
  });

  it('no on-disk format mixing: an inserted-only row and an updated row share one format (SQL ORDER BY safe)', async () => {
    await driver.create('thing', { id: 'never', name: 'x' }, { bypassTenantAudit: true });
    await driver.create('thing', { id: 'edited', name: 'y' }, { bypassTenantAudit: true });
    await driver.update('thing', 'edited', { name: 'y2' }, { bypassTenantAudit: true });
    const rows = await raw('thing').select('updated_at');
    for (const r of rows) expect(r.updated_at).toMatch(ISO_Z);
  });

  it('preserves a caller-provided created_at, still stamps a missing updated_at', async () => {
    const provided = '2025-03-01T12:00:00.000Z';
    await driver.create('thing', { id: 't3', name: 'A', created_at: provided }, { bypassTenantAudit: true });
    const row = await raw('thing').where('id', 't3').first();
    expect(row.created_at).toBe(provided);
    expect(row.updated_at).toMatch(ISO_Z);
  });

  it('bulkCreate stamps canonical timestamps', async () => {
    await driver.bulkCreate('thing', [
      { id: 'b1', name: '1' },
      { id: 'b2', name: '2' },
    ], { bypassTenantAudit: true });
    const rows = await raw('thing').whereIn('id', ['b1', 'b2']).select('created_at', 'updated_at');
    for (const r of rows) {
      expect(r.created_at).toMatch(ISO_Z);
      expect(r.updated_at).toMatch(ISO_Z);
    }
  });

  it('upsert: insert stamps canonical; a conflicting merge preserves created_at and advances updated_at', async () => {
    await driver.upsert('thing', { id: 'u1', name: 'first' }, ['id'], { bypassTenantAudit: true });
    const afterInsert = await raw('thing').where('id', 'u1').first();
    expect(afterInsert.created_at).toMatch(ISO_Z);
    expect(afterInsert.updated_at).toMatch(ISO_Z);

    await new Promise((r) => setTimeout(r, 5));
    await driver.upsert('thing', { id: 'u1', name: 'second' }, ['id'], { bypassTenantAudit: true });
    const afterMerge = await raw('thing').where('id', 'u1').first();
    expect(afterMerge.name).toBe('second');
    expect(afterMerge.created_at).toBe(afterInsert.created_at);   // created_at immutable on merge
    expect(afterMerge.updated_at).toMatch(ISO_Z);
    expect(afterMerge.updated_at >= afterInsert.updated_at).toBe(true);
  });

  // ── Read-side tolerant reader (legacy / raw zone-naive rows) ────────────────

  it('repairs a legacy space-separated row to canonical ISO-Z on read, interpreting it as UTC', async () => {
    // Simulate a row written by the OLD update stamp / CURRENT_TIMESTAMP default,
    // bypassing the driver write path entirely.
    await raw('thing').insert({ id: 'legacy', name: 'L', created_at: '2026-01-15 08:30:00', updated_at: '2026-01-15 08:30:00.246' });
    const row: any = await driver.findOne('thing', { where: { id: 'legacy' } }, { bypassTenantAudit: true });
    expect(row.created_at).toBe('2026-01-15T08:30:00.000Z');
    expect(row.updated_at).toBe('2026-01-15T08:30:00.246Z');
  });

  it('REGRESSION (freshness probe): the repaired instant equals the UTC wall-clock, host-timezone-independent', async () => {
    // The zone-naive '2026-01-15 08:30:00' must mean 08:30 UTC, NOT 08:30 local.
    await raw('thing').insert({ id: 'fr', name: 'F', created_at: '2026-01-15 08:30:00', updated_at: '2026-01-15 08:30:00' });
    const row: any = await driver.findOne('thing', { where: { id: 'fr' } }, { bypassTenantAudit: true });
    expect(new Date(row.updated_at as string).getTime()).toBe(Date.parse('2026-01-15T08:30:00.000Z'));
  });

  it('read-repair is idempotent: an already-canonical value is returned unchanged', async () => {
    const canonical = '2026-02-02T02:02:02.222Z';
    await raw('thing').insert({ id: 'canon', name: 'C', created_at: canonical, updated_at: canonical });
    const row: any = await driver.findOne('thing', { where: { id: 'canon' } }, { bypassTenantAudit: true });
    expect(row.created_at).toBe(canonical);
    expect(row.updated_at).toBe(canonical);
  });

  it('presents a Field.datetime-typed audit column as canonical ISO-Z (Field.datetime owns it)', async () => {
    // When created_at is declared `datetime`, better-sqlite3 stores a JS Date as
    // INTEGER ms. The audit repair leaves that number alone, but the Field.datetime
    // read-normalization (normalizeSqliteDatetimeOutput) now owns its presentation
    // and folds it to one canonical ISO-8601-Z instant — consistent with every
    // other datetime field, and with the string-typed audit columns above.
    const dd = new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    });
    try {
      await dd.initObjects([{ name: 'evt', fields: { created_at: { type: 'datetime' }, label: { type: 'string' } } }]);
      await dd.create('evt', { id: 'e1', label: 'x', created_at: new Date('2026-04-04T04:04:04.004Z') }, { bypassTenantAudit: true });
      const row: any = await dd.findOne('evt', { where: { id: 'e1' } }, { bypassTenantAudit: true });
      expect(typeof row.created_at).toBe('string');
      expect(row.created_at).toBe('2026-04-04T04:04:04.004Z');
    } finally {
      await dd.disconnect();
    }
  });
});
