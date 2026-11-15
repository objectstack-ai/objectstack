// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The durable outbox of the environment-user host seam
 * (`environment-user-host.ts`). On a cloud-managed kernel these calls about
 * one person are rows of `sys_environment_user_outbox`: every invitation sent
 * (an add or re-add), every re-send (a reactivation), every cancellation
 * (a removal, and the deactivation of a person still pending). A call the host
 * did not take is retried here until it does or the attempts run out. The
 * deactivation of a person who has signed in is asked of the host but not
 * recorded: there is no invitation to show, and a refused deactivation is
 * never retried. Off a cloud-managed kernel nothing is recorded.
 *
 * ## Why the door still calls first
 *
 * The hosting rulings (relayed on the pending-people card) ask for "a durable
 * outbox with retry … with per-row invitation status in Setup → Users", and
 * their edge paths say a CSV row or a reactivation at the developer member
 * cap is refused with `403 DEVELOPER_ORGANIZATION_MEMBER_LIMIT_REACHED`,
 * shown per row. A refusal the administrator must read on the request cannot
 * come from a worker that runs later, so each door keeps making the first
 * call itself, and the outbox only makes that call durable:
 *
 *  - **add / re-add** writes its row INSIDE the person's unit of work, born
 *    `in_flight` and claimed by the door ({@link outboxDoc}), so no worker
 *    can call the host for it at the same time. After the commit the door
 *    calls the host and settles the row ({@link settleOutboxAttempt}). A
 *    process that dies in between leaves a claim that lapses, and the worker
 *    sends it.
 *  - **deactivate, reactivate and remove** ask the host BEFORE their write
 *    (a deactivation or reactivation refused by the host must not happen),
 *    so the row is written after the call, with the call's outcome, under a
 *    delivery id chosen before it.
 *
 * No database transaction is held across any host call (ruling term).
 *
 * ## Rows and statuses
 *
 * One row per call. `pending` / `in_flight`: not taken yet; `sent`: taken;
 * `accepted`: an `added` row whose person signed in
 * ({@link registerOutboxAcceptedTrigger}); `failed`: refused by the host
 * (`refusal_code` + its sentence) or out of attempts; `superseded`: a later
 * call about the same person replaced it (a re-send, or a deactivation or
 * removal, which must never be followed by an invitation sent from a stale
 * retry). The newest row of a person is their invitation status.
 *
 * ## The worker
 *
 * {@link startEnvironmentUserOutboxWorker}: one `DispatchLoop`
 * (`@objectstack/core`), started only on a cloud-managed kernel with a host
 * wired. A tick claims due rows one by one with a compare-and-set (a fresh
 * claim token, read back) under a lease, so two workers never call the host
 * for the same row. Backoff: {@link OUTBOX_BACKOFF_MS}; after
 * {@link OUTBOX_MAX_ATTEMPTS} attempts the row is `failed` and an `error` is
 * logged. A typed refusal on a retry is terminal `failed` with the host's
 * code and sentence, and the person is left as they are: the worker never
 * deletes or changes a person.
 *
 * Delivery is at least once: a call that landed but timed out is sent again.
 * The event carries the row id as `deliveryId` so a host can drop a repeat,
 * as a re-add already re-tells it today.
 */

import { randomUUID } from 'node:crypto';
import { DispatchLoop } from '@objectstack/core';
import { isPendingSsoSource } from './pending-sso-marker.js';
import {
  notifyEnvironmentUserHost,
  type EnvironmentUserEvent,
  type EnvironmentUserEventKind,
  type EnvironmentUserHostAccessor,
  type EnvironmentUserHostOutcome,
  type EnvironmentUserHostRefused,
} from './environment-user-host.js';

/** The object the recorded calls are kept in (see the module header for which calls). */
export const ENVIRONMENT_USER_OUTBOX_OBJECT = 'sys_environment_user_outbox';

/** The statuses a row moves through. */
export type EnvironmentUserOutboxStatus = 'pending' | 'in_flight' | 'sent' | 'accepted' | 'failed' | 'superseded';

/**
 * The wait before attempt N+1, by the number of attempts made so far (index
 * 0 = after the first failed attempt). Past the end the last entry repeats.
 */
export const OUTBOX_BACKOFF_MS: readonly number[] = [
  60_000, // 1 min
  5 * 60_000, // 5 min
  15 * 60_000, // 15 min
  60 * 60_000, // 1 h
  3 * 60 * 60_000, // 3 h
  6 * 60 * 60_000, // 6 h
  12 * 60 * 60_000, // 12 h
];

/** After this many attempts a row that never landed is `failed`. */
export const OUTBOX_MAX_ATTEMPTS = 12;

/** How long a claim holds a row before another worker may try it. */
export const OUTBOX_LEASE_MS = 2 * 60_000;

/** The most rows one worker tick claims. */
export const OUTBOX_TICK_LIMIT = 25;

/** When the next attempt is due, after `attempts` attempts. */
export function outboxNextAttemptAt(attempts: number, now: number): number {
  const index = Math.min(Math.max(attempts, 1), OUTBOX_BACKOFF_MS.length) - 1;
  return now + OUTBOX_BACKOFF_MS[index]!;
}

/** The engine slice the outbox uses. */
export interface EnvironmentUserOutboxEngine {
  find(objectName: string, query?: unknown): Promise<unknown[]>;
  insert(objectName: string, doc: Record<string, unknown>, opts?: unknown): Promise<unknown>;
  update(objectName: string, data: Record<string, unknown>, opts?: unknown): Promise<unknown>;
}

interface OutboxLogger {
  warn(msg: string): void;
  error?(msg: string, err?: Error): void;
}

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

/** One row as the worker reads it. */
export interface EnvironmentUserOutboxRow {
  id: string;
  user_id: string;
  email: string;
  kind: EnvironmentUserEventKind;
  status: EnvironmentUserOutboxStatus;
  attempts: number;
  claim_token?: string | null;
  event_json: string;
}

/** The row's state when it is written. */
export type OutboxBirth =
  /** The door holds it and calls the host now (add / re-add). */
  | { status: 'in_flight'; claimToken: string }
  /** The host already took the call (an ask-first door). */
  | { status: 'sent' }
  /** The host could not be reached (an ask-first door): the worker retries. */
  | { status: 'pending'; lastError: string }
  /** Not called yet: the worker sends it at once. */
  | { status: 'queued' };

/** A new row: its id is the delivery id the host is (or was) sent. */
export function outboxDoc(
  id: string,
  kind: EnvironmentUserEventKind,
  event: EnvironmentUserEvent,
  birth: OutboxBirth,
  now: number = Date.now(),
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id,
    user_id: event.userId,
    email: event.email,
    kind,
    status: birth.status === 'queued' ? 'pending' : birth.status,
    event_json: JSON.stringify(event),
  };
  if (birth.status === 'queued') return { ...base, attempts: 0, next_attempt_at: now };
  if (birth.status === 'in_flight') {
    return { ...base, attempts: 0, claim_token: birth.claimToken, claimed_until: now + OUTBOX_LEASE_MS };
  }
  const attempted = { attempts: 1, last_attempt_at: new Date(now).toISOString() };
  if (birth.status === 'sent') return { ...base, ...attempted, sent_at: new Date(now).toISOString() };
  return { ...base, ...attempted, last_error: birth.lastError, next_attempt_at: outboxNextAttemptAt(1, now) };
}

/** A fresh delivery id and claim token. */
export const newOutboxId = (): string => randomUUID();

/** Write one row, as the system. */
export async function insertOutboxRow(
  engine: EnvironmentUserOutboxEngine,
  doc: Record<string, unknown>,
  context: unknown = SYSTEM_CTX,
): Promise<void> {
  await engine.insert(ENVIRONMENT_USER_OUTBOX_OBJECT, doc, { context });
}

/**
 * Mark a person's unsent rows of `kinds` `superseded`: a re-send replaces an
 * older invitation still waiting, and a deactivation or removal stops every
 * invitation still waiting, so no stale retry is sent after it. A
 * deactivation or removal also passes `in_flight`: a row whose sender died
 * holds a claim that lapses, and it must not be sent once it does.
 */
export async function supersedeOpenOutboxRows(
  engine: EnvironmentUserOutboxEngine,
  userId: string,
  kinds: readonly EnvironmentUserEventKind[],
  statuses: readonly ('pending' | 'in_flight')[] = ['pending'],
): Promise<void> {
  await engine.update(
    ENVIRONMENT_USER_OUTBOX_OBJECT,
    { status: 'superseded', next_attempt_at: null },
    {
      where: { user_id: userId, kind: { $in: [...kinds] }, status: { $in: [...statuses] } },
      multi: true,
      context: SYSTEM_CTX,
    },
  );
}

/** The statuses a deactivation or removal stops: every invitation not yet taken. */
export const OUTBOX_UNSENT_STATUSES = ['pending', 'in_flight'] as const;

/** What one attempt's outcome makes of the row. */
export function outboxSettlement(
  outcome: EnvironmentUserHostOutcome | EnvironmentUserHostRefused,
  attemptsBefore: number,
  now: number,
): { status: EnvironmentUserOutboxStatus; data: Record<string, unknown>; exhausted: boolean } {
  const attempts = attemptsBefore + 1;
  const common = {
    attempts,
    last_attempt_at: new Date(now).toISOString(),
    claim_token: null,
    claimed_until: null,
  };
  if ('refused' in outcome) {
    return {
      status: 'failed',
      exhausted: false,
      data: {
        ...common,
        status: 'failed',
        next_attempt_at: null,
        refusal_code: outcome.refused.code,
        last_error: outcome.refused.message,
      },
    };
  }
  if (outcome.notified) {
    return {
      status: 'sent',
      exhausted: false,
      data: { ...common, status: 'sent', next_attempt_at: null, sent_at: new Date(now).toISOString(), last_error: null },
    };
  }
  const lastError =
    outcome.reason === 'no_host'
      ? 'No environment-user host answered, so the call was not made.'
      : 'The hosting organisation could not be reached, or failed to take the call.';
  if (attempts >= OUTBOX_MAX_ATTEMPTS) {
    return {
      status: 'failed',
      exhausted: true,
      data: { ...common, status: 'failed', next_attempt_at: null, last_error: `${lastError} No attempts are left.` },
    };
  }
  return {
    status: 'pending',
    exhausted: false,
    data: { ...common, status: 'pending', next_attempt_at: outboxNextAttemptAt(attempts, now), last_error: lastError },
  };
}

/**
 * Record one attempt's outcome on the row the caller holds (`claimToken`).
 * A write that finds the claim gone (lapsed and taken by another worker)
 * changes nothing. Answers the status written.
 */
export async function settleOutboxAttempt(
  engine: EnvironmentUserOutboxEngine,
  row: { id: string; email: string; kind: EnvironmentUserEventKind; attempts: number },
  claimToken: string,
  outcome: EnvironmentUserHostOutcome | EnvironmentUserHostRefused,
  logger?: OutboxLogger,
  now: number = Date.now(),
): Promise<EnvironmentUserOutboxStatus> {
  const settled = outboxSettlement(outcome, row.attempts, now);
  await engine.update(ENVIRONMENT_USER_OUTBOX_OBJECT, settled.data, {
    where: { id: row.id, claim_token: claimToken },
    multi: true,
    context: SYSTEM_CTX,
  });
  if (settled.exhausted) {
    const message =
      `[AuthPlugin] the environment-user host never took the call that ${row.email} was ${row.kind} `
      + `(outbox row ${row.id}, ${OUTBOX_MAX_ATTEMPTS} attempts), so the hosting organisation was not told and `
      + 'nothing will retry it. Setup → Users shows the row as failed; add the person again to re-send an '
      + 'invitation, or repeat the action once the host is reachable.';
    if (logger?.error) logger.error(message);
    else logger?.warn(message);
  }
  return settled.status;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function readRow(raw: unknown): EnvironmentUserOutboxRow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (!text(r.id) || !text(r.event_json)) return undefined;
  return {
    id: text(r.id),
    user_id: text(r.user_id),
    email: text(r.email),
    kind: text(r.kind) as EnvironmentUserEventKind,
    status: text(r.status) as EnvironmentUserOutboxStatus,
    attempts: typeof r.attempts === 'number' ? r.attempts : Number(r.attempts) || 0,
    claim_token: typeof r.claim_token === 'string' ? r.claim_token : null,
    event_json: text(r.event_json),
  };
}

/**
 * Claim one row: a compare-and-set from the state the tick read (`pending`,
 * or `in_flight` under a lapsed claim) to `in_flight` under a fresh token,
 * then a read-back of that token. Answers the token when this caller holds
 * the row, `undefined` when another claim won.
 */
export async function claimOutboxRow(
  engine: EnvironmentUserOutboxEngine,
  row: EnvironmentUserOutboxRow,
  now: number = Date.now(),
): Promise<string | undefined> {
  const token = newOutboxId();
  const from =
    row.status === 'in_flight' && row.claim_token
      ? { id: row.id, status: 'in_flight', claim_token: row.claim_token }
      : { id: row.id, status: 'pending' };
  await engine.update(
    ENVIRONMENT_USER_OUTBOX_OBJECT,
    { status: 'in_flight', claim_token: token, claimed_until: now + OUTBOX_LEASE_MS },
    { where: from, multi: true, context: SYSTEM_CTX },
  );
  const held = await engine.find(ENVIRONMENT_USER_OUTBOX_OBJECT, {
    where: { id: row.id, claim_token: token },
    fields: ['id'],
    limit: 1,
    context: SYSTEM_CTX,
  });
  return Array.isArray(held) && held.length > 0 ? token : undefined;
}

/** What the worker needs. */
export interface EnvironmentUserOutboxDeps {
  getDataEngine(): EnvironmentUserOutboxEngine | undefined;
  host: EnvironmentUserHostAccessor;
  logger?: OutboxLogger;
  now?(): number;
}

/** Whether a `sys_user` row is deactivated (the memory engine stores `banned` as `0` / `1`). */
export const isDeactivated = (user: { banned?: unknown }): boolean => user.banned === true || user.banned === 1;

/** Whether a row still has a reason to be sent, read from the person as they are now. */
async function stillOwed(
  engine: EnvironmentUserOutboxEngine,
  row: EnvironmentUserOutboxRow,
): Promise<'send' | 'accepted' | 'superseded'> {
  if (row.kind === 'deactivated') return 'send';
  const users = await engine.find('sys_user', {
    where: { id: row.user_id },
    fields: ['id', 'source', 'banned'],
    limit: 1,
    context: SYSTEM_CTX,
  });
  const user = (Array.isArray(users) ? users[0] : undefined) as { source?: unknown; banned?: unknown } | undefined;
  // A cancellation is owed while the person is gone, or still pending.
  if (row.kind === 'removed') return !user || isPendingSsoSource(user.source) ? 'send' : 'superseded';
  if (!user) return 'superseded';
  // An invitation or a re-send is never sent to a deactivated person.
  if (isDeactivated(user)) return 'superseded';
  if (row.kind === 'added') return isPendingSsoSource(user.source) ? 'send' : 'accepted';
  return 'send';
}

/** Send one claimed row. Answers the status written. */
export async function deliverOutboxRow(
  deps: EnvironmentUserOutboxDeps,
  engine: EnvironmentUserOutboxEngine,
  row: EnvironmentUserOutboxRow,
  claimToken: string,
): Promise<EnvironmentUserOutboxStatus> {
  const now = deps.now?.() ?? Date.now();
  const owed = await stillOwed(engine, row);
  if (owed !== 'send') {
    await engine.update(
      ENVIRONMENT_USER_OUTBOX_OBJECT,
      {
        status: owed,
        claim_token: null,
        claimed_until: null,
        next_attempt_at: null,
        ...(owed === 'accepted' ? { accepted_at: new Date(now).toISOString() } : {}),
      },
      { where: { id: row.id, claim_token: claimToken }, multi: true, context: SYSTEM_CTX },
    );
    return owed;
  }
  let event: EnvironmentUserEvent;
  try {
    event = JSON.parse(row.event_json) as EnvironmentUserEvent;
  } catch {
    await engine.update(
      ENVIRONMENT_USER_OUTBOX_OBJECT,
      {
        status: 'failed',
        claim_token: null,
        claimed_until: null,
        next_attempt_at: null,
        last_error: 'The stored event could not be read, so the call was not made.',
      },
      { where: { id: row.id, claim_token: claimToken }, multi: true, context: SYSTEM_CTX },
    );
    deps.logger?.warn(`[AuthPlugin] environment-user outbox row ${row.id} holds an unreadable event; it is failed.`);
    return 'failed';
  }
  const outcome = await notifyEnvironmentUserHost(deps.host, row.kind, { ...event, deliveryId: row.id }, deps.logger, {
    retried: true,
  });
  if ('refused' in outcome) {
    deps.logger?.warn(
      `[AuthPlugin] the environment-user host refused a retried call that ${row.email} was ${row.kind} `
        + `(${outcome.refused.status} ${outcome.refused.code}). The row is failed; the person is left as they are.`,
    );
  }
  return settleOutboxAttempt(engine, row, claimToken, outcome, deps.logger, now);
}

/** One worker pass: claim and send every due row, up to {@link OUTBOX_TICK_LIMIT}. Answers the rows it held. */
export async function runEnvironmentUserOutboxTick(deps: EnvironmentUserOutboxDeps): Promise<number> {
  const engine = deps.getDataEngine();
  if (!engine) return 0;
  const now = deps.now?.() ?? Date.now();
  // Two reads, not one `$or`: rows that came due, then rows whose claim lapsed
  // (a process that died mid-call).
  const read = async (where: Record<string, unknown>, field: string): Promise<unknown[]> => {
    const rows = await engine.find(ENVIRONMENT_USER_OUTBOX_OBJECT, {
      where,
      orderBy: [{ field, order: 'asc' }],
      limit: OUTBOX_TICK_LIMIT,
      context: SYSTEM_CTX,
    });
    return Array.isArray(rows) ? rows : [];
  };
  const due = [
    ...(await read({ status: 'pending', next_attempt_at: { $lte: now } }, 'next_attempt_at')),
    ...(await read({ status: 'in_flight', claimed_until: { $lt: now } }, 'claimed_until')),
  ].slice(0, OUTBOX_TICK_LIMIT);
  let held = 0;
  for (const raw of due) {
    const row = readRow(raw);
    if (!row) continue;
    const token = await claimOutboxRow(engine, row, now);
    if (!token) continue;
    held++;
    await deliverOutboxRow(deps, engine, row, token);
  }
  return held;
}

/** The earliest instant a row becomes due, for the loop's sleep. */
export async function environmentUserOutboxNextDueAt(deps: EnvironmentUserOutboxDeps): Promise<number | null> {
  const engine = deps.getDataEngine();
  if (!engine) return null;
  const read = async (where: Record<string, unknown>, field: string): Promise<number | null> => {
    const rows = await engine.find(ENVIRONMENT_USER_OUTBOX_OBJECT, {
      where,
      fields: [field],
      orderBy: [{ field, order: 'asc' }],
      limit: 1,
      context: SYSTEM_CTX,
    });
    const value = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined)?.[field] : undefined;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const candidates = [
    await read({ status: 'pending' }, 'next_attempt_at'),
    await read({ status: 'in_flight' }, 'claimed_until'),
  ].filter((v): v is number => v !== null);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

/** The running worker. */
export interface EnvironmentUserOutboxWorker {
  /** A row was written that is due at `atMs`. */
  wakeAt(atMs: number): void;
  stop(): Promise<void>;
}

/**
 * Start the worker. The caller starts it only on a cloud-managed kernel with
 * a host wired: elsewhere no row is ever written.
 */
export function startEnvironmentUserOutboxWorker(deps: EnvironmentUserOutboxDeps): EnvironmentUserOutboxWorker {
  const loop = new DispatchLoop({
    intervalMs: 60_000,
    maxIdleIntervalMs: 10 * 60_000,
    nextDueAt: () => environmentUserOutboxNextDueAt(deps),
    runTick: () => runEnvironmentUserOutboxTick(deps),
    onTickError: (err) =>
      deps.logger?.warn(
        `[AuthPlugin] a pass over the environment-user outbox failed; its rows wait for the next pass. Cause: `
          + `${err instanceof Error ? err.message : String(err)}`,
      ),
  });
  loop.start();
  return { wakeAt: (atMs) => loop.wakeAt(atMs), stop: () => loop.stop() };
}

/** The package id the accepted trigger registers its hook under. */
export const OUTBOX_ACCEPTED_PACKAGE_ID = 'com.objectstack.plugin-auth.environment-user-outbox-accepted';

/** The engine slice the accepted trigger needs. */
export interface OutboxHookEngine extends EnvironmentUserOutboxEngine {
  registerHook(event: string, handler: (ctx: any) => Promise<void> | void, options?: { object?: string; packageId?: string }): void;
  unregisterHooksByPackage?(packageId: string): number;
}

/**
 * When a person's `source` leaves the pending marker (their first platform
 * sign-in, at either site that clears it), their invitation rows read
 * `accepted` and any retry still waiting stops. Best effort: a failure is
 * logged at `warn` and never fails the sign-in; the worker re-reads the
 * person before every retry, so a missed mark never sends an invitation to
 * someone who already accepted.
 */
export function registerOutboxAcceptedTrigger(engine: OutboxHookEngine, opts: { logger?: OutboxLogger } = {}): void {
  const onUpdate = async (ctx: any): Promise<void> => {
    const data = (ctx?.input?.data ?? {}) as Record<string, unknown>;
    if (!('source' in data) || isPendingSsoSource(data.source)) return;
    const userId = text(ctx?.input?.id) || text(data.id);
    if (!userId) return;
    try {
      await engine.update(
        ENVIRONMENT_USER_OUTBOX_OBJECT,
        { status: 'accepted', accepted_at: new Date().toISOString(), next_attempt_at: null },
        {
          where: { user_id: userId, kind: 'added', status: { $in: ['pending', 'sent', 'failed'] } },
          multi: true,
          context: SYSTEM_CTX,
        },
      );
    } catch (error) {
      opts.logger?.warn(
        `[AuthPlugin] user ${userId} signed in for the first time, but their invitation could not be marked `
          + `accepted; Setup → Users shows its earlier status until a retry reads the person. Cause: `
          + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  if (typeof engine.unregisterHooksByPackage === 'function') {
    try {
      engine.unregisterHooksByPackage(OUTBOX_ACCEPTED_PACKAGE_ID);
    } catch {
      /* first bind: nothing registered yet */
    }
  }
  engine.registerHook('afterUpdate', onUpdate, { object: 'sys_user', packageId: OUTBOX_ACCEPTED_PACKAGE_ID });
}

/**
 * Boot the outbox at `kernel:ready`: the accepted trigger and the worker,
 * both only on a cloud-managed kernel with a host wired. Elsewhere no door
 * writes a row (the doors record only on a cloud-managed kernel, and answer
 * `no_host` without a host), so there is nothing to mark or retry, and this
 * answers `undefined` without touching the engine.
 */
export function bootEnvironmentUserOutbox(
  engine: OutboxHookEngine,
  opts: { host: EnvironmentUserHostAccessor | undefined; isCloudManaged(): boolean; logger?: OutboxLogger },
): EnvironmentUserOutboxWorker | undefined {
  const host = opts.host;
  if (!host || !opts.isCloudManaged()) return undefined;
  registerOutboxAcceptedTrigger(engine, { logger: opts.logger });
  return startEnvironmentUserOutboxWorker({ getDataEngine: () => engine, host, logger: opts.logger });
}
