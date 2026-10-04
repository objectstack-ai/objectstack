// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { StandaloneStackConfig } from '@objectstack/runtime';

/**
 * ADR-0057 §3.6 (#2834 ②) — where the dedicated telemetry datasource lives.
 *
 * When a datasource named `telemetry` is registered, the engine routes every
 * `telemetry`/`event`/`audit`-classed object to it, so platform-generated
 * growth can never again bloat the business DB. This helper decides whether
 * (and where) the CLI should provision that second SQLite file:
 *
 *   - `OS_TELEMETRY_DB=0|false|off`  → never (explicit opt-out)
 *   - `OS_TELEMETRY_DB=<path>`      → always, at that path (dev AND serve)
 *   - dev mode + file-backed primary → default ON, `<primary>.telemetry.<ext>`
 *     (`dev.db` → `dev.telemetry.db`, same directory)
 *   - everything else (prod serve, `:memory:`, non-sqlite) → off
 *
 * Production stays opt-in: a second file appearing next to a prod database
 * is a deployment-topology change an operator should choose, not inherit.
 */
export function resolveTelemetryDbPath(opts: {
  /** Primary sqlite file path (already stripped of `file:`/`sqlite:`). */
  primaryPath: string;
  env: Record<string, string | undefined>;
  dev: boolean;
}): string | undefined {
  const raw = opts.env.OS_TELEMETRY_DB?.trim();
  if (raw) {
    const lowered = raw.toLowerCase();
    if (lowered === '0' || lowered === 'false' || lowered === 'off') return undefined;
    return raw.replace(/^file:/i, '').replace(/^sqlite:/i, '');
  }

  if (!opts.dev) return undefined;

  const primary = opts.primaryPath.trim();
  // Only a real on-disk primary gets a sibling: separating one `:memory:`
  // store into another has no reclamation value.
  if (!primary || primary === ':memory:' || primary.startsWith(':')) return undefined;

  if (/\.(db|sqlite3|sqlite)$/i.test(primary)) {
    return primary.replace(/\.(db|sqlite3|sqlite)$/i, '.telemetry.$1');
  }
  return `${primary}.telemetry.db`;
}

/** What {@link provisionTelemetryDatasource} needs from the boot that calls it. */
export interface ProvisionTelemetryDatasourceOptions {
  /**
   * The primary datasource's on-disk SQLite path, or `undefined` when the
   * primary is not a file-backed native SQLite database (another engine,
   * `:memory:`) — then nothing is provisioned, whatever `OS_TELEMETRY_DB` says.
   */
  primaryPath: string | undefined;
  env: Record<string, string | undefined>;
  /** The host's dev declaration — the same value its primary datasource was built under. */
  dev: boolean;
  /** Register a plugin with the booting kernel (`kernel.use`). */
  use: (plugin: unknown) => unknown;
  /** Where the sqlite step-down's own warnings go. */
  warn: (message: string) => void;
}

/**
 * Provision the dedicated `telemetry` datasource next to a file-backed SQLite
 * primary (ADR-0057 §3.6) — the ONE provision every serving boot runs.
 *
 * Returns the telemetry file it registered, or `undefined` when none was:
 * {@link resolveTelemetryDbPath} declined (production without
 * `OS_TELEMETRY_DB`, `OS_TELEMETRY_DB=0`, an in-memory primary), the sqlite
 * step-down could only offer an in-memory engine, or the provision failed.
 * Best-effort by design: a failed telemetry provision must never block boot —
 * the lifecycle-classed objects simply stay on the primary datasource.
 *
 * Two boots call it (#21733): the config-load fallback (`resolveStorageDefinition`'s
 * `sqliteFilePath`) and the standalone stack every plain `os dev` / `os serve`
 * / `os start` composes (its resolved `default` database). It used to live
 * inline in the first of them, so a plain `os dev` never got a telemetry
 * sibling while `content/docs/deployment/cli.mdx` promised one for every dev
 * boot on a file-backed SQLite database.
 *
 * The telemetry driver stays a pre-built `DriverPlugin` — the documented escape
 * hatch for named auxiliary drivers (ADR-0062): the engine keys datasources by
 * driver name, so naming the driver `telemetry` is the WHOLE wiring —
 * `DriverPlugin.init` registers `driver.telemetry`, ObjectQL's discovery loop
 * adopts it, and lifecycle-classed objects route to it. Its dev self-heal is
 * the shared decision (`devAutoMigrateConfig`), the same one the primary reads.
 */
export async function provisionTelemetryDatasource(
  opts: ProvisionTelemetryDatasourceOptions,
): Promise<string | undefined> {
  if (!opts.primaryPath) return undefined;
  const telemetryPath = resolveTelemetryDbPath({ primaryPath: opts.primaryPath, env: opts.env, dev: opts.dev });
  if (!telemetryPath) return undefined;
  try {
    const { resolveSqliteDriver } = await import('@objectstack/service-datasource');
    const { DriverPlugin, devAutoMigrateConfig } = await import('@objectstack/runtime');
    const telemetry = await resolveSqliteDriver({
      filename: telemetryPath,
      dev: opts.dev,
      ...devAutoMigrateConfig('sqlite', opts.dev),
      warn: opts.warn,
    });
    // The ABI-broken step-down case: separating one in-memory store into
    // another has no reclamation value, and would lose telemetry on restart.
    if (telemetry.engine === 'memory') return undefined;
    Object.defineProperty(telemetry.driver, 'name', { value: 'telemetry' });
    await opts.use(new DriverPlugin(telemetry.driver));
    return telemetryPath;
  } catch {
    return undefined;
  }
}

/**
 * The file-backed native SQLite database a standalone stack built from `input`
 * declares as its `default` datasource — the primary its `telemetry` sibling is
 * keyed on — or `undefined` for every other kind and for `:memory:`.
 *
 * Read through the runtime's own pre-boot resolution (`resolveStandaloneDatabase`,
 * the answer `createStandaloneStack` builds its definition from), so the sibling
 * can never sit next to a different file than the one the boot opens. Only the
 * native `sqlite` kind counts — the same kind the config-load fallback hands a
 * `sqliteFilePath` (`resolveStorageDefinition`): a `sqlite-wasm` primary gets no
 * sibling on either path.
 */
export async function standaloneTelemetryPrimary(input: StandaloneStackConfig): Promise<string | undefined> {
  const { resolveStandaloneDatabase } = await import('@objectstack/runtime');
  const db = resolveStandaloneDatabase(input);
  return db.driver === 'sqlite' && db.sqliteFile ? db.sqliteFile : undefined;
}
