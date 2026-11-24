// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A field the caller may not write keeps its stored value, whatever its type —
 * a `secret` field included, on both update paths (by id and by predicate).
 *
 * A `secret` locked by a TRUE `readonlyWhen`, or declared static `readonly`,
 * takes no caller write: the stored reference is unchanged, no `sys_secret`
 * row is written for the value, and the read-only strip reports the field
 * (`onFieldsDropped`, and the `strictReadonlyWrites` refusal). The controls
 * hold the rest of the rule in place: an unlocked `secret` is still sealed and
 * stored as a reference, and a value a hook writes on a locked `secret` is
 * still the hook's and is kept.
 *
 * Driven through a real {@link ObjectQL} over a stub driver that keeps every
 * store in memory, so the stored reference and the `sys_secret` table can be
 * read after each write. See `engine-update-sealed-secrets.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ICryptoProvider, CryptoHandle } from '@objectstack/spec/contracts';
import { ObjectQL } from './engine.js';
import { isSecretRef, parseSecretRef } from './secret-fields.js';
import { READONLY_FIELD_REJECTED_CODE } from './readonly-strict-errors.js';

type Row = Record<string, unknown>;

/** A stub driver whose stores can be read back, with snapshot transactions. */
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
  const snapshots = new Map<unknown, typeof stores>();
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
      const row = { ...storeFor(o).get(String(id)), ...data, id };
      storeFor(o).set(String(id), row);
      return copy(row);
    },
    async updateMany(o: string, ast: any, data: Row) {
      let k = 0;
      for (const [id, row] of storeFor(o)) {
        if (!matches(row, ast?.where)) continue;
        storeFor(o).set(id, { ...row, ...data, id });
        k += 1;
      }
      return k;
    },
    async delete(o: string, id: string) { return storeFor(o).delete(String(id)); },
    async deleteMany(o: string, ast: any) {
      let k = 0;
      for (const [id, row] of Array.from(storeFor(o))) {
        if (!matches(row, ast?.where)) continue;
        storeFor(o).delete(id);
        k += 1;
      }
      return k;
    },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() {
      const handle = { trx: snapshots.size + 1 };
      snapshots.set(handle, new Map(Array.from(stores, ([o, s]) => [o, new Map(Array.from(s, ([k, v]) => [k, { ...v }]))])));
      return handle;
    },
    async commit(h: unknown) { snapshots.delete(h); },
    async rollback(h: unknown) { stores = snapshots.get(h) ?? stores; snapshots.delete(h); },
  };
  return { driver, rowsOf: (o: string) => Array.from(storeFor(o).values()) };
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

const CRED = 'qa_locked_cred';
const cred = {
  name: CRED, label: 'Credential',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    status: { name: 'status', type: 'text' },
    /** Locked by state: read-only while the row is `locked`. */
    state_key: { name: 'state_key', type: 'secret', readonlyWhen: "record.status == 'locked'" },
    /** Locked always: a static `readonly` secret. */
    fixed_key: { name: 'fixed_key', type: 'secret', readonly: true },
    /** Not locked: the control. */
    open_key: { name: 'open_key', type: 'secret' },
  },
};

const SYSTEM = { context: { isSystem: true } } as any;

describe('a secret field the caller may not write keeps its stored value', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  let drops: Array<{ object: string; fields: string[]; reason: string }>;

  const stored = (id: string) => d.rowsOf(CRED).find((r) => r.id === id) as Row;
  const secretRows = () => d.rowsOf('sys_secret');
  /** The plaintext a stored reference opens to, read from the `sys_secret` row it names. */
  const opens = (ref: unknown) => {
    const handle = parseSecretRef(ref);
    const row = secretRows().find((r) => r.id === handle);
    return row ? Buffer.from(String(row.ciphertext), 'base64').toString('utf8') : undefined;
  };
  const listen = { onFieldsDropped: (e: any) => drops.push(e) };

  beforeEach(async () => {
    drops = [];
    const logger: any = { warn() {}, debug() {}, info() {}, error() {}, trace() {}, fatal() {}, child() { return logger; } };
    engine = new ObjectQL({ logger });
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject(sysSecret as any, 'test');
    engine.registry.registerObject(cred as any, 'test');
    engine.setCryptoProvider(makeCrypto());
    for (const [id, name] of [['c1', 'one'], ['c2', 'pair'], ['c3', 'pair']] as const) {
      await engine.insert(CRED, {
        id, name, status: 'locked',
        state_key: `state-${id}`, fixed_key: `fixed-${id}`, open_key: `open-${id}`,
      }, SYSTEM);
    }
  });

  describe('by id', () => {
    it('a secret locked by a TRUE readonlyWhen keeps its stored value, and the strip reports it', async () => {
      const before = stored('c1').state_key;
      const secretsBefore = secretRows().length;

      await engine.update(CRED, { id: 'c1', name: 'renamed', state_key: 'caller-value' }, listen as any);

      expect(stored('c1').name).toBe('renamed');
      expect(stored('c1').state_key).toBe(before);
      expect(opens(stored('c1').state_key)).toBe('state-c1');
      expect(secretRows()).toHaveLength(secretsBefore);
      expect(drops).toEqual([{ object: CRED, fields: ['state_key'], reason: 'readonly_when' }]);
    });

    it('a static readonly secret keeps its stored value, and the strip reports it', async () => {
      const before = stored('c1').fixed_key;
      const secretsBefore = secretRows().length;

      await engine.update(CRED, { id: 'c1', name: 'renamed', fixed_key: 'caller-value' }, listen as any);

      expect(stored('c1').name).toBe('renamed');
      expect(stored('c1').fixed_key).toBe(before);
      expect(opens(stored('c1').fixed_key)).toBe('fixed-c1');
      expect(secretRows()).toHaveLength(secretsBefore);
      expect(drops).toEqual([{ object: CRED, fields: ['fixed_key'], reason: 'readonly' }]);
    });

    it('under strictReadonlyWrites a write to a locked secret is refused, naming it, and nothing is written', async () => {
      const before = { ...stored('c1') };
      const secretsBefore = secretRows().length;

      await expect(engine.update(
        CRED, { id: 'c1', name: 'renamed', state_key: 'caller-a', fixed_key: 'caller-b' },
        { strictReadonlyWrites: true } as any,
      )).rejects.toMatchObject({ code: READONLY_FIELD_REJECTED_CODE, fields: expect.arrayContaining(['state_key', 'fixed_key']) });

      expect(stored('c1')).toEqual(before);
      expect(secretRows()).toHaveLength(secretsBefore);
    });

    it('isSystem does not exempt a caller value on a secret locked by a TRUE readonlyWhen', async () => {
      const before = stored('c1').state_key;

      await engine.update(CRED, { id: 'c1', state_key: 'system-value' }, SYSTEM);

      expect(stored('c1').state_key).toBe(before);
    });

    it('control: an unlocked secret is still sealed and stored as a reference', async () => {
      const before = stored('c1').open_key;

      await engine.update(CRED, { id: 'c1', open_key: 'fresh-value' }, listen as any);

      const after = stored('c1').open_key;
      expect(isSecretRef(after)).toBe(true);
      expect(after).not.toBe(before);
      expect(opens(after)).toBe('fresh-value');
      expect(drops).toEqual([]);
    });

    it('control: a value a hook writes on a locked secret is kept', async () => {
      engine.registerHook('beforeUpdate', async (ctx: any) => {
        if (ctx.input.data.name === 'rotate') {
          ctx.input.data.state_key = 'hook-state';
          ctx.input.data.fixed_key = 'hook-fixed';
        }
      }, { object: CRED });

      await engine.update(CRED, { id: 'c1', name: 'rotate' }, listen as any);

      expect(opens(stored('c1').state_key)).toBe('hook-state');
      expect(opens(stored('c1').fixed_key)).toBe('hook-fixed');
      expect(drops).toEqual([]);
    });

    it('control: a hook value written over a caller value on a locked secret is kept', async () => {
      engine.registerHook('beforeUpdate', async (ctx: any) => {
        if ('state_key' in ctx.input.data) ctx.input.data.state_key = 'hook-state';
      }, { object: CRED });

      await engine.update(CRED, { id: 'c1', state_key: 'caller-value' }, listen as any);

      expect(opens(stored('c1').state_key)).toBe('hook-state');
      expect(drops).toEqual([]);
    });
  });

  describe('by predicate (multi)', () => {
    const pair = (o: Row = {}) => ({ where: { name: 'pair' }, multi: true, ...listen, ...o }) as any;

    it('a secret locked by a TRUE readonlyWhen keeps its stored value on every matched row, and the strip reports it', async () => {
      const before = [stored('c2').state_key, stored('c3').state_key];
      const secretsBefore = secretRows().length;

      await engine.update(CRED, { status: 'locked', state_key: 'caller-value' }, pair());

      expect([stored('c2').state_key, stored('c3').state_key]).toEqual(before);
      expect(opens(stored('c2').state_key)).toBe('state-c2');
      expect(opens(stored('c3').state_key)).toBe('state-c3');
      expect(secretRows()).toHaveLength(secretsBefore);
      expect(drops).toEqual([{ object: CRED, fields: ['state_key'], reason: 'readonly_when' }]);
    });

    it('a static readonly secret keeps its stored value on every matched row, and the strip reports it', async () => {
      const before = [stored('c2').fixed_key, stored('c3').fixed_key];
      const secretsBefore = secretRows().length;

      await engine.update(CRED, { status: 'locked', fixed_key: 'caller-value' }, pair());

      expect([stored('c2').fixed_key, stored('c3').fixed_key]).toEqual(before);
      expect(opens(stored('c2').fixed_key)).toBe('fixed-c2');
      expect(secretRows()).toHaveLength(secretsBefore);
      expect(drops).toEqual([{ object: CRED, fields: ['fixed_key'], reason: 'readonly' }]);
    });

    it('under strictReadonlyWrites a write to a locked secret is refused, naming it, and nothing is written', async () => {
      const before = [{ ...stored('c2') }, { ...stored('c3') }];
      const secretsBefore = secretRows().length;

      await expect(engine.update(
        CRED, { state_key: 'caller-a', fixed_key: 'caller-b' }, pair({ strictReadonlyWrites: true }),
      )).rejects.toMatchObject({ code: READONLY_FIELD_REJECTED_CODE, fields: expect.arrayContaining(['state_key', 'fixed_key']) });

      expect([stored('c2'), stored('c3')]).toEqual(before);
      expect(secretRows()).toHaveLength(secretsBefore);
    });

    it('control: an unlocked secret is still sealed and stored as a reference on every matched row', async () => {
      await engine.update(CRED, { open_key: 'fresh-value' }, pair());

      for (const id of ['c2', 'c3']) {
        expect(isSecretRef(stored(id).open_key)).toBe(true);
        expect(opens(stored(id).open_key)).toBe('fresh-value');
      }
      expect(drops).toEqual([]);
    });

    it('control: a value a hook writes on a locked secret is kept', async () => {
      // Every matched row's handler writes the same keys: a predicate update
      // has one payload for all of them.
      engine.registerHook('beforeUpdate', async (ctx: any) => {
        if (ctx.input.data.name === 'pair') {
          ctx.input.data.state_key = 'hook-state';
          ctx.input.data.fixed_key = 'hook-fixed';
        }
      }, { object: CRED });

      await engine.update(CRED, { name: 'pair' }, pair());

      for (const id of ['c2', 'c3']) {
        expect(opens(stored(id).state_key)).toBe('hook-state');
        expect(opens(stored(id).fixed_key)).toBe('hook-fixed');
      }
      expect(drops).toEqual([]);
    });
  });
});
