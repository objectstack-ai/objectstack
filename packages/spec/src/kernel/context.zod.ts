// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { TenantQuotaSchema } from '../system/tenant.zod.js';

/**
 * Runtime Mode Enum
 * Defines the operating mode of the kernel
 */
import { lazySchema } from '../shared/lazy-schema';
export const RuntimeMode = z.enum([
  'development', // Hot-reload, verbose logging
  'production',  // Optimized, strict security
  'test',        // Mocked interfaces
  'provisioning', // Setup/Migration mode
  'preview',     // Demo/preview mode — bypass auth, simulate admin identity
]).describe('Kernel operating mode');

export type RuntimeMode = z.infer<typeof RuntimeMode>;

/**
 * Preview Mode Configuration Schema
 *
 * Configures the kernel's preview/demo mode behaviour.
 * When `mode` is set to `'preview'`, the platform skips authentication
 * screens and optionally simulates an admin identity so that visitors
 * (e.g. app-marketplace customers) can explore the system without
 * registering or logging in.
 *
 * **Security note:** preview mode should NEVER be used in production.
 * The runtime must enforce this constraint.
 *
 * @example
 * ```ts
 * const ctx = KernelContextSchema.parse({
 *   instanceId: '550e8400-e29b-41d4-a716-446655440000',
 *   mode: 'preview',
 *   version: '1.0.0',
 *   cwd: '/app',
 *   startTime: Date.now(),
 *   previewMode: {
 *     autoLogin: true,
 *     simulatedRole: 'admin',
 *   },
 * });
 * ```
 */
export const PreviewModeConfigSchema = lazySchema(() => z.object({
  /**
   * Automatically log in as a simulated user on startup.
   * When enabled, the frontend skips login/registration screens entirely.
   */
  autoLogin: z.boolean().default(true)
    .describe('Auto-login as simulated user, skipping login/registration pages'),

  /**
   * Role of the simulated user.
   * Determines the permission level of the auto-created preview session.
   */
  simulatedRole: z.enum(['admin', 'user', 'viewer']).default('admin')
    .describe('Permission role for the simulated preview user'),

  /**
   * Display name for the simulated user shown in the UI.
   */
  simulatedUserName: z.string().default('Preview User')
    .describe('Display name for the simulated preview user'),

  /**
   * Whether the preview session is read-only.
   * When true, all write operations (create, update, delete) are blocked.
   */
  readOnly: z.boolean().default(false)
    .describe('Restrict the preview session to read-only operations'),

  /**
   * Session duration in seconds. After expiry the preview session ends.
   * 0 means no expiration.
   */
  expiresInSeconds: z.number().int().min(0).default(0)
    .describe('Preview session duration in seconds (0 = no expiration)'),

  /**
   * Optional banner message shown in the UI to indicate preview mode.
   * Useful for marketplace demos so visitors know they are in a sandbox.
   */
  bannerMessage: z.string().optional()
    .describe('Banner message displayed in the UI during preview mode'),
}));

export type PreviewModeConfig = z.infer<typeof PreviewModeConfigSchema>;
/** Post-parse shape of {@link PreviewModeConfig} — defaults applied, transforms run (ADR-0122). */
export type PreviewModeConfigParsed = z.infer<typeof PreviewModeConfigSchema>;

/**
 * Kernel Context Schema
 * Defines the static environment information available to the Kernel at boot.
 */
export const KernelContextSchema = lazySchema(() => z.object({
  /**
   * Instance Identity
   */
  instanceId: z.string().uuid().describe('Unique UUID for this running kernel process'),
  
  /**
   * Environment Metadata
   */
  mode: RuntimeMode.default('production'),
  version: z.string().describe('Kernel version'),
  appName: z.string().optional().describe('Host application name'),
  
  /**
   * Paths
   */
  cwd: z.string().describe('Current working directory'),
  workspaceRoot: z.string().optional().describe('Workspace root if different from cwd'),
  
  /**
   * Telemetry
   */
  startTime: z.number().int().describe('Boot timestamp (ms)'),
  
  /**
   * Feature Flags (Global)
   */
  features: z.record(z.string(), z.boolean()).default({}).describe('Global feature toggles'),

  /**
   * Preview Mode Configuration.
   * Only relevant when `mode` is `'preview'`. Configures auto-login,
   * simulated identity, read-only restrictions, and UI banner.
   */
  previewMode: PreviewModeConfigSchema.optional()
    .describe('Preview/demo mode configuration (used when mode is "preview")'),
}));

export type KernelContext = z.infer<typeof KernelContextSchema>;
/** Post-parse shape of {@link KernelContext} — defaults applied, transforms run (ADR-0122). */
export type KernelContextParsed = z.infer<typeof KernelContextSchema>;

// ==========================================================================
// Tenant Runtime Context
// ==========================================================================

/**
 * Tenant Runtime Context Schema.
 *
 * Extends the base KernelContext with tenant-specific information.
 * Constructed per-request from: session → org → tenant lookup.
 * Provides the tenant identity, plan, region, and database URL to all
 * downstream services during request processing.
 */
export const TenantRuntimeContextSchema = lazySchema(() => KernelContextSchema.extend({
  /** Unique tenant identifier resolved from the current session */
  tenantId: z.string().min(1).describe('Resolved tenant identifier'),

  /** Tenant subscription plan */
  tenantPlan: z.enum(['free', 'pro', 'enterprise']).describe('Tenant subscription plan'),

  /** Tenant deployment region */
  tenantRegion: z.string().optional().describe('Tenant deployment region'),

  /** Tenant database connection URL */
  tenantDbUrl: z.string().min(1).describe('Tenant database connection URL'),

  /** Optional tenant quotas for the current plan */
  tenantQuotas: TenantQuotaSchema.optional().describe('Tenant resource quotas'),
}).describe('Tenant-aware kernel runtime context'));

export type TenantRuntimeContext = z.infer<typeof TenantRuntimeContextSchema>;
/** Post-parse shape of {@link TenantRuntimeContext} — defaults applied, transforms run (ADR-0122). */
export type TenantRuntimeContextParsed = z.infer<typeof TenantRuntimeContextSchema>;
