// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The organisation's OWN admin actions follow the caller's membership grade,
 * and the organisation record offers no action whose door this composition
 * does not serve — measured on a booted multi-organization showcase, on the
 * wire, from the same three things the console combines.
 *
 * ## The two defects this pins shut
 *
 * 1. `sys_organization`'s rename, edit and delete actions were gated on
 *    `multiOrgEnabled` alone. Only the invitation carried a grade gate, so a
 *    plain member was offered "Rename Organization" in the record header and
 *    "Edit" / "Delete" on the list row, and better-auth's `organization/update`
 *    and `organization/delete` refused every click with 403. They now declare
 *    `requiresMembershipReach` from the reach table's `update_organization`
 *    (owner, admin) and `delete_organization` (owner) rows — the rows
 *    plugin-auth's `membership-reach-table.test.ts` pins equal to the door.
 * 2. `change_slug` targeted `/api/v1/cloud/organizations/{id}/change-slug`, a
 *    route only the cloud orchestrator serves. Here, with multi-org on, the
 *    record header offered it and the click answered `404 ENDPOINT_NOT_FOUND`.
 *    The platform object no longer declares it: the composition that serves the
 *    door declares the action beside it. The open-source slug door is
 *    `update_organization`, better-auth's `organization/update`.
 *
 * ## What this measures
 *
 * For an owner who created the organisation through the door, an `admin` and a
 * plain `member` of it, each with it active, it reads the SERVED session face
 * (`GET /auth/get-session`, the `positions` bound as `current_user`), the
 * SERVED flags (`GET /auth/config`) and the SERVED `sys_organization` metadata
 * (`GET /meta/object/sys_organization`), and evaluates each served `visible`
 * with `@objectstack/formula`'s `celEngine`, the console's engine. The
 * expected sets are spelled out, not computed from the table, and both halves
 * are asserted per grade — what it IS offered and what it is NOT.
 *
 * The door probes then show the verdicts are the door's own: each refusal is
 * the vendor's 403 with its own code, each admission a 200 that took effect.
 * And every `type: 'api'` action the record serves is called once at its own
 * target: none answers the router's `404 ENDPOINT_NOT_FOUND`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { celEngine } from '@objectstack/formula';

const SYSTEM_CTX = { isSystem: true };
const PASSWORD = 'OrgReach!Pass123';

type Grade = 'owner' | 'admin' | 'member';
type ServedAction = { name: string; type?: string; target?: string; visible?: unknown };

/** Every grade may switch to, leave, or create an organisation: no grade term. */
const EVERY_GRADE = ['create_organization', 'set_active_organization', 'leave_organization'] as const;
/** `organization/invite-member`: owner, admin and delegated_admin. */
const INVITE = ['invite_user'] as const;
/** `organization/update`: owner and admin. */
const UPDATE = ['update_organization', 'rename_organization'] as const;
/** `organization/delete`: the owner alone. */
const DELETE = ['delete_organization'] as const;
const ALL = [...EVERY_GRADE, ...INVITE, ...UPDATE, ...DELETE];

const EXPECTED: Record<Grade, readonly string[]> = {
  owner: ALL,
  admin: [...EVERY_GRADE, ...INVITE, ...UPDATE],
  member: [...EVERY_GRADE],
};

const PROJECTED: Record<Grade, string> = { owner: 'org_owner', admin: 'org_admin', member: 'org_member' };

async function findRows(ql: any, object: string, where: any, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

describe('sys_organization admin actions follow the membership grade, and every one has a door', () => {
  let stack: VerifyStack;
  let ql: any;
  let features: Record<string, unknown>;
  const tokens = {} as Record<Grade, string>;
  const userIds = {} as Record<Grade, string>;
  const sessionUser = {} as Record<Grade, Record<string, unknown>>;
  const served = {} as Record<Grade, Map<string, ServedAction>>;
  /** The organisation the grades are measured in, and a second one the delete probes may destroy. */
  const org = { main: { id: '', row: {} as Record<string, unknown> }, doomed: { id: '' } };

  const createOrg = async (token: string, name: string, slug: string): Promise<string> => {
    const res = await stack.apiAs(token, 'POST', '/auth/organization/create', { name, slug });
    expect(res.status, await res.clone().text()).toBe(200);
    return String(((await res.json()) as { id: string }).id);
  };
  const join = async (grade: Exclude<Grade, 'owner'>, organizationId: string) => {
    await ql.insert('sys_member', { user_id: userIds[grade], organization_id: organizationId, role: grade }, { context: SYSTEM_CTX });
  };

  beforeAll(async () => {
    stack = await bootShowcase({ multiTenant: 'posture-only' });
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    for (const grade of Object.keys(PROJECTED) as Grade[]) {
      const email = `org-reach.${grade}@verify.test`;
      tokens[grade] = await stack.signUp(email, PASSWORD, `Org reach ${grade}`);
      const [user] = await findRows(ql, 'sys_user', { email }, 1);
      userIds[grade] = String(user.id);
    }

    // The owner creates both organisations through the door (better-auth makes
    // the creator its `owner`); the other two join in system context — the only
    // writer better-auth-managed tables accept (ADR-0092).
    org.main.id = await createOrg(tokens.owner, 'Org Reach', 'org-reach');
    org.doomed.id = await createOrg(tokens.owner, 'Org Reach Doomed', 'org-reach-doomed');
    for (const id of [org.main.id, org.doomed.id]) {
      await join('admin', id);
      await join('member', id);
    }
    for (const grade of Object.keys(PROJECTED) as Grade[]) {
      const res = await stack.apiAs(tokens[grade], 'POST', '/auth/organization/set-active', { organizationId: org.main.id });
      expect(res.status, `${grade} activates the organisation: ${await res.clone().text()}`).toBe(200);
    }
    [org.main.row] = await findRows(ql, 'sys_organization', { id: org.main.id }, 1);

    const config = await stack.apiAs(tokens.member, 'GET', '/auth/config');
    expect(config.status).toBe(200);
    features = ((await config.json()) as { data: { features: Record<string, unknown> } }).data.features;

    for (const grade of Object.keys(PROJECTED) as Grade[]) {
      const session = await stack.apiAs(tokens[grade], 'GET', '/auth/get-session');
      expect(session.status).toBe(200);
      sessionUser[grade] = ((await session.json()) as { user: Record<string, unknown> }).user;
      const meta = await stack.apiAs(tokens[grade], 'GET', '/meta/object/sys_organization');
      expect(meta.status, `${grade} reads /meta/object/sys_organization`).toBe(200);
      const body = (await meta.json()) as { item?: { actions?: ServedAction[] } };
      served[grade] = new Map((body.item?.actions ?? []).map((a) => [a.name, a]));
    }
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  /** What the console offers: the action served to THAT principal, its predicate admitting it. */
  const offered = (grade: Grade, name: string): boolean => {
    const action = served[grade].get(name);
    if (!action) return false;
    expect(action.visible, `${name} serves one predicate to every grade`).toEqual(served.owner.get(name)?.visible);
    if (action.visible === undefined) return true;
    const result = celEngine.evaluate(action.visible as never, {
      record: org.main.row,
      user: sessionUser[grade] as never,
      extra: { features },
    });
    if (!result.ok) throw new Error(`${name} faulted for ${grade}: ${JSON.stringify(result)}`);
    return result.value === true;
  };

  it('the composition is multi-organization, and each session carries its own grade alone', () => {
    // The feature half of every composed predicate is ON, so each verdict
    // below is decided by the grade term.
    expect(features.multiOrgEnabled).toBe(true);
    expect(features.organization).toBe(true);
    for (const [grade, projected] of Object.entries(PROJECTED) as Array<[Grade, string]>) {
      const positions = sessionUser[grade].positions as string[];
      expect(positions, grade).toContain(projected);
      for (const other of Object.values(PROJECTED).filter((p) => p !== projected)) {
        expect(positions, `${grade} must not carry ${other}`).not.toContain(other);
      }
    }
  });

  it('every grade is served the same action set, and change_slug is not in it', () => {
    for (const grade of Object.keys(PROJECTED) as Grade[]) {
      expect([...served[grade].keys()].sort(), grade).toEqual([...ALL].sort());
    }
  });

  it.each(Object.keys(EXPECTED) as Grade[])('%s is offered exactly the organisation actions its grade reaches', (grade) => {
    expect(ALL.filter((name) => offered(grade, name))).toEqual(ALL.filter((name) => EXPECTED[grade].includes(name)));
  });

  it('each verdict matches the door: hidden means refused, shown means admitted', async () => {
    /** A door refusal: 403 with the vendor's own code — never a bare status. */
    const refused = async (res: Response, code: string) => {
      expect(res.status, await res.clone().text()).toBe(403);
      expect(((await res.json()) as { code?: string }).code).toBe(code);
    };

    // organization/update: the plain member is refused; the admin and the owner are admitted.
    await refused(await stack.apiAs(tokens.member, 'POST', '/auth/organization/update', {
      organizationId: org.main.id, data: { name: 'Renamed By Member' },
    }), 'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION');
    for (const grade of ['admin', 'owner'] as const) {
      const name = `Renamed By ${grade}`;
      const res = await stack.apiAs(tokens[grade], 'POST', '/auth/organization/update', { organizationId: org.main.id, data: { name } });
      expect(res.status, await res.clone().text()).toBe(200);
      const [row] = await findRows(ql, 'sys_organization', { id: org.main.id }, 1);
      expect(row.name).toBe(name);
    }

    // organization/delete: the plain member and the admin are refused; the owner is admitted.
    for (const grade of ['member', 'admin'] as const) {
      await refused(
        await stack.apiAs(tokens[grade], 'POST', '/auth/organization/delete', { organizationId: org.doomed.id }),
        'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION',
      );
    }
    expect(await findRows(ql, 'sys_organization', { id: org.doomed.id }, 1)).toHaveLength(1);
    const deleted = await stack.apiAs(tokens.owner, 'POST', '/auth/organization/delete', { organizationId: org.doomed.id });
    expect(deleted.status, await deleted.clone().text()).toBe(200);
    expect(await findRows(ql, 'sys_organization', { id: org.doomed.id }, 1)).toEqual([]);
  }, 60_000);

  it('every api action the record serves reaches a door this composition mounts — none answers ENDPOINT_NOT_FOUND', async () => {
    const apiActions = [...served.owner.values()].filter((a) => a.type === 'api');
    expect(apiActions.map((a) => a.name).sort()).toEqual([...ALL].sort());
    // The plain member and an organisation id no row carries: every door
    // refuses before it writes anything, and a refusal from the door is the
    // door's own answer, not the router's.
    for (const action of apiActions) {
      const target = String(action.target);
      expect(target.startsWith('/api/v1/'), `${action.name}: ${target}`).toBe(true);
      const path = target.slice('/api/v1'.length).replace('{id}', 'org_does_not_exist');
      const res = await stack.apiAs(tokens.member, 'POST', path, { organizationId: 'org_does_not_exist' });
      const body = (await res.clone().json().catch(() => ({}))) as { code?: string; error?: { code?: string } };
      expect(
        { status: res.status, code: body.error?.code ?? body.code },
        `${action.name} → POST ${target}`,
      ).not.toEqual({ status: 404, code: 'ENDPOINT_NOT_FOUND' });
    }
  }, 60_000);
});
