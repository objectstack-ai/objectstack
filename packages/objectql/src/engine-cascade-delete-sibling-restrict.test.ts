// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22305] A record the cascade itself deletes never refuses a delete of
 * another record the same cascade deletes.
 *
 * ## The defect
 *
 * `ObjectQL.cascadeDeleteRelations` walks the registry in registration order
 * and recurses depth-first through the public `delete()`. Each recursion
 * evaluates its own `restrict` refusals with no knowledge of the cascade that
 * called it. In the measured shape (objectstack-ai/hotcrm's account delete),
 * an account cascades to its contacts and to its contracts, and a contract
 * holds a REQUIRED lookup to a contact, whose defaulted `set_null` escalates
 * to `restrict`. When the contacts sort first, deleting a contact refuses with
 * `DELETE_RESTRICTED` naming the contract, a record the same account delete
 * was about to remove. When the contracts sort first, the identical delete
 * succeeds. So the answer depended on registration order.
 *
 * ## The rule (triage ruling on #22305)
 *
 * A child that is itself in the cascade set never restricts a sibling in the
 * same set. The engine now collects the set first (every record the cascade
 * deletes, transitively, the root included) and judges `restrict`, and the
 * `set_null` write, only against records outside it.
 *
 * ## What is pinned here, and the controls that keep it honest
 *
 *  - the measured shape deletes in BOTH registration orders, and every member
 *    of the set is gone;
 *  - a restrict raised by a record OUTSIDE the set still refuses with the
 *    ADR-0112 envelope (`code` + `status`), names the dependent object, and the
 *    whole delete rolls back — escalated and authored both;
 *  - a `set_null` on an outside record still clears; one on a record the
 *    cascade deletes issues no write at all;
 *  - every deleted record fires `beforeDelete` and `afterDelete` exactly once;
 *  - the elevation ledger (#12166) files one record per referenced object per
 *    deleted record, as before, never two;
 *  - a cycle in the data terminates.
 *
 * The driver has REAL snapshot rollback (the `engine-cascade-delete-atomic`
 * shape): a stub whose rollback is a no-op cannot tell "refused and rolled
 * back" from "refused halfway", so the refusal controls would pass vacuously.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

type Row = Record<string, unknown>;
type Write = { object: string; op: 'create' | 'update' | 'delete'; id: string };
type Logged = { level: 'debug' | 'info' | 'warn' | 'error'; message: string; meta: unknown };

function makeDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string): Map<string, Row> => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const writes: Write[] = [];
  const committed: unknown[] = [];
  const rolledBack: unknown[] = [];
  const snapshots = new Map<unknown, Map<string, Map<string, Row>>>();
  let nextId = 0;
  const matches = (row: Row, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Row)) {
      if (k.startsWith('$')) continue;
      const exp = v && typeof v === 'object' && '$eq' in (v as Row) ? (v as Row).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'primary', version: '0.0.0', supports: {},
    writes, committed, rolledBack,
    rowsOf: (o: string): Row[] => Array.from(storeFor(o).values()),
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: { where?: unknown; limit?: unknown } | undefined) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(o: string, ast: { where?: unknown } | undefined) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(o: string, data: Row) {
      nextId += 1;
      const id = (data.id as string | undefined) ?? `r_${nextId}`;
      const row = { ...data, id };
      writes.push({ object: o, op: 'create', id });
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Row) {
      writes.push({ object: o, op: 'update', id: String(id) });
      const s = storeFor(o);
      const cur = s.get(String(id));
      if (!cur) throw new Error(`not found ${o}/${id}`);
      const up = { ...cur, ...data, id };
      s.set(String(id), up);
      return up;
    },
    async upsert(o: string, data: Row) {
      const id = data.id as string | undefined;
      return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data);
    },
    async delete(o: string, id: string) {
      writes.push({ object: o, op: 'delete', id: String(id) });
      return storeFor(o).delete(String(id));
    },
    async count(o: string, ast: { where?: unknown } | undefined) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() {
      const handle = { __trx: snapshots.size + committed.length + rolledBack.length + 1 };
      const snap = new Map<string, Map<string, Row>>();
      for (const [o, s] of stores) snap.set(o, new Map(Array.from(s, ([k, v]) => [k, { ...v }])));
      snapshots.set(handle, snap);
      return handle;
    },
    async commit(handle: unknown) { snapshots.delete(handle); committed.push(handle); },
    async rollback(handle: unknown) {
      const snap = snapshots.get(handle);
      if (snap) { stores.clear(); for (const [o, s] of snap) stores.set(o, s); }
      snapshots.delete(handle);
      rolledBack.push(handle);
    },
  };
  return driver;
}

async function makeEngine(objects: unknown[]) {
  const logged: Logged[] = [];
  const push = (level: Logged['level']) => (message: string, meta?: unknown) =>
    void logged.push({ level, message: String(message), meta });
  const engine = new ObjectQL({
    logger: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
  } as any);
  const driver = makeDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o as any, '__test__');
  return { engine, driver, logged };
}

const id = { name: 'id', type: 'text' as const, primaryKey: true };
const name = { name: 'name', type: 'text' as const };

// ── The measured shape (hotcrm's account / contact / contract) ──────────────

const account = { name: 'zz_account', label: 'Account', fields: { id, name } };
const contact = {
  name: 'zz_contact',
  label: 'Contact',
  fields: { id, name, account: { name: 'account', type: 'master_detail' as const, reference: 'zz_account' } },
};
/** Cascades from the account AND holds a required lookup to a sibling (default `set_null` escalates). */
const contract = {
  name: 'zz_contract',
  label: 'Contract',
  fields: {
    id, name,
    account: { name: 'account', type: 'master_detail' as const, reference: 'zz_account' },
    primary_contact: { name: 'primary_contact', type: 'lookup' as const, reference: 'zz_contact', required: true },
  },
};

/** Both registration orders. The defect answered differently for each. */
const ORDERS: Array<[string, unknown[]]> = [
  ['contacts registered first', [account, contact, contract]],
  ['contracts registered first', [account, contract, contact]],
];

async function seedAccount(engine: ObjectQL) {
  const acc = await engine.insert('zz_account', { name: 'Acme' });
  const c1 = await engine.insert('zz_contact', { name: 'c1', account: acc.id });
  const c2 = await engine.insert('zz_contact', { name: 'c2', account: acc.id });
  const k1 = await engine.insert('zz_contract', { name: 'k1', account: acc.id, primary_contact: c1.id });
  const k2 = await engine.insert('zz_contract', { name: 'k2', account: acc.id, primary_contact: c1.id });
  const k3 = await engine.insert('zz_contract', { name: 'k3', account: acc.id, primary_contact: c2.id });
  return { acc, contacts: [c1, c2], contracts: [k1, k2, k3] };
}

describe('[#22305] a sibling in the cascade set never restricts another member', () => {
  describe.each(ORDERS)('%s', (_label, objects) => {
    it('deletes the account and every member of its cascade', async () => {
      const { engine, driver } = await makeEngine(objects);
      const { acc } = await seedAccount(engine);

      await engine.delete('zz_account', { where: { id: acc.id } } as any);

      expect(driver.rowsOf('zz_account')).toHaveLength(0);
      expect(driver.rowsOf('zz_contact')).toHaveLength(0);
      expect(driver.rowsOf('zz_contract')).toHaveLength(0);
      expect(driver.committed).toHaveLength(1);
      expect(driver.rolledBack).toHaveLength(0);
    });

    it('fires beforeDelete and afterDelete exactly once per deleted record', async () => {
      const { engine } = await makeEngine(objects);
      const { acc, contacts, contracts } = await seedAccount(engine);
      const fired: string[] = [];
      for (const event of ['beforeDelete', 'afterDelete'] as const) {
        engine.registerHook(event, async (ctx: any) => void fired.push(`${event}:${ctx.object}:${ctx.input?.id}`));
      }

      await engine.delete('zz_account', { where: { id: acc.id } } as any);

      const expected = [
        `zz_account:${acc.id}`,
        ...contacts.map((c) => `zz_contact:${c.id}`),
        ...contracts.map((k) => `zz_contract:${k.id}`),
      ];
      for (const event of ['beforeDelete', 'afterDelete']) {
        const got = fired.filter((f) => f.startsWith(`${event}:`)).map((f) => f.slice(event.length + 1));
        expect(got.slice().sort()).toEqual(expected.slice().sort());
      }
    });

    it('files one elevation record per referenced object per deleted record, never two (#12166)', async () => {
      const { engine, logged } = await makeEngine(objects);
      const { acc, contacts } = await seedAccount(engine);
      logged.length = 0;

      await engine.delete('zz_account', { where: { id: acc.id } } as any);

      const keys = logged
        .filter((l) => l.level === 'info' && l.message.startsWith('[reference-cleanup] referential integrity check'))
        .map((l) => {
          const m = l.meta as { object: string; recordId: string; referencedObject: string };
          return `${m.object}/${m.recordId}/${m.referencedObject}`;
        });
      // The account is referenced by both children; each contact by the
      // contracts; nothing references a contract.
      const expected = [
        `zz_account/${acc.id}/zz_contact`,
        `zz_account/${acc.id}/zz_contract`,
        ...contacts.map((c) => `zz_contact/${c.id}/zz_contract`),
      ];
      expect(keys.slice().sort()).toEqual(expected.slice().sort());
    });
  });
});

// ── Controls: a record OUTSIDE the cascade still refuses ────────────────────

/** Not related to the account at all; a REQUIRED lookup to a contact. */
const invoice = {
  name: 'zz_invoice',
  label: 'Invoice',
  fields: { id, bill_to: { name: 'bill_to', type: 'lookup' as const, reference: 'zz_contact', required: true } },
};
/** Not related to the account; an AUTHORED restrict to a contact. */
const ticket = {
  name: 'zz_ticket',
  label: 'Ticket',
  fields: { id, raised_by: { name: 'raised_by', type: 'lookup' as const, reference: 'zz_contact', deleteBehavior: 'restrict' } },
};
/** Not related to the account; an OPTIONAL lookup to a contact (`set_null`). */
const lead = {
  name: 'zz_lead',
  label: 'Lead',
  fields: { id, referred_by: { name: 'referred_by', type: 'lookup' as const, reference: 'zz_contact' } },
};

describe('[#22305] controls: a restrict from outside the cascade set still refuses', () => {
  describe.each(ORDERS)('%s', (_label, objects) => {
    it('refuses on an outside REQUIRED lookup to a member, names it, and rolls the whole delete back', async () => {
      const { engine, driver } = await makeEngine([...objects, invoice]);
      const { acc, contacts } = await seedAccount(engine);
      await engine.insert('zz_invoice', { bill_to: contacts[1].id });

      const err = await engine.delete('zz_account', { where: { id: acc.id } } as any).catch((e: unknown) => e);

      expect(err).toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'zz_invoice', dependentCount: 1 });
      expect(driver.rowsOf('zz_account')).toHaveLength(1);
      expect(driver.rowsOf('zz_contact')).toHaveLength(2);
      expect(driver.rowsOf('zz_contract')).toHaveLength(3);
      expect(driver.rowsOf('zz_invoice')).toHaveLength(1);
      expect(driver.rolledBack).toHaveLength(1);
    });

    it('refuses on an outside AUTHORED restrict to a member', async () => {
      const { engine, driver } = await makeEngine([...objects, ticket]);
      const { acc, contacts } = await seedAccount(engine);
      await engine.insert('zz_ticket', { raised_by: contacts[0].id });

      const err = await engine.delete('zz_account', { where: { id: acc.id } } as any).catch((e: unknown) => e);

      expect(err).toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'zz_ticket' });
      expect(driver.rowsOf('zz_contact')).toHaveLength(2);
    });

    it('still clears an outside optional lookup to a member (set_null)', async () => {
      const { engine, driver } = await makeEngine([...objects, lead]);
      const { acc, contacts } = await seedAccount(engine);
      const l = await engine.insert('zz_lead', { referred_by: contacts[0].id });

      await engine.delete('zz_account', { where: { id: acc.id } } as any);

      expect(driver.rowsOf('zz_contact')).toHaveLength(0);
      const kept = driver.rowsOf('zz_lead').find((r: Row) => r.id === l.id);
      expect(kept).toBeDefined();
      expect(kept?.referred_by).toBeNull();
    });
  });
});

// ── set_null and authored restrict INSIDE the set ───────────────────────────

/** Cascades from the account; an OPTIONAL lookup to a contact (`set_null`). */
const memo = {
  name: 'zz_memo',
  label: 'Memo',
  fields: {
    id,
    account: { name: 'account', type: 'master_detail' as const, reference: 'zz_account' },
    about: { name: 'about', type: 'lookup' as const, reference: 'zz_contact' },
  },
};
/** Cascades from the account; an AUTHORED restrict to a contact. */
const quote = {
  name: 'zz_quote',
  label: 'Quote',
  fields: {
    id,
    account: { name: 'account', type: 'master_detail' as const, reference: 'zz_account' },
    owner_contact: { name: 'owner_contact', type: 'lookup' as const, reference: 'zz_contact', deleteBehavior: 'restrict' },
  },
};
/**
 * Cascades from the account, and ALSO holds a required lookup to the account
 * itself, declared ahead of the master-detail field: the root is a member of
 * its own cascade set.
 */
const ledger = {
  name: 'zz_ledger',
  label: 'Ledger',
  fields: {
    id,
    billed_account: { name: 'billed_account', type: 'lookup' as const, reference: 'zz_account', required: true },
    account: { name: 'account', type: 'master_detail' as const, reference: 'zz_account' },
  },
};

describe('[#22305] relations between members of the set', () => {
  it.each([
    ['contacts registered first', [account, contact, memo]],
    ['memos registered first', [account, memo, contact]],
  ] as Array<[string, unknown[]]>)('issues no set_null write against a member the cascade deletes (%s)', async (_l, objects) => {
    const { engine, driver } = await makeEngine(objects);
    const acc = await engine.insert('zz_account', { name: 'Acme' });
    const c = await engine.insert('zz_contact', { name: 'c', account: acc.id });
    await engine.insert('zz_memo', { account: acc.id, about: c.id });
    driver.writes.length = 0;

    await engine.delete('zz_account', { where: { id: acc.id } } as any);

    expect(driver.rowsOf('zz_memo')).toHaveLength(0);
    expect(driver.writes.filter((w: Write) => w.op === 'update')).toEqual([]);
  });

  it.each([
    ['contacts registered first', [account, contact, quote]],
    ['quotes registered first', [account, quote, contact]],
  ] as Array<[string, unknown[]]>)('an AUTHORED restrict between two members does not refuse (%s)', async (_l, objects) => {
    const { engine, driver } = await makeEngine(objects);
    const acc = await engine.insert('zz_account', { name: 'Acme' });
    const c = await engine.insert('zz_contact', { name: 'c', account: acc.id });
    await engine.insert('zz_quote', { account: acc.id, owner_contact: c.id });

    await engine.delete('zz_account', { where: { id: acc.id } } as any);

    expect(driver.rowsOf('zz_contact')).toHaveLength(0);
    expect(driver.rowsOf('zz_quote')).toHaveLength(0);
  });

  it('a member holding a required lookup to the ROOT does not refuse the root', async () => {
    const { engine, driver } = await makeEngine([account, ledger]);
    const acc = await engine.insert('zz_account', { name: 'Acme' });
    await engine.insert('zz_ledger', { account: acc.id, billed_account: acc.id });

    await engine.delete('zz_account', { where: { id: acc.id } } as any);

    expect(driver.rowsOf('zz_account')).toHaveLength(0);
    expect(driver.rowsOf('zz_ledger')).toHaveLength(0);
  });

  it('control: the same required lookup from a record OUTSIDE the set still refuses the root', async () => {
    const { engine, driver } = await makeEngine([account, ledger]);
    const acc = await engine.insert('zz_account', { name: 'Acme' });
    const other = await engine.insert('zz_account', { name: 'Other' });
    // Cascades from `other`, so it is outside `acc`'s set — and bills `acc`.
    await engine.insert('zz_ledger', { account: other.id, billed_account: acc.id });

    await expect(engine.delete('zz_account', { where: { id: acc.id } } as any))
      .rejects.toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'zz_ledger' });
    expect(driver.rowsOf('zz_account')).toHaveLength(2);
  });
});

// ── Cycles ──────────────────────────────────────────────────────────────────

/** A self-referencing cascade. */
const node = {
  name: 'zz_node',
  label: 'Node',
  fields: { id, name, parent: { name: 'parent', type: 'lookup' as const, reference: 'zz_node', deleteBehavior: 'cascade' } },
};
/** Two objects that cascade into each other. */
const ringA = {
  name: 'zz_ring_a',
  label: 'Ring A',
  fields: { id, b: { name: 'b', type: 'lookup' as const, reference: 'zz_ring_b', deleteBehavior: 'cascade' } },
};
const ringB = {
  name: 'zz_ring_b',
  label: 'Ring B',
  fields: { id, a: { name: 'a', type: 'lookup' as const, reference: 'zz_ring_a', deleteBehavior: 'cascade' } },
};
/** A tree under the account: an item cascades from the account AND from its parent item. */
const item = {
  name: 'zz_item',
  label: 'Item',
  fields: {
    id, name,
    account: { name: 'account', type: 'master_detail' as const, reference: 'zz_account' },
    parent: { name: 'parent', type: 'lookup' as const, reference: 'zz_item', deleteBehavior: 'cascade' },
  },
};

/**
 * A runaway walk does not overflow the stack — every level awaits — so an
 * unbounded cascade would hang until the test timeout. This guard turns it
 * into a fast, named failure.
 */
function guardRunaway(engine: ObjectQL, limit = 50) {
  let calls = 0;
  engine.registerHook('beforeDelete', async () => {
    calls += 1;
    if (calls > limit) throw new Error(`runaway cascade: more than ${limit} beforeDelete dispatches`);
  });
}

describe('[#22305] a cycle in the data terminates', () => {
  it('a self-referencing cascade whose rows point at each other', async () => {
    const { engine, driver } = await makeEngine([node]);
    guardRunaway(engine);
    const n1 = await engine.insert('zz_node', { name: 'n1' });
    const n2 = await engine.insert('zz_node', { name: 'n2', parent: n1.id });
    await engine.update('zz_node', { id: n1.id, parent: n2.id } as any);

    await engine.delete('zz_node', { where: { id: n1.id } } as any);

    expect(driver.rowsOf('zz_node')).toHaveLength(0);
  });

  it('two objects that cascade into each other', async () => {
    const { engine, driver } = await makeEngine([ringA, ringB]);
    guardRunaway(engine);
    const a = await engine.insert('zz_ring_a', {});
    const b = await engine.insert('zz_ring_b', { a: a.id });
    await engine.update('zz_ring_a', { id: a.id, b: b.id } as any);

    await engine.delete('zz_ring_a', { where: { id: a.id } } as any);

    expect(driver.rowsOf('zz_ring_a')).toHaveLength(0);
    expect(driver.rowsOf('zz_ring_b')).toHaveLength(0);
  });

  it('a tree reached twice — from the account and from its parent item — deletes each row once', async () => {
    const { engine, driver } = await makeEngine([account, item]);
    guardRunaway(engine);
    const acc = await engine.insert('zz_account', { name: 'Acme' });
    const i1 = await engine.insert('zz_item', { name: 'i1', account: acc.id });
    await engine.insert('zz_item', { name: 'i2', account: acc.id, parent: i1.id });
    driver.writes.length = 0;

    await engine.delete('zz_account', { where: { id: acc.id } } as any);

    expect(driver.rowsOf('zz_item')).toHaveLength(0);
    expect(driver.writes.filter((w: Write) => w.op === 'delete' && w.object === 'zz_item')).toHaveLength(2);
  });
});
