// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { classifyAdmissionTenancyPosture, type TenancyPostureSource } from '@objectstack/core';
import type {
  EnsureCustomizationPackageRequest,
  EnsureCustomizationPackageResponse,
  MetadataProtocol,
} from '@objectstack/spec/api';
import { customizationNamespace, customizationPackageId } from '@objectstack/spec/kernel';
import { postureEnforcesWall } from '@objectstack/spec/security';
import type { IDataEngine, IObjectQLEngine, IntrospectedSchema } from '@objectstack/spec/contracts';
import {
  ExternalDatasourceService,
  type ExternalDatasourceServiceConfig,
  type DatasourceLike,
  type ObjectLike,
  type Logger,
} from './external-datasource-service.js';
import { registeredDriverName, type DatasourceConnectionService } from './datasource-connection-service.js';

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

/**
 * The `'metadata'` service members this plugin reads: datasource
 * definitions, and the catalog write. Objects are not read here — see
 * `objectRegistry` in {@link ExternalDatasourceServicePlugin.init}.
 */
interface MetadataServiceLike {
  get: (type: string, name: string) => Promise<unknown>;
  register?: (type: string, name: string, data: unknown) => Promise<void> | void;
}

/** The metadata door's save, as the `'protocol'` service declares it. */
type MetadataSaveDoor = Pick<MetadataProtocol, 'saveMetaItem'>;

/**
 * The two members of the `'protocol'` service an import's landing asks
 * (ruling B on the placement of an imported object): the ADR-0070 writability
 * predicate the save door applies, and the ADR-0146 D3 ensure door, the ONLY
 * creation path of a base's customization package. Probed, like the save
 * door, on the service this plugin already resolves: ⛔ no second spelling of
 * either rule here.
 */
interface ImportLandingDoors {
  isWritablePackage(packageId: string): boolean;
  ensureCustomizationPackage(request: EnsureCustomizationPackageRequest): Promise<EnsureCustomizationPackageResponse>;
}

/**
 * A refused import landing: the code and status the import door answers every
 * refusal with, so the declaration and the served envelope agree, as for the
 * service's own `importNameRefusedError`.
 */
function importLandingRefusal(message: string): Error {
  return Object.assign(new Error(message), { code: 'EXTERNAL_IMPORT_ERROR', status: 400 });
}

/** The two reads the federation service makes of the engine's object registry. */
type ObjectRegistryReads = Pick<IObjectQLEngine['registry'], 'getObject' | 'getAllObjects'>;

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
 * `IDataEngine` (for driver introspection), the engine's object registry (for
 * object reads) and `IMetadataService` (for datasource reads).
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

    /**
     * [#21876] The `'metadata'` service: every datasource read
     * below, and the catalog write, go through it. Objects are read from the
     * engine's registry instead ([#21842], `objectRegistry` below).
     *
     * Resolved where it is used, never at `init()`, like `metadataSaveDoor`.
     * `objectstack start` composes no metadata plugin: its `'metadata'`
     * service is the kernel's in-memory fallback, which the kernel registers
     * after every plugin's `init()`, just before the start phase. Read here,
     * it was absent for the life of the process, so `external/validate`
     * answered no rows and the boot gate checked zero federated objects
     * (AGENTS.md, "Startup registry reads"). Each reader keeps its own answer
     * for a deployment that has no metadata service at all.
     */
    const metadata = (): MetadataServiceLike | undefined => safeGetService<MetadataServiceLike>(ctx, 'metadata');

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

    /**
     * [#21842] Where the federation service reads objects: the engine's object
     * registry, on the `'objectql'` service (`IObjectQLEngine.registry`).
     *
     * It is the registry that save writes through to (`applyRegistryWriteThrough`
     * in `@objectstack/metadata-protocol`), so an object saved at runtime through
     * `PUT /api/v1/meta/object/:name`, or by the import (`persistObject` below),
     * is validated the moment it is saved. The objects used to come from the `'metadata'`
     * service, which holds a copy of this registry taken once at boot
     * (`ObjectQLPlugin`'s startup bridge): a runtime save never reached that
     * copy, so `POST …/external/validate` did not see the object until the next
     * restart. ⛔ Never a second copy kept here and refreshed by hand: this
     * registry is the one source.
     *
     * Resolved where it is used, never at `init()`, for the reason
     * `metadataSaveDoor` is (AGENTS.md, "Startup registry reads").
     */
    const objectRegistry = (): ObjectRegistryReads | undefined => {
      const registry = safeGetService<Partial<Pick<IObjectQLEngine, 'registry'>>>(ctx, 'objectql')?.registry;
      return typeof registry?.getObject === 'function' && typeof registry.getAllObjects === 'function'
        ? registry
        : undefined;
    };

    /**
     * [#24772] The live driver behind a datasource name, for the saved
     * datasource's Test probe: the engine's registry entry under the name
     * {@link registeredDriverName} resolves. That is the resolver
     * `DatasourceConnectionService.disconnect` applies, reused rather than
     * restated, because the primary datasource's driver is registered under
     * its natural name (ADR-0062) and a lookup by `'default'` finds nothing.
     *
     * Resolved where it is used, never at `init()`, for the reason
     * `metadataSaveDoor` is (AGENTS.md, "Startup registry reads").
     */
    const liveDriver: ExternalDatasourceServiceConfig['liveDriver'] = (datasource) => {
      const data = safeGetService<IDataEngine>(ctx, 'data');
      const driverName = registeredDriverName(data, datasource);
      return driverName ? data?.getDriverByName?.(driverName) : undefined;
    };

    /**
     * [#27100] The retained connect verdict, for the saved datasource's Test:
     * read from the shared `'datasource-connection'` service, the one store the
     * admin list's `statusReason` reads too. A host without that service has
     * no verdicts, and Test keeps the engine's answer.
     *
     * Resolved where it is used, never at `init()`, for the reason
     * `metadataSaveDoor` is (AGENTS.md, "Startup registry reads").
     */
    const connectionState: ExternalDatasourceServiceConfig['connectionState'] = (datasource) => {
      const connection = safeGetService<Partial<Pick<DatasourceConnectionService, 'getConnectionState'>>>(
        ctx,
        'datasource-connection',
      );
      return typeof connection?.getConnectionState === 'function' ? connection.getConnectionState(datasource) : undefined;
    };

    /**
     * The package that declared a datasource: its stamped `_packageId`, or
     * `undefined` for a datasource no package declares, the `'sys_metadata'`
     * rehydration sentinel, and a datasource that cannot be read. See
     * `getNamespace` below for why the stamp is the one source.
     */
    const datasourcePackageId = async (datasource: string): Promise<string | undefined> => {
      try {
        const ds = (await metadata()?.get('datasource', datasource)) as { _packageId?: unknown } | undefined;
        const pkgId = typeof ds?._packageId === 'string' ? ds._packageId : undefined;
        return !pkgId || pkgId === 'sys_metadata' ? undefined : pkgId;
      } catch {
        return undefined;
      }
    };

    /** A package record as `installPackage` stored it in the engine registry, read where it is used. */
    const packageRecord = (packageId: string): { manifest?: { namespace?: unknown } } | undefined =>
      safeGetService<{ registry?: { getPackage?: (id: string) => unknown } }>(ctx, 'objectql')?.registry?.getPackage?.(
        packageId,
      ) as { manifest?: { namespace?: unknown } } | undefined;

    const namespaceOf = (record: { manifest?: { namespace?: unknown } } | undefined): string | undefined => {
      const ns = record?.manifest?.namespace;
      return typeof ns === 'string' ? ns : undefined;
    };

    /** The landing doors on the `'protocol'` service, resolved where they are used, like `metadataSaveDoor`. */
    const landingDoors = (): ImportLandingDoors | undefined => {
      const protocol = safeGetService<Partial<ImportLandingDoors>>(ctx, 'protocol');
      return typeof protocol?.isWritablePackage === 'function'
        && typeof protocol.ensureCustomizationPackage === 'function'
        ? (protocol as ImportLandingDoors)
        : undefined;
    };

    /**
     * The deployment's EFFECTIVE tenancy posture, from the `tenancy` service
     * through the shared classification (a registered service that cannot
     * answer is an outage, never "single"), read per import like the
     * datasource admin routes read it.
     */
    const tenancyPosture = async () => {
      const kernel = ctx.getKernel?.() as
        | { getServiceAsync?: <T>(name: string, scopeId?: string) => Promise<T> }
        | undefined;
      if (!kernel || typeof kernel.getServiceAsync !== 'function') return undefined;
      return classifyAdmissionTenancyPosture(() => kernel.getServiceAsync!<TenancyPostureSource>('tenancy'));
    };

    const config: ExternalDatasourceServiceConfig = {
      introspect,
      liveDriver,
      connectionState,
      getDatasource: async (n) => (await metadata()?.get('datasource', n)) as DatasourceLike | undefined,
      // [#21842] Both object reads come from the one registry, so the sweep
      // judges the very definitions it listed. See `objectRegistry`.
      getObject: async (n) => objectRegistry()?.getObject(n) as ObjectLike | undefined,
      listObjects: async () => (objectRegistry()?.getAllObjects() ?? []) as ObjectLike[],
      // Persist the refreshed snapshot as an `external_catalog` metadata record
      // so the boot gate + Studio's schema browser can read it without
      // re-introspecting. No-op when the metadata service can't write.
      //
      // [#21876] A GETTER, for the reason `persistObject` below is one: the
      // service reads this slot when a refresh runs, so the metadata service
      // registered by then is the one written to. ⛔ Not a spread: a spread
      // decided at `init()` whether the slot existed at all.
      get persistCatalog(): ExternalDatasourceServiceConfig['persistCatalog'] {
        const service = metadata();
        if (!service?.register) return undefined;
        return async (catalog) => {
          await service.register!('external_catalog', catalog.name, catalog);
        };
      },
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
       * field: no `organizationId`, because that door carries none into any
       * metadata write (ADR-0131 D6); no
       * `packageId`, `mode` or `force`, because the import route takes no
       * `?package`, `?mode` or `?force`.
       *
       * [#21841] …and one field that door does not send: the import's own
       * `writeFace`, stated here by the server and never read from the
       * caller's options. A re-import that would drop or retype a field the
       * stored object still carries is refused by the save's destructive-change
       * gate, and the import route relays that refusal. Without a face the
       * refusal ended "re-submit with ?force=true", a parameter this route does
       * not read; `'external-import'` makes it name the remedies that exist
       * from here (a new `name`, or `PUT /api/v1/meta/object/:name?force=true`).
       * ⛔ Not a `force`: the refusal stays, and acknowledging a destructive
       * change stays on the metadata door.
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
        return async (name: string, definition: Record<string, unknown>, packageId?: string) => {
          await door.saveMetaItem({
            type: 'object',
            name,
            item: definition,
            writeFace: 'external-import',
            // [#30469 item 2] The package `resolveImportLanding` chose; absent
            // for a package-less row, so that request is byte-for-byte the one
            // this door sent before.
            ...(packageId ? { packageId } : {}),
          });
        };
      },
      /**
       * [#30469 item 2] Where an import is saved — ruling B (recorded as
       * 6660988968), the module of `resolveImportLanding` in
       * `external-datasource-service.ts` stating the three rows. Decided by
       * the datasource's `_packageId` alone:
       *
       *  - none → package-less (ADR-0146 D11 environment metadata);
       *  - writable (the save door's own ADR-0070 predicate) → that package;
       *  - read-only installed base → its pair `<base>.custom` (ADR-0146 D2),
       *    named in the pair's namespace, which the save door's prefix rule
       *    judges against the WRITTEN package: an import over the showcase's
       *    `showcase_external` is named `showcase_custom_customers`, and
       *    `showcase_customers` is refused there with `NAMESPACE_PREFIX`.
       *
       * The pair comes from the ensure door and from nowhere else (ADR-0146
       * D3). Under a walled posture the platform operator alone creates the
       * pair, through that door's HTTP route (ADR-0146 D3 "Walled postures",
       * ADR-0131 D3), so this seam NEVER creates it there: an existing pair
       * receives the import, and an absent one refuses it, naming the
       * operator and the route that creates it. ⛔ No package-less landing
       * instead — the silent fallback ADR-0070 D3 forbids.
       */
      resolveImportLanding: async (datasource: string) => {
        const basePackageId = await datasourcePackageId(datasource);
        if (!basePackageId) return {};
        const doors = landingDoors();
        if (!doors) {
          throw importLandingRefusal(
            `Datasource '${datasource}' is declared by package '${basePackageId}', so an object imported from it `
              + 'belongs in that package or its customization package, and this deployment\'s metadata protocol '
              + 'cannot judge the package\'s writability or ensure its customization package. The import is not '
              + 'saved anywhere else.',
          );
        }
        const base = packageRecord(basePackageId);
        if (doors.isWritablePackage(basePackageId)) {
          return { packageId: basePackageId, namespace: namespaceOf(base) };
        }
        const pairId = customizationPackageId(basePackageId);
        if (!pairId.ok) {
          throw importLandingRefusal(
            `Datasource '${datasource}' is declared by read-only package '${basePackageId}', which has no `
              + `customization package (${pairId.reason}), so an object imported from it has no package to be `
              + 'saved into. The import is not saved anywhere else.',
          );
        }
        const pair = packageRecord(pairId.value);
        const posture = await tenancyPosture();
        if (posture !== undefined && postureEnforcesWall(posture)) {
          if (pair) return { packageId: pairId.value, namespace: namespaceOf(pair) };
          throw importLandingRefusal(
            `Datasource '${datasource}' is declared by read-only package '${basePackageId}', so an object imported `
              + `from it belongs in that package's customization package '${pairId.value}', which does not exist `
              + `yet. This deployment runs the '${posture}' tenancy posture, where the platform operator creates `
              + `a customization package: ask the platform operator to create it (POST `
              + `/api/v1/packages/${basePackageId}/ensure-customization), then import again. The import is not `
              + 'saved anywhere else (ADR-0146 D3, ADR-0131 D3).',
          );
        }
        const derived = customizationNamespace(namespaceOf(base));
        return {
          packageId: pairId.value,
          namespace: pair ? namespaceOf(pair) : derived.ok ? derived.value : undefined,
          prepare: async () => {
            await doors.ensureCustomizationPackage({ basePackageId });
          },
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
       *    every load path — the artifact loader, `registry.registerItem`, and
       *    `AppPlugin`'s registration of a code-defined datasource, which
       *    stamps the package body that declares it ([#21889]).
       *    `'sys_metadata'` is the rehydration sentinel, not a real package, so
       *    it is excluded exactly as the registry's own `isCodeArtifactBody`
       *    excludes it.
       *  - the package record is what `installPackage` stored under
       *    `manifest.id` in the engine registry (`registry.getPackage` on the
       *    `'objectql'` service), the store the runtime publish gate reads for
       *    this identical check (`publishPackageDrafts`,
       *    `@objectstack/metadata-protocol`). [#21889] It used to be asked of
       *    the `'metadata'` service, which no composition writes package
       *    records into, so no datasource ever resolved a namespace. ⛔ One
       *    store, one id: the id comes only from `_packageId`, never guessed,
       *    and no second store is consulted when the registry has no record.
       *    The engine is resolved where it is used, like `metadata()` above.
       *
       * Every step is allowed to come up empty (a DB-only datasource, a
       * GitOps deployment with no package registry, a legacy package that
       * declares no namespace). Empty resolves to `undefined`, and the service
       * then emits a bare name with a loud TODO rather than inventing a prefix.
       */
      getNamespace: async (datasource: string) => {
        try {
          const pkgId = await datasourcePackageId(datasource);
          return pkgId ? namespaceOf(packageRecord(pkgId)) : undefined;
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
