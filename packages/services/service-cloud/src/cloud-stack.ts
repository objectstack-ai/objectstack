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
import type { ProjectTemplate } from './multi-project-plugin.js';
import { createControlPlanePlugins } from './control-plane-preset.js';
import { createStudioRuntimeConfigPlugin, createTemplatesRoutePlugin } from './multi-project-plugins.js';
import { createCloudArtifactApiPlugin } from './cloud-artifact-api-plugin.js';
import { resolveDefaultDataDir } from './data-dir.js';
import { resolveStoragePluginFromEnv, resolveStorageFromEnv } from './storage-env.js';

type IDataDriver = Contracts.IDataDriver;

/**
 * Cloud (control-plane) stack configuration.
 *
 * apps/cloud is intentionally narrow: it owns the control-plane DB
 * (organizations, projects, packages, billing), authentication
 * (better-auth), the cloud_control metadata-driven App, and the
 * artifact distribution API consumed by apps/objectos.
 *
 * It deliberately does NOT load per-project tenant kernels or
 * compiled app bundles — that responsibility lives in apps/objectos
 * (`createObjectOSStack`), which pulls artifacts from this stack
 * over HTTP and boots per-project kernels on demand.
 */
export interface CloudStackConfig {
    authSecret: string;
    baseUrl: string;
    /** Control-plane DB URL. Defaults to file:.objectstack/data/control.db */
    controlDriverUrl?: string;
    /** Auth token for libSQL/Turso control-plane driver. */
    controlDriverAuthToken?: string;
    /**
     * Template registry. Only the metadata (id/label/description/category)
     * is exposed via `GET /cloud/templates`; the actual seed bundles are
     * applied at runtime by the consumer of this control plane.
     */
    templates?: Record<string, ProjectTemplate>;
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
        templates = {},
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

    // Storage service — used by the artifact API to persist published
    // project bundles. Wires from env: OS_STORAGE_ADAPTER=s3 +
    // OS_S3_BUCKET/OS_S3_REGION/... Falls back to a local-FS adapter
    // (rooted at OS_STORAGE_LOCAL_DIR or <data-dir>/storage). On
    // serverless without S3 env vars the cloud-artifact plugin will warn
    // — set OS_STORAGE_ADAPTER=s3 in production.
    const storageEnv = await resolveStorageFromEnv();

    // List templates for the static /cloud/templates route. We expose
    // only the metadata (id/label/description/category); the actual seed
    // bundles are applied at runtime by whoever consumes this control
    // plane (apps/objectos), not here.
    const templateList = Object.values(templates).map(({ id, label, description, category }) => ({
        id, label, description, category,
    }));

    const plugins = [
        ...createControlPlanePlugins({
            controlDriverPromise,
            authSecret,
            baseUrl,
        }),
        ...(storageEnv.plugin ? [storageEnv.plugin] : []),
        createStudioRuntimeConfigPlugin({ apiPrefix }),
        createTemplatesRoutePlugin(templateList, { apiPrefix }),
        createCloudArtifactApiPlugin({ controlDriverPromise, apiPrefix }),
    ];

    return {
        plugins,
        api: {
            // Project scoping stays enabled so the reserved virtual id
            // `/api/v1/projects/platform/...` continues to resolve to the
            // control-plane protocol. Real per-project IDs (proj_xxx) have
            // no kernel here and will fall through to the same control-
            // plane protocol — apps/objectos is the runtime that owns
            // per-project data.
            enableProjectScoping: true,
            projectResolution: 'auto',
        },
    };
}
