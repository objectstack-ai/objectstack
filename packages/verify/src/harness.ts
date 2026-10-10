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
// database or production data, and it never touches the host's key custody
// either: it seals under a data key held in this process's memory only (see
// `harnessCryptoProvider`).

import { randomBytes } from 'node:crypto';
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
import { materializeStackPlugin, resolveCapabilityArgument } from '@objectstack/core';
import { createHandle, type VerifyHandle } from './handle.js';
import { constructServedProviders } from './required-providers.js';

/** A Hono app exposes `.request(path, init)` returning a standard `Response`. */
interface InjectableApp {
  request(input: string, init?: RequestInit): Promise<Response>;
}

/**
 * [#5261] Stand-in for the `@objectstack/organizations` runtime, mounted by
 * `bootStack({ multiTenant: 'posture-only' })`.
 *
 * ⚠️ Why a stand-in and not the real package: since ADR-0132 that runtime is
 * OPEN CORE — Apache-2.0, published on npm — so "it is closed-source" is no
 * longer the reason and has not been since #16215. What keeps it out of here is
 * ADR-0132's entitlement boundary: no framework package may DECLARE
 * `@objectstack/organizations` (`no-framework-dependents.pin.test.ts`, its
 * mechanical half — "Apps declare it; packages do not"), so `packages/verify`
 * cannot depend on it and a bare import from here does not resolve it. The proof
 * that the REAL plugin walls tenants lives in cloud's `security-enterprise`
 * multi-org integration test.
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
  async init(ctx: any): Promise<void> {
    ctx.registerService('org-scoping', this);
  }
}

const API_PREFIX = '/api/v1';
const DEFAULT_ADMIN_EMAIL = 'admin@objectos.ai';
const DEFAULT_ADMIN_PASSWORD = 'admin123';
const DEFAULT_AUTH_SECRET = 'objectstack-verify-secret';

/**
 * The enterprise multi-org runtime this harness mounts under `multiTenant: true`
 * — the one and only subject `bootStack` resolves from the host app, and the
 * default of {@link BootOptions.organizationsPackage}.
 *
 * Exported for the host-resolution suite's premise case, which pins this value
 * so a test seam can never quietly become the production subject. ⛔ Deliberately
 * NOT re-exported from `./index.ts`: it is not part of this package's published
 * API.
 */
export const ORGANIZATIONS_PKG = '@objectstack/organizations';

/** This process's harness data key provider; created on the first boot, never persisted. */
let processCryptoProvider: LocalCryptoProvider | undefined;

/**
 * [#21499] The one crypto provider every `bootStack` in this process hands to
 * the settings service and to the engine.
 *
 * ## Why not the default provider
 *
 * `SettingsServicePlugin` handed no `cryptoProvider`, and a bare
 * `new LocalCryptoProvider()`, both resolve a data key the way a SERVER does:
 * `OS_SECRET_KEY`, then the dev env key, then the key file in the key home —
 * and, in the development posture `bootStack` forces, with none of those they
 * MINT the key file so the next restart reuses it. That is right for
 * `os serve`. For this harness it was an undeclared side effect on key
 * custody: `os verify` is a one-shot command that seals nothing it keeps, yet
 * it left a key file behind that the next development-posture process on that
 * host adopted and sealed real secrets under. And where the host already HAD
 * a key, the harness sealed its throwaway fixtures under the host's real key —
 * reading key material it never needed.
 *
 * ## Why not "read an existing key, or refuse" (the CLI's one-shot shape)
 *
 * The harness seals AND opens secrets in its own database — `secret` fields,
 * encrypted settings — so a provider that refuses on a keyless host would
 * break exactly what the harness exists to exercise.
 *
 * ## What it is
 *
 * A `LocalCryptoProvider` over an explicit random key: no env read, no key
 * file read, no write anywhere. ⛔ The key never leaves this process's memory.
 * It is the PROCESS's key, not the boot's, so two boots over one
 * `BootOptions.databaseFile` — the harness's restart — open each other's
 * secrets, as a real host's stable key would let them. Pinned by
 * `harness.key-custody.test.ts`.
 */
function harnessCryptoProvider(): LocalCryptoProvider {
  processCryptoProvider ??= new LocalCryptoProvider({ key: randomBytes(32) });
  return processCryptoProvider;
}

/**
 * A booted stack: the HTTP surface (`api` / `raw` / `signIn` / `signUp` /
 * `apiAs`) plus the in-process handle (`hooks` / `validate` / `flows` /
 * `actions` / `automation` / `seed` / `rows` / `metadata` / `tenancy` /
 * `contextFor`) on the same kernel — see `./handle.ts` for what each method
 * is a facade over.
 */
export interface VerifyStack extends VerifyHandle {
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
   * Override the AnalyticsServicePlugin instance. Defaults to the instance
   * `objectstack serve` constructs for the app — `new AnalyticsServicePlugin({
   * cubes })` with the app's `analyticsCubes` (the top level, then its legacy
   * `cubes` spelling, then each package body's; `resolveCapabilityArgument`,
   * `@objectstack/core`, #22301) — which auto-bridges `getReadScope` to the
   * `security` service. An instance passed here wins whole: it is not handed
   * the app's cubes.
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
   * stand-in for the `org-scoping` service instead of requiring the enterprise
   * package that no framework package may declare (ADR-0132's entitlement
   * boundary). The `tenancy` service then resolves a real, NON-DEGRADED
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
   * ASSERT that the harness admin is bound to an organization, so the execution
   * context every request of theirs resolves CARRIES an `organizationId` — and
   * refuse the boot when it is not. Default `false`.
   *
   * [ADR-0131 D3] The bind itself is no longer opt-in: every `single` boot has
   * the Default Organization (`AuthPlugin.start()` creates it before the seeds
   * load), the membership reconciler makes every sign-up its member, and the
   * owner bind makes the platform admin its owner — the production shape
   * `objectstack dev` / `serve` boot, which `bootStack` boots too. The
   * `session.create.before` hook stamps that organization onto the session as
   * `activeOrganizationId`, the ONE wire field `resolveAuthzContext` reads into
   * `tenantId` → `ExecutionContext`. This flag adds the vacuity guard below:
   * a fixture whose subject IS the org-bound caller fails loudly at boot if a
   * future composition stops binding, instead of asserting nothing.
   *
   * ## What the bound caller buys
   *
   * Application-level `organization_id`-scoped READS engage their filter,
   * because they read the org id off the resolved context directly. Before
   * #7762, no fixture in the open core could reach that branch over HTTP:
   * `bootStack`'s admin resolved org-less, so a filtered read returned
   * whatever the UNfiltered one did and a test asserting on the difference
   * asserted nothing. `sys_sharing_rule` listing (#7676),
   * `sys_business_unit` approver expansion (#3807) and `sys_metadata`
   * pending-draft listing are the same shape.
   *
   * ## ⛔ It performs NO tenant isolation whatsoever
   *
   * A bound caller is not an organization wall. With no `org-scoping` service
   * registered — and nothing here registers one — `SecurityPlugin` STRIPS the
   * wildcard `organization_id` RLS policies that ship in the default
   * permission sets (`collectRLSPolicies`; see the `multiTenant` doc block
   * above). So a fixture asserting "tenant B cannot read tenant A's rows" on a
   * `single` boot asserts nothing and passes.
   *
   * Cross-tenant isolation has exactly one honest proof in this repo:
   * `multiTenant: true` with the real `@objectstack/organizations` installed
   * (which is why those gates SKIP here instead of pretending — see
   * `test/enterprise-organizations.ts`).
   *
   * The tenancy POSTURE is likewise untouched, and that is not an accident of
   * this implementation but a property of the seam: `TenancyService`'s
   * `probeIsolation` is `() => !!ctx.getService('org-scoping')`
   * (`plugin-auth/src/auth-plugin.ts`), so the effective posture derives from
   * SERVICE REGISTRATION only and reads nothing about what any context
   * carries. `harness.org-context.test.ts` pins `posture` and `degraded`
   * identical with the flag off vs on.
   *
   * ## Composition with `multiTenant`: it does NOT compose — the boot REFUSES
   *
   * `bootStack(app, { orgContext: true, multiTenant: … })` throws, for both
   * spellings, rather than booting something that silently means less than it
   * reads:
   *
   *  - with `multiTenant: true`, the enterprise `@objectstack/organizations`
   *    package OWNS the org bootstrap and already binds the admin — this flag
   *    would assert on a second owner's invariant;
   *  - with `multiTenant: 'posture-only'`, it would assert something that
   *    cannot hold. That mode requests the `isolated` posture, and the open
   *    default-org bootstrap deliberately abstains under every WALLED posture
   *    (`postureEnforcesWall`, cloud ADR-0081 D1) — the open package never
   *    bootstraps an organization for a deployment whose multi-organization
   *    runtime it does not provide. The admin resolves org-less there.
   *
   * A posture-gated seam that ALSO needs an org-bound caller therefore has no
   * harness answer today; it needs the real enterprise package.
   */
  orgContext?: boolean;
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
   * [#22301] It is also the app's root in the two places `objectstack serve`
   * anchors at the directory holding `objectstack.config.ts`: the `packageRoot`
   * the automation service is handed (whether the app's `requires` names
   * `automation` or {@link BootOptions.automation} asks for it), which is where
   * a declarative connector's package-relative file ref is read from; and the
   * root a string entry of the app's own `plugins` array is resolved from. A
   * suite whose working directory is not the app's directory passes the app's
   * directory here — otherwise such a file ref resolves against the working
   * directory, and the boot refuses the connector loudly, as `serve` would
   * from the wrong root.
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
   *
   * [#22301] An app that DECLARES `requires: ['automation']` gets the service
   * without this option, as it does under `objectstack serve` (see
   * `./required-providers.ts`). Set it anyway for an app that does not declare
   * it, or for the `suspendedRunStore` choice above: with it set, this option's
   * instance is the one the boot keeps. Either way the service is handed
   * {@link BootOptions.hostRoot} as its `packageRoot`.
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
   * The default datasource's driver. Default `'sqlite-wasm'` — the pure-JS
   * in-memory SQLite this harness has always booted, and the driver a real
   * `objectstack dev` uses.
   *
   * `'memory'` boots `@objectstack/driver-memory` instead, which is the OTHER
   * half of a two-driver equivalence measurement: the two drivers reach the
   * analytics service through DIFFERENT strategies (`NativeSQLStrategy` compiles
   * raw SQL on a SQL driver; the memory driver cannot run raw SQL, so the query
   * falls through to `ObjectQLStrategy` and the engine's middleware). A gate
   * that asserts the two doors reach ONE verdict cannot be written against one
   * driver — asking on `sqlite-wasm` alone is exactly how the strategies were
   * allowed to disagree about the security boundary.
   *
   * ⛔ It is NOT a general "run any fixture on memory" switch. The memory driver
   * does not implement every SQL behaviour this harness's other gates depend
   * on; use it where the DRIVER is the variable under test.
   */
  databaseDriver?: 'sqlite-wasm' | 'memory';
  /**
   * Extra plugins to register between the app/service pairs and the
   * SecurityPlugin — the slot where `objectstack dev` auto-loads optional
   * service pairs the lean harness omits (e.g. `StorageServicePlugin` +
   * `AuditPlugin` for the attachments surface). Registered in array order.
   * Default `[]`.
   *
   * [#22301] Not for what `objectstack serve` composes from the configuration:
   * the boot mounts the providers the app's `requires` names and the always-on
   * slate `serve` mounts for every app, each built from the app's configuration
   * by `serve`'s rules (see `./required-providers.ts`), and the plugins in the
   * app's own `plugins` array, by `serve`'s rule for an entry
   * (`materializeStackPlugin`, `@objectstack/core`). A plugin here TAKES
   * PRECEDENCE over both, by identity:
   *
   *  - over a provider it IS (exact `name` or class name, `serve`'s "an
   *    explicit instance wins" rule) — the capability is skipped whole, so a
   *    suite that needs a provider configured its own way (a storage root, a
   *    mail transport) passes its instance here;
   *  - over an entry of the app's `plugins` array that has the same `name`,
   *    the identity the kernel registers a plugin under — that entry is not
   *    mounted, and this instance is the one the boot keeps.
   *
   * So a suite that needs one of those configured its own way passes it here.
   * {@link BootOptions.security} and {@link BootOptions.analytics} take
   * precedence over an app plugin of the same `name` the same way.
   */
  extraPlugins?: unknown[];
  /**
   * The specifier `multiTenant: true` resolves from the host app. Defaults to
   * the real subject, {@link ORGANIZATIONS_PKG}; ⛔ production callers never
   * pass it.
   *
   * ## Why it exists (#17911, the same repair #16539 / #16552 landed)
   *
   * Every verdict this boot path reaches is a statement about what a host root
   * HAS and, just as load-bearing, what it has NOT got. Until ADR-0132 / #16215
   * the second half came free: `@objectstack/organizations` was cloud-private,
   * so a temp host that declared it and did not install it was unresolvable by
   * construction. It is a tracked workspace package now; pnpm's hoisted store
   * carries it and every `pnpm exec`-launched runner (vitest's bin shim
   * included) exports a `NODE_PATH` that reaches that store. From then on a
   * "declared, not installed" fixture's verdict was a function of whether an
   * unrelated package had been BUILT — green on CI, whose test graph never
   * builds it, red on any tree that had run a full local build.
   *
   * The visible half of that is a false red. The half that matters is the quiet
   * one: a fixture whose subject is reachable is no longer deciding what the
   * host root has, and nothing says so. So a case that needs the absence to be
   * a property of ITS OWN directory hands in a name this workspace can never
   * contain (`@fixture/*`) and proves the absence rather than assuming it — and
   * no workspace name is safe from becoming one.
   *
   * ⛔ It does NOT rename the package in the operator-facing sentence: the error
   * this boot throws names {@link ORGANIZATIONS_PKG} literally, because in every
   * production boot that is the subject. Only the specifier moves.
   */
  organizationsPackage?: string;
}

/** One entry of the app's own `plugins` array, resolved, and how a refusal names it. */
interface AppPluginEntry {
  plugin: unknown;
  label: string;
}

/** A plugin's registered `name` — the identity the kernel keys it by. */
function registeredName(plugin: unknown): string | undefined {
  const name = (plugin as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/**
 * [#22301] The plugins of the app's own `plugins` array, each resolved by
 * `objectstack serve`'s rule for an entry (`materializeStackPlugin`,
 * `@objectstack/core`: a string is a package specifier, a plain bundle is
 * wrapped into `AppPlugin`, an instance is itself), minus every entry whose
 * `name` a caller-handed instance already has — that instance takes precedence
 * (see BootOptions.extraPlugins).
 *
 * `name` is the precedence key because it is the kernel's identity for a
 * plugin: two plugins with different names both run, and of two with one name
 * the kernel keeps one. A class-name match is deliberately NOT used here —
 * every bundle entry becomes an `AppPlugin`, so a caller's own `AppPlugin`
 * would silently drop every bundle the app declares.
 *
 * Reads the top-level `plugins` only, as `serve` does; `devPlugins` is the
 * `objectstack dev`-only addition `serve` does not mount, and is not read.
 */
async function resolveAppPlugins(
  config: unknown,
  opts: { hostRoot: string; callerInstances: readonly unknown[] },
): Promise<AppPluginEntry[]> {
  const declared = (config as { plugins?: unknown } | null | undefined)?.plugins;
  // Absent (or `null`) is no plugins, as `serve`'s `config.plugins || []` reads it.
  if (declared === undefined || declared === null) return [];
  if (!Array.isArray(declared)) {
    throw new Error(
      `verify: the configuration's \`plugins\` is ${typeof declared}, not an array, so bootStack cannot mount it ` +
        'the way objectstack serve mounts the plugins an app declares. Declare `plugins` as an array of plugin ' +
        'instances, bundles or package names.',
    );
  }
  const callerNames = new Set(
    opts.callerInstances.map(registeredName).filter((n): n is string => n !== undefined),
  );
  let importer: ((specifier: string) => Promise<unknown>) | undefined;
  const resolved: AppPluginEntry[] = [];
  for (const [index, entry] of declared.entries()) {
    const at = typeof entry === 'string' ? `plugins[${index}] ('${entry}')` : `plugins[${index}]`;
    let plugin: unknown;
    try {
      plugin = await materializeStackPlugin(entry, {
        importSpecifier: (specifier) => {
          // Host-anchored, as `serve` loads an app-declared package (the
          // `multiTenant` import below uses the same helper the same way).
          importer ??= createHostImporter(opts.hostRoot, {
            fallbackImport: (s) => import(/* webpackIgnore: true */ s),
          });
          return importer(specifier);
        },
        wrapBundle: (bundle) => new AppPlugin(bundle as any),
      });
    } catch (e) {
      throw new Error(
        `verify: the app's ${at} could not be loaded: ${(e as Error).message}. bootStack mounts the plugins of ` +
          "the app's own `plugins` array as `objectstack serve` does, and does not boot on without one. A package " +
          `name resolves from the app's root, BootOptions.hostRoot (${opts.hostRoot}): declare and install it ` +
          "there, or pass the app's directory as hostRoot. A relative path never resolves from the app " +
          '(`serve` refuses it); write a package name or an absolute URL.',
      );
    }
    const name = registeredName(plugin);
    if (name !== undefined && callerNames.has(name)) continue;
    resolved.push({ plugin, label: name !== undefined ? `${at} '${name}'` : at });
  }
  return resolved;
}

/**
 * [#22301] Configurations with a live `bootStack` kernel in this process, and
 * the app-plugin instances those kernels mounted — the instance rule's two
 * keys (see {@link bootStack}). Weak, so a configuration nobody holds any more
 * is never kept alive by having booted once.
 */
const LIVE_CONFIGURATIONS = new WeakSet<object>();
const LIVE_APP_PLUGINS = new WeakSet<object>();

/** How a configuration names itself in a refusal: its manifest id, else its name. */
function configurationLabel(config: unknown): string {
  const c = config as { manifest?: { id?: unknown }; name?: unknown; id?: unknown } | null | undefined;
  const id = c?.manifest?.id ?? c?.id ?? c?.name;
  return typeof id === 'string' && id !== '' ? `'${id}'` : '(no manifest id)';
}

/**
 * The instance rule's refusal — the ADR-0112 shape (`code` + `status`) a test
 * asserts on, with `RESOURCE_CONFLICT` from the standard catalog: the
 * configuration is held by a live kernel, and the second boot conflicts with it.
 */
function instanceRuleRefusal(message: string): Error {
  return Object.assign(new Error(message), { code: 'RESOURCE_CONFLICT', status: 409 });
}

// [#22301] Three remedies, and the third is spelled by a measurement: a boot
// keeps live references into the configuration's nested definitions (the
// registry stores each object as a shallow copy whose field definitions are
// the authored objects — `@objectstack/objectql` `registry.ts`,
// `definition: { ...schema, name: fqn }`; and the engine's `registerApp` writes
// `objDef.name` into a map-form `objects` entry in place). So a `{ ...config }`
// spread is NOT a configuration of its own, and the remedy names building it
// again instead.
const INSTANCE_RULE_REMEDY =
  'stop() the live stack before booting this configuration again; or share it: bootStackOnce(config, opts) ' +
  'hands every caller with the same config and options object the one boot; or, to keep two stacks live at ' +
  'once, boot the second on a configuration of its own, BUILT AGAIN (call its builder once more, or import a ' +
  'fresh module instance of it), never a `{ ...config }` copy, which shares the nested definitions and plugin ' +
  'instances a live boot holds.';

/** One boot's hold on its configuration and on the app-plugin instances it mounts. */
interface ConfigurationClaim {
  /** Hold these app-plugin instances too; refuses one another live kernel already mounted. */
  holdAppPlugins(entries: ReadonlyArray<{ plugin: unknown; label: string }>): void;
  /** Let go of everything held. Idempotent. */
  release(): void;
}

/**
 * Claim `config` for one live kernel, or refuse — synchronously, before the
 * boot awaits anything, so two boots started together are refused too.
 */
function claimConfiguration(config: unknown): ConfigurationClaim {
  const key = config !== null && typeof config === 'object' ? (config as object) : undefined;
  if (key && LIVE_CONFIGURATIONS.has(key)) {
    throw instanceRuleRefusal(
      `verify: configuration ${configurationLabel(config)} already has a live bootStack kernel in this process. ` +
        'One configuration supports one live kernel at a time: the plugins in its own `plugins` array are ' +
        'module-level instances, and a live kernel holds references into its nested definitions, so a second ' +
        'kernel would share both. ' +
        INSTANCE_RULE_REMEDY,
    );
  }
  if (key) LIVE_CONFIGURATIONS.add(key);
  const heldPlugins: object[] = [];
  let released = false;
  return {
    holdAppPlugins(entries) {
      for (const { plugin, label } of entries) {
        if (plugin === null || typeof plugin !== 'object') continue;
        if (LIVE_APP_PLUGINS.has(plugin)) {
          throw instanceRuleRefusal(
            `verify: the app's ${label} is already mounted by another live bootStack kernel in this process — ` +
              `configuration ${configurationLabel(config)} is a copy of one that is booted, and a copy carries ` +
              'the same plugin instances. One configuration supports one live kernel at a time. ' +
              INSTANCE_RULE_REMEDY,
          );
        }
      }
      for (const { plugin } of entries) {
        if (plugin === null || typeof plugin !== 'object') continue;
        LIVE_APP_PLUGINS.add(plugin);
        heldPlugins.push(plugin);
      }
    },
    release() {
      if (released) return;
      released = true;
      if (key) LIVE_CONFIGURATIONS.delete(key);
      for (const plugin of heldPlugins) LIVE_APP_PLUGINS.delete(plugin);
    },
  };
}

/**
 * Boot an app config in-process and return a live verification stack.
 *
 * `NODE_ENV` is forced to `development` so the auth plugin's dev-admin
 * bootstrap provisions a known, loginable admin (mirrors `objectstack dev`).
 *
 * ## What it composes — one composition rule (#22301, ruling A)
 *
 * For one configuration, what `objectstack serve` composes from it: the
 * harness's service set; the providers `serve` mounts for it — the ones the
 * app's `requires` names and the always-on slate `serve` mounts for every app
 * (`queue`, `job`, `cache`, `settings`, `email`, `storage`, `sms`, `sharing`,
 * `messaging`, `analytics`, `package-registry`), each built from the app's
 * configuration the way `serve` builds it: the app's `analyticsCubes`, its
 * `email` / `sms` blocks with the `OS_EMAIL_*` / `OS_SMS_*` environment over
 * them, the `OS_STORAGE_LOCAL_ROOT` storage root (`./required-providers.ts`);
 * and the plugins in the app's own `plugins` array, by `serve`'s rule for an
 * entry — with {@link BootOptions.extraPlugins} taking precedence by
 * identity, and every app-relative path anchored to
 * {@link BootOptions.hostRoot}. A provider or an entry of that array that
 * cannot be built, loaded or registered fails the boot, with its remedy. There
 * is no switch: an app's tests boot what the app declares, so a plugin the app
 * forgot to declare, or a mail configuration no transport can deliver
 * through, fails in its tests the way it would in production.
 *
 * Not composed here, because they are decisions about a server PROCESS rather
 * than about the configuration: `serve`'s MCP endpoint (`OS_MCP_SERVER_ENABLED`)
 * and its pinyin search (`OS_SEARCH_PINYIN_ENABLED`, which `serve` stamps from
 * the stack's locales). A suite that exercises either passes the provider in
 * {@link BootOptions.extraPlugins}.
 *
 * ### Offline CI: `OS_CLOUD_URL=off`
 *
 * An app whose `plugins` array wires marketplace-facing plugins (the
 * `@objectstack/cloud-connection` set) gets them mounted here, as `serve`
 * mounts them, and their marketplace routes reach the control plane they are
 * pointed at — by default the public ObjectStack catalog. A suite that must
 * stay offline sets `OS_CLOUD_URL=off` in its environment before the
 * configuration module is imported: a configuration that reads the URL with
 * `resolveCloudUrl()` (`@objectstack/cloud-connection`) then declines the
 * marketplace, the same switch a fully-offline `serve` uses.
 * `packages/qa/dogfood` sets it in its vitest config.
 *
 * ## The instance rule: one live kernel per configuration, per process
 *
 * A second `bootStack` of the SAME configuration object while the first is
 * still live is refused with `RESOURCE_CONFLICT` (`status: 409`), so the
 * module-level plugin instances in its `plugins` array are never mounted by two
 * kernels at once. A copy of a booted configuration (`{ ...config }`) is
 * refused the same way when it carries an app-plugin instance a live kernel
 * mounted. Live means from the call until `stop()` resolves, or until the boot
 * fails. Booting again after `stop()` is fine, and {@link bootStackOnce}
 * shares one boot among callers instead of starting a second.
 *
 * A suite that needs two stacks of one app live at once (two postures, two
 * option sets) boots the second on a configuration of its own, BUILT AGAIN —
 * its builder called once more, or a fresh module instance of the module that
 * exports it. A `{ ...config }` spread is not one: a live boot holds references
 * into the configuration's nested definitions as well as its plugin instances.
 */
export async function bootStack(
  config: any,
  opts: BootOptions = {},
): Promise<VerifyStack> {
  const claim = claimConfiguration(config);
  try {
    return await bootClaimed(config, opts, claim);
  } catch (e) {
    claim.release();
    throw e;
  }
}

/** {@link bootStack}'s boot, under a claim the caller holds and releases on failure. */
async function bootClaimed(
  config: any,
  opts: BootOptions,
  claim: ConfigurationClaim,
): Promise<VerifyStack> {
  process.env.NODE_ENV = 'development';

  // [#7762] `orgContext` and `multiTenant` are two owners of one invariant —
  // refuse the combination rather than boot the weaker of them silently. See
  // BootOptions.orgContext ("Composition with `multiTenant`") for why each
  // spelling is refused; the `'posture-only'` half is the load-bearing one,
  // because there the flag would be a pure no-op that still reads as coverage.
  if (opts.orgContext && opts.multiTenant) {
    throw new Error(
      `verify: orgContext:true does not compose with multiTenant:${JSON.stringify(opts.multiTenant)}. ` +
        (opts.multiTenant === 'posture-only'
          ? "'posture-only' requests the `isolated` posture, and the open default-org bootstrap abstains " +
            'under every walled posture (cloud ADR-0081 D1) — the admin would resolve org-less while the fixture ' +
            'read as org-bound. Drop one of the two options; a posture-gated seam that also needs an ' +
            'org-bound caller needs the real @objectstack/organizations package.'
          : 'the enterprise @objectstack/organizations package owns the org bootstrap under multiTenant:true ' +
            'and already binds the admin. Drop orgContext.'),
    );
  }

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
  // [#11184] A walled posture now REFUSES BOOT unless OS_PLATFORM_OWNER_EMAIL
  // is declared (plugin-auth init), and plugin-security promotes ONLY the
  // account matching it — never the first registrant. A correctly configured
  // walled deployment declares its owner, so the harness does too: the
  // declared owner is the dev admin the harness seeds and signs in as, which
  // keeps every walled fixture's observable state exactly as before (the
  // seeded admin is promoted; a fresh `signUp` stays a plain member). A
  // caller-provided value wins, mirroring the posture knob above; restored on
  // stop() alongside it.
  const bootRunsWalled =
    requestIsolatedPosture || prevTenancyPosture === 'isolated' || prevTenancyPosture === 'group';
  const prevPlatformOwnerEmail = process.env.OS_PLATFORM_OWNER_EMAIL;
  const declareHarnessOwnerEmail = bootRunsWalled && !prevPlatformOwnerEmail;
  if (declareHarnessOwnerEmail) {
    process.env.OS_PLATFORM_OWNER_EMAIL = opts.admin?.email ?? DEFAULT_ADMIN_EMAIL;
  }
  const restoreTenancyPosture = () => {
    if (declareHarnessOwnerEmail) {
      if (prevPlatformOwnerEmail === undefined) delete process.env.OS_PLATFORM_OWNER_EMAIL;
      else process.env.OS_PLATFORM_OWNER_EMAIL = prevPlatformOwnerEmail;
    }
    if (!requestIsolatedPosture) return;
    if (prevTenancyPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = prevTenancyPosture;
  };

  const kernel = new ObjectKernel();
  // The host app's root — where `multiTenant` resolves the enterprise package
  // from, and the `packageRoot` a required `automation` is handed (#22301).
  const hostRoot = opts.hostRoot ?? process.cwd();

  // Data engine + in-memory SQLite (pure-JS WASM driver — no native build, CI-safe).
  // The default datasource is a DECLARED DEFINITION connected through the
  // shared DatasourceConnectionService (ADR-0062 D1, #3826) — the same boot
  // shape `objectstack dev`/`serve` use since the standalone stack converged,
  // so the dogfood gate exercises the real declared-default connect path (the
  // §Risk mitigation the ADR promised), not the legacy pre-built DriverPlugin
  // escape hatch.
  await kernel.use(new ObjectQLPlugin());
  const databaseDriver = opts.databaseDriver ?? 'sqlite-wasm';
  await kernel.use(new DefaultDatasourcePlugin({
    driver: databaseDriver,
    // `opts.databaseFile` makes the database outlive the kernel, so a second
    // boot over the same path is a real cold start (see BootOptions.databaseFile).
    // The memory driver holds no file — it takes no `filename` and a stray one
    // would be config the driver silently ignores.
    config: databaseDriver === 'memory' ? {} : { filename: opts.databaseFile ?? ':memory:' },
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
  // [#21499] The settings service seals under the harness's in-process key,
  // never under a provider of its own (see `harnessCryptoProvider`).
  const cryptoProvider = harnessCryptoProvider();
  const settingsPlugin = new SettingsServicePlugin({ cryptoProvider });
  await kernel.use(settingsPlugin);
  // [#22301] Built from the app's configuration the way `objectstack serve`
  // builds it — the app's `analyticsCubes` — by the rule both boots read
  // (`resolveCapabilityArgument`, `@objectstack/core`). A caller's instance wins
  // whole (see BootOptions.analytics).
  const analyticsPlugin =
    opts.analytics ??
    new AnalyticsServicePlugin(
      resolveCapabilityArgument('analytics', { stack: config, packageRoot: hostRoot }).argument as ConstructorParameters<
        typeof AnalyticsServicePlugin
      >[0],
    );
  await kernel.use(analyticsPlugin);
  // [ADR-0131 D3 / D11] The production `single` shape, as `objectstack dev` /
  // `serve` boot it: `AuthPlugin`'s defaults, owner bind included. Under
  // `single` the Default Organization is a boot invariant — `AuthPlugin.start()`
  // creates it before any seed loads, whatever `autoDefaultOrganization` says —
  // so every seed row and system write is owned by it, every sign-up is its
  // member, and the platform admin is its owner. There is no organization-less
  // `single` deployment to model any more, so the harness does not pin one:
  // `autoDefaultOrganization: false` would leave only a harness-only admin who
  // is a `member` and not the owner, a standing no deployment has. Full
  // multi-org stays `opts.multiTenant` (the enterprise plugin owns the walled
  // bootstrap; the open one abstains under every walled posture).
  //
  // [ADR-0108 / #3723] Nothing to wire: the organization-role vocabulary is
  // closed, and a stack's declared `position` / `permission` names are
  // positions, not org roles. `membership-role-vocabulary.dogfood.test.ts`
  // boots through this harness and asserts exactly that.
  await kernel.use(new AuthPlugin({
    secret: opts.authSecret ?? DEFAULT_AUTH_SECRET,
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
  // ADR-0105 D12) MUST register BEFORE SecurityPlugin — the latter probes the
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
    // `@objectstack/organizations` is host-supplied — ADR-0132's entitlement
    // boundary forbids any framework package declaring it, so it only ever lives
    // in the host app's `node_modules` — and the import could never succeed: the
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
    //
    // Commit 46d34ab7c: the undeclared FALLBACK is this package's own resolution only if
    // this package supplies it. A bare `import()` written inside
    // `@objectstack/types` resolves against THAT package — which declares
    // `@objectstack/spec` and nothing else — so the helper's documented
    // "falls back to the importing package's own resolution" was not true for
    // any caller until each one handed in its base. `(s) => import(s)` here is
    // literally this module's resolver, so the sentence now holds for
    // `bootStack`. Measured: it changes nothing for THIS specifier —
    // `@objectstack/organizations` resolves from nowhere in the framework
    // workspace, because ADR-0132's entitlement boundary means no framework
    // package declares it — and it is what stops the next app-supplied
    // package added to this path from silently missing `packages/verify`'s own
    // dependencies.
    // #17911: the subject is a parameter with the real package as its default,
    // so a fixture case whose whole content is "this host root does NOT have
    // it" can hand in a name the workspace can never supply. Production callers
    // pass nothing and get `ORGANIZATIONS_PKG` — see BootOptions.organizationsPackage.
    const organizationsPkg = opts.organizationsPackage ?? ORGANIZATIONS_PKG;
    let mod: any;
    try {
      mod = await createHostImporter(hostRoot, {
        fallbackImport: (specifier) => import(/* webpackIgnore: true */ specifier),
      })(organizationsPkg);
    } catch (e) {
      restoreTenancyPosture();
      // One remedy per ABSENCE (#4719), and the branch reads "is the
      // declaration the problem?" — not one kind. "Install/link it in THIS
      // APP" is exactly wrong for an app that already declared it and has a
      // pruned or unbuilt install: it sends the operator back to a correct
      // package.json. #14041's third kind is neither absence — declared,
      // installed, and the package publishes nothing loadable — so that arm
      // prescribes nothing and defers to the importer's own message, which is
      // interpolated at the end of this same error (#14270).
      const kind = hostImportFailureKind(e);
      const remedy =
        kind === 'declared-unresolvable'
          ? `It IS declared in ${hostRoot}'s package.json, so the declaration is not the problem — ` +
            `repair the install there (\`pnpm install\`, un-prune, rebuild its dist).`
          : kind === 'declared-no-loadable-entry'
            ? `It IS declared in ${hostRoot}'s package.json AND installed there, so neither is ` +
              'the problem and no install action can help — the package publishes no entry Node ' +
              "can load. The remedy is in the package; the importer's message below is the " +
              'authority on what it has to publish.'
            : `Install/link it in THIS APP (${hostRoot}) — and DECLARE it in that app's ` +
              'package.json, which is what is actually checked: a package merely reachable through ' +
              'NODE_PATH or a hoisted workspace store is not accepted — to run multi-org fixtures.';
      throw new Error(
        'verify: multiTenant=true requires the enterprise @objectstack/organizations package (migrated from plugin-org-scoping, ADR-0105 D12). ' +
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
  let automationPlugin: unknown;
  if (opts.automation) {
    const { AutomationServicePlugin } = await import('@objectstack/service-automation');
    const automationOpts = typeof opts.automation === 'object' ? opts.automation : {};
    automationPlugin = new AutomationServicePlugin({
      ...(automationOpts.suspendedRunStore ? { suspendedRunStore: automationOpts.suspendedRunStore } : {}),
      // [#22301] The app's root, as `serve` hands it — see BootOptions.hostRoot.
      packageRoot: hostRoot,
    });
    await kernel.use(automationPlugin as any);
  }

  // Caller-supplied optional service pairs (see BootOptions.extraPlugins).
  // Before SecurityPlugin, mirroring the CLI's ordering for service pairs.
  for (const plugin of opts.extraPlugins ?? []) {
    await kernel.use(plugin as any);
  }

  // [#22301] The plugins in the app's own `plugins` array, as `objectstack
  // serve` mounts them. Resolved HERE, before the `requires` providers, because
  // `serve`'s "an explicit instance wins" rule counts them as held; registered
  // below, after the harness's own services, in `serve`'s slot for them. An
  // instance the caller handed this boot takes precedence by identity (see
  // BootOptions.extraPlugins), and the instance rule holds the rest.
  let appPlugins: AppPluginEntry[];
  try {
    appPlugins = await resolveAppPlugins(config, {
      hostRoot,
      callerInstances: [
        ...(opts.extraPlugins ?? []),
        ...(opts.security ? [opts.security] : []),
        ...(opts.analytics ? [opts.analytics] : []),
      ],
    });
    claim.holdAppPlugins(appPlugins);
  } catch (e) {
    restoreTenancyPosture();
    throw e;
  }

  // [#22301] The providers `objectstack serve` mounts for this configuration —
  // the app's `requires` and the always-on slate, each built from the app's
  // configuration — by `serve`'s own rules: the same token rule, table,
  // argument rule and "an explicit instance wins" match (see
  // `./required-providers.ts`). In the `extraPlugins` slot, after it, so a
  // caller's own instance is the one that stays. The harness's sharing service
  // is constructed here so the slate's `sharing` sees it held.
  const sharingPlugin = new SharingServicePlugin();
  try {
    const servedProviders = await constructServedProviders({
      config,
      held: [
        settingsPlugin,
        analyticsPlugin,
        sharingPlugin,
        ...(automationPlugin ? [automationPlugin] : []),
        ...(opts.extraPlugins ?? []),
        ...appPlugins.map((entry) => entry.plugin),
      ],
      packageRoot: hostRoot,
    });
    for (const plugin of servedProviders) {
      await kernel.use(plugin as any);
    }
  } catch (e) {
    restoreTenancyPosture();
    throw e;
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
  await kernel.use(sharingPlugin);

  // [#22301] The app's own `plugins` (resolved above), in `serve`'s slot for
  // them: after the services the boot composes itself, so an entry that shares
  // a `name` with one of THOSE supersedes it by the kernel's declared
  // last-one-wins contract, as it does under `serve`; before the route
  // surfaces. `serve` logs an entry it cannot register and boots on; a test
  // boot that went on without a plugin the app declares would pass green on a
  // composition production never runs, so here the boot stops, with the remedy.
  for (const { plugin, label } of appPlugins) {
    try {
      await kernel.use(plugin as any);
    } catch (e) {
      restoreTenancyPosture();
      throw new Error(
        `verify: the app's ${label} could not be registered: ${(e as Error).message}. bootStack mounts the ` +
          "plugins of the app's own `plugins` array as `objectstack serve` does, and does not boot on without one. " +
          'Fix that entry, or hand bootStack an instance with the same `name` in `extraPlugins`, which takes its place.',
      );
    }
  }

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
  // mirror `objectstack dev`, which wires one in development so an app with an
  // encrypted field is exercisable end-to-end. [#21499] The same instance the
  // settings service holds, so every `sys_secret` row shares one key, as in
  // `serve` — but the harness's in-process key, never the host's.
  try {
    const engine = await kernel.getServiceAsync<{ setCryptoProvider?: (p: unknown) => void }>('objectql');
    if (engine && typeof engine.setCryptoProvider === 'function') {
      engine.setCryptoProvider(cryptoProvider);
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

  // [#7762] The vacuity guard for `orgContext`. The owner bind is
  // deliberately best-effort — it swallows every failure so a login can never
  // break on org bookkeeping — which means a fixture that asked for an
  // org-bound admin and silently got an org-LESS one is exactly the shape this
  // option exists to abolish. So the boot asserts the bind rather than
  // assuming it: no `sys_member` row for the harness admin, no stack.
  if (opts.orgContext) {
    const sys = { isSystem: true } as const;
    const engine = await kernel.getServiceAsync<any>('objectql');
    const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);
    const users = rowsOf(
      await engine?.find('sys_user', { where: { email: admin.email }, limit: 1, context: sys }),
    );
    const adminUserId: string | undefined = users[0]?.id;
    const members = adminUserId
      ? rowsOf(await engine.find('sys_member', { where: { user_id: adminUserId }, limit: 1, context: sys }))
      : [];
    if (!members[0]?.organization_id) {
      await (kernel as any).shutdown?.().catch?.(() => {});
      throw new Error(
        `verify: orgContext:true did not bind the harness admin (${admin.email}) to an organization. ` +
          (adminUserId
            ? 'The user exists but holds no sys_member row, so their sessions would carry no ' +
              'activeOrganizationId and every org-scoped assertion in this fixture would be vacuous.'
            : 'No sys_user row resolved for that address — check `opts.admin` against the app the ' +
              "harness actually seeded, since the default-org bootstrap targets the platform admin.") +
          ' (cloud ADR-0081 D1 `ensureDefaultOrganization` is best-effort by design; this is the harness ' +
          'refusing to hand back a stack that quietly means less than it reads.)',
      );
    }
  }

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

  /**
   * [#11739 / #11767] Fixture users beyond the FIRST enter through the
   * invitation carve-out.
   *
   * Since #11739 the platform's default audience posture is `invite_only`:
   * only the bootstrap account (zero human users) self-registers freely, and
   * every later self-serve sign-up needs a pending invitation, an allowlisted
   * domain, or an `open` posture. The harness's `signUp` exists to mint the
   * SECOND, THIRD… fixture identity, so it lands squarely on the wall.
   *
   * The invitation lane is deliberate rather than declaring `open` on the
   * harness config — `open` and `email_domain` force `requireEmailVerification`
   * on, which stops sign-up from minting the very token this helper returns,
   * and it keeps the audience gate honestly ON the path (the carve-out is a
   * real admission verdict, not a bypass). Same choice, same reasons, as
   * plugin-auth's own `audience-gate-test-support.ts`.
   *
   * Best-effort: a stack whose engine or `sys_invitation` object is not
   * reachable simply signs up without the row and lets the gate answer.
   */
  const inviteForAudienceGate = async (email: string): Promise<void> => {
    try {
      const engine = await kernel.getServiceAsync<any>('objectql');
      if (!engine || typeof engine.insert !== 'function') return;
      await engine.insert(
        'sys_invitation',
        {
          id: `inv_verify_${Math.random().toString(36).slice(2, 10)}`,
          // [#11770] Normalized, as the invitation route stores it — the
          // audience probe reads `sys_invitation` by address, and better-auth
          // lowercases both the stored address and the registrant's.
          email: email.trim().toLowerCase(),
          status: 'pending',
          // A dedicated org id so fixtures counting THEIR invitations never
          // see these rows.
          organization_id: 'org_verify_audience_gate',
          role: 'member',
          inviter_id: 'usr_verify_audience_gate',
          expires_at: new Date(Date.now() + 3_600_000),
        },
        { context: { isSystem: true } },
      );
    } catch {
      // Best-effort -- the gate answers either way.
      //
      // [#12981] This catch is silent BY DESIGN and it is NOT a durability
      // swallow. `scripts/measure-durability-swallow-family.mjs` reports this
      // site as tier-1 DARK because membership is decided on three mechanical
      // conjuncts -- silent catch, no rethrow, an awaited write in the `try`
      // -- and the census deliberately leaves the fourth, "and the caller
      // still reports success", to a person. Here the answer is NO, on two
      // independent grounds:
      //
      //   1. NOTHING CLAIMS TO HAVE PERSISTED. This helper answers a `Promise`
      //      of `void`: no return value, no counter, no report out of which
      //      any caller could read a landed row. Its ONLY caller is `signUp`
      //      immediately below, whose very next statement POSTs
      //      `/auth/sign-up/email` -- the operation this row is a
      //      precondition for.
      //   2. THE LOSS IS ANSWERED ONE LINE LATER, LOUDLY. Under the default
      //      `invite_only` posture a missing invitation makes that POST
      //      refuse, and `signUp` throws `verify signUp failed:` carrying the
      //      audience gate's own response status and body. Under `open` or
      //      `email_domain` the sign-up succeeds on its own merits and the row
      //      was never needed. Those are the only two branches -- which is
      //      what "the gate answers either way" above means, stated here so it
      //      can be checked rather than taken on faith. The row is write-only
      //      besides: `org_verify_audience_gate` exists precisely so nothing
      //      ever reads these rows back, and nothing does.
      //
      // The case this catch was written for is an app under verification that
      // carries no `sys_invitation` object at all: there is no store to
      // persist into, so there is no durability claim to break.
      //
      // AGENTS.md "Degradation log levels" names that its third legal answer.
      // Do NOT "repair" this site by adding a log -- the fixture already
      // receives the real refusal, with its status and body, from the throw a
      // few lines down, and one durability `error` per harness sign-up is the
      // mirror-image failure that made the founding incident's `warn`
      // unreadable in the first place. A `FAILURE_PROPAGATION_SITES` entry is
      // not right here either: that declaration asserts every path OUT OF THE
      // CATCH delivers, and this one returns normally -- the delivery is the
      // caller's next call, not this frame's. (It would also go red as STALE
      // today, the way keys.ts's annotation records: the gate's
      // `DURABILITY_CRITICAL_CALLEES` has no `insert`, so it matches no seam
      // in this function.)
      //
      // Posture, load-bearing for all of the above: `@objectstack/verify`
      // boots in-process against in-memory SQLite and "never touches a real
      // database or production data" (this file's header). There is no
      // deployed plane here that could go on looking healthy while something
      // it claims is persisted did not land.
    }
  };

  const signUp = async (
    email: string,
    password = 'Member-Pass-123',
    name?: string,
  ): Promise<string> => {
    await inviteForAudienceGate(email);
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
      await (kernel as any).shutdown?.();
    } catch {
      /* best-effort */
    }
    restoreTenancyPosture();
    // [#22301] The kernel is gone, so the configuration may boot again.
    claim.release();
  };

  // The in-process handle over the SAME kernel (hotcrm#1579 step 5a). Built
  // after bootstrap so every service it resolves is the one the boot wired.
  const handle = await createHandle(kernel, ORIGIN);

  return { kernel, api, raw, signIn, signUp, apiAs, stop, ...handle };
}

const NO_OPTIONS: unique symbol = Symbol('bootStackOnce:no-options');
const SHARED_BOOTS = new WeakMap<object, Map<unknown, Promise<VerifyStack>>>();

/**
 * `bootStack`, memoised per (`config`, `opts`) IDENTITY for the life of the
 * process — the worker-scoped shared boot `packages/qa/dogfood`'s
 * `getSharedShowcase()` kept privately, promoted so a suite of many files can
 * pay one boot per vitest worker instead of one per file (a plain boot costs
 * seconds; measured at ~7.8s per file on the showcase).
 *
 * Both keys are compared by reference: pass the same `config` module export
 * and the same `opts` object (a module-level constant, or none) from every
 * file that should share, and the first caller's boot is the one everybody
 * gets — including its dev-admin sign-in state. A different `opts` object,
 * even one spelled identically, is a different stack: the memo never guesses
 * that two `SecurityPlugin` instances mean the same thing.
 *
 * A different stack over the SAME `config` is still a second boot of that
 * configuration, so the instance rule `bootStack` enforces applies to it: while
 * the first key's boot is live, a second `opts` key on that `config` is refused
 * (`RESOURCE_CONFLICT`, status 409), the returned promise rejects, and the memo
 * drops that key so a later caller boots again. To keep two stacks live at
 * once, pass the second a configuration BUILT AGAIN (its builder called once
 * more, or a fresh module instance), never a `{ ...config }` copy.
 *
 * Sharing only makes sense under `isolate: false` (files in one worker share
 * one module registry); under vitest's default isolation every file still
 * boots its own. The eligibility rules dogfood wrote for its shared stack
 * apply verbatim: no `stop()` from a sharing file (the worker's teardown
 * reclaims the in-memory stack; a `stop()` would kill it under the worker's
 * later files), no writes to shared global surfaces, and no exact-count
 * assertions over objects other files also write to.
 */
export function bootStackOnce(config: any, opts?: BootOptions): Promise<VerifyStack> {
  if (config === null || typeof config !== 'object') {
    throw new Error('verify: bootStackOnce(config) memoises by identity, so `config` must be an object');
  }
  let byOpts = SHARED_BOOTS.get(config);
  if (!byOpts) {
    byOpts = new Map();
    SHARED_BOOTS.set(config, byOpts);
  }
  const key: unknown = opts ?? NO_OPTIONS;
  let booted = byOpts.get(key);
  if (!booted) {
    booted = bootStack(config, opts);
    byOpts.set(key, booted);
    // A failed boot must not poison the memo: the next caller boots again.
    booted.catch(() => byOpts!.delete(key));
  }
  return booted;
}
