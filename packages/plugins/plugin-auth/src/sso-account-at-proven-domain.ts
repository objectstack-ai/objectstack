// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * With SSO domain verification on, a provider creates an account only for an
 * email address at a domain it has proven.
 *
 * ## The rule
 *
 * When the environment turns domain verification on (ADR-0135 D6,
 * `AuthManager.isSsoDomainVerificationEnabled()`), a NEW account created by a
 * sign-in through an `@better-auth/sso` provider (SAML or OIDC) is admitted
 * only when the address's domain is one of the provider's verified domains:
 *
 *   - a provider's verified domains are every entry of its comma-separated
 *     `sys_sso_provider.domain`, if and only if its `domain_verified` reads on.
 *     One flag covers the whole list (the verification proves every listed
 *     domain, and editing the list clears it). Otherwise it has none;
 *   - the address's domain is everything after its last `@`. It is refused
 *     unless it is already a bare host: letters, digits, marks, `.` and `-`
 *     only, so a port, a path, a query, an escape or whitespace never reaches
 *     the comparison;
 *   - both sides are compared in one spelling, the one the provider list is
 *     parsed in ({@link providerDomains}): the bare lower-case ASCII host, a
 *     trailing root dot dropped, an internationalised name in its punycode
 *     form. Then by equality only: a subdomain counts only when it is itself
 *     listed (and verified), and a parent never counts for a listed child.
 *
 * ## Where it is judged
 *
 * At better-auth's `user.validateUserInfo` gate, for `action: 'create-user'`
 * from an SSO-provider source ({@link isSsoProviderSource}): the one place the
 * platform admits a new account, for SAML and OIDC alike. It is judged FIRST
 * and on its own: no audience posture, `allowJit`, pending invitation,
 * bootstrap carve-out or operator ticket relaxes it, and the audience gate
 * must admit as well. Other creation sources (the cloud IdP and enterprise
 * generic-OAuth providers arrive as `method: 'oauth'`) are outside it.
 *
 * Unchanged: an environment with verification off; an account that already
 * exists (a sign-in into it is not a creation, so it is not re-checked); and
 * linking, which has its own gate (`implicit-account-linking.ts`).
 *
 * ## Fail closed
 *
 * The provider row is read as the system. No engine, no row, a row for
 * another provider, a failed read, or a `domain_verified` that does not read
 * on: the provider has no verified domain, and the creation is refused. The
 * refusal is `EMAIL_DOMAIN_NOT_ALLOWED` (ADR-0112 ledger, shared with the
 * `email_domain` audience posture) with a rule-level description that names
 * no domain.
 */

import { EMAIL_DOMAIN_NOT_ALLOWED, extractEmailDomain } from './audience-posture.js';
import { SSO_PROVIDER_OBJECT } from './sso-client-secret.js';
import { providerDomains } from './sso-provider-lifecycle.js';
import {
  isSsoProviderSource,
  ssoProviderIdOfSource,
  ssoToggleStoredOn,
  type SsoProviderReader,
} from './sso-sign-in-options.js';

/** `sys_sso_provider` column holding the provider's comma-separated email domains. */
const SSO_DOMAIN_FIELD = 'domain';
/** `sys_sso_provider` column holding the provider's domain-verification flag (ADR-0135 D6). */
const SSO_DOMAIN_VERIFIED_FIELD = 'domain_verified';

/** The refusal's description: the rule, never a domain. */
export const SSO_ACCOUNT_DOMAIN_REFUSAL_DESCRIPTION =
  'With SSO domain verification on, an identity provider creates an account only for an email address at a ' +
  'domain it has proven. Nothing was created.';

/**
 * An address's domain part, when it is already a bare host: one or more
 * letters, marks, digits, `.` or `-`. One character class, no backtracking.
 */
const BARE_HOST_CHARS = /^[\p{L}\p{M}\p{N}.-]+$/u;

/**
 * The address's domain in the one spelling the provider list is compared in,
 * or `null` when the address has none or its domain part is not already a
 * bare host (empty, or holding a port, a path, a query, an escape, a comma or
 * whitespace). `Bob@ACME.com.` and `bob@acme.com` are one domain; so are
 * `bücher.de` and `xn--bcher-kva.de`.
 */
export function ssoAddressDomain(email: unknown): string | null {
  const domain = extractEmailDomain(email);
  if (!domain || !BARE_HOST_CHARS.test(domain)) return null;
  // No comma can reach here, so the provider-list parse yields one entry at most.
  const [spelled] = providerDomains(domain);
  return spelled ? spelled : null;
}

/**
 * The domains a provider row has proven: every parsed entry of its `domain`
 * when `domain_verified` reads on (`1` / `true`), otherwise none. A row that
 * is not the provider's own (another `provider_id`) has proven nothing.
 */
export function ssoProviderProvenDomains(row: unknown, providerId: string): string[] {
  if (!row || typeof row !== 'object' || !providerId) return [];
  const record = row as Record<string, unknown>;
  if (record.provider_id !== providerId) return [];
  if (!ssoToggleStoredOn(record[SSO_DOMAIN_VERIFIED_FIELD])) return [];
  return providerDomains(record[SSO_DOMAIN_FIELD]);
}

/** Whether `email` is at one of `provenDomains`, compared in one spelling, by equality. */
export function ssoAddressAtProvenDomain(email: unknown, provenDomains: readonly string[]): boolean {
  const domain = ssoAddressDomain(email);
  return domain !== null && provenDomains.includes(domain);
}

/** What the rule reads, handed in by the `validateUserInfo` wiring. */
export interface SsoAccountDomainRuleDeps {
  /** `AuthManager.isSsoDomainVerificationEnabled()`, asked at call time. */
  verificationEnabled: () => boolean;
  /** A system-context reader of `sys_sso_provider`, or `undefined` when the host has no data engine. */
  reader: SsoProviderReader | undefined;
  /** Where a refusal, and a provider row that could not be read, is reported. */
  logger?: {
    info?: (message: string, meta?: Record<string, unknown>) => void;
    warn?: (message: string, meta?: Record<string, unknown>) => void;
  };
}

/** The verdict of {@link refuseSsoAccountOutsideProvenDomain}: `undefined` admits. */
export type SsoAccountDomainRefusal = { error: string; errorDescription: string } | undefined;

const refusal = (): { error: string; errorDescription: string } => ({
  error: EMAIL_DOMAIN_NOT_ALLOWED,
  errorDescription: SSO_ACCOUNT_DOMAIN_REFUSAL_DESCRIPTION,
});

/**
 * The `validateUserInfo` judge of the module rule. Answers `undefined` for
 * every call it does not judge (verification off, not a creation, not an SSO
 * provider source) and for an admitted creation; the refusal otherwise.
 * Never throws: an unreadable provider row refuses.
 */
export async function refuseSsoAccountOutsideProvenDomain(
  data: { user?: Record<string, unknown>; source?: unknown } | undefined,
  deps: SsoAccountDomainRuleDeps,
): Promise<SsoAccountDomainRefusal> {
  const source = data?.source as { action?: unknown; method?: unknown } | undefined;
  if (source?.action !== 'create-user' || !isSsoProviderSource(source)) return undefined;
  if (!deps.verificationEnabled()) return undefined;

  const providerId = ssoProviderIdOfSource(source);
  const method = source.method;
  let proven: string[] = [];
  if (deps.reader && typeof deps.reader.find === 'function' && providerId) {
    try {
      const rows = await deps.reader.find(SSO_PROVIDER_OBJECT, { where: { provider_id: providerId }, limit: 1 });
      proven = ssoProviderProvenDomains(Array.isArray(rows) ? rows[0] : undefined, providerId);
    } catch {
      deps.logger?.warn?.(
        '[sso] the identity provider could not be read, so the account it asked for was not created',
        { providerId, method },
      );
      return refusal();
    }
  }

  if (ssoAddressAtProvenDomain(data?.user?.email, proven)) return undefined;
  deps.logger?.info?.('[sso] account creation refused: the address is not at a domain the provider has proven', {
    code: EMAIL_DOMAIN_NOT_ALLOWED,
    providerId,
    method,
  });
  return refusal();
}
