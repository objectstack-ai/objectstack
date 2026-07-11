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
    // ADR-0090 D9: a sessionless HTTP principal is a guest — it holds the
    // built-in guest position implicitly (and exclusively).
    expect(ctx.positions).toEqual(['guest']);
    expect(ctx.permissions).toEqual([]);
  });

  it('resolves a Bearer api-key (osk_ prefix) but not a bare session Bearer', async () => {
    const raw = 'osk_valid';
    const rows = [{ id: 'k1', key: hashApiKey(raw), revoked: false, user_id: 'u1' }];
    // A Bearer carrying the osk_ api-key prefix DOES resolve — remote MCP clients
    // (Claude Desktop / Cursor / Claude Code) send the key as a Bearer.
    const keyed = await resolveExecutionContext(
      makeOpts(rows, { authorization: `Bearer ${raw}` }),
    );
    expect(keyed.userId).toBe('u1');
    // A bare Bearer (a better-auth session token) is NOT an api-key — no key
    // resolution here; it falls through to the session path.
    const session = await resolveExecutionContext(
      makeOpts(rows, { authorization: 'Bearer some-session-token' }),
    );
    expect(session.userId).toBeUndefined();
  });
});

/**
 * Localization resolution (ADR-0053 Phase 2): reference `timezone` + `locale`
 * resolved from the `localization` settings. Canonical path is the `settings`
 * service (platform default → global → tenant); when it's absent the resolver
 * falls back to a direct tenant-scoped `sys_setting` read, then UTC / en-US.
 * Per-user overrides are intentionally out of scope (organization-level only),
 * so `sys_user_preference` is no longer consulted.
 */
describe('resolveExecutionContext — localization (timezone + locale)', () => {
  const RAW = 'osk_tz';
  const apiKeyRows = [{ id: 'k1', key: hashApiKey(RAW), revoked: false, user_id: 'u1', expires_at: FUTURE }];

  /** Fake `settings` service doing the 4-tier `get(namespace, key)` resolution. */
  function makeSettings(values: Record<string, unknown>) {
    return {
      async get(namespace: string, key: string) {
        return { value: values[`${namespace}.${key}`], source: 'tenant' };
      },
    };
  }

  function makeTzOpts({
    settings = [],
    prefs = [],
    settingsService,
  }: { settings?: any[]; prefs?: any[]; settingsService?: any }) {
    const tables: Record<string, any[]> = {
      sys_api_key: apiKeyRows,
      sys_user_preference: prefs,
      sys_setting: settings,
    };
    const ql = {
      async find(object: string, opts: any) {
        const rows = tables[object] ?? [];
        const where = opts?.where ?? {};
        return rows.filter((row) => {
          for (const [k, v] of Object.entries(where)) {
            if (v !== null && typeof v === 'object') continue; // skip $in/operators
            if (row[k] !== v) return false;
          }
          return true;
        });
      },
    };
    return {
      getService: async (name: string) => (name === 'settings' ? settingsService : undefined),
      getQl: async () => ql,
      request: { headers: { 'x-api-key': RAW } },
    };
  }

  it('resolves timezone + locale via the settings service when present', async () => {
    const ctx = await resolveExecutionContext(makeTzOpts({
      settingsService: makeSettings({
        'localization.timezone': 'Europe/Paris',
        'localization.locale': 'zh-CN',
        'localization.currency': 'EUR',
      }),
    }));
    expect(ctx.userId).toBe('u1');
    expect(ctx.timezone).toBe('Europe/Paris');
    expect(ctx.locale).toBe('zh-CN');
    expect(ctx.currency).toBe('EUR');
  });

  it('resolves the tenant default currency (ISO 4217, upper-cased) and ignores junk', async () => {
    const ok = await resolveExecutionContext(makeTzOpts({
      settingsService: makeSettings({ 'localization.currency': 'cny' }),
    }));
    expect(ok.currency).toBe('CNY');
    const junk = await resolveExecutionContext(makeTzOpts({
      settingsService: makeSettings({ 'localization.currency': 'not-a-code' }),
    }));
    expect(junk.currency).toBeUndefined();
  });

  it('falls back to a direct tenant-scoped sys_setting read when no settings service', async () => {
    const ctx = await resolveExecutionContext(makeTzOpts({
      settings: [
        { namespace: 'localization', key: 'timezone', scope: 'tenant', value: 'Asia/Tokyo' },
        { namespace: 'localization', key: 'locale', scope: 'tenant', value: 'ja-JP' },
        { namespace: 'localization', key: 'currency', scope: 'tenant', value: 'JPY' },
      ],
    }));
    expect(ctx.timezone).toBe('Asia/Tokyo');
    expect(ctx.locale).toBe('ja-JP');
    expect(ctx.currency).toBe('JPY');
  });

  it('ignores per-user sys_user_preference rows (organization-level only)', async () => {
    const ctx = await resolveExecutionContext(makeTzOpts({
      prefs: [{ user_id: 'u1', key: 'timezone', value: 'America/New_York' }],
      settings: [{ namespace: 'localization', key: 'timezone', scope: 'tenant', value: 'Europe/Paris' }],
    }));
    expect(ctx.timezone).toBe('Europe/Paris'); // org default, NOT the user pref
  });

  it('defaults to UTC / en-US when nothing is configured', async () => {
    const ctx = await resolveExecutionContext(makeTzOpts({}));
    expect(ctx.timezone).toBe('UTC');
    expect(ctx.locale).toBe('en-US');
  });

  it('ignores an invalid zone and falls back to the built-in', async () => {
    const ctx = await resolveExecutionContext(makeTzOpts({
      settingsService: makeSettings({ 'localization.timezone': 'Not/AZone' }),
    }));
    expect(ctx.timezone).toBe('UTC');
  });

  it('leaves timezone/locale unset for anonymous requests', async () => {
    const ctx = await resolveExecutionContext({
      getService: async () => undefined,
      getQl: async () => ({ async find() { return []; } }),
      request: { headers: {} },
    });
    expect(ctx.userId).toBeUndefined();
    expect(ctx.timezone).toBeUndefined();
    expect(ctx.locale).toBeUndefined();
  });
});


// ---------------------------------------------------------------------------
// ADR-0066 — platform-scoped (null-org) permission-set grants are GLOBAL and
// must resolve even when the caller has an active org. Regression for the gap
// where `organization_id = tenantId` dropped a platform admin's null-org
// admin_full_access grant (and its systemPermissions) the moment they owned an
// org — which then locked them out of a requiredPermissions-gated object.
// ---------------------------------------------------------------------------
describe('resolveExecutionContext — platform-scoped (null-org) grants (ADR-0066)', () => {
  const RAW = 'osk_admin';
  function makeAuthQl(extraGrants = []) {
    const tables = {
      sys_api_key: [{ id: 'k1', key: hashApiKey(RAW), revoked: false, user_id: 'u1', organization_id: 'orgA', expires_at: FUTURE }],
      sys_member: [{ user_id: 'u1', organization_id: 'orgA', role: 'owner' }],
      sys_user_permission_set: [
        { id: 'ups_global', user_id: 'u1', permission_set_id: 'ps_admin', organization_id: null },
        ...extraGrants,
      ],
      sys_permission_set: [
        { id: 'ps_admin', name: 'admin_full_access', system_permissions: '["manage_platform_settings","manage_users"]', object_permissions: '{}' },
        { id: 'ps_other', name: 'other_org_set', system_permissions: '["should_not_appear"]', object_permissions: '{}' },
      ],
      sys_position: [],
      sys_position_permission_set: [],
      sys_user_position: [],
    };
    return {
      async find(object, opts) {
        const rows = tables[object] ?? [];
        const where = opts?.where ?? {};
        return rows.filter((row) => {
          for (const [k, v] of Object.entries(where)) {
            if (v !== null && typeof v === 'object') {
              if (Array.isArray(v.$in) && !v.$in.includes(row[k])) return false;
              continue;
            }
            if ((v ?? null) !== (row[k] ?? null)) return false;
          }
          return true;
        });
      },
    };
  }
  const opts = (ql) => ({ getService: async () => undefined, getQl: async () => ql, request: { headers: { 'x-api-key': RAW } } });

  it('resolves a null-org admin grant + its systemPermissions even with an active org', async () => {
    const ctx = await resolveExecutionContext(opts(makeAuthQl()));
    expect(ctx.tenantId).toBe('orgA');
    expect(ctx.permissions).toContain('admin_full_access');
    expect(ctx.systemPermissions).toContain('manage_platform_settings');
  });

  it('still drops a grant scoped to a DIFFERENT org', async () => {
    const ql = makeAuthQl([{ id: 'ups_otherorg', user_id: 'u1', permission_set_id: 'ps_other', organization_id: 'orgB' }]);
    const ctx = await resolveExecutionContext(opts(ql));
    expect(ctx.permissions).toContain('admin_full_access'); // global grant kept
    expect(ctx.permissions).not.toContain('other_org_set'); // foreign-org grant dropped
    expect(ctx.systemPermissions).not.toContain('should_not_appear');
  });
});

describe('principal taxonomy at the HTTP entry (ADR-0090 D9/D10)', () => {
  it('a sessionless request resolves as a guest principal holding only the guest position', async () => {
    const ctx = await resolveExecutionContext(makeOpts([], {}));
    expect(ctx.principalKind).toBe('guest');
    expect(ctx.positions).toEqual(['guest']);
    expect(ctx.userId).toBeUndefined();
    expect(ctx.isSystem).toBe(false);
  });

  it('an authenticated (API-key) request resolves as a human principal, never guest', async () => {
    const raw = 'osk_p2_anchor_test';
    const rows = [{ id: 'k1', key: hashApiKey(raw), revoked: false, user_id: 'u9', expires_at: FUTURE }];
    const ctx = await resolveExecutionContext(makeOpts(rows, { 'x-api-key': raw }));
    expect(ctx.principalKind).toBe('human');
    expect(ctx.userId).toBe('u9');
    expect(ctx.positions).not.toContain('guest');
  });
});

describe('resolveExecutionContext — ADR-0090 D10 agent principal (OAuth on /mcp)', () => {
  // A verified MCP OAuth token: `sub` = the human, `azp` = the agent client.
  const agentOpts = (verified: any) => ({
    acceptOAuthAccessToken: true,
    getService: async (name: string) =>
      name === 'auth' ? { verifyMcpAccessToken: async () => verified } : undefined,
    getQl: async () => makeQl([]),
    request: { headers: { authorization: 'Bearer a.b.c' } },
  });

  it("data:read token with a client → principalKind 'agent', onBehalfOf the user, read-only ceiling", async () => {
    const ctx = await resolveExecutionContext(
      agentOpts({ userId: 'u1', scopes: ['data:read'], clientId: 'agent-app-1' }),
    );
    expect(ctx.principalKind).toBe('agent');
    // userId stays the human so owner-stamping + current_user.* RLS resolve to them.
    expect(ctx.userId).toBe('u1');
    expect(ctx.onBehalfOf).toEqual({ userId: 'u1', principalKind: 'human' });
    // Agent's OWN grants are the scope-derived ceiling, NOT the user's.
    expect(ctx.permissions).toEqual(['mcp_agent_data_read']);
    expect(ctx.positions).toEqual([]);
    expect(ctx.systemPermissions).toEqual([]);
    // Tool-surface scope gate still applies.
    expect(ctx.oauthScopes).toEqual(['data:read']);
  });

  it('data:write token → read+write ceiling set', async () => {
    const ctx = await resolveExecutionContext(
      agentOpts({ userId: 'u1', scopes: ['data:write'], clientId: 'c1' }),
    );
    expect(ctx.principalKind).toBe('agent');
    expect(ctx.permissions).toEqual(['mcp_agent_data_write']);
  });

  it('actions-only token → restricted (no-object-access) ceiling, still an agent', async () => {
    const ctx = await resolveExecutionContext(
      agentOpts({ userId: 'u1', scopes: ['actions:execute'], clientId: 'c1' }),
    );
    expect(ctx.principalKind).toBe('agent');
    expect(ctx.permissions).toEqual(['mcp_agent_restricted']);
  });

  it('an OAuth token WITHOUT a client (no azp) stays a human principal — not every bearer is an agent', async () => {
    const ctx = await resolveExecutionContext(
      agentOpts({ userId: 'u1', scopes: ['data:read'] }),
    );
    expect(ctx.principalKind).toBe('human');
    expect(ctx.onBehalfOf).toBeUndefined();
  });
});

