// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The **one** answer to "which keys on an object's audit-provenance columns are
 * platform-owned rather than authorable?" — and the normalizer that applies
 * that answer to a metadata document (objectstack#4513, from objectstack#4447).
 *
 * ## What #4447 established, and the half it left open
 *
 * `applySystemFields` (`@objectstack/objectql`) injects the
 * {@link AUDIT_PROVENANCE_FIELDS} family and, since #4447, **forces**
 * `readonly: true` / `system: true` over a *declared* audit field as well:
 * `fields: { ...additions, ...schema.fields, ...overrides }`. That is what the
 * write path enforces — `ObjectQL.update` strips a non-system caller's write to
 * a statically-`readonly` field off the registry's post-injection schema, so a
 * forged `created_at` is refused whatever the author declared.
 *
 * The **read** path never learned it. `GET /api/v1/meta/objects/:name` answers
 * from `sys_metadata` (the stored overlay / build-artifact body) first and
 * consults the registry only as a fallback, so an object whose artifact ships a
 * materialized `created_at` carrying FieldSchema DEFAULTS (`readonly: false`)
 * reported `readonly: false` to every client while writes to that same field
 * were being refused. Measured on `origin/main` before this module existed, all
 * four protocol read exits agreed with each other and disagreed with the
 * engine:
 *
 * ```
 * single  read: {"type":"datetime","label":"Created At","readonly":false}
 * list    read: {"type":"datetime","label":"Created At","readonly":false}
 * cached  read: {"type":"datetime","label":"Created At","readonly":false}
 * layered read: {"type":"datetime","label":"Created At","readonly":false}
 * ```
 *
 * One field, two answers, and the machine-readable one was the wrong one — the
 * face that clients, and AI authors writing code against `/meta`, are the only
 * ones able to see.
 *
 * ## Why this module lives in `@objectstack/metadata-core`
 *
 * The same criterion `engine-delete-dispatch.ts` records, for the same cycle:
 * `@objectstack/objectql` **depends on** `@objectstack/metadata-protocol`, so
 * the read path cannot import the governance table from the registry that owns
 * it. When a reverse import is impossible, the only honest way out is to sink
 * the contract into a package **both sides already depend on** — and this
 * package's own dependencies are `{ @objectstack/spec, zod }`, so there is no
 * new edge and no new cycle.
 *
 * The alternative — a second governance table inside the read path — is exactly
 * the drift this repo keeps paying for: the read would agree with the write
 * only until someone edited one side, which is the state #4513 records.
 *
 * ## What it deliberately does NOT do
 *
 * - **It governs only DECLARED audit fields.** `applySystemFields` *injects* an
 *   absent one; this normalizer does not, because the served document is the
 *   authored metadata document and injecting columns into it would rewrite what
 *   a `GET` → `PUT` round-trip persists (the #4326 invariant) and what the
 *   layered read reports as "customised". An absent field does not claim
 *   `readonly: false`, so it is not the lie #4513 names.
 * - **It governs only the audit family.** A declared `organization_id` /
 *   `owner_id` / `owning_business_unit_id` is the author's field and the
 *   registry lets it win (those are `additions`, not `overrides`), so reporting
 *   the author's value for them already agrees with what the write path
 *   enforces. Forcing them here would create the mismatch in the other
 *   direction.
 */

import {
  AUDIT_PROVENANCE_FIELDS,
  resolveInjectedSystemColumns,
  type AuditProvenanceField,
} from '@objectstack/spec/data';

/**
 * The subset of an audit column's definition that is NOT authorable — the keys
 * that decide **who may write** the column.
 *
 * Only `readonly` / `system` travel: everything else an author writes —
 * `label`, `description`, `hidden`, `group`, and even `type` for an external
 * object mapping a differently-typed remote column — stays theirs. Narrower is
 * the point: this overrides an author, so it takes only what the defect
 * requires (#4447).
 *
 * Keyed by the spec's {@link AUDIT_PROVENANCE_FIELDS} tuple, so a name added
 * there without an entry here — or an entry for a name the spec dropped — is a
 * compile error rather than a silently diverging copy.
 */
export const AUDIT_FIELD_GOVERNANCE: Record<AuditProvenanceField, Record<string, unknown>> =
  Object.fromEntries(
    AUDIT_PROVENANCE_FIELDS.map((name) => [name, { readonly: true, system: true }]),
  ) as unknown as Record<AuditProvenanceField, Record<string, unknown>>;

/** Does this field definition already carry every governance key at its governed value? */
function isGoverned(declared: unknown, governance: Record<string, unknown>): boolean {
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return false;
  const rec = declared as Record<string, unknown>;
  for (const [key, value] of Object.entries(governance)) {
    if (rec[key] !== value) return false;
  }
  return true;
}

/**
 * Force {@link AUDIT_FIELD_GOVERNANCE} onto every audit-provenance field the
 * document declares, so what a reader is told about who may write the column
 * matches what the engine enforces.
 *
 * Pure and total, with the same tolerance contract as
 * {@link resolveInjectedSystemColumns}: any input may be handed to it,
 * including a bare record that has never been through Zod. Objects that opt out
 * of the audit family (`systemFields: false`, `systemFields.audit: false`,
 * `managedBy: 'better-auth'`) carry no platform governance and are returned
 * untouched — the same rows `applySystemFields` skips.
 *
 * Returns the **same reference** when nothing needed forcing, so a read path
 * that already agrees with the engine (a registry-sourced document, which went
 * through `applySystemFields` at registration) pays one comparison and no copy.
 *
 * @param doc An object metadata document, or any bare record shaped like one.
 */
export function applyAuditFieldGovernance<T>(doc: T): T {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  const rec = doc as unknown as Record<string, unknown>;
  const fields = rec.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return doc;

  // WHICH columns this object carries is the spec's derivation — the same one
  // `applySystemFields` consumes. Re-deriving the opt-out conditions here is
  // precisely the drift this module exists to prevent.
  if (!resolveInjectedSystemColumns(rec).audit) return doc;

  const declaredFields = fields as Record<string, unknown>;
  let governed: Record<string, unknown> | undefined;
  for (const name of AUDIT_PROVENANCE_FIELDS) {
    const declared = declaredFields[name];
    // Absent is not a lie — see the module header. Only a DECLARED audit field
    // can claim a writability the engine refuses.
    if (declared === undefined || declared === null) continue;
    if (isGoverned(declared, AUDIT_FIELD_GOVERNANCE[name])) continue;
    governed ??= { ...declaredFields };
    governed[name] = typeof declared === 'object' && !Array.isArray(declared)
      ? { ...(declared as Record<string, unknown>), ...AUDIT_FIELD_GOVERNANCE[name] }
      : { ...AUDIT_FIELD_GOVERNANCE[name] };
  }

  if (governed === undefined) return doc;
  return { ...rec, fields: governed } as unknown as T;
}
