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
export type KernelManager = any;

/**
 * Opaque reference to an EnvironmentDriverRegistry from @objectstack/service-cloud.
 * Declared locally to avoid a circular build dependency. Pass an instance
 * of DefaultEnvironmentDriverRegistry from @objectstack/service-cloud at runtime.
 */
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
  /**
   * Does the auth service's OWN router serve this path? (#15928)
   *
   * Optional on purpose: this is a structural interface over whatever the
   * kernel registered as the `auth` service, and an implementation predating
   * the method must keep working. `AuthPlugin`'s `AuthManager` implements it
   * (#15417 / PR #15918) by asking better-auth's live `auth.api` — the same
   * seam the route ledger's conformance test and the `/admin/` dogfood sweep
   * read. It answers on better-auth's endpoint-path spelling derived from the
   * AUTH SERVICE's configured `basePath`, not from this adapter's `prefix`,
   * so a deployment whose two disagree gets `false` for everything — the
   * yielding, pre-#15928 answer, which is the safe direction.
   *
   * [#16025] That disagreement is what the mount itself now avoids: it is
   * derived from the same `basePath` (see `resolveAuthMount`), so on every
   * service that answers `getBasePath` the request this predicate is asked
   * about is already under the base it answers on.
   */
  ownsRoute?(request: Request): Promise<boolean>;
  /**
   * Where does this service's OWN router serve, i.e. what did it configure as
   * its `basePath`? (#16025)
   *
   * Optional for the same reason `ownsRoute` is: this is a structural
   * interface over whatever the kernel registered as `auth`, and an
   * implementation predating the accessor must keep working. `AuthPlugin`'s
   * `AuthManager` implements it, returning the very string it hands
   * better-auth. A service that does not answer leaves the mount where it was
   * before this card — see `resolveAuthMount`.
   */
  getBasePath?(): string;
}

/**
 * The auth service's configured `basePath`, read at app-construction time, or
 * `undefined` when there is nothing to read. (#16025)
 *
 * ## Why the SYNC accessor
 *
 * `createHonoApp` is synchronous and returns a mounted `Hono`, so the mount
 * path has to be decided before any request exists. `kernel.getService` is the
 * synchronous registry lookup; measured on a real boot it returns the very
 * same `AuthManager` instance `getServiceAsync` resolves. It throws for a
 * FACTORY-registered service that has not been instantiated ("is async - use
 * await") exactly as it throws for a service nobody registered — both are
 * "cannot read it here", and both land on the pre-#16025 mount rather than on
 * a guess.
 *
 * ⛔ Every non-string, every throw and every empty answer is `undefined`. This
 * function can only ever MOVE the mount onto an answer the auth service gave;
 * it can never invent one.
 */
function readAuthBasePath(kernel: ObjectKernel): string | undefined {
  let service: AuthService | null | undefined;
  try {
    const getService = (kernel as any)?.getService;
    if (typeof getService !== 'function') return undefined;
    service = getService.call(kernel, 'auth') as AuthService | null | undefined;
  } catch {
    return undefined;
  }
  if (!service || typeof service.getBasePath !== 'function') return undefined;
  let raw: unknown;
  try {
    raw = service.getBasePath();
  } catch {
    return undefined;
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '/') return undefined;
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalised = withSlash.replace(/\/+$/, '');
  return normalised === '' ? undefined : normalised;
}

/** Is `path` the namespace `prefix` names, or something inside it? */
function isUnderPrefix(path: string, prefix: string): boolean {
  const base = prefix.replace(/\/+$/, '');
  if (base === '') return true;
  return path === base || path.startsWith(`${base}/`);
}

/**
 * The fixes the refusal offers, each one CHECKED against the same predicate the
 * refusal itself uses — because a `Fix:` line that does not fix is a false
 * sentence in shipped code, and the first spelling of this message carried two.
 *
 * Two directions, and the caller picks:
 *
 *   A — move the app UP to the namespace the base already sits in. Offered only
 *       when that parent is a USABLE prefix. The parent of a single-segment base
 *       such as `/auth` is `''`, which `createHonoApp` coerces straight back to
 *       `/api` (`options.prefix || '/api'`), and the `'/'` that reads as its
 *       equivalent mounts every OTHER route of the app under `//` — measured
 *       404 for everything. Suggesting either is advice that does not work, and
 *       `'/'` is exactly what the first spelling suggested.
 *   B — move better-auth DOWN under the prefix the caller asked for. Always
 *       available, but only with a prefix carrying a LEADING SLASH: a base path
 *       is normalised to start with one and `isUnderPrefix` compares the two as
 *       written, so NO base path can sit inside a prefix spelled `api/v1`. The
 *       first spelling suggested `new AuthPlugin({ basePath: 'api/v1/auth' })`
 *       for exactly that prefix, and it refuses again.
 *
 * ⛔ This changes what the refusal SAYS, never which compositions it refuses.
 */
function authMountFixes(basePath: string, prefix: string): string[] {
  const fixes: string[] = [];

  const parent = basePath.split('/').slice(0, -1).join('/');
  if (parent !== '' && isUnderPrefix(basePath, parent)) {
    fixes.push(`pass a prefix the base path sits under (createHonoApp({ kernel, prefix: '${parent}' }))`);
  }

  const rooted = (prefix.startsWith('/') ? prefix : `/${prefix}`).replace(/\/+$/, '');
  const candidate = `${rooted}/auth`;
  if (isUnderPrefix(candidate, rooted)) {
    fixes.push(
      prefix.startsWith('/')
        ? `configure the auth service to serve under this prefix (new AuthPlugin({ basePath: '${candidate}' }))`
        : `spell the prefix with a leading slash and configure the auth service under it ` +
          `(createHonoApp({ kernel, prefix: '${rooted}' }) with new AuthPlugin({ basePath: '${candidate}' })) — ` +
          `a base path always starts with '/', so it can never sit inside a prefix that does not`,
    );
  }

  return fixes;
}

/**
 * Where the `/auth/*` mount goes, and the boot refusal that guards it (#16025).
 *
 * ## B — the mount FOLLOWS THE AUTH SERVICE
 *
 * Maintainer ruling of 2026-09-06 (director batch #54), options A + B. The
 * mount is derived from the auth service's own `basePath`, not from this
 * adapter's `prefix`, because the two defaults do not compose and the failure
 * was invisible. Measured on a real boot through this adapter, before the fix,
 * with the documented embed `createHonoApp({ kernel })`:
 *
 *     POST /api/auth/sign-in/email  (valid shape, wrong password)  ->  200 {}
 *     GET  /api/auth/get-session                                   ->  200 {}
 *     POST /api/auth/sign-up/email                                 ->  200 {}
 *
 * — while the same boot answered the auth service directly at its own base:
 *
 *     POST /api/v1/auth/delete-user  ->  401 {"message":"Unauthorized","code":"UNAUTHORIZED"}
 *
 * A failed sign-in answering `200 {}` is the silent-success shape: a client
 * reading `res.ok` sends the user into an authenticated view with no session.
 * ⛔ Neither default moves — options C and D were rejected in the same ruling.
 *
 * ## A — and a MISALIGNED prefix refuses out loud
 *
 * Following the auth service makes the two line up by construction whenever
 * the base sits inside the namespace the host asked for, which is true of both
 * defaults (`/api/v1/auth` is under `/api`). It does NOT when a caller passes
 * a `prefix` the base is outside of: the auth surface would then be served
 * outside the namespace the host mounted, and `${prefix}/auth/*` would be
 * answered by the terminal dispatcher catch-all — the `200 {}` above. That is
 * the one combination this function refuses, naming both values, because the
 * ruling's floor is that no combination may fail silently.
 *
 * ⚠️ Residual, recorded rather than implied: an auth service that does not
 * answer `getBasePath` keeps the pre-#16025 mount and buys no refusal, because
 * nothing here can tell an aligned custom service from a misaligned one. That
 * is the behaviour before this change, not a new one.
 */
function resolveAuthMount(kernel: ObjectKernel, prefix: string): string {
  const basePath = readAuthBasePath(kernel);
  if (basePath === undefined) return `${prefix}/auth`;
  if (!isUnderPrefix(basePath, prefix)) {
    throw new Error(
      `[@objectstack/hono] createHonoApp cannot mount the auth surface: the auth service serves ` +
        `better-auth under basePath "${basePath}", which is not inside this app's prefix "${prefix}". ` +
        `Mounting it anyway would put auth outside the namespace this app was given, and every request to ` +
        `"${prefix}/auth/*" would be answered by the dispatcher catch-all instead — a 200 with an empty body, ` +
        `which reads as success on a failed sign-in. Fix — ` +
        `${authMountFixes(basePath, prefix).join('; or ')}.`,
    );
  }
  return basePath;
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
 * Only routes that need framework-specific handling (auth service,
 * discovery wrapper) are registered explicitly.
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
  // [#16025] Where `/auth/*` is mounted, and the boot refusal that guards it.
  // Computed BEFORE any route is registered so a misaligned composition never
  // gets a half-built app: see `resolveAuthMount` for the ruling and the
  // measurement.
  const authMount = resolveAuthMount(options.kernel, prefix);
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
      // request (preflight can still succeed via the short-circuit in `apps/objectos`,
      // which lives in the separate `objectstack-ai/cloud` repo and is NOT a path in
      // this one, but the subsequent POST/GET would be blocked by the browser).
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
  //
  // Enveloped (`{ success: true, data }`) by maintainer ruling on #9436
  // (2026-08-18, option A) — deliberately NOT inheriting #9389's pre-auth
  // exemption: these bodies are read by SDKs, codegen and AI clients (the
  // envelope's core constituency, not our own shells), and the migration was
  // one key. The SDK's `connect()` unwraps `body.data || body` either way.
  app.get(prefix, async (c) => {
    return c.json({ success: true, data: await dispatcher.getDiscoveryInfo(prefix) });
  });

  app.get(`${prefix}/discovery`, async (c) => {
    return c.json({ success: true, data: await dispatcher.getDiscoveryInfo(prefix) });
  });

  // --- .well-known ---
  app.get('/.well-known/objectstack', (c) => {
    return c.redirect(prefix);
  });

  /**
   * Hand a path THIS mount does not own to whatever else matched (#4117).
   *
   * The `${authMount}/*` mount below claims a whole namespace and used to be
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

  /**
   * Does the auth service claim this path? (#15928)
   *
   * Every non-`true` answer — no such method, a throw, anything but `true` —
   * is `false`, i.e. "yield", i.e. exactly what this mount did before #15928.
   * A failure to decide can therefore never take the #4088 surface down with
   * it; the only thing this predicate can do is STOP a yield.
   */
  const authOwnsRoute = async (authService: AuthService, request: Request): Promise<boolean> => {
    if (typeof authService.ownsRoute !== 'function') return false;
    try {
      return (await authService.ownsRoute(request)) === true;
    } catch {
      return false;
    }
  };

  // --- Auth (needs auth service integration) ---
  app.all(`${authMount}/*`, async (c, next) => {
    try {
      const path = c.req.path.substring(authMount.length + 1);
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
        //
        // [#15928] …but ONLY when better-auth disclaims the path. A 404 from a
        // path its own router SERVES is its answer, not a disclaimer, and
        // yielding it hands a real answer to whatever matched next. Here that
        // "whatever" is not hypothetical and needs no composition to install
        // it: the `${prefix}/*` dispatcher catch-all below is registered by
        // THIS function, is terminal, and answers `200 {}` for paths under
        // `/auth/`. Measured on a real boot through this adapter (a real
        // kernel with AuthPlugin, `prefix: '/api/v1'`):
        //
        //     GET /api/v1/auth/delete-user/callback?token=…&callbackURL=…
        //       better-auth direct : 404 {"message":"Not found","code":"NOT_FOUND"}
        //       through this mount : 200 {}
        //
        // That route is published and answers 404 because `user.deleteUser` is
        // deliberately unconfigured — `auth-route-ledger.ts` carries the pair
        // under the `disabled` disposition for exactly that reason. So the
        // ledger's recorded answer was true of the auth service and false on
        // this adapter's wire. Same defect, same fix shape as PR #15918 took in
        // the plugin, adapted to the seam available here: the adapter cannot
        // import `buildBetterAuthRouteOwnership` (it does not depend on
        // `@objectstack/plugin-auth`, and should not), so it asks the auth
        // SERVICE, which is the very `AuthManager` instance that owns the walk.
        //
        // ⛔ #15928 left the mount untouched; what it narrowed is which 404
        // may be handed on. (#16025 later moved WHERE the mount sits — see
        // `resolveAuthMount` — without touching this decision.)
        // `/auth/me/permissions` and
        // `/auth/me/localization` are not better-auth endpoints, so they are
        // disclaimed and still yield — #4088's ordering-independent surface,
        // which objectui's permission layer reads, is unchanged.
        if (response.status === 404 && !(await authOwnsRoute(authService, c.req.raw))) {
          return yieldUnowned(c, next, forwarded);
        }
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
