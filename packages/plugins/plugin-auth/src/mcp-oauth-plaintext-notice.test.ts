// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The plain-HTTP OAuth startup notice — the second half of the deployment
 * transport rule (maintainer ruling 2026-09-21).
 *
 * `isOAuthEligibleBaseUrl` decides WHETHER an unencrypted deployment gets the
 * OAuth track; this notice is what keeps that posture from being a silent
 * one. The ruling fixes three things about it and all three are pinned here:
 * it fires whenever OAuth is served over plain HTTP, it fires exactly ONCE
 * per mount, and it does not fire under TLS.
 *
 * ⚠️ The subject is `registerOidcDiscoveryRoutes` driven against a STUB
 * manager and a stub Hono app — it can answer "does the mount emit this
 * line", never "does the authorization server behave". Anything whose truth
 * depends on the provider belongs in
 * `auth-manager.mcp-oauth-resource.test.ts`, which boots the real one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({ handler: vi.fn(), api: {} })),
}));
vi.mock('@better-auth/oauth-provider', () => ({
  oauthProvider: vi.fn((opts: any) => ({ id: 'oauth-provider', _opts: opts })),
  oauthProviderAuthServerMetadata: vi.fn(() => () => new Response('{}')),
  oauthProviderOpenIdConfigMetadata: vi.fn(() => () => new Response('{}')),
}));

import { AuthPlugin } from './auth-plugin';

/** The ruled wording, verbatim — ⛔ never paraphrase this constant. */
const RULED_WORDING = 'OAuth 未加密:仅限可信内网';

const savedMcpEnv = process.env.OS_MCP_SERVER_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.OS_MCP_SERVER_ENABLED;
});
afterEach(() => {
  if (savedMcpEnv === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
  else process.env.OS_MCP_SERVER_ENABLED = savedMcpEnv;
});

/**
 * Drive the discovery mount for one deployment origin and return every line
 * the mount logged, by level.
 */
async function mountDiscoveryFor(baseUrl: string): Promise<{
  warns: string[];
  infos: string[];
  routes: string[];
}> {
  const origin = new URL(baseUrl).origin;
  const warns: string[] = [];
  const infos: string[] = [];
  const routes: string[] = [];

  const ctx: any = {
    logger: {
      warn: (msg: unknown) => warns.push(String(msg)),
      info: (msg: unknown) => infos.push(String(msg)),
      error: (msg: unknown) => infos.push(`ERROR ${String(msg)}`),
      debug: () => {},
    },
  };

  const rawApp: any = { get: (path: string) => routes.push(path) };

  // A stub standing in for AuthManager: only the members this mount reads.
  const manager: any = {
    getAuthInstance: async () => ({ handler: vi.fn(), api: {} }),
    getDegradedAuthFeatures: () => [],
    getAuthIssuer: () => `${origin}/api/v1/auth`,
    isMcpOAuthEnabled: () => true,
    getMcpResourceUrl: () => `${origin}/api/v1/mcp`,
    getMcpProtectedResourceMetadata: () => ({ resource: `${origin}/api/v1/mcp` }),
  };

  const plugin = new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long', baseUrl });
  (plugin as any).authManager = manager;
  await (plugin as any).registerOidcDiscoveryRoutes(rawApp, ctx);

  return { warns, infos, routes };
}

const noticesIn = (warns: string[]) => warns.filter((w) => w.includes(RULED_WORDING));

describe('plain-HTTP OAuth startup notice', () => {
  it('fires on a private-address deployment — the posture the ruling opened', async () => {
    const { warns } = await mountDiscoveryFor('http://192.168.1.10:3000');
    const notices = noticesIn(warns);
    expect(notices).toHaveLength(1);
    // The URL a client is actually sent to, not a generic phrase.
    expect(notices[0]).toContain('http://192.168.1.10:3000/api/v1/auth');
    // The consequence, concretely — what crosses the wire in the clear.
    expect(notices[0]).toMatch(/access tokens/i);
  });

  it('fires on a loopback deployment too — plain HTTP is plain HTTP', async () => {
    const { warns } = await mountDiscoveryFor('http://localhost:3000');
    expect(noticesIn(warns)).toHaveLength(1);
  });

  it('⛔ does NOT fire under TLS', async () => {
    const { warns } = await mountDiscoveryFor('https://acme.example.com');
    expect(noticesIn(warns)).toHaveLength(0);
  });

  it('fires exactly once per mount, not once per route', async () => {
    const { warns, routes } = await mountDiscoveryFor('http://10.0.0.5:3000');
    // Several routes are mounted in this one call; the notice is not one of
    // their handlers, so route count must not move the notice count.
    expect(routes.length).toBeGreaterThan(1);
    expect(noticesIn(warns)).toHaveLength(1);
  });

  it('is emitted at warn — a visibly smaller security posture, not a durability loss', async () => {
    const { warns, infos } = await mountDiscoveryFor('http://172.16.0.1:3000');
    expect(noticesIn(warns)).toHaveLength(1);
    expect(infos.filter((i) => i.includes(RULED_WORDING))).toHaveLength(0);
  });

  it('no environment variable turns it off', async () => {
    process.env.OS_ALLOW_INSECURE_OAUTH_HTTP = 'true';
    try {
      const { warns } = await mountDiscoveryFor('http://192.168.1.10:3000');
      expect(noticesIn(warns)).toHaveLength(1);
    } finally {
      delete process.env.OS_ALLOW_INSECURE_OAUTH_HTTP;
    }
  });
});
