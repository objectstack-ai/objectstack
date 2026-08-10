// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The **one** table of injected-system-column DEFINITIONS, and the served-document
 * injection / strip pair built on it (objectstack#6562, ruled Option B).
 *
 * ## The split this completes
 *
 * `resolveInjectedSystemColumns` (`@objectstack/spec/data`, #5378) is the one
 * answer to *"WHICH columns does the platform provision on THIS object without
 * the author declaring them?"*. It deliberately owns only the names — #3786's
 * split leaves *"WHAT does each one look like?"* to the runtime. Until now the
 * only copy of that second half lived inside `applySystemFields`
 * (`@objectstack/objectql`), reachable only by running the registry.
 *
 * That is the same wall #4513 hit and recorded one file over
 * ({@link applyAuditFieldGovernance}): `@objectstack/objectql` **depends on**
 * `@objectstack/metadata-protocol`, so the `/meta` read path cannot import from
 * the registry that owns the answer, and the reverse import closes a cycle turbo
 * rejects outright. The honest way out is the one this package already carries
 * twice — sink the contract into a package **both** sides depend on. This
 * package's own dependencies are `{ @objectstack/spec, zod }`, so there is no
 * new edge and no new cycle. `applySystemFields` now reads this table instead of
 * its own literals; the read path reads it too, and the two cannot drift because
 * there is nothing left for them to disagree about.
 *
 * ## Why a `/meta` read needs it at all (#6562)
 *
 * `GET /api/v1/meta/object/:name` answered a **different set of fields**
 * depending on which link of its resolution chain produced the answer:
 *
 *  - registry-backed → the schema AFTER `applySystemFields`, carrying
 *    `created_at` / `created_by` / `updated_at` / `updated_by` /
 *    `organization_id` / `owner_id` / `owning_business_unit_id` even when the
 *    author declared none of them;
 *  - overlay-backed (a `sys_metadata` row, or a MetadataService body) → the
 *    stored document VERBATIM, so every one of those columns was simply absent.
 *
 * Whether an object carries an overlay is invisible to the caller, so the same
 * request reported the platform's own columns or not, and nothing said which had
 * happened. An author reading the overlay-backed answer concludes the columns do
 * not exist — while every one of them is real in the database, filterable,
 * orderable and enforced read-only on write. The maintainer's ruling
 * (2026-08-08) is Option B: the read serves the EFFECTIVE runtime schema, and
 * the overlay-backed minority path converges on the registry-backed majority.
 *
 * ## The key that used to sit beside this table: `indexed` (#6810, closed)
 *
 * `applySystemFields` used to stamp `indexed: <multiTenant>` on top of
 * {@link TENANT_SCOPE_FIELD_DEF}, for the MongoDB driver's schema builder — the
 * only consumer. `indexed` is **not a `FieldSchema` key**: it was removed in the
 * 16.x line (#2377, ADR-0049) and `FieldSchema` is `strictObject`, so an object
 * document carrying it is rejected BY NAME:
 *
 * ```
 * Unrecognized key(s) on this field: `indexed`.
 *   • never a FieldSchema key; a field-level index flag built no index (#2377).
 * ```
 *
 * Measured on `origin/main` (2026-08-08): a registry-backed `/meta` object read
 * therefore answered `_diagnostics: { valid: false }` on exactly that key, in
 * BOTH multiTenant modes — filed as #6810, and deliberately not inherited here,
 * since converging the overlay-backed exit onto a key the object schema refuses
 * would have spread that defect rather than closed #6562's.
 *
 * #6810 closed it at the injection site rather than here: the tenant index is
 * declared in the object's `indexes[]` — the one surface an index is declared on
 * — and no served field carries `indexed` on either exit any more. What this
 * table carries is unchanged; there is simply nothing spread on top of it now.
 *
 * `multiTenant` was the *only* thing that key depended on, which is still why
 * nothing in this module takes a `multiTenant` input: per
 * `resolveInjectedSystemColumns`' own measurement, the flag changes whether
 * `organization_id` is INDEXED, never whether it EXISTS.
 */

import {
  AUDIT_PROVENANCE_FIELDS,
  resolveInjectedSystemColumns,
  type AuditProvenanceField,
} from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';

/**
 * Column definitions for the audit-provenance family, keyed by the spec's
 * {@link AUDIT_PROVENANCE_FIELDS} tuple — the canonical declaration of WHICH
 * columns exist (#3786). This table owns only WHAT each column looks like.
 *
 * The `satisfies` clause is the sync mechanism: a name added to the spec tuple
 * without a definition here — or a definition for a name the spec dropped — is
 * a compile error, not a silently diverging copy. Same discipline as the spec's
 * `APPROVER_VALUE_BINDINGS`.
 *
 * Moved here from `@objectstack/objectql`'s registry by #6562; see the module
 * header for why, and {@link AUDIT_FIELD_GOVERNANCE} for the subset of these
 * keys that is forced over a *declared* audit field rather than merely injected
 * in its absence.
 */
export const AUDIT_FIELD_DEFS = {
  created_at: {
    type: 'datetime',
    label: 'Created At',
    required: false,
    readonly: true,
    system: true,
    description: 'Timestamp when the record was created (auto-populated by the driver).',
  },
  created_by: {
    type: 'lookup',
    reference: 'sys_user',
    label: 'Created By',
    required: false,
    readonly: true,
    system: true,
    description: 'User who created the record (populated when an authenticated session is present).',
  },
  updated_at: {
    type: 'datetime',
    label: 'Last Modified At',
    required: false,
    readonly: true,
    system: true,
    description: 'Timestamp of the most recent modification (auto-populated by the driver).',
  },
  updated_by: {
    type: 'lookup',
    reference: 'sys_user',
    label: 'Last Modified By',
    required: false,
    readonly: true,
    system: true,
    description: 'User who last modified the record (populated when an authenticated session is present).',
  },
} satisfies Record<AuditProvenanceField, Record<string, unknown>>;

/**
 * `organization_id` — THE tenant scope anchor, in its **authorable** shape.
 *
 * Spread verbatim by `applySystemFields` — nothing is layered on top of it.
 * (#6810 removed the `indexed: opts.multiTenant` that used to be; the tenant
 * index is declared in the object's `indexes[]` instead. See the module header.)
 */
export const TENANT_SCOPE_FIELD_DEF: Readonly<Record<string, unknown>> = {
  type: 'lookup',
  reference: 'sys_organization',
  label: 'Organization',
  required: false,
  hidden: true,
  readonly: true,
  system: true,
  description:
    'Tenant scope (auto-populated by org-scoping on insert; NULL on single-tenant stacks).',
};

/**
 * `owner_id` — the canonical reassignable owner. `system: true` marks it
 * platform-provided (so tooling/migrations recognise it), but — unlike the audit
 * `*_by` lookups — it is NOT `readonly`: ownership is transferable, so it stays
 * editable in forms and assignable via the API. SecurityPlugin auto-stamps it to
 * the acting user on insert when left NULL.
 */
export const OWNER_FIELD_DEF: Readonly<Record<string, unknown>> = {
  type: 'lookup',
  reference: 'sys_user',
  label: 'Owner',
  required: false,
  readonly: false,
  system: true,
  description:
    'Record owner (auto-stamped to the creating user on insert; reassignable). ' +
    'Drives owner-scoped views, reports and notifications.',
};

/**
 * [ADR-0117 D1] `owning_business_unit_id` — record-level business-unit
 * ownership. Shaped after `organization_id` (a server-stamped scope anchor), NOT
 * after `owner_id` (a user-assignable business field). The full reasoning for
 * each of `readonly` / `hidden` / `required` — and for why the shape presumes
 * nothing about the still-unruled D2 policy — stays at the injection site in
 * `@objectstack/objectql`'s `applySystemFields`, which is where an author of the
 * stamping middleware will be reading.
 */
export const OWNING_BUSINESS_UNIT_FIELD_DEF: Readonly<Record<string, unknown>> = {
  type: 'lookup',
  reference: 'sys_business_unit',
  label: 'Owning Business Unit',
  required: false,
  hidden: true,
  readonly: true,
  system: true,
  description:
    'Record-level business-unit ownership (ADR-0117 D1). Server-stamped scope anchor; ' +
    'NULL until the stamping middleware lands.',
};

/**
 * The injected columns THIS object carries, as `name -> definition`.
 *
 * Gated entirely by {@link resolveInjectedSystemColumns} — every opt-out row
 * (`systemFields: false`, `managedBy: 'better-auth'`, `systemFields.audit:
 * false`, `tenancy.enabled: false`, the per-tier `ownership` table) is answered
 * there and re-derived nowhere. `id` is deliberately absent although the plan
 * reports it: the primary key is provisioned by the DRIVER
 * (`table.string('id').primary()`), not by the injection pass, so no object
 * document declares it and neither exit serves it.
 *
 * Tolerant of bare / un-parsed metadata records, the same contract the plan
 * itself carries.
 */
export function injectedSystemColumnDefs(def: unknown): Record<string, Readonly<Record<string, unknown>>> {
  const plan = resolveInjectedSystemColumns(def);
  const defs: Record<string, Readonly<Record<string, unknown>>> = {};
  if (plan.tenant) defs[SystemFieldName.ORGANIZATION_ID] = TENANT_SCOPE_FIELD_DEF;
  if (plan.audit) for (const name of AUDIT_PROVENANCE_FIELDS) defs[name] = AUDIT_FIELD_DEFS[name];
  if (plan.owner) defs[SystemFieldName.OWNER_ID] = OWNER_FIELD_DEF;
  if (plan.owningBusinessUnit) defs[SystemFieldName.OWNING_BUSINESS_UNIT_ID] = OWNING_BUSINESS_UNIT_FIELD_DEF;
  return defs;
}

/**
 * Is this field definition byte-for-byte the platform's own — i.e. a column the
 * INJECTION put there, not something the author wrote?
 *
 * Shallow by construction: every value in the tables above is a primitive, so a
 * key-count check plus strict per-key equality is exact. A nested or extra key
 * therefore fails the comparison, and failure means "the author's field" — the
 * conservative direction, since {@link stripInjectedSystemColumns} only ever
 * removes what matches. A declared `owner_id` carrying the author's own label
 * survives; one that happens to be identical to the platform definition is
 * removed and re-injected identically, which is a no-op by inspection.
 */
function isInjectedDefinition(value: unknown, def: Readonly<Record<string, unknown>>): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (keys.length !== Object.keys(def).length) return false;
  for (const key of keys) if (rec[key] !== def[key]) return false;
  return true;
}

/** The `fields` record of a metadata document, or `undefined` when it has none. */
function fieldsOf(doc: unknown): Record<string, unknown> | undefined {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return undefined;
  const fields = (doc as Record<string, unknown>).fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  return fields as Record<string, unknown>;
}

/**
 * Add every injected system column the object carries but does not declare, so a
 * served object document reports the EFFECTIVE runtime schema (#6562).
 *
 * The merge direction is `applySystemFields`': injected definitions **lose** to
 * a declared field of the same name, because a declared `owner_id` is the
 * author's field and the registry lets it win. (The audit family's *governance*
 * — the keys that decide who may write it — is the other half, and stays with
 * {@link applyAuditFieldGovernance}: this function only adds absent columns, it
 * never rewrites a declared one.)
 *
 * A document with no `fields` record is returned untouched, deliberately: the
 * write-side {@link stripInjectedSystemColumns} could not tell an emptied
 * `fields: {}` from one that was never there, and the #4326 byte-identical
 * round-trip invariant is what that symmetry protects.
 *
 * Returns the **same reference** when nothing needed adding, so the
 * registry-sourced path (already injected at registration) pays a comparison and
 * no copy. Pure and total — any record may be handed to it.
 */
export function applyInjectedSystemColumns<T>(doc: T): T {
  const declared = fieldsOf(doc);
  if (declared === undefined) return doc;

  let additions: Record<string, unknown> | undefined;
  for (const [name, def] of Object.entries(injectedSystemColumnDefs(doc))) {
    if (declared[name] !== undefined) continue;
    additions ??= {};
    additions[name] = { ...def };
  }
  if (additions === undefined) return doc;

  return {
    ...(doc as unknown as Record<string, unknown>),
    fields: { ...additions, ...declared },
  } as unknown as T;
}

/**
 * The write-side counterpart of {@link applyInjectedSystemColumns}: remove the
 * injected-but-undeclared columns a served document picked up on its way out, so
 * the standard Studio GET → edit → PUT round-trip still persists a
 * **byte-identical** body (#4326).
 *
 * Same discipline, and the same reason, as `stripReadDecorations`
 * (`@objectstack/spec/kernel`): the write path persists the request body verbatim
 * by design (ADR-0005 §Validation), so anything the READ adds must be removed
 * again on the way in or it is baked into `sys_metadata.metadata`, into its
 * checksum, and into every history diff. It is not the same *list*, though, and
 * must not be folded into that one — a read decoration is derived diagnostics
 * that no schema accepts, whereas these are real, spec-valid field declarations
 * an author may legitimately write. Hence the exactness of
 * {@link isInjectedDefinition}: only a field identical to the platform's own is
 * removed.
 *
 * Returns the **same reference** when nothing needed removing. Pure and total.
 */
export function stripInjectedSystemColumns<T>(doc: T): T {
  const declared = fieldsOf(doc);
  if (declared === undefined) return doc;

  let kept: Record<string, unknown> | undefined;
  for (const [name, def] of Object.entries(injectedSystemColumnDefs(doc))) {
    if (!isInjectedDefinition(declared[name], def)) continue;
    kept ??= { ...declared };
    delete kept[name];
  }
  if (kept === undefined) return doc;

  return { ...(doc as unknown as Record<string, unknown>), fields: kept } as unknown as T;
}
