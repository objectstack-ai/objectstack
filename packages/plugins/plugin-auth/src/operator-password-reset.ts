// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The operator's password reset, run on the server against the project
 * database: `os user set-password <email>` (`@objectstack/cli`).
 *
 * A server that is not in development mode refuses a development seed
 * credential (`dev-seed-credential.ts`) and opens no session in which it could
 * be changed, because whoever signed in first could change it. This is the way
 * out: the operator, who holds the server, sets a new password directly.
 *
 * ## What one reset does
 *
 * - **Checks two things about the new password:** it is not a development
 *   seed password, and its length is within better-auth's default bounds (8
 *   to 128). The deployment's own password policy and history are not applied.
 * - **Writes the account's password credential** (`sys_account`, provider
 *   `credential`) with better-auth's own hash, the one every server verifies.
 *   An account with no password credential is refused: this sets a password,
 *   it does not add a way to sign in that the account did not have.
 * - **Clears the seed stamp** (`sys_user.dev_seed_credential`), stamps
 *   `password_changed_at`, and clears a sign-in lock, so the new password
 *   signs in at once.
 * - **Ends every outstanding password-reset token** of the account before the
 *   password lands, as every door that sets a password does
 *   (`credential-change-ends-reset-tokens.ts`). The CLI holds no server cache,
 *   so it ends the token rows, as the raw adapter (handed no secondary storage)
 *   does.
 * - **Ends every session and revokes every API key** of the account, as an
 *   administrator's forced reset with revocation does
 *   (`forced-reset-revocation.ts`, `admin_password_reset`): the sessions and
 *   keys issued under the old password do not outlive it.
 *
 * It asks for no password change at the next sign-in: the operator chose the
 * password.
 */

import { SystemObjectName } from '@objectstack/spec/system';
import { DEV_SEED_CREDENTIAL_FIELD, isDevSeedPassword } from './dev-seed-credential.js';
import { revokeSessionsAndApiKeys } from './forced-reset-revocation.js';
import { endResetTokensOnCredentialWrite } from './credential-change-ends-reset-tokens.js';

/** better-auth's default bounds for a password (`emailAndPassword.minPasswordLength` / `maxPasswordLength`). */
export const OPERATOR_PASSWORD_MIN_LENGTH = 8;
export const OPERATOR_PASSWORD_MAX_LENGTH = 128;

/** The slice of the data engine the reset reads and writes through. */
export interface OperatorPasswordResetEngine {
  find(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
  findOne(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
  update(object: string, doc: Record<string, unknown>, opts?: unknown): Promise<unknown>;
  delete(object: string, options?: unknown): Promise<unknown>;
}

/** Why a reset was refused. Nothing was written. */
export type OperatorPasswordResetRefusalReason =
  | 'password_too_short'
  | 'password_too_long'
  | 'dev_seed_password'
  | 'no_user'
  | 'no_local_password';

/** What one reset did. */
export type OperatorPasswordResetOutcome =
  | {
      outcome: 'set';
      userId: string;
      /** Sessions ended and API keys revoked. */
      sessionsEnded: number;
      apiKeysRevoked: number;
      /** `false` when a session or key could not be read or revoked; the password is set either way. */
      revocationComplete: boolean;
    }
  | { outcome: 'refused'; reason: OperatorPasswordResetRefusalReason; message: string };

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

function rowsOf(result: unknown): Array<Record<string, any>> {
  if (Array.isArray(result)) return result as Array<Record<string, any>>;
  const value = (result as { value?: unknown } | null)?.value;
  return Array.isArray(value) ? (value as Array<Record<string, any>>) : [];
}

/** Why `password` cannot be set, or `undefined` when it can. */
export function operatorPasswordRefusal(
  password: string,
): { reason: OperatorPasswordResetRefusalReason; message: string } | undefined {
  if (password.length < OPERATOR_PASSWORD_MIN_LENGTH) {
    return {
      reason: 'password_too_short',
      message: `The password must be at least ${OPERATOR_PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (password.length > OPERATOR_PASSWORD_MAX_LENGTH) {
    return {
      reason: 'password_too_long',
      message: `The password must be at most ${OPERATOR_PASSWORD_MAX_LENGTH} characters.`,
    };
  }
  if (isDevSeedPassword(password)) {
    return {
      reason: 'dev_seed_password',
      message: 'That is the development seed password, which a server outside development mode refuses. Choose another.',
    };
  }
  return undefined;
}

/** The account `email` names, by its stored (lower-case) address. */
export async function findAccountByEmail(
  engine: OperatorPasswordResetEngine,
  email: string,
): Promise<{ id: string; email: string } | undefined> {
  const address = email.trim().toLowerCase();
  if (!address) return undefined;
  const rows = rowsOf(
    await engine.find(SystemObjectName.USER, { where: { email: address }, fields: ['id', 'email'], limit: 1 }, { context: SYSTEM_CTX }),
  );
  const row = rows[0];
  return typeof row?.id === 'string' && row.id ? { id: row.id, email: String(row.email ?? address) } : undefined;
}

/**
 * Set `password` on the account `email` names. Refusals write nothing; a set
 * password is reported with what the revocation did.
 */
export async function setOperatorPassword(
  engine: OperatorPasswordResetEngine,
  input: { email: string; password: string },
  opts: { logger?: { warn(message: string): void }; now?: () => Date } = {},
): Promise<OperatorPasswordResetOutcome> {
  const refusal = operatorPasswordRefusal(input.password);
  if (refusal) return { outcome: 'refused', ...refusal };

  const user = await findAccountByEmail(engine, input.email);
  if (!user) {
    return { outcome: 'refused', reason: 'no_user', message: `No account has the email address ${input.email.trim()}.` };
  }
  const credential = rowsOf(
    await engine.find(
      SystemObjectName.ACCOUNT,
      { where: { user_id: user.id, provider_id: 'credential' }, fields: ['id'], limit: 1 },
      { context: SYSTEM_CTX },
    ),
  )[0];
  if (typeof credential?.id !== 'string' || !credential.id) {
    return {
      outcome: 'refused',
      reason: 'no_local_password',
      message: `The account ${user.email} has no password sign-in (it signs in another way), so no password was set.`,
    };
  }

  const { hashPassword } = await import('better-auth/crypto');
  const now = (opts.now ?? (() => new Date()))();
  const credentialWrite = { id: credential.id, password: await hashPassword(input.password), updated_at: now };
  // Before the write, as the adapters do: a token that cannot be ended aborts
  // it, and the old password stands (`credential-change-ends-reset-tokens.ts`).
  await endResetTokensOnCredentialWrite(
    {
      find: async (object, query) => rowsOf(await engine.find(object, { ...query, context: SYSTEM_CTX })),
      findOne: (object, query) => engine.findOne(object, { ...query, context: SYSTEM_CTX }),
      delete: (object, query) => engine.delete(object, { ...query, context: SYSTEM_CTX }),
    },
    SystemObjectName.ACCOUNT,
    credentialWrite,
    [{ user_id: user.id }],
  );
  await engine.update(SystemObjectName.ACCOUNT, credentialWrite, { context: SYSTEM_CTX });
  await engine.update(
    SystemObjectName.USER,
    {
      id: user.id,
      [DEV_SEED_CREDENTIAL_FIELD]: null,
      password_changed_at: now,
      failed_login_count: 0,
      locked_until: null,
    },
    { context: SYSTEM_CTX },
  );
  const revocation = await revokeSessionsAndApiKeys(engine, user.id, { logger: opts.logger });
  return {
    outcome: 'set',
    userId: user.id,
    sessionsEnded: revocation.sessions,
    apiKeysRevoked: revocation.apiKeys,
    revocationComplete: revocation.complete,
  };
}
