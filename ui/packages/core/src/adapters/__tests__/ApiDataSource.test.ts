/**
 * ObjectUI — ApiDataSource Tests
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiDataSource } from '../ApiDataSource';

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

function createMockFetch(response: any, options?: { status?: number; contentType?: string }) {
  const status = options?.status ?? 200;
  const ok = status >= 200 && status < 300;
  const contentType = options?.contentType ?? 'application/json';

  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(typeof response === 'string' ? response : JSON.stringify(response)),
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// find
// ---------------------------------------------------------------------------

describe('ApiDataSource — find', () => {
  it('should fetch from the read URL', async () => {
    const mockFetch = createMockFetch([{ id: '1', name: 'Alice' }]);
    const ds = new ApiDataSource({
      read: { url: 'https://api.example.com/users' },
      fetch: mockFetch,
    });

    const result = await ds.find('users');
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Alice');
  });

  it('should pass query params to the URL', async () => {
    const mockFetch = createMockFetch([]);
    const ds = new ApiDataSource({
      read: { url: 'https://api.example.com/users' },
      fetch: mockFetch,
    });

    await ds.find('users', { $top: 10, $skip: 20, $select: ['name', 'age'] });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    // URLSearchParams encodes $ as %24
    expect(calledUrl).toContain('top=10');
    expect(calledUrl).toContain('skip=20');
    expect(calledUrl).toContain('select=');
  });

  it('should normalize array response into QueryResult', async () => {
    const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const mockFetch = createMockFetch(items);
    const ds = new ApiDataSource({
      read: { url: '/api/users' },
      fetch: mockFetch,
    });

    const result = await ds.find('users');
    expect(result.data).toEqual(items);
    expect(result.total).toBe(3);
  });

  it('should normalize { data, total } response', async () => {
    const mockFetch = createMockFetch({
      data: [{ id: '1' }],
      total: 42,
    });
    const ds = new ApiDataSource({
      read: { url: '/api/users' },
      fetch: mockFetch,
    });

    const result = await ds.find('users');
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(42);
  });

  it('should normalize { items } response', async () => {
    const mockFetch = createMockFetch({
      items: [{ id: '1' }, { id: '2' }],
      count: 10,
    });
    const ds = new ApiDataSource({
      read: { url: '/api/users' },
      fetch: mockFetch,
    });

    const result = await ds.find('users');
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(10);
  });

  it('should normalize { results } response', async () => {
    const mockFetch = createMockFetch({
      results: [{ id: '1' }],
    });
    const ds = new ApiDataSource({
      read: { url: '/api/users' },
      fetch: mockFetch,
    });

    const result = await ds.find('users');
    expect(result.data).toHaveLength(1);
  });

  it('should normalize { records } response (Salesforce-style)', async () => {
    const mockFetch = createMockFetch({
      records: [{ id: '1' }, { id: '2' }],
      totalCount: 50,
    });
    const ds = new ApiDataSource({
      read: { url: '/api/users' },
      fetch: mockFetch,
    });

    const result = await ds.find('users');
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(50);
  });

  it('should normalize { value } response (OData-style)', async () => {
    const mockFetch = createMockFetch({
      value: [{ id: '1' }],
    });
    const ds = new ApiDataSource({
      read: { url: '/api/users' },
      fetch: mockFetch,
    });

    const result = await ds.find('users');
    expect(result.data).toHaveLength(1);
  });

  it('should wrap single-object response as array', async () => {
    const mockFetch = createMockFetch({ id: '1', name: 'Single' });
    const ds = new ApiDataSource({
      read: { url: '/api/users' },
      fetch: mockFetch,
    });

    const result = await ds.find('users');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Single');
  });

  it('should merge base params with query params', async () => {
    const mockFetch = createMockFetch([]);
    const ds = new ApiDataSource({
      read: { url: '/api/users', params: { tenant: 'acme' } },
      fetch: mockFetch,
    });

    await ds.find('users', { $top: 5 });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('tenant=acme');
    expect(calledUrl).toContain('top=5');
  });

  it('should merge default headers with request headers', async () => {
    const mockFetch = createMockFetch([]);
    const ds = new ApiDataSource({
      read: { url: '/api/users', headers: { 'X-Api-Key': 'key123' } },
      fetch: mockFetch,
      defaultHeaders: { Authorization: 'Bearer token' },
    });

    await ds.find('users');
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer token');
    expect(headers['X-Api-Key']).toBe('key123');
  });
});

// ---------------------------------------------------------------------------
// findOne
// ---------------------------------------------------------------------------

describe('ApiDataSource — findOne', () => {
  it('should append id to the URL path', async () => {
    const mockFetch = createMockFetch({ id: '42', name: 'Alice' });
    const ds = new ApiDataSource({
      read: { url: 'https://api.example.com/users' },
      fetch: mockFetch,
    });

    const record = await ds.findOne('users', '42');
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://api.example.com/users/42');
    expect(record?.name).toBe('Alice');
  });

  it('should return null on 404', async () => {
    const mockFetch = createMockFetch('Not Found', { status: 404, contentType: 'text/plain' });
    const ds = new ApiDataSource({
      read: { url: '/api/users' },
      fetch: mockFetch,
    });

    const record = await ds.findOne('users', '999');
    expect(record).toBeNull();
  });

  // objectui#12032 — `null` means "not found", and only a 404 says that. A
  // refused or failed read used to resolve `null` too, so a record page read
  // "no access" and "could not load" as "not found" (the objectui#11902 states).
  // The rejection keeps the status in the message, which is what the shared
  // load-error classifier reads ("HTTP 403 …").
  it('rejects on 403 instead of resolving null', async () => {
    const mockFetch = createMockFetch({ code: 'FORBIDDEN', error: 'not yours' }, { status: 403 });
    const ds = new ApiDataSource({ read: { url: '/api/users' }, fetch: mockFetch });

    await expect(ds.findOne('users', '42')).rejects.toThrow(/^ApiDataSource: HTTP 403\b/);
  });

  it('rejects on 500 instead of resolving null', async () => {
    const mockFetch = createMockFetch({ code: 'INTERNAL_ERROR' }, { status: 500 });
    const ds = new ApiDataSource({ read: { url: '/api/users' }, fetch: mockFetch });

    await expect(ds.findOne('users', '42')).rejects.toThrow(/^ApiDataSource: HTTP 500\b/);
  });

  it('rejects when the transport itself fails', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const ds = new ApiDataSource({ read: { url: '/api/users' }, fetch: mockFetch });

    await expect(ds.findOne('users', '42')).rejects.toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('ApiDataSource — create', () => {
  it('should POST to the write URL', async () => {
    const mockFetch = createMockFetch({ id: 'new', name: 'Bob' });
    const ds = new ApiDataSource({
      write: { url: '/api/users', method: 'POST' },
      fetch: mockFetch,
    });

    const created = await ds.create('users', { name: 'Bob' });
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'Bob' }));
    expect(created.name).toBe('Bob');
  });

  it('should fall back to read URL when write is not defined', async () => {
    const mockFetch = createMockFetch({ id: 'new' });
    const ds = new ApiDataSource({
      read: { url: '/api/users' },
      fetch: mockFetch,
    });

    await ds.create('users', { name: 'Test' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('/api/users');
  });

  it('should set Content-Type to application/json', async () => {
    const mockFetch = createMockFetch({});
    const ds = new ApiDataSource({
      write: { url: '/api/users' },
      fetch: mockFetch,
    });

    await ds.create('users', { name: 'Test' });
    const headers = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('ApiDataSource — update', () => {
  it('should PATCH to the write URL with id suffix', async () => {
    const mockFetch = createMockFetch({ id: '1', name: 'Updated' });
    const ds = new ApiDataSource({
      write: { url: '/api/users' },
      fetch: mockFetch,
    });

    const updated = await ds.update('users', '1', { name: 'Updated' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(calledUrl).toContain('/1');
    expect(init.method).toBe('PATCH');
    expect(updated.name).toBe('Updated');
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('ApiDataSource — delete', () => {
  it('should DELETE at the write URL with id suffix', async () => {
    const mockFetch = createMockFetch('', { contentType: 'text/plain' });
    const ds = new ApiDataSource({
      write: { url: '/api/users' },
      fetch: mockFetch,
    });

    const result = await ds.delete('users', '1');
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('DELETE');
    expect(result).toBe(true);
  });

  it('should return false on failure', async () => {
    const mockFetch = createMockFetch('Server Error', { status: 500, contentType: 'text/plain' });
    const ds = new ApiDataSource({
      write: { url: '/api/users' },
      fetch: mockFetch,
    });

    const result = await ds.delete('users', '1');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getObjectSchema
// ---------------------------------------------------------------------------

describe('ApiDataSource — getObjectSchema', () => {
  it('should return a minimal stub', async () => {
    const ds = new ApiDataSource({
      read: { url: '/api/users' },
      fetch: createMockFetch({}),
    });

    const schema = await ds.getObjectSchema('users');
    expect(schema.name).toBe('users');
    expect(schema.fields).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('ApiDataSource — errors', () => {
  it('should throw on HTTP error response for find', async () => {
    const mockFetch = createMockFetch('Forbidden', { status: 403, contentType: 'text/plain' });
    const ds = new ApiDataSource({
      read: { url: '/api/users' },
      fetch: mockFetch,
    });

    await expect(ds.find('users')).rejects.toThrow();
  });

  it('should throw when no read config provided for find', async () => {
    const ds = new ApiDataSource({
      write: { url: '/api/users' },
      fetch: createMockFetch({}),
    });

    await expect(ds.find('users')).rejects.toThrow('No HTTP configuration');
  });

  it('should throw when no config provided at all for create', async () => {
    const ds = new ApiDataSource({
      fetch: createMockFetch({}),
    });

    await expect(ds.create('users', { name: 'X' })).rejects.toThrow('No HTTP configuration');
  });
});

// ---------------------------------------------------------------------------
// URL building
// ---------------------------------------------------------------------------

describe('ApiDataSource — URL building', () => {
  it('should handle trailing slashes in base URL', async () => {
    const mockFetch = createMockFetch({ id: '1' });
    const ds = new ApiDataSource({
      read: { url: 'https://api.example.com/users/' },
      fetch: mockFetch,
    });

    await ds.findOne('users', '42');
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://api.example.com/users/42');
  });

  it('should serialize $filter as JSON string', async () => {
    const mockFetch = createMockFetch([]);
    const ds = new ApiDataSource({
      read: { url: 'http://localhost/api/users' },
      fetch: mockFetch,
    });

    await ds.find('users', { $filter: { status: 'active' } });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    // URLSearchParams encodes $ as %24
    expect(calledUrl).toContain('filter=');
    // The value should be URL-encoded JSON
    const url = new URL(calledUrl);
    const filterParam = url.searchParams.get('$filter');
    expect(JSON.parse(filterParam!)).toEqual({ status: 'active' });
  });

  it('should serialize $orderby from Record format', async () => {
    const mockFetch = createMockFetch([]);
    const ds = new ApiDataSource({
      read: { url: 'http://localhost/api/users' },
      fetch: mockFetch,
    });

    await ds.find('users', { $orderby: { name: 'asc', age: 'desc' } });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    // URLSearchParams encodes $ as %24
    expect(calledUrl).toContain('orderby=');
    // Should contain the formatted orderby string
    const url = new URL(calledUrl);
    const orderbyParam = url.searchParams.get('$orderby');
    expect(orderbyParam).toContain('name asc');
    expect(orderbyParam).toContain('age desc');
  });

  // objectstack#3821: a hand-built clause string used to fall into the
  // `Object.entries` branch and get walked character by character
  // ('0 n,1 a,2 m,…'), so the server sorted by columns that don't exist and
  // every row was filtered out — the sharing-rule recipient picker showed
  // "No matches" forever.
  it('should pass a string $orderby through verbatim', async () => {
    const mockFetch = createMockFetch([]);
    const ds = new ApiDataSource({
      read: { url: 'http://localhost/api/users' },
      fetch: mockFetch,
    });

    await ds.find('users', { $orderby: 'name asc' });
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get('$orderby')).toBe('name asc');
  });

  it('should pass a multi-field string $orderby through verbatim', async () => {
    const mockFetch = createMockFetch([]);
    const ds = new ApiDataSource({
      read: { url: 'http://localhost/api/users' },
      fetch: mockFetch,
    });

    await ds.find('users', { $orderby: 'name asc, age desc' });
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get('$orderby')).toBe('name asc, age desc');
  });

  it('should serialize $orderby from the string-array format', async () => {
    const mockFetch = createMockFetch([]);
    const ds = new ApiDataSource({
      read: { url: 'http://localhost/api/users' },
      fetch: mockFetch,
    });

    await ds.find('users', { $orderby: ['name', '-age'] });
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get('$orderby')).toBe('name,-age');
  });

  it('should serialize $orderby from the sort-object-array format', async () => {
    const mockFetch = createMockFetch([]);
    const ds = new ApiDataSource({
      read: { url: 'http://localhost/api/users' },
      fetch: mockFetch,
    });

    await ds.find('users', { $orderby: [{ field: 'name' }, { field: 'age', order: 'desc' }] });
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get('$orderby')).toBe('name asc,age desc');
  });
});
