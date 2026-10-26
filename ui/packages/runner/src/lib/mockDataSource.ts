/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type {
  DataSource,
  BatchTransactionOperation,
  QueryParams,
  QueryResult,
} from '@object-ui/types';
import { emulateBatchTransaction } from '@object-ui/core';

/**
 * 模拟数据源 (Mock Adapter)
 * 在真实项目中，你会在这里使用 fetch/axios 调用你的 API。
 */
export class MockDataSource implements DataSource {
  async find(_resource: string, _params?: QueryParams): Promise<QueryResult> {
    // `find` returns an envelope, not a bare array — consumers read `.data`
    // and `.total` (see QueryResult). Returning `[]` here would leave every
    // caller with `undefined` data.
    return { data: [], total: 0 };
  }

  async findOne(_resource: string, _id: string): Promise<any> {
    return null;
  }

  async create(resource: string, data: any): Promise<any> {
    // 模拟网络请求
    await new Promise(resolve => setTimeout(resolve, 800));

    alert(`Success! Created record in "${resource}":\n${JSON.stringify(data, null, 2)}`);
    
    return { id: Math.random().toString(), ...data };
  }

  async update(_resource: string, _id: string, data: any): Promise<any> {
    return data;
  }

  async delete(_resource: string, _id: string): Promise<any> {
    return true;
  }

  batchTransaction(
    operations: BatchTransactionOperation[],
  ): Promise<{ results: any[] }> {
    return emulateBatchTransaction(this, operations);
  }

  async getObjectSchema(objectName: string): Promise<any> {
    if (!objectName || typeof objectName !== 'string') {
      throw new Error('Invalid object name');
    }

    // Return a minimal schema for mock purposes
    return {
      name: objectName,
      label: objectName,
      fields: {}
    };
  }
}
