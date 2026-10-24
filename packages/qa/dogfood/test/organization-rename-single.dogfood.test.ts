// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `single` deployment can rename its one organization (#25347).
 *
 * One organization used to show three names: Settings → Branding's unsaved
 * default, the organization record's "Default Organization", and the console's
 * product name. The organization's own name has one home, `sys_organization.name`,
 * and under `single` it had no door at all: `update_organization` and
 * `rename_organization` were both gated on `multiOrgEnabled`, and the generic
 * edit form keeps `name` readonly (ADR-0092 D4). `rename_organization` is now
 * gated on the organization CAPABILITY, so the posture `os dev` boots by
 * default offers it.
 *
 * Measured on the plain showcase (`single`), on the wire, from the three things
 * the console combines: the SERVED flags (`GET /auth/config`), the SERVED
 * session face (`GET /auth/get-session`, its `positions`) and the SERVED
 * `sys_organization` metadata, each `visible` evaluated with the console's
 * `celEngine` against the default organization's row. Then the door: the
 * rename runs the way the console's api action runner builds it and the name
 * reads back changed, the slug the default-organization bootstrap finds the
 * row by unchanged. A plain member is offered nothing and refused at the door.
 *
 * The declaration half is `sys-organization-rename-action.test.ts` in
 * `@objectstack/platform-objects`; the multi-organization grade matrix is
 * `org-record-admin-reach.dogfood.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { celEngine } from '@objectstack/formula';
import { bootShowcase } from './showcase-boot.js';

const SYSTEM_CTX = { isSystem: true };

interface ServedAction {
  name: string;
  type?: string;
  target?: string;
  recordIdParam?: string;
  bodyShape?: { wrap?: string };
  params?: Array<{ field?: string; name?: string }>;
  visible?: unknown;
}

type Principal = 'admin' | 'member';

describe('sys_organization.rename_organization under single: the one organization can be renamed', () => {
  let stack: VerifyStack;
  let ql: any;
  let features: Record<string, unknown>;
  let orgRow: Record<string, unknown>;
  const tokens = {} as Record<Principal, string>;
  const sessionUser = {} as Record<Principal, Record<string, unknown>>;
  const served = {} as Record<Principal, Map<string, ServedAction>>;

  const readOrg = async (id: string): Promise<Record<string, unknown>> => {
    const rows = await ql.find('sys_organization', { where: { id }, limit: 1 }, { context: SYSTEM_CTX });
    return ((Array.isArray(rows) ? rows : rows?.records ?? [])[0] ?? {}) as Record<string, unknown>;
  };

  /** What the console offers this principal: the served action, its predicate admitting it. */
  const offered = (who: Principal, name: string): boolean => {
    const action = served[who].get(name);
    if (!action) return false;
    if (action.visible === undefined) return true;
    const result = celEngine.evaluate(action.visible as never, {
      record: orgRow,
      user: sessionUser[who] as never,
      extra: { features },
    });
    if (!result.ok) throw new Error(`${name} faulted for ${who}: ${JSON.stringify(result)}`);
    return result.value === true;
  };

  /** Run the served action the way the console's api runner does. */
  const runRename = (who: Principal, values: Record<string, unknown>) => {
    const rename = served[who].get('rename_organization')!;
    const keys = (rename.params ?? []).map((p) => (p.field ?? p.name) as string);
    const collected = Object.fromEntries(keys.filter((k) => k in values).map((k) => [k, values[k]]));
    const wrap = rename.bodyShape?.wrap;
    const body: Record<string, unknown> = wrap ? { [wrap]: collected } : { ...collected };
    body[rename.recordIdParam as string] = orgRow.id;
    return stack.apiAs(tokens[who], 'POST', String(rename.target).replace(/^\/api\/v1/, ''), body);
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    tokens.admin = await stack.signIn();
    tokens.member = await stack.signUp('org-rename-single.member@verify.test', 'OrgRenameSingle!123', 'Single member');

    const config = await stack.apiAs(tokens.admin, 'GET', '/auth/config');
    expect(config.status).toBe(200);
    features = ((await config.json()) as { data: { features: Record<string, unknown> } }).data.features;

    for (const who of ['admin', 'member'] as const) {
      const session = await stack.apiAs(tokens[who], 'GET', '/auth/get-session');
      expect(session.status).toBe(200);
      sessionUser[who] = ((await session.json()) as { user: Record<string, unknown> }).user;
      const meta = await stack.apiAs(tokens[who], 'GET', '/meta/object/sys_organization');
      expect(meta.status, `${who} reads /meta/object/sys_organization`).toBe(200);
      const body = (await meta.json()) as { item?: { actions?: ServedAction[] } };
      served[who] = new Map((body.item?.actions ?? []).map((a) => [a.name, a]));
    }

    // The organization the admin's session opens in: under `single`, the one
    // membership the default-organization bootstrap gave the seeded admin.
    const memberships = await ql.find('sys_member', { where: { user_id: sessionUser.admin.id }, limit: 5 }, { context: SYSTEM_CTX });
    const rows = (Array.isArray(memberships) ? memberships : memberships?.records ?? []) as Array<Record<string, unknown>>;
    expect(rows, 'PREMISE: the seeded admin belongs to exactly one organization').toHaveLength(1);
    orgRow = await readOrg(String(rows[0].organization_id));
    expect(orgRow.id, 'PREMISE: the default organization row exists').toBe(rows[0].organization_id);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('the composition is single: organizations exist, multi-organization is off', () => {
    expect(features.multiOrgEnabled).toBe(false);
    expect(features.organization).toBe(true);
    const positions = sessionUser.admin.positions as string[];
    expect(
      positions.includes('org_owner') || positions.includes('org_admin'),
      `PREMISE: the seeded admin holds a grade organization/update admits (${JSON.stringify(positions)})`,
    ).toBe(true);
  });

  it('the admin is offered Rename Organization, and still not the multi-organization actions', () => {
    expect(offered('admin', 'rename_organization')).toBe(true);
    // CONTROL: the slug door and the rest of the multi-organization set stay hidden.
    for (const name of ['update_organization', 'create_organization', 'delete_organization', 'set_active_organization', 'leave_organization']) {
      expect(offered('admin', name), name).toBe(false);
    }
  });

  it('a plain member is not offered it, and the door refuses the member', async () => {
    expect(offered('member', 'rename_organization')).toBe(false);
    const before = await readOrg(String(orgRow.id));
    const res = await runRename('member', { name: 'Renamed By Member' });
    expect(res.status, await res.clone().text()).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe('YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION');
    expect((await readOrg(String(orgRow.id))).name).toBe(before.name);
  });

  it('the rename lands: the name reads back changed and the slug is kept', async () => {
    const before = await readOrg(String(orgRow.id));
    expect(before.slug, 'PREMISE: the default organization carries a slug').toBeTruthy();
    const res = await runRename('admin', { name: 'Acme Corporation' });
    expect(res.status, `organization/update returned ${res.status}: ${await res.clone().text()}`).toBe(200);
    const after = await readOrg(String(orgRow.id));
    expect(after.name).toBe('Acme Corporation');
    expect(after.slug).toBe(before.slug);
  });
});
