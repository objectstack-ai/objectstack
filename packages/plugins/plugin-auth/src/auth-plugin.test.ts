// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthPlugin } from './auth-plugin';
import { AuthManager } from './auth-manager';
import type { PluginContext } from '@objectstack/core';

describe('AuthPlugin', () => {
  let mockContext: PluginContext;
  let authPlugin: AuthPlugin;

  /** Shared hook capture utilities for tests that need kernel:ready simulation */
  const createHookCapture = () => {
    const handlers = new Map<string, Array<(...args: any[]) => Promise<void>>>();
    const hookFn = vi.fn((name: string, handler: (...args: any[]) => Promise<void>) => {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name)!.push(handler);
    });
    const trigger = async (name: string) => {
      for (const h of handlers.get(name) || []) await h();
    };
    return { handlers, hookFn, trigger };
  };

  beforeEach(() => {
    mockContext = {
      registerService: vi.fn(),
      getService: vi.fn((name: string) => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'data') return undefined;
        return undefined;
      }),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn(),
      trigger: vi.fn(),
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      },
      getKernel: vi.fn(),
    };
  });

  describe('Plugin Metadata', () => {
    it('should have correct plugin metadata', () => {
      authPlugin = new AuthPlugin({
        secret: 'test-secret',
      });

      expect(authPlugin.name).toBe('com.objectstack.auth');
      expect(authPlugin.type).toBe('standard');
      expect(authPlugin.version).toBe('1.0.0');
      expect(authPlugin.dependencies).toEqual(['com.objectstack.engine.objectql']);
    });
  });

  describe('Initialization', () => {
    it('should throw error if secret is not provided', async () => {
      authPlugin = new AuthPlugin({});

      await expect(authPlugin.init(mockContext)).rejects.toThrow(
        'AuthPlugin: secret is required'
      );
    });

    it('should initialize successfully with required config', async () => {
      authPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });

      await authPlugin.init(mockContext);

      expect(mockContext.logger.info).toHaveBeenCalledWith('Initializing Auth Plugin...');
      expect(mockContext.registerService).toHaveBeenCalledWith('auth', expect.anything());
      expect(mockContext.logger.info).toHaveBeenCalledWith('Auth Plugin initialized successfully');
    });

    it('should configure OAuth providers', async () => {
      authPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        providers: [
          {
            id: 'google',
            clientId: 'google-client-id',
            clientSecret: 'google-client-secret',
            scope: ['email', 'profile'],
          },
        ],
      });

      await authPlugin.init(mockContext);

      expect(mockContext.registerService).toHaveBeenCalled();
    });

    it('should enable Google from env when not explicitly configured', async () => {
      const prevClientId = process.env.GOOGLE_CLIENT_ID;
      const prevClientSecret = process.env.GOOGLE_CLIENT_SECRET;
      process.env.GOOGLE_CLIENT_ID = 'google-env-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'google-env-client-secret';
      try {
        authPlugin = new AuthPlugin({
          secret: 'test-secret-at-least-32-chars-long',
          baseUrl: 'http://localhost:3000',
        });

        await authPlugin.init(mockContext);

        const manager = (mockContext.registerService as any).mock.calls.find(
          ([name]: [string]) => name === 'auth',
        )?.[1] as AuthManager;
        const publicConfig = manager.getPublicConfig();
        expect(publicConfig.socialProviders).toEqual([
          { id: 'google', name: 'Google', enabled: true, type: 'social' },
        ]);
      } finally {
        if (prevClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
        else process.env.GOOGLE_CLIENT_ID = prevClientId;
        if (prevClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
        else process.env.GOOGLE_CLIENT_SECRET = prevClientSecret;
      }
    });

    it('should expose auth:configure for provider extension packages', async () => {
      const prevClientId = process.env.GOOGLE_CLIENT_ID;
      const prevClientSecret = process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      try {
        mockContext.trigger = vi.fn(async (name: string, draft: any) => {
          if (name !== 'auth:configure') return;
          draft.socialProviders = {
            ...(draft.socialProviders ?? {}),
            github: { clientId: 'github-client-id', clientSecret: 'github-client-secret' },
          };
        });
        authPlugin = new AuthPlugin({
          secret: 'test-secret-at-least-32-chars-long',
          baseUrl: 'http://localhost:3000',
        });

        await authPlugin.init(mockContext);

        expect(mockContext.trigger).toHaveBeenCalledWith(
          'auth:configure',
          expect.objectContaining({ secret: 'test-secret-at-least-32-chars-long' }),
          mockContext,
        );
        const manager = (mockContext.registerService as any).mock.calls.find(
          ([name]: [string]) => name === 'auth',
        )?.[1] as AuthManager;
        const publicConfig = manager.getPublicConfig();
        expect(publicConfig.socialProviders).toEqual([
          { id: 'github', name: 'GitHub', enabled: true, type: 'social' },
        ]);
      } finally {
        if (prevClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
        else process.env.GOOGLE_CLIENT_ID = prevClientId;
        if (prevClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
        else process.env.GOOGLE_CLIENT_SECRET = prevClientSecret;
      }
    });

    it('should configure plugins', async () => {
      authPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        plugins: {
          organization: true,
          twoFactor: true,
          passkeys: true,
          magicLink: true,
        },
      });

      await authPlugin.init(mockContext);

      expect(mockContext.registerService).toHaveBeenCalled();
    });
  });

  describe('Start Phase', () => {
    let hookCapture: ReturnType<typeof createHookCapture>;

    beforeEach(async () => {
      hookCapture = createHookCapture();
      authPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });
      // Capture hook registrations so we can trigger them in tests
      mockContext.hook = hookCapture.hookFn;
      await authPlugin.init(mockContext);
    });

    it('should register a kernel:ready hook for route registration', async () => {
      await authPlugin.start(mockContext);

      expect(mockContext.hook).toHaveBeenCalledWith('kernel:ready', expect.any(Function));
    });

    it('should register routes with HTTP server on kernel:ready', async () => {
      const mockRawApp = {
        all: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
      };

      const mockHttpServer = {
        post: vi.fn(),
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        patch: vi.fn(),
        use: vi.fn(),
        getRawApp: vi.fn(() => mockRawApp),
      };

      mockContext.getService = vi.fn((name: string) => {
        if (name === 'http-server') return mockHttpServer;
        throw new Error(`Service not found: ${name}`);
      });

      await authPlugin.start(mockContext);

      // Routes should NOT be registered yet (deferred to kernel:ready)
      expect(mockRawApp.all).not.toHaveBeenCalled();

      // Simulate kernel:ready
      await hookCapture.trigger('kernel:ready');

      expect(mockContext.getService).toHaveBeenCalledWith('http-server');
      expect(mockHttpServer.getRawApp).toHaveBeenCalled();
      expect(mockRawApp.all).toHaveBeenCalledWith('/api/v1/auth/*', expect.any(Function));
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Auth routes registered')
      );
    });

    it('should log via ctx.logger when better-auth returns a 500 response', async () => {
      const mockRawApp = {
        all: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
      };

      const mockHttpServer = {
        post: vi.fn(),
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        patch: vi.fn(),
        use: vi.fn(),
        getRawApp: vi.fn(() => mockRawApp),
      };

      mockContext.getService = vi.fn((name: string) => {
        if (name === 'http-server') return mockHttpServer;
        throw new Error(`Service not found: ${name}`);
      });

      await authPlugin.start(mockContext);
      await hookCapture.trigger('kernel:ready');

      // Extract the registered route handler
      const routeHandler = mockRawApp.all.mock.calls[0][1];

      // Create a mock Hono context with a request that will trigger a 500 response
      const errorResponse = new Response(
        JSON.stringify({ error: 'Database connection failed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );

      // Mock the authManager's handleRequest to return a 500 response
      // We access the private authManager through the registered service
      const registeredAuthManager = (mockContext.registerService as any).mock.calls[0][1];
      vi.spyOn(registeredAuthManager, 'handleRequest').mockResolvedValue(errorResponse);

      const mockHonoCtx = {
        req: {
          raw: new Request('http://localhost:3000/api/v1/auth/sign-up/email', {
            method: 'POST',
            body: JSON.stringify({ email: 'a@b.com', password: 'pass' }),
            headers: { 'Content-Type': 'application/json' },
          }),
        },
      };

      const result = await routeHandler(mockHonoCtx);

      expect(result.status).toBe(500);
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        '[AuthPlugin] better-auth returned server error',
        expect.any(Error)
      );
    });

    it('should skip route registration when disabled', async () => {
      authPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        registerRoutes: false,
      });

      await authPlugin.init(mockContext);
      await authPlugin.start(mockContext);

      // Should not register HTTP routes — http-server should never be looked
      // up. The plugin still registers a kernel:ready hook unconditionally
      // for contributing Setup App i18n translations into the i18n service,
      // so we assert by side-effect (http-server lookup) rather than by
      // checking whether ctx.hook was called.
      const httpServerLookups = (mockContext.getService as ReturnType<typeof vi.fn>).mock.calls
        .filter((args: unknown[]) => args[0] === 'http-server');
      // Trigger any registered hooks; route registration should still skip.
      await hookCapture.trigger('kernel:ready');
      const httpServerLookupsAfter = (mockContext.getService as ReturnType<typeof vi.fn>).mock.calls
        .filter((args: unknown[]) => args[0] === 'http-server');
      expect(httpServerLookups.length).toBe(httpServerLookupsAfter.length);
    });

    it('should gracefully skip routes when http-server is not available', async () => {
      mockContext.getService = vi.fn(() => null);

      await authPlugin.start(mockContext);
      await hookCapture.trigger('kernel:ready');

      expect(mockContext.getService).toHaveBeenCalledWith('http-server');
      expect(mockContext.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No HTTP server available')
      );
      // Should NOT throw — auth service is still registered from init()
    });

    it('should gracefully handle http-server getService throwing', async () => {
      mockContext.getService = vi.fn(() => {
        throw new Error('Service not found: http-server');
      });

      await authPlugin.start(mockContext);
      await hookCapture.trigger('kernel:ready');

      expect(mockContext.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No HTTP server available')
      );
      // Auth service should still be registered from init()
      expect(mockContext.registerService).toHaveBeenCalledWith('auth', expect.anything());
      // Should NOT throw
    });

    it('should auto-detect baseUrl from http-server port when port differs', async () => {
      const mockRawApp = { all: vi.fn(), get: vi.fn(), post: vi.fn() };
      const mockHttpServer = {
        post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn(),
        patch: vi.fn(), use: vi.fn(),
        getRawApp: vi.fn(() => mockRawApp),
        getPort: vi.fn(() => 3002),
      };

      mockContext.getService = vi.fn((name: string) => {
        if (name === 'http-server') return mockHttpServer;
        throw new Error(`Service not found: ${name}`);
      });

      // AuthPlugin configured with default port 3000, but server will be on 3002
      const registeredAuthManager = (mockContext.registerService as any).mock.calls[0][1];
      const setRuntimeSpy = vi.spyOn(registeredAuthManager, 'setRuntimeBaseUrl');

      await authPlugin.start(mockContext);
      await hookCapture.trigger('kernel:ready');

      expect(setRuntimeSpy).toHaveBeenCalledWith('http://localhost:3002');
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Auth baseUrl auto-updated to http://localhost:3002'),
      );
    });

    it('should NOT update baseUrl when port matches configured value', async () => {
      const localHookCapture = createHookCapture();
      const localPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });
      mockContext.hook = localHookCapture.hookFn;
      (mockContext.registerService as any).mockClear();
      await localPlugin.init(mockContext);

      const mockRawApp = { all: vi.fn(), get: vi.fn(), post: vi.fn() };
      const mockHttpServer = {
        post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn(),
        patch: vi.fn(), use: vi.fn(),
        getRawApp: vi.fn(() => mockRawApp),
        getPort: vi.fn(() => 3000),
      };

      mockContext.getService = vi.fn((name: string) => {
        if (name === 'http-server') return mockHttpServer;
        throw new Error(`Service not found: ${name}`);
      });

      const registeredAuthManager = (mockContext.registerService as any).mock.calls[0][1];
      const setRuntimeSpy = vi.spyOn(registeredAuthManager, 'setRuntimeBaseUrl');

      await localPlugin.start(mockContext);
      await localHookCapture.trigger('kernel:ready');

      expect(setRuntimeSpy).not.toHaveBeenCalled();
    });

    it('should auto-detect baseUrl when no baseUrl configured (uses default fallback)', async () => {
      const localHookCapture = createHookCapture();
      // No baseUrl — defaults to http://localhost:3000 internally
      const localPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
      });
      mockContext.hook = localHookCapture.hookFn;
      (mockContext.registerService as any).mockClear();
      await localPlugin.init(mockContext);

      const mockRawApp = { all: vi.fn(), get: vi.fn(), post: vi.fn() };
      const mockHttpServer = {
        post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn(),
        patch: vi.fn(), use: vi.fn(),
        getRawApp: vi.fn(() => mockRawApp),
        getPort: vi.fn(() => 3002),
      };

      mockContext.getService = vi.fn((name: string) => {
        if (name === 'http-server') return mockHttpServer;
        throw new Error(`Service not found: ${name}`);
      });

      const registeredAuthManager = (mockContext.registerService as any).mock.calls[0][1];
      const setRuntimeSpy = vi.spyOn(registeredAuthManager, 'setRuntimeBaseUrl');

      await localPlugin.start(mockContext);
      await localHookCapture.trigger('kernel:ready');

      expect(setRuntimeSpy).toHaveBeenCalledWith('http://localhost:3002');
    });

    it('should throw error if auth not initialized', async () => {
      const uninitializedPlugin = new AuthPlugin({
        secret: 'test-secret',
      });

      await expect(uninitializedPlugin.start(mockContext)).rejects.toThrow(
        'Auth manager not initialized'
      );
    });
  });

  describe('Brand name binding (branding.workspace_name)', () => {
    let hookCapture: ReturnType<typeof createHookCapture>;
    let setAppNameSpy: ReturnType<typeof vi.spyOn>;

    const makeSettings = (resolved: { value: unknown; source: string } | Error) => ({
      get: vi.fn(async () => {
        if (resolved instanceof Error) throw resolved;
        return resolved;
      }),
      subscribe: vi.fn(),
    });

    const bootWithSettings = async (settings: unknown) => {
      hookCapture = createHookCapture();
      mockContext.hook = hookCapture.hookFn;
      mockContext.getService = vi.fn((name: string) => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'settings') return settings;
        // 'data', 'email', 'http-server' → absent in this harness
        return undefined;
      });
      setAppNameSpy = vi.spyOn(AuthManager.prototype, 'setAppName');
      authPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        appName: 'Configured Default',
      });
      await authPlugin.init(mockContext);
      await authPlugin.start(mockContext);
      await hookCapture.trigger('kernel:ready');
    };

    afterEach(() => {
      setAppNameSpy?.mockRestore();
    });

    it('overrides appName when the setting is explicitly set', async () => {
      const settings = makeSettings({ value: 'Acme Corp', source: 'global' });
      await bootWithSettings(settings);

      expect(settings.get).toHaveBeenCalledWith('branding', 'workspace_name', {});
      expect(setAppNameSpy).toHaveBeenCalledWith('Acme Corp');
      expect(settings.subscribe).toHaveBeenCalledWith('branding', expect.any(Function));
    });

    it('clears the override when the setting falls through to its manifest default', async () => {
      const settings = makeSettings({ value: 'ObjectStack', source: 'default' });
      await bootWithSettings(settings);

      // source === 'default' means the operator never customised it, so the
      // configured appName (e.g. OS_APP_NAME) must keep precedence.
      expect(setAppNameSpy).toHaveBeenCalledWith(undefined);
    });

    it('does not throw when reading the setting fails', async () => {
      const settings = makeSettings(new Error('boom'));
      await expect(bootWithSettings(settings)).resolves.toBeUndefined();
      expect(mockContext.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('failed to apply branding.workspace_name'),
      );
    });
  });

  describe('Auth settings binding (auth namespace)', () => {
    let hookCapture: ReturnType<typeof createHookCapture>;
    const previousGoogleClientId = process.env.GOOGLE_CLIENT_ID;
    const previousGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const previousGoogleEnabled = process.env.OS_AUTH_GOOGLE_ENABLED;
    const previousSignupEnabled = process.env.OS_AUTH_SIGNUP_ENABLED;

    const restoreGoogleEnv = () => {
      if (previousGoogleClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = previousGoogleClientId;
      if (previousGoogleClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = previousGoogleClientSecret;
      if (previousGoogleEnabled === undefined) delete process.env.OS_AUTH_GOOGLE_ENABLED;
      else process.env.OS_AUTH_GOOGLE_ENABLED = previousGoogleEnabled;
      if (previousSignupEnabled === undefined) delete process.env.OS_AUTH_SIGNUP_ENABLED;
      else process.env.OS_AUTH_SIGNUP_ENABLED = previousSignupEnabled;
    };

    const clearAuthSettingsEnv = () => {
      delete process.env.OS_AUTH_GOOGLE_ENABLED;
      delete process.env.OS_AUTH_SIGNUP_ENABLED;
    };

    const makeSettings = (values: Record<string, { value: unknown; source: string }>) => ({
      getNamespace: vi.fn(async (namespace: string) => {
        if (namespace !== 'auth') return { values: {} };
        return { values };
      }),
      subscribe: vi.fn(),
    });

    const bootWithAuthSettings = async (
      values: Record<string, { value: unknown; source: string }>,
      options: ConstructorParameters<typeof AuthPlugin>[0] = {},
      preserveAuthSettingsEnv = false,
    ) => {
      if (!preserveAuthSettingsEnv) clearAuthSettingsEnv();
      hookCapture = createHookCapture();
      const settings = makeSettings(values);
      mockContext.hook = hookCapture.hookFn;
      mockContext.getService = vi.fn((name: string) => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'settings') return settings;
        return undefined;
      });
      authPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        ...options,
      });

      await authPlugin.init(mockContext);
      const manager = (mockContext.registerService as any).mock.calls.find(
        ([name]: [string]) => name === 'auth',
      )?.[1] as AuthManager;
      await authPlugin.start(mockContext);
      await hookCapture.trigger('kernel:ready');
      return { manager, settings };
    };

    afterEach(() => {
      restoreGoogleEnv();
    });

    it('applies email/password login, registration, and verification settings', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;

      const { manager } = await bootWithAuthSettings({
        email_password_enabled: { value: false, source: 'global' },
        signup_enabled: { value: false, source: 'global' },
        require_email_verification: { value: true, source: 'global' },
      });

      expect(manager.getPublicConfig().emailPassword).toEqual({
        enabled: false,
        disableSignUp: true,
        requireEmailVerification: true,
      });
    });

    it('accepts numeric boolean values saved by the Setup settings form', async () => {
      const { manager } = await bootWithAuthSettings({
        signup_enabled: { value: 0, source: 'global' },
        require_email_verification: { value: 1, source: 'global' },
      });

      expect(manager.getPublicConfig().emailPassword.disableSignUp).toBe(true);
      expect(manager.getPublicConfig().emailPassword.requireEmailVerification).toBe(true);
    });

    it('applies password-policy bounds and session lifetime (days → seconds)', async () => {
      const { manager } = await bootWithAuthSettings({
        password_min_length: { value: 12, source: 'global' },
        password_max_length: { value: 200, source: 'global' },
        session_expiry_days: { value: 30, source: 'global' },
        session_refresh_days: { value: 3, source: 'global' },
      });
      const cfg = (manager as any).config;
      expect(cfg.emailAndPassword.minPasswordLength).toBe(12);
      expect(cfg.emailAndPassword.maxPasswordLength).toBe(200);
      expect(cfg.session.expiresIn).toBe(30 * 86_400);
      expect(cfg.session.updateAge).toBe(3 * 86_400);
    });

    it('ignores unset (default-source) and malformed password/session values', async () => {
      const { manager } = await bootWithAuthSettings({
        password_min_length: { value: 8, source: 'default' }, // not explicit → ignored
        session_expiry_days: { value: 'abc', source: 'global' }, // malformed → ignored
        session_refresh_days: { value: 0, source: 'global' }, // non-positive → ignored
      });
      const cfg = (manager as any).config;
      expect(cfg.emailAndPassword?.minPasswordLength).toBeUndefined();
      expect(cfg.session?.expiresIn).toBeUndefined();
      expect(cfg.session?.updateAge).toBeUndefined();
    });

    it('binds password_reject_breached into plugins.passwordRejectBreached (ADR-0069 D1)', async () => {
      const { manager } = await bootWithAuthSettings({
        password_reject_breached: { value: true, source: 'global' },
      });
      expect((manager as any).config.plugins?.passwordRejectBreached).toBe(true);
    });

    it('does not set passwordRejectBreached when the setting is default-source (off by default)', async () => {
      const { manager } = await bootWithAuthSettings({
        password_reject_breached: { value: false, source: 'default' }, // not explicit → no patch
      });
      expect((manager as any).config.plugins?.passwordRejectBreached).toBeUndefined();
    });

    it('binds password complexity settings (ADR-0069 D1)', async () => {
      const { manager } = await bootWithAuthSettings({
        password_require_complexity: { value: true, source: 'global' },
        password_min_classes: { value: 4, source: 'global' },
      });
      const cfg = (manager as any).config;
      expect(cfg.passwordRequireComplexity).toBe(true);
      expect(cfg.passwordMinClasses).toBe(4);
    });

    it('clamps password_min_classes into [1,4]', async () => {
      const { manager } = await bootWithAuthSettings({
        password_require_complexity: { value: true, source: 'global' },
        password_min_classes: { value: 9, source: 'global' },
      });
      expect((manager as any).config.passwordMinClasses).toBe(4);
    });

    it('does not set complexity flags when default-source', async () => {
      const { manager } = await bootWithAuthSettings({
        password_require_complexity: { value: false, source: 'default' },
      });
      expect((manager as any).config.passwordRequireComplexity).toBeUndefined();
    });

    it('binds password_history_count (ADR-0069 D1)', async () => {
      const { manager } = await bootWithAuthSettings({ password_history_count: { value: 5, source: 'global' } });
      expect((manager as any).config.passwordHistoryCount).toBe(5);
    });

    it('clamps password_history_count to a max of 24', async () => {
      const { manager } = await bootWithAuthSettings({ password_history_count: { value: 99, source: 'global' } });
      expect((manager as any).config.passwordHistoryCount).toBe(24);
    });

    it('applies an explicit password_history_count of 0 (feature off)', async () => {
      const { manager } = await bootWithAuthSettings({ password_history_count: { value: 0, source: 'global' } });
      expect((manager as any).config.passwordHistoryCount).toBe(0);
    });

    it('binds password_expiry_days (ADR-0069 D1)', async () => {
      const { manager } = await bootWithAuthSettings({ password_expiry_days: { value: 90, source: 'global' } });
      expect((manager as any).config.passwordExpiryDays).toBe(90);
      expect((manager as any).isAuthGateActive()).toBe(true);
    });

    it('binds mfa_required and force-enables the twoFactor plugin (ADR-0069 D3)', async () => {
      const { manager } = await bootWithAuthSettings({ mfa_required: { value: true, source: 'global' } });
      const cfg = (manager as any).config;
      expect(cfg.mfaRequired).toBe(true);
      expect(cfg.plugins?.twoFactor).toBe(true);
      expect((manager as any).isAuthGateActive()).toBe(true);
    });

    it('binds mfa_grace_period_days', async () => {
      const { manager } = await bootWithAuthSettings({ mfa_grace_period_days: { value: 14, source: 'global' } });
      expect((manager as any).config.mfaGracePeriodDays).toBe(14);
    });

    it('binds allowed_ip_ranges into a parsed list (ADR-0069 D5)', async () => {
      const { manager } = await bootWithAuthSettings({
        allowed_ip_ranges: { value: '203.0.113.0/24, 10.0.0.5\n192.168.1.1', source: 'global' },
      });
      expect((manager as any).config.allowedIpRanges).toEqual(['203.0.113.0/24', '10.0.0.5', '192.168.1.1']);
    });

    it('binds session-control settings (ADR-0069 D4)', async () => {
      const { manager } = await bootWithAuthSettings({
        session_idle_timeout_minutes: { value: 15, source: 'global' },
        session_absolute_max_hours: { value: 12, source: 'global' },
        max_concurrent_sessions_per_user: { value: 3, source: 'global' },
      });
      const cfg = (manager as any).config;
      expect(cfg.sessionIdleTimeoutMinutes).toBe(15);
      expect(cfg.sessionAbsoluteMaxHours).toBe(12);
      expect(cfg.maxConcurrentSessions).toBe(3);
    });

    it('clamps mfa_grace_period_days to a max of 90', async () => {
      const { manager } = await bootWithAuthSettings({ mfa_grace_period_days: { value: 999, source: 'global' } });
      expect((manager as any).config.mfaGracePeriodDays).toBe(90);
    });

    it('binds account-lockout settings (ADR-0069 D2)', async () => {
      const { manager } = await bootWithAuthSettings({
        lockout_threshold: { value: 5, source: 'global' },
        lockout_duration_minutes: { value: 30, source: 'global' },
      });
      const cfg = (manager as any).config;
      expect(cfg.lockoutThreshold).toBe(5);
      expect(cfg.lockoutDurationMinutes).toBe(30);
    });

    it('allows an explicit lockout_threshold of 0 to disable lockout', async () => {
      const { manager } = await bootWithAuthSettings({
        lockout_threshold: { value: 0, source: 'global' },
      });
      // 0 is a meaningful (feature-off) value, so it must still be applied —
      // unlike the positive-int session fields where 0 is rejected as malformed.
      expect((manager as any).config.lockoutThreshold).toBe(0);
    });

    it('binds auth rate-limit tuning into a native rateLimit with customRules (ADR-0069 D2)', async () => {
      const { manager } = await bootWithAuthSettings({
        rate_limit_max: { value: 5, source: 'global' },
        rate_limit_window_seconds: { value: 30, source: 'global' },
      });
      const rl = (manager as any).config.rateLimit;
      expect(rl).toMatchObject({ enabled: true, max: 5, window: 30 });
      expect(rl.customRules['/sign-in/email']).toEqual({ window: 30, max: 5 });
      expect(rl.customRules['/reset-password']).toEqual({ window: 30, max: 5 });
    });

    it('does not set lockout/rateLimit when those settings are default-source', async () => {
      const { manager } = await bootWithAuthSettings({
        lockout_threshold: { value: 0, source: 'default' },
        rate_limit_max: { value: 10, source: 'default' },
      });
      const cfg = (manager as any).config;
      expect(cfg.lockoutThreshold).toBeUndefined();
      expect(cfg.rateLimit).toBeUndefined();
    });

    it('enables Google from env credentials when google_enabled is explicit true', async () => {
      process.env.GOOGLE_CLIENT_ID = 'google-env-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'google-env-client-secret';
      delete process.env.OS_AUTH_GOOGLE_ENABLED;

      const { manager } = await bootWithAuthSettings({
        google_enabled: { value: true, source: 'global' },
      });

      expect(manager.getPublicConfig().socialProviders).toEqual([
        { id: 'google', name: 'Google', enabled: true, type: 'social' },
      ]);
      expect((manager as any).config.socialProviders.google.clientId).toBe(
        'google-env-client-id',
      );
    });

    it('enables Google from settings-managed credentials', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.OS_AUTH_GOOGLE_ENABLED;

      const { manager } = await bootWithAuthSettings({
        google_enabled: { value: true, source: 'global' },
        google_client_id: { value: 'google-settings-client-id', source: 'global' },
        google_client_secret: { value: 'google-settings-client-secret', source: 'global' },
      });

      expect(manager.getPublicConfig().socialProviders).toEqual([
        { id: 'google', name: 'Google', enabled: true, type: 'social' },
      ]);
      expect((manager as any).config.socialProviders.google.clientId).toBe(
        'google-settings-client-id',
      );
    });

    it('keeps deployment Google credentials ahead of settings-managed credentials', async () => {
      process.env.GOOGLE_CLIENT_ID = 'google-env-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'google-env-client-secret';
      delete process.env.OS_AUTH_GOOGLE_ENABLED;

      const { manager } = await bootWithAuthSettings({
        google_enabled: { value: true, source: 'global' },
        google_client_id: { value: 'google-settings-client-id', source: 'global' },
        google_client_secret: { value: 'google-settings-client-secret', source: 'global' },
      });

      expect(manager.getPublicConfig().socialProviders).toEqual([
        { id: 'google', name: 'Google', enabled: true, type: 'social' },
      ]);
      expect((manager as any).config.socialProviders.google.clientId).toBe(
        'google-env-client-id',
      );
    });

    it('disables env-backed Google when google_enabled is explicit false', async () => {
      process.env.GOOGLE_CLIENT_ID = 'google-env-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'google-env-client-secret';
      delete process.env.OS_AUTH_GOOGLE_ENABLED;

      const { manager } = await bootWithAuthSettings({
        google_enabled: { value: false, source: 'global' },
      });

      expect(manager.getPublicConfig().socialProviders).toEqual([]);
    });

    it('does not let manifest defaults override configured auth options', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;

      const { manager } = await bootWithAuthSettings({
        email_password_enabled: { value: true, source: 'default' },
        signup_enabled: { value: true, source: 'default' },
        require_email_verification: { value: false, source: 'default' },
        google_enabled: { value: true, source: 'default' },
      }, {
        emailAndPassword: {
          enabled: true,
          disableSignUp: true,
          requireEmailVerification: true,
        },
        plugins: {
          admin: false,
          twoFactor: false,
        },
        socialProviders: {
          github: { clientId: 'github-client-id', clientSecret: 'github-client-secret' },
        },
      });

      expect(manager.getPublicConfig().emailPassword).toEqual({
        enabled: true,
        disableSignUp: true,
        requireEmailVerification: true,
      });
      expect(manager.getPublicConfig().features.twoFactor).toBe(false);
      expect(manager.getPublicConfig().socialProviders).toEqual([
        { id: 'github', name: 'GitHub', enabled: true, type: 'social' },
      ]);
    });

    it('lets OS_AUTH_* env overrides win over stored auth settings', async () => {
      process.env.OS_AUTH_SIGNUP_ENABLED = 'false';
      process.env.OS_AUTH_GOOGLE_ENABLED = 'false';
      process.env.GOOGLE_CLIENT_ID = 'google-env-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'google-env-client-secret';

      const { manager } = await bootWithAuthSettings({
        signup_enabled: { value: true, source: 'global' },
        google_enabled: { value: true, source: 'global' },
      }, {}, true);

      const publicConfig = manager.getPublicConfig();
      expect(publicConfig.emailPassword.disableSignUp).toBe(true);
      expect(publicConfig.socialProviders).toEqual([]);
    });

    it('subscribes to auth settings changes and reapplies them', async () => {
      clearAuthSettingsEnv();
      let values: Record<string, { value: unknown; source: string }> = {
        signup_enabled: { value: true, source: 'global' },
      };
      const settings = {
        getNamespace: vi.fn(async () => ({ values })),
        subscribe: vi.fn(),
      };
      hookCapture = createHookCapture();
      mockContext.hook = hookCapture.hookFn;
      mockContext.getService = vi.fn((name: string) => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'settings') return settings;
        return undefined;
      });
      authPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });
      await authPlugin.init(mockContext);
      const manager = (mockContext.registerService as any).mock.calls.find(
        ([name]: [string]) => name === 'auth',
      )?.[1] as AuthManager;
      await authPlugin.start(mockContext);
      await hookCapture.trigger('kernel:ready');

      expect(manager.getPublicConfig().emailPassword.disableSignUp).toBe(false);

      values = { signup_enabled: { value: false, source: 'global' } };
      const handler = settings.subscribe.mock.calls.find(
        ([namespace]: [string]) => namespace === 'auth',
      )?.[1] as () => void;
      handler();
      await Promise.resolve();

      expect(manager.getPublicConfig().emailPassword.disableSignUp).toBe(true);
    });
  });

  describe('Destroy Phase', () => {
    it('should cleanup resources', async () => {
      authPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
      });

      await authPlugin.init(mockContext);
      await authPlugin.destroy();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('Configuration Options', () => {
    it('should use custom base path', async () => {
      const { hookFn, trigger } = createHookCapture();
      mockContext.hook = hookFn;

      authPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        basePath: '/custom/auth',
      });

      await authPlugin.init(mockContext);

      const mockRawApp = {
        all: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
      };

      const mockHttpServer = {
        post: vi.fn(),
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        patch: vi.fn(),
        use: vi.fn(),
        getRawApp: vi.fn(() => mockRawApp),
      };

      mockContext.getService = vi.fn(() => mockHttpServer);

      await authPlugin.start(mockContext);

      // Trigger kernel:ready to actually register routes
      await trigger('kernel:ready');

      expect(mockRawApp.all).toHaveBeenCalledWith(
        '/custom/auth/*',
        expect.any(Function)
      );
    });

    it('should configure session options', async () => {
      authPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        session: {
          expiresIn: 60 * 60 * 24 * 30, // 30 days
          updateAge: 60 * 60 * 24, // 1 day
        },
      });

      await authPlugin.init(mockContext);

      expect(mockContext.registerService).toHaveBeenCalled();
    });
  });

  // ADR-0081 D1 — single-org default-organization bootstrap.
  describe('Single-org default-org bootstrap', () => {
    const OLD_ENV = process.env.OS_MULTI_ORG_ENABLED;
    let hookCapture: ReturnType<typeof createHookCapture>;
    let middlewares: any[];
    let ql: any;

    const makeQl = () => {
      const tables: Record<string, any[]> = {
        sys_permission_set: [{ id: 'ps_admin', name: 'admin_full_access' }],
        sys_user_permission_set: [
          { id: 'ups1', user_id: 'u1', permission_set_id: 'ps_admin', organization_id: null },
        ],
        sys_member: [],
        sys_organization: [],
      };
      const matches = (row: any, where: any) =>
        Object.entries(where ?? {}).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
          return v === null ? row[k] == null : row[k] === v;
        });
      return {
        tables,
        registerMiddleware: (mw: any) => middlewares.push(mw),
        find: vi.fn(async (object: string, q: any) =>
          (tables[object] ?? []).filter((r) => matches(r, q?.where)).slice(0, q?.limit ?? 100),
        ),
        insert: vi.fn(async (object: string, data: any) => {
          (tables[object] ??= []).push(data);
          return data;
        }),
      };
    };

    beforeEach(() => {
      delete process.env.OS_MULTI_ORG_ENABLED;
      hookCapture = createHookCapture();
      middlewares = [];
      ql = makeQl();
      mockContext.hook = hookCapture.hookFn;
      mockContext.getService = vi.fn((name: string) => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'objectql') return ql;
        return undefined;
      });
    });

    afterEach(() => {
      if (OLD_ENV === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
      else process.env.OS_MULTI_ORG_ENABLED = OLD_ENV;
    });

    const boot = async (options: any = {}) => {
      authPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        ...options,
      });
      await authPlugin.init(mockContext);
      await authPlugin.start(mockContext);
    };

    it('single-org: creates the default org + owner membership on kernel:ready', async () => {
      await boot();
      await hookCapture.trigger('kernel:ready');
      expect(ql.tables.sys_organization[0]).toMatchObject({ slug: 'default' });
      expect(ql.tables.sys_member[0]).toMatchObject({ user_id: 'u1', role: 'owner' });
    });

    it('single-org: re-runs after a sys_user_permission_set insert (first-signup promotion)', async () => {
      await boot();
      expect(middlewares.length).toBeGreaterThan(0);
      const runAll = async (opCtx: any) => {
        for (const mw of middlewares) await mw(opCtx, async () => {});
      };
      await runAll({ object: 'sys_user_permission_set', operation: 'insert' });
      expect(ql.tables.sys_member).toHaveLength(1);
      // Unrelated inserts do not re-trigger (membership already exists, but
      // verify no new insert attempt is even made).
      ql.insert.mockClear();
      await runAll({ object: 'task', operation: 'insert' });
      expect(ql.insert).not.toHaveBeenCalled();
    });

    it('single-org: idempotent — second kernel:ready pass is a no-op', async () => {
      await boot();
      await hookCapture.trigger('kernel:ready');
      const orgCount = ql.tables.sys_organization.length;
      const memberCount = ql.tables.sys_member.length;
      await hookCapture.trigger('kernel:ready');
      expect(ql.tables.sys_organization).toHaveLength(orgCount);
      expect(ql.tables.sys_member).toHaveLength(memberCount);
    });

    it('multi-org: bootstrap is NOT wired (enterprise organizations package owns it)', async () => {
      process.env.OS_MULTI_ORG_ENABLED = 'true';
      await boot();
      await hookCapture.trigger('kernel:ready');
      expect(ql.tables.sys_organization).toHaveLength(0);
      expect(ql.tables.sys_member).toHaveLength(0);
    });

    it('autoDefaultOrganization: false opts out', async () => {
      await boot({ autoDefaultOrganization: false });
      await hookCapture.trigger('kernel:ready');
      expect(ql.tables.sys_organization).toHaveLength(0);
      expect(ql.tables.sys_member).toHaveLength(0);
    });
  });

  // #2996 — the ADR-0093 D6 membership backfill re-runs on `app:seeded` so
  // users inserted by an over-budget background seed (which finishes AFTER
  // `kernel:ready` and bypasses the `user.create.after` reconciler) still get
  // bound to the default org without waiting for the next restart.
  describe('Membership backfill re-run on app:seeded (#2996)', () => {
    const OLD_MULTI = process.env.OS_MULTI_ORG_ENABLED;
    const OLD_SKIP = process.env.OS_SKIP_MEMBERSHIP_BACKFILL;
    let hookCapture: ReturnType<typeof createHookCapture>;
    let ql: any;

    const makeQl = () => {
      const tables: Record<string, any[]> = {
        sys_permission_set: [{ id: 'ps_admin', name: 'admin_full_access' }],
        sys_user_permission_set: [
          { id: 'ups1', user_id: 'admin', permission_set_id: 'ps_admin', organization_id: null },
        ],
        // The platform admin already exists; the default-org bootstrap binds it
        // as `owner` on kernel:ready. A member-less seeded user is added later.
        sys_user: [{ id: 'admin' }],
        sys_member: [],
        sys_organization: [],
      };
      const matches = (row: any, where: any) =>
        Object.entries(where ?? {}).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
          return v === null ? row[k] == null : row[k] === v;
        });
      return {
        tables,
        registerMiddleware: vi.fn(),
        find: vi.fn(async (object: string, q: any) =>
          (tables[object] ?? []).filter((r) => matches(r, q?.where)).slice(0, q?.limit ?? 100),
        ),
        insert: vi.fn(async (object: string, data: any) => {
          (tables[object] ??= []).push(data);
          return data;
        }),
      };
    };

    beforeEach(() => {
      delete process.env.OS_MULTI_ORG_ENABLED;
      delete process.env.OS_SKIP_MEMBERSHIP_BACKFILL;
      hookCapture = createHookCapture();
      ql = makeQl();
      mockContext.hook = hookCapture.hookFn;
      mockContext.getService = vi.fn((name: string) => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'objectql') return ql;
        return undefined;
      });
    });

    afterEach(() => {
      if (OLD_MULTI === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
      else process.env.OS_MULTI_ORG_ENABLED = OLD_MULTI;
      if (OLD_SKIP === undefined) delete process.env.OS_SKIP_MEMBERSHIP_BACKFILL;
      else process.env.OS_SKIP_MEMBERSHIP_BACKFILL = OLD_SKIP;
    });

    const boot = async (options: any = {}) => {
      authPlugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        ...options,
      });
      await authPlugin.init(mockContext);
      await authPlugin.start(mockContext);
    };

    it('registers an app:seeded hook alongside kernel:ready', async () => {
      await boot();
      expect(mockContext.hook).toHaveBeenCalledWith('app:seeded', expect.any(Function));
    });

    it('binds a user seeded after kernel:ready when app:seeded fires', async () => {
      await boot();
      // Boot: default org created, admin bound as owner, first backfill pass
      // sees no member-less users.
      await hookCapture.trigger('kernel:ready');
      expect(ql.tables.sys_member.map((m: any) => m.user_id)).toEqual(['admin']);

      // A background seed inserts a member-less user AFTER kernel:ready.
      ql.tables.sys_user.push({ id: 'seeded_u2' });

      await hookCapture.trigger('app:seeded');

      const seededMember = ql.tables.sys_member.find((m: any) => m.user_id === 'seeded_u2');
      expect(seededMember).toMatchObject({ user_id: 'seeded_u2', role: 'member' });
    });

    it('OS_SKIP_MEMBERSHIP_BACKFILL=1 disables the app:seeded re-run', async () => {
      process.env.OS_SKIP_MEMBERSHIP_BACKFILL = '1';
      await boot();
      // No app:seeded hook is registered when the backfill is opted out.
      expect(mockContext.hook).not.toHaveBeenCalledWith('app:seeded', expect.any(Function));

      await hookCapture.trigger('kernel:ready');
      ql.tables.sys_user.push({ id: 'seeded_u2' });
      await hookCapture.trigger('app:seeded');

      expect(ql.tables.sys_member.find((m: any) => m.user_id === 'seeded_u2')).toBeUndefined();
    });
  });

  // ── #4772 — the kernel `cache` service is resolved at COUNTING time ─────────
  //
  // AuthPlugin.init() runs before CacheServicePlugin registers `cache` (21ms
  // earlier in a showcase cold start). The eager probe that used to live in
  // init() therefore concluded "no cache" in deployments that had one, printed
  // a warning telling the operator to provision Redis, and — the part that was
  // not just noise — froze that conclusion, so the rate-limit counters never
  // reached the shared store even after it came up.
  describe('rate-limit counter store (ADR-0069 D2 / #4772)', () => {
    const makeCache = () => {
      const store = new Map<string, unknown>();
      return {
        store,
        get: vi.fn(async (k: string) => (store.has(k) ? store.get(k) : undefined)),
        set: vi.fn(async (k: string, v: unknown, _ttl?: number) => { store.set(k, v); }),
        delete: vi.fn(async (k: string) => store.delete(k)),
        has: vi.fn(async (k: string) => store.has(k)),
        clear: vi.fn(async () => store.clear()),
        stats: vi.fn(async () => ({ hits: 0, misses: 0, keys: store.size })),
      };
    };

    /** Boot the plugin against a context whose `cache` resolution is under test control. */
    const bootWith = async (resolveCache: () => Promise<unknown>) => {
      const ctx = {
        ...mockContext,
        getServiceAsync: vi.fn(async (name: string) => {
          if (name === 'cache') return await resolveCache();
          return undefined;
        }),
      } as unknown as PluginContext;
      const plugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
      });
      await plugin.init(ctx);
      const manager = (ctx.registerService as any).mock.calls.find(
        ([name]: [string]) => name === 'auth',
      )?.[1] as AuthManager;
      return { ctx, manager, storage: (manager as any).config.rateLimitStorage };
    };

    it('does not warn during init when the cache has not registered yet', async () => {
      // Exactly the showcase cold start: `cache` is not in the registry when
      // plugin-auth initializes.
      const { ctx } = await bootWith(async () => undefined);
      const warned = (ctx.logger.warn as any).mock.calls.map((c: any[]) => String(c[0]));
      expect(warned.some((m: string) => m.includes('no cache service registered'))).toBe(false);
      expect(warned.some((m: string) => m.includes('rate-limit'))).toBe(false);
    });

    it('counts in the cache registered AFTER init — the counters really are shared', async () => {
      const cache = makeCache();
      let registered = false;
      const { ctx, storage } = await bootWith(async () => (registered ? cache : undefined));
      expect(storage).toBeDefined();

      // CacheServicePlugin comes up 21ms later.
      registered = true;

      const decision = await storage.consume('ip:203.0.113.7', { window: 60, max: 3 });
      expect(decision).toEqual({ allowed: true, retryAfter: null });
      expect(cache.store.size).toBe(1);
      const info = (ctx.logger.info as any).mock.calls.map((c: any[]) => String(c[0]));
      expect(info.some((m: string) => m.includes('rate-limit counters bound to the kernel cache service'))).toBe(true);
    });

    it('warns at counting time — and only then — when there is genuinely no cache service', async () => {
      const { ctx, storage } = await bootWith(async () => undefined);
      const rateLimitWarnings = () =>
        (ctx.logger.warn as any).mock.calls
          .map((c: any[]) => String(c[0]))
          .filter((m: string) => m.includes('rate-limit counters'));
      expect(rateLimitWarnings()).toEqual([]);

      await storage.consume('ip:198.51.100.9', { window: 60, max: 3 });
      expect(rateLimitWarnings()).toHaveLength(1);

      const warned = (ctx.logger.warn as any).mock.calls.map((c: any[]) => String(c[0]));
      expect(warned.some((m: string) => m.includes('no `cache` service registered at all'))).toBe(true);
    });

    it('leaves the counters to better-auth when the host supplies its own secondaryStorage', async () => {
      const ctx = {
        ...mockContext,
        getServiceAsync: vi.fn(async () => undefined),
      } as unknown as PluginContext;
      const plugin = new AuthPlugin({
        secret: 'test-secret-at-least-32-chars-long',
        baseUrl: 'http://localhost:3000',
        secondaryStorage: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
      } as any);
      await plugin.init(ctx);
      const manager = (ctx.registerService as any).mock.calls.find(
        ([name]: [string]) => name === 'auth',
      )?.[1] as AuthManager;
      expect((manager as any).config.rateLimitStorage).toBeUndefined();
      expect((manager as any).config.secondaryStorage).toBeDefined();
    });

    it('never binds the kernel cache as better-auth secondaryStorage (sessions stay in sys_session)', async () => {
      // ADR-0069 D4's session controls revoke by writing the `sys_session` row;
      // better-auth answers `findSession` from a secondaryStorage snapshot
      // without reading the database, so a cache-backed session store would
      // silently disable them. The cache reaches the COUNTERS only.
      //
      // #4785 settled this as a DECISION, not a workaround: the session of
      // record is always `sys_session`. This assertion is the wiring half of
      // that decision; `session-of-record.test.ts` is the other half — it
      // drives the real better-auth pipeline to prove each of the three D4
      // controls actually ends a live session, and pins the counter-factual
      // (with a `secondaryStorage` bound, `sys_session` stays EMPTY and the
      // idle timeout never fires). Read the two together before changing
      // either: this line alone says what we do, not why it matters.
      const cache = makeCache();
      const { manager } = await bootWith(async () => cache);
      expect((manager as any).config.secondaryStorage).toBeUndefined();
    });

    // ── #4790 — the SECOND counter with the same hole: ObjectStack's own
    // per-number OTP send budget (#2780). It shared state only through a
    // host-supplied `secondaryStorage`, which the standard `serve` composition
    // never supplies, so the declared per-number cap was cap×N across N nodes —
    // in paid SMS. Same cure, same resolution path, deliberately NOT
    // `secondaryStorage` (#4785).
    describe('per-number OTP send budget (#2780 / #4790)', () => {
      const PHONE = '+8613800000000';
      const deliverableSms = { async send() { return { id: 'x', status: 'sent' }; }, isConfigured: () => true };

      it('counts the budget in a cache registered AFTER auth init', async () => {
        const cache = makeCache();
        let registered = false;
        const { ctx, manager } = await bootWith(async () => (registered ? cache : undefined));
        expect((manager as any).config.sharedCounterStore).toBeTypeOf('function');

        // CacheServicePlugin comes up 21ms later.
        registered = true;
        manager.setSmsService(deliverableSms as any);

        await manager.assertPhoneOtpSendAllowed(PHONE);
        // The send landed in the SHARED store — this is the assertion the
        // pre-#4790 wiring could not satisfy in any standard composition.
        expect([...cache.store.keys()]).toEqual([`phone-otp-sends:${PHONE}`]);
        await expect(manager.assertPhoneOtpSendAllowed(PHONE))
          .rejects.toThrow(/Too many verification codes/);

        // Bound → an info line and NO warning: the operator must be able to
        // tell "shared" from "degraded" without reading the code.
        const info = (ctx.logger.info as any).mock.calls.map((c: any[]) => String(c[0]));
        expect(info.some((m: string) => m.includes('per-number OTP send budget (#2780) bound to the kernel cache service'))).toBe(true);
        expect((ctx.logger.warn as any).mock.calls
          .map((c: any[]) => String(c[0]))
          .filter((m: string) => m.includes('per-number OTP send budget'))).toEqual([]);
      });

      it('warns loudly at counting time when there is no cache — degraded, never disabled', async () => {
        const { ctx, manager } = await bootWith(async () => undefined);
        manager.setSmsService(deliverableSms as any);
        const otpWarnings = () =>
          (ctx.logger.warn as any).mock.calls
            .map((c: any[]) => String(c[0]))
            .filter((m: string) => m.includes('per-number OTP send budget'));

        // Nothing is said at boot — a deployment that never sends an OTP is not
        // warned about a store it never needs.
        expect(otpWarnings()).toEqual([]);

        await manager.assertPhoneOtpSendAllowed(PHONE);
        // Still enforced, in-process.
        await expect(manager.assertPhoneOtpSendAllowed(PHONE))
          .rejects.toThrow(/Too many verification codes/);

        expect(otpWarnings()).toHaveLength(1);
        expect(otpWarnings()[0]).toContain('PAID SMS');
        expect(otpWarnings()[0]).toContain('no `cache` service registered at all');
        // Degraded → a warning and NO "bound" info line; the mirror image of
        // the cache-present case above.
        expect((ctx.logger.info as any).mock.calls
          .map((c: any[]) => String(c[0]))
          .filter((m: string) => m.includes('per-number OTP send budget'))).toEqual([]);
      });
    });
  });
});
