/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Seeding an action's `recordIdParam` from the row — and refusing to dispatch
 * when the row cannot supply it (objectstack#8018).
 *
 * An `api` action declaring `recordIdParam` names the request key that carries
 * the record it acts on; `recordIdField` names the row field whose value seeds
 * it (default `id`). Every call site used to spell the read the same permissive
 * way:
 *
 * ```ts
 * const rowValue = rowRecord[action.recordIdField || 'id'];
 * if (rowValue != null) body[action.recordIdParam] = rowValue;   // else: nothing
 * ```
 *
 * The `else` branch is the defect. It cannot distinguish "this row has no such
 * key" from "this row's value is null", and in both cases it drops the parameter
 * and lets the request go out anyway. What reaches the server is a mutation with
 * no record named — and a backend that treats a missing selector as "match
 * nothing" answers `{ status: true }` for having deleted nothing. The user is
 * told the action succeeded. The measured instance was a session-revocation
 * control that revoked nothing, which is the worst shape this can take: a
 * security affordance that reports success while no-op'ing.
 *
 * The absent-key half is reachable from ordinary authoring, not just from bad
 * data: the grid projects `$select` from the listView columns, so until
 * `recordIdField` was harvested into it (see `listViewPredicates`) any action
 * keyed on a non-column field got a row without that key. The harvest closes the
 * common route; this guard closes the class, because a row can still lack the key
 * for reasons projection cannot fix — a server-side read mask that strips the
 * field regardless of projection (`internal: true`), a partial payload handed
 * down from a host, a field the principal cannot read.
 *
 * Contract-first (AGENTS.md #0.1): the answer to an under-specified request is to
 * refuse it at the producer, loudly, not to send it and hope the server objects.
 * The two failures are named separately because they point at different repairs —
 * an absent key is a projection/visibility problem, a null value is a data one.
 */

/** The minimal action shape this resolution reads. */
export interface RecordIdParamAction {
  /** Request key that carries the record id. Absent ⇒ no injection is declared. */
  recordIdParam?: string;
  /** Row field whose value seeds it. Defaults to `id`. */
  recordIdField?: string;
  /** Used only to make the refusal message name the action. */
  name?: string;
  label?: string;
}

/**
 * Either the value to inject, or the reason the action must not be dispatched.
 * `{}` (neither key) means no injection is declared — carry on unchanged.
 */
export type RecordIdParamSeed =
  | { value: unknown; error?: undefined }
  | { value?: undefined; error: string }
  | { value?: undefined; error?: undefined };

/**
 * Resolve the value an action's `recordIdParam` should carry, or the refusal.
 *
 * Pure — reads the action and the row, mutates nothing. Returns `{}` when the
 * action declares no `recordIdParam` (nothing to inject) or when there is no row
 * record at all (the caller is on a path where no row context exists; that is not
 * this guard's business).
 */
export function resolveRecordIdParamSeed(
  action: RecordIdParamAction | null | undefined,
  rowRecord: Record<string, unknown> | null | undefined,
): RecordIdParamSeed {
  const param = action?.recordIdParam;
  if (!param || !rowRecord || typeof rowRecord !== 'object') return {};

  const field = action?.recordIdField || 'id';
  const label = action?.label || action?.name || param;

  if (!(field in rowRecord)) {
    return {
      error:
        `Action "${label}" identifies its record by "${field}", but that field is not ` +
        `present on the row. Add it to the view's columns, or check that it is readable ` +
        `— running without it would send a request that names no record.`,
    };
  }

  const value = rowRecord[field];
  if (value == null) {
    return {
      error:
        `Action "${label}" identifies its record by "${field}", but this record has no ` +
        `value for it — running without it would send a request that names no record.`,
    };
  }

  return { value };
}
