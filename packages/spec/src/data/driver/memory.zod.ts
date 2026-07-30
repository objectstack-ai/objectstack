// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { DriverDefinitionSchema } from '../datasource.zod';

/**
 * Memory Driver Configuration Schema
 * 
 * Defines the configuration options for the in-memory driver.
 * Reference: objectql/packages/drivers/memory (Mingo-powered production-ready driver)
 * 
 * The memory driver is ideal for:
 * - Unit testing (no database setup required)
 * - Development & prototyping
 * - Edge/Worker environments (Cloudflare Workers, Deno Deploy)
 * - Client-side state management
 * - Temporary data caching
 * - CI/CD pipelines
 */

// ==========================================================================
// 1. Persistence Configuration
// ==========================================================================

/**
 * Persistence adapter interface for custom persistence implementations.
 * Adapters must implement load/save/flush lifecycle methods.
 *
 * Note: This schema validates presence of function properties only.
 * Actual function signature enforcement is done at the TypeScript level
 * via `PersistenceAdapterInterface` in the driver implementation.
 */
import { lazySchema } from '../../shared/lazy-schema';
export const PersistenceAdapterSchema = lazySchema(() => z.object({
  load: z.function().describe('Load persisted data on startup. Returns Promise<Record<string, any[]> | null>'),
  save: z.function().describe('Save data to persistent storage. Accepts Record<string, any[]>, returns Promise<void>'),
  flush: z.function().describe('Flush pending writes and ensure data is persisted. Returns Promise<void>'),
}).describe('Custom persistence adapter interface'));

export type PersistenceAdapter = z.infer<typeof PersistenceAdapterSchema>;

/**
 * Persistence type enum.
 * - `file`: Persist to disk file (Node.js only).
 * - `local`: Persist to localStorage (Browser only).
 * - `auto`: Auto-detect environment and choose the best strategy.
 *   Uses `localStorage` in browser environments, `file` in standard Node.js,
 *   and disables persistence with a warning in serverless/edge runtimes.
 */
export const PersistenceTypeSchema = lazySchema(() => z.enum(['file', 'local', 'auto']).describe('Persistence backend type'));

export type PersistenceType = z.infer<typeof PersistenceTypeSchema>;

/**
 * File-system persistence configuration.
 * Used in Node.js environments to save data to a JSON file.
 */
export const FilePersistenceConfigSchema = lazySchema(() => z.object({
  type: z.literal('file'),
  /** File path to persist data (JSON format). Defaults to `.objectstack/data/memory-driver.json`. */
  path: z.string().optional().describe('File path to persist data'),
  /** Auto-save interval in milliseconds. Default: 2000ms. */
  autoSaveInterval: z.number().min(100).default(2000).describe('Auto-save interval in ms'),
}).describe('File-system persistence configuration'));

export type FilePersistenceConfig = z.infer<typeof FilePersistenceConfigSchema>;

/**
 * localStorage persistence configuration.
 * Used in browser environments to save data to localStorage.
 */
export const LocalStoragePersistenceConfigSchema = lazySchema(() => z.object({
  type: z.literal('local'),
  /** localStorage key. Defaults to `objectstack:memory-db`. */
  key: z.string().optional().describe('localStorage key for persisted data'),
}).describe('localStorage persistence configuration'));

export type LocalStoragePersistenceConfig = z.infer<typeof LocalStoragePersistenceConfigSchema>;

/**
 * Custom adapter persistence configuration.
 * Allows injecting a custom PersistenceAdapter implementation.
 */
export const CustomPersistenceConfigSchema = lazySchema(() => z.object({
  adapter: PersistenceAdapterSchema,
}).describe('Custom adapter persistence configuration'));

export type CustomPersistenceConfig = z.infer<typeof CustomPersistenceConfigSchema>;

/**
 * Auto-detect persistence configuration.
 * Automatically selects the best persistence strategy based on the runtime environment:
 * - Browser → localStorage persistence
 * - Serverless (Vercel, AWS Lambda, etc.) → Persistence disabled with warning
 * - Node.js (standard) → File-system persistence
 *
 * **⚠️ Serverless Warning:** In serverless/edge environments the file system is
 * ephemeral or read-only. Auto mode detects this and disables file persistence to
 * prevent silent data loss. Use `persistence: false` to silence the warning, or
 * supply a custom adapter (e.g. Upstash Redis, Vercel KV) via
 * `persistence: { adapter: yourAdapter }`.
 *
 * Optional overrides allow customizing the file path or localStorage key
 * used by the auto-detected adapter.
 */
export const AutoPersistenceConfigSchema = lazySchema(() => z.object({
  type: z.literal('auto'),
  /** File path override when running in Node.js. */
  path: z.string().optional().describe('File path override for Node.js environments'),
  /** Auto-save interval override when running in Node.js. */
  autoSaveInterval: z.number().min(100).optional().describe('Auto-save interval override for Node.js environments'),
  /** localStorage key override when running in a browser. */
  key: z.string().optional().describe('localStorage key override for browser environments'),
}).describe('Auto-detect persistence configuration'));

export type AutoPersistenceConfig = z.infer<typeof AutoPersistenceConfigSchema>;

/**
 * Unified persistence configuration.
 *
 * Supports shorthand strings and detailed object configs:
 * - `'file'` — File-system persistence with defaults (Node.js)
 * - `'local'` — localStorage persistence with defaults (Browser)
 * - `'auto'` — Auto-detect environment (browser → localStorage, Node.js → file, serverless → disabled)
 * - `{ type: 'file', path?: string }` — File-system with custom path
 * - `{ type: 'local', key?: string }` — localStorage with custom key
 * - `{ type: 'auto', path?: string, key?: string }` — Auto-detect with overrides
 * - `{ adapter: PersistenceAdapter }` — Custom adapter
 *
 * @example
 * // Auto-detect environment
 * persistence: 'auto'
 *
 * // Node.js with defaults
 * persistence: 'file'
 *
 * // Browser with defaults
 * persistence: 'local'
 *
 * // Auto-detect with overrides
 * persistence: { type: 'auto', path: '/var/data/memory.json', key: 'myapp:db' }
 *
 * // Custom file path
 * persistence: { type: 'file', path: '/var/data/memory.json' }
 *
 * // Custom localStorage key
 * persistence: { type: 'local', key: 'myapp:db' }
 */
export const MemoryPersistenceConfigSchema = lazySchema(() => z.union([
  PersistenceTypeSchema,
  FilePersistenceConfigSchema,
  LocalStoragePersistenceConfigSchema,
  AutoPersistenceConfigSchema,
  CustomPersistenceConfigSchema,
]).describe('Persistence configuration for the memory driver'));

// ==========================================================================
// 2. Connection Configuration
// ==========================================================================

export const MemoryConfigSchema = lazySchema(() => z.object({
  /**
   * Initial data to pre-populate the in-memory store.
   * Maps object/table names to arrays of records.
   * Records should include an `id` field; one will be generated if absent.
   * 
   * @example
   * {
   *   users: [
   *     { id: '1', name: 'Alice', email: 'alice@example.com' },
   *     { id: '2', name: 'Bob', email: 'bob@example.com' }
   *   ],
   *   posts: [
   *     { id: '1', title: 'Hello World', author_id: '1' }
   *   ]
   * }
   */
  initialData: z.record(
    z.string(),
    z.array(z.record(z.string(), z.unknown()))
  ).optional().describe('Pre-populated data keyed by object name'),

  /**
   * Enable strict mode.
   * When enabled, operations on missing records throw errors instead of returning null/false.
   */
  strictMode: z.boolean().default(false).describe('Throw on missing records instead of returning null'),

  /**
   * Persistence configuration. **Defaults to `false` — pure in-memory.**
   *
   * Durability is opt-in, per #815's requirement #1 ("默认情况下不启用持久化（纯内存，
   * 行为不变）"). A driver named "in-memory" that silently wrote to the process CWD
   * surprised every caller that never asked for it, and made fixed-id fixtures pass
   * on the first run and fail on every rerun (#4065).
   *
   * - `false` (default): No persistence — pure in-memory, data lost on disconnect
   * - `'auto'`: Auto-detect environment (browser → localStorage, Node.js → file)
   * - `'file'`: Persist to disk file (Node.js only, default path: `.objectstack/data/memory-driver.json`)
   * - `'local'`: Persist to localStorage (Browser only, default key: `objectstack:memory-db`)
   * - `{ type: 'auto', path?: string, key?: string }`: Auto-detect with overrides
   * - `{ type: 'file', path?: string }`: File-system with custom path
   * - `{ type: 'local', key?: string }`: localStorage with custom key
   * - `{ adapter: PersistenceAdapter }`: Custom persistence adapter
   *
   * **⚠️ Serverless / Edge environments (Vercel, AWS Lambda, Netlify, etc.):**
   * `'auto'` detects serverless runtimes and disables file persistence to prevent
   * silent data loss. Supply a custom adapter (e.g. Upstash Redis, Vercel KV) for
   * durable storage there.
   *
   * @example
   * // Pure memory — the default
   * new InMemoryDriver()
   * // Node.js, durable across restarts
   * new InMemoryDriver({ persistence: 'file' })
   * // Browser, durable across reloads
   * new InMemoryDriver({ persistence: 'local' })
   * // Auto-detect the environment's best strategy
   * new InMemoryDriver({ persistence: 'auto' })
   * // Custom adapter for serverless
   * new InMemoryDriver({ persistence: { adapter: upstashAdapter } })
   *
   * **A datasource declared with `driver: 'memory'` is ephemeral unless this
   * key is set (#4083).** The shared datasource factory
   * (`createDefaultDatasourceDriverFactory`) passes `false` when the
   * declaration says nothing, so a declared memory datasource cannot silently
   * become a file-backed store in the process's working directory — matching
   * `objectstack dev`, which already reads an explicit memory driver as the
   * user opting out of persistence. Set this key to opt back in; when you do
   * without naming a `path`/`key`, the factory scopes the destination per
   * datasource, so two memory datasources never share one file.
   *
   * That per-datasource scoping is still the reason to route a memory pool
   * through the factory: #4065 made the DRIVER's own default `false` too, so
   * the factory's explicit `false` is now belt-and-braces rather than the only
   * thing standing between a declared datasource and a CWD write — but nothing
   * else expands `'auto'`/`'file'`/`'local'` into a per-datasource destination,
   * so two pools that DO opt in still need it to avoid aliasing one file.
   */
  persistence: MemoryPersistenceConfigSchema.or(z.literal(false)).default(false).describe('Persistence configuration (opt-in; defaults to pure in-memory)'),

  /**
   * Fields to index for faster lookups.
   * Maps object names to arrays of field names to index.
   * 
   * @example
   * {
   *   users: ['email', 'role'],
   *   posts: ['author_id', 'status']
   * }
   */
  indexes: z.record(
    z.string(),
    z.array(z.string())
  ).optional().describe('Index configuration per object'),

  /**
   * Maximum number of records per object type.
   * When exceeded, oldest records may be evicted (LRU).
   * Useful for caching or bounded memory usage.
   */
  maxRecordsPerObject: z.number().min(1).optional().describe('Max records per object (memory bound)'),

}).describe('Memory Driver Connection Configuration'));

// ==========================================================================
// 3. Driver Definition (Metadata)
// ==========================================================================

/**
 * The static definition of the Memory driver's capabilities and default metadata.
 * Implements the `DriverDefinitionSchema` contract.
 */
export const MemoryDriverSpec = DriverDefinitionSchema.parse({
  id: 'memory',
  label: 'In-Memory',
  description: 'High-performance in-memory driver powered by Mingo (MongoDB-compatible query engine). Supports filtering, aggregation pipelines, sorting, projection.',
  icon: 'memory',
  configSchema: {},
  capabilities: {
    transactions: true,
    // Query
    queryFilters: true,
    queryAggregations: true,
    querySorting: true,
    queryPagination: true,
    // No join, window function, or subquery support
    joins: false,
    queryWindowFunctions: false,
    querySubqueries: false,
    // No full-text search (linear scan)
    fullTextSearch: false,
    // Dynamic schema (no DDL needed)
    dynamicSchema: true,
  },
});

// ==========================================================================
// 4. Derived Types
// ==========================================================================

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type MemoryPersistenceConfig = z.infer<typeof MemoryPersistenceConfigSchema>;
