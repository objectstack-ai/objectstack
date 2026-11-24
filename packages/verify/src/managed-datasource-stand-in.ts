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
// The same bypass is open by NAME: the connection service keeps any driver
// already registered under a datasource's name, whatever driver id it
// declares. So `bootStack` also mounts {@link createManagedDatasourceDriverGuard}
// first, which refuses the boot when a driver verify's factory did not build
// is registered under a managed datasource's name while verify's stand-in does
// not hold that name, a shipped id (`mongodb`, `postgres`, …) included: before
// any plugin starts for a `driver.*` service, and at the engine's
// `registerDriver` for anything registered after that. Once the stand-in holds
// the name, the engine keeps it and discards a later driver, so that boot runs
// on the stand-in and is not refused.
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

/** Every datasource the app declares that is MANAGED ({@link isManagedDatasource}), other than `default`. */
function managedDeclaredDatasources(config: unknown): UnstandableManagedDatasource[] {
  const found: UnstandableManagedDatasource[] = [];
  for (const ds of declaredDatasources(config)) {
    const name = typeof ds.name === 'string' ? ds.name : String(ds.name);
    if (name === 'default' || !isManagedDatasource(ds)) continue;
    found.push({ name, driver: ds.driver });
  }
  return found;
}

/**
 * Every datasource the app declares that is MANAGED ({@link isManagedDatasource})
 * on a driver id the platform does not ship, other than `default` (which is
 * verify's own store whatever the app declares under that name). `bootStack`
 * refuses to boot when this is not empty.
 */
export function unstandableManagedDatasources(config: unknown): UnstandableManagedDatasource[] {
  return managedDeclaredDatasources(config).filter(
    (ds) => managedStandInEngine(ds.driver, 'sqlite-wasm') === undefined,
  );
}

/** `datasource "NAME" (driver "ID")`, or `(no driver declared)` when the declaration names none. */
function describeDatasources(found: readonly UnstandableManagedDatasource[]): string {
  return found
    .map((ds) => {
      const driver =
        ds.driver === undefined || ds.driver === null || ds.driver === ''
          ? 'no driver declared'
          : `driver ${JSON.stringify(ds.driver)}`;
      return `datasource "${ds.name}" (${driver})`;
    })
    .join(', ');
}

/** The sentence `os verify` exits non-zero with when it refuses such a boot. */
export function unstandableManagedDatasourceRefusal(found: readonly UnstandableManagedDatasource[]): string {
  const one = found.length === 1;
  return (
    `verify: refusing to boot: ${describeDatasources(found)} ${one ? 'is' : 'are'} managed and ` +
    `${one ? 'names' : 'name'} no driver id the platform ships (a plugin's driver, or a misspelling), so verify ` +
    'has no in-memory stand-in for ' + (one ? 'it' : 'them') + '. Verify writes only to stores it creates: it ' +
    'runs every managed datasource on an ephemeral in-memory stand-in, and a driver a plugin registers under ' +
    "that name would otherwise take the app's seed, hooks and flows to the real database behind it. There is " +
    'no switch around this refusal: correct the driver id, or verify a configuration that does not declare ' +
    (one ? 'it' : 'them') + '.'
  );
}

/**
 * The sentence `os verify` exits non-zero with when a plugin registers a driver
 * under a managed datasource's name while verify's stand-in does not hold it.
 */
function foreignManagedDriverRefusal(found: readonly UnstandableManagedDatasource[]): string {
  const one = found.length === 1;
  return (
    `verify: refusing to boot: ${describeDatasources(found)} ${one ? 'is' : 'are'} managed, but a plugin ` +
    `registered a driver of its own under ${one ? "that datasource's name" : "those datasources' names"} while ` +
    `verify's in-memory stand-in did not hold ${one ? 'it' : 'them'}. The ` +
    "datasource connection service keeps a driver registered under the datasource's name, so the boot would " +
    "run on that driver instead of verify's in-memory stand-in, and the app's seed, hooks and flows and " +
    "verify's own writes would reach whatever store it is connected to. Verify writes only to stores it " +
    'creates. There is no switch around this refusal: verify a configuration that does not register a driver ' +
    `under ${one ? 'that name' : 'those names'}.`
  );
}

/**
 * The engine drivers verify's factory built as managed stand-ins, by
 * datasource name: the factory records each one it hands out, and the guard
 * reads it to tell verify's stand-in from any other driver under that name.
 */
export interface ManagedStandInLedger {
  /** Record `driver` as the stand-in verify's factory built for datasource `name`. */
  record(name: string, driver: unknown): void;
  /** Whether `driver` is a stand-in verify's factory built for datasource `name`. */
  isStandIn(name: string, driver: unknown): boolean;
}

/** An empty {@link ManagedStandInLedger}; `bootStack` shares one between its factory and its guard. */
export function createManagedStandInLedger(): ManagedStandInLedger {
  const built = new Map<string, WeakSet<object>>();
  return {
    record(name: string, driver: unknown): void {
      if (!driver || typeof driver !== 'object') return;
      let drivers = built.get(name);
      if (!drivers) built.set(name, (drivers = new WeakSet()));
      drivers.add(driver);
    },
    isStandIn(name: string, driver: unknown): boolean {
      return !!driver && typeof driver === 'object' && built.get(name)?.has(driver) === true;
    },
  };
}

/** The guard plugin {@link createManagedDatasourceDriverGuard} returns. */
export interface ManagedDatasourceDriverGuard {
  name: string;
  version: string;
  init(): Promise<void>;
  start(ctx: ManagedDriverGuardContext): Promise<void>;
  /**
   * The sentence the guard refused with, once it has, even when the caller of
   * `registerDriver` caught the refusal and carried on. `bootStack` refuses a
   * boot that returned with this set.
   */
  readonly refusal: string | undefined;
  /**
   * The guard's sentence when `error` is, or has in its `cause` chain, a
   * refusal the guard threw; otherwise `undefined`. The kernel hands a failed
   * `start()` on wrapped in its own rollback message, with the original as its
   * `cause`, so `bootStack` rethrows this sentence on its own, and a boot that
   * failed for another reason keeps its own error.
   */
  refusalIn(error: unknown): string | undefined;
}

/** What the guard reads from its plugin context. */
export interface ManagedDriverGuardContext {
  getServices(): Map<string, unknown>;
  getService(name: string): unknown;
}

/** The two engine methods the guard reads and wraps. */
interface GuardedEngine {
  getDriverByName?: (name: string) => unknown;
  registerDriver?: (driver: unknown, ...rest: unknown[]) => unknown;
}

/** A driver's own `name`, the key the engine registers it under. */
function ownDriverName(driver: unknown): string | undefined {
  const name = driver && typeof driver === 'object' ? (driver as { name?: unknown }).name : undefined;
  return typeof name === 'string' ? name : undefined;
}

/**
 * The guard `bootStack` mounts FIRST on its kernel when the app declares a
 * managed datasource other than `default`, or `undefined` when it declares none.
 *
 * Why it is needed beside {@link unstandableManagedDatasources}: the datasource
 * connection service answers `already-registered` for a datasource whose NAME
 * the engine already holds a driver under, without reading its declared driver
 * id, so verify's factory is never asked. A plugin that puts a driver of its
 * own under a managed datasource's name before verify's stand-in is
 * registered would run the datasource on that driver, a SHIPPED id
 * (`mongodb`, `postgres`, …) included. The guard refuses that boot, naming the
 * datasource and its declared driver id, at two points:
 *
 * - Its `start()`, the first of the boot. The kernel initialises every plugin
 *   before it starts any, so every `driver.*` service a plugin registered in
 *   `init()` is visible here, and so is a driver a plugin put straight into
 *   the engine there. ObjectQL adopts each `driver.*` service (in its own
 *   `start()`) under the driver's own `name`, not under the service key, so
 *   the guard matches both against the managed names. A match refuses the
 *   boot before any plugin starts.
 * - The engine's `registerDriver`, which `start()` then wraps on the engine
 *   instance. It is the engine's one public way to put a driver under a name
 *   (its driver map is private in the TypeScript type only), and every later
 *   registration calls it: ObjectQL's adoption, an `objectql:drivers-ready`
 *   handler (fired after the engine's `init()` and before the boot's schema
 *   sync), any later plugin, an app's `onEnable` bridge and the connection
 *   service itself. A driver under a managed name that is not one verify's
 *   factory built for that datasource ({@link ManagedStandInLedger}) is
 *   refused there while the engine does not hold verify's stand-in under that
 *   name, before the engine holds the driver, so no connect, schema sync,
 *   seed, hook or verify write reaches it. That refusal fails the `start()` of
 *   the plugin whose code made the call; `bootStack` rethrows the guard's own
 *   sentence ({@link ManagedDatasourceDriverGuard.refusalIn}), and refuses the
 *   boot too when the caller caught the refusal and the boot went on
 *   ({@link ManagedDatasourceDriverGuard.refusal}). Once the engine holds the
 *   stand-in under the name (the connection service registered it: AppPlugin's
 *   `start()`, or its `objectql:drivers-ready` handler for a mapped
 *   datasource), the wrap forwards a later driver to the engine, which keeps
 *   the stand-in and discards the newcomer without calling it, so that boot
 *   runs on the stand-in and is not refused.
 *
 * Not covered, each a deliberate step around the guard rather than a shape an
 * author falls into: a datasource the configuration handed to `bootStack` does
 * not declare; a plugin that replaces the `objectql` service or takes this
 * guard's plugin name; one that calls the engine prototype's `registerDriver`
 * on the engine, or deletes or overwrites the wrap (a plain writable own
 * property); and a driver whose `name` answers differently on the wrap's read
 * and the engine's.
 */
export function createManagedDatasourceDriverGuard(
  config: unknown,
  standIns: ManagedStandInLedger,
): ManagedDatasourceDriverGuard | undefined {
  const managed = managedDeclaredDatasources(config);
  if (managed.length === 0) return undefined;
  const byName = new Map(managed.map((ds) => [ds.name, ds]));
  let refusal: string | undefined;
  const thrown = new WeakSet<object>();
  const refuse = (found: readonly UnstandableManagedDatasource[]): never => {
    refusal = foreignManagedDriverRefusal(found);
    const error = new Error(refusal);
    thrown.add(error);
    throw error;
  };
  return {
    name: 'com.objectstack.verify.managed-datasource-driver-guard',
    version: '1.0.0',
    get refusal(): string | undefined {
      return refusal;
    },
    refusalIn(error: unknown): string | undefined {
      const seen = new Set<unknown>();
      for (let at: unknown = error; at && typeof at === 'object' && !seen.has(at); at = (at as { cause?: unknown }).cause) {
        seen.add(at);
        if (thrown.has(at)) return (at as Error).message;
      }
      return undefined;
    },
    async init(): Promise<void> {},
    async start(ctx: ManagedDriverGuardContext): Promise<void> {
      let engine: GuardedEngine | undefined;
      try {
        engine = ctx.getService('objectql') as GuardedEngine | undefined;
      } catch {
        engine = undefined;
      }

      // Every `driver.*` service, by its key and by the driver's own name.
      const taken = new Set<string>();
      for (const [key, service] of ctx.getServices()) {
        if (!key.startsWith('driver.')) continue;
        for (const name of [key.slice('driver.'.length), ownDriverName(service)]) {
          if (name !== undefined && byName.has(name)) taken.add(name);
        }
      }
      // A driver already in the engine under a managed name.
      for (const ds of managed) {
        const held = engine?.getDriverByName?.(ds.name);
        if (held && !standIns.isStandIn(ds.name, held)) taken.add(ds.name);
      }
      if (taken.size > 0) refuse(managed.filter((ds) => taken.has(ds.name)));

      // Every registration from here on.
      const register = engine?.registerDriver;
      if (!engine || typeof register !== 'function') return;
      const guarded = engine;
      guarded.registerDriver = (driver: unknown, ...rest: unknown[]): unknown => {
        const name = ownDriverName(driver);
        const ds = name === undefined ? undefined : byName.get(name);
        // Refused only when it could take the name: while the engine holds
        // verify's stand-in under it, the engine keeps that and discards this.
        if (
          ds &&
          !standIns.isStandIn(ds.name, driver) &&
          !standIns.isStandIn(ds.name, guarded.getDriverByName?.(ds.name))
        ) {
          refuse([ds]);
        }
        return register.call(guarded, driver, ...rest);
      };
    },
  };
}

export interface VerifyDatasourceDriverFactoryOptions {
  /** The factory `objectstack dev` builds declared datasources with. */
  real: IDatasourceDriverFactory;
  /** The engine of verify's own default store. */
  defaultStore: VerifyStoreEngine;
  /** Where each stand-in's engine driver is recorded for the guard ({@link createManagedDatasourceDriverGuard}). */
  standIns?: ManagedStandInLedger;
}

/**
 * Verify's driver factory: the real one, except that a managed datasource is
 * built as an ephemeral in-memory store (see this file's header).
 *
 * The stand-in is built by the real factory from a spec of verify's own — the
 * datasource's name, the stand-in engine and an in-memory config — so it goes
 * through the same construction verify's default store does. Nothing of the
 * declared connection (url, credentials, pool, persistence) reaches it. Each
 * stand-in's engine driver is recorded in `opts.standIns`, the guard's proof
 * that a driver under a managed name is verify's.
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
      const built = opts.real.create({
        ...(spec.name !== undefined ? { name: spec.name } : {}),
        driver: engine,
        schemaMode: 'managed',
        config: engine === 'memory' ? {} : { filename: ':memory:' },
      });
      const { standIns } = opts;
      const name = spec.name;
      if (!standIns || name === undefined) return built;
      // The connection service registers `handle.driver ?? handle` with the engine.
      return Promise.resolve(built).then((handle) => {
        standIns.record(name, handle?.driver ?? handle);
        return handle;
      });
    },
  };
}
