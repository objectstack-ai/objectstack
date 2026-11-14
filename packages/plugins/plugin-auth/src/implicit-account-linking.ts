// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Implicit account linking — when an external sign-in may attach itself to a
 * pre-existing local user.
 *
 * "Implicit" linking is better-auth's behaviour on an OAuth / OIDC / SSO
 * sign-in whose identity is not yet linked to anyone but whose email matches
 * an existing local user: the library links the identity to that user and
 * signs the caller in as them. It is the opposite of an EXPLICIT link, which a
 * signed-in user starts themselves (`POST /link-social`) and which is
 * therefore authenticated by the user's own session.
 *
 * ## The rules (maintainer ruling recorded on the card: 「算漏洞，收紧」)
 *
 *  1. **Every provider meets the library's standard local-ownership
 *     requirement** before an implicit link: the existing local row must be
 *     `emailVerified: true` — the account-ownership precondition better-auth
 *     documents as the reason `requireLocalEmailVerified` defaults to `true`.
 *     A refused link writes nothing, so it also never flips the local row to
 *     verified.
 *  2. **The platform's own cloud identity provider keeps its documented
 *     exception** ({@link PLATFORM_IDP_PROVIDER_ID}). The cloud is the IdP
 *     for every environment, and the environment's owner row is seeded by the
 *     cloud itself with `emailVerified: false` (no mailbox round-trip ever
 *     runs in that IdP-mediated flow). Requiring local verification there
 *     would lock every owner out of their own environment. The exception
 *     is bound to the provider id AND the OAuth sign-in method (the cloud
 *     provider is a generic-OAuth provider): an enterprise SSO provider
 *     (`sso-oidc` / `sso-saml`) registered under the same id gets no
 *     exception.
 *  3. **A user's unlink is honoured.** After a user unlinks provider P, an
 *     implicit sign-in through P must not quietly re-create the link — that
 *     would make unlinking decorative. The unlink is recorded
 *     ({@link unlinkTombstoneIdentifier}: one row per user + provider,
 *     written before the unlink and failing it closed); implicit linking for
 *     that user + provider is refused while the record stands; an EXPLICIT,
 *     session-authenticated link-social is still allowed and clears it.
 *     This applies to every provider, the cloud one included: the cloud
 *     exception is about rule 1's verification precondition, not about
 *     overriding what the user asked for.
 *  4. **With SSO domain verification on, an SSO provider reaches an account
 *     only with an address at a domain it has proven** — the rule
 *     `sso-account-at-proven-domain.ts` states for creation, judged with that
 *     module's reading and its refusal code (`EMAIL_DOMAIN_NOT_ALLOWED`):
 *     - an implicit link through an SSO provider (`sso-oidc` / `sso-saml`)
 *       is refused unless the asserted address is at a domain the provider
 *       has proven, by equality: a subdomain counts only when it is itself
 *       listed and verified ({@link refuseImplicitAccountLink});
 *     - a sign-in through an SSO provider that would change the stored
 *       address of an account it is already linked to is refused unless the
 *       new address is at a proven domain
 *       ({@link refuseSsoAddressChangeOutsideProvenDomain}). Whether the
 *       sign-in writes the address is the vendor's own decision, read the way
 *       the vendor reads it ({@link ssoSignInWritesAddress}). A sign-in that
 *       asserts the account's own address, or whose provider does not update
 *       the account, changes nothing and is not judged.
 *     Both fail closed: a provider row that cannot be read refuses, and a
 *     write decision that cannot be read is judged as a write. Verification
 *     off, a non-SSO source and an explicit link are not judged.
 *
 * ## Why the enforcement point is `user.validateUserInfo`
 *
 * Measured against better-auth `1.7.12` (re-measured 2026-10-21 for #25096)
 * (`dist/oauth2/link-account.mjs`, `handleOAuthUserInfo`):
 *
 *  - The library's own gate refuses an implicit link when
 *    `(!trusted && !idp.emailVerified) || (requireLocalEmailVerified &&
 *    !local.emailVerified) || enabled === false || disableImplicitLinking`.
 *    `requireLocalEmailVerified` is ONE global boolean: there is no
 *    per-provider form of it, and `trustedProviders` does not relax it. So
 *    the vendor flag cannot express rule 2 — `true` locks the cloud owner
 *    out, `false` (what this platform used to ship) drops rule 1 for every
 *    provider.
 *  - Immediately after that gate, and BEFORE `internalAdapter.linkAccount`
 *    and the `emailVerified: true` flip, the same function calls
 *    `assertValidUserInfo` with `source.action: 'link-account'` and the
 *    provider id. A refusal there aborts the link (the error is an
 *    `APIError`, rethrown; the OAuth callback turns it into the error
 *    redirect). That is the narrowest seam the library offers that sees the
 *    provider id: one call site per implicit link, on every entry that links
 *    implicitly (`/callback/:id`, `/sign-in/social` with an id token,
 *    one-tap, oauth-proxy, and the SSO plugin, which share the function).
 *  - The EXPLICIT link (`/link-social` → `/callback/:id` with `link` in the
 *    OAuth state) passes the same `action: 'link-account'` (1.7.12 routes it
 *    through `linkOAuthAccount`, in the same file). It is told apart
 *    by the OAuth state the callback parsed (`getOAuthState().link`), which
 *    the server writes from the session at `/link-social`; `generateState`
 *    places `link` AFTER the client-supplied `additionalData`, so a client
 *    cannot forge it.
 *
 * So the vendor flag is pinned `false` (it would otherwise refuse the cloud
 * owner before our gate runs) and rule 1 is enforced here for everyone else.
 * ⛔ better-auth marks `requireLocalEmailVerified` deprecated, "the gate will
 * become unconditional" on its next minor. When that lands the vendor gate
 * refuses the cloud owner row on its own, and rule 2 needs a different
 * carrier (the owner seed); the cloud-exception test in
 * `implicit-account-linking.test.ts` goes red on that upgrade, on purpose.
 *
 * ## Operator override
 *
 * `config.account.accountLinking.requireLocalEmailVerified`:
 *  - unset (default) → rules 1 + 2 as above;
 *  - `true` → handed to better-auth as well: the vendor gate applies to EVERY
 *    provider, the cloud one included (the operator asked for the strict
 *    form);
 *  - `false` → rule 1 is switched off (the pre-tightening behaviour, which
 *    the library documents as a takeover risk). Rule 3 still applies.
 */

import { EMAIL_DOMAIN_NOT_ALLOWED } from './audience-posture.js';
import {
  readSsoProviderProvenDomains,
  ssoAddressAtProvenDomain,
  type SsoAccountDomainRuleDeps,
} from './sso-account-at-proven-domain.js';
import { isSsoProviderSource, ssoProviderIdOfSource } from './sso-sign-in-options.js';

/**
 * The provider id of the platform's own identity provider (cloud-as-IdP).
 * Always in `trustedProviders`, and the one provider exempt from the
 * local-verification precondition — see the module header, rule 2.
 */
export const PLATFORM_IDP_PROVIDER_ID = 'objectstack-cloud';

/**
 * The refusal code. Byte-identical to the code better-auth's own implicit-link
 * refusal produces on the OAuth callback redirect (`handleOAuthUserInfo`
 * answers `"account not linked"`, which the callback rewrites to
 * `error=account_not_linked`), so a sign-in page cannot tell the library's
 * refusal and this one apart — they ARE the same rule.
 */
export const IMPLICIT_LINK_REFUSED = 'account_not_linked';

/** The `sys_verification.identifier` namespace for unlink records. */
const UNLINK_TOMBSTONE_PREFIX = 'account-unlinked';

/**
 * The unlink record's lifetime. A record must outlive any realistic gap
 * between an unlink and the next sign-in; it ends earlier only when the user
 * re-links explicitly or the user is deleted. better-auth's verification
 * sweep deletes rows by `expiresAt`, so the value has to be finite.
 */
const UNLINK_TOMBSTONE_TTL_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/** The provider that never takes part in linking (email + password). */
const CREDENTIAL_PROVIDER_ID = 'credential';

/**
 * ONE row per user + provider. A record is only ever created or deleted,
 * never rewritten, so no write passes through a state with less protection
 * than before it: a failed create leaves every earlier record standing, and
 * two concurrent unlinks each create their own row. Every row of one user
 * shares the {@link unlinkTombstoneUserPrefix}, which is what a user's
 * deletion clears.
 */
export function unlinkTombstoneIdentifier(userId: string, providerId: string): string {
  return `${unlinkTombstoneUserPrefix(userId)}${providerId}`;
}

export function unlinkTombstoneUserPrefix(userId: string): string {
  return `${UNLINK_TOMBSTONE_PREFIX}:${userId}:`;
}

export interface ImplicitLinkInput {
  providerId: string;
  /** The `validateUserInfo` source's `method` (`oauth`, `sso-oidc`, `sso-saml`, …). */
  sourceMethod: string | undefined;
  /** The EXISTING local user row's `emailVerified`. */
  localEmailVerified: boolean;
  /** The effective local-verification requirement (default `true`). */
  requireLocalEmailVerified: boolean;
  /** Whether the user unlinked this provider and has not re-linked it explicitly. */
  unlinkedByUser: boolean;
}

export type ImplicitLinkVerdict =
  | { allow: true }
  | { allow: false; reason: 'unlinked-by-user' | 'local-email-unverified' };

/**
 * Is this the platform identity provider's own sign-in? The provider id alone
 * is not enough: the cloud provider is a generic-OAuth provider, so its
 * sign-ins carry `method: 'oauth'`; an SSO provider registered under the same
 * id carries `sso-oidc` / `sso-saml` and is not the platform IdP.
 */
export function isPlatformIdpSource(providerId: string, sourceMethod: string | undefined): boolean {
  return providerId === PLATFORM_IDP_PROVIDER_ID && sourceMethod === 'oauth';
}

/** Pure decision for one implicit link. See the module header for the rules. */
export function decideImplicitLink(input: ImplicitLinkInput): ImplicitLinkVerdict {
  if (input.unlinkedByUser) return { allow: false, reason: 'unlinked-by-user' };
  if (
    input.requireLocalEmailVerified &&
    !input.localEmailVerified &&
    !isPlatformIdpSource(input.providerId, input.sourceMethod)
  ) {
    return { allow: false, reason: 'local-email-unverified' };
  }
  return { allow: true };
}

/** The provider id a `validateUserInfo` source names, for any linking method. */
export function linkSourceProviderId(source: unknown): string | undefined {
  const s = source as { oauth?: { providerId?: unknown }; sso?: { providerId?: unknown } } | undefined;
  const id = s?.oauth?.providerId ?? s?.sso?.providerId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * The slice of better-auth's DATABASE adapter (`AuthContext.adapter`) this
 * module uses.
 *
 * The record is always a `sys_verification` row, written and read through
 * the database adapter, never through `internalAdapter.*VerificationValue`.
 * Those helpers would put it in a host's `secondaryStorage` cache, where an
 * eviction silently re-opens implicit re-linking. A host `secondaryStorage`
 * on its own would also drop the `verification` model from better-auth's
 * schema, so the auth manager sets `verification.storeInDatabase: true`
 * whenever one is configured: every verification value then stays a
 * database row (as it is with no cache, the default), and the cache only
 * fronts it.
 */
export interface LinkingDbAdapter {
  findOne(data: { model: string; where: Array<Record<string, unknown>> }): Promise<unknown | null>;
  create(data: { model: string; data: Record<string, unknown>; forceAllowId?: boolean }): Promise<unknown>;
  deleteMany(data: { model: string; where: Array<Record<string, unknown>> }): Promise<number>;
}

/** The slice of better-auth's `AuthContext` this module uses. */
export interface LinkingAuthContext {
  adapter: LinkingDbAdapter;
  internalAdapter: { findUserById(id: string): Promise<{ email?: unknown; emailVerified?: boolean } | null> };
  /** The better-auth options the instance was built with (its `plugins` list), when the context carries them. */
  options?: { plugins?: unknown };
}

/**
 * Resolves the auth context for a hook or gate call. The endpoint context
 * carries it on a request; a server-side call (`auth.api.*` without a
 * request, or an internal-adapter write) may carry none, so the caller
 * supplies a fallback read off the auth instance itself.
 */
export type LinkingContextResolver = (ctx: unknown) => Promise<LinkingAuthContext | undefined>;

export const authContextOf = (ctx: unknown): LinkingAuthContext | undefined => {
  const c = (ctx as { context?: Partial<LinkingAuthContext> } | undefined)?.context;
  return c?.adapter && c?.internalAdapter ? (c as LinkingAuthContext) : undefined;
};

const VERIFICATION_MODEL = 'verification';

async function hasUnlinkRecord(adapter: LinkingDbAdapter, userId: string, providerId: string): Promise<boolean> {
  const row = await adapter.findOne({
    model: VERIFICATION_MODEL,
    where: [{ field: 'identifier', value: unlinkTombstoneIdentifier(userId, providerId) }],
  });
  return row != null;
}

/**
 * Is the current request the callback of an EXPLICIT link (`/link-social`)
 * for THIS user? Reads the OAuth state the callback parsed; see the module
 * header for why `link` cannot be supplied by the client. The state's user
 * must also be the user the link is being written for — a state naming
 * anyone else is not an explicit link of this account.
 */
async function isExplicitLinkFlow(userId: string): Promise<boolean> {
  try {
    const { getOAuthState } = await import('better-auth/api');
    const state = (await getOAuthState()) as { link?: { userId?: unknown } } | null;
    return typeof state?.link?.userId === 'string' && state.link.userId === userId;
  } catch {
    // No request state (not inside an OAuth flow) ⇒ not an explicit link.
    return false;
  }
}

export interface ImplicitLinkGateOptions {
  requireLocalEmailVerified: boolean;
  /** What rule 4 reads: the verification switch, the provider reader and the logger. */
  provenDomain: SsoAccountDomainRuleDeps;
  resolveContext?: LinkingContextResolver;
  logInfo?: (message: string, meta?: Record<string, unknown>) => void;
}

/** Rule 4's refusal descriptions: the rule, never a domain. */
export const SSO_LINK_DOMAIN_REFUSAL_DESCRIPTION =
  'With SSO domain verification on, an identity provider links to an account only with an email address at a ' +
  'domain it has proven. The account was not linked.';
export const SSO_ADDRESS_CHANGE_DOMAIN_REFUSAL_DESCRIPTION =
  "With SSO domain verification on, an identity provider changes an account's email address only to an address " +
  'at a domain it has proven. Nothing was changed.';

/**
 * Rule 4's verdict for one SSO source and the address it asserts: `undefined`
 * when the address is at a domain the source's provider has proven, the
 * refusal otherwise, and when the provider row cannot be read.
 */
async function refuseOutsideProvenDomain(
  email: unknown,
  source: unknown,
  deps: SsoAccountDomainRuleDeps,
  reach: 'link' | 'address-change',
): Promise<{ error: string; errorDescription: string } | undefined> {
  const providerId = ssoProviderIdOfSource(source);
  const method = (source as { method?: unknown } | undefined)?.method;
  const errorDescription =
    reach === 'link' ? SSO_LINK_DOMAIN_REFUSAL_DESCRIPTION : SSO_ADDRESS_CHANGE_DOMAIN_REFUSAL_DESCRIPTION;
  const proven = await readSsoProviderProvenDomains(providerId, deps.reader);
  if (proven === null) {
    deps.logger?.warn?.('[sso] the identity provider could not be read, so the sign-in was refused', {
      providerId,
      method,
      reach,
    });
    return { error: EMAIL_DOMAIN_NOT_ALLOWED, errorDescription };
  }
  if (ssoAddressAtProvenDomain(email, proven)) return undefined;
  deps.logger?.info?.('[sso] sign-in refused: the address is not at a domain the provider has proven', {
    code: EMAIL_DOMAIN_NOT_ALLOWED,
    providerId,
    method,
    reach,
  });
  return { error: EMAIL_DOMAIN_NOT_ALLOWED, errorDescription };
}

/**
 * The `validateUserInfo` half: answers a refusal for an implicit link the
 * rules forbid, `undefined` otherwise (including for every action that is not
 * `link-account`, and for an explicit link). Throws — and better-auth's
 * `assertValidUserInfo` turns a throw into a FORBIDDEN refusal, failing closed
 * — when the store cannot answer.
 */
export async function refuseImplicitAccountLink(
  data: { user?: Record<string, unknown>; source?: { action?: string; method?: string } } | undefined,
  ctx: unknown,
  options: ImplicitLinkGateOptions,
): Promise<{ error: string; errorDescription: string } | undefined> {
  if (data?.source?.action !== 'link-account') return undefined;
  const providerId = linkSourceProviderId(data.source);
  const userId = typeof data.user?.id === 'string' ? (data.user.id as string) : undefined;
  if (userId && (await isExplicitLinkFlow(userId))) return undefined;
  if (isSsoProviderSource(data.source) && options.provenDomain.verificationEnabled()) {
    const outside = await refuseOutsideProvenDomain(data.user?.email, data.source, options.provenDomain, 'link');
    if (outside) return outside;
  }
  const auth = authContextOf(ctx) ?? (await options.resolveContext?.(ctx));
  if (!providerId || !userId || !auth) {
    throw new Error('implicit account link: provider, user or store unavailable — refusing');
  }
  const unlinked = await hasUnlinkRecord(auth.adapter, userId, providerId);
  const local = await auth.internalAdapter.findUserById(userId);
  if (!local) throw new Error('implicit account link: local user not found — refusing');
  const verdict = decideImplicitLink({
    providerId,
    sourceMethod: typeof data.source.method === 'string' ? data.source.method : undefined,
    localEmailVerified: local.emailVerified === true,
    requireLocalEmailVerified: options.requireLocalEmailVerified,
    unlinkedByUser: unlinked,
  });
  if (verdict.allow) return undefined;
  options.logInfo?.('[auth] implicit account link refused', { providerId, reason: verdict.reason });
  return {
    error: IMPLICIT_LINK_REFUSED,
    errorDescription:
      verdict.reason === 'unlinked-by-user'
        ? 'This sign-in method was unlinked from the account. Sign in another way and link it again from your account settings.'
        : 'An account with this email already exists and its email address is not verified. Sign in to that account and link this sign-in method from your account settings.',
  };
}

/** Two addresses are one when they are equal ignoring case (better-auth stores the lower-cased form). */
const sameAddress = (a: unknown, b: unknown): boolean =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/** The `@better-auth/sso` options this module reads to know whether a sign-in writes the address. */
interface SsoVendorOptions {
  resolveUser?: unknown;
  defaultSSO?: Array<{ providerId?: unknown; oidcConfig?: { overrideUserInfo?: unknown } }>;
}

/** The composed `sso` plugin's options, `undefined` when the context carries no readable plugin list. */
function ssoVendorOptions(auth: LinkingAuthContext): SsoVendorOptions | null | undefined {
  const plugins = auth.options?.plugins;
  if (!Array.isArray(plugins)) return undefined;
  const sso = plugins.find((p) => (p as { id?: unknown } | null)?.id === 'sso') as { options?: unknown } | undefined;
  if (!sso) return undefined;
  return (sso.options ?? null) as SsoVendorOptions | null;
}

/** The vendor's JSON read of a stored `oidcConfig` (`safeJsonParse`): an object as is, a string parsed. Throws on bad JSON. */
function parseOidcConfig(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>;
  return null;
}

/**
 * Whether this sign-in through an SSO provider writes the asserted address
 * onto the account it is linked to: the vendor's own decision, read from the
 * same inputs it reads. Measured against `@better-auth/sso` 1.7.12 and
 * better-auth 1.7.12 (`handleOAuthUserInfo`, linked-account branch): the
 * address is written when a `resolveUser` selection asks for a profile
 * update, otherwise when the callback hands over the provider's update flag
 * — the OIDC callback passes `oidcConfig.overrideUserInfo` of the provider it
 * resolved (a `defaultSSO` entry by id first, else the stored `ssoProvider`
 * row, parsed as above), and the SAML callback passes none. The plugin-level
 * `defaultOverrideUserInfo` is folded into that stored flag when the provider
 * is registered or updated, and is not read at sign-in.
 *
 * Fails closed, answering "writes": a `resolveUser` (its selection is made
 * after this gate), plugin options or a provider row that cannot be read, or
 * a stored config that does not parse.
 */
export async function ssoSignInWritesAddress(source: unknown, auth: LinkingAuthContext): Promise<boolean> {
  const method = (source as { method?: unknown } | undefined)?.method;
  const options = ssoVendorOptions(auth);
  if (options === undefined) return true;
  if (options?.resolveUser) return true;
  if (method === 'sso-saml') return false;
  if (method !== 'sso-oidc') return true;
  const providerId = ssoProviderIdOfSource(source);
  if (!providerId) return true;
  const preset = options?.defaultSSO?.find((p) => p?.providerId === providerId);
  if (preset) return Boolean(preset.oidcConfig?.overrideUserInfo);
  try {
    const row = (await auth.adapter.findOne({
      model: 'ssoProvider',
      where: [{ field: 'providerId', value: providerId }],
    })) as { oidcConfig?: unknown } | null;
    if (!row) return true;
    return Boolean(parseOidcConfig(row.oidcConfig)?.overrideUserInfo);
  } catch {
    return true;
  }
}

export interface SsoAddressChangeGateOptions {
  provenDomain: SsoAccountDomainRuleDeps;
  resolveContext?: LinkingContextResolver;
}

/**
 * The `validateUserInfo` half of rule 4 for a sign-in (`action: 'sign-in'`)
 * through an SSO provider into an account it is already linked to: answers
 * the refusal when the sign-in would change the account's stored address
 * ({@link ssoSignInWritesAddress}) to one that is not at a domain the
 * provider has proven, `undefined` otherwise (verification off, a non-SSO
 * source, any other action, the account's own address, a provider that does
 * not update the account). Throws, which better-auth turns into a FORBIDDEN
 * refusal, when the account cannot be read.
 */
export async function refuseSsoAddressChangeOutsideProvenDomain(
  data: { user?: Record<string, unknown>; source?: { action?: string; method?: string } } | undefined,
  ctx: unknown,
  options: SsoAddressChangeGateOptions,
): Promise<{ error: string; errorDescription: string } | undefined> {
  if (data?.source?.action !== 'sign-in' || !isSsoProviderSource(data.source)) return undefined;
  if (!options.provenDomain.verificationEnabled()) return undefined;
  const userId = typeof data.user?.id === 'string' ? (data.user.id as string) : undefined;
  const auth = authContextOf(ctx) ?? (await options.resolveContext?.(ctx));
  if (!userId || !auth) throw new Error('sso sign-in: user or store unavailable — refusing');
  const stored = await auth.internalAdapter.findUserById(userId);
  if (!stored) throw new Error('sso sign-in: account not found — refusing');
  if (sameAddress(stored.email, data.user?.email)) return undefined;
  if (!(await ssoSignInWritesAddress(data.source, auth))) return undefined;
  return refuseOutsideProvenDomain(data.user?.email, data.source, options.provenDomain, 'address-change');
}

/**
 * `account.delete.before` half: a user's own unlink (`/unlink-account`)
 * creates the provider's record BEFORE the account row is deleted. It throws
 * when the record cannot be written, and a throw from a `delete.before` hook
 * aborts the delete, so the unlink answers an error and the identity stays
 * linked — fail closed. An unlink that succeeded without its record would
 * leave the provider free to re-link implicitly while the user believes it
 * gone. A record written for a delete that then fails is harmless: the record
 * is read only when NO account for the provider is linked. Other deletions
 * (user removal, admin tooling) record nothing.
 *
 * The record is a `sys_verification` row whether or not a `secondaryStorage`
 * cache is configured (see {@link LinkingDbAdapter}).
 */
export async function recordUnlinkTombstone(
  account: unknown,
  ctx: unknown,
  resolveContext?: LinkingContextResolver,
): Promise<void> {
  const a = account as { userId?: unknown; providerId?: unknown } | null;
  const path = (ctx as { path?: unknown } | undefined)?.path;
  if (path !== '/unlink-account') return;
  if (typeof a?.userId !== 'string' || typeof a?.providerId !== 'string') return;
  if (a.providerId === CREDENTIAL_PROVIDER_ID) return;
  const auth = authContextOf(ctx) ?? (await resolveContext?.(ctx));
  if (!auth) throw new Error('unlink record: store unavailable');
  if (await hasUnlinkRecord(auth.adapter, a.userId, a.providerId)) return;
  const now = new Date();
  await auth.adapter.create({
    model: VERIFICATION_MODEL,
    data: {
      identifier: unlinkTombstoneIdentifier(a.userId, a.providerId),
      value: JSON.stringify({ userId: a.userId, providerId: a.providerId, unlinkedAt: now.toISOString() }),
      expiresAt: new Date(now.getTime() + UNLINK_TOMBSTONE_TTL_MS),
      createdAt: now,
      updatedAt: now,
    },
  });
}

/**
 * `account.create.after` half: a link that lands deletes its provider's
 * record. While the record stands an implicit link is refused, so a link that
 * lands is an explicit one (or an operator act) — exactly the "until the user
 * re-links" end the ruling sets. Only that provider's rows are touched.
 */
export async function clearUnlinkTombstone(
  account: unknown,
  ctx: unknown,
  resolveContext?: LinkingContextResolver,
): Promise<void> {
  const a = account as { userId?: unknown; providerId?: unknown } | null;
  if (typeof a?.userId !== 'string' || typeof a?.providerId !== 'string') return;
  if (a.providerId === CREDENTIAL_PROVIDER_ID) return;
  const auth = authContextOf(ctx) ?? (await resolveContext?.(ctx));
  if (!auth) throw new Error('unlink record: store unavailable');
  await auth.adapter.deleteMany({
    model: VERIFICATION_MODEL,
    where: [{ field: 'identifier', value: unlinkTombstoneIdentifier(a.userId, a.providerId) }],
  });
}

/** `user.delete.after` half: a deleted user leaves no unlink record behind. */
export async function clearUserUnlinkTombstones(
  user: unknown,
  ctx: unknown,
  resolveContext?: LinkingContextResolver,
): Promise<void> {
  const id = (user as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || id.length === 0) return;
  const auth = authContextOf(ctx) ?? (await resolveContext?.(ctx));
  if (!auth) throw new Error('unlink record: store unavailable');
  await auth.adapter.deleteMany({
    model: VERIFICATION_MODEL,
    where: [{ field: 'identifier', operator: 'starts_with', value: unlinkTombstoneUserPrefix(id) }],
  });
}
