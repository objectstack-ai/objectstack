// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27495] A `secret` field's `sys_secret` row exists only while a committed
 * business row names it.
 *
 * Two halves, both on the credential channel (`encryptSecretFields` and the
 * write steps around it), driven through a real {@link ObjectQL} over a stub
 * driver that keeps every store in memory, so the `sys_secret` table can be
 * counted after each write:
 *
 *  - **Written only with the record.** The credential pass seals the value
 *    where it always has (the ref is on the row before validation judges it),
 *    but the `sys_secret` row is written immediately before the record's own
 *    driver write, and taken back if that write does not land. A write refused
 *    for any reason before then (validation, an option outside the list, a
 *    required field, a `before*` hook, the post-image permission seam) writes
 *    nothing; a driver that refuses the statement leaves nothing either.
 *  - **Released when the column lets go.** A committed update that clears the
 *    field (`null`) or replaces its value releases the handle the column named
 *    before, once storage confirms no row of that column still names it and
 *    the handle is this column's own. A handle a predicate write shared across
 *    rows outlives every row but the last.
 *  - **Released when the record goes** ([#27581]). A committed delete, by id,
 *    by predicate or by cascade, releases every handle the removed rows held,
 *    through the same release and its same checks; a delete that is refused or
 *    rolled back keeps the row.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Hook } from '@objectstack/spec/data';
import type { ICryptoProvider, CryptoHandle } from '@objectstack/spec/contracts';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import { SECRET_MASK, isSecretRef, parseSecretRef } from './secret-fields.js';

type Row = Record<string, unknown>;

/**
 * A stub driver whose stores can be counted, rolled back and told to refuse a statement.
 *
 * A rollback restores the snapshot the unit began with, unless `isolation.on`: then it undoes
 * only the writes made under that unit's handle, as a database does, so a write that escaped
 * the unit survives the rollback ([#27581]).
 */
function makeDriver() {
  let stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => stores.get(o) ?? (stores.set(o, new Map()), stores.get(o)!);
  const matches = (row: Row, where: any) =>
    !where || Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) return true;
      if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      return (row[k] ?? null) === (v ?? null);
    });
  const copy = (r: Row | undefined) => (r == null ? r : { ...r });
  /** Objects whose next record statement the driver refuses (create / update / updateMany). */
  const refuse = new Set<string>();
  /** Objects whose `count` throws, so a release cannot confirm anything. */
  const countFails = new Set<string>();
  const snapshots = new Map<unknown, typeof stores>();
  const isolation = { on: false };
  const undoLogs = new Map<unknown, Array<() => void>>();
  /** Record how to take back one write, when it was made under an open unit's handle. */
  const undoable = (opts: any, take: () => void) => { undoLogs.get(opts?.transaction)?.push(take); };
  let n = 0;
  const refused = (o: string) => {
    if (refuse.has(o)) throw Object.assign(new Error(`statement refused on ${o}`), { code: 'ETIMEDOUT' });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return page.map(copy);
    },
    async findOne(o: string, ast: any) { return (await this.find(o, ast))[0] ?? null; },
    async create(o: string, data: Row, opts?: any) {
      refused(o);
      const row = { ...data, id: (data.id as string) ?? `${o}_${++n}` };
      storeFor(o).set(String(row.id), row);
      undoable(opts, () => storeFor(o).delete(String(row.id)));
      return copy(row);
    },
    async update(o: string, id: string, data: Row, opts?: any) {
      refused(o);
      const prior = storeFor(o).get(String(id));
      const row = { ...prior, ...data, id };
      storeFor(o).set(String(id), row);
      undoable(opts, () => (prior ? storeFor(o).set(String(id), prior) : storeFor(o).delete(String(id))));
      return copy(row);
    },
    async updateMany(o: string, ast: any, data: Row, opts?: any) {
      refused(o);
      let k = 0;
      for (const [id, row] of storeFor(o)) {
        if (!matches(row, ast?.where)) continue;
        storeFor(o).set(id, { ...row, ...data, id });
        undoable(opts, () => storeFor(o).set(id, row));
        k += 1;
      }
      return k;
    },
    async delete(o: string, id: string, opts?: any) {
      const prior = storeFor(o).get(String(id));
      if (prior) undoable(opts, () => storeFor(o).set(String(id), prior));
      return storeFor(o).delete(String(id));
    },
    async deleteMany(o: string, ast: any, opts?: any) {
      let k = 0;
      for (const [id, row] of Array.from(storeFor(o))) {
        if (!matches(row, ast?.where)) continue;
        await this.delete(o, id, opts);
        k += 1;
      }
      return k;
    },
    async count(o: string, ast: any) {
      if (countFails.has(o)) throw new Error(`count unavailable on ${o}`);
      return (await this.find(o, ast)).length;
    },
    async bulkCreate(o: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() {
      const handle = { trx: snapshots.size + 1 };
      snapshots.set(handle, new Map(Array.from(stores, ([o, s]) => [o, new Map(Array.from(s, ([k, v]) => [k, { ...v }]))])));
      undoLogs.set(handle, []);
      return handle;
    },
    async commit(h: unknown) { snapshots.delete(h); undoLogs.delete(h); },
    async rollback(h: unknown) {
      if (isolation.on) for (const take of (undoLogs.get(h) ?? []).reverse()) take();
      else stores = snapshots.get(h) ?? stores;
      snapshots.delete(h);
      undoLogs.delete(h);
    },
  };
  return {
    driver, refuse, countFails, isolation,
    rowsOf: (o: string) => Array.from(storeFor(o).values()),
  };
}

function makeCrypto(): ICryptoProvider {
  let n = 0;
  return {
    async encrypt(plain: string): Promise<CryptoHandle> {
      n += 1;
      return { id: `sec_${n}`, kmsKeyId: 'local', alg: 'test-b64', version: 1, ciphertext: Buffer.from(plain).toString('base64') };
    },
    async decrypt(handle: CryptoHandle) { return Buffer.from(handle.ciphertext, 'base64').toString('utf8'); },
    async rotateKey(handle: CryptoHandle) { return handle; },
    digest(plain: string) { return `d:${plain.length}`; },
    async keyedDigest(plain: string) { return `k:${plain.length}`; },
  };
}

const sysSecret = {
  name: 'sys_secret', label: 'Secret', systemFields: { tenant: false },
  fields: {
    id: { name: 'id', type: 'text' }, namespace: { name: 'namespace', type: 'text' }, key: { name: 'key', type: 'text' },
    kms_key_id: { name: 'kms_key_id', type: 'text' }, alg: { name: 'alg', type: 'text' },
    version: { name: 'version', type: 'number' }, ciphertext: { name: 'ciphertext', type: 'text' },
    created_at: { name: 'created_at', type: 'datetime' },
  },
};
const VAULT = 'qa_vault';
const vault = {
  name: VAULT, label: 'Vault',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text', required: true },
    tier: { name: 'tier', type: 'select', options: [{ label: 'Gold', value: 'gold' }, { label: 'Silver', value: 'silver' }] },
    token: { name: 'token', type: 'secret' },
  },
};
const OTHER = 'qa_other';
const other = {
  name: OTHER, label: 'Other',
  fields: { id: { name: 'id', type: 'text' }, name: { name: 'name', type: 'text' }, other_token: { name: 'other_token', type: 'secret' } },
};

const SYSTEM = { context: { isSystem: true } } as any;
/** [#27581] A detail of the vault, holding its own secret: a cascade target. */
const KEY = 'qa_vault_key';
const vaultKey = {
  name: KEY, label: 'Vault key',
  fields: {
    id: { name: 'id', type: 'text' }, name: { name: 'name', type: 'text' },
    vault: { name: 'vault', type: 'master_detail', reference: VAULT },
    key_token: { name: 'key_token', type: 'secret' },
  },
};

describe('[#27495] a sys_secret row exists only while a committed row names it', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  let errors: string[];
  let logger: any;
  /** What the post-image permission seam does on the next write: let it through, or refuse it. */
  let seam: 'none' | 'refuse';

  const secrets = () => d.rowsOf('sys_secret');
  const stored = (id: string) => d.rowsOf(VAULT).find((r) => r.id === id) as Row;
  const handleOf = (id: string) => parseSecretRef(stored(id).token);
  const seed = async (id: string, token: string) => {
    await engine.insert(VAULT, { id, name: id, tier: 'gold', token }, SYSTEM);
    return handleOf(id)!;
  };

  beforeEach(async () => {
    errors = [];
    seam = 'none';
    logger = {
      error: (m: string) => errors.push(String(m)),
      warn() {}, debug() {}, info() {}, trace() {}, fatal() {},
      child() { return logger; },
    };
    engine = new ObjectQL({ logger });
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject(sysSecret as any);
    engine.registry.registerObject(vault as any);
    engine.registry.registerObject(other as any);
    engine.setCryptoProvider(makeCrypto());
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (seam === 'refuse' && (opCtx.operation === 'insert' || opCtx.operation === 'update')) {
        opCtx.postHookWriteImageCheck = {
          evaluate: () => { throw Object.assign(new Error('write check refused'), { code: 'PERMISSION_DENIED', status: 403 }); },
        };
      }
      await next();
    });
  });

  describe('a refused write writes no sys_secret row', () => {
    it('insert refused by a required field', async () => {
      await expect(engine.insert(VAULT, { token: 'orphan-1' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED', fields: [expect.objectContaining({ field: 'name', code: 'required' })],
      });
      expect(d.rowsOf(VAULT)).toHaveLength(0);
      expect(secrets()).toHaveLength(0);
    });

    it('insert refused by an option outside the list', async () => {
      await expect(engine.insert(VAULT, { name: 'x', tier: 'bogus', token: 'orphan-2' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED', fields: [expect.objectContaining({ field: 'tier', code: 'invalid_option' })],
      });
      expect(secrets()).toHaveLength(0);
    });

    it('insert refused by a beforeInsert hook', async () => {
      engine.registerHook('beforeInsert', () => { throw Object.assign(new Error('hook says no'), { code: 'HOOK_REFUSED', status: 400 }); }, { object: VAULT });
      await expect(engine.insert(VAULT, { name: 'x', token: 'orphan-3' })).rejects.toMatchObject({ code: 'HOOK_REFUSED', status: 400 });
      expect(secrets()).toHaveLength(0);
    });

    it('insert refused by the post-image permission seam', async () => {
      seam = 'refuse';
      await expect(engine.insert(VAULT, { name: 'x', token: 'orphan-4' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      expect(secrets()).toHaveLength(0);
    });

    it('insert whose record statement the driver refuses', async () => {
      d.refuse.add(VAULT);
      await expect(engine.insert(VAULT, { name: 'x', token: 'orphan-5' })).rejects.toThrow(/statement refused/);
      expect(d.rowsOf(VAULT)).toHaveLength(0);
      expect(secrets()).toHaveLength(0);
      expect(errors).toEqual([]);
    });

    it('a batch insert whose statement the driver refuses', async () => {
      d.refuse.add(VAULT);
      await expect(engine.insert(VAULT, [{ name: 'a', token: 'b-1' }, { name: 'b', token: 'b-2' }])).rejects.toThrow(/statement refused/);
      expect(secrets()).toHaveLength(0);
    });

    it('partial insertMany: only the row that lands keeps a credential row', async () => {
      const outcomes = await engine.insertMany(VAULT, [{ token: 'dead' }, { name: 'alive', token: 'kept' }]);
      expect(outcomes.map((o) => o.ok)).toEqual([false, true]);
      expect(secrets()).toHaveLength(1);
      const [alive] = d.rowsOf(VAULT);
      expect(parseSecretRef(alive.token)).toBe(secrets()[0].id);
      expect(await engine.resolveSecretField(VAULT, String(alive.id), 'token')).toBe('kept');
    });

    it('update refused by an option outside the list keeps the old secret and writes no new row', async () => {
      const before = await seed('r1', 'stays');
      await expect(engine.update(VAULT, { id: 'r1', tier: 'bogus', token: 'orphan-6' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED', fields: [expect.objectContaining({ field: 'tier', code: 'invalid_option' })],
      });
      expect(secrets().map((s) => s.id)).toEqual([before]);
      expect(handleOf('r1')).toBe(before);
      expect(await engine.resolveSecretField(VAULT, 'r1', 'token')).toBe('stays');
    });

    it('update refused by the post-image permission seam', async () => {
      const before = await seed('r1', 'stays');
      seam = 'refuse';
      await expect(engine.update(VAULT, { id: 'r1', token: 'orphan-7' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      expect(secrets().map((s) => s.id)).toEqual([before]);
    });

    it('update whose record statement the driver refuses', async () => {
      const before = await seed('r1', 'stays');
      d.refuse.add(VAULT);
      await expect(engine.update(VAULT, { id: 'r1', token: 'orphan-8' })).rejects.toThrow(/statement refused/);
      expect(secrets().map((s) => s.id)).toEqual([before]);
      expect(handleOf('r1')).toBe(before);
    });

    it('a predicate update refused by an option outside the list', async () => {
      const before = [await seed('r1', 'one'), await seed('r2', 'two')];
      await expect(
        engine.update(VAULT, { tier: 'bogus', token: 'orphan-9' }, { where: { tier: 'gold' }, multi: true } as any),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(secrets().map((s) => s.id).sort()).toEqual(before.sort());
    });

    it('a predicate update whose statement the driver refuses', async () => {
      const before = [await seed('r1', 'one'), await seed('r2', 'two')];
      d.refuse.add(VAULT);
      await expect(
        engine.update(VAULT, { token: 'orphan-10' }, { where: { tier: 'gold' }, multi: true } as any),
      ).rejects.toThrow(/statement refused/);
      expect(secrets().map((s) => s.id).sort()).toEqual(before.sort());
    });

    it('an aborting afterInsert rolls the credential row back with the record', async () => {
      bindHooksToEngine(engine, [
        { name: 'veto', object: VAULT, events: ['afterInsert'], handler: () => { throw new Error('refused by the hook'); } } as unknown as Hook,
      ], { packageId: 'app:t', logger });
      await expect(engine.insert(VAULT, { name: 'x', token: 'orphan-11' })).rejects.toThrow(/refused by the hook/);
      expect(d.rowsOf(VAULT)).toHaveLength(0);
      expect(secrets()).toHaveLength(0);
    });
  });

  describe('a committed write still stores and reads back', () => {
    it('insert seals the value, masks it on read and dereferences it', async () => {
      const created = await engine.insert(VAULT, { name: 'ok', token: 'kept' });
      const row = stored(String(created.id));
      expect(isSecretRef(row.token)).toBe(true);
      expect(secrets()).toHaveLength(1);
      expect(secrets()[0]).toMatchObject({ id: parseSecretRef(row.token), namespace: VAULT, key: 'token' });
      expect(((await engine.findOne(VAULT, { where: { id: created.id } })) as Row).token).toBe(SECRET_MASK);
      expect(await engine.resolveSecretField(VAULT, String(created.id), 'token')).toBe('kept');
    });

    it('an echoed mask changes nothing and releases nothing', async () => {
      const before = await seed('r1', 'stays');
      await engine.update(VAULT, { id: 'r1', name: 'renamed', token: SECRET_MASK });
      expect(handleOf('r1')).toBe(before);
      expect(secrets().map((s) => s.id)).toEqual([before]);
    });
  });

  describe('a committed write releases the handle its column let go of', () => {
    it('clearing with null removes the old row', async () => {
      await seed('r1', 'gone');
      await engine.update(VAULT, { id: 'r1', token: null });
      expect(stored('r1').token ?? null).toBeNull();
      expect(secrets()).toHaveLength(0);
      expect(await engine.resolveSecretField(VAULT, 'r1', 'token')).toBeNull();
    });

    it('replacing the value removes the old row and keeps the new one', async () => {
      const before = await seed('r1', 'old');
      await engine.update(VAULT, { id: 'r1', token: 'new' });
      expect(handleOf('r1')).not.toBe(before);
      expect(secrets().map((s) => s.id)).toEqual([handleOf('r1')]);
      expect(await engine.resolveSecretField(VAULT, 'r1', 'token')).toBe('new');
    });

    it('a predicate clear removes every matched row\'s handle', async () => {
      await seed('r1', 'one');
      await seed('r2', 'two');
      await engine.update(VAULT, { token: null }, { where: { tier: 'gold' }, multi: true } as any);
      expect(secrets()).toHaveLength(0);
    });

    it('a handle a predicate write shared across rows outlives every row but the last', async () => {
      await seed('r1', 'one');
      await seed('r2', 'two');
      await engine.update(VAULT, { token: 'shared' }, { where: { tier: 'gold' }, multi: true } as any);
      const shared = handleOf('r1');
      expect(handleOf('r2')).toBe(shared);
      expect(secrets().map((s) => s.id)).toEqual([shared]);

      await engine.update(VAULT, { id: 'r1', token: null });
      expect(secrets().map((s) => s.id)).toEqual([shared]);
      expect(await engine.resolveSecretField(VAULT, 'r2', 'token')).toBe('shared');

      await engine.update(VAULT, { id: 'r2', token: null });
      expect(secrets()).toHaveLength(0);
    });

    it('a handle minted for another column is never released through this one', async () => {
      const foreign = await seed('r1', 'theirs');
      // A ref a system writer copied onto another object's column: that column
      // letting go of it says nothing about the column the handle was minted for.
      await engine.insert(OTHER, { id: 'o1', name: 'copy', other_token: `secret:${foreign}` }, SYSTEM);
      await engine.update(OTHER, { id: 'o1', other_token: null });
      expect(secrets().map((s) => s.id)).toEqual([foreign]);
      expect(await engine.resolveSecretField(VAULT, 'r1', 'token')).toBe('theirs');
    });

    it('a release that cannot confirm the column let go keeps the row and says so', async () => {
      const before = await seed('r1', 'stays-stored');
      d.countFails.add(VAULT);
      await engine.update(VAULT, { id: 'r1', token: null });
      expect(stored('r1').token ?? null).toBeNull();
      expect(secrets().map((s) => s.id)).toEqual([before]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(`${VAULT}.token`);
      expect(errors[0]).not.toContain(before);
    });
  });

  describe('[#27581] a committed delete releases the handles the removed rows held', () => {
    it('a by-id delete removes the row its record named', async () => {
      const gone = await seed('r1', 'gone');
      const kept = await seed('r2', 'kept');
      await expect(engine.delete(VAULT, { where: { id: 'r1' } })).resolves.toBe(true);
      expect(secrets().map((s) => s.id)).toEqual([kept]);
      expect(secrets().some((s) => s.id === gone)).toBe(false);
      expect(await engine.resolveSecretField(VAULT, 'r2', 'token')).toBe('kept');
      expect(errors).toEqual([]);
    });

    it('a predicate delete removes every matched row\'s handle and no other', async () => {
      await seed('r1', 'one');
      await seed('r2', 'two');
      await engine.update(VAULT, { id: 'r2', tier: 'silver' });
      const silver = handleOf('r2');
      await seed('r3', 'three');
      await expect(engine.delete(VAULT, { where: { tier: 'gold' }, multi: true } as any)).resolves.toBe(2);
      expect(secrets().map((s) => s.id)).toEqual([silver]);
    });

    it('a predicate delete with a per-row hook releases from the rows that hook read', async () => {
      const seen: unknown[] = [];
      engine.registerHook('afterDelete', (ctx: any) => { seen.push(ctx.previous?.id); }, { object: VAULT });
      await seed('r1', 'one');
      await seed('r2', 'two');
      await engine.delete(VAULT, { where: { tier: 'gold' }, multi: true } as any);
      expect(seen.sort()).toEqual(['r1', 'r2']);
      expect(secrets()).toHaveLength(0);
    });

    it('a cascade removes the detail rows\' handles with the parent\'s, by id and by predicate', async () => {
      engine.registry.registerObject(vaultKey as any);
      await seed('r1', 'parent-1');
      await seed('r2', 'parent-2');
      await engine.insert(KEY, { id: 'k1', name: 'k1', vault: 'r1', key_token: 'child-1' }, SYSTEM);
      await engine.insert(KEY, { id: 'k2', name: 'k2', vault: 'r2', key_token: 'child-2' }, SYSTEM);
      expect(secrets()).toHaveLength(4);
      await engine.delete(VAULT, { where: { id: 'r1' } });
      expect(d.rowsOf(KEY).map((r) => r.id)).toEqual(['k2']);
      expect(secrets().map((s) => s.key).sort()).toEqual(['key_token', 'token']);
      await engine.delete(VAULT, { where: { tier: 'gold' }, multi: true } as any);
      expect(d.rowsOf(KEY)).toHaveLength(0);
      expect(secrets()).toHaveLength(0);
    });

    it('a handle another row still names outlives the delete of every row but the last', async () => {
      await seed('r1', 'one');
      await seed('r2', 'two');
      await engine.update(VAULT, { token: 'shared' }, { where: { tier: 'gold' }, multi: true } as any);
      const shared = handleOf('r1');
      expect(handleOf('r2')).toBe(shared);

      await engine.delete(VAULT, { where: { id: 'r1' } });
      expect(secrets().map((s) => s.id)).toEqual([shared]);
      expect(await engine.resolveSecretField(VAULT, 'r2', 'token')).toBe('shared');

      await engine.delete(VAULT, { where: { id: 'r2' } });
      expect(secrets()).toHaveLength(0);
    });

    it('deleting a row that holds another column\'s handle releases nothing', async () => {
      const foreign = await seed('r1', 'theirs');
      await engine.insert(OTHER, { id: 'o1', name: 'copy', other_token: `secret:${foreign}` }, SYSTEM);
      await engine.delete(OTHER, { where: { id: 'o1' } });
      expect(secrets().map((s) => s.id)).toEqual([foreign]);
      expect(await engine.resolveSecretField(VAULT, 'r1', 'token')).toBe('theirs');
    });

    it('a delete rolled back with its unit keeps the row, though the record write was undone alone', async () => {
      d.isolation.on = true;
      const before = await seed('r1', 'stays');
      await expect(engine.transaction(async (trx: any) => {
        await engine.delete(VAULT, { where: { id: 'r1' }, context: trx });
        throw new Error('roll the unit back');
      }, SYSTEM.context)).rejects.toThrow(/roll the unit back/);
      expect(stored('r1')).toBeDefined();
      expect(secrets().map((s) => s.id)).toEqual([before]);
      expect(await engine.resolveSecretField(VAULT, 'r1', 'token')).toBe('stays');
    });

    it('a delete refused by a beforeDelete hook, or rolled back by an aborting afterDelete, keeps the row', async () => {
      const before = await seed('r1', 'stays');
      engine.registerHook('beforeDelete', () => { throw Object.assign(new Error('hook says no'), { code: 'HOOK_REFUSED', status: 400 }); }, { object: VAULT });
      await expect(engine.delete(VAULT, { where: { id: 'r1' } })).rejects.toMatchObject({ code: 'HOOK_REFUSED', status: 400 });
      expect(secrets().map((s) => s.id)).toEqual([before]);

      const other = await seed('o1', 'also-stays');
      engine.registry.registerObject({ ...vault, name: 'qa_vault_two' } as any);
      await engine.insert('qa_vault_two', { id: 't1', name: 't1', token: 'two-stays' }, SYSTEM);
      const twoHandle = parseSecretRef(d.rowsOf('qa_vault_two')[0].token);
      bindHooksToEngine(engine, [
        { name: 'veto', object: 'qa_vault_two', events: ['afterDelete'], handler: () => { throw new Error('refused by the hook'); } } as unknown as Hook,
      ], { packageId: 'app:t', logger });
      await expect(engine.delete('qa_vault_two', { where: { id: 't1' } })).rejects.toThrow(/refused by the hook/);
      expect(d.rowsOf('qa_vault_two')).toHaveLength(1);
      expect(secrets().map((s) => s.id).sort()).toEqual([before, other, twoHandle].sort());
    });

    it('a release that cannot confirm the column let go keeps the row and says so', async () => {
      const before = await seed('r1', 'stays-stored');
      d.countFails.add(VAULT);
      await engine.delete(VAULT, { where: { id: 'r1' } });
      expect(d.rowsOf(VAULT)).toHaveLength(0);
      expect(secrets().map((s) => s.id)).toEqual([before]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(`${VAULT}.token`);
      expect(errors[0]).not.toContain(before);
    });
  });
});
