// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ServiceObject, ObjectSchema, ObjectOwnership, provisionPrimary, resolveCrudAffordances, resolveInjectedSystemColumns, LEGACY_API_METHODS, AUDIT_PROVENANCE_FIELDS } from '@objectstack/spec/data';
// [#4513] The audit-family governance table, and [#6562] the injected-column
// DEFINITION tables it governs — see the re-exports below for why both live in a
// package `objectql` and `metadata-protocol` both depend on.
import {
  AUDIT_FIELD_GOVERNANCE,
  AUDIT_FIELD_DEFS,
  TENANT_SCOPE_FIELD_DEF,
  OWNER_FIELD_DEF,
  OWNING_BUSINESS_UNIT_FIELD_DEF,
} from '@objectstack/metadata-core';
import { SystemFieldName } from '@objectstack/spec/system';
import { resolveTenancyPosture, resolveSearchPinyinEnabled } from '@objectstack/types';
import { postureEnforcesWall } from '@objectstack/spec/security';
import { provisionSearchCompanion } from './search-companion.js';
import { ObjectStackManifest, ManifestSchema, InstalledPackage, InstalledPackageSchema, checkFieldCompleteness } from '@objectstack/spec/kernel';
import { AppSchema } from '@objectstack/spec/ui';
import { applyProtection } from '@objectstack/spec/shared';

/**
 * Reserved namespaces that do not get FQN prefix applied.
 * Objects in these namespaces keep their short names (e.g., "user" — short name IS the canonical key).
 */
export const RESERVED_NAMESPACES = new Set(['base', 'system']);

/**
 * Default priorities for the three contributor kinds.
 *
 * [ADR-0029 D9.3] `DEFAULT_OVERLAY_PRIORITY` sits BETWEEN the owner and the
 * extenders so a `getObjectContributors()` read lists the stack in layer
 * order. It is ORDERING ONLY: {@link SchemaRegistry.resolveObject} selects its
 * base layer by KIND, never by "highest priority wins" — extender priority is
 * author-declared (`ext.priority ?? 200` in the `objectExtensions` loop), so a
 * package could otherwise re-rank a tenant's overlay out of the base slot by
 * declaring `priority: 140`. Declared numbers order PEERS; they must not be
 * able to change WHICH LAYER IS THE BASE.
 */
export const DEFAULT_OWNER_PRIORITY = 100;
export const DEFAULT_OVERLAY_PRIORITY = 150;
export const DEFAULT_EXTENDER_PRIORITY = 200;

/**
 * Contributor Record
 * Tracks how a package contributes to an object.
 *
 * Three kinds (ADR-0029 D9):
 *
 * - `own` — the single owning package. Defines the base schema, the table and
 *   the namespace claim. Exactly one per object name, unconditionally
 *   ({@link SchemaRegistry.assertSingleOwnerPerObject}).
 * - `overlay` — [D9.1] a TENANT customization layer over the owner's
 *   definition, hydrated from a `sys_metadata` row. It REPLACES the base layer
 *   at resolution time (D9.2) and owns nothing: it claims no namespace,
 *   decides no package membership, holds no table. That is why the
 *   single-owner assertion needs no "unless it is an overlay" clause — which
 *   matters beyond tidiness, since ADR-0028 D5/D6 rest on that sentence being
 *   unconditional. `ownership: 'overlay'` is LOADER-SET at the hydration seams
 *   and reachable from no authoring surface.
 * - `extend` — additive contributions from other packages, folded on top of
 *   whichever layer is the base.
 */
export interface ObjectContributor {
  packageId: string;
  namespace: string;
  ownership: ObjectOwnership;
  priority: number;
  definition: ServiceObject;
}

/**
 * Compute canonical registry key for an object.
 *
 * Under the current naming convention, object names are canonical identifiers
 * and are used as-is (no namespace__ prefix). The namespace parameter is
 * retained for backward compatibility but no longer affects the returned key.
 *
 * @param namespace - The package namespace (unused, kept for API compatibility)
 * @param shortName - The object's name (already the canonical identifier)
 * @returns The object name unchanged
 *
 * @example
 * computeFQN('crm', 'account')  // => 'account'
 * computeFQN(undefined, 'task') // => 'task'
 */
export function computeFQN(_namespace: string | undefined, shortName: string): string {
  return shortName;
}

/**
 * Parse FQN back to namespace and short name.
 * 
 * @param fqn - Object name (e.g., "account" or legacy "crm__account" for backward compat)
 * @returns { namespace, shortName } - namespace is undefined for unprefixed names
 */
export function parseFQN(fqn: string): { namespace: string | undefined; shortName: string } {
  const idx = fqn.indexOf('__');
  if (idx === -1) {
    return { namespace: undefined, shortName: fqn };
  }
  return {
    namespace: fqn.slice(0, idx),
    shortName: fqn.slice(idx + 2),
  };
}

/**
 * Deep merge two ServiceObject definitions.
 * Fields are merged additively. Other props: later value wins.
 */
function mergeObjectDefinitions(base: ServiceObject, extension: Partial<ServiceObject>): ServiceObject {
  const merged = { ...base };

  // Merge fields additively
  if (extension.fields) {
    merged.fields = { ...base.fields, ...extension.fields };
  }

  // Merge validations additively
  if (extension.validations) {
    merged.validations = [...(base.validations || []), ...extension.validations];
  }

  // Merge indexes additively
  if (extension.indexes) {
    merged.indexes = [...(base.indexes || []), ...extension.indexes];
  }

  // Override scalar props (last writer wins)
  if (extension.label !== undefined) merged.label = extension.label;
  if (extension.pluralLabel !== undefined) merged.pluralLabel = extension.pluralLabel;
  if (extension.description !== undefined) merged.description = extension.description;

  return merged;
}

/**
 * Global Schema Registry
 * Unified storage for all metadata types (Objects, Apps, Flows, Layouts, etc.)
 * 
 * ## Namespace & Ownership Model
 * 
 * Objects use a namespace-based FQN system:
 * - `namespace`: Short identifier from package manifest (e.g., "crm", "todo")
 * - `name`: canonical object name (e.g., "account", "sys_user")
 * - Reserved namespaces (`base`, `system`) don't get prefixed
 * 
 * Ownership modes:
 * - `own`: One package owns the object (creates the table, defines base schema)
 * - `extend`: Multiple packages can extend an object (add fields, merge by priority)
 * 
 * ## Package vs App Distinction
 * - **Package**: The unit of installation, stored under type 'package'.
 *   Each InstalledPackage wraps a ManifestSchema with lifecycle state.
 * - **App**: A UI navigation shell (AppSchema), registered under type 'apps'.
 *   Apps are extracted from packages during registration.
 * - A package may contain 0, 1, or many apps.
 */
export type RegistryLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** All valid {@link RegistryLogLevel} values — used to validate `OS_REGISTRY_LOG`. */
export const REGISTRY_LOG_LEVELS: readonly RegistryLogLevel[] = [
  'debug', 'info', 'warn', 'error', 'silent',
];

/**
 * Construction options for {@link SchemaRegistry}.
 */
export interface SchemaRegistryOptions {
  /**
   * Whether the host kernel runs in multi-tenant mode. The `organization_id`
   * column itself is auto-injected regardless of this flag (lookup →
   * sys_organization, on every registered object that doesn't already declare
   * it, isn't `managedBy` an external subsystem, and hasn't opted out via
   * `systemFields`/`tenancy.enabled:false`). When `true` the injected column
   * is additionally INDEXED — single-tenant stacks skip the index since
   * nothing ever filters by organization.
   *
   * Sourced from the `OS_MULTI_ORG_ENABLED` env var when not explicitly set —
   * matches how the SecurityPlugin and CLI startup banner pick the mode.
   * Default is `false` (single-tenant) so local `dev`/`start` runs seed
   * demo data inline at boot; set `OS_MULTI_ORG_ENABLED=true` for cloud /
   * production multi-org deployments. Pass an explicit boolean to override
   * (useful in tests).
   */
  multiTenant?: boolean;

  /**
   * Whether to provision the hidden `__search` search-normalization companion
   * column on registered objects that have an eligible display/name field
   * (#2486 — pinyin search recall). Sourced from `OS_SEARCH_PINYIN_ENABLED`
   * via `resolveSearchPinyinEnabled()` when not explicitly set (the CLI boot
   * path stamps the locale-derived decision into that env var before the
   * kernel constructs engines). Default off — non-Chinese deployments carry
   * no extra column. Pass an explicit boolean to override (useful in tests).
   */
  searchCompanion?: boolean;

  /**
   * Policy for the install-time namespace gate (ADR-0048 Phase 1) — installing
   * a package whose `manifest.namespace` is already owned by a *different*
   * installed package.
   *
   * - `'error'` (default): throw {@link NamespaceConflictError} at install time,
   *   naming both packages. Makes the namespace land-grab a loud, early failure
   *   instead of a mid-install `CREATE TABLE` blow-up.
   * - `'warn'`: log a warning and let the install proceed. For deliberate
   *   migrations where the conflict is temporarily expected.
   *
   * Sourced from `OS_METADATA_COLLISION` (`warn` to downgrade) when not set
   * explicitly. Same-package reinstall and shareable platform namespaces
   * (`base`/`system`/`sys`) are never treated as conflicts. (The per-item
   * cross-package collision throw was retired in ADR-0048 §3.4 — distinct
   * package ids are always disambiguable by package-scoped resolution.)
   */
  collisionPolicy?: 'error' | 'warn';

  /**
   * Verbosity of the registry's own `[Registry] …` log lines. Sourced from the
   * `OS_REGISTRY_LOG` env var when not set explicitly (default `'info'`).
   *
   * The point of the env seam is discoverability (#3420): expected-but-noisy
   * housekeeping — re-registering an owned object / overwriting a package
   * manifest on a rebuild/HMR/seed-replay — is emitted at `'debug'`, so it stays
   * out of a stock `info` boot log but a developer chasing a registration issue
   * can surface it with `OS_REGISTRY_LOG=debug`. An unrecognized value falls
   * back to `'info'`.
   */
  logLevel?: RegistryLogLevel;
}

/**
 * Augment a registered object with implicit system fields.
 *
 * Returns a *new* schema object when fields are added; returns the input
 * unchanged when nothing applies (the cheap path for system tables).
 *
 * Author-declared fields always win — we splice the system fields at the
 * front of the field map, so any same-named author field overwrites them
 * via the natural `{ ...sys, ...authored }` merge.
 *
 * Currently injects:
 *   - `organization_id` — always provisioned (unless the object opts out via
 *     `systemFields`/`tenancy.enabled:false` or is `better-auth` managed) so
 *     the column never depends on the global multi-tenant flag. Required-false;
 *     org-scoping populates it on insert in multi-tenant mode, and it stays
 *     NULL on single-tenant stacks. Only the column's INDEX is gated on
 *     `multiTenant` (no per-tenant filtering exists single-tenant).
 *   - `created_at` / `created_by` / `updated_at` / `updated_by` — audit
 *     fields. Marked `system: true, readonly: true` so detail views can
 *     surface them in a dedicated "System Information" section while
 *     edit forms / drawers filter them out. The driver populates the
 *     timestamps; the `*_by` lookups are filled by the runtime when an
 *     authenticated session is present (NULL otherwise — e.g. seeded
 *     rows).
 *   - `owner_id` — canonical, *reassignable* record owner (lookup to
 *     `sys_user`). Auto-provisioned by DEFAULT on user-authored business
 *     objects so ownership is correct-by-default for AI/human authors who
 *     would otherwise forget to declare it (or reinvent a custom `owner`
 *     lookup the platform can't see). Once present, the existing machinery
 *     engages automatically: SecurityPlugin auto-stamps it to the acting
 *     user on insert (step 3.5), owner-scoped RLS / "My" views / owner
 *     reports key off it, and the first-admin bootstrap hands seeded rows
 *     (owner_id NULL) to the promoted admin. Unlike `created_by` it is
 *     editable (`readonly: false`) — ownership transfers; provenance does
 *     not. Excluded for `managedBy` / `sys_*` tables and any object that
 *     opts out via `ownership: 'org' | 'none'` (Dataverse-style: a
 *     catalog/junction table that has no per-record owner). Forgetting the
 *     opt-out is harmless (a spare nullable column), whereas forgetting to
 *     ADD ownership — the failure mode we are eliminating — silently breaks
 *     every owner-keyed feature.
 *   - `owning_business_unit_id` — [ADR-0117 D1] record-level ORG-UNIT
 *     ownership (lookup to `sys_business_unit`): the tier between `owner_id`
 *     (a person) and `organization_id` (a tenant). Injected on the same
 *     objects `owner_id` is, PLUS the `ownership: 'business_unit'` tier which
 *     has an owning unit but deliberately no owning person (inventory, asset
 *     ledgers, departmental budgets). Withheld for `org` / `none` exactly like
 *     `owner_id`. Shaped like `organization_id`, not like `owner_id`
 *     (`readonly: true`, `hidden: true`): it is a SERVER-STAMPED scope anchor,
 *     and the stamping middleware (ADR-0117 D2/D4) has not landed — so the
 *     column is provisioned but inert. See {@link applySystemFields}' injection
 *     site for why that shape presumes nothing about the undecided D2 policy.
 */
/**
 * [#6562] The column-definition tables — `AUDIT_FIELD_DEFS` and the three
 * ownership/tenancy anchors below — now live in `@objectstack/metadata-core`,
 * re-exported here so the symbols still resolve from `@objectstack/objectql`.
 *
 * Same criterion, same package and the same cycle as {@link AUDIT_FIELD_GOVERNANCE}
 * one comment down: the `/meta` READ path lives in
 * `@objectstack/metadata-protocol`, which `@objectstack/objectql` depends on, so
 * it could not import WHAT each injected column looks like from the registry
 * that provisions it. Until it could, an overlay-backed read served the stored
 * document verbatim and reported the platform's own columns as *absent* while a
 * registry-backed read of the same object reported them present — one endpoint,
 * two field sets, and nothing telling the caller which it had received. The read
 * exits and this injection now derive one answer from one table.
 */
export { AUDIT_FIELD_DEFS, TENANT_SCOPE_FIELD_DEF, OWNER_FIELD_DEF, OWNING_BUSINESS_UNIT_FIELD_DEF };

/**
 * [#4447] The subset of {@link AUDIT_FIELD_DEFS} that is NOT authorable — the
 * keys that decide who may write an audit column.
 *
 * Only `readonly` / `system` travel: everything else an author writes —
 * `label`, `description`, `hidden`, `group`, and even `type` for an
 * external object mapping a differently-typed remote column — stays theirs.
 * `type` and `reference` are deliberately NOT forced: an external/federated
 * object legitimately maps its audit column to a differently-typed remote
 * column, and #4447 is about writability, not storage shape. Narrower is the
 * point — this overrides an author, so it takes only what the defect requires.
 *
 * [#4513] The table itself now lives in `@objectstack/metadata-core`, because
 * the `/meta` READ surface has to report the same answer this injection
 * enforces and could not reach it here: `@objectstack/objectql` depends on
 * `@objectstack/metadata-protocol`, so the import a read-side pin needs would
 * close a turbo-rejected cycle. Same criterion, same package, and for the same
 * reason as the #5619 dispatch predicates. Re-exported here so the symbol
 * still resolves from `@objectstack/objectql`.
 */
export { AUDIT_FIELD_GOVERNANCE };

/**
 * [ADR-0117 D1] The injected BU-ownership column name, spelled out so it greps
 * from this file, and annotated with the spec's registered protocol name so the
 * two cannot drift: a rename in `SystemFieldName.OWNING_BUSINESS_UNIT_ID` makes
 * this line a compile error rather than a silently orphaned injection.
 */
const OWNING_BUSINESS_UNIT_FIELD: typeof SystemFieldName.OWNING_BUSINESS_UNIT_ID =
  'owning_business_unit_id';

export function applySystemFields(
  schema: ServiceObject,
  opts: { multiTenant: boolean }
): ServiceObject {
  // WHICH columns this object carries is the spec's derivation
  // (`resolveInjectedSystemColumns`, #5378) — one answer shared with every
  // author-time consumer that must resolve a reference to an injected column
  // but cannot load this runtime (`@objectstack/lint`). This function keeps sole
  // ownership of WHAT each column looks like, the same split #3786 established
  // for the audit family. Do NOT re-derive a condition below: a second copy here
  // is exactly the drift the plan exists to prevent.
  const plan = resolveInjectedSystemColumns(schema);

  // 1. Hard opt-out at object level (e.g. seed/migration tables).
  //    Folded into the plan (`systemFields: false` ⇒ every flag false), so the
  //    cheap path stays cheap without a second reading of the key.
  //
  // 2. Skip only `better-auth` managed tables. Their column layout is
  //    driven by better-auth's own migrations (sys_user, sys_session,
  //    sys_organization, …) and injecting extra columns here would
  //    collide with what better-auth expects. Other `managedBy` buckets
  //    (`platform`, `config`, `system`, `append-only`) all need the
  //    tenant + audit columns for multi-tenant isolation and time-travel
  //    history — withholding them silently broke RLS reads on
  //    sys_audit_log / sys_activity (the SecurityPlugin's
  //    field-existence safety net dropped `organization_id =
  //    current_user.organization_id` as "field missing", producing
  //    RLS_DENY_FILTER → 0 rows for every non-admin caller).
  //    Both opt-outs are the plan's rows 1-2; the bail below covers them.
  //
  // Honor explicit opt-out via either `systemFields.tenant === false`
  // OR `tenancy.enabled === false`. The latter is the schema-level
  // declaration that the table is a shared/global catalog (e.g.
  // sys_package — the Marketplace registry). Without this, the
  // registry would still inject `organization_id`, and the
  // SecurityPlugin's RLS layer would filter every cross-org read down
  // to 0 rows even though the schema explicitly disabled multi-tenancy.
  //
  // The `organization_id` COLUMN is provisioned unconditionally (subject only
  // to the explicit opt-outs above) — its existence no longer depends on the
  // global multi-tenant flag. Decoupling "does the column exist" from "is
  // tenancy enabled" is what stops sudo writers (audit / messaging / inbox /
  // outbox …) from failing with "no column named organization_id" on
  // single-tenant stacks: they can always stamp the column, it just stays NULL
  // when no tenant context exists. The multi-tenant flag now governs only
  // whether the column is INDEXED — on a single-tenant DB nothing ever filters
  // by organization, so the index would be dead weight. That is also why the
  // plan takes no `multiTenant` input: the flag cannot change what EXISTS, only
  // what is indexed, so an author-time consumer needs no runtime context.
  const wantTenant = plan.tenant;
  const wantAudit = plan.audit;

  // Ownership is auto-provisioned by DEFAULT on user-authored business
  // objects (correct-by-default for AI authors). It is withheld only where a
  // per-record owner is meaningless: any platform-managed table (`managedBy`
  // is set — config/append-only/system/platform; `better-auth` already
  // returned above), the `sys_*` namespace, or an explicit opt-out via
  // `ownership: 'org' | 'none'` on the schema (Dataverse-style — catalog /
  // junction tables). Note this is the SAFE default direction: forgetting the
  // opt-out leaves a harmless spare column, whereas the old opt-IN model let
  // authors silently ship objects with no working ownership at all.
  // `ownership` is a declared ObjectSchema field (record-ownership model), read
  // off the typed schema by the plan — no `as any` (#3175).
  //
  // [ADR-0117 D1 / #5677] The plan treats the value as a `string`, not the
  // enum, on purpose. The spec enum is `'user' | 'org' | 'none'` TODAY; D1's
  // fourth tier `'business_unit'` lands in #5678 — the engine must recognise the
  // tier BEFORE the schema can emit it, or the tier's first appearance would be
  // judged by a no-overlap literal test and get the INVERSE of what D1 declares.
  //
  // [ADR-0117 D1 / #5677] The ownership decision is a POSITIVE LIST, deliberately
  // — it used to read `ownership !== 'org' && ownership !== 'none'`, i.e. a
  // DENY-list, so ANY value outside the two exclusions fell through to "inject
  // `owner_id`". That default is safe only while the enum has exactly three
  // members: D1's `business_unit` tier means "owned by a UNIT, not a person"
  // (`owner_id` ❌, `owning_business_unit_id` ✅), and under the deny-list it
  // would have been stamped with `owner_id` — the exact inverse.
  //
  // The `sys_*` / `managedBy` ineligibility and the per-tier table
  //
  //   ownership        owner_id   owning_business_unit_id
  //   undefined/user      ✅              ✅
  //   business_unit       ❌              ✅
  //   org                 ❌              ❌
  //   none                ❌              ❌
  //
  // all live in `resolveInjectedSystemColumns` now, so the author-time linter
  // reaches the same verdict instead of guessing (#5378).
  const wantOwner = plan.owner;
  const wantOwningBusinessUnit = plan.owningBusinessUnit;

  // Nothing to inject and nothing to govern — the cheap path for the two
  // opt-out rows (`systemFields: false`, `managedBy: 'better-auth'`) and for
  // objects whose every column is already declared.
  if (!wantTenant && !wantAudit && !wantOwner && !wantOwningBusinessUnit) return schema;

  const additions: Record<string, any> = {};
  // Platform-owned field settings that must WIN over a declared field, rather
  // than lose to it like `additions` does (#4447).
  const overrides: Record<string, any> = {};
  // Platform-owned index declarations, appended to the object's `indexes[]` —
  // the ONE surface an index is declared on in this system (#6810, below).
  const indexAdditions: Array<{ fields: string[] }> = [];

  if (wantTenant && !schema.fields?.organization_id) {
    // [#6562] The authorable shape is the shared table's, spread verbatim.
    //
    // [#6810] Nothing is spread ON TOP of it any more. This line used to read
    // `{ ...TENANT_SCOPE_FIELD_DEF, indexed: opts.multiTenant }`, and `indexed`
    // is the one key that was never a `FieldSchema` key at all — removed in the
    // 16.x line (#2377, ADR-0049) because a field-level index flag built no
    // index, and `FieldSchema` is a `strictObject`, so a document carrying it is
    // rejected BY NAME ("never a FieldSchema key; a field-level index flag built
    // no index"). #6562's reasoning for leaving it here — that its only consumer
    // reads the REGISTERED schema, never a served document — held for the
    // consumer and not for the document: `registerObject` runs this function
    // BEFORE storing and `getItem('object', …)` serves that post-injection
    // document, so the key reached `/meta`, where `decorateMetadataItem`
    // re-parsed the served body and stamped `_diagnostics: { valid: false,
    // errors: [{ path: 'fields.organization_id', code: 'unrecognized_keys' }] }`
    // on EVERY registry-backed object — both tenancy modes, both read exits. A
    // defect report the platform wrote about its own column, on a document the
    // author never wrote and could not fix, in the channel Studio renders
    // invalid-metadata banners from.
    additions.organization_id = { ...TENANT_SCOPE_FIELD_DEF };

    // [#6810] So the tenant index is declared where every other index in this
    // system is declared: the object's `indexes[]`.
    //
    // This is also the first time the intent is actually ENFORCED. The sole
    // reader of the old flag was one line in `driver-mongodb`
    // (`mongodb-schema.ts`), while `driver-sql` — which every walled deployment
    // runs — only ever materialized `indexes[]`, so the wall's hottest predicate
    // ran unindexed no matter what the flag said.
    //
    // No `name`: each driver derives its own (SQL's `buildIndexName` is
    // table-qualified, which a hardcoded name could not be without colliding
    // across tables on Postgres; Mongo's index names are per-collection).
    // `unique` is left at its default `false` — a plain lookup index, never a
    // constraint.
    //
    // `multiTenant: false` declares NO index rather than a false one: on an
    // unwalled stack nothing filters by organization, so the index is dead
    // weight — the same intent the old flag's value carried, expressed as
    // presence instead of a boolean.
    if (opts.multiTenant && !declaresTenantIndex(schema)) {
      indexAdditions.push({ fields: ['organization_id'] });
    }
  }

  if (wantAudit) {
    for (const name of AUDIT_PROVENANCE_FIELDS) {
      const declared = (schema.fields as Record<string, any> | undefined)?.[name];
      if (!declared) {
        additions[name] = AUDIT_FIELD_DEFS[name];
        continue;
      }
      // [#4447] The audit family's GOVERNANCE is platform-owned, so a declared
      // `created_at` cannot make the audit anchor client-writable.
      //
      // The injection above is skipped when the object already carries the
      // field, and the merge below lets `schema.fields` win — correct for an
      // authored business field, wrong for this family. It is how `created_at`
      // became writable on an ordinary PATCH: the showcase artifact ships a
      // materialized `created_at` carrying only FieldSchema DEFAULTS
      // (`readonly: false`), which shadowed `AUDIT_FIELD_DEFS.created_at`
      // (`readonly: true`), so the engine's `stripReadonlyFields` had nothing
      // to key off and the forged value was written straight through — with no
      // `droppedFields` either, because from the platform's point of view
      // nothing was dropped.
      //
      // Its two siblings only LOOKED protected: the audit hook force-advances
      // `updated_at`/`updated_by` on every update, so a forged value is
      // overwritten rather than refused. `created_at` is insert-only, so
      // nothing overwrote it — one field out of the trio genuinely unguarded.
      //
      // Presentation stays the author's (label, description, hidden, group,
      // ordering …); only the keys that decide WHO MAY WRITE IT are forced.
      // That leaves the deliberate back-dating path intact: `preserveAudit`
      // (#3479/#3493) and `isSystem` writes still reinstate the original
      // timeline, because they are checked downstream of `readonly`, not by it.
      overrides[name] = { ...declared, ...AUDIT_FIELD_GOVERNANCE[name] };
    }
  }

  // Canonical reassignable owner. `system: true` marks it platform-provided
  // (so tooling/migrations recognise it), but — unlike the audit `*_by`
  // lookups — it is NOT `readonly`: ownership is transferable, so it stays
  // editable in forms and assignable via the API. SecurityPlugin auto-stamps
  // it to the acting user on insert when left NULL.
  if (wantOwner && !schema.fields?.owner_id) {
    additions.owner_id = { ...OWNER_FIELD_DEF };
  }

  // [ADR-0117 D1] Record-level business-unit ownership. Shaped after
  // `organization_id` (server-stamped scope anchor), NOT after `owner_id`
  // (a user-assignable business field) — the two differ in exactly the keys
  // that decide who may write and whether it renders:
  //
  //   • `readonly: true` — D3 requires the value to be derived and validated
  //     server-side (`record.organization_id` must equal the unit's org), so a
  //     client-supplied value is overwritten, never trusted. Reassignment is a
  //     TRANSFER-class operation gated on `allowTransfer` (D4), which has not
  //     landed; until it does, no client write path may set this column.
  //   • `hidden: true` — nothing stamps the column yet (D2's policy is
  //     undecided, D8's backfill unwritten), so it is provisioned-but-inert.
  //     Surfacing a permanently-NULL lookup on every business object's layout
  //     would advertise a capability the runtime does not deliver (Prime
  //     Directive #10). Presentation is a one-key flip for the PR that lands
  //     stamping — a capability grant is not.
  //   • `required: false` — nullable, like every other injected column.
  //
  // ⚠️ None of the three presumes ADR-0117 D2 (`pinned`/`follow_owner`/
  // `transferable`), which is NOT YET RULED. They are the fail-closed shape:
  // they grant no capability, so every D2 outcome remains reachable. D2's
  // `owningBusinessUnit.required` is an INSERT-time rejection rule, not column
  // nullability — it cannot be read off this definition either. `system: true`
  // writes (the future stamping middleware, seeds) are checked downstream of
  // `readonly`, so the flag blocks clients without blocking the platform —
  // exactly how `organization_id` is stamped today.
  //
  // No index: the hierarchical predicate that would use one (`… IN (units)`,
  // D6) ships with the enterprise scope resolver. An index on a column nothing
  // writes and nothing filters is dead weight — the same reasoning that gates
  // `organization_id`'s index on `multiTenant`.
  if (wantOwningBusinessUnit && !schema.fields?.[OWNING_BUSINESS_UNIT_FIELD]) {
    additions[OWNING_BUSINESS_UNIT_FIELD] = { ...OWNING_BUSINESS_UNIT_FIELD_DEF };
  }

  if (
    Object.keys(additions).length === 0 &&
    Object.keys(overrides).length === 0 &&
    indexAdditions.length === 0
  ) {
    return schema;
  }

  return {
    ...schema,
    // `additions` LOSE to an author's field (a declared `owner_id` is theirs);
    // `overrides` WIN over it (the audit family's governance is not authorable).
    fields: { ...additions, ...(schema.fields ?? {}), ...overrides },
    // [#6810] Author-declared indexes keep their position; the platform's
    // tenant index is APPENDED, never merged into or reordering theirs.
    ...(indexAdditions.length > 0
      ? { indexes: [...((schema as any).indexes ?? []), ...indexAdditions] }
      : {}),
  };
}

/**
 * [#6810] Is the tenant index already declared on this object?
 *
 * The append is the one part of this injection that is not naturally
 * idempotent — the field injection re-runs harmlessly because
 * `!schema.fields?.organization_id` stops it, an array push does not — so an
 * author who hand-wrote `indexes: [{ fields: ['organization_id'] }]` must not
 * end up with the platform's duplicate beside it.
 *
 * Matched on the single-column shape this function emits, deliberately: an
 * author's composite (`['organization_id', 'code']`) is a leading-column match
 * on some dialects and not on others, so it is not treated as a substitute.
 */
function declaresTenantIndex(schema: ServiceObject): boolean {
  const declared = (schema as any).indexes;
  if (!Array.isArray(declared)) return false;
  return declared.some(
    (idx: any) =>
      Array.isArray(idx?.fields) &&
      idx.fields.length === 1 &&
      idx.fields[0] === 'organization_id',
  );
}

/**
 * Generic-write `apiMethods` verbs mapped to the {@link resolveCrudAffordances}
 * flag each one needs. Read verbs (`get`/`list`/`search`/`history`/…) are
 * always permitted, so they are absent here and never stripped.
 *
 * ⚠️ Two orthogonal axes — do NOT merge this with the API-tightening table.
 * This table (verb → *affordance*) is the UI-intent axis: it strips write verbs
 * a managed bucket does not *offer* from the whitelist. The verb → *primitive*
 * derivation that decides what the automatic API *admits* lives in
 * `@objectstack/spec/data` `API_METHOD_DERIVATION` / `resolveEffectiveApiMethods`
 * (#3391). The identical-shaped `WRITE_OP_AFFORDANCE` in plugin-security
 * `system-write-guard.ts` is the runtime enforcement of this same UI-intent
 * axis. The enum shrink (#3543) DELIBERATELY kept the three tables separate —
 * merging would blur a UX-affordance concern into a security concern (ADR-0103).
 * The `upsert`/`purge` keys survive the shrink: raw (un-parsed) whitelists may
 * still carry legacy verbs, and stripping here must keep covering them.
 */
const MANAGED_WRITE_VERB_AFFORDANCE: Record<string, 'create' | 'edit' | 'delete'> = {
  create: 'create',
  update: 'edit',
  upsert: 'edit',
  delete: 'delete',
  purge: 'delete',
};

/**
 * Reconcile a managed object's `enable.apiMethods` against the generic-write
 * affordances it actually grants (ADR-0092 / ADR-0103).
 *
 * A `managedBy` object whose resolved affordances forbid a write verb, yet
 * which *also* advertises that verb in `enable.apiMethods`, is internally
 * contradictory: the HTTP exposure gate (ADR-0049) would admit the request and
 * let it 403 at the engine instead of answering a clean 405, and the metadata
 * misrepresents what the API offers.
 *
 * This is the registration-time backstop that makes the contradiction
 * impossible to *ship*: any write verb whose CRUD affordance the object does
 * not grant — via the `managedBy` bucket default plus `userActions` overrides,
 * exactly as {@link resolveCrudAffordances} computes for the UI — is stripped,
 * with a warning. Reads are never touched.
 *
 * Runs for every managed bucket (ADR-0103). Objects that legitimately take
 * user-context writes declare `userActions` opening those verbs, so their
 * apiMethods are kept: `sys_user` keeps `update` (`userActions.edit: true`; its
 * writes are field-whitelist-clamped by the identity guard), and the `system`
 * writable set (RBAC link tables, prefs, messaging config) keeps its CRUD
 * verbs. Engine-owned `system` / `append-only` objects and the other identity
 * tables — which grant no write affordance — derive down to reads only. Any
 * future managed object that advertises a write verb it does not permit is the
 * drift this backstop catches.
 *
 * Returns the input unchanged when nothing is stripped; otherwise a new schema
 * with a rewritten `enable.apiMethods` (immutable, like {@link applySystemFields}).
 */
export function reconcileManagedApiMethods(
  schema: ServiceObject,
  opts?: { warn?: (msg: string) => void },
): ServiceObject {
  if ((schema as any).managedBy == null) return schema;

  const methods = (schema as any).enable?.apiMethods;
  if (!Array.isArray(methods) || methods.length === 0) return schema;

  const affordances = resolveCrudAffordances(schema);
  const stripped: string[] = [];
  const kept = methods.filter((m: string) => {
    const need = MANAGED_WRITE_VERB_AFFORDANCE[m];
    if (need && !affordances[need]) {
      stripped.push(m);
      return false;
    }
    return true;
  });

  if (stripped.length === 0) return schema;

  const warn = opts?.warn ?? ((msg: string) => console.warn(msg));
  warn(
    `[Registry] Object "${schema.name}" is managedBy:'${(schema as any).managedBy}' but advertised ` +
      `generic write verb(s) [${stripped.join(', ')}] in enable.apiMethods its resolved affordances ` +
      `do not permit — stripping them (ADR-0092/ADR-0103). Declare userActions to open a verb the ` +
      `object legitimately takes from a user context. Kept: [${kept.join(', ')}].`,
  );

  return {
    ...schema,
    enable: { ...(schema as any).enable, apiMethods: kept },
  };
}

/** Objects already warned about stripped legacy `apiMethods` (once per object). */
const warnedLegacyApiMethods = new Set<string>();

/**
 * Registration-time diagnostic for retired LEGACY `apiMethods` values (#3543,
 * P2 of #3391). Since the enum shrink, the 8 legacy verbs (`upsert`/
 * `aggregate`/`history`/`search`/`restore`/`purge`/`import`/`export`) are no
 * longer authorable: a declared legacy value is IGNORED — the effective API
 * surface derives from the six primitives alone. The Zod parse path already
 * strips-and-warns (`stripLegacyApiMethods` in `@objectstack/spec/data`), but
 * carries no object name; this registration-time diagnostic adds the per-object
 * view for schemas that reach the registry without passing through Zod (raw
 * `ServiceObject` literals, out-of-band metadata). Real metadata does not
 * upgrade in lockstep with the spec, so this is a PERMANENT compatibility
 * diagnostic, not a transition.
 *
 * Emitted once per object (not per request — the hot path stays free). Pure
 * observation: it never mutates the schema (the derivation resolver ignores
 * legacy values on its own).
 */
export function warnStrippedLegacyApiMethods(
  schema: ServiceObject,
  opts?: { warn?: (msg: string) => void },
): void {
  const methods = (schema as any).enable?.apiMethods;
  if (!Array.isArray(methods) || methods.length === 0) return;
  const legacy = methods.filter((m: string) => (LEGACY_API_METHODS as readonly string[]).includes(m));
  if (legacy.length === 0) return;
  const name = String((schema as any).name ?? '');
  if (warnedLegacyApiMethods.has(name)) return;
  warnedLegacyApiMethods.add(name);
  const remaining = methods.filter((m: string) => !(LEGACY_API_METHODS as readonly string[]).includes(m));
  const warn = opts?.warn ?? ((msg: string) => console.warn(msg));
  warn(
    `[Registry] Object "${name}" declares retired legacy apiMethods value(s) ` +
      `[${legacy.join(', ')}] in enable.apiMethods — since the enum shrink ` +
      `(#3543) these are IGNORED: the effective API surface derives from the ` +
      `six primitives (get/list/create/update/delete/bulk) alone ` +
      `(['create','update'] ⇒ upsert/import; ['list'] ⇒ aggregate/search/export; ` +
      `['get'] + trackHistory ⇒ history).` +
      (remaining.length === 0
        ? ` ⚠ Ignoring them leaves NO primitives — this object's API resolves ` +
          `to deny-all (fully closed).`
        : '') +
      ` Remove the value(s); codemod: node scripts/codemod/apimethods-legacy-to-primitives.mjs.`,
  );
}

/** Objects already diagnosed for functional completeness (once per object). */
const warnedFunctionalCompleteness = new Set<string>();

/**
 * [ADR-0078 Phase 4] Registration-time functional-completeness diagnostic.
 *
 * The author-time gate (`@objectstack/lint`'s `validate-functional-completeness`)
 * only protects metadata that passes through `os build` / `validate` / `lint`.
 * The registry is the one choke point EVERY door goes through — declared
 * stacks, plugin-provided objects, `extend` contributions, `saveMetaItem`, raw
 * `registerObject` calls — including the doors that skip Zod and lint entirely.
 * Two shipped instances prove those doors are real, not hypothetical: #3896
 * (Setup authoring inserted `sys_sharing_rule` rows directly, bypassing the
 * schema that "required" `criteria`) and cloud's `rowColor.mapping` (an
 * `as never` cast bypassed tsc, then the strip-era parse dropped the key).
 *
 * Same shared predicate as the author-time gate (`checkFieldCompleteness` in
 * `@objectstack/spec/kernel`), so the rule ids in this warning are the SAME ids
 * the lint reports — an operator or an AI reading the boot log can grep the id
 * straight into the docs and the suppression story. Judgement lives only in the
 * predicate; if a rule seems wrong, fix it there, never here.
 *
 * WARN, never throw — deliberately, and not as a soft default: an inert field
 * must not kill a boot that thousands of healthy objects share (ADR-0078 §1
 * maps error-severity to "the INSTANCE is dead", not "the system is dead").
 * The author-time gate is where errors block; the registry's job is to make
 * sure the silence never survives to runtime unobserved.
 *
 * Emitted once per object name with every finding aggregated into that one
 * line (not per request, not per finding — the hot path stays free and a
 * 3-dead-field object is one greppable line, not three).
 */
export function warnFunctionalCompleteness(
  schema: ServiceObject,
  opts?: { warn?: (msg: string) => void },
): void {
  const fields = (schema as { fields?: Record<string, unknown> }).fields;
  if (!fields || typeof fields !== 'object') return;
  const name = String((schema as { name?: unknown }).name ?? '');
  if (warnedFunctionalCompleteness.has(name)) return;

  const findings: string[] = [];
  for (const [fieldName, def] of Object.entries(fields)) {
    for (const f of checkFieldCompleteness(def)) {
      findings.push(`${fieldName}: [${f.severity}] ${f.rule} — add \`${f.fix}\``);
    }
  }
  if (findings.length === 0) return;
  warnedFunctionalCompleteness.add(name);

  const warn = opts?.warn ?? ((msg: string) => console.warn(msg));
  warn(
    `[Registry] Object "${name}" registered with ${findings.length} functionally-incomplete ` +
      `field(s) — Zod-valid but runtime-DEAD: the consumer silently skips each one, so it reads ` +
      `0/null/never-resolves while every authoring surface reports success (ADR-0078). ` +
      findings.join(' · ') +
      ` — \`os lint\` reports the same rule ids with full context.`,
  );
}

/**
 * Platform namespaces that multiple packages may legitimately share, so the
 * install-time namespace-uniqueness gate (ADR-0048 Phase 1) must never fire on
 * them: the FQN-exempt reserved namespaces (`base`, `system`) plus `sys`
 * (system objects such as `sys_metadata` are contributed by many packages — see
 * {@link SchemaRegistry.registerNamespace}, which is intentionally many-to-one).
 */
function isShareableNamespace(ns: string): boolean {
  return RESERVED_NAMESPACES.has(ns) || ns === 'sys';
}

/**
 * Raised when a package is installed whose `manifest.namespace` is already owned
 * by a **different** installed package in this installation (ADR-0048 Phase 1).
 *
 * The namespace is the mandatory object-name prefix (`${namespace}_${shortName}`)
 * and — once installed — the container that scopes a package's UI/automation
 * metadata. Two packages sharing a namespace would collide at the object/table
 * layer (a duplicate `CREATE TABLE crm_account` already fails loudly at the DB)
 * and would make container-scoped resolution ambiguous. This gate refuses the
 * install up front with an actionable error, instead of letting a half-applied
 * install blow up later at table creation. Shareable platform namespaces
 * (`base`/`system`/`sys`) are exempt.
 */
export class NamespaceConflictError extends Error {
  readonly namespace: string;
  readonly existingPackageId: string;
  readonly incomingPackageId: string;

  constructor(namespace: string, existingPackageId: string, incomingPackageId: string) {
    super(
      `Namespace conflict: namespace "${namespace}" is already owned by ` +
        `package "${existingPackageId}", so package "${incomingPackageId}" ` +
        `cannot be installed alongside it. A namespace is the mandatory prefix ` +
        `of every object name (e.g. "${namespace}_account") and the container ` +
        `that scopes a package's UI metadata, so it must be unique per ` +
        `installation. Choose a different namespace for "${incomingPackageId}", ` +
        `or uninstall "${existingPackageId}" first. If this is a deliberate ` +
        `migration, set OS_METADATA_COLLISION=warn to downgrade to a warning. ` +
        `See ADR-0048.`,
    );
    this.name = 'NamespaceConflictError';
    this.namespace = namespace;
    this.existingPackageId = existingPackageId;
    this.incomingPackageId = incomingPackageId;
  }
}

/**
 * Is this registered item a TENANT-authored overlay rather than a code-shipped
 * artifact? (ADR-0010 `_provenance`: `'package'` for loader-introduced items,
 * `'org'` for tenant-authored.)
 *
 * `_packageId !== 'sys_metadata'` alone cannot answer it. That sentinel marks
 * one thing only — an overlay row bound to no package. A row that IS bound to
 * one is keyed by its real package id on BOTH sides that register it: the save
 * path (#4636 PR1) and the boot-time rehydration of `sys_metadata` (#4636 PR2).
 * Either way the key is `app.<slug>`, which is exactly what every code-shipped
 * item carries too, so the sentinel test cannot tell them apart. A tenant's own
 * overlay came back from a kernel rebuild looking like a code
 * artifact, and the protocol's overlay gate refused the next write to it with
 * `not_overridable` — an app the user had just built through Studio/AI became
 * permanently un-editable at the first kernel rebuild (cloud#970). Provenance is
 * the axis that actually distinguishes the two, so ask it.
 */
function isTenantAuthored(item: unknown): boolean {
  return (item as { _provenance?: unknown } | null | undefined)?._provenance === 'org';
}

/**
 * [ADR-0029 D9.6] Is this registered body a CODE-shipped artifact?
 *
 * The exact test {@link SchemaRegistry.getArtifactItem} has always applied,
 * factored out so the object branch and the D9.8 hydration discriminator
 * ({@link SchemaRegistry.getPackagedObjectOwner}) cannot drift into two
 * different answers to one question — "does a code package ship this name?".
 * Truthy `_packageId`, not the `'sys_metadata'` rehydration sentinel, and not
 * tenant provenance.
 */
function isCodeArtifactBody(item: unknown): boolean {
  const it = item as { _packageId?: unknown } | null | undefined;
  if (!it || !it._packageId || it._packageId === 'sys_metadata') return false;
  return !isTenantAuthored(it);
}

export class SchemaRegistry {
  // ==========================================
  // Logging control
  // ==========================================

  /** Controls verbosity of registry console messages. Default: 'info'. */
  private _logLevel: RegistryLogLevel = 'info';

  /** Whether to auto-inject multi-tenant system fields. */
  private readonly multiTenant: boolean;

  /** Whether to provision the `__search` companion column (#2486). */
  private readonly searchCompanion: boolean;

  /** Cross-package base-layer collision policy (ADR-0048). */
  private readonly collisionPolicy: 'error' | 'warn';

  constructor(options: SchemaRegistryOptions = {}) {
    if (options.multiTenant !== undefined) {
      this.multiTenant = options.multiTenant;
    } else {
      // Mirror the SecurityPlugin / CLI wiring: key off the deployment's
      // resolved tenancy POSTURE (env-driven, single-org by default).
      //
      // [ADR-0105 D1 / #5262] ⛔ Never `resolveMultiOrgEnabled()`. That boolean
      // was DEMOTED to a back-compat input of `resolveTenancyPosture()`, so it
      // reads `false` on a deployment configured the documented way
      // (`OS_TENANCY_POSTURE=isolated|group`, legacy boolean unset) — and this
      // registry then disagreed with SecurityPlugin about the same deployment:
      // the security layer compiled a Layer 0 wall that filters every read by
      // `organization_id`, while the schema layer left that column UNINDEXED
      // because it believed the stack was single-org. Third recurrence of the
      // shape (cloud#1020, #5233).
      //
      // REQUESTED posture, deliberately — not the `tenancy` service's effective
      // answer. This class is constructed below the kernel (no service registry
      // to ask), and the fact it needs is "will anything ever filter by
      // organization_id here", which the request settles: a degraded boot
      // (ADR-0093 D5) that later gains the enterprise runtime must already have
      // the index. The two errors are not symmetric — a spare index on a
      // single-org stack is dead weight, a missing one on a walled stack is a
      // full scan on the hottest predicate in the system — so this fails toward
      // provisioning it.
      this.multiTenant = postureEnforcesWall(resolveTenancyPosture());
    }

    // Pinyin-search companion column (#2486). Env-driven like multiTenant;
    // the CLI boot path resolves the locale-derived default once and stamps
    // it into OS_SEARCH_PINYIN_ENABLED so this read agrees with the plugin
    // gate.
    this.searchCompanion = options.searchCompanion ?? resolveSearchPinyinEnabled();

    // ADR-0048 — default to a loud error on cross-package collision; allow an
    // env opt-out for deliberate migrations.
    this.collisionPolicy =
      options.collisionPolicy ??
      ((process.env.OS_METADATA_COLLISION ?? '').toLowerCase() === 'warn' ? 'warn' : 'error');

    // #3420 — env-driven verbosity so debug-level registry housekeeping
    // (re-register / package overwrite) is discoverable without a code change.
    // Unrecognized OS_REGISTRY_LOG values fall back to the 'info' default.
    const envLevel = (process.env.OS_REGISTRY_LOG ?? '').toLowerCase();
    this._logLevel =
      options.logLevel ??
      (REGISTRY_LOG_LEVELS.includes(envLevel as RegistryLogLevel)
        ? (envLevel as RegistryLogLevel)
        : this._logLevel);
  }

  get logLevel(): RegistryLogLevel { return this._logLevel; }
  set logLevel(level: RegistryLogLevel) { this._logLevel = level; }

  private log(msg: string): void {
    if (this._logLevel === 'silent' || this._logLevel === 'error' || this._logLevel === 'warn') return;
    console.log(msg);
  }

  /**
   * Debug-only diagnostic: emitted solely when `logLevel === 'debug'`, so it
   * stays out of the default (`'info'`) boot log. Use for expected-but-noisy
   * housekeeping — e.g. re-registration on a metadata rebuild / HMR reload,
   * which looks like an error (`console.warn`) but is a normal path (#3420).
   */
  private debug(msg: string): void {
    if (this._logLevel !== 'debug') return;
    console.debug(msg);
  }

  // ==========================================
  // Object-specific storage (Ownership Model)
  // ==========================================

  /** FQN → Contributor[] (all packages that own/extend this object) */
  private objectContributors = new Map<string, ObjectContributor[]>();

  /** FQN → Merged ServiceObject (cached, invalidated on changes) */
  private mergedObjectCache = new Map<string, ServiceObject>();

  /**
   * Monotonic counter bumped on every change to the registered object set.
   *
   * Consumers that derive their OWN cache from the registry (the engine's
   * roll-up summary index) key it on this, so a runtime registration can never
   * leave them stale. Before it existed, the engine's summary index had a single
   * invalidation site — `engine.registerApp` — which the runtime publish path
   * does not go through (it calls `registry.registerObject` directly). Any
   * kernel that had already performed one write therefore held an index built
   * before the object existed, and every child write of a newly-published
   * roll-up silently skipped the recompute until the process restarted.
   */
  private _objectRevision = 0;

  /** See {@link _objectRevision}. Read it, compare it, rebuild when it moves. */
  get objectRevision(): number {
    return this._objectRevision;
  }

  /** Namespace → Set<PackageId> (multiple packages can share a namespace) */
  private namespaceRegistry = new Map<string, Set<string>>();

  // ==========================================
  // Generic metadata storage (non-object types)
  // ==========================================

  /** Type → Name/ID → MetadataItem */
  private metadata = new Map<string, Map<string, any>>();

  /**
   * App name → navigation contributions (ADR-0029 D7).
   *
   * Lets packages inject nav items into apps they do not own (the UI analog
   * of object extenders). Merged into the owning app's `navigation` tree on
   * read in {@link getApp} / {@link getAllApps} by group id + priority.
   */
  private appNavContributions = new Map<string, Array<{ packageId?: string; group?: string; priority: number; items: any[] }>>();

  /**
   * Package ids that must be installed in a DISABLED state. Seeded once at
   * boot (from persisted state) BEFORE any package registration so that every
   * registration path — boot artifact, marketplace rehydrate, local import —
   * honors persisted disable state uniformly without a fragile post-boot
   * re-application hook. See {@link setInitialDisabledPackageIds} and
   * {@link installPackage}.
   */
  private initialDisabledPackageIds = new Set<string>();

  /**
   * Seed the set of package ids that should be installed disabled. Call this
   * before package registration begins; later `installPackage` calls for these
   * ids land in the `disabled` state. Replaces any previously seeded set.
   */
  setInitialDisabledPackageIds(ids: Iterable<string>): void {
    this.initialDisabledPackageIds = new Set(ids);
  }

  // ==========================================
  // Namespace Management
  // ==========================================

  /**
   * Register a namespace for a package.
   * Multiple packages can share the same namespace (e.g. 'sys').
   */
  registerNamespace(namespace: string, packageId: string): void {
    if (!namespace) return;

    let owners = this.namespaceRegistry.get(namespace);
    if (!owners) {
      owners = new Set();
      this.namespaceRegistry.set(namespace, owners);
    }
    owners.add(packageId);
    this.log(`[Registry] Registered namespace: ${namespace} → ${packageId}`);
  }

  /**
   * Unregister a namespace when a package is uninstalled.
   */
  unregisterNamespace(namespace: string, packageId: string): void {
    const owners = this.namespaceRegistry.get(namespace);
    if (owners) {
      owners.delete(packageId);
      if (owners.size === 0) {
        this.namespaceRegistry.delete(namespace);
      }
      this.log(`[Registry] Unregistered namespace: ${namespace} ← ${packageId}`);
    }
  }

  /**
   * Get the packages that use a namespace.
   */
  getNamespaceOwner(namespace: string): string | undefined {
    const owners = this.namespaceRegistry.get(namespace);
    if (!owners || owners.size === 0) return undefined;
    // Return the first registered package for backwards compatibility
    return owners.values().next().value;
  }

  /**
   * Get all packages that share a namespace.
   */
  getNamespaceOwners(namespace: string): string[] {
    const owners = this.namespaceRegistry.get(namespace);
    return owners ? Array.from(owners) : [];
  }

  // ==========================================
  // Object Registration (Ownership Model)
  // ==========================================

  /**
   * Register an object with ownership semantics.
   * 
   * @param schema - The object definition
   * @param packageId - The owning package ID, or — for an `overlay` — the
   *   `sys_metadata` row's own binding (provenance ON the layer, never an
   *   ownership claim; ADR-0029 D9.9)
   * @param namespace - The package namespace (for FQN computation)
   * @param ownership - 'own' (single owner) | 'overlay' (tenant layer that
   *   REPLACES the base at resolution; ADR-0029 D9) | 'extend' (additive merge)
   * @param priority - Merge priority (lower applied first, higher wins on conflict)
   * 
   * @throws Error if trying to 'own' an object that already has a PACKAGED owner
   */
  registerObject(
    schema: ServiceObject,
    packageId: string,
    namespace?: string,
    ownership: ObjectOwnership = 'own',
    priority: number = ownership === 'own'
      ? DEFAULT_OWNER_PRIORITY
      : ownership === 'overlay'
        ? DEFAULT_OVERLAY_PRIORITY
        : DEFAULT_EXTENDER_PRIORITY
  ): string {
    // Apply system-field injection (multi-tenant org_id, future owner/audit)
    // BEFORE FQN computation and contributor storage so every consumer of
    // the registered schema (driver syncSchema, REST projector, hooks)
    // sees the same canonical shape. Author-declared fields win — see
    // applySystemFields().
    schema = applySystemFields(schema, { multiTenant: this.multiTenant });

    // [ADR-0092 / #1591] Reconcile generic-write `apiMethods` against the CRUD
    // affordances a better-auth-managed object actually grants — strip verbs
    // the identity write guard would reject anyway, so the HTTP exposure gate
    // answers a clean 405 and the metadata can't contradict itself. No-op for
    // every non-`better-auth` object.
    schema = reconcileManagedApiMethods(schema);

    // [#3543] One-shot per-object diagnostic for retired LEGACY apiMethods
    // values (the derived 8) — ignored by the derivation resolver; this adds
    // the object-name context the parse-time strip warning lacks. Runs after
    // reconcile so we diagnose what actually ships.
    warnStrippedLegacyApiMethods(schema);

    // [ADR-0078 Phase 4] One-shot per-object functional-completeness
    // diagnostic — the registry is the choke point every metadata door goes
    // through, including the ones that skip Zod and lint (#3896, raw
    // registerObject). Same shared predicate and rule ids as `os lint`;
    // warn-never-throw (an inert FIELD must not kill the boot).
    warnFunctionalCompleteness(schema);

    // [ADR-0079] Object-materialization seam — DESIGNATE-ONLY primary-title
    // provisioning. Runs AFTER `applySystemFields` (so any designated field
    // co-exists with the injected system columns) and ONLY for owned objects
    // (extensions must not redesignate the owner's title). `synthesize: false`
    // means: when a title-eligible field already EXISTS, set `nameField` to it
    // (so `nameField` is reliably populated for normal/user/AI-built objects,
    // which always carry a text label); when NOTHING is title-eligible, the
    // object is left exactly as-is. We deliberately do NOT synthesize a `name`
    // column here — that would materialize a new DB column on title-less
    // system/append-only tables (sys_record_share, sys_member, …) via the
    // driver's `syncSchema`, a schema-migration-bearing change. Those keep
    // resolving their title on read via `resolveDisplayField` / `titleFormat`.
    //
    // [ADR-0029 D9, blast-radius row 2] The gate asks "is this a BASE LAYER",
    // not "is this the owner". An `overlay` REPLACES the base at resolution
    // time (D9.2), so the overlay body IS the resolved object — gating title
    // provisioning on `own` alone would silently change `nameField` on every
    // overlaid object, which is the same designation the packaged twin gets.
    // Extensions still never redesignate: they merge into a base that has
    // already been provisioned.
    if (ownership === 'own' || ownership === 'overlay') {
      schema = provisionPrimary(schema, { synthesize: false });

      // [#2486] Search-normalization companion column (`__search`). Runs
      // AFTER `provisionPrimary` so the just-designated `nameField` is
      // visible, and ONLY when the deployment enables pinyin search — the
      // column is a real additive migration (ADR-0045) that the driver's
      // `syncSchema` materializes, populated by plugin-pinyin-search's
      // before-save hooks and OR-ed into `$search` by the engine's
      // `expandSearchToFilter`. BASE layers only: extensions merge into
      // the base's already-provisioned shape.
      if (this.searchCompanion) {
        schema = provisionSearchCompanion(schema);
      }
    }

    const shortName = schema.name;
    const fqn = computeFQN(namespace, shortName);

    // Ensure namespace is registered
    if (namespace) {
      this.registerNamespace(namespace, packageId);
    }

    // Get or create contributor list
    let contributors = this.objectContributors.get(fqn);
    if (!contributors) {
      contributors = [];
      this.objectContributors.set(fqn, contributors);
    }

    // Validate ownership rules
    if (ownership === 'own') {
      const existingOwner = contributors.find(c => c.ownership === 'own');
      if (existingOwner && isTenantAuthored(existingOwner.definition) && !isTenantAuthored(schema)) {
        // ── LATE INSTALL (ADR-0029 D9 §6.1) ──
        //
        // A code package registers an object a TENANT row already holds. That
        // happens whenever the hydration seams run before the package does —
        // a `sys_metadata` row written on a kernel where nothing shipped the
        // name, then a package that later ships it (install, upgrade, or a
        // boot whose order puts `loadMetaFromDb` first). Before D9 the tenant
        // row had taken the `own` slot by default, so this threw "already
        // owned by" under a foreign id, or SPLICED THE TENANT'S BODY AWAY
        // under the same id.
        //
        // D9's recommended default, and the only outcome that loses nothing:
        // the CODE layer becomes the owner and the tenant contribution is
        // re-classified as its overlay layer — exactly the two layers that
        // would exist had the package registered first. The resolved object
        // does not move (the tenant body is the base either way, D9.2); what
        // changes is that the packaged definition now survives underneath it,
        // so `isArtifactBacked` is honest from this moment on.
        //
        // Deliberately narrow: it fires ONLY when the sitting owner is
        // tenant-authored (`_provenance: 'org'`) and the incoming body is not.
        // Two code packages claiming one name is D3's cross-package refusal
        // and still throws below, whatever the ids.
        const staleOverlay = contributors.findIndex(c => c.ownership === 'overlay');
        if (staleOverlay !== -1) contributors.splice(staleOverlay, 1);
        existingOwner.ownership = 'overlay';
        existingOwner.priority = DEFAULT_OVERLAY_PRIORITY;
        this.log(
          `[Registry] Late install of "${fqn}": package "${packageId}" takes ownership; ` +
          `the tenant contribution (${existingOwner.packageId}) becomes its overlay layer.`
        );
      } else if (existingOwner && existingOwner.packageId !== packageId) {
        throw new Error(
          `Object "${fqn}" is already owned by package "${existingOwner.packageId}". ` +
          `Package "${packageId}" cannot claim ownership. Use 'extend' to add fields.`
        );
      } else if (existingOwner) {
        // Remove existing owner contribution from same package (re-registration).
        // Normal path (metadata rebuild / HMR / multi-project seed replays the
        // same owned object), not an error — keep it at debug so a stock boot
        // stays warning-free (#3420).
        contributors.splice(contributors.indexOf(existingOwner), 1);
        this.debug(`[Registry] Re-registering owned object: ${fqn} from ${packageId}`);
      }
    } else if (ownership === 'overlay') {
      // [ADR-0029 D9.9] AT MOST ONE overlay layer per object name, replaced on
      // re-write — and keyed by KIND, never by package. The row's `package_id`
      // is provenance ON the layer, not a second identity for it: the
      // overlay-uniqueness index in `sys_metadata` keys on
      // `(type, name, organization_id, COALESCE(package_id, ''))` and can
      // legitimately hold two rows for one `(type, name)` bound to two
      // packages, which this registry could never represent because
      // `computeFQN` is identity. Keying the replacement by package would let
      // that unrepresentable shape in through the side door; the mis-bound row
      // is refused at the PRODUCER instead (`saveMetaItem`), and counted in
      // `loadMetaFromDb`'s per-record `errors` at boot.
      const idx = contributors.findIndex(c => c.ownership === 'overlay');
      if (idx !== -1) {
        contributors.splice(idx, 1);
        this.debug(`[Registry] Replacing overlay layer of object: ${fqn} from ${packageId}`);
      }
    } else {
      // extend mode: remove existing extension from same package
      const idx = contributors.findIndex(c => c.packageId === packageId && c.ownership === 'extend');
      if (idx !== -1) {
        contributors.splice(idx, 1);
      }
    }

    // ADR-0010 §3.7 — translate the author-facing `protection` block
    // into the private `_lock` envelope and stamp package provenance
    // on the schema before it lands in the contributor list. Mirrors
    // registerItem() so object schemas surface lock fields on GET.
    applyProtection(schema as any, { packageId });

    // Add new contributor
    const contributor: ObjectContributor = {
      packageId,
      namespace: namespace || '',
      ownership,
      priority,
      definition: { ...schema, name: fqn }, // Store with FQN as name
    };
    contributors.push(contributor);

    // Sort by priority (ascending: lower priority applied first)
    contributors.sort((a, b) => a.priority - b.priority);

    // Invalidate merge cache
    this.mergedObjectCache.delete(fqn);
    // …and tell registry-derived caches (the engine's roll-up summary index)
    // that the object set moved, whichever path got here.
    this._objectRevision += 1;

    this.log(`[Registry] Registered object: ${fqn} (${ownership}, priority=${priority}) from ${packageId}`);
    return fqn;
  }

  /**
   * Resolve an object by FQN, merging all contributions.
   * Returns the merged object or undefined if not found.
   */
  resolveObject(fqn: string): ServiceObject | undefined {
    // Check cache first
    const cached = this.mergedObjectCache.get(fqn);
    if (cached) return cached;

    const contributors = this.objectContributors.get(fqn);
    if (!contributors || contributors.length === 0) {
      return undefined;
    }

    // Find owner (must exist for a valid object)
    const ownerContrib = contributors.find(c => c.ownership === 'own');
    if (!ownerContrib) {
      // [ADR-0029 D9.5] An ORPHAN OVERLAY lands here too, and says so: the
      // tenant can still see the row in `sys_metadata`, so "extenders" would
      // be the wrong noun to hand whoever reads this line.
      console.warn(
        contributors.some(c => c.ownership === 'overlay')
          ? `[Registry] Object "${fqn}" has an overlay layer but no owner. Skipping.`
          : `[Registry] Object "${fqn}" has extenders but no owner. Skipping.`
      );
      return undefined;
    }

    // [ADR-0029 D9.2] The BASE layer is the tenant overlay when one is
    // registered, and the owner otherwise — `overlay ?? own`. Selection asks
    // the KIND (D9.3), never the priority.
    //
    // This is deliberately BIT-FOR-BIT what the pre-D9 splice produced: the
    // overlay used to BE the owner, so the fold already ran over the overlay
    // body. The resolved schema — `_provenance: 'org'` included, which every
    // registry-direct consumer reads — does not move. Only what the registry
    // REMEMBERS changes: the packaged owner is still here, underneath.
    const baseContrib = contributors.find(c => c.ownership === 'overlay') ?? ownerContrib;
    const merged = this.foldExtenders(contributors, baseContrib);

    // Cache the result
    this.mergedObjectCache.set(fqn, merged);
    return merged;
  }

  /**
   * Fold every `extend` contribution over a chosen base layer, in the list's
   * (priority-sorted) order. Extracted from {@link resolveObject} so the
   * code-layer resolution ({@link resolveOwnerLayer}) folds extenders exactly
   * the same way rather than growing a second, drifting copy.
   */
  private foldExtenders(contributors: ObjectContributor[], base: ObjectContributor): ServiceObject {
    let merged = { ...base.definition };
    for (const contrib of contributors) {
      if (contrib.ownership === 'extend') {
        merged = mergeObjectDefinitions(merged, contrib.definition);
      }
    }
    return merged;
  }

  /**
   * [ADR-0029 D9.6] The CODE-LAYER resolution of an object: the OWNER's
   * declaration with its extenders folded on, deliberately ignoring any tenant
   * `overlay` layer.
   *
   * This is what artifact identity has to be read from, and it is NOT implied
   * by D9.2 — D9.2 leaves the merged body identical on purpose, `_provenance:
   * 'org'` included, so asking the MERGED body "does a code package ship
   * this?" answers about whatever last overwrote the base rather than about
   * the code layer. That is precisely how `isArtifactBacked` came to answer
   * `false` for a name a package still ships (#6853 P3), disarming both gates
   * that read it.
   *
   * With no overlay registered this is byte-for-byte `resolveObject`'s answer,
   * which is why the honest predicate costs nothing on the common shape.
   *
   * Uncached on purpose: a second cache would have to stay correct at every
   * one of `mergedObjectCache`'s invalidation points, and the fold is a
   * shallow spread over a contributor list that is almost always length 1.
   */
  private resolveOwnerLayer(fqn: string): ServiceObject | undefined {
    const contributors = this.objectContributors.get(fqn);
    if (!contributors || contributors.length === 0) return undefined;
    const ownerContrib = contributors.find(c => c.ownership === 'own');
    if (!ownerContrib) return undefined;
    return this.foldExtenders(contributors, ownerContrib);
  }

  /**
   * Get object by name (short name canonical, FQN supported for disambiguation).
   *
   * Short names are canonical for user code, AI generation, and most lookups.
   * FQN is accepted as an explicit fallback for cross-package disambiguation
   * when two packages contribute objects with the same short name.
   *
   * Resolution order:
   * 1. Exact name match — the name IS the canonical key.
   *    If multiple packages contribute the same short name, a warning is logged
   *    and the first match wins — disambiguate by passing the FQN explicitly.
   * 2. Legacy FQN match (e.g., 'crm__account') — backward compat.
   */
  getObject(name: string): ServiceObject | undefined {
    const fqn = this.resolveObjectKey(name);
    return fqn === undefined ? undefined : this.resolveObject(fqn);
  }

  /**
   * [#6808] The name→FQN half of {@link getObject}, extracted so the READ and
   * the name-addressed REMOVAL ({@link unregisterObject}) cannot disagree
   * about which contributor entry a bare name addresses.
   *
   * That disagreement is not hypothetical — it is the shape of the bug this
   * was extracted for: `deleteMetaItem`'s registry heal reached one of the two
   * places an `object` lives, and the surface data CRUD dispatches on
   * (`getObject`) kept serving a deleted object. A remover that resolved names
   * its own way would re-open the same seam one layer down: it could remove an
   * entry `getObject` never served, leaving the served one behind.
   *
   * Returns `undefined` when nothing is registered under the name, so
   * `getObject` keeps its exact previous behaviour: `resolveObject` on an
   * unknown FQN also answered `undefined`.
   */
  private resolveObjectKey(name: string): string | undefined {
    // Canonical: short name lookup
    const matches: string[] = [];
    for (const fqn of this.objectContributors.keys()) {
      const { shortName } = parseFQN(fqn);
      if (shortName === name) {
        matches.push(fqn);
      }
    }
    if (matches.length > 0) {
      if (matches.length > 1) {
        console.warn(
          `[SchemaRegistry] Ambiguous short name "${name}" matches: ${matches.join(', ')}. ` +
          `Returning first match. Use FQN to disambiguate.`
        );
      }
      return matches[0];
    }

    // Fallback: explicit FQN
    return this.objectContributors.has(name) ? name : undefined;
  }

  /**
   * Get all registered objects (merged).
   * 
   * @param packageId - Optional filter: only objects contributed by this package
   */
  getAllObjects(packageId?: string): ServiceObject[] {
    const results: ServiceObject[] = [];

    for (const fqn of this.objectContributors.keys()) {
      // If filtering by package, check if this package contributes
      if (packageId) {
        const contributors = this.objectContributors.get(fqn);
        const hasContribution = contributors?.some(c => c.packageId === packageId);
        if (!hasContribution) continue;
      }

      const merged = this.resolveObject(fqn);
      if (merged) {
        // Tag with contributor info for UI
        (merged as any)._packageId = this.getObjectOwner(fqn)?.packageId;
        results.push(merged);
      }
    }

    return results;
  }

  /**
   * Get all contributors for an object.
   */
  getObjectContributors(fqn: string): ObjectContributor[] {
    return this.objectContributors.get(fqn) || [];
  }

  /**
   * Get the owner contributor for an object.
   *
   * Unchanged by ADR-0029 D9: it keeps meaning "the package that owns the
   * table". An overlay is not an owner, so it is never returned here.
   */
  getObjectOwner(fqn: string): ObjectContributor | undefined {
    const contributors = this.objectContributors.get(fqn);
    return contributors?.find(c => c.ownership === 'own');
  }

  /**
   * [ADR-0029 D9.8] The PACKAGED (code-shipped) owner of an object name, if
   * one is registered — the discriminator every overlay-hydration seam asks
   * before deciding which KIND to register:
   *
   * ```
   * packaged `own` contributor already registered for this name?
   *   yes -> register as `overlay`   (a layer over the code definition)
   *   no  -> register as `own`       (a runtime-authored object, keyed by the
   *                                   row's package_id or the sentinel)
   * ```
   *
   * "Packaged" is the artifact test, not merely "an owner exists": a
   * runtime-authored object's owner IS the tenant's own row, and re-writing it
   * must stay an ordinary re-registration rather than becoming a layer over
   * itself. Name-addressed, resolving the key exactly as `getObject` does, so
   * the decision and the registration cannot talk about different entries.
   */
  getPackagedObjectOwner(name: string): ObjectContributor | undefined {
    const fqn = this.resolveObjectKey(name);
    if (fqn === undefined) return undefined;
    const owner = this.objectContributors.get(fqn)?.find(c => c.ownership === 'own');
    return owner && isCodeArtifactBody(owner.definition) ? owner : undefined;
  }

  /**
   * [ADR-0029 D9.7] Remove the tenant OVERLAY layer of an object, leaving the
   * packaged owner exactly where it is — the layer-addressed sibling of
   * #6818's name-addressed {@link unregisterObject}.
   *
   * This is why #6853's "how do we restore the packaged definition?" question
   * dissolves instead of being answered. The packaged owner is already here,
   * at its own priority, in its own namespace, with its own definition, so
   * restoration is NOT a re-registration at all — the heal that used to need
   * `(definition, packageId, namespace, ownership, priority)` at delete time,
   * three of which no longer existed by then, has nothing left to reconstruct.
   *
   * @returns whether an overlay layer was removed (`false` = nothing was
   *   registered under that name, or the entry had no overlay layer; removal
   *   is idempotent).
   */
  removeObjectOverlay(name: string): boolean {
    const fqn = this.resolveObjectKey(name);
    if (fqn === undefined) return false;
    const contributors = this.objectContributors.get(fqn);
    if (!contributors) return false;
    const idx = contributors.findIndex(c => c.ownership === 'overlay');
    if (idx === -1) return false;
    const [removed] = contributors.splice(idx, 1);
    // The same two invalidations every other contributor mutation performs.
    this.mergedObjectCache.delete(fqn);
    this._objectRevision += 1;
    this.log(`[Registry] Removed overlay layer of object: ${fqn} (was bound to ${removed.packageId})`);
    return true;
  }

  /**
   * ADR-0029 K0 — assert every registered object resolves to exactly one
   * owner.
   *
   * A second `own` from a different package is already rejected eagerly in
   * {@link registerObject} (it throws). This is the install-time backstop
   * called once all packages are registered (kernel bootstrap complete),
   * and it additionally catches the case `registerObject` cannot: an object
   * that has only `extend` contributions and **no owner** — which would
   * otherwise resolve to nothing. Surfacing it here turns a silent
   * "extend a non-existent object" into a clear bootstrap error.
   *
   * This is the invariant the kernel-decomposition (ADR-0029) relies on:
   * the `sys` namespace is shared across many first-party plugins, but each
   * object name has exactly one owner.
   *
   * [ADR-0029 D9.5] The count is LITERALLY unchanged by the overlay layer —
   * `ownership === 'own'`, no exemption clause. Overlays are not owners, so
   * D3's sentence keeps holding as written, which is what ADR-0028's D5/D6
   * depend on: an ownership rule qualified with "unless it is an overlay"
   * would have to be re-litigated at every call site. What D9 adds is one new
   * VIOLATION class, the orphan overlay (an `overlay` with no `own`).
   *
   * @throws Error listing every object whose owner count is not exactly 1.
   */
  assertSingleOwnerPerObject(): void {
    const violations: string[] = [];
    for (const [fqn, contributors] of this.objectContributors.entries()) {
      const owners = contributors.filter(c => c.ownership === 'own');
      if (owners.length === 0) {
        // [ADR-0029 D9.5] The ORPHAN OVERLAY class. Reachable by uninstalling
        // the packaged owner while a `sys_metadata` row for its object still
        // exists under a binding `unregisterObjectsByPackage` cannot reach by
        // package id (the sentinel). It must be LOUD rather than silent:
        // `resolveObject` would otherwise warn once and answer `undefined` for
        // a name the tenant can still see in `sys_metadata`.
        const overlays = contributors.filter(c => c.ownership === 'overlay');
        if (overlays.length > 0) {
          const bindings = overlays.map(c => c.packageId).join(', ') || '(none)';
          violations.push(
            `Object "${fqn}" has an orphan overlay layer [${bindings}] and no owner. ` +
            `An overlay layers OVER an owned object — re-install the package that owns it, ` +
            `or delete the sys_metadata row.`
          );
        } else {
          const extenders = contributors.map(c => c.packageId).join(', ') || '(none)';
          violations.push(
            `Object "${fqn}" has no owner — only extend contributions from [${extenders}]. ` +
            `Exactly one package must register it with ownership 'own'.`
          );
        }
      } else if (owners.length > 1) {
        const names = owners.map(c => c.packageId).join(', ');
        violations.push(
          `Object "${fqn}" has ${owners.length} owners [${names}] — exactly one is allowed.`
        );
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `[Registry] single-owner-per-object check failed (ADR-0029):\n  ` +
        violations.join('\n  ')
      );
    }
  }

  /**
   * Unregister all objects contributed by a package.
   * 
   * @throws Error if trying to uninstall an owner that has extenders
   */
  unregisterObjectsByPackage(packageId: string, force: boolean = false): void {
    for (const [fqn, contributors] of this.objectContributors.entries()) {
      // Find this package's contributions
      const packageContribs = contributors.filter(c => c.packageId === packageId);
      
      for (const contrib of packageContribs) {
        if (contrib.ownership === 'own' && !force) {
          // Check if there are extenders from other packages
          const otherExtenders = contributors.filter(
            c => c.packageId !== packageId && c.ownership === 'extend'
          );
          if (otherExtenders.length > 0) {
            throw new Error(
              `Cannot uninstall package "${packageId}": object "${fqn}" is extended by ` +
              `${otherExtenders.map(c => c.packageId).join(', ')}. Uninstall extenders first.`
            );
          }
        }

        // Remove contribution
        const idx = contributors.indexOf(contrib);
        if (idx !== -1) {
          contributors.splice(idx, 1);
          this.log(`[Registry] Removed ${contrib.ownership} contribution to ${fqn} from ${packageId}`);
        }

        // [ADR-0029 D9.7] An overlay layer leaves with the base it layers
        // over. Nothing durable is lost — the layer is a runtime projection of
        // a `sys_metadata` row this does not touch, and a re-install
        // re-hydrates it — whereas leaving it behind would MANUFACTURE the
        // orphan-overlay violation D9.5 names, on every uninstall of a
        // customized packaged object. Keyed off the OWNER's removal, not off
        // the overlay's own binding: a sentinel-bound layer names no package
        // and this walk is addressed by package id.
        if (contrib.ownership === 'own') {
          const overlayIdx = contributors.findIndex(c => c.ownership === 'overlay');
          if (overlayIdx !== -1) {
            const [dropped] = contributors.splice(overlayIdx, 1);
            this.log(
              `[Registry] Removed overlay layer of ${fqn} with its owner ` +
              `(layer was bound to ${dropped.packageId})`
            );
          }
        }
      }

      // Clean up empty contributor lists
      if (contributors.length === 0) {
        this.objectContributors.delete(fqn);
      }

      // Invalidate cache
      this.mergedObjectCache.delete(fqn);
      this._objectRevision += 1;
    }
  }

  /**
   * [#6808] Unregister ONE object, addressed by NAME — the removal verb this
   * registry was missing, and the reason a deleted object stayed servable.
   *
   * ## Why a second removal verb, and not a call to the first one
   *
   * Until this method, {@link unregisterObjectsByPackage} was the ONLY way an
   * object left `objectContributors`, and it is addressed by PACKAGE. That is
   * the right verb for an uninstall and the wrong one for a delete: an
   * `object` created at runtime has no package identity of its own (the write
   * path keys its contributor by the row's `package_id`, or the
   * `'sys_metadata'` sentinel when the row is package-less), so routing a
   * single delete through it would mean synthesising an identity and then
   * tearing down every SIBLING object registered under it — a far wider blast
   * radius than the delete the operator asked for.
   *
   * The gap it left was load-bearing. A runtime-authored `object` is written
   * into TWO places (`metadata['object']` via {@link registerItem} and
   * `objectContributors` via {@link registerObject}), and the metadata-protocol
   * heal that runs after a `sys_metadata` delete only ever reached the first.
   * Measured over the real repository: after `DELETE /meta/object/<name>` the
   * row was gone and `metadata['object']` was empty, while `getObject(name)`
   * — and therefore `getItem('object', name)`, which special-cases straight
   * back to it — kept serving the object for the life of the process. Since
   * `getObject` is what the data plane dispatches on
   * (`assertObjectRegistered`), the deleted object stayed readable, syncable
   * and WRITABLE.
   *
   * ## The ADR-0029 guard, and why it is the SAME judgement, not a second one
   *
   * ADR-0029: exactly one package owns an object; others may only `extend` it.
   * An extender's fields are merged into the owner's definition
   * ({@link resolveObject}), so removing an owned object out from under a live
   * extender leaves contributions that resolve to nothing —
   * {@link assertSingleOwnerPerObject}'s "has extenders but no owner"
   * violation, reached at runtime instead of at bootstrap.
   * `unregisterObjectsByPackage` already encodes the answer (refuse, name the
   * extenders, force overrides), so this mirrors that judgement rather than
   * inventing a second one; only the address changes, from package to name.
   * Both facts it needs — the owner and the extenders — are already in the
   * contributor list, so no new bookkeeping structure exists to drift.
   *
   * "Other" means "not the owner's package", the same relation the sibling
   * verb expresses as "not the package being uninstalled": an extension the
   * OWNER itself contributed goes away with the object it extends, exactly as
   * it would on an uninstall. An object with no owner at all (only extenders —
   * already an ADR-0029 violation) counts every extender as other, so it is
   * refused rather than silently torn down.
   *
   * @param name Short name (canonical) or FQN — resolved exactly as
   *   {@link getObject} resolves it, so this removes precisely the entry that
   *   was being served.
   * @param options.force Skip the extender guard. The escape hatch the
   *   package-scoped verb has, for a caller that has already decided.
   * @returns whether an object was removed (`false` = nothing registered
   *   under that name; removal is idempotent).
   * @throws Error naming the extenders when the object is still extended by
   *   another package and `force` is not set.
   */
  unregisterObject(name: string, options: { force?: boolean } = {}): boolean {
    const fqn = this.resolveObjectKey(name);
    if (fqn === undefined) return false;
    const contributors = this.objectContributors.get(fqn) ?? [];

    const owner = contributors.find(c => c.ownership === 'own');
    if (!options.force) {
      const otherExtenders = contributors.filter(
        c => c.ownership === 'extend' && c.packageId !== owner?.packageId
      );
      if (otherExtenders.length > 0) {
        throw new Error(
          `Cannot unregister object "${fqn}": it is extended by ` +
          `${otherExtenders.map(c => c.packageId).join(', ')}. Unregister the extenders first.`
        );
      }
    }

    // The whole entry goes: the object no longer exists, so no contribution to
    // it does either. Leaving the extenders behind would be the owner-less
    // state the guard above exists to prevent.
    this.objectContributors.delete(fqn);
    // The same two invalidations every other contributor mutation performs —
    // the merged-object cache would otherwise keep answering `resolveObject`
    // for a name with no contributors, and registry-derived caches (the
    // engine's roll-up summary index) would never learn the set moved.
    this.mergedObjectCache.delete(fqn);
    this._objectRevision += 1;
    // Namespaces are deliberately NOT touched: a namespace is registered per
    // PACKAGE and shared by every object that package ships, so dropping one
    // object must not unregister it. `unregisterObjectsByPackage` leaves it
    // alone too — `uninstallPackage` owns that half.
    this.log(
      `[Registry] Unregistered object: ${fqn} ` +
      `(${contributors.length} contribution(s), owner ${owner?.packageId ?? '(none)'})`
    );
    return true;
  }

  // ==========================================
  // Generic Metadata (Non-Object Types)
  // ==========================================

  /**
   * Universal Register Method for non-object metadata.
   */
  registerItem<T>(type: string, item: T, keyField: keyof T = 'name' as keyof T, packageId?: string) {
    if (!this.metadata.has(type)) {
      this.metadata.set(type, new Map());
    }
    const collection = this.metadata.get(type)!;
    const baseName = String(item[keyField]);

    // ADR-0010 §3.7 — translate the author-facing `protection` block
    // into the private `_lock` envelope and stamp package provenance.
    // Centralised with the artifact loader path in metadata/plugin.ts
    // so both load paths produce identical lock state.
    applyProtection(item as any, { packageId });

    // Spec-conformance DIAGNOSTIC — deliberately not a gate (#3903).
    //
    // Registration proceeds on failure because refusing here would unhook the
    // item from every serving surface: an object row backs live tables, and an
    // unregistered item cannot even be listed, opened, or fixed in Studio —
    // enforcement at this seam turns bad metadata into a data outage. The
    // contract is enforced where an author is present to act: the write path
    // (`saveMetaItem` → 422 with structured issues) rejects new off-spec
    // bodies, the read path badges rows via `_diagnostics`, and every stored
    // row is canonicalized by the ADR-0087 conversion chain BEFORE it reaches
    // this method — so what fails here is a genuine, current-contract
    // violation, not chain-owned history.
    try {
      this.validate(type, item);
    } catch (e: any) {
      console.error(
        `[Registry] [metadata_spec_invalid] ${type}/${baseName} fails the current spec schema: ${e.message} — ` +
        `registered anyway (serving availability); fix it at the source or via Studio (reads carry _diagnostics).`,
      );
    }

    // Use composite key (packageId:name) when packageId is provided
    const storageKey = packageId ? `${packageId}:${baseName}` : baseName;

    if (collection.has(storageKey)) {
      this.log(`[Registry] Overwriting ${type}: ${storageKey}`);
    }

    // ADR-0048 — cross-package base-layer collision. When a code package
    // registers a bare-named generic item, refuse it loudly if a DIFFERENT
    // code package already owns the same (type, name). Without this guard the
    // two items live under distinct composite keys but bare-name resolution
    // (`getItem`) returns whichever the Map iterates first, silently shadowing
    // the loser — last-write-wins with no diagnostic.
    //
    // What is deliberately NOT a collision (these must pass through):
    //   - Same package re-registering the same name (idempotent reload):
    //     `conflictOwner` excludes `packageId` itself.
    //   - Runtime/DB overlay rows registered under the bare key with no real
    //     package provenance (or the `sys_metadata` sentinel): that is the
    //     legitimate ADR-0005 overlay path, already surfaced by the
    //     artifact-vs-DB warning below.
    // ADR-0048 §3.4 — the per-item CROSS-package throw is retired. Package ids
    // are globally unique, so package-scoped resolution (see getItem) always
    // disambiguates two different packages: two installed packages shipping the
    // same bare name (e.g. `page/home`) legitimately COEXIST under distinct
    // composite keys and each caller resolves to its own. What the original
    // guard flagged as a collision is now the supported marketplace case.
    //
    // Same-package re-registration still overwrites (idempotent reload), and a
    // runtime/DB overlay over a packaged item is the sanctioned ADR-0005 path,
    // surfaced by the artifact-vs-DB warning below.

    // Artifact-vs-DB collision warning. When a code package ships an item
    // whose name already exists as a DB-only entry (registered earlier
    // without a packageId — typically rehydrated from sys_metadata by
    // loadMetaFromDb / getMetaItems), the runtime overlay layer makes
    // the DB row silently shadow the new artifact value. That is correct
    // ADR-0005 behavior, but the silent shadowing can surprise package
    // authors and operators. Log a single warning so the situation is
    // discoverable in startup logs.
    if (packageId && collection.has(baseName)) {
      const dbOnly = collection.get(baseName) as any;
      if (dbOnly && !dbOnly._packageId) {
        console.warn(
          `[Registry] Collision: ${type}/${baseName} ships from package ` +
          `"${packageId}" but a runtime-authored row with the same name already ` +
          `exists in sys_metadata. The runtime row will shadow the package value ` +
          `(ADR-0005 overlay precedence). Rename one, or delete the sys_metadata ` +
          `row if the package value should win.`,
        );
      }
    }

    collection.set(storageKey, item);
    this.log(`[Registry] Registered ${type}: ${storageKey}`);
  }

  /**
   * Validate Metadata against Spec Zod Schemas
   */
  validate(type: string, item: any): unknown {
    if (type === 'object') {
      return ObjectSchema.parse(item);
    }
    if (type === 'app') {
      return AppSchema.parse(item);
    }
    if (type === 'package') {
      return InstalledPackageSchema.parse(item);
    }
    if (type === 'plugin') {
      return ManifestSchema.parse(item);
    }
    return true;
  }

  /**
   * Universal Unregister Method
   */
  unregisterItem(type: string, name: string) {
    const collection = this.metadata.get(type);
    if (!collection) {
      console.warn(`[Registry] Attempted to unregister non-existent ${type}: ${name}`);
      return;
    }
    if (collection.has(name)) {
      collection.delete(name);
      this.log(`[Registry] Unregistered ${type}: ${name}`);
      return;
    }
    // Scan composite keys
    for (const key of collection.keys()) {
      if (key.endsWith(`:${name}`)) {
        collection.delete(key);
        this.log(`[Registry] Unregistered ${type}: ${key}`);
        return;
      }
    }
    console.warn(`[Registry] Attempted to unregister non-existent ${type}: ${name}`);
  }

  /**
   * Universal Get Method.
   *
   * ADR-0048 §3.3 — *package-scoped* resolution. When `currentPackageId` is
   * given (the package the caller is resolving within — known from the route /
   * `activeApp._packageId`), a bare name resolves to *that package's* item
   * before any cross-package fallback, so two packages shipping e.g.
   * `page/home` no longer resolve by registration order (first-match-wins).
   * Because package ids are globally unique this is unambiguous. Omitting
   * `currentPackageId` preserves the legacy resolution exactly (backward
   * compatible) and is best-effort: it returns the first match.
   *
   * Precedence (highest first):
   *   1. bare-key runtime/DB overlay (ADR-0005 sanctioned override) — unchanged
   *   2. the `currentPackageId` composite entry (prefer-local)
   *   3. first composite match (legacy first-registered-wins fallback)
   */
  getItem<T>(type: string, name: string, currentPackageId?: string): T | undefined {
    // Special handling for 'object' and 'objects' types - use objectContributors
    if (type === 'object' || type === 'objects') {
      return this.getObject(name) as unknown as T | undefined;
    }

    const collection = this.metadata.get(type);
    if (!collection) return undefined;
    // A bare-key entry (a runtime/DB overlay rehydrated by restoreMetadataFromDb)
    // intentionally shadows the packaged composite item — ADR-0005 overlay
    // precedence (a customization wins over its package default). This is
    // checked before prefer-local so that precedence holds; note an env-wide
    // (package-less) overlay of a name that collides across packages is
    // inherently ambiguous by schema (sys_metadata is unique on type+name+org,
    // not package) and resolves to the single overlay row.
    const direct = collection.get(name);
    if (direct) return direct as T;

    // Prefer-local: resolve within the caller's package first.
    if (currentPackageId) {
      const local = collection.get(`${currentPackageId}:${name}`);
      if (local) return local as T;
    }

    // Fallback: first composite key matching the bare name (legacy behaviour).
    for (const [key, item] of collection) {
      if (key.endsWith(`:${name}`)) {
        return item as T;
      }
    }
    return undefined;
  }

  /**
   * Artifact-only lookup (ADR-0010 §3.3). Unlike {@link getItem} — which
   * returns the plain-key entry first, so a runtime/DB-rehydrated row
   * registered under the bare name SHADOWS the packaged artifact — this
   * scans the composite (`<packageId>:<name>`) entries first and only
   * returns an item whose `_packageId` marks a genuine code package
   * (truthy and not the `'sys_metadata'` rehydration sentinel).
   *
   * This is what the protocol's lock/provenance resolution must use:
   * the artifact's `_lock` envelope always wins over an overlay, and an
   * overlay row hydrated into the plain key must never be able to mask
   * it (that masking is exactly the "registry pollution" bug where a
   * locked app's `_lock` read back as undefined after a PUT+GET).
   */
  getArtifactItem<T>(type: string, name: string, currentPackageId?: string): T | undefined {
    if (type === 'object' || type === 'objects') {
      // [ADR-0029 D9.6] Artifact identity is read from the OWNER contributor's
      // layer, NEVER from the merged body. The merged body deliberately keeps
      // the overlay's `_provenance: 'org'` (D9.2 — the resolved schema must
      // not move), so applying the artifact test to it answers about whichever
      // layer is on top rather than about the code layer, which is exactly how
      // this predicate came to answer `false` for a name a code package still
      // ships (#6853 P3) and silently disarmed `saveMetaItem`'s overlay gate
      // and tier 3 of the delete heal.
      //
      // What comes BACK is the code-layer body (owner + its extenders), which
      // is what every consumer of this lookup wants — the packaged baseline an
      // overlay customizes, and the `_lock`/`_packageId`/`_provenance`
      // envelope that must win over an overlay (ADR-0010 §3.3). With no
      // overlay registered it is byte-for-byte the previous answer.
      const fqn = this.resolveObjectKey(name);
      const ownerLayer = fqn === undefined ? undefined : this.resolveOwnerLayer(fqn);
      return ownerLayer && isCodeArtifactBody(ownerLayer) ? (ownerLayer as T) : undefined;
    }
    const collection = this.metadata.get(type);
    if (!collection) return undefined;
    // ADR-0048 prefer-local: when the caller resolves within a package, the
    // artifact owned by that package wins over a first-match composite scan,
    // so two installed packages shipping the same name don't resolve by Map
    // iteration order.
    if (currentPackageId) {
      const local = collection.get(`${currentPackageId}:${name}`) as any;
      if (local && local._packageId && local._packageId !== 'sys_metadata' && !isTenantAuthored(local)) return local as T;
    }
    for (const [key, item] of collection) {
      if (key !== name && key.endsWith(`:${name}`)) {
        const it = item as any;
        if (it && it._packageId && it._packageId !== 'sys_metadata' && !isTenantAuthored(it)) return item as T;
      }
    }
    // Bare-key fallback: a runtime/DB overlay rehydrated under the plain name.
    // ADR-0048 (#1828) — when the caller resolves *within a package*, only accept
    // this entry if it belongs to that package. The bare slot holds a single
    // row (last hydrate wins), so once the unscoped list stopped collapsing
    // colliding rows, an overlay from package A hydrated here would otherwise be
    // grafted as the "artifact" of package B's same-name row — mislabeling its
    // `_packageId`/lock. A package-less caller (`currentPackageId` omitted) keeps
    // the legacy best-effort first-match.
    const direct = collection.get(name) as any;
    if (
      direct && direct._packageId && direct._packageId !== 'sys_metadata' && !isTenantAuthored(direct) &&
      (!currentPackageId || direct._packageId === currentPackageId)
    ) {
      return direct as T;
    }
    return undefined;
  }

  /**
   * Remove a plain-key runtime shadow so the packaged artifact registered
   * under a composite key becomes the visible value again. Used by the
   * metadata reset path (`deleteMetaItem`): deleting the `sys_metadata`
   * overlay row must also heal the in-memory registry, otherwise the
   * stale overlay copy keeps shadowing the artifact until restart.
   *
   * Deliberately conservative: the plain-key entry is only deleted when a
   * packaged artifact still exists under a composite key, so the name
   * stays resolvable afterwards. A runtime-only item (no artifact
   * backing) is left untouched. Note the plain entry's own `_packageId`
   * is NOT consulted — the hydration path grafts the artifact envelope
   * onto the shadow (ADR-0010 §3.3), so a stamped `_packageId` does not
   * mean the plain entry IS the artifact registration; artifact loaders
   * always register under a composite key.
   */
  removeRuntimeShadow(type: string, name: string): boolean {
    const collection = this.metadata.get(type);
    if (!collection || !collection.has(name)) return false;
    for (const [key, item] of collection) {
      if (key !== name && key.endsWith(`:${name}`)) {
        const it = item as any;
        if (it && it._packageId && it._packageId !== 'sys_metadata') {
          collection.delete(name);
          this.log(`[Registry] Removed runtime shadow ${type}: ${name} (artifact ${it._packageId} restored)`);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * [#5079] Remove the PLAIN-KEY entry for `(type, name)` — the slot an
   * ADR-0005 overlay row hydrates into — and nothing else. The composite
   * (`<packageId>:<name>`) entries are never touched.
   *
   * The other half of {@link removeRuntimeShadow}, for the case that method
   * deliberately declines. `removeRuntimeShadow` drops the plain key only
   * when a packaged artifact remains underneath, so the name stays
   * resolvable; that was the whole story while the plain key could only ever
   * be an artifact's shadow. #4521 changed it: `saveMetaItem` now writes an
   * overlay through into the registry, so a runtime-CREATED item (nothing
   * shipped under that name) lives under the plain key too — and its DELETE
   * had nothing that would ever remove it. `GET /meta/<type>` kept
   * enumerating a deleted item and `GET /meta/<type>/<name>` kept serving its
   * body for the life of the process (#4432's "every surface in agreement"
   * clause, residual). plugin-security's `permission` projection carries a
   * consumer-side work-around for the same lingering entry
   * (`readDeclaredBody` skipping shadows so a deleted set is not undeletable);
   * this is the producer-side removal it was compensating for.
   *
   * Whether the item really is gone from every OTHER layer is not a fact this
   * registry holds — the MetadataService may still serve a baseline for the
   * name — so the caller decides. `deleteMetaItem`'s
   * `restoreArtifactRegistryView` calls this only after both lower layers
   * (composite artifact, MetadataService baseline) have answered "nothing".
   *
   * Refuses exactly one entry: a plain-key registration that IS a packaged
   * artifact — `_packageId` set, not the `'sys_metadata'` rehydration
   * sentinel, not tenant-authored — which is the same predicate
   * {@link getArtifactItem} applies to its own bare-key fallback. Artifact
   * loaders normally register under a composite key, but
   * `loadMetadataFromService` passes the item's own `_packageId` through, so a
   * package-stamped item can land here; unregistering shipped code that the
   * overlay delete never touched would be a worse bug than the one this fixes.
   *
   * @returns whether an entry was removed.
   */
  removeOverlayEntry(type: string, name: string): boolean {
    const collection = this.metadata.get(type);
    if (!collection || !collection.has(name)) return false;
    const plain = collection.get(name) as any;
    if (plain && plain._packageId && plain._packageId !== 'sys_metadata' && !isTenantAuthored(plain)) {
      return false;
    }
    collection.delete(name);
    this.log(`[Registry] Removed overlay entry ${type}: ${name} (no layer serves it any more)`);
    return true;
  }

  /**
   * Universal List Method
   */
  listItems<T>(type: string, packageId?: string): T[] {
    // Special handling for 'object' and 'objects' types - use objectContributors
    if (type === 'object' || type === 'objects') {
      return this.getAllObjects(packageId) as unknown as T[];
    }

    const items = Array.from(this.metadata.get(type)?.values() || []) as T[];
    let result = items;
    if (packageId) {
      result = result.filter((item: any) => item._packageId === packageId);
    }
    // Hide metadata owned by a disabled package so the console (app switcher,
    // view lists, dashboards, …) stops surfacing it after a disable. The
    // `package` type itself is never filtered — the Packages page must still
    // list disabled packages so they can be re-enabled. Disable is reversible:
    // items remain registered and reappear on enable.
    if (type !== 'package') {
      result = result.filter((item: any) => !this.isPackageDisabled((item as any)?._packageId));
    }
    return result;
  }

  /**
   * Whether a package has been explicitly disabled. Unknown packages and
   * items with no owning package are treated as enabled.
   */
  isPackageDisabled(packageId?: string): boolean {
    if (!packageId) return false;
    const pkg = this.getPackage(packageId);
    return pkg?.enabled === false || pkg?.status === 'disabled';
  }

  /**
   * Get all registered metadata types (Kinds)
   */
  getRegisteredTypes(): string[] {
    const types = Array.from(this.metadata.keys());
    // Always include 'object' even if stored separately
    if (!types.includes('object') && this.objectContributors.size > 0) {
      types.push('object');
    }
    return types;
  }

  // ==========================================
  // Package Management
  // ==========================================

  installPackage(manifest: ObjectStackManifest, settings?: Record<string, any>): InstalledPackage {
    // ADR-0048 Phase 1 — install-time namespace gate. Refuse a package whose
    // namespace is already owned by a *different* installed package; this is
    // the constraint the object/table layer enforces implicitly (a duplicate
    // `CREATE TABLE <ns>_<obj>` fails at the DB), made explicit and early.
    // Same-package reinstall/reload is excluded (owner === manifest.id), and
    // shareable platform namespaces (base/system/sys) are exempt.
    if (manifest.namespace && !isShareableNamespace(manifest.namespace)) {
      const conflictOwner = this.getNamespaceOwners(manifest.namespace).find(
        (owner) => owner !== manifest.id,
      );
      if (conflictOwner) {
        if (this.collisionPolicy === 'warn') {
          console.warn(
            `[Registry] Namespace conflict (downgraded to warning via ` +
              `OS_METADATA_COLLISION=warn): namespace "${manifest.namespace}" is ` +
              `already owned by "${conflictOwner}"; installing "${manifest.id}" ` +
              `anyway. See ADR-0048.`,
          );
        } else {
          throw new NamespaceConflictError(manifest.namespace, conflictOwner, manifest.id);
        }
      }
    }

    const now = new Date().toISOString();
    const disabled = this.initialDisabledPackageIds.has(manifest.id);
    const pkg: InstalledPackage = {
      manifest,
      status: disabled ? 'disabled' : 'installed',
      enabled: !disabled,
      installedAt: now,
      updatedAt: now,
      ...(disabled ? { statusChangedAt: now } : {}),
      settings,
    };
    
    // Register namespace if present
    if (manifest.namespace) {
      this.registerNamespace(manifest.namespace, manifest.id);
    }
    
    if (!this.metadata.has('package')) {
      this.metadata.set('package', new Map());
    }
    const collection = this.metadata.get('package')!;
    if (collection.has(manifest.id)) {
      // Re-install of an already-registered package manifest (rebuild / HMR) is
      // a normal path, not an error — keep it at debug (#3420).
      this.debug(`[Registry] Overwriting package: ${manifest.id}`);
    }
    collection.set(manifest.id, pkg);
    this.log(`[Registry] Installed package: ${manifest.id} (${manifest.name})`);
    return pkg;
  }

  uninstallPackage(id: string): boolean {
    const pkg = this.getPackage(id);
    if (!pkg) {
      console.warn(`[Registry] Package not found for uninstall: ${id}`);
      return false;
    }

    // Unregister namespace
    if (pkg.manifest.namespace) {
      this.unregisterNamespace(pkg.manifest.namespace, id);
    }

    // Unregister objects (will throw if extenders exist)
    this.unregisterObjectsByPackage(id);

    // Remove package record
    const collection = this.metadata.get('package');
    if (collection) {
      collection.delete(id);
      this.log(`[Registry] Uninstalled package: ${id}`);
      return true;
    }
    return false;
  }

  getPackage(id: string): InstalledPackage | undefined {
    return this.metadata.get('package')?.get(id) as InstalledPackage | undefined;
  }

  getAllPackages(): InstalledPackage[] {
    return this.listItems<InstalledPackage>('package');
  }

  enablePackage(id: string): InstalledPackage | undefined {
    const pkg = this.getPackage(id);
    if (pkg) {
      pkg.enabled = true;
      pkg.status = 'installed';
      pkg.statusChangedAt = new Date().toISOString();
      pkg.updatedAt = new Date().toISOString();
      this.log(`[Registry] Enabled package: ${id}`);
    }
    return pkg;
  }

  disablePackage(id: string): InstalledPackage | undefined {
    const pkg = this.getPackage(id);
    if (pkg) {
      pkg.enabled = false;
      pkg.status = 'disabled';
      pkg.statusChangedAt = new Date().toISOString();
      pkg.updatedAt = new Date().toISOString();
      this.log(`[Registry] Disabled package: ${id}`);
    }
    return pkg;
  }

  /**
   * Merge editable manifest fields (name / description / version) into an
   * installed package — the in-memory half of `PATCH /packages/:id`.
   *
   * Only the human-editable fields are touched: `id` is identity (never
   * changes here), and lifecycle facets (`status` / `enabled` / `installedAt`)
   * are preserved — this is a metadata edit, NOT a reinstall (which
   * `installPackage` would be, resetting exactly those). Undefined patch
   * fields are ignored so a partial PATCH only overwrites what it sends.
   */
  updatePackageManifest(
    id: string,
    patch: { name?: string; description?: string; version?: string },
  ): InstalledPackage | undefined {
    const pkg = this.getPackage(id);
    if (!pkg) return undefined;
    const manifest = pkg.manifest as Record<string, unknown>;
    if (patch.name !== undefined) manifest.name = patch.name;
    if (patch.description !== undefined) manifest.description = patch.description;
    if (patch.version !== undefined) manifest.version = patch.version;
    pkg.updatedAt = new Date().toISOString();
    this.log(`[Registry] Updated package manifest: ${id}`);
    return pkg;
  }

  // ==========================================
  // App Helpers
  // ==========================================

  registerApp(app: any, packageId?: string) {
    this.registerItem('app', app, 'name', packageId);
  }

  getApp(name: string, currentPackageId?: string): any {
    // ADR-0048 §3.1 — apps are addressed by package id (one app per package).
    // When the caller knows it (route segment / `_packageId`), resolve
    // prefer-local; otherwise this is a best-effort by-name lookup.
    const app = this.getItem('app', name, currentPackageId);
    if (!app) return app;
    return this.applyNavContributions(app);
  }

  getAllApps(): any[] {
    return this.listItems('app').map((app: any) => this.applyNavContributions(app));
  }

  // ==========================================
  // App navigation contributions (ADR-0029 D7)
  // ==========================================

  /**
   * Register a navigation contribution — a package injecting nav items into
   * an app it does not own (the UI-layer analog of object `extend`).
   *
   * Contributions are merged into the target app's `navigation` tree lazily
   * on read ({@link getApp} / {@link getAllApps}) by group id + priority, so
   * registration order does not matter and the owning app can be registered
   * before or after its contributors.
   */
  registerAppNavContribution(
    contribution: { app: string; group?: string; priority?: number; items?: any[] },
    packageId?: string,
  ): void {
    if (!contribution || !contribution.app) return;
    const list = this.appNavContributions.get(contribution.app) ?? [];
    list.push({
      packageId,
      group: contribution.group,
      priority: contribution.priority ?? 200,
      items: Array.isArray(contribution.items) ? contribution.items : [],
    });
    this.appNavContributions.set(contribution.app, list);
    this.log(
      `[Registry] Navigation contribution: ${packageId ?? '(unknown)'} -> ${contribution.app}` +
        (contribution.group ? `/${contribution.group}` : '') +
        ` (${list[list.length - 1].items.length} items)`,
    );
  }

  /** Contributions registered for an app (empty array when none). */
  getAppNavContributions(appName: string): Array<{ packageId?: string; group?: string; priority: number; items: any[] }> {
    return this.appNavContributions.get(appName) ?? [];
  }

  /**
   * Return a copy of `app` with all registered navigation contributions
   * merged into its `navigation` tree. The stored app is never mutated, so
   * repeated reads stay idempotent.
   *
   * Public so the protocol serving path (`getMetaItems` / `getMetaItem` for
   * `app`) can merge contributions the same way `getApp` / `getAllApps` do —
   * the REST app endpoints read through the protocol, not these helpers, so
   * the merge must be reachable from there too (ADR-0029 D7).
   */
  applyNavContributions(app: any): any {
    const contributions = this.appNavContributions.get(app?.name);
    if (!contributions || contributions.length === 0) return app;

    const cloned = structuredClone(app);
    const nav: any[] = Array.isArray(cloned.navigation) ? cloned.navigation : (cloned.navigation = []);

    // Lower priority applied first — mirrors object extender ordering.
    const sorted = [...contributions].sort((a, b) => a.priority - b.priority);
    for (const c of sorted) {
      if (!c.items.length) continue;
      if (c.group) {
        const group = this.findNavGroup(nav, c.group);
        if (group) {
          if (!Array.isArray(group.children)) group.children = [];
          group.children.push(...c.items);
        } else {
          this.log(
            `[Registry] Navigation contribution from "${c.packageId ?? '(unknown)'}" targets ` +
              `missing group "${c.group}" in app "${app.name}" — appending at top level.`,
          );
          nav.push(...c.items);
        }
      } else {
        nav.push(...c.items);
      }
    }
    return cloned;
  }

  /** Depth-first search for a `type: 'group'` nav item by id. */
  private findNavGroup(items: any[], groupId: string): any | undefined {
    for (const item of items) {
      if (item && item.id === groupId && item.type === 'group') return item;
      if (item && Array.isArray(item.children)) {
        const found = this.findNavGroup(item.children, groupId);
        if (found) return found;
      }
    }
    return undefined;
  }

  // ==========================================
  // Plugin Helpers
  // ==========================================

  registerPlugin(manifest: ObjectStackManifest) {
    this.registerItem('plugin', manifest, 'id');
  }

  getAllPlugins(): ObjectStackManifest[] {
    return this.listItems<ObjectStackManifest>('plugin');
  }

  // ==========================================
  // Kind Helpers
  // ==========================================

  registerKind(kind: { id: string, globs: string[] }) {
    this.registerItem('kind', kind, 'id');
  }
  
  getAllKinds(): { id: string, globs: string[] }[] {
    return this.listItems('kind');
  }

  // ==========================================
  // Reset (for testing)
  // ==========================================

  /**
   * Invalidate the merged-schema cache for a single FQN (or short name).
   *
   * Call this from event-driven consumers (ADR-0008 M0 PR-7) when an
   * upstream metadata change makes the cached merged definition stale.
   * The contributor list is preserved — only the cached merge result is
   * dropped, so the next `resolveObject(fqn)` recomputes from scratch.
   *
   * Accepts either an FQN (`acme__contact`) or a bare short name
   * (`contact`); for the latter, all entries whose suffix matches the
   * name are invalidated.
   */
  invalidate(fqnOrName: string): void {
    this._objectRevision += 1;
    if (this.mergedObjectCache.has(fqnOrName)) {
      this.mergedObjectCache.delete(fqnOrName);
      return;
    }
    // Short-name path: drop any cached merge whose FQN ends with `__<name>` or equals `<name>`.
    const suffix = `__${fqnOrName}`;
    for (const fqn of Array.from(this.mergedObjectCache.keys())) {
      if (fqn === fqnOrName || fqn.endsWith(suffix)) {
        this.mergedObjectCache.delete(fqn);
      }
    }
  }

  /** Drop every entry from the merged-schema cache. */
  invalidateAll(): void {
    this.mergedObjectCache.clear();
    this._objectRevision += 1;
  }

  /**
   * Clear all registry state. Use only for testing.
   */
  reset(): void {
    this.objectContributors.clear();
    this.mergedObjectCache.clear();
    this.namespaceRegistry.clear();
    this.metadata.clear();
    this.appNavContributions.clear();
    this._objectRevision += 1;
    this.log('[Registry] Reset complete');
  }
}
