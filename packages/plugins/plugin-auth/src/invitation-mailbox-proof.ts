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
 *   `SendTemplateInput.deliverOnlyData`, so the stored mail row never holds it.
 * - Never at rest in clear. One `sys_verification` row per invitation,
 *   identifier {@link invitationProofIdentifier}, holds the proof's SHA-256,
 *   the invited address and the invitation's expiry, with the invitation's
 *   expiry as the row's own. Written and read through better-auth's internal
 *   adapter, so a host `secondaryStorage` is honoured as for every other
 *   verification value.
 * - Bound to the invitation, its address and its expiry: the door requires
 *   all three to match the invitation as it stands.
 * - Single-use: spent through the internal adapter's consume before the
 *   account or its password is written, and only by a request that passed
 *   every gate; a proof that does not match, or a request a gate refuses,
 *   leaves it unspent. Within one
 *   server process concurrent redemptions of one proof are serialized, so
 *   exactly one succeeds. Across server processes the guarantee is the
 *   store's: on the platform's own adapter the consume reads the row and
 *   then deletes it, which is not one atomic step.
 * - A resend retires the old proof: the mint deletes the invitation's row
 *   before writing the new one.
 *
 * ## The door — `POST /organization/accept-invitation-one-step`
 *
 * Body `{ invitationId, proof, name, password }`, or `{ invitationId }` alone
 * from a signed-in session (the social return). Answers in the envelope,
 * `{ success: true, data }`, with `data` one of:
 *
 * - `{ outcome: 'accepted', organizationId }` — the invitation is accepted and
 *   the caller is signed in.
 * - `{ outcome: 'sign_in' }` — the proof is good, and the address has an
 *   account the one-step path does not set a password on (the closing rule
 *   below). The proof is not spent; the person signs in as today.
 * - `{ outcome: 'verify_email' }` — session mode, and the session's address is
 *   not the invited one, or is not verified. Nothing is accepted.
 * - `400 INVALID_TOKEN` — any proof that does not admit: unknown, used,
 *   expired, for another invitation or address, or an invitation that is no
 *   longer pending. One answer, which does not say which check failed.
 *
 * ## Which existing account the door sets a password on
 *
 * The door sets a password on an existing account only when it reads all of
 * these: the address is not verified; the account's only sign-in account is
 * its email and password one, or it has none; it has no second factor,
 * enabled or enrolled; its user row holds no phone number, verified or not;
 * it holds no standing grant (an API key, an OAuth client consent, an OAuth
 * access or refresh token, an OAuth client, a device authorization, an SSO
 * provider, a SCIM credential or a link to an identity provider's directory,
 * revoked or expired ones included); its identity source is local; and the
 * server allows a local password here (not SSO-only, email and password on).
 * Every other account answers `sign_in`, including one in a state no rule
 * names and one whose reading fails, and the proof stays unspent. Every
 * reading is taken again once the account's sessions are revoked and before
 * the password is written; an account that no longer passes then answers
 * `sign_in` with its sessions revoked, and the proof stays unspent. Every store
 * this plugin mounts that is keyed by a user, and every column of the
 * vendor's user model with every plugin this plugin can mount, is classified
 * as a claim the judge reads or as no claim, and a test holds each
 * classification to what is mounted. The classification covers what this
 * plugin mounts and nothing another package mounts.
 *
 * The judge, {@link oneStepSignInState}, is an allow-list: it lets the
 * password be set only when every value it reads is positively the one that
 * carries no claim it reads, and a value no rule names answers `sign_in` as
 * `unrecognised`. Its reasons are {@link ONE_STEP_SIGN_IN_STATES}; the card's
 * test pins one case per reason.
 *
 * Standing grants count as claims ({@link USER_KEYED_STORES},
 * {@link readStandingGrant}): any row of the user in a standing-grant object,
 * revoked or not, answers `sign_in`. A table that does not exist holds no
 * rows; a read that fails answers `sign_in` as `grant_unreadable`. The
 * plugin's `passkeys` flag is not wired today; if it is ever wired, a passkey
 * is a claim the judge must read.
 *
 * A sign-in identity on the user row counts as a claim whether or not it is
 * verified ({@link USER_ROW_COLUMNS}, {@link readUserRowSignIn}): its presence
 * answers `sign_in`. It is read from the stored row, so a value written while
 * its sign-in plugin is not mounted counts too; a read that fails answers
 * `sign_in` as `identity_unreadable`.
 *
 * An account that passes gets the typed password in place of its own, and
 * every one of its sessions is revoked with the reason a password reset
 * records (`session-tombstone.ts`); the two writes match the vendor's order. The password history is consulted before
 * the proof is spent and extended after, as the reset door does (ADR-0069
 * D1): a reused password is refused with the proof unspent. A new account is created through the
 * internal adapter, so the sign-up gates that run on every creation (audience
 * admission and the database hooks) run here too; the door itself refuses
 * where email sign-up is off. Either way the password-age stamp and the
 * forced-change clear a password change writes (ADR-0069 D1) are written. The
 * invitation is accepted through better-auth's own accept route, so every
 * organization hook runs.
 *
 * On a cloud-managed environment the door sets no local password for anyone
 * (`cloud-managed.ts`): proof mode answers that posture's refusal before the
 * proof is read, and the proof stays unspent.
 *
 * Rate-limited per client address and per invitation, always armed.
 */

import { isCloudManaged } from '@objectstack/core';
import { endSessionsAfterCredentialWrite } from './credential-change-ends-prior-access.js';
import { isMissingTableError } from '@objectstack/types';
import { CLOUD_MANAGED_REFUSAL_CODE, CLOUD_MANAGED_REFUSAL_MESSAGES } from './cloud-managed.js';
import { incrementFixedWindow, InProcessCounterStore, type CounterStore } from './rate-limit-storage.js';
import { readRequestClientAddress } from './request-client-address.js';
import { isPendingSsoSource } from './pending-sso-marker.js';
import { isIdpProvisionedSource, readUserSource, type UserSourceReader } from './sso-only-local-password.js';

/** The door's path, under the auth mount. */
export const ACCEPT_INVITATION_ONE_STEP_PATH = '/organization/accept-invitation-one-step';

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
  /** The ADR-0069 D1 after-effects of a password set (`AuthManager#stampPasswordChangedAt`). */
  stampPasswordChangedAt(userId: string): Promise<void>;
  /**
   * ADR-0069 D1, the reset door's reuse check (`AuthManager#assertPasswordNotReused`):
   * throws `PASSWORD_REUSE`, or answers the current hash for the history.
   */
  assertPasswordNotReused(
    userId: string,
    candidate: string,
    verify?: (data: { password: string; hash: string }) => Promise<boolean>,
  ): Promise<string | undefined>;
  /** ADR-0069 D1, the reset door's history append (`AuthManager#recordPasswordHistory`). */
  recordPasswordHistory(userId: string, oldHash: string): Promise<void>;
}

/**
 * Why an existing account answers `sign_in`. The judge
 * ({@link oneStepSignInState}) is an allow-list: these name the reasons it
 * reports, and `unrecognised` is every value it does not positively read as
 * carrying no claim. Each named state is either a claim on the account the
 * mailbox proof does not outrank, a reading that failed, or a server that sets
 * no local password here.
 */
export const ONE_STEP_SIGN_IN_STATES = [
  /** The address is already verified: its holder signs in. */
  'verified',
  /** The account is linked to a sign-in provider. */
  'linked_provider',
  /** The account has a second factor enabled or enrolled. */
  'second_factor',
  /** The account has a verified phone number. */
  'verified_phone',
  /** The account's user row holds a sign-in phone number, verified or not. */
  'phone_number',
  /** The account's user row cannot be read for its sign-in identities. */
  'identity_unreadable',
  /** The account holds an API key, revoked or not. */
  'api_key',
  /** The account holds an OAuth client consent, revoked or not. */
  'oauth_consent',
  /** The account holds an OAuth access or refresh token, expired or not. */
  'oauth_token',
  /** The account registered an OAuth client. */
  'oauth_client',
  /** The account approved a device authorization, expired or not. */
  'device_code',
  /** The account registered an SSO provider. */
  'sso_provider',
  /** The account minted a SCIM credential, revoked or not. */
  'scim_credential',
  /** The account is linked to an identity provider's directory (a SCIM user, subject, projected grant or tombstone). */
  'idp_linked',
  /** The account's standing grants cannot be read. */
  'grant_unreadable',
  /** The account is provisioned by an identity provider. */
  'idp_provisioned',
  /** The account is waiting for its first single sign-on. */
  'pending_sso',
  /** The account's directory source cannot be read: judged as managed. */
  'source_unreadable',
  /** SSO-only mode: no local password is set. */
  'sso_only',
  /** Email and password sign-in is off. */
  'email_password_off',
  /** A stored value the judge does not read as carrying no claim, such as an identity source no rule names. */
  'unrecognised',
] as const;

export type OneStepSignInState = (typeof ONE_STEP_SIGN_IN_STATES)[number];

/** The `sys_user.source` values of a local account: the declared one, and none recorded. */
const LOCAL_SOURCES: ReadonlySet<string | null> = new Set<string | null>(['env_native', null]);

/** A flag that is positively off: false, or absent because its plugin is not mounted. */
function isOff(value: unknown): boolean {
  return value === false || value === null || value === undefined;
}

/**
 * Every store the plugin mounts that is keyed by a user: each column of an
 * object in `authIdentityManifest` (`manifest.ts`) that references `sys_user`
 * or whose name ends in `user_id`, classified. A test derives that set from
 * the manifest and holds it equal to this table's keys, so a store mounted
 * later fails it until it is classified here. The test finds a user column by
 * that reference or that name only: a store that held a user's id in a plain
 * column under another name would pass it unclassified. It covers the
 * manifest this plugin registers, and no store another package mounts.
 *
 * - `{ grant }`: a standing grant, a claim. The door reads it by
 *   {@link readStandingGrant}, and any row answers `sign_in` as `grant`.
 * - `{ accounts }`: a claim the judge reads from the account rows the vendor
 *   loads with the user (`accountProviders`).
 * - `{ notAClaim }`: why a row of it is no claim on the account.
 *
 * The plugin's `passkeys` flag is not wired to any plugin today, so no passkey
 * store is mounted; if it is ever wired, a passkey is a claim the judge must
 * read, and this table must classify its store.
 */
export const USER_KEYED_STORES = {
  'sys_account.user_id': { accounts: 'linked_provider' },
  'sys_api_key.user_id': { grant: 'api_key' },
  'sys_oauth_consent.user_id': { grant: 'oauth_consent' },
  'sys_oauth_access_token.user_id': { grant: 'oauth_token' },
  'sys_oauth_refresh_token.user_id': { grant: 'oauth_token' },
  'sys_oauth_application.user_id': { grant: 'oauth_client' },
  'sys_device_code.user_id': { grant: 'device_code' },
  'sys_two_factor.user_id': { grant: 'second_factor' },
  'sys_sso_provider.user_id': { grant: 'sso_provider' },
  'sys_scim_connection_credential.user_id': { grant: 'scim_credential' },
  'sys_scim_user.user_id': { grant: 'idp_linked' },
  'sys_scim_subject.user_id': { grant: 'idp_linked' },
  'sys_scim_projection_grant.user_id': { grant: 'idp_linked' },
  'sys_scim_identity_tombstone.user_id': { grant: 'idp_linked' },
  'sys_session.user_id': { notAClaim: 'The door revokes every session of the account before it sets the password.' },
  'sys_session.impersonated_by': { notAClaim: 'A session of another account, acting as that account and never as this one.' },
  'sys_member.user_id': { notAClaim: 'A membership authorizes a signed-in session and signs no one in.' },
  'sys_team_member.user_id': { notAClaim: 'A team membership authorizes a signed-in session and signs no one in.' },
  'sys_invitation.inviter_id': { notAClaim: 'An invitation the account sent grants the account nothing.' },
  'sys_user.manager_id': { notAClaim: 'Names the account as another user\'s manager and grants the account nothing.' },
  'sys_user.accountable_user_id': { notAClaim: 'Names the account as accountable for another user and signs no one in as this account.' },
  'sys_user_preference.user_id': { notAClaim: 'The account\'s own settings, which grant no access.' },
  'sys_personal_view.user_id': { notAClaim: 'The account\'s own saved list views, which grant no access.' },
  'sys_scim_group_member.scim_user_id': {
    notAClaim: 'Names a SCIM directory user, not an account; the account\'s own link is `sys_scim_user.user_id`, a claim.',
  },
  'sys_scim_projection_grant.scim_user_id': {
    notAClaim: 'Names a SCIM directory user, not an account; the same row\'s `user_id` is the claim.',
  },
  'sys_scim_connection_binding.decommission_cursor_user_id': {
    notAClaim: 'A resumable cursor of a directory connection\'s decommission pass, which grants the account nothing.',
  },
} as const satisfies Record<
  string,
  { grant: OneStepSignInState } | { accounts: OneStepSignInState } | { notAClaim: string }
>;

type UserKeyedStore = keyof typeof USER_KEYED_STORES;
type GrantStore = {
  [K in UserKeyedStore]: (typeof USER_KEYED_STORES)[K] extends { grant: OneStepSignInState } ? K : never;
}[UserKeyedStore];
type ObjectOf<S> = S extends `${infer O}.user_id` ? O : never;
/** An object whose rows are a user's standing grants. */
export type StandingGrantObject = ObjectOf<GrantStore>;

/** The standing grants, in the order the judge reports them: each object, read by `user_id`, and its reason. */
export const STANDING_GRANTS: ReadonlyArray<{ object: StandingGrantObject; reason: OneStepSignInState }> = Object.entries(
  USER_KEYED_STORES,
).flatMap(([store, cls]) =>
  'grant' in cls ? [{ object: store.slice(0, -'.user_id'.length) as StandingGrantObject, reason: cls.grant }] : [],
);

/** The objects whose rows are a user's standing grants, each read by `user_id`. */
export const STANDING_GRANT_OBJECTS: readonly StandingGrantObject[] = STANDING_GRANTS.map((g) => g.object);

/** Whether a user holds any row of one standing-grant object; `ok: false` when it cannot be read. */
export type StandingGrantReading = { ok: true; held: boolean } | { ok: false };

const SYSTEM_READ = { context: { isSystem: true, positions: [], permissions: [] } } as const;

/**
 * Does `userId` hold any row of `object`, revoked or not? One indexed read by
 * `user_id`, `id` only, as the system. A table that does not exist holds no
 * rows; any other failure, or no read surface, is `ok: false`.
 */
export async function readStandingGrant(
  engine: UserSourceReader | undefined,
  object: StandingGrantObject,
  userId: string,
): Promise<StandingGrantReading> {
  if (!engine?.find) return { ok: false };
  try {
    const rows = await engine.find(object, { where: { user_id: userId }, fields: ['id'], limit: 1 }, SYSTEM_READ);
    if (!Array.isArray(rows)) return { ok: false };
    return { ok: true, held: rows.length > 0 };
  } catch (e) {
    if (isMissingTableError(e, object)) return { ok: true, held: false };
    return { ok: false };
  }
}

/**
 * Every column of the vendor's user model (`sys_user`), its core model and
 * every column the plugins this plugin can mount add to it, classified. A
 * test composes the auth manager with every plugin flag on, derives the user
 * model's columns from it, and holds that set equal to this table's keys, so
 * a column a plugin adds later fails it until it is classified here.
 *
 * - `{ signIn }`: a sign-in identity, a claim whether or not it is verified.
 *   The door reads it from the stored row ({@link readUserRowSignIn}), and its
 *   presence answers `sign_in` as `signIn`.
 * - `{ judged }`: a value the judge reads off the user the vendor loads, and
 *   the reason it answers.
 * - `{ proven }`: the invited address, which the proof proves.
 * - `{ notASignIn }`: why the column signs no one in as the account.
 */
export const USER_ROW_COLUMNS = {
  email: { proven: 'The invited address: the proof is what proves the mailbox.' },
  email_verified: { judged: 'verified' },
  phone_number: { signIn: 'phone_number' },
  phone_number_verified: { judged: 'verified_phone' },
  two_factor_enabled: { judged: 'second_factor' },
  name: { notASignIn: 'A display name, which signs no one in.' },
  image: { notASignIn: 'A picture, which signs no one in.' },
  created_at: { notASignIn: 'A timestamp.' },
  updated_at: { notASignIn: 'A timestamp.' },
  role: { notASignIn: 'A platform role authorizes a signed-in session and signs no one in.' },
  banned: { notASignIn: 'A ban refuses sign-in and signs no one in.' },
  ban_reason: { notASignIn: 'The reason of a ban, which signs no one in.' },
  ban_expires: { notASignIn: 'The end of a ban, which signs no one in.' },
} as const satisfies Record<
  string,
  { signIn: OneStepSignInState } | { judged: OneStepSignInState } | { proven: string } | { notASignIn: string }
>;

type UserRowColumn = keyof typeof USER_ROW_COLUMNS;
/** A sign-in identity column of the user row. */
export type UserRowSignInColumn = {
  [K in UserRowColumn]: (typeof USER_ROW_COLUMNS)[K] extends { signIn: OneStepSignInState } ? K : never;
}[UserRowColumn];

/** The sign-in identities of the user row, in the order the judge reports them: each column and its reason. */
export const USER_ROW_SIGN_IN: ReadonlyArray<{ column: UserRowSignInColumn; reason: OneStepSignInState }> = Object.entries(
  USER_ROW_COLUMNS,
).flatMap(([column, cls]) => ('signIn' in cls ? [{ column: column as UserRowSignInColumn, reason: cls.signIn }] : []));

/** The user row's sign-in identity columns, as stored; `ok: false` when the row cannot be read. */
export type UserRowSignInReading =
  | { ok: true; values: Readonly<Partial<Record<UserRowSignInColumn, unknown>>> }
  | { ok: false };

/**
 * The sign-in identity columns of `userId`'s stored row. One read by `id` as
 * the system. No read surface, a failed read, or no row is `ok: false`. A row
 * that carries no value for a column reads as holding no phone number, the
 * same as a null.
 */
export async function readUserRowSignIn(engine: UserSourceReader | undefined, userId: string): Promise<UserRowSignInReading> {
  if (!engine?.find) return { ok: false };
  try {
    const columns = USER_ROW_SIGN_IN.map(({ column }) => column);
    const rows = await engine.find('sys_user', { where: { id: userId }, fields: ['id', ...columns], limit: 1 }, SYSTEM_READ);
    if (!Array.isArray(rows) || rows.length !== 1) return { ok: false };
    const row = rows[0] as Record<string, unknown>;
    return { ok: true, values: Object.fromEntries(columns.map((column) => [column, row[column]])) };
  } catch {
    return { ok: false };
  }
}

/** What the judge reads of an existing account and the server. */
export interface OneStepAccountReading {
  /** `user.emailVerified`, as stored. */
  emailVerified: unknown;
  /** The `providerId` of each of the user's account rows. */
  accountProviders: readonly unknown[];
  /** `user.twoFactorEnabled`, as stored (absent without the plugin). */
  twoFactorEnabled: unknown;
  /** `user.phoneNumberVerified`, as stored (absent without the plugin). */
  phoneNumberVerified: unknown;
  /** The sign-in identity columns of the stored user row ({@link readUserRowSignIn}). */
  userRowSignIn: UserRowSignInReading;
  /** Any row of the user in each standing-grant object ({@link readStandingGrant}). */
  standingGrants: Readonly<Record<StandingGrantObject, StandingGrantReading>>;
  /** `sys_user.source`, or `ok: false` when it cannot be read. */
  source: { ok: true; value: string | null } | { ok: false };
  /** SSO-only mode. */
  ssoOnly: boolean;
  /** `emailAndPassword.enabled`. */
  emailPasswordEnabled: unknown;
}

/**
 * The judge of the closing rule, an allow-list: `undefined` (the door may set
 * the password) only when every reading is positively the no-other-claim
 * value, and otherwise the reason the account answers `sign_in`. A value no
 * rule here names is `unrecognised`, never a pass.
 */
export function oneStepSignInState(account: OneStepAccountReading): OneStepSignInState | undefined {
  if (account.emailVerified !== false) return account.emailVerified === true ? 'verified' : 'unrecognised';
  if (!account.accountProviders.every((providerId) => providerId === 'credential')) return 'linked_provider';
  if (!isOff(account.twoFactorEnabled)) return account.twoFactorEnabled === true ? 'second_factor' : 'unrecognised';
  if (!isOff(account.phoneNumberVerified)) return account.phoneNumberVerified === true ? 'verified_phone' : 'unrecognised';
  if (account.userRowSignIn?.ok !== true) return 'identity_unreadable';
  for (const { column, reason } of USER_ROW_SIGN_IN) {
    const value = account.userRowSignIn.values[column];
    if (value === null || value === undefined) continue;
    return typeof value === 'string' && value.trim().length > 0 ? reason : 'unrecognised';
  }
  const grants = STANDING_GRANTS.map((grant) => ({ ...grant, reading: account.standingGrants[grant.object] }));
  if (grants.some(({ reading }) => reading?.ok !== true)) return 'grant_unreadable';
  const held = grants.find(({ reading }) => reading.ok && reading.held !== false);
  if (held) return held.reason;
  if (!account.source.ok) return 'source_unreadable';
  const source = account.source.value;
  if (!LOCAL_SOURCES.has(source)) {
    if (isIdpProvisionedSource(source)) return 'idp_provisioned';
    if (isPendingSsoSource(source)) return 'pending_sso';
    return 'unrecognised';
  }
  if (account.ssoOnly !== false) return 'sso_only';
  if (account.emailPasswordEnabled !== true) return 'email_password_off';
  return undefined;
}

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

  // Per door instance: the window counts somewhere even with no shared store.
  const fallbackCounters = new InProcessCounterStore();

  const refuseProof = (): never => {
    throw new APIError('BAD_REQUEST', { code: 'INVALID_TOKEN', message: INVALID_PROOF_MESSAGE });
  };

  const rateLimit = async (keys: string[]) => {
    let store: CounterStore = fallbackCounters;
    try {
      store = (await host.counterStore?.()) ?? fallbackCounters;
    } catch {
      store = fallbackCounters;
    }
    for (const key of keys) {
      const { count, resetAt } = await incrementFixedWindow(store, key, INVITATION_PROOF_RATE_LIMIT.window);
      if (count > INVITATION_PROOF_RATE_LIMIT.max) {
        throw new APIError('TOO_MANY_REQUESTS', {
          code: 'RATE_LIMIT_EXCEEDED',
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
    ACCEPT_INVITATION_ONE_STEP_PATH,
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
        if (!sameAddress || session.user.emailVerified !== true) return ctx.json({ success: true, data: { outcome: 'verify_email' } });
        await acceptAs(session.session.token, invitationId);
        return ctx.json({ success: true, data: { outcome: 'accepted', organizationId: invitation.organizationId } });
      }

      // ── Proof mode ─────────────────────────────────────────────────────
      // A cloud-managed environment sets no local password for anyone
      // (`cloud-managed.ts`); asked before the proof is read, so it stays unspent.
      if (isCloudManaged()) {
        throw new APIError('CONFLICT', {
          code: CLOUD_MANAGED_REFUSAL_CODE,
          message: CLOUD_MANAGED_REFUSAL_MESSAGES.acceptInvitationOneStep,
        });
      }
      if (!pending) return refuseProof();
      const identifier = invitationProofIdentifier(invitationId);
      const internal = ctx.context.internalAdapter;
      const stored = await internal.findVerificationValue(identifier);
      if (!(await admits(parseStored(stored?.value), proof, invitation))) return refuseProof();

      const email = invitation.email.toLowerCase();
      const signIn = () => ctx.json({ success: true, data: { outcome: 'sign_in' } });
      // Every reading of the closing rule, judged. Taken before anything is
      // written, and again once the account's sessions are revoked.
      const judge = async (found: any): Promise<OneStepSignInState | undefined> => {
        const engine = host.getDataEngine() as UserSourceReader | undefined;
        const userId = String(found.user.id);
        const [source, userRowSignIn, grantReadings] = await Promise.all([
          readUserSource(engine, userId),
          readUserRowSignIn(engine, userId),
          Promise.all(STANDING_GRANT_OBJECTS.map((object) => readStandingGrant(engine, object, userId))),
        ]);
        const standingGrants = Object.fromEntries(
          STANDING_GRANT_OBJECTS.map((object, i) => [object, grantReadings[i]]),
        ) as Record<StandingGrantObject, StandingGrantReading>;
        return oneStepSignInState({
          emailVerified: found.user.emailVerified,
          accountProviders: (found.accounts ?? []).map((a: any) => a?.providerId),
          twoFactorEnabled: found.user.twoFactorEnabled,
          phoneNumberVerified: found.user.phoneNumberVerified,
          userRowSignIn,
          standingGrants,
          source,
          ssoOnly: host.isSsoOnlyMode(),
          emailPasswordEnabled: ctx.context.options.emailAndPassword?.enabled,
        });
      };
      const found = await internal.findUserByEmail(email, { includeAccounts: true });
      const existing = found?.user;
      if (existing && (await judge(found))) return signIn();

      const password = typeof body.password === 'string' ? body.password : '';
      const passwordConfig = ctx.context.password.config;
      if (password.length < passwordConfig.minPasswordLength) {
        throw new APIError('BAD_REQUEST', { code: 'PASSWORD_POLICY_VIOLATION', message: 'Password too short' });
      }
      if (password.length > passwordConfig.maxPasswordLength) {
        throw new APIError('BAD_REQUEST', { code: 'PASSWORD_POLICY_VIOLATION', message: 'Password too long' });
      }
      const name = nonEmpty(body.name);

      if (!existing) {
        const ep = ctx.context.options.emailAndPassword;
        if (!ep?.enabled || ep.disableSignUp) {
          throw new APIError('FORBIDDEN', {
            code: 'PERMISSION_DENIED',
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

      // ADR-0069 D1, as the reset door: the password history is consulted
      // before the proof is spent, so a reused password leaves it usable.
      let historyHash: string | undefined;
      if (existing) {
        const pw = ctx.context.password;
        historyHash = await host.assertPasswordNotReused(String(existing.id), password, pw.verify.bind(pw));
      }

      // Hashed before the proof is spent: a password the hash step refuses
      // (a breached one) leaves the proof usable.
      const passwordHash = await ctx.context.password.hash(password);

      const sameProof = (row: { value: string } | null | undefined) =>
        !!row && parseStored(row.value)?.h === parseStored(stored?.value)?.h;
      if (existing) {
        const userId = String(existing.id);
        // The sessions are revoked before the password is written, which
        // matches the vendor's order on its own password doors, and only while
        // the proof this request admitted is still at rest.
        if (!sameProof(await internal.findVerificationValue(identifier))) return refuseProof();
        await internal.deleteUserSessions(userId);
        // Every reading again, now that no session of the account can make a
        // claim: one made after the first reading, a reading that fails, or
        // another account at the address answers `sign_in`. Taken before the
        // proof is spent, so it stays unspent; the sessions stay revoked.
        const again: OneStepSignInState | undefined = await internal
          .findUserByEmail(email, { includeAccounts: true })
          .then((reread: any) => (String(reread?.user?.id) === userId ? judge(reread) : 'unrecognised'))
          .catch(() => 'identity_unreadable');
        if (again) return signIn();
      }

      const consumed = await internal.consumeVerificationValue(identifier);
      if (!sameProof(consumed)) return refuseProof();

      let user: any;
      if (!existing) {
        user = await internal.createUser({ email, name, emailVerified: true }, { method: 'email-password' });
        await internal.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: passwordHash });
      } else {
        const userId = String(existing.id);
        if (await internal.findCredentialAccount(userId)) {
          await internal.updatePassword(userId, passwordHash);
          if (historyHash) await host.recordPasswordHistory(userId, historyHash);
        } else {
          await internal.createAccount({ userId, providerId: 'credential', accountId: userId, password: passwordHash });
        }
        user = await internal.updateUser(userId, { emailVerified: true, ...(name ? { name } : {}) });
      }
      // ADR-0069 D1: the password-age stamp and the forced-change clear.
      await host.stampPasswordChangedAt(String(user.id));
      // A credential change ends access issued before it: the account's
      // sessions are ended again now that the password is written, ahead of
      // the one this door opens (`credential-change-ends-prior-access.ts`).
      if (existing) await endSessionsAfterCredentialWrite(internal, String(user.id));

      const session = await internal.createSession(user.id, false);
      if (!session) throw new APIError('INTERNAL_SERVER_ERROR', { code: 'INTERNAL_ERROR', message: 'Failed to create a session.' });
      await setSessionCookie(ctx, { session, user });
      await acceptAs(session.token, invitationId);
      return ctx.json({ success: true, data: { outcome: 'accepted', organizationId: invitation.organizationId } });
    },
  );

  return {
    id: 'invitation-mailbox-proof',
    endpoints: { acceptInvitationOneStep: endpoint },
  };
}
