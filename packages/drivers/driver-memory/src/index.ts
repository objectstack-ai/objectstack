// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { InMemoryDriver } from './memory-driver.js';

export { InMemoryDriver }; // Export class for direct usage
export type { InMemoryDriverConfig, PersistenceAdapterInterface } from './memory-driver.js';

export { FileSystemPersistenceAdapter } from './persistence/file-adapter.js';
export { LocalStoragePersistenceAdapter } from './persistence/local-storage-adapter.js';

export { MemoryAnalyticsService } from './memory-analytics.js';
export type { MemoryAnalyticsConfig } from './memory-analytics.js';

export { InMemoryStrategy } from './in-memory-strategy.js';

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
