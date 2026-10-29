// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27582] A non-system write may only seal a new value or keep its own
 * record's ref.
 *
 * A `secret` field's stored value is an opaque `secret:` ref. On a write that
 * is not the system principal's, a value already spelled as a ref is accepted
 * only when it is the ref that same record's same column already holds, and
 * then it changes nothing (like the echoed read mask). Any other ref is
 * refused with the ADR-0112 `VALIDATION_ERROR` / 400 pair, before any
 * credential row or record is written, and with one answer whatever the ref
 * names. A system write keeps the pass-through.
 *
 * Driven through a real {@link ObjectQL} over an in-memory stub driver, on
 * every engine write door the credential pass sits on: insert (single, batch
 * and the per-row `insertMany`), the by-id update and the predicate update.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ICryptoProvider, CryptoHandle } from '@objectstack/spec/contracts';
import { ObjectQL } from './engine.js';
import { SECRET_MASK, makeSecretRef, parseSecretRef } from './secret-fields.js';

type Row = Record<string, unknown>;

/** An in-memory stub driver whose stores can be read back directly. */
function makeDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => stores.get(o) ?? (stores.set(o, new Map()), stores.get(o)!);
  const matches = (row: Row, where: any) =>
    !where || Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) return true;
      if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      return (row[k] ?? null) === (v ?? null);
    });
  const copy = (r: Row | undefined) => (r == null ? r : { ...r });
  /** The payload of every record statement, in order: which columns a write actually rewrote. */
  const statements: Array<{ object: string; data: Row }> = [];
  let n = 0;
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
    async create(o: string, data: Row) {
      const row = { ...data, id: (data.id as string) ?? `${o}_${++n}` };
      storeFor(o).set(String(row.id), row);
      return copy(row);
    },
    async update(o: string, id: string, data: Row) {
      statements.push({ object: o, data: { ...data } });
      const row = { ...storeFor(o).get(String(id)), ...data, id };
      storeFor(o).set(String(id), row);
      return copy(row);
    },
    async updateMany(o: string, ast: any, data: Row) {
      statements.push({ object: o, data: { ...data } });
      let k = 0;
      for (const [id, row] of storeFor(o)) {
        if (!matches(row, ast?.where)) continue;
        storeFor(o).set(id, { ...row, ...data, id });
        k += 1;
      }
      return k;
    },
    async delete(o: string, id: string) { return storeFor(o).delete(String(id)); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return {}; }, async commit() {}, async rollback() {},
  };
  return {
    driver,
    rowsOf: (o: string) => Array.from(storeFor(o).values()),
    lastStatement: (o: string) => [...statements].reverse().find((s) => s.object === o)?.data,
  };
}

function makeCrypto(): ICryptoProvider & { encrypts: () => number } {
  let n = 0;
  return {
    encrypts: () => n,
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
const VAULT = 'qa_ref_vault';
const vault = {
  name: VAULT, label: 'Vault',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    tier: { name: 'tier', type: 'text' },
    token: { name: 'token', type: 'secret' },
  },
};

const SYSTEM = { context: { isSystem: true } } as any;
const USER = { context: { isSystem: false, userId: 'u1' } } as any;
/** A ref spelled like a stored one, naming no `sys_secret` row at all. */
const UNKNOWN_REF = makeSecretRef('sec_none');

describe('[#27582] a non-system write may only seal a new value or keep its own record\'s ref', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  let crypto: ReturnType<typeof makeCrypto>;

  const secrets = () => d.rowsOf('sys_secret');
  const stored = (id: string) => d.rowsOf(VAULT).find((r) => r.id === id) as Row | undefined;
  const refOf = (id: string) => stored(id)!.token as string;
  const seed = async (id: string, token: string, tier = 'gold') => {
    await engine.insert(VAULT, { id, name: id, tier, token }, SYSTEM);
    return refOf(id);
  };
  /** The refusal envelope: the ADR-0112 pair and the located column. */
  const refusal = (field = 'token') => ({ code: 'VALIDATION_ERROR', status: 400, httpStatus: 400, object: VAULT, field });
  const caught = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as Error & Row);

  beforeEach(async () => {
    engine = new ObjectQL();
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject(sysSecret as any);
    engine.registry.registerObject(vault as any);
    crypto = makeCrypto();
    engine.setCryptoProvider(crypto);
  });

  describe('create: a new record has no ref of its own', () => {
    it('a create carrying another record\'s ref is refused before anything is written', async () => {
      const theirs = await seed('r1', 'theirs');
      const before = { secrets: secrets().length, encrypts: crypto.encrypts() };
      const err = await caught(engine.insert(VAULT, { name: 'mine', token: theirs }, USER));
      expect(err).toMatchObject(refusal());
      expect(d.rowsOf(VAULT).map((r) => r.id)).toEqual(['r1']);
      expect(secrets().length).toBe(before.secrets);
      expect(crypto.encrypts()).toBe(before.encrypts);
    });

    it('a ref that names an existing row and one that names nothing get the same answer', async () => {
      const theirs = await seed('r1', 'theirs');
      const named = await caught(engine.insert(VAULT, { name: 'a', token: theirs }, USER));
      const unknown = await caught(engine.insert(VAULT, { name: 'b', token: UNKNOWN_REF }, USER));
      expect(named).toMatchObject(refusal());
      expect(unknown).toMatchObject(refusal());
      expect(unknown!.message).toBe(named!.message);
      expect(named!.message).not.toContain(parseSecretRef(theirs)!);
      expect(d.rowsOf(VAULT)).toHaveLength(1);
    });

    it('a create with no context is not the system principal', async () => {
      const theirs = await seed('r1', 'theirs');
      expect(await caught(engine.insert(VAULT, { name: 'a', token: theirs }))).toMatchObject(refusal());
    });

    it('a batch create carrying a ref is refused whole', async () => {
      const theirs = await seed('r1', 'theirs');
      const err = await caught(engine.insert(VAULT, [{ name: 'a', token: 'fresh' }, { name: 'b', token: theirs }], USER));
      expect(err).toMatchObject(refusal());
      expect(d.rowsOf(VAULT).map((r) => r.id)).toEqual(['r1']);
      expect(secrets()).toHaveLength(1);
    });

    it('insertMany refuses that row alone and lands the others', async () => {
      const theirs = await seed('r1', 'theirs');
      const outcomes = await engine.insertMany(VAULT, [{ name: 'a', token: 'fresh' }, { name: 'b', token: theirs }], USER);
      expect(outcomes.map((o) => o.ok)).toEqual([true, false]);
      expect((outcomes[1] as any).error).toMatchObject(refusal());
      const landed = d.rowsOf(VAULT).find((r) => r.name === 'a')!;
      expect(await engine.resolveSecretField(VAULT, String(landed.id), 'token')).toBe('fresh');
      expect(d.rowsOf(VAULT).some((r) => r.name === 'b')).toBe(false);
    });

    it('a beforeInsert hook that writes a ref onto the row is judged the same way', async () => {
      const theirs = await seed('r1', 'theirs');
      engine.registerHook('beforeInsert', (ctx: any) => { ctx.input.data.token = theirs; }, { object: VAULT });
      expect(await caught(engine.insert(VAULT, { name: 'a' }, USER))).toMatchObject(refusal());
      expect(d.rowsOf(VAULT)).toHaveLength(1);
    });

    it('a new value is still sealed, and the system principal keeps the pass-through', async () => {
      const created = await engine.insert(VAULT, { name: 'a', token: 'fresh' }, USER);
      expect(await engine.resolveSecretField(VAULT, String(created.id), 'token')).toBe('fresh');
      const theirs = await seed('r1', 'theirs');
      await engine.insert(VAULT, { id: 'copy', name: 'copy', token: theirs }, SYSTEM);
      expect(refOf('copy')).toBe(theirs);
    });
  });

  describe('by-id update: only the ref this record already holds', () => {
    it('keeping its own ref is accepted and changes nothing', async () => {
      const own = await seed('r1', 'mine');
      const before = secrets().map((s) => s.id);
      await engine.update(VAULT, { id: 'r1', name: 'renamed', token: own }, USER);
      expect(stored('r1')).toMatchObject({ name: 'renamed', token: own });
      // Kept, not rewritten: the statement leaves the column alone, as for the echoed mask.
      expect(d.lastStatement(VAULT)).toMatchObject({ name: 'renamed' });
      expect(d.lastStatement(VAULT)).not.toHaveProperty('token');
      expect(secrets().map((s) => s.id)).toEqual(before);
      expect(await engine.resolveSecretField(VAULT, 'r1', 'token')).toBe('mine');
    });

    it('keeping its own ref as the only key is accepted too', async () => {
      const own = await seed('r1', 'mine');
      await engine.update(VAULT, { id: 'r1', token: own }, USER);
      expect(refOf('r1')).toBe(own);
      expect(await engine.resolveSecretField(VAULT, 'r1', 'token')).toBe('mine');
    });

    it('the echoed read mask is still a no-op', async () => {
      const own = await seed('r1', 'mine');
      await engine.update(VAULT, { id: 'r1', name: 'renamed', token: SECRET_MASK }, USER);
      expect(refOf('r1')).toBe(own);
    });

    it('a beforeUpdate hook that writes the stored row back keeps its own ref', async () => {
      const own = await seed('r1', 'mine');
      engine.registerHook('beforeUpdate', (ctx: any) => {
        ctx.input.data = { ...ctx.previous, ...ctx.input.data };
      }, { object: VAULT });
      await engine.update(VAULT, { id: 'r1', name: 'renamed' }, USER);
      expect(stored('r1')).toMatchObject({ name: 'renamed', token: own });
      expect(await engine.resolveSecretField(VAULT, 'r1', 'token')).toBe('mine');
    });

    it('another record\'s ref is refused and the stored value is untouched', async () => {
      const own = await seed('r1', 'mine');
      const theirs = await seed('r2', 'theirs');
      const before = secrets().map((s) => s.id);
      const err = await caught(engine.update(VAULT, { id: 'r1', name: 'renamed', token: theirs }, USER));
      expect(err).toMatchObject(refusal());
      expect(stored('r1')).toMatchObject({ name: 'r1', token: own });
      expect(secrets().map((s) => s.id)).toEqual(before);
      expect(await engine.resolveSecretField(VAULT, 'r1', 'token')).toBe('mine');
    });

    it('another record\'s ref and a ref naming nothing get the same answer', async () => {
      await seed('r1', 'mine');
      const theirs = await seed('r2', 'theirs');
      const named = await caught(engine.update(VAULT, { id: 'r1', token: theirs }, USER));
      const unknown = await caught(engine.update(VAULT, { id: 'r1', token: UNKNOWN_REF }, USER));
      expect(named).toMatchObject(refusal());
      expect(unknown).toMatchObject(refusal());
      expect(unknown!.message).toBe(named!.message);
    });

    it('a record whose column is empty has no ref to keep', async () => {
      await engine.insert(VAULT, { id: 'r1', name: 'r1' }, SYSTEM);
      const theirs = await seed('r2', 'theirs');
      expect(await caught(engine.update(VAULT, { id: 'r1', token: theirs }, USER))).toMatchObject(refusal());
      expect(stored('r1')!.token ?? null).toBeNull();
    });

    it('the system principal keeps the pass-through', async () => {
      await seed('r1', 'mine');
      const theirs = await seed('r2', 'theirs');
      await engine.update(VAULT, { id: 'r1', token: theirs }, SYSTEM);
      expect(refOf('r1')).toBe(theirs);
    });
  });

  describe('predicate update: only a ref every matched record already holds', () => {
    const multi = (where: Row) => ({ ...USER, where, multi: true });

    it('a ref every matched row already holds is accepted and changes nothing', async () => {
      await seed('r1', 'one');
      await seed('r2', 'two');
      await engine.update(VAULT, { token: 'shared' }, { ...SYSTEM, where: { tier: 'gold' }, multi: true });
      const shared = refOf('r1');
      expect(refOf('r2')).toBe(shared);
      await engine.update(VAULT, { name: 'renamed', token: shared }, multi({ tier: 'gold' }));
      expect(d.rowsOf(VAULT).map((r) => [r.name, r.token])).toEqual([['renamed', shared], ['renamed', shared]]);
      expect(d.lastStatement(VAULT)).not.toHaveProperty('token');
      expect(await engine.resolveSecretField(VAULT, 'r2', 'token')).toBe('shared');
    });

    it('a ref one matched row does not hold is refused, and nothing is written', async () => {
      const one = await seed('r1', 'one');
      const two = await seed('r2', 'two');
      const err = await caught(engine.update(VAULT, { name: 'renamed', token: one }, multi({ tier: 'gold' })));
      expect(err).toMatchObject(refusal());
      expect(d.rowsOf(VAULT).map((r) => [r.name, r.token])).toEqual([['r1', one], ['r2', two]]);
    });

    it('a ref on a predicate that matches no row is refused', async () => {
      const one = await seed('r1', 'one');
      const err = await caught(engine.update(VAULT, { token: one }, multi({ tier: 'silver' })));
      expect(err).toMatchObject(refusal());
    });

    it('the system principal keeps the pass-through', async () => {
      const one = await seed('r1', 'one');
      await seed('r2', 'two', 'silver');
      await engine.update(VAULT, { token: one }, { ...SYSTEM, where: { tier: 'silver' }, multi: true });
      expect(refOf('r2')).toBe(one);
    });
  });
});
