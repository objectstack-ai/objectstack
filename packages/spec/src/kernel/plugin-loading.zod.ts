// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * # Plugin Loading Protocol
 *
 * What remains of this module is the **observational** half: the lifecycle
 * event a loader would emit (`PluginLoadingEventSchema`) and the per-plugin
 * state it would track (`PluginLoadingStateSchema`).
 *
 * The **configuration** half — `PluginLoadingConfigSchema` and the ten member
 * schemas it combined, reached from authored metadata as `manifest.loading` —
 * was REMOVED in v17 per ADR-0049 enforce-or-remove (#4914). See the block
 * below.
 */

// ---------------------------------------------------------------------------
// REMOVED in v17 (#4914, ADR-0049 enforce-or-remove; maintainer ruling
// 2026-08-04): the entire `manifest.loading` configuration block.
//
// Gone with it: PluginLoadingConfigSchema and every schema only it embedded —
// PluginLoadingStrategySchema, PluginPreloadConfigSchema,
// PluginCodeSplittingSchema, PluginDynamicImportSchema,
// PluginInitializationSchema, PluginDependencyResolutionSchema,
// PluginHotReloadSchema, PluginCachingSchema, PluginSandboxingSchema,
// PluginPerformanceMonitoringSchema, and every type alias of those.
// `Manifest.loading` itself is a `retiredKey()` tombstone in `manifest.zod.ts`.
//
// Why: none of it had a runtime reader. A bare-name scan of all three repos
// (objectstack / cloud / objectui, each with a control probe proving the scan
// saw the tree) found every hit inside `packages/spec` itself — this module's
// own declaration, its own unit tests, the `manifest.zod.ts` embed and the
// generated artifacts. Nothing in `packages/core`, `packages/runtime` or
// `packages/metadata` ever read `manifest.loading.*`. So an author could write
// a full loading policy, have it parse clean, land it in the manifest, and have
// NOTHING happen — the #3950 shape (an exported schema with no consumer is read
// as a capability) at the scale of a whole block.
//
// Why `sandboxing` made this urgent rather than merely untidy: `PluginSandboxing`
// declared `isolationLevel: 'process' | 'vm' | 'iframe' | 'web-worker'`, IPC
// transports and an `allowedServices` ACL. An AI author (ADR-0033) reading that
// vocabulary concludes the platform isolates plugins and writes
// `loading: { sandboxing: { isolationLevel: 'process' } }`. It parsed, and it
// isolated nothing. A security control that is inert is worse than an absent
// one, because it is *believed* — that is ADR-0049's false-compliance case at
// its sharpest, and it is why the ruling chose REMOVE over `experimental`.
//
// Hot reload — the two-source convergence (ruling §2). This module's
// `PluginHotReloadSchema` was the DEAD one of two hot-reload vocabularies. The
// surviving one is `HotReloadConfigSchema` in `plugin-lifecycle-advanced.zod.ts`
// (carried on `AdvancedPluginLifecycleConfig.hotReload`), which is what
// `HotReloadManager` (`packages/core/src/hot-reload.ts`) actually reads. That
// side is KEPT as the starting point if hot reload is ever enforced — note it
// has an implementation body but no runtime composes it today (only its own
// unit test and `packages/core/examples/phase2-integration.ts` construct one),
// so it is a foundation, not a shipped capability. Enforcing it is deliberately
// a separate decision, not this retirement.
//
// If runtime loading policy is ever built, it returns via the ENFORCE route of
// ADR-0049 through a new ADR: write the loader first, then declare exactly the
// configuration it honours. The vocabulary it needs is unlikely to be this one.
// ---------------------------------------------------------------------------

/**
 * Plugin Loading Event
 * Emitted during plugin loading lifecycle
 */
export const PluginLoadingEventSchema = lazySchema(() => z.object({
  /**
   * Event type
   */
  type: z.enum([
    'load-started',
    'load-completed',
    'load-failed',
    'init-started',
    'init-completed',
    'init-failed',
    'preload-started',
    'preload-completed',
    'cache-hit',
    'cache-miss',
    'hot-reload',
    'dynamic-load',       // Plugin loaded at runtime
    'dynamic-unload',     // Plugin unloaded at runtime
    'dynamic-discover',   // Plugin discovered via registry
  ]),

  /**
   * Plugin identifier
   */
  pluginId: z.string(),

  /**
   * Timestamp
   */
  timestamp: z.number().int().min(0),

  /**
   * Duration in milliseconds
   */
  durationMs: z.number().int().min(0).optional(),

  /**
   * Additional metadata
   */
  metadata: z.record(z.string(), z.unknown()).optional(),

  /**
   * Error if event represents a failure
   */
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
    stack: z.string().optional(),
  }).optional(),
}).describe('Plugin loading lifecycle event'));

/**
 * Plugin Loading State
 * Tracks the current loading state of a plugin
 */
export const PluginLoadingStateSchema = lazySchema(() => z.object({
  /**
   * Plugin identifier
   */
  pluginId: z.string(),

  /**
   * Current state
   */
  state: z.enum([
    'pending',       // Not yet loaded
    'loading',       // Currently loading
    'loaded',        // Code loaded, not initialized
    'initializing',  // Currently initializing
    'ready',         // Fully initialized and ready
    'failed',        // Failed to load or initialize
    'reloading',     // Hot reloading in progress
    'unloading',     // Being unloaded at runtime
    'unloaded',      // Successfully unloaded (dynamic loading)
  ]),

  /**
   * Load progress (0-100)
   */
  progress: z.number().min(0).max(100).default(0),

  /**
   * Loading start time
   */
  startedAt: z.number().int().min(0).optional(),

  /**
   * Loading completion time
   */
  completedAt: z.number().int().min(0).optional(),

  /**
   * Last error
   */
  lastError: z.string().optional(),

  /**
   * Retry count
   */
  retryCount: z.number().int().min(0).default(0),
}).describe('Plugin loading state'));

// Export types
export type PluginLoadingEvent = z.input<typeof PluginLoadingEventSchema>;
export type PluginLoadingState = z.input<typeof PluginLoadingStateSchema>;
/** Post-parse shape of {@link PluginLoadingState} — defaults applied, transforms run (ADR-0122). */
export type PluginLoadingStateParsed = z.infer<typeof PluginLoadingStateSchema>;
