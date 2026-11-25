// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35723] Approval steps reach the record's activity stream, and only the
 * users who can read the record's approvals read them.
 *
 *  - one `sys_activity` entry per approval step (submitted, approved,
 *    rejected, recalled) about the record the request governs, in the shape the
 *    console reads as the `approval` feed kind: `type: 'system'`,
 *    `metadata.kind: 'approval'`, `source_object: 'sys_approval_request'`;
 *  - no entry for a step the stream does not show (a thread comment);
 *  - on the generic data door, as the record page reads its stream (the record
 *    named by `object_name` + `record_id`): a participant reads the entries, a
 *    reader of the record who participates in nothing reads none — while every
 *    other entry about the record stays served to both, and the stream's count
 *    agrees with its rows — and an object that opts into the record-reader tier
 *    serves the same reader its entries.
 *
 * ## The rig
 *
 * The sibling read-gate suites' (`record-reader-opt-in.integration.test.ts`): a
 * real ObjectQL engine over better-sqlite3, the real
 * `ApprovalsServicePlugin.start()`, so the producer and the gate are bound as in
 * a deployment, and the real data-door normalizer. Two stand-ins: RECORD
 * READABILITY (one middleware per business object scopes a caller to its own
 * records), and `sys_activity`'s definition, which is plugin-audit's — this
 * package does not depend on it, so the suite declares the columns the stream
 * reads. plugin-audit's own parent-record gate is not mounted: what is under
 * test is the narrowing this package adds on top of it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import type { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const PKG = 'approvals-activity-feed-35723-test';
const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);
const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;

const SUBMITTER = 'u_submitter';
const APPROVER = 'u_approver';
/** Reads every record and participates in nothing. */
const READER = 'u_reader';

/** Declares nothing: the record-reader tier stays off. */
const SHEET = 'memo_sheet';
/** Opts into the record-reader tier in its own `enable` block. */
const OPEN_SHEET = 'exam_sheet';

const text = (name: string) => ({ name, label: name, type: 'text' as const });

function sheet(name: string, enable?: Record<string, boolean>) {
  return {
    name,
    label: name,
    fields: { id: { ...text('id'), primaryKey: true }, title: text('title') },
    ...(enable ? { enable } : {}),
  };
}

/** `sys_user`: the columns the entry's actor snapshot reads. */
const sysUser = {
  name: 'sys_user',
  label: 'User',
  nameField: 'name',
  fields: { id: { ...text('id'), primaryKey: true }, name: text('name'), image: text('image'), email: text('email') },
};

/** `sys_activity`, the stand-in (see the header): the columns the stream reads. */
const sysActivity = {
  name: 'sys_activity',
  label: 'Activity Feed',
  fields: {
    id: { ...text('id'), primaryKey: true },
    timestamp: { name: 'timestamp', label: 'Timestamp', type: 'datetime' as const },
    type: text('type'),
    summary: text('summary'),
    actor_id: text('actor_id'),
    actor_name: text('actor_name'),
    actor_avatar_url: text('actor_avatar_url'),
    object_name: text('object_name'),
    record_id: text('record_id'),
    source_object: text('source_object'),
    source_id: text('source_id'),
    metadata: { name: 'metadata', label: 'Metadata', type: 'textarea' as const },
  },
};

const nodeConfig = { approvers: [{ type: 'user' as const, value: APPROVER }], behavior: 'first_response' as const };

interface Rig {
  engine: ObjectQL;
  svc: ApprovalService;
  protocol: any;
}

let current: ObjectQL | undefined;

afterEach(async () => {
  try { await current?.destroy(); } catch { /* noop */ }
  current = undefined;
});

function guardReads(engine: ObjectQL, object: string): void {
  engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
    const ctx = op.context;
    if (READ_OPS.has(op.operation) && ctx && !ctx.isSystem && op.ast) {
      const scope = { id: { $like: `${object}_%` } };
      op.ast.where = op.ast.where ? { $and: [op.ast.where, scope] } : scope;
    }
    return next();
  }, { object });
}

async function boot(): Promise<Rig> {
  const engine = new ObjectQL();
  current = engine;
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
  }), true);
  await engine.init();
  for (const def of [
    sheet(SHEET), sheet(OPEN_SHEET, { approvalsVisibleToReaders: true }), sysUser, sysActivity,
    SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation,
  ]) {
    engine.registry.registerObject(def as any, PKG, PKG);
  }
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  for (const object of [SHEET, OPEN_SHEET]) guardReads(engine, object);
  for (const [id, name] of [[SUBMITTER, 'Sam Submitter'], [APPROVER, 'Ada Approver'], [READER, 'Rae Reader']]) {
    await engine.insert('sys_user', { id, name, image: `https://img.example/${id}.png` }, { context: SYSTEM } as any);
  }

  const services: Record<string, unknown> = { objectql: engine };
  const ctx: any = {
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
      return services[name];
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: () => {},
    logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
  };
  await new ApprovalsServicePlugin().start(ctx);
  const svc = services.approvals as ApprovalService;
  svc.attachAutomation({
    resume: async () => ({ status: 'completed' }),
    cancelRun: async () => undefined,
    getRun: async (runId: string) => ({ id: runId, status: 'paused' }),
    getFlow: async () => ({ name: 'memo_review', nodes: [{ id: 'review', type: 'approval' }], edges: [] }),
  } as any);
  return { engine, svc, protocol: new ObjectStackProtocolImplementation(engine as any) };
}

async function open(rig: Rig, object: string, recordId: string): Promise<string> {
  await rig.engine.insert(object, { id: recordId, title: recordId }, { context: SYSTEM } as any);
  const row: any = await rig.svc.openNodeRequest({
    object, recordId, runId: `run_${recordId}`, nodeId: 'review', flowName: 'memo_review',
    config: nodeConfig as any, submitterId: SUBMITTER, record: { id: recordId, title: recordId },
  }, asUser(SUBMITTER));
  return String(row.id);
}

/** Every `sys_activity` row about `recordId`, as the system reads them, oldest first. */
async function entriesOf(rig: Rig, recordId: string): Promise<any[]> {
  const rows = (await rig.engine.find('sys_activity', {
    where: { record_id: recordId }, context: SYSTEM,
  })) as any[];
  return rows.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || 0);
}

/** The record page's stream read on the data door: its rows' summaries and its count. */
async function streamOf(rig: Rig, caller: any, object: string, recordId: string) {
  const res = await rig.protocol.findData({
    object: 'sys_activity',
    query: { object_name: object, record_id: recordId, $count: true },
    context: caller,
  });
  const records = (res.records as any[]);
  return {
    approval: records.filter((r) => r.source_object === 'sys_approval_request').map((r) => r.summary).sort(),
    other: records.filter((r) => r.source_object !== 'sys_approval_request').map((r) => r.summary).sort(),
    total: res.total,
  };
}

const kindOf = (row: any) => JSON.parse(row.metadata);

describe('approval steps on the record activity stream (#35723)', () => {
  it('writes one approval entry per step — submitted, approved, rejected, recalled — about the governed record', async () => {
    const rig = await boot();
    const approved = await open(rig, SHEET, `${SHEET}_approved`);
    await rig.svc.comment(approved, { actorId: APPROVER, comment: 'looking' }, asUser(APPROVER));
    await rig.svc.decideNode(approved, { decision: 'approve', actorId: APPROVER }, asUser(APPROVER));
    const rejected = await open(rig, SHEET, `${SHEET}_rejected`);
    await rig.svc.decideNode(rejected, { decision: 'reject', actorId: APPROVER, comment: 'no budget' }, asUser(APPROVER));
    const recalled = await open(rig, SHEET, `${SHEET}_recalled`);
    await rig.svc.recall(recalled, { actorId: SUBMITTER } as any, asUser(SUBMITTER));

    const cases: Array<[string, string, Array<[string, string]>]> = [
      [`${SHEET}_approved`, approved, [['submit', SUBMITTER], ['approve', APPROVER]]],
      [`${SHEET}_rejected`, rejected, [['submit', SUBMITTER], ['reject', APPROVER]]],
      [`${SHEET}_recalled`, recalled, [['submit', SUBMITTER], ['recall', SUBMITTER]]],
    ];
    for (const [recordId, requestId, steps] of cases) {
      const entries = await entriesOf(rig, recordId);
      // One per step; the thread comment on the first request wrote none.
      expect(entries.map((e) => [kindOf(e).action, e.actor_id]), recordId).toEqual(steps);
      for (const entry of entries) {
        expect(entry).toMatchObject({
          type: 'system',
          object_name: SHEET,
          record_id: recordId,
          source_object: 'sys_approval_request',
          source_id: requestId,
        });
        expect(kindOf(entry).kind).toBe('approval');
        // No decision comment rides on the one line.
        expect(entry.metadata).not.toContain('no budget');
        expect(entry.summary).not.toContain('no budget');
      }
    }
    const [submitted, approvedEntry] = await entriesOf(rig, `${SHEET}_approved`);
    expect(submitted).toMatchObject({
      summary: 'Submitted for approval',
      actor_name: 'Sam Submitter',
      actor_avatar_url: `https://img.example/${SUBMITTER}.png`,
    });
    expect(approvedEntry.summary).toMatch(/^Approved/);
    expect(approvedEntry.actor_name).toBe('Ada Approver');
  });

  it('serves the entries to a participant, none to a reader without approval access, and keeps every other entry', async () => {
    const rig = await boot();
    const recordId = `${SHEET}_a`;
    await open(rig, SHEET, recordId);
    await rig.engine.insert('sys_activity', {
      id: 'act_created', type: 'created', summary: 'Created memo', timestamp: '2026-01-01T00:00:00.000Z',
      object_name: SHEET, record_id: recordId,
    }, { context: SYSTEM } as any);

    const participant = await streamOf(rig, asUser(SUBMITTER), SHEET, recordId);
    expect(participant).toEqual({ approval: ['Submitted for approval'], other: ['Created memo'], total: 2 });

    // The same record, read by a user who can open it but is served none of its approvals.
    expect(await rig.svc.listRequests({ object: SHEET, recordId }, asUser(READER))).toEqual([]);
    const reader = await streamOf(rig, asUser(READER), SHEET, recordId);
    expect(reader).toEqual({ approval: [], other: ['Created memo'], total: 1 });

    // The system's own reads are never narrowed.
    expect((await entriesOf(rig, recordId)).length).toBe(2);
  });

  it('serves a reader the entries of a record whose object opts into the record-reader tier', async () => {
    const rig = await boot();
    const recordId = `${OPEN_SHEET}_a`;
    await open(rig, OPEN_SHEET, recordId);
    expect((await rig.svc.listRequests({ object: OPEN_SHEET, recordId }, asUser(READER))).length).toBe(1);
    const reader = await streamOf(rig, asUser(READER), OPEN_SHEET, recordId);
    expect(reader).toEqual({ approval: ['Submitted for approval'], other: [], total: 1 });
  });
});
