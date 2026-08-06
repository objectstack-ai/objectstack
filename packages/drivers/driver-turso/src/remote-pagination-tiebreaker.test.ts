// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ORDER BY the REMOTE transport actually sends (#5653) — the clause-level
 * companion to `turso-remote-pagination-conformance.test.ts`.
 *
 * That suite asks the contract's question ("is a page walk a partition of the
 * result set?") on rows, which is the only instrument that can catch a *lost*
 * clause. This one asks the question the fix turns on, which rows cannot
 * distinguish on a twelve-row in-memory table: **which clause went out**. Both
 * are needed, and neither substitutes for the other — a plan that happens to
 * return insertion order satisfies the row assertions while the statement
 * carries no tie-breaker at all, which is exactly how the gap #5653 names
 * survived under a green suite.
 *
 * What is pinned here is the three-state table `SqlDriver.orderKeysFor`
 * implements, observed through the SQL the remote transport emits:
 *
 * | `orderBy` | paged | ORDER BY sent |
 * |---|---|---|
 * | non-empty | either | caller's keys, then `"id"` |
 * | empty | `limit`/`offset` present | `"id"` alone |
 * | empty | neither | **none** — objectstack#4363's carve-out |
 *
 * plus the two conditions that keep it honest: a `findOne` (whose `limit: 1`
 * the transport injects *itself*) must NOT be read as a page, and a table this
 * driver never created gets no invented `id` column.
 */

import { describe, it, expect, vi } from 'vitest';
import { TursoDriver } from './turso-driver.js';

const TICKET_OBJECT = {
  name: 'ticket',
  fields: {
    status: { type: 'string' },
    rank: { type: 'integer' },
  },
};

/**
 * A remote driver over a client that records every statement and answers with
 * no rows. Rows are irrelevant here — the statement is the measurement.
 */
async function makeRecordingRemoteDriver(options?: { sync?: boolean }) {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const record = (stmt: any) => {
    statements.push({ sql: stmt?.sql ?? String(stmt), args: stmt?.args ?? [] });
    return { rows: [], columns: [], rowsAffected: 0 };
  };
  const client = {
    execute: vi.fn(async (stmt: any) => record(stmt)),
    batch: vi.fn(async (stmts: any[]) => stmts.map(record)),
    close: vi.fn(),
  };
  const driver = new TursoDriver({
    url: 'libsql://tiebreaker.turso.io',
    client: client as never,
  });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  if (options?.sync !== false) {
    await driver.syncSchema(TICKET_OBJECT.name, TICKET_OBJECT);
  }
  statements.length = 0; // drop the DDL round-trip; only reads are under test
  return { driver, statements };
}

/** The ORDER BY clause of the last statement sent, or `null` if it had none. */
const lastOrderBy = (statements: Array<{ sql: string }>): string | null => {
  const sql = statements[statements.length - 1]?.sql ?? '';
  const match = /ORDER BY (.*?)(?: LIMIT | OFFSET |$)/.exec(sql);
  return match ? match[1] : null;
};

describe('TursoDriver remote — the ORDER BY a paged read goes out with (#5653)', () => {
  it('appends the id tie-breaker after the caller sort keys on a paged read', async () => {
    const { driver, statements } = await makeRecordingRemoteDriver();
    await driver.find('ticket', {
      orderBy: [{ field: 'status', order: 'asc' }],
      limit: 5,
      offset: 5,
    });
    expect(lastOrderBy(statements)).toBe('"status" ASC, "id" ASC');
    expect(statements[statements.length - 1].sql).toContain('LIMIT ? OFFSET ?');
    await driver.disconnect();
  });

  it('orders a paged read with NO orderBy by id alone', async () => {
    const { driver, statements } = await makeRecordingRemoteDriver();
    await driver.find('ticket', { limit: 5, offset: 5 });
    expect(lastOrderBy(statements)).toBe('"id" ASC');
    await driver.disconnect();
  });

  it('leaves an UNPAGED unordered read with no ORDER BY at all (#4363 carve-out)', async () => {
    // The carve-out is half the fix, not a leftover: an unpaged read hands back
    // the whole matching set, so there is no partial view to be wrong about,
    // and an imposed sort would only change plan selection for the majority of
    // reads in the system.
    const { driver, statements } = await makeRecordingRemoteDriver();
    await driver.find('ticket', {});
    expect(statements[statements.length - 1].sql).not.toContain('ORDER BY');
    expect(lastOrderBy(statements)).toBeNull();
    await driver.disconnect();
  });

  it('still appends the tie-breaker to an UNPAGED sorted read', async () => {
    // Row one of the table: a caller who named a non-unique key gets a total
    // order whether or not this particular statement is sliced — which is what
    // makes the paged walk and the whole-set read agree.
    const { driver, statements } = await makeRecordingRemoteDriver();
    await driver.find('ticket', { orderBy: [{ field: 'status', order: 'asc' }] });
    expect(lastOrderBy(statements)).toBe('"status" ASC, "id" ASC');
    await driver.disconnect();
  });

  it('counts `limit` alone as paged — page one is not exempt', async () => {
    // A page one that disagrees with the ordering pages two onward use leaves
    // the defect fully intact while looking like a fix.
    const { driver, statements } = await makeRecordingRemoteDriver();
    await driver.find('ticket', { limit: 50 });
    expect(lastOrderBy(statements)).toBe('"id" ASC');
    await driver.disconnect();
  });

  it('follows the last requested key direction, so a compound index still walks in one pass', async () => {
    const { driver, statements } = await makeRecordingRemoteDriver();
    await driver.find('ticket', {
      orderBy: [{ field: 'status', order: 'asc' }, { field: 'rank', order: 'desc' }],
      limit: 5,
    });
    expect(lastOrderBy(statements)).toBe('"status" ASC, "rank" DESC, "id" DESC');
    await driver.disconnect();
  });

  it('does not repeat a key the caller already sorted by', async () => {
    const { driver, statements } = await makeRecordingRemoteDriver();
    await driver.find('ticket', { orderBy: [{ field: 'id', order: 'desc' }], limit: 5 });
    expect(lastOrderBy(statements)).toBe('"id" DESC');
    await driver.disconnect();
  });

  it('leaves findOne unsorted despite the `limit: 1` the transport injects itself', async () => {
    // `RemoteTransport.findOne` spells an id lookup as `find(..., limit: 1)`.
    // Read as a page that would earn `ORDER BY id LIMIT 1` — the shape that
    // makes a planner drop the predicate's own index and walk the primary key
    // (~100× on the measurement in `SqlDriver.findRows`). findOne promises *a*
    // matching record, never a position in a sequence, so there is no partition
    // to preserve and nothing to buy with that.
    const { driver, statements } = await makeRecordingRemoteDriver();
    await driver.findOne('ticket', { where: { id: 't1' } });
    const sql = statements[statements.length - 1].sql;
    expect(sql).toContain('LIMIT ?');
    expect(sql).not.toContain('ORDER BY');
    await driver.disconnect();
  });

  it('still completes a findOne that asked for its OWN order — singleRowLookup withholds nothing there', async () => {
    const { driver, statements } = await makeRecordingRemoteDriver();
    await driver.findOne('ticket', {
      where: { status: 'open' },
      orderBy: [{ field: 'rank', order: 'asc' }],
    });
    // Row one of the table is "non-empty `orderBy` | either | caller's keys +
    // id", and `either` means it — `singleRowLookup` only governs the row below
    // it, where the caller named no key at all and the alternative would be to
    // invent a whole sort for a lookup that never promised a position. A caller
    // who DID name a key asked for a defined order among its ties, so the
    // tie-breaker completes it here exactly as it does locally
    // (`SqlDriver.findRows` reaches `orderKeysFor` with the same flag and the
    // same non-empty key list, and appends the same column).
    expect(lastOrderBy(statements)).toBe('"rank" ASC, "id" ASC');
    await driver.disconnect();
  });

  it('invents no ordering column for a table this driver did not create', async () => {
    // The precondition the whole rule rests on: `id` is known to exist because
    // `RemoteTransport.buildCreateTableSQL` wrote it. On a table that arrived
    // some other way, `ORDER BY id` risks failing the entire statement, so the
    // conservative answer — prior behaviour exactly — is the right one.
    const { driver, statements } = await makeRecordingRemoteDriver({ sync: false });
    await driver.find('unmanaged_table', { limit: 5, offset: 5 });
    expect(statements[statements.length - 1].sql).not.toContain('ORDER BY');
    await driver.disconnect();
  });

  it('says so once when a paged unsorted read cannot be made deterministic', async () => {
    // A MUST that quietly does not hold is the invisible failure the rule was
    // written against, so the unserviceable case is announced rather than left
    // to a user counting records. Once per object, not once per query.
    const { driver } = await makeRecordingRemoteDriver({ sync: false });
    const warn = vi.spyOn((driver as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');
    await driver.find('unmanaged_table', { limit: 5 });
    await driver.find('unmanaged_table', { limit: 5, offset: 5 });
    const matching = warn.mock.calls.filter((c) => /NOT deterministic/.test(String(c[0])));
    expect(matching).toHaveLength(1);
    warn.mockRestore();
    await driver.disconnect();
  });
});
