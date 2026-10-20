// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24863] The approvals door names a request's flow, its step and its record's
 * object in the READER's language.
 *
 * ## The defect
 *
 * A request snapshots the flow's and the Approval node's authored labels when
 * it opens, and the approvals door served that snapshot to every reader. A
 * zh-CN, ja-JP or es-ES user saw the authoring language on the inbox, the
 * record's approval panel and the request page, although the app's language
 * pack carried `flows.<flow>.label` and `flows.<flow>.approvals.<node_id>.label`
 * for exactly those strings. The inbox row's `object_label` was the object's
 * schema label, untranslated.
 *
 * ## The rig
 *
 * A real `ObjectQL` over `SqlDriver` (better-sqlite3, in-memory, real DDL), the
 * real `AutomationEngine` running the flow, so the request is opened by the
 * real approval node with the flow name, the flow label and the node label the
 * engine hands it, and the real `ApprovalsServicePlugin`, started over a kernel
 * whose `i18n` service is the real in-memory implementation
 * (`createMemoryI18n`, `@objectstack/core`) loaded with a zh-CN pack the way
 * `AppPlugin` loads one. The pack is parsed by `TranslationDataSchema` first,
 * so every key it carries is one the translation contract declares.
 *
 * Each reader's locale is `ExecutionContext.locale`, the value the REST door's
 * shared assembler resolves from `Accept-Language` (or the `localization`
 * settings) before it calls the service.
 *
 * ## What it pins
 *
 *  - a zh-CN reader is served the zh-CN flow label, step label (under both of
 *    its names) and object label on the record's approval panel (the list
 *    filtered to one record), the inbox (the list filtered to an approver),
 *    the get, and the get's step progress;
 *  - a decision's echo is served in the decider's locale;
 *  - a reader in a locale no pack holds (ja-JP) is served the stored snapshot;
 *  - an en reader and a reader with no locale are served exactly what the door
 *    served before;
 *  - a label the pack does not carry is served as stored beside one it does;
 *  - the stored row is never rewritten: it keeps the authored text it opened
 *    with.
 *
 * ⚠️ Direction, predicted before running: every zh-CN pin is RED on the unfixed
 * door (it served the snapshot whatever the locale); every "as stored" pin is
 * green on both sides on purpose, fencing the fallback.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationEngine } from '@objectstack/service-automation';
import { createMemoryI18n } from '@objectstack/core';
import { TranslationDataSchema } from '@objectstack/spec/system';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import type { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const reader = (userId: string, locale?: string) =>
  ({ userId, positions: [], permissions: [], ...(locale ? { locale } : {}) }) as any;
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

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

/** What the door served before: the authored labels, as the request stored them. */
const AS_STORED = {
  process_label: 'Account Approval',
  step_label: 'Manager Review',
  current_step_label: 'Manager Review',
  object_label: 'Account',
};
const IN_ZH = {
  process_label: '客户审批',
  step_label: '经理审核',
  current_step_label: '经理审核',
  object_label: '客户',
};

const labelsOf = (row: any) => ({
  process_label: row?.process_label,
  step_label: row?.step_label,
  current_step_label: row?.current_step_label,
  object_label: row?.object_label,
});

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

describe('[#24863] the approvals door serves a request\'s labels in the reader\'s locale', () => {
  let engine: ObjectQL;
  let automation: AutomationEngine;
  let svc: ApprovalService;
  let seq = 0;

  /** Start the flow on a fresh account as the submitter; answer the request it paused on. */
  const submit = async (): Promise<any> => {
    const id = `acc_${++seq}`;
    const record = { id, name: `Acme ${seq}` };
    await engine.insert(OBJECT, record, { context: SYSTEM } as any);
    const run = await automation.execute(FLOW.name, { object: OBJECT, record, userId: SUBMITTER } as any);
    expect(run.status, 'the run paused on its first approval step').toBe('paused');
    const rows: any[] = await engine.find('sys_approval_request', {
      where: { record_id: id, status: 'pending' }, context: SYSTEM,
    } satisfies EngineQueryOptions);
    expect(rows).toHaveLength(1);
    return rows[0];
  };
  const stored = async (requestId: string): Promise<any> =>
    engine.findOne('sys_approval_request', { where: { id: requestId } }, { context: SYSTEM });

  beforeAll(async () => {
    // The pack a deployment would ship is one the contract accepts, key for key.
    const parsed = TranslationDataSchema.safeParse(ZH_PACK) as { success: boolean; error?: unknown };
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);

    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [sysUser, account, ...(await packageObjects())]) {
      engine.registry.registerObject(def as any, 'approvals-reader-locale-test', 'approvals-reader-locale-test');
    }
    await engine.syncSchemas();
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
    // The real plugin: it registers the approval node on the engine and wires
    // the service to the kernel's `i18n` service.
    await new ApprovalsServicePlugin().start(ctx);
    svc = services.approvals as ApprovalService;
    automation.registerFlow(FLOW.name, FLOW as any);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the request opened with the authored labels, as the engine handed them over', async () => {
    const req = await submit();
    expect([req.process_name, req.current_step]).toEqual(['flow:account_approval', 'manager_review']);
    expect([req.process_label, req.current_step_label]).toEqual(['Account Approval', 'Manager Review']);
  });

  describe('a zh-CN reader', () => {
    it('the record\'s approval panel: the list filtered to the record', async () => {
      const req = await submit();
      const rows = await svc.listRequests({ object: OBJECT, recordId: req.record_id }, reader(SUBMITTER, 'zh-CN'));
      expect(rows.map((r) => r.id)).toEqual([req.id]);
      expect(labelsOf(rows[0])).toEqual(IN_ZH);
    });

    it('the inbox: the list filtered to the approver', async () => {
      const req = await submit();
      const rows = await svc.listRequests({ approverId: MANAGER, status: 'pending' }, reader(MANAGER, 'zh-CN'));
      const row = rows.find((r) => r.id === req.id);
      expect(row, 'the request is in the approver\'s inbox').toBeDefined();
      expect(labelsOf(row)).toEqual(IN_ZH);
    });

    it('a bare `zh` reaches the zh-CN pack', async () => {
      const req = await submit();
      expect(labelsOf(await svc.getRequest(req.id, reader(SUBMITTER, 'zh')))).toEqual(IN_ZH);
    });

    it('the get, and its step progress: a step the pack carries in zh-CN, a step it does not as authored', async () => {
      const req = await submit();
      const row: any = await svc.getRequest(req.id, reader(MANAGER, 'zh-CN'));
      expect(labelsOf(row)).toEqual(IN_ZH);
      expect(row.flow_steps).toEqual([
        { id: 'manager_review', label: '经理审核', state: 'current' },
        { id: 'director_review', label: 'Director Review', state: 'upcoming' },
      ]);
    });

    it('a decision\'s echo is served in the decider\'s locale', async () => {
      const req = await submit();
      const out = await svc.decide(req.id, { decision: 'approve', actorId: MANAGER }, reader(MANAGER, 'zh-CN'));
      expect(out.finalized).toBe(true);
      expect(labelsOf(out.request)).toEqual(IN_ZH);
    });

    it('a step the pack does not carry is served as stored, beside the flow label it does', async () => {
      const req = await submit();
      await svc.decide(req.id, { decision: 'approve', actorId: MANAGER }, reader(MANAGER));
      const next: any[] = await engine.find('sys_approval_request', {
        where: { record_id: req.record_id, status: 'pending' }, context: SYSTEM,
      } satisfies EngineQueryOptions);
      expect(next.map((r) => r.current_step)).toEqual(['director_review']);
      const row = await svc.getRequest(next[0].id, reader(DIRECTOR, 'zh-CN'));
      expect(labelsOf(row)).toEqual({
        process_label: '客户审批',
        step_label: 'Director Review',
        current_step_label: 'Director Review',
        object_label: '客户',
      });
    });
  });

  it('a reader in a locale no pack holds is served the stored snapshot', async () => {
    const req = await submit();
    expect(labelsOf(await svc.getRequest(req.id, reader(SUBMITTER, 'ja-JP')))).toEqual(AS_STORED);
    const rows = await svc.listRequests({ approverId: MANAGER, status: 'pending' }, reader(MANAGER, 'ja-JP'));
    expect(labelsOf(rows.find((r) => r.id === req.id))).toEqual(AS_STORED);
  });

  it('an en reader, and a reader with no locale, are served what the door served before', async () => {
    const req = await submit();
    for (const locale of ['en', undefined]) {
      expect(labelsOf(await svc.getRequest(req.id, reader(SUBMITTER, locale))), String(locale)).toEqual(AS_STORED);
      const rows = await svc.listRequests({ object: OBJECT, recordId: req.record_id }, reader(SUBMITTER, locale));
      expect(labelsOf(rows[0]), String(locale)).toEqual(AS_STORED);
    }
  });

  it('the stored row keeps the authored text it opened with, after every read', async () => {
    const req = await submit();
    await svc.getRequest(req.id, reader(SUBMITTER, 'zh-CN'));
    await svc.listRequests({ approverId: MANAGER }, reader(MANAGER, 'zh-CN'));
    const row = await stored(req.id);
    expect([row.process_label, row.current_step_label]).toEqual(['Account Approval', 'Manager Review']);
  });
});
