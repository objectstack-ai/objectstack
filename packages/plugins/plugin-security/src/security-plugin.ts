// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from '@objectstack/core';
import type { PermissionSet, RowLevelSecurityPolicy } from '@objectstack/spec/security';
import { PermissionEvaluator } from './permission-evaluator.js';
import { bootstrapDeclaredRoles } from './bootstrap-declared-roles.js';
import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';
import { matchesFilterCondition } from '@objectstack/formula';
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
  /** ADR-0055: cache the resolved master-detail relation per controlled_by_parent object. */
  private cbpRelCache = new Map<string, { fk: string; master: string } | null>();
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
    this.rlsCompiler.setLogger?.(ctx.logger);

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

      // 2.6. [ADR-0057 D1] Stash the grant's access DEPTH for this object so the
      //      sharing service can widen the owner-match (owner_id IN unit-set)
      //      while still OR-ing in shares. Owner-set expansion needs the BU graph
      //      (plugin-sharing), so we pass the scope STRING, not the resolved set.
      if (permissionSets.length > 0) {
        const sc: any = opCtx.context;
        if (['find', 'findOne', 'count', 'aggregate'].includes(opCtx.operation)) {
          sc.__readScope = this.permissionEvaluator.getEffectiveScope('read', opCtx.object, permissionSets);
        } else if (opCtx.operation === 'update' || opCtx.operation === 'delete') {
          sc.__writeScope = this.permissionEvaluator.getEffectiveScope('write', opCtx.object, permissionSets);
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
        (opCtx.operation === 'update' || opCtx.operation === 'delete') &&
        permissionSets.length > 0 &&
        !!opCtx.context?.userId &&
        this.ql
      ) {
        const targetId = this.extractSingleId(opCtx);
        if (targetId != null) {
          const writeFilter = await this.computeRlsFilter(
            permissionSets,
            opCtx.object,
            opCtx.operation,
            opCtx.context,
          );
          if (writeFilter) {
            let visible: unknown = null;
            try {
              visible = await this.ql.findOne(opCtx.object, {
                where: { $and: [{ id: targetId }, writeFilter] },
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
                  roles,
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
        (opCtx.operation === 'insert' || opCtx.operation === 'update' || opCtx.operation === 'delete') &&
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
        if (checkFilter) {
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
          if (postImage && !matchesFilterCondition(postImage, checkFilter as any)) {
            this.logger.warn?.(
              `[Security] RLS check FAILED on ${opCtx.operation} '${opCtx.object}' — write denied (fail-closed)`,
            );
            throw new PermissionDeniedError(
              `[Security] Access denied: the ${opCtx.operation} would violate a row-level CHECK on '${opCtx.object}'`,
              { operation: opCtx.operation, object: opCtx.object, roles, permissionSets: explicitPermissionSets },
            );
          }
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
        if (extra.length) {
          opCtx.ast.where = opCtx.ast.where
            ? { $and: [opCtx.ast.where, ...extra] }
            : extra.length === 1
              ? extra[0]
              : { $and: extra };
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
        // [ADR-0057 D6 / #2077] Seed stack-declared roles into sys_role so they
        // stop being decorative (role→permission-set resolution + recipients).
        try {
          await bootstrapDeclaredRoles(ql, this.metadata, { logger: ctx.logger });
        } catch (e) {
          ctx.logger.warn('[security] declared-role seeding failed', { error: (e as Error).message });
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
   * Resolve a single scalar primary-key id from an update/delete operation
   * context, mirroring the engine's "single-id vs predicate" rule
   * (`engine.ts` update/delete): only a scalar `data.id` or `where.id`
   * identifies one row. An operator object (`{ $in: [...] }`, …) is a
   * multi-row predicate and returns `null` (multi-row writes route through the
   * `*Many` paths, out of scope for the by-id pre-image check).
   */
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
