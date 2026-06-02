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
  IDatasourceAdminService,
  DatasourceConnectionSpec,
  DatasourceDriverHandle,
  IDatasourceDriverFactory,
} from './contracts/index.js';

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

// Host glue: dev driver factory + fail-closed secret binder.
export { createDefaultDatasourceDriverFactory } from './default-datasource-driver-factory.js';
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
