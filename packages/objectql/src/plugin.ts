// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectQL } from './engine.js';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { Plugin, PluginContext } from '@objectstack/core';
import { StorageNameMapping } from '@objectstack/spec/system';
import {
  SysMetadataObject,
  SysMetadataHistoryObject,
  SysMetadataCommitObject,
  SysMetadataAuditObject,
  SysViewDefinitionObject,
} from '@objectstack/metadata-core';

export type { Plugin, PluginContext };

/**
 * Protocol extension for DB-based metadata hydration.
 * `loadMetaFromDb` is implemented by ObjectStackProtocolImplementation but
 * is NOT (yet) part of the canonical ObjectStackProtocol wire-contract in
 * `@objectstack/spec`, since it is a server-side bootstrap concern only.
 */
interface ProtocolWithDbRestore {
  loadMetaFromDb(): Promise<{ loaded: number; errors: number }>;
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
}

export class ObjectQLPlugin implements Plugin {
  name = 'com.objectstack.engine.objectql';
  type = 'objectql';
  version = '1.0.0';
  /**
   * Schema sync to remote SQL DBs is latency-bound (one round-trip per
   * table × 2 phases). Default to 120s instead of the kernel's 30s so
   * cold Neon/Turso starts don't get killed mid-sync.
   */
  startupTimeout = 120_000;

  private ql: ObjectQL | undefined;
  private hostContext?: Record<string, any>;
  private environmentId?: string;
  private skipSchemaSync = false;
  private hydrateMetadataFromDb = false;
  /** Unsubscribe handles for metadata-event subscriptions (ADR-0008 PR-7). */
  private metadataUnsubscribes: Array<() => void> = [];

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
    if (typeof opts.startupTimeout === 'number' && opts.startupTimeout > 0) {
      this.startupTimeout = opts.startupTimeout;
    }
    this.skipSchemaSync =
      typeof opts.skipSchemaSync === 'boolean'
        ? opts.skipSchemaSync
        : process.env.OS_SKIP_SCHEMA_SYNC === '1';
    this.hydrateMetadataFromDb = opts.hydrateMetadataFromDb === true;
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
      }
    });

    ctx.logger.info('ObjectQL engine registered', {
        services: ['objectql', 'data', 'manifest'],
    });

    // Register the metadata-storage objects this engine's own protocol reads
    // and writes — `sys_metadata` (loadMetaFromDb / getMetaItems / saveMetaItem),
    // its history/audit siblings, and `sys_view_definition`. Doing it here
    // guarantees their tables get schema-synced in start() even when no
    // MetadataPlugin is present (e.g. standalone "host config" apps, where the
    // CLI auto-registers a bare ObjectQLPlugin and nothing else owns these
    // tables → "no such table: sys_metadata" on every read).
    //
    // Gated on `environmentId === undefined` — the SAME condition that gates
    // `restoreMetadataFromDb` below: platform / standalone kernels own their
    // local sys_metadata, whereas per-project (cloud) kernels source metadata
    // from the control plane and must NOT provision these tables locally.
    // Definitions live in @objectstack/metadata-core (shared by this protocol
    // and the metadata layer's DatabaseLoader). registerApp is idempotent, so
    // a MetadataPlugin that also registers them is harmless.
    if (this.environmentId === undefined) {
      this.ql.registerApp({
        id: 'com.objectstack.metadata-objects',
        name: 'Metadata Platform Objects',
        version: '1.0.0',
        type: 'plugin',
        scope: 'system',
        objects: [
          SysMetadataObject,
          SysMetadataHistoryObject,
          SysMetadataCommitObject,
          SysMetadataAuditObject,
          SysViewDefinitionObject,
        ],
      });
    }

    // Register Protocol Implementation
    const protocolShim = new ObjectStackProtocolImplementation(
      this.ql,
      () => ctx.getServices ? ctx.getServices() : new Map(),
      undefined,
      this.environmentId,
    );

    ctx.registerService('protocol', protocolShim);
    ctx.logger.info('Protocol service registered');

    // ── Runtime-authored hook/action rebind on authoring (#2588, #2605) ──
    // The protocol is the ONE choke point every metadata-authoring surface
    // funnels through (rest-server PUT /meta, dispatcher, publish-drafts, AI
    // builders). When a `hook` or `action` row lands (direct-active save,
    // publish) or is deleted, re-sync the authored set so the change is live
    // without a restart. Draft saves are skipped — drafts are not live by
    // design. Fire-and-forget: a resync failure is logged, never fails the
    // write.
    if (typeof (protocolShim as any).onMetadataMutation === 'function') {
      const unsubscribe = (protocolShim as any).onMetadataMutation(
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

    // Register an `analytics` service adapter that maps the dispatcher's
    // expected interface (query / getMeta / generateSql) onto the
    // protocol shim's `analyticsQuery`. Without this, HttpDispatcher's
    // `handleAnalytics` cannot resolve a service and `/api/v1/analytics/*`
    // returns ROUTE_NOT_FOUND, even though discovery advertises the route
    // (objectql's getDiscovery hardcodes `analytics: enabled:true`). The
    // adapter delegates `query` to the cube → engine.aggregate translator
    // already implemented in protocol.ts; getMeta/generateSql return a
    // structured "not implemented" payload so callers see something
    // useful instead of a 500.
    ctx.registerService('analytics', {
      // HttpDispatcher passes the raw POST body (AnalyticsQuery shape:
      // `{ cube, measures, dimensions, where?, filters?, ... }`). The
      // protocol shim's `analyticsQuery` expects the wrapped envelope
      // `{ cube, query }` and destructures `request.query` for dims /
      // measures. Reshape here so the destructure resolves to the
      // analytics query instead of `undefined` (which caused
      // "Cannot read properties of undefined (reading 'dimensions')").
      //
      // `analyticsQuery` also returns its own `{ success, data: { rows,
      // fields } }` envelope. HttpDispatcher wraps service responses
      // again with `success(result)`, so without unwrapping here the
      // client sees `{success, data:{success, data:{rows, fields}}}` —
      // KPI widgets read `data.rows` and silently get nothing. Unwrap
      // to the inner `{ rows, fields }` payload so a single wrap from
      // the dispatcher yields the canonical shape.
      query: async (body: any) => {
        const envelope = body && typeof body === 'object' && 'query' in body && 'cube' in body
          ? body
          : { cube: body?.cube, query: body };
        const result = await protocolShim.analyticsQuery(envelope);
        // Unwrap an inner `{ success, data }` envelope (one level only).
        if (result && typeof result === 'object' && 'success' in result && 'data' in result) {
          return (result as any).data;
        }
        return result;
      },
      getMeta: async () => ({
        cubes: [],
        message: 'Analytics meta endpoint not implemented by ObjectQL adapter',
      }),
      generateSql: async (_body: any) => ({
        sql: null,
        message: 'Analytics SQL generation not implemented by ObjectQL adapter',
      }),
    });
  }

  start = async (ctx: PluginContext) => {
    ctx.logger.info('ObjectQL engine starting...');

    // Sync from external metadata service (e.g. MetadataPlugin) if available
    try {
        const metadataService = ctx.getService('metadata') as any;
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
        await this.resyncAuthoredHooks(ctx);
        await this.resyncAuthoredActions(ctx);
    });
    ctx.hook('metadata:reloaded', async () => {
        await this.resyncAuthoredHooks(ctx);
        await this.resyncAuthoredActions(ctx);
    });

    // Discover features from Kernel Services
    if (ctx.getServices && this.ql) {
        const services = ctx.getServices();
        for (const [name, service] of services.entries()) {
            if (name.startsWith('driver.')) {
                 // Register Driver
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
  }

  stop = async (ctx: PluginContext) => {
    // ADR-0008 PR-7: tear down metadata subscriptions on plugin stop so
    // tests don't leak watchers and reloaded plugins don't double-subscribe.
    for (const unsub of this.metadataUnsubscribes) {
      try { unsub(); } catch (e: any) {
        ctx.logger.debug('[ObjectQLPlugin] metadata-event unsubscribe failed', { error: e?.message });
      }
    }
    this.metadataUnsubscribes = [];
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
        const fresh = typeof metadataService.get === 'function'
          ? await metadataService.get('object', name)
          : undefined;
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
            'own',
          );
          ctx.logger.info('[ObjectQLPlugin] object metadata updated — registry refreshed', {
            name,
            packageId,
          });
        } else {
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
      if (isInsert) {
        record.created_at = record.created_at ?? now;
      }
      record.updated_at = now;
      if (session?.userId) {
        if (isInsert && hasField(objectName, 'created_by')) {
          record.created_by = record.created_by ?? session.userId;
        }
        if (hasField(objectName, 'updated_by')) {
          record.updated_by = session.userId;
        }
      }
      if (isInsert && session?.tenantId && hasField(objectName, 'tenant_id')) {
        record.tenant_id = record.tenant_id ?? session.tenantId;
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
      {
        name: 'sys_fetch_previous_update',
        object: '*',
        events: ['beforeUpdate'],
        priority: 5,
        description: 'Auto-fetch the previous record for update hooks',
        handler: async (hookCtx: any) => {
          if (hookCtx.input?.id && !hookCtx.previous) {
            try {
              const existing = await this.ql!.findOne(hookCtx.object, {
                where: { id: hookCtx.input.id },
                context: {
                  roles: [],
                  permissions: [],
                  isSystem: true,
                  ...(hookCtx.transaction ? { transaction: hookCtx.transaction } : {}),
                } as any,
              });
              if (existing) hookCtx.previous = existing;
            } catch (_e) {
              // Non-fatal: some objects may not support findOne
            }
          }
        },
      },
      {
        name: 'sys_fetch_previous_delete',
        object: '*',
        events: ['beforeDelete'],
        priority: 5,
        description: 'Auto-fetch the previous record for delete hooks',
        handler: async (hookCtx: any) => {
          if (hookCtx.input?.id && !hookCtx.previous) {
            try {
              const existing = await this.ql!.findOne(hookCtx.object, {
                where: { id: hookCtx.input.id },
                context: {
                  roles: [],
                  permissions: [],
                  isSystem: true,
                  ...(hookCtx.transaction ? { transaction: hookCtx.transaction } : {}),
                } as any,
              });
              if (existing) hookCtx.previous = existing;
            } catch (_e) {
              // Non-fatal
            }
          }
        },
      },
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

    ctx.logger.debug('Audit hooks registered via binder (created_by/updated_by, previousData)');
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

    // Group objects by driver for potential batch optimization
    const driverGroups = new Map<any, Array<{ obj: any; tableName: string }>>();

    for (const obj of allObjects) {
      const driver = this.ql.getDriverForObject(obj.name);
      if (!driver) {
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
          // Fallback: sequential sync for this driver's objects
          for (const { obj, tableName } of entries) {
            try {
              await driver.syncSchema(tableName, obj);
              synced++;
            } catch (seqErr: unknown) {
              ctx.logger.warn('Failed to sync schema for object', {
                object: obj.name,
                tableName,
                driver: driver.name,
                error: seqErr instanceof Error ? seqErr.message : String(seqErr),
              });
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
            ctx.logger.warn('Failed to sync schema for object', {
              object: obj.name,
              tableName,
              driver: driver.name,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }
    }

    if (synced > 0 || skipped > 0) {
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
      const { loaded, errors } = await protocol.loadMetaFromDb();

      if (loaded > 0 || errors > 0) {
        ctx.logger.info('Metadata restored from database to SchemaRegistry', { loaded, errors });
      } else {
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
   */
  private async bridgeObjectsToMetadataService(ctx: PluginContext): Promise<void> {
    try {
      const metadataService = ctx.getService<any>('metadata');
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
            await metadataService.register('object', obj.name, obj);
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
          const data = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
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
      const metadataService = ctx.getService('metadata') as any;
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
   * `'global'` wildcard key, matching AppPlugin's bundle registration.
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
    const parseRow = (row: any): any | undefined => {
      try {
        const data = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
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
        const data = parseRow(row);
        if (data && typeof data.name === 'string') actions.push(data);
      }

      // Embedded shape: authored object rows may carry their own actions.
      const objectRows: any[] = (await this.ql.find('sys_metadata', {
        where: { type: 'object', state: 'active' },
      })) ?? [];
      for (const row of objectRows) {
        const obj = parseRow(row);
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
      const metadataService = ctx.getService('metadata') as any;
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

    const runner: any = ql._defaultActionRunner;
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
    // machines are a `state_machine` validation rule on the object)
    const metadataTypes = ['object', 'view', 'app', 'flow', 'function', 'hook'];
    let totalLoaded = 0;
    
    for (const type of metadataTypes) {
        try {
            // Check if service has loadMany method
            if (typeof metadataService.loadMany === 'function') {
                const items = await metadataService.loadMany(type);

                if (items && items.length > 0) {
                    // Functions arrive as JSON-safe records ({name, handler})
                    // where `handler` is a function reference or compiled code
                    // already attached by the metadata pipeline. Register them
                    // BEFORE binding hooks so string-named hook handlers can
                    // resolve.
                    if (type === 'function' && this.ql && typeof (this.ql as any).registerFunction === 'function') {
                        for (const item of items) {
                            if (item?.name && typeof item.handler === 'function') {
                                (this.ql as any).registerFunction(item.name, item.handler, 'metadata-service');
                            }
                        }
                    }

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
