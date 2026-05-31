// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CONSUMER_INSTALLABLE_TYPES } from '../kernel/plugin.zod';

/**
 * # Marketplace Protocol
 * 
 * Defines the core schemas for the plugin marketplace ecosystem, covering:
 * - **Developer Side**: Package publishing, submission, and version releases
 * - **Platform Side**: Marketplace listing, review, approval, and discovery
 * 
 * This protocol defines the contract between plugin developers, the marketplace
 * platform, and customers who install plugins.
 * 
 * ## Architecture Alignment
 * - **Salesforce AppExchange**: Security review, managed packages, listing profiles
 * - **VS Code Marketplace**: Extension publishing, ratings, verified publishers
 * - **npm Registry**: Package publishing, versioning, scoped packages
 * - **Shopify App Store**: App review process, billing integration, merchant installs
 * 
 * ## Developer Publishing Flow
 * ```
 * 1. Develop   → Build the project locally using ObjectStack CLI
 * 2. Validate  → Run `os validate` (schema + security checks)
 * 3. Build     → Run `os build` (compile to dist/objectstack.json)
 * 4. Submit    → Run `os projects bind <id> --artifact dist/objectstack.json`
 * 5. Review    → Platform conducts automated + manual review
 * 6. Publish   → Approved listing goes live on marketplace
 * ```
 * 
 * ## Platform Management Flow
 * ```
 * 1. Receive   → Accept submissions from verified publishers
 * 2. Scan      → Automated security scan and compatibility check
 * 3. Review    → Human review for quality and policy compliance
 * 4. Catalog   → Index in marketplace search catalog
 * 5. Monitor   → Track installs, ratings, issues, and enforce SLAs
 * ```
 */

// ==========================================
// Publisher Identity
// ==========================================

/**
 * Publisher Verification Status
 */
import { lazySchema } from '../shared/lazy-schema';
import { PackageTranslationsSchema } from './package.zod';
export const PublisherVerificationSchema = lazySchema(() => z.enum([
  'unverified',  // Not yet verified
  'pending',     // Verification in progress
  'verified',    // Identity verified by platform
  'trusted',     // Trusted publisher (track record of quality)
  'partner',     // Official platform partner
]).describe('Publisher verification status'));

/**
 * Publisher Schema
 * Represents a developer or organization that publishes packages.
 */
export const PublisherSchema = lazySchema(() => z.object({
  /** Publisher unique identifier */
  id: z.string().describe('Publisher ID'),

  /** Display name */
  name: z.string().describe('Publisher display name'),

  /** Publisher type */
  type: z.enum(['individual', 'organization']).describe('Publisher type'),

  /** Verification status */
  verification: PublisherVerificationSchema.default('unverified')
    .describe('Publisher verification status'),

  /** Contact email */
  email: z.string().email().optional().describe('Contact email'),

  /** Website URL */
  website: z.string().url().optional().describe('Publisher website'),

  /** Organization logo URL */
  logoUrl: z.string().url().optional().describe('Publisher logo URL'),

  /** Short description/bio */
  description: z.string().optional().describe('Publisher description'),

  /** Registration date */
  registeredAt: z.string().datetime().optional()
    .describe('Publisher registration timestamp'),
}).describe('Developer or organization that publishes packages'));

// ==========================================
// Artifact Reference & Distribution
// ==========================================

/**
 * Artifact Reference Schema
 *
 * Points to a downloadable package artifact with integrity verification.
 * Used in marketplace listings and install workflows.
 */
export const ArtifactReferenceSchema = lazySchema(() => z.object({
  /** Artifact download URL */
  url: z.string().url().describe('Artifact download URL'),

  /** SHA256 integrity checksum */
  sha256: z.string().regex(/^[a-f0-9]{64}$/).describe('SHA256 checksum'),

  /** File size in bytes */
  size: z.number().int().positive().describe('Artifact size in bytes'),

  /** Artifact format */
  format: z.enum(['tgz', 'zip']).default('tgz').describe('Artifact format'),

  /** Upload timestamp */
  uploadedAt: z.string().datetime().describe('Upload timestamp'),
}).describe('Reference to a downloadable package artifact'));

export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;

/**
 * Artifact Download Response Schema
 *
 * Response from the artifact download API endpoint.
 * Provides a time-limited download URL with integrity metadata.
 */
export const ArtifactDownloadResponseSchema = lazySchema(() => z.object({
  /** Pre-signed or direct download URL */
  downloadUrl: z.string().url().describe('Artifact download URL (may be pre-signed)'),

  /** SHA256 checksum for download verification */
  sha256: z.string().regex(/^[a-f0-9]{64}$/).describe('SHA256 checksum for verification'),

  /** File size in bytes */
  size: z.number().int().positive().describe('Artifact size in bytes'),

  /** Artifact format */
  format: z.enum(['tgz', 'zip']).describe('Artifact format'),

  /** URL expiration time (for pre-signed URLs) */
  expiresAt: z.string().datetime().optional()
    .describe('URL expiration timestamp for pre-signed URLs'),
}).describe('Artifact download response with integrity metadata'));

export type ArtifactDownloadResponse = z.infer<typeof ArtifactDownloadResponseSchema>;

// ==========================================
// Marketplace Listing
// ==========================================

/**
 * Marketplace Category
 */
export const MarketplaceCategorySchema = lazySchema(() => z.enum([
  'crm',             // Customer Relationship Management
  'erp',             // Enterprise Resource Planning
  'hr',              // Human Resources
  'finance',         // Finance & Accounting
  'project',         // Project Management
  'collaboration',   // Collaboration & Communication
  'analytics',       // Analytics & Reporting
  'integration',     // Integrations & Connectors
  'automation',      // Automation & Workflows
  'ai',              // AI & Machine Learning
  'security',        // Security & Compliance
  'developer-tools', // Developer Tools
  'ui-theme',        // UI Themes & Appearance
  'storage',         // Storage & Drivers
  'other',           // Other / Uncategorized
]).describe('Marketplace package category'));

/**
 * Listing Status
 */
export const ListingStatusSchema = lazySchema(() => z.enum([
  'draft',           // Not yet submitted
  'submitted',       // Submitted for review
  'in-review',       // Under review
  'approved',        // Approved, ready to publish
  'published',       // Live on marketplace
  'rejected',        // Review rejected
  'suspended',       // Suspended by platform (policy violation)
  'deprecated',      // Deprecated by publisher
  'unlisted',        // Available by direct link only
]).describe('Marketplace listing status'));

/**
 * Pricing Model
 */
export const PricingModelSchema = lazySchema(() => z.enum([
  'free',            // Free to install
  'freemium',        // Free with paid premium features
  'paid',            // Requires purchase
  'subscription',    // Recurring subscription
  'usage-based',     // Pay per usage
  'contact-sales',   // Enterprise pricing, contact for quote
]).describe('Package pricing model'));

/**
 * Marketplace Listing Schema
 * 
 * The public-facing profile of a package on the marketplace.
 * Contains marketing information, pricing, and installation metadata.
 */
export const MarketplaceListingSchema = lazySchema(() => z.object({
  /** Listing ID (matches package ID) */
  id: z.string().describe('Listing ID (matches package manifest ID)'),

  /** Package ID (reverse domain notation) */
  packageId: z.string().describe('Package identifier'),

  /**
   * Package type of the listing. ADR-0019: the consumer Marketplace surfaces
   * exactly one user-visible noun — the App — so a listing may only describe a
   * consumer-installable type. Internal contributions (driver/server/plugin/…)
   * are never listed; they ship inside an App or are operator-provisioned.
   * Constrained to {@link CONSUMER_INSTALLABLE_TYPES} so a non-App listing
   * cannot even be represented.
   */
  packageType: z.enum(CONSUMER_INSTALLABLE_TYPES).default('app')
    .describe('Consumer-installable package type (ADR-0019: only `app` is listable)'),

  /** Publisher information */
  publisherId: z.string().describe('Publisher ID'),

  /** Current listing status */
  status: ListingStatusSchema.default('draft')
    .describe('Publication state: draft, published, under-review, suspended, deprecated, or unlisted'),

  /** Display name */
  name: z.string().describe('Display name'),

  /** Tagline (short description for cards/search results) */
  tagline: z.string().max(120).optional().describe('Short tagline (max 120 chars)'),

  /** Full description (supports Markdown) */
  description: z.string().optional().describe('Full description (Markdown)'),

  /** Category */
  category: MarketplaceCategorySchema.describe('Package category'),

  /** Additional tags for search discovery */
  tags: z.array(z.string()).optional().describe('Search tags'),

  /** Icon/logo URL */
  iconUrl: z.string().url().optional().describe('Package icon URL'),

  /** Screenshot URLs */
  screenshots: z.array(z.object({
    url: z.string().url(),
    caption: z.string().optional(),
  })).optional().describe('Screenshots'),

  /** Documentation URL */
  documentationUrl: z.string().url().optional()
    .describe('Documentation URL'),

  /** Support URL */
  supportUrl: z.string().url().optional()
    .describe('Support URL'),

  /** Source repository URL (if open source) */
  repositoryUrl: z.string().url().optional()
    .describe('Source repository URL'),

  /** Pricing model */
  pricing: PricingModelSchema.default('free')
    .describe('Pricing model'),

  /** Price in cents (if paid) */
  priceInCents: z.number().int().min(0).optional()
    .describe('Price in cents (e.g. 999 = $9.99)'),

  /** Latest published version */
  latestVersion: z.string().describe('Latest published version'),

  /** Minimum platform version required */
  minPlatformVersion: z.string().optional()
    .describe('Minimum ObjectStack platform version'),

  /** Available versions for installation */
  versions: z.array(z.object({
    version: z.string().describe('Version string'),
    releaseDate: z.string().datetime().describe('Release date'),
    releaseNotes: z.string().optional().describe('Release notes'),
    minPlatformVersion: z.string().optional().describe('Minimum platform version'),
    deprecated: z.boolean().default(false).describe('Whether this version is deprecated'),
    /** Artifact reference for this version */
    artifact: ArtifactReferenceSchema.optional()
      .describe('Downloadable artifact for this version'),
  })).optional().describe('Published versions'),

  /** Aggregate statistics */
  stats: z.object({
    totalInstalls: z.number().int().min(0).default(0).describe('Total installs'),
    activeInstalls: z.number().int().min(0).default(0).describe('Active installs'),
    averageRating: z.number().min(0).max(5).optional().describe('Average user rating (0-5)'),
    totalRatings: z.number().int().min(0).default(0).describe('Total ratings count'),
    totalReviews: z.number().int().min(0).default(0).describe('Total reviews count'),
  }).optional().describe('Aggregate marketplace statistics'),

  /** First published date */
  publishedAt: z.string().datetime().optional()
    .describe('First published timestamp'),

  /** Last updated date */
  updatedAt: z.string().datetime().optional()
    .describe('Last updated timestamp'),

  /**
   * Locale-keyed overrides for `name`, `tagline`, `description`, and
   * screenshot captions. See {@link PackageTranslationsSchema}.
   *
   * Resolution: requested-locale → language-only → `en` → base column.
   */
  translations: PackageTranslationsSchema.optional()
    .describe('Locale-keyed overrides for name / tagline / description / screenshot captions'),
}).describe('Public-facing package listing on the marketplace'));

// ==========================================
// Package Submission & Review
// ==========================================

/**
 * Package Submission Schema
 * A developer's submission of a package version for marketplace review.
 */
export const PackageSubmissionSchema = lazySchema(() => z.object({
  /** Submission ID */
  id: z.string().describe('Submission ID'),

  /** Package ID */
  packageId: z.string().describe('Package identifier'),

  /** Version being submitted */
  version: z.string().describe('Version being submitted'),

  /** Publisher ID */
  publisherId: z.string().describe('Publisher submitting'),

  /** Submission status */
  status: z.enum([
    'pending',        // Awaiting review
    'scanning',       // Automated scan in progress
    'in-review',      // Under manual review
    'changes-requested', // Reviewer requests changes
    'approved',       // Approved for publishing
    'rejected',       // Rejected
  ]).default('pending').describe('Review status'),

  /**
   * Package artifact URL or reference.
   * Points to the built package bundle for review.
   */
  artifactUrl: z.string().describe('Package artifact URL for review'),

  /** Release notes for this version */
  releaseNotes: z.string().optional().describe('Release notes for this version'),

  /** Whether this is the first submission (new listing) vs version update */
  isNewListing: z.boolean().default(false).describe('Whether this is a new listing submission'),

  /** Automated scan results */
  scanResults: z.object({
    /** Whether automated scan passed */
    passed: z.boolean(),
    /** Security scan score (0-100) */
    securityScore: z.number().min(0).max(100).optional(),
    /** Compatibility check passed */
    compatibilityCheck: z.boolean().optional(),
    /** Issues found during scan */
    issues: z.array(z.object({
      severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
      message: z.string(),
      file: z.string().optional(),
      line: z.number().optional(),
    })).optional(),
  }).optional().describe('Automated scan results'),

  /** Reviewer notes (from platform reviewer) */
  reviewerNotes: z.string().optional().describe('Notes from the platform reviewer'),

  /** Submitted timestamp */
  submittedAt: z.string().datetime().optional().describe('Submission timestamp'),

  /** Review completed timestamp */
  reviewedAt: z.string().datetime().optional().describe('Review completion timestamp'),
}).describe('Developer submission of a package version for review'));

// ==========================================
// Marketplace Search & Discovery
// ==========================================

/**
 * Marketplace Search Request
 */
export const MarketplaceSearchRequestSchema = lazySchema(() => z.object({
  /** Search query string */
  query: z.string().optional().describe('Full-text search query'),

  /** Filter by category */
  category: MarketplaceCategorySchema.optional().describe('Filter by category'),

  /** Filter by tags */
  tags: z.array(z.string()).optional().describe('Filter by tags'),

  /** Filter by pricing model */
  pricing: PricingModelSchema.optional().describe('Filter by pricing model'),

  /** Filter by publisher verification level */
  publisherVerification: PublisherVerificationSchema.optional()
    .describe('Filter by publisher verification level'),

  /** Sort by */
  sortBy: z.enum([
    'relevance',    // Best match (default for search)
    'popularity',   // Most installs
    'rating',       // Highest rated
    'newest',       // Most recently published
    'updated',      // Most recently updated
    'name',         // Alphabetical
  ]).default('relevance').describe('Sort field'),

  /** Sort direction */
  sortDirection: z.enum(['asc', 'desc']).default('desc').describe('Sort direction'),

  /** Pagination: page number */
  page: z.number().int().min(1).default(1).describe('Page number'),

  /** Pagination: items per page */
  pageSize: z.number().int().min(1).max(100).default(20).describe('Items per page'),

  /** Filter by minimum platform version compatibility */
  platformVersion: z.string().optional()
    .describe('Filter by platform version compatibility'),
}).describe('Marketplace search request'));

/**
 * Marketplace Search Response
 */
export const MarketplaceSearchResponseSchema = lazySchema(() => z.object({
  /** Search results */
  items: z.array(MarketplaceListingSchema).describe('Search result listings'),

  /** Total count (for pagination) */
  total: z.number().int().min(0).describe('Total matching results'),

  /** Current page */
  page: z.number().int().min(1).describe('Current page number'),

  /** Items per page */
  pageSize: z.number().int().min(1).describe('Items per page'),

  /** Facets for filtering */
  facets: z.object({
    categories: z.array(z.object({
      category: MarketplaceCategorySchema,
      count: z.number().int().min(0),
    })).optional(),
    pricing: z.array(z.object({
      model: PricingModelSchema,
      count: z.number().int().min(0),
    })).optional(),
  }).optional().describe('Aggregation facets for refining search'),
}).describe('Marketplace search response'));

// ==========================================
// Marketplace Install from Marketplace
// ==========================================

/**
 * Install from Marketplace Request
 * Extends the basic package install with marketplace-specific fields.
 */
export const MarketplaceInstallRequestSchema = lazySchema(() => z.object({
  /** Listing ID to install */
  listingId: z.string().describe('Marketplace listing ID'),

  /** Specific version to install (defaults to latest) */
  version: z.string().optional().describe('Version to install'),

  /** License key (for paid packages) */
  licenseKey: z.string().optional().describe('License key for paid packages'),

  /** User-provided settings at install time */
  settings: z.record(z.string(), z.unknown()).optional()
    .describe('User-provided settings at install time'),

  /** Whether to enable immediately after install */
  enableOnInstall: z.boolean().default(true)
    .describe('Whether to enable immediately after install'),

  /** Artifact reference (resolved from listing version, or provided directly) */
  artifactRef: ArtifactReferenceSchema.optional()
    .describe('Artifact reference for direct installation'),

  /** Tenant ID */
  tenantId: z.string().optional().describe('Tenant identifier'),
}).describe('Install from marketplace request'));

/**
 * Install from Marketplace Response
 */
export const MarketplaceInstallResponseSchema = lazySchema(() => z.object({
  /** Whether installation was successful */
  success: z.boolean().describe('Whether installation succeeded'),

  /** Installed package ID */
  packageId: z.string().optional().describe('Installed package identifier'),

  /** Installed version */
  version: z.string().optional().describe('Installed version'),

  /** Human-readable message */
  message: z.string().optional().describe('Installation status message'),
}).describe('Install from marketplace response'));

// ==========================================
// Export Types
// ==========================================

export type PublisherVerification = z.infer<typeof PublisherVerificationSchema>;
export type Publisher = z.infer<typeof PublisherSchema>;
export type MarketplaceCategory = z.infer<typeof MarketplaceCategorySchema>;
export type ListingStatus = z.infer<typeof ListingStatusSchema>;
export type PricingModel = z.infer<typeof PricingModelSchema>;
export type MarketplaceListing = z.infer<typeof MarketplaceListingSchema>;
export type PackageSubmission = z.infer<typeof PackageSubmissionSchema>;
export type MarketplaceSearchRequest = z.infer<typeof MarketplaceSearchRequestSchema>;
export type MarketplaceSearchResponse = z.infer<typeof MarketplaceSearchResponseSchema>;
export type MarketplaceInstallRequest = z.infer<typeof MarketplaceInstallRequestSchema>;
export type MarketplaceInstallResponse = z.infer<typeof MarketplaceInstallResponseSchema>;
