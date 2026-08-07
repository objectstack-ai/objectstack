// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// Service method interfaces use z.function() instead of z.any() for type safety.
// Generic data fields use z.unknown() for type safety.
import { lazySchema } from '../shared/lazy-schema';
export const PluginContextSchema = lazySchema(() => z.object({
  ql: z.object({
    object: z.function().describe('Get object handle for method chaining'),
    query: z.function().describe('Execute a query'),
  }).passthrough().describe('ObjectQL Engine Interface'),

  os: z.object({
    getCurrentUser: z.function().describe('Get the current authenticated user'),
    getConfig: z.function().describe('Get platform configuration'),
  }).passthrough().describe('ObjectStack Kernel Interface'),

  logger: z.object({
    debug: z.function().describe('Log debug message'),
    info: z.function().describe('Log info message'),
    warn: z.function().describe('Log warning message'),
    error: z.function().describe('Log error message'),
  }).passthrough().describe('Logger Interface'),

  storage: z.object({
    get: z.function().describe('Get a value from storage'),
    set: z.function().describe('Set a value in storage'),
    delete: z.function().describe('Delete a value from storage'),
  }).passthrough().describe('Storage Interface'),

  i18n: z.object({
    t: z.function().describe('Translate a key'),
    getLocale: z.function().describe('Get current locale'),
  }).passthrough().describe('Internationalization Interface'),

  metadata: z.record(z.string(), z.unknown()),
  events: z.record(z.string(), z.unknown()),
  
  app: z.object({
    router: z.object({
      get: z.function().describe('Register GET route handler'),
      post: z.function().describe('Register POST route handler'),
      use: z.function().describe('Register middleware'),
    }).passthrough()
  }).passthrough().describe('App Framework Interface'),

  drivers: z.object({
    register: z.function().describe('Register a driver'),
  }).passthrough().describe('Driver Registry'),
}));

export type PluginContextData = z.input<typeof PluginContextSchema>;
export type PluginContext = PluginContextData;

// ---------------------------------------------------------------------------
// RETIRED — the `onInstall` / `onEnable` / `onDisable` / `onUninstall` /
// `onUpgrade` lifecycle family, and the `UpgradeContextSchema` that existed to
// serve `onUpgrade` (#4212, ADR-0049 enforce-or-remove).
//
// The kernel never called any of them. Its plugin contract is `init(ctx)` /
// `start(ctx)` / `destroy()` (`packages/core/src/types.ts`): `kernel.use()`
// validates and stores, `bootstrap()` runs `init` then `start`, shutdown runs
// `destroy` in reverse order. The five hooks were declared here with no
// invocation site anywhere in the runtime — their only importer repo-wide was
// this file's own test — so a plugin authoring them shipped code that never
// ran, and the docs that recommended them sent authors at a dead seam
// (the #4212 report: a plugin following the documented advice registered its
// custom metadata types into nothing, with no error saying so).
//
// What owns each concern instead:
//   - install-time work → the package-install subsystem
//     (`registry.installPackage`, `sys_packages`, the marketplace flow);
//   - boot-time code → `init`/`start`, or for authored app bundles the
//     `onEnable` STACK runtime member `AppPlugin` invokes off the bundle
//     (`STACK_RUNTIME_MEMBERS` — same name, different and real contract);
//   - teardown → `destroy()`.
//
// Plain deletion, not `retiredKey()` tombstones: nothing parses plugin
// objects through these schemas (`stack.zod` carries plugins as
// `z.array(z.unknown())`), so a tombstone prescription could never be
// received — the `plugin-runtime.zod.ts` precedent.
// ---------------------------------------------------------------------------

/**
 * Shared Plugin Types
 * These are the specialized plugin types common between Manifest (Package) and Plugin (Runtime).
 */
export const CORE_PLUGIN_TYPES = [
  'ui',         // Frontend: Serves static assets/SPA (e.g. Console, Studio)
  'driver',     // Connectivity: Database or Storage adapters (e.g. SQL, S3)
  'server',     // Protocol: HTTP/RPC Servers (e.g. Hono, GraphQL)
  'app',        // Business: Vertical Solution Bundle (Metadata + Logic)
  'theme',      // Appearance: UI Overrides & CSS Variables
  'agent',      // AI: Autonomous Agent & Tool Definitions
  'objectql'    // Core: ObjectQL Engine Data Provider
] as const;

/**
 * Consumer-installable package types — ADR-0019 (App as the consumer unit).
 *
 * The package `type` enum is unchanged; this adds a *semantic* split over it:
 * which types are the one user-visible noun a tenant browses, installs, opens,
 * and uninstalls. Today that is only `app`. Every other type
 * (`plugin`/`driver`/`server`/`ui`/`theme`/`agent`/`module`/…) is an internal
 * contribution — it ships *inside* an App or is operator-provisioned — and is
 * never independently listed or installed by a consumer.
 */
export const CONSUMER_INSTALLABLE_TYPES = ['app'] as const;

/**
 * Returns true when a package `type` is a consumer-facing installable unit
 * (ADR-0019). Use this to filter the consumer Marketplace to `type: app`.
 */
export function isConsumerInstallable(type: string | undefined): boolean {
  return type != null && (CONSUMER_INSTALLABLE_TYPES as readonly string[]).includes(type);
}

export const PluginSchema = lazySchema(() => z.object({
  id: z.string().min(1).optional().describe('Unique Plugin ID (e.g. com.example.crm)'),
  type: z.enum([
    'standard',   // Default: General purpose backend logic (Service, Hook, etc.)
    ...CORE_PLUGIN_TYPES
  ]).default('standard').optional().describe('Plugin Type categorization for runtime behavior'),
  
  staticPath: z.string().optional().describe('Absolute path to static assets (Required for type="ui-plugin")'),
  slug: z.string().regex(/^[a-z0-9-_]+$/).optional().describe('URL path segment (Required for type="ui-plugin")'),
  default: z.boolean().optional().describe('Serve at root path (Only one "ui-plugin" can be default)'),
  
  version: z.string().regex(/^\d+\.\d+\.\d+$/).optional().describe('Semantic Version'),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().url().optional(),
}));

export type PluginDefinition = z.input<typeof PluginSchema>;
