// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The plain-HTTP OAuth startup notice — the second half of the deployment
 * transport rule (maintainer ruling 2026-09-21).
 *
 * `isOAuthEligibleBaseUrl` decides WHETHER an unencrypted deployment gets the
 * OAuth track; these notices are what keep either posture from being silent.
 * Ruling batch #210 item 5 (D1) fixes the shape: eligibility decides WHICH
 * sentence is emitted, never WHETHER one is. So a plain-HTTP boot always gets
 * exactly one line — the accepted-intranet line on an origin the rule
 * accepts, the public-plaintext line on one it refuses — each fires exactly
 * ONCE per mount, and neither fires under TLS.
 *
 * ⚠️ The PUBLIC plain-HTTP face is the one that costs something to get wrong,
 * and it is wrong in BOTH directions. A notice keyed on the SCHEME ALONE
 * prints the accepted-transport sentence there, which is FALSE of a
 * deployment whose OAuth track the same rule left dark. Silence is worse
 * still: the `.well-known` discovery documents are mounted regardless of
 * transport, and the `OAuth track is NOT live` line that was supposed to be
 * that deployment's own sits INSIDE the MCP-surface condition — so a public
 * plain-HTTP boot with the MCP surface OFF emitted no line at all, the
 * loudest-needed configuration being the quietest. Both faces are pinned
 * here, and the two sentences are held distinct so a log grep can tell them
 * apart by count alone.
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

/**
 * The ACCEPTED-origin line's grep anchor. The ruled sentence
 * 「OAuth 未加密:仅限可信内网」 is carried as this line's MEANING and lives
 * verbatim in the code comment beside the call — ruling batch #210 item 5
 * (D2) put the emitted string in English, the repository's convention for
 * code artefacts, and ⛔ no CJK executable string enters a package `src`
 * tree. The platform-checklist item greps this same English anchor.
 */
const NOTICE_MARKER = 'OAuth is served UNENCRYPTED';

/**
 * The REFUSED-origin line's grep anchor — a deliberately DISTINCT sentence.
 * ⛔ Neither marker may ever become a substring of the other's line: the
 * checklist scores the two postures by counting each anchor separately, so an
 * overlap silently turns one boot's line into two.
 */
const PUBLIC_NOTICE_MARKER = 'OAuth discovery is served over PUBLIC plain HTTP';

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
 *
 * `mcpServerEnabled` is the OS_MCP_SERVER_ENABLED surface switch (default ON,
 * `@objectstack/types#isMcpServerEnabled`) — the condition the `OAuth track is
 * NOT live` warning sits inside, so turning it OFF is how this file reaches
 * the configuration that used to emit nothing at all. `mcpOAuthEnabled` is the
 * manager's own verdict; a PUBLIC plain-HTTP boot really answers false there,
 * so the public-face cases pass it rather than leaning on a stub that says
 * yes where the real rule says no.
 */
async function mountDiscoveryFor(
  baseUrl: string,
  opts: { mcpServerEnabled?: boolean; mcpOAuthEnabled?: boolean } = {},
): Promise<{
  warns: string[];
  infos: string[];
  routes: string[];
}> {
  const origin = new URL(baseUrl).origin;
  const warns: string[] = [];
  const infos: string[] = [];
  const routes: string[] = [];

  if (opts.mcpServerEnabled === false) process.env.OS_MCP_SERVER_ENABLED = 'false';

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
    isMcpOAuthEnabled: () => opts.mcpOAuthEnabled ?? true,
    getMcpResourceUrl: () => `${origin}/api/v1/mcp`,
    getMcpProtectedResourceMetadata: () => ({ resource: `${origin}/api/v1/mcp` }),
  };

  const plugin = new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long', baseUrl });
  (plugin as any).authManager = manager;
  await (plugin as any).registerOidcDiscoveryRoutes(rawApp, ctx);

  return { warns, infos, routes };
}

const noticesIn = (warns: string[]) => warns.filter((w) => w.includes(NOTICE_MARKER));
const publicNoticesIn = (warns: string[]) =>
  warns.filter((w) => w.includes(PUBLIC_NOTICE_MARKER));

/**
 * Written with escapes on purpose: this test file is itself a source file in
 * a published package, so ⛔ the CJK sentence may not appear here as a string
 * either — the escaped range is what lets the pin assert its absence without
 * carrying it.
 */
const CJK_RANGE = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;

describe('plain-HTTP OAuth startup notice', () => {
  it('fires on a private-address deployment — the posture the ruling opened', async () => {
    const { warns } = await mountDiscoveryFor('http://192.168.1.10:3000');
    const notices = noticesIn(warns);
    expect(notices).toHaveLength(1);
    // The URL a client is actually sent to, not a generic phrase.
    expect(notices[0]).toContain('http://192.168.1.10:3000/api/v1/auth');
    // The consequence, concretely — what crosses the wire in the clear.
    expect(notices[0]).toMatch(/access tokens/i);
    // ⛔ D2: the emitted string is English. The ruled sentence is carried as
    // this line's meaning, verbatim in the comment beside the call site.
    expect(notices[0]).not.toMatch(CJK_RANGE);
  });

  it('fires on a loopback deployment too — plain HTTP is plain HTTP', async () => {
    const { warns } = await mountDiscoveryFor('http://localhost:3000');
    expect(noticesIn(warns)).toHaveLength(1);
  });

  it('⛔ does NOT fire under TLS — neither sentence does', async () => {
    const { warns } = await mountDiscoveryFor('https://acme.example.com');
    expect(noticesIn(warns)).toHaveLength(0);
    expect(publicNoticesIn(warns)).toHaveLength(0);
  });

  // ⛔ The security-floor leg of this file, and the half ruling batch #210
  // item 5 (D1) added. The accepted-transport sentence must NOT be printed on
  // a PUBLIC origin — the same rule left that deployment's OAuth track dark,
  // and an operator reading it would conclude a public plaintext
  // authorization server is a posture this rule permits. What changed is that
  // silence is no longer the alternative: eligibility picks WHICH sentence,
  // never WHETHER one is emitted.
  it.each([
    'http://example.com',
    'http://203.0.113.5',
    'http://intranet.corp:3000',
  ])('swaps the sentence on a PUBLIC plain-HTTP deployment: %s', async (baseUrl) => {
    const { warns } = await mountDiscoveryFor(baseUrl, { mcpOAuthEnabled: false });
    expect(noticesIn(warns)).toHaveLength(0);
    expect(publicNoticesIn(warns)).toHaveLength(1);
  });

  // ⛔ The configuration this branch exists for. The `OAuth track is NOT live`
  // warning sits INSIDE the MCP-surface condition, so with that surface off a
  // public plain-HTTP boot used to emit no warning whatsoever — while the
  // three `.well-known` discovery documents went up regardless of transport.
  // The loudest-needed deployment was the quietest one.
  it('fires on a PUBLIC plain-HTTP boot with the MCP surface OFF — the boot that had no warning at all', async () => {
    const { warns } = await mountDiscoveryFor('http://example.com', {
      mcpServerEnabled: false,
      mcpOAuthEnabled: false,
    });
    const notices = publicNoticesIn(warns);
    expect(notices).toHaveLength(1);
    // (a) the AS discovery surface, named, on this issuer.
    expect(notices[0]).toContain('http://example.com/api/v1/auth');
    expect(notices[0]).toContain('/.well-known/oauth-authorization-server');
    // (b) the MCP OAuth track is off.
    expect(notices[0]).toMatch(/DISABLED/);
    // (c) TLS is the remedy.
    expect(notices[0]).toMatch(/https/);
    expect(notices[0]).not.toMatch(CJK_RANGE);
    // ⛔ And it really is this deployment's ONLY line: the MCP branch is not
    // reached at all here, which is precisely why silence used to be the
    // whole of this boot log.
    expect(warns.filter((w) => w.includes('OAuth track is NOT live'))).toHaveLength(0);
    expect(warns).toHaveLength(1);
  });

  it('fires on a PUBLIC plain-HTTP boot with the MCP surface ON too — the line does not depend on MCP', async () => {
    const { warns } = await mountDiscoveryFor('http://example.com', {
      mcpServerEnabled: true,
      mcpOAuthEnabled: false,
    });
    expect(publicNoticesIn(warns)).toHaveLength(1);
    // The MCP branch's own line is a DIFFERENT sentence about a different
    // thing; both are present here and neither stands in for the other.
    expect(warns.filter((w) => w.includes('OAuth track is NOT live'))).toHaveLength(1);
  });

  it('⛔ does not fire the public sentence on an origin the rule ACCEPTS', async () => {
    for (const baseUrl of ['http://localhost:3000', 'http://10.0.0.5:3000']) {
      const { warns } = await mountDiscoveryFor(baseUrl);
      expect(publicNoticesIn(warns)).toHaveLength(0);
    }
  });

  it('every plain-HTTP boot gets exactly one of the two sentences', async () => {
    const cases: Array<[string, number, number]> = [
      ['http://localhost:3000', 1, 0],
      ['http://192.168.1.10:3000', 1, 0],
      ['http://example.com', 0, 1],
      ['http://203.0.113.5', 0, 1],
    ];
    for (const [baseUrl, accepted, refused] of cases) {
      const { warns } = await mountDiscoveryFor(baseUrl, { mcpServerEnabled: false });
      expect([baseUrl, noticesIn(warns).length, publicNoticesIn(warns).length]).toEqual([
        baseUrl,
        accepted,
        refused,
      ]);
    }
  });

  it('fires exactly once per mount, not once per route', async () => {
    const { warns, routes } = await mountDiscoveryFor('http://10.0.0.5:3000');
    // Several routes are mounted in this one call; the notice is not one of
    // their handlers, so route count must not move the notice count.
    expect(routes.length).toBeGreaterThan(1);
    expect(noticesIn(warns)).toHaveLength(1);
  });

  it('the public sentence is emitted once per mount too', async () => {
    const { warns, routes } = await mountDiscoveryFor('http://example.com', {
      mcpOAuthEnabled: false,
    });
    expect(routes.length).toBeGreaterThan(1);
    expect(publicNoticesIn(warns)).toHaveLength(1);
  });

  it('is emitted at warn — a visibly smaller security posture, not a durability loss', async () => {
    const { warns, infos } = await mountDiscoveryFor('http://172.16.0.1:3000');
    expect(noticesIn(warns)).toHaveLength(1);
    expect(infos.filter((i) => i.includes(NOTICE_MARKER))).toHaveLength(0);
  });

  it('the public sentence is emitted at warn as well', async () => {
    const { warns, infos } = await mountDiscoveryFor('http://example.com', {
      mcpOAuthEnabled: false,
    });
    expect(publicNoticesIn(warns)).toHaveLength(1);
    expect(infos.filter((i) => i.includes(PUBLIC_NOTICE_MARKER))).toHaveLength(0);
  });

  it('no environment variable turns either sentence off', async () => {
    process.env.OS_ALLOW_INSECURE_OAUTH_HTTP = 'true';
    try {
      const accepted = await mountDiscoveryFor('http://192.168.1.10:3000');
      expect(noticesIn(accepted.warns)).toHaveLength(1);
      const refused = await mountDiscoveryFor('http://example.com', {
        mcpOAuthEnabled: false,
      });
      expect(publicNoticesIn(refused.warns)).toHaveLength(1);
    } finally {
      delete process.env.OS_ALLOW_INSECURE_OAUTH_HTTP;
    }
  });
});
