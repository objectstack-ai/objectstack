// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An {@link IDatasourceDriverFactory} over a driver instance the HOST already
 * built — the "adopt an existing driver" seam of ADR-0062 D1 (#3826), landed
 * as a factory instead of a second connect entry point.
 *
 * ## Why this exists
 *
 * `DatasourceConnectionService.connect()` takes a *definition* and builds the
 * driver through the injected factory — that is the one connect + failure
 * -verdict implementation ADR-0062 D1 requires. Some hosts, however, hold a
 * driver *instance* the shared open-core factory cannot or must not rebuild:
 *
 *   - a driver kind that ships outside open-core (the cloud distribution's
 *     `@objectstack/driver-turso`),
 *   - a pooled instance whose lifecycle outlives one kernel (the cloud
 *     control-plane driver, reused as the proxy base of every environment
 *     kernel; per-environment drivers cached across kernel rebuilds), or
 *   - a test double.
 *
 * Before this seam, such a host had exactly two options: keep the pre-built
 *  driver on the legacy `DriverPlugin` path — whose connect verdict lives in
 * `ObjectQLEngine.init()`, the second implementation #3826 exists to retire —
 * or fork the connect orchestration. Both re-open the #3741 → #3758 drift.
 *
 * The factory abstraction already IS the adopt seam: `create()` never promised
 * to construct anything, only to return a handle. So the host wraps its
 * instance in this factory and hands the pair (definition, factory) to the one
 * shared path — same policy gate, same `bootCritical` fail-fast, same
 * `OS_ALLOW_DRIVER_CONNECT_FAILURE` escape hatch, same retained verdict —
 * while pooling/reuse stay entirely the host's business. Every open-core
 * driver's `connect()` is idempotent (re-verified in #3869), so adopting an
 * already-connected instance re-connects it harmlessly — that re-connect is
 * the boot verification #3741 wants anyway.
 *
 * NOT for the common case: a host that can express its datasource as
 * `{ driver, config }` should do that and let the shared factory build it —
 * a definition is inspectable, restartable, and admin-visible in ways a live
 * object is not.
 */

import type {
  IDatasourceDriverFactory,
  DatasourceConnectionSpec,
  DatasourceDriverHandle,
} from './contracts/index.js';

/** Minimal engine-driver surface this wrapper forwards to the handle. */
interface PrebuiltDriverLike {
  name?: string;
  connect?: () => Promise<unknown> | unknown;
  disconnect?: () => Promise<unknown> | unknown;
  checkHealth?: () => Promise<boolean> | boolean;
}

export interface PrebuiltDriverFactoryOptions {
  /**
   * Restrict `supports()` to this driver id (e.g. `'turso'`). When omitted the
   * factory answers `true` for every id — fine when the host builds the factory
   * per-datasource right next to its definition, too loose to compose into a
   * multi-kind dispatch.
   */
  driverId?: string;
  /**
   * Consulted for every id {@link PrebuiltDriverFactoryOptions.driverId} does
   * not match (and, when `driverId` is omitted, never) — lets one factory serve
   * "this pre-built instance for `turso`, the shared open-core factory for
   * everything else".
   */
  fallback?: IDatasourceDriverFactory;
}

/**
 * Wrap an already-constructed engine driver in an
 * {@link IDatasourceDriverFactory} so `DatasourceConnectionService` can adopt
 * it through the one shared connect path. `create()` returns the SAME instance
 * on every call — construction, pooling, and reuse remain host concerns.
 */
export function createPrebuiltDriverFactory(
  driver: PrebuiltDriverLike,
  options: PrebuiltDriverFactoryOptions = {},
): IDatasourceDriverFactory {
  const { driverId, fallback } = options;
  const matches = (id: string): boolean =>
    driverId === undefined || String(id ?? '').toLowerCase() === driverId.toLowerCase();

  return {
    supports(id: string): boolean {
      if (matches(id)) return true;
      return fallback?.supports(id) ?? false;
    },

    create(spec: DatasourceConnectionSpec): Promise<DatasourceDriverHandle> | DatasourceDriverHandle {
      if (!matches(spec.driver)) {
        if (fallback) return fallback.create(spec);
        throw new Error(
          `prebuilt driver factory only supports driver '${driverId}', got '${spec.driver}'`,
        );
      }
      // Mirrors the shared factory's `toHandle`: expose the driver's own
      // lifecycle on the handle (async-normalized to the contract), and the
      // instance itself as the `driver` escape hatch the connection service
      // registers into the engine.
      const health =
        typeof driver.checkHealth === 'function'
          ? async () => Boolean(await driver.checkHealth!())
          : undefined;
      return {
        connect: typeof driver.connect === 'function' ? async () => { await driver.connect!(); } : undefined,
        disconnect: typeof driver.disconnect === 'function' ? async () => { await driver.disconnect!(); } : undefined,
        checkHealth: health,
        ping: health,
        driver,
      };
    },
  };
}
