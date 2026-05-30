// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext, IHttpServer } from '@objectstack/core';
import { RestServer, RestKernelManager } from './rest-server.js';
import { ObjectStackProtocol, RestServerConfig } from '@objectstack/spec/api';
import { registerPackageRoutes } from './package-routes.js';
import { registerExternalDatasourceRoutes } from './external-datasource-routes.js';
import type { PackageService } from '@objectstack/service-package';

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
        
        init: async (_ctx: PluginContext) => {
            // No service registration, this is a consumer plugin
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

            if (!server) {
                ctx.logger.warn(`RestApiPlugin: HTTP Server service '${serverService}' not found. REST routes skipped.`);
                return;
            }
            
            if (!protocol) {
                ctx.logger.warn(`RestApiPlugin: Protocol service '${protocolService}' not found. REST routes skipped.`);
                return;
            }
            
            ctx.logger.info('Hydrating REST API from Protocol...');
            
            try {
                const restServer = new RestServer(server, protocol, config.api as any, kernelManager, envRegistry, defaultEnvironmentIdProvider, authServiceProvider, objectQLProvider, emailServiceProvider, sharingServiceProvider, reportsServiceProvider, approvalsServiceProvider, sharingRulesServiceProvider, i18nServiceProvider);
                restServer.registerRoutes();

                ctx.logger.info('REST API successfully registered');
            } catch (err: any) {
                ctx.logger.error('Failed to register REST API routes', { error: err.message } as any);
                throw err;
            }

            // Register package management routes if service is available
            try {
                const packageService = ctx.getService<PackageService>('package');
                if (packageService) {
                    const basePath = config.api?.api?.basePath || '/api';
                    const version = config.api?.api?.version || 'v1';
                    const versionedBase = `${basePath}/${version}`;
                    const enableProjectScoping = config.api?.api?.enableProjectScoping ?? false;
                    const projectResolution = config.api?.api?.projectResolution ?? 'auto';

                    if (enableProjectScoping && projectResolution === 'required') {
                        // Only register the scoped variant
                        registerPackageRoutes(server, packageService, `${versionedBase}/environments/:environmentId`, {
                            protocol,
                        });
                    } else {
                        registerPackageRoutes(server, packageService, versionedBase, { protocol });
                        // External Datasource Federation routes (ADR-0015) —
                        // degrade gracefully when the service is not registered.
                        registerExternalDatasourceRoutes(server, ctx, versionedBase);
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
        }
    };
}
