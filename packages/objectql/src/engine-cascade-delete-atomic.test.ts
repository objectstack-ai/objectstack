// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ObjectQL.delete`'s by-id cascade is ONE unit of work (#7413).
 *
 * The defect: `delete()`'s by-id branch ran `cascadeDeleteRelations` and then
 * `driver.delete` with no transaction around either, and the cascade re-enters
 * `this.delete()` / `this.update()` per dependent — each committing as it
 * executed. A refusal partway (the engine's own `restrict` branch, a child's
 * permission check, a later child's `beforeDelete` hook) left an arbitrary
 * PREFIX of the children deleted while the caller received 409/403 and
 * reasonably read it as "nothing happened". Child visit order is
 * `getAllObjects()` order, so *which* prefix was gone was arbitrary from the
 * caller's point of view.
 *
 * The governing principle is #4620's changeset, ruled for the batch path:
 * *`atomic` — honoured for real, or refused… a partial delete has no natural
 * undo.* These pins are that principle for the single-id path.
 *
 * The driver below has REAL rollback (a deep snapshot per transaction, the same
 * shape `driver-memory` uses), because a stub whose `rollback()` is a no-op
 * cannot tell "wrapped in a transaction" from "not wrapped" — every assertion
 * about restored rows would pass against the unfixed engine.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

type Recorded = { level: 'debug' | 'info' | 'warn' | 'error'; message: string };

function recordingLogger() {
  const records: Recorded[] = [];
  const push = (level: Recorded['level']) => (message: string) =>
    void records.push({ level, message: String(message) });
  return {
    records,
    logger: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
    at(level: Recorded['level']) {
      return records.filter((r) => r.level === level);
    },
  };
}

/**
 * A driver with snapshot rollback and a full write/transaction ledger.
 *
 * `transactional: false` omits `beginTransaction` entirely — the shape the
 * declared degrade (ADR-0119 D1) exists for. Every in-tree driver implements
 * it; test doubles and foreign engines are what reach that path.
 */
function makeDriver(opts: { transactional?: boolean } = {}) {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  /** Every driver-level write, with the transaction handle it carried. */
  const writes: Array<{ object: string; op: 'create' | 'update' | 'delete'; transaction: unknown }> = [];
  /** One entry per `beginTransaction` — the ambient-join measurement. */
  const begun: unknown[] = [];
  const committed: unknown[] = [];
  const rolledBack: unknown[] = [];
  const snapshots = new Map<unknown, Map<string, Map<string, Record<string, unknown>>>>();
  let nextId = 0;

  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
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
    begun,
    committed,
    rolledBack,
    rowsOf: (o: string) => Array.from(storeFor(o).values()),
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: any) {
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(o: string, ast: any) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(o: string, data: Record<string, unknown>, options: any) {
      writes.push({ object: o, op: 'create', transaction: options?.transaction });
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>, options: any) {
      writes.push({ object: o, op: 'update', transaction: options?.transaction });
      const s = storeFor(o);
      const cur = s.get(String(id));
      if (!cur) throw new Error(`not found ${o}/${id}`);
      const up = { ...cur, ...data, id };
      s.set(String(id), up);
      return up;
    },
    async upsert(o: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && storeFor(o).has(id) ? this.update(o, id, data, undefined) : this.create(o, data, undefined);
    },
    async delete(o: string, id: string, options: any) {
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
    async bulkCreate(o: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(o, r, undefined)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
  };

  if (opts.transactional !== false) {
    driver.beginTransaction = async () => {
      const handle = { __trx: begun.length + 1 };
      const snap = new Map<string, Map<string, Record<string, unknown>>>();
      for (const [o, s] of stores) {
        snap.set(o, new Map(Array.from(s, ([k, v]) => [k, { ...v }])));
      }
      snapshots.set(handle, snap);
      begun.push(handle);
      return handle;
    };
    driver.commit = async (handle: unknown) => {
      snapshots.delete(handle);
      committed.push(handle);
    };
    driver.rollback = async (handle: unknown) => {
      const snap = snapshots.get(handle);
      if (snap) {
        stores.clear();
        for (const [o, s] of snap) stores.set(o, s);
      }
      snapshots.delete(handle);
      rolledBack.push(handle);
    };
  }
  return driver;
}

/** parent ← 3 cascade children (`kid`) + 1 `set_null` child (`link`). */
const parent = {
  name: 'parent',
  label: 'Parent',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
  },
};
const kid = {
  name: 'kid',
  label: 'Kid',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    parent: { name: 'parent', type: 'lookup' as const, reference: 'parent', deleteBehavior: 'cascade' },
  },
};
const link = {
  name: 'link',
  label: 'Link',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    parent: { name: 'parent', type: 'lookup' as const, reference: 'parent' },
  },
};
/**
 * The engine's OWN refusal source, needing no app code: a REQUIRED lookup whose
 * defaulted `set_null` escalates to `restrict` (see `cascadeDeleteRelations`).
 * The issue names this as the variant reachable with nothing outside
 * `packages/objectql`.
 */
const blocker = {
  name: 'zz_blocker',
  label: 'Blocker',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    parent: { name: 'parent', type: 'lookup' as const, reference: 'parent', required: true },
  },
};
/** Second cascade level: `grandkid` hangs off `kid`. */
const grandkid = {
  name: 'grandkid',
  label: 'Grandkid',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    kid: { name: 'kid', type: 'lookup' as const, reference: 'kid', deleteBehavior: 'cascade' },
  },
};
/** No relation points at it — the control for "plain non-cascade delete". */
const loner = {
  name: 'loner',
  label: 'Loner',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
  },
};

async function makeEngine(
  objects: any[],
  opts: { transactional?: boolean } = {},
) {
  const rec = recordingLogger();
  const engine = new ObjectQL({ logger: rec.logger } as any);
  const driver = makeDriver(opts);
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o, '__test__');
  return { engine, driver, rec };
}

// ---------------------------------------------------------------------------
// 1. The card's repro, inverted: a mid-cascade refusal deletes ZERO children.
// ---------------------------------------------------------------------------

describe('a refusal mid-cascade rolls the whole delete back (#7413)', () => {
  it('leaves ZERO children deleted when the engine\'s own restrict branch refuses', async () => {
    // `zz_blocker` sorts last, so the cascade reaches `kid` FIRST and deletes
    // all three rows before the restrict refusal lands — the exact ordering
    // that made the defect observable.
    const { engine, driver } = await makeEngine([parent, kid, blocker]);
    const p = await engine.insert('parent', { name: 'P' });
    for (const n of ['a', 'b', 'c']) await engine.insert('kid', { name: n, parent: p.id });
    await engine.insert('zz_blocker', { parent: p.id });

    await expect(engine.delete('parent', { where: { id: p.id } } as any))
      .rejects.toMatchObject({ code: 'DELETE_RESTRICTED', status: 409 });

    // THE core assertion. Before this card: 0. The 409 now honestly means
    // "nothing changed".
    expect(driver.rowsOf('kid')).toHaveLength(3);
    expect(driver.rowsOf('parent')).toHaveLength(1);
    expect(driver.rolledBack).toHaveLength(1);
    expect(driver.committed).toHaveLength(0);
  });

  it('leaves ZERO children deleted when a later child\'s beforeDelete hook refuses', async () => {
    // The card's MEASURED variant: an app hook, not the engine's own branch.
    const { engine, driver } = await makeEngine([parent, kid, grandkid]);
    engine.registerHook(
      'beforeDelete',
      async () => {
        throw Object.assign(new Error('nope'), { status: 409 });
      },
      { object: 'grandkid' },
    );

    const p = await engine.insert('parent', { name: 'P' });
    const k1 = await engine.insert('kid', { name: 'k1', parent: p.id });
    const k2 = await engine.insert('kid', { name: 'k2', parent: p.id });
    await engine.insert('grandkid', { kid: k2.id });

    await expect(engine.delete('parent', { where: { id: p.id } } as any)).rejects.toThrow();

    // k1 was already cascaded away before the hook on k2's grandchild threw.
    expect(driver.rowsOf('kid').map((r: any) => r.id).sort()).toEqual([k1.id, k2.id].sort());
    expect(driver.rowsOf('grandkid')).toHaveLength(1);
    expect(driver.rowsOf('parent')).toHaveLength(1);
    expect(driver.rolledBack).toHaveLength(1);
  });

  it('restores set_null children too — the FK is not left cleared', async () => {
    const { engine, driver } = await makeEngine([parent, link, blocker]);
    const p = await engine.insert('parent', { name: 'P' });
    const l = await engine.insert('link', { parent: p.id });
    await engine.insert('zz_blocker', { parent: p.id });

    await expect(engine.delete('parent', { where: { id: p.id } } as any))
      .rejects.toMatchObject({ code: 'DELETE_RESTRICTED' });

    // `link.parent` was nulled mid-cascade; the rollback puts it back. Without
    // it the child survives pointing at nothing, which is the same silent
    // corruption one field over.
    const restored = driver.rowsOf('link').find((r: any) => r.id === l.id);
    expect(restored?.parent).toBe(p.id);
  });

  it('is all-or-nothing across MULTIPLE cascade levels', async () => {
    const { engine, driver } = await makeEngine([parent, kid, grandkid, blocker]);
    const p = await engine.insert('parent', { name: 'P' });
    const k = await engine.insert('kid', { name: 'k', parent: p.id });
    await engine.insert('grandkid', { kid: k.id });
    await engine.insert('grandkid', { kid: k.id });
    await engine.insert('zz_blocker', { parent: p.id });

    await expect(engine.delete('parent', { where: { id: p.id } } as any))
      .rejects.toMatchObject({ code: 'DELETE_RESTRICTED' });

    expect(driver.rowsOf('grandkid')).toHaveLength(2);
    expect(driver.rowsOf('kid')).toHaveLength(1);
    expect(driver.rowsOf('parent')).toHaveLength(1);
  });

  it('commits the whole cascade when nothing refuses', async () => {
    const { engine, driver } = await makeEngine([parent, kid, grandkid, link]);
    const p = await engine.insert('parent', { name: 'P' });
    const k = await engine.insert('kid', { name: 'k', parent: p.id });
    await engine.insert('grandkid', { kid: k.id });
    const l = await engine.insert('link', { parent: p.id });

    await engine.delete('parent', { where: { id: p.id } } as any);

    expect(driver.rowsOf('parent')).toHaveLength(0);
    expect(driver.rowsOf('kid')).toHaveLength(0);
    expect(driver.rowsOf('grandkid')).toHaveLength(0);
    expect(driver.rowsOf('link').find((r: any) => r.id === l.id)?.parent).toBeNull();
    expect(driver.committed).toHaveLength(1);
    expect(driver.rolledBack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Ambient join (ADR-0067 D2 / #5696) — measured, not assumed.
// ---------------------------------------------------------------------------

describe('the recursive cascade JOINS the ambient transaction (#5696)', () => {
  it('opens exactly ONE driver transaction for a multi-level cascade', async () => {
    const { engine, driver } = await makeEngine([parent, kid, grandkid, link]);
    const p = await engine.insert('parent', { name: 'P' });
    const k1 = await engine.insert('kid', { name: 'k1', parent: p.id });
    const k2 = await engine.insert('kid', { name: 'k2', parent: p.id });
    await engine.insert('grandkid', { kid: k1.id });
    await engine.insert('grandkid', { kid: k2.id });
    await engine.insert('link', { parent: p.id });

    await engine.delete('parent', { where: { id: p.id } } as any);

    // Each child `delete()` re-enters the wrap. If the join were not honoured
    // this would be one `beginTransaction` per cascaded record — a second
    // connection per level (the deadlock ADR-0067 D2 exists to avoid), and
    // nested handles the outer rollback would not cover.
    expect(driver.begun).toHaveLength(1);
    expect(driver.committed).toHaveLength(1);
  });

  it('routes every cascade write onto that ONE transaction handle', async () => {
    const { engine, driver } = await makeEngine([parent, kid, grandkid, link]);
    const p = await engine.insert('parent', { name: 'P' });
    const k = await engine.insert('kid', { name: 'k', parent: p.id });
    await engine.insert('grandkid', { kid: k.id });
    await engine.insert('link', { parent: p.id });
    driver.writes.length = 0;

    await engine.delete('parent', { where: { id: p.id } } as any);

    // Asserted before the loop below, which would otherwise pass VACUOUSLY
    // against an unwrapped engine: no transaction means `handle` is
    // `undefined` and every write's `transaction` is `undefined` too.
    expect(driver.begun).toHaveLength(1);
    const handle = driver.begun[0];
    expect(handle).toBeDefined();
    expect(driver.writes.length).toBeGreaterThan(0);
    // Including the PARENT's own `driver.delete`, whose options are rebuilt
    // inside the callback precisely so it does not execute outside the
    // transaction that wraps its cascade.
    for (const w of driver.writes) expect(w.transaction).toBe(handle);
    expect(driver.writes.some((w: any) => w.object === 'parent' && w.op === 'delete')).toBe(true);
    expect(driver.writes.some((w: any) => w.object === 'link' && w.op === 'update')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Control: a delete with nothing referencing it is byte-identical.
// ---------------------------------------------------------------------------

describe('a plain non-cascade delete is unchanged (#7413 control)', () => {
  it('opens NO transaction and emits no warning when no relation points at the object', async () => {
    const { engine, driver, rec } = await makeEngine([loner]);
    const l = await engine.insert('loner', { name: 'solo' });
    driver.writes.length = 0;

    await engine.delete('loner', { where: { id: l.id } } as any);

    expect(driver.begun).toHaveLength(0);
    expect(driver.rowsOf('loner')).toHaveLength(0);
    // The one driver write still carries no transaction handle, exactly as
    // before this card.
    expect(driver.writes).toHaveLength(1);
    expect(driver.writes[0].transaction).toBeUndefined();
    expect(rec.at('warn')).toHaveLength(0);
  });

  it('opens no transaction when the object HAS dependents declared but the delete is by predicate', async () => {
    // The predicate branch never called `cascadeDeleteRelations` and still does
    // not — the wrap is the by-id branch's alone.
    const { engine, driver } = await makeEngine([parent, kid]);
    await engine.insert('parent', { name: 'P' });
    driver.writes.length = 0;

    await engine.delete('parent', { where: { name: 'P' }, multi: true } as any);

    expect(driver.begun).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. The transactionless runtime — the DEGRADE was chosen over `require: true`.
// ---------------------------------------------------------------------------

describe('a driver without beginTransaction degrades, it does not refuse (#4619 / ADR-0119 D1)', () => {
  it('still performs the delete instead of throwing TransactionUnsupportedError', async () => {
    const { engine, driver } = await makeEngine([parent, kid], { transactional: false });
    const p = await engine.insert('parent', { name: 'P' });
    await engine.insert('kid', { name: 'k', parent: p.id });

    // `delete()` never asked for atomicity, so it must not START refusing on a
    // runtime that cannot roll back. `require: true` would have made this line
    // throw — the losing option's cost, pinned so a later edit has to argue it.
    await engine.delete('parent', { where: { id: p.id } } as any);

    expect(driver.rowsOf('parent')).toHaveLength(0);
    expect(driver.rowsOf('kid')).toHaveLength(0);
  });

  it('warns ONCE per driver that the cascade is running without rollback', async () => {
    const { engine, rec } = await makeEngine([parent, kid], { transactional: false });
    const p1 = await engine.insert('parent', { name: 'P1' });
    await engine.insert('kid', { name: 'k1', parent: p1.id });
    const p2 = await engine.insert('parent', { name: 'P2' });
    await engine.insert('kid', { name: 'k2', parent: p2.id });

    await engine.delete('parent', { where: { id: p1.id } } as any);
    await engine.delete('parent', { where: { id: p2.id } } as any);

    expect(rec.at('warn').filter((r) => r.message.includes('has no beginTransaction'))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Hooks: count and order are NOT silently changed by the wrap.
// ---------------------------------------------------------------------------

describe('hook firing is unchanged by the transaction wrap (#7413)', () => {
  const trace = (engine: ObjectQL, events: string[]) => {
    for (const object of ['parent', 'kid']) {
      for (const event of ['beforeDelete', 'afterDelete'] as const) {
        engine.registerHook(event, async () => void events.push(`${object}:${event}`), { object });
      }
    }
  };

  it('fires the same before/after hooks, in the same order, on SUCCESS', async () => {
    const events: string[] = [];
    const { engine } = await makeEngine([parent, kid]);
    trace(engine, events);
    const p = await engine.insert('parent', { name: 'P' });
    await engine.insert('kid', { name: 'k', parent: p.id });
    events.length = 0;

    await engine.delete('parent', { where: { id: p.id } } as any);

    // The parent's `beforeDelete` runs before the cascade; the child's pair
    // runs inside it; the parent's `afterDelete` closes. Unchanged by the wrap
    // — which is placed INSIDE the parent's hook pair on purpose.
    expect(events).toEqual([
      'parent:beforeDelete',
      'kid:beforeDelete',
      'kid:afterDelete',
      'parent:afterDelete',
    ]);
  });

  it('fires the same hooks on a REFUSAL — the rollback does not un-fire them', async () => {
    const events: string[] = [];
    const { engine } = await makeEngine([parent, kid, blocker]);
    trace(engine, events);
    const p = await engine.insert('parent', { name: 'P' });
    await engine.insert('kid', { name: 'k', parent: p.id });
    await engine.insert('zz_blocker', { parent: p.id });
    events.length = 0;

    await expect(engine.delete('parent', { where: { id: p.id } } as any))
      .rejects.toMatchObject({ code: 'DELETE_RESTRICTED' });

    // DECLARED, not incidental: the cascaded child's `afterDelete` HAS fired
    // for a row the rollback then restored. That is the established shape of
    // every atomic write path in this engine — `runAtomicBatch` (#4620) fires
    // per-row delete hooks inside the same rollback-able scope — and it is the
    // strictly better half of the trade: before this card the hook fired AND
    // the row stayed gone.
    //
    // [#7477] The re-timing question this comment used to leave open ("filed
    // rather than folded in here") has since been RULED, and the answer is the
    // shape asserted below: `after*` fires INSIDE the unit of work, meaning
    // "the write has been requested and will happen unless this unit is
    // undone" — a hook with side effects outside the engine is responsible for
    // tolerating the rollback. So this expectation is no longer the status quo
    // pinned pending a decision; it is the decided contract, and changing it
    // needs the ruling reopened rather than a test update. The author-facing
    // statement lives on `HookEvent` (`@objectstack/spec`'s `data/hook.zod.ts`),
    // on `DISPATCHABLE_HOOK_EVENTS` and `HookHandler` in `engine.ts`, and in
    // `content/docs/automation/hooks.mdx`.
    expect(events).toEqual([
      'parent:beforeDelete',
      'kid:beforeDelete',
      'kid:afterDelete',
    ]);
    expect(events.filter((e) => e === 'parent:afterDelete')).toHaveLength(0);
  });
});
