// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthManager } from './auth-manager';

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

import { betterAuth } from 'better-auth';

describe('AuthManager', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
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

  describe('customSession – derived role and roles array', () => {
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

    it('returns roles=[] for a regular user with no stored role', async () => {
      const callback = await getSessionCallback(makeDataEngine({ platformAdmin: false }));
      const result = await callback({
        user: { id: 'u-1', email: 'a@b.com' },
        session: {},
      });
      expect(result.user.role).toBeUndefined();
      expect(result.user.roles).toEqual([]);
    });

    it('splits a stored role string into roles for a non-admin user', async () => {
      const callback = await getSessionCallback(makeDataEngine({ platformAdmin: false }));
      const result = await callback({
        user: { id: 'u-1', email: 'a@b.com', role: 'manager' },
        session: {},
      });
      // No promotion: `role` keeps its stored value.
      expect(result.user.role).toBe('manager');
      expect(result.user.roles).toEqual(['manager']);
    });

    it('appends platform_admin to roles[] without overwriting role when promoting a platform admin', async () => {
      const callback = await getSessionCallback(makeDataEngine({ platformAdmin: true }));
      const result = await callback({
        user: { id: 'u-1', email: 'a@b.com', role: 'manager' },
        session: {},
      });
      // ADR-0068: NO `role:'admin'` overwrite footgun. The deprecated scalar
      // keeps its stored value; the canonical platform_admin identity is added
      // to roles[], and isPlatformAdmin is a derived alias.
      expect(result.user.role).toBe('manager');
      expect(result.user.roles).toEqual(['manager', 'platform_admin']);
      expect(result.user.isPlatformAdmin).toBe(true);
    });

    it('splits a multi-token stored role and appends platform_admin without duplicates', async () => {
      const callback = await getSessionCallback(makeDataEngine({ platformAdmin: true }));
      const result = await callback({
        user: { id: 'u-1', email: 'a@b.com', role: 'admin,manager' },
        session: {},
      });
      expect(result.user.role).toBe('admin,manager');
      expect(result.user.roles).toEqual(['admin', 'manager', 'platform_admin']);
      expect(result.user.isPlatformAdmin).toBe(true);
    });

    it('returns the payload untouched when the user has no id', async () => {
      const callback = await getSessionCallback(makeDataEngine({ platformAdmin: false }));
      const user = { email: 'anon@b.com' };
      const result = await callback({ user, session: {} });
      expect(result.user).toBe(user);
      expect(result.user.roles).toBeUndefined();
    });
  });
});
