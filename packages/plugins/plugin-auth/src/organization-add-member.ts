// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /api/v1/auth/organization/add-member` — ObjectStack's admin-gated
 * mount over better-auth's SERVER-ONLY `auth.api.addMember` (#9941).
 *
 * ── Why this mount exists (the measurement) ─────────────────────────────────
 *
 * better-auth declares `addMember` WITHOUT an HTTP path — measured on the
 * installed 1.7.1, `dist/plugins/organization/routes/crud-members.mjs`:
 * `addMember` returns `createAuthEndpoint({ method: "POST", ... })` (no path
 * argument), while its siblings keep theirs
 * (`createAuthEndpoint("/organization/remove-member", …)`,
 * `"/organization/update-member-role"`). The vendor's own doc comment says so:
 * "**Server-only:** callable as `auth.api.addMember` from trusted server"
 * (`dist/plugins/organization/organization.mjs`). So the catch-all never
 * mounts it and `POST /organization/add-member` answered 404 — yet the
 * `sys_member` `add_member` toolbar action ships targeting exactly that URL,
 * and on a multi-org posture it was the ONLY remaining UI path to attach an
 * existing user to an organization (create-user's reconciler resolves no
 * target org under the org wall by design; generic `sys_member` CRUD is
 * suppressed under the ADR-0010 full lock; the invite flow needs an email
 * round-trip phone-number-only users cannot complete).
 *
 * This mount RESTORES that declared surface rather than widening it: same
 * URL the action metadata has always targeted, wrapped around the vendor's
 * own server-only endpoint — no reimplementation of its checks (already-a-
 * member, membership limit, team resolution, hooks all stay the vendor's).
 *
 * ── Authorization ───────────────────────────────────────────────────────────
 *
 * The HTTP mount in auth-plugin.ts runs the shared ADR-0068 platform-admin
 * gate (`platform-admin-gate.ts`, via the hoisted `gateAdmin`) BEFORE this
 * handler is reached — anonymous 401 `UNAUTHENTICATED`, signed-in non-admin
 * (including org owners/admins — they are NOT platform admins, ADR-0068) 403
 * `PERMISSION_DENIED`. Directly attaching a user to an organization without
 * their consent is a platform-operator action; the vendor endpoint itself
 * performs NO authorization (server-only = trusted caller), which is exactly
 * why the admit set here must stay platform-admin only.
 *
 * Ordering (ADR-0112, anonymous-first): identity error (gate, at the mount) →
 * capability error (501 when the organization plugin is off) → body
 * validation (400) → the vendor's own verdicts, forwarded verbatim.
 *
 * ── organizationId default ──────────────────────────────────────────────────
 *
 * The request headers are forwarded into `auth.api.addMember`, so an omitted
 * `organizationId` defaults to the CALLER's active organization — the
 * behaviour the `sys_member` action metadata documents ("organizationId/teamId
 * default to the caller's active org/team when omitted"). An admin with no
 * active organization gets the vendor's 400 `NO_ACTIVE_ORGANIZATION`.
 */

import { mapAuthApiError, type EndpointResult } from './admin-user-endpoints.js';

/** Minimal better-auth server-api surface this route drives. */
export interface AddMemberCapableApi {
  addMember(opts: {
    body: {
      userId: string;
      role: string | string[];
      organizationId?: string;
      teamId?: string;
    };
    headers?: Headers;
  }): Promise<Record<string, unknown> | null>;
}

export interface OrganizationAddMemberDeps {
  getAuthApi(): Promise<AddMemberCapableApi | Record<string, unknown>>;
}

const badRequest = (message: string): EndpointResult => ({
  status: 400,
  body: { success: false, error: { code: 'INVALID_REQUEST', message } },
});

async function parseJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Both spellings accepted, like the sibling mounts (`unlock-user` reads
 * `userId ?? user_id`): the `sys_member` action params send camelCase, but the
 * snake_case column names are what an operator pasting from the grid has.
 */
function readString(body: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = body[key];
    if (typeof raw === 'string' && raw.length > 0) return raw;
  }
  return undefined;
}

/** `role` is the vendor's `string | string[]` — validated, never widened. */
function readRole(body: Record<string, unknown>): string | string[] | undefined {
  const raw = body.role;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (Array.isArray(raw) && raw.length > 0 && raw.every((r) => typeof r === 'string' && r.length > 0)) {
    return raw as string[];
  }
  return undefined;
}

/**
 * `POST /api/v1/auth/organization/add-member` — the caller is already gated
 * (platform admin only; see the module header and the mount in auth-plugin.ts).
 */
export async function runOrganizationAddMember(
  deps: OrganizationAddMemberDeps,
  request: Request,
): Promise<EndpointResult> {
  // Capability before body validation (ADR-0112 ordering): without the
  // organization plugin there is no member model at all, and reporting a
  // body nit first would send the caller fixing a payload for a capability
  // the deployment does not have.
  const authApi = (await deps.getAuthApi()) as Partial<AddMemberCapableApi>;
  if (typeof authApi.addMember !== 'function') {
    return {
      status: 501,
      body: {
        success: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'The better-auth organization plugin is not enabled (auth.plugins.organization)',
        },
      },
    };
  }

  const body = await parseJson(request);
  const userId = readString(body, 'userId', 'user_id');
  if (!userId) return badRequest('userId is required');
  const role = readRole(body);
  if (!role) return badRequest('role is required (a role name, or an array of role names)');
  const organizationId = readString(body, 'organizationId', 'organization_id');
  const teamId = readString(body, 'teamId', 'team_id');

  try {
    // Headers forwarded on purpose: an omitted organizationId defaults to the
    // admin's ACTIVE organization (the action metadata's documented
    // behaviour). The vendor endpoint is server-only and does no
    // authorization of its own — the mount's platform-admin gate already ran.
    const member = await authApi.addMember({
      body: {
        userId,
        role,
        ...(organizationId ? { organizationId } : {}),
        ...(teamId ? { teamId } : {}),
      },
      headers: request.headers,
    });
    return { status: 200, body: { success: true, data: { member: member ?? null } } };
  } catch (error) {
    // The vendor's own verdicts, forwarded verbatim — NO_ACTIVE_ORGANIZATION,
    // USER_NOT_FOUND, USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION,
    // ORGANIZATION_MEMBERSHIP_LIMIT_REACHED, … (400s; limit is 403). Their
    // checks are not duplicated here: duplicated security checks are where
    // bypasses live (see adopt-membership.ts).
    return mapAuthApiError(error, 'organization/add-member failed');
  }
}
