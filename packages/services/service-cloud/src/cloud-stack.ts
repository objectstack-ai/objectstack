// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * createCloudStack
 *
 * The single public API for cloud (multi-project) mode. Builds the ordered
 * plugin list and API config that `objectstack.config.ts` needs when
 * `OS_MODE=cloud`.
 *
 * Usage:
 *   import { createCloudStack } from '@objectstack/service-cloud';
 *   export default await createCloudStack({ authSecret, baseUrl });
 */

import { resolve as resolvePath } from 'node:path';
import type * as Contracts from '@objectstack/spec/contracts';
import type { BasePluginsFactory, AppBundleResolver } from './project-kernel-factory.js';
import type { ProjectTemplate } from './multi-project-plugin.js';
import { MultiProjectPlugin } from './multi-project-plugin.js';
import { createControlPlanePlugins } from './control-plane-preset.js';
import { createStudioRuntimeConfigPlugin, createTemplatesRoutePlugin } from './multi-project-plugins.js';
import { createCloudArtifactApiPlugin } from './cloud-artifact-api-plugin.js';
import { resolveDefaultDataDir } from './data-dir.js';
import { resolveStoragePluginFromEnv } from './storage-env.js';

type IDataDriver = Contracts.IDataDriver;

export interface CloudStackConfig {
    authSecret: string;
    baseUrl: string;
    /** Control-plane DB URL. Defaults to file:.objectstack/data/control.db */
    controlDriverUrl?: string;
    /** Auth token for libSQL/Turso control-plane driver. */
    controlDriverAuthToken?: string;
    /** Per-project base plugins factory. */
    basePlugins?: BasePluginsFactory;
    /** Per-project app bundle resolver. */
    appBundles?: AppBundleResolver;
    /** Template registry for provisioning-time seeding. */
    templates?: Record<string, ProjectTemplate>;
    /** KernelManager LRU size. Default: 32. */
    kernelCacheSize?: number;
    /** KernelManager idle TTL (ms). Default: 15 min. */
    kernelTtlMs?: number;
    /** EnvironmentDriverRegistry cache TTL (ms). Default: 5 min. */
    envCacheTtlMs?: number;
    /** API prefix. Default: /api/v1. */
    apiPrefix?: string;
}

async function buildControlDriver(url: string, authToken?: string): Promise<{
    driver: IDataDriver;
    driverName: 'sqlite' | 'turso' | 'postgres';
    databaseUrl: string;
}> {
    // Postgres / CockroachDB / any pg-wire database.
    // Accept both `postgres://` and `postgresql://` schemes; `pg://` is also recognised
    // for parity with the per-tenant artifact registry.
    if (/^(postgres(ql)?|pg):\/\//i.test(url)) {
        const { SqlDriver } = await import('@objectstack/driver-sql');
        // `pg` is a peer/optional dep of knex; bring it in here so a clear error
        // surfaces at boot if the host forgot to install it.
        try {
            await import('pg');
        } catch (err) {
            throw new Error(
                `[service-cloud] Control-plane URL "${url}" requires the "pg" driver. `
                + `Add \`pg\` to your application dependencies. Original: ${(err as Error).message}`,
            );
        }
        const poolMin = Number.parseInt(process.env.OS_CONTROL_PG_POOL_MIN ?? '0', 10);
        const poolMax = Number.parseInt(process.env.OS_CONTROL_PG_POOL_MAX ?? '10', 10);
        const driver = new SqlDriver({
            client: 'pg',
            connection: url,
            pool: {
                min: Number.isFinite(poolMin) ? poolMin : 0,
                max: Number.isFinite(poolMax) ? poolMax : 10,
            },
        });
        return { driver: driver as unknown as IDataDriver, driverName: 'postgres', databaseUrl: url };
    }

    if (/^(libsql|https?):\/\//i.test(url)) {
        const { TursoDriver } = await import('@objectstack/driver-turso');
        const driver = new TursoDriver({ url, authToken });
        return { driver: driver as unknown as IDataDriver, driverName: 'turso', databaseUrl: url };
    }

    const filename = url.replace(/^file:(\/\/)?/, '');
    const { SqlDriver } = await import('@objectstack/driver-sql');
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
    return { driver: driver as unknown as IDataDriver, driverName: 'sqlite', databaseUrl: `file:${filename}` };
}

export async function createCloudStack(config: CloudStackConfig): Promise<{
    plugins: any[];
    api: { enableProjectScoping: true; projectResolution: 'auto' };
}> {
    const {
        authSecret,
        baseUrl,
        // NOTE: no eager default here. The file-backed fallback is computed
        // lazily below so that serverless deployments which configure
        // TURSO_DATABASE_URL / OS_CONTROL_DATABASE_URL never trip the
        // resolveDefaultDataDir() throw-on-serverless guard.
        controlDriverUrl,
        controlDriverAuthToken,
        basePlugins,
        appBundles,
        templates = {},
        kernelCacheSize,
        kernelTtlMs,
        envCacheTtlMs,
        apiPrefix,
    } = config;

    // Resolve the control-plane DB URL.
    // Priority:
    //   1. OS_CONTROL_DATABASE_URL  (explicit, dedicated to the control plane)
    //   2. controlDriverUrl         (explicit param from the calling stack)
    //   3. OS_DATABASE_URL          (legacy alias — only used here when no
    //                                higher-priority source is set; reserved
    //                                going forward for the project's data DB)
    //   4. TURSO_DATABASE_URL       (legacy alias — recommended on Vercel)
    //   5. file:<resolveDefaultDataDir()>/control.db on writable filesystems.
    //      On serverless (Vercel / Lambda / Netlify) without any of the above,
    //      resolveDefaultDataDir() throws with a message pointing at Turso —
    //      we never silently fall back to ephemeral /tmp SQLite.
    const explicitControlUrl = process.env.OS_CONTROL_DATABASE_URL?.trim();
    const legacyControlUrl = (process.env.OS_DATABASE_URL || process.env.TURSO_DATABASE_URL)?.trim();
    const resolvedControlUrl = explicitControlUrl
        || controlDriverUrl
        || legacyControlUrl
        || `file:${resolvePath(resolveDefaultDataDir(), 'control.db')}`;
    const controlDriverPromise = buildControlDriver(
        resolvedControlUrl,
        process.env.OS_CONTROL_DATABASE_AUTH_TOKEN || process.env.OS_DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || controlDriverAuthToken,
    );

    // Default base plugins (per-project kernel — business data only).
    //
    // Identity, authentication, security, audit, and tenant catalogs are owned
    // exclusively by the control-plane kernel (see control-plane-preset.ts).
    // Their tables live in the control DB and must NOT be duplicated per project.
    // Each per-project kernel only registers the engines needed to materialise
    // that project's business-data schemas and records.
    const resolvedBasePlugins: BasePluginsFactory = basePlugins ?? (async ({ projectId, project }) => {
        const { ObjectQLPlugin } = await import('@objectstack/objectql');
        const { MetadataPlugin } = await import('@objectstack/metadata');
        const orgId = project.organization_id;
        return [
            new ObjectQLPlugin({ projectId: projectId }),
            new MetadataPlugin({
                watch: false,
                projectId: projectId,
                organizationId: orgId,
                // sys_* metadata-storage tables live in the control plane only.
                registerSystemObjects: false,
            }),
        ];
    });

    const multiProjectPluginProxy: any = {
        name: 'com.objectstack.multi-project',
        version: '0.0.0',
        _impl: null as any,
        async init(ctx: any) {
            try {
                const { driver: controlDriver } = await controlDriverPromise;
                this._impl = new MultiProjectPlugin({
                    controlDriver,
                    basePlugins: resolvedBasePlugins,
                    appBundles,
                    templates,
                    maxSize: Number(process.env.OS_KERNEL_CACHE_SIZE ?? kernelCacheSize ?? 32),
                    ttlMs: Number(process.env.OS_KERNEL_TTL_MS ?? kernelTtlMs ?? 15 * 60 * 1000),
                    cacheTTLMs: Number(process.env.OS_ENV_CACHE_TTL_MS ?? envCacheTtlMs ?? 5 * 60 * 1000),
                });
                if (this._impl.init) await this._impl.init(ctx);
            } catch (err: any) {
                console.error('[MultiProjectPlugin] init failed:', err?.stack ?? err?.message ?? err);
            }
        },
        async start(ctx: any) {
            if (this._impl?.start) await this._impl.start(ctx);
        },
        async stop(ctx: any) {
            if (this._impl?.stop) await this._impl.stop(ctx);
        },
    };

    // List templates for the static /cloud/templates route
    const templateList = Object.values(templates).map(({ id, label, description, category }) => ({
        id, label, description, category,
    }));

    const plugins = [
        ...createControlPlanePlugins({
            controlDriverPromise,
            authSecret,
            baseUrl,
        }),
        // Storage service (for artifact persistence + future file uploads).
        // Wires from env: OS_STORAGE_ADAPTER=s3 + OS_S3_BUCKET/OS_S3_REGION/...
        // Falls back to local-FS adapter (rooted at OS_STORAGE_LOCAL_DIR or
        // <data-dir>/storage). On serverless without S3 env vars, the cloud-
        // artifact plugin will warn — set OS_STORAGE_ADAPTER=s3 in production.
        ...(await resolveStoragePluginFromEnv()),
        multiProjectPluginProxy,
        createStudioRuntimeConfigPlugin({ apiPrefix }),
        createTemplatesRoutePlugin(templateList, { apiPrefix }),
        createCloudArtifactApiPlugin({ controlDriverPromise, apiPrefix }),
    ];

    return {
        plugins,
        api: {
            enableProjectScoping: true,
            projectResolution: 'auto',
        },
    };
}
