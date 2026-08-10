// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7289] `sys_activity.summary` — a select/picklist VALUE is localized in the
 * tracked-change branch, and deliberately is NOT in the fired-milestone branch.
 *
 * ## The defect
 *
 * `displayFieldValue` rendered a select value by scanning `field.options[]` and
 * returning the matching option's AUTHORED `label`. `field.options` comes from
 * `engine.getSchema(name)` — authored metadata, locale-independent — while the
 * shipped bundles carry those labels under
 * `objects.<object>.fields.<field>.options.<value>`. Nothing on this path read
 * them, so after #7230 localized the field label a zh-CN workspace got
 *
 *     阶段: Proposal → Closed Won
 *
 * — a half-localized string at the bottom of a fully-localized page.
 *
 * ## The asymmetry this file pins, which is the substance of the card
 *
 * `displayFieldValue` has TWO callers and they get DIFFERENT answers:
 *
 *  - `renderTrackedChangeSummary` (#7230) composes a summary whose FRAME is
 *    fully localized — verb template, object label, and since #7230 the field
 *    label. The authored option value was the one untranslated token left in
 *    it, so translating it makes the string uniformly localized. **Localized.**
 *  - `renderMilestoneSummary` (#7290) interpolates tokens into an author-written
 *    sentence that has no bundle key and is deliberately NOT translated (#7290
 *    called that a contract decision and left it). #7290's own change — a
 *    reference id → the record's title — is locale-INDEPENDENT data, the same
 *    string in every locale, which is why it could be added to an untranslated
 *    sentence. An option label is locale-DEPENDENT rendering: reading the bundle
 *    there would guarantee a split sentence (`Deal moved to 已赢单`) in exactly
 *    the case the bundle exists for. **Not localized, by construction** — the
 *    call passes no option resolver.
 *
 * ⚠️ The pre-existing seam case in `audit-milestone-summary.test.ts`
 * (`'leaves select option-label rendering exactly as it was (#7289 owns that
 * surface)'`) boots with NO locale, so it CANNOT bite on that ruling — with no
 * locale `translate` returns undefined either way. The with-locale milestone
 * guard in section 2 below is the one that can, and it was measured going red
 * under the rejected design (mutation M2).
 *
 * ## Everything here is pinned against a REAL locale
 *
 * `createMemoryI18n` loaded with real bundle-shaped data, never a stub
 * translator that would answer whatever key shape the code happened to build.
 * #7333 measured why this matters in this exact file: the shipped bundles
 * interpolate `{{param}}`, which is deliberately not the milestone template's
 * single-brace `{token}`. Section 4 goes further and resolves the code's own key
 * shape against the SHIPPED generated bundle, so the fix is pinned to shipped
 * data rather than to a fixture that agrees with itself.
 *
 * ## Measured mutation coverage — including what does NOT bite
 *
 * Five mutations were run against this file, each reverting one property.
 * Stated here rather than only in the PR, so the file does not read as stronger
 * coverage than it is:
 *
 *  - **M1** (drop the translate limb — the pre-#7289 code): 7 red. The
 *    rendering cases below emit exactly the reported string again,
 *    `阶段: Proposal → Closed Won`.
 *  - **M2** (the rejected design — the milestone branch localizes too): exactly
 *    1 red, the with-locale milestone case. The PRE-EXISTING seam case in
 *    `audit-milestone-summary.test.ts` stayed GREEN under it, confirming it
 *    cannot bite on this ruling.
 *  - **M3** (right idea, wrong bundle key shape): 11 red, including two cases
 *    in `audit-writers.test.ts`.
 *  - **M4** (the lookup escapes the matched-option branch): exactly 1 red, the
 *    `String(value)` case — which is why the bundle below plants a key for
 *    `phone_call`.
 *  - **M5** (resolve titles from the written row instead of the diff — #7291's
 *    mutation D, the #6656 / PR #6977 regression): the zero-read case below
 *    goes red on its COUNT assertion (`expected 1 to be +0`), not on a trailing
 *    rendering one.
 *
 * ⚠️ **Three cases here did not go red under ANY of the five.** They are
 * retained as status-quo pins, not counted as coverage of this change:
 *
 *  - `'a create pays ZERO reads with the locale on'` — a create never reaches
 *    the tracked-change branch at all (it renders through
 *    `messages.activityCreated`), so no mutation of this change can move it. It
 *    guards a future change that puts I/O on the create path.
 *  - `'a fired milestone still pays exactly ONE read'` — #7290's profile, which
 *    this change does not touch. It is a cross-check that the milestone read
 *    plan was not disturbed; the mutation that reddens it lives in
 *    `audit-milestone-summary.test.ts`.
 *  - `'is a NON-change: the same milestone renders identically with the locale
 *    off'` — the locale is OFF, so like the pre-existing seam case it cannot
 *    bite on the M2 ruling. Its with-locale twin above is the one that does;
 *    this one pins the byte-identity BETWEEN the two, which is the actual
 *    contract ("turning a locale on must not move this branch").
 *
 * Note also that under M1 the read-count case went red on its trailing SUMMARY
 * assertion while its count assertions passed — the same blindness #7291
 * measured. Counts and rendering are pinned separately here for that reason.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { createMemoryI18n } from '@objectstack/core';
import { installAuditWriters } from './audit-writers.js';
import { zhCNObjects } from './translations/zh-CN.objects.generated.js';

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

const crmAccount = {
  name: 'crm_account', label: 'Account',
  fields: { id: f('id', 'text', { primaryKey: true }), name: f('name', 'text') },
};

const sysUserObj = {
  name: 'sys_user', label: 'User',
  fields: {
    id: f('id', 'text', { primaryKey: true }), name: f('name', 'text'),
    email: f('email', 'email'),
  },
};

/**
 * The audited object.
 *
 *  - `stage` is the reported field: a tracked `select` carrying authored option
 *    labels. `on_hold` is deliberately ABSENT from the bundle so the
 *    per-VALUE (not per-field) authored fallback has a case in the same locale.
 *  - `priority` uses the BARE-STRING option shape (`options: ['p1', 'p2']`),
 *    where the authored "label" is the value itself — the shape whose fallback
 *    chain (`o.label ?? o.name ?? ov`) has nothing but the value in it.
 *  - `channel` carries an advisory `options` array on a `text` field. That is
 *    not decoration: `displayFieldValue`'s option branch keys on
 *    `field.options` being an array, NOT on `field.type`, and a `select` cannot
 *    express "a stored value matching no declared option" through a real engine
 *    at all — `record-validator` enforces "select / multiselect: value must
 *    appear in `options`" and refuses the write. `text` + `options` is the only
 *    way to reach that branch with a real engine, and reaching it is required:
 *    the bundle below declares a key for `phone_call`, which is NOT a declared
 *    option, so the case goes red if the bundle is ever consulted outside the
 *    matched-option branch (mutation M4).
 *  - `owner` is the `user` reference #7230 / #7291 resolves to a title; it is
 *    here so this file re-asserts that branch alongside options rather than
 *    assuming it, and so the milestone case can carry both token classes.
 *
 * The milestone watches `stage` and fires on `archived` ONLY. Every
 * tracked-change case therefore moves `stage` to a NON-milestone value, so the
 * two branches never contend for the same write.
 */
const bizDeal = {
  name: 'biz_deal', label: 'Deal',
  fields: {
    id: f('id', 'text', { primaryKey: true }),
    title: f('title', 'text'),
    stage: f('stage', 'select', {
      label: 'Stage',
      trackHistory: true,
      options: [
        { value: 'proposal', label: 'Proposal' },
        { value: 'closed_won', label: 'Closed Won' },
        { value: 'on_hold', label: 'On Hold' },
        { value: 'archived', label: 'Archived' },
      ],
    }),
    priority: f('priority', 'select', {
      label: 'Priority',
      trackHistory: true,
      options: ['p1', 'p2'],
    }),
    channel: f('channel', 'text', {
      label: 'Channel',
      trackHistory: true,
      options: [{ value: 'web', label: 'Web' }],
    }),
    owner: f('owner', 'user', { label: 'Owner', reference: 'sys_user', trackHistory: true }),
    account_id: f('account_id', 'lookup', { label: 'Account', reference: 'crm_account' }),
  },
  activityMilestones: [
    { field: 'stage', value: 'archived', summary: 'Deal moved to {stage} by {owner}' },
  ],
};

// ---------------------------------------------------------------------------
// A driver that COUNTS reads and returns COPIES
// ---------------------------------------------------------------------------

/**
 * Lifted from `audit-lookup-summary.test.ts` / `audit-bound-previous.test.ts`,
 * copy-returning rule included: a driver handing back live store references
 * lets the read path rewrite the store under a measurement.
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

const OWNER_PACKAGE = 'com.objectstack.test.audit-option-label-summary';

/**
 * A REAL zh-CN bundle in the shipped key shape
 * (`objects.<object>.fields.<field>.options.<value>` — see
 * `translations/zh-CN.objects.generated.ts`, `sys_audit_log.fields.action`).
 *
 * Three absences/presences are load-bearing rather than incidental:
 *  - `stage.options.on_hold` is ABSENT → per-value authored fallback.
 *  - `priority.options.p2` is ABSENT → same, on the bare-string option shape.
 *  - `channel.options.phone_call` is PRESENT although `phone_call` is not a
 *    declared option → the bundle must NOT be consulted for it.
 */
function makeI18n() {
  const i18n = createMemoryI18n();
  i18n.loadTranslations('zh-CN', {
    objects: {
      biz_deal: {
        label: '商机',
        fields: {
          stage: {
            label: '阶段',
            options: { proposal: '提案中', closed_won: '已赢单', archived: '已归档' },
          },
          priority: { label: '优先级', options: { p1: '最高' } },
          channel: { label: '渠道', options: { web: '网页', phone_call: '电话' } },
          owner: { label: '负责人' },
        },
      },
    },
    // `{{param}}` — the shipped bundles' interpolation syntax, deliberately not
    // the milestone template's single-brace `{token}` (#7333).
    messages: { activityUpdated: '已更新{{object}}"{{label}}"' },
  });
  return i18n;
}

async function boot(opts: { locale?: string; i18n?: unknown } = {}) {
  const engine = new ObjectQL();
  const stub = makeCountingDriver();
  engine.registerDriver(stub.driver, true);
  await engine.init();
  for (const o of [sysAuditLog, sysActivity, crmAccount, sysUserObj, bizDeal]) {
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

const lastSummary = (storeFor: (o: string) => Map<string, Record<string, unknown>>) => {
  const all = summariesOf(storeFor);
  return all.length > 0 ? all[all.length - 1] : undefined;
};

/**
 * `deal_2` already HOLDS `owner` and `account_id`, and that is load-bearing for
 * the read-count section exactly as it was in `audit-lookup-summary.test.ts`:
 * a zero-read guard run against a reference-free row is green for the wrong
 * reason, because there is nothing on the row to read. #7291 measured that
 * (its mutation D passed 160/160 against such a row) and #7333 repeated the
 * warning; the counts here are taken against `deal_2` for that reason.
 */
async function seed(engine: any) {
  await engine.insert('crm_account', { id: 'acc_1', name: 'Acme Corp' });
  await engine.insert('sys_user', { id: 'usr_1', name: '张伟', email: 'z@example.com' });
  await engine.insert('biz_deal', {
    id: 'deal_2', title: 'Already linked', stage: 'proposal', priority: 'p2',
    channel: 'web', owner: 'usr_1', account_id: 'acc_1',
  });
  return engine.insert('biz_deal', {
    id: 'deal_1', title: 'Ship it', stage: 'proposal', priority: 'p2', channel: 'web',
  });
}

const setStage = (engine: any, id: string, stage: string) =>
  engine.update('biz_deal', { stage }, { where: { id } } as any);

// ---------------------------------------------------------------------------
// 1. The reported defect — the tracked-change branch localizes option labels
// ---------------------------------------------------------------------------

describe('[#7289] tracked-change branch — select option labels resolve through the bundle', () => {
  it('localizes the option label on BOTH sides of the diff (the reported string)', async () => {
    const { engine, storeFor } = await boot({ locale: 'zh-CN', i18n: makeI18n() });
    await seed(engine);

    await setStage(engine, 'deal_1', 'closed_won');

    // Was `阶段: Proposal → Closed Won` — localized frame, authored values.
    expect(lastSummary(storeFor)).toBe('阶段: 提案中 → 已赢单');
  });

  it('falls back to the AUTHORED option label per VALUE, not per field', async () => {
    const { engine, storeFor } = await boot({ locale: 'zh-CN', i18n: makeI18n() });
    await seed(engine);

    // `stage.options.on_hold` is absent from the bundle; `proposal` is present.
    // A mixed assertion on purpose: a single-sided one would survive deleting
    // the translate limb, which is the trap #7291 measured on its raw-id case.
    await setStage(engine, 'deal_1', 'on_hold');

    expect(lastSummary(storeFor)).toBe('阶段: 提案中 → On Hold');
  });

  it('localizes the BARE-STRING option shape, whose authored label is the value', async () => {
    const { engine, storeFor } = await boot({ locale: 'zh-CN', i18n: makeI18n() });
    await seed(engine);

    // `options: ['p1', 'p2']` → the authored label chain has only `ov` in it.
    // `p1` is in the bundle, `p2` is not, so both directions are pinned here.
    await engine.update('biz_deal', { priority: 'p1' }, { where: { id: 'deal_1' } } as any);

    expect(lastSummary(storeFor)).toBe('优先级: p2 → 最高');
  });

  it('renders String(value) for a value matching NO declared option, bundle key or not', async () => {
    const { engine, storeFor } = await boot({ locale: 'zh-CN', i18n: makeI18n() });
    await seed(engine);

    // The bundle DOES declare `channel.options.phone_call = '电话'`, and
    // `phone_call` is NOT a declared option. Bundles are generated FROM the
    // declared options, so such a key cannot arise in shipped data — it is
    // planted here precisely so this case goes red if the lookup ever escapes
    // the matched-option branch. `web` still localizes, so the case cannot pass
    // by the translate limb being dead.
    await engine.update('biz_deal', { channel: 'phone_call' }, { where: { id: 'deal_1' } } as any);

    expect(lastSummary(storeFor)).toBe('渠道: 网页 → phone_call');
  });

  it('leaves the reference branch (#7230 / #7291) rendering titles beside the options', async () => {
    const { engine, storeFor } = await boot({ locale: 'zh-CN', i18n: makeI18n() });
    await seed(engine);

    await engine.update(
      'biz_deal',
      { stage: 'closed_won', owner: 'usr_1' },
      { where: { id: 'deal_1' } } as any,
    );

    // Option label from the bundle, record title from the read: the two
    // resolutions are independent and both must be present in one summary.
    expect(lastSummary(storeFor)).toBe('阶段: 提案中 → 已赢单; 负责人: ∅ → 张伟');
  });

  it('keeps the authored option label when no i18n service is resolvable', async () => {
    const { engine, storeFor } = await boot({ locale: 'zh-CN', i18n: undefined });
    await seed(engine);

    await setStage(engine, 'deal_1', 'closed_won');

    expect(lastSummary(storeFor)).toBe('Stage: Proposal → Closed Won');
  });

  it('keeps the authored option label when no locale is resolvable (status quo)', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    await setStage(engine, 'deal_1', 'closed_won');

    expect(lastSummary(storeFor)).toBe('Stage: Proposal → Closed Won');
  });
});

// ---------------------------------------------------------------------------
// 2. The milestone branch — the deliberate NON-change, with the locale ON
// ---------------------------------------------------------------------------

describe('[#7289] fired-milestone branch — option labels stay AUTHORED, on purpose', () => {
  it('renders the authored option label inside the untranslated author sentence', async () => {
    const { engine, storeFor } = await boot({ locale: 'zh-CN', i18n: makeI18n() });
    await seed(engine);

    // Two writes, and the first one is the CONTROL: it proves the locale is
    // genuinely live in this boot, so the assertion below cannot be green
    // merely because translation silently failed. Without it this case would
    // pass under a broken translator, which is the shape of green-for-the-
    // wrong-reason #7291 and #7333 both got caught by.
    await setStage(engine, 'deal_2', 'closed_won');
    await setStage(engine, 'deal_2', 'archived');

    const all = summariesOf(storeFor);
    expect(all[all.length - 2]).toBe('阶段: 提案中 → 已赢单');

    // `{stage}` → the AUTHORED `Archived`, although the bundle declares
    // `stage.options.archived = '已归档'`. `{owner}` → `张伟`, because #7290's
    // title resolution is locale-INDEPENDENT data, not a translation. The
    // author's sentence and the author's option label stay in one language.
    expect(all[all.length - 1]).toBe('Deal moved to Archived by 张伟');
  });

  // ⚠️ Status-quo pin, not coverage of this change: the locale is OFF here, so
  // this case did NOT go red under M2 (the rejected design) — its with-locale
  // twin above is the one that bites. What it does pin is the byte-identity
  // BETWEEN the two, which is the contract itself.
  it('is a NON-change: the same milestone renders identically with the locale off', async () => {
    const { engine, storeFor } = await boot();
    await seed(engine);

    await setStage(engine, 'deal_2', 'archived');

    // Byte-identical to the with-locale rendering above. That equality IS the
    // ruling: turning a locale on must not move this branch at all.
    expect(lastSummary(storeFor)).toBe('Deal moved to Archived by 张伟');
  });
});

// ---------------------------------------------------------------------------
// 3. Read cost — a bundle lookup, so ZERO added reads on every shape
// ---------------------------------------------------------------------------

describe('[#7289] localizing an option label is a bundle lookup and adds no reads', () => {
  it('a tracked option-only change pays ZERO reads, on a row that HOLDS references', async () => {
    const { engine, reads, storeFor } = await boot({ locale: 'zh-CN', i18n: makeI18n() });
    await seed(engine);
    const before = { user: reads.findOn['sys_user'] ?? 0, acct: reads.findOn['crm_account'] ?? 0 };

    // `deal_2` holds `owner` and `account_id`; no reference field MOVES, so the
    // #6656 / PR #6977 retirement (2 → 1 single-id, 3 → 0 predicate) stands.
    // Measured: under M5 (resolve from the written row instead of the diff)
    // the COUNT assertion below fires — `expected 1 to be +0` — so this guard
    // bites on the real regression, not only on the trailing summary line.
    await setStage(engine, 'deal_2', 'closed_won');

    expect((reads.findOn['sys_user'] ?? 0) - before.user).toBe(0);
    expect((reads.findOn['crm_account'] ?? 0) - before.acct).toBe(0);
    expect(lastSummary(storeFor)).toBe('阶段: 提案中 → 已赢单');
  });

  // ⚠️ Retained as a forward guard, not as coverage of this change: a create
  // renders through `messages.activityCreated` and never reaches the
  // tracked-change branch, so NO mutation of this change can redden it —
  // measured green under all five, including M5.
  it('a create pays ZERO reads with the locale on', async () => {
    const { engine, reads } = await boot({ locale: 'zh-CN', i18n: makeI18n() });
    await seed(engine);
    const before = { user: reads.findOn['sys_user'] ?? 0, acct: reads.findOn['crm_account'] ?? 0 };

    await engine.insert('biz_deal', {
      id: 'deal_3', title: 'Fresh', stage: 'proposal', owner: 'usr_1', account_id: 'acc_1',
    });

    expect((reads.findOn['sys_user'] ?? 0) - before.user).toBe(0);
    expect((reads.findOn['crm_account'] ?? 0) - before.acct).toBe(0);
  });

  // ⚠️ Cross-check of #7290's profile rather than of this change: it stayed
  // green under all five mutations here. The mutation that reddens it lives in
  // `audit-milestone-summary.test.ts`.
  it('a fired milestone still pays exactly ONE read for its reference token', async () => {
    const { engine, reads } = await boot({ locale: 'zh-CN', i18n: makeI18n() });
    await seed(engine);
    const before = reads.findOn['sys_user'] ?? 0;

    await setStage(engine, 'deal_2', 'archived');

    // #7290's profile, unchanged: the `{stage}` token is a select and costs
    // nothing, `{owner}` costs the one batched read it already did.
    expect((reads.findOn['sys_user'] ?? 0) - before).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. The key shape, resolved against the SHIPPED generated bundle
// ---------------------------------------------------------------------------

describe('[#7289] the option key shape is the shipped bundles own, not a fixture convention', () => {
  it('resolves the exact key the code builds against zh-CN.objects.generated.ts', async () => {
    const i18n = createMemoryI18n();
    i18n.loadTranslations('zh-CN', { objects: zhCNObjects as any });

    // The literal template `displayFieldValue`'s caller composes:
    //   `objects.${objectName}.fields.${key}.options.${value}`
    const objectName = 'sys_audit_log';
    const key = 'action';
    for (const [value, expected] of [['create', '创建'], ['delete', '删除']] as const) {
      expect(i18n.t(`objects.${objectName}.fields.${key}.options.${value}`, 'zh-CN')).toBe(expected);
    }

    // And a miss returns the key verbatim, which is the II18nService contract
    // `translateWith` converts to `undefined` so the authored label answers.
    const missing = `objects.${objectName}.fields.${key}.options.no_such_action`;
    expect(i18n.t(missing, 'zh-CN')).toBe(missing);
  });
});
