// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37531] The generic data door serves an approval action row's step label
 * and the notes the platform writes on it in the READER's language, by the
 * render the approvals door's timeline is served by.
 *
 * Setup's Approval Actions list (`sys_approval_action`, views `recent`,
 * `by_actor`, `all_actions`) and the action's record page read the generic
 * data door. A zh-CN reader is served there: the step's label from the app's
 * pack; the system notes the platform stores as data (here the submitter
 * exclusion note) and the record-deleted cancellation in zh-CN; a comment a
 * person wrote as they wrote it.
 *
 * ## The rig
 *
 * The rig of `reader-locale-labels-data-door.integration.test.ts`: a real
 * `ObjectQL` over `SqlDriver` (better-sqlite3, in-memory), the real
 * `AutomationEngine` running the flow through the real approval node, the
 * real `ApprovalsServicePlugin`, and the real in-memory `i18n` service loaded
 * with a zh-CN pack that holds the flow's labels and this plugin's zh-CN
 * `messages` face. The data door is `ObjectStackProtocolImplementation`'s
 * `findData` / `getData`, the calls `GET /api/v1/data/sys_approval_action`
 * and `GET …/:id` make.
 *
 * ⚠️ Direction, predicted before running: every zh-CN pin on the data door is
 * RED on the unfixed door (it served the stored text whatever the locale);
 * every "as stored" pin is green on both sides on purpose, fencing the
 * fallback.
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
import { approvalMessages, enMessages } from './translations/messages.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const reader = (userId: string, locale?: string) =>
  ({ userId, positions: [], permissions: [], ...(locale ? { locale } : {}) }) as any;
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

const REQUEST = 'sys_approval_request';
const ACTION = 'sys_approval_action';
const SUBMITTER = 'u_sub';
const MANAGER = 'u_mgr';
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

/**
 * One approval step whose slate names the submitter and the manager, with
 * `excludeSubmitter`: the request opens on the manager alone and writes the
 * submitter exclusion note (route `remaining_approvers`).
 */
const FLOW = {
  name: 'account_approval', label: 'Account Approval', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'manager_review', type: 'approval', label: 'Manager Review',
      config: { approvers: [{ type: 'user', value: SUBMITTER }, { type: 'user', value: MANAGER }], excludeSubmitter: true },
    },
    { id: 'ok', type: 'end', label: 'Approved' },
    { id: 'no', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'manager_review' },
    { id: 'e2', source: 'manager_review', target: 'ok', label: 'approve' },
    { id: 'e3', source: 'manager_review', target: 'no', label: 'reject' },
  ],
};

const ZH = approvalMessages['zh-CN'] as Record<string, string>;
/** The app's zh-CN pack: the subject object, the flow and its step — plus this plugin's `messages` face. */
const ZH_PACK = {
  objects: { [OBJECT]: { label: '客户' } },
  flows: { account_approval: { label: '客户审批', approvals: { manager_review: { label: '经理审核' } } } },
  messages: ZH,
};

const EXCLUDED_EN = enMessages.approvalSubmitterExcludedRemaining;
const EXCLUDED_ZH = ZH.approvalSubmitterExcludedRemaining;
const cancelledEn = (record: string) =>
  `Auto-cancelled: the ${OBJECT} record '${record}' this request is about was deleted`;
const cancelledZh = (record: string) => `已自动取消：本申请所针对的客户记录「${record}」已被删除`;

/** Setup's Approval Actions list as the console grid reads it: the `recent` view's columns, nothing else. */
const RECENT_SELECT = 'created_at,record_id,request_id,step_label,action,actor_id,acted_as_label,via_override,comment';
/** A projection that selects the two texts and none of the columns they are picked by. */
const TEXTS_ONLY_SELECT = 'step_label,comment';

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

describe('[#37531] the data door serves an approval action\'s step label and system notes in the reader\'s locale', () => {
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
    expect(run.status, 'the run paused on its approval step').toBe('paused');
    const rows: any[] = await engine.find(REQUEST, {
      where: { record_id: id, status: 'pending' }, context: SYSTEM,
    } satisfies EngineQueryOptions);
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  /** `GET /data/sys_approval_action?request_id=…`: the rows the door hands back, oldest first. */
  const listActions = async (context: any, requestId: string, query: Record<string, unknown> = {}): Promise<any[]> => {
    const res: any = await protocol.findData({
      object: ACTION, query: { request_id: requestId, $orderby: 'created_at', ...query }, context,
    });
    return res.records;
  };
  /** The stored rows, read as the system. */
  const storedActions = async (requestId: string): Promise<any[]> => engine.find(ACTION, {
    where: { request_id: requestId }, orderBy: [{ field: 'created_at', order: 'asc' }], context: SYSTEM,
  });
  const noteRow = (rows: any[]) => rows.find((r) => r.action === 'comment' && !r.actor_id);

  beforeAll(async () => {
    const parsed = TranslationDataSchema.safeParse(ZH_PACK) as { success: boolean; error?: unknown };
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);

    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [sysUser, account, ...(await packageObjects())]) {
      engine.registry.registerObject(def as any, 'approvals-action-locale-test', 'approvals-action-locale-test');
    }
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    for (const [id, name] of [[SUBMITTER, 'Sam Submitter'], [MANAGER, 'Mona Manager']]) {
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

  it('the rig wrote what the pins read: the exclusion note and a step label in English', async () => {
    const req = await submit();
    const stored = await storedActions(req.id);
    expect(noteRow(stored)?.comment).toBe(EXCLUDED_EN);
    expect(stored.every((r) => r.step_label === 'Manager Review' || r.step_label == null)).toBe(true);
    expect(stored.some((r) => r.step_label === 'Manager Review')).toBe(true);
  });

  describe('a zh-CN reader', () => {
    it('Setup\'s list, projected to its columns: the step and the note in zh-CN, a person\'s comment as written, only the columns it selected', async () => {
      const req = await submit();
      await svc.decide(req.id, { decision: 'approve', actorId: MANAGER, comment: 'Looks fine to me' }, reader(MANAGER));
      const rows = await listActions(reader(SUBMITTER, 'zh-CN'), req.id, { $select: RECENT_SELECT });
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const row of rows) if (row.step_label != null) expect(row.step_label).toBe('经理审核');
      expect(noteRow(rows)?.comment).toBe(EXCLUDED_ZH);
      const decision = rows.find((r) => r.action === 'approve');
      expect(decision?.step_label).toBe('经理审核');
      expect(decision?.comment).toBe('Looks fine to me');
      for (const row of rows) {
        expect(Object.keys(row)).not.toContain('step_name');
        expect(Object.keys(row)).not.toContain('id');
      }
    });

    it('a projection without any of the key columns is still translated, and still served only what it selected', async () => {
      const req = await submit();
      const rows = await listActions(reader(SUBMITTER, 'zh-CN'), req.id, { $select: TEXTS_ONLY_SELECT });
      expect(rows.map((r) => r.comment)).toContain(EXCLUDED_ZH);
      expect(rows.some((r) => r.step_label === '经理审核')).toBe(true);
      for (const row of rows) {
        expect(Object.keys(row).filter((k) => !['step_label', 'comment'].includes(k))).toEqual([]);
      }
    });

    it('the record page: the by-id read of the note row', async () => {
      const req = await submit();
      const note = noteRow(await storedActions(req.id));
      const res: any = await protocol.getData({ object: ACTION, id: note.id, context: reader(SUBMITTER, 'zh-CN') } as any);
      expect(res.record.comment).toBe(EXCLUDED_ZH);
    });

    it('the record-deleted cancellation, re-composed from the request with the object in zh-CN; its stored English is the sentence it always was', async () => {
      const req = await submit();
      await svc.cancelForDeletedRecord(OBJECT, req.record_id);
      const stored = (await storedActions(req.id)).find((r) => r.action === 'cancel');
      expect(stored?.comment).toBe(cancelledEn(req.record_id));
      const rows = await listActions(reader(SUBMITTER, 'zh-CN'), req.id, { $select: RECENT_SELECT });
      expect(rows.find((r) => r.action === 'cancel')?.comment).toBe(cancelledZh(req.record_id));
    });

    it('parity: the approvals door\'s timeline serves the same note text', async () => {
      const req = await submit();
      await svc.cancelForDeletedRecord(OBJECT, req.record_id);
      const ctx = reader(SUBMITTER, 'zh-CN');
      const timeline = await svc.listActions(req.id, ctx);
      const viaData = await listActions(ctx, req.id, { $select: RECENT_SELECT });
      for (const action of ['comment', 'cancel']) {
        const t = timeline.find((r: any) => r.action === action && !r.actor_id)?.comment;
        const d = viaData.find((r) => r.action === action && !r.actor_id)?.comment;
        expect(t, action).toBeTruthy();
        expect(d, action).toBe(t);
      }
      expect(timeline.find((r: any) => r.action === 'cancel')?.comment).toBe(cancelledZh(req.record_id));
    });
  });

  it('a reader in a locale no pack holds, an en reader and a reader with no locale are served the stored text', async () => {
    const req = await submit();
    await svc.cancelForDeletedRecord(OBJECT, req.record_id);
    for (const locale of ['ja-JP', 'en', undefined]) {
      const rows = await listActions(reader(SUBMITTER, locale), req.id, { $select: RECENT_SELECT });
      expect(noteRow(rows)?.comment, String(locale)).toBe(EXCLUDED_EN);
      expect(rows.find((r) => r.action === 'cancel')?.comment, String(locale)).toBe(cancelledEn(req.record_id));
      expect(rows.filter((r) => r.step_label != null).map((r) => r.step_label), String(locale))
        .toEqual(rows.filter((r) => r.step_label != null).map(() => 'Manager Review'));
    }
  });

  it('a system read is served as stored, a locale on it notwithstanding; and the stored rows keep their text after every read', async () => {
    const req = await submit();
    await listActions(reader(SUBMITTER, 'zh-CN'), req.id, { $select: RECENT_SELECT });
    const rows: any[] = await engine.find(ACTION, { where: { request_id: req.id }, context: { ...SYSTEM, locale: 'zh-CN' } });
    expect(noteRow(rows)?.comment).toBe(EXCLUDED_EN);
    expect(rows.some((r) => r.step_label === 'Manager Review')).toBe(true);
    expect(rows.some((r) => r.step_label === '经理审核')).toBe(false);
  });
});
