// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  type ObjectKernel,
  HttpDispatcher,
  HttpDispatcherResult,
} from '@objectstack/runtime';
import {
  readEnvWithDeprecation,
  looksLikeInternalErrorLeak,
  INTERNAL_ERROR_MESSAGE,
  resolveThrownHttpError,
} from '@objectstack/types';

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
import {
  createOriginMatcher,
  hasWildcardPattern,
  DEFAULT_CORS_ALLOW_HEADERS,
  DEFAULT_CORS_EXPOSE_HEADERS,
} from '@objectstack/plugin-hono-server';

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
 * Only routes that need framework-specific handling (auth service, GraphQL
 * raw result, discovery wrapper) are registered explicitly.
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

      // Both CORS defaults are imported from `@objectstack/plugin-hono-server`,
      // which this package already depends on (#3786). The three Hono-based CORS
      // sites used to carry their own copies under "keep in sync" comments — this
      // one included, right down to a duplicate of the rationale below.
      //
      // `set-auth-token` is the load-bearing one to understand: without it in the
      // exposed set, browsers strip the header from every response, the client
      // never sees its rotated session token, and cross-origin sessions silently
      // break even though preflight and the request both succeed.
      const exposeHeaders = Array.from(new Set([
        ...DEFAULT_CORS_EXPOSE_HEADERS,
        ...(corsOpts.exposeHeaders ?? []),
      ]));

      app.use('*', cors({
        origin: origin as any,
        allowMethods: corsOpts.methods || ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
        allowHeaders: corsOpts.allowHeaders || [...DEFAULT_CORS_ALLOW_HEADERS],
        exposeHeaders,
        credentials,
        maxAge,
      }));
    }
  }

  /**
   * This mount's shared refusal body, in the envelope `BaseResponseSchema`
   * declares.
   *
   * `error.code` is the SEMANTIC slot: `ApiErrorSchema.code` is a closed
   * STRING vocabulary (`StandardErrorCode` ∪ the ledger — ADR-0112 D3/D4).
   * This helper used to write the HTTP **status** into it — `{ message, code }`
   * with `code` the same number handed to `c.json` as the status — so every
   * refusal from this adapter shipped `error.code: 404` / `500` where callers
   * were promised a code they could branch on, and the body failed its own
   * contract while looking correctly nested. That is #3842's drift, one door
   * over.
   *
   * The status→member mapping is NOT re-spelled here. `resolveThrownHttpError`
   * (`@objectstack/types`) is the one rule both the REST and dispatcher doors
   * read for this question (ADR-0112, #9106), and it derives the standard
   * member from the status whenever the producer declared no registered code
   * of its own — so routing through it keeps this third door from becoming a
   * fourth dialect. The numeric status stays where it is authoritative: the
   * response line.
   *
   * The parameter is named `status`, not `code`, and that is load-bearing
   * rather than cosmetic: `scripts/check-route-envelope.mjs` flags an
   * `error.code` shorthand whose identifier is the SAME one passed as the
   * status argument — precisely the shape this file shipped — so the old name
   * would keep the counter alive even with the value fixed.
   */
  const errorJson = (c: any, message: string, status: number = 500) => {
    const { code } = resolveThrownHttpError({ status }, status);
    return c.json({ success: false, error: { code, message } }, status);
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

  /**
   * Hand a path THIS mount does not own to whatever else matched (#4117).
   *
   * The `${prefix}/auth/*` mount below claims a whole namespace and used to be
   * TERMINAL — it answered 404 for a path its auth service does not implement.
   * That is #4088's shape, which cost four fixes before #4116's scan started
   * enumerating it, and it is what #4087/#4112 had already concluded about the
   * `/storage` bridge it deleted: "the wildcard was wider than the two routes it
   * served".
   *
   * What yielding buys HERE is narrower than in #4092, and worth stating so
   * nobody over-reads it. It does NOT make a later-registered Hono route
   * reachable: the `${prefix}/*` dispatcher catch-all below is DELIBERATELY
   * terminal (ADR-0076 OQ#9, #3576/#3608 — the gate stages live inside
   * `dispatch()`), so it would swallow such a route either way, and mounting Hono
   * routes is not this adapter's extension path anyway. It means an unowned
   * `/auth/*` path now reaches that gated `dispatch()` instead of dead-ending in
   * a 404 built one mount earlier, so a domain handler registered for it becomes
   * reachable — which IS the adapter's mechanism.
   *
   * `c.res = …` rather than `return …`: `app.use('*', cors(…))` above puts a
   * middleware in this chain, and Hono's compose only assigns a handler's
   * RETURNED Response while `c.finalized` is false. Reaching the end of the chain
   * runs notFound, which sets a response and flips that flag, so a `return` here
   * is silently dropped (learned the hard way in #4092).
   */
  const yieldUnowned = async (c: any, next: any, fallback: () => Response) => {
    await next();
    if (!c.res) c.res = fallback();
  };

  // --- Auth (needs auth service integration) ---
  app.all(`${prefix}/auth/*`, async (c, next) => {
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
          // [#3867 follow-up] Same guard the two dispatcher error exits apply.
          // This is a 500 built from a caught error, and the auth service reads
          // from the database, so its message can carry a driver dump. Only the
          // leak case is replaced — an ordinary config error still names itself.
          return c.json({
            success: false,
            error: {
              code: 'AUTH_CONFIG_ERROR',
              message: looksLikeInternalErrorLeak(err.message)
                ? INTERNAL_ERROR_MESSAGE
                : err.message,
            },
          }, 500);
        }
      }

      if (authService && typeof authService.handleRequest === 'function') {
        const response = await authService.handleRequest(c.req.raw);
        const forwarded = () => new Response(response.body, {
          status: response.status,
          headers: response.headers,
        });
        // 404 from better-auth means "not one of my endpoints" — the #4092
        // signal. `/auth/me/permissions` is the canonical example: nothing in
        // better-auth serves it, `plugin-hono-server` does.
        if (response.status === 404) return yieldUnowned(c, next, forwarded);
        return forwarded();
      }

      // Fallback to legacy dispatcher
      const body = method === 'GET' || method === 'HEAD'
        ? {}
        : await c.req.json().catch(() => ({}));
      const result = await dispatcher.handleAuth(path, method, body, { request: c.req.raw });
      // `handled: false` is the dispatcher saying no auth domain claimed it —
      // an explicit ownership signal, better than inferring one from a status.
      if (!result.handled) return yieldUnowned(c, next, () => toResponse(c, result));
      return toResponse(c, result);
    } catch (err: any) {
      return errorJson(c, err.message || 'Internal Server Error', err.statusCode || 500);
    }
  });

  // --- Storage: deliberately NOT mounted (#4087) ---
  // This used to be `app.all(prefix + '/storage/*')` feeding
  // `dispatcher.handleStorage`. Two things were wrong with it. The handler it
  // called spoke a storage contract that does not exist (it passed the parsed
  // file as the `key` argument of `upload(key, data, options?)`, and read the
  // Buffer that `download(key)` resolves as a `{ url | stream }` descriptor) —
  // retired with this change. And the wildcard was wider than the two routes
  // it served: it claimed the WHOLE `/storage` subtree, so every other path
  // under it — the presigned / chunked / signed-URL protocol `service-storage`
  // registers, above all — was answered by the bridge's own 404 instead of
  // falling through to anything else this app might mount. Storage is ordinary
  // catch-all traffic now, like every other domain.

  // ─── Catch-all: delegate to dispatcher.dispatch() ─────────────────────────
  // Handles meta, data, packages, analytics, automation, i18n, ui, openapi,
  // custom API endpoints, and any future routes added to HttpDispatcher.
  //
  // DELIBERATE SHAPE — read before "improving" this into explicit per-prefix
  // mounts (ADR-0076 OQ#9 verdict, #3576 / #3608): dispatch() is a thin
  // gates+registry pipeline (env resolution → identity → auth gate →
  // membership → scope strip, then a first-match DomainHandlerRegistry
  // lookup — enumerable via registry.list()). A naive split into
  // `app.all(prefix + domain + '/*')` mounts bypasses those cross-cutting
  // gate stages (the #2852 RLS-leak class: handlers running without an
  // ExecutionContext). Revisit only if the gate stages are middleware-ized
  // for an independent reason — reopen conditions are archived on #3608.
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
