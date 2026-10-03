// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * action-slot-backfill — the boot-time repair that moves stored SLOT
 * addresses out of `sys_approval_action.actor_id` and into `acted_as`.
 *
 * ## Why rows need moving
 *
 * `actor_id` is a `sys_user` lookup, and ADR-0118 D1 says such a column holds
 * an id or nothing — never a sentinel, never any other non-id value. Until the
 * slot got its own column, a slot-gated action recorded the SLOT it took in
 * `actor_id`: a `position:<p>` literal for a position nobody held when the
 * request opened, an email for a `user` approver authored as one. On those rows
 * the person who decided is on no record at all — measured on a booted app,
 * not one of the rows a decision writes names them — and every join or report
 * on the lookup silently drops the row.
 *
 * The writers now record the person in `actor_id` and the slot in `acted_as`,
 * and every slot reader (the multi-approver tally, `decision_progress`, the
 * slot half of the already-acted probe) reads `acted_as` with NO fallback to
 * `actor_id`. So rows written before that have to be moved, or those readers
 * would not see them.
 *
 * ## The two passes
 *
 * 1. **Slot literals, the whole history.** A row whose `actor_id` holds an
 *    address — it contains `:` (a `type:value` literal) or `@` (an email) — gets
 *    `acted_as := actor_id` and `actor_id := null`. `null` is ADR-0118's own
 *    value for "no person recorded", and it is the honest one: no stored record
 *    names the decider of such a row, and an email maps to a person only
 *    through whichever account carries it TODAY, which is a guess. The
 *    reserved machine actors ({@link RESERVED_MACHINE_ACTORS}) also contain
 *    `:` and are left alone; they are a separate ADR-0118 D1 debt.
 *
 * 2. **Votes still being counted.** An `approve` row at `step_index` 0 of a
 *    request that is still `pending`, with no `acted_as`, gets
 *    `acted_as := actor_id`. This is exact, not a guess: an approval on a
 *    still-pending request can only be a non-finalizing slot vote (an admin
 *    override finalizes the node), and the old writer recorded such a vote
 *    under the slot it took. Without this pass an in-flight `unanimous` /
 *    `quorum` / `per_group` request would drop the approvals it has already
 *    collected, and their slots would reappear pending.
 *
 * Nothing else is stamped. A historical user-id row on a finished request keeps
 * the person it always held in `actor_id` and gets no `acted_as`: which of
 * those rows were slot votes cannot be told apart from an admin override that
 * predates `via_override`, so writing one would be a guess. The already-acted
 * probe reads such rows by their person (`actor_id` = the caller's user id),
 * which is a fact, not a fallback.
 *
 * ## Idempotent, and run at every boot
 *
 * Wired on `kernel:ready` beside the approver-index rebuild, for the same
 * reason that one is: the readers move off `actor_id` in the same release, so
 * a repair that waited for an operator would leave a window in which tallies
 * and visibility are wrong. Pass 1 writes the column its own predicate reads,
 * and pass 2 fills the column it requires empty, so a second run over an
 * unchanged database writes nothing — `action-slot-backfill.integration.test.ts`
 * asserts exactly that. Pass 1 costs one substring scan of the action table
 * per boot; pass 2 is bounded by the pending queue.
 */

import { keysetWalk } from '@objectstack/types';

/**
 * The engine surface the repair needs — a structural subset of
 * `ApprovalEngine`, so the module can be driven by the real ObjectQL engine in
 * its pin without pulling the service in.
 */
export interface ActionSlotBackfillEngine {
  find(object: string, options?: unknown): Promise<unknown[]>;
  update(object: string, data: unknown, options?: unknown): Promise<unknown>;
}

/**
 * Machine actors that live in `actor_id` by name and are not slots: the SLA
 * sweep's and the dead-run sweep's sentinels. Spelled here rather than imported
 * from the service so this module stays importable on its own; the pin holds
 * them equal to the service's exports.
 */
export const RESERVED_MACHINE_ACTORS: readonly string[] = ['system:sla', 'system:dead-run'];

/** What one run wrote. */
export interface ActionSlotBackfillResult {
  /** Pass 1: rows whose slot literal moved from `actor_id` to `acted_as`. */
  literalsMoved: number;
  /** Pass 2: still-counted approve votes that got their `acted_as`. */
  votesStamped: number;
}

const SYSTEM_CONTEXT = { isSystem: true, positions: [], permissions: [] };
const PAGE = 500;

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Does this stored `actor_id` hold a slot ADDRESS rather than a user id? */
export function isSlotLiteral(actorId: string): boolean {
  if (RESERVED_MACHINE_ACTORS.includes(actorId)) return false;
  return actorId.includes(':') || actorId.includes('@');
}

/**
 * Run both passes. Throws on a failed read or write — the caller logs it, and
 * the next boot retries: every write is keyed by id and fills exactly the
 * column its predicate tests, so a partial run completes on the next one.
 */
export async function backfillActionSlots(
  engine: ActionSlotBackfillEngine,
  options: { pageSize?: number } = {},
): Promise<ActionSlotBackfillResult> {
  const pageSize = options.pageSize ?? PAGE;
  let literalsMoved = 0;
  let votesStamped = 0;

  // Pass 1 — slot literals in `actor_id`, the whole history. A seek walk, not
  // an offset walk: every page moves rows OUT of the predicate it pages over.
  const literals = keysetWalk<Record<string, unknown>>(
    (q) => engine.find('sys_approval_action', {
      ...q,
      fields: ['id', 'actor_id', 'acted_as'],
      context: SYSTEM_CONTEXT,
    }) as Promise<Record<string, unknown>[]>,
    {
      where: {
        $and: [
          { $or: [{ actor_id: { $contains: ':' } }, { actor_id: { $contains: '@' } }] },
          { actor_id: { $nin: [...RESERVED_MACHINE_ACTORS] } },
        ],
      },
      pageSize,
    },
  );
  for await (const rows of literals.pages()) {
    for (const row of rows) {
      const id = nonEmpty(row.id);
      const actorId = nonEmpty(row.actor_id);
      if (!id || !actorId || !isSlotLiteral(actorId)) continue;
      const patch: Record<string, unknown> = { id, actor_id: null };
      if (!nonEmpty(row.acted_as)) patch.acted_as = actorId;
      await engine.update('sys_approval_action', patch, { context: SYSTEM_CONTEXT });
      literalsMoved++;
    }
  }

  // Pass 2 — the votes a pending request's tally still counts.
  const pending = keysetWalk<Record<string, unknown>>(
    (q) => engine.find('sys_approval_request', {
      ...q,
      fields: ['id'],
      context: SYSTEM_CONTEXT,
    }) as Promise<Record<string, unknown>[]>,
    { where: { status: 'pending' }, pageSize },
  );
  for await (const requests of pending.pages()) {
    const ids = requests.map((r) => nonEmpty(r.id)).filter((id): id is string => id !== null);
    if (!ids.length) continue;
    const votes = keysetWalk<Record<string, unknown>>(
      (q) => engine.find('sys_approval_action', {
        ...q,
        fields: ['id', 'actor_id', 'acted_as'],
        context: SYSTEM_CONTEXT,
      }) as Promise<Record<string, unknown>[]>,
      { where: { request_id: { $in: ids }, action: 'approve', step_index: 0 }, pageSize },
    );
    for await (const rows of votes.pages()) {
      for (const row of rows) {
        const id = nonEmpty(row.id);
        const actorId = nonEmpty(row.actor_id);
        if (!id || !actorId || nonEmpty(row.acted_as)) continue;
        if (RESERVED_MACHINE_ACTORS.includes(actorId)) continue;
        await engine.update('sys_approval_action', { id, acted_as: actorId }, { context: SYSTEM_CONTEXT });
        votesStamped++;
      }
    }
  }

  return { literalsMoved, votesStamped };
}
