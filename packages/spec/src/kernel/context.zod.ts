// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { TenantQuotaSchema } from '../system/tenant.zod.js';
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';

// Retirement prescriptions (#11846, ADR-0049 enforce-or-remove; maintainer
// ruling 2026-08-27). Declared with `//` (never `/** */`) and ABOVE the enum's
// JSDoc on purpose — build-docs takes the file's FIRST JSDoc as the reference
// page's module blurb (the hook-body.zod.ts placement precedent).
//
// No `os migrate meta` sentence in either string, deliberately: there is no D2
// conversion behind this retirement — a kernel context is constructed by HOST
// CODE at boot, never authored in a stack collection or stored as a
// `sys_metadata` row, so the conversion chain has no seam that would ever see
// one (the `kernel/Manifest:loading` precedent). The prescription reaches
// authors through these two rejection sites plus the D3 semantic entry
// `kernel-context-preview-mode-retired`.
const RUNTIME_MODE_PREVIEW_RETIRED =
  "`context.mode: 'preview'` was removed from `RuntimeMode` in @objectstack/spec 17 "
  + '(#11846, ADR-0049 enforce-or-remove) — no layer of the platform ever branched on it: '
  + 'the value promised "bypass auth, simulate admin identity" and no code path implemented '
  + 'either half, so a deployment declaring it ran with ordinary production behaviour under '
  + 'a misleading label. Delete the value — `mode` defaults to `production`; use '
  + '`development` for local demo work. Preview DEPLOYMENTS are the deployment layer\'s '
  + 'job (`OS_PREVIEW_MODE` is routing-only and never touched identity). If a preview '
  + 'experience becomes a product capability it re-declares fresh, with the '
  + 'production-posture hard-refusal as the first-landed half (#11846 ruling record).';
const PREVIEW_MODE_RETIRED =
  '`context.previewMode` was removed in @objectstack/spec 17 (ADR-0049 '
  + 'enforce-or-remove) — nothing ever read the block: none of its six keys (`autoLogin`, '
  + '`simulatedRole`, `simulatedUserName`, `readOnly`, `expiresInSeconds`, `bannerMessage`) '
  + 'had a consumer in any repo, so an authored block parsed cleanly and configured '
  + 'NOTHING, while its own docstring promised an auth bypass ("skips authentication '
  + 'screens", "simulates an admin identity") and named a production guard no runtime ever '
  + 'received. Delete the key. Preview/demo deployments belong to the deployment layer, '
  + 'which owns auth per-project (`ArtifactKernelFactory` in the cloud distribution); '
  + '`OS_PREVIEW_MODE` stays there as a routing-only switch. If a preview experience '
  + 'becomes a product capability it re-declares fresh, with the production-posture '
  + 'hard-refusal as the first-landed half (ruling record).';

/**
 * Runtime Mode Enum
 * Defines the operating mode of the kernel
 */
export const RuntimeMode = z.enum([
  'development', // Hot-reload, verbose logging
  'production',  // Optimized, strict security
  'test',        // Mocked interfaces
  'provisioning', // Setup/Migration mode
  // 'preview' was RETIRED in #11846 — see RUNTIME_MODE_PREVIEW_RETIRED above.
], {
  // Only the value that USED to be legal gets the retirement prescription —
  // telling the author of a typo that their mode "was removed" would
  // misinform. Everything else keeps zod's own enum message, which already
  // lists the legal values. (The `HookBodyCapability` / `managedBy: 'system'`
  // precedent.)
  error: (issue) => (issue.input === 'preview' ? RUNTIME_MODE_PREVIEW_RETIRED : undefined),
}).describe('Kernel operating mode');

export type RuntimeMode = z.input<typeof RuntimeMode>;

// ── `PreviewModeConfigSchema` was RETIRED here (#11846, ADR-0049) ────────────
//
// The whole def — six authorable keys (`autoLogin` default true,
// `simulatedRole` default 'admin', `simulatedUserName`, `readOnly`,
// `expiresInSeconds`, `bannerMessage`) — left the published set together with
// its `PreviewModeConfig` / `PreviewModeConfigParsed` types: its only carrier
// key (`KernelContext.previewMode`, tombstoned below) is retired, and an
// exported value schema with no consumer reads as a capability (#3950, the
// `PerformanceConfigSchema` rule). Registered as `kernel/PreviewModeConfig` in
// `RETIRED_DEFS_BY_MAJOR[18]`; the prescription lives on the tombstone below,
// the `RuntimeMode` error map above, and the D3 semantic entry
// `kernel-context-preview-mode-retired`. What actually produces preview
// deployments is the deployment layer — the cloud distribution owns auth
// per-project (`ArtifactKernelFactory`), and `OS_PREVIEW_MODE` there is
// routing-only.

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
   * RETIRED (#11846, ADR-0049 enforce-or-remove): the `previewMode` block —
   * declared as an auth bypass, enforced by nothing — is unwritable. The
   * schema is not `.strict()`, so a bare deletion would have Zod silently
   * STRIP the key (#3733, ADR-0104); the tombstone keeps the removal audible
   * in both channels (`tsc` types the key `never`; the parse raises the
   * prescription). `TenantRuntimeContextSchema` extends this shape and
   * inherits the tombstone.
   */
  previewMode: retiredKey(PREVIEW_MODE_RETIRED),
}));

export type KernelContext = z.input<typeof KernelContextSchema>;
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

export type TenantRuntimeContext = z.input<typeof TenantRuntimeContextSchema>;
/** Post-parse shape of {@link TenantRuntimeContext} — defaults applied, transforms run (ADR-0122). */
export type TenantRuntimeContextParsed = z.infer<typeof TenantRuntimeContextSchema>;
