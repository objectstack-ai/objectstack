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
 * (members and invitations emptied) rather than handed out unjudged.
 */

/** The member listing door. */
export const LIST_MEMBERS_PATH = '/organization/list-members';
/** The full-organization door. */
export const GET_FULL_ORGANIZATION_PATH = '/organization/get-full-organization';

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
  /** Is this stored role list exactly `external`? */
  isExternalRole(raw: unknown): boolean;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

const isPlainObject = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Error);

/** The organization the door answered for. */
async function answeredOrganization(ctx: any, returned: Record<string, any>, deps: ExternalDirectoryDoorDeps, activeOrgId?: string) {
  if (ctx.path === GET_FULL_ORGANIZATION_PATH) return str(returned.id);
  const fromRows = Array.isArray(returned.members) ? str(returned.members[0]?.organizationId) : undefined;
  if (fromRows) return fromRows;
  const query = ctx?.query ?? {};
  const bySlug = str(query.organizationSlug) ? await deps.resolveOrganizationSlug(query.organizationSlug) : undefined;
  return bySlug ?? str(query.organizationId) ?? activeOrgId;
}

/**
 * Narrow the response in place when the caller is an external member of the
 * organization the door answered for. No-op for every other path and caller.
 */
export async function narrowDirectoryForExternalCaller(ctx: any, deps: ExternalDirectoryDoorDeps): Promise<void> {
  if (ctx?.path !== LIST_MEMBERS_PATH && ctx?.path !== GET_FULL_ORGANIZATION_PATH) return;
  const returned = ctx?.context?.returned;
  if (!isPlainObject(returned) || !Array.isArray(returned.members)) return;

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
    returned.members = [];
    if ('total' in returned) returned.total = 0;
    if (Array.isArray(returned.invitations)) returned.invitations = [];
    return;
  }
  if (!external) return;

  returned.members = returned.members.filter((m: any) => str(m?.userId) === userId);
  // The vendor already proved the caller a member, so its directory is one row.
  if (ctx.path === LIST_MEMBERS_PATH) returned.total = 1;
  if (Array.isArray(returned.invitations)) {
    const email = (await deps.readUserEmail(userId).catch(() => undefined))?.toLowerCase();
    returned.invitations = email
      ? returned.invitations.filter((i: any) => typeof i?.email === 'string' && i.email.toLowerCase() === email)
      : [];
  }
}
