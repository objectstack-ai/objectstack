// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared native-`better-sqlite3` → wasm SQLite → in-memory step-down for any
 * sqlite-via-`better-sqlite3` construction (issue #2229).
 *
 * ## Why a probe is necessary
 *
 * `better-sqlite3` loads its native `.node` addon LAZILY — not at
 * `require('better-sqlite3')`, and not even at knex construction, but at the
 * first pool-connection acquire (`new Database(file)`), i.e. the first query.
 * So an ABI mismatch (a cached prebuilt binary built for a different Node
 * version — `NODE_MODULE_VERSION` mismatch) is invisible at boot and only
 * surfaces much later as a runtime `Find operation failed` on the first read.
 *
 * This helper makes the failure observable up-front by actively probing: it
 * opens a connection and runs a cheap `SELECT 1`, which forces the native addon
 * to load. (`connect()` alone is NOT a reliable probe: for SQLite it only runs
 * `mkdir` + a `PRAGMA` whose error is swallowed internally — so we additionally
 * issue a raw `SELECT 1`, which propagates the load error.) On failure it steps
 * down:
 *
 *   1. native `better-sqlite3`  — fast, real SQL
 *   2. wasm SQLite              — pure-JS, real SQL + on-disk persistence, slower   [dev only]
 *   3. in-memory (mingo)        — neither real SQL nor persistent                   [dev only, last resort]
 *
 * ## Dev vs production
 *
 * The wasm + in-memory step-down is GATED to dev. In production a native load
 * failure is NOT silently swapped for a different engine: the error is re-thrown
 * so it surfaces loudly (fail-closed) instead of an operator unknowingly running
 * on wasm/mingo. This mirrors the existing `serve.ts` default-dev fallback and
 * hoists it into one place shared by every sqlite construction site.
 */

import type { SqliteAbsentFileMode } from '@objectstack/driver-sql';

/** Which engine the resolver ultimately produced. */
export type SqliteFallbackEngine = 'better-sqlite3' | 'sqlite-wasm' | 'memory';

export interface ResolveSqliteDriverOptions {
  /**
   * SQLite filename — `:memory:` for an ephemeral database, or an absolute /
   * relative path for a persistent file. Preserved across the wasm fallback so
   * a persistent `file:` database keeps its on-disk persistence through wasm.
   * Pass the raw filename (callers strip any `file:` / `sqlite:` scheme first).
   */
  filename: string;
  /**
   * Gates the wasm + in-memory step-down. When `true` (dev) a native ABI/load
   * failure steps down the chain with a warning. When `false` (production) the
   * native driver is returned unprobed so a failure surfaces loudly at first use
   * (fail-closed) — we never silently degrade behind the operator's back.
   * Defaults to `process.env.NODE_ENV === 'development'`.
   */
  dev?: boolean;
  /** Forwarded to the native SqlDriver (dev loosen-only self-heal, #2186). */
  autoMigrate?: 'off' | 'safe';
  /** Forwarded to the SQL drivers (external schema mode, ADR-0015). */
  schemaMode?: string;
  /**
   * What to do when {@link filename} names a file that does not exist (#6743).
   * Forwarded to the native driver, and applied to the wasm rung too — a
   * step-down must not create the file the caller asked us not to create.
   * Defaults to `'create'`, i.e. SQLite's own behaviour.
   */
  sqliteAbsentFile?: SqliteAbsentFileMode;
  /**
   * Warning sink for the step-down messages. Defaults to `console.warn`.
   * `serve.ts` passes a `chalk.yellow` wrapper so the banner stays consistent.
   */
  warn?: (message: string) => void;
}

export interface ResolvedSqliteDriver {
  /** The concrete engine driver to register (e.g. via `DriverPlugin`). */
  driver: any;
  /** Which engine actually resolved. */
  engine: SqliteFallbackEngine;
  /** Banner label, matching `serve.ts`'s existing strings. */
  label: string;
}

/**
 * Warning emitted when native `better-sqlite3` is unavailable but wasm SQLite
 * loads. Kept byte-for-byte identical to the original `serve.ts` text so the
 * dev experience is the same regardless of which construction site triggers it.
 */
export const NATIVE_SQLITE_WASM_FALLBACK_WARNING =
  '  ⚠ native better-sqlite3 unavailable (ABI mismatch or not built) — dev using wasm SQLite (real SQL, slower).\n' +
  '    Rebuild better-sqlite3 for native speed, or set OS_DATABASE_DRIVER=sqlite-wasm to silence this.';

/** Warning emitted when neither native nor wasm SQLite loads (dev last resort). */
export const NATIVE_SQLITE_MEMORY_FALLBACK_WARNING =
  '  ⚠ neither native nor wasm SQLite available — dev falling back to InMemoryDriver (mingo, not real SQL).\n' +
  '    Rebuild better-sqlite3, or set OS_DATABASE_URL / OS_DATABASE_DRIVER for SQL fidelity.';

/** `:memory:` and other `:`-prefixed pseudo-filenames are never persisted. */
function isEphemeralFilename(filename: string): boolean {
  return filename === ':memory:' || filename.startsWith(':');
}

/**
 * Probe a `better-sqlite3` SQLite construction and, in dev, step down to wasm
 * SQLite (then in-memory) when the native addon cannot load.
 *
 * @see {@link ResolveSqliteDriverOptions}
 */
export async function resolveSqliteDriver(
  opts: ResolveSqliteDriverOptions,
): Promise<ResolvedSqliteDriver> {
  const { filename } = opts;
  const dev = opts.dev ?? process.env.NODE_ENV === 'development';
  const warn =
    opts.warn ??
    ((message: string) => {
      try {
        // eslint-disable-next-line no-console
        console.warn(message);
      } catch {
        /* ignore */
      }
    });

  const { SqlDriver, resolveSqliteAbsentFileTarget } = await import('@objectstack/driver-sql');

  const buildNative = () =>
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      ...(opts.autoMigrate ? { autoMigrate: opts.autoMigrate } : {}),
      ...(opts.schemaMode ? { schemaMode: opts.schemaMode } : {}),
      ...(opts.sqliteAbsentFile ? { sqliteAbsentFile: opts.sqliteAbsentFile } : {}),
    } as any);

  /**
   * The filename the wasm rung must open (#6743). `SqliteWasmDriver` has no
   * `sqliteAbsentFile` of its own — it is constructed straight from a filename
   * — so the step-down resolves the driver's OWN judgement here rather than
   * re-deciding it, and a fresh project that falls through to wasm still
   * leaves no file behind.
   */
  const wasmFilename = resolveSqliteAbsentFileTarget(filename, opts.sqliteAbsentFile).filename;

  // Production: never silently swap engines. Construct the native driver and
  // hand it back UNPROBED — exactly the historical behavior. A native load
  // failure surfaces loudly at first use (fail-closed).
  if (!dev) {
    return { driver: buildNative(), engine: 'better-sqlite3', label: 'SqlDriver(sqlite)' };
  }

  // ── Dev: probe-by-connect, step down on native ABI/load failure. ──────────

  // 1. Native better-sqlite3.
  let nativeDriver: any;
  let nativeOk = false;
  try {
    nativeDriver = buildNative();
    // connect() runs mkdir (so a SELECT on a file DB whose dir is missing does
    // not false-positive as an ABI failure) + a PRAGMA whose error it swallows;
    // the raw SELECT 1 below is what reliably forces the native addon to load
    // and PROPAGATES an ABI mismatch.
    await nativeDriver.connect();
    await nativeDriver.execute('SELECT 1');
    nativeOk = true;
  } catch {
    nativeOk = false;
    if (typeof nativeDriver?.disconnect === 'function') {
      try {
        await nativeDriver.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
  if (nativeOk) {
    return { driver: nativeDriver, engine: 'better-sqlite3', label: 'SqlDriver(sqlite)' };
  }

  // 2. wasm SQLite — real SQL semantics + on-disk persistence, no native build.
  let wasmDriver: any;
  let wasmOk = false;
  try {
    const { SqliteWasmDriver } = await import('@objectstack/driver-sqlite-wasm');
    wasmDriver = new SqliteWasmDriver({
      filename: wasmFilename,
      // Match the existing construction sites: ephemeral DBs flush on
      // disconnect; a persistent file flushes on every write so AI-authored
      // data survives an unclean dev-server kill.
      persist: isEphemeralFilename(wasmFilename) ? 'on-disconnect' : 'on-write',
    } as any);
    await wasmDriver.connect();
    wasmOk = true;
  } catch {
    wasmOk = false;
    if (typeof wasmDriver?.disconnect === 'function') {
      try {
        await wasmDriver.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
  if (wasmOk) {
    warn(NATIVE_SQLITE_WASM_FALLBACK_WARNING);
    return { driver: wasmDriver, engine: 'sqlite-wasm', label: 'SqliteWasmDriver' };
  }

  // 3. In-memory (mingo) — dev-only last resort. Not real SQL, not persistent.
  // `persistence: false` says the second half out loud. It used to be the only
  // thing making it true: the driver defaulted to `'auto'`, which in Node
  // flushed the whole store to `.objectstack/data/memory-driver.json` in the CWD
  // and reloaded it next boot — a shared file every memory pool in the process
  // aliased (#4083). #4065 made `false` the driver's own default, so this is now
  // a restatement rather than a correction; it stays because a rung that MUST
  // NOT persist should not be one edit away from persisting again.
  const { InMemoryDriver } = await import('@objectstack/driver-memory');
  warn(NATIVE_SQLITE_MEMORY_FALLBACK_WARNING);
  return {
    driver: new InMemoryDriver({ persistence: false }),
    engine: 'memory',
    label: 'InMemoryDriver',
  };
}
