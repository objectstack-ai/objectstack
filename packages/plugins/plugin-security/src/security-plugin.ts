// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from '@objectstack/core';
import type { PermissionSet, RowLevelSecurityPolicy } from '@objectstack/spec/security';
import { describeHighPrivilegeBits, describeAnchorForbiddenBits } from '@objectstack/spec/security';
import { MCP_AGENT_PERMISSION_SET_RESTRICTED } from '@objectstack/spec/ai';
import { PermissionEvaluator, crudBucketForOperation } from './permission-evaluator.js';
import { DelegatedAdminGate } from './delegated-admin-gate.js';
import {
  explainAccess,
  buildContextForUser,
  resolveDelegatorContext,
  intersectFieldMasks,
} from './explain-engine.js';
import type { ExplainDecision, ExplainOperation } from '@objectstack/spec/security';
import { bootstrapDeclaredPositions } from './bootstrap-declared-positions.js';
import { bootstrapDeclaredPermissions, upsertPackagePermissionSet } from './bootstrap-declared-permissions.js';
import {
  createPermissionSetWriteThrough,
  registerPermissionSetProjection,
  reconcilePermissionSetProjection,
} from './permission-set-projection.js';
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
import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';
import { matchesFilterCondition } from '@objectstack/formula';
import { FieldMasker } from './field-masker.js';
import { assertReadableQueryFields } from './predicate-guard.js';
import { PermissionDeniedError } from './errors.js';
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
}

const EMPTY_REQUIRED_PERMISSIONS: NormalizedRequiredPermissions = Object.freeze({
  all: [], read: [], create: [], update: [], delete: [],
}) as NormalizedRequiredPermissions;

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
   * Permission set name applied as an implicit baseline whenever an
   * authenticated request has no resolved permission sets (and no positions
   * that map to one). This guarantees baseline tenant/owner RLS for
   * every logged-in user even before an admin assigns explicit
   * profiles. Set to `null` to disable.
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
 * it via `getService('org-scoping')` and keeps the wildcard
 * `current_user.organization_id` RLS policies that ship with the
 * default permission sets. Without it, those policies are stripped so
 * single-tenant deployments don't pay the field-existence safety-net
 * cost on every find.
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

export class SecurityPlugin implements Plugin {
  name = 'com.objectstack.security';
  type = 'standard';
  version = '1.0.0';
  dependencies = ['com.objectstack.engine.objectql'];

  private permissionEvaluator = new PermissionEvaluator();
  private rlsCompiler = new RLSCompiler();
  private fieldMasker = new FieldMasker();
  private readonly bootstrapPermissionSets: PermissionSet[];
  private readonly fallbackPermissionSet: string | null;
  /**
   * Runtime probe — set in `start()` from
   * `ctx.getService('org-scoping')`. When `false`, wildcard RLS
   * policies that reference `current_user.organization_id` are
   * stripped from the per-request policy set (saves the
   * field-existence safety net cost on every find in single-tenant
   * deployments). When `true`, the policies apply normally.
   */
  private orgScopingEnabled = false;
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
        ? (this.bootstrapPermissionSets.find((p) => (p as { isDefault?: boolean }).isDefault)?.name ?? 'member_default')
        : options.fallbackPermissionSet;
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
          const i18n = ctx.getService<any>('i18n');
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
    let ql: any;
    let metadata: any;

    try {
      ql = ctx.getService('objectql');
      metadata = ctx.getService('metadata');
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

    // Probe whether org-scoping (auto-stamp + tenant RLS) is active. We capture
    // the boolean once at start time (plugin DI graph is static after start)
    // and let `collectRLSPolicies` consult it on every request.
    //
    // ADR-0093 D4 — prefer the `tenancy` service, the single source of truth.
    // It derives `isolationActive` from the very same `org-scoping` presence
    // probe, so this is behavior-identical while centralizing the fact. Fall
    // back to probing `org-scoping` directly when the tenancy service isn't
    // wired (e.g. an embedding without plugin-auth), preserving prior behavior.
    try {
      const tenancy = ctx.getService<{ isolationActive?: boolean }>('tenancy');
      this.orgScopingEnabled = !!tenancy?.isolationActive;
    } catch {
      try {
        this.orgScopingEnabled = !!ctx.getService('org-scoping');
      } catch {
        this.orgScopingEnabled = false;
      }
    }
    if (this.orgScopingEnabled) {
      ctx.logger.info(
        '[security] org-scoping plugin detected — wildcard `organization_id` RLS policies will apply',
      );
    } else {
      ctx.logger.info(
        '[security] org-scoping plugin not present — wildcard `organization_id` RLS policies will be stripped (single-tenant mode)',
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
      ctx.registerService('security', {
        getReadFilter: (object: string, context?: any) => this.getReadFilter(object, context),
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
        // [ADR-0090 D6] First-class access explanation. Same code paths as
        // the middleware (resolution/evaluator/RLS compiler) — explained by
        // construction. Explaining ANOTHER user requires `manage_users`.
        explain: (request: { object: string; operation: string; userId?: string }, callerContext?: any) =>
          this.explainAccessForCaller(request, callerContext),
        // [ADR-0090 D5/D9] Install-time suggestion surface: packages suggest
        // audience-anchor bindings; a tenant admin confirms (the binding is
        // written under the anchor + delegated-admin gates) or dismisses.
        listAudienceBindingSuggestions: (callerContext?: any, filter?: SuggestionListFilter) =>
          listAudienceBindingSuggestions(suggestionDeps, callerContext, filter),
        confirmAudienceBindingSuggestion: (callerContext: any, id: string) =>
          confirmAudienceBindingSuggestion(suggestionDeps, callerContext, id),
        dismissAudienceBindingSuggestion: (callerContext: any, id: string) =>
          dismissAudienceBindingSuggestion(suggestionDeps, callerContext, id),
      });
      ctx.logger.info('[security] registered "security" service (getReadFilter, explain, audience-binding suggestions) — ADR-0021 D-C / ADR-0090 D5/D6/D9');
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
      // work under secure-by-default (requireAuth) WITHOUT a deployment-configured
      // `guest_portal`, scoped to exactly the declared object (the field
      // allow-list is enforced at the route; the context is request-scoped).
      const formGrant = opCtx.context?.publicFormGrant;
      if (formGrant && typeof formGrant === 'object' && (formGrant as { object?: string }).object) {
        const grantObject = (formGrant as { object: string }).object;
        const allowed =
          opCtx.object === grantObject &&
          ['insert', 'find', 'findOne', 'count'].includes(opCtx.operation);
        if (allowed) return next();
        throw new PermissionDeniedError(
          `[Security] Access denied: public-form grant permits only create/read-back on '${grantObject}', ` +
            `not '${opCtx.operation}' on '${opCtx.object}'`,
          { operation: opCtx.operation, object: opCtx.object },
        );
      }

      // [ADR-0086 P2 — 块2] Two-doors write gate. A permission set stamped
      // `managed_by:'package'` is owned by the PACKAGE door: it is authored in
      // the package and lands via publish (块1). The ADMIN door (this data-plane
      // write path) must NOT edit, delete, or forge that provenance — otherwise
      // the next boot re-seed silently reverts the admin's change and the
      // provenance axis becomes a lie. Placed BEFORE the empty-principal
      // fall-open and the CRUD check so it is a real, unconditional data-layer
      // boundary — it holds even for a principal-less context and even for a
      // superuser with modifyAllRecords. System/boot writes carry `isSystem` and
      // already short-circuited the whole middleware above, so the seeder and
      // the publish materializer pass straight through.
      await this.assertPackageManagedWriteGate(opCtx);

      // [ADR-0090 D5/D9] Audience-anchor binding guard — like the package
      // gate above, an unconditional data-layer boundary: a permission set
      // carrying high-privilege bits must never be bound to the `everyone`
      // or `guest` positions, no matter who asks. (Boot/system writes carry
      // `isSystem` and short-circuited above; the dev-mode default binding
      // is validated at seed time by the same predicate.)
      await this.assertAudienceAnchorBindingGate(opCtx);

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
          : { isPrivate: false, tenancyDisabled: false, isBetterAuthManaged: false, requiredPermissions: EMPTY_REQUIRED_PERMISSIONS, fieldRequiredPermissions: {} as Record<string, string[]> };

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
            throw new PermissionDeniedError(
              `[Security] Access denied: '${opCtx.object}' (operation '${opCtx.operation}') requires capability ` +
                `[${required.join(', ')}] — ${missing.length > 0 ? 'caller' : 'the delegator'} is missing [${allMissing.join(', ')}]`,
              {
                operation: opCtx.operation,
                object: opCtx.object,
                positions,
                permissionSets: explicitPermissionSets,
                requiredPermissions: required,
                missingPermissions: allMissing,
              },
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
          throw new PermissionDeniedError(
            `[Security] Access denied: operation '${opCtx.operation}' on object '${opCtx.object}' ` +
              `is not permitted for positions [${positions.join(', ')}]`,
            { operation: opCtx.operation, object: opCtx.object, positions, permissionSets: explicitPermissionSets },
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
          const writeFilter = await this.computeRlsFilter(
            permissionSets,
            opCtx.object,
            rlsOperation,
            opCtx.context,
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
              throw new PermissionDeniedError(
                `[Security] Access denied: not permitted to ${opCtx.operation} this ` +
                  `'${opCtx.object}' record (row-level security)`,
                {
                  operation: opCtx.operation,
                  object: opCtx.object,
                  positions,
                  permissionSets: explicitPermissionSets,
                  recordId: targetId,
                },
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

      // 3.5. Auto-inject `owner_id` on insert from the
      // ExecutionContext. Without this, the row has `owner_id = NULL`
      // and the default `owner_only_writes` RLS policy hides it from
      // the very user who just created it.
      //
      // `organization_id` auto-injection has moved to
      // `@objectstack/organizations`. Install that plugin for
      // multi-tenant deployments.
      if (
        opCtx.operation === 'insert' &&
        opCtx.data &&
        typeof opCtx.data === 'object' &&
        !Array.isArray(opCtx.data) &&
        !!opCtx.context?.userId
      ) {
        const fields = await this.getObjectFieldNames(metadata, opCtx.object, ql);
        if (fields) {
          const data = opCtx.data as Record<string, unknown>;
          if (
            fields.has('owner_id') &&
            (data.owner_id == null || data.owner_id === '')
          ) {
            data.owner_id = opCtx.context!.userId;
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
              let pre: any = null;
              try {
                pre = await this.ql.findOne(opCtx.object, { where: { id: targetId }, context: opCtx.context });
              } catch {
                pre = null;
              }
              if (pre && typeof pre === 'object') postImage = { ...(pre as Record<string, unknown>), ...(opCtx.data as Record<string, unknown>) };
            }
          }
          if (postImage && !checkParts.every((f) => matchesFilterCondition(postImage as any, f as any))) {
            this.logger.warn?.(
              `[Security] RLS check FAILED on ${opCtx.operation} '${opCtx.object}' — write denied (fail-closed)`,
            );
            throw new PermissionDeniedError(
              `[Security] Access denied: the ${opCtx.operation} would violate a row-level CHECK on '${opCtx.object}'`,
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
      // semantics unpredictably. MUST run against the CALLER's AST, before
      // the RLS injection below: RLS policies legitimately reference fields
      // the caller cannot read (e.g. owner_id).
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
          assertReadableQueryFields(opCtx.ast as unknown as Record<string, unknown>, guardPerms, opCtx.object);
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
    const runBootstrap = async () => {
      try {
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

        // [ADR-0090 D5] Bind the configured baseline set to the `everyone`
        // audience anchor (idempotent). This makes the CLI/dev fallback
        // (`fallbackPermissionSet` — the app's `isDefault` suggestion) visible
        // as an ordinary position binding: same table, same audit path, same
        // explain surface as any admin-authored default grant. The binding is
        // validated with the SAME high-privilege predicate the write gate
        // enforces — a dangerous baseline is refused loudly, never seeded.
        try {
          if (this.fallbackPermissionSet) {
            const boot = this.bootstrapPermissionSets.find((p) => p.name === this.fallbackPermissionSet);
            const offending = boot ? describeHighPrivilegeBits(boot) : null;
            if (offending) {
              ctx.logger.warn('[security] refusing to bind fallback set to everyone — high-privilege bits', {
                set: this.fallbackPermissionSet, offending,
              });
            } else {
              const everyoneRows = await ql.find('sys_position', { where: { name: 'everyone' }, limit: 1, context: { isSystem: true } });
              const everyone: any = Array.isArray(everyoneRows) && everyoneRows[0] ? everyoneRows[0] : null;
              const setRows = await ql.find('sys_permission_set', { where: { name: this.fallbackPermissionSet }, limit: 1, context: { isSystem: true } });
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
                  ctx.logger.info('[security] baseline set bound to everyone anchor (ADR-0090 D5)', { set: this.fallbackPermissionSet });
                }
              }
            }
          }
        } catch (e) {
          ctx.logger.warn('[security] everyone-anchor baseline binding failed (non-fatal)', { error: (e as Error).message });
        }
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
        // [ADR-0066 D1] Back-compat seed the capability registry (sys_capability)
        // from the curated platform set + the default grants' systemPermissions.
        try {
          await bootstrapSystemCapabilities(ql, this.bootstrapPermissionSets, { logger: ctx.logger });
        } catch (e) {
          ctx.logger.warn('[security] capability seeding failed', { error: (e as Error).message });
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
      for (const { userId, orgId } of pairs) {
        try {
          await reconcileOrgAdminGrant(ql, userId, orgId, { logger: ctx.logger });
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
        await backfillOrgAdminGrants(ql, { logger: ctx.logger });
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
    request: { object: string; operation: string; userId?: string },
    callerContext?: any,
  ): Promise<ExplainDecision> {
    const operation = String(request?.operation ?? 'read') as ExplainOperation;
    const object = String(request?.object ?? '');
    if (!object) throw new Error('[Security] explain: request.object is required');

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
        fallbackPermissionSet: this.fallbackPermissionSet,
      },
      { object, operation, context: targetContext },
    );
  }

  async getReadFilter(
    object: string,
    context?: any,
  ): Promise<Record<string, unknown> | null | undefined> {
    // System operations bypass scoping (mirrors the middleware's isSystem skip).
    if (context?.isSystem) return undefined;
    const positions = context?.positions ?? [];
    const explicit = context?.permissions ?? [];
    // Unauthenticated + position-less + permission-less → no scope (the auth
    // layer, not RLS, gates anonymous access; the analytics REST endpoint
    // already 401s without a token). Mirrors the middleware's early `return next()`.
    if (positions.length === 0 && explicit.length === 0 && !context?.userId) {
      return undefined;
    }
    try {
      const permissionSets = await this.resolvePermissionSetsForContext(context);
      const filter = await this.computeRlsFilter(permissionSets, object, 'find', context);
      return filter ?? undefined;
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
    const baseline = isAgent ? MCP_AGENT_PERMISSION_SET_RESTRICTED : this.fallbackPermissionSet;
    // [ADR-0090 D5] Baseline is ADDITIVE, always (for humans): the configured
    // baseline set applies to every authenticated request IN ADDITION to
    // whatever else resolved. The former "only when the user has nothing else"
    // conditional was the fallback CLIFF — receiving your first explicit grant
    // silently cost you the entire baseline. Agents skip this additive step
    // (their ceiling is closed, not floored) — see above.
    if (!isAgent && context?.userId && baseline && !requested.includes(baseline)) {
      requested.push(baseline);
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
      baseline
    ) {
      permissionSets = await this.permissionEvaluator.resolvePermissionSets(
        [baseline],
        this.metadata,
        this.bootstrapPermissionSets,
        this.dbLoader,
        { logger: this.logger },
      );
    }
    return permissionSets;
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
   * [ADR-0086 P2 — 块2] Two-doors data-layer write gate for `sys_permission_set`.
   *
   * A row with `managed_by:'package'` is owned by the package door (authored in
   * the package, materialized on publish). The admin door — the generic
   * `/api/v1/data/sys_permission_set` write path this middleware guards — must
   * not mutate or delete it, nor may it forge that provenance on insert. Fails
   * CLOSED and never depends on the caller's grants, so a platform admin with
   * `modifyAllRecords` is blocked just the same. System/boot writes never reach
   * here (the middleware short-circuits on `isSystem`), so the seeder and the
   * publish materializer are unaffected.
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
      const hitsPackageRow = await this.ql
        .findOne('sys_permission_set', { where: packageWhere, context: { isSystem: true } })
        .catch(() => null);
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

    const existing = await this.ql
      .findOne('sys_permission_set', { where: { id: targetId }, context: { isSystem: true } })
      .catch(() => null);
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
   * Compile the applicable RLS policies for (object, operation) into a single
   * `FilterCondition`, applying the field-existence safety net (wildcard
   * policies targeting a column the object lacks fail-closed to the deny
   * sentinel, unless the object explicitly opted out of tenancy). Shared by the
   * engine middleware and {@link getReadFilter}. Returns `null` when no policy
   * applies (caller adds no filter).
   */
  private async computeRlsFilter(
    permissionSets: PermissionSet[],
    object: string,
    operation: string,
    context: any,
  ): Promise<Record<string, unknown> | null> {
    // [ADR-0066 ①] Posture-gated super-user RLS bypass. On a `private` or
    // platform-global object, a caller with the super-user bypass bit
    // (viewAllRecords for reads, modifyAllRecords for writes) skips wildcard RLS
    // entirely — so a platform admin (incl. one who is also an org admin whose
    // tenant_isolation would otherwise narrow the result) sees all rows. The
    // posture gate ensures this never grants cross-tenant visibility on ordinary
    // tenant business objects.
    const meta = await this.getObjectSecurityMeta(object);
    if (meta.isPrivate || meta.tenancyDisabled || meta.isBetterAuthManaged) {
      const isWrite = operation === 'insert' || operation === 'update' || operation === 'delete';
      const bypass = isWrite
        ? this.permissionEvaluator.hasSuperuserWriteBypass(object, permissionSets, { isPrivate: meta.isPrivate })
        : this.permissionEvaluator.hasSuperuserReadBypass(object, permissionSets, { isPrivate: meta.isPrivate });
      if (bypass) return null;
    }
    const allRlsPolicies = this.collectRLSPolicies(permissionSets, object, operation, (context?.positions ?? []) as string[]);
    if (allRlsPolicies.length === 0) return null;
    // Field-existence safety: wildcard policies (`object: '*'`) target fields
    // like `organization_id` that may not exist on every object. Treat such a
    // policy as a *deny* contribution (fail-closed) rather than dropping it —
    // unless the object explicitly opted out of tenancy, where it's "not
    // applicable" and skipped silently. When the schema lookup itself fails we
    // keep all policies (drivers surface column errors clearly at compile time).
    const objectFields = await this.getObjectFieldNames(this.metadata, object, this.ql);
    const tenancyDisabled = this.tenancyDisabledCache.get(object) === true;
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
    let rlsFilter = this.rlsCompiler.compileFilter(compilable, context);
    // Every applicable policy dropped for a missing field → deny sentinel.
    if (rlsFilter == null && dropped > 0) {
      rlsFilter = { ...RLS_DENY_FILTER };
    }
    return rlsFilter;
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
   * can read>)`. The id set is resolved by running the MASTER's own read RLS
   * (reused via `computeRlsFilter`) under a system context — no middleware
   * re-entry, so no recursion. An empty set yields `{ masterFK: { $in: [] } }`,
   * which matches no rows (fail closed). A misconfigured object (no
   * master_detail/lookup to derive from) denies all reads (defense-in-depth;
   * spec validation should prevent authoring it). Returns null when the object is
   * not controlled_by_parent.
   *
   * v1 scope (ADR-0055): single level — the master's OWN controlled_by_parent is
   * not traversed transitively; master accessibility is the master's RLS filter
   * (sharing-service grants on the master are not folded in).
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

    const masterFilter = await this.computeRlsFilter(permissionSets, rel.master, 'find', context);
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
   * master object AND the master row must be visible under the master's write RLS.
   * This is the write-side companion to the read derivation — the RLS read filter
   * never applies to a by-id write (the #1994 class), so without this a member
   * could mutate a detail under a master they cannot edit. Throws on denial;
   * no-op when the object is not controlled_by_parent.
   *
   * v1 scope: single-id writes. Bulk writes flow through the AST and are already
   * scoped by the controlled-by-parent READ filter (to readable masters).
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

    const deny = (reason: string, recordId?: unknown) => {
      throw new PermissionDeniedError(
        `[Security] Access denied: ${operation} on '${object}' requires edit access to its master record (${reason})`,
        { operation, object, recordId },
      );
    };

    const rel = this.resolveCbpRelation(object);
    if (!rel) deny('controlled_by_parent declared but no master_detail relation');

    // Resolve the master id: from the incoming body on insert, else from the
    // target row (read as system — we only need its FK value).
    let masterId: unknown;
    if (operation === 'insert') {
      const data = opCtx.data;
      masterId = data && typeof data === 'object' && !Array.isArray(data) ? (data as any)[rel!.fk] : undefined;
    } else {
      const targetId = this.extractSingleId(opCtx);
      if (targetId == null) return; // bulk write — scoped by the read filter on the AST
      let row: any = null;
      try {
        row = await this.ql.findOne(object, { where: { id: targetId }, context: { isSystem: true } });
      } catch {
        row = null;
      }
      if (!row) deny('target record not found', targetId);
      masterId = row[rel!.fk];
    }
    if (masterId == null) deny('detail record has no master reference');

    // Master edit access = CRUD update on the master AND master row visible under
    // the master's write RLS.
    if (!this.permissionEvaluator.checkObjectPermission('update', rel!.master, permissionSets)) {
      deny(`no edit permission on master '${rel!.master}'`, masterId);
    }
    const masterWriteFilter = await this.computeRlsFilter(permissionSets, rel!.master, 'update', context);
    if (masterWriteFilter) {
      let visible: unknown = null;
      try {
        visible = await this.ql.findOne(rel!.master, {
          where: { $and: [{ id: masterId }, masterWriteFilter] },
          context,
        });
      } catch {
        visible = null;
      }
      if (!visible) deny(`master '${rel!.master}' not editable by this user (row-level security)`, masterId);
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
          // When the org-scoping plugin is NOT installed, strip any
          // policy that filters on `current_user.organization_id` —
          // there is no meaningful tenant to compare against, so the
          // policy would either drop every row (when the field exists
          // on the object) or be dropped by the field-existence safety
          // net. Either way it's pure overhead. Substring match is
          // sufficient: every wildcard tenant policy in the default
          // permission sets uses exactly this token. Install
          // `@objectstack/organizations` to enable the
          // multi-tenant behavior.
          if (
            !this.orgScopingEnabled &&
            policy.using &&
            policy.using.includes('current_user.organization_id')
          ) {
            continue;
          }
          allPolicies.push(policy);
        }
      }
    }

    return this.rlsCompiler.getApplicablePolicies(objectName, operation, allPolicies, heldPositions);
  }

  /**
   * [ADR-0066 D2/D3] Resolve and cache the object's security posture: whether it
   * is `private` (access.default), platform-global (tenancy disabled), and its
   * `requiredPermissions` capability contract. Prefers the live ObjectQL schema
   * (reflects registry-time augmentation) and falls back to the metadata service.
   * Returns the permissive default when the schema can't be resolved yet (boot) —
   * the CRUD/RLS checks then behave as pre-0066 and the miss is retried next call.
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
      // is never stamped and the wildcard `tenant_isolation` RLS denies them —
      // making a platform admin's `viewAllRecords` see an empty list. Treat
      // them like the private/non-tenant posture for the SUPERUSER BYPASS ONLY
      // (so the platform super-admin sees all identity rows env-wide). This does
      // NOT relax member RLS (members never trigger the bypass; their `_self`
      // carve-outs / tenant_isolation still apply) and is NOT used for the
      // wildcard-policy drop below, so it can never leak rows to non-admins.
      isBetterAuthManaged: (obj as any)?.managedBy === 'better-auth',
      requiredPermissions: normalizeRequiredPermissions((obj as any)?.requiredPermissions),
      fieldRequiredPermissions,
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
    // Match `field =` or `field IN`/`in`. Note: `\b` is omitted after `=`
    // because `=` is non-word and the next char (space) is non-word too —
    // a word boundary cannot exist between two non-word chars, so `=\b`
    // would never match. We instead require the alternation token to be
    // followed by whitespace or `(`.
    const m = using.match(/^\s*([a-z_][a-z0-9_]*)\s*(?:=|IN|in)(?=\s|\()/);
    return m ? m[1] : null;
  }
}
