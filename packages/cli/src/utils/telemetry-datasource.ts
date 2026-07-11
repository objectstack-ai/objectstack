// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

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
