// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IHttpServer, IDataEngine, IStorageService } from '@objectstack/spec/contracts';
import {
  OBSERVABILITY_METRICS_SERVICE,
  NoopMetricsRegistry,
  type MetricsRegistry,
} from '@objectstack/observability';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import type { LocalStorageAdapterOptions } from './local-storage-adapter.js';
import { S3StorageAdapter } from './s3-storage-adapter.js';
import type { S3StorageAdapterOptions } from './s3-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';
import { installAttachmentLifecycleHooks, createSysFileReapGuard } from './attachment-lifecycle.js';
import { SystemFile, SystemUploadSession } from './objects/index.js';
// ADR-0052 §3 ownership: `sys_attachment` (a file↔record link) belongs with the
// storage domain, not the audit/compliance ledger. Definition stays in
// platform-objects; storage now contributes (registers) it instead of audit.
import { SysAttachment } from '@objectstack/platform-objects/audit';
import { SwappableStorageService } from './swappable-storage-service.js';

/**
 * Configuration options for the StorageServicePlugin.
 */
export interface StorageServicePluginOptions {
  /** Storage adapter type (default: 'local') */
  adapter?: 'local' | 's3';
  /** Options for the local storage adapter */
  local?: LocalStorageAdapterOptions;
  /** S3 configuration (used when adapter is 's3') */
  s3?: { bucket: string; region: string; endpoint?: string };
  /**
   * Whether to register REST routes with the HTTP server.
   * @default true
   */
  registerRoutes?: boolean;
  /**
   * Base path for storage REST routes.
   * @default '/api/v1/storage'
   */
  basePath?: string;
  /**
   * Default presigned URL TTL in seconds.
   * @default 3600
   */
  presignedTtl?: number;
  /**
   * Default chunked upload session TTL in seconds.
   * @default 86400
   */
  sessionTtl?: number;
  /**
   * Bind to the `storage` settings namespace and rebuild the inner
   * adapter on every `settings:changed` event. Disable to keep the
   * adapter constructor-driven (useful in tests). Default: true.
   */
  bindToSettings?: boolean;
  /**
   * Optional explicit metrics backend. Wins over the service-registry
   * lookup. Mostly an escape hatch for tests; production hosts should
   * register `ObservabilityServicePlugin` (from `@objectstack/runtime`)
   * once and let every service pick the host's backend up automatically.
   */
  metrics?: MetricsRegistry;
}

/**
 * StorageServicePlugin — Production IStorageService implementation.
 *
 * Registers a file storage service with the kernel during the init phase.
 * Supports local filesystem (development/testing/single-server) and
 * S3-compatible storage (production). Automatically mounts
 * `/api/v1/storage/*` REST routes via the `kernel:ready` hook when an
 * HTTP server is available.
 *
 * @example
 * ```ts
 * import { ObjectKernel } from '@objectstack/core';
 * import { StorageServicePlugin } from '@objectstack/service-storage';
 *
 * const kernel = new ObjectKernel();
 * kernel.use(new StorageServicePlugin({
 *   adapter: 'local',
 *   local: { rootDir: './uploads' },
 * }));
 * await kernel.bootstrap();
 *
 * const storage = kernel.getService('file-storage');
 * await storage.upload('file.txt', Buffer.from('hello'));
 * ```
 */
export class StorageServicePlugin implements Plugin {
  name = 'com.objectstack.service.storage';
  version = '1.0.0';
  type = 'standard';

  private readonly options: StorageServicePluginOptions;
  private storage: SwappableStorageService | null = null;
  private store: StorageMetadataStore | null = null;
  private metrics: MetricsRegistry = new NoopMetricsRegistry();

  constructor(options: StorageServicePluginOptions = {}) {
    this.options = { adapter: 'local', ...options };
  }

  /** Build a concrete adapter from a values map (settings-derived). */
  private async buildAdapterFromValues(values: Record<string, any>): Promise<IStorageService> {
    const adapter = String(values.adapter ?? 'local');
    if (adapter === 's3') {
      const bucket = values.s3_bucket as string | undefined;
      const region = values.s3_region as string | undefined;
      if (!bucket || !region) {
        throw new Error('StorageServicePlugin: S3 adapter requires s3_bucket and s3_region');
      }
      const opts: S3StorageAdapterOptions = {
        bucket,
        region,
        endpoint: (values.s3_endpoint as string | undefined) || undefined,
        accessKeyId: (values.s3_access_key_id as string | undefined) || undefined,
        secretAccessKey: (values.s3_secret_access_key as string | undefined) || undefined,
        forcePathStyle: !!values.s3_force_path_style,
        metrics: this.metrics,
      };
      return new S3StorageAdapter(opts);
    }
    const rootDir = (values.local_root as string | undefined) || './storage';
    return new LocalStorageAdapter({
      basePath: this.options.basePath ?? '/api/v1/storage',
      ...(this.options.local ?? {}),
      // settings value wins over any constructor-provided local.rootDir
      rootDir,
      metrics: this.metrics,
    } as LocalStorageAdapterOptions);
  }

  async init(ctx: PluginContext): Promise<void> {
    this.metrics = resolveMetrics(ctx, this.options.metrics);
    const adapter = this.options.adapter;
    let initial: IStorageService;
    if (adapter === 's3') {
      // Dynamically import the S3 adapter (to avoid top-level import of optional peer dep)
      const { S3StorageAdapter: S3Ctor } = await import('./s3-storage-adapter.js');
      const s3Opts = this.options.s3;
      if (!s3Opts) {
        throw new Error('StorageServicePlugin: s3 options are required when adapter is "s3"');
      }
      initial = new S3Ctor({ ...s3Opts, metrics: this.metrics });
    } else {
      const rootDir = this.options.local?.rootDir ?? './storage';
      const basePath = this.options.basePath ?? '/api/v1/storage';
      initial = new LocalStorageAdapter({ rootDir, basePath, ...this.options.local, metrics: this.metrics });
    }

    this.storage = new SwappableStorageService(initial, (prev, next) => {
      const prevName = (prev as any)?.constructor?.name ?? 'unknown';
      const nextName = (next as any)?.constructor?.name ?? 'unknown';
      ctx.logger.warn(
        `StorageServicePlugin: storage adapter swapped (${prevName} → ${nextName}). ` +
        'Existing files were NOT migrated and may be unreachable through the new adapter.',
      );
    });

    ctx.registerService('file-storage', this.storage);
    ctx.logger.info(
      `StorageServicePlugin: registered ${adapter} storage adapter (swappable, metrics=${this.metrics.constructor?.name ?? 'unknown'})`,
    );

    // Register system objects via manifest service (if available)
    try {
      ctx.getService<{ register(m: any): void }>('manifest').register({
        id: 'com.objectstack.service.storage',
        name: 'Storage Service',
        version: '1.0.0',
        type: 'plugin',
        scope: 'system',
        objects: [SystemFile, SystemUploadSession, SysAttachment],
      });
    } catch {
      // manifest service may not be available in all environments
    }
  }

  async start(ctx: PluginContext): Promise<void> {
    ctx.hook('kernel:ready', async () => {
      let engine: IDataEngine | null = null;
      try {
        engine = ctx.getService<IDataEngine>('objectql');
      } catch {
        // data engine not wired — routes fall back to the in-memory store,
        // attachment lifecycle is inert (nothing persists sys_attachment).
      }

      // ── sys_file orphan lifecycle (#2755) ─────────────────────────
      // Tombstone hooks on sys_attachment + the reap guard that reclaims
      // storage bytes (and re-verifies references) inside the platform
      // lifecycle sweep. Both degrade silently on bare kernels.
      if (engine && typeof (engine as any).registerHook === 'function') {
        installAttachmentLifecycleHooks(engine as any, ctx.logger);
        try {
          const lifecycle = ctx.getService<any>('lifecycle');
          if (lifecycle && typeof lifecycle.registerReapGuard === 'function') {
            lifecycle.registerReapGuard(
              'sys_file',
              createSysFileReapGuard(engine as any, () => this.storage, ctx.logger),
            );
            ctx.logger.info('StorageServicePlugin: sys_file reap guard registered with the lifecycle service');
          }
        } catch {
          // lifecycle service absent (bare kernel) — the sys_file lifecycle
          // declaration stays safe: rows only gain reap triggers via the
          // hooks above, and nothing sweeps without the LifecycleService.
        }
      }

      // ── HTTP routes (existing behaviour) ───────────────────────────
      if (this.options.registerRoutes !== false) {
        let httpServer: IHttpServer | null = null;
        try {
          httpServer = ctx.getService<IHttpServer>('http-server');
        } catch {
          // not available
        }

        if (httpServer && this.storage) {
          this.store = new StorageMetadataStore(engine);

          registerStorageRoutes(httpServer, this.storage, this.store, {
            basePath: this.options.basePath ?? '/api/v1/storage',
            presignedTtl: this.options.presignedTtl,
            sessionTtl: this.options.sessionTtl,
          });

          ctx.logger.info(
            'StorageServicePlugin: REST routes registered at ' +
              (this.options.basePath ?? '/api/v1/storage'),
          );
        } else if (!httpServer) {
          ctx.logger.warn(
            'StorageServicePlugin: no HTTP server available — REST routes not registered. ' +
              'File storage is still accessible programmatically via kernel.getService("file-storage").',
          );
        }
      }

      // ── Bind to the `storage` settings namespace ──────────────────
      // Allows the admin UI to swap adapters / credentials without
      // restart. Env-locked fields still win at the resolver layer.
      if (this.options.bindToSettings === false) return;
      try {
        const settings = ctx.getService<any>('settings');
        if (!settings || typeof settings.createClient !== 'function') return;

        const applySettings = async () => {
          if (!this.storage) return;
          try {
            const payload = await settings.getNamespace('storage');
            const values: Record<string, any> = {};
            for (const [k, v] of Object.entries(payload.values as Record<string, any>)) {
              values[k] = v?.value;
            }
            // No persisted values yet → keep the constructor-built adapter.
            const hasAny = Object.values(values).some((v) => v !== undefined && v !== null && v !== '');
            if (!hasAny) return;
            const next = await this.buildAdapterFromValues(values);
            this.storage.swap(next);
          } catch (err: any) {
            ctx.logger.warn(
              'StorageServicePlugin: failed to apply storage settings: ' + (err?.message ?? err),
            );
          }
        };
        await applySettings();
        if (typeof settings.subscribe === 'function') {
          settings.subscribe('storage', () => {
            void applySettings();
          });
          ctx.logger.info('StorageServicePlugin: bound to settings:changed for namespace=storage');
        }

        // Register the live `storage/test` probe handler.
        if (typeof settings.registerAction === 'function' && this.storage) {
          const proxy = this.storage;
          settings.registerAction('storage', 'test', async ({ values, payload }: any) => {
            // Merge the (possibly unsaved) form state posted as
            // `payload.values` over the persisted snapshot so an operator
            // can validate edits before hitting "Save". Matches the
            // pattern used by ai/test and mail/test.
            const overrides = extractOverrides(payload);
            const merged: Record<string, unknown> = { ...(values ?? {}), ...overrides };
            const probeKey = `__objectstack_probe__/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            const probeBytes = Buffer.from(`probe@${new Date().toISOString()}`, 'utf-8');
            try {
              // If merged values are present, build a temporary adapter
              // so we can validate user-typed credentials without
              // committing them.
              let target: IStorageService = proxy;
              if (merged && Object.keys(merged).length > 0) {
                try {
                  target = await this.buildAdapterFromValues(merged);
                } catch (err: any) {
                  return { ok: false, severity: 'error', message: err?.message ?? String(err) };
                }
              }
              await target.upload(probeKey, probeBytes, { contentType: 'text/plain' });
              const got = await target.download(probeKey);
              if (!got || !Buffer.isBuffer(got) || got.toString('utf-8') !== probeBytes.toString('utf-8')) {
                return { ok: false, severity: 'error', message: 'Probe download did not match upload.' };
              }
              await target.delete(probeKey);
              const adapter = String(merged.adapter ?? this.options.adapter ?? 'local');
              return {
                ok: true,
                severity: 'info',
                message: `Storage round-trip succeeded (adapter=${adapter}).`,
              };
            } catch (err: any) {
              // Best-effort cleanup
              try { await (proxy as IStorageService).delete(probeKey); } catch { /* ignore */ }
              return { ok: false, severity: 'error', message: err?.message ?? String(err) };
            }
          });
          ctx.logger.info('StorageServicePlugin: registered settings action storage/test');
        }
      } catch {
        // settings service not present — manifest fallback handler stays
      }
    });
  }
}

/**
 * Look up the host's MetricsRegistry from the service registry, with
 * the canonical fallback chain (explicit override → registered service
 * → noop). Local helper to avoid making `service-storage` depend on
 * `@objectstack/runtime`.
 */
function resolveMetrics(
  ctx: PluginContext,
  override: MetricsRegistry | undefined,
): MetricsRegistry {
  if (override) return override;
  try {
    const m = ctx.getService<MetricsRegistry | undefined>(OBSERVABILITY_METRICS_SERVICE);
    if (m) return m;
  } catch {
    // Service not registered — silent fall-through.
  }
  return new NoopMetricsRegistry();
}

function extractOverrides(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  if (p.values && typeof p.values === 'object' && p.values !== null) {
    return p.values as Record<string, unknown>;
  }
  return p;
}

