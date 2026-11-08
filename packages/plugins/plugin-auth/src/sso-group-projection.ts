// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SSO half of the identity-provider group mapping: an SSO sign-in's group
 * claim grants the ordinary permission sets its `sys_idp_group_mapping` rows
 * name (maintainer ruling A on the Enterprise SSO operator knobs, record
 * 6718355623: item 3 follows the SCIM mapping's ruled model, the same mapping
 * object, no second model).
 *
 * ## Where the groups come from
 *
 * `@better-auth/sso` (1.7.12) builds each sign-in's `userInfo` from the
 * provider's own `mapping.extraFields` (OIDC: the userinfo response or the ID
 * token; SAML: the assertion's attributes). A provider whose mapping names
 * `extraFields: { groups: CLAIM }` therefore hands this module
 * `userInfo.groups` ({@link SSO_GROUPS_USER_INFO_KEY}): a string or a list of
 * strings. No new provider setting: the claim is configured where every other
 * claim of that provider is.
 *
 * ## What a sign-in does with them
 *
 * The vendor calls `provisionUser` after the account is linked and the
 * session row exists; with `provisionUserOnEveryLogin` it does so on every
 * sign-in, not only the first, so the grants follow the IdP's groups at each
 * sign-in. Each claim value is matched against the provider's mapping rows
 * (`source_kind: 'sso'`, `source_id` = the provider id) by the SCIM half's own
 * matcher: a row naming a `group_external_id` matches a value equal to it
 * (Entra ID sends group object ids), a row naming a `group_display_name`
 * matches a value equal to that (Okta sends group names).
 *
 * The matched rows go through the SCIM half's admission and reconcile
 * (`scim-group-projection.ts`): a row that names no organization, or whose set
 * the `security` service does not show inside the organization boundary, is
 * not granted (fail closed with no security service). Every grant carries
 * {@link ssoGroupProjectionReason} for its provider, and reconcile removes only
 * rows carrying that exact marker, so a grant made by hand or by SCIM is never
 * touched. A sign-in whose claim is absent desires no set: the grants this
 * provider projected earlier are removed, nothing else is written, and a user
 * with none signs in exactly as before.
 *
 * Every write goes through the ObjectQL engine with the system context the
 * other sign-in writes carry, so the engine's own write guards judge it: the
 * break-glass last-administrator guard refuses a removal it refuses anywhere
 * else.
 *
 * ## When it fails
 *
 * A failure never fails the sign-in: the IdP has authenticated the user, and a
 * refused sign-in would turn a last-administrator guard refusal into the
 * lockout that guard exists to prevent. It is logged at `error`, once per
 * sign-in, because the user is now signed in with grants that do not follow
 * the IdP's groups while nothing looks wrong.
 */

import type { IDataEngine } from '@objectstack/core';
import {
  SSO_MAPPING_SOURCE_KIND,
  createMappingAdmission,
  mappingMatchesGroup,
  reconcileMappedGrants,
  sourceMappings,
  ssoGroupProjectionReason,
  type OrganizationBoundaryJudge,
} from './scim-group-projection.js';

/** The `userInfo` member a provider's `mapping.extraFields` fills with the user's groups. */
export const SSO_GROUPS_USER_INFO_KEY = 'groups';

export interface SsoGroupProjectionDeps {
  getEngine: () => IDataEngine | null | undefined;
  /** Resolved per call: the security plugin starts after this one. */
  boundary: () => Promise<OrganizationBoundaryJudge | undefined>;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/** What the vendor hands `provisionUser` (the members this module reads). */
export interface SsoProvisionUserInput {
  user: { id?: unknown };
  userInfo: Record<string, unknown>;
  provider: { providerId?: unknown };
}

/**
 * The user's groups from a sign-in's `userInfo`: a single string or a list of
 * strings, trimmed, blanks dropped. Anything else, or no member, is no groups.
 */
export function readSsoGroupClaim(userInfo: Record<string, unknown> | null | undefined): string[] {
  const raw = userInfo?.[SSO_GROUPS_USER_INFO_KEY];
  const values = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
  return [...new Set(values.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean))];
}

/** Build the `provisionUser` member of `sso({ … })`. */
export function createSsoGroupProvisioner(deps: SsoGroupProjectionDeps): (input: SsoProvisionUserInput) => Promise<void> {
  const admits = createMappingAdmission(deps, SSO_MAPPING_SOURCE_KIND);
  return async ({ user, userInfo, provider }) => {
    const providerId = typeof provider?.providerId === 'string' ? provider.providerId : '';
    const userId = typeof user?.id === 'string' ? user.id : '';
    if (!providerId || !userId) return;
    try {
      const engine = deps.getEngine();
      if (!engine) throw new Error('no data engine to read mappings or write grants through');
      const groups = readSsoGroupClaim(userInfo);
      const rows = await sourceMappings(engine, SSO_MAPPING_SOURCE_KIND, providerId);
      const mappingIds = rows
        .filter((row) => groups.some((group) => mappingMatchesGroup(row, { externalId: group, displayName: group })))
        .map((row) => String(row.id));
      await reconcileMappedGrants(engine, { userId, reason: ssoGroupProjectionReason(providerId), mappingIds }, admits);
    } catch (error) {
      deps.error(
        `[auth] SSO sign-in through provider '${providerId}' SUCCEEDED, but applying the provider's IdP group mappings `
          + `to user ${userId} FAILED, so their permission sets still reflect their previous sign-in and do not follow `
          + 'the identity provider\'s groups. Remedy: fix the cause; the next sign-in applies the mappings again. '
          + `Cause: ${(error as Error)?.message ?? String(error)}`,
      );
    }
  };
}
