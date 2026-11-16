// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The invitation mail's mailbox proof, and the one-step door that redeems it.
 *
 * ## The rule
 *
 * Holding an invitation's accept link proves nothing about the invited
 * mailbox. The link is the invitation's id and nothing more:
 * `copy_invitation_link` answers it, and the invitation row carries it. What
 * proves the mailbox is a secret that only the invitation mail carries, the
 * proof. A person who holds the proof may, in one request, create the account
 * (or set the password of an unverified one), have the address marked
 * verified, accept the invitation and be signed in. A person who holds only
 * the link keeps today's path: sign in, or register and verify by mail.
 *
 * ## The proof
 *
 * - Minted by `sendInvitationEmail` for each send, a resend included, and put
 *   in the mail's link only, after `#`, as `proof=VALUE`
 *   ({@link withInvitationProof}). The mail goes out through
 *   `SendTemplateInput.deliverOnly`, so the stored mail row never holds it.
 * - Never at rest in clear. One `sys_verification` row per invitation,
 *   identifier {@link invitationProofIdentifier}, holds the proof's SHA-256,
 *   the invited address and the invitation's expiry, with the invitation's
 *   expiry as the row's own. Written and read through better-auth's internal
 *   adapter, so a host `secondaryStorage` is honoured as for every other
 *   verification value.
 * - Bound to the invitation, its address and its expiry: the door requires
 *   all three to match the invitation as it stands.
 * - Single-use: spent by the internal adapter's atomic consume, before any
 *   side effect. A proof that does not match is not spent.
 * - A resend retires the old proof: the mint deletes the invitation's row
 *   before writing the new one.
 *
 * ## The door — `POST /organization/accept-invitation-with-proof`
 *
 * Body `{ invitationId, proof, name, password }`, or `{ invitationId }` alone
 * from a signed-in session (the social return). Answers:
 *
 * - `{ outcome: 'accepted', organizationId }` — the invitation is accepted and
 *   the caller is signed in.
 * - `{ outcome: 'sign_in' }` — the proof is good, and the address has an
 *   account the one-step path does not set a password on (verified, linked to
 *   a provider, second factor enrolled, or managed by an identity provider).
 *   The proof is not spent; the person signs in as today.
 * - `{ outcome: 'verify_email' }` — session mode, and the session's address is
 *   not verified. Nothing is accepted.
 * - `400 INVALID_TOKEN` — any proof that does not admit: unknown, used,
 *   expired, for another invitation or address, or an invitation that is no
 *   longer pending. One answer, which does not say which check failed.
 *
 * An unverified account with no linked provider account gets the typed
 * password in place of its own, and every one of its sessions is revoked, as a
 * password reset does. A new account is created through the internal adapter,
 * so the sign-up gates that run on every creation (audience admission and the
 * database hooks) run here too; the door itself refuses where email sign-up is
 * off. The invitation is accepted through better-auth's own accept route, so
 * every organization hook runs.
 *
 * Rate-limited per client address and per invitation, always armed.
 */

import { incrementFixedWindow, InProcessCounterStore, type CounterStore } from './rate-limit-storage.js';
import { readRequestClientAddress } from './request-client-address.js';
import { isPendingSsoSource } from './pending-sso-marker.js';
import { isIdpProvisionedSource, readUserSource } from './sso-only-local-password.js';

/** The door's path, under the auth mount. */
export const ACCEPT_INVITATION_WITH_PROOF_PATH = '/organization/accept-invitation-with-proof';

/** The fragment key the mail's link carries the proof under. */
export const INVITATION_PROOF_FRAGMENT_KEY = 'proof';

/** Per client address and per invitation, each its own window. */
export const INVITATION_PROOF_RATE_LIMIT = { window: 60, max: 10 } as const;

const IDENTIFIER_PREFIX = 'invitation-proof:';

/** The `sys_verification` identifier of an invitation's proof row. */
export function invitationProofIdentifier(invitationId: string): string {
  return `${IDENTIFIER_PREFIX}${invitationId}`;
}

/** The mail's accept link: the copied link, with the proof after `#`. */
export function withInvitationProof(acceptUrl: string, proof: string): string {
  return `${acceptUrl}#${INVITATION_PROOF_FRAGMENT_KEY}=${encodeURIComponent(proof)}`;
}

/** The internal-adapter members the proof reads and writes. */
export interface InvitationProofStore {
  createVerificationValue(data: { identifier: string; value: string; expiresAt: Date }): Promise<unknown>;
  findVerificationValue(identifier: string): Promise<{ value: string; expiresAt: Date | string } | null>;
  consumeVerificationValue(identifier: string): Promise<{ value: string; expiresAt: Date | string } | null>;
  deleteVerificationByIdentifier(identifier: string): Promise<void>;
}

interface StoredProof {
  /** SHA-256 of the proof, base64url. */
  h: string;
  /** The invited address, lowercased. */
  email: string;
  /** The invitation's expiry, ISO-8601. */
  exp: string;
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(new Uint8Array(digest)).toString('base64url');
}

function isoOf(value: unknown): string | undefined {
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function parseStored(value: unknown): StoredProof | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<StoredProof>;
    if (typeof parsed?.h !== 'string' || typeof parsed.email !== 'string' || typeof parsed.exp !== 'string') return undefined;
    return { h: parsed.h, email: parsed.email, exp: parsed.exp };
  } catch {
    return undefined;
  }
}

/**
 * Mint the proof for one invitation send, retiring any earlier one. Answers
 * the proof, or `undefined` when the invitation's expiry is unreadable (no
 * proof is minted for an invitation with no expiry to bind it to).
 */
export async function mintInvitationProof(
  store: InvitationProofStore,
  invitation: { id: string; email: string; expiresAt: unknown },
): Promise<string | undefined> {
  const exp = isoOf(invitation.expiresAt);
  if (!exp || !invitation.id || !invitation.email) return undefined;
  const { generateRandomString } = await import('better-auth/crypto');
  const proof = generateRandomString(32, 'a-z', 'A-Z', '0-9');
  const identifier = invitationProofIdentifier(invitation.id);
  await store.deleteVerificationByIdentifier(identifier);
  const stored: StoredProof = { h: await sha256(proof), email: invitation.email.toLowerCase(), exp };
  await store.createVerificationValue({ identifier, value: JSON.stringify(stored), expiresAt: new Date(exp) });
  return proof;
}

/** Does `stored` admit `proof` for this invitation as it stands? */
async function admits(
  stored: StoredProof | undefined,
  proof: string,
  invitation: { email: string; expiresAt: unknown },
): Promise<boolean> {
  if (!stored) return false;
  const { constantTimeEqual } = await import('better-auth/crypto');
  const hashMatches = constantTimeEqual(await sha256(proof), stored.h);
  return hashMatches && stored.email === invitation.email.toLowerCase() && stored.exp === isoOf(invitation.expiresAt);
}

/** What the door needs from the manager. */
export interface InvitationProofDoorHost {
  /** better-auth's API, for its own accept route. */
  getApi(): Promise<any>;
  /** The audience gate every account creation passes (`AuthManager#validateAudienceAdmission`). */
  validateAudienceAdmission(
    data: { user?: Record<string, unknown>; source?: { action?: string; method?: string } },
    ctx?: unknown,
  ): Promise<{ error: string; errorDescription?: string } | undefined>;
  /** SSO-only mode: no local password is set. */
  isSsoOnlyMode(): boolean;
  /** The data engine, for the account's directory source. */
  getDataEngine(): unknown;
  /** The shared counter store, when one is wired. */
  counterStore?: () => Promise<CounterStore>;
}

const FALLBACK_COUNTERS = new InProcessCounterStore();

const INVALID_PROOF_MESSAGE =
  'This invitation link cannot be used to join. Open the latest invitation email, or sign in to accept the invitation.';

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Build the better-auth plugin that mounts the door. The vendor modules are
 * imported lazily, as the other endpoint builders here import them.
 */
export async function buildInvitationProofDoorPlugin(host: InvitationProofDoorHost): Promise<any> {
  const [{ createAuthEndpoint, APIError, getSessionFromCtx }, { setSessionCookie }] = await Promise.all([
    import('better-auth/api'),
    import('better-auth/cookies'),
  ]);

  const refuseProof = (): never => {
    throw new APIError('BAD_REQUEST', { code: 'INVALID_TOKEN', message: INVALID_PROOF_MESSAGE });
  };

  const rateLimit = async (keys: string[]) => {
    let store: CounterStore = FALLBACK_COUNTERS;
    try {
      store = (await host.counterStore?.()) ?? FALLBACK_COUNTERS;
    } catch {
      store = FALLBACK_COUNTERS;
    }
    for (const key of keys) {
      const { count, resetAt } = await incrementFixedWindow(store, key, INVITATION_PROOF_RATE_LIMIT.window);
      if (count > INVITATION_PROOF_RATE_LIMIT.max) {
        throw new APIError('TOO_MANY_REQUESTS', {
          code: 'RATE_LIMITED',
          message: `Too many attempts. Try again in ${Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))} seconds.`,
        });
      }
    }
  };

  const acceptAs = async (sessionToken: string, invitationId: string) => {
    const api = await host.getApi();
    await api.acceptInvitation({
      body: { invitationId },
      headers: new Headers({ authorization: `Bearer ${sessionToken}` }),
    });
  };

  const endpoint = createAuthEndpoint(
    ACCEPT_INVITATION_WITH_PROOF_PATH,
    { method: 'POST' },
    async (ctx: any) => {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const invitationId = nonEmpty(body.invitationId);
      const proof = nonEmpty(body.proof);

      const address = (await readRequestClientAddress()) ?? 'unknown';
      await rateLimit([
        `invitation-proof:addr:${address}`,
        ...(invitationId ? [`invitation-proof:inv:${invitationId}`] : []),
      ]);

      if (!invitationId) return refuseProof();
      const invitation: any = await ctx.context.adapter.findOne({
        model: 'invitation',
        where: [{ field: 'id', value: invitationId }],
      });
      const pending =
        invitation &&
        invitation.status === 'pending' &&
        typeof invitation.email === 'string' &&
        new Date(invitation.expiresAt).getTime() > Date.now();

      // ── Session mode: the social return ────────────────────────────────
      if (!proof) {
        const session = await getSessionFromCtx(ctx);
        if (!session) throw new APIError('UNAUTHORIZED', { code: 'UNAUTHENTICATED', message: 'Sign in to accept the invitation.' });
        if (!pending) return refuseProof();
        const sameAddress = String(session.user.email).toLowerCase() === invitation.email.toLowerCase();
        if (!sameAddress || session.user.emailVerified !== true) return ctx.json({ outcome: 'verify_email' });
        await acceptAs(session.session.token, invitationId);
        return ctx.json({ outcome: 'accepted', organizationId: invitation.organizationId });
      }

      // ── Proof mode ─────────────────────────────────────────────────────
      if (!pending) return refuseProof();
      const identifier = invitationProofIdentifier(invitationId);
      const internal = ctx.context.internalAdapter;
      const stored = await internal.findVerificationValue(identifier);
      if (!(await admits(parseStored(stored?.value), proof, invitation))) return refuseProof();

      const email = invitation.email.toLowerCase();
      const found = await internal.findUserByEmail(email, { includeAccounts: true });
      const existing = found?.user;
      if (existing) {
        const linkedProvider = (found.accounts ?? []).some((a: any) => a?.providerId !== 'credential');
        const source = await readUserSource(host.getDataEngine() as never, String(existing.id));
        const directoryManaged = !source.ok || isPendingSsoSource(source.value) || isIdpProvisionedSource(source.value);
        if (
          existing.emailVerified === true ||
          linkedProvider ||
          existing.twoFactorEnabled === true ||
          directoryManaged ||
          host.isSsoOnlyMode() ||
          !ctx.context.options.emailAndPassword?.enabled
        ) {
          return ctx.json({ outcome: 'sign_in' });
        }
      }

      const password = typeof body.password === 'string' ? body.password : '';
      const passwordConfig = ctx.context.password.config;
      if (password.length < passwordConfig.minPasswordLength) {
        throw new APIError('BAD_REQUEST', { code: 'PASSWORD_TOO_SHORT', message: 'Password too short' });
      }
      if (password.length > passwordConfig.maxPasswordLength) {
        throw new APIError('BAD_REQUEST', { code: 'PASSWORD_TOO_LONG', message: 'Password too long' });
      }
      const name = nonEmpty(body.name);

      if (!existing) {
        const ep = ctx.context.options.emailAndPassword;
        if (!ep?.enabled || ep.disableSignUp) {
          throw new APIError('BAD_REQUEST', {
            code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED',
            message: 'Email and password sign up is not enabled',
          });
        }
        if (!name) throw new APIError('BAD_REQUEST', { code: 'VALIDATION_ERROR', message: 'Enter your name.' });
        const refusal = await host.validateAudienceAdmission(
          { user: { email }, source: { action: 'create-user', method: 'email-password' } },
          ctx,
        );
        if (refusal) {
          throw new APIError('FORBIDDEN', { code: refusal.error, message: refusal.errorDescription ?? refusal.error });
        }
      }

      // Hashed before the proof is spent: a password the hash step refuses
      // (a breached one) leaves the proof usable.
      const passwordHash = await ctx.context.password.hash(password);

      const consumed = await internal.consumeVerificationValue(identifier);
      if (!consumed || parseStored(consumed.value)?.h !== parseStored(stored?.value)?.h) return refuseProof();

      let user: any;
      if (!existing) {
        user = await internal.createUser({ email, name, emailVerified: true }, { method: 'email-password' });
        await internal.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: passwordHash });
      } else {
        const userId = String(existing.id);
        await internal.deleteUserSessions(userId);
        if (await internal.findCredentialAccount(userId)) {
          await internal.updatePassword(userId, passwordHash);
        } else {
          await internal.createAccount({ userId, providerId: 'credential', accountId: userId, password: passwordHash });
        }
        user = await internal.updateUser(userId, { emailVerified: true, ...(name ? { name } : {}) });
      }

      const session = await internal.createSession(user.id, false);
      if (!session) throw new APIError('INTERNAL_SERVER_ERROR', { code: 'INTERNAL_ERROR', message: 'Failed to create a session.' });
      await setSessionCookie(ctx, { session, user });
      await acceptAs(session.token, invitationId);
      return ctx.json({ outcome: 'accepted', organizationId: invitation.organizationId });
    },
  );

  return {
    id: 'invitation-mailbox-proof',
    endpoints: { acceptInvitationWithProof: endpoint },
  };
}
