// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext, IHttpServer, isServiceNotRegisteredError } from '@objectstack/core';
import { RestServer, RestKernelManager, RestProtocol, RestRequestEnvResolver, RestEnvRegistry } from './rest-server.js';
import { RestServerConfig } from '@objectstack/spec/api';
import { mountAndRecordDirectRoutes } from './direct-mount-composition.js';
import type { ResolvedSettingValue } from '@objectstack/spec/system';
// [#4251 B4] Every slot this composition root resolves, named by its contract.
// The lookup already returns the slot's contract; annotating the result `any`
// switched that checking off while looking identical to code that has it.
// Each contract below is EVIDENCED by an `implements` on the class its provider
// registers into the slot (`EmailService implements IEmailService`, …), so the
// compiler verifies the shape on the producer side every build and this file
// only has to name it — the #4404 discipline that replaced seven unchecked
// local stand-ins with one checked claim.
import type {
    IAnalyticsService,
    IApprovalService,
    IAuthService,
    IEmailService,
    II18nService,
    IMetadataService,
    IObjectQLEngine,
    ISecurityService,
    ISharingRuleService,
    ISharingService,
} from '@objectstack/spec/contracts';
import { SysImportJob } from '@objectstack/platform-objects/audit';

/**
 * The `default-project` slot's occupant, as this file reads it.
 *
 * [#4251 B4] No contract and no entry in `ServiceSlotContracts`: the slot is
 * host-provided, and no provider in this repo or in `cloud` registers it (the
 * `createSingleEnvironmentPlugin` named in the comment below, and in five other
 * comments across `runtime`/`rest`, exists in neither) — filed separately
 * rather than widened here. So this declares only the ONE field this file
 * reads, the #5195 narrow-slice discipline: `runtime`'s own reader declares the
 * fuller `{ environmentId: string; orgId?: string }`, and `orgId` is not read
 * here. A named slice is checked where an `any` was not — and when it is wrong,
 * it says so, which `any` never does.
 */
interface DefaultEnvironmentSurface {
    readonly environmentId: string;
}

/**
 * The `settings` slot's occupant, as the platform reads it.
 *
 * [#4251 B4] Named surface rather than a ledger entry, following the B2
 * decision for this slot: `service-settings` is OPTIONAL, so the REST layer
 * must not acquire a runtime dependency on it, and its `SettingsService`
 * declares no `implements` — there is no contract to name. Both methods below
 * are consumed through `resolveLocalizationContext`'s 4-tier
 * timezone/locale/currency cascade; their return types are the PUBLIC
 * `ResolvedSettingValue` from `@objectstack/spec/system`, so only the context
 * argument is described structurally (`SettingsContext` is service-local).
 *
 * ## What an occupant must implement
 *
 * `get` is REQUIRED; `getMany` is OPTIONAL and worth implementing. Since
 * #10826 the resolver feature-detects `getMany` and, when present, reads all
 * three localization keys in ONE grouped call; an occupant without it takes
 * the three-parallel-`get` path and still answers correctly — the cost is
 * three namespace reads instead of one, not a wrong result. That is why
 * `getMany` is declared optional rather than required: making it required
 * would over-state the contract, and omitting it (as this interface did until
 * #11222) under-states what the platform actually calls.
 *
 * ⚠️ Neither member is type-checked at the call site. `ctx.getService` is a
 * cast, `rest-server.ts` widens this provider's return to a bare promise, and
 * `resolveLocalizationContext` receives `settings?: any` — so this interface
 * is documentation for host authors, not enforcement. `check:slot-lookup`
 * (#4251) only bans erasing the lookup to `any`; it never checks the named
 * type is COMPLETE, which is how the missing `getMany` stayed invisible.
 */
interface SettingsReadSurface {
    get<T = unknown>(
        namespace: string,
        key: string,
        ctx?: { tenantId?: string; userId?: string },
    ): Promise<ResolvedSettingValue<T>>;
    /**
     * Resolve several keys of ONE namespace in a single grouped read.
     * Optional — feature-detected by `resolveLocalizationContext`.
     */
    getMany?<T = unknown>(
        namespace: string,
        keys: readonly string[],
        ctx?: { tenantId?: string; userId?: string },
    ): Promise<Record<string, ResolvedSettingValue<T>>>;
}

export interface RestApiPluginConfig {
    serverServiceName?: string;
    protocolServiceName?: string;
    /**
     * Optional override for the kernel-manager service name. When the service
     * is registered (by @objectstack/runtime's MultiProjectPlugin), scoped
     * routes resolve per-environment protocols at request time.
     */
    kernelManagerServiceName?: string;
    api?: RestServerConfig;
}

/**
 * REST API Plugin
 * 
 * Responsibilities:
 * 1. Consumes 'http.server' (or configured service)
 * 2. Consumes 'protocol' (the `RestProtocol` slice — DataProtocol + MetadataProtocol, ADR-0076 D9)
 * 3. Instantiates RestServer to auto-generate routes
 */
export function createRestApiPlugin(config: RestApiPluginConfig = {}): Plugin {
    return {
        name: 'com.objectstack.rest.api',
        version: '1.0.0',
        /**
         * init() registers sys_import_job through the `manifest` service
         * ObjectQLPlugin provides — order-if-present so the registration is
         * deterministic (ADR-0116, #4471). Soft, not hard: on an engine-less
         * kernel the plugin degrades on purpose (warn + no import-job object).
         */
        optionalDependencies: ['com.objectstack.engine.objectql'],

        init: async (ctx: PluginContext) => {
            // Register the async-import job object so its state/progress/history
            // is queryable in Studio and readable by the import-job routes.
            // The REST plugin owns the import feature, so it owns this object
            // (there is no separate import service). Mirrors JobServicePlugin.
            try {
                ctx.getService<{ register(m: any): void }>('manifest').register({
                    id: 'com.objectstack.rest.api',
                    name: 'REST API',
                    version: '1.0.0',
                    type: 'plugin',
                    scope: 'system',
                    defaultDatasource: 'cloud',
                    namespace: 'sys',
                    objects: [SysImportJob],
                });
            } catch (err) {
                ctx.logger.warn('RestApiPlugin: manifest service unavailable; sys_import_job not registered', err as any);
            }
        },
        
        start: async (ctx: PluginContext) => {
            const serverService = config.serverServiceName || 'http.server';
            const protocolService = config.protocolServiceName || 'protocol';
            
            let server: IHttpServer | undefined;
            let protocol: RestProtocol | undefined;

            try {
                server = ctx.getService<IHttpServer>(serverService);
            } catch (e) {
                // Ignore missing service
            }

            try {
                protocol = ctx.getService<RestProtocol>(protocolService);
            } catch (e) {
                // Ignore missing service
            }

            // Optional — only present when MultiProjectPlugin is mounted. When
            // available, RestServer will resolve a per-environment protocol at
            // request time for scoped (`/environments/:environmentId/...`) routes.
            let kernelManager: RestKernelManager | undefined;
            const kernelManagerService = config.kernelManagerServiceName || 'kernel-manager';
            try {
                kernelManager = ctx.getService<RestKernelManager>(kernelManagerService);
            } catch (e) {
                // Single-kernel deployment — fall back to the control protocol
            }

            // Optional — only present in runtime mode. When available,
            // RestServer will resolve hostname → environmentId on unscoped
            // routes so a remote runtime node can dispatch every request
            // to the matching per-environment kernel without requiring callers
            // to know the environmentId.
            // Typed as the shape RestServer's constructor declares for it
            // (`RestEnvRegistry`), so the argument is checked rather than
            // waved through — the `any` here made that parameter unverifiable.
            let envRegistry: RestEnvRegistry | undefined;
            try {
                envRegistry = ctx.getService<RestEnvRegistry>('env-registry');
            } catch (e) {
                // Not running in runtime/multi-environment mode — fine.
            }

            // ADR-0076 D11 step ④ — request→environment resolution unified on
            // the host's ADR-0006 `kernel-resolver` seam. When the host
            // registers one (cloud runtime does, next to `env-registry`), the
            // REST server resolves a request's environment through the SAME
            // strategy instance the HTTP dispatcher uses — session fallbacks
            // included — instead of its own parallel hostname/header chain.
            // The legacy chain remains as the fallback when no resolver is
            // registered (OSS single-environment boots) or the resolver throws.
            let requestEnvResolver: RestRequestEnvResolver | undefined;
            try {
                const kernelResolver = ctx.getService<any>('kernel-resolver');
                if (kernelResolver && typeof kernelResolver.resolveKernel === 'function') {
                    // The resolver's session/default-project fallback levels
                    // resolve services from its `defaultKernel` argument —
                    // bind the hosting kernel's service surface. `getService`
                    // may throw on a missing service; the resolver handles
                    // that itself.
                    const hostKernelFacade = {
                        getService: (name: string) => ctx.getService(name),
                        getServiceAsync: async (name: string) => ctx.getService(name),
                    };
                    requestEnvResolver = {
                        async resolveRequestEnvironmentId(req: unknown): Promise<string | undefined> {
                            // No `routePath` hint: the REST consumers of this
                            // seam are all data-plane routes, never the
                            // resolver's control-plane skip prefixes. If a
                            // resolver strategy starts keying off routePath,
                            // add prefix-stripped assembly here.
                            const context: { request: unknown; environmentId?: string } = { request: req };
                            // Ask the environment-only question when the host
                            // can answer it. This wrapper wants an ID and
                            // nothing else; `resolveKernel` is a kernel-
                            // ACQUISITION api, and the kernel it hands back
                            // here is discarded on the success path and lost
                            // with the rejection on the cold one. That discard
                            // is free on a warm environment and is a whole
                            // waiter window on a cold or wedged one — measured
                            // on a live host with `waiterTimeoutMs: 20s`,
                            // REST-owned routes (`/api/v1/discovery`,
                            // `/api/v1/data/:object`) answered 503 after 42s
                            // against a wedged environment because
                            // `resolveProtocol` then opens a SECOND window to
                            // acquire the kernel for real. Preferring
                            // `resolveEnvironment` leaves `resolveProtocol` as
                            // the single acquisition point, so one request
                            // pays one window.
                            //
                            // ⛔ No fallback to `resolveKernel` when this
                            // returns without setting `environmentId`: an unset
                            // id is the seam's FINAL answer for an unscoped /
                            // control-plane request (see
                            // `RestRequestEnvResolver`), and "retry with the
                            // expensive method" would re-buy exactly the window
                            // this prefers away, on precisely the requests that
                            // need no environment at all.
                            if (typeof kernelResolver.resolveEnvironment === 'function') {
                                await kernelResolver.resolveEnvironment(context, hostKernelFacade);
                            } else {
                                await kernelResolver.resolveKernel(context, hostKernelFacade);
                            }
                            return context.environmentId;
                        },
                    };
                }
            } catch (e) {
                // No kernel-resolver registered — legacy chain only. Fine.
            }

            // Optional default-project provider — registered by
            // `createSingleEnvironmentPlugin` in single-environment local mode.
            // Lets RestServer route bare `/api/v1/data/...` URLs into the
            // lone project's kernel.
            const defaultEnvironmentIdProvider = (): string | undefined => {
                try {
                    const dp = ctx.getService<DefaultEnvironmentSurface>('default-project');
                    return dp?.environmentId;
                } catch { return undefined; }
            };

            // [#15256 — maintainer ruling 2026-09-04, decision 1A] Tenancy
            // service resolver — the SAME single-kernel fallback shape as
            // `authServiceProvider` had, for the seam that had none.
            //
            // [#30192] This plugin's own kernel is RIGHT here on a hosted
            // runtime: every consumer reads the bound environment kernel's
            // `tenancy` first (`computeExecCtx`, `resolveAnonymousFormTenancy`),
            // so only a request in no environment, or a single kernel, reaches it.
            //
            // ## What its absence measured
            //
            // `RestServer.computeExecCtx` derives the effective tenancy posture
            // from the per-request kernel — and on this wiring there IS no
            // per-request kernel, so the posture was `undefined` on every
            // request. Both posture-conditional API-key refusals are gated on
            // it (`organization_required` in `api-key.ts`,
            // `organization_membership_ended` in `resolve-authz-context.ts`),
            // so both were skipped. Measured twice, on two repositories, under
            // a live non-degraded `isolated` posture: an API key stamped with
            // an organization its owner is no longer a member of READ that
            // organization's rows (GET 200) and WROTE a new one into it (POST
            // 201, the row read back from the store carrying the other
            // organization's id). objectstack#15163 measured it on the
            // framework; cloud#1982 reproduced it with the real, licence-gated
            // `@objectstack/organizations` subclass mounted, which adds no
            // request-time refusal of its own.
            //
            // ## Why this is NOT `authServiceProvider`'s catch-all
            //
            // The shape is the same; the CLASSIFICATION is `objectQLProvider`'s
            // (immediately below), because decision 1 option A already ruled
            // what a fault at THIS seam means and a catch-all would re-collapse
            // the two facts that ruling separated:
            //
            //  - never registered → branded → `undefined`, quiet. The supported
            //    no-tenancy composition: no wall exists, and refusing there
            //    would break every single-org embedder.
            //  - registered and FAILED to build → unbranded → re-raised, so
            //    `computeExecCtx` answers `AuthzStoreUnavailableError` (503).
            //    A posture that could not be READ is not a posture that is
            //    ABSENT; admitting on it is how a failure came to read as "this
            //    check does not apply".
            //
            // ⛔ Do not "simplify" this to `try { ctx.getService('tenancy') }
            // catch { return undefined }`. That spelling is the defect
            // #13906 repaired one branch over.
            //
            // ⛔ And no BOOT refusal belongs here: the 2026-09-02 ruling's B′
            // half (refusing to start a wall-enforcing posture on this wiring)
            // was withdrawn 2026-09-04. A load-bearing comment in
            // `rest-server.ts` pointed at that withdrawn remedy until this
            // change; it now describes this provider instead.
            const tenancyServiceProvider = async (_environmentId?: string): Promise<unknown | undefined> => {
                const kernel = typeof ctx.getKernel === 'function' ? ctx.getKernel() : undefined;
                if (kernel && typeof kernel.getServiceAsync === 'function') {
                    try {
                        return await kernel.getServiceAsync<unknown>('tenancy');
                    } catch (err) {
                        if (isServiceNotRegisteredError(err)) return undefined;
                        throw err;
                    }
                }
                // The sync leg, for a `KernelBase`-shaped host (`LiteKernel`)
                // with no `getServiceAsync` — identical reasoning to
                // `objectQLProvider`'s: such a host supports no service
                // factories, so "not registered" is the only fault its accessor
                // can report and absorbing it is the same classification rather
                // than a second collapse.
                try {
                    return ctx.getService<unknown>('tenancy');
                } catch { return undefined; }
            };

            // ObjectQL resolver — single-kernel fallback so resolveExecCtx
            // can run sys_member / sys_user_permission_set lookups when
            // there is no kernelManager wired (e.g. `pnpm dev:crm`).
            //
            // [#30218] What is written below is the OWN-KERNEL leg only: the
            // provider itself is `environmentScopedProvider('objectql', …)`,
            // built after that seam is declared, so a request for an
            // environment reads THAT environment's engine and never this
            // plugin's. The hosted host kernel is a routing shell: the
            // transactional `POST /batch`, the `/meta` object-state and
            // published reads, and the meta read gate's disabled-package
            // owner step all asked this kernel's engine for a request that
            // resolved to an environment, while `computeExecCtx` read the
            // environment's — two kernels, one request. The legs, the
            // classification and the sync leg below are otherwise unchanged.
            // [#4251 B3] `IObjectQLEngine`, not `IDataEngine`: the `objectql`
            // slot is the SAME instance as `data` seen whole, and the consumer
            // (`resolveExecCtx`, and the `transaction` probe behind the batch
            // routes) reaches the full engine, not just the data plane.
            //
            // [#13904] Absorb ONLY "nothing is registered under 'objectql'" —
            // the supported no-data-plane composition (`optionalDependencies:
            // ['com.objectstack.engine.objectql']` above), which must keep
            // resolving `undefined` quietly. Every other rejection re-raises,
            // so it reaches the transport's `wiredEngineOrLoud` seam (#13476)
            // and answers as the outage it is, instead of being collapsed into
            // "no engine is wired" one layer before that seam can see it.
            //
            // The classification is the REGISTRY's, never message text. The
            // resolution goes through `kernel.getServiceAsync` →
            // `PluginLoader.getService`, whose "never registered" rejection is
            // branded (`isServiceNotRegisteredError`, #13905) and whose every
            // other rejection — a factory that threw, a scoped registration
            // resolved without a scope id, a circular service dependency —
            // stays unbranded: the set is closed and its default is LOUD.
            //
            // The old `ctx.getService` + catch-all collapsed three
            // distinguishable conditions into one `undefined`. Where each
            // lands now:
            //   - never registered             → branded → `undefined`, quiet;
            //   - registered as a FACTORY      → the async accessor constructs
            //     and returns the engine (the sync accessor could only throw
            //     `is async - use await` here — the condition dissolves);
            //   - registered and FAILED to build → unbranded → re-raised, loud.
            //
            // The sync leg below is for a KernelBase-shaped host (`LiteKernel`)
            // with no `getServiceAsync`. Such a host has no service factories
            // either (its `registerServiceFactory` throws "not supported"), so
            // its accessor has exactly ONE fault to report — not registered —
            // and absorbing it is the same classification, not a second
            // collapse.
            const objectQLOnOwnKernel = async (): Promise<IObjectQLEngine | undefined> => {
                const kernel = typeof ctx.getKernel === 'function' ? ctx.getKernel() : undefined;
                if (kernel && typeof kernel.getServiceAsync === 'function') {
                    try {
                        return await kernel.getServiceAsync<IObjectQLEngine>('objectql');
                    } catch (err) {
                        if (isServiceNotRegisteredError(err)) return undefined;
                        throw err;
                    }
                }
                try {
                    return ctx.getService<IObjectQLEngine>('objectql');
                } catch { return undefined; }
            };

            // [#30011] The ENVIRONMENT-SCOPED provider seams: email, sharing,
            // approvals, sharing rules and analytics — [#30192] security,
            // auth, settings, i18n and metadata — and [#30218] the `objectql`
            // engine. Each slot is filled by a
            // plugin the ENVIRONMENT's kernel mounts. A host that fronts many
            // environment kernels with this one plugin (cloud's hosted runtime)
            // therefore holds the occupant a request needs on that request's
            // kernel, never on this plugin's own. These used to read
            // `ctx.getService` here whatever environment they were asked for,
            // so a hosted request was answered by the HOST kernel's occupant —
            // absent there: the approvals list answered `[]` and a single
            // request 501 (#29999), and so did every `/security` door (#30192).
            //
            // The legs, in order:
            //  - an environment id AND a kernel manager → that environment's
            //    kernel, acquired through `kernelManager.getOrCreate`, the same
            //    acquisition the data path's `resolveProtocol` makes. The id is
            //    the one `RestServer.resolveRequestEnvironmentId` answered —
            //    the route passes it: the scoped param, else the host's resolver
            //    for a hostname-routed request. This seam resolves no
            //    environment itself; there is one resolver, and it is that one.
            //    ⛔ No fall back to this plugin's occupant when the environment's
            //    kernel carries none, nor when acquiring it fails: a request
            //    for environment A is answered by A's service or by nothing.
            //    Absent → `undefined` → the route's own "not configured"
            //    answer; an acquisition that fails rejects, and the route
            //    decides.
            //  - `'platform'` — Studio's reserved control-plane id, never a
            //    kernel (`resolveProtocol` says why) → this plugin's own kernel.
            //  - no id (a control-plane request), or no kernel manager (a
            //    single-kernel deployment) → `ctx.getService` on this plugin's
            //    own kernel, exactly as before.
            //
            // On the environment's kernel the classification is the registry's,
            // as in `objectQLOnOwnKernel` above: "never registered" (branded) is
            // `undefined`, and any other fault — a factory that threw — is
            // re-raised rather than folded into "not configured".
            //
            // [#30218] `onOwnKernel` replaces the last leg for a seam whose
            // own-kernel read is classified more strictly than `ctx.getService`'s
            // catch-all — the `objectql` engine, whose own leg keeps its
            // factory-aware async read and its `LiteKernel` sync leg. The
            // environment leg is the same for every seam.
            const environmentScopedProvider = <T>(slot: string, onOwnKernel?: () => Promise<T | undefined>) =>
                async (environmentId?: string): Promise<T | undefined> => {
                    if (kernelManager && environmentId && environmentId !== 'platform') {
                        const kernel = await kernelManager.getOrCreate(environmentId);
                        try {
                            return await kernel.getServiceAsync<T>(slot);
                        } catch (err) {
                            if (isServiceNotRegisteredError(err)) return undefined;
                            throw err;
                        }
                    }
                    if (onOwnKernel) return onOwnKernel();
                    try {
                        return ctx.getService<T>(slot);
                    } catch { return undefined; }
                };

            // [#30218] The data engine — `resolveExecCtx`'s single-kernel
            // lookups, the transactional `POST /batch`, the `/meta` object-state
            // and published reads, and the meta read gate's disabled-package
            // owner step. Environment-scoped like the seams below: a request for
            // environment A is answered by A's engine or by nothing, so a batch
            // for A opens its transaction on A's store and writes nowhere else.
            const objectQLProvider = environmentScopedProvider<IObjectQLEngine>('objectql', objectQLOnOwnKernel);

            // Email service resolver — used by POST /email/send.
            const emailServiceProvider = environmentScopedProvider<IEmailService>('email');

            // Sharing service resolver — used by /data/:object/:id/shares.
            const sharingServiceProvider = environmentScopedProvider<ISharingService>('sharing');

            // Approvals service resolver — used by /approvals/* routes and the
            // approvals part of the record page.
            const approvalsServiceProvider = environmentScopedProvider<IApprovalService>('approvals');

            // Sharing-rule service resolver — used by /sharing/rules/* routes.
            const sharingRulesServiceProvider = environmentScopedProvider<ISharingRuleService>('sharingRules');

            // i18n service resolver — used to localize view / action / object
            // metadata. [#30192] Environment-scoped: an environment's
            // translation bundles live on its own kernel, so the host's bundle
            // never translates another environment's labels. A single kernel
            // still reads its own, so labels and select options get translated
            // without a kernelManager.
            const i18nServiceProvider = environmentScopedProvider<II18nService>('i18n');

            // Analytics service resolver — used by /analytics/dataset/query
            // (ADR-0021 dataset preview/query). Environment-scoped like the four
            // above: the service's strategy bridges are bound to its OWN
            // kernel's data engine, so only the request's environment's
            // occupant answers. Returns undefined when no analytics service is
            // registered so the route fails cleanly (501).
            const analyticsServiceProvider = environmentScopedProvider<IAnalyticsService>('analytics');

            // Settings service resolver — used by resolveExecCtx to resolve the
            // reference timezone/locale (localization manifest) through the 4-tier
            // cascade incl. the `OS_LOCALIZATION_TIMEZONE` env override. Returns
            // undefined when no settings service is registered (UTC default).
            // [#30192] Environment-scoped: an environment's localization
            // settings are stored and served by its own kernel, which the
            // runtime dispatcher's execution context already reads; the host's
            // occupant answered every hosted REST request instead.
            const settingsServiceProvider = environmentScopedProvider<SettingsReadSurface>('settings');

            // [#5224] Metadata service resolver — the endpoint matcher behind
            // `IMetadataService.matchEndpoint`. The two machine-readable
            // endpoint faces (`GET /meta/api`, `GET /openapi.json`) ask it
            // whether a declared route is actually served before announcing it,
            // so neither can publish an endpoint that answers 404. Returns
            // undefined when no `metadata` service is registered; the faces
            // then say so loudly rather than inventing a verdict.
            // [#30192] Environment-scoped: the matcher is built from the `api`
            // items its OWN kernel stores, so the host's would judge an
            // environment's endpoints against the host's declarations.
            const metadataServiceProvider = environmentScopedProvider<IMetadataService>('metadata');

            // Security service resolver — used by the ADR-0090 D5/D9
            // /security/suggested-bindings routes and the D6 /security/explain
            // route (plugin-security). Returns undefined when plugin-security
            // is not mounted so the routes fail cleanly (501).
            // [#30192] Environment-scoped: plugin-security registers `security`
            // on the environment's kernel, bound to that kernel's data engine,
            // and the hosted host kernel has no occupant, so every `/security`
            // door answered 501 and no owner could accept an installed app's
            // default permission set.
            const securityServiceProvider = environmentScopedProvider<ISecurityService>('security');

            // [#30955] Audit service resolver — used by the data export door,
            // which records every export it streams as a run-level `export` row
            // through the slot's `recordDataExport` (plugin-audit). Returns
            // undefined when plugin-audit is not mounted: no ledger, no row.
            // Environment-scoped like the seams above: plugin-audit's writers
            // write the ledger of the kernel they are registered on, so an
            // environment's exports are recorded in that environment's ledger.
            // `unknown`, deliberately: the slot's members are read structurally
            // by the one door that calls it (`data-action-routes.ts`).
            const auditServiceProvider = environmentScopedProvider<unknown>('audit');

            // Auth service resolver — used by RestServer.resolveExecCtx after
            // the request's environment kernel (and the default environment's)
            // answered no `auth`. [#30192] Environment-scoped: identity is
            // per environment (ADR-0006), so a request for an environment whose
            // kernel carries no `auth`, or whose `auth` failed to build, is
            // authenticated by nobody — never by the host's identity store, which
            // the caller would then record as that environment's. A single
            // kernel still reads its own.
            const authServiceProvider = environmentScopedProvider<IAuthService>('auth');

            if (!server) {
                ctx.logger.warn(`RestApiPlugin: HTTP Server service '${serverService}' not found. REST routes skipped.`);
                return;
            }
            
            if (!protocol) {
                ctx.logger.warn(`RestApiPlugin: Protocol service '${protocolService}' not found. REST routes skipped.`);
                return;
            }
            
            ctx.logger.info('Hydrating REST API from Protocol...');
            
            // Single-env service-existence probe for nav capability gates
            // (ADR-0057 D10). Multi-env uses the per-request kernel instead.
            // `unknown`, deliberately: the slot name is a runtime argument, so no
            // contract can be named here — and this probe asks only whether
            // SOMETHING occupies the slot, never touching its shape. `unknown`
            // says exactly that and, unlike `any`, makes any future member
            // access through this lookup a compile error instead of a silent one.
            const serviceExistsProvider = (name: string): boolean => {
                try { return ctx.getService<unknown>(name) != null; } catch { return false; }
            };
            // Declared out here, not inside the `try`: the direct-mount
            // composition below reports the routes it mounts back to this
            // instance (#5822), and the manager it needs to reach lives on it.
            // That scoping — the RestServer being invisible at the registrars'
            // call site — is the whole reason those nine routes bypassed
            // `RouteManager` in the first place.
            let restServer: RestServer | undefined;
            try {
                restServer = new RestServer(server, protocol, config.api as any, kernelManager, envRegistry, defaultEnvironmentIdProvider, authServiceProvider, objectQLProvider, emailServiceProvider, sharingServiceProvider, /* retired saved-report slot (#20102) */ undefined, approvalsServiceProvider, sharingRulesServiceProvider, i18nServiceProvider, analyticsServiceProvider, settingsServiceProvider, serviceExistsProvider, securityServiceProvider, requestEnvResolver, metadataServiceProvider, tenancyServiceProvider, auditServiceProvider);
                restServer.registerRoutes();

                ctx.logger.info('REST API successfully registered');

                // [#3963] The `api.requireAuth` opt-out is retired — anonymous
                // callers are denied unconditionally, so there is no fail-open
                // posture left to warn about (and no misplaced-nesting footgun).
                // A surface that legitimately serves a session-less caller now
                // derives its own narrow authorization from a declaration; see
                // `shouldDenyAnonymous` in @objectstack/core for the list.
                if ((config.api as any)?.requireAuth !== undefined
                    || (config.api as any)?.api?.requireAuth !== undefined) {
                    ctx.logger.warn(
                        '[security] `api.requireAuth` was removed and is IGNORED — anonymous access to '
                        + 'object data is always denied. Publish public surfaces by declaration instead: a public '
                        + 'form view, a share link, or `book.audience: \'public\'`.',
                    );
                }
            } catch (err: any) {
                ctx.logger.error('Failed to register REST API routes', { error: err.message } as any);
                throw err;
            }

            const enableProjectScoping = config.api?.api?.enableProjectScoping ?? false;
            const projectResolution = config.api?.api?.projectResolution ?? 'auto';

            // The RouteManager-bypassing registrars (package management,
            // external-datasource federation), mounted AND recorded in one
            // step (#5822) so `restServer.getRoutes()` — and therefore
            // `GET {apiPath}/openapi.json` — describes this boot's whole
            // surface. `direct-mount-composition.ts` owns which registrars
            // those are; the route-ledger conformance guard drives the same
            // function, so a registrar added there cannot slip past it.
            if (restServer) {
                // [commit fec784863] ONE base for the whole surface. This is the same
                // value `registerRoutes()` mounted everything else under —
                // asked of the server that owns it, never recomputed here.
                // The old line was `${basePath}/${version}`, which is
                // `getApiBasePath()` minus its `apiPath` branch: a deployment
                // setting `api.apiPath` moved 83 routes and left these 9
                // behind at `/api/v1`. Reading the base instead of rebuilding
                // it is the whole fix — and it is why the advertisement needs
                // no edit: `/discovery`'s `routes.packages` /
                // `routes.datasources` are projections of the routes these
                // registrars report back (#6633), so the advertisement moves
                // with the mount by construction.
                const versionedBase = restServer.getApiBasePath();
                mountAndRecordDirectRoutes({
                    server,
                    recorder: restServer,
                    ctx,
                    versionedBase,
                    // [#7033 / #7023] The package routes' authorization gate reads
                    // the SAME identity resolution the rest of the surface does.
                    resolveExecutionContext: (req) => restServer.resolvePackageRouteExecutionContext(req),
                    enableProjectScoping,
                    projectResolution,
                });
            }
        }
    };
}
