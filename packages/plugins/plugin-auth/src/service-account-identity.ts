// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D1/D2] The AI service account as a `sys_user` row: its kind, its
 * accountable owner, and the refusal that keeps it from ever signing in.
 *
 * An AI service account is a `sys_user` row whose `principal_kind` is `agent`.
 * It is a registered principal of its own: it acts only through its own API
 * keys, never through a session. This module holds the rules that make that
 * true on the row and at the identity driver; the doors that register an
 * account and mint its keys are their own modules.
 *
 * ## The row rules (D1), for every writer
 *
 * Registered as `sys_user` engine hooks, judged on EVERY write — a user
 * context, a system context and better-auth's own adapter writes alike. The
 * ADR-0092 D2 identity write guard already refuses a user-context create and
 * strips both columns from a user-context update (they are `readonly` and
 * not whitelisted), so in practice these rules bind the system writers: a
 * flow running as the system, a host's own write, an import. ADR-0151 D1 says
 * "refused for every caller, `isSystem` included", and so they are.
 *
 *  1. **Born with its kind.** An insert writes `principal_kind` as `human`,
 *     `agent`, or not at all (the column's default, `human`). Any other value
 *     is refused: `service`, `guest` and `system` are not row kinds.
 *  2. **The kind never changes.** An update whose `principal_kind` differs
 *     from the stored one is refused, on the by-id path and per row on a
 *     multi-row update. An absent or empty stored value reads as `human`, so
 *     writing `human` onto an old row changes nothing and passes; writing
 *     `agent` onto it is refused. A human row turned into an agent, or an agent
 *     into a person, would defeat both the sign-in refusal below and the count
 *     the licence layer takes of `agent` rows.
 *  3. **An agent has an accountable owner; a person has none.** An `agent`
 *     row carries `accountable_user_id`, naming an existing `human` row other
 *     than itself; a `human` row carries none. An update that clears the owner
 *     of an agent, sets one on a person, or names an owner who is missing or is
 *     itself an agent is refused. That the owner is a member of the account's
 *     organization is the registration and change-owner doors' rule: those
 *     acts know the organization, and the row does not carry one.
 *
 * Refusals are `400 VALIDATION_FAILED` with one `fields[]` entry from the
 * closed ADR-0114 catalog (`required`, `invalid_value`, `reference_not_found`),
 * built by `validationFailure` — the envelope every dispatcher already maps.
 *
 * ## The sign-in refusal (D2), in the identity driver
 *
 * Every session better-auth creates goes through `internalAdapter.createSession`,
 * and so through the `session.create.before` database hook: password, magic
 * link, one-time code, passkey, social and SSO sign-in, two-factor completion,
 * the device and one-time-token grants, impersonation (and its bearer
 * rotation) and the principal-session mint. Every sign-in credential goes
 * through `createAccount` / `linkAccount` / `createOAuthUser`, and so through
 * `account.create.before`. {@link refuseAgentAccountSession} and
 * {@link refuseAgentAccountCredential} are composed into those two hooks
 * (`auth-manager-database-hooks.ts`), FIRST, for every caller: one refusal
 * below every sign-in surface, so a surface that forgets the kind cannot hand
 * an account a session.
 *
 * Both answer better-auth's `FORBIDDEN` with `code: 'PERMISSION_DENIED'`. A
 * read of the row that throws refuses too: an unknown kind is not a person.
 */

import { SystemObjectName } from '@objectstack/spec/system';
import { validationFailure } from '@objectstack/types';

/** The `sys_user.principal_kind` value of an AI service account. */
export const AGENT_PRINCIPAL_KIND = 'agent';

/** The `sys_user.principal_kind` value of a person, and what an absent value reads as. */
export const HUMAN_PRINCIPAL_KIND = 'human';

/** The kinds a `sys_user` row may be born with (ADR-0151 D1). */
export const ROW_PRINCIPAL_KINDS: readonly string[] = Object.freeze([HUMAN_PRINCIPAL_KIND, AGENT_PRINCIPAL_KIND]);

/** The columns of a `sys_user` row this module reads. */
export const SERVICE_ACCOUNT_ROW_FIELDS = ['id', 'principal_kind', 'accountable_user_id'] as const;

const USER_OBJECT = SystemObjectName.USER;
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The refusal a session for an AI service account gets, on every sign-in method. */
export const AGENT_ACCOUNT_SESSION_REFUSAL = Object.freeze({
  code: 'PERMISSION_DENIED',
  message:
    'An AI service account cannot sign in or hold a session. It acts only through API keys that its owner or an '
      + 'administrator creates for it.',
});

/** The refusal a password or sign-in provider link for an AI service account gets. */
export const AGENT_ACCOUNT_CREDENTIAL_REFUSAL = Object.freeze({
  code: 'PERMISSION_DENIED',
  message:
    'An AI service account holds no password and no sign-in provider link. It acts only through API keys that its '
      + 'owner or an administrator creates for it.',
});

/**
 * The kind a stored `principal_kind` value reads as: `agent` for `agent`,
 * `human` for every other value a row can hold (absent, null, empty — every
 * row written before the column existed).
 */
export function principalKindOfRow(row: unknown): string {
  const raw = (row as { principal_kind?: unknown; principalKind?: unknown } | null | undefined);
  const value = raw?.principal_kind ?? raw?.principalKind;
  return value === AGENT_PRINCIPAL_KIND ? AGENT_PRINCIPAL_KIND : HUMAN_PRINCIPAL_KIND;
}

/** True when a `sys_user` row is an AI service account. */
export function isAgentAccountRow(row: unknown): boolean {
  return principalKindOfRow(row) === AGENT_PRINCIPAL_KIND;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

const has = (data: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(data, key);

/** True when a written value leaves the column empty. */
const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === '';

async function readUserRow(engine: any, userId: string): Promise<Record<string, unknown> | undefined> {
  let found: any = await engine.find(USER_OBJECT, {
    where: { id: userId },
    fields: [...SERVICE_ACCOUNT_ROW_FIELDS],
    limit: 1,
    context: SYSTEM_CTX,
  });
  if (found && found.value) found = found.value;
  const row = Array.isArray(found) ? found[0] : undefined;
  return row && typeof row === 'object' ? row : undefined;
}

/**
 * Is `userId` an AI service account? Read in the system context. `false` for
 * a user with no row (the vendor answers that case itself). A read that
 * throws propagates: the refusals below treat an unknown kind as a refusal.
 */
export async function isAgentAccountUser(engine: any, userId: unknown): Promise<boolean> {
  const id = str(userId);
  if (!id || !engine || typeof engine.find !== 'function') return false;
  return isAgentAccountRow(await readUserRow(engine, id));
}

async function forbidden(refusal: { code: string; message: string }): Promise<never> {
  const { APIError } = await import('better-auth/api');
  throw new APIError('FORBIDDEN', { code: refusal.code, message: refusal.message });
}

/**
 * [D2] Refuse a session for an AI service account. Composed FIRST into
 * `session.create.before`, so it holds for every sign-in method,
 * impersonation and every administrator- or server-minted session. A read of
 * the row that fails refuses too.
 */
export async function refuseAgentAccountSession(engine: any, session: unknown): Promise<void> {
  const userId = (session as { userId?: unknown } | null | undefined)?.userId;
  let agent: boolean;
  try {
    agent = await isAgentAccountUser(engine, userId);
  } catch {
    agent = true;
  }
  if (agent) await forbidden(AGENT_ACCOUNT_SESSION_REFUSAL);
}

/**
 * [D2] Refuse a `sys_account` row (a password, a social or SSO link) for an
 * AI service account. Composed FIRST into `account.create.before`. A read of
 * the row that fails refuses too.
 */
export async function refuseAgentAccountCredential(engine: any, account: unknown): Promise<void> {
  const a = account as { userId?: unknown; user_id?: unknown } | null | undefined;
  let agent: boolean;
  try {
    agent = await isAgentAccountUser(engine, a?.userId ?? a?.user_id);
  } catch {
    agent = true;
  }
  if (agent) await forbidden(AGENT_ACCOUNT_CREDENTIAL_REFUSAL);
}

/** A `400 VALIDATION_FAILED` carrying one ADR-0114 field error. */
function refuse(entry: { field: string; code: string; message: string }): Error {
  return validationFailure(entry.message, [entry]);
}

/** Rule 3: the named owner exists and is a person, and is not the account itself. */
async function assertOwnerIsAPerson(engine: any, ownerId: string, selfId: string | undefined): Promise<void> {
  if (selfId && ownerId === selfId) {
    throw refuse({
      field: 'accountable_user_id',
      code: 'invalid_value',
      message:
        'An AI service account cannot be its own accountable owner. Name the person accountable for it.',
    });
  }
  const owner = await readUserRow(engine, ownerId);
  if (!owner) {
    throw refuse({
      field: 'accountable_user_id',
      code: 'reference_not_found',
      message:
        `The accountable owner '${ownerId}' of this AI service account does not exist. Name an existing person.`,
    });
  }
  if (isAgentAccountRow(owner)) {
    throw refuse({
      field: 'accountable_user_id',
      code: 'invalid_value',
      message:
        `The accountable owner '${ownerId}' is itself an AI service account. A person is accountable for an AI `
          + 'service account; name one.',
    });
  }
}

const ownerRequired = (): Error =>
  refuse({
    field: 'accountable_user_id',
    code: 'required',
    message:
      'An AI service account needs an accountable owner: the person accountable for it. Name one.',
  });

const ownerOnAPerson = (): Error =>
  refuse({
    field: 'accountable_user_id',
    code: 'invalid_value',
    message:
      'Only an AI service account has an accountable owner. A person\'s user record carries none.',
  });

/** [D1 rules 1 and 3] An insert. */
async function judgeInsert(engine: any, data: Record<string, unknown>): Promise<void> {
  const written = data.principal_kind;
  if (!isEmpty(written) && !ROW_PRINCIPAL_KINDS.includes(written as string)) {
    throw refuse({
      field: 'principal_kind',
      code: 'invalid_value',
      message:
        `A user is created as a person ('${HUMAN_PRINCIPAL_KIND}') or as an AI service account `
          + `('${AGENT_PRINCIPAL_KIND}'), not '${String(written)}'.`,
    });
  }
  const owner = data.accountable_user_id;
  if (written === AGENT_PRINCIPAL_KIND) {
    const ownerId = str(owner);
    if (!ownerId) throw ownerRequired();
    await assertOwnerIsAPerson(engine, ownerId, str(data.id));
    return;
  }
  if (!isEmpty(owner)) throw ownerOnAPerson();
}

/** [D1 rules 2 and 3] An update, judged against the stored row. */
async function judgeUpdate(engine: any, data: Record<string, unknown>, previous: Record<string, unknown>): Promise<void> {
  const storedKind = principalKindOfRow(previous);
  if (has(data, 'principal_kind')) {
    const written = data.principal_kind;
    const writtenKind = isEmpty(written) ? HUMAN_PRINCIPAL_KIND : written;
    if (writtenKind !== storedKind) {
      throw refuse({
        field: 'principal_kind',
        code: 'invalid_value',
        message:
          'A user\'s principal kind is set when the user is created and never changes: a person never becomes an '
            + 'AI service account, and an AI service account never becomes a person. Register a new AI service '
            + 'account instead.',
      });
    }
  }
  if (!has(data, 'accountable_user_id')) return;
  const owner = data.accountable_user_id;
  if (storedKind === AGENT_PRINCIPAL_KIND) {
    const ownerId = str(owner);
    if (!ownerId) throw ownerRequired();
    if (ownerId === str(previous.accountable_user_id)) return;
    await assertOwnerIsAPerson(engine, ownerId, str(previous.id));
    return;
  }
  if (!isEmpty(owner)) throw ownerOnAPerson();
}

export interface ServiceAccountRowGuardOptions {
  packageId: string;
  logger?: { info(msg: string): void };
}

/**
 * Priority 4: ahead of every other `sys_user` hook — the role fold and the
 * locale fold (5), the identity write guard (10) — so a write these rules
 * refuse is refused before any other hook spends work on it.
 */
export const SERVICE_ACCOUNT_ROW_GUARD_PRIORITY = 4;

/**
 * Register the D1 row rules on an ObjectQL engine, for every writer. Re-binding
 * after hot reload follows the engine's standard contract:
 * `engine.unregisterHooksByPackage(packageId)` first.
 */
export function registerServiceAccountRowGuard(engine: any, opts: ServiceAccountRowGuardOptions): void {
  const onInsert = async (ctx: any): Promise<void> => {
    if (ctx?.object !== USER_OBJECT) return;
    const data = ctx.input?.data;
    if (!data || typeof data !== 'object') return;
    await judgeInsert(engine, data as Record<string, unknown>);
  };
  const onUpdate = async (ctx: any): Promise<void> => {
    if (ctx?.object !== USER_OBJECT) return;
    const data = ctx.input?.data;
    if (!data || typeof data !== 'object') return;
    if (!has(data, 'principal_kind') && !has(data, 'accountable_user_id')) return;
    // The engine binds the stored row whenever one exists; no pre-image means
    // no row for this write to land on, so there is nothing to change.
    const previous = ctx.previous;
    if (!previous || typeof previous !== 'object') return;
    await judgeUpdate(engine, data as Record<string, unknown>, previous as Record<string, unknown>);
  };
  const options = { object: USER_OBJECT, priority: SERVICE_ACCOUNT_ROW_GUARD_PRIORITY, packageId: opts.packageId };
  engine.registerHook('beforeInsert', onInsert, options);
  engine.registerHook('beforeUpdate', onUpdate, options);
  opts.logger?.info(
    '[ServiceAccountRowGuard] sys_user hooks registered: a user\'s principal kind is fixed at creation, and an AI '
      + 'service account names a person accountable for it (ADR-0151 D1)',
  );
}
