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
  /**
   * Current availability, taken from the last connect attempt (framework#3827):
   *
   *  - `ok`          — a live driver is registered and routable.
   *  - `error`       — a connect was attempted and failed (unreachable, bad
   *                    credential, unsupported driver). See {@link statusReason}.
   *  - `blocked`     — the host's connect policy refused it. A decision, not a
   *                    fault; it will not clear on its own.
   *  - `unvalidated` — no connect attempted. Includes a `managed` datasource
   *                    left metadata-only by the ADR-0062 D2 gate, and a runtime
   *                    row nobody has tested yet.
   *
   * This was hardcoded to `unvalidated` for every row, which made a dead
   * datasource indistinguishable from a healthy-but-untested one — the reason a
   * failed boot connect stayed invisible for the rest of the process.
   */
  status: 'ok' | 'error' | 'blocked' | 'unvalidated';
  /**
   * Operator-facing detail behind `error` / `blocked`. PRIVILEGED: it is the raw
   * connect error or the policy's `reason`, so it can name hosts, ports and
   * internal plans. This surface is already admin-gated; the end-user
   * query-time error deliberately carries none of it (framework#3828).
   */
  statusReason?: string;
  /** Package id that defines a code-origin datasource (omitted for runtime). */
  definedIn?: string;
  /** True when a runtime row is shadowed by a code definition of the same name. */
  conflictsWithCode?: boolean;
}

/**
 * Outcome of one operator-initiated credential re-homing run (#8155).
 *
 * Every field is safe to serve: the cleartext never appears, and neither does
 * the `credentialsRef` itself — the read path deliberately reports a boolean
 * `hasSecret` rather than the handle, and this result keeps that boundary.
 */
export interface CredentialMigrationResult {
  name: string;
  /**
   *  - `migrated`          — a stored cleartext credential is now in the secret
   *                          store and the inline key is gone.
   *  - `already-bound`     — the row already referenced a secret and held no
   *                          inline copy. A re-run is a no-op: nothing bound,
   *                          nothing written, and **no second `sys_secret` row**.
   *  - `nothing-to-migrate`— the row holds no bindable credential at all.
   *  - `refused`           — it cannot be re-homed safely; see `reason` /
   *                          `remedy`, which name the manual route instead.
   */
  status: 'migrated' | 'already-bound' | 'nothing-to-migrate' | 'refused';
  /** The `config` key whose cleartext was re-homed (`migrated` only). */
  migratedKey?: string;
  /**
   * True when an existing `credentialsRef` was reused — an interrupted earlier
   * run, or a wizard re-entry that left the inline copy behind — so the run
   * dropped the inline key without minting a second secret.
   */
  reusedExistingSecret?: boolean;
  /**
   * Credential-shaped `config` keys still at rest after this run: pre-#8078
   * alias spellings and credential-shaped-but-writable keys, which no
   * connection builder reads as the credential. Named rather than silently
   * left, so "migrated" never reads as "this row is now clean".
   */
  remaining?: string[];
  /** Why the run refused (operator-facing). Present when `status` is `refused`. */
  reason?: string;
  /** What to do instead. Present when `status` is `refused`. */
  remedy?: string;
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

  /**
   * Re-home ONE runtime datasource's stored cleartext credential into the
   * secret store (#8155) — operator-initiated, per datasource, never a sweep.
   *
   * Reads the stored cleartext, binds it through the existing secret binder,
   * writes `external.credentialsRef`, and removes the inline key only after the
   * secret is durably readable back. Idempotent: a row that already references
   * a secret is never bound a second time. Rows it cannot re-home safely are
   * REFUSED with a stated reason and remedy rather than guessed at.
   */
  migrateCredential(name: string): Promise<CredentialMigrationResult>;
}
