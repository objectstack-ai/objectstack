// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { Hono } from 'hono';

// Mock dispatcher instance accessible across tests
const mockDispatcher = {
  getDiscoveryInfo: vi.fn().mockReturnValue({ version: '1.0', endpoints: [] }),
  handleAuth: vi.fn().mockResolvedValue({ handled: true, response: { body: { ok: true }, status: 200 } }),
  handleGraphQL: vi.fn().mockResolvedValue({ data: {} }),
  handleStorage: vi.fn().mockResolvedValue({ handled: true, response: { body: {}, status: 200 } }),
  dispatch: vi.fn().mockResolvedValue({ handled: true, response: { body: { success: true }, status: 200 } }),
};

vi.mock('@objectstack/runtime', () => {
  return {
    HttpDispatcher: function HttpDispatcher() {
      return mockDispatcher;
    },
  };
});

import { objectStackMiddleware, createHonoApp } from './index';

const mockKernel = { name: 'test-kernel' } as any;

describe('objectStackMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets kernel on context via c.set', async () => {
    const app = new Hono();
    const middleware = objectStackMiddleware(mockKernel);

    app.use('*', middleware);
    app.get('/test', (c) => {
      const kernel = c.get('objectStack');
      return c.json({ hasKernel: !!kernel });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hasKernel).toBe(true);
  });

  it('calls next middleware', async () => {
    const app = new Hono();
    const middleware = objectStackMiddleware(mockKernel);
    const spy = vi.fn();

    app.use('*', middleware);
    app.use('*', async (_c, next) => {
      spy();
      await next();
    });
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
  });

  it('provides the correct kernel instance', async () => {
    const app = new Hono();
    const middleware = objectStackMiddleware(mockKernel);

    app.use('*', middleware);
    app.get('/test', (c) => {
      const kernel = c.get('objectStack');
      return c.json({ name: kernel.name });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe('test-kernel');
  });
});

describe('createHonoApp', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createHonoApp({ kernel: mockKernel });
  });

  describe('Discovery Endpoint', () => {
    it('GET /api returns discovery info', async () => {
      const res = await app.request('/api');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(json.data.version).toBe('1.0');
      expect(mockDispatcher.getDiscoveryInfo).toHaveBeenCalledWith('/api');
    });

    it('GET /api/discovery returns discovery info with correct prefix', async () => {
      const res = await app.request('/api/discovery');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(mockDispatcher.getDiscoveryInfo).toHaveBeenCalledWith('/api');
    });

    it('uses custom prefix for discovery', async () => {
      const customApp = createHonoApp({ kernel: mockKernel, prefix: '/v2' });
      const res = await customApp.request('/v2');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(mockDispatcher.getDiscoveryInfo).toHaveBeenCalledWith('/v2');
    });

    it('uses custom prefix for /discovery route', async () => {
      const customApp = createHonoApp({ kernel: mockKernel, prefix: '/v2' });
      const res = await customApp.request('/v2/discovery');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(mockDispatcher.getDiscoveryInfo).toHaveBeenCalledWith('/v2');
    });
  });

  describe('.well-known Endpoint', () => {
    it('GET /.well-known/objectstack redirects to prefix', async () => {
      const res = await app.request('/.well-known/objectstack', { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/api');
    });
  });

  describe('Auth Endpoint', () => {
    it('POST /api/auth/login calls handleAuth', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(mockDispatcher.handleAuth).toHaveBeenCalledWith(
        'login',
        'POST',
        { email: 'a@b.com' },
        expect.objectContaining({ request: expect.anything() }),
      );
    });

    it('GET /api/auth/callback calls handleAuth with empty body', async () => {
      const res = await app.request('/api/auth/callback');
      expect(res.status).toBe(200);
      expect(mockDispatcher.handleAuth).toHaveBeenCalledWith(
        'callback',
        'GET',
        {},
        expect.objectContaining({ request: expect.anything() }),
      );
    });

    it('returns error on handleAuth exception', async () => {
      mockDispatcher.handleAuth.mockRejectedValueOnce(
        Object.assign(new Error('Unauthorized'), { statusCode: 401 }),
      );
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toBe('Unauthorized');
    });
  });

  describe('Auth via AuthPlugin service', () => {
    it('uses kernel.getService("auth") when available', async () => {
      const mockHandleRequest = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ user: { id: '1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const kernelWithAuth = {
        ...mockKernel,
        getService: vi.fn().mockReturnValue({ handleRequest: mockHandleRequest }),
      };
      const authApp = createHonoApp({ kernel: kernelWithAuth });
      const res = await authApp.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', password: 'pass' }),
      });
      expect(res.status).toBe(200);
      expect(kernelWithAuth.getService).toHaveBeenCalledWith('auth');
      expect(mockHandleRequest).toHaveBeenCalled();
    });

    it('falls back to dispatcher when auth service is not available', async () => {
      const kernelWithoutAuth = {
        ...mockKernel,
        getService: vi.fn().mockReturnValue(null),
      };
      const authApp = createHonoApp({ kernel: kernelWithoutAuth });
      const res = await authApp.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com' }),
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.handleAuth).toHaveBeenCalled();
    });

    it('uses kernel.getServiceAsync("auth") when available (async factory)', async () => {
      const mockHandleRequest = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ user: { id: '2' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const kernelWithAsyncAuth = {
        ...mockKernel,
        getServiceAsync: vi.fn().mockResolvedValue({ handleRequest: mockHandleRequest }),
      };
      const authApp = createHonoApp({ kernel: kernelWithAsyncAuth });
      const res = await authApp.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', password: 'pass' }),
      });
      expect(res.status).toBe(200);
      expect(kernelWithAsyncAuth.getServiceAsync).toHaveBeenCalledWith('auth');
      expect(mockHandleRequest).toHaveBeenCalled();
    });

    it('falls back to dispatcher when getServiceAsync throws (async factory error)', async () => {
      const kernelWithFailingAsync = {
        ...mockKernel,
        getServiceAsync: vi.fn().mockRejectedValue(new Error("Service 'auth' not found")),
      };
      const authApp = createHonoApp({ kernel: kernelWithFailingAsync });
      const res = await authApp.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com' }),
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.handleAuth).toHaveBeenCalled();
    });
  });

  describe('GraphQL Endpoint', () => {
    it('POST /api/graphql calls handleGraphQL', async () => {
      const body = { query: '{ objects { name } }' };
      const res = await app.request('/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(mockDispatcher.handleGraphQL).toHaveBeenCalledWith(
        body,
        expect.objectContaining({ request: expect.anything() }),
      );
    });

    it('returns error on handleGraphQL exception', async () => {
      mockDispatcher.handleGraphQL.mockRejectedValueOnce(new Error('Parse error'));
      const res = await app.request('/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'bad' }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toBe('Parse error');
    });
  });

  describe('Catch-all Dispatch', () => {
    it('GET /api/meta/objects delegates to dispatch()', async () => {
      const res = await app.request('/api/meta/objects');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/meta/objects',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });

    it('PUT /api/meta/objects parses JSON body via dispatch()', async () => {
      const body = { name: 'test_object' };
      const res = await app.request('/api/meta/objects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'PUT',
        '/meta/objects',
        body,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });

    it('GET /api/meta with no trailing path', async () => {
      const res = await app.request('/api/meta');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/meta',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });

    it('forwards query parameters through dispatch()', async () => {
      const res = await app.request('/api/meta/objects?package=com.acme.crm');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/meta/objects',
        undefined,
        expect.objectContaining({ package: 'com.acme.crm' }),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });

    it('GET /api/data/account delegates to dispatch()', async () => {
      const res = await app.request('/api/data/account');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/data/account',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });

    it('POST /api/data/account parses JSON body', async () => {
      const body = { name: 'Acme' };
      const res = await app.request('/api/data/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'POST',
        '/data/account',
        body,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });

    it('PATCH /api/data/account parses JSON body', async () => {
      const body = { name: 'Updated' };
      const res = await app.request('/api/data/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'PATCH',
        '/data/account',
        body,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });

    it('returns 404 when dispatch result is not handled', async () => {
      mockDispatcher.dispatch.mockResolvedValueOnce({ handled: false });
      const res = await app.request('/api/data/missing');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('GET /api/packages delegates to dispatch()', async () => {
      const res = await app.request('/api/packages');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/packages',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });

    it('GET /api/packages/:id delegates to dispatch()', async () => {
      const res = await app.request('/api/packages/com.acme.crm');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/packages/com.acme.crm',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });

    it('POST /api/packages parses JSON body', async () => {
      const body = { manifest: { name: 'test-pkg' } };
      const res = await app.request('/api/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'POST',
        '/packages',
        body,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });

    it('GET /api/packages?status=active forwards query params', async () => {
      const res = await app.request('/api/packages?status=active');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/packages',
        undefined,
        expect.objectContaining({ status: 'active' }),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });

    it('returns error on dispatch exception', async () => {
      mockDispatcher.dispatch.mockRejectedValueOnce(new Error('Service unavailable'));
      const res = await app.request('/api/packages');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toBe('Service unavailable');
    });

    it('GET /api/analytics delegates to dispatch()', async () => {
      const res = await app.request('/api/analytics');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/analytics',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });

    it('GET /api/automation delegates to dispatch()', async () => {
      const res = await app.request('/api/automation');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/automation',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });

    it('GET /api/i18n delegates to dispatch()', async () => {
      const res = await app.request('/api/i18n');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/i18n',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });

    it('GET /api/ui/view/account delegates to dispatch()', async () => {
      const res = await app.request('/api/ui/view/account');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/ui/view/account',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api',
      );
    });
  });

  describe('Error Handling', () => {
    it('returns 500 with default message on generic error', async () => {
      mockDispatcher.dispatch.mockRejectedValueOnce(new Error());
      const res = await app.request('/api/data/account');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toBe('Internal Server Error');
    });

    it('uses custom statusCode from error', async () => {
      mockDispatcher.dispatch.mockRejectedValueOnce(
        Object.assign(new Error('Forbidden'), { statusCode: 403 }),
      );
      const res = await app.request('/api/data/account');
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.message).toBe('Forbidden');
    });
  });

  describe('toResponse', () => {
    it('handles redirect result', async () => {
      mockDispatcher.dispatch.mockResolvedValueOnce({
        handled: true,
        result: { type: 'redirect', url: 'https://example.com' },
      });
      const res = await app.request('/api/data/redir', { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://example.com');
    });

    it('handles generic result objects with 200 status', async () => {
      mockDispatcher.dispatch.mockResolvedValueOnce({
        handled: true,
        result: { foo: 'bar' },
      });
      const res = await app.request('/api/data/custom');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.foo).toBe('bar');
    });

    it('sets custom headers from response', async () => {
      mockDispatcher.dispatch.mockResolvedValueOnce({
        handled: true,
        response: { status: 201, body: { id: 1 }, headers: { 'X-Custom': 'yes' } },
      });
      const res = await app.request('/api/data/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });
      expect(res.status).toBe(201);
      expect(res.headers.get('X-Custom')).toBe('yes');
      const json = await res.json();
      expect(json.id).toBe(1);
    });
  });

  describe('Vercel Delegation Pattern (api/index.ts → inner.fetch)', () => {
    /**
     * Helper: creates the same outer→inner delegation pattern used by
     * `apps/studio/api/index.ts`.  The outer Hono app delegates all
     * requests to the inner ObjectStack Hono app via `inner.fetch()`.
     */
    function createVercelApp() {
      const innerApp = createHonoApp({ kernel: mockKernel, prefix: '/api/v1' });
      const outerApp = new Hono();
      outerApp.all('*', async (c) => {
        return innerApp.fetch(c.req.raw);
      });
      return outerApp;
    }

    it('works when an outer Hono app delegates via inner.fetch(c.req.raw)', async () => {
      const outerApp = createVercelApp();

      const res = await outerApp.request('/api/v1/meta');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/meta',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api/v1',
      );
    });

    it('routes /api/v1/packages through outer→inner delegation', async () => {
      const outerApp = createVercelApp();

      const res = await outerApp.request('/api/v1/packages');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/packages',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api/v1',
      );
    });

    it('routes /api/v1 discovery through outer→inner delegation', async () => {
      const outerApp = createVercelApp();

      const res = await outerApp.request('/api/v1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(mockDispatcher.getDiscoveryInfo).toHaveBeenCalledWith('/api/v1');
    });

    it('routes /api/v1/discovery through outer→inner delegation with correct prefix', async () => {
      const outerApp = createVercelApp();

      const res = await outerApp.request('/api/v1/discovery');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(mockDispatcher.getDiscoveryInfo).toHaveBeenCalledWith('/api/v1');
    });

    it('routes /api/v1/data/account through outer→inner delegation', async () => {
      const outerApp = createVercelApp();

      const res = await outerApp.request('/api/v1/data/account');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/data/account',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api/v1',
      );
    });

    it('POST /api/v1/data/account parses JSON body through outer→inner delegation', async () => {
      const outerApp = createVercelApp();
      const body = { name: 'Acme' };

      const res = await outerApp.request('/api/v1/data/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'POST',
        '/data/account',
        body,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api/v1',
      );
    });

    it('PUT /api/v1/data/account parses JSON body through outer→inner delegation', async () => {
      const outerApp = createVercelApp();
      const body = { name: 'Updated' };

      const res = await outerApp.request('/api/v1/data/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'PUT',
        '/data/account',
        body,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api/v1',
      );
    });

    it('PATCH /api/v1/data/account parses JSON body through outer→inner delegation', async () => {
      const outerApp = createVercelApp();
      const body = { name: 'Patched' };

      const res = await outerApp.request('/api/v1/data/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'PATCH',
        '/data/account',
        body,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api/v1',
      );
    });

    it('DELETE /api/v1/data/account routes through outer→inner delegation', async () => {
      const outerApp = createVercelApp();

      const res = await outerApp.request('/api/v1/data/account', {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'DELETE',
        '/data/account',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api/v1',
      );
    });

    it('returns 500 with error details when inner app throws', async () => {
      const outerApp = new Hono();

      outerApp.all('*', async (c) => {
        try {
          // Simulate a kernel boot failure
          throw new Error('Kernel boot failed');
        } catch (err: any) {
          return c.json(
            { success: false, error: { message: err.message, code: 500 } },
            500,
          );
        }
      });

      const res = await outerApp.request('/api/v1/meta');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toBe('Kernel boot failed');
    });
  });

  describe('Body-safe Vercel delegation (buffered body forwarding)', () => {
    /**
     * Validates the body-safe delegation pattern used in
     * `apps/studio/server/index.ts` where the outer handler buffers
     * POST/PUT/PATCH bodies and creates a fresh `Request` for the inner app.
     * This avoids @hono/node-server's lazy body materialisation which can
     * hang on Vercel when the IncomingMessage stream state has changed.
     */
    function createBodySafeVercelApp() {
      const innerApp = createHonoApp({ kernel: mockKernel, prefix: '/api/v1' });
      const outerApp = new Hono();

      outerApp.all('*', async (c) => {
        const method = c.req.method;

        // GET/HEAD have no body — pass through directly
        if (method === 'GET' || method === 'HEAD') {
          return innerApp.fetch(c.req.raw);
        }

        // Buffer body and create a fresh Request
        const rawReq = c.req.raw;
        const body = await rawReq.arrayBuffer();
        const forwarded = new Request(rawReq.url, {
          method,
          headers: rawReq.headers,
          body,
        });
        return innerApp.fetch(forwarded);
      });

      return outerApp;
    }

    it('GET requests work without body buffering', async () => {
      const outerApp = createBodySafeVercelApp();

      const res = await outerApp.request('/api/v1/data/account');
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'GET',
        '/data/account',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api/v1',
      );
    });

    it('POST body is forwarded correctly via buffered delegation', async () => {
      const outerApp = createBodySafeVercelApp();
      const body = { name: 'Acme Corp' };

      const res = await outerApp.request('/api/v1/data/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'POST',
        '/data/account',
        body,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api/v1',
      );
    });

    it('PUT body is forwarded correctly via buffered delegation', async () => {
      const outerApp = createBodySafeVercelApp();
      const body = { name: 'Updated Corp' };

      const res = await outerApp.request('/api/v1/data/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'PUT',
        '/data/account',
        body,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api/v1',
      );
    });

    it('PATCH body is forwarded correctly via buffered delegation', async () => {
      const outerApp = createBodySafeVercelApp();
      const body = { status: 'active' };

      const res = await outerApp.request('/api/v1/data/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'PATCH',
        '/data/account',
        body,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api/v1',
      );
    });

    it('DELETE without body works via buffered delegation', async () => {
      const outerApp = createBodySafeVercelApp();

      const res = await outerApp.request('/api/v1/data/account', {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'DELETE',
        '/data/account',
        undefined,
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api/v1',
      );
    });

    it('POST with empty body defaults to {} via buffered delegation', async () => {
      const outerApp = createBodySafeVercelApp();

      const res = await outerApp.request('/api/v1/data/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });
      expect(res.status).toBe(200);
      // Empty body falls back to {} via .catch(() => ({})) in the adapter
      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        'POST',
        '/data/account',
        {},
        expect.any(Object),
        expect.objectContaining({ request: expect.anything() }),
        '/api/v1',
      );
    });
  });

  describe('Vercel deployment endpoint smoke tests', () => {
    /**
     * These tests validate that the two key deployment-health endpoints
     * `/api/v1/meta` and `/api/v1/packages` return 200 OK when routed
     * through the Vercel adapter pattern (outer Hono → inner ObjectStack Hono).
     */
    let outerApp: Hono;

    beforeEach(() => {
      vi.clearAllMocks();
      const innerApp = createHonoApp({ kernel: mockKernel, prefix: '/api/v1' });
      outerApp = new Hono();
      outerApp.all('*', async (c) => innerApp.fetch(c.req.raw));
    });

    it('GET /api/v1/meta returns 200 OK', async () => {
      const res = await outerApp.request('/api/v1/meta');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('GET /api/v1/meta/object returns 200 OK', async () => {
      const res = await outerApp.request('/api/v1/meta/object');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('GET /api/v1/packages returns 200 OK', async () => {
      const res = await outerApp.request('/api/v1/packages');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('GET /api/v1/packages/:id returns 200 OK', async () => {
      const res = await outerApp.request('/api/v1/packages/com.acme.crm');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });
  });

  describe('CORS wildcard origin patterns', () => {
    const ORIG_CORS_ORIGIN = process.env.OS_CORS_ORIGIN;
    const ORIG_CORS_CREDENTIALS = process.env.OS_CORS_CREDENTIALS;

    beforeEach(() => {
      delete process.env.OS_CORS_ORIGIN;
      delete process.env.OS_CORS_CREDENTIALS;
    });

    afterAll(() => {
      if (ORIG_CORS_ORIGIN === undefined) delete process.env.OS_CORS_ORIGIN;
      else process.env.OS_CORS_ORIGIN = ORIG_CORS_ORIGIN;
      if (ORIG_CORS_CREDENTIALS === undefined) delete process.env.OS_CORS_CREDENTIALS;
      else process.env.OS_CORS_CREDENTIALS = ORIG_CORS_CREDENTIALS;
    });

    it('matches subdomain wildcard (https://*.example.com) for real subdomains', async () => {
      process.env.OS_CORS_ORIGIN = 'https://*.example.com';
      const app = createHonoApp({ kernel: mockKernel, prefix: '/api/v1' });

      const res = await app.request('/api/v1/meta', {
        method: 'GET',
        headers: { Origin: 'https://app.example.com' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    });

    it('matches port wildcard (http://localhost:*) for any localhost port', async () => {
      process.env.OS_CORS_ORIGIN = 'http://localhost:*';
      const app = createHonoApp({ kernel: mockKernel, prefix: '/api/v1' });

      const res = await app.request('/api/v1/meta', {
        method: 'GET',
        headers: { Origin: 'http://localhost:5173' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    });

    it('matches the correct pattern from a comma-separated wildcard list', async () => {
      process.env.OS_CORS_ORIGIN =
        'https://*.objectui.org,https://*.objectstack.ai,http://localhost:*';
      const app = createHonoApp({ kernel: mockKernel, prefix: '/api/v1' });

      const res = await app.request('/api/v1/meta', {
        method: 'GET',
        headers: { Origin: 'https://studio.objectstack.ai' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://studio.objectstack.ai');
    });

    it('rejects origins that do not match any wildcard pattern', async () => {
      process.env.OS_CORS_ORIGIN = 'https://*.example.com';
      const app = createHonoApp({ kernel: mockKernel, prefix: '/api/v1' });

      const res = await app.request('/api/v1/meta', {
        method: 'GET',
        headers: { Origin: 'https://evil.com' },
      });
      // Hono's cors() returns no allow-origin header when the matcher rejects
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('responds to preflight OPTIONS with matched wildcard origin', async () => {
      process.env.OS_CORS_ORIGIN = 'https://*.objectui.org';
      const app = createHonoApp({ kernel: mockKernel, prefix: '/api/v1' });

      const res = await app.request('/api/v1/meta', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.objectui.org',
          'Access-Control-Request-Method': 'POST',
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://app.objectui.org');
    });
  });

  describe('CORS expose-headers defaults', () => {
    // `set-auth-token` must always be exposed so the better-auth bearer()
    // plugin can deliver rotated session tokens to cross-origin clients.
    // This mirrors plugin-hono-server's CORS wiring — all three Hono-based
    // CORS sites must stay in lockstep on this default.
    const ORIG_CORS_ORIGIN = process.env.OS_CORS_ORIGIN;

    beforeEach(() => {
      delete process.env.OS_CORS_ORIGIN;
    });

    afterAll(() => {
      if (ORIG_CORS_ORIGIN === undefined) delete process.env.OS_CORS_ORIGIN;
      else process.env.OS_CORS_ORIGIN = ORIG_CORS_ORIGIN;
    });

    it('always exposes set-auth-token by default', async () => {
      const app = createHonoApp({ kernel: mockKernel, prefix: '/api/v1' });

      const res = await app.request('/api/v1/meta', {
        method: 'GET',
        headers: { Origin: 'https://app.example.com' },
      });
      const exposed = res.headers.get('access-control-expose-headers') || '';
      expect(exposed.toLowerCase()).toContain('set-auth-token');
    });

    it('merges user-supplied exposeHeaders with set-auth-token (does not replace)', async () => {
      const app = createHonoApp({
        kernel: mockKernel,
        prefix: '/api/v1',
        cors: { exposeHeaders: ['X-Custom-Header'] },
      });

      const res = await app.request('/api/v1/meta', {
        method: 'GET',
        headers: { Origin: 'https://app.example.com' },
      });
      const exposed = (res.headers.get('access-control-expose-headers') || '').toLowerCase();
      expect(exposed).toContain('set-auth-token');
      expect(exposed).toContain('x-custom-header');
    });

    it('does not duplicate set-auth-token when user also supplies it', async () => {
      const app = createHonoApp({
        kernel: mockKernel,
        prefix: '/api/v1',
        cors: { exposeHeaders: ['set-auth-token', 'X-Other'] },
      });

      const res = await app.request('/api/v1/meta', {
        method: 'GET',
        headers: { Origin: 'https://app.example.com' },
      });
      const exposed = (res.headers.get('access-control-expose-headers') || '').toLowerCase();
      const occurrences = exposed.split(',').map(s => s.trim()).filter(s => s === 'set-auth-token');
      expect(occurrences.length).toBe(1);
      expect(exposed).toContain('x-other');
    });
  });
});
