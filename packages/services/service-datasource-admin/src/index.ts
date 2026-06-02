// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/service-datasource-admin — runtime UI-created datasource
 * lifecycle (ADR-0015 Addendum). Open-source mechanism: list / test / create /
 * update / remove datasources defined in the UI. Credential storage is
 * delegated to a host-provided {@link SecretBinder} (over an `ICryptoProvider`)
 * and drivers to a swappable factory, so a managed credential vault /
 * multi-tenant overlay can be layered on by a private host without forking.
 * See README for host wiring.
 */

// Contracts (the canonical datasource-admin DTOs; re-exported here).
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

// Inlined Logger surface (severs dependency on the federation service).
export type { Logger } from './logger.js';
