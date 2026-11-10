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
 * ## When userinfo does not carry them (OIDC)
 *
 * For a provider with a `userInfoEndpoint`, the vendor builds `userInfo`
 * (`mapping.extraFields` included) from the userinfo response ALONE and never
 * reads the ID token's claims. Microsoft Entra ID's userinfo answer carries no
 * `groups`, which its ID token does, so every Entra ID group mapping granted
 * nothing. {@link resolveSsoGroupClaim} therefore reads the groups claim from
 * the sign-in's ID token when `userInfo` has no such member: the token the
 * vendor hands `provisionUser` (`token.idToken`) is the very string its
 * callback verified moments earlier against the provider's JWKS, issuer,
 * audience and authorized party, and whose `sub` it matched to the userinfo
 * answer's (a token that fails any of those never reaches this module: the
 * vendor redirects with a refusal first). Userinfo still wins wherever it
 * carries the member. SAML sign-ins hand no token, so they read `userInfo`
 * only.
 *
 * **Groups overage.** Above a size limit Entra ID sends no `groups` and
 * instead points at Microsoft Graph (`_claim_names` naming the groups claim,
 * with `_claim_sources`). This module makes no Graph call: such a sign-in
 * desires no group-projected set (so the grants the provider projected earlier
 * are removed, as for any sign-in without the claim), and one `warn` line per
 * provider and process names the overage and the remedy (Entra ID "groups
 * assigned to the application", or app roles).
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
  /** OIDC only: the callback's token response, its `idToken` already verified by the vendor. */
  token?: { idToken?: unknown } | null;
  provider: { providerId?: unknown; oidcConfig?: unknown };
}

/** The claim a provider's mapping names for its groups (`mapping.extraFields.groups`), if any. */
function oidcGroupsClaimName(provider: SsoProvisionUserInput['provider'] | undefined): string | undefined {
  const config = provider?.oidcConfig as { mapping?: { extraFields?: Record<string, unknown> } } | null | undefined;
  const claim = config && typeof config === 'object' ? config.mapping?.extraFields?.[SSO_GROUPS_USER_INFO_KEY] : undefined;
  return typeof claim === 'string' && claim.length > 0 ? claim : undefined;
}

/**
 * The claims of an ID token the vendor verified, decoded, or `undefined` when
 * there is none or it does not decode. No verification here: the vendor's
 * callback verified this exact string before it called `provisionUser`.
 */
function verifiedIdTokenClaims(token: SsoProvisionUserInput['token']): Record<string, unknown> | undefined {
  const idToken = token?.idToken;
  if (typeof idToken !== 'string') return undefined;
  const payload = idToken.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? (claims as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a claim set points the groups claim at a distributed source (Entra ID's groups overage). */
function namesGroupsOverage(claims: Record<string, unknown> | undefined, claim: string): boolean {
  const names = claims?._claim_names;
  return !!names && typeof names === 'object' && Object.prototype.hasOwnProperty.call(names, claim);
}

/** What one sign-in's groups read answers: the groups, and whether the IdP sent an overage pointer instead. */
export interface SsoGroupClaimReading {
  groups: string[];
  overage: boolean;
}

/**
 * The user's groups for one sign-in: `userInfo`'s member when it has one
 * (userinfo wins), otherwise the provider's groups claim from the verified ID
 * token. When neither carries the claim and either names it in `_claim_names`,
 * the reading is an overage with no groups.
 */
export function resolveSsoGroupClaim(input: Pick<SsoProvisionUserInput, 'userInfo' | 'token' | 'provider'>): SsoGroupClaimReading {
  const userInfo = input.userInfo ?? {};
  if (userInfo[SSO_GROUPS_USER_INFO_KEY] !== undefined && userInfo[SSO_GROUPS_USER_INFO_KEY] !== null) {
    return { groups: readSsoGroupClaim(userInfo), overage: false };
  }
  const claim = oidcGroupsClaimName(input.provider);
  if (!claim) return { groups: [], overage: false };
  const idClaims = verifiedIdTokenClaims(input.token);
  if (idClaims && idClaims[claim] !== undefined && idClaims[claim] !== null) {
    return { groups: readSsoGroupClaim({ [SSO_GROUPS_USER_INFO_KEY]: idClaims[claim] }), overage: false };
  }
  return { groups: [], overage: namesGroupsOverage(idClaims, claim) || namesGroupsOverage(userInfo, claim) };
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
  // Providers whose groups overage was already reported by this provisioner.
  const overageReported = new Set<string>();
  return async ({ user, userInfo, token, provider }) => {
    const providerId = typeof provider?.providerId === 'string' ? provider.providerId : '';
    const userId = typeof user?.id === 'string' ? user.id : '';
    if (!providerId || !userId) return;
    try {
      const engine = deps.getEngine();
      if (!engine) throw new Error('no data engine to read mappings or write grants through');
      const { groups, overage } = resolveSsoGroupClaim({ userInfo, token, provider });
      if (overage && !overageReported.has(providerId)) {
        overageReported.add(providerId);
        deps.warn(
          `[auth] SSO provider '${providerId}' sent a groups overage instead of the groups claim: the identity provider `
            + 'left the groups out of the token and points at Microsoft Graph for them (_claim_names / _claim_sources), '
            + 'which this server does not call. Sign-ins through this provider grant no group-mapped permission sets '
            + 'while it does. Remedy: in Microsoft Entra ID, emit only the "groups assigned to the application" (the '
            + 'app registration\'s group claims setting), or map app roles instead of groups.',
        );
      }
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
