// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { resolveLocalizationContext } from '@objectstack/core';
import type { IDataEngine, II18nService, ISharingService } from '@objectstack/spec/contracts';
import { SysAuditLog, SysActivity, SysComment } from './objects/index.js';
// `sys_notification` was parked here "until that [ADR-0030] migration lands".
// It has landed, so the contribution moved to @objectstack/service-messaging —
// the service that writes the row on every `emit()` (#4154). This plugin never
// wrote it directly (it routes through messaging's ingress, see
// `getMessaging()` in audit-writers.ts), and it is an OPTIONAL pair in the CLI,
// so registering another service's ingress object here made that service's
// core path depend on this plugin being installed. `sys_attachment` moved to
// @objectstack/service-storage for the same ownership reason (ADR-0052 §3: a
// file↔record link belongs with storage, not the compliance ledger).
import { installAuditWriters, type AuditI18nSurface, type MessagingEmitSurface } from './audit-writers.js';
import { installCommentAccessHooks, installCommentReadVisibility } from './comment-access-hooks.js';

/**
 * AuditPlugin
 *
 * Registers the sys_audit_log / sys_activity / sys_comment system objects
 * and installs ObjectQL hook subscribers that automatically write audit
 * trail + activity stream rows on every data mutation.
 *
 * Implements ROADMAP M10.1 (CRM production-readiness).
 */
export class AuditPlugin implements Plugin {
  name = 'com.objectstack.audit';
  type = 'standard';
  version = '1.0.0';
  dependencies = ['com.objectstack.engine.objectql'];

  async init(ctx: PluginContext): Promise<void> {
    // Register audit system objects via the manifest service.
    ctx.getService<{ register(m: any): void }>('manifest').register({
      id: 'com.objectstack.audit',
      name: 'Audit',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      defaultDatasource: 'cloud',
      namespace: 'sys',
      objects: [SysAuditLog, SysActivity, SysComment],
      // ADR-0029 D7 — contribute the Audit Logs entry into the Setup app's
      // `group_diagnostics` slot. The plugin owns sys_audit_log (K2).
      navigationContributions: [
        {
          app: 'setup',
          group: 'group_diagnostics',
          priority: 100,
          items: [
            { id: 'nav_audit_logs', type: 'object', label: 'Audit Logs', objectName: 'sys_audit_log', icon: 'scroll-text' },
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
            const { AuditTranslations } = await import('./translations/index.js');
            for (const [locale, data] of Object.entries(AuditTranslations)) {
              i18n.loadTranslations(locale, data as Record<string, unknown>);
            }
          }
        } catch { /* i18n optional */ }
      });
    }

    ctx.logger.info('Audit Plugin initialized');
  }

  async start(ctx: PluginContext): Promise<void> {
    // ObjectQL engine is only resolvable after the kernel is ready.
    ctx.hook('kernel:ready', async () => {
      let engine: IDataEngine | null = null;
      try {
        engine = ctx.getService<IDataEngine>('objectql');
      } catch {
        // Fallback alias used in some kernels.
        try {
          engine = ctx.getService<IDataEngine>('data');
        } catch { /* ignore */ }
      }
      if (!engine) {
        ctx.logger.warn('AuditPlugin: ObjectQL engine not available — audit writers NOT installed');
        return;
      }
      // Create the physical tables for this plugin's system objects up-front so
      // a freshly provisioned env is consistent from the start (see
      // provisionSystemTables).
      await this.provisionSystemTables(engine, ctx);
      // Resolve the messaging service lazily at hook time so collaboration
      // @mention / assignment notifications go through the ADR-0030 single
      // ingress (emit) instead of writing sys_notification directly. Messaging
      // may register after audit; lazy resolution tolerates either order.
      const getMessaging = (): MessagingEmitSurface | undefined => {
        try {
          return ctx.getService<MessagingEmitSurface>('messaging');
        } catch {
          return undefined;
        }
      };
      // framework#3039 — localize activity summaries to the workspace default
      // locale (ADR-0053 `localization.locale`). Both seams resolve lazily and
      // tolerate absence: no i18n / no settings degrades to English summaries.
      const getI18n = (): AuditI18nSurface | undefined => {
        try {
          return ctx.getService<AuditI18nSurface>('i18n');
        } catch {
          return undefined;
        }
      };
      const getLocale = async (tenantId?: string, userId?: string): Promise<string | undefined> => {
        let settings: unknown;
        try {
          settings = ctx.getService('settings');
        } catch {
          settings = undefined;
        }
        const { locale } = await resolveLocalizationContext({ ql: engine, settings, tenantId, userId });
        return locale;
      };
      installAuditWriters(engine as any, this.name, { getMessaging, getI18n, getLocale });
      ctx.logger.info('AuditPlugin: audit + activity writers installed');

      // #4630 — record-level authorization for sys_comment: a comment's access
      // derives from the record its `thread_id` names, exactly as an
      // attachment's derives from its parent (service-storage's
      // installAttachmentAccessHooks / installAttachmentReadVisibility). Both
      // halves are needed: the hooks gate writes, the middleware is the only
      // seam that filters `count()` (→ list `total`) like `find()`. Orthogonal
      // to `enforceFeedsCapability` above, which gates `enable.feeds`, not
      // access. The sharing service resolves lazily so plugin order doesn't
      // matter; without it the edit checks degrade to parent read visibility.
      if (typeof (engine as any).registerHook === 'function') {
        installCommentAccessHooks(
          engine as any,
          () => {
            try {
              // Typed with the slot's contract (#4251): the gate consults
              // `canEdit` only, but it consults the REAL interface.
              return ctx.getService<ISharingService>('sharing');
            } catch {
              return null;
            }
          },
          ctx.logger,
        );
        if (typeof (engine as any).registerMiddleware === 'function') {
          installCommentReadVisibility(engine as any, ctx.logger);
        } else {
          ctx.logger.warn(
            'AuditPlugin: engine has no middleware seam — sys_comment READ visibility NOT installed ' +
              '(comments on records the caller cannot read would be listable)',
          );
        }
        ctx.logger.info('AuditPlugin: sys_comment record-level access gates installed');
      }
    });
  }

  /**
   * Provision the physical tables for this plugin's system objects up-front.
   *
   * sys_audit_log / sys_activity / sys_comment are otherwise lazy-created on
   * first WRITE (the SQL driver issues DDL when the first row is inserted). A
   * freshly provisioned env that READS one first — the home page's recent-
   * activity feed queries sys_activity before any mutation has happened — hits
   * SQLite "no such table", which the engine logs as a `Find operation failed`
   * ERROR on every load. The UI degrades to an empty feed, but the log is noisy
   * and can mask real errors. Creating the tables at kernel:ready (once the
   * engine + registry are ready) makes a new env consistent from the start.
   *
   * `syncObjectSchema` is idempotent — the SQL driver only creates a table when
   * it is absent (and alters to add columns) — so this is safe on every boot,
   * and a no-op for objects whose table already exists. Per-object failures are
   * isolated so one bad object can't block the rest.
   *
   * ## Why this method reports where each table landed (#4887)
   *
   * `syncObjectSchema` returns `void` and exits SILENTLY on three conditions
   * the plugin cannot see from the outside: the object is not in the registry,
   * no driver resolves for it, or the resolved driver has no `syncSchema`. A
   * caller that only catches throws therefore cannot tell "created" from "did
   * nothing" — and neither could a reader of the log, because this method said
   * nothing at all on success.
   *
   * That silence cost a whole misdiagnosis. #4887 reported these tables as
   * "never provisioned" because they were absent from the primary SQLite file,
   * and concluded the guard below had bailed out. It had not: `sys_audit_log`
   * (`lifecycle.class: 'audit'`) and `sys_activity` (`lifecycle.class:
   * 'telemetry'`) are routed by ADR-0057 §3.6 to the dedicated `telemetry`
   * datasource whenever one is registered — which `os dev` provisions by
   * default as a SIBLING FILE (`dev.db` → `dev.telemetry.db`). Their tables
   * were created, in that other store. `sys_comment` carries no lifecycle
   * class, stays on the primary, and was the one the reporter found. So the
   * provisioning loop reports the resolved datasource per object, and calls out
   * the split explicitly when it is in effect: a table that is "missing" from
   * the database you are looking at, and a table that was never created, are
   * different problems, and the log now distinguishes them.
   */
  private async provisionSystemTables(engine: IDataEngine, ctx: PluginContext): Promise<void> {
    // `syncObjectSchema` lives on the concrete ObjectQL engine, not the
    // IDataEngine contract; engines/drivers without on-demand DDL (e.g. an
    // in-memory test double) simply skip provisioning.
    const sync = (engine as unknown as { syncObjectSchema?: (name: string) => Promise<void> }).syncObjectSchema;
    if (typeof sync !== 'function') {
      // #4887 — this return used to be silent, so "provisioning was skipped
      // wholesale" and "provisioning ran fine" produced identical logs. Name
      // the consequence, not just the condition.
      ctx.logger.warn(
        'AuditPlugin: this engine exposes no syncObjectSchema() — sys_audit_log / sys_activity / sys_comment were NOT ' +
          'provisioned up-front and stay lazy-created on first WRITE. An env that READS one first (the home page ' +
          'activity feed queries sys_activity before any mutation) will log "no such table" until something writes to it.',
      );
      return;
    }
    // Same optional-probe posture as `syncObjectSchema` above: `getDriverForObject`
    // is public on the concrete ObjectQL engine but not part of IDataEngine, so
    // engines that lack it simply report no datasource — never an error.
    const resolveDriver = (engine as unknown as {
      getDriverForObject?: (name: string) => { name?: string } | undefined;
    }).getDriverForObject;
    // Declared on IDataEngine (optional — engines with no named-driver registry
    // omit it), so no cast is needed here.
    const defaultDatasource = engine.getDefaultDriverName?.();

    const placements: string[] = [];
    const offDefault: string[] = [];
    for (const obj of [SysAuditLog, SysActivity, SysComment]) {
      try {
        await sync.call(engine, obj.name);
      } catch (err) {
        ctx.logger.warn(`AuditPlugin: could not provision ${obj.name} storage — ${(err as Error)?.message ?? err}`);
        continue;
      }
      if (typeof resolveDriver !== 'function') continue;
      let datasource: string | undefined;
      try {
        datasource = resolveDriver.call(engine, obj.name)?.name;
      } catch {
        datasource = undefined;
      }
      if (!datasource) {
        // The second of the two silent exits #4887 asked to make audible: the
        // call above resolved without throwing, but no driver backs this object,
        // so `syncObjectSchema` returned having issued no DDL at all.
        ctx.logger.warn(
          `AuditPlugin: ${obj.name} resolves to NO datasource driver — syncObjectSchema() returned without creating its ` +
            'storage. Reads and writes against it will fail with "no such table" until a driver backs its datasource.',
        );
        continue;
      }
      placements.push(`${obj.name}→${datasource}`);
      if (defaultDatasource !== undefined && datasource !== defaultDatasource) offDefault.push(`${obj.name}→${datasource}`);
    }

    if (placements.length > 0) {
      ctx.logger.info(`AuditPlugin: system tables provisioned — ${placements.join(', ')}`);
    }
    if (offDefault.length > 0) {
      ctx.logger.info(
        `AuditPlugin: ${offDefault.join(', ')} live on a NON-default datasource (ADR-0057 §3.6 lifecycle-class ` +
          `separation), not on '${defaultDatasource}'. Their tables exist in that store — on SQLite, a different FILE. ` +
          'Anything that reads them without naming the object (raw SQL on the default datasource) will report ' +
          '"no such table" even though provisioning succeeded.',
      );
    }
  }
}
