// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The remote face's statements are counted into Server-Timing `db`.
 *
 * The local face is counted by `SqlDriver.installQueryTiming()`, which listens
 * on knex's `query` / `query-response` events. The remote face sends every
 * statement through `@libsql/client` directly, so knex never saw one and a
 * hosted environment answered `db;dur=0;desc="0 queries"` on every request.
 * `RemoteTransport.sendStatement` / `sendBatch` are now the one door each
 * round trip leaves through, and each folds into the ambient collector as
 * `count('db', dur, 'queries')`, the mark the local face produces.
 *
 * What is pinned, and why each half:
 *
 * - one `execute` and one `batch` give a `db` count of 2 (the acceptance case);
 * - detail samples carry the SQL SHAPE, a batch labelled `batch(N): <first>`,
 *   and no binding value anywhere in the collector or the header;
 * - a failed round trip is still counted (the local face settles on
 *   `query-error` too), and the failure still reaches the caller;
 * - with no collector the statement still runs (the no-request-scope path);
 * - end to end through `TursoDriver` in remote mode, the `db` count equals the
 *   round trips the client actually received: no door bypasses the count and
 *   the connection-less knex the remote face still constructs adds nothing;
 * - a census of the transport's source: every `client.execute` /
 *   `client.batch` call sits inside the two helpers, so a door added later
 *   cannot send an uncounted statement.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@libsql/client';
import { PerfTiming, runWithPerfTiming } from '@objectstack/observability';
import { afterEach, describe, expect, it } from 'vitest';
import { makeLibsqlSqliteStub, asLibsqlClient } from './libsql-sqlite-stub.testkit.js';
import { RemoteTransport } from './remote-transport.js';
import { TursoDriver } from './turso-driver.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECRET = 'binding-value-never-recorded';

/** A client that answers every statement with no rows and records what it received. */
function stubClient(opts: { failExecute?: boolean } = {}) {
  const received: unknown[] = [];
  const client = {
    async execute(stmt: unknown) {
      received.push(stmt);
      if (opts.failExecute) throw new Error('remote round trip failed');
      return { rows: [], columns: [], rowsAffected: 0 };
    },
    async batch(stmts: unknown[]) {
      received.push(stmts);
      return stmts.map(() => ({ rows: [], columns: [], rowsAffected: 0 }));
    },
    close() {},
  };
  return { client: client as unknown as Client, received };
}

function transportOver(client: Client): RemoteTransport {
  const transport = new RemoteTransport();
  transport.setClient(client);
  return transport;
}

function dbMark(timing: PerfTiming) {
  return timing.marks().find((m) => m.name === 'db');
}

describe('RemoteTransport counts each round trip into Server-Timing db', () => {
  it('one execute and one batch give a db count of 2, with SQL shapes and no bindings', async () => {
    const { client } = stubClient();
    const transport = transportOver(client);
    const timing = new PerfTiming();
    timing.enableDetail();

    await runWithPerfTiming(timing, async () => {
      await transport.execute('SELECT id FROM account WHERE name = ?', [SECRET]);
      await transport.batch(
        [
          { sql: 'UPDATE account SET name = ? WHERE id = ?', args: [SECRET, 'a1'] },
          { sql: 'DELETE FROM account WHERE id = ?', args: [SECRET] },
        ],
        'write',
      );
    });

    expect(dbMark(timing)?.desc).toBe('2 queries');
    expect(timing.details('db').map((d) => d.label)).toEqual([
      'SELECT id FROM account WHERE name = ?',
      'batch(2): UPDATE account SET name = ? WHERE id = ?',
    ]);
    const everything = JSON.stringify({ marks: timing.marks(), detail: timing.details('db') }) + timing.toHeader();
    expect(everything).not.toContain(SECRET);
    expect(timing.toHeader()).toMatch(/^db;dur=[\d.]+;desc="2 queries"$/);
  });

  it('counts without recording a sample when detail capture is off', async () => {
    const { client } = stubClient();
    const transport = transportOver(client);
    const timing = new PerfTiming();

    await runWithPerfTiming(timing, async () => {
      await transport.execute('SELECT 1');
      await transport.batch(['SELECT 1', 'SELECT 2'], 'read');
    });

    expect(dbMark(timing)?.desc).toBe('2 queries');
    expect(timing.details('db')).toEqual([]);
  });

  it('counts a failed round trip and still hands the failure to the caller', async () => {
    const { client } = stubClient({ failExecute: true });
    const transport = transportOver(client);
    const timing = new PerfTiming();
    timing.enableDetail();

    await runWithPerfTiming(timing, async () => {
      await expect(transport.execute('SELECT * FROM account WHERE id = ?', [SECRET])).rejects.toThrow(
        'remote round trip failed',
      );
    });

    expect(dbMark(timing)?.desc).toBe('1 queries');
    expect(timing.details('db').map((d) => d.label)).toEqual(['SELECT * FROM account WHERE id = ?']);
  });

  it('sends the statement unchanged when no collector is active', async () => {
    const { client, received } = stubClient();
    const transport = transportOver(client);

    await transport.execute('SELECT ? AS x', [1]);
    await transport.batch(['SELECT 1'], 'read');

    expect(received).toEqual([{ sql: 'SELECT ? AS x', args: [1] }, ['SELECT 1']]);
  });
});

describe('TursoDriver in remote mode: the db count equals the round trips sent', () => {
  const open: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (open.length) await open.pop()!();
  });

  it('counts every statement the doors send, and nothing else', async () => {
    const stub = makeLibsqlSqliteStub();
    let roundTrips = 0;
    const counting = {
      execute: (stmt: unknown) => {
        roundTrips += 1;
        return stub.execute(stmt);
      },
      batch: (stmts: unknown[]) => {
        roundTrips += 1;
        return stub.batch(stmts);
      },
      close: () => stub.close(),
      raw: stub.raw,
    };
    const driver = new TursoDriver({
      url: 'libsql://server-timing.example.turso.io',
      client: asLibsqlClient(counting),
    });
    open.push(async () => {
      await driver.disconnect().catch(() => {});
    });
    await driver.connect();
    expect(driver.transportMode).toBe('remote');

    const timing = new PerfTiming();
    timing.enableDetail();
    const before = roundTrips;
    await runWithPerfTiming(timing, async () => {
      await driver.syncSchema('account', {
        name: 'account',
        fields: { name: { type: 'text' }, rank: { type: 'number' } },
      });
      await driver.create('account', { name: SECRET, rank: 1 });
      const rows = await driver.find('account', { where: { name: SECRET } });
      expect(rows).toHaveLength(1);
      expect(await driver.count('account', { where: { rank: 1 } })).toBe(1);
    });
    const sent = roundTrips - before;

    expect(sent).toBeGreaterThan(3);
    expect(dbMark(timing)?.desc).toBe(`${sent} queries`);
    expect(timing.details('db')).toHaveLength(sent);
    expect(JSON.stringify(timing.details('db'))).not.toContain(SECRET);
  });
});

describe('census: every client round trip in remote-transport.ts goes through the counting helpers', () => {
  it('no client.execute / client.batch call sits outside sendStatement and sendBatch', () => {
    const lines = readFileSync(resolve(HERE, 'remote-transport.ts'), 'utf8').split('\n');
    const start = lines.findIndex((l) => l.includes('private async sendStatement('));
    const end = lines.findIndex((l) => l.includes('private static statementShape('));
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);

    const call = /\bclient!?\s*\.\s*(execute|batch|executeMultiple|migrate|transaction)\s*\(/;
    const outside = lines
      .map((text, i) => ({ line: i + 1, text }))
      .filter(({ line, text }) => (line - 1 < start || line - 1 > end) && call.test(text))
      .filter(({ text }) => !/^\s*(\*|\/\/)/.test(text));
    expect(outside).toEqual([]);

    const inside = lines.slice(start, end).filter((t) => call.test(t));
    expect(inside).toHaveLength(4);
  });
});
