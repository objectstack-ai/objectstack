// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { DriverDefinitionSchema } from '@objectstack/spec/data';

/**
 * Turso / libSQL Driver Configuration Schema
 *
 * Defines the connection settings specific to Turso (libSQL) — a SQLite-compatible
 * edge database supporting embedded replicas, global distribution, and offline-first
 * architectures.
 *
 * Turso supports three connection modes:
 * 1. **Remote** — Connect to a Turso cloud or self-hosted libSQL server via HTTPS/WSS
 * 2. **Local** — Use a local SQLite/libSQL file for embedded or serverless workloads
 * 3. **Embedded Replica** — Local SQLite file that syncs with a remote Turso primary
 *
 * @see https://docs.turso.tech/sdk/ts/reference
 */

// ==========================================================================
// 1. Sync Configuration (Embedded Replicas)
// ==========================================================================

/**
 * Embedded Replica Sync Configuration.
 * Controls how the local embedded replica synchronizes with the remote primary.
 */
import { lazySchema } from '@objectstack/spec/shared';
export const TursoSyncConfigSchema = lazySchema(() => z.object({
  /**
   * Sync interval in seconds.
   * The local replica will periodically pull changes from the remote primary.
   * Set to 0 to disable periodic sync (manual sync only).
   */
  intervalSeconds: z.number().min(0).default(60).describe('Periodic sync interval in seconds (0 = manual only)'),

  /**
   * Sync on connect.
   * When true, the driver performs a sync immediately upon connection.
   */
  onConnect: z.boolean().default(true).describe('Sync immediately on connect'),
}).describe('Embedded replica sync configuration'));

// ==========================================================================
// 2. Connection Configuration
// ==========================================================================

/**
 * The prescription the retired `timeout` key raises, and the text `tsc` and the
 * parse both carry. Standardized closing sentence — the `os migrate meta`
 * wording states a property of the TOOL and is not a choice (see
 * `retired-key.ts` in `@objectstack/spec`, whose header owns that ruling).
 *
 * ⛔ No internal issue id in this string: it is customer-facing text and
 * `check:doc-authoring` refuses one. The ids live in the comments beside the
 * keys below.
 */
const TIMEOUT_RETIRED =
  '`turso config.timeout` was renamed to `timeoutMs` in @objectstack/driver-turso 17 — the unit of a '
  + 'duration-shaped number lives in the key name, not only in the describe prose. Rename the key to '
  + '`timeoutMs`; the value (milliseconds) is unchanged. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

/**
 * The prescriptions the two REMOVED keys raise (ADR-0049 enforce-or-remove).
 * Same channels and closing sentence as the rename above; the middle clause
 * says what actually names the thing each key pretended to name.
 */
const LOCAL_PATH_RETIRED =
  '`turso config.localPath` was removed in @objectstack/driver-turso 17 (ADR-0049) — it never had an '
  + 'effect: no code read it, and the embedded replica\'s local file has always been named by `url` '
  + '(`file:./replica.db`, with `syncUrl` pointing at the remote primary). Delete the key; a path it '
  + 'named that differs from `url` belongs in `url`. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

const WASM_RETIRED =
  '`turso config.wasm` was removed in @objectstack/driver-turso 17 (ADR-0049) — it never had an '
  + 'effect: nothing selects a WASM build of libSQL, and the driver loads whatever `@libsql/client` '
  + 'resolves to on the host runtime. Delete the key; a runtime that cannot load native bindings uses '
  + 'the remote arm (`libsql://` / `https://`), which needs none. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

export const TursoConfigSchema = lazySchema(() => z.object({
  /**
   * Database URL.
   * Supports multiple protocols:
   * - `libsql://` or `https://` for remote Turso cloud databases
   * - `ws://` or `wss://` for WebSocket connections
   * - `file:` for local SQLite/libSQL files
   * - `:memory:` for in-memory database
   */
  url: z.string().describe('Database URL (libsql://, https://, file:, or :memory:)'),

  /**
   * Authentication Token.
   * Required for remote Turso databases; optional for local files.
   * Typically a JWT issued by Turso platform or self-hosted libSQL server.
   */
  authToken: z.string().optional().describe('Authentication token for remote database'),

  /**
   * Encryption Key.
   * When provided, encrypts the local database file at rest using AES-256.
   * Applies to both local-only and embedded replica modes.
   */
  encryptionKey: z.string().optional().describe('Encryption key for local database file (AES-256)'),

  /**
   * Concurrency Limit.
   * Maximum number of concurrent requests to the database.
   * Defaults to 20 for remote connections.
   */
  concurrency: z.number().int().min(1).default(20).describe('Maximum concurrent requests'),

  /**
   * Embedded Replica Configuration.
   * When provided, enables embedded replica mode: a local SQLite file that
   * syncs with the remote primary specified in `url`.
   */
  syncUrl: z.string().optional().describe('Remote sync URL for embedded replica mode'),

  /**
   * Tombstone for the REMOVED `localPath` (#16024, ADR-0049 enforce-or-remove).
   *
   * It promised "Local file path for embedded replica" and was read by no
   * code: the replica arm names its local file via `url`, which is what the
   * driver's own docs and `@objectstack/spec`'s turso contract both say —
   * forwarding it would have created a second way to say the same thing.
   * `z.never()` rather than a bare deletion for the reason `timeout` below
   * spells out: this shape is a plain `z.object`, and a deletion would strip
   * the key in silence.
   */
  localPath: z.never({ error: () => LOCAL_PATH_RETIRED }).optional().describe(`[REMOVED] ${LOCAL_PATH_RETIRED}`),

  /**
   * Sync configuration for embedded replicas.
   */
  sync: TursoSyncConfigSchema.optional().describe('Sync settings for embedded replica mode'),

  /**
   * Operation timeout in milliseconds for remote operations; `0` = no bound.
   *
   * Renamed from `timeout` (#15682, ruling B on #14478): the unit lived only in
   * the describe prose, while `sync.intervalSeconds` — the same shape, three
   * keys above — already spelled ITS unit. One published connection config
   * carrying both conventions is what made the bare name dangerous rather than
   * untidy. `@objectstack/spec`'s own turso contract renamed the same authored
   * key in #15680; this mirror now agrees with it, and with the ADR-0087
   * conversion (`turso-config-timeout-to-timeout-ms`) that rewrites the stored
   * spelling on load.
   *
   * It reaches the driver as `TursoDriverConfig.timeout` (the datasource seam
   * in `@objectstack/service-datasource` maps the authored `timeoutMs` onto the
   * driver's bare spelling), and since #16024 that key does what the describe
   * promises: remote mode over HTTP aborts every request once the window
   * elapses, replica mode bounds `sync()`. `TursoDriverConfig.timeout`'s own
   * docblock carries the per-arm detail.
   */
  timeoutMs: z.number().int().min(0).optional().describe('Operation timeout in milliseconds for remote operations (0 = no bound)'),

  /**
   * Tombstone for the rename above (#15682, ruling B on #14478).
   *
   * This is a plain `z.object`, so zod's default STRIP posture would make a
   * bare deletion SILENT: an author's `timeout: 30000` would vanish and the
   * parse would still succeed. `z.never()` keeps the key DECLARED and
   * unwritable, so the old spelling raises the prescription instead of
   * disappearing — the two channels an upgrading author actually meets (`tsc`
   * sees `never` at the authoring site; the parse raises the text itself).
   *
   * Spelled inline rather than through `@objectstack/spec`'s `retiredKey()`:
   * that helper is internal to the spec package and is not on its published
   * `./shared` entry point, so this package cannot import it. The shape is the
   * same one-liner.
   */
  timeout: z.never({ error: () => TIMEOUT_RETIRED }).optional().describe(`[REMOVED] ${TIMEOUT_RETIRED}`),

  /**
   * Tombstone for the REMOVED `wasm` (#16024, ADR-0049 enforce-or-remove).
   *
   * It promised "Use WASM build for edge/browser environments" and nothing
   * selected one: a browser or edge deployment got whatever
   * `import('@libsql/client')` resolved to, with or without the flag.
   * Forwarding would have meant building a WASM selection that does not
   * exist, so the key goes — as a tombstone, for the same silent-strip reason
   * as `localPath` above.
   */
  wasm: z.never({ error: () => WASM_RETIRED }).optional().describe(`[REMOVED] ${WASM_RETIRED}`),
}).describe('Turso/libSQL Connection Configuration'));

// ==========================================================================
// 3. Driver Definition (Metadata)
// ==========================================================================

/**
 * The static definition of the Turso driver's identity and default metadata.
 * Implements the `DriverDefinitionSchema` contract.
 *
 * Turso/libSQL is a SQLite-compatible database with:
 * - Full ACID transactions (interactive + batch)
 * - Standard SQL query support (WHERE, ORDER BY, LIMIT/OFFSET, aggregations)
 * - JSON field support via SQLite JSON1 extension
 * - Full-text search via FTS5
 * - No native JOIN push-down limitations (full SQL joins supported)
 * - No window functions, subqueries, CTEs limitations (full SQLite SQL support)
 * - Embedded replica sync for edge deployments
 *
 * No `capabilities` block: `datasource.capabilities` was removed in
 * @objectstack/spec 17.0.0 (#4583, ADR-0049). The eleven flags were declared
 * and read by nobody — pushdown is decided by the runtime driver's own
 * `supports.*`, not by this metadata, so the block never changed which engine
 * path ran. The list above is the honest, non-executable statement of what
 * this driver can do.
 */
export const TursoDriverSpec = DriverDefinitionSchema.parse({
  id: 'turso',
  label: 'Turso (libSQL)',
  description: 'SQLite-compatible edge database with embedded replicas, global distribution, and offline-first support. Built on libSQL, a fork of SQLite.',
  icon: 'database',
  configSchema: {},
});

// ==========================================================================
// 4. Derived Types
// ==========================================================================

export type TursoConfig = z.infer<typeof TursoConfigSchema>;
export type TursoSyncConfig = z.infer<typeof TursoSyncConfigSchema>;
