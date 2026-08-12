// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectQL } from './engine.js';
import { assembleMetadataProtocol } from '@objectstack/metadata-protocol';
import type { MetadataAuthoringChannel } from '@objectstack/metadata-protocol';
import { Plugin, PluginContext } from '@objectstack/core';
import { applyConversionsToStoredItem } from '@objectstack/spec';
import { StorageNameMapping } from '@objectstack/spec/system';
import { LifecycleService } from './lifecycle/lifecycle-service.js';
import { lifecycleSettingsManifest } from './lifecycle/lifecycle-settings.js';
import type { DanglingReferenceAuditOptions } from './integrity/dangling-reference-audit.js';
import { runActionGovernanceInventory } from './action-governance.js';
import type { IMetadataService } from '@objectstack/spec/contracts';

export type { Plugin, PluginContext };

/**
 * Protocol extension for DB-based metadata hydration.
 * `loadMetaFromDb` is implemented by ObjectStackProtocolImplementation but
 * is NOT (yet) part of the canonical ObjectStackProtocol wire-contract in
 * `@objectstack/spec`, since it is a server-side bootstrap concern only.
 */
interface ProtocolWithDbRestore {
  loadMetaFromDb(): Promise<{
    loaded: number;
    errors: number;
    invalid?: number;
    /**
     * [#5897, ADR-0110 D3] True when the `sys_metadata` read itself failed for
     * a reason that is NOT "the table has not been provisioned yet" — i.e. the
     * row set never arrived, so `loaded: 0` is an outage rather than an empty
     * store. `restoreMetadataFromDb` branches on it to tell the two apart.
     *
     * Optional, like `invalid` above and for the same reason: this interface is
     * structural, matched by {@link hasLoadMetaFromDb} against whatever object
     * happens to be registered as `protocol`. A shim that predates the field
     * keeps type-checking and is simply read as "not an outage" — the same
     * verdict it could express before.
     */
    storeUnavailable?: boolean;
  }>;
}

/** Type guard — checks whether the service exposes `loadMetaFromDb`. */
function hasLoadMetaFromDb(service: unknown): service is ProtocolWithDbRestore {
  return (
    typeof service === 'object' &&
    service !== null &&
    typeof (service as Record<string, unknown>)['loadMetaFromDb'] === 'function'
  );
}

/**
 * Options for ObjectQLPlugin.
 *
 * `environmentId` scopes all metadata writes + reads to a specific project.
 * When set, `protocol.saveMetaItem` stamps `environment_id = <environmentId>` on
 * new sys_metadata rows, and `protocol.loadMetaFromDb` filters by the same
 * column. Leave undefined in single-kernel / self-hosted mode — rows land
 * in the platform-global scope (environment_id IS NULL).
 */
export interface ObjectQLPluginOptions {
  /** Optional pre-built engine. When absent, one is lazily created in init. */
  ql?: ObjectQL;
  /** Passed to `new ObjectQL(...)` when `ql` is not supplied. */
  hostContext?: Record<string, any>;
  /** Scope sys_metadata reads/writes to this project. */
  environmentId?: string;
  /**
   * [#6710] Which authoring channel this kernel's metadata writes arrive on —
   * the explicit expression of ADR-0005's "package author's own bootstrap
   * channel".
   *
   * **Leave unset on every kernel that serves `PUT /api/v1/meta/*` to end
   * users.** The default `'environment'` runs the #4463 runtime authoring
   * rules (the 26 shared `AUTHORING_RULES` that `os validate` / `os lint`
   * run), which for a Studio tenant or an MCP/AI author is the ONLY
   * author-time gate — there is no `os lint` for a `sys_metadata` overlay row.
   *
   * Set `'package-author'` ONLY on the genuine control-plane assembly. Before
   * #6710 this was inferred from `environmentId === undefined`, which is a row
   * -scoping key and not a topology signal: the CLI's host-config assembler
   * leaves it undefined too, so the flagship showcase's own boot shape ran the
   * gate on nothing. Omitting this option now means MORE enforcement, never
   * less — which is the whole point of declaring it rather than deducing it.
   */
  authoringChannel?: MetadataAuthoringChannel;
  /**
   * Override the kernel's default plugin-start timeout for this plugin.
   * Defaults to 120000 (120s). Schema sync to a remote SQL backend
   * (Neon/Postgres/Turso) is latency-bound — the SQL driver currently
   * does NOT support `batchSchemaSync`, so it issues one round-trip per
   * registered object × twice (Phase 1 + Phase 3 in `start()`). On a
   * cold remote DB with N tables this can blow past the kernel's
   * default 30s easily, even though everything is healthy.
   */
  startupTimeout?: number;
  /**
   * Skip both `syncRegisteredSchemas()` calls inside `start()` and
   * assume DDL is managed out-of-band (e.g. an `apps/cloud/scripts/migrate.ts`
   * run before deploy that connects directly to the database and creates
   * all `sys_*` + custom tables once).
   *
   * Use this on cold-start-sensitive runtimes (Cloudflare Containers,
   * Lambda) where the platform's inbound-request budget is shorter than
   * a fresh remote-DB schema sync. The plugin still hydrates the
   * SchemaRegistry from `sys_metadata` (Phase 2), so custom user
   * objects come up — they just aren't re-DDL'd on every cold boot.
   *
   * Falls back to `process.env.OS_SKIP_SCHEMA_SYNC === '1'` when the
   * option is unset, so containers can flip it via their env without a
   * code change.
   */
  skipSchemaSync?: boolean;
  /**
   * Hydrate the SchemaRegistry from this kernel's local `sys_metadata`
   * even when `environmentId` is set.
   *
   * By default Phase-2 hydration in `start()` is gated on
   * `environmentId === undefined`, because the original multi-environment
   * model assumed project kernels source metadata from a remote artifact /
   * control-plane proxy and have NO local `sys_metadata` to read. That is
   * NOT true for an isolated, proxy-free project kernel that persists its
   * OWN `sys_metadata` locally (e.g. the cloud single-env tenant runtime on
   * Turso): objects CREATED AT RUNTIME there — not present in the boot
   * artifact manifest — would otherwise never re-enter the registry after a
   * restart, so `registry.getObject(name)` returns nothing for them and any
   * registry consumer (the unknown-`$select` guard, hooks, relationships)
   * silently degrades.
   *
   * Set this ONLY when the kernel's registry is per-instance isolated AND
   * `sys_metadata` lives on the kernel's own local driver (no control-plane
   * proxy) — hydrating a proxied kernel would read the wrong database.
   * Safe to leave unset: hydration tolerates a missing table.
   */
  hydrateMetadataFromDb?: boolean;
  /**
   * ADR-0076 Step 2 (#2462): when `false`, this plugin SKIPS its built-in
   * protocol assembly (the `protocol` service, the metadata-storage platform
   * objects, and the lightweight `analytics` fallback) — mount
   * `createMetadataProtocolPlugin()` from `@objectstack/metadata-protocol`
   * alongside to own them instead. Protocol CONSUMERS stay here either way
   * (DB hydration + authored hook/action rebind resolve `protocol` lazily).
   * Defaults to `true` (built-in assembly, fully backward compatible).
   */
  registerProtocol?: boolean;
  /**
   * ADR-0057 LifecycleService tuning. Lifecycle enforcement is a platform
   * primitive and defaults ON — objects without a `lifecycle` declaration are
   * never touched, so a kernel with no declarations sees zero deletes. Set
   * `enabled: false` (or env `OS_LIFECYCLE_DISABLED=1`) to disable the
   * periodic sweep entirely; the `lifecycle` service stays registered so
   * tooling can still run `sweep()` explicitly.
   *
   * `referenceAudit` tunes the #4551 read-only dangling-reference audit that
   * rides this same clock. It writes nothing; `enabled: false` drops the leg.
   */
  lifecycle?: {
    enabled?: boolean;
    sweepIntervalMs?: number;
    initialDelayMs?: number;
    referenceAudit?: Omit<DanglingReferenceAuditOptions, 'signal'> & { enabled?: boolean };
  };
}

export class ObjectQLPlugin implements Plugin {
  name = 'com.objectstack.engine.objectql';
  type = 'objectql';
  version = '1.0.0';
  /**
   * Services init() UNCONDITIONALLY registers (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one of them before it
   * initializes. `protocol`/`objects`/`analytics` are deliberately absent:
   * they are option-gated (`registerProtocol`) and may be owned by
   * MetadataProtocolPlugin instead.
   */
  providesServices = ['objectql', 'data', 'manifest', 'lifecycle'];
  /**
   * Schema sync to remote SQL DBs is latency-bound (one round-trip per
   * table × 2 phases). Default to 120s instead of the kernel's 30s so
   * cold Neon/Turso starts don't get killed mid-sync.
   */
  startupTimeout = 120_000;

  private ql: ObjectQL | undefined;
  private hostContext?: Record<string, any>;
  private environmentId?: string;
  /**
   * [#6710] Declared authoring channel, forwarded to the ONE protocol
   * assembly. `undefined` here is not "unknown" — `assembleMetadataProtocol`
   * resolves it to `'environment'`, the gated channel.
   */
  private authoringChannel?: MetadataAuthoringChannel;
  private skipSchemaSync = false;
  /** Serializes reload-time schema syncs so overlapping reloads can't race DDL. */
  private reloadSchemaSync: Promise<void> = Promise.resolve();
  private hydrateMetadataFromDb = false;
  private registerProtocol = true;
  /**
   * Armed at the end of `start()` (AFTER the one-shot
   * {@link bridgeObjectsToMetadataService}, where that runs). From that
   * point on, every manifest registered through the `manifest` service
   * bridges its own objects into the metadata service incrementally — the
   * one-shot bridge never runs again, so late registrations (marketplace
   * install / rehydrate on `kernel:ready`) would otherwise stay invisible
   * to every IMetadataService consumer. Armed on ALL kernels, including
   * project-scoped ones (`environmentId` set — `os dev` boots as
   * 'env_local'): unlike the one-shot registry-wide bridge, a per-manifest
   * bridge cannot leak sibling-project objects, and gating it would turn
   * the fix off in marketplace install-local's primary home.
   */
  private bridgeLateManifests = false;
  /** Unsubscribe handles for metadata-event subscriptions (ADR-0008 PR-7). */
  private metadataUnsubscribes: Array<() => void> = [];
  /** ADR-0057 lifecycle enforcement (Reaper/Rotator/Archiver). */
  private lifecycleService: LifecycleService | undefined;
  private lifecycleOptions: ObjectQLPluginOptions['lifecycle'];

  constructor(qlOrOptions?: ObjectQL | ObjectQLPluginOptions, hostContext?: Record<string, any>) {
    // Back-compat: legacy callers passed `(ObjectQL, hostContext)` positionally.
    if (qlOrOptions instanceof ObjectQL) {
      this.ql = qlOrOptions;
      this.hostContext = hostContext;
      return;
    }
    // New signature: options bag.
    const opts = (qlOrOptions as ObjectQLPluginOptions | undefined) ?? {};
    if (opts.ql) {
      this.ql = opts.ql;
    }
    this.hostContext = opts.hostContext ?? hostContext;
    this.environmentId = opts.environmentId;
    this.authoringChannel = opts.authoringChannel;
    if (typeof opts.startupTimeout === 'number' && opts.startupTimeout > 0) {
      this.startupTimeout = opts.startupTimeout;
    }
    this.skipSchemaSync =
      typeof opts.skipSchemaSync === 'boolean'
        ? opts.skipSchemaSync
        : process.env.OS_SKIP_SCHEMA_SYNC === '1';
    this.hydrateMetadataFromDb = opts.hydrateMetadataFromDb === true;
    this.registerProtocol = opts.registerProtocol !== false;
    this.lifecycleOptions = opts.lifecycle;
  }

  /**
   * Arm the authored hook/action rebind on protocol metadata mutations
   * (#2588, #2605). Shared by both assembly modes: called with the in-house
   * shim when `registerProtocol` is on, and lazily from `start()` against
   * whatever registered `protocol` (MetadataProtocolPlugin) otherwise.
   */
  private subscribeMetadataRebind(ctx: PluginContext, protocol: unknown): void {
    if (typeof (protocol as any)?.onMetadataMutation !== 'function') return;
    const unsubscribe = (protocol as any).onMetadataMutation(
      (evt: { type: string; name: string; state: string }) => {
        if (evt?.state === 'draft') return;
        if (evt?.type === 'hook') {
          void this.resyncAuthoredHooks(ctx).catch((e: any) => {
            ctx.logger.warn('[ObjectQLPlugin] authored-hook rebind after mutation failed', {
              hook: evt.name,
              error: e?.message,
            });
          });
        } else if (evt?.type === 'action' || evt?.type === 'object') {
          // `object` rows carry embedded `actions[]`, so an object edit can
          // add/remove an authored action too — re-sync on both.
          void this.resyncAuthoredActions(ctx).catch((e: any) => {
            ctx.logger.warn('[ObjectQLPlugin] authored-action rebind after mutation failed', {
              item: evt.name,
              error: e?.message,
            });
          });
        }
      },
    );
    this.metadataUnsubscribes.push(unsubscribe);
  }

  init = async (ctx: PluginContext) => {
    if (!this.ql) {
        // Pass kernel logger to engine to avoid creating a separate logger instance
        const hostCtx = { ...this.hostContext, logger: ctx.logger };
        this.ql = new ObjectQL(hostCtx);
    }
    
    // Register as provider for Core Kernel Services
    ctx.registerService('objectql', this.ql);

    ctx.registerService('data', this.ql); // ObjectQL implements IDataEngine

    // Register manifest service for direct app/package registration.
    // Plugins call ctx.getService('manifest').register(manifestData)
    // instead of the legacy ctx.registerService('app.<id>', manifestData) convention.
    const ql = this.ql;
    ctx.registerService('manifest', {
      register: (manifest: any) => {
        ql.registerApp(manifest);
        ctx.logger.debug('Manifest registered via manifest service', {
          id: manifest.id || manifest.name
        });
        // Manifests registered AFTER start() (marketplace install / ledger
        // rehydrate arrive on `kernel:ready` or an HTTP request) land in the
        // SchemaRegistry only — the one-shot startup bridge already ran — so
        // bridge this manifest's objects into the metadata service now.
        // No-op until start() arms it, so boot-time registrations keep the
        // single startup bridge. The promise never rejects; async callers
        // (marketplace install) await it so metadata reads right after
        // install are deterministic, sync callers may ignore it.
        return this.bridgeManifestObjectsToMetadataService(ctx, manifest);
      }
    });

    ctx.logger.info('ObjectQL engine registered', {
        services: ['objectql', 'data', 'manifest'],
    });

    if (this.registerProtocol) {
      // ADR-0076 Step 2 PR-C: the ONE assembly lives in
      // @objectstack/metadata-protocol — this built-in mode is the
      // single-kernel convenience mount of the same code path the
      // MetadataProtocolPlugin uses (identical objects/protocol/analytics).
      // [#6710] `authoringChannel` rides the same seam as `environmentId`, and
      // an undefined one resolves to `'environment'` (gated) inside the
      // assembly — including on the legacy positional `(ObjectQL, hostContext)`
      // constructor path, which returns before any option is read.
      const protocolShim = assembleMetadataProtocol(ctx, this.ql, this.environmentId, {
        authoringChannel: this.authoringChannel,
      });
      this.subscribeMetadataRebind(ctx, protocolShim);
    } else {
      ctx.logger.info('registerProtocol=false — protocol assembly delegated to MetadataProtocolPlugin (ADR-0076 Step 2, #2462)');
    }

    // ADR-0057: the platform-owned LifecycleService. Registered from the
    // engine plugin (not an opt-in capability) so every kernel that has data
    // also has lifecycle enforcement — a declared retention that drives no
    // sweeper is dead surface (ADR-0049).
    this.lifecycleService = new LifecycleService({
      getEngine: () => this.ql,
      logger: ctx.logger,
      // P4 governance: overrides/quotas resolve from the 'lifecycle'
      // settings namespace when a SettingsService is present. Lazy per
      // sweep — plugin registration order doesn't matter.
      getSettings: () => {
        try {
          return ctx.getService('settings') as never;
        } catch {
          return undefined;
        }
      },
      ...this.lifecycleOptions,
    });
    ctx.registerService('lifecycle', this.lifecycleService);
  }

  start = async (ctx: PluginContext) => {
    ctx.logger.info('ObjectQL engine starting...');

    // Delegated-assembly mode (ADR-0076 Step 2): the protocol was registered
    // by MetadataProtocolPlugin during init — arm the authored hook/action
    // rebind against it now that all inits ran. Graceful when absent.
    if (!this.registerProtocol) {
      try {
        this.subscribeMetadataRebind(ctx, ctx.getService('protocol'));
      } catch { /* no protocol registered — rebind not armed */ }
    }

    // Sync from external metadata service (e.g. MetadataPlugin) if available
    try {
        const metadataService = ctx.getService<IMetadataService>('metadata');
        if (metadataService && typeof metadataService.loadMany === 'function' && this.ql) {
            await this.loadMetadataFromService(metadataService, ctx);
        }
        // ── ADR-0008 PR-7: subscribe to object metadata events so the
        //    SchemaRegistry cache is invalidated on edits (Studio HMR).
        //    The metadata service bubbles repo events through its own
        //    `subscribe(type, cb)` API (PR-6 bridge), so we don't talk
        //    to the repo directly here — this keeps ObjectQL decoupled
        //    from the storage backend.
        if (metadataService && typeof metadataService.subscribe === 'function' && this.ql) {
            this.subscribeToMetadataEvents(metadataService, ctx);
        }
    } catch (e: any) {
        ctx.logger.debug('No external metadata service to sync from');
    }

    // ── Runtime-authored hook bind (#2588) ───────────────────────────────
    // Hooks authored in the Studio live as `sys_metadata` rows, which the
    // metadata service's loadMany() above does NOT surface on env-scoped
    // kernels (no DatabaseLoader there) — so the boot bind never sees them
    // and their bodies never run, even after a restart. Re-bind from the
    // rows themselves:
    //   • at `kernel:ready` — cold-boot coverage, once every plugin has
    //     registered its packages (so the artifact filter can classify);
    //   • on `metadata:reloaded` — publish-while-running coverage (the
    //     runtime dispatcher announces after publishPackageDrafts, #2576),
    //     mirroring service-automation's flow re-sync.
    // Idempotent: the bind fully replaces the 'metadata-service' package
    // set, so edited hooks re-bind and deleted hooks tear down.
    ctx.hook('kernel:ready', async () => {
        // #7737 — FIRST, before anything that might read data: bind every
        // declared federated object to its remote table now that every
        // plugin's `start()` (including the declared-datasource auto-connect
        // in `AppPlugin.start()`) has run. See
        // {@link reconcileFederatedBindings}.
        await this.reconcileFederatedBindings(ctx);
        await this.resyncAuthoredHooks(ctx);
        await this.resyncAuthoredActions(ctx);
        // [ADR-0110 D5] Governance inventory — AFTER the authored-action
        // re-sync, so the registry it audits is final for this boot. It lived
        // in AppPlugin first, which is registered conditionally; on the `os
        // dev` path it never ran, so the checklist that justifies D3's hard
        // refusal was never printed where an upgrade most needs it. The
        // engine owns the map being audited; the engine plugin reports on it.
        await this.runGovernanceInventory(ctx);
        // ADR-0057 P4: surface the lifecycle governance namespace in Settings
        // (overrides / quotas / growth alerts) when a SettingsService exists.
        try {
            const settings = ctx.getService('settings') as { registerManifest?: (m: unknown) => void };
            settings?.registerManifest?.(lifecycleSettingsManifest);
        } catch {
            // No settings service — governance stays at declared defaults.
        }
    });
    // ADR-0104 / #3438: name the value-shape gates still open on THIS
    // deployment, and the command that closes each. Deliberately on
    // `kernel:bootstrapped` rather than `kernel:ready`: the answer depends on
    // the storage service's OWN ready handler, which registers `sys_migration`
    // and may attest a store it just created. Racing it inside `kernel:ready`
    // would tell a brand-new deployment its gates are open moments after they
    // were closed.
    ctx.hook('kernel:bootstrapped', async () => {
        await this.ql?.announceOpenMigrationGates();
    });
    ctx.hook('metadata:reloaded', async (payload?: unknown) => {
        await this.resyncAuthoredHooks(ctx);
        await this.resyncAuthoredActions(ctx);
        // 15.1 third-party eval: an object added while `os dev` runs was
        // invisible until a manual restart. Two gaps compounded:
        //   1. MetadataPlugin's artifact reload ingests through
        //      `manager.register(…, { notify: false })` — one announcement per
        //      artifact, not per item (#3112) — so the bridge in
        //      `subscribeToMetadataEvents` never sees the new object and the
        //      SchemaRegistry never learns it ("Object … is not registered").
        //      This hook IS that announcement: ingest the reloaded object
        //      definitions straight off the `metadata:reloaded` payload
        //      (mirroring the subscribe handler's registerObject call,
        //      provenance included).
        //   2. Tables were only ever created by the boot-time sync — re-run
        //      the idempotent schema sync after each reload so new objects
        //      get their DDL immediately. Honors the same opt-out as boot
        //      (`skipSchemaSync` / OS_SKIP_SCHEMA_SYNC) for deployments that
        //      manage DDL out-of-band, and serializes through
        //      `reloadSchemaSync` so overlapping reload events can't race DDL.
        this.ingestReloadedObjects(ctx, payload);
        if (!this.skipSchemaSync) {
            this.reloadSchemaSync = this.reloadSchemaSync.then(async () => {
                try {
                    await this.syncRegisteredSchemas(ctx);
                } catch (e: any) {
                    // #4632 — durability degradation, not a functional one. A
                    // Studio edit that adds a field lands in metadata (the UI
                    // shows it, the API accepts it, the author sees a saved
                    // record) while the column it needs was never created. The
                    // author is told the value was saved and it was not.
                    // `Logger.error` is `(message, error?, meta?)` — the second
                    // slot is the Error, NOT the context bag `warn` takes there.
                    ctx.logger.error(
                        '[ObjectQLPlugin] reload-time schema sync FAILED — objects changed by this metadata reload are live in the ' +
                            'registry, UI and API, but their new/altered columns were NOT created: writes against them are accepted and ' +
                            'then silently lost or rejected. Fix the driver error below and reload again (or restart) to re-run DDL.',
                        e instanceof Error ? e : new Error(String(e?.message ?? e)),
                    );
                }
            });
            await this.reloadSchemaSync;
        }
        // [ADR-0110 D5] Re-run the inventory after a live metadata reload —
        // a Studio edit can orphan a handler (declaration deleted) or bind
        // one (declaration added), and a boot-only snapshot goes stale the
        // moment either happens. Fingerprint-suppressed: a reload that
        // changed nothing action-related logs nothing.
        await this.runGovernanceInventory(ctx);
    });

    // Discover features from Kernel Services
    if (ctx.getServices && this.ql) {
        const services = ctx.getServices();
        for (const [name, service] of services.entries()) {
            if (name.startsWith('driver.')) {
                 // Register Driver.
                 //
                 // For the standalone `default` this is the SECOND leg of a
                 // round trip, not a new registration (#4773):
                 // `DefaultDatasourcePlugin.init()` already registered the
                 // driver through `DatasourceConnectionService`, then
                 // republished that same instance as this `driver.<name>`
                 // service for `os migrate` / serve storage detection. Handing
                 // it back is a deliberate no-op — see `registerDriver`, which
                 // distinguishes this identical re-entry (quiet) from a real
                 // name collision between two different instances (loud).
                 this.ql.registerDriver(service);
                 ctx.logger.debug('Discovered and registered driver service', { serviceName: name });
            }
            if (name.startsWith('app.')) {
                // Legacy fallback: discover app.* services (DEPRECATED)
                ctx.logger.warn(
                    `[DEPRECATED] Service "${name}" uses legacy app.* convention. ` +
                    `Migrate to ctx.getService('manifest').register(data).`
                );
                this.ql.registerApp(service); // service is Manifest
                ctx.logger.debug('Discovered and registered app service (legacy)', { serviceName: name });
            }
        }

        // Bridge realtime service from kernel service registry to ObjectQL.
        // RealtimeServicePlugin registers as 'realtime' service during init().
        // This enables ObjectQL to publish data change events.
        try {
            const realtimeService = ctx.getService('realtime');
            if (realtimeService && typeof realtimeService === 'object' && 'publish' in realtimeService) {
                ctx.logger.info('[ObjectQLPlugin] Bridging realtime service to ObjectQL for event publishing');
                this.ql.setRealtimeService(realtimeService as any);
            }
        } catch (e: any) {
            ctx.logger.debug('[ObjectQLPlugin] No realtime service found — data events will not be published', {
                error: e.message,
            });
        }

        // Bridge the i18n service so a rejected write reports in the caller's
        // language (#3957): it supplies both the `validation.field.*` message
        // overrides and the field's TRANSLATED label. Absent service is fine —
        // the built-in catalog in `@objectstack/spec/system` still localizes the
        // message against the field's declared label.
        try {
            const i18nService = ctx.getService('i18n');
            if (i18nService && typeof (i18nService as any).t === 'function') {
                ctx.logger.info('[ObjectQLPlugin] Bridging i18n service to ObjectQL for validation messages');
                this.ql.setI18nService(i18nService as any);
            }
        } catch (e: any) {
            ctx.logger.debug('[ObjectQLPlugin] No i18n service found — validation messages use the built-in catalog', {
                error: e.message,
            });
        }
    }

    // Initialize drivers (calls driver.connect() which sets up persistence)
    await this.ql?.init();

    // Phase 1: Sync built-in schemas so sys_metadata table exists before reading it.
    //
    // Cold-start-sensitive runtimes (Cloudflare Containers, Lambda) can
    // opt out via `skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1`. In that
    // mode an out-of-band migration must have already created every
    // table; we only assume the DDL is in place and skip straight to
    // hydration. This avoids one round-trip per table × N objects on
    // every cold boot.
    if (this.skipSchemaSync) {
      ctx.logger.info('Skipping schema sync (OS_SKIP_SCHEMA_SYNC=1) — assuming DDL is managed out-of-band');
    } else {
      await this.syncRegisteredSchemas(ctx);
    }

    // Phase 2: Hydrate SchemaRegistry from sys_metadata (loads custom/template objects).
    // Project kernels (environmentId set) USUALLY source metadata from the
    // artifact (MetadataPlugin) or a control-plane proxy and have no local
    // sys_metadata, so hydration is skipped to avoid querying a table that
    // does not exist (or, worse, a proxied remote one). EXCEPTION: an
    // isolated, proxy-free project kernel that persists its OWN sys_metadata
    // locally (the cloud single-env tenant runtime) opts in via
    // `hydrateMetadataFromDb` so objects CREATED AT RUNTIME there re-enter the
    // registry after a restart — otherwise registry.getObject() returns
    // nothing for them and every registry consumer (the unknown-$select
    // guard, hooks, relationships) silently degrades. Safe because each engine
    // owns its registry (no cross-kernel leakage) and hydration tolerates a
    // missing table.
    if (this.environmentId === undefined || this.hydrateMetadataFromDb) {
        await this.restoreMetadataFromDb(ctx);
    } else {
        ctx.logger.info('Project kernel — skipping sys_metadata hydration (metadata sourced from artifact)');
    }

    // Phase 3: Sync any new schemas that were just hydrated from the DB
    // (e.g. CRM objects seeded via template — they must have tables before use).
    if (!this.skipSchemaSync) {
      await this.syncRegisteredSchemas(ctx);
    }

    // Bridge all SchemaRegistry objects to metadata service.
    //
    // `SchemaRegistry` is a process-wide singleton, so project kernels in a
    // multi-environment server would otherwise inherit every object ever
    // registered by any sibling project. When this plugin was constructed
    // with a `environmentId`, the kernel is project-scoped — its
    // metadata comes from the artifact (MetadataPlugin) or the
    // control-plane proxy, not from local sys_metadata. The bridge would
    // only pollute its metadata service with cross-project leakage, so
    // skip it in that case.
    if (this.environmentId === undefined) {
        await this.bridgeObjectsToMetadataService(ctx);
    }
    // Arm the incremental per-manifest bridge for everything after start() —
    // marketplace install / rehydrate register through the `manifest`
    // service on `kernel:ready`, long after this line, and without the
    // incremental bridge their objects never reach the metadata service
    // (AI describe_object, Studio object lists, metadata.listObjects all
    // miss them; only the seed loader has an engine fallback, #3422).
    //
    // Deliberately NOT inside the `environmentId === undefined` gate above:
    // that gate exists because the one-shot bridge copies the ENTIRE
    // process-wide SchemaRegistry (cross-project leakage on multi-env
    // servers), whereas the per-manifest bridge only copies the objects of
    // the one package THIS kernel just registered — nothing to leak. And
    // `os dev` boots project-scoped (environmentId 'env_local'), which is
    // marketplace install-local's primary home: gating on environmentId
    // would switch the fix off exactly where it matters (caught by
    // browser-dogfooding the install flow).
    this.bridgeLateManifests = true;

    // Register built-in audit hooks
    this.registerAuditHooks(ctx);

    // Tenant isolation is now handled by `@objectstack/plugin-security`
    // via the `member_default` permission set's RLS rule
    // (`organization_id = current_user.organization_id`, with
    // field-existence guards). The legacy hard-coded `tenant_id` filter
    // middleware was removed because it (a) collided with the
    // SecurityPlugin RLS pipeline and (b) blindly filtered tables that
    // don't have a `tenant_id` column (e.g. `sys_organization`),
    // returning 0 rows instead of all rows.

    ctx.logger.info('ObjectQL engine started', {
        driversRegistered: this.ql?.['drivers']?.size || 0,
        objectsRegistered: this.ql?.registry?.getAllObjects?.()?.length || 0
    });

    // ADR-0057: arm the periodic lifecycle sweep once the engine is live.
    this.lifecycleService?.start();
  }

  /**
   * Kernel teardown.
   *
   * **This used to be `stop()`, which the kernel never calls** (#4747). The
   * Plugin contract is `init` / `start` / `destroy` — `packages/core/src/
   * types.ts`, and `DefaultDatasourcePlugin.destroy` says so in as many words
   * ("`stop()` exists nowhere in the Plugin contract and is never called").
   * So the one line that disarmed the ADR-0057 sweep never ran, on any host:
   * the timers outlived the engine, and 60s after a one-shot `os migrate`
   * boot the sweep woke up and queried a datasource its own host had already
   * disconnected — an `ERROR Find operation failed` on a SUCCESSFUL command,
   * and two objects filed as `unreadableObjects` by the #4551 audit on every
   * healthy run. A hook nobody calls is not defence in depth; it is the
   * absence of defence, spelled like its presence.
   */
  destroy = async () => {
    // ADR-0057: disarm the sweep timers AND call off a sweep in flight, before
    // the datasource plugin (destroyed after us — reverse registration order)
    // closes the pool underneath it.
    this.lifecycleService?.stop();
    // ADR-0008 PR-7: tear down metadata subscriptions on teardown so tests
    // don't leak watchers and reloaded plugins don't double-subscribe.
    for (const unsub of this.metadataUnsubscribes) {
      try { unsub(); } catch { /* teardown is best-effort — the kernel is going away */ }
    }
    this.metadataUnsubscribes = [];
  }

  /**
   * Re-register every object definition carried on a `metadata:reloaded`
   * payload into the SchemaRegistry. The artifact reload path registers
   * items via `MetadataManager.register()`, which does not fire
   * `subscribe()` watchers — without this ingest, an object added while the
   * server runs never reaches the registry (and therefore can never get a
   * table or answer a query). Mirrors `subscribeToMetadataEvents`'s
   * registerObject call: provenance comes from the `_packageId` the
   * MetadataPlugin stamped during registration (falling back to
   * 'metadata-service'), so package attribution stays reload-stable.
   * Removed objects are left registered until restart — same lifecycle as
   * their tables, which managed drift deliberately never drops.
   */
  /**
   * [ADR-0029 D9.8] Which contributor KIND a metadata-service body registers
   * as. The SAME discriminator the two `sys_metadata` hydration seams ask, owed
   * to these two ingest paths because they also register a reloaded body — left
   * as an unconditional `'own'` they re-open the splice through a third door,
   * and it is easy to miss precisely because they are about metadata-service
   * reloads rather than about tenant overlays.
   *
   * Narrower than the `sys_metadata` seams' rule, and deliberately so: a row
   * from `sys_metadata` is tenant-authored by definition, while THIS body can
   * be either layer. A reload of the OWNER's own definition (HMR, a package
   * re-registering its own object) must stay an `own` re-registration; it is a
   * body that arrives under a different id, or one that says it is
   * tenant-authored, that is a layer over the code definition.
   */
  private objectContributionKind(name: string, packageId: string, body: unknown): 'own' | 'overlay' {
    const registry: any = this.ql?.registry;
    if (typeof registry?.getPackagedObjectOwner !== 'function') return 'own';
    const owner = registry.getPackagedObjectOwner(name);
    if (!owner) return 'own';
    const tenantAuthored = (body as { _provenance?: unknown } | null | undefined)?._provenance === 'org';
    return owner.packageId === packageId && !tenantAuthored ? 'own' : 'overlay';
  }

  private ingestReloadedObjects(ctx: PluginContext, payload: unknown): void {
    if (!this.ql) return;
    const objects = (payload as any)?.metadata?.objects;
    if (!Array.isArray(objects) || objects.length === 0) return;
    let ingested = 0;
    for (const obj of objects) {
      const name = (obj as any)?.name;
      if (typeof name !== 'string' || name.length === 0) continue;
      try {
        this.ql.registry.invalidate(name);
        const reloadPackageId = (obj as any)._packageId ?? 'metadata-service';
        this.ql.registry.registerObject(
          obj as any,
          reloadPackageId,
          (obj as any).namespace,
          // [ADR-0029 D9.8] See {@link objectContributionKind}.
          this.objectContributionKind(name, reloadPackageId, obj),
        );
        ingested++;
      } catch (e: any) {
        ctx.logger.warn('[ObjectQLPlugin] reload object ingest failed', {
          name,
          error: e?.message,
        });
      }
    }
    if (ingested > 0) {
      ctx.logger.info('[ObjectQLPlugin] reload ingested object definitions into the registry', {
        count: ingested,
      });
    }
  }

  /**
   * Subscribe to `object` metadata events from the metadata service and
   * invalidate the SchemaRegistry merge cache on each event (ADR-0008
   * PR-7). For create/update we also re-load the affected object from
   * the metadata service so subsequent reads see the new definition;
   * for delete we unregister it from every contributing package.
   *
   * Events are filtered to the canonical `object` type — view/dashboard
   * /flow edits go through their own consumers (Studio SSE, REST cache).
   *
   * Stored unsubscribe handle is invoked from {@link stop}.
   */
  private subscribeToMetadataEvents(metadataService: any, ctx: PluginContext) {
    const handler = async (evt: any) => {
      if (!this.ql) return;
      const name: string = evt?.name ?? '';
      if (!name) return;
      const eventType: 'added' | 'changed' | 'deleted' =
        evt?.type === 'added' || evt?.type === 'changed' || evt?.type === 'deleted'
          ? evt.type
          : 'changed';

      try {
        // Drop the merged-schema cache entry first so any in-flight
        // resolveObject() races recompute against the new state.
        this.ql.registry.invalidate(name);

        if (eventType === 'deleted') {
          ctx.logger.info('[ObjectQLPlugin] object metadata deleted — registry invalidated', { name });
          return;
        }

        // Re-fetch the canonical definition from the metadata service.
        // The metadata service goes through its loader chain (FS, DB,
        // attached repository), so this picks up edits from any source.
        //
        // [#5840, ADR-0110 D3] Through `getDiagnosed` when the service offers
        // it: the loader chain named above is exactly what can be DOWN, and
        // `get()` reported an unreachable metadata database as the same
        // `undefined` a deleted object produces. The `else` branch below then
        // said, in the log, that the service "has no fresh body" — an
        // assertion about what is declared, made from a read that never
        // happened. A service that predates `getDiagnosed` reports nothing
        // degraded, which is precisely what it could express before.
        const read = typeof metadataService.getDiagnosed === 'function'
          ? await metadataService.getDiagnosed('object', name)
          : typeof metadataService.get === 'function'
            ? { data: await metadataService.get('object', name), degraded: false, errors: [] }
            : { data: undefined, degraded: false, errors: [] };
        const fresh = read?.data;
        if (fresh && typeof fresh === 'object') {
          // Re-register with the original contributor metadata. We use
          // 'metadata-service' as packageId to match how the initial
          // load enrolls these objects (see `loadMetadataFromService`).
          const packageId = (fresh as any)._packageId ?? 'metadata-service';
          const namespace = (fresh as any).namespace;
          this.ql.registry.registerObject(
            fresh as any,
            packageId,
            namespace,
            // [ADR-0029 D9.8] See {@link objectContributionKind}.
            this.objectContributionKind(name, packageId, fresh),
          );
          ctx.logger.info('[ObjectQLPlugin] object metadata updated — registry refreshed', {
            name,
            packageId,
          });
        } else if (read?.degraded) {
          // #5840 — `warn`, not `error`, and the choice is made with the
          // AGENTS.md "Degradation log levels" question rather than by
          // analogy to `restoreMetadataFromDb`'s `error` below. Ask it
          // honestly: does something this code CLAIMS IS PERSISTED fail to
          // land, while the system looks normal? No — the write already
          // landed in the metadata store; what failed is a re-READ, and the
          // registry keeps serving the definition it already holds. That is a
          // functional degradation (this kernel's copy is behind), not a
          // durability one. Escalating it would be the mirror-image failure
          // that rule warns about, and it would fire once per event during an
          // outage rather than once per boot.
          //
          // What it still owes the reader is the consequence and the fix,
          // which the `debug` line it replaces gave neither of.
          ctx.logger.warn(
            '[ObjectQLPlugin] object metadata changed but the metadata service could not be read — ' +
              'the registry keeps the PREVIOUS definition for this object and nothing retries: reads serve the stale ' +
              'schema until a later event for it succeeds or the process restarts. ' +
              'Fix: check the loaders behind the metadata service (datasource connection, credentials, table).',
            { name, errors: read.errors },
          );
        } else {
          // A read that HAPPENED and found nothing — the object really is gone
          // from every loader (deleted between the event and this re-read).
          ctx.logger.debug('[ObjectQLPlugin] object event received but metadata service has no fresh body', { name });
        }
      } catch (e: any) {
        ctx.logger.warn('[ObjectQLPlugin] metadata event handler failed', {
          name,
          error: e?.message,
        });
      }
    };

    const unsub = metadataService.subscribe('object', handler);
    if (typeof unsub === 'function') {
      this.metadataUnsubscribes.push(unsub);
    } else if (unsub && typeof unsub.unsubscribe === 'function') {
      // Support `MetadataWatchHandle` style return shape.
      this.metadataUnsubscribes.push(() => unsub.unsubscribe());
    }
    ctx.logger.info('[ObjectQLPlugin] subscribed to object metadata events (ADR-0008 PR-7)');
  }

  /**
   * Register built-in audit hooks for auto-stamping created_by/updated_by
   * and fetching previousData for update/delete operations. These are
   * declared as canonical `Hook` metadata and bound through the same
   * `bindHooksToEngine` path used by `defineStack({ hooks })`, so the
   * engine's built-ins flow through the same rails as user code
   * (dogfooding the protocol).
   */
  private registerAuditHooks(ctx: PluginContext) {
    if (!this.ql) return;

    const stamp = () => new Date().toISOString();

    /**
     * Returns true when the resolved object schema declares a field with the
     * given name. Audit fields (`created_by`, `updated_by`, `tenant_id`) are
     * NOT auto-injected by the SQL driver, so we must only stamp values for
     * fields the user has explicitly declared on the object — otherwise the
     * driver will issue an INSERT against a column that does not exist in
     * the physical table (e.g. `table lead has no column named created_by`).
     *
     * `created_at`/`updated_at` are unconditional because driver-sql creates
     * them as built-in columns on every table.
     */
    const hasField = (objectName: string, field: string): boolean => {
      try {
        const schema: any = this.ql?.getSchema?.(objectName);
        if (!schema || typeof schema !== 'object') return false;
        const fields = schema.fields;
        if (!fields || typeof fields !== 'object') return false;
        return Object.prototype.hasOwnProperty.call(fields, field);
      } catch {
        return false;
      }
    };

    const applyToRecord = (
      record: Record<string, any>,
      objectName: string,
      session: any,
      isInsert: boolean,
    ) => {
      const now = stamp();
      // A "historical" import (#3493) reinstates the ORIGINAL timeline, so a
      // client-supplied updated_at/updated_by is CLIENT-PREFERRED here —
      // symmetric with created_at/created_by on insert — instead of being
      // overwritten with the import instant. Opt-in and server-set only; a
      // normal write leaves `preserveAudit` unset and still stamps now.
      const preserveAudit = session?.preserveAudit === true;
      if (isInsert) {
        record.created_at = record.created_at ?? now;
      }
      record.updated_at = preserveAudit ? (record.updated_at ?? now) : now;
      if (session?.userId) {
        if (isInsert && hasField(objectName, 'created_by')) {
          record.created_by = record.created_by ?? session.userId;
        }
        if (hasField(objectName, 'updated_by')) {
          record.updated_by = preserveAudit ? (record.updated_by ?? session.userId) : session.userId;
        }
      }
      // Stamp the driver-layer `tenant_id` column from the caller's active org.
      // The hook session exposes it as `organizationId` (the `session.tenantId`
      // alias was removed in v11, #3290); the column name is a separate axis.
      if (isInsert && session?.organizationId && hasField(objectName, 'tenant_id')) {
        record.tenant_id = record.tenant_id ?? session.organizationId;
      }
    };

    const stampData = (
      data: unknown,
      objectName: string,
      session: any,
      isInsert: boolean,
    ) => {
      if (Array.isArray(data)) {
        for (const row of data) {
          if (row && typeof row === 'object') {
            applyToRecord(row as Record<string, any>, objectName, session, isInsert);
          }
        }
      } else if (data && typeof data === 'object') {
        applyToRecord(data as Record<string, any>, objectName, session, isInsert);
      }
    };

    const builtinHooks: any[] = [
      {
        name: 'sys_stamp_audit_insert',
        object: '*',
        events: ['beforeInsert'],
        priority: 10,
        description: 'Auto-stamp created_by / updated_by / created_at / updated_at / tenant_id on insert (only when the field exists on the object schema)',
        handler: async (hookCtx: any) => {
          if (hookCtx.input?.data) {
            stampData(hookCtx.input.data, hookCtx.object, hookCtx.session, true);
          }
        },
      },
      {
        name: 'sys_stamp_audit_update',
        object: '*',
        events: ['beforeUpdate'],
        priority: 10,
        description: 'Auto-stamp updated_by / updated_at on update (only when the field exists on the object schema)',
        handler: async (hookCtx: any) => {
          if (hookCtx.input?.data) {
            stampData(hookCtx.input.data, hookCtx.object, hookCtx.session, false);
          }
        },
      },
      // ⛔ RETIRED — `sys_fetch_previous_update` (#5846 (a), delivered with
      // #5574's engine half). Do not reintroduce it.
      //
      // It was registered here on `object: '*'` at priority 5, and on every
      // by-id update it issued its own `ql.findOne` to bind
      // `hookCtx.previous`, behind the guard `if (input.id && !ctx.previous)`.
      // That guard is now PERMANENTLY FALSE: `update()` reads the prior row and
      // binds `hookContext.previous` BEFORE dispatching `beforeUpdate` (the
      // shape `delete()` has had since #5272), because ADR-0058 Addendum II
      // makes the before phase a real reader of that row. A hook whose only
      // statement is a guard that can no longer be true is not a safety net,
      // it is a second read waiting to be rediscovered — so it goes, rather
      // than being left in place "just in case".
      //
      // What it cost while it stood, measured on #5846: a single by-id update
      // on a kernel with plugin-audit read the same row THREE times — this
      // builtin, plugin-audit's `captureBefore`, and the engine's own gated
      // read. Two of the three were engine reads through the full read pipeline
      // (middleware, RLS, field masking) and neither consulted any demand gate.
      // This change removes one and makes the engine's the single producer;
      // `captureBefore`'s now-redundant read followed it out in #6656, which
      // leaves the engine's gated read as the only producer on this path.
      //
      // ⛔ RETIRED — `sys_fetch_previous_delete` (#5929, ADR-0049
      // enforce-or-remove). Do not reintroduce it.
      //
      // #5846 left the measurement here rather than the hook, precisely so this
      // retirement would not have to rediscover it. Quoted from the block above
      // as it stood then, because it IS the argument:
      //
      //   `delete()` reads its pre-image when `wantsPreImage` is true, and that
      //   gate is `hasHooksFor('beforeDelete', object) || hasHooksFor(
      //   'afterDelete', object) || summaries`. The builtin is itself a
      //   `beforeDelete` hook on `'*'`, so it makes the FIRST term true for
      //   every object — and then the engine's read binds `previous` before the
      //   builtin runs, so the builtin's own `!ctx.previous` guard is false and
      //   it issues no `findOne`. It is circular: the builtin's only remaining
      //   effect is to hold open the gate that makes it redundant.
      //
      // Verified on this branch before removing anything, because a measurement
      // recorded on one PR is a hypothesis on the next: the engine binds
      // `previous` ahead of `beforeDelete` on BOTH delete shapes — by-id since
      // #5272, per matched row since #6697 — so the guard is unreachable in
      // production, and removing the hook changes no `previous` binding
      // anywhere. The residual shape, `!hookCtx.previous` because the engine's
      // own read found nothing, is one where this handler's read finds nothing
      // either (same row, same transaction, same tenant scope): it binds
      // nothing, and `bindPreImage` deliberately leaves `previous` UNBOUND
      // rather than fabricating `{}` (#4649/#4775).
      //
      // What retiring it buys, and what it does NOT buy — both worth stating so
      // the next reader does not over-read the result:
      //   * it makes `hasHooksFor('beforeDelete', object)` an honest question on
      //     an objectql-only kernel, so an object with no delete-side hook and
      //     no roll-up summary finally pays NO prior-row read on a by-id
      //     `delete()`. That skip could never happen while this hook stood.
      //   * it does not, on its own, make the gate false on a kernel that also
      //     loads plugin-auth / plugin-sharing / plugin-audit: each of those
      //     registers a delete-phase hook with no `object` (i.e. global), and
      //     they hold the same gate open for their own reasons. Those are real
      //     consumers with real handlers, not circular ones — the gate answering
      //     "yes" for them is the gate working. The enumeration lives in
      //     `engine.ts` beside `wantsPreImage`.
      //
      // The retired hook's own shape is replayed as an authored hook in
      // `engine-delete-prior-read-scope.test.ts`, which measures that its guard
      // short-circuits and it issues zero reads — so "the guard can no longer be
      // true" stays a measurement instead of rotting into a claim.
    ];

    if (typeof (this.ql as any).bindHooks === 'function') {
      (this.ql as any).bindHooks(builtinHooks, { packageId: 'sys:audit' });
    } else {
      // Defensive fallback if binder isn't available (older builds).
      for (const h of builtinHooks) {
        for (const event of h.events) {
          this.ql.registerHook(event, h.handler, {
            object: h.object,
            priority: h.priority,
            packageId: 'sys:audit',
          });
        }
      }
    }

    // `previousData` used to be listed here as a third thing these builtins
    // did. It is not one any more: both fetch-previous hooks are retired
    // (#5846 update-side, #5929 delete-side) and `previous` is bound by the
    // ENGINE on both write paths. A log line naming a producer that no longer
    // exists is the cheapest way to send the next reader looking for it.
    ctx.logger.debug('Audit hooks registered via binder (created_by/updated_by/created_at/updated_at/tenant_id stamping)');
  }

  /**
   * Tenant isolation moved to `@objectstack/plugin-security`'s
   * `member_default` permission set RLS
   * (`organization_id = current_user.organization_id`, with
   * field-existence guards). The legacy `registerTenantMiddleware`
   * method was removed because it (a) collided with SecurityPlugin's
   * RLS pipeline and (b) blindly filtered tables that don't have a
   * `tenant_id` column (e.g. `sys_organization`), returning 0 rows
   * instead of all rows.
   */

  /**
   * Bind every declared FEDERATED (external) object to its remote table —
   * once, at `kernel:ready`, when the boot has finished moving (#7737).
   *
   * ## What the binding is, and why it has to happen twice
   *
   * `driver.registerExternalObject(obj)` is what installs an external
   * object's read metadata: the object -> remote-table mapping
   * (`external.remoteName` / `remoteSchema`), the `external.columnMap`
   * translation, and the type-coercion maps. Nothing else installs it. An
   * external object without it resolves to a table named after the OBJECT
   * rather than the remote table it declares, so every read against it either
   * fails with "no such table" or silently answers from the wrong table.
   *
   * {@link syncRegisteredSchemas} already calls it — but it runs inside THIS
   * plugin's `start()`, and the declared datasource that owns the remote
   * database is auto-connected in `AppPlugin.start()` (ADR-0062 D1), a later
   * `start()`. So at boot schema-sync time `getDriverForObject()` legitimately
   * answers `undefined` for a federated object on a healthy boot, and that
   * call is skipped. Whether the object ends up bound then depends on some
   * OTHER component re-driving it afterwards — today
   * `DatasourceConnectionService` does, but only for objects the datasource
   * knew to name (an explicit `object.datasource`), never for objects a
   * `datasourceMapping` rule routes to it, and not at all when
   * `OS_SKIP_SCHEMA_SYNC` is set (that flag is about DDL, and this binding is
   * DDL-free).
   *
   * This pass removes that dependence on boot ORDER: it runs after every
   * `start()` has completed, re-drives the binding for every registered
   * external object (idempotent — `registerExternalObject` is pure metadata
   * assignment), and is therefore correct no matter which plugin connected
   * the datasource, in which slot, or whether DDL was skipped.
   *
   * ## …and it REPORTS what it could not bind
   *
   * A federated object that reaches the end of boot with no driver is
   * declared-but-unreadable while the object stays registered, keeps its REST
   * routes and keeps rendering in the UI. That is the shape #7737 was filed
   * for, and the reason its ruling is that the skip must stop being silent:
   * `debug` at the skip site was the whole diagnosis of a broken federation.
   * Reported at `error` per the AGENTS.md degradation-log-level rule — from
   * the outside the deployment looks healthy while declared data is simply
   * not reachable — naming the objects, their datasources, the consequence
   * and the fix. A boot with nothing to report says nothing.
   */
  private async reconcileFederatedBindings(ctx: PluginContext): Promise<void> {
    if (!this.ql) return;

    const allObjects = this.ql.registry?.getAllObjects?.() ?? [];
    const federated = allObjects.filter((o: any) => o?.external != null);
    if (federated.length === 0) return;

    let bound = 0;
    const unbound: string[] = [];
    const unsupported: string[] = [];
    const failed: string[] = [];
    const datasourceOf = (name: string): string =>
      this.ql?.resolveEffectiveDatasource?.(name) ?? '(default)';

    for (const obj of federated) {
      const driver: any = this.ql.getDriverForObject(obj.name);
      if (!driver) {
        unbound.push(`${obj.name} -> datasource '${datasourceOf(obj.name)}'`);
        continue;
      }
      if (typeof driver.registerExternalObject !== 'function') {
        unsupported.push(`${obj.name} -> driver '${driver.name}'`);
        continue;
      }
      try {
        await driver.registerExternalObject(obj);
        bound++;
      } catch (e: unknown) {
        failed.push(`${obj.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (unbound.length === 0 && unsupported.length === 0 && failed.length === 0) {
      ctx.logger.debug('Federated objects bound to their remote tables', { bound });
      return;
    }

    ctx.logger.error(
      `${unbound.length + unsupported.length + failed.length} federated (external) object(s) are NOT bound to their remote ` +
        `table, yet stay registered and served: they keep their REST routes and keep rendering in the UI, while every read ` +
        `against them resolves to a table named after the OBJECT instead of the remote table it declares — so those reads ` +
        `fail with "no such table", or answer from the wrong table. ` +
        (unbound.length
          ? `No driver for the declared datasource (never declared, or its connection was refused/failed — see that ` +
            `datasource's own connect verdict earlier in this boot): ${unbound.join(', ')}. `
          : '') +
        (unsupported.length
          ? `Driver does not implement external-object registration (ADR-0015 federation): ${unsupported.join(', ')}. `
          : '') +
        (failed.length ? `Registration threw: ${failed.join(', ')}. ` : '') +
        `Fix the datasource/driver named above and restart (or trigger a metadata reload) to re-run this binding.`,
      undefined,
      { bound, unbound: unbound.length, unsupported: unsupported.length, failed: failed.length },
    );
  }

  /**
   * Synchronize all registered object schemas to the database.
   *
   * Groups objects by their responsible driver, then:
   * - If the driver advertises `supports.batchSchemaSync` and implements
   *   `syncSchemasBatch()`, submits all schemas in a single call (reducing
   *   network round-trips for remote drivers like Turso).
   * - Otherwise falls back to sequential `syncSchema()` per object.
   *
   * This is idempotent — drivers must tolerate repeated calls without
   * duplicating tables or erroring out.
   *
   * Drivers that do not implement `syncSchema` are silently skipped.
   */
  private async syncRegisteredSchemas(ctx: PluginContext) {
    if (!this.ql) return;

    const allObjects = this.ql.registry?.getAllObjects?.() ?? [];
    if (allObjects.length === 0) return;

    let synced = 0;
    let skipped = 0;
    let failed = 0;

    /**
     * #4632 — a failed schema sync is a DURABILITY degradation, not a
     * functional one, so it is reported at `error`.
     *
     * The object stays in the registry, keeps its REST routes, keeps rendering
     * in the UI — the system looks completely healthy — while its table or its
     * newly-declared columns were never created. Writes then fail, or (on
     * drivers that accept unknown attributes) succeed while silently dropping
     * the un-created column: the thing the system claims it persisted is not
     * on disk. That is exactly the #4420 shape one layer up from the durable
     * suspended-run store #4460 fixed, so it carries the same obligation —
     * name the CONSEQUENCE and the FIX at the first failure.
     */
    const reportSyncFailure = (
      obj: any,
      tableName: string,
      driverName: string,
      err: unknown,
    ): void => {
      failed++;
      // NB `Logger.error` is `(message, error?, meta?)` — the Error goes in the
      // SECOND slot, unlike `warn`'s `(message, meta?)`. This call was written
      // as a mechanical warn→error swap and the mismatch only surfaced in the
      // DTS build, never in a test run.
      ctx.logger.error(
        `Schema sync FAILED for object '${obj?.name}' — its table/columns were NOT created or altered, but the object stays ` +
          `registered and served: writes to it will fail, or silently drop the columns that were never created. ` +
          `Nothing that claims to be persisted for this object is guaranteed to be on disk. ` +
          `Fix the driver/datasource error below and restart (or trigger a metadata reload) to re-run DDL; ` +
          `if this deployment manages DDL out-of-band, set \`skipSchemaSync\` / OS_SKIP_SCHEMA_SYNC so the omission is deliberate.`,
        err instanceof Error ? err : new Error(String(err)),
        { object: obj?.name, tableName, driver: driverName },
      );
    };

    // Group objects by driver for potential batch optimization
    const driverGroups = new Map<any, Array<{ obj: any; tableName: string }>>();

    for (const obj of allObjects) {
      const driver = this.ql.getDriverForObject(obj.name);
      if (!driver) {
        // #7737 — for a FEDERATED object this skip is not a schema-sync
        // detail. `registerExternalObject` (just below) is the ONLY thing
        // that installs the object -> remote-table mapping, and it lives past
        // this guard: skip it and every read of that object resolves against
        // a table named after the object instead of the remote table it
        // declares.
        //
        // It is also NOT, by itself, a defect. Boot schema-sync runs inside
        // this plugin's `start()`, while a declared datasource is
        // auto-connected in `AppPlugin.start()` — a later `start()` on every
        // composition that has one — so on a perfectly healthy boot the
        // driver genuinely does not exist yet at this line.
        //
        // Hence the split: quiet HERE, because the deferral is expected, and
        // reconciled + REPORTED at `kernel:ready` by
        // {@link reconcileFederatedBindings}, after every `start()` has run.
        // That is the point at which "still no driver" is final and is a real
        // defect, and it is reported as one — this skip is no longer the last
        // word on a declared external object.
        if (obj.external != null) {
          ctx.logger.debug(
            'No driver yet for federated object — deferring its remote-table binding to the kernel:ready reconciliation',
            { object: obj.name, datasource: this.ql.resolveEffectiveDatasource?.(obj.name) },
          );
          skipped++;
          continue;
        }
        ctx.logger.debug('No driver available for object, skipping schema sync', {
          object: obj.name,
        });
        skipped++;
        continue;
      }

      // Federated (external) objects (ADR-0015): their schema is owned by the
      // remote database, so DDL (syncSchema/initObjects) is forbidden and would
      // throw. Register read metadata (physical remote table + coercion maps)
      // without DDL so the query path resolves to the remote table, then skip
      // the DDL grouping below.
      if (obj.external != null) {
        if (typeof driver.registerExternalObject === 'function') {
          try {
            await driver.registerExternalObject(obj);
            synced++;
          } catch (e: unknown) {
            ctx.logger.warn('Failed to register external object metadata', {
              object: obj.name,
              driver: driver.name,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        } else {
          ctx.logger.debug('Driver does not support registerExternalObject, skipping external object', {
            object: obj.name,
            driver: driver.name,
          });
          skipped++;
        }
        continue;
      }

      if (typeof driver.syncSchema !== 'function') {
        ctx.logger.debug('Driver does not support syncSchema, skipping', {
          object: obj.name,
          driver: driver.name,
        });
        skipped++;
        continue;
      }

      const tableName = StorageNameMapping.resolveTableName(obj);

      let group = driverGroups.get(driver);
      if (!group) {
        group = [];
        driverGroups.set(driver, group);
      }
      group.push({ obj, tableName });
    }

    // Process each driver group
    for (const [driver, entries] of driverGroups) {
      // Batch path: driver supports batch schema sync
      if (
        driver.supports?.batchSchemaSync &&
        typeof driver.syncSchemasBatch === 'function'
      ) {
        const batchPayload = entries.map((e) => ({
          object: e.tableName,
          schema: e.obj,
        }));
        try {
          await driver.syncSchemasBatch(batchPayload);
          synced += entries.length;
          ctx.logger.debug('Batch schema sync succeeded', {
            driver: driver.name,
            count: entries.length,
          });
        } catch (e: unknown) {
          ctx.logger.warn('Batch schema sync failed, falling back to sequential', {
            driver: driver.name,
            error: e instanceof Error ? e.message : String(e),
          });
          // Fallback: sequential sync for this driver's objects. The batch
          // warn above is correct at `warn` — it RECOVERS here; only a
          // sequential failure actually loses the DDL.
          for (const { obj, tableName } of entries) {
            try {
              await driver.syncSchema(tableName, obj);
              synced++;
            } catch (seqErr: unknown) {
              reportSyncFailure(obj, tableName, driver.name, seqErr);
            }
          }
        }
      } else {
        // Sequential path: no batch support
        for (const { obj, tableName } of entries) {
          try {
            await driver.syncSchema(tableName, obj);
            synced++;
          } catch (e: unknown) {
            reportSyncFailure(obj, tableName, driver.name, e);
          }
        }
      }
    }

    // #4632 — never claim "complete" over a pass that lost DDL. The old line
    // logged `info: Schema sync complete` after any number of failures, which
    // is the "looks normal" half of the accident: the only honest summary of a
    // pass with failures is an error.
    if (failed > 0) {
      ctx.logger.error(
        `Schema sync finished with ${failed} FAILED object(s) — those objects are registered and served but their storage was ` +
          `never created or altered; writes to them are not durable. See the per-object errors above for the driver failure and the fix.`,
        undefined,
        { synced, skipped, failed, total: allObjects.length },
      );
    } else if (synced > 0 || skipped > 0) {
      ctx.logger.info('Schema sync complete', { synced, skipped, total: allObjects.length });
    }
  }

  /**
   * Restore persisted metadata from the database (sys_metadata) on startup.
   *
   * Calls `protocol.loadMetaFromDb()` to bulk-load all active metadata
   * records (objects, views, apps, etc.) into the in-memory SchemaRegistry.
   * This closes the persistence loop so that user-created schemas survive
   * kernel cold starts and redeployments.
   *
   * Gracefully degrades when:
   * - The protocol service is unavailable (e.g., in-memory-only mode).
   * - `loadMetaFromDb` is not implemented by the protocol shim.
   * - The underlying driver/table does not exist yet (first-run scenario).
   *
   * [#5897, ADR-0110 D3] Degrading is not the same as being fine, and this
   * method used to be unable to say which one happened: `loadMetaFromDb`
   * answered an unreachable database and an empty one with the same
   * `loaded: 0`, so a boot that restored nothing because it could not read
   * `sys_metadata` logged `debug` "No persisted metadata found in database"
   * and the kernel reported ready. `storeUnavailable` now carries that
   * distinction, and the outage branch logs at `error` per AGENTS.md
   * "Degradation log levels" — runtime state silently disagreeing with
   * persisted state, while the system keeps looking healthy, is exactly the
   * class that rule reserves `error` for. Control flow is unchanged: boot
   * still continues in the degraded state (refusing to boot on an unreadable
   * overlay store would turn a transient outage into an outright outage),
   * it just no longer claims that state is health.
   */
  private async restoreMetadataFromDb(ctx: PluginContext): Promise<void> {
    // Phase 1: Resolve protocol service (separate from DB I/O for clearer diagnostics)
    let protocol: ProtocolWithDbRestore;
    try {
      const service = ctx.getService('protocol');
      if (!service || !hasLoadMetaFromDb(service)) {
        ctx.logger.debug('Protocol service does not support loadMetaFromDb, skipping DB restore');
        return;
      }
      protocol = service;
    } catch (e: unknown) {
      ctx.logger.debug('Protocol service unavailable, skipping DB restore', {
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    // Phase 2: DB hydration (loads into SchemaRegistry)
    try {
      const { loaded, errors, invalid = 0, storeUnavailable = false } = await protocol.loadMetaFromDb();

      if (storeUnavailable) {
        // #5897 — FIRST branch on purpose: "we could not read the store" out-
        // ranks any count taken from a read that did not happen. The line owes
        // the two things AGENTS.md requires of a durability `error` — the
        // concrete consequence, and the fix.
        ctx.logger.error(
          'sys_metadata could NOT be read at boot — persisted metadata was NOT restored, and this kernel will keep reporting healthy. ' +
            'Every overlay object, view, app, permission and hook stored in the database is absent from the SchemaRegistry for the life of this process: ' +
            'registry lookups answer "not declared" rather than "unavailable", so unknown-column query guards, hooks and relationships silently degrade, ' +
            'and overlay objects get neither a synced table nor a metadata bridge. Authoring against this kernel writes on top of state it never loaded. ' +
            'Fix: check the datasource behind sys_metadata — connection, credentials, and that the table exists — then restart. ' +
            'A store that merely has not been provisioned yet is NOT this case; that first-boot path stays quiet.',
          // `Logger.error(message, error?: Error, meta?)` — the error slot is
          // genuinely empty here: `loadMetaFromDb` swallows the driver error
          // and returns only the verdict, having already printed the driver's
          // own text at `warn` (`[Protocol] DB hydration skipped: …`). Passing
          // the counts in the declared meta slot rather than the error slot,
          // per the contract in `@objectstack/spec/contracts`.
          undefined,
          { loaded, errors, invalid },
        );
      } else if (loaded > 0 || errors > 0) {
        // `invalid` (#3903): rows registered despite failing the current spec
        // schema AFTER the stored conversion chain — each already warned with
        // `[metadata_spec_invalid]` and carries `_diagnostics` on read.
        ctx.logger.info('Metadata restored from database to SchemaRegistry', { loaded, errors, invalid });
      } else {
        // Reachable store, nothing in it — the ordinary empty/first-boot case.
        ctx.logger.debug('No persisted metadata found in database');
      }
    } catch (e: unknown) {
      // Non-fatal: first-run or in-memory driver may not have sys_metadata yet
      ctx.logger.debug('DB metadata restore failed (non-fatal)', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Bridge all SchemaRegistry objects to the metadata service.
   *
   * This ensures objects registered by plugins and loaded from sys_metadata
   * are visible to AI tools and other consumers that query IMetadataService.
   *
   * Runs after both restoreMetadataFromDb() and syncRegisteredSchemas() to
   * catch all objects in the SchemaRegistry regardless of their source.
   *
   * Registers with `{ notify: false }`: this bridge copies objects OUT of the
   * SchemaRegistry, so announcing would feed our own `subscribe('object')`
   * handler right back into the registry the definitions came from. That is
   * not merely redundant — the handler re-registers under
   * `_packageId ?? 'metadata-service'`, so every bridged object whose body
   * carries no `_packageId` would have its true package provenance
   * overwritten with 'metadata-service'. Nothing is stale either: the
   * registry is the source here, and it already holds what we just copied.
   */
  private async bridgeObjectsToMetadataService(ctx: PluginContext): Promise<void> {
    try {
      const metadataService = ctx.getService<IMetadataService>('metadata');
      if (!metadataService || typeof metadataService.register !== 'function') {
        ctx.logger.debug('Metadata service unavailable for bridging, skipping');
        return;
      }

      if (!this.ql?.registry) {
        ctx.logger.debug('SchemaRegistry unavailable for bridging, skipping');
        return;
      }

      const objects = this.ql.registry.getAllObjects();
      let bridged = 0;

      for (const obj of objects) {
        try {
          // Check if object is already in metadata service to avoid duplicates
          const existing = await metadataService.getObject(obj.name);
          if (!existing) {
            // Register object that exists in SchemaRegistry but not in metadata service
            await metadataService.register('object', obj.name, obj, { notify: false });
            bridged++;
          }
        } catch (e: unknown) {
          ctx.logger.debug('Failed to bridge object to metadata service', {
            object: obj.name,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (bridged > 0) {
        ctx.logger.info('Bridged objects from SchemaRegistry to metadata service', {
          count: bridged,
          total: objects.length
        });
      } else {
        ctx.logger.debug('No objects needed bridging (all already in metadata service)');
      }
    } catch (e: unknown) {
      ctx.logger.debug('Failed to bridge objects to metadata service', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Bridge ONE manifest's objects into the metadata service — the
   * late-registration companion to {@link bridgeObjectsToMetadataService}.
   *
   * The one-shot startup bridge runs exactly once during `start()`, but
   * manifests keep arriving after that: marketplace install and ledger
   * rehydrate register through the `manifest` service on `kernel:ready` (or
   * an HTTP request), so their objects landed in the SchemaRegistry only and
   * every IMetadataService consumer (AI describe_object, Studio object
   * lists, `metadata.listObjects`) missed them. This bridges exactly the
   * objects the given manifest contributes, resolved through the registry so
   * both `objects` forms (array / name-keyed map) and extension merges come
   * out canonical, with `_packageId` stamped.
   *
   * The metadata service is resolved at CALL time, never captured at init:
   * when this plugin inits, MetadataPlugin may not have registered it yet.
   *
   * Existing same-name entries are left alone UNLESS they carry the same
   * `_packageId` — i.e. they are this bridge's own copy from a previous
   * version of the same package. That keeps a hot marketplace upgrade fresh
   * while never clobbering an authored / artifact-parsed definition.
   *
   * Registers `{ notify: false }` for the same reason as the startup bridge
   * (#3112 notify contract): these definitions come OUT of the
   * SchemaRegistry, so announcing would feed our own `subscribe('object')`
   * handler right back into the registry and overwrite the objects' true
   * package provenance with 'metadata-service'.
   *
   * Never throws — a bridge failure must not fail the install that
   * triggered it.
   */
  private async bridgeManifestObjectsToMetadataService(
    ctx: PluginContext,
    manifest: any,
  ): Promise<void> {
    if (!this.bridgeLateManifests) return;
    const packageId = manifest?.id || manifest?.name;
    if (!packageId || !this.ql?.registry) return;

    try {
      let metadataService: IMetadataService | undefined;
      try {
        metadataService = ctx.getService<IMetadataService>('metadata');
      } catch {
        return; // no metadata service on this kernel — nothing to bridge into
      }
      if (!metadataService || typeof metadataService.register !== 'function') return;

      const objects = this.ql.registry.getAllObjects(packageId);
      let bridged = 0;

      for (const obj of objects) {
        try {
          const existing = await metadataService.getObject(obj.name);
          const ownPreviousCopy =
            existing != null &&
            (obj as any)._packageId !== undefined &&
            (existing as any)._packageId === (obj as any)._packageId;
          if (!existing || ownPreviousCopy) {
            await metadataService.register('object', obj.name, obj, { notify: false });
            bridged++;
          }
        } catch (e: unknown) {
          ctx.logger.debug('Failed to bridge manifest object to metadata service', {
            package: packageId,
            object: obj.name,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (bridged > 0) {
        ctx.logger.info('Bridged late-registered manifest objects to metadata service', {
          package: packageId,
          count: bridged,
        });
      }
    } catch (e: unknown) {
      ctx.logger.debug('Failed to bridge manifest objects to metadata service', {
        package: packageId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * True when a hook of this name is shipped by an installed CODE package —
   * i.e. the SchemaRegistry holds a composite (`<packageId>:<name>`) artifact
   * entry for it (registered by `registerApp` / the artifact loader). Those
   * hooks are bound by AppPlugin under `app:<appId>` with an explicit
   * bodyRunner + functions map, so every OTHER bind path must skip them or
   * they execute twice per event.
   *
   * Runtime-authored hooks — including ones published INTO a runtime-created
   * package (their sys_metadata row carries a `package_id`) — have no
   * artifact entry and are NOT matched. `getArtifactItem` is immune to
   * plain-key overlay shadows, so an authored customization of a packaged
   * hook classifies as artifact-shipped (the packaged version stays the one
   * that runs — same artifact-wins rule as ADR-0010 lock resolution).
   */
  private isArtifactShippedHook(name: unknown): boolean {
    if (typeof name !== 'string' || name.length === 0) return false;
    const registry: any = this.ql?.registry;
    if (!registry || typeof registry.getArtifactItem !== 'function') return false;
    return registry.getArtifactItem('hook', name) !== undefined;
  }

  /**
   * Once-per-process dedupe for stored-row conversion notices — resyncs are
   * event-driven, so a legacy row would otherwise re-warn on every publish.
   */
  private storedConversionWarned = new Set<string>();

  /**
   * Canonicalize a `sys_metadata` body read directly by this plugin (#3903).
   *
   * The authored-hook/-action re-syncs read the table themselves (they must —
   * env-scoped kernels surface these rows nowhere else), which makes them
   * stored-metadata rehydration seams: the full ADR-0087 chain replays here,
   * exactly like `protocol.loadMetaFromDb` / `getMetaItems`, so the engine's
   * runner and dispatch only ever see canonical shapes (e.g. a pre-17 action
   * row's `execute` reads as `target`).
   */
  private convertStoredRow(ctx: PluginContext, type: string, data: any): any {
    return applyConversionsToStoredItem(type, data, {
      onNotice: (n) => {
        const key = `${n.conversionId}|${type}|${String(data?.name ?? '')}`;
        if (this.storedConversionWarned.has(key)) return;
        this.storedConversionWarned.add(key);
        ctx.logger.warn(
          `[ObjectQLPlugin] stored ${type}/${String(data?.name ?? '<unnamed>')} carries a pre-protocol shape; ${n.message}`,
        );
      },
    });
  }

  /**
   * Read the ACTIVE runtime-authored hook rows from `sys_metadata`.
   *
   * Reads the table directly (like `protocol.getMetaItems` does) instead of
   * going through the metadata service, because (a) env-scoped kernels have
   * no DatabaseLoader so the service never surfaces these rows, and (b) rows
   * published from a Studio session are org-scoped — engine hooks fire
   * process-wide, so we take active rows across ALL organizations rather
   * than one org's overlay view.
   *
   * Returns `null` when the read failed (e.g. no sys_metadata table on this
   * kernel) — callers must treat that as "couldn't read", NOT "zero hooks",
   * so a failed read never tears down live bindings.
   */
  private async readAuthoredHookRows(ctx: PluginContext): Promise<any[] | null> {
    if (!this.ql) return null;
    try {
      // No environment filter: per ADR-0005 (revised 2026-05) each
      // environment has its own physical DB, so this kernel's sys_metadata
      // only ever holds its own rows (saveMetaItem no longer stamps
      // environment_id). Rows across ALL organizations are taken — engine
      // hooks fire process-wide, matching flow-trigger semantics.
      let rows: any[] = (await this.ql.find('sys_metadata', {
        where: { type: 'hook', state: 'active' },
      })) ?? [];
      if (rows.length === 0) {
        // Legacy plural rows — mirrors getMetaItems' singular/plural fallback.
        rows = (await this.ql.find('sys_metadata', {
          where: { type: 'hooks', state: 'active' },
        })) ?? [];
      }
      const hooks: any[] = [];
      for (const row of rows) {
        try {
          const data = this.convertStoredRow(
            ctx,
            'hook',
            typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
          );
          if (!data || typeof data !== 'object' || typeof data.name !== 'string') continue;
          // Surface the persisted package binding (parity with getMetaItems)
          // so provenance-aware consumers of the bound hook can read it.
          const recPkg = row.package_id ?? undefined;
          if (recPkg && data._packageId === undefined) data._packageId = recPkg;
          hooks.push(data);
        } catch {
          // Malformed row — skip it, keep the rest.
        }
      }
      return hooks;
    } catch (e: any) {
      ctx.logger.debug('[ObjectQLPlugin] authored-hook read from sys_metadata failed', {
        error: e?.message,
      });
      return null;
    }
  }

  /**
   * Serializes {@link resyncAuthoredHooks} runs. Mutation events, publishes,
   * and the boot sync can overlap; two interleaved read→bind sequences could
   * otherwise finish out of order and leave the OLDER snapshot bound.
   */
  private authoredHookResyncChain: Promise<void> = Promise.resolve();

  /**
   * (Re-)bind runtime-authored hooks into the execution pipeline (#2588).
   *
   * Serialized: overlapping calls queue behind each other so the last
   * completed bind always reflects the newest read.
   *
   * Sources, unioned by hook name (fresher DB row wins):
   *   1. `metadataService.loadMany('hook')` — the same view the boot bind in
   *      {@link loadMetadataFromService} consumed (covers FS-scanned hooks
   *      and, on platform kernels, the DatabaseLoader), re-read so the set
   *      reflects post-boot changes;
   *   2. active `sys_metadata` hook rows read directly — the ONLY source
   *      that surfaces Studio-authored hooks on env-scoped kernels.
   *
   * Package-artifact hooks are filtered out (bound by AppPlugin — see
   * {@link isArtifactShippedHook}). The result replaces the whole
   * `'metadata-service'` package set (`bindHooksToEngine` unregisters it
   * first), so this is idempotent: edited hooks re-bind with their new
   * definition and hooks whose rows were deleted tear down. Bodies execute
   * through the engine's default bodyRunner installed at boot by the
   * runtime's AppPlugin; when that runner is absent (e.g.
   * `OS_DISABLE_AUTHORED_HOOKS=1`) the binder skips bodies with a warning,
   * exactly as before.
   *
   * Best-effort: when BOTH sources are unavailable the resync is a no-op —
   * it never tears down live hooks on a failed read.
   */
  private resyncAuthoredHooks(ctx: PluginContext): Promise<void> {
    const run = this.authoredHookResyncChain.then(() => this.resyncAuthoredHooksNow(ctx));
    // The chain itself must never hold a rejection (it would poison every
    // later resync); callers still see the failure through `run`.
    this.authoredHookResyncChain = run.catch(() => undefined);
    return run;
  }

  private async resyncAuthoredHooksNow(ctx: PluginContext): Promise<void> {
    const ql: any = this.ql;
    if (!ql || typeof ql.bindHooks !== 'function') return;

    let serviceHooks: any[] | null = null;
    try {
      const metadataService = ctx.getService<IMetadataService>('metadata');
      if (metadataService && typeof metadataService.loadMany === 'function') {
        serviceHooks = (await metadataService.loadMany('hook')) ?? [];
      }
    } catch {
      serviceHooks = null; // no metadata service on this kernel
    }

    const authoredHooks = await this.readAuthoredHookRows(ctx);
    if (serviceHooks === null && authoredHooks === null) return; // nothing readable — keep current bindings

    const byName = new Map<string, any>();
    for (const h of serviceHooks ?? []) {
      if (h && typeof h.name === 'string') byName.set(h.name, h);
    }
    for (const h of authoredHooks ?? []) {
      if (h && typeof h.name === 'string') byName.set(h.name, h);
    }

    const bindable = Array.from(byName.values()).filter(
      (h) => !this.isArtifactShippedHook(h.name),
    );
    if (bindable.length === 0) {
      // bindHooksToEngine early-returns on an empty list BEFORE its
      // unregister step, so deleting the last authored hook would leave the
      // stale binding firing forever. Tear the package set down explicitly.
      if (typeof ql.unregisterHooksByPackage === 'function') {
        ql.unregisterHooksByPackage('metadata-service');
      }
    } else {
      ql.bindHooks(bindable, { packageId: 'metadata-service' });
    }
    ctx.logger.info('[ObjectQLPlugin] re-synced runtime-authored hooks', {
      bound: bindable.length,
      authoredRows: authoredHooks?.length ?? 0,
      artifactSkipped: byName.size - bindable.length,
    });
  }

  /**
   * Resolve the engine object key an action registers under. Standalone
   * `action` metadata declares `objectName` (spec `ActionSchema`); bundle
   * collectors attach `object`; object-less actions register under the
   * `'global'` key, matching AppPlugin's bundle registration.
   *
   * `'global'` is the CANONICAL object-less key (#3913) — not a wildcard.
   * `executeAction` is an exact-string `Map` lookup, so every reader has to
   * probe this literal; the runtime's `actionHandlerObjectKeys` does, and the
   * runtime's `standaloneActionObjectName` must stay in lockstep with this
   * method or the declaration the MCP surface resolves stops matching the
   * handler that actually runs.
   */
  private actionObjectKey(action: any): string {
    if (typeof action?.objectName === 'string' && action.objectName.length > 0) return action.objectName;
    if (typeof action?.object === 'string' && action.object.length > 0) return action.object;
    return 'global';
  }

  /**
   * True when an action of this name is shipped by an installed CODE
   * package — either as a standalone `action` artifact, or embedded in a
   * packaged object's `actions[]` array (the common `defineStack` shape).
   * Those handlers are registered by AppPlugin under `app:<appId>` with its
   * own runner, and `engine.registerAction` REPLACES by `<object>:<name>`
   * key — so re-registering here would clobber the packaged handler with a
   * metadata copy. Artifact-wins, same rule as {@link isArtifactShippedHook}.
   */
  private isArtifactShippedAction(action: any): boolean {
    const name = action?.name;
    if (typeof name !== 'string' || name.length === 0) return false;
    const registry: any = this.ql?.registry;
    if (!registry || typeof registry.getArtifactItem !== 'function') return false;
    if (registry.getArtifactItem('action', name) !== undefined) return true;
    const objectKey = this.actionObjectKey(action);
    if (objectKey !== 'global') {
      const artifactObject: any = registry.getArtifactItem('object', objectKey);
      if (Array.isArray(artifactObject?.actions)
          && artifactObject.actions.some((a: any) => a?.name === name)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Read the ACTIVE runtime-authored action definitions from `sys_metadata`.
   *
   * Two authoring shapes both land here (and both are dead without this
   * re-sync — #2605 item 1):
   *   1. standalone `action` rows (the Studio's Action editor / PUT
   *      `/meta/action/:name`), plus legacy plural `actions` rows;
   *   2. actions EMBEDDED in authored `object` rows' `actions[]` — the
   *      object-editor path. The object schema itself is read live, but the
   *      handler still needs registering.
   *
   * Same read discipline as {@link readAuthoredHookRows}: direct table read
   * (env-scoped kernels surface authored rows nowhere else), all
   * organizations (engine actions are process-wide), `null` on a failed
   * read so callers never tear down live registrations on an error.
   */
  private async readAuthoredActionRows(ctx: PluginContext): Promise<any[] | null> {
    if (!this.ql) return null;
    const parseRow = (row: any, type: string): any | undefined => {
      try {
        const data = this.convertStoredRow(
          ctx,
          type,
          typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
        );
        if (!data || typeof data !== 'object') return undefined;
        const recPkg = row.package_id ?? undefined;
        if (recPkg && data._packageId === undefined) data._packageId = recPkg;
        return data;
      } catch {
        return undefined; // malformed row — skip it, keep the rest
      }
    };
    try {
      let rows: any[] = (await this.ql.find('sys_metadata', {
        where: { type: 'action', state: 'active' },
      })) ?? [];
      if (rows.length === 0) {
        rows = (await this.ql.find('sys_metadata', {
          where: { type: 'actions', state: 'active' },
        })) ?? [];
      }
      const actions: any[] = [];
      for (const row of rows) {
        const data = parseRow(row, 'action');
        if (data && typeof data.name === 'string') actions.push(data);
      }

      // Embedded shape: authored object rows may carry their own actions.
      // Converting the OBJECT row canonicalizes the embedded actions too —
      // the chain's action walker covers `objects[].actions[]`.
      const objectRows: any[] = (await this.ql.find('sys_metadata', {
        where: { type: 'object', state: 'active' },
      })) ?? [];
      for (const row of objectRows) {
        const obj = parseRow(row, 'object');
        if (!obj || typeof obj.name !== 'string' || !Array.isArray(obj.actions)) continue;
        for (const action of obj.actions) {
          if (!action || typeof action !== 'object' || typeof action.name !== 'string') continue;
          const copy = { ...action };
          if (typeof copy.object !== 'string' && typeof copy.objectName !== 'string') {
            copy.object = obj.name;
          }
          if (obj._packageId && copy._packageId === undefined) copy._packageId = obj._packageId;
          actions.push(copy);
        }
      }
      return actions;
    } catch (e: any) {
      ctx.logger.debug('[ObjectQLPlugin] authored-action read from sys_metadata failed', {
        error: e?.message,
      });
      return null;
    }
  }

  /**
   * Serializes {@link resyncAuthoredActions} runs — same rationale as
   * {@link authoredHookResyncChain}: overlapping read→register sequences
   * must not finish out of order and leave the older snapshot registered.
   */
  private authoredActionResyncChain: Promise<void> = Promise.resolve();

  /**
   * [ADR-0110 D5] Fingerprint of the last governance report, so a
   * `metadata:reloaded` that changed nothing action-related does not repeat
   * the same warning verbatim.
   */
  private lastGovernanceFingerprint = '';

  /**
   * [ADR-0110 D5] Audit the engine's action-handler registry against the
   * declarations it can dispatch for, and warn about the orphans on both
   * sides. Runs at `kernel:ready` (after {@link resyncAuthoredActions}, so
   * the registry is final for the boot) and again on `metadata:reloaded`.
   *
   * This is the checklist that makes D3's hard refusal a migration step
   * instead of a mystery: every handler listed here answers 404 at dispatch,
   * and the message says which `defineAction` fixes it. It lives on the
   * ENGINE plugin deliberately — AppPlugin hosted it first and is registered
   * conditionally, so the platform's own `os dev` path never printed it.
   *
   * Warn-only, exception-proof (the runner swallows its own failures): a
   * diagnostic must never be the reason a kernel fails to boot.
   */
  private async runGovernanceInventory(ctx: PluginContext): Promise<void> {
    const ql: any = this.ql;
    if (!ql || typeof ql.listRegisteredActions !== 'function') return;
    let loadStandaloneActions: (() => Promise<any[]>) | undefined;
    try {
      const meta = ctx.getService<IMetadataService>('metadata');
      const loadMany = meta?.loadMany;
      if (meta && typeof loadMany === 'function') {
        loadStandaloneActions = () => loadMany.call(meta, 'action');
      }
    } catch { /* no metadata service — registry objects still audit */ }
    this.lastGovernanceFingerprint = await runActionGovernanceInventory({
      registered: ql.listRegisteredActions(),
      objects: (() => { try { return ql.registry?.getAllObjects?.() ?? []; } catch { return []; } })(),
      loadStandaloneActions,
      logger: ctx.logger,
      lastFingerprint: this.lastGovernanceFingerprint,
    });
  }

  /**
   * (Re-)register runtime-authored actions on the engine (#2605 item 1 —
   * the action-path parallel of {@link resyncAuthoredHooks}).
   *
   * Both action dispatch surfaces (`POST /api/v1/actions/:object/:action`
   * and the MCP `run_action` bridge) resolve handlers through
   * `engine.executeAction`, whose map was only ever populated from the app
   * bundle at boot — a published `action` row was stored + listed but never
   * executable, before OR after a restart.
   *
   * Sources, unioned by `<object>:<name>` (fresher DB row wins):
   *   1. `metadataService.loadMany('action')` — FS-scanned action items;
   *   2. authored `sys_metadata` rows (standalone AND object-embedded) via
   *      {@link readAuthoredActionRows}.
   *
   * Package-artifact actions are filtered out (AppPlugin registers those
   * under `app:<appId>`; registerAction replaces by key, so re-registering
   * would clobber them). Handlers are built through the engine's default
   * action runner installed at boot by the runtime's AppPlugin; when that
   * runner is absent (e.g. `OS_DISABLE_AUTHORED_ACTIONS=1`, or a bare
   * engine without the runtime) bodies are skipped with a warning. Bodyless
   * actions (target-bound script / flow / url) register nothing here —
   * their dispatch is either code (registered by the app) or the flow
   * runner, not a metadata body.
   *
   * Idempotent: the whole `'metadata-service'` action set is torn down and
   * re-registered, so edits re-register and deleted rows unregister.
   * Best-effort: when BOTH sources are unreadable the resync is a no-op.
   */
  private resyncAuthoredActions(ctx: PluginContext): Promise<void> {
    const run = this.authoredActionResyncChain.then(() => this.resyncAuthoredActionsNow(ctx));
    // The chain must never hold a rejection (it would poison every later
    // resync); callers still see the failure through `run`.
    this.authoredActionResyncChain = run.catch(() => undefined);
    return run;
  }

  private async resyncAuthoredActionsNow(ctx: PluginContext): Promise<void> {
    const ql: any = this.ql;
    if (!ql
        || typeof ql.registerAction !== 'function'
        || typeof ql.removeActionsByPackage !== 'function') {
      return;
    }

    let serviceActions: any[] | null = null;
    try {
      const metadataService = ctx.getService<IMetadataService>('metadata');
      if (metadataService && typeof metadataService.loadMany === 'function') {
        serviceActions = (await metadataService.loadMany('action')) ?? [];
      }
    } catch {
      serviceActions = null; // no metadata service on this kernel
    }

    const authoredActions = await this.readAuthoredActionRows(ctx);
    if (serviceActions === null && authoredActions === null) return; // nothing readable — keep current registrations

    const byKey = new Map<string, any>();
    for (const a of serviceActions ?? []) {
      if (a && typeof a.name === 'string') byKey.set(`${this.actionObjectKey(a)}:${a.name}`, a);
    }
    for (const a of authoredActions ?? []) {
      if (a && typeof a.name === 'string') byKey.set(`${this.actionObjectKey(a)}:${a.name}`, a);
    }

    const bindable = Array.from(byKey.values()).filter(
      (a) => !this.isArtifactShippedAction(a),
    );

    // Full replace: tear down the package set, then re-register survivors —
    // deleting the last authored action must unregister it.
    ql.removeActionsByPackage('metadata-service');

    // [#4251] The public accessor — this read used to reach the private
    // `_defaultActionRunner` field directly. Probed because `ql` can be a
    // test double that predates the accessor.
    const runner: any = typeof ql.getDefaultActionRunner === 'function'
      ? ql.getDefaultActionRunner()
      : undefined;
    let registered = 0;
    let skippedNoHandler = 0;
    for (const action of bindable) {
      if (typeof runner !== 'function') {
        skippedNoHandler++;
        continue;
      }
      let handler: any;
      try {
        handler = runner(action);
      } catch (e: any) {
        ctx.logger.warn('[ObjectQLPlugin] default action runner rejected an authored action', {
          action: action.name,
          error: e?.message,
        });
        continue;
      }
      if (typeof handler !== 'function') {
        skippedNoHandler++; // no body (target/flow/url action) or invalid body shape
        continue;
      }
      ql.registerAction(this.actionObjectKey(action), action.name, handler, 'metadata-service');
      registered++;
    }
    if (typeof runner !== 'function' && bindable.length > 0) {
      ctx.logger.warn(
        '[ObjectQLPlugin] authored actions present but no default action runner is installed '
        + '— their bodies will not execute (is the runtime AppPlugin booted, '
        + 'or is OS_DISABLE_AUTHORED_ACTIONS=1 set?)',
        { actions: bindable.slice(0, 5).map((a: any) => a.name) },
      );
    }
    ctx.logger.info('[ObjectQLPlugin] re-synced runtime-authored actions', {
      registered,
      authoredRows: authoredActions?.length ?? 0,
      artifactSkipped: byKey.size - bindable.length,
      skippedNoHandler,
    });
  }

  /**
   * Load metadata from external metadata service into ObjectQL registry
   * This enables ObjectQL to use file-based or remote metadata
   */
  private async loadMetadataFromService(metadataService: any, ctx: PluginContext) {
    ctx.logger.info('Syncing metadata from external service into ObjectQL registry...');
    
    // Metadata types to sync (ADR-0020: no `workflow` type — record state
    // machines are a `state_machine` validation rule on the object;
    // ADR-0088: no `function` kind — QL functions come from
    // `defineStack({ functions })` / plugin contributions, never metadata rows)
    const metadataTypes = ['object', 'view', 'app', 'flow', 'hook'];
    let totalLoaded = 0;
    
    for (const type of metadataTypes) {
        try {
            // Check if service has loadMany method
            if (typeof metadataService.loadMany === 'function') {
                const items = await metadataService.loadMany(type);

                if (items && items.length > 0) {
                    items.forEach((item: any) => {
                        // Determine key field (usually 'name' or 'id')
                        const keyField = item.id ? 'id' : 'name';
                        
                        // For objects, use the ownership-aware registration
                        if (type === 'object' && this.ql) {
                            // Objects are registered differently (ownership model)
                            // Skip for now - handled by app registration
                            return;
                        }
                        
                        // Register other types in the registry. Pass through
                        // the item's own source package id (stamped by the
                        // metadata plugin's artifact loader) so registerItem's
                        // applyProtection re-stamps _packageId/_provenance and
                        // GET /meta consumers can tell package-shipped items
                        // from user-authored ones. Items without _packageId
                        // (FS project files, runtime-authored rows) must stay
                        // unstamped — a synthetic id like 'metadata-service'
                        // would flip isArtifactBacked() and the two-tier write
                        // authorization for genuinely runtime-authored items.
                        if (this.ql?.registry?.registerItem) {
                            this.ql.registry.registerItem(type, item, keyField, item._packageId);
                        }
                    });

                    // Hooks need to be wired into the execution pipeline,
                    // not just stored in the registry. Funnel through the
                    // canonical binder so declarative semantics (condition,
                    // retry, timeout, async, onError, priority, packageId)
                    // are honoured uniformly with the AppPlugin path.
                    //
                    // Package-artifact hooks are EXCLUDED: AppPlugin already
                    // binds the same hooks (from the bundle) under
                    // `app:<appId>` WITH an explicit bodyRunner + functions
                    // map. Binding them here too used to be harmless only
                    // because this path had no bodyRunner (bodies were
                    // silently skipped); now that the engine carries a
                    // default runner (#2588) a second bind would execute
                    // every artifact hook twice per event.
                    if (type === 'hook' && this.ql && typeof (this.ql as any).bindHooks === 'function') {
                        const bindable = items.filter((h: any) => !this.isArtifactShippedHook(h?.name));
                        (this.ql as any).bindHooks(bindable, {
                            packageId: 'metadata-service',
                        });
                    }

                    totalLoaded += items.length;
                    ctx.logger.info(`Synced ${items.length} ${type}(s) from metadata service`);
                }
            }
        } catch (e: any) {
            // Type might not exist in metadata service - that's ok
            ctx.logger.debug(`No ${type} metadata found or error loading`, { 
                error: e.message 
            });
        }
    }
    
    if (totalLoaded > 0) {
        ctx.logger.info(`Metadata sync complete: ${totalLoaded} items loaded into ObjectQL registry`);
    }
  }
}
