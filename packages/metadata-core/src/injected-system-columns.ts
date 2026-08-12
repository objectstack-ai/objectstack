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
 *     #4326 round-trip strip above ({@link stripInjectedSystemColumns}), the
 *     #7859 Layer-0 guard (`equalsShippedDef`, key-count strict), and the
 *     stored-vs-shipped no-op check in {@link isInjectedDefinition}'s doc. A
 *     new key on the external-object anchors flips every one of them from
 *     "the platform's anchor" to "the author's field" — for the Layer-0 guard
 *     that re-emits the phantom tenant predicate, resurrecting the measured
 *     zero-rows defect this family of fixes closed.
 *  3. The #7865 fence: the marker must not change what any consumer accepts.
 *     This derivation changes no document byte anywhere — registered, served,
 *     stored — which is what makes the three no-regression proofs exact.
 *
 * ## Convergence map (opportunistic, per the ruling — NOT rewritten in #7865's PR)
 *
 *  - #7833 (engine): `isFederated` ⇒ `!platformProvisionsStorage(schema)`.
 *  - #7859 (plugin-security): `hasPhantomTenantAnchor(schema)` ⇒
 *    `resolveInjectedColumnProvenance(schema, 'organization_id') === 'injected-unprovisioned'`.
 *  - #7858 (plugin-sharing): the `owner_id` twin of #7859.
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
  // same reasoning {@link stripInjectedSystemColumns} records. Anything else —
  // including a present-but-unrecognisable value — is the author's field (the
  // fail direction above).
  const isPlatformAnchor =
    !declared.present || (declared.def !== undefined && isInjectedDefinition(declared.def, injectedDef));
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
