// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { resolveAuthzContext } from '@objectstack/core';
import type {
  IHttpServer,
  IDataEngine,
  IStorageService,
  IFileAccessDelegate,
} from '@objectstack/spec/contracts';
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
import type { FileRecord } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';
import type { FileReadVerdict } from './storage-routes.js';
import { installAttachmentLifecycleHooks, createSysFileReapGuard, createUploadSessionReapGuard } from './attachment-lifecycle.js';
import { installFileReferenceHooks } from './file-reference-lifecycle.js';
import { installAttachmentAccessHooks, installAttachmentReadVisibility } from './attachment-access-hooks.js';
import { SystemFile, SystemUploadSession } from './objects/index.js';
// ADR-0052 §3 ownership: `sys_attachment` (a file↔record link) belongs with the
// storage domain, not the audit/compliance ledger. Definition stays in
// platform-objects; storage now contributes (registers) it instead of audit.
import { SysAttachment } from '@objectstack/platform-objects/audit';
// Deployment-level data-migration flag READER (#3617). The `sys_migration`
// ledger itself is platform infrastructure — registered by
// `PlatformObjectsPlugin` (#4243), not by this service — this service only
// consumes the ADR-0104 file-as-reference flag, which gates its released-file
// collection (#3459 PR-5b).
import { mayActIrreversibly } from '@objectstack/platform-objects/system';
import { FILE_REFERENCES_MIGRATION_ID } from '@objectstack/spec/system';
import { SwappableStorageService } from './swappable-storage-service.js';
import {
  resolveStorageTarget,
  needsStorageSwap,
  movesStorageLocation,
  type StorageTarget,
} from './storage-target.js';

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
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['file-storage'];
  /**
   * init() registers sys_file / sys_upload_session / sys_attachment through
   * the `manifest` service ObjectQLPlugin provides — order-if-present so the
   * registration is deterministic (ADR-0116, #4471). Soft, not hard: without
   * an engine the plugin degrades on purpose (storage service still up).
   */
  optionalDependencies = ['com.objectstack.engine.objectql'];
  version = '1.0.0';
  type = 'standard';

  private readonly options: StorageServicePluginOptions;
  private storage: SwappableStorageService | null = null;
  private store: StorageMetadataStore | null = null;
  private metrics: MetricsRegistry = new NoopMetricsRegistry();
  /**
   * What the CURRENTLY installed adapter points at (#4096). Set beside every
   * adapter this plugin builds, so a settings re-read can tell "nothing
   * changed" and "the store moved" apart instead of warning on both.
   */
  private target?: StorageTarget;
  /**
   * Verdict for the swap in flight, set by the caller that resolved both
   * configurations. Absent means a caller we know nothing about, and the
   * migration warning must not be silenced by ignorance — see
   * {@link movesStorageLocation}.
   */
  private pendingSwapMovesStore?: boolean;

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
    // #4096 — record what this adapter points at, so a settings re-read can
    // recognise an identical configuration instead of swapping and warning.
    // `options.s3` carries only bucket/region/endpoint: constructor-configured
    // S3 leaves credentials to the AWS SDK's own resolution chain, so there are
    // none to fingerprint here.
    this.target = resolveStorageTarget({
      kind: adapter,
      rootDir: this.options.local?.rootDir,
      basePath: this.options.basePath,
      bucket: this.options.s3?.bucket,
      region: this.options.s3?.region,
      endpoint: this.options.s3?.endpoint,
    });

    this.storage = new SwappableStorageService(initial, (prev, next) => {
      const prevName = (prev as any)?.constructor?.name ?? 'unknown';
      const nextName = (next as any)?.constructor?.name ?? 'unknown';
      // #4096 — the hazard this warns about is a MOVED backing store, not the
      // act of swapping: a credential rotation replaces the adapter while every
      // existing object stays exactly where it was. `undefined` means a caller
      // that resolved no target, and an unknown swap still warns.
      if (this.pendingSwapMovesStore === false) {
        ctx.logger.info(
          `StorageServicePlugin: storage adapter replaced (${prevName} → ${nextName}) — `
          + 'same backing store, existing files unaffected.',
        );
        return;
      }
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

    // ADR-0029 D8 — contribute this service's object translations (sys_file /
    // sys_upload_session) to the i18n service on kernel:ready (the i18n plugin
    // may register after this one).
    if (typeof (ctx as any).hook === 'function') {
      (ctx as any).hook('kernel:ready', async () => {
        try {
          const i18n = ctx.getService<any>('i18n');
          if (i18n && typeof i18n.loadTranslations === 'function') {
            const { StorageTranslations } = await import('./translations/index.js');
            for (const [locale, data] of Object.entries(StorageTranslations)) {
              i18n.loadTranslations(locale, data as Record<string, unknown>);
            }
          }
        } catch { /* i18n optional */ }
      });
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
        // Parent-derived access on the join rows (#2755, ADR-0049) — the
        // sharing service resolves lazily so plugin order doesn't matter.
        installAttachmentAccessHooks(
          engine as any,
          () => {
            try {
              return ctx.getService<any>('sharing');
            } catch {
              return null;
            }
          },
          ctx.logger,
        );
        // Parent-derived READ visibility (#2970 item 1) — list/find/count of
        // sys_attachment only returns rows whose parent record the caller can
        // read. Middleware (not a hook) so list `total` is filtered too.
        if (typeof (engine as any).registerMiddleware === 'function') {
          installAttachmentReadVisibility(engine as any, ctx.logger);
        }
        // Field-reference ownership (ADR-0104 D3 wave 2) — keeps
        // sys_file.ref_object/ref_id/ref_field in step with what records hold,
        // and copies bytes rather than sharing a row when a second field slot
        // writes an already-owned id. On a deployment whose file-as-reference
        // migration is verified (#3617), releasing ownership also tombstones
        // the file into the declared grace window (#3459 PR-5b); the reap
        // guard below re-verifies the ownership columns — and re-reads the
        // deployment flag, fresh — before any byte is deleted.
        installFileReferenceHooks(engine as any, () => this.storage, ctx.logger);
        try {
          const lifecycle = ctx.getService<any>('lifecycle');
          if (lifecycle && typeof lifecycle.registerReapGuard === 'function') {
            lifecycle.registerReapGuard(
              'sys_file',
              createSysFileReapGuard(engine as any, () => this.storage, ctx.logger, () =>
                // Fresh read each sweep — deliberately NOT the engine's
                // memoized one: this sits at the moment of irreversibility,
                // so a regressed gate must close without a restart.
                //
                // [#4797] And the STRONGER of the two predicates, because what
                // a `true` here authorises is a byte delete.
                // `isDataMigrationVerified` answers "was this deployment
                // certified" — the right question for the recoverable
                // consumers (strict enforcement, tombstoning), and the wrong
                // one here: an `OS_ALLOW_LAX_*` escape hatch can admit a value
                // the certificate forbids without disturbing `verified_at`, and
                // this gate would go on deleting released field files on a
                // certificate the deployment's own data has contradicted.
                mayActIrreversibly(engine as any, FILE_REFERENCES_MIGRATION_ID),
              ),
            );
            // Abort the backend multipart upload before an abandoned/terminal
            // sys_upload_session row is reaped, so its parts don't leak (#2970).
            lifecycle.registerReapGuard(
              'sys_upload_session',
              createUploadSessionReapGuard(() => this.storage, ctx.logger),
            );
            ctx.logger.info('StorageServicePlugin: sys_file + sys_upload_session reap guards registered with the lifecycle service');
          }
        } catch {
          // lifecycle service absent (bare kernel) — the sys_file lifecycle
          // declaration stays safe: rows only gain reap triggers via the
          // hooks above, and nothing sweeps without the LifecycleService.
        }

        // Fresh-datastore attestation (#3438, ADR-0104) moved to
        // `PlatformObjectsPlugin` with the `sys_migration` registration it
        // belongs to (#4243) — the ledger and its bookkeeping are platform
        // infrastructure, present with or without this service.
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
            resolveSession: buildAuthSessionResolver(ctx),
            authorizeFileRead: buildFileReadAuthorizer(ctx, engine),
            logger: ctx.logger,
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

            // #4096 — `hasAny` is true on every boot once the settings service
            // has persisted its own defaults, so this used to rebuild and swap
            // unconditionally, warning about stranded files on a swap from an
            // adapter to an identically-configured one. Compare the resolved
            // CONFIGURATIONS instead: skip entirely when nothing changed, and
            // only call it a migration hazard when the backing store moved.
            const nextTarget = resolveStorageTarget({
              kind: values.adapter,
              rootDir: values.local_root,
              basePath: this.options.basePath,
              bucket: values.s3_bucket,
              region: values.s3_region,
              endpoint: values.s3_endpoint,
              forcePathStyle: !!values.s3_force_path_style,
              accessKeyId: values.s3_access_key_id,
              secretAccessKey: values.s3_secret_access_key,
            });
            if (!needsStorageSwap(this.target, nextTarget)) return;

            const next = await this.buildAdapterFromValues(values);
            this.pendingSwapMovesStore = movesStorageLocation(this.target, nextTarget);
            try {
              this.storage.swap(next);
            } finally {
              // Only the swap this block resolved may claim the verdict; a
              // later `swap()` from anywhere else must fall back to warning.
              this.pendingSwapMovesStore = undefined;
            }
            this.target = nextTarget;
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

/** Normalize adapter request headers to a Web `Headers` (better-auth needs it). */
function toWebHeaders(req: { headers?: unknown }): any | null {
  const rawHeaders: any = req?.headers;
  if (rawHeaders && typeof rawHeaders.get === 'function') return rawHeaders;
  if (rawHeaders && typeof rawHeaders === 'object') {
    const headers = new (globalThis as any).Headers();
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, String(x)));
      else if (v != null) headers.set(k, String(v));
    }
    return headers;
  }
  return null;
}

/** A `getSession(headers)` bound to the kernel's `auth` service, or null. */
function buildGetSession(ctx: PluginContext): ((headers: any) => Promise<any>) | null {
  let authService: any;
  try {
    authService = ctx.getService<any>('auth');
  } catch {
    return null;
  }
  if (!authService) return null;
  return async (headers: any) => {
    let api: any = authService.api;
    if (!api && typeof authService.getApi === 'function') api = await authService.getApi();
    if (!api?.getSession) return undefined;
    return api.getSession({ headers });
  };
}

/**
 * Bridge the kernel's `auth` service (better-auth) into the storage routes'
 * upload gate (#2755). Returns `undefined` when no auth service is present —
 * the routes then stay open (bare kernels/tests, logged once there).
 */
function buildAuthSessionResolver(
  ctx: PluginContext,
): ((req: { headers?: unknown }) => Promise<{ userId?: string } | null>) | undefined {
  const getSession = buildGetSession(ctx);
  if (!getSession) return undefined;
  return async (req) => {
    try {
      const headers = toWebHeaders(req);
      if (!headers) return null;
      const session: any = await getSession(headers);
      const userId = session?.user?.id;
      return userId ? { userId: String(userId) } : null;
    } catch {
      return null;
    }
  };
}

/**
 * Authorize a parent-governed download (#2970 item 2; extended for field-owned
 * files by ADR-0104 D3 wave 2). Builds the FULL caller ExecutionContext via
 * `resolveAuthzContext` (the same shared resolver rest-server uses — a bare
 * `{ userId }` would lack the resolved permissions the parent RLS needs), then
 * allows when the caller is the file's owner or can READ the file's parent
 * record. Returns `undefined` (routes stay open) when the auth service or
 * engine is absent.
 *
 * "Parent" resolves differently for the two surfaces, and that asymmetry is the
 * point of the ownership model: an attachment may hang off MANY records, so its
 * readable-by set is the union over its join rows; a field-owned file belongs
 * to exactly ONE record, so its readable-by set is that record's and nothing
 * more. A shared model would have had to union field references too, silently
 * widening access whenever one file id was copied into a more public record.
 */
function buildFileReadAuthorizer(
  ctx: PluginContext,
  engine: IDataEngine | null,
): ((file: FileRecord, req: { headers?: unknown }) => Promise<FileReadVerdict>) | undefined {
  const getSession = buildGetSession(ctx);
  if (!getSession || !engine || typeof (engine as any).find !== 'function') return undefined;

  return async (file, req) => {
    try {
      const headers = toWebHeaders(req);
      if (!headers) return 'unauthenticated';
      const authz = await resolveAuthzContext({ ql: engine, headers, getSession });
      if (!authz.userId) return 'unauthenticated';

      // Uploader / owner may always download.
      if (file.owner_id && String(file.owner_id) === String(authz.userId)) return 'allow';

      // Field-owned (ADR-0104 D3 wave 2): exactly ONE record's field holds
      // this file, so access is that record's READ access — never a union.
      if (file.ref_object && file.ref_id != null && file.ref_id !== '') {
        const ownerObject = String(file.ref_object);
        const ownerId = String(file.ref_id);

        // An object whose access is MEDIATED BY A SERVICE rather than by row
        // permissions names that service in `fileAccessDelegate`. Asking the
        // row directly would be asking the wrong authority: `sys_approval_action`
        // is deliberately unreadable to ordinary approver positions, so a raw
        // read denies the very approver the attachment is for. Fails closed —
        // a declared delegate that is missing or incomplete denies rather than
        // silently reverting to the raw read it was declared to replace.
        const delegateName = (engine as any).getObject?.(ownerObject)?.fileAccessDelegate;
        if (typeof delegateName === 'string' && delegateName) {
          try {
            const delegate = ctx.getService<IFileAccessDelegate>(delegateName);
            if (!delegate || typeof delegate.authorizeFileRead !== 'function') return 'deny';
            return (await delegate.authorizeFileRead(ownerId, authz)) ? 'allow' : 'deny';
          } catch {
            return 'deny';
          }
        }

        try {
          const visible = (await (engine as any).find(ownerObject, {
            where: { id: file.ref_id },
            fields: ['id'],
            limit: 1,
            context: authz,
          })) as Array<Record<string, unknown>>;
          return visible?.length ? 'allow' : 'deny';
        } catch {
          return 'deny'; // unknown/failing owner object — fail closed
        }
      }

      // Otherwise: readable via any parent record this file is attached to.
      const links = (await (engine as any).find('sys_attachment', {
        where: { file_id: file.id },
        fields: ['parent_object', 'parent_id'],
        limit: 500,
        context: { isSystem: true },
      })) as Array<Record<string, unknown>>;

      const byObject = new Map<string, Set<string>>();
      for (const link of links) {
        const po = link.parent_object;
        const pid = link.parent_id;
        if (typeof po !== 'string' || !po || po === 'sys_attachment') continue;
        if (pid === undefined || pid === null || pid === '') continue;
        let ids = byObject.get(po);
        if (!ids) byObject.set(po, (ids = new Set()));
        ids.add(String(pid));
      }
      for (const [parentObject, idSet] of byObject) {
        const ids = [...idSet];
        try {
          const visible = (await (engine as any).find(parentObject, {
            where: { id: { $in: ids } },
            fields: ['id'],
            limit: ids.length,
            context: authz,
          })) as Array<Record<string, unknown>>;
          if (visible.length) return 'allow';
        } catch {
          // unknown/failing parent object — try the next
        }
      }
      return 'deny';
    } catch {
      return 'deny'; // fail closed
    }
  };
}

function extractOverrides(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  if (p.values && typeof p.values === 'object' && p.values !== null) {
    return p.values as Record<string, unknown>;
  }
  return p;
}

