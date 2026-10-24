// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [Ruling 6355206139, letter B, stage 1, E2] The two better-auth directory
 * doors answer an `external` caller its own member row (and its own
 * invitations) only. Driven with the after-hook context the vendor builds:
 * the response on `ctx.context.returned`, the request's `path` and `query`.
 *
 * [Stage 2, scope note 6371125645] …and list-teams, get-full-organization's
 * `teams`, and list-invitations: the teams it is on, the invitations to its
 * own email.
 */

import { describe, it, expect } from 'vitest';
import {
  GET_FULL_ORGANIZATION_PATH,
  LIST_INVITATIONS_PATH,
  LIST_MEMBERS_PATH,
  LIST_TEAMS_PATH,
  narrowDirectoryForExternalCaller,
  type ExternalDirectoryDoorDeps,
} from './external-directory-door.js';
import { isExternalMembershipRole } from './external-membership.js';

const ROLES: Record<string, string> = {
  'u_ext@org_a': 'external',
  'u_emp@org_a': 'member',
  'u_ext@org_b': 'member',
};
const EMAILS: Record<string, string> = { u_ext: 'Supplier@x.test', u_emp: 'emp@x.test' };
/** Team rosters: the external is on the portal team only. */
const TEAMS_OF: Record<string, string[]> = { u_ext: ['t_portal'], u_emp: ['t_sales', 't_portal'] };

const deps = (overrides: Partial<ExternalDirectoryDoorDeps> = {}): ExternalDirectoryDoorDeps => ({
  resolveActor: async (ctx: any) => ctx.__actor ?? null,
  readMemberRole: async (userId, organizationId) => ROLES[`${userId}@${organizationId}`],
  readUserEmail: async (userId) => EMAILS[userId],
  resolveOrganizationSlug: async (slug) => (slug === 'alpha' ? 'org_a' : undefined),
  readUserTeamIds: async (userId) => TEAMS_OF[userId] ?? [],
  isExternalRole: isExternalMembershipRole,
  ...overrides,
});

const member = (userId: string, organizationId = 'org_a') => ({
  id: `m_${userId}`,
  organizationId,
  userId,
  role: ROLES[`${userId}@${organizationId}`] ?? 'member',
  user: { id: userId, email: EMAILS[userId] ?? `${userId}@x.test`, name: userId },
});

const listMembersCtx = (userId: string, organizationId = 'org_a', query: Record<string, unknown> = {}) => ({
  path: LIST_MEMBERS_PATH,
  query,
  __actor: { userId, activeOrgId: organizationId },
  context: {
    returned: {
      members: [member('u_owner', organizationId), member('u_emp', organizationId), member('u_ext', organizationId), member('u_other', organizationId)],
      total: 4,
    },
  },
});

const fullOrgCtx = (userId: string, organizationId = 'org_a') => ({
  path: GET_FULL_ORGANIZATION_PATH,
  query: {},
  __actor: { userId, activeOrgId: organizationId },
  context: {
    returned: {
      id: organizationId,
      name: 'Alpha',
      members: [member('u_owner', organizationId), member('u_emp', organizationId), member('u_ext', organizationId)],
      invitations: [
        { id: 'i1', email: 'supplier@x.test', role: 'external' },
        { id: 'i2', email: 'new-hire@x.test', role: 'member' },
      ],
      teams: TEAMS('org_a'),
    },
  },
});

const TEAMS = (organizationId: string) => [
  { id: 't_sales', name: 'Sales', organizationId },
  { id: 't_buyers', name: 'Buyers', organizationId },
  { id: 't_portal', name: 'Supplier portal', organizationId },
];

const INVITATIONS = (organizationId: string) => [
  { id: 'i1', email: 'supplier@x.test', role: 'external', organizationId },
  { id: 'i2', email: 'new-hire@x.test', role: 'member', organizationId },
];

/** A listing door's after-hook context: the vendor answers the bare array. */
const listingCtx = (path: string, userId: string, returned: any[], query: Record<string, unknown> = {}, activeOrgId = 'org_a') => ({
  path,
  query,
  __actor: { userId, activeOrgId },
  context: { returned },
});

describe('list-members, for an external caller', () => {
  it('answers its own member row only, with a total of one', async () => {
    const ctx: any = listMembersCtx('u_ext');
    await narrowDirectoryForExternalCaller(ctx, deps());
    expect(ctx.context.returned.members.map((m: any) => m.userId)).toEqual(['u_ext']);
    expect(ctx.context.returned.total).toBe(1);
  });

  it('judges the organization the door answered for: a member elsewhere is unchanged there', async () => {
    const ctx: any = listMembersCtx('u_ext', 'org_b');
    await narrowDirectoryForExternalCaller(ctx, deps());
    expect(ctx.context.returned.members).toHaveLength(4);
    expect(ctx.context.returned.total).toBe(4);
  });

  it('a page the caller is not on still names nobody else', async () => {
    const ctx: any = listMembersCtx('u_ext', 'org_a', { organizationSlug: 'alpha' });
    ctx.context.returned.members = [];
    ctx.context.returned.total = 4;
    await narrowDirectoryForExternalCaller(ctx, deps());
    expect(ctx.context.returned).toEqual({ members: [], total: 1 });
  });

  it('CONTROL: an ordinary member reads the whole directory, untouched', async () => {
    const ctx: any = listMembersCtx('u_emp');
    const before = JSON.parse(JSON.stringify(ctx.context.returned));
    await narrowDirectoryForExternalCaller(ctx, deps());
    expect(ctx.context.returned).toEqual(before);
  });

  it('withholds the directory when the caller’s role cannot be read (fail closed)', async () => {
    const ctx: any = listMembersCtx('u_ext');
    await narrowDirectoryForExternalCaller(ctx, deps({ readMemberRole: async () => { throw new Error('driver down'); } }));
    expect(ctx.context.returned).toEqual({ members: [], total: 0 });
  });
});

describe('get-full-organization, for an external caller', () => {
  it('answers its own member row and the invitations to its own email only', async () => {
    const ctx: any = fullOrgCtx('u_ext');
    await narrowDirectoryForExternalCaller(ctx, deps());
    expect(ctx.context.returned.members.map((m: any) => m.userId)).toEqual(['u_ext']);
    expect(ctx.context.returned.invitations.map((i: any) => i.id)).toEqual(['i1']);
    expect(ctx.context.returned.name).toBe('Alpha');
  });

  it('CONTROL: an ordinary member is unchanged', async () => {
    const ctx: any = fullOrgCtx('u_emp');
    await narrowDirectoryForExternalCaller(ctx, deps());
    expect(ctx.context.returned.members).toHaveLength(3);
    expect(ctx.context.returned.invitations).toHaveLength(2);
  });
});

describe('get-full-organization teams, for an external caller', () => {
  it('answers the teams it is on, and no other team name', async () => {
    const ctx: any = fullOrgCtx('u_ext');
    await narrowDirectoryForExternalCaller(ctx, deps());
    expect(ctx.context.returned.teams.map((t: any) => t.id)).toEqual(['t_portal']);
  });

  it('CONTROL: an ordinary member reads every team', async () => {
    const ctx: any = fullOrgCtx('u_emp');
    await narrowDirectoryForExternalCaller(ctx, deps());
    expect(ctx.context.returned.teams).toHaveLength(3);
  });

  it('withholds the teams when the caller’s own team rows cannot be read', async () => {
    const ctx: any = fullOrgCtx('u_ext');
    await narrowDirectoryForExternalCaller(ctx, deps({ readUserTeamIds: async () => { throw new Error('driver down'); } }));
    expect(ctx.context.returned.teams).toEqual([]);
  });

  it('withholds members, invitations and teams when the caller’s role cannot be read', async () => {
    const ctx: any = fullOrgCtx('u_ext');
    await narrowDirectoryForExternalCaller(ctx, deps({ readMemberRole: async () => { throw new Error('driver down'); } }));
    expect(ctx.context.returned).toMatchObject({ members: [], invitations: [], teams: [] });
  });
});

describe('list-teams, for an external caller', () => {
  it('answers the teams it is on, in place', async () => {
    const answer = TEAMS('org_a');
    const ctx: any = listingCtx(LIST_TEAMS_PATH, 'u_ext', answer);
    await narrowDirectoryForExternalCaller(ctx, deps());
    expect(ctx.context.returned).toBe(answer);
    expect(answer.map((t) => t.id)).toEqual(['t_portal']);
  });

  it('judges the organization the rows name, not the session’s: a member elsewhere is unchanged there', async () => {
    const ctx: any = listingCtx(LIST_TEAMS_PATH, 'u_ext', TEAMS('org_b'), {}, 'org_a');
    await narrowDirectoryForExternalCaller(ctx, deps());
    expect(ctx.context.returned).toHaveLength(3);
  });

  it('an empty listing falls back to the queried organization, then the active one', async () => {
    const queried: any = listingCtx(LIST_TEAMS_PATH, 'u_ext', [], { organizationId: 'org_a' }, 'org_b');
    await narrowDirectoryForExternalCaller(queried, deps({ readMemberRole: async (_u, org) => { if (org !== 'org_a') throw new Error(`asked ${org}`); return 'external'; } }));
    expect(queried.context.returned).toEqual([]);
  });

  it('CONTROL: an ordinary member reads every team', async () => {
    const ctx: any = listingCtx(LIST_TEAMS_PATH, 'u_emp', TEAMS('org_a'));
    await narrowDirectoryForExternalCaller(ctx, deps());
    expect(ctx.context.returned).toHaveLength(3);
  });

  it('withholds the listing when the caller’s role cannot be read (fail closed)', async () => {
    const ctx: any = listingCtx(LIST_TEAMS_PATH, 'u_ext', TEAMS('org_a'));
    await narrowDirectoryForExternalCaller(ctx, deps({ readMemberRole: async () => { throw new Error('driver down'); } }));
    expect(ctx.context.returned).toEqual([]);
  });
});

describe('list-invitations, for an external caller', () => {
  it('answers the invitations addressed to its own email (case-insensitive), and no invitee else', async () => {
    const ctx: any = listingCtx(LIST_INVITATIONS_PATH, 'u_ext', INVITATIONS('org_a'));
    await narrowDirectoryForExternalCaller(ctx, deps());
    expect(ctx.context.returned.map((i: any) => i.id)).toEqual(['i1']);
  });

  it('answers nothing when its own email cannot be read', async () => {
    const ctx: any = listingCtx(LIST_INVITATIONS_PATH, 'u_ext', INVITATIONS('org_a'));
    await narrowDirectoryForExternalCaller(ctx, deps({ readUserEmail: async () => undefined }));
    expect(ctx.context.returned).toEqual([]);
  });

  it('CONTROL: an ordinary member reads every invitation', async () => {
    const ctx: any = listingCtx(LIST_INVITATIONS_PATH, 'u_emp', INVITATIONS('org_a'));
    await narrowDirectoryForExternalCaller(ctx, deps());
    expect(ctx.context.returned).toHaveLength(2);
  });

  it('withholds the listing when the caller’s role cannot be read (fail closed)', async () => {
    const ctx: any = listingCtx(LIST_INVITATIONS_PATH, 'u_ext', INVITATIONS('org_a'));
    await narrowDirectoryForExternalCaller(ctx, deps({ readMemberRole: async () => { throw new Error('driver down'); } }));
    expect(ctx.context.returned).toEqual([]);
  });
});

describe('every other door and answer', () => {
  it('leaves other paths, refusals and anonymous calls alone', async () => {
    const other: any = { ...listMembersCtx('u_ext'), path: '/organization/list' };
    await narrowDirectoryForExternalCaller(other, deps());
    expect(other.context.returned.members).toHaveLength(4);

    const refused: any = { path: LIST_MEMBERS_PATH, __actor: { userId: 'u_ext' }, context: { returned: new Error('FORBIDDEN') } };
    await expect(narrowDirectoryForExternalCaller(refused, deps())).resolves.toBeUndefined();
    for (const path of [LIST_TEAMS_PATH, LIST_INVITATIONS_PATH]) {
      const refusedListing: any = { path, __actor: { userId: 'u_ext' }, context: { returned: new Error('FORBIDDEN') } };
      await expect(narrowDirectoryForExternalCaller(refusedListing, deps())).resolves.toBeUndefined();
      expect(refusedListing.context.returned).toBeInstanceOf(Error);
    }

    const anonymous: any = { ...listMembersCtx('u_ext'), __actor: null };
    await narrowDirectoryForExternalCaller(anonymous, deps());
    expect(anonymous.context.returned.members).toHaveLength(4);
  });
});
