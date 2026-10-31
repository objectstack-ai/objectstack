// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Opt-in Cloudflare Turnstile on email sign-up.
 *
 * A deployment that sets BOTH {@link TURNSTILE_SITE_KEY_ENV} (the public site
 * key) and {@link TURNSTILE_SECRET_KEY_ENV} (the secret) gets better-auth's
 * `captcha` plugin with the `cloudflare-turnstile` provider, guarding exactly
 * {@link TURNSTILE_GUARDED_ENDPOINTS}. The plugin reads the widget's token from
 * the `x-captcha-response` request header and verifies it with Cloudflare
 * before the sign-up endpoint runs; a request without one is refused `400
 * MISSING_RESPONSE`, a token Cloudflare rejects `403 VERIFICATION_FAILED`, and
 * a verification that could not be completed `500 UNKNOWN_ERROR` (fail
 * closed). The per-address rate limit still runs first.
 *
 * With either variable unset (or blank) nothing is mounted and
 * `getPublicConfig()` serves no `features.turnstileSiteKey`, so the sign-up
 * door and the public config are exactly what they were before this module.
 * A half-configured deployment (one variable set) is reported once per build
 * by {@link reportHalfConfiguredTurnstile}, naming the missing variable and
 * never a value.
 *
 * Scope: sign-up only. better-auth's own default list also guards
 * `/sign-in/email` and `/request-password-reset`; it is overridden here,
 * because neither has a widget on the sign-in or reset forms, so guarding them
 * would refuse every password sign-in on a deployment that turned this on.
 *
 * The secret goes to the plugin and nowhere else: it is not served (only the
 * site key is advertised), and the plugin's own failure logging names its
 * fixed internal message and Cloudflare's error codes, not the secret
 * (`turnstile-sign-up.test.ts` pins both).
 *
 * Requests the server makes to itself through `auth.api.signUpEmail` (the
 * development admin seed, demo staff) do not pass the router's `onRequest`
 * stage the plugin hooks, so they are unaffected.
 */

/** The public Turnstile site key the Console's sign-up widget renders with. */
export const TURNSTILE_SITE_KEY_ENV = 'OS_TURNSTILE_SITE_KEY';
/** The Turnstile secret the server verifies tokens with. Never served, never logged. */
export const TURNSTILE_SECRET_KEY_ENV = 'OS_TURNSTILE_SECRET_KEY';

/** The better-auth endpoint paths (relative to the auth base path) the challenge guards. */
export const TURNSTILE_GUARDED_ENDPOINTS: readonly string[] = ['/sign-up/email'];

/** Both Turnstile keys, present only when the deployment configured both. */
export interface TurnstileKeys {
  readonly siteKey: string;
  readonly secretKey: string;
}

function readEnvValue(name: string): string | undefined {
  const env = (globalThis as any)?.process?.env as Record<string, string | undefined> | undefined;
  const raw = env?.[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The deployment's Turnstile keys, or `undefined` unless BOTH are set. The one
 * decision point the plugin mount and the public config's
 * `features.turnstileSiteKey` share, so the advertised widget can never
 * disagree with the wired check.
 */
export function resolveTurnstileKeys(): TurnstileKeys | undefined {
  const siteKey = readEnvValue(TURNSTILE_SITE_KEY_ENV);
  const secretKey = readEnvValue(TURNSTILE_SECRET_KEY_ENV);
  if (siteKey === undefined || secretKey === undefined) return undefined;
  return { siteKey, secretKey };
}

/**
 * Warn when exactly one of the two variables is set: the challenge stays off,
 * and without this line the operator who set one would not learn why. Names
 * the variables only — never a value.
 */
export function reportHalfConfiguredTurnstile(warn: (message: string) => void = console.warn): void {
  const site = readEnvValue(TURNSTILE_SITE_KEY_ENV) !== undefined;
  const secret = readEnvValue(TURNSTILE_SECRET_KEY_ENV) !== undefined;
  if (site === secret) return;
  const missing = site ? TURNSTILE_SECRET_KEY_ENV : TURNSTILE_SITE_KEY_ENV;
  const present = site ? TURNSTILE_SITE_KEY_ENV : TURNSTILE_SECRET_KEY_ENV;
  warn(
    `[AuthManager] ${present} is set but ${missing} is not, so the Turnstile challenge on sign-up is OFF. `
    + `Set both to turn it on, or unset ${present}.`,
  );
}

/** better-auth's `captcha` plugin, configured for Turnstile on {@link TURNSTILE_GUARDED_ENDPOINTS}. */
export async function buildTurnstileSignUpPlugin(keys: TurnstileKeys): Promise<unknown> {
  const { captcha } = await import('better-auth/plugins/captcha');
  return captcha({
    provider: 'cloudflare-turnstile',
    secretKey: keys.secretKey,
    endpoints: [...TURNSTILE_GUARDED_ENDPOINTS],
  });
}
