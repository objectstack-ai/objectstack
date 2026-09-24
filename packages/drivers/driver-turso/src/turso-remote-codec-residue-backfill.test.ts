// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19868 — the `date` and `json` cells the pre-#19844 batch door stored
 * without the write codec, and the remote backfill that converges the ones
 * whose value can be told from their bytes.
 *
 * Every case writes through the PRE-FIX arm first: `RemoteTransport
 * .syncSchemasBatch` alone, with no field registration, which is what
 * `TursoDriver.syncSchemasBatch` did before #19844. `formatInput` then has no
 * registry to read, so a `date` reaches disk as the caller wrote it (a `Date`
 * as its `toISOString()`) and a json scalar reaches disk bare. The fixed driver
 * then boots over the same database through `syncSchemasBatch`, the door the
 * engine's boot sync takes. The double is `makeLibsqlSqliteStub`, so every
 * assertion is on real SQLite cells.
 *
 * What is pinned:
 *
 * 1. The before-state, so the rest is not vacuous.
 * 2. Every recoverable class: its cell before, its cell after, its read-back.
 *    For `date`, the calendar-day filter now matches.
 * 3. No cell reads differently after the backfill than before it.
 * 4. Every ambiguous class, and the two excluded ones, left byte-for-byte.
 * 5. Idempotence: a second boot writes nothing.
 * 6. Paging, budget and resume; compare-and-set; a failed probe.
 * 7. The pre-filter selects what the codec rewrites.
 */

import { describe, it, expect } from 'vitest';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, asLibsqlClient, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import type { RemoteBackfillClient } from './remote-canonical-backfill.js';
import {
  backfillRemoteCodecResidueColumns,
  JS_TRIM_CHARS,
  recoverResidueCell,
  residueCandidateSql,
  type RemoteCodecResidueCodec,
  type RemoteCodecResidueKind,
} from './remote-codec-residue-backfill.js';

const OBJ = {
  name: 'res',
  fields: { d: { type: 'date' }, j: { type: 'json' }, att: { type: 'file' } },
};

/**
 * `date` inputs, the cell the pre-fix door stored, and the day the fixed door
 * stores for the same input.
 */
const DATE_CASES: Array<{ id: string; input: unknown; before: string; day: string }> = [
  { id: 'd_date', input: new Date('2025-07-28T00:00:00.000Z'), before: '2025-07-28T00:00:00.000Z', day: '2025-07-28' },
  // `new Date(2025, 6, 28)` in a UTC+8 process: local midnight, the previous
  // UTC day. The fixed door stores the UTC day too (`SqlDriver.toDateOnly` reads
  // a `Date` on the UTC clock), so `2025-07-27` is what it holds either way.
  { id: 'd_date_utc8_midnight', input: new Date('2025-07-27T16:00:00.000Z'), before: '2025-07-27T16:00:00.000Z', day: '2025-07-27' },
  { id: 'd_zulu', input: '2025-07-28T10:00:00Z', before: '2025-07-28T10:00:00Z', day: '2025-07-28' },
  // The leading day as written, not the UTC day (which would be 07-27).
  { id: 'd_plus', input: '2025-07-28T01:00:00+08:00', before: '2025-07-28T01:00:00+08:00', day: '2025-07-28' },
  // Likewise (the UTC day would be 07-29).
  { id: 'd_minus', input: '2025-07-28T23:30:00-05:00', before: '2025-07-28T23:30:00-05:00', day: '2025-07-28' },
  { id: 'd_naive_space', input: '2025-07-28 10:00:00', before: '2025-07-28 10:00:00', day: '2025-07-28' },
  { id: 'd_naive_t', input: '2025-07-28T10:00:00', before: '2025-07-28T10:00:00', day: '2025-07-28' },
  { id: 'd_lead_space', input: ' 2025-07-28T10:00:00Z', before: ' 2025-07-28T10:00:00Z', day: '2025-07-28' },
  { id: 'd_trail_space', input: '2025-07-28 ', before: '2025-07-28 ', day: '2025-07-28' },
];

/** `date` cells that are already what the fixed door stores. */
const DATE_UNTOUCHED: Array<{ id: string; input: unknown; stored: string }> = [
  { id: 'd_bare', input: '2025-07-28', stored: '2025-07-28' },
  // A number is stored the same by both doors (`toDateOnly` passes it through).
  { id: 'd_epoch', input: 1753660800000, stored: '1753660800000.0' },
  { id: 'd_text', input: 'not a date', stored: 'not a date' },
];

/** json strings the pre-fix door stored bare that do not parse. */
const JSON_RECOVERABLE: Array<{ id: string; input: string; after: string }> = [
  { id: 'j_hello', input: 'hello', after: '"hello"' },
  { id: 'j_empty', input: '', after: '""' },
];

/**
 * json cells whose original value cannot be told from their bytes, and the
 * bytes they must keep. `door` rows are written through the pre-fix door over
 * the double. `wire` rows are inserted raw in the shape the Turso wire gives
 * the same write: `@libsql/client`'s hrana encoder sends a boolean as INTEGER
 * (TEXT affinity stores `1`), where the double's better-sqlite3 binds it REAL
 * (`1.0`). Either way the bytes collide with another writer.
 */
const JSON_AMBIGUOUS: Array<{ id: string; door?: unknown; wire?: string; stored: string }> = [
  { id: 'j_true', door: true, stored: '1.0' }, //  the number 1 through the same door
  { id: 'j_false', door: false, stored: '0.0' },
  { id: 'j_true_wire', wire: '1', stored: '1' }, // the string '1', and the fixed door's number 1
  { id: 'j_false_wire', wire: '0', stored: '0' },
  { id: 'j_one', door: 1, stored: '1.0' }, //      the string '1.0'
  { id: 'j_42', door: 42, stored: '42.0' },
  { id: 'j_str42', door: '42', stored: '42' }, //  the fixed door's number 42
  { id: 'j_strtrue', door: 'true', stored: 'true' }, // the fixed door's boolean true
  { id: 'j_strobj', door: '{"a":1}', stored: '{"a":1}' }, // an object through either door
  { id: 'j_padded', door: ' 42', stored: ' 42' }, // parses; left as it reads
  { id: 'j_object', door: { a: 1 }, stored: '{"a":1}' },
  { id: 'j_array', door: [1, 'x'], stored: '[1,"x"]' },
];

type PreFixTransport = { syncSchemasBatch(s: Array<{ object: string; schema: unknown }>): Promise<void> };

/** Create the table and write rows exactly as the pre-#19844 batch door did. */
async function writeThroughPreFixDoor(stub: LibsqlSqliteStub, rows: Array<Record<string, unknown>>) {
  const driver = new TursoDriver({ url: 'libsql://pre-fix.turso.io', client: asLibsqlClient(stub) });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  const transport = (driver as unknown as { remoteTransport: PreFixTransport }).remoteTransport;
  await transport.syncSchemasBatch([{ object: 'res', schema: OBJ }]);
  for (const row of rows) await driver.create('res', row);
  // Not disconnected: that closes the supplied client, i.e. the shared double.
}

/** Boot the fixed driver the way the engine does: through `syncSchemasBatch`. */
async function bootFixed(stub: LibsqlSqliteStub | RemoteBackfillClient) {
  const driver = new TursoDriver({ url: 'libsql://fixed.turso.io', client: stub as never });
  await driver.connect();
  await driver.syncSchemasBatch([{ object: 'res', schema: OBJ }]);
  return driver;
}

type Cell = { td: string; d: unknown; tj: string; j: unknown; att: unknown };
const cells = (stub: LibsqlSqliteStub): Record<string, Cell> =>
  Object.fromEntries(
    (stub.raw
      .prepare(`select id, typeof(d) as td, d, typeof(j) as tj, j, att from res order by id`)
      .all() as Array<Cell & { id: string }>).map(({ id, ...rest }) => [id, rest]),
  );

const idsWhere = async (driver: TursoDriver, where: Record<string, unknown>) =>
  ((await driver.find('res', { where })) as Array<{ id: string }>).map((r) => r.id).sort();

/** Every residue class in one table. */
async function seedAll(stub: LibsqlSqliteStub) {
  await writeThroughPreFixDoor(stub, [
    ...DATE_CASES.map(({ id, input }) => ({ id, d: input })),
    ...DATE_UNTOUCHED.map(({ id, input }) => ({ id, d: input })),
    ...JSON_RECOVERABLE.map(({ id, input }) => ({ id, j: input })),
    ...JSON_AMBIGUOUS.filter((c) => c.wire === undefined).map(({ id, door }) => ({ id, j: door })),
    { id: 'j_null', j: null },
    { id: 'm_bare_id', att: 'file_01HXYZ' },
  ]);
  for (const c of JSON_AMBIGUOUS.filter((x) => x.wire !== undefined)) {
    stub.raw.prepare(`insert into res (id, j) values (?, ?)`).run(c.id, c.wire);
  }
}

/** Record every statement a client is handed. */
function recording(stub: LibsqlSqliteStub) {
  const statements: string[] = [];
  const sqlOf = (s: unknown) => (typeof s === 'string' ? s : String((s as { sql: string }).sql));
  const client = {
    statements,
    raw: stub.raw,
    async execute(stmt: unknown) {
      statements.push(sqlOf(stmt));
      return stub.execute(stmt);
    },
    async batch(stmts: unknown[]) {
      for (const s of stmts) statements.push(sqlOf(s));
      return stub.batch(stmts);
    },
    close: () => stub.close(),
  };
  return client;
}

const codecOf = (driver: TursoDriver): RemoteCodecResidueCodec => ({
  toDateOnly: (value) => (driver as unknown as { toDateOnly(v: unknown): unknown }).toDateOnly(value),
});

describe('#19868 — the before-state the pre-fix batch door leaves', () => {
  it('stores a date as the full timestamp and a json string bare', async () => {
    const stub = makeLibsqlSqliteStub();
    await seedAll(stub);
    const disk = cells(stub);

    for (const c of DATE_CASES) expect(disk[c.id], c.id).toMatchObject({ td: 'text', d: c.before });
    for (const c of JSON_RECOVERABLE) expect(disk[c.id], c.id).toMatchObject({ tj: 'text', j: c.input });
    for (const c of JSON_AMBIGUOUS) expect(disk[c.id], c.id).toMatchObject({ tj: 'text', j: c.stored });
    expect(disk.m_bare_id.att).toBe('file_01HXYZ');

    // And the defect the card names: the fixed READ path, over these cells,
    // answers the day, but a filter on that day compares it with the full text.
    const plain = new TursoDriver({ url: 'libsql://fixed.turso.io', client: asLibsqlClient(stub) });
    await plain.connect();
    const transport = (plain as unknown as { remoteTransport: PreFixTransport }).remoteTransport;
    await transport.syncSchemasBatch([{ object: 'res', schema: OBJ }]);
    (plain as unknown as { registerRemoteFieldMetadata(o: unknown): void }).registerRemoteFieldMetadata(OBJ);
    const row = await plain.findOne('res', { where: { id: 'd_zulu' } });
    expect(row?.d).toBe('2025-07-28');
    expect(await idsWhere(plain, { d: '2025-07-28' })).toEqual(['d_bare']);
    await plain.disconnect();
    stub.close();
  });
});

describe('#19868 — a fixed boot converges the recoverable cells', () => {
  it('rewrites each full-timestamp date to its calendar day, and the day filter matches it', async () => {
    const stub = makeLibsqlSqliteStub();
    await seedAll(stub);
    const driver = await bootFixed(stub);
    const disk = cells(stub);

    for (const c of DATE_CASES) {
      expect(disk[c.id], c.id).toMatchObject({ td: 'text', d: c.day });
      const row = await driver.findOne('res', { where: { id: c.id } });
      expect(row?.d, c.id).toBe(c.day);
    }
    expect(await idsWhere(driver, { d: '2025-07-28' })).toEqual(
      ['d_bare', ...DATE_CASES.filter((c) => c.day === '2025-07-28').map((c) => c.id)].sort(),
    );
    expect(await idsWhere(driver, { d: '2025-07-27' })).toEqual(['d_date_utc8_midnight']);
    // A bare-day upper bound now includes that day's rows.
    expect(await idsWhere(driver, { d: { $lte: '2025-07-28' } })).toContain('d_minus');

    await driver.disconnect();
    stub.close();
  });

  it('re-encodes a json string that does not parse, and it reads back the same string', async () => {
    const stub = makeLibsqlSqliteStub();
    await seedAll(stub);
    const driver = await bootFixed(stub);
    const disk = cells(stub);

    for (const c of JSON_RECOVERABLE) {
      expect(disk[c.id], c.id).toMatchObject({ tj: 'text', j: c.after });
      const row = await driver.findOne('res', { where: { id: c.id } });
      expect(row?.j, c.id).toBe(c.input);
    }

    await driver.disconnect();
    stub.close();
  });

  it('changes no read: every row reads back after the backfill what it read before it', async () => {
    const stub = makeLibsqlSqliteStub();
    await seedAll(stub);
    const before = stub.raw.prepare(`select * from res order by id`).all() as Array<Record<string, unknown>>;

    const driver = await bootFixed(stub);
    // The fixed driver's own read coercion, applied to the rows as they were.
    const readBefore = before.map((row) =>
      (driver as unknown as { formatOutput(o: string, r: unknown): unknown }).formatOutput('res', { ...row }),
    );
    const readAfter = await driver.find('res', { orderBy: [{ field: 'id', order: 'asc' }] });

    // Non-vacuous: the disk DID change underneath.
    expect(stub.raw.prepare(`select * from res order by id`).all()).not.toEqual(before);
    const strip = (rows: unknown[]) =>
      (rows as Array<Record<string, unknown>>).map(({ id, d, j, att }) => ({ id, d, j, att }));
    expect(strip(readAfter)).toEqual(strip(readBefore));

    await driver.disconnect();
    stub.close();
  });
});

describe('#19868 — cells the backfill leaves exactly as stored', () => {
  it('every ambiguous json cell, the dates already canonical, and a null', async () => {
    const stub = makeLibsqlSqliteStub();
    await seedAll(stub);
    const driver = await bootFixed(stub);
    const disk = cells(stub);

    for (const c of JSON_AMBIGUOUS) expect(disk[c.id], c.id).toMatchObject({ tj: 'text', j: c.stored });
    for (const c of DATE_UNTOUCHED) expect(disk[c.id], c.id).toMatchObject({ d: c.stored });
    expect(disk.j_null).toMatchObject({ tj: 'null', j: null });
    // Still the known wrong read for the ambiguous bytes: a stored `true` reads 1.
    const row = await driver.findOne('res', { where: { id: 'j_true_wire' } });
    expect(row?.j).toBe(1);

    await driver.disconnect();
    stub.close();
  });

  it('a single-value media column: its canonical id form is a deployment fact', async () => {
    const stub = makeLibsqlSqliteStub();
    await seedAll(stub);
    const driver = await bootFixed(stub);

    expect(cells(stub).m_bare_id.att).toBe('file_01HXYZ');
    const row = await driver.findOne('res', { where: { id: 'm_bare_id' } });
    expect(row?.att).toBe('file_01HXYZ');

    await driver.disconnect();
    stub.close();
  });

  it('JSON nested past SQLite\'s json_valid() depth: the codec, not SQLite, decides', async () => {
    const stub = makeLibsqlSqliteStub();
    await writeThroughPreFixDoor(stub, []);
    let deep: unknown = 1;
    for (let i = 0; i < 1001; i++) deep = [deep];
    const text = JSON.stringify(deep);
    stub.raw.prepare(`insert into res (id, j) values ('deep', ?)`).run(text);
    // The disagreement itself, measured on this SQLite: it rejects what JSON.parse reads.
    expect(stub.raw.prepare(`select json_valid(j) as v from res`).all()).toEqual([{ v: 0 }]);

    const driver = await bootFixed(stub);

    expect(cells(stub).deep.j).toBe(text);
    const row = await driver.findOne('res', { where: { id: 'deep' } });
    expect(Array.isArray(row?.j)).toBe(true);

    await driver.disconnect();
    stub.close();
  });
});

describe('#19868 — idempotent, and quiet when it cannot run', () => {
  it('a second boot writes nothing, and a second sync in one process does not even probe', async () => {
    const stub = makeLibsqlSqliteStub();
    await seedAll(stub);
    await bootFixed(stub); // the first boot, left connected: disconnecting closes the double
    const converged = cells(stub);

    const client = recording(stub);
    const second = await bootFixed(client as unknown as RemoteBackfillClient);
    expect(cells(stub)).toEqual(converged);
    expect(client.statements.filter((s) => /^\s*update\b/i.test(s))).toEqual([]);
    // The residue probe ran once, as one statement for the table.
    expect(client.statements.filter((s) => s.includes('json_valid('))).toHaveLength(1);

    client.statements.length = 0;
    await second.syncSchemasBatch([{ object: 'res', schema: OBJ }]);
    expect(client.statements.filter((s) => s.includes('json_valid('))).toEqual([]);

    await second.disconnect();
    stub.close();
  });

  it('a probe that fails leaves the boot up, the cells as they were, and the columns unmarked', async () => {
    const stub = makeLibsqlSqliteStub();
    await seedAll(stub);
    const before = cells(stub);
    const failing = {
      ...stub,
      async execute(stmt: unknown) {
        if (String((stmt as { sql?: string }).sql ?? stmt).includes('json_valid(')) throw new Error('injected');
        return stub.execute(stmt);
      },
      async batch(stmts: unknown[]) {
        if (stmts.some((s) => String((s as { sql?: string }).sql ?? s).includes('json_valid('))) {
          throw new Error('injected');
        }
        return stub.batch(stmts);
      },
    };

    const driver = await bootFixed(failing as unknown as RemoteBackfillClient);
    expect(cells(stub)).toEqual(before);
    const marks = (driver as unknown as { remoteCodecResidueConverged: Record<string, Set<string>> })
      .remoteCodecResidueConverged;
    expect(marks.res?.size ?? 0).toBe(0);

    await driver.disconnect();
    stub.close();
  });
});

describe('#19868 — the module: paging, budget, resume, compare-and-set', () => {
  const COLUMN = { table: 'res', field: 'd', kind: 'date' as const };

  async function seededDates(n: number) {
    const stub = makeLibsqlSqliteStub();
    await writeThroughPreFixDoor(
      stub,
      Array.from({ length: n }, (_, i) => ({ id: `r${i}`, d: `2025-07-${String(10 + i).padStart(2, '0')}T10:00:00Z` })),
    );
    const driver = new TursoDriver({ url: 'libsql://m.turso.io', client: asLibsqlClient(stub) });
    return { stub, codec: codecOf(driver) };
  }

  it('stops on its batch budget unmarked, and the next run resumes where it stopped', async () => {
    const { stub, codec } = await seededDates(5);
    const client = stub as unknown as RemoteBackfillClient;
    const opts = { batchSize: 2, maxBatches: 1 };

    const first = await backfillRemoteCodecResidueColumns(client, [COLUMN], codec, opts);
    expect(first.columns[0]).toMatchObject({ rowsConverted: 2, budgetExhausted: true, done: false });
    const second = await backfillRemoteCodecResidueColumns(client, [COLUMN], codec, opts);
    expect(second.columns[0]).toMatchObject({ rowsConverted: 2, budgetExhausted: true, done: false });
    const third = await backfillRemoteCodecResidueColumns(client, [COLUMN], codec, opts);
    expect(third.columns[0]).toMatchObject({ rowsConverted: 1, budgetExhausted: false, done: true });

    expect(stub.raw.prepare(`select d from res order by id`).all()).toEqual(
      Array.from({ length: 5 }, (_, i) => ({ d: `2025-07-${String(10 + i).padStart(2, '0')}` })),
    );
    stub.close();
  });

  it('leaves a row that was rewritten between the page read and the write', async () => {
    const { stub, codec } = await seededDates(2);
    const racing = {
      execute: (stmt: unknown) => stub.execute(stmt),
      async batch(stmts: unknown[], mode?: string) {
        // Another writer lands on r0 after the page was read.
        if (mode === 'write') stub.raw.prepare(`update res set d = '2030-01-01' where id = 'r0'`).run();
        return stub.batch(stmts);
      },
    } as unknown as RemoteBackfillClient;

    const report = await backfillRemoteCodecResidueColumns(racing, [COLUMN], codec);
    expect(report.columns[0]).toMatchObject({ rowsConverted: 1, done: true });
    expect(stub.raw.prepare(`select id, d from res order by id`).all()).toEqual([
      { id: 'r0', d: '2030-01-01' },
      { id: 'r1', d: '2025-07-11' },
    ]);
    stub.close();
  });
});

describe('#19868 — the SQL pre-filter selects what the codec rewrites', () => {
  it('JS_TRIM_CHARS is exactly the set String.prototype.trim removes', () => {
    const trimmed: string[] = [];
    for (let code = 0; code <= 0xffff; code++) {
      const ch = String.fromCharCode(code);
      if (`${ch}x${ch}`.trim() === 'x') trimmed.push(ch);
    }
    expect(trimmed.join('')).toBe(JS_TRIM_CHARS);
  });

  const agreement = (kind: RemoteCodecResidueKind, texts: string[]) => {
    const stub = makeLibsqlSqliteStub();
    const codec = codecOf(new TursoDriver({ url: 'libsql://m.turso.io', client: asLibsqlClient(stub) }));
    const candidate = residueCandidateSql(kind, 'v');
    const rows = texts.map((text) => {
      const [{ c }] = stub.raw
        .prepare(`select case when ${candidate.sql} then 1 else 0 end as c from (select ? as v)`)
        .all(...candidate.args, text) as Array<{ c: number }>;
      return { text, sql: c === 1, codec: recoverResidueCell(kind, text, codec) !== null };
    });
    stub.close();
    return rows;
  };

  it('date: the pre-filter and toDateOnly select the same cells', () => {
    const texts = [
      '2025-07-28', '2025-07-28T10:00:00Z', '2025-07-28 ', ' 2025-07-28', '2025-07-2', '2025-7-28T1',
      'x2025-07-28T10', '20250728T100000', '1753660800000.0', '', 'not a date', '２０２５-07-28T10',
      ...[...JS_TRIM_CHARS].flatMap((ch) => [`${ch}2025-07-28`, `2025-07-28${ch}`, `${ch}${ch}2025-07-28T1`]),
    ];
    const rows = agreement('date', texts);
    expect(rows.filter((r) => r.sql !== r.codec)).toEqual([]);
    expect(rows.filter((r) => r.codec).length).toBeGreaterThan(3 * JS_TRIM_CHARS.length);
  });

  it('json: the pre-filter is a superset, and the only extra is what json_valid() rejects and JSON.parse reads', () => {
    let deep = '1';
    for (let i = 0; i < 1001; i++) deep = `[${deep}]`;
    const texts = ['hello', '', '42', ' 42', '42.0', 'true', 'null', '{"a":1}', 'Infinity', "'x'", '{a:1}', deep];
    const rows = agreement('json', texts);
    expect(rows.filter((r) => r.codec && !r.sql)).toEqual([]);
    expect(rows.filter((r) => r.sql && !r.codec).map((r) => r.text)).toEqual([deep]);
    expect(rows.filter((r) => r.codec).map((r) => r.text)).toEqual(['hello', '', 'Infinity', "'x'", '{a:1}']);
  });
});
