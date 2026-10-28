// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27041] The generic data door names a request's flow and step in the
 * READER's language, by the lookup the approvals door applies.
 *
 * ## The defect
 *
 * Setup's request list (`sys_approval_request`, view `all_requests`) reads the
 * generic data door, which served the stored `process_label` /
 * `current_step_label` to every reader: a zh-CN user saw "Account Approval" /
 * "Manager Review" there, while the approvals door served the same rows in
 * zh-CN from the app's language pack (#24863).
 *
 * ## The rig
 *
 * The rig of `reader-locale-display-labels.integration.test.ts`: a real
 * `ObjectQL` over `SqlDriver` (better-sqlite3, in-memory), the real
 * `AutomationEngine` opening the request through the real approval node, and
 * the real `ApprovalsServicePlugin` over a kernel whose `i18n` service is the
 * real in-memory one loaded with a zh-CN pack. The data door is
 * `ObjectStackProtocolImplementation.findData` / `getData`, the calls
 * `GET /api/v1/data/sys_approval_request` and `GET …/:id` make, with the
 * reader's `ExecutionContext.locale` as the REST door's shared assembler
 * resolves it from `Accept-Language`.
 *
 * ## What it pins
 *
 *  - a zh-CN reader is served the zh-CN flow and step labels on the list as
 *    Setup projects it (the labels selected, the machine columns not), on the
 *    full-column list, and on the by-id read;
 *  - the projection is kept: a label selected without its key column is served
 *    without that column;
 *  - parity: the same row read through both doors carries the same label text;
 *  - a step the pack does not carry is served as stored, beside a translated
 *    flow label;
 *  - a reader in a locale no pack holds, an en reader and a reader with no
 *    locale are served the stored text, and a system read is served as stored;
 *  - the door adds no column: no `step_label`, no `object_label`;
 *  - the stored row keeps the authored text.
 *
 * ⚠️ Direction, predicted before running: every zh-CN pin is RED on the unfixed
 * door (it served the stored text whatever the locale); every "as stored" pin is
 * green on both sides on purpose, fencing the fallback.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationEngine } from '@objectstack/service-automation';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { createMemoryI18n } from '@objectstack/core';
import { TranslationDataSchema } from '@objectstack/spec/system';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import type { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const reader = (userId: string, locale?: string) =>
  ({ userId, positions: [], permissions: [], ...(locale ? { locale } : {}) }) as any;
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

const REQUEST = 'sys_approval_request';
const SUBMITTER = 'u_sub';
const MANAGER = 'u_mgr';
const DIRECTOR = 'u_dir';
const OBJECT = 'crm_account';

const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    email: { name: 'email', label: 'Email', type: 'text' as const },
  },
};
const account = {
  name: OBJECT,
  label: 'Account',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};

/** Two approval steps; the pack translates the first step and not the second. */
const FLOW = {
  name: 'account_approval', label: 'Account Approval', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'manager_review', type: 'approval', label: 'Manager Review', config: { approvers: [{ type: 'user', value: MANAGER }] } },
    { id: 'director_review', type: 'approval', label: 'Director Review', config: { approvers: [{ type: 'user', value: DIRECTOR }] } },
    { id: 'ok', type: 'end', label: 'Approved' },
    { id: 'no', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'manager_review' },
    { id: 'e2', source: 'manager_review', target: 'director_review', label: 'approve' },
    { id: 'e3', source: 'manager_review', target: 'no', label: 'reject' },
    { id: 'e4', source: 'director_review', target: 'ok', label: 'approve' },
    { id: 'e5', source: 'director_review', target: 'no', label: 'reject' },
  ],
};

/** The app's zh-CN language pack: the flow, its first step, and the subject object. */
const ZH_PACK = {
  objects: { [OBJECT]: { label: '客户' } },
  flows: {
    account_approval: {
      label: '客户审批',
      approvals: { manager_review: { label: '经理审核' } },
    },
  },
};

const AS_STORED = { process_label: 'Account Approval', current_step_label: 'Manager Review' };
const IN_ZH = { process_label: '客户审批', current_step_label: '经理审核' };

const labelsOf = (row: any) => ({
  process_label: row?.process_label,
  current_step_label: row?.current_step_label,
});

/** Setup's request list as the console grid reads it: `all_requests`' columns, nothing else. */
const ALL_REQUESTS_SELECT = 'process_label,record_id,status,current_step_label,pending_approver_labels,submitter_id,updated_at';

/** The plugin's own object definitions, as its manifest registers them. */
async function packageObjects(): Promise<any[]> {
  let manifest: any;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: any) => { manifest = m; } };
      throw new Error(`no service '${name}'`);
    },
    logger: silent,
  };
  await new ApprovalsServicePlugin().init(ctx);
  return manifest.objects;
}

describe('[#27041] the data door serves a request\'s labels in the reader\'s locale', () => {
  let engine: ObjectQL;
  let automation: AutomationEngine;
  let svc: ApprovalService;
  let protocol: ObjectStackProtocolImplementation;
  let seq = 0;

  /** Start the flow on a fresh account as the submitter; answer the request it paused on. */
  const submit = async (): Promise<any> => {
    const id = `acc_${++seq}`;
    const record = { id, name: `Acme ${seq}` };
    await engine.insert(OBJECT, record, { context: SYSTEM } as any);
    const run = await automation.execute(FLOW.name, { object: OBJECT, record, userId: SUBMITTER } as any);
    expect(run.status, 'the run paused on its first approval step').toBe('paused');
    const rows: any[] = await engine.find(REQUEST, {
      where: { record_id: id, status: 'pending' }, context: SYSTEM,
    } satisfies EngineQueryOptions);
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  /** `GET /data/sys_approval_request?…`: the rows the door hands back for `id`. */
  const listRow = async (context: any, id: string, query: Record<string, unknown> = {}): Promise<any> => {
    const res: any = await protocol.findData({ object: REQUEST, query: { id, ...query }, context });
    expect(res.records, 'the reader is served the request').toHaveLength(1);
    return res.records[0];
  };
  /** `GET /data/sys_approval_request/:id`. */
  const byId = async (context: any, id: string): Promise<any> =>
    (await protocol.getData({ object: REQUEST, id, context } as any)).record;

  beforeAll(async () => {
    const parsed = TranslationDataSchema.safeParse(ZH_PACK) as { success: boolean; error?: unknown };
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);

    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [sysUser, account, ...(await packageObjects())]) {
      engine.registry.registerObject(def as any, 'approvals-data-door-locale-test', 'approvals-data-door-locale-test');
    }
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    for (const [id, name] of [[SUBMITTER, 'Sam Submitter'], [MANAGER, 'Mona Manager'], [DIRECTOR, 'Dina Director']]) {
      await engine.insert('sys_user', { id, name, email: `${id}@example.com` }, { context: SYSTEM } as any);
    }

    automation = new AutomationEngine(silent);
    const i18n = createMemoryI18n();
    i18n.loadTranslations('zh-CN', ZH_PACK);

    const services: Record<string, unknown> = { objectql: engine, automation, i18n };
    const ctx: any = {
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
        return services[name];
      },
      registerService: (name: string, service: unknown) => { services[name] = service; },
      hook: () => {},
      logger: silent,
    };
    await new ApprovalsServicePlugin().start(ctx);
    svc = services.approvals as ApprovalService;
    automation.registerFlow(FLOW.name, FLOW as any);
    protocol = new ObjectStackProtocolImplementation(engine as any);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  describe('a zh-CN reader', () => {
    it('Setup\'s list, projected to its columns: the labels in zh-CN, and only the columns it selected', async () => {
      const req = await submit();
      const row = await listRow(reader(SUBMITTER, 'zh-CN'), req.id, { $select: ALL_REQUESTS_SELECT });
      expect(labelsOf(row)).toEqual(IN_ZH);
      // The key columns the lookup borrowed are not served.
      expect(Object.keys(row)).not.toContain('process_name');
      expect(Object.keys(row)).not.toContain('current_step');
    });

    it('the full-column list: the labels in zh-CN, the machine columns as stored', async () => {
      const req = await submit();
      const row = await listRow(reader(SUBMITTER, 'zh-CN'), req.id);
      expect(labelsOf(row)).toEqual(IN_ZH);
      expect([row.process_name, row.current_step]).toEqual(['flow:account_approval', 'manager_review']);
    });

    it('the by-id read', async () => {
      const req = await submit();
      expect(labelsOf(await byId(reader(SUBMITTER, 'zh-CN'), req.id))).toEqual(IN_ZH);
    });

    it('a bare `zh` reaches the zh-CN pack', async () => {
      const req = await submit();
      expect(labelsOf(await listRow(reader(SUBMITTER, 'zh'), req.id))).toEqual(IN_ZH);
    });

    it('parity: the data door and the approvals door serve the same label text for the same row', async () => {
      const req = await submit();
      const ctx = reader(SUBMITTER, 'zh-CN');
      const viaApprovals = await svc.getRequest(req.id, ctx);
      const viaData = await byId(ctx, req.id);
      const viaList = await listRow(ctx, req.id, { $select: ALL_REQUESTS_SELECT });
      expect(labelsOf(viaData)).toEqual(labelsOf(viaApprovals));
      expect(labelsOf(viaList)).toEqual(labelsOf(viaApprovals));
    });

    it('a step the pack does not carry is served as stored, beside the flow label it does', async () => {
      const req = await submit();
      await svc.decide(req.id, { decision: 'approve', actorId: MANAGER }, reader(MANAGER));
      const next: any[] = await engine.find(REQUEST, {
        where: { record_id: req.record_id, status: 'pending' }, context: SYSTEM,
      } satisfies EngineQueryOptions);
      expect(next.map((r) => r.current_step)).toEqual(['director_review']);
      const row = await listRow(reader(SUBMITTER, 'zh-CN'), next[0].id, { $select: ALL_REQUESTS_SELECT });
      expect(labelsOf(row)).toEqual({ process_label: '客户审批', current_step_label: 'Director Review' });
    });

    it('the door adds no column the object does not declare', async () => {
      const req = await submit();
      const row = await byId(reader(SUBMITTER, 'zh-CN'), req.id);
      expect(Object.keys(row)).not.toContain('step_label');
      expect(Object.keys(row)).not.toContain('object_label');
    });
  });

  it('a reader in a locale no pack holds, an en reader and a reader with no locale are served the stored text', async () => {
    const req = await submit();
    for (const locale of ['ja-JP', 'en', undefined]) {
      expect(labelsOf(await listRow(reader(SUBMITTER, locale), req.id, { $select: ALL_REQUESTS_SELECT })), String(locale))
        .toEqual(AS_STORED);
      expect(labelsOf(await byId(reader(SUBMITTER, locale), req.id)), String(locale)).toEqual(AS_STORED);
    }
  });

  it('a system read is served as stored, a locale on it notwithstanding', async () => {
    const req = await submit();
    const row = await engine.findOne(REQUEST, { where: { id: req.id } }, { context: { ...SYSTEM, locale: 'zh-CN' } });
    expect(labelsOf(row)).toEqual(AS_STORED);
  });

  it('the stored row keeps the authored text it opened with, after every read', async () => {
    const req = await submit();
    await listRow(reader(SUBMITTER, 'zh-CN'), req.id, { $select: ALL_REQUESTS_SELECT });
    await byId(reader(SUBMITTER, 'zh-CN'), req.id);
    const row = await engine.findOne(REQUEST, { where: { id: req.id } }, { context: SYSTEM });
    expect(labelsOf(row)).toEqual(AS_STORED);
  });
});
