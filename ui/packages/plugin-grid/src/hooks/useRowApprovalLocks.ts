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
 * plugin's own `beforeUpdate` hook. So a cell asks the approvals service's
 * per-record answer (`GET /api/v1/approvals/records/:object/:recordId/lock`)
 * when the reader selects a cell of the row: one read for a row the reader
 * touches, never one for every row on screen. The answer is read through
 * `resolveApprovalLock`, the record page's one rule, so a list and a record
 * page cannot disagree about a lock; while no read has answered, the row's
 * `approval_status` column stands in, as it does there.
 *
 * Fail open: a read in flight, refused or failing leaves the column fallback,
 * and the server refuses a locked write whatever this says. A 501 (no
 * approvals service in this deployment) is latched and the read is not sent
 * again, like the record page's.
 */
import * as React from 'react';
import { SchemaRendererContext, resolveApprovalLock, useDataInvalidation } from '@object-ui/react';

/** Set once a lock read answered 501: the deployment runs no approvals service. */
let approvalsServiceAbsent = false;

type LockAnswer = { locked: boolean } | 'asking' | 'unanswered';

export interface RowApprovalLocks {
  /** Ask the lock of a row's record, unless it has been asked (the cell-select prefetch). */
  probe: (recordId: unknown) => void;
  /** Whether the row is locked by an approval, from what has answered so far. */
  isLocked: (recordId: unknown, row: any) => boolean;
}

export function useRowApprovalLocks(objectName: string | undefined): RowApprovalLocks {
  const apiFetch = React.useContext(SchemaRendererContext)?.apiFetch;
  // A change to the object (a submit, a recall, a decision) drops every answer.
  const invalidation = useDataInvalidation(objectName);
  const answersRef = React.useRef(new Map<string, LockAnswer>());
  React.useEffect(() => {
    answersRef.current = new Map();
  }, [objectName, invalidation]);

  const probe = React.useCallback((recordId: unknown) => {
    if (!objectName || recordId == null || recordId === '' || approvalsServiceAbsent) return;
    const id = String(recordId);
    const answers = answersRef.current;
    if (answers.has(id)) return;
    answers.set(id, 'asking');
    const doFetch = apiFetch ?? fetch;
    const path = `/api/v1/approvals/records/${encodeURIComponent(objectName)}/${encodeURIComponent(id)}/lock`;
    void (async () => {
      try {
        const res = await doFetch(path, { credentials: 'include' });
        if (res.status === 501) approvalsServiceAbsent = true;
        if (!res.ok) {
          answers.set(id, 'unanswered');
          return;
        }
        const body: any = await res.json();
        // `{ success: true, data: { locked } }`, the declared envelope.
        const data = body && typeof body.success === 'boolean' && 'data' in body ? body.data : body;
        answers.set(id, { locked: data?.locked === true });
      } catch {
        answers.set(id, 'unanswered');
      }
    })();
  }, [objectName, apiFetch]);

  const isLocked = React.useCallback((recordId: unknown, row: any) => {
    const answer = recordId == null ? undefined : answersRef.current.get(String(recordId));
    const readAnswered = typeof answer === 'object';
    return resolveApprovalLock({
      readAnswered,
      openApproval: readAnswered && answer.locked ? { locked: true } : null,
      recordStatus: row?.approval_status,
    }).locked;
  }, []);

  return React.useMemo(() => ({ probe, isLocked }), [probe, isLocked]);
}
