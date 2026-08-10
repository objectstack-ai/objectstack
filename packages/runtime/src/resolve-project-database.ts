// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE default-database resolution for a project directory (#6469).
 *
 * Before this module, three commands resolved three different default
 * databases in the same directory — `os dev` → `.objectstack/data/dev.db`,
 * `os start` → `.objectstack/data/objectstack.db`, `os migrate *` →
 * `.objectstack/data/standalone.db` — and none of them consulted the project
 * config. The measured consequence (issue #6469, hotcrm 17.0.0-rc.5): after
 * `os start` + seed, `os migrate plan` opened a fresh empty `standalone.db` it
 * had just created and reported 22 tables of drift against a healthy database.
 * The failure direction is inverted — the truth was "zero drift" and the
 * output said "everything is missing" — which sends an operator rolling back a
 * database that is fine.
 *
 * Maintainer ruling (#6469, 2026-08-08):
 *
 *   1. One shared resolution function, used by `os dev`, `os start` and
 *      `os migrate` (via `resolveStandaloneDatabase`). This module is it —
 *      commands map their flags onto {@link ResolveProjectDatabaseUrlOptions}
 *      and MUST NOT carry their own fallback filename.
 *   2. Priority: explicit URL (flag / config) → environment
 *      (`OS_DATABASE_URL` / legacy `DATABASE_URL` / vendor
 *      `TURSO_DATABASE_URL`) → explicit `memory` driver selection → the
 *      datasource the project config declares as its default home
 *      ({@link readConfigDeclaredDefault}) → the unified default file.
 *   3. Unified default filename: `objectstack.db` — what `os start` (the
 *      serving process) already used; the serving database is the ground
 *      truth the other two commands must align to.
 *   4. Legacy compat-read, NO interactive prompt (CI-safe): when the unified
 *      default does not exist but a legacy `dev.db` / `standalone.db` does,
 *      resolve to the legacy file and return one loud {@link notice} line
 *      naming the file and how to migrate. An existing dev environment must
 *      never look like data loss. Probe order is `objectstack.db` → `dev.db`
 *      → `standalone.db`, IDENTICAL for every command — `dev.db` first among
 *      the legacies because it holds real dev data, while `standalone.db` is
 *      most likely an empty artifact of the very fork this fixes.
 *   5. `sqlite://` is accepted as an alias of `file:`
 *      ({@link normalizeDatabaseUrl}); genuinely unsupported schemes keep
 *      their precise refusal in `standalone-stack.ts`.
 */

import { resolve as resolvePath, isAbsolute } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolveDatabaseDriverId, resolveDriverId } from '@objectstack/spec/data';

/** The unified default database filename (`<state dir>/data/objectstack.db`). */
export const UNIFIED_DEFAULT_DB_FILENAME = 'objectstack.db';

/**
 * Legacy default filenames still read for compatibility, in probe order.
 * `dev.db` deliberately precedes `standalone.db`: the former holds real dev
 * data (`os dev` persisted into it), while the latter is most likely an empty
 * file `os migrate` itself created through the pre-#6469 fork.
 */
export const LEGACY_DEFAULT_DB_FILENAMES = ['dev.db', 'standalone.db'] as const;

/**
 * Normalize a database URL: `sqlite:` / `sqlite://` are aliases of `file:`
 * (#6469 ruling item 3 — `sqlite://` is the most natural guess for "point me
 * at a SQLite file", and refusing it taught nothing the alias cannot).
 * Everything else passes through trimmed; scheme support is still decided by
 * the driver dispatch, so a genuinely unsupported scheme keeps its precise
 * refusal.
 */
export function normalizeDatabaseUrl(url: string): string {
    const trimmed = url.trim();
    const sqliteAlias = /^sqlite:(\/\/)?/i.exec(trimmed);
    if (sqliteAlias) return `file:${trimmed.slice(sqliteAlias[0].length)}`;
    return trimmed;
}

/** Where a resolved database URL came from — one tier per priority rung. */
export type ProjectDatabaseUrlSource =
    /** `--database` / `--database-url` flag, or programmatic `databaseUrl`. */
    | 'explicit'
    /** `OS_DATABASE_URL` / `DATABASE_URL` / `TURSO_DATABASE_URL`. */
    | 'env'
    /** `--database-driver memory` / `OS_DATABASE_DRIVER=memory` — no file default is imposed. */
    | 'memory-driver'
    /** The datasource the project config declares as its default home. */
    | 'config-datasource'
    /** A legacy `dev.db` / `standalone.db` read for compatibility (see {@link notice}). */
    | 'legacy-file'
    /** The unified default `<state dir>/data/objectstack.db`. */
    | 'unified-default';

export interface ResolvedProjectDatabaseUrl {
    /** The resolved database URL, `sqlite://` already normalized to `file:`. */
    url: string;
    source: ProjectDatabaseUrlSource;
    /** The declared datasource's `name`, when {@link source} is `config-datasource`. */
    datasourceName?: string;
    /**
     * One loud, actionable line the caller must surface (set only for
     * `legacy-file`). Print it once per command run — never swallow it: the
     * whole point of the compat-read is that the operator learns which file
     * is being read and how to converge on the unified name.
     */
    notice?: string;
}

export interface ResolveProjectDatabaseUrlOptions {
    /** Explicit database URL (CLI flag / programmatic config). Wins over everything. */
    explicitUrl?: string;
    /**
     * Explicit driver selection (`--database-driver` / config). Only `memory`
     * changes URL resolution (no file default is imposed for an explicitly
     * in-memory boot); other values select engines, not URLs, and their
     * vocabulary is #6345's seam — deliberately not judged here.
     */
    explicitDriver?: string;
    /** Environment to read (`process.env` by default; tests inject their own). */
    env?: Record<string, string | undefined>;
    /**
     * The project root — the directory holding `objectstack.config.ts` (or
     * the cwd of a project-scoped one-shot command). Anchors the default
     * `.objectstack/` state dir and relative sqlite filenames from the config.
     */
    projectRoot?: string;
    /**
     * Pre-resolved state directory (e.g. `os start --home`). When set it wins
     * over `OS_HOME` / `projectRoot` — the caller already folded those in.
     */
    homeDir?: string;
    /**
     * Compiled artifact (`dist/objectstack.json`) to consult for the
     * config-declared datasource tier. Local paths only — an `http(s)://`
     * artifact is skipped (resolution is synchronous and remote configs do
     * not describe the local filesystem anyway).
     */
    artifactPath?: string;
}

/**
 * Resolve the state directory the default database lives under.
 * Order: caller-resolved `homeDir` → `OS_HOME` → `<projectRoot>/.objectstack`
 * → `~/.objectstack` — the same order `os start` applies to its home dir, and
 * the order the standalone stack applied before unification.
 */
function resolveDatabaseStateDir(opts: {
    homeDir?: string;
    projectRoot?: string;
    env: Record<string, string | undefined>;
}): string {
    if (opts.homeDir && opts.homeDir.trim().length > 0) return resolvePath(opts.homeDir.trim());
    const rawOsHome = opts.env.OS_HOME?.trim();
    if (rawOsHome && rawOsHome.length > 0) {
        if (rawOsHome.startsWith('~')) return resolvePath(homedir(), rawOsHome.slice(1).replace(/^[/\\]/, ''));
        return resolvePath(rawOsHome);
    }
    if (opts.projectRoot) return resolvePath(opts.projectRoot, '.objectstack');
    return resolvePath(homedir(), '.objectstack');
}

/**
 * The datasource the project config declares as the default home of its
 * objects, as a database URL — or `undefined` when the config declares none.
 *
 * What "declares" means today: the compiled artifact's `datasourceMapping`
 * carries a `{ default: true, datasource: <name> }` rule (the one existing
 * config surface that routes the project's objects somewhere by default —
 * since #4462 that routing is real, not a fall-through), and `datasources[]`
 * declares `<name>` with a connection this function can express as a URL:
 *
 *   - sqlite family → `config.filename` (relative paths anchored on
 *     `projectRoot`, exactly where the driver resolves them from a project
 *     boot), expressed as `file:`/`wasm-sqlite://`;
 *   - url-carrying drivers (postgres / mysql / mongo / turso) →
 *     `config.url` when present. Discrete `host`/`port`/`database` fields are
 *     NOT reassembled into a DSN here — inventing a URL (with credentials)
 *     that the author never wrote is worse than falling through;
 *   - memory → `memory://`.
 *
 * A rule naming the host-reserved `default`, a missing declaration, or an
 * underivable connection all yield `undefined` — resolution then falls
 * through to the unified default, which is what those projects got before
 * this tier existed. (Driver-id spellings resolve through the spec's ONE
 * alias table, `resolveDriverId` — including `turso`/`libsql`, which became
 * rows in it in #6345 and no longer need a local special-case here.)
 */
function readConfigDeclaredDefault(opts: {
    artifactPath?: string;
    projectRoot?: string;
}): { url: string; datasourceName: string } | undefined {
    const artifactPath = opts.artifactPath;
    if (!artifactPath || /^https?:\/\//i.test(artifactPath) || !existsSync(artifactPath)) return undefined;

    let bundle: any;
    try {
        const parsed = JSON.parse(readFileSync(artifactPath, 'utf8'));
        // Same envelope unwrap as `loadArtifactBundle` (`{ schemaVersion, metadata }`).
        bundle = parsed?.schemaVersion != null && parsed?.metadata !== undefined ? parsed.metadata : parsed;
    } catch {
        // Unreadable/malformed artifact — the boot's own loader reports that
        // loudly; the URL resolver just cannot consult it.
        return undefined;
    }

    const mapping: unknown[] = Array.isArray(bundle?.datasourceMapping) ? bundle.datasourceMapping : [];
    const rule = mapping.find(
        (r: any) => r && typeof r === 'object' && r.default === true && typeof r.datasource === 'string',
    ) as { datasource: string } | undefined;
    if (!rule || rule.datasource === 'default') return undefined;

    const dsDefs = bundle?.datasources;
    const declared: any[] = Array.isArray(dsDefs)
        ? dsDefs
        : dsDefs && typeof dsDefs === 'object'
            ? Object.entries(dsDefs).map(([name, def]) => ({ name, ...(def as object) }))
            : [];
    const ds = declared.find((d: any) => d && typeof d === 'object' && d.name === rule.datasource);
    if (!ds) return undefined;

    const url = datasourceUrlOf(ds, opts.projectRoot);
    return url ? { url, datasourceName: rule.datasource } : undefined;
}

/** Express a declared datasource's connection as a database URL, or `undefined`. */
function datasourceUrlOf(ds: { driver?: unknown; config?: unknown }, projectRoot?: string): string | undefined {
    const config = (ds.config ?? {}) as { filename?: unknown; url?: unknown };
    // Since #6345 `turso`/`libsql` are rows in the shared table like every other
    // builtin, so the local special-case they needed while turso had no config
    // contract is gone — one lookup answers for all of them.
    const canonical = resolveDriverId(ds.driver);
    switch (canonical) {
        case 'sqlite':
        case 'sqlite-wasm': {
            const filename = typeof config.filename === 'string' ? config.filename.trim() : '';
            if (!filename) return undefined;
            if (filename === ':memory:') return ':memory:';
            const abs = isAbsolute(filename)
                ? filename
                : resolvePath(projectRoot ?? process.cwd(), filename);
            return canonical === 'sqlite-wasm' ? `wasm-sqlite://${abs}` : `file:${abs}`;
        }
        case 'memory':
            return 'memory://';
        case 'postgres':
        case 'mysql':
        case 'mongodb':
        case 'turso':
            return typeof config.url === 'string' && config.url.trim() ? config.url.trim() : undefined;
        default:
            // A plugin-contributed driver — no URL contract to read.
            return typeof config.url === 'string' && config.url.trim() ? config.url.trim() : undefined;
    }
}

/**
 * Resolve the database URL for a project directory — the shared function all
 * of `os dev` / `os start` / `os migrate` (and every `createStandaloneStack`
 * embedder) resolve through. See the module doc for the priority ladder.
 *
 * Reads the filesystem (legacy-file probe + artifact consult) but never
 * creates anything and never prints — the caller surfaces {@link notice}.
 */
export function resolveProjectDatabaseUrl(
    opts: ResolveProjectDatabaseUrlOptions = {},
): ResolvedProjectDatabaseUrl {
    const env = opts.env ?? process.env;

    const explicit = opts.explicitUrl?.trim();
    if (explicit) return { url: normalizeDatabaseUrl(explicit), source: 'explicit' };

    const envUrl = (env.OS_DATABASE_URL ?? env.DATABASE_URL)?.trim();
    if (envUrl) return { url: normalizeDatabaseUrl(envUrl), source: 'env' };
    const tursoUrl = env.TURSO_DATABASE_URL?.trim();
    if (tursoUrl) return { url: tursoUrl, source: 'env' };

    // An explicitly in-memory boot gets no file default imposed on it. Only
    // `memory` is judged here; unknown driver values are refused downstream
    // (`resolveExplicitDriver`) with the full legal-values list.
    // Resolved through the shared table (#6345): `OS_DATABASE_DRIVER=mingo` is an
    // accepted spelling of `memory` on both hosts, so it must reach this rung
    // too — a raw string compare would have imposed the unified default FILE on
    // a boot that explicitly asked for the in-memory engine.
    const driver = resolveDatabaseDriverId(opts.explicitDriver ?? env.OS_DATABASE_DRIVER);
    if (driver === 'memory') return { url: 'memory://', source: 'memory-driver' };

    const fromConfig = readConfigDeclaredDefault(opts);
    if (fromConfig) {
        return { url: fromConfig.url, source: 'config-datasource', datasourceName: fromConfig.datasourceName };
    }

    const dataDir = resolvePath(resolveDatabaseStateDir({ ...opts, env }), 'data');
    const unifiedPath = resolvePath(dataDir, UNIFIED_DEFAULT_DB_FILENAME);
    if (!existsSync(unifiedPath)) {
        for (const legacyName of LEGACY_DEFAULT_DB_FILENAMES) {
            const legacyPath = resolvePath(dataDir, legacyName);
            if (existsSync(legacyPath)) {
                return {
                    url: `file:${legacyPath}`,
                    source: 'legacy-file',
                    notice:
                        `Reading legacy database file ${legacyPath} — the unified default is now ${unifiedPath} (#6469); ` +
                        `migrate with: mv "${legacyPath}" "${unifiedPath}" (move any -wal/-shm siblings too), ` +
                        `or pin it explicitly via OS_DATABASE_URL=file:${legacyPath}`,
                };
            }
        }
    }
    return { url: `file:${unifiedPath}`, source: 'unified-default' };
}
