// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20424] `TursoDriver` LOCAL and REMOTE — a missing table or a missing
 * column is refused on both faces, with the same code, and never read as
 * "there are no rows".
 *
 * ## What was measured before this change
 *
 * Base `6e3e5462c`. The remote face is a `TursoDriver` over a real
 * `@libsql/client` on a `file:` database. The local control is a `TursoDriver`
 * over the SAME file. A declared field whose column is absent is a field the
 * object declares and the table lacks: schema drift.
 *
 * ```
 * row  read                                               local                 remote
 * 1    aggregate, the mapped table really absent          DATABASE_ERROR / 500  []
 * 2    aggregate grouped by that field                    INVALID_FIELD / 400   []
 * 3    find whose where names that field                  INVALID_FILTER / 400  []
 *      findOne, the same where                            INVALID_FILTER / 400  null
 *      count, the same where                              INVALID_FILTER / 400  DATABASE_ERROR / 500
 *      aggregate over that field (sum)                    INVALID_FIELD / 400   []
 *      aggregate whose where names that field             INVALID_FILTER / 400  []
 *      find ordered by that field                         rows, unordered       []
 * ```
 *
 * Rows 1 to 3 held for a managed object too, with its table or its column
 * dropped under it. The `[]` answers came from two catches in
 * `RemoteTransport`: `aggregate`'s, which mapped `no such table` and `no such
 * column` to `[]`, and the terminal of `find`'s projection backstop, which
 * mapped `no such column` to `[]` once the projection retry was spent or when
 * there was no projection to drop.
 *
 * ## What is pinned
 *
 * 1. The card's three rows, each as a local-and-remote pair, for a federated
 *    object and for a managed one: both faces refuse with the same `code` and
 *    `status`, which are the local face's.
 * 2. The neighbours the same catches (and the shared find/count exit) reached:
 *    findOne, count, an aggregation over the field, an aggregate whose where
 *    names it. And the ORDER BY: the local ladder drops a sort on a column the
 *    table lacks and answers the rows, and so does the remote face now.
 * 3. Controls: an existing table and column answer the literal rows on both
 *    faces, and a refusal the transport raises while compiling keeps its own
 *    envelope.
 *
 * ## Reverse verification, directions predicted BEFORE running
 *
 * - `RemoteTransport.aggregate`'s catch restored (`[]` for no such table /
 *   column): every aggregate pair in sections 1 and 2 goes RED, the remote
 *   side resolving `[]`. find, findOne, count and the ORDER BY case stay green.
 * - The find ladder's terminal back to `return []`: the find and findOne pairs
 *   go RED (`[]` / `null`). count, aggregate and the ORDER BY case stay green.
 * - `remoteReadFault` answering `backendStatementFault` alone: every 400 pair
 *   goes RED with `DATABASE_ERROR` / 500 on the remote side. Both missing-table
 *   pairs stay green (they are 500 on both faces anyway).
 * - The ORDER BY rung removed: the ORDER BY case goes RED, the remote face
 *   refusing with `INVALID_FILTER` where the local face answers the rows.
 * - The declared-status gate in `remoteReadFault` removed: the synthetic
 *   enveloped-refusal case goes RED, re-worded as `INVALID_FIELD`. The real
 *   compile-refusal control stays green, because no real refusal text parses
 *   as a backend column fault today; the synthetic case is what holds the gate.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { TursoDriver } from './turso-driver.js';

interface Envelope extends Error {
  code?: string;
  status?: number;
}

const QUIET = { warn() {}, error() {}, info() {}, debug() {} };

/** Federated: its table exists, and it declares `region`, which the table lacks. */
const EXT = {
  name: 'ext_t',
  fields: { id: { type: 'text' }, name: { type: 'text' }, amount: { type: 'number' }, region: { type: 'text' } },
  external: { remoteName: 'probe_t' },
};

/** Federated: its mapped table is really absent. */
const EXT_GONE = {
  name: 'ext_gone',
  fields: { id: { type: 'text' }, name: { type: 'text' } },
  external: { remoteName: 'absent_t' },
};

/** Managed: synced by the driver; its `region` column is dropped under it. */
const MANAGED = {
  name: 'managed_t',
  fields: { name: { type: 'text' }, amount: { type: 'number' }, region: { type: 'text' } },
};

/** Managed: synced by the driver; its table is dropped under it. */
const MANAGED_GONE = { name: 'managed_gone', fields: { name: { type: 'text' } } };

const SEED = [
  { id: 'a', name: 'alpha', amount: 1 },
  { id: 'b', name: 'beta', amount: 2 },
  { id: 'c', name: 'beta', amount: 4 },
];

const scratch = mkdtempSync(join(tmpdir(), 'turso-20424-'));

type Face = { driver: TursoDriver; client: Client | null };

async function localFace(file: string): Promise<Face> {
  const driver = new TursoDriver({ url: `file:${file}` });
  (driver as unknown as { logger: typeof QUIET }).logger = QUIET;
  await driver.connect();
  expect(driver.transportMode).toBe('local');
  return { driver, client: null };
}

async function remoteFace(file: string): Promise<Face> {
  const client = createClient({ url: `file:${file}` });
  const driver = new TursoDriver({ url: 'libsql://issue-20424.turso.io', client });
  (driver as unknown as { logger: typeof QUIET }).logger = QUIET;
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  return { driver, client };
}

async function close(face: Face): Promise<void> {
  await face.driver.disconnect();
  face.client?.close();
}

async function refusalOf(run: () => Promise<unknown>): Promise<Envelope> {
  let answer: unknown;
  try {
    answer = await run();
  } catch (e) {
    return e as Envelope;
  }
  throw new Error(`expected the driver to refuse, but the call resolved ${JSON.stringify(answer)}`);
}

const byId = (rows: unknown): Array<Record<string, unknown>> =>
  [...(rows as Array<Record<string, unknown>>)].sort((x, y) => String(x.id).localeCompare(String(y.id)));

let file: string;
let local: Face;
let remote: Face;

beforeAll(async () => {
  file = join(scratch, 'db.sqlite');
  const seed = createClient({ url: `file:${file}` });
  await seed.execute('CREATE TABLE probe_t (id TEXT PRIMARY KEY, name TEXT, amount REAL)');
  for (const row of SEED) {
    await seed.execute({ sql: 'INSERT INTO probe_t (id, name, amount) VALUES (?, ?, ?)', args: [row.id, row.name, row.amount] });
  }
  seed.close();

  local = await localFace(file);
  remote = await remoteFace(file);
  for (const face of [local, remote]) {
    face.driver.registerExternalObject(EXT);
    face.driver.registerExternalObject(EXT_GONE);
  }
  // The remote face creates the managed tables; the local face then syncs the
  // same objects so it holds the same field metadata over the same tables.
  for (const face of [remote, local]) {
    await face.driver.syncSchema(MANAGED.name, MANAGED);
    await face.driver.syncSchema(MANAGED_GONE.name, MANAGED_GONE);
  }
  await remote.driver.create(MANAGED.name, { id: 'm1', name: 'kept', amount: 3, region: 'EU' });

  // The drift: a declared column and a synced table disappear under the driver.
  const raw = createClient({ url: `file:${file}` });
  await raw.execute(`ALTER TABLE ${MANAGED.name} DROP COLUMN region`);
  await raw.execute(`DROP TABLE ${MANAGED_GONE.name}`);
  raw.close();
});

afterAll(async () => {
  await close(local);
  await close(remote);
  rmSync(scratch, { recursive: true, force: true });
});

type Read = (d: TursoDriver) => Promise<unknown>;

/** A refused read: the local face's code and status, and the remote face's, which must be the same. */
function refusedOnBothFaces(label: string, read: Read, expected: { code: string; status: number }): void {
  it(`${label}: local ${expected.code} / ${expected.status}, and remote the same`, async () => {
    const onLocal = await refusalOf(() => read(local.driver));
    expect({ code: onLocal.code, status: onLocal.status }).toEqual(expected);
    const onRemote = await refusalOf(() => read(remote.driver));
    expect({ code: onRemote.code, status: onRemote.status }).toEqual(expected);
  });
}

const agg = (q: Record<string, unknown>) => q as DriverQuery;

// ── 1. The card's three rows ─────────────────────────────────────────────────

describe('[#20424] the three rows, local and remote, federated and managed', () => {
  refusedOnBothFaces(
    'row 1, federated: aggregate on a mapped table that is really absent',
    (d) => d.aggregate(EXT_GONE.name, agg({ aggregations: [{ function: 'count', alias: 'n' }] })),
    { code: 'DATABASE_ERROR', status: 500 },
  );
  refusedOnBothFaces(
    'row 1, managed: aggregate on a synced table dropped under the driver',
    (d) => d.aggregate(MANAGED_GONE.name, agg({ aggregations: [{ function: 'count', alias: 'n' }] })),
    { code: 'DATABASE_ERROR', status: 500 },
  );
  refusedOnBothFaces(
    'row 2, federated: aggregate grouped by a declared field whose column is absent',
    (d) => d.aggregate(EXT.name, agg({ groupBy: ['region'], aggregations: [{ function: 'count', alias: 'n' }] })),
    { code: 'INVALID_FIELD', status: 400 },
  );
  refusedOnBothFaces(
    'row 2, managed: aggregate grouped by a declared field whose column was dropped',
    (d) => d.aggregate(MANAGED.name, agg({ groupBy: ['region'], aggregations: [{ function: 'count', alias: 'n' }] })),
    { code: 'INVALID_FIELD', status: 400 },
  );
  refusedOnBothFaces(
    'row 3, federated: find whose where names a declared field whose column is absent',
    (d) => d.find(EXT.name, { where: { region: 'EU' } }),
    { code: 'INVALID_FILTER', status: 400 },
  );
  refusedOnBothFaces(
    'row 3, managed: find whose where names a declared field whose column was dropped',
    (d) => d.find(MANAGED.name, { where: { region: 'EU' } }),
    { code: 'INVALID_FILTER', status: 400 },
  );
});

// ── 2. What the same catches and the same exit also reached ──────────────────

describe('[#20424] the neighbours, local and remote', () => {
  refusedOnBothFaces(
    'findOne whose where names the absent column',
    (d) => d.findOne(EXT.name, { where: { region: 'EU' } }),
    { code: 'INVALID_FILTER', status: 400 },
  );
  refusedOnBothFaces(
    'find with a projection AND a where naming the absent column (the projection rung cannot save it)',
    (d) => d.find(EXT.name, { where: { region: 'EU' }, fields: ['id', 'region'] } as DriverQuery),
    { code: 'INVALID_FILTER', status: 400 },
  );
  refusedOnBothFaces(
    'count whose where names the absent column',
    (d) => d.count(EXT.name, { where: { region: 'EU' } }),
    { code: 'INVALID_FILTER', status: 400 },
  );
  refusedOnBothFaces(
    'aggregate over the absent column (sum)',
    (d) => d.aggregate(EXT.name, agg({ aggregations: [{ function: 'sum', field: 'region', alias: 's' }] })),
    { code: 'INVALID_FIELD', status: 400 },
  );
  refusedOnBothFaces(
    'aggregate whose where names the absent column',
    (d) => d.aggregate(EXT.name, agg({ where: { region: 'EU' }, aggregations: [{ function: 'count', alias: 'n' }] })),
    { code: 'INVALID_FILTER', status: 400 },
  );
  refusedOnBothFaces(
    'count on a managed object whose column was dropped',
    (d) => d.count(MANAGED.name, { where: { region: 'EU' } }),
    { code: 'INVALID_FILTER', status: 400 },
  );

  it('find ordered by the absent column: the sort is dropped and the rows answer, on both faces', async () => {
    const read: Read = (d) => d.find(EXT.name, { orderBy: [{ field: 'region', order: 'asc' }] } as DriverQuery);
    expect(byId(await read(local.driver))).toEqual(SEED);
    expect(byId(await read(remote.driver))).toEqual(SEED);
  });

  it('find projecting the absent column: the projection is dropped and the rows answer, on both faces', async () => {
    const read: Read = (d) => d.find(EXT.name, { fields: ['id', 'region'] } as DriverQuery);
    expect(byId(await read(local.driver))).toEqual(SEED);
    expect(byId(await read(remote.driver))).toEqual(SEED);
  });
});

// ── 3. Controls ──────────────────────────────────────────────────────────────

describe('[#20424] controls: what exists still answers, and a compile refusal keeps its envelope', () => {
  const ANSWERS: ReadonlyArray<readonly [string, Read, unknown]> = [
    ['find with a filter on a real column', async (d) => byId(await d.find(EXT.name, { where: { name: 'beta' } })), SEED.slice(1)],
    ['findOne', (d) => d.findOne(EXT.name, { where: { id: 'b' } }), SEED[1]],
    ['count with a filter', (d) => d.count(EXT.name, { where: { amount: { $gt: 1 } } }), 2],
    [
      'aggregate grouped by a real column',
      async (d) =>
        [...(await d.aggregate(EXT.name, agg({ groupBy: ['name'], aggregations: [{ function: 'sum', field: 'amount', alias: 's' }] })))].sort(
          (x, y) => String(x.name).localeCompare(String(y.name)),
        ),
      [
        { name: 'alpha', s: 1 },
        { name: 'beta', s: 6 },
      ],
    ],
    ['managed find on its surviving columns', (d) => d.find(MANAGED.name, { where: { name: 'kept' }, fields: ['id', 'name', 'amount'] } as DriverQuery), [{ id: 'm1', name: 'kept', amount: 3 }]],
    ['managed aggregate on a surviving column', (d) => d.aggregate(MANAGED.name, agg({ aggregations: [{ function: 'sum', field: 'amount', alias: 's' }] })), [{ s: 3 }]],
  ];

  for (const [label, read, expected] of ANSWERS) {
    it(`${label}: the same literal answer on both faces`, async () => {
      expect(await read(local.driver)).toEqual(expected);
      expect(await read(remote.driver)).toEqual(expected);
    });
  }

  it('an undeclared aggregate function is refused before any statement, with the same envelope on both faces', async () => {
    const read: Read = (d) => d.aggregate(EXT.name, agg({ aggregations: [{ function: 'COUNT', alias: 'n' }] }));
    const onLocal = await refusalOf(() => read(local.driver));
    const execute = vi.spyOn(remote.client!, 'execute');
    try {
      const onRemote = await refusalOf(() => read(remote.driver));
      expect({ code: onRemote.code, status: onRemote.status }).toEqual({ code: onLocal.code, status: onLocal.status });
      expect(onRemote.status).toBe(400);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      execute.mockRestore();
    }
  });

  it('a refusal that already declares a status leaves the remote exit unchanged, even when its words read as a column fault', async () => {
    // Synthetic on purpose: no real transport refusal is worded like a
    // backend column fault today, so this is what holds the gate that keeps
    // the classifier to the errors the local one would see.
    const transport = (remote.driver as unknown as { remoteTransport: { aggregate: (...args: unknown[]) => Promise<unknown> } })
      .remoteTransport;
    const enveloped = Object.assign(new Error('no such column: region'), { code: 'NOT_IMPLEMENTED', status: 501 });
    const stub = vi.spyOn(transport, 'aggregate').mockRejectedValue(enveloped);
    try {
      const onRemote = await refusalOf(() =>
        remote.driver.aggregate(EXT.name, agg({ groupBy: ['region'], aggregations: [{ function: 'count', alias: 'n' }] })),
      );
      expect(onRemote).toBe(enveloped);
      expect({ code: onRemote.code, status: onRemote.status }).toEqual({ code: 'NOT_IMPLEMENTED', status: 501 });
    } finally {
      stub.mockRestore();
    }
  });
});
