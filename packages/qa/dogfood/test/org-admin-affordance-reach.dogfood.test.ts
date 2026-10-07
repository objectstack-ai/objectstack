// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The org-admin affordances on the organization's member, invitation and team
 * lists follow the caller's MEMBERSHIP GRADE — measured on a real boot, on the
 * wire, from the same three things the console combines.
 *
 * The defect this pins: every one of these actions was gated on the
 * `organization` capability alone, so a plain member was offered "Invite
 * User", "Remove Member", "Create Team" … and the server then refused each with
 * 403. The server was right; the button had no declared way to ask the same
 * question. The actions now declare `requiresMembershipReach: '<endpoint>'`,
 * which the spec lowers at parse time into `visible` over
 * `current_user.positions` from ONE reach table (`MEMBERSHIP_REACH`) — the
 * table plugin-auth's `membership-reach-table.test.ts` pins equal to the door.
 *
 * ## What this measures
 *
 * For four principals in one organization — the owner, an `admin`, a
 * `delegated_admin` and a plain `member` — it reads:
 *
 *  1. the SERVED session face (`GET /auth/get-session`): the `positions` the
 *     console binds as `current_user`;
 *  2. the SERVED capability flags (`GET /auth/config`): the `features` the
 *     console binds;
 *  3. the SERVED action metadata (`GET /meta/object/<name>`) of `sys_member`,
 *     `sys_invitation`, `sys_team`, `sys_team_member` and `sys_user`;
 *
 * and evaluates each served `visible` against them with
 * `@objectstack/formula`'s `celEngine`, the engine the console itself uses
 * (the same composite the approvals override pin uses). The expected sets are
 * spelled out below rather than computed from the table, so a table that
 * drifted would not grade itself.
 *
 * Both halves are asserted for every principal — what it IS offered and what it
 * is NOT — because a pin of only the first would stay green if a predicate
 * degenerated to a constant `true`, and only the second if it degenerated to
 * `false`. A handful of door probes then show the verdicts are the door's own:
 * a hidden affordance is one the server refuses, a shown one is one it admits.
 *
 * Harness note: `bootStack` disables the default-org bootstrap, so this file
 * mints the organization and sets membership roles in system context — the
 * shape `delegated-admin-invite.dogfood.test.ts` uses, and the only writer
 * better-auth-managed tables accept (ADR-0092).
 *
 * ## The one affordance no grade reaches: "Add Member"
 *
 * `sys_member.add_member` targets a door gated on PLATFORM-admin standing
 * (ADR-0068), not on a grade, so an org owner is refused it too. Its `visible`
 * reads that standing, `current_user.isPlatformAdmin == true` (ADR-0068 D4,
 * the ADR-0095 D3 rung). That case binds `current_user` the way the CONSOLE
 * does — the whole scope handed to the engine as `extra`, one subject built
 * from the served session — and ⛔ not through `user:`, under which
 * `@objectstack/formula` re-derives `isPlatformAdmin` from `positions` and so
 * measures the name instead of the rung the session carries. The grade cases
 * above keep their `user:` binding: their predicates read `positions` only.
 * The platform admin is the seeded dev admin (the harness's signed-in
 * principal); a second org owner who is NOT one is minted for the case.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { celEngine } from '@objectstack/formula';

const SYSTEM_CTX = { isSystem: true };

type Grade = 'owner' | 'admin' | 'delegated_admin' | 'member';
type ServedAction = { name: string; visible?: unknown };

/** The org-admin affordances that call `/organization/invite-member`. */
const INVITE_MEMBER = [
  'sys_user.invite_user',
  'sys_member.invite_user',
  'sys_invitation.invite_user',
  'sys_invitation.resend_invitation',
] as const;
/** The ones whose endpoints better-auth grants to `owner` / `admin` only. */
const ADMIN_ONLY = [
  'sys_member.update_member_role',
  'sys_member.remove_member',
  'sys_invitation.cancel_invitation',
  'sys_team.create_team',
  'sys_team.update_team',
  'sys_team.remove_team',
  'sys_team_member.add_team_member',
  'sys_team_member.remove_team_member',
] as const;
/** Setting the creator role on a member: the owner alone. */
const OWNER_ONLY = ['sys_member.transfer_ownership'] as const;
const ALL = [...INVITE_MEMBER, ...ADMIN_ONLY, ...OWNER_ONLY];

const EXPECTED: Record<Grade, readonly string[]> = {
  owner: ALL,
  admin: [...INVITE_MEMBER, ...ADMIN_ONLY],
  delegated_admin: INVITE_MEMBER,
  member: [],
};

/** The projected name each grade must carry on the session face. */
const PROJECTED: Record<Grade, string> = {
  owner: 'org_owner',
  admin: 'org_admin',
  delegated_admin: 'delegated_admin',
  member: 'org_member',
};

const OBJECTS = ['sys_member', 'sys_invitation', 'sys_team', 'sys_team_member', 'sys_user'] as const;

async function findRows(ql: any, object: string, where: any, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

/** The sign-up reconciler's membership row lands after the signup transaction. */
async function waitForMembership(ql: any, userId: string): Promise<any> {
  for (let i = 0; i < 40; i++) {
    const rows = await findRows(ql, 'sys_member', { user_id: userId }, 5);
    if (rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no sys_member row appeared for ${userId}`);
}

describe('org-admin affordances follow the membership grade (served metadata × served session)', () => {
  let stack: VerifyStack;
  let ql: any;
  let orgId: string;
  const tokens = {} as Record<Grade, string>;
  const sessionUser = {} as Record<Grade, Record<string, unknown>>;
  const served = {} as Record<Grade, Map<string, ServedAction>>;
  /** The field names each grade is served per object — what the metadata-plane field mask left. */
  const servedFields = {} as Record<Grade, Record<string, string[]>>;
  let features: Record<string, unknown>;
  /** A representative row per object — the binding a row action is evaluated against. */
  const rowOf = {} as Record<string, Record<string, unknown>>;
  let plainMemberRowId: string;
  let pendingInvitationId: string;
  /** An org owner who is NOT a platform admin — the principal "Add Member" must not be offered to. */
  const standingOwner = {} as { token: string; userId: string; session: Record<string, unknown>; served: Map<string, ServedAction> };

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {});
    tokens.owner = await stack.signIn(); // the seeded dev admin
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const org = await ql.insert('sys_organization', { name: 'Reach Org', slug: 'reach-org' }, { context: SYSTEM_CTX });
    orgId = String(org.id);

    const [ownerUser] = await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1);
    const ownerMembers = await findRows(ql, 'sys_member', { user_id: ownerUser.id }, 5);
    if (ownerMembers.length > 0) {
      await ql.update('sys_member', { id: ownerMembers[0].id, organization_id: orgId, role: 'owner' }, { context: SYSTEM_CTX });
    } else {
      await ql.insert('sys_member', { user_id: ownerUser.id, organization_id: orgId, role: 'owner' }, { context: SYSTEM_CTX });
    }

    for (const [grade, email] of [
      ['admin', 'reach.admin@example.com'],
      ['delegated_admin', 'reach.delegate@example.com'],
      ['member', 'reach.member@example.com'],
    ] as const) {
      tokens[grade] = await stack.signUp(email, 'Reach!Pass123', `Reach ${grade}`);
      const [user] = await findRows(ql, 'sys_user', { email }, 1);
      const membership = await waitForMembership(ql, String(user.id));
      expect(membership.role).toBe('member'); // the reconciler's default
      if (grade !== 'member') {
        await ql.update('sys_member', { id: membership.id, role: grade }, { context: SYSTEM_CTX });
      } else {
        plainMemberRowId = String(membership.id);
      }
    }

    // A second owner of the same org, signed up rather than seeded, so the
    // owner grade is measured apart from platform-admin standing.
    standingOwner.token = await stack.signUp('reach.owner@example.com', 'Reach!Pass123', 'Reach second owner');
    {
      const [user] = await findRows(ql, 'sys_user', { email: 'reach.owner@example.com' }, 1);
      standingOwner.userId = String(user.id);
      const membership = await waitForMembership(ql, standingOwner.userId);
      await ql.update('sys_member', { id: membership.id, role: 'owner' }, { context: SYSTEM_CTX });
    }

    // Rows for the row actions to bind against: a pending invitation, a team,
    // and a team membership — created through the doors, as the owner.
    const invite = await stack.apiAs(tokens.owner, 'POST', '/auth/organization/invite-member', {
      email: 'reach.pending@example.com', role: 'member', organizationId: orgId,
    });
    expect(invite.status, await invite.clone().text()).toBe(200);
    pendingInvitationId = String(((await invite.json()) as { id: string }).id);
    const team = await stack.apiAs(tokens.owner, 'POST', '/auth/organization/create-team', { name: 'Reach Team', organizationId: orgId });
    expect(team.status, await team.clone().text()).toBe(200);

    const [memberRow] = await findRows(ql, 'sys_member', { id: plainMemberRowId }, 1);
    const [invitationRow] = await findRows(ql, 'sys_invitation', { id: pendingInvitationId }, 1);
    const [teamRow] = await findRows(ql, 'sys_team', { organization_id: orgId }, 1);
    rowOf.sys_member = memberRow;
    rowOf.sys_invitation = invitationRow;
    rowOf.sys_team = teamRow;
    rowOf.sys_team_member = { team_id: teamRow.id, user_id: memberRow.user_id };
    rowOf.sys_user = {};

    const config = await stack.apiAs(tokens.member, 'GET', '/auth/config');
    expect(config.status).toBe(200);
    features = ((await config.json()) as { data: { features: Record<string, unknown> } }).data.features;

    for (const grade of Object.keys(PROJECTED) as Grade[]) {
      const session = await stack.apiAs(tokens[grade], 'GET', '/auth/get-session');
      expect(session.status).toBe(200);
      sessionUser[grade] = ((await session.json()) as { user: Record<string, unknown> }).user;
      served[grade] = new Map();
      servedFields[grade] = {};
      for (const object of OBJECTS) {
        const meta = await stack.apiAs(tokens[grade], 'GET', `/meta/object/${object}`);
        expect(meta.status, `${grade} reads /meta/object/${object}`).toBe(200);
        const body = (await meta.json()) as { item?: { actions?: ServedAction[]; fields?: Record<string, unknown> } };
        for (const action of body.item?.actions ?? []) served[grade].set(`${object}.${action.name}`, action);
        servedFields[grade][object] = Object.keys(body.item?.fields ?? {});
      }
    }

    {
      const session = await stack.apiAs(standingOwner.token, 'GET', '/auth/get-session');
      expect(session.status).toBe(200);
      standingOwner.session = ((await session.json()) as { user: Record<string, unknown> }).user;
      const meta = await stack.apiAs(standingOwner.token, 'GET', '/meta/object/sys_member');
      expect(meta.status, 'the second owner reads /meta/object/sys_member').toBe(200);
      const body = (await meta.json()) as { item?: { actions?: ServedAction[] } };
      standingOwner.served = new Map((body.item?.actions ?? []).map((a) => [`sys_member.${a.name}`, a]));
    }
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  /**
   * The grade gate's verdict for one principal: the predicate as SERVED (read
   * from the owner's copy, which the metadata-plane field mask leaves whole),
   * evaluated against THAT principal's served session and the served flags.
   */
  const gateAdmits = (grade: Grade, site: string): boolean => {
    const action = served.owner.get(site);
    if (!action) throw new Error(`served metadata has no action ${site}`);
    if (action.visible === undefined) return true;
    const result = celEngine.evaluate(action.visible as never, {
      record: rowOf[site.split('.')[0]],
      user: sessionUser[grade] as never,
      extra: { features },
    });
    if (!result.ok) throw new Error(`${site} faulted for ${grade}: ${JSON.stringify(result)}`);
    return result.value === true;
  };

  /**
   * What the console offers: an action served TO that principal whose served
   * predicate admits it. The served copy is the principal's own — a different
   * text from the owner's would be a defect this reads as such.
   */
  const offered = (grade: Grade, site: string): boolean => {
    const own = served[grade].get(site);
    if (!own) return false;
    expect(own.visible, `${site} serves one predicate to every grade`).toEqual(served.owner.get(site)?.visible);
    return gateAdmits(grade, site);
  };

  it('the session face carries each grade under its projected name, and no other grade', () => {
    // The capability half of every composed predicate is ON here, so each
    // verdict below is decided by the grade term alone.
    expect(features.organization).toBe(true);
    for (const [grade, projected] of Object.entries(PROJECTED) as Array<[Grade, string]>) {
      const positions = sessionUser[grade].positions as string[];
      expect(positions, grade).toContain(projected);
      for (const other of Object.values(PROJECTED).filter((p) => p !== projected)) {
        expect(positions, `${grade} must not carry ${other}`).not.toContain(other);
      }
    }
  });

  it.each(Object.keys(EXPECTED) as Grade[])('the gate admits %s to exactly the org-admin affordances of its grade', (grade) => {
    expect(ALL.filter((site) => gateAdmits(grade, site))).toEqual(ALL.filter((site) => EXPECTED[grade].includes(site)));
  });

  // Every site is served to every grade, so each verdict below is the gate's
  // rather than the metadata-plane field mask's.
  it.each(Object.keys(EXPECTED) as Grade[])('%s is offered, on its own served metadata, exactly those it is served', (grade) => {
    const unserved = ALL.filter((site) => !served[grade].has(site));
    expect(unserved).toEqual([]);
    const shown = ALL.filter((site) => offered(grade, site));
    expect(shown).toEqual(ALL.filter((site) => EXPECTED[grade].includes(site)));
  });

  it('a delegated_admin is offered Invite User on sys_user; a plain member is not — by the reach gate, not the field mask', () => {
    // `invite_user`'s `role` param names `sys_member.role` through
    // `objectOverride`. Neither grade is served `sys_user.role`, so a mask that
    // read the param as THIS object's field withheld the action from both. Both
    // ARE served `sys_member.role`, the field the param actually names.
    for (const grade of ['delegated_admin', 'member'] as const) {
      expect(servedFields[grade].sys_user, `${grade} is not served sys_user.role`).not.toContain('role');
      expect(servedFields[grade].sys_member, `${grade} is served sys_member.role`).toContain('role');
      expect(served[grade].has('sys_user.invite_user'), `${grade} is served sys_user.invite_user`).toBe(true);
    }
    expect(offered('delegated_admin', 'sys_user.invite_user')).toBe(true);
    // The member is served the same action and is still not offered it: the
    // served `requiresMembershipReach` predicate excludes its grade.
    expect(gateAdmits('member', 'sys_user.invite_user')).toBe(false);
    expect(offered('member', 'sys_user.invite_user')).toBe(false);
  });

  it('a plain member sees none of them on the member, invitation and team lists', () => {
    for (const site of ALL) expect(offered('member', site), site).toBe(false);
  });

  it('add_member carries no grade term — its door is platform-admin standing, not a membership grade', () => {
    const source = String((served.member.get('sys_member.add_member')?.visible as { source?: string })?.source);
    expect(source).not.toContain('current_user.positions');
  });

  it('each verdict matches the door: hidden means refused, shown means admitted', async () => {
    /** A door refusal: 403 with the vendor's own code — never a bare status. */
    const refused = async (res: Response, code: string) => {
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code?: string }).code).toBe(code);
    };

    // invite-member: the plain member is refused, the delegate is admitted.
    await refused(await stack.apiAs(tokens.member, 'POST', '/auth/organization/invite-member', {
      email: 'reach.from-member@example.com', role: 'member', organizationId: orgId,
    }), 'YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION');
    const delegateInvite = await stack.apiAs(tokens.delegated_admin, 'POST', '/auth/organization/invite-member', {
      email: 'reach.from-delegate@example.com', role: 'member', organizationId: orgId,
    });
    expect(delegateInvite.status, await delegateInvite.clone().text()).toBe(200);

    // resend IS invite-member: the delegate is admitted there too.
    const delegateResend = await stack.apiAs(tokens.delegated_admin, 'POST', '/auth/organization/invite-member', {
      email: 'reach.pending@example.com', role: 'member', organizationId: orgId, resend: true,
    });
    expect(delegateResend.status, await delegateResend.clone().text()).toBe(200);

    // cancel-invitation: the delegate is refused (`create` without `cancel`).
    await refused(await stack.apiAs(tokens.delegated_admin, 'POST', '/auth/organization/cancel-invitation', {
      invitationId: pendingInvitationId,
    }), 'YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION');

    // create-team: the plain member and the delegate are refused, the admin admitted.
    await refused(
      await stack.apiAs(tokens.member, 'POST', '/auth/organization/create-team', { name: 'From Member', organizationId: orgId }),
      'YOU_ARE_NOT_ALLOWED_TO_CREATE_TEAMS_IN_THIS_ORGANIZATION',
    );
    await refused(
      await stack.apiAs(tokens.delegated_admin, 'POST', '/auth/organization/create-team', { name: 'From Delegate', organizationId: orgId }),
      'YOU_ARE_NOT_ALLOWED_TO_CREATE_TEAMS_IN_THIS_ORGANIZATION',
    );
    const adminTeam = await stack.apiAs(tokens.admin, 'POST', '/auth/organization/create-team', { name: 'From Admin', organizationId: orgId });
    expect(adminTeam.status, await adminTeam.clone().text()).toBe(200);

    // transfer ownership (set the creator role): the admin is refused.
    await refused(await stack.apiAs(tokens.admin, 'POST', '/auth/organization/update-member-role', {
      memberId: plainMemberRowId, role: 'owner', organizationId: orgId,
    }), 'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER');
  }, 60_000);

  it('Add Member is offered to a platform admin alone — current_user bound as the console binds it — and the door agrees', async () => {
    const servedAddMember = served.owner.get('sys_member.add_member')?.visible;
    expect(servedAddMember, 'add_member is served with a predicate').toBeDefined();

    /**
     * The console's evaluation, not this file's `user:` one: objectui hands
     * its whole scope to the engine as `extra`, ONE subject built from the
     * served session under `current_user` / `user` / `ctx.user` / `os.user`,
     * with `features` beside it — so `isPlatformAdmin` is the session's own
     * value, the rung the door's gate judges.
     */
    const consoleOffers = (session: Record<string, unknown>, own: Map<string, ServedAction>): boolean => {
      const action = own.get('sys_member.add_member');
      if (!action) throw new Error('sys_member.add_member is not served to this principal');
      expect(action.visible, 'one predicate is served to every principal').toEqual(servedAddMember);
      const subject = {
        id: session.id,
        name: session.name,
        email: session.email,
        isPlatformAdmin: session.isPlatformAdmin,
        positions: session.positions,
      };
      const result = celEngine.evaluate(action.visible as never, {
        extra: { current_user: subject, user: subject, ctx: { user: subject }, os: { user: subject }, features },
      });
      if (!result.ok) throw new Error(`sys_member.add_member faulted: ${JSON.stringify(result)}`);
      return result.value === true;
    };

    // The standing each principal's served session carries — measured, not
    // assumed: the seeded admin holds the rung, and no org grade does.
    const principals: Array<[string, Record<string, unknown>, Map<string, ServedAction>, boolean]> = [
      ['platform admin (the seeded admin)', sessionUser.owner, served.owner, true],
      ['org owner, not a platform admin', standingOwner.session, standingOwner.served, false],
      ['org admin', sessionUser.admin, served.admin, false],
      ['delegated admin', sessionUser.delegated_admin, served.delegated_admin, false],
      ['plain member', sessionUser.member, served.member, false],
    ];
    for (const [who, session, , platformAdmin] of principals) {
      expect(session.isPlatformAdmin, `${who}: the session's standing`).toBe(platformAdmin);
    }
    // The second owner really is an owner on the session face, so its hidden
    // verdict is about standing and not about a missing grade.
    expect(standingOwner.session.positions as string[]).toContain('org_owner');

    // Both halves at once, every principal named: who IS offered it, and so
    // who is not.
    const offeredTo = principals.filter(([, session, own]) => consoleOffers(session, own)).map(([who]) => who);
    expect(offeredTo).toEqual(['platform admin (the seeded admin)']);

    // The door's own verdicts on the same boot: the owner and the plain member
    // are refused before anything is written; the platform admin is admitted.
    const org2 = await ql.insert('sys_organization', { name: 'Reach Org Two', slug: 'reach-org-two' }, { context: SYSTEM_CTX });
    const attach = { userId: standingOwner.userId, role: 'member', organizationId: String(org2.id) };
    for (const [who, token] of [['org owner', standingOwner.token], ['plain member', tokens.member]] as const) {
      const res = await stack.apiAs(token, 'POST', '/auth/organization/add-member', attach);
      const body = (await res.clone().json()) as { success?: boolean; error?: { code?: string } };
      expect(res.status, `${who}: ${JSON.stringify(body)}`).toBe(403);
      expect(body.error?.code, who).toBe('PERMISSION_DENIED');
    }
    expect(await findRows(ql, 'sys_member', { user_id: standingOwner.userId, organization_id: String(org2.id) }, 5)).toEqual([]);

    const admitted = await stack.apiAs(tokens.owner, 'POST', '/auth/organization/add-member', attach);
    const admittedBody = (await admitted.clone().json()) as { success?: boolean };
    expect(admitted.status, JSON.stringify(admittedBody)).toBe(200);
    expect(admittedBody.success).toBe(true);
    const attached = await findRows(ql, 'sys_member', { user_id: standingOwner.userId, organization_id: String(org2.id) }, 5);
    expect(attached.map((m) => m.role)).toEqual(['member']);
  }, 60_000);
});
