// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The dev schema self-heal decision (#2186) — ONE home, read by every boot host.
 *
 * `os dev` runs the SQL drivers with `autoMigrate: 'safe'`: on restart, the safe
 * drift `os migrate plan` lists (a relaxed NOT NULL, a widened column, a unique
 * index that becomes NULL-safe once its duplicate probe is clean) is applied to
 * the existing dev database, and the destructive kind is only ever warned about.
 * The decision has two halves, and both live here:
 *
 *   - **When** — a dev boot, as its HOST declares it (`dev`). Production never
 *     gets it. The SQL driver also refuses it under `NODE_ENV=production`; that
 *     is the driver's own second guard, not a copy of this rule.
 *   - **For which drivers** — the kinds whose connection contract declares
 *     `autoMigrate` (`@objectstack/spec`'s `SqliteConfigSchema`,
 *     `PostgresConfigSchema` and `MysqlConfigSchema`), which are exactly the
 *     kinds the shared datasource factory hands it to `SqlDriver` for.
 *     `sqlite-wasm`, `mongodb` and `turso` declare no such key: a config key the
 *     driver silently ignores is the declared ≠ enforced shape, so they get
 *     nothing. `dev-auto-migrate.test.ts` holds this set equal to the contract.
 *
 * The readers, which must never carry the condition themselves:
 *
 *   - `createStandaloneStack` — the `default` datasource of every plain
 *     `os dev` / `os serve` / `os start` boot, over a config or an artifact;
 *   - the CLI's config-load fallback (`resolveStorageDefinition`, reached by a
 *     host config or `OS_MODE=off`) and the `telemetry` sibling datasource the
 *     CLI provisions next to a file-backed SQLite primary.
 *
 * Until #21733 only the CLI's fallback carried it, as an inline
 * `isDev ? { autoMigrate: 'safe' } : {}`. The standalone stack built its
 * definition without it, so a plain `os dev` on a non-host config never
 * self-healed, while the plan and drift lines the driver prints said the
 * change was "auto-applied at boot under dev autoMigrate: 'safe'".
 */

import type { BuiltinDriverId } from '@objectstack/spec/data';

/**
 * The datasource-config fragment the self-heal rides in — `config.autoMigrate`,
 * the host-composition passthrough ADR-0062 records — or nothing.
 */
export type DevAutoMigrateConfig = { readonly autoMigrate?: 'safe' };

/** The driver kinds whose connection contract declares `autoMigrate`. */
const DEV_AUTO_MIGRATE_DRIVERS: ReadonlySet<BuiltinDriverId> = new Set<BuiltinDriverId>([
    'sqlite',
    'postgres',
    'mysql',
]);

/**
 * The self-heal fragment for one datasource definition: `{ autoMigrate: 'safe' }`
 * on a dev boot for a driver whose contract declares the key, `{}` otherwise.
 * Spread it into the definition's `config`.
 *
 * @param driver the CANONICAL driver id the definition is built for
 * @param dev    the host's declaration that this is a dev boot. A one-shot
 *               command boot is never one, whatever `NODE_ENV` says: it must
 *               apply only what its operator confirmed.
 */
export function devAutoMigrateConfig(driver: BuiltinDriverId, dev: boolean): DevAutoMigrateConfig {
    return dev && DEV_AUTO_MIGRATE_DRIVERS.has(driver) ? { autoMigrate: 'safe' } : {};
}
