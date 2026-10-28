/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Claim affordance on a record that sits in an ownership queue
 * (objectstack ADR-0142 D3/D4).
 *
 * A record SITS IN queue Q when its `owner_id` is empty and its system-managed
 * `queue` column names Q. A claim is an ordinary update of `owner_id` to the
 * caller's own id: the server's ownership gate admits it when the record is
 * unowned and the sharing model positively admits the caller (a member of the
 * queue is the common case), writes it on the condition that the owner is
 * still empty, and answers the loser of a race `409 CONCURRENT_UPDATE` ("the
 * record was taken").
 *
 * The server is the only judge. This module holds two reads and one write:
 *
 *  - {@link recordSitsInQueue} reads the record's own two columns to decide
 *    whether there is anything to ASK about. It judges no right: a record that
 *    sits in no queue has no Claim button, whoever looks at it.
 *  - {@link useQueueClaimOffered} asks the explain engine whether a claim of
 *    THIS record by THIS user is admitted (`POST /api/v1/security/explain`,
 *    `operation: 'transfer'`) and reads the `queue_claim` attribution the
 *    engine reports from the same sharing verdict the gate reads. The button
 *    renders only on `admits`. ⛔ No membership test, no permission arithmetic
 *    here: a second client-side judge is exactly what the server's answer
 *    replaces.
 *  - {@link claimQueuedRecord} sends `{ owner_id: <self> }` through the normal
 *    update path and reports the server's answer as it came: claimed, taken by
 *    someone else (the 409), or refused for another reason.
 *
 * Unlike `useRecordEditable`, the probe FAILS CLOSED: Edit is an affordance the
 * record already has and a hint must never hide it; Claim exists only where
 * the server says it applies, so no answer means no button.
 */
import * as React from 'react';
import { SchemaRendererContext, useDataInvalidation } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { isConcurrentUpdateError } from './ConcurrentUpdateDialog';

/**
 * The queue a record sits in, or `null`: `owner_id` empty and `queue` a
 * non-empty name (ADR-0142 D3). With an owner, `queue` is only the record's
 * home queue and nothing sits anywhere.
 */
export function recordSitsInQueue(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as { owner_id?: unknown; queue?: unknown };
  const owner = r.owner_id;
  const unowned = owner == null || owner === '';
  return unowned && typeof r.queue === 'string' && r.queue !== '' ? r.queue : null;
}

/**
 * Does an explain decision for `operation: 'transfer'` admit the principal's
 * CLAIM of the record? True exactly when a layer's record attribution carries
 * the `queue_claim` rule with `effect: 'admits'` — the engine's report of the
 * sharing verdict the ownership gate reads for a claim. Anything else,
 * including a malformed answer, is `false`.
 */
export function queueClaimAdmitted(decision: unknown): boolean {
  const layers = (decision as { layers?: unknown } | null | undefined)?.layers;
  if (!Array.isArray(layers)) return false;
  return layers.some((layer) => {
    const rules = (layer as { record?: { rules?: unknown } } | null | undefined)?.record?.rules;
    return Array.isArray(rules) && rules.some((rule) => {
      const r = rule as { kind?: unknown; effect?: unknown } | null | undefined;
      return r?.kind === 'queue_claim' && r.effect === 'admits';
    });
  });
}

/**
 * Whether to offer Claim on this record: asked of the server only for a record
 * that sits in a queue, with a known acting user, and answered `true` only
 * when the server admits the claim. Re-asked when the record changes on the
 * data-invalidation bus (a claim by this tab lands there) and when the acting
 * user changes. A failed or unanswered probe is `false`.
 */
export function useQueueClaimOffered(
  objectName: string | undefined,
  recordId: string | undefined,
  sitting: boolean,
): boolean {
  const principal = usePermissions().userId ?? null;
  const invalidationNonce = useDataInvalidation(objectName, recordId);
  const apiFetch = React.useContext(SchemaRendererContext)?.apiFetch;
  const [offered, setOffered] = React.useState(false);

  React.useEffect(() => {
    setOffered(false);
    if (!sitting || !objectName || !recordId || !principal) return;
    let cancelled = false;
    (async () => {
      try {
        const doFetch = apiFetch ?? fetch;
        const res = await doFetch('/api/v1/security/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ object: objectName, operation: 'transfer', recordId }),
        });
        if (!res.ok) return;
        const decision = await res.json();
        if (!cancelled) setOffered(queueClaimAdmitted(decision));
      } catch {
        // No answer is not an admission: the button stays away.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [objectName, recordId, sitting, principal, apiFetch, invalidationNonce]);

  return offered;
}

/** The server's answer to a claim, as the Claim affordance reports it. */
export type QueueClaimOutcome =
  | { readonly outcome: 'claimed' }
  /** `409 CONCURRENT_UPDATE`: another user took the record first. */
  | { readonly outcome: 'taken' }
  /** Any other refusal, carried as thrown so the caller can say what it was. */
  | { readonly outcome: 'refused'; readonly error: unknown };

/** The one write a claim is: `owner_id` set to the caller, through `update`. */
export interface ClaimWriter {
  update(objectName: string, recordId: string, data: Record<string, unknown>): Promise<unknown>;
}

/**
 * Claim a record: `{ owner_id: <userId> }` through the normal update path,
 * nothing else in the payload — the queue column stays as it is, because a
 * claim leaves the home queue unchanged (ADR-0142 D4). The server decides;
 * this reports which answer it gave.
 */
export async function claimQueuedRecord(
  writer: ClaimWriter,
  objectName: string,
  recordId: string,
  userId: string,
): Promise<QueueClaimOutcome> {
  try {
    await writer.update(objectName, recordId, { owner_id: userId });
    return { outcome: 'claimed' };
  } catch (error) {
    if (isConcurrentUpdateError(error)) return { outcome: 'taken' };
    return { outcome: 'refused', error };
  }
}
