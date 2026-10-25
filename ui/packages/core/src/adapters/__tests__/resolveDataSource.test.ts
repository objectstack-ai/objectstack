/**
 * ObjectUI — resolveDataSource Tests
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { resolveDataSource } from '../resolveDataSource';
import { ApiDataSource } from '../ApiDataSource';
import { ValueDataSource } from '../ValueDataSource';
import type { DataSource, ViewData } from '@object-ui/types';

// ---------------------------------------------------------------------------
// Minimal mock DataSource for "object" provider fallback
// ---------------------------------------------------------------------------

const mockFallback: DataSource<any> = {
  find: async () => ({ data: [], total: 0 }),
  findOne: async () => null,
  create: async (_r, d) => d as any,
  update: async (_r, _id, d) => d as any,
  delete: async () => true,
  getObjectSchema: async (name) => ({ name, fields: {} }),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveDataSource', () => {
  it('should return null when viewData is null and no fallback', () => {
    const ds = resolveDataSource(null);
    expect(ds).toBeNull();
  });

  it('should return fallback when viewData is null', () => {
    const ds = resolveDataSource(null, mockFallback);
    expect(ds).toBe(mockFallback);
  });

  it('should return null when viewData is undefined and no fallback', () => {
    const ds = resolveDataSource(undefined);
    expect(ds).toBeNull();
  });

  // -----------------------------------------------------------------------
  // provider: 'object'
  // -----------------------------------------------------------------------

  it('should return fallback for provider: "object"', () => {
    const viewData: ViewData = { provider: 'object', object: 'contacts' };
    const ds = resolveDataSource(viewData, mockFallback);
    expect(ds).toBe(mockFallback);
  });

  it('should return null for provider: "object" without fallback', () => {
    const viewData: ViewData = { provider: 'object', object: 'contacts' };
    const ds = resolveDataSource(viewData);
    expect(ds).toBeNull();
  });

  // -----------------------------------------------------------------------
  // provider: 'api' — retired (objectstack#23082, objectui#12325)
  // -----------------------------------------------------------------------
  // These cases used to pin that an `api` block built an `ApiDataSource` from
  // its `read` / `write`. The view-level `api` data source is retired in the
  // spec, so the arm is gone: the block is an unknown provider and gets an
  // unknown provider's answer. The `ApiDataSource` class itself stays, for
  // code that constructs it (ApiDataSource.test.ts pins that).

  it('builds no ApiDataSource for a retired provider: "api" block; it falls back like an unknown provider', () => {
    const retired = {
      provider: 'api',
      read: { url: '/api/contacts', method: 'GET' },
      write: { url: '/api/contacts', method: 'POST' },
    } as unknown as ViewData;
    const withFallback = resolveDataSource(retired, mockFallback);
    expect(withFallback).toBe(mockFallback);
    expect(withFallback).not.toBeInstanceOf(ApiDataSource);
    expect(resolveDataSource(retired)).toBeNull();
  });

  it('answers a retired provider: "api" block exactly as it answers any unknown provider', () => {
    const retired = { provider: 'api', read: { url: '/api/contacts' } } as unknown as ViewData;
    const unknown = { provider: 'nonexistent' } as unknown as ViewData;
    expect(resolveDataSource(retired, mockFallback)).toBe(resolveDataSource(unknown, mockFallback));
    expect(resolveDataSource(retired)).toBe(resolveDataSource(unknown));
  });

  // -----------------------------------------------------------------------
  // provider: 'value'
  // -----------------------------------------------------------------------

  it('should create ValueDataSource for provider: "value"', () => {
    const viewData: ViewData = {
      provider: 'value',
      items: [{ id: '1', name: 'Test' }],
    };
    const ds = resolveDataSource(viewData);
    expect(ds).toBeInstanceOf(ValueDataSource);
  });

  it('should handle empty items array', () => {
    const viewData: ViewData = {
      provider: 'value',
      items: [],
    };
    const ds = resolveDataSource(viewData);
    expect(ds).toBeInstanceOf(ValueDataSource);
  });

  it('should pass idField option to ValueDataSource', () => {
    const viewData: ViewData = {
      provider: 'value',
      items: [{ code: 'A', label: 'Alpha' }],
    };
    const ds = resolveDataSource(viewData, null, { idField: 'code' });
    expect(ds).toBeInstanceOf(ValueDataSource);
  });

  // -----------------------------------------------------------------------
  // Unknown provider
  // -----------------------------------------------------------------------

  it('should return fallback for unknown provider', () => {
    const viewData = { provider: 'graphql' } as unknown as ViewData;
    const ds = resolveDataSource(viewData, mockFallback);
    expect(ds).toBe(mockFallback);
  });

  it('should return null for unknown provider without fallback', () => {
    const viewData = { provider: 'unknown' } as unknown as ViewData;
    const ds = resolveDataSource(viewData);
    expect(ds).toBeNull();
  });
});
