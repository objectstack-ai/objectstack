// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * EnvironmentKernelFactory backed by the control plane's Artifact API.
 *
 * Differs from {@link DefaultEnvironmentKernelFactory} in two ways:
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
 *   • MetadataPlugin (registers `sys_metadata` + `sys_metadata_history` on
 *                     the project DB — required by ADR-0005: customization
 *                     overlays such as user-created views/dashboards are
 *                     persisted by ObjectStackProtocolImplementation on the
 *                     per-project engine, so the table must exist there).
 *   • AuthPlugin    — per-project, derives an HKDF secret from
 *                     `OS_AUTH_SECRET` + environmentId. Each project owns its
 *                     own `sys_user/sys_session/...` tables in its own
 *                     Turso DB. Cookies are scoped to the project's
 *                     hostname (no `.<root>`-wide cross-project leak).
 *   • AppPlugin(artifact.metadata)  — compiled developer code
 */

import { createHmac } from 'node:crypto';
import { ObjectKernel } from '@objectstack/core';
import type * as Contracts from '@objectstack/spec/contracts';
import { DriverPlugin } from '../driver-plugin.js';
import { AppPlugin } from '../app-plugin.js';
import type { EnvironmentKernelFactory } from './kernel-manager.js';
import type { EnvironmentDriverRegistry } from './environment-registry.js';
import type { ArtifactApiClient } from './artifact-api-client.js';
import { loadCapabilities } from './capability-loader.js';
import {
    PLATFORM_SSO_PROVIDER_ID,
    derivePlatformSsoClientId,
    derivePlatformSsoClientSecret,
} from './platform-sso.js';

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
     * HKDF-style HMAC-SHA256(baseSecret, environmentId). Falls back to
     * `process.env.OS_AUTH_SECRET` / `AUTH_SECRET` at construction time.
     */
    authBaseSecret?: string;
}

/**
 * Derive a deterministic per-project auth secret. HMAC-SHA256 of the
 * environmentId keyed by the base secret yields a 64-char hex string that is:
 *   - stable across container cold-starts (no DB lookup needed)
 *   - independent per project (forging a token on project A does not
 *     compromise project B)
 *   - rotatable by changing the base secret (will invalidate all sessions)
 */
function deriveProjectAuthSecret(baseSecret: string, environmentId: string): string {
    return createHmac('sha256', baseSecret).update(`project:${environmentId}`).digest('hex');
}

export class ArtifactKernelFactory implements EnvironmentKernelFactory {
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

    async create(environmentId: string): Promise<ObjectKernel> {
        let cached = this.envRegistry.peekById(environmentId);
        if (!cached) {
            const driver = await this.envRegistry.resolveById(environmentId);
            if (!driver) {
                throw new Error(`[ArtifactKernelFactory] Could not resolve driver for project '${environmentId}'`);
            }
            cached = this.envRegistry.peekById(environmentId);
            if (!cached) {
                throw new Error(`[ArtifactKernelFactory] envRegistry returned a driver but no cached entry for '${environmentId}'`);
            }
        }

        const driver: IDataDriver = cached.driver;
        const project = cached.project as { id: string; organization_id?: string; hostname?: string };

        const artifact = await this.client.fetchArtifact(environmentId);
        if (!artifact) {
            throw new Error(`[ArtifactKernelFactory] Artifact not available for project '${environmentId}'`);
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
        await kernel.use(new ObjectQLPlugin({ environmentId: environmentId, skipSchemaSync: false }));
        await kernel.use(new MetadataPlugin({
            watch: false,
            environmentId: environmentId,
            organizationId: project.organization_id,
            // ADR-0005: customization overlays (user-created views, dashboards,
            // edited objects, ...) are persisted by
            // ObjectStackProtocolImplementation.saveMetaItem on whichever
            // engine the protocol is attached to. For per-project kernels that
            // means the project's own DB, so the sys_metadata + history tables
            // MUST be provisioned here. The previous `false` setting caused
            // "no such table: sys_metadata" errors on any PUT /api/v1/meta/*
            // call (e.g. Studio "Create View") against a project deployment.
            registerSystemObjects: true,
        }));

        // Per-project AuthPlugin — only when an OS_AUTH_SECRET base is
        // configured. Without it we cannot derive a secret deterministically
        // and refuse to start auth (better silent-fail than insecure default).
        if (this.authBaseSecret) {
            try {
                const { AuthPlugin } = await import('@objectstack/plugin-auth');
                const projectSecret = deriveProjectAuthSecret(this.authBaseSecret, environmentId);
                const baseUrl = project.hostname
                    ? (project.hostname.startsWith('http')
                        ? project.hostname
                        : (/(\.|^)localhost(:\d+)?$/i.test(project.hostname)
                            ? (() => {
                                const runtimePort = (process.env.OS_RUNTIME_PORT ?? '').trim();
                                const hasPort = /:\d+$/.test(project.hostname);
                                const hostWithPort = hasPort || !runtimePort
                                    ? project.hostname
                                    : `${project.hostname}:${runtimePort}`;
                                return `http://${hostWithPort}`;
                            })()
                            : `https://${project.hostname}`))
                    : undefined;

                // Build the list of trusted origins for CSRF.
                // - Production: just the project's https baseUrl + any
                //   platform-wide origins from OS_TRUSTED_ORIGINS (so
                //   hostname renames don't require a kernel evict — the
                //   parent worker already trusts `https://*.<rootdomain>`).
                // - Dev (*.localhost): also trust http variants on any port so
                //   the local objectos dev server (PORT=4100 or any user-chosen
                //   port) can complete sign-in from the browser. baseUrl alone
                //   is `https://*.localhost` (no port, https) which the
                //   browser's Origin (`http://*.localhost:4100`) does NOT
                //   match — leading to better-auth "Invalid origin" 403.
                const trustedOriginsList: string[] = [];
                if (baseUrl) trustedOriginsList.push(baseUrl);
                // Inherit platform trusted-origin wildcards from the host
                // worker. Without this, renaming an environment leaves the
                // cached per-project kernel rejecting callbackURL=<new-host>
                // with INVALID_CALLBACK_URL until the next cold-start.
                const platformOrigins = (process.env.OS_TRUSTED_ORIGINS ?? '')
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                for (const o of platformOrigins) {
                    if (!trustedOriginsList.includes(o)) trustedOriginsList.push(o);
                }
                // Convenience: when OS_ROOT_DOMAIN is set, trust the entire
                // platform subdomain space. Matches the host worker's CORS
                // posture so SSO survives any future tenant-domain rename.
                const rootDomain = (process.env.OS_ROOT_DOMAIN ?? '').trim().replace(/^https?:\/\//, '');
                if (rootDomain) {
                    const wildcard = `https://*.${rootDomain}`;
                    if (!trustedOriginsList.includes(wildcard)) trustedOriginsList.push(wildcard);
                }
                if (project.hostname) {
                    const bareHost = project.hostname.replace(/^https?:\/\//, '');
                    if (bareHost.endsWith('.localhost') || bareHost === 'localhost') {
                        trustedOriginsList.push(`http://${bareHost}`);
                        trustedOriginsList.push(`http://${bareHost}:*`);
                        trustedOriginsList.push(`https://${bareHost}:*`);
                    }
                }

                // Platform SSO ("Airtable-style unified login"): when the
                // cloud control-plane is reachable AND the master secret is
                // shared between the two containers, wire better-auth's
                // genericOAuth plugin so a builder who already signed in
                // on `cloud.<root>` is JIT-provisioned as a `sys_user` on
                // every per-project deployment without re-registering.
                //
                // Opt-out: set OS_PLATFORM_SSO=false to fall back to the
                // legacy "every project owns its own login" mode.
                const platformSsoEnabled = String(
                    process.env.OS_PLATFORM_SSO ?? 'true',
                ).toLowerCase() !== 'false';
                const cloudBaseUrl = (process.env.OS_CLOUD_URL ?? '').trim().replace(/\/+$/, '');
                const oidcProviders = platformSsoEnabled
                    && cloudBaseUrl
                    && /^https?:\/\//.test(cloudBaseUrl)
                    ? [{
                        providerId: PLATFORM_SSO_PROVIDER_ID,
                        name: 'ObjectStack',
                        discoveryUrl: `${cloudBaseUrl}/.well-known/openid-configuration`,
                        clientId: derivePlatformSsoClientId(environmentId),
                        clientSecret: derivePlatformSsoClientSecret(this.authBaseSecret, environmentId),
                        scopes: ['openid', 'email', 'profile'],
                    }]
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
                    trustedOrigins: trustedOriginsList.length ? trustedOriginsList : undefined,
                    ...(oidcProviders ? { oidcProviders } : {}),
                } as any));
                if (oidcProviders) {
                    this.logger.info?.('[ArtifactKernelFactory] platform SSO wired', {
                        environmentId,
                        cloudBaseUrl,
                    });
                }
            } catch (err: any) {
                this.logger.warn?.('[ArtifactKernelFactory] AuthPlugin not registered', {
                    environmentId,
                    error: err?.message,
                });
            }
        } else {
            this.logger.warn?.('[ArtifactKernelFactory] OS_AUTH_SECRET not set — per-project AuthPlugin skipped (auth endpoints will return 404)', { environmentId });
        }

        // Per-project SecurityPlugin — provides RBAC + tenant_isolation RLS.
        // Note: this kernel does NOT auto-create personal organizations for
        // self-service signups. Project owners are bound to the mirrored
        // cloud-team org via `seedProjectOrganization` + `seedProjectMember`
        // below; SSO-JIT-provisioned members get attached to the same team
        // via the SSO callback path. The CLI's `objectstack serve` mirrors
        // this behaviour for `pnpm dev`.
        try {
            const { SecurityPlugin } = await import('@objectstack/plugin-security');
            const multiTenant = String(process.env.OS_MULTI_TENANT ?? 'false').toLowerCase() !== 'false';
            await kernel.use(new SecurityPlugin({ multiTenant }) as any);
        } catch (err: any) {
            this.logger.warn?.('[ArtifactKernelFactory] SecurityPlugin not registered', {
                environmentId,
                error: err?.message,
            });
        }

        const projectName = project.hostname ?? environmentId;
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
                `[ArtifactKernelFactory] I18nServicePlugin registered (project=${environmentId}, translations=${trArr.length}, defaultLocale=${i18nCfg.defaultLocale ?? 'en'})`,
            );
        } catch (err: any) {
            this.logger.warn?.('[ArtifactKernelFactory] I18nServicePlugin not registered', {
                environmentId,
                error: err?.message,
            });
        }

        // Tier-driven capability loading: install service plugins listed
        // in the artifact's `requires` array (e.g. ['ai','automation',
        // 'analytics']). Must be registered BEFORE AppPlugin so that
        // AppPlugin's start phase can hand off flows/agents/cubes to
        // services that are already initialised.
        const requiresRaw =
            (Array.isArray(bundle?.requires) ? bundle.requires : null) ??
            (Array.isArray(sys?.requires) ? sys.requires : null) ??
            [];
        const requires: string[] = (requiresRaw as unknown[])
            .filter((x): x is string => typeof x === 'string' && x.length > 0);

        if (requires.length > 0) {
            const installed = await loadCapabilities({
                kernel,
                requires,
                bundle: { ...(bundle ?? {}), ...(sys ?? {}) } as Record<string, unknown>,
                logger: this.logger,
                environmentId,
            });
            this.logger.info?.('[ArtifactKernelFactory] capabilities loaded', {
                environmentId,
                requires,
                installed,
            });
        }

        await kernel.use(new AppPlugin(bundle, {
            environmentId,
            organizationId: project.organization_id ?? '',
            projectName,
            packageId,
            source: packageId ? 'package' : 'user',
        } as any));

        await kernel.bootstrap();

        // Pre-seed the project owner. The cloud control-plane stashed the
        // creator's identity into `sys_environment.metadata.ownerSeed` at
        // project-create time; replay it AFTER `kernel.bootstrap()` so
        // ObjectQL/Security plugins have fully initialised and
        // `kernel.getService('objectql')` resolves. Pre-bootstrap, plugins
        // are only registered — services aren't wired yet.
        //
        // Order matters:
        //   1. Seed the OWNING cloud org into `sys_organization` so the
        //      project's primary workspace matches the cloud team that
        //      owns the project at the platform level.
        //   2. Seed the owner's `sys_user` row.
        //   3. Seed a `sys_member(owner)` row binding the user to the
        //      cloud org so their first sign-in resolves an
        //      activeOrganizationId without requiring an extra
        //      "create your first organization" step.
        //
        // All three are idempotent — safe across cold-boots.
        try {
            const projMeta: any = typeof (project as any)?.metadata === 'string'
                ? JSON.parse((project as any).metadata)
                : ((project as any)?.metadata ?? {});
            const ownerSeed = projMeta?.ownerSeed;
            const orgSeed = projMeta?.orgSeed;

            if (orgSeed?.id && orgSeed?.name) {
                try {
                    const { seedProjectOrganization } = await import('./environment-org-seed.js');
                    await seedProjectOrganization(kernel, orgSeed, this.logger);
                } catch (e: any) {
                    this.logger.warn?.('[ArtifactKernelFactory] orgSeed threw', {
                        environmentId,
                        error: e?.message,
                    });
                }
            }

            if (ownerSeed?.userId && ownerSeed?.email) {
                try {
                    const { seedProjectOwner } = await import('./environment-owner-seed.js');
                    await seedProjectOwner(kernel, ownerSeed, this.logger);
                } catch (e: any) {
                    this.logger.warn?.('[ArtifactKernelFactory] ownerSeed threw', {
                        environmentId,
                        error: e?.message,
                    });
                }

                if (orgSeed?.id) {
                    try {
                        const { seedProjectMember } = await import('./environment-org-seed.js');
                        await seedProjectMember(
                            kernel,
                            { userId: ownerSeed.userId, organizationId: orgSeed.id, role: 'owner' },
                            this.logger,
                        );
                    } catch (e: any) {
                        this.logger.warn?.('[ArtifactKernelFactory] memberSeed threw', {
                            environmentId,
                            error: e?.message,
                        });
                    }
                }
            }
        } catch (err: any) {
            this.logger.warn?.('[ArtifactKernelFactory] owner/org seed skipped', {
                environmentId,
                error: err?.message,
            });
        }

        // Post-bootstrap seed replay. The SecurityPlugin's `sys_organization`
        // insert middleware only fires when a brand-new org row is inserted,
        // so packages installed AFTER the env's primary org already exists
        // would never get their `data` arrays applied. Run the seed-replayer
        // once per kernel cold-start so newly-installed marketplace packages
        // (e.g. CRM with "Include sample data" ticked) hydrate the primary
        // org on the next request after install.
        //
        // SeedLoader uses upsert semantics, so re-running across cold-starts
        // is idempotent — at worst we pay one batch upsert per kernel boot.
        try {
            const datasetsNow: any[] | undefined = (() => {
                try { return (kernel as any).getService?.('seed-datasets'); } catch { return undefined; }
            })();
            const replayer: any = (() => {
                try { return (kernel as any).getService?.('seed-replayer'); } catch { return undefined; }
            })();

            if (Array.isArray(datasetsNow) && datasetsNow.length > 0 && typeof replayer === 'function') {
                // Resolve the env's primary organization. Prefer the explicit
                // orgSeed metadata (set when env is created via the data API);
                // fall back to scanning sys_organization for the first row
                // (env created via the lifecycle endpoint that doesn't stash
                // orgSeed, or any env that has been used at least once).
                const projMetaRaw: any = (project as any)?.metadata;
                const projMeta: any = typeof projMetaRaw === 'string' ? (() => {
                    try { return JSON.parse(projMetaRaw); } catch { return {}; }
                })() : (projMetaRaw ?? {});
                let primaryOrgId: string | undefined = projMeta?.orgSeed?.id;

                if (!primaryOrgId) {
                    try {
                        const ql: any = (kernel as any).getService?.('objectql');
                        if (ql?.find) {
                            const rows = await ql.find('sys_organization', { limit: 5, orderBy: [{ field: 'created_at', direction: 'asc' }] } as any);
                            const list = Array.isArray(rows) ? rows : (rows?.value ?? rows?.records ?? []);
                            if (Array.isArray(list) && list.length > 0 && list[0]?.id) {
                                primaryOrgId = String(list[0].id);
                            }
                        }
                    } catch { /* org table may not exist yet on a brand-new env */ }
                }

                if (primaryOrgId) {
                    try {
                        const summary = await replayer(primaryOrgId);
                        const inserted = summary?.inserted ?? 0;
                        const updated = summary?.updated ?? 0;
                        const errs = summary?.errors?.length ?? 0;
                        if (inserted > 0 || updated > 0 || errs > 0) {
                            this.logger.info?.('[ArtifactKernelFactory] post-bootstrap seed replay', {
                                environmentId,
                                organizationId: primaryOrgId,
                                datasets: datasetsNow.length,
                                inserted,
                                updated,
                                errors: errs,
                            });
                        }
                    } catch (e: any) {
                        this.logger.warn?.('[ArtifactKernelFactory] post-bootstrap seed replay failed', {
                            environmentId,
                            organizationId: primaryOrgId,
                            error: e?.message,
                        });
                    }
                }
            }
        } catch (err: any) {
            this.logger.warn?.('[ArtifactKernelFactory] post-bootstrap seed step threw', {
                environmentId,
                error: err?.message,
            });
        }

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
                                    environmentId, locale, error: err?.message,
                                });
                            }
                        }
                    }
                }
                if (loaded > 0) {
                    this.logger.info?.('[ArtifactKernelFactory] i18n direct-load complete', {
                        environmentId, locales: loaded, bundles: trArr.length,
                    });
                }
            }
        } catch (err: any) {
            this.logger.warn?.('[ArtifactKernelFactory] i18n direct-load failed', {
                environmentId,
                error: err?.message,
            });
        }

        this.logger.info?.('[ArtifactKernelFactory] kernel ready', {
            environmentId,
            commitId: artifact.commitId,
            checksum: artifact.checksum,
            authEnabled: Boolean(this.authBaseSecret),
        });

        return kernel;
    }
}
