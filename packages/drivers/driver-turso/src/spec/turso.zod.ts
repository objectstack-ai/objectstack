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
   * Local file path for the embedded replica.
   * Required when using embedded replica mode (syncUrl is provided).
   * The local file serves reads with microsecond latency while writes
   * propagate to the remote primary.
   */
  localPath: z.string().optional().describe('Local file path for embedded replica'),

  /**
   * Sync configuration for embedded replicas.
   */
  sync: TursoSyncConfigSchema.optional().describe('Sync settings for embedded replica mode'),

  /**
   * Timeout for database operations in milliseconds.
   */
  timeout: z.number().int().min(0).optional().describe('Operation timeout in milliseconds'),

  /**
   * Enable WASM mode.
   * When true, uses the WASM build of libSQL for browser or edge runtime
   * environments that cannot run native bindings (e.g., Cloudflare Workers).
   */
  wasm: z.boolean().optional().describe('Use WASM build for edge/browser environments'),
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
