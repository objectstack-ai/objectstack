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
 * field-level security judges an update of the stored row.
 */
export interface RecordFieldAccessAnswer {
  readonly editable: readonly string[];
}

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
 */
function scoped(
  parent: PermissionContextValue,
  object: string,
  recordId: string,
  answer: RecordFieldAccessAnswer | null,
): PermissionContextValue {
  const key = scopeKey(object, recordId);
  let byRecord = SCOPED.get(parent);
  if (!byRecord) {
    byRecord = new Map();
    SCOPED.set(parent, byRecord);
  }
  let byAnswer = byRecord.get(key);
  if (!byAnswer) {
    byAnswer = new WeakMap();
    byRecord.set(key, byAnswer);
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
  SCOPE_OF.set(value, key);
  byAnswer.set(answerKey, value);
  return value;
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
 * stands, so a conditioned field shows locked rather than briefly open.
 *
 * ⛔ The projection is field-level only. The record's row-level write scope
 * (sharing, row-level security, ownership) and the object grant are not part
 * of it: a row the caller may read but not write still answers its fields
 * editable here, and the server refuses the save as a whole, as it did before
 * this scope existed. The form-wide lock (`gateFormFields` in
 * `@object-ui/plugin-form`) keeps reading the object grant.
 *
 * With no enclosing provider there is no field answer to refine, so the scope
 * renders its children as they are and asks nothing.
 */
export function RecordFieldAccessScope({ object, recordId, load, children }: RecordFieldAccessScopeProps) {
  const parent = useContext(PermCtx);
  const key = scopeKey(object, recordId);
  const nested = !!parent && SCOPE_OF.get(parent) === key;
  const [answer, setAnswer] = useState<{ key: string; value: RecordFieldAccessAnswer | null } | null>(null);

  useEffect(() => {
    if (!parent || nested) return;
    let alive = true;
    Promise.resolve()
      .then(() => load(object, recordId))
      .then(
        (value) => { if (alive) setAnswer({ key, value: value && Array.isArray(value.editable) ? value : null }); },
        () => { if (alive) setAnswer({ key, value: null }); },
      );
    return () => { alive = false; };
    // `load` is deliberately not a trigger: callers pass an inline closure, and
    // the answer belongs to the record, not to the function that fetched it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!parent, nested, key]);

  if (!parent || nested) return <>{children}</>;
  const current = answer?.key === key ? answer.value : null;
  return <PermCtx.Provider value={scoped(parent, object, recordId, current)}>{children}</PermCtx.Provider>;
}
