// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7230] `sys_activity.summary`'s tracked-change branch — the field LABEL is
 * localized, and a reference VALUE renders the referenced record's title
 * instead of its raw id.
 *
 * ## The two halves, pinned separately on purpose
 *
 * The measured symptom was one string — `Rating Owner: ∅ → oBK25…` at the
 * bottom of an otherwise fully-localized zh-CN page — but it had two
 * independent causes, and a test that only asserted the finished string could
 * be satisfied by fixing either one:
 *
 *  - **Label half.** `renderTrackedChangeSummary` was the ONE summary branch
 *    never handed the locale-bound `translate` its three siblings
 *    (`messages.activityCreated` / `Deleted` / `Updated`, plus `displayLabelFor`)
 *    all resolve through — an oversight against ADR-0053 / framework#3039
 *    write-time localization. Pinned against a REAL locale: `createMemoryI18n`
 *    loaded with real `objects.<object>.fields.<field>.label` data, which is
 *    the key shape the shipped bundles use. A stub translator returning a
 *    marker would pass whether or not the real key shape were right.
 *  - **Value half.** `displayFieldValue` resolved select/picklist option labels
 *    only, so a `lookup` / `master_detail` / `user` value fell through to
 *    `String(value)` — the raw 32-char id.
 *
 * ## Why the read counts are measured here at all
 *
 * The value half needs a read, and this file is the write hot path: one day
 * before this change #6656 / PR #6977 retired `captureBefore`'s redundant
 * pre-image read from it (2 → 1 per single-id write, 3 → 0 per predicate
 * write) under maintainer ruling Option A+. So the reads this change ADDS are
 * measured with the same copy-returning counting driver that measured that
 * retirement, and the three properties that keep it off the hot path are
 * pinned as cases rather than asserted in prose:
 *
 *   0 reads   when no tracked REFERENCE field changed (every create, every
 *             delete, and every update that does not move a reference)
 *   1 read    per distinct target object, however many tracked reference
 *             fields point at it
 *   N reads   for N distinct target objects — one each, never one per value
 *
 * ⚠️ The read-count cases do NOT pin the rendering, and the rendering cases do
 * not pin the read counts: the read lives in `resolveTrackedLookupTitles` and
 * the rendering in `displayFieldValue`. Deleting the render branch leaves every
 * count green. Both sets are therefore required, and each was mutated
 * separately to confirm it goes red on its own defect.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { createMemoryI18n } from '@objectstack/core';
import { installAuditWriters } from './audit-writers.js';

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

/** Target objects. Their title fields are DERIVED (ADR-0079), not declared. */
const crmAccount = {
  name: 'crm_account', label: 'Account',
  fields: { id: f('id', 'text', { primaryKey: true }), name: f('name', 'text') },
};

const crmRegion = {
  name: 'crm_region', label: 'Region',
  fields: { id: f('id', 'text', { primaryKey: true }), title: f('title', 'text') },
};

const sysUserObj = {
  name: 'sys_user', label: 'User',
  fields: {
    id: f('id', 'text', { primaryKey: true }), name: f('name', 'text'),
    email: f('email', 'email'),
  },
};

/**
 * The audited object. Two tracked lookups point at the SAME target
 * (`account_id`, `partner_id`) so batching is measurable; `region_id` gives a
 * second distinct target; `owner` is the `user` specialization the symptom was
 * actually reported on; `stage` is a tracked NON-reference field, which is what
 * makes the zero-read case a real tracked-change write rather than a no-op.
 */
const bizDeal = {
  name: 'biz_deal', label: 'Deal',
  fields: {
    id: f('id', 'text', { primaryKey: true }),
    title: f('title', 'text'),
    stage: f('stage', 'text', { label: 'Stage', trackHistory: true }),
    account_id: f('account_id', 'lookup', {
      label: 'Account', reference: 'crm_account', trackHistory: true,
    }),
    partner_id: f('partner_id', 'lookup', {
      label: 'Partner', reference: 'crm_account', trackHistory: true,
    }),
    region_id: f('region_id', 'lookup', {
      label: 'Region', reference: 'crm_region', trackHistory: true,
    }),
    owner: f('owner', 'user', {
      label: 'Owner', reference: 'sys_user', trackHistory: true,
    }),
    // An UNTRACKED reference: it must never cost a read, whatever it holds.
    referrer_id: f('referrer_id', 'lookup', { label: 'Referrer', reference: 'crm_account' }),
  },
};

// ---------------------------------------------------------------------------
// A driver that COUNTS reads and returns COPIES
// ---------------------------------------------------------------------------

/**
 * Lifted from `audit-bound-previous.test.ts`, deliberately including its
 * copy-returning rule: a driver that hands back live store references lets the
 * engine's read path rewrite the store in place, after which measurements taken
 * around a write describe a store that moved under them. Real drivers
 * serialise; so does this one.
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
      reads.findOn[object] = (reads.findOn[object] ?? 0) + 1;
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where)).map(copy);
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

const OWNER_PACKAGE = 'com.objectstack.test.audit-lookup-summary';

/**
 * Real `objects.<object>.fields.<field>.label` data for zh-CN — the shape the
 * shipped bundles carry and `i18n.t` resolves. `partner_id` is deliberately
 * ABSENT so the authored-def-label fallback has a case in the same locale.
 */
function makeI18n() {
  const i18n = createMemoryI18n();
  i18n.loadTranslations('zh-CN', {
    objects: {
      biz_deal: {
        label: '商机',
        fields: {
          stage: { label: '阶段' },
          account_id: { label: '客户' },
          region_id: { label: '大区' },
          owner: { label: '负责人' },
        },
      },
    },
  });
  return i18n;
}

async function boot(opts: { locale?: string; i18n?: unknown } = {}) {
  const engine = new ObjectQL();
  const stub = makeCountingDriver();
  engine.registerDriver(stub.driver, true);
  await engine.init();
  for (const o of [sysAuditLog, sysActivity, crmAccount, crmRegion, sysUserObj, bizDeal]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }
  installAuditWriters(engine as any, 'test.audit', {
    getI18n: () => opts.i18n as any,
    getLocale: async () => opts.locale,
  });
  return { engine, ...stub };
}

const summariesOf = (storeFor: (o: string) => Map<string, Record<string, unknown>>) =>
  Array.from(storeFor('sys_activity').values()).map((r) => String(r.summary));

/** The one activity summary produced by the write under test. */
const lastSummary = (storeFor: (o: string) => Map<string, Record<string, unknown>>) => {
  const all = summariesOf(storeFor);
  return all.length > 0 ? all[all.length - 1] : undefined;
};

/**
 * Seed the two accounts, the region, the user, and TWO deals:
 *
 *  - `deal_1` holds NO references — the rendering cases move them from `∅`.
 *  - `deal_2` already holds `account_id` AND `owner` — and that is load-bearing
 *    rather than incidental. The zero-read guard is only a guard on a row that
 *    HAS references to resolve: measured, the first draft of this file ran its
 *    hot-path cases against `deal_1`, where a naive "resolve from the written
 *    row instead of from the diff" implementation ALSO reads nothing, because
 *    there is nothing on the row to read. That mutation passed 160/160 — the
 *    guard was green for the wrong reason. Against `deal_2` it goes red, which
 *    is what makes these cases pin the #6656 / PR #6977 hot path at all.
 */
async function seed(engine: any) {
  await engine.insert('crm_account', { id: 'acc_1', name: 'Acme Corp' });
  await engine.insert('crm_account', { id: 'acc_2', name: 'Globex' });
  await engine.insert('crm_region', { id: 'reg_1', title: 'APAC' });
  await engine.insert('sys_user', { id: 'usr_1', name: '张伟', email: 'z@example.com' });
  await engine.insert('biz_deal', {
    id: 'deal_2', title: 'Already linked', stage: 'open',
    account_id: 'acc_1', owner: 'usr_1',
  });
  return engine.insert('biz_deal', { id: 'deal_1', title: 'Ship it', stage: 'open' });
}

// ---------------------------------------------------------------------------
// 1. Value half — a reference renders the referenced record's title
// ---------------------------------------------------------------------------

describe('[#7230] value half — a tracked reference renders a title, not a raw id', () => {
  it('renders the referenced record title where the raw id used to appear', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    await engine.update('biz_deal', { account_id: 'acc_1' }, { where: { id: 'deal_1' } } as any);

    // Before this change: `Account: ∅ → acc_1`.
    expect(lastSummary(storeFor)).toBe('Account: ∅ → Acme Corp');
  });

  it('renders BOTH sides of a reference change as titles', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);
    await engine.update('biz_deal', { account_id: 'acc_1' }, { where: { id: 'deal_1' } } as any);

    await engine.update('biz_deal', { account_id: 'acc_2' }, { where: { id: 'deal_1' } } as any);

    expect(lastSummary(storeFor)).toBe('Account: Acme Corp → Globex');
  });

  it('resolves a `user` field the same way — the field class the symptom was reported on', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    await engine.update('biz_deal', { owner: 'usr_1' }, { where: { id: 'deal_1' } } as any);

    expect(lastSummary(storeFor)).toBe('Owner: ∅ → 张伟');
  });

  it('falls back to the RAW ID when the referenced record cannot be resolved', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);
    await engine.update('biz_deal', { account_id: 'acc_2' }, { where: { id: 'deal_1' } } as any);

    // A DANGLING reference cannot be authored: the engine's
    // `assertReferencesResolve` refuses `account_id: 'acc_missing'` on write
    // (measured — the first draft of this case tried it and got
    // `ValidationError: Account: no crm_account record has id "acc_missing"`).
    // So the real unresolvable case is a reference that WAS valid when it was
    // written and whose target has since gone away — reproduced here by
    // removing the row out-of-band, which is also what a hard delete, a
    // restore-from-backup skew or an unregistered target object looks like
    // from this function.
    storeFor('crm_account').delete('acc_2');

    await engine.update('biz_deal', { account_id: 'acc_1' }, { where: { id: 'deal_1' } } as any);

    // Exactly the pre-change rendering on the unresolvable side, and a title on
    // the resolvable one: the branch can only replace an id with a title, never
    // a title with an id.
    expect(lastSummary(storeFor)).toBe('Account: acc_2 → Acme Corp');
  });

  it('leaves the `∅ →` notation and non-reference rendering untouched', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    await engine.update('biz_deal', { stage: 'won' }, { where: { id: 'deal_1' } } as any);

    expect(lastSummary(storeFor)).toBe('Stage: open → won');
  });
});

// ---------------------------------------------------------------------------
// 2. Label half — against a REAL locale bundle, not a stub translator
// ---------------------------------------------------------------------------

describe('[#7230] label half — the tracked-change branch gets the locale-bound translator', () => {
  it('localizes the tracked field label to the workspace locale (zh-CN)', async () => {
    const { engine, storeFor } = await boot({ locale: 'zh-CN', i18n: makeI18n() });
    await seed(engine);

    await engine.update('biz_deal', { owner: 'usr_1' }, { where: { id: 'deal_1' } } as any);

    // Both halves at once, which is the reported string's actual shape:
    // localized label + resolved title, where it read `Owner: ∅ → usr_1`.
    expect(lastSummary(storeFor)).toBe('负责人: ∅ → 张伟');
  });

  it('localizes a non-reference tracked label too (the label half is not lookup-only)', async () => {
    const { engine, storeFor } = await boot({ locale: 'zh-CN', i18n: makeI18n() });
    await seed(engine);

    await engine.update('biz_deal', { stage: 'won' }, { where: { id: 'deal_1' } } as any);

    expect(lastSummary(storeFor)).toBe('阶段: open → won');
  });

  it('falls back to the authored field label when the bundle has no entry for it', async () => {
    const { engine, storeFor } = await boot({ locale: 'zh-CN', i18n: makeI18n() });
    await seed(engine);

    // `partner_id` is absent from the zh-CN bundle above.
    await engine.update('biz_deal', { partner_id: 'acc_2' }, { where: { id: 'deal_1' } } as any);

    expect(lastSummary(storeFor)).toBe('Partner: ∅ → Globex');
  });

  it('keeps the authored label when no i18n service is resolvable (status quo)', async () => {
    const { engine, storeFor } = await boot({ locale: 'zh-CN', i18n: undefined });
    await seed(engine);

    await engine.update('biz_deal', { owner: 'usr_1' }, { where: { id: 'deal_1' } } as any);

    expect(lastSummary(storeFor)).toBe('Owner: ∅ → 张伟');
  });
});

// ---------------------------------------------------------------------------
// 3. Read cost — the #6656 / PR #6977 hot path must not get its reads back
// ---------------------------------------------------------------------------

describe('[#7230] the resolution is batched per target object, and free when unused', () => {
  it('a tracked change with NO reference field pays ZERO extra reads, on a row that HAS references', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);

    const beforeAccount = reads.findOn['crm_account'] ?? 0;
    const beforeUser = reads.findOn['sys_user'] ?? 0;
    const beforeSelf = reads.findOneOn['biz_deal'] ?? 0;
    // `deal_2` carries `account_id` and `owner`; only `stage` moves.
    await engine.update('biz_deal', { stage: 'won' }, { where: { id: 'deal_2' } } as any);

    expect((reads.findOn['crm_account'] ?? 0) - beforeAccount).toBe(0);
    expect((reads.findOn['sys_user'] ?? 0) - beforeUser).toBe(0);
    // #6977's single-id count, unchanged by this card: the engine's ONE
    // pre-image read and no plugin read of its own.
    expect((reads.findOneOn['biz_deal'] ?? 0) - beforeSelf).toBe(1);
    expect(lastSummary(storeFor)).toBe('Stage: open → won');
  });

  it('an UNTRACKED reference field changing pays ZERO reads', async () => {
    const { engine, reads } = await boot();
    await seed(engine);

    const before = reads.findOn['crm_account'] ?? 0;
    await engine.update('biz_deal', { referrer_id: 'acc_2' }, { where: { id: 'deal_2' } } as any);

    expect((reads.findOn['crm_account'] ?? 0) - before).toBe(0);
  });

  it('a create pays ZERO reads (the branch is update-only)', async () => {
    const { engine, reads } = await boot();
    await seed(engine);

    const before = reads.findOn['crm_account'] ?? 0;
    await engine.insert('biz_deal', { id: 'deal_3', title: 'Third', account_id: 'acc_1' });

    expect((reads.findOn['crm_account'] ?? 0) - before).toBe(0);
  });

  it('a delete pays ZERO reads (the branch is update-only)', async () => {
    const { engine, reads } = await boot();
    await seed(engine);

    const before = reads.findOn['crm_account'] ?? 0;
    await engine.delete('biz_deal', { where: { id: 'deal_2' } } as any);

    expect((reads.findOn['crm_account'] ?? 0) - before).toBe(0);
  });

  it('ONE tracked reference change costs exactly ONE read', async () => {
    const { engine, reads } = await boot();
    await seed(engine);

    const before = reads.findOn['crm_account'] ?? 0;
    await engine.update('biz_deal', { account_id: 'acc_1' }, { where: { id: 'deal_1' } } as any);

    expect((reads.findOn['crm_account'] ?? 0) - before).toBe(1);
  });

  it('TWO tracked references onto the SAME object still cost ONE read (batched, not per field)', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);

    const before = reads.findOn['crm_account'] ?? 0;
    await engine.update(
      'biz_deal',
      { account_id: 'acc_1', partner_id: 'acc_2' },
      { where: { id: 'deal_1' } } as any,
    );

    // Per-field resolution would measure 2 here; per-VALUE resolution 2 as well
    // (and 4 once both sides are non-empty).
    expect((reads.findOn['crm_account'] ?? 0) - before).toBe(1);
    expect(lastSummary(storeFor)).toBe('Account: ∅ → Acme Corp; Partner: ∅ → Globex');
  });

  it('TWO distinct target objects cost exactly ONE read each', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);

    const beforeAccount = reads.findOn['crm_account'] ?? 0;
    const beforeRegion = reads.findOn['crm_region'] ?? 0;
    await engine.update(
      'biz_deal',
      { account_id: 'acc_1', region_id: 'reg_1' },
      { where: { id: 'deal_1' } } as any,
    );

    expect((reads.findOn['crm_account'] ?? 0) - beforeAccount).toBe(1);
    expect((reads.findOn['crm_region'] ?? 0) - beforeRegion).toBe(1);
    expect(lastSummary(storeFor)).toBe('Account: ∅ → Acme Corp; Region: ∅ → APAC');
  });

  it('BOTH sides of one reference change are answered by the SAME read', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);
    await engine.update('biz_deal', { account_id: 'acc_1' }, { where: { id: 'deal_1' } } as any);

    const before = reads.findOn['crm_account'] ?? 0;
    await engine.update('biz_deal', { account_id: 'acc_2' }, { where: { id: 'deal_1' } } as any);

    // Old id and new id are one `id: { $in: [...] }`, not two point reads.
    expect((reads.findOn['crm_account'] ?? 0) - before).toBe(1);
    expect(lastSummary(storeFor)).toBe('Account: Acme Corp → Globex');
  });
});
