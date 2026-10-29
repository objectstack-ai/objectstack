// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A writable external object (ADR-0015) on an owner-keyed sharing model whose
 * owner column no remote row serves: every member edit and delete is refused.
 *
 * ## The mechanism this warns about
 *
 * Before a by-id update or delete, the platform runs two row-level checks
 * (measured through `PATCH /data/:object/:id` and `DELETE` over a plugin
 * driver, the spike `plugin-driver-external-object.spike.test.ts` step e3):
 *
 *  - **record sharing** (`plugin-sharing` `checkEdit` / `checkDelete`) asks the
 *    remote for the row's `owner_id` when the sharing model is `private` or
 *    `public_read` and the object carries an `owner_id` column;
 *  - **the platform ownership floor** (`owner_only_writes` /
 *    `owner_only_deletes`, `created_by == current_user.id`) stays in force
 *    unless record sharing answers `allow` or the model is
 *    `public_read_write` (which opens updates, never deletes).
 *
 * The registry injects `owner_id` and `created_by` into an external object
 * too, but provisions no storage for them, so no remote row carries either:
 * `owner_id` reads as null (sharing answers `deny`) and `created_by` never
 * equals the caller (the floor refuses). A member whose permission set grants
 * `allowEdit` gets 403 `PERMISSION_DENIED` on every row, and only an
 * administrator can write. `ownership: 'none'` (or `'org'` /
 * `'business_unit'`) is NOT a way out: it withholds `owner_id`, so record
 * sharing abstains, and the floor's `created_by` read refuses the same write
 * (measured: 403 on update and delete).
 *
 * ## The two arms
 *
 *  1. The object carries `owner_id` (`ownership: 'user'`, the default) as the
 *     platform's unprovisioned anchor, and `external.columnMap` maps no remote
 *     column to it ⇒ record sharing refuses.
 *  2. The object carries no `owner_id` (another `ownership` tier) and its
 *     `created_by` is the unprovisioned anchor that `external.columnMap` does
 *     not map, or is absent (`systemFields.audit: false`, where the floor
 *     compiles to a deny) ⇒ the floor refuses.
 *
 * A column the author DECLARES in `fields` is the author's (they vouch for a
 * remote column of that name, or map one to it) and silences its arm — the
 * same provenance the runtime guards read (`resolveInjectedColumnProvenance`,
 * `@objectstack/spec/data`).
 *
 * ## Deliberately not judged
 *
 *  - A read-only binding (`external.writable` not `true`): no member can edit
 *    it whatever the sharing model says, so the refusal is not this one.
 *  - `public_read_write` and `controlled_by_parent`: the first lifts the floor
 *    for updates (who may edit is a hook's decision), the second hands row
 *    writes to the master's gate. Deletes on a `public_read_write` external
 *    object still meet the floor; that is the OWD's own boundary
 *    (`owdOpenWritesCoversOperation`, plugin-security), explained in the
 *    rule's `os explain` entry, and not reported here.
 *  - A system object with no `sharingModel` (`isSystem`, `sys_*`): its unset
 *    model is public (`effectiveSharingModelOf`).
 *
 * Advisory (warning), never a refusal: the stack is valid, an administrator
 * can still write, and refusing it at `defineStack` would narrow the published
 * accept set.
 */

import { resolveInjectedColumnProvenance } from '@objectstack/spec/data';
import { recordsOf } from './object-graph.js';
import { effectiveSharingModelOf } from './validate-sharing-rule-enforceability.js';

export type ExternalOwnerSharingSeverity = 'warning';

export interface ExternalOwnerSharingFinding {
  severity: ExternalOwnerSharingSeverity;
  rule: string;
  /** Human-readable location, e.g. `object "berth_slot"`. */
  where: string;
  /** Config path, e.g. `objects[3].sharingModel`. */
  path: string;
  message: string;
  hint: string;
}

// Rule id (registry entry).
export const SECURITY_EXTERNAL_OWNER_UNMAPPED = 'security-external-owner-unmapped';

type AnyRec = Record<string, unknown>;

const OWNER_COLUMN = 'owner_id';
const CREATOR_COLUMN = 'created_by';

const PUBLIC_READ_WRITE_WAY_OUT =
  "declare sharingModel: 'public_read_write' and decide who may edit in a beforeUpdate hook";

/** Does `external.columnMap` (remote column → local field) map some remote column to `field`? */
function columnMapServes(external: AnyRec, field: string): boolean {
  const map = external.columnMap;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  return Object.values(map as AnyRec).includes(field);
}

/**
 * The column whose missing storage refuses every member write on this object,
 * and whether the injection supplies it at all — or `undefined` when a remote
 * column serves the check that keys this object's writes.
 */
function unservedOwnershipColumn(
  obj: AnyRec,
  external: AnyRec,
): { column: string; injected: boolean } | undefined {
  const owner = resolveInjectedColumnProvenance(obj, OWNER_COLUMN);
  if (owner === 'author' || owner === 'injected-provisioned') return undefined;
  if (owner === 'injected-unprovisioned') {
    return columnMapServes(external, OWNER_COLUMN) ? undefined : { column: OWNER_COLUMN, injected: true };
  }
  // No `owner_id` at all: record sharing abstains and the floor decides.
  const creator = resolveInjectedColumnProvenance(obj, CREATOR_COLUMN);
  if (creator === 'author' || creator === 'injected-provisioned') return undefined;
  if (creator === 'injected-unprovisioned') {
    return columnMapServes(external, CREATOR_COLUMN) ? undefined : { column: CREATOR_COLUMN, injected: true };
  }
  return { column: CREATOR_COLUMN, injected: false };
}

/**
 * Flag every writable external object on an owner-keyed sharing model whose
 * ownership column no remote column serves. Returns the findings (empty =
 * clean); the CLI folds them in as advisory warnings.
 */
export function validateExternalOwnerSharing(stack: AnyRec): ExternalOwnerSharingFinding[] {
  const out: ExternalOwnerSharingFinding[] = [];
  if (!stack || typeof stack !== 'object') return out;
  const objects = recordsOf(stack.objects);

  objects.forEach((obj, i) => {
    const external = obj.external;
    if (!external || typeof external !== 'object' || Array.isArray(external)) return;
    if ((external as AnyRec).writable !== true) return;
    const model = effectiveSharingModelOf(obj);
    if (model === 'public') return;
    const unserved = unservedOwnershipColumn(obj, external as AnyRec);
    if (!unserved) return;

    const name = typeof obj.name === 'string' ? obj.name : `(object ${i})`;
    const declared = typeof obj.sharingModel === 'string' ? `'${obj.sharingModel}'` : "'private' (the default)";
    const check =
      unserved.column === OWNER_COLUMN
        ? 'record sharing reads it'
        : 'with no owner_id, the ownership floor reads created_by == the caller';
    const mapWayOut =
      unserved.column === OWNER_COLUMN
        ? 'map the remote owner column to owner_id through external.columnMap and declare owner_id in fields'
        : unserved.injected
          ? 'map the remote creator column to created_by through external.columnMap'
          : 'let the platform inject the audit columns (systemFields) and map the remote creator column to created_by through external.columnMap';

    out.push({
      severity: 'warning',
      rule: SECURITY_EXTERNAL_OWNER_UNMAPPED,
      where: `object "${name}"`,
      path: `objects[${i}].sharingModel`,
      // [#22161] One verdict sentence and one fix; the two checks, why
      // `ownership: 'none'` is no way out and what deletes meet are
      // `os explain security-external-owner-unmapped`.
      message:
        `external object on sharing model ${declared}, but no remote column serves '${unserved.column}' ` +
        `(${check} before every edit and delete), so every member write is refused (403)`,
      hint: `Either ${PUBLIC_READ_WRITE_WAY_OUT}, or ${mapWayOut}`,
    });
  });

  return out;
}
