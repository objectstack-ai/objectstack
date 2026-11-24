// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26314] `ApprovalService.getRecordLock` — is this record held by a locking
 * approval, answered to every caller who can read the record (#25934 ruling A,
 * "readers"), and to nobody else.
 *
 * ## What each pin holds
 *
 *  - a non-participant who can read the record is told `{ locked: true }` —
 *    while still served no request row (#8652's ruling is untouched), and
 *    while their write is still refused `RECORD_LOCKED`: the read and the hook
 *    give one answer;
 *  - a record the caller cannot read answers `null`, exactly as an id that
 *    does not exist; a caller with no read on the object is refused the same
 *    way for both;
 *  - a pending node with `lockRecord: false`, or no pending request at all,
 *    answers `{ locked: false }`;
 *  - the request row's `lock_record` and this read agree on every request in
 *    the scene — one judgement, read off one snapshot.
 *
 * The REST door's half (one 404 for both `null`s, the closed query set, the
 * `{ locked }`-only payload) is pinned in `@objectstack/rest`; the whole path
 * on a real boot with the real security plugin in the dogfood suite
 * (`approval-record-lock-read.dogfood.test.ts`).
 *
 * ## The rig
 *
 * The sibling read-gate suites' (`record-reader-opt-in.integration.test.ts`):
 * a real ObjectQL engine over better-sqlite3 and the real
 * `ApprovalsServicePlugin.start()`, so the record-lock hook is bound as in a
 * deployment. RECORD READABILITY is the one stand-in: one middleware per
 * business object refuses a caller with no read on it and scopes one with read
 * to the records it may see.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

/** Its approval node locks the record. */
const HELD = 'held_sheet';
/** Its approval node opts out of the lock. */
const OPEN = 'open_sheet';
/** A master-detail line object under each sheet: its rows are held with their master. */
const lineOf = (master: string) => `${master}_line`;
const PKG = 'approvals-record-lock-read-test';
const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;

const SUBMITTER = 'u_submitter';
const APPROVER = 'u_approver';
/** Reads (and may write) record `_a` of each object; on no slate. */
const READER = 'u_reader';
/** Holds no read on any business object. */
const OUTSIDER = 'u_outsider';

const recordA = (object: string) => `${object}_a`;
const recordB = (object: string) => `${object}_b`;
const MISSING = 'no_such_record';

function sheet(name: string) {
  return {
    name,
    label: name,
    fields: {
      id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
      title: { name: 'title', label: 'Title', type: 'text' as const },
    },
  };
}

/** A detail object of `master`: one required `master_detail` FK, `sheet`. */
function line(master: string) {
  return {
    name: lineOf(master),
    label: `${master} line`,
    fields: {
      id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
      title: { name: 'title', label: 'Title', type: 'text' as const },
      sheet: { name: 'sheet', label: 'Sheet', type: 'master_detail' as const, reference: master },
    },
  };
}

const nodeConfig = (lockRecord: boolean) => ({
  approvers: [{ type: 'user' as const, value: APPROVER }],
  behavior: 'first_response' as const,
  lockRecord,
});

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

interface Rig {
  engine: ObjectQL;
  svc: ApprovalService;
  /** object -> the pending request on record `_a` */
  requests: Map<string, string>;
}

async function boot(): Promise<Rig> {
  const engine = new ObjectQL();
  current = engine;
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }), true);
  await engine.init();
  for (const def of [
    sheet(HELD), sheet(OPEN), line(HELD), line(OPEN),
    SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation,
  ]) {
    engine.registry.registerObject(def as any, PKG, PKG);
  }
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  for (const object of [HELD, OPEN, lineOf(HELD), lineOf(OPEN)]) guardReads(engine, object);

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

  const requests = new Map<string, string>();
  for (const [object, lockRecord] of [[HELD, true], [OPEN, false]] as const) {
    for (const recordId of [recordA(object), recordB(object)]) {
      await engine.insert(object, { id: recordId, title: recordId }, { context: SYSTEM } as any);
    }
    // One line under each record: line `_a` under record `_a`, line `_b` under `_b`.
    for (const [lineId, masterId] of [[recordA(lineOf(object)), recordA(object)], [recordB(lineOf(object)), recordB(object)]]) {
      await engine.insert(lineOf(object), { id: lineId, title: lineId, sheet: masterId }, { context: SYSTEM } as any);
    }
    // Only record `_a` is under approval; `_b` carries none.
    const opened = await svc.openNodeRequest({
      object, recordId: recordA(object), runId: `run_${object}`, nodeId: 'review', flowName: 'sheet_review',
      config: nodeConfig(lockRecord) as any, submitterId: SUBMITTER,
      record: { id: recordA(object), title: recordA(object) },
    }, asUser(SUBMITTER)) as any;
    requests.set(object, String(opened.id));
  }
  return { engine, svc, requests };
}

/** The caller's write of `title`, and the refusal code when it is refused. */
async function writeAs(rig: Rig, userId: string, object: string, recordId: string): Promise<string> {
  try {
    await rig.engine.update(object, { id: recordId, title: 'edited' }, { context: asUser(userId) } as any);
    return 'written';
  } catch (err: any) {
    return String(err?.code ?? err?.message);
  }
}

/**
 * `ApprovalService.getRecordLocks` — the same read for a page of rows: entry
 * `i` is what `getRecordLock` answers for `recordIds[i]`, so a list asking a
 * page at once and a record page asking one record cannot disagree.
 */
describe('ApprovalService.getRecordLocks — the lock read for a page of rows', () => {
  it('answers each id in order exactly as getRecordLock answers it, for every caller', async () => {
    const rig = await boot();
    const ids = [recordA(HELD), recordB(HELD), MISSING, recordA(HELD)];
    for (const caller of [SUBMITTER, APPROVER, READER]) {
      const page = await rig.svc.getRecordLocks(HELD, ids, asUser(caller));
      const oneByOne = [];
      for (const id of ids) oneByOne.push(await rig.svc.getRecordLock(HELD, id, asUser(caller)));
      expect(page, caller).toEqual(oneByOne);
    }
    // The reader: `_a` locked; `_b` unreadable and `MISSING` absent read alike.
    expect(await rig.svc.getRecordLocks(HELD, ids, asUser(READER))).toEqual([{ locked: true }, null, null, { locked: true }]);
    expect(await rig.svc.getRecordLocks(OPEN, [recordA(OPEN), recordB(OPEN)], asUser(SUBMITTER)))
      .toEqual([{ locked: false }, { locked: false }]);
  });

  it('reads the page in two engine reads whatever its size, never one per row', async () => {
    const rig = await boot();
    const find = rig.engine.find.bind(rig.engine);
    const reads: string[] = [];
    (rig.engine as any).find = (object: string, query: any) => {
      reads.push(object);
      return find(object, query);
    };
    await rig.svc.getRecordLocks(HELD, [recordA(HELD), recordB(HELD), MISSING], asUser(SUBMITTER));
    expect(reads).toEqual([HELD, 'sys_approval_request']);
  });

  it('refuses a caller with no read on the object as getRecordLock does, and answers a blank id null', async () => {
    const rig = await boot();
    const refusal = await rig.svc.getRecordLocks(HELD, [recordA(HELD)], asUser(OUTSIDER)).then(
      () => 'answered', (err: any) => `${err?.code} ${err?.status}`,
    );
    expect(refusal).toBe('PERMISSION_DENIED 403');
    expect(await rig.svc.getRecordLocks(HELD, ['', recordA(HELD)], asUser(READER))).toEqual([null, { locked: true }]);
  });

  it('unlocks the page once the request is decided, as the hook does', async () => {
    const rig = await boot();
    await rig.svc.decide(rig.requests.get(HELD)!, { decision: 'approve', actorId: APPROVER }, asUser(APPROVER));
    expect(await rig.svc.getRecordLocks(HELD, [recordA(HELD)], asUser(READER))).toEqual([{ locked: false }]);
    expect(await writeAs(rig, READER, HELD, recordA(HELD))).toBe('written');
  });
});

describe('[#26314] ApprovalService.getRecordLock', () => {
  it('tells a non-participant reader the record is locked, and nothing about the request', async () => {
    const rig = await boot();
    expect(await rig.svc.getRecordLock(HELD, recordA(HELD), asUser(READER))).toEqual({ locked: true });
    // #8652 untouched: the request itself is still not served to them…
    expect(await rig.svc.listRequests({ object: HELD, recordId: recordA(HELD) }, asUser(READER))).toEqual([]);
    expect(await rig.svc.getRequest(rig.requests.get(HELD)!, asUser(READER))).toBeNull();
    // …and the lock it reports is the one the hook enforces on their write.
    expect(await writeAs(rig, READER, HELD, recordA(HELD))).toBe('RECORD_LOCKED');
    // The participants are told the same.
    expect(await rig.svc.getRecordLock(HELD, recordA(HELD), asUser(SUBMITTER))).toEqual({ locked: true });
    expect(await rig.svc.getRecordLock(HELD, recordA(HELD), asUser(APPROVER))).toEqual({ locked: true });
  });

  it('answers a record the caller cannot read exactly as one that does not exist', async () => {
    const rig = await boot();
    // The reader cannot read record `_b`; neither exists for them as `MISSING`.
    expect(await rig.svc.getRecordLock(HELD, recordB(HELD), asUser(READER))).toBeNull();
    expect(await rig.svc.getRecordLock(HELD, MISSING, asUser(READER))).toBeNull();
    // Make `_b` locked too: the answer to a caller who cannot read it does not move.
    await rig.svc.openNodeRequest({
      object: HELD, recordId: recordB(HELD), runId: 'run_b', nodeId: 'review', flowName: 'sheet_review',
      config: nodeConfig(true) as any, submitterId: SUBMITTER, record: { id: recordB(HELD), title: recordB(HELD) },
    }, asUser(SUBMITTER));
    expect(await rig.svc.getRecordLock(HELD, recordB(HELD), asUser(SUBMITTER))).toEqual({ locked: true });
    expect(await rig.svc.getRecordLock(HELD, recordB(HELD), asUser(READER))).toBeNull();
    // No read on the object at all: the same refusal whether the id exists or not.
    const refusalOf = async (id: string) => {
      try {
        await rig.svc.getRecordLock(HELD, id, asUser(OUTSIDER));
        return 'answered';
      } catch (err: any) {
        return `${err?.code} ${err?.status}`;
      }
    };
    expect(await refusalOf(recordA(HELD))).toBe('PERMISSION_DENIED 403');
    expect(await refusalOf(MISSING)).toBe('PERMISSION_DENIED 403');
  });

  it('answers unlocked for a `lockRecord: false` node and for a record with no pending request', async () => {
    const rig = await boot();
    expect(await rig.svc.getRecordLock(OPEN, recordA(OPEN), asUser(READER))).toEqual({ locked: false });
    expect(await writeAs(rig, READER, OPEN, recordA(OPEN))).toBe('written');
    expect(await rig.svc.getRecordLock(HELD, recordB(HELD), asUser(SUBMITTER))).toEqual({ locked: false });
    // Decided: no pending request is left, and the record unlocks for the read as for the hook.
    await rig.svc.decide(rig.requests.get(HELD)!, { decision: 'approve', actorId: APPROVER }, asUser(APPROVER));
    expect(await rig.svc.getRecordLock(HELD, recordA(HELD), asUser(READER))).toEqual({ locked: false });
    expect(await writeAs(rig, READER, HELD, recordA(HELD))).toBe('written');
  });

  it('agrees with the request row\'s `lock_record` on every request — one judgement', async () => {
    const rig = await boot();
    for (const object of [HELD, OPEN]) {
      const row = await rig.svc.getRequest(rig.requests.get(object)!, asUser(APPROVER));
      const read = await rig.svc.getRecordLock(object, recordA(object), asUser(APPROVER));
      expect(row?.lock_record, object).toBe(object === HELD);
      expect(read, object).toEqual({ locked: row?.lock_record });
    }
  });
});

describe('a locked record\'s lines are locked with it — the record-lock read answers for a detail row too', () => {
  const LINE = lineOf(HELD);

  it('tells a reader a line of a locked record is locked, as its write is refused', async () => {
    const rig = await boot();
    expect(await rig.svc.getRecordLock(LINE, recordA(LINE), asUser(READER))).toEqual({ locked: true });
    expect(await writeAs(rig, READER, LINE, recordA(LINE))).toBe('RECORD_LOCKED');
    expect(await rig.svc.getRecordLock(LINE, recordA(LINE), asUser(SUBMITTER))).toEqual({ locked: true });
    expect(await rig.svc.getRecordLock(LINE, recordA(LINE), asUser(APPROVER))).toEqual({ locked: true });
  });

  it('CONTROL — a line under a record with no pending request, or under a `lockRecord: false` node, is unlocked and writes', async () => {
    const rig = await boot();
    expect(await rig.svc.getRecordLock(LINE, recordB(LINE), asUser(SUBMITTER))).toEqual({ locked: false });
    expect(await writeAs(rig, SUBMITTER, LINE, recordB(LINE))).toBe('written');
    const openLine = lineOf(OPEN);
    expect(await rig.svc.getRecordLock(openLine, recordA(openLine), asUser(READER))).toEqual({ locked: false });
    expect(await writeAs(rig, READER, openLine, recordA(openLine))).toBe('written');
  });

  it('CONTROL — once the request is decided the line unlocks for the read as for the hook', async () => {
    const rig = await boot();
    await rig.svc.decide(rig.requests.get(HELD)!, { decision: 'approve', actorId: APPROVER }, asUser(APPROVER));
    expect(await rig.svc.getRecordLock(LINE, recordA(LINE), asUser(READER))).toEqual({ locked: false });
    expect(await writeAs(rig, READER, LINE, recordA(LINE))).toBe('written');
  });

  it('answers a line the caller cannot read exactly as one that does not exist', async () => {
    const rig = await boot();
    await rig.svc.openNodeRequest({
      object: HELD, recordId: recordB(HELD), runId: 'run_b', nodeId: 'review', flowName: 'sheet_review',
      config: nodeConfig(true) as any, submitterId: SUBMITTER, record: { id: recordB(HELD), title: recordB(HELD) },
    }, asUser(SUBMITTER));
    expect(await rig.svc.getRecordLock(LINE, recordB(LINE), asUser(SUBMITTER))).toEqual({ locked: true });
    expect(await rig.svc.getRecordLock(LINE, recordB(LINE), asUser(READER))).toBeNull();
    expect(await rig.svc.getRecordLock(LINE, MISSING, asUser(READER))).toBeNull();
  });
});
