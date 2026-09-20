// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19264] A `trackHistory`'d `{ type: 'user' }` field with NO `reference` is
 * planned, read and rendered — the spelling the contract calls COMPLETE.
 *
 * ## The defect these cases pin, and why a value assertion alone cannot
 *
 * `audit-writers.ts` admits `user` as a reference type and then read the
 * MATERIALIZED `reference` carrier at four sites: the two read planners
 * (`planTrackedLookupReads`, `planMilestoneTokenReads`) and the two renderers
 * that look the resolved titles back up by the same key
 * (`renderTrackedChangeSummary`, `renderMilestoneSummary`). The contract says
 * the opposite for exactly that type — `IMPLICIT_REFERENCE_TARGETS`
 * (`packages/spec/src/data/field-value.zod.ts`): the target of a `user` field
 * is "a CONSTANT OF THE TYPE, so `reference` on a `user` field materializes
 * that constant; it does not supply it. Metadata authored without it
 * (hand-written JSON, an AI author, a Studio form) is fully specified, not
 * under-specified."
 *
 * The failure was SILENT: no refusal, no diagnostic — the field was simply
 * absent from the read plan, and the timeline showed `usr_1` where every other
 * reference field showed a name. So every case here asserts the READ as well
 * as the rendered string: the read is the half a happy-value assertion cannot
 * see, and it is the half that was never issued at all. Conversely the
 * rendered string is the half a read count cannot see — a plan-only repair
 * pays for the read and still prints the id, because the renderer would look
 * the titles up under a key the plan never used.
 *
 * ## The target is asserted through the arbiter, never as a literal
 *
 * `IMPLICIT_TARGET` below is `referenceTargetOf({ type: 'user' })`, not a
 * hand-copied `'sys_user'`: a second de-facto constant in this package is
 * exactly the drift the one arbiter exists to prevent.
 *
 * ## Narrowness, pinned in both directions
 *
 * Two controls answer "is everything enriched now?" with no: a `lookup` whose
 * author-chosen target is genuinely absent still names nothing and still costs
 * nothing, and `tree` — the fourth member of `REFERENCE_VALUE_TYPES` — stays
 * OUT of `REFERENCE_FIELD_TYPES`, so a tracked `tree` field with a perfectly
 * readable target is still rendered as its raw id and still issues no read.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { referenceTargetOf } from '@objectstack/spec/data';
import { installAuditWriters } from './audit-writers.js';

/**
 * The target a `user` field names when the author does not restate it — read
 * from the spec's arbiter so this file cannot hold a second copy of it.
 */
const IMPLICIT_TARGET = referenceTargetOf({ type: 'user' });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const f = (name: string, type: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type, ...extra }) as any;

const sysAuditLog = {
  name: 'sys_audit_log', label: 'Audit Log',
  fields: {
    id: f('id', 'text', { primaryKey: true }), action: f('action', 'text'),
    user_id: f('user_id', 'text'), object_name: f('object_name', 'text'),
    record_id: f('record_id', 'text'), old_value: f('old_value', 'textarea'),
    new_value: f('new_value', 'textarea'), tenant_id: f('tenant_id', 'text'),
  },
};

const sysActivity = {
  name: 'sys_activity', label: 'Activity',
  fields: {
    id: f('id', 'text', { primaryKey: true }), type: f('type', 'text'),
    timestamp: f('timestamp', 'datetime'), summary: f('summary', 'text'),
    actor_id: f('actor_id', 'text'), object_name: f('object_name', 'text'),
    record_id: f('record_id', 'text'), record_label: f('record_label', 'text'),
    metadata: f('metadata', 'textarea'),
  },
};

const sysUserObj = {
  name: 'sys_user', label: 'User',
  fields: {
    id: f('id', 'text', { primaryKey: true }), name: f('name', 'text'),
    email: f('email', 'email'),
  },
};

const crmAccount = {
  name: 'crm_account', label: 'Account',
  fields: { id: f('id', 'text', { primaryKey: true }), name: f('name', 'text') },
};

const crmCategory = {
  name: 'crm_category', label: 'Category',
  fields: { id: f('id', 'text', { primaryKey: true }), name: f('name', 'text') },
};

/**
 * The audited object. Every field is load-bearing:
 *
 *  - `owner` is the card's subject: `user`, tracked, and authored WITHOUT
 *    `reference` — the spelling the contract calls fully specified.
 *  - `owner_explicit` is the same type tracked with the carrier materialized,
 *    so "implicit and explicit answer identically" is measurable rather than
 *    asserted.
 *  - `reviewer` is `user` authored without `reference` and deliberately
 *    UNTRACKED: the milestone branch is not gated on `trackHistory`, so it is
 *    the only field that can exercise the milestone planner's half of the
 *    defect.
 *  - `account_id` is an ordinary lookup — the control that worked before this
 *    change and must still work.
 *  - `orphan_id` is a tracked `lookup` with NO target: an author-chosen target
 *    nothing can supply, which must STAY unresolved.
 *  - `category_id` is a tracked `tree` with a perfectly readable target:
 *    `tree` is not in `REFERENCE_FIELD_TYPES` and must stay out.
 */
const bizDeal = {
  name: 'biz_deal', label: 'Deal',
  fields: {
    id: f('id', 'text', { primaryKey: true }),
    title: f('title', 'text'),
    stage: f('stage', 'text', { label: 'Stage', trackHistory: true }),
    owner: f('owner', 'user', { label: 'Owner', trackHistory: true }),
    owner_explicit: f('owner_explicit', 'user', {
      label: 'Owner', reference: 'sys_user', trackHistory: true,
    }),
    reviewer: f('reviewer', 'user', { label: 'Reviewer' }),
    account_id: f('account_id', 'lookup', {
      label: 'Account', reference: 'crm_account', trackHistory: true,
    }),
    orphan_id: f('orphan_id', 'lookup', { label: 'Orphan', trackHistory: true }),
    category_id: f('category_id', 'tree', {
      label: 'Category', reference: 'crm_category', trackHistory: true,
    }),
  },
  activityMilestones: [
    // A reference token on an implicit-target `user` field, on an UNTRACKED
    // field — the milestone branch's own gate.
    { field: 'stage', value: 'closed_won', summary: 'Deal won by {reviewer}', type: 'completed' },
    // The narrowness control, as a milestone token.
    { field: 'stage', value: 'orphaned', summary: 'Owned by {orphan_id}' },
  ],
};

// ---------------------------------------------------------------------------
// A driver that COUNTS reads and returns COPIES
// ---------------------------------------------------------------------------

/**
 * Lifted from `audit-lookup-summary.test.ts` (via `audit-bound-previous.test.ts`),
 * deliberately including its copy-returning rule: a driver that hands back live
 * store references lets the engine's read path rewrite the store in place, after
 * which measurements taken around a write describe a store that moved under them.
 */
function makeCountingDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const reads = { findOneOn: {} as Record<string, number>, findOn: {} as Record<string, number> };
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const copy = <T,>(r: T): T => (r == null ? r : JSON.parse(JSON.stringify(r)));
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries<any>(where)) {
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every((sub) => matches(row, sub))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      if (v && typeof v === 'object' && '$in' in v) {
        if (!(v.$in as unknown[]).includes(row[k])) return false;
        continue;
      }
      const expected = (v && typeof v === 'object' && '$eq' in v) ? v.$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      // The counter is read by TYPE rather than with `?? 0`. This double is
      // lifted and driven by `check:objectql-double-limit`, which stubs every
      // non-function declaration it cannot supply — `reads` among them — and
      // arithmetic on that stub throws before the body can be judged at all,
      // which files the double as UNJUDGED rather than as conforming.
      const prior = reads.findOn[object];
      reads.findOn[object] = (typeof prior === 'number' ? prior : 0) + 1;
      const matched = Array.from(storeFor(object).values())
        .filter((r) => matches(r, ast?.where));
      // The caller's bound: applied by PRESENCE (so `limit: 0` returns nothing),
      // AFTER the filter, and BEFORE the rows are copied — so no row outside the
      // bound is ever touched. `resolveLookupTitles` passes `limit: ids.length`,
      // and a limit-blind double would answer a bounded query with an unbounded
      // page while the read counts here still looked right.
      const page = typeof ast?.limit === 'number' ? matched.slice(0, ast.limit) : matched;
      return page.map(copy);
    },
    async findOne(object: string, ast: any) {
      reads.findOneOn[object] = (reads.findOneOn[object] ?? 0) + 1;
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return copy(row);
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return copy(updated);
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && storeFor(object).has(id) ? this.update(object, id, data) : this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(object, ast);
      const s = storeFor(object);
      for (const r of rows) s.set(r.id as string, { ...s.get(r.id as string), ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(object: string, ast: any) {
      const rows = await this.find(object, ast);
      for (const r of rows) storeFor(object).delete(r.id as string);
      return rows.length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads, storeFor };
}

const OWNER_PACKAGE = 'com.objectstack.test.audit-implicit-reference-target';

async function boot() {
  const engine = new ObjectQL();
  const stub = makeCountingDriver();
  engine.registerDriver(stub.driver, true);
  await engine.init();
  for (const o of [sysAuditLog, sysActivity, sysUserObj, crmAccount, crmCategory, bizDeal]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }
  installAuditWriters(engine as any, 'test.audit', {
    getI18n: () => undefined as any,
    getLocale: async () => undefined,
  });
  return { engine, ...stub };
}

const lastSummary = (storeFor: (o: string) => Map<string, Record<string, unknown>>) => {
  const all = Array.from(storeFor('sys_activity').values()).map((r) => String(r.summary));
  return all.length > 0 ? all[all.length - 1] : undefined;
};

async function seed(engine: any) {
  await engine.insert('sys_user', { id: 'usr_1', name: 'Grace Hopper', email: 'g@example.com' });
  await engine.insert('crm_account', { id: 'acc_1', name: 'Acme Corp' });
  await engine.insert('crm_category', { id: 'cat_1', name: 'Enterprise' });
  return engine.insert('biz_deal', { id: 'deal_1', title: 'Ship it', stage: 'open' });
}

/** Reads issued against `sys_user`, the target no author restated. */
const userReads = (reads: { findOn: Record<string, number> }) =>
  reads.findOn[String(IMPLICIT_TARGET)] ?? 0;

// ---------------------------------------------------------------------------
// 0. The arbiter's own answer, so the literal below is never hand-copied
// ---------------------------------------------------------------------------

describe('[#19264] the target of an implicit-target `user` field', () => {
  it('is supplied by the spec arbiter, not by the author', () => {
    expect(IMPLICIT_TARGET).toBe('sys_user');
    expect(referenceTargetOf({ type: 'user' })).toBe(referenceTargetOf({ type: 'user', reference: 'sys_user' }));
  });
});

// ---------------------------------------------------------------------------
// 1. The tracked-change planner + renderer
// ---------------------------------------------------------------------------

describe('[#19264] tracked-change branch — an implicit-target `user` field is planned and rendered', () => {
  it('issues the read and renders the title where the raw id used to appear', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);

    const before = userReads(reads);
    await engine.update('biz_deal', { owner: 'usr_1' }, { where: { id: 'deal_1' } } as any);

    // The half a value assertion cannot see: before this change the plan was
    // empty, so this read was never issued at all.
    expect(userReads(reads) - before).toBe(1);
    // The half a read count cannot see: the renderer looks the titles back up
    // by the same key, and used to look them up by the absent carrier.
    expect(lastSummary(storeFor)).toBe('Owner: ∅ → Grace Hopper');
  });

  it('answers IDENTICALLY to the materialized spelling, read count included', async () => {
    const implicit = await boot();
    await seed(implicit.engine);
    const beforeImplicit = userReads(implicit.reads);
    await implicit.engine.update('biz_deal', { owner: 'usr_1' }, { where: { id: 'deal_1' } } as any);

    const explicit = await boot();
    await seed(explicit.engine);
    const beforeExplicit = userReads(explicit.reads);
    await explicit.engine.update(
      'biz_deal', { owner_explicit: 'usr_1' }, { where: { id: 'deal_1' } } as any,
    );

    expect(userReads(implicit.reads) - beforeImplicit).toBe(userReads(explicit.reads) - beforeExplicit);
    expect(lastSummary(implicit.storeFor)).toBe(lastSummary(explicit.storeFor));
    expect(lastSummary(implicit.storeFor)).toBe('Owner: ∅ → Grace Hopper');
  });

  it('batches the implicit target with the materialized one into ONE read', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);

    const before = userReads(reads);
    await engine.update(
      'biz_deal',
      { owner: 'usr_1', owner_explicit: 'usr_1' },
      { where: { id: 'deal_1' } } as any,
    );

    // Both fields name the SAME target object, so the plan's grouping must
    // still answer them with one `id: { $in: [...] }` — the implicit spelling
    // enters the existing batching rather than opening a second lane.
    expect(userReads(reads) - before).toBe(1);
    expect(lastSummary(storeFor)).toBe('Owner: ∅ → Grace Hopper; Owner: ∅ → Grace Hopper');
  });
});

// ---------------------------------------------------------------------------
// 2. The milestone planner + renderer
// ---------------------------------------------------------------------------

describe('[#19264] milestone branch — an implicit-target `user` token is planned and rendered', () => {
  it('issues the read and interpolates the title, on an UNTRACKED field', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);
    // `reviewer` carries no `trackHistory`, which is the milestone branch's
    // own rule — the token is whatever the milestone author wrote.
    await engine.update('biz_deal', { reviewer: 'usr_1' }, { where: { id: 'deal_1' } } as any);

    const before = userReads(reads);
    await engine.update('biz_deal', { stage: 'closed_won' }, { where: { id: 'deal_1' } } as any);

    expect(userReads(reads) - before).toBe(1);
    expect(lastSummary(storeFor)).toBe('Deal won by Grace Hopper');
  });
});

// ---------------------------------------------------------------------------
// 3. Narrowness — what must STILL resolve to nothing
// ---------------------------------------------------------------------------

describe('[#19264] the repair is narrow: nothing else starts resolving', () => {
  it('a tracked `lookup` with no target names nothing, costs nothing, renders the raw id', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);

    const beforeUser = userReads(reads);
    const beforeAccount = reads.findOn['crm_account'] ?? 0;
    await engine.update('biz_deal', { orphan_id: 'acc_1' }, { where: { id: 'deal_1' } } as any);

    // An author-chosen target that is absent is absent: nothing can supply it,
    // so no read is issued against any object and the id renders raw.
    expect(userReads(reads) - beforeUser).toBe(0);
    expect((reads.findOn['crm_account'] ?? 0) - beforeAccount).toBe(0);
    expect(lastSummary(storeFor)).toBe('Orphan: ∅ → acc_1');
  });

  it('the same targetless `lookup` as a MILESTONE token is equally unresolved', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);
    await engine.update('biz_deal', { orphan_id: 'acc_1' }, { where: { id: 'deal_1' } } as any);

    const beforeAccount = reads.findOn['crm_account'] ?? 0;
    await engine.update('biz_deal', { stage: 'orphaned' }, { where: { id: 'deal_1' } } as any);

    expect((reads.findOn['crm_account'] ?? 0) - beforeAccount).toBe(0);
    expect(lastSummary(storeFor)).toBe('Owned by acc_1');
  });

  it('`tree` stays OUT of the tracked reference set, target or no target', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);

    const before = reads.findOn['crm_category'] ?? 0;
    await engine.update('biz_deal', { category_id: 'cat_1' }, { where: { id: 'deal_1' } } as any);

    // `tree` IS a member of `REFERENCE_VALUE_TYPES` and `referenceTargetOf`
    // answers `crm_category` for it — so this case measures the TYPE GATE,
    // which this repair deliberately did not widen. Admitting it would widen
    // what the timeline tracks rather than repair what it silently dropped.
    expect(referenceTargetOf(bizDeal.fields.category_id)).toBe('crm_category');
    expect((reads.findOn['crm_category'] ?? 0) - before).toBe(0);
    expect(lastSummary(storeFor)).toBe('Category: ∅ → cat_1');
  });

  it('an ordinary lookup keeps working exactly as before', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);

    const before = reads.findOn['crm_account'] ?? 0;
    await engine.update('biz_deal', { account_id: 'acc_1' }, { where: { id: 'deal_1' } } as any);

    expect((reads.findOn['crm_account'] ?? 0) - before).toBe(1);
    expect(lastSummary(storeFor)).toBe('Account: ∅ → Acme Corp');
  });

  it('a write that moves no reference field still pays ZERO reads', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);
    await engine.update('biz_deal', { owner: 'usr_1' }, { where: { id: 'deal_1' } } as any);

    const before = userReads(reads);
    // The row now HOLDS an implicit-target reference — the case that catches a
    // "resolve from the written row instead of from the diff" implementation.
    await engine.update('biz_deal', { stage: 'won' }, { where: { id: 'deal_1' } } as any);

    expect(userReads(reads) - before).toBe(0);
    expect(lastSummary(storeFor)).toBe('Stage: open → won');
  });
});
