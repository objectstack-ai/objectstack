// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { RemoteTransport } from './remote-transport.js';

/**
 * Regression: RemoteTransport.buildWhereSQL emitted `col = ?` (bind null) for a
 * null filter value, producing `col = NULL` — which is always UNKNOWN in SQL and
 * matches zero rows. Env-wide metadata + drafts are stored with
 * `organization_id IS NULL`, so EVERY env-wide draft read came back empty even
 * though the row was written (write used INSERT … NULL, which persists fine).
 * This silently broke the whole AI authoring loop (draft → review → publish) on
 * cloud tenant envs running Turso in remote mode — local/replica mode goes
 * through Knex, which already special-cases null → IS NULL, so it never showed
 * up locally. Null filters MUST compile to `IS NULL` / `IS NOT NULL`.
 */
function transportWithCapturingClient() {
  const calls: Array<{ sql: string; args: any[] }> = [];
  const client = {
    execute: vi.fn(async (stmt: any) => {
      calls.push({ sql: stmt.sql ?? String(stmt), args: stmt.args ?? [] });
      return { rows: [], columns: [] };
    }),
    close: vi.fn(),
  };
  const t = new RemoteTransport();
  t.setClient(client as any);
  return { t, calls };
}

describe('RemoteTransport null-where compilation', () => {
  it('compiles { col: null } to `IS NULL` (not `= NULL`) and binds no arg', async () => {
    const { t, calls } = transportWithCapturingClient();
    await t.find('sys_metadata', { where: { organization_id: null, state: 'draft' } });
    const { sql, args } = calls[0];
    expect(sql).toMatch(/"organization_id"\s+IS NULL/i);
    expect(sql).not.toMatch(/"organization_id"\s*=\s*\?/);
    // only the non-null `state` filter contributes a bind arg
    expect(args).toEqual(['draft']);
  });

  it('keeps `= ?` for non-null equality', async () => {
    const { t, calls } = transportWithCapturingClient();
    await t.find('sys_metadata', { where: { organization_id: 'org_123', state: 'draft' } });
    const { sql, args } = calls[0];
    expect(sql).toMatch(/"organization_id"\s*=\s*\?/);
    expect(sql).not.toMatch(/IS NULL/i);
    expect(args).toEqual(['org_123', 'draft']);
  });

  it('compiles { $eq: null } to `IS NULL` and { $ne: null } to `IS NOT NULL`', async () => {
    const { t, calls } = transportWithCapturingClient();
    await t.find('t', { where: { a: { $eq: null }, b: { $ne: null } } });
    const { sql, args } = calls[0];
    expect(sql).toMatch(/"a"\s+IS NULL/i);
    expect(sql).toMatch(/"b"\s+IS NOT NULL/i);
    expect(args).toEqual([]);
  });
});
