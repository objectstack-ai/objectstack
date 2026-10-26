// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user's language preference (`sys_user.locale`) → the standard OIDC
 * `locale` claim (OIDC Core §5.1, a BCP-47 tag) at the platform OP's
 * `/oauth2/userinfo`.
 *
 * This is the producer half of `idp-locale-claim.ts`: an environment that
 * signs in through an ObjectStack OP — a hosted environment through the cloud
 * — reads `locale` off the userinfo body (`source.oauth.profile`) and JIT-sets
 * its own user's language from it. Every ObjectStack OP emits the claim; no
 * host configuration switches it.
 *
 * ## The rule
 *
 *  - Only when the access token's scopes include `profile`, the scope OIDC
 *    Core §5.4 puts `locale` under. Without it the column is not read.
 *  - Only a value the platform's one reader of the column accepts
 *    (`normalizeRecipientLocale`: a non-empty BCP-47-shaped tag, never the
 *    stringified-nothing literals). Anything else is no claim.
 *  - Userinfo only. `@better-auth/oauth-provider` keeps the standard profile
 *    claims out of the ID token, and the platform RP reads userinfo.
 *
 * `locale` is not a better-auth `additionalField`, so the user the provider
 * hands its claims hook does not carry it: the column is read through the
 * data engine, in system context — the user's own language must resolve
 * whoever the requesting client is.
 *
 * A read that fails never fails userinfo. The claim is omitted, which is a
 * functional degradation — the signing-in environment shows its deployment
 * default, visibly — so it is reported at `warn`.
 */

import type { IDataEngine } from '@objectstack/core';
import { RECIPIENT_LOCALE_FIELD, normalizeRecipientLocale } from '@objectstack/service-messaging';

/** The scope `locale` is requested under (OIDC Core §5.4). */
const LOCALE_SCOPE = 'profile';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

export interface UserInfoLocaleClaimDeps {
  getEngine: () => IDataEngine | undefined;
  warn: (message: string, meta?: Record<string, unknown>) => void;
}

/** What `customUserInfoClaims` is handed that this rule reads. */
export interface UserInfoLocaleClaimInput {
  user: { id?: unknown };
  scopes: readonly string[];
}

/** `{ locale }` when the rule (module header) holds, otherwise `{}`. */
export async function userInfoLocaleClaim(
  deps: UserInfoLocaleClaimDeps,
  { user, scopes }: UserInfoLocaleClaimInput,
): Promise<{ locale?: string }> {
  if (!scopes.includes(LOCALE_SCOPE)) return {};
  const userId = typeof user.id === 'string' && user.id ? user.id : undefined;
  const engine = deps.getEngine();
  if (!userId || !engine) return {};
  let row: Record<string, unknown> | null | undefined;
  try {
    row = (await engine.findOne('sys_user', {
      where: { id: userId },
      fields: [RECIPIENT_LOCALE_FIELD],
      context: SYSTEM_CTX,
    } as never)) as Record<string, unknown> | null | undefined;
  } catch (error) {
    deps.warn(
      '[AuthManager] userinfo: the user\'s language preference could not be read, so the `locale` claim is omitted ' +
        'and the signing-in application shows its default language',
      { userId, error: error instanceof Error ? error.message : String(error) },
    );
    return {};
  }
  const locale = normalizeRecipientLocale(row?.[RECIPIENT_LOCALE_FIELD]);
  return locale ? { locale } : {};
}
