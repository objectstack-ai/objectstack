import { describe, it, expect } from 'vitest';
import type { IAuthService, AuthResult, AuthUser } from './auth-service';

describe('Auth Service Contract', () => {
  it('should allow a minimal IAuthService implementation with required methods', () => {
    const service: IAuthService = {
      handleRequest: async (_request) => new Response('OK'),
      verify: async (_token) => ({ success: false }),
    };

    expect(typeof service.handleRequest).toBe('function');
    expect(typeof service.verify).toBe('function');
  });

  it('should allow a full implementation with optional methods', () => {
    const service: IAuthService = {
      handleRequest: async () => new Response('OK'),
      verify: async () => ({ success: false }),
      logout: async (_sessionId) => {},
      getCurrentUser: async (_request) => undefined,
    };

    expect(service.logout).toBeDefined();
    expect(service.getCurrentUser).toBeDefined();
  });

  it('should verify a valid token', async () => {
    const validUser: AuthUser = { id: 'u1', email: 'alice@test.com', name: 'Alice' };

    const service: IAuthService = {
      handleRequest: async () => new Response('OK'),
      verify: async (token): Promise<AuthResult> => {
        if (token === 'valid-token') {
          return {
            success: true,
            user: validUser,
            session: { id: 's1', userId: 'u1', expiresAt: '2099-01-01T00:00:00Z' },
          };
        }
        return { success: false, error: 'Invalid token' };
      },
    };

    const result = await service.verify('valid-token');
    expect(result.success).toBe(true);
    expect(result.user?.email).toBe('alice@test.com');
    expect(result.session?.userId).toBe('u1');
  });

  it('should reject an invalid token', async () => {
    const service: IAuthService = {
      handleRequest: async () => new Response('OK'),
      verify: async (_token) => ({ success: false, error: 'Invalid token' }),
    };

    const result = await service.verify('bad-token');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid token');
  });

  it('should handle logout', async () => {
    const sessions = new Set(['s1', 's2']);

    const service: IAuthService = {
      handleRequest: async () => new Response('OK'),
      verify: async () => ({ success: true }),
      logout: async (sessionId) => { sessions.delete(sessionId); },
    };

    await service.logout!('s1');
    expect(sessions.has('s1')).toBe(false);
    expect(sessions.has('s2')).toBe(true);
  });

  // [#4127 batch 2] The `/mcp` domain called both of these through
  // `const authService: any` + `?.()`, so the calls were invisible to the type
  // system AND accidentally safe: an absent method returned `undefined` and the
  // route silently fell back, making a real disagreement look like normal
  // operation. AuthManager implements both; only the contract was missing.
  it('should expose the MCP resource identity an auth service owns', () => {
    const service: IAuthService = {
      handleRequest: async () => new Response('OK'),
      verify: async () => ({ success: true }),
      getMcpResourceUrl: () => 'https://acme.example.com/api/v1/mcp',
      getMcpResourceMetadataUrl: () => 'https://acme.example.com/.well-known/oauth-protected-resource',
    };

    expect(service.getMcpResourceUrl!()).toBe('https://acme.example.com/api/v1/mcp');
    expect(service.getMcpResourceMetadataUrl!()).toContain('/.well-known/oauth-protected-resource');
  });

  it('should let getMcpResourceMetadataUrl report the OAuth track as off', () => {
    // `null` is the fail-closed answer: the embedded AS is disabled, or the
    // origin fails the OAuth 2.1 transport rule. API keys remain and nothing is
    // advertised. Distinct from the method being absent entirely.
    const service: IAuthService = {
      handleRequest: async () => new Response('OK'),
      verify: async () => ({ success: true }),
      getMcpResourceMetadataUrl: () => null,
    };

    expect(service.getMcpResourceMetadataUrl!()).toBeNull();
  });

  it('should allow an auth service with no MCP surface at all', () => {
    // Both are optional: an auth provider without MCP/OAuth support fills the
    // slot legitimately, and the `/mcp` route derives a URL from the request
    // host instead.
    const service: IAuthService = {
      handleRequest: async () => new Response('OK'),
      verify: async () => ({ success: true }),
    };

    expect(service.getMcpResourceUrl).toBeUndefined();
    expect(service.getMcpResourceMetadataUrl).toBeUndefined();
  });
});
