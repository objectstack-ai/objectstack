// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D3/D4] The pieces of the ownership gate (authz middleware step
 * 3.5) that read the `queue` column: what counts as a supplied queue, which
 * organization a queue is resolved in, the `QUEUE_NOT_FOUND` check, and the
 * three refusal sentences.
 *
 * The admissions themselves stay in the step, beside the `owner_id` rules they
 * extend — a claim, a release and a move are each a reading of one supplied
 * change-set against one pre-image, and splitting the reading across two
 * files would let the two anchors drift.
 *
 * | write                                   | admitted when                                              |
 * |-----------------------------------------|------------------------------------------------------------|
 * | insert naming a queue                   | the transfer grant, or the caller is a member of the queue |
 * | insert, `owner_id` empty, queue named   | parks only under the grant; otherwise the stamp stands     |
 * | claim — `owner_id`: empty → self        | by id, and the sharing verdict for the row is `allow`      |
 * | release — `owner_id`: self → empty      | the record has a home queue, and `queue` is unchanged      |
 * | move — `queue` changed                  | the transfer grant                                         |
 *
 * ⛔ The guest supplies neither anchor, whatever it is granted.
 */

import type { IOwnershipQueueService } from '@objectstack/spec/contracts';
import { QueueNotFoundError } from './errors.js';

/** The injected ownership-queue column (`applySystemFields`, ADR-0142 D3). */
export const QUEUE_FIELD = 'queue';

/** The queue-service slice the gate reads. */
export type OwnershipQueueGateService = Pick<IOwnershipQueueService, 'resolveQueue' | 'isMember'>;

/** Refusal: a claim the step did not admit (ADR-0142 D4 wording). */
export const CLAIM_REFUSAL = 'claim only an unowned record the sharing model admits you to';
/** Refusal: a release the step did not admit. */
export const RELEASE_REFUSAL = 'release only your own record, back to its queue';
/** Refusal: a change of `queue` without the grant. */
export const MOVE_REFUSAL = 'moving a record between queues requires the transfer grant';
/** Refusal: an insert naming a queue the caller is not a member of. */
export const INSERT_QUEUE_REFUSAL =
  'creating a record in a queue you are not a member of requires the transfer grant';

/** A non-empty string value, or `null` (absent, `null`, `''` and every non-string are "no queue"). */
export function queueName(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Does `row` carry `queue` as an own property — the change-set SUPPLIES the
 * anchor? Own-property only, for the reason the owner test gives: a polluted
 * prototype must not make an ordinary update look like an anchor write.
 */
export function writesQueue(row: unknown): row is Record<string, unknown> {
  return !!row && typeof row === 'object' && !Array.isArray(row) && Object.prototype.hasOwnProperty.call(row, QUEUE_FIELD);
}

/**
 * The organization a queue is resolved in for this row: the row's own
 * `organization_id` (the stored one, for an update), else the request's
 * active organization. A queue is an organization's (ADR-0142 D1), so a name
 * that resolves in another organization does not resolve here.
 */
export function queueOrganizationOf(row: Record<string, unknown> | null | undefined, context: any): string | null {
  const own = row?.organization_id;
  if (own != null && own !== '') return String(own);
  return context?.tenantId != null && context.tenantId !== '' ? String(context.tenantId) : null;
}

/**
 * Refuse with `QUEUE_NOT_FOUND` unless `value` names a queue that resolves in
 * `organizationId`. A value that is not a non-empty string names no queue.
 * With no queue service registered nothing resolves — the fail-closed answer.
 * A resolution that THROWS propagates: a store fault is not evidence that the
 * queue is absent.
 */
export async function assertQueueResolves(
  queues: OwnershipQueueGateService | null,
  object: string,
  value: unknown,
  organizationId: string | null,
): Promise<string> {
  const name = queueName(value);
  if (name === null || !queues) throw new QueueNotFoundError(object, value);
  const resolved = await queues.resolveQueue(name, organizationId);
  if (!resolved) throw new QueueNotFoundError(object, name);
  return name;
}
