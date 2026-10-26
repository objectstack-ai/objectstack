/**
 * Import-wizard target fields for an object (extracted from ObjectView so the
 * writable / match-only derivation is unit-testable).
 *
 * Writable fields are importable WRITE targets. Computed types
 * (formula/summary) have no storage column and FLS-restricted fields get a 403
 * from the write path — so those are omitted from the mapping step (and the
 * downloadable template) rather than let a user map to a column the import
 * will reject. The FLS bit comes from the server-resolved /me/permissions
 * channel (checkField), not from the schema, which carries no per-caller
 * permission bits (objectstack#3661). The question asked is the `listImport`
 * row's of the affordance-to-grant map (objectui#12082): `create`, the
 * server's insert rule — the Import affordance itself is gated on the create
 * grant, so a create-only caller who is offered Import can map every field the
 * insert accepts, instead of finding every target refused by the edit grant.
 *
 * Storage-backed but non-writable fields — autonumber and `readonly` — stay in
 * the list as MATCH-ONLY targets (#020: "update the row whose record number
 * already exists"). They are mappable so update/upsert can match on them (the
 * record number is usually the only natural key the file carries); the engine
 * strips readonly values from updates and respects explicitly-seeded values on
 * insert, so passing their values through is safe. Gated on FLS read —
 * matching leaks the column's values by existence.
 */

import { resolveFieldAffordance } from '@object-ui/core';

export interface ImportTargetField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  matchOnly?: boolean;
  options?: unknown;
}

/** Minimal slice of the permissions channel this helper consults. */
export interface ImportFieldPerms {
  isLoaded: boolean;
  checkField(objectName: string, fieldName: string, op: 'read' | 'write' | 'create'): boolean;
}

const COMPUTED_TYPES = new Set(['formula', 'summary']);

export function importTargetFields(
  objectName: string,
  fields: Record<string, any> | undefined,
  perms?: ImportFieldPerms | null,
): ImportTargetField[] {
  const out: ImportTargetField[] = [];
  for (const [name, def] of Object.entries(fields || {})) {
    const computed = COMPUTED_TYPES.has(def?.type);
    const writable = !computed
      && def?.type !== 'autonumber'
      && !def?.readonly
      && resolveFieldAffordance('listImport', perms, objectName, name);
    const matchOnly = !writable && !computed
      && (!perms?.isLoaded || perms.checkField(objectName, name, 'read'));
    if (!writable && !matchOnly) continue;
    out.push({
      name,
      label: def?.label || name,
      type: def?.type || 'text',
      // A non-writable target can never be a required WRITE column —
      // `required` only steers the mapping step's completeness hint.
      required: writable && !!def?.required,
      ...(matchOnly ? { matchOnly: true } : {}),
      // Enum options seed the downloadable template's example row.
      ...(def?.options ? { options: def.options } : {}),
    });
  }
  return out;
}
