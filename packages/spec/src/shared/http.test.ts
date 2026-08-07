import { describe, it, expect } from 'vitest';
import {
  HttpMethod,
  HttpMethodSubsetSchema,
  HttpRequestSchema,
  CorsConfigSchema,
  RateLimitConfigSchema,
  StaticMountSchema,
} from './http.zod';

describe('HttpMethod', () => {
  it('should accept all valid HTTP methods', () => {
    const valid = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    valid.forEach((v) => {
      expect(HttpMethod.parse(v)).toBe(v);
    });
  });

  it('should reject lowercase methods', () => {
    expect(() => HttpMethod.parse('get')).toThrow();
    expect(() => HttpMethod.parse('post')).toThrow();
  });

  it('should reject invalid methods', () => {
    expect(() => HttpMethod.parse('CONNECT')).toThrow();
    expect(() => HttpMethod.parse('')).toThrow();
  });
});

describe('CorsConfigSchema', () => {
  it('should accept empty object and apply defaults', () => {
    const result = CorsConfigSchema.parse({});
    expect(result.enabled).toBe(true);
    expect(result.origins).toBe('*');
    expect(result.credentials).toBe(false);
  });

  it('should accept fully specified config', () => {
    const result = CorsConfigSchema.parse({
      enabled: true,
      origins: ['http://localhost:3000', 'https://app.example.com'],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      credentials: true,
      maxAge: 86400,
    });
    expect(result.enabled).toBe(true);
    expect(result.origins).toEqual(['http://localhost:3000', 'https://app.example.com']);
    expect(result.methods).toEqual(['GET', 'POST', 'PUT', 'DELETE']);
    expect(result.credentials).toBe(true);
    expect(result.maxAge).toBe(86400);
  });

  it('should accept string origin', () => {
    const result = CorsConfigSchema.parse({ origins: 'https://example.com' });
    expect(result.origins).toBe('https://example.com');
  });

  it('should accept array origin', () => {
    const result = CorsConfigSchema.parse({ origins: ['https://a.com', 'https://b.com'] });
    expect(result.origins).toEqual(['https://a.com', 'https://b.com']);
  });

  it('should have optional methods and maxAge', () => {
    const result = CorsConfigSchema.parse({});
    expect(result.methods).toBeUndefined();
    expect(result.maxAge).toBeUndefined();
  });

  it('should reject invalid methods in array', () => {
    expect(() =>
      CorsConfigSchema.parse({ methods: ['get'] }),
    ).toThrow();
  });
});

describe('RateLimitConfigSchema', () => {
  it('should accept empty object and apply defaults', () => {
    const result = RateLimitConfigSchema.parse({});
    expect(result.enabled).toBe(false);
    expect(result.windowMs).toBe(60000);
    expect(result.maxRequests).toBe(100);
  });

  it('should accept fully specified config', () => {
    const result = RateLimitConfigSchema.parse({
      enabled: true,
      windowMs: 30000,
      maxRequests: 50,
    });
    expect(result.enabled).toBe(true);
    expect(result.windowMs).toBe(30000);
    expect(result.maxRequests).toBe(50);
  });

  it('should reject non-integer windowMs', () => {
    expect(() => RateLimitConfigSchema.parse({ windowMs: 1.5 })).toThrow();
  });

  it('should reject non-integer maxRequests', () => {
    expect(() => RateLimitConfigSchema.parse({ maxRequests: 10.5 })).toThrow();
  });
});

describe('StaticMountSchema', () => {
  it('should accept valid static mount config', () => {
    const result = StaticMountSchema.parse({
      path: '/static',
      directory: './public',
    });
    expect(result.path).toBe('/static');
    expect(result.directory).toBe('./public');
  });

  it('should accept config with optional cacheControl', () => {
    const result = StaticMountSchema.parse({
      path: '/static',
      directory: './public',
      cacheControl: 'public, max-age=31536000',
    });
    expect(result.cacheControl).toBe('public, max-age=31536000');
  });

  it('should have optional cacheControl', () => {
    const result = StaticMountSchema.parse({
      path: '/assets',
      directory: './dist',
    });
    expect(result.cacheControl).toBeUndefined();
  });

  it('should reject missing path', () => {
    expect(() => StaticMountSchema.parse({ directory: './public' })).toThrow();
  });

  it('should reject missing directory', () => {
    expect(() => StaticMountSchema.parse({ path: '/static' })).toThrow();
  });
});

// ============================================================================
// Issue #8: the view data-source subset and HttpRequestSchema migrated to shared
// (renamed HttpMethodSchema -> HttpMethodSubsetSchema at #5832)
// ============================================================================
describe('HttpMethodSubsetSchema (migrated from view.zod)', () => {
  it('should accept common HTTP methods', () => {
    const valid = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    valid.forEach(m => {
      expect(HttpMethodSubsetSchema.parse(m)).toBe(m);
    });
  });

  it('should reject HEAD and OPTIONS (subset for UI data sources)', () => {
    expect(() => HttpMethodSubsetSchema.parse('HEAD')).toThrow();
    expect(() => HttpMethodSubsetSchema.parse('OPTIONS')).toThrow();
  });
});

describe('HttpRequestSchema (migrated from view.zod)', () => {
  it('should accept minimal request with url only', () => {
    const result = HttpRequestSchema.parse({ url: 'https://api.example.com/data' });
    expect(result.url).toBe('https://api.example.com/data');
    expect(result.method).toBe('GET');
  });

  it('should accept full request with all fields', () => {
    const result = HttpRequestSchema.parse({
      url: 'https://api.example.com/data',
      method: 'POST',
      headers: { 'Authorization': 'Bearer token' },
      params: { page: 1 },
      body: { name: 'test' },
    });
    expect(result.method).toBe('POST');
    expect(result.headers?.['Authorization']).toBe('Bearer token');
  });

  it('should reject request without url', () => {
    expect(() => HttpRequestSchema.parse({})).toThrow();
  });
});
