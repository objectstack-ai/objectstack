// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// @objectstack/verify — boot harness.
//
// Boots a real ObjectStack app **in-process** against an in-memory SQLite
// database, wired with the same service plugins `objectstack dev` loads, and
// exposes the live HTTP surface via Hono's request-injection (no port, no
// sockets — CI-stable). A verifier then exercises the app exactly as a browser
// client would: sign in, hit `/api/v1/...`, assert on real responses.
//
// Why in-process + real HTTP: a whole class of regressions only surfaces when
// the real engine + strategies + services + REST context run together — each
// layer can be individually correct (and individually mocked in unit tests) yet
// break at the seams (e.g. timezone date-bucketing across analytics strategy,
// in-memory aggregation, and the REST execution context). This harness runs the
// integrated stack so those breaks are observable.
//
// Posture: development / in-memory. `NODE_ENV` is forced to `development` so the
// auth plugin's dev-admin bootstrap provisions a known, loginable admin (mirrors
// `objectstack dev`). This is a verification harness — it never touches a real
// database or production data.

import { ObjectKernel, AppPlugin, DriverPlugin, createDispatcherPlugin } from '@objectstack/runtime';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/rest';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { SettingsServicePlugin, LocalCryptoProvider } from '@objectstack/service-settings';
import { AnalyticsServicePlugin } from '@objectstack/service-analytics';

/** A Hono app exposes `.request(path, init)` returning a standard `Response`. */
interface InjectableApp {
  request(input: string, init?: RequestInit): Promise<Response>;
}

const API_PREFIX = '/api/v1';
const DEFAULT_ADMIN_EMAIL = 'admin@objectos.ai';
const DEFAULT_ADMIN_PASSWORD = 'admin123';
const DEFAULT_AUTH_SECRET = 'objectstack-verify-secret';

export interface VerifyStack {
  /** The booted kernel — for direct service calls when bypassing HTTP is intentional. */
  kernel: ObjectKernel;
  /** Inject an HTTP request through the real Hono app (no socket). Path is relative to `/api/v1`. */
  api(path: string, init?: RequestInit): Promise<Response>;
  /** Inject a request at an absolute path (e.g. `/api/settings/...`). */
  raw(path: string, init?: RequestInit): Promise<Response>;
  /** Sign in through the real auth route; returns a bearer token. Defaults to the dev admin. */
  signIn(email?: string, password?: string): Promise<string>;
  /** Sign up a NEW user through the real auth route; returns their bearer token.
   *  The first user is the seeded dev admin, so a fresh sign-up is a plain member
   *  (no roles/grants) — exactly what RLS cross-owner proofs need. */
  signUp(email: string, password?: string, name?: string): Promise<string>;
  /** Convenience: an authed JSON request relative to `/api/v1`. */
  apiAs(token: string, method: string, path: string, body?: unknown): Promise<Response>;
  /** Tear down the kernel (close DB / HTTP handles). */
  stop(): Promise<void>;
}

export interface BootOptions {
  /** Override the dev admin credentials the harness signs in with. */
  admin?: { email: string; password: string };
  /** Override the auth signing secret. Defaults to a fixed in-process dev secret. */
  authSecret?: string;
  /**
   * Override the SecurityPlugin instance. Pass a `new SecurityPlugin({...})`
   * to carry a custom `fallbackPermissionSet` / extra permission sets — this
   * is how an owner-isolated RLS fixture makes a fresh member fall back to a
   * permission set that carries `RLS.ownerPolicy(...)` instead of the broad-read
   * `member_default`. Defaults to a vanilla `new SecurityPlugin()`.
   */
  security?: SecurityPlugin;
  /**
   * Boot multi-tenant: register `@objectstack/plugin-org-scoping` BEFORE the
   * SecurityPlugin so the wildcard `organization_id` RLS policies that ship in
   * the default permission sets actually apply (SecurityPlugin probes the
   * `org-scoping` service once at start and otherwise STRIPS them — see
   * `collectRLSPolicies`). This exercises the org-scoped isolation real apps
   * rely on, rather than the single-tenant default where every tenant policy is
   * stripped and a member sees every row. Default `false`.
   */
  multiTenant?: boolean;
  /**
   * Register `@objectstack/service-automation` so authored flows execute against
   * the real stack. The plugin seeds the built-in node executors and, at start(),
   * pulls every flow in the app config from the ObjectQL registry and registers
   * it — so `POST /api/v1/automation/:name/trigger` actually runs the flow's
   * nodes. Without this the dispatcher's automation routes resolve no `automation`
   * service and flow execution is unreachable. Opt-in (like `multiTenant`) so the
   * default boot stays lean for apps that don't exercise flows. Default `false`.
   */
  automation?: boolean;
}

/**
 * Boot an app config in-process and return a live verification stack.
 *
 * `NODE_ENV` is forced to `development` so the auth plugin's dev-admin
 * bootstrap provisions a known, loginable admin (mirrors `objectstack dev`).
 */
export async function bootStack(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any,
  opts: BootOptions = {},
): Promise<VerifyStack> {
  process.env.NODE_ENV = 'development';

  const kernel = new ObjectKernel();

  // Data engine + in-memory SQLite (pure-JS WASM driver — no native build, CI-safe).
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DriverPlugin(new SqliteWasmDriver({ filename: ':memory:' })));

  // HTTP server (registers the `http-server` IHttpServer service the REST +
  // dispatcher plugins mount their routes onto). Port 0 = ephemeral; we never
  // hit the socket — requests are injected through the Hono app directly.
  await kernel.use(new HonoServerPlugin({ port: 0 }));

  // The app under test (objects, datasets, cubes, flows, seed data).
  await kernel.use(new AppPlugin(config));

  // Service plugins `objectstack dev` auto-loads for an app of this shape.
  await kernel.use(new SettingsServicePlugin());
  await kernel.use(new AnalyticsServicePlugin());
  await kernel.use(new AuthPlugin({ secret: opts.authSecret ?? DEFAULT_AUTH_SECRET }));

  // ADR-0062 — datasource connection service (registers 'datasource-connection'),
  // mirroring `objectstack dev`/serve. Without it, AppPlugin's declared-datasource
  // auto-connect (D1/D2) degrades and a federated app would need an `onEnable`
  // driver bridge — so this is what exercises the no-`onEnable` federation path
  // end-to-end in the dogfood gate. Wired only when the app declares datasources
  // (so the vast majority of apps are unaffected); the D2 gate then leaves
  // managed/unrouted datasources metadata-only (e.g. app-crm — unchanged).
  {
    const dsDefs = (config as { datasources?: unknown }).datasources;
    const declaresDatasources = Array.isArray(dsDefs)
      ? dsDefs.length > 0
      : !!dsDefs && typeof dsDefs === 'object' && Object.keys(dsDefs).length > 0;
    if (declaresDatasources) {
      const { DatasourceAdminServicePlugin, createDefaultDatasourceDriverFactory } = await import(
        '@objectstack/service-datasource'
      );
      await kernel.use(new DatasourceAdminServicePlugin({ driverFactory: createDefaultDatasourceDriverFactory() }));
    }
  }

  // Multi-tenant: org-scoping MUST register BEFORE SecurityPlugin — the latter
  // probes the `org-scoping` service exactly once at start and caches it, then
  // keeps (vs strips) the wildcard `organization_id` RLS policies accordingly.
  // Mirrors the CLI's ordering for `OS_MULTI_ORG_ENABLED`.
  if (opts.multiTenant) {
    const { OrgScopingPlugin } = await import('@objectstack/plugin-org-scoping');
    await kernel.use(new OrgScopingPlugin());
  }

  // Automation service — opt-in. Registered before bootstrap so its start()
  // phase pulls the app's flows from the ObjectQL registry (populated by
  // AppPlugin.init) and registers them. `memory` suspended-run store keeps the
  // harness free of any manifest/persistence dependency for flow execution.
  if (opts.automation) {
    const { AutomationServicePlugin } = await import('@objectstack/service-automation');
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
  }

  await kernel.use(opts.security ?? new SecurityPlugin());
  // Sharing service — apps that declare `requires: ['sharing']` rely on it for
  // record-share grants; without it their RLS/sharing rules are inert and the
  // verifier would under-report authorization.
  await kernel.use(new SharingServicePlugin());

  // REST + dispatcher route surfaces (mount onto the http-server service).
  // No `requireAuth` override: the harness deliberately boots on the platform
  // DEFAULT (secure-by-default deny, ADR-0056 D2) so every dogfood proof —
  // anonymous-deny, public-form survival, share-links — exercises the posture
  // a fresh production deployment actually gets.
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));

  // Fire the ready lifecycle: seed data, dev-admin bootstrap, route registration.
  await kernel.bootstrap();

  // Secret fields (Field.secret) refuse to persist without a crypto provider —
  // mirror `objectstack dev`, which wires LocalCryptoProvider in development so
  // an app with an encrypted field is exercisable end-to-end.
  try {
    const engine = await kernel.getServiceAsync<{ setCryptoProvider?: (p: unknown) => void }>('objectql');
    if (engine && typeof engine.setCryptoProvider === 'function') {
      engine.setCryptoProvider(new LocalCryptoProvider());
    }
  } catch {
    /* no engine / no crypto support — secret fields will fail closed, as in prod */
  }

  const httpServer = await kernel.getServiceAsync<{ getRawApp(): InjectableApp; close?(): Promise<void> }>(
    'http-server',
  );
  const app = httpServer.getRawApp();

  // Same-origin loopback base for request-injection. A *ported* localhost origin
  // matches better-auth's default dev trusted-origins set (`http://localhost:*`),
  // so the in-process dev-admin sign-in passes the CSRF origin check regardless
  // of runtime (a bare `node` CLI vs a test runner) or ambient CORS env. A
  // path-only inject yields `http://localhost` (no port), which does NOT match
  // the `:*` wildcard and gets a 403. Routing is by path; the host:port only
  // shapes `new URL(request.url).origin`, which the auth layer reads.
  const ORIGIN = 'http://localhost:3000';
  const raw = (path: string, init?: RequestInit) => app.request(`${ORIGIN}${path}`, init);
  const api = (path: string, init?: RequestInit) => raw(`${API_PREFIX}${path}`, init);

  const admin = opts.admin ?? { email: DEFAULT_ADMIN_EMAIL, password: DEFAULT_ADMIN_PASSWORD };

  const signIn = async (
    email: string = admin.email,
    password: string = admin.password,
  ): Promise<string> => {
    const res = await api('/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      throw new Error(`verify signIn failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { token?: string };
    if (!data.token) throw new Error('verify signIn: no token in response');
    return data.token;
  };

  const signUp = async (
    email: string,
    password = 'Member-Pass-123',
    name?: string,
  ): Promise<string> => {
    const res = await api('/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: name ?? email.split('@')[0] }),
    });
    if (!res.ok) {
      throw new Error(`verify signUp failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { token?: string };
    if (!data.token) throw new Error('verify signUp: no token in response');
    return data.token;
  };

  const apiAs = (token: string, method: string, path: string, body?: unknown) =>
    api(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const stop = async () => {
    try {
      await httpServer.close?.();
    } catch {
      /* best-effort */
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (kernel as any).shutdown?.();
    } catch {
      /* best-effort */
    }
  };

  return { kernel, api, raw, signIn, signUp, apiAs, stop };
}
