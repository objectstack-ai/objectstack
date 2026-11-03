// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user_preference` over REST on the real showcase stack: a preference's
 * owner (`user_id`) is fixed when it is saved. The rule is plugin-auth's
 * (`user-preference-hooks.ts`, on the shared `owner-fixed-rule.ts`, whose
 * engine-level pins live beside it); this file is the HTTP face a console
 * reader actually reaches, with the real composition, the real authorization
 * resolver and the real error mapping:
 *
 *  - `[member]` an organization member cannot hand their own preference to
 *    another member: `403 PERMISSION_DENIED`, the row keeps its owner and the
 *    other member lists nothing new;
 *  - `[org-admin]` / `[platform-admin]` an administrator cannot hand their own
 *    preference to another user either, and a member's preference is not
 *    theirs to reach by id (`404`, the object's own-row scope);
 *  - `[member-create]` a member cannot create a preference in another member's
 *    name: the object's row scope refuses the create, before any hook, and
 *    nothing is stored;
 *  - `[control]` an update that echoes the stored owner saves, and the owner
 *    reads, lists and updates their own preferences as before.
 *
 * Refusals assert `code` AND `status` (ADR-0112).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const OBJ = 'sys_user_preference';
const SYS = { isSystem: true } as const;

const ALICE = 'pref.alice@verify.test';
const BOB = 'pref.bob@verify.test';
const CAROL = 'pref.carol.orgadmin@verify.test';

const recordOf = (b: any) => b?.record ?? b?.data ?? b;
const rowsOf = (b: any) => b?.records ?? b?.data ?? (Array.isArray(b) ? b : []);
const errorCodeOf = (b: any) => b?.error?.code ?? b?.code;

describe('sys_user_preference over REST: a preference\'s owner is fixed when it is saved', () => {
  let stack: VerifyStack;
  let ql: any;
  let aliceTok: string;
  let bobTok: string;
  let carolTok: string;
  let adminTok: string;
  let aliceId: string;
  let bobId: string;
  let carolId: string;
  let adminId: string;

  const userIdOf = async (email: string): Promise<string> => {
    const id = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
    expect(id, `${email} provisioned`).toBeTruthy();
    return String(id);
  };

  /** Save a preference as `token`'s owner and return the created row. */
  const save = async (token: string, ownerId: string, key: string) => {
    const r = await stack.apiAs(token, 'POST', `/data/${OBJ}`, { user_id: ownerId, key, value: ['first'] });
    expect(r.status, await r.clone().text()).toBe(201);
    const row = recordOf(await r.json());
    expect(row?.id).toBeTruthy();
    return row;
  };
  const storedOwner = async (id: string) => (await ql.findOne(OBJ, { where: { id }, context: SYS }))?.user_id;

  beforeAll(async () => {
    stack = await bootShowcase({ security: showcaseAppDefaultSecurity() });
    adminTok = await stack.signIn();
    aliceTok = await stack.signUp(ALICE);
    bobTok = await stack.signUp(BOB);
    carolTok = await stack.signUp(CAROL);
    ql = await stack.kernel.getServiceAsync('objectql');
    aliceId = await userIdOf(ALICE);
    bobId = await userIdOf(BOB);
    carolId = await userIdOf(CAROL);
    adminId = await userIdOf('admin@objectos.ai');
    // CAROL holds the organization administrator's set, granted the way an
    // administrator's grant is stored.
    await ql.insert('sys_user_permission_set', { user_id: carolId, permission_set: 'organization_admin' }, { context: SYS });
  }, 180_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('[member] cannot hand their own preference to another member: 403, the row keeps its owner', async () => {
    const row = await save(aliceTok, aliceId, 'ui.owner_fixed.member');
    const r = await stack.apiAs(aliceTok, 'PATCH', `/data/${OBJ}/${row.id}`, { user_id: bobId });
    expect(r.status, await r.clone().text()).toBe(403);
    expect(errorCodeOf(await r.json())).toBe('PERMISSION_DENIED');
    expect(await storedOwner(row.id)).toBe(aliceId);

    const bobs = await stack.apiAs(bobTok, 'GET', `/data/${OBJ}`);
    expect(bobs.status).toBe(200);
    expect(rowsOf(await bobs.json()).map((p: any) => p.id)).not.toContain(row.id);
  });

  it('[org-admin] cannot hand their own preference to another user: 403, the row keeps its owner', async () => {
    const row = await save(carolTok, carolId, 'ui.owner_fixed.org_admin');
    const r = await stack.apiAs(carolTok, 'PATCH', `/data/${OBJ}/${row.id}`, { user_id: bobId });
    expect(r.status, await r.clone().text()).toBe(403);
    expect(errorCodeOf(await r.json())).toBe('PERMISSION_DENIED');
    expect(await storedOwner(row.id)).toBe(carolId);
  });

  it('[platform-admin] cannot hand their own preference to another user: 403, the row keeps its owner', async () => {
    const row = await save(adminTok, adminId, 'ui.owner_fixed.platform_admin');
    const r = await stack.apiAs(adminTok, 'PATCH', `/data/${OBJ}/${row.id}`, { user_id: bobId });
    expect(r.status, await r.clone().text()).toBe(403);
    expect(errorCodeOf(await r.json())).toBe('PERMISSION_DENIED');
    expect(await storedOwner(row.id)).toBe(adminId);
  });

  it.each([
    ['[org-admin]', () => carolTok],
    ['[platform-admin]', () => adminTok],
  ])('%s does not reach a member\'s preference by id: 404, the row keeps its owner', async (_who, tok) => {
    const row = await save(aliceTok, aliceId, `ui.owner_fixed.reach.${_who.replace(/\W/g, '')}`);
    const r = await stack.apiAs(tok(), 'PATCH', `/data/${OBJ}/${row.id}`, { user_id: bobId });
    expect(r.status, await r.clone().text()).toBe(404);
    expect(errorCodeOf(await r.json())).toBe('RECORD_NOT_FOUND');
    expect(await storedOwner(row.id)).toBe(aliceId);
  });

  it('[member-create] cannot create a preference in another member\'s name: 403, nothing stored', async () => {
    const key = 'ui.owner_fixed.planted';
    const r = await stack.apiAs(bobTok, 'POST', `/data/${OBJ}`, { user_id: aliceId, key, value: ['planted'] });
    expect(r.status, await r.clone().text()).toBe(403);
    expect(errorCodeOf(await r.json())).toBe('PERMISSION_DENIED');
    expect(await ql.findOne(OBJ, { where: { key }, context: SYS })).toBeFalsy();
  });

  it('[control] an update that echoes the stored owner saves', async () => {
    const row = await save(aliceTok, aliceId, 'ui.owner_fixed.echo');
    const r = await stack.apiAs(aliceTok, 'PATCH', `/data/${OBJ}/${row.id}`, { user_id: aliceId, value: ['second'] });
    expect(r.status, await r.clone().text()).toBe(200);
    const stored = await ql.findOne(OBJ, { where: { id: row.id }, context: SYS });
    expect({ user_id: stored?.user_id, value: stored?.value }).toEqual({ user_id: aliceId, value: ['second'] });
  });

  it('[control] the owner reads, lists and updates their own preference', async () => {
    const row = await save(aliceTok, aliceId, 'ui.owner_fixed.own');
    const patch = await stack.apiAs(aliceTok, 'PATCH', `/data/${OBJ}/${row.id}`, { value: ['third'] });
    expect(patch.status, await patch.clone().text()).toBe(200);
    const read = await stack.apiAs(aliceTok, 'GET', `/data/${OBJ}/${row.id}`);
    expect(read.status).toBe(200);
    expect(recordOf(await read.json())?.value).toEqual(['third']);
    const list = await stack.apiAs(aliceTok, 'GET', `/data/${OBJ}`);
    expect(rowsOf(await list.json()).map((p: any) => p.id)).toContain(row.id);
  });
});
