// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26571] `access-security.parent-and-organization-write-guards`,
// acceptance[1], acceptance[2] and negative[0], over HTTP on the showcase.
//
// `tenant-wall-organization-removal.test.ts` and the two engine master-detail
// header tests drive a real engine and SecurityPlugin in-process and read the
// answer off the thrown error; the item scores these clauses at the `api`
// oracle, so this file drives the REST data door:
//
//   - acceptance[2] / negative[0] (stock single posture): a showcase
//     contributor POSTs an invoice line naming another contributor's invoice
//     (owner RLS `owner == current_user.email` hides it from them) and one
//     naming an invoice id that exists nowhere. Both answer 400 with the
//     reference_not_found code, and the two bodies are equal field by field
//     once the id each names is normalised — no existence oracle. The
//     invoice's own owner, posting the same line, lands it (the control);
//   - acceptance[1] (walled: `multiTenant: 'posture-only'`, a real `isolated`
//     posture with the Layer 0 wall active): an organization owner who is not
//     the platform administrator PATCHes their own record with
//     `organization_id: null` and is refused 403 PERMISSION_DENIED, the row
//     keeping its organization; an insert that sends an empty organization is
//     stamped with the caller's active one.
//
// acceptance[3] is pinned in `cbp-parent-attachment-comment-gates` and
// `cbp-explain-master-write`. Isolated boots: the file writes records and
// creates an organization.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const LINES = '/data/showcase_invoice_line';
const C1 = 'header-parity-c1@verify.test';
const C2 = 'header-parity-c2@verify.test';
const MISSING_INVOICE = 'inv_missing_26571';
const TASKS = '/data/showcase_task';
const MISSING_PROJECT = 'prj_missing_26571';
const TASK_WRITER = 'qa_task_writer_26571';
const WRITER = 'header-parity-writer@verify.test';

const codeOf = (body: any) =>
  (body?.error && typeof body.error === 'object' ? body.error.code : undefined) ?? body?.code ?? null;
const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id ?? b?.recordId;

/** The body with every occurrence of `id` replaced by a placeholder, so two refusals naming different ids compare. */
const normalised = (text: string, id: string) => JSON.parse(text.split(id).join('<header-id>'));

/** Every `code` anywhere in the body (envelope or per-field). */
const codesIn = (body: unknown): string[] => {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'code' && typeof x === 'string') out.push(x);
        walk(x);
      }
    }
  };
  walk(body);
  return out;
};

describe('a detail write naming an unreadable header answers what a nonexistent header does', () => {
  let stack: VerifyStack;
  let ql: any;
  let admin: string;
  let writer: string;
  let projectId: string;
  const tok: Record<string, string> = {};
  let invoiceId: string;
  let product: string;

  const grant = async (email: string, set: string) => {
    const token = await stack.signUp(email);
    const userId = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
    expect(userId, `${email} provisioned`).toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: userId, permission_set: set }, { context: SYS });
    return token;
  };
  const answer = async (token: string, path: string, body: Record<string, unknown>) => {
    const res = await stack.apiAs(token, 'POST', path, body);
    return { status: res.status, text: await res.text() };
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    // A scratch set that writes tasks and selects no project: every member reads
    // projects through the stock baseline, so the set's row policy narrows it.
    const saved = await stack.apiAs(admin, 'PUT', `/meta/permission/${TASK_WRITER}`, {
      name: TASK_WRITER, label: 'QA task writer', systemPermissions: [],
      objects: { showcase_task: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false } },
      rowLevelSecurity: [{
        name: 'qa_no_project_rows', label: 'No project rows', object: 'showcase_project', operation: 'select',
        using: "name == 'qa-no-such-project-26571'", enabled: true,
      }],
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    writer = await grant(WRITER, TASK_WRITER);
    projectId = String((await ql.find('showcase_project', { limit: 1, context: SYS }))?.[0]?.id ?? '');
    expect(projectId, 'the showcase seed provides a project').toBeTruthy();

    // The controlled_by_parent pair: two stock contributors, C1 owning an invoice.
    const ps = await catalogPermissionSet(ql, 'showcase_contributor');
    expect(ps, 'the stock contributor set').toBeTruthy();
    for (const email of [C1, C2]) tok[email] = await grant(email, ps.name);
    // An invoice may not be issued against a churned account (#18682).
    const account = (await ql.find('showcase_account', { where: { status: { $ne: 'churned' } }, limit: 1, context: SYS }))?.[0]?.id;
    product = (await ql.find('showcase_product', { limit: 1, context: SYS }))?.[0]?.id;
    expect(account && product, 'the showcase seed provides an account and a product').toBeTruthy();
    const inv = await stack.apiAs(tok[C1], 'POST', '/data/showcase_invoice', { name: 'INV-HEADER-PARITY', account, status: 'draft', owner: C1 });
    expect(inv.status, await inv.clone().text()).toBeLessThan(300);
    invoiceId = String(idOf(await inv.json()));

    for (const [object, id] of [['showcase_project', MISSING_PROJECT], ['showcase_invoice', MISSING_INVOICE]]) {
      expect(await ql.findOne(object, { where: { id }, context: SYS }), `${id} exists nowhere`).toBeFalsy();
    }
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('guard the guard: each writer cannot read the header it names; its owner or the admin can', async () => {
    expect((await stack.apiAs(writer, 'GET', `/data/showcase_project/${projectId}`)).status, 'the task writer cannot read the project').toBeGreaterThanOrEqual(400);
    expect((await stack.apiAs(admin, 'GET', `/data/showcase_project/${projectId}`)).status).toBe(200);
    expect((await stack.apiAs(tok[C2], 'GET', `/data/showcase_invoice/${invoiceId}`)).status, 'C2 cannot read C1\'s invoice').toBeGreaterThanOrEqual(400);
    expect((await stack.apiAs(tok[C1], 'GET', `/data/showcase_invoice/${invoiceId}`)).status).toBe(200);
  });

  it('acceptance[2] / negative[0]: an unreadable and a nonexistent master answer the same 400 reference_not_found, field by field', async () => {
    const task = (project: string) => ({ title: 'header parity', status: 'todo', project });
    const unreadable = await answer(writer, TASKS, task(projectId));
    const missing = await answer(writer, TASKS, task(MISSING_PROJECT));
    expect(unreadable.status, unreadable.text).toBe(400);
    expect(missing.status, missing.text).toBe(400);
    expect(codesIn(JSON.parse(missing.text)), missing.text).toContain('reference_not_found');
    expect(normalised(unreadable.text, projectId), 'no existence oracle').toEqual(normalised(missing.text, MISSING_PROJECT));
    expect(await ql.find('showcase_task', { where: { title: 'header parity' }, context: SYS }), 'nothing landed').toEqual([]);
    // Control: the admin, who reads the project, lands the same task.
    const control = await answer(admin, TASKS, task(projectId));
    expect(control.status, control.text).toBeLessThan(300);
  });

  it('negative[0] on a controlled_by_parent detail: an unreadable and a nonexistent invoice answer one refusal, byte for byte', async () => {
    // ADR-0055 §3 gates a controlled_by_parent detail's insert on edit access to
    // its master before the reference check runs, so the answer here is that
    // gate's 403, not 400 — measured identical for both, so no existence oracle.
    const line = (invoice: string) => ({ invoice, product, quantity: 1, description: 'header parity' });
    const unreadable = await answer(tok[C2], LINES, line(invoiceId));
    const missing = await answer(tok[C2], LINES, line(MISSING_INVOICE));
    expect([unreadable.status, codeOf(JSON.parse(unreadable.text))], unreadable.text).toEqual([403, 'PERMISSION_DENIED']);
    expect(normalised(unreadable.text, invoiceId), 'no existence oracle').toEqual(normalised(missing.text, MISSING_INVOICE));
    expect(await ql.find('showcase_invoice_line', { where: { invoice: invoiceId }, context: SYS }), 'nothing landed').toEqual([]);
    // Control: the invoice's owner posts the same line and it lands.
    const control = await answer(tok[C1], LINES, line(invoiceId));
    expect(control.status, control.text).toBeLessThan(300);
  });
});

describe('walled: an update that empties organization_id is refused; an empty-org insert is stamped', () => {
  const OWNER = 'org-removal-owner@verify.test';
  const NOTES = '/data/showcase_private_note';
  let stack: VerifyStack;
  let ql: any;
  let owner: string;
  let orgId: string;
  let noteId: string;

  const orgOf = async (id: string) =>
    (await ql.findOne('showcase_private_note', { where: { id }, context: SYS }))?.organization_id ?? null;

  beforeAll(async () => {
    stack = await bootShowcase({ multiTenant: 'posture-only' });
    ql = await stack.kernel.getServiceAsync('objectql');
    owner = await stack.signUp(OWNER);
    const created = await stack.apiAs(owner, 'POST', '/auth/organization/create', { name: 'Org Removal', slug: 'org-removal-26571' });
    expect(created.status, await created.clone().text()).toBe(200);
    orgId = String(((await created.json()) as { id: string }).id);
    const active = await stack.apiAs(owner, 'POST', '/auth/organization/set-active', { organizationId: orgId });
    expect(active.status, await active.clone().text()).toBe(200);
    const note = await stack.apiAs(owner, 'POST', NOTES, { title: 'org removal' });
    expect(note.status, await note.clone().text()).toBeLessThan(300);
    noteId = String(idOf(await note.json()));
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('guard the guard: the Layer 0 wall is active and the caller is no platform administrator', async () => {
    const tenancy = await stack.kernel.getServiceAsync<{ posture: string; isolationActive: boolean; degraded: boolean }>('tenancy');
    expect([tenancy.posture, tenancy.isolationActive, tenancy.degraded]).toEqual(['isolated', true, false]);
    const session = (await (await stack.apiAs(owner, 'GET', '/auth/get-session')).json()) as any;
    expect(session.user?.isPlatformAdmin).not.toBe(true);
    expect(session.user?.positions ?? []).not.toContain('platform_admin');
    expect(await orgOf(noteId), 'the note lives in the owner\'s organization').toBe(orgId);
  });

  it('acceptance[1]: PATCH { organization_id: null } answers 403 PERMISSION_DENIED and the row keeps its organization', async () => {
    const res = await stack.apiAs(owner, 'PATCH', `${NOTES}/${noteId}`, { organization_id: null });
    const body = (await res.json()) as any;
    expect([res.status, body?.error?.code ?? body?.code], JSON.stringify(body)).toEqual([403, 'PERMISSION_DENIED']);
    expect(await orgOf(noteId)).toBe(orgId);
    // Control: the same caller's update that leaves the column alone is admitted.
    const ok = await stack.apiAs(owner, 'PATCH', `${NOTES}/${noteId}`, { body: 'edited' });
    expect(ok.status, await ok.clone().text()).toBeLessThan(300);
    expect(await orgOf(noteId)).toBe(orgId);
  });

  it('acceptance[1]: an insert that sends an empty organization is stamped with the caller\'s active one', async () => {
    for (const empty of [null, '']) {
      const res = await stack.apiAs(owner, 'POST', NOTES, { title: `empty org ${JSON.stringify(empty)}`, organization_id: empty });
      expect(res.status, await res.clone().text()).toBeLessThan(300);
      expect(await orgOf(String(idOf(await res.json())))).toBe(orgId);
    }
  });
});
