/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useContext, useEffect, useState, type ReactNode } from 'react';
import { SystemFieldName } from '@objectstack/spec/system';
import { PermCtx, type PermissionContextValue } from './PermissionContext.js';

/**
 * The part of the server's record-scoped field projection this scope reads
 * (`GET /data/{object}/{id}/field-access`, `GetRecordFieldAccessResponse` in
 * `@objectstack/spec`): the fields the caller may write on THIS record, as
 * field-level security judges an update of the stored row, and whether the
 * row may be updated at all.
 */
export interface RecordFieldAccessAnswer {
  readonly editable: readonly string[];
  /**
   * The write gate's verdict on the row itself (the object grant, sharing,
   * ownership, row-level security). Only `false` changes anything below the
   * scope; `true` and an absent key (a server that predates the verdict)
   * leave the row's write question to the enclosing provider.
   */
  readonly writable?: boolean;
}

/**
 * The `reason` a scoped `check(object, 'update')` answers with when THIS row
 * refuses the update while the object grant allows it. A form reads it to say
 * why every field is locked (`closedFormAffordance` in `@object-ui/plugin-form`).
 *
 *  - `record-not-writable` — the projection answered `writable: false`;
 *  - `record-locked-by-approval` — the host reported a pending approval that
 *    locks the record (`lockedBy: 'approval'`).
 */
type RecordWriteRefusal = 'record-not-writable' | 'record-locked-by-approval';

export interface RecordFieldAccessScopeProps {
  /** The object the record belongs to. Matched case-insensitively, as `MePermissionsProvider` matches object names. */
  object: string;
  /** The record whose stored row the answer is judged on. */
  recordId: string;
  /**
   * Asks the server for the record's projection. `null` / `undefined` — and a
   * rejection — mean "no answer": the record is gone from the caller's sight,
   * or the server offers no record-scoped projection. Below the scope the
   * enclosing provider's row-blind answer then stands, unchanged.
   */
  load: (object: string, recordId: string) => Promise<RecordFieldAccessAnswer | null | undefined>;
  /**
   * Moves whenever the stored row may have changed (a save, a re-read). The
   * scope then asks again, and holds the row-blind lock until the new answer
   * lands, so a row that moved into the state a `when` names is never drawn
   * from the earlier answer.
   */
  revision?: number;
  /**
   * A lock on the record that the projection does not judge and the host
   * reads from its own door: `'approval'` while a pending approval locks the
   * record (the approvals service's record lock, answered to every reader).
   * The row then answers as not writable, exactly as `writable: false` does,
   * without waiting for the projection. The host passes the verdict it already
   * draws its own lock from; the scope never re-derives it.
   */
  lockedBy?: 'approval';
  children: ReactNode;
}

/**
 * Which (object, record) a context value this module built answers for, so a
 * scope nested under one for the same record neither fetches again nor wraps
 * the answer twice (`ObjectForm` dispatching into `ModalForm`, both of which
 * hold the record).
 */
const SCOPE_OF = new WeakMap<PermissionContextValue, string>();

/** One derived value per enclosing value, record and answer (see below). */
const SCOPED = new WeakMap<PermissionContextValue, Map<string, WeakMap<object, PermissionContextValue>>>();

/** Stands in for "no answer yet / no answer" as a cache key. */
const NO_ANSWER: object = {};

const scopeKey = (object: string, recordId: string) => JSON.stringify([(object ?? '').toLowerCase(), recordId]);

/**
 * The enclosing value with the field `write` verdict of `object` answered from
 * the record's projection, cached on the enclosing value itself.
 *
 * The cache is a module-level `WeakMap` keyed on the enclosing context value
 * and on the answer object (the shape `ServerReadScope` and
 * `discardProofCache.ts` use), never a `useMemo`: consumers name the
 * permission value in dependency arrays, so a discarded memo would re-run
 * their effects with nothing changed (AGENTS.md #10).
 *
 * Only ONE input of the enclosing `write` verdict is replaced: the explicit
 * field-level lock. `/auth/me/permissions` holds no row, so it reports an entry
 * whose `when` names only some rows as its lock (`editable: false` in
 * `getFieldPermissions`), and the record's projection is the server's verdict
 * on that entry for this row. Every other input stays the enclosing
 * provider's:
 *
 *  - a field with no lock entry (or one the entry leaves editable) keeps the
 *    enclosing answer — the object grant fallback, which the projection does
 *    not carry;
 *  - the record's owner field keeps the enclosing answer — writing it is a
 *    transfer, which needs a grant the projection does not carry either, and
 *    reading the lock alone would offer a transfer the server refuses;
 *  - `read` and `create` keep the enclosing answer — reads are judged
 *    row-blind, and a create form holds no stored row.
 *
 * The projection never widens past the enclosing provider on anything but
 * that lock, and on the lock it is the write gate's own verdict for the row.
 * A row that refuses the update as a whole (`writable: false`, or a lock the
 * host reports) is layered on top by {@link refusedRow}, which only narrows.
 */
function scoped(
  parent: PermissionContextValue,
  object: string,
  recordId: string,
  answer: RecordFieldAccessAnswer | null,
  lockedBy: RecordFieldAccessScopeProps['lockedBy'],
): PermissionContextValue {
  const key = scopeKey(object, recordId);
  let byRecord = SCOPED.get(parent);
  if (!byRecord) {
    byRecord = new Map();
    SCOPED.set(parent, byRecord);
  }
  const cacheKey = lockedBy ? `${key}|${lockedBy}` : key;
  let byAnswer = byRecord.get(cacheKey);
  if (!byAnswer) {
    byAnswer = new WeakMap();
    byRecord.set(cacheKey, byAnswer);
  }
  const answerKey = answer ?? NO_ANSWER;
  const hit = byAnswer.get(answerKey);
  if (hit) return hit;

  const objKey = (object ?? '').toLowerCase();
  const editable = new Set(answer?.editable ?? []);
  const lockedByEntry = (field: string): boolean => {
    const entries = [
      ...parent.getFieldPermissions(objKey),
      ...(object !== objKey ? parent.getFieldPermissions(object) : []),
    ];
    return entries.some((entry) => entry.field === field && entry.write === false);
  };
  const value: PermissionContextValue = answer
    ? {
        ...parent,
        checkField: (o, field, action) => {
          if (
            action !== 'write'
            || (o ?? '').toLowerCase() !== objKey
            || field === SystemFieldName.OWNER_ID
            || !lockedByEntry(field)
          ) {
            return parent.checkField(o, field, action);
          }
          return editable.has(field);
        },
      }
    : { ...parent };
  const refusal: RecordWriteRefusal | undefined =
    answer?.writable === false ? 'record-not-writable'
      : lockedBy === 'approval' ? 'record-locked-by-approval'
        : undefined;
  const result = refusal ? refusedRow(value, objKey, recordId, refusal) : value;
  SCOPE_OF.set(result, key);
  byAnswer.set(answerKey, result);
  return result;
}

/**
 * The row's own write verdict over `base`: THIS record refuses every update,
 * so no field of it is writable and the object's `update` is refused for it.
 *
 * Only the update of this row is answered. `read` and `create` keep the
 * enclosing answer, a `check` that names another record of the object keeps
 * it too, and a `check` the enclosing provider already refuses keeps its own
 * reason (the object grant is the wider refusal, and its sentence is the one
 * a form should show).
 */
function refusedRow(
  base: PermissionContextValue,
  objKey: string,
  recordId: string,
  refusal: RecordWriteRefusal,
): PermissionContextValue {
  const ownRecord = (record: Record<string, unknown> | undefined): boolean => {
    if (!record) return true;
    const id = record.id ?? record._id;
    return id === undefined || id === null || String(id) === recordId;
  };
  return {
    ...base,
    check: (o, action, record) => {
      const verdict = base.check(o, action, record);
      if (action !== 'update' || (o ?? '').toLowerCase() !== objKey || !verdict.allowed || !ownRecord(record)) {
        return verdict;
      }
      return { allowed: false, reason: refusal };
    },
    checkField: (o, field, action) =>
      action === 'write' && (o ?? '').toLowerCase() === objKey ? false : base.checkField(o, field, action),
  };
}

/**
 * Answers the field `write` verdict of ONE stored record from the server's
 * record-scoped projection (objectstack#26594, ruling B).
 *
 * `/auth/me/permissions` holds no row, so a field permission whose `when`
 * names only some rows (a summary locked from `approved` onward) is reported
 * there as its lock, and a form reading it disables the field on every row —
 * including the draft the server lets the caller write. Below this scope, the
 * form that edits `recordId` reads the server's own verdict for that row
 * instead: the field is disabled exactly where the write gate refuses it. The
 * client never evaluates `when` itself.
 *
 * Until the answer arrives, and when there is none, the enclosing answer
 * stands, so a conditioned field shows locked rather than briefly open. When
 * `revision` moves (the row was saved or re-read), the scope asks again and
 * the lock stands until the new answer lands.
 *
 * The row's own write verdict rides on the same answer (objectstack#27138).
 * `editable` is field-level only; the projection's `writable` is the write
 * gate's verdict on the row itself — sharing, row-level security, ownership
 * and the object grant. On `writable: false` every field of the record
 * answers `write` refused and `check(object, 'update')` answers refused with
 * the reason `record-not-writable`, so the field gates and the form-wide lock
 * (`gateFormFields` in `@object-ui/plugin-form`) and the detail page's inline
 * edit all draw the record read-only from the one source, and a form can say
 * why. `lockedBy: 'approval'` answers the same way with the reason
 * `record-locked-by-approval`: the approvals record lock is judged on the
 * values a save sends, so the projection leaves it out, and the host passes
 * the lock it already reads. `writable: true` or an absent `writable` changes
 * nothing. Until the answer arrives the row-blind answer stands for the row,
 * as it does for the fields.
 *
 * With no enclosing provider there is no field answer to refine, so the scope
 * renders its children as they are and asks nothing.
 */
export function RecordFieldAccessScope({ object, recordId, load, revision = 0, lockedBy, children }: RecordFieldAccessScopeProps) {
  const parent = useContext(PermCtx);
  const key = scopeKey(object, recordId);
  const nested = !!parent && SCOPE_OF.get(parent) === key;
  const [answer, setAnswer] = useState<{ key: string; revision: number; value: RecordFieldAccessAnswer | null } | null>(null);

  useEffect(() => {
    if (!parent || nested) return;
    let alive = true;
    Promise.resolve()
      .then(() => load(object, recordId))
      .then(
        (value) => { if (alive) setAnswer({ key, revision, value: value && Array.isArray(value.editable) ? value : null }); },
        () => { if (alive) setAnswer({ key, revision, value: null }); },
      );
    return () => { alive = false; };
    // `load` is deliberately not a trigger: callers pass an inline closure, and
    // the answer belongs to the record, not to the function that fetched it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!parent, nested, key, revision]);

  if (!parent) return <>{children}</>;
  // A scope nested under one for the same record reuses its answer, and adds
  // only a lock the outer scope was not told of.
  if (nested) {
    return lockedBy
      ? <PermCtx.Provider value={scoped(parent, object, recordId, null, lockedBy)}>{children}</PermCtx.Provider>
      : <>{children}</>;
  }
  const current = answer?.key === key && answer.revision === revision ? answer.value : null;
  return <PermCtx.Provider value={scoped(parent, object, recordId, current, lockedBy)}>{children}</PermCtx.Provider>;
}
