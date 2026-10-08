// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// On the write doors, a row the caller cannot READ is a row that does not
// exist — measured at the REST data door on the two parent-derived join
// objects (`sys_attachment`, `sys_comment`), whose read visibility a data
// middleware derives from the row's parent record.
//
// ── what is pinned, per principal class ───────────────────────────────────
//
// Two classes: a session OUTSIDE the ownership floor's `org_member` domain
// (no write-class row filter binds it) and an `org_member` INSIDE it. For each,
// on update and delete, on both objects:
//
//   1. ⭐ the WHOLE answer for a row the caller cannot read — status, code,
//      sentence, envelope — equals the answer for an id that exists nowhere.
//      The one difference allowed is the id the caller itself supplied.
//   2. a caller who can read the row but may not write it gets 403, and never
//      the not-found: they already see the row. Which gate answers is
//      unchanged by the ruling — the by-id write pre-image check's
//      `PERMISSION_DENIED` with the record-level sentence where the ownership
//      floor binds the verb (inside the domain, on update), the parent-derived
//      gate's own named refusal everywhere else.
//   3. a row the caller can read and may write is still written.
//
// Who may write is otherwise unchanged: every refused write leaves its row in
// place.
//
// ── the arming is the pin ─────────────────────────────────────────────────
//
// Each boot proves its principal's domain before anything is measured, as the
// sibling parent-derived refusal pin does: outside must NOT hold `org_member`,
// inside MUST, and both hold the delete grants, or every cell measures an RBAC
// refusal instead.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defineStack } from '@objectstack/spec';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { AuditPlugin } from '@objectstack/plugin-audit';
import {
  AttCase,
  AttSecret,
  AttReadonly,
  attFixtureBaselineSet,
  attachmentManagerSet,
} from './fixtures/attachments-fixture.js';
import { CmtOpen, CmtPrivate, CmtReadonly, commentManagerSet } from './fixtures/comments-fixture.js';
import { armedWhen, assertArmed, leaveOrganization, principalArmed, resolveAuthzFor } from './armed.js';

const SYS = { isSystem: true } as const;
const RECORD_SENTENCE = BUILTIN_OPERATION_MESSAGES.en.record_access_denied!;

const stackDefinition = defineStack({
  manifest: {
    id: 'com.dogfood.write-door-unreadable-is-not-found',
    version: '0.0.0',
    type: 'app',
    name: 'Write door: an unreadable row is a missing row',
    description:
      'Open, private and read-only parents for sys_attachment and sys_comment: the by-id write answer for a row the caller cannot read, beside the answer for a missing id.',
  },
  objects: [AttCase, AttSecret, AttReadonly, CmtOpen, CmtPrivate, CmtReadonly],
});

function security(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [
      ...securityDefaultPermissionSets,
      attFixtureBaselineSet,
      attachmentManagerSet,
      commentManagerSet,
    ],
    fallbackPermissionSet: attFixtureBaselineSet.name,
  });
}

const GRANTS = [attachmentManagerSet.name, commentManagerSet.name];

interface Booted {
  stack: VerifyStack;
  rootDir: string;
  ql: any;
  adminId: string;
  token: string;
}

/**
 * Boot the stack and sign `email` up. [ADR-0131 D3] Every boot is the
 * production `single` shape, so the sign-up is a member of the Default
 * Organization; the OUTSIDE class is that user removed from it (an
 * administrator's act), not an org-less boot, which no longer exists.
 */
async function boot(inside: boolean, email: string): Promise<Booted> {
  const rootDir = mkdtempSync(join(tmpdir(), 'write-door-nf-'));
  const stack = await bootStack(stackDefinition as never, {
    orgContext: inside,
    security: security(),
    extraPlugins: [
      new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
      new AuditPlugin(),
    ],
  });
  await stack.signIn();
  let token = await stack.signUp(email);
  const ql = await stack.kernel.getServiceAsync<any>('objectql');
  const adminId = (await ql.findOne('sys_user', { where: { email: 'admin@objectos.ai' }, context: SYS }))?.id;
  const userId = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
  for (const name of GRANTS) {
    const set = await ql.findOne('sys_permission_set', { where: { name }, context: SYS });
    expect(set?.id, `fixture permission set ${name} seeded`).toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: set.id }, { context: { ...SYS } });
  }
  if (!inside) token = await leaveOrganization(stack, email);
  return { stack, rootDir, ql, adminId, token };
}

async function uploadFile(stack: VerifyStack, token: string): Promise<string> {
  const auth = { Authorization: `Bearer ${token}` };
  const presign = await stack.api('/storage/upload/presigned', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ filename: 'mine.txt', mimeType: 'text/plain', size: 5, scope: 'attachments' }),
  });
  expect(presign.status, 'presign').toBe(200);
  const { data } = (await presign.json()) as any;
  const put = await stack.raw(String(data.uploadUrl).replace(/^https?:\/\/[^/]+/, ''), {
    method: 'PUT',
    headers: data.headers ?? { 'content-type': 'text/plain' },
    body: 'hello',
  });
  expect(put.status, 'raw PUT').toBeLessThan(300);
  const complete = await stack.api('/storage/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ fileId: data.fileId }),
  });
  expect(complete.status, 'complete').toBe(200);
  return String(data.fileId);
}

/** Rows the admin owns: one attachment and one comment on a parent only the admin reads, one of each on a parent everyone reads. */
async function seed(b: Booted) {
  const secret = await b.ql.insert('att_secret', { name: 'hidden parent', owner_id: b.adminId }, { context: { ...SYS } });
  const readonly = await b.ql.insert('att_readonly', { name: 'read-only parent', owner_id: b.adminId }, { context: { ...SYS } });
  const cmtSecret = await b.ql.insert('cmt_private', { name: 'hidden thread parent', owner_id: b.adminId }, { context: { ...SYS } });
  const cmtReadonly = await b.ql.insert('cmt_readonly', { name: 'read-only thread parent', owner_id: b.adminId }, { context: { ...SYS } });
  const attachment = (parentObject: string, parentId: string) =>
    b.ql.insert(
      'sys_attachment',
      {
        parent_object: parentObject,
        parent_id: parentId,
        file_id: `f_${parentId}`,
        file_name: 'a.txt',
        mime_type: 'text/plain',
        size: 1,
        uploaded_by: b.adminId,
      },
      { context: { ...SYS } },
    );
  const comment = (threadObject: string, parentId: string) =>
    b.ql.insert(
      'sys_comment',
      { thread_id: `${threadObject}:${parentId}`, body: 'the admin wrote this', author_id: b.adminId },
      { context: { ...SYS } },
    );
  return {
    sys_attachment: {
      hidden: String((await attachment('att_secret', secret.id)).id),
      readable: String((await attachment('att_readonly', readonly.id)).id),
    },
    sys_comment: {
      hidden: String((await comment('cmt_private', cmtSecret.id)).id),
      readable: String((await comment('cmt_readonly', cmtReadonly.id)).id),
    },
  };
}

/** The caller's own attachment and comment, created through the door on parents it may edit. */
async function seedOwn(b: Booted): Promise<{ sys_attachment: string; sys_comment: string }> {
  const caseRow = await b.ql.insert('att_case', { name: 'open parent' }, { context: { ...SYS } });
  const fileId = await uploadFile(b.stack, b.token);
  const att = await b.stack.apiAs(b.token, 'POST', '/data/sys_attachment', {
    parent_object: 'att_case',
    parent_id: caseRow.id,
    file_id: fileId,
    file_name: 'mine.txt',
    mime_type: 'text/plain',
    size: 5,
  });
  expect(att.status, `own attachment: ${await att.clone().text()}`).toBeLessThan(300);
  const openRow = await b.ql.insert('cmt_open', { name: 'open thread parent' }, { context: { ...SYS } });
  const cmt = await b.stack.apiAs(b.token, 'POST', '/data/sys_comment', { thread_id: `cmt_open:${openRow.id}`, body: 'mine' });
  expect(cmt.status, `own comment: ${await cmt.clone().text()}`).toBeLessThan(300);
  const attId = (await b.ql.findOne('sys_attachment', { where: { file_id: fileId }, context: SYS }))?.id;
  const cmtId = (await b.ql.findOne('sys_comment', { where: { thread_id: `cmt_open:${openRow.id}` }, context: SYS }))?.id;
  return { sys_attachment: String(attId), sys_comment: String(cmtId) };
}

/** Status plus parsed body, the caller-supplied id written out of it. */
async function answerOf(res: Response, id: string): Promise<{ status: number; body: any; text: string }> {
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text.split(id).join('ID'));
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

type Rows = Awaited<ReturnType<typeof seed>>;
type Own = Awaited<ReturnType<typeof seedOwn>>;

const OBJECTS = [
  {
    object: 'sys_attachment' as const,
    patch: { description: 'rewritten' },
    readerCode: {
      outside: { DELETE: 'ATTACHMENT_DELETE_DENIED', PATCH: 'RECORD_NOT_ACCESSIBLE' },
      inside: { DELETE: 'ATTACHMENT_DELETE_DENIED', PATCH: 'PERMISSION_DENIED' },
    },
  },
  {
    object: 'sys_comment' as const,
    patch: { body: 'rewritten' },
    readerCode: {
      outside: { DELETE: 'RECORD_NOT_ACCESSIBLE', PATCH: 'RECORD_NOT_ACCESSIBLE' },
      inside: { DELETE: 'RECORD_NOT_ACCESSIBLE', PATCH: 'PERMISSION_DENIED' },
    },
  },
];
const VERBS = ['DELETE', 'PATCH'] as const;

describe('write door: a row the caller cannot read answers what a missing id answers', () => {
  const classes: Record<'outside' | 'inside', { b?: Booted; rows?: Rows; own?: Own }> = { outside: {}, inside: {} };

  beforeAll(async () => {
    classes.outside.b = await boot(false, 'nf-outside@verify.test');
    classes.inside.b = await boot(true, 'nf-inside@verify.test');
    const outside = classes.outside.b;
    const inside = classes.inside.b;

    await assertArmed([
      armedWhen({
        control: "a principal OUTSIDE the ownership floor's domain — no write-class row filter binds it",
        disarmedBy: 'a principal still bound to the organization: it then holds org_member and the two classes collapse into one',
        observe: () => resolveAuthzFor(outside.stack, outside.token),
        armed: (ctx) => !ctx.positions.includes('org_member') && GRANTS.every((g) => ctx.permissions.includes(g)),
        describe: (ctx) => `positions=${JSON.stringify(ctx.positions)} permissions=${JSON.stringify(ctx.permissions)}`,
      }),
      principalArmed({
        stack: inside.stack,
        token: inside.token,
        who: 'the org_member',
        positions: ['org_member'],
        permissions: GRANTS,
        control: "a principal INSIDE the ownership floor's domain — the write-class row filter binds it",
        disarmedBy: 'a principal outside the organization in this half: no org_member, and the inside class measures the outside one twice',
      }),
    ]);

    for (const k of ['outside', 'inside'] as const) {
      classes[k].rows = await seed(classes[k].b!);
      classes[k].own = await seedOwn(classes[k].b!);
    }
  }, 240_000);

  afterAll(async () => {
    for (const k of ['outside', 'inside'] as const) {
      const b = classes[k].b;
      await b?.stack?.stop();
      if (b?.rootDir) await fs.rm(b.rootDir, { recursive: true, force: true });
    }
  });

  for (const who of ['outside', 'inside'] as const) {
    for (const o of OBJECTS) {
      for (const verb of VERBS) {
        it(`${who} · ${o.object} · ${verb}: the hidden row's whole answer equals the missing id's`, async () => {
          const { b, rows } = classes[who] as { b: Booted; rows: Rows };
          const hiddenId = rows[o.object].hidden;
          const missingId = `nf_missing_${who}_${verb}`;
          const payload = verb === 'PATCH' ? o.patch : undefined;

          // The precondition, read off the read door: the caller does not see it.
          expect((await b.stack.apiAs(b.token, 'GET', `/data/${o.object}/${hiddenId}`)).status).toBe(404);

          const hidden = await answerOf(await b.stack.apiAs(b.token, verb, `/data/${o.object}/${hiddenId}`, payload), hiddenId);
          const missing = await answerOf(await b.stack.apiAs(b.token, verb, `/data/${o.object}/${missingId}`, payload), missingId);

          expect(missing.status, missing.text).toBe(404);
          expect(missing.body.code).toBe('RECORD_NOT_FOUND');
          expect({ status: hidden.status, body: hidden.body }, hidden.text).toEqual({ status: missing.status, body: missing.body });

          // Refused means untouched.
          const after = await b.ql.findOne(o.object, { where: { id: hiddenId }, context: SYS });
          expect(after, 'the refused write left the row in place').toBeTruthy();
          if (verb === 'PATCH') for (const [k, v] of Object.entries(o.patch)) expect(after[k]).not.toBe(v);
        });

        it(`${who} · ${o.object} · ${verb}: a reader who may not write still gets 403`, async () => {
          const { b, rows } = classes[who] as { b: Booted; rows: Rows };
          const id = rows[o.object].readable;
          expect((await b.stack.apiAs(b.token, 'GET', `/data/${o.object}/${id}`)).status).toBe(200);

          const got = await answerOf(
            await b.stack.apiAs(b.token, verb, `/data/${o.object}/${id}`, verb === 'PATCH' ? o.patch : undefined),
            id,
          );
          expect(got.status, got.text).toBe(403);
          expect(got.body.code).toBe(o.readerCode[who][verb]);
          if (got.body.code === 'PERMISSION_DENIED') expect(got.body.error).toBe(RECORD_SENTENCE);
          expect(await b.ql.findOne(o.object, { where: { id }, context: SYS })).toBeTruthy();
        });
      }

      it(`${who} · ${o.object}: a row the caller reads and may write is still written, then deleted`, async () => {
        const { b, own } = classes[who] as { b: Booted; own: Own };
        const id = own[o.object];
        const patched = await b.stack.apiAs(b.token, 'PATCH', `/data/${o.object}/${id}`, o.patch);
        expect(patched.status, await patched.clone().text()).toBeLessThan(300);
        const after = await b.ql.findOne(o.object, { where: { id }, context: SYS });
        for (const [k, v] of Object.entries(o.patch)) expect(after[k]).toBe(v);
        const deleted = await b.stack.apiAs(b.token, 'DELETE', `/data/${o.object}/${id}`);
        expect(deleted.status, await deleted.clone().text()).toBeLessThan(300);
        expect(await b.ql.findOne(o.object, { where: { id }, context: SYS })).toBeFalsy();
      });
    }
  }
});
