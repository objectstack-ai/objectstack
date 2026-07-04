// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext, IHttpServer } from '@objectstack/core';
import { RestServer, RestKernelManager } from './rest-server.js';
import { ObjectStackProtocol, RestServerConfig } from '@objectstack/spec/api';
import { registerPackageRoutes } from './package-routes.js';
import { registerExternalDatasourceRoutes } from './external-datasource-routes.js';
import type { PackageService } from '@objectstack/service-package';
import { SysImportJob } from '@objectstack/platform-objects/audit';

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
 * 2. Consumes 'protocol' (ObjectStackProtocol)
 * 3. Instantiates RestServer to auto-generate routes
 */
export function createRestApiPlugin(config: RestApiPluginConfig = {}): Plugin {
    return {
        name: 'com.objectstack.rest.api',
        version: '1.0.0',
        
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
            let protocol: ObjectStackProtocol | undefined;

            try {
                server = ctx.getService<IHttpServer>(serverService);
            } catch (e) {
                // Ignore missing service
            }

            try {
                protocol = ctx.getService<ObjectStackProtocol>(protocolService);
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
            let envRegistry: any;
            try {
                envRegistry = ctx.getService<any>('env-registry');
            } catch (e) {
                // Not running in runtime/multi-environment mode — fine.
            }

            // Optional default-project provider — registered by
            // `createSingleEnvironmentPlugin` in single-environment local mode.
            // Lets RestServer route bare `/api/v1/data/...` URLs into the
            // lone project's kernel.
            const defaultEnvironmentIdProvider = (): string | undefined => {
                try {
                    const dp: any = ctx.getService('default-project');
                    return dp?.environmentId;
                } catch { return undefined; }
            };

            // Auth service resolver — used by RestServer.resolveExecCtx in
            // single-kernel deployments where there is no kernelManager.
            // Multi-kernel paths look up auth via kernelManager.getOrCreate,
            // so this provider is the single-kernel fallback.
            const authServiceProvider = async (_environmentId?: string): Promise<any | undefined> => {
                try {
                    return ctx.getService<any>('auth');
                } catch { return undefined; }
            };

            // ObjectQL resolver — single-kernel fallback so resolveExecCtx
            // can run sys_member / sys_user_permission_set lookups when
            // there is no kernelManager wired (e.g. `pnpm dev:crm`).
            const objectQLProvider = async (_environmentId?: string): Promise<any | undefined> => {
                try {
                    return ctx.getService<any>('objectql');
                } catch { return undefined; }
            };

            // Email service resolver — used by POST /email/send. Single-
            // kernel deployments resolve from the local kernel; multi-
            // tenant paths would resolve via kernelManager.getOrCreate.
            const emailServiceProvider = async (_environmentId?: string): Promise<any | undefined> => {
                try {
                    return ctx.getService<any>('email');
                } catch { return undefined; }
            };

            // Sharing service resolver — used by /data/:object/:id/shares.
            const sharingServiceProvider = async (_environmentId?: string): Promise<any | undefined> => {
                try {
                    return ctx.getService<any>('sharing');
                } catch { return undefined; }
            };

            // Reports service resolver — used by /reports/* routes.
            const reportsServiceProvider = async (_environmentId?: string): Promise<any | undefined> => {
                try {
                    return ctx.getService<any>('reports');
                } catch { return undefined; }
            };

            // Approvals service resolver — used by /approvals/* routes.
            const approvalsServiceProvider = async (_environmentId?: string): Promise<any | undefined> => {
                try {
                    return ctx.getService<any>('approvals');
                } catch { return undefined; }
            };

            // Sharing-rule service resolver — used by /sharing/rules/* routes.
            const sharingRulesServiceProvider = async (_environmentId?: string): Promise<any | undefined> => {
                try {
                    return ctx.getService<any>('sharingRules');
                } catch { return undefined; }
            };

            // i18n service resolver — used to localize view / action / object
            // metadata. Single-kernel fallback so labels and select options
            // get translated even without a full multi-tenant kernelManager.
            const i18nServiceProvider = async (_environmentId?: string): Promise<any | undefined> => {
                try {
                    return ctx.getService<any>('i18n');
                } catch { return undefined; }
            };

            // Analytics service resolver — used by /analytics/dataset/query
            // (ADR-0021 dataset preview/query). Returns undefined when no
            // analytics service is registered so the route fails cleanly (501).
            const analyticsServiceProvider = async (_environmentId?: string): Promise<any | undefined> => {
                try {
                    return ctx.getService<any>('analytics');
                } catch { return undefined; }
            };

            // Settings service resolver — used by resolveExecCtx to resolve the
            // reference timezone/locale (localization manifest) through the 4-tier
            // cascade incl. the `OS_LOCALIZATION_TIMEZONE` env override. Returns
            // undefined when no settings service is registered (UTC default).
            const settingsServiceProvider = async (_environmentId?: string): Promise<any | undefined> => {
                try {
                    return ctx.getService<any>('settings');
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
            const serviceExistsProvider = (name: string): boolean => {
                try { return ctx.getService<any>(name) != null; } catch { return false; }
            };
            try {
                const restServer = new RestServer(server, protocol, config.api as any, kernelManager, envRegistry, defaultEnvironmentIdProvider, authServiceProvider, objectQLProvider, emailServiceProvider, sharingServiceProvider, reportsServiceProvider, approvalsServiceProvider, sharingRulesServiceProvider, i18nServiceProvider, analyticsServiceProvider, settingsServiceProvider, serviceExistsProvider);
                restServer.registerRoutes();

                ctx.logger.info('REST API successfully registered');

                // ADR-0056 D2 (warn → enforce, ENFORCED): the global default is
                // secure-by-default — anonymous /data/* is denied unless the
                // deployment explicitly opts out. The warning remains for that
                // explicit opt-out so a fail-open posture is always visible.
                if ((config.api as any)?.api?.requireAuth === false) {
                    ctx.logger.warn(
                        '[security] anonymous access to the data API is ALLOWED (api.requireAuth=false, explicit opt-out) — ' +
                        'objects without OWD/RLS are world-readable. Remove the opt-out for secure-by-default and ' +
                        'expose public records via share-links / publicSharing / public forms (ADR-0056 D2).',
                    );
                }
                // Misplaced-key guard: the effective key is `api.api.requireAuth`
                // (RestApiPluginConfig.api is the full RestServerConfig). A flat
                // `api.requireAuth` is silently ignored by normalizeConfig — under
                // the deny default that turns an INTENDED public deployment into a
                // 401 outage with no diagnostic, so name the mistake loudly.
                if ((config.api as any)?.requireAuth !== undefined) {
                    ctx.logger.warn(
                        '[security] `api.requireAuth` is set at the WRONG nesting level and has NO effect — ' +
                        'move it to `api.api.requireAuth` (RestServerConfig.api.requireAuth). ' +
                        `The effective value this boot is ${(config.api as any)?.api?.requireAuth ?? true}.`,
                    );
                }
            } catch (err: any) {
                ctx.logger.error('Failed to register REST API routes', { error: err.message } as any);
                throw err;
            }

            const basePath = config.api?.api?.basePath || '/api';
            const version = config.api?.api?.version || 'v1';
            const versionedBase = `${basePath}/${version}`;
            const enableProjectScoping = config.api?.api?.enableProjectScoping ?? false;
            const projectResolution = config.api?.api?.projectResolution ?? 'auto';

            // Register package management routes if the service is available.
            try {
                const packageService = ctx.getService<PackageService>('package');
                if (packageService) {
                    if (enableProjectScoping && projectResolution === 'required') {
                        // Only register the scoped variant
                        registerPackageRoutes(server, packageService, `${versionedBase}/environments/:environmentId`, {
                            protocol,
                        });
                    } else {
                        registerPackageRoutes(server, packageService, versionedBase, { protocol });
                        if (enableProjectScoping) {
                            registerPackageRoutes(server, packageService, `${versionedBase}/environments/:environmentId`, {
                                protocol,
                            });
                        }
                    }
                    ctx.logger.info('Package management routes registered');
                }
            } catch (e) {
                // Package service not available, skip
                ctx.logger.debug('Package service not available, package routes skipped');
            }

            // External Datasource Federation routes (ADR-0015): catalog / draft /
            // import / validate. Registered unconditionally — they degrade
            // gracefully (503) when the `external-datasource` service is absent.
            // NOTE: the datasource *lifecycle* routes (ADR-0015 Addendum:
            // list / test / create / update / remove) moved to the private
            // `@objectstack/datasource-admin` package, which registers its own.
            try {
                registerExternalDatasourceRoutes(server, ctx, versionedBase);
                ctx.logger.info('Datasource federation routes registered');
            } catch (e: any) {
                ctx.logger.warn('Datasource federation routes registration failed', { error: e?.message });
            }
        }
    };
}
