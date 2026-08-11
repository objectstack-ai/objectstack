// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext, POSTURE_LADDER } from '@objectstack/core';
import type { PermissionSet, RowLevelSecurityPolicy } from '@objectstack/spec/security';
import { describeHighPrivilegeBits, describeAnchorForbiddenBits, PUBLIC_FORM_SERVER_MANAGED_FIELDS } from '@objectstack/spec/security';
import { MCP_AGENT_PERMISSION_SET_RESTRICTED } from '@objectstack/spec/ai';
// [#7414] The SHARED operation-message catalog #7307 built for the data path's
// operation-level refusals. Second consumer, same mechanism — a second remedy
// for one defect class is what that module exists to prevent.
import { renderOperationMessage } from '@objectstack/spec/system';
import { PermissionEvaluator, crudBucketForOperation } from './permission-evaluator.js';
import { composeHumanBaselinePermissionSets, PLATFORM_BASELINE_PERMISSION_SET } from './app-default-permission-set.js';
import { DelegatedAdminGate } from './delegated-admin-gate.js';
import {
  INVITATION_PLACEMENT_SERVICE,
  createInvitationPlacementService,
} from './invitation-placement.js';
import {
  explainAccess,
  buildContextForUser,
  resolveDelegatorContext,
  intersectFieldMasks,
} from './explain-engine.js';
import type { ExplainDecision, ExplainOperation } from '@objectstack/spec/security';
import type { II18nService, IMetadataService, IObjectQLEngine } from '@objectstack/spec/contracts';

import { bootstrapDeclaredPositions } from './bootstrap-declared-positions.js';
import { bootstrapDeclaredPermissions, upsertPackagePermissionSet, readDeclared } from './bootstrap-declared-permissions.js';
import { applyManagedWriteDenies } from './managed-object-write-denies.js';
import {
  createPermissionSetWriteThrough,
  registerPermissionSetProjection,
  reconcilePermissionSetProjection,
} from './permission-set-projection.js';
import { registerObjectPostureGate } from './object-posture-gate.js';
import {
  syncAudienceBindingSuggestions,
  listAudienceBindingSuggestions,
  confirmAudienceBindingSuggestion,
  dismissAudienceBindingSuggestion,
  type SuggestionDeps,
  type SuggestionListFilter,
} from './suggested-audience-bindings.js';
import { cleanupPackagePermissions } from './cleanup-package-permissions.js';
import { bootstrapBuiltinRoles } from './bootstrap-builtin-positions.js';
import { bootstrapSystemCapabilities } from './bootstrap-system-capabilities.js';
import { normalizeManagedByVocab } from './normalize-managed-by.js';
import { bootstrapDeclaredCapabilities } from './bootstrap-declared-capabilities.js';
import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';
import { computeTenantLayer0Filter, andComposeLayers } from './tenant-layer.js';
import { isPlatformTenantPolicy, isAuthoredTenantPolicy } from './platform-tenant-policies.js';
import { isPlatformOwnershipFloorPolicy } from './platform-ownership-policies.js';
import {
  normalizeTenancyPosture,
  postureEnforcesWall,
  type TenancyPosture,
} from '@objectstack/spec/security';
import {
  RLS_MEMBERSHIP_RESOLVER_SERVICE,
  RESERVED_RLS_MEMBERSHIP_KEYS,
  type IRlsMembershipResolver,
  type ISecurityService,
  type SharingWriteVerdict,
  type AuthoredRowWriteVerdict,
  type AuthoredRowWriteOperation,
} from '@objectstack/spec/contracts';
import { matchesFilterCondition } from '@objectstack/formula';
import { FieldMasker } from './field-masker.js';
import { assertReadableQueryFields } from './predicate-guard.js';
import {
  PermissionDeniedError,
  MasterDetailRelationMissingError,
  DetailRecordNotFoundError,
  MasterReferenceMissingError,
} from './errors.js';
import { assertEngineOwnedWriteAllowed, type EngineOwnedSchemaLike } from './system-write-guard.js';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
import {
  backfillOrgAdminGrants,
  extractMemberPairs,
  reconcileOrgAdminGrant,
} from './auto-org-admin-grant.js';
import { SysPositionDetailPage } from '@objectstack/platform-objects/pages';
import {
  securityObjects,
  securityDefaultPermissionSets,
  securityPluginManifestHeader,
} from './manifest.js';

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
function isCarriedPosture(v: unknown): boolean {
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
  requiredPermissions: NormalizedRequiredPermissions;
  fieldRequiredPermissions: Record<string, string[]>;
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
}

const EMPTY_REQUIRED_PERMISSIONS: NormalizedRequiredPermissions = Object.freeze({
  all: [], read: [], create: [], update: [], delete: [],
}) as NormalizedRequiredPermissions;

/**
 * [#5492] Knobs on the layered RLS computation. Exactly one today, and it is a
 * COMPOSITION instruction rather than a policy switch: the caller has already
 * consulted the authority that owns the write-widening mechanisms and is telling
 * this layer whose answer wins.
 */
interface RlsFilterOptions {
  /**
   * Drop the PLATFORM's own row-level write ownership floor
   * (`owner_only_writes` / `owner_only_deletes` — see
   * `platform-ownership-policies.ts`) from Layer 1.
   *
   * Set ONLY by the by-id write pre-image gate, and only when
   * `ISharingService.checkEdit` / `checkDelete` answered `allow` — a positive
   * basis (ownership at write DEPTH, an `edit`-level `sys_record_share`, or the
   * `modifyAllRecords` bypass). `abstain` and `deny` both leave it in place, so
   * a row record sharing does not enforce on keeps the floor as its only
   * row-level write gate.
   *
   * Never affects Layer 0 (the tenant wall) or any app-authored policy.
   */
  dropPlatformOwnershipFloor?: boolean;
}

/**
 * [ADR-0066 / #2918] Provenance spec for the platform/application asset objects
 * whose managed rows are write-protected by {@link SecurityPlugin.assertSystemRowWriteGate}.
 *
 * Both objects share the unified A4 (#2920) `managed_by` vocabulary — a row
 * authored by the platform or an application package is not the admin's to
 * delete or rewrite:
 *   • `platform` / `package` are managed; `admin`/∅ (tenant-authored) rows are
 *     the admin's.
 *   • sys_position additionally keeps its LEGACY values `system` (→ platform)
 *     and `config` (→ package) in the managed map: the boot normalizer
 *     (normalize-managed-by.ts) heals stored rows to the canonical vocabulary,
 *     but rows written before the normalizer runs — or in a store it has not
 *     touched yet — must not lose protection in the interim. Dropping the
 *     legacy keys here is what silently disarmed this gate for sys_position
 *     after the A4 rename (#2926 ①).
 * The map value for each managed `managed_by` is the human owner label used in
 * the (business-message-only) deny text.
 */
/**
 * [#7281] The scope `checkAuthoredRowWrite`'s probe read runs under.
 *
 * The method asks ONE question — "does the declared, app-authored widener admit
 * this row for this operation?" — and that question is about the row and the
 * declaration, never about what the CALLER may see. Resolving it under the
 * caller's own context folded a READ decision into a WRITE question: on a
 * `private`-OWD object `plugin-sharing`'s read filter scopes every re-read to
 * owner-match OR shares, so a cross-owner row was invisible to the probe and
 * the verdict was `abstain` for a row the declaration names by predicate. The
 * by-id widener surface was therefore structurally dead on `private` — the
 * posture #5493 built it for (maintainer ruling, 2026-08-10: reading 2).
 *
 * Elevating the READ does not widen the ANSWER, because the predicate carries
 * the whole of the question and travels in the `where`, not in the scope:
 * `{ id } AND layer0(tenant wall) AND layer1(app-authored policies)`. Both
 * layers are computed from the CALLER's permission sets and the CALLER's
 * tenant BEFORE the read (see {@link SecurityPlugin.checkAuthoredRowWrite}), so
 * a row in another tenant, a row no authored policy matches, and a caller
 * holding no authored policy at all are all still `abstain` — measured, not
 * asserted (`authored-row-write-verdict.test.ts`, and the real-stack pin
 * `packages/qa/dogfood/test/authored-row-write-scope.dogfood.test.ts`).
 *
 * Principal-less on purpose: it carries no `userId`, so nothing downstream can
 * mistake it for the caller acting with more authority than they hold. It is
 * SPREAD at the single call site rather than passed by reference, so no
 * middleware can stamp state onto a shared object.
 */
const AUTHORED_ROW_WRITE_PROBE_CONTEXT = { isSystem: true, positions: [], permissions: [] } as const;

const SYSTEM_ROW_PROVENANCE: Record<
  string,
  { noun: string; pluralNoun: string; managed: Record<string, string> }
> = {
  sys_position: {
    noun: 'position',
    pluralNoun: 'positions',
    managed: {
      platform: 'the platform',
      package: 'an application package',
      // Legacy pre-A4 values — keep guarded until every store is normalized.
      system: 'the platform',
      config: 'an application package',
    },
  },
  sys_capability: {
    noun: 'capability',
    pluralNoun: 'capabilities',
    managed: { platform: 'the platform', package: 'an application package' },
  },
};

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
function requiredCapsForOperation(
  spec: NormalizedRequiredPermissions,
  operation: string,
): string[] {
  const bucket = crudBucketForOperation(operation);
  const caps = bucket ? [...spec.all, ...spec[bucket]] : spec.all;
  return caps.length > 0 ? [...new Set(caps)] : [];
}

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
 * [#7414] The END USER's half of an object-permission refusal.
 *
 * Both transports put a 403's `Error.message` on the wire as the body's
 * human-readable string — `@objectstack/rest`'s `mapDataError` as `body.error`,
 * the runtime dispatcher as `error.message` — and Console renders that verbatim
 * in a toast. The CRUD gate composed it English-only with the object's API name
 * and the caller's `positions` concatenated in, so an operator in a fully
 * localized app read a sentence naming a table they have never seen and an
 * authorization vocabulary that reads as a contradiction to someone who does
 * hold rights on the record they clicked. On a cascade delete it is worse
 * still: `cascadeDeleteRelations` re-authorises every CHILD independently, so
 * the object named is one the operator never addressed.
 *
 * Rendered through the SHARED operation-message catalog #7307 built
 * (`@objectstack/spec/system`), not a second mechanism: same `errors.<key>`
 * override address, same resolution ladder (deployment override → locale
 * catalog → `en` → the key), same guarantee that a misbehaving i18n service
 * cannot turn a 403 into a 500.
 *
 * The i18n service is optional and resolved per call: it is registered by a
 * different plugin, may register after this one, and a deployment that runs
 * without it still gets the built-in catalog in the caller's locale.
 *
 * [#7451] `messageKey` is a PARAMETER rather than the hard-coded
 * `permission_denied` it started as, because the end-user gates of this
 * middleware refuse for three different reasons and a user in one of them can
 * do something different from a user in another (catalog table: their grants do
 * not cover the action / they may not touch THIS record / they may not put it
 * into THAT state). One wire code, several sentences, is the rule #7307 set
 * with `delete_restricted` and `delete_restricted_required`; the unit is the
 * situation, never the code.
 */
function userFacingDenialMessage(
  ctx: PluginContext,
  messageKey: 'permission_denied' | 'record_access_denied' | 'record_change_not_allowed',
  locale: string | undefined,
): string {
  let translate:
    | ((key: string, loc: string, params?: Record<string, unknown>) => string)
    | undefined;
  try {
    const i18n = ctx.getService<II18nService>('i18n');
    const t = i18n?.t;
    if (typeof t === 'function') {
      translate = (key, loc, params) => t.call(i18n, key, loc, params);
    }
  } catch {
    // i18n is optional (ADR-0029 D8 registers it from another plugin, possibly
    // later than this one). The built-in catalog still renders the caller's
    // locale without it.
  }
  return renderOperationMessage({ messageKey }, { locale, translate });
}

export class SecurityPlugin implements Plugin {
  name = 'com.objectstack.security';
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['security.permissions', 'security.rls', 'security.fieldMasker', 'security.bootstrapPermissionSets', 'security.fallbackPermissionSet', 'security.baselinePermissionSets'];
  type = 'standard';
  version = '1.0.0';
  dependencies = ['com.objectstack.engine.objectql'];

  private permissionEvaluator = new PermissionEvaluator();
  private rlsCompiler = new RLSCompiler();
  private fieldMasker = new FieldMasker();
  private readonly bootstrapPermissionSets: PermissionSet[];
  private readonly fallbackPermissionSet: string | null;
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
  private cbpRelCache = new Map<string, { fk: string; master: string } | null>();
  /**
   * [ADR-0066 D2/D3] Per-object security posture cache: `private` flag
   * (access.default), platform-global flag (tenancy disabled), and the object's
   * `requiredPermissions` capability contract. Populated lazily from the schema;
   * cleared on metadata change alongside the other schema-derived caches.
   */
  private readonly objectSecurityMetaCache = new Map<string, ObjectSecurityMeta>();
  private dbLoader?: (names: string[]) => Promise<PermissionSet[]>;
  private logger: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void; error?: (...a: any[]) => void } = {};

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

    ctx.getService<{ register(m: any): void }>('manifest').register({
      ...securityPluginManifestHeader,
      objects: securityObjects,
      // [ADR-0090] SDUI detail page for sys_position — Holders (assignments,
      // name-keyed junction) + Permission Sets (bindings) as pure
      // record:related_list declarations; no bespoke UI.
      pages: [SysPositionDetailPage],
      // Permission sets ride along on the manifest so the metadata service
      // can resolve them by name when SecurityPlugin middleware queries
      // `metadata.list('permissions')`.
      permissions: this.bootstrapPermissionSets,
      // ADR-0029 D7 — contribute the RBAC entries into the Setup app's
      // `group_access_control` slot. This plugin owns these objects (K2), so it
      // ships their menu too; when the plugin is absent the entries don't appear.
      navigationContributions: [
        {
          app: 'setup',
          group: 'group_access_control',
          priority: 100,
          items: [
            { id: 'nav_positions', type: 'object', label: 'Positions', objectName: 'sys_position', icon: 'shield-check' },
            { id: 'nav_capabilities', type: 'object', label: 'Capabilities', objectName: 'sys_capability', icon: 'badge-check' },
            { id: 'nav_permission_sets', type: 'object', label: 'Permission Sets', objectName: 'sys_permission_set', icon: 'lock' },
          ],
        },
      ],
    });

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

    ctx.logger.info('Security Plugin initialized', {
      defaultPermissionSets: this.bootstrapPermissionSets.map((p) => p.name),
    });
  }

  async start(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Starting Security Plugin...');

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
    this.logger = ctx.logger;
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
        this.tenancyDisabledCache.clear();
        this.cbpRelCache.clear();
        this.objectSecurityMetaCache.clear();
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
    }

    if (this.orgScopingEnabled) {
      ctx.logger.info(
        `[security] tenancy posture '${this.tenancyPosture}' — the Layer 0 organization wall is ACTIVE ` +
          `(${this.tenancyPosture === 'group'
            ? 'organization_id IN accessible_org_ids — union access across the caller\'s memberships'
            : 'organization_id = active organization'})`,
      );
    } else {
      ctx.logger.info(
        "[security] tenancy posture 'single' — Layer 0 is inert; the platform's own tenant-scoped RLS policies are stripped (app-authored ones are retained and fail closed, ADR-0105 D3)",
      );
    }

    // Construct a dbLoader once that lets resolvePermissionSets
    // surface user-defined permission sets from `sys_permission_set`
    // (created via the admin UI) in addition to plugin-registered
    // ones. Uses `isSystem` to bypass tenant RLS.
    const dbLoader = ql
      ? async (names: string[]) => {
          let rows: any;
          try {
            rows = await ql.find(
              'sys_permission_set',
              { where: { name: { $in: names } }, limit: names.length },
              { context: { isSystem: true } },
            );
          } catch {
            rows = [];
          }
          const list = Array.isArray(rows) ? rows : rows?.records ?? [];
          const parseJson = (v: any, fallback: any) => {
            if (typeof v !== 'string') return v ?? fallback;
            try { return JSON.parse(v || JSON.stringify(fallback)); } catch { return fallback; }
          };
          return list.map((r: any) => ({
            name: r.name,
            label: r.label,
            objects: parseJson(r.object_permissions, {}),
            fields: parseJson(r.field_permissions, {}),
            systemPermissions: parseJson(r.system_permissions, []),
            // [#7616] Hydrate the tab column too. Nothing on the DATA plane
            // reads `tabPermissions` (the evaluator never mentions it), so this
            // is inert for enforcement — but `resolvePermissionSetsForContext`
            // is published on the `security` service as returning the sets
            // WHOLE, and a loader that dropped this column would make that
            // declaration false for every DB-authored set: the UI-plane copy in
            // `/me/apps` reads exactly `tab_permissions` off the same row.
            // Declared ≠ delivered is the failure this contract exists to
            // prevent, so the column is loaded where the promise is made. The
            // row is already fetched in full — no extra query, one JSON parse.
            tabPermissions: parseJson(r.tab_permissions, {}),
            // [ADR-0090 D12] Hydrate the delegated-admin scope so the gate can
            // resolve a DB-authored delegate's authority. Null column → absent.
            ...(r.admin_scope ? { adminScope: parseJson(r.admin_scope, undefined) } : {}),
          }));
        }
      : undefined;
    this.dbLoader = dbLoader;

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
    try {
      // [ADR-0090 D5/D9] Suggested audience bindings — shared deps for the
      // list/confirm/dismiss surface (same set resolution as the middleware
      // and the delegated-admin gate, so admin-ness can never drift).
      const suggestionDeps: SuggestionDeps = {
        ql,
        metadata,
        resolveSets: (context: any) => this.resolvePermissionSetsForContext(context),
        logger: ctx.logger,
      };
      // Typed against the published contract so the registered surface cannot
      // drift from what cross-package consumers are promised: a renamed method,
      // a dropped one, or a changed return type fails THIS build rather than
      // silently degrading a consumer's feature detection at runtime.
      const securityService: ISecurityService = {
        getReadFilter: (object: string, context?: any) => this.getReadFilter(object, context),
        // [#3547] Readable-field projection for a context — the authoritative
        // column set for a read-derived export (`export ⊆ list`, #3391).
        // Same field mask as the read middleware (no drift). The REST export
        // route uses it to project columns instead of inferring readability
        // from already-masked data rows. See getReadableFields.
        getReadableFields: (object: string, context?: any) => this.getReadableFields(object, context),
        // [#3544] User-level export axis. `export ⊆ list`, so a bulk export
        // reaches the middleware as a plain `find` and `allowExport` would never
        // be consulted — the REST export route asks HERE before it streams.
        canExport: (object: string, context?: any) => this.canExport(object, context),
        // [ADR-0111 D2] Super-user WRITE bypass probe — the management-authority
        // primitive behind `ISharingService.canManageShares`. Explicit
        // `modifyAllRecords` only (NOT the effective write scope, whose
        // unmatched-object case fails open to 'org'); fails CLOSED on
        // resolution errors, principal-less contexts, and on-behalf-of
        // contexts (no D10 delegator intersection on this path).
        hasWriteBypass: async (object: string, context?: any): Promise<boolean> => {
          if (context?.isSystem) return true;
          if (!context?.userId) return false;
          if (context?.onBehalfOf?.userId) return false;
          try {
            const meta = await this.getObjectSecurityMeta(object);
            const sets = await this.resolvePermissionSetsForContext(context);
            return this.permissionEvaluator.hasSuperuserWriteBypass(object, sets, { isPrivate: meta.isPrivate });
          } catch (e) {
            this.logger.warn?.(
              `[security] hasWriteBypass failed for object '${object}' (user ${context?.userId ?? 'unknown'}) — denying (fail-closed)`,
              e instanceof Error ? e : new Error(String(e)),
            );
            return false;
          }
        },
        // [ADR-0111 D1 DEPTH] Effective WRITE scope — the DEPTH primitive behind
        // canManageShares' hierarchy-manager branch. Same evaluator the CRUD
        // write path uses; fails CLOSED to 'own' on error / principal-less /
        // on-behalf-of. Returns 'org' for system and for Modify-All holders —
        // AND for the fail-open unmatched-object case, which is why the sharing
        // gate treats 'org' from here as non-authoritative on its own.
        resolveWriteScope: async (object: string, context?: any): Promise<'own' | 'own_and_reports' | 'unit' | 'unit_and_below' | 'org'> => {
          if (context?.isSystem) return 'org';
          if (!context?.userId || context?.onBehalfOf?.userId) return 'own';
          try {
            const meta = await this.getObjectSecurityMeta(object);
            const sets = await this.resolvePermissionSetsForContext(context);
            return this.permissionEvaluator.getEffectiveScope('write', object, sets, { isPrivate: meta.isPrivate });
          } catch (e) {
            this.logger.warn?.(
              `[security] resolveWriteScope failed for object '${object}' (user ${context?.userId ?? 'unknown'}) — narrowing to 'own' (fail-closed)`,
              e instanceof Error ? e : new Error(String(e)),
            );
            return 'own';
          }
        },
        // [#5493 / ADR-0105 D3] Authored-row-write evidence: does an
        // APP-AUTHORED (non-floor) RLS policy admit this row for this write,
        // with the platform's `created_by` ownership floor taken out by
        // provenance? The composed RLS answer cannot stand in for it — the
        // floor admits every row's CREATOR, so a caller deferring to "composed
        // RLS admits" hands transferred records back to their former creators
        // (#5493 probe E-A). Verdict-shaped and fail-closed to `abstain`; see
        // the method for why a null Layer 1 is an abstention.
        checkAuthoredRowWrite: (
          object: string,
          recordId: string,
          operation: AuthoredRowWriteOperation,
          context?: any,
        ) => this.checkAuthoredRowWrite(object, recordId, operation, context),
        // [ADR-0046 §6.7] Effective permission-set NAMES for a caller — the
        // primitive the REST read layer needs to evaluate a permission-set-
        // gated book/doc audience ({ permissionSet: '…' }). Same resolution
        // as the middleware (positions expanded, additive baseline), so the
        // docs gate can never drift from data-plane enforcement. Throws on
        // resolution failure — callers must fail CLOSED (ADR-0049).
        resolvePermissionSetNames: async (context?: any): Promise<string[]> => {
          const sets = await this.resolvePermissionSetsForContext(context);
          return sets.map((s) => s.name);
        },
        // [#7616] The same resolution, returned WHOLE — `objects`, `fields`,
        // `systemPermissions`, `tabPermissions`, in resolution order. The names
        // above answer an AUDIENCE question; a consumer that must MERGE the
        // caller's grants (the object/field map `/auth/me/permissions` serves,
        // the capability + tab surface `/me/apps` filters its app list with)
        // cannot reach any of those four columns from a name, so both endpoints
        // re-implement this resolution locally instead — one rule in three
        // copies, which has already drifted from the enforcement path three
        // times (#7608, #7555, #6334), each divergence found only after it
        // reached a user.
        //
        // Exposed HERE, on the registered literal, and not merely as a public
        // class member: `plugin-hono-server` must never take a runtime
        // dependency on this plugin (it is optional in the stacks those
        // endpoints serve — the `!evaluator` degraded branches are exactly its
        // absence), so the service locator is the only seam that can carry the
        // delegation. A method the class declares but the literal does not
        // expose is unreachable across that seam, which is the precise failure
        // this addition exists to prevent.
        //
        // The class method stays private on purpose: this literal is the
        // supported surface, and routing every cross-package caller through it
        // is what keeps the published contract and the enforcement path the
        // same code rather than two that agree today.
        resolvePermissionSetsForContext: (context?: any): Promise<PermissionSet[]> =>
          this.resolvePermissionSetsForContext(context),
        // [ADR-0090 D6] First-class access explanation. Same code paths as
        // the middleware (resolution/evaluator/RLS compiler) — explained by
        // construction. Explaining ANOTHER user requires `manage_users`.
        explain: (request, callerContext?: any) =>
          this.explainAccessForCaller(
            { ...request, operation: String(request.operation) },
            callerContext,
          ),
        // [ADR-0090 D12 / ADR-0105 D8] What the CALLER may delegate — the read
        // half of the delegated-admin gate. A scoped-invitation form narrows
        // its unit/position pickers with this instead of listing the whole
        // tree and letting the user discover the boundary by refusal. Purely
        // self-scoped (the caller's own resolved sets are the only input), so
        // it discloses nothing beyond the authority they already hold.
        describeDelegableScope: async (callerContext?: any) => {
          const sets = await this.resolvePermissionSetsForContext(callerContext);
          // No gate wired (degraded start) → no delegable authority, and the
          // consumer renders an empty picker rather than a permissive one.
          if (!this.delegatedAdminGate) {
            return {
              isTenantAdmin: false,
              scopes: [],
              placeableBusinessUnitIds: [],
              assignablePositions: [],
            };
          }
          return this.delegatedAdminGate.describeDelegableScope(sets);
        },
        // [ADR-0090 D5/D9] Install-time suggestion surface: packages suggest
        // audience-anchor bindings; a tenant admin confirms (the binding is
        // written under the anchor + delegated-admin gates) or dismisses.
        listAudienceBindingSuggestions: (callerContext?: any, filter?: SuggestionListFilter) =>
          listAudienceBindingSuggestions(suggestionDeps, callerContext, filter),
        confirmAudienceBindingSuggestion: (callerContext: any, id: string) =>
          confirmAudienceBindingSuggestion(suggestionDeps, callerContext, id),
        dismissAudienceBindingSuggestion: (callerContext: any, id: string) =>
          dismissAudienceBindingSuggestion(suggestionDeps, callerContext, id),
      };
      // [ADR-0106 D7] The metadata-plane readable-field query, registered as an
      // EXTENSION of the published contract rather than inside the typed
      // literal above: `ISecurityService` lives in `packages/spec`, and the
      // seat for this method there is a separate change (consumers already
      // feature-detect, which is exactly why a partial surface degrades instead
      // of lying). `Object.assign` keeps the literal type-checked against the
      // contract while the extension stays visible as an extension.
      const registeredSecurityService = Object.assign(securityService, {
        getMetadataReadableFields: (object: string, context?: any) =>
          this.getMetadataReadableFields(object, context),
      });
      ctx.registerService('security', registeredSecurityService);
      ctx.logger.info('[security] registered "security" service (getReadFilter, getReadableFields, getMetadataReadableFields, canExport, checkAuthoredRowWrite, resolvePermissionSetNames, resolvePermissionSetsForContext, explain, audience-binding suggestions) — ADR-0021 D-C / ADR-0090 D5/D6/D9 / ADR-0106 D7 / #3544 / #3547 / #5493 / #7616');
    } catch (e) {
      ctx.logger.warn?.('[security] failed to register "security" service', {
        error: (e as Error).message,
      });
    }

    // Register security middleware
    ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      // System operations bypass security
      if (opCtx.context?.isSystem) {
        return next();
      }

      // ADR-0056 (Option A) — declaration-derived PUBLIC-FORM grant. A public
      // form submission carries `publicFormGrant: { object }` derived from the
      // form's declared target (set by the rest-server form-submit route). It
      // authorizes ONLY create + the immediate read-back on THAT object — never
      // anything else, and never the anonymous fall-open. This lets public forms
      // work under secure-by-default (anonymous-deny) WITHOUT a deployment-configured
      // `guest_portal`, scoped to exactly the declared object (the field
      // allow-list is enforced at the route; the context is request-scoped).
      const formGrant = opCtx.context?.publicFormGrant;
      if (formGrant && typeof formGrant === 'object' && (formGrant as { object?: string }).object) {
        const grantObject = (formGrant as { object: string }).object;
        const allowed =
          opCtx.object === grantObject &&
          ['insert', 'find', 'findOne', 'count'].includes(opCtx.operation);
        if (allowed) {
          // [#3022] The grant bypasses every downstream write gate (FLS 2.5,
          // owner anchor 3.5, tenant CHECK) — so the system-managed anchors
          // must be forced HERE, before the write is admitted. An anonymous
          // submission has no principal to backfill from and no conceivable
          // transfer authorization, so a supplied `owner_id` /
          // `organization_id` / audit column is stripped from every row (the
          // route-side field allow-list is the first net; this is the
          // data-layer boundary that holds even if a FormView declares — or
          // a zero-section form falls open to — one of these columns).
          // Ownership stays NULL for object hooks / the first-admin
          // bootstrap to assign, exactly like other anonymous-seeded rows.
          if (opCtx.operation === 'insert' && opCtx.data && typeof opCtx.data === 'object') {
            const rows = Array.isArray(opCtx.data) ? opCtx.data : [opCtx.data];
            const stripped = new Set<string>();
            for (const row of rows) {
              if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
              for (const field of PUBLIC_FORM_SERVER_MANAGED_FIELDS) {
                if (Object.prototype.hasOwnProperty.call(row, field)) {
                  delete (row as Record<string, unknown>)[field];
                  stripped.add(field);
                }
              }
            }
            if (stripped.size > 0) {
              ctx.logger.warn(
                `[security] public-form insert on '${grantObject}' supplied server-managed ` +
                  `field(s) [${[...stripped].join(', ')}] — stripped (#3022)`,
              );
            }
          }
          return next();
        }
        throw new PermissionDeniedError(
          `[Security] Access denied: public-form grant permits only create/read-back on '${grantObject}', ` +
            `not '${opCtx.operation}' on '${opCtx.object}'`,
          { operation: opCtx.operation, object: opCtx.object },
        );
      }

      // [ADR-0086 P2 — 块2, evolved by ADR-0094] Two-doors write gate. A
      // permission set stamped `managed_by:'package'` is owned by the PACKAGE
      // door: its BASELINE is authored in the package and lands via publish
      // (块1). The admin door must never FORGE that provenance (insert or
      // update), and the lifecycle ops with no overlay translation
      // (transfer/restore/purge) stay refused on package rows. Ordinary
      // `update`/`delete` on a package row are handled downstream by the
      // ADR-0094 write-through, which TRANSLATES them into a metadata write.
      // Whether that write is ACCEPTED is ADR-0005's call, not this gate's,
      // and since ADR-0094 D5-R (#6483 / PR #6608 rolled `permission` back to
      // `allowOrgOverride: false`) a CODE-DECLARED set is refused there with
      // 403 `NOT_OVERRIDABLE` — the 2026-07-14 "customize / reset via an env
      // overlay" direction this comment used to state is RETIRED.
      // Placed BEFORE the empty-principal fall-open and the CRUD check so the
      // forging boundary holds even for a principal-less context and a
      // superuser with modifyAllRecords. System/boot writes carry `isSystem`
      // and already short-circuited the whole middleware above.
      await this.assertPackageManagedWriteGate(opCtx);

      // [ADR-0066 / #2918] Built-in row-write guardrail for the platform/app
      // ASSET objects sys_position / sys_capability. Like the package gate
      // above, an unconditional data-layer boundary: a row authored by the
      // platform or an application package (provenance recorded in
      // `managed_by`) may not be deleted or rewritten through the admin door.
      // Unlike sys_permission_set there is NO ADR-0094 overlay write-through
      // for these objects, so the refusal must hold for update/delete here
      // rather than deferring to a downstream translation. Runs BEFORE the
      // empty-principal fall-open and the CRUD check so the boundary holds even
      // for a principal-less context and a superuser with modifyAllRecords.
      // System/boot writes carry `isSystem` and already short-circuited above,
      // so the seeder and package publish are unaffected.
      await this.assertSystemRowWriteGate(opCtx);

      // [ADR-0090 D5/D9] Audience-anchor binding guard — like the package
      // gate above, an unconditional data-layer boundary: a permission set
      // carrying high-privilege bits must never be bound to the `everyone`
      // or `guest` positions, no matter who asks. (Boot/system writes carry
      // `isSystem` and short-circuited above; the dev-mode default binding
      // is validated at seed time by the same predicate.)
      await this.assertAudienceAnchorBindingGate(opCtx);

      // [ADR-0103] Engine-owned write guard. Fail-closed on a user-context
      // generic write to a `system`/`append-only` object whose resolved
      // affordances forbid the verb (the engine-owned default). Keyed off
      // resolveCrudAffordances, not the raw bucket, so the admin/user-writable
      // members (RBAC link tables, prefs, messaging config) — which declare
      // userActions opening their verbs — pass through to the DelegatedAdminGate
      // / RLS below. System/boot writes carry `isSystem` and short-circuited
      // above; context-less service writes carry no userId and pass by
      // construction. Runs BEFORE the empty-principal fall-open so engine-owned
      // tables fail CLOSED for principal-less-but-user-context callers.
      assertEngineOwnedWriteAllowed(
        // The contract's getSchema returns `unknown` (schema shape is
        // engine-local); narrow to the slice the guard reads.
        typeof ql?.getSchema === 'function'
          ? ql.getSchema(opCtx.object) as EngineOwnedSchemaLike | undefined
          : undefined,
        opCtx.operation,
        opCtx.context,
      );

      // [ADR-0090 D12] Delegated-administration gate. Writes to the RBAC
      // link tables (assignments / bindings / direct grants / env-set
      // authoring) are a GOVERNED operation: tenant-level admins pass
      // through to the ordinary CRUD/RLS checks; delegates need a covering
      // adminScope (BU subtree + allowlist + strict containment); everyone
      // else — including holders of plain CRUD grants on these tables — is
      // denied. Runs BEFORE the empty-principal fall-open below so RBAC
      // tables fail CLOSED for principal-less non-system contexts.
      if (this.delegatedAdminGate) {
        await this.delegatedAdminGate.assert(opCtx);
      }

      const positions = opCtx.context?.positions ?? [];
      const explicitPermissionSets = opCtx.context?.permissions ?? [];

      // Skip security checks if no positions AND no explicit permission sets
      // AND no userId (anonymous/unauthenticated). The auth middleware
      // should handle authentication separately.
      if (
        positions.length === 0 &&
        explicitPermissionSets.length === 0 &&
        !opCtx.context?.userId
      ) {
        return next();
      }

      // 1. Resolve permission sets from BOTH role names and explicit
      //    permission set names attached to the execution context. The
      //    resolution (incl. the implicit + post-resolution baseline
      //    fallback) is shared with the public getReadFilter service via
      //    resolvePermissionSetsForContext — keeping the find-path RLS and
      //    the analytics raw-SQL RLS provably in lock-step.
      let permissionSets: PermissionSet[] = [];
      try {
        permissionSets = await this.resolvePermissionSetsForContext(opCtx.context);
      } catch (e) {
        // Fail CLOSED. A permission-resolution failure must DENY the request,
        // never bypass the checks (that would let a degraded metadata service
        // expose every tenant's data). System/bootstrap operations already
        // short-circuited above (`opCtx.context?.isSystem`), so reaching here
        // means an authenticated user request whose RBAC/RLS could not be
        // resolved — deny it and alert.
        ctx.logger.error(
          `[security] permission resolution failed for operation '${opCtx.operation}' on ` +
          `object '${opCtx.object}' (user ${opCtx.context?.userId ?? 'unknown'}) — ` +
          `denying request (fail-closed)`,
          e instanceof Error ? e : new Error(String(e)),
        );
        throw new PermissionDeniedError(
          `[Security] Access denied: permission subsystem unavailable for ` +
          `operation '${opCtx.operation}' on object '${opCtx.object}'`,
        );
      }

      // [ADR-0090 D10 — agent intersection] When this principal acts ON BEHALF
      // OF a user (an AI agent or a service), its effective permission is the
      // INTERSECTION of its own grants and the delegator's grants — never the
      // union (confused-deputy prevention). Resolve the delegator's effective
      // permission sets ONCE here; every gate below AND-composes the two lists
      // so the tighter of the two wins at each axis (CRUD, capabilities, FLS,
      // depth, row-level using/check, VAMA). The whole thing is gated on the
      // presence of the delegation LINK (not the `principalKind` label — a
      // service acting for a user is the identical risk): on the ordinary
      // non-delegated path `delegatorSets` stays null, every combine reduces to
      // today's expression, no extra `ql` read happens, and behaviour is
      // byte-identical. A dangling link (delegator deleted) fails CLOSED — see
      // resolveDelegatorContext for why "empty sets" would be wrong (the
      // additive baseline would resurrect access for a non-existent user).
      let delegatorSets: PermissionSet[] | null = null;
      let delegatorContext: any = null;
      if (permissionSets.length > 0 && opCtx.context?.onBehalfOf?.userId) {
        const del = await resolveDelegatorContext(this.ql, opCtx.context);
        if (del.kind === 'missing') {
          throw new PermissionDeniedError(
            `[Security] Access denied: on-behalf-of principal names delegator ` +
              `'${del.userId}', who does not exist — refusing to act (ADR-0090 D10 fail-closed)`,
            { operation: opCtx.operation, object: opCtx.object },
          );
        }
        if (del.kind === 'resolved') {
          delegatorContext = del.context;
          delegatorSets = await this.resolvePermissionSetsForContext(delegatorContext);
        }
      }

      // [ADR-0066 D2/D3] Resolve the object's security posture (private flag,
      // platform-global flag, capability contract) once for the checks below.
      const secMeta =
        permissionSets.length > 0
          ? await this.getObjectSecurityMeta(opCtx.object)
          : { isPrivate: false, tenancyDisabled: false, isBetterAuthManaged: false, requiredPermissions: EMPTY_REQUIRED_PERMISSIONS, fieldRequiredPermissions: {} as Record<string, string[]>, unresolved: false };

      // [#3545] Fail CLOSED when the object's own posture could not be resolved.
      // #3545 accepted the API-exposure gate's fail-open on unresolvable metadata
      // because that gate is a SURFACE-AREA control while THIS middleware is the
      // authorization boundary and enforces regardless. That holds only if the
      // boundary's own inputs are trustworthy — and two of them are read from the
      // same metadata and default permissively: an unresolved `access.default`
      // reads as PUBLIC (so a plain `'*'` wildcard covers an object ADR-0066 D2
      // says it must not) and an unresolved `requiredPermissions` reads as NO
      // CONTRACT (so the D3 capability AND-gate below is skipped entirely). Both
      // are access-NARROWING declarations, so failing to read them must never
      // resolve to a grant (ADR-0049) — the same stance the permission-resolution
      // failure above and the dangling-delegator checks already take.
      //
      // Blast radius is bounded to exactly the risky case: system/boot writes
      // (`isSystem`) and principal-less/anonymous contexts short-circuited above,
      // so reaching here means an AUTHENTICATED principal with resolved grants
      // asking for an object whose declaration is missing. Cold start therefore
      // does NOT trip this — that window is served by the earlier short-circuits,
      // not by the permissive default — which is why the tiered decision recorded
      // for the exposure gate (transient unavailability → fail open) can stay
      // fail-open there while the boundary itself fails closed here.
      if (secMeta.unresolved) {
        ctx.logger.error(
          `[security] object security posture unresolvable for operation '${opCtx.operation}' on ` +
            `object '${opCtx.object}' (user ${opCtx.context?.userId ?? 'unknown'}) — ` +
            `denying request (fail-closed, #3545)`,
        );
        throw new PermissionDeniedError(
          `[Security] Access denied: the security posture of object '${opCtx.object}' ` +
            `could not be resolved for operation '${opCtx.operation}'`,
          { operation: opCtx.operation, object: opCtx.object },
        );
      }

      // [#2850 / #7626] $expand sub-reads take the FULL gate — there is no
      // waiver here any more, and the deletion is the fix.
      //
      // #2850 routed the engine's expand path back through this middleware
      // (`find` re-entered for the referenced object carrying `__expandRead`, a
      // server-set marker `executionContext` never takes from a client), which
      // is what put the referenced object's RLS and FLS on the expansion at
      // all. That part stands. What it also added was a relaxation:
      //
      //     operation === 'find' && __expandRead && !secMeta.isPrivate
      //         → skip the CRUD + requiredPermissions throw-gates
      //
      // …justified as "a PUBLIC referenced object is covered by the '*'
      // wildcard grant and thus already broadly readable, so gating the
      // EXPANSION adds no protection and only surfaces never-designed-for-
      // expand modeling gaps". Neither half of that premise held (#7626):
      //
      //   1. `secMeta.isPrivate` reads `access.default` (ADR-0066 D2 — whether
      //      a `'*'` wildcard COVERS the object), which is a different axis
      //      from the `sharingModel` OWD an object declares to scope its ROWS.
      //      `showcase_contact` declares `sharingModel: 'private'` and no
      //      `access` block, so it read as "public" and the waiver fired for it
      //      — as it did for every object that leaves `access` unset, which is
      //      almost all of them.
      //   2. "already broadly readable" was never CHECKED. The waiver asks
      //      nothing about the caller's grants, so it fired hardest for the
      //      caller who holds NONE — #2850's own pin waives the gate for a
      //      permission set with `objects: {}`. Where the premise is true the
      //      waiver is inert (the CRUD gate would pass anyway); its only
      //      non-vacuous effect is on callers the gate meant to refuse.
      //
      // Measured on the real showcase app: a `contributor`-only session 403'd
      // on `GET /data/showcase_contact/:id` received the same contact FULLY
      // materialised — all 18 fields, `email` included — through
      // `?$expand=contact` on an invoice it legitimately owns. Both gates were
      // bypassed at once, because step 2.6 below stashes `__readScope` from
      // `getEffectiveScope`, which answers `'org'` when NO set grants the op
      // (safe only because the caller is denied separately — and the waiver is
      // what stopped them being denied). So the skipped CRUD check also handed
      // plugin-sharing an org-wide read depth and dissolved the OWD row scope.
      //
      // Removing it restores one rule for every referenced object, the rule
      // #2850 already applied to the private half: an expansion may reveal only
      // rows the caller could have read directly. Nothing over-blocks a
      // legitimate lookup — `expandRelatedRecords` catches the refusal and
      // retains the bare FK id (its documented graceful degradation), so a
      // caller who cannot read the referenced object gets the id it already
      // had, not an error on the parent read.
      //
      // `__expandRead` itself stays: it is the marker the storage/comment
      // access hooks strip as a privileged widening input, and `core`'s
      // operation-private-keys list is what keeps it unforgeable from the wire.

      // 1.5. [ADR-0066 D3/⑤] requiredPermissions AND-gate — a capability
      //      prerequisite checked BEFORE the CRUD grant (ADR §Precedence): a
      //      caller missing any required capability is denied regardless of how
      //      permissive their grants are. Per-operation (⑤): only the caps for
      //      THIS operation's CRUD class (plus any all-operations caps) apply.
      if (permissionSets.length > 0) {
        const required = requiredCapsForOperation(secMeta.requiredPermissions, opCtx.operation);
        if (required.length > 0) {
          const held = this.permissionEvaluator.getSystemPermissions(permissionSets);
          const missing = required.filter((cap) => !held.has(cap));
          // [ADR-0090 D10] Both principals must hold every required capability.
          const missingDel = delegatorSets
            ? required.filter((cap) => !this.permissionEvaluator.getSystemPermissions(delegatorSets!).has(cap))
            : [];
          if (missing.length > 0 || missingDel.length > 0) {
            const allMissing = [...new Set([...missing, ...missingDel])];
            // [#7451] Two messages, two audiences — the #7414 split, applied to
            // the gate one step above the CRUD grant.
            //
            // The user's half REUSES `permission_denied` rather than adding a
            // key, and that is the classification, not laziness. A caller
            // missing a CRUD bit and a caller missing a `requiredPermissions`
            // capability are in the SAME situation: their grants do not cover
            // this action and an administrator is the remedy. "Capability" vs
            // "object permission" is a fact about our authorization model, and
            // the model is precisely what must not reach a toast — the sentence
            // would have to name capability IDs (`manage_x`) to say anything
            // more, which is internal vocabulary by construction.
            //
            // The developer half is the previous sentence BYTE FOR BYTE, logged
            // at the throw site and attached as a SIBLING of `details` (never a
            // member — `details` is what the runtime dispatcher serialises to
            // the browser; #7414 measured that, and #7450 tracks the disclosure
            // that already exists there). `code` / `statusCode` / `details`,
            // including `requiredPermissions` and `missingPermissions`, are
            // untouched: which gate answered stays fully legible to a developer.
            const developerMessage =
              `[Security] Access denied: '${opCtx.object}' (operation '${opCtx.operation}') requires capability ` +
              `[${required.join(', ')}] — ${missing.length > 0 ? 'caller' : 'the delegator'} is missing [${allMissing.join(', ')}]`;
            ctx.logger.warn(developerMessage, {
              operation: opCtx.operation,
              object: opCtx.object,
              requiredPermissions: required,
              missingPermissions: allMissing,
              userId: opCtx.context?.userId ?? 'unknown',
            });
            throw new PermissionDeniedError(
              userFacingDenialMessage(ctx, 'permission_denied', opCtx.context?.locale),
              {
                operation: opCtx.operation,
                object: opCtx.object,
                positions,
                permissionSets: explicitPermissionSets,
                requiredPermissions: required,
                missingPermissions: allMissing,
              },
              developerMessage,
            );
          }
        }
      }

      // 2. CRUD permission check
      if (permissionSets.length > 0) {
        const allowed = this.permissionEvaluator.checkObjectPermission(
          opCtx.operation,
          opCtx.object,
          permissionSets,
          { isPrivate: secMeta.isPrivate },
        );

        if (!allowed) {
          // [#7414] TWO messages, two audiences — the split #7307 made for
          // `DELETE_RESTRICTED`, reached from the authorization side and through
          // the SAME catalog.
          //
          // `message` is what a BUSINESS USER reads, because both transports
          // ship it verbatim as the body's human-readable string and Console
          // renders it as-is in a toast. It is now a localized sentence that
          // names no object, no operation and no position.
          //
          // `developerMessage` is the previous sentence BYTE FOR BYTE. Where it
          // goes is where this card had to diverge from #7307, and the reason is
          // measured, not assumed. #7423 shipped its developer half over the
          // wire on the grounds that "it discloses nothing the envelope did not
          // already carry: `dependentObject` and `object` are API names on the
          // same body". That premise does NOT hold here on both transports:
          //
          //   - `@objectstack/rest`'s `mapDataError` 403 branch builds
          //     `{ error, code, object? }` and never reads `error.details`, and
          //     that `object` is the object the ROUTE named — so `positions`,
          //     the operation, and (on a cascade) the CHILD object's API name
          //     reach the client through NOTHING but this message today;
          //   - the runtime dispatcher does spread `e.details` onto the body
          //     (`http-dispatcher.ts` → `buildApiError` → `error.details`), so
          //     there they are already disclosed.
          //
          // One error class cannot honestly have a per-transport disclosure
          // policy, and a card whose purpose is to REDUCE what a browser is told
          // must not add a new disclosure on the transport that discloses less.
          // So the developer half is NOT shipped: it goes to the server log,
          // which is where an app builder debugging a 403 already looks. It is
          // attached to the error as a SIBLING of `details`, never a member of
          // it — `details` is the field the dispatcher serialises.
          //
          // `code` / `statusCode` / `details` are untouched: one
          // `PERMISSION_DENIED` (ADR-0112), one 403, two sentences.
          const developerMessage =
            `[Security] Access denied: operation '${opCtx.operation}' on object '${opCtx.object}' ` +
            `is not permitted for positions [${positions.join(', ')}]`;
          ctx.logger.warn(developerMessage, {
            operation: opCtx.operation,
            object: opCtx.object,
            positions,
            userId: opCtx.context?.userId ?? 'unknown',
          });
          throw new PermissionDeniedError(
            userFacingDenialMessage(ctx, 'permission_denied', opCtx.context?.locale),
            { operation: opCtx.operation, object: opCtx.object, positions, permissionSets: explicitPermissionSets },
            developerMessage,
          );
        }

        // [ADR-0090 D10] The delegator must independently grant the same op — an
        // agent may never act beyond the reach of the user it stands in for.
        if (delegatorSets && !this.permissionEvaluator.checkObjectPermission(
          opCtx.operation,
          opCtx.object,
          delegatorSets,
          { isPrivate: secMeta.isPrivate },
        )) {
          throw new PermissionDeniedError(
            `[Security] Access denied: on-behalf-of principal may not '${opCtx.operation}' ` +
              `'${opCtx.object}' — the delegator lacks that grant (ADR-0090 D10 intersection)`,
            { operation: opCtx.operation, object: opCtx.object, positions, permissionSets: explicitPermissionSets },
          );
        }
      }

      // 2.6. [ADR-0057 D1] Stash the grant's access DEPTH for this object so the
      //      sharing service can widen the owner-match (owner_id IN unit-set)
      //      while still OR-ing in shares. Owner-set expansion needs the BU graph
      //      (plugin-sharing), so we pass the scope STRING, not the resolved set.
      if (permissionSets.length > 0) {
        const sc: any = opCtx.context;
        // The AGENT's own depth drives plugin-sharing's owner-match for the
        // agent identity (unchanged on the non-delegated path).
        if (['find', 'findOne', 'count', 'aggregate'].includes(opCtx.operation)) {
          sc.__readScope = this.permissionEvaluator.getEffectiveScope('read', opCtx.object, permissionSets, { isPrivate: secMeta.isPrivate });
          // [ADR-0090 D10] Stash the DELEGATOR's own read depth SEPARATELY (not a
          // min of the two). The OWD/sharing owner-match is identity-scoped:
          // plugin-sharing re-runs the owner filter under the delegator's
          // identity + THIS depth and AND-s it in, giving a true per-identity
          // intersection. Narrowing __readScope alone would wrongly scope the
          // AGENT's identity to the delegator's depth (owner_id = agentId),
          // hiding the very rows the delegator legitimately owns.
          if (delegatorSets) {
            sc.__delegatorReadScope = this.permissionEvaluator.getEffectiveScope('read', opCtx.object, delegatorSets, { isPrivate: secMeta.isPrivate });
          }
        } else if (['update', 'delete', 'transfer', 'restore', 'purge'].includes(opCtx.operation)) {
          sc.__writeScope = this.permissionEvaluator.getEffectiveScope('write', opCtx.object, permissionSets, { isPrivate: secMeta.isPrivate });
          if (delegatorSets) {
            sc.__delegatorWriteScope = this.permissionEvaluator.getEffectiveScope('write', opCtx.object, delegatorSets, { isPrivate: secMeta.isPrivate });
          }
        }
      }

      // 2.7. Row-level WRITE authorization (pre-image check).
      //
      // RLS is injected as a `where` filter on the read path (step 3, via
      // `opCtx.ast`), but a single-id update/delete goes straight to
      // `driver.update(object, id, …)` / `driver.delete(object, id)` — it builds
      // no `ast`, so the row-level predicate is NEVER applied to by-id writes.
      // The result (#1985): the CRUD check passes (member_default grants edit/
      // delete) and the owner/tenant RLS that was supposed to scope the write is
      // silently bypassed — any member could modify another user's record.
      //
      // Fix: before the mutation, compute the write-operation RLS filter and
      // verify the TARGET row satisfies it. We re-read the row through the
      // engine with `{ id } AND <writeFilter>`; a `find` does not re-enter this
      // block, so there is no recursion, and read-side RLS/tenant scoping
      // compose naturally. A `null` result means the row is either gone or
      // RLS-hidden → deny. When `computeRlsFilter` returns `null` (no policy
      // applies — e.g. an admin set with no RLS, or `modifyAllRecords`) the
      // check is skipped and behaviour is unchanged.
      //
      // [#5492] The filter is composed BY PROVENANCE. Two of the policies that
      // can land in it are the platform's OWN ownership floor
      // (`owner_only_writes` / `owner_only_deletes`, `created_by ==
      // current_user.id` — see `platform-ownership-policies.ts`), and that floor
      // is a SECOND implementation of ownership: the one blind to every widening
      // mechanism the platform also declares (write DEPTH, an `edit`-level
      // `sys_record_share`, the `modifyAllRecords` bypass). Running it as an
      // unconditional AND made all three inert — a manager holding Modify All
      // Data and a share target holding `access_level: 'edit'` both got 403 on
      // every row they did not personally create.
      //
      // So the floor now DEFERS to the authority that owns those wideners:
      // `ISharingService`'s tri-state write verdict (#6428).
      //
      //   allow   → the declared authority REPLACES the floor (it has a positive
      //             basis: ownership at DEPTH, an `edit` share, or the bypass).
      //   abstain → record sharing does not enforce on this row at all (public
      //             object, no owner field, platform internal). The floor is the
      //             ONLY row-level write gate such objects have, so it STAYS —
      //             #5492's E2 experiment measured what collapsing this into
      //             "permitted" costs: a member's cross-creator UPDATE on an
      //             `owner_id`-less object turned 403 into 200.
      //   deny    → the floor stays. The refusal itself belongs to the sharing
      //             middleware that produced the verdict; re-raising it here
      //             would be the duplicate implementation this composition
      //             exists to remove, and could only ever narrow a surface the
      //             ruling says may not shrink.
      //
      // Layer 0 (the tenant wall) and every APP-AUTHORED policy are untouched by
      // the replacement — a declared security property stays declared (ADR-0049).
      // Note what this is NOT: `modifyAllRecords` still does not bypass
      // write-side RLS on an ordinary business posture (ADR-0066 ① is intact).
      // The platform's own floor defers to the platform's own ownership
      // authority; app-authored policies keep refusing exactly as before.
      //
      // The verb boundary is INHERITED, not restated (ADR-0111 D3): the same
      // `rlsOperation` mapping picks `checkEdit` for the update class and
      // `checkDelete` for the delete class, so an `edit` share widens update and
      // still leaves delete denied without this file knowing why.
      if (
        // update/delete today; transfer/restore/purge are pre-wired (#1883) so
        // the M2 ops inherit the pre-image check the moment they dispatch —
        // the CRUD bit alone must never be the only row-level defense.
        ['update', 'delete', 'transfer', 'restore', 'purge'].includes(opCtx.operation) &&
        permissionSets.length > 0 &&
        !!opCtx.context?.userId &&
        this.ql
      ) {
        const targetId = this.extractSingleId(opCtx);
        if (targetId != null) {
          // RLS policies declare select/insert/update/delete — map the
          // destructive lifecycle class onto its nearest write class so
          // authored policies apply (purge destroys like delete;
          // transfer/restore mutate like update).
          const rlsOperation =
            opCtx.operation === 'purge' ? 'delete'
            : opCtx.operation === 'transfer' || opCtx.operation === 'restore' ? 'update'
            : opCtx.operation;
          // [#5492] Ask the write authority ONLY when the platform floor is
          // actually in play for this (principal, object, operation) — no floor,
          // nothing to replace, and no reason to spend a sharing probe.
          //
          // [ADR-0090 D10] The on-behalf-of path is deliberately EXCLUDED. The
          // bypass predicate the verdict folds through already fails closed for a
          // delegated context (`hasWriteBypass`: "no D10 delegator intersection
          // on this path", ADR-0111 D2), so composing here could only produce a
          // verdict resolved against the wrong identity. The delegated write
          // keeps both principals' floors, exactly as before.
          const floorApplies =
            !delegatorSets &&
            this.collectRLSPolicies(
              permissionSets,
              opCtx.object,
              rlsOperation,
              (opCtx.context?.positions ?? []) as string[],
            ).some(isPlatformOwnershipFloorPolicy);
          const dropPlatformOwnershipFloor = floorApplies
            ? (await this.resolveSharingWriteVerdict(
                rlsOperation,
                opCtx.object,
                String(targetId),
                opCtx.context,
                permissionSets,
              )) === 'allow'
            : false;
          const writeFilter = await this.computeRlsFilter(
            permissionSets,
            opCtx.object,
            rlsOperation,
            opCtx.context,
            { dropPlatformOwnershipFloor },
          );
          // [ADR-0090 D10] The target row must satisfy BOTH principals' write
          // RLS — a by-id write on behalf of a user may only touch rows that
          // user could also touch. Compute the delegator's write filter against
          // the delegator's context (its userId/tenant substitutions) and AND
          // it into the same pre-image re-read.
          const delWriteFilter = delegatorSets
            ? await this.computeRlsFilter(delegatorSets, opCtx.object, rlsOperation, delegatorContext)
            : null;
          const writeParts = [writeFilter, delWriteFilter].filter(Boolean) as Record<string, unknown>[];
          if (writeParts.length > 0) {
            let visible: unknown = null;
            try {
              visible = await this.ql.findOne(opCtx.object, {
                where: { $and: [{ id: targetId }, ...writeParts] },
                context: opCtx.context,
              });
            } catch {
              // A read denial (e.g. no read permission) is itself a "cannot
              // touch this row" signal — fall through to the deny below.
              visible = null;
            }
            if (!visible) {
              // [#7451] The refusal an ordinary business user is most likely to
              // meet: they hold the object grant, and the ROW is what they may
              // not touch. A DIFFERENT situation from the CRUD-grant denial
              // above, so a different catalog key — `record_access_denied`. The
              // remedy differs too, which is the test: "ask an administrator"
              // is wrong here, because the record's owner can often share it.
              //
              // The sentence names nothing, and unlike #7414's gate this one
              // COULD have named honestly (the row is the one the caller just
              // addressed by id). It still does not: the only spellings
              // available here are the object's API name and an opaque row id,
              // and reaching a LABEL means the ladder whose last rung is the
              // API name — the exact leak #7414 refused. The user knows which
              // record they clicked.
              const developerMessage =
                `[Security] Access denied: not permitted to ${opCtx.operation} this ` +
                `'${opCtx.object}' record (row-level security)`;
              ctx.logger.warn(developerMessage, {
                operation: opCtx.operation,
                object: opCtx.object,
                recordId: targetId,
                positions,
                userId: opCtx.context?.userId ?? 'unknown',
              });
              throw new PermissionDeniedError(
                userFacingDenialMessage(ctx, 'record_access_denied', opCtx.context?.locale),
                {
                  operation: opCtx.operation,
                  object: opCtx.object,
                  positions,
                  permissionSets: explicitPermissionSets,
                  recordId: targetId,
                },
                developerMessage,
              );
            }
          }
        }
      }

      // 2.8. ADR-0055 — controlled-by-parent WRITE: a detail write (insert/update/
      // delete) requires edit access to its master. The detail itself carries no
      // authored RLS, so the #1994 pre-image check above is a no-op for it; this
      // closes the by-id write path by checking the master instead.
      if (
        ['insert', 'update', 'delete', 'transfer', 'restore', 'purge'].includes(opCtx.operation) &&
        permissionSets.length > 0 &&
        !!opCtx.context?.userId &&
        this.ql
      ) {
        await this.assertControlledByParentWrite(
          permissionSets,
          opCtx.object,
          opCtx.operation,
          opCtx,
          opCtx.context,
        );
        // [ADR-0090 D10] The delegator must ALSO have edit access to the master
        // — a detail write on behalf of a user requires that user's master-edit.
        if (delegatorSets) {
          await this.assertControlledByParentWrite(
            delegatorSets,
            opCtx.object,
            opCtx.operation,
            opCtx,
            delegatorContext,
          );
        }
      }

      // 2.5. Field-Level Security write enforcement.
      //
      // The client-side masker (ObjectForm / inline grid) already hides
      // non-editable fields from the UI, but that is a UX layer only —
      // a hand-crafted POST / direct ObjectQL call can still target a
      // forbidden field. We fail-closed here with an explicit 403 and
      // the offending field names, so:
      //
      //   - honest clients get an actionable error (vs. silent drop,
      //     which manifests as a confusing partial-save), and
      //   - probing clients see that the boundary is enforced (vs.
      //     getting a 200 with the field silently ignored, which
      //     reveals nothing).
      //
      // Runs BEFORE the tenant/owner auto-injection (step 3.5) so the
      // system-set fields are not subject to the user's edit
      // permissions — they are populated from the execution context,
      // not from the caller's payload.
      if (
        (opCtx.operation === 'insert' || opCtx.operation === 'update') &&
        opCtx.data &&
        permissionSets.length > 0
      ) {
        let fieldPerms = this.permissionEvaluator.getFieldPermissions(
          opCtx.object,
          permissionSets,
        );
        // [ADR-0066 D3] AND-gate field-level requiredPermissions into the map.
        fieldPerms = this.foldFieldRequiredPermissions(fieldPerms, secMeta.fieldRequiredPermissions, permissionSets);
        // [ADR-0090 D10] Intersect with the delegator's field perms — a field
        // the agent may edit but the delegator may not becomes forbidden.
        if (delegatorSets) {
          let delFieldPerms = this.permissionEvaluator.getFieldPermissions(opCtx.object, delegatorSets);
          delFieldPerms = this.foldFieldRequiredPermissions(delFieldPerms, secMeta.fieldRequiredPermissions, delegatorSets);
          fieldPerms = intersectFieldMasks(fieldPerms, delFieldPerms);
        }
        if (Object.keys(fieldPerms).length > 0) {
          const forbidden = this.fieldMasker.detectForbiddenWrites(
            opCtx.data,
            fieldPerms,
          );
          if (forbidden.length > 0) {
            throw new PermissionDeniedError(
              `[Security] Field write denied: not permitted to edit ` +
                `[${forbidden.join(', ')}] on '${opCtx.object}'`,
              {
                operation: opCtx.operation,
                object: opCtx.object,
                positions,
                permissionSets: explicitPermissionSets,
                forbiddenFields: forbidden,
              },
            );
          }
        }
      }

      // 2.5b. Field-Level Security READ enforcement for aggregate inputs.
      //
      // The read path relies on RESULT masking (step 4) to hide FLS-protected
      // fields, but step 4 only covers find/findOne/insert/update — and an
      // aggregate's output rows carry only aliases, so masking could never
      // recover which source field fed `sum(salary) AS total`. Without an
      // input-side gate a caller may read a protected field's statistics
      // (sum/avg/min/max reveal the value outright on a single-row group).
      // Enforce on the INPUT: any groupBy / aggregation reference to an
      // FLS-unreadable field is rejected fail-closed with the offending names
      // (mirrors the write gate in 2.5). `where`-filter probing is a
      // platform-wide class shared with find() and is not widened here.
      if (opCtx.operation === 'aggregate' && permissionSets.length > 0) {
        let fieldPerms = this.permissionEvaluator.getFieldPermissions(opCtx.object, permissionSets);
        // [ADR-0066 D3] AND-gate field-level requiredPermissions into the map.
        fieldPerms = this.foldFieldRequiredPermissions(fieldPerms, secMeta.fieldRequiredPermissions, permissionSets);
        // [ADR-0090 D10] Intersect with the delegator's field perms — a field
        // the agent may read but the delegator may not stays forbidden.
        if (delegatorSets) {
          let delFieldPerms = this.permissionEvaluator.getFieldPermissions(opCtx.object, delegatorSets);
          delFieldPerms = this.foldFieldRequiredPermissions(delFieldPerms, secMeta.fieldRequiredPermissions, delegatorSets);
          fieldPerms = intersectFieldMasks(fieldPerms, delFieldPerms);
        }
        if (Object.keys(fieldPerms).length > 0) {
          const ast: any = opCtx.ast ?? {};
          const referenced = new Set<string>();
          for (const g of Array.isArray(ast.groupBy) ? ast.groupBy : []) {
            const f = typeof g === 'string' ? g : g?.field;
            if (typeof f === 'string' && f) referenced.add(f);
          }
          for (const a of Array.isArray(ast.aggregations) ? ast.aggregations : []) {
            if (typeof a?.field === 'string' && a.field) referenced.add(a.field);
          }
          const forbidden = [...referenced].filter(
            (f) => fieldPerms[f] && fieldPerms[f].readable === false,
          );
          if (forbidden.length > 0) {
            throw new PermissionDeniedError(
              `[Security] Field read denied: not permitted to aggregate ` +
                `[${forbidden.join(', ')}] on '${opCtx.object}'`,
              {
                operation: opCtx.operation,
                object: opCtx.object,
                positions,
                permissionSets: explicitPermissionSets,
                forbiddenFields: forbidden,
              },
            );
          }
        }
      }

      // 3.5. [#3004] `owner_id` — the row-ownership ANCHOR — is SYSTEM-MANAGED
      // for non-privileged writers. It is deliberately not `readonly` in the
      // schema (ownership is transferable, see registry.ts applySystemFields),
      // so the #2948 static-readonly strip never covers it; FLS doesn't gate it
      // by default; and OWD/RLS owner gates key OFF it — whoever controls the
      // value controls who may update/delete the row. So the middleware owns
      // the anchor:
      //
      //   • INSERT: an empty `owner_id` is auto-stamped to the acting user
      //     (without this the row has `owner_id = NULL` and the default
      //     `owner_only_writes` RLS policy hides it from its own creator).
      //     Batch rows included. A SUPPLIED owner that is NOT the acting user
      //     is an ownership FORGE — denied unless the caller holds the
      //     transfer grant (`allowTransfer`, or `modifyAllRecords` which
      //     implies it).
      //   • UPDATE: a supplied `owner_id` is an ownership TRANSFER (or a
      //     disown, when null) — denied without the transfer grant. The
      //     single-id no-op echo (a form save sending the unchanged owner
      //     back) is tolerated by comparing against the pre-image; a bulk
      //     change-set carrying `owner_id` has no pre-image to compare and
      //     fails CLOSED.
      //
      // System/boot writes carry `isSystem` and short-circuited the whole
      // middleware above — imports, OAuth provisioning, cron snapshots and
      // seed claims that legitimately write foreign/NULL owners are unaffected.
      // Under delegation (ADR-0090 D10) BOTH principals must hold the grant.
      //
      // `organization_id` auto-injection has moved to
      // `@objectstack/organizations`; its forge guard is step 3.7 below.
      //
      // [#3023] EXEMPTION — the engine's referential-integrity FK clear. When a
      // referenced record is deleted, `cascadeDeleteRelations` nulls the FK on
      // every dependent (owner_id included). That `owner_id = null` is an
      // integrity-mandated consequence of an already-authorized parent delete,
      // NOT a user disown, so the transfer guard must not fire and abort the
      // cascade. The marker rides a server-DERIVED context (never client-built —
      // same trust model as `__expandRead`), so it cannot be forged from a
      // request to slip an ordinary ownership write past the guard.
      if (
        (opCtx.operation === 'insert' || opCtx.operation === 'update') &&
        opCtx.data &&
        typeof opCtx.data === 'object' &&
        !opCtx.context?.__referentialFieldClear
      ) {
        const isInsert = opCtx.operation === 'insert';
        const rows = (Array.isArray(opCtx.data) ? opCtx.data : [opCtx.data]) as Record<string, unknown>[];
        // Own-property test only — never read `owner_id` through the prototype
        // chain (a polluted `Object.prototype.owner_id` must not make ordinary
        // field-only updates look like ownership writes).
        const writesOwner = (r: unknown): r is Record<string, unknown> =>
          !!r && typeof r === 'object' && !Array.isArray(r) &&
          Object.prototype.hasOwnProperty.call(r, 'owner_id');
        // A valid owner id is a NON-EMPTY SCALAR. Anything else (array / object /
        // boolean / '' ) is neither a stampable self-owner nor a tolerable echo —
        // String()-coercing it would let `owner_id: [selfId]` pass as "self" and
        // corrupt the anchor into an array (self-lockout).
        const isScalarId = (v: unknown): v is string | number =>
          (typeof v === 'string' && v !== '') || (typeof v === 'number' && Number.isFinite(v));

        // Cheap pre-check: does any row actually WRITE owner_id? On update this
        // skips the whole guard (and the field-set resolution) for the common
        // path whose change-set never mentions the anchor. Insert always runs —
        // it must stamp an absent owner.
        if (isInsert || rows.some(writesOwner)) {
          const fields = await this.getObjectFieldNames(metadata, opCtx.object, ql);
          if (fields?.has('owner_id')) {
            const userId = opCtx.context?.userId;
            const denyOwnerWrite = (action: string): never => {
              throw new PermissionDeniedError(
                `[Security] Access denied: 'owner_id' on '${opCtx.object}' is system-managed — ` +
                  `${action} requires the transfer grant (allowTransfer or modifyAllRecords)`,
                { operation: opCtx.operation, object: opCtx.object, positions, permissionSets: explicitPermissionSets },
              );
            };
            // Lazily evaluated + memoized (incl. a `false` result): the common
            // path pays nothing, and ADR-0090 D10 — under delegation BOTH
            // principals must independently hold the transfer grant.
            let transferGrant: boolean | null = null;
            const hasTransferGrant = (): boolean => {
              if (transferGrant === null) {
                transferGrant =
                  this.permissionEvaluator.checkObjectPermission('transfer', opCtx.object, permissionSets, { isPrivate: secMeta.isPrivate }) &&
                  (!delegatorSets || this.permissionEvaluator.checkObjectPermission('transfer', opCtx.object, delegatorSets, { isPrivate: secMeta.isPrivate }));
              }
              return transferGrant;
            };

            if (isInsert) {
              for (const row of rows) {
                if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
                if (!writesOwner(row) || row.owner_id == null || row.owner_id === '') {
                  // Auto-stamp the acting user (batch rows included — the
                  // single-record-only stamp left bulk-inserted rows NULL-owned
                  // and invisible to their creator).
                  if (userId) row.owner_id = userId;
                } else if (
                  !(isScalarId(row.owner_id) && userId != null && String(row.owner_id) === String(userId)) &&
                  !hasTransferGrant()
                ) {
                  // A supplied owner that is not the acting user (or not a valid
                  // scalar id) is a forge — denied without the transfer grant.
                  denyOwnerWrite('creating a record owned by another user');
                }
              }
            } else {
              // UPDATE — a supplied owner_id is a transfer/disown. Only the
              // single-id no-op echo (a form save resending the UNCHANGED owner)
              // is tolerated; an array / bulk change-set has no single pre-image
              // to compare and fails CLOSED.
              const single = !Array.isArray(opCtx.data);
              for (const row of rows) {
                if (!writesOwner(row)) continue;
                if (hasTransferGrant()) break; // authorized transfer — allow every row
                let unchanged = false;
                if (single && isScalarId(row.owner_id)) {
                  const targetId = this.extractSingleId(opCtx);
                  if (targetId != null && this.ql) {
                    // Read the pre-image under the CALLER's context (NOT
                    // isSystem): a form echo only makes sense for a row the
                    // caller can already see. This threads the caller's open
                    // transaction (an in-tx echo isn't spuriously denied) AND
                    // closes the owner-enumeration oracle a system read would
                    // open (a caller who can't read the row gets null → deny,
                    // indistinguishable from a non-owner).
                    //
                    // [#7505] A throw here is NOT evidence about ownership, so
                    // it no longer collapses into `unchanged = false`. That
                    // catch predates the probe distinguishing "row absent"
                    // from "could not be read": with both facts arriving as
                    // `null` it was the only available fail-closed answer, and
                    // it answered a store outage with `403 changing record
                    // ownership` — a refusal an SDK also treats as terminal.
                    // The fault now propagates (the write is still refused —
                    // this throws before `next()`), so the caller learns the
                    // store is down instead of that it tried to steal a
                    // record. The oracle is untouched: an absent row, and a
                    // row the caller cannot read, both still come back `null`
                    // and still deny below.
                    const pre = await this.getCallerPreImage(opCtx, targetId);
                    unchanged = !!pre && pre.owner_id != null && String(pre.owner_id) === String(row.owner_id);
                  }
                }
                if (!unchanged) denyOwnerWrite(`changing record ownership on ${opCtx.operation}`);
              }
            }
          }
        }
      }

      // 3.6. [ADR-0058 D4] RLS WRITE `check` — post-image validation.
      //
      // `using` gates which EXISTING rows a write may target (the #1994
      // pre-image, step 2.7). `check` validates the NEW / CHANGED row
      // (post-image) on insert/update — the PostgreSQL WITH CHECK analog. We
      // compile the declared `check` clauses with the canonical compiler and
      // match the resolved FilterCondition against the post-image in-memory
      // (the single-record backend for the same filter shape, ADR-0058 D6). A
      // row that fails the check is DENIED (fail closed, D5) — never silently
      // written. Scoped to policies that EXPLICITLY declare `check`, so an
      // object governed only by `using` is unaffected.
      if (
        (opCtx.operation === 'insert' || opCtx.operation === 'update') &&
        opCtx.data &&
        typeof opCtx.data === 'object' &&
        !Array.isArray(opCtx.data) &&
        permissionSets.length > 0 &&
        !!opCtx.context?.userId
      ) {
        const checkFilter = await this.computeWriteCheckFilter(
          permissionSets,
          opCtx.object,
          opCtx.operation,
          opCtx.context,
        );
        // [ADR-0090 D10] The post-image must satisfy the delegator's CHECK too —
        // an on-behalf-of write may not produce a row the delegator itself
        // could not have written.
        const delCheckFilter = delegatorSets
          ? await this.computeWriteCheckFilter(delegatorSets, opCtx.object, opCtx.operation, delegatorContext)
          : null;
        const checkParts = [checkFilter, delCheckFilter].filter(Boolean) as Record<string, unknown>[];
        if (checkParts.length > 0) {
          // Build the post-image. Insert → the new row. Update by-id → the
          // pre-image merged with the change set (so a check on an unchanged
          // field still sees its value). A bulk update (no single id) cannot
          // form a post-image here — it is governed by the using-based AST
          // scoping (step 3); we log and skip rather than guess.
          let postImage: Record<string, unknown> | null = { ...(opCtx.data as Record<string, unknown>) };
          if (opCtx.operation === 'update') {
            const targetId = this.extractSingleId(opCtx);
            if (targetId == null) {
              this.logger.warn?.(
                `[Security] RLS check on bulk update '${opCtx.object}' is not post-image validated ` +
                  `(governed by the using-scoped where); single-id writes are checked.`,
              );
              postImage = null;
            } else if (this.ql) {
              // Shares the memoized caller pre-image with the step-3.5 owner
              // echo check — the identical (object, id, caller-context) row.
              const pre = await this.getCallerPreImage(opCtx, targetId);
              if (pre) postImage = { ...pre, ...(opCtx.data as Record<string, unknown>) };
            }
          }
          if (postImage && !checkParts.every((f) => matchesFilterCondition(postImage as any, f as any))) {
            this.logger.warn?.(
              `[Security] RLS check FAILED on ${opCtx.operation} '${opCtx.object}' — write denied (fail-closed)`,
            );
            // [#7451] The third end-user situation, and the only one of the
            // three the user can resolve THEMSELVES: they may edit this record,
            // just not into the state they asked for (showcase authors exactly
            // this — `check: 'owner == current_user.email'`, so a contributor
            // cannot reassign an invoice they own). Hence its own key, and copy
            // that says "change what you entered" rather than "ask an admin".
            //
            // It names nothing for a reason particular to this gate: the
            // post-image failed an authored predicate over the WHOLE row, and
            // the gate does not know which field carried the offending value.
            // Naming the object without the field would send the user hunting.
            const developerMessage =
              `[Security] Access denied: the ${opCtx.operation} would violate a row-level CHECK on '${opCtx.object}'`;
            ctx.logger.warn(developerMessage, {
              operation: opCtx.operation,
              object: opCtx.object,
              positions,
              userId: opCtx.context?.userId ?? 'unknown',
            });
            throw new PermissionDeniedError(
              userFacingDenialMessage(ctx, 'record_change_not_allowed', opCtx.context?.locale),
              { operation: opCtx.operation, object: opCtx.object, positions, permissionSets: explicitPermissionSets },
              developerMessage,
            );
          }
        }
      }

      // 3.7. [ADR-0095 D1 / #2937 / Finding 1] Layer 0 tenant post-image check
      // for INSERT and UPDATE.
      //
      // The tenant wall (Layer 0) is AND-composed onto reads and onto the
      // update/delete PRE-image, but two write paths escaped it because they
      // carry a `organization_id` VALUE that the pre-image/AST scoping never
      // inspects:
      //
      //   • INSERT has no pre-image and builds no AST, so a member could `insert`
      //     a row bearing a FORGED `organization_id` (another org) and land it in
      //     the victim tenant (the enterprise auto-stamp only fills a MISSING
      //     value, never overwrites a supplied one).
      //   • UPDATE (Finding 1 / BLOCKER): the pre-image check (step 2.7) validates
      //     only that the caller may touch the EXISTING row (old org == A); it
      //     never sees the NEW value. `organization_id` is auto-stamp-insert-only,
      //     FLS doesn't protect it, server-side `readonly` isn't enforced, and the
      //     RLS `check` fires only for explicit policies — so a member owning a
      //     row R in org A could `update` R with `{organization_id: victim org B}`
      //     and MOVE the row into another tenant, where it becomes visible. This
      //     is a cross-tenant write by any member.
      //
      // Both close identically here: a SUPPLIED (non-empty) `organization_id` in
      // the write payload must satisfy the SAME Layer 0 filter the read side uses
      // (isolation active, tenant object, platform-admin posture exemption,
      // fail-closed on a missing active org). For UPDATE this makes
      // `organization_id` effectively immutable in non-platform user contexts: the
      // only value that passes is the caller's active org (which — since the
      // pre-image already scoped the target to that org — equals the row's current
      // org), so a re-point to any OTHER tenant is denied. A bulk update carrying a
      // cross-tenant `organization_id` change-set is caught too (the check inspects
      // the change-set value, not a per-row post-image).
      //
      // Scope: only a SUPPLIED `organization_id` is validated — an ABSENT value on
      // insert is the organizations-plugin auto-stamp's responsibility, and an
      // update that doesn't touch `organization_id` carries no value here, so
      // ordinary writes are unaffected. A pure plugin-security deployment has no
      // isolation active (Layer 0 → null), so this is ordering-independent w.r.t.
      // the auto-stamp middleware. System / boot writes carry `isSystem` and
      // short-circuited the whole middleware above, so legitimate cross-org moves
      // (import engine, migrations, plugin SYSTEM_CTX) are unaffected. A true
      // platform admin on a posture-permitting object is exempt via Layer 0 (same
      // rule as reads/insert).
      //
      // [ADR-0105 D5] BULK inserts are covered here too. The check previously
      // required a non-array payload, so an `insert` of an ARRAY of rows could
      // carry a forged `organization_id` per row and never meet the wall — the
      // same defect #2937 closed for the single-row shape, one call-site down
      // (AGENTS.md #10: a `case` label is not enforcement, check the call site).
      //
      // This validates SUPPLIED values only; it never fills an absent one.
      // Auto-stamping `organization_id` stays with the enterprise
      // `@objectstack/organizations` runtime (its Middleware A), which is also
      // what ACTIVATES every walled posture — so a deployment that reaches this
      // code with a walled posture always has the stamper installed. Keeping the
      // stamp there means a forged `org-scoping` registration yields NULL-org
      // rows that the wall hides, i.e. a broken deployment rather than a working
      // unlicensed one; validation stays here because it is a security property,
      // not a packaging one.
      if (
        (opCtx.operation === 'insert' || opCtx.operation === 'update') &&
        opCtx.data &&
        typeof opCtx.data === 'object' &&
        !!opCtx.context?.userId
      ) {
        const writeRows: Record<string, unknown>[] = (
          Array.isArray(opCtx.data) ? (opCtx.data as unknown[]) : [opCtx.data as unknown]
        ).filter((r: unknown): r is Record<string, unknown> =>
          !!r && typeof r === 'object' && !Array.isArray(r),
        );

        const suppliedRows = writeRows.filter(
          (r) => r.organization_id != null && r.organization_id !== '',
        );
        if (suppliedRows.length > 0) {
          const tenantCheck = await this.computeWriteTenantCheckFilter(
            permissionSets,
            opCtx.object,
            opCtx.operation,
            opCtx.context,
          );
          // [ADR-0090 D10] The post-image must also satisfy the delegator's tenant
          // wall — an on-behalf-of write may not land a row in a tenant the
          // delegator itself could not reach.
          const delTenantCheck = delegatorSets
            ? await this.computeWriteTenantCheckFilter(delegatorSets, opCtx.object, opCtx.operation, delegatorContext)
            : null;
          const tenantParts = [tenantCheck, delTenantCheck].filter(Boolean) as Record<string, unknown>[];
          // EVERY supplied row must clear the wall — one forged row in a bulk
          // payload denies the whole write (fail closed, no partial landing).
          if (
            tenantParts.length > 0 &&
            !suppliedRows.every((row) => tenantParts.every((f) => matchesFilterCondition(row as any, f as any)))
          ) {
            this.logger.warn?.(
              `[Security] Layer 0 tenant CHECK FAILED on ${opCtx.operation} '${opCtx.object}' — write denied ` +
                `(fail-closed); a supplied organization_id is outside the caller's organization scope`,
            );
            throw new PermissionDeniedError(
              `[Security] Access denied: the ${opCtx.operation} would place '${opCtx.object}' in another tenant ` +
                `(organization_id is outside the caller's organization scope)`,
              { operation: opCtx.operation, object: opCtx.object, positions, permissionSets: explicitPermissionSets },
            );
          }
        }
      }

      // 2.9. Field-level predicate guard (anti filter-oracle, objectui#2251).
      // FieldMasker (step 4) only strips hidden fields from RESULTS — a
      // caller could still probe a hidden field's value by filtering /
      // sorting / grouping on it (row presence is the oracle; the objectui
      // /data surface makes URL-driven predicates first-class). Reject such
      // queries outright — silent predicate dropping would change query
      // semantics unpredictably. MUST run against the CALLER's OWN predicate,
      // before the RLS injection below: RLS / sharing filters legitimately
      // reference fields the caller cannot read (e.g. owner_id) and must not be
      // rejected.
      if (opCtx.ast) {
        let guardPerms = this.permissionEvaluator.getFieldPermissions(opCtx.object, permissionSets);
        guardPerms = this.foldFieldRequiredPermissions(guardPerms, secMeta.fieldRequiredPermissions, permissionSets);
        // [ADR-0090 D10] A field readable only by the agent is not queryable on
        // the delegator's behalf — intersect before the oracle guard.
        if (delegatorSets) {
          let delGuard = this.permissionEvaluator.getFieldPermissions(opCtx.object, delegatorSets);
          delGuard = this.foldFieldRequiredPermissions(delGuard, secMeta.fieldRequiredPermissions, delegatorSets);
          guardPerms = intersectFieldMasks(guardPerms, delGuard);
        }
        if (Object.keys(guardPerms).length > 0) {
          // [#2982 follow-up] For a bulk WRITE the caller's own predicate is
          // `opCtx.options.where` (untouched); `opCtx.ast.where` may ALREADY
          // carry an owner-match that plugin-sharing's write branch composed in
          // — and plugin-sharing is a SIBLING middleware whose registration
          // order relative to this one is not guaranteed. Guarding the injected
          // AST would 403 a legitimate bulk write on an object whose owner_id is
          // FLS-hidden, purely because a sibling filter mentioned it. Inspect
          // the caller's own predicate so the guard is independent of middleware
          // order and never mistakes an injected filter for a probe. Reads keep
          // guarding the ast: the read seed is the caller's query verbatim and
          // this middleware runs before its own RLS injection.
          const guardTarget: Record<string, unknown> =
            opCtx.operation === 'update' || opCtx.operation === 'delete'
              ? { where: opCtx.options?.where }
              : (opCtx.ast as unknown as Record<string, unknown>);
          assertReadableQueryFields(guardTarget, guardPerms, opCtx.object);
        }
      }

      // 3. RLS filter injection. The policy collection + field-existence
      // safety + compile (incl. the fail-closed deny sentinel) is shared with
      // the public getReadFilter service via computeRlsFilter, so the engine
      // find-path and the analytics raw-SQL path enforce identical scoping.
      if (opCtx.ast) {
        const extra: Record<string, unknown>[] = [];
        const rlsFilter = await this.computeRlsFilter(
          permissionSets,
          opCtx.object,
          opCtx.operation,
          opCtx.context,
        );
        if (rlsFilter) extra.push(rlsFilter);
        // ADR-0055: a controlled_by_parent object derives its read scope from the
        // master record — `masterFK IN (accessible master ids)`, AND-ed in.
        const cbpFilter = await this.computeControlledByParentFilter(
          permissionSets,
          opCtx.object,
          opCtx.context,
        );
        if (cbpFilter) extra.push(cbpFilter);
        // [ADR-0090 D10] AND the delegator's read RLS (and CBP) into the same
        // where — the delegated principal sees only rows BOTH may see. Computed
        // against the delegator's own context so its userId/tenant substitutions
        // are faithful.
        if (delegatorSets) {
          const delRls = await this.computeRlsFilter(delegatorSets, opCtx.object, opCtx.operation, delegatorContext);
          if (delRls) extra.push(delRls);
          const delCbp = await this.computeControlledByParentFilter(delegatorSets, opCtx.object, delegatorContext);
          if (delCbp) extra.push(delCbp);
        }
        if (extra.length) {
          opCtx.ast.where = opCtx.ast.where
            ? { $and: [opCtx.ast.where, ...extra] }
            : extra.length === 1
              ? extra[0]
              : { $and: extra };
        }
      }

      await next();

      // 4. Field-level security: mask restricted fields in returned records.
      // Covers reads AND the record echoed back by a write — otherwise a caller
      // with edit-but-not-field-read could PATCH a record and read a
      // read-protected field back out of the mutation response (FLS bypass).
      // Field WRITES are already blocked upstream (detectForbiddenWrites); this
      // closes the read leak on the response image.
      if (opCtx.result && ['find', 'findOne', 'insert', 'update'].includes(opCtx.operation)) {
        let fieldPerms = this.permissionEvaluator.getFieldPermissions(opCtx.object, permissionSets);
        // [ADR-0066 D3] AND-gate field-level requiredPermissions into the mask.
        fieldPerms = this.foldFieldRequiredPermissions(fieldPerms, secMeta.fieldRequiredPermissions, permissionSets);
        // [ADR-0090 D10] Mask any field the delegator cannot read, too.
        if (delegatorSets) {
          let delFieldPerms = this.permissionEvaluator.getFieldPermissions(opCtx.object, delegatorSets);
          delFieldPerms = this.foldFieldRequiredPermissions(delFieldPerms, secMeta.fieldRequiredPermissions, delegatorSets);
          fieldPerms = intersectFieldMasks(fieldPerms, delFieldPerms);
        }
        if (Object.keys(fieldPerms).length > 0) {
          opCtx.result = this.fieldMasker.maskResults(opCtx.result, fieldPerms, opCtx.object);
        }
      }
    });

    ctx.logger.info('Security middleware registered on ObjectQL engine');

    // [ADR-0094] Data-door write-through: every non-system CRUD write on
    // `sys_permission_set` is redirected into the metadata store (the ONE
    // authoritative store for definitions); the record is projector-owned.
    // Registered AFTER the security middleware, so it runs INSIDE it — the
    // two-doors gate, the delegated-admin gate, and the CRUD/FLS checks have
    // all passed before a write is translated. Kernels without a capable
    // metadata protocol pass through to the legacy direct write (single
    // store — no split brain to prevent).
    ql.registerMiddleware(
      createPermissionSetWriteThrough({
        ql,
        metadata,
        getProtocol: () => {
          try { return (ctx as any).getService?.('protocol') ?? null; } catch { return null; }
        },
        logger: ctx.logger,
      }),
      { object: 'sys_permission_set' },
    );

    // Defer platform admin bootstrap until all plugins finish starting —
    // sys_user / sys_permission_set objects must be registered (by
    // plugin-auth and platform-objects respectively) before we can
    // insert seed rows. Falls back to immediate execution when the
    // kernel does not expose `hook` (test stubs).
    let bootstrapRanOnce = false;
    // [ADR-0094] Guard so the env-projection wiring runs exactly once even
    // though runBootstrap re-runs (e.g. after the first user insert) —
    // registerMutationProjector replaces idempotently, but the legacy
    // onMetadataMutation fallback appends listeners, and re-wiring that would
    // project each save N times.
    let envProjectionWired = false;
    // [#3325 / ADR-0092] Union the better-auth managed-object write denies into
    // the default sets from the LIVE registry, replacing the hand-maintained
    // baseline as the source of truth (a newly-declared identity table is then
    // covered without editing a list). This mutates the shared
    // `bootstrapPermissionSets` instances IN PLACE — the same objects the
    // permission evaluator resolves and `bootstrapPlatformAdmin` serializes into
    // the seed row — so it must run BEFORE the seeder below, and once (the
    // transform is idempotent, but the once-flag avoids re-reading the registry /
    // re-logging on every runBootstrap re-entry). See managed-object-write-denies.ts.
    let managedDeniesApplied = false;
    const runBootstrap = async () => {
      try {
        if (!managedDeniesApplied) {
          const { applied, skippedExisting } = applyManagedWriteDenies(
            this.bootstrapPermissionSets,
            readDeclared(ql, 'object'),
          );
          managedDeniesApplied = true;
          if (applied > 0) {
            ctx.logger.info(
              `[security] managed-object write denies unioned from registry (ADR-0092): ` +
                `${applied} injected, ${skippedExisting} already present`,
            );
          }
        }
        const report = await bootstrapPlatformAdmin(ql, this.bootstrapPermissionSets, {
          logger: ctx.logger,
        });
        // [ADR-0057 D6 / #2077] Seed stack-declared positions into sys_position so they
        // stop being decorative (position→permission-set resolution + recipients).
        try {
          await bootstrapDeclaredPositions(ql, this.metadata, { logger: ctx.logger });
        } catch (e) {
          ctx.logger.warn('[security] declared-position seeding failed', { error: (e as Error).message });
        }
        // [ADR-0086 D5] Seed stack-declared permission sets into
        // sys_permission_set with package provenance (managed_by:'package' +
        // package_id) — packages ship working default access for their own
        // objects, and the admin surface finally sees them. Runs AFTER
        // bootstrapPlatformAdmin so the platform defaults keep their
        // insert-once, provenance-less shape (env config, never clobbered).
        try {
          await bootstrapDeclaredPermissions(ql, this.metadata, { logger: ctx.logger });
        } catch (e) {
          ctx.logger.warn('[security] declared-permission seeding failed', { error: (e as Error).message });
        }

        // [ADR-0090 D5] The baseline→`everyone` binding runs LATER — after
        // `bootstrapBuiltinRoles` seeds the `everyone` anchor (the anchor must
        // exist before it can be bound). See `bindFallbackToEveryone` below.
        // [ADR-0086 P2 — 块1] Register the publish-time materializer so a
        // permission set authored/edited through the PACKAGE door (saved as a
        // `permission` draft, then published) lands in sys_permission_set with
        // managed_by:'package' + package_id — the exact provenance the boot
        // seeder stamps, only now on the runtime publish path instead of only at
        // boot. Idempotent: registerPublishMaterializer replaces on re-run, and
        // upsertPackagePermissionSet refuses to clobber env- or foreign-owned
        // rows (ADR-0086 D4), so the two doors never overwrite each other.
        try {
          const protocol: any = ctx.getService?.('protocol');
          if (protocol && typeof protocol.registerPublishMaterializer === 'function') {
            protocol.registerPublishMaterializer(
              'permission',
              async (args: { body: unknown; packageId: string | null }) => {
                const r = await upsertPackagePermissionSet(ql, args.body, args.packageId, ctx.logger);
                const applied = r.seeded + r.updated;
                // [ADR-0090 D5] A published set carrying the install-time
                // suggestion flag surfaces (or retires) its pending
                // suggestion row right away — same convergent sync as boot.
                if (applied > 0 && (args.body as { isDefault?: boolean } | null)?.isDefault !== undefined) {
                  try { await syncAudienceBindingSuggestions(ql, this.metadata, ctx.logger); } catch { /* non-fatal */ }
                }
                // A publish that materialized nothing did NOT go live — report it
                // as a failure with the reason so the package-door UI never shows
                // a clean publish over a set the admin surface can't see (ADR-0049
                // honesty). The upsert only lands zero rows when it refused: the
                // name is owned by another package, owned by the env door, or the
                // publish carried no owning package_id to stamp.
                if (applied === 0) {
                  return {
                    success: false, inserted: 0, updated: 0,
                    error: r.skippedForeign > 0
                      ? 'permission set name is owned by another package'
                      : r.skippedEnvAuthored > 0
                        ? 'permission set name is owned by the environment (edit it through the admin door)'
                        : 'permission set was not materialized (publish carried no owning package)',
                  };
                }
                return { success: true, inserted: r.seeded, updated: r.updated };
              },
            );
          }
          // [#2747] Uninstall counterpart of the materializer above: when the
          // owning package is uninstalled, revoke its data-plane permission
          // rows (package-owned sets + their position/user bindings + the
          // package's suggestion rows) so grants die with the package — the
          // "no ghost grants" clause of ADR-0090 D5.
          if (protocol && typeof protocol.registerUninstallCleanup === 'function') {
            protocol.registerUninstallCleanup(
              'security.package-permissions',
              async (args: { packageId: string }) => {
                const r = await cleanupPackagePermissions(ql, args.packageId, ctx.logger);
                return {
                  success: true,
                  removed: r.sets + r.positionBindings + r.userGrants + r.suggestions,
                };
              },
            );
          }
          // [ADR-0094] Environment door — the `permission` mutation projector.
          // The protocol AWAITS it inside saveMetaItem / publishMetaItem /
          // deleteMetaItem, so the sys_permission_set record (and the metadata
          // manager's in-memory entry, which the evaluator's registry-first
          // list('permission') resolution reads) already reflects a Studio
          // save when it returns — no projection race. Falls back to the
          // fire-and-forget onMetadataMutation subscription (#2857/#2867) on
          // protocols that predate registerMutationProjector.
          if (!envProjectionWired) {
            envProjectionWired = registerPermissionSetProjection(protocol, {
              ql, metadata: this.metadata, logger: ctx.logger,
            });
          }
          // [#3050] OWD posture authoring gate — pre-persistence veto on
          // runtime-authored `object` bodies: env-tighten-only over packaged
          // declarations (ADR-0086 D1) + external ≤ internal (ADR-0090 D11).
          // Feature-detected; protocols predating registerAuthoringGate keep
          // the legacy (CLI-lint-only) behavior.
          registerObjectPostureGate(protocol);
          // [ADR-0094 D4] Converge record ↔ metadata: project env overlays
          // onto records (creating missing ones), backfill legacy data-door
          // creations into the metadata store once, and heal drifted records
          // from the effective body (metadata wins). Idempotent per boot.
          try {
            await reconcilePermissionSetProjection(protocol, {
              ql, metadata: this.metadata, logger: ctx.logger,
            });
          } catch (e) {
            ctx.logger.warn('[security] permission-set projection reconciliation failed (ADR-0094)', { error: (e as Error).message });
          }
        } catch (e) {
          ctx.logger.warn('[security] permission publish-materializer registration failed', { error: (e as Error).message });
        }
        // [ADR-0068 D2] Seed the framework's reserved built-in identity positions
        // (platform_admin / org_*) so the role catalog is self-describing.
        try {
          await bootstrapBuiltinRoles(ql, { logger: ctx.logger });
        } catch (e) {
          ctx.logger.warn('[security] built-in role seeding failed', { error: (e as Error).message });
        }
        // [ADR-0090 D5] Bind the configured baseline set(s) to the `everyone`
        // audience anchor (idempotent). This makes the CLI/dev baseline
        // (`fallbackPermissionSet` — the app's `isDefault` set) visible as an
        // ordinary position binding: same table, same audit path, same explain
        // surface as any admin-authored default grant. The binding is validated
        // with the SAME high-privilege predicate the write gate enforces — a
        // dangerous baseline is refused loudly, never seeded. MUST run after
        // `bootstrapBuiltinRoles` (which seeds the `everyone` anchor) and before
        // `syncAudienceBindingSuggestions` (so the app's own fallback set is
        // already bound and never generates a redundant pending suggestion).
        //
        // [#7555] Every name in the COMPOSED baseline is bound, not just the
        // declared one — the join table takes many rows per position, and the
        // explain surface's whole job is to answer "what does a new member get"
        // truthfully. Binding only the app's set while `member_default` also
        // resolves at request time would make `security/explain` report a
        // narrower default than the runtime actually applies. The refusal is
        // PER SET: a high-privilege name is skipped loudly and the rest still
        // bind (the D5/D9 anchor gate is untouched, and each set faces it).
        try {
          for (const baselineName of this.baselinePermissionSets) {
            const boot = this.bootstrapPermissionSets.find((p) => p.name === baselineName);
            const offending = boot ? describeHighPrivilegeBits(boot) : null;
            if (offending) {
              ctx.logger.warn('[security] refusing to bind fallback set to everyone — high-privilege bits', {
                set: baselineName, offending,
              });
              continue;
            }
            const everyoneRows = await ql.find('sys_position', { where: { name: 'everyone' }, limit: 1, context: { isSystem: true } });
            const everyone: any = Array.isArray(everyoneRows) && everyoneRows[0] ? everyoneRows[0] : null;
            const setRows = await ql.find('sys_permission_set', { where: { name: baselineName }, limit: 1, context: { isSystem: true } });
            const set: any = Array.isArray(setRows) && setRows[0] ? setRows[0] : null;
            if (everyone?.id && set?.id) {
              const existing = await ql.find('sys_position_permission_set', {
                where: { position_id: everyone.id, permission_set_id: set.id }, limit: 1, context: { isSystem: true },
              });
              if (!(Array.isArray(existing) && existing[0])) {
                await ql.insert('sys_position_permission_set', {
                  id: `pps_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
                  position_id: everyone.id,
                  permission_set_id: set.id,
                }, { context: { isSystem: true } });
                ctx.logger.info('[security] baseline set bound to everyone anchor (ADR-0090 D5)', { set: baselineName });
              }
            }
          }
        } catch (e) {
          ctx.logger.warn('[security] everyone-anchor baseline binding failed (non-fatal)', { error: (e as Error).message });
        }
        // [ADR-0090 D5/D9] Reconcile the suggested-audience-binding surface:
        // every declared `isDefault: true` set that is not already bound to
        // its anchor becomes a PENDING suggestion row awaiting admin
        // confirmation — never auto-bound. Runs after the anchors are seeded
        // and after the baseline binding above, so the app's own fallback set
        // (already bound) never nags.
        try {
          await syncAudienceBindingSuggestions(ql, this.metadata, ctx.logger);
        } catch (e) {
          ctx.logger.warn('[security] audience-binding suggestion sync failed (non-fatal)', { error: (e as Error).message });
        }
        // [ADR-0066 D1] Seed the capability registry (sys_capability) in two
        // passes. FIRST the EXPLICIT package declarations (`defineCapability` /
        // `stack.capabilities`) land with `managed_by:'package'` + package_id
        // provenance — the formal replacement for the implicit derive-from-
        // systemPermissions back-door. THEN the platform curated set + the
        // back-compat derived defaults, SKIPPING any name that already HAS a row
        // (so the placeholder never clobbers the authored capability).
        // [#4967 Part 1] The skip list is the names the first pass confirmed are
        // materialized — not every name it read. A declaration the first pass
        // REFUSES (no owning package) writes no row, so skipping its derivation
        // too left the capability existing nowhere and every grant naming it
        // inert; it now falls through to the placeholder. The permission sets are
        // passed to the first pass as well, so a refusal can name the grantor(s)
        // it affects (#4967 Part 3).
        let materializedCapabilityNames: string[] = [];
        try {
          const capOutcome = await bootstrapDeclaredCapabilities(ql, this.metadata, {
            logger: ctx.logger,
            permissionSets: this.bootstrapPermissionSets,
          });
          materializedCapabilityNames = capOutcome.materializedNames;
        } catch (e) {
          ctx.logger.warn('[security] declared-capability seeding failed', { error: (e as Error).message });
        }
        try {
          await bootstrapSystemCapabilities(ql, this.bootstrapPermissionSets, {
            logger: ctx.logger,
            materializedCapabilityNames,
          });
        } catch (e) {
          ctx.logger.warn('[security] capability seeding failed', { error: (e as Error).message });
        }
        // [A4 #2920] Heal residual legacy `managed_by` values (env sets stamped
        // 'user'; older positions stamped system/config/user) onto the unified
        // platform/package/admin vocab. Runs after the seeders so their canonical
        // writes land first; idempotent and non-fatal.
        try {
          await normalizeManagedByVocab(ql, { logger: ctx.logger });
        } catch (e) {
          ctx.logger.warn('[security] managed_by vocab normalization failed (non-fatal)', { error: (e as Error).message });
        }
        bootstrapRanOnce = true;
        ctx.logger.info('[security] platform bootstrap complete', report);
        return report;
      } catch (e) {
        ctx.logger.warn('[security] platform bootstrap failed', { error: (e as Error).message });
        return undefined;
      }
    };
    if (typeof (ctx as any).hook === 'function') {
      (ctx as any).hook('kernel:ready', runBootstrap);
    } else {
      void runBootstrap();
    }

    // Re-run bootstrap after a sys_user insert so the FIRST user that
    // signs up after boot is auto-promoted to platform admin (and, in
    // multi-tenant mode, bound to the seeded default organization)
    // without requiring a server restart. The function itself is
    // idempotent and bails out as soon as any platform admin exists.
    //
    // We deliberately do NOT auto-create a "personal workspace" for
    // every subsequent self-service signup. In a B2B / invitation-
    // driven product (the framework's primary target), users must
    // either accept an invitation or explicitly create their first
    // organization. The account UI's /register flow already routes
    // users with zero memberships to /organizations/new for exactly
    // this case.
    ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      await next();
      if (
        opCtx?.object === 'sys_user' &&
        (opCtx?.operation === 'create' || opCtx?.operation === 'insert')
      ) {
        if (bootstrapRanOnce) {
          await runBootstrap();
        }
      }
    });

    // ── Auto-grant `organization_admin` on sys_member lifecycle ─────────
    //
    // For every `sys_member` row whose role is `owner` or `admin`, keep
    // a `sys_user_permission_set` row scoped to that organization in
    // sync. See `auto-org-admin-grant.ts` for the full rationale and
    // the anti-escalation argument (org_admin is read-only on the
    // global RBAC tables, so a freshly-granted admin cannot rebind
    // themselves to `admin_full_access`).
    //
    // We register one middleware that handles insert / update / delete
    // uniformly by always reconciling every (user, org) pair touched
    // by the operation. `reconcileOrgAdminGrant` is idempotent so a
    // double-fire (e.g. better-auth followed by an org plugin
    // synchronizer) is harmless.
    ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      await next();
      if (opCtx?.object !== 'sys_member') return;
      const op = opCtx?.operation;
      if (
        op !== 'insert' &&
        op !== 'create' &&
        op !== 'update' &&
        op !== 'delete' &&
        op !== 'remove'
      ) {
        return;
      }
      const pairs = extractMemberPairs(opCtx);
      // [#4586] Carry the triggering write's ATTRIBUTED human into the grant.
      // better-auth's membership writes authorize as the system on purpose, so
      // `opCtx.context.userId` is empty by construction and `granted_by` was
      // always null; `attributedUserId` is the channel that does name the
      // admin who clicked. Read as attribution only — it decides nothing about
      // whether this reconcile may run, and the reconciler's own writes stay
      // system-context.
      const attributedUserId =
        typeof opCtx?.context?.attributedUserId === 'string' && opCtx.context.attributedUserId
          ? opCtx.context.attributedUserId
          : undefined;
      for (const { userId, orgId } of pairs) {
        try {
          await reconcileOrgAdminGrant(ql, userId, orgId, {
            logger: ctx.logger,
            posture: this.tenancyPosture,
            ...(attributedUserId ? { attributedUserId } : {}),
          });
        } catch (e) {
          ctx.logger.warn?.('[security] org_admin reconcile failed', {
            userId,
            orgId,
            error: (e as Error).message,
          });
        }
      }
    });

    // Backfill organization_admin grants after the platform admin
    // bootstrap settles on kernel:ready. Idempotent — only inserts
    // missing rows and revokes orphaned ones, never duplicates.
    const runOrgAdminBackfill = async () => {
      try {
        await backfillOrgAdminGrants(ql, { logger: ctx.logger, posture: this.tenancyPosture });
      } catch (e) {
        ctx.logger.warn?.('[security] organization_admin backfill failed', {
          error: (e as Error).message,
        });
      }
    };
    if (typeof (ctx as any).hook === 'function') {
      (ctx as any).hook('kernel:ready', runOrgAdminBackfill);
    } else {
      void runOrgAdminBackfill();
    }

    // Per-organization seed data replay on `sys_organization` insert
    // moved to `@objectstack/organizations` (along with
    // `claimOrphanOrgRows` / `cloneOrgSeedData`). Install that
    // plugin for multi-tenant deployments.
  }

  async destroy(): Promise<void> {
    this.metadataWatch?.unsubscribe();
    this.metadataWatch = null;
  }

  /**
   * ADR-0021 D-C — resolve the per-request READ scope (tenant + RLS predicate)
   * for one object as a canonical `FilterCondition`, WITHOUT touching the
   * ObjectQL engine. This is the seam the analytics raw-SQL path bridges to so
   * it enforces the SAME row scoping the engine middleware applies on `find`.
   *
   * Returns:
   *   - `undefined` → no scope applies (system context, or an unauthenticated
   *     request with no userId/positions/permissions — authn is gated elsewhere).
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
   * someone else) requires the caller to hold `manage_users`, be system, or —
   * [D12] — hold a delegated `adminScope` whose BU subtree covers the target
   * user (an access report is itself sensitive data, but an admin who can
   * already rewire a user's grants may read why they resolve as they do).
   * The evaluation delegates to {@link explainAccess} with the SAME internals
   * the middleware uses.
   */
  async explainAccessForCaller(
    request: { object: string; operation: string; userId?: string; recordId?: string },
    callerContext?: any,
  ): Promise<ExplainDecision> {
    const operation = String(request?.operation ?? 'read') as ExplainOperation;
    const object = String(request?.object ?? '');
    if (!object) throw new Error('[Security] explain: request.object is required');
    const recordId = request?.recordId != null && request.recordId !== '' ? String(request.recordId) : undefined;

    let targetContext = callerContext ?? {};
    if (request.userId && request.userId !== callerContext?.userId) {
      const callerIsSystem = callerContext?.isSystem === true;
      if (!callerIsSystem) {
        const callerSets = await this.resolvePermissionSetsForContext(callerContext).catch(() => []);
        const held = this.permissionEvaluator.getSystemPermissions(callerSets);
        if (!held.has('manage_users')) {
          // [ADR-0090 D12] Delegated administrators may explain principals
          // inside their delegation boundary (fail-closed on any error).
          const delegated = this.delegatedAdminGate
            ? await this.delegatedAdminGate
                .scopesCoverUser(callerSets, request.userId)
                .catch(() => false)
            : false;
          if (!delegated) {
            throw new PermissionDeniedError(
              `[Security] Access denied: explaining another user's access requires the 'manage_users' ` +
                `capability or a delegated adminScope covering that user (ADR-0090 D6/D12).`,
              { object, operation, targetUserId: request.userId },
            );
          }
        }
      }
      targetContext = await buildContextForUser(this.ql, request.userId);
    }

    // [C2 / ADR-0095] The optional `sharing` service backs the record-grained
    // sharing attribution. Resolved lazily; absent (no plugin-sharing) → the
    // record path still works, the sharing layer simply reports not_evaluated.
    const sharing = recordId ? (this.resolveKernelService?.('sharing') as any) : undefined;

    return explainAccess(
      {
        ql: this.ql,
        resolveSets: (c: any) => this.resolvePermissionSetsForContext(c),
        evaluator: this.permissionEvaluator,
        getObjectSecurityMeta: (o: string) => this.getObjectSecurityMeta(o),
        requiredCaps: (meta: any, engineOp: string) => requiredCapsForOperation(meta, engineOp),
        computeRlsFilter: (sets, o, engineOp, c) => this.computeRlsFilter(sets as any, o, engineOp, c),
        getFieldMask: (sets, o, fieldRequired) => {
          let fp = this.permissionEvaluator.getFieldPermissions(o, sets as any);
          fp = this.foldFieldRequiredPermissions(fp, fieldRequired, sets as any);
          return fp as any;
        },
        baselinePermissionSets: this.baselinePermissionSets,
        // ── record-grained deps (only consulted when recordId is present) ──
        computeLayeredRlsFilter: (sets, o, engineOp, c) => this.computeLayeredRlsFilter(sets as any, o, engineOp, c),
        fetchRecord: async (o: string, rid: string) => {
          try {
            const finder = this.ql?.findOne
              ? this.ql.findOne(o, { where: { id: rid }, context: { isSystem: true } })
              : this.ql?.find?.(o, { where: { id: rid }, limit: 1, context: { isSystem: true } });
            const res = await finder;
            const row = Array.isArray(res) ? res[0] : res;
            return row ?? null;
          } catch {
            return null;
          }
        },
        ...(sharing && typeof sharing.buildReadFilter === 'function'
          ? { sharingReadFilter: (o: string, c: any) => sharing.buildReadFilter(o, c) }
          : {}),
        ...(sharing && typeof sharing.listShares === 'function'
          // [ADR-0111 D5] listShares is now management-gated in the sharing
          // service, but explain's own caller authorization already ran
          // (explaining ANOTHER user requires `manage_users` — D12). Read the
          // stored rows under system context so the record story keeps its
          // share attribution when the EXPLAINED principal isn't a share
          // manager — the exact behaviour this binding had before the gate.
          ? { listRecordShares: (o: string, rid: string) => sharing.listShares(o, rid, { isSystem: true }) }
          : {}),
        ...(sharing && typeof sharing.canEdit === 'function'
          ? { canEditRecord: (o: string, rid: string, c: any) => sharing.canEdit(o, rid, c) }
          : {}),
        // [ADR-0111 D3] The narrower delete gate — an edit share opens update
        // but not delete, so a delete explanation must consult this.
        ...(sharing && typeof sharing.canDelete === 'function'
          ? { canDeleteRecord: (o: string, rid: string, c: any) => sharing.canDelete(o, rid, c) }
          : {}),
      },
      { object, operation, context: targetContext, recordId },
    );
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
  private async resolveSharingReadFilter(
    object: string,
    context: any,
    resolvedSets?: PermissionSet[],
  ): Promise<Record<string, unknown> | null> {
    const sharing = this.resolveKernelService?.('sharing') as
      | { buildReadFilter?: (o: string, c: any) => Promise<unknown | null> }
      | undefined;
    if (!sharing || typeof sharing.buildReadFilter !== 'function') return null;
    // Mirror the middleware's ADR-0057 D1 depth stash. `getEffectiveScope`
    // needs the resolved sets and the object's posture — the same two inputs
    // the middleware feeds it — so the owner-match widens identically here.
    // [#5386] `resolvedSets` lets an in-middleware caller (the
    // controlled_by_parent derivation) pass the sets it already resolved for
    // THIS identity, instead of re-resolving them from the context.
    let readScope: string | undefined;
    try {
      const permissionSets = resolvedSets ?? (await this.resolvePermissionSetsForContext(context));
      if (permissionSets.length > 0) {
        const meta = await this.getObjectSecurityMeta(object);
        readScope = this.permissionEvaluator.getEffectiveScope(
          'read',
          object,
          permissionSets,
          { isPrivate: meta.isPrivate },
        );
      }
    } catch {
      // Depth is a WIDENING input: failing to resolve it leaves the owner-match
      // at its narrowest ('own'), which is the safe direction. The sharing call
      // below still runs — and its own failure still denies.
      readScope = undefined;
    }
    const filter = await sharing.buildReadFilter(object, {
      ...context,
      ...(readScope ? { __readScope: readScope } : {}),
    });
    return (filter ?? null) as Record<string, unknown> | null;
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
  private async resolveSharingCanEdit(
    object: string,
    recordId: string,
    context: any,
    resolvedSets?: PermissionSet[],
  ): Promise<boolean> {
    const sharing = this.resolveKernelService?.('sharing') as
      | { canEdit?: (o: string, id: string, c: any) => Promise<boolean> }
      | undefined;
    if (!sharing || typeof sharing.canEdit !== 'function') return true;
    const writeScope = await this.resolveWriteScopeForSharing(object, context, resolvedSets);
    try {
      return (
        (await sharing.canEdit(object, recordId, { ...context, __writeScope: writeScope })) === true
      );
    } catch (e) {
      this.logger.error?.(
        `[security] controlled_by_parent write gate could not resolve the sharing (OWD) edit ` +
          `check for '${object}' record '${recordId}' (user ${context?.userId ?? 'unknown'}) — ` +
          `denying (fail-closed, #5386)`,
        e instanceof Error ? e : new Error(String(e)),
      );
      return false;
    }
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
  private async resolveWriteScopeForSharing(
    object: string,
    context: any,
    resolvedSets?: PermissionSet[],
  ): Promise<string | undefined> {
    try {
      const permissionSets = resolvedSets ?? (await this.resolvePermissionSetsForContext(context));
      if (permissionSets.length === 0) return undefined;
      const meta = await this.getObjectSecurityMeta(object);
      return this.permissionEvaluator.getEffectiveScope(
        'write',
        object,
        permissionSets,
        { isPrivate: meta.isPrivate },
      );
    } catch {
      return undefined;
    }
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
  private async resolveSharingWriteVerdict(
    rlsOperation: string,
    object: string,
    recordId: string,
    context: any,
    resolvedSets?: PermissionSet[],
  ): Promise<SharingWriteVerdict> {
    const method = rlsOperation === 'delete' ? 'checkDelete' : 'checkEdit';
    const sharing = this.resolveKernelService?.('sharing') as
      | Record<string, ((o: string, id: string, c: any) => Promise<SharingWriteVerdict>) | undefined>
      | undefined;
    const probe = sharing?.[method];
    if (typeof probe !== 'function') return 'abstain';
    const writeScope = await this.resolveWriteScopeForSharing(object, context, resolvedSets);
    try {
      const verdict = await probe.call(sharing, object, recordId, {
        ...context,
        __writeScope: writeScope,
      });
      return verdict === 'allow' || verdict === 'deny' ? verdict : 'abstain';
    } catch (e) {
      this.logger.error?.(
        `[security] the row-level write gate could not resolve the sharing (${method}) verdict ` +
          `for '${object}' record '${recordId}' (user ${context?.userId ?? 'unknown'}) — keeping ` +
          `the platform ownership floor (fail-closed, #5492)`,
        e instanceof Error ? e : new Error(String(e)),
      );
      return 'deny';
    }
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
  async checkAuthoredRowWrite(
    object: string,
    recordId: string,
    operation: AuthoredRowWriteOperation,
    context?: any,
  ): Promise<AuthoredRowWriteVerdict> {
    try {
      if (!object || recordId == null || recordId === '') return 'abstain';
      if (operation !== 'update' && operation !== 'delete') return 'abstain';
      if (!this.ql) return 'abstain';
      // No principal, or a delegated identity this path cannot intersect —
      // both are "cannot measure", which is `abstain` (never `admit`).
      if (!context?.userId) return 'abstain';
      if (context?.onBehalfOf?.userId) return 'abstain';

      const permissionSets = await this.resolvePermissionSetsForContext(context);
      if (permissionSets.length === 0) return 'abstain';

      // Cheap provenance pre-check: if the caller holds NO app-authored policy
      // applicable to (object, operation), there is nothing that could admit by
      // declaration — answer without spending a database round-trip. This is
      // the same collection the compiler consumes, filtered by the same
      // provenance predicate, so the two cannot disagree about what "authored"
      // means.
      const authored = this.collectRLSPolicies(
        permissionSets,
        object,
        operation,
        (context?.positions ?? []) as string[],
      ).filter((p) => !isPlatformOwnershipFloorPolicy(p));
      if (authored.length === 0) return 'abstain';

      const { layer0, layer1 } = await this.computeLayeredRlsFilter(
        permissionSets,
        object,
        operation,
        context,
        { dropPlatformOwnershipFloor: true },
      );
      // See the doc above: a null Layer 1 means no authored predicate is
      // gating this write, which is an abstention and not an admission.
      if (layer1 == null) return 'abstain';

      const parts = [{ id: recordId }, ...(layer0 ? [layer0] : []), layer1];
      // [#7281] The predicate is the question; the scope is not. Read ELEVATED
      // (see AUTHORED_ROW_WRITE_PROBE_CONTEXT) so the answer is decided by
      // `{id} AND layer0 AND layer1` alone, and projected to `id` so the probe
      // can only ever learn EXISTENCE — no column of a row the caller may not
      // read is materialised, let alone returned. The verdict remains evidence,
      // never authorization: the by-id write pre-image gate still resolves the
      // write under the caller's own context.
      const row = await this.ql.findOne(object, {
        where: { $and: parts },
        fields: ['id'],
        context: { ...AUTHORED_ROW_WRITE_PROBE_CONTEXT },
      });
      return row ? 'admit' : 'abstain';
    } catch (e) {
      this.logger.warn?.(
        `[security] checkAuthoredRowWrite could not resolve an authored-policy verdict for ` +
          `'${object}' record '${recordId}' (${operation}, user ${context?.userId ?? 'unknown'}) — ` +
          `abstaining (fail-closed, #5493)`,
        e instanceof Error ? e : new Error(String(e)),
      );
      return 'abstain';
    }
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
   *      (accessible master ids)`;
   *   3. {@link resolveSharingReadFilter} — plugin-sharing's OWD / record-share
   *      visibility filter, contributed by the sibling middleware.
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
   */
  async getReadFilter(
    object: string,
    context?: any,
  ): Promise<Record<string, unknown> | undefined> {
    // System operations bypass scoping (mirrors the middleware's isSystem skip).
    if (context?.isSystem) return undefined;
    const positions = context?.positions ?? [];
    const explicit = context?.permissions ?? [];
    // [#4467] The OWD/sharing predicate is resolved for EVERY non-system caller,
    // ahead of the RLS branches below, because it is a SEPARATE middleware in
    // the chain this method mirrors: none of the RLS stand-downs below is a
    // reason to drop it. A resolution failure denies outright — running the
    // analytics raw-SQL path with a dropped owner predicate is the leak.
    let sharingFilter: Record<string, unknown> | null;
    try {
      sharingFilter = await this.resolveSharingReadFilter(object, context);
    } catch (e) {
      this.logger.error?.(
        `[security] getReadFilter could not resolve the sharing (OWD) read scope for object ` +
          `'${object}' (user ${context?.userId ?? 'unknown'}) — denying (fail-closed, #4467)`,
        e instanceof Error ? e : new Error(String(e)),
      );
      return { ...RLS_DENY_FILTER };
    }
    // Unauthenticated + position-less + permission-less → no RLS scope (the auth
    // layer, not RLS, gates anonymous access; the analytics REST endpoint
    // already 401s without a token). Mirrors the middleware's early `return next()`
    // — which is the RLS middleware's early exit only, so the sharing predicate
    // resolved above still applies.
    // [#5815] The controlled_by_parent derivation is deliberately NOT resolved
    // ahead of this branch the way the sharing predicate is: it stands down
    // without a `userId` (`computeControlledByParentFilter` returns null), and
    // this branch is reached only when there is none — so the middleware adds
    // nothing here either. Agreement holds by both sides standing down.
    if (positions.length === 0 && explicit.length === 0 && !context?.userId) {
      return sharingFilter ?? undefined;
    }
    // [#2852] D10 delegator intersection is NOT implemented on this path.
    // The engine middleware (find/count/aggregate) intersects an on-behalf-of
    // read with the DELEGATOR's own RLS (resolveDelegatorContext, ~L689), but
    // getReadFilter — the read-scope provider bound by the analytics/raw-SQL
    // path — resolves only the CALLER's ceiling. Computing a filter here for a
    // delegated (agent) context would therefore SILENTLY WIDEN the read past
    // the delegator's scope (the confused-deputy widening D10 prevents on the
    // CRUD path). Until the intersection is threaded through computeRlsFilter
    // (tracked with #2920 B1 / ADR-0095 D1), FAIL CLOSED: a delegated read on
    // this path denies rather than under-scopes. System on-behalf-of already
    // returned above; today no agent surface reaches analytics, so this is a
    // latent-invariant guard, not a live-traffic change.
    if (context?.onBehalfOf?.userId) {
      this.logger.error?.(
        `[security] getReadFilter received an on-behalf-of context for object ` +
          `'${object}' (agent ${context?.userId ?? 'unknown'} on behalf of ` +
          `${context.onBehalfOf.userId}) — the D10 delegator intersection is not ` +
          `implemented on the read-scope path; denying (fail-closed, #2852)`,
      );
      return { ...RLS_DENY_FILTER };
    }
    try {
      const permissionSets = await this.resolvePermissionSetsForContext(context);
      const filter = await this.computeRlsFilter(permissionSets, object, 'find', context);
      // [#5815] ADR-0055 — the SECOND thing the middleware ANDs into `ast.where`
      // for a read. Resolved from the sets already resolved above, exactly as
      // the middleware feeds it its own, so the derived master id set is
      // computed for this identity once and never re-resolved. It stands down
      // (null) for any object that is not controlled_by_parent, and it is
      // internally fail-closed; a THROW propagates to the catch below, which
      // denies — the same posture as the surrounding layers.
      const cbpFilter = await this.computeControlledByParentFilter(
        permissionSets,
        object,
        context,
      );
      // [#4467] RLS AND controlled-by-parent AND sharing — the same
      // AND-composition the middlewares achieve by all writing into `ast.where`.
      // Any layer may be absent; `andComposeLayers` returns the others, or null
      // when none constrains.
      return andComposeLayers(andComposeLayers(filter, cbpFilter), sharingFilter) ?? undefined;
    } catch (e) {
      // Fail CLOSED — a resolution failure must deny (zero rows), never expose
      // every tenant's data through the raw-SQL analytics path.
      this.logger.error?.(
        `[security] getReadFilter failed for object '${object}' ` +
          `(user ${context?.userId ?? 'unknown'}) — denying (fail-closed)`,
        e instanceof Error ? e : new Error(String(e)),
      );
      return { ...RLS_DENY_FILTER };
    }
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
   * Why the two differ rather than converge. `getReadableFields` mirrors the
   * engine middleware, which skips its whole gate for a caller with no
   * permission sets — reporting a narrowing the data path would not enforce is
   * its own kind of drift, so on the DATA plane falling open is the correct,
   * drift-free answer. The metadata plane has no such symmetry to preserve: the
   * question there is disclosure, and ADR-0106 D7 rules that a public/guest
   * deployment's schema exposure must be a deliberate permission-set decision
   * rather than an accidental everything-default. Anonymous callers on a
   * `requireAuth` deployment are blocked before any of this.
   *
   * Still falls open when the fallback set itself resolves to nothing (no
   * `member_default` in the deployment at all) — that is the "no FLS posture
   * here" tier, not a restricted caller.
   */
  async getMetadataReadableFields(object: string, context?: any): Promise<string[] | undefined> {
    return this.computeReadableFields(object, context, { fallbackOnEmptySets: true });
  }

  private async computeReadableFields(
    object: string,
    context: any,
    options: { fallbackOnEmptySets: boolean },
  ): Promise<string[] | undefined> {
    const objectName = String(object ?? '');
    if (!objectName) return undefined;
    // The field universe — the SAME source the RLS field pass uses (ObjectQL's
    // live SchemaRegistry first, metadata artifact fallback). `null` → schema
    // not resolvable → let the caller fall back rather than guess.
    const fieldNameSet = await this.getObjectFieldNames(this.metadata, objectName, this.ql);
    if (!fieldNameSet) return undefined;
    const allFields = [...fieldNameSet];
    // System operations bypass FLS (mirrors the middleware's isSystem skip).
    if (context?.isSystem) return allFields;

    let permissionSets = await this.resolvePermissionSetsForContext(context);
    if (permissionSets.length === 0 && options.fallbackOnEmptySets) {
      // [ADR-0106 D7] `resolvePermissionSetsForContext` applies the baseline
      // only for a caller carrying `userId`, so a guest/anonymous caller lands
      // here with nothing. Resolve the configured fallback set explicitly —
      // the same two-step `/auth/me/permissions` performs.
      permissionSets = await this.resolveFallbackPermissionSets();
    }
    // No sets resolved (e.g. unauthenticated) → no field mask applies, exactly
    // as the middleware (getFieldPermissions([]) === {} → nothing deleted).
    if (permissionSets.length === 0) return allFields;

    const secMeta = await this.getObjectSecurityMeta(objectName);
    // [#3545] Posture unresolvable → expose no columns, the same fail-closed
    // stance this method already takes on a dangling delegator below. The
    // per-field capability contract (`fieldRequiredPermissions`) would otherwise
    // default to empty and silently unmask every capability-gated column.
    if (secMeta.unresolved) return [];
    let fieldPerms = this.permissionEvaluator.getFieldPermissions(objectName, permissionSets);
    fieldPerms = this.foldFieldRequiredPermissions(fieldPerms, secMeta.fieldRequiredPermissions, permissionSets);

    // [ADR-0090 D10] On an on-behalf-of read the readable set must NOT widen
    // past what the DELEGATOR can read — intersect the delegator's field mask
    // too. A dangling delegator fails CLOSED (expose no columns), the same
    // fail-closed stance the CRUD middleware takes on a 'missing' delegator.
    if (context?.onBehalfOf?.userId) {
      const del = await resolveDelegatorContext(this.ql, context);
      if (del.kind === 'missing') return [];
      if (del.kind === 'resolved') {
        const delegatorSets = await this.resolvePermissionSetsForContext(del.context);
        let delFieldPerms = this.permissionEvaluator.getFieldPermissions(objectName, delegatorSets);
        delFieldPerms = this.foldFieldRequiredPermissions(delFieldPerms, secMeta.fieldRequiredPermissions, delegatorSets);
        fieldPerms = intersectFieldMasks(fieldPerms, delFieldPerms);
      }
    }

    // Readable = every schema field NOT explicitly masked non-readable. A field
    // with no permission entry passes through (the field allow-list only
    // enumerates fields it names) — the exact complement of maskResults' delete
    // set, so the export header matches list's readable columns by construction.
    return allFields.filter((f) => fieldPerms[f]?.readable !== false);
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
   * denies, and callers must treat a throw as a denial. `isSystem` bypasses, and
   * so does an empty set resolution — the middleware skips its CRUD gate
   * entirely for a caller with no permission sets, and reporting a denial the
   * data path would not enforce is its own kind of drift.
   */
  async canExport(object: string, context?: any): Promise<boolean> {
    const objectName = String(object ?? '');
    if (!objectName) return false;
    // System operations bypass (mirrors the middleware's isSystem skip).
    if (context?.isSystem) return true;

    const permissionSets = await this.resolvePermissionSetsForContext(context);
    // No sets resolved (e.g. unauthenticated, or a deployment with no sets) →
    // no permission-set restriction applies, exactly as the middleware treats it
    // (`if (permissionSets.length > 0)` guards its whole CRUD gate).
    if (permissionSets.length === 0) return true;

    const { isPrivate, unresolved } = await this.getObjectSecurityMeta(objectName);
    // [#3545] Posture unresolvable → deny. `isPrivate` would default to `false`,
    // which is precisely what lets a plain wildcard reach the object; a bulk
    // egress decision must not rest on a default we could not read.
    if (unresolved) return false;
    if (!this.permissionEvaluator.checkObjectPermission('export', objectName, permissionSets, { isPrivate })) {
      return false;
    }

    // [ADR-0090 D10] An on-behalf-of caller may never export past what the
    // DELEGATOR could have exported themselves — intersect the delegator's own
    // answer. A dangling delegator fails CLOSED, the same stance the CRUD
    // middleware and {@link getReadableFields} take.
    if (context?.onBehalfOf?.userId) {
      const del = await resolveDelegatorContext(this.ql, context);
      if (del.kind === 'missing') return false;
      if (del.kind === 'resolved') {
        const delegatorSets = await this.resolvePermissionSetsForContext(del.context);
        if (
          delegatorSets.length > 0 &&
          !this.permissionEvaluator.checkObjectPermission('export', objectName, delegatorSets, { isPrivate })
        ) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Resolve the effective permission sets for an execution context — positions +
   * explicit permission sets, with the configured baseline applied both as an
   * implicit request (when none were named) and as a post-resolution fallback
   * (when named ones resolved to nothing). Shared by the engine middleware and
   * {@link getReadFilter} so both enforce identical RLS. May throw if the
   * underlying metadata/db resolution fails (callers fail-closed).
   */
  private async resolvePermissionSetsForContext(
    context: any,
  ): Promise<PermissionSet[]> {
    const positions = context?.positions ?? [];
    const explicitPermissionSets = context?.permissions ?? [];
    const requested = [...positions, ...explicitPermissionSets];
    // [ADR-0090 D10] An AGENT principal's grants are EXACTLY its scope-derived
    // ceiling set(s) — the additive human baseline (member_default) must NOT
    // apply, or its write bit would silently widen a read-only agent past the
    // scope the user consented to. The agent's floor is instead the restricted
    // (no-object-access) set, so an agent whose sets fail to resolve fails
    // CLOSED (every object op denied) rather than falling open. The delegating
    // user's own baseline still applies on the OTHER side of the intersection
    // (resolved from `onBehalfOf` via a context without this flag).
    const isAgent = context?.principalKind === 'agent';
    // [#7555] The human side is a LIST, and the agent side deliberately is not:
    // the agent's ceiling is EXACTLY the restricted set, and composing the
    // platform baseline into it is precisely the widening D10 forbids. The two
    // branches produce arrays only so the code below reads once.
    const baseline: string[] = isAgent
      ? [MCP_AGENT_PERMISSION_SET_RESTRICTED]
      : this.baselinePermissionSets;
    // [ADR-0090 D5] Baseline is ADDITIVE, always (for humans): the baseline
    // set(s) apply to every authenticated request IN ADDITION to whatever else
    // resolved. The former "only when the user has nothing else" conditional
    // was the fallback CLIFF — receiving your first explicit grant silently
    // cost you the entire baseline. Agents skip this additive step (their
    // ceiling is closed, not floored) — see above.
    // [#7555] The same cliff had a second spelling the list closes: an app
    // declaring an `isDefault` set REPLACED `member_default` here, so every
    // member of that app lost the platform floor (and with it every built-in
    // Account destination) the moment the app declared a posture of its own.
    if (!isAgent && context?.userId) {
      for (const name of baseline) {
        if (!requested.includes(name)) requested.push(name);
      }
    }
    let permissionSets = await this.permissionEvaluator.resolvePermissionSets(
      requested,
      this.metadata,
      this.bootstrapPermissionSets,
      this.dbLoader,
      { logger: this.logger },
    );
    // Post-resolution fallback — closes the fail-open hole where a populated
    // `positions` array maps to no permission set yet (no sys_position binding),
    // which would otherwise skip RLS entirely and expose every tenant's data.
    // For an agent, the fallback is the restricted set (deny all objects), NOT
    // the human baseline — a mis-resolved agent must never inherit member access.
    if (
      permissionSets.length === 0 &&
      context?.userId &&
      baseline.length > 0
    ) {
      permissionSets = await this.permissionEvaluator.resolvePermissionSets(
        baseline,
        this.metadata,
        this.bootstrapPermissionSets,
        this.dbLoader,
        { logger: this.logger },
      );
    }
    return permissionSets;
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
   */
  private async resolveFallbackPermissionSets(): Promise<PermissionSet[]> {
    const fallback = this.baselinePermissionSets;
    if (fallback.length === 0) return [];
    return this.permissionEvaluator.resolvePermissionSets(
      fallback,
      this.metadata,
      this.bootstrapPermissionSets,
      this.dbLoader,
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
   * [ADR-0086 P2 — 块2, evolved by ADR-0094] Two-doors data-layer gate for
   * `sys_permission_set`.
   *
   * A row with `managed_by:'package'` is owned by the package door (its
   * baseline is authored in the package, materialized on publish). This gate
   * refuses (a) FORGING that provenance through the admin door — insert or
   * update, single object or array — and (b) the lifecycle ops with no
   * overlay translation (`transfer`/`restore`/`purge`) on package rows.
   * Ordinary `update`/`delete` pass through: the ADR-0094 write-through
   * downstream translates them into env-scope overlay operations (customize /
   * reset), and re-asserts the refusal itself when the kernel has no metadata
   * overlay layer. Fails CLOSED and never depends on the caller's grants, so
   * a platform admin with `modifyAllRecords` cannot forge provenance either.
   * System/boot writes never reach here (the middleware short-circuits on
   * `isSystem`), so the seeder and the publish materializer are unaffected.
   */
  /**
   * [ADR-0090 D5/D9] Reject binding a HIGH-PRIVILEGE permission set to an
   * audience anchor (`everyone` / `guest`). The anchors are implicit for
   * whole principal classes, so a dangerous binding here is an instant
   * tenant-wide (or anonymous-wide) grant — the one shape the model must
   * make unrepresentable rather than merely discouraged.
   */
  private async assertAudienceAnchorBindingGate(opCtx: any): Promise<void> {
    if (opCtx?.object !== 'sys_position_permission_set') return;
    if (!['insert', 'update'].includes(opCtx.operation)) return;
    const rows = Array.isArray(opCtx.data)
      ? opCtx.data
      : (opCtx.data && typeof opCtx.data === 'object' ? [opCtx.data] : []);
    if (rows.length === 0) return;

    const ql = this.ql;
    for (const row of rows) {
      const positionId = (row as any)?.position_id;
      if (!positionId || !ql?.find) continue;
      let positionName = '';
      try {
        const posRows = await ql.find('sys_position', { where: { id: positionId }, limit: 1, context: { isSystem: true } });
        positionName = String((Array.isArray(posRows) && posRows[0] ? (posRows[0] as any).name : '') ?? '');
      } catch { positionName = ''; }
      if (positionName !== 'everyone' && positionName !== 'guest') continue;

      // Resolve the target set definition (bootstrap sets by name, else the
      // sys_permission_set row itself carries the authored definition).
      const setId = (row as any)?.permission_set_id;
      let setName = '';
      let setDef: any = null;
      try {
        const setRows = await ql.find('sys_permission_set', { where: { id: setId }, limit: 1, context: { isSystem: true } });
        const sr: any = Array.isArray(setRows) && setRows[0] ? setRows[0] : null;
        if (sr) {
          setName = String(sr.name ?? '');
          setDef = sr;
        }
      } catch { /* fall through to bootstrap lookup below */ }
      const boot = this.bootstrapPermissionSets.find((p) => p.name === setName);
      // [ADR-0090 D9] Anchor-tier predicate: `guest` faces the strictest tier
      // (additionally no edit bit — read-only by default, create is the single
      // case-by-case write); `everyone` uses the high-privilege predicate.
      const offending = describeAnchorForbiddenBits(boot ?? setDef, positionName as 'everyone' | 'guest');
      if (offending) {
        throw new PermissionDeniedError(
          `[Security] Access denied: permission set '${setName || setId}' cannot be bound to the '${positionName}' audience anchor — it carries ${offending} (ADR-0090 D5/D9). ` +
            `Audience anchors accept low-privilege sets only; grant powerful sets through ordinary positions instead.`,
          { operation: opCtx.operation, object: opCtx.object, position: positionName, permissionSet: setName || setId },
        );
      }
    }
  }

  private async assertPackageManagedWriteGate(opCtx: any): Promise<void> {
    if (opCtx?.object !== 'sys_permission_set') return;
    const op = opCtx.operation;
    if (!['insert', 'update', 'delete', 'transfer', 'restore', 'purge'].includes(op)) return;

    // (a) Reject any admin-door PAYLOAD that CLAIMS package provenance
    //     (`managed_by:'package'`), on insert OR update, single object OR array
    //     (`engine.insert`/`update` both accept `T | T[]` and route arrays
    //     through this same middleware). Only the package publish path — which
    //     carries `isSystem` and short-circuited the whole middleware above —
    //     may stamp package provenance. This also closes update-to-forge: an
    //     env row cannot be re-badged package-managed through the admin door.
    const payloadRows = Array.isArray(opCtx.data)
      ? opCtx.data
      : (opCtx.data && typeof opCtx.data === 'object' ? [opCtx.data] : []);
    if (payloadRows.some((r: unknown) => r && typeof r === 'object' && (r as Record<string, unknown>).managed_by === 'package')) {
      throw new PermissionDeniedError(
        `[Security] Access denied: cannot set 'managed_by:package' on a permission set through the admin door — ` +
          `package permission sets are authored in their package and land via publish (ADR-0086 two-doors).`,
        { operation: op, object: opCtx.object },
      );
    }
    if (op === 'insert') return; // no existing row to protect

    // [ADR-0094 D5-R] `update`/`delete` on a package-managed row are not
    // refused HERE: the write-through middleware (which runs after this gate
    // + the delegated-admin gate + the CRUD checks) translates them into a
    // metadata write, and the refusal is LEFT TO THAT PRODUCER. Since #6483 /
    // PR #6608 rolled `permission` back to `allowOrgOverride: false`, a
    // CODE-DECLARED (artifact-backed) set is refused there with 403
    // `NOT_OVERRIDABLE`; a `sys_metadata`-backed set rides
    // `allowRuntimeCreate` and still lands. The 2026-07-14 "customize / reset
    // via the standard ADR-0005 layering" direction this comment used to cite
    // is RETIRED. The lifecycle ops below have no metadata translation, so the
    // package-row protection stays for them.
    if (op === 'update' || op === 'delete') return;

    if (!this.ql) return;

    const targetId = this.extractSingleId(opCtx);
    if (targetId == null) {
      // Multi-row / filter write with no single id. Deny ONLY if a package-owned
      // row actually falls within the write's own filter — so a bulk edit that
      // targets only env-authored rows still succeeds (no over-broad block). A
      // whole-table write (no filter) matches every package row, so it is denied.
      const writeWhere = opCtx?.options?.where;
      const packageWhere = writeWhere && typeof writeWhere === 'object'
        ? { $and: [writeWhere, { managed_by: 'package' }] }
        : { managed_by: 'package' };
      // [#7505] No `.catch(() => null)`: a fault here is not "no package row
      // matched". Swallowed, it stood this guard down for the duration of a
      // store outage and let the admin-door write through — the same collapse
      // `readRowById` carried on the by-id branch just below, and this gate
      // must not answer one way for a single id and the opposite for a filter.
      // The fault propagates, so the write is refused and the caller sees the
      // outage.
      const hitsPackageRow = await this.ql
        .findOne('sys_permission_set', { where: packageWhere, context: { isSystem: true } });
      if (hitsPackageRow) {
        throw new PermissionDeniedError(
          `[Security] Access denied: this '${op}' on 'sys_permission_set' targets one or more package-managed ` +
            `rows — change those by editing their package and re-publishing, not through the admin door ` +
            `(ADR-0086 two-doors separation).`,
          { operation: op, object: opCtx.object },
        );
      }
      return;
    }

    const existing = await this.readRowById('sys_permission_set', targetId, { isSystem: true });
    if (existing && (existing as Record<string, unknown>).managed_by === 'package') {
      const row = existing as Record<string, unknown>;
      throw new PermissionDeniedError(
        `[Security] Access denied: '${String(row.name ?? targetId)}' is a package-managed permission set ` +
          `(managed_by:'package') — change it by editing its package and re-publishing, not through the ` +
          `admin door (ADR-0086 two-doors separation).`,
        {
          operation: op,
          object: opCtx.object,
          recordId: targetId,
          packageId: (row.package_id as string | null) ?? null,
        },
      );
    }
  }

  /**
   * [ADR-0066 / #2918] Built-in row-write guardrail for the platform/application
   * ASSET objects `sys_position` and `sys_capability`.
   *
   * ADR-0066's asset-ownership model splits authoring from assignment: WHAT a
   * position or capability *is* is defined by the platform or an application
   * package developer; a customer admin only decides WHO it is assigned to (via
   * the RBAC link tables, which are governed separately by the delegated-admin
   * gate). The `managed_by` provenance column on each object already records
   * that ownership, but until now nothing ENFORCED it at the data layer — an
   * admin could delete or rewrite a platform/package-managed row and silently
   * break that app's authorization baseline (ADR-0049: a provenance attribute
   * that exists but is never enforced is exactly the gap to close).
   *
   * This gate is an unconditional data-layer boundary, mirroring the
   * `sys_permission_set` two-doors gate above:
   *   (a) The admin door may never FORGE managed provenance — stamping
   *       `managed_by` to a platform/package value on insert OR update (single
   *       object OR array) is refused; only the platform seeder / package
   *       publish path (which carries `isSystem` and short-circuited the whole
   *       middleware above) may author it. This also closes update-to-forge.
   *   (b) delete / update / transfer / restore / purge on a row whose EXISTING
   *       `managed_by` is platform/package-owned are refused — unlike
   *       `sys_permission_set`, these objects have NO ADR-0094 overlay
   *       write-through, so the mutation would otherwise go straight to the
   *       driver.
   *   (c) admin-authored rows (`managed_by` user/∅/admin) are untouched — the
   *       admin fully owns those (incl. a delegate's rows in their own subtree).
   * Fails CLOSED and never depends on the caller's grants, so a superuser with
   * modifyAllRecords cannot delete a platform position either.
   */
  private async assertSystemRowWriteGate(opCtx: any): Promise<void> {
    const spec = SYSTEM_ROW_PROVENANCE[opCtx?.object as string];
    if (!spec) return;
    const op = opCtx.operation;
    if (!['insert', 'update', 'delete', 'transfer', 'restore', 'purge'].includes(op)) return;

    const managedValues = Object.keys(spec.managed);

    // (a) Reject any admin-door PAYLOAD that CLAIMS platform/package provenance,
    //     on insert OR update, single object OR array. Only the seeder / publish
    //     path (which carries `isSystem` and short-circuited above) may stamp it.
    const payloadRows = Array.isArray(opCtx.data)
      ? opCtx.data
      : (opCtx.data && typeof opCtx.data === 'object' ? [opCtx.data] : []);
    if (
      payloadRows.some(
        (r: unknown) =>
          r &&
          typeof r === 'object' &&
          managedValues.includes(String((r as Record<string, unknown>).managed_by ?? '')),
      )
    ) {
      throw new PermissionDeniedError(
        `[Security] Access denied: cannot stamp a platform/package 'managed_by' value on a ${spec.noun} ` +
          `through the admin door — ${spec.pluralNoun} provided by the platform or an application package are ` +
          `authored there and land via seeding/publish, not through Setup (ADR-0066 asset ownership).`,
        { operation: op, object: opCtx.object },
      );
    }
    if (op === 'insert') return; // no existing row to protect

    if (!this.ql) return;

    const targetId = this.extractSingleId(opCtx);
    if (targetId == null) {
      // Multi-row / filter write with no single id. Deny ONLY if a managed row
      // actually falls within the write's own filter — so a bulk edit that
      // targets only admin-authored rows still succeeds (no over-broad block). A
      // whole-table write (no filter) matches every managed row, so it is denied.
      const writeWhere = opCtx?.options?.where;
      const managedWhere =
        writeWhere && typeof writeWhere === 'object'
          ? { $and: [writeWhere, { managed_by: { $in: managedValues } }] }
          : { managed_by: { $in: managedValues } };
      // [#7505] No `.catch(() => null)` — see the sibling gate: a swallowed
      // fault made this asset guard answer "nothing managed matched" and admit
      // the write. Fail-closed: propagate.
      const hitsManagedRow = await this.ql
        .findOne(opCtx.object, { where: managedWhere, context: { isSystem: true } });
      if (hitsManagedRow) {
        throw new PermissionDeniedError(
          `[Security] Access denied: this '${op}' on '${opCtx.object}' targets one or more ${spec.pluralNoun} ` +
            `provided by the platform or an application package — those cannot be deleted or modified through ` +
            `the admin door (ADR-0066 asset ownership).`,
          { operation: op, object: opCtx.object },
        );
      }
      return;
    }

    const existing = await this.readRowById(opCtx.object, targetId, { isSystem: true });
    const existingManagedBy = existing
      ? String((existing as Record<string, unknown>).managed_by ?? '')
      : '';
    const ownerLabel = spec.managed[existingManagedBy];
    if (existing && ownerLabel) {
      const row = existing as Record<string, unknown>;
      const source = ownerLabel === 'the platform' ? 'platform definition' : 'application package';
      throw new PermissionDeniedError(
        `[Security] Access denied: '${String(row.name ?? row.label ?? targetId)}' is a ${spec.noun} provided ` +
          `by ${ownerLabel} — it cannot be deleted or modified through the admin door. Change it by editing ` +
          `its ${source} and re-publishing (ADR-0066 asset ownership).`,
        { operation: op, object: opCtx.object, recordId: targetId, managedBy: existingManagedBy },
      );
    }
  }

  private extractSingleId(opCtx: any): string | number | bigint | null {
    const isScalar = (v: unknown): v is string | number | bigint =>
      v !== null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint');
    const data = opCtx?.data;
    if (data && typeof data === 'object' && !Array.isArray(data) && isScalar(data.id)) {
      return data.id;
    }
    const where = opCtx?.options?.where;
    if (where && typeof where === 'object' && 'id' in where && isScalar((where as any).id)) {
      return (where as any).id;
    }
    return null;
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
   *   - the two admin-door provenance gates
   *     (`assertPackageManagedWriteGate`, `assertSystemRowWriteGate`) read
   *     `null` as "this row is not package/platform-managed" and let the write
   *     THROUGH — fail-OPEN, the whole guard silently stood down for the
   *     duration of a store fault.
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
  private async readRowById(object: string, id: unknown, context: any): Promise<Record<string, unknown> | null> {
    // Not a read at all: there is no id to look one up by. Every call site
    // already screens this; the guard is defence, and `null` is honest here
    // because nothing was ever asked of the store.
    if (id == null) return null;
    if (typeof this.ql?.findOne !== 'function') {
      // The third collapsed fact, and it is not absence either: the probe
      // could not run. Unreachable in a real deployment — `start()` registers
      // no security middleware at all without a query engine, so no gate can
      // reach this line — but a non-conforming engine double must fail closed
      // rather than manufacture a 404 for a row nobody looked for.
      throw new Error(
        `[Security] Cannot verify record '${String(id)}' on '${object}': no query engine is available to read it.`,
      );
    }
    const row = await this.ql.findOne(object, { where: { id }, context });
    return row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
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

  private async computeLayeredRlsFilter(
    permissionSets: PermissionSet[],
    object: string,
    operation: string,
    context: any,
    opts?: RlsFilterOptions,
  ): Promise<{ layer0: Record<string, unknown> | null; layer1: Record<string, unknown> | null }> {
    // [ADR-0095 D1] Effective filter = Layer0(tenant) AND Layer1(business RLS).
    // The two are computed independently and never share a compiler, a merge
    // step, or a bypass bit (closes W1 by construction, W2 structurally).
    const meta = await this.getObjectSecurityMeta(object);
    const isWrite = operation === 'insert' || operation === 'update' || operation === 'delete';
    // Posture permits a platform admin to cross the tenant wall (ADR-0066 ①):
    // private / platform-global / better-auth-managed objects. Public tenant
    // business objects do NOT permit it, so a platform admin stays org-scoped.
    const posturePermits = meta.isPrivate || meta.tenancyDisabled || meta.isBetterAuthManaged;
    // The superuser bit (`viewAllRecords`/`modifyAllRecords`) governs the BUSINESS
    // RLS (Layer 1) short-circuit below — a TENANT_ADMIN legitimately sees every
    // row WITHIN its org, no ownership/depth/sharing narrowing (ADR-0095 D2).
    const superuserBypass = posturePermits
      ? (isWrite
          ? this.permissionEvaluator.hasSuperuserWriteBypass(object, permissionSets, { isPrivate: meta.isPrivate })
          : this.permissionEvaluator.hasSuperuserReadBypass(object, permissionSets, { isPrivate: meta.isPrivate }))
      : false;
    // [Finding 2 / #2937 / ADR-0099 D1 (P1)] The Layer 0 cross-tenant EXEMPTION
    // is stricter than the superuser bit: it requires a TRUE PLATFORM_ADMIN, so a
    // tenant `organization_admin` (which also holds the superuser bit via its `'*'`
    // wildcard) stays org-scoped even on private objects (invariant I1). The tier
    // signal is the CARRIED rung when the context passed the resolver (#2956); the
    // capability probe is the fallback for hand-built contexts that carry no rung.
    // Both are computed so a disagreement (only possible on the fallback-eligible
    // divergence class — scoped `admin_full_access` / piecemeal platform caps) is
    // logged as a defect (ADR-0099 I4) and the NARROWER rung verdict is enforced.
    const carriedPosture = context?.posture;
    const probePlatformAdmin = this.hasPlatformAdminPosture(permissionSets);
    let platformPosture: boolean;
    if (isCarriedPosture(carriedPosture)) {
      platformPosture = carriedPosture === 'PLATFORM_ADMIN';
      if (platformPosture !== probePlatformAdmin) {
        // rung ⊆ probe (I3), so this only fires as probe=true / rung≠PLATFORM_ADMIN
        // — the adjudicated narrowing (#3211 G1). A breadcrumb, never a throw.
        this.logger.warn?.(
          '[authz/ADR-0099] Layer 0 exemption: carried posture rung and capability probe disagree; ' +
            'enforcing the (narrower) carried rung',
          { object, operation, carriedPosture, probePlatformAdmin, userId: context?.userId },
        );
      }
    } else {
      platformPosture = probePlatformAdmin;
    }
    const isPlatformAdmin = superuserBypass && platformPosture;

    // Field set drives BOTH the Layer 1 field-existence net and the Layer 0
    // "is this a tenant object?" check.
    const objectFields = await this.getObjectFieldNames(this.metadata, object, this.ql);
    const tenancyDisabled = this.tenancyDisabledCache.get(object) === true || meta.tenancyDisabled;

    // [ADR-0105 D11] Stage app-resolved membership sets before Layer 1 compiles,
    // so `field IN (current_user.<key>)` predicates can resolve. Lazy (only when
    // a resolver is registered) and memoized per request — resolution is I/O and
    // the same context is reused across every object touched by one request.
    await this.stageRlsMembership(context);

    // ── Layer 1: business RLS (ownership / unit depth / sharing / _self carve-outs).
    // The wildcard tenant policy has LEFT this layer (retired from the seeds), so
    // this superuser short-circuit now governs BUSINESS RLS only — it can no
    // longer skip the tenant wall (that is Layer 0's own exemption, below).
    let layer1: Record<string, unknown> | null = null;
    if (!(posturePermits && superuserBypass)) {
      const collected = this.collectRLSPolicies(permissionSets, object, operation, (context?.positions ?? []) as string[]);
      // [#5492] Provenance composition: the caller (the by-id write pre-image
      // gate) has already asked the declared write authority — `ISharingService`
      // — and received a positive `allow`. Its answer REPLACES the platform's own
      // ownership floor, which is the widener-blind second implementation of the
      // same "ownership" contract. Only the PLATFORM's floor is replaceable; an
      // app-authored policy — even one spelling the identical predicate under a
      // different name — reaches the compiler untouched (ADR-0049, and the
      // ADR-0105 F1 lesson that a token match swallows authored policies).
      const allRlsPolicies = opts?.dropPlatformOwnershipFloor
        ? collected.filter((p) => !isPlatformOwnershipFloorPolicy(p))
        : collected;
      if (allRlsPolicies.length > 0) {
        // Field-existence safety: a wildcard policy targeting a column the object
        // lacks is a *deny* contribution (fail-closed), unless the object opted
        // out of tenancy (skip). Schema-lookup failure keeps all policies.
        let dropped = 0;
        const compilable = objectFields
          ? allRlsPolicies.filter((p) => {
              const targetField = this.extractTargetField(p.using);
              if (!targetField) return true;
              if (objectFields.has(targetField)) return true;
              if (tenancyDisabled && targetField === 'organization_id') {
                return false;
              }
              dropped++;
              return false;
            })
          : allRlsPolicies;
        layer1 = this.rlsCompiler.compileFilter(compilable, context);
        // Every applicable policy dropped for a missing field → deny sentinel.
        if (layer1 == null && dropped > 0) {
          layer1 = { ...RLS_DENY_FILTER };
        }
      }
    }

    // ── Layer 0: tenant isolation — independent, always-first, AND-composed.
    // Decides "tenant object?" directly from the field set + tenancy posture (NOT
    // via extractTargetField's `=`-only shape match), so a `tenancy.enabled:false`
    // global object correctly contributes nothing (ADR-0095 delta c).
    const layer0 = computeTenantLayer0Filter({
      tenancyPosture: this.tenancyPosture,
      organizationId: context?.tenantId,
      // [ADR-0105 D2] The `group` wall's predicate. Resolved by
      // `resolveAuthzContext` and carried on the context — never re-derived here.
      accessibleOrgIds: context?.accessible_org_ids,
      objectHasOrgIdField: objectFields ? objectFields.has('organization_id') : undefined,
      tenancyDisabled,
      posturePermitsCrossTenant: posturePermits,
      isPlatformAdmin,
    });

    return { layer0, layer1 };
  }

  /**
   * [ADR-0058 D4] Compile the WRITE `check` predicate for a post-image
   * validation. Scoped to applicable policies that EXPLICITLY declare a `check`
   * clause — an object governed only by `using` (the pre-image path) yields no
   * check filter and is unaffected. The compiled FilterCondition is matched
   * against the post-image record by the caller (fail closed).
   */
  private async computeWriteCheckFilter(
    permissionSets: PermissionSet[],
    object: string,
    operation: string,
    context: any,
  ): Promise<Record<string, unknown> | null> {
    // [ADR-0066 ①] modifyAllRecords bypasses write-side RLS (incl. the post-image
    // check) on private/platform-global objects.
    const meta = await this.getObjectSecurityMeta(object);
    if (
      (meta.isPrivate || meta.tenancyDisabled || meta.isBetterAuthManaged) &&
      this.permissionEvaluator.hasSuperuserWriteBypass(object, permissionSets, { isPrivate: meta.isPrivate })
    ) {
      return null;
    }
    const withCheck = this.collectRLSPolicies(permissionSets, object, operation).filter(
      (p) => typeof (p as { check?: string }).check === 'string' && (p as { check?: string }).check!.trim() !== '',
    );
    if (withCheck.length === 0) return null;
    return this.rlsCompiler.compileFilter(withCheck, context, 'check');
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
   * applied to the write post-image (that path is governed by explicit `check`
   * clauses via {@link computeWriteCheckFilter}).
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
   */
  private async stageRlsMembership(context: any): Promise<void> {
    if (!this.rlsMembershipResolver || !context || typeof context !== 'object') return;
    // One resolution per request: the same context object is threaded through
    // every object the operation touches.
    if (context.__rlsMembershipStaged) return;
    context.__rlsMembershipStaged = true;

    let resolved: Record<string, string[]> = {};
    try {
      resolved = (await this.rlsMembershipResolver.resolve({
        userId: context.userId,
        tenantId: context.tenantId,
        accessible_org_ids: context.accessible_org_ids,
        positions: context.positions,
        permissions: context.permissions,
      })) ?? {};
    } catch (e) {
      this.logger.warn?.(
        '[security/ADR-0105] rls-membership-resolver threw — its keys stay unresolved and the ' +
          'policies referencing them will fail closed',
        { error: (e as Error)?.message },
      );
      return;
    }

    const bag: Record<string, string[]> = { ...(context.rlsMembership ?? {}) };
    for (const [key, value] of Object.entries(resolved)) {
      if (RESERVED_RLS_MEMBERSHIP_KEYS.includes(key)) {
        this.logger.warn?.(
          '[security/ADR-0105] rls-membership-resolver tried to supply a RESERVED context key — ignored',
          { key },
        );
        continue;
      }
      if (!Array.isArray(value)) continue;
      // An already-staged key wins: a caller-supplied bag is closer to the
      // request than a generic resolver.
      if (bag[key] === undefined) bag[key] = value.filter((v) => typeof v === 'string');
    }
    if (Object.keys(bag).length > 0) context.rlsMembership = bag;
  }

  private async computeWriteTenantCheckFilter(
    permissionSets: PermissionSet[],
    object: string,
    operation: string,
    context: any,
  ): Promise<Record<string, unknown> | null> {
    const { layer0 } = await this.computeLayeredRlsFilter(permissionSets, object, operation, context);
    return layer0;
  }

  /**
   * Resolve a controlled_by_parent object's master-detail relation (the FK field
   * key + the master object name), or null. Prefers a required `master_detail`
   * field; falls back to any `master_detail`, then a required `lookup`. Cached.
   */
  private resolveCbpRelation(object: string): { fk: string; master: string } | null {
    if (this.cbpRelCache.has(object)) return this.cbpRelCache.get(object) ?? null;
    let rel: { fk: string; master: string } | null = null;
    const schema = typeof this.ql?.getSchema === 'function' ? this.ql.getSchema(object) : null;
    const fields = schema?.fields;
    const entries: Array<[string, any]> = Array.isArray(fields)
      ? fields.map((f: any) => [f?.name, f] as [string, any])
      : fields && typeof fields === 'object'
        ? (Object.entries(fields) as Array<[string, any]>)
        : [];
    const ref = (f: any) => f?.reference ?? f?.reference_to ?? f?.referenceTo;
    const pick = (pred: (f: any) => boolean) => entries.find(([, f]) => pred(f) && ref(f));
    const found =
      pick((f) => f?.type === 'master_detail' && f?.required) ??
      pick((f) => f?.type === 'master_detail') ??
      pick((f) => f?.type === 'lookup' && f?.required);
    if (found) rel = { fk: String(found[0]), master: String(ref(found[1])) };
    this.cbpRelCache.set(object, rel);
    return rel;
  }

  /**
   * ADR-0055 — master-detail "controlled by parent" READ derivation.
   *
   * For an object whose `sharingModel` is `controlled_by_parent`, access is
   * derived from the master: return a filter `masterFK IN (<master ids this user
   * can read>)`. The id set is resolved under a system context — no middleware
   * re-entry, so no recursion — against BOTH halves of the master's own read
   * scope, the same two the engine ANDs into a direct `find` of the master:
   *
   *   1. the master's read RLS (`computeRlsFilter` — tenant Layer 0 + policies), and
   *   2. plugin-sharing's OWD / record-share visibility filter
   *      (`resolveSharingReadFilter` — the owner-match widened by READ depth,
   *      OR-ed with the caller's `sys_record_share` grants).
   *
   * [#5386] Half 2 used to be missing, and its absence was not a narrow gap: an
   * app that authors NO `rowLevelSecurity` on the master got an UNRESTRICTED
   * master id set, so the declared narrowing restricted nothing at all — every
   * detail row was readable by any holder of object-level read. Authoring RLS on
   * the master was no workaround either, since RLS is ANDed with (not OR-ed
   * into) the sharing filter and so cuts off the very rows a grant shared in.
   * Which half applies is decided by the MASTER's own effective sharing model —
   * `buildReadFilter` returns null for a non-`private` master — so the derived
   * set stays point-for-point equal to what a direct find of the master returns.
   *
   * An empty set yields `{ masterFK: { $in: [] } }`, which matches no rows (fail
   * closed), as does a failure to resolve the sharing half. A misconfigured
   * object (no master_detail/lookup to derive from) denies all reads
   * (defense-in-depth; spec validation should prevent authoring it). Returns null
   * when the object is not controlled_by_parent.
   *
   * v1 scope (ADR-0055): single level — the master's OWN controlled_by_parent is
   * NOT traversed transitively.
   */
  private async computeControlledByParentFilter(
    permissionSets: PermissionSet[],
    object: string,
    context: any,
  ): Promise<Record<string, unknown> | null> {
    if (!this.ql || !context?.userId) return null;
    const schema = typeof this.ql.getSchema === 'function' ? this.ql.getSchema(object) : null;
    const sharingModel = schema?.sharingModel ?? schema?.security?.sharingModel;
    if (sharingModel !== 'controlled_by_parent') return null;

    const rel = this.resolveCbpRelation(object);
    if (!rel) return { ...RLS_DENY_FILTER };

    const masterRlsFilter = await this.computeRlsFilter(permissionSets, rel.master, 'find', context);
    // [#5386] The OWD / record-share half, resolved through the SAME helper
    // `getReadFilter` uses, so the derived path and the direct path cannot
    // drift. A resolution failure denies (empty master set) rather than
    // silently widening the children back to everyone.
    let masterSharingFilter: Record<string, unknown> | null;
    try {
      masterSharingFilter = await this.resolveSharingReadFilter(rel.master, context, permissionSets);
    } catch (e) {
      this.logger.error?.(
        `[security] controlled_by_parent derivation could not resolve the sharing (OWD) read ` +
          `scope of master '${rel.master}' for '${object}' (user ${context?.userId ?? 'unknown'}) ` +
          `— denying (fail-closed, #5386)`,
        e instanceof Error ? e : new Error(String(e)),
      );
      return { [rel.fk]: { $in: [] } };
    }
    const masterFilter = andComposeLayers(masterRlsFilter, masterSharingFilter);
    let masterIds: string[] = [];
    try {
      const rows = await this.ql.find(rel.master, {
        where: masterFilter ?? {},
        fields: ['id'],
        context: { isSystem: true },
      });
      masterIds = (Array.isArray(rows) ? rows : [])
        .map((r: any) => r?.id)
        .filter((id: any) => id != null);
    } catch {
      masterIds = [];
    }
    return { [rel.fk]: { $in: masterIds } };
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
   * v1 scope: single-id writes. Bulk writes flow through the AST and are already
   * scoped by the controlled-by-parent READ filter (to readable masters).
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
   *   - the detail's master reference is empty → `422 MISSING_REQUIRED_FIELD`
   *     ({@link MasterReferenceMissingError})
   *
   * [#7505] A seventh outcome is not a leg of this gate at all: if the store
   * cannot be read, the engine's own error propagates (typically
   * `ERR_DATASOURCE_UNAVAILABLE` → `503`) and this gate answers nothing. It
   * used to answer the 404 above, because the existence probe flattened a
   * fault into "absent" — the one thing an outage must never be reported as.
   */
  private async assertControlledByParentWrite(
    permissionSets: PermissionSet[],
    object: string,
    operation: string,
    opCtx: any,
    context: any,
  ): Promise<void> {
    const schema = typeof this.ql?.getSchema === 'function' ? this.ql.getSchema(object) : null;
    const sharingModel = schema?.sharingModel ?? schema?.security?.sharingModel;
    if (sharingModel !== 'controlled_by_parent') return;

    // [#7474] The AUTHORIZATION verdicts — and ONLY those. Three of this gate's
    // conditions really do mean "you may not write this detail because you may
    // not edit its master", and they keep `403 PERMISSION_DENIED` and this
    // exact sentence. The other three conditions (broken master_detail
    // declaration / missing row / null master FK) are not verdicts at all and
    // throw their own errors below — see `./errors.ts` for the ruling and the
    // reasoning behind each code.
    const denyMasterEdit = (reason: string, recordId?: unknown): never => {
      throw new PermissionDeniedError(
        `[Security] Access denied: ${operation} on '${object}' requires edit access to its master record (${reason})`,
        { operation, object, recordId },
      );
    };

    const rel = this.resolveCbpRelation(object);
    // A metadata defect, not an access verdict: the object declares that its
    // access is derived from a master and gives us no master to derive it from.
    // Thrown rather than routed through a `never`-returning helper so the
    // narrowing is real — the non-null assertions this branch used to need
    // (`rel!.fk`) were the load-bearing half of the same defect.
    if (!rel) throw new MasterDetailRelationMissingError(object, operation);

    // Resolve the master id: from the incoming body on insert, else from the
    // target row (read as system — we only need its FK value).
    let masterId: unknown;
    let detailRecordId: unknown;
    if (operation === 'insert') {
      const data = opCtx.data;
      masterId = data && typeof data === 'object' && !Array.isArray(data) ? (data as any)[rel.fk] : undefined;
    } else {
      const targetId = this.extractSingleId(opCtx);
      if (targetId == null) return; // bulk write — scoped by the read filter on the AST
      detailRecordId = targetId;
      const row = await this.readRowById(object, targetId, { isSystem: true });
      if (!row) throw new DetailRecordNotFoundError(object, operation, targetId);
      masterId = row[rel.fk];
    }
    if (masterId == null) throw new MasterReferenceMissingError(object, operation, rel.fk, detailRecordId);

    // Master edit access = CRUD update on the master AND the master row reachable
    // under BOTH halves of its own write gate (write RLS + record sharing).
    if (!this.permissionEvaluator.checkObjectPermission('update', rel.master, permissionSets)) {
      denyMasterEdit(`no edit permission on master '${rel.master}'`, masterId);
    }
    const masterWriteFilter = await this.computeRlsFilter(permissionSets, rel.master, 'update', context);
    if (masterWriteFilter) {
      let visible: unknown = null;
      // [#7505] This catch STAYS, and the difference from the existence probe
      // above is the whole per-caller distinction the ruling asks for. That
      // probe asks "does this row exist" — a question an outage leaves
      // unanswered, and answering it "no" is a lie with a terminal 404 on it.
      // This one asks "is the master VISIBLE to you under your own write
      // policy" — a question whose fail-closed default IS "not visible", which
      // is what the 403 below says. The ruling names this probe (and the
      // sharing half beneath it) as the house fail-closed posture to match,
      // not as a site to change.
      try {
        visible = await this.ql.findOne(rel.master, {
          where: { $and: [{ id: masterId }, masterWriteFilter] },
          context,
        });
      } catch {
        visible = null;
      }
      if (!visible) denyMasterEdit(`master '${rel.master}' not editable by this user (row-level security)`, masterId);
    }
    // [#5386] The OWD / record-share half — asked UNCONDITIONALLY, because the
    // RLS half above is skipped whole when the master authors no write policy,
    // which is exactly the common case this closes.
    if (!(await this.resolveSharingCanEdit(rel.master, String(masterId), context, permissionSets))) {
      denyMasterEdit(`master '${rel.master}' not editable by this user (record sharing)`, masterId);
    }
  }

  /**
   * Collect all RLS policies from permission sets applicable to the given object/operation.
   */
  private collectRLSPolicies(
    permissionSets: PermissionSet[],
    objectName: string,
    operation: string,
    heldPositions?: string[],
  ): RowLevelSecurityPolicy[] {
    const allPolicies: RowLevelSecurityPolicy[] = [];

    for (const ps of permissionSets) {
      if (ps.rowLevelSecurity) {
        for (const policy of ps.rowLevelSecurity) {
          // [ADR-0105 D3] When org isolation is NOT active, strip the tenant
          // policies the PLATFORM itself ships — there is no meaningful active
          // organization to compare against, so they would match zero rows (or
          // be dropped by the field-existence safety net) for no benefit.
          //
          // Provenance, not pattern-matching (finding F1): the former substring
          // test on `current_user.organization_id` also swallowed app-authored
          // policies, silently unenforcing a declared security property. An
          // authored policy now always reaches the compiler and fails closed
          // there, where the operator can see it.
          if (!this.orgScopingEnabled && isPlatformTenantPolicy(policy)) {
            continue;
          }
          if (!this.orgScopingEnabled && isAuthoredTenantPolicy(policy)) {
            this.warnAuthoredTenantPolicyOnce(policy, objectName);
          }
          allPolicies.push(policy);
        }
      }
    }

    return this.rlsCompiler.getApplicablePolicies(objectName, operation, allPolicies, heldPositions);
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
    const key = `${objectName} ${policy.name ?? ''}`;
    if (this.warnedAuthoredTenantPolicies.has(key)) return;
    this.warnedAuthoredTenantPolicies.add(key);
    this.logger.warn?.(
      '[security/ADR-0105] authored RLS policy references the active organization but org isolation ' +
        'is inactive — it is retained and will fail closed (zero rows). Install ' +
        '@objectstack/organizations (or drop the policy) if this is not intended.',
      { object: objectName, policy: policy.name, using: policy.using },
    );
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
    const fields: any = (obj as any)?.fields;
    if (Array.isArray(fields)) {
      for (const f of fields) {
        if (f?.name && Array.isArray(f.requiredPermissions) && f.requiredPermissions.length > 0) {
          fieldRequiredPermissions[String(f.name)] = f.requiredPermissions.map(String);
        }
      }
    } else if (fields && typeof fields === 'object') {
      for (const [fname, fdef] of Object.entries(fields)) {
        const rp = (fdef as any)?.requiredPermissions;
        if (Array.isArray(rp) && rp.length > 0) fieldRequiredPermissions[fname] = rp.map(String);
      }
    }
    const meta = {
      isPrivate: (obj as any)?.access?.default === 'private',
      tenancyDisabled:
        (obj as any)?.tenancy?.enabled === false || (obj as any)?.systemFields?.tenant === false,
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
      requiredPermissions: normalizeRequiredPermissions((obj as any)?.requiredPermissions),
      fieldRequiredPermissions,
      unresolved: !obj,
    };
    if (obj) this.objectSecurityMetaCache.set(object, meta);
    return meta;
  }

  /**
   * [ADR-0066 D3] Fold per-field `requiredPermissions` into a FieldPermission map.
   * A field whose declared capabilities are NOT all held by the caller is forced
   * non-readable + non-editable (AND-gate, strictest-wins over permission-set
   * field grants) so the existing FieldMasker masks it on read and denies it on
   * write. Returns the base map unchanged when no field declares requirements.
   */
  private foldFieldRequiredPermissions(
    baseFieldPerms: Record<string, { readable: boolean; editable: boolean }>,
    fieldRequiredPermissions: Record<string, string[]>,
    permissionSets: PermissionSet[],
  ): Record<string, { readable: boolean; editable: boolean }> {
    const entries = Object.entries(fieldRequiredPermissions ?? {});
    if (entries.length === 0) return baseFieldPerms;
    const held = this.permissionEvaluator.getSystemPermissions(permissionSets);
    const merged: Record<string, { readable: boolean; editable: boolean }> = { ...baseFieldPerms };
    for (const [field, caps] of entries) {
      if (caps.length > 0 && !caps.every((c) => held.has(c))) {
        merged[field] = { readable: false, editable: false };
      }
    }
    return merged;
  }

  /**
   * Resolve the column-name set for an object (lowercased). Returns
   * `null` if the schema can't be loaded — caller should fail-closed.
   */
  private async getObjectFieldNames(
    metadata: any,
    objectName: string,
    ql?: any,
  ): Promise<Set<string> | null> {
    if (this.fieldNamesCache.has(objectName)) {
      return this.fieldNamesCache.get(objectName) ?? null;
    }
    const result = await this.loadObjectFieldNames(metadata, objectName, ql);
    // Only cache positive resolutions — a `null` may simply mean the
    // schema isn't registered yet at boot, and we want subsequent calls
    // to retry rather than be permanently denied.
    if (result) {
      this.fieldNamesCache.set(objectName, result);
    }
    return result;
  }

  private async loadObjectFieldNames(
    metadata: any,
    objectName: string,
    ql?: any,
  ): Promise<Set<string> | null> {
    try {
      // Prefer ObjectQL's per-engine SchemaRegistry as the source of truth
      // for the live field set: it reflects registry-time augmentations
      // (system-field auto-injection like `organization_id`) that the
      // standalone metadata artifact loaded at boot may not include.
      // Fall back to the metadata service for objects ObjectQL doesn't
      // know about (system tables registered through other paths).
      let obj: any = typeof ql?.getSchema === 'function' ? ql.getSchema(objectName) : null;
      if (!obj || !obj.fields) {
        obj = await metadata?.get?.('object', objectName);
      }
      if (!obj || !obj.fields) return null;
      // Populate the tenancy opt-out cache alongside the field set so
      // the RLS filter pass can decide whether a wildcard
      // `organization_id` policy is genuinely "applicable but
      // uncompilable" (deny) versus "not applicable on this object"
      // (skip without contributing to the deny sentinel).
      const tenancyDisabled =
        (obj as any)?.tenancy?.enabled === false ||
        (obj as any)?.systemFields?.tenant === false;
      this.tenancyDisabledCache.set(objectName, !!tenancyDisabled);
      const set = new Set<string>(['id']);
      if (Array.isArray(obj.fields)) {
        for (const f of obj.fields) {
          if (f?.name) set.add(String(f.name));
        }
      } else if (typeof obj.fields === 'object') {
        for (const key of Object.keys(obj.fields)) {
          set.add(key);
          const v = (obj.fields as Record<string, any>)[key];
          if (v && typeof v === 'object' && v.name) set.add(String(v.name));
        }
      } else {
        return null;
      }
      return set;
    } catch {
      return null;
    }
  }

  /**
   * Extract the left-hand field name from a simple RLS expression like
   * `field = current_user.x` or `field IN (current_user.y)`. Returns
   * `null` for unsupported shapes (in which case we keep the policy).
   */
  private extractTargetField(using?: string): string | null {
    if (!using) return null;
    // Match `field ==` (canonical CEL), `field =` (legacy SQL-ish), or
    // `field IN`/`in`. [#2936] `==` MUST be listed before `=` in the
    // alternation: alternation is ordered, so a bare `=` branch would match
    // the first `=` of `==` and then the `(?=\s|\()` lookahead — seeing the
    // SECOND `=`, not whitespace — would fail, leaving `==` unrecognized (the
    // original bug: real seeds/business policies author equality as `==`, so
    // the field-existence and tenancy-disabled safety nets that consume this
    // were inert for them). `\b` is omitted after the operator because `=` is
    // non-word and the next char (space) is non-word too — a word boundary
    // cannot exist between two non-word chars — so we require the operator to
    // be followed by whitespace or `(` instead. `!=`/`>`/`<`/`>=`/`<=` are
    // deliberately NOT recognized: returning `null` keeps such a policy (the
    // conservative default), matching the pre-#2936 behavior for any shape the
    // regex did not match.
    const m = using.match(/^\s*([a-z_][a-z0-9_]*)\s*(?:==|=|IN|in)(?=\s|\()/);
    return m ? m[1] : null;
  }
}
