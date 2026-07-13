// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthManager, ipMatchesRange } from './auth-manager';

// Mock better-auth so we can control the handler behaviour
vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({
    handler: vi.fn(),
    api: {},
  })),
}));

// Mock plugin imports — we only need to verify they are called with the
// correct schema options; the actual plugin logic is tested by better-auth.
vi.mock('better-auth/plugins/organization', () => ({
  organization: vi.fn((opts: any) => ({ id: 'organization', _opts: opts })),
}));

vi.mock('better-auth/plugins/two-factor', () => ({
  twoFactor: vi.fn((opts: any) => ({ id: 'two-factor', _opts: opts })),
}));

vi.mock('better-auth/plugins/magic-link', () => ({
  magicLink: vi.fn((_opts?: any) => ({ id: 'magic-link' })),
}));

vi.mock('better-auth/plugins/custom-session', () => ({
  customSession: vi.fn((fn: any) => ({ id: 'custom-session', _fn: fn })),
}));

vi.mock('better-auth/plugins/haveibeenpwned', () => ({
  haveIBeenPwned: vi.fn((opts: any) => ({ id: 'have-i-been-pwned', _opts: opts })),
}));

import { betterAuth } from 'better-auth';

describe('AuthManager', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  const prevMcpEnv = process.env.OS_MCP_SERVER_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // This suite exercises the config-driven plugin list / public config in
    // isolation. The MCP surface is default-ON and would append jwt +
    // oauth-provider everywhere; pin it off here — the default-on behaviour
    // has its own coverage in auth-manager.mcp-oauth.test.ts.
    process.env.OS_MCP_SERVER_ENABLED = 'false';
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    if (prevMcpEnv === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
    else process.env.OS_MCP_SERVER_ENABLED = prevMcpEnv;
  });

  describe('handleRequest – error response logging', () => {
    it('should log when better-auth returns a 500 response', async () => {
      const errorResponse = new Response(
        JSON.stringify({ error: 'Internal database error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );

      const mockHandler = vi.fn().mockResolvedValue(errorResponse);
      (betterAuth as any).mockReturnValue({ handler: mockHandler, api: {} });

      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });

      const request = new Request('http://localhost:3000/sign-up/email', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', password: 'pass' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await manager.handleRequest(request);

      expect(response.status).toBe(500);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[AuthManager] better-auth returned error:',
        500,
        expect.stringContaining('Internal database error'),
      );
    });

    it('should NOT log for successful (2xx) responses', async () => {
      const okResponse = new Response(JSON.stringify({ user: {} }), {
        status: 200,
      });

      const mockHandler = vi.fn().mockResolvedValue(okResponse);
      (betterAuth as any).mockReturnValue({ handler: mockHandler, api: {} });

      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });

      const request = new Request('http://localhost:3000/sign-in/email', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', password: 'pass' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await manager.handleRequest(request);

      expect(response.status).toBe(200);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should NOT log for 4xx responses', async () => {
      const badRequestResponse = new Response(
        JSON.stringify({ error: 'Bad request' }),
        { status: 400 },
      );

      const mockHandler = vi.fn().mockResolvedValue(badRequestResponse);
      (betterAuth as any).mockReturnValue({ handler: mockHandler, api: {} });

      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });

      const request = new Request('http://localhost:3000/sign-in/email', {
        method: 'POST',
      });

      const response = await manager.handleRequest(request);

      expect(response.status).toBe(400);
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('handleRequest – dev Origin injection (CSRF DX)', () => {
    const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

    afterEach(() => {
      if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    });

    const makeManager = () => {
      const captured: { request?: Request } = {};
      const mockHandler = vi.fn().mockImplementation((req: Request) => {
        captured.request = req;
        return new Response(null, { status: 200 });
      });
      (betterAuth as any).mockReturnValue({ handler: mockHandler, api: {} });
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });
      return { manager, captured };
    };

    it('injects a same-origin Origin header in dev when none is present', async () => {
      process.env.NODE_ENV = 'development';
      const { manager, captured } = makeManager();

      await manager.handleRequest(new Request('http://localhost:3000/sign-in/email', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', password: 'pass' }),
        headers: { 'Content-Type': 'application/json' },
      }));

      expect(captured.request?.headers.get('origin')).toBe('http://localhost:3000');
    });

    it('does NOT inject an Origin header in production', async () => {
      process.env.NODE_ENV = 'production';
      const { manager, captured } = makeManager();

      await manager.handleRequest(new Request('http://localhost:3000/sign-in/email', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', password: 'pass' }),
        headers: { 'Content-Type': 'application/json' },
      }));

      expect(captured.request?.headers.get('origin')).toBeNull();
    });

    it('preserves a caller-supplied Origin header in dev', async () => {
      process.env.NODE_ENV = 'development';
      const { manager, captured } = makeManager();

      await manager.handleRequest(new Request('http://localhost:3000/sign-in/email', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', password: 'pass' }),
        headers: { 'Content-Type': 'application/json', origin: 'http://example.test' },
      }));

      expect(captured.request?.headers.get('origin')).toBe('http://example.test');
    });

    it('does not inject when a Referer is already present in dev', async () => {
      process.env.NODE_ENV = 'development';
      const { manager, captured } = makeManager();

      await manager.handleRequest(new Request('http://localhost:3000/sign-in/email', {
        method: 'POST',
        headers: { referer: 'http://localhost:3000/login' },
      }));

      expect(captured.request?.headers.get('origin')).toBeNull();
    });
  });

  describe('createDatabaseConfig – adapter wrapping', () => {
    it('should pass a function (AdapterFactory) to betterAuth when dataEngine is provided', () => {
      const mockDataEngine = {
        insert: vi.fn(),
        findOne: vi.fn(),
        find: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        dataEngine: mockDataEngine as any,
      });

      // Trigger lazy initialization by calling getAuthInstance()
      // betterAuth should have been called with a database value that is a function
      // We need to trigger the lazy init first
    });

    it('should provide a factory function as database config', async () => {
      const mockDataEngine = {
        insert: vi.fn().mockResolvedValue({ id: '1' }),
        findOne: vi.fn().mockResolvedValue({ id: '1' }),
        find: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        update: vi.fn().mockResolvedValue({ id: '1' }),
        delete: vi.fn().mockResolvedValue(undefined),
      };

      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        dataEngine: mockDataEngine as any,
      });

      // Trigger lazy initialisation
      await manager.getAuthInstance();

      // The database config should be a function (AdapterFactory)
      expect(typeof capturedConfig.database).toBe('function');
    });

    it('should include modelName and fields mapping for user, session, account, verification', async () => {
      const mockDataEngine = {
        insert: vi.fn().mockResolvedValue({ id: '1' }),
        findOne: vi.fn().mockResolvedValue({ id: '1' }),
        find: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        update: vi.fn().mockResolvedValue({ id: '1' }),
        delete: vi.fn().mockResolvedValue(undefined),
      };

      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        dataEngine: mockDataEngine as any,
      });

      await manager.getAuthInstance();

      // Verify user model config
      expect(capturedConfig.user).toBeDefined();
      expect(capturedConfig.user.modelName).toBe('sys_user');
      expect(capturedConfig.user.fields).toEqual(expect.objectContaining({
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      }));

      // Verify session model config (merged with session timing config)
      expect(capturedConfig.session).toBeDefined();
      expect(capturedConfig.session.modelName).toBe('sys_session');
      expect(capturedConfig.session.fields).toEqual(expect.objectContaining({
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
      }));

      // Verify account model config
      expect(capturedConfig.account).toBeDefined();
      expect(capturedConfig.account.modelName).toBe('sys_account');
      expect(capturedConfig.account.fields).toEqual(expect.objectContaining({
        userId: 'user_id',
        providerId: 'provider_id',
        accountId: 'account_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
      }));

      // Verify verification model config
      expect(capturedConfig.verification).toBeDefined();
      expect(capturedConfig.verification.modelName).toBe('sys_verification');
      expect(capturedConfig.verification.fields).toEqual(expect.objectContaining({
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      }));
    });

    it('should return undefined (in-memory fallback) when no dataEngine is provided', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });

      await manager.getAuthInstance();

      expect(capturedConfig.database).toBeUndefined();
      warnSpy.mockRestore();
    });
  });

  describe('basePath configuration', () => {
    it('should default basePath to /api/v1/auth when not specified', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.basePath).toBe('/api/v1/auth');
    });

    it('should use custom basePath when provided', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        basePath: '/custom/auth',
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.basePath).toBe('/custom/auth');
    });
  });

  describe('plugin registration', () => {
    it('should always register the bearer plugin even with no plugin config', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.plugins.map((p: any) => p.id)).toEqual(['bearer', 'organization']);
    });

    it('should register organization plugin with schema mapping when enabled', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        plugins: { organization: true },
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      const orgPlugin = capturedConfig.plugins.find((p: any) => p.id === 'organization');
      expect(orgPlugin).toBeDefined();
      // Verify schema was passed to organization() call
      expect(orgPlugin._opts.schema.organization.modelName).toBe('sys_organization');
      expect(orgPlugin._opts.schema.member.modelName).toBe('sys_member');
      expect(orgPlugin._opts.schema.invitation.modelName).toBe('sys_invitation');
      expect(orgPlugin._opts.schema.team.modelName).toBe('sys_team');
      expect(orgPlugin._opts.schema.teamMember.modelName).toBe('sys_team_member');
      expect(orgPlugin._opts.schema.session.fields.activeOrganizationId).toBe('active_organization_id');
    });

    // @better-auth/scim mounts the SCIM 2.0 Service Provider so an external IdP
    // can auto-provision/deprovision this env's users (ADR-0071). It is opt-in
    // via OS_SCIM_ENABLED and FORCES the admin plugin on (active:false → ban
    // runs through admin).
    it('should NOT register the scim plugin by default', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.plugins.map((p: any) => p.id)).not.toContain('scim');
    });

    it('should register the scim plugin (and force admin on) when OS_SCIM_ENABLED is set', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });
      const prev = process.env.OS_SCIM_ENABLED;
      process.env.OS_SCIM_ENABLED = 'true';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const manager = new AuthManager({
          secret: 'test-secret-at-least-32-chars-long',
          baseUrl: 'http://localhost:3000',
        });
        await manager.getAuthInstance();
        const ids = capturedConfig.plugins.map((p: any) => p.id);
        expect(ids).toContain('scim');
        // active:false → ban needs the admin plugin; SCIM forces it on.
        expect(ids).toContain('admin');
      } finally {
        if (prev === undefined) delete process.env.OS_SCIM_ENABLED;
        else process.env.OS_SCIM_ENABLED = prev;
        warnSpy.mockRestore();
      }
    });

    it('blocks slug change when the org has active environments', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const dataEngine = {
        findOne: vi.fn(async (object: string) => {
          if (object === 'sys_organization') return { id: 'org-42', slug: 'acme-old' };
          return null;
        }),
        find: vi.fn(async (object: string) => {
          if (object === 'sys_environment') {
            return [
              { id: 'e1', status: 'active' },
              { id: 'e2', status: 'archived' },
            ];
          }
          return [];
        }),
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        plugins: { organization: true },
        dataEngine: dataEngine as any,
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      const orgPlugin = capturedConfig.plugins.find((p: any) => p.id === 'organization');
      const beforeUpdate = orgPlugin._opts.organizationHooks?.beforeUpdateOrganization;
      expect(typeof beforeUpdate).toBe('function');

      // Slug change to "acme-new" while 1 active env exists must throw.
      await expect(
        beforeUpdate({
          organization: { slug: 'acme-new' },
          member: { organizationId: 'org-42' },
        }),
      ).rejects.toThrowError(/active.*environment/i);
    });

    it('allows slug change when no active environments reference the org', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const dataEngine = {
        findOne: vi.fn(async () => ({ id: 'org-42', slug: 'acme-old' })),
        find: vi.fn(async () => [{ id: 'e1', status: 'archived' }]),
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        plugins: { organization: true },
        dataEngine: dataEngine as any,
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      const orgPlugin = capturedConfig.plugins.find((p: any) => p.id === 'organization');
      const beforeUpdate = orgPlugin._opts.organizationHooks.beforeUpdateOrganization;

      await expect(
        beforeUpdate({
          organization: { slug: 'acme-new' },
          member: { organizationId: 'org-42' },
        }),
      ).resolves.toBeUndefined();
    });

    it('allows non-slug updates (e.g. name only) without env checks', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const dataEngine = {
        findOne: vi.fn(),
        find: vi.fn(),
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        plugins: { organization: true },
        dataEngine: dataEngine as any,
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      const orgPlugin = capturedConfig.plugins.find((p: any) => p.id === 'organization');
      const beforeUpdate = orgPlugin._opts.organizationHooks.beforeUpdateOrganization;

      // Updating only `name` — no slug — must short-circuit before any DB read.
      await expect(
        beforeUpdate({
          organization: { name: 'New Name' },
          member: { organizationId: 'org-42' },
        }),
      ).resolves.toBeUndefined();
      expect(dataEngine.findOne).not.toHaveBeenCalled();
      expect(dataEngine.find).not.toHaveBeenCalled();
    });

    it('should register twoFactor plugin with schema mapping when enabled', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        plugins: { twoFactor: true },
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      const tfPlugin = capturedConfig.plugins.find((p: any) => p.id === 'two-factor');
      expect(tfPlugin).toBeDefined();
      expect(tfPlugin._opts.schema.twoFactor.modelName).toBe('sys_two_factor');
      expect(tfPlugin._opts.schema.twoFactor.fields.backupCodes).toBe('backup_codes');
      expect(tfPlugin._opts.schema.twoFactor.fields.userId).toBe('user_id');
      expect(tfPlugin._opts.schema.user.fields.twoFactorEnabled).toBe('two_factor_enabled');
    });

    it('should register magicLink plugin when enabled', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        plugins: { magicLink: true },
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      const mlPlugin = capturedConfig.plugins.find((p: any) => p.id === 'magic-link');
      expect(mlPlugin).toBeDefined();
    });

    it('should register multiple plugins when multiple flags are enabled', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        plugins: { organization: true, twoFactor: true, magicLink: true },
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.plugins).toHaveLength(4);
      expect(capturedConfig.plugins.map((p: any) => p.id).sort()).toEqual(
        ['bearer', 'magic-link', 'organization', 'two-factor'],
      );
    });
  });

  describe('bearer plugin (cross-origin / mobile token auth)', () => {
    it('should always register the bearer plugin regardless of other flags', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        plugins: { organization: true },
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      const bearerPlugin = capturedConfig.plugins.find((p: any) => p.id === 'bearer');
      expect(bearerPlugin).toBeDefined();
    });
  });

  describe('trustedOrigins passthrough', () => {
    it('should forward trustedOrigins to betterAuth when provided', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        trustedOrigins: ['https://*.objectos.app', 'http://localhost:*'],
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.trustedOrigins).toEqual([
        'https://*.objectos.app',
        'http://localhost:*',
      ]);
    });

    it('should default to localhost wildcard when trustedOrigins not provided', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.trustedOrigins).toEqual([
        'http://localhost:*',
        'http://*.localhost:*',
        'https://*.localhost:*',
      ]);
    });

    it('should default to localhost wildcard when trustedOrigins array is empty', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        trustedOrigins: [],
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.trustedOrigins).toEqual([
        'http://localhost:*',
        'http://*.localhost:*',
        'https://*.localhost:*',
      ]);
    });
  });

  describe('setRuntimeBaseUrl', () => {
    it('should update baseURL before auth instance is created', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });

      manager.setRuntimeBaseUrl('http://localhost:3002');
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.baseURL).toBe('http://localhost:3002');
    });

    it('should be a no-op and warn when called after auth instance is created', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });

      // Force auth instance creation
      await manager.getAuthInstance();
      expect(capturedConfig.baseURL).toBe('http://localhost:3000');

      // Now try to change — should warn and not affect the already-created instance
      manager.setRuntimeBaseUrl('http://localhost:4000');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('setRuntimeBaseUrl() called after the auth instance was already created'),
      );
      warnSpy.mockRestore();
    });

    it('passes an absolute https:// baseURL to better-auth when baseUrl is a bare host', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'cloud.objectos.ai',
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      // reset-password / verify-email / magic-link email links are derived
      // from this baseURL — it must carry a scheme or they are unclickable.
      expect(capturedConfig.baseURL).toBe('https://cloud.objectos.ai');
    });

    it('should override the default fallback (localhost:3000) when no baseUrl was configured', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
      });

      manager.setRuntimeBaseUrl('http://localhost:3002');
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.baseURL).toBe('http://localhost:3002');
    });
  });

  describe('socialProviders passthrough', () => {
    it('should forward socialProviders to betterAuth when provided', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        socialProviders: {
          google: { clientId: 'gid', clientSecret: 'gsecret' },
          github: { clientId: 'ghid', clientSecret: 'ghsecret' },
        },
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.socialProviders).toEqual({
        google: { clientId: 'gid', clientSecret: 'gsecret' },
        github: { clientId: 'ghid', clientSecret: 'ghsecret' },
      });
    });

    it('should NOT include socialProviders when not provided', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig).not.toHaveProperty('socialProviders');
    });
  });

  describe('emailAndPassword passthrough', () => {
    it('should default emailAndPassword to enabled: true', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.emailAndPassword.enabled).toBe(true);
    });

    it('should forward extended emailAndPassword options', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        emailAndPassword: {
          enabled: true,
          minPasswordLength: 12,
          maxPasswordLength: 64,
          requireEmailVerification: true,
          autoSignIn: false,
          revokeSessionsOnPasswordReset: true,
        },
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.emailAndPassword).toMatchObject({
        enabled: true,
        minPasswordLength: 12,
        maxPasswordLength: 64,
        requireEmailVerification: true,
        autoSignIn: false,
        revokeSessionsOnPasswordReset: true,
      });
      expect(typeof capturedConfig.emailAndPassword.sendResetPassword).toBe('function');
    });
  });

  describe('emailVerification passthrough', () => {
    it('should forward emailVerification when provided', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        emailVerification: {
          sendOnSignUp: true,
          expiresIn: 1800,
        },
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.emailVerification).toMatchObject({
        sendOnSignUp: true,
        expiresIn: 1800,
      });
      expect(typeof capturedConfig.emailVerification.sendVerificationEmail).toBe('function');
    });

    it('should NOT include emailVerification when not provided', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig).not.toHaveProperty('emailVerification');
    });
  });

  describe('advanced options passthrough', () => {
    it('should forward crossSubDomainCookies when provided', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        advanced: {
          crossSubDomainCookies: {
            enabled: true,
            domain: '.objectos.app',
          },
          useSecureCookies: true,
        },
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.advanced).toEqual({
        crossSubDomainCookies: {
          enabled: true,
          domain: '.objectos.app',
        },
        useSecureCookies: true,
      });
    });

    it('should forward cookiePrefix and disableCSRFCheck', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        advanced: {
          disableCSRFCheck: true,
          cookiePrefix: 'objectos',
        },
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig.advanced.disableCSRFCheck).toBe(true);
      expect(capturedConfig.advanced.cookiePrefix).toBe('objectos');
    });

    it('should NOT include advanced when not provided', async () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(capturedConfig).not.toHaveProperty('advanced');
    });
  });

  // #2766 V1.5 — phone+password sign-in via better-auth's phone-number plugin.
  describe('phone-number plugin (#2766 V1.5)', () => {
    const boot = async (plugins?: any) => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        ...(plugins ? { plugins } : {}),
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();
      return { manager, capturedConfig };
    };

    it('is NOT registered by default', async () => {
      const { capturedConfig } = await boot();
      expect(capturedConfig.plugins.find((p: any) => p.id === 'phone-number')).toBeUndefined();
    });

    it('registers with snake_case schema mapping when enabled', async () => {
      const { capturedConfig } = await boot({ phoneNumber: true });
      const plugin = capturedConfig.plugins.find((p: any) => p.id === 'phone-number');
      expect(plugin).toBeDefined();
    });

    it('features.phoneNumber mirrors the plugin switch', async () => {
      const { manager } = await boot({ phoneNumber: true });
      expect((manager.getPublicConfig() as any).features.phoneNumber).toBe(true);
      expect(manager.isPhoneNumberEnabled()).toBe(true);
      const { manager: off } = await boot();
      expect((off.getPublicConfig() as any).features.phoneNumber).toBe(false);
      expect(off.isPhoneNumberEnabled()).toBe(false);
    });
  });

  // #2780 — phone-number OTP delivered over the SMS service.
  describe('phone-number OTP over SMS (#2780)', () => {
    const PHONE = '+8613800000000';

    const fakeSms = (opts: { failed?: boolean } = {}) => {
      const sent: any[] = [];
      return {
        sent,
        service: {
          async send(input: any) {
            sent.push(input);
            return opts.failed
              ? { id: 'sms_1', status: 'failed', error: 'provider down' }
              : { id: 'sms_1', status: 'sent', messageId: 'prov_1' };
          },
          isConfigured: () => true,
        } as any,
      };
    };

    const bootOtp = async (config: any = {}) => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((cfg: any) => {
        capturedConfig = cfg;
        return { handler: vi.fn(), api: {} };
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        plugins: { phoneNumber: true },
        ...config,
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();
      const plugin = capturedConfig.plugins.find((p: any) => p.id === 'phone-number');
      return { manager, plugin, opts: plugin.options };
    };

    it('passes allowedAttempts explicitly (default 3) and a phone-shape validator', async () => {
      const { opts } = await bootOtp();
      expect(opts.allowedAttempts).toBe(3);
      expect(opts.phoneNumberValidator('+86 138-0000-0000')).toBe(true);
      expect(opts.phoneNumberValidator('bob@example.com')).toBe(false);
    });

    it('sendOTP throws NOT_SUPPORTED without an SMS service (pre-#2780 behaviour preserved)', async () => {
      const { opts } = await bootOtp();
      await expect(opts.sendOTP({ phoneNumber: PHONE, code: '123456' })).rejects.toThrow(/NOT_SUPPORTED/);
    });

    it('sendOTP delivers the code in the SMS body (and only there)', async () => {
      const { manager, opts } = await bootOtp();
      const sms = fakeSms();
      manager.setSmsService(sms.service);

      await opts.sendOTP({ phoneNumber: PHONE, code: '123456' });
      expect(sms.sent).toHaveLength(1);
      expect(sms.sent[0].to).toBe(PHONE);
      expect(sms.sent[0].body).toContain('123456');
      expect(sms.sent[0].templateParams).toEqual({ code: '123456' });
    });

    it('enforces the per-number cooldown at ADMISSION (before-hook), not in sendOTP', async () => {
      const { manager, opts } = await bootOtp();
      const sms = fakeSms();
      manager.setSmsService(sms.service);

      // Admission guard: first request per number passes, immediate second 429s.
      await manager.assertPhoneOtpSendAllowed(PHONE);
      await expect(manager.assertPhoneOtpSendAllowed(PHONE))
        .rejects.toThrow(/Too many verification codes/);

      // The sendOTP callback itself must NOT re-guard: better-auth stores the
      // fresh code BEFORE invoking it, so a rejection at that point would
      // still rotate (void) the previously delivered code. Delivery always
      // proceeds once a request was admitted.
      await opts.sendOTP({ phoneNumber: PHONE, code: '111111' });
      await opts.sendOTP({ phoneNumber: PHONE, code: '222222' });
      expect(sms.sent).toHaveLength(2);
    });

    it('the admission budget spans both flows (send-otp + request-password-reset)', async () => {
      const { manager } = await bootOtp();
      manager.setSmsService(fakeSms().service);

      // One admitted send (whatever the flow) blocks an immediate second one.
      await manager.assertPhoneOtpSendAllowed(PHONE);
      await expect(manager.assertPhoneOtpSendAllowed(PHONE))
        .rejects.toThrow(/Too many verification codes/);
    });

    it('admission is a no-op while OTP is undeliverable (sendOTP fails loudly instead)', async () => {
      const { manager } = await bootOtp();
      // No SMS service wired — the guard must not consume budget or throw.
      await manager.assertPhoneOtpSendAllowed(PHONE);
      await manager.assertPhoneOtpSendAllowed(PHONE);
    });

    it('surfaces a failed SMS delivery WITHOUT the code in the error', async () => {
      const { manager, opts } = await bootOtp();
      const sms = fakeSms({ failed: true });
      manager.setSmsService(sms.service);

      await expect(opts.sendOTP({ phoneNumber: PHONE, code: '555555' }))
        .rejects.toSatisfy((e: Error) => /provider down/.test(e.message) && !e.message.includes('555555'));
    });

    it('honours phoneOtp knobs (cooldown off ⇒ back-to-back admissions allowed)', async () => {
      const { manager } = await bootOtp({ phoneOtp: { cooldownSeconds: 0, maxPerHour: 0 } });
      manager.setSmsService(fakeSms().service);
      await manager.assertPhoneOtpSendAllowed(PHONE);
      await manager.assertPhoneOtpSendAllowed(PHONE);
    });

    it('features.phoneNumberOtp requires plugin + deliverable SMS', async () => {
      const { manager } = await bootOtp();
      expect((manager.getPublicConfig() as any).features.phoneNumberOtp).toBe(false);
      expect(manager.isSmsServiceAvailable()).toBe(false);

      manager.setSmsService(fakeSms().service);
      expect(manager.isSmsServiceAvailable()).toBe(true);
      expect(manager.isPhoneOtpDeliverable()).toBe(true);
      expect((manager.getPublicConfig() as any).features.phoneNumberOtp).toBe(true);
    });

    it('an unconfigured (log-only) SMS service does not advertise OTP in production', async () => {
      const { manager } = await bootOtp();
      manager.setSmsService({ async send() { return { id: 'x', status: 'sent' }; }, isConfigured: () => false } as any);
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(manager.isPhoneOtpDeliverable()).toBe(false);
        expect((manager.getPublicConfig() as any).features.phoneNumberOtp).toBe(false);
      } finally {
        process.env.NODE_ENV = prev;
      }
      // Outside production the dev log transport keeps OTP testable.
      expect(manager.isPhoneOtpDeliverable()).toBe(true);
    });

    it('sendPhoneInviteSms sends a credential-free invite and throws without a service', async () => {
      const { manager } = await bootOtp();
      await expect(manager.sendPhoneInviteSms(PHONE)).rejects.toThrow(/SMS_SERVICE_REQUIRED/);

      const sms = fakeSms();
      manager.setSmsService(sms.service);
      await manager.sendPhoneInviteSms(PHONE);
      expect(sms.sent).toHaveLength(1);
      expect(sms.sent[0].to).toBe(PHONE);
      expect(sms.sent[0].body).toMatch(/verification code/);
      // Links to the actual Console sign-in page, not the bare origin.
      expect(sms.sent[0].body).toContain('http://localhost:3000/_console/login');
    });

    // #2815 — localised, tenant-customisable SMS bodies.
    it('renders the built-in Chinese OTP text for a zh-CN deployment locale', async () => {
      const { manager, opts } = await bootOtp();
      const sms = fakeSms();
      manager.setSmsService(sms.service);
      manager.setDefaultSmsLocale('zh-CN');

      await opts.sendOTP({ phoneNumber: PHONE, code: '123456' });
      expect(sms.sent[0].body).toContain('验证码');
      expect(sms.sent[0].body).toContain('123456');
      expect(sms.sent[0].templateParams).toEqual({ code: '123456' });

      await manager.sendPhoneInviteSms(PHONE);
      expect(sms.sent[1].body).toContain('账号已开通');
      expect(sms.sent[1].body).toContain('http://localhost:3000/_console/login');
    });

    it('a tenant sys_notification_template row overrides the built-in text', async () => {
      const { manager, opts } = await bootOtp({
        dataEngine: {
          async find(object: string, q: any) {
            if (
              object === 'sys_notification_template' &&
              q?.where?.topic === 'auth.phone_otp' &&
              q?.where?.channel === 'sms' &&
              q?.where?.locale === 'zh-CN'
            ) {
              return [{ body: '【定制】验证码 {{code}}（{{minutes}} 分钟）' }];
            }
            return [];
          },
        },
      });
      const sms = fakeSms();
      manager.setSmsService(sms.service);
      manager.setDefaultSmsLocale('zh-CN');

      await opts.sendOTP({ phoneNumber: PHONE, code: '654321' });
      expect(sms.sent[0].body).toBe('【定制】验证码 654321（5 分钟）');
    });

    it('a broken template lookup falls back to the built-in text (never blocks the send)', async () => {
      const { manager, opts } = await bootOtp({
        dataEngine: { async find() { throw new Error('no such table'); } },
      });
      const sms = fakeSms();
      manager.setSmsService(sms.service);

      await opts.sendOTP({ phoneNumber: PHONE, code: '111222' });
      expect(sms.sent[0].body).toContain('111222');
      expect(sms.sent[0].body).toContain('verification code');
    });
  });

  // #2766 V1.5 — placeholder addresses must never become real recipients.
  describe('placeholder-email interception (#2766 V1.5)', () => {
    const PLACEHOLDER = 'u-abcdefghijklmnopqrst@placeholder.invalid';
    const boot = async (extra: any = {}) => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        emailAndPassword: { enabled: true },
        ...extra,
      });
      const emailService = { sendTemplate: vi.fn(async () => ({ status: 'sent' })) };
      manager.setEmailService(emailService as any);
      await manager.getAuthInstance();
      warnSpy.mockRestore();
      return { manager, capturedConfig, emailService };
    };

    it('sendResetPassword refuses a placeholder recipient without touching the transport', async () => {
      const { capturedConfig, emailService } = await boot();
      const sendResetPassword = capturedConfig.emailAndPassword.sendResetPassword;
      await expect(
        sendResetPassword({ user: { id: 'u1', email: PLACEHOLDER }, url: 'http://x/reset', token: 't' }),
      ).rejects.toThrow(/PLACEHOLDER_EMAIL/);
      expect(emailService.sendTemplate).not.toHaveBeenCalled();
    });

    it('sendInvitationEmail refuses a placeholder recipient', async () => {
      const { capturedConfig, emailService } = await boot();
      const orgPlugin = capturedConfig.plugins.find((p: any) => p.id === 'organization');
      await expect(
        orgPlugin._opts.sendInvitationEmail({
          email: PLACEHOLDER,
          invitation: { id: 'inv1', organizationId: 'o1', role: 'member' },
          organization: { name: 'Org' },
          inviter: { user: { email: 'admin@example.com' } },
        }),
      ).rejects.toThrow(/PLACEHOLDER_EMAIL/);
      expect(emailService.sendTemplate).not.toHaveBeenCalled();
    });

    // NOTE: the magic-link guard is the same isPlaceholderEmail() branch, but
    // unlike organization the magic-link plugin doesn't expose its options
    // (`_opts`), so it can't be invoked directly here. Covered by the two
    // tests above plus the placeholder-email unit tests.
    it('magic-link plugin registers when enabled (guard shares the tested code path)', async () => {
      const { capturedConfig } = await boot({ plugins: { magicLink: true } });
      expect(capturedConfig.plugins.find((p: any) => p.id === 'magic-link')).toBeDefined();
    });

    // The emailed accept URL must be an absolute link pointing at the Console
    // SPA route, which is mounted under `uiBasePath` (default `/_console`) —
    // the same basename as /login. A bare host in baseUrl (no scheme) also
    // produced relative-looking links email clients wouldn't open.
    it('sendInvitationEmail builds an absolute https:// accept URL under the Console base', async () => {
      const { capturedConfig, emailService } = await boot({ baseUrl: 'cloud.objectos.ai' });
      const orgPlugin = capturedConfig.plugins.find((p: any) => p.id === 'organization');
      await orgPlugin._opts.sendInvitationEmail({
        email: 'invitee@example.com',
        invitation: { id: 'tok123', organizationId: 'o1', role: 'member' },
        organization: { name: 'Org' },
        inviter: { user: { email: 'admin@example.com' } },
      });
      expect(emailService.sendTemplate).toHaveBeenCalledTimes(1);
      const { data } = emailService.sendTemplate.mock.calls[0][0];
      expect(data.acceptUrl).toBe('https://cloud.objectos.ai/_console/accept-invitation/tok123');
    });

    it('sendInvitationEmail preserves an explicit scheme in baseUrl', async () => {
      const { capturedConfig, emailService } = await boot({ baseUrl: 'http://localhost:3000/' });
      const orgPlugin = capturedConfig.plugins.find((p: any) => p.id === 'organization');
      await orgPlugin._opts.sendInvitationEmail({
        email: 'invitee@example.com',
        invitation: { id: 'tok456', organizationId: 'o1', role: 'member' },
        organization: { name: 'Org' },
        inviter: { user: { email: 'admin@example.com' } },
      });
      const { data } = emailService.sendTemplate.mock.calls[0][0];
      expect(data.acceptUrl).toBe('http://localhost:3000/_console/accept-invitation/tok456');
    });

    it('sendInvitationEmail honours a custom uiBasePath (Console mounted elsewhere)', async () => {
      const { capturedConfig, emailService } = await boot({
        baseUrl: 'https://acme.example.com',
        uiBasePath: '/console/',
      });
      const orgPlugin = capturedConfig.plugins.find((p: any) => p.id === 'organization');
      await orgPlugin._opts.sendInvitationEmail({
        email: 'invitee@example.com',
        invitation: { id: 'tok789', organizationId: 'o1', role: 'member' },
        organization: { name: 'Org' },
        inviter: { user: { email: 'admin@example.com' } },
      });
      const { data } = emailService.sendTemplate.mock.calls[0][0];
      expect(data.acceptUrl).toBe('https://acme.example.com/console/accept-invitation/tok789');
    });
  });

  describe('getPublicConfig', () => {
    it('should return safe public configuration', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        socialProviders: {
          google: {
            clientId: 'google-client-id',
            clientSecret: 'google-client-secret',
            enabled: true,
          },
          github: {
            clientId: 'github-client-id',
            clientSecret: 'github-client-secret',
          },
        },
        emailAndPassword: {
          enabled: true,
          disableSignUp: false,
          requireEmailVerification: true,
        },
        plugins: {
          twoFactor: true,
          organization: true,
        },
      });
      warnSpy.mockRestore();

      const config = manager.getPublicConfig();

      // Should include social providers without secrets
      expect(config.socialProviders).toHaveLength(2);
      expect(config.socialProviders[0]).toEqual({
        id: 'google',
        name: 'Google',
        enabled: true,
        type: 'social',
      });
      expect(config.socialProviders[1]).toEqual({
        id: 'github',
        name: 'GitHub',
        enabled: true,
        type: 'social',
      });

      // Should NOT include sensitive data
      expect(config).not.toHaveProperty('secret');
      expect(config.socialProviders[0]).not.toHaveProperty('clientSecret');
      expect(config.socialProviders[0]).not.toHaveProperty('clientId');

      // Should include email/password config
      expect(config.emailPassword).toEqual({
        enabled: true,
        disableSignUp: false,
        requireEmailVerification: true,
      });

      // Should include features
      expect(config.features).toEqual({
        twoFactor: true,
        passkeys: false,
        magicLink: false,
        organization: true,
        oidcProvider: false,
        sso: false,
        ssoEnforced: false,
        deviceAuthorization: false,
        admin: false,
        phoneNumber: false,
        phoneNumberOtp: false,
        multiOrgEnabled: false,
        privacyUrl: 'https://objectstack.ai/privacy',
        termsUrl: 'https://objectstack.ai/terms',
      });
    });

    // Enterprise SSO (@better-auth/sso) is opt-in: the plugin is only wired
    // when `plugins.sso` / `OS_SSO_ENABLED` is on. The public config MUST
    // report the same value so the login UI can hide the "Sign in with SSO"
    // button when the `/sign-in/sso` route isn't mounted (otherwise the
    // button only fails at click time with "No SSO provider is configured").
    it('should report features.sso=false by default', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
      });
      warnSpy.mockRestore();

      expect(manager.getPublicConfig().features.sso).toBe(false);
    });

    it('should report features.sso=true when enabled via plugins config', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        plugins: { sso: true } as any,
      });
      warnSpy.mockRestore();

      expect(manager.getPublicConfig().features.sso).toBe(true);
    });

    it('should let OS_SSO_ENABLED env override the config (matches buildPlugins wiring)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const prev = process.env.OS_SSO_ENABLED;
      process.env.OS_SSO_ENABLED = 'true';
      try {
        const manager = new AuthManager({
          secret: 'test-secret-at-least-32-chars-long',
        });
        expect(manager.getPublicConfig().features.sso).toBe(true);
      } finally {
        if (prev === undefined) delete process.env.OS_SSO_ENABLED;
        else process.env.OS_SSO_ENABLED = prev;
        warnSpy.mockRestore();
      }
    });

    // ADR-0024 / cloud#551 — OS_SSO_ENABLED uses the shared `readBooleanEnv`
    // parser, so the platform-standard truthy/falsy set works (not only the
    // literal `'true'`). Operators kept setting `OS_SSO_ENABLED=1` and getting
    // a silently-disabled RP.
    it.each(['1', 'true', 'TRUE', 'yes', 'on'])(
      'should treat OS_SSO_ENABLED=%s as enabled',
      (val) => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const prev = process.env.OS_SSO_ENABLED;
        process.env.OS_SSO_ENABLED = val;
        try {
          const manager = new AuthManager({ secret: 'test-secret-at-least-32-chars-long' });
          expect(manager.getPublicConfig().features.sso).toBe(true);
        } finally {
          if (prev === undefined) delete process.env.OS_SSO_ENABLED;
          else process.env.OS_SSO_ENABLED = prev;
          warnSpy.mockRestore();
        }
      },
    );

    it.each(['0', 'false', 'off', 'no'])(
      'should treat OS_SSO_ENABLED=%s as disabled even when plugins.sso=true',
      (val) => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const prev = process.env.OS_SSO_ENABLED;
        process.env.OS_SSO_ENABLED = val;
        try {
          const manager = new AuthManager({
            secret: 'test-secret-at-least-32-chars-long',
            plugins: { sso: true } as any,
          });
          expect(manager.getPublicConfig().features.sso).toBe(false);
        } finally {
          if (prev === undefined) delete process.env.OS_SSO_ENABLED;
          else process.env.OS_SSO_ENABLED = prev;
          warnSpy.mockRestore();
        }
      },
    );

    it('should filter out disabled providers', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        socialProviders: {
          google: {
            clientId: 'google-client-id',
            clientSecret: 'google-client-secret',
            enabled: true,
          },
          github: {
            clientId: 'github-client-id',
            clientSecret: 'github-client-secret',
            enabled: false,
          },
        },
      });
      warnSpy.mockRestore();

      const config = manager.getPublicConfig();

      expect(config.socialProviders).toHaveLength(1);
      expect(config.socialProviders[0].id).toBe('google');
    });

    it('should default email/password to enabled', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
      });
      warnSpy.mockRestore();

      const config = manager.getPublicConfig();

      expect(config.emailPassword.enabled).toBe(true);
    });

    it('should handle unknown provider names', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        socialProviders: {
          customProvider: {
            clientId: 'custom-client-id',
            clientSecret: 'custom-client-secret',
          },
        },
      });
      warnSpy.mockRestore();

      const config = manager.getPublicConfig();

      expect(config.socialProviders[0]).toEqual({
        id: 'customProvider',
        name: 'CustomProvider',
        enabled: true,
        type: 'social',
      });
    });
  });

  // The `/auth/config` route refines the coarse `features.sso` ("wired") flag
  // to "usable" via isSsoUsable() so the login UI hides the "Sign in with SSO"
  // button BOTH when SSO is off and when it's on but no IdP is configured yet.
  describe('isSsoUsable – refines features.sso to "≥1 provider configured"', () => {
    const makeEngine = (countImpl: () => Promise<number> | number) =>
      ({
        insert: vi.fn(),
        findOne: vi.fn(),
        find: vi.fn(),
        count: vi.fn().mockImplementation(countImpl),
        update: vi.fn(),
        delete: vi.fn(),
      });

    it('returns false when SSO is not wired (skips the provider query entirely)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const engine = makeEngine(() => 5);
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        dataEngine: engine as any,
      });
      warnSpy.mockRestore();

      expect(await manager.isSsoUsable()).toBe(false);
      expect(engine.count).not.toHaveBeenCalled();
    });

    it('returns false when wired but zero providers are configured', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const engine = makeEngine(() => 0);
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        plugins: { sso: true } as any,
        dataEngine: engine as any,
      });
      warnSpy.mockRestore();

      expect(await manager.isSsoUsable()).toBe(false);
      // Reads sys_sso_provider under a system context (RLS would otherwise zero it out).
      expect(engine.count.mock.calls[0][0]).toBe('sys_sso_provider');
      expect(engine.count.mock.calls[0][1]?.context?.isSystem).toBe(true);
    });

    it('returns true when wired and at least one provider exists', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        plugins: { sso: true } as any,
        dataEngine: makeEngine(() => 1) as any,
      });
      warnSpy.mockRestore();

      expect(await manager.isSsoUsable()).toBe(true);
    });

    it('fails open to wired when there is no data engine to consult', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        plugins: { sso: true } as any,
      });
      warnSpy.mockRestore();

      expect(await manager.isSsoUsable()).toBe(true);
    });

    it('fails open to wired when the provider-count query throws', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        plugins: { sso: true } as any,
        dataEngine: makeEngine(() => {
          throw new Error('db down');
        }) as any,
      });
      warnSpy.mockRestore();

      expect(await manager.isSsoUsable()).toBe(true);
    });
  });

  describe('WebContainer request-state polyfill', () => {
    const sym = Symbol.for('better-auth:global');

    beforeEach(() => {
      // Reset better-auth global between tests so installation logic re-runs.
      delete (globalThis as any)[sym];
    });

    afterEach(() => {
      delete (globalThis as any)[sym];
      delete (globalThis as any).process?.env?.STACKBLITZ;
    });

    it('does NOT install a polyfill outside WebContainer', () => {
      // Default test env (Node + Vitest) is not WebContainer.
      delete (globalThis as any).process?.env?.STACKBLITZ;
      const proc = (globalThis as any).process;
      const prevShell = proc?.env?.SHELL;
      const prevWc = proc?.versions?.webcontainer;
      if (proc?.env) delete proc.env.SHELL;
      if (proc?.versions) delete proc.versions.webcontainer;

      try {
        new AuthManager({
          secret: 'test-secret-at-least-32-chars-long',
          baseUrl: 'http://localhost:3000',
        });
        expect((globalThis as any)[sym]?.context?.requestStateAsyncStorage).toBeUndefined();
      } finally {
        if (proc?.env && prevShell !== undefined) proc.env.SHELL = prevShell;
        if (proc?.versions && prevWc !== undefined) proc.versions.webcontainer = prevWc;
      }
    });

    it('installs a synchronous polyfill when WebContainer is detected', () => {
      (globalThis as any).process = (globalThis as any).process || {};
      (globalThis as any).process.env = (globalThis as any).process.env || {};
      (globalThis as any).process.env.STACKBLITZ = '1';

      new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });

      const als = (globalThis as any)[sym]?.context?.requestStateAsyncStorage;
      expect(als).toBeDefined();
      expect(typeof als.run).toBe('function');
      expect(typeof als.getStore).toBe('function');
    });

    it('polyfill propagates store across awaits within a single run() call', async () => {
      (globalThis as any).process = (globalThis as any).process || {};
      (globalThis as any).process.env = (globalThis as any).process.env || {};
      (globalThis as any).process.env.STACKBLITZ = '1';

      new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });

      const als = (globalThis as any)[sym].context.requestStateAsyncStorage;
      const store = new WeakMap();

      const inner = async () => {
        await Promise.resolve();
        await Promise.resolve();
        return als.getStore();
      };

      const result = await als.run(store, () => inner());
      expect(result).toBe(store);
    });

    it('polyfill restores previous store after run() settles, even on error', async () => {
      (globalThis as any).process = (globalThis as any).process || {};
      (globalThis as any).process.env = (globalThis as any).process.env || {};
      (globalThis as any).process.env.STACKBLITZ = '1';

      new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });

      const als = (globalThis as any)[sym].context.requestStateAsyncStorage;
      expect(als.getStore()).toBeUndefined();

      const outer = new WeakMap();
      const inner = new WeakMap();
      await als.run(outer, async () => {
        expect(als.getStore()).toBe(outer);
        await als.run(inner, async () => {
          await Promise.resolve();
          expect(als.getStore()).toBe(inner);
        });
        expect(als.getStore()).toBe(outer);
      });
      expect(als.getStore()).toBeUndefined();

      await expect(
        als.run(outer, async () => {
          await Promise.resolve();
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(als.getStore()).toBeUndefined();
    });
  });

  describe('generateSecret – production secret guard (P0-1)', () => {
    const ENV_KEYS = ['NODE_ENV', 'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET'] as const;
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
      for (const k of ['OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET']) delete process.env[k];
    });
    afterEach(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it('throws (fails boot) in production when no secret is configured', () => {
      process.env.NODE_ENV = 'production';
      const m = new AuthManager({ baseUrl: 'http://localhost:3000' } as any);
      expect(() => (m as any).generateSecret()).toThrow(/OS_AUTH_SECRET is required in production/);
    });

    it('falls back to an ephemeral dev secret outside production', () => {
      process.env.NODE_ENV = 'development';
      const m = new AuthManager({ baseUrl: 'http://localhost:3000' } as any);
      expect((m as any).generateSecret()).toMatch(/^dev-secret-/);
    });

    it('uses OS_AUTH_SECRET when set, even in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.OS_AUTH_SECRET = 'a-strong-production-secret-value';
      const m = new AuthManager({ baseUrl: 'http://localhost:3000' } as any);
      expect((m as any).generateSecret()).toBe('a-strong-production-secret-value');
    });
  });

  describe('customSession – derived identity and positions array', () => {
    // dataEngine stub: `adminLinks` controls whether the user resolves as a
    // platform admin (a sys_user_permission_set row pointing at the
    // admin_full_access permission set with no organization scope).
    const makeDataEngine = (opts: { platformAdmin: boolean }) => ({
      find: vi.fn(async (object: string) => {
        if (object === 'sys_user_permission_set') {
          return opts.platformAdmin
            ? [{ user_id: 'u-1', permission_set_id: 'ps-admin', organization_id: null }]
            : [];
        }
        if (object === 'sys_permission_set') {
          return [{ id: 'ps-admin', name: 'admin_full_access' }];
        }
        return [];
      }),
      findOne: vi.fn(),
    });

    const getSessionCallback = async (dataEngine: any) => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        dataEngine,
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      const plugin = capturedConfig.plugins.find((p: any) => p.id === 'custom-session');
      expect(plugin).toBeDefined();
      return plugin._fn as (input: { user: any; session: any }) => Promise<any>;
    };

    it('returns positions=[] for a regular user with no stored role', async () => {
      const callback = await getSessionCallback(makeDataEngine({ platformAdmin: false }));
      const result = await callback({
        user: { id: 'u-1', email: 'a@b.com' },
        session: {},
      });
      expect(result.user.role).toBeUndefined();
      expect(result.user.positions).toEqual([]);
    });

    it('splits a stored role string into positions for a non-admin user', async () => {
      const callback = await getSessionCallback(makeDataEngine({ platformAdmin: false }));
      const result = await callback({
        user: { id: 'u-1', email: 'a@b.com', role: 'manager' },
        session: {},
      });
      // No promotion: `role` keeps its stored value.
      expect(result.user.role).toBe('manager');
      expect(result.user.positions).toEqual(['manager']);
    });

    it('appends platform_admin to positions[] without overwriting role when promoting a platform admin', async () => {
      const callback = await getSessionCallback(makeDataEngine({ platformAdmin: true }));
      const result = await callback({
        user: { id: 'u-1', email: 'a@b.com', role: 'manager' },
        session: {},
      });
      // ADR-0068: NO `role:'admin'` overwrite footgun. The deprecated scalar
      // keeps its stored value; the canonical platform_admin identity is added
      // to roles[], and isPlatformAdmin is a derived alias.
      expect(result.user.role).toBe('manager');
      expect(result.user.positions).toEqual(['manager', 'platform_admin']);
      expect(result.user.isPlatformAdmin).toBe(true);
    });

    it('splits a multi-token stored role and appends platform_admin without duplicates', async () => {
      const callback = await getSessionCallback(makeDataEngine({ platformAdmin: true }));
      const result = await callback({
        user: { id: 'u-1', email: 'a@b.com', role: 'admin,manager' },
        session: {},
      });
      expect(result.user.role).toBe('admin,manager');
      expect(result.user.positions).toEqual(['admin', 'manager', 'platform_admin']);
      expect(result.user.isPlatformAdmin).toBe(true);
    });

    it('returns the payload untouched when the user has no id', async () => {
      const callback = await getSessionCallback(makeDataEngine({ platformAdmin: false }));
      const user = { email: 'anon@b.com' };
      const result = await callback({ user, session: {} });
      expect(result.user).toBe(user);
      expect(result.user.positions).toBeUndefined();
    });
  });

  // ADR-0069 D1: breached-password rejection enables better-auth's native
  // `haveibeenpwned` plugin. Default OFF (no false surface, ADR-0049); the
  // settings toggle (`password_reject_breached`) and the
  // `OS_AUTH_PASSWORD_REJECT_BREACHED` env override both gate it, with env
  // winning over config — mirroring the twoFactor / scim gating pattern.
  describe('haveibeenpwned plugin (ADR-0069 breached-password rejection)', () => {
    const captureConfig = () => {
      let capturedConfig: any;
      (betterAuth as any).mockImplementation((config: any) => {
        capturedConfig = config;
        return { handler: vi.fn(), api: {} };
      });
      return () => capturedConfig;
    };

    it('does NOT register the plugin by default (off by default)', async () => {
      const get = captureConfig();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      expect(get().plugins.map((p: any) => p.id)).not.toContain('have-i-been-pwned');
    });

    it('registers the plugin when plugins.passwordRejectBreached is true', async () => {
      const get = captureConfig();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        plugins: { passwordRejectBreached: true } as any,
      });
      await manager.getAuthInstance();
      warnSpy.mockRestore();

      const hibp = get().plugins.find((p: any) => p.id === 'have-i-been-pwned');
      expect(hibp).toBeDefined();
      // A custom user-facing message is passed (the default error is generic).
      expect(typeof hibp._opts.customPasswordCompromisedMessage).toBe('string');
    });

    it('lets OS_AUTH_PASSWORD_REJECT_BREACHED env override the config (env wins)', async () => {
      const get = captureConfig();
      const prev = process.env.OS_AUTH_PASSWORD_REJECT_BREACHED;
      process.env.OS_AUTH_PASSWORD_REJECT_BREACHED = 'true';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const manager = new AuthManager({
          secret: 'test-secret-at-least-32-chars-long',
          baseUrl: 'http://localhost:3000',
          plugins: { passwordRejectBreached: false } as any,
        });
        await manager.getAuthInstance();
        expect(get().plugins.map((p: any) => p.id)).toContain('have-i-been-pwned');
      } finally {
        if (prev === undefined) delete process.env.OS_AUTH_PASSWORD_REJECT_BREACHED;
        else process.env.OS_AUTH_PASSWORD_REJECT_BREACHED = prev;
        warnSpy.mockRestore();
      }
    });
  });

  // ADR-0069 D2: per-identity account lockout + native rate-limit passthrough.
  // The lockout state machine is exercised directly via the AuthManager helpers
  // with a mocked data engine (deterministic; the live multi-failure path is
  // covered by the dogfood smoke).
  describe('account lockout + rate limiting (ADR-0069 D2)', () => {
    const SECRET = 'test-secret-at-least-32-chars-long';
    // findOne honours the `where` clause (the ObjectQL engine key) — so a
    // regression to the wrong key (`filter`, silently ignored → returns the
    // first/arbitrary row) makes these tests fail, not pass. Caught a real bug
    // in dogfood that a query-agnostic mock had masked.
    const makeEngine = (user: any) => ({
      findOne: vi.fn(async (_obj: string, q: any) => {
        const w = q?.where ?? {};
        if (!user) return null;
        const matches = Object.entries(w).every(([k, v]) => (user as any)[k] === v);
        return matches ? user : null;
      }),
      update: vi.fn(async () => ({ ...(user ?? {}) })),
      count: vi.fn(),
    });
    const mgr = (engine: any, extra: any = {}) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', dataEngine: engine, ...extra });
      warn.mockRestore();
      return m;
    };

    it('assertAccountNotLocked is a no-op when lockout is disabled (threshold 0)', async () => {
      const engine = makeEngine({ id: 'u1', email: 'a@b.com', locked_until: new Date(Date.now() + 60_000).toISOString() });
      const m = mgr(engine, { lockoutThreshold: 0 });
      await expect((m as any).assertAccountNotLocked('a@b.com')).resolves.toBeUndefined();
      expect(engine.findOne).not.toHaveBeenCalled();
    });

    it('assertAccountNotLocked throws ACCOUNT_LOCKED while locked_until is in the future', async () => {
      const engine = makeEngine({ id: 'u1', email: 'a@b.com', locked_until: new Date(Date.now() + 60_000).toISOString() });
      const m = mgr(engine, { lockoutThreshold: 3 });
      await expect((m as any).assertAccountNotLocked('a@b.com')).rejects.toMatchObject({
        body: { code: 'ACCOUNT_LOCKED' },
      });
    });

    it('assertAccountNotLocked allows sign-in once the lock has expired', async () => {
      const engine = makeEngine({ id: 'u1', email: 'a@b.com', locked_until: new Date(Date.now() - 60_000).toISOString() });
      const m = mgr(engine, { lockoutThreshold: 3 });
      await expect((m as any).assertAccountNotLocked('a@b.com')).resolves.toBeUndefined();
    });

    it('recordSignInOutcome increments below threshold without locking', async () => {
      const engine = makeEngine({ id: 'u1', email: 'a@b.com', failed_login_count: 0, locked_until: null });
      const m = mgr(engine, { lockoutThreshold: 3 });
      await (m as any).recordSignInOutcome('a@b.com', false);
      const patch = engine.update.mock.calls[0][1];
      expect(patch.failed_login_count).toBe(1);
      expect(patch.locked_until).toBeUndefined();
    });

    it('recordSignInOutcome stamps locked_until (a Date) once the threshold is reached', async () => {
      const engine = makeEngine({ id: 'u1', email: 'a@b.com', failed_login_count: 2, locked_until: null });
      const m = mgr(engine, { lockoutThreshold: 3, lockoutDurationMinutes: 15 });
      await (m as any).recordSignInOutcome('a@b.com', false);
      const patch = engine.update.mock.calls[0][1];
      expect(patch.failed_login_count).toBe(3);
      expect(patch.locked_until instanceof Date).toBe(true);
      // ~15 minutes out (datetime stored as a Date, never epoch-ms — see ADR-0074).
      expect((patch.locked_until as Date).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    });

    it('recordSignInOutcome resets counter + lock on success when there is state to clear', async () => {
      const engine = makeEngine({ id: 'u1', email: 'a@b.com', failed_login_count: 2, locked_until: null });
      const m = mgr(engine, { lockoutThreshold: 3 });
      await (m as any).recordSignInOutcome('a@b.com', true);
      expect(engine.update).toHaveBeenCalledWith(
        'sys_user',
        { id: 'u1', failed_login_count: 0, locked_until: null },
        expect.anything(),
      );
    });

    it('recordSignInOutcome skips the write on success when nothing needs clearing', async () => {
      const engine = makeEngine({ id: 'u1', email: 'a@b.com', failed_login_count: 0, locked_until: null });
      const m = mgr(engine, { lockoutThreshold: 3 });
      await (m as any).recordSignInOutcome('a@b.com', true);
      expect(engine.update).not.toHaveBeenCalled();
    });

    it('recordSignInOutcome is a no-op when lockout is disabled', async () => {
      const engine = makeEngine({ id: 'u1', email: 'a@b.com', failed_login_count: 5 });
      const m = mgr(engine, { lockoutThreshold: 0 });
      await (m as any).recordSignInOutcome('a@b.com', false);
      expect(engine.update).not.toHaveBeenCalled();
    });

    it('unlockUser clears failed_login_count and locked_until', async () => {
      const engine = makeEngine({ id: 'u1' });
      const m = mgr(engine);
      await expect(m.unlockUser('u1')).resolves.toBe(true);
      expect(engine.update).toHaveBeenCalledWith(
        'sys_user',
        { id: 'u1', failed_login_count: 0, locked_until: null },
        expect.anything(),
      );
    });

    it('unlockUser returns false for an unknown user', async () => {
      const engine = makeEngine(null);
      const m = mgr(engine);
      await expect(m.unlockUser('nope')).resolves.toBe(false);
      expect(engine.update).not.toHaveBeenCalled();
    });

    // ── ADR-0069 D7 — last-login audit stamping ──────────────────────────
    it('stampLastLogin writes last_login_at (a Date) + last_login_ip on success', async () => {
      const engine = makeEngine({ id: 'u1' });
      const m = mgr(engine);
      await (m as any).stampLastLogin('u1', '203.0.113.7');
      const patch = engine.update.mock.calls[0][1];
      expect(patch.id).toBe('u1');
      expect(patch.last_login_at instanceof Date).toBe(true); // Date, never epoch-ms (ADR-0074)
      expect(patch.last_login_ip).toBe('203.0.113.7');
    });

    it('stampLastLogin runs even when lockout is disabled (independent of threshold)', async () => {
      const engine = makeEngine({ id: 'u1' });
      const m = mgr(engine, { lockoutThreshold: 0 });
      await (m as any).stampLastLogin('u1', undefined);
      expect(engine.update).toHaveBeenCalledTimes(1);
      const patch = engine.update.mock.calls[0][1];
      expect(patch.last_login_at instanceof Date).toBe(true);
      // IP omitted (undetermined) rather than written as null/empty
      expect('last_login_ip' in patch).toBe(false);
    });

    it('stampLastLogin caps an oversized IP header to the column width (45)', async () => {
      const engine = makeEngine({ id: 'u1' });
      const m = mgr(engine);
      await (m as any).stampLastLogin('u1', 'x'.repeat(200));
      expect(engine.update.mock.calls[0][1].last_login_ip).toHaveLength(45);
    });

    it('stampLastLogin never throws when the engine write fails', async () => {
      const engine = { ...makeEngine({ id: 'u1' }), update: vi.fn(async () => { throw new Error('db down'); }) };
      const m = mgr(engine);
      await expect((m as any).stampLastLogin('u1', '203.0.113.7')).resolves.toBeUndefined();
    });

    it('passes a configured rateLimit through to betterAuth', async () => {
      let captured: any;
      (betterAuth as any).mockImplementation((cfg: any) => { captured = cfg; return { handler: vi.fn(), api: {} }; });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = new AuthManager({
        secret: SECRET,
        baseUrl: 'http://localhost:3000',
        rateLimit: { enabled: true, window: 60, max: 10, customRules: { '/sign-in/email': { window: 60, max: 10 } } } as any,
      });
      await m.getAuthInstance();
      warn.mockRestore();
      expect(captured.rateLimit).toMatchObject({ enabled: true, max: 10, window: 60 });
      expect(captured.rateLimit.customRules['/sign-in/email']).toEqual({ window: 60, max: 10 });
    });

    it('omits rateLimit from the betterAuth config when unset (keeps library defaults)', async () => {
      let captured: any;
      (betterAuth as any).mockImplementation((cfg: any) => { captured = cfg; return { handler: vi.fn(), api: {} }; });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000' });
      await m.getAuthInstance();
      warn.mockRestore();
      expect(captured).not.toHaveProperty('rateLimit');
    });

    // ── ADR-0069 D2 — shared secondaryStorage → cross-node rate limiting ──
    it('wires secondaryStorage and flips rateLimit.storage to "secondary-storage"', async () => {
      let captured: any;
      (betterAuth as any).mockImplementation((cfg: any) => { captured = cfg; return { handler: vi.fn(), api: {} }; });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const ss = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
      const m = new AuthManager({
        secret: SECRET, baseUrl: 'http://localhost:3000',
        rateLimit: { enabled: true, window: 60, max: 10 } as any,
        secondaryStorage: ss as any,
      });
      await m.getAuthInstance();
      warn.mockRestore();
      expect(captured.secondaryStorage).toBe(ss);
      expect(captured.rateLimit.storage).toBe('secondary-storage');
      expect(captured.rateLimit).toMatchObject({ enabled: true, max: 10, window: 60 });
    });

    it('flips rateLimit.storage even when no explicit rateLimit config is given (secondaryStorage alone)', async () => {
      let captured: any;
      (betterAuth as any).mockImplementation((cfg: any) => { captured = cfg; return { handler: vi.fn(), api: {} }; });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const ss = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
      const m = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', secondaryStorage: ss as any });
      await m.getAuthInstance();
      warn.mockRestore();
      expect(captured.secondaryStorage).toBe(ss);
      expect(captured.rateLimit.storage).toBe('secondary-storage');
    });
  });

  // ADR-0069 D1: password complexity validator (custom; better-auth only does
  // length). Exercised directly via the AuthManager helper.
  describe('password complexity (ADR-0069 D1)', () => {
    const SECRET = 'test-secret-at-least-32-chars-long';
    const mgr = (extra: any = {}) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', ...extra });
      warn.mockRestore();
      return m;
    };

    it('is a no-op when complexity is not required (any password passes)', async () => {
      const m = mgr({ passwordRequireComplexity: false });
      await expect((m as any).assertPasswordComplexity('password')).resolves.toBeUndefined();
    });

    it('rejects a password with too few character classes', async () => {
      const m = mgr({ passwordRequireComplexity: true, passwordMinClasses: 3 });
      // only lowercase → 1 class < 3
      await expect((m as any).assertPasswordComplexity('alllowercase')).rejects.toMatchObject({
        body: { code: 'PASSWORD_POLICY_VIOLATION' },
      });
    });

    it('accepts a password meeting the required class count', async () => {
      const m = mgr({ passwordRequireComplexity: true, passwordMinClasses: 3 });
      // upper + lower + digit = 3 classes
      await expect((m as any).assertPasswordComplexity('Abcdef12')).resolves.toBeUndefined();
    });

    it('counts symbols as a class and honours a min of 4', async () => {
      const m = mgr({ passwordRequireComplexity: true, passwordMinClasses: 4 });
      await expect((m as any).assertPasswordComplexity('Abcd1234')).rejects.toMatchObject({
        body: { code: 'PASSWORD_POLICY_VIOLATION' },
      }); // 3 classes < 4
      await expect((m as any).assertPasswordComplexity('Abcd123!')).resolves.toBeUndefined(); // 4 classes
    });

    it('clamps an out-of-range min_classes into [1,4] (defaults to 3 when unset)', async () => {
      const m = mgr({ passwordRequireComplexity: true, passwordMinClasses: 99 });
      // clamped to 4 → needs all four classes
      await expect((m as any).assertPasswordComplexity('Abcd1234')).rejects.toMatchObject({
        body: { code: 'PASSWORD_POLICY_VIOLATION' },
      });
    });
  });

  // ADR-0069 D1: password history (reject reuse). Custom logic, but reuses
  // better-auth's native hash/verify — tested here with a stub verify + a
  // where-aware sys_account mock.
  describe('password history / reuse prevention (ADR-0069 D1)', () => {
    const SECRET = 'test-secret-at-least-32-chars-long';
    // verify() returns true when the candidate equals the plaintext that a hash
    // encodes — we model hashes as `hash:<plaintext>` for the stub.
    const stubVerify = async ({ password, hash }: { password: string; hash: string }) =>
      hash === `hash:${password}`;
    const makeEngine = (account: any) => ({
      findOne: vi.fn(async (_o: string, q: any) => {
        const w = q?.where ?? {};
        if (!account) return null;
        const ok = Object.entries(w).every(([k, v]) => (account as any)[k] === v);
        return ok ? account : null;
      }),
      update: vi.fn(async () => ({})),
    });
    const mgr = (engine: any, extra: any = {}) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', dataEngine: engine, ...extra });
      warn.mockRestore();
      return m;
    };
    const acct = (over: any = {}) => ({
      id: 'a1', user_id: 'u1', provider_id: 'credential',
      password: 'hash:current', previous_password_hashes: JSON.stringify(['hash:old1', 'hash:old2']),
      ...over,
    });

    it('parseHashes tolerates null/garbage', () => {
      const m = mgr(makeEngine(null));
      expect((m as any).parseHashes(undefined)).toEqual([]);
      expect((m as any).parseHashes('not json')).toEqual([]);
      expect((m as any).parseHashes('["a","b"]')).toEqual(['a', 'b']);
    });

    it('is a no-op when history depth is 0', async () => {
      const engine = makeEngine(acct());
      const m = mgr(engine, { passwordHistoryCount: 0 });
      await expect((m as any).assertPasswordNotReused('u1', 'current', stubVerify)).resolves.toBeUndefined();
      expect(engine.findOne).not.toHaveBeenCalled();
    });

    it('rejects reuse of the CURRENT password', async () => {
      const m = mgr(makeEngine(acct()), { passwordHistoryCount: 5 });
      await expect((m as any).assertPasswordNotReused('u1', 'current', stubVerify)).rejects.toMatchObject({
        body: { code: 'PASSWORD_REUSE' },
      });
    });

    it('rejects reuse of a HISTORICAL password', async () => {
      const m = mgr(makeEngine(acct()), { passwordHistoryCount: 5 });
      await expect((m as any).assertPasswordNotReused('u1', 'old2', stubVerify)).rejects.toMatchObject({
        body: { code: 'PASSWORD_REUSE' },
      });
    });

    it('accepts a fresh password and returns the current hash for the after-hook', async () => {
      const m = mgr(makeEngine(acct()), { passwordHistoryCount: 5 });
      await expect((m as any).assertPasswordNotReused('u1', 'brandnew', stubVerify)).resolves.toBe('hash:current');
    });

    it('recordPasswordHistory prepends the old hash, dedupes, and trims to the depth', async () => {
      const engine = makeEngine(acct({ previous_password_hashes: JSON.stringify(['hash:old1', 'hash:old2']) }));
      const m = mgr(engine, { passwordHistoryCount: 2 });
      await (m as any).recordPasswordHistory('u1', 'hash:current');
      const written = JSON.parse(engine.update.mock.calls[0][1].previous_password_hashes);
      expect(written).toEqual(['hash:current', 'hash:old1']); // prepend + trim to 2
    });
  });

  // ADR-0069 D1: password expiry posture + stamping (the session-gate infra).
  describe('password expiry gate (ADR-0069 D1)', () => {
    const SECRET = 'test-secret-at-least-32-chars-long';
    const makeEngine = (user: any) => ({
      findOne: vi.fn(async (_o: string, q: any) => {
        const w = q?.where ?? {};
        if (!user) return null;
        return Object.entries(w).every(([k, v]) => (user as any)[k] === v) ? user : null;
      }),
      update: vi.fn(async () => ({})),
    });
    const mgr = (engine: any, extra: any = {}) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', dataEngine: engine, ...extra });
      warn.mockRestore();
      return m;
    };

    it('isAuthGateActive reflects passwordExpiryDays', () => {
      expect(mgr(makeEngine(null), { passwordExpiryDays: 0 }).isAuthGateActive()).toBe(false);
      expect(mgr(makeEngine(null), { passwordExpiryDays: 90 }).isAuthGateActive()).toBe(true);
    });

    it('computeAuthGate is a no-op (no DB read) when expiry is off', async () => {
      const engine = makeEngine({ id: 'u1', password_changed_at: new Date(0).toISOString() });
      const m = mgr(engine, { passwordExpiryDays: 0 });
      await expect((m as any).computeAuthGate('u1', undefined, false)).resolves.toBeUndefined();
      expect(engine.findOne).not.toHaveBeenCalled();
    });

    it('returns PASSWORD_EXPIRED when password_changed_at is older than the window', async () => {
      const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
      const m = mgr(makeEngine({ id: 'u1', password_changed_at: old }), { passwordExpiryDays: 90 });
      const gate = await (m as any).computeAuthGate('u1', undefined, false);
      expect(gate?.code).toBe('PASSWORD_EXPIRED');
    });

    it('does NOT expire when the password is within the window', async () => {
      const recent = new Date(Date.now() - 10 * 86_400_000).toISOString();
      const m = mgr(makeEngine({ id: 'u1', password_changed_at: recent }), { passwordExpiryDays: 90 });
      await expect((m as any).computeAuthGate('u1', undefined, false)).resolves.toBeUndefined();
    });

    it('treats a null password_changed_at as never-expired (upgrade-safe)', async () => {
      const m = mgr(makeEngine({ id: 'u1', password_changed_at: null }), { passwordExpiryDays: 1 });
      await expect((m as any).computeAuthGate('u1', undefined, false)).resolves.toBeUndefined();
    });

    it('stampPasswordChangedAt writes a Date (never epoch-ms) to sys_user', async () => {
      const engine = makeEngine({ id: 'u1' });
      const m = mgr(engine);
      await (m as any).stampPasswordChangedAt('u1');
      const arg = engine.update.mock.calls[0][1];
      expect(arg.id).toBe('u1');
      expect(arg.password_changed_at instanceof Date).toBe(true);
    });

    it('stampPasswordChangedAt clears must_change_password in the same write (#2766 V1)', async () => {
      const engine = makeEngine({ id: 'u1' });
      const m = mgr(engine);
      await (m as any).stampPasswordChangedAt('u1');
      const arg = engine.update.mock.calls[0][1];
      expect(arg.must_change_password).toBe(false);
    });
  });

  // #2766 V1: admin-issued force password change — reuses the auth-gate seam.
  describe('must-change-password gate (#2766 V1)', () => {
    const SECRET = 'test-secret-at-least-32-chars-long';
    const makeEngine = (user: any) => ({
      findOne: vi.fn(async (_o: string, q: any) => {
        const w = q?.where ?? {};
        if (!user) return null;
        return Object.entries(w).every(([k, v]) => (user as any)[k] === v) ? user : null;
      }),
      update: vi.fn(async () => ({})),
      count: vi.fn(async () => 0),
    });
    const mgr = (engine: any, extra: any = {}) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', dataEngine: engine, ...extra });
      warn.mockRestore();
      return m;
    };

    it('noteMustChangePasswordIssued activates the gate immediately (all config off)', () => {
      const m = mgr(makeEngine(null), {});
      expect(m.isAuthGateActive()).toBe(false);
      m.noteMustChangePasswordIssued();
      expect(m.isAuthGateActive()).toBe(true);
    });

    it('returns PASSWORD_EXPIRED for a flagged user with every config feature off', async () => {
      const m = mgr(makeEngine({ id: 'u1', must_change_password: true }), {});
      m.noteMustChangePasswordIssued(); // as the admin route does
      const gate = await (m as any).computeAuthGate('u1', undefined, false);
      expect(gate?.code).toBe('PASSWORD_EXPIRED');
    });

    it('does NOT gate an unflagged user even when the cache is hot', async () => {
      const m = mgr(makeEngine({ id: 'u1', must_change_password: false }), {});
      m.noteMustChangePasswordIssued();
      await expect((m as any).computeAuthGate('u1', undefined, false)).resolves.toBeUndefined();
    });

    it('stays a no-op (no DB read) when nothing is flagged and config is off', async () => {
      const engine = makeEngine({ id: 'u1', must_change_password: true });
      const m = mgr(engine, {});
      await expect((m as any).computeAuthGate('u1', undefined, false)).resolves.toBeUndefined();
      expect(engine.findOne).not.toHaveBeenCalled();
    });

    it('fails open when the user lookup throws', async () => {
      const engine = { findOne: vi.fn(async () => { throw new Error('db down'); }), update: vi.fn(), count: vi.fn(async () => 1) };
      const m = mgr(engine, {});
      m.noteMustChangePasswordIssued();
      await expect((m as any).computeAuthGate('u1', undefined, false)).resolves.toBeUndefined();
    });
  });

  // ADR-0069 D3: enforced MFA — reuses the auth-gate seam (same computeAuthGate).
  describe('enforced MFA gate (ADR-0069 D3)', () => {
    const SECRET = 'test-secret-at-least-32-chars-long';
    const makeEngine = (user: any) => ({
      findOne: vi.fn(async (_o: string, q: any) => {
        const w = q?.where ?? {};
        if (!user) return null;
        return Object.entries(w).every(([k, v]) => (user as any)[k] === v) ? user : null;
      }),
      update: vi.fn(async () => ({})),
    });
    const mgr = (engine: any, extra: any = {}) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', dataEngine: engine, ...extra });
      warn.mockRestore();
      return m;
    };

    it('isAuthGateActive is true when mfaRequired (even with expiry off)', () => {
      expect(mgr(makeEngine(null), { mfaRequired: true }).isAuthGateActive()).toBe(true);
      expect(mgr(makeEngine(null), {}).isAuthGateActive()).toBe(false);
    });

    it('blocks MFA_REQUIRED for an un-enrolled user past the grace window', async () => {
      const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const m = mgr(makeEngine({ id: 'u1', two_factor_enabled: false, mfa_required_at: old }), {
        mfaRequired: true, mfaGracePeriodDays: 7,
      });
      const g = await (m as any).computeAuthGate('u1', undefined, false);
      expect(g?.code).toBe('MFA_REQUIRED');
    });

    it('does NOT block within the grace window', async () => {
      const recent = new Date(Date.now() - 1 * 86_400_000).toISOString();
      const m = mgr(makeEngine({ id: 'u1', two_factor_enabled: false, mfa_required_at: recent }), {
        mfaRequired: true, mfaGracePeriodDays: 7,
      });
      await expect((m as any).computeAuthGate('u1', undefined, false)).resolves.toBeUndefined();
    });

    it('stamps mfa_required_at the first time (null) and does not block yet', async () => {
      const engine = makeEngine({ id: 'u1', two_factor_enabled: false, mfa_required_at: null });
      const m = mgr(engine, { mfaRequired: true, mfaGracePeriodDays: 7 });
      await expect((m as any).computeAuthGate('u1', undefined, false)).resolves.toBeUndefined();
      const wrote = engine.update.mock.calls.find((c: any[]) => 'mfa_required_at' in (c[1] ?? {}));
      expect(wrote).toBeTruthy();
      expect(wrote[1].mfa_required_at instanceof Date).toBe(true);
    });

    it('does NOT block an enrolled user (two_factor_enabled)', async () => {
      const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const m = mgr(makeEngine({ id: 'u1', two_factor_enabled: true, mfa_required_at: old }), {
        mfaRequired: true, mfaGracePeriodDays: 7,
      });
      await expect((m as any).computeAuthGate('u1', undefined, false)).resolves.toBeUndefined();
    });

    it('grace 0 blocks an un-enrolled user immediately (after the clock is set)', async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      const m = mgr(makeEngine({ id: 'u1', two_factor_enabled: false, mfa_required_at: past }), {
        mfaRequired: true, mfaGracePeriodDays: 0,
      });
      const g = await (m as any).computeAuthGate('u1', undefined, false);
      expect(g?.code).toBe('MFA_REQUIRED');
    });
  });

  // ADR-0069 D3 — per-org MFA tightening (an org may require MFA above the
  // global floor). Uses an object-aware engine mock (sys_user + sys_organization).
  describe('per-org enforced MFA (ADR-0069 D3)', () => {
    const SECRET = 'test-secret-at-least-32-chars-long';
    const makeEngine = (user: any, org: any) => ({
      findOne: vi.fn(async (obj: string, q: any) => {
        const row = obj === 'sys_organization' ? org : user;
        if (!row) return null;
        const w = q?.where ?? {};
        return Object.entries(w).every(([k, v]) => (row as any)[k] === v) ? row : null;
      }),
      update: vi.fn(async () => ({})),
      count: vi.fn(async () => 1),
    });
    const mgr = (engine: any, extra: any = {}) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', dataEngine: engine, ...extra });
      warn.mockRestore();
      return m;
    };

    it('isAuthGateActive trips on the cached org-MFA flag even with global MFA off', () => {
      const m = mgr(makeEngine(null, null), {});
      // Prime the cache as if an org requires MFA.
      (m as any)._orgMfaCache = { value: true, at: Date.now() };
      expect(m.isAuthGateActive()).toBe(true);
    });

    it('blocks MFA_REQUIRED when the ACTIVE ORG requires MFA (global off) and grace elapsed', async () => {
      const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const engine = makeEngine(
        { id: 'u1', two_factor_enabled: false, mfa_required_at: old },
        { id: 'org1', require_mfa: true },
      );
      const m = mgr(engine, { mfaRequired: false, mfaGracePeriodDays: 7 });
      (m as any)._orgMfaCache = { value: true, at: Date.now() }; // org-requires cache primed
      const g = await (m as any).computeAuthGate('u1', 'org1', false);
      expect(g?.code).toBe('MFA_REQUIRED');
    });

    it('does NOT block when the active org does not require MFA (global off)', async () => {
      const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const engine = makeEngine(
        { id: 'u1', two_factor_enabled: false, mfa_required_at: old },
        { id: 'org1', require_mfa: false },
      );
      const m = mgr(engine, { mfaRequired: false });
      (m as any)._orgMfaCache = { value: true, at: Date.now() };
      await expect((m as any).computeAuthGate('u1', 'org1', false)).resolves.toBeUndefined();
    });

    it('is a no-op when no org requires MFA and there is no active org', async () => {
      const engine = makeEngine({ id: 'u1', two_factor_enabled: false }, null);
      const m = mgr(engine, { mfaRequired: false });
      // cache says no org requires MFA
      (m as any)._orgMfaCache = { value: false, at: Date.now() };
      await expect((m as any).computeAuthGate('u1', undefined, false)).resolves.toBeUndefined();
      expect(engine.findOne).not.toHaveBeenCalled();
    });
  });

  // ADR-0069 D4 — session controls (idle / absolute / concurrent).
  describe('session controls (ADR-0069 D4)', () => {
    const SECRET = 'test-secret-at-least-32-chars-long';
    const mgr = (engine: any, extra: any = {}) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', dataEngine: engine, ...extra });
      warn.mockRestore();
      return m;
    };
    const oneEngine = (row: any) => ({
      findOne: vi.fn(async () => row),
      update: vi.fn(async () => ({})),
      find: vi.fn(async () => []),
    });

    it('is a no-op when idle + absolute are both off', async () => {
      const engine = oneEngine({ id: 's1', created_at: new Date(0).toISOString() });
      const m = mgr(engine, {});
      await (m as any).enforceSessionControls('s1', undefined);
      expect(engine.findOne).not.toHaveBeenCalled();
    });

    it('revokes (absolute_max) when the session is older than the absolute cap', async () => {
      const old = new Date(Date.now() - 100 * 3_600_000).toISOString();
      const engine = oneEngine({ id: 's1', created_at: old, last_activity_at: null, revoked_at: null });
      const m = mgr(engine, { sessionAbsoluteMaxHours: 24 });
      await (m as any).enforceSessionControls('s1', undefined);
      const patch = engine.update.mock.calls[0][1];
      expect(patch.revoke_reason).toBe('absolute_max');
      expect(patch.revoked_at instanceof Date).toBe(true);
      expect(patch.expires_at instanceof Date).toBe(true);
    });

    it('revokes (idle_timeout) when last activity is older than the idle window', async () => {
      const recentCreate = new Date(Date.now() - 60 * 60_000).toISOString();
      const staleActivity = new Date(Date.now() - 30 * 60_000).toISOString();
      const engine = oneEngine({ id: 's1', created_at: recentCreate, last_activity_at: staleActivity, revoked_at: null });
      const m = mgr(engine, { sessionIdleTimeoutMinutes: 15 });
      await (m as any).enforceSessionControls('s1', undefined);
      expect(engine.update.mock.calls[0][1].revoke_reason).toBe('idle_timeout');
    });

    it('touches last_activity_at (not revoke) when within the idle window but stale > 60s', async () => {
      const recentCreate = new Date(Date.now() - 5 * 60_000).toISOString();
      const activity2minAgo = new Date(Date.now() - 2 * 60_000).toISOString();
      const engine = oneEngine({ id: 's1', created_at: recentCreate, last_activity_at: activity2minAgo, revoked_at: null });
      const m = mgr(engine, { sessionIdleTimeoutMinutes: 15 });
      await (m as any).enforceSessionControls('s1', undefined);
      const patch = engine.update.mock.calls[0][1];
      expect(patch.last_activity_at instanceof Date).toBe(true);
      expect(patch.revoke_reason).toBeUndefined();
    });

    it('does not touch when already revoked', async () => {
      const engine = oneEngine({ id: 's1', created_at: new Date().toISOString(), revoked_at: new Date().toISOString() });
      const m = mgr(engine, { sessionIdleTimeoutMinutes: 15 });
      await (m as any).enforceSessionControls('s1', undefined);
      expect(engine.update).not.toHaveBeenCalled();
    });

    it('enforceConcurrentCap revokes the oldest sessions past the cap', async () => {
      const now = Date.now();
      const sess = [
        { id: 'a', created_at: new Date(now - 4000).toISOString(), revoked_at: null },
        { id: 'b', created_at: new Date(now - 3000).toISOString(), revoked_at: null },
        { id: 'c', created_at: new Date(now - 2000).toISOString(), revoked_at: null },
        { id: 'd', created_at: new Date(now - 1000).toISOString(), revoked_at: null },
      ];
      const engine = { findOne: vi.fn(), update: vi.fn(async () => ({})), find: vi.fn(async () => sess) };
      const m = mgr(engine, { maxConcurrentSessions: 2 });
      await (m as any).enforceConcurrentCap('u1');
      // keeps newest 2 (d, c) → revokes oldest 2 (b, a)
      const revokedIds = engine.update.mock.calls.map((c: any[]) => c[1].id).sort();
      expect(revokedIds).toEqual(['a', 'b']);
      expect(engine.update.mock.calls[0][1].revoke_reason).toBe('concurrent_cap');
    });

    it('enforceConcurrentCap is a no-op when the cap is 0', async () => {
      const engine = { findOne: vi.fn(), update: vi.fn(), find: vi.fn(async () => []) };
      const m = mgr(engine, { maxConcurrentSessions: 0 });
      await (m as any).enforceConcurrentCap('u1');
      expect(engine.find).not.toHaveBeenCalled();
    });
  });

  // ADR-0069 D5 — IP allow-list (network gating).
  describe('IP allow-list (ADR-0069 D5)', () => {
    const SECRET = 'test-secret-at-least-32-chars-long';
    const mgr = (extra: any = {}) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', ...extra });
      warn.mockRestore();
      return m;
    };

    it('ipMatchesRange handles IPv4 CIDR + exact', () => {
      expect(ipMatchesRange('203.0.113.5', '203.0.113.0/24')).toBe(true);
      expect(ipMatchesRange('203.0.114.5', '203.0.113.0/24')).toBe(false);
      expect(ipMatchesRange('10.0.0.1', '10.0.0.1')).toBe(true);
      expect(ipMatchesRange('10.0.0.2', '10.0.0.1')).toBe(false);
      expect(ipMatchesRange('192.168.1.42', '192.168.1.42/32')).toBe(true);
      expect(ipMatchesRange('1.2.3.4', '0.0.0.0/0')).toBe(true);
    });

    it('allows any IP when no ranges are configured', () => {
      const m = mgr({});
      expect(m.isClientIpAllowed('8.8.8.8')).toBe(true);
      expect(m.isClientIpAllowed(undefined)).toBe(true);
    });

    it('allows an IP inside a configured range, blocks one outside', () => {
      const m = mgr({ allowedIpRanges: ['203.0.113.0/24', '10.0.0.5'] });
      expect(m.isClientIpAllowed('203.0.113.99')).toBe(true);
      expect(m.isClientIpAllowed('10.0.0.5')).toBe(true);
      expect(m.isClientIpAllowed('8.8.8.8')).toBe(false);
    });

    it('fails OPEN when the client IP cannot be determined (no proxy header)', () => {
      const m = mgr({ allowedIpRanges: ['203.0.113.0/24'] });
      expect(m.isClientIpAllowed(undefined)).toBe(true);
      expect(m.isClientIpAllowed('')).toBe(true);
    });
  });

  // ADR-0081 D1 — default active-org stamp on session create.
  describe('composeDatabaseHooks – session.create.before active-org default', () => {
    const OWNER_ROW = { id: 'm1', organization_id: 'org_owner', user_id: 'u1', role: 'owner' };
    const MEMBER_ROW = { id: 'm2', organization_id: 'org_member', user_id: 'u1', role: 'member' };

    function makeEngine(rows: any[]) {
      return {
        findOne: vi.fn(async (_model: string, q: any) => {
          const where = q?.where ?? {};
          return (
            rows.find(
              (r) =>
                (!where.user_id || r.user_id === where.user_id) &&
                (!where.role || r.role === where.role),
            ) ?? null
          );
        }),
      } as any;
    }

    function hooksFor(config: any) {
      const manager = new AuthManager({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        ...config,
      });
      return (manager as any).composeDatabaseHooks(config.databaseHooks) as any;
    }

    it('stamps activeOrganizationId from the owner membership (owner preferred)', async () => {
      const hooks = hooksFor({ dataEngine: makeEngine([MEMBER_ROW, OWNER_ROW]) });
      const result = await hooks.session.create.before({ userId: 'u1' });
      expect(result?.data?.activeOrganizationId).toBe('org_owner');
    });

    it('falls back to any membership when the user owns nothing', async () => {
      const hooks = hooksFor({ dataEngine: makeEngine([MEMBER_ROW]) });
      const result = await hooks.session.create.before({ userId: 'u1' });
      expect(result?.data?.activeOrganizationId).toBe('org_member');
    });

    it('leaves a pre-set activeOrganizationId alone', async () => {
      const engine = makeEngine([OWNER_ROW]);
      const hooks = hooksFor({ dataEngine: engine });
      const result = await hooks.session.create.before({
        userId: 'u1',
        activeOrganizationId: 'org_explicit',
      });
      // Draft already carries an org — no stamp, no lookup needed.
      expect(result?.data?.activeOrganizationId ?? 'org_explicit').toBe('org_explicit');
      expect(engine.findOne).not.toHaveBeenCalled();
    });

    it('no-ops (org-less session) when the user has no memberships', async () => {
      const hooks = hooksFor({ dataEngine: makeEngine([]) });
      const result = await hooks.session.create.before({ userId: 'u1' });
      expect(result?.data?.activeOrganizationId).toBeUndefined();
    });

    it('chains the HOST session hook first and keeps its choice', async () => {
      const hostHook = vi.fn(async (session: any) => ({
        data: { ...session, activeOrganizationId: 'org_host' },
      }));
      const hooks = hooksFor({
        dataEngine: makeEngine([OWNER_ROW]),
        databaseHooks: { session: { create: { before: hostHook } } },
      });
      const result = await hooks.session.create.before({ userId: 'u1' });
      expect(hostHook).toHaveBeenCalledTimes(1);
      expect(result?.data?.activeOrganizationId).toBe('org_host');
    });

    it('fills the field when the host hook declines (returns undefined)', async () => {
      const hostHook = vi.fn(async () => undefined);
      const hooks = hooksFor({
        dataEngine: makeEngine([OWNER_ROW]),
        databaseHooks: { session: { create: { before: hostHook } } },
      });
      const result = await hooks.session.create.before({ userId: 'u1' });
      expect(result?.data?.activeOrganizationId).toBe('org_owner');
    });

    it('autoActiveOrganization: false restores the raw host behaviour', async () => {
      const hooks = hooksFor({
        dataEngine: makeEngine([OWNER_ROW]),
        autoActiveOrganization: false,
      });
      expect(hooks.session?.create?.before).toBeUndefined();
    });

    it('never breaks session create on engine errors', async () => {
      const engine = { findOne: vi.fn(async () => { throw new Error('db down'); }) } as any;
      const hooks = hooksFor({ dataEngine: engine });
      const result = await hooks.session.create.before({ userId: 'u1' });
      expect(result?.data?.activeOrganizationId).toBeUndefined();
    });

    it('keeps the account.create.after identity stamp intact', async () => {
      const hooks = hooksFor({ dataEngine: makeEngine([]) });
      expect(typeof hooks.account?.create?.after).toBe('function');
    });
  });
});
