// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17609] ONE `TursoDriver`, ONE index set — an object's declared
 * `indexes: [...]` materialized on BOTH faces and read back off
 * `sqlite_master`, the two readings held against each other.
 *
 * # What was broken
 *
 * Remote mode (`libsql://`) provisions tables through
 * `RemoteTransport.syncSchemasBatch`, and every index DDL that file could emit
 * came from field-level `unique` alone. An object's declared `indexes` —
 * unique or not — had no consumer on that path, so on every remote tenant
 * database the hot tables carried only their primary-key autoindex:
 * `sys_notification_delivery` declares five indexes and had none, and its
 * claim query full-scanned the table on every dispatcher tick. The local face
 * (`SqlDriver.syncDeclaredIndexes`) created all of them, so no local suite
 * could see it; the loss surfaced as row-read volume, not as a failure.
 *
 * # Why a parity file
 *
 * The same lesson `turso-local-remote-unique-parity.test.ts` records: a
 * per-face suite cannot fail on the DIFFERENCE between faces, and the
 * difference is the defect. So each pin here drives one object set through
 * BOTH faces and compares what physically landed — index names, uniqueness,
 * origin and key parts (NULL-safe organization expressions included) — rather
 * than asserting either face against a literal. Each parity pin is ANCHORED
 * by names computed through the shared `buildIndexName`, because two faces
 * that both lost every index would agree perfectly.
 *
 * The remote face here is the real `@libsql/client` over `file::memory:`,
 * not the better-sqlite3 stub: a libsql `write` batch is transactional, and
 * the retrofit's failure disposition depends on exactly that semantic.
 *
 * # The fixtures
 *
 * `sys_notification_delivery` and `sys_job_queue` are the two tables the card
 * measured on production, reproduced here as SHAPES — their fields and their
 * `indexes` verbatim — because this package does not (and should not) depend
 * on `service-messaging` or `platform-objects`. `os17609_scoped` covers what
 * those two do not: a tenant column, a field-level `unique` scoped by it, a
 * declared `unique: 'organization'` (NULL-safe key part), an explicit
 * `unique: 'global'`, two author-named indexes — one of them no SQL
 * identifier at all (a space and a double quote), which both faces must
 * accept — and an index over a virtual `formula` field that neither face may
 * materialize.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createClient, type Client, type InStatement } from '@libsql/client';
import { Field } from '@objectstack/spec/data';
import { buildIndexName } from '@objectstack/driver-sql';
import { TursoDriver } from './turso-driver.js';

type ObjectDef = {
  name: string;
  fields: Record<string, any>;
  indexes?: Array<{ name?: string; fields: string[]; unique?: boolean | 'global' | 'organization' }>;
};

const DELIVERY: ObjectDef = {
  name: 'sys_notification_delivery',
  fields: {
    id: Field.text({ label: 'Delivery ID', required: true, readonly: true }),
    notification_id: Field.text({ label: 'Notification Event', required: true, maxLength: 255 }),
    recipient_id: Field.text({ label: 'Recipient User', required: true, maxLength: 255 }),
    channel: Field.text({ label: 'Channel', required: true, maxLength: 64 }),
    topic: Field.text({ label: 'Topic' }),
    digest_key: Field.text({ label: 'Digest Key', maxLength: 331 }),
    payload: Field.json({ label: 'Payload' }),
    status: Field.select(['pending', 'in_flight', 'success', 'failed', 'dead', 'suppressed'], {
      label: 'Status',
      required: true,
      defaultValue: 'pending',
    }),
    attempts: Field.number({ label: 'Attempts', defaultValue: 0 }),
    partition_key: Field.number({ label: 'Partition Key', defaultValue: 0 }),
    claimed_by: Field.text({ label: 'Claimed By' }),
    claimed_at: Field.number({ label: 'Claimed At (ms)' }),
    next_attempt_at: Field.number({ label: 'Next Attempt At (ms)' }),
    last_attempted_at: Field.number({ label: 'Last Attempted At (ms)' }),
    error: Field.textarea({ label: 'Error' }),
    created_at: Field.datetime({ label: 'Created At', readonly: true }),
    updated_at: Field.datetime({ label: 'Updated At' }),
  },
  indexes: [
    { fields: ['notification_id', 'recipient_id', 'channel'], unique: true },
    { fields: ['status', 'partition_key', 'next_attempt_at'] },
    { fields: ['status', 'claimed_at'] },
    { fields: ['notification_id'] },
    { fields: ['digest_key', 'status', 'next_attempt_at'] },
  ],
};

const JOB_QUEUE: ObjectDef = {
  name: 'sys_job_queue',
  fields: {
    id: Field.text({ label: 'Message ID', required: true, readonly: true }),
    queue: Field.text({ label: 'Queue', required: true, maxLength: 255 }),
    idempotency_key: Field.text({ label: 'Idempotency Key', required: false, maxLength: 255 }),
    payload_json: Field.textarea({ label: 'Payload (JSON)', required: false }),
    metadata_json: Field.textarea({ label: 'Metadata (JSON)', required: false }),
    status: Field.select(['pending', 'running', 'completed', 'failed', 'dlq'], {
      label: 'Status',
      required: true,
      defaultValue: 'pending',
    }),
    priority: Field.number({ label: 'Priority', required: false, defaultValue: 100 }),
    attempts: Field.number({ label: 'Attempts', required: false, defaultValue: 0 }),
    max_attempts: Field.number({ label: 'Max Attempts', required: false, defaultValue: 3 }),
    backoff_type: Field.select(['fixed', 'exponential'], {
      label: 'Backoff',
      required: false,
      defaultValue: 'exponential',
    }),
    backoff_delay_ms: Field.number({ label: 'Backoff Base (ms)', required: false, defaultValue: 1000 }),
    backoff_max_delay_ms: Field.number({ label: 'Backoff Cap (ms)', required: false }),
    scheduled_for: Field.datetime({ label: 'Scheduled For', required: false }),
    locked_by: Field.text({ label: 'Locked By', required: false, maxLength: 255 }),
    locked_until: Field.datetime({ label: 'Locked Until', required: false }),
    last_error: Field.textarea({ label: 'Last Error', required: false }),
    completed_at: Field.datetime({ label: 'Completed At', required: false }),
    created_at: Field.datetime({ label: 'Created At', required: true, readonly: true }),
    updated_at: Field.datetime({ label: 'Updated At', required: false }),
  },
  indexes: [
    { fields: ['queue', 'status', 'scheduled_for'] },
    { fields: ['idempotency_key', 'queue'] },
    { fields: ['status'] },
  ],
};

const SCOPED: ObjectDef = {
  name: 'os17609_scoped',
  fields: {
    organization_id: { type: 'text', maxLength: 64 },
    code: { type: 'text', maxLength: 64, unique: true },
    slug: { type: 'text', maxLength: 64 },
    external_id: { type: 'text', maxLength: 64 },
    region: { type: 'text', maxLength: 64 },
    total: { type: 'formula', expression: 'region' },
  },
  indexes: [
    { fields: ['slug'], unique: 'organization' },
    { fields: ['external_id'], unique: 'global' },
    { fields: ['region', 'slug'] },
    { name: 'os17609_scoped_by_region', fields: ['region'] },
    { name: 'os17609 scoped-by "slug"', fields: ['slug'] },
    { fields: ['total'] },
  ],
};

const OBJECTS = [DELIVERY, JOB_QUEUE, SCOPED];

/** The card's claim query, verbatim. */
const CLAIM_SQL =
  `SELECT id FROM sys_notification_delivery WHERE status = 'pending' AND partition_key = ? ` +
  `AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 50`;

/** The index names each fixture must carry — through the SHARED namer, never a second spelling. */
const EXPECTED_NAMES: Record<string, string[]> = {
  [DELIVERY.name]: [
    buildIndexName(DELIVERY.name, ['notification_id', 'recipient_id', 'channel'], true),
    buildIndexName(DELIVERY.name, ['status', 'partition_key', 'next_attempt_at'], false),
    buildIndexName(DELIVERY.name, ['status', 'claimed_at'], false),
    buildIndexName(DELIVERY.name, ['notification_id'], false),
    buildIndexName(DELIVERY.name, ['digest_key', 'status', 'next_attempt_at'], false),
    `sqlite_autoindex_${DELIVERY.name}_1`,
  ].sort(),
  [JOB_QUEUE.name]: [
    buildIndexName(JOB_QUEUE.name, ['queue', 'status', 'scheduled_for'], false),
    buildIndexName(JOB_QUEUE.name, ['idempotency_key', 'queue'], false),
    buildIndexName(JOB_QUEUE.name, ['status'], false),
    `sqlite_autoindex_${JOB_QUEUE.name}_1`,
  ].sort(),
  [SCOPED.name]: [
    buildIndexName(SCOPED.name, ['organization_id', 'code'], true),
    buildIndexName(SCOPED.name, ['organization_id', 'slug'], true),
    buildIndexName(SCOPED.name, ['external_id'], true),
    buildIndexName(SCOPED.name, ['region', 'slug'], false),
    'os17609_scoped_by_region',
    'os17609 scoped-by "slug"',
    `sqlite_autoindex_${SCOPED.name}_1`,
  ].sort(),
};

const CLAIM_INDEX = buildIndexName(DELIVERY.name, ['status', 'partition_key', 'next_attempt_at'], false);
const DEDUP_INDEX = buildIndexName(DELIVERY.name, ['notification_id', 'recipient_id', 'channel'], true);

/** A fresh copy per sync — neither face may see a definition the other one mutated. */
const fresh = (o: ObjectDef): ObjectDef => ({
  ...o,
  fields: Object.fromEntries(Object.entries(o.fields).map(([k, v]) => [k, { ...v }])),
  ...(o.indexes ? { indexes: o.indexes.map((i) => ({ ...i, fields: [...i.fields] })) } : {}),
});

/** The same object as the pre-fix remote face provisioned it: no object-level indexes. */
const withoutDeclaredIndexes = (o: ObjectDef): ObjectDef => {
  const { indexes: _dropped, ...rest } = fresh(o);
  return rest;
};

type Row = Record<string, unknown>;

/** A SQL identifier, quoted — the fixture carries an index name that is not a bare identifier. */
const quoteIdent = (id: string) => `"${id.replace(/"/g, '""')}"`;
type Query = (sql: string, args?: unknown[]) => Promise<Row[]>;

interface IndexShape {
  name: string;
  unique: boolean;
  partial: boolean;
  origin: string;
  /** Key parts in order; an expression part is its normalized COALESCE text. */
  keys: string[];
}

/**
 * What physically landed for one table, read the same way off either face:
 * `PRAGMA index_list` for name / uniqueness / origin / partiality,
 * `PRAGMA index_xinfo` for the key columns, and the stored `CREATE` text for
 * expression parts (whose column name `index_xinfo` reports as NULL).
 */
async function indexShapes(query: Query, table: string): Promise<IndexShape[]> {
  const out: IndexShape[] = [];
  for (const row of await query(`PRAGMA index_list("${table}")`)) {
    const name = String(row.name);
    const [master] = await query(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`, [name]);
    const expressions = [
      ...String(master?.sql ?? '').matchAll(/COALESCE\(\s*[`"]?(\w+)[`"]?\s*,\s*'([^']*)'\s*\)/gi),
    ].map((m) => `COALESCE(${m[1]}, '${m[2]}')`);
    const keys = (await query(`PRAGMA index_xinfo(${quoteIdent(name)})`))
      .filter((k) => Number(k.key) === 1)
      .sort((a, b) => Number(a.seqno) - Number(b.seqno))
      .map((k) => (Number(k.cid) === -2 ? (expressions.shift() ?? '<expression>') : String(k.name)));
    out.push({
      name,
      unique: Number(row.unique) === 1,
      partial: Number(row.partial) === 1,
      origin: String(row.origin),
      keys,
    });
  }
  // Code-unit order, the same order `EXPECTED_NAMES`' `.sort()` uses.
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const indexNames = async (query: Query, table: string) => (await indexShapes(query, table)).map((i) => i.name);

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function localFace(): Promise<{ driver: TursoDriver; query: Query }> {
  const driver = new TursoDriver({ url: ':memory:' });
  await driver.connect();
  expect(driver.transportMode).toBe('local');
  cleanups.push(() => driver.disconnect());
  return { driver, query: async (sql, args) => (await driver.execute(sql, args ?? [])) as Row[] };
}

async function remoteFace(client: Client = createClient({ url: 'file::memory:' })): Promise<{
  driver: TursoDriver;
  query: Query;
}> {
  const driver = new TursoDriver({ url: 'libsql://declared-index-parity.turso.io', client });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  cleanups.push(() => driver.disconnect());
  return {
    driver,
    query: async (sql, args) => (await client.execute({ sql, args: (args ?? []) as any[] })).rows as unknown as Row[],
  };
}

/** Every statement the driver hands the client, in order, with the call that carried it. */
function countingClient(inner: Client): { client: Client; calls: Array<{ via: 'execute' | 'batch'; sql: string[] }> } {
  const calls: Array<{ via: 'execute' | 'batch'; sql: string[] }> = [];
  const sqlOf = (s: InStatement) => (typeof s === 'string' ? s : s.sql);
  const client = new Proxy(inner, {
    get(target, prop) {
      if (prop === 'execute') {
        return (stmt: InStatement, ...rest: unknown[]) => {
          calls.push({ via: 'execute', sql: [sqlOf(stmt)] });
          return (target.execute as (...a: unknown[]) => unknown).call(target, stmt, ...rest);
        };
      }
      if (prop === 'batch') {
        return (stmts: InStatement[], ...rest: unknown[]) => {
          calls.push({ via: 'batch', sql: stmts.map(sqlOf) });
          return (target.batch as (...a: unknown[]) => unknown).call(target, stmts, ...rest);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { client, calls };
}

const INDEX_DDL = /^\s*CREATE\s+(UNIQUE\s+)?INDEX\b/i;
const INDEX_NAME_READ = /FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'index'/i;

/** The durability channel (`logger.error`) and the diagnostic one (`logger.warn`), captured. */
function captureLogs(driver: TursoDriver) {
  const logger = (driver as unknown as { logger: { warn: (m: string) => void; error: (m: string) => void } }).logger;
  return {
    error: vi.spyOn(logger, 'error').mockImplementation(() => undefined),
    warn: vi.spyOn(logger, 'warn').mockImplementation(() => undefined),
  };
}

describe('[#17609] declared object-level indexes land identically on both TursoDriver faces', () => {
  it('a fresh database carries the same index set — names, uniqueness, origin and key parts', async () => {
    const local = await localFace();
    const remote = await remoteFace();

    await local.driver.initObjects(OBJECTS.map(fresh));
    await remote.driver.initObjects(OBJECTS.map(fresh));

    for (const { name } of OBJECTS) {
      const localShapes = await indexShapes(local.query, name);
      const remoteShapes = await indexShapes(remote.query, name);
      // Names first, for a readable diff; then the whole shape.
      expect(remoteShapes.map((i) => i.name), name).toEqual(localShapes.map((i) => i.name));
      expect(remoteShapes, name).toEqual(localShapes);
      // The anchor: agreement alone is satisfied by both faces losing them together.
      expect(localShapes.map((i) => i.name), name).toEqual(EXPECTED_NAMES[name]);
    }

    // The tenant key part is the NULL-safe expression on both faces, not the bare column.
    const scoped = await indexShapes(remote.query, SCOPED.name);
    expect(scoped.find((i) => i.name === buildIndexName(SCOPED.name, ['organization_id', 'slug'], true))).toEqual(
      expect.objectContaining({ unique: true, keys: ["COALESCE(organization_id, '__global__')", 'slug'] }),
    );
  });

  it('the single-object `syncSchema` path lands the same set as the batch path', async () => {
    const local = await localFace();
    const remote = await remoteFace();

    for (const o of OBJECTS) {
      await local.driver.initObjects([fresh(o)]);
      await remote.driver.syncSchema(o.name, fresh(o));
    }
    for (const { name } of OBJECTS) {
      expect(await indexShapes(remote.query, name), name).toEqual(await indexShapes(local.query, name));
    }
  });

  it('retrofits every declared index onto tables that already exist — and changes no row', async () => {
    const local = await localFace();
    const { client, calls } = countingClient(createClient({ url: 'file::memory:' }));
    const remote = await remoteFace(client);

    // The production state: tables the pre-fix remote face provisioned, holding rows.
    await remote.driver.initObjects(OBJECTS.map(withoutDeclaredIndexes));
    expect(await indexNames(remote.query, DELIVERY.name)).toEqual([`sqlite_autoindex_${DELIVERY.name}_1`]);
    expect(await indexNames(remote.query, JOB_QUEUE.name)).toEqual([`sqlite_autoindex_${JOB_QUEUE.name}_1`]);
    for (let i = 0; i < 3; i++) {
      await remote.driver.create(DELIVERY.name, {
        notification_id: `n${i}`,
        recipient_id: 'u1',
        channel: 'inbox',
        status: 'pending',
        partition_key: i,
        next_attempt_at: 1000 + i,
      });
      await remote.driver.create(JOB_QUEUE.name, { queue: 'q', status: 'pending', idempotency_key: `k${i}` });
    }
    const snapshot = async () => ({
      delivery: await remote.query(`SELECT * FROM "${DELIVERY.name}" ORDER BY id`),
      jobs: await remote.query(`SELECT * FROM "${JOB_QUEUE.name}" ORDER BY id`),
      changes: (await remote.query('SELECT total_changes() AS n'))[0].n,
    });
    const before = await snapshot();

    calls.length = 0;
    await remote.driver.initObjects(OBJECTS.map(fresh));
    const retrofitDdl = calls.flatMap((c) => c.sql).filter((s) => INDEX_DDL.test(s));

    // ⛔ Zero data change: the same rows, byte for byte, and no row-level write at all.
    expect(await snapshot()).toEqual(before);
    // `IF NOT EXISTS` on every retrofit statement — a concurrent boot creating the same index is a no-op.
    expect(retrofitDdl.length).toBeGreaterThan(0);
    for (const sql of retrofitDdl) expect(sql).toMatch(/\bINDEX IF NOT EXISTS\b/i);

    await local.driver.initObjects(OBJECTS.map(fresh));
    for (const { name } of OBJECTS) {
      expect(await indexShapes(remote.query, name), name).toEqual(await indexShapes(local.query, name));
      expect(await indexNames(remote.query, name), name).toEqual(EXPECTED_NAMES[name]);
    }
  });

  it('steady state costs zero index DDL — one index-name read, riding a round trip the sync already pays', async () => {
    const { client, calls } = countingClient(createClient({ url: 'file::memory:' }));
    const remote = await remoteFace(client);
    await remote.driver.initObjects(OBJECTS.map(fresh));

    // A whole kernel build's `initObjects`, once every index exists.
    calls.length = 0;
    await remote.driver.initObjects(OBJECTS.map(fresh));
    const boot = calls.flatMap((c) => c.sql);
    expect(boot.filter((s) => INDEX_DDL.test(s))).toEqual([]);

    // The DDL seam alone, measured exactly: N table probes (one batch) + N column
    // probes and ONE index-name read (one batch) — two round trips, 2N + 1 statements,
    // independent of how many indexes the objects declare.
    calls.length = 0;
    await remote.driver.syncSchemasBatch(OBJECTS.map((o) => ({ object: o.name, schema: fresh(o) })));
    const N = OBJECTS.length;
    expect(calls.map((c) => c.via)).toEqual(['batch', 'batch']);
    expect(calls.flatMap((c) => c.sql)).toHaveLength(2 * N + 1);
    expect(calls[1].sql.filter((s) => INDEX_NAME_READ.test(s))).toHaveLength(1);
    expect(calls[1].sql.filter((s) => /^PRAGMA table_info/i.test(s))).toHaveLength(N);
  });

  it('serves the delivery claim query from the declared index — the same plan on both faces', async () => {
    const local = await localFace();
    const remote = await remoteFace();
    await local.driver.initObjects([fresh(DELIVERY)]);
    await remote.driver.initObjects([fresh(DELIVERY)]);

    const plan = async (query: Query) =>
      (await query(`EXPLAIN QUERY PLAN ${CLAIM_SQL}`, [0, 0])).map((r) => String(r.detail)).join('\n');
    const remotePlan = await plan(remote.query);

    expect(remotePlan).toContain(
      `SEARCH sys_notification_delivery USING INDEX ${CLAIM_INDEX} (status=? AND partition_key=? AND next_attempt_at<?)`,
    );
    expect(remotePlan).not.toMatch(/SCAN sys_notification_delivery/);
    expect(remotePlan).toBe(await plan(local.query));
  });
});

describe('[#17609] a declared index the retrofit cannot create is reported at `error`, never forced', () => {
  it('an object-level UNIQUE over existing duplicates: not created, named on the durability channel, no row repaired', async () => {
    const remote = await remoteFace();
    await remote.driver.initObjects([withoutDeclaredIndexes(DELIVERY)]);
    // The duplicates a table with no dedup index accepted.
    for (const attempt of [1, 2]) {
      await remote.driver.create(DELIVERY.name, {
        notification_id: 'n1',
        recipient_id: 'u1',
        channel: 'email',
        status: 'pending',
        attempts: attempt,
      });
    }
    const logs = captureLogs(remote.driver);

    await expect(remote.driver.initObjects([fresh(DELIVERY)])).resolves.toBeUndefined();

    const names = await indexNames(remote.query, DELIVERY.name);
    // The unique index is absent — and the four plain ones DID land, although a libsql
    // `write` batch rolls back every statement beside the one that failed.
    expect(names).not.toContain(DEDUP_INDEX);
    expect(names).toEqual(EXPECTED_NAMES[DELIVERY.name].filter((n) => n !== DEDUP_INDEX));

    // Reported once, on the `error` channel, naming the index and carrying SQLite's own cause.
    const reports = logs.error.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(DEDUP_INDEX));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain(DELIVERY.name);
    expect(reports[0]).toMatch(/UNIQUE constraint failed/i);
    expect(logs.warn.mock.calls.some((c) => String(c[0]).includes(DEDUP_INDEX))).toBe(false);

    // ⛔ Nothing repaired: both duplicates are still there.
    expect((await remote.query(`SELECT COUNT(*) AS n FROM "${DELIVERY.name}"`))[0].n).toBe(2);
  });

  it('a PLAIN index the server refuses: named on the durability channel with its cause; the rest still land', async () => {
    const inner = createClient({ url: 'file::memory:' });
    const refused = (sql: string) => INDEX_DDL.test(sql) && sql.includes(`"${CLAIM_INDEX}"`);
    const refusal = () => Object.assign(new Error('SQLITE_FULL: database or disk is full'), { code: 'SQLITE_FULL' });
    const client = new Proxy(inner, {
      get(target, prop) {
        if (prop === 'execute') {
          return async (stmt: InStatement) => {
            if (refused(typeof stmt === 'string' ? stmt : stmt.sql)) throw refusal();
            return target.execute(stmt);
          };
        }
        if (prop === 'batch') {
          return async (stmts: InStatement[], mode?: 'write' | 'read' | 'deferred') => {
            if (stmts.some((s) => refused(typeof s === 'string' ? s : s.sql))) throw refusal();
            return target.batch(stmts, mode);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const remote = await remoteFace(client);
    await remote.driver.initObjects([withoutDeclaredIndexes(DELIVERY)]);
    const logs = captureLogs(remote.driver);

    await expect(remote.driver.initObjects([fresh(DELIVERY)])).resolves.toBeUndefined();

    const names = await indexNames(remote.query, DELIVERY.name);
    expect(names).not.toContain(CLAIM_INDEX);
    expect(names).toEqual(EXPECTED_NAMES[DELIVERY.name].filter((n) => n !== CLAIM_INDEX));

    const reports = logs.error.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(CLAIM_INDEX));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain(DELIVERY.name);
    expect(reports[0]).toContain('SQLITE_FULL');
  });
});
