// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from '@objectstack/core';
import type { PermissionSet, RowLevelSecurityPolicy } from '@objectstack/spec/security';
import { PermissionEvaluator } from './permission-evaluator.js';
import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';
import { FieldMasker } from './field-masker.js';
import { PermissionDeniedError } from './errors.js';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
import { claimOrphanTenantRows } from './claim-orphan-tenant-rows.js';
import { cloneTenantSeedData } from './clone-tenant-seed-data.js';
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
          dbLoader,
        );
        // **Post-resolution fallback** — closes the fail-open hole that
        // appears when a user's `roles` array is populated (e.g. a
        // better-auth `sys_member.role` like `owner`/`admin`/`member`)
        // but no `sys_role`→`sys_permission_set` binding exists yet, so
        // resolution returns an empty array. Without this, both the
        // CRUD check (`permissionSets.length > 0`) and the RLS injection
        // (`allRlsPolicies.length > 0`) below get skipped → the user
        // sees every tenant's data. Authenticated users with no
        // resolved permission sets always inherit the configured
        // baseline (default `member_default`, which carries
        // `tenant_isolation` + `owner_only_writes`).
        if (
          permissionSets.length === 0 &&
          opCtx.context?.userId &&
          this.fallbackPermissionSet
        ) {
          const fallback = await this.permissionEvaluator.resolvePermissionSets(
            [this.fallbackPermissionSet],
            metadata,
            this.bootstrapPermissionSets,
            dbLoader,
          );
          permissionSets = fallback;
        }
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
        const tenancyDisabled = this.tenancyDisabledCache.get(opCtx.object) === true;
        let dropped = 0;
        const compilable = objectFields
          ? allRlsPolicies.filter((p) => {
              const targetField = this.extractTargetField(p.using);
              if (!targetField) return true;
              if (objectFields.has(targetField)) return true;
              // Schema-level opt-out: when the object explicitly
              // disabled tenancy (`tenancy.enabled === false`), the
              // wildcard `tenant_isolation` policy targeting
              // `organization_id` was never meant to apply. Treat as
              // "not applicable" — skip silently without contributing
              // to the deny sentinel, mirroring how the registry skips
              // injecting the column itself for these tables.
              if (tenancyDisabled && targetField === 'organization_id') {
                return false;
              }
              dropped++;
              return false;
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
          multiTenant: this.multiTenant,
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

    // After a sys_organization insert, give the new org its own private
    // copy of the artifact's demo data (Salesforce-sandbox style):
    //
    //   1. PRIMARY PATH — replay the seed datasets registered on the
    //      kernel's `seed-datasets` service (populated by AppPlugin at
    //      start) with `organizationId: <newOrgId>`. SeedLoader scopes
    //      both existing-record lookups and reference resolution to
    //      that org, so upsert mode produces an independent copy per
    //      tenant. This works for the FIRST org and EVERY subsequent
    //      org created explicitly via the better-auth
    //      `createOrganization` API, the bootstrap default-org seed,
    //      or the cloud-team mirror.
    //
    //   2. FALLBACK A — when no `seed-datasets` service is registered
    //      (e.g. a plugin-shaped deployment with no AppPlugin), and
    //      this is the FIRST org, fall back to the legacy
    //      `claimOrphanTenantRows` path that adopts any NULL-org rows
    //      a previous AppPlugin inline-seed may have inserted.
    //
    //   3. FALLBACK B — when no `seed-datasets` service is registered
    //      and this is NOT the first org, fall back to
    //      `cloneTenantSeedData` (donor-based row copy from the very
    //      first org). Useful for upgrade paths where the new
    //      service-based flow hasn't been wired yet.
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

        // Locate the kernel via ctx — most kernel impls expose either
        // `getService` on PluginContext directly or attach the kernel
        // ref. Anything we can't resolve becomes `undefined` and we
        // gracefully fall back.
        const kernel: any = (ctx as any).kernel ?? ctx;
        let datasets: any[] | undefined;
        try {
          const raw = kernel?.getService?.('seed-datasets');
          if (Array.isArray(raw) && raw.length > 0) datasets = raw;
        } catch { /* service not registered */ }

        // Count existing orgs to pick the right fallback path.
        let orgCount = 0;
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
          orgCount = list.length;
        } catch (e) {
          ctx.logger.warn('[security] failed to count organizations', {
            error: (e as Error).message,
          });
        }

        // ── Primary path: SeedLoader replay scoped to newOrgId ─────
        // Uses the `seed-replayer` callable that AppPlugin registers
        // on the kernel (keeps plugin-security free of @objectstack/runtime
        // import — runtime already depends on us, so the reverse would
        // be circular).
        let replayed = false;
        try {
          const replayer: any = kernel?.getService?.('seed-replayer');
          if (typeof replayer === 'function') {
            const summary = await replayer(newOrgId);
            const total = (summary?.inserted ?? 0) + (summary?.updated ?? 0);
            ctx.logger.info(
              `[security] per-org seed replay for ${newOrgId}: +${summary?.inserted ?? 0} inserted, ${summary?.updated ?? 0} updated, ${summary?.errors?.length ?? 0} error(s)`,
              {
                organizationId: newOrgId,
                errors: summary?.errors?.slice?.(0, 5),
              },
            );
            if (total > 0) replayed = true;
          } else if (datasets) {
            ctx.logger.warn('[security] per-org seed: datasets present but no replayer registered', {
              organizationId: newOrgId,
            });
          }
        } catch (e) {
          ctx.logger.warn('[security] per-org seed replay failed, falling back', {
            organizationId: newOrgId,
            error: (e as Error).message,
          });
        }
        if (replayed) return;

        // ── Fallback A: legacy claim for first org ─────────────────
        if (orgCount === 1) {
          try {
            const claims = await claimOrphanTenantRows(ql, newOrgId, { logger: ctx.logger });
            if (claims.length > 0) {
              const total = claims.reduce((s, c) => s + c.count, 0);
              ctx.logger.info(
                `[security] claimed ${total} orphan seed row(s) for first organization ${newOrgId}`,
                { breakdown: claims },
              );
              return;
            }
          } catch (e) {
            ctx.logger.warn('[security] claim-orphan-tenant-rows failed', {
              error: (e as Error).message,
            });
          }
        }

        // ── Fallback B: clone from donor org for subsequent orgs ───
        if (orgCount > 1) {
          try {
            const summary = await cloneTenantSeedData(ql, newOrgId, { logger: ctx.logger });
            if (summary.length > 0) {
              const total = summary.reduce((s, c) => s + c.count, 0);
              ctx.logger.info(
                `[security] cloned ${total} seed row(s) for new organization ${newOrgId}`,
                { breakdown: summary },
              );
            }
          } catch (e) {
            ctx.logger.warn('[security] clone-tenant-seed-data failed', {
              organizationId: newOrgId,
              error: (e as Error).message,
            });
          }
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
