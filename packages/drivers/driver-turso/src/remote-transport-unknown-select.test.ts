// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { RemoteTransport } from './remote-transport.js';

/**
 * Regression: a `$select` projection naming a column the table lacks made the
 * WHOLE remote query fail, and find() swallowed the "no such column" error into
 * an empty array. The objectui list renderer auto-requests view-binding fields
 * (status/due_date/image/priority/start_date/end_date) for every object, so an
 * AI-built `product` without those fields rendered "Nothing here yet" even
 * though its seed rows were in the env DB. The remote Turso path overrides
 * SqlDriver.find(), so it needs its own retry-with-SELECT-* backstop.
 */
function transportWithClient(execute: (stmt: any) => Promise<any>) {
  const calls: Array<{ sql: string; args: any[] }> = [];
  const client = {
    execute: vi.fn(async (stmt: any) => {
      calls.push({ sql: stmt.sql ?? String(stmt), args: stmt.args ?? [] });
      return execute(stmt);
    }),
    close: vi.fn(),
  };
  const t = new RemoteTransport();
  t.setClient(client as any);
  return { t, calls };
}

describe('RemoteTransport unknown-$select column', () => {
  it('returns rows by retrying with SELECT * when a projected column is unknown', async () => {
    const rows = [
      { id: '1', product_name: 'Widget' },
      { id: '2', product_name: 'Gadget' },
    ];
    const { t, calls } = transportWithClient(async (stmt) => {
      // The projection naming `status`/`due_date` fails; SELECT * succeeds.
      if (/"status"|"due_date"/.test(stmt.sql)) {
        throw new Error('SQLITE_ERROR: no such column: status');
      }
      return { rows, columns: ['id', 'product_name'] };
    });

    const result = await t.find('product', {
      fields: ['id', 'product_name', 'status', 'due_date'],
      limit: 100,
    });

    expect(result).toHaveLength(2);
    // First attempt used the projection; the retry fell back to SELECT *.
    expect(calls[0].sql).toMatch(/"status"/);
    expect(calls[1].sql).toMatch(/SELECT \* FROM "product"/);
  });

  it('still returns empty when even SELECT * fails (e.g. unknown table)', async () => {
    const { t } = transportWithClient(async () => {
      throw new Error('SQLITE_ERROR: no such column: status');
    });
    const result = await t.find('ghost', { fields: ['id', 'status'], limit: 10 });
    expect(result).toEqual([]);
  });

  it('propagates non-column errors instead of hiding them as empty', async () => {
    const { t } = transportWithClient(async () => {
      throw new Error('SQLITE_BUSY: database is locked');
    });
    await expect(t.find('product', { fields: ['id'] })).rejects.toThrow(/locked/);
  });
});
