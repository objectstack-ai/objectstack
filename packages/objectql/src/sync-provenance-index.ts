// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D4] The index a `managedBy: 'synced'` object carries over its
 * provenance columns: (`organization_id`, `_sync_source`, `_sync_external_id`),
 * which "serves the delete diff and the match" — a pull's rows of one mapping
 * in one organization, by their key in the source.
 *
 * It is a stamp of the registered schema, like the tenant-scope index
 * (`provisionTenantScopeIndex`), and it follows that stamp's two rules:
 *
 *  - **Gated on the document, never on a flag.** It is appended when the
 *    object carries the two provenance columns the plan
 *    (`resolveInjectedSystemColumns`) gives a `synced` object. No author field
 *    can take a `_sync_` name (`ObjectSchema` reserves the prefix), so carrying
 *    them is the plan's answer, read at either site in either order. The
 *    tenant column leads the index when the object has one; an object without
 *    it gets the two provenance columns alone.
 *  - **Appended LAST, and removed FIRST.** The tenant index's write-side
 *    inverse re-stamps and compares, which holds only while its entry is the
 *    last one; so this stamp runs after it at both producers
 *    (`applySystemFields`, `materializeBaseLayer`), and its own inverse
 *    ({@link stripProvisionedSyncProvenanceIndexFrom}) runs before the tenant
 *    one in `stripMaterializedStampsFrom`.
 *
 * An index the author already declares with exactly these columns is not
 * duplicated.
 */

import { resolveInjectedSystemColumns, SYNC_PROVENANCE_COLUMNS, SYNC_PROVENANCE_FIELD_DEFS } from '@objectstack/spec/data';

type Rec = Record<string, unknown>;

const [SYNC_SOURCE, SYNC_EXTERNAL_ID] = SYNC_PROVENANCE_COLUMNS;
const TENANT_COLUMN = 'organization_id';

function fieldsRecord(schema: unknown): Rec | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
  const fields = (schema as Rec).fields;
  return fields && typeof fields === 'object' && !Array.isArray(fields) ? (fields as Rec) : undefined;
}

/**
 * The provenance index this object is owed, or `undefined` when it carries no
 * provenance columns.
 */
export function syncProvenanceIndexFor(schema: unknown): { fields: string[] } | undefined {
  const fields = fieldsRecord(schema);
  if (!fields || fields[SYNC_SOURCE] === undefined || fields[SYNC_EXTERNAL_ID] === undefined) return undefined;
  return {
    fields: fields[TENANT_COLUMN] !== undefined
      ? [TENANT_COLUMN, SYNC_SOURCE, SYNC_EXTERNAL_ID]
      : [SYNC_SOURCE, SYNC_EXTERNAL_ID],
  };
}

/**
 * The provenance columns `applySystemFields` adds to a `synced` object (the
 * caller asks the plan's `sync` first): the mapping that wrote the row, its
 * key in the source, when and by which run it was last written, and D3's mark
 * (planned with the rest, written by nothing until the delete marking lands).
 * `readonly`, `system`, `hidden`: the pull, writing as the system, is their one
 * writer, and the engine refuses any other write that names one
 * (`refuseSyncProvenanceWrite`). No author field can take a `_sync_` name, so
 * skipping a column the schema already carries only ever keeps the platform's
 * own definition coming back through a re-registration.
 */
export function syncProvenanceColumnAdditions(schema: unknown): Rec {
  const present = fieldsRecord(schema) ?? {};
  const additions: Rec = {};
  for (const name of SYNC_PROVENANCE_COLUMNS) {
    if (!present[name]) additions[name] = { ...SYNC_PROVENANCE_FIELD_DEFS[name] };
  }
  return additions;
}

function sameColumns(entry: unknown, columns: readonly string[]): boolean {
  const fields = entry && typeof entry === 'object' ? (entry as Rec).fields : undefined;
  return Array.isArray(fields) && fields.length === columns.length && fields.every((f, i) => f === columns[i]);
}

/** Is `entry` exactly a platform stamp (one of its two column lists, and no other key)? */
function isPlatformEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (Object.keys(entry as Rec).length !== 1) return false;
  return sameColumns(entry, [TENANT_COLUMN, SYNC_SOURCE, SYNC_EXTERNAL_ID]) || sameColumns(entry, [SYNC_SOURCE, SYNC_EXTERNAL_ID]);
}

/** Append the provenance index an object is owed. Returns `schema` by reference when nothing is owed. */
export function provisionSyncProvenanceIndex<T>(schema: T): T {
  const owed = syncProvenanceIndexFor(schema);
  if (!owed) return schema;
  const declared = (schema as Rec).indexes;
  const present = Array.isArray(declared) ? declared : [];
  if (present.some((entry) => sameColumns(entry, owed.fields))) return schema;
  return { ...(schema as Rec), indexes: [...present, owed] } as T;
}

/**
 * The write-side inverse of {@link provisionSyncProvenanceIndex}: remove the
 * stamp a served document picked up, so a GET → edit → PUT round trip stores
 * the body the author wrote. Only the LAST entry is a candidate, and only when
 * it is exactly the platform's (an author's entry with a `name` or `unique`
 * stays). An emptied list is the absence of the key, as for the tenant stamp.
 *
 * Gated on the PLAN (`managedBy: 'synced'`), not on the document's columns: a
 * body handed here may already have had its injected columns stripped, and
 * either column list is accepted for the same reason (whether the tenant
 * column led the stamp is not readable off a stripped body).
 * Returns `base` by reference when nothing was owed.
 */
export function stripProvisionedSyncProvenanceIndexFrom<T>(base: T): T {
  if (base === null || typeof base !== 'object') return base;
  if (!resolveInjectedSystemColumns(base).sync) return base;
  const present = (base as Rec).indexes;
  if (!Array.isArray(present) || present.length === 0) return base;
  if (!isPlatformEntry(present[present.length - 1])) return base;
  const kept = present.slice(0, -1);
  const without = { ...(base as Rec) };
  if (kept.length === 0) delete without.indexes;
  else without.indexes = kept;
  return without as T;
}
