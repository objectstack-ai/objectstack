// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Package Identity Protocol
 *
 * A **package** (also called a Solution in Power Platform, an Unlocked Package
 * in Salesforce, or an Application in ServiceNow) is the first-class unit of
 * distribution in ObjectStack. It groups related metadata — objects, views,
 * flows, translations, agents — into a named, versioned artifact.
 *
 * Architecture:
 * - `sys_package`         — identity (one row per logical package)
 * - `sys_package_version` — immutable release snapshots (see package-version.zod.ts)
 * - `sys_package_installation` — env ↔ version pairing (see environment-package.zod.ts)
 *
 * See `docs/adr/0003-package-as-first-class-citizen.md` for the full rationale.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Package visibility — controls who can discover and install the package.
 */
import { lazySchema } from '../shared/lazy-schema';
export const PackageVisibilitySchema = lazySchema(() => z
  .enum(['private', 'org', 'marketplace'])
  .describe(
    'Package visibility: private = owner org only; org = all envs in owner org; marketplace = public registry'
  ));

export type PackageVisibility = z.input<typeof PackageVisibilitySchema>;

/**
 * Category hint for marketplace discovery and filtering.
 * Kept open-ended (z.string()) so third-party packages can declare custom categories.
 */
export const PackageCategorySchema = lazySchema(() => z
  .string()
  .min(1)
  .describe('Package category for marketplace discovery (e.g. "crm", "hr", "finance", "devtools")'));

export type PackageCategory = z.input<typeof PackageCategorySchema>;

/**
 * Provenance tier of a package publisher.
 * Used by Studio/Console UI to display trust badges and by the Marketplace
 * to gate listing privileges.
 *
 * - `objectstack` — first-party, maintained by the ObjectStack core team
 * - `partner`     — verified third-party (signed publisher agreement)
 * - `community`   — public open submission, unverified
 * - `private`     — internal to the owner organization
 */
export const PackagePublisherSchema = lazySchema(() => z
  .enum(['objectstack', 'partner', 'community', 'private'])
  .describe('Package publisher provenance tier'));

export type PackagePublisher = z.input<typeof PackagePublisherSchema>;

// ---------------------------------------------------------------------------
// Per-locale translations for package listings
// ---------------------------------------------------------------------------

/**
 * BCP-47 locale tag — `en`, `zh`, `en-US`, `zh-CN`, …
 *
 * Used as the key in {@link PackageTranslationsSchema}. We accept the short
 * (`zh`) and region-qualified (`zh-CN`) forms; resolvers should fall back
 * from `zh-CN` → `zh` → fallbackLocale → base field.
 */
export const PackageLocaleSchema = lazySchema(() => z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'must be a BCP-47 locale (e.g. en, zh, zh-CN)')
  .describe('BCP-47 locale tag'));

export type PackageLocale = z.input<typeof PackageLocaleSchema>;

/**
 * Per-locale overrides for a package's display metadata.
 *
 * Any field omitted falls back to the base column on {@link PackageSchema}
 * (or {@link MarketplaceListingSchema}). Publishers are encouraged to ship
 * at least the `en` base copy in the base columns and add additional
 * locales here; the resolver always prefers the requested locale before
 * falling back.
 *
 * `screenshotCaptions` is keyed by **screenshot array index as a string**
 * (`"0"`, `"1"`, …) so it survives JSON round-trips without coupling to a
 * separate id.
 */
export const PackageTranslationSchema = lazySchema(() => z.object({
  /** Localized display name (overrides {@link PackageSchema}.displayName) */
  displayName: z.string().min(1).max(128).optional()
    .describe('Localized display name'),

  /** Localized short description (overrides PackageSchema.description) */
  description: z.string().max(512).optional()
    .describe('Localized short description'),

  /** Localized long-form README markdown (overrides PackageSchema.readme) */
  readme: z.string().optional()
    .describe('Localized long-form readme (markdown)'),

  /**
   * Localized tagline. Only meaningful on MarketplaceListing; safe to omit
   * on raw PackageSchema. Mirrors {@link MarketplaceListingSchema}.tagline.
   */
  tagline: z.string().max(120).optional()
    .describe('Localized short tagline (marketplace listing only)'),

  /**
   * Localized screenshot captions, keyed by screenshot array index as a
   * string (e.g. `{ "0": "Dashboard", "1": "Inbox" }`). Captures the same
   * data as {@link MarketplaceListingSchema}.screenshots[].caption but
   * keeps it locale-keyed without forcing publishers to duplicate the
   * full screenshots array per locale.
   */
  screenshotCaptions: z.record(z.string(), z.string()).optional()
    .describe('Per-index screenshot caption overrides'),
}).describe('Per-locale overrides for a package listing'));

export type PackageTranslation = z.input<typeof PackageTranslationSchema>;

/**
 * Locale-keyed translation map.
 *
 * `{ "zh": { displayName: "客户管理", ... }, "ja": { ... } }`
 *
 * Resolution order for a requested locale `req`:
 *   1. exact match (e.g. `zh-CN`)
 *   2. language-only fallback (e.g. `zh`)
 *   3. caller-supplied `fallbackLocale` (default `en`)
 *   4. the base column on the parent schema
 */
export const PackageTranslationsSchema = lazySchema(() => z
  .record(PackageLocaleSchema, PackageTranslationSchema)
  .describe('Locale-keyed overrides; missing keys fall back to base columns'));

export type PackageTranslations = z.input<typeof PackageTranslationsSchema>;

// ---------------------------------------------------------------------------
// sys_package — Package identity
// ---------------------------------------------------------------------------

/**
 * One row per logical package in the Control Plane.
 *
 * The package itself carries only identity and publishing metadata.
 * Actual content (objects, views, flows…) lives in {@link PackageVersion}.
 *
 * Addressable by `manifest_id` (globally unique reverse-domain string).
 */
export const PackageSchema = lazySchema(() => z.object({
  /** UUID of the package (stable, never reused). */
  id: z.string().uuid().describe('UUID of the package (stable, never reused)'),

  /**
   * Globally unique reverse-domain identifier (e.g. `com.acme.crm`).
   * Immutable once set — renaming a package requires creating a new package.
   */
  manifestId: z
    .string()
    .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/)
    .describe('Globally unique reverse-domain package identifier (e.g. com.acme.crm)'),

  /**
   * Metadata namespace the artifact installs under — the mandatory prefix of
   * every object name it ships (`crm` → `crm_account`). Mirrors
   * `manifest.namespace` (`packages/spec/src/kernel/manifest.zod.ts`) and is
   * carried here so the namespace leaves the artifact at publish time.
   *
   * ADR-0048 addendum §A.2 (Phase A1): the publish-time namespace exclusivity
   * gate is keyed on the **bare namespace** (D1) and can check nothing unless
   * the namespace travels on the publish payload. This field is that input.
   *
   * **Optional, deliberately.** `manifest.namespace` is itself optional today,
   * and §A.2's algorithm opens with `if (namespace is absent) -> allow`. A
   * package that declares no namespace makes no reservation and is not gated.
   *
   * The value is written from the compiled artifact's manifest by
   * `objectstack package publish` — it is never authored separately, because a
   * reservation is only meaningful if it names the prefix the package really
   * ships.
   */
  namespace: z
    .string()
    // Kept byte-identical to `ManifestSchema.shape.namespace`'s pattern; the
    // two are pinned against each other by `package-namespace.test.ts` so the
    // publish payload and the manifest cannot drift into disagreeing about
    // what a namespace is (addendum §A.7 "two gates, one vocabulary").
    .regex(/^[a-z][a-z0-9_]{1,19}$/, 'Namespace must be 2-20 chars, lowercase alphanumeric + underscore')
    .optional()
    .describe('Metadata namespace claimed by the package (mirrors manifest.namespace; e.g. "crm" → object names "crm_account")'),

  /** Organization that owns and publishes this package. */
  ownerOrgId: z.string().describe('Organization ID of the package owner/publisher'),

  /** Human-readable name shown in Studio and Marketplace. */
  displayName: z.string().min(1).max(128).describe('Display name shown in Studio and Marketplace'),

  /** Short description shown in search results and install dialogs. */
  description: z.string().max(512).optional().describe('Short package description'),

  /** Long-form documentation (markdown). */
  readme: z.string().optional().describe('Long-form package documentation (markdown)'),

  /**
   * Package visibility.
   * - `private`     — only the owner org can see and install it
   * - `org`         — all environments within the owner org
   * - `marketplace` — publicly discoverable in the ObjectStack Marketplace
   */
  visibility: PackageVisibilitySchema.default('private'),

  /** Primary category for marketplace filtering. */
  category: PackageCategorySchema.optional(),

  /** Additional tags for search and filtering (e.g. ["salesforce", "sync", "crm"]). */
  tags: z.array(z.string()).optional().describe('Search and filter tags'),

  /** URL to the package icon image. */
  iconUrl: z.string().url().optional().describe('Package icon URL'),

  /** URL to the package homepage or documentation site. */
  homepageUrl: z.string().url().optional().describe('Package homepage URL'),

  /** SPDX license identifier (e.g. "MIT", "Apache-2.0"). */
  license: z.string().optional().describe('SPDX license identifier (e.g. MIT, Apache-2.0)'),

  /**
   * Publisher provenance tier — surfaced as a trust badge in the Marketplace
   * and Studio. Defaults to `private` for org-scoped packages; the
   * `objectstack publish` CLI sets it explicitly when promoting first-party
   * or partner content.
   */
  publisher: PackagePublisherSchema.default('private'),

  /**
   * If true, this package is offered as a starting blueprint when creating a
   * new project (the "Choose a template" picker in Console). Starters are
   * regular packages — there is no separate `template` concept. CI promotes
   * `examples/app-*` packages by setting this flag during publish.
   */
  isStarter: z.boolean().default(false).describe(
    'If true, surfaces in the Create Project blueprint picker as a starter template'
  ),

  /**
   * Locale-keyed overrides for {@link displayName}, {@link description},
   * and {@link readme}. Missing locales / fields fall back to the base
   * columns. See {@link PackageTranslationsSchema}.
   */
  translations: PackageTranslationsSchema.optional()
    .describe('Locale-keyed overrides for display_name / description / readme'),

  /** Creation timestamp (ISO-8601). */
  createdAt: z.string().datetime().describe('Creation timestamp (ISO-8601)'),

  /** Last update timestamp (ISO-8601). */
  updatedAt: z.string().datetime().describe('Last update timestamp (ISO-8601)'),

  /** User ID that created the package entry. */
  createdBy: z.string().describe('User ID that created the package'),
}));

export type Package = z.input<typeof PackageSchema>;
/** Post-parse shape of {@link Package} — defaults applied, transforms run (ADR-0122). */
export type PackageParsed = z.infer<typeof PackageSchema>;

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

/**
 * Request to register a new package in the Control Plane.
 */
export const CreatePackageRequestSchema = lazySchema(() => z.object({
  manifestId: PackageSchema.shape.manifestId,
  // ADR-0048 addendum §A.2 Phase A1 — the namespace travels with the publish
  // payload, or the publish-time exclusivity gate (A2) has nothing to check.
  // Optional, matching `manifest.namespace` and the algorithm's first line
  // (`if (namespace is absent) -> allow`). Sent by `objectstack package
  // publish`, read off the compiled artifact's manifest.
  namespace: PackageSchema.shape.namespace,
  ownerOrgId: z.string().describe('Owner organization ID'),
  displayName: PackageSchema.shape.displayName,
  description: PackageSchema.shape.description,
  visibility: PackageVisibilitySchema.optional(),
  category: PackageCategorySchema.optional(),
  tags: z.array(z.string()).optional(),
  iconUrl: z.string().url().optional(),
  homepageUrl: z.string().url().optional(),
  license: z.string().optional(),
  publisher: PackagePublisherSchema.optional(),
  isStarter: z.boolean().optional(),
  translations: PackageTranslationsSchema.optional(),
  createdBy: z.string().describe('User ID creating the package'),
}).describe('Register a new package in the Control Plane'));

export type CreatePackageRequest = z.input<typeof CreatePackageRequestSchema>;

/**
 * Request to update mutable package metadata (visibility, description, tags…).
 * `manifestId` and `ownerOrgId` are immutable once set.
 */
export const UpdatePackageRequestSchema = lazySchema(() => z.object({
  displayName: PackageSchema.shape.displayName.optional(),
  description: PackageSchema.shape.description,
  readme: PackageSchema.shape.readme,
  visibility: PackageVisibilitySchema.optional(),
  category: PackageCategorySchema.optional(),
  tags: z.array(z.string()).optional(),
  iconUrl: z.string().url().optional(),
  homepageUrl: z.string().url().optional(),
  license: z.string().optional(),
  publisher: PackagePublisherSchema.optional(),
  isStarter: z.boolean().optional(),
  translations: PackageTranslationsSchema.optional(),
}).describe('Update mutable package metadata'));

export type UpdatePackageRequest = z.input<typeof UpdatePackageRequestSchema>;
