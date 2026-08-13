// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Injected-system-column DEFINITIONS, and the [#7865] PROVENANCE derivation
 * over them — the one authoritative answer to *"is this column actually
 * provisioned by the platform?"*, readable by author-time tools.
 *
 * ## Why this lives in the spec (#8116)
 *
 * The provenance derivation landed in `@objectstack/metadata-core` (#7865 /
 * PR #8115) — structurally unreachable from `@objectstack/lint`, whose package
 * contract is *"depends on `@objectstack/spec`; never on a runtime"*. So an
 * author writing `record.owner_id` in an expression, view filter or highlight
 * on an ADR-0015 `external` object got a clean lint pass, and the failure
 * surfaced at query time, silently, on the default dev dialect (constant-false:
 * HTTP 200, zero rows, no error).
 *
 * The maintainer ruling on #8116 (2026-08-12) is option 1: sink the derivation
 * into the contract package rather than grant lint an exception to its
 * no-runtime rule — the exception would outlive its reason and become precedent
 * for the next runtime import. Every input here is a document-declared key
 * (`external`, `fields`, the `resolveInjectedSystemColumns` plan inputs), so
 * the derivation is spec-representable with no runtime dependency, exactly like
 * the WHICH-half derivation it sits beside.
 *
 * This is the WHAT-half move #3786 anticipated, scoped to the provenance
 * predicate and the definition tables it reads. The division of ownership is
 * now: **this module declares WHICH columns exist per object
 * (`injected-system-columns.ts`) and WHAT each one looks like (the tables
 * below); the runtime keeps the INJECTION** — `applySystemFields`
 * (`@objectstack/objectql`) spreads these tables at registration, and the
 * served-document injection/strip pair (#6562) stays in
 * `@objectstack/metadata-core`, which re-exports everything moved here so no
 * downstream import changes (#8116's "nothing downstream breaks" fence).
 *
 * Everything in this module is tolerant of bare / un-parsed metadata records
 * (same contract as `resolveInjectedSystemColumns`), so every consumer can call
 * it, including on input that has not been through Zod.
 */

import { AUDIT_PROVENANCE_FIELDS, type AuditProvenanceField } from './field-group-layout';
import { resolveInjectedSystemColumns } from './injected-system-columns';
import { SystemFieldName } from '../system/constants/system-names';

/**
 * Column definitions for the audit-provenance family, keyed by
 * {@link AUDIT_PROVENANCE_FIELDS} — the canonical declaration of WHICH columns
 * exist (#3786). This table owns WHAT each column looks like.
 *
 * The `satisfies` clause is the sync mechanism: a name added to the tuple
 * without a definition here — or a definition for a name the tuple dropped —
 * is a compile error, not a silently diverging copy.
 *
 * Moved from `@objectstack/objectql`'s registry to `@objectstack/metadata-core`
 * by #6562 (so the `/meta` read path could reach it) and from there to the spec
 * by #8116 (so author-time tools can reach the provenance derivation below);
 * see the module header for the ruling. The subset of these keys that is forced
 * over a *declared* audit field lives with `applyAuditFieldGovernance`
 * (`@objectstack/metadata-core`), unchanged.
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
 * index is declared in the object's `indexes[]` instead.)
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
 * document declares it and neither `/meta` exit serves it.
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
 * conservative direction, since `stripInjectedSystemColumns`
 * (`@objectstack/metadata-core`) only ever removes what matches. A declared
 * `owner_id` carrying the author's own label survives; one that happens to be
 * identical to the platform definition is removed and re-injected identically,
 * which is a no-op by inspection.
 *
 * Exported (it was private to `metadata-core` before #8116) because two
 * consumers on two sides of the package boundary need the SAME identity
 * verdict: the #4326 round-trip strip in `@objectstack/metadata-core`, and
 * {@link resolveInjectedColumnProvenance} below. It is also the convergence
 * target for the hand-rolled `equalsShippedDef` copies the #7865 ruling lists
 * (plugin-security / plugin-sharing), when next touched.
 */
export function isInjectedColumnDefinition(
  value: unknown,
  def: Readonly<Record<string, unknown>>,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (keys.length !== Object.keys(def).length) return false;
  for (const key of keys) if (rec[key] !== def[key]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// [#7865] Injected-column PROVENANCE — the one authoritative answer to
// "is this column actually provisioned by the platform?"
// ---------------------------------------------------------------------------

/**
 * [#7865] Does the platform provision storage for this object's schema?
 *
 * `false` exactly when the object carries an ADR-0015 `external` binding: the
 * remote database owns the schema, `Engine.syncObjectSchema` returns early and
 * issues no DDL, and `SqlDriver.registerExternalObject` is DDL-free by design.
 * This is the same `external != null` predicate `syncObjectSchema` routes a
 * federated object by — ONE spelling of "this schema is the remote's", exported
 * so consumers stop re-spelling it (`isFederated` in `Engine.buildDriverOptions`
 * / PR #7833 and `isFederatedObject` in plugin-security / PR #7859 are the two
 * existing hand-rolled copies; both converge here when next touched, per the
 * 2026-08-12 maintainer ruling on #7865).
 *
 * Tolerant of bare / un-parsed metadata records, like everything in this module.
 */
export function platformProvisionsStorage(def: unknown): boolean {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return true;
  return (def as { external?: unknown }).external == null;
}

/**
 * [#7865] Provenance verdict for one column on one object document — the
 * machine-readable marker the 2026-08-12 maintainer ruling ordered (direction
 * B: keep injecting, mark the injected anchors), in its API spelling.
 *
 *  - `'injected-provisioned'` — the platform's own injected anchor, with real
 *    storage behind it: the object's storage is platform-provisioned, so the
 *    column exists in the table exactly as registered.
 *  - `'injected-unprovisioned'` — **the marker**: the platform's own injected
 *    anchor on an object the platform provisions NO storage for (ADR-0015
 *    `external`). The column exists in the registered schema and nowhere else;
 *    a predicate over it can never resolve — on SQLite it degrades to a string
 *    literal and the query goes constant-false (HTTP 200, zero rows, no error).
 *  - `'author'` — the author declared this field; the platform makes no storage
 *    claim about it. On a local object it is provisioned like any declared
 *    field; on a federated object it maps a remote column the author vouches
 *    for. Consumers must treat it as REAL — a federated object may legitimately
 *    expose a real remote `organization_id`, and its tenant wall must keep
 *    working (#7859's recorded reasoning).
 *  - `'absent'` — not a column the injection provides on this object, and not
 *    declared either. (Note `id` always answers `'absent'`: the primary key is
 *    the DRIVER's, not this pass's — `resolveInjectedSystemColumns` reports it
 *    as addressable, but no injected definition exists for it, and on a
 *    federated object the remote's own primary key backs it via the binding.)
 *
 * ## Why an exported derivation and NOT a `provisioned: false` key in the data
 *
 * The ruling's literal illustration ("`provisioned: false` or an equivalent")
 * cannot land as a key on the injected field definitions without moving
 * surfaces the ruling fenced off, so this API is the equivalent:
 *
 *  1. `FieldSchema` is `strictObject` — an undeclared key on a served document
 *     is rejected BY NAME, and `/meta` serves the post-injection document, so
 *     the key would stamp `_diagnostics: { valid: false }` on every federated
 *     object (the exact #6810 defect, closed once already). Declaring the key
 *     instead would make it AUTHORABLE, handing authors a switch that turns
 *     their own tenant wall off — the shape plugin-security's
 *     `federated-phantom-anchors.ts` records as deliberately rejected.
 *  2. Three consumers read the anchor definitions by EXACT identity — the
 *     #4326 round-trip strip (`stripInjectedSystemColumns`,
 *     `@objectstack/metadata-core`), the #7859 Layer-0 guard
 *     (`equalsShippedDef`, key-count strict), and the stored-vs-shipped no-op
 *     check in {@link isInjectedColumnDefinition}'s doc. A new key on the
 *     external-object anchors flips every one of them from "the platform's
 *     anchor" to "the author's field" — for the Layer-0 guard that re-emits the
 *     phantom tenant predicate, resurrecting the measured zero-rows defect this
 *     family of fixes closed.
 *  3. The #7865 fence: the marker must not change what any consumer accepts.
 *     This derivation changes no document byte anywhere — registered, served,
 *     stored — which is what makes the three no-regression proofs exact.
 *
 * ## Convergence map (opportunistic, per the ruling — NOT rewritten here)
 *
 *  - #7833 (engine): `isFederated` ⇒ `!platformProvisionsStorage(schema)`.
 *  - #7859 (plugin-security): `hasPhantomTenantAnchor(schema)` ⇒
 *    `resolveInjectedColumnProvenance(schema, 'organization_id') === 'injected-unprovisioned'`.
 *  - #7858 (plugin-sharing): the `owner_id` twin of #7859.
 *  - #8116 (lint): the author-time consumer this module moved to the spec for —
 *    expression / semantic-role validation reads the marker and warns.
 *
 * ## Fail direction
 *
 * Any mismatch — an extra key, a stamped default, an unrecognisable shape —
 * answers `'author'`: the consumer keeps enforcing exactly as it does today.
 * Toward isolation, never toward exposure; the same direction the #7859 guard
 * documents.
 *
 * Accepts both registered `fields` shapes (record and array); the array shape's
 * extra `name` key is excluded from the identity comparison, exactly as the
 * #7859 guard excludes it, so both shapes reach the same verdict.
 */
export type InjectedColumnProvenance =
  | 'author'
  | 'injected-provisioned'
  | 'injected-unprovisioned'
  | 'absent';

/** See {@link InjectedColumnProvenance} — the verdict, and the doc, live together. */
export function resolveInjectedColumnProvenance(
  def: unknown,
  column: string,
): InjectedColumnProvenance {
  const injectedDef = injectedSystemColumnDefs(def)[column];
  const declared = readDeclaredFieldDef(def, column);
  if (injectedDef === undefined) {
    return declared.present ? 'author' : 'absent';
  }
  // Absent from the document ⇒ the injection provides it at registration
  // (pre-injection input); identical to the platform's definition ⇒ the
  // injection wrote it (post-injection input), or the author typed a
  // byte-identical copy — indistinguishable and semantically equivalent, the
  // same reasoning `stripInjectedSystemColumns` records. Anything else —
  // including a present-but-unrecognisable value — is the author's field (the
  // fail direction above).
  const isPlatformAnchor =
    !declared.present ||
    (declared.def !== undefined && isInjectedColumnDefinition(declared.def, injectedDef));
  if (!isPlatformAnchor) return 'author';
  return platformProvisionsStorage(def) ? 'injected-provisioned' : 'injected-unprovisioned';
}

/**
 * [#7865] The injected columns this object carries with NO storage behind them
 * — the enumerable form of the marker. Empty for every object whose storage
 * the platform provisions, and for a federated object exactly the injected
 * anchors whose registered definition is the platform's own (an
 * author-declared column of the same name is the author's and is excluded, in
 * both `fields` shapes). Order follows {@link injectedSystemColumnDefs}.
 */
export function unprovisionedInjectedColumns(def: unknown): string[] {
  if (platformProvisionsStorage(def)) return [];
  return Object.keys(injectedSystemColumnDefs(def)).filter(
    (name) => resolveInjectedColumnProvenance(def, name) === 'injected-unprovisioned',
  );
}

/**
 * Read one declared field definition off either `fields` shape — the record
 * shape (`fields: { organization_id: {...} }`) or the array shape
 * (`fields: [{ name: 'organization_id', ... }]`). The array element's `name`
 * key duplicates what the record shape expresses as the map key, so it is
 * removed before the identity comparison — the same exclusion the #7859
 * guard's `equalsShippedDef` applies, for the same reason: both shapes must
 * reach the same verdict about the same column.
 *
 * `present` distinguishes "the document does not mention this column" (the
 * injection provides it) from "the document mentions it in a shape this module
 * cannot read" (the author's — {@link resolveInjectedColumnProvenance}'s fail
 * direction requires the two to answer differently).
 */
function readDeclaredFieldDef(
  doc: unknown,
  name: string,
): { present: boolean; def?: Record<string, unknown> } {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { present: false };
  const fields = (doc as { fields?: unknown }).fields;
  if (Array.isArray(fields)) {
    const found = fields.find(
      (f) => !!f && typeof f === 'object' && (f as { name?: unknown }).name === name,
    );
    if (found === undefined) return { present: false };
    const copy = { ...(found as Record<string, unknown>) };
    delete copy.name;
    return { present: true, def: copy };
  }
  if (!fields || typeof fields !== 'object') return { present: false };
  const value = (fields as Record<string, unknown>)[name];
  if (value === undefined) return { present: false };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { present: true };
  return { present: true, def: value as Record<string, unknown> };
}
