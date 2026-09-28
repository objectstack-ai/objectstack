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

  // [#20424] This case REPLACES the pin 'still returns empty when even SELECT *
  // fails (e.g. unknown table)', which asserted `[]` for exactly this input.
  // `[]` was the defect: a column the WHERE still names once the projection is
  // gone is a predicate that never ran, and "no rows" is a false answer to it.
  // The transport now raises the backend's error from the last rung, and
  // `TursoDriver` classifies it (`INVALID_FILTER` / 400, the local face's
  // answer). The same input, the opposite assertion.
  it('raises the last rung\'s error when even SELECT * fails, instead of answering []', async () => {
    const { t, calls } = transportWithClient(async () => {
      throw new Error('SQLITE_ERROR: no such column: status');
    });
    await expect(t.find('ghost', { fields: ['id', 'status'], limit: 10 })).rejects.toThrow(
      /no such column: status/,
    );
    // The projection attempt, then the one rung this query has.
    expect(calls).toHaveLength(2);
    expect(calls[1].sql).toMatch(/SELECT \* FROM "ghost"/);
  });

  it('propagates non-column errors instead of hiding them as empty', async () => {
    const { t } = transportWithClient(async () => {
      throw new Error('SQLITE_BUSY: database is locked');
    });
    await expect(t.find('product', { fields: ['id'] })).rejects.toThrow(/locked/);
  });
});
