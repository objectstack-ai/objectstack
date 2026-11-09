// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * CloudConnectionPlugin — the runtime-side client surface for a cloud
 * control plane (cloud ADR-0008 Phase 1).
 *
 * Mounts the same-origin `/api/v1/cloud-connection/*` routes the Console
 * marketplace depends on:
 *
 *   GET  /api/v1/cloud-connection/status        — is this env bound to a cloud account?
 *   POST /api/v1/cloud-connection/bind/start    — begin an RFC 8628 device-code bind
 *   POST /api/v1/cloud-connection/bind/poll     — poll device token + persist the binding
 *   POST /api/v1/cloud-connection/install       — install a package via the control plane
 *   GET  /api/v1/cloud-connection/installation  — single-package installed-state probe
 *   GET  /api/v1/cloud-connection/installed     — env's full installed list (Installed view)
 *   GET  /api/v1/cloud-connection/org-packages  — owning org's own catalog ("Your organization")
 *
 * History: these routes started as app-level wiring in
 * `apps/objectos/cloud-runtime-plugins.ts` (two ad-hoc plugins; every
 * `apps/` path named in this paragraph lives in the separate
 * `objectstack-ai/cloud` repo, never in this one). cloud ADR-0008 Phase 1
 * consolidates them here as ONE plugin so both deployment shapes —
 * `apps/objectos` (multi-tenant) and `apps/objectos-ee` (single-environment)
 * — wire the same canonical implementation. cloud ADR-0008 Phase 2 moves this
 * surface into the open `@objectstack/cloud-connection` package; keep this
 * file dependency-light (structural Plugin types) so the move is mechanical.
 * The one value it takes from `@objectstack/core` is the ADR-0069 gate's
 * decision, `evaluateAuthGate`: a second copy of a security decision is the
 * defect that function exists to prevent (see `sessionFromAuthService`).
 *
 * ## Environment & session resolution — two modes
 *
 * Multi-tenant (default): the request hostname is resolved to an environment
 * via the host kernel's `env-registry` service, and the caller's session is
 * validated against that environment's OWN per-env kernel (via
 * `kernel-manager`) — auth is per-environment (ADR-0006).
 *
 * Single-environment (`singleEnvironment: true`, e.g. objectos-ee): there is
 * no registry/manager; the environment id comes from config
 * (`environmentId` / `OS_ENVIRONMENT_ID`, typically assigned when the
 * runtime is bound to a control plane) and sessions are validated against
 * the host kernel's own `auth` service. Routes degrade gracefully when the
 * id is not (yet) configured: status reports `bound:false`; the others 404.
 *
 * ## Who may manage the connection — `manage_platform_settings` (ruling 乙, #25119)
 *
 * One rule for the capability: the entry, the page and the doors refuse the
 * same callers. The rule is `manage_platform_settings`
 * ({@link CLOUD_CONNECTION_CAPABILITY}), the Integrations group's own gate
 * (`requiredPermissions` on `group_integrations` in
 * `@objectstack/platform-objects`, `apps/setup.app.ts`), which this plugin's nav
 * entry also declares on itself (`cloud-connection-ui.ts`). The three doors
 * that change the connection — `bind/start`, `bind/poll` and `unbind` — refuse
 * exactly who that entry refuses: a signed-in caller who does not hold it gets
 * `403 PERMISSION_DENIED` naming the capability, before any control-plane
 * call. `status` stays session-less (it answers every caller, so a probe can
 * tell the plugin is mounted) but narrows what it SERVES: the connection's
 * details — who approved it, for which organization, in which environment —
 * go only to a caller who passes the same check; everyone else is told
 * `bound`, `runtimeId` and `provider`.
 *
 * The page (`cloud_connection_settings`) has no gate of its own to declare: a
 * page is not permission-gated by a field (`PageSchema` declares none, and
 * says to gate the data a page shows). What it shows is this surface — the
 * panel reads `status` and drives the three doors — so the page is held at
 * the same line where its data is served. `setup.access` alone (the
 * organization administrator's default set) no longer manages the
 * connection.
 *
 * What a caller holds is read through the platform's one authorization
 * resolver (`resolveAuthzContext`), against the session this surface already
 * read — the shape `service-datasource`'s admin routes take for the same
 * capability — see `holdsPlatformSettings`.
 *
 * ## A platform-managed connection is not this runtime's to manage (ruling 甲, #25097; #25113)
 *
 * A runtime holding the env→cloud service key (`controlPlaneApiKey` /
 * `OS_CLOUD_API_KEY`, injected by the cloud into the runtimes it hosts) is
 * connected by the platform, and that key — not a device-bound credential —
 * is what it presents. Such a runtime registers no Cloud Connection Setup page
 * or nav entry, and all three connection-changing doors — `bind/start`,
 * `bind/poll` and `unbind` — answer `409 RESOURCE_CONFLICT`
 * (`PLATFORM_MANAGED_REFUSAL`), after the identity and capability checks and
 * before any control-plane call or store write. Everywhere else — self-hosted
 * or local, bound through the device-code flow — the page registers under
 * Setup → Integrations and every door behaves as described above.
 *
 * ## Why a same-origin proxy at all
 *
 * The SPA cannot call the control plane from a tenant subdomain — that is a
 * cross-origin, cross-site-cookie request the browser blocks. So the runtime
 * answers on its own origin, authorizes against the environment's session,
 * and talks to the control plane server-to-server (env→cloud service
 * credential today; the device-code-bound `sys_cloud_connection` token for
 * self-hosted runtimes).
 */

// Minimal structural plugin contract — keep this module's TYPES independent of
// @objectstack/core so the cloud ADR-0008 Phase 2 move to the open package stays
// mechanical (mirrors the other plugins in this package).
interface PluginContext {
    hook(event: string, handler: (...args: any[]) => any): void;
    getService<T = any>(name: string): T;
    /** Registers the `cloud-binding` service in `init()` (#29920). */
    registerService?(name: string, service: unknown): void;
    /**
     * The host kernel — read only for its ASYNC registry, which is what tells a
     * `tenancy` service that was never registered apart from one that broke
     * (`classifyAdmissionTenancyPosture`). Optional: a `KernelBase`-shaped host
     * has no async registry, and keeps the quiet answer.
     */
    getKernel?(): EnvironmentKernel | undefined;
    logger?: {
        info?: (msg: string) => void;
        /**
         * The GUARANTEED fallback channel (#9754). `error` stays optional — hosts do
         * inject reduced sinks — so `warn` is where a durability report lands when
         * `error` is absent, and a fallback that may itself be missing is not a
         * fallback. Call sites keep the `logger?.warn?.(…)` spelling as the backstop
         * for hosts the TYPE cannot reach; `SweepLogger` in plugin-email's
         * `outbox-sweep.ts` carries the full reasoning and the measurement.
         */
        warn: (msg: string) => void;
        error?: (msg: string, err?: unknown) => void;
    };
}
interface Plugin {
    readonly name: string;
    readonly version: string;
    init(ctx: PluginContext): Promise<void>;
    start(ctx: PluginContext): Promise<void>;
}

import { hostname } from 'node:os';
import {
    evaluateAuthGate,
    type AuthGate,
    // [#24148, #25119] The platform's ONE authorization resolver, and its loud
    // outage brand — the same pair `marketplace-install-local-plugin.ts` reads in
    // this package, so the capability a caller holds is never re-derived here.
    resolveAuthzContext,
    isAuthzStoreUnavailableError,
    userAuthGateSourceOf,
    apiKeyLifecyclePolicySourceOf,
    classifyAdmissionTenancyPosture,
    resolveControlPlaneApiKey,
    type TenancyPostureSource,
    credentialUseClientFor,
    transportPeerAddressOf,
} from '@objectstack/core';
import type { AuthSessionApi, IAuthService, IObjectQLEngine } from '@objectstack/spec/contracts';
import { inProcessSessionReadInput } from '@objectstack/types';
import { ConnectionCredentialStore } from './connection-credential-store.js';
import {
    CLOUD_BINDING_CREDENTIAL_SERVICE,
    SHARED_CREDENTIAL_REFRESH_MS,
    SharedConnectionCredentialLedger,
    fileCredentialLedger,
    sharesCloudBindingCredential,
    type BindingCredentialEngine,
    type CloudBindingCredentialReader,
    type ConnectionCredentialLedger,
} from './connection-credential-ledger.js';
import { SysCloudBindingCredential } from './sys-cloud-binding-credential.object.js';
import { declaresMultiNode } from '@objectstack/service-cluster';
import { createCloudBinding } from './cloud-binding.js';
import { CLOUD_BINDING_SERVICE, type ICloudBindingService } from '@objectstack/spec/contracts';
import { CLOUD_CONNECTION_CAPABILITY, CLOUD_CONNECTION_UI_BUNDLE } from './cloud-connection-ui.js';
import { readJsonRequestBody } from './request-json-body.js';
// [#30964] The install mode's one declaration, read by reference: never a copy of its two spellings.
import { InstallModeSchema, SEMVER_2_0_0_VERSION_PATTERN, type InstallMode } from '@objectstack/spec/kernel';
import {
    INSTALL_LOCAL_DOOR_SERVICE, grantRefusalEvent, recordUnmanagedImportEvent,
    type InstallLocalDoor, type InstallLocalDoorGrant, type UnmanagedImportAuditSurface,
} from './install-local-door-service.js';

const CLOUD_CONNECTION_PREFIX = '/api/v1/cloud-connection';

/**
 * [#24148, ruling 乙 #25119] The refusal the three connection-changing doors
 * give a signed-in caller who does not hold {@link CLOUD_CONNECTION_CAPABILITY}
 * (`manage_platform_settings`).
 *
 * `PERMISSION_DENIED` is the standard catalog's member for the condition: the
 * ADR-0112 ledger sends a generic permission condition to the standard catalog
 * rather than to a registered synonym (`error-code-ledger.zod.ts`, "Registering
 * a new code"), so nothing is registered for it — and ⛔ not `FORBIDDEN`, which
 * the install-local doors next door answer with: that spelling is a waived
 * pre-gate synonym, kept on the wire and never endorsed for new code. It is
 * also the answer `service-datasource`'s admin routes give a caller without the
 * same capability. The message names the capability, so the operator learns
 * which grant they need rather than merely that they were refused. One literal
 * for the three doors: they are one class (each changes this runtime's cloud
 * connection), and a door added later cannot copy a weaker answer.
 */
const CAPABILITY_REFUSAL = {
    code: 'PERMISSION_DENIED',
    status: 403,
    message: `Managing this runtime's cloud connection requires the \`${CLOUD_CONNECTION_CAPABILITY}\` capability.`,
} as const;

/**
 * Ruling 甲 (#25097), extended to the bind doors (#25113): the refusal the
 * three connection-changing doors — `bind/start`, `bind/poll` and `unbind` —
 * give on a platform-managed runtime, one whose control-plane credential is the
 * env→cloud service key (`platformManaged` in `start()`). Each gives it after
 * its identity and capability checks and before any control-plane call or
 * write to the local credential store: a device bind there would persist a
 * credential the service key shadows (`credential()` never presents it) while
 * presenting that key to the control plane, and could move the environment's
 * cloud-side connection row through a door this runtime cannot act on.
 *
 * `RESOURCE_CONFLICT` / 409, no code minted, on the same rule
 * {@link CAPABILITY_REFUSAL} follows: the ADR-0112 ledger sends a generic
 * condition to the standard catalog rather than to a registered synonym, and
 * the catalog's 409 member is the one for a refusal that comes from the
 * runtime's state rather than from the request — the same answer this
 * package's install-local door gives when a writable base holds a package's
 * namespace (`marketplace-install-local-plugin.ts`). The message carries the
 * meaning: the platform manages the connection, so nothing here can make or
 * end it. It names no remedy, because this runtime has none to offer. One
 * literal for the three doors, for the reason {@link CAPABILITY_REFUSAL} gives.
 */
const PLATFORM_MANAGED_REFUSAL = {
    code: 'RESOURCE_CONFLICT',
    status: 409,
    message: 'This runtime\'s cloud connection is managed by the platform, so it cannot be connected or disconnected here: '
        + 'its control-plane credential is the environment service key the platform provides. Nothing was sent to the cloud, '
        + 'and nothing was stored or cleared.',
} as const;

/**
 * The slice of a kernel this surface reads services from: the environment's
 * own kernel (multi-tenant, through `kernel-manager`) or the host's.
 */
interface EnvironmentKernel {
    getServiceAsync?<T = unknown>(name: string): Promise<T>;
    getService?<T = unknown>(name: string): T;
}

/** [#30964] The slice of the `kernel-manager` service the unmanaged-grant copy reads: the environment's own kernel. */
interface EnvironmentKernelManager {
    getOrCreate?(environmentId: string): Promise<EnvironmentKernel | undefined>;
}

/** What the auth service's in-process session read answers, as `AuthSessionApi` declares it. */
type SessionRead = Awaited<ReturnType<NonNullable<AuthSessionApi['getSession']>>>;

/**
 * [#24150] The slice of the `protocol` service this surface reads: the
 * discovery document's `version`, which is the release `GET
 * /api/v1/discovery` reports for this server.
 */
interface DiscoveryVersionSource {
    getDiscovery?(): Promise<{ version?: unknown }>;
}

/**
 * A signed-in caller of this surface, and the ADR-0069 posture its session
 * carries (`authGate`, present only for a session the policy holds).
 */
interface ResolvedSession {
    userId: string;
    authGate?: AuthGate;
    /**
     * [#24148] What the shared resolver needs to judge what THIS session holds:
     * the session read itself (handed back to the resolver, so it judges the
     * session this door admitted rather than reading a second one), the `auth`
     * service that answered it, and — multi-tenant — the environment's own
     * kernel, whose grants are the ones that apply.
     */
    readFrom: {
        sessionData: SessionRead | null;
        authService: IAuthService | undefined;
        kernel?: EnvironmentKernel;
    };
}

/**
 * The one message every `ENVIRONMENT_NOT_FOUND` refusal on this surface carries.
 *
 * `ApiErrorSchema.message` is REQUIRED, and eight exits here used to emit
 * `error: { code }` alone — so `body.error.message` read `undefined` on the
 * wire. That is the #3843 class exactly, and the Console had already grown the
 * consumer-side accommodation it produces: `CloudConnectionPanel` displays
 * `body?.error?.message ?? body?.error?.code`, i.e. it shows a machine code to a
 * human because the readable half was never sent. One constant rather than eight
 * literals, because the condition is one condition: the request did not resolve
 * to an environment.
 */
const ENVIRONMENT_NOT_FOUND_MESSAGE = 'Could not resolve an environment for this request host.';

/**
 * [#30964, cloud#3624 ruling A] The install mode a `POST /install` body asks
 * for: `install_mode` (the control plane's own spelling) or `installMode` (the
 * install-local door's), parsed against {@link InstallModeSchema} by reference.
 * `mode` is `undefined` when the body names none — a managed install, as every
 * install was before the key. A value the schema refuses, or the two spellings
 * naming different modes, is a 400: never read as `managed`.
 */
function installModeOf(body: any): { ok: true; mode: InstallMode | undefined } | { ok: false; message: string } {
    const snake = body?.install_mode;
    const camel = body?.installMode;
    if (snake !== undefined && camel !== undefined && snake !== camel) {
        return {
            ok: false,
            message: `\`install_mode\` (${JSON.stringify(snake)}) and \`installMode\` (${JSON.stringify(camel)}) disagree. `
                + 'Send one of them. Nothing was installed.',
        };
    }
    const raw = snake !== undefined ? snake : camel;
    if (raw === undefined) return { ok: true, mode: undefined };
    const parsed = InstallModeSchema.safeParse(raw);
    if (!parsed.success) {
        return {
            ok: false,
            message: `\`install_mode\` must be 'managed' or 'unmanaged', received ${JSON.stringify(raw)}. `
                + 'Omit it for a managed install. Nothing was installed.',
        };
    }
    return { ok: true, mode: parsed.data };
}

/**
 * [#31799] The package version a `POST /install` body names: `version`, the
 * spelling the control plane's install action reads, its grant echoes
 * (`data.version`) and the install-local door takes. One spelling only.
 * `version` is `undefined` when the body names none (absent or `null`): the
 * latest version, as every install was before the key, and the control plane
 * is then sent no `version`. Anything else must be a SemVer 2.0.0 string
 * ({@link SEMVER_2_0_0_VERSION_PATTERN}, the grammar a package version row
 * carries); a value it refuses is a 400 here, never read as "latest". Whether
 * that version exists, is published, or may be installed is the control
 * plane's to answer.
 */
function packageVersionOf(body: any): { ok: true; version: string | undefined } | { ok: false; message: string } {
    const raw = body?.version;
    if (raw === undefined || raw === null) return { ok: true, version: undefined };
    const version = typeof raw === 'string' ? raw.trim() : undefined;
    if (version === undefined || !SEMVER_2_0_0_VERSION_PATTERN.test(version)) {
        return {
            ok: false,
            message: `\`version\` must be a SemVer 2.0.0 string (e.g. 1.2.3, 2.0.0-beta.1), received ${JSON.stringify(raw)}. `
                + 'Omit it to install the latest version. Nothing was installed.',
        };
    }
    return { ok: true, version };
}

export interface CloudConnectionPluginConfig {
    /**
     * Control-plane base URL. Default: `OS_CLOUD_URL` (read lazily at
     * kernel:ready), then the ObjectStack-operated default. An explicit `''`,
     * or a decline spelling (`off`, `none`, `local`, `disabled`), means "cloud
     * not configured": the routes answer `CLOUD_UNCONFIGURED` and the
     * `cloud-binding` service's `controlPlaneUrl()` answers `''`.
     */
    controlPlaneUrl?: string;
    /** env→cloud service credential. Default: `OS_CLOUD_API_KEY`. */
    controlPlaneApiKey?: string;
    /** OAuth device-flow client id. Default: `OS_CLI_CLIENT_ID` → `objectstack-cli`. */
    deviceClientId?: string;
    /**
     * Fixed environment id (single-environment runtimes). Default:
     * `OS_ENVIRONMENT_ID`. In multi-tenant mode leave unset — the id is
     * resolved per-request from the hostname via `env-registry`.
     */
    environmentId?: string;
    /**
     * Single-environment mode (objectos-ee shipped shape): skip the
     * env-registry/kernel-manager lookups and validate sessions against the
     * host kernel's own `auth` service.
     */
    singleEnvironment?: boolean;
    /**
     * Override the on-disk credential store location. Defaults to
     * `<OS_HOME>/cloud-connection.json`, or `<cwd>/.objectstack/cloud-connection.json`
     * when `OS_HOME` is unset — where the bind flow persists the `oscc_…`
     * runtime bearer for self-hosted runtimes. The default moves a file an
     * earlier release left under the working directory once, at boot; an
     * explicit path moves nothing.
     *
     * A single node only: with several replicas declared over the Redis cluster
     * driver the credential lives in the shared database row instead
     * (`connection-credential-ledger.ts`), and this file is read once, to move
     * a binding made before the deployment was scaled out.
     */
    credentialPath?: string;
    /**
     * How often, in ms, a replica re-reads the shared binding credential for
     * the `cloud-binding` service's synchronous readers. Default
     * {@link SHARED_CREDENTIAL_REFRESH_MS}. Read only when replicas are
     * declared over the Redis cluster driver; a single node has nothing to
     * re-read. The plugin's own doors re-read at every request regardless.
     */
    sharedCredentialRefreshMs?: number;
}

export class CloudConnectionPlugin implements Plugin {
    readonly name = 'com.objectstack.cloud.connection';
    readonly version = '0.3.0';

    /** Services init() registers on every path (ADR-0116). */
    readonly providesServices = [CLOUD_BINDING_SERVICE, CLOUD_BINDING_CREDENTIAL_SERVICE];

    /**
     * [#31554] Ordered after the data engine and the cluster service when
     * either is composed (ADR-0116): `init()` reads the cluster driver to choose
     * where the binding credential lives, and with replicas declared registers
     * its object through the `manifest` service ObjectQL provides. Soft: a
     * composition with neither is a single node, and the local file serves it.
     */
    readonly optionalDependencies = ['com.objectstack.engine.objectql', 'com.objectstack.service.cluster'];

    private readonly cfg: CloudConnectionPluginConfig;
    /** The single node's credential file — and, scaled out, the binding a replica moves into the shared row once. */
    private readonly store: ConnectionCredentialStore;
    /**
     * [#31554] Where the binding credential is read and written: the file
     * above on a single node, the shared database row when replicas are
     * declared over the Redis cluster driver. Chosen once, in `init()`.
     */
    private ledger: ConnectionCredentialLedger;
    /** The read half of {@link ledger}, registered as {@link CLOUD_BINDING_CREDENTIAL_SERVICE}; follows the ledger `init()` chose. */
    private readonly credentialReader: CloudBindingCredentialReader;
    /** The shared row's re-read for synchronous readers; set only on shared replicas. */
    private refreshTimer: ReturnType<typeof setInterval> | undefined;
    /** The last shared-read failure reported, so an outage is said once rather than once per re-read. */
    private lastSharedReadFailure: string | undefined;
    /**
     * [#29920] This server's cloud binding: the ONE reader of the effective
     * control-plane credential. Registered as the `cloud-binding` service, and
     * the routes below read the same instance, never a copy of its rule.
     */
    private readonly binding: ICloudBindingService;

    constructor(config: CloudConnectionPluginConfig = {}) {
        this.cfg = config;
        this.store = new ConnectionCredentialStore(config.credentialPath);
        this.ledger = fileCredentialLedger(this.store);
        const plugin = this;
        this.credentialReader = {
            get shared() { return plugin.ledger.shared; },
            read: () => plugin.ledger.read(),
            load: () => plugin.ledger.load(),
        };
        this.binding = createCloudBinding({
            controlPlaneApiKey: config.controlPlaneApiKey,
            controlPlaneUrl: config.controlPlaneUrl,
            store: { read: () => this.ledger.read() },
        });
    }

    /**
     * Registers the `cloud-binding` service and the credential reader, and
     * chooses where the binding credential lives; the HTTP wiring waits for
     * kernel:ready.
     */
    init = async (ctx: PluginContext): Promise<void> => {
        ctx.registerService?.(CLOUD_BINDING_SERVICE, this.binding);
        ctx.registerService?.(CLOUD_BINDING_CREDENTIAL_SERVICE, this.credentialReader);
        this.moveLegacyCredentialFile(ctx);
        this.ledger = this.chooseLedger(ctx);
    };

    /**
     * A single node's credential file follows `OS_HOME`
     * (`resolveConnectionCredentialPath`); a release before that wrote it under
     * the working directory. Move that file once, before anything reads the
     * binding — the shared row's adoption at `kernel:ready` included — so the
     * node stays bound across the upgrade. An explicit `credentialPath` moves
     * nothing.
     *
     * A failed move is a consistency failure, not a choice: the binding is on
     * disk where this node no longer reads it, so the node reports itself
     * unbound and an online licence falls back to Community while everything
     * else looks healthy. It is reported once, at `error`, with the fix.
     */
    private moveLegacyCredentialFile(ctx: PluginContext): void {
        const from = this.store.legacyPath;
        try {
            const moved = this.store.moveLegacyFile();
            if (moved) {
                ctx.logger?.info?.(
                    `[CloudConnectionPlugin] moved the cloud binding credential from ${moved.from} to ${moved.to}: `
                        + 'the file now follows OS_HOME, so it survives a container recreate',
                );
            }
        } catch (err) {
            this.reportError(
                ctx,
                `[CloudConnectionPlugin] the cloud binding credential in ${from} could not be moved to ${this.store.path}, `
                    + 'where this node now reads it, so the node reports itself unbound and an online licence falls back to '
                    + 'Community. Move the file there by hand (mode 0600) and restart, or connect again (Setup, Cloud Connection): '
                    + `${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /** Stops the shared row's re-read. */
    destroy = async (): Promise<void> => {
        this.stopSharedRefresh();
    };

    /**
     * [#31554] Where this boot keeps the binding credential.
     *
     * The shared database row exactly when BOTH hold
     * ({@link sharesCloudBindingCredential}): replicas are declared
     * (`declaresMultiNode`, the split-brain guard's own predicate) and the
     * cluster service runs the Redis driver. Anything else — a single node, the
     * in-process driver, any other driver — gets the local file with nothing
     * registered, nothing logged and nothing read differently. Read in `init()`: the cluster plugin and ObjectQL init
     * first when composed ({@link optionalDependencies}), so an absent cluster
     * service here is a fact, not a race.
     *
     * Replicas declared over the Redis driver with no `manifest` service to
     * register the object through is a consistency failure, not a choice: each
     * replica would keep its own file, and a bind would reach one of them. It is
     * reported once, at `error`, with the consequence and the fix, and the file
     * serves this replica alone.
     */
    private chooseLedger(ctx: PluginContext): ConnectionCredentialLedger {
        if (!declaresMultiNode(process.env)) return this.ledger;
        let driver: string | undefined;
        try {
            const cluster = ctx.getService<{ driver?: unknown } | undefined>('cluster');
            driver = typeof cluster?.driver === 'string' ? cluster.driver : undefined;
        } catch { /* no cluster service composed */ }
        if (!sharesCloudBindingCredential(process.env, driver)) return this.ledger;
        try {
            ctx.getService<{ register(m: unknown): void }>('manifest').register({
                id: 'com.objectstack.cloud.connection.credential',
                name: 'Cloud Binding Credential',
                version: '1.0.0',
                type: 'plugin',
                scope: 'system',
                // No `defaultDatasource`, deliberately: the row rides the
                // engine's default datasource, the one `sys_secret` (the
                // platform-objects manifest, which names none) seals its
                // token into. So the row and its secret share one database —
                // the one every replica connects to and the one the pre-boot
                // read opens. Naming `cloud` here would split them on any
                // deployment that registers a `cloud` datasource.
                namespace: 'sys',
                objects: [SysCloudBindingCredential],
            });
        } catch {
            // The registry's own error is not interpolated: this is the line an
            // operator acts on, and it must say what to do.
            this.reportError(
                ctx,
                '[CloudConnectionPlugin] several replicas are declared over the Redis cluster driver, but no manifest '
                    + 'service is composed to register the shared binding credential '
                    + '(sys_cloud_binding_credential). Each replica keeps its own credential file, so a bind made on one '
                    + 'replica is not seen by the others and their online licence checks present no credential. Compose the '
                    + 'data engine (ObjectQL) on every replica, or declare a single replica.',
            );
            return this.ledger;
        }
        ctx.logger?.info?.(
            '[CloudConnectionPlugin] several replicas are declared over the Redis cluster driver: the cloud binding '
                + 'credential is kept in the shared database (sys_cloud_binding_credential), '
                + 'encrypted with the host crypto provider, and every replica reads it',
        );
        return new SharedConnectionCredentialLedger(() => this.resolveDataEngine(ctx));
    }

    /**
     * One `error` line, on the logger's own receiver (its channels are methods
     * that reach for `this`); a logger without an `error` channel gets `warn`.
     */
    private reportError(ctx: PluginContext, message: string): void {
        const logger = ctx.logger;
        if (!logger) return;
        if (typeof logger.error === 'function') logger.error(message);
        else logger.warn?.(message);
    }

    /** The data engine the shared row is read and written through — ObjectQL, resolved at call time. */
    private resolveDataEngine(ctx: PluginContext): BindingCredentialEngine | undefined {
        for (const name of ['objectql', 'data']) {
            try {
                const engine = ctx.getService<BindingCredentialEngine | undefined>(name);
                if (engine && typeof engine.find === 'function' && typeof engine.insert === 'function') return engine;
            } catch { /* not registered under this name */ }
        }
        return undefined;
    }

    /**
     * Re-read the shared row (a no-op on a single node). Never throws: a read
     * that fails leaves the last copy in place and is reported once per
     * distinct failure, at `error` — persisted and runtime state now disagree
     * (a bind or an unbind made on a peer is not seen here) while this replica
     * keeps looking healthy, so the line names that and the fix.
     */
    private async refreshShared(ctx: PluginContext): Promise<void> {
        if (!this.ledger.shared) return;
        try {
            await this.ledger.load();
            this.lastSharedReadFailure = undefined;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message === this.lastSharedReadFailure) return;
            this.lastSharedReadFailure = message;
            this.reportError(
                ctx,
                '[CloudConnectionPlugin] the shared cloud binding credential could not be read, so this replica keeps acting on '
                    + 'the binding it last read: a bind or a disconnect made on another replica is not seen here until a read '
                    + 'succeeds. Restore the database connection, and give every replica the same secret key (OS_SECRET_KEY '
                    + `with the local crypto provider): ${message}`,
            );
        }
    }

    /**
     * [#31554] At `kernel:ready` on shared replicas: move a binding a single
     * node left in its file into the shared row (once, when the row is empty),
     * read the row, and keep re-reading it for the synchronous readers.
     */
    private async startShared(ctx: PluginContext): Promise<void> {
        const ledger = this.ledger;
        if (!(ledger instanceof SharedConnectionCredentialLedger)) return;
        try {
            if (await ledger.adoptFrom(this.store)) {
                ctx.logger?.info?.(
                    `[CloudConnectionPlugin] moved the cloud binding credential from ${this.store.path} into the shared database; `
                        + 'while several replicas are declared that file is not read again',
                );
            }
        } catch (err) {
            // Durability: the binding this node held is not where the replicas
            // read it, and nothing else will say so.
            this.reportError(
                ctx,
                `[CloudConnectionPlugin] the cloud binding credential in ${this.store.path} could not be moved into the shared `
                    + 'database, so no replica presents it to the cloud. Connect again from any replica (Setup, Cloud '
                    + `Connection): ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        await this.refreshShared(ctx);
        this.stopSharedRefresh();
        const every = this.cfg.sharedCredentialRefreshMs ?? SHARED_CREDENTIAL_REFRESH_MS;
        this.refreshTimer = setInterval(() => { void this.refreshShared(ctx); }, every);
        this.refreshTimer.unref?.();
        ctx.hook('kernel:shutdown', async () => { this.stopSharedRefresh(); });
    }

    private stopSharedRefresh(): void {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.refreshTimer = undefined;
    }

    start = async (ctx: PluginContext): Promise<void> => {
        ctx.hook('kernel:ready', async () => {
            // [#31554] Shared replicas read the binding before anything else:
            // the `cloud-binding` service answers from that read whether or not
            // the routes below mount.
            await this.startShared(ctx);
            const httpServer: any = (() => { try { return ctx.getService('http-server'); } catch { return undefined; } })();
            if (!httpServer || typeof httpServer.getRawApp !== 'function') {
                ctx.logger?.warn?.('[CloudConnectionPlugin] http-server unavailable — routes not mounted');
                return;
            }
            const rawApp = httpServer.getRawApp();
            /**
             * [#31554] On shared replicas every door re-reads the binding the
             * replicas share before it runs, so a bind or an unbind made on a
             * peer is what this door acts on. A single node mounts each handler
             * as it is: the file is read where the handler reads it.
             */
            const door = <H extends (c: any) => Promise<any>>(handler: H): H => (this.ledger.shared
                ? (async (c: any) => { await this.refreshShared(ctx); return handler(c); }) as H
                : handler);
            // Env vars are read here (not at construction) so a host can set
            // them between config load and kernel boot — preserves the
            // behavior of the original app-level wiring. [#30762] The URL is
            // the `cloud-binding` service's answer, the one the push relay
            // sender reads too: an explicit empty option means "cloud not
            // configured" for both, and an absent one falls through to
            // `OS_CLOUD_URL`, then the default, as `resolveCloudUrl` does.
            const cloudUrl = this.binding.controlPlaneUrl();
            const cloudApiKey = resolveControlPlaneApiKey(this.cfg.controlPlaneApiKey);
            const deviceClientId = (this.cfg.deviceClientId ?? process.env.OS_CLI_CLIENT_ID ?? 'objectstack-cli').trim();
            const deviceScope = 'openid profile email';

            /**
             * Ruling 甲 (#25097): is this runtime's cloud connection
             * PLATFORM-MANAGED? It is exactly when the effective control-plane
             * credential is the env→cloud service key
             * (`controlPlaneApiKey` / `OS_CLOUD_API_KEY`, which the cloud
             * injects into the runtimes it hosts) — the one fact `credential()`
             * below is written in terms of, so the two can never disagree.
             *
             * A managed connection belongs to the platform, so this runtime
             * offers no way to manage it: the Setup page and its nav entry are
             * not registered, and `POST /bind/start`, `POST /bind/poll` and
             * `POST /unbind` are refused ({@link PLATFORM_MANAGED_REFUSAL}).
             * Read once, here: the key is resolved at `kernel:ready` and does
             * not change while the runtime is up.
             */
            const platformManaged = cloudApiKey !== '';

            // Effective control-plane credential, resolved PER REQUEST:
            // cloud-hosted runtimes carry the env→cloud service key; a
            // self-hosted runtime presents the `oscc_…` bearer the bind flow
            // persisted. Lazy so a bind that completes while the runtime is
            // up takes effect without a restart. [#29920] Read through the
            // `cloud-binding` service this plugin registers, the same instance
            // the push relay sender reads, so the rule has one owner.
            const credential = (): string => this.binding.credential();
            const authHeaders = (): Record<string, string> => {
                const cred = credential();
                return cred ? { Authorization: `Bearer ${cred}` } : {};
            };

            /**
             * [#24150] The release this server reports to the cloud as
             * `runtime_version`: on the approval link `bind/start` returns,
             * and in the registration claim `bind/poll` sends to `/bind`.
             *
             * A set `OS_RUNTIME_VERSION` is the operator's stamp and wins, as
             * it always has. Unset, the value is the one `GET
             * /api/v1/discovery` reports, read from the discovery document
             * itself through the `protocol` service when the handler runs —
             * never a copy of discovery's resolver, so the two answers cannot
             * drift. ⛔ Not this plugin's own `version`: that names the
             * plugin, not the release the approver is authorizing.
             *
             * A read that yields nothing (no `protocol` service, or one that
             * throws) sends nothing; both sites already drop an empty value.
             * No version is honest, while a wrong one is what the approval
             * page would show as fact.
             */
            const reportedRuntimeVersion = async (): Promise<string | undefined> => {
                const stamped = process.env.OS_RUNTIME_VERSION;
                if (stamped !== undefined) return stamped || undefined;
                try {
                    const discovery = await ctx.getService<DiscoveryVersionSource>('protocol')?.getDiscovery?.();
                    return typeof discovery?.version === 'string' && discovery.version ? discovery.version : undefined;
                } catch {
                    return undefined;
                }
            };

            const hostOf = (c: any): string => {
                try { return new URL(c.req.url).hostname; } catch { return ''; }
            };

            const resolveEnvironmentId = async (c: any): Promise<string | undefined> => {
                const fixed = (this.cfg.environmentId ?? process.env.OS_ENVIRONMENT_ID ?? '').trim();
                // The CLI's local-dev defaults ('env_local' / 'proj_local')
                // identify the LOCAL kernel, not a cloud environment — never
                // present them to the control plane as one (they would 404
                // the bind and resurrect the phantom-environment confusion
                // ADR runtime-identity-binding removes).
                if (fixed && fixed !== 'env_local' && fixed !== 'proj_local') return fixed;
                if (this.cfg.singleEnvironment) {
                    // A completed bind persisted the environment id — a
                    // self-hosted runtime needs no OS_ENVIRONMENT_ID after it.
                    return this.ledger.read()?.environmentId || undefined;
                }
                try {
                    const envRegistry = ctx.getService<any>('env-registry');
                    const env = await envRegistry?.resolveByHostname?.(hostOf(c));
                    return env?.environmentId;
                } catch {
                    return undefined;
                }
            };

            // SDUI surface: the binding page + Setup-nav entry ship with the
            // plugin as metadata (ADR-0029 K2); the console only provides the
            // registered `cloud-connection:panel` widget. Best-effort — a
            // kernel without a manifest service simply has no Setup entry.
            //
            // Ruling 甲 (#25097): a platform-managed runtime registers neither.
            // Its connection is the platform's, so a page offering to connect
            // or disconnect it would offer what this runtime cannot do. The
            // absence is said once, here, rather than left to be diagnosed.
            if (platformManaged) {
                ctx.logger?.info?.(
                    '[CloudConnectionPlugin] the cloud connection is platform-managed (the control-plane credential is the '
                    + 'environment service key): the Cloud Connection Setup page and its navigation entry are not registered, '
                    + 'and connecting or disconnecting here is refused',
                );
            } else {
                try {
                    const manifest = ctx.getService<{ register(m: any): void }>('manifest');
                    manifest?.register?.(CLOUD_CONNECTION_UI_BUNDLE);
                } catch { /* no manifest service — headless kernel */ }
            }

            const sessionFromAuthService = async (
                authSvc: any,
                rawReq: Request,
                kernel?: EnvironmentKernel,
            ): Promise<ResolvedSession | null> => {
                const api = typeof authSvc?.getApi === 'function' ? await authSvc.getApi() : authSvc?.api ?? authSvc;
                // [#22258] The in-process session-read rule: a request carrying a
                // session cookie reads without renewal, because this route's
                // response never carries a renewed cookie. [#24222] Typed as
                // `AuthSessionApi` declares the answer (`api` itself is `any`).
                const session: SessionRead | null = await api?.getSession?.(inProcessSessionReadInput(rawReq.headers));
                const userId = session?.user?.id ? String(session.user.id) : undefined;
                if (!userId) return null;
                // ADR-0069: the ONE consult of the authentication-policy gate for
                // every door on this surface, asked of the session this read
                // returned (the posture rides its user, computed by plugin-auth's
                // `customSession` enrichment only while a gate feature is active).
                // Both modes read here: the host kernel's `auth` (single-env) and
                // the environment's own kernel's (multi-tenant).
                //
                // No request path is passed, so the allow-list can grant no
                // exemption (an empty path earns none, #7898). Nothing this plugin
                // mounts is a remediation or bootstrap route.
                const authGate = evaluateAuthGate(session?.user, '');
                const readFrom: ResolvedSession['readFrom'] = { sessionData: session, authService: authSvc, ...(kernel ? { kernel } : {}) };
                return authGate ? { userId, authGate, readFrom } : { userId, readFrom };
            };

            /**
             * ADR-0069: a session the authentication policy HOLDS (an expired
             * password, enforced MFA not yet enrolled) is gated out of every
             * protected resource until it remediates. Every door that resolves
             * a session answers it this way, before its own 401 and before any
             * control-plane call: REST's answer (`403` with the gate's own
             * `code` and `message`), in this surface's envelope.
             */
            const refuseHeldSession = (c: any, gate: AuthGate) =>
                c.json({ success: false, error: { code: gate.code, message: gate.message } }, 403);

            const resolveSession = async (environmentId: string, rawReq: Request): Promise<ResolvedSession | null> => {
                try {
                    if (this.cfg.singleEnvironment) {
                        // Single-env: the host kernel owns auth.
                        let authSvc: any;
                        try { authSvc = ctx.getService('auth'); } catch { /* ignore */ }
                        if (!authSvc) return null;
                        return await sessionFromAuthService(authSvc, rawReq);
                    }
                    // Multi-tenant: auth lives on the environment's own kernel.
                    const kernelManager = ctx.getService<any>('kernel-manager');
                    const kernel = await kernelManager?.getOrCreate?.(environmentId);
                    let authSvc: any;
                    try { authSvc = await kernel?.getServiceAsync?.('auth'); } catch { /* ignore */ }
                    if (!authSvc) { try { authSvc = kernel?.getService?.('auth'); } catch { /* ignore */ } }
                    if (!authSvc) return null;
                    return await sessionFromAuthService(authSvc, rawReq, kernel ?? undefined);
                } catch {
                    return null;
                }
            };

            /**
             * [#24148, ruling 乙 #25119] Does the caller this surface admitted
             * hold {@link CLOUD_CONNECTION_CAPABILITY}
             * (`manage_platform_settings`)? The ONE reading of the grant on this
             * surface: the three connection-changing doors and `status`'s
             * full-record branch all ask it, so no second reading can disagree.
             *
             * ## Asked of the platform's one resolver, never re-derived
             *
             * `resolveAuthzContext` (`@objectstack/core`, guarded by
             * `check:authz-resolver`) is the single place a request's grants are
             * aggregated — `sys_member` → `sys_user_position` → permission sets,
             * position-bound and user-bound alike, with a stale organization
             * claim dropped under a walled posture. The install-local doors in
             * this package and the datasource admin family (whose routes gate on
             * this same capability, #9593) read its `systemPermissions` the same
             * way; this reads that field and nothing else.
             *
             * ## Judged on the session this surface already admitted
             *
             * The identity question stays where it was (`resolveSession`, the
             * same read for all seven session doors), so WHO is admitted does
             * not move — this only adds what they must hold. The resolver is
             * handed that session read back (no second read) and the request's
             * headers, and its answer counts only when it resolved the SAME
             * principal through the SAME credential: an API key riding along
             * resolves first inside the resolver, and its owner's grants are
             * not this session's, so they never admit it. That keeps the change
             * a pure narrowing — no credential this surface refused becomes one
             * it accepts.
             *
             * ## Grants come from where the session came from
             *
             * Multi-tenant, the environment's own kernel answers (its `objectql`
             * holds its grants, its `tenancy` its posture); single-environment,
             * the host's. With no data engine there are no grants to hold, so
             * the answer is `false` — fail closed.
             *
             * ## An outage is not a denial
             *
             * A permission store that could not be READ licenses no verdict, so
             * `AuthzStoreUnavailableError` (from the resolver or the tenancy
             * classification) is re-raised to the host's thrown-envelope render
             * (`503 SERVICE_UNAVAILABLE`) rather than answered as "does not
             * hold". Any other fault fails closed.
             */
            const holdsPlatformSettings = async (
                rawReq: Request,
                caller: ResolvedSession,
                // [#31898] The transport's own peer address (`transportPeerAddressOf(c)`),
                // for the `credential_use` row an API key this read admits writes.
                remoteAddress: string | undefined,
            ): Promise<boolean> => {
                const { sessionData, authService, kernel } = caller.readFrom;
                let ql: IObjectQLEngine | undefined;
                if (kernel) {
                    try { ql = await kernel.getServiceAsync?.<IObjectQLEngine>('objectql'); } catch { /* not registered */ }
                    if (!ql) { try { ql = kernel.getService?.<IObjectQLEngine>('objectql'); } catch { /* not registered */ } }
                } else {
                    try { ql = ctx.getService<IObjectQLEngine>('objectql'); } catch { /* no data engine */ }
                }
                // The posture is an authorization INPUT (the walled postures drop
                // a stale organization claim). Read through the async registry
                // only, so a `tenancy` service that BROKE is the loud outage and
                // one never registered is the quiet `undefined`.
                const tenancyKernel = kernel ?? ctx.getKernel?.();
                const tenancyPosture = tenancyKernel && typeof tenancyKernel.getServiceAsync === 'function'
                    ? await classifyAdmissionTenancyPosture(() => tenancyKernel.getServiceAsync!<TenancyPostureSource>('tenancy'))
                    : undefined;
                try {
                    const authz = await resolveAuthzContext({
                        ql,
                        headers: rawReq.headers,
                        getSession: async () => sessionData,
                        tenancyPosture,
                        userAuthGates: userAuthGateSourceOf(authService),
                        apiKeyLifecycle: apiKeyLifecyclePolicySourceOf(authService),
                        // [#31898] Where the request came from, for the `credential_use` row an
                        // admitted API key writes; the auth service applies the trust rule.
                        client: credentialUseClientFor(authService, { headers: rawReq.headers, remoteAddress }),
                    });
                    if (authz.credential !== 'session' || authz.userId !== caller.userId) return false;
                    return Array.isArray(authz.systemPermissions) && authz.systemPermissions.includes(CLOUD_CONNECTION_CAPABILITY);
                } catch (err) {
                    if (isAuthzStoreUnavailableError(err)) throw err;
                    return false;
                }
            };

            /** [#24148, #25119] The one `403` the three connection-changing doors give a caller without the capability. */
            const refuseWithoutPlatformSettings = (c: any) =>
                c.json({ success: false, error: { code: CAPABILITY_REFUSAL.code, message: CAPABILITY_REFUSAL.message } }, CAPABILITY_REFUSAL.status);

            /**
             * [#25097, #25113] The one `409` the three connection-changing doors
             * give on a platform-managed runtime. Each door asks it in the same
             * position: after its identity and capability checks, so a caller
             * who may not manage the connection learns nothing about how it is
             * held, and before any control-plane call or store write.
             */
            const refusePlatformManaged = (c: any) =>
                c.json({ success: false, error: { code: PLATFORM_MANAGED_REFUSAL.code, message: PLATFORM_MANAGED_REFUSAL.message } }, PLATFORM_MANAGED_REFUSAL.status);

            /**
             * [#24148, #25119] What `status` serves this caller. Everyone is told
             * whether the runtime is bound, its runtime id and the provider —
             * enough for a probe, and for the Console to pick its panel. The rest
             * (the environment id and the control plane's `connection` record:
             * who approved the bind, for which organization) is served only to a
             * caller who holds {@link CLOUD_CONNECTION_CAPABILITY}, the rule the
             * entry to the panel that shows it and the doors beside it follow.
             *
             * `status` never refuses: no session, a session the ADR-0069 policy
             * holds, and a session without the capability all get the narrowed
             * answer, never a `401`/`403` — the route stays session-less in what
             * it answers, and narrows only what it serves. For the same reason a
             * permission store that cannot be read does not turn `status` into
             * a `503`: the details are withheld (nothing was established that
             * would license serving them) and the outage is logged, while the
             * three connection-changing doors re-raise it.
             */
            const servedStatus = async (
                environmentId: string | undefined,
                rawReq: Request,
                remoteAddress: string | undefined,
                full: { environmentId: string | null; runtimeId: string | null; bound: boolean; provider: string; connection: unknown },
            ) => {
                const caller = await resolveSession(environmentId ?? '', rawReq);
                try {
                    if (caller && !caller.authGate && await holdsPlatformSettings(rawReq, caller, remoteAddress)) return full;
                } catch (err) {
                    if (!isAuthzStoreUnavailableError(err)) throw err;
                    ctx.logger?.warn?.(`[CloudConnectionPlugin] status served without the connection details — ${err.message}`);
                }
                return { bound: full.bound, runtimeId: full.runtimeId, provider: full.provider };
            };

            // GET /status — is this runtime bound to a cloud account? Answers
            // every caller; what it SERVES narrows to `bound` / `runtimeId` /
            // `provider` unless the caller holds `manage_platform_settings`
            // (#24148, #25119, `servedStatus`).
            rawApp.get(`${CLOUD_CONNECTION_PREFIX}/status`, door(async (c: any) => {
                const environmentId = await resolveEnvironmentId(c);
                const stored = this.ledger.read();
                const runtimeId = stored?.runtimeId;
                if (!environmentId && !this.cfg.singleEnvironment) {
                    return c.json({ success: false, error: { code: 'ENVIRONMENT_NOT_FOUND', message: ENVIRONMENT_NOT_FOUND_MESSAGE } }, 404);
                }
                const serve = async (full: Parameters<typeof servedStatus>[3]) =>
                    c.json({ success: true, data: await servedStatus(environmentId, c.req.raw, transportPeerAddressOf(c), full) });
                // A single-env runtime with no env id and no credential is
                // simply not bound yet — valid state, not an error.
                if (!environmentId && !credential()) {
                    return serve({ environmentId: null, runtimeId: runtimeId ?? null, bound: false, provider: 'objectstack-cloud', connection: null });
                }
                // Prefer the real sys_cloud_connection from the control plane.
                // The oscc_ bearer self-identifies; service-key callers query
                // by environment_id (cloud-hosted) or runtime_id (claim).
                if (cloudUrl) {
                    // Built inside the `try`, served outside it: the fetch's
                    // fall-through must never swallow a fault of `servedStatus`.
                    let fromControlPlane: Parameters<typeof servedStatus>[3] | undefined;
                    try {
                        const qs = environmentId
                            ? `?environment_id=${encodeURIComponent(environmentId)}`
                            : runtimeId ? `?runtime_id=${encodeURIComponent(runtimeId)}` : '';
                        const resp = await fetch(`${cloudUrl}/api/v1/cloud-connection/status${qs}`, {
                            headers: authHeaders(),
                        });
                        if (resp.ok) {
                            const json: any = await resp.json().catch(() => null);
                            const data = json?.data ?? {};
                            const bound = Boolean(data.bound) || Boolean(credential());
                            fromControlPlane = {
                                environmentId: environmentId ?? null,
                                runtimeId: data.runtime_id ?? runtimeId ?? null,
                                bound,
                                provider: 'objectstack-cloud',
                                connection: data.connection ?? null,
                            };
                        }
                    } catch { /* fall through to implicit */ }
                    if (fromControlPlane) return serve(fromControlPlane);
                }
                const bound = Boolean(credential());
                return serve({ environmentId: environmentId ?? null, runtimeId: runtimeId ?? null, bound, provider: 'objectstack-cloud', connection: null });
            }));

            // POST /bind/start — begin a device-code bind. The runtime is the
            // genuine RFC 8628 client: it asks the cloud for a device + user
            // code, returns them to the Setup UI, and the operator approves in
            // the cloud console.
            rawApp.post(`${CLOUD_CONNECTION_PREFIX}/bind/start`, door(async (c: any) => {
                // [#23914] A declared JSON body that does not parse is refused 400,
                // never read as no body (`./request-json-body.ts`).
                const read = await readJsonRequestBody(c);
                if (!read.ok) return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: read.message } }, 400);
                const body: any = read.body;
                // Self-hosted (single-env) runtimes need NO environment id —
                // registration happens cloud-side at approval (ADR
                // runtime-identity-binding). An explicit environment_id in the
                // body is still honored for cloud-hosted-style binds.
                let environmentId = await resolveEnvironmentId(c);
                if (!environmentId && this.cfg.singleEnvironment) {
                    environmentId = String(body?.environment_id ?? body?.environmentId ?? '').trim() || undefined;
                }
                if (!environmentId && !this.cfg.singleEnvironment) {
                    return c.json({ success: false, error: { code: 'ENVIRONMENT_NOT_FOUND', message: ENVIRONMENT_NOT_FOUND_MESSAGE } }, 404);
                }
                const session = await resolveSession(environmentId ?? '', c.req.raw);
                if (session?.authGate) return refuseHeldSession(c, session.authGate);
                if (!session?.userId) return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in to connect a cloud account.' } }, 401);
                // [#24148, #25119] Refused before any work, so a caller without
                // the capability cannot learn whether a control plane is configured.
                if (!(await holdsPlatformSettings(c.req.raw, session, transportPeerAddressOf(c)))) return refuseWithoutPlatformSettings(c);
                // [#25113] The connection is the platform's — refused before the
                // device-code request, as `unbind` is refused before its revoke.
                if (platformManaged) return refusePlatformManaged(c);
                if (!cloudUrl) return c.json({ success: false, error: { code: 'CLOUD_UNCONFIGURED', message: 'No cloud control plane configured.' } }, 503);
                try {
                    const resp = await fetch(`${cloudUrl}/api/v1/auth/device/code`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ client_id: deviceClientId, scope: deviceScope }),
                    });
                    const json: any = await resp.json().catch(() => ({}));
                    if (!resp.ok) return c.json({ success: false, error: { code: 'DEVICE_CODE_FAILED', message: json?.error ?? `device/code ${resp.status}` } }, 502);
                    // Device context for the approval page (ADR
                    // runtime-identity-binding §2.3): name the requesting
                    // runtime in the verification URL so the approver sees
                    // WHAT they are authorizing. Display-only — informed
                    // consent, not an authenticity proof (the page carries
                    // the "only approve if you started this" warning).
                    const ver = await reportedRuntimeVersion();
                    const withContext = (uri: unknown): string | undefined => {
                        if (typeof uri !== 'string' || !uri) return undefined;
                        try {
                            const u = new URL(uri);
                            try { u.searchParams.set('runtime_name', hostname()); } catch { /* no hostname */ }
                            if (ver) u.searchParams.set('runtime_version', ver);
                            return u.toString();
                        } catch { return uri; }
                    };
                    return c.json({ success: true, data: {
                        device_code: json.device_code,
                        user_code: json.user_code,
                        verification_uri: withContext(json.verification_uri),
                        verification_uri_complete: withContext(json.verification_uri_complete),
                        interval: json.interval ?? 5,
                        expires_in: json.expires_in ?? 600,
                    } });
                } catch (err: any) {
                    ctx.logger?.error?.('[CloudConnectionPlugin] bind/start failed', err instanceof Error ? err : new Error(String(err)));
                    return c.json({ success: false, error: { code: 'DEVICE_CODE_FAILED', message: String(err?.message ?? err) } }, 502);
                }
            }));

            // POST /bind/poll { device_code } — polls the cloud token endpoint.
            // While pending, returns { pending: true }. On success, exchanges
            // the operator token for a persisted sys_cloud_connection via the
            // control plane's /bind.
            rawApp.post(`${CLOUD_CONNECTION_PREFIX}/bind/poll`, door(async (c: any) => {
                // [#23914] A declared JSON body that does not parse is refused 400,
                // never read as no body (`./request-json-body.ts`).
                const read = await readJsonRequestBody(c);
                if (!read.ok) return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: read.message } }, 400);
                const body: any = read.body;
                let environmentId = await resolveEnvironmentId(c);
                if (!environmentId && this.cfg.singleEnvironment) {
                    environmentId = String(body?.environment_id ?? body?.environmentId ?? '').trim() || undefined;
                }
                if (!environmentId && !this.cfg.singleEnvironment) {
                    return c.json({ success: false, error: { code: 'ENVIRONMENT_NOT_FOUND', message: ENVIRONMENT_NOT_FOUND_MESSAGE } }, 404);
                }
                const session = await resolveSession(environmentId ?? '', c.req.raw);
                if (session?.authGate) return refuseHeldSession(c, session.authGate);
                if (!session?.userId) return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in.' } }, 401);
                // [#24148, #25119] This is the door that persists the binding.
                if (!(await holdsPlatformSettings(c.req.raw, session, transportPeerAddressOf(c)))) return refuseWithoutPlatformSettings(c);
                // [#25113] The connection is the platform's — refused before the
                // device-token poll, the control plane's `/bind` and the local
                // write: a bind completed here would persist a credential the
                // service key shadows, and move the cloud-side connection row.
                if (platformManaged) return refusePlatformManaged(c);
                if (!cloudUrl) return c.json({ success: false, error: { code: 'CLOUD_UNCONFIGURED', message: 'No cloud control plane configured.' } }, 503);

                const deviceCode = String(body?.device_code ?? body?.deviceCode ?? '').trim();
                if (!deviceCode) return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'device_code is required' } }, 400);

                try {
                    const tokResp = await fetch(`${cloudUrl}/api/v1/auth/device/token`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode, client_id: deviceClientId }),
                    });
                    const tok: any = await tokResp.json().catch(() => ({}));
                    const accessToken = tok?.access_token;
                    if (!accessToken) {
                        // RFC 8628 polling errors: authorization_pending / slow_down
                        // are non-terminal; everything else is terminal.
                        const errCode = String(tok?.error ?? `device/token ${tokResp.status}`);
                        const pending = errCode === 'authorization_pending' || errCode === 'slow_down';
                        if (pending) return c.json({ success: true, data: { pending: true } }, 200);
                        // The upstream RFC 8628 spelling (`expired_token`,
                        // `access_denied`, …) is NOT a member of the closed
                        // `ApiErrorSchema.code` vocabulary, so stamping it into
                        // `code` emitted a body that fails its own contract. It
                        // rides `declaredCode` instead — the open, producer-
                        // authored channel ADR-0112 declares for exactly this
                        // (a code the serving side's ledger does not know) —
                        // while `code` carries the registered member. Nothing is
                        // lost: the verbatim spelling still reaches the caller.
                        return c.json({
                            success: false,
                            // Retained on the failure body too: the Console polls
                            // this route and reads `body?.data?.pending` first.
                            data: { pending: false },
                            error: {
                                code: 'DEVICE_CODE_FAILED',
                                declaredCode: errCode,
                                message: `Device authorization failed: ${errCode}`,
                            },
                        }, 400);
                    }
                    // Persist the binding through the control plane. The
                    // registration claim rides along (ADR
                    // runtime-identity-binding §2.3): hostname + version name
                    // the device; a stored runtime_id keeps the identity
                    // stable across re-binds (claim verified cloud-side).
                    const stored = this.ledger.read();
                    const runtimeVersion = await reportedRuntimeVersion();
                    const bindResp = await fetch(`${cloudUrl}/api/v1/cloud-connection/bind`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...(cloudApiKey ? { Authorization: `Bearer ${cloudApiKey}` } : {}) },
                        body: JSON.stringify({
                            ...(environmentId ? { environment_id: environmentId } : {}),
                            ...(stored?.runtimeId ? { runtime_id: stored.runtimeId } : {}),
                            name: (() => { try { return hostname(); } catch { return undefined; } })(),
                            runtime_version: runtimeVersion,
                            token: accessToken,
                            scope: deviceScope,
                        }),
                    });
                    const bindJson: any = await bindResp.json().catch(() => ({ success: false, error: 'bind failed (no body)' }));
                    // The bind response carries the one-time runtime bearer.
                    // Persist it HERE (server-side: the 0600 file on a single
                    // node, the shared encrypted row on declared replicas) and
                    // STRIP it from what goes back to the browser — the SPA
                    // never holds the credential.
                    const runtimeToken = bindJson?.data?.runtime_token;
                    if (bindResp.ok && typeof runtimeToken === 'string' && runtimeToken) {
                        try {
                            await this.ledger.write({
                                runtimeToken,
                                runtimeId: bindJson?.data?.runtime_id ?? bindJson?.data?.connection?.runtime_id ?? undefined,
                                environmentId: environmentId || undefined,
                                controlPlaneUrl: cloudUrl,
                                organizationId: bindJson?.data?.connection?.organization_id ?? undefined,
                                accountEmail: bindJson?.data?.connection?.account_email ?? undefined,
                                boundAt: bindJson?.data?.connection?.bound_at ?? new Date().toISOString(),
                            });
                        } catch (err: any) {
                            ctx.logger?.error?.('[CloudConnectionPlugin] failed to persist runtime credential', err instanceof Error ? err : new Error(String(err)));
                            // [#31554] On shared replicas the store's refusal names
                            // its remedy (a crypto provider, the data engine) and
                            // never carries the bearer: hand it to the caller, so
                            // the panel does not read "connected" over a binding
                            // no replica holds. A single node answers as before.
                            if (this.ledger.shared) {
                                return c.json({ success: false, error: { code: 'ENVIRONMENT_BIND_FAILED', message: String(err?.message ?? err) } }, 503);
                            }
                        }
                        delete bindJson.data.runtime_token;
                    }
                    return c.json(bindJson, bindResp.status as any);
                } catch (err: any) {
                    ctx.logger?.error?.('[CloudConnectionPlugin] bind/poll failed', err instanceof Error ? err : new Error(String(err)));
                    return c.json({ success: false, error: { code: 'ENVIRONMENT_BIND_FAILED', message: String(err?.message ?? err) } }, 502);
                }
            }));

            // POST /unbind — disconnect this runtime from the control plane.
            // Revokes the connection server-side (best-effort) and clears the
            // local credential. Requires an environment session holding
            // `manage_platform_settings`, mirroring bind/start. Refused on a
            // platform-managed runtime (ruling 甲, #25097), as both bind doors are.
            rawApp.post(`${CLOUD_CONNECTION_PREFIX}/unbind`, door(async (c: any) => {
                const environmentId = await resolveEnvironmentId(c);
                if (!environmentId && !this.cfg.singleEnvironment) {
                    return c.json({ success: false, error: { code: 'ENVIRONMENT_NOT_FOUND', message: ENVIRONMENT_NOT_FOUND_MESSAGE } }, 404);
                }
                const session = await resolveSession(environmentId ?? '', c.req.raw);
                if (session?.authGate) return refuseHeldSession(c, session.authGate);
                if (!session?.userId) return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in.' } }, 401);
                // [#24148, #25119] Refused before the revoke and before the local clear.
                if (!(await holdsPlatformSettings(c.req.raw, session, transportPeerAddressOf(c)))) return refuseWithoutPlatformSettings(c);
                // Ruling 甲 (#25097): the connection is the platform's — refused
                // before the revoke and before the local clear, so nothing
                // changes on either side.
                if (platformManaged) return refusePlatformManaged(c);

                // Revoke cloud-side FIRST (the oscc_ bearer self-identifies;
                // a known environment id rides along), then clear the
                // local credential regardless — a device signing out must not
                // leave a live token behind when the control plane is up.
                let revoked = false;
                if (cloudUrl && credential()) {
                    try {
                        const resp = await fetch(`${cloudUrl}/api/v1/cloud-connection/revoke`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...authHeaders() },
                            body: JSON.stringify(environmentId ? { environment_id: environmentId } : {}),
                        });
                        revoked = resp.ok;
                    } catch { /* control plane unreachable — local clear still proceeds */ }
                }
                // Clear the CREDENTIAL but keep the IDENTITY: a residual
                // {runtimeId} lets a later re-bind to the same org claim the
                // same registration (revive the revoked row) instead of
                // piling up a new device per disconnect cycle — same as an
                // iCloud device record surviving sign-out.
                const residualId = this.ledger.read()?.runtimeId;
                const cleared = await (async () => {
                    try {
                        if (residualId) {
                            await this.ledger.write({ runtimeToken: '', runtimeId: residualId });
                            return true;
                        }
                        return await this.ledger.clear();
                    } catch { return false; }
                })();
                return c.json({ success: true, data: { environmentId: environmentId ?? null, revoked, cleared } });
            }));

            // POST /install { package_id, version?, seed_sample_data?, install_mode? } — in-environment
            // marketplace install. Authorizes the caller against the
            // environment's own session (SSO-as-owner only ever admits org
            // owners/admins), then performs the install against the cloud
            // control plane using the env→cloud service credential.
            rawApp.post(`${CLOUD_CONNECTION_PREFIX}/install`, door(async (c: any) => {
                const environmentId = await resolveEnvironmentId(c);
                if (!environmentId) return c.json({ success: false, error: { code: 'ENVIRONMENT_NOT_FOUND', message: ENVIRONMENT_NOT_FOUND_MESSAGE } }, 404);

                // Local authz: require a valid env session. (TODO: tighten to an
                // explicit env-admin role check; today only owners/admins obtain
                // a session via SSO-as-owner.)
                const session = await resolveSession(environmentId, c.req.raw);
                if (session?.authGate) return refuseHeldSession(c, session.authGate);
                if (!session?.userId) {
                    return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in to install apps.' } }, 401);
                }

                if (!cloudUrl || !credential()) {
                    return c.json({ success: false, error: { code: 'CLOUD_UNCONFIGURED', message: 'This runtime is not connected to a cloud account; install is unavailable.' } }, 503);
                }

                // [#23914] A declared JSON body that does not parse is refused 400,
                // never read as no body (`./request-json-body.ts`).
                const read = await readJsonRequestBody(c);
                if (!read.ok) return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: read.message } }, 400);
                const body: any = read.body;
                const packageId = String(body?.package_id ?? body?.packageId ?? '').trim();
                if (!packageId) return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'package_id is required' } }, 400);
                const seedSampleData = body?.seed_sample_data === true || body?.seedSampleData === true;
                // [#30964, cloud#3624 ruling A] The install mode the caller asked
                // for, parsed against the manifest key's own enum. Absent means
                // `managed`, as before, and the control plane is then sent no
                // `install_mode` (its absent value is `managed` too), so a managed
                // install's request is the one it always was.
                const requested = installModeOf(body);
                if (!requested.ok) return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: requested.message } }, 400);
                const installMode = requested.mode;
                // [#31799] The version the caller named, checked for shape only;
                // absent means the latest, and the control plane is then sent no
                // `version`, so a versionless install's request is the one it always was.
                const named = packageVersionOf(body);
                if (!named.ok) return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: named.message } }, 400);
                const version = named.version;

                // Call the cloud install endpoint in service mode. We do NOT send
                // an active org → package-install treats this as platform/CI and
                // installs unrestricted (we already authorized the env admin above).
                // The installer travels only as the `installer_user_id` body param
                // below, always sent: the id of the session admitted above.
                try {
                    const resp = await fetch(`${cloudUrl}/api/v1/actions/sys_package/install_package`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...authHeaders(),
                        },
                        body: JSON.stringify({
                            recordId: packageId,
                            params: {
                                environment_id: environmentId,
                                seed_sample_data: seedSampleData,
                                // [#30964] The cloud half's param name (cloud#3624, PR cloud#3683): snake_case, absent = managed.
                                ...(installMode !== undefined ? { install_mode: installMode } : {}),
                                // [#31799] The control plane's pinned-version param; absent = latest.
                                ...(version !== undefined ? { version } : {}),
                                // [#30964] The person installing, so the control
                                // plane's audit row can name a person rather than
                                // this environment's service principal. A body
                                // param, never a header (cloud#2245 removed
                                // `x-actor-id` as an authorization input). It is
                                // the id of the session this door admitted above,
                                // never a value the caller sent; the control plane
                                // reads it only for a member of the environment's
                                // organization and records its service principal
                                // otherwise (cloud#3624).
                                installer_user_id: session.userId,
                            },
                        }),
                    });
                    const json: any = await resp.json().catch(() => ({ success: false, error: 'install failed (no body)' }));
                    // [#30964] A control-plane refusal, and every managed answer, is relayed as it was.
                    if (installMode !== 'unmanaged' || !resp.ok || json?.success === false) return c.json(json, resp.status as any);
                    return await copyOnUnmanagedGrant(c, { environmentId, packageId, seedSampleData, installerUserId: session.userId, grant: json });
                } catch (err: any) {
                    ctx.logger?.error?.('[CloudConnectionPlugin] install failed', err instanceof Error ? err : new Error(String(err)));
                    return c.json({ success: false, error: { code: 'PLUGIN_INSTALL_FAILED', message: String(err?.message ?? err) } }, 502);
                }
            }));

            /**
             * [#30964, cloud#3624 ruling A] The copy an UNMANAGED grant asks for,
             * made in the environment by its own install-local door
             * ({@link INSTALL_LOCAL_DOOR_SERVICE}): `installMode: 'unmanaged'`,
             * the granted version, the caller's own headers (so the door admits
             * and gates the same person, and the copy and any sample rows are
             * the installer's), and `seedSampleData` only when the caller asked
             * for it. The answer is that door's own answer.
             *
             * Cross-repo, NOT MEASURED: the grant's shape. The control plane is
             * assumed to skip its own install on an unmanaged grant and answer
             * `data.install_mode: 'unmanaged'` with the granted `data.version_id`;
             * the door then fetches that version's manifest itself, as its
             * cloud branch always has. Fail closed: an answer that does not echo
             * the mode, or names no version, copies nothing (502). A
             * `data.manifest` in the answer is never read.
             *
             * [#31481, ruling A「两边审计」] Every refusal after the grant leaves
             * the environment's `package_unmanaged_import` failure row beside
             * the control plane's grant row, through the environment's `audit`
             * slot: this door's own two (the grant it cannot read, 502; no
             * install-local door, 503) here, and the door's, which it audits
             * itself when handed the grant ({@link InstallLocalDoor.install}).
             */
            const copyOnUnmanagedGrant = async (
                c: any,
                args: { environmentId: string; packageId: string; seedSampleData: boolean; installerUserId: string; grant: any },
            ): Promise<Response> => {
                const { environmentId, packageId, seedSampleData, installerUserId, grant } = args;
                const data = grant?.data;
                const versionId = typeof data?.version_id === 'string' ? data.version_id.trim() : '';
                const granted: InstallLocalDoorGrant = {
                    packageId,
                    ...(typeof data?.version === 'string' && data.version.trim() !== '' ? { version: data.version.trim() } : {}),
                    environmentId,
                    actor: installerUserId,
                };
                // The environment's own services: its kernel's, multi-tenant; the host's, single-environment.
                let kernel: EnvironmentKernel | undefined;
                if (!this.cfg.singleEnvironment) {
                    try {
                        kernel = await ctx.getService<EnvironmentKernelManager>('kernel-manager')?.getOrCreate?.(environmentId);
                    } catch { /* no environment kernel */ }
                }
                const environmentService = async <T>(name: string): Promise<T | undefined> => {
                    if (this.cfg.singleEnvironment) {
                        try { return ctx.getService<T>(name); } catch { return undefined; }
                    }
                    let found: T | undefined;
                    try { found = await kernel?.getServiceAsync?.<T>(name); } catch { /* not registered */ }
                    if (!found) { try { found = kernel?.getService?.<T>(name); } catch { /* not registered */ } }
                    return found;
                };
                const auditRefusal = async (errorCode: string, status: number): Promise<void> => {
                    const audit = await environmentService<UnmanagedImportAuditSurface>('audit');
                    await recordUnmanagedImportEvent(audit, ctx.logger, 'CloudConnectionPlugin', grantRefusalEvent(granted, errorCode, status));
                };
                // An answer with no `install_mode` at all may come from a control
                // plane that does not read the param, and so may already have
                // installed the package MANAGED; the refusal says so, so the
                // installer checks Installed before retrying.
                const unechoed = data?.install_mode === undefined || data?.install_mode === null;
                const unread = data?.install_mode !== 'unmanaged'
                    ? 'its answer does not echo `install_mode: \'unmanaged\'`'
                    : versionId === '' ? 'its answer names no `version_id`' : undefined;
                if (unread !== undefined) {
                    const managedNote = unechoed
                        ? ' The control plane did not echo install_mode; a control plane that does not read it may have '
                            + 'installed the package managed. Check Installed before retrying.'
                        : '';
                    ctx.logger?.warn?.(
                        `[CloudConnectionPlugin] the unmanaged install of ${packageId} in ${environmentId} was not copied: `
                        + `the control plane's grant could not be read (${unread}).${managedNote}`,
                    );
                    await auditRefusal('PLUGIN_INSTALL_FAILED', 502);
                    return c.json({
                        success: false,
                        error: {
                            code: 'PLUGIN_INSTALL_FAILED',
                            message: `The control plane answered the unmanaged install of '${packageId}', but ${unread}, so this `
                                + `environment cannot tell which version it granted. Nothing was copied.${managedNote}`,
                        },
                    }, 502);
                }
                const door = await environmentService<InstallLocalDoor>(INSTALL_LOCAL_DOOR_SERVICE);
                if (!door || typeof door.install !== 'function') {
                    await auditRefusal('SERVICE_UNAVAILABLE', 503);
                    return c.json({
                        success: false,
                        error: {
                            code: 'SERVICE_UNAVAILABLE',
                            message: `The control plane granted an unmanaged install of '${packageId}', but this environment has no `
                                + 'install-local door to make the copy with (MarketplaceInstallLocalPlugin is not mounted). Nothing was copied.',
                        },
                    }, 503);
                }
                const headers = new Headers(c.req.raw?.headers);
                headers.set('content-type', 'application/json');
                headers.delete('content-length');
                const request = new Request(new URL('/api/v1/marketplace/install-local', c.req.url).toString(), {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        packageId,
                        versionId,
                        installMode: 'unmanaged',
                        ...(seedSampleData ? { seedSampleData: true } : {}),
                    }),
                });
                // The grant rides beside the request, so the door audits its own refusals of it.
                const answer = await door.install(request, { grant: granted });
                const body = await answer.json().catch(() => ({
                    success: false,
                    error: { code: 'PLUGIN_INSTALL_FAILED', message: `The unmanaged copy of '${packageId}' answered no body.` },
                }));
                return c.json(body, answer.status as any);
            };

            // GET /installation?package_id=… — same-origin installed-state
            // probe. Always returns 200 with `{ installed: boolean, … }`;
            // failures to reach the control plane degrade to
            // `{ installed: false }` so the marketplace page renders (worst
            // case it offers an install the control plane upserts idempotently).
            rawApp.get(`${CLOUD_CONNECTION_PREFIX}/installation`, door(async (c: any) => {
                const environmentId = await resolveEnvironmentId(c);
                if (!environmentId) {
                    // Self-hosted v2: cloud-side installation records are
                    // env-scoped; a registration-only runtime tracks installs
                    // locally (LocalManifestSource). Report not-installed.
                    if (this.cfg.singleEnvironment) return c.json({ success: true, data: { installed: false } });
                    return c.json({ success: false, error: { code: 'ENVIRONMENT_NOT_FOUND', message: ENVIRONMENT_NOT_FOUND_MESSAGE } }, 404);
                }

                const session = await resolveSession(environmentId, c.req.raw);
                if (session?.authGate) return refuseHeldSession(c, session.authGate);
                if (!session?.userId) {
                    return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in.' } }, 401);
                }

                let packageId = '';
                try {
                    const u = new URL(c.req.url);
                    packageId = String(u.searchParams.get('package_id') ?? u.searchParams.get('packageId') ?? '').trim();
                } catch { /* malformed URL → empty */ }
                if (!packageId) return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'package_id is required' } }, 400);

                // Not connected → can't know; report not-installed so the page
                // still renders (a read should never hard-fail the page).
                if (!cloudUrl || !credential()) return c.json({ success: true, data: { installed: false } });

                try {
                    // Read installed-state from the control plane's
                    // service-authenticated installations route — NOT the generic
                    // `/api/v1/data/sys_package_installation` API. That data API
                    // resolves identity via better-auth sessions / `sys_api_key`
                    // only and rejects the `OS_CLOUD_API_KEY` service bearer (401).
                    // This route shares the install route's service-key auth, so
                    // the same credential that performed the install can read its
                    // result back.
                    const resp = await fetch(
                        `${cloudUrl}/api/v1/cloud/environments/${encodeURIComponent(environmentId)}/installations/${encodeURIComponent(packageId)}`,
                        { headers: { Accept: 'application/json', ...authHeaders() } },
                    );
                    if (!resp.ok) return c.json({ success: true, data: { installed: false } });
                    const json: any = await resp.json().catch(() => ({}));
                    const data: any = json?.data ?? json ?? {};
                    if (!data.installed) return c.json({ success: true, data: { installed: false } });
                    return c.json({ success: true, data: {
                        installed: true,
                        installationId: String(data.installationId ?? ''),
                        version: String(data.version ?? 'installed'),
                        withSampleData: data.withSampleData === true,
                    } });
                } catch (err: any) {
                    ctx.logger?.warn?.(`[CloudConnectionPlugin] installation probe failed: ${String(err?.message ?? err)}`);
                    return c.json({ success: true, data: { installed: false } });
                }
            }));

            // GET /installed — env's FULL installed set from the control
            // plane's `sys_package_installation`, so the Console "Installed"
            // view reflects packages installed via ANY path (CLI, marketplace,
            // REST) — cloud ADR-0007 step ①. Degrades to an empty list when the
            // runtime is not cloud-connected or the control plane is
            // unreachable (never hard-fails the page).
            rawApp.get(`${CLOUD_CONNECTION_PREFIX}/installed`, door(async (c: any) => {
                const environmentId = await resolveEnvironmentId(c);
                if (!environmentId) {
                    // Self-hosted v2: no env-scoped cloud install ledger —
                    // the Installed view is fed by the local manifest ledger.
                    if (this.cfg.singleEnvironment) {
                        return c.json({ success: true, data: { packages: [], total: 0, connected: Boolean(credential()) } });
                    }
                    return c.json({ success: false, error: { code: 'ENVIRONMENT_NOT_FOUND', message: ENVIRONMENT_NOT_FOUND_MESSAGE } }, 404);
                }

                const session = await resolveSession(environmentId, c.req.raw);
                if (session?.authGate) return refuseHeldSession(c, session.authGate);
                if (!session?.userId) {
                    return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in.' } }, 401);
                }

                if (!cloudUrl || !credential()) {
                    return c.json({ success: true, data: { packages: [], total: 0, connected: false } });
                }

                try {
                    const resp = await fetch(
                        `${cloudUrl}/api/v1/cloud/environments/${encodeURIComponent(environmentId)}/packages`,
                        { headers: { Accept: 'application/json', ...authHeaders() } },
                    );
                    if (!resp.ok) return c.json({ success: true, data: { packages: [], total: 0, connected: true } });
                    const json: any = await resp.json().catch(() => ({}));
                    const data: any = json?.data ?? json ?? {};
                    const packages = Array.isArray(data.packages) ? data.packages : [];
                    return c.json({ success: true, data: { packages, total: packages.length, connected: true } });
                } catch (err: any) {
                    ctx.logger?.warn?.(`[CloudConnectionPlugin] installed-list failed: ${String(err?.message ?? err)}`);
                    return c.json({ success: true, data: { packages: [], total: 0, connected: true } });
                }
            }));

            // GET /org-packages — org-scoped catalog for the in-env
            // Marketplace's "Your organization" layer (cloud ADR-0007 step ②): the
            // env's owning org's own packages (visibility org/private), so a
            // publisher can discover + install their private apps from inside
            // the environment. Forwards (service-key) to the control plane,
            // which derives the org from environment_id.
            rawApp.get(`${CLOUD_CONNECTION_PREFIX}/org-packages`, door(async (c: any) => {
                const environmentId = await resolveEnvironmentId(c);
                if (!environmentId && !this.cfg.singleEnvironment) {
                    return c.json({ success: false, error: { code: 'ENVIRONMENT_NOT_FOUND', message: ENVIRONMENT_NOT_FOUND_MESSAGE } }, 404);
                }

                const session = await resolveSession(environmentId ?? '', c.req.raw);
                if (session?.authGate) return refuseHeldSession(c, session.authGate);
                if (!session?.userId) {
                    return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in.' } }, 401);
                }

                if (!cloudUrl || !credential()) {
                    return c.json({ success: true, data: { items: [], total: 0, connected: false } });
                }

                try {
                    // env-keyed callers pass environment_id; a registration-only
                    // runtime's oscc_ bearer carries the org by itself.
                    const qs = environmentId ? `?environment_id=${encodeURIComponent(environmentId)}` : '';
                    const resp = await fetch(
                        `${cloudUrl}/api/v1/cloud/org-packages${qs}`,
                        { headers: { Accept: 'application/json', ...authHeaders() } },
                    );
                    if (!resp.ok) return c.json({ success: true, data: { items: [], total: 0, connected: true } });
                    const json: any = await resp.json().catch(() => ({}));
                    const data: any = json?.data ?? json ?? {};
                    const items = Array.isArray(data.items) ? data.items : [];
                    return c.json({ success: true, data: { items, total: items.length, connected: true } });
                } catch (err: any) {
                    ctx.logger?.warn?.(`[CloudConnectionPlugin] org-packages failed: ${String(err?.message ?? err)}`);
                    return c.json({ success: true, data: { items: [], total: 0, connected: true } });
                }
            }));

            ctx.logger?.info?.(`[CloudConnectionPlugin] mounted ${CLOUD_CONNECTION_PREFIX}/{status,bind/start,bind/poll,install,installation,installed,org-packages} → ${cloudUrl || '(cloud unconfigured)'}`);
        });
    };
}

/** Factory mirroring the package's other plugins' construction style. */
export function createCloudConnectionPlugin(config: CloudConnectionPluginConfig = {}): CloudConnectionPlugin {
    return new CloudConnectionPlugin(config);
}
