// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/service-datasource — the datasource service (ADR-0015).
 *
 * Two cohesive halves of one capability:
 *  - **Federation** (ADR-0015 main body): introspect / draft / import /
 *    validate external tables — {@link ExternalDatasourceServicePlugin}.
 *  - **Runtime admin** (ADR-0015 Addendum): the "Add Datasource" wizard
 *    backend — list / test / create / update / remove datasources defined in
 *    the UI at runtime, plus its REST routes — {@link DatasourceAdminServicePlugin}.
 *
 * Open-source mechanism throughout. The tier line falls on which
 * `ICryptoProvider` / driver factory a host injects into the admin plugin, not
 * on whether the UI can manage datasources.
 */

// ── Federation (ADR-0015 main body) ───────────────────────────────────
export { ExternalDatasourceService } from './external-datasource-service.js';
export type {
  ExternalDatasourceServiceConfig,
  DatasourceLike,
  ObjectLike,
  // Canonical minimal logger surface for the whole package.
  Logger,
} from './external-datasource-service.js';
export { ExternalDatasourceServicePlugin } from './plugin.js';
export type { ExternalDatasourceServicePluginOptions } from './plugin.js';

// ── Runtime admin (ADR-0015 Addendum) ─────────────────────────────────
// Contracts (the canonical datasource-admin DTOs).
export type {
  DatasourceOrigin,
  SecretInput,
  DatasourceDraft,
  TestConnectionResult,
  DatasourceSummary,
  CredentialMigrationResult,
  IDatasourceAdminService,
  DatasourceConnectionSpec,
  DatasourceDriverHandle,
  DatasourceDriverOwnership,
  IDatasourceDriverFactory,
  // Connect policy (ADR-0062 D5 / epic #2163 seam).
  DatasourceConnectPolicy,
  DatasourceConnectDecision,
  DatasourceConnectContext,
  DatasourceConnectSubject,
} from './contracts/index.js';
export { allowAllConnectPolicy } from './contracts/index.js';

// Shared "definition → live driver" path (ADR-0062 D1).
export { DatasourceConnectionService, isDatasourceAddressed } from './datasource-connection-service.js';
export type {
  DatasourceConnectionServiceConfig,
  ConnectableDatasource,
  DatasourceBoundObject,
  ConnectionEngineLike,
  ConnectionSecretResolver,
  ConnectResult,
  ConnectStatus,
} from './datasource-connection-service.js';

// The #8155 credential re-homing planner — exported so a host that drives the
// migration through its own surface asks the same question the Setup action
// asks, rather than re-deriving which stored keys are safe to re-home.
export { planCredentialMigration, urlCredentialKeys } from './datasource-credential-migration.js';
export type { CredentialMigrationPlan } from './datasource-credential-migration.js';

// Decoupled lifecycle service + injected-config shape.
export { DatasourceAdminService } from './datasource-admin-service.js';
export type {
  DatasourceAdminServiceConfig,
  StoredDatasource,
  ProbeInput,
} from './datasource-admin-service.js';

// Kernel plugin (registers the `'datasource-admin'` service).
export { DatasourceAdminServicePlugin } from './datasource-admin-plugin.js';
export type {
  DatasourceAdminServicePluginOptions,
  SecretBinder,
} from './datasource-admin-plugin.js';

// Which driver arms read `datasource.pool`, and the loud rejection for the ones
// that do not (#5714) — exported so a host that injects its OWN driver factory
// can hold the same contract instead of re-deriving (or silently dropping) it.
// `POOL_UNREAD_KEYS_BY_DRIVER` / `unreadPoolKeys` / `unreadPoolKeysMessage` are
// the per-KEY half added by #7243, for the arm that reads the block but not
// every key in it (`mongodb`). `unsupportedPoolIssue` already covers both, so an
// injected factory needs only that one; the parts are exported for the same
// reason the block-level ones are — so a host can ask the narrower question.
export {
  POOL_UNSUPPORTED_DRIVER_IDS,
  POOL_UNREAD_KEYS_BY_DRIVER,
  driverReadsDeclaredPool,
  unreadPoolKeys,
  unsupportedPoolIssue,
  unsupportedPoolMessage,
  unreadPoolKeysMessage,
  assertDatasourcePoolSupported,
} from './datasource-pool-support.js';
export type { PoolUnsupportedDriverId } from './datasource-pool-support.js';

// Host glue: dev driver factory + fail-closed secret binder.
export { createDefaultDatasourceDriverFactory } from './default-datasource-driver-factory.js';
// The OPTIONAL libSQL/Turso package and its install command, plus the
// missing-package message this factory raises (#7314) — exported so the answer
// to "how do I install it" has one declaration a host can read rather than a
// sentence to re-type. `@objectstack/runtime`'s host loader consumes these
// (it depends on this package, which is the legal import direction) rather than
// keeping its own equal pair.
export {
  TURSO_DRIVER_PACKAGE,
  TURSO_DRIVER_INSTALL_COMMAND,
  missingTursoDriverMessage,
} from './default-datasource-driver-factory.js';
// The typed "that OPTIONAL package is not installed" failure (#7314). Declared
// HERE, in the lowest package that raises it, so the host loaders in
// `@objectstack/runtime` / `@objectstack/cli` and the open-core arm in this
// package throw ONE class object — which is what keeps `serve.ts`'s
// `e instanceof MissingDriverPackageError` fatal branch matching. `runtime`
// re-exports it from its old home, so importers written before the move keep
// compiling against the same class.
export { MissingDriverPackageError } from './missing-driver-package-error.js';
// The single read of a spec's libSQL config (#7314) — the host loader and the
// open-core arm both build the driver from THIS, instead of each hand-listing
// the keys it happens to know about. Exported so the runtime lane can call it
// and so a pin can assert the surface without re-typing the list.
export {
  buildTursoDriverConfig,
  resolveTursoUrl,
  TURSO_DRIVER_CONFIG_KEYS,
} from './turso-driver-config.js';
export type { TursoDriverConfigInput } from './turso-driver-config.js';
// ADR-0015 schema-ownership resolution, shared by every driver arm and by the
// libSQL config builder above (#7314).
export { resolveDatasourceSchemaMode } from './datasource-schema-mode.js';
// The other two OPTIONAL driver packages this factory can be asked for, and the
// messages it raises when they are absent (#7385) — same seam as the libSQL pair
// above, because the three arms answer one class of problem and had answered it
// at two different qualities: `turso` stated the install command, the
// consequence and the refusal, while `sqlite-wasm` and `mongodb` stated only the
// fault. Exported for the same reason: a host rendering its own remedy reads one
// declaration instead of re-typing a command.
export {
  SQLITE_WASM_DRIVER_PACKAGE,
  SQLITE_WASM_DRIVER_INSTALL_COMMAND,
  missingSqliteWasmDriverMessage,
  MONGODB_DRIVER_PACKAGE,
  MONGODB_DRIVER_INSTALL_COMMAND,
  missingMongodbDriverMessage,
} from './default-datasource-driver-factory.js';
// The "adopt a host-built driver instance" seam (ADR-0062 D1, #3826) — for
// driver kinds outside open-core (cloud turso) and pooled instances whose
// lifecycle outlives one kernel; keeps the connect + failure verdict on the
// one shared path instead of the legacy DriverPlugin/engine-init pair.
export { createPrebuiltDriverFactory } from './prebuilt-driver-factory.js';
export type { PrebuiltDriverFactoryOptions } from './prebuilt-driver-factory.js';
// Shared native-better-sqlite3 → wasm → in-memory step-down (#2229).
export {
  resolveSqliteDriver,
  NATIVE_SQLITE_WASM_FALLBACK_WARNING,
  NATIVE_SQLITE_MEMORY_FALLBACK_WARNING,
} from './sqlite-driver-fallback.js';
export type {
  ResolveSqliteDriverOptions,
  ResolvedSqliteDriver,
  SqliteFallbackEngine,
} from './sqlite-driver-fallback.js';
export {
  createDatasourceSecretBinder,
  toCredentialsRef,
  parseCredentialsRef,
} from './datasource-secret-binder.js';
export type {
  DatasourceSecretBinder,
  DatasourceSecretBinderDeps,
  SecretStoreEngineLike,
} from './datasource-secret-binder.js';

// REST routes.
export { registerDatasourceAdminRoutes } from './admin-routes.js';
