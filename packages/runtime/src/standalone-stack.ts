// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Standalone (runtime-only) stack factory.
 *
 * Builds the minimal plugin list for embedding ObjectStack in another
 * framework: the declared `default` datasource + Metadata + ObjectQL, plus
 * AppPlugin if a compiled artifact is available. No authentication, no Studio
 * data, no control plane — REST routes are served unauthenticated.
 *
 * The `default` datasource is a DECLARATION (ADR-0062 D1, #3826): this stack
 * translates the database URL into a datasource definition and
 * `DefaultDatasourcePlugin` connects it at boot through the same
 * `DatasourceConnectionService` used for declared/runtime datasources.
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
import { readEnvWithDeprecation, stampSearchPinyinEnabled } from '@objectstack/types';
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
     * `~/.objectstack/data/standalone.db`, and the metadata FileSystemRepository
     * roots at `<projectRoot>/.objectstack/metadata`. This keeps per-project
     * data scoped to the project folder so different examples / apps don't
     * share a single database by accident.
     *
     * Both halves matter: until #4065 only the database honoured it while the
     * metadata repository still used `process.cwd()`, so a boot whose
     * projectRoot pointed elsewhere silently wrote `.objectstack/metadata/`
     * into the current directory.
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
    /**
     * Suppress the artifact's inline boot seed (#3917). Set by one-shot
     * commands that boot the stack only to READ metadata — `os migrate plan` /
     * `os migrate apply` — so the boot cannot write demo rows into the
     * operator's live database before they have confirmed anything.
     */
    skipSeedData: z.boolean().optional(),
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
     * The stack's `i18n` config as compiled into the artifact. Surfaced so a
     * caller wrapping this result as a `defineStack()`-shaped config (the CLI
     * artifact-serve path) drives the SAME locale-gated decisions the
     * config-load path drives — notably the pinyin-search default
     * (`stampSearchPinyinEnabled`, #3955). The boot itself already stamps the
     * decision; this keeps the surfaced config shape complete for consumers
     * that re-derive it.
     */
    i18n?: any;
    /**
     * App-declared RBAC metadata, surfaced so the CLI (`serve`/`dev`/`start`)
     * can wire it without a host `objectstack.config.ts`. The `serve` command
     * reads `permissions[]` to honour an app-declared default profile
     * (ADR-0056 D7 — `appDefaultPermissionSetName` → SecurityPlugin
     * `fallbackPermissionSet`). Without these the artifact-serve path silently
     * fell back to the built-in `member_default` (owner-only), so an
     * `isDefault` profile declared purely in app metadata was ignored under
     * `objectstack dev`.
     *
     * These are NOT organization roles: the `sys_member.role` vocabulary is
     * closed (ADR-0108). A declared position is distributed through
     * `sys_user_position` or an invitation's placement (ADR-0105 D8).
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

/** URL→filename for the two sqlite kinds. Throws on a URL that isn't a path. */
function sqliteFilenameFromUrl(dbUrl: string, kind: 'sqlite' | 'sqlite-wasm'): string {
    if (kind === 'sqlite-wasm') {
        return dbUrl
            .replace(/^wasm-sqlite:(\/\/)?/i, '')
            .replace(/^file:(\/\/)?/i, '') || ':memory:';
    }
    const filename = dbUrl.replace(/^file:(\/\/)?/, '');
    if (!filename || /^[a-z][a-z0-9+.-]*:\/\//i.test(filename)) {
        throw new Error(
            `[StandaloneStack] sqlite driver was selected but the URL does not look like a file path: "${dbUrl}". ` +
            `Use file:/path/to/db.sqlite, or set OS_DATABASE_DRIVER explicitly.`
        );
    }
    return filename;
}

/** Which database a standalone boot would talk to, and how. */
export interface ResolvedStandaloneDatabase {
    url: string;
    driver: ResolvedDriverKind;
    /**
     * The sqlite file this boot would open, or `null` for every non-sqlite
     * target and for `:memory:`. Callers that must inspect the file BEFORE a
     * boot — `os migrate`'s occupancy probe (#3917) — need the path without
     * the side effects of building the stack.
     */
    sqliteFile: string | null;
}

/**
 * Resolve the database target WITHOUT building anything.
 *
 * Same precedence `createStandaloneStack` applies (explicit config →
 * `OS_DATABASE_URL`/`DATABASE_URL` → `TURSO_DATABASE_URL` → `OS_HOME` →
 * project root → user home), factored out so a caller can answer "which file
 * am I about to open?" first. Pure: reads env, touches no filesystem.
 */
export function resolveStandaloneDatabase(config?: StandaloneStackConfig): ResolvedStandaloneDatabase {
    const cfg = StandaloneStackConfigSchema.parse(config ?? {});
    const url = resolveDatabaseUrl(cfg);
    const explicitDriver = cfg.databaseDriver
        ?? (process.env.OS_DATABASE_DRIVER?.trim() as ResolvedDriverKind | undefined);
    const driver: ResolvedDriverKind = explicitDriver || detectDriverFromUrl(url);
    const isSqlite = driver === 'sqlite' || driver === 'sqlite-wasm';
    const filename = isSqlite ? sqliteFilenameFromUrl(url, driver) : null;
    return {
        url,
        driver,
        sqliteFile: filename && filename !== ':memory:' && !filename.startsWith(':') ? filename : null,
    };
}

function resolveDatabaseUrl(cfg: z.output<typeof StandaloneStackConfigSchema>): string {
    return cfg.databaseUrl
        ?? readEnvWithDeprecation('OS_DATABASE_URL', 'DATABASE_URL', { silent: true })?.trim()
        ?? process.env.TURSO_DATABASE_URL?.trim()
        ?? (process.env.OS_HOME?.trim()
            ? `file:${resolvePath(resolveObjectStackHome(), 'data/standalone.db')}`
            : (cfg.projectRoot
                ? `file:${resolvePath(cfg.projectRoot, '.objectstack/data/standalone.db')}`
                : `file:${resolvePath(resolveObjectStackHome(), 'data/standalone.db')}`));
}

export async function createStandaloneStack(config?: StandaloneStackConfig): Promise<StandaloneStackResult> {
    const cfg = StandaloneStackConfigSchema.parse(config ?? {});

    const { ObjectQLPlugin } = await import('@objectstack/objectql');
    const { MetadataPlugin } = await import('@objectstack/metadata');
    const { DefaultDatasourcePlugin } = await import('./default-datasource-plugin.js');
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

    // `databaseAuthToken` / `OS_DATABASE_AUTH_TOKEN` are preserved in the
    // config schema for cloud builds that compose their own turso driver;
    // the standalone (open-core) runtime no longer consumes them directly.
    const { url: dbUrl, driver: dbDriver } = resolveStandaloneDatabase(cfg);

    // Translate the database URL into the `default` datasource DEFINITION
    // (ADR-0062 D1, #3826). The stack no longer builds a driver: the definition
    // is handed to `DefaultDatasourcePlugin`, which connects it at boot through
    // the SAME `DatasourceConnectionService` path (shared factory, shared
    // failure verdict incl. `OS_ALLOW_DRIVER_CONNECT_FAILURE`, retained status
    // for Setup → Datasources) as every declared/runtime datasource — every
    // kind including the CI-safe `sqlite-wasm` default, which the factory now
    // builds too. This stack still owns what's standalone-specific: URL→config
    // translation and filesystem prep (`mkdir`).
    //
    // #2229: `dev` arms the factory's native-better-sqlite3 → wasm → in-memory
    // step-down. Falls back to NODE_ENV when the caller did not pass it.
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
        // A missing @objectstack/driver-mongodb peer dep surfaces at boot via
        // the connection service's fail-fast (the factory's "not installed"
        // message rides inside it) — add the peer dependency to fix.
        driverId = 'mongodb';
        driverConfig = { url: dbUrl };
    } else if (dbDriver === 'sqlite-wasm') {
        driverId = 'sqlite-wasm';
        const filename = sqliteFilenameFromUrl(dbUrl, 'sqlite-wasm');
        if (filename !== ':memory:') {
            mkdirSync(resolvePath(filename, '..'), { recursive: true });
        }
        driverConfig = { filename };
    } else {
        // sqlite (better-sqlite3)
        driverId = 'sqlite';
        const filename = sqliteFilenameFromUrl(dbUrl, 'sqlite');
        mkdirSync(resolvePath(filename, '..'), { recursive: true });
        driverConfig = { filename };
    }
    const defaultDatasourcePlugin = new DefaultDatasourcePlugin(
        { driver: driverId, config: driverConfig },
        { dev: factoryDev },
    );

    const artifactBundle = await loadArtifactBundle(artifactPath, {
        tag: '[StandaloneStack]',
        unwrapEnvelope: true,
    });

    // Locale-gated pinyin search (#2486 / #3955): the compiled artifact carries
    // the stack's `i18n` config, and it is the ONLY config this boot ever sees —
    // `os migrate plan`/`apply` and embedders never load `objectstack.config.ts`.
    // Resolve the same locale-derived decision the CLI serve boot resolves and
    // stamp it into `OS_SEARCH_PINYIN_ENABLED` BEFORE any plugin constructs a
    // SchemaRegistry, so this boot provisions the same `__search` companion
    // columns as the dev runtime. Without the stamp, `os migrate` diffed a
    // dev-created database against a schema view missing every companion column
    // and flagged the live columns as destructive orphans (#3955). No artifact →
    // no locales → the env-first resolver decides, same as before.
    stampSearchPinyinEnabled(artifactBundle?.i18n);

    const plugins: any[] = [
        // This position buys NOTHING, and reading it as an ordering guarantee is
        // how #4085 happened. The kernel resolves both init and start order from
        // the plugin dependency graph, and `DefaultDatasourcePlugin` declares a
        // hard dependency on ObjectQL — which HOISTS ObjectQLPlugin ahead of it
        // (measured on a serve boot: `com.objectstack.engine.objectql` inits
        // 6 slots BEFORE `com.objectstack.runtime.default-datasource`), the exact
        // opposite of what this slot looks like it is asking for.
        //
        // What actually makes the driver exist before boot schema-sync is the
        // PHASE split, not this list: the datasource plugin connects in `init()`
        // (Phase 1 completes before ANY `start()` runs) and depends on ObjectQL
        // so ITS init registers the engine first. That contract, and the earlier
        // no-tables boot that taught it to us, are documented on the plugin
        // itself — see the "Ordering — phase, not list position" note in
        // `default-datasource-plugin.ts`. Order requirements belong THERE, next
        // to the code the kernel enforces them from; a comment on an array index
        // cannot enforce anything. (#4131 tracks making the AppPlugin end of this
        // contract enforced rather than conventional.)
        defaultDatasourcePlugin,
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
            // `projectRoot` has to reach the metadata repository too. It already
            // redirects the default sqlite database; without this line the
            // FileSystemRepository still rooted at `process.cwd()`, so one
            // "project root" meant two different directories and a boot pointed
            // at some other project wrote `.objectstack/metadata/` into whatever
            // directory the process happened to be standing in (#4065). Omitted
            // when unset so the plugin keeps its own cwd default.
            ...(cfg.projectRoot ? { rootDir: cfg.projectRoot } : {}),
        }),
        new ObjectQLPlugin({ environmentId }),
    ];
    if (artifactBundle) {
        plugins.push(new AppPlugin(artifactBundle, undefined, { skipSeedData: cfg.skipSeedData ?? false }));
    }

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
    const i18n: any | undefined =
        artifactBundle?.i18n && typeof artifactBundle.i18n === 'object' ? artifactBundle.i18n : undefined;

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
        ...(i18n ? { i18n } : {}),
    };
}
