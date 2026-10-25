/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Example: Data Source Adapter
 * 
 * This example demonstrates implementing a REST API data source adapter
 * using the DataSource interface from @object-ui/types.
 */

import type { DataSource, QueryParams, QueryResult } from '../src/index';

/**
 * REST API Data Source Implementation
 *
 * A generic REST API adapter that works with any REST backend.
 *
 * Note: the optional `batchTransaction(operations)` method (used by
 * master-detail saves) is omitted here. If your backend has no atomic
 * cross-object endpoint, you don't need to hand-write orchestration —
 * implement it as `emulateBatchTransaction(this, operations)` from
 * `@object-ui/core` (sequential writes + `{ $ref }` resolution + best-effort
 * compensation). Omit it entirely and callers fall back to the same emulation
 * automatically via `runBatchTransaction`.
 */
export class RestDataSource<T = any> implements DataSource<T> {
  constructor(private baseUrl: string) {}

  /**
   * Build query string from QueryParams
   */
  private buildQueryString(params?: QueryParams): string {
    if (!params) return '';
    
    const searchParams = new URLSearchParams();
    
    if (params.$select) {
      searchParams.append('select', params.$select.join(','));
    }
    
    if (params.$filter) {
      searchParams.append('filter', JSON.stringify(params.$filter));
    }
    
    if (params.$orderby) {
      const sort = Object.entries(params.$orderby)
        .map(([key, dir]) => `${key}:${dir}`)
        .join(',');
      searchParams.append('sort', sort);
    }
    
    if (params.$skip !== undefined) {
      searchParams.append('skip', params.$skip.toString());
    }
    
    if (params.$top !== undefined) {
      searchParams.append('limit', params.$top.toString());
    }
    
    if (params.$search) {
      searchParams.append('search', params.$search);
    }
    
    return searchParams.toString();
  }

  /**
   * Fetch multiple records
   */
  async find(resource: string, params?: QueryParams): Promise<QueryResult<T>> {
    const queryString = this.buildQueryString(params);
    const url = `${this.baseUrl}/${resource}${queryString ? '?' + queryString : ''}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Assume API returns { data: [], total: number }
    return {
      data: data.data || data,
      total: data.total,
      page: params?.$skip && params?.$top 
        ? Math.floor(params.$skip / params.$top) + 1 
        : 1,
      pageSize: params?.$top,
      hasMore: data.hasMore
    };
  }

  /**
   * Fetch a single record by ID
   */
  async findOne(resource: string, id: string | number, params?: QueryParams): Promise<T | null> {
    const queryString = this.buildQueryString(params);
    const url = `${this.baseUrl}/${resource}/${id}${queryString ? '?' + queryString : ''}`;
    
    const response = await fetch(url);
    
    if (response.status === 404) {
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  }

  /**
   * Create a new record
   */
  async create(resource: string, data: Partial<T>): Promise<T> {
    const url = `${this.baseUrl}/${resource}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  }

  /**
   * Update an existing record
   */
  async update(resource: string, id: string | number, data: Partial<T>): Promise<T> {
    const url = `${this.baseUrl}/${resource}/${id}`;
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  }

  /**
   * Delete a record
   */
  async delete(resource: string, id: string | number): Promise<boolean> {
    const url = `${this.baseUrl}/${resource}/${id}`;
    
    const response = await fetch(url, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return true;
  }

  /**
   * Get object schema/metadata
   */
  async getObjectSchema(objectName: string): Promise<any> {
    if (!objectName || typeof objectName !== 'string') {
      throw new Error('Invalid object name');
    }
    
    // Validate object name to prevent path traversal
    if (objectName.includes('/') || objectName.includes('\\') || objectName.includes('..')) {
      throw new Error('Invalid object name: must not contain path separators');
    }
    
    const url = `${this.baseUrl}/_schema/${encodeURIComponent(objectName)}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  }
}

// Usage example:
// const dataSource = new RestDataSource('https://api.example.com');
// const users = await dataSource.find('users', { 
//   $filter: { status: 'active' },
//   $orderby: { createdAt: 'desc' },
//   $top: 10 
// });
