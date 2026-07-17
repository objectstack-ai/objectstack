// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { resolveLocalizationContext } from '@objectstack/core';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { SysAuditLog, SysActivity, SysComment } from './objects/index.js';
// `sys_notification` is contributed here but owned by platform-objects; it is
// being reworked by ADR-0030 messaging (notification→event), so it stays put
// until that migration lands. `sys_attachment` moved to @objectstack/service-
// storage (ADR-0052 §3 ownership: a file↔record link belongs with storage, not
// the compliance ledger).
import { SysNotification } from '@objectstack/platform-objects/audit';
import { installAuditWriters, type AuditI18nSurface, type MessagingEmitSurface } from './audit-writers.js';

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
      objects: [SysAuditLog, SysActivity, SysComment, SysNotification],
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
          const i18n = ctx.getService<any>('i18n');
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
   */
  private async provisionSystemTables(engine: IDataEngine, ctx: PluginContext): Promise<void> {
    // `syncObjectSchema` lives on the concrete ObjectQL engine, not the
    // IDataEngine contract; engines/drivers without on-demand DDL (e.g. an
    // in-memory test double) simply skip provisioning.
    const sync = (engine as unknown as { syncObjectSchema?: (name: string) => Promise<void> }).syncObjectSchema;
    if (typeof sync !== 'function') return;
    for (const obj of [SysAuditLog, SysActivity, SysComment]) {
      try {
        await sync.call(engine, obj.name);
      } catch (err) {
        ctx.logger.warn(`AuditPlugin: could not provision ${obj.name} storage — ${(err as Error)?.message ?? err}`);
      }
    }
  }
}
