// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The three PRIVILEGED driver-level read verbs — `resolveSecret`,
// `resolveSecretField`, `resolveInternalField` — must JOIN the open ambient
// transaction (ADR-0034) instead of asking the pool for a second connection.
//
// Why this is a security guard and not a performance one. Each of the three
// reads at DRIVER level on purpose, because that is the only layer where the
// masked/omitted value still exists; that bypasses hooks, field-level security
// and sharing BY DESIGN. What it must not also bypass is the connection the
// surrounding transaction is holding. Until this guard they passed the driver
// NO options at all, so the read went to a FRESH pooled connection — invisible
// on a roomy pool, a DEADLOCK on a single-connection one.
//
// Measured shape of that deadlock, on the erasure path
// (`runSubjectErasureAtomically` wraps better-auth's `/admin/remove-user` in
// `engine.transaction`, whose handler's session read reaches
// `resolveInternalField` through plugin-auth's internal-field readback): the
// privileged read waited for a connection that could not be freed until the
// transaction waiting on the read finished. knex's acquire timeout fired
// ("Timeout acquiring a connection. The pool is probably full"), and the vendor
// route degraded that into an AUTHENTICATION refusal — a signed-in, entitled
// caller answered `401` after ~120s on a route reachable without credentials.
// SQLite's knex pool is `max: 1` (`driver-sqlite-wasm` and `driver-sql`/
// better-sqlite3 both) and SQLite is the default datasource for `objectstack
// dev`, the showcase boot and any unconfigured self-host; Postgres/MySQL run
// `max >= 10` and never exhibited it.
//
// Each arm carries its own REVERSE CONTROL — the same call outside a
// transaction must reach the driver with NO handle. Without it "the driver saw
// a transaction" could be satisfied by a driver that fabricates one, and the
// assertion would measure nothing.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

/**
 * The last recorded find. `Array.prototype.at` sits above the `lib` this
 * package's tsc program targets, so index rather than widen the compiler
 * configuration for a test convenience.
 */
const last = <T>(rows: T[]): T => rows[rows.length - 1];

const HASH = 'sha256:9f2c';

function makeRecordingDriver(name: string) {
  const rows = new Map<string, Map<string, any>>();
  /** One entry per driver-level `find`, with the transaction option it was handed. */
  const finds: Array<{ object: string; transaction: unknown }> = [];
  const storeFor = (o: string) => {
    let s = rows.get(o);
    if (!s) { s = new Map(); rows.set(o, s); }
    return s;
  };
  const driver: any = {
    name,
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any, options: any) {
      finds.push({ object, transaction: options?.transaction });
      const all = Array.from(storeFor(object).values());
      const id = ast?.where?.id;
      if (typeof id === 'string') return all.filter((r) => r.id === id);
      if (id && Array.isArray(id.$in)) return all.filter((r) => id.$in.includes(r.id));
      return all;
    },
    async findOne(object: string) {
      for (const r of storeFor(object).values()) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      const row = { ...data, id: (data.id as string) ?? `r_${storeFor(object).size + 1}` };
      storeFor(object).set(row.id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate() { return []; },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { __trx: name, commit: async () => {}, rollback: async () => {} }; },
    async commit() {},
    async rollback() {},
    /** Seed straight into storage — no engine verb, so no find is recorded. */
    seed(object: string, row: Record<string, unknown>) { storeFor(object).set(String(row.id), row); },
  };
  return { driver, finds };
}

describe('privileged driver-level reads join the ambient transaction (#10792)', () => {
  let engine: ObjectQL;
  let primary: ReturnType<typeof makeRecordingDriver>;

  beforeEach(async () => {
    engine = new ObjectQL();
    primary = makeRecordingDriver('primary');
    engine.registerDriver(primary.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'ptest_api_key',
      fields: {
        name: { type: 'text' },
        key: { type: 'text', internal: true },
        conn_secret: { type: 'secret' },
      },
    } as any, '__test__');
    engine.registry.registerObject({
      name: 'sys_secret',
      fields: {
        namespace: { type: 'text' }, key: { type: 'text' }, alg: { type: 'text' },
        version: { type: 'text' }, ciphertext: { type: 'text' }, kms_key_id: { type: 'text' },
      },
    } as any, '__test__');
    primary.driver.seed('ptest_api_key', { id: 'k1', name: 'k', key: HASH, conn_secret: 'secret:s1' });
    primary.driver.seed('sys_secret', {
      id: 's1', namespace: 'ptest_api_key', key: 'conn_secret',
      alg: 'aes-256-gcm', version: '1', ciphertext: 'ct', kms_key_id: 'local',
    });
    engine.setCryptoProvider({
      async encrypt() { throw new Error('not used'); },
      async decrypt() { return 'PLAINTEXT'; },
    } as any);
  });

  it('resolveInternalField — the read the erasure path blocked on', async () => {
    // REVERSE CONTROL first: outside a transaction there is no handle to thread,
    // so a driver that fabricated one would fail here.
    await engine.resolveInternalField('ptest_api_key', ['k1'], 'key');
    expect(last(primary.finds).transaction, 'outside a transaction: no handle').toBeUndefined();

    let resolved: Map<string, unknown> | undefined;
    await engine.transaction(async () => {
      resolved = await engine.resolveInternalField('ptest_api_key', ['k1'], 'key');
    });
    const inside = last(primary.finds);
    expect(inside.object).toBe('ptest_api_key');
    expect(inside.transaction, 'inside a transaction: the ambient handle').toBeTruthy();
    // Still the right answer — joining the transaction is not a degrade.
    expect(resolved!.get('k1')).toBe(HASH);
  });

  it('resolveSecretField', async () => {
    await engine.resolveSecretField('ptest_api_key', 'k1', 'conn_secret');
    expect(last(primary.finds).transaction, 'outside a transaction: no handle').toBeUndefined();

    let plaintext: string | null = null;
    await engine.transaction(async () => {
      plaintext = await engine.resolveSecretField('ptest_api_key', 'k1', 'conn_secret');
    });
    // Two reads on this path — the record, then `sys_secret` via resolveSecret.
    // BOTH must ride the transaction: either one alone starves a max=1 pool.
    const [record, secretRow] = primary.finds.slice(-2);
    expect(record.object).toBe('ptest_api_key');
    expect(record.transaction).toBeTruthy();
    expect(secretRow.object).toBe('sys_secret');
    expect(secretRow.transaction).toBeTruthy();
    expect(plaintext).toBe('PLAINTEXT');
  });

  it('resolveSecret — the sys_secret dereference', async () => {
    await engine.resolveSecret('secret:s1');
    expect(last(primary.finds).transaction, 'outside a transaction: no handle').toBeUndefined();

    await engine.transaction(async () => {
      await engine.resolveSecret('secret:s1');
    });
    const inside = last(primary.finds);
    expect(inside.object).toBe('sys_secret');
    expect(inside.transaction).toBeTruthy();
  });

  it('the same-origin gate still holds — a handle never reaches a FOREIGN driver', async () => {
    // #5351: a transaction handle is a property of ONE driver's connection.
    // Handing it to a different driver does not put that driver's statement
    // inside the transaction, it executes it on the WRONG CONNECTION. The join
    // above must not widen that hole: an object bound to another datasource
    // keeps its own connection, which is the pre-existing (correct) behaviour.
    const other = makeRecordingDriver('other_db');
    engine.registerDriver(other.driver);
    engine.setDatasourceMapping([{ objectPattern: 'ptest_foreign', datasource: 'other_db' }]);
    engine.registry.registerObject({
      name: 'ptest_foreign',
      fields: { name: { type: 'text' }, key: { type: 'text', internal: true } },
    } as any, '__test__');
    other.driver.seed('ptest_foreign', { id: 'f1', name: 'f', key: HASH });

    await engine.transaction(async () => {
      // The ambient transaction belongs to `primary`; this read resolves to
      // `other_db`, so it must arrive with NO handle.
      await engine.resolveInternalField('ptest_foreign', ['f1'], 'key');
    });
    expect(last(other.finds).object).toBe('ptest_foreign');
    expect(last(other.finds).transaction, 'a foreign driver must not receive the handle').toBeUndefined();
  });
});
