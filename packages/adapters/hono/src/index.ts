// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  type ObjectKernel,
  HttpDispatcher,
  HttpDispatcherResult,
} from '@objectstack/runtime';
import { readEnvWithDeprecation } from '@objectstack/types';

/**
 * Re-export the `Hono` type from the copy of `hono` this adapter owns.
 *
 * Downstream apps (e.g. the cloud control plane) only need the `Hono` TYPE to
 * annotate the app returned by {@link createHonoApp}. Importing it from here —
 * rather than adding their own `hono` dependency — guarantees there is exactly
 * ONE `hono` across the framework boundary, so the app's type matches without
 * any version-pinning / pnpm.overrides alignment dance. `hono` stays a normal
 * runtime dependency of THIS package, so standalone `os start` is unaffected.
 */
export type { Hono } from 'hono';

/**
 * Minimal structural interface matching KernelManager from @objectstack/service-cloud.
 * Declared locally to avoid a circular build dependency.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type KernelManager = any;

/**
 * Opaque reference to an EnvironmentDriverRegistry from @objectstack/service-cloud.
 * Declared locally to avoid a circular build dependency. Pass an instance
 * of DefaultEnvironmentDriverRegistry from @objectstack/service-cloud at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EnvironmentDriverRegistry = any;
import { createOriginMatcher, hasWildcardPattern } from '@objectstack/plugin-hono-server';

export interface ObjectStackHonoCorsOptions {
  /** Enable or disable CORS. Defaults to true. */
  enabled?: boolean;
  /** Allowed origins. Defaults to env `OS_CORS_ORIGIN` (or legacy `CORS_ORIGIN`) or '*'. Comma-separated string or array. */
  origin?: string | string[];
  /** Allowed methods. */
  methods?: string[];
  /** Allow credentials (cookies, authorization headers). */
  credentials?: boolean;
  /** Preflight cache max-age in seconds. */
  maxAge?: number;
  /** Allowed headers. */
  allowHeaders?: string[];
  /** Exposed headers. */
  exposeHeaders?: string[];
}

export interface ObjectStackHonoOptions {
  kernel: ObjectKernel;
  prefix?: string;
  /** CORS configuration. Set to `false` to disable entirely. */
  cors?: ObjectStackHonoCorsOptions | false;
  /**
   * @deprecated RETIRED (ADR-0006 Phase 5) — ignored. Multi-tenant routing is
   * owned by the host's `KernelResolver` (registered as the
   * `kernel-resolver` kernel service); the dispatcher picks it up there.
   */
  kernelManager?: KernelManager;
  /**
   * @deprecated RETIRED (ADR-0006 Phase 5) — ignored. Environment resolution
   * is owned by the host's `KernelResolver` (`kernel-resolver` service).
   */
  envRegistry?: EnvironmentDriverRegistry;
}

/**
 * Auth service interface with handleRequest method
 */
interface AuthService {
  handleRequest(request: Request): Promise<Response>;
}

/**
 * Middleware mode for existing Hono apps
 */
export function objectStackMiddleware(kernel: ObjectKernel) {
  return async (c: any, next: any) => {
    c.set('objectStack', kernel);
    await next();
  };
}

/**
 * Creates a full-featured Hono app with all ObjectStack route dispatchers.
 *
 * Only routes that need framework-specific handling (auth service, storage
 * formData, GraphQL raw result, discovery wrapper) are registered explicitly.
 * All other routes (meta, data, packages, analytics, automation, i18n, ui,
 * openapi, custom endpoints, and any future routes) are handled by a
 * catch-all that delegates to `HttpDispatcher.dispatch()`.
 *
 * This means new routes added to `HttpDispatcher` automatically work in
 * every adapter without any adapter-side code changes.
 *
 * @example
 * ```ts
 * import { createHonoApp } from '@objectstack/hono';
 * const app = createHonoApp({ kernel });
 * export default app;
 * ```
 */
export function createHonoApp(options: ObjectStackHonoOptions): Hono {
  const app = new Hono();
  const prefix = options.prefix || '/api';
  // ADR-0006 Phase 5: env resolution + multi-kernel routing belong to the
  // host's KernelResolver (the dispatcher resolves the `kernel-resolver`
  // service itself). The legacy envRegistry/kernelManager options are
  // accepted-but-ignored for source compatibility.
  const dispatcher = new HttpDispatcher(options.kernel);

  // ─── CORS Middleware ──────────────────────────────────────────────────────
  // Enabled by default. Controlled via options.cors or environment variables:
  //   OS_CORS_ENABLED     – "false" to disable (default: true)
  //   OS_CORS_ORIGIN      – comma-separated origins or "*" (default: "*")
  //   OS_CORS_CREDENTIALS – "false" to disallow credentials (default: true)
  //   OS_CORS_MAX_AGE     – preflight cache seconds (default: 86400)
  // (legacy CORS_* names still honoured with a deprecation warning)
  const corsDisabledByEnv = readEnvWithDeprecation('OS_CORS_ENABLED', 'CORS_ENABLED', { silent: true }) === 'false';
  if (options.cors !== false && !corsDisabledByEnv) {
    const corsOpts = typeof options.cors === 'object' ? options.cors : {};
    const enabled = corsOpts.enabled ?? true;

    if (enabled) {
      // Resolve origins: options > env > default '*'
      let configuredOrigin: string | string[];
      const corsOriginEnv = readEnvWithDeprecation('OS_CORS_ORIGIN', 'CORS_ORIGIN', { silent: true });
      if (corsOpts.origin) {
        configuredOrigin = corsOpts.origin;
      } else if (corsOriginEnv) {
        const envOrigin = corsOriginEnv.trim();
        configuredOrigin = envOrigin.includes(',') ? envOrigin.split(',').map(s => s.trim()) : envOrigin;
      } else {
        configuredOrigin = '*';
      }

      const credentials = corsOpts.credentials ?? (readEnvWithDeprecation('OS_CORS_CREDENTIALS', 'CORS_CREDENTIALS', { silent: true }) !== 'false');
      const maxAgeEnv = readEnvWithDeprecation('OS_CORS_MAX_AGE', 'CORS_MAX_AGE', { silent: true });
      const maxAge = corsOpts.maxAge ?? (maxAgeEnv ? parseInt(maxAgeEnv, 10) : 86400);

      // When credentials is true, browsers reject wildcard '*' for Access-Control-Allow-Origin.
      // For wildcard patterns (like "https://*.example.com" or "http://localhost:*") we must
      // use a matcher function — Hono's cors() middleware does exact-string matching only and
      // treats '*' in patterns as a literal character, so passing wildcard strings straight
      // through would silently drop the Access-Control-Allow-Origin header on every real
      // request (preflight can still succeed via apps/objectos's short-circuit, but the
      // subsequent POST/GET would be blocked by the browser).
      //
      // This mirrors `plugin-hono-server`'s CORS wiring and uses the shared pattern matcher
      // from `@objectstack/plugin-hono-server` so all Hono-based code paths stay in sync.
      let origin: string | string[] | ((origin: string) => string | undefined | null);
      if (configuredOrigin === '*' && credentials) {
        // Credentials mode with '*' — reflect the request origin
        origin = (requestOrigin: string) => requestOrigin || '*';
      } else if (hasWildcardPattern(configuredOrigin)) {
        // Wildcard patterns (e.g., "https://*.objectui.org", "http://localhost:*")
        origin = createOriginMatcher(configuredOrigin);
      } else {
        // Exact origin(s) — pass through as-is
        origin = configuredOrigin;
      }

      // Always include `set-auth-token` in exposed headers so that the
      // better-auth `bearer()` plugin (registered by plugin-auth) can
      // deliver rotated session tokens to cross-origin clients. Without
      // this, browsers strip the header from every response, the client
      // never sees the new token, and cross-origin sessions silently
      // break even when preflight and the actual request both succeed.
      //
      // This mirrors `plugin-hono-server`'s CORS wiring — all three
      // Hono-based CORS sites must stay in lockstep on this default.
      const defaultExposeHeaders = ['set-auth-token'];
      const exposeHeaders = Array.from(new Set([
        ...defaultExposeHeaders,
        ...(corsOpts.exposeHeaders ?? []),
      ]));

      app.use('*', cors({
        origin: origin as any,
        allowMethods: corsOpts.methods || ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
        // Keep in sync with plugin-hono-server's defaultAllowHeaders — `If-Match`
        // carries the OCC token on cross-origin record PATCHes (objectui#2572).
        allowHeaders: corsOpts.allowHeaders || ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Tenant-ID', 'X-Environment-Id', 'If-Match'],
        exposeHeaders,
        credentials,
        maxAge,
      }));
    }
  }

  const errorJson = (c: any, message: string, code: number = 500) => {
    return c.json({ success: false, error: { message, code } }, code);
  };

  const toResponse = (c: any, result: HttpDispatcherResult) => {
    if (result.handled) {
      if (result.response) {
        if (result.response.headers) {
          Object.entries(result.response.headers).forEach(([k, v]) => c.header(k, v as string));
        }
        return c.json(result.response.body, result.response.status);
      }
      if (result.result) {
        const res = result.result;
        if (res.type === 'redirect' && res.url) {
          return c.redirect(res.url);
        }
        if (res.type === 'stream' && res.events) {
          // SSE / Vercel Data Stream streaming response
          const headers: Record<string, string> = {
            'Content-Type': res.contentType || 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            ...(res.headers || {}),
          };
          const stream = new ReadableStream({
            async start(controller) {
              try {
                const encoder = new TextEncoder();
                for await (const event of res.events) {
                  const chunk = res.vercelDataStream
                    ? (typeof event === 'string' ? event : JSON.stringify(event) + '\n')
                    : `data: ${JSON.stringify(event)}\n\n`;
                  controller.enqueue(encoder.encode(chunk));
                }
              } catch (err) {
                // Stream error — close gracefully
              } finally {
                controller.close();
              }
            },
          });
          return new Response(stream, { status: 200, headers });
        }
        if (res.type === 'stream' && res.stream) {
          if (res.headers) {
            Object.entries(res.headers).forEach(([k, v]) => c.header(k, v as string));
          }
          return new Response(res.stream, { status: 200 });
        }
        return c.json(res, 200);
      }
    }
    return errorJson(c, 'Not Found', 404);
  };

  // ─── Explicit routes (framework-specific handling required) ────────────────

  // --- Discovery ---
  app.get(prefix, async (c) => {
    return c.json({ data: await dispatcher.getDiscoveryInfo(prefix) });
  });

  app.get(`${prefix}/discovery`, async (c) => {
    return c.json({ data: await dispatcher.getDiscoveryInfo(prefix) });
  });

  // --- .well-known ---
  app.get('/.well-known/objectstack', (c) => {
    return c.redirect(prefix);
  });

  // --- Auth (needs auth service integration) ---
  app.all(`${prefix}/auth/*`, async (c) => {
    try {
      const path = c.req.path.substring(`${prefix}/auth/`.length);
      const method = c.req.method;

      // Try AuthPlugin service first (prefer async to support factory-based services)
      let authService: AuthService | null = null;
      try {
        if (typeof options.kernel.getServiceAsync === 'function') {
          authService = await options.kernel.getServiceAsync<AuthService>('auth');
        } else if (typeof options.kernel.getService === 'function') {
          authService = options.kernel.getService<AuthService>('auth');
        }
      } catch {
        // Service not registered — fall through to dispatcher
        authService = null;
      }

      // Handle /auth/config endpoint specifically (not handled by better-auth)
      if (path === 'config' && method === 'GET' && authService) {
        try {
          const config = (authService as any).getPublicConfig?.();
          if (config) {
            // Refine the coarse "SSO wired" flag to "SSO usable" (≥1 provider
            // configured), mirroring the plugin-auth /config route. Guarded so
            // it's a safe no-op against an auth service predating the method.
            if (config.features?.sso && typeof (authService as any).isSsoUsable === 'function') {
              config.features.sso = await (authService as any).isSsoUsable();
            }
            return c.json({
              success: true,
              data: config,
            });
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          return c.json({
            success: false,
            error: {
              code: 'auth_config_error',
              message: err.message,
            },
          }, 500);
        }
      }

      if (authService && typeof authService.handleRequest === 'function') {
        const response = await authService.handleRequest(c.req.raw);
        return new Response(response.body, {
          status: response.status,
          headers: response.headers,
        });
      }

      // Fallback to legacy dispatcher
      const body = method === 'GET' || method === 'HEAD'
        ? {}
        : await c.req.json().catch(() => ({}));
      const result = await dispatcher.handleAuth(path, method, body, { request: c.req.raw });
      return toResponse(c, result);
    } catch (err: any) {
      return errorJson(c, err.message || 'Internal Server Error', err.statusCode || 500);
    }
  });

  // --- GraphQL (returns raw result, not HttpDispatcherResult) ---
  app.post(`${prefix}/graphql`, async (c) => {
    try {
      const body = await c.req.json();
      const result = await dispatcher.handleGraphQL(body, { request: c.req.raw });
      return c.json(result);
    } catch (err: any) {
      return errorJson(c, err.message || 'Internal Server Error', err.statusCode || 500);
    }
  });

  // --- Storage (needs formData parsing) ---
  app.all(`${prefix}/storage/*`, async (c) => {
    try {
      const subPath = c.req.path.substring(`${prefix}/storage`.length);
      const method = c.req.method;

      let file: any = undefined;
      if (method === 'POST' && subPath === '/upload') {
        const formData = await c.req.formData();
        file = formData.get('file');
      }

      const result = await dispatcher.handleStorage(subPath, method, file, { request: c.req.raw });
      return toResponse(c, result);
    } catch (err: any) {
      return errorJson(c, err.message || 'Internal Server Error', err.statusCode || 500);
    }
  });

  // ─── Catch-all: delegate to dispatcher.dispatch() ─────────────────────────
  // Handles meta, data, packages, analytics, automation, i18n, ui, openapi,
  // custom API endpoints, and any future routes added to HttpDispatcher.
  app.all(`${prefix}/*`, async (c) => {
    try {
      const subPath = c.req.path.substring(prefix.length);
      const method = c.req.method;

      let body: any = undefined;
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        body = await c.req.json().catch(() => ({}));
      }

      const queryParams: Record<string, any> = {};
      const url = new URL(c.req.url);
      url.searchParams.forEach((val, key) => { queryParams[key] = val; });

      const result = await dispatcher.dispatch(method, subPath, body, queryParams, { request: c.req.raw }, prefix);
      return toResponse(c, result);
    } catch (err: any) {
      return errorJson(c, err.message || 'Internal Server Error', err.statusCode || 500);
    }
  });

  return app;
}
