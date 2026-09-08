// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { InMemoryDriver } from './memory-driver.js';

export { InMemoryDriver }; // Export class for direct usage
export type { InMemoryDriverConfig, PersistenceAdapterInterface } from './memory-driver.js';

export { FileSystemPersistenceAdapter } from './persistence/file-adapter.js';
export { LocalStoragePersistenceAdapter } from './persistence/local-storage-adapter.js';

export { MemoryAnalyticsService } from './memory-analytics.js';
export type { MemoryAnalyticsConfig } from './memory-analytics.js';

export { InMemoryStrategy } from './in-memory-strategy.js';

export {
  MemoryMultiTenantUnsupportedError,
  MULTI_TENANT_UNSUPPORTED_CODE,
  assertSingleTenantPosture,
  assertObjectsNotTenantScoped,
  declaresTenantScope,
} from './memory-tenancy-guard.js';
export type { TenancyAwareSchema } from './memory-tenancy-guard.js';

// [#13197, #13239] Uniqueness on BOTH declaration surfaces — field-level
// `unique` and object-level declared `indexes[]` — with the refusal's wire
// identity and the scoping helpers, exported so a consumer can assert the
// envelope (`code` AND `status`, never merely "it threw") without
// string-matching the message.
export {
  UNIQUE_VIOLATION_CODE,
  UNIQUE_VIOLATION_STATUS,
  assertNoUniqueViolation,
  declaredIndexViolationError,
  isDeclaredIndexConstraint,
  tenantFieldOf,
  uniqueConstraintsFromDeclaredIndexes,
  uniqueConstraintsFromFields,
  uniqueKeyOf,
  uniqueViolationError,
} from './memory-unique-constraint.js';
export type {
  DeclaredIndexInput,
  MemoryDeclaredIndexConstraint,
  MemoryUniqueConstraint,
  MemoryUniqueEnforcement,
  UniqueAwareSchema,
} from './memory-unique-constraint.js';

// [#16589] Read-side tenant scoping, exported for the same reason the
// uniqueness helpers above are: a consumer verifying an isolation property on
// this driver can assert the PREDICATE directly instead of inferring it from a
// row count. ⚠️ Every isolation measurement taken on this driver BEFORE #16589
// is void — it was taken against a driver that returned every organization's
// rows to everyone — and has to be re-taken.
export { recordTenantField, tenantScopePredicate } from './memory-tenant-scope.js';
export type { TenantRowPredicate } from './memory-tenant-scope.js';

export default {
  id: 'com.objectstack.driver.memory',
  version: '1.0.0',

  onEnable: async (context: any) => {
    const { logger, config, drivers } = context;
    logger.info('[Memory Driver] Initializing...');

    if (drivers) {
       const driver = new InMemoryDriver(config);
       drivers.register(driver);
       logger.info(`[Memory Driver] Registered driver: ${driver.name}`);
    } else {
       logger.warn('[Memory Driver] No driver registry found in context.');
    }
  }
};
