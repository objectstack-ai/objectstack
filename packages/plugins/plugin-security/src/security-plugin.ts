// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { AsyncLocalStorage } from 'node:async_hooks';
import { declaredHttpStatus } from '@objectstack/types';
import { Plugin, PluginContext, POSTURE_LADDER, buildEffectiveObjectPermissions } from '@objectstack/core';
import type { EffectiveObjectPermission, PermissionSet, RowLevelSecurityPolicy, TenantLayer0Verdict } from '@objectstack/spec/security';
import { describeHighPrivilegeBits } from '@objectstack/spec/security';
import type { AnchorBindingContext } from '@objectstack/spec/security';
// [#21829] `MAX_BULK_PER_ROW_HOOK_ROWS`: the platform's row ceiling for one
// predicate write, which also bounds the id list a predicate write's read
// question composes (see PREDICATE_WRITE_READABLE_ID_CAP).
import { FieldMaskingRuleSchema, MAX_BULK_PER_ROW_HOOK_ROWS, type FieldMaskingRule } from '@objectstack/spec/data';
import { StandardErrorCode } from '@objectstack/spec/api';
import type { NumberComparandDoorFieldMeta } from '@objectstack/spec/data';
import {
  localWriteEpochSource,
  resolveWriteEpochSource,
  type WriteEpochSource,
} from './write-epoch-source.js';
import { PermissionEvaluator, crudBucketForOperation } from './permission-evaluator.js';
import { composeHumanBaselinePermissionSets, PLATFORM_BASELINE_PERMISSION_SET } from './app-default-permission-set.js';
import { DelegatedAdminGate } from './delegated-admin-gate.js';
import {
  INVITATION_PLACEMENT_SERVICE,
  createInvitationPlacementService,
} from './invitation-placement.js';
import {
  unregisterGrantPermissionSetNameHooks,
} from './grant-permission-set-name.js';
import {
  SHARING_RULES_SERVICE,
  type DeclaredSharingRuleReader,
} from './access-upgrade-report.js';
import { ACCESS_UPGRADE_CHECK_SERVICE, createAccessUpgradeCheck } from './access-upgrade-check.js';
import type { ExplainDecision } from '@objectstack/spec/security';
import type { II18nService, IMetadataService, IObjectQLEngine } from '@objectstack/spec/contracts';

import {
  readAcceptedDefaultPermissionSetsOption,
  refuseAcceptedDefaultsWithoutWall,
  type DeploymentAcceptance,
} from './suggested-audience-bindings.js';
import { RLSCompiler, RLS_DENY_FILTER, policyDeclaresClause } from './rls-compiler.js';
import {
  andComposeLayers,
} from './tenant-layer.js';
import {
  isVerifiedPlatformOwnerRow,
} from './platform-owner-wall-bypass.js';
import { isConfiguredPlatformAdminEmail, createSecurityCatalogReader, bindSecurityCatalogReader, securityCatalogReaderOf, readPositionGrantsInForce, countPositionHolders } from '@objectstack/core';
// [#25223 cut 1] The leaf readers (policy collection, unresolved-posture
// probes, field masks, field-name tables); the methods of the same names below
// hand each body the members it reads (`ObjectInputsHost`).
import {
  admitCollectedPolicy,
  collectRLSPolicies,
  computeForbiddenFieldWrites,
  computePartialMaskRules,
  computeQueryGuardFieldPerms,
  computeReadPartialMaskRules,
  extractTargetField,
  foldFieldRequiredPermissions,
  getObjectFieldNames,
  loadObjectFieldNames,
  maskOperationResult,
  probeMetadataOutage,
  probeUnpublishedDraft,
  resolveUnresolvedCause,
  warnAuthoredTenantPolicyOnce,
  writeCheckFieldOptions,
  type ObjectInputsHost,
} from './security-plugin-object-inputs.js';
// [#25223 cut 2] The controlled-by-parent master relation (ADR-0055 §1) and its
// two reports; the methods of the same names below hand each body the members
// it reads (`CbpRelationHost`).
import {
  reportCbpMasterUnresolved,
  reportRejectedReferenceAlias,
  resolveCbpRelation,
  type CbpRelationHost,
} from './security-plugin-cbp-relation.js';
// [#25223 cut 3] The controlled-by-parent write gate (ADR-0055 §3, step 2.8):
// the served check, the gate, its chain walk, the predicate-write master set
// and the master-row edit verdict; the methods of the same names below hand
// each body the members it reads (`CbpWriteGateHost`).
import {
  assertControlledByParentChainEditable,
  assertControlledByParentWrite,
  assertMasterRowEditable,
  checkControlledByParentWrite,
  controlledByParentPredicateWriteMasters,
  type CbpWriteGateHost,
} from './security-plugin-cbp-write-gate.js';
// [#25223 cut 4] The controlled-by-parent read leaf (ADR-0055 §2, ADR-0139 D6)
// and its chain refusal; the methods of the same names below hand each body
// the members it reads (`CbpReadFilterHost`).
import {
  computeControlledByParentFilter,
  controlledByParentChainRefusal,
  type CbpReadFilterHost,
} from './security-plugin-cbp-read-filter.js';
// [#25223 cuts 5 and 6] Step 3.7's Layer 0 tenant write wall, composed once per
// write (ADR-0123 D2, ADR-0095 D1), its no-active-organization pre-test and its
// verdict for the write preview; the methods of the same names below hand each
// body the members it reads (`WriteTenantWallHost`).
import {
  composeWriteTenantWall,
  organizationWallRefusal,
  writeWallVerdict,
  type WriteTenantWallHost,
} from './security-plugin-write-tenant-wall.js';
// [#25223 cut 6] The context prologue of the engine middleware (ADR-0096 D5,
// ADR-0090 D10) and its guest organization refusal (ADR-0138 D4); the methods
// of the same names below hand each body the members it reads
// (`OperationPrincipalsHost`). `principalLessDenial`, the strict-mode refusal
// only the prologue throws, moved with it; it is imported type-only so that
// `isPrincipalLessContext`'s docblock still links to it.
import {
  refuseGuestWithoutOrganization,
  resolveOperationPrincipals,
  type OperationPrincipalsHost,
  type principalLessDenial,
} from './security-plugin-operation-principals.js';
// [#25223 cut 7] The RLS filter layers (ADR-0095 D1): the layered Layer 0 /
// Layer 1 computation, the verified platform-owner probe its read wall asks,
// the write `check` compile (ADR-0058 D4) and the membership staging both
// compiles ask (ADR-0105 D11); the methods of the same names below hand each
// body the members it reads (`RlsFilterHost`).
import {
  computeLayeredRlsFilter,
  computeWriteCheckFilter,
  isVerifiedPlatformOwnerSession,
  stageRlsMembership,
  type RlsFilterHost,
} from './security-plugin-rls-filter.js';
import { resolverCollisionMessage, resolverCollisionsOf } from './object-membership-keys.js';
// [#25223 cut 8] The permission-set resolution for an execution context: the
// resolution itself, the deactivated folded-set drop, the position-name fold
// report and the memo's key; the methods of the same names below hand each
// body the members it reads (`PermissionSetsHost`).
import {
  dropDeactivatedFoldedSets,
  permissionSetMemoKey,
  reportNameFoldCollisions,
  resolvePermissionSetsForContextUnmemoized,
  type PermissionSetsHost,
} from './security-plugin-permission-sets.js';
// [#25223 cut 8] The addressed-write readers: the by-id and predicate write
// the caller addressed, the read question a predicate write is narrowed by,
// the single id of a write and the by-id row read the provenance and
// pre-image gates share; the methods of the same names below hand each body
// the member it reads (`AddressedWritesHost`).
import {
  addressedByIdWriteId,
  addressedPredicateWrite,
  extractSingleId,
  readableRowsScopeForPredicateWrite,
  readRowById,
  type AddressedWritesHost,
} from './security-plugin-addressed-writes.js';
// [#25223 cut 9] The row-level read scope: the scope the service serves to
// the doors that compile their own statement, and the same scope for an
// on-behalf-of caller; the methods of the same names below hand each body the
// members it reads (`ReadFilterHost`).
import {
  computeDelegatedReadFilter,
  getReadFilter,
  type ReadFilterHost,
} from './security-plugin-read-filter.js';
// [#25223 cut 9] The field readers: the derivation every field projection
// shares, the readable projection and the posture a caller's gates read; the
// methods of the same names below hand each body the members it reads
// (`FieldReadersHost`).
import {
  computeReadableFields,
  resolveCallerPosture,
  resolveProjectionFieldMask,
  type FieldReadersHost,
} from './security-plugin-field-readers.js';
// [#25223 cut 9] The object-level admissions: read, read over resolved sets,
// write and export; the methods of the same names below hand each body the
// members it reads (`ObjectAdmissionHost`).
import {
  canExport,
  canReadObject,
  canWriteObject,
  objectReadAdmission,
  type ObjectAdmissionHost,
} from './security-plugin-object-admission.js';
// [#25223 cut 10] The `everyone` anchor's declarations: the anchor's
// definition a started kernel derives, and the built-in positions `init()`
// declares; the methods of the same names below hand each body the members it
// reads (`EveryoneAnchorHost`).
import {
  declareBuiltinPositions,
  declareEveryone,
  type EveryoneAnchorHost,
} from './security-plugin-everyone-anchor.js';
// [#25223 cut 10] The `security/explain` answer for a caller; the method of
// the same name below hands the body the members it reads
// (`ExplainAccessHost`).
import {
  explainAccessForCaller,
  type ExplainAccessHost,
} from './security-plugin-explain-access.js';
// [#25223 cut 10] The record-sharing verdicts: the read filter, the edit gate,
// the write-depth stash, the tri-state write verdict, the pre-image floor
// decision and the delegator's own floor knobs; the methods of the same names
// below hand each body the members it reads (`SharingVerdictsHost`).
import {
  delegatorOwnWriteFloorOptions,
  resolvePreImageFloorDrop,
  resolveSharingCanEdit,
  resolveSharingReadFilter,
  resolveSharingWriteVerdict,
  resolveWriteScopeForSharing,
  type SharingVerdictsHost,
} from './security-plugin-sharing-verdicts.js';
// [#25223 cut 10] The authored-row write verdict and its probe scope; the
// method of the same name below hands the body the members it reads
// (`AuthoredRowWriteHost`).
import {
  checkAuthoredRowWrite,
  type AuthoredRowWriteHost,
} from './security-plugin-authored-row-write.js';
// [#25223 cut 11] The `security` service registration `start()` runs; the
// block in `start()` that calls it hands it the members it reads
// (`SecurityServiceHost`).
import {
  registerSecurityService,
  type SecurityServiceHost,
} from './security-plugin-security-service.js';
// [#25223 cut 11] The seed-ownership claim on `app:seeded`; the method of the
// same name below hands the claim the members it reads (`SeedClaimHost`). The
// two `seed-settlement` readers it shares with the promotion-time pass are
// imported where that pass now runs ([#25223 cut 13],
// `security-plugin-start-hooks.ts`); `readSeededRecordIds` is imported
// type-only so that the claim's docblock still links to it.
import {
  claimSeedOwnershipOnSettle,
  type readSeededRecordIds,
  type SeedClaimHost,
} from './security-plugin-seed-claim.js';
// [#25223 cut 12] The authorization middleware `start()` registers on the
// engine; the block in `start()` that calls it hands it the members it reads
// (`AuthzMiddlewareHost`). `WriteImageCheckSeam`, the write `check` seam only
// the middleware installs, moved with it; it is imported type-only so that
// `WriteWallRowVerdict`'s docblock still links to it.
import {
  registerAuthzMiddleware,
  type AuthzMiddlewareHost,
  type WriteImageCheckSeam,
} from './security-plugin-authz-middleware.js';
// [#25223 cut 13] What `start()` registers after the authorization middleware;
// the block at the end of `start()` that calls it hands it the members it reads
// and the one it writes (`StartHooksHost`).
import { registerStartHooks, type StartHooksHost } from './security-plugin-start-hooks.js';
import {
  isPlatformOwnershipFloorPolicy,
  masterGateCoversOperation,
  masterGovernsRowWrites,
  owdDeclaresOpenRowWrites,
  owdOpenWritesCoversOperation,
} from './platform-ownership-policies.js';
import { OwnershipFloorAlternates } from './ownership-floor-alternates.js';
import { hasPhantomTenantAnchor } from './federated-phantom-anchors.js';
import {
  type UnresolvedPostureCause,
} from './unresolved-posture.js';
import {
  normalizeTenancyPosture,
  postureEnforcesWall,
  type TenancyPosture,
} from '@objectstack/spec/security';
import {
  RLS_MEMBERSHIP_RESOLVER_SERVICE,
  type IRlsMembershipResolver,
  type SharingWriteVerdict,
  type AuthoredRowWriteVerdict,
  type AuthoredRowWriteOperation,
  type ControlledByParentWriteDenialLeg,
  type ControlledByParentWriteOutcome,
  type PositionGrantSummary,
} from '@objectstack/spec/contracts';
import {
  type MatchesFilterOptions,
} from '@objectstack/formula';
import { FieldMasker } from './field-masker.js';
import {
  PermissionDeniedError,
} from './errors.js';
import { createPlatformAdminService } from './platform-admin-service.js';
import {
  readDeploymentOrgScopingEntitlement,
  type DeploymentOrgScopingEntitlementReading,
} from '@objectstack/core';
import {
  securityObjects,
  securityDefaultPermissionSets,
  securityPluginManifestHeader,
  SECURITY_PLUGIN_ID,
} from './manifest.js';
import { GUEST_POSITION } from '@objectstack/spec';
import { registerBuiltinCapabilities } from './builtin-capabilities.js';
import { humanBaselineFor } from './external-baseline.js';

/**
 * [ADR-0138 D9, D1] Whether `context` is the GUEST envelope — the anonymous
 * principal the explicit guest entry assembles: `principalKind: 'guest'` and no
 * `userId`. The one reading of that fact in this file: the set resolution (D3),
 * the organization refusal (D4) and the owner-anchor stamp's guest branch (D1)
 * all ask it here.
 */
export function isGuestEnvelope(context: unknown): boolean {
  const c = context as { principalKind?: unknown; userId?: unknown } | null | undefined;
  return c?.principalKind === 'guest' && !c?.userId;
}

/**
 * [ADR-0095 D3 / Finding 2 / #2937] Platform-admin-EXCLUSIVE capabilities — the
 * platform-scoped `systemPermissions` that `admin_full_access` carries and
 * `organization_admin` DELIBERATELY withholds (see `default-permission-sets.ts`:
 * org admin is granted only `manage_org_users`/`setup.access`/`setup.write`).
 *
 * Holding ANY of these is the enforcement stand-in for the `PLATFORM_ADMIN`
 * posture rung (ADR-0095 D3): it is what distinguishes a true PLATFORM operator
 * from a TENANT org admin. Both hold `viewAllRecords`/`modifyAllRecords` via
 * their `'*'` wildcard grant, so the superuser-bypass bit ALONE cannot tell them
 * apart — which is exactly why an org admin used to cross the Layer 0 tenant wall
 * on private/platform-global/better-auth objects (Finding 2). `setup.access`/
 * `setup.write` are EXCLUDED on purpose: org admins hold them (they are the Setup
 * app shell + tenant-settings-write caps, not platform powers).
 *
 * [ADR-0099 D1 / P1] Since #2956 the resolver-derived `PLATFORM_ADMIN` rung
 * rides the ExecutionContext (`ctx.posture`), so the Layer 0 exemption gate now
 * reads the CARRIED rung as authoritative (see {@link isCarriedPosture} at the
 * decision site in `computeLayeredRlsFilter`). This capability probe DEMOTES to
 * a fallback: it applies only to contexts that never passed the shared resolver
 * (delegated-admin bridge, sharing service, `getReadFilter` consumers — the
 * hand-built-context population ADR-0096 D3 is eliminating). The probe stays a
 * strict subset of the carried rung's derivation (the unscoped `admin_full_access`
 * grant carries every capability below), so a disagreement can only NARROW the
 * exemption, never widen it (fail-safe; ADR-0099 I3).
 */
const PLATFORM_ADMIN_ONLY_CAPABILITIES: readonly string[] = [
  'manage_metadata',
  'manage_platform_settings',
  'studio.access',
  'manage_users',
];

/**
 * [ADR-0099 D1] Is `v` a carried posture rung (one of the ladder's values)?
 * Present ⇒ the value is authoritative for the Layer 0 tier decision; absent ⇒
 * fall back to the capability probe. Sourced from core's `POSTURE_LADDER` so the
 * enforcement gate and the resolver's derivation can never drift on the enum.
 */
export function isCarriedPosture(v: unknown): boolean {
  return typeof v === 'string' && (POSTURE_LADDER as readonly string[]).includes(v);
}

/**
 * [ADR-0099 P0] Pure form of the platform-admin capability probe: does the held
 * capability set contain any platform-EXCLUSIVE capability? Exported so the
 * authz matrix gate (`authz-matrix-gate.test.ts`) can assert probe-vs-carried-rung
 * equivalence against the EXACT predicate enforcement runs — the P0 gate the
 * ADR-0099 P1 flip lands behind.
 */
export function hasPlatformAdminCapability(held: ReadonlySet<string>): boolean {
  for (const cap of PLATFORM_ADMIN_ONLY_CAPABILITIES) {
    if (held.has(cap)) return true;
  }
  return false;
}

/**
 * [#25062] One refusal of the Layer 0 tenant write wall (step 3.7), held as a
 * VALUE: the error the write throws, the warn line it logs first, and which
 * value the wall refused (`organization_id`, a value the row carries, or
 * `_record`, the caller's own state). Built by the judgements of
 * {@link SecurityPlugin.composeWriteTenantWall} and nowhere else. The
 * middleware logs and throws it; the write preview answers it as a row's
 * verdict ({@link SecurityPlugin.writeWallVerdict}).
 */
interface WriteWallRefusal {
  readonly field: 'organization_id' | '_record';
  readonly warning: string;
  readonly error: PermissionDeniedError;
}

/**
 * [#25062] Step 3.7's Layer 0 tenant write wall, composed ONCE for one write by
 * {@link SecurityPlugin.composeWriteTenantWall}. Every judgement below reads
 * the same parts, computed once with this request's caller and delegator
 * contexts, so the payload half, the stored-image half and the write preview
 * hold a row to one wall.
 */
interface WriteTenantWall {
  /** [ADR-0123 D2] The scope pre-test's refusal of the whole write, or `null`. */
  readonly preTest: WriteWallRefusal | null;
  /**
   * The payload half: the rows as the caller SENT them. Every supplied
   * organization must clear the wall, and on an update none may be emptied.
   */
  judgePayload(rows: readonly Record<string, unknown>[]): WriteWallRefusal | null;
  /** The stored-image half, or `null` where the wall installs no seam. */
  readonly storedImage: {
    /** [#24784 · #24821] An insert row with nowhere to land, judged before any other. */
    judgeLanding(rows: readonly Record<string, unknown>[]): WriteWallRefusal | null;
    /** One stored row: its organization against the wall, and on an update not emptied. */
    judgeRow(row: Record<string, unknown>): WriteWallRefusal | null;
    /** [#24822] The value `PostHookWriteImageCheck.judgesOrganization` is set from. */
    readonly judgesOrganization: boolean;
  } | null;
}

/**
 * [#25062] The wall's answer for ONE row of a write preview, as the engine's
 * `registerWriteWallVerdict` takes it: admitted (and whether the wall judges
 * the row's organization), or refused with the write's own code and message.
 *
 * Structurally identical to `WriteWallRowVerdict` in `@objectstack/objectql`,
 * and declared here for the reason {@link WriteImageCheckSeam} is: the engine
 * is a devDependency of this package. The two spellings are welded by tests
 * that run both packages (`validate-preview-wall-verdict.test.ts` in
 * `@objectstack/organizations`, `import-dryrun-tenant-wall-parity.test.ts` in
 * `@objectstack/rest`).
 */
type WriteWallRowVerdict =
  | { readonly admitted: true; readonly judgesOrganization: boolean }
  | {
      readonly admitted: false;
      readonly field: 'organization_id' | '_record';
      readonly code: string;
      readonly message: string;
    };

/**
 * [ADR-0066 D3/⑤] Object `requiredPermissions` normalized into per-CRUD buckets.
 * `all` holds capabilities required for EVERY operation (the `string[]` form);
 * the per-op buckets hold capabilities from the `{read,create,update,delete}`
 * map form. The effective requirement for an operation is `all ∪ <bucket>`.
 */
interface NormalizedRequiredPermissions {
  all: string[];
  read: string[];
  create: string[];
  update: string[];
  delete: string[];
}

/** Per-object security posture resolved once and cached (see getObjectSecurityMeta). */
interface ObjectSecurityMeta {
  isPrivate: boolean;
  tenancyDisabled: boolean;
  isBetterAuthManaged: boolean;
  /**
   * [#7835] The object is FEDERATED (ADR-0015 `external`) and its
   * `organization_id` is the anchor the REGISTRY injected, not a column the
   * author declared — so the column exists in the registered schema and in no
   * backing store, because `syncObjectSchema` issues no DDL for a federated
   * object. Layer 0 reads this to answer "is this a tenant object?" truthfully;
   * see `federated-phantom-anchors.ts` for the provenance test and for why the
   * question is provenance rather than `external != null`.
   *
   * `false` on every local object and on a federated object that declares a
   * real remote `organization_id` — both keep the tenant wall exactly as it is.
   */
  tenantAnchorIsPhantom: boolean;
  /**
   * [#8023] The object DECLARES `sharingModel: 'public_read_write'` — the one
   * OWD that states row-level writes are open org-wide. Read from the author's
   * declaration, never from `plugin-sharing`'s effective bucket; see
   * `owdDeclaresOpenRowWrites` in `platform-ownership-policies.ts` for why the
   * two must not be confused here.
   *
   * `false` when the schema does not resolve, so the floor stays (fail closed)
   * — and `unresolved` meta is never cached, so a transient boot miss is
   * retried rather than frozen into an over-strict answer.
   */
  owdOpensRowWrites: boolean;
  requiredPermissions: NormalizedRequiredPermissions;
  fieldRequiredPermissions: Record<string, string[]>;
  /**
   * [#8993] Per-field partial-masking rules: { fieldName -> FieldMaskingRule }.
   * Collected from `field.maskingRule` and VALIDATED against the spec schema at
   * collection — an unparseable declared rule degrades to a full mask
   * (`{keepHead: 0, keepTail: 0}`), never to the unmasked value (fail closed on
   * an access-narrowing declaration, the #3545 stance one axis over).
   */
  fieldMaskingRules: Record<string, FieldMaskingRule>;
  /**
   * [#3545] The object's posture could NOT be resolved — neither the live
   * ObjectQL schema nor the metadata service returned it. Every other field is
   * then a DEFAULT, not the author's declaration, and each default happens to be
   * the permissive end of its axis (`isPrivate: false` is covered by a plain
   * `'*'` wildcard; empty `requiredPermissions` skips the capability AND-gate).
   * Consumers that turn this into an ACCESS DECISION must fail closed on it —
   * see the call sites in the middleware, {@link canExport} and
   * {@link getReadableFields}. Consumers that only widen scoping from it (the
   * RLS posture exemption in {@link computeLayeredRlsFilter}) are already safe:
   * the permissive default withholds the exemption.
   */
  unresolved: boolean;
  /**
   * [#10401 / #10424] WHICH of the conditions behind
   * {@link ObjectSecurityMeta.unresolved} this is — the object exists only as an
   * unpublished draft, the metadata STORE could not answer, or its declaration
   * genuinely cannot be read. Meaningful only when `unresolved` is `true`; absent
   * (and therefore `'unknown'`) on every resolved posture.
   *
   * ⛔ Explanation only. Nothing may branch an ACCESS DECISION on it: every cause
   * denies, identically and fail-closed, and the probes that produce it are
   * best-effort by design (see {@link SecurityPlugin.resolveUnresolvedCause}).
   * Its whole job is to stop the refusal naming a remedy — "change a sharing
   * rule", or "go fix your declaration" mid-outage — that cannot fix the
   * condition at hand.
   */
  unresolvedCause?: UnresolvedPostureCause;
}

/**
 * [#20995] A context that carries NO principal: no position, no named
 * permission set and no user id.
 *
 * [#21908] ADR-0096 D5 — STRICT MODE. A non-system context of this class is
 * REFUSED, at every layer that used to hand it through: the engine middleware
 * throws {@link principalLessDenial} before it resolves anything, the
 * object-admission probes (`canReadObject` / `canWriteObject` / `canExport`)
 * answer `false`, and its row scope is the deny sentinel (`getReadFilter`).
 * Every one of them reads THIS predicate, so they cannot disagree about who is
 * refused. It used to be the hand-off (ADR-0096 E1) — the one exception an
 * empty set list had — and the published contract sentence it contradicted
 * (`ChatWithToolsOptions.toolExecutionContext`: an empty context is
 * "unauthenticated (RLS-on, sees-nothing)") is the one it now keeps.
 *
 * The two ways to reach the engine are explicit, never a missing field: carry
 * the caller's principal, or — for platform plumbing whose own door already
 * authorized the caller — the explicit system opt-in (`isSystem: true`), which
 * short-circuits every layer ahead of this predicate.
 *
 * Every other non-system context reaches the gates, including one whose
 * positions or named sets resolve to nothing: that caller resolves no
 * permission set, holds no capability, and is the one
 * {@link SecurityPlugin.resolveCallerPosture} gives the object's masking rules
 * and [#21063] its per-field capability contract.
 *
 * [#21079] ADR-0056 D2 — THE DENY BASELINE. For such a caller an empty set list
 * grants nothing: it is asked the same grant questions as any caller, over the
 * empty list, and every one answers no. Object admission refuses it (the
 * middleware's step 2 CRUD gate, and `canReadObject` / `canWriteObject` /
 * `canExport`), and its row scope is the deny sentinel (`getReadFilter`). With
 * strict mode the empty list has NO exception left. ⛔ No door, probe or layer
 * carries a spelling of "no sets means no restriction".
 */
export function isPrincipalLessContext(context: any): boolean {
  const positions = context?.positions ?? [];
  const explicitPermissionSets = context?.permissions ?? [];
  return positions.length === 0 && explicitPermissionSets.length === 0 && !context?.userId;
}

/**
 * [#5492] Knobs on the layered RLS computation. Both are COMPOSITION
 * instructions rather than policy switches: the caller has already consulted an
 * authority that owns a write-widening mechanism, and is telling this layer
 * whose answer wins.
 */
interface RlsFilterOptions {
  /**
   * Drop the PLATFORM's own row-level write ownership floor
   * (`owner_only_writes` / `owner_only_deletes` — see
   * `platform-ownership-policies.ts`) from Layer 1.
   *
   * Set only when `ISharingService.checkEdit` / `checkDelete` answered `allow`
   * for the row this filter is about to be enforced against — a positive basis
   * (ownership at write DEPTH, an `edit`-level `sys_record_share`, or the
   * `modifyAllRecords` bypass). `abstain` and `deny` both leave it in place, so
   * a row record sharing does not enforce on keeps the floor as its only
   * row-level write gate.
   *
   * [commit 498f4e884] TWO call sites set it, and that is the point rather than a
   * duplication: the by-id write pre-image gate (step 2.7) asks about the row
   * being written, and ADR-0055's master gate
   * ({@link SecurityPlugin.assertControlledByParentWrite}, step 2.8, leg 1) asks
   * the identical question about the MASTER row whose editability a detail write
   * derives from. Leg 1 used to compute the master's write filter with the floor
   * left standing, so one principal, one master row and one `update` got two
   * answers — permitted asked directly, `403 … (row-level security)` asked on
   * behalf of a child. Maintainer ruling 2026-08-15: one ownership composition,
   * both paths.
   *
   * Never affects Layer 0 (the tenant wall) or any app-authored policy.
   */
  dropPlatformOwnershipFloor?: boolean;
  /**
   * [commit 6feac910b] The caller VOUCHES that ADR-0055's master gate
   * ({@link SecurityPlugin.assertControlledByParentWrite}, step 2.8) runs on
   * this exact operation, for this exact principal, after this filter is
   * enforced — so a `controlled_by_parent` object's platform ownership floor
   * may be handed over to it.
   *
   * ## Why this is a caller's claim and not a posture read
   *
   * The object's posture is only half the licence (see
   * `masterGovernsRowWrites`). The maintainer ruling that removes this floor
   * removes it "only where the master gate demonstrably covers the same
   * operation; otherwise the change is a bare widening" — and coverage is a
   * property of the CALL SITE, not of the object:
   *
   *   • the by-id write pre-image gate (step 2.7) sets it, because step 2.8
   *     sits directly below it on the same middleware pass, guarded by a
   *     SUPERSET of step 2.7's own condition (same `permissionSets`/`userId`/
   *     `ql` triple, same single target id, one extra operation — `insert`);
   *   • [#23093] the chain walk's master-edit leg
   *     ({@link SecurityPlugin.assertMasterRowEditable}) sets it on a hop whose
   *     master is itself `controlled_by_parent`, on a non-delegated write. Why
   *     the walk covers that master's write is stated once, at that call site's
   *     `masterGateCoversThisWrite` bullet — not restated here;
   *   • the BULK write path does NOT, and must not: with no single id,
   *     `assertControlledByParentWrite` judges every master the write reaches
   *     and refuses on the first the caller may not edit, but that is a
   *     verdict, not a row scope, so the floor stays — dropping it here would
   *     widen the rows a member writes, a separate decision. Reading the
   *     posture alone here would have widened bulk writes on
   *     every `controlled_by_parent` detail to "any row under a READABLE
   *     master", which no gate had authorized;
   *   • `getReadFilter` and `checkAuthoredRowWrite` do not, and need not: the
   *     floor is `update`/`delete`-only so the read path never carries it, and
   *     the authored-write probe already removes it by provenance;
   *   • `security/explain`'s record-grained UPDATE and DELETE verdicts set it
   *     on step 2.7's condition, because explain asks the master gate for
   *     every by-id write it explains
   *     ({@link SecurityPlugin.checkControlledByParentWrite}) and refuses on
   *     its refusal.
   *
   * `false`/absent leaves the floor exactly where it is. Never affects Layer 0
   * (the tenant wall) or any app-authored policy.
   */
  masterGateCoversThisWrite?: boolean;
}

/**
 * A `controlled_by_parent` object's resolved master relation — the FK field key,
 * the master object it points at, and whether required-field validation covers
 * the FK's omission. Produced once per object by
 * {@link SecurityPlugin.resolveCbpRelation} and cached.
 */
/**
 * [ADR-0055 amendment] How many `controlled_by_parent` hops the read derivation's
 * chain walk and the master-write gate will walk before they fail CLOSED.
 *
 * ⚠️ This is a COST ceiling, not a semantic rule, and it is deliberately not a
 * "supported chain length". Termination is already guaranteed without it — both
 * walks carry the set of objects already visited on the branch and refuse to
 * re-enter one, over a finite schema registry. What the bound caps is WORK. On
 * the write side, one master-row probe per hop. On the read side the
 * derivation answers the engine's `ReadableIds` leaf (ADR-0139 D6), which the
 * engine composes into ONE statement with one nested subquery per hop; the
 * engine refuses a chain past its own `READABLE_IDS_MAX_CHAIN_DEPTH` by name
 * (INTERNAL_ERROR / 500), and this bound is the SAME cut, judged here first
 * over the registry alone, so a chain the engine would refuse answers zero
 * rows from this plugin and the engine never meets it. ⛔ The two values must
 * stay equal: a plugin bound above the engine's turns an over-depth chain from
 * zero rows into the engine's 500; one below it is over-denial.
 *
 * HOW THE VALUE WAS CHOSEN — no value is derivable from the tree, so the
 * derivation is stated rather than implied. Measured on this repo: every
 * authored `controlled_by_parent` object has a chain of exactly **one** hop
 * (`showcase_invoice_line` → `showcase_invoice`, `showcase_expense_line` →
 * `showcase_expense_report`, `crm_opportunity_line_item` → `crm_opportunity`)
 * — in each case the master's own model is `public_read_write` or `private`,
 * never derived. The consumer that motivated the ADR-0055 amendment needs **two**
 * (`crm_quote_line_item` → `crm_quote` → `crm_account`). 8 is four times the
 * deepest chain any consumer has asked for, so it cannot be reached by
 * authoring that means anything, and it still caps the walk at 8 hops.
 *
 * AT THE BOUND: the read derivation answers the EMPTY master set (`$in: []`)
 * and the write gate DENIES, each logging the chain it refused. ⛔ Never "no
 * restriction" — that is precisely the failure the ADR-0055 amendment closed,
 * and a bound that widened on overflow would reintroduce it at depth 9
 * instead of depth 2.
 */
export const CBP_MAX_CHAIN_DEPTH = 8;

interface CbpRelation {
  /** The detail's master reference field key. */
  fk: string;
  /** The master object the FK points at. */
  master: string;
  /**
   * [#8688] Will `validateRecord` refuse an insert that omits {@link fk}?
   *
   * This is the licence for the master gate's insert leg to STAND DOWN and let
   * the platform's ordinary missing-required-field answer (`400
   * VALIDATION_FAILED` with `fields[]`) be the one the caller sees. It is
   * `true` only for the shape the maintainer ruling of 2026-08-15 covers:
   * `master_detail` + `required: true`, and NOT `readonly`/`system`.
   *
   * For every other declarable shape it is `false` and the gate keeps
   * answering, because validation does not cover the same ground there — see
   * the stand-down site for what a bare hand-over would mint.
   *
   * ⛔ [#9137] Do not widen this predicate to `true` for `readonly`/`system`, or
   * to drop the `master_detail`+`required` condition, until the ramp commit 8abada3ba records
   * completes (#9138 builder-force + #9139 lint-at-v18). See the freeze note at
   * the stand-down site (below, in {@link SecurityPlugin.assertControlledByParentWrite})
   * for why.
   */
  omissionRefusedByValidation: boolean;
  /**
   * [ADR-0055 §1 · #25095] The relation's one master reference is not
   * writable: its field def carries `readonly: true` or `system: true`, the
   * declaration the parse refuses as `master-not-writable`. Then this is the
   * parse's own sentence for it, else `null`.
   *
   * Read from the SAME field def the relation came from, like
   * {@link CbpRelation.omissionRefusedByValidation}, and the relation still
   * resolves, on purpose: the read leg, the cache and the unresolved report do
   * not change, so the rows already stored keep the master their reads derive
   * from. What it changes is the write gate's answer
   * ({@link MasterReferenceNotWritableError}): every insert, and every update
   * whose body carries the reference key, is refused before anything is
   * written. The engine does not take a caller's value in a field the
   * declaration keeps from the author as an ordinary master reference, so such
   * a write could mint or re-point a detail outside the master its access
   * derives from. One rule for both flags, with one prescription.
   */
  masterNotWritable: string | null;
}

/**
 * [#21771] Ruling A's read question, judged on the answer of a caller-context
 * by-id read: is the row ABSENT to this caller?
 *
 * Three outcomes of the read, and only one is absence (the #7505 rule):
 *
 *  - no row — absent: the row does not exist, or the read door hides it from
 *    this caller (row-level security, record sharing, a data middleware's
 *    visibility). Those two are the same answer by ruling, so they are one
 *    `true` here;
 *  - a declared 4xx refusal — the read itself was REFUSED (the object's read
 *    grant withheld, a predicate the driver will not compile). Not a hidden
 *    row, so `false`: the write keeps the answer it has today;
 *  - anything else — a store fault, which propagates as raised: an outage is
 *    neither absence nor a refusal, and reporting it as either would relabel it.
 *
 * Shared by the write path (step 2.7) and `security/explain`, so the two ask
 * one question one way. The three-way classification itself is
 * {@link readUnlessRefused}, which the predicate write's read question asks too.
 */
export async function absentUnderCallerRead(read: () => Promise<unknown>): Promise<boolean> {
  const answer = await readUnlessRefused(read);
  return !answer.refused && answer.value == null;
}

/**
 * [#22851, ruling C] The same caller-context by-id read, classified for an
 * explain asker who is NOT the principal being explained: does the read leave
 * this caller without the row? No row, and a declared 4xx refusal (the
 * object's read grant withheld, a predicate the driver will not compile), are
 * both "cannot read": neither gives the caller the record, so neither may let
 * an explanation say it exists. A store fault propagates, as in
 * {@link absentUnderCallerRead}. Only the classification of a refusal differs
 * from that predicate, and only for a third-party asker: a principal
 * explaining itself keeps the write path's notion, so its explanation shows
 * what its own doors do.
 */
export async function unreadableUnderCallerRead(read: () => Promise<unknown>): Promise<boolean> {
  const answer = await readUnlessRefused(read);
  return answer.refused || answer.value == null;
}

/**
 * [#21771 / #21829] The one classification of a caller-context read that the
 * write doors ask the read door's question with — the read's answer, or
 * `refused`:
 *
 *  - an answer: whatever the read door returned (no row, a row, a row set);
 *  - `refused`: a declared 4xx — the read itself was refused (the object's read
 *    grant withheld, a predicate the driver will not compile). Not a hidden
 *    row, so the write keeps the answer it has today;
 *  - anything else is a store fault and propagates as raised (#7505): an outage
 *    is neither an answer nor a refusal, and reporting it as either would
 *    relabel it.
 */
export async function readUnlessRefused<T>(
  read: () => Promise<T>,
): Promise<{ refused: true } | { refused: false; value: T }> {
  try {
    return { refused: false, value: await read() };
  } catch (e) {
    const status = declaredHttpStatus(e);
    if (status !== undefined && status < 500) return { refused: true };
    throw e;
  }
}

/**
 * [#21829] The most rows a predicate write's read question may name: the read
 * door's answer is composed onto the write as an id list, and this bounds it.
 *
 * The value is the platform's existing row ceiling for ONE predicate write,
 * `MAX_BULK_PER_ROW_HOOK_ROWS` (`@objectstack/spec/data`), not a second
 * literal: an object with per-row write hooks already refuses a predicate write
 * matching more rows than that, so a narrowed write never needs a longer list.
 * It also keeps the list well inside the bind-parameter limits of the SQL
 * dialects the drivers serve.
 *
 * ABOVE IT, the write is REFUSED (`INVALID_FILTER`, 400), before anything runs
 * — the rule the engine's own nested-relation lowering follows for the same
 * shape (an id list read under the caller's context, `cap + 1`, refused when
 * over). ⛔ Never a cut-off list, which would silently write fewer rows than
 * the caller can reach; ⛔ never "do not narrow", which would hand back the
 * existence signal to any predicate padded past the cap. The count it judges
 * is of rows the caller CAN read, so the refusal discloses nothing the read
 * door does not.
 */
export const PREDICATE_WRITE_READABLE_ID_CAP = MAX_BULK_PER_ROW_HOOK_ROWS;

/** [#21829] The refusal above {@link PREDICATE_WRITE_READABLE_ID_CAP}. */
export function predicateWriteReadableCapError(object: string, operation: string): Error {
  const err = new Error(
    `Refusing the predicate ${operation} on '${object}': its predicate matches more than ` +
      `${PREDICATE_WRITE_READABLE_ID_CAP} records you can read, and a predicate write is narrowed to the ` +
      `records you can read by id, at most ${PREDICATE_WRITE_READABLE_ID_CAP} per write. Nothing was written. ` +
      `Narrow the predicate so the write matches fewer records, and write in batches.`,
  ) as Error & { code?: string; status?: number; httpStatus?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  err.httpStatus = 400;
  return err;
}

/**
 * [#21829] A copy of the caller's predicate for the read question, so nothing
 * the read pipeline does to its own query can reach the predicate the write
 * runs with. A predicate that cannot be copied is asked as it stands — it is
 * the same predicate either way.
 */
export function copyOfCallerPredicate(where: unknown): unknown {
  try {
    return structuredClone(where);
  } catch {
    return where;
  }
}

/**
 * [ADR-0123 D2] Is this Layer 0 filter the fail-closed DENY sentinel — i.e. "a
 * walled posture on a tenant object, and the context carries no organization
 * scope to enforce with"?
 *
 * [ADR-0139 D2 step 2] Decided BY IDENTITY, the way the engine's composition
 * decides it: the wall's `deny` returns `RLS_DENY_FILTER` itself — the spec's
 * frozen object, never a spread copy (`tenantLayer0FilterOf`) — so the
 * reference is the whole test, and no value or shape is compared. Every other
 * Layer 0 return is a real tenant predicate (`organization_id = …` /
 * `organization_id $in […]`) or `null`, which no reference check can confuse
 * with it.
 */
export function isTenantWallDenial(filter: Record<string, unknown> | null | undefined): boolean {
  return filter === RLS_DENY_FILTER;
}

/** Normalize a raw object `requiredPermissions` (string[] | per-op map) into buckets. */
function normalizeRequiredPermissions(raw: unknown): NormalizedRequiredPermissions {
  if (Array.isArray(raw)) {
    return { all: raw.map(String), read: [], create: [], update: [], delete: [] };
  }
  if (raw && typeof raw === 'object') {
    const m = raw as Record<string, unknown>;
    const bucket = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
    return {
      all: [],
      read: bucket(m.read),
      create: bucket(m.create),
      update: bucket(m.update),
      delete: bucket(m.delete),
    };
  }
  return { all: [], read: [], create: [], update: [], delete: [] };
}

/**
 * [ADR-0066 ⑤] Capabilities required for `operation` = the `all` bucket UNION the
 * operation's CRUD bucket. The array form (only `all` populated) thus gates EVERY
 * operation exactly as before; the map form gates only the mapped CRUD classes and
 * leaves an unmapped custom op ungated. De-duplicated for a clean error message.
 */
export function requiredCapsForOperation(
  spec: NormalizedRequiredPermissions,
  operation: string,
): string[] {
  const bucket = crudBucketForOperation(operation);
  const caps = bucket ? [...spec.all, ...spec[bucket]] : spec.all;
  return caps.length > 0 ? [...new Set(caps)] : [];
}

/**
 * The plugin's OWN report sink — the channel its fail-closed refusals reach an
 * operator through, distinct from `ctx.logger`, which exists only once a host
 * has driven this plugin's lifecycle.
 *
 * ## `warn` is NON-optional, and the default below is what stops that being a lie
 *
 * #9754: a sink declaring an optional `error` must declare a NON-optional
 * `warn`, so a durability report always has somewhere to land. This field could
 * not satisfy that by dropping a `?` while it was initialised `= {}` — a
 * required member on an empty object literal is a type that lies, and every
 * report site here is spelled `this.logger.warn?.(…)`, so an unbound sink is
 * not a state any caller can notice. It reports nothing, quietly. #10556
 * escalated the question rather than answering it to make a checker green, and
 * the maintainer ruled (2026-08-24): the DEFAULT becomes a console-backed sink,
 * loud until a host injects one; silent-by-declaration is REJECTED.
 *
 * `error` stays OPTIONAL, deliberately, by the same ruling that created the
 * rule (#9754 option C, falsified): hosts do inject reduced sinks, so requiring
 * `error` forecloses the legitimate `{ warn }`-only host. What changed is that
 * its ABSENCE now has a guaranteed destination.
 */
interface SecurityReportSink {
  info?: (...a: any[]) => void;
  /**
   * The GUARANTEED fallback channel (#9754). A durability report degrades to
   * `warn` and no further — `info` is the level AGENTS.md → "Degradation log
   * levels" calls the reassuring half-truth — so this is the one member every
   * value of this type must carry.
   */
  warn: (...a: any[]) => void;
  error?: (...a: any[]) => void;
}

/**
 * The default {@link SecurityReportSink}: console-backed, so a plugin nobody
 * injected a sink into still REPORTS (#10556 limb (a), maintainer ruling
 * 2026-08-24).
 *
 * ## What it carries, and what it deliberately does not
 *
 * The two REPORT channels only. `info` is left undefined: it carries no
 * durability report, so a host-less boot spraying routine chatter at stdout
 * would be noise bought with nothing. `info` being optional in the type above
 * is the same statement from the other side.
 *
 * ## Why one shared frozen value
 *
 * It holds no state and closes over no instance, so a fresh object per plugin
 * would differ only in identity; `Object.freeze` records that the plugin does
 * not mutate its own default. Nothing here replaces a host sink — `start()`
 * ASSIGNS `ctx.logger` over this field, above both of its early bail-outs
 * (#10706), so a degraded boot reports through the host too.
 */
/**
 * [#13419 执行要点 3; #24757 under 「甲」] The stable event name stamped on every
 * position-name-fold report — the structured half of
 * {@link SecurityPlugin.reportNameFoldCollisions}, so an operator can grep one
 * token for every grant that exists only because a position and a permission
 * set share a name.
 *
 * ## The 18.x loud half of the fold's retirement
 *
 * The standing ruling 「甲」 (ruling record 6292005854 on #6015) splits a
 * narrowing that no ADR-0087 conversion can carry: 18.x ships only its loud
 * half, and the refusal waits for 19.0. Retiring the position-name fold is
 * such a narrowing: the platform cannot write `permissionSets` into a sealed
 * managed position definition (ADR-0131 D6), so nothing rewrites an author's
 * reliance on it (triage's derivation for #24757, record 6292072572). This
 * event is that loud half's REPORTED EVENT. Every report carries the retirement
 * as data, `removedIn: 'next_major'`, beside the fields it has always carried
 * (`event`, `position`, `permissionSet`), which stay unchanged because a log
 * consumer may already key on them. 19.0 removes the fold, and with it this
 * event and its reporter (the card's 19.0 half).
 *
 * Deliberately NOT exported from this package. The maintainer ruling this
 * serves permits a warning and nothing more; adding a published symbol would
 * widen the surface a slice that changes no resolution result has no business
 * widening. Its pin asserts the literal rather than importing it, which is what
 * makes a silent rename fail.
 *
 * snake_case per the precedent beside it (`platform_owner_wall_bypass`): this
 * is a data value, not an error code (ADR-0112 governs those).
 */
export const POSITION_NAME_FOLD_EVENT = 'position_name_fold_grant';

const CONSOLE_SECURITY_SINK: SecurityReportSink = Object.freeze({
  warn: (...a: any[]) => { console.warn(...a); },
  error: (...a: any[]) => { console.error(...a); },
});

export interface SecurityPluginOptions {
  /**
   * Additional permission sets to register with the metadata service on
   * plugin start. Defaults to {@link securityDefaultPermissionSets}
   * (admin_full_access / member_default / viewer_readonly).
   */
  defaultPermissionSets?: PermissionSet[];
  /**
   * Permission set name applied as an implicit ADDITIVE baseline on every
   * authenticated human request (ADR-0090 D5: `baseline ∪ explicit, always`).
   * This guarantees baseline tenant/owner RLS for every logged-in user even
   * before an admin assigns explicit profiles.
   *
   * [#7555] Naming a set here ADDS it to the baseline; it does not REPLACE the
   * platform baseline (`member_default`), which composes in alongside it — see
   * {@link composeHumanBaselinePermissionSets}. An app declaring `isDefault`
   * therefore keeps the built-in Account destinations working for its members
   * instead of silently costing them the whole platform floor.
   *
   * Set to `null` to disable the baseline entirely — the platform one included.
   *
   * @default 'member_default'
   */
  fallbackPermissionSet?: string | null;
  /**
   * [ADR-0131 D5] The package defaults this deployment accepts for the
   * `everyone` anchor, declared as host configuration — read ONLY under a
   * walled posture (`group` / `isolated`, `postureEnforcesWall`).
   *
   * Under a wall, platform standing is configuration, and no reserved
   * organization owns deployment-level rows (ADR-0131 §1.5). So a walled host
   * names here the `isDefault: true` permission sets every signed-in member
   * holds beside the baseline. Declared, this list IS the deployment-level
   * acceptance: the `everyone` definition derives from the baseline plus these
   * sets, the `sys_audience_binding_suggestion` record is neither read nor
   * written, and its list / accept / dismiss doors answer 409
   * `SUGGESTION_STATE` naming this option. `[]` declares that nothing beyond
   * the baseline is accepted.
   *
   * Each name passes the same checks an accepted suggestion does, on every
   * derivation: the security catalog serves it under some package, it declares
   * `isDefault: true`, and it carries no bit the `everyone` anchor forbids
   * (ADR-0090 D7). A name failing one is not granted and is reported — at
   * `error` for a forbidden bit.
   *
   * Omitted (the default), the acceptance is the record, owned by the Default
   * Organization, as before. Declared under the `single` posture it is refused
   * at `start()`: there the record is the acceptance (ADR-0131 D5's
   * Default-Organization row), and a declaration nothing reads would only
   * look enforced.
   */
  acceptedDefaultPermissionSets?: readonly string[];
}

/**
 * SecurityPlugin
 *
 * Provides RBAC, Row-Level Security, and Field-Level Security runtime.
 * Registers as an engine middleware on the ObjectQL engine.
 *
 * This plugin is fully optional — without it, the system operates
 * without permission checks (same as current behavior).
 *
 * **Multi-tenant Organization scoping is provided by the separate
 * `@objectstack/organizations` package** (auto-stamps
 * `organization_id` on insert, per-org seed replay, default-org
 * bootstrap). When that plugin is installed, SecurityPlugin detects
 * it via `getService('org-scoping')` and keeps the tenant-scoped RLS
 * policies that ship with the default permission sets. Without it,
 * *those shipped policies* are stripped so single-tenant deployments
 * don't pay the field-existence safety-net cost on every find —
 * app-authored policies are never stripped (ADR-0105 D3; they are
 * retained and fail closed at compile time, see
 * `platform-tenant-policies.ts`).
 *
 * Dependencies:
 * - objectql service (ObjectQL engine with middleware support)
 * - metadata service (MetadataFacade for reading permission sets and RLS policies)
 */
/**
 * [ADR-0090 D5/D9] Anchor-safety predicates moved to `@objectstack/spec/security`
 * (P3) so the authoring linter (`validateSecurityPosture`) and this runtime
 * gate share ONE definition. Re-exported here for existing consumers.
 */
export { describeHighPrivilegeBits } from '@objectstack/spec/security';

/**
 * [ADR-0058 D4] The policies whose predicate the write post-image check
 * compiles, out of the policies that apply to this principal, object and write
 * operation (`insert` / `update`, `all` included).
 *
 * The published contract is `RowLevelSecurityPolicySchema.check`, which states
 * the per-operation composition below; read it there rather than from a quote
 * here. Its starting point is PostgreSQL's rule: a policy without `WITH CHECK`
 * holds new rows to its `USING`. Before this selector the
 * runtime compiled only policies that declared `check`, so a USING-only policy
 * never gated an INSERT or an UPDATE's new row. An author writing
 * `record.status != 'closed'` could store a closed row they could then not see.
 *
 * The composition, stated exactly:
 *
 * 1. **Some applicable policy declares `check`** → only those policies take
 *    part, OR-combined by `compileFilter`. That is today's result, byte for
 *    byte. A USING-only sibling in the same set does NOT add its `using` to
 *    the OR. Under PostgreSQL's permissive-OR composition it would, and that
 *    could only WIDEN the check. A grant spelled `id != null` would then erase
 *    every declared `check` beside it. Taking the narrower of the two readings
 *    is the fail-closed choice: a declared check never admits more than it did.
 * 2. **No applicable policy declares `check`** → every applicable policy with a
 *    `using` takes part, its `using` compiled as its check (`compileFilter`
 *    with `clause: 'check'` reads `using` for a policy that declares no
 *    `check`), OR-combined. This is the half that changed: those writes were
 *    unchecked, and a row outside every applicable `using` is now refused.
 * 3. **The platform's ownership floor takes part in case 2 exactly when the
 *    pre-image gate kept it** (`owner_only_writes`, recognised by provenance
 *    through {@link isPlatformOwnershipFloorPolicy}; `keepOwnershipFloor`).
 *    The by-id write gate lets a declared write authority replace the floor
 *    (an `allow` from the sharing service, a `public_read_write` OWD, a
 *    covering controlled-by-parent master gate). Each of those writes targets
 *    a row whose `created_by` is someone else, so the floor's `using` on the
 *    post-image would refuse them again one step later; there it stays out.
 *    Where the pre-image kept it, it stays in: an app-authored USING-only
 *    update policy is a WIDENER OR-ed with the floor at the pre-image
 *    (`stage == 'prospecting'`: anyone may edit an open deal), and leaving
 *    the floor out of the check would turn that widener into a restriction on
 *    the creator's own rows. With the floor in, the check is the pre-image's
 *    write-class OR applied to the new row — PostgreSQL's reading. An
 *    app-authored policy with the floor's predicate is not the floor; it
 *    always takes part.
 *
 * Layers compose as before: this is one principal's check. The delegator's
 * check (ADR-0090 D10) and the Layer 0 tenant post-image check are AND-ed with
 * it by the caller. The `modifyAllRecords` bypass on private / platform-global
 * objects still returns before this selector runs.
 */
export function writeCheckPolicies(
  applicable: RowLevelSecurityPolicy[],
  opts: { keepOwnershipFloor: boolean },
): RowLevelSecurityPolicy[] {
  const declared = applicable.filter((p) => policyDeclaresClause(p, 'check'));
  if (declared.length > 0) return declared;
  return applicable.filter(
    (p) => policyDeclaresClause(p, 'using') && (opts.keepOwnershipFloor || !isPlatformOwnershipFloorPolicy(p)),
  );
}

/**
 * The identity objects this plugin's authorization store READS — declared here,
 * enforced at boot by {@link refuseMissingAuthzIdentityObjects}, and ⛔ never
 * registered by this plugin: they belong to `@objectstack/plugin-auth`.
 *
 * Measured from the reads, not guessed: permission resolution runs through
 * `@objectstack/core`'s `resolveUserAuthzGrants` (per request, and for this
 * plugin's explain engine and scoped-invitation placement). Its reads are
 * `sys_user` and `sys_member`, which plugin-auth registers, plus
 * `sys_user_position`, `sys_user_permission_set`, `sys_position`,
 * `sys_position_permission_set` and `sys_permission_set`, which are this
 * plugin's own `securityObjects`, registered in `init()`. The engine refuses a
 * read of a name its registry does not hold (`OBJECT_NOT_FOUND`), and that
 * resolver reports the refusal as `AuthzStoreUnavailableError` (503) on every
 * authenticated request: a missing dependency that reads as an outage.
 */
const AUTHZ_STORE_IDENTITY_OBJECTS: readonly string[] = ['sys_user', 'sys_member'];

/**
 * The boot refusal for a kernel that mounts this plugin without the identity
 * objects its authorization store reads. `missingObjects` names exactly the
 * ones absent from the engine's registry.
 */
export class AuthzIdentityObjectsMissingError extends Error {
  readonly missingObjects: readonly string[];

  constructor(missingObjects: readonly string[]) {
    super(
      `SecurityPlugin cannot boot: its authorization store reads ${AUTHZ_STORE_IDENTITY_OBJECTS.join(', ')}, `
        + `and this kernel does not register ${missingObjects.join(', ')}. Without them every `
        + 'authenticated request fails its permission read with AuthzStoreUnavailableError (503), '
        + 'which reads as an outage. @objectstack/plugin-auth registers these objects: mount '
        + 'AuthPlugin, or, on a kernel without authentication such as a test kit, mount '
        + 'createIdentityObjectsPlugin() from @objectstack/plugin-auth.',
    );
    this.name = 'AuthzIdentityObjectsMissingError';
    this.missingObjects = [...missingObjects];
  }
}

/**
 * Run from a `kernel:ready` handler: every plugin's `init()` and `start()` has
 * registered its manifests by then, and a throw there fails `bootstrap()` on
 * both kernels. That is the boot-gate moment the kernel documents; during
 * `init()` the registry is still filling. The question asked is the one the
 * read itself will ask: does the engine's registry resolve the name.
 */
function refuseMissingAuthzIdentityObjects(ctx: PluginContext): void {
  const ql = ctx.getService<IObjectQLEngine>('objectql');
  const missing = AUTHZ_STORE_IDENTITY_OBJECTS.filter((name) => !ql.getSchema(name));
  if (missing.length > 0) throw new AuthzIdentityObjectsMissingError(missing);
}

export class SecurityPlugin implements Plugin {
  name = 'com.objectstack.security';
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['security.permissions', 'security.rls', 'security.fieldMasker', 'security.bootstrapPermissionSets', 'security.fallbackPermissionSet', 'security.baselinePermissionSets'];
  type = 'standard' as const;
  version = '1.0.0';
  dependencies = ['com.objectstack.engine.objectql'];

  private permissionEvaluator = new PermissionEvaluator();
  private rlsCompiler = new RLSCompiler();
  private fieldMasker = new FieldMasker();
  private readonly bootstrapPermissionSets: PermissionSet[];
  private readonly fallbackPermissionSet: string | null;
  /** [ADR-0131 D5] {@link SecurityPluginOptions.acceptedDefaultPermissionSets}, frozen. */
  private readonly acceptedDefaultPermissionSets: readonly string[] | undefined;
  /**
   * [#7555, ADR-0090 D5] The HUMAN baseline, as the list of set names it is:
   * {@link fallbackPermissionSet} COMPOSED WITH the platform baseline
   * (`member_default`), deduped — `[]` when the baseline is disabled (`null`).
   *
   * `fallbackPermissionSet` stays the single name the app/deployment DECLARED
   * (that is what the `security.fallbackPermissionSet` service means, and what
   * consumers key attribution on); this is what actually RESOLVES per request.
   * Agents never see it — ADR-0090 D10 gives them a restricted ceiling instead.
   */
  private readonly baselinePermissionSets: string[];
  /**
   * Runtime probe — set in `start()` from
   * `ctx.getService('org-scoping')`. When `false`, the PLATFORM's own
   * tenant-scoped RLS policies are stripped from the per-request
   * policy set (saves the field-existence safety net cost on every
   * find in single-tenant deployments); app-authored policies are
   * retained and fail closed (ADR-0105 D3). When `true`, every policy
   * applies normally.
   */
  private tenancyPosture: TenancyPosture = 'single';
  /**
   * [ADR-0105 D11] The registered membership resolver, probed at `start()`.
   * `null` when none is installed — the overwhelmingly common case, and the
   * reason {@link stageRlsMembership} costs nothing when unused.
   */
  private rlsMembershipResolver: IRlsMembershipResolver | null = null;
  /**
   * [ADR-0105 D1] Back-compat view of {@link tenancyPosture}: "is an
   * organization wall enforced at all?" — the exact question the pre-spectrum
   * boolean answered. Layer 0 reads the posture itself; this stays for the
   * strip decision and the boot log, which only care wall / no wall.
   */
  private get orgScopingEnabled(): boolean {
    return postureEnforcesWall(this.tenancyPosture);
  }
  /**
   * [#12699] `problem` strings already warned about, so a junk
   * `OrgScopingEntitlement` key is explained once per boot rather than on
   * every read (the `warnedAuthoredTenantPolicies` pattern).
   */
  private readonly warnedEntitlementRefusals = new Set<string>();
  /**
   * [#12699] The deployment's `suppressUnboundedOrgAdminGrant` declaration,
   * read LIVE off the mounted `org-scoping` service — the same read pattern as
   * the seam's existing consumer (plugin-auth's `probeEntitledPostures`):
   * resolve the service per call, fail closed to "absent" on any miss.
   * Validation is memoized per service instance inside the reader; refusals
   * of the key this plugin consumes are warned once per boot here.
   *
   * [ADR-0131 D7] `platformGlobalObjects` is NOT consumed here any more, and
   * nothing in this plugin stands Layer 0 down for a declared object. The
   * declaration is the injected-columns plan's input, read by the engine's
   * schema registry (`@objectstack/objectql`): a declared object is
   * registered with no `organization_id` and declaring
   * `systemFields.tenant: false`, so the object's own two clauses in
   * {@link getObjectSecurityMeta} answer for it, and Layer 0 and the driver
   * agree by having nothing to scope. The engine warns for a junk
   * `platformGlobalObjects`; this plugin warns only for the key it reads.
   */
  private deploymentOrgScopingEntitlement(): DeploymentOrgScopingEntitlementReading {
    const reading = readDeploymentOrgScopingEntitlement(
      this.resolveKernelService?.('org-scoping'),
    );
    for (const refusal of reading.refused) {
      if (refusal.key !== 'suppressUnboundedOrgAdminGrant') continue;
      if (this.warnedEntitlementRefusals.has(refusal.problem)) continue;
      this.warnedEntitlementRefusals.add(refusal.problem);
      this.logger?.warn?.(
        `[security] org-scoping entitlement key '${refusal.key}' REFUSED — ${refusal.problem}`,
        { key: refusal.key, declared: refusal.value },
      );
    }
    return reading;
  }
  /**
   * [ADR-0105 D3] `object|policy` keys already reported by
   * {@link warnAuthoredTenantPolicyOnce}, so a retained authored tenant policy
   * is explained once per boot instead of on every find.
   */
  private readonly warnedAuthoredTenantPolicies = new Set<string>();
  /**
   * Per-object field-name cache. Populated lazily from the metadata
   * service / ObjectQL registry on first access per object. Schemas are
   * effectively immutable for the lifetime of the kernel today (hot
   * reload tears the kernel down), so we don't bother with
   * invalidation — a kernel restart drops the cache.
   */
  private readonly fieldNamesCache = new Map<string, Set<string> | null>();
  /**
   * [ADR-0053 D-D1 item 7 — #5930] Each object's declared `datetime` columns,
   * read in the SAME pass as {@link fieldNamesCache} (`loadObjectFieldNames`)
   * and invalidated with it. Handed to the RLS compile seam as
   * `RlsFieldGuard.datetime`, so the shared lowering's whole-day rule rewrites
   * a policy's `datetime` columns only — the scope every driver holds.
   */
  private readonly datetimeFieldNamesCache = new Map<string, ReadonlySet<string>>();
  /**
   * [#21242] Each object's declared columns as the spec's number-comparand
   * verdict reads them (`type`, and a `formula`'s `returnType`), read in the
   * SAME pass as {@link fieldNamesCache} and invalidated with it. Handed to the
   * RLS compile seam as `RlsFieldGuard.number`, so a policy comparand a
   * numeric column cannot be compared with is refused there, as the engine's
   * `where` door refuses it.
   */
  private readonly numberComparandFieldsCache = new Map<string, ReadonlyMap<string, NumberComparandDoorFieldMeta>>();
  /**
   * Per-object cache of tenancy opt-out. `true` means the schema
   * explicitly disabled multi-tenancy (`tenancy.enabled === false` or
   * `systemFields.tenant === false`). Wildcard policies that target
   * the conventional tenant column (`organization_id`) are treated as
   * *not applicable* on these tables instead of triggering the
   * field-missing deny sentinel — without this, every read of a
   * cross-org catalog (e.g. `sys_package`, the Marketplace) returns
   * zero rows.
   */
  private readonly tenancyDisabledCache = new Map<string, boolean>();
  /**
   * Service handles captured in `start()` so the request-time RLS resolution
   * (used by BOTH the engine middleware and the public {@link getReadFilter}
   * service method) shares one code path. `null` until `start()` wires them.
   */
  private metadata: any = null;
  private ql: any = null;
  /**
   * Who the seed-ownership claim hands rows to, as THIS boot's bootstrap
   * answered it — the admin the last pass promoted, or the one it found
   * already holding the unscoped grant. `undefined` until a bootstrap pass
   * names one, and only ever overwritten with a real answer.
   *
   * Kept because the claim is not a single pass (see
   * {@link claimSeedOwnershipOnSettle}). When a seed settles before any pass
   * has named a target — an in-budget seed settles before `kernel:ready` —
   * the claim asks `findExistingPlatformAdmin`, the same rule the bootstrap's
   * `already_have_admin` guard runs, rather than growing a second copy of that
   * scan here.
   */
  private claimTargetAdminUserId: string | undefined = undefined;
  /** [ADR-0090 D12] Delegated-admin write gate — wired in start() once `ql` exists. */
  private delegatedAdminGate: DelegatedAdminGate | null = null;
  /**
   * [C2 / ADR-0095] Lazy kernel-service resolver, captured in start(). Used by the
   * record-grained explain path to reach the optional `sharing` service (a
   * deployment without plugin-sharing simply resolves `undefined`). Late-bound so
   * plugin load order does not matter.
   */
  private resolveKernelService: ((name: string) => any) | null = null;
  /** Unsubscribe handle for metadata-change cache invalidation (runtime metadata edits). */
  private metadataWatch: { unsubscribe: () => void } | null = null;
  /** ADR-0055: cache the resolved master-detail relation per controlled_by_parent object. */
  private cbpRelCache = new Map<string, CbpRelation | null>();
  /**
   * [ADR-0066 D2/D3] Per-object security posture cache: `private` flag
   * (access.default), platform-global flag (tenancy disabled), and the object's
   * `requiredPermissions` capability contract. Populated lazily from the schema;
   * cleared on metadata change alongside the other schema-derived caches.
   */
  private readonly objectSecurityMetaCache = new Map<string, ObjectSecurityMeta>();
  /**
   * [ADR-0131 D3/D4] The permission-set loader for names the metadata list and
   * the bootstrap sets did not answer: the security catalog's definitions, by
   * name. Environment-level — the catalog takes no organization — so one loader
   * serves every caller. See where it is built.
   */
  private catalogSetLoader?: (names: string[]) => Promise<PermissionSet[]>;

  /**
   * The permission-set loader for ONE caller. `undefined` when no engine is
   * wired, so `resolvePermissionSets` keeps its "no third source" branch. The
   * caller does not choose the answer: the catalog is environment-level.
   */
  private dbLoaderForContext(_context: any): ((names: string[]) => Promise<PermissionSet[]>) | undefined {
    return this.catalogSetLoader;
  }
  /**
   * [#10757] Per-EXECUTION-CONTEXT memo for
   * {@link SecurityPlugin.resolvePermissionSetsForContext}.
   *
   * ## The duplicate it removes
   *
   * `findData` (`@objectstack/metadata-protocol`) answers a paginated list with
   * TWO engine operations — `find` for the page, then `count` for the total —
   * and this middleware runs on both. Each pass re-resolved the same permission
   * sets for the same context, so one `GET /data/:object?$top=1` issued
   * `select * from sys_permission_set where name in (...)` TWICE, back to back,
   * with identical bindings (measured on a real stack: queries 21 and 23 of 24).
   * On a database a network hop away that is a full round trip spent asking a
   * question already answered microseconds earlier.
   *
   * ## Why keying on the context object is the request scope
   *
   * The execution context is built ONCE per request and threaded unchanged
   * through every operation of that request — `@objectstack/rest` memoizes it
   * per `req` (`RestServer.execCtxMemo`), and the runtime/MCP dispatchers each
   * assemble one per dispatch. Keying a `WeakMap` on that object therefore
   * scopes the memo to exactly the resolution the context represents, and the
   * entry is collected with it: no TTL, no module-level table keyed by user id,
   * nothing that outlives the caller it was resolved for.
   *
   * ## Why a write epoch, and not object identity alone
   *
   * Object identity alone would be a staleness window rather than a
   * de-duplication: a context that performs a WRITE and then reads again is
   * entitled to see the write. A permission change lands as a write to
   * `sys_permission_set` / `sys_user_permission_set` / `sys_position_*` through
   * this very engine, so {@link SecurityPlugin.epoch} is bumped on every write
   * operation the engine seam sees -- before the `isSystem` bypass, so a
   * seeder, a package publish or the auto-org-admin grant invalidates too -- and
   * an entry is reused only while the epoch it was resolved at still stands.
   * Any write, by ANY context in this process, retires every entry.
   *
   * [#11968] That bump now happens in the ENGINE, ahead of the whole middleware
   * chain, rather than at the head of this plugin's middleware. The covered set
   * is unchanged -- it is the same seam -- but it is now covered BY
   * CONSTRUCTION rather than by two files agreeing on which operations count.
   *
   * What that leaves is exactly one thing: two reads by one context with no
   * intervening write, which is the find/count pair above and is the definition
   * of a duplicate question. It is NOT a cache -- nothing here survives a write,
   * and nothing here survives its context.
   */
  private readonly permissionSetMemo = new WeakMap<
    object,
    { epoch: number; key: string; sets: Promise<PermissionSet[]> }
  >();
  /**
   * [#10757, extracted #11968] Monotonic counter read by
   * {@link SecurityPlugin.permissionSetMemo}; see its doc for why the guard
   * exists and what it is guarding against.
   *
   * The counter itself is no longer this plugin's. #11633 §10.3 hoisted the
   * mechanism into the engine (`ObjectQL.writeEpoch`), so every consumer of
   * "something authorization-relevant changed" shares ONE signal instead of
   * each watching its own subset of writes. {@link resolveWriteEpochSource}
   * binds to the engine's seam when the wired engine exposes it and falls back
   * to a private counter when it does not — the pre-`start()` value here is
   * that fallback, so the memo is never keyed on `undefined`.
   */
  private epoch: WriteEpochSource = localWriteEpochSource();
  /**
   * [#21771] The engine operations in flight through this plugin's middleware,
   * as an async scope: the middleware runs the rest of the chain (the engine's
   * hooks and driver call included) inside it, so an operation that starts
   * while another is still in that chain reads `true` here.
   *
   * That is the line ruling A draws between the by-id write a caller ADDRESSED
   * at a door and the by-id writes the platform issues on the caller's behalf
   * under the caller's context: the engine's cascade delete of each dependent
   * row, and a hook's `ctx.api` write. Only the addressed write is asked the
   * read question ({@link addressedByIdWriteId}; [#21829] for a predicate
   * write, {@link addressedPredicateWrite}). A nested one keeps today's
   * behaviour exactly: its target is a row the caller never named, so a
   * not-found answer would carry an id the caller never supplied and misstate
   * what happened to the write they did address.
   *
   * Owned here rather than stamped on the context: a context is shared by
   * reference and copied by spread across those very sub-writes (the cascade's
   * transaction context is a spread), so a stamp would leak in both directions.
   * An async scope cannot outlive the chain it wraps.
   */
  private readonly engineOperationScope = new AsyncLocalStorage<true>();
  /**
   * This plugin's report sink. Console-backed until a host injects one — see
   * {@link SecurityReportSink} and {@link CONSOLE_SECURITY_SINK} for the ruling
   * and for why `warn` is the member that is guaranteed (#9754 / #10556 (a)).
   */
  private logger: SecurityReportSink = CONSOLE_SECURITY_SINK;

  /**
   * [#13419 执行要点 3, warning half] Position names already reported by
   * {@link reportNameFoldCollision}, so the warning is LOUD ONCE rather than
   * once per request.
   *
   * Deduplication is what keeps it loud. This resolution runs on every request
   * whose context misses {@link permissionSetMemo}, so an undeduplicated warn
   * emits per request forever; that is the volume operators build a filter for,
   * and a filtered warning is a silent one. The set is per plugin INSTANCE, so
   * a restart re-reports — the condition is a deployment fact, and a fact worth
   * saying is worth saying again on the next boot.
   */
  private readonly nameFoldWarned = new Set<string>();

  /**
   * [ADR-0138 D4] The refusal reasons {@link refuseGuestWithoutOrganization}
   * has already reported to the operator — once per reason per instance, for
   * the reason {@link nameFoldWarned} gives: the condition is a deployment
   * fact, and a per-request line is a filtered one.
   */
  private readonly guestOrganizationRefusalWarned = new Set<string>();

  /**
   * [#21729] Alternate matches other plugins contributed to the platform's
   * ownership floor, keyed by contributing plugin — read on every
   * {@link collectRLSPolicies} call, never copied into a resolved set, so a
   * contribution landing at `kernel:ready` is in force for the first request
   * and no memo can hold a set composed without it. The seam and its rules:
   * `ownership-floor-alternates.ts`.
   */
  private readonly ownershipFloorAlternates = new OwnershipFloorAlternates();

  constructor(options: SecurityPluginOptions = {}) {
    this.bootstrapPermissionSets =
      options.defaultPermissionSets ?? securityDefaultPermissionSets;
    this.fallbackPermissionSet =
      options.fallbackPermissionSet === undefined
        // ADR-0056 D7: an app may declare its default profile via `isDefault: true`
        // on a permission set; it becomes the fallback for users with no explicit
        // grants. Falls back to the built-in `member_default` when none is declared.
        ? (this.bootstrapPermissionSets.find((p) => (p as { isDefault?: boolean }).isDefault)?.name ?? PLATFORM_BASELINE_PERMISSION_SET)
        : options.fallbackPermissionSet;
    // [#7555] …and the baseline that actually resolves is that name COMPOSED
    // with the platform's own, never one displacing the other (ADR-0090 D5).
    this.baselinePermissionSets = composeHumanBaselinePermissionSets(this.fallbackPermissionSet);
    this.acceptedDefaultPermissionSets = readAcceptedDefaultPermissionSetsOption(options.acceptedDefaultPermissionSets);
  }

  /**
   * [ADR-0131 D5] Where the deployment-level acceptance lives: the posture this
   * plugin resolved, and the host's declaration (read only under a wall).
   */
  private deploymentAcceptance(): DeploymentAcceptance {
    return { posture: this.tenancyPosture, acceptedDefaultPermissionSets: this.acceptedDefaultPermissionSets };
  }

  async init(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Initializing Security Plugin...');

    // Register security services
    ctx.registerService('security.permissions', this.permissionEvaluator);
    ctx.registerService('security.rls', this.rlsCompiler);
    ctx.registerService('security.fieldMasker', this.fieldMasker);
    // Bootstrap permission sets (admin_full_access, member_default,
    // viewer_readonly by default) — exposed as a service so other
    // plugins (e.g. plugin-hono-server's /me/permissions endpoint)
    // can pass them as the fallback list to
    // `PermissionEvaluator.resolvePermissionSets` without re-importing
    // the platform-objects package directly.
    ctx.registerService('security.bootstrapPermissionSets', this.bootstrapPermissionSets);
    ctx.registerService('security.fallbackPermissionSet', this.fallbackPermissionSet);
    // [#7555] The baseline as it actually RESOLVES — the declared name composed
    // with the platform's own (ADR-0090 D5). `security.fallbackPermissionSet`
    // above keeps meaning "the single name this deployment declared", so
    // existing consumers keep their `string | null` contract; a consumer that
    // wants the effective baseline (`/auth/me/permissions`, REST) reads THIS
    // one and falls back to `[fallbackPermissionSet]` on a stack too old to
    // register it.
    ctx.registerService('security.baselinePermissionSets', this.baselinePermissionSets);
    // [#11974 / #11663 L4, pin #3] The read-only platform-admin AUDIT surface.
    // Under walled postures no grant row is minted any more, so "who
    // administers this deployment?" loses its row-based answer; this service
    // serves the config-derived one (`OS_PLATFORM_OWNER_EMAIL` through the ONE
    // parser, plus per-entry sys_user standing) for Setup / discovery /
    // health. Registered beside the other security services; deliberately has
    // no writable member — there is no runtime path that changes who a
    // platform administrator is (#11663 Choice 3A). The engine is resolved
    // lazily so registration does not depend on objectql's start order.
    ctx.registerService(
      'platformAdmin',
      createPlatformAdminService(() => {
        try {
          return ctx.getService('objectql');
        } catch {
          return undefined;
        }
      }),
    );

    // [ADR-0126 §6 wall 3] The access upgrade check the marketplace door asks
    // before it replaces an installed package: the boot report's comparison,
    // run over the registry and over its projection with the incoming
    // manifest, answering only what the upgrade would create. Reached as a
    // service, so the door takes no dependency on this plugin. Its sources are
    // resolved at every call: the engine and the metadata service are bound in
    // `start()`. See `access-upgrade-check.ts`.
    ctx.registerService(
      ACCESS_UPGRADE_CHECK_SERVICE,
      createAccessUpgradeCheck({
        engine: () => this.ql as any,
        metadata: () => this.metadata,
        sharingRules: () => {
          try {
            const service = ctx.getService<Partial<DeclaredSharingRuleReader>>(SHARING_RULES_SERVICE);
            return typeof service?.listDeclaredRules === 'function' ? (service as DeclaredSharingRuleReader) : undefined;
          } catch {
            return undefined;
          }
        },
      }),
    );

    ctx.getService<{ register(m: any): void }>('manifest').register({
      ...securityPluginManifestHeader,
      objects: securityObjects,
      // Permission sets ride along on the manifest so the metadata service
      // can resolve them by name when SecurityPlugin middleware queries
      // `metadata.list('permissions')`.
      permissions: this.bootstrapPermissionSets,
      // ADR-0029 D7 — contribute the RBAC entries into the Setup app's
      // `group_access_control` slot. This plugin owns the security catalog, so
      // it ships its menu too; when the plugin is absent the entries don't
      // appear. [ADR-0131 D3/D7] Each entry opens Setup's list of the registry
      // type in its environment scope — the catalog has no object behind it.
      navigationContributions: [
        {
          app: 'setup',
          group: 'group_access_control',
          priority: 100,
          items: [
            { id: 'nav_positions', type: 'url', label: 'Positions', url: '/apps/setup/metadata/position?scope=environment', icon: 'shield-check' },
            { id: 'nav_capabilities', type: 'url', label: 'Capabilities', url: '/apps/setup/metadata/capability?scope=environment', icon: 'badge-check' },
            { id: 'nav_permission_sets', type: 'url', label: 'Permission Sets', url: '/apps/setup/metadata/permission?scope=environment', icon: 'lock' },
          ],
        },
      ],
    });

    // [ADR-0131 D2, ADR-0090 D5] The six built-in positions and the `everyone`
    // anchor's deployment baseline are declarations, so they are made here, in
    // the kernel contract's declaration phase — where a boot that composes this
    // plugin for its declarations only reaches them too. See
    // {@link declareBuiltinPositions}.
    this.declareBuiltinPositions(ctx);

    // ADR-0029 D8 — contribute this plugin's object translations to the i18n
    // service on kernel:ready (the i18n plugin may register after this one).
    if (typeof (ctx as any).hook === 'function') {
      (ctx as any).hook('kernel:ready', async () => {
        try {
          const i18n = ctx.getService<II18nService>('i18n');
          if (i18n && typeof i18n.loadTranslations === 'function') {
            const { SecurityTranslations } = await import('./translations/index.js');
            for (const [locale, data] of Object.entries(SecurityTranslations)) {
              i18n.loadTranslations(locale, data as Record<string, unknown>);
            }
          }
        } catch { /* i18n optional */ }
      });
    }

    // The seed-ownership claim runs whenever a seed settles, on every boot —
    // see {@link claimSeedOwnershipOnSettle}. Subscribed in `init()`, before ANY
    // plugin's `start()`: an in-budget seed fires `app:seeded` from inside
    // `AppPlugin.start()`, and the kernel orders starts by registration among
    // plugins with no edge between them (ADR-0116), so a subscription made in
    // this plugin's own `start()` misses that signal on every composition that
    // registers the app first. Nothing here resolves a service: the handler
    // reads the engine when it runs.
    if (typeof (ctx as any).hook === 'function') {
      (ctx as any).hook('app:seeded', (payload?: { appId?: string; overBudget?: boolean }) =>
        this.claimSeedOwnershipOnSettle(ctx, payload),
      );
    }

    ctx.logger.info('Security Plugin initialized', {
      defaultPermissionSets: this.bootstrapPermissionSets.map((p) => p.name),
    });
  }

  /**
   * The seed-ownership CLAIM, run on `app:seeded` — whenever a seed settles, on
   * every boot, the first one and every later one.
   *
   * ## Why a settle signal, and not the promotion alone
   *
   * The claim used to run exactly once per database lifetime, inside the one
   * pass that promotes the first admin — and that instant is not the moment the
   * seed is done. `AppPlugin` races its inline seed against
   * `OS_INLINE_SEED_BUDGET_MS` (default 8 s) and continues an over-budget bundle
   * in the BACKGROUND rather than block kernel start, so for any non-trivial app
   * the seeder is still writing while the claim walks the registry. Registry
   * order and seed order are unrelated: every object whose rows land after its
   * walk stayed `owner_id IS NULL` forever. Measured on a CRM bundle: 73 rows
   * across six objects, the same loser set on two independent boots.
   *
   * ⛔ The fix is NOT to widen `shouldReplayBootstrapFor`. A replayed bootstrap
   * short-circuits on `already_have_admin` and RETURNS before it ever reaches
   * the claim, so a wider trigger re-runs a pass that cannot do the thing that
   * was missed. What runs here is the claim itself.
   *
   * ## Why the target is resolved HERE when the bootstrap has not named it
   *
   * A later boot replays its seed into a database whose admin already exists,
   * and an in-budget replay settles inside `AppPlugin.start()` — BEFORE
   * `kernel:ready` runs the bootstrap that would name the target. Reading only
   * {@link claimTargetAdminUserId} there returned with nobody to claim to, and
   * the bootstrap that followed found the admin, promoted nobody and never
   * reached the claim: every row that replay inserted stayed ownerless for good.
   * So when no pass of this boot has named a target, this asks
   * `findExistingPlatformAdmin` — the bootstrap's own `already_have_admin`
   * rule, the same function, ⛔ never a second selection rule and never a
   * second claim path. On a first boot nobody holds the grant yet, the answer is
   * `undefined`, and the promotion that follows does its own claim.
   *
   * `app:seeded` fires once per app bundle, so the first fire is not
   * necessarily the last; the runtime settles the source BEFORE it triggers, so
   * this handler sees its own signal already reflected in the tally — and the
   * rows that source landed on, which it publishes before it settles. The claim
   * is idempotent (only seeded NULL-owned and `usr_system`-owned rows match) and every pass
   * reports whether its own reading was final, so running on each fire costs a
   * no-op walk and buys the guarantee.
   *
   * ⚠️ Scope: the predicates and the object filter are the promotion-time
   * pass's own, unchanged. A row a human already owns is not matched by either
   * predicate and cannot be touched here. A NULL-owner row is matched only when
   * the seed reported landing on it ({@link readSeededRecordIds}): a guest's or
   * a public form's unowned row keeps no owner on every boot (ADR-0138 D1).
   */
  private claimSeedOwnershipOnSettle(
    ctx: PluginContext,
    payload?: { appId?: string; overBudget?: boolean },
  ): Promise<void> {
    // [#25223 cut 11] The body moved to `security-plugin-seed-claim.ts` (see `SeedClaimHost`).
    const readClaimTargetAdminUserId = () => this.claimTargetAdminUserId;
    const host: Pick<SeedClaimHost, 'bootstrapPermissionSets' | 'claimTargetAdminUserId'> = {
      bootstrapPermissionSets: this.bootstrapPermissionSets,
      get claimTargetAdminUserId() { return readClaimTargetAdminUserId(); },
    };
    return claimSeedOwnershipOnSettle.call(host, ctx, payload);
  }

  async start(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Starting Security Plugin...');

    // The identity objects the authorization store reads must be registered by
    // the time the boot completes: a kernel without them is refused at
    // `kernel:ready`, by name, instead of at its first permission read.
    // Subscribed at the head of `start()`, so it runs ahead of this plugin's own
    // `kernel:ready` bootstraps, and above both bail-outs below. A boot that
    // composes this plugin for its declarations only (`os migrate`, which
    // suppresses `start()`) arms nothing that reads the store, and is not refused.
    if (typeof (ctx as any).hook === 'function') {
      (ctx as any).hook('kernel:ready', () => refuseMissingAuthzIdentityObjects(ctx));
    }

    // [#10706] Bind the report sink FIRST — above the two bail-outs below.
    // Both of them `return` before the "capture handles" block, so binding the
    // sink there left `this.logger` at its `= {}` construction default for the
    // whole LIFETIME of the instance on a degraded boot: every report site is
    // written `this.logger.warn?.(...)`, so an unbound sink is not a state any
    // caller can notice — it silently reports nothing. Assigning here is
    // correct under every option on #10556's open default-sink question, so it
    // does not wait on that ruling; the `= {}` default itself is #10556's.
    this.logger = ctx.logger;

    // Get required services
    let ql: IObjectQLEngine | undefined;
    let metadata: IMetadataService | undefined;

    try {
      ql = ctx.getService<IObjectQLEngine>('objectql');
      metadata = ctx.getService<IMetadataService>('metadata');
    } catch (e) {
      ctx.logger.warn('ObjectQL or metadata service not available, security middleware not registered');
      return;
    }

    if (!ql || typeof ql.registerMiddleware !== 'function') {
      ctx.logger.warn('ObjectQL engine does not support middleware, security middleware not registered');
      return;
    }

    // Capture handles so the request-time RLS resolution is shared by the
    // engine middleware AND the public getReadFilter service method.
    this.metadata = metadata;
    this.ql = ql;

    // [ADR-0131 D2] The six built-in positions, and `everyone`'s deployment
    // baseline as the fail-closed reading gives it, were declared in `init()`
    // ({@link declareBuiltinPositions}).
    // [ADR-0090 D5, ADR-0131 D3/D4] Here `everyone` is derived again with what
    // only a started kernel has: the high-privilege check against the stack's
    // declared capabilities (#18535), which are all in by `kernel:ready`, plus
    // every package default a `manage_metadata` holder accepted (#22801 → A),
    // which is a database read. Derived again on every accept, revoke,
    // uninstall and package publish (`declareEveryone`).
    if (typeof (ctx as any).hook === 'function') {
      (ctx as any).hook('kernel:ready', () => this.declareEveryone(ctx.logger));
    }

    // [ADR-0131 D3/D4] Bind the security catalog read to this engine: every
    // authorization resolution over it (`resolveUserAuthzGrants`, core) reads
    // positions, the sets they name and the set bodies through this reader.
    // An engine with no reader bound resolves an empty catalog — no position
    // distributes a set and no set grants — so a failure here is said at once.
    try {
      bindSecurityCatalogReader(ql, createSecurityCatalogReader({ registry: (ql as any).registry, metadata: metadata as any }));
    } catch (e) {
      ctx.logger.warn(
        '[security] the security catalog read was NOT bound to the ObjectQL engine: '
          + `${(e as Error).message} Every permission set and every position-bound set resolves to nothing `
          + 'until the engine exposes its registry and the metadata service is registered.',
      );
    }

    // [ADR-0131 D3, ADR-0066 D1] The curated capabilities are declared metadata
    // of THIS plugin too, by the same item seam and for the same reason: the
    // manifest's package door refuses a built-in name, and the curated names
    // are the built-in capability names (`builtin-capabilities.ts`). Sourced
    // from `PLATFORM_CAPABILITIES`, the list the curated seeding pass reads;
    // nothing here writes a `sys_capability` row.
    if (registerBuiltinCapabilities((ql as { registry?: unknown }).registry, SECURITY_PLUGIN_ID) === 0) {
      ctx.logger.warn(
        '[security] the curated platform capabilities were NOT declared as capability metadata: the ObjectQL '
          + 'engine exposes no registry that can register them. Their sys_capability rows still seed and no grant '
          + 'changes, but the security catalog read and GET /api/v1/meta/capability will not list them.',
      );
    }

    // [#18682] Answer the engine's create/update gate question for `validate()`.
    //
    // `validate()` runs no middleware for its target object, so without this the
    // dry run would answer for callers the write path refuses. Same evaluator
    // and same permission sets the CRUD gate itself uses — ⛔ not a second
    // decision about who may write.
    //
    // The PAYLOAD is passed straight through, because the write decision is not
    // object-level: the middleware's field-level write gate (step 2.5 below)
    // refuses a caller who holds the CRUD grant but may not edit a field the
    // payload names, before any rule runs. A probe that dropped the payload
    // would answer the preview for exactly that caller.
    //
    // Fails CLOSED: any resolution error denies, and the engine treats a denial
    // as "resolve nothing", which makes a traversing rule refuse in preview.
    if (typeof (ql as any).registerWriteGateProbe === 'function') {
      (ql as any).registerWriteGateProbe(
        (object: string, operation: 'insert' | 'update', context: any, data: unknown): Promise<boolean> =>
          this.canWriteObject(object, operation, context, data),
      );
    } else {
      // Absence must be loud. This engine takes middleware — so its write path
      // IS gated — but exposes no seam for the preview to ask the same
      // question, which means `validate()` there answers a traversing rule for
      // callers the write path would refuse. Functional degradation, not
      // durability: the deployment is visibly older than this plugin, and the
      // remedy is the version bump.
      ctx.logger.warn(
        '[security] this ObjectQL exposes no write-gate seam (registerWriteGateProbe), so the '
        + 'write PREVIEW (validate() / the dryRun import) cannot ask whether the caller could '
        + 'perform the write. A validation rule that reads through a reference field will be '
        + 'answered there for callers the real write path refuses. Upgrade @objectstack/objectql '
        + 'to a version that offers the seam.',
      );
    }

    // [#25062] Hand the engine the Layer 0 tenant write wall's verdict PER ROW,
    // so the write preview answers a row's organization as the write does: a
    // value the wall admits is not reported dropped where the write stores it,
    // and a value it refuses is answered `PERMISSION_DENIED`, not valid. The
    // probe above answers a caller class and is not this question; see
    // {@link writeWallVerdict}, which answers from the method step 3.7 calls.
    if (typeof (ql as any).registerWriteWallVerdict === 'function') {
      (ql as any).registerWriteWallVerdict(
        (
          object: string,
          operation: 'insert' | 'update',
          context: any,
          rows: readonly Record<string, unknown>[],
        ): Promise<WriteWallRowVerdict[] | null> => this.writeWallVerdict(object, operation, context, rows),
      );
    } else {
      // Absence must be loud, for the probe's reason: the write is walled
      // here and its preview cannot ask the wall.
      ctx.logger.warn(
        '[security] this ObjectQL exposes no write-wall verdict seam (registerWriteWallVerdict), so '
        + 'the write PREVIEW (validate() / the dryRun import) cannot ask the Layer 0 tenant wall about '
        + 'a row: it reports a caller-supplied organization_id as dropped where the write stores it, '
        + 'and answers valid where the write refuses it. Upgrade @objectstack/objectql to a version '
        + 'that offers the seam.',
      );
    }

    // [#18783] Hand the engine the subject's EFFECTIVE object permissions, so
    // `current_user.can(object, verb)` in an option's `visibleWhen` is answered
    // on the write path instead of failing open. The same method the
    // registered `security` literal exposes as `getEffectiveObjectPermissions`
    // (below) — one map, one producer. The engine asks it at most once per
    // write, and only for a write that picks an option whose predicate calls
    // `can`; a throw fails that write CLOSED there.
    if (typeof (ql as any).registerEffectiveObjectPermissionsResolver === 'function') {
      (ql as any).registerEffectiveObjectPermissionsResolver(
        (context: unknown): Promise<Readonly<Record<string, EffectiveObjectPermission>>> =>
          this.getEffectiveObjectPermissions(context),
      );
    } else {
      // Absence must be loud, and it is functional, not durability: the engine
      // is older than this plugin, so an option gated on `current_user.can(…)`
      // stays unevaluable there (admitted, one warn per write) exactly as it
      // was before the seam existed. The remedy is the version bump.
      ctx.logger.warn(
        '[security] this ObjectQL exposes no effective-permission seam '
        + '(registerEffectiveObjectPermissionsResolver), so an option visibleWhen that calls '
        + 'current_user.can(object, verb) cannot be answered on the write path and is admitted '
        + 'unenforced. Upgrade @objectstack/objectql to a version that offers the seam.',
      );
    }

    // [#11968] Bind the invalidation epoch to the ENGINE's seam when the wired
    // engine exposes one. Resolved here, once, rather than probed per request:
    // the plugin DI graph is static after start, and a per-request probe would
    // let the memo key on one counter and the invalidation land on another.
    this.epoch = resolveWriteEpochSource(ql);
    this.rlsCompiler.setLogger?.(ctx.logger);
    // [C2 / ADR-0095] Late-bound resolver for the optional `sharing` service.
    this.resolveKernelService = (name: string) => {
      try { return ctx.getService(name); } catch { return undefined; }
    };

    // Invalidate metadata-derived caches when object/field metadata changes
    // at runtime (Studio / AI authoring). Without this they go stale until
    // restart — even single-node. With a cluster pub/sub driver the
    // metadata.changed event propagates cross-node, so peers invalidate too.
    const md: any = this.metadata;
    if (typeof md?.watch === 'function') {
      this.metadataWatch = md.watch('*', () => {
        this.fieldNamesCache.clear();
        this.datetimeFieldNamesCache.clear();
        this.numberComparandFieldsCache.clear();
        this.tenancyDisabledCache.clear();
        this.cbpRelCache.clear();
        this.objectSecurityMetaCache.clear();
        // [#10757] A permission set can be DECLARED in metadata, so a metadata
        // change is a permission change even when no row was written. Retiring
        // the per-context memo here keeps it on the same invalidation footing
        // as every other metadata-derived cache above, rather than being the
        // one that survives a Studio edit.
        //
        // [#11968] This bump stays here whichever side owns the epoch: it is
        // precisely the invalidation the ENGINE seam cannot see, because no row
        // is written. The engine covers writes; this covers declarations.
        this.epoch.bump('metadata');
      });
    }

    // Resolve the tenancy POSTURE once at start time (the plugin DI graph is
    // static after start); Layer 0 and `collectRLSPolicies` consult it on every
    // request.
    //
    // ADR-0093 D4 / ADR-0105 D1 — prefer the `tenancy` service, the single
    // source of truth for which of `single` | `group` | `isolated` is in force
    // (a requested-but-unenforceable wall already resolves to `single` there).
    // Fall back to probing `org-scoping` directly when the tenancy service
    // isn't wired (e.g. an embedding without plugin-auth): its presence means
    // the historical `isolated` posture, preserving prior behavior exactly.
    try {
      const tenancy = ctx.getService<{ posture?: TenancyPosture; isolationActive?: boolean }>('tenancy');
      this.tenancyPosture =
        normalizeTenancyPosture(tenancy?.posture) ?? (tenancy?.isolationActive ? 'isolated' : 'single');
    } catch {
      try {
        this.tenancyPosture = ctx.getService('org-scoping') ? 'isolated' : 'single';
      } catch {
        this.tenancyPosture = 'single';
      }
    }
    // [ADR-0105 D2 / #3623] Hand the engine a posture accessor so its
    // driver-level NATIVE tenant scoping can widen to the caller's membership
    // union (`DriverOptions.tenantIds`) under the `group` posture. Wired from
    // HERE — the enforcement layer — on purpose: widening the driver wall is
    // only safe while the Layer 0 union wall enforces above it, so an
    // embedding without SecurityPlugin never widens (drivers keep active-org
    // equality — fail toward isolation).
    try {
      const engineSvc = ctx.getService<{ setTenancyPostureProvider?: (p: () => string | undefined) => void }>('objectql');
      engineSvc?.setTenancyPostureProvider?.(() => this.tenancyPosture);
    } catch {
      /* engine absent — nothing to widen */
    }
    // [ADR-0131 D5] The host's accepted package defaults are read only under a
    // wall; declared under `single` they are refused here, the first moment the
    // posture is known, rather than left looking enforced.
    refuseAcceptedDefaultsWithoutWall(this.tenancyPosture, this.acceptedDefaultPermissionSets);
    // [ADR-0105 D11] Optional app/plugin membership resolver for the §7.3.1
    // `IN (current_user.<key>)` sets. Absent is the norm — probe once.
    try {
      this.rlsMembershipResolver =
        ctx.getService<IRlsMembershipResolver>(RLS_MEMBERSHIP_RESOLVER_SERVICE) ?? null;
    } catch {
      this.rlsMembershipResolver = null;
    }
    if (this.rlsMembershipResolver) {
      ctx.logger.info('[security] rls-membership-resolver registered', {
        keys: this.rlsMembershipResolver.keys,
      });
      // [#25234 ruling A] One namespace: a key the resolver owns that an object
      // also declares (`membershipKeys`) resolves from neither source. Said at
      // boot, naming both owners, for the objects registered by now; a request
      // that meets a collision registered later says it again.
      for (const { key, objects } of resolverCollisionsOf(this.ql, this.rlsMembershipResolver)) {
        ctx.logger.error(resolverCollisionMessage(key, objects));
      }
    }

    if (this.orgScopingEnabled) {
      ctx.logger.info(
        `[security] tenancy posture '${this.tenancyPosture}' — the Layer 0 organization wall is ACTIVE ` +
          `(${this.tenancyPosture === 'group'
            ? 'organization_id IN accessible_org_ids — union access across the caller\'s memberships'
            : 'organization_id = active organization'})`,
      );
      // [#12699] Surface the deployment's grant-shaping declaration at arming
      // time: it is a security-relevant deployment fact, and this is also the
      // boot-time seam where a junk declaration gets its warn-once (the
      // accessor validates as a side effect), instead of surfacing on the
      // first request. [ADR-0131 D7] The platform-global list is announced by
      // the engine, which plans the columns from it — not here.
      const entitlement = this.deploymentOrgScopingEntitlement();
      if (entitlement.suppressUnboundedOrgAdminGrant) {
        ctx.logger.info(
          '[security] deployment suppresses the unbounded organization_admin auto-grant — ' +
            'membership-driven grants hand out organization_admin_no_bypass under this walled posture',
        );
      }
    } else {
      ctx.logger.info(
        "[security] tenancy posture 'single' — Layer 0 is inert; the platform's own tenant-scoped RLS policies are stripped (app-authored ones are retained and fail closed, ADR-0105 D3)",
      );
    }

    // [ADR-0131 D3/D4] The third source `resolvePermissionSets` asks, for the
    // names the metadata list and the bootstrap sets did not answer: the
    // security catalog's definition of each name (`securityCatalogReaderOf`,
    // the reader `bindSecurityCatalogReader` attached to this engine in
    // `start()`) — the environment registry, where every package manifest's
    // sets and every environment-authored set hydrated from `sys_metadata`
    // live. It is the same read the authorization resolver takes a set's body
    // from, so enforcement and resolution read one source.
    //
    // ⛔ No `sys_permission_set` row is read. A set that exists only as a row
    // (an organization's Setup-authored set under a wall, a row whose
    // definition was never saved) has no registry home, and the resolver
    // already grants nothing through it (#15196 Q3 = A); a row fallback here
    // would grant its object map anyway — a second source the cutover retires
    // (#22601 → B).
    //
    // ⛔ No `catch` either. A catalog read that did not happen throws the
    // reader's own `AuthzStoreUnavailableError`, and `resolvePermissionSets`
    // catches it one frame up: the unresolved sets grant nothing (fail closed)
    // and the failure is named in its warn (#2565). Swallowing it here would
    // report "no such set" for a read that never answered.
    //
    // Whether a set is switched off is not this loader's question: the names
    // it is asked for arrive already judged by the resolver's ledger read,
    // except a POSITION name folded into the request, which
    // `resolvePermissionSetsForContextUnmemoized` judges itself.
    this.catalogSetLoader = async (names: string[]) => {
      const catalog = securityCatalogReaderOf(ql);
      if (!catalog) return [];
      const out: PermissionSet[] = [];
      for (const name of new Set(names)) {
        const entry = await catalog.resolve('permission', name);
        if (entry) out.push(entry.definition as unknown as PermissionSet);
      }
      return out;
    };

    // [ADR-0090 D12] Delegated-admin gate shares the SAME permission-set
    // resolution as the CRUD middleware, so a delegate's authority and their
    // ordinary grants can never drift. (`ql` is guaranteed non-null here —
    // start() bailed out above without a middleware-capable engine.)
    this.delegatedAdminGate = new DelegatedAdminGate({
      ql,
      resolveSets: (context: any) => this.resolvePermissionSetsForContext(context),
      logger: ctx.logger,
    });

    // [ADR-0105 D8] Scoped-invitation placement. Registered HERE because the
    // authority it enforces is this plugin's: issuance dry-runs the very same
    // DelegatedAdminGate above against the `sys_user_position` rows the
    // acceptance would write, so an invitation can never place what its issuer
    // could not have assigned directly. plugin-auth consumes the service and
    // REFUSES placement intent when it is missing — no gate, no placement.
    ctx.registerService(
      INVITATION_PLACEMENT_SERVICE,
      createInvitationPlacementService({
        ql,
        gate: this.delegatedAdminGate,
        logger: ctx.logger,
      }),
    );

    // ADR-0021 D-C — expose the per-request READ scope as a reusable service.
    // The analytics raw-SQL path (which bypasses this engine middleware)
    // auto-bridges to `getService('security').getReadFilter(object, context)`
    // to enforce tenant/RLS on every base + joined object. We register the
    // service only once the metadata/ql/dbLoader handles are wired (above), so
    // a degraded start never exposes a half-initialised resolver.
    // [#25223 cut 11] The registration moved to `security-plugin-security-service.ts` (see `SecurityServiceHost`).
    {
      const readDelegatedAdminGate = () => this.delegatedAdminGate;
      const readLogger = () => this.logger;
      const readPermissionEvaluator = () => this.permissionEvaluator;
      const readQl = () => this.ql;
      const readTenancyPosture = () => this.tenancyPosture;
      const host: Pick<SecurityServiceHost, 'acceptedDefaultPermissionSets' | 'canExport' | 'canReadObject' | 'checkAuthoredRowWrite' | 'checkControlledByParentWrite' | 'declareEveryone' | 'delegatedAdminGate' | 'describePositionGrants' | 'explainAccessForCaller' | 'getEffectiveObjectPermissions' | 'getMetadataReadableFields' | 'getObjectSecurityMeta' | 'getQueryableFields' | 'getReadFilter' | 'getReadableFields' | 'getWritableFields' | 'logger' | 'ownershipFloorAlternates' | 'permissionEvaluator' | 'ql' | 'resolvePermissionSetsForContext' | 'tenancyPosture'> = {
        acceptedDefaultPermissionSets: this.acceptedDefaultPermissionSets,
        canExport: (...a) => this.canExport(...a),
        canReadObject: (...a) => this.canReadObject(...a),
        checkAuthoredRowWrite: (...a) => this.checkAuthoredRowWrite(...a),
        checkControlledByParentWrite: (...a) => this.checkControlledByParentWrite(...a),
        declareEveryone: (...a) => this.declareEveryone(...a),
        get delegatedAdminGate() { return readDelegatedAdminGate(); },
        describePositionGrants: (...a) => this.describePositionGrants(...a),
        explainAccessForCaller: (...a) => this.explainAccessForCaller(...a),
        getEffectiveObjectPermissions: (...a) => this.getEffectiveObjectPermissions(...a),
        getMetadataReadableFields: (...a) => this.getMetadataReadableFields(...a),
        getObjectSecurityMeta: (...a) => this.getObjectSecurityMeta(...a),
        getQueryableFields: (...a) => this.getQueryableFields(...a),
        getReadFilter: (...a) => this.getReadFilter(...a),
        getReadableFields: (...a) => this.getReadableFields(...a),
        getWritableFields: (...a) => this.getWritableFields(...a),
        get logger() { return readLogger(); },
        ownershipFloorAlternates: this.ownershipFloorAlternates,
        get permissionEvaluator() { return readPermissionEvaluator(); },
        get ql() { return readQl(); },
        resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
        get tenancyPosture() { return readTenancyPosture(); },
      };
      registerSecurityService.call(host, ctx, ql, metadata);
    }

    // Register security middleware
    // [#25223 cut 12] The middleware registration moved to `security-plugin-authz-middleware.ts` (see `AuthzMiddlewareHost`).
    {
      const readDelegatedAdminGate = () => this.delegatedAdminGate;
      const readEpoch = () => this.epoch;
      const readFieldMasker = () => this.fieldMasker;
      const readLogger = () => this.logger;
      const readPermissionEvaluator = () => this.permissionEvaluator;
      const readQl = () => this.ql;
      const host: Pick<AuthzMiddlewareHost, 'addressedByIdWriteId' | 'addressedPredicateWrite' | 'assertControlledByParentWrite' | 'callerCannotReadAddressedRow' | 'collectRLSPolicies' | 'composeWriteTenantWall' | 'computeControlledByParentFilter' | 'computeForbiddenFieldWrites' | 'computeLayeredRlsFilter' | 'computePartialMaskRules' | 'computeQueryGuardFieldPerms' | 'computeRlsFilter' | 'computeWriteCheckFilter' | 'delegatedAdminGate' | 'delegatorOwnWriteFloorOptions' | 'engineOperationScope' | 'epoch' | 'extractSingleId' | 'fieldMasker' | 'getCallerPreImage' | 'getObjectFieldNames' | 'logger' | 'maskOperationResult' | 'permissionEvaluator' | 'ql' | 'raiseWriteWallRefusal' | 'readableRowsScopeForPredicateWrite' | 'resolveCallerPosture' | 'resolveOperationPrincipals' | 'resolvePermissionSetsForContext' | 'resolvePreImageFloorDrop' | 'writeCheckFieldOptions'> = {
        addressedByIdWriteId: (...a) => this.addressedByIdWriteId(...a),
        addressedPredicateWrite: (...a) => this.addressedPredicateWrite(...a),
        assertControlledByParentWrite: (...a) => this.assertControlledByParentWrite(...a),
        callerCannotReadAddressedRow: (...a) => this.callerCannotReadAddressedRow(...a),
        collectRLSPolicies: (...a) => this.collectRLSPolicies(...a),
        composeWriteTenantWall: (...a) => this.composeWriteTenantWall(...a),
        computeControlledByParentFilter: (...a) => this.computeControlledByParentFilter(...a),
        computeForbiddenFieldWrites: (...a) => this.computeForbiddenFieldWrites(...a),
        computeLayeredRlsFilter: (...a) => this.computeLayeredRlsFilter(...a),
        computePartialMaskRules: (...a) => this.computePartialMaskRules(...a),
        computeQueryGuardFieldPerms: (...a) => this.computeQueryGuardFieldPerms(...a),
        computeRlsFilter: (...a) => this.computeRlsFilter(...a),
        computeWriteCheckFilter: (...a) => this.computeWriteCheckFilter(...a),
        get delegatedAdminGate() { return readDelegatedAdminGate(); },
        delegatorOwnWriteFloorOptions: (...a) => this.delegatorOwnWriteFloorOptions(...a),
        engineOperationScope: this.engineOperationScope,
        get epoch() { return readEpoch(); },
        extractSingleId: (...a) => this.extractSingleId(...a),
        get fieldMasker() { return readFieldMasker(); },
        getCallerPreImage: (...a) => this.getCallerPreImage(...a),
        getObjectFieldNames: (...a) => this.getObjectFieldNames(...a),
        get logger() { return readLogger(); },
        maskOperationResult: (...a) => this.maskOperationResult(...a),
        get permissionEvaluator() { return readPermissionEvaluator(); },
        get ql() { return readQl(); },
        raiseWriteWallRefusal: (...a) => this.raiseWriteWallRefusal(...a),
        readableRowsScopeForPredicateWrite: (...a) => this.readableRowsScopeForPredicateWrite(...a),
        resolveCallerPosture: (...a) => this.resolveCallerPosture(...a),
        resolveOperationPrincipals: (...a) => this.resolveOperationPrincipals(...a),
        resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
        resolvePreImageFloorDrop: (...a) => this.resolvePreImageFloorDrop(...a),
        writeCheckFieldOptions: (...a) => this.writeCheckFieldOptions(...a),
      };
      registerAuthzMiddleware.call(host, ctx, ql, metadata);
    }

    ctx.logger.info('Security middleware registered on ObjectQL engine');

    // [#25223 cut 13] The registrations that follow the security middleware moved to `security-plugin-start-hooks.ts` (see `StartHooksHost`).
    {
      const readClaimTargetAdminUserId = () => this.claimTargetAdminUserId;
      const writeClaimTargetAdminUserId = (v: SecurityPlugin['claimTargetAdminUserId']) => { this.claimTargetAdminUserId = v; };
      const readMetadata = () => this.metadata;
      const readTenancyPosture = () => this.tenancyPosture;
      const host: Pick<StartHooksHost, 'bootstrapPermissionSets' | 'claimTargetAdminUserId' | 'declareEveryone' | 'deploymentAcceptance' | 'deploymentOrgScopingEntitlement' | 'metadata' | 'tenancyPosture'> = {
        bootstrapPermissionSets: this.bootstrapPermissionSets,
        get claimTargetAdminUserId() { return readClaimTargetAdminUserId(); },
        set claimTargetAdminUserId(v) { writeClaimTargetAdminUserId(v); },
        declareEveryone: (...a) => this.declareEveryone(...a),
        deploymentAcceptance: (...a) => this.deploymentAcceptance(...a),
        deploymentOrgScopingEntitlement: (...a) => this.deploymentOrgScopingEntitlement(...a),
        get metadata() { return readMetadata(); },
        get tenancyPosture() { return readTenancyPosture(); },
      };
      registerStartHooks.call(host, ctx, ql);
    }

    // Per-organization seed DATA replay on `sys_organization` insert (business
    // records) lives in `@objectstack/organizations`. Install that plugin for
    // multi-tenant deployments. The RBAC catalog needs no such replay: this
    // plugin writes no catalog row, and every organization reads the same
    // registry (ADR-0131 D3).
  }

  /**
   * [ADR-0090 D5/D7, ADR-0131 D3, #22801 → A] Declare the `everyone` anchor's
   * definition: the deployment's baseline (minus any set with high-privilege
   * bits) plus every package default a `manage_metadata` holder accepted, as
   * the derivation reads them (`readAcceptedEveryoneSets`). This plugin is the
   * definition's only declarer, and no caller writes it: an acceptance changes
   * the derivation's input, and this re-declares the result.
   *
   * Never silent. A withheld acceptance is reported with its reason — at
   * `error` when the set now carries a bit the anchor forbids, since the record
   * then says "accepted" while nothing is granted — and a derivation that
   * could not read the record keeps the baseline alone and says so at `error`.
   * The grants caches retire on the metadata epoch, as for any declaration.
   */
  private declareEveryone(logger: PluginContext['logger']): Promise<void> {
    // [#25223 cut 10] The body moved to `security-plugin-everyone-anchor.ts` (see `EveryoneAnchorHost`).
    const readEpoch = () => this.epoch;
    const readMetadata = () => this.metadata;
    const readQl = () => this.ql;
    const host: Pick<EveryoneAnchorHost, 'deploymentAcceptance' | 'epoch' | 'everyoneBaseline' | 'metadata' | 'ql'> = {
      deploymentAcceptance: (...a) => this.deploymentAcceptance(...a),
      get epoch() { return readEpoch(); },
      everyoneBaseline: (...a) => this.everyoneBaseline(...a),
      get metadata() { return readMetadata(); },
      get ql() { return readQl(); },
    };
    return declareEveryone.call(host, logger);
  }

  /**
   * [ADR-0090 D5] The deployment's baseline as `everyone` names it: the
   * declared baseline minus every shipped set carrying a high-privilege bit,
   * judged against `context` — the stack's declared capabilities. Pure: the
   * one derivation {@link declareBuiltinPositions} and {@link declareEveryone}
   * share. `onWithheld` hears each set it leaves out.
   */
  private everyoneBaseline(
    context: AnchorBindingContext | undefined,
    onWithheld?: (set: string, offending: string) => void,
  ): string[] {
    return this.baselinePermissionSets.filter((name) => {
      const boot = this.bootstrapPermissionSets.find((p) => p.name === name);
      const offending = boot ? describeHighPrivilegeBits(boot, context) : null;
      if (offending) onWithheld?.(name, offending);
      return !offending;
    });
  }

  /**
   * [ADR-0131 D2, ADR-0090 D5] Declare the six built-in positions, with
   * `everyone` naming the deployment's baseline, to the engine registry — from
   * `init()`, the kernel contract's declaration phase.
   *
   * They are metadata of THIS plugin, as its permission sets are, and their one
   * home: no boot step writes a `sys_position` row for them. Not through the
   * manifest registration: a manifest `positions` key reaches no registry (see
   * `builtin-positions.ts`), so they go to the engine registry by its own seam,
   * under this plugin's package id. Registry writes only — nothing here reads or
   * writes the database.
   *
   * Why `init()`: a boot that composes this plugin for its declarations only
   * runs `init()` and no `start()` and no hook — `os migrate
   * organization-ownership --apply` resolves position bindings against this
   * catalog, and declared from `start()` and `kernel:ready` neither the
   * built-ins nor the baseline reached it.
   *
   * The baseline here is the fail-closed reading: no declared-capability
   * context, because the stack's declarations are still arriving while plugins
   * initialize, and a verdict read off a still-filling registry is one the boot
   * can contradict. With no context a token is never excused, so this list is
   * never wider than the one {@link declareEveryone} derives at `kernel:ready`,
   * which replaces it on a started kernel and adds the accepted package
   * defaults (a database read, which stays there). Nothing is reported here:
   * {@link declareEveryone} reports what it withholds.
   */
  private declareBuiltinPositions(ctx: PluginContext): void {
    // [#25223 cut 10] The body moved to `security-plugin-everyone-anchor.ts` (see `EveryoneAnchorHost`).
    const host: Pick<EveryoneAnchorHost, 'everyoneBaseline'> = {
      everyoneBaseline: (...a) => this.everyoneBaseline(...a),
    };
    declareBuiltinPositions.call(host, ctx);
  }

  async destroy(): Promise<void> {
    this.metadataWatch?.unsubscribe();
    this.metadataWatch = null;
    unregisterGrantPermissionSetNameHooks(this.ql);
  }

  /**
   * ADR-0021 D-C — resolve the per-request READ scope (tenant + RLS predicate)
   * for one object as a canonical `FilterCondition`, WITHOUT touching the
   * ObjectQL engine. This is the seam the analytics raw-SQL path bridges to so
   * it enforces the SAME row scoping the engine middleware applies on `find`.
   *
   * Returns:
   *   - `undefined` → no scope applies (a system context). [#21908] A context
   *     with no userId/positions/permissions is not this case: ADR-0096 D5
   *     strict mode answers it the `RLS_DENY_FILTER` sentinel below.
   *   - a `FilterCondition` → AND it into the object's scan (the join's `ON`/
   *     `WHERE` for analytics; the where clause for a plain find).
   *   - the `RLS_DENY_FILTER` sentinel → policies applied but none compiled, or
   *     resolution failed — fail-closed to zero rows. NEVER returns "allow all"
   *     on error, so a degraded permission subsystem cannot leak cross-tenant
   *     rows through analytics.
   *
   * Async because permission-set resolution can hit the database; the analytics
   * service pre-resolves these per request (base + every joined object) before
   * the synchronous SQL builder runs.
   */
  /**
   * [ADR-0090 D6] Explain access for a caller. `request.userId` (explaining
   * someone else) requires the caller to hold `manage_users`, be system, be
   * the organization administrator of an organization the target is a member
   * of (D12 as amended 2026-10-17), or —
   * [D12] — hold a delegated `adminScope` whose BU subtree covers the target
   * user (an access report is itself sensitive data, but an admin who can
   * already rewire a user's grants may read why they resolve as they do).
   * The evaluation delegates to the explain engine with the SAME internals
   * the middleware uses.
   *
   * [#22792] ...and with the CALLER as the asker. Whether the explanation may
   * say a record exists is decided by the caller's read of it, never by the
   * explained user's: a caller the read door does not return the record to is
   * answered exactly as for an id no row carries. [#22851, ruling C] A caller
   * explaining ANOTHER user whose read of the record is refused (a declared
   * 4xx) is answered so too; a caller explaining itself keeps the write path's
   * notion (no row), so its explanation shows what its own doors do.
   */
  explainAccessForCaller(
    request: { object: string; operation: string; userId?: string; recordId?: string },
    callerContext?: any,
  ): Promise<ExplainDecision> {
    // [#25223 cut 10] The body moved to `security-plugin-explain-access.ts` (see `ExplainAccessHost`).
    const readDelegatedAdminGate = () => this.delegatedAdminGate;
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const readQl = () => this.ql;
    const readResolveKernelService = () => this.resolveKernelService;
    const readTenancyPosture = () => this.tenancyPosture;
    const host: Pick<ExplainAccessHost, 'baselinePermissionSets' | 'checkControlledByParentWrite' | 'collectRLSPolicies' | 'computeLayeredRlsFilter' | 'computeReadPartialMaskRules' | 'computeRlsFilter' | 'delegatedAdminGate' | 'foldFieldRequiredPermissions' | 'getObjectSecurityMeta' | 'permissionEvaluator' | 'ql' | 'readRowById' | 'resolveKernelService' | 'resolvePermissionSetsForContext' | 'resolvePreImageFloorDrop' | 'resolveSharingReadFilter' | 'resolveWriteScopeForSharing' | 'tenancyPosture'> = {
      baselinePermissionSets: this.baselinePermissionSets,
      checkControlledByParentWrite: (...a) => this.checkControlledByParentWrite(...a),
      collectRLSPolicies: (...a) => this.collectRLSPolicies(...a),
      computeLayeredRlsFilter: (...a) => this.computeLayeredRlsFilter(...a),
      computeReadPartialMaskRules: (...a) => this.computeReadPartialMaskRules(...a),
      computeRlsFilter: (...a) => this.computeRlsFilter(...a),
      get delegatedAdminGate() { return readDelegatedAdminGate(); },
      foldFieldRequiredPermissions: (...a) => this.foldFieldRequiredPermissions(...a),
      getObjectSecurityMeta: (...a) => this.getObjectSecurityMeta(...a),
      get permissionEvaluator() { return readPermissionEvaluator(); },
      get ql() { return readQl(); },
      readRowById: (...a) => this.readRowById(...a),
      get resolveKernelService() { return readResolveKernelService(); },
      resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
      resolvePreImageFloorDrop: (...a) => this.resolvePreImageFloorDrop(...a),
      resolveSharingReadFilter: (...a) => this.resolveSharingReadFilter(...a),
      resolveWriteScopeForSharing: (...a) => this.resolveWriteScopeForSharing(...a),
      get tenancyPosture() { return readTenancyPosture(); },
    };
    return explainAccessForCaller.call(host, request, callerContext);
  }

  /**
   * [#4467] The OWD / record-sharing half of the read scope — plugin-sharing's
   * `buildReadFilter` for `object` under `context`, resolved through the
   * late-bound `sharing` service.
   *
   * `getReadFilter` promises "the same filter the engine middleware AND-s into
   * every find". That chain is TWO sibling middlewares: this plugin's RLS
   * injection and plugin-sharing's owner/share visibility filter. Only the RLS
   * half was ever computed here, so the analytics raw-SQL path — which bypasses
   * the engine and has no other source of scope — ran with no owner predicate at
   * all: a member could `COUNT(*)` an owner-private object they hold no share on,
   * and `GROUP BY title` read the values themselves out of rows `/data` correctly
   * refused them.
   *
   * The DEPTH the owner-match widens to (ADR-0057 D1) is stashed on the context
   * by the middleware as `__readScope` before plugin-sharing reads it; no
   * middleware runs on this path, so it is computed here from the SAME evaluator
   * call the middleware makes. Without it a caller granted `unit`/`org` read
   * depth would be scoped to `own` — safe, but a silent disagreement between
   * `/data` and `/analytics` in the other direction.
   *
   * Returns `null` when the sharing layer imposes nothing (no plugin-sharing, a
   * public object, an object with no owner field, a bypass object). THROWS on a
   * resolution failure so the caller can fail closed — a dropped sharing
   * predicate is exactly the leak this fixes.
   */
  private resolveSharingReadFilter(
    object: string,
    context: any,
    resolvedSets?: PermissionSet[],
    /**
     * [ADR-0090 D10] The depth to stamp instead of the one `getEffectiveScope`
     * answers for `resolvedSets` — what step 2.6 stamps on a DELEGATED read,
     * where the agent leg carries the intersected depth and the delegator leg
     * its own ({@link computeDelegatedReadFilter}). Absent on every
     * non-delegated call, which resolves the depth here as before.
     */
    depth?: string,
  ): Promise<Record<string, unknown> | null> {
    // [#25223 cut 10] The body moved to `security-plugin-sharing-verdicts.ts` (see `SharingVerdictsHost`).
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const readResolveKernelService = () => this.resolveKernelService;
    const host: Pick<SharingVerdictsHost, 'collectRLSPolicies' | 'getObjectSecurityMeta' | 'permissionEvaluator' | 'resolveKernelService' | 'resolvePermissionSetsForContext'> = {
      collectRLSPolicies: (...a) => this.collectRLSPolicies(...a),
      getObjectSecurityMeta: (...a) => this.getObjectSecurityMeta(...a),
      get permissionEvaluator() { return readPermissionEvaluator(); },
      get resolveKernelService() { return readResolveKernelService(); },
      resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
    };
    return resolveSharingReadFilter.call(host, object, context, resolvedSets, depth);
  }

  /**
   * [#5386] The OWD / record-sharing half of a SINGLE-RECORD write gate — the
   * write analogue of {@link resolveSharingReadFilter}.
   *
   * plugin-sharing's own middleware gates a by-id `update` on `canEdit(object,
   * id, ctx)` (ownership widened by write DEPTH, an `edit`-level
   * `sys_record_share` grant, or the `modifyAllRecords` bypass). This resolves
   * exactly that gate through the late-bound `sharing` service, so a derived
   * check ("may this caller edit the MASTER?") answers with the same predicate a
   * direct write of the master would face, instead of a hand-rolled copy that
   * drifts.
   *
   * Returns `true` when the sharing layer imposes nothing — no plugin-sharing in
   * the deployment, a bypass/public object, an object with no owner field.
   * `canEdit` answers all of those itself. FAILS CLOSED (`false`) when the probe
   * throws: a dropped record-share gate is the leak, not the denial.
   */
  private resolveSharingCanEdit(
    object: string,
    recordId: string,
    context: any,
    resolvedSets?: PermissionSet[],
  ): Promise<boolean> {
    // [#25223 cut 10] The body moved to `security-plugin-sharing-verdicts.ts` (see `SharingVerdictsHost`).
    const readLogger = () => this.logger;
    const readResolveKernelService = () => this.resolveKernelService;
    const host: Pick<SharingVerdictsHost, 'collectRLSPolicies' | 'logger' | 'resolveKernelService' | 'resolvePermissionSetsForContext' | 'resolveWriteScopeForSharing'> = {
      collectRLSPolicies: (...a) => this.collectRLSPolicies(...a),
      get logger() { return readLogger(); },
      get resolveKernelService() { return readResolveKernelService(); },
      resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
      resolveWriteScopeForSharing: (...a) => this.resolveWriteScopeForSharing(...a),
    };
    return resolveSharingCanEdit.call(host, object, recordId, context, resolvedSets);
  }

  /**
   * [ADR-0057 D1] The write-DEPTH stash both sharing write probes hand the
   * service, resolved for THIS object.
   *
   * The context may still carry another object's `__writeScope` from the
   * middleware (the DETAIL's, when the caller is deriving a verdict about the
   * MASTER), and it is the probed object's own grant that widens the probed
   * object's owner-match. Always returned (even as `undefined`) so the caller
   * can write the key unconditionally and a stale value can never leak in
   * through a spread.
   *
   * Depth is a WIDENING input, so an unresolved one leaves the owner-match at
   * its narrowest (`own`) — the safe direction — and the gate still runs.
   *
   * Extracted so {@link resolveSharingCanEdit} and
   * {@link resolveSharingWriteVerdict} cannot drift on it: they are two forms of
   * one question and must feed the service the same depth.
   */
  private resolveWriteScopeForSharing(
    object: string,
    context: any,
    resolvedSets?: PermissionSet[],
  ): Promise<string | undefined> {
    // [#25223 cut 10] The body moved to `security-plugin-sharing-verdicts.ts` (see `SharingVerdictsHost`).
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const host: Pick<SharingVerdictsHost, 'getObjectSecurityMeta' | 'permissionEvaluator' | 'resolvePermissionSetsForContext'> = {
      getObjectSecurityMeta: (...a) => this.getObjectSecurityMeta(...a),
      get permissionEvaluator() { return readPermissionEvaluator(); },
      resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
    };
    return resolveWriteScopeForSharing.call(host, object, context, resolvedSets);
  }

  /**
   * [#5492 / #6428] The TRI-STATE write verdict for a single row — the form the
   * by-id write pre-image gate composes with, and the reason it does not need a
   * second implementation of ownership.
   *
   * `ISharingService` is the one authority that reads all three declared
   * write-widening mechanisms (ownership at write DEPTH, an `edit`-level
   * `sys_record_share`, the `modifyAllRecords` bypass). Asking it here — rather
   * than recomputing owner / depth / share / bypass on this side — is what keeps
   * the ADR-0111 D3 verb boundary INHERITED: `update` asks `checkEdit`, `delete`
   * asks `checkDelete`, and the fact that an `edit` share widens update but not
   * delete lives in exactly one place.
   *
   * Why the tri-state and not `canEdit()`'s boolean: that projection collapses
   * `allow` and `abstain` into one `true`, which is correct for a caller that
   * only ADDS a gate and a **measured fail-open** for one that lets the answer
   * override another authority's floor — #5492's E2 experiment turned an
   * ordinary member's cross-creator UPDATE on an `owner_id`-less object from 403
   * into 200 that way.
   *
   * Fail-closed shape:
   *  - no plugin-sharing / no tri-state method → `abstain`. Nothing has been
   *    consulted, so nothing may replace the floor; behaviour is unchanged from
   *    a deployment without the sharing plugin.
   *  - an unrecognised answer (an older two-state implementation registered
   *    under this name) → `abstain`, for the same reason.
   *  - a probe that THROWS → `deny` (logged). The service itself already denies
   *    on an unresolvable lookup (#6428); this covers the call failing outright.
   *    Both leave the floor standing, which is the non-widening direction.
   */
  private resolveSharingWriteVerdict(
    rlsOperation: string,
    object: string,
    recordId: string,
    context: any,
    resolvedSets?: PermissionSet[],
  ): Promise<SharingWriteVerdict> {
    // [#25223 cut 10] The body moved to `security-plugin-sharing-verdicts.ts` (see `SharingVerdictsHost`).
    const readLogger = () => this.logger;
    const readResolveKernelService = () => this.resolveKernelService;
    const host: Pick<SharingVerdictsHost, 'collectRLSPolicies' | 'logger' | 'resolveKernelService' | 'resolvePermissionSetsForContext' | 'resolveWriteScopeForSharing'> = {
      collectRLSPolicies: (...a) => this.collectRLSPolicies(...a),
      get logger() { return readLogger(); },
      get resolveKernelService() { return readResolveKernelService(); },
      resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
      resolveWriteScopeForSharing: (...a) => this.resolveWriteScopeForSharing(...a),
    };
    return resolveSharingWriteVerdict.call(host, rlsOperation, object, recordId, context, resolvedSets);
  }

  /**
   * [#5492] The by-id write pre-image gate's floor decision (step 2.7): does
   * the platform ownership floor yield to the declared write authority for
   * THIS principal, row and write class? It is the value of
   * {@link RlsFilterOptions.dropPlatformOwnershipFloor} on that path.
   *
   * One method, two readers: the gate, and `security/explain`'s record-grained
   * Layer 1 for `update` / `delete` (#19963). Explain used to compose Layer 1
   * with the floor always standing, so it answered `record.visible: false`
   * (`decidedBy: 'rls'`) on every row the caller did not CREATE, while the gate
   * dropped the floor and the by-id PATCH admitted the same row.
   *
   *  - The write authority is asked ONLY when the floor is actually in play for
   *    this (principal, object, operation): no floor, nothing to replace, and
   *    no reason to spend a sharing probe.
   *  - `allow` alone drops it; `abstain` and `deny` leave it standing
   *    ({@link resolveSharingWriteVerdict} has the reasons).
   *  - [ADR-0090 D10] The on-behalf-of path is deliberately EXCLUDED. The
   *    bypass predicate the verdict folds through already fails closed for a
   *    delegated context (`hasWriteBypass`: "no D10 delegator intersection on
   *    this path", ADR-0111 D2), so composing here could only produce a verdict
   *    resolved against the wrong identity. The delegated write keeps both
   *    principals' floors, exactly as before — and beside the delegator's
   *    floor-standing filter it also ANDs the delegator's own composition,
   *    asked here AS the delegator ({@link delegatorOwnWriteFloorOptions}).
   */
  private resolvePreImageFloorDrop(
    rlsOperation: string,
    object: string,
    recordId: string,
    context: any,
    permissionSets: PermissionSet[],
    delegated: boolean,
  ): Promise<boolean> {
    // [#25223 cut 10] The body moved to `security-plugin-sharing-verdicts.ts` (see `SharingVerdictsHost`).
    const host: Pick<SharingVerdictsHost, 'collectRLSPolicies' | 'resolveSharingWriteVerdict'> = {
      collectRLSPolicies: (...a) => this.collectRLSPolicies(...a),
      resolveSharingWriteVerdict: (...a) => this.resolveSharingWriteVerdict(...a),
    };
    return resolvePreImageFloorDrop.call(host, rlsOperation, object, recordId, context, permissionSets, delegated);
  }

  /**
   * [ADR-0090 D10] The composition knobs the DELEGATOR's own direct by-id
   * write of `recordId` would get: its floor decision
   * ({@link resolvePreImageFloorDrop}, asked as the delegator — its own sets,
   * its own context, not delegated) and the coverage vouch the caller makes
   * for that write.
   *
   * An on-behalf-of principal never exceeds its delegator. Every delegated
   * row gate composes the delegator's filter with the floor standing (the
   * delegated path's exclusion), which is a different composition from the one
   * the delegator's own write of the same row gets, so on its own it does not
   * bound the delegated write by what the delegator may write. Each such gate
   * therefore also composes the delegator's filter with THESE options and ANDs
   * the two: the by-id pre-image (step 2.7), its post-image check (step 3.6)
   * and the master gate's delegator pass ({@link assertMasterRowEditable}).
   * The AND only ever narrows — a row passes only where today's composition
   * AND the delegator's own both admit it — so nothing refused before is
   * admitted by it.
   *
   * `masterGateCoversThisWrite` is the vouch the caller's own direct
   * composition makes, passed rather than assumed, because coverage is a fact
   * about the call site ({@link RlsFilterOptions.masterGateCoversThisWrite}).
   */
  private delegatorOwnWriteFloorOptions(
    rlsOperation: string,
    object: string,
    recordId: string,
    delegatorContext: any,
    delegatorSets: PermissionSet[],
    masterGateCoversThisWrite: boolean,
  ): Promise<RlsFilterOptions> {
    // [#25223 cut 10] The body moved to `security-plugin-sharing-verdicts.ts` (see `SharingVerdictsHost`).
    const host: Pick<SharingVerdictsHost, 'resolvePreImageFloorDrop'> = {
      resolvePreImageFloorDrop: (...a) => this.resolvePreImageFloorDrop(...a),
    };
    return delegatorOwnWriteFloorOptions.call(host, rlsOperation, object, recordId, delegatorContext, delegatorSets, masterGateCoversThisWrite);
  }

  /**
   * [#5493 / ADR-0105 D3] `ISecurityService.checkAuthoredRowWrite` — does an
   * APP-AUTHORED row-level policy admit this row for this write operation, on
   * its own, with the platform's ownership floor taken out?
   *
   * The question exists because the composed RLS answer cannot stand in for it.
   * `member_default` — the additive baseline every authenticated member
   * resolves — ships `owner_only_writes` / `owner_only_deletes`
   * (`created_by == current_user.id`, see `platform-ownership-policies.ts`), so
   * "the composed RLS admits this row" is true for the row's CREATOR whether or
   * not any app policy mentions it. #5493's probe E-A measured the gap: a
   * creator who is no longer the owner (a record transferred away) is admitted
   * by the floor and refused by sharing with a byte-identical envelope, so a
   * deferral keyed on the composed answer would hand transferred records back
   * to their former creators. Provenance is the only thing that separates the
   * two, and it is private to this package by design.
   *
   * **No second RLS evaluator.** The verdict is read off the SAME
   * {@link computeLayeredRlsFilter} the middleware enforces with, driven by the
   * SAME `dropPlatformOwnershipFloor` knob #6684 landed for the by-id write
   * pre-image gate — the floor is removed by provenance, everything else
   * compiles exactly as it would on the enforcement path. Two consequences
   * worth naming, because both are load-bearing:
   *
   *  - `layer1 == null` is read as `abstain`, never as "admitted". Layer 1 is
   *    null precisely when no authored predicate is actually gating this write:
   *    the applicable set was empty, or the ADR-0066 ① posture-gated superuser
   *    short-circuit skipped business RLS wholesale. A superuser bypass is not
   *    an authored admission, and reporting it as one would re-open E-A from
   *    the other side. (The field-existence net's deny sentinel is NOT null, so
   *    it flows through the probe and matches nothing — also `abstain`.)
   *  - Layer 0 (the tenant wall) stays AND-ed in. A row in another tenant is
   *    admitted by nothing, and dropping the wall here would make this the one
   *    surface in the plugin that answers across it.
   *
   * **Fail-closed in the `abstain` direction** — the caller uses `admit` to
   * WIDEN, so every failure must be the answer that changes nothing. No throw
   * ever escapes: a principal-less context, an on-behalf-of context (ADR-0090
   * D10 — the delegator intersection is not computed on this path, exactly as
   * {@link hasWriteBypass} and {@link resolveWriteScope} fail closed on it), an
   * unresolvable probe and a thrown lookup all return `abstain`.
   *
   * **[#7281] The probe read is ELEVATED, and that is the whole of the fix
   * this method received.** It used to run under the CALLER's own context,
   * which re-entered the middleware chain and picked up `plugin-sharing`'s
   * READ filter: on a `private`-OWD object that scopes every read to
   * owner-match OR shares, so a cross-owner row was invisible and the verdict
   * was `abstain` for a row the declaration names — measured on the real stack
   * across two objects identical but for their OWD (#7281: `public_read` →
   * `admit`, `private` → `abstain`, same widener, same principal, same row
   * shape). That made the by-id widener structurally dead on exactly the
   * posture #5493 built it for, and it did so by folding a READ decision into
   * a question about a declaration. The maintainer ruled it (2026-08-10,
   * reading 2): this method answers the declaration; the write decision stays
   * with the pre-image gate.
   *
   * Nothing about the ANSWER widens with the scope: `{id} AND layer0 AND
   * layer1` is still the entire predicate, both layers still compile from the
   * caller's own permission sets and tenant, and `admit` is still evidence
   * rather than authorization — the by-id write pre-image gate re-resolves the
   * write under the caller's own context and refuses on its own terms.
   * ⚠️ One consequence, measured and deliberately NOT papered over: because
   * that gate performs the same caller-scoped `findOne`, a `private`-OWD
   * cross-owner by-id write is still refused end-to-end after this fix, now by
   * the row-level gate rather than by the sharing middleware. The verdict is
   * correct; reviving the by-id widener on `private` end-to-end is a separate
   * contract question about the pre-image gate's own read scope.
   */
  checkAuthoredRowWrite(
    object: string,
    recordId: string,
    operation: AuthoredRowWriteOperation,
    context?: any,
  ): Promise<AuthoredRowWriteVerdict> {
    // [#25223 cut 10] The body moved to `security-plugin-authored-row-write.ts` (see `AuthoredRowWriteHost`).
    const readLogger = () => this.logger;
    const readQl = () => this.ql;
    const host: Pick<AuthoredRowWriteHost, 'collectRLSPolicies' | 'computeLayeredRlsFilter' | 'logger' | 'ql' | 'resolvePermissionSetsForContext'> = {
      collectRLSPolicies: (...a) => this.collectRLSPolicies(...a),
      computeLayeredRlsFilter: (...a) => this.computeLayeredRlsFilter(...a),
      get logger() { return readLogger(); },
      get ql() { return readQl(); },
      resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
    };
    return checkAuthoredRowWrite.call(host, object, recordId, operation, context);
  }

  /**
   * The read scope for `object` under `context` — the filter the analytics /
   * raw-SQL path ANDs into its query, being the one surface that bypasses the
   * engine and so has no other source of scope.
   *
   * Its contract is agreement: this must be **the same filter the engine
   * middleware ANDs into every find**. That chain injects THREE things, and
   * this method composes the same three:
   *
   *   1. {@link computeRlsFilter} — tenant Layer 0 + RLS policies;
   *   2. {@link computeControlledByParentFilter} — ADR-0055, `masterFK IN
   *      (<the master ids this caller may read>)`, spelled as the engine's
   *      `ReadableIds` leaf over the master (ADR-0139 D6): the engine composes
   *      it from this service's own answers about the master before any
   *      driver sees it, and the analytics faces hand it to the engine or
   *      decline it (`NativeSQLStrategy.canHandle`), never compile it;
   *   3. {@link resolveSharingReadFilter} — plugin-sharing's OWD / record-share
   *      visibility filter, contributed by the sibling middleware.
   *
   * [ADR-0090 D10] On a DELEGATED (on-behalf-of) context the chain composes
   * each of the three twice — once for the delegated principal's leg, once for
   * the delegator's — and so does this method ({@link computeDelegatedReadFilter}):
   * the delegated read is scoped to the intersection, exactly as a delegated
   * `find` is. ADR-0139 D5.1 named that intersection reaching this method as
   * the condition under which the engine composes its `ReadableIds` leaf for a
   * delegated caller; it does, so the engine does.
   *
   * Each layer has been missing here at some point, and each absence had the
   * same shape: a caller who cannot read a row through `/data` could still
   * `COUNT(*)` / `GROUP BY` it through `/analytics`. Layer 3 was #4467; layer 2
   * was #5815 — for a `controlled_by_parent` object, halves 1 and 3 BOTH
   * commonly return `null` by design (such an object carries no authored RLS,
   * and maps to `public` in plugin-sharing's `effectiveSharingModel`), so the
   * composed scope was `undefined` — no predicate at all over what are usually
   * line-item rows.
   *
   * Fails CLOSED on any resolution failure: a dropped predicate here is the
   * leak, so an unresolvable layer denies (zero rows) rather than widening.
   *
   * [#21079] And it answers the deny sentinel, not a composed scope, for a
   * non-system caller who carries a principal and resolves NO permission set —
   * the ADR-0056 D2 deny baseline, which the middleware enforces by refusing
   * that caller at object admission. [#21908] So does a principal-less one
   * ({@link isPrincipalLessContext}, ADR-0096 D5 strict mode), which the
   * middleware refuses before it resolves anything: it no longer keeps the
   * sharing predicate alone.
   *
   * [ADR-0139 D2 step 2] Every deny this method answers is `RLS_DENY_FILTER`
   * ITSELF — `@objectstack/spec/data`'s frozen object, by reference — whether
   * it is returned here or comes up unchanged from a layer (the tenant wall's
   * deny, the RLS compiler's, the dropped-policy and unresolvable-master
   * denies below): the engine's composition recognises it by identity and
   * answers `$in: []`. ⛔ Never return a spread copy; a copy still matches zero
   * rows, but it is no longer the sentinel.
   */
  getReadFilter(
    object: string,
    context?: any,
  ): Promise<Record<string, unknown> | undefined> {
    // [#25223 cut 9] The body moved to `security-plugin-read-filter.ts` (see `ReadFilterHost`).
    const readLogger = () => this.logger;
    const host: Pick<ReadFilterHost, 'computeControlledByParentFilter' | 'computeDelegatedReadFilter' | 'computeRlsFilter' | 'logger' | 'resolvePermissionSetsForContext' | 'resolveSharingReadFilter'> = {
      computeControlledByParentFilter: (...a) => this.computeControlledByParentFilter(...a),
      computeDelegatedReadFilter: (...a) => this.computeDelegatedReadFilter(...a),
      computeRlsFilter: (...a) => this.computeRlsFilter(...a),
      get logger() { return readLogger(); },
      resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
      resolveSharingReadFilter: (...a) => this.resolveSharingReadFilter(...a),
    };
    return getReadFilter.call(host, object, context);
  }

  /**
   * [ADR-0090 D10 / ADR-0139 D5.1 as amended] The read scope of a DELEGATED
   * (on-behalf-of) principal: the INTERSECTION of the principal's own leg and
   * the delegator's — never the union — composed here exactly as the engine
   * middleware chain composes a delegated `find` of `object`, layer for layer:
   *
   *   1. {@link computeRlsFilter} over the principal's sets, with the delegated
   *      context AS IT STANDS — {@link collectRLSPolicies} reads that context as
   *      the delegated principal's own leg (`isDelegatedPrincipalLeg`), so the
   *      ceiling's silence contributes no object default row scope;
   *   2. {@link computeControlledByParentFilter} for the principal;
   *   3. {@link computeRlsFilter} over the DELEGATOR's sets, with the context
   *      {@link resolveDelegatorContext} rebuilds for them (the middleware's
   *      D10 half, step 3);
   *   4. {@link computeControlledByParentFilter} for the delegator;
   *   5. plugin-sharing's visibility filter for the principal's identity, at
   *      the agent-leg depth step 2.6 stamps as `__readScope`
   *      (`intersectDelegatedScope` of the ceiling's DECLARED depth and the
   *      delegator's effective one);
   *   6. the same filter re-run under the DELEGATOR's identity at the
   *      delegator's own depth — plugin-sharing's second call, with `userId`
   *      swapped to the delegator and no delegation link.
   *
   * Fails CLOSED where the chain refuses, with the deny sentinel by identity:
   * a principal that resolves no set (ADR-0056 D2); a delegator the link names
   * who does not exist (the chain's `PERMISSION_DENIED`; `canReadObject`'s
   * `false`); [#25106] on a walled posture, a live active organization the
   * delegator's own membership does not back (the prologue's
   * `PERMISSION_DENIED`, asked of `vetOrganizationClaim` with the prologue's
   * inputs); a delegator who resolves no set (object admission refuses them);
   * a sharing scope that cannot be resolved. A throw anywhere propagates to the
   * caller's catch, which denies.
   *
   * ⛔ Not a second intersection rule: every leg is the primitive the
   * middleware calls, in the middleware's spelling, and the delegator's context
   * comes from the one resolver the middleware and `canReadObject` share.
   */
  private computeDelegatedReadFilter(
    object: string,
    context: any,
  ): Promise<Record<string, unknown> | undefined> {
    // [#25223 cut 9] The body moved to `security-plugin-read-filter.ts` (see `ReadFilterHost`).
    const readLogger = () => this.logger;
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const readQl = () => this.ql;
    const readTenancyPosture = () => this.tenancyPosture;
    const host: Pick<ReadFilterHost, 'computeControlledByParentFilter' | 'computeRlsFilter' | 'getObjectSecurityMeta' | 'logger' | 'permissionEvaluator' | 'ql' | 'resolvePermissionSetsForContext' | 'resolveSharingReadFilter' | 'tenancyPosture'> = {
      computeControlledByParentFilter: (...a) => this.computeControlledByParentFilter(...a),
      computeRlsFilter: (...a) => this.computeRlsFilter(...a),
      getObjectSecurityMeta: (...a) => this.getObjectSecurityMeta(...a),
      get logger() { return readLogger(); },
      get permissionEvaluator() { return readPermissionEvaluator(); },
      get ql() { return readQl(); },
      resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
      resolveSharingReadFilter: (...a) => this.resolveSharingReadFilter(...a),
      get tenancyPosture() { return readTenancyPosture(); },
    };
    return computeDelegatedReadFilter.call(host, object, context);
  }

  /**
   * [#3547] Query surface: the field names the caller MAY READ on `object`
   * under `context`. This is the authoritative column projection for a
   * read-derived export (`export ⊆ list`, #3391) — the REST export route
   * consumes it to project columns directly, instead of inferring readability
   * from already-masked data rows (which loses an all-readable-but-all-null
   * column and falls back to the full schema on an empty result set, #3498).
   *
   * Same-source-as-read-middleware, so it can never drift from data-plane FLS:
   * it resolves the caller's permission sets via
   * {@link resolvePermissionSetsForContext}, builds the field-permission map
   * with the SAME evaluator + `requiredPermissions` fold the read mask uses,
   * intersects the on-behalf-of delegator's mask (ADR-0090 D10, fail-closed on
   * a dangling delegator), then returns every schema field NOT marked
   * non-readable — the exact complement of what {@link FieldMasker.maskResults}
   * deletes (fields without an explicit permission entry pass through).
   *
   * Returns `undefined` when the object schema can't be resolved, so the caller
   * falls back to its own projection. A system context (`context.isSystem`)
   * bypasses FLS and returns the full field set, mirroring the middleware's
   * `isSystem` skip.
   */
  async getReadableFields(object: string, context?: any): Promise<string[] | undefined> {
    return this.computeReadableFields(object, context, { fallbackOnEmptySets: false });
  }

  /**
   * [ADR-0106 D7] The METADATA-PLANE variant of {@link getReadableFields}.
   *
   * Identical in every respect but one: a caller that resolves to **zero**
   * permission sets goes through the same fallback-set resolution
   * `/auth/me/permissions` uses ({@link fallbackPermissionSet}, default
   * `member_default`) instead of falling open to the full field set.
   *
   * Why the two differ rather than converge. `getReadableFields` keeps the
   * answer it gave when the engine middleware skipped its grant-based gates for
   * a caller with no permission sets — reporting a narrowing the data path did
   * not enforce was its own kind of drift, so on the DATA plane falling open was
   * the drift-free answer. The middleware no longer serves that caller: object
   * admission refuses it (ADR-0056 D2's deny baseline) and a principal-less one
   * is refused outright (ADR-0096 D5), so no data-plane read reaches the fields
   * named here. What reaches that caller is the object's posture
   * ({@link resolveCallerPosture}): [#20995] its masking rules, and a masked
   * field is a served column, so it stays; [#21063] its per-field capability
   * contract, and a capability-gated field is not served, so it leaves. The
   * answer is the full set minus those fields. The metadata plane has no such
   * symmetry to preserve: the
   * question there is disclosure, and ADR-0106 D7 rules that a public/guest
   * deployment's schema exposure must be a deliberate permission-set decision
   * rather than an accidental everything-default. Anonymous callers on a
   * `requireAuth` deployment are blocked before any of this.
   *
   * Still falls open when the fallback set itself resolves to nothing (no
   * `member_default` in the deployment at all) — that is the "no FLS posture
   * here" tier, not a restricted caller — to the data plane's answer for a
   * caller with no set: [#21063] the full set minus every capability-gated
   * field, which no grant reaches.
   */
  async getMetadataReadableFields(object: string, context?: any): Promise<string[] | undefined> {
    return this.computeReadableFields(object, context, { fallbackOnEmptySets: true });
  }

  private computeReadableFields(
    object: string,
    context: any,
    options: { fallbackOnEmptySets: boolean },
  ): Promise<string[] | undefined> {
    // [#25223 cut 9] The body moved to `security-plugin-field-readers.ts` (see `FieldReadersHost`).
    const host: Pick<FieldReadersHost, 'resolveProjectionFieldMask'> = {
      resolveProjectionFieldMask: (...a) => this.resolveProjectionFieldMask(...a),
    };
    return computeReadableFields.call(host, object, context, options);
  }

  /**
   * [#18386] Query surface: the field names field-level security lets the
   * caller WRITE on `object` under `context` (a field's own rules, such as
   * `readonly`, are not asked) — the write-side twin of {@link getReadableFields}.
   *
   * Same derivation as the read projection ({@link resolveProjectionFieldMask}),
   * which is the one the middleware's step 2.5 write gate takes, and the answer
   * is the complement of that gate's own primitive,
   * `FieldMasker.getNonEditableFields` — so a field is here iff a payload
   * naming it passes step 2.5. [#21063] A caller who resolves no permission
   * set gets the full set minus every capability-gated field: step 2.5 judges
   * it over the posture's per-field capability contract
   * ({@link resolveCallerPosture}), and its evaluator map is empty. [#21079]
   * Like every answer here, that one is field-level only: such a caller who
   * carries a principal is refused the write itself at object admission (the
   * ADR-0056 D2 deny baseline), ahead of step 2.5.
   */
  async getWritableFields(object: string, context?: any): Promise<string[] | undefined> {
    const mask = await this.resolveProjectionFieldMask(object, context, { fallbackOnEmptySets: false });
    if (mask.kind === 'answer') return mask.fields;
    const nonEditable = new Set(this.fieldMasker.getNonEditableFields(mask.fieldPerms));
    return mask.allFields.filter((f) => !nonEditable.has(f));
  }

  /**
   * [#20935] Query surface: the field names the caller may QUERY ON in
   * `object` — filter, sort, group or aggregate by — the query-side twin of
   * {@link getReadableFields}, for the doors that compile their own statement
   * and so never reach this middleware's field guards.
   *
   * It is not a second reading of masking: the answer is every schema field
   * the ONE query-guard derivation ({@link computeQueryGuardFieldPerms}) does
   * not mark non-queryable — the same map the predicate guard (step 2.9) and
   * the aggregate-input guard (step 2.5b) refuse from, so a field is here iff
   * a query naming it passes both. It differs from {@link getReadableFields}
   * by exactly the fields this caller is served MASKED: a masked field is a
   * served column (readable) that no predicate, group key or aggregate may name.
   *
   * The settled answers are the projection's ({@link resolveProjectionFieldMask}):
   * `undefined` when the schema cannot be resolved; the full set for a system
   * context (the middleware hands it straight through); `[]` on an
   * unresolvable posture or a dangling delegator (fail closed). [#20995] A
   * caller who resolves NO permission set — [#21908] a principal-less one
   * included — is not settled early: it holds no capability, so every masking
   * rule reaches it and its
   * masked fields are not queryable, as both guards refuse them
   * ({@link resolveCallerPosture}); [#21063] nor are its capability-gated
   * fields, which it is not served at all.
   */
  async getQueryableFields(object: string, context?: any): Promise<string[] | undefined> {
    const mask = await this.resolveProjectionFieldMask(object, context, { fallbackOnEmptySets: false });
    if (mask.kind === 'answer') return mask.fields;
    const queryGuard = mask.readQueryGuardPerms();
    return mask.allFields.filter((f) => queryGuard[f]?.readable !== false);
  }

  /**
   * The derivation both field projections share: the schema's field universe,
   * the caller's permission sets, the posture its gates read
   * ({@link resolveCallerPosture}), the evaluator's field map with the ADR-0066
   * D3 `requiredPermissions` fold, and the ADR-0090 D10 delegator intersection
   * — the steps, in order, that the middleware's read mask and its step 2.5
   * write gate each take. A case that settles the answer before any mask
   * exists comes back as `answer`.
   */
  private resolveProjectionFieldMask(
    object: string,
    context: any,
    options: { fallbackOnEmptySets: boolean },
  ): Promise<
    | { kind: 'answer'; fields: string[] | undefined }
    | {
      kind: 'mask';
      allFields: string[];
      fieldPerms: Record<string, { readable: boolean; editable: boolean }>;
      readPartialMaskRules: () => Record<string, FieldMaskingRule>;
      /** [#20935] The middleware's query-guard map for these sets (computeQueryGuardFieldPerms). */
      readQueryGuardPerms: () => Record<string, { readable: boolean; editable: boolean }>;
    }
  > {
    // [#25223 cut 9] The body moved to `security-plugin-field-readers.ts` (see `FieldReadersHost`).
    const readMetadata = () => this.metadata;
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const readQl = () => this.ql;
    const readTenancyPosture = () => this.tenancyPosture;
    const host: Pick<FieldReadersHost, 'computeQueryGuardFieldPerms' | 'computeReadPartialMaskRules' | 'foldFieldRequiredPermissions' | 'getObjectFieldNames' | 'metadata' | 'permissionEvaluator' | 'ql' | 'resolveCallerPosture' | 'resolveFallbackPermissionSets' | 'resolvePermissionSetsForContext' | 'tenancyPosture'> = {
      computeQueryGuardFieldPerms: (...a) => this.computeQueryGuardFieldPerms(...a),
      computeReadPartialMaskRules: (...a) => this.computeReadPartialMaskRules(...a),
      foldFieldRequiredPermissions: (...a) => this.foldFieldRequiredPermissions(...a),
      getObjectFieldNames: (...a) => this.getObjectFieldNames(...a),
      get metadata() { return readMetadata(); },
      get permissionEvaluator() { return readPermissionEvaluator(); },
      get ql() { return readQl(); },
      resolveCallerPosture: (...a) => this.resolveCallerPosture(...a),
      resolveFallbackPermissionSets: (...a) => this.resolveFallbackPermissionSets(...a),
      resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
      get tenancyPosture() { return readTenancyPosture(); },
    };
    return resolveProjectionFieldMask.call(host, object, context, options);
  }

  /**
   * [#20995] The object posture a caller's gates read — ONE place, read by the
   * engine middleware and by {@link resolveProjectionFieldMask} alike, so the
   * result masker, the two query guards, the masked-echo refusal and the
   * published field projections cannot answer one caller two ways.
   *
   * A caller who resolved at least one permission set reads the posture as it
   * is ({@link getObjectSecurityMeta}). A caller who resolved NONE — whether
   * it carries a principal or, [#21908] read only by the field projections
   * since the middleware refuses it first, none at all
   * ({@link isPrincipalLessContext}) — reads a stand-in: every grant-based narrowing at
   * rest (no object capability contract, `isPrivate` and the tenancy flags
   * `false`), EXCEPT three things carried from the posture:
   *
   *  - **The masking rules.** `maskingRule` applies to "every non-system caller
   *    unless the field's `requiredPermissions` are ALL held", and this caller
   *    holds nothing, so {@link computePartialMaskRules} applies every rule to
   *    it: the field is served masked and is not queryable. The stand-in used
   *    to carry no rule at all, so every reader answered "stored and
   *    queryable" for this caller.
   *  - **[#21063] The per-field capability contract.** A field's
   *    `requiredPermissions` declares "mask on read, deny on write" (ADR-0066
   *    D3) unless the caller holds ALL of them, and this caller holds none, so
   *    {@link foldFieldRequiredPermissions} — the fold every reader already
   *    takes — marks each such field neither readable nor editable for it: not
   *    served (masked instead where a masking rule softens it), not queryable,
   *    and refused in a write payload (step 2.5). The explain engine reads the
   *    posture itself and has always reported the field hidden for this caller;
   *    the stand-in used to carry no field contract, so every enforcing reader
   *    served the stored value.
   *  - **Whether the posture resolved.** The rules and the field contract come
   *    from it, so an unreadable posture leaves them unknown and fails closed
   *    for this caller exactly as for any other (#3545).
   *
   * ⛔ Deliberately NOT carried: the object's capability contract
   * (`requiredPermissions` on the object). It is an OBJECT-level admission
   * gate, and this caller's object admission is not decided here: [#21079]
   * the middleware's CRUD gate refuses it over its empty set list (the
   * ADR-0056 D2 deny baseline), ahead of every field gate. Its field answers
   * are decided here, and are still read: by the public-form grant's result
   * masker, which admits ahead of that gate, and by the published projections,
   * whose answer for this caller is the full field set minus every field it is
   * not served, as the service contract states.
   */
  private resolveCallerPosture(
    object: string,
    permissionSets: PermissionSet[],
  ): Promise<ObjectSecurityMeta> {
    // [#25223 cut 9] The body moved to `security-plugin-field-readers.ts` (see `FieldReadersHost`).
    const host: Pick<FieldReadersHost, 'getObjectSecurityMeta'> = {
      getObjectSecurityMeta: (...a) => this.getObjectSecurityMeta(...a),
    };
    return resolveCallerPosture.call(host, object, permissionSets);
  }

  /**
   * Whether `context` may READ `object` at all — the OBJECT-level admission,
   * exposed for the read doors that bypass the engine middleware.
   *
   * The middleware answers this before it composes any row filter; a door that
   * compiles its own statement (the analytics native-SQL strategy is the one in
   * the tree) never reaches the middleware and so never asked. `getReadFilter`
   * is not a substitute: it answers "which ROWS", and its `undefined` means "no
   * row restriction" — the same answer a caller with NO grant on the object
   * gets. So a door holding only the filter reads an ungranted principal as an
   * unrestricted one, and answers `200 {"rows":[{"cnt":24}]}` where
   * `GET /data/<object>` answers `403 PERMISSION_DENIED` for the same principal
   * on the same deployment.
   *
   * ## The arms, in the middleware's own order
   *
   * Every one of them is the SAME primitive the middleware calls, not a second
   * reading of the same declaration — which is what makes "the two doors reach
   * one verdict" a property of the code rather than a promise:
   *
   *   1. `isSystem` → admit (the middleware's total bypass);
   *   2. [#21908] a principal-less context ({@link isPrincipalLessContext}) →
   *      DENY: ADR-0096 D5 strict mode, the middleware's refusal before any
   *      gate; then [#21079] no permission sets resolved → the ADR-0056 D2
   *      deny baseline: DENY, as the middleware's CRUD gate answers an empty
   *      list;
   *   3. `secMeta.unresolved` → DENY (#3545 — `isPrivate` would default to
   *      `false`, which is exactly what lets a plain `'*'` wildcard reach an
   *      object ADR-0066 D2 says it must not);
   *   4. ADR-0066 D3/⑤ `requiredPermissions` capability AND-gate for the read
   *      CRUD class, checked BEFORE the grant, for the caller AND (D10) the
   *      delegator;
   *   5. the `allowRead` CRUD grant ({@link PermissionEvaluator.checkObjectPermission}
   *      on `find`);
   *   6. ADR-0090 D10 — the delegator must independently hold the same grant;
   *      a dangling delegator denies.
   *
   * `find` is the operation asked for, not `aggregate`, and the two are the same
   * question: `OPERATION_PERMISSION_MAP` maps `find`, `findOne`, `count` and
   * `aggregate` all onto `allowRead`. Asking `find` keeps the answer readable as
   * "may this caller read this object", which is what every consuming door needs.
   *
   * Fails CLOSED (an access-narrowing answer): a throw anywhere inside denies,
   * and callers must treat a throw as a denial too.
   *
   * ⛔ Object-level ONLY. `true` never means "unrestricted" — the row scope is
   * still {@link getReadFilter}'s and it is still mandatory. Nothing here may be
   * used to widen.
   */
  canReadObject(object: string, context?: any): Promise<boolean> {
    // [#25223 cut 9] The body moved to `security-plugin-object-admission.ts` (see `ObjectAdmissionHost`).
    const readLogger = () => this.logger;
    const readQl = () => this.ql;
    const readTenancyPosture = () => this.tenancyPosture;
    const host: Pick<ObjectAdmissionHost, 'logger' | 'objectReadAdmission' | 'ql' | 'resolvePermissionSetsForContext' | 'tenancyPosture'> = {
      get logger() { return readLogger(); },
      objectReadAdmission: (...a) => this.objectReadAdmission(...a),
      get ql() { return readQl(); },
      resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
      get tenancyPosture() { return readTenancyPosture(); },
    };
    return canReadObject.call(host, object, context);
  }

  /**
   * Arms 3–6 of {@link canReadObject} — the OBJECT-level read admission over
   * permission sets the caller has ALREADY resolved: the posture arm, the
   * ADR-0066 D3/⑤ capability AND-gate, the `allowRead` CRUD grant, and the
   * ADR-0090 D10 delegator's same two questions when `delegatorSets` is given.
   * Each is the primitive the middleware's own read gate calls (steps 1, 1.5
   * and 2), in that order.
   *
   * Two askers, one rule:
   *
   *   - {@link canReadObject}, which resolves the context first (system bypass,
   *     principal-less refusal, sets, delegator) and then asks this;
   *   - [ADR-0055 §3] {@link computeControlledByParentFilter}, which asks it of
   *     the MASTER for the principal whose sets it was handed — the caller's on
   *     the caller half, the delegator's on the D10 half — before it scopes the
   *     master's rows. "Reading a detail requires read access to its master",
   *     and the object-level admission is the first half of that access.
   *
   * ⛔ There is no second copy of this rule: a reader that needs the object-level
   * read answer for sets it already holds asks this, and one that holds only a
   * context asks {@link canReadObject}.
   *
   *   - [#21079] An empty list grants nothing (ADR-0056 D2).
   *   - 3. [#3545] An unresolvable posture denies.
   *   - 4. The capabilities the object requires for a read, held by the caller
   *     and (D10) by a delegator who resolved any set.
   *   - 5. The caller's `find` grant, with the posture's `isPrivate` (ADR-0066 D2).
   *   - 6. [ADR-0090 D10] The delegator's `find` grant, asked over its list
   *     whatever its length, as the middleware asks it: a delegator who resolves
   *     NO set grants nothing, the deny baseline for the second principal too.
   *
   * ⛔ Object-level ONLY, like {@link canReadObject}: `true` never means
   * "unrestricted". A throw propagates; each asker fails closed on it.
   */
  private objectReadAdmission(
    objectName: string,
    permissionSets: PermissionSet[],
    delegatorSets: PermissionSet[] | null,
  ): Promise<boolean> {
    // [#25223 cut 9] The body moved to `security-plugin-object-admission.ts` (see `ObjectAdmissionHost`).
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const host: Pick<ObjectAdmissionHost, 'getObjectSecurityMeta' | 'permissionEvaluator'> = {
      getObjectSecurityMeta: (...a) => this.getObjectSecurityMeta(...a),
      get permissionEvaluator() { return readPermissionEvaluator(); },
    };
    return objectReadAdmission.call(host, objectName, permissionSets, delegatorSets);
  }

  /**
   * [#18682] Whether `context` may CREATE or UPDATE `object` under the arms
   * enumerated below — the WRITE admission the preview asks for, and the
   * exact sibling of {@link canReadObject}.
   *
   * ## Why it exists
   *
   * `ObjectQL.validate()` is a write PREVIEW that runs no middleware for its
   * target object, by design. A validation rule that reads
   * one hop through a reference field is evaluated there against a related row
   * fetched under SYSTEM authority, and the accepted cost of that elevation is
   * an inference channel — so the preview asks this before it reads. What this
   * method restores is the arms enumerated below and nothing beyond them — the
   * closing paragraph names the refusals that stay ahead of it.
   *
   * ## The arms, in the middleware's own order — ⛔ the CRUD grant is not the gate
   *
   * A probe that checked only `isSystem`, a principal and the CRUD grant admits
   * classes the write path refuses: a caller holding `allowCreate` but not a D3
   * `requiredPermissions` capability; an `onBehalfOf` context naming a delegator
   * that does not exist; and — earlier than either, before anything resolves —
   * a caller asking about an object whose writes a platform service owns, or
   * about an RBAC link table on the strength of a plain CRUD grant. All were
   * measured reaching the preview while `insert()` refused them. So the arms
   * are the middleware's, in its order:
   *
   *   1. `isSystem` → admit (the total bypass);
   *   2. ADR-0103 `assertEngineOwnedWriteAllowed` over the registered schema —
   *      the middleware's own primitive, ⛔ never a second reading of
   *      `resolveCrudAffordances`: a user-context write to an `engine-owned` /
   *      `append-only` object whose `userActions` do not open the verb DENIES,
   *      ahead of the principal-less refusal below and of every resolution;
   *   3. ADR-0090 D12 `delegatedAdminGate.assert` — the same gate object the
   *      middleware calls, handed `object`, `operation`, `context` and the rows
   *      of `data`. A plain-CRUD holder on an RBAC link table DENIES; a tenant
   *      admin passes to the arms below;
   *   4. [#21908] a principal-less context ({@link isPrincipalLessContext}) →
   *      DENY: ADR-0096 D5 strict mode, the middleware's refusal at this point
   *      in its order; then [#21079] no permission sets resolved → the
   *      ADR-0056 D2 deny baseline: DENY, as the middleware's CRUD gate
   *      answers an empty list;
   *   5. `secMeta.unresolved` → DENY (#3545);
   *   6. ADR-0066 D3/⑤ `requiredPermissions` capability AND-gate for the WRITE
   *      CRUD class, checked BEFORE the grant, for the caller AND (D10) the
   *      delegator;
   *   7. the `allowCreate` / `allowEdit` CRUD grant for the operation asked;
   *   8. ADR-0090 D10 — the delegator must independently hold the same grant;
   *      a dangling delegator denies.
   *
   * Arms 2 and 3 refuse a CALLER CLASS: the same caller cannot reach the write
   * by omitting a value or by naming a different row, so a preview that
   * answered them would hand the elevated read to someone who cannot write the
   * object at all, for that verb, under any payload. Arms 6 and 8 were added on
   * that same ground one gate later.
   *
   * ## …and the arm that needs the PAYLOAD
   *
   * The arms above are not the whole write decision either. The middleware
   * also refuses payload-dependent writes, and the first of them is the
   * field-level-security write gate (step 2.5): a caller holding the object's
   * CRUD grant but not `editable` on a field the payload names is refused
   * `PERMISSION_DENIED` there. A probe carrying no payload cannot ask it — so
   * an editor of the child object who is FLS-locked out of the lookup column
   * was refused by `insert()` and answered by the preview, the same divergence
   * arms 6 and 8 close one gate earlier.
   *
   *   9. step 2.5's own primitives over `data`, in the middleware's order —
   *      `getFieldPermissions` folded through `foldFieldRequiredPermissions`
   *      (ADR-0066 D3), intersected under D10 with the delegator's mask via
   *      `intersectFieldMasks`, then `detectForbiddenWrites`. Skipped when no
   *      payload is supplied, exactly as the middleware skips it on `!opCtx.data`.
   *
   * `data` is the caller's RAW payload — one row or an array, the shape
   * `detectForbiddenWrites` already normalises and the shape `opCtx.data`
   * carries. ⛔ Not a post-default image: a key the runtime filled is not a
   * field the caller wrote.
   *
   * ## …and the organization wall
   *
   *  10. ADR-0123 D2 `organizationWallRefusal` — the method the middleware's
   *      step 3.7 throws on, asked under that step's guard (a payload is
   *      supplied, the context names a user) at that step's point, after arm
   *      9. It is handed no row — the payload decides only whether it is
   *      asked — so it refuses a CALLER CLASS, as arms 2 and 3 do. [#25062]
   *      The wall's judgement of a ROW (the forge guard, an emptied
   *      organization, an insert with nowhere to land) is not asked here: the
   *      preview asks it per row through {@link writeWallVerdict}.
   *
   * `can-write-object-admission.test.ts` pins this method's answer equal to the
   * registered middleware's on its equivalence block's cases, and pins one
   * arm-3 UPDATE case as a direction: this method `false`, the middleware `true`.
   *
   * Fails CLOSED: a throw anywhere denies, and callers must treat a throw as a
   * denial too.
   *
   * ⭐ What it answers, POSITIVELY — stated by NAMING WHAT IT RUNS, ⛔ never by
   * naming a category of the write decision: a `true` here means this caller
   * passed the ADR-0103 engine-owned affordance gate and the ADR-0090 D12
   * delegated-admin gate (arms 2 and 3, the middleware's own primitives, at the
   * middleware's own point in its order), the fail-closed postures (#3545's
   * unresolvable posture and the D10 dangling delegator), the ADR-0066 D3
   * capability AND-gate for both principals, the `allowCreate`/`allowEdit` CRUD
   * grant, the D10 delegator's independent grant, the step 2.5 FLS write gate
   * over the keys THIS payload names, and the ADR-0123 D2 organization wall. It
   * means nothing about any refusal not in that list.
   *
   * ⛔ `true` never means "this write will succeed", and ⛔ what follows is not
   * an enumeration of the distance to success: the middleware refuses both
   * before and after `next()` for reasons this method is never asked. The
   * families nearest to hand, named so the arms above are not read as the whole
   * write decision:
   *
   *  - **The remaining PRE-RESOLUTION gates, which run beside arms 2 and 3 and
   *    are not asked here.** Two judge a row's PROVENANCE, which a preview
   *    holds no row to carry: the ADR-0086/0094 package-managed write gate and
   *    the ADR-0066 system-row write gate. One judges a payload VALUE: the
   *    ADR-0066 D1 curated-capability-name refusal. (The ADR-0090 D5/D9
   *    audience-anchor binding guard is gone: it judged `sys_position_permission_set`
   *    writes, an object C3 stage 8 retired.) And the ADR-0056 `publicFormGrant` scope,
   *    which admits create plus read-back on exactly the granted object and
   *    refuses everything else pre-resolution — not asked because no wire
   *    caller and no constructor in the tree presents the grant here (it is
   *    constructed only by the public form-submit route, whose context goes to
   *    the real write, and the key is not in the inbound
   *    `ENTRY_EXECUTION_CONTEXT_FIELDS` set) and because it has no
   *    extracted primitive, so an arm would be a SECOND SPELLING of its scope —
   *    the drift this method exists to avoid.
   *  - **Row-level and post-image refusals — the preview names no stored row.**
   *    The step 2.7 `using` pre-image, the ADR-0055 controlled-by-parent master
   *    edit (2.8), the RLS `check` post-image (3.6) and the Layer 0 tenant
   *    post-image (3.7) — its union-scope no-active-organization insert arm
   *    included, which judges the row a hook may still place — none of which
   *    this method can judge because it is asked about no ROW.
   *  - **Payload-VALUE refusals the same caller passes by not sending the
   *    value** — the masked echo (2.5a) and the `owner_id` forge (3.5), which
   *    therefore widen the caller class by nothing.
   *  - **The caller's own PREDICATE** — the anti-filter-oracle guard (2.9),
   *    which this method is handed none of.
   *  - **After `next()`** — the fail-closed assertion that the engine honoured
   *    `OperationContext.postHookWriteImageCheck`, i.e. that the insert `check`
   *    seam really ran, which judges an executed write.
   *  - **Outside the middleware entirely** — `readonlyWhen`, the static
   *    `readonly` strip and the validation rules themselves.
   *
   * Nothing here may be used to widen.
   */
  canWriteObject(
    object: string,
    operation: 'insert' | 'update',
    context?: any,
    data?: unknown,
  ): Promise<boolean> {
    // [#25223 cut 9] The body moved to `security-plugin-object-admission.ts` (see `ObjectAdmissionHost`).
    const readDelegatedAdminGate = () => this.delegatedAdminGate;
    const readLogger = () => this.logger;
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const readQl = () => this.ql;
    const readTenancyPosture = () => this.tenancyPosture;
    const host: Pick<ObjectAdmissionHost, 'computeForbiddenFieldWrites' | 'delegatedAdminGate' | 'getObjectSecurityMeta' | 'logger' | 'organizationWallRefusal' | 'permissionEvaluator' | 'ql' | 'resolvePermissionSetsForContext' | 'tenancyPosture'> = {
      computeForbiddenFieldWrites: (...a) => this.computeForbiddenFieldWrites(...a),
      get delegatedAdminGate() { return readDelegatedAdminGate(); },
      getObjectSecurityMeta: (...a) => this.getObjectSecurityMeta(...a),
      get logger() { return readLogger(); },
      organizationWallRefusal: (...a) => this.organizationWallRefusal(...a),
      get permissionEvaluator() { return readPermissionEvaluator(); },
      get ql() { return readQl(); },
      resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
      get tenancyPosture() { return readTenancyPosture(); },
    };
    return canWriteObject.call(host, object, operation, context, data);
  }

  /**
   * [#3544] Whether `context` may EXPORT `object` — the user-level export axis.
   *
   * Export is READ-DERIVED (`export ⊆ list`), so a bulk export reaches the
   * engine middleware as an ordinary `find` and is gated by `allowRead` alone.
   * The `allowExport` bit is therefore invisible to the middleware, and a door
   * that streams a whole table out (the REST `GET /data/:object/export` route)
   * has to ask this question itself, BEFORE it reads. Same resolution as the
   * middleware — {@link resolvePermissionSetsForContext} → the evaluator's
   * `export` branch — so the axis cannot drift from data-plane enforcement.
   *
   * Fails CLOSED (an access-narrowing answer): a dangling on-behalf-of delegator
   * denies, and callers must treat a throw as a denial. `isSystem` bypasses.
   * [#21079] An empty set resolution is the ADR-0056 D2 deny baseline — `false`,
   * as the middleware's CRUD gate refuses the read an export is — and [#21908]
   * a principal-less context is `false` before anything resolves (ADR-0096 D5
   * strict mode, {@link isPrincipalLessContext}), as the middleware refuses it.
   */
  canExport(object: string, context?: any): Promise<boolean> {
    // [#25223 cut 9] The body moved to `security-plugin-object-admission.ts` (see `ObjectAdmissionHost`).
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const readQl = () => this.ql;
    const readTenancyPosture = () => this.tenancyPosture;
    const host: Pick<ObjectAdmissionHost, 'getObjectSecurityMeta' | 'permissionEvaluator' | 'ql' | 'resolvePermissionSetsForContext' | 'tenancyPosture'> = {
      getObjectSecurityMeta: (...a) => this.getObjectSecurityMeta(...a),
      get permissionEvaluator() { return readPermissionEvaluator(); },
      get ql() { return readQl(); },
      resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
      get tenancyPosture() { return readTenancyPosture(); },
    };
    return canExport.call(host, object, context);
  }

  /**
   * [#10757] The memo key: every field of the execution context this resolution
   * reads. Two contexts that agree on all of them get the same answer, and a
   * context whose grants were rewritten in place (rather than replaced) gets a
   * different key and is re-resolved.
   *
   * Spelled out rather than derived from the object, deliberately: a
   * `JSON.stringify(context)` would fold in fields the resolution never reads
   * (making the memo miss for no reason) and would silently start keying on any
   * field added later — including one that should NOT participate. The list is
   * short because the inputs are: {@link resolvePermissionSetsForContext} reads
   * `positions`, `permissions`, `principalKind` and the PRESENCE of `userId`,
   * and nothing else off the context.
   */
  private permissionSetMemoKey(context: any): string {
    // [#25223 cut 8] The body moved to `security-plugin-permission-sets.ts` (see `PermissionSetsHost`).
    return permissionSetMemoKey(context);
  }

  /**
   * [#18783] `ISecurityService.getEffectiveObjectPermissions` — the subject's
   * EFFECTIVE object-permission map, object name -> `EffectiveObjectPermission`.
   *
   * It is `buildEffectiveObjectPermissions` (`@objectstack/core`) over
   * {@link resolvePermissionSetsForContext}'s answer and this plugin's engine:
   * the ONE function `/auth/me/permissions` builds its `objects` slot with, so
   * the endpoint and this method are the same answer for the same sets rather
   * than two merges that agree today. Every clause of the contract member:
   *
   *  - **The WHOLE map** — no object parameter; every object the resolution
   *    mentions plus the entries the super-user seed adds.
   *  - **Throws on resolution failure, never `{}`** — the throw is the set
   *    resolution's own, propagated untouched, so whatever it carries (a code,
   *    a status) reaches the caller intact. An empty map comes back only when
   *    the subject really holds nothing.
   *  - **Request-scoped** — computed per call and never cached here. The set
   *    resolution under it is the plugin's existing per-context memo (keyed on
   *    the request's context object and retired by the write epoch), so a
   *    second ask within one request pays no second resolution, and a new
   *    request — a new context — never sees an old grant.
   *
   * Frozen at the top level: the map is pinned data for its consumers
   * (`toEvalPermissions` copies it again on the way into a predicate), and no
   * entry aliases a permission set.
   */
  private async getEffectiveObjectPermissions(
    context?: any,
  ): Promise<Readonly<Record<string, EffectiveObjectPermission>>> {
    const sets = await this.resolvePermissionSetsForContext(context);
    const ql = this.ql;
    return Object.freeze(buildEffectiveObjectPermissions(sets, {
      // The registry view is engine-local (`unknown[]` on the contract); the
      // seed reads only `name` / `enable` off each entry.
      allSchemas: () => ql?.registry?.getAllObjects?.(),
      schemaOf: (name: string) => ql?.getSchema?.(name),
      logger: this.logger,
    }));
  }

  /**
   * Resolve the effective permission sets for an execution context — positions +
   * explicit permission sets, with the configured baseline applied both as an
   * implicit request (when none were named) and as a post-resolution fallback
   * (when named ones resolved to nothing). Shared by the engine middleware and
   * {@link getReadFilter} so both enforce identical RLS. May throw if the
   * underlying metadata/db resolution fails (callers fail-closed).
   *
   * [#10757] Memoized per execution context and retired by any write — see
   * {@link permissionSetMemo} for the duplicate this removes, why the context
   * object IS the request scope, and why the write epoch is what makes reuse a
   * de-duplication rather than a staleness window. A REJECTION is never
   * retained: the entry is dropped so the next caller re-resolves (callers
   * fail closed on a throw, so a memoized failure would deny for the rest of
   * the context's life on a fault that may already be over).
   */
  private async resolvePermissionSetsForContext(
    context: any,
  ): Promise<PermissionSet[]> {
    // A primitive/absent context has no identity to key on — and no grants to
    // resolve either. Straight through.
    if (!context || typeof context !== 'object') {
      return this.resolvePermissionSetsForContextUnmemoized(context);
    }
    const key = this.permissionSetMemoKey(context);
    const hit = this.permissionSetMemo.get(context);
    // Every caller gets its OWN array, exactly as before this memo existed —
    // a shared array would be a new aliasing hazard on top of a query saving,
    // and no caller should have to know which of the two it holds. (The
    // PermissionSet objects inside were already shared instances: they come
    // from the metadata/bootstrap registries, not from this call.)
    if (hit && hit.epoch === this.epoch.current && hit.key === key) {
      return hit.sets.then((s) => [...s]);
    }
    const sets = this.resolvePermissionSetsForContextUnmemoized(context);
    const entry = { epoch: this.epoch.current, key, sets };
    this.permissionSetMemo.set(context, entry);
    sets.catch(() => {
      if (this.permissionSetMemo.get(context) === entry) {
        this.permissionSetMemo.delete(context);
      }
    });
    return sets.then((s) => [...s]);
  }

  /** The actual resolution — see {@link resolvePermissionSetsForContext}. */
  private resolvePermissionSetsForContextUnmemoized(
    context: any,
  ): Promise<PermissionSet[]> {
    // [#25223 cut 8] The body moved to `security-plugin-permission-sets.ts` (see `PermissionSetsHost`).
    const readLogger = () => this.logger;
    const readMetadata = () => this.metadata;
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const host: Pick<PermissionSetsHost, 'baselinePermissionSets' | 'bootstrapPermissionSets' | 'dbLoaderForContext' | 'dropDeactivatedFoldedSets' | 'logger' | 'metadata' | 'permissionEvaluator' | 'reportNameFoldCollisions'> = {
      baselinePermissionSets: this.baselinePermissionSets,
      bootstrapPermissionSets: this.bootstrapPermissionSets,
      dbLoaderForContext: (...a) => this.dbLoaderForContext(...a),
      dropDeactivatedFoldedSets: (...a) => this.dropDeactivatedFoldedSets(...a),
      get logger() { return readLogger(); },
      get metadata() { return readMetadata(); },
      get permissionEvaluator() { return readPermissionEvaluator(); },
      reportNameFoldCollisions: (...a) => this.reportNameFoldCollisions(...a),
    };
    return resolvePermissionSetsForContextUnmemoized.call(host, context);
  }

  /**
   * [ADR-0049, ADR-0131 D3] Drop a set that reached the resolution ONLY because
   * a POSITION of the same name was folded into the request, when the
   * activation ledger switched that set off.
   *
   * Every other name arrives already judged: `context.permissions` is the
   * resolver's output, which drops a deactivated set (§6b), and the baseline
   * is the deployment's configuration, applied regardless. A folded position
   * name is the one name nobody judged as a SET — the position is in effect,
   * but the set that shares its name may not be. The row loader this replaced
   * judged it with the catalog row's `active` column; the switch now lives in
   * `sys_metadata_activation`, read through the resolver's own
   * `readDisabledCatalogNames`, so this path and the resolver cannot disagree.
   *
   * The ledger is read only when a folded name actually resolved, so a request
   * with no such collision issues no read. A read that fails throws
   * (`AuthzStoreUnavailableError`), and the request fails closed.
   */
  private dropDeactivatedFoldedSets(
    positions: unknown,
    explicitPermissionSets: unknown,
    baselineApplied: string[],
    resolved: PermissionSet[],
  ): Promise<PermissionSet[]> {
    // [#25223 cut 8] The body moved to `security-plugin-permission-sets.ts` (see `PermissionSetsHost`).
    const readQl = () => this.ql;
    const host: Pick<PermissionSetsHost, 'ql'> = {
      get ql() { return readQl(); },
    };
    return dropDeactivatedFoldedSets.call(host, positions, explicitPermissionSets, baselineApplied, resolved);
  }

  /**
   * [ADR-0131 D3/D4] `ISecurityService.describePositionGrants` — each position
   * as the resolver enforces it for a holder, for the position catalog's list.
   *
   * ## The sets, from the enforcement path
   *
   * A holder of position P is granted, through P, two things, each read where
   * the resolver reads it — ⛔ never a second copy of either rule:
   *
   *  1. the sets P's DEFINITION names, in force — `@objectstack/core`'s
   *     `readPositionGrantsInForce`, the reading §6a/§6b of
   *     `resolveUserAuthzGrants` takes (a switched-off position grants
   *     nothing; a switched-off set, or a name the catalog holds no set for, is
   *     not granted). These arrive here as a context's `permissions`;
   *  2. the set that shares P's NAME — the position-name fold of
   *     {@link resolvePermissionSetsForContextUnmemoized}, requested by the same
   *     evaluator call and judged by the same {@link dropDeactivatedFoldedSets}.
   *     Never for `guest`: the guest envelope requests no position.
   *
   * So each position's sets are this resolver's request for a holder of that
   * position ALONE: the baseline and every other grant left out, and nothing
   * reported ({@link reportNameFoldCollisions} is the request path's, and an
   * admin reading the list is not a holder resolving). A set is `via:
   * 'definition'` when the definition names it, else `via: 'name'`.
   *
   * ## The holders
   *
   * `countPositionHolders` in `@objectstack/core`, over the caller's active
   * organization, by the rule the resolver projects a caller's positions by.
   * The count discloses who holds what in the organization, so it is served only
   * to a caller who may read the assignment rows themselves
   * ({@link canReadObject} on `sys_user_position`, the read the position page's
   * holder list makes); anyone else is told `null`, never `0`.
   *
   * A read that fails throws: the caller serves no description, never an
   * invented one.
   */
  private async describePositionGrants(
    positions: readonly string[],
    context?: any,
  ): Promise<PositionGrantSummary[]> {
    const names = positions.filter((n): n is string => typeof n === 'string' && n !== '');
    const { inForce, disabledPositions } = await readPositionGrantsInForce(this.ql, names);
    const tenantId = typeof context?.tenantId === 'string' && context.tenantId !== '' ? context.tenantId : undefined;
    const holders = tenantId && await this.canReadObject('sys_user_position', context)
      ? await countPositionHolders(this.ql, tenantId, names)
      : new Map<string, number>();
    const summaries: PositionGrantSummary[] = [];
    for (const position of names) {
      const permissionSets: PositionGrantSummary['permissionSets'] = [];
      if (!disabledPositions.has(position)) {
        const declared = inForce.get(position) ?? [];
        const folded = position === GUEST_POSITION ? [] : [position];
        let resolved = await this.permissionEvaluator.resolvePermissionSets(
          [...folded, ...declared.filter((n) => !folded.includes(n))],
          this.metadata,
          this.bootstrapPermissionSets,
          this.dbLoaderForContext(context),
          { logger: this.logger },
        );
        resolved = await this.dropDeactivatedFoldedSets(folded, declared, [], resolved);
        for (const set of resolved) {
          const name = (set as any)?.name;
          if (typeof name !== 'string' || permissionSets.some((p) => p.name === name)) continue;
          permissionSets.push({ name, via: declared.includes(name) ? 'definition' : 'name' });
        }
      }
      summaries.push({ position, holderCount: holders.get(position) ?? null, permissionSets });
    }
    return summaries;
  }

  /**
   * [#13419 执行要点 3; #24757 under 「甲」] Report a permission set granted to a
   * position's holders only because the two share a NAME — a grant the
   * position's definition does not declare — and say what happens to it when
   * the fold is retired.
   *
   * ## What is being reported
   *
   * {@link resolvePermissionSetsForContextUnmemoized} builds its request as
   * `[...positions, ...explicitPermissionSets]`. That fold means a position
   * called `sales_rep` resolves a permission set called `sales_rep` although
   * the definition of `sales_rep` names no such set in `permissionSets`, the
   * one binding spec and docs declare (ADR-0131 D3/D4; `position.zod.ts`,
   * `positions.mdx`). Nothing declares that it happens, and Setup cannot show
   * it: both the position's Permission Sets field and the set's Assigned Users
   * read the declared binding. The maintainer ruling on #13419 (2026-08-31,
   * 「同意」 to B) retires the fold; ADR-0131 later made the definition's
   * `permissionSets` the binding in place of the junction table that ruling
   * named.
   *
   * ## The 18.x loud half (「甲」, #24757)
   *
   * The fold's retirement is a narrowing no ADR-0087 conversion can carry, so
   * under 「甲」 (ruling record 6292005854 on #6015) 18.x ships its loud half
   * and the removal waits for 19.0. This warning IS that loud half, and its
   * text says three things the 17.x wording did not: the grant is in force
   * today only because the names match; that name-based grant is deprecated
   * and is removed in the next major version, after which holders of `P` do
   * not receive set `P` unless `P`'s definition names it; and the fix,
   * `permissionSets: ['P']` on position `P` (or renaming one of the two). The
   * structured payload carries the same consequence as `removedIn:
   * 'next_major'` beside its unchanged `event`, `position` and `permissionSet`
   * ({@link POSITION_NAME_FOLD_EVENT}). The string says "the next major
   * version" and not a number, and carries no tracker id: an operator reading
   * the log can resolve neither a ruling record nor `#NNNN`.
   *
   * ## When it fires
   *
   * Lazily, on the first resolution that meets an undeclared pair — never at
   * boot, so a deployment where no holder of `P` has made a request has not
   * been told yet. Once per position NAME per plugin instance
   * ({@link nameFoldWarned}): not per holder, and not per organization, since
   * the key is the name alone. A restart reports again.
   *
   * ## The predicate, and why each clause is there
   *
   * A position name `P` is reported when ALL of:
   *
   *   1. a permission set named `P` actually resolved — a position whose name
   *      matches nothing grants nothing, and the seven inert positions
   *      (`platform_admin`, `org_owner`, `org_admin`, `org_member`, `guest`,
   *      and app-showcase's `finance` / `legal`) are all of that kind. ⛔ A
   *      false positive on a built-in identity is the most expensive failure
   *      this warning has, and this clause is what prevents it;
   *   2. `P` was NOT already requested through the governed channel. The sets
   *      a position's definition names (`permissionSets`, ADR-0131 D3/D4)
   *      arrive as permission-set NAMES in `context.permissions`
   *      (`resolve-authz-context.ts` §6b pushes `ps.name`), as do directly
   *      assigned sets. Either way the grant does not depend on the fold, so
   *      there is nothing ungoverned to report;
   *   3. `P` is not one of the baseline names folded in just above — those are
   *      in force for every authenticated caller regardless of the fold.
   *
   * ⚠️ Clause 2 is about the pair `(position P, set P)` SPECIFICALLY. A
   * position bound to some OTHER set is still folded onto its own name: the
   * #13419 census measured `sales_manager` bound to `crm_sales_user` and
   * folding onto the same-named set anyway. Testing "is this position bound to
   * anything?" would report neither of the two real name-folds in the repo
   * while looking complete.
   *
   * ## Boundary (#13419 slice 2, kept by #24757)
   *
   * ⛔ Purely additive. The resolution result is READ, never rewritten — 要点 5
   * of the ruling: 「任何行为差异只能表现为拒绝/告警,永不静默改变解析结果」, and a
   * warning is the permitted half. Under 「甲」 the grant does not change in 18.x
   * either: a holder of `P` still resolves set `P`, and
   * `position-name-fold-warning.test.ts` pins that beside the text. ⛔ Deleting
   * the fold is NOT this change. It is #24757's 19.0 half, with
   * {@link dropDeactivatedFoldedSets} and the delegated walk, explain and
   * collision-gate follow-ups. The reliance it would revoke, as measured on the
   * card, is HotCRM's: 5 of its 12 positions at `f22dfa52`, which
   * objectstack-ai/hotcrm#2200 declares in `permissionSets`.
   */
  private reportNameFoldCollisions(
    positions: unknown,
    explicitPermissionSets: unknown,
    baselineApplied: string[],
    resolved: PermissionSet[],
  ): void {
    // [#25223 cut 8] The body moved to `security-plugin-permission-sets.ts` (see `PermissionSetsHost`).
    const readLogger = () => this.logger;
    const host: Pick<PermissionSetsHost, 'logger' | 'nameFoldWarned'> = {
      get logger() { return readLogger(); },
      nameFoldWarned: this.nameFoldWarned,
    };
    reportNameFoldCollisions.call(host, positions, explicitPermissionSets, baselineApplied, resolved);
  }

  /**
   * [ADR-0106 D7] Resolve the configured baseline permission set(s) on their
   * own — the deployment's answer to "what does a caller with NO resolved sets
   * of their own see".
   *
   * [#7616] This used to describe itself as "the second step
   * `/auth/me/permissions` takes when a caller's own names resolve to nothing
   * (`resolved.length === 0 && fallbackName`)". That step no longer exists:
   * PR #7615 (#7608, ADR-0090 D5) deleted it, because the `resolved.length === 0`
   * guard WAS the fallback cliff D5 abolishes — a member's first explicit grant
   * silently cost them the entire baseline. That endpoint now folds the
   * baseline into the FIRST resolution, additively and unconditionally, so a
   * second call over a subset of the same names could add nothing. Only the
   * cross-reference was stale; this method's own behaviour never depended on it.
   *
   * Distinct from the post-resolution fallback inside
   * {@link resolvePermissionSetsForContext}, which is gated on `context.userId`
   * (it exists to close an RLS fail-open for AUTHENTICATED callers whose
   * positions map to no set). D7 needs the same resolution for a caller with no
   * principal at all, so that a guest-facing deployment's metadata exposure is
   * a permission-set decision rather than an accidental everything-default.
   *
   * [#7555] Reads the COMPOSED baseline, deliberately — D7 warrants it. This
   * method exists to answer "what does this deployment's baseline disclose",
   * and its whole justification is being *the same* baseline resolution the
   * data plane performs (the composed `security.baselinePermissionSets`); one
   * plane composing while the other displaced would put the two planes in
   * disagreement about what the baseline even is, which is the drift D7 is
   * written to avoid. On every deployment that declares no app baseline the
   * list is exactly `['member_default']` and nothing changes; on one that does,
   * exposure becomes platform ∪ app — both deliberate permission-set decisions,
   * which is the bar D7 sets, rather than an app declaration silently NARROWING
   * a guest's schema view relative to a deployment that declared nothing.
   *
   * Returns `[]` when no baseline is configured or none of it resolves.
   *
   * [Ruling of record 6355206139] …and an EXTERNAL caller (`org_external`) is
   * judged against `external_default`, the baseline the data plane resolves for
   * it, never the member baseline: the same helper names both
   * (`external-baseline.ts`).
   */
  private async resolveFallbackPermissionSets(context?: any): Promise<PermissionSet[]> {
    const fallback = humanBaselineFor(context?.positions, this.baselinePermissionSets);
    if (fallback.length === 0) return [];
    return this.permissionEvaluator.resolvePermissionSets(
      fallback,
      this.metadata,
      this.bootstrapPermissionSets,
      // Scoped like every other resolution: a guest of one organization must
      // resolve THAT organization's baseline set, not whichever copy of the
      // name the driver ordered first.
      this.dbLoaderForContext(context),
      { logger: this.logger },
    );
  }

  /**
   * Resolve a single scalar primary-key id from an update/delete operation
   * context, mirroring the engine's "single-id vs predicate" rule
   * (`engine.ts` update/delete): only a scalar `data.id` or `where.id`
   * identifies one row. An operator object (`{ $in: [...] }`, …) is a
   * multi-row predicate and returns `null` (multi-row writes route through the
   * `*Many` paths, out of scope for the by-id pre-image check).
   */
  /**
   * [commit 6feac910b] Does this object declare that its access — writes included — derives
   * from a master record (ADR-0055 `controlled_by_parent`)?
   *
   * ## One read point, deliberately, and this is the whole reason it exists
   *
   * Two sites now depend on this answer and they depend on it in OPPOSITE
   * directions: {@link computeLayeredRlsFilter} removes the platform ownership
   * floor when it is `true`, and {@link assertControlledByParentWrite} installs
   * the replacement gate when it is `true`. A disagreement between them in the
   * `true`/`false` order — floor dropped, master gate skipped — is precisely the
   * bare widening the maintainer's precondition exists to prevent, and it would
   * be silent: the write would simply succeed.
   *
   * That disagreement is REACHABLE if each site resolves the schema its own way.
   * `getObjectSecurityMeta` falls back to the metadata service when the live
   * ObjectQL schema is missing and CACHES the result; the master gate reads only
   * `ql.getSchema`. A boot window where one resolves and the other does not is
   * enough. So the posture is read here, from the master gate's own source, and
   * both sites call this — there is no second resolution to drift.
   *
   * Fail-closed by construction: an unresolvable schema is `false`, which keeps
   * the floor on (the narrow direction) and makes the master gate a no-op on an
   * object that never declared it (unchanged behaviour).
   */
  private declaresControlledByParent(object: string): boolean {
    const schema = typeof this.ql?.getSchema === 'function' ? this.ql.getSchema(object) : null;
    return masterGovernsRowWrites(schema);
  }

  /**
   * [#21771] The id of the row a by-id UPDATE or DELETE writes, when that write
   * is the one the caller addressed — else `undefined`, and ruling A's read
   * question is not asked.
   *
   * Three exclusions, each a measured constraint of the ruling's execution:
   *
   *  - **a nested write** ({@link engineOperationScope}): a cascade or a hook
   *    issued it under the caller's context, so the caller addressed nothing;
   *  - **the referential FK clear** (`__referentialFieldClear`, server-derived,
   *    update only): the engine's own integrity write on a row the caller never
   *    named — the same carve-out step 2 makes for it;
   *  - **anything the engine does not route by id.** By-id versus predicate is
   *    the ENGINE's decision, read from its own dispatch predicates
   *    (`resolveEngineUpdateDispatch` / `resolveEngineDeleteDispatch`) and never
   *    re-derived: a falsy payload id is no row address to the engine, which
   *    then writes the row `where.id` names — or, with no `where.id`, takes the
   *    predicate path, where there is no single row to answer about at all.
   *
   * Update and delete only — the two verbs the ruling names. The lifecycle
   * verbs keep the pre-image check exactly as it was.
   */
  private addressedByIdWriteId(opCtx: any, nested: boolean, referentialFieldClear: boolean): unknown {
    // [#25223 cut 8] The body moved to `security-plugin-addressed-writes.ts` (see `AddressedWritesHost`).
    return addressedByIdWriteId(opCtx, nested, referentialFieldClear);
  }

  /**
   * [#21771] Ruling A's read question for the addressed row: would the read
   * door, asked by this caller, return it? Asked through the caller-context
   * pre-image read the later gates already share ({@link getCallerPreImage}),
   * so it is the read door's own question — every data middleware's read
   * visibility included — and never a second visibility evaluator.
   *
   * Only ABSENCE is "cannot read". A read-time policy refusal (a declared 4xx
   * envelope: the object's read grant withheld, a predicate the driver will not
   * compile) is not a hidden row, so it answers `false` and the write keeps
   * today's answer; a store fault is neither and propagates as raised (#7505).
   */
  private async callerCannotReadAddressedRow(opCtx: any, id: unknown): Promise<boolean> {
    return absentUnderCallerRead(() => this.getCallerPreImage(opCtx, id));
  }

  /**
   * [#21829] Is this the PREDICATE update or delete the caller addressed — the
   * write whose matched set is narrowed to what the caller can read?
   *
   * The twin of {@link addressedByIdWriteId}, with the same exclusions, for the
   * same reasons:
   *
   *  - **a nested write** ({@link engineOperationScope}): a cascade or a hook's
   *    own predicate write, issued under the caller's context on rows the
   *    caller never addressed, keeps today's behaviour;
   *  - **the referential FK clear** (`__referentialFieldClear`, server-derived):
   *    the engine's own integrity write;
   *  - **anything the engine does not route down its predicate path.** By-id
   *    versus predicate is the ENGINE's decision, read from its own dispatch
   *    predicates (`resolveEngineUpdateDispatch` /
   *    `resolveEngineDeleteDispatch`): only their `multi` verdict seeds the AST
   *    the predicate path reads its matched rows from.
   */
  private addressedPredicateWrite(opCtx: any, nested: boolean, referentialFieldClear: boolean): boolean {
    // [#25223 cut 8] The body moved to `security-plugin-addressed-writes.ts` (see `AddressedWritesHost`).
    return addressedPredicateWrite(opCtx, nested, referentialFieldClear);
  }

  /**
   * [#21829] The read door's answer for the caller's own predicate, as the
   * scope a predicate write's matched set is narrowed to: `id IN (the rows the
   * read returned)`.
   *
   * The question is asked through the engine under the caller's context —
   * the read door itself, so every data middleware's and every kit's read
   * visibility applies — never through a second visibility evaluator. It is
   * asked of the caller's VERBATIM predicate (`options.where`, as step 2.9
   * guards it), never of the composed write AST: that AST carries write scopes
   * the read guard would judge as the caller's own filter.
   *
   * Three outcomes, classified by {@link readUnlessRefused}:
   *
   *  - an answer: the scope to compose. An empty answer composes the empty id
   *    list, so a predicate that matches only rows the caller cannot read
   *    matches nothing at all;
   *  - `refused` (a declared 4xx — the read grant withheld, a predicate the
   *    driver will not compile): `null`, and the write keeps the answer it has
   *    today;
   *  - a store fault propagates as raised.
   *
   * The id list is bounded by {@link PREDICATE_WRITE_READABLE_ID_CAP}; see
   * there for what happens above it.
   */
  private readableRowsScopeForPredicateWrite(opCtx: any): Promise<Record<string, unknown> | null> {
    // [#25223 cut 8] The body moved to `security-plugin-addressed-writes.ts` (see `AddressedWritesHost`).
    const readQl = () => this.ql;
    const host: Pick<AddressedWritesHost, 'ql'> = {
      get ql() { return readQl(); },
    };
    return readableRowsScopeForPredicateWrite.call(host, opCtx);
  }

  private extractSingleId(opCtx: any): string | number | bigint | null {
    // [#25223 cut 8] The body moved to `security-plugin-addressed-writes.ts` (see `AddressedWritesHost`).
    return extractSingleId(opCtx);
  }

  /**
   * By-id row read shared by every provenance / pre-image gate. Centralising
   * the read SHAPE keeps a future change (soft-delete filter, field
   * projection) from drifting across the ~5 call sites that used to inline it
   * (#3018 review — Reuse).
   *
   * ## `null` means ABSENT, and only absent (#7505)
   *
   * This probe used to answer `null` for three different facts — the row does
   * not exist, the engine threw (driver down, table missing, timeout), and no
   * engine is wired — and every caller read all three as "no such row". Its
   * own contract note claimed a `null` "always DENIES downstream"; that was
   * true of one caller and false of the other three, in two opposite ways:
   *
   *   - `assertControlledByParentWrite` answered `404 RECORD_NOT_FOUND` — an
   *     SDK treats that as TERMINAL (drop the id, do not retry) when the
   *     truthful answer was a transient outage it should have backed off on;
   *   - the two admin-door provenance gates on the catalog row objects
   *     (retired with those objects, ADR-0131 D3) read `null` as "this row is
   *     not package/platform-managed" and let the write THROUGH — fail-OPEN,
   *     the whole guard silently stood down for the duration of a store fault.
   *
   * Maintainer ruling of 2026-08-11 on #7505: FAIL-CLOSED. An engine fault
   * PROPAGATES out of this probe instead of being flattened, so the write is
   * refused and the caller is told what actually happened. The error is
   * re-thrown exactly as thrown — objectql's `DatasourceUnavailableError`
   * keeps its `ERR_DATASOURCE_UNAVAILABLE` code and both transports map that
   * to `503` (`rest-server.ts`'s `mapDataError`) — because this gate is not
   * the producer of that condition and has nothing to add to it. Wrapping it
   * in a security code would relabel a dependency outage as an authorization
   * event and would register a second spelling of an existing ADR-0112 ledger
   * entry under a package that does not own it.
   *
   * Every call site therefore sees exactly two outcomes: a row, or `null` for
   * a row that is genuinely absent. Steady-state behaviour is unchanged
   * everywhere; only the fault path moved.
   *
   * The probe reads under whatever context the caller passes — `isSystem` for
   * the provenance / existence gates, the CALLER's context for the pre-image —
   * and that choice is the caller's, not this method's.
   */
  private readRowById(object: string, id: unknown, context: any): Promise<Record<string, unknown> | null> {
    // [#25223 cut 8] The body moved to `security-plugin-addressed-writes.ts` (see `AddressedWritesHost`).
    const readQl = () => this.ql;
    const host: Pick<AddressedWritesHost, 'ql'> = {
      get ql() { return readQl(); },
    };
    return readRowById.call(host, object, id, context);
  }

  /**
   * The single-id write PRE-IMAGE read under the CALLER's context, memoized per
   * operation. The owner-anchor echo check (step 3.5) and the RLS `check`
   * post-image (step 3.6) read the IDENTICAL `(object, id, caller-context)` row;
   * this collapses the two reads into one. Safe: no write to the row happens
   * between the gates (the driver write runs after the whole middleware pass),
   * so the pre-image is stable within the operation.
   *
   * [#7505] `null` here means the row is absent OR invisible to the caller —
   * both of which DENY at every consumer, and are deliberately
   * indistinguishable (the owner-enumeration oracle). A store fault is neither:
   * it propagates. Nothing is memoized on the fault path, so a retry within the
   * same operation re-probes rather than caching an outage as a verdict.
   */
  private async getCallerPreImage(opCtx: any, id: unknown): Promise<Record<string, unknown> | null> {
    if (id == null) return null;
    if (opCtx.__preImage && opCtx.__preImage.id === id) return opCtx.__preImage.row;
    const row = await this.readRowById(opCtx.object, id, opCtx.context);
    opCtx.__preImage = { id, row };
    return row;
  }

  /**
   * Does the object's own write model replace the platform ownership floor
   * for this operation? True for a `public_read_write` OWD on `update` (#8023)
   * and for a `controlled_by_parent` detail whose master gate the caller
   * vouches covers this write. That ruling landed in commit 6feac910b6
   * ("the master gate is the sole row-write authority for a
   * controlled_by_parent detail"); the card number cited for it elsewhere in
   * this file no longer resolves on the board, and that commit is the live
   * record. The reasons are recorded where {@link computeLayeredRlsFilter}
   * applies the drop.
   *
   * One predicate, two readers: the pre-image Layer 1 composition and the
   * post-image check's floor decision (`computeWriteCheckFilter`). Keeping it
   * in one place keeps the two from disagreeing about when the floor applies.
   */
  private platformFloorYieldsToObjectWriteModel(
    meta: { owdOpensRowWrites?: boolean },
    object: string,
    operation: string,
    opts?: RlsFilterOptions,
  ): boolean {
    if (meta.owdOpensRowWrites && owdOpenWritesCoversOperation(operation)) return true;
    return (
      !!opts?.masterGateCoversThisWrite &&
      masterGateCoversOperation(operation) &&
      this.declaresControlledByParent(object)
    );
  }

  /**
   * [ADR-0095 D1] Compute the effective row filter for (object, operation) as
   * `Layer0(tenant) AND Layer1(business RLS)`.
   *
   * - **Layer 0** (tenant isolation) is computed by {@link computeTenantLayer0Filter}
   *   from the tenancy mode + the object's field set/posture — independent of the
   *   RLS compiler, always first, unconditionally AND-composed.
   * - **Layer 1** (business RLS) is the applicable per-policy compile (ownership,
   *   depth, sharing, `_self` carve-outs), with the field-existence safety net and
   *   the posture-gated superuser bypass — which now governs BUSINESS RLS only.
   *
   * Shared by the engine middleware (read + by-id write pre-image) and
   * {@link getReadFilter}. Returns `null` when neither layer contributes.
   */
  private async computeRlsFilter(
    permissionSets: PermissionSet[],
    object: string,
    operation: string,
    context: any,
    opts?: RlsFilterOptions,
  ): Promise<Record<string, unknown> | null> {
    const { layer0, layer1 } = await this.computeLayeredRlsFilter(permissionSets, object, operation, context, opts);
    return andComposeLayers(layer0, layer1);
  }

  /**
   * [C2 / ADR-0095 D1] The layered RLS split — `{ layer0, layer1 }` BEFORE the
   * AND-compose. `computeRlsFilter` is the thin wrapper that composes them; the
   * explain engine consumes the split directly so it can attribute the tenant
   * wall (Layer 0) and business RLS (Layer 1) to a record SEPARATELY. Single code
   * path → the record story cannot drift from the effective filter enforcement uses.
   */
  /**
   * [Finding 2 / ADR-0095 D3] Does the caller resolve to the `PLATFORM_ADMIN`
   * posture rung? True iff the resolved permission sets grant any
   * platform-EXCLUSIVE capability ({@link PLATFORM_ADMIN_ONLY_CAPABILITIES}) — the
   * caps `admin_full_access` carries and `organization_admin` deliberately
   * withholds. This is what separates a platform operator from a tenant org admin
   * (both hold the `viewAllRecords`/`modifyAllRecords` superuser bit), and it is
   * the ONLY signal permitted to cross the Layer 0 tenant wall.
   */
  private hasPlatformAdminPosture(permissionSets: PermissionSet[]): boolean {
    return hasPlatformAdminCapability(this.permissionEvaluator.getSystemPermissions(permissionSets));
  }

  private computeLayeredRlsFilter(
    permissionSets: PermissionSet[],
    object: string,
    operation: string,
    context: any,
    opts?: RlsFilterOptions,
  ): Promise<{
    layer0: Record<string, unknown> | null;
    layer1: Record<string, unknown> | null;
    /**
     * [#15813] What Layer 0 DECIDED — `layer0` is this verdict's projection
     * (`tenantLayer0FilterOf`), never a sibling computation. The engine
     * middleware records it on the operation context so a producer downstream
     * reads the wall's decision instead of re-deriving the wall.
     */
    tenantLayer0Verdict: TenantLayer0Verdict;
    /**
     * [ADR-0095 D3 · #24821] True only when a true `PLATFORM_ADMIN` crossing on
     * a posture-permitting object is what made {@link tenantLayer0Verdict}
     * `none` — the wall stands for every other caller on this object.
     */
    crossedByPlatformAdmin: boolean;
  }> {
    // [#25223 cut 7] The body moved to `security-plugin-rls-filter.ts` (see `RlsFilterHost`).
    const readLogger = () => this.logger;
    const readMetadata = () => this.metadata;
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const readQl = () => this.ql;
    const readRlsCompiler = () => this.rlsCompiler;
    const readTenancyPosture = () => this.tenancyPosture;
    const host: Pick<RlsFilterHost, 'collectRLSPolicies' | 'datetimeFieldNamesCache' | 'extractTargetField' | 'getObjectFieldNames' | 'getObjectSecurityMeta' | 'hasPlatformAdminPosture' | 'isVerifiedPlatformOwnerSession' | 'logger' | 'metadata' | 'numberComparandFieldsCache' | 'permissionEvaluator' | 'platformFloorYieldsToObjectWriteModel' | 'ql' | 'rlsCompiler' | 'stageRlsMembership' | 'tenancyDisabledCache' | 'tenancyPosture'> = {
      collectRLSPolicies: (...a) => this.collectRLSPolicies(...a),
      datetimeFieldNamesCache: this.datetimeFieldNamesCache,
      extractTargetField: (...a) => this.extractTargetField(...a),
      getObjectFieldNames: (...a) => this.getObjectFieldNames(...a),
      getObjectSecurityMeta: (...a) => this.getObjectSecurityMeta(...a),
      hasPlatformAdminPosture: (...a) => this.hasPlatformAdminPosture(...a),
      isVerifiedPlatformOwnerSession: (...a) => this.isVerifiedPlatformOwnerSession(...a),
      get logger() { return readLogger(); },
      get metadata() { return readMetadata(); },
      numberComparandFieldsCache: this.numberComparandFieldsCache,
      get permissionEvaluator() { return readPermissionEvaluator(); },
      platformFloorYieldsToObjectWriteModel: (...a) => this.platformFloorYieldsToObjectWriteModel(...a),
      get ql() { return readQl(); },
      get rlsCompiler() { return readRlsCompiler(); },
      stageRlsMembership: (...a) => this.stageRlsMembership(...a),
      tenancyDisabledCache: this.tenancyDisabledCache,
      get tenancyPosture() { return readTenancyPosture(); },
    };
    return computeLayeredRlsFilter.call(host, permissionSets, object, operation, context, opts);
  }

  /**
   * [#12974] Is this session's account the VERIFIED declared platform owner —
   * the predicate the Layer 0 owner wall bypass keys on?
   *
   * Server-side facts only, fail-closed at every rung (each `false` below is
   * "still walled", never an error):
   *
   *  1. [#13147] NO declared administrator ⇒ `false` for everyone. The
   *     variable takes one address OR a comma-separated list (#11663 Choice
   *     2B), so this asks the ONE shared parser
   *     (`resolvePlatformAdminEmails()` from `@objectstack/core`, memoized on
   *     the raw string) rather than holding the operator's whole value as if it
   *     were a single address — which is what it used to do, and which meant a
   *     LIST let nobody across the wall. Unset, blank and refused all land here
   *     as an empty list, read live per call (cheap), before any I/O, so an
   *     undeclared owner costs nothing and bypasses nobody.
   *  2. No authenticated `userId` on the context ⇒ `false`. System contexts
   *     never reach this method (the middleware's `isSystem` skip and
   *     `getReadFilter`'s mirror both return earlier), and carry no `userId`
   *     anyway.
   *  3. Fast NEGATIVE on the context's server-resolved session email
   *     (`resolveAuthzContext`: the better-auth session record or the
   *     `sys_user` read — never a client-supplied header): an email that is on
   *     no declared list walls without touching the row store, which keeps the
   *     wall's hot path free of per-request I/O for every non-owner session.
   *     Only narrowing — a MATCH (or an absent email) still requires the row.
   *     The membership test is the parser's own
   *     ({@link isConfiguredPlatformAdminEmail}), never a hand-rolled
   *     lowercase compare.
   *  4. The authoritative answer is the `sys_user` ROW (system-context by-id
   *     read, memoized per request-context like `__rlsMembershipStaged` /
   *     `__preImage`): {@link isVerifiedPlatformOwnerRow} = the canonical
   *     declared-owner email match (`platform-owner-wall-bypass.ts`, shared
   *     with the platform-admin standing surface — it was extracted as the
   *     elevation gate's twin, and since the #11663 re-anchor retired that
   *     gate its opposite number is the per-request derivation at
   *     `resolve-authz-context.ts` §6b-config) AND commit c0714eb5d's verified-email
   *     allow-list (`isEmailVerifiedUserRow` — absent-means-unverified).
   *     Missing row / unreadable store ⇒ `false`.
   *
   * The `isSystem: true` read below cannot recurse: system operations
   * short-circuit the security middleware before any RLS computation.
   */
  private isVerifiedPlatformOwnerSession(context: any): Promise<boolean> {
    // [#25223 cut 7] The body moved to `security-plugin-rls-filter.ts` (see `RlsFilterHost`).
    const readQl = () => this.ql;
    const host: Pick<RlsFilterHost, 'ql'> = {
      get ql() { return readQl(); },
    };
    return isVerifiedPlatformOwnerSession.call(host, context);
  }

  /**
   * [ADR-0058 D4] Compile the WRITE `check` predicate for a post-image
   * validation. Which applicable policies take part is decided by
   * {@link writeCheckPolicies}: the ones that declare `check` when any does,
   * otherwise every applicable policy's `using` standing in as its check — the
   * published `RowLevelSecurityPolicySchema.check` default. The compiled
   * FilterCondition is matched against the post-image record by the caller
   * (fail closed).
   */
  private computeWriteCheckFilter(
    permissionSets: PermissionSet[],
    object: string,
    operation: string,
    context: any,
    preImageOpts?: RlsFilterOptions,
  ): Promise<Record<string, unknown> | null> {
    // [#25223 cut 7] The body moved to `security-plugin-rls-filter.ts` (see `RlsFilterHost`).
    const readMetadata = () => this.metadata;
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const readQl = () => this.ql;
    const readRlsCompiler = () => this.rlsCompiler;
    const host: Pick<RlsFilterHost, 'collectRLSPolicies' | 'datetimeFieldNamesCache' | 'getObjectFieldNames' | 'getObjectSecurityMeta' | 'metadata' | 'numberComparandFieldsCache' | 'permissionEvaluator' | 'platformFloorYieldsToObjectWriteModel' | 'ql' | 'rlsCompiler' | 'stageRlsMembership'> = {
      collectRLSPolicies: (...a) => this.collectRLSPolicies(...a),
      datetimeFieldNamesCache: this.datetimeFieldNamesCache,
      getObjectFieldNames: (...a) => this.getObjectFieldNames(...a),
      getObjectSecurityMeta: (...a) => this.getObjectSecurityMeta(...a),
      get metadata() { return readMetadata(); },
      numberComparandFieldsCache: this.numberComparandFieldsCache,
      get permissionEvaluator() { return readPermissionEvaluator(); },
      platformFloorYieldsToObjectWriteModel: (...a) => this.platformFloorYieldsToObjectWriteModel(...a),
      get ql() { return readQl(); },
      get rlsCompiler() { return readRlsCompiler(); },
      stageRlsMembership: (...a) => this.stageRlsMembership(...a),
    };
    return computeWriteCheckFilter.call(host, permissionSets, object, operation, context, preImageOpts);
  }

  /**
   * [ADR-0095 D1 / #2937] Compute the Layer 0 (tenant) filter that a WRITE
   * post-image must satisfy — the write-side twin of the read Layer 0 wall,
   * applied to both INSERT (Finding: forged `organization_id`) and UPDATE
   * (Finding 1: `organization_id` RE-POINTED to another tenant). Reuses
   * {@link computeLayeredRlsFilter} so the tenant decision is DERIVED FROM ONE
   * PLACE and can never drift from the read side: same isolation probe, same
   * "is this a tenant object?" field/posture test, same platform-admin posture
   * exemption, same fail-closed deny sentinel when the context has no active
   * organization. Only `layer0` is returned — business RLS (`layer1`) is NOT
   * applied to the write post-image by this method (that path is governed by
   * {@link computeWriteCheckFilter}).
   */
  /**
   * [ADR-0105 D11] Populate `context.rlsMembership` from the registered
   * membership resolver, once per request.
   *
   * The RLS compiler has merged this bag since ADR-0056, but nothing in
   * production ever filled it — a declared capability with no producer, the
   * ADR-0049 defect. This is the producer: apps and plugins register an
   * {@link IRlsMembershipResolver} under `rls-membership-resolver` and own the
   * keys they declare.
   *
   * Fail-closed by construction: a throwing or partial resolver leaves keys
   * unset, which makes the policies referencing them drop out — narrowing
   * access, never widening it. Reserved kernel keys can never be overwritten,
   * so an app cannot redefine the org wall's own vocabulary.
   *
   * Two call sites, one per compile site, and both are load-bearing: the
   * read side ({@link computeLayeredRlsFilter}, before Layer 1 compiles
   * `using`) and the write side ({@link computeWriteCheckFilter}, before
   * `check` compiles). A predicate must resolve the same variables whichever
   * clause it sits in; with the write-side call missing, a `check` reading a
   * resolver key resolved only when the request happened to read first
   * (commit 1d73d45c1).
   *
   * [#25234 ruling A] Handed the policies about to compile (and their
   * object), it also stages the DECLARED membership keys they read
   * (`ObjectSchema.membershipKeys`, see `object-membership-keys.ts`): per key,
   * lazily, memoized per request, each through the platform's own Layer 0
   * system read of the roster object, bounded at `MEMBERSHIP_KEY_MAX_VALUES`
   * with every miss failing closed. A key both the resolver and a declaration
   * claim resolves from neither. Called with the context alone, it stages the
   * resolver's keys only, as before.
   */
  private stageRlsMembership(
    context: any,
    policies?: readonly RowLevelSecurityPolicy[],
    object?: string,
  ): Promise<void> {
    // [#25223 cut 7] The body moved to `security-plugin-rls-filter.ts` (see `RlsFilterHost`).
    const readLogger = () => this.logger;
    const readMetadata = () => this.metadata;
    const readQl = () => this.ql;
    const readRlsCompiler = () => this.rlsCompiler;
    const readRlsMembershipResolver = () => this.rlsMembershipResolver;
    const readTenancyPosture = () => this.tenancyPosture;
    const host: Pick<RlsFilterHost, 'datetimeFieldNamesCache' | 'getObjectFieldNames' | 'getObjectSecurityMeta' | 'logger' | 'metadata' | 'numberComparandFieldsCache' | 'ql' | 'rlsCompiler' | 'rlsMembershipResolver' | 'tenancyDisabledCache' | 'tenancyPosture'> = {
      datetimeFieldNamesCache: this.datetimeFieldNamesCache,
      getObjectFieldNames: (...a) => this.getObjectFieldNames(...a),
      getObjectSecurityMeta: (...a) => this.getObjectSecurityMeta(...a),
      get logger() { return readLogger(); },
      get metadata() { return readMetadata(); },
      numberComparandFieldsCache: this.numberComparandFieldsCache,
      get ql() { return readQl(); },
      get rlsCompiler() { return readRlsCompiler(); },
      get rlsMembershipResolver() { return readRlsMembershipResolver(); },
      tenancyDisabledCache: this.tenancyDisabledCache,
      get tenancyPosture() { return readTenancyPosture(); },
    };
    return stageRlsMembership.call(host, context, policies, object);
  }

  private async computeWriteTenantCheckFilter(
    permissionSets: PermissionSet[],
    object: string,
    operation: string,
    context: any,
  ): Promise<Record<string, unknown> | null> {
    return (await this.computeWriteTenantWall(permissionSets, object, operation, context)).layer0;
  }

  /**
   * The caller's Layer 0 for a write — {@link computeWriteTenantCheckFilter}'s
   * filter — together with whether a platform operator's crossing is why it
   * is `null` (ADR-0095 D3). One computation answers both, so step 3.7 never
   * pays for the layered compile twice.
   */
  private async computeWriteTenantWall(
    permissionSets: PermissionSet[],
    object: string,
    operation: string,
    context: any,
  ): Promise<{ layer0: Record<string, unknown> | null; crossedByPlatformAdmin: boolean }> {
    const { layer0, crossedByPlatformAdmin } = await this.computeLayeredRlsFilter(
      permissionSets,
      object,
      operation,
      context,
    );
    return { layer0, crossedByPlatformAdmin };
  }

  /**
   * [ADR-0123 D2] Which principal the no-active-organization write wall
   * refuses, or `null` — the verdict the middleware's step 3.7 throws on.
   * {@link canWriteObject} asks this same method, so the two doors share one
   * spelling of the wall. It is handed no row, stored or written.
   */
  private organizationWallRefusal(
    permissionSets: PermissionSet[],
    object: string,
    operation: string,
    context: any,
    delegatorSets: PermissionSet[] | null,
    delegatorContext: any,
  ): Promise<'caller' | 'delegator' | null> {
    // [#25223 cut 6] The body moved to `security-plugin-write-tenant-wall.ts` (see `WriteTenantWallHost`).
    const readOrgScopingEnabled = () => this.orgScopingEnabled;
    const readTenancyPosture = () => this.tenancyPosture;
    const host: Pick<WriteTenantWallHost, 'computeWriteTenantCheckFilter' | 'orgScopingEnabled' | 'tenancyPosture'> = {
      computeWriteTenantCheckFilter: (...a) => this.computeWriteTenantCheckFilter(...a),
      get orgScopingEnabled() { return readOrgScopingEnabled(); },
      get tenancyPosture() { return readTenancyPosture(); },
    };
    return organizationWallRefusal.call(host, permissionSets, object, operation, context, delegatorSets, delegatorContext);
  }

  /**
   * [#25062] Step 3.7's Layer 0 tenant write wall, composed ONCE for one write:
   * the scope pre-test, the parts every row is held to, and the judgements that
   * read them. This is the ONE spelling of the wall's judgement of a row. The
   * middleware's payload half and its stored-image seam (step 3.7) call it, and
   * so does the write preview ({@link writeWallVerdict}, which the engine asks
   * through `registerWriteWallVerdict`). Nothing here logs or throws: each
   * judgement answers a {@link WriteWallRefusal}, which the middleware logs and
   * throws ({@link raiseWriteWallRefusal}) and the preview answers as that
   * row's verdict.
   *
   * `writeRows` are the payload's rows as sent. They decide only whether the
   * parts are computed when no walled posture is in force. `singlePayload` says
   * whether an UPDATE's payload is one row: an array update installs no seam.
   * `principals` is the context prologue's answer
   * ({@link resolveOperationPrincipals}), and `refusal` the context's
   * `positions` and `permissions`, which every refusal's details carry.
   */
  private composeWriteTenantWall(
    object: string,
    operation: 'insert' | 'update',
    context: any,
    writeRows: readonly Record<string, unknown>[],
    singlePayload: boolean,
    principals: { permissionSets: PermissionSet[]; delegatorSets: PermissionSet[] | null; delegatorContext: any },
    refusal: { positions: unknown; permissionSets: unknown },
  ): Promise<WriteTenantWall> {
    // [#25223 cut 5] The body moved to `security-plugin-write-tenant-wall.ts` (see `WriteTenantWallHost`).
    const readOrgScopingEnabled = () => this.orgScopingEnabled;
    const readTenancyPosture = () => this.tenancyPosture;
    const host: Pick<WriteTenantWallHost, 'computeWriteTenantCheckFilter' | 'computeWriteTenantWall' | 'orgScopingEnabled' | 'organizationWallRefusal' | 'tenancyPosture'> = {
      computeWriteTenantCheckFilter: (...a) => this.computeWriteTenantCheckFilter(...a),
      computeWriteTenantWall: (...a) => this.computeWriteTenantWall(...a),
      get orgScopingEnabled() { return readOrgScopingEnabled(); },
      organizationWallRefusal: (...a) => this.organizationWallRefusal(...a),
      get tenancyPosture() { return readTenancyPosture(); },
    };
    return composeWriteTenantWall.call(host, object, operation, context, writeRows, singlePayload, principals, refusal);
  }

  /** [#25062] Step 3.7's way to refuse: the refusal's warn line, then its error. */
  private raiseWriteWallRefusal(refusal: WriteWallRefusal): never {
    this.logger.warn?.(refusal.warning);
    throw refusal.error;
  }

  /**
   * [#25062] The Layer 0 tenant write wall's verdict on each row of a write
   * PREVIEW, for `ObjectQL.validate()` (the import dry run). Registered on the
   * engine as `registerWriteWallVerdict`, beside the write-gate probe.
   *
   * The probe answers a CALLER CLASS with one boolean for the whole set
   * ({@link canWriteObject}); the wall judges a VALUE a row carries, so a
   * caller the probe admits can still name an organization the write refuses,
   * or one the write stores as sent while the preview reported it dropped.
   * Two questions, two members. This one answers per row, from
   * {@link composeWriteTenantWall}, the method step 3.7 itself calls, over the
   * principals the middleware's own prologue resolves
   * ({@link resolveOperationPrincipals}). A row is refused with the write's own
   * `PermissionDeniedError` code and message: the scope pre-test, then the
   * payload half (the forge guard, and on an update the emptied
   * organization), then the stored-image half's no-active-organization arms
   * ([#24784], [#24821]) as far as a row the preview holds shows them. A
   * refusal of a value the row carries names `organization_id`; a refusal of
   * the caller's state names `_record`. An admitted row says whether the wall
   * judges its organization, the value `judgesOrganization` is set from on
   * the write, so the engine spares the column from its static-`readonly`
   * strip exactly where `insert()` / `update()` spare it.
   *
   * Each row is judged as its own write, as the preview answers every other
   * refusal, and the engine keeps the set's `valid` the conjunction. A bulk
   * write is refused whole by any one refused row, so the two agree on the
   * set.
   *
   * `null` is "the wall is not asked here", and the engine then runs today's
   * strip: a system context (the middleware's bypass), a context that names no
   * user (step 3.7's own guard), and a caller the context prologue refuses.
   * The write refuses that caller before its wall is reached, so there is no
   * wall verdict to hand over; the preview runs none of the write's caller
   * gates, and it says nothing about this one either.
   *
   * The rows are the preview's: after the defaults, before any hook. An
   * organization a `beforeInsert` / `beforeUpdate` hook writes is judged by
   * the write's stored-image half alone — the preview's named limit.
   */
  writeWallVerdict(
    object: string,
    operation: 'insert' | 'update',
    context: any,
    rows: readonly Record<string, unknown>[],
  ): Promise<WriteWallRowVerdict[] | null> {
    // [#25223 cut 6] The body moved to `security-plugin-write-tenant-wall.ts` (see `WriteTenantWallHost`).
    const host: Pick<WriteTenantWallHost, 'composeWriteTenantWall' | 'resolveOperationPrincipals'> = {
      composeWriteTenantWall: (...a) => this.composeWriteTenantWall(...a),
      resolveOperationPrincipals: (...a) => this.resolveOperationPrincipals(...a),
    };
    return writeWallVerdict.call(host, object, operation, context, rows);
  }

  /**
   * Resolve a controlled_by_parent object's master-detail relation (the FK field
   * key + the master object name), or null. Cached.
   *
   * [ADR-0055 §1 · #23100, maintainer ruling B] The master is the object's ONE
   * `master_detail` field declared `required: true` that names a reference — and
   * nothing else. Zero such fields, or two or more, resolve `null`, which both
   * halves already treat as fail-closed: the read leg answers `RLS_DENY_FILTER`
   * and the write leg throws `MasterDetailRelationMissingError` (422
   * INVALID_METADATA). This used to be a three-tier fallback — a required
   * `master_detail`, else ANY `master_detail`, else a required `lookup`, the
   * first match by field order within a tier — and ADR-0055 §1 recorded only
   * the first tier. Ruling B retired the second and third (ADR-0049
   * enforce-or-remove; step-18 semantic migration
   * `cbp-master-relation-tiers-retired`) and refused two candidates rather than
   * picking one by declaration order. The same sentence is judged by
   * `ObjectSchema`'s parse (`refuseControlledByParentWithoutOneMaster`) and by
   * `os lint` (`cbpMasterCandidates` in
   * `packages/lint/src/validate-security-posture.ts`); this reader keeps its own
   * read of it because it reads the unparsed registry — the reference-spelling
   * tolerance below is why — and ⛔ it must not grow a fallback tier back: a
   * relation the parse refuses must not be one this gate derives access from.
   *
   * A `controlled_by_parent` object that resolves no relation is REPORTED, once
   * per object per cache generation ({@link SecurityPlugin.reportCbpMasterUnresolved}),
   * so a stored or raw-registered object that relied on a retired tier is not
   * denied in silence.
   *
   * [#8688] Also carries {@link CbpRelation.omissionRefusedByValidation} — the
   * one bit the insert leg's conditional stand-down turns on. It is resolved
   * HERE, from the same field def the relation itself came from, so the two can
   * never describe different fields.
   */
  private resolveCbpRelation(object: string): CbpRelation | null {
    // [#25223 cut 2] The body moved to `security-plugin-cbp-relation.ts` (see `CbpRelationHost`).
    const readCbpRelCache = () => this.cbpRelCache;
    const readQl = () => this.ql;
    const host: Pick<CbpRelationHost, 'cbpRelCache' | 'ql' | 'reportCbpMasterUnresolved' | 'reportRejectedReferenceAlias'> = {
      get cbpRelCache() { return readCbpRelCache(); },
      get ql() { return readQl(); },
      reportCbpMasterUnresolved: (...a) => this.reportCbpMasterUnresolved(...a),
      reportRejectedReferenceAlias: (...a) => this.reportRejectedReferenceAlias(...a),
    };
    return resolveCbpRelation.call(host, object);
  }

  /**
   * [ADR-0055 §1 · #23100] Report that a `controlled_by_parent` object resolved NO
   * master relation, so every read of it is denied and every write refused — and
   * say why, naming the retired tier the object relied on when that is the cause.
   *
   * The parse refuses the same shape (`ObjectSchema`, with the same prescription),
   * so an object reaching here unresolved came through a door that does not
   * parse — a raw `registerObject`, or a stored row the boot registered anyway
   * under its `[metadata_spec_invalid]` diagnostic. The read leg's denial is an
   * EMPTY result, indistinguishable from "no rows" to its caller, which is why
   * the reason is stated once here rather than left to be inferred.
   *
   * `warn`, not `error`, by the degradation-log-level question (AGENTS.md):
   * nothing claimed persisted is lost — the object is visibly unusable, every
   * write is refused to its caller with 422 INVALID_METADATA, and the denial is
   * the fail-closed answer, not a fall-back. Same granularity and channel as
   * {@link SecurityPlugin.reportRejectedReferenceAlias}: the only call site is
   * `resolveCbpRelation`'s resolution body, which runs on a `cbpRelCache` miss
   * alone, so it fires once per object and re-arms when metadata changes.
   */
  private reportCbpMasterUnresolved(
    object: string,
    entries: ReadonlyArray<readonly [string, any]>,
    requiredMasters: readonly string[],
  ): void {
    // [#25223 cut 2] The body moved to `security-plugin-cbp-relation.ts` (see `CbpRelationHost`).
    const readLogger = () => this.logger;
    const host: Pick<CbpRelationHost, 'logger'> = {
      get logger() { return readLogger(); },
    };
    reportCbpMasterUnresolved.call(host, object, entries, requiredMasters);
  }

  /**
   * Report that a `controlled_by_parent` master relation resolved ONLY because
   * {@link SecurityPlugin.resolveCbpRelation} still accepts a spelling
   * `@objectstack/spec` rejects (#11567) — the loud half of the deliberate
   * tolerance documented at that reader.
   *
   * ## Granularity: once per object, per cache generation — and that is the
   * ## cache's lifecycle rather than a second one invented here
   *
   * The only call site is inside `resolveCbpRelation`'s resolution body, which
   * runs ONLY on a `cbpRelCache` miss: every later read of the same object is
   * served from the cache and reports nothing. Two consequences, both of them
   * the reason this is the right granularity:
   *
   *   • ⛔ NOT per read. This sits under the RLS path, which runs per request
   *     per object — a per-read report would be a noise defect of its own, and
   *     a noisy channel is a channel operators filter out, which would make
   *     the tolerance silent again by a longer route.
   *   • It RE-ARMS on a metadata change, because `start()`'s
   *     `metadata.watch('*')` subscription clears `cbpRelCache` alongside the
   *     other metadata-derived caches. That is exactly when an author wants to
   *     hear it: they just edited the metadata (Studio / AI authoring), so the
   *     next resolution reports the verdict on what they changed instead of
   *     staying quiet because a process-lifetime "already warned" set had been
   *     ticked at boot. A hand-rolled set would have to reproduce this
   *     invalidation to stay correct, and would silently rot the day another
   *     cache-clearing door was added.
   *
   * ## Why this is not a duplicate of the registry's own diagnostic
   *
   * `SchemaRegistry.registerObject` already prints a functional-completeness
   * line for such a field — `field/relationship-without-reference`, "the
   * consumer silently skips each one, so it reads 0/null/never-resolves". For
   * THIS consumer that is measurably false: the relation resolves, and the
   * object is enforced normally. So the registry's line is not the report this
   * seam needs — it fires at registration rather than at resolution, and it
   * describes a behaviour that is not the one this reader has. Correcting the
   * record where the resolution actually happens is the point.
   *
   * Reported through `this.logger`, the plugin's own {@link SecurityReportSink}
   * — the same channel and the same `warn?.(…)` spelling as every other report
   * site here, so an un-injected host still hears it on the console-backed
   * default (#10556, maintainer ruling 2026-08-24). ⛔ No new channel: a
   * diagnostic surface invented for one message is a surface of its own.
   *
   * The text names the SPELLING as the defect and states that access is
   * unaffected, because both halves are load-bearing: an operator who reads
   * "rejected alias" and assumes something was denied would go looking for an
   * outage that did not happen.
   */
  private reportRejectedReferenceAlias(
    object: string,
    field: string,
    alias: string,
    master: string,
  ): void {
    // [#25223 cut 2] The body moved to `security-plugin-cbp-relation.ts` (see `CbpRelationHost`).
    const readLogger = () => this.logger;
    const host: Pick<CbpRelationHost, 'logger'> = {
      get logger() { return readLogger(); },
    };
    reportRejectedReferenceAlias.call(host, object, field, alias, master);
  }

  /**
   * ADR-0055 — master-detail "controlled by parent" READ derivation, answered
   * as the engine's `ReadableIds` leaf (ADR-0139 D6: `controlled_by_parent`
   * is the leaf's seventh consumer, in the end-state form).
   *
   * For an object whose `sharingModel` is `controlled_by_parent`, access is
   * derived from the master: the answer is `{ masterFK: { $in:
   * ReadableIds.of(master) } }` — "the ids of the master's records this
   * caller may read". The engine replaces the leaf at its executor boundary,
   * immediately before the driver call, with a scope it composes from THIS
   * service's own two halves of a read of the master, asked with the caller's
   * context exactly as it stands (`ObjectQL#composeReadableIdsAtBoundary`):
   *
   *   1. `canReadObject(master)` — the object-level read admission
   *      ({@link objectReadAdmission}); refused ⇒ `$in: []`, no detail is read;
   *   2. `getReadFilter(master)` — the master's row scope: its read RLS
   *      (tenant Layer 0 + policies), plugin-sharing's OWD / record-share
   *      visibility filter, and the master's OWN `controlled_by_parent`
   *      derivation, which is this method again and so another leaf — the
   *      chain composes recursively, one nested subquery per hop, inside the
   *      one statement the driver runs. The deny sentinel ⇒ `$in: []`.
   *
   * The driver compiles the composed leaf as `masterFK IN (SELECT id FROM
   * master WHERE scope AND tenant)` (ADR-0139 D3), so a detail read is one
   * statement whatever the master's cardinality: no master id list is
   * materialised, nothing is bound per master, and the dialect's variable
   * limit is never reached. Before this, the derivation pre-scanned the
   * master under a system context and bound every readable id into `$in` —
   * twice per request (find, then count), unbounded — so a child read answered
   * `DATABASE_ERROR` / 500 past ~32,800 masters (the dialect's bind limit), and
   * its CPU grew with the master table.
   *
   * [#5386] The master's scope is the SAME scope a direct find of the master
   * runs under, point for point: both halves above are the ones the engine
   * middleware chain ANDs into a direct read of the master, asked of the same
   * service, so the derived set cannot drift from the direct one. That
   * equality used to be re-established here by composing the halves by hand
   * (RLS, sharing, the master's own derivation) around a system-context scan;
   * it now follows from the engine asking this service's public doors.
   *
   * [ADR-0090 D10] A DELEGATED (on-behalf-of) caller is composed, not routed:
   * the engine asks both halves with the delegated context intact, and
   * `getReadFilter(master)` answers the ADR-0090 D10 intersection through
   * {@link computeDelegatedReadFilter} (ADR-0139 D5.1 as amended). The
   * middleware's delegator half writes the same leaf, so a delegated read
   * carries one subquery twice; correct rows, measured, left as it is.
   *
   * [ADR-0139 D1] The leaf is a READ scope and a write's predicate never
   * carries one: `null` for a write verb ({@link CBP_LEAF_READ_VERBS}). A
   * predicate write of a detail is narrowed to the rows the read door returns
   * for the caller's own predicate ({@link readableRowsScopeForPredicateWrite},
   * where this leaf composes) and judged per master by the 2.8 gate
   * ({@link assertControlledByParentWrite}, a verdict, never a scope).
   *
   * [ADR-0139 D5.2 / D5.3] The two master shapes the engine composes no leaf
   * over — a master on another datasource, a master an object-scoped read
   * middleware narrows — are refused at boot (`ObjectQLPlugin`, on
   * `kernel:bootstrapped`), so no up-front routing to a bounded list is made
   * here: every `controlled_by_parent` object answers the leaf.
   *
   * A misconfigured object (not exactly one required master_detail to derive
   * from, ADR-0055 §1) answers the deny sentinel by reference (the engine
   * answers `$in: []` for it when it is a master's scope; a direct read of the
   * object matches no row). Returns null when the object is not
   * controlled_by_parent, or when the caller is the system.
   *
   * [ADR-0055 amendment] The derivation COMPOSES ACROSS A CHAIN — a master
   * that is itself `controlled_by_parent` is scoped by ITS master, at every
   * level — and two guards bound the chain, both fail-CLOSED (`$in: []`, the
   * empty master set), never "no restriction", the direction that made the
   * unbounded form a security defect. Both are judged here over the REGISTRY
   * alone, before the leaf is written and before any store work
   * ({@link controlledByParentChainRefusal}), so the engine's own cycle and
   * depth refusals (`INTERNAL_ERROR` / 500, `READABLE_IDS_MAX_CHAIN_DEPTH`)
   * are never reached for a declared chain:
   *
   *   - **Cycle protection.** The walk carries the objects already on the
   *     chain and a chain that re-enters one (`A`'s master is `B`, `B`'s
   *     master is `A`, or an object mastered by itself) denies. Termination
   *     does not depend on the depth bound: the visited set is strictly
   *     growing over a finite schema registry.
   *   - **Depth bound** ({@link CBP_MAX_CHAIN_DEPTH}). A COST ceiling, not a
   *     semantic rule, and the engine's own cut — see the constant.
   */
  private computeControlledByParentFilter(
    object: string,
    /** The engine verb the answer is composed onto; a write verb answers `null` (ADR-0139 D1). */
    operation: string,
    context: any,
  ): Record<string, unknown> | null {
    // [#25223 cut 4] The body moved to `security-plugin-cbp-read-filter.ts` (see `CbpReadFilterHost`).
    const readLogger = () => this.logger;
    const readQl = () => this.ql;
    const host: Pick<CbpReadFilterHost, 'controlledByParentChainRefusal' | 'logger' | 'ql' | 'resolveCbpRelation'> = {
      controlledByParentChainRefusal: (...a) => this.controlledByParentChainRefusal(...a),
      get logger() { return readLogger(); },
      get ql() { return readQl(); },
      resolveCbpRelation: (...a) => this.resolveCbpRelation(...a),
    };
    return computeControlledByParentFilter.call(host, object, operation, context);
  }

  /**
   * [ADR-0055 amendment] Walk the `controlled_by_parent` chain above `object`
   * through the registry — no store work, no security call — and name the
   * first guard it trips: a cycle, or the depth bound. `null` when the chain
   * is one the engine composes whole.
   *
   * The walk follows exactly the chain the engine's composition will follow:
   * each master that is itself `controlled_by_parent` contributes another leaf
   * to its own read scope, so the chain is the run of derived masters, and it
   * ends at the first master that governs its own rows, at a master the
   * registry does not hold, or at a derived master with no resolvable
   * relation (whose own derivation answers the deny sentinel, which the engine
   * answers `$in: []` — closed, and no refusal). `chain` is the objects on the
   * branch outermost first, the re-entered or over-depth master last — what
   * the refusal log prints.
   *
   * The depth cut is the engine's: a chain of {@link CBP_MAX_CHAIN_DEPTH}
   * derived objects composes (the read's object and up to seven derived
   * masters above it), and the next derived master is refused — here as the
   * empty master set, in the engine as its loud refusal of the same chain,
   * which this walk therefore pre-empts.
   */
  private controlledByParentChainRefusal(
    object: string,
    rel: CbpRelation,
  ): { kind: 'cycle' | 'depth'; chain: string[] } | null {
    // [#25223 cut 4] The body moved to `security-plugin-cbp-read-filter.ts` (see `CbpReadFilterHost`).
    const readQl = () => this.ql;
    const host: Pick<CbpReadFilterHost, 'ql' | 'resolveCbpRelation'> = {
      get ql() { return readQl(); },
      resolveCbpRelation: (...a) => this.resolveCbpRelation(...a),
    };
    return controlledByParentChainRefusal.call(host, object, rel);
  }

  /**
   * The CONTEXT prologue of the engine middleware: a context the operation may
   * not run under is refused here, before any gate, and every other context is
   * resolved to the permission sets every gate below composes with — the
   * principal's, and on a delegated context the delegator's too.
   *
   * Two callers, one prologue: the middleware itself, for every operation, and
   * {@link checkControlledByParentWrite}, which must refuse and resolve a
   * context exactly as the by-id update it answers for does.
   *
   * - [#21908] ADR-0096 D5 strict mode. No position, no explicit permission set
   *   and no user id, on a context that is not a system one: REFUSED, for every
   *   verb, before anything resolves and before the operation runs. This used
   *   to be the hand-off (`return next()`, ADR-0096 E1): no CRUD gate, no RLS,
   *   no FLS mask and no tenant Layer 0. The middleware's earlier gates still
   *   run first and keep their own refusals; the object-admission probes and
   *   the row scope read the same predicate ({@link isPrincipalLessContext}).
   * - Permission sets resolve from BOTH role names and explicit permission set
   *   names attached to the execution context. The resolution (incl. the
   *   implicit + post-resolution baseline fallback) is shared with the public
   *   getReadFilter service via resolvePermissionSetsForContext — keeping the
   *   find-path RLS and the analytics raw-SQL RLS provably in lock-step. A
   *   resolution failure fails CLOSED: it must DENY the request, never bypass
   *   the checks (that would let a degraded metadata service expose every
   *   tenant's data). System/bootstrap operations short-circuit before this is
   *   asked (`context.isSystem`), so reaching that branch means an
   *   authenticated user request whose RBAC/RLS could not be resolved — deny it
   *   and alert.
   * - [ADR-0090 D10 — agent intersection] When this principal acts ON BEHALF OF
   *   a user (an AI agent or a service), its effective permission is the
   *   INTERSECTION of its own grants and the delegator's grants — never the
   *   union (confused-deputy prevention). The delegator's effective permission
   *   sets resolve ONCE here; every gate AND-composes the two lists so the
   *   tighter of the two wins at each axis (CRUD, capabilities, FLS, depth,
   *   row-level using/check, VAMA). The whole thing is gated on the presence of
   *   the delegation LINK (not the `principalKind` label — a service acting for
   *   a user is the identical risk): on the ordinary non-delegated path
   *   `delegatorSets` stays null, every combine reduces to today's expression,
   *   no extra `ql` read happens, and behaviour is byte-identical. A dangling
   *   link (delegator deleted) fails CLOSED — see resolveDelegatorContext for
   *   why "empty sets" would be wrong (the additive baseline would resurrect
   *   access for a non-existent user).
   * - [#25063 · ADR-0090 D10] A delegated operation runs in the LIVE principal's
   *   active organization, and the delegator context inherits that organization
   *   (`resolveDelegatorContext` hands the delegator the organization the
   *   operation runs in). On a walled posture that is a precondition, never an
   *   assumption: when the delegator's own membership does not back the live
   *   organization, the operation is REFUSED here, for every verb. Left to run,
   *   the delegator's leg could not bound it: the inherited organization feeds
   *   the delegator's own wall, and a new row is placed in the live one, so an
   *   on-behalf-of write could land outside every organization the delegator
   *   belongs to. The test is `vetOrganizationClaim`, the one spelling of "a
   *   membership backs this organization", which answers the claim unchanged
   *   under `single`, asked through `delegatedOrganizationRefusal` [#25107]:
   *   the one ask every reader of a resolved delegator shares, so the probes,
   *   the field projections, the read scope and the explanation answer this
   *   refusal where it is made. A context with no active organization is not
   *   this rule's: its answers stay with ADR-0123 D2.
   */
  private resolveOperationPrincipals(
    operation: string,
    object: string,
    context: any,
  ): Promise<{ permissionSets: PermissionSet[]; delegatorSets: PermissionSet[] | null; delegatorContext: any }> {
    // [#25223 cut 6] The body moved to `security-plugin-operation-principals.ts` (see `OperationPrincipalsHost`).
    const readLogger = () => this.logger;
    const readQl = () => this.ql;
    const readTenancyPosture = () => this.tenancyPosture;
    const host: Pick<OperationPrincipalsHost, 'logger' | 'ql' | 'refuseGuestWithoutOrganization' | 'resolvePermissionSetsForContext' | 'tenancyPosture'> = {
      get logger() { return readLogger(); },
      get ql() { return readQl(); },
      refuseGuestWithoutOrganization: (...a) => this.refuseGuestWithoutOrganization(...a),
      resolvePermissionSetsForContext: (...a) => this.resolvePermissionSetsForContext(...a),
      get tenancyPosture() { return readTenancyPosture(); },
    };
    return resolveOperationPrincipals.call(host, operation, object, context);
  }

  /**
   * [ADR-0138 D4] The located refusal: a GUEST that reaches a data operation
   * acting in no organization, on a deployment where the guest entry's
   * organization step refuses — a wall, several organizations, or none.
   *
   * Raised HERE, at the CRUD gate, because this is where the guest's
   * organization matters (D4 item 3: to resolve its grants and to scope its
   * data operation). The guest entry cannot raise it: the runtime face
   * assembles the guest envelope for every sessionless request before any
   * route is matched, so a refusal there would replace every anonymous 401 and
   * reach the flow door D4 leaves alone. The entry instead records nothing it
   * cannot use — no organization and no set (`resolveAuthzContext`) — and this
   * gate asks the SAME step (`resolveGuestOrganization`, one step, two askers)
   * for a guest that carries no organization. Before any set is resolved: where
   * D4 refuses, D3 is never reached (D3 item 7). And ahead of the prologue's
   * fail-closed `catch` on purpose: that net turns every throw of the set
   * resolution into a generic `PERMISSION_DENIED`, which is the disguise the
   * located refusal removes.
   *
   * A guest that carries an organization was derived one by the entry, and a
   * decision other than `refuse` (`derived`, or a composition with no
   * organization object) leaves the guest to the gate as it is — denied while
   * it holds no set (D3 item 2).
   */
  private refuseGuestWithoutOrganization(context: any, operation: string, object: string): Promise<void> {
    // [#25223 cut 6] The body moved to `security-plugin-operation-principals.ts` (see `OperationPrincipalsHost`).
    const readLogger = () => this.logger;
    const readQl = () => this.ql;
    const readTenancyPosture = () => this.tenancyPosture;
    const host: Pick<OperationPrincipalsHost, 'guestOrganizationRefusalWarned' | 'logger' | 'ql' | 'tenancyPosture'> = {
      guestOrganizationRefusalWarned: this.guestOrganizationRefusalWarned,
      get logger() { return readLogger(); },
      get ql() { return readQl(); },
      get tenancyPosture() { return readTenancyPosture(); },
    };
    return refuseGuestWithoutOrganization.call(host, context, operation, object);
  }

  /**
   * [ADR-0055] `ISecurityService.checkControlledByParentWrite` — what the
   * master-detail write check answers for a by-id UPDATE of `recordId` on
   * `object` by `context`, for a gate outside the write path (the
   * `sys_attachment` and `sys_comment` parent gates) that must judge a record as
   * its own update is judged.
   *
   * It is the write path's composition, run, never re-derived: the context is
   * refused or resolved by {@link resolveOperationPrincipals} (the middleware's
   * own prologue), and the check is {@link assertControlledByParentWrite}, run
   * for the principal's sets and then, on a delegated context, for the
   * delegator's — step 2.8's two calls, in step 2.8's order, so the first
   * refusal is the answer. Its outcome is read off what that check throws
   * ({@link controlledByParentWriteOutcomeOf}): a leg-tagged refusal is `deny`,
   * the three non-verdict errors are `unresolvable`, and anything else — a store
   * fault, a refusal of the context — rejects unchanged.
   *
   * Two places where it does not mirror step 2.8's GUARD, both deliberate:
   *
   * - `permissionSets.length > 0`. A principal whose sets resolve to none is
   *   judged over that empty list, as the contract declares (ADR-0056 D2): it
   *   holds no `update` grant on any master, so it answers `deny` on
   *   `object_permission`. On the write path the same principal never reaches
   *   step 2.8 because the object-level CRUD gate refuses it first.
   * - `!!context.userId`. A principal with positions or sets and no user id
   *   (the guest envelope) skips step 2.8 on the write path; here the check runs
   *   for it. Mirroring the guard would answer `allow` for a master nothing
   *   measured, which the contract's `allow` does not cover (it is a system
   *   context or every leg passing), and it would hand a REFUSING gate an
   *   abstention dressed as a pass. Not mirroring it cannot widen anything: the
   *   member's every non-`allow` outcome refuses, and the record's own update
   *   already refuses that principal at the object-level gate (guest bindings
   *   refuse `allowEdit`), so the parity of the overall answer holds.
   *
   * A system context answers `allow` (the write path's very first exit), and an
   * object that does not declare `controlled_by_parent` answers
   * `not_applicable` once the context has been admitted.
   */
  private checkControlledByParentWrite(
    object: string,
    recordId: string,
    context?: any,
  ): Promise<ControlledByParentWriteOutcome> {
    // [#25223 cut 3] The body moved to `security-plugin-cbp-write-gate.ts` (see `CbpWriteGateHost`).
    const host: Pick<CbpWriteGateHost, 'assertControlledByParentWrite' | 'declaresControlledByParent' | 'resolveOperationPrincipals'> = {
      assertControlledByParentWrite: (...a) => this.assertControlledByParentWrite(...a),
      declaresControlledByParent: (...a) => this.declaresControlledByParent(...a),
      resolveOperationPrincipals: (...a) => this.resolveOperationPrincipals(...a),
    };
    return checkControlledByParentWrite.call(host, object, recordId, context);
  }

  /**
   * ADR-0055 — master-detail "controlled by parent" WRITE enforcement.
   *
   * A by-id write (insert/update/delete) to a controlled_by_parent detail
   * requires EDIT access to its master: the caller must hold CRUD `update` on the
   * master object AND the master row must be reachable under BOTH halves of the
   * master's own record-level write gate —
   *
   *   1. the master's write RLS (`computeRlsFilter(master, 'update')`), and
   *   2. plugin-sharing's per-record edit gate (`resolveSharingCanEdit` →
   *      `canEdit`: ownership widened by write DEPTH, an `edit`-level
   *      `sys_record_share` grant, or the `modifyAllRecords` bypass).
   *
   * This is the write-side companion to the read derivation — the RLS read filter
   * never applies to a by-id write (the #1994 class), so without this a member
   * could mutate a detail under a master they cannot edit. Throws on denial;
   * no-op when the object is not controlled_by_parent.
   *
   * [#5386] Half 2 used to be missing, and half 1 is CONDITIONAL: a master with
   * no authored write RLS compiles to a null filter, which skipped the row check
   * entirely — so any holder of object-level `update` on the master could write
   * details under masters they could neither read nor edit. The sharing gate is
   * therefore asked UNCONDITIONALLY, not only when half 1 produced a filter.
   *
   * [commit 498f4e884] Half 1 composes the master's write RLS with the SAME ownership
   * authority the by-id write pre-image gate does — `resolveSharingWriteVerdict`
   * on the master row, and the platform ownership floor comes off on `allow`
   * (maintainer ruling 2026-08-15, direction 1). Before that, the floor stood
   * here and was dropped there, so the same principal was permitted to PATCH a
   * master by id and refused on its children: the #8679 divergence one leg over,
   * with the same resolution — one composition rather than two kept in agreement
   * by hand. It WIDENS who may write details: a principal whose sharing verdict
   * on the master is `allow` (ownership at write DEPTH, an `edit`-level
   * `sys_record_share`, `modifyAllRecords`) now reaches the master's children,
   * which is exactly the set that already reaches the master itself.
   *
   * [ADR-0055 amendment] The gate WALKS THE CHAIN. Its three legs used to run once, on the
   * immediate master, and every one of them passes vacuously when that master is
   * itself `controlled_by_parent`: it authors no write RLS, and the sharing leg
   * asks `canEdit`, which answers `abstain` for it — `effectiveSharingModel`
   * maps `controlled_by_parent` to `public`. ⛔ `abstain` is NOT `deny`, so
   * `canEdit` returned `true` for every master row and a detail two levels down
   * was writable org-wide. The legs now run on each hop until a master that
   * governs its own rows is reached, with the same cycle protection and depth
   * bound ({@link CBP_MAX_CHAIN_DEPTH}) the read derivation carries, and each
   * additional refusal is an authorization verdict in #7474's own envelope.
   * ⛔ Not a blanket refusal for chained declarations: the single-level case is
   * the loop's first iteration and its answer is byte-for-byte the old one.
   *
   * [#25012] EVERY write shape asks it. A write that addresses no single row —
   * the engine's predicate path, which `extractSingleId` cannot name a target
   * for — is judged per MASTER: the gate collects the masters of the detail
   * rows the caller's own predicate selects and the caller can read
   * ({@link controlledByParentPredicateWriteMasters}), and runs the same chain
   * walk on each ({@link assertControlledByParentChainEditable}). The first
   * refusal is the answer, in the by-id leg's own envelope, and nothing is
   * written. It is a VERDICT, never a scope: no master set is composed into the
   * write's predicate (ADR-0055 §2's master id set is the READ scope, and its
   * mechanism is decided on its own record), so a write that selects one such
   * row writes none of them. A write whose rows all sit under masters the caller
   * may edit lands exactly as before: the read scope, the platform ownership
   * floor and the detail's own write policy still decide which of them it
   * writes, and nothing here vouches the floor away.
   *
   * [#25044] …and on every shape it asks EVERY master the write involves, not
   * one of them. §3 reads a create's master from "the master id in the
   * incoming body"; on every other shape that id, when the body carries one,
   * is a master the write involves beside the one (on the predicate path, the
   * ones) its rows are stored under, so the same walk is asked of it too,
   * after the stored master's question, which is unchanged. The refusal is
   * the by-id leg's own envelope and nothing is written. An insert's master
   * already IS its body's and is asked once; a body naming a master already
   * asked is not asked again; and a predicate write that selects no row the
   * caller can read involves no master at all.
   *
   * [#25049] …a BATCH create's included. Its body is one record per row and
   * each row names its own master, so the same walk is asked of every master
   * the rows name — once per master, in row order — before anything is
   * written. The first refusal is the answer, in the by-id leg's own envelope,
   * and nothing is written. The empty-master branch then answers the batch
   * exactly as it did before, since it reads no master off an array: it
   * stands down where required-field validation judges each row that names
   * none, and refuses the batch whole otherwise.
   *
   * [#25049] And a write never EMPTIES the master reference. §1 derives a
   * detail's access from exactly one required master, so a row whose
   * reference an update sets to null has no master to derive it from, and no
   * principal's read can match it. That is the empty-master condition below,
   * met on an update's body, and it is answered the same way: handed to
   * required-field validation where validation judges the same field, and
   * refused `422` otherwise — after the stored masters' question, so a master
   * the caller may not edit is still the answer there.
   *
   * [#7474] SIX conditions refuse a write here, and they are NOT one verdict.
   * Three are genuine authorization answers (no object-level `update` on the
   * master, the master row outside the caller's write RLS, no `edit`-level
   * share grant) and answer `403 PERMISSION_DENIED` with the sentence above.
   * Three are not answers about access at all, and used to borrow that same
   * sentence — telling a caller they lacked access to a record when the truth
   * was a broken declaration, a deleted row, or a null FK, with a remedy
   * ("ask whoever owns the parent record") that could not fix any of them:
   *
   *   - `controlled_by_parent` with no `master_detail` relation → `422
   *     INVALID_METADATA` ({@link MasterDetailRelationMissingError})
   *   - the target row does not exist → `404 RECORD_NOT_FOUND`
   *     ({@link DetailRecordNotFoundError})
   *   - the detail's master reference is empty, or an update's body empties
   *     it → `422 MISSING_REQUIRED_FIELD` ({@link MasterReferenceMissingError})
   *
   * [#8688] The last of those three has since NARROWED, by the maintainer
   * ruling of 2026-08-15: on an `insert` whose master FK is absent, this gate
   * STANDS DOWN when required-field validation provably covers the same
   * omission (`master_detail` + `required: true`, not `readonly`/`system` —
   * {@link CbpRelation.omissionRefusedByValidation}), so the caller gets the
   * platform's ordinary `400 VALIDATION_FAILED` with `fields[]` instead. It
   * keeps answering `422` for the three shapes validation does not cover, and
   * for the stored-row shape on any other by-id write. See the branch itself.
   * An update whose body empties the reference is the insert shape's twin and
   * is answered by the same rule (#25049).
   *
   * [#25095] The first of them has a sibling, answered before any master is
   * asked: a relation whose one master reference is `readonly` or `system`
   * ({@link CbpRelation.masterNotWritable}) refuses every write that sets it,
   * every insert and every update whose body carries the key, `422
   * INVALID_METADATA` ({@link MasterReferenceNotWritableError}), with the
   * parse's own refusal of the declaration.
   *
   * [#7505] A seventh outcome is not a leg of this gate at all: if the store
   * cannot be read, the engine's own error propagates (typically
   * `ERR_DATASOURCE_UNAVAILABLE` → `503`) and this gate answers nothing. It
   * used to answer the 404 above, because the existence probe flattened a
   * fault into "absent" — the one thing an outage must never be reported as.
   */
  private assertControlledByParentWrite(
    permissionSets: PermissionSet[],
    object: string,
    operation: string,
    opCtx: any,
    context: any,
  ): Promise<void> {
    // [#25223 cut 3] The body moved to `security-plugin-cbp-write-gate.ts` (see `CbpWriteGateHost`).
    const host: Pick<CbpWriteGateHost, 'assertControlledByParentChainEditable' | 'controlledByParentPredicateWriteMasters' | 'declaresControlledByParent' | 'extractSingleId' | 'readRowById' | 'resolveCbpRelation'> = {
      assertControlledByParentChainEditable: (...a) => this.assertControlledByParentChainEditable(...a),
      controlledByParentPredicateWriteMasters: (...a) => this.controlledByParentPredicateWriteMasters(...a),
      declaresControlledByParent: (...a) => this.declaresControlledByParent(...a),
      extractSingleId: (...a) => this.extractSingleId(...a),
      readRowById: (...a) => this.readRowById(...a),
      resolveCbpRelation: (...a) => this.resolveCbpRelation(...a),
    };
    return assertControlledByParentWrite.call(host, permissionSets, object, operation, opCtx, context);
  }

  /**
   * [ADR-0055 amendment / #25012] The chain walk of
   * {@link assertControlledByParentWrite}: the three master-edit legs
   * ({@link assertMasterRowEditable}) run on ONE master row, then on that
   * master's own master, hop by hop, until a master that governs its own rows
   * is reached — with the cycle guard and the depth bound
   * ({@link CBP_MAX_CHAIN_DEPTH}), each failing closed.
   *
   * ⚠️ Extraction, not a rewrite — the body is the walk the gate ran inline,
   * moved verbatim so that the gate can run it once per master: once for an
   * insert or a by-id write, once for each master a predicate write selects
   * rows under ({@link controlledByParentPredicateWriteMasters}), once more
   * for a master the write's body names that is not among those (#25044), and
   * once for each master a batch create's rows name (#25049).
   * There must stay exactly one walk, for the reason
   * {@link assertMasterRowEditable} gives for its legs.
   *
   * `masterEditDenied` / `denyMasterEdit` are the gate's own refusal builders,
   * passed in rather than rebuilt so every refusal, at every hop and for every
   * write shape, names the CALLER's object and operation (#7474's envelope)
   * and records its leg ({@link MASTER_EDIT_DENIAL_LEG}).
   */
  private assertControlledByParentChainEditable(
    permissionSets: PermissionSet[],
    object: string,
    rel: CbpRelation,
    masterId: unknown,
    context: any,
    opCtx: any,
    masterEditDenied: (leg: ControlledByParentWriteDenialLeg, reason: string, recordId?: unknown) => PermissionDeniedError,
    denyMasterEdit: (leg: ControlledByParentWriteDenialLeg, reason: string, recordId?: unknown) => never,
  ): Promise<void> {
    // [#25223 cut 3] The body moved to `security-plugin-cbp-write-gate.ts` (see `CbpWriteGateHost`).
    const host: Pick<CbpWriteGateHost, 'assertMasterRowEditable' | 'declaresControlledByParent' | 'readRowById' | 'resolveCbpRelation'> = {
      assertMasterRowEditable: (...a) => this.assertMasterRowEditable(...a),
      declaresControlledByParent: (...a) => this.declaresControlledByParent(...a),
      readRowById: (...a) => this.readRowById(...a),
      resolveCbpRelation: (...a) => this.resolveCbpRelation(...a),
    };
    return assertControlledByParentChainEditable.call(host, permissionSets, object, rel, masterId, context, opCtx, masterEditDenied, denyMasterEdit);
  }

  /**
   * [#25012 / ADR-0055 §3] The masters a write that addresses no single row
   * would write details under — what {@link assertControlledByParentWrite}
   * judges on the engine's predicate path, one chain walk per master.
   *
   * WHICH ROWS. The detail rows the caller's own predicate selects AND the
   * caller can read, asked through the read door under the request's context —
   * the read question the write doors narrow a predicate write's matched set to
   * ({@link readableRowsScopeForPredicateWrite}), so every row that write can
   * reach is among them. They can be MORE than it writes: the write-class
   * scopes (the platform ownership floor, the detail's own write policy) still
   * leave some of them unwritten, and a row among them under a master the
   * caller may not edit refuses the write all the same. The caller named that
   * row and can read it, and its master too (the detail's read scope is the
   * readable-master set), so the refusal discloses nothing the read door does
   * not. A row the caller cannot read is never judged: it is not matched.
   *
   * Three outcomes:
   *
   *  - the distinct master ids of those rows — an empty list when the predicate
   *    selects no row the caller can read, and nothing is refused;
   *  - ABOVE {@link PREDICATE_WRITE_READABLE_ID_CAP} rows, the refusal the read
   *    narrowing answers for the same count ({@link predicateWriteReadableCapError}):
   *    masters of rows that were never enumerated cannot be judged;
   *  - the read door's own refusal, PROPAGATED as raised — a declared 4xx (the
   *    detail's read grant withheld, a predicate the read guard or the driver
   *    refuses) or a store fault. ⛔ Never read as "no rows": a write whose rows
   *    cannot be enumerated cannot have their masters judged, and admitting it
   *    would be the unjudged write this leg exists to close.
   *
   * Each row's master reference is then read as SYSTEM, as the by-id leg reads
   * its one target row's: only the reference's value is needed, and a field
   * rule hiding it from the caller must not hide the master from this gate. A
   * row whose reference is empty answers the by-id leg's stored-row refusal
   * ({@link MasterReferenceMissingError}, `422`).
   */
  private controlledByParentPredicateWriteMasters(
    object: string,
    operation: string,
    rel: CbpRelation,
    opCtx: any,
  ): Promise<unknown[]> {
    // [#25223 cut 3] The body moved to `security-plugin-cbp-write-gate.ts` (see `CbpWriteGateHost`).
    const readQl = () => this.ql;
    const host: Pick<CbpWriteGateHost, 'ql'> = {
      get ql() { return readQl(); },
    };
    return controlledByParentPredicateWriteMasters.call(host, object, operation, rel, opCtx);
  }

  /**
   * [#5386 / commit 498f4e884 / #8679] The three legs that decide whether ONE principal may
   * EDIT ONE master row — extracted verbatim from
   * {@link SecurityPlugin.assertControlledByParentWrite} so that the ADR-0055 amendment's
   * chain walk can run them on every hop instead of only the first.
   *
   * ⚠️ Extraction, not a rewrite: the parameter is the `CbpRelation` itself, so
   * the body still reads `rel.master` and the diff is a re-indentation. That is
   * deliberate — this is a permission composition, and the failure mode this
   * whole family produces is a SECOND copy of one that drifts from the first.
   * There must stay exactly one.
   *
   * `denyMasterEdit` is passed in rather than rebuilt so every refusal, at every
   * hop, keeps naming the CALLER's object and operation (#7474's envelope).
   */
  private assertMasterRowEditable(
    permissionSets: PermissionSet[],
    rel: CbpRelation,
    masterId: unknown,
    context: any,
    opCtx: any,
    denyMasterEdit: (leg: ControlledByParentWriteDenialLeg, reason: string, recordId?: unknown) => never,
  ): Promise<void> {
    // [#25223 cut 3] The body moved to `security-plugin-cbp-write-gate.ts` (see `CbpWriteGateHost`).
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const readQl = () => this.ql;
    const host: Pick<CbpWriteGateHost, 'checkAuthoredRowWrite' | 'collectRLSPolicies' | 'computeRlsFilter' | 'declaresControlledByParent' | 'delegatorOwnWriteFloorOptions' | 'getObjectSecurityMeta' | 'permissionEvaluator' | 'ql' | 'resolveSharingCanEdit' | 'resolveSharingWriteVerdict'> = {
      checkAuthoredRowWrite: (...a) => this.checkAuthoredRowWrite(...a),
      collectRLSPolicies: (...a) => this.collectRLSPolicies(...a),
      computeRlsFilter: (...a) => this.computeRlsFilter(...a),
      declaresControlledByParent: (...a) => this.declaresControlledByParent(...a),
      delegatorOwnWriteFloorOptions: (...a) => this.delegatorOwnWriteFloorOptions(...a),
      getObjectSecurityMeta: (...a) => this.getObjectSecurityMeta(...a),
      get permissionEvaluator() { return readPermissionEvaluator(); },
      get ql() { return readQl(); },
      resolveSharingCanEdit: (...a) => this.resolveSharingCanEdit(...a),
      resolveSharingWriteVerdict: (...a) => this.resolveSharingWriteVerdict(...a),
    };
    return assertMasterRowEditable.call(host, permissionSets, rel, masterId, context, opCtx, denyMasterEdit);
  }

  /**
   * The row-level security policies that apply to `objectName` for
   * `operation`: the one collection every reader composes from — the read
   * door's Layer 1, the by-id pre-image gate, the bulk write filter, the
   * post-image check, `checkAuthoredRowWrite` and explain.
   *
   * [#24164 ruling E′, item 2] When no held set carries a row policy for this
   * object and operation, the object's declared default row scope
   * (`ObjectSchema.defaultRowScope`) applies in its place:
   *  - "carries" is this collection's own emptiness, after the ADR-0105 D3
   *    admission, `enabled`, the `positions` domain and `'*'` matching, so a
   *    held `'*'` policy counts and a held policy for another operation does
   *    not (`object-default-row-scope.ts` states the reading);
   *  - an authored set policy is used as authored: the default is never added
   *    to a non-empty collection;
   *  - the default takes the path a held policy takes from the admission on,
   *    so its `using` / `check` compile, and fail closed, exactly as an
   *    authored policy's do;
   *  - a superuser-bypass principal never reaches this method (the bypass is
   *    decided by the caller, before the collection), and an object that
   *    declares no default collects exactly what it collected before;
   *  - [ruling 6278784335 on #24341, letter B] a delegated principal's own
   *    leg ({@link isDelegatedPrincipalLeg} on `principal`, the context the
   *    collection is for) never collects the default: its sets are a
   *    capability ceiling carrying no row policy (ADR-0090 D10), and its row
   *    bound is the delegator's leg, which collects the default as any
   *    principal's does.
   */
  private collectRLSPolicies(
    permissionSets: PermissionSet[],
    objectName: string,
    operation: string,
    heldPositions: string[] | undefined,
    principal: unknown,
  ): RowLevelSecurityPolicy[] {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const readQl = () => this.ql;
    const readRlsCompiler = () => this.rlsCompiler;
    const host: Pick<ObjectInputsHost, 'admitCollectedPolicy' | 'ownershipFloorAlternates' | 'ql' | 'rlsCompiler'> = {
      admitCollectedPolicy: (...a) => this.admitCollectedPolicy(...a),
      ownershipFloorAlternates: this.ownershipFloorAlternates,
      get ql() { return readQl(); },
      get rlsCompiler() { return readRlsCompiler(); },
    };
    return collectRLSPolicies.call(host, permissionSets, objectName, operation, heldPositions, principal);
  }

  /**
   * [ADR-0105 D3] Whether one policy enters the collection under this
   * deployment's tenancy posture. When org isolation is NOT active, the tenant
   * policies the PLATFORM itself ships are stripped — there is no meaningful
   * active organization to compare against, so they would match zero rows (or
   * be dropped by the field-existence safety net) for no benefit.
   *
   * Provenance, not pattern-matching (finding F1): the former substring test
   * on `current_user.organization_id` also swallowed app-authored policies,
   * silently unenforcing a declared security property. An authored policy now
   * always reaches the compiler and fails closed there, where the operator can
   * see it.
   *
   * An object's default row scope passes the same test, so a default that
   * spells a shipped tenant policy is stripped exactly as that policy's set
   * copy is (the provenance key is `(object, name, using)`).
   */
  private admitCollectedPolicy(policy: RowLevelSecurityPolicy, objectName: string): boolean {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const readOrgScopingEnabled = () => this.orgScopingEnabled;
    const host: Pick<ObjectInputsHost, 'orgScopingEnabled' | 'warnAuthoredTenantPolicyOnce'> = {
      get orgScopingEnabled() { return readOrgScopingEnabled(); },
      warnAuthoredTenantPolicyOnce: (...a) => this.warnAuthoredTenantPolicyOnce(...a),
    };
    return admitCollectedPolicy.call(host, policy, objectName);
  }

  /**
   * [ADR-0105 D3] Explain, once per policy, why an app-authored tenant-scoped
   * policy will match zero rows: it references the active organization but this
   * deployment has no org isolation, so `current_user.organization_id` resolves
   * to nothing and the policy fails closed at compile time. The policy is NOT
   * dropped — a declared security property stays declared (ADR-0049); this is
   * the operator-visible half of that contract.
   */
  private warnAuthoredTenantPolicyOnce(
    policy: RowLevelSecurityPolicy,
    objectName: string,
  ): void {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const readLogger = () => this.logger;
    const host: Pick<ObjectInputsHost, 'logger' | 'warnedAuthoredTenantPolicies'> = {
      get logger() { return readLogger(); },
      warnedAuthoredTenantPolicies: this.warnedAuthoredTenantPolicies,
    };
    warnAuthoredTenantPolicyOnce.call(host, policy, objectName);
  }

  /**
   * [ADR-0066 D2/D3] Resolve and cache the object's security posture: whether it
   * is `private` (access.default), platform-global (tenancy disabled), and its
   * `requiredPermissions` capability contract. Prefers the live ObjectQL schema
   * (reflects registry-time augmentation) and falls back to the metadata service.
   *
   * [#3545] When NEITHER source resolves the object, the returned values are
   * defaults rather than declarations, and it is flagged `unresolved: true`. The
   * defaults are NOT safe to make an access decision from — each is the
   * permissive end of its axis — so callers that gate access must fail closed on
   * the flag instead of consuming the defaults. Only positive resolutions are
   * cached, so a transient boot miss is retried on the next call.
   */
  private async getObjectSecurityMeta(
    object: string,
  ): Promise<ObjectSecurityMeta> {
    const cached = this.objectSecurityMetaCache.get(object);
    if (cached) return cached;
    let obj: any = typeof this.ql?.getSchema === 'function' ? this.ql.getSchema(object) : null;
    if (!obj) {
      try { obj = await this.metadata?.get?.('object', object); } catch { obj = null; }
    }
    // [ADR-0066 D3] Per-field capability requirements: { fieldName -> capability[] }.
    const fieldRequiredPermissions: Record<string, string[]> = {};
    // [#8993] Per-field partial-masking rules: { fieldName -> FieldMaskingRule }.
    const fieldMaskingRules: Record<string, FieldMaskingRule> = {};
    const collectMaskingRule = (fname: string, fdef: any) => {
      const raw = fdef?.maskingRule;
      if (raw === undefined || raw === null) return;
      const parsed = FieldMaskingRuleSchema.safeParse(raw);
      if (parsed.success) {
        fieldMaskingRules[fname] = parsed.data;
      } else {
        // Fail CLOSED: a declared-but-unparseable masking rule degrades to a
        // FULL mask, never to the unmasked value. (The spec parse rejects such
        // declarations at authoring; this covers rows that arrived around it.)
        this.logger?.warn?.(
          `[security] field '${object}.${fname}' declares an invalid maskingRule — ` +
            `applying a full mask (fail-closed). Fix the declaration to a preset ` +
            `('phone' | 'id_card' | 'bank_account' | 'email' | 'name') or {keepHead, keepTail}.`,
          { object, field: fname },
        );
        fieldMaskingRules[fname] = { keepHead: 0, keepTail: 0 };
      }
    };
    const fields: any = (obj as any)?.fields;
    if (Array.isArray(fields)) {
      for (const f of fields) {
        if (f?.name && Array.isArray(f.requiredPermissions) && f.requiredPermissions.length > 0) {
          fieldRequiredPermissions[String(f.name)] = f.requiredPermissions.map(String);
        }
        if (f?.name) collectMaskingRule(String(f.name), f);
      }
    } else if (fields && typeof fields === 'object') {
      for (const [fname, fdef] of Object.entries(fields)) {
        const rp = (fdef as any)?.requiredPermissions;
        if (Array.isArray(rp) && rp.length > 0) fieldRequiredPermissions[fname] = rp.map(String);
        collectMaskingRule(fname, fdef);
      }
    }
    const meta = {
      isPrivate: (obj as any)?.access?.default === 'private',
      // The object's own two clauses, and nothing else. This meta is the single
      // source every Layer 0 consumer reads (the read wall and the Layer 1
      // wildcard-`organization_id` drop via the 'tenancyDisabled' merge in
      // computeLayeredRlsFilter; the ADR-0123 D2 write refusal and the forge
      // guard via computeWriteTenantCheckFilter, which IS that same layer0; the
      // platform-admin `posturePermits` gate and the write-check bypass via
      // `meta.tenancyDisabled` directly).
      //
      // [ADR-0131 D7] The deployment's #12699 `platformGlobalObjects`
      // declaration used to fold in here as a third clause — a Layer 0
      // stand-down on an object that still carried its organization column, so
      // the driver went on scoping what the wall had stopped scoping. That
      // stand-down is retired, not kept beside its replacement: the
      // declaration is now the injected-columns plan's input, and the engine's
      // registry registers a declared object with no `organization_id` and
      // declaring `systemFields.tenant: false` — the second clause below, read
      // off the live schema like every other object's.
      tenancyDisabled:
        (obj as any)?.tenancy?.enabled === false ||
        (obj as any)?.systemFields?.tenant === false,
      // Identity-infrastructure tables managed by the auth library
      // (`managedBy: 'better-auth'`: sys_user, sys_account, sys_session,
      // sys_oauth_application, sys_sso_provider, …). Their rows are written by
      // better-auth's own adapter with no tenant context, so `organization_id`
      // is never stamped (and most such tables have no such column at all).
      // [ADR-0095 D1] `posturePermitsCrossTenant` uses this flag so a platform
      // admin's Layer 0 exemption lets `viewAllRecords` see all identity rows
      // env-wide. This does NOT relax member scoping (members never satisfy the
      // exemption; their `_self` carve-outs are their Layer 1 scoping, and Layer
      // 0 stays inert on a column-less table), so it can never leak to non-admins.
      isBetterAuthManaged: (obj as any)?.managedBy === 'better-auth',
      // [#7835] Federated object carrying the registry's INJECTED
      // `organization_id` — a column the platform provisions no storage for.
      tenantAnchorIsPhantom: hasPhantomTenantAnchor(obj),
      // [#8023] The author's DECLARED OWD, not the effective sharing bucket.
      owdOpensRowWrites: owdDeclaresOpenRowWrites(obj),
      requiredPermissions: normalizeRequiredPermissions((obj as any)?.requiredPermissions),
      fieldRequiredPermissions,
      fieldMaskingRules,
      unresolved: !obj,
      // [#10401 / #10424] Explanation only, and only on the path that is already
      // refusing. All causes deny identically — see the field's TSDoc.
      ...(obj ? {} : { unresolvedCause: await this.resolveUnresolvedCause(object) }),
    };
    if (obj) this.objectSecurityMetaCache.set(object, meta);
    return meta;
  }

  /**
   * [#10424] Which condition put this object on the unresolved path — the
   * EXPLANATION only. Order matters, and it is the honest order rather than the
   * cheap one.
   *
   * The outage probe runs FIRST and wins outright. When the metadata service
   * reports its own read as degraded, "a draft declaration exists but no
   * published one" is a claim we cannot support: the draft probe can still see
   * a draft row through ObjectQL while the metadata store is exactly the thing
   * that could not tell us whether a PUBLISHED one exists. Asserting
   * `'unpublished_draft'` there would state as fact the half of the sentence
   * the outage made unknowable — the same species of error as the defect this
   * fixes, pointed the other way.
   *
   * Every leg that cannot reach a positive verdict lands on `'unknown'`, whose
   * wording covers all cases.
   */
  private resolveUnresolvedCause(object: string): Promise<UnresolvedPostureCause> {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const host: Pick<ObjectInputsHost, 'probeMetadataOutage' | 'probeUnpublishedDraft'> = {
      probeMetadataOutage: (...a) => this.probeMetadataOutage(...a),
      probeUnpublishedDraft: (...a) => this.probeUnpublishedDraft(...a),
    };
    return resolveUnresolvedCause.call(host, object);
  }

  /**
   * [#10424 / #5840] Best-effort: did the metadata read fail because the STORE
   * could not answer, rather than because nothing is declared?
   *
   * `IMetadataService.get` is ambiguous by construction — its own TSDoc says
   * `undefined` means "not found" *and* "every loader that could hold it
   * failed", and directs callers to `getDiagnosed` "wherever the difference
   * could change a decision". `MetadataManager` defines `get` as
   * `(await getDiagnosed(…)).data`, so the verdict is computed and discarded on
   * the way here. This asks for it.
   *
   * ## Why this is a SEPARATE probe and not the read itself
   *
   * The obvious shape — swap `metadata.get` for `metadata.getDiagnosed` and use
   * `.data` — was rejected deliberately. `obj` is what `unresolved` is computed
   * from, so it is the input to a #3545 fail-closed DENY: changing which member
   * produces it puts an externally observable accept/reject decision at the
   * mercy of every third-party `IMetadataService` whose optional `getDiagnosed`
   * disagrees with its own `get`, or throws where `get` would have succeeded.
   * An object that resolves today would then be refused. This card is an
   * explanation change and has to stay one, so the resolving read is untouched
   * byte for byte and the verdict is asked for separately, on the path that is
   * already refusing.
   *
   * The cost is one extra read, paid only on a request that is already denied —
   * the same bargain `probeUnpublishedDraft` documents, beside which this sits.
   *
   * ## The fail-safe direction, which is the whole point
   *
   * `getDiagnosed` is OPTIONAL (`getDiagnosed?`), and the contract is explicit
   * that "implementations that predate it simply cannot report the distinction,
   * and a consumer that probes for it must keep reading `get` when it is
   * absent". So a service without it returns `false` here and the caller
   * reports `'unknown'` — NOT `'metadata_unavailable'`. Publishing "I don't
   * know" as "the store is down" would manufacture an incident out of a missing
   * capability, and the operator would go read healthy dashboards looking for
   * an outage that the platform invented. Same for a `getDiagnosed` that throws
   * or answers with a non-boolean `degraded`: no verdict is not a verdict.
   * `'metadata_unavailable'` is asserted on a positive `degraded === true` and
   * on nothing else.
   *
   * Like the draft probe, this can never turn a resolved posture into a denial
   * nor a refusal into a grant — it is read after the deny decision is made.
   */
  private probeMetadataOutage(object: string): Promise<boolean> {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const readMetadata = () => this.metadata;
    const host: Pick<ObjectInputsHost, 'metadata'> = {
      get metadata() { return readMetadata(); },
    };
    return probeMetadataOutage.call(host, object);
  }

  /**
   * [#10401] Best-effort: is this unresolvable object simply an UNPUBLISHED
   * draft?
   *
   * `sys_metadata` keys a pending edit as `state: 'draft'` and the published
   * value as `state: 'active'`; an object that exists only as a draft therefore
   * resolves from neither the live ObjectQL schema nor the metadata service (both
   * serve published values), which is precisely how it lands on the #3545
   * fail-closed branch wearing the same sentence as a genuinely missing
   * declaration.
   *
   * Four properties this probe deliberately has:
   *
   * - **It runs ONLY on the unresolved path**, i.e. on a request that is already
   *   being refused. `getObjectSecurityMeta` returns before reaching here on
   *   every posture that resolves, so no authorized request pays for it. On the
   *   refusal path it is one indexed `sys_metadata` lookup beside the
   *   `metadata.get` that path already performs.
   * - **It uses a SYSTEM context**, so the read short-circuits this very
   *   middleware at its `isSystem` guard rather than re-entering the posture
   *   resolution it is being called from.
   * - **It fails SAFE, in one direction only.** Any failure — no `sys_metadata`
   *   in this deployment (file-backed metadata, LiteKernel test kernels), an
   *   unprovisioned store, a driver error — answers `'unknown'` and the caller
   *   gets the wording that covers both conditions. It can never turn a resolved
   *   posture into a denial, and it can never turn a refusal into a grant: it is
   *   read after the deny decision is already made.
   * - **It is not org-scoped, and the wording is written so it does not need to
   *   be.** A draft row belonging to another organization would still make
   *   "a draft declaration exists but no published one" a true statement about
   *   this runtime, which is all the message claims.
   */
  private probeUnpublishedDraft(object: string): Promise<UnresolvedPostureCause> {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const readQl = () => this.ql;
    const host: Pick<ObjectInputsHost, 'ql'> = {
      get ql() { return readQl(); },
    };
    return probeUnpublishedDraft.call(host, object);
  }

  /**
   * [ADR-0066 D3] Fold per-field `requiredPermissions` into a FieldPermission map.
   * A field whose declared capabilities are NOT all held by the caller is forced
   * non-readable + non-editable (AND-gate, strictest-wins over permission-set
   * field grants) so the existing FieldMasker masks it on read and denies it on
   * write. Returns the base map unchanged when no field declares requirements.
   */
  /**
   * [#8993] Which of the object's declared `maskingRule`s apply to THIS
   * caller — the partial masks the FieldMasker must serve. One rule decides
   * it, riding the SAME evaluation ADR-0066 D3 already performs: a field's
   * rule applies unless the field also declares `requiredPermissions` and the
   * caller holds ALL of them (on an on-behalf-of read, the delegator too —
   * the D10 intersection: the tighter principal wins). A field with a rule
   * and no `requiredPermissions` is masked for every non-system caller —
   * declare = enforce from the first read; the unmask gate is opt-in.
   *
   * Deliberately NOT consulted here: permission-set field grants. A set that
   * marks the field non-readable must keep DELETING it (a masking rule never
   * widens an explicit deny) — call sites exclude those fields against the
   * base evaluator map they already hold, where that map exists.
   */
  private computePartialMaskRules(
    secMeta: { fieldMaskingRules: Record<string, FieldMaskingRule>; fieldRequiredPermissions: Record<string, string[]> },
    permissionSets: PermissionSet[],
    delegatorSets: PermissionSet[] | null,
  ): Record<string, FieldMaskingRule> {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const host: Pick<ObjectInputsHost, 'permissionEvaluator'> = {
      get permissionEvaluator() { return readPermissionEvaluator(); },
    };
    return computePartialMaskRules.call(host, secMeta, permissionSets, delegatorSets);
  }

  /**
   * [#8993 / #20935] The engine's ONE answer to "may this caller filter, sort,
   * group or aggregate by this field of `objectName`?" — a field map in which
   * every field the caller may NOT query on reads `readable: false`.
   *
   * The field map the read mask starts from (the evaluator's grants, the
   * ADR-0066 D3 `requiredPermissions` AND-gate, and on an on-behalf-of request
   * the ADR-0090 D10 intersection with the delegator's map: a field readable
   * only by the agent is not queryable on the delegator's behalf), with every
   * field whose masking rule applies to this caller
   * ({@link computePartialMaskRules}) folded in as non-queryable. A partially
   * masked field is SERVED — its key stays, its value is replaced — yet it is
   * as probe-able as a hidden one: an equality filter reconstructs the masked
   * span one probe at a time (row presence is the oracle), sorting orders by
   * the very characters the mask hides, and a group key or an aggregate hands
   * back the unmasked value outright. No explicit-deny exclusion applies here,
   * unlike the read path's {@link computeReadPartialMaskRules}: masked and
   * hidden fields answer a query probe identically (refuse).
   *
   * Three readers, one derivation, so they cannot drift apart: the predicate
   * guard (step 2.9), the aggregate-input guard (step 2.5b) and
   * {@link getQueryableFields}, the published answer a door that compiles its
   * own statement asks instead of re-deriving masking.
   */
  private computeQueryGuardFieldPerms(
    objectName: string,
    secMeta: Pick<ObjectSecurityMeta, 'fieldMaskingRules' | 'fieldRequiredPermissions'>,
    permissionSets: PermissionSet[],
    delegatorSets: PermissionSet[] | null,
  ): Record<string, { readable: boolean; editable: boolean }> {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const host: Pick<ObjectInputsHost, 'computePartialMaskRules' | 'foldFieldRequiredPermissions' | 'permissionEvaluator'> = {
      computePartialMaskRules: (...a) => this.computePartialMaskRules(...a),
      foldFieldRequiredPermissions: (...a) => this.foldFieldRequiredPermissions(...a),
      get permissionEvaluator() { return readPermissionEvaluator(); },
    };
    return computeQueryGuardFieldPerms.call(host, objectName, secMeta, permissionSets, delegatorSets);
  }

  /**
   * [#21063] The step 2.5 field-level-security WRITE gate's verdict: the fields
   * a payload names that this caller may NOT write on `objectName`, sorted (an
   * empty list admits). The evaluator's field grants with the ADR-0066 D3
   * `requiredPermissions` AND-gate folded in from `secMeta` — the posture the
   * caller's gates read ({@link resolveCallerPosture}) — and on an on-behalf-of
   * request the ADR-0090 D10 intersection with the delegator's map.
   *
   * Two readers, one derivation: the engine middleware's step 2.5, which
   * throws on a non-empty answer, and {@link canWriteObject}'s field arm, which
   * denies on one. {@link getWritableFields} is their complement over the same
   * posture and the same fold ({@link resolveProjectionFieldMask}).
   */
  private computeForbiddenFieldWrites(
    objectName: string,
    data: Record<string, any> | Record<string, any>[],
    secMeta: Pick<ObjectSecurityMeta, 'fieldRequiredPermissions'>,
    permissionSets: PermissionSet[],
    delegatorSets: PermissionSet[] | null,
  ): string[] {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const readFieldMasker = () => this.fieldMasker;
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const host: Pick<ObjectInputsHost, 'fieldMasker' | 'foldFieldRequiredPermissions' | 'permissionEvaluator'> = {
      get fieldMasker() { return readFieldMasker(); },
      foldFieldRequiredPermissions: (...a) => this.foldFieldRequiredPermissions(...a),
      get permissionEvaluator() { return readPermissionEvaluator(); },
    };
    return computeForbiddenFieldWrites.call(host, objectName, data, secMeta, permissionSets, delegatorSets);
  }

  /**
   * [#8993 / #9127] The READ path's EFFECTIVE partial-mask set: the caller's
   * applicable rules ({@link computePartialMaskRules}) MINUS every field an
   * explicit permission-set grant marks non-readable.
   *
   * That subtraction is the second half of the enforcement semantics and it is
   * NOT expressible from the folded mask: `foldFieldRequiredPermissions` forces
   * `readable: false` on exactly the capability-gated fields a masking rule is
   * meant to cover, so the exclusion must consult the RAW evaluator maps
   * (`basePerms` / `delBasePerms`) — a rule never widens an explicit deny,
   * while a capability gate it does soften into a partial mask.
   *
   * It lives here, in one place, because THREE surfaces have to agree on it —
   * result masking (step 4), the readable-field projection
   * ({@link getReadableFields}) and the explain engine's `fls` layer (#9127).
   * The explain surface's own module contract promises it "matches enforcement
   * by construction"; a second, independent derivation of this composition is
   * precisely how that promise was broken once already, so explain calls THIS
   * method through its injected dep instead of re-deriving the shape.
   */
  private computeReadPartialMaskRules(
    secMeta: { fieldMaskingRules: Record<string, FieldMaskingRule>; fieldRequiredPermissions: Record<string, string[]> },
    permissionSets: PermissionSet[],
    delegatorSets: PermissionSet[] | null,
    basePerms: Record<string, { readable?: boolean; editable?: boolean }>,
    delBasePerms: Record<string, { readable?: boolean; editable?: boolean }> | null,
  ): Record<string, FieldMaskingRule> {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const host: Pick<ObjectInputsHost, 'computePartialMaskRules'> = {
      computePartialMaskRules: (...a) => this.computePartialMaskRules(...a),
    };
    return computeReadPartialMaskRules.call(host, secMeta, permissionSets, delegatorSets, basePerms, delBasePerms);
  }

  /**
   * Step 4 of the engine middleware — the RESULT masker: mask the fields this
   * caller may not read in the records an operation returns (reads, and the
   * record a write echoes back), deleting a field the caller's field map
   * denies and serving a field whose masking rule applies masked
   * ({@link computeReadPartialMaskRules}).
   *
   * [#21062] ONE masker, two readers: the middleware's step 4, for the caller
   * it resolved, and the ADR-0056 public-form grant branch, for the caller the
   * grant stands in for. The grant passes before the gates and used to return
   * before this ran, so the record it echoed to an anonymous submitter carried
   * every masked field as stored. ⛔ Never a second derivation of masking for
   * either reader: both hand their resolved sets, posture and delegator here.
   */
  private maskOperationResult(
    opCtx: any,
    permissionSets: PermissionSet[],
    secMeta: ObjectSecurityMeta,
    delegatorSets: PermissionSet[] | null,
  ): void {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const readFieldMasker = () => this.fieldMasker;
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const host: Pick<ObjectInputsHost, 'computeReadPartialMaskRules' | 'fieldMasker' | 'foldFieldRequiredPermissions' | 'permissionEvaluator'> = {
      computeReadPartialMaskRules: (...a) => this.computeReadPartialMaskRules(...a),
      get fieldMasker() { return readFieldMasker(); },
      foldFieldRequiredPermissions: (...a) => this.foldFieldRequiredPermissions(...a),
      get permissionEvaluator() { return readPermissionEvaluator(); },
    };
    maskOperationResult.call(host, opCtx, permissionSets, secMeta, delegatorSets);
  }

  private foldFieldRequiredPermissions(
    baseFieldPerms: Record<string, { readable: boolean; editable: boolean }>,
    fieldRequiredPermissions: Record<string, string[]>,
    permissionSets: PermissionSet[],
  ): Record<string, { readable: boolean; editable: boolean }> {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const readPermissionEvaluator = () => this.permissionEvaluator;
    const host: Pick<ObjectInputsHost, 'permissionEvaluator'> = {
      get permissionEvaluator() { return readPermissionEvaluator(); },
    };
    return foldFieldRequiredPermissions.call(host, baseFieldPerms, fieldRequiredPermissions, permissionSets);
  }

  /**
   * Resolve the column-name set for an object (lowercased). Returns
   * `null` if the schema can't be loaded — caller should fail-closed.
   */
  private getObjectFieldNames(
    metadata: any,
    objectName: string,
    ql?: any,
  ): Promise<Set<string> | null> {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const host: Pick<ObjectInputsHost, 'fieldNamesCache' | 'loadObjectFieldNames'> = {
      fieldNamesCache: this.fieldNamesCache,
      loadObjectFieldNames: (...a) => this.loadObjectFieldNames(...a),
    };
    return getObjectFieldNames.call(host, metadata, objectName, ql);
  }

  /**
   * [#20355] The object's declared columns as the write check's evaluator reads
   * them — each field's `type` and `multiple` — from the sources
   * {@link loadObjectFieldNames} reads, in its order: ObjectQL's live
   * SchemaRegistry first, then the metadata service.
   *
   * `undefined` when neither answers with a field map: the evaluator then
   * judges values only, exactly as it did before it could judge declarations —
   * a schema that cannot be loaded must not manufacture refusals (the field
   * guard's rule in `rls-compiler.ts`, `RlsFieldGuard`). A field without a string `type` is
   * left out, so it is never judged.
   *
   * [#20604] What the declaration says about each column is
   * {@link declaredComparisonColumns}, the one reading `security/explain`
   * hands the same matcher, so the two judges of one policy read one
   * declaration one way.
   */
  private writeCheckFieldOptions(object: string): Promise<MatchesFilterOptions | undefined> {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const readMetadata = () => this.metadata;
    const readQl = () => this.ql;
    const host: Pick<ObjectInputsHost, 'metadata' | 'ql'> = {
      get metadata() { return readMetadata(); },
      get ql() { return readQl(); },
    };
    return writeCheckFieldOptions.call(host, object);
  }

  private loadObjectFieldNames(
    metadata: any,
    objectName: string,
    ql?: any,
  ): Promise<Set<string> | null> {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    const host: Pick<ObjectInputsHost, 'datetimeFieldNamesCache' | 'numberComparandFieldsCache' | 'tenancyDisabledCache'> = {
      datetimeFieldNamesCache: this.datetimeFieldNamesCache,
      numberComparandFieldsCache: this.numberComparandFieldsCache,
      tenancyDisabledCache: this.tenancyDisabledCache,
    };
    return loadObjectFieldNames.call(host, metadata, objectName, ql);
  }

  /**
   * Extract the left-hand field name from a simple RLS expression like
   * `field = current_user.x` or `field IN (current_user.y)`. Returns
   * `null` for unsupported shapes.
   *
   * ⚠️ [#17042] What a `null` MEANS here changed, and the change is the whole
   * point: this is no longer the field-existence net, it is the ADR-0095 delta
   * c carve-out's instrument. `null` still means "this policy is not the
   * leading-`organization_id` shape the carve-out is about", so the caller
   * keeps it — but the policy is now judged for column existence a second time
   * inside `RLSCompiler.compileFilter`, on the COMPILED tree, where position
   * and polarity have been normalised away. ⛔ Do not widen this regex to
   * recognise `!=` / `!` / `not in`: a shape match that must enumerate every
   * spelling of negation is the same "recognises only what it was told about"
   * defect the compiler-side pass exists to end, and widening it here would
   * ALSO turn the carve-out into a denial for the tenancy-disabled case it
   * deliberately skips.
   */
  private extractTargetField(using?: string): string | null {
    // [#25223 cut 1] The body moved to `security-plugin-object-inputs.ts` (see `ObjectInputsHost`).
    return extractTargetField(using);
  }
}
