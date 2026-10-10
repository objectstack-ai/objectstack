// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22559] `sys_approval_request` on the GENERIC data door serves a caller only
 * the requests the approvals door serves it — one rule for both doors.
 *
 * ## What the rulings fix, and what each pin below holds
 *
 * #8652 ruled the approvals door's visibility: a request's participants
 * (submitter, current approver, past actor) and administrators see it; a
 * reader of the record it is about sees it READ-ONLY, and only on an object a
 * deployment opted in, default OFF. The triage direction for this card is that
 * the data door's reads (`find`, `findOne`, `count`, `aggregate`) apply that
 * same definition, and ⛔ NOT the activity stream's parent-record gate on its
 * own: admitting every reader of the record would switch the tier on for every
 * object.
 *
 *  - a non-participant who cannot read the record sees no row: not in a list,
 *    not in a record's list, not in a count or a grouped count, and by id the
 *    request answers exactly as a missing one does;
 *  - a reader of the record who participates in nothing sees nothing while the
 *    tier is off — the pin that tells this gate from the activity stream's;
 *  - a participant sees their own requests and no one else's;
 *  - with the tier on for the object, a reader of the record sees its requests
 *    on a read that names the record, read-only;
 *  - control: an administrator, and the approval engine's own reads as the
 *    system, are unchanged;
 *  - for every caller, the data door's ids equal the approvals door's.
 *
 * ## The rig
 *
 * A real ObjectQL engine over better-sqlite3 (`@objectstack/driver-sql`), so
 * the conjunct the gate adds is compiled and executed by the SQL builder; the
 * real `ApprovalsServicePlugin.start()`, so a gate that stops being bound fails
 * here like one never written; the real data-door normalizer
 * (`ObjectStackProtocolImplementation.findData` / `getData`), so a record
 * page's related list and a by-id read arrive in the shape that door gives
 * them.
 *
 * The one stand-in is RECORD READABILITY: in a deployment the business
 * object's own CRUD, sharing and RLS decide whether a caller can read a record,
 * and the tier only ever asks the engine as the caller. One middleware on the
 * business object plays that part — a caller with no read on it is refused,
 * one with read sees only its own records. No security plugin is mounted, so
 * every caller here holds read on `sys_approval_request` itself: the app's
 * grant the card's measurement used.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin, type ApprovalsPluginOptions } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';

const REQUEST = 'sys_approval_request';
const OBJECT = 'exam_sheet';
const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;
const ADMIN = { userId: 'u_admin', positions: [], permissions: [], posture: 'PLATFORM_ADMIN' } as any;

const SUBMITTER_A = 'u_submitter_a';
const SUBMITTER_B = 'u_submitter_b';
const APPROVER = 'u_approver';
/** Reads no record of the business object and participates in nothing. */
const OUTSIDER = 'u_outsider';
/** Reads record A and participates in nothing. */
const READER = 'u_reader';

const examSheet = {
  name: OBJECT,
  label: 'Exam Sheet',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
  },
};

const nodeConfig = {
  approvers: [{ type: 'user' as const, value: APPROVER }],
  behavior: 'first_response' as const,
};

interface Rig {
  engine: ObjectQL;
  svc: ApprovalService;
  protocol: any;
  warnings: string[];
  /** The two requests: A on record A by submitter A, B on record B by submitter B. */
  ids: { recordA: string; recordB: string; requestA: string; requestB: string };
}

let current: ObjectQL | undefined;

afterEach(async () => {
  try { await current?.destroy(); } catch { /* noop */ }
  current = undefined;
});

async function boot(
  options: ApprovalsPluginOptions = {},
  /** Runs before the plugin starts, so a middleware it registers wraps the gate. */
  beforeStart?: (engine: ObjectQL) => void,
): Promise<Rig> {
  const engine = new ObjectQL();
  current = engine;
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }), true);
  await engine.init();
  for (const def of [examSheet, SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation]) {
    engine.registry.registerObject(def as any, 'approvals-read-gate-test', 'approvals-read-gate-test');
  }
  await engine.syncSchemas();

  const recordA = 'sheet_a';
  const recordB = 'sheet_b';
  await engine.insert(OBJECT, { id: recordA, title: 'A' }, { context: SYSTEM } as any);
  await engine.insert(OBJECT, { id: recordB, title: 'B' }, { context: SYSTEM } as any);

  // Record readability, the stand-in (see the header): userId -> readable ids.
  const readable = new Map<string, Set<string>>([
    [SUBMITTER_A, new Set([recordA])],
    [SUBMITTER_B, new Set([recordB])],
    [APPROVER, new Set([recordA, recordB])],
    [READER, new Set([recordA])],
    [ADMIN.userId, new Set([recordA, recordB])],
  ]);
  engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
    const ctx = op.context;
    if (READ_OPS.has(op.operation) && ctx && !ctx.isSystem && op.ast) {
      const grants = readable.get(String(ctx.userId ?? ''));
      if (!grants) {
        throw Object.assign(new Error(`[Security] Access denied: no read on '${OBJECT}'`), {
          code: 'PERMISSION_DENIED', status: 403,
        });
      }
      const scope = { id: { $in: [...grants] } };
      op.ast.where = op.ast.where ? { $and: [op.ast.where, scope] } : scope;
    }
    return next();
  }, { object: OBJECT });

  const services: Record<string, unknown> = { objectql: engine };
  const warnings: string[] = [];
  const ctx: any = {
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
      return services[name];
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    // Boot-time sweeps are not under test; they are collected and never fired.
    hook: () => {},
    logger: {
      info: () => {}, debug: () => {}, error: () => {},
      warn: (msg: string) => { warnings.push(String(msg)); },
    },
  };
  beforeStart?.(engine);
  await new ApprovalsServicePlugin(options).start(ctx);
  const svc = services.approvals as ApprovalService;

  const open = async (recordId: string, submitter: string, runId: string) => (await svc.openNodeRequest({
    object: OBJECT, recordId, runId, nodeId: 'review', flowName: 'exam_review',
    config: nodeConfig as any, submitterId: submitter, record: { id: recordId, title: recordId },
  }, asUser(submitter)) as any).id as string;
  const requestA = await open(recordA, SUBMITTER_A, 'run_a');
  const requestB = await open(recordB, SUBMITTER_B, 'run_b');

  return {
    engine, svc, warnings,
    protocol: new ObjectStackProtocolImplementation(engine as any),
    ids: { recordA, recordB, requestA, requestB },
  };
}

/** The data door's list, as `GET /data/sys_approval_request` hands it in. */
async function listIds(rig: Rig, context: any, query: Record<string, unknown> = {}) {
  const res = await rig.protocol.findData({ object: REQUEST, query, context });
  return { ids: (res.records as any[]).map((r) => String(r.id)).sort(), total: res.total as number | undefined };
}

/** A record page's related list: the record named by implicit field filters. */
const forRecord = (recordId: string) => ({ object_name: OBJECT, record_id: recordId });

/** The data door's by-id read; the refusal, when it refuses. */
async function byId(rig: Rig, context: any, id: string): Promise<{ record?: any; error?: any }> {
  try {
    return { record: (await rig.protocol.getData({ object: REQUEST, id, context })).record };
  } catch (error) {
    return { error };
  }
}

describe('the record-reader tier OFF (the default)', () => {
  it('a non-participant who cannot read the record sees no request: list, a record\'s list, count, grouped count', async () => {
    const rig = await boot();
    const ctx = asUser(OUTSIDER);
    expect(await listIds(rig, ctx)).toEqual({ ids: [], total: 0 });
    expect(await listIds(rig, ctx, forRecord(rig.ids.recordA))).toEqual({ ids: [], total: 0 });
    expect(await rig.engine.count(REQUEST, { context: ctx } as any)).toBe(0);
    const groups = await rig.engine.aggregate(REQUEST, {
      groupBy: ['status'], aggregations: [{ function: 'count', alias: 'n' }], context: ctx,
    } as any);
    expect(groups).toEqual([]);
  });

  it('by id, a hidden request answers exactly as a missing one: 404 RECORD_NOT_FOUND', async () => {
    const rig = await boot();
    const hidden = await byId(rig, asUser(OUTSIDER), rig.ids.requestA);
    const missing = await byId(rig, asUser(OUTSIDER), 'no_such_request');
    expect(hidden.record).toBeUndefined();
    expect({ code: hidden.error?.code, status: hidden.error?.status }).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
    expect({ code: missing.error?.code, status: missing.error?.status }).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
  });

  it('a reader of the record who participates in nothing sees nothing while the tier is off', async () => {
    const rig = await boot();
    const ctx = asUser(READER);
    // The control half first: this caller really can read the record.
    expect((await rig.engine.find(OBJECT, { where: { id: rig.ids.recordA }, context: ctx } as any)).length).toBe(1);
    expect(await listIds(rig, ctx, forRecord(rig.ids.recordA))).toEqual({ ids: [], total: 0 });
    expect((await byId(rig, ctx, rig.ids.requestA)).error?.status).toBe(404);
  });

  it('a participant sees their own requests and no one else\'s', async () => {
    const rig = await boot();
    const { requestA, requestB } = rig.ids;
    expect(await listIds(rig, asUser(SUBMITTER_A))).toEqual({ ids: [requestA], total: 1 });
    expect((await byId(rig, asUser(SUBMITTER_A), requestA)).record?.id).toBe(requestA);
    expect((await byId(rig, asUser(SUBMITTER_A), requestB)).error?.status).toBe(404);
    // The current approver of both.
    expect(await listIds(rig, asUser(APPROVER))).toEqual({ ids: [requestA, requestB].sort(), total: 2 });
  });

  it('control: an administrator is unchanged — every request, by list, count and id', async () => {
    const rig = await boot();
    const all = [rig.ids.requestA, rig.ids.requestB].sort();
    expect(await listIds(rig, ADMIN)).toEqual({ ids: all, total: 2 });
    expect(await rig.engine.count(REQUEST, { context: ADMIN } as any)).toBe(2);
    expect((await byId(rig, ADMIN, rig.ids.requestB)).record?.id).toBe(rig.ids.requestB);
  });

  it('control: the approval engine\'s own reads, as the system, are not narrowed', async () => {
    const rig = await boot();
    expect((await rig.engine.find(REQUEST, { context: SYSTEM } as any)).length).toBe(2);
    // …and the approvals door, which reads that way, still serves its callers.
    expect((await rig.svc.listRequests({}, asUser(SUBMITTER_A))).map((r) => r.id)).toEqual([rig.ids.requestA]);
  });

  it('one rule, two doors: for every caller the data door serves the ids the approvals door lists', async () => {
    const rig = await boot();
    for (const ctx of [asUser(OUTSIDER), asUser(READER), asUser(SUBMITTER_A), asUser(SUBMITTER_B), asUser(APPROVER), ADMIN]) {
      for (const [filter, query] of [
        [{}, {}],
        [{ object: OBJECT, recordId: rig.ids.recordA }, forRecord(rig.ids.recordA)],
      ] as const) {
        const served = (await rig.svc.listRequests(filter as any, ctx)).map((r) => String(r.id)).sort();
        expect((await listIds(rig, ctx, query as any)).ids, `${ctx.userId} ${JSON.stringify(query)}`).toEqual(served);
      }
    }
  });
});

describe('the record-reader tier ON for the object', () => {
  const ON = { recordReaderVisibleObjects: [OBJECT] };

  it('a reader of the record sees its request on a read that names the record, read-only', async () => {
    const rig = await boot(ON);
    const ctx = asUser(READER);
    expect(await listIds(rig, ctx, forRecord(rig.ids.recordA))).toEqual({ ids: [rig.ids.requestA], total: 1 });
    const served = (await byId(rig, ctx, rig.ids.requestA)).record;
    expect(served?.id).toBe(rig.ids.requestA);
    // Read-only on this door: the per-caller `viewer` block (`attachedOnRead`)
    // is the approvals door's, so no decision action's predicate holds here…
    expect(served).not.toHaveProperty('viewer');
    // …and on the approvals door the tier confers no decision either.
    expect((await rig.svc.getRequest(rig.ids.requestA, ctx))?.viewer)
      .toEqual({ can_act: false, can_override: false, is_submitter: false });
  });

  it('the filter-array spelling of a record\'s list names the record too', async () => {
    const rig = await boot(ON);
    const filter = JSON.stringify([['object_name', '=', OBJECT], ['record_id', '=', rig.ids.recordA]]);
    expect(await listIds(rig, asUser(READER), { filter })).toEqual({ ids: [rig.ids.requestA], total: 1 });
  });

  it('a read that names no record stays the reader\'s participant set — the inbox is not widened', async () => {
    const rig = await boot(ON);
    expect(await listIds(rig, asUser(READER))).toEqual({ ids: [], total: 0 });
  });

  it('the tier reaches no record its reader cannot read', async () => {
    const rig = await boot(ON);
    expect(await listIds(rig, asUser(READER), forRecord(rig.ids.recordB))).toEqual({ ids: [], total: 0 });
    expect((await byId(rig, asUser(READER), rig.ids.requestB)).error?.status).toBe(404);
    expect(await listIds(rig, asUser(OUTSIDER), forRecord(rig.ids.recordA))).toEqual({ ids: [], total: 0 });
    expect((await byId(rig, asUser(OUTSIDER), rig.ids.requestA)).error?.status).toBe(404);
  });

  it('one rule, two doors, with the tier on as well', async () => {
    const rig = await boot(ON);
    for (const ctx of [asUser(OUTSIDER), asUser(READER), asUser(SUBMITTER_B), ADMIN]) {
      for (const recordId of [rig.ids.recordA, rig.ids.recordB]) {
        const served = (await rig.svc.listRequests({ object: OBJECT, recordId }, ctx)).map((r) => String(r.id)).sort();
        expect((await listIds(rig, ctx, forRecord(recordId))).ids, `${ctx.userId} ${recordId}`).toEqual(served);
      }
    }
  });
});

describe('fails closed', () => {
  it('a visibility answer that fails denies the read, and says so', async () => {
    const rig = await boot();
    vi.spyOn(rig.svc, 'visibleRequestIdsFor').mockRejectedValueOnce(new Error('probe went away'));
    expect((await listIds(rig, ADMIN)).ids).toEqual([]);
    expect(rig.warnings.some((w) => w.includes('request read gate') && w.includes('fail closed'))).toBe(true);
  });

  it('a request about a request is no anchor, even when the opt-in names that object — the read never re-enters itself', async () => {
    // A FUSE around the gate: the depth of reads of the request object made as
    // the reader, nested inside one another. The tier's anchor read runs as the
    // caller, so on this object it would pass through the gate again, which
    // would ask about the row that one names — unbounded on the cycle below.
    // The fuse stops a runaway at a bound (a sqlite driver answers in
    // microtasks, so an unbounded chain starves every timer, the test timeout
    // included), and the depth it saw is the reading.
    let depth = 0;
    let deepest = 0;
    const rig = await boot({ recordReaderVisibleObjects: [OBJECT, REQUEST] }, (engine) => {
      engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
        if (!READ_OPS.has(op.operation) || op.context?.userId !== READER) return next();
        depth += 1;
        deepest = Math.max(deepest, depth);
        try {
          if (depth > 8) throw new Error('recursion fuse');
          return await next();
        } finally {
          depth -= 1;
        }
      }, { object: REQUEST });
    });
    // Two rows naming each other.
    const first = 'req_cycle_1';
    const second = 'req_cycle_2';
    for (const [id, other] of [[first, second], [second, first]]) {
      await rig.engine.insert(REQUEST, {
        id, process_name: 'flow:cycle', object_name: REQUEST, record_id: other, status: 'pending',
        submitter_id: 'u_somebody_else',
      }, { context: SYSTEM } as any);
    }
    expect((await byId(rig, asUser(READER), first)).error?.status).toBe(404);
    expect(await listIds(rig, asUser(READER), { object_name: REQUEST, record_id: second })).toEqual({ ids: [], total: 0 });
    // The fuse saw the reader's reads (its control), and none ran inside another.
    expect(deepest).toBe(1);
  });
});
