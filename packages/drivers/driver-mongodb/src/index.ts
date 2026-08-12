// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { MongoDBDriver } from './mongodb-driver.js';

export { MongoDBDriver };
export type { MongoDBDriverConfig } from './mongodb-driver.js';
export { translateFilter } from './mongodb-filter.js';
export {
  buildAggregationPipeline,
  postProcessAggregation,
  MONGODB_DATE_GRANULARITIES,
} from './mongodb-aggregation.js';
export type { AggregationInput } from './mongodb-aggregation.js';
export {
  MongoDBMultiTenantUnsupportedError,
  MULTI_TENANT_UNSUPPORTED_CODE,
  assertSingleTenantPosture,
  assertObjectsNotTenantScoped,
  declaresTenantScope,
} from './mongodb-tenancy-guard.js';

export default {
  id: 'com.objectstack.driver.mongodb',
  version: '1.0.0',

  onEnable: async (context: any) => {
    const { logger, config, drivers } = context;
    logger.info('[MongoDB Driver] Initializing...');

    if (drivers) {
      const driver = new MongoDBDriver(config);
      drivers.register(driver);
      logger.info(`[MongoDB Driver] Registered driver: ${driver.name}`);
    } else {
      logger.warn('[MongoDB Driver] No driver registry found in context.');
    }
  },
};
