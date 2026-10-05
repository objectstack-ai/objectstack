// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { MetadataProtocol } from '@objectstack/spec/api';
import type { IDataEngine, IntrospectedSchema } from '@objectstack/spec/contracts';
import {
  ExternalDatasourceService,
  type ExternalDatasourceServiceConfig,
  type DatasourceLike,
  type ObjectLike,
  type Logger,
} from './external-datasource-service.js';

// The structural `DataEngineLike` re-declaration that used to live here is
// DELETED (#11493, part of the fix by the maintainer ruling): the `'data'`
// service's real contract (`IDataEngine`, `@objectstack/spec/contracts`) now
// declares `introspectDatasource?` with the spec return type, so this plugin
// no longer needs a private engine type to recover `IntrospectedSchema` from
// an untyped `Promise`. Its second member, `getDatasourceDriver?`, matched NO
// engine in either repository (measured 2026-08-24: zero references outside
// this file) — the fallback branch below probed it and could never fire. The
// probe is respelled to the member the contract actually declares
// (`getDriverByName?`, [#4251]), which makes the degradation reachable for
// the first time instead of silently dead.

interface MetadataServiceLike {
  get: (type: string, name: string) => Promise<unknown>;
  getObject?: (name: string) => Promise<unknown>;
  listObjects?: () => Promise<unknown[]>;
  list?: (type: string) => Promise<unknown[]>;
  register?: (type: string, name: string, data: unknown) => Promise<void> | void;
}

/** The metadata door's save, as the `'protocol'` service declares it. */
type MetadataSaveDoor = Pick<MetadataProtocol, 'saveMetaItem'>;

export interface ExternalDatasourceServicePluginOptions {
  /** Override the introspection function (mainly for tests). */
  introspect?: (datasource: string) => Promise<IntrospectedSchema>;
  logger?: Logger;
}

/**
 * ExternalDatasourceServicePlugin — registers `IExternalDatasourceService`
 * into the kernel as the `'external-datasource'` service (ADR-0015 §6.1).
 *
 * It bridges the decoupled {@link ExternalDatasourceService} to the live
 * `IDataEngine` (for driver introspection) and `IMetadataService` (for object
 * + datasource reads).
 */
export class ExternalDatasourceServicePlugin implements Plugin {
  name = 'com.objectstack.service-external-datasource';
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['external-datasource'];
  version = '1.0.0';
  type = 'standard' as const;
  dependencies: string[] = [];

  private service?: ExternalDatasourceService;
  private readonly options: ExternalDatasourceServicePluginOptions;

  constructor(options: ExternalDatasourceServicePluginOptions = {}) {
    this.options = options;
  }

  async init(ctx: PluginContext): Promise<void> {
    const engine = safeGetService<IDataEngine>(ctx, 'data');
    const metadata = safeGetService<MetadataServiceLike>(ctx, 'metadata');

    const introspect: ExternalDatasourceServiceConfig['introspect'] =
      this.options.introspect ??
      (async (datasource: string) => {
        if (engine?.introspectDatasource) return engine.introspectDatasource(datasource);
        const driver = engine?.getDriverByName?.(datasource);
        if (driver?.introspectSchema) return driver.introspectSchema();
        throw new Error(
          `Cannot introspect datasource '${datasource}': no driver introspection available.`,
        );
      });

    /**
     * [#21788] The metadata door's own save: `saveMetaItem` on the `'protocol'`
     * service, the call `PUT /api/v1/meta/object/:name` makes.
     *
     * Resolved where it is used, never at `init()`: the protocol registers in
     * another plugin's `init()`, which may run after this one, and a verdict
     * drawn here would be kept for the life of the process (AGENTS.md, "Startup
     * registry reads").
     */
    const metadataSaveDoor = (): MetadataSaveDoor | undefined => {
      const protocol = safeGetService<Partial<MetadataSaveDoor>>(ctx, 'protocol');
      return typeof protocol?.saveMetaItem === 'function' ? (protocol as MetadataSaveDoor) : undefined;
    };

    const config: ExternalDatasourceServiceConfig = {
      introspect,
      getDatasource: async (n) => (await metadata?.get('datasource', n)) as DatasourceLike | undefined,
      getObject: async (n) =>
        (metadata?.getObject ? await metadata.getObject(n) : await metadata?.get('object', n)) as ObjectLike | undefined,
      listObjects: async () =>
        ((metadata?.listObjects
          ? await metadata.listObjects()
          : await metadata?.list?.('object')) ?? []) as ObjectLike[],
      // Persist the refreshed snapshot as an `external_catalog` metadata record
      // so the boot gate + Studio's schema browser can read it without
      // re-introspecting. No-op when the metadata service can't write.
      ...(metadata?.register
        ? {
            persistCatalog: async (catalog) => {
              await metadata.register!('external_catalog', catalog.name, catalog);
            },
          }
        : {}),
      /**
       * Runtime "Import as Object" (ADR-0015 Addendum): save the federated
       * object through the metadata door's own save, so it is exactly what a
       * `PUT /meta/object/:name` of the same body makes it — a `sys_metadata`
       * row the next boot binds, written through to the engine registry, its
       * storage synced. For a federated object that sync is what maps the
       * object onto its `external.remoteName` table in the driver.
       *
       * [#21788] This used to be `metadata.register('object', …)`, which only
       * held the definition in the metadata service's memory: an object named
       * differently from its remote table answered `500 no such table`, and
       * every import was gone after a restart. ⛔ No second registration path
       * beside the save — the save already writes the registry through.
       *
       * The request is the one that door sends for an `object`, field for
       * field: no `organizationId`, because `object` is not org-overridable and
       * that door's `organizationIdForMetaWrite` resolves none for it; no
       * `packageId`, `mode` or `force`, because the import route takes no
       * `?package`, `?mode` or `?force`.
       *
       * A GETTER, so the save door is asked for when an import runs: the
       * service reads this slot before the draft and refuses with its own
       * "requires a writable metadata store" when it is absent — before any
       * remote introspection, and only when no save door is registered by
       * then. ⛔ Do not move it into a spread: spreading reads the getter
       * once, here, at `init()`.
       */
      get persistObject() {
        const door = metadataSaveDoor();
        if (!door) return undefined;
        return async (name: string, definition: Record<string, unknown>) => {
          await door.saveMetaItem({ type: 'object', name, item: definition });
        };
      },
      /**
       * Where a generated object's `${namespace}_` prefix comes from (ADR-0028).
       *
       * The datasource's OWN owning package — not an ambient "current package",
       * which does not exist at this seam. A federated object is bound to one
       * datasource (`definition.datasource`), so the package that declared that
       * datasource is the package the object belongs in, and its
       * `manifest.namespace` is the prefix `defineStack()` will demand.
       *
       * Both links are read, not assumed:
       *  - `_packageId` is stamped onto every registered metadata item that has
       *    package coords (`applyProtection`, `@objectstack/spec/shared`), by
       *    both load paths — the artifact loader and `registry.registerItem`.
       *    `'sys_metadata'` is the rehydration sentinel, not a real package, so
       *    it is excluded exactly as the registry's own `isCodeArtifactBody`
       *    excludes it.
       *  - the package record is what `installPackage` stored under
       *    `manifest.id`, i.e. the same `{ manifest }` shape the runtime publish
       *    gate reads for this identical check.
       *
       * Every step is allowed to come up empty (a DB-only datasource, a
       * GitOps deployment with no package registry, a legacy package that
       * declares no namespace). Empty resolves to `undefined`, and the service
       * then emits a bare name with a loud TODO rather than inventing a prefix.
       */
      getNamespace: async (datasource: string) => {
        try {
          const ds = (await metadata?.get('datasource', datasource)) as
            | { _packageId?: unknown }
            | undefined;
          const pkgId = typeof ds?._packageId === 'string' ? ds._packageId : undefined;
          if (!pkgId || pkgId === 'sys_metadata') return undefined;
          const pkg = (await metadata?.get('package', pkgId)) as
            | { manifest?: { namespace?: unknown } }
            | undefined;
          const ns = pkg?.manifest?.namespace;
          return typeof ns === 'string' ? ns : undefined;
        } catch {
          // Namespace resolution is best-effort provenance, never a reason to
          // fail a draft: an unresolvable namespace has a defined, documented
          // outcome (bare name + TODO), so a throwing metadata store must land
          // there too rather than taking the whole introspection down.
          return undefined;
        }
      },
      logger: this.options.logger,
    };

    this.service = new ExternalDatasourceService(config);
    ctx.registerService('external-datasource', this.service);
  }

  async start(ctx: PluginContext): Promise<void> {
    if (this.service) await ctx.trigger('external-datasource:ready', this.service);
  }

  async destroy(): Promise<void> {
    this.service = undefined;
  }
}

function safeGetService<T>(ctx: PluginContext, name: string): T | undefined {
  try {
    return ctx.getService<T>(name);
  } catch {
    return undefined;
  }
}
