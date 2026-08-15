// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { PublisherVerificationSchema } from './marketplace.zod';

/**
 * # Developer Portal Protocol
 *
 * Defines schemas for the developer-facing side of the marketplace ecosystem.
 * Covers the complete developer journey:
 *
 * ```
 * Register → Create App → Develop → Validate → Build → Submit → Monitor → Iterate
 * ```
 *
 * ## Architecture Alignment
 * - **Salesforce Partner Portal**: ISV registration, AppExchange publishing, Trialforce
 * - **Shopify Partner Dashboard**: App management, analytics, billing
 * - **VS Code Marketplace Management**: Extension publishing, statistics, tokens
 *
 * ## Identity Integration (better-auth)
 * Authentication, organization management, and API keys are handled by the
 * Identity module (`@objectstack/spec` Identity namespace), which follows the
 * better-auth specification. This module only defines marketplace-specific
 * extensions on top of the shared identity layer:
 *
 * - **User** → `Identity.UserSchema`; the session wire shape is `Session` from
 *   `@objectstack/spec/api` (the identity module deliberately declares no bare
 *   `SessionSchema` — #4641)
 * - **Organization & Members** → `Identity.OrganizationSchema`, `Identity.MemberSchema`
 * - **API Keys** → the `sys_api_key` ObjectSchema in
 *   `@objectstack/platform-objects` (`identity/sys-api-key.object.ts`), minted via
 *   `POST /api/v1/keys`; its `scopes` column is the marketplace-scope carrier.
 *   There is no `Identity.ApiKeySchema` — #8715 retired it (it documented
 *   better-auth's apiKey plugin, which this platform does not load)
 *
 * ## Key Concepts
 * - **Publisher Profile**: Links an Identity Organization to a marketplace publisher
 * - **App Listing Management**: CRUD for marketplace listings (draft → published)
 * - **Version Channels**: alpha / beta / rc / stable release channels
 * - **Publishing Analytics**: Install trends, revenue, ratings over time
 */

// ==========================================
// Publisher Profile (extends Identity.Organization)
// ==========================================

/**
 * Publisher Profile Schema
 *
 * Links an Identity Organization to a marketplace publisher identity.
 * The organization itself (name, slug, logo, members) is managed via
 * Identity.OrganizationSchema and Identity.MemberSchema (better-auth aligned).
 *
 * This schema only holds marketplace-specific publisher metadata.
 */
import { lazySchema } from '../shared/lazy-schema';
export const PublisherProfileSchema = lazySchema(() => z.object({
  /** Organization ID (references Identity.Organization.id) */
  organizationId: z.string().describe('Identity Organization ID'),

  /** Publisher ID (marketplace-assigned identifier) */
  publisherId: z.string().describe('Marketplace publisher ID'),

  /** Verification level (marketplace trust tier) */
  verification: PublisherVerificationSchema.default('unverified'),

  /** Accepted developer program agreement version */
  agreementVersion: z.string().optional().describe('Accepted developer agreement version'),

  /** Publisher-specific website (may differ from org) */
  website: z.string().url().optional().describe('Publisher website'),

  /** Publisher-specific support email */
  supportEmail: z.string().email().optional().describe('Publisher support email'),

  /** Registration timestamp (when org became a publisher) */
  registeredAt: z.string().datetime(),
}));

// ==========================================
// Version Channels & Release Management
// ==========================================

/**
 * Release Channel — allows pre-release distribution
 */
export const ReleaseChannelSchema = lazySchema(() => z.enum([
  'alpha',          // Early development, unstable
  'beta',           // Feature-complete, testing phase
  'rc',             // Release candidate, final testing
  'stable',         // Production-ready, general availability
]));

/**
 * Version Release Schema
 *
 * A single version release of a package with channel assignment.
 */
export const VersionReleaseSchema = lazySchema(() => z.object({
  /** Semver version string */
  version: z.string().describe('Semver version (e.g., 2.1.0-beta.1)'),

  /** Release channel */
  channel: ReleaseChannelSchema.default('stable'),

  /** Release notes (Markdown) */
  releaseNotes: z.string().optional().describe('Release notes (Markdown)'),

  /** Changelog entries (structured) */
  changelog: z.array(z.object({
    type: z.enum(['added', 'changed', 'fixed', 'removed', 'deprecated', 'security']),
    description: z.string(),
  })).optional().describe('Structured changelog entries'),

  /** Minimum platform version required */
  minPlatformVersion: z.string().optional(),

  /** Build artifact URL */
  artifactUrl: z.string().optional().describe('Built package artifact URL'),

  /** Artifact checksum (integrity) */
  artifactChecksum: z.string().optional().describe('SHA-256 checksum'),

  /** Whether this version is deprecated */
  deprecated: z.boolean().default(false),

  /** Deprecation message (if deprecated) */
  deprecationMessage: z.string().optional(),

  /** Release timestamp */
  releasedAt: z.string().datetime().optional(),
}));

// ==========================================
// App Listing Management (Developer CRUD)
// ==========================================

/**
 * Create Listing Request — developer creates a new marketplace listing
 */
export const CreateListingRequestSchema = lazySchema(() => z.object({
  /** Package ID (reverse domain, e.g., com.acme.crm) */
  packageId: z.string().describe('Package identifier'),

  /** Display name */
  name: z.string().describe('App display name'),

  /** Short tagline (max 120 chars) */
  tagline: z.string().max(120).optional(),

  /** Full description (Markdown) */
  description: z.string().optional(),

  /** Category */
  category: z.string().describe('Marketplace category'),

  /** Additional tags */
  tags: z.array(z.string()).optional(),

  /** Icon URL */
  iconUrl: z.string().url().optional(),

  /** Screenshots */
  screenshots: z.array(z.object({
    url: z.string().url(),
    caption: z.string().optional(),
  })).optional(),

  /** Documentation URL */
  documentationUrl: z.string().url().optional(),

  /** Support URL */
  supportUrl: z.string().url().optional(),

  /** Source repository URL */
  repositoryUrl: z.string().url().optional(),

  /** Pricing model */
  pricing: z.enum([
    'free', 'freemium', 'paid', 'subscription', 'usage-based', 'contact-sales',
  ]).default('free'),

  /** Price in cents (if paid) */
  priceInCents: z.number().int().min(0).optional(),
}));

/**
 * Update Listing Request — developer updates listing metadata
 */
export const UpdateListingRequestSchema = lazySchema(() => z.object({
  /** Listing ID */
  listingId: z.string().describe('Listing ID to update'),

  /** Updatable fields (all optional, partial update) */
  name: z.string().optional(),
  tagline: z.string().max(120).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  iconUrl: z.string().url().optional(),
  screenshots: z.array(z.object({
    url: z.string().url(),
    caption: z.string().optional(),
  })).optional(),
  documentationUrl: z.string().url().optional(),
  supportUrl: z.string().url().optional(),
  repositoryUrl: z.string().url().optional(),
  pricing: z.enum([
    'free', 'freemium', 'paid', 'subscription', 'usage-based', 'contact-sales',
  ]).optional(),
  priceInCents: z.number().int().min(0).optional(),
}));

/**
 * Listing Action Request — lifecycle actions on a listing
 */
export const ListingActionRequestSchema = lazySchema(() => z.object({
  /** Listing ID */
  listingId: z.string().describe('Listing ID'),

  /** Action to perform */
  action: z.enum([
    'submit',         // Submit for review
    'unlist',         // Remove from public search (keep accessible by direct link)
    'deprecate',      // Mark as deprecated
    'reactivate',     // Reactivate unlisted/deprecated listing
  ]).describe('Action to perform on listing'),

  /** Reason for action (e.g., deprecation message) */
  reason: z.string().optional(),
}));

// ==========================================
// Publishing Analytics (Developer Dashboard)
// ==========================================

/**
 * Analytics Time Range
 */
export const AnalyticsTimeRangeSchema = lazySchema(() => z.enum([
  'last_7d',
  'last_30d',
  'last_90d',
  'last_365d',
  'all_time',
]));

/**
 * Publishing Analytics Request
 */
export const PublishingAnalyticsRequestSchema = lazySchema(() => z.object({
  /** Listing ID */
  listingId: z.string().describe('Listing to get analytics for'),

  /** Time range */
  timeRange: AnalyticsTimeRangeSchema.default('last_30d'),

  /** Metrics to include */
  metrics: z.array(z.enum([
    'installs',       // Install count over time
    'uninstalls',     // Uninstall count over time
    'active_installs', // Active install trend
    'ratings',        // Rating distribution
    'revenue',        // Revenue (for paid apps)
    'page_views',     // Listing page views
  ])).optional().describe('Metrics to include (default: all)'),
}));

/**
 * Time Series Data Point
 */
export const TimeSeriesPointSchema = lazySchema(() => z.object({
  /** ISO date string (day granularity) */
  date: z.string(),
  /** Metric value */
  value: z.number(),
}));

/**
 * Publishing Analytics Response
 */
export const PublishingAnalyticsResponseSchema = lazySchema(() => z.object({
  /** Listing ID */
  listingId: z.string(),

  /** Time range */
  timeRange: AnalyticsTimeRangeSchema,

  /** Summary statistics */
  summary: z.object({
    totalInstalls: z.number().int().min(0),
    activeInstalls: z.number().int().min(0),
    totalUninstalls: z.number().int().min(0),
    averageRating: z.number().min(0).max(5).optional(),
    totalRatings: z.number().int().min(0),
    totalRevenue: z.number().min(0).optional().describe('Revenue in cents'),
    pageViews: z.number().int().min(0),
  }),

  /** Time series data by metric */
  timeSeries: z.record(z.string(), z.array(TimeSeriesPointSchema)).optional()
    .describe('Time series keyed by metric name'),

  /** Rating distribution (1-5 stars) */
  ratingDistribution: z.object({
    1: z.number().int().min(0).default(0),
    2: z.number().int().min(0).default(0),
    3: z.number().int().min(0).default(0),
    4: z.number().int().min(0).default(0),
    5: z.number().int().min(0).default(0),
  }).optional(),
}));

// ==========================================
// Export Types
// ==========================================

export type PublisherProfile = z.input<typeof PublisherProfileSchema>;
/** Post-parse shape of {@link PublisherProfile} — defaults applied, transforms run (ADR-0122). */
export type PublisherProfileParsed = z.infer<typeof PublisherProfileSchema>;
export type ReleaseChannel = z.input<typeof ReleaseChannelSchema>;
export type VersionRelease = z.input<typeof VersionReleaseSchema>;
/** Post-parse shape of {@link VersionRelease} — defaults applied, transforms run (ADR-0122). */
export type VersionReleaseParsed = z.infer<typeof VersionReleaseSchema>;
export type CreateListingRequest = z.input<typeof CreateListingRequestSchema>;
/** Post-parse shape of {@link CreateListingRequest} — defaults applied, transforms run (ADR-0122). */
export type CreateListingRequestParsed = z.infer<typeof CreateListingRequestSchema>;
export type UpdateListingRequest = z.input<typeof UpdateListingRequestSchema>;
export type ListingActionRequest = z.input<typeof ListingActionRequestSchema>;
export type AnalyticsTimeRange = z.input<typeof AnalyticsTimeRangeSchema>;
export type PublishingAnalyticsRequest = z.input<typeof PublishingAnalyticsRequestSchema>;
/** Post-parse shape of {@link PublishingAnalyticsRequest} — defaults applied, transforms run (ADR-0122). */
export type PublishingAnalyticsRequestParsed = z.infer<typeof PublishingAnalyticsRequestSchema>;
export type TimeSeriesPoint = z.input<typeof TimeSeriesPointSchema>;
export type PublishingAnalyticsResponse = z.input<typeof PublishingAnalyticsResponseSchema>;
/** Post-parse shape of {@link PublishingAnalyticsResponse} — defaults applied, transforms run (ADR-0122). */
export type PublishingAnalyticsResponseParsed = z.infer<typeof PublishingAnalyticsResponseSchema>;
