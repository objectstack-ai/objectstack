// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  API_KEY_PREFIX,
  hashApiKey,
  generateApiKey,
  extractApiKey,
  parseScopes,
  isExpired,
} from './api-key.js';

describe('hashApiKey', () => {
  it('is deterministic for the same input', () => {
    expect(hashApiKey('osk_abc')).toBe(hashApiKey('osk_abc'));
  });

  it('produces a 64-char lowercase hex sha256 digest', () => {
    const h = hashApiKey('osk_abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different inputs', () => {
    expect(hashApiKey('osk_a')).not.toBe(hashApiKey('osk_b'));
  });

  it('never returns the raw key', () => {
    const raw = 'osk_supersecret_value';
    expect(hashApiKey(raw)).not.toContain('supersecret');
  });
});

describe('generateApiKey', () => {
  it('returns raw, hash and prefix', () => {
    const k = generateApiKey();
    expect(typeof k.raw).toBe('string');
    expect(typeof k.hash).toBe('string');
    expect(typeof k.prefix).toBe('string');
  });

  it('uses the default prefix and a url-safe secret', () => {
    const k = generateApiKey();
    expect(k.raw.startsWith(API_KEY_PREFIX)).toBe(true);
    // base64url alphabet only — no +, /, or = padding.
    const secret = k.raw.slice(API_KEY_PREFIX.length);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hash matches hashApiKey(raw)', () => {
    const k = generateApiKey();
    expect(k.hash).toBe(hashApiKey(k.raw));
  });

  it('prefix is a non-secret slice of the raw key', () => {
    const k = generateApiKey();
    expect(k.raw.startsWith(k.prefix)).toBe(true);
    expect(k.prefix.length).toBeLessThan(k.raw.length);
  });

  it('produces unique keys across calls (high entropy)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateApiKey().raw);
    expect(seen.size).toBe(200);
  });

  it('honours a custom prefix', () => {
    const k = generateApiKey('proj_');
    expect(k.raw.startsWith('proj_')).toBe(true);
  });
});

describe('extractApiKey', () => {
  it('reads x-api-key (plain object headers)', () => {
    expect(extractApiKey({ 'x-api-key': 'osk_123' })).toBe('osk_123');
  });

  it('reads x-api-key case-insensitively', () => {
    expect(extractApiKey({ 'X-API-Key': 'osk_123' })).toBe('osk_123');
  });

  it('reads Authorization: ApiKey <token> (case-insensitive scheme)', () => {
    expect(extractApiKey({ authorization: 'ApiKey osk_123' })).toBe('osk_123');
    expect(extractApiKey({ authorization: 'apikey osk_123' })).toBe('osk_123');
  });

  it('does NOT treat Bearer tokens as API keys', () => {
    expect(extractApiKey({ authorization: 'Bearer osk_123' })).toBeUndefined();
  });

  it('prefers x-api-key over Authorization', () => {
    expect(
      extractApiKey({ 'x-api-key': 'fromheader', authorization: 'ApiKey fromauth' }),
    ).toBe('fromheader');
  });

  it('trims surrounding whitespace', () => {
    expect(extractApiKey({ 'x-api-key': '  osk_123  ' })).toBe('osk_123');
  });

  it('returns undefined for missing / empty / whitespace headers', () => {
    expect(extractApiKey({})).toBeUndefined();
    expect(extractApiKey(undefined)).toBeUndefined();
    expect(extractApiKey({ 'x-api-key': '   ' })).toBeUndefined();
    expect(extractApiKey({ authorization: 'ApiKey    ' })).toBeUndefined();
  });

  it('works with a Web Headers instance', () => {
    const h = new Headers();
    h.set('x-api-key', 'osk_web');
    expect(extractApiKey(h)).toBe('osk_web');
  });
});

describe('parseScopes', () => {
  it('passes through a real string array', () => {
    expect(parseScopes(['read', 'write'])).toEqual(['read', 'write']);
  });

  it('parses a JSON-string textarea value', () => {
    expect(parseScopes('["read","write"]')).toEqual(['read', 'write']);
  });

  it('drops non-string / empty members', () => {
    expect(parseScopes(['read', '', 1, null, 'write'] as unknown)).toEqual([
      'read',
      'write',
    ]);
  });

  it('returns [] for malformed JSON, null, undefined or empty string', () => {
    expect(parseScopes('not json')).toEqual([]);
    expect(parseScopes('')).toEqual([]);
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes(42)).toEqual([]);
  });
});

describe('isExpired', () => {
  const now = 1_700_000_000_000;

  it('treats null/undefined as never-expiring', () => {
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired(undefined, now)).toBe(false);
  });

  it('handles ISO date strings', () => {
    expect(isExpired('2000-01-01T00:00:00Z', now)).toBe(true);
    expect(isExpired('2999-01-01T00:00:00Z', now)).toBe(false);
  });

  it('handles Date instances', () => {
    expect(isExpired(new Date(now - 1000), now)).toBe(true);
    expect(isExpired(new Date(now + 1000), now)).toBe(false);
  });

  it('handles millisecond epoch numbers', () => {
    expect(isExpired(now - 1, now)).toBe(true);
    expect(isExpired(now + 1, now)).toBe(false);
  });

  it('handles second epoch numbers', () => {
    const nowSec = Math.floor(now / 1000);
    expect(isExpired(nowSec - 10, now)).toBe(true);
    expect(isExpired(nowSec + 10_000, now)).toBe(false);
  });

  it('is fail-open only for unparseable values (does not falsely expire)', () => {
    expect(isExpired('garbage', now)).toBe(false);
    expect(isExpired({}, now)).toBe(false);
  });
});
