// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IDatasourceDriverFactory — host-provided capability that builds a live driver
 * from a connection spec (ADR-0015 Addendum §3.5).
 *
 * The framework deliberately ships no universal "driver-by-id" registry —
 * concrete drivers (`SqlDriver`, `MongoDBDriver`, `TursoDriver`, …) are
 * constructed by the host stack and registered as live connections. The
 * runtime-datasource lifecycle (`IDatasourceAdminService`) needs to build a
 * driver from an *unsaved* draft — to probe a connection before "Save", and to
 * hot-register a pool after create/update — so the host exposes this factory
 * as the `'datasource-driver-factory'` service.
 *
 * When no factory is registered, or none `supports()` a given driver id, the
 * admin service degrades gracefully: `testConnection` returns
 * `{ ok: false, error }` and create/update skip hot pool registration (the
 * driver is picked up on the next boot instead).
 *
 * Security: the cleartext `secret` on {@link DatasourceConnectionSpec} is used
 * only to open the live connection. Factories MUST NOT persist or log it.
 */

/** Everything needed to construct one live driver connection. */
export interface DatasourceConnectionSpec {
  /** Datasource name, when building for an existing/named datasource. */
  name?: string;
  /** Driver id (e.g. `'postgres'`, `'sqlite'`, `'mongodb'`). */
  driver: string;
  /** Driver-specific connection config (host, port, database, …). No secrets. */
  config: Record<string, unknown>;
  /** Cleartext secret (password / DSN) injected for this connection only. */
  secret?: string;
  /** External federation settings (timeouts, allowed schemas, …). */
  external?: Record<string, unknown>;
  /** Connection pool settings. */
  pool?: Record<string, unknown>;
}

/**
 * A live (or lazily-connecting) driver handle. Intentionally structural and
 * fully optional so any concrete driver satisfies it — the admin service uses
 * whatever capabilities are present and skips the rest.
 */
export interface DatasourceDriverHandle {
  /** Open the connection / pool. */
  connect?(): Promise<void>;
  /** Close the connection / pool. */
  disconnect?(): Promise<void>;
  /** Cheap liveness round-trip (preferred for probes). */
  ping?(): Promise<unknown>;
  /** Introspect the live schema (fallback probe when `ping` is absent). */
  introspectSchema?(): Promise<unknown>;
  /** Liveness check on the underlying engine driver (probe fallback). */
  checkHealth?(): Promise<boolean>;
  /** Driver-reported server version, when available. */
  serverVersion?(): Promise<string | undefined>;
  /**
   * Escape hatch: the concrete engine driver to hand to
   * `IDataEngine.registerDriver()` when hot-registering a pool. When present
   * the admin service registers *this* (whose `.name` must equal the
   * datasource name for routing) instead of the handle itself; absent ⇒ the
   * handle is assumed to be the driver. Never serialized.
   */
  driver?: unknown;
}

/** Host-provided factory that builds drivers from connection specs. */
export interface IDatasourceDriverFactory {
  /** True if this factory can build a driver for the given driver id. */
  supports(driverId: string): boolean;
  /**
   * Build a driver instance for the spec. Implementations may return a
   * not-yet-connected handle; the caller calls `connect()` when needed.
   */
  create(spec: DatasourceConnectionSpec): Promise<DatasourceDriverHandle> | DatasourceDriverHandle;
}
