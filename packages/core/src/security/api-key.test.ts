// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  hashApiKey,
  generateApiKey,
  extractApiKey,
  parseScopes,
  isExpired,
  resolveApiKeyPrincipal,
} from './api-key.js';

/** In-memory sys_api_key store exposing the `find` shape the verifier uses. */
function makeQl(rows: any[]) {
  return {
    find: async (object: string, opts: any) => {
      if (object !== 'sys_api_key') return [];
      const where = opts?.where ?? {};
      return rows.filter((r) => Object.entries(where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }));
    },
  };
}

const FUTURE = '2999-01-01T00:00:00Z';
const PAST = '2000-01-01T00:00:00Z';

describe('core api-key primitives', () => {
  it('hashApiKey is deterministic sha256 hex, never the raw', () => {
    expect(hashApiKey('osk_a')).toBe(hashApiKey('osk_a'));
    expect(hashApiKey('osk_a')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey('osk_secret')).not.toContain('secret');
  });

  it('generateApiKey: prefix + base64url secret, hash matches', () => {
    const k = generateApiKey();
    expect(k.raw.startsWith('osk_')).toBe(true);
    expect(k.hash).toBe(hashApiKey(k.raw));
    expect(k.raw.startsWith(k.prefix)).toBe(true);
  });

  it('extractApiKey: x-api-key / ApiKey, and Bearer only for osk_-prefixed keys', () => {
    expect(extractApiKey({ 'x-api-key': 'k' })).toBe('k');
    expect(extractApiKey({ authorization: 'ApiKey k' })).toBe('k');
    // A bare Bearer (e.g. a better-auth session token) is NOT an api-key.
    expect(extractApiKey({ authorization: 'Bearer k' })).toBeUndefined();
    // A Bearer carrying the api-key prefix IS accepted — remote MCP clients
    // (Claude Desktop / Cursor / Claude Code) send the key this way.
    expect(extractApiKey({ authorization: 'Bearer osk_abc123' })).toBe('osk_abc123');
    expect(extractApiKey({ authorization: 'bearer osk_abc123' })).toBe('osk_abc123'); // scheme is case-insensitive
  });

  it('resolveApiKeyPrincipal resolves a Bearer osk_ key (remote MCP client path)', async () => {
    const raw = 'osk_' + 'b'.repeat(24);
    const ql = makeQl([{ key: hashApiKey(raw), revoked: false, user_id: 'u1' }]);
    const p = await resolveApiKeyPrincipal(ql, { authorization: `Bearer ${raw}` });
    expect(p?.userId).toBe('u1');
  });

  it('parseScopes + isExpired basics', () => {
    expect(parseScopes('["a","b"]')).toEqual(['a', 'b']);
    expect(isExpired(PAST, Date.now())).toBe(true);
    expect(isExpired(FUTURE, Date.now())).toBe(false);
    expect(isExpired(null, Date.now())).toBe(false);
  });
});

describe('resolveApiKeyPrincipal (shared verifier)', () => {
  it('resolves a valid key to its principal (x-api-key)', async () => {
    const raw = 'osk_valid';
    const ql = makeQl([
      { key: hashApiKey(raw), revoked: false, user_id: 'u1', organization_id: 'org1', scopes: '["read"]', expires_at: FUTURE },
    ]);
    const p = await resolveApiKeyPrincipal(ql, { 'x-api-key': raw });
    expect(p).toEqual({ userId: 'u1', tenantId: 'org1', scopes: ['read'] });
  });

  it('resolves via Authorization: ApiKey', async () => {
    const raw = 'osk_valid';
    const ql = makeQl([{ key: hashApiKey(raw), revoked: false, user_id: 'u1' }]);
    const p = await resolveApiKeyPrincipal(ql, { authorization: `ApiKey ${raw}` });
    expect(p?.userId).toBe('u1');
  });

  it('returns undefined for no key / revoked / expired / unknown / owner-less', async () => {
    const raw = 'osk_x';
    const base = (extra: any) => makeQl([{ key: hashApiKey(raw), revoked: false, user_id: 'u1', ...extra }]);
    expect(await resolveApiKeyPrincipal(base({}), {})).toBeUndefined(); // no key header
    expect(await resolveApiKeyPrincipal(makeQl([{ key: hashApiKey(raw), revoked: true, user_id: 'u1' }]), { 'x-api-key': raw })).toBeUndefined();
    expect(await resolveApiKeyPrincipal(base({ expires_at: PAST }), { 'x-api-key': raw })).toBeUndefined();
    expect(await resolveApiKeyPrincipal(base({}), { 'x-api-key': 'osk_wrong' })).toBeUndefined();
    expect(await resolveApiKeyPrincipal(makeQl([{ key: hashApiKey(raw), revoked: false }]), { 'x-api-key': raw })).toBeUndefined(); // no user_id
  });

  it('never matches a plaintext-stored key (hash lookup only)', async () => {
    const raw = 'osk_plain';
    const ql = makeQl([{ key: raw, revoked: false, user_id: 'u1' }]);
    expect(await resolveApiKeyPrincipal(ql, { 'x-api-key': raw })).toBeUndefined();
  });

  it('fail-closed when ql is missing/unusable', async () => {
    expect(await resolveApiKeyPrincipal(undefined, { 'x-api-key': 'osk_x' })).toBeUndefined();
    expect(await resolveApiKeyPrincipal({}, { 'x-api-key': 'osk_x' })).toBeUndefined();
  });
});
