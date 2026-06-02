// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IDatasourceAdminService — runtime datasource lifecycle contract
 * (ADR-0015 Addendum: Runtime UI-Created Datasources).
 *
 * Where {@link IExternalDatasourceService} covers *federation* (introspection,
 * object drafting, schema validation) of datasources that already exist, this
 * service covers their *lifecycle*: testing a connection before saving,
 * creating / updating / removing a **runtime** datasource (`origin: 'runtime'`),
 * and listing all datasources with their provenance + health.
 *
 * Code-defined datasources (`origin: 'code'`, authored as `*.datasource.ts`)
 * are read-only here: `updateDatasource` / `removeDatasource` reject them, and
 * a runtime datasource never shadows a code one of the same name (code wins).
 *
 * Credentials are never persisted in cleartext: callers pass a {@link SecretInput}
 * separately from the connection `config`; the implementation encrypts it into
 * the secret store (`sys_secret`) and persists only an opaque `credentialsRef`.
 */

/** Provenance of a datasource definition. */
export type DatasourceOrigin = 'code' | 'runtime';

/**
 * A cleartext secret (password or full connection string) supplied for a
 * create/update/test call. Never persisted as-is — encrypted into the secret
 * store, with only the returned handle (`credentialsRef`) kept on the record.
 */
export interface SecretInput {
  /** The cleartext value to encrypt (e.g. password or connection string). */
  value: string;
  /** Optional secret-store namespace (defaults to `'datasource'`). */
  namespace?: string;
  /** Optional secret-store key (defaults to the datasource name). */
  key?: string;
}

/**
 * The connection definition a caller supplies to test/create/update. A subset
 * of `Datasource` — server-managed fields (`origin`) are never accepted from
 * the client.
 */
export interface DatasourceDraft {
  name: string;
  label?: string;
  driver: string;
  schemaMode?: 'managed' | 'external' | 'validate-only';
  /** Driver-specific connection config (host, port, database, …). No secrets. */
  config?: Record<string, unknown>;
  /** External federation settings (required when schemaMode != 'managed'). */
  external?: Record<string, unknown>;
  pool?: Record<string, unknown>;
  active?: boolean;
}

/** Result of probing a connection (live driver connect + cheap round-trip). */
export interface TestConnectionResult {
  ok: boolean;
  /** Round-trip latency of the probe, when the connection succeeded. */
  latencyMs?: number;
  /** Driver-reported server version, when available. */
  serverVersion?: string;
  /** Human-readable failure reason, when `ok === false`. */
  error?: string;
}

/** A datasource with its provenance and current health (no secrets). */
export interface DatasourceSummary {
  name: string;
  label?: string;
  driver: string;
  schemaMode: 'managed' | 'external' | 'validate-only';
  origin: DatasourceOrigin;
  active: boolean;
  /** Validation health: `unvalidated` until the first validate/test runs. */
  status: 'ok' | 'error' | 'unvalidated';
  /** Package id that defines a code-origin datasource (omitted for runtime). */
  definedIn?: string;
  /** True when a runtime row is shadowed by a code definition of the same name. */
  conflictsWithCode?: boolean;
}

/**
 * Runtime datasource lifecycle service. Registered into the kernel as the
 * `'datasource-admin'` service; consumed by the REST layer and Studio wizard.
 */
export interface IDatasourceAdminService {
  /** List every datasource (code + runtime) with provenance and health. */
  listDatasources(): Promise<DatasourceSummary[]>;

  /**
   * Probe a connection without persisting anything. Accepts an unsaved draft
   * so the wizard can validate credentials before "Save".
   */
  testConnection(input: DatasourceDraft, secret?: SecretInput): Promise<TestConnectionResult>;

  /**
   * Persist a new runtime datasource (`origin: 'runtime'`, environment-scoped).
   * Rejects when a code-defined datasource of the same name exists.
   */
  createDatasource(input: DatasourceDraft, secret?: SecretInput): Promise<DatasourceSummary>;

  /**
   * Patch an existing runtime datasource. Rejects for code-defined datasources.
   * Passing `secret` re-wraps the stored credential.
   */
  updateDatasource(
    name: string,
    patch: Partial<DatasourceDraft>,
    secret?: SecretInput,
  ): Promise<DatasourceSummary>;

  /**
   * Remove a runtime datasource. Rejects for code-defined ones and while
   * objects are still bound to it.
   */
  removeDatasource(name: string): Promise<void>;
}
