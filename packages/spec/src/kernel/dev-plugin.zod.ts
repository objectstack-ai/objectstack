// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Dev Mode Plugin Protocol
 *
 * Declared configuration vocabulary for a development-mode plugin: per-service
 * dev strategies, fixture loading, developer tooling, presets.
 *
 * ⚠️ **Declared, not implemented — pending enforce-or-remove (#4149).**
 * The shipped `@objectstack/plugin-dev` consumes its own `DevPluginOptions`
 * interface, NOT this schema, and none of the surfaces below (presets,
 * fixtures, dev-tools dashboard, per-service strategies, simulated latency)
 * exist in it. Since ADR-0115 it is an **assembly** plugin: it wires the real
 * platform plugins for local development and registers no stub or simulated
 * services — an unfilled slot answers exactly as it does in production. The
 * `strategy: 'stub'` value in particular describes a behaviour the platform
 * has retired. Do not build against this file until #4149 resolves it.
 *
 * Original design goals, kept for the #4149 evaluation:
 * - Zero-config by default: `devPlugins: ['@objectstack/plugin-dev']`
 * - Every service can be overridden or disabled individually
 * - Preset profiles (minimal / standard / full) for common scenarios
 */

// ============================================================================
// Dev Service Override
// ============================================================================

/**
 * Dev Service Override Schema
 *
 * Allows fine-grained control over a single service in development mode.
 * Each override targets a service by name and specifies whether it should
 * be enabled, which implementation strategy to use, and optional config.
 */
import { lazySchema } from '../shared/lazy-schema';
export const DevServiceOverrideSchema = lazySchema(() => z.object({
  /** Service identifier (e.g. 'auth', 'eventBus', 'fileStorage') */
  service: z.string().min(1).describe('Target service identifier'),

  /** Whether this service is enabled in dev mode */
  enabled: z.boolean().default(true).describe('Enable or disable this service'),

  /**
   * Implementation strategy for the service in dev mode.
   * - mock:     Use a mock/stub that records calls (for assertions)
   * - memory:   Use a real but in-memory implementation (e.g. SQLite, Map)
   * - stub:     Use a static/no-op implementation
   * - passthrough: Use the real production implementation (for integration testing)
   */
  strategy: z.enum(['mock', 'memory', 'stub', 'passthrough']).default('memory')
    .describe('Implementation strategy for development'),

  /** Optional per-service configuration (strategy-specific) */
  config: z.record(z.string(), z.unknown()).optional()
    .describe('Strategy-specific configuration for this service override'),
}));

export type DevServiceOverride = z.infer<typeof DevServiceOverrideSchema>;

// ============================================================================
// Dev Fixture Configuration
// ============================================================================

/**
 * Dev Fixture Config Schema
 *
 * Configures automatic seed/fixture data loading in development mode.
 * Fixtures provide a reproducible dataset for local development and demos.
 */
export const DevFixtureConfigSchema = lazySchema(() => z.object({
  /** Whether to load fixtures on startup */
  enabled: z.boolean().default(true).describe('Load fixture data on startup'),

  /**
   * Glob patterns pointing to fixture files
   * (e.g. `["./fixtures/*.json", "./test/data/*.yml"]`)
   */
  paths: z.array(z.string()).optional()
    .describe('Glob patterns for fixture files'),

  /** Whether to reset data before loading fixtures */
  resetBeforeLoad: z.boolean().default(true)
    .describe('Clear existing data before loading fixtures'),

  /**
   * Environment tag filter – only load fixtures tagged for these environments.
   * When omitted, all fixtures are loaded.
   */
  envFilter: z.array(z.string()).optional()
    .describe('Only load fixtures matching these environment tags'),
}));

export type DevFixtureConfig = z.infer<typeof DevFixtureConfigSchema>;

// ============================================================================
// Dev Tools Configuration
// ============================================================================

/**
 * Dev Tools Config Schema
 *
 * Optional developer tooling that can be enabled alongside the dev plugin.
 */
export const DevToolsConfigSchema = lazySchema(() => z.object({
  /** Enable hot-module replacement / live reload */
  hotReload: z.boolean().default(true).describe('Enable HMR / live-reload'),

  /** Enable request inspector UI for debugging HTTP traffic */
  requestInspector: z.boolean().default(false).describe('Enable request inspector'),

  /** Enable an in-browser database explorer */
  dbExplorer: z.boolean().default(false).describe('Enable database explorer UI'),

  /** Enable verbose logging across all services */
  verboseLogging: z.boolean().default(true).describe('Enable verbose logging'),

  /** Enable OpenAPI / Swagger documentation endpoint */
  apiDocs: z.boolean().default(true).describe('Serve OpenAPI docs at /_dev/docs'),

  /** Enable a mail catcher for outbound email (like MailHog) */
  mailCatcher: z.boolean().default(false).describe('Capture outbound emails in dev'),
}));

export type DevToolsConfig = z.infer<typeof DevToolsConfigSchema>;

// ============================================================================
// Dev Plugin Preset
// ============================================================================

/**
 * Dev Plugin Preset
 *
 * Predefined configuration profiles for common development scenarios.
 * - minimal:  Only core data services (fast startup, low memory)
 * - standard: Core + API + auth + events (typical full-stack dev)
 * - full:     Every service enabled, including background jobs and AI agents
 */
export const DevPluginPreset = z.enum([
  'minimal',
  'standard',
  'full',
]).describe('Predefined dev configuration profile');

export type DevPluginPreset = z.infer<typeof DevPluginPreset>;

// ============================================================================
// Dev Plugin Configuration
// ============================================================================

/**
 * Dev Plugin Config Schema
 *
 * Top-level configuration for the development-mode plugin.
 * This is the shape of the configuration payload that
 * `@objectstack/plugin-dev` (or equivalent) understands.
 *
 * The outer wiring (e.g. how a stack declares `devPlugins`) is defined
 * by the stack/manifest schemas; this type only describes the plugin's
 * own config object.
 *
 * @example Minimal usage (zero-config)
 * ```ts
 * const devConfig: DevPluginConfig = {};
 * ```
 *
 * @example With preset
 * ```ts
 * const devConfig: DevPluginConfig = {
 *   preset: 'full',
 * };
 * ```
 *
 * @example Fine-grained overrides
 * ```ts
 * const devConfig: DevPluginConfig = {
 *   preset: 'standard',
 *   services: {
 *     auth:       { enabled: true, strategy: 'mock' },
 *     fileStorage: { enabled: false },
 *   },
 *   fixtures: { paths: ['./fixtures/*.json'] },
 *   tools: { dbExplorer: true },
 * };
 * ```
 */
export const DevPluginConfigSchema = lazySchema(() => z.object({
  /**
   * Configuration preset.
   * When provided, services and tools are pre-configured for the selected
   * profile. Individual `services` and `tools` settings override the preset.
   * @default 'standard'
   */
  preset: DevPluginPreset.default('standard')
    .describe('Base configuration preset'),

  /**
   * Per-service overrides.
   * Keys are service names; values configure the dev strategy.
   * Only services explicitly listed here override the preset defaults.
   */
  services: z.record(
    z.string().min(1),
    DevServiceOverrideSchema.omit({ service: true }),
  ).optional().describe('Per-service dev overrides keyed by service name'),

  /** Fixture / seed data configuration */
  fixtures: DevFixtureConfigSchema.optional()
    .describe('Fixture data loading configuration'),

  /** Developer tooling configuration */
  tools: DevToolsConfigSchema.optional()
    .describe('Developer tooling settings'),

  /**
   * Port for the dev-tools UI dashboard.
   * Serves a lightweight web dashboard for inspecting services, events,
   * and request logs during development.
   * @default 4400
   */
  port: z.number().int().min(1).max(65535).default(4400)
    .describe('Port for the dev-tools dashboard'),

  /**
   * Auto-open the dev-tools dashboard in the default browser on startup.
   */
  open: z.boolean().default(false)
    .describe('Auto-open dev dashboard in browser'),

  /**
   * Seed a default admin user for development.
   * When enabled, the dev plugin creates a pre-authenticated admin user
   * so that developers can bypass login flows.
   */
  seedAdminUser: z.boolean().default(true)
    .describe('Create a default admin user for development'),

  /**
   * Simulated latency (ms) to add to service calls.
   * Helps developers build UIs that handle loading states correctly.
   * Set to 0 to disable.
   */
  simulatedLatency: z.number().int().min(0).default(0)
    .describe('Artificial latency (ms) added to service calls'),
}));

export type DevPluginConfig = z.infer<typeof DevPluginConfigSchema>;
export type DevPluginConfigInput = z.input<typeof DevPluginConfigSchema>;
