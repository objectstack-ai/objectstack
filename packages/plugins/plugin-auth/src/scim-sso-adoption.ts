// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32148] SCIM adopts an account that SSO just-in-time provisioning already
 * created — under three ruled conditions, and never on an email match alone.
 * PACKAGE-INTERNAL: like `scim-identity-source.ts`, not re-exported from
 * `index.ts`.
 *
 * ## The gap
 *
 * "Turn on SSO first, add SCIM later" is the usual rollout. A person who signed
 * in through the organization's SSO provider before SCIM was turned on has an
 * account (`sys_user` + a `sys_account` naming the provider). The directory's
 * provisioning cycle then looks the user up (`GET /Users?filter=userName eq`
 * reads only the connection's own SCIM resources, so it finds nothing) and
 * creates it, and the create collided with the account's email: 409. Entra ID
 * and Okta mark the user failed, so a later deactivation never reaches the
 * account — the leaver lifecycle missed everyone who signed in first.
 *
 * ## The seam
 *
 * `@better-auth/scim`'s `identity.resolveUser` host callback. `POST /Users`
 * asks it, before its transaction, whether the incoming user is a new account
 * (`create`) or an existing one (`link`, with the account id); on `link` the
 * vendor writes the SCIM resource against that account inside its transaction,
 * and every later PATCH, PUT and DELETE reaches the account through the
 * `identity.reconcileUser` host callback as for any SCIM-created user. The
 * vendor's own contract on the callback: "Returning `link` must not be based
 * on an unverified email match." The lookup door has no such seam and needs
 * none: once the create links, the lookup finds the new resource.
 *
 * ## The rule (ruling A on the card, triage record 6810486663)
 *
 * `link` only when every part holds; otherwise `create`, which collides and
 * answers 409 exactly as before (the vendor's uniqueness check, translated by
 * `scim-conflict-detail.ts`). In the order the judge asks:
 *
 *  1. **Directory-managed.** The account reads `sys_user.source =
 *     'idp_provisioned'` and holds no local password — ADR-0135 D4's own
 *     reading of a directory-managed identity, the same two facts
 *     `markDirectoryProvisionedUsers` keys on. A password holder is refused
 *     even where a lost stamp left it reading `idp_provisioned`.
 *  2. **Not held by a SCIM directory.** No `sys_scim_subject` row for the
 *     account. The vendor creates one for every user a SCIM connection
 *     provisions or links, and never deletes it. ⛔ An account a directory
 *     already holds is never adopted by a second one: the vendor aggregates
 *     `active` across every source, so a second directory could keep a leaver
 *     the first one deactivated signed in.
 *  3. **Linked to an SSO provider of the connection's organization.** One of
 *     the account's `sys_account` rows names a `sys_sso_provider` whose
 *     `organization_id` is the organization of the credential that
 *     authenticated this request (`sys_scim_connection_credential
 *     .organization_id`, carried on the request's SCIM scope). Both absent is
 *     one environment-wide boundary (a composition without organizations,
 *     ADR-0134 D3's V1 single-organization mode); one absent is a refusal.
 *  4. **On that provider's verified domain.** That provider reads
 *     `domain_verified` (ADR-0135 D6), and the account's email domain is
 *     exactly one of its `domain` entries — a comma list, case-folded. No
 *     subdomain match: the ruling names the verified domain itself.
 *
 * ## Why `idp_provisioned` alone proves nothing here
 *
 * The mark is not "SSO JIT made it". A social sign-in (`google`, …) stamps it,
 * and since ADR-0135 D4's SCIM writer every SCIM-provisioned user reads it
 * from its create. Conditions 2–4 carry the boundary: a SCIM-only user has no
 * `sys_account` row at all (the vendor writes none) and fails 3; a social
 * provider is no `sys_sso_provider` row and fails 3; a SCIM user who also
 * signed in through SSO owns a subject and fails 2.
 *
 * ## What the link writes
 *
 * `profile: 'manage'`: the directory manages the adopted profile from now on,
 * exactly as it manages one it created, and the vendor's profile claim refuses
 * inside its transaction when another SCIM source took the profile between
 * this read and that write.
 */

import { isMissingTableError } from '@objectstack/types';
import type { SCIMIdentityResolution, SCIMIdentityResolutionInput } from '@better-auth/scim';
import { DIRECTORY_MANAGED_SOURCE } from './scim-identity-source.js';

/** The engine surface the judge reads with — satisfied by `IDataEngine`. */
export interface ScimSsoAdoptionEngine {
  find(objectName: string, query?: Record<string, unknown>): Promise<unknown[]>;
}

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The local-password issuer better-auth writes on `sys_account.provider_id`. */
const LOCAL_PASSWORD_PROVIDER = 'credential';

/** Why an existing account is not adopted. Each is one condition of the rule failing. */
export type ScimSsoAdoptionRefusal =
  | 'not_directory_managed'
  | 'holds_local_password'
  | 'held_by_scim'
  | 'no_sso_link'
  | 'no_provider_of_organization'
  | 'domain_not_verified'
  | 'email_domain_not_verified';

export type ScimSsoAdoptionVerdict =
  /** No account holds the address: the create makes a new one. */
  | { adopt: false; reason: 'no_account' }
  | { adopt: false; reason: ScimSsoAdoptionRefusal }
  | { adopt: true; userId: string; providerId: string };

export interface ScimSsoAdoptionQuestion {
  /** The incoming user's primary email — the address the create would collide on. */
  email: string;
  /** The organization of the credential that authenticated the request; absent when it names none. */
  organizationId?: string;
}

/** An organization id as the comparison reads it: a non-empty string, or one shared "none". */
const organizationKey = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** sqlite answers a boolean as 0/1; anything but true is not verified. */
const isTrue = (value: unknown): boolean => value === true || value === 1;

/** The domain of an address, case-folded — `undefined` for anything that is not exactly one `@`. */
function emailDomain(email: string): string | undefined {
  const parts = email.trim().toLowerCase().split('@');
  return parts.length === 2 && parts[0] !== '' && parts[1] !== '' ? parts[1] : undefined;
}

/** A provider's `domain` as the email domains it names: a comma list, trimmed and case-folded. */
function providerDomains(domain: unknown): string[] {
  if (typeof domain !== 'string') return [];
  return domain
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
}

/**
 * Judge whether the account holding `question.email` is adopted, per the
 * module rule. Reads only, as the system. A read failure propagates — on the
 * SCIM path the vendor answers it as a SCIM 500 and creates nothing — except a
 * missing `sys_sso_provider` table, which means no SSO provider exists.
 */
export async function judgeScimSsoAdoption(
  engine: ScimSsoAdoptionEngine,
  question: ScimSsoAdoptionQuestion,
): Promise<ScimSsoAdoptionVerdict> {
  const email = question.email.trim().toLowerCase();
  const domain = emailDomain(email);
  const users = (await engine.find('sys_user', {
    where: { email },
    fields: ['id', 'email', 'source'],
    limit: 2,
    context: SYSTEM_CTX,
  })) as Array<{ id?: unknown; email?: unknown; source?: unknown }>;
  if (users.length === 0) return { adopt: false, reason: 'no_account' };
  // Email is unique on `sys_user`; two rows is a store this rule does not judge.
  if (users.length > 1) return { adopt: false, reason: 'not_directory_managed' };
  const user = users[0];
  const userId = String(user.id);

  // 1. Directory-managed: the mark, and no local password.
  if (user.source !== DIRECTORY_MANAGED_SOURCE) return { adopt: false, reason: 'not_directory_managed' };
  const accounts = (await engine.find('sys_account', {
    where: { user_id: userId },
    fields: ['provider_id'],
    context: SYSTEM_CTX,
  })) as Array<{ provider_id?: unknown }>;
  const linkedProviderIds = [
    ...new Set(accounts.map((row) => row.provider_id).filter((id): id is string => typeof id === 'string' && id !== '')),
  ];
  if (linkedProviderIds.includes(LOCAL_PASSWORD_PROVIDER)) return { adopt: false, reason: 'holds_local_password' };

  // 2. Not held by a SCIM directory.
  const subjects = await engine.find('sys_scim_subject', {
    where: { user_id: userId },
    fields: ['id'],
    limit: 1,
    context: SYSTEM_CTX,
  });
  if (subjects.length > 0) return { adopt: false, reason: 'held_by_scim' };

  // 3. Linked to an SSO provider of the connection's organization.
  const federated = linkedProviderIds.filter((id) => id !== LOCAL_PASSWORD_PROVIDER);
  let providers: Array<{ provider_id?: unknown; organization_id?: unknown; domain?: unknown; domain_verified?: unknown }> = [];
  if (federated.length > 0) {
    try {
      providers = (await engine.find('sys_sso_provider', {
        where: { provider_id: { $in: federated } },
        fields: ['provider_id', 'organization_id', 'domain', 'domain_verified'],
        context: SYSTEM_CTX,
      })) as typeof providers;
    } catch (e) {
      if (!isMissingTableError(e, 'sys_sso_provider')) throw e;
    }
  }
  if (providers.length === 0) return { adopt: false, reason: 'no_sso_link' };
  const organization = organizationKey(question.organizationId);
  const ofOrganization = providers.filter((p) => organizationKey(p.organization_id) === organization);
  if (ofOrganization.length === 0) return { adopt: false, reason: 'no_provider_of_organization' };

  // 4. On that provider's verified domain.
  const verified = ofOrganization.filter((p) => isTrue(p.domain_verified));
  if (verified.length === 0) return { adopt: false, reason: 'domain_not_verified' };
  const vouching = domain === undefined ? undefined : verified.find((p) => providerDomains(p.domain).includes(domain));
  if (!vouching) return { adopt: false, reason: 'email_domain_not_verified' };

  return { adopt: true, userId, providerId: String(vouching.provider_id) };
}

/** What the resolver reads off the SCIM request it runs in. */
export interface ScimAdoptionRequestConnection {
  connectionId?: string;
  organizationId?: string;
}

export interface ScimSsoAdoptionResolverDeps {
  getEngine: () => ScimSsoAdoptionEngine | undefined;
  /** The request's SCIM scope, filled by the bearer verifier — `undefined` outside a SCIM request. */
  readConnection: () => ScimAdoptionRequestConnection | undefined;
}

/**
 * The `identity.resolveUser` callback `@better-auth/scim` is mounted with.
 * `create` whenever the request cannot say which organization its connection
 * belongs to (no SCIM scope, or a scope naming another connection): the rule
 * cannot be judged, so nothing is adopted.
 */
export function createScimSsoAdoptionResolver(
  deps: ScimSsoAdoptionResolverDeps,
): (input: SCIMIdentityResolutionInput) => Promise<SCIMIdentityResolution> {
  return async (input) => {
    const engine = deps.getEngine();
    const connection = deps.readConnection();
    if (!engine || !connection || connection.connectionId !== input.connectionId) return { action: 'create' };
    const verdict = await judgeScimSsoAdoption(engine, {
      email: input.resource.primaryEmail,
      ...(connection.organizationId ? { organizationId: connection.organizationId } : {}),
    });
    return verdict.adopt ? { action: 'link', userId: verdict.userId, profile: 'manage' } : { action: 'create' };
  };
}
