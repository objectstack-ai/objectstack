// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30237, ADR-0148 D1/D3/D4] The recycle bin's write side, through a real
 * `ObjectQL`: a by-id delete of a business record writes ONE entry holding the
 * record and its master-detail cascade (master first), the `set_null`
 * references it cleared, and the purge deadline stamped from the retention —
 * inside the delete's own unit of work. Predicate deletes, cascade children
 * and `sys_*` objects write none, and the TTL sweep reaps an entry once its
 * stamped deadline has passed.
 *
 * The driver keeps real rows and real rollback (a deep snapshot per
 * transaction, the shape `driver-memory` uses), because "the entry rolls back
 * with the delete" cannot be told apart from "it does not" by a stub.
 */

import { describe, it, expect } from 'vitest';
import {
  RECYCLE_BIN_ENTRY_FIELDS,
  RecycleBinEntrySchema,
  recycleBinRetentionRefusal,
} from '@objectstack/spec/data';
import { ObjectQL } from '../engine.js';
import { LifecycleService } from '../lifecycle/lifecycle-service.js';
import { cascadeMembersInOrder } from './capture.js';
import { cascadeMemberKey, type CascadeDeleteSet } from '../engine-top-level.js';

type Row = Record<string, unknown>;

function recordingLogger() {
  const records: Array<{ level: string; message: string }> = [];
  const push = (level: string) => (message: unknown) => void records.push({ level, message: String(message) });
  return {
    records,
    logger: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
    at: (level: string) => records.filter((r) => r.level === level),
  };
}

function makeDriver(opts: { transactional?: boolean; failDeleteOf?: string } = {}) {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const writes: Array<{ object: string; op: string; transaction: unknown }> = [];
  const snapshots = new Map<unknown, Map<string, Map<string, Row>>>();
  let begun = 0;
  let nextId = 0;
  const matches = (row: Row, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
        if (!(v as any).$in.some((x: unknown) => String(x) === String(row[k]))) return false;
        continue;
      }
      if (v && typeof v === 'object' && '$contains' in (v as any)) {
        const cell = row[k];
        const needle = String((v as any).$contains);
        if (!(Array.isArray(cell) ? cell.map(String).includes(needle) : String(cell ?? '').includes(needle))) return false;
        continue;
      }
      if (v && typeof v === 'object' && '$lt' in (v as any)) {
        if (!(row[k] != null && String(row[k]) < String((v as any).$lt))) return false;
        continue;
      }
      const exp = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'primary',
    version: '0.0.0',
    supports: {},
    writes,
    rowsOf: (o: string) => Array.from(storeFor(o).values()),
    seed(o: string, row: Row) { storeFor(o).set(String(row.id), { ...row }); },
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: any) {
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)).map((r) => ({ ...r }));
    },
    async findOne(o: string, ast: any) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(o: string, data: Row, options: any) {
      writes.push({ object: o, op: 'create', transaction: options?.transaction });
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = JSON.parse(JSON.stringify({ ...data, id }));
      storeFor(o).set(id, row);
      return { ...row };
    },
    async update(o: string, id: string, data: Row, options: any) {
      writes.push({ object: o, op: 'update', transaction: options?.transaction });
      const s = storeFor(o);
      const cur = s.get(String(id));
      if (!cur) throw new Error(`not found ${o}/${id}`);
      const up = { ...cur, ...data, id };
      s.set(String(id), up);
      return { ...up };
    },
    async upsert(o: string, data: Row) {
      const id = data.id as string | undefined;
      return id && storeFor(o).has(id) ? this.update(o, id, data, undefined) : this.create(o, data, undefined);
    },
    async delete(o: string, id: string, options: any) {
      if (opts.failDeleteOf === o) throw new Error(`driver refused the delete of ${o}/${id}`);
      writes.push({ object: o, op: 'delete', transaction: options?.transaction });
      return storeFor(o).delete(String(id));
    },
    async deleteMany(o: string, ast: any, options: any) {
      const doomed = await this.find(o, ast);
      for (const r of doomed) {
        writes.push({ object: o, op: 'delete', transaction: options?.transaction });
        storeFor(o).delete(String((r as any).id));
      }
      return doomed.length;
    },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(o, r, undefined))); },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
  };
  if (opts.transactional !== false) {
    driver.beginTransaction = async () => {
      begun += 1;
      const handle = { __trx: begun };
      const snap = new Map<string, Map<string, Row>>();
      for (const [o, s] of stores) snap.set(o, new Map(Array.from(s, ([k, v]) => [k, { ...v }])));
      snapshots.set(handle, snap);
      return handle;
    };
    driver.commit = async (handle: unknown) => { snapshots.delete(handle); };
    driver.rollback = async (handle: unknown) => {
      const snap = snapshots.get(handle);
      if (snap) { stores.clear(); for (const [o, s] of snap) stores.set(o, s); }
      snapshots.delete(handle);
    };
  }
  return driver;
}

const text = (name: string) => ({ name, type: 'text' as const });

/** The bin, declared as `@objectstack/platform-objects` declares it. */
const bin = {
  name: 'sys_recycle_bin',
  label: 'Recycle Bin Entry',
  managedBy: 'engine-owned',
  fields: {
    ...RECYCLE_BIN_ENTRY_FIELDS,
    organization_id: { name: 'organization_id', type: 'lookup' as const, reference: 'sys_organization', deleteBehavior: 'cascade' },
  },
  lifecycle: { class: 'transient', ttl: { field: 'purge_after', expireAfter: '0h' } },
};
/** account ← contact (master_detail) ← note (master_detail); task → account (set_null). */
const account = {
  name: 'account',
  label: 'Account',
  fields: {
    id: text('id'),
    name: text('name'),
    organization_id: text('organization_id'),
    api_token: { name: 'api_token', type: 'secret' as const },
  },
};
const contact = {
  name: 'contact',
  label: 'Contact',
  fields: {
    id: text('id'),
    name: text('name'),
    account: { name: 'account', type: 'master_detail' as const, reference: 'account' },
  },
};
const note = {
  name: 'note',
  label: 'Note',
  fields: {
    id: text('id'),
    body: text('body'),
    contact: { name: 'contact', type: 'master_detail' as const, reference: 'contact' },
  },
};
const task = {
  name: 'task',
  label: 'Task',
  fields: {
    id: text('id'),
    subject: text('subject'),
    account: { name: 'account', type: 'lookup' as const, reference: 'account' },
    watchers: { name: 'watchers', type: 'lookup' as const, reference: 'account', multiple: true },
  },
};
/** A system object: never enters the bin. */
const sysThing = { name: 'sys_thing', label: 'Thing', fields: { id: text('id'), name: text('name') } };
/** Nothing references it: the plain, non-cascading delete. */
const loner = { name: 'loner', label: 'Loner', fields: { id: text('id'), name: text('name') } };

async function makeEngine(options: { withBin?: boolean; transactional?: boolean; failDeleteOf?: string } = {}) {
  const rec = recordingLogger();
  const engine = new ObjectQL({ logger: rec.logger } as any);
  const driver = makeDriver(options);
  engine.registerDriver(driver, true);
  await engine.init();
  const objects: any[] = [account, contact, note, task, sysThing, loner];
  if (options.withBin !== false) objects.push(bin);
  for (const o of objects) engine.registry.registerObject(o as any, '__test__');
  return { engine, driver, rec };
}

function seedAccountTree(driver: any) {
  driver.seed('account', { id: 'acc1', name: 'Acme', organization_id: 'org_1', api_token: 'plain-not-a-ref' });
  driver.seed('contact', { id: 'c1', name: 'Ada', account: 'acc1' });
  driver.seed('contact', { id: 'c2', name: 'Bob', account: 'acc1' });
  driver.seed('note', { id: 'n1', body: 'first', contact: 'c1' });
  driver.seed('task', { id: 't1', subject: 'call', account: 'acc1', watchers: ['acc1', 'acc2'] });
}

const USER = { context: { userId: 'u_alice' } } as any;
const entriesOf = (driver: any) => driver.rowsOf('sys_recycle_bin') as Row[];

describe('a by-id delete writes ONE recycle-bin entry (ADR-0148 D1)', () => {
  it('holds the record and its master-detail cascade, master first, and the cleared references', async () => {
    const { engine, driver } = await makeEngine();
    seedAccountTree(driver);

    await engine.delete('account', { where: { id: 'acc1' }, ...USER } as any);

    // The delete is physical, exactly as before.
    expect(driver.rowsOf('account')).toHaveLength(0);
    expect(driver.rowsOf('contact')).toHaveLength(0);
    expect(driver.rowsOf('note')).toHaveLength(0);

    const entries = entriesOf(driver);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(RecycleBinEntrySchema.safeParse(entry).success).toBe(true);
    expect(entry).toMatchObject({
      object_name: 'account',
      record_id: 'acc1',
      record_count: 4,
      deleted_by: 'u_alice',
      retention_days: 30,
      organization_id: 'org_1',
    });
    const snapshot = entry.snapshot as { rows: Array<{ object: string; id: string; values: Row }>; clearedReferences: Row[] };
    // Master first, then its details breadth-first: a restore writes them back in this order.
    expect(snapshot.rows.map((r) => `${r.object}/${r.id}`)).toEqual([
      'account/acc1', 'contact/c1', 'contact/c2', 'note/n1',
    ]);
    expect(snapshot.rows[1].values).toMatchObject({ id: 'c1', name: 'Ada', account: 'acc1' });
    // Both arities of `set_null`: the single lookup and one member of the set.
    expect(snapshot.clearedReferences).toEqual(expect.arrayContaining([
      { object: 'task', id: 't1', field: 'account', value: 'acc1' },
      { object: 'task', id: 't1', field: 'watchers', value: 'acc1' },
    ]));
    expect(snapshot.clearedReferences).toHaveLength(2);
    expect(driver.rowsOf('task')[0]).toMatchObject({ account: null, watchers: ['acc2'] });
  });

  it('stamps purge_after as deleted_at plus the retention', async () => {
    const { engine, driver } = await makeEngine();
    driver.seed('loner', { id: 'l1', name: 'x' });
    await engine.delete('loner', { where: { id: 'l1' } } as any);
    const [entry] = entriesOf(driver);
    const span = Date.parse(entry.purge_after as string) - Date.parse(entry.deleted_at as string);
    expect(span).toBe(30 * 86_400_000);
    // A delete with no user is the system's: the entry names no one.
    expect(entry.deleted_by).toBeUndefined();
  });

  it('credits the human a system-authorized delete was made for, as the audit ledger does', async () => {
    const { engine, driver } = await makeEngine();
    driver.seed('loner', { id: 'l1', name: 'x' });
    await engine.delete('loner', { where: { id: 'l1' }, context: { isSystem: true, attributedUserId: 'u_bob' } } as any);
    expect(entriesOf(driver)[0].deleted_by).toBe('u_bob');
  });

  it('leaves the secret column out of the snapshot (D4)', async () => {
    const { engine, driver } = await makeEngine();
    seedAccountTree(driver);
    await engine.delete('account', { where: { id: 'acc1' }, ...USER } as any);
    const root = (entriesOf(driver)[0].snapshot as any).rows[0];
    expect(root.values).toMatchObject({ id: 'acc1', name: 'Acme', organization_id: 'org_1' });
    expect(root.values).not.toHaveProperty('api_token');
  });

  it('keeps no column the object does not declare', async () => {
    const { engine, driver } = await makeEngine();
    driver.seed('loner', { id: 'l1', name: 'x', leftover_column: 'undeclared' });
    await engine.delete('loner', { where: { id: 'l1' } } as any);
    const root = (entriesOf(driver)[0].snapshot as any).rows[0];
    expect(root.values).not.toHaveProperty('leftover_column');
  });

  it('writes the entry inside the transaction that wraps the cascade', async () => {
    const { engine, driver } = await makeEngine();
    seedAccountTree(driver);
    await engine.delete('account', { where: { id: 'acc1' }, ...USER } as any);
    const binWrite = driver.writes.find((w: any) => w.object === 'sys_recycle_bin');
    const rootDelete = driver.writes.find((w: any) => w.object === 'account' && w.op === 'delete');
    expect(binWrite?.transaction).toBeDefined();
    expect(binWrite?.transaction).toBe(rootDelete?.transaction);
  });
});

describe('deletes that do not enter the bin (v1 reach, seat ruling Q6)', () => {
  it('a cascade child is a row of its root entry, never an entry of its own', async () => {
    const { engine, driver } = await makeEngine();
    seedAccountTree(driver);
    await engine.delete('account', { where: { id: 'acc1' } } as any);
    expect(entriesOf(driver).map((e) => e.object_name)).toEqual(['account']);
  });

  it('a delete by predicate writes no entry', async () => {
    const { engine, driver } = await makeEngine();
    driver.seed('loner', { id: 'l1', name: 'x' });
    driver.seed('loner', { id: 'l2', name: 'x' });
    await engine.delete('loner', { where: { name: 'x' }, multi: true } as any);
    expect(driver.rowsOf('loner')).toHaveLength(0);
    expect(entriesOf(driver)).toHaveLength(0);
  });

  it('a sys_* object writes no entry', async () => {
    const { engine, driver } = await makeEngine();
    driver.seed('sys_thing', { id: 's1', name: 'x' });
    await engine.delete('sys_thing', { where: { id: 's1' } } as any);
    expect(driver.rowsOf('sys_thing')).toHaveLength(0);
    expect(entriesOf(driver)).toHaveLength(0);
  });

  it('a composition with no bin deletes as before and says so once per engine', async () => {
    const { engine, driver, rec } = await makeEngine({ withBin: false });
    driver.seed('loner', { id: 'l1', name: 'x' });
    driver.seed('loner', { id: 'l2', name: 'y' });
    seedAccountTree(driver);
    await engine.delete('loner', { where: { id: 'l1' } } as any);
    await engine.delete('loner', { where: { id: 'l2' } } as any);
    await engine.delete('account', { where: { id: 'acc1' } } as any);
    expect(driver.rowsOf('loner')).toHaveLength(0);
    expect(driver.rowsOf('contact')).toHaveLength(0);
    const said = rec.at('info').filter((r) => r.message.includes('sys_recycle_bin is not registered'));
    expect(said).toHaveLength(1);
  });
});

describe('the retention seam (ADR-0148 D3)', () => {
  it("stamps the host resolver's answer, asked with the token the host handed over", async () => {
    const { engine, driver } = await makeEngine();
    const seen: Array<string | undefined> = [];
    engine.setRecycleBinRetention({ resolve: (token) => { seen.push(token); return 7; }, token: 'tok' });
    driver.seed('loner', { id: 'l1', name: 'x' });
    await engine.delete('loner', { where: { id: 'l1' } } as any);
    expect(entriesOf(driver)[0].retention_days).toBe(7);
    expect(seen).toEqual(['tok']);
  });

  it('refuses the delete before any write when the resolver answers a defect', async () => {
    const { engine, driver } = await makeEngine();
    engine.setRecycleBinRetention({ resolve: () => 0 });
    seedAccountTree(driver);
    await expect(engine.delete('account', { where: { id: 'acc1' } } as any))
      .rejects.toThrow(recycleBinRetentionRefusal('resolver', 0));
    expect(driver.rowsOf('account')).toHaveLength(1);
    expect(driver.rowsOf('contact')).toHaveLength(2);
    expect(entriesOf(driver)).toHaveLength(0);
  });
});

describe('a failed delete leaves no entry', () => {
  it('rolls the entry back with the transaction', async () => {
    const { engine, driver } = await makeEngine({ failDeleteOf: 'account' });
    seedAccountTree(driver);
    await expect(engine.delete('account', { where: { id: 'acc1' } } as any)).rejects.toThrow(/driver refused/);
    expect(entriesOf(driver)).toHaveLength(0);
    expect(driver.rowsOf('contact')).toHaveLength(2);
  });

  it('removes the entry itself when no transaction covered it', async () => {
    const { engine, driver } = await makeEngine({ failDeleteOf: 'loner', transactional: false });
    driver.seed('loner', { id: 'l1', name: 'x' });
    await expect(engine.delete('loner', { where: { id: 'l1' } } as any)).rejects.toThrow(/driver refused/);
    expect(driver.rowsOf('loner')).toHaveLength(1);
    expect(entriesOf(driver)).toHaveLength(0);
    // The entry was written, then compensated: not merely never written.
    expect(driver.writes.filter((w: any) => w.object === 'sys_recycle_bin').map((w: any) => w.op))
      .toEqual(['create', 'delete']);
  });
});

describe('the TTL sweep reaps an entry once its stamped deadline has passed (D3)', () => {
  it('reaps due entries and keeps the rest, asking no resolver', async () => {
    const { engine, driver } = await makeEngine();
    driver.seed('sys_recycle_bin', { id: 'due', purge_after: '2026-11-01T00:00:00.000Z' });
    driver.seed('sys_recycle_bin', { id: 'kept', purge_after: '2026-12-01T00:00:00.000Z' });
    let asked = 0;
    engine.setRecycleBinRetention({ resolve: () => { asked += 1; return 1; } });
    const lifecycle = new LifecycleService({
      getEngine: () => engine as any,
      logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as any,
      now: () => Date.parse('2026-11-06T00:00:00.000Z'),
      initialDelayMs: 1,
      sweepIntervalMs: 10,
    });
    const report = await lifecycle.sweep();
    expect(report.errors).toEqual([]);
    expect(entriesOf(driver).map((e) => e.id)).toEqual(['kept']);
    expect(asked).toBe(0);
  });
});

describe('cascadeMembersInOrder', () => {
  it('lists the root first, then breadth-first along the cascading edges, then any member no edge reached', () => {
    const set: CascadeDeleteSet = {
      members: new Map([
        ['a', new Set(['1'])],
        ['b', new Set(['2', '3'])],
        ['c', new Set(['4'])],
        ['d', new Set(['5'])],
      ]),
      entered: new Map(),
      elevationsFiled: new Set(),
      cascadeEdges: new Map([
        [cascadeMemberKey('a', '1'), [{ object: 'b', id: '2' }, { object: 'b', id: '3' }]],
        [cascadeMemberKey('b', '2'), [{ object: 'c', id: '4' }]],
        [cascadeMemberKey('b', '3'), [{ object: 'c', id: '4' }]],
      ]),
      cleared: new Map(),
    };
    expect(cascadeMembersInOrder(set, { object: 'a', id: '1' }).map((m) => `${m.object}/${m.id}`))
      .toEqual(['a/1', 'b/2', 'b/3', 'c/4', 'd/5']);
  });
});
