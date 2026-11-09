// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0069 TL;DR 6] An organization administrator reads the client address
// their organization's `access_policy` Allowed IP ranges are judged by, before
// saving the list: `GET /api/v1/auth/client-address`, gated to the caller who
// may save that list (`setup.write` in their current organization), resolved
// by the platform's own security composition on a booted stack.
//
//  - an organization administrator (`organization_admin_no_bypass`, which holds
//    `setup.write`) is served `{ clientAddress, trustProxy }`;
//  - a plain member is refused `403 PERMISSION_DENIED`, an anonymous caller
//    `401 UNAUTHENTICATED`, before any address is read;
//  - the platform administrator's route, `GET /api/v1/auth/admin/client-address`,
//    still refuses the organization administrator, who is not a platform
//    administrator.
//
// The address itself is pinned against the save check's own judgement in
// plugin-auth's `allowed-ip-ranges.pin.test.ts`; an in-process request carries
// no transport peer, so here it reads `null`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { catalogPermissionSet } from './catalog-permission-set.js';

const fixture = defineStack({
  manifest: {
    id: 'com.dogfood.org-admin-client-address', namespace: 'oca', version: '0.0.0', type: 'app',
    name: 'Organization administrator address read fixture', description: 'An app with one object, so the stack boots.',
  },
  objects: [
    ObjectSchema.create({
      name: 'oca_note', label: 'Note', pluralLabel: 'Notes',
      fields: { name: Field.text({ label: 'Name', required: true }) },
    }),
  ],
} as never);

const ORG_ADMIN = 'oca-org-admin@verify.test';
const MEMBER = 'oca-member@verify.test';
const SYS = { isSystem: true };

type Answer = { status: number; json: any; text: string };

describe('an organization administrator reads the address their access-policy list is judged by', () => {
  let stack: VerifyStack;
  const tokens: Record<'orgAdmin' | 'member', string> = { orgAdmin: '', member: '' };

  const call = async (token: string | undefined, path: string): Promise<Answer> => {
    const res = token ? await stack.apiAs(token, 'GET', path) : await stack.api(path, { method: 'GET' });
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };

  beforeAll(async () => {
    stack = await bootStack(fixture);
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    tokens.orgAdmin = await stack.signUp(ORG_ADMIN);
    tokens.member = await stack.signUp(MEMBER);
    const set = 'organization_admin_no_bypass';
    expect(await catalogPermissionSet(ql, set), `${set} is served by the catalog`).toBeTruthy();
    const user = await ql.findOne('sys_user', { where: { email: ORG_ADMIN }, context: SYS });
    await ql.insert('sys_user_permission_set', { user_id: String(user?.id ?? ''), permission_set: set }, { context: SYS });
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('the organization administrator is served the judged address', async () => {
    const answer = await call(tokens.orgAdmin, '/auth/client-address');
    expect(answer.status, answer.text).toBe(200);
    expect(answer.json).toEqual({ success: true, data: { clientAddress: null, trustProxy: false } });
  });

  it('a plain member is refused 403 PERMISSION_DENIED, and no address is served', async () => {
    const answer = await call(tokens.member, '/auth/client-address');
    expect(answer.status, answer.text).toBe(403);
    expect(answer.json?.error?.code).toBe('PERMISSION_DENIED');
    expect(answer.json?.data).toBeUndefined();
  });

  it('an anonymous caller is refused 401 UNAUTHENTICATED', async () => {
    const answer = await call(undefined, '/auth/client-address');
    expect(answer.status, answer.text).toBe(401);
    expect(answer.json?.error?.code).toBe('UNAUTHENTICATED');
  });

  it("the platform administrator's route still refuses the organization administrator", async () => {
    const answer = await call(tokens.orgAdmin, '/auth/admin/client-address');
    expect(answer.status, answer.text).toBe(403);
    expect(answer.json?.error?.code).toBe('PERMISSION_DENIED');
  });
});
