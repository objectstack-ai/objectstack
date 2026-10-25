/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// export { ObjectStackAdapter, createObjectStackAdapter } from './objectstack-adapter';
// ObjectStack adapter has been moved to @object-ui/data-objectstack

// Generic data source adapters (no external SDK dependencies)
export { ApiDataSource, type ApiDataSourceConfig } from './ApiDataSource.js';
export { ValueDataSource, type ValueDataSourceConfig } from './ValueDataSource.js';
export { resolveDataSource, type ResolveDataSourceOptions } from './resolveDataSource.js';
export { emulateBatchTransaction, runBatchTransaction } from './batchTransaction.js';
