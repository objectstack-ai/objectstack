/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Is THIS row held by an approval that locks it? (objectstack#35684)
 *
 * The record-grained `update` verdict a list reads (`useRecordCrudVerdicts`,
 * the explain engine) does not see approvals: the lock is the approvals
 * plugin's own `beforeUpdate` hook. So the list asks the approvals service's
 * answer for the rows on screen, in ONE request per page
 * (`POST /api/v1/approvals/records/:object/locks`, at most
 * `APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS` ids each), when the reader first
 * selects a cell: never on first paint, and never one request per row the
 * selection passes (objectstack#35795). Rows already asked are joined, not
 * asked again; rows a later page or re-read brings are asked on the next
 * select. Each answer is read through `resolveApprovalLock`, the record
 * page's one rule, so a list and a record page cannot disagree about a lock;
 * while no read has answered, the row's `approval_status` column stands in,
 * as it does there.
 *
 * While a row's read is on the wire it is `settling`: an edit asked on the
 * cell waits for the answer and says the record is being checked, instead of
 * opening an editor the lock will refuse. A read refused or failing, and a row the caller cannot read, fall
 * back to the column (fail open: the server refuses a locked write whatever
 * this says). A 501 (no approvals service in this deployment) is latched and
 * the read is not sent again, like the record page's.
 *
 * A read that answers re-renders the host (objectstack#35689), so what the
 * grid already says of the selected cell (its `aria-readonly`) follows the
 * lock without waiting for the reader to move: `isLocked`, and the value this
 * hook returns, are new exactly when the answers it reads changed.
 */
import * as React from 'react';
import { APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS } from '@objectstack/spec/contracts';
import { SchemaRendererContext, resolveApprovalLock, useDataInvalidation } from '@object-ui/react';

/** Set once a lock read answered 501: the deployment runs no approvals service. */
let approvalsServiceAbsent = false;

/** Tests only: forget a 501 latched by an earlier test. */
export function __resetApprovalsServiceLatch(): void {
  approvalsServiceAbsent = false;
}

/**
 * `'unanswered'` is a read that failed or answered nothing usable. It is not
 * asked again until the object's data is invalidated; until then the row falls
 * back to its `approval_status` column (fail open: the server still refuses a
 * write to a locked record).
 */
type LockAnswer = { locked: boolean } | 'asking' | 'unanswered';

export interface RowApprovalLocks {
  /**
   * Ask the locks of the page's records (the cell-select prefetch): the ids not
   * asked yet go out in one request per `APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS`.
   */
  probe: (recordIds: readonly unknown[]) => void;
  /** Whether the row is locked by an approval, from what has answered so far. */
  isLocked: (recordId: unknown, row: any) => boolean;
  /** The row's lock read while it is on the wire (it settles when it answers or fails), else `null`. */
  settling: (recordId: unknown) => Promise<void> | null;
}

/** The `{ success, data }` envelope's payload, or the body itself. */
function payloadOf(body: any): any {
  return body && typeof body.success === 'boolean' && 'data' in body ? body.data : body;
}

export function useRowApprovalLocks(objectName: string | undefined): RowApprovalLocks {
  const apiFetch = React.useContext(SchemaRendererContext)?.apiFetch;
  // A change to the object (a submit, a recall, a decision) drops every answer,
  // and an answer still on the wire lands in the map it was asked for.
  const invalidation = useDataInvalidation(objectName);
  const answersRef = React.useRef(new Map<string, LockAnswer>());
  /** The read each row asked is waiting on, while it is on the wire. */
  const wiresRef = React.useRef(new Map<string, Promise<void>>());
  // Counts the changes to what `isLocked` reads: a read answering, the answers dropped.
  const [answerSeq, setAnswerSeq] = React.useState(0);
  React.useEffect(() => {
    const dropped = answersRef.current.size > 0;
    answersRef.current = new Map();
    wiresRef.current = new Map();
    if (dropped) setAnswerSeq((n) => n + 1);
  }, [objectName, invalidation]);

  const probe = React.useCallback((recordIds: readonly unknown[]) => {
    if (!objectName || approvalsServiceAbsent) return;
    const answers = answersRef.current;
    const wires = wiresRef.current;
    const toAsk = Array.from(new Set(
      recordIds.filter((id) => id != null && id !== '').map((id) => String(id)),
    )).filter((id) => !answers.has(id));
    if (toAsk.length === 0) return;
    const doFetch = apiFetch ?? fetch;
    const path = `/api/v1/approvals/records/${encodeURIComponent(objectName)}/locks`;
    for (let i = 0; i < toAsk.length; i += APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS) {
      const chunk = toAsk.slice(i, i + APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS);
      for (const id of chunk) answers.set(id, 'asking');
      const wire = (async () => {
        const answered = new Map<string, LockAnswer>();
        try {
          const res = await doFetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ recordIds: chunk }),
          });
          if (res.status === 501) approvalsServiceAbsent = true;
          if (res.ok) {
            const records = payloadOf(await res.json())?.records;
            if (Array.isArray(records)) {
              // `records[i]` answers `chunk[i]`; an entry that names another id
              // answers nothing, and a row the caller cannot read (`null`) keeps
              // the column fallback.
              chunk.forEach((id, index) => {
                const entry = records[index];
                if (entry && entry.recordId === id && typeof entry.locked === 'boolean') {
                  answered.set(id, { locked: entry.locked });
                }
              });
            }
          }
        } catch {
          /* network / parse failure: fail open */
        } finally {
          for (const id of chunk) {
            answers.set(id, answered.get(id) ?? 'unanswered');
            wires.delete(id);
          }
          // Answers for answers since dropped (the object changed) read nowhere.
          if (answered.size > 0 && answers === answersRef.current) setAnswerSeq((n) => n + 1);
        }
      })();
      for (const id of chunk) if (answers.get(id) === 'asking') wires.set(id, wire);
    }
  }, [objectName, apiFetch]);

  // `answerSeq` is read so this callback, and the value below, are new when a
  // read answers: the host's cell facts depend on it.
  const isLocked = React.useCallback((recordId: unknown, row: any) => {
    void answerSeq;
    const answer = recordId == null ? undefined : answersRef.current.get(String(recordId));
    const readAnswered = typeof answer === 'object';
    return resolveApprovalLock({
      readAnswered,
      openApproval: readAnswered && answer.locked ? { locked: true } : null,
      recordStatus: row?.approval_status,
    }).locked;
  }, [answerSeq]);

  const settling = React.useCallback(
    (recordId: unknown) => (recordId == null ? null : wiresRef.current.get(String(recordId)) ?? null),
    [],
  );

  return React.useMemo(() => ({ probe, isLocked, settling }), [probe, isLocked, settling]);
}
