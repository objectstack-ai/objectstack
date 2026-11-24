// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A production-mode server never accepts a development seed credential.
 *
 * `os dev` seeds a well-known admin (`AuthPlugin.maybeSeedDevAdmin`) and a
 * stack's `demoStaff` (`demo-staff.ts`), all on the development seed password
 * (`devSeedAdminPassword()`: `OS_SEED_ADMIN_PASSWORD`, else `admin123`). Those
 * credentials belong to the development database. A server that is not in
 * development mode refuses them, whoever serves the database — `os start`,
 * `os serve`, the image or a custom host — because the refusal lives here, in
 * the auth plugin, and not in any one command.
 *
 * "Production mode" is every `NODE_ENV` but `development`: the one clause the
 * seed itself is gated on (`isDevAdminSeedArmed`), read when each check runs.
 *
 * ## The rules
 *
 * 1. **The seed password is refused at sign-in, on any account.** A password
 *    sign-in that submits the development seed password — `admin123`, and the
 *    value `OS_SEED_ADMIN_PASSWORD` names when it is set — is refused with
 *    `403 PERMISSION_DENIED` and a sentence naming the operator reset command
 *    ({@link refuseDevSeedPasswordSignIn}). It is decided on the submitted
 *    password alone, before any account is read, so the answer is the same
 *    for every address, one that exists or not: it tells a caller nothing
 *    about any account. This covers the seeded accounts, any other account on
 *    that password, and databases seeded before the stamp below existed.
 * 2. **The verifier never accepts a seed credential** ({@link
 *    withDevSeedPasswordRefusal}). Every door that checks a password —
 *    the sign-in doors, and a password confirmation such as change-password's
 *    current password — gets "no match" for the seed password, and for the
 *    password a stamped account still holds from the seed. Those doors then
 *    answer exactly what a wrong password answers, so a correct seed password
 *    is never confirmed to a caller.
 * 3. **A stamped account opens no new session** ({@link
 *    refuseDevSeedCredentialSession}). The accounts the seed creates are
 *    stamped (below). While a stamped account's stored password hash is still
 *    the one the seed stored, `session.create.before` refuses every session
 *    for it — password, magic link, one-time code, passkey, social or SSO
 *    sign-in, impersonation, a minted session — with `403 PERMISSION_DENIED`
 *    naming the reset command. A custom seed password (`os dev
 *    --admin-password`, `OS_SEED_ADMIN_PASSWORD`) is caught this way too,
 *    without the server ever knowing it.
 * 4. **No forced change at sign-in.** None of the refusals opens a session in
 *    which the password could be changed: whoever signed in first could
 *    perform it. The one way out is the operator's reset on the server,
 *    `os user set-password` (`operator-password-reset.ts`).
 *
 * ## The stamp
 *
 * `sys_user.dev_seed_credential` holds a one-way digest (SHA-256) of the
 * password hash the seed stored, never the password: a digest of a salted
 * hash opens nothing, and the column is `internal`, so it is never served on
 * the generic data path and is only matched by the server. "Still on the seed
 * password" is "the stored hash still has this digest": any password change,
 * through any door, writes a new salted hash and the stamp stops matching.
 *
 * It is written once, when the seed creates the account, in development: the
 * audience gate (`validateAudienceAdmission`) stages it for a creation that
 * proved the seed's own provisioning ticket for its address, and no other
 * (an administrator's create-user, a bulk import and directory provisioning
 * share the operator class, never the ticket; {@link stageDevSeedCredential}),
 * and `account.create.after` writes it when
 * that creation's password credential lands ({@link stampDevSeedCredential}).
 *
 * ## What it does not detect
 *
 * A database seeded before the stamp existed, on a custom seed password,
 * carries no stamp and no well-known password, so nothing marks it. Rule 1
 * covers such a database on the default seed password.
 */

import { defineRequestState } from '@better-auth/core/context';
import { SystemObjectName } from '@objectstack/spec/system';
import { devSeedAdminPassword } from './walled-owner-verification-path.js';
import { recoverInternalFieldsForSystemRead } from './internal-field-readback.js';
import type { PasswordHasher } from './sign-in-lockout-refusal.js';

/** The `sys_user` column the seed stamps. */
export const DEV_SEED_CREDENTIAL_FIELD = 'dev_seed_credential';

/** The development seed password when `OS_SEED_ADMIN_PASSWORD` is unset. */
export const DEFAULT_DEV_SEED_PASSWORD = 'admin123';

/** The command an operator runs on the server to set a new password. */
export const OPERATOR_PASSWORD_RESET_COMMAND = 'os user set-password';

/**
 * The refusal a password sign-in meets when it submits the development seed
 * password, on a server that is not in development mode.
 */
export const DEV_SEED_PASSWORD_REFUSAL = Object.freeze({
  code: 'PERMISSION_DENIED',
  message:
    'This password is the development seed password, and a server that is not in development mode does not '
    + `accept it. An operator sets a new password on the server with \`${OPERATOR_PASSWORD_RESET_COMMAND} <email>\`.`,
});

/**
 * The refusal a session meets for an account the development seed created
 * while its password is still the seed password.
 */
export const DEV_SEED_CREDENTIAL_SESSION_REFUSAL = Object.freeze({
  code: 'PERMISSION_DENIED',
  message:
    'This account was created by the development seed and still has its seed password, so a server that is not in '
    + 'development mode opens no session for it. An operator sets a new password on the server with '
    + `\`${OPERATOR_PASSWORD_RESET_COMMAND} <email>\`.`,
});

/**
 * The better-auth endpoints that sign in with a submitted `password`. The
 * verifier (rule 2) covers a door missing here; this list is where the
 * refusal names the reset command.
 */
export const PASSWORD_SIGN_IN_PATHS: ReadonlySet<string> = new Set([
  '/sign-in/email',
  '/sign-in/username',
  '/sign-in/phone-number',
]);

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

const env = (): Record<string, string | undefined> =>
  ((globalThis as { process?: { env?: Record<string, string | undefined> } })?.process?.env ?? {});

/**
 * Whether this process is in development mode: `NODE_ENV === 'development'`,
 * the clause the development seed is gated on, read on every call.
 */
export function isDevelopmentMode(): boolean {
  return env().NODE_ENV === 'development';
}

/**
 * Whether `password` is a development seed password: `admin123`, or the value
 * `OS_SEED_ADMIN_PASSWORD` sets for this process.
 */
export function isDevSeedPassword(password: unknown): boolean {
  if (typeof password !== 'string' || password === '') return false;
  return password === DEFAULT_DEV_SEED_PASSWORD || password === devSeedAdminPassword();
}

/** The digest a stamp holds for a stored password hash: SHA-256, base64url. */
export async function devSeedCredentialDigest(storedHash: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(storedHash));
  return Buffer.from(new Uint8Array(digest)).toString('base64url');
}

/** The slice of the data engine this module reads and writes through. */
export interface DevSeedCredentialEngine {
  find(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
  update?(object: string, doc: Record<string, unknown>, opts?: unknown): Promise<unknown>;
}

function rowsOf(result: unknown): Array<Record<string, any>> {
  if (Array.isArray(result)) return result as Array<Record<string, any>>;
  const value = (result as { value?: unknown } | null)?.value;
  return Array.isArray(value) ? (value as Array<Record<string, any>>) : [];
}

// ── Rule 1: the submitted seed password, before any account is read ─────────

/**
 * Refuse a password sign-in that submits a development seed password, on a
 * server that is not in development mode. Runs ahead of every other hook, so
 * it reads no account and counts toward no lock. Throws the refusal; returns
 * otherwise.
 */
export async function refuseDevSeedPasswordSignIn(ctx: { path?: unknown; body?: unknown } | undefined): Promise<void> {
  if (isDevelopmentMode()) return;
  if (typeof ctx?.path !== 'string' || !PASSWORD_SIGN_IN_PATHS.has(ctx.path)) return;
  if (!isDevSeedPassword((ctx.body as { password?: unknown } | undefined)?.password)) return;
  const { APIError } = await import('better-auth/api');
  throw new APIError('FORBIDDEN', { code: DEV_SEED_PASSWORD_REFUSAL.code, message: DEV_SEED_PASSWORD_REFUSAL.message });
}

// ── Rule 2: the verifier ─────────────────────────────────────────────────────

/**
 * Whether a stamped account still holds `storedHash`, the password hash the
 * seed stored for it. Answers the account's id, or `undefined`.
 */
async function stampedHolderOf(engine: DevSeedCredentialEngine, storedHash: string): Promise<string | undefined> {
  const rows = rowsOf(
    await engine.find(
      SystemObjectName.USER,
      {
        where: { [DEV_SEED_CREDENTIAL_FIELD]: await devSeedCredentialDigest(storedHash) },
        fields: ['id'],
        limit: 1,
      },
      { context: SYSTEM_CTX },
    ),
  );
  const id = rows[0]?.id;
  return typeof id === 'string' && id ? id : undefined;
}

/**
 * The password pair handed to better-auth, with one change on a server that is
 * not in development mode: after the real verification (run in full, so a
 * refusal costs what a wrong password costs), a match is answered "no match"
 * when the password is a development seed password, or when the hash is the
 * one a stamped account still holds from the seed. A read that fails answers
 * "no match": a credential that cannot be cleared is not accepted.
 */
export function withDevSeedPasswordRefusal(
  hasher: PasswordHasher,
  deps: {
    engine: () => DevSeedCredentialEngine | undefined;
    logger?: () => { warn?(message: string): void } | undefined;
  },
): PasswordHasher {
  return {
    hash: (password) => hasher.hash(password),
    verify: async (args) => {
      const verified = await hasher.verify(args);
      if (!verified || isDevelopmentMode()) return verified;
      if (isDevSeedPassword(args.password)) return false;
      const engine = deps.engine();
      if (!engine || typeof engine.find !== 'function') return true;
      try {
        const holder = await stampedHolderOf(engine, args.hash);
        if (!holder) return true;
        deps.logger?.()?.warn?.(
          `[auth] a password for user ${holder} was refused: the account was created by the development seed and `
            + 'still has its seed password, which a server that is not in development mode does not accept. '
            + `Remedy: set a new password on the server with \`${OPERATOR_PASSWORD_RESET_COMMAND} <email>\`.`,
        );
        return false;
      } catch {
        // Fail closed, on purpose: when the mark cannot be read, a correct
        // password is answered as a wrong one rather than accepted unchecked.
        // That answer is a failed sign-in like any other, so it counts toward
        // the account's sign-in lock.
        return false;
      }
    },
  };
}

// ── Rule 3: no session for a stamped account still on its seed password ─────

/**
 * Whether `userId` is a stamped account whose stored password hash is still the
 * one the seed stored. One read for an account the seed never stamped (the
 * common case); a stamped one adds its credential read. A read that fails
 * throws.
 */
export async function isDevSeedCredentialInForce(
  engine: DevSeedCredentialEngine,
  userId: string,
): Promise<boolean> {
  const stamped = rowsOf(
    await engine.find(
      SystemObjectName.USER,
      { where: { id: userId, [DEV_SEED_CREDENTIAL_FIELD]: { $null: false } }, fields: ['id'], limit: 1 },
      { context: SYSTEM_CTX },
    ),
  );
  if (stamped.length === 0) return false;
  const accounts = rowsOf(
    await engine.find(
      SystemObjectName.ACCOUNT,
      { where: { user_id: userId, provider_id: 'credential' }, fields: ['id', 'password'], limit: 1 },
      { context: SYSTEM_CTX },
    ),
  );
  await recoverInternalFieldsForSystemRead(engine as never, SystemObjectName.ACCOUNT, accounts, ['password']);
  const hash = accounts[0]?.password;
  if (typeof hash !== 'string' || hash === '') return false;
  return (await stampedHolderOf(engine, hash)) === userId;
}

/**
 * `session.create.before`: refuse every session for a stamped account still on
 * its seed password, on a server that is not in development mode. A read that
 * fails refuses the session `503`, as the other session refusals do.
 */
export async function refuseDevSeedCredentialSession(
  engine: DevSeedCredentialEngine | undefined,
  session: unknown,
): Promise<void> {
  if (isDevelopmentMode()) return;
  const userId = (session as { userId?: unknown } | null | undefined)?.userId;
  if (typeof userId !== 'string' || !userId || !engine || typeof engine.find !== 'function') return;
  let held: boolean;
  try {
    held = await isDevSeedCredentialInForce(engine, userId);
  } catch (cause) {
    const { APIError } = await import('better-auth/api');
    const err = new APIError('SERVICE_UNAVAILABLE', {
      code: 'SERVICE_UNAVAILABLE',
      message: 'The account could not be read to open a session. Try again.',
    });
    (err as { cause?: unknown }).cause = cause;
    throw err;
  }
  if (!held) return;
  const { APIError } = await import('better-auth/api');
  throw new APIError('FORBIDDEN', {
    code: DEV_SEED_CREDENTIAL_SESSION_REFUSAL.code,
    message: DEV_SEED_CREDENTIAL_SESSION_REFUSAL.message,
  });
}

// ── The stamp, written when the seed creates an account ─────────────────────

/** The address of the creation the audience gate admitted as the seed's own. */
const stagedSeedCreation = defineRequestState<{ email: string } | undefined>(() => undefined);

/**
 * Stage the stamp for the creation running in this request: called by the
 * audience gate for a creation that proved the development seed's own
 * provisioning ticket (`os dev`'s admin, a stack's `demoStaff`). Nothing is staged outside
 * development mode. Never throws.
 */
export async function stageDevSeedCredential(email: string): Promise<void> {
  if (!isDevelopmentMode() || typeof email !== 'string' || email.trim() === '') return;
  try {
    await stagedSeedCreation.set({ email: email.trim().toLowerCase() });
  } catch {
    /* no request state is open: nothing is staged */
  }
}

/**
 * `account.create.after`: when this request staged the seed's creation and the
 * account that landed is its password credential, write the stamp on the
 * account's user. Never throws: the account exists either way, and a stamp
 * that did not land is reported at `error`, naming what it costs.
 */
export async function stampDevSeedCredential(
  engine: DevSeedCredentialEngine | undefined,
  account: unknown,
  logger?: { error?(message: string, meta?: Record<string, unknown>): void; warn(message: string, meta?: Record<string, unknown>): void },
): Promise<void> {
  let staged: { email: string } | undefined;
  try {
    staged = await stagedSeedCreation.get();
  } catch {
    return;
  }
  if (!staged || !isDevelopmentMode()) return;
  const row = account as Record<string, unknown> | null | undefined;
  const providerId = row?.providerId ?? row?.provider_id;
  const userId = row?.userId ?? row?.user_id;
  if (providerId !== 'credential' || typeof userId !== 'string' || !userId) return;
  if (!engine || typeof engine.find !== 'function' || typeof engine.update !== 'function') return;
  try {
    const users = rowsOf(
      await engine.find(SystemObjectName.USER, { where: { id: userId }, fields: ['id', 'email'], limit: 1 }, { context: SYSTEM_CTX }),
    );
    if (String(users[0]?.email ?? '').toLowerCase() !== staged.email) return;
    let hash = row?.password;
    if ((typeof hash !== 'string' || hash === '') && typeof row?.id === 'string') {
      const accounts = [{ id: row.id } as Record<string, unknown>];
      await recoverInternalFieldsForSystemRead(engine as never, SystemObjectName.ACCOUNT, accounts, ['password']);
      hash = accounts[0].password;
    }
    if (typeof hash !== 'string' || hash === '') {
      throw new Error('the credential row carries no password hash');
    }
    await engine.update(
      SystemObjectName.USER,
      { id: userId, [DEV_SEED_CREDENTIAL_FIELD]: await devSeedCredentialDigest(hash) },
      { context: SYSTEM_CTX },
    );
    await stagedSeedCreation.set(undefined);
  } catch (e) {
    const message =
      `[auth] the development seed created user ${userId} but its seed stamp was NOT written: the account works, `
        + 'and on a server that is not in development mode it is refused only while its password is the default '
        + `seed password, not a custom one. Remedy: set a new password with \`${OPERATOR_PASSWORD_RESET_COMMAND} <email>\` `
        + 'before serving this database outside development, or delete the database and seed it again.';
    const meta = { error: (e as Error)?.message };
    if (logger?.error) logger.error(message, meta);
    else logger?.warn(message, meta);
  }
}
