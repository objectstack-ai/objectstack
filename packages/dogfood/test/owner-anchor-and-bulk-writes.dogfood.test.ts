// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3004 + #2982 — the two write-path holes on the ownership anchor, proven on
// the REAL showcase app end-to-end:
//
//  • #3004 `owner_id` forge/transfer: the anchor is SYSTEM-MANAGED for
//    non-privileged writers. A plain member can neither plant a record under
//    someone else's name (insert forge) nor move a record to another owner
//    (update transfer / disown) — that requires the transfer grant
//    (`allowTransfer`, or `modifyAllRecords` which implies it). The unchanged
//    no-op echo of a form save stays tolerated.
//
//  • #2982 bulk (multi) writes: `update({multi:true})` / bulk delete used to
//    rebuild the driver AST from `options.where` AFTER the middleware chain,
//    so the owner scoping that binds single-id writes never reached bulk
//    writes — a member's bulk write hit every matching row, including peers'.
//    Now the engine seeds `opCtx.ast` before the chain and hands the
//    middleware-composed predicate to the driver, so bulk writes are scoped
//    to rows the caller may edit.
//
// @proof: owner-anchor-and-bulk-writes

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { resolveAuthzContext } from '@objectstack/core';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';

const OBJ = '/data/showcase_private_note';
const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id ?? b?.recordId;

// The everyone-anchor baseline deliberately carries NO `allowDelete` (an
// anchor-forbidden bit, ADR-0090 D5) — so the bulk-DELETE proof needs a
// position-style grant bound DIRECTLY to the two members. Deliberately NOT
// `isDefault`: it must never reach the anchor.
const noteDeleteSet = PermissionSetSchema.parse({
  name: 'anchor_note_delete',
  label: 'Anchor proof — note delete',
  objects: {
    showcase_private_note: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
});

describe('owner anchor guard + owner-scoped bulk writes (#3004 / #2982)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let aliceToken: string;
  let bobToken: string;
  let aliceId: string;
  let bobId: string;
  let aliceNoteId: string;
  let bobNoteId: string;

  /** Resolve the SAME authz context the REST entry point would — real
   *  positions/permissions from the live tables, no hand-built principal. */
  const authzFor = async (token: string) => {
    const authService: any = await stack.kernel.getServiceAsync('auth');
    let api: any = authService?.api;
    if (!api && typeof authService?.getApi === 'function') api = await authService.getApi();
    const headers = new Headers({ authorization: `Bearer ${token}` });
    return resolveAuthzContext({
      ql,
      headers,
      getSession: async (h: any) => api?.getSession?.({ headers: h }),
    });
  };

  const ownerOf = async (noteId: string) =>
    (await ql.findOne('showcase_private_note', { where: { id: noteId }, context: { isSystem: true } }))?.owner_id;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, noteDeleteSet],
      }),
    });
    adminToken = await stack.signIn(); // seed dev admin (platform admin)
    aliceToken = await stack.signUp('anchor-alice@verify.test');
    bobToken = await stack.signUp('anchor-bob@verify.test');

    ql = await stack.kernel.getServiceAsync('objectql');
    const uid = async (email: string) =>
      (await ql.findOne('sys_user', { where: { email }, context: { isSystem: true } }))?.id;
    aliceId = await uid('anchor-alice@verify.test');
    bobId = await uid('anchor-bob@verify.test');
    expect(aliceId).toBeTruthy();
    expect(bobId).toBeTruthy();

    // Direct per-user grant of the delete set (never anchor-bound).
    const SYS = { isSystem: true } as const;
    const delSet = await ql.findOne('sys_permission_set', { where: { name: 'anchor_note_delete' }, context: SYS });
    expect(delSet?.id, 'declared delete set seeded').toBeTruthy();
    for (const userId of [aliceId, bobId]) {
      await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: delSet.id }, { context: { ...SYS } });
    }

    const a = await stack.apiAs(aliceToken, 'POST', OBJ, { title: 'alice note', body: 'a' });
    expect(a.status, 'alice creates her note').toBeLessThan(300);
    aliceNoteId = idOf(await a.json());
    const b = await stack.apiAs(bobToken, 'POST', OBJ, { title: 'bob note', body: 'b' });
    expect(b.status, 'bob creates his note').toBeLessThan(300);
    bobNoteId = idOf(await b.json());
  }, 120_000);

  afterAll(async () => { await stack?.stop(); });

  // ── #3004 — forge on insert ────────────────────────────────────────────────

  it('a member cannot INSERT a record owned by someone else (forge)', async () => {
    const r = await stack.apiAs(aliceToken, 'POST', OBJ, { title: 'planted', owner_id: bobId });
    expect(r.status, 'forged-owner insert must be denied').toBeGreaterThanOrEqual(400);
    const planted = await ql.findOne('showcase_private_note', { where: { title: 'planted' }, context: { isSystem: true } });
    expect(planted, 'no forged row may exist').toBeFalsy();
  });

  it('a member may still INSERT with owner_id = self (explicit self-owner)', async () => {
    const r = await stack.apiAs(aliceToken, 'POST', OBJ, { title: 'self-owned', owner_id: aliceId });
    expect(r.status).toBeLessThan(300);
    expect(await ownerOf(idOf(await r.json()))).toBe(aliceId);
  });

  // ── #3004 — transfer / disown on update ────────────────────────────────────

  it('a member cannot TRANSFER their own record to another user', async () => {
    const r = await stack.apiAs(aliceToken, 'PATCH', `${OBJ}/${aliceNoteId}`, { owner_id: bobId });
    expect(r.status, 'ownership transfer without the grant must be denied').toBeGreaterThanOrEqual(400);
    expect(await ownerOf(aliceNoteId), 'owner must be unchanged').toBe(aliceId);
  });

  it('a member cannot DISOWN their record (owner_id: null)', async () => {
    const r = await stack.apiAs(aliceToken, 'PATCH', `${OBJ}/${aliceNoteId}`, { owner_id: null });
    expect(r.status, 'disowning must be denied').toBeGreaterThanOrEqual(400);
    expect(await ownerOf(aliceNoteId)).toBe(aliceId);
  });

  it('the unchanged no-op echo of a form save is tolerated', async () => {
    const r = await stack.apiAs(aliceToken, 'PATCH', `${OBJ}/${aliceNoteId}`, { body: 'edited', owner_id: aliceId });
    expect(r.status, 'echoing the current owner back must not 403').toBeLessThan(300);
    expect(await ownerOf(aliceNoteId)).toBe(aliceId);
  });

  it('a privileged caller (modifyAllRecords ⇒ transfer) CAN reassign ownership', async () => {
    const r = await stack.apiAs(adminToken, 'PATCH', `${OBJ}/${bobNoteId}`, { owner_id: aliceId });
    expect(r.status, 'platform admin transfer must pass').toBeLessThan(300);
    expect(await ownerOf(bobNoteId)).toBe(aliceId);
    // hand it back for the bulk proofs below
    const back = await stack.apiAs(adminToken, 'PATCH', `${OBJ}/${bobNoteId}`, { owner_id: bobId });
    expect(back.status).toBeLessThan(300);
  });

  // ── #3004 × #2982 — bulk change-set carrying owner_id fails closed ─────────

  it('a bulk update whose change-set carries owner_id fails closed for a member', async () => {
    const bobCtx = await authzFor(bobToken);
    await expect(
      ql.update('showcase_private_note', { owner_id: bobId }, { where: {}, multi: true, context: bobCtx }),
    ).rejects.toThrow(/owner_id/);
    expect(await ownerOf(aliceNoteId), 'no ownership moved').toBe(aliceId);
  });

  // ── #2982 — bulk writes are owner-scoped (engine surface: flows/tools) ─────

  it('a member bulk UPDATE only touches their own rows, never a peer’s', async () => {
    const bobCtx = await authzFor(bobToken);
    await ql.update('showcase_private_note', { body: 'bulk-rewrite' }, { where: {}, multi: true, context: bobCtx });

    const aliceRow = await ql.findOne('showcase_private_note', { where: { id: aliceNoteId }, context: { isSystem: true } });
    const bobRow = await ql.findOne('showcase_private_note', { where: { id: bobNoteId }, context: { isSystem: true } });
    expect(bobRow?.body, 'bob’s own row is updated').toBe('bulk-rewrite');
    expect(aliceRow?.body, 'alice’s row must be untouched by bob’s bulk write').not.toBe('bulk-rewrite');
  });

  it('a member bulk DELETE only removes their own rows, never a peer’s', async () => {
    const bobCtx = await authzFor(bobToken);
    await ql.delete('showcase_private_note', { where: {}, multi: true, context: bobCtx });

    const aliceRow = await ql.findOne('showcase_private_note', { where: { id: aliceNoteId }, context: { isSystem: true } });
    const bobRow = await ql.findOne('showcase_private_note', { where: { id: bobNoteId }, context: { isSystem: true } });
    expect(aliceRow, 'alice’s row survives bob’s bulk delete').toBeTruthy();
    expect(bobRow, 'bob’s own row is deleted').toBeFalsy();
  });
});
