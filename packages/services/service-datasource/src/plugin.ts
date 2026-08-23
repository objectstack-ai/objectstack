// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IntrospectedSchema } from '@objectstack/spec/contracts';
import {
  ExternalDatasourceService,
  type ExternalDatasourceServiceConfig,
  type DatasourceLike,
  type ObjectLike,
  type Logger,
} from './external-datasource-service.js';

/**
 * Minimal surfaces the plugin needs from the data engine + metadata service.
 * Kept structural so the plugin doesn't hard-depend on concrete classes.
 */
interface DataEngineLike {
  /** Resolve a driver by datasource name and introspect its live schema. */
  introspectDatasource?: (datasource: string) => Promise<IntrospectedSchema>;
  getDatasourceDriver?: (datasource: string) => { introspectSchema?: () => Promise<IntrospectedSchema> } | undefined;
}

interface MetadataServiceLike {
  get: (type: string, name: string) => Promise<unknown>;
  getObject?: (name: string) => Promise<unknown>;
  listObjects?: () => Promise<unknown[]>;
  list?: (type: string) => Promise<unknown[]>;
  register?: (type: string, name: string, data: unknown) => Promise<void> | void;
}

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
    const engine = safeGetService<DataEngineLike>(ctx, 'data');
    const metadata = safeGetService<MetadataServiceLike>(ctx, 'metadata');

    const introspect: ExternalDatasourceServiceConfig['introspect'] =
      this.options.introspect ??
      (async (datasource: string) => {
        if (engine?.introspectDatasource) return engine.introspectDatasource(datasource);
        const driver = engine?.getDatasourceDriver?.(datasource);
        if (driver?.introspectSchema) return driver.introspectSchema();
        throw new Error(
          `Cannot introspect datasource '${datasource}': no driver introspection available.`,
        );
      });

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
            // Runtime "Import as Object": persist a federated object so it's
            // immediately queryable, no git commit required (ADR-0015 Addendum).
            persistObject: async (name, definition) => {
              await metadata.register!('object', name, definition);
            },
          }
        : {}),
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
