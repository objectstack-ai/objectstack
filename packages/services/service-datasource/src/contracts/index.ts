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

// Host-injectable connect policy (ADR-0062 D5 / epic #2163 seam).
export {
  allowAllConnectPolicy,
} from './connect-policy.js';
export type {
  DatasourceConnectPolicy,
  DatasourceConnectDecision,
  DatasourceConnectContext,
  DatasourceConnectSubject,
} from './connect-policy.js';
