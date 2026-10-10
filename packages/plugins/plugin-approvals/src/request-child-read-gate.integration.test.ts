// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22589] The two child tables of an approval request — `sys_approval_action`
 * (the decision log: actor, decision, comment text) and `sys_approval_approver`
 * (the pending-approver index) — on the GENERIC data door serve a caller only
 * the rows of requests the approvals door serves it. The sibling half of
 * #22559, which gave `sys_approval_request` itself the same rule.
 *
 * ## What the rulings fix, and what each pin below holds
 *
 * #8652 ruled the approvals door's visibility: a request's participants and
 * administrators see it and its full action history; a reader of the record it
 * is about sees both READ-ONLY, only on an object a deployment opted in,
 * default OFF. On the approvals door the action history follows the request's
 * visibility (`listActions` serves it through `getRequest`), and so does a
 * decision attachment (`authorizeFileRead`). The triage of the parent ruled one
 * definition for both doors, fail closed; this card keys the child rows by
 * their `request_id` to that same definition:
 *
 *  - a non-participant sees no row of either table: not in a list, not in a
 *    request's list, not in a count or a grouped count, and by id a hidden row
 *    answers exactly as a missing one does;
 *  - a participant sees the rows of their own requests and no one else's;
 *  - the record page's Timeline (a related list of `sys_approval_action` keyed
 *    on `request_id`) keeps its readers — the submitter, the current approver
 *    and an administrator — and for every caller its rows equal the approvals
 *    door's `listActions`;
 *  - by id, an action row is served exactly when the approvals door's own
 *    by-row rule (`authorizeFileRead`) admits it;
 *  - with the tier on for the object, a reader of the record sees its rows on a
 *    read that names the request or the row, read-only, and a read that names
 *    nothing stays the participant set;
 *  - control: an administrator, and the approval engine's own reads as the
 *    system, are unchanged.
 *
 * ## The rig
 *
 * The parent's (`request-read-gate.integration.test.ts`): a real ObjectQL
 * engine over better-sqlite3, the real `ApprovalsServicePlugin.start()`, the
 * real data-door normalizer (`ObjectStackProtocolImplementation`). No security
 * plugin is mounted, so every caller holds read on both tables — the app's
 * grant this card measures under. RECORD READABILITY is the one stand-in: one
 * middleware on the business object refuses a caller with no read on it and
 * scopes one with read to its own records.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import type { EngineAggregateOptions, EngineCountOptions, EngineQueryOptions } from '@objectstack/spec/data';
import { ApprovalService, requestVisibilitySourceOf } from './approval-service.js';
import { ApprovalsServicePlugin, type ApprovalsPluginOptions } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';

const ACTION = 'sys_approval_action';
const APPROVER_INDEX = 'sys_approval_approver';
const CHILDREN = [ACTION, APPROVER_INDEX] as const;
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
  warnings: Array<{ msg: string; meta?: Record<string, any> }>;
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
    engine.registry.registerObject(def as any, 'approvals-child-read-gate-test', 'approvals-child-read-gate-test');
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
  const warnings: Rig['warnings'] = [];
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
      warn: (msg: string, meta?: Record<string, any>) => { warnings.push({ msg: String(msg), meta }); },
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
  // A second decision-log row on each request: its current approver's reply.
  for (const requestId of [requestA, requestB]) {
    await svc.comment(requestId, { actorId: APPROVER, comment: `reply on ${requestId}` }, asUser(APPROVER));
  }

  return {
    engine, svc, warnings,
    protocol: new ObjectStackProtocolImplementation(engine as any),
    ids: { recordA, recordB, requestA, requestB },
  };
}

/** Every row of `object`, read as the system: the scene the pins read against. */
async function allRows(rig: Rig, object: string): Promise<any[]> {
  return rig.engine.find(object, { context: SYSTEM } satisfies EngineQueryOptions) as Promise<any[]>;
}

/** The ids of `object`'s rows on `requestId`, as the system reads them. */
async function rowIdsOf(rig: Rig, object: string, requestId: string): Promise<string[]> {
  return (await allRows(rig, object)).filter((r) => r.request_id === requestId).map((r) => String(r.id)).sort();
}

/** The data door's list, as `GET /data/OBJECT` hands it in. */
async function listIds(rig: Rig, object: string, context: any, query: Record<string, unknown> = {}) {
  const res = await rig.protocol.findData({ object, query, context });
  return { ids: (res.records as any[]).map((r) => String(r.id)).sort(), total: res.total as number | undefined };
}

/** A request's related list — the record page's Timeline — by implicit field filter. */
const forRequest = (requestId: string) => ({ request_id: requestId });

/** The data door's by-id read; the refusal, when it refuses. */
async function byId(rig: Rig, object: string, context: any, id: string): Promise<{ record?: any; error?: any }> {
  try {
    return { record: (await rig.protocol.getData({ object, id, context })).record };
  } catch (error) {
    return { error };
  }
}

const NOT_FOUND = { code: 'RECORD_NOT_FOUND', status: 404 };
const envelope = (error: any) => ({ code: error?.code, status: error?.status });

describe('the record-reader tier OFF (the default)', () => {
  it('the scene: both requests carry decision-log rows and approver-index rows', async () => {
    const rig = await boot();
    for (const requestId of [rig.ids.requestA, rig.ids.requestB]) {
      expect((await rowIdsOf(rig, ACTION, requestId)).length, `${ACTION} ${requestId}`).toBe(2);
      expect((await rowIdsOf(rig, APPROVER_INDEX, requestId)).length, `${APPROVER_INDEX} ${requestId}`).toBe(1);
    }
  });

  for (const object of CHILDREN) {
    it(`${object}: a non-participant sees no row — list, a request's list, count, grouped count`, async () => {
      const rig = await boot();
      const ctx = asUser(OUTSIDER);
      expect(await listIds(rig, object, ctx)).toEqual({ ids: [], total: 0 });
      expect(await listIds(rig, object, ctx, forRequest(rig.ids.requestA))).toEqual({ ids: [], total: 0 });
      expect(await rig.engine.count(object, { context: ctx } satisfies EngineCountOptions)).toBe(0);
      const grouped: EngineAggregateOptions = {
        groupBy: ['request_id'], aggregations: [{ function: 'count', alias: 'n' }], context: ctx,
      };
      expect(await rig.engine.aggregate(object, grouped)).toEqual([]);
    });

    it(`${object}: by id, a hidden row answers exactly as a missing one — 404 RECORD_NOT_FOUND`, async () => {
      const rig = await boot();
      const [rowId] = await rowIdsOf(rig, object, rig.ids.requestA);
      const hidden = await byId(rig, object, asUser(OUTSIDER), rowId);
      const missing = await byId(rig, object, asUser(OUTSIDER), 'no_such_row');
      expect(hidden.record).toBeUndefined();
      expect(envelope(hidden.error)).toEqual(NOT_FOUND);
      expect(envelope(missing.error)).toEqual(NOT_FOUND);
    });

    it(`${object}: a participant sees their own request's rows and no one else's`, async () => {
      const rig = await boot();
      const { requestA, requestB } = rig.ids;
      const rowsA = await rowIdsOf(rig, object, requestA);
      const rowsB = await rowIdsOf(rig, object, requestB);
      const ctx = asUser(SUBMITTER_A);
      expect(await listIds(rig, object, ctx)).toEqual({ ids: rowsA, total: rowsA.length });
      expect(await listIds(rig, object, ctx, forRequest(requestB))).toEqual({ ids: [], total: 0 });
      expect((await byId(rig, object, ctx, rowsA[0])).record?.id).toBe(rowsA[0]);
      expect(envelope((await byId(rig, object, ctx, rowsB[0])).error)).toEqual(NOT_FOUND);
      // The current approver of both.
      expect((await listIds(rig, object, asUser(APPROVER))).ids).toEqual([...rowsA, ...rowsB].sort());
    });

    it(`${object}: control — an administrator is unchanged: every row, by list, count and id`, async () => {
      const rig = await boot();
      const all = (await allRows(rig, object)).map((r) => String(r.id)).sort();
      expect(all.length).toBeGreaterThan(0);
      expect(await listIds(rig, object, ADMIN)).toEqual({ ids: all, total: all.length });
      expect(await rig.engine.count(object, { context: ADMIN } satisfies EngineCountOptions)).toBe(all.length);
      const [rowB] = await rowIdsOf(rig, object, rig.ids.requestB);
      expect((await byId(rig, object, ADMIN, rowB)).record?.id).toBe(rowB);
    });

    it(`${object}: control — the approval engine's own reads, as the system, are not narrowed`, async () => {
      const rig = await boot();
      expect((await allRows(rig, object)).length).toBe(
        (await rowIdsOf(rig, object, rig.ids.requestA)).length + (await rowIdsOf(rig, object, rig.ids.requestB)).length,
      );
    });
  }

  it('the record page\'s Timeline keeps its readers: the submitter, the current approver and an administrator', async () => {
    const rig = await boot();
    const timeline = await rowIdsOf(rig, ACTION, rig.ids.requestA);
    const filterArray = JSON.stringify([['request_id', '=', rig.ids.requestA]]);
    for (const ctx of [asUser(SUBMITTER_A), asUser(APPROVER), ADMIN]) {
      expect(await listIds(rig, ACTION, ctx, forRequest(rig.ids.requestA)), ctx.userId)
        .toEqual({ ids: timeline, total: timeline.length });
      // The filter-array spelling names the request too.
      expect((await listIds(rig, ACTION, ctx, { filter: filterArray })).ids, ctx.userId).toEqual(timeline);
    }
  });

  it('one rule, two doors: for every caller a request\'s Timeline equals the approvals door\'s listActions', async () => {
    const rig = await boot();
    for (const ctx of [asUser(OUTSIDER), asUser(READER), asUser(SUBMITTER_A), asUser(SUBMITTER_B), asUser(APPROVER), ADMIN]) {
      for (const requestId of [rig.ids.requestA, rig.ids.requestB]) {
        const served = (await rig.svc.listActions(requestId, ctx)).map((a) => String(a.id)).sort();
        expect((await listIds(rig, ACTION, ctx, forRequest(requestId))).ids, `${ctx.userId} ${requestId}`).toEqual(served);
      }
    }
  });

  it('one rule, two doors, by id: an action row is served exactly when the approvals door\'s by-row rule admits it', async () => {
    const rig = await boot();
    const rows = [...await rowIdsOf(rig, ACTION, rig.ids.requestA), ...await rowIdsOf(rig, ACTION, rig.ids.requestB)];
    for (const ctx of [asUser(OUTSIDER), asUser(READER), asUser(SUBMITTER_A), asUser(SUBMITTER_B), asUser(APPROVER), ADMIN]) {
      for (const id of rows) {
        const admitted = await rig.svc.authorizeFileRead(id, ctx);
        const answer = await byId(rig, ACTION, ctx, id);
        expect(answer.record?.id ?? null, `${ctx.userId} ${id}`).toBe(admitted ? id : null);
        if (!admitted) expect(envelope(answer.error), `${ctx.userId} ${id}`).toEqual(NOT_FOUND);
      }
    }
  });
});

describe('the record-reader tier ON for the object', () => {
  const ON = { recordReaderVisibleObjects: [OBJECT] };

  for (const object of CHILDREN) {
    it(`${object}: a reader of the record sees its request's rows on a read naming the request or the row`, async () => {
      const rig = await boot(ON);
      const ctx = asUser(READER);
      const rowsA = await rowIdsOf(rig, object, rig.ids.requestA);
      expect(await listIds(rig, object, ctx, forRequest(rig.ids.requestA))).toEqual({ ids: rowsA, total: rowsA.length });
      expect((await byId(rig, object, ctx, rowsA[0])).record?.id).toBe(rowsA[0]);
    });

    it(`${object}: a read that names nothing stays the reader's participant set — the inbox is not widened`, async () => {
      const rig = await boot(ON);
      expect(await listIds(rig, object, asUser(READER))).toEqual({ ids: [], total: 0 });
    });

    it(`${object}: the tier reaches no request whose record its reader cannot read`, async () => {
      const rig = await boot(ON);
      const [rowB] = await rowIdsOf(rig, object, rig.ids.requestB);
      expect(await listIds(rig, object, asUser(READER), forRequest(rig.ids.requestB))).toEqual({ ids: [], total: 0 });
      expect(envelope((await byId(rig, object, asUser(READER), rowB)).error)).toEqual(NOT_FOUND);
      expect(await listIds(rig, object, asUser(OUTSIDER), forRequest(rig.ids.requestA))).toEqual({ ids: [], total: 0 });
    });
  }

  it('one rule, two doors, with the tier on as well: Timeline equals listActions, by id equals the by-row rule', async () => {
    const rig = await boot(ON);
    const rows = [...await rowIdsOf(rig, ACTION, rig.ids.requestA), ...await rowIdsOf(rig, ACTION, rig.ids.requestB)];
    for (const ctx of [asUser(OUTSIDER), asUser(READER), asUser(SUBMITTER_B), ADMIN]) {
      for (const requestId of [rig.ids.requestA, rig.ids.requestB]) {
        const served = (await rig.svc.listActions(requestId, ctx)).map((a) => String(a.id)).sort();
        expect((await listIds(rig, ACTION, ctx, forRequest(requestId))).ids, `${ctx.userId} ${requestId}`).toEqual(served);
      }
      for (const id of rows) {
        const admitted = await rig.svc.authorizeFileRead(id, ctx);
        expect((await byId(rig, ACTION, ctx, id)).record?.id ?? null, `${ctx.userId} ${id}`).toBe(admitted ? id : null);
      }
    }
  });
});

describe('fails closed', () => {
  for (const object of CHILDREN) {
    it(`${object}: a visibility answer that fails denies the read, and says so`, async () => {
      const rig = await boot();
      // The very source the plugin handed the gates: the service registers one object per instance.
      vi.spyOn(requestVisibilitySourceOf(rig.svc), 'visibleRequestIdsFor').mockRejectedValueOnce(new Error('probe went away'));
      expect((await listIds(rig, object, ADMIN)).ids).toEqual([]);
      expect(rig.warnings.some((w) => w.msg.includes('read gate') && w.msg.includes('fail closed') && w.meta?.object === object))
        .toBe(true);
    });
  }

  for (const object of CHILDREN) {
    it(`${object}: a request about one of its own child rows is no anchor, even when the opt-in names that object — the read never re-enters itself`, async () => {
      // A FUSE around the gate, as on the parent's table: the depth of reads of
      // `object` made as the reader, nested inside one another. The tier's
      // anchor read runs as the caller, so on a child table it would pass
      // through that table's gate again, which would ask about the request the
      // row belongs to, whose anchor is that row — unbounded on the cycle below.
      let depth = 0;
      let deepest = 0;
      const rig = await boot({ recordReaderVisibleObjects: [OBJECT, object] }, (engine) => {
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
        }, { object });
      });
      // A request about a child row that belongs to that very request.
      const requestId = 'req_cycle';
      const rowId = 'row_cycle';
      await rig.engine.insert('sys_approval_request', {
        id: requestId, process_name: 'flow:cycle', object_name: object, record_id: rowId, status: 'pending',
        submitter_id: 'u_somebody_else',
      }, { context: SYSTEM } as any);
      const row = object === ACTION
        ? { id: rowId, request_id: requestId, step_index: 0, action: 'submit', created_at: new Date().toISOString() }
        : { id: rowId, request_id: requestId, approver: 'u_somebody_else', created_at: new Date().toISOString() };
      await rig.engine.insert(object, row, { context: SYSTEM } as any);
      expect(envelope((await byId(rig, object, asUser(READER), rowId)).error)).toEqual(NOT_FOUND);
      expect(await listIds(rig, object, asUser(READER), forRequest(requestId))).toEqual({ ids: [], total: 0 });
      // The fuse saw the reader's reads (its control), and none ran inside another.
      expect(deepest).toBe(1);
    });
  }
});
