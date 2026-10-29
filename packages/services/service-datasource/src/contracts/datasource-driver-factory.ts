// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IntrospectedSchema } from '@objectstack/spec/contracts';

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
  /**
   * Schema ownership mode (ADR-0015) — whether ObjectStack owns this schema or
   * is a guest in a database it must never run DDL against.
   *
   * Carried here since #4410. The factory used to look for it on `external`
   * (the federation-settings block, which has no such key) and then inside
   * `config` (which nothing ever wrote), so a datasource's own declared
   * `schemaMode` never reached the driver: an `external` database was
   * constructed as `managed`, with DDL ungated at the driver level.
   */
  schemaMode?: 'managed' | 'external' | 'validate-only';
  /** Cleartext secret (password / DSN) injected for this connection only. */
  secret?: string;
  /** External federation settings (timeouts, allowed schemas, …). */
  external?: Record<string, unknown>;
  /** Connection pool settings. */
  pool?: Record<string, unknown>;
  /**
   * Datasource-level TLS block (`enabled`, `rejectUnauthorized`, `ca`, `cert`,
   * `key`).
   *
   * Carried here since #4410. It was declared on the datasource, strict,
   * documented — and never reached a driver, because it stopped at the record:
   * nothing put it on this spec. So a TLS configuration that never took effect
   * looked exactly like one that did, which is the failure `datasource.ssl`'s
   * own schema comment warns about.
   */
  ssl?: Record<string, unknown>;
}

/**
 * Who owns the TEARDOWN of the driver instance behind a handle (ADR-0062 D5,
 * #3993):
 *  - `'factory'` (the default when absent) — the factory built this instance
 *    for this connect; the connection service may disconnect it when the
 *    kernel tears down.
 *  - `'host'` — an adopted, pre-built instance (`createPrebuiltDriverFactory`)
 *    whose lifecycle outlives the kernel (a pool shared across environment
 *    kernels, a control-plane driver doubling as a proxy base). Kernel
 *    teardown must NEVER disconnect it; the host does, on its own schedule.
 */
export type DatasourceDriverOwnership = 'factory' | 'host';

/**
 * A live (or lazily-connecting) driver handle. Intentionally structural and
 * fully optional so any concrete driver satisfies it — the admin service uses
 * whatever capabilities are present and skips the rest.
 *
 * "Fully optional" is about PRESENCE, not about shape: a member the driver
 * does expose must honour that member's declared contract. The one place the
 * distinction has already cost data is `introspectSchema` — see its own note.
 */
export interface DatasourceDriverHandle {
  /** Open the connection / pool. */
  connect?(): Promise<void>;
  /** Close the connection / pool. */
  disconnect?(): Promise<void>;
  /** Teardown ownership of the underlying instance — see {@link DatasourceDriverOwnership}. */
  ownership?: DatasourceDriverOwnership;
  /** Cheap liveness round-trip (preferred for probes). */
  ping?(): Promise<unknown>;
  /**
   * Introspect the live schema (fallback probe when `ping` is absent, and the
   * read the external-datasource federation path is built on).
   *
   * The return value is CONTRACTUAL: `packages/spec`'s one introspection
   * shape — {@link IntrospectedSchema}, whose columns spell primary-key
   * membership `primaryKey` and whose schema carries `dialect` and
   * `introspectedAt`. This member was typed `Promise<unknown>` until #11381
   * (option C of the #11123 ruling, 2026-08-23), which left the seam's OPEN
   * producer population — host-built drivers, per this file's own header —
   * unreachable by any compiler: a driver spelling the flag `isPrimary`, or
   * emitting `{ tables }` alone, compiled clean, and the mis-shape surfaced
   * only as a federated table whose records silently could not be located or
   * updated. Typed against the spec contract, `tsc` now refuses a mis-shaped
   * driver at the offending field (`Property 'primaryKey' is missing …` /
   * `'isPrimary' does not exist in type 'IntrospectedColumn'`).
   *
   * Extra facts a richer driver carries stay legal — driver-sql's table-level
   * `primaryKeys`, `foreignKeys`, per-column `maxLength` ride on declared
   * types that EXTEND the spec contract, and assignability admits them on any
   * non-literal value. What is refused is a WRONG spelling of a declared key,
   * which is the defect class this seam has actually shipped.
   *
   * Runtime is deliberately untouched: the `primaryKeyReader` compatibility
   * belt in `external-datasource-service.ts` keeps absorbing the retired
   * `isPrimary` spelling from already-built drivers (plain-JS drivers and
   * stale builds are reached by no compiler). Removing that belt is #11123
   * option B — a later, separate step gated on this tightening being released
   * AND the old spelling's retirement being published; it is not licensed by
   * this type.
   */
  introspectSchema?(): Promise<IntrospectedSchema>;
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
