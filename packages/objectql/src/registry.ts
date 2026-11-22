// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ServiceObject, ObjectOwnership, type RelatedListsArrangement, resolveInjectedSystemColumns, resolveInjectedColumnProvenance as injectedColumnProvenance, AUDIT_PROVENANCE_FIELDS } from '@objectstack/spec/data';
// [#4513] The audit-family governance table, and [#6562] the injected-column
// DEFINITION tables it governs — see the re-exports below for why both live in a
// package `objectql` and `metadata-protocol` both depend on.
import {
  AUDIT_FIELD_GOVERNANCE,
  AUDIT_FIELD_DEFS,
  TENANT_SCOPE_FIELD_DEF,
  OWNER_FIELD_DEF,
  OWNING_BUSINESS_UNIT_FIELD_DEF,
  QUEUE_FIELD_DEF,
  ITEM_KEY_DISCRIMINATORS,
  readDiscriminatorValue as discriminatorValue,
  isCodeArtifactBody,
  isTenantAuthored,
  describeUndeclarableFieldType,
  findUndeclarableFieldType,
  OBJECT_FIELD_TYPE_REFUSED_ERROR_NAME,
  type ObjectFieldTypeRefusal,
  type ObjectFieldTypeViolation,
  type FieldPatchTargetMiss,
  pairsOf,
  installedManifestsOf,
  appOf,
  isPairOf,
  pairOf,
  packageDependencyClosure,
} from '@objectstack/metadata-core';
// [ADR-0029 D9.2a] `scalarOverridesPackagedBase` is the #8284 comparison, imported rather
// than re-spelled: the object FOLD asks the same question one layer down (has
// this scalar been authored away from the packaged default?), and the ruling
// required the same mechanism, not a second comparison shape.
import { resolveTenancyPosture, resolveSearchPinyinEnabled } from '@objectstack/types';
import { postureEnforcesWall } from '@objectstack/spec/security';
import { provisionSearchCompanion } from './search-companion.js';
import type { ExtensionPlacementNote } from './registry-extension-placement.js';
import { ObjectStackManifest, InstalledPackage, type InstalledPackageSource, customizationBasePackageId, type NamespaceObjectNameClash } from '@objectstack/spec/kernel';
import { applyProtection } from '@objectstack/spec/shared';
// [ADR-0130 D1] The ONE derivation of the key a package is installed under
// (`id || name`). The install gate's co-ownership set must name packages by the
// same string the artifact loader ordered them by, or a co-owner would be
// admitted — or refused — under a key nothing else in the path uses.
import { artifactPackageId, declaredDependencyIds, PackageScopedNameRefusedError, permissionSetHoldersMeet, resolvePackageScopedHolders, type SecurityCatalogType } from '@objectstack/core';
// One name, one holder for positions, permission sets and capabilities — the
// rule, the holders and the one place a declaration is read from (module doc).
import {
  BUILT_IN_SECURITY_CATALOG_NAMES,
  describeSecurityCatalogHolder,
  isSecurityCatalogType,
  securityCatalogTypeLabel,
  type SecurityCatalogHolder,
} from './security-catalog-namespace.js';
// One name, one package holder for the bare-name types whose consumers resolve
// without package context — the rule, the holders, the cold boot (module doc).
import {
  declaredBundleMembers,
  type BundleHolding,
  handlerOwnerPackageId,
  holdsBareName,
  isBareNameRegistryType,
  isOverridableBaseline,
  type BareNameColdBootMode,
  type BareNameHolder,
  type BareNameOneHolderType,
} from './bare-name-one-holder.js';
// [ADR-0150 D3, #31680 child E8] The by-name readers that consult (package, name):
// `resolveItem` hands the types they cover to the one package-scoped resolver.
import { isPackageScopedReadType, readPackageScopedItem } from './package-scoped-read.js';
// [ADR-0150 D2, child N] Inside one namespace, a `(type, name)` of the twelve
// uncovered bucket 2/3 types has one package holder — the one predicate the
// package door and `os validate` both ask (module doc).
import {
  namespaceNameConflictMessage,
  type NamespaceNameConflict,
  type NamespacePackage,
  type NamespaceUniqueType,
} from './namespace-co-owner-names.js';
// One default record page per object per deployment — the holders and the one
// place a manifest's default record pages are read from (module doc).
import {
  type MisplacedDefaultPage,
  describeDefaultRecordPageHolder,
  type DefaultRecordPageHolder,
  recordPageSlotsOf,
  type RecordPageSlot,
} from './default-record-page.js';
import { misplacedDefaultPageRefusal } from '@objectstack/spec/ui';
// [#14553] The ONE resolution of "does this nav group id exist?" and the ONE
// wording of the diagnostic when it does not. `os build` calls the same two
// (`checkNavContributionGroups`), so the compile-time door and this read-time
// fold cannot disagree about what a missing group is — the drift that would
// make the build's silence indistinguishable from the silence being fixed.
import {
  type NavContributionGroupDiagnostic,
} from './nav-contribution-diagnostics.js';
// The shared-picklist judgments (merge, served shape, unknown-name refusal) —
// pure, so the registry and the engine plugin's load-time audit read one
// spelling of each. See the module header.
import {
  collectManifestPicklistExtensions,
  collectManifestPicklistReferences,
  collectPicklistReferences,
  type PicklistContribution,
  type PicklistOptionLike,
  type DisagreeingPicklistReference,
  type PicklistArrivalAct,
  type PicklistArrivalVerdict,
  type UnresolvedPicklistExtension,
  type UnresolvedPicklistReference,
} from './picklist-resolution.js';
// [ADR-0150 D3, child E6] The ONE answer to "which package's list does this
// bare picklist name mean, for this referrer" — R's. ⛔ No second closure walk
// and no first-registered fallback here: every picklist read below asks it.
import {
  resolvePackageScopedName,
  type PackageScopedHolder,
  type PackageScopedRefusal,
  type PackageScopedRegistry,
  type PackageScopedResolution,
} from './package-scoped-resolver.js';
import { standaloneActionOwnerKey, isObjectLessActionKey, GLOBAL_ACTION_OBJECT_KEY } from './action-governance.js';
import { actionOwnerScopedRegistry, resolveActionByPackage } from './action-package-addressing.js';
import {
  RecordCurrencyFollowRefusedError,
} from './record-currency-aggregate-door.js';
// [#33949 codemod] The top-level declarations that moved whole to `registry-top-level.ts`, as this file still reads them.
import {
  CO_OWNERSHIP_WORDING, DEFAULT_EXTENDER_PRIORITY, DEFAULT_OVERLAY_PRIORITY, DEFAULT_OWNER_PRIORITY,
  DEFAULT_RECORD_PAGE_CONFLICT_CODE, DUPLICATE_ARTIFACT_OBJECT_NAME_CODE, EXTENDED_OBJECTS_LISTED,
  EXTENSION_DEFAULT_ROW_SCOPE_REFUSED_CODE, EXTENSION_MEMBERSHIP_KEYS_REFUSED_CODE, FIND_BOUND_ACTION_COLLISIONS,
  MISPLACED_DEFAULT_PAGE_CODE, NAMESPACE_CONFLICT_CODE, NO_PACKAGE_REFERRER, OBJECT_FIELD_TYPE_REFUSED_CODE,
  OBJECT_OWNERSHIP_CONFLICT_CODE, OBJECT_QUEUE_COLUMN_REFUSED_CODE, OWNING_BUSINESS_UNIT_FIELD, QUEUE_FIELD,
  RESERVED_NAMESPACES, SECURITY_CATALOG_NAME_RULE, VALIDATION_RULE_COPY_REFUSED_CODE, applyFieldPatches,
  bareNameColdBootWarning, bareNameConflictLine, bareNameReasonFor, bundleBaseKey, carriesTenantScopeColumn,
  coldBootConflictMessage, collectBundle, declaresTenantIndex, mergeValidationsByName, overlaySlotEntriesOf,
  overlaySlotKey, packageBodySlot, parseOverlaySlotKey, parsePackageAction, picklistReferrerOf, sameActionDeclaration,
  sameHolder, storesObjectLessPackagelessRow, withArrivingMembers, withDiscriminator,
} from './registry-top-level.js';
import type {
  ArtifactInstallScope, BareNameConflict, BoundActionCollision, BundleArrival, BundleEntry, CoOwnershipSource,
  DefaultRecordPageConflict, ExtendedObjectOfUninstall, FoldedExtensionFields, FollowDoorLayer, ObjectContributor,
  ObjectExtensionBody, ObjectExtensionFoldOptions, ObjectFoldScalarKey, PicklistItemLike, PicklistReferrer,
  RegistryLogLevel, RunRegisteredObject, SchemaRegistryOptions, SecurityCatalogNameConflict, ServedObjectLayer,
  TenantRuleSettings, UnboundActionTarget, WithheldExtensions,
} from './registry-top-level.js';
// [#33949 codemod] Re-exported by name, so every importer of `./registry.js` reads what it read.
export {
  type ArtifactInstallScope, type BareNameConflict, type BoundActionCollision, type CoOwnershipSource,
  DEFAULT_EXTENDER_PRIORITY, DEFAULT_OVERLAY_PRIORITY, DEFAULT_OWNER_PRIORITY, DEFAULT_RECORD_PAGE_CONFLICT_CODE,
  DUPLICATE_ARTIFACT_OBJECT_NAME_CODE, type DefaultRecordPageConflict, EXTENSION_DEFAULT_ROW_SCOPE_REFUSED_CODE,
  EXTENSION_MEMBERSHIP_KEYS_REFUSED_CODE, FIND_BOUND_ACTION_COLLISIONS, MISPLACED_DEFAULT_PAGE_CODE,
  NAMESPACE_CONFLICT_CODE, OBJECT_FIELD_TYPE_REFUSED_CODE, OBJECT_OWNERSHIP_CONFLICT_CODE,
  OBJECT_QUEUE_COLUMN_REFUSED_CODE, type ObjectContributor, type ObjectExtensionFoldOptions, RESERVED_NAMESPACES,
  type RegistryLogLevel, type SchemaRegistryOptions, type SecurityCatalogNameConflict, type UnboundActionTarget,
  type UnboundActionTargetError, VALIDATION_RULE_COPY_REFUSED_CODE, bareNameColdBootWarning,
  collectManifestBoundActions, collectManifestObjectNames, computeFQN, describeBoundActionCollision,
  describeUnboundActionTargets, parseFQN, reconcileManagedApiMethods, warnFunctionalCompleteness,
  warnStrippedLegacyApiMethods,
} from './registry-top-level.js';
// [#33949 codemod] Logging control, object storage and generic metadata storage: the methods of the same names below hand the bodies what they read (`StorageHost`).
import { StorageFacet } from './registry-storage.js';
// [#33949 codemod] Restore on refusal: the methods of the same names below hand the bodies what they read (`RestoreHost`).
import { RestoreFacet } from './registry-restore.js';
// [#33949 codemod] Namespaces, default record pages and security catalog names: the methods of the same names below hand the bodies what they read (`NamespacesAndClaimsHost`).
import { NamespacesAndClaimsFacet } from './registry-namespaces-and-claims.js';
// [#33949 codemod] Bare names, one name one package holder: the methods of the same names below hand the bodies what they read (`BareNamesHost`).
import { BareNamesFacet } from './registry-bare-names.js';
// [#33949 codemod] Object registration (ownership model): the methods of the same names below hand the bodies what they read (`ObjectRegistrationHost`).
import { ObjectRegistrationFacet } from './registry-object-registration.js';
// [#33949 codemod] Platform-global declaration and uninstall checks: the methods of the same names below hand the bodies what they read (`PlatformGlobalHost`).
import { PlatformGlobalFacet } from './registry-platform-global.js';
// [#33949 codemod] Generic metadata items and package bodies: the methods of the same names below hand the bodies what they read (`ItemsHost`).
import { ItemsFacet } from './registry-items.js';
// [#33949 codemod] Package-scoped addressing: the methods of the same names below hand the bodies what they read (`PackageAddressingHost`).
import { PackageAddressingFacet } from './registry-package-addressing.js';
// [#33949 codemod] Package management: the methods of the same names below hand the bodies what they read (`PackagesHost`).
import { PackagesFacet } from './registry-packages.js';
// [#33949 codemod] Apps, navigation contributions and their diagnostics: the methods of the same names below hand the bodies what they read (`AppsHost`).
import { AppsFacet } from './registry-apps.js';
// [#33949 codemod] Plugins, kinds, shared picklists and reset: the methods of the same names below hand the bodies what they read (`PicklistsHost`).
import { PicklistsFacet } from './registry-picklists.js';
import { installSchemaRegistryRevision, schemaRegistryRevisionOf } from './registry-revision.js';
// [#33949 codemod] The facets' hosts, one per registry, which the static block at the end of the class builds.
import {
  appsHost, bareNamesHost, itemsHost, namespacesAndClaimsHost, objectRegistrationHost, packageAddressingHost,
  packagesHost, picklistsHost, platformGlobalHost, restoreHost, storageHost,
} from './registry-facet-hosts.js';
// [#33949 codemod] Exported for the section modules above, which import them (lever (a)); `index.ts` re-exports by name, so none reaches the package.
export {
  NOT_A_PAIR_ROW_OF_A_HOLDER, RegistrationRestorePoint, TENANT_SCOPE_INDEX, ValidationRuleCopyRefusedError,
  actionHoldersOnOwnerKeyOf, declaredOverrideBase, isShareableNamespace, mergeObjectDefinitions,
  pairRowDeclaresAnotherHolder, provisionTenantScopeIndex,
};

/**
 * Deep merge two ServiceObject definitions.
 *
 * The merge set is CLOSED and enumerable — this is NOT "every prop, later
 * value wins":
 *   - `fields` and `indexes` are merged ADDITIVELY (`fields` keyed by name).
 *   - `validations` are merged BY NAME ({@link mergeValidationsByName},
 *     [ADR-0029 D9.2a, 2026-10-30 note]): rules of different names add, and a
 *     rule of a name already folded replaces it — with `tenantRules`, carrying
 *     the tenant's `message` and `active`, never the tenant's condition.
 *   - The {@link OBJECT_FOLD_SCALAR_KEYS} (`label`, `pluralLabel`,
 *     `description`, and [#36366] `pinnedActions` arm by arm) are overridden
 *     last-writer-wins, subject to the
 *     `tenantAuthored` yield rule below. [#30391] A `label` that renames the
 *     object without a `pluralLabel` beside it also takes the running
 *     `pluralLabel` off: the plural named the old label.
 *   - `fieldPatches` [ADR-0146 D10, second rule] is APPLIED, never carried:
 *     after the merges above, each patch writes its `BASE_FIELD_DISPLAY_WHITELIST`
 *     keys onto the named field and its option labels onto the options whose
 *     stored `value` it names, each key yielding where `tenantPatched` says the
 *     tenant authored it — the same D9.2a rule as the scalars. A patch reaches
 *     the owner's own fields only (`ownFields`): one naming any other field,
 *     a field an extension adds included, is skipped here; the fold names it.
 *   - `place` [#35901] is not read here: the fold applies every extension's
 *     placements once, after this merge has run for all of them
 *     (`applyExtensionPlacements`, registry-extension-placement.ts), so an
 *     anchor names the object as served.
 *
 * **Every other top-level prop on `extension` is silently discarded.**
 * `merged` starts as `{ ...base }` and nothing outside the list above is ever
 * copied onto it — a caller that hands this function an extension body
 * carrying an undeclared key, e.g. `tenancy: { enabled: false }`, gets a
 * valid-but-inert no-op HERE: no error, no warning from this function, the
 * base's existing value simply wins as if the extension had never named the
 * key (issue #12680).
 *
 * Declarative authors never reach that silence, though: `ObjectExtensionSchema`
 * (`packages/spec/src/data/object.zod.ts`) is `.strict()` — its shape is
 * exactly `extend` / `fields` / `fieldPatches` / `label` / `pluralLabel` /
 * `description` / `pinnedActions` / `validations` / `indexes` / `place` / `fieldGroups` / `relatedLists` / `priority`, so an `objectExtensions` entry
 * naming `tenancy`, `permissions`, or any other key outside that list fails
 * LOUDLY at authoring time with a prescription (#4001; the same rule is
 * documented at `content/docs/data-modeling/object-extensions.mdx`). This
 * function's discard is reachable only by a caller that bypasses that
 * schema — a direct, programmatic `registry.registerObject(def, pkg,
 * undefined, 'extend', …)` call, which is how this package's own pin
 * (`registry-object-extension-nonenumerated-prop-discard.test.ts`) exercises
 * the rule. Extender-writable `tenancy`/`permissions` would in any case be a
 * separate, much bigger decision that has NOT been made.
 *
 * Unlike `tenancy`/`permissions`, this one is not blocked by schema:
 * `_provenance` is a real top-level prop an `extend` contributor carries
 * TODAY. Copying it through (as "later value
 * wins" would) lets a third-party extender flip a tenant-authored object's
 * `_provenance` to the extending package's — reaching, by a different route,
 * the exact outcome ADR-0029 D9.3's priority-reranking guard exists to
 * prevent. `registry-object-overlay-layer.test.ts` ("an extender declaring
 * priority 140 does not become the base layer") fails if this merge set is
 * widened to copy it through.
 *
 * [ADR-0029 D9.2a] …the SCALAR override above is conditional. `tenantAuthored` names
 * the scalars the fold's BASE has authored away from the packaged owner's
 * value; an extender yields on those. See
 * {@link SchemaRegistry.tenantAuthoredScalars} for why the set is computed once
 * over the base rather than re-derived from the running `merged`; `tenantRules`
 * ({@link SchemaRegistry.tenantRuleSettings}) is computed once for the same reason.
 */
function mergeObjectDefinitions(
  base: ServiceObject,
  extension: ObjectExtensionBody,
  tenantAuthored?: ReadonlySet<ObjectFoldScalarKey>,
  tenantRules?: ReadonlyMap<string, TenantRuleSettings>,
  tenantPatched?: ReadonlySet<string>,
  ownFields?: ReadonlySet<string>,
): ServiceObject {
  const merged = { ...base };

  // Merge fields additively
  if (extension.fields) {
    merged.fields = { ...base.fields, ...extension.fields };
  }

  // [ADR-0029 D9.2a, 2026-10-30 note] Merge validations by name
  if (extension.validations) {
    merged.validations = mergeValidationsByName(
      base.validations,
      extension.validations,
      tenantRules,
    ) as ServiceObject['validations'];
  }

  // Merge indexes additively
  if (extension.indexes) {
    merged.indexes = [...(base.indexes || []), ...extension.indexes];
  }

  // Override scalar props (last writer wins) — [ADR-0029 D9.2a] unless the base has been
  // authored by the tenant, in which case the extender's packaged default yields.
  const yields = (key: ObjectFoldScalarKey): boolean => tenantAuthored?.has(key) === true;
  if (extension.label !== undefined && !yields('label')) {
    // [#30391] `pluralLabel` is the plural OF `label`: an extension that renames
    // the object and declares no plural leaves the running plural naming the
    // old label, so the object is served as one that declares no
    // `pluralLabel`. A plural the tenant authored stays (the D9.2a yield), and
    // an extension that repeats the label it extends renames nothing.
    if (extension.pluralLabel === undefined && extension.label !== merged.label && !yields('pluralLabel')) {
      delete merged.pluralLabel;
    }
    merged.label = extension.label;
  }
  if (extension.pluralLabel !== undefined && !yields('pluralLabel')) {
    merged.pluralLabel = extension.pluralLabel;
  }
  if (extension.description !== undefined && !yields('description')) {
    merged.description = extension.description;
  }
  // [#36366] The header buttons per page type, a fold scalar like the three
  // above, arm by arm: an arm the extension sets replaces the running arm, an
  // arm it leaves out stays as folded.
  if (extension.pinnedActions !== undefined && !yields('pinnedActions')) {
    merged.pinnedActions = { ...merged.pinnedActions, ...extension.pinnedActions };
  }

  // [ADR-0146 D10, second rule] The extension's display patches of the
  // owner's own fields (`ownFields`) — never of a field an extension adds,
  // whatever the priorities, or the answer would depend on which extender the
  // fold reached first — applied AFTER the additive merges, with each key
  // yielding where the tenant authored it (`tenantPatched`, ADR-0029 D9.2a),
  // as the scalars above yield. Two extenders patching one key resolve as the
  // scalars do: the fold applies contributors in ascending `priority`, so the
  // higher one is written last.
  if (extension.fieldPatches) {
    merged.fields = applyFieldPatches(merged.fields, extension.fieldPatches, tenantPatched, ownFields);
  }

  return merged;
}

/** All valid {@link RegistryLogLevel} values — used to validate `OS_REGISTRY_LOG`. */
export const REGISTRY_LOG_LEVELS: readonly RegistryLogLevel[] = [
  'debug', 'info', 'warn', 'error', 'silent',
];

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
 *     the column never depends on the global multi-tenant flag. Required-false
 *     in the declaration; org-scoping stamps it on insert (under `single` with
 *     the Default Organization), and it is never NULL (ADR-0131 D1). Only the
 *     column's INDEX is gated on `multiTenant` (no per-tenant filtering exists
 *     single-tenant).
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
export { AUDIT_FIELD_DEFS, TENANT_SCOPE_FIELD_DEF, OWNER_FIELD_DEF, OWNING_BUSINESS_UNIT_FIELD_DEF, QUEUE_FIELD_DEF };

/**
 * [#7865] Injected-column PROVENANCE — the registry face of the 2026-08-12
 * maintainer ruling (direction B): the injection below keeps running for
 * `external` objects, and the machine-readable marker for the anchors it
 * registers without provisioning storage is this API, re-exported from the
 * table's home in `@objectstack/metadata-core` exactly like the definition
 * tables above (#6562's discipline: the producer and every consumer read one
 * answer from one place). The definitions themselves stay byte-identical —
 * see `resolveInjectedColumnProvenance`'s doc for why the marker is an
 * exported derivation and NOT a `provisioned: false` key on the field defs.
 */
export {
  platformProvisionsStorage,
  resolveInjectedColumnProvenance,
  unprovisionedInjectedColumns,
  type InjectedColumnProvenance,
} from '@objectstack/metadata-core';

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

export function applySystemFields(
  schema: ServiceObject,
  opts: {
    multiTenant: boolean;
    /**
     * [ADR-0131 D7] The objects THIS deployment declares platform-global — the
     * plan's one deployment input. A declared object gets no `organization_id`
     * here. Omitted or empty ⇒ the plan is byte-identical to the authored one.
     */
    platformGlobalObjects?: ReadonlySet<string>;
  }
): ServiceObject {
  // WHICH columns this object carries is the spec's derivation
  // (`resolveInjectedSystemColumns`, #5378) — one answer shared with every
  // author-time consumer that must resolve a reference to an injected column
  // but cannot load this runtime (`@objectstack/lint`). This function keeps sole
  // ownership of WHAT each column looks like, the same split #3786 established
  // for the audit family. Do NOT re-derive a condition below: a second copy here
  // is exactly the drift the plan exists to prevent.
  //
  // [#7865] This pass runs for `external` (ADR-0015) objects too — DELIBERATELY
  // (maintainer ruling 2026-08-12, direction B). The platform provisions no
  // storage for a federated object (`syncObjectSchema` returns early, no DDL),
  // so the anchors injected below are registered-but-unprovisioned there; the
  // machine-readable marker for that fact is `resolveInjectedColumnProvenance`
  // / `unprovisionedInjectedColumns` (re-exported above from
  // `@objectstack/metadata-core`), NOT a key on the definitions this function
  // spreads — the definitions must stay byte-identical to the shipped tables,
  // because the #7859 Layer-0 guard and the #4326 round-trip strip both read
  // them by exact identity. Do not add keys here; consumers ask the API.
  //
  // [ADR-0131 D7] …and the deployment's platform-global declaration is the
  // plan's one deployment input: a declared object is planned with no tenant
  // column, so nothing below injects `organization_id` for it. Passed only when
  // a deployment declared something, so every other call is the one-argument
  // plan, byte for byte.
  const plan =
    opts.platformGlobalObjects && opts.platformGlobalObjects.size > 0
      ? resolveInjectedSystemColumns(schema, { platformGlobalObjects: opts.platformGlobalObjects })
      : resolveInjectedSystemColumns(schema);

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
  // single-tenant stacks: they can always stamp the column, and org-scoping
  // stamps it on insert (under `single` with the Default Organization), so it
  // is never NULL (ADR-0131 D1). The multi-tenant flag now governs only
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
  // `ownership: 'business_unit' | 'org' | 'none'` on the schema (Dataverse-style
  // — catalog / junction tables, plus D1's unit-owned tier, which takes the BU
  // anchor instead). Note this is the SAFE default direction: forgetting the
  // opt-out leaves a harmless spare column, whereas the old opt-IN model let
  // authors silently ship objects with no working ownership at all.
  // `ownership` is a declared ObjectSchema field (record-ownership model), read
  // off the typed schema by the plan — no `as any` (#3175).
  //
  // [ADR-0117 D1 / #5677] The plan treats the value as a `string`, not the
  // enum, on purpose: it is also called on pre-parse input. That widening is
  // what let the engine recognise D1's fourth tier `'business_unit'` BEFORE the
  // schema could emit it — the ordering #5677 → #5678 exists to guarantee, since
  // a tier the schema emits first would be judged by a no-overlap literal test
  // and get the INVERSE of what D1 declares. As of #5678 the spec enum reads
  // `'user' | 'business_unit' | 'org' | 'none'` and the tier is authorable.
  //
  // [ADR-0117 D1 / #5677] The ownership decision is a POSITIVE LIST, deliberately
  // — it used to read `ownership !== 'org' && ownership !== 'none'`, i.e. a
  // DENY-list, so ANY value outside the two exclusions fell through to "inject
  // `owner_id`". That default was safe only while the enum had exactly three
  // members: D1's `business_unit` tier means "owned by a UNIT, not a person"
  // (`owner_id` ❌, `owning_business_unit_id` ✅), and under the deny-list it
  // would have been stamped with `owner_id` — the exact inverse. The same
  // argument applies to any FIFTH tier a later ADR adds, which is why the list
  // stays positive rather than being "completed" to the current enum.
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
  // [ADR-0142 D3] The queue column rides with the owner anchor (the plan's
  // `queue` is its `owner`): "sits in Q" is `queue == Q AND owner_id IS NULL`.
  const wantQueue = plan.queue;

  // Nothing to INJECT — the two opt-out rows (`systemFields: false`,
  // `managedBy: 'better-auth'`) and objects whose every column is already
  // declared.
  //
  // [#8608] It still routes through {@link provisionTenantScopeIndex}, like
  // every other exit below. An object that injects nothing can still CARRY the
  // tenant column — the author declares their own `organization_id` — and the
  // wall composes its predicate on exactly that column (measured, not inferred:
  // plugin-security's `tenancyDisabled` reads `tenancy.enabled` and
  // `systemFields.tenant` only, so `systemFields: false` leaves the wall live).
  // Returning `schema` here was the last exit that decided the index by NOT
  // asking, which is how the withholding survived #8375's convergence.
  if (!wantTenant && !wantAudit && !wantOwner && !wantOwningBusinessUnit && !wantQueue) {
    return provisionTenantScopeIndex(schema, opts);
  }

  const additions: Record<string, any> = {};
  // Platform-owned field settings that must WIN over a declared field, rather
  // than lose to it like `additions` does (#4447).
  const overrides: Record<string, any> = {};

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

    // [#6810] The tenant INDEX that goes with this column is no longer decided
    // here. It is {@link provisionTenantScopeIndex}, called on the merged result
    // at the tail of this function — see #8375 for why a decision spelled out at
    // this one site could not be reached by the `/meta` read exits.
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

  // [ADR-0142 D3] The ownership-queue column: the queue machine name a record
  // with no owner SITS IN, and an owned record's home queue. Text, not a lookup
  // (a declared queue has no row to point at); `readonly: false` like
  // `owner_id`, because its writers are adjudicated where the owner's are — the
  // assignment seam stamps it as the platform, and a client's move is a
  // transfer-class write at plugin-security's step 3.5. `hidden: true`: the
  // Console's queue affordances read it by name, and a raw machine name on every
  // layout is not a reading a person needs. Landed with its writers, never ahead
  // of them (ADR-0078). A declared `queue` never reaches this line on an
  // eligible object: `registerObject` refuses it ({@link objectQueueColumnRefusal}),
  // so the `!schema.fields` guard below only ever admits the platform's own
  // definition coming back through a re-registration.
  if (wantQueue && !schema.fields?.[QUEUE_FIELD]) {
    additions[QUEUE_FIELD] = { ...QUEUE_FIELD_DEF };
  }

  // [#8375] The tenant INDEX is decided over the MERGED result, never over the
  // input — so this function and the read-exit seam ask the same question of the
  // same document shape. Both cases below route through it, including the one
  // that adds no field at all (an object whose every system column is already
  // declared still owes the index decision).
  if (Object.keys(additions).length === 0 && Object.keys(overrides).length === 0) {
    return provisionTenantScopeIndex(schema, opts);
  }

  return provisionTenantScopeIndex(
    {
      ...schema,
      // `additions` LOSE to an author's field (a declared `owner_id` is theirs);
      // `overrides` WIN over it (the audit family's governance is not authorable).
      fields: { ...additions, ...(schema.fields ?? {}), ...overrides },
    },
    opts,
  );
}

/**
 * [#6810, made shareable by #8375] Declare the platform's tenant-scope index on
 * an object that carries a platform-provisioned `organization_id`, on a
 * multi-tenant deployment — the ONE implementation of that decision.
 *
 * ## Why it is a function and not four lines inside `applySystemFields`
 *
 * It was those four lines, and that is precisely how the stamp diverged. The
 * `/meta` read exits converge the injected system COLUMNS through
 * `applyInjectedSystemColumns` (`@objectstack/metadata-core`, #6562) — which
 * cannot reach `applySystemFields`: `@objectstack/objectql` depends on
 * `@objectstack/metadata-protocol` depends on `@objectstack/metadata-core`, so
 * the import runs UP the dependency graph. So the converger re-implemented the
 * half it could reach (the fields map) and silently did not implement the half
 * it could not (this index), and `GET /meta/object/:name` served a multi-tenant
 * object reporting no tenant index while the registry's own answer carried one
 * (#8375).
 *
 * The fix is not an `indexes` line added to that copy — a second implementation
 * is what drifted in the first place. It is this: ONE function, called by the
 * producer below and by {@link SchemaRegistry.materializeBaseLayer}, which is
 * the seam #8268 built so a stamp converges at every read exit the day it is
 * added. `__search` converges by delegating to the registry and has never
 * drifted; this stamp now converges the same way.
 *
 * ## The predicate, stated exactly
 *
 * "The object carries a tenant column" — not "this call just injected one", and
 * [#8459] not "the PLATFORM provisioned it". The first distinction is the whole
 * reason the decision moved out of the injection branch: at a read exit the
 * column is ALREADY present (`governServedItem` runs
 * `applyInjectedSystemColumns` before the seam), so a condition reading
 * `!schema.fields?.organization_id` is false exactly where the convergence is
 * needed. {@link carriesTenantScopeColumn} answers the question the old nesting
 * was really asking, at either site, in either order.
 *
 * The second distinction is the 2026-08-13 maintainer ruling on #8459. This
 * predicate also required the column to be the platform's OWN definition
 * (`isInjectedColumnDefinition`, byte-for-byte), which #8375 preserved exactly
 * rather than widening inside a convergence fix. The effect was that an author
 * who declared their own `organization_id` — adding a label, making it
 * `required`, pointing it at their own org table — kept the column and silently
 * lost the index on it, while `computeTenantLayer0Filter` (plugin-security)
 * went on AND-composing `organization_id = <org>` onto essentially every read of
 * that object. The deployment's hottest predicate, unindexed, reached by an
 * additive-looking authoring move that removed a guarantee the author never knew
 * they held.
 *
 * The ruling is one rule, stated once: on a walled deployment the wall's
 * predicate is indexed, whoever typed the column. ⛔ Not a type judgement — an
 * `organization_id` declared as `text` gets the index too. Inspecting the
 * declared type to decide whether it is "really" the tenant anchor was
 * considered and REJECTED: it is a third predicate at the site where #8375 just
 * reduced two to one, and its boundary is itself something an author gets
 * subtly wrong (a `text` org code would lose the index and look fine).
 *
 * ⚠️ Recorded gap, deliberately left uncovered by that ruling: an author who
 * wants NO index on the tenant column has no way to say so. If that need
 * appears it becomes an explicit declared key — ⛔ it is not grounds to restore
 * the injected-column condition. What exists today for a DIFFERENT index shape
 * is {@link declaresTenantIndex}: declare your own single-column tenant index
 * and the platform declares none.
 *
 * `multiTenant: false` declares NO index rather than a false one: on an unwalled
 * stack nothing filters by organization, so the index is dead weight — the same
 * intent the retired `indexed` flag's value carried (#6810), expressed as
 * presence instead of a boolean.
 *
 * No `name` on the entry: each driver derives its own (SQL's `buildIndexName` is
 * table-qualified, which a hardcoded name could not be without colliding across
 * tables on Postgres; Mongo's index names are per-collection). `unique` is left
 * at its default `false` — a plain lookup index, never a constraint.
 *
 * Idempotent, via {@link declaresTenantIndex}: it runs twice on every
 * registration (once at the tail of `applySystemFields`, once at the seam) and
 * the second call is a no-op. Returns `schema` BY REFERENCE when nothing is
 * owed, so a registry-sourced body pays a comparison and no copy.
 */

/**
 * [#8375] The index entry the platform declares for the tenant scope column —
 * the ONE spelling of it, so the stamp and its write-side strip cannot disagree
 * about what "the platform's own entry" looks like.
 */
const TENANT_SCOPE_INDEX: { fields: string[] } = { fields: ['organization_id'] };

function provisionTenantScopeIndex(
  schema: ServiceObject,
  opts: { multiTenant: boolean; platformGlobalObjects?: ReadonlySet<string> },
): ServiceObject {
  if (!opts.multiTenant) return schema;
  if (!carriesTenantScopeColumn(schema, opts.platformGlobalObjects)) return schema;
  if (declaresTenantIndex(schema)) return schema;

  return {
    ...schema,
    // [#6810] Author-declared indexes keep their position; the platform's
    // tenant index is APPENDED, never merged into or reordering theirs.
    // The write-side inverse depends on that append being at the END —
    // see {@link SchemaRegistry.stripProvisionedTenantIndexFrom}.
    indexes: [...((schema as any).indexes ?? []), { ...TENANT_SCOPE_INDEX }],
  } as ServiceObject;
}

/**
 * [#16319] A field declaration reached the registration door with a `type` that
 * is absent, or that is not a member of `FieldType`.
 *
 * MAINTAINER RULING, 2026-09-10 (director seat batch #111 item 2), verbatim:
 * 「16319 一个没写 type(或拼错)的字段 应该禁止加载。这个才是合理的吧?其他同意」
 *
 * ⛔ The whole object declaration is refused — the offending FIELD is never
 * dropped on its own. Loading an object one field short is the shape this
 * repository tolerates least: every authoring surface reports success, the
 * column is never created, and reads of it answer `undefined` forever. The
 * ruling says so in as many words (「⛔ 不静默丢字段」).
 *
 * `FieldSchema` has always required `type` and always refused a non-member at
 * `[type]`, so nothing that PARSES can reach this. What it closes are the doors
 * that skip Zod: a stored `sys_metadata` row, a raw plugin/package manifest
 * (`manifest` is `any` on the install path) and a direct
 * `registry.registerObject(def)` call. Before this refusal those three doors
 * produced a `varchar(255)` column from `SqlDriver.createColumn`'s
 * `field.type || 'string'` and a `TEXT` column from both migration generators'
 * `fieldDef.type || 'text'` — two families from one declaration, so the
 * platform refused a 101-character value both generated tables accepted.
 *
 * Carries the ADR-0112 envelope (`code` + `status`) — the shape this
 * repository's rejection tests assert against, never a bare throw. A bare
 * `Error` here would be indistinguishable under `toThrow()` from the ownership
 * refusal a few lines up (the #14367 lesson).
 *
 * ⛔ The class is NOT exported, on the same convention as
 * {@link ObjectOwnershipConflictError}'s `*_CODE` constant: this package
 * declares both module realms in its own `exports`, so a consumer holding the
 * other realm's copy would get `instanceof === false`, silently. Consumers ask
 * `isObjectFieldTypeRefused` (`@objectstack/metadata-core`), which compares the
 * error's `name`.
 */
class ObjectFieldTypeRefusedError extends Error implements ObjectFieldTypeRefusal {
  readonly code = OBJECT_FIELD_TYPE_REFUSED_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 422;
  /** The object whose declaration was refused. */
  readonly objectName: string;
  /** The field that carries the unusable `type`. */
  readonly fieldName: string;
  /** The `type` exactly as declared — `undefined` when the key is absent. */
  readonly declaredType: unknown;

  constructor(violation: ObjectFieldTypeViolation) {
    // ⛔ The wording is NOT written here. `describeUndeclarableFieldType` is the
    // one sentence this throw and the boot log both print, so the operator who
    // meets the refusal at `registerObject` and the operator who meets it in the
    // startup log read the same words about the same row.
    super(describeUndeclarableFieldType(violation));
    this.name = OBJECT_FIELD_TYPE_REFUSED_ERROR_NAME;
    this.objectName = violation.objectName;
    this.fieldName = violation.fieldName;
    this.declaredType = violation.declaredType;
  }
}

/**
 * [ADR-0095 D1, 2026-10-18 note; ruling of record 6250748677 on #24164, letter
 * E′ item 4] An `extend` contribution carried `defaultRowScope`. An object's
 * default row scope is the owning declaration's alone: the platform identity
 * objects declare theirs (Layer 1 silence means that scope, not no filter), and
 * an extender "cannot set or loosen a platform object's declared default;
 * refused at registration with a named reason".
 *
 * Refused whatever the value and whatever the target, because no other line is
 * decidable or honest: whether one row predicate admits more rows than another
 * is not decidable for CEL predicates in general, so "loosens" cannot be judged
 * pairwise, and the ruling's own verb is "set"; and the fold
 * ({@link mergeObjectDefinitions}) never carries the key onto the resolved
 * object, so accepting it on any target would be a row restriction its author
 * believes is in force and nothing applies. A contribution that leaves the key
 * alone registers exactly as before.
 *
 * Reachable only by a caller that skips the parse — a direct
 * `registerObject(def, pkg, undefined, 'extend')` call: the manifest path
 * (`ObjectQL.registerApp`) copies a closed key list off each
 * `objectExtensions` entry, and the entry's schema refuses the key at
 * authoring.
 *
 * The ADR-0112 envelope (`code` + `status: 422`), never a bare throw.
 */
class ExtensionDefaultRowScopeRefusedError extends Error {
  readonly code = EXTENSION_DEFAULT_ROW_SCOPE_REFUSED_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 422;
  /** The object the extension targets. */
  readonly objectName: string;
  /** The package whose `extend` contribution this refusal stopped. */
  readonly packageId: string | undefined;

  constructor(objectName: string, packageId: string | undefined) {
    super(
      `Object "${objectName}": the \`extend\` contribution from package "${packageId}" carries ` +
        '`defaultRowScope`. An object\'s default row scope is declared only by the object\'s owner; an ' +
        'extension can neither set nor loosen it, and the extension merge never carries it onto the ' +
        'object. Remove `defaultRowScope` from the extension. To scope the rows a permission set\'s ' +
        'holders read, give that set a `rowLevelSecurity` policy for the object.',
    );
    this.name = 'ExtensionDefaultRowScopeRefusedError';
    this.objectName = objectName;
    this.packageId = packageId;
  }
}

/**
 * [#25234 ruling A, refusal 10] An `extend` contribution carried
 * `membershipKeys`. A membership key is declared by the package that owns the
 * roster object whose rows define it (`ObjectExtensionSchema`'s guidance): the
 * key decides which records a `current_user.KEY` policy lets a caller reach,
 * so another package must not be able to add one to an object it does not own.
 *
 * Refused whatever the value and whatever the target, as
 * {@link ExtensionDefaultRowScopeRefusedError} is: the fold
 * ({@link mergeObjectDefinitions}) never carries the key onto the resolved
 * object, so accepting it would leave a declaration its author believes the
 * security plugin reads and nothing reads. A contribution that leaves the key
 * alone registers exactly as before.
 *
 * Reachable only by a caller that skips the parse — a direct
 * `registerObject(def, pkg, undefined, 'extend')` call: the manifest path
 * (`ObjectQL.registerApp`) copies a closed key list off each
 * `objectExtensions` entry, and the entry's schema refuses the key at
 * authoring.
 *
 * The ADR-0112 envelope (`code` + `status: 422`), never a bare throw.
 */
class ExtensionMembershipKeysRefusedError extends Error {
  readonly code = EXTENSION_MEMBERSHIP_KEYS_REFUSED_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 422;
  /** The object the extension targets. */
  readonly objectName: string;
  /** The package whose `extend` contribution this refusal stopped. */
  readonly packageId: string | undefined;

  constructor(objectName: string, packageId: string | undefined) {
    super(
      `Object "${objectName}": the \`extend\` contribution from package "${packageId}" carries ` +
        '`membershipKeys`. A membership key is declared only by the package that owns the roster object ' +
        'whose rows define it, and the extension merge never carries it onto the object. Remove ' +
        '`membershipKeys` from the extension: declare the key on an object your own package defines, or ' +
        'ask the owning package to declare it.',
    );
    this.name = 'ExtensionMembershipKeysRefusedError';
    this.objectName = objectName;
    this.packageId = packageId;
  }
}

/**
 * [#28574] The refusals an `extend` contribution meets at registration, before
 * anything is materialized: `defaultRowScope`
 * ({@link ExtensionDefaultRowScopeRefusedError}) and `membershipKeys`
 * ({@link ExtensionMembershipKeysRefusedError}), in that order. `undefined`
 * when the contribution carries neither.
 *
 * The ONE copy of both: {@link SchemaRegistry.registerObject} throws what this
 * answers, and the metadata save and publish doors ask it of an
 * `object_extension` item (through
 * {@link SchemaRegistry.extendContributionRefusal}) so the item is refused at
 * the door with the same sentence, instead of being stored and then failing
 * every sync that registers it.
 */
export function extendContributionRefusal(
  schema: { name?: unknown; defaultRowScope?: unknown; membershipKeys?: unknown },
  packageId: string | undefined,
): Error | undefined {
  const name = String(schema.name ?? '');
  if (schema.defaultRowScope !== undefined) return new ExtensionDefaultRowScopeRefusedError(name, packageId);
  if (schema.membershipKeys !== undefined) return new ExtensionMembershipKeysRefusedError(name, packageId);
  return undefined;
}

/**
 * [ADR-0029 D9.2a, 2026-10-30 note; ruling of record 6524229156, letter C′] A
 * tenant body carries a rule of the same `name` as a rule a code layer ships —
 * the owner's or an extension's — and changes more than its `message` and
 * `active`. A rule's identity within an object is its name, so the copy IS the
 * packaged rule: the tenant may reword it or switch it off, and its condition
 * and type belong to the package. Refused, never run beside the packaged rule
 * and never silently replaced by it.
 *
 * The ADR-0112 envelope (`code` + `status: 422`), never a bare throw.
 */
class ValidationRuleCopyRefusedError extends Error {
  readonly code = VALIDATION_RULE_COPY_REFUSED_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 422;
  /** The object whose rule copy was refused. */
  readonly objectName: string;
  /** The packaged rule the copy shares its name with. */
  readonly ruleName: string;
  /** Every key the copy changes from the packaged rule, `type` first. */
  readonly changedKeys: readonly string[];

  constructor(objectName: string, ruleName: string, changedKeys: readonly string[]) {
    const keys = changedKeys.map((k) => `\`${k}\``).join(', ');
    super(
      `Object "${objectName}": validation rule "${ruleName}" is a packaged rule, and this copy changes ` +
        `${keys}. On a packaged rule only \`message\` and \`active\` may be changed; its condition and ` +
        'type belong to the package. To change the condition, add a rule under a new name, or change it ' +
        'in the package.',
    );
    this.name = 'ValidationRuleCopyRefusedError';
    this.objectName = objectName;
    this.ruleName = ruleName;
    this.changedKeys = changedKeys;
  }
}

/**
 * [#16319] The registration-door field-`type` check — the single point of
 * closure the ruling names.
 *
 * Returns the refusal rather than throwing it, so a caller that has to DECIDE
 * something before the throw can ask the door's own question without growing a
 * second vocabulary. {@link SchemaRegistry.registerObject} throws what this
 * returns.
 *
 * The judgement itself is {@link findUndeclarableFieldType} in
 * `@objectstack/metadata-core`; this function only dresses its answer in the
 * ADR-0112 envelope, because the code belongs to the package that throws.
 */
export function objectFieldTypeRefusal(schema: unknown): ObjectFieldTypeRefusal | null {
  const violation = findUndeclarableFieldType(schema);
  return violation ? new ObjectFieldTypeRefusedError(violation) : null;
}

/**
 * [ADR-0142 D3, merge question 15] An object the platform injects `queue` on
 * (`ownership: 'user'`, the default tier) declared its own field named
 * `queue`.
 *
 * `owner_id`'s "the author's declaration wins" rule is deliberately not copied
 * here: a skipped anchor would leave every queue admission — the sitting-record
 * access path, the claim, the move, the assignment seam — silently
 * inapplicable on that object, because each of them reads the platform's
 * column by name and would read the author's business field instead. So the
 * declaration is refused with a prescription, at the door Studio and the
 * metadata API reach at request time. A body carrying the platform's own
 * definition (a served document coming back) is the platform's and passes.
 *
 * The ADR-0112 envelope (`code` + `status: 422`), never a bare throw.
 */
class ObjectQueueColumnRefusedError extends Error {
  readonly code = OBJECT_QUEUE_COLUMN_REFUSED_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 422;
  readonly objectName: string;
  readonly fieldName = QUEUE_FIELD;

  constructor(objectName: string) {
    super(
      `Object "${objectName}" declares a field named \`queue\`, which the platform reserves on an object ` +
        'whose records have a user owner (`ownership: \'user\'`, the default): it holds the ownership queue a ' +
        'record without an owner sits in, and the platform injects it. Rename the business field (for ' +
        'example `support_queue`), or, when the object\'s records have no user owner, declare ' +
        '`ownership: \'business_unit\'`, `\'org\'` or `\'none\'`.',
    );
    this.name = 'ObjectQueueColumnRefusedError';
    this.objectName = objectName;
  }
}

/**
 * [ADR-0142 D3] The registration-door `queue` check: the refusal when the
 * platform plans the `queue` column on this object and the body declares a
 * `queue` field that is not the platform's own definition; `null` otherwise.
 */
export function objectQueueColumnRefusal(schema: unknown): Error | null {
  if (!resolveInjectedSystemColumns(schema).queue) return null;
  if (injectedColumnProvenance(schema, QUEUE_FIELD) !== 'author') return null;
  const name = (schema as { name?: unknown })?.name;
  return new ObjectQueueColumnRefusedError(typeof name === 'string' ? name : '(unnamed)');
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
 *
 * [commit df657d9df] Carries the ADR-0112 envelope (`code` + `status`), like its sibling
 * {@link ArtifactObjectNameConflictError} below. Unlike that sibling, this
 * refusal IS reachable from a wire: `POST /api/v1/packages`
 * (`packages/runtime/src/domains/packages.ts`) calls `installPackage` with no
 * artifact scope — which this gate, unlike the D3 object-name one, does not
 * need — and the domain's terminal catch answers `errorFromThrown(e, 500)`.
 * `resolveThrownHttpError` reads `.status`/`.code` off the throw, so with no
 * envelope the door fell through to that `500` fallback. Measured on a booted
 * stack before this change: `500 INTERNAL_ERROR` carrying this refusal's prose,
 * which tells an operator "the server broke" when the truth is "your package's
 * namespace is already taken" — it invites a retry instead of a rename. With
 * the envelope the same door answers `422`. The message is unchanged: it was
 * already correct and specific.
 */
export class NamespaceConflictError extends Error {
  readonly code = NAMESPACE_CONFLICT_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 422;
  /** The namespace both packages claim. */
  readonly namespace: string;
  /** The installed package that already owns the namespace. */
  readonly existingPackageId: string;
  /** The package whose install this refusal stopped. */
  readonly incomingPackageId: string;

  constructor(namespace: string, existingPackageId: string, incomingPackageId: string) {
    super(
      `Namespace conflict: namespace "${namespace}" is already owned by ` +
        `package "${existingPackageId}", so package "${incomingPackageId}" ` +
        `cannot be installed alongside it. A namespace is the mandatory prefix ` +
        `of every object name (e.g. "${namespace}_account") and the container ` +
        `that scopes a package's UI metadata, so it must be unique per ` +
        `installation. Choose a different namespace for "${incomingPackageId}", ` +
        `or uninstall "${existingPackageId}" first. If "${incomingPackageId}" ` +
        `extends the app that holds this namespace, declare that app in its ` +
        `manifest.dependencies: a declared dependency co-owns the namespace ` +
        `(ADR-0141 D5). If this is a deliberate ` +
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
 * Raised when a package registers a position, permission set or capability
 * whose name another holder already holds — an installed package, the
 * environment catalog or a built-in (`security-catalog-namespace.ts` states the
 * rule, the holders, and what it deliberately does not judge).
 *
 * The namespace gate's sibling, in its shape: the ADR-0112 envelope (`code` +
 * `status: 422`) so a wire door answers `422`, never the `500` fallback, and
 * the code the namespace gate already registers — the condition is the same
 * one, "a name in a deployment-wide namespace is already taken", and so is the
 * caller's remedy: rename, or uninstall the other holder. ⛔ Not the namespace
 * gate's class: that one names a `manifest.namespace` and offers the
 * `OS_METADATA_COLLISION=warn` downgrade, neither of which is true here.
 *
 * Every conflict the registration carries is listed — `conflicts` — so one boot
 * reports all of them; the top-level fields repeat the first.
 *
 * `door: 'cold-boot'` is the same refusal raised by the engine plugin after
 * `sys_metadata` hydration ({@link findEnvironmentHeldSecurityCatalogNames}):
 * the packages registered first, so the message says which package declares
 * each name the environment catalog holds, and that the boot is what is refused.
 * The envelope is unchanged.
 */
export class SecurityCatalogNameConflictError extends Error {
  readonly code = NAMESPACE_CONFLICT_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 422;
  /** Every second holder this registration would have created, in declaration order. */
  readonly conflicts: readonly SecurityCatalogNameConflict[];
  /** The first conflict's catalog type. */
  readonly catalogType: SecurityCatalogType;
  /** The first conflict's name. */
  readonly catalogName: string;
  /** The package whose registration this refusal stopped. */
  readonly incomingPackageId: string;
  /** The first conflict's existing holder. */
  readonly existingHolder: SecurityCatalogHolder;

  constructor(conflicts: readonly SecurityCatalogNameConflict[], options: { door?: 'cold-boot' } = {}) {
    const [first] = conflicts;
    const lines = conflicts.map(
      (c) =>
        `${securityCatalogTypeLabel(c.catalogType)} "${c.name}" is already held by ` +
        describeSecurityCatalogHolder(c.existingHolder),
    );
    super(
      options.door === 'cold-boot'
        ? coldBootConflictMessage(conflicts)
        : `Security catalog name conflict: package "${first.incomingPackageId}" cannot register ` +
          `${conflicts.length === 1 ? 'a name' : `${conflicts.length} names`} another holder ` +
          `already holds — ${lines.join('; ')}. ${SECURITY_CATALOG_NAME_RULE} Under that rule ` +
          `"${first.incomingPackageId}" and each holder named here share one definition of the ` +
          `name, with nothing to tell two definitions of it apart, so with two holders which ` +
          `definition grants would depend on registration order. Rename the item in ` +
          `"${first.incomingPackageId}"${
            first.existingHolder.kind === 'package'
              ? `, rename it in "${first.existingHolder.packageId}", or uninstall one of the two packages`
              : first.existingHolder.kind === 'environment'
                ? ', or rename or delete the environment\'s item first'
                : ' — a built-in name is never available to a package'
          }. See ADR-0048.`,
    );
    this.name = 'SecurityCatalogNameConflictError';
    this.conflicts = conflicts;
    this.catalogType = first.catalogType;
    this.catalogName = first.name;
    this.incomingPackageId = first.incomingPackageId;
    this.existingHolder = first.existingHolder;
  }
}

/**
 * Raised when a package registers an item of a covered type (a picklist,
 * mapping, dataset, API or object-less action) or binds a function whose name
 * another package (or the platform) already holds — at managed install, at
 * package registration, at the hook binder's function bind, or, under
 * `BARE_NAME_COLD_BOOT_MODE = 'refuse'`, at the cold boot
 * (`bare-name-one-holder.ts` states the rule, the holders, the cold boot, and
 * what it deliberately does not judge).
 *
 * {@link SecurityCatalogNameConflictError}'s sibling, in its shape and for its
 * reason: the ADR-0112 envelope (`code` + `status: 422`) so a wire door answers
 * `422`, never the `500` fallback, and the code the namespace gate registers —
 * the condition is the same one, "a name in a deployment-wide namespace is
 * already taken", and so is the remedy: rename, or uninstall the other holder.
 *
 * Every conflict the registration carries is listed — `conflicts` — and each
 * names both holders and, when the incoming package declares a namespace, the
 * rename that clears it. The top-level fields repeat the first.
 */
export class BareNameConflictError extends Error {
  readonly code = NAMESPACE_CONFLICT_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads. */
  readonly httpStatus = 422;
  /** Every second holder this registration would have created, in declaration order. */
  readonly conflicts: readonly BareNameConflict[];
  /** The first conflict's type. */
  readonly itemType: BareNameOneHolderType;
  /** The first conflict's name. */
  readonly itemName: string;
  /** The package whose registration this refusal stopped. */
  readonly incomingPackageId: string;
  /** The first conflict's existing holder. */
  readonly existingHolder: BareNameHolder;

  constructor(conflicts: readonly BareNameConflict[], options: { door?: 'cold-boot' } = {}) {
    const [first] = conflicts;
    const remedy = first.existingHolder.kind === 'package'
      ? `Rename the item in "${first.incomingPackageId}"${first.rename ? ` (to "${first.rename}")` : ''}, ` +
        `rename it in "${first.existingHolder.packageId}", or uninstall one of the two packages.`
      : `Rename the item in "${first.incomingPackageId}"${first.rename ? ` (to "${first.rename}")` : ''} — ` +
        'a built-in name is never available to a package.';
    super(
      options.door === 'cold-boot'
        ? `Bare-name conflict at boot: ${conflicts.map(bareNameConflictLine).join('; ')}. ${bareNameReasonFor(conflicts)} ` +
          `The boot is refused. Rename the item in one of the packages, or uninstall one of them, then ` +
          `restart. See ADR-0048.`
        : `Bare-name conflict: package "${first.incomingPackageId}" cannot register ` +
          `${conflicts.length === 1 ? 'a name' : `${conflicts.length} names`} another holder already holds — ` +
          `${conflicts.map(bareNameConflictLine).join('; ')}. ${bareNameReasonFor(conflicts)} ${remedy} See ADR-0048.`,
    );
    this.name = 'BareNameConflictError';
    this.conflicts = conflicts;
    this.itemType = first.type;
    this.itemName = first.name;
    this.incomingPackageId = first.incomingPackageId;
    this.existingHolder = first.existingHolder;
  }
}

/**
 * The cold boot's half of the bare-name rule (`bare-name-one-holder.ts`, "The
 * cold boot"): seal the registry — from here on both doors refuse a new holder
 * at once — and act on every name two installed packages already hold, by
 * `mode`: `'warn'` logs {@link bareNameColdBootWarning} once and returns the
 * conflicts; `'refuse'` throws {@link BareNameConflictError} with
 * `door: 'cold-boot'`. The engine plugin calls it at `kernel:bootstrapped`,
 * once every package of the boot has registered.
 *
 * @throws {BareNameConflictError} under `'refuse'`, when any name is held twice.
 */
export function sealBareNameHoldersAtColdBoot(
  registry: SchemaRegistry,
  mode: BareNameColdBootMode,
  logger?: { warn(message: string, meta?: unknown): void },
): BareNameConflict[] {
  const conflicts = registry.sealBareNameHolders();
  if (conflicts.length === 0) return conflicts;
  if (mode === 'refuse') throw new BareNameConflictError(conflicts, { door: 'cold-boot' });
  logger?.warn(bareNameColdBootWarning(conflicts), {
    conflicts: conflicts.map((c) => ({
      type: c.type,
      name: c.name,
      holders: [c.existingHolder.kind === 'package' ? c.existingHolder.packageId : c.existingHolder.kind, c.incomingPackageId],
      ...(c.rename ? { rename: c.rename } : {}),
    })),
  });
  return conflicts;
}

/**
 * Raised when a package registers a record page as the default record page of
 * an object another page already holds — another package's page, an
 * environment's page, or a second page of the same manifest
 * (`default-record-page.ts` states the rule, the holders, and what is not a
 * second default).
 *
 * The ADR-0112 envelope (`code` + `status: 422`), the shape of its sibling
 * {@link SecurityCatalogNameConflictError}, so a wire door answers `422`, never
 * the `500` fallback. Its own code, not the namespace gate's: the condition is
 * not a name already taken but an object's one default slot already held, and
 * the remedy differs — keep one default (`isDefault: false` on the other), or
 * compose the deployment without the other package's page; renaming fixes
 * nothing. The remedy names the PAGE, not the package: a deployment can keep a
 * package and leave out the one page it ships (a page-level composition switch,
 * where that package offers one), and a package a host cannot leave out at all
 * still has a page it can. The sentence names no option and no package, so it
 * stays true whichever holder is on the other side.
 *
 * Every conflict the registration carries is listed — `conflicts` — so one boot
 * reports all of them; the top-level fields repeat the first.
 */
export class DefaultRecordPageConflictError extends Error {
  readonly code = DEFAULT_RECORD_PAGE_CONFLICT_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 422;
  /** Every second default this registration would have created, in declaration order. */
  readonly conflicts: readonly DefaultRecordPageConflict[];
  /** The first conflict's object. */
  readonly object: string;
  /** The first conflict's incoming page. */
  readonly incoming: DefaultRecordPageHolder;
  /** The first conflict's existing holder. */
  readonly existing: DefaultRecordPageHolder;

  constructor(conflicts: readonly DefaultRecordPageConflict[]) {
    const [first] = conflicts;
    const lines = conflicts.map(
      (c) =>
        c.app === undefined
          ? `${describeDefaultRecordPageHolder(c.incoming)} cannot be the default record page of object ` +
            `"${c.object}": ${describeDefaultRecordPageHolder(c.existing)} already is`
          : `${describeDefaultRecordPageHolder(c.incoming)} cannot be the record page of object ` +
            `"${c.object}" in app "${c.app}": ${describeDefaultRecordPageHolder(c.existing)} already is`,
    );
    const remedies: string[] = [];
    if (conflicts.some((c) => c.app === undefined)) {
      remedies.push(
        `Keep one default per object: set \`isDefault: false\` on one of the two pages, or compose the ` +
          `deployment without the other package's page. At most one \`isDefault: true\` record page may ` +
          `exist for an object in a deployment: the record view opens that page with no tie-break, so with ` +
          `two the page would be chosen by registration order.`,
      );
    }
    if (conflicts.some((c) => c.app !== undefined)) {
      remedies.push(
        `Keep one page per object per app: remove the app from \`apps\` on one of the two pages, or ` +
          `compose the deployment without the other package's page. At most one record page may name an ` +
          `app in \`apps\` for an object: that app's record view opens it with no tie-break, so with two ` +
          `the page would be chosen by registration order.`,
      );
    }
    super(`Default record page conflict: ${lines.join('; ')}. ${remedies.join(' ')}`);
    this.name = 'DefaultRecordPageConflictError';
    this.conflicts = conflicts;
    this.object = first.object;
    this.incoming = first.incoming;
    this.existing = first.existing;
  }
}

/**
 * Raised when a package registers a page declaring `isDefault: true` that is
 * not a record page bound to an object (maintainer ruling A on
 * objectstack#23610, record 6190536588). Nothing reads the flag there — an app
 * opens on its first navigation item and the root landing follows the app's
 * own `isDefault` — so the registry refuses it as the page parse does, with
 * the parse's own sentence (`misplacedDefaultPageRefusal`,
 * `@objectstack/spec/ui`). A package's pages reach the registry without a
 * parse, which is why this door needs its own throw.
 *
 * The ADR-0112 envelope (`code` + `status: 422`). Every misplaced page the
 * registration carries is listed — `pages` — so one boot reports all of them.
 */
export class MisplacedDefaultPageError extends Error {
  readonly code = MISPLACED_DEFAULT_PAGE_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 422;
  /** The package whose registration this refusal stopped. */
  readonly packageId: string | undefined;
  /** Every misplaced page, in declaration order. */
  readonly pages: readonly MisplacedDefaultPage[];

  constructor(packageId: string | undefined, pages: readonly MisplacedDefaultPage[]) {
    const owner = packageId === undefined ? 'a package' : `package "${packageId}"`;
    super(
      pages
        .map(({ page, refusal }) => `Page "${page ?? '(unnamed)'}" of ${owner}: ${refusal}`)
        .join(' '),
    );
    this.name = 'MisplacedDefaultPageError';
    this.packageId = packageId;
    this.pages = pages;
  }
}

/**
 * Every package-held position, permission-set and capability name the environment catalog
 * also holds, read off `registry` — the conflicts the engine plugin's cold-boot
 * check refuses the boot with (`ObjectQLPlugin`, right after `sys_metadata`
 * hydration; the reading itself is the registry's private
 * `environmentHeldSecurityCatalogConflicts`, documented there).
 *
 * A module-level function rather than a public method so the reading stays off
 * the public surface: `index.ts` and `core.ts` re-export named lists from this
 * module, and this name is on neither.
 */
export function findEnvironmentHeldSecurityCatalogNames(registry: SchemaRegistry): SecurityCatalogNameConflict[] {
  return registry['environmentHeldSecurityCatalogConflicts']();
}

/**
 * Every position, permission-set and capability name a package holds, with the packages
 * that hold it, read off `registry` — the PACKAGE half of the reading the
 * cold-boot check refuses with ({@link findEnvironmentHeldSecurityCatalogNames}
 * is this list met with the environment catalog's bare slot, and nothing else).
 *
 * Public for the one consumer that has the other half somewhere the registry
 * does not: `os migrate security-catalog-overlays` (`@objectstack/cli`) boots
 * the deployment's composition with `sys_metadata` hydration off, so the cold
 * boot's environment half is empty there, and meets this list with the stored
 * rows instead (maintainer ruling letter B on #22371, record 6074838935: one
 * reading of "who holds a name", never a second one beside the cold boot's).
 *
 * The rule each entry obeys is the cold boot's, because it is the same private
 * reading: a package holds a name through an item registered under it (its
 * composite slot) or its install claim, never through the bare slot; only the
 * types the environment catalog can hold are read; built-in names are skipped.
 * Sorted by type (positions first), then name, as the cold-boot refusal lists
 * its conflicts. Read-only: it records nothing.
 */
export function findPackageHeldSecurityCatalogNames(
  registry: SchemaRegistry,
): Array<{ readonly catalogType: SecurityCatalogType; readonly name: string; readonly packageIds: readonly string[] }> {
  return registry['packageHeldSecurityCatalogNames']();
}

export class ArtifactObjectNameConflictError extends Error {
  readonly code = DUPLICATE_ARTIFACT_OBJECT_NAME_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 422;
  /** The object name both packages claim. */
  readonly objectName: string;
  /** The co-owning package that already owns the name. */
  readonly existingPackageId: string;
  /** The package whose install this refusal stopped. */
  readonly incomingPackageId: string;
  /** Why the two packages co-own the namespace — the message is worded for it (ADR-0141 D5). */
  readonly coOwnership: CoOwnershipSource;

  constructor(
    objectName: string,
    existingPackageId: string,
    incomingPackageId: string,
    coOwnership: CoOwnershipSource = 'artifact',
  ) {
    const { conflict, relation, allowed } = CO_OWNERSHIP_WORDING[coOwnership];
    super(
      `Object name conflict ${conflict}: object "${objectName}" is ` +
        `already owned by package "${existingPackageId}", so package ` +
        `"${incomingPackageId}" — ${relation} — cannot define it ` +
        `too. Two packages defining one object name map to one physical table: the ` +
        `install would either fail at the DB with a duplicate CREATE TABLE or, ` +
        `driver-dependent, let one definition silently overwrite the other. Rename ` +
        `the object in "${incomingPackageId}", or have it \`extend\` ` +
        `"${existingPackageId}"'s object instead of owning a second one. ${allowed}; ` +
        `sharing an object NAME is not (ADR-0130 D3).`,
    );
    this.name = 'ArtifactObjectNameConflictError';
    this.objectName = objectName;
    this.existingPackageId = existingPackageId;
    this.incomingPackageId = incomingPackageId;
    this.coOwnership = coOwnership;
  }
}

/**
 * [ADR-0150 D6, child K] Raised when an install would put a namespace and an
 * object name on the same string, in either direction, or ships an object
 * short-named `custom` (`NS_custom`, the namespace the ADR-0146 paired package
 * of `NS` takes). The predicate is the spec's one
 * (`findNamespaceObjectNameClashes`, `kernel/namespace-prefix.ts`); every door
 * that admits an object or a namespace asks it, and each clash's sentence
 * names both spellings.
 *
 * Same envelope and code as {@link NamespaceNameConflictError}: `code:
 * 'NAMESPACE_CONFLICT'`, `status: 422` — the condition is "a name the
 * namespace position reads is already taken", and the remedy is a rename. No
 * code is minted. Every clash is listed (red line 2); the top-level fields
 * repeat the first.
 */
export class NamespaceObjectNameConflictError extends Error {
  readonly code = NAMESPACE_CONFLICT_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads. */
  readonly httpStatus = 422;
  /** Every clash, in the predicate's order. */
  readonly clashes: readonly NamespaceObjectNameClash[];
  /** The first clash's namespace. */
  readonly namespace: string;
  /** The first clash's object name. */
  readonly objectName: string;
  /** The package whose install this refusal stopped. */
  readonly incomingPackageId: string;

  constructor(clashes: readonly NamespaceObjectNameClash[], incomingPackageId: string) {
    const [first] = clashes;
    super(clashes.map((c) => c.message).join(' '));
    this.name = 'NamespaceObjectNameConflictError';
    this.clashes = clashes;
    this.namespace = first.namespace;
    this.objectName = first.objectName;
    this.incomingPackageId = incomingPackageId;
  }
}

/**
 * [ADR-0150 D5, child G1] Raised when a package declares a namespace that
 * spells a literal segment of the REST address grammar (`trigger`, `hooks`,
 * `global`, … — `NAMESPACE_REFUSED_LITERALS`, `spec/kernel/address-grammar.ts`).
 * The router reads a literal before any namespace, so every qualified address
 * of such a package (`/automation/trigger/<name>` read as the trigger door,
 * not the namespace `trigger`) would reach something else. The sentence is the
 * spec's (`validateNamespaceNotAddressLiteral`), naming the literal and the
 * doors that serve it.
 *
 * Same envelope and code as {@link NamespaceObjectNameConflictError}: `code:
 * 'NAMESPACE_CONFLICT'`, `status: 422` — the namespace position already reads
 * this string as something else, and the remedy is a rename. No code is minted.
 */
export class NamespaceAddressLiteralError extends Error {
  readonly code = NAMESPACE_CONFLICT_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads. */
  readonly httpStatus = 422;
  /** The namespace the package declared. */
  readonly namespace: string;
  /** The package whose install this refusal stopped. */
  readonly incomingPackageId: string;

  constructor(namespace: string, message: string, incomingPackageId: string) {
    super(`Package '${incomingPackageId}': ${message}`);
    this.name = 'NamespaceAddressLiteralError';
    this.namespace = namespace;
    this.incomingPackageId = incomingPackageId;
  }
}

/**
 * [ADR-0150 D2, child N] Raised when a package declares an item of one of the
 * twelve uncovered bucket 2/3 types — sharing rule, queue, assignment rule,
 * hook, job, app, page, dashboard, report, book, analytics cube, tool — under a
 * name another package of its namespace already holds, at the package door
 * (`namespace-co-owner-names.ts` states the rule, the holders and what it does
 * not judge). `os validate` prints the same sentence for the same predicate.
 *
 * {@link ArtifactObjectNameConflictError}'s sibling in placement — it sits
 * right after the ADR-0130 D3 object check, ahead of every mutation — and
 * {@link BareNameConflictError}'s in its envelope and code: `code:
 * 'NAMESPACE_CONFLICT'`, `status: 422`, because the condition is the one the
 * namespace gate registers that code for, "a name in a namespace is already
 * taken", and so is the remedy: rename, or leave one package out. No code is
 * minted.
 *
 * Every conflict the install carries is listed — `conflicts` — and each names
 * EVERY package of the namespace that already holds the name (red line 2:
 * ambiguity is reported, never guessed). The top-level fields repeat the first.
 */
export class NamespaceNameConflictError extends Error {
  readonly code = NAMESPACE_CONFLICT_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads. */
  readonly httpStatus = 422;
  /** Every `(type, name)` this install would have held twice inside its namespace, in declaration order. */
  readonly conflicts: readonly NamespaceNameConflict[];
  /** The namespace. */
  readonly namespace: string;
  /** The first conflict's type. */
  readonly itemType: NamespaceUniqueType;
  /** The first conflict's name. */
  readonly itemName: string;
  /** The package whose install this refusal stopped. */
  readonly incomingPackageId: string;
  /** The first conflict's existing holders, every one of them. */
  readonly existingPackageIds: readonly string[];

  constructor(conflicts: readonly NamespaceNameConflict[]) {
    const [first] = conflicts;
    super(namespaceNameConflictMessage(conflicts));
    this.name = 'NamespaceNameConflictError';
    this.conflicts = conflicts;
    this.namespace = first.namespace;
    this.itemType = first.type;
    this.itemName = first.name;
    this.incomingPackageId = first.incomingPackageId;
    this.existingPackageIds = first.existingPackageIds;
  }
}

/**
 * [ADR-0029 D3] The cross-package ownership refusal: a package claims `own`
 * on an object name that a DIFFERENT package already owns. Raised by
 * {@link SchemaRegistry.registerObject} — the single-owner-per-object-name
 * invariant, enforced at the one choke point every registration path goes
 * through (the manifest load path via `ObjectQL.registerApp`, the metadata
 * bridge, the `sys_metadata` hydration seams). The remedy the message names is
 * the supported one: `extend` merges fields into the owner's definition instead
 * of claiming a second owner.
 *
 * Carries the ADR-0112 envelope (`code` + `status`) — the shape this
 * repository's rejection tests assert against, never a bare throw. Before it
 * carried one, this refusal was a bare `Error`, and a throw-shaped assertion
 * on the install-time `DUPLICATE_ARTIFACT_OBJECT_NAME` check one layer up
 * stayed green with that check ablated: this refusal fired one step later and
 * was indistinguishable to `toThrow()` (#14367). Only an envelope assertion
 * can tell the two refusals apart, and only if both carry one.
 *
 * The message text is byte-for-byte what the bare `Error` carried, so every
 * message-substring assertion and every forwarder that interpolates it into a
 * `console.warn` or a per-record `errors` count reads exactly what it read
 * before. The two package ids are typed as the contributor stores them
 * (`ObjectContributor.packageId` is `string | undefined`, #12623) rather than
 * narrowed, so the message stays identical on a package-less call too.
 *
 * ⛔ Not the ADR-0029 D9 §6.1 late-install branch beside it: a TENANT-authored
 * sitting owner is re-classified as the code package's overlay layer, and
 * nothing is refused there.
 */
export class ObjectOwnershipConflictError extends Error {
  readonly code = OBJECT_OWNERSHIP_CONFLICT_CODE;
  readonly status = 422;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 422;
  /** The fully-qualified object name both packages claim. */
  readonly objectName: string;
  /** The package that already owns the name. */
  readonly existingPackageId: string | undefined;
  /** The package whose `own` claim this refusal stopped. */
  readonly incomingPackageId: string | undefined;

  constructor(
    objectName: string,
    existingPackageId: string | undefined,
    incomingPackageId: string | undefined,
  ) {
    super(
      `Object "${objectName}" is already owned by package "${existingPackageId}". ` +
      `Package "${incomingPackageId}" cannot claim ownership. Use 'extend' to add fields.`
    );
    this.name = 'ObjectOwnershipConflictError';
    this.objectName = objectName;
    this.existingPackageId = existingPackageId;
    this.incomingPackageId = incomingPackageId;
  }
}

/**
 * [#23505] The uninstall refusal of ADR-0029: a package cannot leave while
 * another package `extend`s an object it owns (a manifest's
 * `objectExtensions`, registered by `ObjectQL.registerApp`). Raised by
 * {@link SchemaRegistry.assertPackageUninstallable}, and so by
 * {@link SchemaRegistry.unregisterObjectsByPackage} and
 * {@link SchemaRegistry.uninstallPackage}, which ask it.
 *
 * Carries the ADR-0112 envelope (`code` + `status`), like the registry's other
 * refusals above. Before it carried one, this was a bare `Error`, and
 * `DELETE /api/v1/packages/:id` — which reaches it through `deletePackage`'s
 * pre-flight, or through `uninstallPackage` on a host with no persisted half —
 * fell through `resolveThrownHttpError` to the door's `500` fallback: measured
 * on the real stack as `500 INTERNAL_ERROR`, which tells a client, an AI author
 * or an operator that the server failed, invites a retry, and changes nothing.
 * The state is the caller's to change: uninstall the extending packages first.
 *
 * `RESOURCE_CONFLICT` / 409, no code minted: the standard catalog's member for
 * a refusal that comes from environment state rather than the request (the
 * same uninstall is accepted once the extenders are gone), as the uninstall
 * verb's sibling refusals in `@objectstack/metadata-protocol` answer. The
 * prescription comes first, because a 4xx message can be truncated at a REST
 * boundary; the diagnostic sentence the refusal always carried follows it.
 *
 * Every extended object is named (the first {@link EXTENDED_OBJECTS_LISTED},
 * then a count), in the order the registry walks them, each with its extenders
 * in registration order — and the prescription names every extending package,
 * so one answer is the whole way out rather than the first step of several.
 *
 * [#28408, ADR-0146 D3] …and the uninstall refusal of a base whose paired
 * customization package is installed and named for it: the App's pair of an
 * App, or the per-package pair an earlier version created for a package
 * ({@link pairsOf}), held by this registry. That package
 * holds every customization of the base, so uninstalling the base under it
 * would strand them all, with nothing serving them and nothing saying why.
 * ADR-0146 puts this refusal in this family and this shape, so it is this
 * class rather than a sibling: one refusal, decided by the same method and
 * raised at the same doors. When both causes hold, the ONE refusal carries
 * both, and its prescription is the whole way out — uninstall the extenders
 * and delete the pair. The pair is named by id, with the way to keep what it
 * holds before it is deleted: its own export door. The class keeps its name
 * because ADR-0141 and ADR-0146 cite it as the anchor of this family.
 *
 * ⛔ Unexported, like its siblings: a consumer compares `code`, never
 * `instanceof` (see the note over the `*_CODE` constants).
 */
class PackageUninstallExtendedError extends Error {
  readonly code = 'RESOURCE_CONFLICT';
  readonly status = 409;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 409;
  /** The package whose uninstall this refusal stopped. */
  readonly packageId: string;
  /** Every object of `packageId` another package extends, in walk order. */
  readonly extendedObjects: readonly ExtendedObjectOfUninstall[];
  /** Every extending package, once each, in the order the objects name them. */
  readonly extenders: readonly string[];
  /**
   * [#28408, ADR-0146 D3] The base's paired customization package, when this
   * registry holds it — `undefined` when that is not a cause of this refusal.
   */
  readonly customizationPackageId: string | undefined;

  constructor(
    packageId: string,
    extendedObjects: readonly ExtendedObjectOfUninstall[],
    customizationPackage?: string,
  ) {
    const extenders = [...new Set(extendedObjects.flatMap((o) => o.extenders))];
    const listed = extendedObjects
      .slice(0, EXTENDED_OBJECTS_LISTED)
      .map((o) => `object "${o.objectName}" is extended by ${o.extenders.join(', ')}`);
    const more = extendedObjects.length - listed.length;
    const extendersStep = extendedObjects.length === 0 ? undefined :
      `the ${extenders.length === 1 ? 'package that extends' : 'packages that extend'} ` +
      `${extendedObjects.length === 1 ? 'an object' : 'objects'} of "${packageId}"`;
    const extendersFact = extendedObjects.length === 0 ? undefined :
      `${listed.join('; ')}${more > 0 ? `; and ${more} more extended object${more === 1 ? '' : 's'}` : ''}`;
    // The pair's step names its own export door, so "export it or delete it"
    // is one instruction: export to keep what it holds, then delete it.
    const pairStep = customizationPackage === undefined ? undefined :
      `the customization package "${customizationPackage}" first (to keep its customizations, export it ` +
      `before that: GET /api/v1/packages/${customizationPackage}/export)`;
    const extendersReason = 'a package cannot be uninstalled while another package extends an object it owns ' +
      '(objectExtensions, ADR-0029)';
    const pairReason = 'while its paired customization package is installed, which would strand every ' +
      'customization it holds (ADR-0146 D3)';
    super(
      extendersStep !== undefined && pairStep !== undefined
        ? `Uninstall ${extendersStep} (${extenders.join(', ')}) and delete ${pairStep}, then uninstall ` +
          `"${packageId}" again: ${extendersReason}, nor ${pairReason}. Cannot uninstall package ` +
          `"${packageId}": ${extendersFact}; and its customization package "${customizationPackage}" is installed.`
        : pairStep !== undefined
          ? `Delete ${pairStep}, then uninstall "${packageId}" again: a package cannot be uninstalled ` +
            `${pairReason}. Cannot uninstall package "${packageId}": its customization package ` +
            `"${customizationPackage}" is installed.`
          : `Uninstall ${extendersStep} first (${extenders.join(', ')}), then uninstall "${packageId}" again: ` +
            `${extendersReason}. Cannot uninstall package "${packageId}": ${extendersFact}.`,
    );
    this.name = 'PackageUninstallExtendedError';
    this.packageId = packageId;
    this.extendedObjects = extendedObjects;
    this.extenders = extenders;
    this.customizationPackageId = customizationPackage;
  }
}

// [commit fa5d137ab] `isTenantAuthored` and `isCodeArtifactBody` used to be defined here.
// They now live in `@objectstack/metadata-core`
// (`code-artifact-provenance.ts`), imported at the top of this file and
// re-exported immediately below, so every caller's spelling — including
// `@objectstack/objectql`'s own public export — is unchanged. Their full
// rationale moved with them.
export { isCodeArtifactBody };

// ============================================================================
// i18n bundles — metadata types whose identity is (name, <discriminator>)
// ============================================================================

/**
 * [#7730] Metadata types whose IDENTITY is a pair, not a name.
 *
 * `registerItem` keys every item by `name` (composite `<packageId>:<name>` when
 * a package ships it). For most types that IS the identity. `email_template`
 * declares otherwise — see the table's own TSDoc for the schema clause it
 * enforces and for why the discriminator is declared per type.
 *
 * [#7774] The table itself now lives in `@objectstack/metadata-core` and is
 * re-exported here unchanged. It moved because this registry is not the only
 * layer that keys metadata by name: `@objectstack/metadata-protocol`'s
 * unscoped `/meta/<type>` list merge keys by `(package, name)` too, and a
 * bundle that survives registration only to collapse in that merge is still
 * collapsed. objectql depends on metadata-protocol, so the protocol package
 * cannot import from here; metadata-core is the package both already depend
 * on. The re-export is deliberate and load-bearing —
 * `registry-i18n-bundle-key.test.ts` imports `ITEM_KEY_DISCRIMINATORS` from
 * this module by name.
 *
 * The storage-key FORMAT below ({@link BUNDLE_KEY_SEPARATOR},
 * {@link withDiscriminator}, {@link bundleBaseKey}, {@link collectBundle})
 * stayed here on purpose: it encodes a discriminator into THIS registry's
 * `<packageId>:<name>` Map keys, which no other package reads or writes.
 */
export { ITEM_KEY_DISCRIMINATORS };

/**
 * [#28697] The undo record of one registration run under
 * {@link SchemaRegistry.restoringOnRefusal}: for each registry entry the run
 * writes, the way to put back what the entry held just before the run's FIRST
 * write to it. An entry the run never writes is never recorded, so a restore
 * puts back exactly the entries the run touched and nothing else — another
 * package's entries and a tenant's layers are left as they are.
 *
 * It also holds what the run REGISTERED: each object layer, as its
 * registration's doors judged it, so the run's end can ask of the whole unit
 * the one question no single registration can
 * ({@link SchemaRegistry.restoringOnRefusal}).
 */
class RegistrationRestorePoint {
  private readonly touched = new Set<string>();
  private readonly undo: Array<{ readonly key: string; readonly putBack: () => void }> = [];
  private readonly registered = new Map<string, RunRegisteredObject>();

  /**
   * Record `key` before its first write in this run. `capture` reads the
   * entry as it is now and returns how to put it back.
   */
  note(key: string, capture: () => () => void): void {
    if (this.touched.has(key)) return;
    this.touched.add(key);
    this.undo.push({ key, putBack: capture() });
  }

  /**
   * Record an object layer the run registered, under the slot it fills (one
   * owner and one overlay per object, one extension per package): a layer the
   * run registers again replaces the one it registered before, as it does in
   * the registry.
   */
  noteRegisteredObject(slot: string, layer: RunRegisteredObject): void {
    const earlier = this.registered.get(slot);
    this.registered.delete(slot);
    this.registered.set(slot, earlier === undefined ? layer : { ...layer, replaced: earlier.replaced });
  }

  /** The object layers the run registered, in registration order. */
  registeredObjects(): RunRegisteredObject[] {
    return [...this.registered.values()];
  }

  /**
   * Take over a nested run that ended without a refusal: its entries become
   * this run's, so a refusal later in this run puts them back too. An entry
   * this run wrote first keeps this run's record of it (what it held before
   * the outer run), and what remains is exactly what one run recording every
   * write of both would hold, in the same order.
   */
  adopt(nested: RegistrationRestorePoint): void {
    for (const entry of nested.undo) {
      if (this.touched.has(entry.key)) continue;
      this.touched.add(entry.key);
      this.undo.push(entry);
    }
    for (const [slot, layer] of nested.registered) this.noteRegisteredObject(slot, layer);
  }

  /** Put every recorded entry back, the last one written first. */
  restore(): void {
    for (let i = this.undo.length - 1; i >= 0; i--) this.undo[i].putBack();
  }
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

  /**
   * [ADR-0131 D7] The objects THIS deployment declares platform-global — the
   * #12699 declaration made total: each one gets NO organization column here.
   *
   * Empty until the engine plugin installs the deployment's validated reading
   * ({@link setDeploymentPlatformGlobalObjects}), which it does at `start()`,
   * before the first schema sync. See that method for the ordering.
   */
  private deploymentPlatformGlobalObjects: ReadonlySet<string> = new Set<string>();

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
    // [#33949 codemod] The body moved to `registry-storage.ts` (see `StorageHost`).
    return StorageFacet.log.call(storageHost.of(this), msg);
  }

  private warn(msg: string): void {
    // [#33949 codemod] The body moved to `registry-storage.ts`, its docblock with it (see `StorageHost`).
    return StorageFacet.warn.call(storageHost.of(this), msg);
  }

  private debug(msg: string): void {
    // [#33949 codemod] The body moved to `registry-storage.ts`, its docblock with it (see `StorageHost`).
    return StorageFacet.debug.call(storageHost.of(this), msg);
  }

  // ==========================================
  // Object-specific storage (Ownership Model)
  // ==========================================

  /** FQN → Contributor[] (all packages that own/extend this object) */
  private objectContributors = new Map<string, ObjectContributor[]>();

  /**
   * [#10945] Short name → the `objectContributors` KEYS registered under it, in
   * that map's own insertion order.
   *
   * The reverse of `objectContributors`, which is keyed by FQN. Without it
   * {@link resolveObjectKey} answered the short-name direction by scanning
   * EVERY key and calling {@link parseFQN} on each — a full registry walk per
   * lookup, from seven call sites including {@link getObject}. A boot that
   * registers N objects and resolves O(N) names therefore did O(N²) string
   * work, measured at exponent ≈1.89 with `parseFQN` the largest non-database
   * entry in the CPU profile: 80ms of registry-scan self time at 1,000 stored
   * metadata rows, 2,325ms at 8,000. That is the mechanism behind a hosted
   * environment whose bootstrap outgrew its request waiter and became
   * permanently unservable with no error anywhere — boot got slower purely by
   * the environment being used.
   *
   * Two properties this index must not quietly change, both pinned in
   * `registry-shortname-index.test.ts`:
   *
   * 1. **A lookup does not depend on registration order.** It resolves to the
   *    same FQN whichever order the contributors arrived in — and where a short
   *    name is genuinely ambiguous, to the FIRST key registered under it,
   *    exactly as the scan's `matches[0]` did. That is why the value is an
   *    ORDERED ARRAY appended to by {@link openObjectEntry} in lockstep with
   *    `objectContributors.set`, and not a bare last-writer-wins entry.
   * 2. **The two maps move together.** They are mutated only through
   *    {@link openObjectEntry} / {@link closeObjectEntry}, so the read path and
   *    the name-addressed removal path cannot come to disagree about which
   *    contributor a bare name addresses — the #6808 contract restated at
   *    {@link resolveObjectKey}, and a second index is exactly where it could
   *    drift.
   */
  private objectKeysByShortName = new Map<string, string[]>();

  private openObjectEntry(fqn: string): ObjectContributor[] {
    // [#33949 codemod] The body moved to `registry-storage.ts`, its docblock with it (see `StorageHost`).
    return StorageFacet.openObjectEntry.call(storageHost.of(this), fqn);
  }

  private closeObjectEntry(fqn: string): void {
    // [#33949 codemod] The body moved to `registry-storage.ts`, its docblock with it (see `StorageHost`).
    return StorageFacet.closeObjectEntry.call(storageHost.of(this), fqn);
  }

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

  /**
   * [#34206, ADR-0156 D2] Moved by every call to a public method that can
   * change what this registry answers: items, objects, packages and their
   * enablement, navigation contributions, namespaces, claims. Compared,
   * never interpreted. The classification of the public surface, and why it
   * is not a list of bump sites, is in `registry-revision.ts`.
   */
  get revision(): number {
    return schemaRegistryRevisionOf(this);
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
   * `picklistExtensions` — the options other packages ADD to a picklist,
   * keyed `target picklist → declaring package → value → option`.
   *
   * Keyed by package so a re-registration of the same package (a manifest
   * replay, an HMR rebuild) replaces its own contribution instead of
   * colliding with it, while a value two DIFFERENT contributors declare is
   * refused ({@link registerPicklistExtension}). The owning list itself lives
   * in the generic item store under type `picklist`, like every other kind.
   */
  private picklistExtensionContributions = new Map<string, Map<string, { packageId: string | undefined; options: Map<string, PicklistOptionLike> }>>();

  /**
   * Package ids that must be installed in a DISABLED state **when they have no
   * row yet**. Seeded once at boot (from persisted state) BEFORE any package
   * registration so that every registration path — boot artifact, marketplace
   * rehydrate, local import — honors persisted disable state uniformly without
   * a fragile post-boot re-application hook.
   *
   * ⚠️ [#18877] It is a BOOT HYDRATION input, not a standing verdict: nothing
   * updates it after the seed, so once a row exists the row is the truth and
   * this set is not consulted. Reading it on every install is what let a
   * flag-absent re-install durably revert an operator's later `enable`.
   *
   * See {@link setInitialDisabledPackageIds}, {@link installPackage} and
   * {@link uninstallPackage} (which forgets the id with the row).
   */
  private initialDisabledPackageIds = new Set<string>();

  /**
   * Seed the set of package ids that should be installed disabled. Call this
   * before package registration begins; the FIRST `installPackage` call for
   * each of these ids lands it in the `disabled` state, and every later call
   * for that id reads the row it created instead (#18877). Replaces any
   * previously seeded set.
   */
  setInitialDisabledPackageIds(ids: Iterable<string>): void {
    // [#33949 codemod] The body moved to `registry-storage.ts` (see `StorageHost`).
    return StorageFacet.setInitialDisabledPackageIds.call(storageHost.of(this), ids);
  }

  /** See {@link onPackageUninstalled}. */
  private packageUninstalledListeners = new Set<(packageId: string) => void>();

  /** See {@link onPackageEnabled}. */
  private packageEnabledListeners = new Set<(packageId: string) => void>();

  /**
   * [#30377] Be told that {@link enablePackage} has switched a DISABLED package
   * back on, after its served folds are dropped: never for an enable of a
   * package that was already enabled (`enableOnInstall: true` on a fresh
   * install). Returns the unsubscribe.
   *
   * For state derived from what a disable withholds, so it is brought current
   * on every enable door at once (`PATCH /packages/:id/enable`, an install's
   * `enableOnInstall`, the protocol's install), never per door. The engine is
   * the one today: a roll-up `summary` a package contributes by extension is
   * withheld with its package, so the child writes made during the disable
   * recompute nothing, and the engine recomputes it on enable.
   */
  onPackageEnabled(listener: (packageId: string) => void): () => void {
    // [#33949 codemod] The body moved to `registry-storage.ts` (see `StorageHost`).
    return StorageFacet.onPackageEnabled.call(storageHost.of(this), listener);
  }

  private announcePackageEnabled(id: string): void {
    // [#33949 codemod] The body moved to `registry-storage.ts`, its docblock with it (see `StorageHost`).
    return StorageFacet.announcePackageEnabled.call(storageHost.of(this), id);
  }

  /**
   * [#30215] Be told, once per package, that {@link uninstallPackage} has
   * withdrawn it — after its record is gone, never for a refused uninstall
   * (that one removes nothing). Returns the unsubscribe.
   *
   * For a holder of state keyed by package id OUTSIDE this registry, so it is
   * withdrawn on every uninstall door at once (the protocol's `deletePackage`,
   * `DELETE /packages/:id`, the install-local DELETE), never per door. The
   * engine is the one today: its manifest map (`registerApp` → `manifests`) is
   * the code-package signal ADR-0070's `isWritablePackage` reads first, and an
   * id left in it kept an uninstalled package read-only until a restart.
   */
  onPackageUninstalled(listener: (packageId: string) => void): () => void {
    // [#33949 codemod] The body moved to `registry-storage.ts` (see `StorageHost`).
    return StorageFacet.onPackageUninstalled.call(storageHost.of(this), listener);
  }

  private announcePackageUninstalled(id: string): void {
    // [#33949 codemod] The body moved to `registry-storage.ts`, its docblock with it (see `StorageHost`).
    return StorageFacet.announcePackageUninstalled.call(storageHost.of(this), id);
  }

  // ==========================================
  // Restore on refusal
  // ==========================================

  /** The open {@link RegistrationRestorePoint}, while {@link restoringOnRefusal} runs. */
  private restorePoint: RegistrationRestorePoint | undefined;

  /**
   * [#28697] Run `register` — one registration made of several registry
   * writes, such as an upgrade of an installed package — and, when it throws,
   * put back exactly the entries it wrote, then throw the same error.
   *
   * Every refusal a verb below raises keeps its code and words; this decides
   * only what is left afterwards, wherever in the run the refusal came from:
   * the entries as they were before the run.
   *
   * What is recorded, each entry before the run's first write to it: an
   * object's contributor list (an `extend` or overlay layer of another package
   * or a tenant sits in it and is put back unchanged), a namespace's owners,
   * an item slot (the package record included), this package's picklist
   * extension of one list, the security catalog and default record page
   * claims the package door records, each app's navigation contributions, and
   * every entry outside the registry a caller records through
   * {@link recordRestoreOnRefusal}. Nothing the run does not write is
   * recorded or put back. After a restore every merged object is
   * re-resolved, since a fold computed during the run may have read an entry
   * the restore put back.
   *
   * ⛔ Not a way back from an operator's verb: {@link uninstallPackage},
   * {@link unregisterObject} and the overlay removals are never journaled.
   * Synchronous by contract: `register` must not return a promise, so no
   * other caller's write can land between the run's writes and its restore.
   *
   * A nested call is part of the run that is already open: the engine's
   * `manifest` service registers every package of one artifact (and its
   * residual) in ONE run, so a refusal of any of them puts back all of them.
   * The nested run puts back its own writes first and throws; when nothing in
   * the open run catches that, the open run puts back the rest, so what is
   * left is the same. A caller that does catch it (a reload skipping one
   * package it could not re-register) goes on with the open run as it stood
   * before that package. A nested run that ends without a refusal hands its
   * record to the open run.
   *
   * [ADR-0144 D2 and D6, amended] Once the cold boot has sealed the registry,
   * the OUTERMOST run ends by asking the record-currency follow door of every
   * object layer it registered, against the registry the whole run leaves
   * ({@link recordCurrencyFollowRefusalOfRun}). A refusal is thrown from
   * inside the run, so the run is put back like any other refused one. A
   * nested run never asks: its unit is smaller than the unit being
   * registered, and a pair a later member completes would be refused.
   */
  restoringOnRefusal<T>(register: () => T): T {
    // [#33949 codemod] The body moved to `registry-restore.ts` (see `RestoreHost`).
    return (RestoreFacet.restoringOnRefusal<T>).call(restoreHost.of(this), register);
  }

  private recordCurrencyFollowRefusalOfRun(point: RegistrationRestorePoint): Error | undefined {
    // [#33949 codemod] The body moved to `registry-restore.ts`, its docblock with it (see `RestoreHost`).
    return RestoreFacet.recordCurrencyFollowRefusalOfRun.call(restoreHost.of(this), point);
  }

  private followRefusalAsServed(
    refusal: RecordCurrencyFollowRefusedError,
    schema: ServiceObject,
    ownership: ObjectOwnership,
    layer: FollowDoorLayer,
    all: readonly ServiceObject[],
  ): RecordCurrencyFollowRefusedError {
    // [#33949 codemod] The body moved to `registry-restore.ts`, its docblock with it (see `RestoreHost`).
    return RestoreFacet.followRefusalAsServed.call(restoreHost.of(this), refusal, schema, ownership, layer, all);
  }

  /**
   * Record an entry that lives OUTSIDE this registry — an engine map a package
   * body writes beside the registry (its manifest, its datasource definitions)
   * — before the open {@link restoringOnRefusal} run's first write to it, so a
   * refusal later in the same run puts it back with the registry's own
   * entries. `capture` reads the entry as it is now and returns how to put it
   * back; it is called once per `key` per run. Outside a run it records
   * nothing, as the registry's own entries are not recorded either.
   */
  recordRestoreOnRefusal(key: string, capture: () => () => void): void {
    // [#33949 codemod] The body moved to `registry-restore.ts` (see `RestoreHost`).
    return RestoreFacet.recordRestoreOnRefusal.call(restoreHost.of(this), key, capture);
  }

  private noteAppNavContributions(app: string): void {
    // [#33949 codemod] The body moved to `registry-restore.ts`, its docblock with it (see `RestoreHost`).
    return RestoreFacet.noteAppNavContributions.call(restoreHost.of(this), app);
  }

  private noteObjectEntry(fqn: string): void {
    // [#33949 codemod] The body moved to `registry-restore.ts`, its docblock with it (see `RestoreHost`).
    return RestoreFacet.noteObjectEntry.call(restoreHost.of(this), fqn);
  }

  private noteNamespace(namespace: string): void {
    // [#33949 codemod] The body moved to `registry-restore.ts`, its docblock with it (see `RestoreHost`).
    return RestoreFacet.noteNamespace.call(restoreHost.of(this), namespace);
  }

  private noteItemType(type: string): void {
    // [#33949 codemod] The body moved to `registry-restore.ts`, its docblock with it (see `RestoreHost`).
    return RestoreFacet.noteItemType.call(restoreHost.of(this), type);
  }

  private noteItem(type: string, key: string): void {
    // [#33949 codemod] The body moved to `registry-restore.ts`, its docblock with it (see `RestoreHost`).
    return RestoreFacet.noteItem.call(restoreHost.of(this), type, key);
  }

  private noteItemOrder(type: string): void {
    // [#33949 codemod] The body moved to `registry-restore.ts`, its docblock with it (see `RestoreHost`).
    return RestoreFacet.noteItemOrder.call(restoreHost.of(this), type);
  }

  private notePicklistExtension(target: string, packageKey: string): void {
    // [#33949 codemod] The body moved to `registry-restore.ts`, its docblock with it (see `RestoreHost`).
    return RestoreFacet.notePicklistExtension.call(restoreHost.of(this), target, packageKey);
  }

  private noteSecurityCatalogClaim(type: SecurityCatalogType, name: string): void {
    // [#33949 codemod] The body moved to `registry-restore.ts`, its docblock with it (see `RestoreHost`).
    return RestoreFacet.noteSecurityCatalogClaim.call(restoreHost.of(this), type, name);
  }

  private noteBareNameClaim(type: BareNameOneHolderType, name: string): void {
    // [#33949 codemod] The body moved to `registry-restore.ts`, its docblock with it (see `RestoreHost`).
    return RestoreFacet.noteBareNameClaim.call(restoreHost.of(this), type, name);
  }

  private noteDefaultRecordPageClaims(packageId: string): void {
    // [#33949 codemod] The body moved to `registry-restore.ts`, its docblock with it (see `RestoreHost`).
    return RestoreFacet.noteDefaultRecordPageClaims.call(restoreHost.of(this), packageId);
  }

  // ==========================================
  // Namespace Management
  // ==========================================

  /**
   * Register a namespace for a package.
   * Multiple packages can share the same namespace (e.g. 'sys').
   */
  registerNamespace(namespace: string, packageId: string): void {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts` (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.registerNamespace.call(namespacesAndClaimsHost.of(this), namespace, packageId);
  }

  /**
   * Unregister a namespace when a package is uninstalled.
   */
  unregisterNamespace(namespace: string, packageId: string): void {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts` (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.unregisterNamespace.call(namespacesAndClaimsHost.of(this), namespace, packageId);
  }

  /**
   * Get the packages that use a namespace.
   */
  getNamespaceOwner(namespace: string): string | undefined {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts` (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.getNamespaceOwner.call(namespacesAndClaimsHost.of(this), namespace);
  }

  /**
   * Get all packages that share a namespace.
   */
  getNamespaceOwners(namespace: string): string[] {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts` (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.getNamespaceOwners.call(namespacesAndClaimsHost.of(this), namespace);
  }

  // ==========================================
  // One default record page per object per deployment
  // ==========================================

  /**
   * Slot → package → the page that package declared for the slot at install —
   * a slot is an object's default record page, keyed by the object alone, or
   * the record page of an object inside one app (`PageSchema.apps`, ruling A
   * on objectstack#28979), keyed by `recordPageSlotKey` — recorded by {@link installPackage} once its
   * declarations pass {@link refuseDefaultRecordPageConflicts}, forgotten by
   * {@link uninstallPackage}.
   *
   * The item store answers who holds an object's default only for pages
   * something registered into it, and `installPackage` registers none (a bare
   * install — `POST /api/v1/packages` — stores the manifest alone). The claim
   * is how the package door remembers what a package declared, so a second
   * package declaring a default for the same object is refused like any other
   * second holder. Unlike the security catalog's claims a re-install REPLACES
   * the package's claims: a default the package moved or dropped is no longer
   * its declaration, and the pages an earlier registration left in the item
   * store keep answering for themselves.
   */
  private defaultRecordPageClaims = new Map<string, Map<string, string>>();

  private defaultRecordPageSlots(slot: RecordPageSlot): Array<{ holder: DefaultRecordPageHolder; bare: boolean }> {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts`, its docblock with it (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.defaultRecordPageSlots.call(namespacesAndClaimsHost.of(this), slot);
  }

  /**
   * Every page that holds the default record page of `object` in this
   * registry — the reading both registration refusals judge by, and the
   * registry half the metadata save door (`@objectstack/metadata-protocol`'s
   * `saveMetaItem`) meets with the stored pages before it refuses a second
   * default. Read-only: it records nothing and refuses nothing.
   *
   * An environment item under a page's name stands in for that page, so a
   * name appears once, as the bare slot's verdict, whatever the slots it
   * shadows say. See {@link defaultRecordPageSlots}.
   *
   * With `app` passed, the holders of the record page of `object` inside that
   * app instead (`PageSchema.apps`, ruling A on objectstack#28979) — the slot
   * the save door meets an app-scoped page with.
   */
  defaultRecordPageHoldersOf(object: string, app?: string): DefaultRecordPageHolder[] {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts` (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.defaultRecordPageHoldersOf.call(namespacesAndClaimsHost.of(this), object, app);
  }

  private otherDefaultRecordPageHolders(slot: RecordPageSlot, page: string, packageId: string): DefaultRecordPageHolder[] {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts`, its docblock with it (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.otherDefaultRecordPageHolders.call(namespacesAndClaimsHost.of(this), slot, page, packageId);
  }

  private refuseDefaultRecordPageConflicts(manifest: ObjectStackManifest, selfId: string | undefined): void {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts`, its docblock with it (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.refuseDefaultRecordPageConflicts.call(namespacesAndClaimsHost.of(this), manifest, selfId);
  }

  private recordDefaultRecordPageClaims(packageId: string, manifest: ObjectStackManifest): void {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts`, its docblock with it (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.recordDefaultRecordPageClaims.call(namespacesAndClaimsHost.of(this), packageId, manifest);
  }

  private forgetDefaultRecordPageClaims(packageId: string): void {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts`, its docblock with it (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.forgetDefaultRecordPageClaims.call(namespacesAndClaimsHost.of(this), packageId);
  }

  // ==========================================
  // Security catalog namespace — one name, one holder
  // ==========================================

  /**
   * Catalog type → name → the installed package that declared it, recorded by
   * {@link installPackage} once its declarations pass
   * {@link refuseSecurityCatalogNameConflicts}, forgotten by
   * {@link uninstallPackage}.
   *
   * The registry's item store answers who holds a name only for items
   * something registered into it, and `installPackage` registers none: a
   * package's collections reach the item store through `ObjectQL.registerApp`'s
   * collection loop (positions only where that loop carries them), never
   * through a bare `installPackage`. The claim is how the package door
   * remembers every name a package declared, so a second package declaring one
   * of them is refused like any other second holder.
   *
   * [ADR-0150 D2/D9, #31698] A SET of claimants: two packages of two
   * namespaces may each hold a permission set of one name
   * ({@link permissionSetHoldersMeet}), and both are remembered.
   */
  private securityCatalogClaims = new Map<SecurityCatalogType, Map<string, Set<string>>>();

  private securityCatalogHoldersOtherThan(
    type: SecurityCatalogType,
    name: string,
    exceptPackageId: string | undefined,
    opts: { builtIns: boolean; environment: boolean; incomingNamespace: string | undefined },
  ): SecurityCatalogHolder[] {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts`, its docblock with it (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.securityCatalogHoldersOtherThan.call(namespacesAndClaimsHost.of(this), type, name, exceptPackageId, opts);
  }

  private refuseSecurityCatalogNameConflicts(manifest: ObjectStackManifest, selfId: string | undefined): void {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts`, its docblock with it (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.refuseSecurityCatalogNameConflicts.call(namespacesAndClaimsHost.of(this), manifest, selfId);
  }

  private recordSecurityCatalogClaims(packageId: string, manifest: ObjectStackManifest): void {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts`, its docblock with it (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.recordSecurityCatalogClaims.call(namespacesAndClaimsHost.of(this), packageId, manifest);
  }

  private forgetSecurityCatalogClaims(packageId: string): void {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts`, its docblock with it (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.forgetSecurityCatalogClaims.call(namespacesAndClaimsHost.of(this), packageId);
  }

  /**
   * Every `type` name `packageId` holds in the security catalog: its claims,
   * its composite `<packageId>:<name>` item slots, and any bare slot stamped
   * with it — sorted, and unfiltered by disable (a disabled package is still
   * installed, and still holds its names).
   *
   * Read by the uninstall doors just BEFORE {@link uninstallPackage}, which
   * releases all of it: the cleanups run after the withdrawal, and this is the
   * last moment the names are known (ADR-0090 D5, ADR-0131 D4).
   */
  securityCatalogNamesHeldBy(packageId: string, type: SecurityCatalogType): string[] {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts` (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.securityCatalogNamesHeldBy.call(namespacesAndClaimsHost.of(this), packageId, type);
  }

  private environmentHeldSecurityCatalogConflicts(): SecurityCatalogNameConflict[] {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts`, its docblock with it (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.environmentHeldSecurityCatalogConflicts.call(namespacesAndClaimsHost.of(this));
  }

  private packageHeldSecurityCatalogNames(): Array<{ catalogType: SecurityCatalogType; name: string; packageIds: string[] }> {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts`, its docblock with it (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.packageHeldSecurityCatalogNames.call(namespacesAndClaimsHost.of(this));
  }

  private securityCatalogPackageHolders(type: SecurityCatalogType, name: string): string[] {
    // [#33949 codemod] The body moved to `registry-namespaces-and-claims.ts`, its docblock with it (see `NamespacesAndClaimsHost`).
    return NamespacesAndClaimsFacet.securityCatalogPackageHolders.call(namespacesAndClaimsHost.of(this), type, name);
  }

  // ==========================================
  // Bare names — one name, one package holder (`bare-name-one-holder.ts`)
  // ==========================================

  /**
   * Covered type → name → the installed packages that declared it, in install
   * order — recorded by {@link installPackage}, forgotten by
   * {@link uninstallPackage}, for the reason {@link securityCatalogClaims} is:
   * the package door registers no item, so the claim is how it remembers a
   * declared name. A SET, unlike the security catalog's single claimant: a
   * cold boot registers every package before anything is judged, so two
   * packages that both declare a name both hold it until one is renamed or
   * uninstalled.
   */
  private bareNameClaims = new Map<BareNameOneHolderType, Map<string, Set<string>>>();

  /**
   * Set once, by {@link sealBareNameHolders} at the end of the cold boot. Until
   * then the doors judge nothing (module doc, "The cold boot"); from then on
   * both refuse a new holder.
   */
  private bareNameHoldersSealed = false;

  /** The packages already warned that their namespace spells an address literal. */
  private readonly addressLiteralNamespaceWarned = new Set<string>();

  private warnAddressLiteralNamespaceOnce(packageId: string, refusal: string): void {
    // [#33949 codemod] The body moved to `registry-bare-names.ts`, its docblock with it (see `BareNamesHost`).
    return BareNamesFacet.warnAddressLiteralNamespaceOnce.call(bareNamesHost.of(this), packageId, refusal);
  }

  /** Has the cold boot sealed the bare-name holders (the doors now refuse)? */
  get bareNameHoldersAreSealed(): boolean {
    return this.bareNameHoldersSealed;
  }

  private bareNamePackageHolders(type: BareNameOneHolderType, name: string): string[] {
    // [#33949 codemod] The body moved to `registry-bare-names.ts`, its docblock with it (see `BareNamesHost`).
    return BareNamesFacet.bareNamePackageHolders.call(bareNamesHost.of(this), type, name);
  }

  private bareNameRenameFor(packageId: string, name: string, namespace?: string): string | undefined {
    // [#33949 codemod] The body moved to `registry-bare-names.ts`, its docblock with it (see `BareNamesHost`).
    return BareNamesFacet.bareNameRenameFor.call(bareNamesHost.of(this), packageId, name, namespace);
  }

  private bareNameHolderNamespace(packageId: string): string | undefined {
    // [#33949 codemod] The body moved to `registry-bare-names.ts`, its docblock with it (see `BareNamesHost`).
    return BareNamesFacet.bareNameHolderNamespace.call(bareNamesHost.of(this), packageId);
  }

  private bareNameHoldersOtherThan(
    type: BareNameOneHolderType,
    name: string,
    incomingPackageId: string,
    opts: {
      builtIns: boolean;
      incomingNamespace: string | undefined;
      incomingHolding?: () => BundleHolding | undefined;
      incomingArrival?: { readonly members: ReadonlySet<string> };
    },
  ): BareNameHolder[] {
    // [#33949 codemod] The body moved to `registry-bare-names.ts`, its docblock with it (see `BareNamesHost`).
    return BareNamesFacet.bareNameHoldersOtherThan.call(bareNamesHost.of(this), type, name, incomingPackageId, opts);
  }

  /**
   * [ADR-0150 D9, #31699] `packageId`'s holding of the bundled `(type, name)`
   * as the bare-name gate reads it — the members its composite group and its
   * bound overlays hold ({@link bundleMembersHeldBy}, a pair's row read by
   * {@link gateSlotBinding}) and its declared dependency closure — or
   * `undefined` for a type that is no bundle. Both doors and the cold boot's
   * seal read a holding here, and nothing else does.
   *
   * With an `arrival` (a door judging a registration), the members are read
   * as if the arrival were registered: its members in its composite slot. A
   * package-less row binds to
   * the one package holding the name only while there is one
   * ({@link overlaySlotBinding}), so beside the arrival it binds to neither.
   * Read without the arrival, the row would be the holder's member, the
   * arrival no addition to the holder, and the door would admit what the seal
   * then reports (#32408, delta review N1).
   */
  private registeredBundleHolding(type: BareNameOneHolderType, name: string, packageId: string, arrival?: BundleArrival): BundleHolding | undefined {
    const disc = ITEM_KEY_DISCRIMINATORS[type];
    if (!disc || !isBareNameRegistryType(type)) return undefined;
    const registered = this.metadata.get(type) ?? new Map<string, any>();
    const collection = arrival === undefined ? registered : withArrivingMembers(registered, name, disc, arrival);
    const members = this.bundleMembersHeldBy(type, collection, name, packageId, new Set(this.compositeHoldersOf(collection, name)), disc, true);
    return { packageId, members, reach: new Set(packageDependencyClosure(packageId, this)?.dependencies ?? []) };
  }

  private bareNameBundleAdditionMeets(
    type: BareNameOneHolderType,
    name: string,
    incomingHolding: (() => BundleHolding | undefined) | undefined,
    holderPackageId: string,
    arrival?: BundleArrival,
  ): boolean {
    // [#33949 codemod] The body moved to `registry-bare-names.ts`, its docblock with it (see `BareNamesHost`).
    return BareNamesFacet.bareNameBundleAdditionMeets.call(bareNamesHost.of(this), type, name, incomingHolding, holderPackageId, arrival);
  }

  /**
   * [ADR-0150 D9, #31699] The holding of the bundled `(type, name)` a manifest
   * brings to the package door: the members it declares
   * ({@link declaredBundleMembers}), and the closure its declared dependencies
   * reach — each one and its own declared closure, read from the registry, as
   * the walk would read the package once installed.
   */
  private declaredBundleHolding(manifest: ObjectStackManifest, packageId: string, type: BareNameOneHolderType, name: string): BundleHolding | undefined {
    if (!ITEM_KEY_DISCRIMINATORS[type] || !isBareNameRegistryType(type)) return undefined;
    const reach = new Set<string>();
    for (const dep of declaredDependencyIds(manifest)) {
      reach.add(dep);
      for (const transitive of packageDependencyClosure(dep, this)?.dependencies ?? []) reach.add(transitive);
    }
    reach.delete(packageId);
    return { packageId, members: declaredBundleMembers(manifest, type, name), reach };
  }

  private refuseBareNameConflicts(manifest: ObjectStackManifest, selfId: string | undefined): void {
    // [#33949 codemod] The body moved to `registry-bare-names.ts`, its docblock with it (see `BareNamesHost`).
    return BareNamesFacet.refuseBareNameConflicts.call(bareNamesHost.of(this), manifest, selfId);
  }

  private recordBareNameClaims(packageId: string, manifest: ObjectStackManifest): void {
    // [#33949 codemod] The body moved to `registry-bare-names.ts`, its docblock with it (see `BareNamesHost`).
    return BareNamesFacet.recordBareNameClaims.call(bareNamesHost.of(this), packageId, manifest);
  }

  private forgetBareNameClaims(packageId: string): void {
    // [#33949 codemod] The body moved to `registry-bare-names.ts`, its docblock with it (see `BareNamesHost`).
    return BareNamesFacet.forgetBareNameClaims.call(bareNamesHost.of(this), packageId);
  }

  /**
   * The function registry's door (`bare-name-one-holder.ts`): the hook binder
   * asks this before it registers the functions a package's handlers bring
   * (`bindHooksToEngine`), with the owner it binds them under — `app:<id>`,
   * read as the package id ({@link handlerOwnerPackageId}). The function
   * registry is the engine's and keeps one function per name, the
   * last-registered, so the holders are the claims recorded here.
   *
   * Before the seal it records the claims and refuses nothing — the cold boot
   * reads them ({@link sealBareNameHolders}). Once sealed it refuses, ahead of
   * recording anything, a bind that brings a function another package holds,
   * every conflicting name in one refusal; a package binding its own functions
   * again is no new holder. An owner-less bind is never judged.
   *
   * @throws {BareNameConflictError} once sealed, naming both holders of each
   *   conflicting function and the rename.
   */
  claimBareNameFunctions(owner: string | undefined, names: readonly string[]): void {
    // [#33949 codemod] The body moved to `registry-bare-names.ts` (see `BareNamesHost`).
    return BareNamesFacet.claimBareNameFunctions.call(bareNamesHost.of(this), owner, names);
  }

  /**
   * [ADR-0150 D4, #32534] Release `owner`'s claim, recorded by
   * {@link claimBareNameFunctions}, on each function name its package claims
   * and no longer holds: `stillHolds(name)` answers whether the engine still
   * holds `name` for that package, and every name it answers `false` for is
   * released. The runtime's app-artifact binder (`bindAppArtifactHandlers`)
   * calls it right after a re-bind removes functions from the engine: when a
   * function its previous bind gave `owner` goes to another owner, and when
   * `owner`'s package body is dropped. A claim is the only record of a
   * function's holder this rule reads, and the engine's
   * `unregisterFunctionsByPackage` does not reach it, so without the release
   * the old owner goes on holding a name it no longer registers: once sealed,
   * a bind of that name by a package that meets it is refused naming it (a
   * gaining owner's whole group left unbound), and an unsealed boot's seal
   * reports a clash that is not there.
   *
   * The engine is asked, not the binder's record of its last bind: the
   * engine's removal is by the exact owner string (`app:<id>`), so a function
   * the package holds under another owner spelling (its bare id) stays held,
   * and keeps its claim; and a function an earlier bind gave the owner that
   * the last bind no longer named leaves with the removal, and is released
   * with it.
   *
   * Only that package's claims are released: every other holder's claim
   * stays, and so does each name it still holds. It judges nothing and
   * records nothing else, sealed or not; an owner-less call releases nothing,
   * as an owner-less bind claims nothing.
   */
  releaseBareNameFunctions(owner: string | undefined, stillHolds: (name: string) => boolean): void {
    // [#33949 codemod] The body moved to `registry-bare-names.ts` (see `BareNamesHost`).
    return BareNamesFacet.releaseBareNameFunctions.call(bareNamesHost.of(this), owner, stillHolds);
  }

  /**
   * The cold boot's seal (`bare-name-one-holder.ts`, "The cold boot"): from
   * this call on, both doors and the hook binder's function bind refuse a new
   * holder of a covered name. Answers every name the boot left held twice, as
   * the conflicts {@link BareNameConflictError} reports — the first-registered
   * holder as the existing one, each later one as an incoming one with its
   * rename; for a type narrowed to the namespace, only holders that meet
   * (`bareNameHoldersMeet`), so two namespaces' holders of one name are no
   * clash — and a package holding a built-in name. Sorted by type, then name,
   * so two boots of one deployment report alike. Records and refuses nothing
   * else: what the boot does with the answer is
   * {@link sealBareNameHoldersAtColdBoot}'s mode.
   */
  sealBareNameHolders(): BareNameConflict[] {
    // [#33949 codemod] The body moved to `registry-bare-names.ts` (see `BareNamesHost`).
    return BareNamesFacet.sealBareNameHolders.call(bareNamesHost.of(this));
  }

  // ==========================================
  // Object Registration (Ownership Model)
  // ==========================================

  /**
   * [#29673] Would {@link registerObject} refuse this body, as `ownership`
   * from `packageId`? The refusal it would throw, or `null` — asked of its own
   * doors ({@link judgeRegistrationDoors}), so the answer cannot drift from
   * the throw. Registers nothing, materializes nothing.
   *
   * For the metadata doors that make a stored body LIVE (the per-item and the
   * package publish, the publishing save): the registration runs after the row
   * is already active, where a refusal can only be logged, so they ask this
   * first and refuse the publish with the registry's own envelope — the same
   * shape as the ADR-0029 D9.9 representability refusal they already ask.
   *
   * Covers the doors that judge the body ALONE. The record-currency
   * `summary` door and its follow door are left out: each judges the body
   * against the registry as it stands (the pair is judged at whichever registration completes it), so
   * asked of a draft before its batch registers it answers both ways wrong —
   * it refuses a draft whose sibling in the same batch takes the child amount
   * out of record-currency mode, and it passes one whose sibling completes the
   * pair. D6's door stays the registration's own question, and the follow
   * door is no registration's: both are asked here only of a caller that
   * names `againstRegistry` on a sealed registry (see that option), and the
   * follow door is asked besides of a whole registration run at its end
   * ({@link restoringOnRefusal}). The single-owner rule is
   * the protocol's (`classifyObjectContribution`), and a code package's action
   * parse never judges a tenant-authored body.
   */
  objectRegistrationRefusal(
    schema: ServiceObject,
    packageId?: string,
    ownership: ObjectOwnership = 'own',
    options: {
      /**
       * [ADR-0144 D2 and D6, amended] The caller asks about a body whose unit
       * is whole, so nothing it registers with can still change the other end
       * of a pair, and it relays the refusal to its author. Two callers are:
       * a SINGLE save or publish that makes the body live in the same breath
       * (the producers are enumerated in `@objectstack/metadata-protocol`'s
       * `registry-question.ts`), and a batch writer — a package duplicate, an
       * unmanaged import, a package publish, the stored-metadata migration
       * pass — asking of each row once all its rows are registered
       * (`batch-object-registration.ts`, which answers a refused row in the
       * batch's own result). The doors that read the registry's other objects
       * are then asked too — D6's roll-up half and its follow door — once the
       * cold boot has sealed the registry. A refused save is answered with
       * the door's own envelope and stores nothing, instead of being stored
       * and refused, logged, at the write-through. ⛔ Not for a row asked
       * before its batch has registered: a later sibling can still complete
       * the pair (#29673).
       *
       * The follow door has two askers, and {@link registerObject} is neither
       * (seat ruling on the contract review of PR #32368): this option, and
       * the end of a registration run on a sealed registry
       * ({@link restoringOnRefusal}) — a running install or reload, which
       * registers a package's `objectExtensions` after its `objects` and the
       * packages of an artifact one after another, and hears the refusal as
       * a thrown error with the run put back. The cold boot, the stored-row
       * hydration and every other bare `registerObject` register the follow
       * pair exactly as before.
       */
      againstRegistry?: boolean;
    } = {},
  ): Error | null {
    // [#33949 codemod] The body moved to `registry-object-registration.ts` (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.objectRegistrationRefusal.call(objectRegistrationHost.of(this), schema, packageId, ownership, options);
  }

  private judgeRegistrationDoors(
    schema: ServiceObject,
    packageId: string | undefined,
    ownership: ObjectOwnership,
    opts: { bodyOnly?: boolean; againstRegistry?: boolean } = {},
  ): { refusal: Error } | { schema: ServiceObject } {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.judgeRegistrationDoors.call(objectRegistrationHost.of(this), schema, packageId, ownership, opts);
  }

  private recordCurrencyFollowRefusalOf(
    schema: ServiceObject,
    ownership: ObjectOwnership,
    layer: FollowDoorLayer,
    all: () => readonly ServiceObject[] = () => this.getAllObjects(),
    lookup: (name: string) => ServiceObject | undefined = (name) => this.getObject(name),
  ): RecordCurrencyFollowRefusedError | undefined {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.recordCurrencyFollowRefusalOf.call(objectRegistrationHost.of(this), schema, ownership, layer, all, lookup);
  }

  private servedFoldWithLayer(
    fqn: string,
    ownership: ObjectOwnership,
    packageId: string | undefined,
    layer: ObjectContributor | undefined,
  ): ServiceObject | undefined {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.servedFoldWithLayer.call(objectRegistrationHost.of(this), fqn, ownership, packageId, layer);
  }

  private followDoorSlotPriority(fqn: string, ownership: ObjectOwnership, packageId: string | undefined): number {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.followDoorSlotPriority.call(objectRegistrationHost.of(this), fqn, ownership, packageId);
  }

  /**
   * Register an object with ownership semantics.
   * 
   * @param schema - The object definition
   * @param packageId - The owning package ID, or — for an `overlay` — the
   *   `sys_metadata` row's own binding (provenance ON the layer, never an
   *   ownership claim; ADR-0029 D9.9). Optional (#12623) — matches the
   *   sibling {@link registerItem}: a bare `registerObject(schema)` call
   *   passes `packageId: undefined` through to `applyProtection`, which
   *   leaves the item clean (no `_packageId`, no `_provenance`) rather than
   *   defaulting. Do not give this parameter a default value — that would
   *   silently stamp package provenance onto every bare-call fixture.
   * @param namespace - The package namespace (for FQN computation)
   * @param ownership - 'own' (single owner) | 'overlay' (tenant layer that
   *   REPLACES the base at resolution; ADR-0029 D9) | 'extend' (additive merge)
   * @param priority - Merge priority (lower applied first, higher wins on conflict)
   * 
   * @throws {ObjectOwnershipConflictError} ADR-0112 envelope (`code` +
   *   `status: 422`) if trying to 'own' an object that already has a PACKAGED
   *   owner from another package
   * @throws {ObjectFieldTypeRefusedError} [#16319] ADR-0112 envelope (`code` +
   *   `status: 422`) if any declared field's `type` is absent or is not a
   *   `FieldType` member — the WHOLE declaration is refused, on every
   *   contributor kind. ⛔ The field is never dropped on its own.
   */
  registerObject(
    schema: ServiceObject,
    packageId?: string,
    namespace?: string,
    ownership: ObjectOwnership = 'own',
    priority: number = ownership === 'own'
      ? DEFAULT_OWNER_PRIORITY
      : ownership === 'overlay'
        ? DEFAULT_OVERLAY_PRIORITY
        : DEFAULT_EXTENDER_PRIORITY
  ): string {
    // [#33949 codemod] The body moved to `registry-object-registration.ts` (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.registerObject.call(objectRegistrationHost.of(this), schema, packageId, namespace, ownership, priority);
  }

  /**
   * Resolve an object by FQN, merging all contributions.
   * Returns the merged object or undefined if not found.
   */
  resolveObject(fqn: string): ServiceObject | undefined {
    // [#33949 codemod] The body moved to `registry-object-registration.ts` (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.resolveObject.call(objectRegistrationHost.of(this), fqn);
  }

  /**
   * An object as the STORAGE layer must see it: every `extend` contribution
   * folded in, whether or not its package is disabled. Schema sync (the
   * driver's `syncSchema`, the federated binding) reads this, so a disable
   * never takes a column, an index or a driver's read coercion away from the
   * data it keeps: the physical schema follows the full contribution, the
   * served object ({@link resolveObject}) follows enablement. With no disabled
   * package among the object's extenders it IS {@link resolveObject}'s answer.
   *
   * Accepts a short name or an FQN, as {@link getObject} does.
   */
  getStorageObject(name: string): ServiceObject | undefined {
    // [#33949 codemod] The body moved to `registry-object-registration.ts` (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.getStorageObject.call(objectRegistrationHost.of(this), name);
  }

  /** {@link getAllObjects} at the storage layer ({@link getStorageObject}), each tagged with its owner's `_packageId`. */
  getAllStorageObjects(): ServiceObject[] {
    // [#33949 codemod] The body moved to `registry-object-registration.ts` (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.getAllStorageObjects.call(objectRegistrationHost.of(this));
  }

  private resolveStorageObject(fqn: string): ServiceObject | undefined {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.resolveStorageObject.call(objectRegistrationHost.of(this), fqn);
  }

  /**
   * [#34901] The fields a disabled package's `extend` contribution adds to
   * `name` and the served fold therefore withholds, each with the package
   * that adds it: `{ crm_project: { packageId: 'com.acme.projects' } }`.
   * Empty when nothing is withheld (no disabled extender, or every field it
   * adds is also declared by the owner or a served extension).
   *
   * The served object read stamps this as its `_withheldFields` read
   * decoration, so a console can tell a name a switched-off package withholds
   * from a name nothing declares, and leave it out of every query while the
   * data door keeps refusing both. Accepts a short name or an FQN, as
   * {@link getObject} does.
   */
  getWithheldExtensionFields(name: string): Record<string, { packageId: string }> {
    return ObjectRegistrationFacet.getWithheldExtensionFields.call(objectRegistrationHost.of(this), name);
  }

  getRelatedListsArrangement(name: string): RelatedListsArrangement | undefined { // [ADR-0146 D10] contract: `ObjectRegistrationFacet.getRelatedListsArrangement`
    return ObjectRegistrationFacet.getRelatedListsArrangement.call(objectRegistrationHost.of(this), name);
  }

  private withholdDisabledExtensions(contributors: readonly ObjectContributor[], asEnabled?: string): WithheldExtensions | undefined {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.withholdDisabledExtensions.call(objectRegistrationHost.of(this), contributors, asEnabled);
  }

  private resolveObjectLeavingExtensionsOut(fqn: string, options: ObjectExtensionFoldOptions | undefined): ServiceObject | undefined {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.resolveObjectLeavingExtensionsOut.call(objectRegistrationHost.of(this), fqn, options);
  }

  private foldExtenders(
    contributors: ObjectContributor[],
    base: ObjectContributor,
    layer: ServedObjectLayer = 'served',
  ): ServiceObject {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.foldExtenders.call(objectRegistrationHost.of(this), contributors, base, layer);
  }

  private foldExtendersOntoDefinition(
    contributors: ObjectContributor[],
    baseDefinition: ServiceObject,
    layer: ServedObjectLayer = 'served',
  ): ServiceObject {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.foldExtendersOntoDefinition.call(objectRegistrationHost.of(this), contributors, baseDefinition, layer);
  }

  /**
   * [ADR-0146 D10, second rule] Field-patch targets already named, keyed
   * `object|package|field|option`. Per registry, for the reason
   * {@link shadowedExtensionQueueWarned} gives.
   */
  private fieldPatchMissesWarned = new Set<string>();

  /**
   * [#35901] Placement notes already named (a placement not applied, an
   * anchor missing, an item that is not the extension's own), keyed by the
   * note. Per registry, for the reason {@link shadowedExtensionQueueWarned}
   * gives.
   */
  private extensionPlacementNotesWarned = new Set<string>();

  private reportExtensionPlacements(notes: readonly ExtensionPlacementNote[]): void {
    // The body lives in `registry-object-registration.ts` (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.reportExtensionPlacements.call(objectRegistrationHost.of(this), notes);
  }

  /**
   * [#28835] Field names already named as declared by more than one
   * contributor, keyed `object|field|packages` (the packages in fold order).
   * Per registry, for the reason {@link shadowedExtensionQueueWarned} gives.
   */
  private redeclaredFieldsWarned = new Set<string>();

  private reportRedeclaredFields(
    object: string,
    contributors: readonly ObjectContributor[],
    ownFields: ReadonlySet<string> | undefined,
    folded: readonly FoldedExtensionFields[],
  ): void {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.reportRedeclaredFields.call(objectRegistrationHost.of(this), object, contributors, ownFields, folded);
  }

  private reportFieldPatchMisses(
    misses: readonly FieldPatchTargetMiss[],
    packageId: string | undefined,
  ): void {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.reportFieldPatchMisses.call(objectRegistrationHost.of(this), misses, packageId);
  }

  /**
   * Extension `queue` declarations already named, keyed `object|package`. Per
   * registry, not module-level, for the reason {@link navGroupDiagnostics}
   * gives: the fold runs on every read, and a second registry must still say it.
   */
  private shadowedExtensionQueueWarned = new Set<string>();

  private withoutExtensionQueueField(extension: ServiceObject, packageId: string | undefined): ServiceObject {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.withoutExtensionQueueField.call(objectRegistrationHost.of(this), extension, packageId);
  }

  private finishServedObject<T>(
    body: T,
    layer: ServedObjectLayer = 'served',
    referrerOf: PicklistReferrer = NO_PACKAGE_REFERRER,
  ): T {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return (ObjectRegistrationFacet.finishServedObject<T>).call(objectRegistrationHost.of(this), body, layer, referrerOf);
  }

  private attachBoundActions<T>(body: T, layer: ServedObjectLayer = 'served'): T {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return (ObjectRegistrationFacet.attachBoundActions<T>).call(objectRegistrationHost.of(this), body, layer);
  }

  private boundServedActions(): any[] {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.boundServedActions.call(objectRegistrationHost.of(this));
  }

  private boundCodeActions(): any[] {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.boundCodeActions.call(objectRegistrationHost.of(this));
  }

  /**
   * [#24400] The bound top-level actions whose target object NO package has
   * registered — each one an action no served object will ever list, so it is
   * refused at boot rather than dropped ({@link describeUnboundActionTargets}).
   *
   * Only meaningful once every package has registered: the ObjectQL plugin
   * asks at `kernel:ready` (AGENTS.md, startup registry reads — a target a
   * later package registers would otherwise read as missing), and judges each
   * later artifact as it arrives.
   */
  findUnboundActionTargets(): UnboundActionTarget[] {
    // [#33949 codemod] The body moved to `registry-object-registration.ts` (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.findUnboundActionTargets.call(objectRegistrationHost.of(this));
  }

  /**
   * [#24472] The bound top-level actions their target object does not list
   * because it already lists a DIFFERENT declaration under the same name —
   * the object's own (rung 1 before rung 2, so {@link attachBoundActions}
   * skips the name) or another package's bound action attached first.
   *
   * A pair that is the same declaration ({@link sameActionDeclaration}) is not
   * a collision: a same-stack merge leaves a copy on the object beside the
   * top-level item, and one declaration can be shipped by two packages or
   * re-bridged under another package's stamp. Nothing here changes what is
   * served or refuses anything — the ObjectQL plugin reports each pair
   * ({@link describeBoundActionCollision}).
   *
   * Only meaningful once every package has registered (`kernel:ready`, for
   * {@link findUnboundActionTargets}' reason). `packageIds` narrows the answer
   * to the pairs naming one of those packages on either side — a late
   * artifact's, so a pair the boot already reported is not reported again.
   *
   * Keyed on {@link FIND_BOUND_ACTION_COLLISIONS}, a symbol the package entry
   * does not export, so the audit adds no nameable member to the published face.
   */
  [FIND_BOUND_ACTION_COLLISIONS](packageIds?: ReadonlySet<string>): BoundActionCollision[] {
    const out: BoundActionCollision[] = [];
    for (const action of this.boundCodeActions()) {
      const objectName = standaloneActionOwnerKey(action);
      const fqn = this.resolveObjectKey(objectName);
      if (fqn === undefined) continue; // no target at all: findUnboundActionTargets' case
      const served = (this.resolveObject(fqn) as { actions?: unknown } | undefined)?.actions;
      const listed: any = Array.isArray(served) ? served.find((a: any) => a?.name === action.name) : undefined;
      if (listed === undefined || listed === action || sameActionDeclaration(listed, action)) continue;
      const servedPackageId: string | undefined = isCodeArtifactBody(listed)
        ? listed._packageId
        : this.getObjectOwner(fqn)?.packageId;
      const shadowedPackageId: string | undefined = action._packageId;
      const names = (id: string | undefined) => id !== undefined && packageIds!.has(id);
      if (packageIds && !names(servedPackageId) && !names(shadowedPackageId)) continue;
      out.push({ objectName, action: action.name, servedPackageId, shadowedPackageId });
    }
    return out;
  }

  private tenantAuthoredScalars(
    contributors: ObjectContributor[],
    baseDefinition: ServiceObject,
  ): ReadonlySet<ObjectFoldScalarKey> | undefined {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it.
    return ObjectRegistrationFacet.tenantAuthoredScalars(contributors, baseDefinition);
  }

  private tenantPatchedDisplayKeys(
    contributors: ObjectContributor[],
    baseDefinition: ServiceObject,
  ): ReadonlySet<string> | undefined {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it.
    return ObjectRegistrationFacet.tenantPatchedDisplayKeys(contributors, baseDefinition);
  }

  private tenantRuleSettings(
    contributors: ObjectContributor[],
    baseDefinition: ServiceObject,
  ): ReadonlyMap<string, TenantRuleSettings> | undefined {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it.
    return ObjectRegistrationFacet.tenantRuleSettings(contributors, baseDefinition);
  }

  private withPackagedOwnerRules(
    contributors: ObjectContributor[],
    baseDefinition: ServiceObject,
    tenantRules: ReadonlyMap<string, TenantRuleSettings>,
  ): ServiceObject {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it.
    return ObjectRegistrationFacet.withPackagedOwnerRules(contributors, baseDefinition, tenantRules);
  }

  private packagedRules(contributors: readonly ObjectContributor[]): unknown[] | undefined {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it.
    return ObjectRegistrationFacet.packagedRules(contributors);
  }

  /**
   * [ADR-0029 D9.2a, 2026-10-30 note] The refusal of a tenant body for object
   * `name` that carries a copy of a packaged validation rule — same `name` as
   * a rule a code layer ships — changing anything but the rule's `message` and
   * `active`: its `type`, its condition, or any other key the package owns.
   * `null` when every copy changes at most those two, and when no code layer
   * ships a rule of any name the body carries (rules of new names add).
   *
   * Judged against the code layers registered NOW, the packaged rule set the
   * fold enforces. The first changed rule is named, with every key it changes.
   */
  tenantRuleCopyRefusal(name: string, body: unknown): Error | null {
    // [#33949 codemod] The body moved to `registry-object-registration.ts` (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.tenantRuleCopyRefusal.call(objectRegistrationHost.of(this), name, body);
  }

  /** `object|rule|copy|packaged` already reported — once per registry, as {@link shadowedExtensionQueueWarned} is. */
  private reportedRuleCopyChanges = new Set<string>();

  private reportChangedRuleCopies(contributors: ObjectContributor[], baseDefinition: ServiceObject): void {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.reportChangedRuleCopies.call(objectRegistrationHost.of(this), contributors, baseDefinition);
  }

  /**
   * [#7556] Fold this object's `extend` contributors onto a base body the
   * CALLER supplies — the same fold {@link resolveObject} (D9.2) and
   * {@link resolveOwnerLayer} (D9.6) apply, exposed for a base layer that did
   * not come from this registry.
   *
   * Why this is public API rather than the protocol reaching for the
   * contributor list: `GET /meta/object/:name` reaches an object body through a
   * source this registry never sees — the copy `MetadataPlugin` registers into
   * the `metadata` SERVICE when a deployment ingests a compiled artifact. That
   * service holds the owner's declaration only: a code package's
   * `objectExtensions` are never stored there as items, because the ObjectQL
   * engine's `registerApp` registers each one as an `'extend'` contributor
   * here, and `MetadataPlugin` files no item from that collection (an
   * extension carries `extend` and no `name`). That body is ONE LAYER, and
   * serving a layer as the resolved schema is what dropped every
   * `objectExtensions` field from the by-name read (and from both
   * layers of `?layers=true`) while `GET /meta/object` — which reads
   * `resolveObject` — kept them. Two folds would re-open exactly that seam one
   * level down, so there is one.
   *
   * Returns `base` untouched when nothing extends the name, so a caller may
   * apply it unconditionally.
   *
   * [#8027] IDEMPOTENT, by construction — and it has to be, because the
   * "callers must only pass an unfolded base" precondition this method carried
   * when #7556 introduced it is not one any caller can honour.
   *
   * {@link mergeObjectDefinitions} CONCATENATES `indexes`, and concatenated
   * `validations` too until the ADR-0029 D9.2a 2026-10-30 note made them merge
   * by name (`fields` is a key-keyed spread and the scalar props are
   * last-writer-wins, so those were always safe). A second fold therefore used
   * to duplicate both, and two shipped call sites already handed it a folded
   * base:
   *
   *  1. The MetadataService body on an IN-PROCESS boot. ObjectQL's
   *     `bridgeObjectsToMetadataService` seeds that service from
   *     `registry.getAllObjects()` — bodies that are already resolved — so the
   *     by-name read and the layered `code` layer folded a folded body and
   *     served every extender-contributed validation and index TWICE. #7556's
   *     own pin could not see it: it compares FIELD NAMES, and the field spread
   *     is idempotent.
   *  2. A `sys_metadata` overlay row (#8027). The write path persists the
   *     request body verbatim (ADR-0005 §Validation), so the ordinary Studio
   *     GET → edit → PUT round-trip stores whatever the read served — and since
   *     #7556 that read is folded. The row is DEFINED by D9.2 as the base
   *     layer, but nothing enforces it, and legacy/seeded/imported rows are
   *     unconstrained besides.
   *
   * So the precondition is dropped rather than documented harder: an index the
   * `extend` contributors are about to add, already sitting in `base`, is
   * removed from the base first and then re-added by the fold exactly once,
   * and a rule is merged by name, which replaces the base's copy in the same
   * step. Extenders' indexes are still concatenated against EACH OTHER,
   * matching {@link resolveObject}, so this narrows nothing the fold was doing
   * on an unfolded base.
   */
  foldObjectExtendersOnto<T>(name: string, base: T, options?: ObjectExtensionFoldOptions): T {
    // [#33949 codemod] The body moved to `registry-object-registration.ts` (see `ObjectRegistrationHost`).
    return (ObjectRegistrationFacet.foldObjectExtendersOnto<T>).call(objectRegistrationHost.of(this), name, base, options);
  }

  private materializeBaseLayer(
    schema: ServiceObject,
    opts?: { designatePrimary?: boolean; provisionCompanion?: boolean },
  ): ServiceObject {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.materializeBaseLayer.call(objectRegistrationHost.of(this), schema, opts);
  }

  /**
   * [#8268] Replay THIS registry's whole object-materialization seam
   * ({@link materializeBaseLayer}) onto a base body the CALLER supplies — the
   * generalisation of {@link provisionSearchCompanionOnto}, which exposed one
   * stamp of that seam for one card.
   *
   * The read exits call this INSTEAD of reaching for individual stamps. Both
   * halves of that matter:
   *
   *  - a stamp added to the seam converges on the served document without a new
   *    method here, a new method in the protocol, or a new card — the failure
   *    mode #6562 → #8038 → #8268 demonstrated three times; and
   *  - the served document is materialized in the seam's own ORDER, so the two
   *    answers cannot differ by sequencing either.
   *
   * ⛔ [#8376] THE SEAM MATERIALIZES A **BASE LAYER**, AND THE BODY HANDED HERE
   * MAY ALREADY BE FOLDED. That is the whole of what this method has to get
   * right, and it is one rule rather than a list of per-stamp exceptions.
   *
   * `registerObject` materializes the BASE and `resolveObject` folds `extend`
   * contributors on afterwards WITHOUT re-materializing. A read exit holds the
   * FOLDED document, so any stamp whose decision reads the field set would be
   * re-decided here over a strictly larger map than the registry ever judged —
   * and would answer differently for a title-less base that an extension gives
   * a text field to. Both document-sensitive stamps have that shape:
   * `provisionPrimary` would designate the extension's field, and
   * `provisionSearchCompanion` would find it as a companion SOURCE and provision
   * a `__search` column the registry never provisioned and the driver's
   * `syncSchema` therefore never created.
   *
   * ⛔ The fix cannot be to un-fold here: the fold's own idempotence
   * ({@link subtractExtenderContributions} and the by-name rule merge) reaches
   * `validations` and `indexes` only — `fields` is a key-keyed spread with no inverse, because an extender
   * may legitimately REPLACE a base field under the same key. Measured: after
   * `foldObjectExtendersOnto`, the extension's field is still in the map.
   *
   * So the pre-fold verdict is taken from the one party that reached it BEFORE
   * the fold — this registry, at registration. Each document-sensitive stamp is
   * withheld when this registry HAS resolved the named object and its own
   * answer does not carry that stamp. Convergence may only move the served copy
   * ONTO the registry's answer, never manufacture a stamp the registry declined.
   *
   * The mirror-image case — the registry stamps and the served body cannot —
   * needs no check: both provisioners are pure functions of the body they are
   * handed, so each can only ever point at a field that body really declares.
   *
   * ⚠️ A stamp added to {@link materializeBaseLayer} needs a withhold here ONLY
   * IF its decision reads the document. #8375's tenant-scope index does not (it
   * is gated on a deployment flag alone), which is why it has no entry and needs
   * none. That is the test to apply to stamp five.
   *
   * Returns `base` by reference when nothing was owed, so a registry-sourced
   * body (materialized at registration) pays comparisons and no copy, and a
   * caller may apply it unconditionally.
   */
  materializeServedObjectOnto<T>(base: T): T {
    // [#33949 codemod] The body moved to `registry-object-registration.ts` (see `ObjectRegistrationHost`).
    return (ObjectRegistrationFacet.materializeServedObjectOnto<T>).call(objectRegistrationHost.of(this), base);
  }

  private declinedBaseLayerStamps(base: unknown): { primary: boolean; companion: boolean } {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`, its docblock with it (see `ObjectRegistrationHost`).
    return ObjectRegistrationFacet.declinedBaseLayerStamps.call(objectRegistrationHost.of(this), base);
  }

  /**
   * [#8038] Apply THIS registry's `__search` companion-column decision to a
   * base body the CALLER supplies — the deployment-gated provisioning step
   * {@link registerObject} runs on every base layer it materializes, exposed
   * for a body that did not come from this registry.
   *
   * Same reason {@link foldObjectExtendersOnto} is public API rather than the
   * protocol reaching for the contributor list: `GET /meta/object/:name`
   * reaches an object body through a source this registry never sees — the
   * copy `MetadataPlugin` registers into the `metadata` SERVICE when a
   * deployment ingests a compiled artifact. That copy is the author's
   * DECLARATION, captured before materialization, so it carries no companion
   * column, while `GET /meta/object` reads `resolveObject` and carries one.
   * Measured on the showcase (#8038): all 22 companion-bearing package objects
   * were served WITHOUT `__search` by the by-name read and WITH it by the list
   * read, while every platform object — registered straight into this registry,
   * so never routed through the service — agreed on both.
   *
   * ⛔ The gate is the registry's own `searchCompanion` field and NOT a fresh
   * `resolveSearchPinyinEnabled()` call. That field is `options.searchCompanion
   * ?? resolveSearchPinyinEnabled()`, so a host which passes it explicitly —
   * every test that pins this behaviour, and any embedder that overrides the
   * env default — would otherwise get an answer re-derived from the
   * environment instead of from the registry that actually provisioned (or
   * declined to provision) the column. That is the #6562 failure mode
   * restated: an injection pass and an injection table free to disagree.
   *
   * Returns `base` by reference when the deployment has companions off, when
   * the object has no eligible display field, and when the column is already
   * present — {@link provisionSearchCompanion} is pure and idempotent — so a
   * registry-sourced body (provisioned at registration) pays a comparison and
   * no copy, and a caller may apply it unconditionally.
   *
   * ⚠️ [#8268] This is ONE STAMP of the materialization seam, and the `/meta`
   * read exits no longer call it — they call
   * {@link materializeServedObjectOnto}, which replays the whole seam. Reaching
   * for a single stamp from a read exit is what made `nameField` a third card
   * after this one was a second. Kept public because it is the exact operation
   * the write-side {@link stripProvisionedSearchCompanionFrom} is the inverse
   * of, and hosts pin the pair.
   */
  provisionSearchCompanionOnto<T>(base: T): T {
    // [#33949 codemod] The body moved to `registry-object-registration.ts` (see `ObjectRegistrationHost`).
    return (ObjectRegistrationFacet.provisionSearchCompanionOnto<T>).call(objectRegistrationHost.of(this), base);
  }

  /**
   * [#8038] The WRITE-side counterpart of {@link provisionSearchCompanionOnto}:
   * take the companion column back off a body on its way IN, so a document the
   * read served and a client handed straight back still persists byte-identical
   * (#4326).
   *
   * Owed for exactly the reason `stripInjectedSystemColumns` is owed to
   * `applyInjectedSystemColumns` (#6562): the write path persists the request
   * body verbatim by design (ADR-0005 §Validation), so anything the READ adds
   * must come off again or it is baked into `sys_metadata.metadata`, into its
   * checksum, and into every history diff. Measured before this was added: a
   * runtime-created object stored `fields: [name]`, and one GET → PUT
   * round-trip through the converged read turned that into
   * `fields: [__search, name]` — a column no author wrote, in the row that
   * records what they customised.
   *
   * ⛔ Deliberately NOT gated on `searchCompanion`. The read that added the
   * column and the write that hands it back are different requests, and a
   * deployment may have flipped `OS_SEARCH_PINYIN_ENABLED` off in between; a
   * gated strip would then bake in exactly the body the gate exists to
   * prevent. What bounds this instead is EXACTNESS, the same discipline
   * `isInjectedDefinition` applies: the entry is removed only when it is
   * byte-identical to the definition {@link provisionSearchCompanion} would
   * stamp — recomputed from that one function rather than transcribed, so the
   * two cannot drift — and a body carrying anything else under the name keeps
   * it.
   *
   * Returns `base` by reference when there is nothing to remove. Pure and total.
   */
  stripProvisionedSearchCompanionFrom<T>(base: T): T {
    // [#33949 codemod] The body moved to `registry-object-registration.ts`.
    return (ObjectRegistrationFacet.stripProvisionedSearchCompanionFrom<T>)(base);
  }

  /**
   * [#8268] The WRITE-side inverse of {@link materializeServedObjectOnto}: take
   * this registry's whole materialization seam back OFF a body on its way IN.
   *
   * Owed for the reason each individual strip beside it is owed (#4326): the
   * write path persists the request body verbatim by design (ADR-0005
   * §Validation), so whatever the READ added must come off again or it is baked
   * into `sys_metadata.metadata`, into its checksum, and into every history
   * diff — the standard Studio GET → edit → PUT turning a platform-computed
   * stamp into a phantom customisation the author never wrote.
   *
   * It exists as ONE method for the same reason its read-side twin does. A
   * stamp added to {@link materializeBaseLayer} acquires BOTH halves here, and
   * the pair cannot be half-implemented: the read half alone is a #4326
   * regression that a landed round-trip pin catches, and this card measured
   * exactly that before adding this method.
   *
   * ⛔ Strips in the REVERSE of the seam's order — tenant index first, then the
   * companion, then the title designation — because each strip recomputes its
   * canonical answer over a body that still carries every stamp applied AFTER
   * it, which is the state it was stamped in. Stripping the pointer first would
   * ask `provisionSearchCompanion` a different question than the one it was
   * answered with.
   *
   * Returns `base` by reference when nothing was owed.
   */
  stripMaterializedStampsFrom<T>(base: T): T {
    // [#33949 codemod] The body moved to `registry-object-registration.ts` (see `ObjectRegistrationHost`).
    return (ObjectRegistrationFacet.stripMaterializedStampsFrom<T>).call(objectRegistrationHost.of(this), base);
  }

  // ==========================================
  // [ADR-0131 D7] The deployment's platform-global declaration
  // ==========================================

  /**
   * Install the objects THIS deployment declares platform-global — the
   * validated reading of the mounted `org-scoping` service's
   * `OrgScopingEntitlement.platformGlobalObjects` (#12699, made total by
   * ADR-0131 D7: "an object a deployment declares platform-global gets no
   * organization column on that deployment (the injected-columns plan reads
   * the declaration), so Layer 0 and the driver agree by having nothing to
   * scope").
   *
   * ## When, and what orders it
   *
   * The engine plugin calls this at `start()`, before its first schema sync.
   * The plan is computed at {@link registerObject}, which runs inside whichever
   * plugin's `init()` registers the object — and the `org-scoping` provider
   * cannot be hoisted ahead of every one of those: it hard-depends on the
   * engine (its own `init()` registers a manifest), so an engine-side
   * `optionalDependencies` edge on it is a cycle, and an edge from every
   * object registrant is an open-ended set. What does order them is ADR-0116's
   * Phase 1/2 split: every `init()` completes before any `start()`, and the
   * provider declares `org-scoping` in `providesServices`, i.e. registers it
   * unconditionally in `init()`. So at the engine's `start()` the declaration
   * is final, and no table exists yet.
   *
   * ## What it does to an object registered before it
   *
   * Re-plans it, so the registry answers exactly what {@link registerObject}
   * answers for an object registered after it: on every base layer the
   * platform's tenant index entry and the platform's own `organization_id`
   * come off and `systemFields.tenant: false` is recorded
   * ({@link applyDeploymentTenancy}); an `extend` layer carries neither, since
   * it is never planned on its own (#24314). A column the AUTHOR declared is the author's — it
   * stays, the object stays walled on it, and its name is returned in
   * `keptAuthoredColumn` for the caller to report.
   *
   * The declaration is constant for the kernel's life (the `org-scoping`
   * service's keys are readonly). Installing again re-plans with the new set;
   * an object dropped from it is not re-injected.
   */
  setDeploymentPlatformGlobalObjects(names: Iterable<string>): {
    readonly replanned: readonly string[];
    readonly keptAuthoredColumn: readonly string[];
  } {
    // [#33949 codemod] The body moved to `registry-platform-global.ts` (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.setDeploymentPlatformGlobalObjects.call(platformGlobalHost.of(this), names);
  }

  private applyDeploymentTenancy(schema: ServiceObject): ServiceObject {
    // [#33949 codemod] The body moved to `registry-platform-global.ts`, its docblock with it (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.applyDeploymentTenancy.call(platformGlobalHost.of(this), schema);
  }

  private stripDeploymentTenancyFrom<T>(base: T): T {
    // [#33949 codemod] The body moved to `registry-platform-global.ts`, its docblock with it (see `PlatformGlobalHost`).
    return (PlatformGlobalFacet.stripDeploymentTenancyFrom<T>).call(platformGlobalHost.of(this), base);
  }

  private deploymentWithholdsTenant(schema: ServiceObject): boolean {
    // [#33949 codemod] The body moved to `registry-platform-global.ts`, its docblock with it (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.deploymentWithholdsTenant.call(platformGlobalHost.of(this), schema);
  }

  private stripProvisionedTenantIndexFrom<T>(base: T): T {
    // [#33949 codemod] The body moved to `registry-platform-global.ts`, its docblock with it (see `PlatformGlobalHost`).
    return (PlatformGlobalFacet.stripProvisionedTenantIndexFrom<T>).call(platformGlobalHost.of(this), base);
  }

  private stripProvisionedPrimaryFrom<T>(base: T): T {
    // [#33949 codemod] The body moved to `registry-platform-global.ts`, its docblock with it.
    return (PlatformGlobalFacet.stripProvisionedPrimaryFrom<T>)(base);
  }

  private subtractExtenderContributions(
    contributors: ObjectContributor[],
    base: ServiceObject,
  ): ServiceObject {
    // [#33949 codemod] The body moved to `registry-platform-global.ts`, its docblock with it.
    return PlatformGlobalFacet.subtractExtenderContributions(contributors, base);
  }

  private resolveOwnerLayer(fqn: string): ServiceObject | undefined {
    // [#33949 codemod] The body moved to `registry-platform-global.ts`, its docblock with it (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.resolveOwnerLayer.call(platformGlobalHost.of(this), fqn);
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
    // [#33949 codemod] The body moved to `registry-platform-global.ts` (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.getObject.call(platformGlobalHost.of(this), name);
  }

  private resolveObjectKey(name: string): string | undefined {
    // [#33949 codemod] The body moved to `registry-platform-global.ts`, its docblock with it (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.resolveObjectKey.call(platformGlobalHost.of(this), name);
  }

  /**
   * Get all registered objects (merged).
   * 
   * @param packageId - Optional filter: only objects contributed by this package
   * @param options - [#29903, #29872] each object is resolved with the `extend`
   *   contributions these name left out of the fold
   *   ({@link ObjectExtensionFoldOptions}, {@link resolveObjectLeavingExtensionsOut}):
   *   `withoutExtensionsOf` one package's, `onlyExtensionsOf` every package's
   *   but one. The protocol's per-package layer passes `onlyExtensionsOf`,
   *   naming the listed package.
   */
  getAllObjects(packageId?: string, options?: ObjectExtensionFoldOptions): ServiceObject[] {
    // [#33949 codemod] The body moved to `registry-platform-global.ts` (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.getAllObjects.call(platformGlobalHost.of(this), packageId, options);
  }

  /**
   * Get all contributors for an object.
   */
  getObjectContributors(fqn: string): ObjectContributor[] {
    // [#33949 codemod] The body moved to `registry-platform-global.ts` (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.getObjectContributors.call(platformGlobalHost.of(this), fqn);
  }

  /**
   * [#29872, ADR-0146 D8 item 3 / D10] Every `extend` contribution `packageId`
   * makes, as the `objectExtensions` entry it registers from: the inverse of
   * {@link registerObjectExtension}. One entry per extended object, in
   * registration order, whichever door registered it: a manifest's
   * `objectExtensions` (`ObjectQL.registerApp` — a code package, or a package
   * installed through install-local, which files no `object_extension` item)
   * or a stored `object_extension` row.
   *
   * Each entry is the contribution's body with its address put back: `extend`
   * is the object it is filed under, `priority` its merge priority (absent when
   * it is {@link DEFAULT_EXTENDER_PRIORITY}, the value an entry that names none
   * parses to), and its `name` and every envelope key the registration stamped
   * (`_packageId`, `_provenance`, …) are left out. A key the registration left
   * `undefined` is left out too. Shallow: the nested bodies are the
   * registry's, never to be mutated.
   *
   * The reader is the package export: a package's export carries its own
   * extensions as `objectExtensions`, however they were installed, and the
   * extended object's owner's export carries none of them
   * ({@link getAllObjects}'s `onlyExtensionsOf`).
   */
  getObjectExtensionsOf(packageId: string): Array<{ extend: string; priority?: number } & Record<string, unknown>> {
    // [#33949 codemod] The body moved to `registry-platform-global.ts` (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.getObjectExtensionsOf.call(platformGlobalHost.of(this), packageId);
  }

  /**
   * Get the owner contributor for an object.
   *
   * Unchanged by ADR-0029 D9: it keeps meaning "the package that owns the
   * table". An overlay is not an owner, so it is never returned here.
   */
  getObjectOwner(fqn: string): ObjectContributor | undefined {
    // [#33949 codemod] The body moved to `registry-platform-global.ts` (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.getObjectOwner.call(platformGlobalHost.of(this), fqn);
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
    // [#33949 codemod] The body moved to `registry-platform-global.ts` (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.getPackagedObjectOwner.call(platformGlobalHost.of(this), name);
  }

  /**
   * [ADR-0029 D9.2a, #27559] The packaged base a served object is compared
   * against: the {@link getPackagedObjectOwner} declaration, with the
   * `validations` of every CODE `extend` contributor merged on in fold order,
   * by name ({@link packagedRules}).
   *
   * The packaged message of a rule is the message of whichever code layer
   * ships that rule name — the owner or a code extender — because the catalog
   * translates exactly what those layers ship. Reading the owner alone left an
   * extender's rule with nothing to compare a tenant's rewrite with, so the
   * catalog won over it on `/meta` and on the refusal alike. Both readers take
   * their packaged rules from here (`getPackagedObjectBase` in
   * `@objectstack/metadata-protocol`, `packagedRuleLookup` in this package),
   * so they cannot split again.
   *
   * The same sentence holds for a FIELD a code extender adds (a dependent
   * package's `objectExtensions` field the owner does not declare): its
   * packaged declaration is the extender's, because the catalog rows for it
   * can only translate what that extender ships ({@link packagedAddedFields}).
   * Read off the owner alone, such a field counted as authored after the fact,
   * and `/meta` served its label and option labels untranslated in every
   * locale while the extender's own pack carried them.
   *
   * ⛔ Exactly those two widen: rules by name, and field NAMES the owner does
   * not declare. The scalars stay the owner's, and so does every field the
   * owner declares, even one an extender redeclares; an extender's
   * `fieldPatches` are never folded in. Each must keep reading as diverged from
   * the packaged one, or the catalog — which translates the owner's text under
   * the owner's keys — takes back the case #8037 filed. A tenant overlay and an
   * extension of tenant provenance (`_provenance: 'org'`) add nothing here:
   * their fields stay authored after the fact. Nor does a disabled package's
   * extension, which the served fold withholds. (The rule half, `packagedRules`,
   * still reads every code extender, disabled ones included.)
   *
   * Returns the owner's definition BY REFERENCE when no code extender ships a
   * rule or adds a field, and `undefined` exactly where
   * {@link getPackagedObjectOwner} does.
   */
  getPackagedObjectBase(name: string): ServiceObject | undefined {
    // [#33949 codemod] The body moved to `registry-platform-global.ts` (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.getPackagedObjectBase.call(platformGlobalHost.of(this), name);
  }

  /**
   * [#33952, ADR-0146 D10] For each CODE `extend` contributor of an object
   * that patches its fields (`fieldPatches`), the packaged base
   * ({@link getPackagedObjectBase}) with THAT package's patches applied and no
   * other's — the text the package writes on each slot it patches — beside
   * its package id. Highest precedence first: the fold applies contributors
   * in ascending order, so where two packages patch one slot the first entry
   * is the one the served object carries.
   *
   * The serving layer reads it to translate a patched slot from the patching
   * package's own translations (`TranslateDocumentOptions.patchBundles` in
   * `@objectstack/spec/system`), and asks of it only which package wrote the
   * served value: the comparison that decides a slot is patched stays
   * {@link getPackagedObjectBase}'s, which never folds a patch in. Nothing is
   * stamped on the served document (ADR-0029 D9.2a): this is read off the
   * contributors, by the filter {@link getPackagedObjectBase} reads added
   * fields with — a code artifact body, a package that is not disabled. A
   * tenant overlay and an extension of tenant provenance add nothing: their
   * text is authored, and keeps its own. Each patch reaches the owner's own
   * fields only, as the fold applies it; the tenant yield is not applied, so
   * an entry carries what the package ships even where a tenant renamed the
   * slot (the served value then matches no entry).
   *
   * `[]` where {@link getPackagedObjectOwner} answers `undefined`, and where no
   * code extender patches a field.
   */
  getPackagedFieldPatchBases(name: string): Array<{ packageId: string; base: ServiceObject }> {
    return PlatformGlobalFacet.getPackagedFieldPatchBases.call(platformGlobalHost.of(this), name);
  }

  /**
   * [#28574] {@link extendContributionRefusal}, asked of the registry by the
   * metadata doors (which reach this registry through the engine and do not
   * import this package).
   */
  extendContributionRefusal(
    schema: { name?: unknown; defaultRowScope?: unknown; membershipKeys?: unknown },
    packageId: string | undefined,
  ): Error | undefined {
    // [#33949 codemod] The body moved to `registry-platform-global.ts`.
    return PlatformGlobalFacet.extendContributionRefusal(schema, packageId);
  }

  /**
   * [#28574, ADR-0146 D10] Register an `object_extension` item — a stored row
   * of a writable package — as that package's `'extend'` contributor of the
   * object it names.
   *
   * The WHOLE body is the contribution: every key the extension's schema
   * declares reaches {@link mergeObjectDefinitions}, never a hand-copied key
   * list. Only the two addressing keys are taken off it: `extend` becomes the
   * contribution's `name` (the object it registers under) and `priority` its
   * merge priority ({@link DEFAULT_EXTENDER_PRIORITY} when absent). The body
   * is the caller's PARSED body (`ObjectExtensionSchema`), so schema defaults
   * and the parse's own rewrites are already applied.
   *
   * Re-registering replaces the package's previous contribution to the object
   * (the `extend` arm of {@link registerObject}), so every sync that re-reads
   * the stored row can call this again. Refusals are {@link registerObject}'s.
   *
   * @returns the FQN registered under.
   */
  registerObjectExtension(
    extension: { extend: string; priority?: number } & Record<string, unknown>,
    packageId: string,
  ): string {
    // [#33949 codemod] The body moved to `registry-platform-global.ts` (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.registerObjectExtension.call(platformGlobalHost.of(this), extension, packageId);
  }

  /**
   * [#28858] Spellings of an `extend` already named, keyed
   * `spelled|resolved|package`. Per registry, for the reason
   * {@link shadowedExtensionQueueWarned} gives.
   */
  private extensionSpellingWarned = new Set<string>();

  private extensionTargetKey(name: string, packageId: string | undefined): string {
    // [#33949 codemod] The body moved to `registry-platform-global.ts`, its docblock with it (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.extensionTargetKey.call(platformGlobalHost.of(this), name, packageId);
  }

  /**
   * [#28574] Withdraw ONE package's `'extend'` contribution to an object — the
   * delete of that package's `object_extension` item. The owner, the overlay
   * layer and every other package's extension stay exactly where they are; a
   * package's whole set leaves with {@link unregisterObjectsByPackage}.
   *
   * @returns whether a contribution was removed (idempotent: `false` when the
   *   package contributes no extension to the object).
   */
  withdrawObjectExtension(name: string, packageId: string): boolean {
    // [#33949 codemod] The body moved to `registry-platform-global.ts` (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.withdrawObjectExtension.call(platformGlobalHost.of(this), name, packageId);
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
    // [#33949 codemod] The body moved to `registry-platform-global.ts` (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.removeObjectOverlay.call(platformGlobalHost.of(this), name);
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
    // [#33949 codemod] The body moved to `registry-platform-global.ts` (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.assertSingleOwnerPerObject.call(platformGlobalHost.of(this));
  }

  /**
   * [#21276] Would uninstalling `packageId` be refused? Throws the refusal
   * {@link unregisterObjectsByPackage} (and so {@link uninstallPackage}) would
   * raise, and returns normally otherwise. It reads `objectContributors` and
   * mutates nothing, so a caller can ask before a step it cannot take back:
   * `deletePackage` (`@objectstack/metadata-protocol`) asks it before it
   * deletes the stored `sys_packages` row, so an uninstall this registry would
   * refuse is refused with nothing removed.
   *
   * [#7970] THE REFUSAL PASS — the whole decision, taken before a single
   * contribution is removed. This check used to live inline in the mutation
   * walk of {@link unregisterObjectsByPackage}, one object at a time, so a
   * package owning `account` (free) and `contact` (extended by another
   * package) lost `account` on the way to refusing over `contact`: the guard
   * that exists to keep a registry whole was itself reached through a
   * mutation, and nothing rolled it back. Same predicate and same iteration
   * order as the inline check it replaced, so the same object still refuses
   * first.
   *
   * [#23505] The refusal is a {@link PackageUninstallExtendedError} —
   * `RESOURCE_CONFLICT` / 409, so the uninstall door answers a located client
   * refusal instead of its `500` fallback — and it names EVERY extended object
   * and every extending package, not only the first object the walk meets, so
   * its prescription is the whole way out. The decision is unchanged: the
   * package is refused exactly when the first such object exists.
   *
   * [#28408, ADR-0146 D3] It also refuses while this registry holds the
   * package's paired customization package named for `packageId` — one
   * of the ids {@link pairsOf} looks up for it (the App's pair is named for
   * the App, not for a member) — so the pair is
   * found by id alone, whichever door created or installed it. The same
   * refusal, carrying both causes when both hold. Uninstalling the pair itself
   * asks nothing of this kind: a `.custom` id derives no pair of its own. An
   * id that derives no valid pair id (`@acme/crm`) cannot have one installed,
   * so it is not asked either.
   *
   * ⛔ ONE predicate: {@link unregisterObjectsByPackage} calls this method
   * rather than keeping its own copy, so the question asked ahead and the
   * refusal raised by the uninstall cannot disagree. `force` is not a
   * parameter here: forcing means not asking, and stays the caller's choice.
   *
   * @throws PackageUninstallExtendedError (`RESOURCE_CONFLICT` / 409) if the
   *   package owns an object another package extends (ADR-0029), or its
   *   paired customization package is installed (ADR-0146 D3)
   */
  assertPackageUninstallable(packageId: string): void {
    const extended: ExtendedObjectOfUninstall[] = [];
    for (const [fqn, contributors] of this.objectContributors.entries()) {
      const ownedHere = contributors.some(
        c => c.packageId === packageId && c.ownership === 'own'
      );
      if (!ownedHere) continue;
      // Extenders from other packages
      const otherExtenders = contributors.filter(
        c => c.packageId !== packageId && c.ownership === 'extend'
      );
      if (otherExtenders.length > 0) {
        extended.push({ objectName: fqn, extenders: otherExtenders.map(c => String(c.packageId)) });
      }
    }
    // [ADR-0146 D3 · merge questions 11, 12] The installed pair named for
    // this package: the App's pair when this is the App (a member's
    // uninstall keeps and marks its overrides in the App's pair, and is not
    // refused for it), or the per-package pair an earlier version created
    // for this package.
    const installedPair = pairsOf(packageId, installedManifestsOf(this)).find(
      (id) => customizationBasePackageId(id) === packageId && this.getPackage(id) !== undefined,
    );
    if (extended.length > 0 || installedPair !== undefined) {
      throw new PackageUninstallExtendedError(packageId, extended, installedPair);
    }
  }

  /**
   * Unregister all objects contributed by a package.
   *
   * [#7970] **Refuses before it mutates.** If any object this package owns is
   * extended by another package (ADR-0029), the call throws having removed
   * nothing — the refusal is decided across every object first, by
   * {@link assertPackageUninstallable}. Callers may therefore treat a throw as
   * a no-op, which is what lets {@link uninstallPackage} run this verb ahead of
   * its own mutations.
   *
   * @throws PackageUninstallExtendedError (`RESOURCE_CONFLICT` / 409) if trying
   *   to uninstall an owner that has extenders, or a base whose paired
   *   customization package is installed — {@link assertPackageUninstallable}'s
   */
  unregisterObjectsByPackage(packageId: string, force: boolean = false): void {
    // [#33949 codemod] The body moved to `registry-platform-global.ts` (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.unregisterObjectsByPackage.call(platformGlobalHost.of(this), packageId, force);
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
    // [#33949 codemod] The body moved to `registry-platform-global.ts` (see `PlatformGlobalHost`).
    return PlatformGlobalFacet.unregisterObject.call(platformGlobalHost.of(this), name, options);
  }

  // ==========================================
  // Generic Metadata (Non-Object Types)
  // ==========================================

  /**
   * Universal Register Method for non-object metadata.
   *
   * @param options.storedRowPackage - [#33127, ADR-0150 D4] For a registration
   *   with no `packageId` (a stored `sys_metadata` row, the ADR-0005 overlay):
   *   the package the row is bound to (its `package_id` column). The row then
   *   takes that package's overlay slot ({@link overlaySlotKey}) instead of the
   *   name's one bare slot, so two packages' rows of one name, and a package's
   *   row beside its pair's or beside the package-less row, each keep their own
   *   entry, whatever order they are registered in. Judged as the bare slot is
   *   (it is an overlay, never a package's declaration), and read by every
   *   overlay-slot reader ({@link bareSlotEntriesOf}) and by {@link getItem}'s
   *   overlay tier. Ignored with a `packageId`.
   */
  registerItem<T>(type: string, item: T, keyField: keyof T = 'name' as keyof T, packageId?: string,
    options?: { storedRowPackage?: string }) {
    this.noteItemType(type);
    if (!this.metadata.has(type)) {
      this.metadata.set(type, new Map());
    }
    const collection = this.metadata.get(type)!;
    const baseName = String(item[keyField]);

    // The security catalog's item seam: a package registering a position,
    // permission set or capability under a name another holder holds is
    // refused BEFORE anything below stamps or stores it — the per-item
    // cross-package throw ADR-0048 §3.4 retired, kept for these three types
    // (maintainer ruling Q4 = A on #15196; `security-catalog-namespace.ts`).
    // The package door ({@link installPackage}) has already refused a package's
    // declared names, built-ins included; this is the seam every OTHER
    // package-bound registration reaches (a plugin declaring items through
    // the registry directly), so it asks the registered holders only — the
    // platform registers its own built-ins here, under its own package id.
    // ⛔ A registration with no `packageId` is the bare slot — `sys_metadata`
    // hydration, the metadata write-through — and is never judged here: an
    // environment save over a package-held name is outside the ruling.
    //
    // A BUILT-IN name is held by the platform, and the registration of one
    // here is the platform declaring its own name (`plugin-security`'s
    // `registerBuiltinPositions`, in its `start()`) — the holder's own
    // registration, never a second holder. Packages are refused built-in names
    // at the package door, and a second package registering one here is still
    // refused below (in either order: the other package's slot is a holder).
    // What is NOT asked for a built-in name is the environment catalog: an
    // environment item under a built-in name exists only because an
    // environment save went over the platform's name — outside the ruling — and
    // it is hydrated (`ObjectQLPlugin.start`, which every `start()` depending on
    // the engine follows) BEFORE the platform declares, so asking it would
    // refuse the platform's own declaration and with it the boot. The stored
    // definition keeps answering first from the bare slot (ADR-0005); the
    // declaration sits beside it.
    if (packageId && isSecurityCatalogType(type)) {
      const holders = this.securityCatalogHoldersOtherThan(type, baseName, packageId, {
        builtIns: false,
        environment: !BUILT_IN_SECURITY_CATALOG_NAMES[type].has(baseName),
        incomingNamespace: this.bareNameHolderNamespace(packageId),
      });
      if (holders.length > 0) {
        throw new SecurityCatalogNameConflictError(
          holders.map((existingHolder) => ({ catalogType: type, name: baseName, incomingPackageId: packageId, existingHolder })),
        );
      }
    }

    // One name, one package holder for the bare-name registry types (a
    // picklist, a mapping, a dataset, an API, an object-less action, a flow, a
    // webhook, a connector, an email template, an agent, a skill, a tool) — the item seam
    // (`bare-name-one-holder.ts`; ADR-0048 §3.4 narrowed). Once the cold boot
    // has sealed the holders, a package registering one under a name another
    // package holds — and that it does not hold itself — is refused BEFORE
    // anything below stamps or stores it. The package door has already judged
    // what a manifest declares; this is the seam every OTHER package-bound
    // registration reaches (a nested plugin's collections, a plugin
    // registering through the registry directly). ⛔ A registration with no
    // `packageId` is the environment catalog — the ADR-0005 overlay — and is
    // never judged; nor is a type's overridable baseline (the email service's
    // built-in templates), which holds nothing and is refused nothing.
    //
    // [ADR-0150 D9] For a bundled type this seam judges each arrival on the
    // holding as it stands: the members the package already holds, plus the one
    // arriving. ⛔ It never reads members still to come. A dependent declares
    // its members of another package's bundle in its manifest. The package door
    // then judges them as one set, and the claim it records exempts every later
    // arrival here, so the members are admitted alike in either order. Undeclared
    // members registered one by one are judged per arrival, which is
    // order-dependent under D9's addition test: a dependent's `de-DE` alone is
    // an addition to its base's `en-US` and is refused, while the same `de-DE`
    // after the dependent's own `en-US` joins a template of its own.
    if (packageId && isBareNameRegistryType(type) && holdsBareName(type, item) && !isOverridableBaseline(type, packageId)) {
      const gateDisc = ITEM_KEY_DISCRIMINATORS[type];
      const arriving = gateDisc ? new Set([discriminatorValue(item, gateDisc.field) || gateDisc.canonical]) : undefined;
      const holders = this.bareNameHoldersOtherThan(type, baseName, packageId, {
        builtIns: false,
        incomingNamespace: this.bareNameHolderNamespace(packageId),
        // [#31699] The incoming holding: what the package already holds of the
        // bundle, and the member this registration adds.
        incomingHolding: () => {
          const held = this.registeredBundleHolding(type, baseName, packageId);
          if (!held || arriving === undefined) return held;
          return { ...held, members: new Set([...held.members, ...arriving]) };
        },
        // [#32408, delta review N1] …and a holder's members read as if this
        // member were registered.
        incomingArrival: arriving === undefined ? undefined : { members: arriving },
      });
      if (holders.length > 0) {
        const rename = this.bareNameRenameFor(packageId, baseName);
        throw new BareNameConflictError(
          holders.map((existingHolder) => ({ type, name: baseName, incomingPackageId: packageId, existingHolder, rename })),
        );
      }
    }

    // [ADR-0150 D3, #31700; epic seat ruling R2-A, 6812862622] A picklist a
    // package registers on its own after the boot sealed the vocabulary — a
    // plugin or the metadata service registering through the registry
    // directly — meets the one re-judge an install meets, before anything
    // below stores it: a list of a name another namespace's package holds must
    // not leave an installed extension or reference with no one list
    // ({@link refusePicklistItemArrival}). Any registration under a package
    // fills that package's slot, a tenant-authored body included (contract
    // review 6815437823 must-fix 1): the holder's own overlay adds no holder
    // and passes. ⛔ Never a registration with no package: the environment
    // catalog.
    if (type === 'picklist' && packageId) {
      this.refusePicklistItemArrival(
        packageId,
        { picklists: [{ ...(item as object), name: baseName }] },
        `picklist '${baseName}' of package '${packageId}'`,
      );
    }

    // One default record page per object per deployment — the item seam
    // (maintainer ruling A on objectstack#23015; `default-record-page.ts`): a
    // package registering a page as the default record page of an object
    // another page already holds is refused BEFORE anything below stamps or
    // stores it. The package door ({@link installPackage}) has already judged
    // what a manifest declares; this is the seam every OTHER package-bound page
    // registration reaches (a nested plugin's pages, a plugin registering
    // through the registry directly). The package's own pages, and the
    // environment's overlay of this very page by name, are not a second
    // default. ⛔ A registration with no `packageId` is the bare slot —
    // `sys_metadata` hydration, the metadata write-through — and is never
    // judged here: the metadata save door refuses a second default before it
    // is stored.
    if (packageId && type === 'page') {
      // A page declaring `isDefault: true` that is not a record page bound to
      // an object is refused before it is judged as a holder (maintainer
      // ruling A on objectstack#23610) — the same sentence the page parse
      // prints at `os validate` and at save.
      const refusal = misplacedDefaultPageRefusal(item);
      if (refusal !== undefined) throw new MisplacedDefaultPageError(packageId, [{ page: baseName, refusal }]);
      // Every slot the page holds: its object's default, and one per app its
      // `apps` names (ruling A on objectstack#28979).
      const incoming: DefaultRecordPageHolder = { kind: 'package', packageId, page: baseName };
      const conflicts: DefaultRecordPageConflict[] = [];
      for (const slot of recordPageSlotsOf(item)) {
        for (const existing of this.otherDefaultRecordPageHolders(slot, baseName, packageId)) {
          conflicts.push({ ...slot, incoming, existing });
        }
      }
      if (conflicts.length > 0) throw new DefaultRecordPageConflictError(conflicts);
    }

    // ADR-0010 §3.7 — translate the author-facing `protection` block
    // into the private `_lock` envelope and stamp package provenance.
    // This call knows the package id only. A caller that holds the package's
    // manifest makes the artifact loader's own call first,
    // `applyProtection(item, { packageId, packageVersion })` (metadata/plugin.ts;
    // `ObjectQL.registerApp`, the engine's residual-object registration), and
    // `applyProtection` stamps a key only while it is unset and strips the
    // block it translated — so this call leaves that item's envelope as the
    // caller stamped it, and both load paths produce the same lock state and
    // package envelope. Every other caller gets the id alone.
    applyProtection(item as any, { packageId });

    // [#25649] A code package's action is stored as its `ActionSchema` parse —
    // `requiresFeature` / `requiresMembershipReach` lowered into `visible` —
    // or refused before anything below stores it ({@link parsePackageAction}).
    // After `applyProtection`, so the envelope the parse passes through is the
    // one this call stamped, and `isCodeArtifactBody` reads the stamped
    // provenance. ⛔ A registration with no `packageId` is the bare slot —
    // `sys_metadata` hydration, the metadata write-through — and is never
    // judged here: a stored row is parsed at the metadata save door.
    if (type === 'action' && packageId && isCodeArtifactBody(item)) {
      item = parsePackageAction(item, baseName, packageId) as T;
    }

    // A picklist's own values must not repeat any value its extensions
    // already add — refused before anything is stored, like the extension
    // side ({@link registerPicklistExtension}). Every resolved object depends
    // on the list, so the merged-object cache is dropped once it lands (below).
    if (type === 'picklist') this.assertPicklistValuesDistinct(baseName, item as any, packageId);

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

    // [#7730] The key carries the item's IDENTITY. For most types that is the
    // name alone; a discriminated type (see ITEM_KEY_DISCRIMINATORS) is keyed
    // by the pair its spec declares, so the members of an i18n bundle coexist
    // instead of the second one overwriting the first. An item that declares no
    // discriminator is keyed as the CANONICAL member — the same row the schema
    // default produces — so `{ name }` and `{ name, locale: 'en-US' }` remain
    // one item and a re-register stays idempotent.
    const disc = ITEM_KEY_DISCRIMINATORS[type];
    const withDisc = (base: string) =>
      disc ? withDiscriminator(base, discriminatorValue(item, disc.field) || disc.canonical) : base;

    // The bare (overlay) slot for this item — see the artifact-vs-DB warning below.
    const bareKey = withDisc(baseName);
    // Use composite key (packageId:name) when packageId is provided
    // [#33127] …and a stored row bound to a package its package's overlay slot.
    const rowPackage = !packageId && typeof options?.storedRowPackage === 'string' && options.storedRowPackage !== ''
      ? options.storedRowPackage
      : undefined;
    const storageKey = packageId
      ? withDisc(`${packageId}:${baseName}`)
      : rowPackage !== undefined ? overlaySlotKey(rowPackage, bareKey) : bareKey;

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
    // ⚠️ Except for the three security catalog types, refused at the top of this
    // method: a position or a capability is named with no package context, and
    // a permission set's name has one holder per namespace (ADR-0150 D2/D9,
    // `permissionSetHoldersMeet`), so there a second holder that meets the
    // first is an ambiguity no caller can resolve (maintainer ruling Q4 = A on
    // #15196). ⚠️ And except for the
    // bare-name types, refused (once the cold boot has sealed) at the top of
    // this method too: a field's picklist, an import's mapping and a dashboard's
    // dataset are resolved by name with no package (ruling C on #30798;
    // `bare-name-one-holder.ts`).
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
    // discoverable in the logs.
    //
    // [#12027] This guard covers ONE of the two orders — the package arriving
    // second, which at runtime means a late registration (marketplace install,
    // HMR reload), never a cold boot. The cold-boot order is covered by the
    // second guard below; read the two together.
    // [#7730] `bareKey` rather than `baseName`: for a discriminated type the
    // overlay slot this warning asks about is the bundle member with the SAME
    // discriminator (`auth.welcome@zh-CN`), not the name on its own — which is
    // a key no discriminated item is ever stored under.
    if (packageId && collection.has(bareKey)) {
      const dbOnly = collection.get(bareKey) as any;
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

    // [#12027] THE SAME COLLISION, IN THE ORDER A COLD BOOT ACTUALLY PRODUCES.
    //
    // The guard above carries `packageId &&`, so it only ever speaks when the
    // PACKAGE registers second. A kernel boot cannot produce that order: the
    // artifact reaches this registry in kernel Phase 1 (AppPlugin.init ->
    // `manifest.register` -> `ObjectQL.registerApp`), and `sys_metadata`
    // rehydration runs in Phase 2 (`ObjectQLPlugin.start` ->
    // `restoreMetadataFromDb` -> `loadMetaFromDb` -> the protocol's
    // `hydrateOverlayIntoRegistry`, which registers under the BARE key with no
    // packageId). Phase 1 strictly precedes Phase 2, so at boot the overlay is
    // always the second arrival and the guard above is structurally unreachable
    // — it fires only for a LATE package registration (marketplace install, a
    // post-`start()` `manifest.register`, an HMR reload).
    //
    // Measured on a real `@objectstack/example-crm` boot before this landed: a
    // stored `view` overlay of a packaged view produced 0 `[Registry] Collision`
    // lines and 4 silent shadowings (the container plus its three expanded
    // ViewItems). ADR-0005 §Collision-warning says this warning is what makes
    // the silent shadowing "discoverable in startup logs"; in the only order
    // startup produces, it was not discoverable at all.
    //
    // ## Why this is a SECOND message and not one message widened to fit both
    //
    // The two orders are the same end state (`getItem` checks the bare key
    // first, so the runtime row wins either way) reached by two different
    // events, and the event is the part an operator has to act on. Above: a
    // package just arrived and is DEAD ON ARRIVAL behind a row that predates
    // it. Here: a stored row just took over a definition this process already
    // loaded from code. A single message would have to drop which one arrived
    // second, which is precisely the fact that tells the reader whether they
    // are looking at a failed install or at a customization taking effect.
    //
    // ## Why it says "may be deliberate", and why it still fires by default
    //
    // Unlike the order above — where `!dbOnly._packageId` narrows to a
    // package-LESS row, i.e. an accidental name collision — this direction
    // cannot tell a deliberate customization from an accidental collision: the
    // protocol merges the artifact's `_packageId`/`_provenance` envelope onto
    // the overlay body (ADR-0010 §3.3 `mergeArtifactProtection`) before it
    // reaches this method, so both look identical here. The message therefore
    // states the consequence and both readings rather than accusing. It stays
    // at `warn` because a diagnostic nobody sees is the defect being fixed.
    //
    // Volume, measured rather than assumed (the #12015 discipline — a warning
    // that fires on every boot of a stock deployment is saying nothing):
    // 0 lines on a stock CRM boot, because a stock `sys_metadata` holds no
    // overlay of a packaged name; thereafter once per shadowed name per
    // process. `!collection.has(bareKey)` is what bounds it — the line marks
    // the TRANSITION (a bare slot that was empty is now taken), not the state,
    // so the read-side hydration and the write-through, which re-register the
    // same overlay on later reads and writes, stay silent.
    // [#33127] A package overlay slot marks the same transition for its own
    // key: the first row of its package to shadow the name.
    if (!packageId && !collection.has(storageKey) && (rowPackage === undefined || !collection.has(bareKey))) {
      let shadowed: any;
      for (const [key, existing] of collection) {
        if (key !== bareKey && key.endsWith(`:${bareKey}`) && isCodeArtifactBody(existing)) {
          shadowed = existing;
          break;
        }
      }
      if (shadowed) {
        console.warn(
          `[Registry] Collision: ${type}/${baseName} is shipped by package ` +
          `'${shadowed._packageId}' and a runtime-authored row with the same name has ` +
          `just been registered from sys_metadata. The runtime row now shadows the ` +
          `package value (ADR-0005 overlay precedence): every read of ${type}/${baseName} ` +
          `serves the stored row, not the packaged definition. That is the sanctioned ` +
          `path when the row is a deliberate customization — if it is not one, delete ` +
          `the sys_metadata row (or rename one of the two) so the package value serves.`,
        );
      }
    }

    // [ADR-0150 D4] A package-less action never erases a package-less action
    // of another owner key: the one it displaces from the bare slot keeps its
    // own key's slot ({@link keepPackagelessActionOwnerKeys}).
    if (type === 'action' && !packageId && rowPackage === undefined) {
      this.keepPackagelessActionOwnerKeys(collection, bareKey, item);
    }
    this.noteItem(type, storageKey);
    collection.set(storageKey, item);
    // [#33050] A slot the package's own body registration writes is one its
    // new version ships ({@link replacingPackageBody}).
    if (packageId !== undefined && this.openPackageBody?.packageId === packageId) {
      this.openPackageBody.written.add(packageBodySlot(type, storageKey));
    }
    if (type === 'picklist') this.invalidateAll();
    // [#24400] A bound action is attached to its target on read
    // ({@link attachBoundActions}); drop that object's cached fold.
    if (type === 'action') {
      const target = standaloneActionOwnerKey(item);
      if (!isObjectLessActionKey(target)) this.invalidate(target);
    }
    // [#28877] A flow can change whether an action launching it is withheld
    // ({@link isActionWithheldByDisabledPackage}), which only a disable makes
    // possible.
    if (type === 'flow' && this.hasDisabledPackage()) this.invalidateAll();
    this.log(`[Registry] Registered ${type}: ${storageKey}`);
  }

  private keepPackagelessActionOwnerKeys(collection: Map<string, any>, name: string, incoming: unknown): void {
    // [#33949 codemod] The body moved to `registry-items.ts`, its docblock with it (see `ItemsHost`).
    return ItemsFacet.keepPackagelessActionOwnerKeys.call(itemsHost.of(this), collection, name, incoming);
  }

  private packagelessActionEntryToRetire(collection: Map<string, any>, name: string): string {
    // [#33949 codemod] The body moved to `registry-items.ts`, its docblock with it.
    return ItemsFacet.packagelessActionEntryToRetire(collection, name);
  }

  private retirePackagelessActionSlot(collection: Map<string, any>, name: string, key: string): void {
    // [#33949 codemod] The body moved to `registry-items.ts`, its docblock with it (see `ItemsHost`).
    return ItemsFacet.retirePackagelessActionSlot.call(itemsHost.of(this), collection, name, key);
  }

  /**
   * Validate Metadata against Spec Zod Schemas
   */
  validate(type: string, item: any): unknown {
    // [#33949 codemod] The body moved to `registry-items.ts`.
    return ItemsFacet.validate(type, item);
  }

  /**
   * Universal Unregister Method
   */
  unregisterItem(type: string, name: string) {
    // Every resolved object may carry this list's options; the removal below
    // is synchronous, so the next fold re-resolves against the store without it.
    // [#24400] …and an object may carry this bound action ({@link attachBoundActions}).
    // [#28877] …or one that launches this flow while a package is disabled.
    if (type === 'picklist' || type === 'action' || (type === 'flow' && this.hasDisabledPackage())) this.invalidateAll();
    const collection = this.metadata.get(type);
    if (!collection) {
      console.warn(`[Registry] Attempted to unregister non-existent ${type}: ${name}`);
      return;
    }

    // [#7730] A discriminated type's name addresses a BUNDLE, so a withdrawal
    // by name takes the whole bundle — the same shape as the consumer side,
    // where `deactivateDeclaredEmailTemplate` sweeps `sys_email_template` by
    // name across locales because a delete event carries no locale. Removing
    // one member would leave the rest registered and re-seedable, i.e. an
    // undeletable template. The GROUP is chosen exactly as before (the bare
    // group if it exists, else the first composite group in insertion order),
    // so this does not start deleting a second package's same-named item.
    const disc = ITEM_KEY_DISCRIMINATORS[type];
    // [#33127] With no bare entry, the package overlay slots the overlay tier of
    // {@link getItem} reads first are the item's entries (one package's).
    const overlayGroup = (entries: BundleEntry[]): BundleEntry[] => {
      const first = this.orderedOverlayTier(type, collection, name, entries)[0];
      const pkg = first === undefined ? undefined : parseOverlaySlotKey(first.key)?.packageId;
      return entries.filter(({ key }) => parseOverlaySlotKey(key)?.packageId === pkg);
    };
    if (disc) {
      const { bare, local, other } = collectBundle(collection, name, disc);
      const overlays = bare.length > 0 ? [] : overlayGroup(overlaySlotEntriesOf(collection, name, disc));
      if (overlays.length > 0) {
        for (const { key } of overlays) {
          collection.delete(key);
          this.log(`[Registry] Unregistered ${type}: ${key}`);
        }
        return;
      }
      const group = bare.length > 0 ? bare : [...local, ...other];
      if (group.length === 0) {
        console.warn(`[Registry] Attempted to unregister non-existent ${type}: ${name}`);
        return;
      }
      const groupBase = bundleBaseKey(group[0].key);
      for (const { key } of group) {
        if (bundleBaseKey(key) !== groupBase) continue;
        collection.delete(key);
        this.log(`[Registry] Unregistered ${type}: ${key}`);
      }
      return;
    }

    if (collection.has(name)) {
      // [ADR-0150 D4] …and another owner key's package-less action takes the
      // bare slot it leaves ({@link retirePackagelessActionSlot}).
      if (type === 'action') this.retirePackagelessActionSlot(collection, name, name);
      else collection.delete(name);
      this.log(`[Registry] Unregistered ${type}: ${name}`);
      return;
    }
    const [overlay] = overlayGroup(overlaySlotEntriesOf(collection, name));
    if (overlay !== undefined) {
      collection.delete(overlay.key);
      this.log(`[Registry] Unregistered ${type}: ${overlay.key}`);
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
   * [#7221] Unregister every GENERIC metadata item a package shipped — the
   * counterpart of {@link unregisterObjectsByPackage}, which is addressed by
   * package too but reaches only `objectContributors`.
   *
   * ## Why this exists at all
   *
   * A package writes into TWO stores, and until this method only one of them
   * had a package-addressed removal verb. `unregisterObjectsByPackage` walks
   * `objectContributors`; every non-object item a package ships — its `page`,
   * `view`, `flow`, `app`, `api` … — lives in the generic `metadata` map under
   * the composite key {@link registerItem} builds, and nothing removed those.
   * Measured on the real registry before this method existed: after
   * `uninstallPackage('crm')` the package record was gone while
   * `getItem('page', 'home')` kept serving the uninstalled package's page, and
   * `metadata.get('flow')` still held `crm:onboard`, for the life of the
   * process. That is not a stale cache — it is an uninstall that leaves the
   * package's UI and API metadata installed.
   *
   * It is placed HERE, on the registry, rather than privately on
   * `MetadataFacade`, because the measurement above says both callers have the
   * gap: {@link uninstallPackage} is registry-direct and shares it exactly. A
   * private copy in the facade would have been a second expression of the
   * "which key belongs to which package" rule (#6808's drift), and would have
   * left every registry-direct uninstall still half-done.
   *
   * ## Identity, expressed once
   *
   * Membership is the exact inverse of the construction in `registerItem`:
   * that method stores under `${packageId}:${baseName}` (plus the `@<disc>`
   * suffix for a discriminated type), so a key belongs to this package iff it
   * starts with `${packageId}:`. The discriminator rides along at the end and
   * needs no special handling here — the whole bundle leaves with the package
   * that shipped it, which is the same "a name addresses the BUNDLE" rule
   * `unregisterItem` applies. The prefix relation assumes a package id
   * contains no `:`, the same assumption `getItem`'s composite scan already
   * makes with `key.endsWith(':' + name)`.
   *
   * ## ⛔ What this deliberately does NOT take, and why it says so out loud
   *
   * BARE-key entries are left untouched. A bare key is the ADR-0005
   * runtime/DB overlay slot — a tenant's own customization, rehydrated from
   * `sys_metadata` — and it carries no package provenance, so an uninstall
   * that deleted it would take a tenant's authored data along with the package
   * it merely overlaid. Nobody authorised that delete, and this verb does not
   * invent the authorisation.
   *
   * That leaves a real consequence: an overlay whose base has just been
   * uninstalled now layers over nothing. This registry's house pattern for
   * exactly that state is to make it LOUD rather than to silently delete it or
   * silently keep it — {@link assertSingleOwnerPerObject}'s ADR-0029 D9.5
   * orphan-overlay violation names the offender and tells the operator to
   * "re-install the package that owns it, or delete the sys_metadata row", and
   * {@link unregisterObjectsByPackage} refuses loudly rather than quietly
   * tearing down an object other packages extend. So this method warns, naming
   * every orphaned overlay it left behind, and returns them so a caller that
   * wants to act on them can.
   *
   * ⚠️ Deliberately NOT the object-side D9.7 rule ("an overlay layer leaves
   * with the base it layers over"). That rule is safe precisely because an
   * object overlay LAYER is a runtime projection of a `sys_metadata` row the
   * removal does not touch, so a re-install re-hydrates it and nothing durable
   * is lost. A bare-key generic entry is the other way round: it IS the
   * runtime face of that row and there is no separate contributor list holding
   * the durable copy, so dropping it here would lose the tenant's edit.
   *
   * @param packageId The package being uninstalled.
   * @returns `removed` — the storage keys taken, as `type/key`; and
   *   `orphanedOverlays` — the bare-key overlays deliberately left behind that
   *   now have no base, as `type/name`.
   */
  unregisterItemsByPackage(packageId: string): { removed: string[]; orphanedOverlays: string[] } {
    // [#33949 codemod] The body moved to `registry-items.ts` (see `ItemsHost`).
    return ItemsFacet.unregisterItemsByPackage.call(itemsHost.of(this), packageId);
  }

  // ==========================================
  // [#33050] A re-registered body replaces what its package shipped
  // ==========================================

  /**
   * Package id → the item slots its last body registration wrote
   * ({@link replacingPackageBody}), as {@link packageBodySlot} spells them.
   * Forgotten by {@link uninstallPackage}.
   */
  private readonly packageBodyItems = new Map<string, ReadonlySet<string>>();

  /** [#35609] Package id → the extension layers its last body wrote, by object key (see `ItemsFacet`). */
  private readonly packageBodyExtensions = new Map<string, ReadonlyMap<string, ObjectContributor>>();

  /** The body registration {@link replacingPackageBody} has open, while it runs. */
  private openPackageBody: { readonly packageId: string; readonly written: Set<string> } | undefined;

  /**
   * [#33050] Run `register` — the registration of one package body (the
   * engine's `registerApp`) — and then withdraw what the package's PREVIOUS
   * body registration shipped and this one does not: the item slots it wrote
   * that this run did not write again, and the bare-name and security catalog
   * claims its manifest no longer declares. An upgrade or a re-install is then
   * what the next boot would register from the new body, at once: before this
   * a tool or flow the new version dropped stayed registered, kept its bare
   * name (another package declaring it was refused as a second holder) and was
   * gone only after a restart.
   *
   * The body is the unit, as it is for the navigation contributions
   * (`setPackageNavContributions`) and the default record page claims
   * (`recordDefaultRecordPageClaims`), which a re-registration already
   * replaces. ⛔ What is withdrawn is exactly what the previous BODY
   * registration wrote under the package's id, never everything under its
   * prefix: an item registered under the id outside a body (a stack residual
   * owned by the id, a plugin's own `registerItem` under it) and an
   * environment overlay in the bare slot (ADR-0005) are not the body's and are
   * left as they are. A first registration withdraws nothing.
   *
   * Withdrawn inside the open {@link restoringOnRefusal} run, each slot and
   * claim recorded before it is removed, so a refusal later in the run (a later
   * member of the artifact, the run-end record-currency door) puts them back
   * with the rest of the installed version. `register` throwing withdraws
   * nothing. Owned objects are not items and are not touched here.
   *
   * [#35609] An extension the previous body registered for a target the new
   * body no longer extends is withdrawn (`withdrawObjectExtension`), the whole
   * layer with it; stored column data is not touched, and a layer another door
   * put under the package id is kept.
   */
  replacingPackageBody<T>(packageId: string | undefined, manifest: ObjectStackManifest, register: () => T): T {
    // [#33949 codemod] The body moved to `registry-items.ts` (see `ItemsHost`).
    return (ItemsFacet.replacingPackageBody<T>).call(itemsHost.of(this), packageId, manifest, register);
  }

  private withdrawPackageBodyItemsNotShipped(packageId: string, previous: ReadonlySet<string>, written: ReadonlySet<string>): void {
    // [#33949 codemod] The body moved to `registry-items.ts`, its docblock with it (see `ItemsHost`).
    return ItemsFacet.withdrawPackageBodyItemsNotShipped.call(itemsHost.of(this), packageId, previous, written);
  }

  private withdrawPackageClaimsNotDeclared(packageId: string, manifest: ObjectStackManifest): void {
    // [#33949 codemod] The body moved to `registry-items.ts`, its docblock with it (see `ItemsHost`).
    return ItemsFacet.withdrawPackageClaimsNotDeclared.call(itemsHost.of(this), packageId, manifest);
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
   *
   * @param member - [#22877] For a type whose identity is a pair
   *   ({@link ITEM_KEY_DISCRIMINATORS}), the bundle member to answer, as its
   *   discriminator value (`'zh-CN'`); omitted, the canonical member. Ignored
   *   for every other type, which has no members.
   */
  getItem<T>(type: string, name: string, currentPackageId?: string, member?: string): T | undefined {
    // [#33949 codemod] The body moved to `registry-items.ts` (see `ItemsHost`).
    return (ItemsFacet.getItem<T>).call(itemsHost.of(this), type, name, currentPackageId, member);
  }

  // ==========================================
  // Package-scoped addressing (ADR-0150 D3/D4, #31575)
  // ==========================================
  //
  // The registry half of the shared package-scoped resolver
  // (`package-scoped-resolver.ts`): who holds a name, one package's item of it
  // with the per-package overlay slot applied, and the environment's own item.
  // ⛔ Additive and read-only: no reader is switched to these, and {@link getItem}
  // keeps its bare-slot-first answer for every caller (ADR-0150 Execution plan,
  // child R: "not wired to any reader yet").

  private overlaySlotBinding(type: string, item: unknown, name: string, collection: Map<string, any>, holders?: ReadonlySet<string>): string | null | undefined {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts`, its docblock with it (see `PackageAddressingHost`).
    return PackageAddressingFacet.overlaySlotBinding.call(packageAddressingHost.of(this), type, item, name, collection, holders);
  }

  /**
   * [#32561] The package a stored row `item` of `(type, name)` binds to, read
   * by the one rule every overlay-slot reader asks ({@link overlaySlotBinding},
   * {@link pairRowBinding} for a customization pair's row), over the holders
   * the exact read serves: a package id, `null` for the environment's own
   * item, or `undefined` for no package. The exact read (`pairRowOnAddress`,
   * `@objectstack/metadata-protocol`) adopts it for an undeclared pair row, so
   * `?package=X` never serves a row this binds to no package: one a bundle
   * addition that ships the row's member could own too, or one whose count
   * would read another shared pair's undeclared row (epic ruling on #32561,
   * red line 2). Read-only.
   *
   * A disabled package holds no name (ADR-0150 D3, as
   * {@link packageScopedHoldersOf} counts by default), so it is left out of
   * this count, as the exact read leaves it out of its own: with one of two
   * holders disabled, the enabled one's address keeps the row (#32183, epic
   * ruling R4-A). It is left out in the order {@link packageScopedHoldersOf}
   * uses: the pair's owners are the served holders it customizes, but the
   * bundle-addition rule ({@link ownersHoldingAName}) is settled over EVERY
   * holder, so a disable never promotes a dependent's addition to an owner
   * (a package that adds only to a disabled holder's bundle stays an
   * addition, as the exact read counts it). The holders are the ones
   * {@link packageScopedHoldersOf} counts: every composite slot, then the
   * package a bare-slot entry binds to, so a package holding the name only
   * through its own stored row is a holder here too. {@link overlaySlotBinding}
   * itself counts every holder, so a disable never moves the binding the
   * registry's own readers answer. With `includeDisabledPackages` a disabled
   * holder counts as served, for a reader whose answer must not move with a
   * disable (the read-side hydrator's envelope for a pair row, #32692).
   */
  overlayRowBinding(type: string, name: string, item: unknown, options?: { includeDisabledPackages?: boolean }): string | null | undefined {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return PackageAddressingFacet.overlayRowBinding.call(packageAddressingHost.of(this), type, name, item, options);
  }

  private pairRowBinding(type: string, pairId: string, item: unknown, name: string, collection: Map<string, any>,
    composite: ReadonlySet<string>): string | undefined | typeof NOT_A_PAIR_ROW_OF_A_HOLDER {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts`, its docblock with it (see `PackageAddressingHost`).
    return PackageAddressingFacet.pairRowBinding.call(packageAddressingHost.of(this), type, pairId, item, name, collection, composite);
  }

  /**
   * [#32408] The arms of {@link pairRowBinding} that read the row and the
   * holders alone: {@link NOT_A_PAIR_ROW_OF_A_HOLDER}, the declared holder (or
   * `undefined` for a declared non-owner), or the App whose own pair it is.
   * The owners, as an array, when none of those answers: the undeclared row
   * of a pair two or more holders share, which only a count of the holders'
   * members decides ({@link ownersHoldingAName}).
   */
  private settledPairRowBinding(pairId: string, item: unknown, composite: ReadonlySet<string>):
    string | undefined | typeof NOT_A_PAIR_ROW_OF_A_HOLDER | readonly string[] {
    if (customizationBasePackageId(pairId) === null) return NOT_A_PAIR_ROW_OF_A_HOLDER;
    const installed = installedManifestsOf(this);
    const owners = [...composite].filter((holder) => isPairOf(pairId, holder, installed));
    if (owners.length === 0) return NOT_A_PAIR_ROW_OF_A_HOLDER;
    const declared = declaredOverrideBase(item);
    if (declared !== undefined) return owners.includes(declared) ? declared : undefined;
    const app = owners.find((holder) => {
      if (appOf(holder, installed) !== holder) return false;
      const pair = pairOf(holder, installed);
      return pair.ok && pair.value === pairId;
    });
    if (app !== undefined) return app;
    return owners.length === 1 ? owners[0] : owners;
  }

  private ownersHoldingAName(type: string, name: string, collection: Map<string, any>, owners: readonly string[],
    row: unknown, composite: ReadonlySet<string>, pairId: string): readonly string[] {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts`, its docblock with it (see `PackageAddressingHost`).
    return PackageAddressingFacet.ownersHoldingAName.call(packageAddressingHost.of(this), type, name, collection, owners, row, composite, pairId);
  }

  private compositeHoldersOf(collection: Map<string, any>, name: string): string[] {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts`, its docblock with it.
    return PackageAddressingFacet.compositeHoldersOf(collection, name);
  }

  /**
   * [ADR-0150 D3] Every package that holds `(type, name)`, in the item store's
   * order: each composite `<packageId>:<name>` slot, then the package a
   * bare-slot entry is its own stored item of ({@link overlaySlotBinding}) when
   * that package holds no composite slot. An overlay of a package's item adds
   * no holder (it is that package's item), a package-less row over a held name
   * adds none (ADR-0150 D3: a customization, never a second item), and the
   * environment's own item is no package holder ({@link getEnvironmentScopedItem}).
   *
   * Every package, overridable baselines included: the resolver ranks them
   * (`package-scoped-resolver.ts`). An object is not addressed by package
   * (ADR-0150 D1 bucket 1) and answers `[]`.
   *
   * [#28802, epic #31527 child R2] A bundle ADDITION holds no name: a
   * package whose members of a bundled type's name are all members another
   * holder in its declared dependency closure does not hold (a dependent's
   * locale its base does not ship, which the write gate admits and which
   * stays under the dependent) adds to that holder's bundle, so it is no
   * second holder of the name for a bare read. The addition is still the
   * dependent's member: {@link getPackageScopedItem} naming the dependent
   * reads it. A package holding a member its dependency also holds is a
   * holder (a clash, refused by the resolver, never folded away).
   *
   * [#32183, ADR-0150 D3] The SERVED holders: a package that is disabled
   * ({@link isPackageDisabled}, the predicate {@link listItems} hides its
   * items by) holds no name, so a by-name door judges the same holders the
   * list shows. Disable is reversible: its items stay registered, and its
   * holding counts again on enable. The caller's own holding stays, as for a
   * bundle addition, so a caller inside a disabled package answers as before.
   * The disabled holders leave the set the bundle-addition rule settled: a
   * disable never promotes a dependent's addition to a holder of the name.
   * `options.includeDisabledPackages` reads every holder, disabled or not —
   * the read a DURABLE judgment takes (a backfill binding a stored row, the
   * stored-reference report, the load audit), because a binding must not
   * move with a reversible disable. The install gate reads its own set
   * (`bareNamePackageHolders`) and is not this read.
   *
   * @param callerPackageId - The package a bare read is made from. Its own
   *   holding stays in the set even when it is an addition, so its step 1
   *   (its own item, ADR-0150 D3) answers as before: the addition only stops
   *   counting toward OTHER callers' ambiguity (epic seat review 6729484996).
   */
  packageScopedHoldersOf(type: string, name: string, callerPackageId?: string | null,
    options?: { includeDisabledPackages?: boolean }): string[] {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return PackageAddressingFacet.packageScopedHoldersOf.call(packageAddressingHost.of(this), type, name, callerPackageId, options);
  }

  private bundleMembersHeldBy(type: string, collection: Map<string, any>, name: string, packageId: string,
    holders: ReadonlySet<string>, disc: { field: string; canonical: string }, atGate = false): Set<string> {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts`, its docblock with it (see `PackageAddressingHost`).
    return PackageAddressingFacet.bundleMembersHeldBy.call(packageAddressingHost.of(this), type, collection, name, packageId, holders, disc, atGate);
  }

  private gateSlotBinding(type: string, item: unknown, name: string, collection: Map<string, any>,
    holders: ReadonlySet<string>): string | null | undefined {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts`, its docblock with it (see `PackageAddressingHost`).
    return PackageAddressingFacet.gateSlotBinding.call(packageAddressingHost.of(this), type, item, name, collection, holders);
  }

  /**
   * [#28802] Whether `packageId`'s holding of a bundle's name is an addition
   * to another holder's bundle: some other holder is in `packageId`'s declared
   * dependency closure (the save door's walk), `packageId` is not in that
   * holder's, and none of `packageId`'s members is one that holder holds.
   */
  private isBundleAddition(packageId: string, membersOf: ReadonlyMap<string, ReadonlySet<string>>,
    codeMembersOf?: ReadonlyMap<string, ReadonlySet<string>>): boolean {
    const own = membersOf.get(packageId)!;
    const reach = new Set(packageDependencyClosure(packageId, this)?.dependencies ?? []);
    // [#33127] With `codeMembersOf`, a member both packages hold only as
    // stored rows is no clash: the registry used to keep ONE row per member,
    // so one of the two was never counted and the base held the name, in
    // either row order. The package overlay slots keep both rows; this keeps
    // that judgment. A member either package ships in code still clashes.
    const clashes = (base: string, m: string): boolean => codeMembersOf === undefined
      || codeMembersOf.get(packageId)?.has(m) === true || codeMembersOf.get(base)?.has(m) === true;
    for (const [base, baseMembers] of membersOf) {
      if (base === packageId || !reach.has(base)) continue;
      if (packageDependencyClosure(base, this)?.dependencies.includes(packageId)) continue;
      if ([...own].some((m) => baseMembers.has(m) && clashes(base, m))) continue;
      return true;
    }
    return false;
  }

  /**
   * [ADR-0150 D3/D4] Package `packageId`'s item of `(type, name)`: the bare-slot
   * entry when it binds to `packageId` (its ADR-0005 overlay, or its own
   * stored item — {@link overlaySlotBinding}), else its composite slot. ⛔ Never
   * another package's overlay and never the environment's own item: overlaying
   * one package's item never shadows another package's same-named item, which
   * is the one difference from {@link getItem}'s bare-slot-first answer.
   *
   * A row of the App's pair (shared by every package of the App) binds as the
   * exact read binds it ({@link overlaySlotBinding}, `pairRowBinding`): a
   * row declaring another holder as the base it customizes
   * (`overrides.package`, ADR-0146 D2) is that holder's, so the App's address
   * falls to the App's own item (#31699, epic ruling; #32408). A row of a
   * `<base>.custom` pair that customizes none of the holders keeps the
   * per-package reading, and one declaring another holder is skipped here
   * (`pairRowDeclaresAnotherHolder`).
   *
   * @param member - As on {@link getItem}: one bundle member, for a type whose
   *   identity is a pair; omitted, the canonical member first.
   */
  getPackageScopedItem<T>(type: string, name: string, packageId: string, member?: string): T | undefined {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return (PackageAddressingFacet.getPackageScopedItem<T>).call(packageAddressingHost.of(this), type, name, packageId, member);
  }

  /**
   * [ADR-0150 D1 bucket 4, D3] The environment's own item of `(type, name)`:
   * the bare-slot entry when it binds to no package ({@link overlaySlotBinding}
   * answers `null`) — an item authored in this environment, in the implicit
   * environment package, under a name no package holds. `undefined` when the
   * bare slot is empty, holds a package's overlay, or holds a package-less
   * row over a name packages hold (a customization, never a second item).
   *
   * @param member - As on {@link getItem}.
   */
  getEnvironmentScopedItem<T>(type: string, name: string, member?: string): T | undefined {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return (PackageAddressingFacet.getEnvironmentScopedItem<T>).call(packageAddressingHost.of(this), type, name, member);
  }

  /**
   * [ADR-0150 D4] Every environment-scoped `action` item of `name`
   * ({@link getEnvironmentScopedItem}'s test), one per owner key: the bare
   * slot's, then each other owner key's package-less action
   * ({@link packagelessActionSlotKey}). An action is identified by its owner
   * key too, so a reader of one owner key (`actionOwnerScopedRegistry`) finds
   * the item on its key, never only the bare slot's of another key.
   */
  getEnvironmentScopedActions<T>(name: string): T[] {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return (PackageAddressingFacet.getEnvironmentScopedActions<T>).call(packageAddressingHost.of(this), name);
  }

  /**
   * [ADR-0150 D3, #31680 child E8] Does a by-name read of `type` consult
   * `(package, name)` — is it one of `PACKAGE_SCOPED_READ_TYPES`
   * (`package-scoped-read.ts`)? Asked by a reader that picks its path before
   * it reads, such as the protocol's by-name read.
   */
  readsByPackage(type: string): boolean {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts`.
    return PackageAddressingFacet.readsByPackage(type);
  }

  /**
   * [ADR-0150 D3, #31680 child E8] The by-name read for a caller. A type of
   * `PACKAGE_SCOPED_READ_TYPES` resolves through the ONE package-scoped
   * resolver (`readPackageScopedItem` over `resolvePackageScopedName`): the
   * caller's own item, else the unique holder in its declared closure; for a
   * caller with no package the environment's own item, else the unique package
   * holder. Every other type is {@link getItem}'s, unchanged, until its own
   * child of epic #31527 wires it.
   *
   * @param callerPackageId - The package the caller belongs to; omitted or
   *   `null` is a caller with no package (the whole environment).
   * @returns the item, or `undefined` when nothing holds the name.
   * @throws {PackageScopedNameRefusedError} when the resolver refuses — never
   *   `undefined` for a name that means more than one item, or only items the
   *   caller may not reach.
   */
  resolveItem<T>(type: string, name: string, callerPackageId?: string | null, member?: string): T | undefined {
    if (type === 'doc' && !callerPackageId) return this.readBareDoc<T>(name, member);
    if (!isPackageScopedReadType(type)) return this.getItem<T>(type, name, callerPackageId ?? undefined, member);
    return readPackageScopedItem<T>(this, { type, name, callerPackageId, member });
  }

  private readBareDoc<T>(name: string, member?: string): T | undefined {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts`, its docblock with it (see `PackageAddressingHost`).
    return (PackageAddressingFacet.readBareDoc<T>).call(packageAddressingHost.of(this), name, member);
  }

  /**
   * [ADR-0150 D5, #31697] The by-name read of an action that names no package
   * and no object (`GET /meta/action/NAME`): when the object-less holders of
   * `name` resolve to no one, the read is refused naming each
   * (`409 RESOURCE_CONFLICT`), never the first registered — two namespaces'
   * packages may each hold the name once the action's one-holder rule
   * narrowed to the namespace. Resolved by the ONE rule over the object-less
   * holders ({@link resolveActionByPackage} for a caller with no package),
   * with the classification the action doors apply (review 6762242732 F3,
   * F4):
   *
   *  - a package-less item is the ENVIRONMENT's own — it answers first, as
   *    before — only when the environment's store holds an active
   *    package-less row of the name that is itself object-less
   *    (`readStoredRows`, the protocol's by-name row read). Otherwise it is
   *    code the host or a plugin registered with no package: the PLATFORM's,
   *    one more holder, refused beside a package holder, naming both. With no
   *    `readStoredRows`, every package-less item is the platform's. The store
   *    is read only when a package-less item stands beside a package holder,
   *    and a read that throws travels to the caller (ADR-0110 D3).
   *  - a DISABLED package is no holder: the merged listings and the by-name
   *    read withhold its item (#25308), so it neither answers nor makes the
   *    enabled holder's read refuse.
   *
   * An action bound to an object is not judged here: the protocol's by-name
   * read counts {@link packageScopedHoldersOf}, which keys an action by package
   * and name whatever its object, and refuses two or more enabled package
   * holders itself (ADR-0150 D3, #32244).
   *
   * @throws {PackageScopedNameRefusedError} when the object-less holders refuse.
   */
  async refuseAmbiguousObjectLessAction(
    name: string,
    readStoredRows?: () => Promise<readonly { package_id?: string | null; metadata?: unknown }[]>,
  ): Promise<void> {
    const live: PackageScopedRegistry = {
      getPackage: (id) => this.getPackage(id),
      getAllPackages: () => this.getAllPackages(),
      packageScopedHoldersOf: (type, holderName) =>
        this.packageScopedHoldersOf(type, holderName).filter((id) => !this.isPackageDisabled(id)),
      getPackageScopedItem: (type, itemName, packageId, member) =>
        this.isPackageDisabled(packageId) ? undefined : this.getPackageScopedItem(type, itemName, packageId, member),
      getEnvironmentScopedItem: (type, itemName, member) => this.getEnvironmentScopedItem(type, itemName, member),
      getEnvironmentScopedActions: <T>(itemName: string) => this.getEnvironmentScopedActions<T>(itemName),
    };
    const objectLess = actionOwnerScopedRegistry(live, GLOBAL_ACTION_OBJECT_KEY);
    const packages = objectLess.packageScopedHoldersOf('action', name);
    // Every package-less object-less item of the name, bound or not: the
    // registry reads one over a held name as that holder's overlay (ADR-0150
    // D4), which only the environment's own row is — host code's is not.
    const collection = this.metadata.get('action');
    const packageless = collection === undefined ? undefined : this.bareSlotEntriesOf('action', collection, name)
      .map(({ item }) => item)
      .find((item) => item !== null && typeof item === 'object' && !(item as any)._packageId
        && isObjectLessActionKey(standaloneActionOwnerKey(item)));
    if (packageless !== undefined && packages.length > 0
      && !(readStoredRows !== undefined && storesObjectLessPackagelessRow(await readStoredRows()))) {
      const resolution = resolvePackageScopedHolders(
        { type: 'action', name, callerPackageId: null },
        {
          packageHolders: packages,
          packageItem: (packageId) => objectLess.getPackageScopedItem('action', name, packageId),
          environmentItem: () => undefined,
          platformItem: () => packageless,
        },
        () => new Set<string>(),
      );
      if (resolution.status === 'refused') throw new PackageScopedNameRefusedError(resolution);
      return;
    }
    const resolution = resolveActionByPackage(live, { objectName: GLOBAL_ACTION_OBJECT_KEY, actionName: name, callerPackageId: null });
    if (resolution.status === 'refused') throw new PackageScopedNameRefusedError(resolution);
  }

  private bareSlotEntriesOf(type: string, collection: Map<string, any>, name: string): BundleEntry[] {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts`, its docblock with it.
    return PackageAddressingFacet.bareSlotEntriesOf(type, collection, name);
  }

  private rankedForPackage(entries: readonly BundleEntry[], packageId: string): BundleEntry[] {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts`, its docblock with it.
    return PackageAddressingFacet.rankedForPackage(entries, packageId);
  }

  /**
   * [#33127, ADR-0150 D4] Retire the package overlay slots of `(type, name)`
   * whose package `select` picks ({@link registerItem}'s `storedRowPackage`):
   * one bundle member's (`member`, its discriminator value) or, with none
   * named, every member's. The heal of a removed stored row
   * (`restoreArtifactRegistryView`, metadata-protocol) retires the removed
   * row's own slot, and only it: another package's row and the package-less
   * row keep their entries. A slot holds a stored row by construction, never
   * a packaged artifact. Touches no bare and no composite slot.
   *
   * @returns the packages whose slot was retired.
   */
  removePackageOverlaySlots(type: string, name: string, member: string | undefined, select: (packageId: string) => boolean): string[] {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return PackageAddressingFacet.removePackageOverlaySlots.call(packageAddressingHost.of(this), type, name, member, select);
  }

  private orderedOverlayTier(type: string, collection: Map<string, any>, name: string, entries: readonly BundleEntry[],
    preferred?: string): BundleEntry[] {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts`, its docblock with it (see `PackageAddressingHost`).
    return PackageAddressingFacet.orderedOverlayTier.call(packageAddressingHost.of(this), type, collection, name, entries, preferred);
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
   *
   * @param member - [#22877] As on {@link getItem}: one bundle member's
   *   artifact, for a type whose identity is a pair. Omitted, the bundle's
   *   artifact canonical-first, as before.
   */
  getArtifactItem<T>(type: string, name: string, currentPackageId?: string, member?: string): T | undefined {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return (PackageAddressingFacet.getArtifactItem<T>).call(packageAddressingHost.of(this), type, name, currentPackageId, member);
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
   *
   * @param member - [#22877] For a type whose identity is a pair, the ONE
   *   bundle member whose shadow to lift, as its discriminator value. Named,
   *   only that member's shadow goes, and only when the package ships that
   *   member [#23074]: a packaged artifact of the MEMBER remains, so the
   *   member stays resolvable. Omitted, the bundle's whole shadow group, when
   *   any member's artifact remains, as before.
   */
  removeRuntimeShadow(type: string, name: string, member?: string): boolean {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return PackageAddressingFacet.removeRuntimeShadow.call(packageAddressingHost.of(this), type, name, member);
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
   * @param member - [#22877] As on {@link removeRuntimeShadow}: the ONE bundle
   *   member whose entry to retire; omitted, the whole overlay group.
   * @returns whether an entry was removed.
   */
  removeOverlayEntry(type: string, name: string, member?: string): boolean {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return PackageAddressingFacet.removeOverlayEntry.call(packageAddressingHost.of(this), type, name, member);
  }

  /**
   * Universal List Method
   *
   * [#29871] `options.includeDisabledPackages` keeps a disabled package's
   * items. Only the protocol's per-package layer passes it (the package
   * export, which carries a package's own items enabled or not); every
   * served read leaves it unset and hides them.
   *
   * [#29903, #29872] `options.withoutExtensionsOf` / `options.onlyExtensionsOf`
   * resolve each listed object with those `extend` contributions left out of
   * the fold ({@link getAllObjects}); no other type reads them. The per-package
   * layer passes `onlyExtensionsOf`, naming the listed package, so a base's
   * export carries the base's objects unchanged by its `.custom` pair and by
   * every other package that extends them.
   */
  listItems<T>(type: string, packageId?: string, options?: { includeDisabledPackages?: boolean } & ObjectExtensionFoldOptions): T[] {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return (PackageAddressingFacet.listItems<T>).call(packageAddressingHost.of(this), type, packageId, options);
  }

  /**
   * Whether a package has been explicitly disabled. Unknown packages and
   * items with no owning package are treated as enabled.
   */
  isPackageDisabled(packageId?: string): boolean {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return PackageAddressingFacet.isPackageDisabled.call(packageAddressingHost.of(this), packageId);
  }

  /**
   * [#7557] Whether `name` addresses an object whose OWNING package is
   * disabled — the object-shaped question {@link isPackageDisabled} cannot
   * answer on its own, because an object's `_packageId` is a decoration
   * applied by {@link getAllObjects} and is absent from a bare
   * {@link getObject} read.
   *
   * Name resolution deliberately reuses {@link resolveObjectKey}, the same
   * name→FQN half the READ path uses. That is the #6808 lesson applied to
   * enforcement: a gate that resolved names its own way could refuse an entry
   * `getObject` never serves — or, worse, wave through the one it does. One
   * resolution, so the read and the refusal cannot disagree about which
   * contributor entry a bare name addresses.
   *
   * Asks about the OWNER (`ownership: 'own'`), not about every contributor: an
   * overlay contributed by a disabled package must not take the object it
   * decorates offline with it.
   */
  isObjectPackageDisabled(name: string): boolean {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return PackageAddressingFacet.isObjectPackageDisabled.call(packageAddressingHost.of(this), name);
  }

  /**
   * [#28877] Whether `name` addresses a flow that ONLY disabled packages ship:
   * at least one registered flow of that name, and every one of them owned by
   * a disabled package. Those are the flows a disable takes out of the
   * automation engine's binding (it binds from the list, which omits a
   * disabled package's items), so a launch of `name` answers "Flow not found".
   * A flow some enabled package or an overlay row also serves, and a name the
   * registry holds no flow of (a runtime-authored flow it never hydrated), are
   * not disabled.
   */
  isFlowOfDisabledPackage(name: string): boolean {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return PackageAddressingFacet.isFlowOfDisabledPackage.call(packageAddressingHost.of(this), name);
  }

  /**
   * [#24400, #28877] Whether a disable withholds `action` from the served
   * reads: the action's own package is disabled (#24400: a disabled package's
   * bound actions are withdrawn), or it LAUNCHES into a disabled package, where
   * the launch could only fail (#28117 ruling A: disabled = hidden, and refused
   * on the data plane):
   *
   *  - an action bound by `objectName` to an object of a disabled package: the
   *    object's own read is refused, so the action is not listed beside it;
   *  - a `type: 'flow'` action whose `target` is a flow only disabled packages
   *    ship ({@link isFlowOfDisabledPackage}): its launch answers "Flow not
   *    found";
   *  - an action with a param whose `objectOverride` names an object of a
   *    disabled package ({@link isObjectPackageDisabled}): its dialog backs the
   *    param by a field of an object the data plane refuses.
   *
   * The ONE predicate for both faces: the registry's served object fold
   * ({@link attachBoundActions}) and the protocol's `action` list and by-name
   * read. An action that merely names such an object anywhere else (a URL, a
   * label) is not withheld.
   */
  isActionWithheldByDisabledPackage(action: unknown): boolean {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return PackageAddressingFacet.isActionWithheldByDisabledPackage.call(packageAddressingHost.of(this), action);
  }

  private hasDisabledPackage(): boolean {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts`, its docblock with it (see `PackageAddressingHost`).
    return PackageAddressingFacet.hasDisabledPackage.call(packageAddressingHost.of(this));
  }

  /**
   * Get all registered metadata types (Kinds)
   */
  getRegisteredTypes(): string[] {
    // [#33949 codemod] The body moved to `registry-package-addressing.ts` (see `PackageAddressingHost`).
    return PackageAddressingFacet.getRegisteredTypes.call(packageAddressingHost.of(this));
  }

  // ==========================================
  // Package Management
  // ==========================================

  installPackage(
    manifest: ObjectStackManifest,
    source: InstalledPackageSource,
    settings?: Record<string, any>,
    scope?: ArtifactInstallScope,
  ): InstalledPackage {
    // [#33949 codemod] The body moved to `registry-packages.ts` (see `PackagesHost`).
    return PackagesFacet.installPackage.call(packagesHost.of(this), manifest, source, settings, scope);
  }

  private coOwnersOf(
    manifest: ObjectStackManifest,
    selfId: string | undefined,
    scope: ArtifactInstallScope | undefined,
  ): Map<string, CoOwnershipSource> {
    // [#33949 codemod] The body moved to `registry-packages.ts`, its docblock with it (see `PackagesHost`).
    return PackagesFacet.coOwnersOf.call(packagesHost.of(this), manifest, selfId, scope);
  }

  private refuseCoOwnedObjectNameCollision(
    manifest: ObjectStackManifest,
    selfId: string | undefined,
    coOwners: ReadonlyMap<string, CoOwnershipSource>,
  ): void {
    // [#33949 codemod] The body moved to `registry-packages.ts`, its docblock with it (see `PackagesHost`).
    return PackagesFacet.refuseCoOwnedObjectNameCollision.call(packagesHost.of(this), manifest, selfId, coOwners);
  }

  private refuseNamespaceNameConflicts(manifest: ObjectStackManifest): void {
    // [#33949 codemod] The body moved to `registry-packages.ts`, its docblock with it (see `PackagesHost`).
    return PackagesFacet.refuseNamespaceNameConflicts.call(packagesHost.of(this), manifest);
  }

  private refuseNamespaceObjectNameClashes(manifest: ObjectStackManifest, selfId: string | undefined): void {
    // [#33949 codemod] The body moved to `registry-packages.ts`, its docblock with it (see `PackagesHost`).
    return PackagesFacet.refuseNamespaceObjectNameClashes.call(packagesHost.of(this), manifest, selfId);
  }

  /**
   * [ADR-0150 D2, #31720] The same refusal for a `packages[]` stack's
   * RESIDUAL — the top-level items no package body declares, which the
   * `manifest` service registers under the residual's owner id after every
   * body and never through {@link installPackage}. `residual` is that holder
   * as the predicate sees it (`residualNamespacePackageOf`): the owner id, the
   * stack's own `manifest.namespace`, its covered items. Judged against the
   * installed packages of that namespace — the stack's own bodies included,
   * once they have installed — exactly as a package is, in the same envelope.
   * `undefined` (no residual, or none of the covered types) refuses nothing.
   */
  refuseResidualNamespaceNameConflicts(residual: NamespacePackage | undefined): void {
    // [#33949 codemod] The body moved to `registry-packages.ts` (see `PackagesHost`).
    return PackagesFacet.refuseResidualNamespaceNameConflicts.call(packagesHost.of(this), residual);
  }

  /**
   * [#31720] Record a registered residual as a holder of its namespace, so a
   * package (or another stack's residual) registering AFTER it is judged
   * against it too: the residual has no package record for the walk below to
   * read. Called once the stack has registered whole — a refused one records
   * nothing — and keyed by the residual's owner id, so the same stack
   * registering again replaces its own entry. `undefined` records nothing.
   */
  recordResidualNamespaceHolder(residual: NamespacePackage | undefined): void {
    // [#33949 codemod] The body moved to `registry-packages.ts` (see `PackagesHost`).
    return PackagesFacet.recordResidualNamespaceHolder.call(packagesHost.of(this), residual);
  }

  /** The residual holders {@link recordResidualNamespaceHolder} recorded, by owner id. */
  private readonly residualNamespaceHolders = new Map<string, NamespacePackage>();

  private refuseNamespaceHolderConflicts(incoming: NamespacePackage | undefined): void {
    // [#33949 codemod] The body moved to `registry-packages.ts`, its docblock with it (see `PackagesHost`).
    return PackagesFacet.refuseNamespaceHolderConflicts.call(packagesHost.of(this), incoming);
  }

  /**
   * Withdraw an installed package: its objects, namespace, items, catalog
   * claims and record (each step's reason is on it below).
   *
   * @param options.keepBootSeed [#28697] Keep `id` in the boot seed of
   *   disabled packages ({@link setInitialDisabledPackageIds}), for a caller
   *   taking back a package that never existed for an operator, so the
   *   persisted disable state its next install must honour is not forgotten
   *   with the row. An operator's uninstall omits it. (A registration the
   *   engine refuses part-way is put back by {@link restoringOnRefusal}
   *   instead, which never touches the boot seed.)
   */
  uninstallPackage(id: string, options?: { keepBootSeed?: boolean }): boolean {
    // [#33949 codemod] The body moved to `registry-packages.ts` (see `PackagesHost`).
    return PackagesFacet.uninstallPackage.call(packagesHost.of(this), id, options);
  }

  getPackage(id: string): InstalledPackage | undefined {
    // [#33949 codemod] The body moved to `registry-packages.ts` (see `PackagesHost`).
    return PackagesFacet.getPackage.call(packagesHost.of(this), id);
  }

  /**
   * [ADR-0130 D4, epic #31527 R2] The dependencies each residual owner
   * declared — the id a multi-package stack's top-level items are owned by,
   * which has no package record. Kept beside the package records, never as
   * one: `getPackage` / `getAllPackages` do not see it.
   */
  private readonly residualOwnerDependencies = new Map<string, readonly string[]>();

  /**
   * Record the dependencies residual owner `ownerId` declares on its stack's
   * manifest, as the artifact door registers its residual. The latest record
   * wins (a reinstall of the stack restates them).
   */
  recordResidualOwnerDependencies(ownerId: string, dependencies: readonly string[]): void {
    // [#33949 codemod] The body moved to `registry-packages.ts` (see `PackagesHost`).
    return PackagesFacet.recordResidualOwnerDependencies.call(packagesHost.of(this), ownerId, dependencies);
  }

  /**
   * The dependencies residual owner `id` declared, or `undefined` for an id
   * that is no recorded residual owner. The one closure walk
   * (`packageDependencyClosure` in `@objectstack/metadata-core`) reads it for
   * an id {@link getPackage} cannot produce, so a residual reaches what it
   * declares through every reader of that walk.
   */
  residualOwnerDependenciesOf(id: string): readonly string[] | undefined {
    // [#33949 codemod] The body moved to `registry-packages.ts` (see `PackagesHost`).
    return PackagesFacet.residualOwnerDependenciesOf.call(packagesHost.of(this), id);
  }

  getAllPackages(): InstalledPackage[] {
    // [#33949 codemod] The body moved to `registry-packages.ts` (see `PackagesHost`).
    return PackagesFacet.getAllPackages.call(packagesHost.of(this));
  }

  enablePackage(id: string): InstalledPackage | undefined {
    // [#33949 codemod] The body moved to `registry-packages.ts` (see `PackagesHost`).
    return PackagesFacet.enablePackage.call(packagesHost.of(this), id);
  }

  disablePackage(id: string): InstalledPackage | undefined {
    // [#33949 codemod] The body moved to `registry-packages.ts` (see `PackagesHost`).
    return PackagesFacet.disablePackage.call(packagesHost.of(this), id);
  }

  /**
   * Merge editable manifest fields (name / description / version /
   * dependencies) into an installed package — the in-memory half of
   * `PATCH /packages/:id`.
   *
   * Only the human-editable fields are touched: `id` is identity (never
   * changes here), and lifecycle facets (`status` / `enabled` / `installedAt`)
   * are preserved — this is a metadata edit, NOT a reinstall (which
   * `installPackage` would be, resetting exactly those). Undefined patch
   * fields are ignored so a partial PATCH only overwrites what it sends.
   *
   * [#24670] `dependencies` is replaced WHOLE, never deep-merged: the row the
   * caller sends is the declaration, so an entry it leaves out is removed and
   * `{}` clears it. The registry keeps its own copy of the row. Replacing the
   * object (rather than editing the stored one in place) is also what keeps
   * the protocol's pre-patch snapshot — a shallow copy of the manifest — able
   * to put the prior row back when the durable write fails. The row is judged
   * by the door before it gets here (`ManifestSchema`'s `dependencies` row);
   * the closure the save door reads off it is resolved per write, so the next
   * save sees the edit with nothing cached to retire.
   */
  updatePackageManifest(
    id: string,
    patch: { name?: string; description?: string; version?: string; dependencies?: Record<string, string> },
  ): InstalledPackage | undefined {
    // [#33949 codemod] The body moved to `registry-packages.ts` (see `PackagesHost`).
    return PackagesFacet.updatePackageManifest.call(packagesHost.of(this), id, patch);
  }

  // ==========================================
  // App Helpers
  // ==========================================

  registerApp(app: any, packageId?: string) {
    this.registerItem('app', app, 'name', packageId);
  }

  /**
   * One app by name, with its navigation contributions merged in.
   *
   * [ADR-0150 D3, #31680 child E8] Resolved through the one package-scoped
   * resolver ({@link resolveItem}): `currentPackageId` is the caller's
   * package (its own app, else the unique holder in its declared closure);
   * omitted, the caller has no package (the environment's own app, else the
   * unique package holder). A name two holders make ambiguous, or one the
   * caller may not reach, is refused naming every candidate.
   *
   * @throws {PackageScopedNameRefusedError} when the resolver refuses.
   */
  getApp(name: string, currentPackageId?: string): any {
    // [#33949 codemod] The body moved to `registry-apps.ts` (see `AppsHost`).
    return AppsFacet.getApp.call(appsHost.of(this), name, currentPackageId);
  }

  getAllApps(): any[] {
    // [#33949 codemod] The body moved to `registry-apps.ts` (see `AppsHost`).
    return AppsFacet.getAllApps.call(appsHost.of(this));
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
    // [#33949 codemod] The body moved to `registry-apps.ts` (see `AppsHost`).
    return AppsFacet.registerAppNavContribution.call(appsHost.of(this), contribution, packageId);
  }

  /**
   * [#30581] Make `contributions` the WHOLE set of navigation contributions
   * `packageId` holds, in every app: what the package registered before is
   * replaced, never added to. The door a package BODY takes (`registerApp`'s
   * manifest step), so registering the same body again (an artifact reload,
   * whose `metadata:reloaded` re-registers every package of the artifact, a
   * manifest replay, an upgrade) leaves each entry once, instead of one more
   * copy of every module's entries per registration until a restart.
   *
   * Replaced IN PLACE: an app's list keeps the package's entries where its
   * first registration put them, so the fold's ties (equal priority, the
   * common case at the default 200) resolve in the order a fresh boot gives.
   * An app the package newly contributes to gets them at the end; an app it no
   * longer names loses them. {@link registerAppNavContribution} stays the
   * additive verb, for a caller adding one contribution at a time.
   */
  setPackageNavContributions(
    packageId: string,
    contributions: ReadonlyArray<{ app: string; group?: string; priority?: number; items?: any[] }>,
  ): void {
    // [#33949 codemod] The body moved to `registry-apps.ts` (see `AppsHost`).
    return AppsFacet.setPackageNavContributions.call(appsHost.of(this), packageId, contributions);
  }

  /** Contributions registered for an app (empty array when none). */
  getAppNavContributions(appName: string): Array<{ packageId?: string; group?: string; priority: number; items: any[] }> {
    // [#33949 codemod] The body moved to `registry-apps.ts` (see `AppsHost`).
    return AppsFacet.getAppNavContributions.call(appsHost.of(this), appName);
  }

  /**
   * Return a copy of `app` with the registered navigation contributions of
   * every ENABLED package merged into its `navigation` tree (#28117: a disabled
   * package's are dropped). The stored app is never mutated, so repeated reads
   * stay idempotent.
   *
   * Public so the protocol serving path (`getMetaItems` / `getMetaItem` for
   * `app`) can merge contributions the same way `getApp` / `getAllApps` do —
   * the REST app endpoints read through the protocol, not these helpers, so
   * the merge must be reachable from there too (ADR-0029 D7).
   */
  applyNavContributions(app: any): any {
    // [#33949 codemod] The body moved to `registry-apps.ts` (see `AppsHost`).
    return AppsFacet.applyNavContributions.call(appsHost.of(this), app);
  }

  private findNavGroup(items: any[], groupId: string): any | undefined {
    // [#33949 codemod] The body moved to `registry-apps.ts`, its docblock with it.
    return AppsFacet.findNavGroup(items, groupId);
  }

  // ==========================================
  // Navigation-contribution diagnostics (#14553)
  // ==========================================

  /**
   * Diagnostics raised by the fold, keyed `app` → `packageId|group` → entry.
   *
   * ⚠️ PER REGISTRY and DE-DUPLICATED, both deliberate. `applyNavContributions`
   * runs on EVERY read of an app (that is what makes it a fold rather than a
   * mutation), so an undeduplicated list would grow without bound and an
   * undeduplicated `console.warn` would print once per request — which is the
   * #12015 discipline's other failure: a diagnostic that fires on every read is
   * as unreadable as one that never fires. Keyed on the triple the author has
   * to act on, the line is emitted once per process per distinct mis-aim.
   *
   * ⛔ Not a module-level `Set` (the shape `warnStrippedLegacyApiMethods`
   * uses): registries are constructed per kernel and per test, and a
   * process-global memo would make the SECOND registry that hits the same
   * mis-aim silent — including, measurably, the pin that reads this
   * diagnostic at two log levels in a row.
   */
  private navGroupDiagnostics = new Map<string, Map<string, NavContributionGroupDiagnostic>>();

  private recordNavGroupMiss(
    appName: string,
    c: { packageId?: string; group?: string; items: any[] },
  ): void {
    // [#33949 codemod] The body moved to `registry-apps.ts`, its docblock with it (see `AppsHost`).
    return AppsFacet.recordNavGroupMiss.call(appsHost.of(this), appName, c);
  }

  /**
   * Navigation-contribution diagnostics raised for `appName` so far, in the
   * order they were first raised (empty when the app's contributions all
   * resolved, or when nothing has read the app yet).
   *
   * ⚠️ Populated BY the read-time fold, so it answers for the reads that have
   * happened — call `getApp(appName)` first if you need the app's own verdict
   * rather than the process's history.
   */
  getAppNavDiagnostics(appName: string): NavContributionGroupDiagnostic[] {
    // [#33949 codemod] The body moved to `registry-apps.ts` (see `AppsHost`).
    return AppsFacet.getAppNavDiagnostics.call(appsHost.of(this), appName);
  }

  // ==========================================
  // Plugin Helpers
  // ==========================================

  registerPlugin(manifest: ObjectStackManifest) {
    this.registerItem('plugin', manifest, 'id');
  }

  getAllPlugins(): ObjectStackManifest[] {
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return PicklistsFacet.getAllPlugins.call(picklistsHost.of(this));
  }

  // ==========================================
  // Kind Helpers
  // ==========================================

  // #11169: `globs` left the kind shape — nothing ever read the value here or
  // downstream (the two type positions below were its only non-schema
  // occurrences); a kind entry is `{ id, description? }`, keyed on `id`.
  registerKind(kind: { id: string; description?: string }) {
    this.registerItem('kind', kind, 'id');
  }

  getAllKinds(): { id: string; description?: string }[] {
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return PicklistsFacet.getAllKinds.call(picklistsHost.of(this));
  }

  // ==========================================
  // Shared picklists
  // ==========================================

  /**
   * Add a `picklistExtensions` entry's options to the picklist it names.
   *
   * ADDITIVE ONLY, and refused rather than resolved when it is not: a value
   * the list already carries — from its owner or from another package's
   * extension — throws `INVALID_METADATA` naming both declarations, and
   * nothing is stored. Last-wins would let a second package silently replace
   * an option the owner declared.
   *
   * The target need not be registered yet: packages register in dependency
   * order, not picklist order, and an object resolves its options lazily on
   * the next fold, so the extension is held until the list arrives. A target
   * that never arrives is not this method's to judge — the boot audit
   * ({@link findUnresolvedPicklistReferences}, {@link findOrphanPicklistExtensions})
   * refuses the fields that name it and the extensions that extend it.
   *
   * Re-registration by the same package replaces that package's own
   * contribution value by value, so a manifest replay is idempotent.
   */
  registerPicklistExtension(
    extension: { extend: string; options: readonly PicklistOptionLike[] },
    packageId?: string,
  ): void {
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return PicklistsFacet.registerPicklistExtension.call(picklistsHost.of(this), extension, packageId);
  }

  /**
   * The resolved options of a picklist — its own, then every extension's, in
   * registration order — or `undefined` when the name reaches no list.
   * Extensions held for an unregistered list resolve nothing on their own: a
   * list exists only once its owner declares it.
   *
   * [ADR-0150 D3/D4, child E6] The name is resolved by R's package-scoped
   * resolver from `callerPackageId`, the package that WROTE the reference: its
   * own list, else the unique holder in its declared dependency closure (plus
   * `sys`), else nothing — a refusal ({@link picklistReferenceVerdict} says
   * which). Omitted, `null` or `''` is a caller with no package (an
   * environment-authored body, a context-free door): the environment's own
   * list first, else the unique package holder. That is what the bare read
   * answered while phase 1 keeps one holder per name, so every caller-less
   * reader keeps its answer.
   */
  resolvePicklistOptions(name: string, callerPackageId?: string | null): PicklistOptionLike[] | undefined {
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return PicklistsFacet.resolvePicklistOptions.call(picklistsHost.of(this), name, callerPackageId);
  }

  /**
   * [ADR-0150 D3, child E6] R's verdict on one picklist reference: `resolved`,
   * `not-found` (nothing holds the name) or `refused` (holders exist and none
   * is reachable from `callerPackageId`, or more than one is). The audits
   * below read it, so the boot, the install door and the served field share
   * one answer.
   *
   * [#32183] Judged over every holder, a disabled package's included: a
   * field's vocabulary is a durable judgment, so a reversible disable of the
   * package holding a list a live field names neither refuses the next boot
   * (the disabled state is seeded before the load audit runs) nor empties the
   * field's options. The by-name `picklist` read (`resolveItem`) is a door and
   * judges the served holders.
   */
  picklistReferenceVerdict(
    name: string,
    callerPackageId?: string | null,
    pendingManifests?: readonly unknown[],
  ): PackageScopedResolution<PicklistItemLike> {
    const registry = pendingManifests && pendingManifests.length > 0 ? this.withPendingManifests(pendingManifests) : this;
    return resolvePackageScopedName<PicklistItemLike>(registry, {
      type: 'picklist', name, callerPackageId, includeDisabledPackages: true,
    });
  }

  private withPendingManifests(manifests: readonly unknown[], options: { replaces?: boolean } = {}): PackageScopedRegistry {
    // [#33949 codemod] The body moved to `registry-picklists.ts`, its docblock with it (see `PicklistsHost`).
    return PicklistsFacet.withPendingManifests.call(picklistsHost.of(this), manifests, options);
  }

  /**
   * Every field of every packaged object whose picklist reference reaches no
   * list from the package that declares the field — the load-time audit's
   * input, with the resolver's refusal sentence where it refused.
   *
   * Judged over the PACKAGED contributors only (`own` and `extend`), never an
   * `overlay` and never a tenant-authored body: those come out of
   * `sys_metadata`, and a stored row must not be able to fail a boot. A
   * tenant field naming an unknown list is still never served options and
   * never accepts a value — the fold drops whatever options it carried and
   * the record validator refuses the field.
   *
   * ⛔ Leaves out a reference the resolver refuses as held OUTSIDE the
   * declaring package's dependency closure (ADR-0150 D3 (a), and a package
   * holder it does not depend on — N1, ruled on #31678):
   * {@link findOutsideClosurePicklistReferences} names those, and the boot
   * warns instead of refusing (ruling N2 on the E6 card): the narrowing is a
   * refused reference, not a refused boot. A name nothing holds, or one the
   * closure holds more than once, still refuses the boot here.
   */
  findUnresolvedPicklistReferences(): UnresolvedPicklistReference[] {
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return PicklistsFacet.findUnresolvedPicklistReferences.call(picklistsHost.of(this));
  }

  /**
   * Every `picklistExtensions` entry whose target names no list — the second
   * half of the load-time audit. Held extensions are legal while the boot
   * fills; once it is sealed, one still held adds its options to nothing.
   * The target is judged caller-less ({@link picklistContributions} says
   * why), so a refusal here is only ever an ambiguity, every holder named.
   */
  findOrphanPicklistExtensions(): UnresolvedPicklistExtension[] {
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return PicklistsFacet.findOrphanPicklistExtensions.call(picklistsHost.of(this));
  }

  /**
   * [ADR-0150 D3, child E6] The packaged fields whose picklist is held only
   * OUTSIDE the declaring package's declared dependency closure: by an
   * environment-authored list (D3 (a)), or by a package it does not depend
   * on — a same-artifact sibling included (N1, ruled on #31678: the declared
   * closure only). The resolver refuses them (`outside-closure`, naming every
   * holder): the field is served with no options and the record validator
   * refuses its values. The boot names each one (a warning carrying the
   * refusal's sentence) and the D10 upgrade report lists them; it does not
   * refuse the boot (ruling N2 on the E6 card: a refused reference, not a
   * refused boot). The fix is the refusal's own: declare the dependency.
   */
  findOutsideClosurePicklistReferences(): UnresolvedPicklistReference[] {
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return PicklistsFacet.findOutsideClosurePicklistReferences.call(picklistsHost.of(this));
  }

  /**
   * [ADR-0150 D3, #31700; epic seat rulings A (6811306558) and R2-A
   * (6812862622)] Set once, by {@link sealPicklistVocabulary}, when the boot
   * has judged every packaged picklist reference and extension. From then on
   * every picklist arrival meets {@link judgePicklistArrival} before anything
   * of it registers.
   */
  private picklistVocabularySealed = false;

  /**
   * How many {@link registeringPicklistArrival} runs are open: an arrival
   * judged as a whole registers inside one, and the per-item seams (and a
   * nested {@link admitPicklistArrival}) do not judge its parts again.
   */
  private picklistArrivalDepth = 0;

  /**
   * [ADR-0150 D3, #31700; epic seat ruling R2-A, 6812862622] The boot's seal of
   * the picklist vocabulary, called by the engine plugin at `kernel:ready` once
   * the load-time audit has run. From this call on, every way a picklist
   * holder, a `picklistExtensions` entry or a field's picklist reference
   * arrives — a late install or upgrade (the `manifest` service), a hot
   * reload, a direct `registerApp`, and the item seams
   * ({@link registerItem} for a `picklist`, {@link registerPicklistExtension},
   * {@link registerObject}) — meets {@link judgePicklistArrival} first.
   */
  sealPicklistVocabulary(): void {
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return PicklistsFacet.sealPicklistVocabulary.call(picklistsHost.of(this));
  }

  /** Has the boot sealed the picklist vocabulary (every arrival is now judged)? */
  get picklistVocabularyIsSealed(): boolean {
    return this.picklistVocabularySealed;
  }

  /**
   * [ADR-0150 D3, #31700; epic seat ruling R2-A, 6812862622] Refuse, once the
   * vocabulary is sealed and outside a run already judged as a whole, an
   * arrival of `manifests` that {@link judgePicklistArrival} finds wanting.
   * Nothing registers before it; the caller registers after it, inside
   * {@link registeringPicklistArrival}.
   *
   * @throws the `INVALID_METADATA` refusal naming every reference, extension
   *   and field, and each holder.
   */
  refusePicklistArrival(manifests: readonly unknown[], options: { act?: PicklistArrivalAct } = {}): void {
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return PicklistsFacet.refusePicklistArrival.call(picklistsHost.of(this), manifests, options);
  }

  /**
   * Run `register` as the registration of an arrival judged as a whole
   * ({@link refusePicklistArrival}): the per-item seams it reaches do not
   * judge its parts one by one, which would read a half-registered artifact.
   */
  registeringPicklistArrival<T>(register: () => T): T {
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return (PicklistsFacet.registeringPicklistArrival<T>).call(picklistsHost.of(this), register);
  }

  /** {@link refusePicklistArrival}, then `register` inside {@link registeringPicklistArrival}. */
  admitPicklistArrival<T>(manifests: readonly unknown[], register: () => T, options: { act?: PicklistArrivalAct } = {}): T {
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return (PicklistsFacet.admitPicklistArrival<T>).call(picklistsHost.of(this), manifests, register, options);
  }

  private refusePicklistItemArrival(packageId: string | undefined, part: Record<string, unknown>, subject: string): void {
    // [#33949 codemod] The body moved to `registry-picklists.ts`, its docblock with it (see `PicklistsHost`).
    return PicklistsFacet.refusePicklistItemArrival.call(picklistsHost.of(this), packageId, part, subject);
  }

  private picklistArrivalRefusal(
    manifests: readonly unknown[],
    options: { replaces: boolean; ownRefusals: 'all' | 'ambiguous'; act: PicklistArrivalAct; subject?: string },
  ): Error | undefined {
    // [#33949 codemod] The body moved to `registry-picklists.ts`, its docblock with it (see `PicklistsHost`).
    return PicklistsFacet.picklistArrivalRefusal.call(picklistsHost.of(this), manifests, options);
  }

  /**
   * [ADR-0150 D3, #31700; epic seat rulings A (6811306558) and R2-A
   * (6812862622)] The ONE re-judge of a picklist arrival: `manifests` (an
   * artifact, a reload, one body, or one item a seam registers) judged with
   * everything already registered, over one registry view holding them
   * (`withPendingManifests`), before any of it registers. Five answers:
   *
   *  - `unresolved`: a field reference the arrival brings that R does not
   *    resolve from the package writing it, nothing holding the name included;
   *  - `orphans`: a `picklistExtensions` entry the arrival brings whose target
   *    resolves to no one list, judged caller-less as the boot judges it
   *    (`findOrphanPicklistExtensions`): a list of the same name the arriving
   *    package itself declares is no shortcut once another namespace holds
   *    the name;
   *  - `references` / `extensions`: an installed reference or extension that
   *    resolves now and would not once the arrival registers;
   *  - `disagreeing`: a field whose reference to one list name every packaged
   *    layer that writes it (the owner, each `objectExtensions` redeclare, the
   *    arrival's among them) reaches the same list from now — or that no
   *    installed layer writes yet — and whose writers would reach different
   *    lists: served no options and refusing every value
   *    ({@link findDisagreeingPicklistReferences}).
   *
   * Judged as the boot audit judges: packaged layers only, never an overlay or
   * a tenant-authored body, each reference from the package that writes it.
   * `replaces` (an install, an upgrade, a reload): an arriving package's
   * installed layers and extensions are what the arrival replaces, so its
   * references are judged as the arrival's; otherwise (a per-item seam) they
   * stay, and the arriving item is added to them. A reference or extension
   * refused already, or a field whose writers disagree already, is not this
   * arrival's doing and is left out. `ownRefusals: 'ambiguous'` (the per-item
   * seams) keeps only the arrival's own references and extensions the
   * resolver refuses as ambiguous.
   *
   * [#32183, ADR-0150 D3] Judged over EVERY holder, a disabled package's
   * included, before and after the arrival, because the field verdict
   * ({@link picklistReferenceVerdict}) reads every holder: the install audit
   * and the served field agree for a disabled holder. Judged over the served
   * holders, a field resolving to a disabled package's list would read as
   * refused already and be skipped, and an arrival making it ambiguous would
   * be admitted, the field silently losing its options.
   */
  judgePicklistArrival(
    manifests: readonly unknown[],
    options: { replaces?: boolean; ownRefusals?: 'all' | 'ambiguous' } = {},
  ): PicklistArrivalVerdict {
    const verdict: PicklistArrivalVerdict = { unresolved: [], orphans: [], references: [], extensions: [], disagreeing: [] };
    if (manifests.length === 0) return verdict;
    const replaces = options.replaces !== false;
    const replaced = new Set(
      replaces ? manifests.map((m) => artifactPackageId(m)).filter((id): id is string => id !== undefined) : [],
    );
    const view = this.withPendingManifests(manifests, { replaces });
    const memo = new Map<string, { before: PackageScopedResolution<PicklistItemLike>; after: PackageScopedResolution<PicklistItemLike> }>();
    const judged = (name: string, caller: string | null) => {
      const key = JSON.stringify([name, caller]);
      let entry = memo.get(key);
      if (!entry) {
        // [#32183] Every holder, a disabled package's included, on both
        // sides: the field verdict reads every holder
        // ({@link picklistReferenceVerdict}), so the install audit and the
        // served field agree for a disabled holder.
        memo.set(key, entry = {
          before: resolvePackageScopedName<PicklistItemLike>(this, {
            type: 'picklist', name, callerPackageId: caller, includeDisabledPackages: true,
          }),
          after: resolvePackageScopedName<PicklistItemLike>(view, {
            type: 'picklist', name, callerPackageId: caller, includeDisabledPackages: true,
          }),
        });
      }
      return entry;
    };
    const refusedOwn = (after: PackageScopedResolution<PicklistItemLike>): boolean => {
      if (after.status === 'resolved') return false;
      if (options.ownRefusals !== 'ambiguous') return true;
      return after.status === 'refused'
        && (after.reason === 'ambiguous-in-closure' || after.reason === 'ambiguous-in-environment');
    };
    const carrying = <R extends object>(entry: R, after: PackageScopedResolution<PicklistItemLike>): R & { refusal?: string } =>
      after.status === 'refused' ? { ...entry, refusal: after.message } : entry;

    // The arrival's own references and extensions.
    const arrivingRefs: UnresolvedPicklistReference[] = [];
    const arrivingExtensions = new Set<string>();
    for (const manifest of manifests) {
      const packageId = artifactPackageId(manifest);
      for (const ref of collectManifestPicklistReferences(manifest, packageId)) {
        arrivingRefs.push(ref);
        const { after } = judged(ref.picklist, ref.packageId ?? null);
        if (refusedOwn(after)) verdict.unresolved.push(carrying(ref, after));
      }
      for (const ext of collectManifestPicklistExtensions(manifest, packageId)) {
        arrivingExtensions.add(JSON.stringify([ext.picklist, ext.packageId ?? '']));
        const { after } = judged(ext.picklist, null);
        if (refusedOwn(after)) verdict.orphans.push(carrying(ext, after));
      }
    }

    // What it does to the references and extensions already installed, and
    // every field's writers, grouped by (object, field, list name).
    type Group = { object: string; field: string; picklist: string; before: (string | null)[]; after: (string | null)[] };
    const groups = new Map<string, Group>();
    for (const [fqn, contributors] of this.objectContributors) {
      const referrerOf = picklistReferrerOf(contributors);
      for (const contributor of contributors) {
        if (contributor.ownership === 'overlay' || isTenantAuthored(contributor.definition)) continue;
        const replacedLayer = contributor.packageId !== undefined && replaced.has(contributor.packageId);
        for (const ref of collectPicklistReferences(fqn, contributor.definition, contributor.packageId)) {
          if (!replacedLayer) {
            const { before, after } = judged(ref.picklist, ref.packageId ?? null);
            if (before.status === 'resolved' && after.status !== 'resolved') verdict.references.push(carrying(ref, after));
          }
          const key = JSON.stringify([fqn, ref.field, ref.picklist]);
          if (groups.has(key)) continue;
          const writers = referrerOf(ref.field, ref.picklist);
          groups.set(key, {
            object: fqn,
            field: ref.field,
            picklist: ref.picklist,
            before: [...writers],
            after: writers.filter((w) => w === null || !replaced.has(w)),
          });
        }
      }
    }
    for (const [target, byPackage] of this.picklistExtensionContributions) {
      for (const entry of byPackage.values()) {
        if (entry.packageId !== undefined && replaced.has(entry.packageId)) continue;
        if (arrivingExtensions.has(JSON.stringify([target, entry.packageId ?? '']))) continue;
        const { before, after } = judged(target, null);
        if (before.status === 'resolved' && after.status !== 'resolved') {
          verdict.extensions.push(carrying({ picklist: target, packageId: entry.packageId }, after));
        }
      }
    }
    for (const ref of arrivingRefs) {
      const key = JSON.stringify([ref.object, ref.field, ref.picklist]);
      let group = groups.get(key);
      if (!group) groups.set(key, group = { object: ref.object, field: ref.field, picklist: ref.picklist, before: [], after: [] });
      const writer = ref.packageId ?? null;
      if (!group.after.includes(writer)) group.after.push(writer);
    }
    for (const group of groups.values()) {
      if (group.after.length < 2) continue;
      const before = group.before.map((w) => judged(group.picklist, w).before);
      if (!before.every((r) => r.status === 'resolved')) continue;
      const beforeHolders = before.map((r) => (r as { holder: PackageScopedHolder }).holder);
      if (!beforeHolders.every((h) => sameHolder(h, beforeHolders[0]))) continue;
      const reached: { packageId: string | undefined; holder: PackageScopedHolder }[] = [];
      for (const writer of group.after) {
        const after = judged(group.picklist, writer).after;
        if (after.status !== 'resolved') break;
        reached.push({ packageId: writer ?? undefined, holder: after.holder });
      }
      if (reached.length < group.after.length) continue;
      if (reached.every((r) => sameHolder(r.holder, reached[0].holder))) continue;
      verdict.disagreeing.push({ object: group.object, field: group.field, picklist: group.picklist, referrers: reached });
    }
    return verdict;
  }

  /**
   * [ADR-0150 D3, child E6; #31700] The fields whose picklist reference
   * several packaged layers write (the object's owner and an extension of
   * it), each RESOLVING the name from its own package, but to DIFFERENT
   * lists. {@link resolveFieldPicklistOptions} serves such a field no options
   * — no referrer is preferred over another — and the record validator
   * refuses its values; neither half of the audit above names it, since
   * every referrer's own resolution succeeds. Reachable once two namespaces
   * may each hold the name: the owner's package reaches its list, the
   * extension's package reaches its own. The boot names each one (a warning,
   * every referrer and the holder it reaches) and carries on, as it does for
   * an outside-closure reference (ruling N2 on the E6 card).
   */
  findDisagreeingPicklistReferences(): DisagreeingPicklistReference[] {
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return PicklistsFacet.findDisagreeingPicklistReferences.call(picklistsHost.of(this));
  }

  private auditPicklistReferences(): {
    unresolved: UnresolvedPicklistReference[];
    outsideClosure: UnresolvedPicklistReference[];
  } {
    // [#33949 codemod] The body moved to `registry-picklists.ts`, its docblock with it (see `PicklistsHost`).
    return PicklistsFacet.auditPicklistReferences.call(picklistsHost.of(this));
  }

  private judgePicklistReference(
    name: string,
    callerPackageId: string | undefined,
  ): 'resolved' | { refusal?: PackageScopedRefusal; outsideClosure: boolean } {
    // [#33949 codemod] The body moved to `registry-picklists.ts`, its docblock with it (see `PicklistsHost`).
    return PicklistsFacet.judgePicklistReference.call(picklistsHost.of(this), name, callerPackageId);
  }

  private picklistContributions(name: string, callerPackageId?: string | null): PicklistContribution[] {
    // [#33949 codemod] The body moved to `registry-picklists.ts`, its docblock with it (see `PicklistsHost`).
    return PicklistsFacet.picklistContributions.call(picklistsHost.of(this), name, callerPackageId);
  }

  private assertPicklistValuesDistinct(
    name: string,
    picklist: { options?: PicklistOptionLike[] },
    packageId: string | undefined,
  ): void {
    // [#33949 codemod] The body moved to `registry-picklists.ts`, its docblock with it (see `PicklistsHost`).
    return PicklistsFacet.assertPicklistValuesDistinct.call(picklistsHost.of(this), name, picklist, packageId);
  }

  private resolvePicklistFields<T>(body: T, referrerOf: PicklistReferrer = NO_PACKAGE_REFERRER): T {
    // [#33949 codemod] The body moved to `registry-picklists.ts`, its docblock with it (see `PicklistsHost`).
    return (PicklistsFacet.resolvePicklistFields<T>).call(picklistsHost.of(this), body, referrerOf);
  }

  private resolveFieldPicklistOptions(
    picklist: string,
    referrers: readonly (string | null)[],
  ): PicklistOptionLike[] | undefined {
    // [#33949 codemod] The body moved to `registry-picklists.ts`, its docblock with it (see `PicklistsHost`).
    return PicklistsFacet.resolveFieldPicklistOptions.call(picklistsHost.of(this), picklist, referrers);
  }

  private unregisterPicklistExtensionsByPackage(packageId: string): boolean {
    // [#33949 codemod] The body moved to `registry-picklists.ts`, its docblock with it (see `PicklistsHost`).
    return PicklistsFacet.unregisterPicklistExtensionsByPackage.call(picklistsHost.of(this), packageId);
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
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return PicklistsFacet.invalidate.call(picklistsHost.of(this), fqnOrName);
  }

  /** Drop every entry from the merged-schema cache. */
  invalidateAll(): void {
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return PicklistsFacet.invalidateAll.call(picklistsHost.of(this));
  }

  /**
   * Clear all registry state. Use only for testing.
   */
  reset(): void {
    // [#33949 codemod] The body moved to `registry-picklists.ts` (see `PicklistsHost`).
    return PicklistsFacet.reset.call(picklistsHost.of(this));
  }

  // [#33949 codemod] Installs each facet's host factory (`registry-facet-hosts.ts`): a static block adds
  // no member to the class, so the published `.d.ts` does not move.
  static {
    appsHost.install((registry) => ({
      get appNavContributions() { return registry.appNavContributions; },
      applyNavContributions: (...a) => registry.applyNavContributions(...a),
      findNavGroup: (...a) => registry.findNavGroup(...a),
      isPackageDisabled: (...a) => registry.isPackageDisabled(...a),
      listItems: (...a) => registry.listItems(...a),
      log: (...a) => registry.log(...a),
      get navGroupDiagnostics() { return registry.navGroupDiagnostics; },
      noteAppNavContributions: (...a) => registry.noteAppNavContributions(...a),
      recordNavGroupMiss: (...a) => registry.recordNavGroupMiss(...a),
      resolveItem: (...a) => registry.resolveItem(...a),
      warn: (...a) => registry.warn(...a),
    }));
    bareNamesHost.install((registry) => ({
      get addressLiteralNamespaceWarned() { return registry.addressLiteralNamespaceWarned; },
      bareNameBundleAdditionMeets: (...a) => registry.bareNameBundleAdditionMeets(...a),
      get bareNameClaims() { return registry.bareNameClaims; },
      bareNameHolderNamespace: (...a) => registry.bareNameHolderNamespace(...a),
      bareNameHoldersOtherThan: (...a) => registry.bareNameHoldersOtherThan(...a),
      get bareNameHoldersSealed() { return registry.bareNameHoldersSealed; },
      set bareNameHoldersSealed(v) { registry.bareNameHoldersSealed = v; },
      bareNamePackageHolders: (...a) => registry.bareNamePackageHolders(...a),
      bareNameRenameFor: (...a) => registry.bareNameRenameFor(...a),
      declaredBundleHolding: (...a) => registry.declaredBundleHolding(...a),
      getAllPackages: (...a) => registry.getAllPackages(...a),
      getPackage: (...a) => registry.getPackage(...a),
      get metadata() { return registry.metadata; },
      noteBareNameClaim: (...a) => registry.noteBareNameClaim(...a),
      registeredBundleHolding: (...a) => registry.registeredBundleHolding(...a),
    }));
    itemsHost.install((registry) => ({
      get bareNameClaims() { return registry.bareNameClaims; },
      getObject: (...a) => registry.getObject(...a),
      invalidateAll: (...a) => registry.invalidateAll(...a),
      log: (...a) => registry.log(...a),
      get metadata() { return registry.metadata; },
      noteBareNameClaim: (...a) => registry.noteBareNameClaim(...a),
      noteItem: (...a) => registry.noteItem(...a),
      noteItemOrder: (...a) => registry.noteItemOrder(...a),
      noteSecurityCatalogClaim: (...a) => registry.noteSecurityCatalogClaim(...a),
      get objectContributors() { return registry.objectContributors; },
      get openPackageBody() { return registry.openPackageBody; },
      set openPackageBody(v) { registry.openPackageBody = v; },
      orderedOverlayTier: (...a) => registry.orderedOverlayTier(...a),
      get packageBodyExtensions() { return registry.packageBodyExtensions; },
      get packageBodyItems() { return registry.packageBodyItems; },
      get restorePoint() { return registry.restorePoint; },
      get securityCatalogClaims() { return registry.securityCatalogClaims; },
      unregisterPicklistExtensionsByPackage: (...a) => registry.unregisterPicklistExtensionsByPackage(...a),
      withdrawObjectExtension: (...a) => registry.withdrawObjectExtension(...a),
      withdrawPackageBodyItemsNotShipped: (...a) => registry.withdrawPackageBodyItemsNotShipped(...a),
      withdrawPackageClaimsNotDeclared: (...a) => registry.withdrawPackageClaimsNotDeclared(...a),
    }));
    namespacesAndClaimsHost.install((registry) => ({
      bareNameHolderNamespace: (...a) => registry.bareNameHolderNamespace(...a),
      get defaultRecordPageClaims() { return registry.defaultRecordPageClaims; },
      defaultRecordPageSlots: (...a) => registry.defaultRecordPageSlots(...a),
      forgetDefaultRecordPageClaims: (...a) => registry.forgetDefaultRecordPageClaims(...a),
      log: (...a) => registry.log(...a),
      get metadata() { return registry.metadata; },
      get namespaceRegistry() { return registry.namespaceRegistry; },
      noteDefaultRecordPageClaims: (...a) => registry.noteDefaultRecordPageClaims(...a),
      noteNamespace: (...a) => registry.noteNamespace(...a),
      noteSecurityCatalogClaim: (...a) => registry.noteSecurityCatalogClaim(...a),
      otherDefaultRecordPageHolders: (...a) => registry.otherDefaultRecordPageHolders(...a),
      packageHeldSecurityCatalogNames: (...a) => registry.packageHeldSecurityCatalogNames(...a),
      get securityCatalogClaims() { return registry.securityCatalogClaims; },
      securityCatalogHoldersOtherThan: (...a) => registry.securityCatalogHoldersOtherThan(...a),
      securityCatalogPackageHolders: (...a) => registry.securityCatalogPackageHolders(...a),
    }));
    objectRegistrationHost.install((registry) => ({
      get _objectRevision() { return registry._objectRevision; },
      set _objectRevision(v) { registry._objectRevision = v; },
      applyDeploymentTenancy: (...a) => registry.applyDeploymentTenancy(...a),
      attachBoundActions: (...a) => registry.attachBoundActions(...a),
      get bareNameHoldersAreSealed() { return registry.bareNameHoldersAreSealed; },
      boundCodeActions: (...a) => registry.boundCodeActions(...a),
      boundServedActions: (...a) => registry.boundServedActions(...a),
      debug: (...a) => registry.debug(...a),
      declinedBaseLayerStamps: (...a) => registry.declinedBaseLayerStamps(...a),
      get deploymentPlatformGlobalObjects() { return registry.deploymentPlatformGlobalObjects; },
      extensionTargetKey: (...a) => registry.extensionTargetKey(...a),
      get extensionPlacementNotesWarned() { return registry.extensionPlacementNotesWarned; },
      get fieldPatchMissesWarned() { return registry.fieldPatchMissesWarned; },
      finishServedObject: (...a) => registry.finishServedObject(...a),
      foldExtenders: (...a) => registry.foldExtenders(...a),
      foldExtendersOntoDefinition: (...a) => registry.foldExtendersOntoDefinition(...a),
      followDoorSlotPriority: (...a) => registry.followDoorSlotPriority(...a),
      getAllObjects: (...a) => registry.getAllObjects(...a),
      getObject: (...a) => registry.getObject(...a),
      getObjectContributors: (...a) => registry.getObjectContributors(...a),
      getObjectOwner: (...a) => registry.getObjectOwner(...a),
      getPackage: (...a) => registry.getPackage(...a),
      hasDisabledPackage: (...a) => registry.hasDisabledPackage(...a),
      isActionWithheldByDisabledPackage: (...a) => registry.isActionWithheldByDisabledPackage(...a),
      isPackageDisabled: (...a) => registry.isPackageDisabled(...a),
      judgeRegistrationDoors: (...a) => registry.judgeRegistrationDoors(...a),
      log: (...a) => registry.log(...a),
      materializeBaseLayer: (...a) => registry.materializeBaseLayer(...a),
      get mergedObjectCache() { return registry.mergedObjectCache; },
      get metadata() { return registry.metadata; },
      get multiTenant() { return registry.multiTenant; },
      noteObjectEntry: (...a) => registry.noteObjectEntry(...a),
      get objectContributors() { return registry.objectContributors; },
      openObjectEntry: (...a) => registry.openObjectEntry(...a),
      packagedRules: (...a) => registry.packagedRules(...a),
      rankedForPackage: (...a) => registry.rankedForPackage(...a),
      recordCurrencyFollowRefusalOf: (...a) => registry.recordCurrencyFollowRefusalOf(...a),
      get redeclaredFieldsWarned() { return registry.redeclaredFieldsWarned; },
      refusePicklistItemArrival: (...a) => registry.refusePicklistItemArrival(...a),
      registerNamespace: (...a) => registry.registerNamespace(...a),
      reportChangedRuleCopies: (...a) => registry.reportChangedRuleCopies(...a),
      reportExtensionPlacements: (...a) => registry.reportExtensionPlacements(...a),
      reportFieldPatchMisses: (...a) => registry.reportFieldPatchMisses(...a),
      reportRedeclaredFields: (...a) => registry.reportRedeclaredFields(...a),
      get reportedRuleCopyChanges() { return registry.reportedRuleCopyChanges; },
      resolveObject: (...a) => registry.resolveObject(...a),
      resolveObjectKey: (...a) => registry.resolveObjectKey(...a),
      resolvePicklistFields: (...a) => registry.resolvePicklistFields(...a),
      resolveStorageObject: (...a) => registry.resolveStorageObject(...a),
      get restorePoint() { return registry.restorePoint; },
      get searchCompanion() { return registry.searchCompanion; },
      servedFoldWithLayer: (...a) => registry.servedFoldWithLayer(...a),
      get shadowedExtensionQueueWarned() { return registry.shadowedExtensionQueueWarned; },
      stripDeploymentTenancyFrom: (...a) => registry.stripDeploymentTenancyFrom(...a),
      stripProvisionedPrimaryFrom: (...a) => registry.stripProvisionedPrimaryFrom(...a),
      stripProvisionedSearchCompanionFrom: (...a) => registry.stripProvisionedSearchCompanionFrom(...a),
      stripProvisionedTenantIndexFrom: (...a) => registry.stripProvisionedTenantIndexFrom(...a),
      subtractExtenderContributions: (...a) => registry.subtractExtenderContributions(...a),
      tenantAuthoredScalars: (...a) => registry.tenantAuthoredScalars(...a),
      tenantPatchedDisplayKeys: (...a) => registry.tenantPatchedDisplayKeys(...a),
      tenantRuleSettings: (...a) => registry.tenantRuleSettings(...a),
      withPackagedOwnerRules: (...a) => registry.withPackagedOwnerRules(...a),
      withholdDisabledExtensions: (...a) => registry.withholdDisabledExtensions(...a),
      withoutExtensionQueueField: (...a) => registry.withoutExtensionQueueField(...a),
    }));
    packageAddressingHost.install((registry) => ({
      bareSlotEntriesOf: (...a) => registry.bareSlotEntriesOf(...a),
      bundleMembersHeldBy: (...a) => registry.bundleMembersHeldBy(...a),
      compositeHoldersOf: (...a) => registry.compositeHoldersOf(...a),
      gateSlotBinding: (...a) => registry.gateSlotBinding(...a),
      getAllObjects: (...a) => registry.getAllObjects(...a),
      getItem: (...a) => registry.getItem(...a),
      getObjectOwner: (...a) => registry.getObjectOwner(...a),
      getPackage: (...a) => registry.getPackage(...a),
      getPackageScopedItem: (...a) => registry.getPackageScopedItem(...a),
      hasDisabledPackage: (...a) => registry.hasDisabledPackage(...a),
      invalidateAll: (...a) => registry.invalidateAll(...a),
      isBundleAddition: (...a) => registry.isBundleAddition(...a),
      isFlowOfDisabledPackage: (...a) => registry.isFlowOfDisabledPackage(...a),
      isObjectPackageDisabled: (...a) => registry.isObjectPackageDisabled(...a),
      isPackageDisabled: (...a) => registry.isPackageDisabled(...a),
      log: (...a) => registry.log(...a),
      get metadata() { return registry.metadata; },
      noteItem: (...a) => registry.noteItem(...a),
      get objectContributors() { return registry.objectContributors; },
      overlaySlotBinding: (...a) => registry.overlaySlotBinding(...a),
      ownersHoldingAName: (...a) => registry.ownersHoldingAName(...a),
      packageScopedHoldersOf: (...a) => registry.packageScopedHoldersOf(...a),
      packagelessActionEntryToRetire: (...a) => registry.packagelessActionEntryToRetire(...a),
      pairRowBinding: (...a) => registry.pairRowBinding(...a),
      rankedForPackage: (...a) => registry.rankedForPackage(...a),
      resolveObjectKey: (...a) => registry.resolveObjectKey(...a),
      resolveOwnerLayer: (...a) => registry.resolveOwnerLayer(...a),
      retirePackagelessActionSlot: (...a) => registry.retirePackagelessActionSlot(...a),
      settledPairRowBinding: (...a) => registry.settledPairRowBinding(...a),
    }));
    packagesHost.install((registry) => ({
      announcePackageEnabled: (...a) => registry.announcePackageEnabled(...a),
      announcePackageUninstalled: (...a) => registry.announcePackageUninstalled(...a),
      get bareNameHoldersSealed() { return registry.bareNameHoldersSealed; },
      coOwnersOf: (...a) => registry.coOwnersOf(...a),
      get collisionPolicy() { return registry.collisionPolicy; },
      debug: (...a) => registry.debug(...a),
      forgetBareNameClaims: (...a) => registry.forgetBareNameClaims(...a),
      forgetDefaultRecordPageClaims: (...a) => registry.forgetDefaultRecordPageClaims(...a),
      forgetSecurityCatalogClaims: (...a) => registry.forgetSecurityCatalogClaims(...a),
      getNamespaceOwners: (...a) => registry.getNamespaceOwners(...a),
      getObjectOwner: (...a) => registry.getObjectOwner(...a),
      getPackage: (...a) => registry.getPackage(...a),
      get initialDisabledPackageIds() { return registry.initialDisabledPackageIds; },
      invalidateAll: (...a) => registry.invalidateAll(...a),
      isPackageDisabled: (...a) => registry.isPackageDisabled(...a),
      listItems: (...a) => registry.listItems(...a),
      log: (...a) => registry.log(...a),
      get metadata() { return registry.metadata; },
      get namespaceRegistry() { return registry.namespaceRegistry; },
      noteItem: (...a) => registry.noteItem(...a),
      noteItemType: (...a) => registry.noteItemType(...a),
      get objectContributors() { return registry.objectContributors; },
      get packageBodyExtensions() { return registry.packageBodyExtensions; },
      get packageBodyItems() { return registry.packageBodyItems; },
      recordBareNameClaims: (...a) => registry.recordBareNameClaims(...a),
      recordDefaultRecordPageClaims: (...a) => registry.recordDefaultRecordPageClaims(...a),
      recordSecurityCatalogClaims: (...a) => registry.recordSecurityCatalogClaims(...a),
      refuseBareNameConflicts: (...a) => registry.refuseBareNameConflicts(...a),
      refuseCoOwnedObjectNameCollision: (...a) => registry.refuseCoOwnedObjectNameCollision(...a),
      refuseDefaultRecordPageConflicts: (...a) => registry.refuseDefaultRecordPageConflicts(...a),
      refuseNamespaceHolderConflicts: (...a) => registry.refuseNamespaceHolderConflicts(...a),
      refuseNamespaceNameConflicts: (...a) => registry.refuseNamespaceNameConflicts(...a),
      refuseNamespaceObjectNameClashes: (...a) => registry.refuseNamespaceObjectNameClashes(...a),
      refuseSecurityCatalogNameConflicts: (...a) => registry.refuseSecurityCatalogNameConflicts(...a),
      registerNamespace: (...a) => registry.registerNamespace(...a),
      get residualNamespaceHolders() { return registry.residualNamespaceHolders; },
      get residualOwnerDependencies() { return registry.residualOwnerDependencies; },
      setPackageNavContributions: (...a) => registry.setPackageNavContributions(...a),
      unregisterItemsByPackage: (...a) => registry.unregisterItemsByPackage(...a),
      unregisterNamespace: (...a) => registry.unregisterNamespace(...a),
      unregisterObjectsByPackage: (...a) => registry.unregisterObjectsByPackage(...a),
      warnAddressLiteralNamespaceOnce: (...a) => registry.warnAddressLiteralNamespaceOnce(...a),
    }));
    picklistsHost.install((registry) => ({
      get _objectRevision() { return registry._objectRevision; },
      set _objectRevision(v) { registry._objectRevision = v; },
      get appNavContributions() { return registry.appNavContributions; },
      auditPicklistReferences: (...a) => registry.auditPicklistReferences(...a),
      getAllPackages: (...a) => registry.getAllPackages(...a),
      getEnvironmentScopedItem: (...a) => registry.getEnvironmentScopedItem(...a),
      getPackage: (...a) => registry.getPackage(...a),
      getPackageScopedItem: (...a) => registry.getPackageScopedItem(...a),
      invalidateAll: (...a) => registry.invalidateAll(...a),
      judgePicklistArrival: (...a) => registry.judgePicklistArrival(...a),
      judgePicklistReference: (...a) => registry.judgePicklistReference(...a),
      listItems: (...a) => registry.listItems(...a),
      log: (...a) => registry.log(...a),
      get mergedObjectCache() { return registry.mergedObjectCache; },
      get metadata() { return registry.metadata; },
      get namespaceRegistry() { return registry.namespaceRegistry; },
      notePicklistExtension: (...a) => registry.notePicklistExtension(...a),
      get objectContributors() { return registry.objectContributors; },
      get objectKeysByShortName() { return registry.objectKeysByShortName; },
      packageScopedHoldersOf: (...a) => registry.packageScopedHoldersOf(...a),
      get picklistArrivalDepth() { return registry.picklistArrivalDepth; },
      set picklistArrivalDepth(v) { registry.picklistArrivalDepth = v; },
      picklistArrivalRefusal: (...a) => registry.picklistArrivalRefusal(...a),
      picklistContributions: (...a) => registry.picklistContributions(...a),
      get picklistExtensionContributions() { return registry.picklistExtensionContributions; },
      picklistReferenceVerdict: (...a) => registry.picklistReferenceVerdict(...a),
      get picklistVocabularySealed() { return registry.picklistVocabularySealed; },
      set picklistVocabularySealed(v) { registry.picklistVocabularySealed = v; },
      refusePicklistArrival: (...a) => registry.refusePicklistArrival(...a),
      refusePicklistItemArrival: (...a) => registry.refusePicklistItemArrival(...a),
      registeringPicklistArrival: (...a) => registry.registeringPicklistArrival(...a),
      get residualOwnerDependencies() { return registry.residualOwnerDependencies; },
      residualOwnerDependenciesOf: (...a) => registry.residualOwnerDependenciesOf(...a),
      resolveFieldPicklistOptions: (...a) => registry.resolveFieldPicklistOptions(...a),
      resolvePicklistOptions: (...a) => registry.resolvePicklistOptions(...a),
    }));
    platformGlobalHost.install((registry) => ({
      get _objectRevision() { return registry._objectRevision; },
      set _objectRevision(v) { registry._objectRevision = v; },
      applyDeploymentTenancy: (...a) => registry.applyDeploymentTenancy(...a),
      assertPackageUninstallable: (...a) => registry.assertPackageUninstallable(...a),
      closeObjectEntry: (...a) => registry.closeObjectEntry(...a),
      get deploymentPlatformGlobalObjects() { return registry.deploymentPlatformGlobalObjects; },
      set deploymentPlatformGlobalObjects(v) { registry.deploymentPlatformGlobalObjects = v; },
      deploymentWithholdsTenant: (...a) => registry.deploymentWithholdsTenant(...a),
      get extensionSpellingWarned() { return registry.extensionSpellingWarned; },
      foldExtenders: (...a) => registry.foldExtenders(...a),
      getObjectOwner: (...a) => registry.getObjectOwner(...a),
      getPackagedObjectBase: (...a) => registry.getPackagedObjectBase(...a),
      getPackagedObjectOwner: (...a) => registry.getPackagedObjectOwner(...a),
      invalidateAll: (...a) => registry.invalidateAll(...a),
      isPackageDisabled: (...a) => registry.isPackageDisabled(...a),
      log: (...a) => registry.log(...a),
      get mergedObjectCache() { return registry.mergedObjectCache; },
      get multiTenant() { return registry.multiTenant; },
      get objectContributors() { return registry.objectContributors; },
      get objectKeysByShortName() { return registry.objectKeysByShortName; },
      noteObjectEntry: (...a) => registry.noteObjectEntry(...a),
      packagedRules: (...a) => registry.packagedRules(...a),
      registerObject: (...a) => registry.registerObject(...a),
      resolveObject: (...a) => registry.resolveObject(...a),
      resolveObjectKey: (...a) => registry.resolveObjectKey(...a),
      resolveObjectLeavingExtensionsOut: (...a) => registry.resolveObjectLeavingExtensionsOut(...a),
      stripProvisionedTenantIndexFrom: (...a) => registry.stripProvisionedTenantIndexFrom(...a),
    }));
    restoreHost.install((registry) => ({
      get appNavContributions() { return registry.appNavContributions; },
      get bareNameClaims() { return registry.bareNameClaims; },
      get bareNameHoldersAreSealed() { return registry.bareNameHoldersAreSealed; },
      closeObjectEntry: (...a) => registry.closeObjectEntry(...a),
      get defaultRecordPageClaims() { return registry.defaultRecordPageClaims; },
      followRefusalAsServed: (...a) => registry.followRefusalAsServed(...a),
      getAllObjects: (...a) => registry.getAllObjects(...a),
      getObject: (...a) => registry.getObject(...a),
      invalidateAll: (...a) => registry.invalidateAll(...a),
      get mergedObjectCache() { return registry.mergedObjectCache; },
      get metadata() { return registry.metadata; },
      get namespaceRegistry() { return registry.namespaceRegistry; },
      get objectContributors() { return registry.objectContributors; },
      get picklistExtensionContributions() { return registry.picklistExtensionContributions; },
      recordCurrencyFollowRefusalOf: (...a) => registry.recordCurrencyFollowRefusalOf(...a),
      recordCurrencyFollowRefusalOfRun: (...a) => registry.recordCurrencyFollowRefusalOfRun(...a),
      resolveObjectKey: (...a) => registry.resolveObjectKey(...a),
      resolveOwnerLayer: (...a) => registry.resolveOwnerLayer(...a),
      get restorePoint() { return registry.restorePoint; },
      set restorePoint(v) { registry.restorePoint = v; },
      get securityCatalogClaims() { return registry.securityCatalogClaims; },
    }));
    storageHost.install((registry) => ({
      get _logLevel() { return registry._logLevel; },
      get initialDisabledPackageIds() { return registry.initialDisabledPackageIds; },
      set initialDisabledPackageIds(v) { registry.initialDisabledPackageIds = v; },
      get objectContributors() { return registry.objectContributors; },
      get objectKeysByShortName() { return registry.objectKeysByShortName; },
      get packageEnabledListeners() { return registry.packageEnabledListeners; },
      get packageUninstalledListeners() { return registry.packageUninstalledListeners; },
    }));
  }
}

// [#34206, ADR-0156 D2] Every public write moves `revision`; see `registry-revision.ts`.
installSchemaRegistryRevision(SchemaRegistry);

/**
 * [#31699, epic ruling on the App pair's plain slot] Whether `item`, a row of a
 * paired `<base>.custom` package that binds to `packageId` (its base), declares
 * another holder of the name as the base it customizes (`overrides.package`,
 * ADR-0146 D2): that holder's member, never `packageId`'s.
 */
function pairRowDeclaresAnotherHolder(item: unknown, packageId: string, holders: ReadonlySet<string>): boolean {
  const stamped = (item as { _packageId?: unknown } | null | undefined)?._packageId;
  if (typeof stamped !== 'string' || customizationBasePackageId(stamped) === null) return false;
  const declared = declaredOverrideBase(item);
  return declared !== undefined && declared !== packageId && holders.has(declared);
}

/**
 * [ADR-0150 D4] The packages among `holders` whose own `action` item of `name`
 * (its composite slot) has the owner key of the package-less action `item`
 * ({@link standaloneActionOwnerKey}; every object-less spelling is one key):
 * the holders that action can customize, in `holders`' order.
 */
function actionHoldersOnOwnerKeyOf(item: unknown, name: string, collection: Map<string, any>,
  holders: ReadonlySet<string>): string[] {
  const ownerKey = (action: unknown): string => {
    const owner = standaloneActionOwnerKey(action);
    return isObjectLessActionKey(owner) ? GLOBAL_ACTION_OBJECT_KEY : owner;
  };
  const key = ownerKey(item);
  return [...holders].filter((holder) => {
    const own = collection.get(`${holder}:${name}`);
    return own !== null && typeof own === 'object' && ownerKey(own) === key;
  });
}

/** The base a row's body declares it customizes (`overrides.package`, ADR-0146 D2), or `undefined`. */
function declaredOverrideBase(item: unknown): string | undefined {
  const declaration = (item as { overrides?: unknown } | null | undefined)?.overrides;
  if (declaration === null || typeof declaration !== 'object' || Array.isArray(declaration)) return undefined;
  const declared = (declaration as { package?: unknown }).package;
  return typeof declared === 'string' && declared !== '' ? declared : undefined;
}

/** {@link SchemaRegistry}'s `pairRowBinding` answer for a row no holder's pair stores: not its question. */
const NOT_A_PAIR_ROW_OF_A_HOLDER: unique symbol = Symbol('not-a-pair-row-of-a-holder');
