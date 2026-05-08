// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Runtime-mode stack factory.
 *
 * Default behavior — boots a "runtime node" connected to ObjectStack
 * Cloud at `http://localhost:4000` (the local `apps/cloud` instance —
 * start it before the runtime). For the hosted control plane, set
 * `OS_CLOUD_URL=https://cloud.objectstack.ai`. The node
 * fetches per-project artifacts over HTTP and routes incoming requests
 * to the matching project kernel; no local control-plane database is
 * provisioned.
 *
 * Local opt-out — set `OS_CLOUD_URL=local` (or
 * `cloudUrl: 'local'`) to fall back to the legacy single-control-plane
 * shape, which mirrors `createCloudStack()` with two SQLite files
 * (`control.db` for the control plane and `<project_id>.db` for the
 * single project's business data). Used by self-hosted single-machine
 * dev workflows that don't want to depend on a remote control plane.
 *
 * The legacy local dataset:
 *
 *   <dataDir>/
 *   ├── control.db       — control plane (sys_organization, sys_project, …)
 *   └── proj_local.db    — single-project business data
 */

import { resolve as resolvePath } from 'node:path';
import { mkdirSync } from 'node:fs';
import { z } from 'zod';
import { createCloudStack } from './cloud-stack.js';
import { createSingleProjectPlugin } from './single-project-plugin.js';
import { resolveAuthSecret, resolveBaseUrl } from './boot-env.js';
import type { AppBundleResolver } from './project-kernel-factory.js';
import { createObjectOSStack } from './objectos-stack.js';
import { resolveDefaultDataDir } from './data-dir.js';

/**
 * Infer the storage driver type from a database connection-URL scheme.
 * Returns `''` if the URL is empty or the scheme is unrecognised.
 *
 *   mongodb://, mongodb+srv://         → 'mongodb'
 *   postgres://, postgresql://         → 'postgres'
 *   mysql://, mysql2://                → 'mysql'
 *   libsql://, https://*.turso.*       → 'turso'
 *   file:, sqlite:, :memory:, *.db,
 *   *.sqlite, *.sqlite3                → 'sqlite'
 */
function inferDriverFromUrl(url: string | undefined): string {
    if (!url) return '';
    const u = url.trim();
    if (/^mongodb(\+srv)?:\/\//i.test(u)) return 'mongodb';
    if (/^postgres(ql)?:\/\//i.test(u)) return 'postgres';
    if (/^mysql2?:\/\//i.test(u)) return 'mysql';
    if (/^libsql:\/\//i.test(u)) return 'turso';
    if (/^https?:\/\//i.test(u) && /\.turso\./i.test(u)) return 'turso';
    if (/^file:/i.test(u) || /^sqlite:/i.test(u) || u === ':memory:' || /\.(db|sqlite|sqlite3)$/i.test(u)) return 'sqlite';
    return '';
}

/**
 * Default ObjectStack Cloud base URL — the local `apps/cloud` instance
 * running on port 4000. Override via `OS_CLOUD_URL` (or
 * `RuntimeStackConfig.cloudUrl`) to point at a remote control plane
 * (e.g. `https://cloud.objectstack.ai`). Set to `local` to disable
 * cloud routing entirely and boot from a local `control.db` instead.
 *
 * Why a local default? Runtime nodes are designed to be paired with a
 * control plane. Defaulting to `localhost:4000` lets contributors run
 * `apps/cloud` (the open-source control plane) and `apps/objectos` (the
 * runtime) side-by-side with zero env config — the natural dev loop.
 */
export const DEFAULT_CLOUD_URL = 'http://localhost:4000';

export const RuntimeStackConfigSchema = z.object({
    /** Auth secret (defaults to env / dev fallback). Local-mode only. */
    authSecret: z.string().optional(),
    /** Public origin used by better-auth (defaults to env). Local-mode only. */
    baseUrl: z.string().optional(),
    /** Project id used as the seeded `sys_project.id`. Default: `proj_local`. Local-mode only. */
    projectId: z.string().optional(),
    /** Compiled artifact path. Default: `<cwd>/dist/objectstack.json`. Local-mode only. */
    artifactPath: z.string().optional(),
    /** Data directory holding `control.db` + `<projectId>.db`. Default: `<cwd>/.objectstack/data`. Local-mode only. */
    dataDir: z.string().optional(),
    /** Per-project AppBundleResolver. Local-mode only. */
    appBundles: z.custom<AppBundleResolver>().optional(),
    /** API prefix (passed through to the cloud preset). */
    apiPrefix: z.string().optional(),
    /**
     * ObjectStack Cloud base URL. Defaults to `http://localhost:4000`
     * (the local `apps/cloud` dev instance). For the hosted control
     * plane, set `OS_CLOUD_URL=https://cloud.objectstack.ai`.
     *
     * When non-empty (the default), the runtime stack runs as a
     * **cloud-connected runtime node**: no local control-plane database,
     * projects are resolved by hostname against ObjectStack Cloud and
     * per-project kernels are booted from artifacts pulled over HTTP.
     *
     * To run the legacy local-control-plane mode (single SQLite
     * `control.db` shared with one `proj_local.db`) instead, set the env
     * var to the sentinel value `local` (`OS_CLOUD_URL=local`)
     * or pass `cloudUrl: 'local'`.
     */
    cloudUrl: z.string().optional(),
    /** Bearer token for the ObjectStack Cloud API (defaults to `OS_CLOUD_API_KEY`). */
    cloudApiKey: z.string().optional(),
});

export type RuntimeStackConfig = z.input<typeof RuntimeStackConfigSchema>;

export interface RuntimeStackResult {
    plugins: any[];
    api: { enableProjectScoping: true; projectResolution: 'auto' };
}

/**
 * Build the plugin list for `runtime` mode. Returns the same shape as
 * `createCloudStack()` so callers can return the result directly from a
 * host config's `default export`.
 */
export async function createRuntimeStack(config?: RuntimeStackConfig): Promise<RuntimeStackResult> {
    const cfg = RuntimeStackConfigSchema.parse(config ?? {});

    // ── ObjectStack Cloud-connected branch ────────────────────────────────
    // Default: route every per-project boot through ObjectStack Cloud
    // (https://cloud.objectstack.ai) — no local control-plane DB, projects
    // are resolved by hostname against the cloud API and kernels are
    // booted from remote-fetched artifacts. To opt out and use the legacy
    // single-control-DB local mode, set OS_CLOUD_URL=local
    // (or `cloudUrl: 'local'`). See objectos-stack.ts.
    const rawCloudUrl = cfg.cloudUrl ?? process.env.OS_CLOUD_URL ?? DEFAULT_CLOUD_URL;
    const cloudUrl = rawCloudUrl.trim();
    const localOptOut = cloudUrl === '' || cloudUrl.toLowerCase() === 'local' || cloudUrl.toLowerCase() === 'off';
    if (!localOptOut) {
        return createObjectOSStack({
            controlPlaneUrl: cloudUrl,
            controlPlaneApiKey: cfg.cloudApiKey ?? process.env.OS_CLOUD_API_KEY,
            apiPrefix: cfg.apiPrefix,
        }) as Promise<RuntimeStackResult>;
    }

    const cwd = process.cwd();
    const projectId = cfg.projectId ?? process.env.OS_PROJECT_ID ?? 'proj_local';
    const artifactPath = cfg.artifactPath
        ?? process.env.OS_ARTIFACT_PATH
        ?? resolvePath(cwd, 'dist/objectstack.json');

    // Resolve DB URLs *before* deciding on a local data dir. When both the
    // control plane and the project DB are remote (libsql/postgres/…) we
    // never touch the filesystem — important on Vercel/Lambda where the
    // bundle is read-only and `mkdirSync('.objectstack/data')` would crash
    // at boot. The data dir (and its mkdir) is only needed for the
    // file-backed SQLite fallback paths.
    const envControlUrl = process.env.OS_CONTROL_DATABASE_URL?.trim();
    // Project DB. This is the user's business-data DB. When `OS_DATABASE_URL`
    // is set, honour it (and infer the driver from its scheme unless
    // `OS_DATABASE_DRIVER` overrides). On Vercel/Turso deployments the
    // official Turso integration sets `TURSO_DATABASE_URL` +
    // `TURSO_AUTH_TOKEN` — accept those as fallbacks so users don't have
    // to duplicate the secret. Otherwise fall back to a local SQLite
    // file beside `control.db`.
    const envProjectDbUrl = process.env.OS_DATABASE_URL?.trim()
        || process.env.TURSO_DATABASE_URL?.trim();

    const needsLocalDataDir = !envControlUrl || !envProjectDbUrl;
    const dataDir = cfg.dataDir
        ?? (needsLocalDataDir ? resolveDefaultDataDir() : '');
    if (needsLocalDataDir && dataDir) {
        mkdirSync(dataDir, { recursive: true });
    }

    // Control-plane DB. In single-project local mode this is the framework's
    // bookkeeping DB (sys_organization / sys_project / …). It defaults to a
    // local SQLite file. Users can override with `OS_CONTROL_DATABASE_URL`
    // (preferred); `OS_DATABASE_URL` is reserved for the *project's* data.
    const controlDbUrl = envControlUrl
        || `file:${resolvePath(dataDir || cwd, 'control.db')}`;

    const projectDbUrl = envProjectDbUrl
        || `file:${resolvePath(dataDir || cwd, `${projectId}.db`)}`;
    const projectDbDriver = (process.env.OS_DATABASE_DRIVER?.trim().toLowerCase())
        || inferDriverFromUrl(projectDbUrl)
        || 'sqlite';

    const authSecret = cfg.authSecret ?? resolveAuthSecret();
    const baseUrl = cfg.baseUrl ?? resolveBaseUrl();

    const stack = await createCloudStack({
        authSecret,
        baseUrl,
        controlDriverUrl: controlDbUrl,
        appBundles: cfg.appBundles,
        apiPrefix: cfg.apiPrefix,
        basePlugins: async ({ projectId: pid }: { projectId: string }) => {
            const { ObjectQLPlugin } = await import('@objectstack/objectql');
            const { MetadataPlugin } = await import('@objectstack/metadata');
            const { AppPlugin, loadArtifactBundle } = await import('@objectstack/runtime');

            const artifactBundle = await loadArtifactBundle(artifactPath, {
                tag: '[runtime-stack:basePlugins]',
                unwrapEnvelope: true,
            });

            const plugins: any[] = [
                new ObjectQLPlugin({ projectId: pid }),
            ];
            // MetadataPlugin's local-file source would crash on start when
            // OS_ARTIFACT_PATH is unset and the default file is absent
            // (e.g. when bundles arrive via OS_PROJECT_ARTIFACTS or the
            // sys_project.metadata DB row instead). Only wire it when the
            // artifact actually loaded.
            if (artifactBundle) {
                plugins.push(
                    new MetadataPlugin({
                        watch: false,
                        projectId: pid,
                        artifactSource: { mode: 'local-file', path: artifactPath },
                        registerSystemObjects: false,
                    }),
                    new AppPlugin(artifactBundle),
                );
            }
            return plugins;
        },
    });

    const filtered = stack.plugins.filter(
        (p: any) => p?.name !== 'com.objectstack.studio.runtime-config',
    );
    filtered.push(
        createSingleProjectPlugin({
            projectId,
            projectDatabaseUrl: projectDbUrl,
            projectDatabaseDriver: projectDbDriver,
            apiPrefix: cfg.apiPrefix,
        }),
    );

    return {
        plugins: filtered,
        api: stack.api,
    };
}

// ── Deprecated aliases (renamed v4.x: `project` → `runtime`) ──────────────────
/** @deprecated Use {@link RuntimeStackConfigSchema}. */
export const ProjectStackConfigSchema = RuntimeStackConfigSchema;
/** @deprecated Use {@link RuntimeStackConfig}. */
export type ProjectStackConfig = RuntimeStackConfig;
/** @deprecated Use {@link RuntimeStackResult}. */
export type ProjectStackResult = RuntimeStackResult;
/** @deprecated Use {@link createRuntimeStack}. */
export const createProjectStack = createRuntimeStack;
