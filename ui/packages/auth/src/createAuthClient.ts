/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createAuthClient as createBetterAuthClient, parseJSON } from 'better-auth/client';
import { organizationClient, twoFactorClient } from 'better-auth/client/plugins';
import type {
  AuthClient, AuthClientConfig, AuthUser, AuthClientSession, SignInCredentials, SignUpData,
  AuthOrganization, AuthOrganizationMember, AuthInvitation, AuthPublicConfig, SignInWithProviderOptions,
} from './types.js';
import { AUTH_INVITATION_STATUSES, isAuthInvitationStatus } from './invitation-status.js';

const TOKEN_STORAGE_KEY = 'auth-session-token';

/**
 * Simple token storage backed by localStorage.
 * Falls back to in-memory storage when localStorage is unavailable (SSR, tests).
 *
 * ## Rotation notifications (objectui#4467)
 *
 * `subscribeRotation` fires when a token WE ALREADY HELD is replaced by a
 * different one — i.e. the server rotated the session under a request nobody
 * was watching. That is the only case with no owner: sign-in, sign-up and
 * sign-out all set/clear this storage from `AuthProvider`, which updates its
 * own identity state in the same breath, so those transitions deliberately
 * stay silent (first store: no notify; `clear()`: no notify; re-storing the
 * same value, as `getSession` does on every boot: no notify).
 *
 * A rotation with no owner is exactly what impersonation produces — the
 * console POSTs `/auth/admin/impersonate-user` through a generic metadata
 * action, the server hands back a NEW session token in `set-auth-token`, and
 * nothing in that code path knows the identity just changed. See
 * `AuthProvider`'s subscription and `__tests__/impersonation-lane-4467.test.tsx`.
 */
export const TokenStorage = {
  _memoryToken: null as string | null,
  _rotationListeners: new Set<() => void>(),

  get(): string | null {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(TOKEN_STORAGE_KEY);
      }
    } catch { /* SSR / test */ }
    return this._memoryToken;
  },

  set(token: string): void {
    const previous = this.get();
    this._memoryToken = token;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      }
    } catch { /* SSR / test */ }
    // Rotation = a token we were already using got replaced. See the header.
    if (previous && previous !== token) {
      for (const listener of [...this._rotationListeners]) {
        try {
          listener();
        } catch { /* a listener must never break the write that triggered it */ }
      }
    }
  },

  clear(): void {
    this._memoryToken = null;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch { /* SSR / test */ }
  },

  /**
   * Observe session-token ROTATIONS (see the header for what does and does not
   * count as one). Returns an unsubscribe function.
   */
  subscribeRotation(listener: () => void): () => void {
    this._rotationListeners.add(listener);
    return () => {
      this._rotationListeners.delete(listener);
    };
  },
};

/**
 * Better-auth client error shape: a human message plus an HTTP status and an
 * optional machine-readable `code` (e.g. `INVALID_EMAIL_OR_PASSWORD`).
 */
interface BetterAuthErrorLike {
  message?: string;
  status?: number;
  code?: string;
}

/**
 * Build an `Error` from a better-auth client error, preserving the machine
 * `code` on the thrown Error so callers (LoginForm/RegisterForm, and every
 * organization screen) can map it to a localized message instead of surfacing
 * the raw English server text. Falls back to the server message, then
 * `fallbackMessage`, then the HTTP status.
 *
 * ## Why every organization route now comes through here (objectui#4474)
 *
 * This helper existed for sign-in/sign-up only. Every `organization.*` method
 * below threw `new Error(error.message ?? '…')` directly and therefore **dropped
 * `code` at the boundary** — so a console screen holding the rejection had the
 * English sentence and nothing else to key on. That is what forced the
 * organization UI to echo better-auth's English verbatim in a zh session: the
 * only remaining way to localize it would have been matching the English text,
 * which binds the console to a third party's copy-editing and breaks silently
 * the day they reword a sentence.
 *
 * The repair belongs HERE rather than at the console call sites: the code is
 * produced at this boundary, and a consumer cannot recover information the
 * producer discarded. `message` is unchanged for every caller — this only stops
 * throwing away the half of the pair that was already being computed.
 * `packages/auth/src/__tests__/org-error-code-4474.test.ts` pins both halves.
 */
function toAuthError(
  error: BetterAuthErrorLike,
  fallbackMessage?: string,
): Error & { code?: string } {
  const err = new Error(
    error.message ?? fallbackMessage ?? `Auth request failed with status ${error.status}`,
  ) as Error & { code?: string };
  if (error.code) err.code = error.code;
  return err;
}

/**
 * The wire boundary for invitations (objectui#3879).
 *
 * better-auth's client hands these routes back as `any`, so `as AuthInvitation`
 * was a claim nothing checked — and with `status` narrowed to a closed union,
 * an unchecked cast would make that union a comment again the day a backend
 * stored a fifth value. This is the ONE place the claim is verified.
 *
 * It fails LOUDLY, naming the offending value, rather than degrading: a status
 * outside better-auth's own `InvitationStatus` is a producer defect, and the
 * alternatives all hide it — a neutral badge label renders it as UI copy in ten
 * packs (the objectui#3879 symptom), and dropping the row deletes an invitation
 * from an administrative ledger without saying so. Both call paths already
 * render a rejection with a retry (`InvitationsPage`, `AcceptInvitationPage`),
 * so the throw lands on a designed surface; `resolveOrgErrorMessage` shows the
 * sentence verbatim, which is that module's own stated preference over
 * swallowing an error.
 */
function asAuthInvitation(raw: unknown, method: string): AuthInvitation {
  const status = (raw as { status?: unknown } | null | undefined)?.status;
  if (!isAuthInvitationStatus(status)) {
    throw new Error(
      `${method}: unexpected invitation status ${JSON.stringify(status)} — ` +
        `expected one of ${AUTH_INVITATION_STATUSES.join(' | ')}`,
    );
  }
  return raw as AuthInvitation;
}

/** Same boundary, per row, for the list-returning invitation routes. */
function asAuthInvitations(raw: unknown, method: string): AuthInvitation[] {
  const rows = Array.isArray(raw) ? (raw as unknown[]) : [];
  return rows.map((row) => asAuthInvitation(row, method));
}

/**
 * Resolve a baseURL (which may be relative or absolute) into the
 * `{ origin, basePath }` pair required by the better-auth client.
 *
 * - Absolute URLs (e.g. `http://localhost:3000/api/auth`) are split into origin + pathname.
 * - Relative paths (e.g. `/api/v1/auth`) use `window.location.origin` in
 *   browser environments, falling back to `http://localhost` elsewhere.
 */
function resolveAuthURL(baseURL: string): { origin: string; basePath: string } {
  try {
    const url = new URL(baseURL);
    return { origin: url.origin, basePath: url.pathname.replace(/\/$/, '') };
  } catch {
    // Relative URL – resolve against the current origin when available
    const origin = getWindowOrigin() ?? 'http://localhost';
    return { origin, basePath: baseURL.replace(/\/$/, '') };
  }
}

/** Safely read window.location.origin when available (browser environments). */
function getWindowOrigin(): string | undefined {
  try {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
  } catch {
    // window may be defined but accessing location can throw in some SSR environments
  }
  return undefined;
}

/**
 * Resolve the redirect URL appended to password-reset emails as
 * `?callbackURL=<value>`. better-auth sends users to `<value>?token=…`
 * after verifying the token, so the value must point at the SPA's
 * `/reset-password` route — including the SPA basename when mounted
 * under a subpath (e.g. `/_console/reset-password`).
 *
 * Resolution order:
 *   1. `<base href="…">` in the document head (matches how Console &
 *      Account derive React Router's basename) — preferred since it
 *      tracks whatever path the host SPA is served from.
 *   2. `'/reset-password'` — sensible default for a SPA at the origin root.
 */
function resolveResetPasswordRedirect(): string {
  try {
    if (typeof document !== 'undefined') {
      const baseEl = document.querySelector('base');
      const href = baseEl?.getAttribute('href');
      if (href) {
        const url = new URL(href, getWindowOrigin() ?? 'http://localhost');
        const path = url.pathname.replace(/\/$/, '');
        return `${path}/reset-password`;
      }
    }
  } catch {
    // ignore — fall through to default
  }
  return '/reset-password';
}

/**
 * The slot the console's pre-React auth preflight (`apps/console/src/lib/
 * auth-preflight.ts`) leaves its `get-session` answer in when the stored Bearer
 * was valid: the auth URL it asked, the token it sent and the body as JSON text. The
 * preflight runs before any bundle chunk that could import this package, so the
 * slot is spelled by hand on both sides; the console's
 * `sessionBootDedup.test.tsx` runs the preflight against this reader.
 */
const PREFLIGHT_SESSION_KEY = Symbol.for('objectui.authPreflightSession');

interface PreflightSessionSlot {
  authUrl: string;
  token: string;
  body: string;
  taken?: boolean;
}

/**
 * Take the preflight's `get-session` answer, once per page load (objectui#12808).
 *
 * Returns it only when it answers what the caller would ask: the same auth URL,
 * and the Bearer still stored is the one the preflight validated (the server
 * prefers the Bearer, so the cookie the preflight omitted cannot change the
 * answer). Parsed exactly as `getSession()` parses the wire body, with the same
 * token sync. Anything else, or a second call, returns `null` and the caller asks
 * the server as before.
 */
export function takePreflightSession(
  authUrl: string,
): { user: AuthUser; session: AuthClientSession } | null {
  const holder = globalThis as unknown as Record<symbol, PreflightSessionSlot | undefined>;
  const slot = holder[PREFLIGHT_SESSION_KEY];
  if (!slot || slot.taken) return null;
  slot.taken = true;
  if (slot.authUrl !== authUrl || slot.token !== TokenStorage.get()) return null;
  type Payload = { user?: AuthUser; session?: AuthClientSession } | null;
  let payload: Payload;
  try {
    payload = parseJSON(slot.body, { strict: false }) as Payload;
  } catch {
    return null;
  }
  if (!payload?.user || !payload.session) return null;
  if (payload.session.token) TokenStorage.set(payload.session.token);
  return { user: payload.user, session: payload.session };
}

/**
 * Create a fetch wrapper that injects Bearer token from localStorage
 * and captures updated tokens from the `set-auth-token` response header
 * (provided by better-auth's server-side bearer plugin).
 */
function createBearerFetch(baseFetch?: typeof fetch): typeof fetch {
  const fetchImpl = baseFetch || globalThis.fetch.bind(globalThis);
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const token = TokenStorage.get();
    // Only inject Bearer token for API paths to avoid triggering CORS preflight
    // on public endpoints like /.well-known/objectstack
    if (token) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/api\//i.test(url)) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }
    const response = await fetchImpl(input, { ...init, headers });
    // Capture rotated tokens from the bearer plugin's response header
    const newToken = response.headers.get('set-auth-token');
    if (newToken) {
      TokenStorage.set(newToken);
    }
    return response;
  };
}

/**
 * Create an auth client instance backed by the official better-auth client.
 *
 * Uses Bearer token authentication: tokens are stored in localStorage and
 * sent via `Authorization: Bearer <token>` header on every request. This
 * works across origins (no cookie dependency) and is compatible with mobile
 * clients.
 *
 * Requires the server to have the better-auth `bearer()` plugin enabled.
 *
 * @example
 * ```ts
 * const authClient = createAuthClient({ baseURL: '/api/v1/auth' });
 * const { user, session } = await authClient.signIn({ email, password });
 * ```
 */
export function createAuthClient(config: AuthClientConfig): AuthClient {
  const { baseURL, fetchFn } = config;
  const { origin, basePath } = resolveAuthURL(baseURL);

  const bearerFetch = createBearerFetch(fetchFn);

  const betterAuth = createBetterAuthClient({
    baseURL: origin,
    basePath,
    disableDefaultFetchPlugins: true,
    fetchOptions: { customFetchImpl: bearerFetch },
    plugins: [organizationClient(), twoFactorClient()],
  });

  // The better-auth client exposes methods whose TS return types are narrower
  // than the runtime JSON the server actually sends (e.g. `session` on signIn).
  // We deliberately cast through `unknown` to bridge from better-auth types
  // to the ObjectUI AuthClient contract.

  /**
   * POST one of the phoneNumber plugin's endpoints (framework#2780) and
   * return the parsed JSON. Throws an Error carrying the better-auth `code`
   * and HTTP `status` so the forms can special-case the per-number cooldown
   * (429 TOO_MANY_REQUESTS) with an honest "retry in Ns" message.
   */
  async function postPhoneNumberEndpoint(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await bearerFetch(`${origin}${basePath}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
      message?: string;
      code?: string;
    };
    if (!response.ok) {
      const err = new Error(
        payload?.message ?? `Auth request failed with status ${response.status}`,
      ) as Error & { code?: string; status?: number };
      if (payload?.code) err.code = payload.code;
      err.status = response.status;
      throw err;
    }
    return payload ?? {};
  }

  /**
   * Fetch `GET {authUrl}/config` once, with a per-attempt timeout so a
   * request that HANGS (a freshly provisioned environment whose kernel is
   * still cold-starting) converts into a retryable failure instead of
   * stalling the login page forever.
   */
  async function fetchConfigAttempt(timeoutMs: number): Promise<AuthPublicConfig> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      const url = `${origin}${basePath}/config`;
      const response = await bearerFetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response.ok) {
        throw new Error(`Failed to load auth config (status ${response.status})`);
      }
      const body = (await response.json()) as
        | { success?: boolean; data?: AuthPublicConfig; error?: { message?: string } }
        | AuthPublicConfig;
      // Server wraps the payload as `{ success, data }`; tolerate both shapes.
      if (body && typeof body === 'object' && 'data' in body && body.data) {
        return body.data as AuthPublicConfig;
      }
      return body as AuthPublicConfig;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  // Auth config is static per server boot: single-flight + cache the success
  // so the login page's multiple consumers (LoginForm, SocialSignInButtons,
  // RegisterForm) share ONE request instead of three. Failures RETRY with a
  // short backoff before rejecting — a first-load failure used to render the
  // page without its SSO buttons, which strands SSO-only users on a password
  // wall they have no password for (#2625). A final failure clears the cache
  // so the next caller starts a fresh cycle.
  const CONFIG_RETRY_DELAYS_MS = [500, 1500, 3500];
  const CONFIG_ATTEMPT_TIMEOUT_MS = 8_000;
  let configPromise: Promise<AuthPublicConfig> | null = null;

  async function loadConfigWithRetry(): Promise<AuthPublicConfig> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= CONFIG_RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await fetchConfigAttempt(CONFIG_ATTEMPT_TIMEOUT_MS);
      } catch (err) {
        lastError = err;
        if (attempt < CONFIG_RETRY_DELAYS_MS.length) {
          await new Promise((resolve) => setTimeout(resolve, CONFIG_RETRY_DELAYS_MS[attempt]));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return {
    async signIn(credentials: SignInCredentials) {
      const { data, error } = await betterAuth.signIn.email({
        email: credentials.email,
        password: credentials.password,
      });
      if (error) {
        throw toAuthError(error);
      }
      const payload = data as unknown as { user: AuthUser; session: AuthClientSession };
      // Persist token for cross-origin session persistence
      if (payload.session?.token) {
        TokenStorage.set(payload.session.token);
      }
      return { user: payload.user, session: payload.session };
    },

    async signUp(signUpData: SignUpData) {
      const { data, error } = await betterAuth.signUp.email({
        email: signUpData.email,
        password: signUpData.password,
        name: signUpData.name,
        // objectui#10893 — the verification mail's link lands here. Without
        // it better-auth writes `callbackURL=/`, and an invitee who registers
        // from an invitation link is dropped on the workspace picker instead
        // of the invitation. Only sent when the caller has somewhere to go,
        // so the server default is untouched otherwise.
        ...(signUpData.callbackURL ? { callbackURL: signUpData.callbackURL } : {}),
      });
      if (error) {
        throw toAuthError(error);
      }
      // better-auth's /sign-up/email returns { token: string | null, user }.
      // - When auto sign-in is enabled and verification is not required, `token`
      //   is the new session token (cookie also set server-side).
      // - When `requireEmailVerification` is on (or `autoSignIn: false`),
      //   `token` is null — no session, no cookie. The user must verify their
      //   email before signing in.
      // Some deployments / older mocks return a `{ user, session }` shape; we
      // accept either to stay compatible.
      const payload = data as unknown as {
        user: AuthUser;
        token?: string | null;
        session?: AuthClientSession | null;
      };
      const token = payload.token ?? payload.session?.token ?? null;
      if (token) {
        TokenStorage.set(token);
      }
      // Synthesize a session object when the server returned a flat token so
      // existing callers that read `result.session` keep working.
      let session: AuthClientSession | null = payload.session ?? null;
      if (!session && token) {
        session = { token } as AuthClientSession;
      }
      return {
        user: payload.user,
        session,
        requiresVerification: token === null,
      };
    },

    async sendVerificationEmail(email: string, callbackURL?: string) {
      // better-auth client exposes this on the root, not under a namespace.
      const baseAuth = betterAuth as unknown as {
        sendVerificationEmail: (args: { email: string; callbackURL?: string }) => Promise<{ error?: { message?: string; status?: number } | null }>;
      };
      const { error } = await baseAuth.sendVerificationEmail({ email, callbackURL });
      if (error) {
        throw new Error(error.message ?? `Auth request failed with status ${error.status}`);
      }
    },

    async signOut() {
      const { error } = await betterAuth.signOut();
      TokenStorage.clear();
      if (error) {
        throw new Error(error.message ?? `Auth request failed with status ${error.status}`);
      }
    },

    async getSession() {
      // better-fetch RETHROWS transport errors (it does not wrap them in
      // `{ error }`); a network hiccup must read as "signed out for now",
      // not an exception in every AuthProvider boot.
      let data: unknown = null;
      try {
        const res = await betterAuth.getSession();
        if (!res.error) data = res.data;
      } catch { /* transport error — fall through to the retry/null path */ }
      if (data) {
        const payload = data as unknown as { user: AuthUser; session: AuthClientSession };
        // Keep localStorage in sync if the server returns a fresh token
        if (payload.session?.token) {
          TokenStorage.set(payload.session.token);
        }
        return { user: payload.user, session: payload.session };
      }

      // Stale-bearer self-heal: every request injects the localStorage
      // bearer, and an INVALID bearer shadows a perfectly valid cookie
      // session. SSO landings (e.g. the cloud console's sso-exchange into a
      // tenant environment) only set the cookie — they cannot touch this
      // origin's localStorage — so a leftover token from an earlier login
      // bounces a freshly signed-in user back to the login page forever.
      // Retry once WITHOUT the bearer: a cookie session means the stored
      // token was stale — adopt the live session (and its token) instead.
      if (TokenStorage.get()) {
        try {
          const rawFetch = fetchFn || globalThis.fetch.bind(globalThis);
          const resp = await rawFetch(`${origin}${basePath}/get-session`, {
            method: 'GET',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          });
          if (resp.ok) {
            const body = (await resp.json().catch(() => null)) as
              | { user?: AuthUser; session?: AuthClientSession }
              | null;
            if (body?.user && body?.session) {
              if (body.session.token) TokenStorage.set(body.session.token);
              else TokenStorage.clear();
              return { user: body.user, session: body.session };
            }
            // The server affirmatively says the cookie has no session either
            // — the stored bearer is dead weight; drop it so the next
            // sign-in starts clean. (Transport errors keep the token: they
            // prove nothing about its validity.)
            TokenStorage.clear();
          }
        } catch { /* network hiccup — treat as signed out, keep the token */ }
      }
      return null;
    },

    async forgotPassword(email: string) {
      // better-auth 1.6+ renamed the endpoint from `/forget-password` to
      // `/request-password-reset` (client method `requestPasswordReset`).
      // Older builds only exposed `forgetPassword` → `/forget-password`, which
      // 404s on newer servers. Prefer the current method and fall back to the
      // legacy one so we stay compatible across better-auth versions. Neither
      // method is present in the default client TS types, so cast through
      // unknown.
      //
      // The `redirectTo` here is appended to the email link as
      // `?callbackURL=<redirectTo>`. When the user clicks the email,
      // better-auth verifies the token then 302s to
      // `<redirectTo>?token=…`. We resolve the basename from the
      // `<base href>` tag at runtime so the SPA mounted at e.g.
      // `/_console/` lands on `/_console/reset-password?token=…`.
      type RequestPasswordResetFn = (opts: { email: string; redirectTo: string }) =>
        Promise<{ error: { message?: string; status: number } | null }>;
      const ba = betterAuth as unknown as {
        requestPasswordReset?: RequestPasswordResetFn;
        forgetPassword?: RequestPasswordResetFn;
      };
      const requestReset = ba.requestPasswordReset ?? ba.forgetPassword;
      if (typeof requestReset !== 'function') {
        throw new Error('password reset is not available on this auth backend');
      }
      const { error } = await requestReset({
        email,
        redirectTo: resolveResetPasswordRedirect(),
      });
      if (error) {
        throw new Error(error.message ?? `Auth request failed with status ${error.status}`);
      }
    },

    async resetPassword(token: string, newPassword: string) {
      const { error } = await betterAuth.resetPassword({ token, newPassword });
      if (error) {
        throw new Error(error.message ?? `Auth request failed with status ${error.status}`);
      }
    },

    // --- Phone-number OTP (framework#2780) -------------------------------
    // The better-auth phoneNumber plugin's endpoints, called directly (the
    // phoneNumberClient plugin adds nothing we need beyond these four POSTs,
    // and direct fetch keeps the error `code`/status handy for the cooldown
    // 429 UX). Server availability is gated by `features.phoneNumberOtp`.

    async sendPhoneOtp(phoneNumber: string) {
      await postPhoneNumberEndpoint('/phone-number/send-otp', { phoneNumber });
    },

    async signInWithPhoneOtp(phoneNumber: string, code: string) {
      const payload = await postPhoneNumberEndpoint('/phone-number/verify', { phoneNumber, code });
      // Response: `{ status, token: string|null, user: object|null }` —
      // token/user are null when the number belongs to no account (the
      // endpoint also serves the change-phone verification flow).
      const token = typeof payload.token === 'string' ? payload.token : undefined;
      const user = (payload.user ?? null) as AuthUser | null;
      if (!token || !user) {
        throw new Error('No account is registered for this phone number.');
      }
      TokenStorage.set(token);
      return { user, session: { token } as AuthClientSession };
    },

    async signInWithPhonePassword(phoneNumber: string, password: string) {
      // Phone + password sign-in (better-auth `/sign-in/phone-number`). Needs
      // no SMS service — gated server-side by `features.phoneNumber` (plugin
      // on), NOT `features.phoneNumberOtp`. Response: `{ token, user }`, mirror
      // of signInWithPhoneOtp.
      const payload = await postPhoneNumberEndpoint('/sign-in/phone-number', { phoneNumber, password });
      const token = typeof payload.token === 'string' ? payload.token : undefined;
      const user = (payload.user ?? null) as AuthUser | null;
      if (!token || !user) {
        throw new Error('Invalid phone number or password.');
      }
      TokenStorage.set(token);
      return { user, session: { token } as AuthClientSession };
    },

    async requestPhonePasswordReset(phoneNumber: string) {
      // Always answers `{status:true}` (no account-existence oracle) — the
      // OTP only arrives when the number belongs to an account.
      await postPhoneNumberEndpoint('/phone-number/request-password-reset', { phoneNumber });
    },

    async resetPasswordWithPhoneOtp(phoneNumber: string, otp: string, newPassword: string) {
      await postPhoneNumberEndpoint('/phone-number/reset-password', { phoneNumber, otp, newPassword });
    },

    async changePassword(currentPassword: string, newPassword: string, options?: { revokeOtherSessions?: boolean }) {
      // better-auth exposes /change-password under the bound client as
      // `changePassword`. The runtime method exists but its TS type is
      // sometimes missing depending on plugin order; cast through unknown.
      type ChangePwFn = (opts: { currentPassword: string; newPassword: string; revokeOtherSessions?: boolean }) =>
        Promise<{ error: { message?: string; status: number } | null }>;
      const fn = (betterAuth as unknown as { changePassword: ChangePwFn }).changePassword;
      if (typeof fn !== 'function') {
        throw new Error('change-password is not available on this auth backend');
      }
      const { error } = await fn({
        currentPassword,
        newPassword,
        ...(options?.revokeOtherSessions != null ? { revokeOtherSessions: options.revokeOtherSessions } : {}),
      });
      if (error) {
        throw new Error(error.message ?? `Auth request failed with status ${error.status}`);
      }
    },

    // ADR-0069 — enforced-MFA enrollment. Returns the otpauth:// URI (for a QR)
    // and one-time backup codes. Runtime methods come from the twoFactorClient
    // plugin; cast through unknown to bridge loose better-auth client types.
    async enrollTotp(password: string) {
      type EnableFn = (opts: { password: string }) =>
        Promise<{ data?: { totpURI?: string; backupCodes?: string[] } | null; error?: { message?: string; status?: number } | null }>;
      const tf = (betterAuth as unknown as { twoFactor?: { enable?: EnableFn } }).twoFactor;
      if (!tf || typeof tf.enable !== 'function') {
        throw new Error('two-factor enrollment is not available on this auth backend');
      }
      const { data, error } = await tf.enable({ password });
      if (error) throw new Error(error.message ?? `Two-factor enable failed (${error.status ?? '?'})`);
      return { totpURI: data?.totpURI ?? '', backupCodes: data?.backupCodes ?? [] };
    },

    // ADR-0069 — verify the first TOTP code to activate enrollment.
    async verifyTotp(code: string) {
      type VerifyFn = (opts: { code: string }) =>
        Promise<{ error?: { message?: string; status?: number } | null }>;
      const tf = (betterAuth as unknown as { twoFactor?: { verifyTotp?: VerifyFn } }).twoFactor;
      if (!tf || typeof tf.verifyTotp !== 'function') {
        throw new Error('two-factor verification is not available on this auth backend');
      }
      const { error } = await tf.verifyTotp({ code });
      if (error) throw new Error(error.message ?? `Two-factor verification failed (${error.status ?? '?'})`);
    },

    async setInitialPassword(newPassword: string) {
      // Custom route registered by AuthPlugin (framework). Used by users
      // who came in via SSO and have no credential account yet — server
      // refuses with credential_account_exists (409) if one is already set,
      // pushing the caller to changePassword instead.
      const url = `${origin}${basePath}/set-initial-password`;
      const response = await bearerFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });
      if (!response.ok) {
        let message = `Set password failed with status ${response.status}`;
        try {
          const body = (await response.json()) as { error?: { message?: string; code?: string } };
          if (body?.error?.message) message = body.error.message;
        } catch { /* not JSON */ }
        throw new Error(message);
      }
    },

    async hasLocalPassword() {
      // /list-accounts is provided by better-auth and returns the linked
      // accounts for the authenticated user. We treat the presence of any
      // providerId === 'credential' entry as "has a local password".
      const url = `${origin}${basePath}/list-accounts`;
      try {
        const response = await bearerFetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) return false;
        const body = (await response.json()) as Array<{ providerId?: string }> | { data?: Array<{ providerId?: string }> } | null;
        const list = Array.isArray(body) ? body : (body && 'data' in body && Array.isArray((body as any).data) ? (body as any).data : []);
        return (list as Array<{ providerId?: string }>).some((a) => a?.providerId === 'credential');
      } catch {
        return false;
      }
    },

    async updateUser(userData: Partial<AuthUser>) {
      const { data, error } = await betterAuth.updateUser(userData);
      if (error) {
        throw new Error(error.message ?? `Auth request failed with status ${error.status}`);
      }
      if (!data) {
        throw new Error('Update user returned no data');
      }
      // The server response may wrap the user in a `user` key or return it directly
      const raw = data as unknown as Record<string, unknown>;
      return (raw && typeof raw === 'object' && 'user' in raw ? raw.user : raw) as AuthUser;
    },

    /**
     * [framework ADR-0090 D12 / ADR-0105 D8] What the caller may delegate.
     *
     * Sits next to the auth base path (`…/auth` → `…/security/…`) rather than
     * taking a second base URL, so a deployment that relocates its API prefix
     * moves both together. Never throws: a deployment without the
     * delegated-administration runtime answers 501, and any failure yields
     * `null` so the caller HIDES placement instead of offering a form the
     * server would refuse.
     */
    async describeDelegableScope(): Promise<import('./types.js').DelegableScope | null> {
      try {
        const securityBase = basePath.replace(/\/auth$/, '/security');
        const response = await bearerFetch(`${origin}${securityBase}/my-delegable-scope`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) return null;
        const body = (await response.json()) as any;
        // The server wraps some payloads as `{ success, data }`; tolerate both.
        const scope = body && typeof body === 'object' && 'data' in body ? body.data : body;
        return scope && typeof scope === 'object' && Array.isArray(scope.placeableBusinessUnitIds)
          ? (scope as import('./types.js').DelegableScope)
          : null;
      } catch {
        return null;
      }
    },

    async getConfig(): Promise<AuthPublicConfig> {
      if (!configPromise) {
        configPromise = loadConfigWithRetry().catch((err) => {
          configPromise = null;
          throw err;
        });
      }
      return configPromise;
    },

    async signInWithProvider(providerId: string, options: SignInWithProviderOptions = {}) {
      const { type = 'social', callbackURL, errorCallbackURL } = options;
      // Watchdog (#2626): a sign-in request that HANGS (e.g. the environment
      // kernel is cold-starting on first open) used to leave the provider
      // button spinning forever — no error, no way to retry. Convert a
      // no-response into a rejection so the button contract (#2458 pending +
      // inline error) can recover it. The abandoned request may still land
      // later; the user retrying just starts a fresh redirect, which is safe.
      const SIGN_IN_TIMEOUT_MS = 20_000;
      const withTimeout = <T,>(p: Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Sign-in timed out — the server did not respond. Please try again.')),
          SIGN_IN_TIMEOUT_MS,
        );
        p.then(
          (v) => { clearTimeout(timer); resolve(v); },
          (e) => { clearTimeout(timer); reject(e); },
        );
      });
      // We pass `disableDefaultFetchPlugins: true` to better-auth above,
      // which also disables better-auth's `redirectPlugin` (the one that
      // navigates the browser to `data.url` when the server responds with
      // `{ url, redirect: true }`). The server still returns that payload
      // for OAuth/OIDC providers — we just have to honour it ourselves.
      const signInSocial = async () => await withTimeout(betterAuth.signIn.social({
        provider: providerId as Parameters<typeof betterAuth.signIn.social>[0]['provider'],
        callbackURL,
        errorCallbackURL,
      })) as { data: { url?: string; redirect?: boolean } | null; error: { message?: string; status: number } | null };
      let result: Awaited<ReturnType<typeof signInSocial>>;
      if (type === 'oidc') {
        // better-auth ≥ 1.7 registers generic OAuth/OIDC providers through
        // the core social sign-in flow — `POST /sign-in/social` with the
        // provider id — and no longer mounts the dedicated
        // `/sign-in/oauth2` endpoint. Try the social route first; when it
        // rejects the provider (an older < 1.7 server that only knows OIDC
        // providers via `/sign-in/oauth2`), fall back to the legacy route.
        result = await signInSocial();
        if (result.error) {
          const oauth2 = (betterAuth as unknown as {
            signIn: { oauth2?: (args: Record<string, unknown>) => Promise<{ data: { url?: string; redirect?: boolean } | null; error: { message?: string; status: number } | null }> };
          }).signIn.oauth2;
          const legacy = oauth2
            ? await withTimeout(oauth2({ providerId, callbackURL, errorCallbackURL })).catch(() => null)
            : null;
          if (legacy && !legacy.error) {
            result = legacy;
          }
          // Legacy also failed (or is unavailable) — keep the social-route
          // error below: on a ≥ 1.7 server it is the real failure, while the
          // legacy route only 404s.
        }
      } else {
        result = await signInSocial();
      }
      const { data, error } = result;
      if (error) {
        throw new Error(error.message ?? `Auth request failed with status ${error.status}`);
      }
      // A missing redirect URL means the flow CANNOT continue — surface it
      // instead of resolving silently (the user would see a dead button).
      if (!data?.url) {
        throw new Error(`Sign-in with "${providerId}" did not return a redirect URL — please try again or contact your administrator.`);
      }
      if (typeof window !== 'undefined') {
        window.location.href = data.url;
      }
    },

    // --- Organization / Workspace methods ---

    async listOrganizations(): Promise<AuthOrganization[]> {
      const { data, error } = await (betterAuth as any).organization.list();
      if (error) throw toAuthError(error, 'Failed to list organizations');
      return (data ?? []) as AuthOrganization[];
    },

    async createOrganization(orgData: { name: string; slug: string; logo?: string; timezone?: string }): Promise<AuthOrganization> {
      // objectui#11908: the creator's zone rides the QUERY (`?timezone=`), the
      // shape the server's create route reads it from; the body stays
      // `{ name, slug, logo }`. better-auth's client proxy lifts
      // `fetchOptions.query` onto the URL and keeps it out of the body. An
      // absent or empty zone sends no parameter at all.
      const { timezone } = orgData;
      const { data, error } = await (betterAuth as any).organization.create({
        name: orgData.name,
        slug: orgData.slug,
        logo: orgData.logo,
        ...(timezone ? { fetchOptions: { query: { timezone } } } : {}),
      });
      if (error) throw toAuthError(error, 'Failed to create organization');
      return data as unknown as AuthOrganization;
    },

    async setActiveOrganization(orgId: string): Promise<AuthOrganization | null> {
      const { data, error } = await (betterAuth as any).organization.setActive({
        organizationId: orgId,
      });
      if (error) throw toAuthError(error, 'Failed to set active organization');
      return (data ?? null) as AuthOrganization | null;
    },

    async getActiveOrganization(): Promise<AuthOrganization | null> {
      // `/organization/get-full-organization` is the endpoint that returns the
      // active organization record in full. `getActiveMember` returns only the
      // current user's member row (organizationId, role) — not the org itself.
      const { data, error } = await (betterAuth as any).organization.getFullOrganization();
      if (error || !data) return null;
      return data as unknown as AuthOrganization;
    },

    async getActiveMember(): Promise<AuthOrganizationMember | null> {
      // Returns the current user's member row for the active organization
      // (id, organizationId, userId, role). Used to gate UI affordances that
      // require owner/admin role.
      const fn = (betterAuth as any).organization?.getActiveMember;
      if (typeof fn !== 'function') return null;
      const { data, error } = await fn();
      if (error || !data) return null;
      return data as unknown as AuthOrganizationMember;
    },

    async getMembers(orgId: string): Promise<AuthOrganizationMember[]> {
      const { data, error } = await (betterAuth as any).organization.listMembers({
        query: { organizationId: orgId },
      });
      if (error) throw toAuthError(error, 'Failed to get members');
      const result = data as unknown as { members?: AuthOrganizationMember[] } | AuthOrganizationMember[];
      if (Array.isArray(result)) return result;
      return (result?.members ?? []) as AuthOrganizationMember[];
    },

    async inviteMember(inviteData: {
      organizationId: string;
      email: string;
      role: string;
      businessUnitId?: string;
      positions?: string[];
    }): Promise<AuthInvitation> {
      const { data, error } = await (betterAuth as any).organization.inviteMember({
        organizationId: inviteData.organizationId,
        email: inviteData.email,
        role: inviteData.role,
        // [framework ADR-0105 D8] Placement intent rides better-auth's own
        // `additionalFields` on the invitation. Omitted entirely when absent so
        // an ordinary invite is byte-identical to before; when present, the
        // server authorizes it against the ISSUER's adminScope and rejects the
        // whole invitation if it is out of scope.
        ...(inviteData.businessUnitId ? { businessUnitId: inviteData.businessUnitId } : {}),
        ...(inviteData.positions?.length ? { positions: inviteData.positions } : {}),
      });
      if (error) throw toAuthError(error, 'Failed to invite member');
      return asAuthInvitation(data, 'inviteMember');
    },

    async removeMember(removeData: { organizationId: string; memberIdOrUserId: string }): Promise<void> {
      const { error } = await (betterAuth as any).organization.removeMember({
        organizationId: removeData.organizationId,
        memberIdOrUserId: removeData.memberIdOrUserId,
      });
      if (error) throw toAuthError(error, 'Failed to remove member');
    },

    async updateMemberRole(payload: { organizationId: string; memberId: string; role: string }): Promise<void> {
      const { error } = await (betterAuth as any).organization.updateMemberRole({
        organizationId: payload.organizationId,
        memberId: payload.memberId,
        role: payload.role,
      });
      if (error) throw toAuthError(error, 'Failed to update member role');
    },

    async updateOrganization(orgId: string, orgData: Partial<Pick<AuthOrganization, 'name' | 'slug' | 'logo' | 'metadata'>>): Promise<AuthOrganization> {
      const { data, error } = await (betterAuth as any).organization.update({
        organizationId: orgId,
        data: orgData,
      });
      if (error) throw toAuthError(error, 'Failed to update organization');
      return data as unknown as AuthOrganization;
    },

    async deleteOrganization(orgId: string): Promise<void> {
      const { error } = await (betterAuth as any).organization.delete({
        organizationId: orgId,
      });
      if (error) throw toAuthError(error, 'Failed to delete organization');
    },

    async leaveOrganization(orgId: string): Promise<void> {
      const { error } = await (betterAuth as any).organization.leave({
        organizationId: orgId,
      });
      if (error) throw toAuthError(error, 'Failed to leave organization');
    },

    // --- Invitation methods ---

    async listInvitations(orgId: string): Promise<AuthInvitation[]> {
      const { data, error } = await (betterAuth as any).organization.listInvitations({
        query: { organizationId: orgId },
      });
      if (error) throw toAuthError(error, 'Failed to list invitations');
      return asAuthInvitations(data, 'listInvitations');
    },

    async cancelInvitation(invitationId: string): Promise<void> {
      const { error } = await (betterAuth as any).organization.cancelInvitation({ invitationId });
      if (error) throw toAuthError(error, 'Failed to cancel invitation');
    },

    async getInvitation(invitationId: string): Promise<AuthInvitation> {
      const { data, error } = await (betterAuth as any).organization.getInvitation({
        query: { id: invitationId },
      });
      if (error) throw toAuthError(error, 'Failed to load invitation');
      return asAuthInvitation(data, 'getInvitation');
    },

    async acceptInvitation(invitationId: string): Promise<void> {
      const { error } = await (betterAuth as any).organization.acceptInvitation({ invitationId });
      if (error) throw toAuthError(error, 'Failed to accept invitation');
    },

    async rejectInvitation(invitationId: string): Promise<void> {
      const { error } = await (betterAuth as any).organization.rejectInvitation({ invitationId });
      if (error) throw toAuthError(error, 'Failed to reject invitation');
    },

    async listUserInvitations(): Promise<AuthInvitation[]> {
      const { data, error } = await (betterAuth as any).organization.listUserInvitations();
      if (error) throw toAuthError(error, 'Failed to list invitations');
      return asAuthInvitations(data, 'listUserInvitations');
    },
  };
}
