// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IHttpServer, IDataEngine } from '@objectstack/spec/contracts';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import type { ICryptoProvider } from '@objectstack/spec/contracts';
import type { SettingsAuditSink, SettingsAuditWriter, SettingsEngine, SettingsSecretStore } from './settings-service.types.js';
import type { CryptoAdapter } from './crypto-adapter.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';
import { registerSettingsRoutes } from './settings-routes.js';
import {
  settingsObjects,
  settingsPluginManifestHeader,
  SETTINGS_PLUGIN_ID,
  SETTINGS_PLUGIN_VERSION,
} from './manifest.js';
import {
  builtinSettingsManifests,
  mailTestActionHandler,
  storageTestActionHandler,
  aiTestActionHandler,
} from './manifests/index.js';
import { settingsBuiltinTranslations } from './translations/index.js';

/** Configuration options for the SettingsServicePlugin. */
export interface SettingsServicePluginOptions {
  /**
   * Pre-register these manifests at boot. When omitted, the bundled
   * builtin manifests (mail / branding / feature_flags) are loaded so
   * a host gets a working Settings hub out of the box. Pass an empty
   * array to opt out entirely.
   */
  manifests?: SettingsManifest[];
  /** Override the default crypto adapter. */
  crypto?: CryptoAdapter;

  /**
   * Phase 3 KMS hook. When provided, encrypted specifier values are
   * routed through this provider into `sys_secret`; `sys_setting.value_enc`
   * holds the handle id only. Defaults to `LocalCryptoProvider`, an
   * AES-256-GCM provider keyed off `OS_SECRET_KEY` (or a persisted dev key).
   * In production it refuses to boot without a stable key rather than
   * silently minting an ephemeral one. Swap in an AWS / GCP / Vault
   * KMS-backed implementation for managed custody and per-tenant keys.
   */
  cryptoProvider?: ICryptoProvider;
  /** Override the default base path (`/api/settings`). */
  basePath?: string;
  /** Disable REST route registration. */
  registerRoutes?: boolean;
  /** Override the env source. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /**
   * Action handlers to register at boot, keyed by namespace and action
   * id. The bundled `mail.test` handler is registered automatically
   * unless this object is provided.
   */
  actionHandlers?: Record<string, Record<string, import('./settings-service.types.js').SettingsActionHandler>>;
}

/**
 * SettingsServicePlugin — wires the SettingsService into the kernel.
 *
 *  1. `init`: instantiate the service, register it under `'settings'`,
 *     and ship `sys_setting` to the manifest service so the engine
 *     auto-provisions the table.
 *  2. `start` → `kernel:ready`: bind the data engine (when present),
 *     wire the audit sink (when present), mount REST routes.
 */
export class SettingsServicePlugin implements Plugin {
  name = SETTINGS_PLUGIN_ID;
  version = SETTINGS_PLUGIN_VERSION;
  type = 'standard' as const;

  private readonly opts: SettingsServicePluginOptions;
  private service: SettingsService | null = null;

  constructor(opts: SettingsServicePluginOptions = {}) {
    this.opts = {
      ...opts,
      manifests: opts.manifests ?? builtinSettingsManifests,
      actionHandlers: opts.actionHandlers ?? {
        mail: { test: mailTestActionHandler },
        storage: { test: storageTestActionHandler },
        ai: { test: aiTestActionHandler },
      },
    };
  }

  async init(ctx: PluginContext): Promise<void> {
    this.service = new SettingsService({
      crypto: this.opts.crypto,
      env: this.opts.env,
    });
    for (const m of this.opts.manifests ?? []) this.service.registerManifest(m);
    for (const [ns, handlers] of Object.entries(this.opts.actionHandlers ?? {})) {
      for (const [id, fn] of Object.entries(handlers)) {
        this.service.registerAction(ns, id, fn);
      }
    }

    ctx.registerService('settings', this.service);
    ctx.logger?.info?.(
      `SettingsServicePlugin: registered (manifests=${this.opts.manifests?.length ?? 0})`,
    );

    // Register the K/V object so the engine creates the table.
    try {
      ctx.getService<{ register(m: any): void }>('manifest').register({
        ...settingsPluginManifestHeader,
        objects: settingsObjects,
      });
    } catch {
      // manifest service is optional — skip in lean test kernels.
    }
  }

  async start(ctx: PluginContext): Promise<void> {
    if (!this.service) return;

    ctx.hook('kernel:ready', async () => {
      // Contribute built-in settings translations into the i18n service.
      // Done in `kernel:ready` (not `init`) because the i18n service plugin
      // is typically registered AFTER capability-loaded service plugins.
      try {
        const i18n = ctx.getService<{
          loadTranslations: (locale: string, data: Record<string, unknown>) => void;
        }>('i18n');
        let loaded = 0;
        for (const [locale, data] of Object.entries(settingsBuiltinTranslations)) {
          if (data && typeof data === 'object') {
            try {
              i18n.loadTranslations(locale, data as Record<string, unknown>);
              loaded++;
            } catch (err: any) {
              ctx.logger?.warn?.(
                `SettingsServicePlugin: failed to load translations for '${locale}': ${err?.message ?? err}`,
              );
            }
          }
        }
        if (loaded > 0) {
          ctx.logger?.info?.(
            `SettingsServicePlugin: contributed built-in translations (${loaded} locale${loaded > 1 ? 's' : ''})`,
          );
        }
      } catch {
        // i18n service not registered — manifest literals remain authoritative.
      }

      // Late-bind the data engine.
      let engine: IDataEngine | null = null;
      try {
        engine = ctx.getService<IDataEngine>('objectql');
      } catch {
        // ok — fall back to in-memory.
      }
      if (engine) {
        // Late-bind the engine + audit sink on the existing service
        // instance. We avoid re-registering the service because the
        // kernel disallows `registerService` for an already-registered
        // name.
        //
        // SettingsEngine and IDataEngine have *different* update
        // signatures — SettingsEngine bundles `{ where, data }` into a
        // single opts object, while IDataEngine takes
        // `(object, data, options?)` and extracts the row id from
        // `data.id` or `options.where.id`. A force-cast leaves runtime
        // calls to `update(object, { where, data })` reaching the real
        // engine as a malformed payload with no id, which then throws
        // "Update requires an ID or options.multi=true". The adapter
        // below performs the translation so SettingsService can keep
        // its narrow, bundled signature.
        this.service!.bindEngine(
          wrapEngineAsSettingsEngine(engine),
          this.buildAuditSink(ctx, engine),
          {
            secretStore: this.buildSecretStore(engine),
            auditWriter: this.buildAuditWriter(ctx, engine),
            cryptoProvider: this.opts.cryptoProvider ?? new LocalCryptoProvider(),
          },
        );
      }

      if (this.opts.registerRoutes === false) return;

      let http: IHttpServer | null = null;
      try {
        http = ctx.getService<IHttpServer>('http-server');
      } catch {
        // ok — no HTTP server in this deployment.
      }
      if (!http) {
        ctx.logger?.warn?.(
          'SettingsServicePlugin: no HTTP server available — REST routes not registered. ' +
            'SettingsService is still reachable via kernel.getService("settings").',
        );
        return;
      }
      registerSettingsRoutes(http, this.service!, { basePath: this.opts.basePath });
      ctx.logger?.info?.(
        'SettingsServicePlugin: REST routes registered at ' + (this.opts.basePath ?? '/api/settings'),
      );
    });
  }

  /** Glue an `engine.insert('sys_audit_log', …)` audit sink. */
  private buildAuditSink(ctx: PluginContext, engine: IDataEngine): SettingsAuditSink {
    return {
      record: async (entry) => {
        try {
          await (engine as any).insert?.('sys_audit_log', {
            actor_id: entry.userId ?? null,
            entity_type: 'sys_setting',
            entity_id: `${entry.namespace}.${entry.key}`,
            action: entry.action,
            payload: {
              namespace: entry.namespace,
              key: entry.key,
              scope: entry.scope,
              encrypted: entry.encrypted,
              digest: entry.valueDigest,
            },
            request_id: entry.requestId ?? null,
            occurred_at: new Date().toISOString(),
          });
        } catch (err: any) {
          ctx.logger?.warn?.('SettingsServicePlugin: audit record failed: ' + (err?.message ?? err));
        }
      },
    };
  }

  /**
   * Phase 3: build a `sys_secret`-backed implementation of
   * `SettingsSecretStore`. The store bypasses the tenant audit
   * warning because secrets are scoped through their owning
   * `sys_setting` row (which already carries the tenant context).
   */
  private buildSecretStore(engine: IDataEngine): SettingsSecretStore {
    const eng: any = engine;
    return {
      async insert(row) {
        await eng.insert('sys_secret', row, { bypassTenantAudit: true });
        return { id: row.id };
      },
      async get(id) {
        const rows = await eng.find('sys_secret', {
          where: { id },
          limit: 1,
          bypassTenantAudit: true,
        });
        const row = Array.isArray(rows) ? rows[0] : rows?.data?.[0];
        return row ?? null;
      },
      async update(id, patch) {
        // IDataEngine.update signature is `(object, data, options?)`
        // and extracts the record id from `data.id` (or
        // `options.where.id`). Passing `{ where, data, ... }` as the
        // data argument left id=undefined and tripped
        // "Update requires an ID or options.multi=true".
        await eng.update(
          'sys_secret',
          { id, ...patch },
          { bypassTenantAudit: true },
        );
      },
    };
  }

  /**
   * Phase 3: append-only writer for `sys_setting_audit`. Failures here
   * MUST NOT abort the settings write, so all calls are wrapped in a
   * try/catch and reported through the plugin logger.
   */
  private buildAuditWriter(ctx: PluginContext, engine: IDataEngine): SettingsAuditWriter {
    const eng: any = engine;
    return {
      write: async (entry) => {
        try {
          await eng.insert('sys_setting_audit', {
            namespace: entry.namespace,
            key: entry.key,
            scope: entry.scope,
            action: entry.action,
            source: entry.source ?? 'api',
            actor_id: entry.actorId ?? null,
            old_hash: entry.oldHash ?? null,
            new_hash: entry.newHash ?? null,
            encrypted: !!entry.encrypted,
            request_id: entry.requestId ?? null,
            reason: entry.reason ?? null,
            created_at: new Date().toISOString(),
          }, { bypassTenantAudit: true });
        } catch (err: any) {
          ctx.logger?.warn?.('SettingsServicePlugin: setting-audit write failed: ' + (err?.message ?? err));
        }
      },
    };
  }
}

/**
 * Translate an `IDataEngine` instance into the narrower `SettingsEngine`
 * surface used inside `SettingsService`. The two interfaces diverge on
 * `update`:
 *
 *   - SettingsEngine: `update(object, { where, data, bypassTenantAudit })`
 *   - IDataEngine:    `update(object, data, options?)` — id comes from
 *     `data.id` or `options.where.id`; otherwise the engine throws
 *     "Update requires an ID or options.multi=true".
 *
 * The adapter resolves the row id from `where.id` when present and
 * forwards everything in IDataEngine's positional form. When the caller
 * supplies a non-id where clause (composite-key tables), we fall back
 * to `multi: true` so the engine routes through `driver.updateMany`
 * instead of throwing.
 */
function wrapEngineAsSettingsEngine(engine: IDataEngine): SettingsEngine {
  const eng: any = engine;
  return {
    async find(objectName, opts) {
      return eng.find(objectName, opts);
    },
    async insert(objectName, data, opts) {
      return eng.insert(objectName, data, opts);
    },
    async update(objectName, opts) {
      const { where, data, bypassTenantAudit } = opts as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
        bypassTenantAudit?: boolean;
      };
      const driverOpts = bypassTenantAudit ? { bypassTenantAudit: true } : undefined;
      const id = (where as any)?.id;
      if (id !== undefined && id !== null) {
        return eng.update(objectName, { id, ...data }, driverOpts);
      }
      return eng.update(objectName, data, {
        where,
        multi: true,
        ...(driverOpts ?? {}),
      });
    },
  };
}
