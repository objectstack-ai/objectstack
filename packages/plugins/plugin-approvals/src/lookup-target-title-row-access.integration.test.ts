// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23637] A `payload_display` title — the title of the record a snapshot's
 * lookup points at — is served to a reader only for a target RECORD that reader
 * may read.
 *
 * ## The contract
 *
 * The target's title is read under the system context, so the read itself
 * narrows nothing: before this card it was narrowed by the target's declared
 * API exposure (#22738) and by the reader's field-level security on the target
 * object (#23618), but never by whether the reader may read the target record
 * at all. The two other doors that title a lookup target judge exactly that:
 * the data door's `$expand` reads the target as the caller, and the dataset
 * door's labels are row-scope filtered. #7497 ruling C keeps record access with
 * object permissions, sharing and the application's row-level rules, and gives
 * an approver the inbox entry, the request detail with the FLS-redacted
 * snapshot, and the actions — the snapshot holds the target's id, not its
 * title. So the title is served only for a target record the platform's one
 * caller-scoped row-access answer (`resolveReadableParentIds`,
 * `@objectstack/core`) says the reader may read; an unreadable target gets no
 * display value and the stored id stands, the answer a deleted target already
 * gets. Nothing about the SUBJECT moves: its title and snapshot are served as
 * before, whatever the reader's access to the subject record.
 *
 * ## What this pins
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory). Record readability is the one
 * stand-in, in place of `plugin-security`: one middleware per business object
 * refuses a caller with no object read and scopes one with read to the rows it
 * may read — the two answers a caller-scoped read gets from the security
 * middleware (a refusal, or a narrowed result). No field-visibility source is
 * attached, so every field passes through (the FLS half is
 * `lookup-target-title-reader-fls.integration.test.ts`).
 *
 *  (a) a reader denied the target ROW (a row rule on a readable object, no
 *      object read at all, a self-lookup to a hidden row) gets no title for
 *      that key, on the single read and on the list, and the stored id stands
 *      — the shape a deleted target gives;
 *  (a-row) per record, not per object: in one list, the target row the reader
 *      may read keeps its title while a hidden row of the same object does not;
 *  (b) the control: a reader who may read every target row gets every title;
 *  (c) one row-access ask per target object per read, naming every id of that
 *      object the read titles, on the single read and on a multi-row list;
 *  (d) the subject is untouched: a reader who may read no subject row is
 *      served the subject's title, label and snapshot exactly as the control.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;

/** May read only `A_MINE` of the accounts, no vendor at all, and no deal row. */
const RESTRICTED = 'u_row_restricted';
/** May read every row (the control). */
const READER = 'u_row_reader';
const SUBMITTER = 'u_row_sub';

/** Target titles the restricted reader must never be served. */
const ACCOUNT_TITLE = 'Globex hidden account';
const VENDOR_TITLE = 'Initech vendor, no object read';
const PARENT_TITLE = 'Parent deal, hidden row';
/** The account row the restricted reader may read. */
const MINE_TITLE = 'Umbrella account, readable';

const account = {
  name: 'crm_account',
  label: 'Account',
  nameField: 'name',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};
const vendor = {
  name: 'crm_vendor',
  label: 'Vendor',
  nameField: 'name',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};
const deal = {
  name: 'crm_deal',
  label: 'Deal',
  nameField: 'name',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    amount: { name: 'amount', label: 'Amount', type: 'number' as const },
    account: { name: 'account', label: 'Account', type: 'lookup' as const, reference: 'crm_account' },
    vendor: { name: 'vendor', label: 'Vendor', type: 'lookup' as const, reference: 'crm_vendor' },
    parent: { name: 'parent', label: 'Parent deal', type: 'lookup' as const, reference: 'crm_deal' },
  },
};
const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    email: { name: 'email', label: 'Email', type: 'text' as const },
  },
};

const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);
/** object → user → the rows that user may read; a user absent here has no object read. */
const READABLE: Record<string, Record<string, ReadonlySet<string> | 'all'>> = {
  crm_account: { [RESTRICTED]: new Set(['A_MINE']), [READER]: 'all' },
  crm_vendor: { [READER]: 'all' },
  crm_deal: { [RESTRICTED]: new Set<string>(), [READER]: 'all' },
};

/** A caller-scoped read of a business object, as the stand-in saw it. */
interface CallerRead { object: string; userId: string; ids: string[] }

/** Record readability, the stand-in (see the header), on the three business objects. */
function guardReads(engine: ObjectQL, reads: CallerRead[]): void {
  for (const object of Object.keys(READABLE)) {
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      const ctx = op.context;
      if (READ_OPS.has(op.operation) && ctx && !ctx.isSystem && op.ast) {
        const userId = String(ctx.userId ?? '');
        const inList = op.ast.where?.id?.$in;
        reads.push({ object, userId, ids: Array.isArray(inList) ? [...inList].map(String).sort() : [] });
        const grant = READABLE[object][userId];
        if (!grant) {
          throw Object.assign(new Error(`[Security] Access denied: no read on '${object}'`), {
            code: 'PERMISSION_DENIED', status: 403,
          });
        }
        if (grant !== 'all') {
          const scope = { id: { $in: [...grant] } };
          op.ast.where = op.ast.where ? { $and: [op.ast.where, scope] } : scope;
        }
      }
      return next();
    }, { object });
  }
}

/** The plugin's own object definitions, as its manifest registers them. */
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

describe('[#23637] a lookup target\'s title is served only for a target record its reader may read', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  const reads: CallerRead[] = [];
  let n = 0;

  /** One pending request on a fresh deal whose snapshot points at the given targets. */
  const openDeal = async (targets: { account: string; vendor: string; parent: string }) => {
    n += 1;
    const recordId = `D${n}`;
    const record = { id: recordId, name: `Deal ${n}`, amount: 100 * n, ...targets };
    await engine.insert('crm_deal', record, { context: SYSTEM } as any);
    const row: any = await svc.openNodeRequest({
      object: 'crm_deal', recordId, runId: `run_${n}`, nodeId: 'review', flowName: 'deal_review',
      config: {
        approvers: [RESTRICTED, READER].map((value) => ({ type: 'user', value })),
        behavior: 'first_response',
      } as any,
      submitterId: SUBMITTER, record,
    }, asUser(SUBMITTER));
    return { requestId: String(row.id), recordId, record };
  };
  const hidden = { account: 'A1', vendor: 'V1', parent: 'D_PARENT' };

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [sysUser, account, vendor, deal, ...(await packageObjects())]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    await engine.syncSchemas();
    guardReads(engine, reads);
    for (const id of [RESTRICTED, READER, SUBMITTER]) {
      await engine.insert('sys_user', { id, name: id, email: `${id}@example.com` }, { context: SYSTEM } as any);
    }
    await engine.insert('crm_account', { id: 'A1', name: ACCOUNT_TITLE }, { context: SYSTEM } as any);
    await engine.insert('crm_account', { id: 'A_MINE', name: MINE_TITLE }, { context: SYSTEM } as any);
    await engine.insert('crm_vendor', { id: 'V1', name: VENDOR_TITLE }, { context: SYSTEM } as any);
    await engine.insert('crm_deal', { id: 'D_PARENT', name: PARENT_TITLE, amount: 1 }, { context: SYSTEM } as any);
    svc = new ApprovalService({
      engine: engine as any,
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
    });
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('(a) a reader denied the target row gets no title for it — single read and list; the stored id stands', async () => {
    const { requestId, recordId } = await openDeal(hidden);
    // The shape a deleted target gives, read off the same reader.
    const gone = await openDeal({ account: 'A_GONE', vendor: 'V_GONE', parent: 'D_GONE' });

    const one: any = await svc.getRequest(requestId, asUser(RESTRICTED));
    const [listed]: any[] = await svc.listRequests({ recordId }, asUser(RESTRICTED));
    const deleted: any = await svc.getRequest(gone.requestId, asUser(RESTRICTED));
    for (const [door, row] of [['getRequest', one], ['listRequests', listed]] as const) {
      expect(row, door).toBeTruthy();
      // A row rule on a readable object, no object read, a self-lookup to a hidden row.
      expect(row.payload_display ?? {}, door).not.toHaveProperty('account');
      expect(row.payload_display ?? {}, door).not.toHaveProperty('vendor');
      expect(row.payload_display ?? {}, door).not.toHaveProperty('parent');
      expect(row.payload_display, door).toEqual(deleted.payload_display);
      // The stored ids stand.
      expect(row.payload, door).toMatchObject(hidden);
      for (const title of [ACCOUNT_TITLE, VENDOR_TITLE, PARENT_TITLE]) {
        expect(JSON.stringify(row), door).not.toContain(title);
      }
    }
  });

  it('(a-row) per record, not per object: the target row the reader may read keeps its title', async () => {
    const mine = await openDeal({ account: 'A_MINE', vendor: 'V1', parent: 'D_PARENT' });
    const theirs = await openDeal(hidden);
    const rows: any[] = await svc.listRequests({ object: 'crm_deal', approverId: RESTRICTED }, asUser(RESTRICTED));
    const byRecord = new Map(rows.map((r) => [r.record_id, r]));
    expect(byRecord.get(mine.recordId)?.payload_display).toEqual({ account: MINE_TITLE });
    expect(byRecord.get(theirs.recordId)?.payload_display ?? {}).not.toHaveProperty('account');
    expect(JSON.stringify(rows)).not.toContain(ACCOUNT_TITLE);
  });

  it('(b) control: a reader who may read every target row gets every title — single read and list', async () => {
    const { requestId, recordId } = await openDeal(hidden);
    const one: any = await svc.getRequest(requestId, asUser(READER));
    const [listed]: any[] = await svc.listRequests({ recordId }, asUser(READER));
    for (const [door, row] of [['getRequest', one], ['listRequests', listed]] as const) {
      expect(row.payload_display, door).toEqual({ account: ACCOUNT_TITLE, vendor: VENDOR_TITLE, parent: PARENT_TITLE });
    }
  });

  it('(c) one row-access ask per target object per read, naming every id the read titles', async () => {
    const first = await openDeal(hidden);
    await openDeal({ account: 'A_MINE', vendor: 'V1', parent: 'D_PARENT' });

    reads.length = 0;
    await svc.getRequest(first.requestId, asUser(RESTRICTED));
    expect(reads).toEqual([
      { object: 'crm_account', userId: RESTRICTED, ids: ['A1'] },
      { object: 'crm_vendor', userId: RESTRICTED, ids: ['V1'] },
      { object: 'crm_deal', userId: RESTRICTED, ids: ['D_PARENT'] },
    ]);

    reads.length = 0;
    const rows = await svc.listRequests({ object: 'crm_deal', approverId: RESTRICTED }, asUser(RESTRICTED));
    expect(rows.length).toBeGreaterThan(1);
    expect(reads.map((r) => r.object)).toEqual(['crm_account', 'crm_vendor', 'crm_deal']);
    expect(reads.find((r) => r.object === 'crm_account')?.ids).toEqual(expect.arrayContaining(['A1', 'A_MINE']));
  });

  it('(d) the subject is untouched: a reader who may read no subject row is served it as the control is', async () => {
    const { requestId, recordId, record } = await openDeal(hidden);
    for (const door of ['getRequest', 'listRequests'] as const) {
      const read = async (userId: string): Promise<any> => door === 'getRequest'
        ? svc.getRequest(requestId, asUser(userId))
        : (await svc.listRequests({ recordId }, asUser(userId)))[0];
      const restricted = await read(RESTRICTED);
      const control = await read(READER);
      expect(restricted.record_title, door).toBe(record.name);
      expect(restricted.object_label, door).toBe('Deal');
      expect(restricted.payload, door).toEqual(control.payload);
      expect(restricted.payload, door).toMatchObject(record);
      expect(restricted.record_title, door).toBe(control.record_title);
    }
  });
});
