// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { retiredKey } from '../shared/retired-key';

/**
 * # Metadata Manager Configuration
 *
 * How the runtime `MetadataManager` is wired: which datasource backs `sys_metadata`, what to fall back to when that datasource is unreachable, cache / watch / validation settings, and the persistence write gates.
 *
 * The loader and watch *envelope* types (`MetadataFormat`, `MetadataStats`, `MetadataLoadOptions`, `MetadataWatchEvent`, `MetadataLoaderContract`, …) are NOT here — they live in `@objectstack/spec/system` (`system/metadata-persistence.zod`), which is their single source.
 */

// Until #4411 this file ALSO declared its own copy of all eleven of those
// envelope types. Each name existed twice across two subpath entries
// (`@objectstack/spec/kernel` and `@objectstack/spec/system`) with a different
// shape, so which one you got depended on your import path — a coin-flip an
// auto-import or a model completion has no way to win on purpose, and the
// stricter-looking, more heavily documented copy was the DEAD one. Every
// consumer in this repo, `cloud` and `objectui` imported the `system` copy;
// the kernel copies had zero runtime consumers and only their own test
// parsing them, so they were removed under ADR-0049 enforce-or-remove.
// Manager *wiring* stays here; the *envelope* is owned by `system`.

import { lazySchema } from '../shared/lazy-schema';
// `MetadataManagerConfig.formats` is the ONLY surviving use of a format enum in
// this file. It reads the `shared` copy rather than declaring a fourth one —
// same four members, and `shared` is a leaf module so there is no cycle back
// through `system`. Deliberately NOT the `system` enum: that one is a wider
// superset (`yml`/`ts`/`js` aliases) and adopting it here would silently widen
// what this config accepts.
import { MetadataFormatSchema } from '../shared/metadata-types.zod';

/**
 * Metadata Fallback Strategy
 * Determines behavior when the primary datasource is unavailable.
 */
export const MetadataFallbackStrategySchema = lazySchema(() => z.enum([
  'filesystem', // Fall back to filesystem-based loading
  'memory',     // Fall back to in-memory storage
  'none',       // No fallback — fail immediately
]));

/**
 * Metadata Manager Configuration
 */
export const MetadataManagerConfigSchema = lazySchema(() => z.object({
  /**
   * Datasource Name Reference
   * References a DatasourceSchema.name (e.g. 'default').
   * At runtime, resolved from kernel service `driver.{name}` to obtain the actual driver.
   */
  datasource: z.string().optional().describe('Datasource name reference for database persistence'),

  /**
   * Metadata Table Name
   * The database table used for metadata storage when datasource is configured.
   */
  tableName: z.string().default('sys_metadata').describe('Database table name for metadata storage'),

  /**
   * Fallback Strategy
   * Determines behavior when the primary datasource is unavailable.
   */
  fallback: MetadataFallbackStrategySchema.default('none').describe('Fallback strategy when datasource is unavailable'),

  /**
   * Root directory for metadata (for filesystem loaders)
   */
  rootDir: z.string().optional().describe('Root directory path'),

  /**
   * Enabled serialization formats
   */
  formats: z.array(MetadataFormatSchema).default(['typescript', 'json', 'yaml']).describe('Enabled formats'),

  /**
   * Cache configuration
   */
  cache: z.object({
    enabled: z.boolean().default(true).describe('Enable caching'),
    ttl: z.number().int().min(0).default(3600).describe('Cache TTL in seconds'),
    maxSize: z.number().int().min(0).optional().describe('Max cache size in bytes'),
    /**
     * DatabaseLoader read-through cache.
     *
     * The DatabaseLoader caches `load`/`loadMany`/`list`/`stat` results in an
     * LRU keyed by `(type, name)`. All write paths invalidate the affected
     * entry, so reads always observe writes made through the same loader
     * instance. External writes (out-of-band SQL) are honored within `ttl`
     * milliseconds.
     */
    databaseLoader: z.object({
      enabled: z.boolean().default(true).describe('Enable DatabaseLoader cache'),
      maxSize: z.number().int().min(0).default(500).describe('Max cached entries'),
      ttl: z.number().int().min(0).default(60_000).describe('Cache TTL in milliseconds'),
    }).optional().describe('DatabaseLoader read-through cache'),
  }).optional().describe('Cache settings'),

  /**
   * Watch for file changes
   */
  watch: z.boolean().default(false).describe('Enable file watching'),

  /**
   * Watch options
   */
  watchOptions: z.object({
    ignored: z.array(z.string()).optional().describe('Patterns to ignore'),
    persistent: z.boolean().default(true).describe('Keep process running'),
    ignoreInitial: z.boolean().default(true).describe('Ignore initial add events'),
  }).optional().describe('File watcher options'),

  /**
   * Validation settings
   */
  validation: z.object({
    strict: z.boolean().default(true).describe('Strict validation'),
    throwOnError: z.boolean().default(true).describe('Throw on validation error'),
  }).optional().describe('Validation settings'),

  /**
   * Loader-specific options
   */
  loaderOptions: z.record(z.string(), z.unknown()).optional().describe('Loader-specific configuration'),

  /**
   * Persistence Write Gate
   *
   * Controls whether the metadata layer accepts mutations at runtime. Read
   * paths are always permitted.
   *
   * - `writable: false` — `MetadataManager.register()` becomes a no-op
   *   (or throws, depending on `validation.throwOnError`). Useful for
   *   read-only project kernels booted from a compiled artifact, where the
   *   running process must never write back to `sys_metadata`.
   *
   * Defaults to `true` so existing dev / Studio flows are unaffected.
   *
   * `overlayWritable` was REMOVED in v17 (#13135, ADR-0049 enforce-or-remove):
   * the only thing it ever gated was `MetadataManager.saveOverlay()` — a
   * method of the paper metadata-customization protocol, reachable only from
   * its own unit tests (no route or UI ever called it) and removed with that
   * protocol. Tombstoned rather than deleted because this nested object is
   * not `.strict()` — a plain deletion would strip the key in silence.
   */
  persistence: z.object({
    writable: z.boolean().default(true).describe('Allow base metadata writes via register()'),
    overlayWritable: retiredKey(
      '`persistence.overlayWritable` was removed from `MetadataManagerConfig` in ' +
      '@objectstack/spec 17 (#13135, ADR-0049 enforce-or-remove) — the only thing it gated was ' +
      '`MetadataManager.saveOverlay()`, a paper-protocol method no route or UI ever called, ' +
      'removed with the metadata-customization protocol (ADR-0126 supersedes it on the record). ' +
      'Delete the key. The base write gate that remains is `persistence.writable`; the real ' +
      "org-overlay writes (ADR-0005) ride the REST meta write doors' `manage_metadata` " +
      'permission gate, not this flag.',
    ),
  }).optional().describe('Persistence write gates'),
}));

// Export types
export type MetadataManagerConfig = z.input<typeof MetadataManagerConfigSchema>;
/** Post-parse shape of {@link MetadataManagerConfig} — defaults applied, transforms run (ADR-0122). */
export type MetadataManagerConfigParsed = z.infer<typeof MetadataManagerConfigSchema>;
export type MetadataFallbackStrategy = z.input<typeof MetadataFallbackStrategySchema>;
