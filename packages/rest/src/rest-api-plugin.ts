// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext, IHttpServer } from '@objectstack/core';
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
    IReportService,
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
 * declares no `implements` — there is no contract to name. The one method the
 * platform consumes is `get`, through `resolveLocalizationContext`'s 4-tier
 * timezone/locale/currency cascade; its return type is the PUBLIC
 * `ResolvedSettingValue` from `@objectstack/spec/system`, so only the context
 * argument is described structurally (`SettingsContext` is service-local).
 */
interface SettingsReadSurface {
    get<T = unknown>(
        namespace: string,
        key: string,
        ctx?: { tenantId?: string; userId?: string },
    ): Promise<ResolvedSettingValue<T>>;
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
                            await kernelResolver.resolveKernel(context, hostKernelFacade);
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

            // Auth service resolver — used by RestServer.resolveExecCtx in
            // single-kernel deployments where there is no kernelManager.
            // Multi-kernel paths look up auth via kernelManager.getOrCreate,
            // so this provider is the single-kernel fallback.
            const authServiceProvider = async (_environmentId?: string): Promise<IAuthService | undefined> => {
                try {
                    return ctx.getService<IAuthService>('auth');
                } catch { return undefined; }
            };

            // ObjectQL resolver — single-kernel fallback so resolveExecCtx
            // can run sys_member / sys_user_permission_set lookups when
            // there is no kernelManager wired (e.g. `pnpm dev:crm`).
            // [#4251 B3] `IObjectQLEngine`, not `IDataEngine`: the `objectql`
            // slot is the SAME instance as `data` seen whole, and the consumer
            // (`resolveExecCtx`, and the `transaction` probe behind the batch
            // routes) reaches the full engine, not just the data plane.
            const objectQLProvider = async (_environmentId?: string): Promise<IObjectQLEngine | undefined> => {
                try {
                    return ctx.getService<IObjectQLEngine>('objectql');
                } catch { return undefined; }
            };

            // Email service resolver — used by POST /email/send. Single-
            // kernel deployments resolve from the local kernel; multi-
            // tenant paths would resolve via kernelManager.getOrCreate.
            const emailServiceProvider = async (_environmentId?: string): Promise<IEmailService | undefined> => {
                try {
                    return ctx.getService<IEmailService>('email');
                } catch { return undefined; }
            };

            // Sharing service resolver — used by /data/:object/:id/shares.
            const sharingServiceProvider = async (_environmentId?: string): Promise<ISharingService | undefined> => {
                try {
                    return ctx.getService<ISharingService>('sharing');
                } catch { return undefined; }
            };

            // Reports service resolver — used by /reports/* routes.
            const reportsServiceProvider = async (_environmentId?: string): Promise<IReportService | undefined> => {
                try {
                    return ctx.getService<IReportService>('reports');
                } catch { return undefined; }
            };

            // Approvals service resolver — used by /approvals/* routes.
            const approvalsServiceProvider = async (_environmentId?: string): Promise<IApprovalService | undefined> => {
                try {
                    return ctx.getService<IApprovalService>('approvals');
                } catch { return undefined; }
            };

            // Sharing-rule service resolver — used by /sharing/rules/* routes.
            const sharingRulesServiceProvider = async (_environmentId?: string): Promise<ISharingRuleService | undefined> => {
                try {
                    return ctx.getService<ISharingRuleService>('sharingRules');
                } catch { return undefined; }
            };

            // i18n service resolver — used to localize view / action / object
            // metadata. Single-kernel fallback so labels and select options
            // get translated even without a full multi-tenant kernelManager.
            const i18nServiceProvider = async (_environmentId?: string): Promise<II18nService | undefined> => {
                try {
                    return ctx.getService<II18nService>('i18n');
                } catch { return undefined; }
            };

            // Analytics service resolver — used by /analytics/dataset/query
            // (ADR-0021 dataset preview/query). Returns undefined when no
            // analytics service is registered so the route fails cleanly (501).
            const analyticsServiceProvider = async (_environmentId?: string): Promise<IAnalyticsService | undefined> => {
                try {
                    return ctx.getService<IAnalyticsService>('analytics');
                } catch { return undefined; }
            };

            // Settings service resolver — used by resolveExecCtx to resolve the
            // reference timezone/locale (localization manifest) through the 4-tier
            // cascade incl. the `OS_LOCALIZATION_TIMEZONE` env override. Returns
            // undefined when no settings service is registered (UTC default).
            const settingsServiceProvider = async (_environmentId?: string): Promise<SettingsReadSurface | undefined> => {
                try {
                    return ctx.getService<SettingsReadSurface>('settings');
                } catch { return undefined; }
            };

            // [#5224] Metadata service resolver — the endpoint matcher behind
            // `IMetadataService.matchEndpoint`. The two machine-readable
            // endpoint faces (`GET /meta/api`, `GET /openapi.json`) ask it
            // whether a declared route is actually served before announcing it,
            // so neither can publish an endpoint that answers 404. Returns
            // undefined when no `metadata` service is registered; the faces
            // then say so loudly rather than inventing a verdict.
            const metadataServiceProvider = async (
                _environmentId?: string,
            ): Promise<IMetadataService | undefined> => {
                try {
                    return ctx.getService<IMetadataService>('metadata');
                } catch { return undefined; }
            };

            // Security service resolver — used by the ADR-0090 D5/D9
            // /security/suggested-bindings routes and the D6 /security/explain
            // route (plugin-security). Returns undefined when plugin-security
            // is not mounted so the routes fail cleanly (501).
            const securityServiceProvider = async (_environmentId?: string): Promise<ISecurityService | undefined> => {
                try {
                    return ctx.getService<ISecurityService>('security');
                } catch { return undefined; }
            };

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
                restServer = new RestServer(server, protocol, config.api as any, kernelManager, envRegistry, defaultEnvironmentIdProvider, authServiceProvider, objectQLProvider, emailServiceProvider, sharingServiceProvider, reportsServiceProvider, approvalsServiceProvider, sharingRulesServiceProvider, i18nServiceProvider, analyticsServiceProvider, settingsServiceProvider, serviceExistsProvider, securityServiceProvider, requestEnvResolver, metadataServiceProvider);
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
                        '[security] `api.requireAuth` was removed (#3963) and is IGNORED — anonymous access to '
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
                // [#6306] ONE base for the whole surface. This is the same
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
                    protocol,
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
