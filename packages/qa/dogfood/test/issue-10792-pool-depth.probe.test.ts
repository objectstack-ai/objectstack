// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// MEASUREMENT PROBE for #10792 — POOL DEPTH, the direct variable. Not a pin.
//
// The full-route arm (issue-10792-driver-parity.probe.test.ts) boots the whole
// auth stack; it measures Postgres and sqlite-wasm cleanly, but the platform
// schema does NOT sync onto MySQL (unbounded string fields map to TEXT, which
// MySQL cannot index — a separate finding), so the MySQL full-route arm cannot
// boot. This probe closes the MySQL gap by measuring the ONE variable the card
// names — "does an open transaction starve the next request in the same
// process" — directly at the driver, on a trivial table this probe creates
// itself, so it runs on every dialect including MySQL.
//
// Mechanism reproduced: driver.beginTransaction() acquires and HOLDS one pooled
// connection (exactly what runSubjectErasureAtomically → engine.transaction
// does around the erasure handler). While it is held, a SECOND operation that
// needs a FRESH pooled connection is issued — a bare knex.raw (the pure pool
// question) and driver.find (the path the better-auth session re-read takes).
// SQLite's pool hands out max=1, so the second op starves; pg/mysql run roomy
// pools (max>=10), so it does not.
//
// PROBE_DIALECT = sqlite-wasm | sqlite-sql | postgres | mysql.
// Cap: PROBE_POOL_CAP_MS (default 20000).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { appendFileSync, writeFileSync } from 'node:fs';

const DIALECT = process.env.PROBE_DIALECT ?? 'sqlite-wasm';
const CAP = Number(process.env.PROBE_POOL_CAP_MS ?? 20_000);
const OUT = process.env.PROBE_OUT ?? `/tmp/probe-10792-pool-${DIALECT}.txt`;
const rec = (l: string) => { /* eslint-disable-next-line no-console */ console.log(l); try { appendFileSync(OUT, l + '\n'); } catch { /* best effort */ } };

const TABLE = 'probe10792_pool';

function makeDriver(): any {
  switch (DIALECT) {
    case 'sqlite-wasm': return new SqliteWasmDriver({ filename: ':memory:' } as any);
    case 'sqlite-sql': return new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    case 'postgres': return new SqlDriver({ client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL ?? 'postgres://postgres@127.0.0.1:5432/probe10792' } as any);
    case 'mysql': return new SqlDriver({ client: 'mysql2', connection: process.env.OS_TEST_MYSQL_URL ?? 'mysql://root:root@127.0.0.1:3306/probe10792' } as any);
    default: throw new Error(`unknown PROBE_DIALECT=${DIALECT}`);
  }
}

// Race a promise against a cap. Returns { ms, value | 'CAPPED' | 'THREW: ...' }.
async function timed<T>(label: string, p: Promise<T>, capMs: number): Promise<{ ms: number; outcome: string }> {
  const t0 = Date.now();
  const capped = Symbol('capped');
  const r = await Promise.race([p.then((v) => v).catch((e) => e as Error), new Promise<typeof capped>((res) => setTimeout(() => res(capped), capMs))]);
  const ms = Date.now() - t0;
  if (r === capped) return { ms, outcome: `CAPPED (still blocked at ${capMs}ms)` };
  if (r instanceof Error) return { ms, outcome: `THREW ${r.name}: ${(r.message || '').slice(0, 100)}` };
  return { ms, outcome: `OK (${Array.isArray(r) ? `${r.length} rows` : JSON.stringify(r).slice(0, 40)})` };
}

describe(`#10792 pool-depth probe — ${DIALECT}`, () => {
  let driver: any;
  let knex: any;

  beforeAll(async () => {
    try { writeFileSync(OUT, `===== #10792 POOL-DEPTH PROBE — ${DIALECT} =====\n`); } catch { /* best effort */ }
    driver = makeDriver();
    await driver.connect();
    knex = driver.knex; // protected, reached the same way the driver's own suites do
    // pool config — the direct variable the card names.
    try {
      const pool = knex?.client?.pool;
      rec(`pool config: max=${pool?.max} min=${pool?.min}  (numUsed=${pool?.numUsed?.()} numFree=${pool?.numFree?.()})`);
    } catch (e) { rec(`pool config: unreadable (${(e as any)?.message})`); }
    await knex.schema.dropTableIfExists(TABLE).catch(() => {});
    await knex.schema.createTable(TABLE, (t: any) => { t.string('id').primary(); t.string('title'); });
    await knex(TABLE).insert([{ id: 'p1', title: 'one' }, { id: 'p2', title: 'two' }]);
    rec('setup: table created, 2 rows inserted');
  }, 120_000);

  afterAll(async () => {
    try { await knex?.schema.dropTableIfExists(TABLE); } catch { /* best effort */ }
    try { await driver?.disconnect?.(); } catch { /* best effort */ }
    rec('===== END =====');
  });

  it('a second op while a transaction holds a connection', async () => {
    // Baseline (no transaction open): both fresh-connection ops are fast.
    const baseRaw = await timed('BASELINE knex.raw(select 1)', knex.raw('select 1'), CAP);
    rec(`BASELINE knex.raw(select 1)          ${String(baseRaw.ms).padStart(7)}ms  -> ${baseRaw.outcome}`);
    const baseFind = await timed('BASELINE driver.find', driver.find(TABLE, { where: {} }), CAP);
    rec(`BASELINE driver.find                 ${String(baseFind.ms).padStart(7)}ms  -> ${baseFind.outcome}`);

    // Open a transaction — holds one pooled connection, exactly as
    // engine.transaction() does around the erasure handler.
    const trx = await driver.beginTransaction();
    rec('--- transaction OPEN (holds one pooled connection) ---');
    try {
      // The pure pool question: can the pool hand out a SECOND connection now?
      const rawDuring = await timed('DURING-TXN knex.raw(select 1)', knex.raw('select 1'), CAP);
      rec(`DURING-TXN knex.raw(select 1)        ${String(rawDuring.ms).padStart(7)}ms  -> ${rawDuring.outcome}`);
      // The path the better-auth session re-read takes: driver.find on a fresh
      // pooled connection (not bound to trx).
      const findDuring = await timed('DURING-TXN driver.find', driver.find(TABLE, { where: {} }), CAP);
      rec(`DURING-TXN driver.find               ${String(findDuring.ms).padStart(7)}ms  -> ${findDuring.outcome}`);
      // A query BOUND to the transaction always works (the connection it holds).
      const boundOk = await timed('DURING-TXN trx.raw (bound)', (trx as any).raw('select 1'), CAP);
      rec(`DURING-TXN trx.raw (bound, control)  ${String(boundOk.ms).padStart(7)}ms  -> ${boundOk.outcome}`);
    } finally {
      try { await driver.rollback(trx); } catch (e) { rec(`rollback threw: ${(e as any)?.message}`); }
      rec('--- transaction ROLLED BACK ---');
    }
    // After rollback the pool is free again — a fresh op is fast once more.
    const afterRaw = await timed('AFTER-TXN knex.raw(select 1)', knex.raw('select 1'), CAP);
    rec(`AFTER-TXN knex.raw(select 1)         ${String(afterRaw.ms).padStart(7)}ms  -> ${afterRaw.outcome}`);
    expect(true).toBe(true);
  }, 120_000);
});
