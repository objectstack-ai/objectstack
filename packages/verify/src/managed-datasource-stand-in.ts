// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// @objectstack/verify — the driver factory `bootStack` hands the datasource
// connection service (ADR-0062 D1/D2).
//
// Verify writes only to stores it creates. Its own `default` store is an
// ephemeral one that stands in for whatever database the app runs on (the
// harness header, and ruling A of the composition rule in `bootStack`). This
// module extends the same swap to every datasource the app DECLARES whose
// schema ObjectStack manages: such a datasource is built as a fresh in-memory
// store of the kind verify's own default store is, never as its real
// connection, so a write verify derives for an object bound to it — or any
// other write that reaches it during the run — lands in memory and dies with
// the kernel.
//
// A datasource ObjectStack does not own (`schemaMode` `external` or
// `validate-only`) keeps its real driver: reads reach it, and `deriveCrudCases`
// (`./derive.ts`) keeps every derived write off its objects.
//
// A managed datasource whose engine has no faithful in-memory stand-in (a
// non-SQL kind such as `mongodb`, or a driver a plugin supplies, which this
// factory never builds) keeps its real driver too, and `deriveCrudCases`
// withholds its objects the way it withholds external ones, naming why. Verify
// never writes through to it.
//
// Type-only imports of `@objectstack/service-datasource`: the harness loads that
// package lazily, and hands this module the real factory and the schema-mode
// resolver from its own dynamic import.

import { resolveDriverId } from '@objectstack/spec/data';
import type {
  DatasourceConnectionSpec,
  DatasourceDriverHandle,
  IDatasourceDriverFactory,
} from '@objectstack/service-datasource';

/** The engine verify's own default store runs on (`BootOptions.databaseDriver`). */
export type VerifyStoreEngine = 'sqlite-wasm' | 'memory';

/** The SQL engines an in-memory SQLite store stands in for, as the default store does. */
const SQL_ENGINES: ReadonlySet<string> = new Set(['sqlite', 'sqlite-wasm', 'postgres', 'mysql', 'turso']);

/**
 * The in-memory engine verify builds in place of a MANAGED datasource on
 * `driver`, or `undefined` when it has none that is faithful.
 *
 * A SQL engine gets the default store's engine, as verify's own `default`
 * does. A `memory` datasource gets a fresh memory store with no persistence.
 * Everything else — `mongodb`, the federation-only SQL engines (which a managed
 * datasource cannot name), and a driver id the platform ships no contract for
 * (a plugin's) — has none.
 */
export function managedStandInEngine(
  driver: unknown,
  defaultStore: VerifyStoreEngine,
): VerifyStoreEngine | undefined {
  const kind = resolveDriverId(driver);
  if (kind === 'memory') return 'memory';
  if (kind !== undefined && SQL_ENGINES.has(kind)) return defaultStore;
  return undefined;
}

/** True when a managed datasource on `driver` is run on a verify stand-in rather than withheld. */
export function hasManagedStandIn(driver: unknown): boolean {
  return managedStandInEngine(driver, 'sqlite-wasm') !== undefined;
}

export interface VerifyDatasourceDriverFactoryOptions {
  /** The factory `objectstack dev` builds declared datasources with. */
  real: IDatasourceDriverFactory;
  /** `resolveDatasourceSchemaMode`, the read the real factory makes. */
  resolveSchemaMode: (spec: DatasourceConnectionSpec) => string | undefined;
  /** The engine of verify's own default store. */
  defaultStore: VerifyStoreEngine;
}

/**
 * Verify's driver factory: the real one, except that a managed datasource with
 * a stand-in is built as an ephemeral in-memory store (see this file's header).
 *
 * The stand-in is built by the real factory from a spec of verify's own — the
 * datasource's name, the stand-in engine and an in-memory config — so it goes
 * through the same construction verify's default store does. Nothing of the
 * declared connection (url, credentials, pool, persistence) reaches it.
 */
export function createVerifyDatasourceDriverFactory(
  opts: VerifyDatasourceDriverFactoryOptions,
): IDatasourceDriverFactory {
  return {
    supports(driverId: string): boolean {
      return opts.real.supports(driverId);
    },
    create(spec: DatasourceConnectionSpec): Promise<DatasourceDriverHandle> | DatasourceDriverHandle {
      // No declared mode is managed, as the real factory and the pool's
      // connect read it.
      if ((opts.resolveSchemaMode(spec) ?? 'managed') !== 'managed') return opts.real.create(spec);
      const engine = managedStandInEngine(spec.driver, opts.defaultStore);
      if (engine === undefined) return opts.real.create(spec);
      return opts.real.create({
        ...(spec.name !== undefined ? { name: spec.name } : {}),
        driver: engine,
        schemaMode: 'managed',
        config: engine === 'memory' ? {} : { filename: ':memory:' },
      });
    },
  };
}
