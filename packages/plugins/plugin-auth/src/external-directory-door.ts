// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [Ruling 6355206139, letter B, stage 1, E2] better-auth's two organization
 * directory doors, narrowed for an `external` caller.
 *
 * `GET /organization/list-members` and `GET /organization/get-full-organization`
 * check MEMBERSHIP only (better-auth 1.7.12, `crud-members.mjs` `listMembers`,
 * `crud-org.mjs` `getFullOrganization`): any member reads every fellow member's
 * row, nested user (name, email, image) included, and the full organization
 * also answers every pending invitation. That is the same leak the data plane
 * closed with `external_default` (no `sys_user_org_members` scope), through a
 * second door — so a caller whose membership in THAT organization is
 * `external` gets back only its own member row, and only the invitations
 * addressed to its own email. Every other caller's answer is untouched.
 *
 * An after-hook, on the response the vendor already produced: the vendor's
 * membership check still runs first and still refuses a non-member, and a
 * narrowing that cannot run (no engine, no resolvable caller, a failed read)
 * leaves nothing wider than before — except for the one case that matters,
 * where the read of the caller's role itself fails: that answer is withheld
 * (members, invitations and teams emptied) rather than handed out unjudged.
 *
 * [Stage 2, scope note 6371125645] Two more doors, and the teams member of the
 * full organization, measured membership-only the same way (better-auth
 * 1.7.12):
 *
 *  - `GET /organization/list-teams` (`crud-team.mjs` `listOrganizationTeams`)
 *    and get-full-organization's `teams` answer every team of the
 *    organization: no member row, but the organization's internal structure,
 *    which the rung's "no member directory" hides. An external gets the teams
 *    it is itself on (`sys_team_member`), the ones `list-team-members` would
 *    already answer it.
 *  - `GET /organization/list-invitations` (`crud-invites.mjs`
 *    `listInvitations`) checks `findMemberByOrgId` and answers every
 *    invitation of the organization, invitees' emails included. An external
 *    gets the invitations addressed to its own email, the rule
 *    get-full-organization's `invitations` already follows.
 *
 * Who is external, at this door and at the resolver. The door asks
 * {@link ExternalDirectoryDoorDeps.isExternalRole}, which accepts exactly
 * `external`; the authorization resolver projects `org_external` from any role
 * list that CONTAINS `external`. The two agree on every row the engine admits,
 * because E5 (`external-membership.ts`) refuses a list carrying `external`
 * beside another role at write, on `sys_member` and `sys_invitation` alike.
 */

/** The member listing door. */
export const LIST_MEMBERS_PATH = '/organization/list-members';
/** The full-organization door. */
export const GET_FULL_ORGANIZATION_PATH = '/organization/get-full-organization';
/** The team listing door. */
export const LIST_TEAMS_PATH = '/organization/list-teams';
/** The invitation listing door. */
export const LIST_INVITATIONS_PATH = '/organization/list-invitations';

/** Every door this module narrows. */
const NARROWED_PATHS: ReadonlySet<string> = new Set([
  LIST_MEMBERS_PATH,
  GET_FULL_ORGANIZATION_PATH,
  LIST_TEAMS_PATH,
  LIST_INVITATIONS_PATH,
]);

export interface ExternalDirectoryDoorDeps {
  /** The caller, as the session resolves it. */
  resolveActor(ctx: any): Promise<{ userId: string; activeOrgId?: string } | null>;
  /**
   * The caller's stored `sys_member.role` in `organizationId` — `undefined`
   * when it holds no membership there. Throws when the read fails.
   */
  readMemberRole(userId: string, organizationId: string): Promise<string | undefined>;
  /** The caller's email, for its own invitations. */
  readUserEmail(userId: string): Promise<string | undefined>;
  /** The organization id a slug names. */
  resolveOrganizationSlug(slug: string): Promise<string | undefined>;
  /** The ids of the teams the caller is on (`sys_team_member`). Throws when the read fails. */
  readUserTeamIds(userId: string): Promise<string[]>;
  /** Is this stored role list exactly `external`? */
  isExternalRole(raw: unknown): boolean;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

const isPlainObject = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Error);

/** The organization the door answered for. */
async function answeredOrganization(ctx: any, returned: unknown, deps: ExternalDirectoryDoorDeps, activeOrgId?: string) {
  if (ctx.path === GET_FULL_ORGANIZATION_PATH) return isPlainObject(returned) ? str(returned.id) : undefined;
  // A listing names its organization on its rows; an empty one falls back to
  // the query the vendor read, then the session's active organization.
  const rows: unknown = Array.isArray(returned) ? returned : isPlainObject(returned) ? returned.members : undefined;
  const fromRows = Array.isArray(rows) ? str(rows[0]?.organizationId) : undefined;
  if (fromRows) return fromRows;
  const query = ctx?.query ?? {};
  const bySlug = str(query.organizationSlug) ? await deps.resolveOrganizationSlug(query.organizationSlug) : undefined;
  return bySlug ?? str(query.organizationId) ?? activeOrgId;
}

/** Keep, in place, only the entries `keep` admits (a listing door answers the array itself). */
function retainInPlace(list: any[], keep: (entry: any) => boolean): void {
  const kept = list.filter(keep);
  list.splice(0, list.length, ...kept);
}

/** The answer's shape, per door: an object carrying `members`, or the bare listing array. */
function answerShapeIsNarrowable(path: string, returned: unknown): boolean {
  if (path === LIST_TEAMS_PATH || path === LIST_INVITATIONS_PATH) return Array.isArray(returned);
  return isPlainObject(returned) && Array.isArray(returned.members);
}

/** Withhold everything a door answers, for a caller whose population could not be judged. */
function withholdAll(returned: any): void {
  if (Array.isArray(returned)) {
    returned.splice(0, returned.length);
    return;
  }
  returned.members = [];
  if ('total' in returned) returned.total = 0;
  if (Array.isArray(returned.invitations)) returned.invitations = [];
  if (Array.isArray(returned.teams)) returned.teams = [];
}

async function ownInvitationFilter(userId: string, deps: ExternalDirectoryDoorDeps): Promise<(i: any) => boolean> {
  const email = (await deps.readUserEmail(userId).catch(() => undefined))?.toLowerCase();
  return (i: any) => !!email && typeof i?.email === 'string' && i.email.toLowerCase() === email;
}

async function ownTeamFilter(userId: string, deps: ExternalDirectoryDoorDeps): Promise<(t: any) => boolean> {
  // A failed read keeps no team: the structure is withheld, never answered unjudged.
  const teamIds = new Set(await deps.readUserTeamIds(userId).catch(() => [] as string[]));
  return (t: any) => typeof t?.id === 'string' && teamIds.has(t.id);
}

/**
 * Narrow the response in place when the caller is an external member of the
 * organization the door answered for. No-op for every other path and caller.
 */
export async function narrowDirectoryForExternalCaller(ctx: any, deps: ExternalDirectoryDoorDeps): Promise<void> {
  if (!NARROWED_PATHS.has(ctx?.path)) return;
  const returned = ctx?.context?.returned;
  if (!answerShapeIsNarrowable(ctx.path, returned)) return;

  const actor = await deps.resolveActor(ctx).catch(() => null);
  if (!actor?.userId) return;
  const userId = actor.userId;

  let external: boolean;
  try {
    const organizationId = await answeredOrganization(ctx, returned, deps, actor.activeOrgId);
    if (!organizationId) return;
    external = deps.isExternalRole(await deps.readMemberRole(userId, organizationId));
  } catch {
    // The caller's population could not be judged: withhold the directory
    // rather than answer it unjudged (module doc).
    withholdAll(returned);
    return;
  }
  if (!external) return;

  if (ctx.path === LIST_TEAMS_PATH) {
    retainInPlace(returned, await ownTeamFilter(userId, deps));
    return;
  }
  if (ctx.path === LIST_INVITATIONS_PATH) {
    retainInPlace(returned, await ownInvitationFilter(userId, deps));
    return;
  }

  returned.members = returned.members.filter((m: any) => str(m?.userId) === userId);
  // The vendor already proved the caller a member, so its directory is one row.
  if (ctx.path === LIST_MEMBERS_PATH) returned.total = 1;
  if (Array.isArray(returned.invitations)) {
    returned.invitations = returned.invitations.filter(await ownInvitationFilter(userId, deps));
  }
  if (Array.isArray(returned.teams)) {
    returned.teams = returned.teams.filter(await ownTeamFilter(userId, deps));
  }
}
