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
// other write that reaches it during the run, the app's seed, hooks and flows
// included — lands in memory and dies with the kernel.
//
// Every engine the platform ships has a stand-in ({@link managedStandInEngine}):
// `memory` gets a fresh memory store, and every other one — the SQL engines and
// `mongodb` alike — gets the default store's engine. "Ships" is one reading,
// `resolveDriverId` from `@objectstack/spec`: the ids the default driver
// factory `objectstack dev` builds with answers `supports()` for.
//
// A managed datasource on a driver id the platform does NOT ship (a plugin's)
// has no stand-in and cannot get one here: the plugin constructs its driver
// itself and registers it as a `driver.NAME` service, which the engine adopts
// and the datasource connection service then leaves alone as already
// registered, so this factory is never asked to build it. Verify therefore
// refuses to boot while one is declared ({@link unstandableManagedDatasources},
// read by `bootStack` before it composes anything), naming the datasource and
// the driver id. There is no switch around that refusal.
//
// A datasource ObjectStack does not own (`schemaMode` `external` or
// `validate-only`) keeps its real driver: reads reach it, and `deriveCrudCases`
// (`./derive.ts`) keeps every derived write off its objects.
//
// ## One reading of "is this datasource managed"
//
// {@link isManagedDatasource} is the ONE reader, and both deciders call it: this
// factory (stand-in or real driver) and `deriveCrudCases` (withhold as external
// or exercise). It is `resolveDatasourceSchemaMode` — the read the real factory
// hands the driver, `spec.schemaMode`, then `external.schemaMode`, then
// `config.schemaMode` — with no mode read as managed. Two readers drifting is
// the hazard: a datasource that spells `schemaMode` only inside `config` would
// get its real connection here (the factory's reading) while derive (the
// declared key alone, as the engine's write gate reads it) kept its objects in
// every write family, so verify's rows would land in the real database. With
// one reader, any datasource this factory keeps real is withheld by derive, and
// the boot refusal judges "managed" on the same reader too.

import { resolveDriverId } from '@objectstack/spec/data';
import { resolveDatasourceSchemaMode } from '@objectstack/service-datasource';
import { declaredCollection } from './artifact-collections.js';
import type {
  DatasourceConnectionSpec,
  DatasourceDriverHandle,
  IDatasourceDriverFactory,
} from '@objectstack/service-datasource';

/** The engine verify's own default store runs on (`BootOptions.databaseDriver`). */
export type VerifyStoreEngine = 'sqlite-wasm' | 'memory';

/**
 * The in-memory engine verify builds in place of a MANAGED datasource on
 * `driver`, or `undefined` when the platform does not ship that driver id.
 *
 * A `memory` datasource gets a fresh memory store with no persistence; every
 * other shipped engine — the SQL engines and `mongodb` — gets the default
 * store's engine, as verify's own `default` does. `undefined` is a driver id a
 * plugin supplies: verify refuses to boot while a managed datasource names one
 * ({@link unstandableManagedDatasources}).
 */
export function managedStandInEngine(
  driver: unknown,
  defaultStore: VerifyStoreEngine,
): VerifyStoreEngine | undefined {
  const kind = resolveDriverId(driver);
  if (kind === undefined) return undefined;
  return kind === 'memory' ? 'memory' : defaultStore;
}

/**
 * Whether verify reads a declared datasource (an authored definition, or the
 * connection spec built from one) as MANAGED — the one reader both this
 * factory and `deriveCrudCases` decide on (see this file's header).
 */
export function isManagedDatasource(ds: {
  schemaMode?: unknown;
  external?: unknown;
  config?: unknown;
}): boolean {
  const spec = {
    ...ds,
    config: ds.config && typeof ds.config === 'object' ? (ds.config as Record<string, unknown>) : {},
  } as DatasourceConnectionSpec;
  return (resolveDatasourceSchemaMode(spec) ?? 'managed') === 'managed';
}

/** A declared managed datasource verify cannot stand in: its driver id is a plugin's. */
export interface UnstandableManagedDatasource {
  /** The datasource's declared `name`. */
  name: string;
  /** The driver id it declares, as written. */
  driver: unknown;
}

/** The app's declared datasources, from the array the spec declares or a name-keyed map. */
function declaredDatasources(config: unknown): Array<Record<string, unknown>> {
  const declared: unknown = declaredCollection(config, 'datasources');
  if (Array.isArray(declared)) return declared.filter((ds) => !!ds && typeof ds === 'object');
  if (!declared || typeof declared !== 'object') return [];
  return Object.entries(declared as Record<string, unknown>)
    .filter(([, ds]) => !!ds && typeof ds === 'object')
    .map(([key, ds]) => ({ name: key, ...(ds as Record<string, unknown>) }));
}

/**
 * Every datasource the app declares that is MANAGED ({@link isManagedDatasource})
 * on a driver id the platform does not ship, other than `default` (which is
 * verify's own store whatever the app declares under that name). `bootStack`
 * refuses to boot when this is not empty.
 */
export function unstandableManagedDatasources(config: unknown): UnstandableManagedDatasource[] {
  const found: UnstandableManagedDatasource[] = [];
  for (const ds of declaredDatasources(config)) {
    const name = typeof ds.name === 'string' ? ds.name : String(ds.name);
    if (name === 'default' || !isManagedDatasource(ds)) continue;
    if (managedStandInEngine(ds.driver, 'sqlite-wasm') !== undefined) continue;
    found.push({ name, driver: ds.driver });
  }
  return found;
}

/** The sentence `os verify` exits non-zero with when it refuses such a boot. */
export function unstandableManagedDatasourceRefusal(found: readonly UnstandableManagedDatasource[]): string {
  const named = found.map((ds) => `datasource "${ds.name}" (driver ${JSON.stringify(ds.driver)})`).join(', ');
  const one = found.length === 1;
  return (
    `verify: refusing to boot: ${named} ${one ? 'is' : 'are'} managed on a driver id the platform does not ` +
    `ship, so ${one ? 'it is' : 'they are'} supplied by a plugin. Verify writes only to stores it creates: it ` +
    'runs every managed datasource on an ephemeral in-memory stand-in, and it has none for a driver it does not ' +
    "ship. Booted anyway, the plugin's own driver would take the app's seed, hooks and flows to the real " +
    `database ${one ? 'that datasource names' : 'those datasources name'}. There is no switch around this ` +
    'refusal: verify a configuration that does not declare ' + (one ? 'it' : 'them') + '.'
  );
}

export interface VerifyDatasourceDriverFactoryOptions {
  /** The factory `objectstack dev` builds declared datasources with. */
  real: IDatasourceDriverFactory;
  /** The engine of verify's own default store. */
  defaultStore: VerifyStoreEngine;
}

/**
 * Verify's driver factory: the real one, except that a managed datasource is
 * built as an ephemeral in-memory store (see this file's header).
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
      // The one reader derive decides on too: what this keeps real, derive withholds.
      if (!isManagedDatasource(spec)) return opts.real.create(spec);
      const engine = managedStandInEngine(spec.driver, opts.defaultStore);
      // A plugin's driver id: `bootStack` refuses such a boot before composing,
      // and the connection service never asks a factory whose `supports()` is
      // false for it. Any other caller is refused the same way, never handed a
      // real connection.
      if (engine === undefined) {
        throw new Error(
          unstandableManagedDatasourceRefusal([{ name: spec.name ?? '(unnamed)', driver: spec.driver }]),
        );
      }
      return opts.real.create({
        ...(spec.name !== undefined ? { name: spec.name } : {}),
        driver: engine,
        schemaMode: 'managed',
        config: engine === 'memory' ? {} : { filename: ':memory:' },
      });
    },
  };
}
