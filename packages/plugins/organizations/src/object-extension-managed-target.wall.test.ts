// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24314] An `objectExtensions` entry on a better-auth-managed identity object
 * leaves the organisation and the user readable to the people they belong to,
 * on a BOOTED organization wall.
 *
 * ## The defect this pins shut
 *
 * `ObjectRegistry.registerObject` ran `applySystemFields` on the extension
 * body as well as on the owner's. The body carries no `managedBy`, so the
 * injected-columns plan saw an ordinary object and planned `organization_id`,
 * `created_by` and `updated_by` for it; the fold merged them onto
 * `sys_organization` and `sys_user`, whose own `managedBy: 'better-auth'`
 * plans no injected column at all, and the driver created them. Measured on
 * this boot before the fix, one text field extending each: `organization_id`
 * NULL on every row, and a plain member's list of `sys_organization` and of
 * `sys_user` answered `[]`, with their own organisation and their own user row
 * `404` by id. The control, the same boot with no extension, answered both.
 *
 * ## What is real
 *
 * `bootStack` (`@objectstack/verify`): the kernel over in-process SQLite, the
 * Hono app every request is injected through, the real `AuthPlugin` and
 * `SecurityPlugin`, and THIS package's `OrganizationsPlugin` (which raises the
 * wall) under `OS_TENANCY_POSTURE=isolated`. The callers are made through the
 * product's doors: an organisation's owner who signed up and created it (not
 * the platform owner, whose standing would read past the wall), a colleague
 * they invited who accepted, and the seeded platform owner as the outsider of
 * that organisation. The physical columns are read off the driver.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { OrganizationsPlugin } from './organizations-plugin.js';

const APP = {
  manifest: {
    id: 'com.example.extensionwall',
    namespace: 'extensionwall',
    version: '0.0.1',
    type: 'app',
    name: 'Identity Extension Wall Fixture',
  },
  objects: [],
  objectExtensions: [
    { extend: 'sys_organization', fields: { summary: { type: 'text', label: 'Summary' } } },
    { extend: 'sys_user', fields: { badge: { type: 'text', label: 'Badge' } } },
  ],
};

/** The columns the plan injects on an ordinary object and withholds on a better-auth one. */
const WITHHELD = ['organization_id', 'created_by', 'updated_by', 'owner_id', 'owning_business_unit_id'];

const OWNER_EMAIL = 'extension-wall-owner@verify.test';
const MEMBER_EMAIL = 'extension-wall-member@verify.test';

interface Answer {
  status: number;
  body: any;
}

describe('an objectExtensions entry on sys_organization and sys_user, on a booted wall (#24314)', () => {
  const restoreEnv: Array<[string, string | undefined]> = [];
  let stack: VerifyStack;
  let ql: any;
  let platformOwner: string;
  let owner: string;
  let member: string;
  let org: string;
  let platformOrg: string;

  const answer = async (res: Response): Promise<Answer> => ({
    status: res.status,
    body: await res.json().catch(() => undefined),
  });
  const session = async (token: string): Promise<any> =>
    (await answer(await stack.apiAs(token, 'GET', '/auth/get-session'))).body;
  const read = async (token: string, path: string) => answer(await stack.apiAs(token, 'GET', path));
  const ids = (res: Answer): string[] => (res.body?.data?.records ?? res.body?.records ?? []).map((r: any) => r.id);
  const physicalColumns = async (object: string): Promise<string[]> => {
    const knex = ql.getDriverForObject(object).getKnex();
    return ((await knex.raw(`PRAGMA table_info("${object}")`)) as Array<{ name: string }>).map((r) => r.name);
  };

  beforeAll(async () => {
    for (const [name, value] of [
      ['OS_TENANCY_POSTURE', 'isolated'],
      ['OS_AUTH_MEMBERSHIP_POLICY', 'invite-only'],
    ] as const) {
      restoreEnv.push([name, process.env[name]]);
      process.env[name] = value;
    }
    stack = await bootStack(APP as never, { extraPlugins: [new OrganizationsPlugin()] });
    ql = await stack.kernel.getServiceAsync('objectql');

    platformOwner = await stack.signIn();
    platformOrg = (await session(platformOwner)).session.activeOrganizationId;

    owner = await stack.signUp(OWNER_EMAIL);
    const created = await answer(
      await stack.apiAs(owner, 'POST', '/auth/organization/create', { name: 'Extension Wall', slug: 'extension-wall' }),
    );
    expect(created.status).toBe(200);
    org = created.body.id;
    expect((await stack.apiAs(owner, 'POST', '/auth/organization/set-active', { organizationId: org })).status).toBe(200);

    member = await stack.signUp(MEMBER_EMAIL);
    const invited = await answer(
      await stack.apiAs(owner, 'POST', '/auth/organization/invite-member', {
        email: MEMBER_EMAIL,
        role: 'member',
        organizationId: org,
      }),
    );
    expect(invited.status).toBe(200);
    expect(
      (await stack.apiAs(member, 'POST', '/auth/organization/accept-invitation', { invitationId: invited.body.id })).status,
    ).toBe(200);
    expect((await stack.apiAs(member, 'POST', '/auth/organization/set-active', { organizationId: org })).status).toBe(200);
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
    for (const [name, value] of restoreEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  for (const [object, field] of [['sys_organization', 'summary'], ['sys_user', 'badge']] as const) {
    it(`${object}: the extension's field is registered and created, and no injected column is`, async () => {
      const schema = ql.getSchema(object);
      expect(schema.fields[field]).toMatchObject({ type: 'text' });
      expect(WITHHELD.filter((c) => schema.fields[c] !== undefined)).toEqual([]);

      const columns = await physicalColumns(object);
      expect(columns).toContain(field);
      expect(WITHHELD.filter((c) => columns.includes(c))).toEqual([]);
    });
  }

  it("the organisation's owner and its member each read it, by list and by id", async () => {
    for (const [who, token] of [['owner', owner], ['member', member]] as const) {
      const list = await read(token, '/data/sys_organization?limit=50');
      expect(list.status, who).toBe(200);
      expect(ids(list), who).toContain(org);
      const byId = await read(token, `/data/sys_organization/${org}`);
      expect(byId.status, who).toBe(200);
      expect(byId.body?.data?.id ?? byId.body?.id, who).toBe(org);
    }
  });

  it('each reads their own user row by id, and the member sees it in the list', async () => {
    for (const [who, token] of [['owner', owner], ['member', member]] as const) {
      const me = (await session(token)).user.id;
      const byId = await read(token, `/data/sys_user/${me}`);
      expect(byId.status, who).toBe(200);
      expect(byId.body?.data?.id ?? byId.body?.id, who).toBe(me);
    }
    const memberId = (await session(member)).user.id;
    expect(ids(await read(member, '/data/sys_user?limit=50'))).toContain(memberId);
  });

  it('the wall still holds: the member is answered 404 on an organisation they do not belong to', async () => {
    expect(platformOrg).not.toBe(org);
    const foreign = await read(member, `/data/sys_organization/${platformOrg}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body?.code).toBe('RECORD_NOT_FOUND');
    expect(ids(await read(member, '/data/sys_organization?limit=50'))).not.toContain(platformOrg);
  });
});
