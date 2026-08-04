// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { I18nLabelSchema } from './i18n.zod';
import { lazySchema } from '../shared/lazy-schema';

// ---------------------------------------------------------------------------
// NOT CLOSED AGAINST UNKNOWN KEYS -- AND THAT IS THE MEASURED VERDICT
// (#4001 batch 13 / 批 13, ADR-0078). Read this before "finishing" the file.
//
// The strictness ledger scheduled this file's 3 object sites as `authorable
// (p)` -- provisional. #4001's own rule is verify-before-tightening, and here
// the verification came back NEGATIVE: no metadata document is ever parsed
// against these shapes, because nothing in the protocol carries them.
//
// Three independent measurements, 2026-08-03:
//
//   1. STATIC -- nothing under `packages/spec/src` imports this module except
//      the `ui/index.ts` barrel. No schema anywhere declares a `app.offline / page.offline`
//      slot, so there is no key an author can write to reach these shapes.
//   2. GRAPH -- a BFS over this build's in-memory Zod graph from all 24
//      metadata-type roots (`listMetadataTypeSchemaTypes`) plus
//      `ObjectStackSchema` (`defineStack`) -- the closure `build-schemas.ts`
//      uses for the #4650 deletion check -- reaches none of them. Its three
//      positive controls resolve `root-graph` in the same run: `PageSchema`,
//      `WebhookSchema` (batch 11's `defineStack({ webhooks })` door) and
//      `StateMachineSchema` (batch 10's `agent.lifecycle` door). So
//      "unreachable" is a fact about the graph, not a broken instrument.
//   3. CALL SITES -- no `.parse()` / `.safeParse()` on any schema here exists
//      in `objectstack`, `objectui` or the example apps, outside this file's
//      own unit test. objectui re-exports the inferred TYPES only and says so
//      (`@object-ui/types`, the #2561 note: the validators are deliberately
//      NOT re-exported).
//
// `.strict()` would therefore gate nothing -- strictness is a property of a
// PARSE, and there is no parse. Adding it would spend a v17 breaking change to
// make this file LOOK finished, and leave behind the artefact the ledger
// itself warns about: "a *precisely validated* dead slot is the more
// convincing lie" (#4583). The real question is ADR-0049 enforce-or-remove --
// retire this vocabulary or give it a carrier -- filed as #4988, with the same
// verdict recorded in this file's ledger row.
//
// DO NOT convert these sites to `strictObject` before #4988 is decided: a
// strict shape reads as load-bearing and makes the retirement harder, which is
// the opposite of what the measurement asks for.
// ---------------------------------------------------------------------------

/**
 * Offline Strategy Schema
 * Determines how data is fetched when connectivity is limited.
 */
export const OfflineStrategySchema = lazySchema(() => z.enum([
  'cache_first',
  'network_first',
  'stale_while_revalidate',
  'network_only',
  'cache_only',
]).describe('Data fetching strategy for offline/online transitions'));

export type OfflineStrategy = z.infer<typeof OfflineStrategySchema>;

/**
 * Conflict Resolution Strategy Enum
 */
export const ConflictResolutionSchema = lazySchema(() => z.enum([
  'client_wins',
  'server_wins',
  'manual',
  'last_write_wins',
]).describe('How to resolve conflicts when syncing offline changes'));

export type ConflictResolution = z.infer<typeof ConflictResolutionSchema>;

/**
 * Sync Configuration Schema
 * Controls how offline mutations are synchronized with the server.
 */
export const SyncConfigSchema = lazySchema(() => z.object({
  strategy: OfflineStrategySchema.default('network_first').describe('Sync fetch strategy'),
  conflictResolution: ConflictResolutionSchema.default('last_write_wins').describe('Conflict resolution policy'),
  retryInterval: z.number().optional().describe('Retry interval in milliseconds between sync attempts'),
  maxRetries: z.number().optional().describe('Maximum number of sync retry attempts'),
  batchSize: z.number().optional().describe('Number of mutations to sync per batch'),
}).describe('Offline-to-online synchronization configuration'));

export type SyncConfig = z.infer<typeof SyncConfigSchema>;

/**
 * Persist Storage Backend Enum
 */
export const PersistStorageSchema = lazySchema(() => z.enum([
  'indexeddb',
  'localstorage',
  'sqlite',
]).describe('Client-side storage backend for offline cache'));

export type PersistStorage = z.infer<typeof PersistStorageSchema>;

/**
 * Eviction Policy Enum
 */
export const EvictionPolicySchema = lazySchema(() => z.enum([
  'lru',
  'lfu',
  'fifo',
]).describe('Cache eviction policy'));

export type EvictionPolicy = z.infer<typeof EvictionPolicySchema>;

/**
 * Offline Cache Configuration Schema
 * Controls how data is persisted on the client for offline access.
 */
export const OfflineCacheConfigSchema = lazySchema(() => z.object({
  maxSize: z.number().optional().describe('Maximum cache size in bytes'),
  ttl: z.number().optional().describe('Time-to-live for cached entries in milliseconds'),
  persistStorage: PersistStorageSchema.default('indexeddb').describe('Storage backend'),
  evictionPolicy: EvictionPolicySchema.default('lru').describe('Cache eviction policy when full'),
}).describe('Client-side offline cache configuration'));

export type OfflineCacheConfig = z.infer<typeof OfflineCacheConfigSchema>;

/**
 * Offline Configuration Schema
 * Top-level offline support configuration for an application or component.
 */
export const OfflineConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable offline support'),
  strategy: OfflineStrategySchema.default('network_first').describe('Default offline fetch strategy'),
  cache: OfflineCacheConfigSchema.optional().describe('Cache settings for offline data'),
  sync: SyncConfigSchema.optional().describe('Sync settings for offline mutations'),
  offlineIndicator: z.boolean().default(true).describe('Show a visual indicator when offline'),
  offlineMessage: I18nLabelSchema.optional().describe('Customizable offline status message shown to users'),
  queueMaxSize: z.number().optional().describe('Maximum number of queued offline mutations'),
}).describe('Offline support configuration'));

export type OfflineConfig = z.infer<typeof OfflineConfigSchema>;
