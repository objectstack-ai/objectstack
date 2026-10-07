// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// On the write doors, a row the caller cannot READ is a row that does not
// exist — on the PREDICATE door too: a predicate-scoped update or delete
// matches only the rows the read door would return to its caller.
//
// Measured on a real stack at the engine's predicate door — the surface flow
// data nodes and action bodies reach, under the context the REST door resolves
// for the caller's own bearer token (`resolveAuthzContext`) — on the two
// parent-derived join objects (`sys_attachment`, `sys_comment`, whose read
// visibility a data middleware derives from the row's parent record) and on
// one plain row-level-security object whose write-class policies reach rows its
// read policy hides.
//
// ── what is pinned, per principal class ───────────────────────────────────
//
// Two classes: a session OUTSIDE the ownership floor's `org_member` domain and
// an `org_member` INSIDE it. For each, on update and delete, on each object:
//
//   1. ⭐ a predicate matching only rows the caller cannot read answers
//      EXACTLY what a predicate matching nothing answers: success, zero rows,
//      nothing written;
//   2. a predicate matching a hidden row and a row the caller reads and may
//      write changes only the latter, and the affected count is one;
//   3. a caller who can read a matched row but may not write it keeps the
//      answer it had: the parent-derived gate's refusal where the write scope
//      reaches the row, zero rows where the write scope already excludes it;
//   4. the by-id doors keep their answers: the hidden row's by-id write still
//      answers the read door's not-found.
//
// ── the arming is the pin ─────────────────────────────────────────────────
//
// Each boot proves its principal's domain before anything is measured: outside
// must NOT hold `org_member`, inside MUST, and both hold the grants, or every
// cell measures an RBAC refusal instead. Each hidden row is proved hidden off
// the read door before it is written at.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { resolveAuthzContext } from '@objectstack/core';
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
import { armedWhen, assertArmed, principalArmed, resolveAuthzFor } from './armed.js';

const SYS = { isSystem: true } as const;

/** The plain row-level-security object: reads reach own or shared rows, writes reach own rows or one team's. */
const PwLedger = ObjectSchema.create({
  name: 'pw_ledger',
  label: 'Predicate Write Ledger',
  pluralLabel: 'Predicate Write Ledgers',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    owner: Field.text({ label: 'Owner' }),
    team: Field.text({ label: 'Team' }),
    shared: Field.boolean({ label: 'Shared' }),
  },
});

const ledgerMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: 'pw_ledger_member',
  label: 'Predicate write fixture — ledger member',
  objects: { pw_ledger: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  rowLevelSecurity: [
    { name: 'pw_ledger_read', object: 'pw_ledger', operation: 'select', using: 'record.owner == current_user.id || record.shared == true' },
    { name: 'pw_ledger_update', object: 'pw_ledger', operation: 'update', using: "record.owner == current_user.id || record.team == 'ops'" },
    { name: 'pw_ledger_delete', object: 'pw_ledger', operation: 'delete', using: "record.owner == current_user.id || record.team == 'ops'" },
  ],
});

const stackDefinition = defineStack({
  manifest: {
    id: 'com.dogfood.predicate-write-unreadable-not-matched',
    version: '0.0.0',
    type: 'app',
    name: 'Predicate write: an unreadable row is not matched',
    description:
      'Open, private and read-only parents for sys_attachment and sys_comment, and a row-level-security ledger: the predicate write answer for rows the caller cannot read, beside the answer for a predicate matching nothing.',
  },
  objects: [AttCase, AttSecret, AttReadonly, CmtOpen, CmtPrivate, CmtReadonly, PwLedger],
});

function security(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [
      ...securityDefaultPermissionSets,
      attFixtureBaselineSet,
      attachmentManagerSet,
      commentManagerSet,
      ledgerMemberSet,
    ],
    fallbackPermissionSet: attFixtureBaselineSet.name,
  });
}

const GRANTS = [attachmentManagerSet.name, commentManagerSet.name, ledgerMemberSet.name];

interface Booted {
  stack: VerifyStack;
  rootDir: string;
  ql: any;
  adminId: string;
  userId: string;
  token: string;
}

async function boot(orgContext: boolean, email: string): Promise<Booted> {
  const rootDir = mkdtempSync(join(tmpdir(), 'predicate-write-nm-'));
  const stack = await bootStack(stackDefinition as never, {
    orgContext,
    security: security(),
    extraPlugins: [
      new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
      new AuditPlugin(),
    ],
  });
  await stack.signIn();
  const token = await stack.signUp(email);
  const ql = await stack.kernel.getServiceAsync<any>('objectql');
  const adminId = (await ql.findOne('sys_user', { where: { email: 'admin@objectos.ai' }, context: SYS }))?.id;
  const userId = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
  for (const name of GRANTS) {
    const set = await ql.findOne('sys_permission_set', { where: { name }, context: SYS });
    expect(set?.id, `fixture permission set ${name} seeded`).toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: set.id }, { context: { ...SYS } });
  }
  return { stack, rootDir, ql, adminId, userId, token };
}

type CallerContext = Awaited<ReturnType<typeof resolveAuthzContext>>;

/** The context the REST door resolves for this caller's bearer token. */
async function callerContext(b: Booted): Promise<CallerContext> {
  const authService: any = await b.stack.kernel.getServiceAsync('auth');
  let api: any = authService?.api;
  if (!api && typeof authService?.getApi === 'function') api = await authService.getApi();
  const headers = new Headers({ authorization: `Bearer ${b.token}` });
  return resolveAuthzContext({
    ql: b.ql,
    headers,
    getSession: async (h: any) => api?.getSession?.({ headers: h }),
  });
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

type ObjectName = 'sys_attachment' | 'sys_comment' | 'pw_ledger';

/** Rows the admin owns: one the caller cannot read, one it reads and may not write. */
async function seedForeign(b: Booted): Promise<Record<ObjectName, { hidden: string; readable: string }>> {
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
  const ledger = (name: string, team: string, shared: boolean) =>
    b.ql.insert('pw_ledger', { name, owner: b.adminId, team, shared }, { context: { ...SYS } });
  return {
    sys_attachment: {
      hidden: String((await attachment('att_secret', secret.id)).id),
      readable: String((await attachment('att_readonly', readonly.id)).id),
    },
    sys_comment: {
      hidden: String((await comment('cmt_private', cmtSecret.id)).id),
      readable: String((await comment('cmt_readonly', cmtReadonly.id)).id),
    },
    pw_ledger: {
      // The write-class policy reaches it (its team); the read policy does not.
      hidden: String((await ledger('hidden, ops team', 'ops', false)).id),
      // The read policy reaches it (shared); the write-class policy does not.
      readable: String((await ledger('shared, other team', 'x', true)).id),
    },
  };
}

/** One row per object the caller creates through the REST door, on a parent it may edit. */
async function seedOwn(b: Booted, tag: string): Promise<Record<ObjectName, string>> {
  const caseRow = await b.ql.insert('att_case', { name: `open parent ${tag}` }, { context: { ...SYS } });
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
  const openRow = await b.ql.insert('cmt_open', { name: `open thread parent ${tag}` }, { context: { ...SYS } });
  const cmt = await b.stack.apiAs(b.token, 'POST', '/data/sys_comment', { thread_id: `cmt_open:${openRow.id}`, body: 'mine' });
  expect(cmt.status, `own comment: ${await cmt.clone().text()}`).toBeLessThan(300);
  const led = await b.stack.apiAs(b.token, 'POST', '/data/pw_ledger', { name: `mine ${tag}`, owner: b.userId, team: 'x', shared: false });
  expect(led.status, `own ledger row: ${await led.clone().text()}`).toBeLessThan(300);
  const attId = (await b.ql.findOne('sys_attachment', { where: { file_id: fileId }, context: SYS }))?.id;
  const cmtId = (await b.ql.findOne('sys_comment', { where: { thread_id: `cmt_open:${openRow.id}` }, context: SYS }))?.id;
  const ledId = (await b.ql.findOne('pw_ledger', { where: { name: `mine ${tag}` }, context: SYS }))?.id;
  return { sys_attachment: String(attId), sys_comment: String(cmtId), pw_ledger: String(ledId) };
}

type Outcome = { kind: 'landed'; result: unknown } | { kind: 'refused'; code?: string; status?: number; message: string };

function outcome(p: Promise<unknown>): Promise<Outcome> {
  return p.then(
    (result) => ({ kind: 'landed' as const, result }),
    (e: any) => ({ kind: 'refused' as const, code: e?.code, status: e?.statusCode ?? e?.status, message: String(e?.message) }),
  );
}

/** Copied at every call: the engine stamps its own columns onto the payload it is handed. */
const PATCH: Readonly<Record<ObjectName, Readonly<Record<string, unknown>>>> = {
  sys_attachment: { description: 'swept' },
  sys_comment: { body: 'swept' },
  pw_ledger: { name: 'swept' },
};

/**
 * A reader who may not write a matched row keeps the answer it had. Which
 * answer that is depends on whether the write scope reaches the row. Inside
 * the `org_member` domain the platform's ownership floor binds updates to rows
 * the caller created, so the row is not matched at all; on delete the
 * parent-derived kits' row reaches their per-row gate, which refuses it by
 * name. Outside the domain the kit's gate refuses on both verbs. The ledger's
 * write-class policy does not reach its readable row in either class.
 */
const READER_ANSWER: Record<'outside' | 'inside', Record<ObjectName, Record<'update' | 'delete', unknown>>> = {
  outside: {
    sys_attachment: {
      update: { kind: 'refused', code: 'RECORD_NOT_ACCESSIBLE', status: 403 },
      delete: { kind: 'refused', code: 'ATTACHMENT_DELETE_DENIED', status: 403 },
    },
    sys_comment: {
      update: { kind: 'refused', code: 'RECORD_NOT_ACCESSIBLE', status: 403 },
      delete: { kind: 'refused', code: 'RECORD_NOT_ACCESSIBLE', status: 403 },
    },
    pw_ledger: { update: { kind: 'landed', result: 0 }, delete: { kind: 'landed', result: 0 } },
  },
  inside: {
    sys_attachment: {
      update: { kind: 'landed', result: 0 },
      delete: { kind: 'refused', code: 'ATTACHMENT_DELETE_DENIED', status: 403 },
    },
    sys_comment: {
      update: { kind: 'landed', result: 0 },
      delete: { kind: 'refused', code: 'RECORD_NOT_ACCESSIBLE', status: 403 },
    },
    pw_ledger: { update: { kind: 'landed', result: 0 }, delete: { kind: 'landed', result: 0 } },
  },
};

const OBJECTS: ObjectName[] = ['sys_attachment', 'sys_comment', 'pw_ledger'];
const VERBS = ['update', 'delete'] as const;

describe('predicate write door: a row the caller cannot read is not matched', () => {
  const classes: Record<'outside' | 'inside', { b?: Booted; ctx?: CallerContext; foreign?: Awaited<ReturnType<typeof seedForeign>> }> = {
    outside: {},
    inside: {},
  };

  beforeAll(async () => {
    classes.outside.b = await boot(false, 'pw-outside@verify.test');
    classes.inside.b = await boot(true, 'pw-inside@verify.test');
    const outside = classes.outside.b;
    const inside = classes.inside.b;

    await assertArmed([
      armedWhen({
        control: "a principal OUTSIDE the ownership floor's domain — no write-class row filter of the platform binds it",
        disarmedBy: 'an org-bound boot of this half: the principal then holds org_member and the two classes collapse into one',
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
        control: "a principal INSIDE the ownership floor's domain — the platform's write-class row filter binds it",
        disarmedBy: 'an org-less boot of this half: no org_member, and the inside class measures the outside one twice',
      }),
    ]);

    for (const k of ['outside', 'inside'] as const) {
      classes[k].foreign = await seedForeign(classes[k].b!);
      classes[k].ctx = await callerContext(classes[k].b!);
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
    for (const object of OBJECTS) {
      for (const verb of VERBS) {
        it(`${who} · ${object} · ${verb}: hidden rows are not matched; visible rows are; readers keep their answer`, async () => {
          const { b, ctx, foreign } = classes[who] as { b: Booted; ctx: CallerContext; foreign: Awaited<ReturnType<typeof seedForeign>> };
          const own = (await seedOwn(b, `${who}-${object}-${verb}`))[object];
          const { hidden, readable } = foreign[object];
          const write = (ids: string[]) =>
            outcome(
              verb === 'update'
                ? b.ql.update(object, { ...PATCH[object] }, { where: { id: { $in: ids } }, multi: true, context: { ...ctx } })
                : b.ql.delete(object, { where: { id: { $in: ids } }, multi: true, context: { ...ctx } }),
            );
          const stored = (id: string) => b.ql.findOne(object, { where: { id }, context: SYS });
          const untouched = async (id: string) => {
            const row = await stored(id);
            expect(row, `${id} is still there`).toBeTruthy();
            for (const [k, v] of Object.entries(PATCH[object])) expect(row[k]).not.toBe(v);
          };

          // The preconditions, read off the read door.
          expect(await b.ql.find(object, { where: { id: { $in: [hidden] } }, context: { ...ctx } }), 'the hidden row is hidden').toEqual([]);
          expect(await b.ql.findOne(object, { where: { id: readable }, context: { ...ctx } }), 'the readable row is readable').toBeTruthy();
          expect(await b.ql.findOne(object, { where: { id: own }, context: { ...ctx } }), 'the own row is readable').toBeTruthy();

          // 1. ⭐ Only hidden rows matched ≡ nothing matched.
          const onlyHidden = await write([hidden]);
          const nothing = await write([`pw_missing_${who}_${object}_${verb}`]);
          expect(nothing, JSON.stringify(nothing)).toEqual({ kind: 'landed', result: 0 });
          expect(onlyHidden, JSON.stringify(onlyHidden)).toEqual(nothing);
          await untouched(hidden);

          // 3. A reader who may not write keeps the answer it had.
          const reader = await write([readable]);
          expect(reader, JSON.stringify(reader)).toMatchObject(READER_ANSWER[who][object][verb] as object);
          await untouched(readable);

          // 2. Hidden + visible: only the visible row changes, and it alone is counted.
          const mixed = await write([hidden, own]);
          expect(mixed, JSON.stringify(mixed)).toEqual({ kind: 'landed', result: 1 });
          await untouched(hidden);
          const after = await stored(own);
          if (verb === 'update') for (const [k, v] of Object.entries(PATCH[object])) expect(after?.[k]).toBe(v);
          else expect(after, 'the own row is deleted').toBeFalsy();

          // 4. The by-id door keeps its answer: the hidden row is a missing row.
          const byId = await outcome(
            verb === 'update'
              ? b.ql.update(object, { ...PATCH[object] }, { where: { id: hidden }, context: { ...ctx } })
              : b.ql.delete(object, { where: { id: hidden }, context: { ...ctx } }),
          );
          expect(byId, JSON.stringify(byId)).toMatchObject({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
          await untouched(hidden);
        });
      }
    }
  }
});
