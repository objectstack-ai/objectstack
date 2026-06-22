// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { SqlDriver } from './sql-driver.js';

export { SqlDriver };
export type {
  SqlDriverConfig,
  IntrospectedSchema,
  IntrospectedTable,
  IntrospectedColumn,
  IntrospectedForeignKey,
} from './sql-driver.js';

// Managed-schema drift / reconcile (#2186)
export {
  diffManagedTable,
  driftKey,
  fieldHasColumn,
  BUILTIN_COLUMNS,
} from './schema-drift.js';
export type {
  ManagedDriftEntry,
  DriftOp,
  DriftCategory,
  SqlDialectName,
  PhysicalColumn,
  FieldDef as DriftFieldDef,
} from './schema-drift.js';

export default {
  id: 'com.objectstack.driver.sql',
  version: '1.0.0',

  onEnable: async (context: any) => {
    const { logger, config, drivers } = context;
    logger.info('[SQL Driver] Initializing...');

    if (drivers) {
      const driver = new SqlDriver(config);
      drivers.register(driver);
      logger.info(`[SQL Driver] Registered driver: ${driver.name}`);
    } else {
      logger.warn('[SQL Driver] No driver registry found in context.');
    }
  },
};
