// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A writable external object (ADR-0015) on an owner-keyed sharing model that
 * declares no ownership column a remote row serves: every member edit and
 * delete is refused.
 *
 * ## The mechanism this warns about
 *
 * Before a by-id update or delete, the platform runs two row-level checks
 * (measured through `PATCH /data/:object/:id` and `DELETE` over a plugin
 * driver, the spike `plugin-driver-external-object.spike.test.ts` step e3):
 *
 *  - **record sharing** (`plugin-sharing` `checkEdit` / `checkDelete`) asks the
 *    driver for the row's `owner_id` when the sharing model is `private` or
 *    `public_read` and the object carries an `owner_id` column;
 *  - **the platform ownership floor** (`owner_only_writes` /
 *    `owner_only_deletes`, `created_by == current_user.id`) stays in force
 *    unless record sharing answers `allow` or the model is
 *    `public_read_write` (which opens updates, never deletes).
 *
 * The registry injects `owner_id` and `created_by` into an external object
 * too, but provisions no storage for them, so a remote row carries neither:
 * `owner_id` reads as null (sharing answers `deny`) and `created_by` never
 * equals the caller (the floor refuses). A member whose permission set grants
 * `allowEdit` gets 403 `PERMISSION_DENIED` on every row unless an
 * app-authored row-level write policy admits it (sharing's
 * `admitsByIdWrite` retracts its refusal for such a row), and otherwise only
 * an administrator can write. `ownership: 'none'` (or `'org'` /
 * `'business_unit'`) is NOT a way out: it withholds `owner_id`, so record
 * sharing abstains, and the floor's `created_by` read refuses the same write
 * (measured: 403 on update and delete).
 *
 * What lets the owner write is the DRIVER returning the remote owner under the
 * field name the check reads. `external.columnMap` is applied by the built-in
 * SQL drivers, not by the engine: on a plugin driver an entry mapping a remote
 * column to `owner_id` changes nothing, and the driver must return the field
 * itself. So the author's vouch this rule reads is a DECLARED field — the same
 * provenance the runtime guards read (`resolveInjectedColumnProvenance`,
 * `@objectstack/spec/data`) — never a `columnMap` entry alone. A declared
 * `owner_id` also scopes reads by owner; the platform's own injected one does
 * not (plugin-sharing treats it as unstored and leaves reads unscoped).
 *
 * ## The two arms
 *
 *  1. The object carries `owner_id` (`ownership: 'user'`, the default) as the
 *     platform's anchor, not declared ⇒ record sharing refuses.
 *  2. The object carries no `owner_id` (another `ownership` tier) and its
 *     `created_by` is the platform's anchor, not declared, or is absent
 *     (`systemFields.audit: false`, where the floor compiles to a deny) ⇒ the
 *     floor refuses.
 *
 * Each arm words its finding for a `columnMap` entry that targets the column
 * without a declaration: on a built-in SQL driver that map serves the check,
 * on a plugin driver it does not, and the declaration is what holds on both.
 *
 * ## Deliberately not judged
 *
 *  - A read-only binding (`external.writable` not `true`), or one on a
 *    datasource this stack declares with `external.allowWrites: false`: no
 *    member can edit it whatever the sharing model says, so the refusal is
 *    not this one.
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
function columnMapTargets(external: AnyRec, field: string): boolean {
  const map = external.columnMap;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  return Object.values(map as AnyRec).includes(field);
}

/**
 * The column whose missing storage refuses every member write on this object,
 * and whether the injection supplies it at all — or `undefined` when the
 * author declares the column the check that keys this object's writes reads.
 */
function undeclaredOwnershipColumn(obj: AnyRec): { column: string; injected: boolean } | undefined {
  const owner = resolveInjectedColumnProvenance(obj, OWNER_COLUMN);
  if (owner === 'author' || owner === 'injected-provisioned') return undefined;
  if (owner === 'injected-unprovisioned') return { column: OWNER_COLUMN, injected: true };
  // No `owner_id` at all: record sharing abstains and the floor decides.
  const creator = resolveInjectedColumnProvenance(obj, CREATOR_COLUMN);
  if (creator === 'author' || creator === 'injected-provisioned') return undefined;
  return { column: CREATOR_COLUMN, injected: creator === 'injected-unprovisioned' };
}

/**
 * Flag every writable external object on an owner-keyed sharing model that
 * declares no ownership column a remote row serves. Returns the findings
 * (empty = clean); the CLI folds them in as advisory warnings.
 */
export function validateExternalOwnerSharing(stack: AnyRec): ExternalOwnerSharingFinding[] {
  const out: ExternalOwnerSharingFinding[] = [];
  if (!stack || typeof stack !== 'object') return out;
  const objects = recordsOf(stack.objects);
  // ADR-0015's datasource half of the double write opt-in: a datasource this
  // stack declares with `external.allowWrites: false` (also the parsed
  // default) lets no write through, so no ownership check is what refuses.
  const readOnlyDatasources = new Set(
    recordsOf(stack.datasources)
      .filter((ds) => {
        const ext = ds.external;
        return !!ext && typeof ext === 'object' && (ext as AnyRec).allowWrites === false;
      })
      .map((ds) => ds.name),
  );

  objects.forEach((obj, i) => {
    const external = obj.external;
    if (!external || typeof external !== 'object' || Array.isArray(external)) return;
    if ((external as AnyRec).writable !== true) return;
    if (readOnlyDatasources.has(obj.datasource)) return;
    if (effectiveSharingModelOf(obj) === 'public') return;
    const undeclared = undeclaredOwnershipColumn(obj);
    if (!undeclared) return;

    const { column } = undeclared;
    const name = typeof obj.name === 'string' ? obj.name : `(object ${i})`;
    const model = typeof obj.sharingModel === 'string' ? `'${obj.sharingModel}'` : "'private' (the default)";
    const check =
      column === OWNER_COLUMN
        ? 'record sharing reads owner_id'
        : 'with no owner_id, the ownership floor reads created_by == the caller';
    const mapped = columnMapTargets(external as AnyRec, column);
    const role = column === OWNER_COLUMN ? 'owner' : 'creator';
    // [#27425] On `private`, record sharing also scopes READS by owner_id, and
    // an owner it cannot read admits no row: the edit's pre-image read finds
    // none, so the refusal is a 404 rather than the write check's 403.
    const refusal =
      column === OWNER_COLUMN && effectiveSharingModelOf(obj) === 'private'
        ? "(404: the member's read scope admits no row)"
        : '(403)';
    const declareWayOut =
      `declare ${column} in fields and have the driver return the remote ${role} under that name ` +
      '(a built-in SQL driver does it through external.columnMap; a plugin driver must return it itself)';

    out.push({
      severity: 'warning',
      rule: SECURITY_EXTERNAL_OWNER_UNMAPPED,
      where: `object "${name}"`,
      path: `objects[${i}].sharingModel`,
      // [#22161] One verdict sentence and one fix; the two checks, why
      // `ownership: 'none'` is no way out and what deletes meet are
      // `os explain security-external-owner-unmapped`.
      message: mapped
        ? `external object on sharing model ${model} maps a remote column to '${column}' through ` +
          `external.columnMap but declares no '${column}' field; ${check} before every edit and delete, ` +
          `and only a built-in SQL driver applies columnMap, so on a plugin driver every member write is refused ${refusal} ` +
          'unless an app-authored row-level policy admits the row'
        : `external object on sharing model ${model} declares no '${column}' field a remote row serves; ` +
          `${check} before every edit and delete, so every member write is refused ${refusal} unless an app-authored ` +
          'row-level policy admits the row',
      hint: mapped
        ? `Declare ${column} in fields (a plugin driver must return the remote ${role} under that name itself), ` +
          `or ${PUBLIC_READ_WRITE_WAY_OUT}`
        : `Either ${PUBLIC_READ_WRITE_WAY_OUT}, or ${declareWayOut}`,
    });
  });

  return out;
}
