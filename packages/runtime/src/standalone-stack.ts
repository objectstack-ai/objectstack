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
 *   - `libsql://`, `https://`   → TursoDriver
 *   - `postgres[ql]://`, `pg://` → SqlDriver (pg)
 *   - `mongodb[+srv]://`        → MongoDBDriver (peer-dep `@objectstack/driver-mongodb`)
 *   - `file:` / no scheme       → SqlDriver (better-sqlite3)
 *
 * Unknown URL schemes throw — we never silently fall back to sqlite, since
 * that historically created bogus directories on disk (e.g. `mongodb:/`)
 * when an unsupported URL was treated as a file path.
 */

import { resolve as resolvePath } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { z } from 'zod';
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
    databaseDriver: z.enum(['sqlite', 'sqlite-wasm', 'turso', 'memory', 'postgres', 'mongodb']).optional(),
    environmentId: z.string().optional(),
    artifactPath: z.string().optional(),
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
}

type ResolvedDriverKind = 'memory' | 'turso' | 'postgres' | 'mongodb' | 'sqlite' | 'sqlite-wasm';

function detectDriverFromUrl(dbUrl: string): ResolvedDriverKind {
    if (/^memory:\/\//i.test(dbUrl)) return 'memory';
    if (/^(libsql|https?):\/\//i.test(dbUrl)) return 'turso';
    if (/^(postgres(ql)?|pg):\/\//i.test(dbUrl)) return 'postgres';
    if (/^mongodb(\+srv)?:\/\//i.test(dbUrl)) return 'mongodb';
    if (/^wasm-sqlite:\/\//i.test(dbUrl)) return 'sqlite-wasm';
    if (/\.wasm\.db$/i.test(dbUrl)) return 'sqlite-wasm';
    if (/^file:/i.test(dbUrl)) return 'sqlite';
    // Bare path without a scheme — treat as a sqlite file path.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(dbUrl)) return 'sqlite';
    throw new Error(
        `[StandaloneStack] Unsupported database URL scheme: ${dbUrl}. ` +
        `Supported schemes: memory://, libsql://, https://, postgres://, pg://, mongodb://, mongodb+srv://, file:`
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
        ?? process.env.OS_DATABASE_URL?.trim()
        ?? process.env.TURSO_DATABASE_URL?.trim()
        ?? `file:${resolvePath(resolveObjectStackHome(), 'data/standalone.db')}`;
    const dbAuthToken = cfg.databaseAuthToken
        ?? process.env.OS_DATABASE_AUTH_TOKEN?.trim()
        ?? process.env.TURSO_AUTH_TOKEN?.trim();
    const explicitDriver = cfg.databaseDriver
        ?? (process.env.OS_DATABASE_DRIVER?.trim() as ResolvedDriverKind | undefined);
    const dbDriver: ResolvedDriverKind = explicitDriver ?? detectDriverFromUrl(dbUrl);

    let driverPlugin: any;
    if (dbDriver === 'memory') {
        const { InMemoryDriver } = await import('@objectstack/driver-memory');
        driverPlugin = new DriverPlugin(new InMemoryDriver());
    } else if (dbDriver === 'turso') {
        const { TursoDriver } = await import('@objectstack/driver-turso');
        driverPlugin = new DriverPlugin(
            new TursoDriver({ url: dbUrl, authToken: dbAuthToken }) as any,
        );
    } else if (dbDriver === 'postgres') {
        const { SqlDriver } = await import('@objectstack/driver-sql');
        driverPlugin = new DriverPlugin(
            new SqlDriver({
                client: 'pg',
                connection: dbUrl,
                pool: { min: 0, max: 5 },
            }) as any,
        );
    } else if (dbDriver === 'mongodb') {
        // MongoDB driver is an optional peer dependency. Importing it lazily
        // avoids forcing every standalone consumer to install the mongo SDK.
        let MongoDBDriver: any;
        try {
            ({ MongoDBDriver } = await import('@objectstack/driver-mongodb' as any));
        } catch (err: any) {
            throw new Error(
                `[StandaloneStack] mongodb URL detected but @objectstack/driver-mongodb is not installed. ` +
                `Add it as a dependency or pass an explicit driverPlugin. (${err?.message ?? err})`
            );
        }
        driverPlugin = new DriverPlugin(new MongoDBDriver({ url: dbUrl }) as any);
    } else if (dbDriver === 'sqlite-wasm') {
        const { SqliteWasmDriver } = await import('@objectstack/driver-sqlite-wasm' as any);
        const filename = dbUrl
            .replace(/^wasm-sqlite:(\/\/)?/i, '')
            .replace(/^file:(\/\/)?/i, '');
        if (filename && filename !== ':memory:') {
            mkdirSync(resolvePath(filename, '..'), { recursive: true });
        }
        driverPlugin = new DriverPlugin(
            new SqliteWasmDriver({
                filename: filename || ':memory:',
                persist: filename && filename !== ':memory:' ? 'on-write' : undefined,
            }) as any,
        );
    } else {
        // sqlite
        const { SqlDriver } = await import('@objectstack/driver-sql');
        const filename = dbUrl.replace(/^file:(\/\/)?/, '');
        if (!filename || /^[a-z][a-z0-9+.-]*:\/\//i.test(filename)) {
            throw new Error(
                `[StandaloneStack] sqlite driver was selected but the URL does not look like a file path: "${dbUrl}". ` +
                `Use file:/path/to/db.sqlite, or set OS_DATABASE_DRIVER explicitly.`
            );
        }
        mkdirSync(resolvePath(filename, '..'), { recursive: true });
        driverPlugin = new DriverPlugin(
            new SqlDriver({
                client: 'better-sqlite3',
                connection: { filename },
                useNullAsDefault: true,
            }),
        );
    }

    const artifactBundle = await loadArtifactBundle(artifactPath, {
        tag: '[StandaloneStack]',
        unwrapEnvelope: true,
    });
    if (artifactBundle) {
        const flowsCount = Array.isArray(artifactBundle?.flows) ? artifactBundle.flows.length : 'n/a';
        // eslint-disable-next-line no-console
        console.warn(
            `[StandaloneStack] artifact loaded: path=${artifactPath} keys=${Object.keys(artifactBundle).join(',')} flows=${flowsCount}`,
        );
    }

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

    return {
        plugins,
        api: {
            enableProjectScoping: false,
            projectResolution: 'none',
        },
        ...(requires ? { requires } : {}),
        ...(objects ? { objects } : {}),
        ...(manifest ? { manifest } : {}),
    };
}
