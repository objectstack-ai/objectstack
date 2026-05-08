// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from '@objectstack/core';
import type { PermissionSet, RowLevelSecurityPolicy } from '@objectstack/spec/security';
import { PermissionEvaluator } from './permission-evaluator.js';
import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';
import { FieldMasker } from './field-masker.js';
import { PermissionDeniedError } from './errors.js';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
import { claimOrphanTenantRows } from './claim-orphan-tenant-rows.js';
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
  /**
   * Whether this deployment is multi-tenant.
   *
   * When `true` (default), SecurityPlugin:
   *   - Auto-injects `organization_id = ctx.tenantId` on insert when
   *     the target object declares an `organization_id` field.
   *   - Honours the wildcard `tenant_isolation` RLS policy
   *     (`organization_id = current_user.organization_id`) shipped with
   *     the default `member_default` / `viewer_readonly` permission
   *     sets.
   *
   * When `false`, SecurityPlugin:
   *   - Skips the `organization_id` auto-injection block (saves a
   *     metadata lookup per insert; `owner_id` injection still runs).
   *   - Strips any RLS policy whose USING expression references
   *     `current_user.organization_id` from the per-request policy
   *     set, so single-tenant deployments don't pay the
   *     field-existence safety-net cost on every find.
   *
   * Field-Level Security, owner-based RLS, and per-object permission
   * checks (allowRead/allowCreate/…) all operate identically regardless
   * of this flag. Set this to `false` for single-tenant or
   * single-organization deployments where `organization_id` carries no
   * meaning.
   *
   * @default true
   */
  multiTenant?: boolean;
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
  private readonly multiTenant: boolean;
  /**
   * Per-object field-name cache. Populated lazily from the metadata
   * service / ObjectQL registry on first access per object. Schemas are
   * effectively immutable for the lifetime of the kernel today (hot
   * reload tears the kernel down), so we don't bother with
   * invalidation — a kernel restart drops the cache.
   */
  private readonly fieldNamesCache = new Map<string, Set<string> | null>();

  constructor(options: SecurityPluginOptions = {}) {
    this.bootstrapPermissionSets =
      options.defaultPermissionSets ?? securityDefaultPermissionSets;
    this.fallbackPermissionSet =
      options.fallbackPermissionSet === undefined
        ? 'member_default'
        : options.fallbackPermissionSet;
    this.multiTenant = options.multiTenant !== false;
  }

  async init(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Initializing Security Plugin...');

    // Register security services
    ctx.registerService('security.permissions', this.permissionEvaluator);
    ctx.registerService('security.rls', this.rlsCompiler);
    ctx.registerService('security.fieldMasker', this.fieldMasker);

    ctx.getService<{ register(m: any): void }>('manifest').register({
      ...securityPluginManifestHeader,
      objects: securityObjects,
      // Permission sets ride along on the manifest so the metadata service
      // can resolve them by name when SecurityPlugin middleware queries
      // `metadata.list('permissions')`.
      permissions: this.bootstrapPermissionSets,
    });

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
      //    permission set names attached to the execution context.
      let permissionSets: PermissionSet[] = [];
      try {
        const requested = [...roles, ...explicitPermissionSets];
        // Implicit baseline: when an authenticated request resolved zero
        // permission sets, fall back to the configured baseline (default
        // `member_default`). This guarantees tenant + owner RLS even
        // before an admin has assigned a profile/permission set.
        if (
          requested.length === 0 &&
          opCtx.context?.userId &&
          this.fallbackPermissionSet
        ) {
          requested.push(this.fallbackPermissionSet);
        }
        permissionSets = await this.permissionEvaluator.resolvePermissionSets(
          requested,
          metadata,
          this.bootstrapPermissionSets,
        );
      } catch (e) {
        // If metadata service is misconfigured, log and continue without permission checks
        // rather than blocking all operations
        return next();
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

      // 3.5. Auto-inject tenancy/ownership fields on insert.
      //
      // When an authenticated user inserts a record, the canonical
      // tenant column (`organization_id`) and ownership column
      // (`owner_id`) should be auto-populated from
      // `ExecutionContext.tenantId` / `userId` so the row is visible
      // to the same RLS policies that gate reads. Without this, the
      // user creates a row that has `organization_id = NULL`, which
      // the very next `find` will filter out as a wrong-tenant row —
      // a confusing "I just created it but I can't see it" footgun.
      //
      // Only fills fields that:
      //   - the object actually declares (so unrelated tables are
      //     untouched)
      //   - aren't already set in the payload (caller wins)
      //   - have a corresponding value on the execution context.
      //
      // The `organization_id` half is gated on `multiTenant`; in
      // single-tenant deployments it's pure overhead.
      if (
        opCtx.operation === 'insert' &&
        opCtx.data &&
        typeof opCtx.data === 'object' &&
        !Array.isArray(opCtx.data)
      ) {
        const needsTenant =
          this.multiTenant && !!opCtx.context?.tenantId;
        const needsOwner = !!opCtx.context?.userId;
        if (needsTenant || needsOwner) {
          const fields = await this.getObjectFieldNames(metadata, opCtx.object, ql);
          if (fields) {
            const data = opCtx.data as Record<string, unknown>;
            if (
              needsTenant &&
              fields.has('organization_id') &&
              (data.organization_id == null || data.organization_id === '')
            ) {
              data.organization_id = opCtx.context!.tenantId;
            }
            if (
              needsOwner &&
              fields.has('owner_id') &&
              (data.owner_id == null || data.owner_id === '')
            ) {
              data.owner_id = opCtx.context!.userId;
            }
          }
        }
      }

      // 3. RLS filter injection
      const allRlsPolicies = this.collectRLSPolicies(permissionSets, opCtx.object, opCtx.operation);
      if (allRlsPolicies.length > 0 && opCtx.ast) {
        // Field-existence safety: wildcard policies (`object: '*'`) target
        // fields like `organization_id` that may not exist on every object
        // (e.g. system tables, CRM apps that haven't yet adopted multi-tenancy).
        //
        // We treat such policies as a *deny* contribution rather than dropping
        // them, so they fail-closed when no per-object policy provides an
        // alternate match. Any per-object policy that DOES compile against
        // the object will OR-combine and grant access (e.g. `sys_user_self`).
        // When the schema lookup itself fails we keep all policies (drivers
        // will surface column errors clearly during compilation).
        const objectFields = await this.getObjectFieldNames(metadata, opCtx.object, ql);
        let dropped = 0;
        const compilable = objectFields
          ? allRlsPolicies.filter((p) => {
              const targetField = this.extractTargetField(p.using);
              const ok = targetField ? objectFields.has(targetField) : true;
              if (!ok) dropped++;
              return ok;
            })
          : allRlsPolicies;
        let rlsFilter = this.rlsCompiler.compileFilter(compilable, opCtx.context);
        // If every applicable policy was dropped because of missing fields,
        // contribute the deny sentinel (zero rows) — matches the rls-compiler
        // semantics for "policies were applicable but none compiled".
        if (rlsFilter == null && dropped > 0) {
          rlsFilter = { ...RLS_DENY_FILTER };
        }
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
    // signs up after boot is auto-promoted to platform admin without
    // requiring a server restart. The function itself is idempotent
    // and bails out as soon as any platform admin exists.
    ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      await next();
      if (
        opCtx?.object === 'sys_user' &&
        (opCtx?.operation === 'create' || opCtx?.operation === 'insert') &&
        bootstrapRanOnce
      ) {
        await runBootstrap();
      }
    });

    // After a sys_organization insert, if this is the FIRST organization
    // in the system, back-fill `organization_id` on every seed-loaded
    // user-defined row that landed with `organization_id IS NULL`. Seeds
    // run as `isSystem` (no auto-fill), so without this hook, demo data
    // shipped with `defineDataset()` would be invisible to anyone with
    // an active organization. Idempotent: only fires when row count
    // before this insert was zero, then never again.
    if (this.multiTenant) {
      ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
        await next();
        if (
          opCtx?.object !== 'sys_organization' ||
          (opCtx?.operation !== 'create' && opCtx?.operation !== 'insert')
        ) {
          return;
        }
        const newOrgId = opCtx?.result?.id ?? opCtx?.data?.id;
        if (!newOrgId) return;
        try {
          const allOrgs = await ql.find(
            'sys_organization',
            { limit: 2, fields: ['id'] },
            { context: { isSystem: true } },
          );
          const list: any[] = Array.isArray(allOrgs)
            ? allOrgs
            : Array.isArray(allOrgs?.records)
              ? allOrgs.records
              : [];
          if (list.length !== 1) return;
          const claims = await claimOrphanTenantRows(ql, newOrgId, { logger: ctx.logger });
          if (claims.length > 0) {
            const total = claims.reduce((s, c) => s + c.count, 0);
            ctx.logger.info(
              `[security] claimed ${total} orphan seed row(s) for first organization ${newOrgId}`,
              { breakdown: claims },
            );
          }
        } catch (e) {
          ctx.logger.warn('[security] claim-orphan-tenant-rows failed', {
            error: (e as Error).message,
          });
        }
      });
    }
  }

  async destroy(): Promise<void> {
    // No cleanup needed
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
          // In single-tenant mode, strip any policy that filters on
          // `current_user.organization_id` — there is no meaningful
          // tenant to compare against, so the policy would either drop
          // every row (when the field exists on the object) or be
          // dropped by the field-existence safety net. Either way it's
          // pure overhead. Substring match is sufficient: every
          // wildcard tenant policy in the default permission sets uses
          // exactly this token, and authors who want a different
          // multi-tenant story should turn `multiTenant: false` off.
          if (
            !this.multiTenant &&
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
