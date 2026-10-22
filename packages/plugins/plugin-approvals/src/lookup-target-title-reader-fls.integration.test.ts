// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23618] A `payload_display` title — the title of the record a snapshot's
 * lookup points at — is served to a reader only from fields that reader may be
 * served on the TARGET object.
 *
 * ## The contract
 *
 * `payload-redaction.ts` (#10749): "Redaction is applied at SERVE time, keyed
 * on the reading caller, so the same row answers an admin with the whole
 * snapshot and a restricted approver with only the fields they may read." The
 * lookup keys already come from the reader's redacted snapshot, so a withheld
 * lookup field lends nothing. The title of the record a readable lookup points
 * at is a field of a SECOND object, read beside that snapshot under the system
 * context, so it answers to the same rule asked of that object: the served-fields
 * answer (`resolveReadableSnapshotFields`, readable and not masked for this
 * reader) that #23594 applies to the subject's own title, asked as the reader,
 * once per object per read. The title is picked from the target AS SERVED to the
 * reader, so a withheld display field gives the reader nothing for that key and
 * the snapshot's stored id stands — the answer a deleted or exposure-refused
 * target already gets (#22738).
 *
 * ## What this pins
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory), with a field-visibility source in
 * place of `plugin-security`'s (the three answers it gives are its contract):
 *
 *  (a) a reader who may not read a target's display field gets no title for
 *      that key, on the single read and on the list, and the stored id stands;
 *      a target that is the subject's own object (a self-lookup) is narrowed by
 *      the same reader's answer for that object;
 *  (a-masked) a target display field served MASKED to the reader is withheld
 *      the same way (#20964);
 *  (b) the control: a reader who may read every target field gets every title;
 *  (c) a withheld target display field never lends its value: the title is
 *      picked from what the reader is served on the target;
 *  (d) one rule, asked once: one field-visibility ask per object per read,
 *      subject and targets together, on the single read and on a multi-row
 *      list — a target that is also a subject object is not asked twice.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import type { FieldVisibilitySource } from './payload-redaction.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;

/** May not read the account's or the deal's display field, nor the vendor's `code`. */
const RESTRICTED = 'u_restricted';
/** Served the account's display field MASKED: readable, not queryable (#20964). */
const MASKED = 'u_masked';
/** May read every field (the control). */
const READER = 'u_reader';
const SUBMITTER = 'u_sub';

/** Target display values a restricted reader must never be served. */
const ACCOUNT_TITLE = 'Globex private account';
const PARENT_TITLE = 'Parent deal secret';
const VENDOR_CODE = 'VENDOR-SECRET-9';
/** The vendor's other title-eligible field, readable to every reader. */
const VENDOR_NAME = 'Initech Supplies';

const account = {
  name: 'crm_account',
  label: 'Account',
  nameField: 'name',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    region: { name: 'region', label: 'Region', type: 'text' as const },
  },
};
/** Its display field is `code`; `name` is another title-eligible field. */
const vendor = {
  name: 'crm_vendor',
  label: 'Vendor',
  nameField: 'code',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    code: { name: 'code', label: 'Code', type: 'text' as const },
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

const ALL: Record<string, string[]> = {
  crm_deal: ['id', 'name', 'amount', 'account', 'vendor', 'parent'],
  crm_account: ['id', 'name', 'region'],
  crm_vendor: ['id', 'code', 'name'],
};
/** reader → object → [readable, queryable]. */
const ANSWERS: Record<string, Record<string, [string[], string[]]>> = {
  [RESTRICTED]: {
    crm_deal: [['id', 'amount', 'account', 'vendor', 'parent'], ['id', 'amount', 'account', 'vendor', 'parent']],
    crm_account: [['id', 'region'], ['id', 'region']],
    crm_vendor: [['id', 'name'], ['id', 'name']],
  },
  [MASKED]: {
    crm_deal: [ALL.crm_deal, ALL.crm_deal],
    crm_account: [ALL.crm_account, ['id', 'region']],
    crm_vendor: [ALL.crm_vendor, ALL.crm_vendor],
  },
  [READER]: {
    crm_deal: [ALL.crm_deal, ALL.crm_deal],
    crm_account: [ALL.crm_account, ALL.crm_account],
    crm_vendor: [ALL.crm_vendor, ALL.crm_vendor],
  },
};

/** Stands in for `plugin-security`: the system context reads every field, as its `isSystem` bypass does. */
function makeVisibility(): FieldVisibilitySource & { calls: Array<{ object: string; userId?: string }> } {
  const calls: Array<{ object: string; userId?: string }> = [];
  const answer = (object: string, context: any, which: 0 | 1) => {
    if (context?.isSystem) return ALL[object];
    return ANSWERS[String(context?.userId ?? '')]?.[object]?.[which] ?? [];
  };
  return {
    calls,
    async getReadableFields(object: string, context?: any) {
      calls.push({ object, userId: context?.userId });
      return answer(object, context, 0);
    },
    async getQueryableFields(object: string, context?: any) {
      return answer(object, context, 1);
    },
  };
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

describe('[#23618] a lookup target\'s title is served from what its reader may read on the target', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  let vis: ReturnType<typeof makeVisibility>;
  let n = 0;

  /** One pending request on a fresh deal whose snapshot points at all three targets. */
  const openDeal = async () => {
    n += 1;
    const recordId = `D${n}`;
    const record = { id: recordId, name: `Deal ${n}`, amount: 100 * n, account: 'A1', vendor: 'V1', parent: 'D_PARENT' };
    await engine.insert('crm_deal', record, { context: SYSTEM } as any);
    const row: any = await svc.openNodeRequest({
      object: 'crm_deal', recordId, runId: `run_${n}`, nodeId: 'review', flowName: 'deal_review',
      config: {
        approvers: [RESTRICTED, MASKED, READER].map((value) => ({ type: 'user', value })),
        behavior: 'first_response',
      } as any,
      submitterId: SUBMITTER, record,
    }, asUser(SUBMITTER));
    return { requestId: String(row.id), recordId };
  };

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
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    for (const id of [RESTRICTED, MASKED, READER, SUBMITTER]) {
      await engine.insert('sys_user', { id, name: id, email: `${id}@example.com` }, { context: SYSTEM } as any);
    }
    await engine.insert('crm_account', { id: 'A1', name: ACCOUNT_TITLE, region: 'EMEA' }, { context: SYSTEM } as any);
    await engine.insert('crm_vendor', { id: 'V1', code: VENDOR_CODE, name: VENDOR_NAME }, { context: SYSTEM } as any);
    await engine.insert('crm_deal', { id: 'D_PARENT', name: PARENT_TITLE, amount: 1 }, { context: SYSTEM } as any);
    svc = new ApprovalService({
      engine: engine as any,
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
    });
    vis = makeVisibility();
    svc.attachFieldVisibility(vis);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('(a) a reader who may not read a target\'s display field gets no title for it — single read and list', async () => {
    const { requestId, recordId } = await openDeal();

    const one: any = await svc.getRequest(requestId, asUser(RESTRICTED));
    const [listed]: any[] = await svc.listRequests({ recordId }, asUser(RESTRICTED));
    for (const [door, row] of [['getRequest', one], ['listRequests', listed]] as const) {
      expect(row, door).toBeTruthy();
      expect(row.payload_display ?? {}, door).not.toHaveProperty('account');
      // A self-lookup is narrowed by the same reader's answer for the subject object.
      expect(row.payload_display ?? {}, door).not.toHaveProperty('parent');
      // The stored ids stand, as for a deleted or exposure-refused target.
      expect(row.payload, door).toMatchObject({ account: 'A1', parent: 'D_PARENT' });
      expect(JSON.stringify(row), door).not.toContain(ACCOUNT_TITLE);
      expect(JSON.stringify(row), door).not.toContain(PARENT_TITLE);
    }
  });

  it('(a-masked) a target display field served MASKED to the reader is withheld the same way (#20964)', async () => {
    const { requestId } = await openDeal();
    const row: any = await svc.getRequest(requestId, asUser(MASKED));
    expect(row.payload_display ?? {}).not.toHaveProperty('account');
    expect(JSON.stringify(row)).not.toContain(ACCOUNT_TITLE);
    // The targets this reader is served unmasked still name their records.
    expect(row.payload_display).toMatchObject({ vendor: VENDOR_CODE, parent: PARENT_TITLE });
  });

  it('(b) control: a reader who may read every target field gets every title — single read and list', async () => {
    const { requestId, recordId } = await openDeal();
    const one: any = await svc.getRequest(requestId, asUser(READER));
    const [listed]: any[] = await svc.listRequests({ recordId }, asUser(READER));
    for (const [door, row] of [['getRequest', one], ['listRequests', listed]] as const) {
      expect(row.payload_display, door).toEqual({ account: ACCOUNT_TITLE, vendor: VENDOR_CODE, parent: PARENT_TITLE });
    }
  });

  it('(c) a withheld target display field never lends its value: the title is picked from what the reader is served', async () => {
    const { requestId } = await openDeal();
    const row: any = await svc.getRequest(requestId, asUser(RESTRICTED));
    expect(row.payload_display?.vendor).toBe(VENDOR_NAME);
    expect(JSON.stringify(row)).not.toContain(VENDOR_CODE);
  });

  it('(d) one rule, asked once: one answer per object per read, subject and targets together', async () => {
    const first = await openDeal();
    await openDeal();
    const expected = [
      { object: 'crm_deal', userId: RESTRICTED },
      { object: 'crm_account', userId: RESTRICTED },
      { object: 'crm_vendor', userId: RESTRICTED },
    ];

    vis.calls.length = 0;
    await svc.getRequest(first.requestId, asUser(RESTRICTED));
    expect(vis.calls).toEqual(expected);

    vis.calls.length = 0;
    const rows = await svc.listRequests({ object: 'crm_deal', approverId: RESTRICTED }, asUser(RESTRICTED));
    expect(rows.length).toBeGreaterThan(1);
    expect(vis.calls).toEqual(expected);
  });
});
