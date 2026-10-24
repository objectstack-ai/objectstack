// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#25468] The showcase's record-write actions write AS THE CALLER, over real HTTP.
//
// Mark Done, Reopen and Submit for Sign-off each set fields on their own
// record and nothing else, so each declares the write (`operation: 'update'` +
// `patch`) instead of performing it from a script body. The difference is the
// whole point: a body's `ctx.api` runs with the system identity
// (`buildActionExecutionContext` stamps `isSystem`), so a body that writes is
// reachable by anyone who can see the button, while the platform action route
// performs a declared write with the CALLER's own envelope — object CRUD, RLS,
// FLS, hooks and validation all apply, exactly as for a PATCH of the same row.
//
// So every refusal below is paired with the data plane's own answer for the
// same caller and the same row: the action route must say what `PATCH
// /data/...` says. And every refusal is paired with an ALLOW for a caller who
// may edit, because a pin that only asserts denials stays green when the
// actions stop working for everyone.
//
// Personas are fresh sign-ups holding exactly one set (or none), granted the
// way `showcase-crud-persona-matrix.dogfood.test.ts` grants them:
//   • member — the everyone baseline only: task read + create, no edit;
//   • contributor — `showcase_contributor`, which edits tasks assigned to them;
//   • auditor — `showcase_auditor`: View-All on invoices, no write bit anywhere.
//
// What this file does NOT cover: the console. The button is still OFFERED to
// a caller who may not edit (hiding it by edit permission is not something
// `visible` can express); the click's refusal toast is the console's, pinned in
// objectui (`ActionRunner.updateOperation.test.ts`).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';
import { catalogPermissionSet } from './catalog-permission-set.js';
// The refusal sentence, from the hook that throws it — a source import: the
// showcase package exports no hooks entry, and the oracle must be the shipped
// string, never a copy of it.
import { TASK_REOPEN_REFUSAL } from '../../../../examples/app-showcase/src/data/hooks/index.js';

const SYS = { isSystem: true } as const;
const ADMIN_EMAIL = 'admin@objectos.ai';

const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id;

describe('showcase: record-write actions write as the caller (#25468)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  const tok = { member: '', contributor: '', auditor: '' };
  const email = {
    member: 'rwa-member@verify.test',
    contributor: 'rwa-contributor@verify.test',
    auditor: 'rwa-auditor@verify.test',
  };
  let projectId = '';
  let accountId = '';

  const text = async (r: Response) => {
    try {
      return await r.text();
    } catch {
      return '';
    }
  };
  const readTask = async (id: string) =>
    (await ql.findOne('showcase_task', { where: { id }, context: SYS })) as any;
  const readInvoice = async (id: string) =>
    (await ql.findOne('showcase_invoice', { where: { id }, context: SYS })) as any;

  /** An open task created by the admin over HTTP, optionally assigned. */
  async function openTask(title: string, assignee?: string): Promise<string> {
    const r = await stack.apiAs(adminTok, 'POST', '/data/showcase_task', {
      title,
      project: projectId,
      status: 'todo',
      ...(assignee ? { assignee } : {}),
    });
    const body = await text(r);
    expect(r.status, `admin creates the task fixture — got ${body}`).toBeLessThan(300);
    const id = String(idOf(JSON.parse(body)));
    expect(id).toBeTruthy();
    const stored = await readTask(id);
    expect(stored.done, 'the fixture starts open').toBeFalsy();
    return id;
  }

  /** A finished task: created open, then finished by the admin's own edit. */
  async function finishedTask(title: string): Promise<string> {
    const id = await openTask(title);
    const r = await stack.apiAs(adminTok, 'PATCH', `/data/showcase_task/${id}`, { done: true, progress: 100 });
    expect(r.status, `admin finishes the task fixture — got ${await text(r)}`).toBeLessThan(300);
    expect((await readTask(id)).done).toBeTruthy();
    return id;
  }

  /**
   * A draft invoice created by the admin. `issued_on` is set because the
   * invoice requires it once `status` is `sent` — the submit write must be
   * judged on permission, never on a missing field.
   */
  async function draftInvoice(name: string): Promise<string> {
    const r = await stack.apiAs(adminTok, 'POST', '/data/showcase_invoice', {
      name,
      account: accountId,
      status: 'draft',
      owner: ADMIN_EMAIL,
      issued_on: '2026-10-01',
    });
    const body = await text(r);
    expect(r.status, `admin creates the invoice fixture — got ${body}`).toBeLessThan(300);
    const id = String(idOf(JSON.parse(body)));
    expect((await readInvoice(id)).status).toBe('draft');
    return id;
  }

  const run = (token: string, object: string, action: string, id: string) =>
    stack.apiAs(token, 'POST', `/actions/${object}/${action}/${id}`, {});

  beforeAll(async () => {
    stack = await bootShowcase({ security: showcaseAppDefaultSecurity() });
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    projectId = String((await ql.find('showcase_project', { limit: 1, context: SYS }))?.[0]?.id ?? '');
    // An invoice may not be issued against a churned account (#18682).
    accountId = String(
      (await ql.find('showcase_account', { where: { status: { $ne: 'churned' } }, limit: 1, context: SYS }))?.[0]?.id ?? '',
    );
    expect(projectId && accountId, 'the showcase seed provides a project and an open account').toBeTruthy();

    tok.member = await stack.signUp(email.member);
    for (const [who, set] of [['contributor', 'showcase_contributor'], ['auditor', 'showcase_auditor']] as const) {
      tok[who] = await stack.signUp(email[who]);
      const ps = await catalogPermissionSet(ql, set);
      expect(ps, `permission set ${set} served by the security catalog`).toBeTruthy();
      const uid = (await ql.findOne('sys_user', { where: { email: email[who] }, context: SYS }))?.id;
      expect(uid, `persona ${email[who]} provisioned`).toBeTruthy();
      await ql.insert('sys_user_permission_set', { user_id: uid, permission_set: ps.name }, { context: SYS });
    }
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  describe('Mark Done', () => {
    it('a member who may read but not edit the task is refused 403, as a PATCH is, and the task is unchanged', async () => {
      const id = await openTask('RWA mark-done member');
      // The member CAN read the row: the refusal is the edit verdict, not a miss.
      const read = await stack.apiAs(tok.member, 'GET', `/data/showcase_task/${id}`);
      expect(read.status, await text(read)).toBe(200);

      const patch = await stack.apiAs(tok.member, 'PATCH', `/data/showcase_task/${id}`, { done: true, progress: 100 });
      expect(patch.status, `the data plane's own answer — ${await text(patch)}`).toBe(403);

      const res = await run(tok.member, 'showcase_task', 'showcase_mark_done', id);
      expect(res.status, `the action route answers as the data plane does — ${await text(res)}`).toBe(403);

      const stored = await readTask(id);
      expect(stored.done).toBeFalsy();
      expect(stored.progress ?? 0).not.toBe(100);
    }, 60_000);

    it('a contributor may finish a task assigned to them: done and progress land', async () => {
      const id = await openTask('RWA mark-done contributor', email.contributor);

      const res = await run(tok.contributor, 'showcase_task', 'showcase_mark_done', id);
      expect(res.status, await text(res)).toBe(200);

      const stored = await readTask(id);
      expect(stored.done).toBeTruthy();
      expect(stored.progress).toBe(100);
    }, 60_000);

    it('the admin may finish any task', async () => {
      const id = await openTask('RWA mark-done admin');

      const res = await run(adminTok, 'showcase_task', 'showcase_mark_done', id);
      expect(res.status, await text(res)).toBe(200);
      expect((await readTask(id)).done).toBeTruthy();
    }, 60_000);
  });

  describe('Reopen', () => {
    it('a member who may not edit the task is refused 403 before the guard hook is reached', async () => {
      const id = await finishedTask('RWA reopen member');

      const res = await run(tok.member, 'showcase_task', 'showcase_reopen_task', id);
      const body = await text(res);
      expect(res.status, body).toBe(403);
      // The permission verdict, not the hook's: a 4xx carrying the hook's
      // sentence here would mean the write ran far enough to meet the hook.
      expect(body).not.toContain(TASK_REOPEN_REFUSAL);
      expect((await readTask(id)).done).toBeTruthy();
    }, 60_000);

    it('a caller who may edit meets the guard hook: 4xx carrying its sentence, and the task stays finished', async () => {
      const id = await finishedTask('RWA reopen admin');

      const res = await run(adminTok, 'showcase_task', 'showcase_reopen_task', id);
      const body = await text(res);
      expect(res.status, body).toBeGreaterThanOrEqual(400);
      expect(res.status, body).toBeLessThan(500);
      expect(body).toContain(TASK_REOPEN_REFUSAL);
      expect((await readTask(id)).done).toBeTruthy();
    }, 60_000);
  });

  describe('Submit for Sign-off', () => {
    it('the auditor, who reads every invoice but edits none, is refused 403, as a PATCH is, and the status is unchanged', async () => {
      const id = await draftInvoice('RWA submit auditor');
      const read = await stack.apiAs(tok.auditor, 'GET', `/data/showcase_invoice/${id}`);
      expect(read.status, await text(read)).toBe(200);

      const patch = await stack.apiAs(tok.auditor, 'PATCH', `/data/showcase_invoice/${id}`, { status: 'sent' });
      expect(patch.status, `the data plane's own answer — ${await text(patch)}`).toBe(403);

      const res = await run(tok.auditor, 'showcase_invoice', 'showcase_submit_signoff', id);
      expect(res.status, `the action route answers as the data plane does — ${await text(res)}`).toBe(403);
      expect((await readInvoice(id)).status).toBe('draft');
    }, 60_000);

    it('the admin may submit: the invoice is sent', async () => {
      const id = await draftInvoice('RWA submit admin');

      const res = await run(adminTok, 'showcase_invoice', 'showcase_submit_signoff', id);
      expect(res.status, await text(res)).toBe(200);
      expect((await readInvoice(id)).status).toBe('sent');
    }, 60_000);
  });
});
