// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from '@objectstack/core';
import type { PermissionSet, RowLevelSecurityPolicy } from '@objectstack/spec/security';
import { PermissionEvaluator } from './permission-evaluator.js';
import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';
import { FieldMasker } from './field-masker.js';
import { PermissionDeniedError } from './errors.js';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
import {
  backfillOrgAdminGrants,
  extractMemberPairs,
  reconcileOrgAdminGrant,
} from './auto-org-admin-grant.js';
import {
  securityObjects,
  securityDefaultPermissionSets,
  securityPluginManifestHeader,
} from './manifest.js';

export interface SecurityPluginOptions {
  /**
   * Additional permission sets to register with the metadata service on
   * plugin start. Defaults to {@link securityDefaultPermissionSets}
   * (admin_full_access / member_default / viewer_readonly).
   */
  defaultPermissionSets?: PermissionSet[];
  /**
   * Permission set name applied as an implicit baseline whenever an
   * authenticated request has no resolved permission sets (and no roles
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
 * `@objectstack/plugin-org-scoping` package** (auto-stamps
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
  private dbLoader?: (names: string[]) => Promise<PermissionSet[]>;
  private logger: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void; error?: (...a: any[]) => void } = {};

  constructor(options: SecurityPluginOptions = {}) {
    this.bootstrapPermissionSets =
      options.defaultPermissionSets ?? securityDefaultPermissionSets;
    this.fallbackPermissionSet =
      options.fallbackPermissionSet === undefined
        ? 'member_default'
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
            { id: 'nav_roles', type: 'object', label: 'Roles', objectName: 'sys_role', icon: 'shield-check' },
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

    // Probe for OrgScopingPlugin presence. When registered, its
    // `init()` exposes itself as the `org-scoping` service. We capture
    // the boolean once at start time (plugin DI graph is static after
    // start) and let `collectRLSPolicies` consult it on every request.
    try {
      const orgScoping = ctx.getService('org-scoping');
      this.orgScopingEnabled = !!orgScoping;
    } catch {
      this.orgScopingEnabled = false;
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
          return list.map((r: any) => ({
            name: r.name,
            label: r.label,
            objects: typeof r.object_permissions === 'string'
              ? JSON.parse(r.object_permissions || '{}')
              : r.object_permissions ?? {},
            fields: typeof r.field_permissions === 'string'
              ? JSON.parse(r.field_permissions || '{}')
              : r.field_permissions ?? {},
          }));
        }
      : undefined;
    this.dbLoader = dbLoader;

    // ADR-0021 D-C — expose the per-request READ scope as a reusable service.
    // The analytics raw-SQL path (which bypasses this engine middleware)
    // auto-bridges to `getService('security').getReadFilter(object, context)`
    // to enforce tenant/RLS on every base + joined object. We register the
    // service only once the metadata/ql/dbLoader handles are wired (above), so
    // a degraded start never exposes a half-initialised resolver.
    try {
      ctx.registerService('security', {
        getReadFilter: (object: string, context?: any) => this.getReadFilter(object, context),
      });
      ctx.logger.info('[security] registered "security" service (getReadFilter) for raw-SQL RLS bridging');
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

      const roles = opCtx.context?.roles ?? [];
      const explicitPermissionSets = opCtx.context?.permissions ?? [];

      // Skip security checks if no roles AND no explicit permission sets
      // AND no userId (anonymous/unauthenticated). The auth middleware
      // should handle authentication separately.
      if (
        roles.length === 0 &&
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

      // 2. CRUD permission check
      if (permissionSets.length > 0) {
        const allowed = this.permissionEvaluator.checkObjectPermission(
          opCtx.operation,
          opCtx.object,
          permissionSets
        );

        if (!allowed) {
          throw new PermissionDeniedError(
            `[Security] Access denied: operation '${opCtx.operation}' on object '${opCtx.object}' ` +
              `is not permitted for roles [${roles.join(', ')}]`,
            { operation: opCtx.operation, object: opCtx.object, roles, permissionSets: explicitPermissionSets },
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
        const fieldPerms = this.permissionEvaluator.getFieldPermissions(
          opCtx.object,
          permissionSets,
        );
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
                roles,
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
      // `@objectstack/plugin-org-scoping`. Install that plugin for
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

      // 3. RLS filter injection. The policy collection + field-existence
      // safety + compile (incl. the fail-closed deny sentinel) is shared with
      // the public getReadFilter service via computeRlsFilter, so the engine
      // find-path and the analytics raw-SQL path enforce identical scoping.
      if (opCtx.ast) {
        const rlsFilter = await this.computeRlsFilter(
          permissionSets,
          opCtx.object,
          opCtx.operation,
          opCtx.context,
        );
        if (rlsFilter) {
          if (opCtx.ast.where) {
            opCtx.ast.where = { $and: [opCtx.ast.where, rlsFilter] };
          } else {
            opCtx.ast.where = rlsFilter;
          }
        }
      }

      await next();

      // 4. Field-level security: mask restricted fields in read results
      if (opCtx.result && ['find', 'findOne'].includes(opCtx.operation)) {
        const fieldPerms = this.permissionEvaluator.getFieldPermissions(opCtx.object, permissionSets);
        if (Object.keys(fieldPerms).length > 0) {
          opCtx.result = this.fieldMasker.maskResults(opCtx.result, fieldPerms, opCtx.object);
        }
      }
    });

    ctx.logger.info('Security middleware registered on ObjectQL engine');

    // Defer platform admin bootstrap until all plugins finish starting —
    // sys_user / sys_permission_set objects must be registered (by
    // plugin-auth and platform-objects respectively) before we can
    // insert seed rows. Falls back to immediate execution when the
    // kernel does not expose `hook` (test stubs).
    let bootstrapRanOnce = false;
    const runBootstrap = async () => {
      try {
        const report = await bootstrapPlatformAdmin(ql, this.bootstrapPermissionSets, {
          logger: ctx.logger,
        });
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
    // moved to `@objectstack/plugin-org-scoping` (along with
    // `claimOrphanOrgRows` / `cloneOrgSeedData`). Install that
    // plugin for multi-tenant deployments.
  }

  async destroy(): Promise<void> {
    // No cleanup needed
  }

  /**
   * ADR-0021 D-C — resolve the per-request READ scope (tenant + RLS predicate)
   * for one object as a canonical `FilterCondition`, WITHOUT touching the
   * ObjectQL engine. This is the seam the analytics raw-SQL path bridges to so
   * it enforces the SAME row scoping the engine middleware applies on `find`.
   *
   * Returns:
   *   - `undefined` → no scope applies (system context, or an unauthenticated
   *     request with no userId/roles/permissions — authn is gated elsewhere).
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
  async getReadFilter(
    object: string,
    context?: any,
  ): Promise<Record<string, unknown> | null | undefined> {
    // System operations bypass scoping (mirrors the middleware's isSystem skip).
    if (context?.isSystem) return undefined;
    const roles = context?.roles ?? [];
    const explicit = context?.permissions ?? [];
    // Unauthenticated + role-less + permission-less → no scope (the auth layer,
    // not RLS, gates anonymous access; the analytics REST endpoint already 401s
    // without a token). Mirrors the middleware's early `return next()`.
    if (roles.length === 0 && explicit.length === 0 && !context?.userId) {
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
   * Resolve the effective permission sets for an execution context — roles +
   * explicit permission sets, with the configured baseline applied both as an
   * implicit request (when none were named) and as a post-resolution fallback
   * (when named ones resolved to nothing). Shared by the engine middleware and
   * {@link getReadFilter} so both enforce identical RLS. May throw if the
   * underlying metadata/db resolution fails (callers fail-closed).
   */
  private async resolvePermissionSetsForContext(
    context: any,
  ): Promise<PermissionSet[]> {
    const roles = context?.roles ?? [];
    const explicitPermissionSets = context?.permissions ?? [];
    const requested = [...roles, ...explicitPermissionSets];
    // Implicit baseline: an authenticated request that named no roles/perms
    // still gets the configured baseline (default `member_default`) so tenant +
    // owner RLS apply before an admin assigns a profile.
    if (requested.length === 0 && context?.userId && this.fallbackPermissionSet) {
      requested.push(this.fallbackPermissionSet);
    }
    let permissionSets = await this.permissionEvaluator.resolvePermissionSets(
      requested,
      this.metadata,
      this.bootstrapPermissionSets,
      this.dbLoader,
    );
    // Post-resolution fallback — closes the fail-open hole where a populated
    // `roles` array maps to no permission set yet (no sys_role binding), which
    // would otherwise skip RLS entirely and expose every tenant's data.
    if (
      permissionSets.length === 0 &&
      context?.userId &&
      this.fallbackPermissionSet
    ) {
      permissionSets = await this.permissionEvaluator.resolvePermissionSets(
        [this.fallbackPermissionSet],
        this.metadata,
        this.bootstrapPermissionSets,
        this.dbLoader,
      );
    }
    return permissionSets;
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
    const allRlsPolicies = this.collectRLSPolicies(permissionSets, object, operation);
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
   * Collect all RLS policies from permission sets applicable to the given object/operation.
   */
  private collectRLSPolicies(
    permissionSets: PermissionSet[],
    objectName: string,
    operation: string
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
          // `@objectstack/plugin-org-scoping` to enable the
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

    return this.rlsCompiler.getApplicablePolicies(objectName, operation, allPolicies);
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
