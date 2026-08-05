// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { SqliteWasmDriver } from './sqlite-wasm-driver.js';

export { SqliteWasmDriver };
export type { SqliteWasmDriverConfig } from './sqlite-wasm-driver.js';
export { Client_WasmSqlite } from './knex-wasm-dialect.js';
export type { WasmSqliteConnectionSettings } from './knex-wasm-dialect.js';
export { WasmSqliteConnection } from './wasm-connection.js';
export type { PersistMode, WasmConnectionOptions } from './wasm-connection.js';

export default {
  id: 'com.objectstack.driver.sqlite-wasm',
  version: '1.0.0',

  onEnable: async (context: any) => {
    const { logger, config, drivers } = context;
    logger?.info?.('[SQLite-WASM Driver] Initializing...');

    if (drivers) {
      const driver = new SqliteWasmDriver(config);
      drivers.register(driver);
      logger?.info?.(`[SQLite-WASM Driver] Registered driver: ${driver.name}`);
    } else {
      logger?.warn?.('[SQLite-WASM Driver] No driver registry found in context.');
    }
  },
};
