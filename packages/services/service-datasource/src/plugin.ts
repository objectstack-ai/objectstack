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
