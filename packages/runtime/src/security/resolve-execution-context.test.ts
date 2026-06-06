// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { resolveExecutionContext } from './resolve-execution-context.js';
import { hashApiKey } from './api-key.js';

/**
 * Minimal ObjectQL stub. Only `sys_api_key` is populated; every other object
 * (sys_member, permission-set link tables, …) resolves to an empty set so the
 * tests isolate the API-key verify path.
 */
function makeQl(apiKeyRows: any[]) {
  return {
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      if (object !== 'sys_api_key') return [];
      return apiKeyRows.filter((row) => {
        for (const [k, v] of Object.entries(where)) {
          if (row[k] !== v) return false;
        }
        return true;
      });
    },
  };
}

function makeOpts(apiKeyRows: any[], headers: Record<string, string>) {
  return {
    // No auth service wired — exercises the hand-rolled path only and lets the
    // session fallback degrade to anonymous.
    getService: async () => undefined,
    getQl: async () => makeQl(apiKeyRows),
    request: { headers },
  };
}

const FUTURE = '2999-01-01T00:00:00Z';
const PAST = '2000-01-01T00:00:00Z';

describe('resolveExecutionContext — API key verify path', () => {
  it('resolves a valid key to its owner via x-api-key', async () => {
    const raw = 'osk_valid_key';
    const rows = [
      { id: 'k1', key: hashApiKey(raw), revoked: false, user_id: 'u1', expires_at: FUTURE },
    ];
    const ctx = await resolveExecutionContext(makeOpts(rows, { 'x-api-key': raw }));
    expect(ctx.userId).toBe('u1');
    expect(ctx.isSystem).toBe(false);
  });

  it('resolves a valid key via Authorization: ApiKey <token>', async () => {
    const raw = 'osk_valid_key';
    const rows = [{ id: 'k1', key: hashApiKey(raw), revoked: false, user_id: 'u1' }];
    const ctx = await resolveExecutionContext(
      makeOpts(rows, { authorization: `ApiKey ${raw}` }),
    );
    expect(ctx.userId).toBe('u1');
  });

  it('rejects a revoked key', async () => {
    const raw = 'osk_revoked';
    const rows = [{ id: 'k1', key: hashApiKey(raw), revoked: true, user_id: 'u1' }];
    const ctx = await resolveExecutionContext(makeOpts(rows, { 'x-api-key': raw }));
    expect(ctx.userId).toBeUndefined();
  });

  it('rejects an expired key', async () => {
    const raw = 'osk_expired';
    const rows = [
      { id: 'k1', key: hashApiKey(raw), revoked: false, user_id: 'u1', expires_at: PAST },
    ];
    const ctx = await resolveExecutionContext(makeOpts(rows, { 'x-api-key': raw }));
    expect(ctx.userId).toBeUndefined();
  });

  it('rejects an unknown key', async () => {
    const rows = [
      { id: 'k1', key: hashApiKey('osk_real'), revoked: false, user_id: 'u1' },
    ];
    const ctx = await resolveExecutionContext(makeOpts(rows, { 'x-api-key': 'osk_wrong' }));
    expect(ctx.userId).toBeUndefined();
  });

  it('does NOT match a plaintext-stored key (only hashed lookup)', async () => {
    // A row whose `key` was (wrongly) stored as the raw value must never
    // authenticate — the resolver only ever queries by sha256(raw).
    const raw = 'osk_plaintext';
    const rows = [{ id: 'k1', key: raw, revoked: false, user_id: 'u1' }];
    const ctx = await resolveExecutionContext(makeOpts(rows, { 'x-api-key': raw }));
    expect(ctx.userId).toBeUndefined();
  });

  it('parses JSON-string scopes into ctx.permissions', async () => {
    const raw = 'osk_scoped';
    const rows = [
      {
        id: 'k1',
        key: hashApiKey(raw),
        revoked: false,
        user_id: 'u1',
        scopes: '["data:read","data:write"]',
      },
    ];
    const ctx = await resolveExecutionContext(makeOpts(rows, { 'x-api-key': raw }));
    expect(ctx.permissions).toContain('data:read');
    expect(ctx.permissions).toContain('data:write');
  });

  it('carries an organization_id through to tenantId when present', async () => {
    const raw = 'osk_org';
    const rows = [
      {
        id: 'k1',
        key: hashApiKey(raw),
        revoked: false,
        user_id: 'u1',
        organization_id: 'org1',
      },
    ];
    const ctx = await resolveExecutionContext(makeOpts(rows, { 'x-api-key': raw }));
    expect(ctx.userId).toBe('u1');
    expect(ctx.tenantId).toBe('org1');
  });

  it('returns an anonymous context when no auth header is present', async () => {
    const ctx = await resolveExecutionContext(makeOpts([], {}));
    expect(ctx.userId).toBeUndefined();
    expect(ctx.isSystem).toBe(false);
    expect(ctx.roles).toEqual([]);
    expect(ctx.permissions).toEqual([]);
  });

  it('ignores Bearer tokens on the API-key path (no key resolution)', async () => {
    const raw = 'osk_valid';
    const rows = [{ id: 'k1', key: hashApiKey(raw), revoked: false, user_id: 'u1' }];
    // Bearer is a session token, not an API key — must not resolve here.
    const ctx = await resolveExecutionContext(
      makeOpts(rows, { authorization: `Bearer ${raw}` }),
    );
    expect(ctx.userId).toBeUndefined();
  });
});
