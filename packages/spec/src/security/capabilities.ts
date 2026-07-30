// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * [ADR-0066 D1] Canonical platform capability registry.
 *
 * The built-in authorization capabilities the framework ships, as first-class
 * definitions (name / label / description / scope). This module is the SINGLE
 * SOURCE OF TRUTH consumed by:
 *   - `@objectstack/plugin-security` `bootstrapSystemCapabilities`, which seeds
 *     these into `sys_capability` records at boot (`managed_by: 'platform'`), and
 *   - the authoring lint `validateCapabilityReferences` (ADR-0066 ⑨), which
 *     resolves capability references (`requiredPermissions`) against these names
 *     plus any a stack declares via a permission set's `systemPermissions`.
 *
 * Keeping the list here (in the contract package, which everything depends on)
 * avoids a spec→plugin dependency inversion and keeps the seeder and the lint
 * from drifting apart.
 */

export interface PlatformCapability {
  /** Stable capability name referenced by `systemPermissions` / `requiredPermissions`. */
  name: string;
  /** Human label shown in Setup. */
  label: string;
  /** What holding the capability permits. */
  description: string;
  /** `platform` = global; `org` = scoped to the caller's organization. */
  scope: 'platform' | 'org';
}

/**
 * The curated built-in capabilities. Back-compat: string references to any of
 * these keep resolving because they are seeded as records with the same `name`.
 */
export const PLATFORM_CAPABILITIES: readonly PlatformCapability[] = [
  { name: 'manage_users', label: 'Manage Users', description: 'Create, edit, and deactivate users across the platform.', scope: 'platform' },
  { name: 'manage_org_users', label: 'Manage Organization Users', description: 'Manage members within the caller’s organization.', scope: 'org' },
  { name: 'manage_metadata', label: 'Manage Metadata', description: 'Author and publish object/view/flow and other metadata.', scope: 'platform' },
  { name: 'manage_platform_settings', label: 'Manage Platform Settings', description: 'Configure global platform settings (mail, storage, AI, licensing, …) and platform-only Setup pages.', scope: 'platform' },
  { name: 'setup.access', label: 'Setup Access', description: 'Enter the Setup app shell.', scope: 'platform' },
  // [Finding-1] The write counterpart to `setup.access`: saving changes to
  // tenant/Setup settings pages (branding, company, localization, feature
  // flags). Previously referenced by settings manifests but never declared or
  // granted — which was harmless only while settings writes went ungated.
  { name: 'setup.write', label: 'Write Settings', description: 'Save changes to tenant/Setup settings pages.', scope: 'org' },
  { name: 'studio.access', label: 'Studio Access', description: 'Enter the Studio metadata-design surfaces.', scope: 'platform' },
  // [ADR-0111 D9] Sharing administration right-sized below full platform admin:
  // gates the sharing-rule surface (define / delete / evaluate — an org-wide
  // grant generator) and, in the DEPTH extension, the non-owner path to
  // per-record share management. Salesforce ships the analogous standalone
  // "Manage Sharing" permission. Seeded into `admin_full_access` so existing
  // admin flows are unchanged; `manage_platform_settings` is honoured as a
  // legacy equivalent by the enforcement seams that predate this capability.
  { name: 'manage_sharing', label: 'Manage Sharing', description: 'Administer record sharing: author and evaluate sharing rules, and manage per-record shares beyond one’s own records.', scope: 'org' },
];

/** Set of built-in capability names, for fast membership checks (lint, gating). */
export const PLATFORM_CAPABILITY_NAMES: ReadonlySet<string> = new Set(
  PLATFORM_CAPABILITIES.map((c) => c.name),
);

/**
 * [ADR-0066 D1] PACKAGE-LEVEL capability DECLARATION.
 *
 * The formal entry point for a package/app to DEFINE an authorization
 * capability of its own — the counterpart, on the declaration side, of the
 * curated {@link PLATFORM_CAPABILITIES}. Authored via {@link defineCapability}
 * and collected on a stack's `capabilities` array, these declarations flow
 * EXPLICITLY into the `sys_capability` registry at boot with `managed_by:
 * 'package'` + `package_id` provenance (seeded by
 * `@objectstack/plugin-security`'s `bootstrapDeclaredCapabilities`).
 *
 * This replaces the old implicit "derive an untitled capability from whatever a
 * permission set happens to reference in `systemPermissions[]`" back-door: a
 * package now says what capabilities it owns, with a real label/description,
 * and the registry can attribute + uninstall them. The implicit derivation
 * still runs for back-compat (references with no declaration keep resolving),
 * but an EXPLICIT declaration takes precedence and carries package provenance.
 *
 * NOTE — a capability is NOT a contract: resources REFERENCE a capability by
 * name via `requiredPermissions` (the requirement side); packages DEFINE one
 * here (the declaration side); permission sets GRANT one via `systemPermissions`
 * (the assignment side). There is no `inputs` shape — see ADR-0066's three-way
 * separation (capability / assignment / requirement).
 */
export const CapabilityDeclarationSchema = lazySchema(() => z.object({
  /**
   * Stable capability key referenced by `systemPermissions` / `requiredPermissions`.
   * Lowercase, dot/underscore separable (e.g. `export_data`, `billing.refund`).
   */
  name: z.string()
    .min(1)
    .regex(/^[a-z][a-z0-9_.]*$/, 'Capability name must be lowercase and may contain digits, "_" and "." (e.g. export_data, billing.refund)')
    .describe('Stable capability key referenced by systemPermissions / requiredPermissions'),
  /** Human label shown in Setup. Defaults to a humanized `name` when omitted. */
  label: z.string().min(1).optional().describe('Human label shown in Setup'),
  /** What holding the capability permits. */
  description: z.string().optional().describe('What holding this capability permits'),
  /** `platform` = global; `org` = scoped to the caller's organization. Defaults to `platform`. */
  scope: z.enum(['platform', 'org']).default('platform')
    .describe('platform = a platform-wide power; org = scoped to an organization'),
  /**
   * [ADR-0086 D3] Owning package id — the author-declared fallback provenance.
   * The registry stamps `_packageId` at load; this is used only when that is
   * absent. A capability with no resolvable owner is not materialized as a
   * package row.
   */
  packageId: z.string().optional()
    .describe('[ADR-0086 D3] Owning package id (author-declared fallback; absent = registry-stamped)'),
}));

/** A validated package-level capability declaration (output of {@link defineCapability}). */
export type CapabilityDeclaration = z.infer<typeof CapabilityDeclarationSchema>;
/** Authoring input for {@link CapabilityDeclaration} — defaulted fields are optional. */
export type CapabilityDeclarationInput = z.input<typeof CapabilityDeclarationSchema>;

/**
 * Type-safe factory for a package-level capability declaration (ADR-0066 D1).
 * Validates at authoring time via `.parse()` and accepts input-shape config
 * (optional `label`/`description`, defaulted `scope`) — preferred over a bare
 * object literal.
 *
 * @example
 * ```ts
 * export const ExportDataCapability = defineCapability({
 *   name: 'export_data',
 *   label: 'Export Data',
 *   description: 'Bulk-export records to CSV/XLSX.',
 *   scope: 'org',
 * });
 * ```
 */
export function defineCapability(config: CapabilityDeclarationInput): CapabilityDeclaration {
  return CapabilityDeclarationSchema.parse(config);
}
