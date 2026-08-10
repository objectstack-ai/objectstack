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

import { ObjectKernel, AppPlugin, DefaultDatasourcePlugin, createDispatcherPlugin } from '@objectstack/runtime';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/rest';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { SettingsServicePlugin, LocalCryptoProvider } from '@objectstack/service-settings';
import { AnalyticsServicePlugin } from '@objectstack/service-analytics';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
// Node-only subpath (#4700). Optional packages supplied by the app under
// verification — `@objectstack/organizations` above all — must be resolved from
// THAT app, not from `packages/verify`'s own realpath inside this workspace.
import { createHostImporter, hostImportFailureKind } from '@objectstack/types/node';

/** A Hono app exposes `.request(path, init)` returning a standard `Response`. */
interface InjectableApp {
  request(input: string, init?: RequestInit): Promise<Response>;
}

/**
 * [#5261] Stand-in for the cloud-private `@objectstack/organizations` runtime,
 * mounted by `bootStack({ multiTenant: 'posture-only' })`.
 *
 * It registers the `org-scoping` service and nothing else. That single fact is
 * what the open core reads to decide whether a REQUESTED organization wall can
 * actually stand (`TenancyService.probeIsolation` → `posture` / `degraded`,
 * ADR-0093 D5), so registering it turns a degraded deployment into a
 * non-degraded `isolated` one from every consumer's point of view.
 *
 * ⛔ It stamps no `organization_id` and scopes no query — it is the deployment's
 * POSTURE, not its WALL. See `BootOptions.multiTenant` for what that permits and
 * what it must never be used to claim.
 *
 * `supportedPostures` is declared (ADR-0105 D12) so the stand-in entitles the
 * same set a runtime predating that seam does, rather than accidentally
 * exercising the narrowed-entitlement path.
 */
class SimulatedOrgScopingPlugin {
  readonly name = 'com.objectstack.verify.simulated-org-scoping';
  readonly version = '1.0.0';
  readonly type = 'standard';
  readonly providesServices = ['org-scoping'];
  readonly supportedPostures = ['group', 'isolated'] as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async init(ctx: any): Promise<void> {
    ctx.registerService('org-scoping', this);
  }
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
   * permission set that carries `RLS.ownerPolicy(...)` instead of the
   * platform's `member_default`.
   *
   * **Default (since #7001): the app's own declared default profile** —
   * `new SecurityPlugin(appSecurityPluginOptions(config))`, i.e. the permission
   * set the config marks `isDefault: true`, wired exactly as `objectstack
   * serve` wires it. A config declaring no such set is unaffected: the
   * resolution yields `undefined` and the plugin keeps deriving its own default
   * (`member_default`) from the built-in sets.
   *
   * A plugin passed here wins WHOLE — the harness never merges the app's
   * declared default into it. An instance arrives carrying its own constructor
   * options, and silently rewriting one of them would be a second, worse
   * surprise than the one #7001 fixed. So this is also the explicit opt-out:
   * a suite that deliberately wants the vanilla platform baseline over an app
   * that declares a default asks for it with `security: new SecurityPlugin()`.
   */
  security?: SecurityPlugin;
  /**
   * Override the AnalyticsServicePlugin instance. Defaults to a vanilla
   * `new AnalyticsServicePlugin()`, which auto-bridges `getReadScope` to the
   * `security` service.
   *
   * The reason to override is to prove ADR-0021 D-C's SECOND belt in isolation
   * (#3602): pass `new AnalyticsServicePlugin({ getReadScope: () => undefined })`
   * to switch the analytics-layer scoping OFF, leaving only the ExecutionContext
   * the bridge hands `engine.aggregate` — i.e. the engine's own RLS middleware.
   * A gate booted that way fails if the second belt ever stops carrying its own
   * weight, which no assertion against the fully-wired stack can detect.
   */
  analytics?: AnalyticsServicePlugin;
  /**
   * Boot multi-tenant: register enterprise `@objectstack/organizations` plugin BEFORE the
   * SecurityPlugin so the wildcard `organization_id` RLS policies that ship in
   * the default permission sets actually apply (SecurityPlugin probes the
   * `org-scoping` service once at start and otherwise STRIPS them — see
   * `collectRLSPolicies`). This exercises the org-scoped isolation real apps
   * rely on, rather than the single-tenant default where every tenant policy is
   * stripped and a member sees every row. Default `false`.
   *
   * Also REQUESTS the `isolated` tenancy posture (ADR-0105 D1) for the boot,
   * unless the caller already set `OS_TENANCY_POSTURE` — mounting the plugin
   * entitles a walled posture but no longer activates one by itself.
   *
   * ## `'posture-only'` — a stand-in, for proving org LIFECYCLE without isolation
   *
   * `multiTenant: 'posture-only'` boots the same shape but registers a built-in
   * stand-in for the `org-scoping` service instead of requiring the cloud-private
   * enterprise package. The `tenancy` service then resolves a real, NON-DEGRADED
   * `isolated` posture, which is what posture-gated seams key on — above all
   * `POST /auth/organization/create`, which since #5261 refuses whenever the
   * EFFECTIVE posture has no organization wall.
   *
   * ⛔ **It performs no tenant isolation whatsoever.** Nothing stamps
   * `organization_id`, nothing scopes a query. It makes the deployment's POSTURE
   * true, not its WALL. A fixture that asserts one tenant cannot read another's
   * rows and boots this way would assert nothing and pass — the constant-false
   * capability probe of #4700 wearing the opposite mask. Cross-tenant isolation
   * has exactly one honest proof in this repo: `multiTenant: true` with the real
   * `@objectstack/organizations` installed, which is why those gates SKIP here
   * (see `test/enterprise-organizations.ts`) instead of pretending.
   *
   * Use it only where the organization wall is the PRECONDITION of the thing
   * under test rather than the thing itself — `org-create-default-team`
   * (#3624: better-auth's default-team insert must not 500) is the case it was
   * built for. Before #5261 that fixture opened the route by flipping
   * `OS_MULTI_ORG_ENABLED` after boot and leaning on the gate's live env read;
   * the gate now reads the tenancy service, so the honest way to open it is to
   * simulate the deployment that legitimately has it open.
   */
  multiTenant?: boolean | 'posture-only';
  /**
   * Root directory of the **host app** being verified — the one whose
   * `node_modules` carries the optional packages it declares (currently the
   * enterprise `@objectstack/organizations` that `multiTenant` needs).
   *
   * Defaults to `process.cwd()`, which is where `objectstack verify` already
   * reads `objectstack.config.ts` from. Set it when booting an app that is not
   * the current working directory — a programmatic harness verifying several
   * apps in one process, or a test fixture on a temp path.
   *
   * Exists because Node ESM resolves a bare `import()` against the importer's
   * own realpath: without a host anchor, `packages/verify` can only ever see the
   * framework's own `node_modules`, so an app-installed package was invisible no
   * matter what the app declared (#4700, same defect class as cloud#1013).
   */
  hostRoot?: string;
  /**
   * Register `@objectstack/service-automation` so authored flows execute against
   * the real stack. The plugin seeds the built-in node executors and, at start(),
   * pulls every flow in the app config from the ObjectQL registry and registers
   * it — so `POST /api/v1/automation/:name/trigger` actually runs the flow's
   * nodes. Without this the dispatcher's automation routes resolve no `automation`
   * service and flow execution is unreachable. Opt-in (like `multiTenant`) so the
   * default boot stays lean for apps that don't exercise flows. Default `false`.
   *
   * Boots the plugin's OWN default (`suspendedRunStore: 'auto'` — persist to
   * `sys_automation_run` when an ObjectQL engine is present), so this layer
   * exercises the same assembly a real deployment gets. It used to hardcode
   * `'memory'`, which made the durable path **structurally unreachable** from
   * every dogfood/e2e fixture (#4470): engine-side persistence was unit-tested
   * against a fake table and the approval chain was e2e-tested wholly in
   * memory, while the ASSEMBLY between them — is the object registered, is the
   * table created, is the store actually attached — was covered by nothing.
   * #4420 grew in exactly that gap.
   *
   * Pass `{ suspendedRunStore: 'memory' }` to opt a fixture back out.
   */
  automation?: boolean | { suspendedRunStore?: 'auto' | 'memory' };
  /**
   * Back the in-process SQLite database with a FILE instead of `:memory:`.
   *
   * The default in-memory database dies with the kernel, which makes one
   * question unaskable in this harness: does state written by one process
   * survive into the next? Point two sequential `bootStack` calls at the same
   * path and the second is a genuine COLD BOOT over the first's data — the
   * restart a durable suspended run has to survive (ADR-0019). Callers own the
   * file's lifetime (create it under a temp dir, delete it after).
   *
   * **`stop()` is the durability boundary.** When it returns, everything
   * committed before it is on disk: the kernel shutdown runs the datasource
   * plugin's `destroy()` → `disconnect()` → the driver's final flush. Nothing
   * else is needed — no explicit flush, no sleep — and a cold boot that finds
   * tables but no rows is a driver bug, not a fixture that forgot to wait
   * (which is exactly what #4518 turned out to be).
   */
  databaseFile?: string;
  /**
   * Extra plugins to register between the app/service pairs and the
   * SecurityPlugin — the slot where `objectstack dev` auto-loads optional
   * service pairs the lean harness omits (e.g. `StorageServicePlugin` +
   * `AuditPlugin` for the attachments surface). The caller instantiates the
   * plugins so `@objectstack/verify` gains no new dependencies. Registered in
   * array order. Default `[]`.
   */
  extraPlugins?: unknown[];
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

  // [ADR-0105 D1] `multiTenant: true` REQUESTS the hard organization wall —
  // posture `isolated`, what `OS_MULTI_ORG_ENABLED=true` historically meant.
  // Since #3559 a walled posture is an explicit operator request resolved from
  // env when AuthPlugin registers the `tenancy` service; mounting the
  // enterprise plugin only ENTITLES it. Without the request the fixture
  // silently boots `single` — no wall, default-org write stamping — and every
  // multi-org proof asserts against the wrong posture. Must be set BEFORE
  // AuthPlugin snapshots the requested posture; an explicit caller-provided
  // OS_TENANCY_POSTURE wins; restored on stop() (and on a failed multi-tenant
  // boot) so later single-tenant boots in the same worker are unaffected.
  const prevTenancyPosture = process.env.OS_TENANCY_POSTURE;
  const requestIsolatedPosture = !!opts.multiTenant && !prevTenancyPosture;
  if (requestIsolatedPosture) process.env.OS_TENANCY_POSTURE = 'isolated';
  const restoreTenancyPosture = () => {
    if (!requestIsolatedPosture) return;
    if (prevTenancyPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = prevTenancyPosture;
  };

  const kernel = new ObjectKernel();

  // Data engine + in-memory SQLite (pure-JS WASM driver — no native build, CI-safe).
  // The default datasource is a DECLARED DEFINITION connected through the
  // shared DatasourceConnectionService (ADR-0062 D1, #3826) — the same boot
  // shape `objectstack dev`/`serve` use since the standalone stack converged,
  // so the dogfood gate exercises the real declared-default connect path (the
  // §Risk mitigation the ADR promised), not the legacy pre-built DriverPlugin
  // escape hatch.
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DefaultDatasourcePlugin({
    driver: 'sqlite-wasm',
    // `opts.databaseFile` makes the database outlive the kernel, so a second
    // boot over the same path is a real cold start (see BootOptions.databaseFile).
    config: { filename: opts.databaseFile ?? ':memory:' },
  }));

  // HTTP server (registers the `http-server` IHttpServer service the REST +
  // dispatcher plugins mount their routes onto). Port 0 = ephemeral; we never
  // hit the socket — requests are injected through the Hono app directly.
  await kernel.use(new HonoServerPlugin({ port: 0 }));

  // The app under test (objects, datasets, cubes, flows, seed data).
  await kernel.use(new AppPlugin(config));

  // Platform infrastructure `os serve` auto-injects into every served kernel:
  // the `sys_migration` flag ledger (#4243) and the `sys_secret` cipher store
  // (#4270) — the latter is what the LocalCryptoProvider wiring below writes
  // into, and the engine fails CLOSED on secret-field writes without it.
  await kernel.use(new PlatformObjectsPlugin());

  // Service plugins `objectstack dev` auto-loads for an app of this shape.
  await kernel.use(new SettingsServicePlugin());
  await kernel.use(opts.analytics ?? new AnalyticsServicePlugin());
  // `autoDefaultOrganization: false` (ADR-0081 D1): the harness proves the two
  // ENDS of the isolation spectrum — pure single-tenant (no org, no scoping)
  // and, via `opts.multiTenant`, full multi-org (the enterprise plugin owns
  // the org bootstrap). AuthPlugin's single-org default-org bootstrap is a
  // product onboarding convenience for `objectstack dev`/`serve`; letting it
  // run here would mint a Default Organization + bind the dev admin as owner,
  // giving every "single-tenant" fixture an active org — which turns on
  // org-scoped RLS and reparents seeded rows, silently breaking the pure
  // single-tenant baseline these dogfood proofs assert (ADR-0057 identity
  // create, ADR-0062 federation, ADR-0086 two-doors). The bootstrap itself is
  // covered by plugin-auth unit tests + browser E2E.
  //
  // [ADR-0108 / #3723] Nothing to wire: the organization-role vocabulary is
  // closed, and a stack's declared `position` / `permission` names are
  // positions, not org roles. `membership-role-vocabulary.dogfood.test.ts`
  // boots through this harness and asserts exactly that.
  await kernel.use(new AuthPlugin({
    secret: opts.authSecret ?? DEFAULT_AUTH_SECRET,
    autoDefaultOrganization: false,
  }));

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

  // Multi-org: the enterprise OrganizationsPlugin (`@objectstack/organizations`,
  // ADR-0081 D2) MUST register BEFORE SecurityPlugin — the latter probes the
  // `org-scoping` service (the historical name the enterprise plugin keeps
  // registering) exactly once at start and caches it, then keeps (vs strips)
  // the wildcard `organization_id` RLS policies accordingly. Mirrors the CLI's
  // ordering for `OS_MULTI_ORG_ENABLED`. `multiTenant` is an explicit opt-in,
  // so a missing package is a hard, actionable error — not a silent
  // single-org downgrade that would flip the fixture's RLS posture.
  if (opts.multiTenant === 'posture-only') {
    // See BootOptions.multiTenant: activates the POSTURE, never the WALL.
    // Registered in the enterprise plugin's own slot so every downstream probe
    // (SecurityPlugin's strip decision, the `tenancy` service's `isolationActive`,
    // `requiresService: 'org-scoping'` nav gating) sees one consistent answer —
    // a stack where half the layers believe the wall is up would be a worse lie
    // than either honest posture.
    await kernel.use(new SimulatedOrgScopingPlugin());
  } else if (opts.multiTenant) {
    // #4700: this used a bare `import()`, which Node ESM resolves against the
    // IMPORTER's realpath — `packages/verify`, inside the framework workspace.
    // `@objectstack/organizations` is cloud-private and only ever lives in the
    // host app's `node_modules`, so the import could never succeed and the
    // message below fired at apps that had already installed the package,
    // telling them to install it again. Resolve from the host app (the project
    // `objectstack verify` runs in) and fall back to this package's own
    // resolution — the same helper `objectstack serve` uses (cloud#1013).
    //
    // #4719: that host resolution is now gated on the host app DECLARING the
    // package. It previously honoured NODE_PATH (a CJS require), so under a pnpm
    // bin shim a fixture app that never declared the enterprise runtime still
    // booted multi-tenant off a hoisted copy — and the RLS posture a fixture
    // then asserted against depended on the launcher.
    const organizationsPkg = '@objectstack/organizations';
    const hostRoot = opts.hostRoot ?? process.cwd();
    let mod: any;
    try {
      mod = await createHostImporter(hostRoot)(organizationsPkg);
    } catch (e) {
      restoreTenancyPosture();
      // Two absences, two remedies (#4719). "Install/link it in THIS APP" is
      // exactly wrong for an app that already declared it and has a pruned or
      // unbuilt install — it sends the operator back to a correct package.json.
      const remedy =
        hostImportFailureKind(e) === 'declared-unresolvable'
          ? `It IS declared in ${hostRoot}'s package.json, so the declaration is not the problem — ` +
            `repair the install there (\`pnpm install\`, un-prune, rebuild its dist).`
          : `Install/link it in THIS APP (${hostRoot}) — and DECLARE it in that app's ` +
            'package.json, which is what is actually checked: a package merely reachable through ' +
            'NODE_PATH or a hoisted workspace store is not accepted (#4719) — to run multi-org fixtures.';
      throw new Error(
        'verify: multiTenant=true requires the enterprise @objectstack/organizations package (migrated from plugin-org-scoping, ADR-0081 D2). ' +
          `${remedy} (${(e as Error).message})`,
      );
    }
    await kernel.use(new mod.OrganizationsPlugin());
  }

  // Automation service — opt-in. Registered before bootstrap so its start()
  // phase pulls the app's flows from the ObjectQL registry (populated by
  // AppPlugin.init) and registers them.
  //
  // #4470: this used to pin `suspendedRunStore: 'memory'`, which meant no
  // dogfood/e2e fixture could reach the DB-backed suspended-run store even in
  // principle — the ASSEMBLY (object registered? table created? store actually
  // attached?) was the one layer neither the engine unit tests nor the
  // approval e2e covered, and #4420 grew there. It now boots the plugin's own
  // `'auto'` default, the same wiring `objectstack dev`/`serve` get, and a
  // fixture that wants the old behaviour asks for it explicitly.
  if (opts.automation) {
    const { AutomationServicePlugin } = await import('@objectstack/service-automation');
    const automationOpts = typeof opts.automation === 'object' ? opts.automation : {};
    await kernel.use(new AutomationServicePlugin({
      ...(automationOpts.suspendedRunStore ? { suspendedRunStore: automationOpts.suspendedRunStore } : {}),
    }));
  }

  // Caller-supplied optional service pairs (see BootOptions.extraPlugins).
  // Before SecurityPlugin, mirroring the CLI's ordering for service pairs.
  for (const plugin of opts.extraPlugins ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await kernel.use(plugin as any);
  }

  // [#7001] The app's DECLARED default profile, resolved the one way every boot
  // path resolves it. Character-for-character what `objectstack serve` does
  // (`packages/cli/src/commands/serve.ts`) — the same helper, the same argument
  // — because the two disagreeing was the defect: an app could declare a
  // profile, ship it to users through the CLI, and have every one of its own
  // tests run against a boot that did not include it. A harness whose context
  // differs from the seam it verifies reports green on a difference in
  // production behaviour, which is the one thing it exists not to do.
  //
  // `opts.security` still wins whole — see BootOptions.security for why a
  // caller-supplied plugin is never partially rewritten.
  await kernel.use(opts.security ?? new SecurityPlugin(appSecurityPluginOptions(config)));
  // Sharing service — apps that declare `requires: ['sharing']` rely on it for
  // record-share grants; without it their RLS/sharing rules are inert and the
  // verifier would under-report authorization.
  await kernel.use(new SharingServicePlugin());

  // REST + dispatcher route surfaces (mount onto the http-server service).
  // Anonymous access to object data is denied unconditionally (#3963 retired the
  // `requireAuth` opt-out), so every dogfood proof — anonymous-deny, public-form
  // survival, share-links, public-book reads — exercises the one posture a
  // production deployment actually gets.
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
    restoreTenancyPosture();
  };

  return { kernel, api, raw, signIn, signUp, apiAs, stop };
}
