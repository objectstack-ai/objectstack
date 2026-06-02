// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Datasource lifecycle + driver-factory contracts (ADR-0015 Addendum).
// Moved out of `@objectstack/spec` so the open framework no longer ships them.
export type {
  DatasourceOrigin,
  SecretInput,
  DatasourceDraft,
  TestConnectionResult,
  DatasourceSummary,
  IDatasourceAdminService,
} from './datasource-admin-service.js';

export type {
  DatasourceConnectionSpec,
  DatasourceDriverHandle,
  IDatasourceDriverFactory,
} from './datasource-driver-factory.js';
