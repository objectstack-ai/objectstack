// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Standalone (runtime-only) stack factory.
 *
 * Builds the minimal plugin list for embedding ObjectStack in another
 * framework: ObjectQL + Driver + Metadata, plus AppPlugin if a compiled
 * artifact is available. No authentication, no Studio data, no control
 * plane — REST routes are served unauthenticated.
 *
 * Auto-detects the appropriate driver from the database URL scheme:
 *   - `memory://*`              → InMemoryDriver
 *   - `postgres[ql]://`, `pg://` → SqlDriver (pg)
 *   - `mongodb[+srv]://`        → MongoDBDriver (peer-dep `@objectstack/driver-mongodb`)
 *   - `file:` / no scheme       → SqlDriver (better-sqlite3)
 *
 * Unknown URL schemes throw — we never silently fall back to sqlite, since
 * that historically created bogus directories on disk (e.g. `mongodb:/`)
 * when an unsupported URL was treated as a file path.
 *
 * NOTE: `libsql://` / Turso support is provided by `@objectstack/driver-turso`,
 * which ships separately in the ObjectStack Cloud distribution. The open-core
 * runtime no longer dispatches `libsql://` URLs; cloud builds register the
 * Turso driver via their own stack composition (`cloud-stack.ts`).
 */

import { resolve as resolvePath } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { z } from 'zod';
import { readEnvWithDeprecation } from '@objectstack/types';
import { loadArtifactBundle, isHttpUrl } from './load-artifact-bundle.js';

/**
 * Resolve the ObjectStack home directory used to store cwd-independent
 * runtime data (default sqlite database, downloaded marketplace apps,
 * installed plugin cache).
 *
 * Resolution order:
 *   1. `OS_HOME` env var (absolute path; `~` expanded)
 *   2. `~/.objectstack` (cross-platform user-home default)
 *
 * The directory is created lazily by callers that actually write to it
 * (e.g. the sqlite driver's `mkdirSync(...)`); this helper does not
 * touch the filesystem.
 */
export function resolveObjectStackHome(): string {
    const raw = process.env.OS_HOME?.trim();
    if (raw && raw.length > 0) {
        if (raw.startsWith('~')) return resolvePath(homedir(), raw.slice(1).replace(/^[/\\]/, ''));
        return resolvePath(raw);
    }
    return resolvePath(homedir(), '.objectstack');
}

export const StandaloneStackConfigSchema = z.object({
    databaseUrl: z.string().optional(),
    databaseAuthToken: z.string().optional(),
    databaseDriver: z.enum(['sqlite', 'sqlite-wasm', 'memory', 'postgres', 'mongodb']).optional(),
    environmentId: z.string().optional(),
    artifactPath: z.string().optional(),
    /**
     * Project root directory. When set (typically by the CLI after locating
     * `objectstack.config.ts`), the default sqlite database is placed under
     * `<projectRoot>/.objectstack/data/standalone.db` instead of the global
     * `~/.objectstack/data/standalone.db`. This keeps per-project data
     * scoped to the project folder so different examples / apps don't
     * share a single database by accident.
     *
     * Explicit `databaseUrl` / `OS_DATABASE_URL` / `OS_HOME` still take
     * precedence over this default.
     */
    projectRoot: z.string().optional(),
    /**
     * Dev gate for the sqlite driver factory's native-better-sqlite3 → wasm →
     * in-memory step-down (#2229). When omitted, defaults to
     * `process.env.NODE_ENV === 'development'`. In production a native load
     * failure is NOT silently swapped for wasm/mingo (fail-closed).
     */
    dev: z.boolean().optional(),
});

export type StandaloneStackConfig = z.input<typeof StandaloneStackConfigSchema>;

export interface StandaloneStackResult {
    plugins: any[];
    api: { enableProjectScoping: false; projectResolution: 'none' };
    /**
     * Top-level metadata copied from the loaded artifact bundle (when an
     * artifact was successfully loaded). These are surfaced so callers
     * that wrap this result as a `defineStack()`-shaped config (e.g. the
     * CLI's `serve` command without a host `objectstack.config.ts`) can
     * still drive tier resolution, capability detection and driver
     * auto-registration off the artifact's declarations.
     */
    requires?: string[];
    objects?: any[];
    manifest?: any;
    /**
     * App-declared RBAC metadata, surfaced so the CLI (`serve`/`dev`/`start`)
     * can wire it without a host `objectstack.config.ts`. In particular the
     * `serve` command reads `permissions[]` to honour an app-declared default
     * profile (ADR-0056 D7 — `appDefaultPermissionSetName` → SecurityPlugin
     * `fallbackPermissionSet`) and reads both `positions[]` and `permissions[]` to
     * register application org roles with Better-Auth. Without these the
     * artifact-serve path silently fell back to the built-in `member_default`
     * (owner-only), so an `isDefault` profile declared purely in app metadata
     * was ignored under `objectstack dev`.
     */
    permissions?: any[];
    positions?: any[];
}

type ResolvedDriverKind = 'memory' | 'postgres' | 'mongodb' | 'sqlite' | 'sqlite-wasm';

function detectDriverFromUrl(dbUrl: string): ResolvedDriverKind {
    if (/^memory:\/\//i.test(dbUrl)) return 'memory';
    if (/^(postgres(ql)?|pg):\/\//i.test(dbUrl)) return 'postgres';
    if (/^mongodb(\+srv)?:\/\//i.test(dbUrl)) return 'mongodb';
    if (/^wasm-sqlite:\/\//i.test(dbUrl)) return 'sqlite-wasm';
    if (/\.wasm\.db$/i.test(dbUrl)) return 'sqlite-wasm';
    if (/^file:/i.test(dbUrl)) return 'sqlite';
    // Bare path without a scheme — treat as a sqlite file path.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(dbUrl)) return 'sqlite';
    throw new Error(
        `[StandaloneStack] Unsupported database URL scheme: ${dbUrl}. ` +
        `Supported schemes: memory://, postgres://, pg://, mongodb://, mongodb+srv://, file:`
    );
}

export async function createStandaloneStack(config?: StandaloneStackConfig): Promise<StandaloneStackResult> {
    const cfg = StandaloneStackConfigSchema.parse(config ?? {});

    const { ObjectQLPlugin } = await import('@objectstack/objectql');
    const { MetadataPlugin } = await import('@objectstack/metadata');
    const { DriverPlugin } = await import('./driver-plugin.js');
    const { AppPlugin } = await import('./app-plugin.js');

    const cwd = process.cwd();
    const environmentId = cfg.environmentId ?? process.env.OS_ENVIRONMENT_ID ?? 'proj_local';
    const artifactPathInput = cfg.artifactPath
        ?? process.env.OS_ARTIFACT_PATH
        ?? resolvePath(cwd, 'dist/objectstack.json');
    const artifactPath = isHttpUrl(artifactPathInput)
        ? artifactPathInput
        : (artifactPathInput.startsWith('/')
            ? artifactPathInput
            : resolvePath(cwd, artifactPathInput));

    const dbUrl = cfg.databaseUrl
        ?? readEnvWithDeprecation('OS_DATABASE_URL', 'DATABASE_URL', { silent: true })?.trim()
        ?? process.env.TURSO_DATABASE_URL?.trim()
        ?? (process.env.OS_HOME?.trim()
            ? `file:${resolvePath(resolveObjectStackHome(), 'data/standalone.db')}`
            : (cfg.projectRoot
                ? `file:${resolvePath(cfg.projectRoot, '.objectstack/data/standalone.db')}`
                : `file:${resolvePath(resolveObjectStackHome(), 'data/standalone.db')}`));
    // `databaseAuthToken` / `OS_DATABASE_AUTH_TOKEN` are preserved in the
    // config schema for cloud builds that compose their own turso driver;
    // the standalone (open-core) runtime no longer consumes them directly.
    const explicitDriver = cfg.databaseDriver
        ?? (process.env.OS_DATABASE_DRIVER?.trim() as ResolvedDriverKind | undefined);
    const dbDriver: ResolvedDriverKind = explicitDriver ?? detectDriverFromUrl(dbUrl);

    // Build the default driver. The user-facing kinds (memory / postgres /
    // better-sqlite3 / mongodb) go through the SHARED datasource driver factory
    // (ADR-0062) — the SAME `create({driver,config})` used for declared/runtime
    // datasources — so adding a dialect or changing connection/pool defaults
    // happens in ONE place instead of being mirrored here by hand. This stack
    // still owns what's standalone-specific: URL→config translation, filesystem
    // prep (`mkdir`), and `DriverPlugin` registration (pre-engine — unchanged).
    let driverPlugin: any;
    if (dbDriver === 'sqlite-wasm') {
        // The pure-JS WASM sqlite driver is the standalone-specific, CI-safe
        // (no native build) default — NOT a user-creatable runtime datasource
        // type, so it isn't part of the shared factory's surface. Construct it
        // directly here (this is its only construction site, so no duplication).
        const { SqliteWasmDriver } = await import('@objectstack/driver-sqlite-wasm' as any);
        const filename = dbUrl
            .replace(/^wasm-sqlite:(\/\/)?/i, '')
            .replace(/^file:(\/\/)?/i, '') || ':memory:';
        if (filename !== ':memory:') {
            mkdirSync(resolvePath(filename, '..'), { recursive: true });
        }
        driverPlugin = new DriverPlugin(
            new SqliteWasmDriver({
                filename,
                persist: filename !== ':memory:' ? 'on-write' : undefined,
            }) as any,
        );
    } else {
        const { createDefaultDatasourceDriverFactory } = await import('@objectstack/service-datasource');
        // #2229: in dev, a native better-sqlite3 ABI/load failure steps down to
        // wasm SQLite (real SQL + on-disk persistence) then in-memory; in prod it
        // fails loudly. Falls back to NODE_ENV when the caller did not pass `dev`.
        const factoryDev = cfg.dev ?? process.env.NODE_ENV === 'development';
        let driverId: string;
        let driverConfig: Record<string, unknown>;
        if (dbDriver === 'memory') {
            driverId = 'memory';
            driverConfig = {};
        } else if (dbDriver === 'postgres') {
            // Factory applies the pg pool default ({ min: 0, max: 5 }) internally.
            driverId = 'postgres';
            driverConfig = { url: dbUrl };
        } else if (dbDriver === 'mongodb') {
            driverId = 'mongodb';
            driverConfig = { url: dbUrl };
        } else {
            // sqlite (better-sqlite3)
            driverId = 'sqlite';
            const filename = dbUrl.replace(/^file:(\/\/)?/, '');
            if (!filename || /^[a-z][a-z0-9+.-]*:\/\//i.test(filename)) {
                throw new Error(
                    `[StandaloneStack] sqlite driver was selected but the URL does not look like a file path: "${dbUrl}". ` +
                    `Use file:/path/to/db.sqlite, or set OS_DATABASE_DRIVER explicitly.`
                );
            }
            mkdirSync(resolvePath(filename, '..'), { recursive: true });
            driverConfig = { filename };
        }

        let driverHandle: { driver?: unknown } | unknown;
        try {
            driverHandle = await createDefaultDatasourceDriverFactory({ dev: factoryDev }).create({ driver: driverId, config: driverConfig });
        } catch (err: any) {
            // Preserve the actionable hint the bespoke path gave for the optional
            // mongo peer dep (the factory throws a generic "not installed" message).
            if (dbDriver === 'mongodb') {
                throw new Error(
                    `[StandaloneStack] mongodb URL detected but @objectstack/driver-mongodb is not installed. ` +
                    `Add it as a dependency or pass an explicit driverPlugin. (${err?.message ?? err})`
                );
            }
            throw err;
        }
        // The factory returns a handle whose `.driver` is the concrete engine
        // driver (falls back to the handle itself for structural drivers).
        driverPlugin = new DriverPlugin(
            ((driverHandle as { driver?: unknown })?.driver ?? driverHandle) as any,
        );
    }

    const artifactBundle = await loadArtifactBundle(artifactPath, {
        tag: '[StandaloneStack]',
        unwrapEnvelope: true,
    });

    const plugins: any[] = [
        driverPlugin,
        new MetadataPlugin({
            // Source-file scanner OFF — declarative metadata is loaded
            // from the compiled artifact, not from yaml/json files on
            // disk. Scanning would also recursively watch the project
            // root (incl. node_modules), which is expensive and prone
            // to EMFILE.
            watch: false,
            // Artifact-file HMR ON in non-production so edits to
            // `*.view.ts` / `*.flow.ts` (which the CLI dev-mode watcher
            // recompiles into `dist/objectstack.json`) are picked up by
            // the running server WITHOUT requiring a manual restart.
            // Uses polling under the hood (see plugin.ts) to avoid
            // `fs.watch` EMFILE on macOS / busy dev hosts.
            artifactWatch: process.env.NODE_ENV !== 'production',
            environmentId,
            artifactSource: { mode: 'local-file', path: artifactPath },
        }),
        new ObjectQLPlugin({ environmentId }),
    ];
    if (artifactBundle) plugins.push(new AppPlugin(artifactBundle));

    // Surface artifact-declared metadata so a caller using this result
    // directly as a `defineStack()`-shaped config (no host
    // `objectstack.config.ts`) can still drive CLI tier resolution
    // and driver auto-registration. We copy *references* — no clone — so
    // the caller can `{ ...originalConfig, ...standaloneStack }` without
    // double-merging large object arrays.
    const requires: string[] | undefined =
        Array.isArray(artifactBundle?.requires)
            ? (artifactBundle.requires.filter((c: unknown) => typeof c === 'string') as string[])
            : undefined;
    const objects: any[] | undefined =
        Array.isArray(artifactBundle?.objects) ? artifactBundle.objects : undefined;
    const manifest: any | undefined = artifactBundle?.manifest;
    // ADR-0056 D7 — surface app-declared RBAC so the CLI's artifact-serve
    // path honours an `isDefault` profile (appDefaultPermissionSetName) and
    // registers application org names, exactly like the config-load path.
    const permissions: any[] | undefined =
        Array.isArray(artifactBundle?.permissions) ? artifactBundle.permissions : undefined;
    const positions: any[] | undefined =
        Array.isArray(artifactBundle?.positions) ? artifactBundle.positions : undefined;

    return {
        plugins,
        api: {
            enableProjectScoping: false,
            projectResolution: 'none',
        },
        ...(requires ? { requires } : {}),
        ...(objects ? { objects } : {}),
        ...(manifest ? { manifest } : {}),
        ...(permissions ? { permissions } : {}),
        ...(positions ? { positions } : {}),
    };
}
