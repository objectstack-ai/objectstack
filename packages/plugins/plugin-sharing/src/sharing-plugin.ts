// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { EngineMiddleware, OperationContext } from '@objectstack/objectql';
import type { IHttpServer } from '@objectstack/spec/contracts';
import { SysRecordShare, SysSharingRule, SysShareLink } from './objects/index.js';
import { SysDepartment, SysDepartmentMember } from '@objectstack/platform-objects/identity';
import { SharingService, type SharingEngine } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { ShareLinkService } from './share-link-service.js';
import { registerShareLinkRoutes } from './share-link-routes.js';
import { bindRuleHooks, unbindAllRuleHooks } from './rule-hooks.js';

export interface SharingPluginOptions {
  /** Extra object names that bypass sharing entirely. */
  bypassObjects?: string[];
  /**
   * Disable enforcement (read filter + canEdit) while still registering
   * the schema + service. Useful in development to flip enforcement on
   * via env var without rebuilding.
   */
  enforce?: boolean;
  /**
   * Disable the public share-link REST routes. The `IShareLinkService`
   * is always registered (other services may depend on it); only the
   * HTTP surface is suppressed.
   */
  registerShareLinkRoutes?: boolean;
  /**
   * Base path for the share-link REST surface. Defaults to
   * `/api/v1/share-links`.
   */
  shareLinkBasePath?: string;
}

/**
 * SharingServicePlugin — registers `sys_record_share`, the `sharing`
 * service, and the engine middleware that enforces
 * `object.sharingModel`.
 *
 * Enforcement is opt-in per object:
 *
 *   - `sharingModel: 'private'` → reads filtered to `(owner_id == me) OR
 *     (record explicitly shared with me)`. Writes require ownership or
 *     an `edit`/`full` share.
 *   - `sharingModel: 'read'` → reads unrestricted; writes gated as
 *     above (typical "everyone can see, only owner can edit").
 *   - any other value (or no value) → no enforcement. This keeps
 *     existing CRM behaviour identical until admins explicitly enable
 *     sharing on a per-object basis.
 *
 * @example
 * ```ts
 * import { SharingServicePlugin } from '@objectstack/plugin-sharing';
 *
 * kernel.use(new SharingServicePlugin());
 *
 * // Mark an object private — middleware enforces from this point on.
 * defineObject({
 *   name: 'account',
 *   sharingModel: 'private',
 *   fields: { owner_id: Field.lookup('sys_user'), ... },
 * });
 * ```
 */
export class SharingServicePlugin implements Plugin {
  name = 'com.objectstack.service.sharing';
  version = '1.0.0';
  type = 'standard';
  dependencies = ['com.objectstack.engine.objectql'];

  private readonly options: SharingPluginOptions;
  private service?: SharingService;
  private ruleService?: SharingRuleService;
  private linkService?: ShareLinkService;

  constructor(options: SharingPluginOptions = {}) {
    this.options = options;
  }

  async init(ctx: PluginContext): Promise<void> {
    // Register sys_record_share via the manifest service.
    ctx.getService<{ register(m: any): void }>('manifest').register({
      id: 'com.objectstack.service.sharing',
      name: 'Sharing Service',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      defaultDatasource: 'cloud',
      namespace: 'sys',
      objects: [SysRecordShare, SysSharingRule, SysDepartment, SysDepartmentMember, SysShareLink],
      // ADR-0029 D7 — contribute the sharing entries into the Setup app's
      // `group_access_control` slot (priority 200 so they sit after plugin-
      // security's Roles / Permission Sets). This plugin owns these objects (K2).
      navigationContributions: [
        {
          app: 'setup',
          group: 'group_access_control',
          priority: 200,
          items: [
            { id: 'nav_sharing_rules', type: 'object', label: 'Sharing Rules', objectName: 'sys_sharing_rule', icon: 'share-2', requiresObject: 'sys_sharing_rule', requiredPermissions: ['manage_platform_settings'] },
            { id: 'nav_record_shares', type: 'object', label: 'Record Shares', objectName: 'sys_record_share', icon: 'link', requiresObject: 'sys_record_share', requiredPermissions: ['manage_platform_settings'] },
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
            const { SharingTranslations } = await import('./translations/index.js');
            for (const [locale, data] of Object.entries(SharingTranslations)) {
              i18n.loadTranslations(locale, data as Record<string, unknown>);
            }
          }
        } catch { /* i18n optional */ }
      });
    }
    ctx.logger.info('SharingServicePlugin: schema registered');
  }

  async start(ctx: PluginContext): Promise<void> {
    ctx.hook('kernel:ready', async () => {
      let engine: any = null;
      try { engine = ctx.getService<any>('objectql'); }
      catch { try { engine = ctx.getService<any>('data'); } catch { /* ignore */ } }
      if (!engine) {
        ctx.logger.warn('SharingServicePlugin: no ObjectQL engine — service NOT registered');
        return;
      }

      this.service = new SharingService({
        engine: engine as SharingEngine,
        bypassObjects: this.options.bypassObjects,
      });
      ctx.registerService('sharing', this.service);

      // Enforcement (read-filter middleware + sharing-rule hooks) is opt-out
      // via `enforce: false`. The share-link service below is registered
      // REGARDLESS — capability-token sharing does not depend on principal-
      // based RLS enforcement, and multi-tenant hosts mount this plugin purely
      // for the `shareLinks` service (per-env enforcement is applied elsewhere).
      if (this.options.enforce === false) {
        ctx.logger.info('SharingServicePlugin: enforcement disabled (enforce=false) — share-link service still registered');
      } else {
        const mw = buildSharingMiddleware(this.service);
        if (typeof engine.registerMiddleware === 'function') {
          engine.registerMiddleware(mw, { object: '*' });
          ctx.logger.info('SharingServicePlugin: enforcement middleware installed');
        } else {
          ctx.logger.warn('SharingServicePlugin: engine has no registerMiddleware — enforcement not applied');
        }

        // Rule evaluator + hot-rebindable lifecycle hooks.
        try {
          this.ruleService = new SharingRuleService({
            engine: engine as SharingEngine,
            sharing: this.service,
            logger: ctx.logger as any,
          });
          ctx.registerService('sharingRules', this.ruleService);

          if (typeof engine.registerHook === 'function' && typeof engine.unregisterHooksByPackage === 'function') {
            const rules = await this.ruleService.listRules({ activeOnly: true }, { isSystem: true } as any);
            unbindAllRuleHooks(engine);
            bindRuleHooks(engine, this.ruleService, rules, ctx.logger as any);
          } else {
            ctx.logger.warn('SharingServicePlugin: engine has no hook API — sharing rule auto-evaluation disabled');
          }
        } catch (err: any) {
          ctx.logger.warn('SharingServicePlugin: sharing-rule subsystem not started', { error: err?.message });
        }
      }

      // ── Share-Link service (capability tokens) ────────────────
      //
      // Registered alongside the principal-based sharing service so
      // both surfaces resolve through the same kernel. The HTTP
      // endpoints are optional — services that just want programmatic
      // access can set `registerShareLinkRoutes: false` and call the
      // service via `ctx.getService('shareLinks')`.
      try {
        this.linkService = new ShareLinkService({ engine: engine as SharingEngine });
        ctx.registerService('shareLinks', this.linkService);

        if (this.options.registerShareLinkRoutes !== false) {
          let http: IHttpServer | null = null;
          try {
            http = ctx.getService<IHttpServer>('http-server');
          } catch {
            // No HTTP server — service still reachable via getService.
          }
          if (http) {
            registerShareLinkRoutes(http, this.linkService, engine as SharingEngine, {
              basePath: this.options.shareLinkBasePath,
            });
            ctx.logger.info(
              'SharingServicePlugin: share-link routes mounted at ' +
                (this.options.shareLinkBasePath ?? '/api/v1/share-links'),
            );
          } else {
            ctx.logger.warn(
              'SharingServicePlugin: no HTTP server — share-link REST routes not registered. ' +
                'ShareLinkService is still reachable via kernel.getService("shareLinks").',
            );
          }
        }
      } catch (err: any) {
        ctx.logger.warn('SharingServicePlugin: share-link subsystem not started', { error: err?.message });
      }
    });
  }
}

/**
 * Build the engine middleware that injects read filters and gates
 * write operations. Exported so it can be unit-tested without booting
 * a kernel.
 */
export function buildSharingMiddleware(service: SharingService): EngineMiddleware {
  return async function sharingMiddleware(ctx: OperationContext, next: () => Promise<void>) {
    const op = ctx.operation;
    const exec = ctx.context as any;

    // READS — AND the visibility filter into the AST.
    if (op === 'find' || op === 'findOne' || op === 'count' || op === 'aggregate') {
      const filter = await service.buildReadFilter(ctx.object, exec ?? {});
      if (filter) {
        const ast: any = ctx.ast ?? {};
        ast.where = composeAnd(ast.where, filter);
        ast.filter = composeAnd(ast.filter, filter);
        ctx.ast = ast;
      }
      return next();
    }

    // WRITES — gate on canEdit for update / delete.
    if (op === 'update' || op === 'delete') {
      const data: any = ctx.data;
      const options: any = ctx.options;
      const id = inferTargetId(data, options);
      if (id != null) {
        const ok = await service.canEdit(ctx.object, String(id), exec ?? {});
        if (!ok) {
          const err: any = new Error(
            `FORBIDDEN: insufficient privileges to ${op} ${ctx.object} ${id}`,
          );
          err.code = 'FORBIDDEN';
          err.status = 403;
          throw err;
        }
      }
      return next();
    }

    // INSERT / others pass through — ownership stamping is the
    // application's job (and is enforced by existing field defaults).
    return next();
  };
}

function composeAnd(existing: unknown, addition: unknown): unknown {
  if (existing == null) return addition;
  if (addition == null) return existing;
  // Both objects — merge with $and.
  if (
    typeof existing === 'object' && existing !== null && !Array.isArray(existing) &&
    typeof addition === 'object' && addition !== null && !Array.isArray(addition)
  ) {
    const ex: any = existing;
    if (Array.isArray(ex.$and)) {
      return { $and: [...ex.$and, addition] };
    }
    // Heuristic: if existing has no operator keys, attempt shallow merge;
    // otherwise nest into $and to preserve semantics.
    return { $and: [existing, addition] };
  }
  return { $and: [existing, addition] };
}

function inferTargetId(data: any, options: any): string | number | undefined {
  if (data && typeof data === 'object' && data.id != null) return data.id;
  if (options && typeof options === 'object') {
    if (options.id != null) return options.id;
    if (options.where && typeof options.where === 'object' && options.where.id != null) {
      return options.where.id;
    }
    if (options.filter && typeof options.filter === 'object' && options.filter.id != null) {
      return options.filter.id;
    }
  }
  return undefined;
}
