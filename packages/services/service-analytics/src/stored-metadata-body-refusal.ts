// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21120] The analytics door's half of the stored-metadata-body security
 * family: a query that names the stored body column of `sys_metadata` /
 * `sys_metadata_history` as a dimension, measure, filter or sort key is
 * REFUSED here, before any strategy is selected.
 *
 * ## Why refuse rather than project
 *
 * A `/meta` read, the generic data door and the audit copy all PROJECT the body
 * through the one shared redactor ({@link isStoredMetadataBodyObject}'s family),
 * because they SERVE the body as a value and a projection is a complete answer.
 * An analytics member is not served as a value — it is evaluated:
 *
 *  - a DIMENSION's group KEY is the whole stored body, and a key cannot be
 *    projected without changing which rows it counts (the same reason #21115
 *    refuses `groupBy` on the body column at the data door);
 *  - a FILTER or SORT on the body column evaluates the stored body row by row,
 *    which rebuilds a withheld credential by prefix probing even when no value
 *    is ever returned (the filter-oracle this service already refuses for a
 *    masked field, `field-read-admission.ts`).
 *
 * So the body column is simply not a valid analytics member on these objects,
 * and the refusal is the existing invalid-member one — `INVALID_FIELD` / 400,
 * the code and status every member refusal in `analytics-service.ts` answers —
 * naming the field, the object and the role. This is the refusal-based posture
 * analytics already takes for a member it will not evaluate, applied to the one
 * column whose evaluation is a credential disclosure; it is NOT a permission
 * check, so it runs whether or not a security provider is wired.
 *
 * ## What stays answerable
 *
 * Every OTHER member of these objects — `type`, `name`, `scope`, `state`,
 * timestamps — is grouped, filtered and counted as before, so the Setup grids
 * and "All Metadata" dashboards that chart metadata by type keep working. Only
 * the body column is refused.
 */

import { isStoredMetadataBodyObject, STORED_METADATA_BODY_COLUMN } from '@objectstack/spec/kernel';
import type { StandardErrorCode } from '@objectstack/spec/api';
import type { NamedField, NamedRead } from './field-read-admission.js';

/** `INVALID_FIELD`, pinned against the STANDARD catalog — the member refusal every sibling answers. */
const INVALID_FIELD: StandardErrorCode = 'INVALID_FIELD';

/** One field a query reads, on the object that declares it, in the role it is read in. */
export type NamedAnalyticsField = NamedField;

/** The `INVALID_FIELD` / 400 refusal for the stored body column, or `undefined` when none applies. */
export function storedMetadataBodyAnalyticsRefusal(
  named: readonly NamedRead[],
): (Error & { code: string; status: number; field: string; object: string; param: string }) | undefined {
  for (const f of named) {
    // A member that names no field (an authored expression) is not judged
    // here: no field can be attributed to it, and the field-level gate refuses
    // it outright (`field-read-admission.ts`, the expression refusal) — one
    // rule for expressions, never a second one in this module.
    if ('expression' in f) continue;
    if (!isStoredMetadataBodyObject(f.object) || f.field !== STORED_METADATA_BODY_COLUMN) continue;
    const param = f.role === 'aggregate' ? 'dimensions' : 'where';
    const err = new Error(
      `Cannot query '${f.object}' by '${STORED_METADATA_BODY_COLUMN}': the query was not run. The `
      + `${STORED_METADATA_BODY_COLUMN} column holds a stored metadata body, with stored credential material `
      + `withheld on every read exit; grouping, aggregating, filtering or sorting by it would evaluate the `
      + `stored body (a group key that cannot be projected, or a filter oracle that rebuilds a withheld value `
      + `by probing). Group, filter or sort by 'type', 'name' or another scalar column instead.`,
    ) as Error & { code: string; status: number; field: string; object: string; param: string };
    err.code = INVALID_FIELD;
    err.status = 400;
    err.field = STORED_METADATA_BODY_COLUMN;
    err.object = f.object;
    err.param = param;
    return err;
  }
  return undefined;
}
