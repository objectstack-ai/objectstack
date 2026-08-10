// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7290] `sys_activity.summary`'s MILESTONE branch (ADR-0052 §5b.2) — a
 * `{token}` naming a `lookup` / `master_detail` / `user` field renders the
 * referenced record's title instead of its raw 32-char id.
 *
 * ## Why this needed its own card and its own file
 *
 * #7230 / PR #7291 fixed the same rendering defect on the tracked-CHANGE
 * branch, keyed on the diff. The milestone branch takes PRECEDENCE over it, so
 * on an object that declares `activityMilestones` the string users actually see
 * never went through that fix: `'Deal won by {owner}'` shipped as
 * `'Deal won by oBK25…'`.
 *
 * The two branches also cannot share a gate. #7230's gate is "a field that is
 * BOTH `trackHistory: true` AND a reference actually moved" — evaluated from
 * the diff, before anything is read. A milestone token is none of those things:
 * it is read from the whole AFTER-row, it is whatever the author wrote (the
 * showcase's own `'Deal won by {owner}'` names an UNTRACKED field — pinned
 * below), and whether a milestone fires at all is only known once
 * `matchMilestone` has run.
 *
 * ## The read budget is the reason this file measures anything
 *
 * This is the third card in a row on this file's write hot path.
 * #6656 / PR #6977 retired `captureBefore`'s redundant pre-image read under
 * maintainer ruling Option A+ (2 → 1 per single-id write, 3 → 0 per predicate
 * write); #7230 / PR #7291 preserved that by adding 0 reads to every write
 * shape but "a tracked reference moved". This card had two placements available
 * and they are NOT equivalent:
 *
 *   BEFORE `matchMilestone`  — speculate on the after-row, pay on EVERY update
 *                              of a milestone-declaring object, including the
 *                              overwhelming majority where nothing fires. This
 *                              is the shape ruling A+ was obtained to remove.
 *   AFTER it fires           — plan from the tokens of the template that
 *                              MATCHED. Zero on every non-firing update; one
 *                              read per distinct target object on the
 *                              transition itself, which is rare by construction
 *                              (`before !== value && after === value`, and
 *                              never again while the record sits at that value).
 *
 * The second was implemented. Section 3 pins it as counts, not prose, and the
 * zero-read cases run against a row that HOLDS references — measured, that is
 * the difference between a guard and a guard-shaped no-op (PR #7291's own
 * mutation D passed 160/160 against a reference-free row before its fixture was
 * hardened; the same trap is live here and is avoided the same way).
 *
 * ⚠️ Read counts and rendering are pinned SEPARATELY on purpose: the read lives
 * in `resolveLookupTitles`, the rendering in `renderMilestoneSummary`. Deleting
 * the render limb leaves every count green.
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

/** Target objects. Title fields are DERIVED (ADR-0079) unless stated. */
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
 * [#6656 non-regression] A target object that DESIGNATES a credential field as
 * its title. `resolveDisplayField` honours an explicit `nameField` even when it
 * points at a title-INELIGIBLE type, so without the mask check this object's
 * `api_key` would be read and interpolated into a user-facing summary.
 */
const crmVault = {
  name: 'crm_vault', label: 'Vault', nameField: 'api_key',
  fields: { id: f('id', 'text', { primaryKey: true }), api_key: f('api_key', 'secret') },
};

/**
 * The audited object. Field-level notes, because each one is load-bearing:
 *
 *  - `owner` is a `user` reference and is deliberately **UNTRACKED**. It is the
 *    exact field class and the exact declaration of the reported symptom
 *    (`'Deal won by {owner}'`), and it is what proves the milestone branch
 *    cannot reuse #7230's `trackHistory` gate.
 *  - `account_id` / `partner_id` point at the SAME target, so batching is
 *    measurable; `account_id` is tracked and `partner_id` is not, so precedence
 *    against the tracked branch is measurable too.
 *  - `region_id` gives a second distinct target.
 *  - `parent_id` is the `master_detail` member of the reference set.
 *  - `vault_id` points at the masked-title object above.
 *  - `priority` is a select: its option-label rendering must survive this
 *    change untouched (localizing those labels is #7289, a different card).
 */
const bizDeal = {
  name: 'biz_deal', label: 'Deal',
  fields: {
    id: f('id', 'text', { primaryKey: true }),
    title: f('title', 'text'),
    stage: f('stage', 'text', { label: 'Stage', trackHistory: true }),
    owner: f('owner', 'user', { label: 'Owner', reference: 'sys_user' }),
    account_id: f('account_id', 'lookup', {
      label: 'Account', reference: 'crm_account', trackHistory: true,
    }),
    partner_id: f('partner_id', 'lookup', { label: 'Partner', reference: 'crm_account' }),
    region_id: f('region_id', 'lookup', { label: 'Region', reference: 'crm_region' }),
    parent_id: f('parent_id', 'master_detail', { label: 'Parent', reference: 'crm_account' }),
    vault_id: f('vault_id', 'lookup', { label: 'Vault', reference: 'crm_vault' }),
    priority: f('priority', 'select', {
      label: 'Priority',
      options: [{ value: 'p1', label: 'Highest' }, { value: 'p2', label: 'Normal' }],
    }),
  },
  /**
   * Every milestone watches `stage`, so exactly one can fire per write and each
   * case selects its own by the value it transitions into.
   */
  activityMilestones: [
    // One reference token, on an UNTRACKED field — the reported declaration.
    { field: 'stage', value: 'closed_won', summary: 'Deal won by {owner}', type: 'completed' },
    // Two tokens onto the SAME target object → must batch into ONE read.
    { field: 'stage', value: 'handover', summary: 'Handed to {account_id} via {partner_id}' },
    // Two DISTINCT target objects → one read each.
    { field: 'stage', value: 'localized', summary: 'Won by {owner} for {region_id}' },
    // The SAME token twice → still one read, and both occurrences resolve.
    { field: 'stage', value: 'escalated', summary: 'Escalated by {owner}, notified {owner}' },
    // No reference token at all — the shipped showcase shape → ZERO reads.
    { field: 'stage', value: 'archived', summary: '✅ Archived: {title}' },
    // A select token: option-label rendering must be untouched by this change.
    { field: 'stage', value: 'prioritized', summary: 'Priority set to {priority}' },
    // A token whose value is empty renders as the EMPTY STRING, not `∅`.
    { field: 'stage', value: 'unassigned', summary: 'Unassigned deal:{owner}' },
    // master_detail is in the reference set.
    { field: 'stage', value: 'merged', summary: 'Merged into {parent_id}' },
    // The masked-title target: the read must be SKIPPED, not masked downstream.
    { field: 'stage', value: 'vaulted', summary: 'Vaulted under {vault_id}' },
    // An unknown token names no field at all — raw value / empty, as before.
    { field: 'stage', value: 'ghosted', summary: 'Ghosted {nosuchfield}' },
  ],
};

// ---------------------------------------------------------------------------
// A driver that COUNTS reads and returns COPIES
// ---------------------------------------------------------------------------

/**
 * Lifted from `audit-bound-previous.test.ts` (via `audit-lookup-summary.test.ts`),
 * deliberately including its copy-returning rule: a driver that hands back live
 * store references lets the engine's read path rewrite the store in place, after
 * which measurements taken around a write describe a store that moved under
 * them. Real drivers serialise; so does this one.
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

/**
 * Deterministic, reversible stand-in for a KMS. `crm_vault.api_key` is a real
 * `secret` field and the engine is fail-closed about persisting one without a
 * provider, so the masked-title case below runs against a genuinely encrypted
 * column rather than a `secret`-typed field that happens to be empty.
 */
const cryptoProvider: any = {
  calls: 0,
  async encrypt(plain: string) {
    cryptoProvider.calls += 1;
    return {
      id: `sec_${cryptoProvider.calls}`, kmsKeyId: 'test-key', alg: 'test',
      version: 1, ciphertext: Buffer.from(plain).toString('base64'),
    };
  },
  async decrypt(handle: any) { return Buffer.from(handle.ciphertext, 'base64').toString(); },
  async rotateKey(handle: any) { return handle; },
  digest(plain: string) { return plain; },
};

const OWNER_PACKAGE = 'com.objectstack.test.audit-milestone-summary';

/**
 * A REAL locale bundle in the shape the shipped bundles carry
 * (`objects.<object>.fields.<field>.label`), not a stub translator that would
 * answer whatever key it was handed. It is here to pin a NON-change: a
 * milestone template is the author's own sentence and is not translated, so
 * turning a real locale on must leave the milestone summary alone while the
 * generic verbs around it localize.
 */
function makeI18n() {
  const i18n = createMemoryI18n();
  i18n.loadTranslations('zh-CN', {
    objects: {
      biz_deal: {
        label: '商机',
        fields: { stage: { label: '阶段' }, owner: { label: '负责人' } },
      },
    },
    // `{{param}}` — the shipped bundles' interpolation syntax
    // (`translations/messages.ts`: `Updated {{object}} "{{label}}"`), which is
    // deliberately NOT the milestone template's single-brace `{token}`. Getting
    // this wrong is exactly what a stub translator would have hidden.
    messages: { activityUpdated: '已更新{{object}}"{{label}}"' },
  });
  return i18n;
}

async function boot(opts: { locale?: string; i18n?: unknown } = {}) {
  const engine = new ObjectQL();
  const stub = makeCountingDriver();
  engine.registerDriver(stub.driver, true);
  await engine.init();
  engine.setCryptoProvider(cryptoProvider);
  for (const o of [sysAuditLog, sysActivity, crmAccount, crmRegion, sysUserObj, crmVault, bizDeal]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }
  installAuditWriters(engine as any, 'test.audit', {
    getI18n: () => opts.i18n as any,
    getLocale: async () => opts.locale,
  });
  return { engine, ...stub };
}

const lastSummary = (storeFor: (o: string) => Map<string, Record<string, unknown>>) => {
  const all = Array.from(storeFor('sys_activity').values());
  return all.length > 0 ? String(all[all.length - 1].summary) : undefined;
};

const lastType = (storeFor: (o: string) => Map<string, Record<string, unknown>>) => {
  const all = Array.from(storeFor('sys_activity').values());
  return all.length > 0 ? String(all[all.length - 1].type) : undefined;
};

/**
 * Seed the reference targets and TWO deals:
 *
 *  - `deal_1` holds NO references — the `∅`-side and empty-token cases.
 *  - `deal_2` already holds EVERY reference field. That is load-bearing, not
 *    incidental: a zero-read guard only guards on a row that HAS references to
 *    read. Measured on PR #7291, hot-path cases run against a reference-free row
 *    stay green under the very regression they exist to catch, because there is
 *    nothing on the row to read.
 *
 * Every zero-read case below therefore runs against `deal_2` — with ONE
 * deliberate exception, written down here rather than left for the next reader
 * to trip over. `a reference token whose value is EMPTY pays ZERO reads` must
 * run against `deal_1`, because an empty reference is the thing that case
 * measures and `deal_2` has none to offer. It is therefore NOT a placement
 * guard: on a row with nothing to read, EVERY placement pays zero, so it cannot
 * tell one from another. That is measured rather than reasoned — it was the
 * single case in this file that stayed GREEN under the mutation moving the read
 * before `matchMilestone`, the placement the other zero-read cases exist to
 * reject. It is retained for the empty-value rule alone; the placement is
 * guarded by its neighbours, all of which run against `deal_2`.
 */
async function seed(engine: any) {
  await engine.insert('crm_account', { id: 'acc_1', name: 'Acme Corp' });
  await engine.insert('crm_account', { id: 'acc_2', name: 'Globex' });
  await engine.insert('crm_region', { id: 'reg_1', title: 'APAC' });
  await engine.insert('sys_user', { id: 'usr_1', name: '张伟', email: 'z@example.com' });
  await engine.insert('crm_vault', { id: 'vlt_1', api_key: 'sk-live-do-not-leak' });
  await engine.insert('biz_deal', {
    id: 'deal_2', title: 'Already linked', stage: 'open', priority: 'p1',
    owner: 'usr_1', account_id: 'acc_1', partner_id: 'acc_2',
    region_id: 'reg_1', parent_id: 'acc_1', vault_id: 'vlt_1',
  });
  return engine.insert('biz_deal', { id: 'deal_1', title: 'Ship it', stage: 'open' });
}

const moveStage = (engine: any, id: string, stage: string) =>
  engine.update('biz_deal', { stage }, { where: { id } } as any);

// ---------------------------------------------------------------------------
// 1. The defect — a reference token renders a title, not a raw id
// ---------------------------------------------------------------------------

describe('[#7290] milestone `{token}` interpolation resolves reference titles', () => {
  it('renders a `user` token as the referenced record title (the reported declaration)', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    await moveStage(engine, 'deal_2', 'closed_won');

    // Before this change: `Deal won by usr_1` — in production, a 32-char id.
    expect(lastSummary(storeFor)).toBe('Deal won by 张伟');
    expect(lastType(storeFor)).toBe('completed');
  });

  it('resolves a token on an UNTRACKED field — the milestone branch is not gated on `trackHistory`', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    // `owner` carries no `trackHistory`, so #7230's diff-keyed gate can never
    // see it. If this renders a raw id, the milestone branch has been wired to
    // the tracked-change gate and the reported defect is still shipping.
    expect((bizDeal.fields as any).owner.trackHistory).toBeUndefined();
    await moveStage(engine, 'deal_2', 'closed_won');

    expect(lastSummary(storeFor)).toBe('Deal won by 张伟');
  });

  it('resolves TWO tokens pointing at the same target object', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    await moveStage(engine, 'deal_2', 'handover');

    expect(lastSummary(storeFor)).toBe('Handed to Acme Corp via Globex');
  });

  it('resolves tokens across TWO distinct target objects', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    await moveStage(engine, 'deal_2', 'localized');

    expect(lastSummary(storeFor)).toBe('Won by 张伟 for APAC');
  });

  it('resolves a `master_detail` token', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    await moveStage(engine, 'deal_2', 'merged');

    expect(lastSummary(storeFor)).toBe('Merged into Acme Corp');
  });

  it('resolves the SAME token at every occurrence', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    await moveStage(engine, 'deal_2', 'escalated');

    expect(lastSummary(storeFor)).toBe('Escalated by 张伟, notified 张伟');
  });

  it("leaves the author's template wording — including non-token text — untouched", async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    await moveStage(engine, 'deal_2', 'archived');

    // Only what a token RESOLVES TO is this card's business; the sentence,
    // its punctuation and its emoji are the author's.
    expect(lastSummary(storeFor)).toBe('✅ Archived: Already linked');
  });

  it('leaves select option-label rendering exactly as it was (#7289 owns that surface)', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    await moveStage(engine, 'deal_2', 'prioritized');

    expect(lastSummary(storeFor)).toBe('Priority set to Highest');
  });

  it("keeps the empty-value rule: an empty token renders '' , not '∅'", async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    // `deal_1` holds no `owner`. A milestone sentence is prose, not a diff row,
    // so the pre-#7290 empty rendering is preserved verbatim.
    await moveStage(engine, 'deal_1', 'unassigned');

    expect(lastSummary(storeFor)).toBe('Unassigned deal:');
  });

  it('renders the RAW ID when the referenced record cannot be resolved (restore-invariant)', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    // A dangling reference cannot be authored — the engine's
    // `assertReferencesResolve` refuses it on write — so the realistic
    // unresolvable case is a reference that WAS valid and whose target has since
    // gone away. Removed out of band here, which is also what a hard delete or
    // an unregistered target object looks like from this function.
    storeFor('sys_user').delete('usr_1');
    // A MIXED template on purpose (`'Won by {owner} for {region_id}'`): the
    // unresolvable side must stay raw AND the resolvable side must still become
    // a title. A single-token fallback assertion would survive the deletion of
    // the render limb itself — measured on PR #7291's mutation B, which is why
    // this case is written the harder way from the start.
    await moveStage(engine, 'deal_2', 'localized');

    expect(lastSummary(storeFor)).toBe('Won by usr_1 for APAC');
  });

  it('leaves a token that names no field alone', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    await moveStage(engine, 'deal_2', 'ghosted');

    expect(lastSummary(storeFor)).toBe('Ghosted ');
  });
});

// ---------------------------------------------------------------------------
// 2. Precedence and locale — both are NON-changes, pinned so they stay that way
// ---------------------------------------------------------------------------

describe('[#7290] precedence and locale behaviour are unchanged', () => {
  it('the milestone still wins over the tracked field-change summary', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    // `stage` and the tracked reference `account_id` move together. Without
    // the milestone this would read `Stage: open → closed_won; Account: …`.
    await engine.update(
      'biz_deal',
      { stage: 'closed_won', account_id: 'acc_2' },
      { where: { id: 'deal_2' } } as any,
    );

    expect(lastSummary(storeFor)).toBe('Deal won by 张伟');
  });

  it('a milestone template is the author’s sentence and is NOT translated', async () => {
    const { engine, storeFor } = await boot({ locale: 'zh-CN', i18n: makeI18n() });
    await seed(engine);

    await moveStage(engine, 'deal_2', 'closed_won');

    // Real zh-CN bundle loaded (`objects.biz_deal.fields.owner.label` = 负责人)
    // and it must NOT leak into the milestone sentence: milestone summaries have
    // never been localized, and this card does not change what a template says.
    expect(lastSummary(storeFor)).toBe('Deal won by 张伟');
  });

  it('the generic verb branch still localizes around it (the bundle really is live)', async () => {
    const { engine, storeFor } = await boot({ locale: 'zh-CN', i18n: makeI18n() });
    await seed(engine);

    // A write that fires no milestone and moves no tracked field falls through
    // to `messages.activityUpdated`. If this stayed English the bundle above
    // would be inert and the previous case would prove nothing.
    await engine.update('biz_deal', { priority: 'p2' }, { where: { id: 'deal_2' } } as any);

    expect(lastSummary(storeFor)).toBe('已更新商机"Already linked"');
  });
});

// ---------------------------------------------------------------------------
// 3. Read cost — #6656 / PR #6977's retirement must survive this card
// ---------------------------------------------------------------------------

/** Reads issued on the reference TARGETS during `body`, per object. */
async function targetReads(
  reads: { findOn: Record<string, number>; findOneOn: Record<string, number> },
  body: () => Promise<unknown>,
): Promise<Record<string, number>> {
  const objects = ['sys_user', 'crm_account', 'crm_region', 'crm_vault'];
  const before: Record<string, number> = {};
  for (const o of objects) before[o] = reads.findOn[o] ?? 0;
  await body();
  const out: Record<string, number> = {};
  for (const o of objects) out[o] = (reads.findOn[o] ?? 0) - before[o];
  return out;
}

const ZERO = { sys_user: 0, crm_account: 0, crm_region: 0, crm_vault: 0 };

describe('[#7290] the milestone read is paid only on the transition, and only for what fired', () => {
  it('an update of a milestone-declaring object that fires NOTHING pays ZERO reads', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);

    // THE guard for this card. `deal_2` holds every reference field, so a plan
    // built BEFORE `matchMilestone` — the placement ruling A+ was obtained to
    // remove — would read here, on a write that produces no milestone at all.
    const delta = await targetReads(reads, () => moveStage(engine, 'deal_2', 'negotiation'));

    expect(delta).toEqual(ZERO);
    expect(lastSummary(storeFor)).toBe('Stage: open → negotiation');
  });

  it('a non-stage update of a milestone-declaring object pays ZERO reads', async () => {
    const { engine, reads } = await boot();
    await seed(engine);

    const delta = await targetReads(reads, () =>
      engine.update('biz_deal', { priority: 'p2' }, { where: { id: 'deal_2' } } as any),
    );

    expect(delta).toEqual(ZERO);
  });

  it('a create on a milestone-declaring object pays ZERO reads (the branch is update-only)', async () => {
    const { engine, reads } = await boot();
    await seed(engine);

    const delta = await targetReads(reads, () =>
      engine.insert('biz_deal', {
        id: 'deal_3', title: 'Third', stage: 'closed_won',
        owner: 'usr_1', account_id: 'acc_1',
      }),
    );

    expect(delta).toEqual(ZERO);
  });

  it('a delete on a milestone-declaring object pays ZERO reads (the branch is update-only)', async () => {
    const { engine, reads } = await boot();
    await seed(engine);

    const delta = await targetReads(reads, () =>
      engine.delete('biz_deal', { where: { id: 'deal_2' } } as any),
    );

    expect(delta).toEqual(ZERO);
  });

  it('a milestone that fires with NO reference token pays ZERO reads', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);

    // `'✅ Archived: {title}'` — the shipped showcase shape. The row still holds
    // every reference; the template names none of them.
    const delta = await targetReads(reads, () => moveStage(engine, 'deal_2', 'archived'));

    expect(delta).toEqual(ZERO);
    expect(lastSummary(storeFor)).toBe('✅ Archived: Already linked');
  });

  it('a reference token whose value is EMPTY pays ZERO reads', async () => {
    const { engine, reads } = await boot();
    await seed(engine);

    // ⚠️ NOT a placement guard — and deliberately not counted as one. This case
    // has to use `deal_1`, the reference-free row, because an empty reference is
    // exactly what it measures; on a row with nothing to read, every candidate
    // placement pays zero. Measured: this was the ONE case in this file that
    // stayed GREEN when the read was moved before `matchMilestone` — the
    // placement its neighbours exist to reject. Retained for the empty-value
    // rule only. See the note in `seed()` above.
    const delta = await targetReads(reads, () => moveStage(engine, 'deal_1', 'unassigned'));

    expect(delta).toEqual(ZERO);
  });

  it('re-firing is impossible, so a repeat write to the same value pays ZERO reads', async () => {
    const { engine, reads } = await boot();
    await seed(engine);
    await moveStage(engine, 'deal_2', 'closed_won');

    // The milestone is a TRANSITION (`before !== value && after === value`).
    // This is why "one read on the transition" is rare by construction rather
    // than "one read per write on a won deal".
    const delta = await targetReads(reads, () =>
      engine.update('biz_deal', { title: 'Renamed' }, { where: { id: 'deal_2' } } as any),
    );

    expect(delta).toEqual(ZERO);
  });

  it('ONE reference token costs exactly ONE read, on its target only', async () => {
    const { engine, reads } = await boot();
    await seed(engine);

    const delta = await targetReads(reads, () => moveStage(engine, 'deal_2', 'closed_won'));

    expect(delta).toEqual({ ...ZERO, sys_user: 1 });
  });

  it('TWO tokens onto the SAME target still cost ONE read (batched, not per token)', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);

    const delta = await targetReads(reads, () => moveStage(engine, 'deal_2', 'handover'));

    // Per-token resolution would measure 2 here.
    expect(delta).toEqual({ ...ZERO, crm_account: 1 });
    expect(lastSummary(storeFor)).toBe('Handed to Acme Corp via Globex');
  });

  it('TWO distinct targets cost exactly ONE read each', async () => {
    const { engine, reads } = await boot();
    await seed(engine);

    const delta = await targetReads(reads, () => moveStage(engine, 'deal_2', 'localized'));

    expect(delta).toEqual({ ...ZERO, sys_user: 1, crm_region: 1 });
  });

  it('the SAME token twice costs ONE read', async () => {
    const { engine, reads } = await boot();
    await seed(engine);

    const delta = await targetReads(reads, () => moveStage(engine, 'deal_2', 'escalated'));

    expect(delta).toEqual({ ...ZERO, sys_user: 1 });
  });

  it('a fired milestone pays for ITS tokens only — not for tracked references that also moved', async () => {
    const { engine, reads } = await boot();
    await seed(engine);

    // `account_id` is a tracked reference and it moves, but the milestone wins,
    // so #7230's tracked-change branch never runs and never reads. Pre-existing
    // precedence, pinned so this card cannot quietly add a second read path.
    const delta = await targetReads(reads, () =>
      engine.update(
        'biz_deal',
        { stage: 'closed_won', account_id: 'acc_2' },
        { where: { id: 'deal_2' } } as any,
      ),
    );

    expect(delta).toEqual({ ...ZERO, sys_user: 1 });
  });

  it("re-asserts #6977's own count: a single-id update still pays exactly ONE pre-image read", async () => {
    const { engine, reads } = await boot();
    await seed(engine);

    const before = reads.findOneOn['biz_deal'] ?? 0;
    await moveStage(engine, 'deal_2', 'closed_won');

    // The engine's one bound pre-image, and no plugin read of its own on the
    // audited object — 2 → 1 stays 1, on the firing path too.
    expect((reads.findOneOn['biz_deal'] ?? 0) - before).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Masking — #6656's contract, on the new read path
// ---------------------------------------------------------------------------

describe('[#7290] a credential title field is never read and never rendered', () => {
  it('skips the read entirely when the target designates a masked field as its title', async () => {
    const { engine, reads, storeFor } = await boot();
    await seed(engine);

    const delta = await targetReads(reads, () => moveStage(engine, 'deal_2', 'vaulted'));

    // Not "read it and mask it afterwards" — not read at all. `crm_vault`
    // declares `nameField: 'api_key'` and `api_key` is `secret`, which is the
    // same `collectMaskedReadFields` predicate `ledgerView` masks with.
    expect(delta).toEqual(ZERO);
    expect(lastSummary(storeFor)).toBe('Vaulted under vlt_1');
    expect(lastSummary(storeFor)).not.toContain('sk-live');
  });
});
