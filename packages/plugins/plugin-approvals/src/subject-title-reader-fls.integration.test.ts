// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23594] A request's subject title (`record_title`) is served to a reader
 * only from fields that reader may be served.
 *
 * ## The contract
 *
 * `payload-redaction.ts` (#10749): "Redaction is applied at SERVE time, keyed
 * on the reading caller, so the same row answers an admin with the whole
 * snapshot and a restricted approver with only the fields they may read."
 * #7497 ruling C keeps the approver's request detail "with the field snapshot
 * redacted by field-level security". The title is a field of the same subject
 * record, read beside that snapshot, so it answers to the same rule — the SAME
 * answer, asked once: `resolveReadableSnapshotFields` (readable and not masked
 * for this reader). The title is picked from the record AS SERVED to the
 * reader, exactly as the snapshot fallback already picked it from the redacted
 * snapshot, so a withheld field gives the reader nothing — the shape the
 * redaction gives it in the payload.
 *
 * ## What this pins
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory), with a field-visibility source in
 * place of `plugin-security`'s (the three answers it gives are its contract;
 * `approval-payload-redaction.test.ts` holds the payload half):
 *
 *  (a) a reader who may not read the display field gets no `record_title` on
 *      the single read and on the list, and a display field served MASKED to
 *      that reader is withheld the same way (#20964);
 *  (b) the same reader, with the subject record deleted and the snapshot
 *      carrying the title, still gets none;
 *  (c) the decision result row — what the success toast's
 *      `${result.request.record_title}` token reads — carries none for that
 *      reader;
 *  (d) the action-link page, reached by a token and read under the system
 *      context, names the record by its id for EVERY bearer;
 *  (e) the control: a reader who may read the field gets the title on the
 *      single read, the list and the decision result, live and from the
 *      snapshot;
 *  (f) a withheld display field never lends its value to the title: the
 *      title is picked from what the reader is served;
 *  (g) one rule, asked once: the title and the payload share ONE
 *      field-visibility answer per object per read.
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

/** May not read the subject's display field. */
const RESTRICTED = 'u_restricted';
/** May read every field (the control). */
const READER = 'u_reader';
/** Served the display field MASKED: readable, not queryable (#20964). */
const MASKED = 'u_masked';
const SUBMITTER = 'u_sub';

/** The display value a restricted reader must never be served, from any source. */
const LIVE_TITLE = 'Acme secret renewal';
const SNAPSHOT_TITLE = 'Snapshot secret title';

const deal = {
  name: 'crm_deal',
  label: 'Deal',
  nameField: 'name',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    amount: { name: 'amount', label: 'Amount', type: 'number' as const },
  },
};
/** Its display field is `code`; `subject` is another title-eligible field. */
const ticket = {
  name: 'crm_ticket',
  label: 'Ticket',
  nameField: 'code',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    code: { name: 'code', label: 'Code', type: 'text' as const },
    subject: { name: 'subject', label: 'Subject', type: 'text' as const },
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
  crm_deal: ['id', 'name', 'amount'],
  crm_ticket: ['id', 'code', 'subject'],
};
/** reader → object → [readable, queryable]. */
const ANSWERS: Record<string, Record<string, [string[], string[]]>> = {
  [RESTRICTED]: {
    crm_deal: [['id', 'amount'], ['id', 'amount']],
    crm_ticket: [['id', 'subject'], ['id', 'subject']],
  },
  [MASKED]: {
    crm_deal: [['id', 'name', 'amount'], ['id', 'amount']],
  },
  [READER]: {
    crm_deal: [ALL.crm_deal, ALL.crm_deal],
    crm_ticket: [ALL.crm_ticket, ALL.crm_ticket],
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

describe('[#23594] the subject title is served from what its reader may read', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  let vis: ReturnType<typeof makeVisibility>;
  let n = 0;

  /** One pending request on a fresh deal, both approvers on its slate. */
  const openDeal = async (snapshot: Record<string, unknown> = {}) => {
    n += 1;
    const recordId = `D${n}`;
    await engine.insert('crm_deal', { id: recordId, name: LIVE_TITLE, amount: 100 * n }, { context: SYSTEM } as any);
    const row: any = await svc.openNodeRequest({
      object: 'crm_deal', recordId, runId: `run_${n}`, nodeId: 'review', flowName: 'deal_review',
      config: {
        approvers: [RESTRICTED, MASKED, READER].map((value) => ({ type: 'user', value })),
        behavior: 'first_response',
      } as any,
      submitterId: SUBMITTER, record: { id: recordId, name: LIVE_TITLE, amount: 100 * n, ...snapshot },
    }, asUser(SUBMITTER));
    return { requestId: String(row.id), recordId };
  };

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [sysUser, deal, ticket, ...(await packageObjects())]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    for (const id of [RESTRICTED, READER, MASKED, SUBMITTER]) {
      await engine.insert('sys_user', { id, name: id, email: `${id}@example.com` }, { context: SYSTEM } as any);
    }
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

  it('(a) a reader who may not read the display field gets no title — single read and list', async () => {
    const { requestId, recordId } = await openDeal();

    const one: any = await svc.getRequest(requestId, asUser(RESTRICTED));
    const [listed]: any[] = await svc.listRequests({ recordId }, asUser(RESTRICTED));
    for (const [door, row] of [['getRequest', one], ['listRequests', listed]] as const) {
      expect(row, door).toBeTruthy();
      expect(row, door).not.toHaveProperty('record_title');
      expect(JSON.stringify(row), door).not.toContain(LIVE_TITLE);
      // The same answer narrows the snapshot: the business field still serves.
      expect(row.payload, door).toEqual({ id: recordId, amount: expect.any(Number) });
      expect(row.object_label, door).toBe('Deal');
    }
  });

  it('(a) a display field served MASKED to the reader is withheld as the snapshot withholds it (#20964)', async () => {
    const { requestId } = await openDeal();
    const row: any = await svc.getRequest(requestId, asUser(MASKED));
    expect(row).not.toHaveProperty('record_title');
    expect(JSON.stringify(row)).not.toContain(LIVE_TITLE);
  });

  it('(b) the subject deleted, the snapshot carrying the title: the restricted reader still gets none', async () => {
    const { requestId, recordId } = await openDeal({ name: SNAPSHOT_TITLE });
    await engine.delete('crm_deal', { where: { id: recordId }, context: SYSTEM } as any);

    const restricted: any = await svc.getRequest(requestId, asUser(RESTRICTED));
    expect(restricted).not.toHaveProperty('record_title');
    expect(JSON.stringify(restricted)).not.toContain(SNAPSHOT_TITLE);

    // (e) control, the fallback leg: the reader who may read it gets the snapshot's title.
    const reader: any = await svc.getRequest(requestId, asUser(READER));
    expect(reader.record_title).toBe(SNAPSHOT_TITLE);
  });

  it('(c) the decision result row — the toast token\'s source — carries no title for the restricted reader', async () => {
    const { requestId } = await openDeal();
    const out: any = await svc.decide(requestId, { decision: 'approve', actorId: RESTRICTED }, asUser(RESTRICTED));
    expect(out.request.status).toBe('approved');
    // `Approved "${result.request.record_title}"` reads nothing here.
    expect(out.request).not.toHaveProperty('record_title');
    expect(JSON.stringify(out.request)).not.toContain(LIVE_TITLE);
  });

  it('(e) control: a reader who may read the field gets the title — single read, list and decision result', async () => {
    const { requestId, recordId } = await openDeal();

    const one: any = await svc.getRequest(requestId, asUser(READER));
    const [listed]: any[] = await svc.listRequests({ recordId }, asUser(READER));
    expect(one.record_title).toBe(LIVE_TITLE);
    expect(listed.record_title).toBe(LIVE_TITLE);
    expect(one.payload).toMatchObject({ name: LIVE_TITLE });

    const out: any = await svc.decide(requestId, { decision: 'approve', actorId: READER }, asUser(READER));
    expect(out.request.record_title).toBe(LIVE_TITLE);
  });

  it('(d) the action-link page names the record by its id, for every bearer — confirm page and result page', async () => {
    for (const approver of [RESTRICTED, READER]) {
      const { requestId, recordId } = await openDeal();
      const { approve } = await svc.issueActionTokens(requestId, approver);
      const url = `http://approvals.test/api/v1/approvals/act?token=${encodeURIComponent(approve)}`;

      const confirm = await (await svc.handleActionPage(new Request(url, { method: 'GET' }))).text();
      expect(confirm, `${approver} confirm`).toContain('name="token"');
      expect(confirm, `${approver} confirm`).toContain(`<b>${recordId}</b>`);
      expect(confirm, `${approver} confirm`).not.toContain(LIVE_TITLE);

      const result = await (await svc.handleActionPage(new Request('http://approvals.test/api/v1/approvals/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: approve }).toString(),
      }))).text();
      expect(result, `${approver} result`).toContain('Approved');
      expect(result, `${approver} result`).toContain(`<b>${recordId}</b>`);
      expect(result, `${approver} result`).not.toContain(LIVE_TITLE);
    }
  });

  it('(f) a withheld display field never lends its value: the title is picked from what the reader is served', async () => {
    await engine.insert('crm_ticket', { id: 'T1', code: 'SECRET-CODE-7', subject: 'Printer jammed' }, { context: SYSTEM } as any);
    const row: any = await svc.openNodeRequest({
      object: 'crm_ticket', recordId: 'T1', runId: 'run_ticket', nodeId: 'review', flowName: 'ticket_review',
      config: { approvers: [RESTRICTED, READER].map((value) => ({ type: 'user', value })), behavior: 'first_response' } as any,
      submitterId: SUBMITTER, record: { id: 'T1', code: 'SECRET-CODE-7', subject: 'Printer jammed' },
    }, asUser(SUBMITTER));

    const restricted: any = await svc.getRequest(String(row.id), asUser(RESTRICTED));
    expect(restricted.record_title).toBe('Printer jammed');
    expect(JSON.stringify(restricted)).not.toContain('SECRET-CODE-7');
    // Control: the declared display field still answers for a reader who may read it.
    expect((await svc.getRequest(String(row.id), asUser(READER)) as any).record_title).toBe('SECRET-CODE-7');
  });

  it('(g) one rule, asked once: the title and the payload share one answer per object per read', async () => {
    const first = await openDeal();
    await openDeal();
    vis.calls.length = 0;
    await svc.getRequest(first.requestId, asUser(RESTRICTED));
    expect(vis.calls).toEqual([{ object: 'crm_deal', userId: RESTRICTED }]);

    vis.calls.length = 0;
    const rows = await svc.listRequests({ object: 'crm_deal', approverId: RESTRICTED }, asUser(RESTRICTED));
    expect(rows.length).toBeGreaterThan(1);
    expect(vis.calls).toEqual([{ object: 'crm_deal', userId: RESTRICTED }]);
  });
});
