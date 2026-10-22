// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24665] The served approval request page's title: the flow's label, served
 * by the approvals get under the object's declared `nameField`, and never the
 * subject record's id or the flow's machine name.
 *
 * ## The contract
 *
 * The request page (`sys_approval_request_detail`) authors no header, so the
 * console titles it from the object's declaration over the row the approvals
 * get serves: the `nameField` value, then the deprecated `titleFormat` only
 * where that value is empty (ADR-0079). The pointer used to be `display_title`,
 * a formula the get never served, so every page fell through to the template
 * `{process_name} · {record_id}` — `flow:NAME · RECORD_ID` as its H1.
 *
 * Now the pointer is `process_label`, a stored column the get serves by the
 * display-label chain (the column, else the config snapshot's label, else the
 * humanized machine name). So:
 *
 *  1. the get serves a non-empty value under the declared `nameField`, and the
 *     list door serves the same (acceptance 1);
 *  2. that value names no record id and no `flow:` machine name, whatever the
 *     subject record's state — readable, deleted by the platform, or
 *     unresolvable — because the title reads nothing of the subject
 *     (acceptance 2, one case per state);
 *  3. a row with no label stored is titled by the humanized machine name, so
 *     the template fallback is not reached on this door at all.
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory, real DDL), with the plugin's own
 * objects from its manifest.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;

const FLOW = { name: 'invoice_approval', label: 'Invoice Sign-off', nodes: [{ id: 'review', type: 'approval', label: 'Finance review' }], edges: [] };
/** The humanized machine name the display-label chain draws from `flow:invoice_approval`. */
const HUMANIZED = 'Invoice Approval';
const APPROVER = 'u_appr';

const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    email: { name: 'email', label: 'Email', type: 'text' as const },
  },
};
const invoice = {
  name: 'invoice',
  label: 'Invoice',
  nameField: 'name',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Invoice Number', type: 'text' as const },
  },
};

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

/** The title the declaration names on a served row: the value under `nameField`. */
const NAME_FIELD = SysApprovalRequest.nameField as string;
const titleOf = (row: object | null | undefined): unknown => (row as Record<string, unknown> | null | undefined)?.[NAME_FIELD];

describe('#24665 — the approval request title is the flow label the approvals get serves', () => {
  let engine: ObjectQL;
  let driver: SqlDriver;
  let svc: ApprovalService;
  let now = Date.parse('2026-10-20T09:00:00.000Z');

  /** A request opened by the real service over a readable invoice. */
  const open = async (recordId: string): Promise<string> => {
    await engine.insert('invoice', { id: recordId, name: `INV-${recordId.slice(-4)}` }, { context: SYSTEM } as any);
    const row: any = await svc.openNodeRequest({
      object: 'invoice', recordId, runId: `run_${recordId}`, nodeId: 'review',
      flowName: FLOW.name, flowLabel: FLOW.label, nodeLabel: 'Finance review',
      config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response' } as any,
      submitterId: 'u_sub', record: { id: recordId, name: `INV-${recordId.slice(-4)}` },
    }, asUser('u_sub'));
    return row.id as string;
  };

  /** The title, asserted the same on both doors that serve a request row. */
  const servedTitle = async (id: string, reader: any): Promise<string> => {
    const got = await svc.getRequest(id, reader);
    expect(got, `get ${id}`).not.toBeNull();
    const listed = (await svc.listRequests({ object: got!.object_name, recordId: got!.record_id }, reader))
      .find((r) => r.id === id);
    expect(listed, `list ${id}`).toBeDefined();
    expect(titleOf(listed), `list ${id}`).toEqual(titleOf(got));
    const title = titleOf(got);
    expect(typeof title).toBe('string');
    return title as string;
  };

  /** What the H1 must never carry, for one served row. */
  const expectNoIdNoMachineName = (title: string, recordId: string) => {
    expect(title.trim()).not.toBe('');
    expect(title).not.toContain(recordId);
    expect(title).not.toMatch(/flow:/);
  };

  beforeAll(async () => {
    engine = new ObjectQL();
    driver = new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    });
    engine.registerDriver(driver, true);
    await engine.init();
    for (const def of [sysUser, invoice, ...(await packageObjects())]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    for (const u of [{ id: 'u_sub', name: 'Sam' }, { id: APPROVER, name: 'Ada' }]) {
      await engine.insert('sys_user', u, { context: SYSTEM } as any);
    }
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      automation: {
        resume: async () => ({ status: 'completed' }),
        cancelRun: async () => undefined,
        getRun: async (runId: string) => ({ id: runId, status: 'paused' }),
        getFlow: async () => FLOW,
      } as any,
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
    });
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the declaration: the title pointer is a stored, declared column, and the template names no record id', async () => {
    expect(NAME_FIELD).toBe('process_label');
    expect(SysApprovalRequest.displayNameField).toBe(NAME_FIELD);
    expect((SysApprovalRequest.fields as Record<string, any>)[NAME_FIELD]).toMatchObject({ type: 'text' });
    // Stored: the column exists in the real DDL (a formula pointer has none,
    // which is why the get could not serve it).
    const columns = Object.keys(await driver.getKnex()('sys_approval_request').columnInfo());
    expect(columns).toContain(NAME_FIELD);
    expect(columns).not.toContain('display_title');
    const template = SysApprovalRequest.titleFormat as unknown;
    const source = typeof template === 'string' ? template : (template as { source?: string })?.source;
    expect(source).toBe('{process_name}');
    expect(source).not.toContain('record_id');
  });

  it('readable subject: the get serves the flow label under nameField, with no record id and no machine name', async () => {
    const recordId = 'Rd4bl3Rec24665QQ';
    const id = await open(recordId);
    const title = await servedTitle(id, asUser(APPROVER));
    expect(title).toBe(FLOW.label);
    expectNoIdNoMachineName(title, recordId);
    // The subject is still named — by the reference pair the Details tab draws.
    const got = await svc.getRequest(id, asUser(APPROVER));
    expect(got).toMatchObject({ object_name: 'invoice', record_id: recordId });
  });

  it('deleted subject: the platform-cancelled request keeps the flow label as its title', async () => {
    const recordId = 'D3l3t3dRec24665Q';
    const id = await open(recordId);
    // What the platform leaves when the subject is deleted: the record gone,
    // the request cancelled with `record_deleted`.
    await engine.delete('invoice', { where: { id: recordId }, context: SYSTEM } as any);
    await engine.update('sys_approval_request', { id, status: 'cancelled', cancel_reason: 'record_deleted' }, { context: SYSTEM } as any);
    const got = await svc.getRequest(id, SYSTEM);
    expect(got).toMatchObject({ status: 'cancelled', cancel_reason: 'record_deleted', record_id: recordId });
    const title = await servedTitle(id, SYSTEM);
    expect(title).toBe(FLOW.label);
    expectNoIdNoMachineName(title, recordId);
  });

  it('unresolvable subject: a request about an object the registry does not hold keeps the flow label as its title', async () => {
    const recordId = 'Un0penRec24665QQ';
    const id = 'areq_unresolvable_24665';
    await engine.insert('sys_approval_request', {
      id, process_name: `flow:${FLOW.name}`, process_label: FLOW.label,
      object_name: 'retired_invoice', record_id: recordId, status: 'pending',
      current_step: 'review', current_step_label: 'Finance review', pending_approvers: APPROVER,
    }, { context: SYSTEM } as any);
    const title = await servedTitle(id, SYSTEM);
    expect(title).toBe(FLOW.label);
    expectNoIdNoMachineName(title, recordId);
  });

  it('a row with no label stored is titled by the humanized machine name on this door, so the template is never reached', async () => {
    const recordId = 'N0LabelRec24665Q';
    const id = await open(recordId);
    // The row the boot fill has not reached: no label column, no snapshot label.
    await engine.update('sys_approval_request', {
      id, process_label: null, node_config_json: JSON.stringify({ approvers: [{ type: 'user', value: APPROVER }] }),
    }, { context: SYSTEM } as any);
    const title = await servedTitle(id, SYSTEM);
    expect(title).toBe(HUMANIZED);
    expectNoIdNoMachineName(title, recordId);
  });
});
