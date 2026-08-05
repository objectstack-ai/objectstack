// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/driver-turso
 *
 * Turso/libSQL driver for ObjectStack — edge-first, globally distributed
 * SQLite with embedded replicas.
 *
 * Extends `@objectstack/driver-sql` (SqlDriver) and inherits all CRUD,
 * schema management, filtering, aggregation, and introspection logic.
 * Only Turso-specific features (connection modes, sync) are implemented
 * here — zero duplicated query/schema code.
 *
 * Database-per-tenant routing is NOT part of this package: it is a cloud
 * product capability and stays in the closed `objectstack-ai/cloud` repo
 * (#4645 decision 2), layered on top of this driver rather than inside it.
 *
 * Supports four connection modes:
 * 1. Local (Embedded): `url: 'file:./data/local.db'`
 * 2. In-Memory (Testing): `url: ':memory:'`
 * 3. Embedded Replica (Hybrid): `url` + `syncUrl`
 * 4. Remote (Cloud): `url: 'libsql://my-db.turso.io'`
 *
 * @example
 * ```typescript
 * import { TursoDriver } from '@objectstack/driver-turso';
 *
 * const driver = new TursoDriver({
 *   url: 'file:./data/app.db',
 * });
 * await driver.connect();
 * ```
 */

import { TursoDriver } from './turso-driver.js';

export { TursoDriver, type TursoDriverConfig, type TursoTransportMode } from './turso-driver.js';
export { RemoteTransport, type FilterColumnSqlResolver } from './remote-transport.js';

// Spec / Studio metadata for the Turso driver — published from this package
// so a host exposes Turso configuration UI without the driver-specific shape
// landing in the shared `@objectstack/spec` surface.
export * from './spec/turso.zod.js';

/**
 * Factory function to create a TursoDriver instance.
 *
 * @param config - Turso driver configuration
 * @returns A new TursoDriver instance (not yet connected)
 *
 * @example
 * ```typescript
 * import { createTursoDriver } from '@objectstack/driver-turso';
 *
 * // Local file
 * const driver = createTursoDriver({ url: 'file:./data/app.db' });
 *
 * // In-memory (testing)
 * const driver = createTursoDriver({ url: ':memory:' });
 *
 * // Embedded replica
 * const driver = createTursoDriver({
 *   url: 'file:./data/replica.db',
 *   syncUrl: 'libsql://my-db-orgname.turso.io',
 *   authToken: process.env.TURSO_AUTH_TOKEN,
 *   sync: { intervalSeconds: 60, onConnect: true },
 * });
 *
 * await driver.connect();
 * ```
 */
export function createTursoDriver(config: import('./turso-driver.js').TursoDriverConfig): TursoDriver {
  return new TursoDriver(config);
}

export default {
  id: 'com.objectstack.driver.turso',
  version: '1.0.0',

  onEnable: async (context: any) => {
    const { logger, config, drivers } = context;
    logger.info('[Turso Driver] Initializing...');

    if (drivers) {
      const driver = new TursoDriver(config);
      drivers.register(driver);
      logger.info(`[Turso Driver] Registered driver: ${driver.name}`);
    } else {
      logger.warn('[Turso Driver] No driver registry found in context.');
    }
  },
};
