// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The host seam for environment users: a host (the cloud, on a hosted
 * environment) is told when a person is added, deactivated or reactivated, so
 * it can forward an invitation or a removal. See `pending-sso-users.ts` for
 * the add half and `admin-ban-endpoints.ts` for the deactivate / reactivate
 * half.
 *
 * Two kinds of host failure are told apart:
 *
 *  - a **typed refusal** ({@link EnvironmentUserHostRefusal}: an organization
 *    owner or admin who cannot be removed from the environment side (`409`),
 *    or the developer organization's member cap (`403`
 *    `DEVELOPER_ORGANIZATION_MEMBER_LIMIT_REACHED`)) is the host saying the
 *    operation must not happen. Deactivation and reactivation ask the host
 *    BEFORE their write, so a refusal leaves the row as it was; an add asks
 *    after its write and undoes that one person. The door answers with the
 *    host's own status, code and sentence.
 *  - any other throw (the host is unreachable, times out, fails) never undoes
 *    or blocks the operation: the answer carries `host: { notified: false,
 *    reason: 'host_failed' }` and the plugin logs it at `warn`.
 *
 * The host is never called inside a database transaction: each door calls it
 * outside its unit of work.
 */

import { PLATFORM_IDP_PROVIDER_ID } from './implicit-account-linking.js';

/** What a host is told about one person. */
export interface EnvironmentUserEvent {
  userId: string;
  email: string;
  name: string;
  /** The row's `sys_user.source` when the event fired (`idp_pending` for an added person). */
  source: string | null;
  /** The administrator who acted. */
  actorId: string;
  /**
   * The administrator's cloud user id: the `account_id` of their linked
   * `objectstack-cloud` account, read from `sys_account` on every call and
   * never from the request. Absent when they hold no such link (a
   * self-hosted deployment, or a local administrator).
   */
  actorCloudUserId?: string;
  /** ISO-8601 time the operation committed. */
  occurredAt: string;
}

/**
 * The host's side of the seam. `userAdded` is called after the person is
 * written; `userDeactivated` and `userReactivated` before the ban or unban is
 * written. A member that throws {@link EnvironmentUserHostRefusal} refuses
 * the operation; any other throw is reported to the caller and never undoes
 * or blocks it.
 */
export interface EnvironmentUserHost {
  /** A person was added (or re-added while still pending) to this environment. */
  userAdded(event: EnvironmentUserEvent): void | Promise<void>;
  /** A person was deactivated (`admin/ban-user`). */
  userDeactivated(event: EnvironmentUserEvent): void | Promise<void>;
  /** A person was reactivated (`admin/unban-user`). */
  userReactivated(event: EnvironmentUserEvent): void | Promise<void>;
}

/** How the plugin reaches the host: read per call, so a host wired late is still found. */
export type EnvironmentUserHostAccessor = () =>
  | EnvironmentUserHost
  | undefined
  | Promise<EnvironmentUserHost | undefined>;

/** The statuses a host may refuse with: an owner / admin conflict, or the member cap. */
export type EnvironmentUserHostRefusalStatus = 403 | 409;

const REFUSAL_BRAND = Symbol.for('objectstack.environmentUserHostRefusal');

/**
 * Thrown by a host member to refuse the operation, with the answer the door
 * gives: the status (`409` for an organization owner or admin, `403` for the
 * member cap), the machine code and the sentence the administrator reads.
 * Recognised by a registered symbol, so a host built against another copy of
 * this package is still understood.
 */
export class EnvironmentUserHostRefusal extends Error {
  readonly [REFUSAL_BRAND] = true;
  constructor(
    readonly status: EnvironmentUserHostRefusalStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EnvironmentUserHostRefusal';
  }
}

/** Whether `error` is a host's typed refusal with a status the seam honours. */
export function isEnvironmentUserHostRefusal(error: unknown): error is EnvironmentUserHostRefusal {
  if (!error || typeof error !== 'object' || (error as Record<symbol, unknown>)[REFUSAL_BRAND] !== true) return false;
  const { status, code, message } = error as { status?: unknown; code?: unknown; message?: unknown };
  return (status === 403 || status === 409) && typeof code === 'string' && code.length > 0 && typeof message === 'string';
}

/** What a door answers about the host call, on the row it concerns. */
export type EnvironmentUserHostOutcome =
  | { notified: true }
  | { notified: false; reason: 'no_host' | 'host_failed' };

/** A host's typed refusal, as the door answers it. */
export interface EnvironmentUserHostRefused {
  refused: { status: EnvironmentUserHostRefusalStatus; code: string; message: string };
}

export type EnvironmentUserEventKind = 'added' | 'deactivated' | 'reactivated';

const HOST_MEMBER: Record<EnvironmentUserEventKind, keyof EnvironmentUserHost> = {
  added: 'userAdded',
  deactivated: 'userDeactivated',
  reactivated: 'userReactivated',
};

/** The engine slice the actor's cloud id is read through. */
export interface ActorCloudIdReader {
  find(objectName: string, query?: unknown): Promise<unknown[]>;
}

/**
 * The acting administrator's cloud user id: the `account_id` of their
 * `sys_account` row for the platform identity provider. Never read from
 * request input. `undefined` when there is no such link, and when the read
 * fails (logged): the host then sees no cloud actor and decides itself.
 */
export async function readActorCloudUserId(
  engine: ActorCloudIdReader | undefined | null,
  actorId: string,
  logger?: { warn(msg: string): void },
): Promise<string | undefined> {
  if (!engine) return undefined;
  try {
    const rows = await engine.find('sys_account', {
      where: { user_id: actorId, provider_id: PLATFORM_IDP_PROVIDER_ID },
      fields: ['account_id'],
      limit: 1,
      context: { isSystem: true, positions: [], permissions: [] },
    });
    const accountId = Array.isArray(rows) ? (rows[0] as { account_id?: unknown } | undefined)?.account_id : undefined;
    return typeof accountId === 'string' && accountId.length > 0 ? accountId : undefined;
  } catch (error) {
    logger?.warn(
      `[AuthPlugin] the linked cloud account of administrator ${actorId} could not be read, so the environment-user `
        + `host is told without their cloud id. Cause: ${describe(error)}`,
    );
    return undefined;
  }
}

/**
 * Tell the host, once. Never throws. A typed refusal is answered as
 * `{ refused }` for the door to return; any other failure as `host_failed`
 * on the caller's row, logged at `warn` with its message.
 */
export async function notifyEnvironmentUserHost(
  accessor: EnvironmentUserHostAccessor | undefined,
  kind: EnvironmentUserEventKind,
  event: EnvironmentUserEvent,
  logger?: { warn(msg: string): void },
): Promise<EnvironmentUserHostOutcome | EnvironmentUserHostRefused> {
  let host: EnvironmentUserHost | undefined;
  try {
    host = await accessor?.();
  } catch (error) {
    logger?.warn(
      `[AuthPlugin] the environment-user host could not be resolved, so it was not told that user ${event.userId} `
        + `was ${kind}. ${goesAhead(kind)} Cause: ${describe(error)}`,
    );
    return { notified: false, reason: 'host_failed' };
  }
  const member = host?.[HOST_MEMBER[kind]];
  if (typeof member !== 'function') return { notified: false, reason: 'no_host' };
  try {
    await member.call(host, event);
    return { notified: true };
  } catch (error) {
    if (isEnvironmentUserHostRefusal(error)) {
      return { refused: { status: error.status, code: error.code, message: error.message } };
    }
    logger?.warn(
      `[AuthPlugin] the environment-user host refused or failed to take the news that user ${event.userId} was `
        + `${kind}. ${goesAhead(kind)} The answer says so. `
        + (kind === 'added' ? 'Adding the person again while they are still pending tells the host again. ' : '')
        + `Cause: ${describe(error)}`,
    );
    return { notified: false, reason: 'host_failed' };
  }
}

const goesAhead = (kind: EnvironmentUserEventKind): string =>
  kind === 'added' ? 'The addition itself stands.' : 'The change goes ahead.';

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));
