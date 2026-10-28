// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26571] `access-security.grant-table-write-contract`, acceptance[1] and
// acceptance[3], through the REST data door on the stock showcase.
//
// The plugin-security engine pins (`grant-permission-set-name.test.ts`,
// `granted-by-writer-provenance.test.ts`) prove the contract on a real engine
// and read the thrown error through `resolveThrownHttpError`. The item's
// clauses are scored at the `api` oracle, so this file writes the grant table
// the way an administrator does — `POST /data/sys_user_permission_set` — and
// reads the answer the wire carries:
//
//   - acceptance[1]: a grant naming the retired `permission_set_id` column is
//     400 INVALID_FIELD; a second identical grant is 409 UNIQUE_VIOLATION;
//   - acceptance[3]: a grant naming someone else as `granted_by` stores the
//     caller.
//
// acceptance[2] (the inverted window) is pinned beside the window semantics in
// `permission-set-assignment-window.dogfood.test.ts`. acceptance[4] is the
// walled-boot leg (knownGaps).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const GRANTS = '/data/sys_user_permission_set';
const SET = 'showcase_auditor';

const codeOf = (body: any) => body?.code ?? body?.error?.code;
const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id;

describe('the grant table\'s write contract over the REST data door', () => {
  let stack: VerifyStack;
  let ql: any;
  let admin: string;
  let adminId: string;
  const uid: Record<string, string> = {};

  const userIdOf = async (email: string) => String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id ?? '');

  beforeAll(async () => {
    stack = await bootShowcase();
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    const session = (await (await stack.apiAs(admin, 'GET', '/auth/get-session')).json()) as any;
    adminId = String(session?.user?.id ?? '');
    expect(adminId, 'the admin has an id').toBeTruthy();
    expect(await catalogPermissionSet(ql, SET), `${SET} is served by the catalog`).toBeTruthy();
    for (const who of ['dup', 'retired', 'provenance', 'granter']) {
      const email = `grant-contract-${who}@verify.test`;
      await stack.signUp(email);
      uid[who] = await userIdOf(email);
      expect(uid[who], `${who} signed up`).toBeTruthy();
    }
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[1]: a grant naming the retired permission_set_id column is 400 INVALID_FIELD, and nothing is stored', async () => {
    const res = await stack.apiAs(admin, 'POST', GRANTS, { user_id: uid.retired, permission_set_id: SET });
    const body = await res.json();
    expect([res.status, codeOf(body)], JSON.stringify(body)).toEqual([400, 'INVALID_FIELD']);
    expect(JSON.stringify(body), 'the refusal names the column').toContain('permission_set_id');
    expect(await ql.find('sys_user_permission_set', { where: { user_id: uid.retired }, context: SYS })).toEqual([]);
  });

  it('acceptance[1]: a second identical grant is 409 UNIQUE_VIOLATION, and one row stands', async () => {
    const first = await stack.apiAs(admin, 'POST', GRANTS, { user_id: uid.dup, permission_set: SET });
    expect(first.status, await first.clone().text()).toBe(201);
    const second = await stack.apiAs(admin, 'POST', GRANTS, { user_id: uid.dup, permission_set: SET });
    const body = await second.json();
    expect([second.status, codeOf(body)], JSON.stringify(body)).toEqual([409, 'UNIQUE_VIOLATION']);
    expect(await ql.find('sys_user_permission_set', { where: { user_id: uid.dup }, context: SYS })).toHaveLength(1);
  });

  it('acceptance[3]: a grant naming ANOTHER user as granted_by stores the caller', async () => {
    const res = await stack.apiAs(admin, 'POST', GRANTS, {
      user_id: uid.provenance, permission_set: SET, granted_by: uid.granter,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const id = idOf(await res.json());
    expect(id, 'the created grant id').toBeTruthy();

    const read = await stack.apiAs(admin, 'GET', `${GRANTS}/${id}`);
    expect(read.status).toBe(200);
    const row = (await read.json()) as any;
    expect((row?.record ?? row?.data ?? row)?.granted_by, 'the wire read-back names the writer').toBe(adminId);
    const stored = await ql.findOne('sys_user_permission_set', { where: { id }, context: SYS });
    expect(stored?.granted_by, 'and so does the stored row').toBe(adminId);
  });
});
