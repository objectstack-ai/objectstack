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
import { installReadAuditWriter, type ReadAuditWriterHandle } from './read-audit.js';
import { createAuthEventAuditSink } from './auth-event-audit.js';
import { installCommentAccessHooks, installCommentReadVisibility } from './comment-access-hooks.js';
import { installActivityReadVisibility } from './activity-read-visibility.js';
import { installActivityFieldRedaction } from './activity-field-redaction.js';
import { installAuditLogFieldRedaction } from './audit-log-field-redaction.js';
import { installAuditLogReadVisibility } from './audit-log-read-visibility.js';
import type { FieldVisibilitySource } from './served-fields.js';
import { installParentFieldQueryGuards } from './parent-field-query-guard.js';

/**
 * [#8992] Read/view audit configuration — the per-object opt-in, closed.
 *
 * Not a global flag with exceptions: the maintainer's 2026-08-16 ruling chose a
 * closed opt-in deliberately, because on a compliance surface the failure modes
 * of the two shapes are not symmetric. A global flag that forgets an exception
 * over-collects (noisy, expensive, and it buries the views an auditor is
 * looking for); an opt-in that forgets an object under-collects, which is
 * visible the moment anyone asks the question this capability exists to answer.
 */
export interface AuditPluginReadAuditOptions {
  /**
   * Objects whose RECORD-DETAIL views are recorded as `read` rows in
   * `sys_audit_log`. Absent or empty installs no hook at all — a deployment
   * that opts nothing in pays nothing on its read path.
   *
   * ⛔ Scope is record-detail views only (a read that materialized one record
   * and pinned its primary key). List and search results are NOT audited: that
   * is a deferred follow-up, and a deferral that leaked rows anyway would not
   * be one.
   */
  objects?: readonly string[];
  /** Flush once this many views are buffered. Default 50. */
  maxBatchSize?: number;
  /** Flush this long after the first view of a batch. Default 2000ms. */
  flushIntervalMs?: number;
}

/** Constructor options for {@link AuditPlugin}. */
export interface AuditPluginOptions {
  /** [#8992] Record-view auditing. Off unless objects are named. */
  readAudit?: AuditPluginReadAuditOptions;
  /**
   * Host locale resolver: the language this plugin writes its reader-facing
   * text in — `sys_activity.summary`, and the title of the @mention
   * notification it emits. Called with the write's organization (`tenantId`)
   * and user (`userId`; for an @mention title, the mentioned recipient).
   *
   * **Precedence: host first, settings second.** When given, this resolver is
   * asked first. When it answers nothing (`undefined`, `null` or a blank
   * string), the plugin uses the locale it resolves without this option: the
   * deployment's settings-derived `localization.locale` (ADR-0053, read
   * through `resolveLocalizationContext`). Two faults fall back the same way,
   * and neither fails the audited write: a throw (or a rejected promise), and
   * an answer that is not a well-formed BCP-47 locale tag (`zh_CN`, a
   * non-string). Each fault is logged once at `warn`. An accepted answer is
   * used in its canonical form (`zh-cn` → `zh-CN`).
   *
   * Absent, the settings-derived locale is the only source, exactly as for a
   * plugin built without this option. The writer memoizes the answer per
   * tenant/user scope for a short TTL, so an implementation may read its own
   * storage directly. The locale only picks the message catalog: a locale the
   * deployment's i18n service has no catalog for degrades the way a
   * settings-derived one does, to the service's declared fallback and then to
   * the English literal.
   */
  getLocale?: (tenantId?: string, userId?: string) => string | undefined | Promise<string | undefined>;
}

/**
 * The host half of the write locale ({@link AuditPluginOptions.getLocale}).
 *
 * Answers the resolver's locale when it is usable, else `undefined`, which
 * sends the caller on to the settings-derived locale. A throw is caught here
 * rather than left to the writer: the writer turns a thrown lookup into NO
 * locale (English summaries), where the host's fault should cost only the
 * host's half. Each fault is reported once per install — the writer asks per
 * tenant/user scope, so a broken resolver would otherwise log once per scope.
 */
function createHostLocaleReader(
  resolver: NonNullable<AuditPluginOptions['getLocale']>,
  logger: PluginContext['logger'],
): (tenantId?: string, userId?: string) => Promise<string | undefined> {
  const fallsBack =
    'activity summaries and @mention notification titles fall back to the settings-derived locale (localization.locale)';
  let throwReported = false;
  let malformedReported = false;
  return async (tenantId, userId) => {
    let answer: unknown;
    try {
      answer = await resolver(tenantId, userId);
    } catch (err) {
      if (!throwReported) {
        throwReported = true;
        logger.warn(
          `AuditPlugin: the host getLocale resolver threw — ${fallsBack} wherever it throws. Reported once.`,
          { err: err instanceof Error ? err.message : String(err) },
        );
      }
      return undefined;
    }
    if (answer === undefined || answer === null) return undefined;
    if (typeof answer === 'string') {
      const trimmed = answer.trim();
      if (trimmed === '') return undefined;
      try {
        const [canonical] = Intl.getCanonicalLocales(trimmed);
        if (canonical) return canonical;
      } catch {
        // Not a well-formed BCP-47 tag — reported below.
      }
    }
    if (!malformedReported) {
      malformedReported = true;
      const shown = typeof answer === 'string' ? JSON.stringify(answer) : `a ${typeof answer}`;
      logger.warn(
        `AuditPlugin: the host getLocale resolver answered ${shown}, which is not a well-formed BCP-47 locale tag — `
          + `${fallsBack} wherever it does. Reported once.`,
      );
    }
    return undefined;
  };
}

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
  type = 'standard' as const;
  version = '1.0.0';
  dependencies = ['com.objectstack.engine.objectql'];
  /**
   * [#8144] The `audit` slot — the ledger's WRITE ingress for events that are
   * not CRUD (`login`/`logout` today). Declared here because `init()` registers
   * it unconditionally, which is what ADR-0116 / `plugin-order.ts` reads this
   * field to mean.
   */
  providesServices = ['audit'];

  /**
   * [#8992] The record-view writer's handle, held so `destroy()` can flush the
   * tail. A batched ledger that never flushes on shutdown loses its last batch
   * on every clean restart — silently, because the reads it describes all
   * succeeded.
   */
  private readAuditWriter: ReadAuditWriterHandle | null = null;

  constructor(private readonly options: AuditPluginOptions = {}) {}

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
      // ADR-0029 D7 — contribute the Audit Logs entries into the Setup app's
      // `group_diagnostics` slot. The plugin owns sys_audit_log (K2), so both
      // doors onto it live and die with this plugin and need no item gate.
      //
      // #20142 — the two entries are two different surfaces, and neither is a
      // superset of the other:
      //  - `nav_audit_logs` is the object view: `sys_audit_log`'s named list
      //    views (`record_views` lists the `read` rows, an action the page's
      //    filter did not offer at the console pin this entry was measured
      //    against), searchable, with the actor and tenant rendered as
      //    resolved lookups.
      //  - `nav_audit_log_browser` is the console's Audit Log page (the
      //    `audit:log` registry key, `registerSystemComponents.tsx`): one
      //    filterable table whose detail drawer pretty-prints a change's
      //    before and after JSON, where the record page shows `old_value` /
      //    `new_value` as raw textarea text.
      navigationContributions: [
        {
          app: 'setup',
          group: 'group_diagnostics',
          priority: 100,
          items: [
            { id: 'nav_audit_logs', type: 'object', label: 'Audit Logs', objectName: 'sys_audit_log', icon: 'scroll-text' },
            { id: 'nav_audit_log_browser', type: 'component', label: 'Audit Log Browser', componentRef: 'audit:log', icon: 'file-diff' },
          ],
        },
      ],
    });

    // [#8144] The non-CRUD write ingress. Registered in init() — plugin-auth
    // resolves it lazily and calls it from better-auth's session lifecycle
    // hooks, i.e. at request time, so the engine is resolved per call rather
    // than captured: the service exists from init() while `objectql` only
    // resolves at kernel:ready, and every caller arrives long after both.
    ctx.registerService(
      'audit',
      createAuthEventAuditSink({
        getEngine: () => {
          try {
            return ctx.getService<IDataEngine>('objectql');
          } catch {
            // Same fallback alias `start()` uses below — some kernels register
            // the engine as `data`.
            try {
              return ctx.getService<IDataEngine>('data');
            } catch {
              return undefined;
            }
          }
        },
        logger: ctx.logger,
      }),
    );

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
      // The host's resolver, when given, is asked first (`getLocale` on
      // AuditPluginOptions documents the precedence); without a usable answer
      // the settings-derived locale below decides, as it does with no option.
      const readHostLocale = this.options.getLocale
        ? createHostLocaleReader(this.options.getLocale, ctx.logger)
        : undefined;
      const getLocale = async (tenantId?: string, userId?: string): Promise<string | undefined> => {
        if (readHostLocale) {
          const hostLocale = await readHostLocale(tenantId, userId);
          if (hostLocale !== undefined) return hostLocale;
        }
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

      // [#8992] Record-view auditing — the `read` half of the ledger. Installed
      // only over the objects this deployment opted in, and returns null when
      // that set is empty, so the default posture costs a read exactly nothing.
      const readAuditObjects = this.options.readAudit?.objects ?? [];
      this.readAuditWriter = installReadAuditWriter(engine, {
        objects: readAuditObjects,
        packageId: this.name,
        logger: ctx.logger,
        ...(this.options.readAudit?.maxBatchSize !== undefined
          ? { maxBatchSize: this.options.readAudit.maxBatchSize }
          : {}),
        ...(this.options.readAudit?.flushIntervalMs !== undefined
          ? { flushIntervalMs: this.options.readAudit.flushIntervalMs }
          : {}),
      });
      if (this.readAuditWriter) {
        ctx.logger.info(
          `AuditPlugin: record-view auditing installed on ${this.readAuditWriter.auditedObjects.length} object(s) — `
            + `${this.readAuditWriter.auditedObjects.join(', ')}`,
        );
      }

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
          // [#21755] The deployment's i18n lookup for the not-visible refusal's
          // sentence — resolved per refusal (ADR-0029 D8: i18n may register
          // after this plugin), the override address plugin-security's own
          // not-visible refusal renders through.
          () => {
            const i18n = ctx.getService<II18nService>('i18n');
            const t = i18n?.t;
            if (typeof t !== 'function') return undefined;
            return (key: string, loc: string, params?: Record<string, unknown>) => t.call(i18n, key, loc, params);
          },
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

      // sys_activity READ visibility — an activity row is readable when the
      // record it is about (`object_name`, `record_id`) is readable, decided by
      // the same caller-scoped parent read the sys_comment gate above asks.
      // The object is append-only with `apiMethods: ['get', 'list']`, so the
      // read side is the whole gate. Without the middleware seam it cannot be
      // installed, and that is said rather than left silent.
      if (typeof (engine as any).registerMiddleware === 'function') {
        // [#21154] A query that filters, sorts, searches, groups or aggregates
        // by a value-bearing column of the activity stream or the ledger is
        // judged before the read gate below runs its pre-scan — a read-time
        // redaction narrows only what is served, so such a predicate would
        // select on a value the reader is not served. The security service is
        // resolved on every read, as for the redaction.
        installParentFieldQueryGuards(
          engine as any,
          () => {
            try {
              const sec = ctx.getService<FieldVisibilitySource>('security');
              return sec && typeof sec.getReadableFields === 'function' ? sec : undefined;
            } catch {
              return undefined;
            }
          },
          ctx.logger,
        );
        installActivityReadVisibility(engine as any, ctx.logger);
        ctx.logger.info('AuditPlugin: sys_activity parent-record read visibility installed');
        // [#21081] …and of each row it keeps, the value-bearing columns serve a
        // parent field only to a reader the security service serves that field
        // unmasked. The service is resolved on EVERY read, for the reason the
        // approval snapshot gives: the security plugin may register after this
        // one, and a resolver captured now would pin "no service" — i.e. never
        // redact — for the life of the process. `getService` throws on an empty
        // slot, so a deployment without the security plugin (no field-level
        // security anywhere) serves rows exactly as before.
        const getSecurity = (): FieldVisibilitySource | undefined => {
          try {
            const sec = ctx.getService<FieldVisibilitySource>('security');
            return sec && typeof sec.getReadableFields === 'function' ? sec : undefined;
          } catch {
            return undefined;
          }
        };
        installActivityFieldRedaction(engine as any, getSecurity, ctx.logger);
        ctx.logger.info('AuditPlugin: sys_activity field redaction installed');
        // [#21155] The compliance ledger's before/after snapshots take the same
        // narrowing, through the same answer and the same resolver: a ledger
        // reader is not field-unrestricted by default. An auditor who must see
        // every field is granted it by a set that unmasks those fields.
        installAuditLogFieldRedaction(engine as any, getSecurity, ctx.logger);
        ctx.logger.info('AuditPlugin: sys_audit_log field redaction installed');
        // [#21175] …and the ledger's rows take the activity stream's parent-record
        // gate: a row about a record is served only to a caller who can read it.
        // Middleware runs in registration order, so on the ledger the #21154
        // query guard above judges a query first (a refused query never pays
        // this gate's pre-scan), and the field redaction narrows only the rows
        // this gate keeps.
        installAuditLogReadVisibility(engine as any, ctx.logger);
        ctx.logger.info('AuditPlugin: sys_audit_log parent-record read visibility installed');
      } else {
        ctx.logger.warn(
          'AuditPlugin: engine has no middleware seam — sys_activity READ visibility and field redaction, and ' +
            'sys_audit_log READ visibility and field redaction, NOT installed (activity and ledger rows about ' +
            'records the caller cannot read would be listable, and an activity row or a ledger snapshot would ' +
            'serve every parent field value it carries)',
        );
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

  /**
   * [#8992] Flush the record-view tail on shutdown.
   *
   * Batching is what keeps the ledger write off the read path, and the price of
   * a buffer is that a clean shutdown can take the last batch with it. The
   * views in it already returned 200, so nothing else would ever report the
   * loss. `stop()` cancels the timer and drains what is left; it never throws
   * (the batcher's `persist` reports and swallows), so this can never turn a
   * clean shutdown into a failed one.
   */
  async destroy(): Promise<void> {
    const writer = this.readAuditWriter;
    this.readAuditWriter = null;
    if (writer) await writer.stop();
  }
}
