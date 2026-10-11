// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22560] The record-reader approval tier (#8652), switched on by the OBJECT'S
 * OWN metadata — `enable: { approvalsVisibleToReaders: true }` — on both doors.
 *
 * ## What the rulings fix, and what each pin below holds
 *
 * #8652 ruled the tier: a caller who can read a record may see that record's
 * approval requests and full action history, READ-ONLY, behind a per-object
 * switch that is default OFF, which the downstream project opts in. Until this
 * card the only switch was a constructor option, which a config-driven app
 * cannot set (its host builds the plugin with no options). The declaration now
 * lives where an app writes it, and the service reads it where it is used:
 * from the object's live registered definition, on every read.
 *
 *  - an object that declares the flag, with the host option EMPTY: a reader of
 *    one of its records sees that record's requests on the approvals door and,
 *    on the generic data door, in all three request tables — read-only, with
 *    no approval action offered or accepted;
 *  - control: an object that declares nothing is unchanged, and a caller who
 *    cannot read the record sees nothing, whatever the object declares;
 *  - the host option still works alone;
 *  - read where it is used: an object registered after the plugin started,
 *    declaring the flag, widens; re-registered without it, it stops — with no
 *    restart. A set collected at start() fails both halves.
 *
 * ## The rig
 *
 * The sibling read-gate suites' (`request-read-gate.integration.test.ts`): a
 * real ObjectQL engine over better-sqlite3, so the flag is read from the real
 * registry; the real `ApprovalsServicePlugin.start()`, so the gates are bound
 * as in a deployment; the real data-door normalizer. RECORD READABILITY is the
 * one stand-in: one middleware per business object refuses a caller with no
 * read on it and scopes one with read to its own records. No security plugin
 * is mounted, so every caller holds read on the `sys_approval_*` tables.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin, type ApprovalsPluginOptions } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';

const REQUEST = 'sys_approval_request';
const ACTION = 'sys_approval_action';
const APPROVER_INDEX = 'sys_approval_approver';
const CHILDREN = [ACTION, APPROVER_INDEX] as const;

/** Declares the opt-in in its own `enable` block. */
const DECLARED = 'exam_sheet';
/** Declares nothing: the control. */
const UNDECLARED = 'memo_sheet';
/** Registered only after the plugin has started. */
const LATE = 'late_sheet';
const PKG = 'approvals-record-reader-opt-in-test';
const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;

const SUBMITTER = 'u_submitter';
const APPROVER = 'u_approver';
/** Reads record `_a` of every business object and participates in nothing. */
const READER = 'u_reader';
/** Holds no read on any business object and participates in nothing. */
const OUTSIDER = 'u_outsider';

const recordA = (object: string) => `${object}_a`;
const recordB = (object: string) => `${object}_b`;

function sheet(name: string, enable?: Record<string, boolean>) {
  return {
    name,
    label: name,
    fields: {
      id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
      title: { name: 'title', label: 'Title', type: 'text' as const },
    },
    ...(enable ? { enable } : {}),
  };
}

const OPT_IN = { approvalsVisibleToReaders: true };

const nodeConfig = {
  approvers: [{ type: 'user' as const, value: APPROVER }],
  behavior: 'first_response' as const,
};

interface Rig {
  engine: ObjectQL;
  svc: ApprovalService;
  protocol: any;
  /** object -> [request on record `_a`, request on record `_b`] */
  requests: Map<string, [string, string]>;
}

let current: ObjectQL | undefined;

afterEach(async () => {
  try { await current?.destroy(); } catch { /* noop */ }
  current = undefined;
});

/** Record readability, the stand-in (see the header), on one business object. */
function guardReads(engine: ObjectQL, object: string): void {
  const readable = new Map<string, Set<string>>([
    [SUBMITTER, new Set([recordA(object), recordB(object)])],
    [APPROVER, new Set([recordA(object), recordB(object)])],
    [READER, new Set([recordA(object)])],
  ]);
  engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
    const ctx = op.context;
    if (READ_OPS.has(op.operation) && ctx && !ctx.isSystem && op.ast) {
      const grants = readable.get(String(ctx.userId ?? ''));
      if (!grants) {
        throw Object.assign(new Error(`[Security] Access denied: no read on '${object}'`), {
          code: 'PERMISSION_DENIED', status: 403,
        });
      }
      const scope = { id: { $in: [...grants] } };
      op.ast.where = op.ast.where ? { $and: [op.ast.where, scope] } : scope;
    }
    return next();
  }, { object });
}

/** Two records of `object` and one request on each, with a reply in each history. */
async function seed(rig: Omit<Rig, 'requests'>, object: string): Promise<[string, string]> {
  const ids: string[] = [];
  for (const recordId of [recordA(object), recordB(object)]) {
    await rig.engine.insert(object, { id: recordId, title: recordId }, { context: SYSTEM } as any);
    const opened = await rig.svc.openNodeRequest({
      object, recordId, runId: `run_${recordId}`, nodeId: 'review', flowName: 'exam_review',
      config: nodeConfig as any, submitterId: SUBMITTER, record: { id: recordId, title: recordId },
    }, asUser(SUBMITTER)) as any;
    await rig.svc.comment(opened.id, { actorId: APPROVER, comment: `reply on ${recordId}` }, asUser(APPROVER));
    ids.push(String(opened.id));
  }
  return [ids[0], ids[1]];
}

async function boot(options: ApprovalsPluginOptions = {}): Promise<Rig> {
  const engine = new ObjectQL();
  current = engine;
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }), true);
  await engine.init();
  for (const def of [
    sheet(DECLARED, OPT_IN), sheet(UNDECLARED),
    SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation,
  ]) {
    engine.registry.registerObject(def as any, PKG, PKG);
  }
  await engine.syncSchemas();
  for (const object of [DECLARED, UNDECLARED]) guardReads(engine, object);

  const services: Record<string, unknown> = { objectql: engine };
  const ctx: any = {
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
      return services[name];
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    // Boot-time sweeps are not under test; they are collected and never fired.
    hook: () => {},
    logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
  };
  await new ApprovalsServicePlugin(options).start(ctx);
  const base = {
    engine,
    svc: services.approvals as ApprovalService,
    protocol: new ObjectStackProtocolImplementation(engine as any),
  };
  const requests = new Map<string, [string, string]>();
  for (const object of [DECLARED, UNDECLARED]) requests.set(object, await seed(base, object));
  return { ...base, requests };
}

/** The ids of `table`'s rows on `requestId`, as the system reads them. */
async function rowIdsOf(rig: Rig, table: string, requestId: string): Promise<string[]> {
  const rows = await rig.engine.find(table, { context: SYSTEM } satisfies EngineQueryOptions) as any[];
  return rows.filter((r) => r.request_id === requestId).map((r) => String(r.id)).sort();
}

/** The data door's list, as `GET /data/TABLE` hands it in. */
async function listIds(rig: Rig, table: string, context: any, query: Record<string, unknown> = {}): Promise<string[]> {
  const res = await rig.protocol.findData({ object: table, query, context });
  return (res.records as any[]).map((r) => String(r.id)).sort();
}

/** The data door's by-id read; the refusal, when it refuses. */
async function byId(rig: Rig, table: string, context: any, id: string): Promise<{ record?: any; error?: any }> {
  try {
    return { record: (await rig.protocol.getData({ object: table, id, context })).record };
  } catch (error) {
    return { error };
  }
}

const NOT_FOUND = { code: 'RECORD_NOT_FOUND', status: 404 };
const envelope = (error: any) => ({ code: error?.code, status: error?.status });

/** A record page's approval list: the record named by implicit field filters. */
const forRecord = (object: string, recordId: string) => ({ object_name: object, record_id: recordId });
/** A request's related list (its Timeline) by implicit field filter. */
const forRequest = (requestId: string) => ({ request_id: requestId });

/**
 * What `caller` is served about `requestId` (on `recordId` of `object`), on
 * both doors and all three tables, as one comparable reading.
 */
async function servedOn(rig: Rig, caller: any, object: string, recordId: string, requestId: string) {
  const children: Record<string, { list: string[]; byId: (string | null)[] }> = {};
  for (const table of CHILDREN) {
    const rows = await rowIdsOf(rig, table, requestId);
    const byIds: (string | null)[] = [];
    for (const row of rows) byIds.push((await byId(rig, table, caller, row)).record?.id ?? null);
    children[table] = { list: await listIds(rig, table, caller, forRequest(requestId)), byId: byIds };
  }
  return {
    approvalsDoor: {
      list: (await rig.svc.listRequests({ object, recordId }, caller)).map((r) => String(r.id)),
      byId: (await rig.svc.getRequest(requestId, caller))?.id ?? null,
      history: (await rig.svc.listActions(requestId, caller)).map((a) => String(a.id)).sort(),
    },
    dataDoor: {
      [REQUEST]: {
        list: await listIds(rig, REQUEST, caller, forRecord(object, recordId)),
        byId: (await byId(rig, REQUEST, caller, requestId)).record?.id ?? null,
      },
      ...children,
    },
  };
}

/** The reading of a caller who is served the request and its whole history. */
async function seesAll(rig: Rig, requestId: string) {
  const actions = await rowIdsOf(rig, ACTION, requestId);
  const approvers = await rowIdsOf(rig, APPROVER_INDEX, requestId);
  expect(actions.length, 'the scene: a submit row and a reply').toBe(2);
  expect(approvers.length, 'the scene: one pending approver').toBe(1);
  return {
    approvalsDoor: { list: [requestId], byId: requestId, history: actions },
    dataDoor: {
      [REQUEST]: { list: [requestId], byId: requestId },
      [ACTION]: { list: actions, byId: actions },
      [APPROVER_INDEX]: { list: approvers, byId: approvers },
    },
  };
}

/** The reading of a caller who is served nothing about the request. */
async function seesNothing(rig: Rig, requestId: string) {
  const none = async (table: string) => (await rowIdsOf(rig, table, requestId)).map(() => null);
  return {
    approvalsDoor: { list: [], byId: null, history: [] },
    dataDoor: {
      [REQUEST]: { list: [], byId: null },
      [ACTION]: { list: [], byId: await none(ACTION) },
      [APPROVER_INDEX]: { list: [], byId: await none(APPROVER_INDEX) },
    },
  };
}

describe('an object that declares enable.approvalsVisibleToReaders, with the host option empty', () => {
  it('a reader of the record sees its request and full history on both doors, in all three tables', async () => {
    const rig = await boot();
    const [requestA] = rig.requests.get(DECLARED)!;
    expect(await servedOn(rig, asUser(READER), DECLARED, recordA(DECLARED), requestA))
      .toEqual(await seesAll(rig, requestA));
  });

  it('read-only: no approval action is offered, and none is accepted', async () => {
    const rig = await boot();
    const [requestA] = rig.requests.get(DECLARED)!;
    const ctx = asUser(READER);
    // Offered: the per-caller affordance block the console gates its decision actions on.
    expect((await rig.svc.getRequest(requestA, ctx))?.viewer)
      .toEqual({ can_act: false, can_override: false, is_submitter: false });
    // …and the data door's row carries no such block at all.
    expect((await byId(rig, REQUEST, ctx, requestA)).record).not.toHaveProperty('viewer');
    // Accepted: `FORBIDDEN:` is the code this service's refusals carry, the
    // prefix the REST layer parses into a 403.
    await expect(rig.svc.decide(requestA, { decision: 'approve', actorId: READER }, ctx)).rejects.toThrow(/^FORBIDDEN:/);
    await expect(rig.svc.decide(requestA, { decision: 'reject', actorId: READER }, ctx)).rejects.toThrow(/^FORBIDDEN:/);
    await expect(rig.svc.reassign(requestA, { actorId: READER, to: READER }, ctx)).rejects.toThrow(/^FORBIDDEN:/);
    await expect(rig.svc.comment(requestA, { actorId: READER, comment: 'hi' }, ctx)).rejects.toThrow(/^FORBIDDEN:/);
    await expect(rig.svc.recall(requestA, { actorId: READER }, ctx)).rejects.toThrow(/^FORBIDDEN:/);
  });

  it('a caller who cannot read the record sees nothing: the reader on another record, and a caller with no read', async () => {
    const rig = await boot();
    const [requestA, requestB] = rig.requests.get(DECLARED)!;
    expect(await servedOn(rig, asUser(READER), DECLARED, recordB(DECLARED), requestB))
      .toEqual(await seesNothing(rig, requestB));
    expect(await servedOn(rig, asUser(OUTSIDER), DECLARED, recordA(DECLARED), requestA))
      .toEqual(await seesNothing(rig, requestA));
    // A hidden request answers on the data door exactly as a missing one does.
    expect(envelope((await byId(rig, REQUEST, asUser(OUTSIDER), requestA)).error)).toEqual(NOT_FOUND);
  });

  it('a read that names no record stays the reader\'s participant set: the inbox is not widened', async () => {
    const rig = await boot();
    const ctx = asUser(READER);
    expect(await rig.svc.listRequests({}, ctx)).toEqual([]);
    for (const table of [REQUEST, ...CHILDREN]) expect(await listIds(rig, table, ctx), table).toEqual([]);
  });
});

describe('controls', () => {
  it('an object that declares nothing is unchanged: its reader sees nothing on either door', async () => {
    const rig = await boot();
    const [requestA] = rig.requests.get(UNDECLARED)!;
    // The control half first: this caller really can read the record.
    expect(await rig.engine.find(UNDECLARED, { where: { id: recordA(UNDECLARED) }, context: asUser(READER) })).toHaveLength(1);
    expect(await servedOn(rig, asUser(READER), UNDECLARED, recordA(UNDECLARED), requestA))
      .toEqual(await seesNothing(rig, requestA));
  });

  it('the participants are unchanged by the declaration: the submitter sees both requests of the declared object', async () => {
    const rig = await boot();
    const [requestA, requestB] = rig.requests.get(DECLARED)!;
    for (const [recordId, requestId] of [[recordA(DECLARED), requestA], [recordB(DECLARED), requestB]]) {
      expect(await servedOn(rig, asUser(SUBMITTER), DECLARED, recordId, requestId))
        .toEqual(await seesAll(rig, requestId));
    }
  });

  it('the host option still works alone: naming the undeclared object turns the tier on for it', async () => {
    const rig = await boot({ recordReaderVisibleObjects: [UNDECLARED] });
    const [requestA, requestB] = rig.requests.get(UNDECLARED)!;
    expect(await servedOn(rig, asUser(READER), UNDECLARED, recordA(UNDECLARED), requestA))
      .toEqual(await seesAll(rig, requestA));
    // …bounded by record readability, as the declaration is.
    expect(await servedOn(rig, asUser(READER), UNDECLARED, recordB(UNDECLARED), requestB))
      .toEqual(await seesNothing(rig, requestB));
  });
});

describe('read where it is used: the registry as it is at the read, not at start()', () => {
  it('an object registered after the plugin started, declaring the flag, widens; re-registered without it, it stops, with no restart', async () => {
    const rig = await boot();
    // After start(): the moment an installed package's objects (kernel:ready),
    // a Studio edit or a dev reload arrive.
    rig.engine.registry.registerObject(sheet(LATE, OPT_IN) as any, PKG, PKG);
    await rig.engine.syncSchemas();
    guardReads(rig.engine, LATE);
    const [requestA] = await seed(rig, LATE);
    expect(await servedOn(rig, asUser(READER), LATE, recordA(LATE), requestA))
      .toEqual(await seesAll(rig, requestA));

    // The author removes the flag; the same package re-registers the object.
    rig.engine.registry.registerObject(sheet(LATE) as any, PKG, PKG);
    // The registry really answers the new definition (the control for the read below)…
    expect((rig.engine.getSchema(LATE) as any)?.enable?.approvalsVisibleToReaders).toBeUndefined();
    // …and the tier is off for it at once, on both doors.
    expect(await servedOn(rig, asUser(READER), LATE, recordA(LATE), requestA))
      .toEqual(await seesNothing(rig, requestA));
    // Its participants are untouched by either change.
    expect(await servedOn(rig, asUser(SUBMITTER), LATE, recordA(LATE), requestA))
      .toEqual(await seesAll(rig, requestA));
  });
});
