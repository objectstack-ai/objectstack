// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ProjectKernelFactory backed by the control plane's Artifact API.
 *
 * Differs from {@link DefaultProjectKernelFactory} in two ways:
 *
 *  1. There is no local control-plane database to query — project rows
 *     come from the {@link ArtifactEnvironmentRegistry} cache populated
 *     via HTTP.
 *  2. There is no `ControlPlaneProxyDriver` mounted on the per-project
 *     kernel. The runtime is intentionally isolated from the control
 *     plane: each project kernel only knows about its own data driver.
 *
 * The kernel is bootstrapped with:
 *   • DriverPlugin(driver)  — project-scoped data driver, also aliased
 *                              as the `'cloud'` datasource so AuthPlugin's
 *                              identity manifest resolves locally.
 *   • ObjectQLPlugin
 *   • MetadataPlugin (no system-object registration)
 *   • AuthPlugin    — per-project, derives an HKDF secret from
 *                     `OS_AUTH_SECRET` + projectId. Each project owns its
 *                     own `sys_user/sys_session/...` tables in its own
 *                     Turso DB. Cookies are scoped to the project's
 *                     hostname (no `.<root>`-wide cross-project leak).
 *   • AppPlugin(artifact.metadata)  — compiled developer code
 */

import { createHmac } from 'node:crypto';
import { ObjectKernel } from '@objectstack/core';
import type * as Contracts from '@objectstack/spec/contracts';
import { DriverPlugin, AppPlugin } from '@objectstack/runtime';
import type { ProjectKernelFactory } from './kernel-manager.js';
import type { EnvironmentDriverRegistry } from './environment-registry.js';
import type { ArtifactApiClient } from './artifact-api-client.js';

type IDataDriver = Contracts.IDataDriver;

export interface ArtifactKernelFactoryConfig {
    client: ArtifactApiClient;
    envRegistry: EnvironmentDriverRegistry;
    /** Optional logger. */
    logger?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void; error?: (...a: any[]) => void };
    /** Optional kernel constructor config. */
    kernelConfig?: ConstructorParameters<typeof ObjectKernel>[0];
    /**
     * Base secret used to derive per-project AuthPlugin secrets via
     * HKDF-style HMAC-SHA256(baseSecret, projectId). Falls back to
     * `process.env.OS_AUTH_SECRET` / `AUTH_SECRET` at construction time.
     */
    authBaseSecret?: string;
}

/**
 * Derive a deterministic per-project auth secret. HMAC-SHA256 of the
 * projectId keyed by the base secret yields a 64-char hex string that is:
 *   - stable across container cold-starts (no DB lookup needed)
 *   - independent per project (forging a token on project A does not
 *     compromise project B)
 *   - rotatable by changing the base secret (will invalidate all sessions)
 */
function deriveProjectAuthSecret(baseSecret: string, projectId: string): string {
    return createHmac('sha256', baseSecret).update(`project:${projectId}`).digest('hex');
}

export class ArtifactKernelFactory implements ProjectKernelFactory {
    private readonly client: ArtifactApiClient;
    private readonly envRegistry: EnvironmentDriverRegistry;
    private readonly logger: NonNullable<ArtifactKernelFactoryConfig['logger']>;
    private readonly kernelConfig?: ArtifactKernelFactoryConfig['kernelConfig'];
    private readonly authBaseSecret: string;

    constructor(config: ArtifactKernelFactoryConfig) {
        this.client = config.client;
        this.envRegistry = config.envRegistry;
        this.logger = config.logger ?? console;
        this.kernelConfig = config.kernelConfig;
        this.authBaseSecret = (
            config.authBaseSecret
            ?? process.env.OS_AUTH_SECRET
            ?? process.env.AUTH_SECRET
            ?? ''
        ).trim();
    }

    async create(projectId: string): Promise<ObjectKernel> {
        let cached = this.envRegistry.peekById(projectId);
        if (!cached) {
            const driver = await this.envRegistry.resolveById(projectId);
            if (!driver) {
                throw new Error(`[ArtifactKernelFactory] Could not resolve driver for project '${projectId}'`);
            }
            cached = this.envRegistry.peekById(projectId);
            if (!cached) {
                throw new Error(`[ArtifactKernelFactory] envRegistry returned a driver but no cached entry for '${projectId}'`);
            }
        }

        const driver: IDataDriver = cached.driver;
        const project = cached.project as { id: string; organization_id?: string; hostname?: string };

        const artifact = await this.client.fetchArtifact(projectId);
        if (!artifact) {
            throw new Error(`[ArtifactKernelFactory] Artifact not available for project '${projectId}'`);
        }

        const { ObjectQLPlugin } = await import('@objectstack/objectql');
        const { MetadataPlugin } = await import('@objectstack/metadata');

        const kernel = new ObjectKernel(this.kernelConfig);

        // Register the project driver as both the unnamed default AND under
        // the `'cloud'` alias. AuthPlugin's manifest header historically
        // declares `defaultDatasource: 'cloud'`; aliasing here keeps that
        // path working without forcing every project's identity table
        // through a control-plane proxy.
        await kernel.use(new DriverPlugin(driver, { datasourceName: 'cloud' } as any));
        // Enable schema sync per-project so sys_user / sys_session / etc.
        // tables get created on the project's own DB. The host worker sets
        // `OS_SKIP_SCHEMA_SYNC=1` for the control-plane DB; that env var
        // must NOT bleed into project kernels because their auth tables
        // need provisioning. KernelManager caches kernels so this runs
        // at most once per cold-start per project.
        await kernel.use(new ObjectQLPlugin({ projectId: projectId, skipSchemaSync: false }));
        await kernel.use(new MetadataPlugin({
            watch: false,
            projectId: projectId,
            organizationId: project.organization_id,
            registerSystemObjects: false,
        }));

        // Per-project AuthPlugin — only when an OS_AUTH_SECRET base is
        // configured. Without it we cannot derive a secret deterministically
        // and refuse to start auth (better silent-fail than insecure default).
        if (this.authBaseSecret) {
            try {
                const { AuthPlugin } = await import('@objectstack/plugin-auth');
                const projectSecret = deriveProjectAuthSecret(this.authBaseSecret, projectId);
                const baseUrl = project.hostname
                    ? (project.hostname.startsWith('http') ? project.hostname : `https://${project.hostname}`)
                    : undefined;
                await kernel.use(new AuthPlugin({
                    secret: projectSecret,
                    baseUrl,
                    // Project kernel has no http-server (host owns it). The
                    // dispatcher's handleAuth path resolves `auth` via
                    // getService and invokes the handler directly — route
                    // registration is unnecessary and would warn.
                    registerRoutes: false,
                    // Identity tables live in the project's own DB — keep
                    // sys_user/sys_session local to this kernel.
                    manifestDatasource: 'default',
                    // Cookie scope: default to the project's own host. We
                    // intentionally do NOT pass crossSubDomainCookies here
                    // so cookies stay isolated per project subdomain.
                    trustedOrigins: baseUrl ? [baseUrl] : undefined,
                } as any));
            } catch (err: any) {
                this.logger.warn?.('[ArtifactKernelFactory] AuthPlugin not registered', {
                    projectId,
                    error: err?.message,
                });
            }
        } else {
            this.logger.warn?.('[ArtifactKernelFactory] OS_AUTH_SECRET not set — per-project AuthPlugin skipped (auth endpoints will return 404)', { projectId });
        }

        // Per-project SecurityPlugin — provides RBAC + tenant_isolation RLS
        // AND, crucially, the `sys_user` insert middleware that auto-creates
        // a personal organization for new self-service signups (without it,
        // a freshly registered user lands on a UI showing "No data" because
        // they have zero `sys_member` rows and the default RLS denies all).
        // The CLI's `objectstack serve` does this for `pnpm dev`; we have
        // to mirror that behaviour for cloud-deployed per-project kernels.
        try {
            const { SecurityPlugin } = await import('@objectstack/plugin-security');
            const multiTenant = String(process.env.OS_MULTI_TENANT ?? 'true').toLowerCase() !== 'false';
            await kernel.use(new SecurityPlugin({ multiTenant }) as any);
        } catch (err: any) {
            this.logger.warn?.('[ArtifactKernelFactory] SecurityPlugin not registered', {
                projectId,
                error: err?.message,
            });
        }

        const projectName = project.hostname ?? projectId;
        const bundle = artifact.metadata as any;
        const sys = bundle?.manifest ?? bundle;
        const packageId = sys?.packageId ?? sys?.package_id ?? bundle?.packageId;

        // Per-project i18n: register I18nServicePlugin BEFORE AppPlugin so
        // AppPlugin.loadTranslations() finds an i18n service to populate.
        // Without this, the artifact's `translations` array is silently
        // dropped and the `/api/v1/i18n/*` endpoints return empty payloads.
        const i18nCfg = (bundle?.i18n ?? sys?.i18n ?? {}) as Record<string, any>;
        const trArr = Array.isArray(bundle?.translations) ? bundle.translations
            : Array.isArray(sys?.translations) ? sys.translations : [];
        // Always register — even with no inline translations the service
        // can serve labels/locales loaded by hosted apps. Cheap to register.
        try {
            const { I18nServicePlugin } = await import('@objectstack/service-i18n');
            await kernel.use(new I18nServicePlugin({
                defaultLocale: i18nCfg.defaultLocale,
                fallbackLocale: i18nCfg.fallbackLocale ?? i18nCfg.defaultLocale ?? 'en',
                // Routes are dispatched by HttpDispatcher.handleI18n via
                // kernel.getService('i18n'); the host worker owns the
                // HTTP server. Skip self-registration to avoid warnings.
                registerRoutes: false,
            } as any));
            console.warn(
                `[ArtifactKernelFactory] I18nServicePlugin registered (project=${projectId}, translations=${trArr.length}, defaultLocale=${i18nCfg.defaultLocale ?? 'en'})`,
            );
        } catch (err: any) {
            this.logger.warn?.('[ArtifactKernelFactory] I18nServicePlugin not registered', {
                projectId,
                error: err?.message,
            });
        }

        await kernel.use(new AppPlugin(bundle, {
            projectId,
            organizationId: project.organization_id ?? '',
            projectName,
            packageId,
            source: packageId ? 'package' : 'user',
        } as any));

        await kernel.bootstrap();

        // Belt-and-braces: load translation bundles directly into the i18n
        // service after bootstrap. AppPlugin.loadTranslations should do this
        // during its `start` phase, but several conditions (missing objectql
        // service, runtime.onEnable throwing, bundle keys mismatch) can cause
        // it to bail before reaching the i18n step. Loading here guarantees
        // the bundles attached to the artifact metadata are always served via
        // `/api/v1/i18n/*`, regardless of AppPlugin's runtime path.
        let i18nSvc: any = null;
        try {
            i18nSvc = (kernel as any).getService?.('i18n');
        } catch {
            // getService throws when service isn't registered — leave null
            i18nSvc = null;
        }
        try {
            if (i18nSvc && typeof i18nSvc.loadTranslations === 'function') {
                if (i18nCfg.defaultLocale && typeof i18nSvc.setDefaultLocale === 'function') {
                    i18nSvc.setDefaultLocale(i18nCfg.defaultLocale);
                }
                let loaded = 0;
                for (const tbundle of trArr) {
                    if (!tbundle || typeof tbundle !== 'object') continue;
                    for (const [locale, data] of Object.entries(tbundle)) {
                        if (data && typeof data === 'object') {
                            try {
                                i18nSvc.loadTranslations(locale, data as Record<string, unknown>);
                                loaded++;
                            } catch (err: any) {
                                this.logger.warn?.('[ArtifactKernelFactory] i18n loadTranslations failed', {
                                    projectId, locale, error: err?.message,
                                });
                            }
                        }
                    }
                }
                if (loaded > 0) {
                    this.logger.info?.('[ArtifactKernelFactory] i18n direct-load complete', {
                        projectId, locales: loaded, bundles: trArr.length,
                    });
                }
            }
        } catch (err: any) {
            this.logger.warn?.('[ArtifactKernelFactory] i18n direct-load failed', {
                projectId,
                error: err?.message,
            });
        }

        this.logger.info?.('[ArtifactKernelFactory] kernel ready', {
            projectId,
            commitId: artifact.commitId,
            checksum: artifact.checksum,
            authEnabled: Boolean(this.authBaseSecret),
        });

        return kernel;
    }
}
