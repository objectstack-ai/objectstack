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
 *   - `mysql[2]://`             → SqlDriver (mysql2)
 *   - `mongodb[+srv]://`        → MongoDBDriver (optional `@objectstack/driver-mongodb`)
 *   - `libsql://`, `http(s)://*.turso.*` → TursoDriver (optional `@objectstack/driver-turso`)
 *   - `file:` / `sqlite://` (alias, #6469) / no scheme → SqlDriver (better-sqlite3)
 *
 * Unknown URL schemes throw — we never silently fall back to sqlite, since
 * that historically created bogus directories on disk (e.g. `mongodb:/`)
 * when an unsupported URL was treated as a file path. The SAME refusal now
 * covers an unknown `OS_DATABASE_DRIVER` value (#6265): that env var used to be
 * a bare `as` cast, so a typo — or `mysql` before this stack could dispatch it
 * — fell through the driver chain's trailing `else` into SQLite without a word.
 *
 * NOTE: `libsql://` / Turso support comes from `@objectstack/driver-turso`,
 * which lives in THIS repository (`packages/drivers/driver-turso`) since #4645
 * but is an OPTIONAL install: it drags `@libsql/client` plus native bindings,
 * which a default install of a stack that never talks to libSQL should not pay
 * for. So this stack loads it lazily, through the driver-factory seam
 * `DefaultDatasourcePlugin` exposes for exactly this case
 * (`turso-driver-factory.ts`), and fails LOUDLY with the install command when
 * the package is absent — never a silent step-down to SQLite (#3276). This is
 * the same shape and the same ruling the CLI's `os serve`/`os start` path landed
 * under (#5602 / PR #5819); before #5820 the two disagreed, and one
 * `OS_DATABASE_URL=libsql://…` booted under `os start` while `os migrate` — which
 * comes through here — refused it as an unsupported scheme.
 *
 * NOTE: `mysql://` is the same family with none of the optional-package weight
 * (#6265). The CLI has classified it as `mysql` since forever
 * (`inferDriverTypeFromUrl`), the SHARED factory has always been able to build
 * it (`kind === 'mysql'` → SqlDriver on `mysql2`), and only this file was
 * missing the arm — so one `OS_DATABASE_URL=mysql://…` booted under `os start`
 * and died under `os migrate` with `Unsupported database URL scheme`, exactly
 * the #5820 split with a different scheme. Nothing lazy is needed here: the
 * definition goes straight to `DefaultDatasourcePlugin` and the shared factory
 * builds it like postgres.
 */

import { resolve as resolvePath } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { z } from 'zod';
import { stampSearchPinyinEnabled } from '@objectstack/types';
import {
    BUILTIN_DRIVER_IDS,
    DATABASE_DRIVER_SELECTION_ALIASES,
    driverHasLocalDefault,
    resolveDatabaseDriverId,
} from '@objectstack/spec/data';
import type { IDatasourceDriverFactory } from '@objectstack/service-datasource';
import { loadArtifactBundle, isHttpUrl } from './load-artifact-bundle.js';
import { loadTursoDriverFactory } from './turso-driver-factory.js';
import {
    resolveProjectDatabaseUrl,
    type ProjectDatabaseUrlSource,
} from './resolve-project-database.js';

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

/**
 * The driver kinds a standalone boot can dispatch — the ONE list, and the only
 * one (#6265), now shared with the CLI rather than merely singular here (#6345).
 *
 * Three consumers read it and every one of them used to carry its own answer:
 * the `databaseDriver` config key (a zod enum that rejected loudly), the
 * `OS_DATABASE_DRIVER` env var (a bare `as` cast that validated nothing, so an
 * unknown value fell through the dispatch chain's trailing `else` into SQLite),
 * and the `ResolvedDriverKind` union (a hand-written third copy). #6265 made
 * them one declaration.
 *
 * What #6265 could not fix from inside this file is that the CLI had a FOURTH
 * answer. This enum listed canonical spellings only, while
 * `packages/cli/src/utils/storage-driver.ts` accepted `pg`, `mysql2`, `mongo`,
 * `libsql`, `wasm`, `sql`, `mingo`, … — measured on `main`, **10 of 21 spellings
 * disagreed**, so `OS_DATABASE_DRIVER=pg` booted under `os start` and was
 * refused here. The enum's VALUES are therefore no longer written here either:
 * they are `BUILTIN_DRIVER_IDS` from `@objectstack/spec`, the one driver
 * vocabulary both hosts read, and the accepted spellings are that table's
 * aliases via {@link resolveExplicitDriver}. A driver added to the spec table
 * appears on both hosts at once, which is the only shape in which this fork
 * cannot re-open.
 */
export const StandaloneDatabaseDriverSchema = z.enum(BUILTIN_DRIVER_IDS);

/**
 * The `databaseDriver` CONFIG key's schema — an alias-accepting front door onto
 * {@link StandaloneDatabaseDriverSchema} (#6345).
 *
 * `databaseDriver` and `OS_DATABASE_DRIVER` are two spellings of one decision,
 * so accepting `pg` from the environment and refusing it from a programmatic
 * config would just relocate the fork this card closes to inside a single host.
 * Both doors now resolve through the spec table's selection face and both
 * produce a CANONICAL id, so everything downstream still branches on one value
 * per driver.
 */
const DatabaseDriverSelectionSchema = z.string().transform((raw, ctx) => {
    const id = resolveDatabaseDriverId(raw);
    if (!id) {
        ctx.addIssue({ code: 'custom', message: unsupportedDriverMessage(raw, 'databaseDriver') });
        return z.NEVER;
    }
    return id;
});

/**
 * The refusal for a driver selection no builtin claims — one sentence, both
 * doors, enumerating the spellings that actually work rather than a list
 * maintained beside them.
 */
function unsupportedDriverMessage(raw: string, source: 'OS_DATABASE_DRIVER' | 'databaseDriver'): string {
    return (
        `[StandaloneStack] Unsupported ${source} value: "${raw}". ` +
        `Supported drivers: ${DATABASE_DRIVER_SELECTION_ALIASES.join(', ')}. ` +
        `Booting on the SQLite default instead would silently ignore the driver you asked for ` +
        `and write into a local database (#3276). Fix the value, or unset it ` +
        `to let the OS_DATABASE_URL scheme select the driver.`
    );
}

export const StandaloneStackConfigSchema = z.object({
    databaseUrl: z.string().optional(),
    /**
     * libSQL/Turso JWT, read ONLY by the `turso` kind — every other kind carries
     * its credentials inside the URL. Falls back to `OS_DATABASE_AUTH_TOKEN`,
     * then to the vendor's own `TURSO_AUTH_TOKEN` (the same pair `os serve`
     * reads, and the same pair `--database-auth-token` forwards into).
     */
    databaseAuthToken: z.string().optional(),
    databaseDriver: DatabaseDriverSelectionSchema.optional(),
    environmentId: z.string().optional(),
    artifactPath: z.string().optional(),
    /**
     * Project root directory. When set (typically by the CLI after locating
     * `objectstack.config.ts`), the default sqlite database is placed under
     * `<projectRoot>/.objectstack/data/objectstack.db` — the UNIFIED default
     * every command resolves since #6469 (legacy `dev.db` / `standalone.db`
     * are still compat-read, see `resolve-project-database.ts`) — instead of
     * the global `~/.objectstack/data/objectstack.db`, and the metadata
     * FileSystemRepository roots at `<projectRoot>/.objectstack/metadata`.
     * This keeps per-project data scoped to the project folder so different
     * examples / apps don't share a single database by accident.
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
    /**
     * What this boot does when the default sqlite database file does not
     * exist yet (#6743). `'empty-in-memory'` opens an ephemeral database
     * instead of creating the file, and suppresses the host's `mkdir` of the
     * state directory with it — so a read-only boot on a never-started
     * project leaves the filesystem exactly as it found it. Defaults to
     * `'create'`.
     *
     * ⚠️ READ-ONLY BOOTS ONLY. This is NOT implied by `skipSeedData` /
     * `deferSchemaDdl`, and deliberately so: `os migrate apply` boots deferred
     * too and then FLUSHES the deferred DDL once the operator confirms, so it
     * needs a real file. `os migrate plan` never writes and is the caller this
     * exists for.
     */
    sqliteAbsentFile: z.enum(['create', 'empty-in-memory']).optional(),
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

type ResolvedDriverKind = z.infer<typeof StandaloneDatabaseDriverSchema>;

function detectDriverFromUrl(dbUrl: string): ResolvedDriverKind {
    if (/^memory:\/\//i.test(dbUrl)) return 'memory';
    if (/^(postgres(ql)?|pg):\/\//i.test(dbUrl)) return 'postgres';
    // MySQL / MariaDB (#6265). Character-for-character the regex the CLI uses
    // (`utils/storage-driver.ts` `inferDriverTypeFromUrl`), for the same reason
    // the turso arm below copies its spellings: the two functions answer the
    // same question about the same `OS_DATABASE_URL`, so any divergence IS the
    // bug — `os start` booting a URL `os migrate` refuses. Unlike turso this
    // needs no optional package: the shared factory's `mysql` arm builds a
    // SqlDriver on `mysql2`, which `@objectstack/driver-sql` already ships.
    if (/^mysql2?:\/\//i.test(dbUrl)) return 'mysql';
    if (/^mongodb(\+srv)?:\/\//i.test(dbUrl)) return 'mongodb';
    // libSQL / Turso (#5820). The same two spellings the CLI classifies as
    // `turso` (`utils/storage-driver.ts` `inferDriverTypeFromUrl`, #5602) — kept
    // identical on purpose: this function and that one answer the same question
    // for the same `OS_DATABASE_URL`, and until #5820 they disagreed, so
    // `os start` booted a libSQL URL that `os migrate` refused. The driver is
    // built from the OPTIONAL `@objectstack/driver-turso` package; when it is
    // missing the boot fails loudly with the install command instead of
    // stepping down to SQLite (#3276).
    if (/^libsql:\/\//i.test(dbUrl)) return 'turso';
    if (/^https?:\/\//i.test(dbUrl) && /\.turso\./i.test(dbUrl)) return 'turso';
    if (/^wasm-sqlite:\/\//i.test(dbUrl)) return 'sqlite-wasm';
    if (/\.wasm\.db$/i.test(dbUrl)) return 'sqlite-wasm';
    if (/^file:/i.test(dbUrl)) return 'sqlite';
    // Bare path without a scheme — treat as a sqlite file path.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(dbUrl)) return 'sqlite';
    throw new Error(
        `[StandaloneStack] Unsupported database URL scheme: ${dbUrl}. ` +
        `Supported schemes: memory://, postgres://, pg://, mysql://, mysql2://, ` +
        `mongodb://, mongodb+srv://, ` +
        `libsql:// (optional @objectstack/driver-turso), file: ` +
        `(sqlite:// is accepted as an alias of file:)`
    );
}

/**
 * The explicit driver selection for this boot, or `undefined` when none was made.
 *
 * Two sources, ONE vocabulary (#6265). `cfg.databaseDriver` has always been
 * parsed by {@link StandaloneDatabaseDriverSchema}; `OS_DATABASE_DRIVER` was
 * `process.env.OS_DATABASE_DRIVER?.trim() as ResolvedDriverKind` — an assertion,
 * which checks nothing at runtime. An unknown value therefore reached the
 * dispatch chain in `createStandaloneStack`, matched no arm, and landed in the
 * trailing `else`: SQLite, silently. `OS_DATABASE_DRIVER=mysql` (a value the
 * CLI advertises and `content/docs/deployment/environment-variables.mdx` lists)
 * with no URL set therefore created a local `standalone.db` while the operator
 * believed they were talking to MySQL — the #3276 class exactly, and with a URL
 * set it surfaced as the doubly-misleading "sqlite driver was selected but the
 * URL does not look like a file path" for an operator who never selected sqlite.
 *
 * So the env value is parsed by the same schema and an unrecognised one is
 * refused LOUDLY, naming the legal values. The value is lower-cased first, for
 * the same reason the regexes above are copied verbatim from the CLI: the CLI's
 * reader of this very variable does `(explicitDriver ?? '').toLowerCase().trim()`,
 * and a case-sensitive reader here would re-open the divergence this issue is
 * about, one notch narrower. The accepted VOCABULARY is unchanged either way —
 * it is the enum, and nothing else.
 */
function resolveExplicitDriver(
    cfg: z.output<typeof StandaloneStackConfigSchema>,
): ResolvedDriverKind | undefined {
    if (cfg.databaseDriver) return cfg.databaseDriver;
    const raw = process.env.OS_DATABASE_DRIVER?.trim();
    if (!raw) return undefined;
    // #6345: the ACCEPTED SPELLINGS are the spec table's selection aliases, not
    // this file's canonical list. Lower-casing stays for the reason #6265 gave —
    // the CLI's reader of this same variable lower-cases — and is now redundant
    // with `resolveDatabaseDriverId`'s own normalization rather than the only
    // normalization there is.
    const id = resolveDatabaseDriverId(raw);
    if (id) return id;
    throw new Error(unsupportedDriverMessage(raw, 'OS_DATABASE_DRIVER'));
}

/**
 * Refuse a driver whose database lives somewhere this process cannot guess when
 * nothing named where that is (#6345 fork 2).
 *
 * The URL ladder always produces SOMETHING — its last rung is the unified
 * default file — so before this check a `postgres`/`mysql`/`mongodb`/`turso`
 * selection with no URL anywhere was handed `file:<state dir>/data/objectstack.db`
 * and failed inside the driver, two layers from the cause, with a message about
 * a file for an operator who asked for a server. (The CLI's mirror of this bug
 * guessed differently — `url: undefined` into `pg`, an invented
 * `mongodb://localhost:27017/objectstack` — which is why the ruling makes both
 * sides refuse instead of making the two guesses agree.)
 *
 * Only the FALLBACK rungs are refused. A URL that came from `--database`,
 * `OS_DATABASE_URL`/`DATABASE_URL`/`TURSO_DATABASE_URL`, or the project's own
 * declared default datasource is a statement about where the database is, and a
 * `file:` DSN handed to postgres by an operator who typed it is their business,
 * not a guess of ours.
 */
function assertUrlNamedForRemoteDriver(
    driver: ResolvedDriverKind,
    source: ProjectDatabaseUrlSource,
): void {
    if (driverHasLocalDefault(driver)) return;
    if (source !== 'unified-default' && source !== 'legacy-file') return;
    throw new Error(
        `[StandaloneStack] The \`${driver}\` driver was selected but no database URL was given, ` +
        `and ${driver} has no local default to fall back on — its database lives on a server or ` +
        `endpoint this process cannot guess. Set OS_DATABASE_URL (or --database) to it. ` +
        `Falling back to the local SQLite file instead would connect you to a database you never ` +
        `named, and every write would land in the wrong place (#3276).`
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
    /** Which priority tier resolved the URL (#6469 — shared resolution). */
    source: ProjectDatabaseUrlSource;
    /** Declared datasource name, when `source` is `config-datasource`. */
    datasourceName?: string;
    /**
     * One loud line about a legacy-file compat-read (#6469) — surfaced by
     * `createStandaloneStack` at boot; a caller resolving without booting
     * (the occupancy probe) deliberately does not print it, so one command
     * run prints it once.
     */
    notice?: string;
}

/**
 * The artifact path this boot would read — `cfg.artifactPath` →
 * `OS_ARTIFACT_PATH` → `<cwd>/dist/objectstack.json`, relative paths anchored
 * on the cwd. ONE computation for `createStandaloneStack` (which loads the
 * bundle from it) and `resolveStandaloneDatabase` (which consults it for the
 * config-declared datasource tier, #6469) — two copies here would let the URL
 * resolver read a different config than the boot loads.
 */
function resolveArtifactPathInput(cfg: z.output<typeof StandaloneStackConfigSchema>): string {
    const cwd = process.cwd();
    const input = cfg.artifactPath
        ?? process.env.OS_ARTIFACT_PATH
        ?? resolvePath(cwd, 'dist/objectstack.json');
    return isHttpUrl(input)
        ? input
        : (input.startsWith('/') ? input : resolvePath(cwd, input));
}

/**
 * Resolve the database target WITHOUT building anything.
 *
 * Since #6469 the URL comes from the ONE shared resolution
 * ({@link resolveProjectDatabaseUrl}) that `os dev` / `os start` also use:
 * explicit config → `OS_DATABASE_URL`/`DATABASE_URL` → `TURSO_DATABASE_URL` →
 * explicit `memory` driver → the config-declared default datasource (read from
 * the compiled artifact) → the unified default file
 * (`<state dir>/data/objectstack.db`, with a compat-read of the legacy
 * `dev.db`/`standalone.db`). State-dir precedence is unchanged: `OS_HOME` →
 * project root → user home. No longer purely env-derived: the legacy probe and
 * the artifact consult read the filesystem (they create nothing).
 *
 * The `TURSO_DATABASE_URL` source only started meaning something in #5820: the
 * URL was read here and then rejected by `detectDriverFromUrl` as an unsupported
 * scheme, so a host that set it got a hard failure rather than a libSQL
 * connection. Reading a source you cannot dispatch is worse than not reading it.
 *
 * Throws on a selection this stack cannot dispatch — an unknown URL scheme
 * (`detectDriverFromUrl`) or, since #6265, an unknown `OS_DATABASE_DRIVER` value
 * ({@link resolveExplicitDriver}). Both refusals happen HERE rather than at boot
 * so `os migrate`'s pre-boot probe reads the same verdict the boot would.
 */
export function resolveStandaloneDatabase(config?: StandaloneStackConfig): ResolvedStandaloneDatabase {
    const cfg = StandaloneStackConfigSchema.parse(config ?? {});
    const resolution = resolveProjectDatabaseUrl({
        explicitUrl: cfg.databaseUrl,
        explicitDriver: cfg.databaseDriver,
        projectRoot: cfg.projectRoot,
        artifactPath: resolveArtifactPathInput(cfg),
    });
    const url = resolution.url;
    const explicitDriver = resolveExplicitDriver(cfg);
    const driver: ResolvedDriverKind = explicitDriver || detectDriverFromUrl(url);
    // Fork 2 (#6345) — refuse before deriving a sqlite filename from a URL the
    // selected driver was never going to open.
    assertUrlNamedForRemoteDriver(driver, resolution.source);
    const isSqlite = driver === 'sqlite' || driver === 'sqlite-wasm';
    const filename = isSqlite ? sqliteFilenameFromUrl(url, driver) : null;
    return {
        url,
        driver,
        sqliteFile: filename && filename !== ':memory:' && !filename.startsWith(':') ? filename : null,
        source: resolution.source,
        ...(resolution.datasourceName ? { datasourceName: resolution.datasourceName } : {}),
        ...(resolution.notice ? { notice: resolution.notice } : {}),
    };
}

/**
 * The libSQL/Turso auth token for this boot, or `undefined` when none was given.
 *
 * Read ONLY by the `turso` kind: every other kind carries its credentials inside
 * the URL. Precedence mirrors `os serve` exactly (`commands/serve.ts`) so the
 * same environment produces the same credential on both paths — explicit config,
 * then `OS_DATABASE_AUTH_TOKEN` (which is where `--database-auth-token` lands),
 * then the vendor's own `TURSO_AUTH_TOKEN` (a documented third-party exception
 * to the `OS_` prefix rule, AGENTS.md Prime Directive #9).
 *
 * Empty/blank values are treated as absent — `authToken: ''` is not a credential,
 * and passing one to the driver would fail differently than not passing it.
 *
 * Exported (module-level, not from the package barrel) so this precedence has a
 * pin of its own: the boot itself cannot expose it, because a libSQL boot in a
 * workspace without the optional driver package fails before any definition is
 * observable.
 */
export function resolveDatabaseAuthToken(cfg: StandaloneStackConfig = {}): string | undefined {
    const token = cfg.databaseAuthToken?.trim()
        || process.env.OS_DATABASE_AUTH_TOKEN?.trim()
        || process.env.TURSO_AUTH_TOKEN?.trim();
    return token ? token : undefined;
}

export async function createStandaloneStack(config?: StandaloneStackConfig): Promise<StandaloneStackResult> {
    const cfg = StandaloneStackConfigSchema.parse(config ?? {});

    const { ObjectQLPlugin } = await import('@objectstack/objectql');
    const { MetadataPlugin } = await import('@objectstack/metadata');
    const { DefaultDatasourcePlugin } = await import('./default-datasource-plugin.js');
    const { AppPlugin } = await import('./app-plugin.js');

    const environmentId = cfg.environmentId ?? process.env.OS_ENVIRONMENT_ID ?? 'proj_local';
    const artifactPath = resolveArtifactPathInput(cfg);

    // `databaseAuthToken` / `OS_DATABASE_AUTH_TOKEN` / `TURSO_AUTH_TOKEN` are
    // consumed by the `turso` kind below (#5820). They used to be declared here
    // and read by nobody — the same "reads it in, cannot dispatch it out" split
    // `TURSO_DATABASE_URL` had.
    const { url: dbUrl, driver: dbDriver, notice: dbNotice } = resolveStandaloneDatabase(cfg);
    if (dbNotice) {
        // Legacy-file compat-read (#6469): loud, once per boot, on stderr so a
        // `--json` command's reserved stdout stays a single parseable document.
        // eslint-disable-next-line no-console
        console.warn(`[StandaloneStack] ⚠ ${dbNotice}`);
    }

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
    /**
     * Host-injected driver factory — set ONLY for `turso`, whose driver the
     * shared open-core factory cannot build (the package is an optional
     * install). `DefaultDatasourcePlugin` documents this seam for exactly that
     * case; everything else about the connect stays shared.
     */
    let hostFactory: IDatasourceDriverFactory | undefined;
    if (dbDriver === 'memory') {
        driverId = 'memory';
        driverConfig = {};
    } else if (dbDriver === 'postgres') {
        // Factory applies the pg pool default ({ min: 0, max: 5 }) internally.
        driverId = 'postgres';
        driverConfig = { url: dbUrl };
    } else if (dbDriver === 'mysql') {
        // MySQL / MariaDB (#6265). Nothing special: the shared factory's `mysql`
        // arm builds a SqlDriver on the `mysql2` client from exactly this
        // config (`MysqlConfigSchema.url` — "passed to mysql2 as-is"), and the
        // CLI's own `mysql` branch produces the same `{ driverId: 'mysql',
        // config: { url } }`. The only thing that was missing was this arm, and
        // the detection arm above it.
        driverId = 'mysql';
        driverConfig = { url: dbUrl };
    } else if (dbDriver === 'mongodb') {
        // A missing @objectstack/driver-mongodb peer dep surfaces at boot via
        // the connection service's fail-fast (the factory's "not installed"
        // message rides inside it) — add the peer dependency to fix.
        driverId = 'mongodb';
        driverConfig = { url: dbUrl };
    } else if (dbDriver === 'turso') {
        // libSQL / Turso (#5820). Unlike every other kind, the driver comes from
        // an OPTIONAL package, so the stack loads it here and hands the result
        // to the plugin as its host factory. The load runs BEFORE the plugin is
        // constructed, so a missing package produces one clear message with the
        // install command instead of a connect error later in boot — and never
        // a step-down to SQLite, which would open an empty local database while
        // the operator's libSQL data stays untouched (#3276).
        //
        // No `autoMigrate` passthrough: `TursoDriverConfig` declares no such
        // key, and handing the driver a config it silently ignores is the kind
        // of "declared ≠ enforced" the CLI side deliberately avoided too.
        driverId = 'turso';
        const authToken = resolveDatabaseAuthToken(cfg);
        driverConfig = { url: dbUrl, ...(authToken ? { authToken } : {}) };
        hostFactory = await loadTursoDriverFactory();
    } else if (dbDriver === 'sqlite-wasm') {
        driverId = 'sqlite-wasm';
        const filename = sqliteFilenameFromUrl(dbUrl, 'sqlite-wasm');
        if (filename !== ':memory:') {
            mkdirSync(resolvePath(filename, '..'), { recursive: true });
        }
        driverConfig = { filename };
    } else if (dbDriver === 'sqlite') {
        // sqlite (better-sqlite3)
        driverId = 'sqlite';
        const filename = sqliteFilenameFromUrl(dbUrl, 'sqlite');
        // The host's filesystem prep. Skipped for a read-only boot whose target
        // does not exist (#6743): creating `<state dir>/data/` is the other half
        // of the write side effect `os migrate plan` was leaving behind, and a
        // `mkdir -p` here would recreate the very directory the driver is about
        // to decline to put a file in. When the file DOES exist the directory
        // does too, so this costs the mode nothing.
        if (!(cfg.sqliteAbsentFile === 'empty-in-memory' && !existsSync(filename))) {
            mkdirSync(resolvePath(filename, '..'), { recursive: true });
        }
        driverConfig = { filename };
    } else {
        // Unreachable by construction — and making it unreachable is half the
        // fix (#6265). This used to be a bare `else` meaning "sqlite", so every
        // kind without an arm above became SQLite in silence: an unvalidated
        // `OS_DATABASE_DRIVER` value landed here, and so would the NEXT kind
        // added to the enum without a dispatch arm. `dbDriver` is now narrowed
        // to `never` here, so that omission is a compile error instead of a
        // wrong database.
        const unreachable: never = dbDriver;
        throw new Error(
            `[StandaloneStack] No dispatch arm for database driver kind: ${String(unreachable)}. ` +
            `Every kind in StandaloneDatabaseDriverSchema needs one — falling through to SQLite ` +
            `is the #3276 defect.`
        );
    }
    const defaultDatasourcePlugin = new DefaultDatasourcePlugin(
        { driver: driverId, config: driverConfig },
        {
            dev: factoryDev,
            ...(cfg.sqliteAbsentFile ? { sqliteAbsentFile: cfg.sqliteAbsentFile } : {}),
            ...(hostFactory ? { factory: hostFactory } : {}),
        },
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
        // cannot enforce anything. (The AppPlugin end of this contract is now
        // declared too — `optionalDependencies` + `requiresServices`, enforced
        // by the kernel per ADR-0116 / #4131.)
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
