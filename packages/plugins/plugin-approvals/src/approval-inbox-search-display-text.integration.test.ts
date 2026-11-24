// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The inbox's free-text search finds a request by the text its row SHOWS the
 * caller: the record's title, the process label, the requester's name and the
 * object's label, and by nothing the same caller is not shown.
 *
 * ## What was wrong
 *
 * The search box promises "Search record, process, requester…", but the `q`
 * predicate matched only machine columns of `sys_approval_request`
 * (`process_name`, `object_name`, `record_id`, `submitter_id`) and, gated, the
 * raw snapshot. Every label a row renders is resolved when the row is served
 * (`enrichRows`, `localizeRequestLabels`), so typing any of it answered an empty
 * list, while a machine fragment nobody sees (`crm_`) answered every row.
 *
 * ## The invariant
 *
 * A match path may never find a request by text the same caller would not be
 * served for that row. Each term is matched against the label as the serve path
 * computes it FOR THIS CALLER:
 *
 *  - the record title as served, picked from the record after the caller's
 *    readable-and-unmasked fields narrow it (`resolveReadableSnapshotFields`,
 *    the seam the snapshot redaction reads): a title field the caller may not
 *    read, or reads masked, finds nothing;
 *  - the process label the caller reads: the reader's-locale translation where
 *    one is picked, the stored label where none is, never the one they are not
 *    shown;
 *  - the object label the caller reads, by the same pick;
 *  - the requester name, by the resolver the row's `submitter_name` comes from.
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory, real DDL), so `$contains`, `$in` and
 * `$or` are the driver's own.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createMemoryI18n } from '@objectstack/core';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const APPROVER = 'u_appr';
const asApprover = (locale?: string) =>
  ({ userId: APPROVER, positions: [], permissions: [], ...(locale ? { locale } : {}) }) as any;

const USERS = [
  { id: 'u_dev', name: 'Dev Admin', email: 'dev@example.com' },
  { id: 'u_sam', name: 'Sam Submitter', email: 'sam@example.com' },
  { id: APPROVER, name: 'Ann Approver', email: 'ann@example.com' },
];

const text = (name: string, label: string) => ({ name, label, type: 'text' as const });
const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: { id: { ...text('id', 'Id'), primaryKey: true }, name: text('name', 'Name'), email: text('email', 'Email') },
};
const opportunity = {
  name: 'crm_opportunity',
  label: '商机',
  nameField: 'name',
  fields: { id: { ...text('id', 'Id'), primaryKey: true }, name: text('name', 'Name'), stage: text('stage', 'Stage') },
};
const travel = {
  name: 'crm_travel_request',
  label: '出差申请',
  nameField: 'name',
  fields: { id: { ...text('id', 'Id'), primaryKey: true }, name: text('name', 'Name') },
};

const OPP_TITLE = 'Polar Cargo – Replacement';
const TRAVEL_TITLE = 'UI测试：拜访上海客户';
const OPP_FLOW = { name: 'large_opportunity_approval', label: '大额商机审批' };
const TRAVEL_FLOW = { name: 'travel_request_approval', label: '出差申请审批' };
/** The zh-CN pack's translation of the travel flow's label — what a zh-CN reader is served instead. */
const TRAVEL_FLOW_ZH = '差旅审批';

async function packageObjects(): Promise<any[]> {
  let manifest: any;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: any) => { manifest = m; } };
      throw new Error(`no service '${name}'`);
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
  await new ApprovalsServicePlugin().init(ctx);
  return manifest.objects;
}

/**
 * Field-visibility double standing in for `plugin-security`: the read
 * projection and the unmasked (queryable) projection, per object, for the
 * approver. An object it has no answer for is `undefined` (the seam's
 * pass-through), as is every system ask.
 */
function visibility(readable: Record<string, string[]>, unmasked: Record<string, string[]> = readable) {
  return {
    async getReadableFields(object: string, context?: any) {
      return context?.isSystem ? undefined : readable[object];
    },
    async getQueryableFields(object: string, context?: any) {
      return context?.isSystem ? undefined : unmasked[object];
    },
  };
}

describe('the inbox search finds a request by the text its row shows the caller', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  let i18nOn = false;
  let now = Date.parse('2026-11-24T09:00:00.000Z');
  let oppRequest = '';
  let travelRequest = '';

  const i18n = createMemoryI18n();
  i18n.loadTranslations('zh-CN', { flows: { [TRAVEL_FLOW.name]: { label: TRAVEL_FLOW_ZH } } });

  const open = async (
    object: string, recordId: string, title: string, flow: { name: string; label: string }, submitterId: string,
  ) => {
    await engine.insert(object, { id: recordId, name: title }, { context: SYSTEM } as any);
    const row: any = await svc.openNodeRequest({
      object, recordId, runId: `run_${recordId}`, nodeId: 'review',
      flowName: flow.name, flowLabel: flow.label, nodeLabel: 'Review',
      config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response' } as any,
      submitterId, record: { id: recordId, name: title },
    }, { userId: submitterId, positions: [], permissions: [] } as any);
    return row.id as string;
  };
  const ids = async (q: string, extra: Record<string, unknown> = {}, ctx = asApprover()) =>
    (await svc.listRequests({ q, limit: 50, offset: 0, ...extra }, ctx)).map((r) => r.id).sort();

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [sysUser, opportunity, travel, ...(await packageObjects())]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    for (const u of USERS) await engine.insert('sys_user', u, { context: SYSTEM } as any);

    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      i18nServiceSource: () => (i18nOn ? i18n : undefined),
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
    });
    oppRequest = await open('crm_opportunity', 'opp_1', OPP_TITLE, OPP_FLOW, 'u_dev');
    travelRequest = await open('crm_travel_request', 'trv_1', TRAVEL_TITLE, TRAVEL_FLOW, 'u_sam');
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  beforeEach(() => {
    i18nOn = false;
    svc.attachFieldVisibility(undefined);
  });

  it('serves the labels the terms below are taken from (the fixture is what the row shows)', async () => {
    const rows = await svc.listRequests({ limit: 50, offset: 0 }, asApprover());
    const opp: any = rows.find((r) => r.id === oppRequest);
    const trv: any = rows.find((r) => r.id === travelRequest);
    expect(opp).toMatchObject({
      record_title: OPP_TITLE, process_label: OPP_FLOW.label, submitter_name: 'Dev Admin', object_label: '商机',
    });
    expect(trv).toMatchObject({
      record_title: TRAVEL_TITLE, process_label: TRAVEL_FLOW.label, submitter_name: 'Sam Submitter', object_label: '出差申请',
    });
  });

  describe('each filer term finds its row', () => {
    it.each([
      ['Polar', 'opp'], ['Cargo', 'opp'], ['上海', 'trv'], ['拜访', 'trv'], ['UI测试', 'trv'],
    ])('record title: %s', async (q, which) => {
      expect(await ids(q)).toEqual([which === 'opp' ? oppRequest : travelRequest]);
    });

    it.each([['大额', 'opp'], ['出差申请审批', 'trv']])('process label: %s', async (q, which) => {
      expect(await ids(q)).toEqual([which === 'opp' ? oppRequest : travelRequest]);
    });

    it.each([['Dev', 'opp'], ['Admin', 'opp'], ['Sam Submitter', 'trv']])('requester name: %s', async (q, which) => {
      expect(await ids(q)).toEqual([which === 'opp' ? oppRequest : travelRequest]);
    });

    it('object label: 商机', async () => {
      expect(await ids('商机')).toEqual([oppRequest]);
    });

    it('a term in two labels of one row finds that row once (出差: the travel object\'s label and its process label)', async () => {
      expect(await ids('出差')).toEqual([travelRequest]);
    });

    it('with the object filter set, as the filer also tried', async () => {
      expect(await ids('Polar', { object: 'crm_opportunity' })).toEqual([oppRequest]);
      expect(await ids('上海', { object: 'crm_travel_request' })).toEqual([travelRequest]);
    });

    it('`countRequests` agrees with the list it paginates', async () => {
      expect(await svc.countRequests({ q: 'Polar' }, asApprover())).toBe(1);
      expect(await svc.countRequests({ q: 'Dev' }, asApprover())).toBe(1);
    });
  });

  describe('control: the machine columns still match', () => {
    it('an object-name prefix finds every row, and a process-name fragment its row', async () => {
      expect(await ids('crm_')).toEqual([oppRequest, travelRequest].sort());
      expect(await ids('large_opportunity')).toEqual([oppRequest]);
    });

    it('a term no row shows and no machine column holds finds nothing', async () => {
      expect(await ids('Zanzibar')).toEqual([]);
    });
  });

  describe('a term the caller is not served finds nothing', () => {
    it('a title field the caller may not read: the title does not match (control: readable, it does)', async () => {
      svc.attachFieldVisibility(visibility({ crm_opportunity: ['id', 'stage'] }));
      expect(await ids('Polar')).toEqual([]);
      expect(await ids('Polar', { object: 'crm_opportunity' })).toEqual([]);
      // What the same caller is served for that row carries no such title.
      const served: any = (await svc.listRequests({ limit: 50, offset: 0 }, asApprover()))
        .find((r) => r.id === oppRequest);
      expect(String(served.record_title ?? '')).not.toContain('Polar');

      svc.attachFieldVisibility(visibility({ crm_opportunity: ['id', 'name', 'stage'] }));
      expect(await ids('Polar')).toEqual([oppRequest]);
    });

    it('a title field the caller reads MASKED: the title does not match', async () => {
      svc.attachFieldVisibility(visibility(
        { crm_opportunity: ['id', 'name', 'stage'] },
        { crm_opportunity: ['id', 'stage'] },
      ));
      expect(await ids('Polar')).toEqual([]);
      expect(await ids('Polar', { object: 'crm_opportunity' })).toEqual([]);
    });

    it('a reader served the translated process label is not found by the stored one', async () => {
      i18nOn = true;
      const zh = asApprover('zh-CN');
      const served: any = (await svc.listRequests({ limit: 50, offset: 0 }, zh)).find((r) => r.id === travelRequest);
      expect(served.process_label).toBe(TRAVEL_FLOW_ZH);

      expect(await ids('差旅', {}, zh)).toEqual([travelRequest]);
      expect(await ids('出差申请审批', {}, zh)).toEqual([]);
      // The untranslated flow still matches by its stored label for the same reader.
      expect(await ids('大额', {}, zh)).toEqual([oppRequest]);
      // A reader with no locale is served the stored label, and found by it.
      expect(await ids('出差申请审批')).toEqual([travelRequest]);
      expect(await ids('差旅')).toEqual([]);
    });
  });
});
